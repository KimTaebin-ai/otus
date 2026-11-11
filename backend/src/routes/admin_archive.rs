//! Staff monthly archive and accountant-only, owner-bound encrypted ZIP jobs.

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::Response;
use diesel_async::{AsyncConnection, RunQueryDsl};
use uuid::Uuid;

use crate::AppState;
use crate::archive::{
    self, ArchiveFilters, ArchiveView, CreatedExport, ExportRequest, ExportStatus,
};
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::routes::submissions::parse_id;
use crate::session::{CurrentUser, require_staff};

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(month): Path<String>,
    query: Result<Query<ArchiveFilters>, QueryRejection>,
) -> Result<Json<ArchiveView>, AppError> {
    require_staff(&user)?;
    let month = archive::parse_month(&month)?;
    let Query(mut filters) =
        query.map_err(|_| AppError::InvalidRequest("query 형식이 올바르지 않습니다.".into()))?;
    filters.validate()?;
    let mut conn = state.pool.get().await?;
    let view = conn
        .transaction::<_, AppError, _>(async move |conn| {
            diesel::sql_query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                .execute(conn)
                .await?;
            archive::view(conn, month, &filters).await
        })
        .await?;
    Ok(Json(view))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(month): Path<String>,
    headers: HeaderMap,
    ApiJson(request): ApiJson<ExportRequest>,
) -> Result<(StatusCode, Json<CreatedExport>), AppError> {
    archive::require_accountant(user.role)?;
    let month = archive::parse_month(&month)?;
    let key = headers
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            AppError::InvalidRequest("Idempotency-Key UUID 헤더가 필요합니다.".into())
        })?;
    Ok((
        StatusCode::ACCEPTED,
        Json(archive::create(state, user.id, month, key, request).await?),
    ))
}

pub async fn status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((month, id)): Path<(String, String)>,
) -> Result<Json<ExportStatus>, AppError> {
    archive::require_accountant(user.role)?;
    let month = archive::parse_month(&month)?;
    let id = parse_id(&id)?;
    let mut conn = state.pool.get().await?;
    Ok(Json(
        archive::get_job(&mut conn, user.id, month, id)
            .await?
            .status_response(),
    ))
}

pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((month, id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    archive::require_accountant(user.role)?;
    let month = archive::parse_month(&month)?;
    let id = parse_id(&id)?;
    let (body, size) = archive::download(&state, user.id, month, id).await?;
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&size.to_string()).map_err(anyhow::Error::from)?,
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&content_disposition(&archive::zip_name(month)))
            .map_err(anyhow::Error::from)?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, private"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    Ok(response)
}

fn content_disposition(name: &str) -> String {
    let encoded = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect::<String>();
    format!("attachment; filename=\"download.zip\"; filename*=UTF-8''{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zip_filename_uses_ascii_fallback_and_encoded_utf8() {
        let value = content_disposition("2026년 9월_지원금 자료.zip");
        assert!(value.starts_with(
            "attachment; filename=\"download.zip\"; filename*=UTF-8''2026%EB%85%84%209"
        ));
        let hostile = content_disposition("a\r\n\".zip");
        assert!(hostile.contains("a%0D%0A%22.zip"));
        assert!(!hostile.contains('\n'));
    }
}
