use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use uuid::Uuid;

use crate::domain::{DocType, Kind, Role, Status, Tier};
use crate::schema::{
    bank_account_changes, cycles, notifications, sessions, submission_events, submission_files,
    submissions, time_requirements, users,
};

#[derive(Queryable, Selectable, Clone)]
#[diesel(table_name = users, check_for_backend(diesel::pg::Pg))]
pub struct User {
    pub id: i64,
    pub login: String,
    pub display_name: String,
    pub role: Role,
    pub is_demo: bool,
    pub employed: bool,
    pub employment_updated_at: Option<DateTime<Utc>>,
    /// 42 cohort (기수), free text ("5", "7기", "8a", "9기A"); NULL until
    /// entered (the 42 payload has no cohort ordinal)
    pub ordinal: Option<String>,
    /// Korean name; NULL until entered (42 display names are not language-tagged)
    pub ko_name: Option<String>,
    /// Date of birth; NULL until entered (not carried by the 42 payload)
    pub date_of_birth: Option<NaiveDate>,
}

#[derive(Insertable)]
#[diesel(table_name = users)]
pub struct NewDemoUser<'a> {
    pub login: &'a str,
    pub display_name: &'a str,
    pub is_demo: bool,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = sessions, check_for_backend(diesel::pg::Pg))]
pub struct Session {
    pub csrf_hash: Vec<u8>,
    pub last_seen_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = submissions, check_for_backend(diesel::pg::Pg))]
pub struct Submission {
    pub id: Uuid,
    pub kind: Kind,
    pub target_month: NaiveDate,
    pub parent_id: Option<Uuid>,
    pub status: Status,
    pub submitted_at: Option<DateTime<Utc>>,
    pub review_comment: Option<String>,
    pub required_doc_types: Vec<Option<DocType>>,
    pub revision_doc_types: Vec<Option<DocType>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Insertable)]
#[diesel(table_name = submissions)]
pub struct NewSubmission {
    pub id: Uuid,
    pub user_id: i64,
    pub kind: Kind,
    pub target_month: NaiveDate,
    pub parent_id: Option<Uuid>,
    pub required_doc_types: Vec<Option<DocType>>,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = submission_files, check_for_backend(diesel::pg::Pg))]
pub struct SubmissionFile {
    pub id: Uuid,
    pub submission_id: Uuid,
    pub doc_type: DocType,
    pub original_name: String,
    pub size_bytes: i64,
    pub sha256: Vec<u8>,
    pub key_id: Option<i16>,
    pub created_at: DateTime<Utc>,
}

#[derive(Insertable)]
#[diesel(table_name = submission_events)]
pub struct NewSubmissionEvent {
    pub submission_id: Uuid,
    pub from_status: Option<Status>,
    pub to_status: Status,
    pub actor_user_id: i64,
    pub idempotency_key: Option<Uuid>,
    pub note: Option<String>,
}

#[derive(Insertable)]
#[diesel(table_name = submission_files)]
pub struct NewSubmissionFile {
    pub id: Uuid,
    pub submission_id: Uuid,
    pub doc_type: DocType,
    pub original_name: String,
    pub size_bytes: i64,
    pub sha256: Vec<u8>,
    pub key_id: Option<i16>,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = cycles, check_for_backend(diesel::pg::Pg))]
pub struct Cycle {
    pub opens_at: DateTime<Utc>,
    pub closes_at: DateTime<Utc>,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = bank_account_changes, check_for_backend(diesel::pg::Pg))]
pub struct BankAccountChange {
    pub id: i64,
    pub bank: String,
    pub account_last4: String,
    pub status: String,
    pub requested_at: DateTime<Utc>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_note: Option<String>,
    pub bankbook_file_id: Option<Uuid>,
    pub bankbook_original_name: Option<String>,
    pub bankbook_size_bytes: Option<i64>,
}

#[derive(Queryable, Selectable, Clone)]
#[allow(dead_code)] // user_id is loaded for ownership-shaped selects, not rendered
#[diesel(table_name = notifications, check_for_backend(diesel::pg::Pg))]
pub struct Notification {
    pub id: i64,
    pub user_id: i64,
    pub kind: String,
    pub data: String,
    pub created_at: DateTime<Utc>,
    pub read_at: Option<DateTime<Utc>>,
}

#[derive(Queryable, Selectable, Clone)]
#[allow(dead_code)] // id/user_id are loaded for row identity, not rendered
#[diesel(table_name = time_requirements, check_for_backend(diesel::pg::Pg))]
pub struct TimeRequirement {
    pub id: i64,
    pub user_id: i64,
    pub target_month: NaiveDate,
    pub recognized_seconds: i64,
    pub as_of: DateTime<Utc>,
    pub result_status: Option<String>,
    pub tier: Option<Tier>,
    pub decided_at: Option<DateTime<Utc>>,
    pub final_status: String,
    pub final_amount: Option<i64>,
    pub final_decided_at: Option<DateTime<Utc>>,
}
