//! Demo-only endpoints (enabled with DEMO_LOGIN_ENABLED, 404 otherwise).
//! They stand in for the reviewer screens, which are out of hackathon scope.

use axum::Json;
use axum::extract::{Path, State};
use diesel::prelude::*;
use diesel_async::{AsyncConnection, RunQueryDsl};
use serde::Deserialize;

use crate::AppState;
use crate::domain::{DocType, Status, non_null};
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::models::{NewSubmissionEvent, Submission};
use crate::routes::submissions::{SubmissionView, parse_id};
use crate::schema::{bank_account_changes, submission_events, submissions};
use crate::session::CurrentUser;

#[derive(Deserialize)]
pub struct DecideTimeRequirement {
    month: String,
}

/// POST /api/dev/time-requirements/decide — run the 1st-09:00 decision for my
/// demo account now (issue #10 demo checkpoint). Demo-only, like the other dev
/// endpoints; goes through `decide_month`, so notifications match the real job.
pub async fn decide_time_requirement(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<DecideTimeRequirement>,
) -> Result<Json<crate::routes::time_requirements::TimeRequirementView>, AppError> {
    if !state.config.demo_login_enabled || !user.is_demo {
        return Err(AppError::NotFound);
    }
    let month = crate::kst::parse_month(&body.month)
        .ok_or_else(|| AppError::InvalidRequest("month는 YYYY-MM이어야 합니다.".into()))?;
    let mut conn = state.pool.get().await?;
    Ok(Json(
        crate::routes::time_requirements::decide_month(&state, &mut conn, user.id, month).await?,
    ))
}

#[derive(Deserialize)]
pub struct SetStatus {
    status: String,
    review_comment: Option<String>,
    revision_doc_types: Option<Vec<String>>,
}

/// POST /api/dev/submissions/{id}/status — act as the reviewer on one of my submissions:
/// `approved`, or `revision_requested` with a required `review_comment` and optional
/// `revision_doc_types` (the documents the supplement must replace).
pub async fn set_status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<SetStatus>,
) -> Result<Json<SubmissionView>, AppError> {
    // demo users only: a real 42 user must never be able to approve their own submission
    if !state.config.demo_login_enabled || !user.is_demo {
        return Err(AppError::NotFound);
    }
    let id = parse_id(&id)?;
    let to: Status = match body.status.parse() {
        Ok(s @ (Status::Approved | Status::RevisionRequested)) => s,
        _ => {
            return Err(AppError::InvalidRequest(
                "status는 approved 또는 revision_requested여야 합니다.".into(),
            ));
        }
    };
    let comment = body
        .review_comment
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_owned);
    if to == Status::RevisionRequested {
        match &comment {
            None => {
                return Err(AppError::InvalidRequest(
                    "재검토 요청에는 review_comment가 필요합니다.".into(),
                ));
            }
            Some(c) if c.chars().count() > 1000 => {
                return Err(AppError::InvalidRequest(
                    "review_comment는 1000자 이하여야 합니다.".into(),
                ));
            }
            Some(_) => {}
        }
    }
    let revision_doc_types = body
        .revision_doc_types
        .unwrap_or_default()
        .iter()
        .map(|t| t.parse::<DocType>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::InvalidRequest("알 수 없는 doc_type입니다.".into()))?;

    let mut conn = state.pool.get().await?;
    let sub = conn
        .transaction::<_, AppError, _>(async move |conn| {
            let sub: Submission = submissions::table
                .filter(submissions::id.eq(id))
                .filter(submissions::user_id.eq(user.id))
                .for_update()
                .select(Submission::as_select())
                .first(conn)
                .await
                .optional()?
                .ok_or(AppError::NotFound)?;
            if !matches!(sub.status, Status::PendingReview | Status::Resubmitted) {
                return Err(AppError::InvalidState(
                    "검토 대기 중인 제출만 처리할 수 있습니다.".into(),
                ));
            }
            let required = non_null(sub.required_doc_types.clone());
            if !revision_doc_types.iter().all(|t| required.contains(t)) {
                return Err(AppError::InvalidRequest(
                    "revision_doc_types는 이 제출의 서류여야 합니다.".into(),
                ));
            }
            let (comment, revision_doc_types) = if to == Status::Approved {
                (None, Vec::new())
            } else {
                (comment, revision_doc_types)
            };

            diesel::update(submissions::table.find(id))
                .set((
                    submissions::status.eq(to),
                    submissions::review_comment.eq(&comment),
                    submissions::revision_doc_types
                        .eq(revision_doc_types.into_iter().map(Some).collect::<Vec<_>>()),
                ))
                .execute(conn)
                .await?;
            record(conn, id, Some(sub.status), to, user.id, comment).await?;

            // Approving a supplement also approves the originals it was answering.
            if to == Status::Approved {
                let mut parent = sub.parent_id;
                while let Some(parent_id) = parent {
                    let (status, next): (Status, Option<uuid::Uuid>) = submissions::table
                        .find(parent_id)
                        .for_update()
                        .select((submissions::status, submissions::parent_id))
                        .first(conn)
                        .await?;
                    if status != Status::Resubmitted {
                        break;
                    }
                    diesel::update(submissions::table.find(parent_id))
                        .set(submissions::status.eq(Status::Approved))
                        .execute(conn)
                        .await?;
                    let note = Some(format!("보완 제출 {id} 승인"));
                    record(
                        conn,
                        parent_id,
                        Some(status),
                        Status::Approved,
                        user.id,
                        note,
                    )
                    .await?;
                    parent = next;
                }
            }

            Ok(submissions::table
                .find(id)
                .select(Submission::as_select())
                .first(conn)
                .await?)
        })
        .await?;
    Ok(Json(SubmissionView::load(&mut conn, sub).await?))
}

async fn record(
    conn: &mut diesel_async::AsyncPgConnection,
    submission_id: uuid::Uuid,
    from: Option<Status>,
    to: Status,
    actor: i64,
    note: Option<String>,
) -> Result<(), AppError> {
    diesel::insert_into(submission_events::table)
        .values(NewSubmissionEvent {
            submission_id,
            from_status: from,
            to_status: to,
            actor_user_id: actor,
            idempotency_key: None,
            note,
        })
        .execute(conn)
        .await?;
    Ok(())
}

/// bankbook_file_id, key_id, size, sha256 of a pending account change
type StoredBankbook = (
    Option<uuid::Uuid>,
    Option<i16>,
    Option<i64>,
    Option<Vec<u8>>,
);

#[derive(Deserialize)]
pub struct ReviewBankAccount {
    decision: String,
    note: Option<String>,
}

/// POST /api/dev/me/bank-account/review — act as the 회계·지정 담당자 on my pending
/// account change: `approved` makes it the current account, `rejected` keeps the old one.
pub async fn review_bank_account(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<ReviewBankAccount>,
) -> Result<Json<crate::routes::account::BankAccountState>, AppError> {
    // demo users only: a real 42 user must never approve their own payout account
    if !state.config.demo_login_enabled || !user.is_demo {
        return Err(AppError::NotFound);
    }
    let decision = match body.decision.as_str() {
        d @ ("approved" | "rejected") => d,
        _ => {
            return Err(AppError::InvalidRequest(
                "decision은 approved 또는 rejected여야 합니다.".into(),
            ));
        }
    };
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_owned);
    if decision == "rejected" && note.is_none() {
        return Err(AppError::InvalidRequest(
            "반려에는 note가 필요합니다.".into(),
        ));
    }
    let mut conn = state.pool.get().await?;
    if decision == "approved" {
        // like finalize: only approve against a 통장사본 that is really on disk
        let file: Option<StoredBankbook> = bank_account_changes::table
            .filter(bank_account_changes::user_id.eq(user.id))
            .filter(bank_account_changes::status.eq("pending"))
            .select((
                bank_account_changes::bankbook_file_id,
                bank_account_changes::bankbook_key_id,
                bank_account_changes::bankbook_size_bytes,
                bank_account_changes::bankbook_sha256,
            ))
            .first(&mut conn)
            .await
            .optional()?;
        if let Some((Some(id), key_id, Some(size), Some(sha))) = file {
            let _permit = state
                .heavy_io
                .acquire()
                .await
                .map_err(anyhow::Error::from)?;
            crate::storage::verify(
                &state.config.upload_dir,
                id,
                key_id,
                size,
                &sha,
                &state.file_cipher,
            )
            .await?;
        }
    }
    let updated = diesel::update(
        bank_account_changes::table
            .filter(bank_account_changes::user_id.eq(user.id))
            .filter(bank_account_changes::status.eq("pending")),
    )
    .set((
        bank_account_changes::status.eq(decision),
        bank_account_changes::decided_at.eq(chrono::Utc::now()),
        bank_account_changes::decided_by.eq(user.id),
        bank_account_changes::decision_note.eq(note),
    ))
    .execute(&mut conn)
    .await?;
    if updated == 0 {
        return Err(AppError::InvalidState(
            "검토 대기 중인 계좌 변경이 없습니다.".into(),
        ));
    }
    Ok(Json(
        crate::routes::account::BankAccountState::load(&mut conn, user.id).await?,
    ))
}
