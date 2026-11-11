//! `GET /api/me/time-requirements` plus the aggregation/decision service (issue #10).
//!
//! Open questions from the proposal, decided here and in api.md:
//! - `on_hold` is not auto-retried on a timer; the hourly job only decides months
//!   with no result yet. A held month is re-run via the dev endpoint / staff action.
//! - Employed students still get items (FE hides the card via `GET /api/me.employed`).

use axum::Json;
use axum::extract::{Query, State};
use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;
use crate::domain::Tier;
use crate::eligibility;
use crate::error::AppError;
use crate::kst;
use crate::models::TimeRequirement;
use crate::schema::{time_requirements, users};
use crate::session::CurrentUser;

use super::notifications::notify_once;

#[derive(Serialize, Clone)]
pub struct ThresholdView {
    tier: Tier,
    seconds: i64,
    amount: i64,
}

#[derive(Serialize)]
struct ResultView {
    status: String,
    tier: Option<Tier>,
    #[serde(serialize_with = "kst::serialize_opt")]
    decided_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct FinalView {
    status: String,
    amount: Option<i64>,
    #[serde(serialize_with = "kst::serialize_opt")]
    decided_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct TimeRequirementView {
    #[serde(serialize_with = "kst::serialize_month")]
    month: NaiveDate,
    phase: String,
    #[serde(serialize_with = "kst::serialize")]
    as_of: DateTime<Utc>,
    recognized_seconds: i64,
    thresholds: Vec<ThresholdView>,
    projected_tier: Option<Tier>,
    #[serde(serialize_with = "kst::serialize")]
    decides_at: DateTime<Utc>,
    result: Option<ResultView>,
    #[serde(rename = "final")]
    final_view: FinalView,
}

fn thresholds() -> Vec<ThresholdView> {
    eligibility::thresholds()
        .into_iter()
        .map(|(tier, seconds, amount)| ThresholdView {
            tier,
            seconds,
            amount,
        })
        .collect()
}

impl TimeRequirementView {
    fn from_row(row: &TimeRequirement, now: DateTime<Utc>) -> Self {
        let has_result = row.result_status.is_some();
        Self {
            month: row.target_month,
            phase: eligibility::phase(row.target_month, now, has_result)
                .as_str()
                .to_owned(),
            as_of: row.as_of,
            recognized_seconds: row.recognized_seconds,
            thresholds: thresholds(),
            projected_tier: if has_result {
                None
            } else {
                eligibility::tier_for(row.recognized_seconds)
            },
            decides_at: eligibility::decides_at(row.target_month),
            result: row.result_status.as_ref().map(|status| ResultView {
                status: status.clone(),
                tier: row.tier,
                decided_at: row.decided_at,
            }),
            final_view: FinalView {
                status: row.final_status.clone(),
                amount: row.final_amount,
                decided_at: row.final_decided_at,
            },
        }
    }

    fn synthesized(month: NaiveDate, now: DateTime<Utc>) -> Self {
        Self {
            month,
            phase: eligibility::phase(month, now, false).as_str().to_owned(),
            as_of: now,
            recognized_seconds: 0,
            thresholds: thresholds(),
            projected_tier: None,
            decides_at: eligibility::decides_at(month),
            result: None,
            final_view: FinalView {
                status: "undecided".into(),
                amount: None,
                decided_at: None,
            },
        }
    }
}

async fn load_row(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    month: NaiveDate,
) -> Result<Option<TimeRequirement>, AppError> {
    Ok(time_requirements::table
        .filter(time_requirements::user_id.eq(user_id))
        .filter(time_requirements::target_month.eq(month))
        .select(TimeRequirement::as_select())
        .first(conn)
        .await
        .optional()?)
}

#[derive(Deserialize)]
pub struct ListQuery {
    month: Option<String>,
    limit: Option<i64>,
}

/// A stored current-month count older than this is re-counted when the student asks.
const FRESH_FOR: chrono::TimeDelta = chrono::TimeDelta::seconds(60);

/// The hourly job only fills the table once an hour (and not at all right after a start), while
/// `/api/me` counts live. Without this the 시간 요건 bar showed the stored (often 0) seconds
/// next to a live "40시간 이상". Same cached 42 sessions and KST daily cap as `/api/me`; a failed
/// lookup keeps the stored value. No database connection is held during the 42 request.
async fn refresh_if_stale(state: &AppState, user: &crate::models::User, now: DateTime<Utc>) {
    let Some(ft) = &state.config.forty_two else {
        return;
    };
    if user.is_demo {
        return;
    }
    let month = kst::current_month(now);
    let stored = match state.pool.get().await {
        Ok(mut conn) => load_row(&mut conn, user.id, month).await.ok().flatten(),
        Err(_) => return,
    };
    if stored
        .as_ref()
        .is_some_and(|row| row.result_status.is_some() || now - row.as_of < FRESH_FOR)
    {
        return;
    }
    let Ok(sessions) = state
        .locations_cache
        .load_month(&state.http, ft, user.id, &user.login, month, now)
        .await
    else {
        tracing::warn!(user_id = user.id, "time-requirement refresh unavailable");
        return;
    };
    let seconds = eligibility::recognized_seconds(&sessions, month, now);
    let Ok(mut conn) = state.pool.get().await else {
        return;
    };
    match upsert_seconds(&mut conn, user.id, month, seconds, now).await {
        Ok(row) if row.result_status.is_none() => {
            if notify_tiers(&mut conn, user.id, month, seconds, &state.config.app_origin)
                .await
                .is_err()
            {
                tracing::warn!(user_id = user.id, "hours_projected notice failed");
            }
        }
        Ok(_) => {}
        Err(_) => tracing::warn!(user_id = user.id, "time-requirement upsert failed"),
    }
}

/// GET /api/me/time-requirements — newest month first. The current month is
/// always present, even with no records yet (`recognized_seconds: 0`).
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let now = Utc::now();
    let wants_current = match &q.month {
        Some(raw) => kst::parse_month(raw) == Some(kst::current_month(now)),
        None => true,
    };
    if wants_current {
        refresh_if_stale(&state, &user, now).await;
    }
    let mut conn = state.pool.get().await?;
    if let Some(raw) = &q.month {
        let month = kst::parse_month(raw)
            .ok_or_else(|| AppError::InvalidRequest("month는 YYYY-MM이어야 합니다.".into()))?;
        let view = match load_row(&mut conn, user.id, month).await? {
            Some(row) => TimeRequirementView::from_row(&row, now),
            None => TimeRequirementView::synthesized(month, now),
        };
        return Ok(Json(json!({ "items": [view] })));
    }
    let limit = q.limit.unwrap_or(12).clamp(1, 36);
    let mut rows: Vec<TimeRequirement> = time_requirements::table
        .filter(time_requirements::user_id.eq(user.id))
        .order(time_requirements::target_month.desc())
        .limit(limit)
        .select(TimeRequirement::as_select())
        .load(&mut conn)
        .await?;
    let current = kst::current_month(now);
    if !rows.iter().any(|r| r.target_month == current) {
        rows.insert(
            0,
            TimeRequirement {
                id: 0,
                user_id: user.id,
                target_month: current,
                recognized_seconds: 0,
                as_of: now,
                result_status: None,
                tier: None,
                decided_at: None,
                final_status: "undecided".into(),
                final_amount: None,
                final_decided_at: None,
            },
        );
        rows.sort_by_key(|a| std::cmp::Reverse(a.target_month));
        rows.truncate(limit as usize);
    }
    let items: Vec<_> = rows
        .iter()
        .map(|r| TimeRequirementView::from_row(r, now))
        .collect();
    Ok(Json(json!({ "items": items })))
}

async fn upsert_seconds(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    month: NaiveDate,
    seconds: i64,
    now: DateTime<Utc>,
) -> Result<TimeRequirement, AppError> {
    Ok(diesel::insert_into(time_requirements::table)
        .values((
            time_requirements::user_id.eq(user_id),
            time_requirements::target_month.eq(month),
            time_requirements::recognized_seconds.eq(seconds),
            time_requirements::as_of.eq(now),
        ))
        .on_conflict((time_requirements::user_id, time_requirements::target_month))
        .do_update()
        .set((
            time_requirements::recognized_seconds.eq(seconds),
            time_requirements::as_of.eq(now),
        ))
        .returning(TimeRequirement::as_returning())
        .get_result(conn)
        .await?)
}

/// Use the same monthly 42 queries and KST daily cap as `/api/me`.
/// Only demo users may fall back to stored seconds. Missing real credentials or
/// failed upstream requests must never create an artificial zero-hour snapshot.
async fn compute_seconds(
    state: &AppState,
    conn: &mut AsyncPgConnection,
    user_id: i64,
    month: NaiveDate,
    now: DateTime<Utc>,
) -> Result<i64, AppError> {
    let (login, is_demo): (String, bool) = users::table
        .find(user_id)
        .select((users::login, users::is_demo))
        .first(conn)
        .await
        .optional()?
        .ok_or(AppError::NotFound)?;
    if is_demo {
        return Ok(load_row(conn, user_id, month)
            .await?
            .map(|r| r.recognized_seconds)
            .unwrap_or(0));
    }
    let ft =
        state.config.forty_two.as_ref().ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!("42 aggregation is not configured"))
        })?;
    let sessions = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        crate::fortytwo::fetch_month_locations(&state.http, ft, &login, month, now),
    )
    .await
    .map_err(|_| AppError::Internal(anyhow::anyhow!("42 aggregation timed out")))?
    .map_err(AppError::Internal)?;
    Ok(eligibility::recognized_seconds(&sessions, month, now))
}

/// Re-aggregate one month and fire `hours_projected` the first time each tier is
/// reached. Returns the stored row.
pub async fn refresh_month(
    state: &AppState,
    conn: &mut AsyncPgConnection,
    user_id: i64,
    month: NaiveDate,
) -> Result<TimeRequirement, AppError> {
    let now = Utc::now();
    let seconds = compute_seconds(state, conn, user_id, month, now).await?;
    let row = upsert_seconds(conn, user_id, month, seconds, now).await?;
    if row.result_status.is_none() {
        notify_tiers(conn, user_id, month, seconds, &state.config.app_origin).await?;
    }
    Ok(row)
}

/// `hours_projected`, once per tier the count has reached.
async fn notify_tiers(
    conn: &mut AsyncPgConnection,
    user_id: i64,
    month: NaiveDate,
    seconds: i64,
    origin: &str,
) -> Result<(), AppError> {
    for (tier, threshold, _) in eligibility::thresholds() {
        if seconds >= threshold {
            let month_text = format!("{:04}-{:02}", month.year(), month.month());
            let email = crate::mail::hours_email(&month_text, threshold / 3600, origin);
            notify_once(
                conn,
                user_id,
                "hours_projected",
                json!({ "month": month_text, "tier": tier }),
                Some(email),
            )
            .await?;
        }
    }
    Ok(())
}

fn month_string(month: NaiveDate) -> String {
    use chrono::Datelike;
    format!("{:04}-{:02}", month.year(), month.month())
}

/// Run the 1st-09:00 decision for one user/month through the same path as the
/// scheduled job. A failed 42 fetch records `on_hold`, not `not_met`.
pub async fn decide_month(
    state: &AppState,
    conn: &mut AsyncPgConnection,
    user_id: i64,
    month: NaiveDate,
) -> Result<TimeRequirementView, AppError> {
    let now = Utc::now();
    let (seconds, failed) = match compute_seconds(state, conn, user_id, month, now).await {
        Ok(s) => (s, false),
        // Hold, and keep the last known seconds on the row instead of 0.
        Err(AppError::Internal(_)) => (
            load_row(conn, user_id, month)
                .await?
                .map(|r| r.recognized_seconds)
                .unwrap_or(0),
            true,
        ),
        Err(e) => return Err(e),
    };
    let (status, tier) = eligibility::decide(seconds, failed);
    let row = diesel::insert_into(time_requirements::table)
        .values((
            time_requirements::user_id.eq(user_id),
            time_requirements::target_month.eq(month),
            time_requirements::recognized_seconds.eq(seconds),
            time_requirements::as_of.eq(now),
            time_requirements::result_status.eq(status),
            time_requirements::tier.eq(tier),
            time_requirements::decided_at.eq(now),
        ))
        .on_conflict((time_requirements::user_id, time_requirements::target_month))
        .do_update()
        .set((
            time_requirements::recognized_seconds.eq(seconds),
            time_requirements::as_of.eq(now),
            time_requirements::result_status.eq(status),
            time_requirements::tier.eq(tier),
            time_requirements::decided_at.eq(now),
        ))
        .returning(TimeRequirement::as_returning())
        .get_result(conn)
        .await?;
    let email = crate::mail::decided_email(&month_string(month), status, &state.config.app_origin);
    notify_once(
        conn,
        user_id,
        "time_requirement_decided",
        json!({ "month": month_string(month), "status": status, "tier": tier }),
        Some(email),
    )
    .await?;
    Ok(TimeRequirementView::from_row(&row, now))
}

/// Hourly job: refresh the current month, and decide any past month whose
/// `decides_at` has passed and which has no result yet. Errors per user are
/// logged and never stop the loop; a 42 failure inside `decide_month` becomes
/// `on_hold` for that user instead of a wrong `not_met`.
pub fn spawn_jobs(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        tick.tick().await; // skip the immediate first tick
        loop {
            tick.tick().await;
            if run_due(&state).await.is_err() {
                tracing::warn!("time-requirement job failed");
            }
        }
    });
}

async fn run_due(state: &AppState) -> Result<(), AppError> {
    let now = Utc::now();
    let current = kst::current_month(now);
    let previous = current - Months::new(1);
    let mut conn = state.pool.get().await?;
    let students: Vec<i64> = users::table
        .filter(users::role.eq("student"))
        .select(users::id)
        .load(&mut conn)
        .await?;
    for user_id in students {
        if refresh_month(state, &mut conn, user_id, current)
            .await
            .is_err()
        {
            tracing::warn!(user_id, "time-requirement refresh failed");
            continue;
        }
        let decided = load_row(&mut conn, user_id, previous)
            .await?
            .is_some_and(|r| r.result_status.is_some());
        if !decided
            && now >= eligibility::decides_at(previous)
            && decide_month(state, &mut conn, user_id, previous)
                .await
                .is_err()
        {
            tracing::warn!(user_id, "time-requirement decision failed");
        }
    }
    Ok(())
}
