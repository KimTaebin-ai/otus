use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum_extra::extract::CookieJar;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde::Deserialize;

use crate::AppState;
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::models::{NewDemoUser, User};
use crate::routes::me::Me;
use crate::schema::users;
use crate::session::{self, CurrentUser};

#[derive(Deserialize)]
pub struct DemoLogin {
    login: String,
    display_name: Option<String>,
}

fn valid_login(login: &str) -> bool {
    (1..=32).contains(&login.len())
        && login
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Logs in as a demo user, creating it on first use. Returns 404 unless DEMO_LOGIN_ENABLED.
pub async fn demo_login(
    State(state): State<AppState>,
    jar: CookieJar,
    ApiJson(body): ApiJson<DemoLogin>,
) -> Result<(CookieJar, Json<Me>), AppError> {
    if !state.config.demo_login_enabled {
        return Err(AppError::NotFound);
    }
    if !valid_login(&body.login) {
        return Err(AppError::InvalidRequest(
            "login은 영문 소문자·숫자·-·_ 1~32자여야 합니다.".into(),
        ));
    }
    let display_name = body.display_name.as_deref().unwrap_or(&body.login).trim();
    if display_name.is_empty() || display_name.chars().count() > 50 {
        return Err(AppError::InvalidRequest(
            "display_name은 1~50자여야 합니다.".into(),
        ));
    }

    let mut conn = state.pool.get().await?;
    let existing = users::table
        .filter(users::is_demo.eq(true))
        .filter(users::login.eq(&body.login))
        .select(User::as_select())
        .first(&mut conn)
        .await
        .optional()?;
    let user = match existing {
        Some(user) => user,
        None => {
            diesel::insert_into(users::table)
                .values(NewDemoUser {
                    login: &body.login,
                    display_name,
                    is_demo: true,
                })
                .returning(User::as_returning())
                .get_result(&mut conn)
                .await?
        }
    };

    // Rotate: drop any session this browser already had
    session::destroy(&mut conn, &jar).await?;
    let tokens = session::create(&mut conn, user.id).await?;
    tracing::info!(user_id = user.id, "demo login");
    drop(conn);
    let me = Me::load(&state, user).await?;
    Ok((session::set_cookies(jar, tokens), Json(me)))
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
    _user: CurrentUser,
) -> Result<(CookieJar, StatusCode), AppError> {
    let mut conn = state.pool.get().await?;
    session::destroy(&mut conn, &jar).await?;
    Ok((session::clear_cookies(jar), StatusCode::NO_CONTENT))
}

#[cfg(test)]
mod tests {
    use super::valid_login;

    #[test]
    fn demo_login_names() {
        assert!(valid_login("dongmin"));
        assert!(valid_login("demo_user-2"));
        assert!(!valid_login(""));
        assert!(!valid_login("Dongmin"));
        assert!(!valid_login("a b"));
        assert!(!valid_login(&"a".repeat(33)));
    }
}
