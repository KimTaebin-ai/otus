//! GET /api/files/{id}: download an original document (submission file or bankbook copy).
//!
//! Permission is checked on every request against the DB (the session only names the
//! user): the owner, or staff (`operator`·`accountant`·`admin`). Anyone else gets the same
//! 404 as for an unknown id, so file ids can't be probed. Every download is recorded in
//! the append-only file_access_log, and the file is decrypted and integrity-checked first.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, header};
use axum::response::Response;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use uuid::Uuid;

use crate::AppState;
use crate::error::AppError;
use crate::routes::submissions::parse_id;
use crate::schema::{bank_account_changes, file_access_log, submission_files, submissions};
use crate::session::CurrentUser;
use crate::storage;

/// owner, original name, key id, size, sha256
type FileRecord = (i64, String, Option<i16>, i64, Vec<u8>);
/// the same from bank_account_changes, where the bankbook columns are nullable
type BankbookRecord = (
    i64,
    Option<String>,
    Option<i16>,
    Option<i64>,
    Option<Vec<u8>>,
);

async fn find(
    conn: &mut diesel_async::AsyncPgConnection,
    id: Uuid,
    viewer_id: i64,
) -> Result<Option<FileRecord>, AppError> {
    let submission_file = submission_files::table
        .inner_join(submissions::table)
        .filter(submission_files::id.eq(id))
        .filter(
            submissions::user_id
                .eq(viewer_id)
                .or(submissions::status.ne("draft")),
        )
        .select((
            submissions::user_id,
            submission_files::original_name,
            submission_files::key_id,
            submission_files::size_bytes,
            submission_files::sha256,
        ))
        .first::<FileRecord>(conn)
        .await
        .optional()?;
    if submission_file.is_some() {
        return Ok(submission_file);
    }
    let bankbook: Option<BankbookRecord> = bank_account_changes::table
        .filter(bank_account_changes::bankbook_file_id.eq(id))
        .select((
            bank_account_changes::user_id,
            bank_account_changes::bankbook_original_name,
            bank_account_changes::bankbook_key_id,
            bank_account_changes::bankbook_size_bytes,
            bank_account_changes::bankbook_sha256,
        ))
        .first(conn)
        .await
        .optional()?;
    Ok(match bankbook {
        Some((owner, Some(name), key_id, Some(size), Some(sha))) => {
            Some((owner, name, key_id, size, sha))
        }
        _ => None,
    })
}

pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let id = parse_id(&id)?;
    let mut conn = state.pool.get().await?;
    let (owner, name, key_id, size, sha) = find(&mut conn, id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    // per-request DB role check (CurrentUser re-reads users.role); never by IP.
    // Non-viewers get the same 404 as an unknown id, so file ids can't be probed.
    let basis = if user.id == owner {
        "owner"
    } else if user.role.can_download_files() {
        user.role.as_str()
    } else {
        return Err(AppError::NotFound);
    };

    let bytes = {
        let _permit = state
            .heavy_io
            .acquire()
            .await
            .map_err(anyhow::Error::from)?;
        storage::read_verified(
            &state.config.upload_dir,
            id,
            key_id,
            size,
            &sha,
            &state.file_cipher,
        )
        .await?
    };
    // recorded before the response leaves: a download that can't be logged doesn't happen
    diesel::insert_into(file_access_log::table)
        .values((
            file_access_log::file_id.eq(id),
            file_access_log::accessed_by.eq(user.id),
            file_access_log::owner_id.eq(owner),
            file_access_log::access_basis.eq(basis),
        ))
        .execute(&mut conn)
        .await?;
    tracing::info!(user_id = user.id, owner_id = owner, %id, basis, "file downloaded");

    let mut response = Response::new(Body::from(bytes.to_vec()));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&content_disposition(&name)).map_err(anyhow::Error::from)?,
    );
    // never rendered in our origin: even a PDF with active content runs in a sandbox with
    // nothing allowed, and only as a download
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, private"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    Ok(response)
}

/// `attachment` with an ASCII fallback name and the real (often Korean) name per RFC 5987.
/// Only unreserved characters survive unescaped, so nothing can break out of the header.
fn content_disposition(name: &str) -> String {
    let fallback: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    // a fallback with nothing readable left (e.g. an all-Korean name) becomes document.pdf
    let stem = fallback.strip_suffix(".pdf").unwrap_or_default();
    let fallback = if stem.chars().any(|c| c.is_ascii_alphanumeric()) {
        fallback
    } else {
        "document.pdf".to_owned()
    };
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}

#[cfg(test)]
mod tests {
    use super::content_disposition;

    #[test]
    fn content_disposition_is_safe() {
        assert_eq!(
            content_disposition("통장사본.pdf"),
            "attachment; filename=\"document.pdf\"; filename*=UTF-8''%ED%86%B5%EC%9E%A5%EC%82%AC%EB%B3%B8.pdf"
        );
        assert_eq!(
            content_disposition("id_card-2.pdf"),
            "attachment; filename=\"id_card-2.pdf\"; filename*=UTF-8''id_card-2.pdf"
        );
        // header injection and quote breaking can't survive
        let evil = content_disposition("a\"; filename=x.exe\r\nSet-Cookie: s=1.pdf");
        assert!(!evil.contains('\r') && !evil.contains('\n'));
        assert!(
            evil.starts_with("attachment; filename=\"a___filename_x.exe__Set-Cookie__s_1.pdf\"")
        );
        assert_eq!(evil.matches('"').count(), 2);
    }
}
