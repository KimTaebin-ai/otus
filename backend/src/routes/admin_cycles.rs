//! Staff period configuration. Concurrent editors must reload instead of overwriting.
use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Datelike, NaiveDate, Timelike, Utc};
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Date, Nullable, Text, Timestamptz};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::domain::Role;
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::kst;
use crate::session::{CurrentUser, require_staff};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    year: Option<i32>,
}

#[derive(QueryableByName)]
struct Period {
    #[diesel(sql_type = Date)]
    target_month: NaiveDate,
    #[diesel(sql_type = Timestamptz)]
    opens_at: DateTime<Utc>,
    #[diesel(sql_type = Timestamptz)]
    closes_at: DateTime<Utc>,
    #[diesel(sql_type = BigInt)]
    version: i64,
}

#[derive(Serialize)]
pub struct PeriodView {
    #[serde(serialize_with = "kst::serialize_month")]
    target_month: NaiveDate,
    #[serde(serialize_with = "kst::serialize_opt")]
    opens_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "kst::serialize_opt")]
    closes_at: Option<DateTime<Utc>>,
    version: Option<i64>,
    state: &'static str,
}

fn view(month: NaiveDate, period: Option<&Period>, now: DateTime<Utc>) -> PeriodView {
    PeriodView {
        target_month: month,
        opens_at: period.map(|p| p.opens_at),
        closes_at: period.map(|p| p.closes_at),
        version: period.map(|p| p.version),
        state: match period {
            None => "not_set",
            Some(p) if now < p.opens_at => "upcoming",
            Some(p) if now < p.closes_at => "open",
            Some(_) => "closed",
        },
    }
}

#[derive(Serialize)]
pub struct PeriodList {
    #[serde(serialize_with = "kst::serialize_month")]
    current_month: NaiveDate,
    year: i32,
    can_manage: bool,
    items: Vec<PeriodView>,
}

fn can_manage(role: Role) -> bool {
    matches!(role, Role::Operator | Role::Admin)
}

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Json<PeriodList>, AppError> {
    require_staff(&user)?;
    let Query(query) = query.map_err(|_| invalid("조회 연도를 확인해 주세요."))?;
    let now = Utc::now();
    let current_month = kst::current_month(now);
    let year = query.year.unwrap_or(current_month.year());
    if !(1..=9998).contains(&year) {
        return Err(invalid("조회 연도는 1~9998이어야 합니다."));
    }
    let start = NaiveDate::from_ymd_opt(year, 1, 1).expect("validated year");
    let end = NaiveDate::from_ymd_opt(year + 1, 1, 1).expect("validated year");
    let mut conn = state.pool.get().await?;
    let periods: Vec<Period> = diesel::sql_query(
        "SELECT target_month,opens_at,closes_at,version FROM cycles WHERE target_month >= $1 AND target_month < $2 ORDER BY target_month",
    ).bind::<Date, _>(start).bind::<Date, _>(end).load(&mut conn).await?;
    Ok(Json(PeriodList {
        current_month,
        year,
        can_manage: can_manage(user.role),
        items: (1..=12)
            .map(|month| {
                let date = NaiveDate::from_ymd_opt(year, month, 1).expect("valid month");
                view(date, periods.iter().find(|p| p.target_month == date), now)
            })
            .collect(),
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    opens_at: DateTime<Utc>,
    closes_at: DateTime<Utc>,
    expected_version: Option<i64>,
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidRequest(message.into())
}

fn parse_month(month: &str) -> Result<NaiveDate, AppError> {
    kst::parse_month(month)
        .filter(|m| (1..=9998).contains(&m.year()))
        .ok_or_else(|| invalid("대상 월은 YYYY-MM 형식이어야 합니다."))
}

fn validate(month: NaiveDate, body: &SaveRequest, now: DateTime<Utc>) -> Result<(), AppError> {
    if month < kst::current_month(now) {
        return Err(invalid("지난달 제출 기간은 변경할 수 없습니다."));
    }
    let (start, end) = kst::month_window(month);
    if body.opens_at < start || body.closes_at > end || body.opens_at >= body.closes_at {
        return Err(invalid(
            "시작은 마감보다 빨라야 하며, 제출 기간은 대상 월 안이어야 합니다.",
        ));
    }
    if body.opens_at.nanosecond() != 0 || body.closes_at.nanosecond() != 0 {
        return Err(invalid("제출 기간은 초 단위로 입력해 주세요."));
    }
    if body.expected_version.is_some_and(|v| v <= 0) {
        return Err(invalid("수정할 기간의 버전이 올바르지 않습니다."));
    }
    Ok(())
}

pub async fn save(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(month): Path<String>,
    ApiJson(body): ApiJson<SaveRequest>,
) -> Result<Json<PeriodView>, AppError> {
    if !can_manage(user.role) {
        return Err(AppError::Forbidden);
    }
    let month = parse_month(&month)?;
    validate(month, &body, Utc::now())?;
    let mut conn = state.pool.get().await?;
    let result = conn.transaction::<_, AppError, _>(async move |conn| {
        // Also serialize creation when the month's row does not yet exist.
        diesel::sql_query("SELECT pg_advisory_xact_lock(17021, $1)")
            .bind::<diesel::sql_types::Integer, _>(month.year() * 12 + month.month() as i32)
            .execute(conn).await?;
        validate(month, &body, Utc::now())?;
        let old = diesel::sql_query("SELECT target_month,opens_at,closes_at,version FROM cycles WHERE target_month=$1 FOR UPDATE")
            .bind::<Date, _>(month).get_result::<Period>(conn).await.optional()?;
        validate(month, &body, Utc::now())?;
        if old.as_ref().map(|p| p.version) != body.expected_version {
            return Err(AppError::InvalidState("제출 기간이 변경되었습니다. 새로 불러온 내용을 확인하고 다시 저장해 주세요.".into()));
        }
        if let Some(p) = &old && p.opens_at == body.opens_at && p.closes_at == body.closes_at {
            return Ok(view(month, Some(p), Utc::now()));
        }
        let saved = diesel::sql_query(
            "INSERT INTO cycles(target_month,opens_at,closes_at) VALUES ($1,$2,$3) ON CONFLICT(target_month) DO UPDATE SET opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,version=cycles.version+1 RETURNING target_month,opens_at,closes_at,version",
        ).bind::<Date, _>(month).bind::<Timestamptz, _>(body.opens_at).bind::<Timestamptz, _>(body.closes_at)
            .get_result::<Period>(conn).await?;
        diesel::sql_query("INSERT INTO cycle_changes(target_month,version,actor_user_id,actor_name,actor_role,previous_opens_at,previous_closes_at,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind::<Date, _>(month).bind::<BigInt, _>(saved.version).bind::<BigInt, _>(user.id)
            .bind::<Text, _>(&user.display_name).bind::<Text, _>(user.role.as_str())
            .bind::<Nullable<Timestamptz>, _>(old.as_ref().map(|p| p.opens_at))
            .bind::<Nullable<Timestamptz>, _>(old.as_ref().map(|p| p.closes_at))
            .bind::<Timestamptz, _>(saved.opens_at).bind::<Timestamptz, _>(saved.closes_at).execute(conn).await?;
        Ok(view(month, Some(&saved), Utc::now()))
    }).await?;
    Ok(Json(result))
}

#[derive(QueryableByName, Serialize)]
pub struct Change {
    #[diesel(sql_type = BigInt)]
    version: i64,
    #[diesel(sql_type = Text)]
    actor_name: String,
    #[diesel(sql_type = Text)]
    actor_role: String,
    #[diesel(sql_type = Nullable<Timestamptz>)]
    #[serde(serialize_with = "kst::serialize_opt")]
    previous_opens_at: Option<DateTime<Utc>>,
    #[diesel(sql_type = Nullable<Timestamptz>)]
    #[serde(serialize_with = "kst::serialize_opt")]
    previous_closes_at: Option<DateTime<Utc>>,
    #[diesel(sql_type = Timestamptz)]
    #[serde(serialize_with = "kst::serialize")]
    opens_at: DateTime<Utc>,
    #[diesel(sql_type = Timestamptz)]
    #[serde(serialize_with = "kst::serialize")]
    closes_at: DateTime<Utc>,
    #[diesel(sql_type = Timestamptz)]
    #[serde(serialize_with = "kst::serialize")]
    created_at: DateTime<Utc>,
}

pub async fn history(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(month): Path<String>,
) -> Result<Json<Vec<Change>>, AppError> {
    require_staff(&user)?;
    let month = parse_month(&month)?;
    let mut conn = state.pool.get().await?;
    Ok(Json(load_history(&mut conn, month).await?))
}

async fn load_history(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
) -> Result<Vec<Change>, AppError> {
    Ok(diesel::sql_query("SELECT version,actor_name,actor_role,previous_opens_at,previous_closes_at,opens_at,closes_at,created_at FROM cycle_changes WHERE target_month=$1 ORDER BY version DESC LIMIT 50")
        .bind::<Date, _>(month).load(conn).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(value: &str) -> DateTime<Utc> {
        value.parse().unwrap()
    }
    #[test]
    fn permits_current_and_future_windows_but_not_past_or_cross_month_edits() {
        let month = parse_month("2026-11").ok().unwrap();
        let now = at("2026-10-18T12:00:00+09:00");
        let mut body = SaveRequest {
            opens_at: at("2026-11-21T09:00:00+09:00"),
            closes_at: at("2026-12-01T00:00:00+09:00"),
            expected_version: None,
        };
        assert!(validate(month, &body, now).is_ok());
        assert!(validate(month, &body, at("2026-12-01T00:00:00+09:00")).is_err());
        body.closes_at = at("2026-12-01T00:00:01+09:00");
        assert!(validate(month, &body, now).is_err());
        body.closes_at = body.opens_at;
        assert!(validate(month, &body, now).is_err());
        assert!(!can_manage(Role::Accountant));
        assert!(!can_manage(Role::Student));
        assert!(can_manage(Role::Operator) && can_manage(Role::Admin));
    }
}
