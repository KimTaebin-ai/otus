//! Staff views of submitted documents and their supplement history.
//! Drafts are excluded before a chain, file ID, or event can enter a response.

use axum::Json;
use axum::extract::{Path, State};
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::sql_types::{Array, BigInt, Nullable, Text, Timestamptz, Uuid as SqlUuid};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::Serialize;
use uuid::Uuid;

use crate::AppState;
use crate::admin_data::{self, PublicSubmission, SubmissionChain, SubmittedFile};
use crate::domain::{DocType, Kind, Role, Status, non_null};
use crate::error::AppError;
use crate::kst;
use crate::models::{Cycle, User};
use crate::schema::{cycles, submissions, users};
use crate::session::{CurrentUser, require_staff};

#[derive(Serialize)]
pub struct SubmissionFileView {
    id: Uuid,
    doc_type: DocType,
    original_name: String,
    size_bytes: i64,
    #[serde(serialize_with = "kst::serialize")]
    uploaded_at: DateTime<Utc>,
}

impl From<&SubmittedFile> for SubmissionFileView {
    fn from(file: &SubmittedFile) -> Self {
        Self {
            id: file.id,
            doc_type: file.doc_type,
            original_name: file.original_name.clone(),
            size_bytes: file.size_bytes,
            uploaded_at: file.created_at,
        }
    }
}

#[derive(Serialize)]
pub struct SubmissionHistoryItem {
    id: Uuid,
    kind: Kind,
    #[serde(serialize_with = "kst::serialize_month")]
    target_month: NaiveDate,
    parent_id: Option<Uuid>,
    status: Status,
    #[serde(serialize_with = "kst::serialize")]
    submitted_at: DateTime<Utc>,
    review_comment: Option<String>,
    required_doc_types: Vec<DocType>,
    revision_doc_types: Vec<DocType>,
    files: Vec<SubmissionFileView>,
    #[serde(serialize_with = "kst::serialize")]
    created_at: DateTime<Utc>,
}

impl SubmissionHistoryItem {
    fn from_submission(submission: &PublicSubmission, chain: &SubmissionChain) -> Self {
        Self {
            id: submission.id,
            kind: submission.kind,
            target_month: submission.target_month,
            parent_id: submission.parent_id,
            status: submission.status,
            submitted_at: submission.submitted_at,
            // Past request reasons belong to their event, not a mutable submission row.
            review_comment: submission
                .review_comment
                .clone()
                .filter(|_| submission.status == Status::RevisionRequested),
            required_doc_types: non_null(submission.required_doc_types.clone()),
            revision_doc_types: non_null(submission.revision_doc_types.clone()),
            files: submission_files(submission, chain),
            created_at: submission.created_at,
        }
    }
}

/// A supplement response contains only its own submitted replacement documents.
/// Unchanged ancestor files remain on their own history items.
fn submission_files(
    submission: &PublicSubmission,
    chain: &SubmissionChain,
) -> Vec<SubmissionFileView> {
    let required = non_null(submission.required_doc_types.clone());
    let mut files: Vec<_> = chain
        .current_files
        .iter()
        .chain(chain.previous_files.iter())
        .filter(|file| file.submission_id == submission.id)
        .map(SubmissionFileView::from)
        .collect();
    files.sort_by_key(|file| {
        (
            required
                .iter()
                .position(|doc_type| *doc_type == file.doc_type)
                .unwrap_or(required.len()),
            file.id,
        )
    });
    files
}

#[derive(Serialize)]
pub struct SubmissionUserView {
    id: i64,
    name: String,
    login: String,
    employed: bool,
    ordinal: Option<String>,
    ko_name: Option<String>,
    date_of_birth: Option<chrono::NaiveDate>,
}

#[derive(Serialize)]
pub struct SubmissionCycleView {
    #[serde(serialize_with = "kst::serialize")]
    opens_at: DateTime<Utc>,
    #[serde(serialize_with = "kst::serialize")]
    closes_at: DateTime<Utc>,
    issued_after: NaiveDate,
}

#[derive(Serialize)]
pub struct SubmissionDetailView {
    #[serde(flatten)]
    submission: SubmissionHistoryItem,
    user: SubmissionUserView,
    root_id: Uuid,
    root_kind: Kind,
    latest_submission_id: Uuid,
    /// An old submission remains readable even if its cycle row is absent.
    cycle: Option<SubmissionCycleView>,
}

#[derive(Serialize)]
pub struct SubmissionHistoryView {
    root_id: Uuid,
    root_kind: Kind,
    latest_submission_id: Uuid,
    items: Vec<SubmissionHistoryItem>,
}

async fn submitted_chain(
    conn: &mut AsyncPgConnection,
    id: Uuid,
) -> Result<SubmissionChain, AppError> {
    let (owner_id, month): (i64, NaiveDate) = submissions::table
        .find(id)
        .filter(submissions::status.ne(Status::Draft))
        .select((submissions::user_id, submissions::target_month))
        .first(conn)
        .await
        .optional()?
        .ok_or(AppError::NotFound)?;
    admin_data::load_chains(conn, Some(month), Some(owner_id))
        .await?
        .into_iter()
        .find(|chain| {
            chain
                .submissions
                .iter()
                .any(|submission| submission.id == id)
        })
        .ok_or(AppError::NotFound)
}

/// All reads in a response see one snapshot, including a concurrently finalized supplement.
async fn read_snapshot(conn: &mut AsyncPgConnection) -> Result<(), AppError> {
    diesel::sql_query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(conn)
        .await?;
    Ok(())
}

/// GET /api/admin/submissions/{id}
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<SubmissionDetailView>, AppError> {
    require_staff(&user)?;
    let id = super::submissions::parse_id(&id)?;
    let mut conn = state.pool.get().await?;
    let view = conn
        .transaction::<_, AppError, _>(async move |conn| {
            read_snapshot(conn).await?;
            let chain = submitted_chain(conn, id).await?;
            let submission = chain
                .submissions
                .iter()
                .find(|submission| submission.id == id)
                .ok_or(AppError::NotFound)?;
            let owner: User = users::table
                .find(chain.user_id)
                .select(User::as_select())
                .first(conn)
                .await?;
            let cycle: Option<Cycle> = cycles::table
                .find(submission.target_month)
                .select(Cycle::as_select())
                .first(conn)
                .await
                .optional()?;
            Ok(SubmissionDetailView {
                submission: SubmissionHistoryItem::from_submission(submission, &chain),
                user: SubmissionUserView {
                    id: owner.id,
                    name: owner.display_name,
                    login: owner.login,
                    employed: owner.employed,
                    ordinal: owner.ordinal,
                    ko_name: owner.ko_name,
                    date_of_birth: owner.date_of_birth,
                },
                root_id: chain.root_id,
                root_kind: chain.root_kind,
                latest_submission_id: chain.latest().id,
                cycle: cycle.map(|cycle| SubmissionCycleView {
                    opens_at: cycle.opens_at,
                    closes_at: cycle.closes_at,
                    issued_after: submission.target_month,
                }),
            })
        })
        .await?;
    Ok(Json(view))
}

fn history_view(chain: &SubmissionChain) -> SubmissionHistoryView {
    SubmissionHistoryView {
        root_id: chain.root_id,
        root_kind: chain.root_kind,
        latest_submission_id: chain.latest().id,
        items: chain
            .submissions
            .iter()
            .rev()
            .map(|submission| SubmissionHistoryItem::from_submission(submission, chain))
            .collect(),
    }
}

/// GET /api/admin/submissions/{id}/history — this root's completed submissions, newest first.
pub async fn history(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<SubmissionHistoryView>, AppError> {
    require_staff(&user)?;
    let id = super::submissions::parse_id(&id)?;
    let mut conn = state.pool.get().await?;
    let view = conn
        .transaction::<_, AppError, _>(async move |conn| {
            read_snapshot(conn).await?;
            Ok(history_view(&submitted_chain(conn, id).await?))
        })
        .await?;
    Ok(Json(view))
}

#[derive(QueryableByName)]
struct StoredEvent {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = SqlUuid)]
    submission_id: Uuid,
    #[diesel(sql_type = Nullable<Text>)]
    from_status: Option<Status>,
    #[diesel(sql_type = Text)]
    to_status: Status,
    #[diesel(sql_type = Timestamptz)]
    created_at: DateTime<Utc>,
    #[diesel(sql_type = Text)]
    actor_name: String,
    #[diesel(sql_type = Text)]
    actor_role: Role,
    #[diesel(sql_type = Nullable<Text>)]
    review_comment: Option<String>,
    #[diesel(sql_type = Array<Nullable<Text>>)]
    revision_doc_types: Vec<Option<DocType>>,
}

#[derive(Serialize)]
pub struct EventActor {
    name: String,
    role: Role,
}

#[derive(Serialize)]
pub struct SubmissionEventView {
    id: i64,
    submission_id: Uuid,
    #[serde(serialize_with = "kst::serialize")]
    at: DateTime<Utc>,
    action: &'static str,
    from_status: Option<Status>,
    to_status: Status,
    actor: EventActor,
    review_comment: Option<String>,
    revision_doc_types: Vec<DocType>,
}

impl SubmissionEventView {
    fn from_event(event: StoredEvent) -> Option<Self> {
        let action = match event.to_status {
            Status::PendingReview => "submitted",
            Status::Resubmitted => "resubmitted",
            Status::Approved => "approved",
            Status::RevisionRequested => "revision_requested",
            Status::Draft => return None,
        };
        Some(Self {
            id: event.id,
            submission_id: event.submission_id,
            at: event.created_at,
            action,
            from_status: event.from_status,
            to_status: event.to_status,
            actor: EventActor {
                name: event.actor_name,
                role: event.actor_role,
            },
            review_comment: event.review_comment,
            revision_doc_types: non_null(event.revision_doc_types),
        })
    }
}

#[derive(Serialize)]
pub struct SubmissionEventsView {
    root_id: Uuid,
    items: Vec<SubmissionEventView>,
}

/// GET /api/admin/submissions/{id}/events — immutable review snapshots where available.
pub async fn events(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<SubmissionEventsView>, AppError> {
    require_staff(&user)?;
    let id = super::submissions::parse_id(&id)?;
    let mut conn = state.pool.get().await?;
    let view = conn
        .transaction::<_, AppError, _>(async move |conn| {
            read_snapshot(conn).await?;
            let chain = submitted_chain(conn, id).await?;
            let ids: Vec<Uuid> = chain
                .submissions
                .iter()
                .map(|submission| submission.id)
                .collect();
            let rows: Vec<StoredEvent> = diesel::sql_query(
                "SELECT e.id, e.submission_id, e.from_status, e.to_status, e.created_at, \
                    COALESCE(d.actor_name, propagated.actor_name, u.display_name) AS actor_name, \
                    COALESCE(d.actor_role, propagated.actor_role, u.role) AS actor_role, \
                    CASE WHEN d.id IS NOT NULL THEN d.review_comment \
                         WHEN e.to_status = 'revision_requested' THEN e.note \
                         ELSE NULL END AS review_comment, \
                    COALESCE(d.revision_doc_types, ARRAY[]::TEXT[]) AS revision_doc_types \
                 FROM submission_events e \
                 INNER JOIN users u ON u.id = e.actor_user_id \
                 LEFT JOIN admin_review_decisions d ON d.event_id = e.id \
                 LEFT JOIN admin_review_event_links link ON link.event_id = e.id \
                 LEFT JOIN admin_review_decisions propagated ON propagated.id = link.decision_id \
                 WHERE e.submission_id = ANY($1) AND e.to_status <> 'draft' \
                 ORDER BY e.created_at DESC, e.id DESC",
            )
            .bind::<Array<SqlUuid>, _>(ids)
            .load(conn)
            .await?;
            Ok(SubmissionEventsView {
                root_id: chain.root_id,
                items: rows
                    .into_iter()
                    .filter_map(SubmissionEventView::from_event)
                    .collect(),
            })
        })
        .await?;
    Ok(Json(view))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(day: u32) -> DateTime<Utc> {
        kst::start_of(NaiveDate::from_ymd_opt(2026, 10, day).unwrap())
    }

    fn submission(id: u128, parent_id: Option<u128>, docs: &[DocType]) -> PublicSubmission {
        PublicSubmission {
            id: Uuid::from_u128(id),
            user_id: 7,
            kind: if parent_id.is_some() {
                Kind::Supplement
            } else {
                Kind::Initial
            },
            target_month: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            parent_id: parent_id.map(Uuid::from_u128),
            status: Status::Resubmitted,
            submitted_at: at(id as u32),
            review_comment: None,
            required_doc_types: docs.iter().copied().map(Some).collect(),
            revision_doc_types: Vec::new(),
            created_at: at(id as u32),
        }
    }

    fn file(id: u128, submission_id: u128, doc_type: DocType) -> SubmittedFile {
        SubmittedFile {
            id: Uuid::from_u128(id),
            submission_id: Uuid::from_u128(submission_id),
            doc_type,
            original_name: format!("{}.pdf", doc_type.as_str()),
            size_bytes: 42,
            sha256: vec![0; 32],
            key_id: Some(1),
            created_at: at(submission_id as u32),
        }
    }

    #[test]
    fn history_keeps_original_and_each_supplement_files_on_their_own_submission() {
        let mut original = submission(1, None, &[DocType::IdCard, DocType::Bankbook]);
        original.review_comment = Some("old request".into());
        original.revision_doc_types = vec![Some(DocType::Bankbook)];
        let chain = SubmissionChain {
            user_id: 7,
            target_month: original.target_month,
            root_id: original.id,
            root_kind: original.kind,
            submissions: vec![
                original,
                submission(2, Some(1), &[DocType::Bankbook]),
                submission(3, Some(2), &[DocType::Bankbook]),
            ],
            current_files: vec![file(11, 1, DocType::IdCard), file(13, 3, DocType::Bankbook)],
            previous_files: vec![
                file(12, 1, DocType::Bankbook),
                file(14, 2, DocType::Bankbook),
            ],
        };
        let view = history_view(&chain);
        assert_eq!(view.latest_submission_id, Uuid::from_u128(3));
        assert_eq!(
            view.items.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![Uuid::from_u128(3), Uuid::from_u128(2), Uuid::from_u128(1),]
        );
        assert_eq!(view.items[0].files.len(), 1);
        assert_eq!(view.items[0].files[0].id, Uuid::from_u128(13));
        assert_eq!(view.items[1].files[0].id, Uuid::from_u128(14));
        assert_eq!(
            view.items[2]
                .files
                .iter()
                .map(|file| file.id)
                .collect::<Vec<_>>(),
            vec![Uuid::from_u128(11), Uuid::from_u128(12),]
        );
        assert!(view.items[2].review_comment.is_none());
    }

    #[test]
    fn revision_event_keeps_its_original_actor_reason_and_doc_types() {
        let event = StoredEvent {
            id: 41,
            submission_id: Uuid::from_u128(1),
            from_status: Some(Status::PendingReview),
            to_status: Status::RevisionRequested,
            created_at: at(2),
            actor_name: "당시 담당자".into(),
            actor_role: Role::Operator,
            review_comment: Some("통장사본 다시 제출".into()),
            revision_doc_types: vec![Some(DocType::Bankbook)],
        };
        let view = SubmissionEventView::from_event(event).unwrap();
        let json = serde_json::to_value(view).unwrap();
        assert_eq!(json["action"], "revision_requested");
        assert_eq!(json["actor"]["name"], "당시 담당자");
        assert_eq!(json["actor"]["role"], "operator");
        assert_eq!(json["review_comment"], "통장사본 다시 제출");
        assert_eq!(json["revision_doc_types"], serde_json::json!(["bankbook"]));
        assert_eq!(json["at"], "2026-10-02T00:00:00+09:00");
    }

    #[test]
    fn legacy_event_without_snapshot_does_not_invent_requested_documents() {
        let event = StoredEvent {
            id: 1,
            submission_id: Uuid::from_u128(1),
            from_status: Some(Status::PendingReview),
            to_status: Status::RevisionRequested,
            created_at: at(1),
            actor_name: "담당자".into(),
            actor_role: Role::Operator,
            review_comment: None,
            revision_doc_types: Vec::new(),
        };
        let view = SubmissionEventView::from_event(event).unwrap();
        assert!(view.review_comment.is_none());
        assert!(view.revision_doc_types.is_empty());
    }

    #[test]
    fn serialized_history_excludes_draft_ids_files_and_other_roots_in_the_same_month() {
        let original = submission(1, None, &[DocType::Bankbook]);
        let mut other_root = submission(2, None, &[DocType::EmploymentInsurance]);
        other_root.kind = Kind::Monthly;
        let mut draft = submission(3, Some(1), &[DocType::Bankbook]);
        draft.status = Status::Draft;
        let chains = admin_data::build_chains(
            vec![original, other_root, draft],
            vec![
                file(11, 1, DocType::Bankbook),
                file(12, 2, DocType::EmploymentInsurance),
                file(13, 3, DocType::Bankbook),
            ],
        )
        .unwrap_or_else(|_| panic!("valid completed chains"));
        let original_chain = chains
            .iter()
            .find(|chain| chain.root_id == Uuid::from_u128(1))
            .unwrap();
        let json = serde_json::to_string(&history_view(original_chain)).unwrap();
        assert!(json.contains(&Uuid::from_u128(11).to_string()));
        for hidden_id in [2, 3, 12, 13] {
            assert!(!json.contains(&Uuid::from_u128(hidden_id).to_string()));
        }
        assert_eq!(original_chain.latest().id, Uuid::from_u128(1));
    }
}
