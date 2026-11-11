//! Staff review queue and atomic decisions. A completed supplement replaces its
//! ancestors in the queue; reading the same submission never reserves it.

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::result::{DatabaseErrorKind, Error as DieselError};
use diesel::sql_types::{Array, BigInt, Bool, Date, Nullable, Text, Timestamptz};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::AppState;
use crate::admin_data::REVIEW_SCOPE_CTE;
use crate::admin_revision::{self, PreparedRevision};
use crate::domain::{DocType, Kind, Role, Status, non_null};
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::kst;
use crate::models::{NewSubmissionEvent, Submission, SubmissionFile};
use crate::routes::notifications::notify_once;
use crate::routes::submissions::{SubmissionView, parse_id};
use crate::schema::{submission_events, submission_files, submissions, users};
use crate::session::CurrentUser;

fn require_reviewer(role: Role) -> Result<(), AppError> {
    if role.can_view_originals() {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

#[derive(Deserialize)]
pub struct QueueQuery {
    month: Option<String>,
    limit: Option<i64>,
    after: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct Cursor {
    month: NaiveDate,
    at: DateTime<Utc>,
    id: Uuid,
}

impl Cursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?))
    }

    fn parse(value: &str, month: NaiveDate) -> Result<Self, AppError> {
        let bad = || AppError::InvalidRequest("after 커서가 올바르지 않습니다.".into());
        if value.len() > 512 {
            return Err(bad());
        }
        let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| bad())?;
        let cursor: Self = serde_json::from_slice(&bytes).map_err(|_| bad())?;
        if cursor.month != month {
            return Err(bad());
        }
        Ok(cursor)
    }
}

fn parse_month(month: Option<&str>) -> Result<NaiveDate, AppError> {
    match month {
        Some(value) => {
            let canonical = value.len() == 7
                && value.bytes().enumerate().all(|(index, byte)| {
                    if index == 4 {
                        byte == b'-'
                    } else {
                        byte.is_ascii_digit()
                    }
                });
            canonical
                .then(|| kst::parse_month(value))
                .flatten()
                .ok_or_else(|| AppError::InvalidRequest("month는 YYYY-MM이어야 합니다.".into()))
        }
        None => Ok(kst::current_month(Utc::now())),
    }
}

#[derive(QueryableByName)]
struct QueueRow {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    id: Uuid,
    #[diesel(sql_type = BigInt)]
    user_id: i64,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    login: String,
    #[diesel(sql_type = Bool)]
    employed: bool,
    #[diesel(sql_type = Nullable<Text>)]
    ordinal: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    ko_name: Option<String>,
    #[diesel(sql_type = Nullable<Date>)]
    date_of_birth: Option<NaiveDate>,
    #[diesel(sql_type = Text)]
    kind: Kind,
    #[diesel(sql_type = Date)]
    target_month: NaiveDate,
    #[diesel(sql_type = Text)]
    status: Status,
    #[diesel(sql_type = Timestamptz)]
    submitted_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct QueueUser {
    id: i64,
    name: String,
    login: String,
    employed: bool,
    ordinal: Option<String>,
    ko_name: Option<String>,
    date_of_birth: Option<NaiveDate>,
}

#[derive(Serialize)]
pub struct QueueItem {
    id: Uuid,
    user: QueueUser,
    kind: Kind,
    #[serde(serialize_with = "kst::serialize_month")]
    target_month: NaiveDate,
    status: Status,
    #[serde(serialize_with = "kst::serialize")]
    submitted_at: DateTime<Utc>,
}

impl From<QueueRow> for QueueItem {
    fn from(row: QueueRow) -> Self {
        Self {
            id: row.id,
            user: QueueUser {
                id: row.user_id,
                name: row.name,
                login: row.login,
                employed: row.employed,
                ordinal: row.ordinal,
                ko_name: row.ko_name,
                date_of_birth: row.date_of_birth,
            },
            kind: row.kind,
            target_month: row.target_month,
            status: row.status,
            submitted_at: row.submitted_at,
        }
    }
}

#[derive(Serialize)]
pub struct QueueResponse {
    #[serde(serialize_with = "kst::serialize_month")]
    month: NaiveDate,
    items: Vec<QueueItem>,
    next_after: Option<String>,
}

/// GET /api/admin/review-queue — pending leaves, oldest receipt first.
pub async fn queue(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<QueueQuery>, QueryRejection>,
) -> Result<Json<QueueResponse>, AppError> {
    require_reviewer(user.role)?;
    let Query(query) =
        query.map_err(|_| AppError::InvalidRequest("조회 조건이 올바르지 않습니다.".into()))?;
    let month = parse_month(query.month.as_deref())?;
    let limit = query.limit.unwrap_or(20);
    if !(1..=50).contains(&limit) {
        return Err(AppError::InvalidRequest(
            "limit는 1~50이어야 합니다.".into(),
        ));
    }
    let cursor = query
        .after
        .as_deref()
        .map(|value| Cursor::parse(value, month))
        .transpose()?;
    let mut conn = state.pool.get().await?;
    let mut rows: Vec<QueueRow> = diesel::sql_query(format!(
        "{REVIEW_SCOPE_CTE}
         SELECT s.id, s.user_id, u.display_name AS name, u.login, u.employed,
                u.ordinal, u.ko_name, u.date_of_birth,
                s.kind, s.target_month, s.status, s.submitted_at
         FROM submissions s JOIN users u ON u.id = s.user_id
         JOIN review_scope scope ON scope.id = s.id
         WHERE u.role = 'student' AND s.target_month = $1
           AND s.status IN ('pending_review', 'resubmitted')
           AND NOT EXISTS (SELECT 1 FROM submissions child
                           WHERE child.parent_id = s.id AND child.status <> 'draft')
           AND ($2::timestamptz IS NULL OR (s.submitted_at, s.id) > ($2, $3))
         ORDER BY s.submitted_at, s.id LIMIT $4"
    ))
    .bind::<Date, _>(month)
    .bind::<Nullable<Timestamptz>, _>(cursor.as_ref().map(|c| c.at))
    .bind::<Nullable<diesel::sql_types::Uuid>, _>(cursor.as_ref().map(|c| c.id))
    .bind::<BigInt, _>(limit + 1)
    .load(&mut conn)
    .await?;
    let next_after = if rows.len() > limit as usize {
        rows.truncate(limit as usize);
        let row = rows.last().expect("positive queue limit");
        Some(
            Cursor {
                month,
                at: row.submitted_at,
                id: row.id,
            }
            .encode()?,
        )
    } else {
        None
    };
    Ok(Json(QueueResponse {
        month,
        items: rows.into_iter().map(Into::into).collect(),
        next_after,
    }))
}

#[derive(Deserialize)]
pub struct NavigationQuery {
    month: Option<String>,
}

#[derive(QueryableByName, Serialize)]
pub struct NavigationResponse {
    #[diesel(sql_type = Nullable<diesel::sql_types::Uuid>)]
    previous_id: Option<Uuid>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Uuid>)]
    next_id: Option<Uuid>,
    #[diesel(sql_type = BigInt)]
    remaining_count: i64,
}

/// A processed submission remains a usable pivot. Both neighbors are still
/// waiting for review, so previous never reopens an already completed decision.
pub async fn navigation(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    query: Result<Query<NavigationQuery>, QueryRejection>,
) -> Result<Json<NavigationResponse>, AppError> {
    require_reviewer(user.role)?;
    let id = parse_id(&id)?;
    let Query(query) =
        query.map_err(|_| AppError::InvalidRequest("조회 조건이 올바르지 않습니다.".into()))?;
    let requested_month = parse_month(query.month.as_deref())?;
    let mut conn = state.pool.get().await?;
    let (month, at): (NaiveDate, Option<DateTime<Utc>>) = submissions::table
        .inner_join(users::table)
        .filter(submissions::id.eq(id))
        .filter(submissions::status.ne(Status::Draft))
        .filter(users::role.eq(Role::Student))
        .select((submissions::target_month, submissions::submitted_at))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or(AppError::NotFound)?;
    if requested_month != month {
        return Err(AppError::NotFound);
    }
    let at = at.ok_or_else(|| anyhow::anyhow!("non-draft submission has no receipt time"))?;
    let result = diesel::sql_query(format!(
        "{REVIEW_SCOPE_CTE}, waiting AS (
           SELECT s.id, s.submitted_at FROM submissions s
           JOIN users u ON u.id = s.user_id
           JOIN review_scope scope ON scope.id = s.id
           WHERE s.target_month = $1 AND u.role = 'student'
             AND s.status IN ('pending_review', 'resubmitted')
             AND NOT EXISTS (SELECT 1 FROM submissions child
                             WHERE child.parent_id = s.id AND child.status <> 'draft')
         )
         SELECT
           (SELECT id FROM waiting WHERE (submitted_at, id) < ($2, $3)
            ORDER BY submitted_at DESC, id DESC LIMIT 1) AS previous_id,
           (SELECT id FROM waiting WHERE (submitted_at, id) > ($2, $3)
            ORDER BY submitted_at, id LIMIT 1) AS next_id,
           (SELECT count(*) FROM waiting WHERE id <> $3) AS remaining_count"
    ))
    .bind::<Date, _>(month)
    .bind::<Timestamptz, _>(at)
    .bind::<diesel::sql_types::Uuid, _>(id)
    .get_result(&mut conn)
    .await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewRequest {
    status: String,
    review_comment: Option<String>,
    revision_doc_types: Option<Vec<String>>,
}

enum Decision {
    Approved,
    Revision(PreparedRevision),
}

impl Decision {
    fn prepare(body: ReviewRequest) -> Result<Self, AppError> {
        let doc_types = body.revision_doc_types.unwrap_or_default();
        match body.status.as_str() {
            "approved" => {
                if body
                    .review_comment
                    .as_deref()
                    .is_some_and(|s| !s.trim().is_empty())
                    || !doc_types.is_empty()
                {
                    return Err(AppError::InvalidRequest(
                        "승인에는 보완 사유나 보완 서류를 지정할 수 없습니다.".into(),
                    ));
                }
                Ok(Self::Approved)
            }
            "revision_requested" => Ok(Self::Revision(admin_revision::prepare(
                body.review_comment.as_deref(),
                &doc_types,
            )?)),
            _ => Err(AppError::InvalidRequest(
                "status는 approved 또는 revision_requested여야 합니다.".into(),
            )),
        }
    }

    fn status(&self) -> Status {
        match self {
            Self::Approved => Status::Approved,
            Self::Revision(_) => Status::RevisionRequested,
        }
    }

    fn comment(&self) -> Option<&str> {
        match self {
            Self::Approved => None,
            Self::Revision(request) => Some(&request.review_comment),
        }
    }

    fn doc_types(&self) -> &[DocType] {
        match self {
            Self::Approved => &[],
            Self::Revision(request) => &request.revision_doc_types,
        }
    }

    fn fingerprint(&self) -> String {
        let normalized = json!({
            "status": self.status(),
            "review_comment": self.comment(),
            "revision_doc_types": self.doc_types(),
        });
        URL_SAFE_NO_PAD.encode(Sha256::digest(normalized.to_string().as_bytes()))
    }
}

#[derive(QueryableByName)]
struct RecordedDecision {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    submission_id: Uuid,
    #[diesel(sql_type = BigInt)]
    actor_user_id: i64,
    #[diesel(sql_type = Text)]
    request_fingerprint: String,
    #[diesel(sql_type = Text)]
    response_json: String,
}

impl RecordedDecision {
    fn replay(&self, id: Uuid, actor: i64, fingerprint: &str) -> Result<Value, AppError> {
        if self.submission_id != id
            || self.actor_user_id != actor
            || self.request_fingerprint != fingerprint
        {
            return Err(key_conflict());
        }
        Ok(serde_json::from_str(&self.response_json)?)
    }
}

fn key_conflict() -> AppError {
    AppError::InvalidState("이미 다른 요청에 쓴 Idempotency-Key입니다.".into())
}

fn idempotency_key(headers: &HeaderMap) -> Result<Uuid, AppError> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| AppError::InvalidRequest("Idempotency-Key 헤더(UUID)가 필요합니다.".into()))
}

#[derive(Serialize)]
struct Reviewer {
    name: String,
    role: Role,
}

#[derive(Serialize)]
struct ReviewResponse {
    #[serde(flatten)]
    submission: SubmissionView,
    reviewed_by: Reviewer,
    #[serde(serialize_with = "kst::serialize")]
    reviewed_at: DateTime<Utc>,
}

/// POST /api/admin/submissions/{id}/review. The owner lock serializes finalizing
/// supplements with decisions; the submission lock makes concurrent retries wait.
pub async fn review(
    State(state): State<AppState>,
    CurrentUser(actor): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<ReviewRequest>,
) -> Result<Json<Value>, AppError> {
    require_reviewer(actor.role)?;
    let id = parse_id(&id)?;
    let key = idempotency_key(&headers)?;
    let decision = Decision::prepare(body)?;
    let fingerprint = decision.fingerprint();
    // Acquire the bounded I/O slot before taking any database locks.
    let _permit = if matches!(decision, Decision::Approved) {
        Some(
            state
                .heavy_io
                .acquire()
                .await
                .map_err(anyhow::Error::from)?,
        )
    } else {
        None
    };
    let mut conn = state.pool.get().await?;
    let state_ref = &state;
    let result = conn
        .transaction::<_, AppError, _>(async move |conn| {
            let owner: i64 = submissions::table
                .inner_join(users::table)
                .filter(submissions::id.eq(id))
                .filter(submissions::status.ne(Status::Draft))
                .filter(users::role.eq(Role::Student))
                .select(submissions::user_id)
                .first(conn)
                .await
                .optional()?
                .ok_or(AppError::NotFound)?;
            users::table
                .find(owner)
                .filter(users::role.eq(Role::Student))
                .for_update()
                .select(users::id)
                .first::<i64>(conn)
                .await
                .optional()?
                .ok_or(AppError::NotFound)?;
            let sub: Submission = submissions::table
                .find(id)
                .filter(submissions::user_id.eq(owner))
                .filter(submissions::status.ne(Status::Draft))
                .for_update()
                .select(Submission::as_select())
                .first(conn)
                .await
                .optional()?
                .ok_or(AppError::NotFound)?;

            let prior: Option<RecordedDecision> = diesel::sql_query(
                "SELECT submission_id, actor_user_id, request_fingerprint, response_json
             FROM admin_review_decisions WHERE idempotency_key = $1",
            )
            .bind::<diesel::sql_types::Uuid, _>(key)
            .get_result(conn)
            .await
            .optional()?;
            if let Some(prior) = prior {
                return prior.replay(id, actor.id, &fingerprint);
            }
            let key_used: bool = diesel::select(diesel::dsl::exists(
                submission_events::table.filter(submission_events::idempotency_key.eq(key)),
            ))
            .get_result(conn)
            .await?;
            if key_used {
                return Err(key_conflict());
            }
            if !matches!(sub.status, Status::PendingReview | Status::Resubmitted) {
                return Err(AppError::InvalidState(
                    "검토 대기 중인 제출만 처리할 수 있습니다.".into(),
                ));
            }
            let has_completed_child: bool = diesel::select(diesel::dsl::exists(
                submissions::table
                    .filter(submissions::parent_id.eq(id))
                    .filter(submissions::status.ne(Status::Draft)),
            ))
            .get_result(conn)
            .await?;
            if has_completed_child {
                return Err(AppError::InvalidState(
                    "최신 보완 제출을 검토해주세요.".into(),
                ));
            }

            let propagated_events = match &decision {
                Decision::Approved => approve(state_ref, conn, &sub, owner, actor.id).await?,
                Decision::Revision(request) => {
                    admin_revision::apply(conn, &sub, request).await?;
                    Vec::new()
                }
            };
            let (event_id, at): (i64, DateTime<Utc>) =
                diesel::insert_into(submission_events::table)
                    .values(NewSubmissionEvent {
                        submission_id: id,
                        from_status: Some(sub.status),
                        to_status: decision.status(),
                        actor_user_id: actor.id,
                        idempotency_key: Some(key),
                        note: decision.comment().map(str::to_owned),
                    })
                    .returning((submission_events::id, submission_events::created_at))
                    .get_result(conn)
                    .await?;
            let kind = match decision {
                Decision::Approved => "submission_approved",
                Decision::Revision(_) => "submission_revision_requested",
            };
            let month = sub.target_month.format("%Y-%m").to_string();
            let email = crate::mail::review_email(
                kind,
                &month,
                decision.comment(),
                decision.doc_types(),
                &state_ref.config.app_origin,
            );
            notify_once(
                conn,
                owner,
                kind,
                json!({
                    "submission_id": id,
                    "month": month,
                }),
                email,
            )
            .await?;
            let updated: Submission = submissions::table
                .find(id)
                .select(Submission::as_select())
                .first(conn)
                .await?;
            let types: Vec<&str> = updated
                .revision_doc_types
                .iter()
                .flatten()
                .map(|d| d.as_str())
                .collect();
            let response = serde_json::to_value(ReviewResponse {
                submission: SubmissionView::load(conn, updated).await?,
                reviewed_by: Reviewer {
                    name: actor.display_name.clone(),
                    role: actor.role,
                },
                reviewed_at: at,
            })?;
            diesel::sql_query(
                "INSERT INTO admin_review_decisions
               (submission_id, event_id, actor_user_id, actor_name, actor_role, decision,
                review_comment, revision_doc_types, idempotency_key, request_fingerprint,
                response_json, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            )
            .bind::<diesel::sql_types::Uuid, _>(id)
            .bind::<BigInt, _>(event_id)
            .bind::<BigInt, _>(actor.id)
            .bind::<Text, _>(&actor.display_name)
            .bind::<Text, _>(actor.role.as_str())
            .bind::<Text, _>(decision.status().as_str())
            .bind::<Nullable<Text>, _>(decision.comment())
            .bind::<Array<Text>, _>(&types)
            .bind::<diesel::sql_types::Uuid, _>(key)
            .bind::<Text, _>(&fingerprint)
            .bind::<Text, _>(response.to_string())
            .bind::<Timestamptz, _>(at)
            .execute(conn)
            .await?;
            if !propagated_events.is_empty() {
                diesel::sql_query(
                    "INSERT INTO admin_review_event_links (event_id, decision_id)
                     SELECT propagated.event_id, d.id
                     FROM unnest($1::bigint[]) AS propagated(event_id)
                     CROSS JOIN admin_review_decisions d WHERE d.idempotency_key = $2",
                )
                .bind::<Array<BigInt>, _>(propagated_events)
                .bind::<diesel::sql_types::Uuid, _>(key)
                .execute(conn)
                .await?;
            }
            Ok(response)
        })
        .await;
    match result {
        Ok(response) => Ok(Json(response)),
        Err(AppError::Internal(error))
            if matches!(
                error.downcast_ref::<DieselError>(),
                Some(DieselError::DatabaseError(
                    DatabaseErrorKind::UniqueViolation,
                    _
                ))
            ) =>
        {
            Err(key_conflict())
        }
        Err(error) => Err(error),
    }
}

/// Verify the effective documents, including unchanged ancestor documents, before
/// approving a chain. Replaced originals are retained but do not override repairs.
async fn approve(
    state: &AppState,
    conn: &mut AsyncPgConnection,
    sub: &Submission,
    owner: i64,
    actor: i64,
) -> Result<Vec<i64>, AppError> {
    let mut ancestors: Vec<Submission> = Vec::new();
    let mut ids = vec![sub.id];
    let mut parent = sub.parent_id;
    while let Some(parent_id) = parent {
        if ids.contains(&parent_id) {
            return Err(anyhow::anyhow!("submission ancestry contains a cycle").into());
        }
        let ancestor: Submission = submissions::table
            .find(parent_id)
            .filter(submissions::user_id.eq(owner))
            .filter(submissions::target_month.eq(sub.target_month))
            .for_update()
            .select(Submission::as_select())
            .first(conn)
            .await
            .optional()?
            .ok_or(AppError::NotFound)?;
        if ancestor.status != Status::Resubmitted {
            return Err(AppError::InvalidState(
                "보완 제출의 이전 검토 상태가 변경되었습니다.".into(),
            ));
        }
        ids.push(parent_id);
        parent = ancestor.parent_id;
        ancestors.push(ancestor);
    }
    let required = non_null(ancestors.last().unwrap_or(sub).required_doc_types.clone());
    let mut files: Vec<SubmissionFile> = submission_files::table
        .filter(submission_files::submission_id.eq_any(&ids))
        .filter(submission_files::superseded_by.is_null())
        .select(SubmissionFile::as_select())
        .load(conn)
        .await?;
    for doc_type in non_null(sub.required_doc_types.clone()) {
        if !files
            .iter()
            .any(|file| file.submission_id == sub.id && file.doc_type == doc_type)
        {
            return Err(AppError::InvalidState(format!(
                "빠진 서류가 있습니다: {}",
                doc_type.label(),
            )));
        }
    }
    files.sort_by_key(|file| ids.iter().position(|id| *id == file.submission_id));
    for doc_type in required {
        let file = files
            .iter()
            .find(|file| file.doc_type == doc_type)
            .ok_or_else(|| {
                AppError::InvalidState(format!("빠진 서류가 있습니다: {}", doc_type.label()))
            })?;
        crate::storage::verify(
            &state.config.upload_dir,
            file.id,
            file.key_id,
            file.size_bytes,
            &file.sha256,
            &state.file_cipher,
        )
        .await?;
    }
    diesel::update(submissions::table.find(sub.id))
        .set((
            submissions::status.eq(Status::Approved),
            submissions::review_comment.eq(None::<String>),
            submissions::revision_doc_types.eq(Vec::<Option<DocType>>::new()),
        ))
        .execute(conn)
        .await?;
    let mut propagated_events = Vec::new();
    for ancestor in ancestors {
        diesel::update(submissions::table.find(ancestor.id))
            .set((
                submissions::status.eq(Status::Approved),
                submissions::review_comment.eq(None::<String>),
                submissions::revision_doc_types.eq(Vec::<Option<DocType>>::new()),
            ))
            .execute(conn)
            .await?;
        let event_id = diesel::insert_into(submission_events::table)
            .values(NewSubmissionEvent {
                submission_id: ancestor.id,
                from_status: Some(ancestor.status),
                to_status: Status::Approved,
                actor_user_id: actor,
                idempotency_key: None,
                note: Some(format!("보완 제출 {} 승인", sub.id)),
            })
            .returning(submission_events::id)
            .get_result::<i64>(conn)
            .await?;
        propagated_events.push(event_id);
    }
    Ok(propagated_events)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reviewer_roles_exclude_admin_and_students() {
        assert!(require_reviewer(Role::Operator).is_ok());
        assert!(require_reviewer(Role::Accountant).is_ok());
        assert!(matches!(
            require_reviewer(Role::Admin),
            Err(AppError::Forbidden)
        ));
        assert!(matches!(
            require_reviewer(Role::Student),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn cursor_preserves_receipt_precision_and_rejects_wrong_month() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let at = DateTime::parse_from_rfc3339("2026-10-02T12:00:00.123456Z")
            .unwrap()
            .with_timezone(&Utc);
        let id = Uuid::new_v4();
        let encoded = Cursor { month, at, id }.encode().ok().unwrap();
        let decoded = Cursor::parse(&encoded, month).ok().unwrap();
        assert_eq!((decoded.at, decoded.id), (at, id));
        assert!(Cursor::parse(&encoded, NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()).is_err());
        assert!(Cursor::parse("not-a-cursor", month).is_err());
        assert!(Cursor::parse(&"a".repeat(513), month).is_err());
    }

    #[test]
    fn replay_checks_actor_target_and_payload_and_returns_original_result() {
        let id = Uuid::new_v4();
        let prior = RecordedDecision {
            submission_id: id,
            actor_user_id: 7,
            request_fingerprint: "same".into(),
            response_json: r#"{"status":"revision_requested","reviewed_at":"original"}"#.into(),
        };
        assert_eq!(
            prior.replay(id, 7, "same").ok().unwrap()["reviewed_at"],
            "original"
        );
        assert!(matches!(
            prior.replay(id, 8, "same"),
            Err(AppError::InvalidState(_))
        ));
        assert!(matches!(
            prior.replay(Uuid::new_v4(), 7, "same"),
            Err(AppError::InvalidState(_))
        ));
        assert!(matches!(
            prior.replay(id, 7, "changed"),
            Err(AppError::InvalidState(_))
        ));
    }

    #[test]
    fn approval_rejects_ambiguous_revision_fields() {
        let body = ReviewRequest {
            status: "approved".into(),
            review_comment: Some("보완".into()),
            revision_doc_types: None,
        };
        assert!(Decision::prepare(body).is_err());
        let body = ReviewRequest {
            status: "approved".into(),
            review_comment: None,
            revision_doc_types: Some(vec!["bankbook".into()]),
        };
        assert!(Decision::prepare(body).is_err());
    }

    #[test]
    fn review_fingerprint_uses_normalized_revision_body() {
        let prepare = |comment: &str, docs: Vec<&str>| {
            Decision::prepare(ReviewRequest {
                status: "revision_requested".into(),
                review_comment: Some(comment.into()),
                revision_doc_types: Some(docs.into_iter().map(str::to_owned).collect()),
            })
            .ok()
            .unwrap()
        };
        let one = prepare(" 다시 제출 ", vec!["bankbook", "id_card", "bankbook"]);
        let two = prepare("다시 제출", vec!["id_card", "bankbook"]);
        assert_eq!(one.fingerprint(), two.fingerprint());
        assert_ne!(
            one.fingerprint(),
            prepare("다른 사유", vec!["bankbook", "id_card"]).fingerprint()
        );
        assert_ne!(one.fingerprint(), Decision::Approved.fingerprint());
    }

    #[test]
    fn review_requires_uuid_idempotency_key() {
        let mut headers = HeaderMap::new();
        assert!(idempotency_key(&headers).is_err());
        headers.insert("idempotency-key", "invalid".parse().unwrap());
        assert!(idempotency_key(&headers).is_err());
        let key = Uuid::new_v4();
        headers.insert("idempotency-key", key.to_string().parse().unwrap());
        assert_eq!(idempotency_key(&headers).ok().unwrap(), key);
    }

    #[test]
    fn review_month_requires_the_canonical_format() {
        assert!(parse_month(Some("2026-10")).is_ok());
        for invalid in ["2026-1", "2026-13", "2026-+1", "+026-10", "2026-10-01"] {
            assert!(parse_month(Some(invalid)).is_err());
        }
    }
}
