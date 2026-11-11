//! Minimal staff API (issue #9): the RBAC surface FE's admin app calls first.
//! Every handler re-checks the DB role via `CurrentUser` + `require_staff`:
//! a student session gets 403, no session 401. Wider admin APIs (dashboard,
//! notices, records) stay as proposed in the issue attachments until agreed.

use axum::Json;
use axum::extract::{Path, Query, State};
use diesel::dsl::exists;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::domain::Role;
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::kst;
use crate::models::User;
use crate::routes::account::BankAccountState;
use crate::schema::{bank_account_changes, submissions, users};
use crate::session::{CurrentUser, require_staff};

#[derive(Deserialize)]
pub struct ListQuery {
    query: Option<String>,
    limit: Option<i64>,
    before: Option<i64>,
}

#[derive(Serialize)]
pub struct AdminUserSummary {
    id: i64,
    login: String,
    display_name: String,
    employed: bool,
    initial_submitted: bool,
    ordinal: Option<String>,
    ko_name: Option<String>,
    date_of_birth: Option<chrono::NaiveDate>,
}

#[derive(Serialize)]
pub struct ListResponse {
    items: Vec<AdminUserSummary>,
    next_before: Option<i64>,
}

fn clamp_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(20).clamp(1, 50)
}

/// Substring-match pattern for the user search: `%` and `_` in the typed
/// text are escaped so they match literally, never as LIKE wildcards.
/// Postgres `ILIKE` folds case (Latin) and matches Korean text as-is.
fn like_pattern(needle: &str) -> String {
    format!("%{}%", needle.replace('%', "\\%").replace('_', "\\_"))
}

async fn initial_submitted(
    conn: &mut diesel_async::AsyncPgConnection,
    user_id: i64,
) -> Result<bool, AppError> {
    Ok(diesel::select(exists(
        submissions::table
            .filter(submissions::user_id.eq(user_id))
            .filter(submissions::kind.eq("initial"))
            .filter(submissions::status.ne("draft")),
    ))
    .get_result(conn)
    .await?)
}

/// GET /api/admin/users — students only, newest first. Staff only.
pub async fn list_users(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<ListResponse>, AppError> {
    require_staff(&user)?;
    let limit = clamp_limit(q.limit);
    let mut conn = state.pool.get().await?;
    let mut query = users::table
        .filter(users::role.eq(Role::Student))
        .into_boxed();
    if let Some(needle) = q.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        // 교육생 검색: intra ID(login), 표시 이름, 한글 이름(ko_name) 부분 일치
        let pattern = like_pattern(needle);
        query = query.filter(
            users::login
                .ilike(pattern.clone())
                .or(users::display_name.ilike(pattern.clone()))
                .or(users::ko_name.ilike(pattern)),
        );
    }
    if let Some(before) = q.before {
        query = query.filter(users::id.lt(before));
    }
    let rows: Vec<User> = query
        .order(users::id.desc())
        .limit(limit + 1)
        .select(User::as_select())
        .load(&mut conn)
        .await?;
    let next_before = (rows.len() as i64 > limit).then(|| rows[limit as usize - 1].id);
    let mut items = Vec::new();
    for u in rows.into_iter().take(limit as usize) {
        let initial = initial_submitted(&mut conn, u.id).await?;
        items.push(AdminUserSummary {
            id: u.id,
            login: u.login,
            display_name: u.display_name,
            employed: u.employed,
            initial_submitted: initial,
            ordinal: u.ordinal.clone(),
            ko_name: u.ko_name.clone(),
            date_of_birth: u.date_of_birth,
        });
    }
    Ok(Json(ListResponse { items, next_before }))
}

#[derive(Serialize)]
pub struct AdminUserDetail {
    id: i64,
    login: String,
    display_name: String,
    role: Role,
    employed: bool,
    #[serde(serialize_with = "kst::serialize_opt")]
    employment_updated_at: Option<chrono::DateTime<chrono::Utc>>,
    initial_submitted: bool,
    ordinal: Option<String>,
    ko_name: Option<String>,
    date_of_birth: Option<chrono::NaiveDate>,
}

/// GET /api/admin/users/{id} — a student, or 404 (staff accounts are not listed here).
pub async fn get_user(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<AdminUserDetail>, AppError> {
    require_staff(&user)?;
    let id: i64 = id.parse().map_err(|_| AppError::NotFound)?;
    let mut conn = state.pool.get().await?;
    let target: User = users::table
        .find(id)
        .filter(users::role.eq(Role::Student))
        .select(User::as_select())
        .first(&mut conn)
        .await
        .optional()?
        .ok_or(AppError::NotFound)?;
    let initial = initial_submitted(&mut conn, target.id).await?;
    Ok(Json(AdminUserDetail {
        id: target.id,
        login: target.login,
        display_name: target.display_name,
        role: target.role,
        employed: target.employed,
        employment_updated_at: target.employment_updated_at,
        initial_submitted: initial,
        ordinal: target.ordinal.clone(),
        ko_name: target.ko_name.clone(),
        date_of_birth: target.date_of_birth,
    }))
}

/// GET /api/admin/users/{id}/bank-account — the student's account as the student sees it
/// (`GET /api/me/bank-account`): the number is only ever the masked last four digits.
pub async fn get_user_bank_account(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<BankAccountState>, AppError> {
    require_staff(&user)?;
    let id: i64 = id.parse().map_err(|_| AppError::NotFound)?;
    let mut conn = state.pool.get().await?;
    let exists = users::table
        .find(id)
        .filter(users::role.eq(Role::Student))
        .select(users::id)
        .first::<i64>(&mut conn)
        .await
        .optional()?;
    exists.ok_or(AppError::NotFound)?;
    Ok(Json(BankAccountState::load(&mut conn, id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewBankAccount {
    /// the pending request being decided (`pending.id` of the account response)
    request_id: i64,
    decision: String,
    note: Option<String>,
}

/// The longest 반려 사유 (the student reads it as written)
const BANK_NOTE_MAX: usize = 1000;

/// POST /api/admin/users/{id}/bank-account/review — approve or reject the student's pending
/// 계좌 변경. Approving makes it the account in use; rejecting keeps the old one and needs a
/// reason. Operator and accountant only (admin does not review). The request is named by id and
/// decided with a single compare-and-set, so a request the student replaced meanwhile, or one
/// another staff member decided first, is a 409 and never gets approved by mistake.
pub async fn review_user_bank_account(
    State(state): State<AppState>,
    CurrentUser(staff): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<ReviewBankAccount>,
) -> Result<Json<BankAccountState>, AppError> {
    require_staff(&staff)?;
    if !staff.role.can_view_originals() {
        return Err(AppError::Forbidden);
    }
    let id: i64 = id.parse().map_err(|_| AppError::NotFound)?;
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
            "반려에는 사유(note)가 필요합니다.".into(),
        ));
    }
    if decision == "approved" && note.is_some() {
        return Err(AppError::InvalidRequest(
            "승인에는 사유를 적을 수 없습니다.".into(),
        ));
    }
    if note
        .as_deref()
        .is_some_and(|n| n.chars().count() > BANK_NOTE_MAX)
    {
        return Err(AppError::InvalidRequest(format!(
            "사유는 {BANK_NOTE_MAX}자 이하여야 합니다."
        )));
    }
    let mut conn = state.pool.get().await?;
    let student = users::table
        .find(id)
        .filter(users::role.eq(Role::Student))
        .select(users::id)
        .first::<i64>(&mut conn)
        .await
        .optional()?;
    student.ok_or(AppError::NotFound)?;
    type Stored = (
        String,
        Option<uuid::Uuid>,
        Option<i16>,
        Option<i64>,
        Option<Vec<u8>>,
    );
    let pending: Option<Stored> = bank_account_changes::table
        .filter(bank_account_changes::id.eq(body.request_id))
        .filter(bank_account_changes::user_id.eq(id))
        .select((
            bank_account_changes::status,
            bank_account_changes::bankbook_file_id,
            bank_account_changes::bankbook_key_id,
            bank_account_changes::bankbook_size_bytes,
            bank_account_changes::bankbook_sha256,
        ))
        .first(&mut conn)
        .await
        .optional()?;
    let (status, file_id, key_id, size, sha) = pending.ok_or(AppError::NotFound)?;
    if status != "pending" {
        return Err(AppError::InvalidState(
            "이미 처리됐거나 새 요청으로 바뀐 계좌 변경입니다.".into(),
        ));
    }
    if decision == "approved" {
        // like finalize: only approve against a 통장사본 that is really on disk and intact
        if let (Some(file_id), Some(size), Some(sha)) = (file_id, size, sha) {
            let _permit = state
                .heavy_io
                .acquire()
                .await
                .map_err(anyhow::Error::from)?;
            crate::storage::verify(
                &state.config.upload_dir,
                file_id,
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
            .filter(bank_account_changes::id.eq(body.request_id))
            .filter(bank_account_changes::user_id.eq(id))
            .filter(bank_account_changes::status.eq("pending")),
    )
    .set((
        bank_account_changes::status.eq(decision),
        bank_account_changes::decided_at.eq(chrono::Utc::now()),
        bank_account_changes::decided_by.eq(staff.id),
        bank_account_changes::decision_note.eq(note),
    ))
    .execute(&mut conn)
    .await?;
    if updated == 0 {
        return Err(AppError::InvalidState(
            "이미 처리됐거나 새 요청으로 바뀐 계좌 변경입니다.".into(),
        ));
    }
    Ok(Json(BankAccountState::load(&mut conn, id).await?))
}

#[derive(Serialize)]
pub struct ActivityUser {
    id: i64,
    login: String,
    display_name: String,
}

#[derive(Serialize)]
pub struct ActivityItem {
    /// Stable across polls, so the client can tell what it has already seen.
    id: String,
    /// `employment_changed` or `bank_account_requested`
    kind: &'static str,
    user: ActivityUser,
    #[serde(serialize_with = "kst::serialize")]
    occurred_at: chrono::DateTime<chrono::Utc>,
    /// `employment_changed`: `{employed}`. `bank_account_requested`: `{status}`. Never the number.
    data: serde_json::Value,
}

#[derive(Serialize)]
pub struct ActivityResponse {
    items: Vec<ActivityItem>,
}

const ACTIVITY_DAYS: i64 = 30;

/// GET /api/admin/activity — recent employment-status changes and bank-account change requests,
/// newest first (last 30 days, at most 50). Staff only. Read-only; the account number is never
/// part of the response.
pub async fn activity(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<ActivityResponse>, AppError> {
    require_staff(&user)?;
    let limit = clamp_limit(q.limit);
    let since = chrono::Utc::now() - chrono::Duration::days(ACTIVITY_DAYS);
    let mut conn = state.pool.get().await?;

    let employment: Vec<User> = users::table
        .filter(users::role.eq(Role::Student))
        .filter(users::employment_updated_at.ge(since))
        .order(users::employment_updated_at.desc())
        .limit(limit)
        .select(User::as_select())
        .load(&mut conn)
        .await?;
    let banks: Vec<(i64, i64, String, chrono::DateTime<chrono::Utc>)> = bank_account_changes::table
        .filter(bank_account_changes::requested_at.ge(since))
        .order(bank_account_changes::requested_at.desc())
        .limit(limit)
        .select((
            bank_account_changes::id,
            bank_account_changes::user_id,
            bank_account_changes::status,
            bank_account_changes::requested_at,
        ))
        .load(&mut conn)
        .await?;

    let bank_user_ids: Vec<i64> = banks.iter().map(|b| b.1).collect();
    let bank_users: Vec<User> = users::table
        .filter(users::id.eq_any(bank_user_ids))
        .filter(users::role.eq(Role::Student))
        .select(User::as_select())
        .load(&mut conn)
        .await?;

    let mut items = Vec::new();
    for u in employment {
        let Some(at) = u.employment_updated_at else {
            continue;
        };
        items.push(ActivityItem {
            id: format!("employment:{}:{}", u.id, at.timestamp_millis()),
            kind: "employment_changed",
            data: serde_json::json!({ "employed": u.employed }),
            occurred_at: at,
            user: ActivityUser {
                id: u.id,
                login: u.login,
                display_name: u.display_name,
            },
        });
    }
    for (id, user_id, status, at) in banks {
        let Some(u) = bank_users.iter().find(|u| u.id == user_id) else {
            continue;
        };
        items.push(ActivityItem {
            id: format!("bank:{id}"),
            kind: "bank_account_requested",
            data: serde_json::json!({ "status": status }),
            occurred_at: at,
            user: ActivityUser {
                id: u.id,
                login: u.login.clone(),
                display_name: u.display_name.clone(),
            },
        });
    }
    items.sort_by_key(|a| std::cmp::Reverse(a.occurred_at));
    items.truncate(limit as usize);
    Ok(Json(ActivityResponse { items }))
}

#[cfg(test)]
mod tests {
    use super::{clamp_limit, like_pattern};
    #[test]
    fn limit_is_clamped() {
        assert_eq!(clamp_limit(None), 20);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(999)), 50);
    }

    #[test]
    fn search_pattern_wraps_for_substring_match() {
        // partial intra ID and partial Korean name both become %…% patterns
        assert_eq!(like_pattern("dong"), "%dong%");
        assert_eq!(like_pattern("동민"), "%동민%");
    }

    #[test]
    fn search_pattern_escapes_like_wildcards() {
        // typed % and _ are literals, not wildcards: "100%" must not match all
        assert_eq!(like_pattern("100%"), "%100\\%%");
        assert_eq!(like_pattern("a_b"), "%a\\_b%");
        assert_eq!(like_pattern("%_"), "%\\%\\_%");
    }
}
