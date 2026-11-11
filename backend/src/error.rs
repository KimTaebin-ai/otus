use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// API errors, serialized as `{ "error": { "code", "message" } }` with the codes in api.md.
/// Internal errors are logged in full but only a generic message reaches the client.
#[allow(dead_code)] // variants are used as the api.md endpoints land
pub enum AppError {
    InvalidRequest(String),
    Unauthorized,
    Forbidden,
    NotFound,
    InvalidState(String),
    FileTooLarge,
    NotPdf,
    CycleClosed,
    DocTypeNotAllowed,
    MalwareDetected,
    ScanUnavailable,
    RateLimited { retry_after: u64 },
    Internal(anyhow::Error),
}

impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(e: E) -> Self {
        Self::Internal(e.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let Self::RateLimited { retry_after } = self {
            let body = Json(json!({ "error": {
                "code": "RATE_LIMITED",
                "message": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            } }));
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [(axum::http::header::RETRY_AFTER, retry_after.to_string())],
                body,
            )
                .into_response();
        }
        let (status, code, message) = match self {
            Self::InvalidRequest(m) => (StatusCode::BAD_REQUEST, "INVALID_REQUEST", m),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "로그인이 필요합니다.".into(),
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "요청을 처리할 권한이 없습니다.".into(),
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "찾을 수 없습니다.".into(),
            ),
            Self::InvalidState(m) => (StatusCode::CONFLICT, "INVALID_STATE", m),
            Self::FileTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "FILE_TOO_LARGE",
                "파일 용량이 너무 큽니다.".into(),
            ),
            Self::NotPdf => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "NOT_PDF",
                "PDF 파일만 업로드할 수 있습니다.".into(),
            ),
            Self::CycleClosed => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "CYCLE_CLOSED",
                "접수 기간이 아닙니다.".into(),
            ),
            Self::DocTypeNotAllowed => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "DOC_TYPE_NOT_ALLOWED",
                "이 제출에 필요한 서류가 아닙니다.".into(),
            ),
            Self::MalwareDetected => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "MALWARE_DETECTED",
                "악성코드가 발견되어 올릴 수 없습니다.".into(),
            ),
            Self::ScanUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "SCAN_UNAVAILABLE",
                "파일 검사를 할 수 없습니다. 잠시 후 다시 시도해 주세요.".into(),
            ),
            Self::RateLimited { .. } => unreachable!("handled above"),
            Self::Internal(e) => {
                tracing::error!("{e:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "서버 오류가 발생했습니다.".into(),
                )
            }
        };
        let body = Json(json!({ "error": { "code": code, "message": message } }));
        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body_of(e: AppError) -> (StatusCode, serde_json::Value) {
        let res = e.into_response();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn error_body_matches_api_md() {
        let (status, body) = body_of(AppError::CycleClosed).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"]["code"], "CYCLE_CLOSED");
        assert_eq!(body["error"]["message"], "접수 기간이 아닙니다.");
    }

    #[tokio::test]
    async fn internal_error_hides_details() {
        let (status, body) = body_of(anyhow::anyhow!("db password=secret").into()).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!body.to_string().contains("secret"));
    }
}
