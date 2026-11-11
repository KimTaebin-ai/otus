mod admin_data;
mod admin_revision;
mod archive;
mod config;
mod crypto;
mod csrf;
mod cycle;
mod db;
mod domain;
mod eligibility;
mod error;
mod extract;
mod fortytwo;
mod kst;
mod mail;
mod models;
mod ratelimit;
mod routes;
mod scan;
mod schema;
mod seed;
mod session;
mod storage;
mod study_time;

use std::sync::Arc;

use anyhow::Context;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use tokio::net::TcpListener;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::config::Config;

const JSON_BODY_LIMIT: usize = 64 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub pool: db::Pool,
    pub config: Arc<Config>,
    pub bank_cipher: Arc<crypto::FieldCipher>,
    pub file_cipher: Arc<crypto::FieldCipher>,
    /// Bounds memory: each upload or verification holds a whole PDF (up to 20 MiB) in memory
    pub heavy_io: Arc<tokio::sync::Semaphore>,
    /// None only in local demos without CLAMAV_ADDR
    pub scanner: Option<Arc<scan::Scanner>>,
    /// for the 42 API
    pub http: reqwest::Client,
    /// Short-TTL single-flight cache for `/api/me` study hours (see fortytwo)
    pub locations_cache: Arc<fortytwo::LocationsCache>,
    pub limiters: Arc<ratelimit::Limiters>,
    pub archive: Arc<archive::ArchiveRuntime>,
    pub mailer: Option<Arc<mail::Mailer>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env is for local development only; in the pod everything comes from the environment
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let mut config = Config::from_env()?;
    tokio::fs::create_dir_all(&config.upload_dir)
        .await
        .with_context(|| format!("creating UPLOAD_DIR {}", config.upload_dir.display()))?;

    // keep the only copies of the keys inside the ciphers (which zeroize on drop)
    let bank_key = zeroize::Zeroizing::new(std::mem::take(&mut config.bank_account_key));
    let bank_cipher =
        crypto::FieldCipher::new("BANK_ACCOUNT_KEY", config.bank_account_key_id, &bank_key)?;
    let file_key = zeroize::Zeroizing::new(std::mem::take(&mut config.file_encryption_key));
    let file_cipher = crypto::FieldCipher::new(
        "FILE_ENCRYPTION_KEY",
        config.file_encryption_key_id,
        &file_key,
    )?;
    drop((bank_key, file_key));

    db::run_migrations(&config.database_url).await?;
    let pool = db::pool(&config.database_url)?;
    storage::sweep_orphans(&mut *pool.get().await?, &config.upload_dir).await?;

    if std::env::args().nth(1).as_deref() == Some("seed") {
        // seeded users log in without a password: demo environments only
        anyhow::ensure!(
            config.demo_login_enabled,
            "seed creates passwordless demo users; it only runs with DEMO_LOGIN_ENABLED=true"
        );
        let mut conn = pool.get().await?;
        return seed::run(&mut conn, &config.upload_dir, &file_cipher).await;
    }

    let bind_addr = config.bind_addr;
    let config_scanner = config
        .clamav_addr
        .clone()
        .map(|addr| Arc::new(scan::Scanner::new(addr)));
    if config_scanner.is_none() {
        tracing::warn!("CLAMAV_ADDR is not set: uploads are NOT scanned for malware");
    }
    let state = AppState {
        pool,
        config: Arc::new(config),
        bank_cipher: Arc::new(bank_cipher),
        file_cipher: Arc::new(file_cipher),
        heavy_io: Arc::new(tokio::sync::Semaphore::new(8)),
        scanner: config_scanner,
        locations_cache: Arc::new(fortytwo::LocationsCache::new()),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("otus-backend")
            .build()?,
        limiters: Arc::new(ratelimit::Limiters::new()),
        archive: Arc::new(archive::ArchiveRuntime::from_env()?),
        mailer: mail::Mailer::from_env()?.map(Arc::new),
    };
    archive::start(&state).await?;
    mail::spawn_worker(state.clone());
    session::spawn_cleanup(state.pool.clone());
    crate::routes::time_requirements::spawn_jobs(state.clone());
    ratelimit::Limiters::spawn_pruning(state.limiters.clone());
    if state.config.demo_login_enabled {
        tracing::warn!(
            "DEMO_LOGIN_ENABLED is on: anyone can log in without 42 and use /api/dev/* to \
             approve their own submissions. Never enable it in production."
        );
    }
    // JSON bodies are small; the upload route sets its own larger limit
    let app = routes::router(&state.config)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            csrf::require_same_origin,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ratelimit::limit,
        ))
        .layer(DefaultBodyLimit::max(JSON_BODY_LIMIT))
        // slow or stalled clients can't hold a connection forever (20 MiB uploads included)
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_secs(120),
        ))
        // log the path only: query strings can carry secrets (the OAuth code and state)
        .layer(TraceLayer::new_for_http().make_span_with(
            |req: &axum::http::Request<axum::body::Body>| {
                tracing::debug_span!("request", method = %req.method(), path = %req.uri().path())
            },
        ))
        .with_state(state);

    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("binding {bind_addr}"))?;
    tracing::info!("listening on {bind_addr}");
    // ConnectInfo gives the rate limiter the peer address
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

/// Ctrl-C locally, SIGTERM from `podman stop` / `podman kube down`.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
