//! Server-side sessions (see CLAUDE.md "Auth").
//!
//! The browser holds two random 256-bit tokens: the session ID in an HttpOnly
//! `__Host-session` cookie, and a CSRF token in a JS-readable `XSRF-TOKEN` cookie
//! that Angular's HttpClient echoes back as `X-XSRF-TOKEN`. The database stores
//! only SHA-256 hashes of both.

use axum::extract::FromRequestParts;
use axum::http::Method;
use axum::http::request::Parts;
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, SameSite};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{TimeDelta, Utc};
use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::db::Pool;
use crate::error::AppError;
use crate::models::{Session, User};
use crate::schema::{sessions, users};

pub const SESSION_COOKIE: &str = "__Host-session";
pub const XSRF_COOKIE: &str = "XSRF-TOKEN";
pub const XSRF_HEADER: &str = "x-xsrf-token";

const IDLE_TIMEOUT: TimeDelta = TimeDelta::minutes(30);
const ABSOLUTE_LIFETIME: TimeDelta = TimeDelta::hours(12);
/// Don't write last_seen_at on every request.
const TOUCH_INTERVAL: TimeDelta = TimeDelta::minutes(1);

pub struct Tokens {
    session: String,
    csrf: String,
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS random number generator failed");
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub fn is_safe_method(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// Creates a new session for `user_id`. Always a fresh ID, so logging in rotates the session.
pub async fn create(conn: &mut AsyncPgConnection, user_id: i64) -> Result<Tokens, AppError> {
    let tokens = Tokens {
        session: random_token(),
        csrf: random_token(),
    };
    let now = Utc::now();
    diesel::insert_into(sessions::table)
        .values((
            sessions::id_hash.eq(hash(&tokens.session)),
            sessions::user_id.eq(user_id),
            sessions::csrf_hash.eq(hash(&tokens.csrf)),
            sessions::created_at.eq(now),
            sessions::last_seen_at.eq(now),
            sessions::expires_at.eq(now + ABSOLUTE_LIFETIME),
        ))
        .execute(conn)
        .await?;
    Ok(tokens)
}

/// Deletes the session named by the request's cookie, if any.
pub async fn destroy(conn: &mut AsyncPgConnection, jar: &CookieJar) -> Result<(), AppError> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        diesel::delete(sessions::table.find(hash(cookie.value())))
            .execute(conn)
            .await?;
    }
    Ok(())
}

/// No Max-Age: both cookies end with the browser session; the server enforces lifetimes.
pub fn set_cookies(jar: CookieJar, tokens: Tokens) -> CookieJar {
    jar.add(
        Cookie::build((SESSION_COOKIE, tokens.session))
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::Lax),
    )
    .add(
        // Readable by JS on purpose: Angular copies it into the X-XSRF-TOKEN header
        Cookie::build((XSRF_COOKIE, tokens.csrf))
            .path("/")
            .secure(true)
            .same_site(SameSite::Lax),
    )
}

/// Always emits removal cookies, even if the request didn't send them
/// (`CookieJar::remove` only removes cookies present in the request).
pub fn clear_cookies(jar: CookieJar) -> CookieJar {
    let removal = |name: &'static str| {
        let mut c = Cookie::build((name, "")).path("/").secure(true).build();
        c.make_removal();
        c
    };
    jar.add(removal(SESSION_COOKIE)).add(removal(XSRF_COOKIE))
}

/// The logged-in user. Rejects with 401 when there is no valid session, and with
/// 403 when a state-changing request lacks the matching CSRF token.
pub struct CurrentUser(pub User);

/// 403 unless `user` is staff (`operator`/`accountant`/`admin`). The session only
/// names the user; the role is re-read from the DB by `CurrentUser` on every request.
pub fn require_staff(user: &User) -> Result<(), AppError> {
    if user.role.is_staff() {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let jar = CookieJar::from_headers(&parts.headers);
        let id_hash = hash(
            jar.get(SESSION_COOKIE)
                .ok_or(AppError::Unauthorized)?
                .value(),
        );

        let mut conn = state.pool.get().await?;
        let found: Option<(Session, User)> = sessions::table
            .inner_join(users::table)
            .filter(sessions::id_hash.eq(&id_hash))
            .select((Session::as_select(), User::as_select()))
            .first(&mut conn)
            .await
            .optional()?;
        let (session, user) = found.ok_or(AppError::Unauthorized)?;

        let now = Utc::now();
        let demo_disabled = user.is_demo && !state.config.demo_login_enabled;
        if demo_disabled || now >= session.expires_at || now >= session.last_seen_at + IDLE_TIMEOUT
        {
            diesel::delete(sessions::table.find(&id_hash))
                .execute(&mut conn)
                .await?;
            return Err(AppError::Unauthorized);
        }

        if !is_safe_method(&parts.method) {
            let token = parts
                .headers
                .get(XSRF_HEADER)
                .and_then(|v| v.to_str().ok())
                .ok_or(AppError::Forbidden)?;
            if hash(token) != session.csrf_hash {
                return Err(AppError::Forbidden);
            }
        }

        if now - session.last_seen_at >= TOUCH_INTERVAL {
            diesel::update(sessions::table.find(&id_hash))
                .set(sessions::last_seen_at.eq(now))
                .execute(&mut conn)
                .await?;
        }
        Ok(Self(user))
    }
}

/// Hourly sweep of expired and idle sessions.
pub fn spawn_cleanup(pool: Pool) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            let result = async {
                let mut conn = pool.get().await?;
                let now = Utc::now();
                let deleted = diesel::delete(
                    sessions::table.filter(
                        sessions::expires_at
                            .le(now)
                            .or(sessions::last_seen_at.le(now - IDLE_TIMEOUT)),
                    ),
                )
                .execute(&mut conn)
                .await?;
                anyhow::Ok(deleted)
            }
            .await;
            match result {
                Ok(n) if n > 0 => tracing::info!("removed {n} expired sessions"),
                Ok(_) => {}
                Err(e) => tracing::warn!("session cleanup failed: {e:#}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_256_bit() {
        let a = random_token();
        assert_ne!(a, random_token());
        assert_eq!(URL_SAFE_NO_PAD.decode(&a).unwrap().len(), 32);
        assert_eq!(hash(&a).len(), 32);
    }
}
