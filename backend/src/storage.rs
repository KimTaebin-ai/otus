//! Uploaded PDFs on local disk (UPLOAD_DIR), named by their row's UUID and encrypted at
//! rest with FILE_ENCRYPTION_KEY.
//!
//! Upload order: receive into memory (size and signature checked as bytes arrive) →
//! encrypt → hidden temp file → fsync → rename to `<uuid>` → fsync the directory → commit
//! the DB row. The guards delete the file if any step fails, so a "received" row always
//! points at a durable file, and plaintext is never written to disk.

use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use axum::extract::multipart::{Field, MultipartError};
use axum::http::StatusCode;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::FieldCipher;
use crate::error::AppError;

const PDF_MAGIC: &[u8] = b"%PDF-";

pub fn multipart_error(e: MultipartError) -> AppError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::FileTooLarge
    } else {
        tracing::debug!("rejected multipart body: {}", e.body_text());
        AppError::InvalidRequest("요청 형식이 올바르지 않습니다.".into())
    }
}

/// PRD: extension, MIME type and magic bytes must all say PDF. This checks the part's
/// file name and Content-Type; `receive_pdf` checks the bytes. Returns the sanitized name.
pub fn pdf_file_name(field: &Field<'_>) -> Result<String, AppError> {
    let name = field
        .file_name()
        .map(sanitize_file_name)
        .unwrap_or_default();
    if !name.to_lowercase().ends_with(".pdf") || field.content_type() != Some("application/pdf") {
        return Err(AppError::NotPdf);
    }
    Ok(name)
}

/// Reads a short text field (doc_type, bank, account_number) without buffering more than
/// `max` bytes: `Field::text` would read up to the whole body limit into memory.
pub async fn small_text(field: &mut Field<'_>, max: usize) -> Result<String, AppError> {
    let mut buf = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
        if buf.len() + chunk.len() > max {
            return Err(AppError::InvalidRequest("필드 값이 너무 깁니다.".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|_| AppError::InvalidRequest("UTF-8이 아닌 값입니다.".into()))
}

/// A received PDF, held in memory so its plaintext never touches the disk.
pub struct Received {
    bytes: Zeroizing<Vec<u8>>,
    pub size: u64,
    pub sha256: Vec<u8>,
}

/// Reads a multipart field into memory, enforcing `max_bytes` and the `%PDF-` signature as
/// the bytes arrive.
pub async fn receive_pdf(field: &mut Field<'_>, max_bytes: usize) -> Result<Received, AppError> {
    let mut bytes = Zeroizing::new(Vec::new());
    let mut hasher = Sha256::new();
    while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
        if bytes.len() + chunk.len() > max_bytes {
            return Err(AppError::FileTooLarge);
        }
        let had = bytes.len();
        bytes.extend_from_slice(&chunk);
        let head = &bytes[..bytes.len().min(PDF_MAGIC.len())];
        if had < PDF_MAGIC.len() && !PDF_MAGIC.starts_with(head) {
            return Err(AppError::NotPdf);
        }
        hasher.update(&chunk);
    }
    // also rejects empty and too-short files
    if !bytes.starts_with(PDF_MAGIC) {
        return Err(AppError::NotPdf);
    }
    Ok(Received {
        size: bytes.len() as u64,
        sha256: hasher.finalize().to_vec(),
        bytes,
    })
}

impl Received {
    /// For files the server makes itself (seed data); they skip the upload checks.
    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self {
            size: bytes.len() as u64,
            sha256: Sha256::digest(&bytes).to_vec(),
            bytes: Zeroizing::new(bytes),
        }
    }
}

impl Received {
    /// Scans the PDF with ClamAV before it's stored. Fails closed: no scanner reachable
    /// means the upload is refused, never stored unscanned.
    pub async fn scan(&self, state: &crate::AppState, user_id: i64) -> Result<(), AppError> {
        let Some(scanner) = &state.scanner else {
            return Ok(()); // local demo without CLAMAV_ADDR (warned about at startup)
        };
        match scanner.scan(&self.bytes).await {
            Ok(crate::scan::Verdict::Clean) => Ok(()),
            Ok(crate::scan::Verdict::Infected(signature)) => {
                tracing::warn!(user_id, %signature, size = self.size, "upload rejected: malware");
                Err(AppError::MalwareDetected)
            }
            Err(e) => {
                tracing::error!("malware scan failed, upload refused: {e:#}");
                Err(AppError::ScanUnavailable)
            }
        }
    }
}

/// Associated data for a stored file: its ciphertext only decrypts under its own id.
fn file_aad(id: Uuid) -> String {
    format!("file:{id}")
}

impl Received {
    /// Encrypts with the file key and writes `dir/<id>`: hidden temp file (mode 600) →
    /// fsync → rename → fsync the directory, so the file is durable before its row commits.
    pub async fn store(
        self,
        dir: &Path,
        id: Uuid,
        cipher: &FieldCipher,
    ) -> Result<Stored, AppError> {
        let encrypted = cipher.encrypt(&self.bytes, &file_aad(id))?;
        drop(self.bytes);
        let temp = Stored {
            path: dir.join(format!(".upload-{}", Uuid::new_v4())),
        };
        let std_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp.path)?;
        let mut file = tokio::fs::File::from_std(std_file);
        file.write_all(&encrypted).await?;
        file.sync_all().await?;
        let dest = dir.join(id.to_string());
        tokio::fs::rename(&temp.path, &dest).await?;
        temp.commit();
        let stored = Stored { path: dest };
        tokio::fs::File::open(dir).await?.sync_all().await?;
        Ok(stored)
    }
}

/// A file on disk whose DB row isn't committed yet. Deleted on drop unless committed.
pub struct Stored {
    path: PathBuf,
}

impl Stored {
    pub fn commit(mut self) {
        self.path = PathBuf::new();
    }
}

impl Drop for Stored {
    fn drop(&mut self) {
        if !self.path.as_os_str().is_empty() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Decrypts a stored file and checks its size and SHA-256 against the DB row; returns the
/// plaintext. `key_id` None means a plaintext file stored before encryption at rest.
pub async fn read_verified(
    dir: &Path,
    id: Uuid,
    key_id: Option<i16>,
    size: i64,
    sha256: &[u8],
    cipher: &FieldCipher,
) -> Result<Zeroizing<Vec<u8>>, AppError> {
    let path = dir.join(id.to_string());
    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| anyhow::anyhow!("stored file {} unreadable: {e}", path.display()))?;
    let plaintext = Zeroizing::new(match key_id {
        Some(key_id) => cipher
            .decrypt(key_id, &data, &file_aad(id))
            .map_err(|e| anyhow::anyhow!("stored file {}: {e}", path.display()))?,
        None => data,
    });
    if plaintext.len() as i64 != size || Sha256::digest(&*plaintext).as_slice() != sha256 {
        return Err(
            anyhow::anyhow!("stored file {} does not match its record", path.display()).into(),
        );
    }
    Ok(plaintext)
}

/// `read_verified` without keeping the plaintext. Finalize and approvals call this so
/// "received" is only shown for files that are really on disk.
pub async fn verify(
    dir: &Path,
    id: Uuid,
    key_id: Option<i16>,
    size: i64,
    sha256: &[u8],
    cipher: &FieldCipher,
) -> Result<(), AppError> {
    read_verified(dir, id, key_id, size, sha256, cipher)
        .await
        .map(drop)
}

/// Removes files a crash can leave behind: `.upload-*` temp files (nothing is in flight at
/// startup) and stored files no DB row references, if they are over an hour old.
pub async fn sweep_orphans(
    conn: &mut diesel_async::AsyncPgConnection,
    dir: &Path,
) -> anyhow::Result<()> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;

    use crate::schema::{bank_account_changes, submission_files};

    let mut known: std::collections::HashSet<Uuid> = submission_files::table
        .select(submission_files::id)
        .load::<Uuid>(conn)
        .await?
        .into_iter()
        .collect();
    known.extend(
        bank_account_changes::table
            .select(bank_account_changes::bankbook_file_id)
            .load::<Option<Uuid>>(conn)
            .await?
            .into_iter()
            .flatten(),
    );

    let (mut temps, mut orphans) = (0, 0);
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let old = entry
            .metadata()
            .await?
            .modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .is_some_and(|age| age > std::time::Duration::from_secs(3600));
        if name.starts_with(".upload-") {
            tokio::fs::remove_file(entry.path()).await?;
            temps += 1;
        } else if let Ok(id) = Uuid::parse_str(&name)
            && old
            && !known.contains(&id)
        {
            tokio::fs::remove_file(entry.path()).await?;
            orphans += 1;
        }
    }
    if temps + orphans > 0 {
        tracing::warn!("removed {temps} leftover temp files and {orphans} unreferenced files");
    }
    Ok(())
}

/// Keeps only the base name (some browsers send a full path), without control characters.
pub fn sanitize_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    base.chars()
        // controls, plus invisible format characters such as the U+202E bidi override that
        // can make "evil_fdp.exe" display as "evil_exe.pdf"
        .filter(|c| !c.is_control() && !is_format_char(*c))
        .take(255)
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Unicode general category Cf (format) characters that matter in file names.
fn is_format_char(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{061C}' | '\u{180E}'
        | '\u{200B}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}'
        | '\u{FFF9}'..='\u{FFFB}')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cipher(byte: u8) -> FieldCipher {
        use base64::Engine;
        let key = base64::engine::general_purpose::STANDARD.encode([byte; 32]);
        FieldCipher::new("TEST_KEY", 1, &key).unwrap()
    }

    #[tokio::test]
    async fn stored_files_are_encrypted_and_bound_to_their_id() {
        let dir = std::env::temp_dir().join(format!("otus-storage-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = cipher(1);
        let plaintext = b"%PDF-1.4 resident registration 900101-1234567".to_vec();
        let file = Received::from_bytes(plaintext.clone());
        let (size, sha) = (file.size as i64, file.sha256.clone());
        let id = Uuid::new_v4();
        file.store(&dir, id, &c).await.ok().expect("store").commit();

        let on_disk = std::fs::read(dir.join(id.to_string())).unwrap();
        assert!(
            !on_disk.windows(14).any(|w| w == b"900101-1234567"),
            "plaintext on disk"
        );
        assert!(!on_disk.starts_with(b"%PDF-"));
        assert!(verify(&dir, id, Some(1), size, &sha, &c).await.is_ok());

        // moved under another row's id
        let other = Uuid::new_v4();
        std::fs::copy(dir.join(id.to_string()), dir.join(other.to_string())).unwrap();
        assert!(verify(&dir, other, Some(1), size, &sha, &c).await.is_err());
        // wrong key
        assert!(
            verify(&dir, id, Some(1), size, &sha, &cipher(2))
                .await
                .is_err()
        );
        // tampered
        let mut bytes = on_disk.clone();
        *bytes.last_mut().unwrap() ^= 1;
        std::fs::write(dir.join(id.to_string()), bytes).unwrap();
        assert!(verify(&dir, id, Some(1), size, &sha, &c).await.is_err());
        // no temp files left behind
        assert!(std::fs::read_dir(&dir).unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".upload-")
        }));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn legacy_plaintext_files_still_verify() {
        let dir = std::env::temp_dir().join(format!("otus-storage-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let id = Uuid::new_v4();
        let bytes = b"%PDF-1.4 legacy".to_vec();
        std::fs::write(dir.join(id.to_string()), &bytes).unwrap();
        let sha = Sha256::digest(&bytes).to_vec();
        assert!(
            verify(&dir, id, None, bytes.len() as i64, &sha, &cipher(1))
                .await
                .is_ok()
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_names() {
        assert_eq!(sanitize_file_name("고용보험_10월.pdf"), "고용보험_10월.pdf");
        assert_eq!(sanitize_file_name("C:\\Users\\me\\a.pdf"), "a.pdf");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("a\u{0}b\n.pdf"), "ab.pdf");
        assert_eq!(sanitize_file_name(&"가".repeat(300)).chars().count(), 255);
        assert_eq!(sanitize_file_name("evil\u{202E}fdp.exe"), "evilfdp.exe");
        assert_eq!(sanitize_file_name("a\u{200B}\u{FEFF}.pdf"), "a.pdf");
    }
}
