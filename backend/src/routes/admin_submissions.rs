//! Monthly staff list: one student per row. Initial documents cover monthly
//! review in the same month. Absence of a completed submission is unsubmitted; draft
//! identifiers, files and contents are never exposed.

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Bool, Date, Nullable, Text, Timestamptz};
use diesel_async::{AsyncConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::admin_data::{self, SubmissionChain};
use crate::domain::{Kind, Status};
use crate::error::AppError;
use crate::kst;
use crate::session::{CurrentUser, require_staff};

#[derive(Deserialize)]
pub struct ListQuery {
    month: Option<String>,
    status: Option<String>,
    query: Option<String>,
    limit: Option<String>,
    before: Option<String>,
}

struct ValidatedQuery {
    month: NaiveDate,
    status: Option<String>,
    search: Option<String>,
    limit: usize,
    before: Option<i64>,
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidRequest(message.into())
}

fn validate_query(
    query: Result<Query<ListQuery>, QueryRejection>,
    now: DateTime<Utc>,
) -> Result<ValidatedQuery, AppError> {
    let Query(query) = query.map_err(|_| invalid("query 형식이 올바르지 않습니다."))?;
    let month = match query.month {
        None => kst::current_month(now),
        Some(value) => {
            // parse_month is also used by legacy endpoints. Require the exact
            // documented ASCII representation here, including a four-digit year.
            if value.len() != 7
                || value.as_bytes()[4] != b'-'
                || !value
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| i == 4 || b.is_ascii_digit())
            {
                return Err(invalid("month는 YYYY-MM 형식이어야 합니다."));
            }
            kst::parse_month(&value).ok_or_else(|| invalid("month는 YYYY-MM 형식이어야 합니다."))?
        }
    };
    let status = match query.status.as_deref() {
        None | Some("all") => None,
        Some(
            value @ ("unsubmitted" | "pending_review" | "approved" | "revision_requested"
            | "resubmitted"),
        ) => Some(value.to_owned()),
        _ => return Err(invalid("status 필터가 올바르지 않습니다.")),
    };
    let limit = match query.limit {
        None => 20,
        Some(value) => value
            .parse::<usize>()
            .ok()
            .filter(|value| (1..=50).contains(value))
            .ok_or_else(|| invalid("limit은 1~50 사이의 정수여야 합니다."))?,
    };
    let before = query
        .before
        .map(|value| {
            value
                .parse::<i64>()
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| invalid("before는 양의 정수여야 합니다."))
        })
        .transpose()?;
    let search = query
        .query
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if search
        .as_ref()
        .is_some_and(|value| value.chars().count() > 100)
    {
        return Err(invalid("query는 100자 이하여야 합니다."));
    }
    Ok(ValidatedQuery {
        month,
        status,
        search: search.map(|value| search_pattern(&value)),
        limit,
        before,
    })
}

fn search_pattern(value: &str) -> String {
    format!(
        "%{}%",
        value
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}

#[derive(Serialize, QueryableByName)]
pub struct StudentSummary {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    login: String,
    #[diesel(sql_type = Text)]
    display_name: String,
    /// Current employment state; it is not reconstructed for historical months.
    #[diesel(sql_type = Bool)]
    employed: bool,
    #[diesel(sql_type = Bool)]
    initial_submitted: bool,
    #[diesel(sql_type = Nullable<Text>)]
    ordinal: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    ko_name: Option<String>,
    #[diesel(sql_type = Nullable<Date>)]
    date_of_birth: Option<NaiveDate>,
}

#[derive(Serialize)]
pub struct ChainSummary {
    root_submission_id: Uuid,
    root_kind: Kind,
    latest_submission_id: Uuid,
    latest_kind: Kind,
    status: Status,
    #[serde(serialize_with = "kst::serialize")]
    submitted_at: DateTime<Utc>,
    supplement_count: usize,
}

impl From<&SubmissionChain> for ChainSummary {
    fn from(chain: &SubmissionChain) -> Self {
        let latest = chain.latest();
        Self {
            root_submission_id: chain.root_id,
            root_kind: chain.root_kind,
            latest_submission_id: latest.id,
            latest_kind: latest.kind,
            status: latest.status,
            submitted_at: latest.submitted_at,
            supplement_count: chain.submissions.len() - 1,
        }
    }
}

#[derive(Serialize)]
pub struct StudentRow {
    user: StudentSummary,
    chains: Vec<ChainSummary>,
    #[serde(serialize_with = "kst::serialize_opt")]
    last_submitted_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct ListResponse {
    #[serde(serialize_with = "kst::serialize_month")]
    month: NaiveDate,
    months: Vec<String>,
    items: Vec<StudentRow>,
    next_before: Option<i64>,
}

#[derive(QueryableByName)]
struct AvailableMonth {
    #[diesel(sql_type = Date)]
    target_month: NaiveDate,
}

/// PostgreSQL applies the status filter to completed leaves, before pagination.
/// A parent's resubmitted status cannot hide the child's later revision request
/// or cause that person to appear in a second status filter for the same chain.
const STUDENTS_SQL: &str = "
    SELECT u.id, u.login, u.display_name, u.employed,
           u.ordinal, u.ko_name, u.date_of_birth,
           EXISTS (SELECT 1 FROM submissions i WHERE i.user_id = u.id
                   AND i.kind = 'initial' AND i.status <> 'draft') AS initial_submitted
    FROM users u
    WHERE u.role = 'student' AND u.created_at < $2
      AND ($3::text IS NULL OR u.login ILIKE $3 OR u.display_name ILIKE $3)
      AND ($4::bigint IS NULL OR u.id < $4)
      AND ($5::text IS NULL
        OR ($5 = 'unsubmitted' AND NOT EXISTS (
            SELECT 1 FROM submissions s JOIN review_scope scope ON scope.id = s.id
            WHERE s.user_id = u.id
              AND s.target_month = $1 AND s.status <> 'draft'))
        OR EXISTS (
            SELECT 1 FROM submissions s JOIN review_scope scope ON scope.id = s.id
            WHERE s.user_id = u.id
              AND s.target_month = $1 AND s.status = $5 AND s.status <> 'draft'
              AND NOT EXISTS (SELECT 1 FROM submissions child
                              WHERE child.parent_id = s.id AND child.status <> 'draft')))
    ORDER BY u.id DESC LIMIT $6";

fn take_page(mut rows: Vec<StudentSummary>, limit: usize) -> (Vec<StudentSummary>, Option<i64>) {
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    let next_before = if has_more {
        rows.last().map(|row| row.id)
    } else {
        None
    };
    (rows, next_before)
}

/// GET /api/admin/submissions — includes students who have not finished initial
/// registration. Only the separate reminder API requires initial_submitted.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Json<ListResponse>, AppError> {
    require_staff(&user)?;
    let now = Utc::now();
    let query = validate_query(query, now)?;
    let month = query.month;
    let (_, month_end) = kst::month_window(month);
    let mut conn = state.pool.get().await?;
    let response = conn
        .transaction::<_, AppError, _>(async move |conn| {
            diesel::sql_query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                .execute(conn)
                .await?;
            let students: Vec<StudentSummary> =
                diesel::sql_query(format!("{} {STUDENTS_SQL}", admin_data::REVIEW_SCOPE_CTE))
                    .bind::<Date, _>(month)
                    .bind::<Timestamptz, _>(month_end)
                    .bind::<Nullable<Text>, _>(query.search)
                    .bind::<Nullable<BigInt>, _>(query.before)
                    .bind::<Nullable<Text>, _>(query.status)
                    .bind::<BigInt, _>(query.limit as i64 + 1)
                    .load(conn)
                    .await?;
            let (students, next_before) = take_page(students, query.limit);
            let ids = students.iter().map(|user| user.id).collect::<Vec<_>>();
            let submissions =
                admin_data::load_review_submissions_for_users(conn, month, &ids).await?;
            // This list needs status/identity only. Files are intentionally not read.
            let chains = admin_data::build_chains(submissions, Vec::new())?;
            let items = students
                .into_iter()
                .map(|user| {
                    let chains = chains
                        .iter()
                        .filter(|chain| chain.user_id == user.id)
                        .map(ChainSummary::from)
                        .collect::<Vec<_>>();
                    let last_submitted_at = chains.iter().map(|chain| chain.submitted_at).max();
                    StudentRow {
                        user,
                        chains,
                        last_submitted_at,
                    }
                })
                .collect();
            let available: Vec<AvailableMonth> = diesel::sql_query(
                "SELECT target_month FROM cycles UNION SELECT DISTINCT s.target_month FROM submissions s
             JOIN users u ON u.id = s.user_id
             WHERE s.status <> 'draft' AND u.role = 'student'
             ORDER BY target_month DESC",
            )
            .load(conn)
            .await?;
            let mut months = available
                .into_iter()
                .map(|row| row.target_month)
                .collect::<Vec<_>>();
            months.extend([kst::current_month(now), month]);
            months.sort_unstable_by(|a, b| b.cmp(a));
            months.dedup();
            Ok(ListResponse {
                month,
                months: months
                    .into_iter()
                    .map(|month| month.format("%Y-%m").to_string())
                    .collect(),
                items,
                next_before,
            })
        })
        .await?;
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{StatusCode, Uri};
    use axum::response::IntoResponse;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-31T15:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn query(value: &str) -> Result<ValidatedQuery, AppError> {
        let uri: Uri = format!("/api/admin/submissions?{value}").parse().unwrap();
        validate_query(Query::<ListQuery>::try_from_uri(&uri), now())
    }

    #[test]
    fn defaults_follow_kst_month_boundary_and_all_means_no_status_filter() {
        let value = query("").unwrap_or_else(|_| panic!("valid defaults"));
        assert_eq!(value.month, NaiveDate::from_ymd_opt(2026, 11, 1).unwrap());
        assert_eq!(value.limit, 20);
        assert!(value.status.is_none());
        assert!(
            query("status=all")
                .unwrap_or_else(|_| panic!("valid filter"))
                .status
                .is_none()
        );
        assert_eq!(
            query("status=unsubmitted")
                .unwrap_or_else(|_| panic!("valid filter"))
                .status
                .as_deref(),
            Some("unsubmitted")
        );
    }

    #[test]
    fn rejects_invalid_month_status_limit_and_cursor_without_exposing_drafts() {
        for value in [
            "month=2026-1",
            "month=2026-13",
            "month=2026-10-01",
            "month=%2B026-10",
            "status=draft",
            "status=missing",
            "limit=0",
            "limit=51",
            "limit=-1",
            "limit=no",
            "before=0",
            "before=-1",
            "before=abc",
        ] {
            assert!(
                matches!(query(value), Err(AppError::InvalidRequest(_))),
                "{value}"
            );
        }
    }

    #[tokio::test]
    async fn malformed_query_uses_common_json_error() {
        let error = match query("month=2026-10&month=2026-11") {
            Err(error) => error,
            Ok(_) => panic!("duplicate month must fail"),
        };
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["error"]["code"], "INVALID_REQUEST");
    }

    #[test]
    fn search_treats_backslash_percent_and_underscore_as_literal_characters() {
        assert_eq!(search_pattern("a\\b%c_d"), "%a\\\\b\\%c\\_d%");
        assert!(query(&format!("query={}", "a".repeat(101))).is_err());
    }

    fn student(id: i64) -> StudentSummary {
        StudentSummary {
            id,
            login: "demo".into(),
            display_name: "데모".into(),
            employed: false,
            initial_submitted: false,
            ordinal: None,
            ko_name: None,
            date_of_birth: None,
        }
    }

    #[test]
    fn cursor_is_last_returned_student_not_the_lookahead_row() {
        let (rows, cursor) = take_page(vec![student(9), student(8), student(7)], 2);
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), [9, 8]);
        assert_eq!(cursor, Some(8));
        assert!(take_page(vec![student(7), student(6)], 2).1.is_none());
        assert!(take_page(Vec::new(), 2).1.is_none());
    }

    #[test]
    fn unsubmitted_row_has_no_submission_or_draft_metadata() {
        let value = serde_json::to_value(StudentRow {
            user: student(3),
            chains: Vec::new(),
            last_submitted_at: None,
        })
        .unwrap();
        assert_eq!(value["chains"], serde_json::json!([]));
        assert!(value["last_submitted_at"].is_null());
        assert_eq!(value["user"]["initial_submitted"], false);
        assert!(!value.to_string().contains("draft"));
    }
}
