use axum::Json;
use axum::extract::{FromRequest, Request};
use serde::de::DeserializeOwned;

use crate::error::AppError;

/// `Json` whose rejections use the api.md error body instead of axum's plain text.
pub struct ApiJson<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for ApiJson<T> {
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, AppError> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(e) => {
                tracing::debug!("rejected JSON body: {}", e.body_text());
                Err(AppError::InvalidRequest(
                    "요청 형식이 올바르지 않습니다.".into(),
                ))
            }
        }
    }
}
