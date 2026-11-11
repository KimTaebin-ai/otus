use axum::Json;
use axum::extract::multipart::MultipartRejection;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::result::{DatabaseErrorKind, Error as DieselError};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::cycle;
use crate::domain::{DocType, Kind, Status, non_null};
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::kst;
use crate::models::{
    NewSubmission, NewSubmissionEvent, NewSubmissionFile, Submission, SubmissionFile,
};
use crate::schema::{submission_events, submission_files, submissions, users};
use crate::session::CurrentUser;
use crate::storage;

#[derive(Serialize)]
pub struct FileView {
    file_id: Uuid,
    doc_type: DocType,
    original_name: String,
    size: i64,
    #[serde(serialize_with = "kst::serialize")]
    uploaded_at: DateTime<Utc>,
}

impl From<SubmissionFile> for FileView {
    fn from(f: SubmissionFile) -> Self {
        Self {
            file_id: f.id,
            doc_type: f.doc_type,
            original_name: f.original_name,
            size: f.size_bytes,
            uploaded_at: f.created_at,
        }
    }
}

#[derive(Serialize)]
pub struct SubmissionView {
    id: Uuid,
    kind: Kind,
    #[serde(serialize_with = "kst::serialize_month")]
    target_month: NaiveDate,
    status: Status,
    parent_id: Option<Uuid>,
    /// null while draft
    #[serde(serialize_with = "kst::serialize_opt")]
    submitted_at: Option<DateTime<Utc>>,
    /// only while revision_requested
    review_comment: Option<String>,
    required_doc_types: Vec<DocType>,
    /// current (not superseded) file per doc type
    files: Vec<FileView>,
    #[serde(serialize_with = "kst::serialize")]
    created_at: DateTime<Utc>,
}

impl SubmissionView {
    pub async fn load(conn: &mut AsyncPgConnection, s: Submission) -> Result<Self, AppError> {
        Ok(Self::load_many(conn, vec![s]).await?.remove(0))
    }

    /// One query for the files of all submissions.
    pub async fn load_many(
        conn: &mut AsyncPgConnection,
        subs: Vec<Submission>,
    ) -> Result<Vec<Self>, AppError> {
        let ids: Vec<Uuid> = subs.iter().map(|s| s.id).collect();
        let mut files = current_files(conn, &ids).await?;
        Ok(subs
            .into_iter()
            .map(|s| {
                let (mine, rest): (Vec<_>, Vec<_>) =
                    files.drain(..).partition(|f| f.submission_id == s.id);
                files = rest;
                Self {
                    id: s.id,
                    kind: s.kind,
                    target_month: s.target_month,
                    status: s.status,
                    parent_id: s.parent_id,
                    submitted_at: s.submitted_at,
                    review_comment: s
                        .review_comment
                        .filter(|_| s.status == Status::RevisionRequested),
                    required_doc_types: non_null(s.required_doc_types),
                    files: mine.into_iter().map(FileView::from).collect(),
                    created_at: s.created_at,
                }
            })
            .collect())
    }
}

async fn current_files(
    conn: &mut AsyncPgConnection,
    submission_ids: &[Uuid],
) -> Result<Vec<SubmissionFile>, AppError> {
    Ok(submission_files::table
        .filter(submission_files::submission_id.eq_any(submission_ids))
        .filter(submission_files::superseded_by.is_null())
        .order(submission_files::created_at)
        .select(SubmissionFile::as_select())
        .load(conn)
        .await?)
}

/// 404 for unknown IDs and for other users' submissions alike.
pub async fn find_mine(
    conn: &mut AsyncPgConnection,
    id: Uuid,
    user_id: i64,
) -> Result<Submission, AppError> {
    submissions::table
        .filter(submissions::id.eq(id))
        .filter(submissions::user_id.eq(user_id))
        .select(Submission::as_select())
        .first(conn)
        .await
        .optional()?
        .ok_or(AppError::NotFound)
}

async fn find_draft(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    kind: Kind,
    target_month: NaiveDate,
    parent_id: Option<Uuid>,
) -> Result<Option<Submission>, AppError> {
    Ok(submissions::table
        .filter(submissions::user_id.eq(user_id))
        .filter(submissions::kind.eq(kind))
        .filter(submissions::target_month.eq(target_month))
        .filter(submissions::parent_id.is_not_distinct_from(parent_id))
        .filter(submissions::status.eq(Status::Draft))
        .select(Submission::as_select())
        .first(conn)
        .await
        .optional()?)
}

/// Whether the user already has a submitted (non-draft) submission of
/// `kind` (for `month`, if given), per `counts_as_submitted`.
async fn has_submitted(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    kind: Kind,
    month: Option<NaiveDate>,
) -> Result<bool, AppError> {
    let mut query = submissions::table
        .filter(submissions::user_id.eq(user_id))
        .filter(submissions::kind.eq(kind))
        .into_boxed();
    if let Some(month) = month {
        query = query.filter(submissions::target_month.eq(month));
    }
    let statuses: Vec<Status> = query.select(submissions::status).load(conn).await?;
    Ok(statuses.into_iter().any(counts_as_submitted))
}

/// The other root kind that covers the same month, if any. The initial four
/// documents already include that month's employment-insurance certificate,
/// and a monthly submission is exactly that certificate on its own — so a
/// submitted (non-draft) initial and a submitted monthly for the same month
/// are duplicates, in either order. Supplements correct an existing chain
/// and never conflict this way.
fn conflicting_kind(kind: Kind) -> Option<Kind> {
    match kind {
        Kind::Initial => Some(Kind::Monthly),
        Kind::Monthly => Some(Kind::Initial),
        Kind::Supplement => None,
    }
}

/// Whether a submission in this state counts as "submitted" for the
/// duplicate rule. This is the same fact the staff review scope
/// (`admin_data::REVIEW_SCOPE_CTE`) uses to hide a duplicate monthly chain:
/// `status <> 'draft'`. A mere draft of the other kind does NOT block —
/// it suppresses nothing in review either — but finalizing it later is
/// blocked by the same check in `finalize`.
fn counts_as_submitted(status: Status) -> bool {
    status != Status::Draft
}

/// Reject (409 INVALID_STATE, the per-kind duplicate convention) when the
/// other root kind is already submitted for the same target month. Callers
/// hold the user's row lock, so a racing create/finalize of the other kind
/// for the same user cannot slip between this check and the write.
async fn ensure_no_same_month_duplicate(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    kind: Kind,
    target_month: NaiveDate,
) -> Result<(), AppError> {
    let Some(other) = conflicting_kind(kind) else {
        return Ok(());
    };
    if has_submitted(conn, user_id, other, Some(target_month)).await? {
        return Err(AppError::InvalidState(match kind {
            Kind::Monthly => "이 달은 최초 4종으로 이미 제출했습니다. 같은 달에는 월별 서류를 따로 제출할 수 없습니다.".into(),
            Kind::Initial => "이 달의 월별 서류를 이미 제출했습니다. 같은 달에는 최초 4종을 제출할 수 없습니다.".into(),
            Kind::Supplement => unreachable!("checked above"),
        }));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct CreateSubmission {
    kind: String,
    target_month: String,
    parent_id: Option<String>,
}

/// POST /api/submissions — 201 new draft, 200 existing draft.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<CreateSubmission>,
) -> Result<(StatusCode, Json<SubmissionView>), AppError> {
    let kind: Kind = body
        .kind
        .parse()
        .map_err(|_| AppError::InvalidRequest("알 수 없는 kind입니다.".into()))?;
    let target_month = kst::parse_month(&body.target_month).ok_or_else(|| {
        AppError::InvalidRequest("target_month는 YYYY-MM 형식이어야 합니다.".into())
    })?;
    let parent_id = match (kind, body.parent_id.as_deref()) {
        (Kind::Supplement, Some(id)) => Some(Uuid::parse_str(id).map_err(|_| AppError::NotFound)?),
        (Kind::Supplement, None) => {
            return Err(AppError::InvalidRequest(
                "보완 제출에는 parent_id가 필요합니다.".into(),
            ));
        }
        (_, Some(_)) => {
            return Err(AppError::InvalidRequest(
                "parent_id는 보완 제출에만 쓸 수 있습니다.".into(),
            ));
        }
        (_, None) => None,
    };

    let mut conn = state.pool.get().await?;
    // The check-and-insert below must be atomic against a racing create or
    // finalize of the other root kind for the same user: like `finalize`,
    // take the user row lock first so same-user submission writes serialise.
    let result = conn
        .transaction::<_, AppError, _>(async move |conn| {
            users::table
                .find(user.id)
                .for_update()
                .select(users::id)
                .first::<i64>(conn)
                .await?;

            // 409 when the other root kind is already submitted this month,
            // even if a stray draft of this kind predates it (the draft can
            // then never be finalized, but creating fresh must not pretend
            // otherwise). Drafts of the other kind do not block.
            ensure_no_same_month_duplicate(conn, user.id, kind, target_month).await?;

            if let Some(draft) = find_draft(conn, user.id, kind, target_month, parent_id).await? {
                return Ok((StatusCode::OK, draft));
            }

            let required_doc_types = match kind {
                Kind::Initial => {
                    if has_submitted(conn, user.id, Kind::Initial, None).await? {
                        return Err(AppError::InvalidState(
                            "최초 4종은 이미 제출했습니다.".into(),
                        ));
                    }
                    DocType::ALL.to_vec()
                }
                Kind::Monthly => {
                    if has_submitted(conn, user.id, Kind::Monthly, Some(target_month)).await? {
                        return Err(AppError::InvalidState(
                            "이 달의 월별 서류는 이미 제출했습니다.".into(),
                        ));
                    }
                    vec![DocType::EmploymentInsurance]
                }
                Kind::Supplement => {
                    let parent = find_mine(conn, parent_id.expect("checked above"), user.id).await?;
                    if parent.status != Status::RevisionRequested {
                        return Err(AppError::InvalidState(
                            "재검토 요청을 받은 제출만 보완할 수 있습니다.".into(),
                        ));
                    }
                    if parent.target_month != target_month {
                        return Err(AppError::InvalidRequest(
                            "target_month가 원래 제출과 다릅니다.".into(),
                        ));
                    }
                    let requested = non_null(parent.revision_doc_types);
                    if requested.is_empty() {
                        non_null(parent.required_doc_types)
                    } else {
                        requested
                    }
                }
            };
            cycle::ensure_open(conn, target_month).await?;

            let created = diesel::insert_into(submissions::table)
                .values(NewSubmission {
                    id: Uuid::new_v4(),
                    user_id: user.id,
                    kind,
                    target_month,
                    parent_id,
                    required_doc_types: required_doc_types.into_iter().map(Some).collect(),
                })
                .returning(Submission::as_returning())
                .get_result(conn)
                .await?;
            Ok((StatusCode::CREATED, created))
        })
        .await;
    let (code, created) = match result {
        Ok(pair) => pair,
        // a concurrent request created the same draft first
        Err(AppError::Internal(e))
            if matches!(
                e.downcast_ref::<DieselError>(),
                Some(DieselError::DatabaseError(
                    DatabaseErrorKind::UniqueViolation,
                    _
                ))
            ) =>
        {
            let draft = find_draft(&mut conn, user.id, kind, target_month, parent_id)
                .await?
                .ok_or_else(|| AppError::InvalidState("제출을 만들 수 없습니다.".into()))?;
            (StatusCode::OK, draft)
        }
        Err(e) => return Err(e),
    };
    Ok((code, Json(SubmissionView::load(&mut conn, created).await?)))
}

pub fn parse_id(id: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(id).map_err(|_| AppError::NotFound)
}

/// Every uploaded version is kept, so cap them to bound disk use per submission.
const MAX_VERSIONS_PER_DOC: i64 = 10;

fn not_draft() -> AppError {
    AppError::InvalidState("임시 저장 상태의 제출에만 파일을 올릴 수 있습니다.".into())
}

/// POST /api/submissions/{id}/files — multipart `doc_type` + `file`.
/// Re-uploading a doc_type replaces it; the previous file is kept as history.
pub async fn upload_file(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<FileView>), AppError> {
    let id = parse_id(&id)?;

    // Cheap checks before reading the body. The connection goes back to the pool
    // while the file streams in.
    let submission = {
        let mut conn = state.pool.get().await?;
        let submission = find_mine(&mut conn, id, user.id).await?;
        if submission.status != Status::Draft {
            return Err(not_draft());
        }
        cycle::ensure_open(&mut conn, submission.target_month).await?;
        submission
    };
    let target_month = submission.target_month;
    let required = non_null(submission.required_doc_types);
    // the whole PDF is held in memory until it's encrypted and written
    let _permit = state
        .heavy_io
        .acquire()
        .await
        .map_err(anyhow::Error::from)?;

    let mut multipart = multipart
        .map_err(|_| AppError::InvalidRequest("multipart/form-data 요청이어야 합니다.".into()))?;
    let mut doc_type = None;
    let mut upload = None;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(storage::multipart_error)?
    {
        match field.name() {
            Some("doc_type") => {
                let value = storage::small_text(&mut field, 64).await?;
                let parsed: DocType = value
                    .parse()
                    .map_err(|_| AppError::InvalidRequest("알 수 없는 doc_type입니다.".into()))?;
                if !required.contains(&parsed) {
                    return Err(AppError::DocTypeNotAllowed);
                }
                doc_type = Some(parsed);
            }
            Some("file") => {
                if upload.is_some() {
                    return Err(AppError::InvalidRequest(
                        "파일은 하나만 올릴 수 있습니다.".into(),
                    ));
                }
                let name = storage::pdf_file_name(&field)?;
                let received =
                    storage::receive_pdf(&mut field, state.config.max_upload_bytes).await?;
                upload = Some((name, received));
            }
            _ => {}
        }
    }
    let (Some(doc_type), Some((original_name, received))) = (doc_type, upload) else {
        return Err(AppError::InvalidRequest(
            "doc_type과 file이 모두 필요합니다.".into(),
        ));
    };

    received.scan(&state, user.id).await?;
    let file_id = Uuid::new_v4();
    let new_file = NewSubmissionFile {
        id: file_id,
        submission_id: id,
        doc_type,
        original_name,
        size_bytes: received.size as i64,
        sha256: received.sha256.clone(),
        key_id: Some(state.file_cipher.key_id()),
    };
    let stored = received
        .store(&state.config.upload_dir, file_id, &state.file_cipher)
        .await?;

    let mut conn = state.pool.get().await?;
    let row = conn
        .transaction::<_, AppError, _>(async move |conn| {
            {
                // serializes uploads (and later finalize) on this submission
                let status: Status = submissions::table
                    .find(id)
                    .for_update()
                    .select(submissions::status)
                    .first(conn)
                    .await?;
                if status != Status::Draft {
                    return Err(not_draft());
                }
                // again at commit time: a slow upload must not land after the deadline
                cycle::ensure_open(conn, target_month).await?;
                let versions: i64 = submission_files::table
                    .filter(submission_files::submission_id.eq(id))
                    .filter(submission_files::doc_type.eq(doc_type))
                    .count()
                    .get_result(conn)
                    .await?;
                if versions >= MAX_VERSIONS_PER_DOC {
                    return Err(AppError::InvalidState(format!(
                        "같은 서류는 {MAX_VERSIONS_PER_DOC}번까지 올릴 수 있습니다."
                    )));
                }
                // superseded_by's FK is deferred, so the old row can point at the new
                // one before it exists, keeping one current file per doc_type
                diesel::update(
                    submission_files::table
                        .filter(submission_files::submission_id.eq(id))
                        .filter(submission_files::doc_type.eq(doc_type))
                        .filter(submission_files::superseded_by.is_null()),
                )
                .set(submission_files::superseded_by.eq(file_id))
                .execute(conn)
                .await?;
                Ok(diesel::insert_into(submission_files::table)
                    .values(new_file)
                    .returning(SubmissionFile::as_returning())
                    .get_result(conn)
                    .await?)
            }
        })
        .await?;
    stored.commit();
    Ok((StatusCode::CREATED, Json(FileView::from(row))))
}

#[derive(Deserialize)]
pub struct ListQuery {
    month: Option<String>,
    limit: Option<String>,
    include_drafts: Option<String>,
}

/// GET /api/submissions — my submissions, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Json<ListResponse>, AppError> {
    let Query(q) =
        query.map_err(|_| AppError::InvalidRequest("query 형식이 올바르지 않습니다.".into()))?;
    let month = q
        .month
        .as_deref()
        .map(|m| {
            kst::parse_month(m).ok_or_else(|| {
                AppError::InvalidRequest("month는 YYYY-MM 형식이어야 합니다.".into())
            })
        })
        .transpose()?;
    let limit = q
        .limit
        .as_deref()
        .map(|l| match l.parse::<i64>() {
            Ok(n) if n > 0 => Ok(n),
            _ => Err(AppError::InvalidRequest(
                "limit은 1 이상의 정수여야 합니다.".into(),
            )),
        })
        .transpose()?;
    let include_drafts = match q.include_drafts.as_deref() {
        None | Some("false") => false,
        Some("true") => true,
        Some(_) => {
            return Err(AppError::InvalidRequest(
                "include_drafts는 true 또는 false여야 합니다.".into(),
            ));
        }
    };

    let mut query = submissions::table
        .filter(submissions::user_id.eq(user.id))
        .order((submissions::created_at.desc(), submissions::id.desc()))
        .select(Submission::as_select())
        .into_boxed();
    if let Some(month) = month {
        query = query.filter(submissions::target_month.eq(month));
    }
    if !include_drafts {
        query = query.filter(submissions::status.ne(Status::Draft));
    }
    if let Some(limit) = limit {
        query = query.limit(limit);
    }
    let mut conn = state.pool.get().await?;
    let subs = query.load(&mut conn).await?;
    let items = SubmissionView::load_many(&mut conn, subs).await?;
    Ok(Json(ListResponse { items }))
}

/// A struct, not `serde_json::json!`, so items keep the field order of every other response
#[derive(Serialize)]
pub struct ListResponse {
    items: Vec<SubmissionView>,
}

/// POST /api/submissions/{id}/finalize — 최종 제출, with an `Idempotency-Key` (UUID) header.
///
/// draft → pending_review (supplement: → resubmitted, and its parent
/// revision_requested → resubmitted). Only succeeds after every required document is
/// confirmed on disk. Repeating a request with the same key returns the current state.
pub async fn finalize(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<SubmissionView>, AppError> {
    let id = parse_id(&id)?;
    let key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(|| {
            AppError::InvalidRequest("Idempotency-Key 헤더(UUID)가 필요합니다.".into())
        })?;
    let upload_dir = state.config.upload_dir.clone();
    let cipher = state.file_cipher.clone();
    // verification decrypts every required file into memory
    let _permit = state
        .heavy_io
        .acquire()
        .await
        .map_err(anyhow::Error::from)?;

    let mut conn = state.pool.get().await?;
    let result = conn
        .transaction::<_, AppError, _>(async move |conn| {
            // Serialize final submission with staff reminders and employment
            // changes. Every participating operation locks the user first.
            users::table
                .find(user.id)
                .for_update()
                .select(users::id)
                .first::<i64>(conn)
                .await?;
            // A concurrent retry waits here and sees the committed event below.
            let sub: Submission = submissions::table
                .filter(submissions::id.eq(id))
                .filter(submissions::user_id.eq(user.id))
                .for_update()
                .select(Submission::as_select())
                .first(conn)
                .await
                .optional()?
                .ok_or(AppError::NotFound)?;

            let replayed: Option<Uuid> = submission_events::table
                .filter(submission_events::idempotency_key.eq(key))
                .select(submission_events::submission_id)
                .first(conn)
                .await
                .optional()?;
            match replayed {
                Some(prior) if prior == id => return Ok(sub),
                Some(_) => {
                    return Err(AppError::InvalidState(
                        "이미 다른 요청에 쓴 Idempotency-Key입니다.".into(),
                    ));
                }
                None => {}
            }

            if sub.status != Status::Draft {
                return Err(AppError::InvalidState("이미 제출한 서류입니다.".into()));
            }
            // Defence in depth with the same rule as `create`: a draft made
            // before the other root kind was submitted (or raced past the
            // create check) must never become the second submitted chain
            // for this month. Runs under the user row lock above, so two
            // racing finalizes serialise and the second one sees the first
            // committed. Historical duplicate rows are untouched — only the
            // submission being finalized is judged.
            ensure_no_same_month_duplicate(conn, user.id, sub.kind, sub.target_month).await?;
            cycle::ensure_open(conn, sub.target_month).await?;

            let files = current_files(conn, &[id]).await?;
            let missing: Vec<&str> = non_null(sub.required_doc_types.clone())
                .into_iter()
                .filter(|t| !files.iter().any(|f| f.doc_type == *t))
                .map(DocType::label)
                .collect();
            if !missing.is_empty() {
                return Err(AppError::InvalidState(format!(
                    "빠진 서류가 있습니다: {}",
                    missing.join(", ")
                )));
            }
            for f in &files {
                storage::verify(
                    &upload_dir,
                    f.id,
                    f.key_id,
                    f.size_bytes,
                    &f.sha256,
                    &cipher,
                )
                .await?;
            }

            let to = if sub.kind == Kind::Supplement {
                Status::Resubmitted
            } else {
                Status::PendingReview
            };
            diesel::update(submissions::table.find(id))
                .set((
                    submissions::status.eq(to),
                    submissions::submitted_at.eq(Utc::now()),
                ))
                .execute(conn)
                .await?;
            diesel::insert_into(submission_events::table)
                .values(NewSubmissionEvent {
                    submission_id: id,
                    from_status: Some(Status::Draft),
                    to_status: to,
                    actor_user_id: user.id,
                    idempotency_key: Some(key),
                    note: None,
                })
                .execute(conn)
                .await?;

            if let Some(parent_id) = sub.parent_id {
                let parent_status: Status = submissions::table
                    .find(parent_id)
                    .for_update()
                    .select(submissions::status)
                    .first(conn)
                    .await?;
                if parent_status != Status::RevisionRequested {
                    return Err(AppError::InvalidState(
                        "이미 보완 제출한 서류입니다.".into(),
                    ));
                }
                diesel::update(submissions::table.find(parent_id))
                    .set(submissions::status.eq(Status::Resubmitted))
                    .execute(conn)
                    .await?;
                diesel::insert_into(submission_events::table)
                    .values(NewSubmissionEvent {
                        submission_id: parent_id,
                        from_status: Some(Status::RevisionRequested),
                        to_status: Status::Resubmitted,
                        actor_user_id: user.id,
                        idempotency_key: None,
                        note: Some(format!("보완 제출 {id}")),
                    })
                    .execute(conn)
                    .await?;
            }

            Ok(submissions::table
                .find(id)
                .select(Submission::as_select())
                .first(conn)
                .await?)
        })
        .await;
    let sub = match result {
        Ok(sub) => sub,
        // the unique indexes allow one submitted initial per user and one monthly per month
        Err(AppError::Internal(e))
            if matches!(
                e.downcast_ref::<DieselError>(),
                Some(DieselError::DatabaseError(
                    DatabaseErrorKind::UniqueViolation,
                    _
                ))
            ) =>
        {
            return Err(AppError::InvalidState("이미 제출한 서류입니다.".into()));
        }
        Err(e) => return Err(e),
    };
    Ok(Json(SubmissionView::load(&mut conn, sub).await?))
}

#[cfg(test)]
mod duplicate_rule_tests {
    use super::{Kind, Status, conflicting_kind, counts_as_submitted};

    #[test]
    fn initial_and_monthly_conflict_in_both_directions() {
        assert_eq!(conflicting_kind(Kind::Initial), Some(Kind::Monthly));
        assert_eq!(conflicting_kind(Kind::Monthly), Some(Kind::Initial));
    }

    #[test]
    fn supplements_never_conflict() {
        assert_eq!(conflicting_kind(Kind::Supplement), None);
    }

    #[test]
    fn only_submitted_states_count_drafts_do_not_block() {
        // The exact fact REVIEW_SCOPE_CTE hides on: status <> 'draft'.
        assert!(!counts_as_submitted(Status::Draft));
        for status in [
            Status::PendingReview,
            Status::Approved,
            Status::RevisionRequested,
            Status::Resubmitted,
        ] {
            assert!(counts_as_submitted(status));
        }
    }
}
