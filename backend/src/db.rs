use anyhow::anyhow;
use diesel::Connection;
use diesel_async::AsyncPgConnection;
use diesel_async::async_connection_wrapper::AsyncConnectionWrapper;
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::pooled_connection::deadpool;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

pub type Pool = deadpool::Pool<AsyncPgConnection>;

const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// Bounded so a burst of slow requests can't hang everything waiting for a connection.
pub fn pool(database_url: &str) -> anyhow::Result<Pool> {
    let manager = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);
    let timeout = Some(std::time::Duration::from_secs(5));
    Ok(Pool::builder(manager)
        .max_size(16)
        .wait_timeout(timeout)
        .create_timeout(timeout)
        .runtime(::deadpool::Runtime::Tokio1)
        .build()?)
}

/// Applies pending migrations at startup so the pod never runs against an old schema.
/// Retries the first connection because the db container may still be starting.
pub async fn run_migrations(database_url: &str) -> anyhow::Result<()> {
    let url = database_url.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut attempt = 1;
        let mut conn = loop {
            match AsyncConnectionWrapper::<AsyncPgConnection>::establish(&url) {
                Ok(conn) => break conn,
                Err(e) if attempt < 30 => {
                    tracing::warn!("database not ready (attempt {attempt}): {e}");
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                Err(e) => return Err(e.into()),
            }
        };
        let applied = conn
            .run_pending_migrations(MIGRATIONS)
            .map_err(|e| anyhow!(e))?;
        for m in applied {
            tracing::info!("applied migration {m}");
        }
        Ok(())
    })
    .await?
}
