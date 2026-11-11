//! U06 사용자 설정: 취업 상태 and 계좌.
//!
//! Account numbers are encrypted at rest and only ever leave the API masked
//! (`•••• 1234`). A change is a request that takes effect after review; until then the
//! previously approved account stays in use (PRD: 승인 전 기존 정보 유지).

use axum::Json;
use axum::extract::multipart::MultipartRejection;
use axum::extract::{Multipart, State};
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::crypto::bank_account_aad;
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::kst;
use crate::models::{BankAccountChange, User};
use crate::routes::me::Me;
use crate::schema::{bank_account_changes, users};
use crate::session::CurrentUser;
use crate::storage;

#[derive(Deserialize)]
pub struct SetEmployment {
    employed: bool,
}

/// PATCH /api/me/employment — saved immediately.
pub async fn set_employment(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<SetEmployment>,
) -> Result<Json<Me>, AppError> {
    let mut conn = state.pool.get().await?;
    let user: User = diesel::update(users::table.find(user.id))
        .set((
            users::employed.eq(body.employed),
            users::employment_updated_at.eq(Utc::now()),
        ))
        .returning(User::as_returning())
        .get_result(&mut conn)
        .await?;
    drop(conn);
    Ok(Json(Me::load(&state, user).await?))
}

#[derive(Serialize)]
pub struct AccountView {
    /// the request's id; staff name it when deciding, so a newer request is never approved by mistake
    id: i64,
    bank: String,
    /// never the full number
    account_number_masked: String,
    status: String,
    #[serde(serialize_with = "kst::serialize")]
    requested_at: DateTime<Utc>,
    #[serde(serialize_with = "kst::serialize_opt")]
    decided_at: Option<DateTime<Utc>>,
    /// reason shown when a request was rejected
    decision_note: Option<String>,
    /// the 통장사본 submitted with the request (null only for pre-migration requests)
    bankbook: Option<BankbookView>,
}

#[derive(Serialize)]
pub struct BankbookView {
    file_id: Uuid,
    original_name: String,
    size: i64,
}

impl From<BankAccountChange> for AccountView {
    fn from(c: BankAccountChange) -> Self {
        Self {
            id: c.id,
            bank: c.bank,
            account_number_masked: mask(&c.account_last4),
            status: c.status,
            requested_at: c.requested_at,
            decided_at: c.decided_at,
            decision_note: c.decision_note,
            bankbook: match (
                c.bankbook_file_id,
                c.bankbook_original_name,
                c.bankbook_size_bytes,
            ) {
                (Some(file_id), Some(original_name), Some(size)) => Some(BankbookView {
                    file_id,
                    original_name,
                    size,
                }),
                _ => None,
            },
        }
    }
}

fn mask(last4: &str) -> String {
    format!("•••• {last4}")
}

#[derive(Serialize)]
pub struct BankAccountState {
    /// the approved account in use for payment; null until one is approved
    current: Option<AccountView>,
    /// a change awaiting review
    pending: Option<AccountView>,
    /// the most recent rejected request, if it is newer than the current account
    last_rejected: Option<AccountView>,
}

impl BankAccountState {
    pub async fn load(conn: &mut AsyncPgConnection, user_id: i64) -> Result<Self, AppError> {
        let latest = |status: &'static str| {
            bank_account_changes::table
                .filter(bank_account_changes::user_id.eq(user_id))
                .filter(bank_account_changes::status.eq(status))
                .order((
                    bank_account_changes::decided_at.desc().nulls_last(),
                    bank_account_changes::id.desc(),
                ))
                .select(BankAccountChange::as_select())
        };
        let current = latest("approved").first(conn).await.optional()?;
        let pending = latest("pending").first(conn).await.optional()?;
        let rejected = latest("rejected").first(conn).await.optional()?;
        let last_rejected = rejected.filter(|r: &BankAccountChange| {
            current
                .as_ref()
                .is_none_or(|c: &BankAccountChange| r.decided_at > c.decided_at)
        });
        Ok(Self {
            current: current.map(AccountView::from),
            pending: pending.map(AccountView::from),
            last_rejected: last_rejected.map(AccountView::from),
        })
    }
}

/// GET /api/me/bank-account
pub async fn get_bank_account(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<BankAccountState>, AppError> {
    let mut conn = state.pool.get().await?;
    Ok(Json(BankAccountState::load(&mut conn, user.id).await?))
}

/// Each request stores a bankbook PDF, so cap them per user per day.
const MAX_REQUESTS_PER_DAY: i64 = 5;

/// Digits only, without the `-` and spaces people type.
fn normalize_account_number(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| !matches!(c, '-' | ' ')).collect();
    let valid = (8..=20).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit());
    valid.then_some(digits)
}

fn validate_bank(raw: &str) -> Result<String, AppError> {
    let bank = raw.trim();
    if bank.is_empty() || bank.chars().count() > 30 || bank.chars().any(char::is_control) {
        return Err(AppError::InvalidRequest(
            "은행 이름은 1~30자여야 합니다.".into(),
        ));
    }
    Ok(bank.to_owned())
}

/// PUT /api/me/bank-account — multipart `bank`, `account_number`, `file` (new 통장사본 PDF).
/// Creates a pending change (replacing any pending one); the approved account stays in use.
pub async fn request_change(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<Json<BankAccountState>, AppError> {
    let mut multipart = multipart
        .map_err(|_| AppError::InvalidRequest("multipart/form-data 요청이어야 합니다.".into()))?;
    // the whole PDF is held in memory until it's encrypted and written
    let _permit = state
        .heavy_io
        .acquire()
        .await
        .map_err(anyhow::Error::from)?;
    let (mut bank, mut digits, mut upload) = (None, None, None);
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(storage::multipart_error)?
    {
        match field.name() {
            Some("bank") => {
                let value = storage::small_text(&mut field, 256).await?;
                bank = Some(validate_bank(&value)?);
            }
            Some("account_number") => {
                let value = storage::small_text(&mut field, 64).await?;
                digits = Some(normalize_account_number(&value).ok_or_else(|| {
                    AppError::InvalidRequest("계좌번호는 숫자 8~20자리여야 합니다.".into())
                })?);
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
    let (Some(bank), Some(digits), Some((original_name, received))) = (bank, digits, upload) else {
        return Err(AppError::InvalidRequest(
            "bank, account_number, file(통장사본)이 모두 필요합니다.".into(),
        ));
    };

    received.scan(&state, user.id).await?;
    let encrypted = state
        .bank_cipher
        .encrypt(digits.as_bytes(), &bank_account_aad(user.id))?;
    let last4 = digits[digits.len() - 4..].to_owned();
    let key_id = state.bank_cipher.key_id();
    let file_id = Uuid::new_v4();
    let (size, sha256) = (received.size as i64, received.sha256.clone());
    let file_key_id = state.file_cipher.key_id();
    let stored = received
        .store(&state.config.upload_dir, file_id, &state.file_cipher)
        .await?;

    let mut conn = state.pool.get().await?;
    conn.transaction::<_, AppError, _>(async move |conn| {
        // serialize this user's requests so the daily cap can't be raced past
        users::table
            .find(user.id)
            .select(users::id)
            .for_update()
            .first::<i64>(conn)
            .await?;
        let today: i64 = bank_account_changes::table
            .filter(bank_account_changes::user_id.eq(user.id))
            .filter(bank_account_changes::requested_at.gt(Utc::now() - chrono::TimeDelta::days(1)))
            .count()
            .get_result(conn)
            .await?;
        if today >= MAX_REQUESTS_PER_DAY {
            return Err(AppError::InvalidState(format!(
                "계좌 변경 요청은 하루 {MAX_REQUESTS_PER_DAY}번까지 할 수 있습니다."
            )));
        }
        diesel::update(
            bank_account_changes::table
                .filter(bank_account_changes::user_id.eq(user.id))
                .filter(bank_account_changes::status.eq("pending")),
        )
        .set(bank_account_changes::status.eq("cancelled"))
        .execute(conn)
        .await?;
        diesel::insert_into(bank_account_changes::table)
            .values((
                bank_account_changes::user_id.eq(user.id),
                bank_account_changes::bank.eq(bank),
                bank_account_changes::account_number_enc.eq(encrypted),
                bank_account_changes::key_id.eq(key_id),
                bank_account_changes::account_last4.eq(last4),
                bank_account_changes::bankbook_file_id.eq(file_id),
                bank_account_changes::bankbook_original_name.eq(original_name),
                bank_account_changes::bankbook_size_bytes.eq(size),
                bank_account_changes::bankbook_sha256.eq(sha256),
                bank_account_changes::bankbook_key_id.eq(file_key_id),
            ))
            .execute(conn)
            .await?;
        Ok(())
    })
    .await?;
    stored.commit();
    Ok(Json(BankAccountState::load(&mut conn, user.id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_numbers() {
        assert_eq!(
            normalize_account_number("110-123-456789").as_deref(),
            Some("110123456789")
        );
        assert_eq!(
            normalize_account_number(" 3333 01 2345678 ").as_deref(),
            Some("3333012345678")
        );
        assert_eq!(normalize_account_number("1234567"), None);
        assert_eq!(normalize_account_number("110-12a-456789"), None);
        assert_eq!(normalize_account_number(&"1".repeat(21)), None);
    }

    #[test]
    fn masks_show_only_last_four() {
        assert_eq!(mask("6789"), "•••• 6789");
    }
}
