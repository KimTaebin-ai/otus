//! 42 Intra OAuth2 login (authorization code + PKCE).
//!
//! The backend runs the whole exchange: the browser only ever sees our session cookie,
//! never a 42 token. Only members of the configured campus (FORTY_TWO_CAMPUS_ID) may log
//! in. The 42 access token is used once for /v2/me and then dropped.
//! Every failure redirects to `/login?error=<code>` so U01 can explain it.

use crate::domain::Role;
use axum::extract::{Query, State};
use axum::response::Redirect;
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, SameSite};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use diesel::prelude::*;
use diesel::upsert::excluded;
use diesel_async::RunQueryDsl;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::config::FortyTwo;
use crate::error::AppError;
use crate::models::User;
use crate::schema::users;
use crate::session;

/// Holds `state.pkce_verifier.issued_unix_secs` between /login and /callback.
const OAUTH_COOKIE: &str = "__Host-oauth";
/// How long the user has to finish logging in on 42
const OAUTH_MAX_AGE_SECS: i64 = 600;

fn config(state: &AppState) -> Result<&FortyTwo, AppError> {
    state.config.forty_two.as_ref().ok_or(AppError::NotFound)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Deserialize, Default)]
pub struct LoginQuery {
    /// `admin` when the login started on the admin subdomain (issue #9): the callback
    /// must land there or the host-only session cookie is set on the wrong host.
    surface: Option<String>,
}

fn is_admin_surface(surface: Option<&str>) -> bool {
    surface == Some("admin")
}

fn redirect_uri_for(ft: &FortyTwo, admin: bool) -> Result<&str, AppError> {
    if admin {
        ft.admin_redirect_uri.as_deref().ok_or(AppError::NotFound)
    } else {
        Ok(ft.redirect_uri.as_str())
    }
}

/// GET /api/auth/42/login — redirects to 42's consent page.
/// `?surface=admin` (from the admin subdomain) uses the admin redirect URI, which
/// must also be registered in the 42 app; otherwise the callback — and the
/// host-only `__Host-session` cookie — would land on the student host.
pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<LoginQuery>,
) -> Result<(CookieJar, Redirect), AppError> {
    let ft = config(&state)?;
    let admin = is_admin_surface(query.surface.as_deref());
    let redirect_uri = redirect_uri_for(ft, admin)?;
    let csrf_state = session::random_token();
    let verifier = session::random_token();
    let url = reqwest::Url::parse_with_params(
        &format!("{}/oauth/authorize", ft.api_base),
        [
            ("client_id", ft.client_id.as_str()),
            ("redirect_uri", redirect_uri),
            ("response_type", "code"),
            ("scope", "public"),
            ("state", csrf_state.as_str()),
            ("code_challenge", pkce_challenge(&verifier).as_str()),
            ("code_challenge_method", "S256"),
        ],
    )
    .map_err(anyhow::Error::from)?;
    let issued = chrono::Utc::now().timestamp();
    let surface = if admin { "a" } else { "s" };
    let cookie = Cookie::build((
        OAUTH_COOKIE,
        format!("{csrf_state}.{verifier}.{issued}.{surface}"),
    ))
    .path("/")
    .secure(true)
    .http_only(true)
    // Lax: the callback is a top-level navigation coming back from 42
    .same_site(SameSite::Lax)
    .build();
    Ok((jar.add(cookie), Redirect::to(url.as_str())))
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct CampusUser {
    campus_id: i64,
    #[serde(default)]
    is_primary: bool,
}

#[derive(Deserialize)]
struct IntraMe {
    id: i64,
    login: String,
    usual_full_name: Option<String>,
    displayname: Option<String>,
    #[serde(default)]
    campus_users: Vec<CampusUser>,
}

/// Primary campus only: other entries include piscines and campuses the student left.
fn is_campus_member(campus_users: &[CampusUser], campus_id: i64) -> bool {
    campus_users
        .iter()
        .any(|c| c.campus_id == campus_id && c.is_primary)
}

/// Why a login failed; the code goes to `/login?error=`.
enum Failure {
    Denied,
    State,
    NotCampusMember,
    StaffOnly,
    Failed(anyhow::Error),
}

impl Failure {
    fn code(&self) -> &'static str {
        match self {
            Self::Denied => "oauth_denied",
            Self::State => "oauth_state",
            Self::NotCampusMember => "not_campus_member",
            Self::StaffOnly => "staff_only",
            Self::Failed(_) => "oauth_failed",
        }
    }
}

impl<E: Into<anyhow::Error>> From<E> for Failure {
    fn from(e: E) -> Self {
        Self::Failed(e.into())
    }
}

/// GET /api/auth/42/callback
pub async fn callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<CallbackQuery>,
) -> Result<(CookieJar, Redirect), AppError> {
    let ft = config(&state)?;
    let stored = jar.get(OAUTH_COOKIE).map(|c| c.value().to_owned());
    let mut removal = Cookie::build((OAUTH_COOKIE, ""))
        .path("/")
        .secure(true)
        .build();
    removal.make_removal();
    let jar = jar.add(removal);

    match complete(&state, ft, &jar, stored, query).await {
        Ok(tokens) => Ok((session::set_cookies(jar, tokens), Redirect::to("/"))),
        Err(failure) => {
            match &failure {
                Failure::Failed(e) => tracing::warn!("42 login failed: {e:#}"),
                other => tracing::info!("42 login rejected: {}", other.code()),
            }
            Ok((
                jar,
                Redirect::to(&format!("/login?error={}", failure.code())),
            ))
        }
    }
}

async fn complete(
    state: &AppState,
    ft: &FortyTwo,
    jar: &CookieJar,
    stored: Option<String>,
    query: CallbackQuery,
) -> Result<session::Tokens, Failure> {
    if query.error.is_some() {
        return Err(Failure::Denied);
    }
    let mut parts = stored.as_deref().unwrap_or_default().split('.');
    let (Some(expected_state), Some(verifier), Some(issued)) =
        (parts.next(), parts.next(), parts.next())
    else {
        return Err(Failure::State);
    };
    // 4th segment (added in issue #9) names the surface; old 3-part cookies are student.
    let admin = match (parts.next(), parts.next()) {
        (None, None) => false,
        (Some("s"), None) => false,
        (Some("a"), None) => true,
        _ => return Err(Failure::State),
    };
    let redirect_uri = redirect_uri_for(ft, admin).map_err(|_| Failure::State)?;
    let age = chrono::Utc::now().timestamp() - issued.parse::<i64>().map_err(|_| Failure::State)?;
    if !(0..=OAUTH_MAX_AGE_SECS).contains(&age) {
        return Err(Failure::State);
    }
    let (Some(code), Some(got_state)) = (query.code, query.state) else {
        return Err(Failure::State);
    };
    // compare hashes so the check takes the same time however much matches
    if session::hash(&got_state) != session::hash(expected_state) {
        return Err(Failure::State);
    }

    let token: TokenResponse = state
        .http
        .post(format!("{}/oauth/token", ft.api_base))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", ft.client_id.as_str()),
            ("client_secret", ft.client_secret.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri),
            ("code_verifier", verifier),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let me: IntraMe = state
        .http
        .get(format!("{}/v2/me", ft.api_base))
        .bearer_auth(&token.access_token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    drop(token); // the 42 token is never stored

    if !is_campus_member(&me.campus_users, ft.campus_id) {
        return Err(Failure::NotCampusMember);
    }
    let display_name = me
        .usual_full_name
        .or(me.displayname)
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| me.login.clone());

    // Staff roles come only from STAFF_ROLE_ALLOWLIST (issue #9): resolved here and
    // nowhere else, so removing a login from the list revokes the role at next login.
    let role = crate::config::resolve_role(&me.login, &state.config.staff_allowlist);
    if admin && role == Role::Student {
        // A student who logs in on the admin subdomain gets no session there:
        // the host-only cookie would otherwise strand a student session on admin.
        return Err(Failure::StaffOnly);
    }
    let mut conn = state.pool.get().await?;
    // keyed on the 42 user id; login and name follow 42.
    let user: User = diesel::insert_into(users::table)
        .values((
            users::intra_id.eq(me.id),
            users::login.eq(&me.login),
            users::display_name.eq(&display_name),
            users::role.eq(role),
            users::is_demo.eq(false),
        ))
        .on_conflict(users::intra_id)
        .do_update()
        .set((
            users::login.eq(excluded(users::login)),
            users::display_name.eq(excluded(users::display_name)),
            users::role.eq(excluded(users::role)),
        ))
        .returning(User::as_returning())
        .get_result(&mut conn)
        .await?;
    session::destroy(&mut conn, jar)
        .await
        .map_err(|_| anyhow::anyhow!("destroying the previous session failed"))?;
    let tokens = session::create(&mut conn, user.id)
        .await
        .map_err(|_| Failure::Failed(anyhow::anyhow!("creating the session failed")))?;
    tracing::info!(user_id = user.id, intra_id = me.id, "42 login");
    Ok(tokens)
}

#[derive(serde::Serialize)]
pub struct Methods {
    forty_two: bool,
    demo: bool,
}

/// GET /api/auth/methods — which login buttons U01 should show.
pub async fn methods(State(state): State<AppState>) -> axum::Json<Methods> {
    axum::Json(Methods {
        forty_two: state.config.forty_two.is_some(),
        demo: state.config.demo_login_enabled,
    })
}

#[cfg(test)]
mod tests {
    use super::{CampusUser, is_admin_surface, is_campus_member, pkce_challenge, redirect_uri_for};
    use crate::config::FortyTwo;

    #[test]
    fn admin_surface_needs_admin_redirect_uri() {
        let ft = FortyTwo {
            client_id: "id".into(),
            client_secret: "s".into(),
            redirect_uri: "http://localhost:4200/api/auth/42/callback".into(),
            admin_redirect_uri: Some("http://localhost:4201/api/auth/42/callback".into()),
            campus_id: 69,
            api_base: "https://api.intra.42.fr".into(),
        };
        assert!(is_admin_surface(Some("admin")));
        assert!(!is_admin_surface(None));
        assert!(!is_admin_surface(Some("student")));
        assert_eq!(
            redirect_uri_for(&ft, true).ok(),
            Some("http://localhost:4201/api/auth/42/callback")
        );
        assert_eq!(
            redirect_uri_for(&ft, false).ok(),
            Some("http://localhost:4200/api/auth/42/callback")
        );
    }

    fn campuses(json: &str) -> Vec<CampusUser> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn only_the_primary_campus_counts() {
        assert!(is_campus_member(
            &campuses(r#"[{"campus_id":69,"is_primary":true}]"#),
            69
        ));
        // a Seoul student who did the piscine in Gyeongsan
        let piscine =
            campuses(r#"[{"campus_id":29,"is_primary":true},{"campus_id":69,"is_primary":false}]"#);
        assert!(!is_campus_member(&piscine, 69));
        // is_primary missing counts as not primary
        assert!(!is_campus_member(&campuses(r#"[{"campus_id":69}]"#), 69));
        assert!(!is_campus_member(&[], 69));
    }

    #[test]
    fn pkce_challenge_is_base64url_sha256() {
        // expected value from: printf '%s' <verifier> | openssl dgst -sha256 -binary
        //   | openssl base64 | tr '+/' '-_' | tr -d '='
        assert_eq!(
            pkce_challenge("otus-pkce-test-verifier-0123456789abcdefghijklmn"),
            "xFp8iBYKzhVh027-TEq-cj-ooG2ozmdER9vfafUbNoM"
        );
    }
}
