//! Bounded, encrypted monthly exports. The persisted snapshot contains only files
//! actually finalized; plaintext PDFs and ZIPs never touch disk.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, Seek, SeekFrom, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::body::Body;
use chrono::{DateTime, Datelike, NaiveDate, TimeDelta, Utc};
use diesel::prelude::*;
use diesel::sql_types::{Array, BigInt, Binary, Bool, Date, Nullable, SmallInt, Text, Timestamptz};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncWriteExt, ReadBuf};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::io::ReaderStream;
use unicode_general_category::{GeneralCategory, get_general_category};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zeroize::Zeroizing;
use zip::write::SimpleFileOptions;

use crate::AppState;
use crate::admin_data::{self, SubmissionChain, SubmittedFile};
use crate::domain::{DocType, Kind, Role, Status};
use crate::error::AppError;
use crate::kst;
use crate::storage;

pub struct ArchiveConfig {
    pub max_users: usize,
    /// Both input bytes and the resulting ZIP must stay below this limit. The
    /// existing whole-buffer cipher can briefly use about three times this value.
    pub max_bytes: usize,
    pub ttl_seconds: i64,
    pub request_interval_seconds: i64,
}

impl ArchiveConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        fn value(name: &str, default: usize) -> anyhow::Result<usize> {
            let value = match std::env::var(name) {
                Ok(value) => value
                    .parse::<usize>()
                    .map_err(|_| anyhow::anyhow!("{name} must be a positive integer"))?,
                Err(std::env::VarError::NotPresent) => default,
                Err(_) => anyhow::bail!("{name} must be UTF-8"),
            };
            anyhow::ensure!(
                value > 0 && value <= i64::MAX as usize,
                "{name} is out of range"
            );
            Ok(value)
        }
        let config = Self {
            max_users: value("MAX_EXPORT_USERS", 100)?,
            max_bytes: value("MAX_EXPORT_BYTES", 256 * 1024 * 1024)?,
            ttl_seconds: value("EXPORT_TTL_SECONDS", 15 * 60)? as i64,
            request_interval_seconds: value("EXPORT_REQUEST_INTERVAL_SECONDS", 5 * 60)? as i64,
        };
        anyhow::ensure!(
            TimeDelta::try_seconds(config.ttl_seconds).is_some(),
            "EXPORT_TTL_SECONDS is out of range"
        );
        anyhow::ensure!(
            TimeDelta::try_seconds(config.request_interval_seconds).is_some(),
            "EXPORT_REQUEST_INTERVAL_SECONDS is out of range"
        );
        Ok(config)
    }
}

pub struct ArchiveRuntime {
    pub config: ArchiveConfig,
    /// One generation or download body at a time, including cancelled/slow bodies.
    memory: Arc<Semaphore>,
}

impl ArchiveRuntime {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            config: ArchiveConfig::from_env()?,
            memory: Arc::new(Semaphore::new(1)),
        })
    }

    pub fn acquire(&self) -> Result<OwnedSemaphorePermit, AppError> {
        self.memory
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::RateLimited { retry_after: 30 })
    }
}

pub fn require_accountant(role: Role) -> Result<(), AppError> {
    if role == Role::Accountant {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

pub fn parse_month(value: &str) -> Result<NaiveDate, AppError> {
    let canonical = value.len() == 7
        && value.bytes().enumerate().all(|(i, b)| {
            if i == 4 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    canonical
        .then(|| kst::parse_month(value))
        .flatten()
        .filter(|m| m.year() >= 1)
        .ok_or_else(|| AppError::InvalidRequest("month는 YYYY-MM이어야 합니다.".into()))
}

/// Filters apply to each chain's latest finalized submission, before grouping
/// students or resolving optional previous/base files.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveFilters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

impl ArchiveFilters {
    pub fn validate(&mut self) -> Result<(), AppError> {
        fn normalize(
            filter: &mut Option<String>,
            name: &str,
            valid: impl Fn(&str) -> bool,
        ) -> Result<(), AppError> {
            let Some(value) = filter.as_deref() else {
                return Ok(());
            };
            if value == "all" {
                *filter = None;
                return Ok(());
            }
            let mut values: Vec<_> = value.split(',').collect();
            if values.iter().any(|value| !valid(value)) {
                return Err(AppError::InvalidRequest(format!(
                    "{name} 필터가 올바르지 않습니다."
                )));
            }
            // Equivalent checkbox sets must replay the same idempotent request.
            values.sort_unstable();
            values.dedup();
            *filter = Some(values.join(","));
            Ok(())
        }
        normalize(
            &mut self.status,
            "status",
            |value| matches!(value.parse::<Status>(), Ok(status) if status != Status::Draft),
        )?;
        normalize(&mut self.kind, "kind", |value| {
            value.parse::<Kind>().is_ok()
        })?;
        Ok(())
    }

    fn is_empty(&self) -> bool {
        self.status.is_none() && self.kind.is_none()
    }

    fn matches(&self, status: Status, kind: Kind) -> bool {
        self.status
            .as_deref()
            .is_none_or(|value| value.split(',').any(|item| item == status.as_str()))
            && self
                .kind
                .as_deref()
                .is_none_or(|value| value.split(',').any(|item| item == kind.as_str()))
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    pub user_ids: Vec<i64>,
    pub include_base_docs: bool,
    pub include_previous: bool,
    pub expected_pdf_count: usize,
    // Omission preserves fingerprints and snapshots of existing unfiltered jobs.
    #[serde(default, skip_serializing_if = "ArchiveFilters::is_empty")]
    pub filters: ArchiveFilters,
}

impl ExportRequest {
    pub fn validate(&mut self, config: &ArchiveConfig) -> Result<(), AppError> {
        self.filters.validate()?;
        if self.user_ids.is_empty()
            || self.user_ids.len() > config.max_users
            || self.user_ids.iter().any(|id| *id <= 0)
        {
            return Err(AppError::InvalidRequest(format!(
                "교육생을 1명 이상 {}명 이하로 선택해 주세요.",
                config.max_users
            )));
        }
        self.user_ids.sort_unstable();
        if self.user_ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(AppError::InvalidRequest(
                "user_ids에 같은 교육생이 중복되었습니다.".into(),
            ));
        }
        if self.expected_pdf_count == 0 {
            return Err(AppError::InvalidRequest(
                "expected_pdf_count는 1 이상이어야 합니다.".into(),
            ));
        }
        Ok(())
    }

    pub fn fingerprint(&self, month: NaiveDate) -> Result<Vec<u8>, AppError> {
        Ok(Sha256::digest(serde_json::to_vec(&(month, self))?).to_vec())
    }
}

#[derive(Serialize)]
pub struct ArchiveView {
    #[serde(serialize_with = "kst::serialize_month")]
    pub month: NaiveDate,
    pub months: Vec<String>,
    pub rows: Vec<ArchiveRow>,
}

#[derive(Serialize)]
pub struct ArchiveRow {
    pub user_id: i64,
    pub name: String,
    pub login: String,
    pub files: Vec<DocType>,
    pub base_docs: Vec<DocType>,
    pub previous: Vec<DocType>,
    #[serde(serialize_with = "kst::serialize")]
    pub submitted_at: DateTime<Utc>,
    pub status: Status,
    pub kinds: Vec<Kind>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SnapshotFile {
    pub id: Uuid,
    pub owner_id: i64,
    pub size_bytes: i64,
    pub sha256: Vec<u8>,
    pub key_id: Option<i16>,
    pub doc_type: String,
    pub kind: String,
    pub submitted_at: DateTime<Utc>,
    pub status: String,
    /// current / base / previous
    pub category: String,
    pub path: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SnapshotStudent {
    pub user_id: i64,
    pub name: String,
    pub login: String,
    pub folder: String,
    /// The export month's 0/40/80 bucket, captured with the files. Older jobs
    /// and unavailable monthly aggregates have no value rather than zero.
    #[serde(default)]
    pub study_hours: Option<u8>,
    pub files: Vec<SnapshotFile>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Snapshot {
    pub month: NaiveDate,
    pub options: ExportRequest,
    pub students: Vec<SnapshotStudent>,
}

impl Snapshot {
    pub fn pdf_count(&self) -> usize {
        self.students.iter().map(|s| s.files.len()).sum()
    }
    fn files(&self) -> impl Iterator<Item = &SnapshotFile> {
        self.students.iter().flat_map(|s| &s.files)
    }
    pub fn check_size(&self, config: &ArchiveConfig) -> Result<(), AppError> {
        let total = self
            .files()
            .try_fold(0usize, |sum, f| {
                usize::try_from(f.size_bytes)
                    .ok()
                    .filter(|n| *n > 0)
                    .and_then(|n| sum.checked_add(n))
            })
            .ok_or_else(too_large)?;
        // A stored ZIP adds a header/directory entry per file and a CSV. The exact
        // ZIP output also has a hard write cap, so this is only early feedback.
        let overhead = self
            .files()
            .try_fold(1024usize, |sum, f| sum.checked_add(1024 + f.path.len() * 2))
            .ok_or_else(too_large)?;
        if total
            .checked_add(overhead)
            .is_none_or(|n| n > config.max_bytes)
        {
            return Err(too_large());
        }
        Ok(())
    }
}

fn too_large() -> AppError {
    AppError::InvalidRequest(
        "파일 용량이 일괄 다운로드 한도를 넘습니다. 교육생을 나누어 선택해 주세요.".into(),
    )
}

struct StudentArchive {
    row: ArchiveRow,
    current: Vec<SnapshotFile>,
    base: Vec<SnapshotFile>,
    previous: Vec<SnapshotFile>,
}

#[derive(QueryableByName)]
struct StudentName {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    display_name: String,
    #[diesel(sql_type = Nullable<Text>)]
    ordinal: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    ko_name: Option<String>,
    #[diesel(sql_type = Nullable<Date>)]
    date_of_birth: Option<NaiveDate>,
    #[diesel(sql_type = Text)]
    login: String,
}

#[derive(QueryableByName)]
struct MonthRow {
    #[diesel(sql_type = Date)]
    target_month: NaiveDate,
}

#[derive(QueryableByName)]
struct StudentHours {
    #[diesel(sql_type = BigInt)]
    user_id: i64,
    #[diesel(sql_type = Nullable<BigInt>)]
    recognized_seconds: Option<i64>,
}

#[derive(QueryableByName)]
struct ApprovedBase {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    id: Uuid,
    #[diesel(sql_type = BigInt)]
    owner_id: i64,
    #[diesel(sql_type = BigInt)]
    size_bytes: i64,
    #[diesel(sql_type = Binary)]
    sha256: Vec<u8>,
    #[diesel(sql_type = Nullable<SmallInt>)]
    key_id: Option<i16>,
    #[diesel(sql_type = Text)]
    doc_type: DocType,
    #[diesel(sql_type = Text)]
    kind: String,
    #[diesel(sql_type = Timestamptz)]
    submitted_at: DateTime<Utc>,
    #[diesel(sql_type = Timestamptz)]
    approved_at: DateTime<Utc>,
}

/// Past months use the exclusive next-month boundary; this month uses now.
fn base_cutoff(month: NaiveDate, now: DateTime<Utc>) -> DateTime<Utc> {
    if month < kst::current_month(now) {
        kst::month_window(month).1
    } else {
        now
    }
}

async fn approved_base(
    conn: &mut AsyncPgConnection,
    ids: &[i64],
    month: NaiveDate,
    now: DateTime<Utc>,
) -> Result<HashMap<i64, Vec<SnapshotFile>>, AppError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let cutoff = base_cutoff(month, now);
    // Each finalized file is immutable. Ancestors may have been approved by the
    // same supplement, so choose the latest submitted version, not the timestamp
    // of the ancestor's propagated approval event.
    let rows: Vec<ApprovedBase> = diesel::sql_query(
        "SELECT DISTINCT ON (s.user_id, f.doc_type)
             f.id, s.user_id AS owner_id, f.size_bytes, f.sha256, f.key_id,
             f.doc_type, s.kind, s.submitted_at, approval.approved_at
         FROM submission_files f JOIN submissions s ON s.id = f.submission_id
         JOIN LATERAL (SELECT max(e.created_at) AS approved_at FROM submission_events e
             WHERE e.submission_id = s.id AND e.to_status = 'approved' AND e.created_at < $2) approval
             ON approval.approved_at IS NOT NULL
         WHERE s.user_id = ANY($1) AND s.status <> 'draft' AND s.submitted_at < $2
             AND s.target_month <= $3 AND f.superseded_by IS NULL
             AND f.doc_type IN ('id_card', 'resident_abstract', 'bankbook')
         ORDER BY s.user_id, f.doc_type, s.submitted_at DESC, s.id DESC")
        .bind::<Array<BigInt>, _>(ids.to_vec()).bind::<Timestamptz, _>(cutoff).bind::<Date, _>(month).load(conn).await?;
    let banks: Vec<ApprovedBase> = diesel::sql_query(
        "SELECT DISTINCT ON (user_id) bankbook_file_id AS id, user_id AS owner_id,
             bankbook_size_bytes AS size_bytes, bankbook_sha256 AS sha256, bankbook_key_id AS key_id,
             'bankbook'::text AS doc_type, 'bank_change'::text AS kind,
             requested_at AS submitted_at, decided_at AS approved_at
         FROM bank_account_changes WHERE user_id = ANY($1) AND status = 'approved'
             AND decided_at < $2 AND bankbook_file_id IS NOT NULL
             AND bankbook_size_bytes IS NOT NULL AND bankbook_sha256 IS NOT NULL
         ORDER BY user_id, decided_at DESC, id DESC")
        .bind::<Array<BigInt>, _>(ids.to_vec()).bind::<Timestamptz, _>(cutoff).load(conn).await?;
    let mut selected: BTreeMap<(i64, String), ApprovedBase> = rows
        .into_iter()
        .map(|row| ((row.owner_id, row.doc_type.as_str().into()), row))
        .collect();
    for bank in banks {
        let key = (bank.owner_id, bank.doc_type.as_str().to_owned());
        if selected
            .get(&key)
            .is_none_or(|original| original.approved_at <= bank.approved_at)
        {
            selected.insert(key, bank);
        }
    }
    let mut result: HashMap<i64, Vec<SnapshotFile>> = HashMap::new();
    for row in selected.into_values() {
        result.entry(row.owner_id).or_default().push(SnapshotFile {
            id: row.id,
            owner_id: row.owner_id,
            size_bytes: row.size_bytes,
            sha256: row.sha256,
            key_id: row.key_id,
            doc_type: row.doc_type.as_str().into(),
            kind: row.kind,
            submitted_at: row.submitted_at,
            status: "approved".into(),
            category: "base".into(),
            path: String::new(),
        });
    }
    for files in result.values_mut() {
        files.sort_by_key(|f| doc_order(&f.doc_type));
    }
    Ok(result)
}

fn snapshot_file(
    file: &SubmittedFile,
    chain: &SubmissionChain,
    category: &str,
) -> Result<SnapshotFile, AppError> {
    let sub = chain
        .submissions
        .iter()
        .find(|s| s.id == file.submission_id)
        .ok_or_else(|| anyhow::anyhow!("archive file missing submission"))?;
    Ok(SnapshotFile {
        id: file.id,
        owner_id: chain.user_id,
        size_bytes: file.size_bytes,
        sha256: file.sha256.clone(),
        key_id: file.key_id,
        doc_type: file.doc_type.as_str().into(),
        kind: sub.kind.as_str().into(),
        submitted_at: sub.submitted_at,
        status: sub.status.as_str().into(),
        category: category.into(),
        path: String::new(),
    })
}

async fn load_archive(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    ids: Option<&[i64]>,
    filters: &ArchiveFilters,
) -> Result<Vec<StudentArchive>, AppError> {
    let mut chains = match ids {
        Some(ids) => {
            let submissions =
                admin_data::load_public_submissions_for_users(conn, month, ids).await?;
            let files = admin_data::load_submitted_files(
                conn,
                &submissions.iter().map(|s| s.id).collect::<Vec<_>>(),
            )
            .await?;
            admin_data::build_chains(submissions, files)?
        }
        None => admin_data::load_chains(conn, Some(month), None).await?,
    };
    chains.retain(|chain| filters.matches(chain.latest().status, chain.latest().kind));
    let ids = chains
        .iter()
        .map(|c| c.user_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let names: Vec<StudentName> = diesel::sql_query(
        "SELECT id, display_name, ordinal, ko_name, date_of_birth, login FROM users WHERE id = ANY($1) AND role = 'student'",
    )
    .bind::<Array<BigInt>, _>(ids.clone())
    .load(conn)
    .await?;
    let mut bases = approved_base(conn, &ids, month, Utc::now()).await?;
    let mut groups: BTreeMap<i64, StudentArchive> = names
        .into_iter()
        .map(|n| {
            (
                n.id,
                StudentArchive {
                    row: ArchiveRow {
                        user_id: n.id,
                        name: admin_data::student_label(
                            n.ordinal.as_deref(),
                            n.ko_name.as_deref(),
                            &n.display_name,
                            n.date_of_birth,
                        ),
                        login: n.login,
                        files: Vec::new(),
                        base_docs: Vec::new(),
                        previous: Vec::new(),
                        submitted_at: DateTime::<Utc>::MIN_UTC,
                        status: Status::PendingReview,
                        kinds: Vec::new(),
                    },
                    current: Vec::new(),
                    base: Vec::new(),
                    previous: Vec::new(),
                },
            )
        })
        .collect();
    for chain in chains {
        let row = groups
            .get_mut(&chain.user_id)
            .ok_or_else(|| anyhow::anyhow!("archive owner missing"))?;
        if row.row.submitted_at <= chain.latest().submitted_at {
            row.row.submitted_at = chain.latest().submitted_at;
            row.row.status = chain.latest().status;
        }
        if !row.row.kinds.contains(&chain.latest().kind) {
            row.row.kinds.push(chain.latest().kind);
        }
        for file in &chain.current_files {
            row.current.push(snapshot_file(file, &chain, "current")?);
        }
        for file in &chain.previous_files {
            row.previous.push(snapshot_file(file, &chain, "previous")?);
        }
    }
    let mut result = Vec::new();
    for (id, mut group) in groups {
        group.row.kinds.sort_by_key(|kind| kind.as_str());
        group
            .previous
            .sort_by_key(|f| (f.submitted_at, doc_order(&f.doc_type), f.id));
        group.base = bases
            .remove(&id)
            .unwrap_or_default()
            .into_iter()
            .filter(|f| !group.current.iter().any(|c| c.doc_type == f.doc_type))
            .collect();
        group.row.files = document_types(&group.current)?;
        group.row.base_docs = document_types(&group.base)?;
        group.row.previous = document_types(&group.previous)?;
        result.push(group);
    }
    result.sort_by_key(|s| (s.row.submitted_at, s.row.user_id));
    Ok(result)
}

fn document_types(files: &[SnapshotFile]) -> Result<Vec<DocType>, AppError> {
    files
        .iter()
        .map(|f| {
            f.doc_type
                .parse()
                .map_err(|_| anyhow::anyhow!("invalid archive document type").into())
        })
        .collect()
}

pub async fn view(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    filters: &ArchiveFilters,
) -> Result<ArchiveView, AppError> {
    let rows = load_archive(conn, month, None, filters)
        .await?
        .into_iter()
        .map(|s| s.row)
        .collect();
    let months: Vec<MonthRow> = diesel::sql_query("SELECT DISTINCT s.target_month FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.status <> 'draft' AND u.role = 'student' ORDER BY s.target_month DESC")
        .load(conn).await?;
    Ok(ArchiveView {
        month,
        months: months
            .into_iter()
            .map(|r| r.target_month.format("%Y-%m").to_string())
            .collect(),
        rows,
    })
}

pub async fn snapshot(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    request: ExportRequest,
    config: &ArchiveConfig,
) -> Result<Snapshot, AppError> {
    let groups = load_archive(conn, month, Some(&request.user_ids), &request.filters).await?;
    if groups.len() != request.user_ids.len() {
        if !request.filters.is_empty() {
            return Err(AppError::InvalidState(
                "선택한 조건에 맞는 자료가 바뀌었어요. 목록을 다시 확인해 주세요.".into(),
            ));
        }
        return Err(AppError::InvalidRequest(
            "선택한 교육생 중 해당 월 제출 내역이 없는 사람이 있습니다.".into(),
        ));
    }
    let folders = unique_names(
        groups
            .iter()
            .map(|g| format!("{}_{}", safe_name(&g.row.name), safe_name(&g.row.login))),
        false,
    );
    let root = root_folder(month);
    // Read once for the selected month and people, inside the same repeatable-read
    // transaction as the files. Later hourly refreshes cannot alter an existing ZIP.
    let hours: Vec<StudentHours> = diesel::sql_query(
        "SELECT user_id, CASE WHEN result_status='on_hold' THEN NULL ELSE recognized_seconds END AS recognized_seconds \
         FROM time_requirements WHERE target_month=$1 AND user_id=ANY($2)",
    )
    .bind::<Date, _>(month)
    .bind::<Array<BigInt>, _>(&request.user_ids)
    .load(conn)
    .await?;
    let hours: HashMap<_, _> = hours
        .into_iter()
        .filter_map(|row| {
            row.recognized_seconds
                .map(|seconds| (row.user_id, crate::study_time::hours_bucket(seconds)))
        })
        .collect();
    let students = groups
        .into_iter()
        .zip(folders)
        .map(|(g, folder)| {
            let mut files = g.current;
            if request.include_base_docs {
                files.extend(g.base);
            }
            if request.include_previous {
                files.extend(g.previous);
            }
            let names = unique_names(files.iter().map(|f| file_name(month, f)), true);
            for (file, name) in files.iter_mut().zip(names) {
                file.path = format!("{root}/{folder}/{name}");
            }
            SnapshotStudent {
                user_id: g.row.user_id,
                study_hours: hours.get(&g.row.user_id).copied(),
                name: g.row.name,
                login: g.row.login,
                folder,
                files,
            }
        })
        .collect();
    let snapshot = Snapshot {
        month,
        options: request,
        students,
    };
    if snapshot.pdf_count() != snapshot.options.expected_pdf_count {
        return Err(AppError::InvalidState(
            "자료가 바뀌었어요. 다시 확인해 주세요.".into(),
        ));
    }
    snapshot.check_size(config)?;
    Ok(snapshot)
}

fn doc_order(value: &str) -> usize {
    DocType::ALL
        .iter()
        .position(|d| d.as_str() == value)
        .unwrap_or(usize::MAX)
}

pub fn safe_name(raw: &str) -> String {
    let replaced = raw
        .nfc()
        .map(|c| {
            if c.is_control()
                || get_general_category(c) == GeneralCategory::Format
                || "\\/:*?\"<>|".contains(c)
            {
                '_'
            } else {
                c
            }
        })
        .collect::<String>();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let name = collapsed
        .chars()
        .take(40)
        .collect::<String>()
        .trim_end_matches(['.', ' '])
        .to_owned();
    if name.is_empty() {
        return "_".into();
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if reserved { format!("_{name}") } else { name }
}

pub fn unique_names(names: impl IntoIterator<Item = String>, extension: bool) -> Vec<String> {
    let mut used = HashSet::new();
    names
        .into_iter()
        .map(|name| {
            let dot = extension
                .then(|| name.rfind('.'))
                .flatten()
                .filter(|i| *i > 0);
            let (stem, ext) = dot.map_or((name.as_str(), ""), |i| name.split_at(i));
            let mut candidate = name.clone();
            let mut number = 2;
            while !used.insert(candidate.nfc().collect::<String>().to_lowercase()) {
                candidate = format!("{stem}_{number}{ext}");
                number += 1;
            }
            candidate
        })
        .collect()
}

pub fn root_folder(month: NaiveDate) -> String {
    format!("{}년 {}월", month.year(), month.month())
}
pub fn zip_name(month: NaiveDate) -> String {
    format!("{}_지원금 자료.zip", root_folder(month))
}

fn doc_label(value: &str) -> &'static str {
    DocType::ALL
        .iter()
        .find(|d| d.as_str() == value)
        .map(|d| d.label())
        .unwrap_or("서류")
}
fn file_name(month: NaiveDate, file: &SnapshotFile) -> String {
    let short = if file.doc_type == "employment_insurance" {
        "고용보험"
    } else {
        doc_label(&file.doc_type)
    };
    match file.category.as_str() {
        "base" => format!("기본서류_{}.pdf", doc_label(&file.doc_type)),
        "previous" => format!("이전제출본_{}월_{short}.pdf", month.month()),
        _ => format!("{}월_{short}.pdf", month.month()),
    }
}

fn csv_cell(raw: &str) -> String {
    let safe = if raw.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{raw}")
    } else {
        raw.to_owned()
    };
    if safe.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", safe.replace('"', "\"\""))
    } else {
        safe
    }
}

fn csv(snapshot: &Snapshot) -> Zeroizing<Vec<u8>> {
    let mut result =
        String::from("\u{FEFF}이름,login,제출 종류,파일 종류,접수 시각,검토 상태,학습 시간\r\n");
    for student in &snapshot.students {
        let hours = student
            .study_hours
            .map_or_else(|| "확인 불가".to_owned(), |hours| hours.to_string());
        for file in &student.files {
            let kind = match file.kind.as_str() {
                "initial" => "최초",
                "monthly" => "월별",
                "bank_change" => "계좌 변경",
                _ => "보완",
            };
            let label = match file.category.as_str() {
                "base" => format!("{} (기본 서류)", doc_label(&file.doc_type)),
                "previous" => format!("{} (이전 제출본)", doc_label(&file.doc_type)),
                _ => doc_label(&file.doc_type).into(),
            };
            let status = match file.status.as_str() {
                "approved" => "서류 승인",
                "revision_requested" => "재검토 요청",
                "resubmitted" => "재검토 대기",
                _ => "검토 중",
            };
            let at = file
                .submitted_at
                .with_timezone(&kst::offset())
                .format("%Y-%m-%d %H:%M")
                .to_string();
            result.push_str(
                &[
                    student.name.as_str(),
                    &student.login,
                    kind,
                    &label,
                    &at,
                    status,
                    &hours,
                ]
                .map(csv_cell)
                .join(","),
            );
            result.push_str("\r\n");
        }
    }
    Zeroizing::new(result.into_bytes())
}

#[derive(QueryableByName)]
pub struct ExportJob {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    pub id: Uuid,
    #[diesel(sql_type = BigInt)]
    pub created_by: i64,
    #[diesel(sql_type = Date)]
    pub target_month: NaiveDate,
    #[diesel(sql_type = Binary)]
    pub request_hash: Vec<u8>,
    #[diesel(sql_type = Text)]
    pub snapshot: String,
    #[diesel(sql_type = Text)]
    pub status: String,
    #[diesel(sql_type = BigInt)]
    pub student_count: i64,
    #[diesel(sql_type = BigInt)]
    pub pdf_count: i64,
    #[diesel(sql_type = Nullable<Timestamptz>)]
    pub expires_at: Option<DateTime<Utc>>,
    #[diesel(sql_type = Nullable<SmallInt>)]
    pub key_id: Option<i16>,
    #[diesel(sql_type = Nullable<BigInt>)]
    pub size_bytes: Option<i64>,
    #[diesel(sql_type = Nullable<Binary>)]
    pub sha256: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct CreatedExport {
    pub job_id: Uuid,
    pub status: String,
}

#[derive(Serialize)]
pub struct ExportStatus {
    pub job_id: Uuid,
    pub status: String,
    pub zip_name: String,
    pub student_count: i64,
    pub pdf_count: i64,
    #[serde(serialize_with = "kst::serialize_opt")]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'static str>,
}

impl ExportJob {
    pub fn response(&self) -> CreatedExport {
        CreatedExport {
            job_id: self.id,
            status: self.status.clone(),
        }
    }
    pub fn status_response(&self) -> ExportStatus {
        ExportStatus {
            job_id: self.id,
            status: self.status.clone(),
            zip_name: zip_name(self.target_month),
            student_count: self.student_count,
            pdf_count: self.pdf_count,
            expires_at: self.expires_at,
            error: (self.status == "failed")
                .then_some("파일을 만들지 못했습니다. 다시 요청해 주세요."),
        }
    }
}

pub async fn get_job(
    conn: &mut AsyncPgConnection,
    owner: i64,
    month: NaiveDate,
    id: Uuid,
) -> Result<ExportJob, AppError> {
    // Polling does not need the private file manifest and must not allocate it.
    diesel::sql_query("SELECT id, created_by, target_month, request_hash, ''::text AS snapshot, status, student_count, pdf_count, expires_at, key_id, size_bytes, sha256 FROM archive_export_jobs WHERE id = $1 AND created_by = $2 AND target_month = $3 AND expires_at > now()")
        .bind::<diesel::sql_types::Uuid, _>(id).bind::<BigInt, _>(owner).bind::<Date, _>(month)
        .get_result(conn).await.optional()?.ok_or(AppError::NotFound)
}

async fn existing_job(
    conn: &mut AsyncPgConnection,
    owner: i64,
    key: Uuid,
    hash: &[u8],
) -> Result<Option<ExportJob>, AppError> {
    let job: Option<ExportJob> = diesel::sql_query("SELECT id, created_by, target_month, request_hash, ''::text AS snapshot, status, student_count, pdf_count, expires_at, key_id, size_bytes, sha256 FROM archive_export_jobs WHERE created_by = $1 AND idempotency_key = $2")
        .bind::<BigInt, _>(owner).bind::<diesel::sql_types::Uuid, _>(key).get_result(conn).await.optional()?;
    if let Some(job) = &job {
        if job.request_hash != hash {
            return Err(AppError::InvalidState(
                "같은 Idempotency-Key로 다른 요청을 보낼 수 없습니다.".into(),
            ));
        }
        if job.expires_at.is_none_or(|at| at <= Utc::now()) {
            return Err(AppError::NotFound);
        }
    }
    Ok(job)
}

#[derive(QueryableByName)]
struct RoleRow {
    #[diesel(sql_type = Text)]
    role: Role,
}
#[derive(QueryableByName)]
struct RequestWindow {
    #[diesel(sql_type = BigInt)]
    remaining_seconds: i64,
    #[diesel(sql_type = Bool)]
    creating: bool,
}

async fn lock_accountant(conn: &mut AsyncPgConnection, user_id: i64) -> Result<(), AppError> {
    let user: Option<RoleRow> =
        diesel::sql_query("SELECT role FROM users WHERE id = $1 FOR UPDATE")
            .bind::<BigInt, _>(user_id)
            .get_result(conn)
            .await
            .optional()?;
    require_accountant(user.ok_or(AppError::Forbidden)?.role)
}

async fn event(
    conn: &mut AsyncPgConnection,
    job_id: Uuid,
    actor: i64,
    action: &str,
) -> Result<(), AppError> {
    diesel::sql_query(
        "INSERT INTO archive_export_events (job_id, actor_user_id, action) VALUES ($1, $2, $3)",
    )
    .bind::<diesel::sql_types::Uuid, _>(job_id)
    .bind::<BigInt, _>(actor)
    .bind::<Text, _>(action)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn create(
    state: AppState,
    owner: i64,
    month: NaiveDate,
    key: Uuid,
    mut request: ExportRequest,
) -> Result<CreatedExport, AppError> {
    request.validate(&state.archive.config)?;
    let hash = request.fingerprint(month)?;
    let mut conn = state.pool.get().await?;
    if let Some(job) = existing_job(&mut conn, owner, key, &hash).await? {
        return Ok(job.response());
    }
    // The permit is taken before loading the export snapshot and handed directly
    // to its worker. No queue of unbounded in-memory jobs is created.
    let permit = state.archive.acquire()?;
    let state_ref = &state;
    let (job, new) = conn.transaction::<_, AppError, _>(async move |conn| {
        diesel::sql_query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ").execute(conn).await?;
        lock_accountant(conn, owner).await?;
        if let Some(job) = existing_job(conn, owner, key, &hash).await? { return Ok((job, false)); }
        let recent: RequestWindow = diesel::sql_query(
            "SELECT COALESCE(ceil(extract(epoch FROM (max(created_at) - $2)))::bigint, 0) AS remaining_seconds,
                COALESCE(bool_or(status = 'creating'), false) AS creating
             FROM archive_export_jobs WHERE created_by = $1 AND (status = 'creating' OR created_at > $2)")
            .bind::<BigInt, _>(owner).bind::<Timestamptz, _>(Utc::now().checked_sub_signed(TimeDelta::seconds(state_ref.archive.config.request_interval_seconds)).ok_or_else(|| anyhow::anyhow!("export request interval overflow"))?)
            .get_result(conn).await?;
        if recent.creating || recent.remaining_seconds > 0 {
            return Err(AppError::RateLimited {
                retry_after: recent.remaining_seconds.max(if recent.creating { 30 } else { 1 }) as u64,
            });
        }
        let snapshot = snapshot(conn, month, request, &state_ref.archive.config).await?;
        let id = Uuid::new_v4();
        let expires_at = Utc::now().checked_add_signed(TimeDelta::seconds(state_ref.archive.config.ttl_seconds))
            .ok_or_else(|| anyhow::anyhow!("export expiry overflow"))?;
        let job = diesel::sql_query(
            "INSERT INTO archive_export_jobs (id, created_by, target_month, idempotency_key, request_hash, snapshot, status, student_count, pdf_count, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'creating', $7, $8, $9) RETURNING *")
            .bind::<diesel::sql_types::Uuid, _>(id).bind::<BigInt, _>(owner).bind::<Date, _>(month)
            .bind::<diesel::sql_types::Uuid, _>(key).bind::<Binary, _>(hash).bind::<Text, _>(serde_json::to_string(&snapshot)?)
            .bind::<BigInt, _>(snapshot.students.len() as i64).bind::<BigInt, _>(snapshot.pdf_count() as i64)
            .bind::<Timestamptz, _>(expires_at).get_result::<ExportJob>(conn).await?;
        event(conn, id, owner, "requested").await?;
        Ok((job, true))
    }).await?;
    let response = job.response();
    drop(conn);
    if new {
        tokio::spawn(async move {
            let _permit = permit;
            if let Err(error) = build_export(&state, &job).await {
                if let AppError::Internal(error) = error {
                    tracing::error!(job_id = %job.id, "archive generation failed: {error:#}");
                } else {
                    tracing::warn!(job_id = %job.id, "archive generation rejected");
                }
                let _ = tokio::fs::remove_file(export_path(&state.config.upload_dir, job.id)).await;
                if let Err(AppError::Internal(error)) = fail_job(&state, job.id, owner).await {
                    tracing::error!(job_id = %job.id, "archive failure could not be recorded: {error:#}");
                }
            }
        });
    }
    Ok(response)
}

/// Preallocating the capped buffer prevents Vec's geometric growth from doubling
/// the configured ZIP allocation. A write that exceeds the cap fails closed.
struct BoundedBuffer {
    bytes: Zeroizing<Vec<u8>>,
    position: usize,
    limit: usize,
}

impl BoundedBuffer {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Zeroizing::new(Vec::with_capacity(limit)),
            position: 0,
            limit,
        }
    }
}

impl Write for BoundedBuffer {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let end = self
            .position
            .checked_add(buf.len())
            .filter(|end| *end <= self.limit)
            .ok_or_else(|| io::Error::other("export ZIP exceeds configured limit"))?;
        if end > self.bytes.len() {
            self.bytes.resize(end, 0);
        }
        self.bytes[self.position..end].copy_from_slice(buf);
        self.position = end;
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Seek for BoundedBuffer {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let next = match position {
            SeekFrom::Start(n) => i128::from(n),
            SeekFrom::Current(n) => self.position as i128 + i128::from(n),
            SeekFrom::End(n) => self.bytes.len() as i128 + i128::from(n),
        };
        if next < 0 || next > self.limit as i128 {
            return Err(io::Error::other("export ZIP seek outside limit"));
        }
        self.position = next as usize;
        Ok(self.position as u64)
    }
}

async fn make_zip(state: &AppState, snapshot: &Snapshot) -> Result<Zeroizing<Vec<u8>>, AppError> {
    snapshot.check_size(&state.archive.config)?;
    let buffer = BoundedBuffer::new(state.archive.config.max_bytes);
    let mut writer = zip::ZipWriter::new(buffer);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o600);
    for file in snapshot.files() {
        let _permit = state
            .heavy_io
            .acquire()
            .await
            .map_err(anyhow::Error::from)?;
        // Avoid reading an unexpectedly huge tampered disk file into memory.
        let metadata =
            tokio::fs::metadata(state.config.upload_dir.join(file.id.to_string())).await?;
        let encrypted_size = file
            .size_bytes
            .checked_add(if file.key_id.is_some() { 28 } else { 0 })
            .ok_or_else(|| anyhow::anyhow!("invalid archived source size"))?;
        if metadata.len() != u64::try_from(encrypted_size).map_err(anyhow::Error::from)? {
            return Err(anyhow::anyhow!("archive source file size changed: {}", file.id).into());
        }
        let bytes = storage::read_verified(
            &state.config.upload_dir,
            file.id,
            file.key_id,
            file.size_bytes,
            &file.sha256,
            &state.file_cipher,
        )
        .await?;
        writer.start_file(&file.path, options)?;
        writer.write_all(&bytes)?;
    }
    writer.start_file(
        format!("{}/제출목록.csv", root_folder(snapshot.month)),
        options,
    )?;
    writer.write_all(&csv(snapshot))?;
    Ok(writer.finish()?.bytes)
}

fn export_path(dir: &Path, id: Uuid) -> PathBuf {
    dir.join(format!(".export-{id}"))
}
fn export_aad(id: Uuid) -> String {
    format!("archive_export:{id}")
}

struct TempArtifact {
    path: PathBuf,
}
impl Drop for TempArtifact {
    fn drop(&mut self) {
        if !self.path.as_os_str().is_empty() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

async fn build_export(state: &AppState, job: &ExportJob) -> Result<(), AppError> {
    {
        let mut conn = state.pool.get().await?;
        let role: RoleRow = diesel::sql_query("SELECT role FROM users WHERE id = $1")
            .bind::<BigInt, _>(job.created_by)
            .get_result(&mut conn)
            .await?;
        require_accountant(role.role)?;
    }
    let snapshot: Snapshot = serde_json::from_str(&job.snapshot)?;
    let bytes = make_zip(state, &snapshot).await?;
    let size = bytes.len() as i64;
    let hash = Sha256::digest(&*bytes).to_vec();
    let encrypted = state.file_cipher.encrypt(&bytes, &export_aad(job.id))?;
    drop(bytes);
    let temp = TempArtifact {
        path: state
            .config
            .upload_dir
            .join(format!(".export-tmp-{}", Uuid::new_v4())),
    };
    let std_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temp.path)?;
    let mut output = tokio::fs::File::from_std(std_file);
    output.write_all(&encrypted).await?;
    output.sync_all().await?;
    drop(output);
    drop(encrypted);
    let mut final_file = TempArtifact {
        path: export_path(&state.config.upload_dir, job.id),
    };
    tokio::fs::rename(&temp.path, &final_file.path).await?;
    tokio::fs::File::open(&state.config.upload_dir)
        .await?
        .sync_all()
        .await?;
    let now = Utc::now();
    let expires = now
        .checked_add_signed(TimeDelta::seconds(state.archive.config.ttl_seconds))
        .ok_or_else(|| anyhow::anyhow!("export expiry overflow"))?;
    let mut conn = state.pool.get().await?;
    conn.transaction::<_, AppError, _>(async |conn| {
        // A role revoked during generation cannot expose a completed archive.
        lock_accountant(conn, job.created_by).await?;
        for file in snapshot.files() {
            diesel::sql_query("INSERT INTO file_access_log (file_id, accessed_by, owner_id, access_basis, purpose, export_job_id) VALUES ($1, $2, $3, 'accountant', 'bulk_export', $4)")
                .bind::<diesel::sql_types::Uuid, _>(file.id).bind::<BigInt, _>(job.created_by).bind::<BigInt, _>(file.owner_id)
                .bind::<diesel::sql_types::Uuid, _>(job.id).execute(conn).await?;
        }
        let updated = diesel::sql_query("UPDATE archive_export_jobs SET status = 'ready', completed_at = $2, expires_at = $3, key_id = $4, size_bytes = $5, sha256 = $6 WHERE id = $1 AND status = 'creating'")
            .bind::<diesel::sql_types::Uuid, _>(job.id).bind::<Timestamptz, _>(now).bind::<Timestamptz, _>(expires)
            .bind::<SmallInt, _>(state.file_cipher.key_id()).bind::<BigInt, _>(size).bind::<Binary, _>(hash).execute(conn).await?;
        if updated != 1 { return Err(anyhow::anyhow!("archive job changed during generation").into()); }
        event(conn, job.id, job.created_by, "ready").await?;
        Ok(())
    }).await?;
    final_file.path = PathBuf::new();
    Ok(())
}

async fn fail_job(state: &AppState, id: Uuid, owner: i64) -> Result<(), AppError> {
    let mut conn = state.pool.get().await?;
    conn.transaction::<_, AppError, _>(async move |conn| {
        let updated = diesel::sql_query("UPDATE archive_export_jobs SET status = 'failed', completed_at = now() WHERE id = $1 AND status = 'creating'")
            .bind::<diesel::sql_types::Uuid, _>(id).execute(conn).await?;
        if updated > 0 { event(conn, id, owner, "failed").await?; }
        Ok(())
    }).await
}

/// Owns both plaintext and the exclusive memory permit until the response body
/// ends or the client disconnects. Small ReaderStream chunks avoid another ZIP copy.
struct DownloadReader {
    bytes: Zeroizing<Vec<u8>>,
    offset: usize,
    _permit: OwnedSemaphorePermit,
}

impl AsyncRead for DownloadReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        out: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let length = out.remaining().min(self.bytes.len() - self.offset);
        out.put_slice(&self.bytes[self.offset..self.offset + length]);
        self.offset += length;
        Poll::Ready(Ok(()))
    }
}

pub async fn download(
    state: &AppState,
    owner: i64,
    month: NaiveDate,
    id: Uuid,
) -> Result<(Body, i64), AppError> {
    let mut conn = state.pool.get().await?;
    let job = get_job(&mut conn, owner, month, id).await?;
    if job.status != "ready" {
        return Err(AppError::InvalidState(
            "아직 내려받을 수 없는 파일입니다.".into(),
        ));
    }
    // Ownership/expiry failures stay 404 even while another archive is busy.
    // No original or ZIP bytes are read before taking the shared permit.
    let permit = state.archive.acquire()?;
    let (Some(key_id), Some(size), Some(hash)) = (job.key_id, job.size_bytes, job.sha256) else {
        return Err(anyhow::anyhow!("ready archive has no file metadata").into());
    };
    let expected_size = usize::try_from(size)
        .ok()
        .filter(|s| *s <= state.archive.config.max_bytes)
        .ok_or_else(|| anyhow::anyhow!("archive size exceeds limit"))?;
    let path = export_path(&state.config.upload_dir, id);
    let metadata = tokio::fs::metadata(&path).await?;
    if metadata.len() != expected_size as u64 + 28 {
        return Err(anyhow::anyhow!("archive size differs from record").into());
    }
    let encrypted = tokio::fs::read(path).await?;
    let bytes = Zeroizing::new(
        state
            .file_cipher
            .decrypt(key_id, &encrypted, &export_aad(id))?,
    );
    drop(encrypted);
    if bytes.len() != expected_size || Sha256::digest(&*bytes).as_slice() != hash {
        return Err(anyhow::anyhow!("archive integrity check failed").into());
    }
    conn.transaction::<_, AppError, _>(async |conn| {
        lock_accountant(conn, owner).await?;
        // Expiry is checked again after decryption and before recording the access.
        let _ = get_job(conn, owner, month, id).await?;
        event(conn, id, owner, "downloaded").await?;
        Ok(())
    })
    .await?;
    drop(conn);
    let reader = DownloadReader {
        bytes,
        offset: 0,
        _permit: permit,
    };
    Ok((
        Body::from_stream(ReaderStream::with_capacity(reader, 64 * 1024)),
        size,
    ))
}

#[derive(QueryableByName)]
struct JobIdentity {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    id: Uuid,
    #[diesel(sql_type = BigInt)]
    created_by: i64,
}

/// Called once before accepting requests. Interrupted jobs cannot silently remain
/// 'creating'; their failed audit records are committed before orphan cleanup.
pub async fn start(state: &AppState) -> anyhow::Result<()> {
    start_inner(state).await.map_err(|error| match error {
        AppError::Internal(error) => error,
        _ => anyhow::anyhow!("archive startup failed"),
    })
}

async fn start_inner(state: &AppState) -> Result<(), AppError> {
    let permit = state.archive.acquire()?;
    cleanup(state, &permit).await?;
    drop(permit);
    let state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.tick().await;
        loop {
            interval.tick().await;
            // No removal can race a rename/ready commit or an active download.
            if let Ok(permit) = state.archive.acquire()
                && let Err(AppError::Internal(error)) = cleanup(&state, &permit).await
            {
                tracing::error!("archive cleanup failed: {error:#}");
            }
        }
    });
    Ok(())
}

async fn cleanup(state: &AppState, _permit: &OwnedSemaphorePermit) -> Result<(), AppError> {
    let mut conn = state.pool.get().await?;
    // Every live snapshot/generator owns the same exclusive permit. Holding it
    // here proves that a remaining 'creating' row has no worker, even when a
    // cancelled COMMIT or a failed failure-record write left it behind. Update
    // and audit together so a temporary DB outage can be retried next minute.
    conn.transaction::<_, AppError, _>(async |conn| {
        let abandoned: Vec<JobIdentity> = diesel::sql_query("UPDATE archive_export_jobs SET status = 'failed', completed_at = now() WHERE status = 'creating' RETURNING id, created_by")
            .load(conn).await?;
        for job in abandoned { event(conn, job.id, job.created_by, "failed").await?; }
        Ok(())
    }).await?;
    let live: Vec<JobIdentity> = diesel::sql_query("SELECT id, created_by FROM archive_export_jobs WHERE status = 'ready' AND expires_at > now()")
        .load(&mut conn).await?;
    let live = live.into_iter().map(|j| j.id).collect::<HashSet<_>>();
    drop(conn);
    let mut entries = tokio::fs::read_dir(&state.config.upload_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let remove = if name.starts_with(".export-tmp-") {
            true
        } else if let Some(id) = name
            .strip_prefix(".export-")
            .and_then(|id| Uuid::parse_str(id).ok())
        {
            !live.contains(&id)
        } else {
            false
        };
        if remove {
            tokio::fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn month() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
    }
    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }
    fn config() -> ArchiveConfig {
        ArchiveConfig {
            max_users: 100,
            max_bytes: 1024 * 1024,
            ttl_seconds: 900,
            request_interval_seconds: 300,
        }
    }
    fn request() -> ExportRequest {
        ExportRequest {
            user_ids: vec![1],
            include_base_docs: false,
            include_previous: false,
            expected_pdf_count: 1,
            filters: ArchiveFilters::default(),
        }
    }
    fn example() -> Snapshot {
        Snapshot {
            month: month(),
            options: request(),
            students: vec![SnapshotStudent {
                user_id: 1,
                name: "=HYPERLINK(\"bad\")".into(),
                login: "@formula".into(),
                folder: "sample_user".into(),
                study_hours: Some(40),
                files: vec![SnapshotFile {
                    id: Uuid::from_u128(1),
                    owner_id: 1,
                    size_bytes: 10,
                    sha256: vec![0; 32],
                    key_id: Some(1),
                    doc_type: "employment_insurance".into(),
                    kind: "monthly".into(),
                    submitted_at: at("2026-09-21T00:12:00Z"),
                    status: "pending_review".into(),
                    category: "current".into(),
                    path: "2026년 9월/sample_user/9월_고용보험.pdf".into(),
                }],
            }],
        }
    }

    #[test]
    fn filters_validate_combine_and_preserve_unfiltered_fingerprints() {
        let old = r#"{"user_ids":[1],"include_base_docs":false,"include_previous":false,"expected_pdf_count":1}"#;
        let mut request: ExportRequest = serde_json::from_str(old).unwrap();
        assert!(request.validate(&config()).is_ok());
        assert_eq!(serde_json::to_string(&request).unwrap(), old);
        let original_hash = request.fingerprint(month()).ok().expect("unfiltered hash");
        request.filters.status = Some("all".into());
        request.filters.kind = Some("all".into());
        assert!(request.validate(&config()).is_ok());
        assert_eq!(
            request.fingerprint(month()).ok().expect("all hash"),
            original_hash
        );
        request.filters.status = Some("approved".into());
        request.filters.kind = Some("supplement".into());
        assert!(request.validate(&config()).is_ok());
        assert!(request.filters.matches(Status::Approved, Kind::Supplement));
        assert!(
            !request
                .filters
                .matches(Status::PendingReview, Kind::Supplement)
        );
        assert!(!request.filters.matches(Status::Approved, Kind::Initial));
        assert_ne!(
            request.fingerprint(month()).ok().expect("filtered hash"),
            original_hash
        );
        let single_hash = request.fingerprint(month()).ok().expect("single hash");
        request.filters.status = Some("approved,approved".into());
        assert!(request.validate(&config()).is_ok());
        assert_eq!(
            request.fingerprint(month()).ok().expect("dedup hash"),
            single_hash
        );
        request.filters.status = Some("resubmitted,approved,resubmitted".into());
        request.filters.kind = Some("supplement,initial".into());
        assert!(request.validate(&config()).is_ok());
        assert_eq!(
            request.filters.status.as_deref(),
            Some("approved,resubmitted")
        );
        assert_eq!(request.filters.kind.as_deref(), Some("initial,supplement"));
        for status in [Status::Approved, Status::Resubmitted] {
            for kind in [Kind::Initial, Kind::Supplement] {
                assert!(request.filters.matches(status, kind));
            }
        }
        assert!(
            !request
                .filters
                .matches(Status::PendingReview, Kind::Initial)
        );
        assert!(!request.filters.matches(Status::Approved, Kind::Monthly));
        let multi_hash = request.fingerprint(month()).ok().expect("multi hash");
        request.filters.status = Some("approved,resubmitted".into());
        request.filters.kind = Some("initial,supplement,initial".into());
        assert!(request.validate(&config()).is_ok());
        assert_eq!(
            request.fingerprint(month()).ok().expect("reordered hash"),
            multi_hash
        );
        for value in [
            "draft",
            "missing",
            "",
            "APPROVED",
            "approved,draft",
            "all,approved",
            "approved,",
            ",approved",
            "approved, approved",
        ] {
            request.filters.status = Some(value.into());
            assert!(request.validate(&config()).is_err());
        }
        request.filters.status = None;
        for value in ["unknown", "initial,unknown", "monthly,", "all,supplement"] {
            request.filters.kind = Some(value.into());
            assert!(request.validate(&config()).is_err());
        }
    }

    #[test]
    fn naming_matches_frontend_vectors_and_rejects_path_controls() {
        for (raw, expected) in [
            ("동민", "동민"),
            ("dongkim2", "dongkim2"),
            ("a/b\\c:d*e?f\"g<h>i|j", "a_b_c_d_e_f_g_h_i_j"),
            ("x\0y\u{1f}z", "x_y_z"),
            ("abc\u{202e}fdp.exe", "abc_fdp.exe"),
            ("a\u{200b}b", "a_b"),
            ("  김  하린 ", "김 하린"),
            ("name...", "name"),
            ("name. . ", "name"),
            ("", "_"),
            ("   ", "_"),
            (".", "_"),
            ("..", "_"),
            ("con", "_con"),
            ("NUL", "_NUL"),
            ("lpt1.txt", "_lpt1.txt"),
            ("console", "console"),
            ("한", "한"),
        ] {
            assert_eq!(safe_name(raw), expected, "{raw:?}");
        }
        assert_eq!(safe_name(&"가".repeat(100)), "가".repeat(40));
        // Full Unicode Cf coverage, beyond the legacy upload-name helper.
        assert_eq!(safe_name("a\u{e0001}b"), "a_b");
        assert_eq!(root_folder(month()), "2026년 9월");
        assert_eq!(zip_name(month()), "2026년 9월_지원금 자료.zip");
    }

    #[test]
    fn duplicate_names_preserve_both_independent_chain_documents() {
        let unique = |names: &[&str], extension| {
            unique_names(names.iter().map(|s| s.to_string()), extension)
        };
        assert_eq!(unique(&["a", "a", "a"], false), ["a", "a_2", "a_3"]);
        assert_eq!(unique(&["a", "a", "a_2"], false), ["a", "a_2", "a_2_2"]);
        assert_eq!(unique(&["Kim_A", "kim_a"], false), ["Kim_A", "kim_a_2"]);
        assert_eq!(unique(&["한", "한"], false), ["한", "한_2"]);
        assert_eq!(
            unique(&["9월_고용보험.pdf", "9월_고용보험.pdf"], true),
            ["9월_고용보험.pdf", "9월_고용보험_2.pdf"]
        );
    }

    #[test]
    fn base_document_cutoff_is_exclusive_kst_month_end_or_now() {
        let now = at("2026-10-18T01:00:00Z");
        assert_eq!(base_cutoff(month(), now), at("2026-09-30T15:00:00Z"));
        assert_eq!(base_cutoff(kst::current_month(now), now), now);
        assert!(parse_month("2026-09").is_ok());
        for invalid in [
            "2026-9", "2026-00", "2026-13", "0000-09", "+026-09", "2026/09",
        ] {
            assert!(parse_month(invalid).is_err());
        }
    }

    #[test]
    fn csv_bom_kst_quotes_and_formula_protection() {
        let output = csv(&example());
        assert!(output.starts_with(&[0xef, 0xbb, 0xbf]));
        let output = std::str::from_utf8(&output).unwrap();
        assert!(output.contains("\"'=HYPERLINK(\"\"bad\"\")\",'@formula,월별,고용보험가입내역서,2026-09-21 09:12,검토 중,40\r\n"));
        for marker in ["=SUM(1)", "+1", "-1", "@sum", "\tbad", "\rbad"] {
            assert!(csv_cell(marker).contains('\''));
        }
        assert_eq!(csv_cell("a,b\"c"), "\"a,b\"\"c\"");
        let mut snapshot = example();
        snapshot.students[0].files[0].kind = "bank_change".into();
        snapshot.students[0].files[0].category = "base".into();
        snapshot.students[0].files[0].doc_type = "bankbook".into();
        snapshot.students[0].files[0].status = "approved".into();
        assert!(
            std::str::from_utf8(&csv(&snapshot))
                .unwrap()
                .contains("계좌 변경,통장사본 (기본 서류)")
        );
    }

    #[test]
    fn csv_hours_preserve_buckets_and_read_older_snapshots_as_unknown() {
        let mut snapshot = example();
        for (hours, expected) in [
            (Some(0), "0"),
            (Some(40), "40"),
            (Some(80), "80"),
            (None, "확인 불가"),
        ] {
            snapshot.students[0].study_hours = hours;
            let bytes = csv(&snapshot);
            let output = std::str::from_utf8(&bytes).unwrap();
            assert!(output.lines().next().unwrap().ends_with(",학습 시간"));
            assert!(output.ends_with(&format!(",{expected}\r\n")));
        }
        let mut old = serde_json::to_value(example()).unwrap();
        old["students"][0]
            .as_object_mut()
            .unwrap()
            .remove("study_hours");
        let restored: Snapshot = serde_json::from_value(old).unwrap();
        assert!(restored.students[0].study_hours.is_none());
        assert!(
            std::str::from_utf8(&csv(&restored))
                .unwrap()
                .ends_with(",확인 불가\r\n")
        );
    }

    #[test]
    fn request_limits_and_idempotency_bind_month_options_and_people() {
        let cfg = config();
        let mut a = request();
        a.user_ids = vec![2, 1];
        assert!(a.validate(&cfg).is_ok());
        let mut b = request();
        b.user_ids = vec![1, 2];
        assert!(b.validate(&cfg).is_ok());
        assert_eq!(a.fingerprint(month()).ok(), b.fingerprint(month()).ok());
        b.include_previous = true;
        assert_ne!(a.fingerprint(month()).ok(), b.fingerprint(month()).ok());
        b.user_ids = vec![1, 1];
        assert!(b.validate(&cfg).is_err());
        b.user_ids = Vec::new();
        assert!(b.validate(&cfg).is_err());
        b.user_ids = (1..=101).collect();
        assert!(b.validate(&cfg).is_err());
        let mut snapshot = example();
        assert!(snapshot.check_size(&cfg).is_ok());
        snapshot.students[0].files[0].size_bytes = i64::MAX;
        assert!(snapshot.check_size(&cfg).is_err());
        snapshot.students[0].files[0].size_bytes = -1;
        assert!(snapshot.check_size(&cfg).is_err());
    }

    #[test]
    fn bounded_zip_roundtrips_korean_paths_and_refuses_overflow() {
        let mut writer = zip::ZipWriter::new(BoundedBuffer::new(4096));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("2026년 9월/동민_demo/9월_고용보험.pdf", options)
            .unwrap();
        writer.write_all(b"%PDF-1.4 demo").unwrap();
        let output = writer.finish().unwrap().bytes;
        let mut archive = zip::ZipArchive::new(io::Cursor::new(&*output)).unwrap();
        assert_eq!(archive.len(), 1);
        let mut file = archive.by_index(0).unwrap();
        assert_eq!(file.name(), "2026년 9월/동민_demo/9월_고용보험.pdf");
        let mut contents = String::new();
        file.read_to_string(&mut contents).unwrap();
        assert_eq!(contents, "%PDF-1.4 demo");
        let mut limited = BoundedBuffer::new(4);
        assert!(limited.write_all(b"1234").is_ok());
        assert!(limited.write_all(b"5").is_err());
        assert!(limited.seek(SeekFrom::Start(5)).is_err());
        limited.seek(SeekFrom::Start(1)).unwrap();
        limited.write_all(b"x").unwrap();
        assert_eq!(&*limited.bytes, b"1x34");
    }

    #[test]
    fn exports_use_distinct_authenticated_data_from_original_files() {
        use base64::Engine;
        let key = base64::engine::general_purpose::STANDARD.encode([1u8; 32]);
        let cipher = crate::crypto::FieldCipher::new("TEST", 1, &key).unwrap();
        let id = Uuid::new_v4();
        let bytes = b"PK\x03\x04 sample archive containing sensitive originals";
        let encrypted = cipher.encrypt(bytes, &export_aad(id)).unwrap();
        assert_ne!(&encrypted[..4], &bytes[..4]);
        assert_eq!(
            cipher.decrypt(1, &encrypted, &export_aad(id)).unwrap(),
            bytes
        );
        assert!(
            cipher
                .decrypt(1, &encrypted, &export_aad(Uuid::new_v4()))
                .is_err()
        );
        assert!(
            cipher
                .decrypt(1, &encrypted, &format!("file:{id}"))
                .is_err()
        );
    }

    #[tokio::test]
    async fn download_body_holds_exclusive_memory_permit_until_drop() {
        let runtime = ArchiveRuntime {
            config: config(),
            memory: Arc::new(Semaphore::new(1)),
        };
        let reader = DownloadReader {
            bytes: Zeroizing::new(vec![7; 8]),
            offset: 0,
            _permit: runtime.acquire().ok().expect("first permit"),
        };
        let body = Body::from_stream(ReaderStream::new(reader));
        assert!(runtime.acquire().is_err());
        let bytes = axum::body::to_bytes(body, 32).await.unwrap();
        assert_eq!(&bytes[..], &[7; 8]);
        assert!(runtime.acquire().is_ok());
        let reader = DownloadReader {
            bytes: Zeroizing::new(vec![1; 8]),
            offset: 0,
            _permit: runtime.acquire().ok().expect("second permit"),
        };
        let body = Body::from_stream(ReaderStream::new(reader));
        assert!(runtime.acquire().is_err());
        drop(body);
        assert!(runtime.acquire().is_ok());
    }

    #[test]
    fn bulk_export_role_is_stricter_than_original_access() {
        assert!(require_accountant(Role::Accountant).is_ok());
        for role in [Role::Student, Role::Operator, Role::Admin] {
            assert!(require_accountant(role).is_err());
        }
    }
}
