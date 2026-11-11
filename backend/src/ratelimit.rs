//! In-memory token-bucket rate limiting (the backend runs as a single instance).
//!
//! - login endpoints (`/api/auth/*`): per client IP
//! - every state-changing request: per session (per IP without one)
//! - uploads (submission files, bankbook copies): per session, much stricter, because
//!   every uploaded version is kept on disk
//! - downloads of original documents: per session
//!
//! The client IP is Caddy's X-Forwarded-For, trusted only when the connection itself comes
//! from loopback: in the pod only Caddy can reach the backend. Caddy replaces any
//! X-Forwarded-For sent by the client.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::Response;
use axum_extra::extract::CookieJar;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use crate::AppState;
use crate::error::AppError;
use crate::session::{self, SESSION_COOKIE};

pub struct RateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<String, (f64, Instant)>>,
}

impl RateLimiter {
    /// Allows bursts of `capacity`, then one request per `refill_every`.
    pub fn new(capacity: u32, refill_every: Duration) -> Self {
        Self {
            capacity: f64::from(capacity),
            refill_per_sec: 1.0 / refill_every.as_secs_f64(),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Takes one token for `key`, or returns how many seconds until one is available.
    pub fn check(&self, key: &str) -> Result<(), u64> {
        self.check_at(key, Instant::now())
    }

    fn check_at(&self, key: &str, now: Instant) -> Result<(), u64> {
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let (tokens, last) = buckets
            .entry(key.to_owned())
            .or_insert((self.capacity, now));
        let elapsed = now.saturating_duration_since(*last).as_secs_f64();
        *tokens = (*tokens + elapsed * self.refill_per_sec).min(self.capacity);
        *last = now;
        if *tokens >= 1.0 {
            *tokens -= 1.0;
            Ok(())
        } else {
            Err(((1.0 - *tokens) / self.refill_per_sec).ceil() as u64)
        }
    }

    /// Forgets buckets that have refilled completely, so memory doesn't grow forever.
    fn prune(&self) {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        buckets.retain(|_, (tokens, last)| {
            *tokens + now.saturating_duration_since(*last).as_secs_f64() * self.refill_per_sec
                < self.capacity
        });
    }
}

pub struct Limiters {
    pub auth: RateLimiter,
    pub writes: RateLimiter,
    pub uploads: RateLimiter,
    pub downloads: RateLimiter,
}

impl Limiters {
    pub fn new() -> Self {
        Self {
            auth: RateLimiter::new(10, Duration::from_secs(6)),
            writes: RateLimiter::new(60, Duration::from_secs(1)),
            uploads: RateLimiter::new(20, Duration::from_secs(30)),
            // slows bulk exfiltration through a stolen session
            downloads: RateLimiter::new(30, Duration::from_secs(10)),
        }
    }

    pub fn spawn_pruning(limiters: std::sync::Arc<Self>) {
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(600));
            loop {
                tick.tick().await;
                limiters.auth.prune();
                limiters.writes.prune();
                limiters.uploads.prune();
                limiters.downloads.prune();
            }
        });
    }
}

fn client_ip(req: &Request) -> Option<IpAddr> {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip())?;
    if peer.is_loopback() {
        let forwarded = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok());
        if let Some(ip) = forwarded {
            return Some(ip);
        }
    }
    Some(peer)
}

fn is_upload(method: &Method, path: &str) -> bool {
    (method == Method::POST && path.starts_with("/api/submissions/") && path.ends_with("/files"))
        || (method == Method::PUT && path == "/api/me/bank-account")
}

pub async fn limit(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let path = req.uri().path().to_owned();
    let ip = client_ip(&req)
        .map(|ip| format!("ip:{ip}"))
        .unwrap_or_else(|| "ip:unknown".into());
    // keyed by a hash of the session cookie, never the cookie itself
    let session_key = CookieJar::from_headers(req.headers())
        .get(SESSION_COOKIE)
        .map(|c| format!("s:{}", URL_SAFE_NO_PAD.encode(session::hash(c.value()))));
    let limiters = &state.limiters;

    let result = if path.starts_with("/api/auth/") && path != "/api/auth/methods" {
        limiters.auth.check(&ip)
    } else if path.starts_with("/api/files/") {
        limiters
            .downloads
            .check(session_key.as_deref().unwrap_or(&ip))
    } else if !session::is_safe_method(req.method()) {
        let key = session_key.as_deref().unwrap_or(&ip);
        limiters.writes.check(key).and_then(|()| {
            if is_upload(req.method(), &path) {
                limiters.uploads.check(key)
            } else {
                Ok(())
            }
        })
    } else {
        Ok(())
    };
    match result {
        Ok(()) => Ok(next.run(req).await),
        Err(retry_after) => {
            tracing::info!(%path, key = %session_key.as_deref().unwrap_or(&ip), "rate limited");
            Err(AppError::RateLimited { retry_after })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bursts_then_refills() {
        let l = RateLimiter::new(3, Duration::from_secs(10));
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(l.check_at("a", t0).is_ok());
        }
        assert_eq!(l.check_at("a", t0), Err(10));
        assert!(l.check_at("b", t0).is_ok(), "keys are independent");
        assert_eq!(l.check_at("a", t0 + Duration::from_secs(4)), Err(6));
        assert!(l.check_at("a", t0 + Duration::from_secs(10)).is_ok());
    }

    #[test]
    fn prune_drops_only_full_buckets() {
        let l = RateLimiter::new(2, Duration::from_millis(1));
        let _ = l.check("a");
        std::thread::sleep(Duration::from_millis(5));
        l.prune();
        assert!(l.buckets.lock().unwrap().is_empty());
    }
}
