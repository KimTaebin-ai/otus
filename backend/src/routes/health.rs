use axum::Json;
use axum::extract::State;
use diesel_async::RunQueryDsl;
use serde_json::{Value, json};

use crate::AppState;
use crate::error::AppError;

/// Liveness plus a database round-trip; used by the pod's health check. `scanner` tells
/// whether uploads can be accepted: clamd answers only once its signatures are loaded.
pub async fn health(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let mut conn = state.pool.get().await?;
    diesel::sql_query("SELECT 1").execute(&mut conn).await?;
    let scanner = match &state.scanner {
        None => "disabled",
        Some(s) if s.ready().await => "ready",
        Some(_) => "unavailable",
    };
    Ok(Json(json!({ "status": "ok", "scanner": scanner })))
}
