//! Server notifications (issue #10): the bell reads these, not localStorage.
//! The server sends `kind` + `data` only; wording lives in FE.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppState;
use crate::error::AppError;
use crate::kst;
use crate::models::Notification;
use crate::schema::notifications;
use crate::session::CurrentUser;

/// Insert unless an identical (user, kind, data) row already exists — this is what makes
/// `hours_projected` fire once per month per tier. With `email`, a copy is queued in the same
/// transaction (the worker in `mail.rs` sends it); nothing is queued when the notification
/// already existed.
pub async fn notify_once(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    kind: &str,
    data: Value,
    email: Option<crate::mail::EventMail>,
) -> Result<bool, AppError> {
    let data_text = data.to_string();
    let exists: Option<i64> = notifications::table
        .filter(notifications::user_id.eq(user_id))
        .filter(notifications::kind.eq(kind))
        .filter(notifications::data.eq(&data_text))
        .select(notifications::id)
        .first(conn)
        .await
        .optional()?;
    if exists.is_some() {
        return Ok(false);
    }
    let notification_id: i64 = diesel::insert_into(notifications::table)
        .values((
            notifications::user_id.eq(user_id),
            notifications::kind.eq(kind),
            notifications::data.eq(data_text),
        ))
        .returning(notifications::id)
        .get_result(conn)
        .await?;
    if let Some(email) = email {
        diesel::sql_query(
            "INSERT INTO event_emails (user_id, notification_id, subject, body) VALUES ($1, $2, $3, $4)",
        )
        .bind::<diesel::sql_types::BigInt, _>(user_id)
        .bind::<diesel::sql_types::BigInt, _>(notification_id)
        .bind::<diesel::sql_types::Text, _>(email.subject)
        .bind::<diesel::sql_types::Text, _>(email.body)
        .execute(conn)
        .await?;
    }
    Ok(true)
}

#[derive(Deserialize)]
pub struct ListQuery {
    limit: Option<i64>,
    before: Option<i64>,
}

#[derive(Serialize)]
pub struct NotificationView {
    id: i64,
    kind: String,
    #[serde(serialize_with = "kst::serialize")]
    created_at: chrono::DateTime<chrono::Utc>,
    #[serde(serialize_with = "kst::serialize_opt")]
    read_at: Option<chrono::DateTime<chrono::Utc>>,
    data: Value,
}

impl From<Notification> for NotificationView {
    fn from(n: Notification) -> Self {
        Self {
            id: n.id,
            kind: n.kind,
            created_at: n.created_at,
            read_at: n.read_at,
            // only this module writes `data`, always via serde_json
            data: serde_json::from_str(&n.data).unwrap_or(Value::Null),
        }
    }
}

#[derive(Serialize)]
pub struct ListResponse {
    items: Vec<NotificationView>,
    next_before: Option<i64>,
}

/// GET /api/notifications — newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<ListResponse>, AppError> {
    let limit = q.limit.unwrap_or(20).clamp(1, 50);
    let mut conn = state.pool.get().await?;
    let mut query = notifications::table
        .filter(notifications::user_id.eq(user.id))
        .into_boxed();
    if let Some(before) = q.before {
        query = query.filter(notifications::id.lt(before));
    }
    let rows: Vec<Notification> = query
        .order(notifications::id.desc())
        .limit(limit + 1)
        .select(Notification::as_select())
        .load(&mut conn)
        .await?;
    let next_before = (rows.len() as i64 > limit).then(|| rows[limit as usize - 1].id);
    Ok(Json(ListResponse {
        items: rows
            .into_iter()
            .take(limit as usize)
            .map(NotificationView::from)
            .collect(),
        next_before,
    }))
}

#[derive(Serialize)]
pub struct UnreadCount {
    count: i64,
}

/// GET /api/notifications/unread-count — kept to one indexed count.
pub async fn unread_count(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<UnreadCount>, AppError> {
    let mut conn = state.pool.get().await?;
    let count: i64 = notifications::table
        .filter(notifications::user_id.eq(user.id))
        .filter(notifications::read_at.is_null())
        .count()
        .get_result(&mut conn)
        .await?;
    Ok(Json(UnreadCount { count }))
}

/// POST /api/notifications/{id}/read — idempotent; another user's id is 404.
pub async fn read_one(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id: i64 = id.parse().map_err(|_| AppError::NotFound)?;
    let mut conn = state.pool.get().await?;
    let updated = diesel::update(
        notifications::table
            .find(id)
            .filter(notifications::user_id.eq(user.id)),
    )
    .set(notifications::read_at.eq(chrono::Utc::now()))
    .execute(&mut conn)
    .await?;
    if updated == 0 {
        // already read (update still counts the row) or genuinely absent: the row
        // count above is 1 for an existing own row even when read_at was set, so
        // 0 means absent / not ours.
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/notifications/read-all
pub async fn read_all(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<StatusCode, AppError> {
    let mut conn = state.pool.get().await?;
    diesel::update(
        notifications::table
            .filter(notifications::user_id.eq(user.id))
            .filter(notifications::read_at.is_null()),
    )
    .set(notifications::read_at.eq(chrono::Utc::now()))
    .execute(&mut conn)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
