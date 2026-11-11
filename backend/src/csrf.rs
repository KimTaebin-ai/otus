use axum::extract::{Request, State};
use axum::http::header::ORIGIN;
use axum::middleware::Next;
use axum::response::Response;

use crate::AppState;
use crate::error::AppError;
use crate::session::is_safe_method;

/// Rejects state-changing requests whose Origin isn't one of APP_ORIGIN(S) (student + admin). This also covers
/// endpoints without a session yet (login CSRF on demo-login).
pub async fn require_same_origin(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    if !is_safe_method(req.method()) {
        let origin_ok = req.headers().get(ORIGIN).is_some_and(|o| {
            state
                .config
                .app_origins
                .iter()
                .any(|allowed| o.as_bytes() == allowed.as_bytes())
        });
        if !origin_ok {
            return Err(AppError::Forbidden);
        }
    }
    Ok(next.run(req).await)
}
