//! Shared staff view of completed submissions. A supplement replaces documents only
//! inside its own initial/monthly chain. Draft uploads never enter this view.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::sql_types::{Array, BigInt, Binary, Date, Nullable, SmallInt, Text, Timestamptz};
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use uuid::Uuid;

use crate::domain::{DocType, Kind, Status};
use crate::error::AppError;

/// Administrator work for month $1. The initial four documents already include
/// that month's insurance certificate. Keep both chains in history/storage, but
/// show only the initial chain (including supplements) in the review workflow.
/// An unfinished initial draft must never suppress a completed monthly chain.
pub const REVIEW_SCOPE_CTE: &str = "
    WITH RECURSIVE review_scope AS (
      SELECT s.id FROM submissions s
      WHERE s.target_month = $1 AND s.status <> 'draft' AND s.parent_id IS NULL
        AND (s.kind = 'initial' OR (s.kind = 'monthly' AND NOT EXISTS (
          SELECT 1 FROM submissions i WHERE i.user_id = s.user_id
            AND i.target_month = s.target_month AND i.kind = 'initial'
            AND i.status <> 'draft')))
      UNION ALL
      SELECT child.id FROM submissions child JOIN review_scope parent ON child.parent_id = parent.id
      WHERE child.target_month = $1 AND child.status <> 'draft'
    )";

#[derive(Clone, Debug, QueryableByName)]
pub struct PublicSubmission {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    pub id: Uuid,
    #[diesel(sql_type = BigInt)]
    pub user_id: i64,
    #[diesel(sql_type = Text)]
    pub kind: Kind,
    #[diesel(sql_type = Date)]
    pub target_month: NaiveDate,
    #[diesel(sql_type = Nullable<diesel::sql_types::Uuid>)]
    pub parent_id: Option<Uuid>,
    #[diesel(sql_type = Text)]
    pub status: Status,
    #[diesel(sql_type = Timestamptz)]
    pub submitted_at: DateTime<Utc>,
    #[diesel(sql_type = Nullable<Text>)]
    pub review_comment: Option<String>,
    #[diesel(sql_type = Array<Nullable<Text>>)]
    pub required_doc_types: Vec<Option<DocType>>,
    #[diesel(sql_type = Array<Nullable<Text>>)]
    pub revision_doc_types: Vec<Option<DocType>>,
    #[diesel(sql_type = Timestamptz)]
    pub created_at: DateTime<Utc>,
}

/// A file actually included when a submission was finalized. A superseded upload
/// inside that draft was never submitted, so it is not an "earlier submission".
#[derive(Clone, Debug, QueryableByName)]
pub struct SubmittedFile {
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    pub id: Uuid,
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    pub submission_id: Uuid,
    #[diesel(sql_type = Text)]
    pub doc_type: DocType,
    #[diesel(sql_type = Text)]
    pub original_name: String,
    #[diesel(sql_type = BigInt)]
    pub size_bytes: i64,
    #[diesel(sql_type = Binary)]
    pub sha256: Vec<u8>,
    #[diesel(sql_type = Nullable<SmallInt>)]
    pub key_id: Option<i16>,
    #[diesel(sql_type = Timestamptz)]
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct SubmissionChain {
    pub user_id: i64,
    pub target_month: NaiveDate,
    pub root_id: Uuid,
    pub root_kind: Kind,
    /// Parent before child; always nonempty. The last item is the completed leaf.
    pub submissions: Vec<PublicSubmission>,
    /// One file per doc_type, including unchanged documents from ancestors.
    pub current_files: Vec<SubmittedFile>,
    /// Only files replaced by another completed submission in this chain.
    pub previous_files: Vec<SubmittedFile>,
}

impl SubmissionChain {
    pub fn root(&self) -> &PublicSubmission {
        self.submissions
            .as_slice()
            .first()
            .expect("a chain contains its root")
    }

    pub fn latest(&self) -> &PublicSubmission {
        self.submissions.last().expect("a chain contains its root")
    }
}

async fn load_public_rows(
    conn: &mut AsyncPgConnection,
    month: Option<NaiveDate>,
    user_id: Option<i64>,
    user_ids: Option<Vec<i64>>,
) -> Result<Vec<PublicSubmission>, AppError> {
    Ok(diesel::sql_query(
        "SELECT s.id, s.user_id, s.kind, s.target_month, s.parent_id, s.status,
                s.submitted_at, s.review_comment, s.required_doc_types,
                s.revision_doc_types, s.created_at
         FROM submissions s JOIN users u ON u.id = s.user_id
         WHERE u.role = 'student' AND s.status <> 'draft'
           AND ($1::date IS NULL OR s.target_month = $1)
           AND ($2::bigint IS NULL OR s.user_id = $2)
           AND ($3::bigint[] IS NULL OR s.user_id = ANY($3))
         ORDER BY s.user_id, s.target_month, s.submitted_at, s.id",
    )
    .bind::<Nullable<Date>, _>(month)
    .bind::<Nullable<BigInt>, _>(user_id)
    .bind::<Nullable<Array<BigInt>>, _>(user_ids)
    .load(conn)
    .await?)
}

pub async fn load_public_submissions(
    conn: &mut AsyncPgConnection,
    month: Option<NaiveDate>,
    user_id: Option<i64>,
) -> Result<Vec<PublicSubmission>, AppError> {
    load_public_rows(conn, month, user_id, None).await
}

pub async fn load_public_submissions_for_users(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    user_ids: &[i64],
) -> Result<Vec<PublicSubmission>, AppError> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }
    load_public_rows(conn, Some(month), None, Some(user_ids.to_vec())).await
}

/// Monthly review lists use this scope; archives retain every submitted chain
/// through load_public_submissions_for_users instead.
pub async fn load_review_submissions_for_users(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    user_ids: &[i64],
) -> Result<Vec<PublicSubmission>, AppError> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(diesel::sql_query(format!(
        "{REVIEW_SCOPE_CTE}
         SELECT s.id, s.user_id, s.kind, s.target_month, s.parent_id, s.status,
                s.submitted_at, s.review_comment, s.required_doc_types,
                s.revision_doc_types, s.created_at
         FROM submissions s JOIN review_scope scope ON scope.id = s.id
         JOIN users u ON u.id = s.user_id
         WHERE u.role = 'student' AND s.user_id = ANY($2)
         ORDER BY s.user_id, s.target_month, s.submitted_at, s.id"
    ))
    .bind::<Date, _>(month)
    .bind::<Array<BigInt>, _>(user_ids)
    .load(conn)
    .await?)
}

pub async fn load_submitted_files(
    conn: &mut AsyncPgConnection,
    submission_ids: &[Uuid],
) -> Result<Vec<SubmittedFile>, AppError> {
    if submission_ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(diesel::sql_query(
        "SELECT f.id, f.submission_id, f.doc_type, f.original_name, f.size_bytes,
                f.sha256, f.key_id, f.created_at
         FROM submission_files f JOIN submissions s ON s.id = f.submission_id
         JOIN users u ON u.id = s.user_id
         WHERE u.role = 'student' AND s.status <> 'draft'
           AND f.superseded_by IS NULL AND s.id = ANY($1)
         ORDER BY s.submitted_at, s.id, f.created_at, f.id",
    )
    .bind::<Array<diesel::sql_types::Uuid>, _>(submission_ids.to_vec())
    .load(conn)
    .await?)
}

/// Call inside a repeatable-read transaction when rows and files must describe
/// the same instant (review/detail/export handlers all need that consistency).
pub async fn load_chains(
    conn: &mut AsyncPgConnection,
    month: Option<NaiveDate>,
    user_id: Option<i64>,
) -> Result<Vec<SubmissionChain>, AppError> {
    let submissions = load_public_submissions(conn, month, user_id).await?;
    let ids = submissions.iter().map(|s| s.id).collect::<Vec<_>>();
    let files = load_submitted_files(conn, &ids).await?;
    build_chains(submissions, files)
}

fn invalid_chain() -> AppError {
    AppError::Internal(anyhow::anyhow!("invalid completed submission chain"))
}

/// Follow parent links rather than choosing the newest row for a whole person:
/// initial and monthly chains remain independent records even when the review
/// workflow hides a duplicate monthly chain in the initial submission month.
pub fn build_chains(
    submissions: Vec<PublicSubmission>,
    files: Vec<SubmittedFile>,
) -> Result<Vec<SubmissionChain>, AppError> {
    let draft_ids = submissions
        .iter()
        .filter(|s| s.status == Status::Draft)
        .map(|s| s.id)
        .collect::<HashSet<_>>();
    let mut rows = BTreeMap::new();
    for s in submissions
        .into_iter()
        .filter(|s| s.status != Status::Draft)
    {
        if rows.insert(s.id, s).is_some() {
            return Err(invalid_chain());
        }
    }
    let mut children = HashMap::new();
    for s in rows.values() {
        match (s.kind, s.parent_id) {
            (Kind::Supplement, Some(parent_id)) => {
                let parent = rows.get(&parent_id).ok_or_else(invalid_chain)?;
                if parent.user_id != s.user_id
                    || parent.target_month != s.target_month
                    || children.insert(parent_id, s.id).is_some()
                {
                    return Err(invalid_chain());
                }
            }
            (Kind::Initial | Kind::Monthly, None) => {}
            _ => return Err(invalid_chain()),
        }
    }
    let mut files_by_submission: HashMap<Uuid, Vec<SubmittedFile>> = HashMap::new();
    for file in files {
        if draft_ids.contains(&file.submission_id) {
            continue;
        }
        let sub = rows.get(&file.submission_id).ok_or_else(invalid_chain)?;
        if !sub.required_doc_types.contains(&Some(file.doc_type)) {
            return Err(invalid_chain());
        }
        let group = files_by_submission.entry(file.submission_id).or_default();
        if group.iter().any(|f| f.doc_type == file.doc_type) {
            return Err(invalid_chain());
        }
        group.push(file);
    }
    let mut visited = HashSet::new();
    let mut chains = Vec::new();
    for root in rows.values().filter(|s| s.parent_id.is_none()) {
        let mut chain = SubmissionChain {
            user_id: root.user_id,
            target_month: root.target_month,
            root_id: root.id,
            root_kind: root.kind,
            submissions: Vec::new(),
            current_files: Vec::new(),
            previous_files: Vec::new(),
        };
        let mut cursor = Some(root.id);
        while let Some(id) = cursor {
            if !visited.insert(id) {
                return Err(invalid_chain());
            }
            let sub = rows.get(&id).ok_or_else(invalid_chain)?;
            chain.submissions.push(sub.clone());
            for file in files_by_submission.remove(&id).unwrap_or_default() {
                if let Some(position) = chain
                    .current_files
                    .iter()
                    .position(|f| f.doc_type == file.doc_type)
                {
                    chain
                        .previous_files
                        .push(chain.current_files.remove(position));
                }
                chain.current_files.push(file);
            }
            cursor = children.get(&id).copied();
        }
        chain.current_files.sort_by_key(|f| doc_order(f.doc_type));
        chain.previous_files.sort_by_key(|f| {
            let position = chain
                .submissions
                .iter()
                .position(|s| s.id == f.submission_id)
                .expect("file belongs to this chain");
            (position, doc_order(f.doc_type), f.id)
        });
        chains.push(chain);
    }
    if visited.len() != rows.len() {
        return Err(invalid_chain()); // missing root or a parent cycle
    }
    chains.sort_by_key(|c| (c.user_id, c.target_month, c.root().submitted_at, c.root_id));
    Ok(chains)
}

fn doc_order(doc_type: DocType) -> usize {
    DocType::ALL
        .iter()
        .position(|d| *d == doc_type)
        .expect("known document type")
}

/// "9" / "9기" / "3a" → "9기" / "9기" / "3기A". The ordinal is free text, so anything that is
/// not `digits [기] [letter]` is shown as typed. Mirrors `ordinalText` in admin-front.
fn ordinal_text(raw: &str) -> String {
    let text = raw.trim();
    let digits = text.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        let rest = text[digits..].trim_start();
        let rest = rest.strip_prefix('기').unwrap_or(rest).trim_start();
        let mut letters = rest.chars();
        match (letters.next(), letters.next()) {
            (None, _) => return format!("{}기", &text[..digits]),
            (Some(c), None) if c.is_ascii_alphabetic() => {
                return format!("{}기{}", &text[..digits], c.to_ascii_uppercase());
            }
            _ => {}
        }
    }
    text.to_owned()
}

/// "9기A_홍길동(030421)": how staff screens and the ZIP name a student. The 한글 이름 replaces
/// the 42 display name; a part the student has not entered yet is left out. Mirrors
/// `studentLabel` in admin-front.
pub fn student_label(
    ordinal: Option<&str>,
    ko_name: Option<&str>,
    display_name: &str,
    date_of_birth: Option<NaiveDate>,
) -> String {
    let name = ko_name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(display_name);
    let prefix = ordinal
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .map(|o| format!("{}_", ordinal_text(o)))
        .unwrap_or_default();
    let birth = date_of_birth
        .map(|d| format!("({})", d.format("%y%m%d")))
        .unwrap_or_default();
    format!("{prefix}{name}{birth}")
}

#[cfg(test)]
mod tests {
    #[test]
    fn student_label_follows_the_staff_naming_rule() {
        let born = NaiveDate::from_ymd_opt(2003, 4, 21);
        assert_eq!(
            super::student_label(Some("9"), Some("한지민"), "jimin", born),
            "9기_한지민(030421)"
        );
        assert_eq!(
            super::student_label(Some("3a"), Some(" 한지민 "), "jimin", born),
            "3기A_한지민(030421)"
        );
        assert_eq!(
            super::student_label(Some("7기"), None, "jimin", None),
            "7기_jimin"
        );
        assert_eq!(
            super::student_label(Some("특별반"), None, "jimin", None),
            "특별반_jimin"
        );
        assert_eq!(super::student_label(None, None, "jimin", None), "jimin");
        assert_eq!(
            super::student_label(Some(" "), Some(""), "jimin", born),
            "jimin(030421)"
        );
    }

    use super::*;

    fn submission(id: u128, kind: Kind, parent: Option<u128>, status: Status) -> PublicSubmission {
        let at = DateTime::parse_from_rfc3339("2026-10-10T01:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        PublicSubmission {
            id: Uuid::from_u128(id),
            user_id: 1,
            kind,
            target_month: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            parent_id: parent.map(Uuid::from_u128),
            status,
            submitted_at: at,
            review_comment: None,
            required_doc_types: DocType::ALL.iter().copied().map(Some).collect(),
            revision_doc_types: Vec::new(),
            created_at: at,
        }
    }

    fn file(id: u128, submission_id: u128, doc_type: DocType) -> SubmittedFile {
        SubmittedFile {
            id: Uuid::from_u128(id),
            submission_id: Uuid::from_u128(submission_id),
            doc_type,
            original_name: "demo.pdf".into(),
            size_bytes: 12,
            sha256: vec![0; 32],
            key_id: Some(1),
            created_at: DateTime::parse_from_rfc3339("2026-10-10T00:59:00Z")
                .unwrap()
                .with_timezone(&Utc),
        }
    }

    #[test]
    fn partial_supplements_keep_unchanged_documents_and_actual_previous_submissions() {
        let rows = vec![
            submission(3, Kind::Supplement, Some(2), Status::RevisionRequested),
            submission(1, Kind::Initial, None, Status::Resubmitted),
            submission(2, Kind::Supplement, Some(1), Status::Resubmitted),
        ];
        let files = vec![
            file(10, 1, DocType::IdCard),
            file(11, 1, DocType::Bankbook),
            file(12, 2, DocType::Bankbook),
            file(13, 3, DocType::Bankbook),
        ];
        let chains = build_chains(rows, files).unwrap_or_else(|_| panic!("valid chain"));
        let chain = &chains[0];
        assert_eq!(chain.latest().id, Uuid::from_u128(3));
        assert_eq!(chain.latest().status, Status::RevisionRequested);
        assert_eq!(
            chain
                .current_files
                .iter()
                .map(|f| f.id.as_u128())
                .collect::<Vec<_>>(),
            [10, 13]
        );
        assert_eq!(
            chain
                .previous_files
                .iter()
                .map(|f| f.id.as_u128())
                .collect::<Vec<_>>(),
            [11, 12]
        );
    }

    #[test]
    fn same_month_initial_and_monthly_stay_separate_and_drafts_do_not_hide_a_request() {
        let rows = vec![
            submission(1, Kind::Initial, None, Status::RevisionRequested),
            submission(2, Kind::Monthly, None, Status::PendingReview),
            submission(3, Kind::Supplement, Some(1), Status::Draft),
        ];
        let chains = build_chains(rows, vec![file(10, 3, DocType::Bankbook)])
            .unwrap_or_else(|_| panic!("valid independent chains"));
        assert_eq!(chains.len(), 2);
        assert_eq!(chains[0].latest().status, Status::RevisionRequested);
        assert_eq!(chains[1].root_kind, Kind::Monthly);
        assert!(chains.iter().all(|c| c.current_files.is_empty()));
    }

    #[test]
    fn crossed_owners_missing_parents_and_branches_fail_closed() {
        let root = submission(1, Kind::Monthly, None, Status::Resubmitted);
        let mut child = submission(2, Kind::Supplement, Some(1), Status::Resubmitted);
        child.user_id = 2;
        assert!(build_chains(vec![root.clone(), child], vec![]).is_err());
        assert!(
            build_chains(
                vec![submission(
                    2,
                    Kind::Supplement,
                    Some(9),
                    Status::Resubmitted
                )],
                vec![]
            )
            .is_err()
        );
        let first = submission(2, Kind::Supplement, Some(1), Status::Resubmitted);
        let second = submission(3, Kind::Supplement, Some(1), Status::Resubmitted);
        assert!(build_chains(vec![root, first, second], vec![]).is_err());
    }

    #[test]
    fn parent_cycles_and_duplicate_current_documents_fail_closed() {
        assert!(
            build_chains(
                vec![
                    submission(1, Kind::Supplement, Some(2), Status::Resubmitted),
                    submission(2, Kind::Supplement, Some(1), Status::Resubmitted),
                ],
                vec![]
            )
            .is_err()
        );
        assert!(
            build_chains(
                vec![submission(1, Kind::Initial, None, Status::Approved)],
                vec![
                    file(10, 1, DocType::Bankbook),
                    file(11, 1, DocType::Bankbook),
                ]
            )
            .is_err()
        );
    }
}
