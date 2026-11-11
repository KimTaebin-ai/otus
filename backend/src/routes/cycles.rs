use axum::Json;
use axum::extract::State;
use chrono::{DateTime, NaiveDate, TimeDelta, Utc};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::AppState;
use crate::error::AppError;
use crate::kst;
use crate::models::Cycle;
use crate::schema::cycles;
use crate::session::CurrentUser;

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
enum CycleState {
    /// no submission period configured for the month: everything is locked
    NotSet,
    Upcoming,
    Open,
    Closed,
}

#[derive(Serialize)]
pub struct CycleView {
    #[serde(serialize_with = "kst::serialize_month")]
    target_month: NaiveDate,
    state: CycleState,
    #[serde(serialize_with = "kst::serialize_opt")]
    opens_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "kst::serialize_opt")]
    closes_at: Option<DateTime<Utc>>,
    /// KST calendar days until the last day of the cycle (0 = closes today, negative = closed)
    d_day: Option<i64>,
    /// 발급 기준: documents must be issued on or after this date
    issued_after: NaiveDate,
}

fn view(target_month: NaiveDate, cycle: Option<Cycle>, now: DateTime<Utc>) -> CycleView {
    let (state, d_day) = match &cycle {
        None => (CycleState::NotSet, None),
        Some(c) => {
            let state = if now < c.opens_at {
                CycleState::Upcoming
            } else if now < c.closes_at {
                CycleState::Open
            } else {
                CycleState::Closed
            };
            let today = now.with_timezone(&kst::offset()).date_naive();
            // closes_at is exclusive: the deadline day is the
            // KST date of the last second before it
            let close_day = (c.closes_at - TimeDelta::seconds(1))
                .with_timezone(&kst::offset())
                .date_naive();
            (state, Some((close_day - today).num_days()))
        }
    };
    CycleView {
        target_month,
        state,
        opens_at: cycle.as_ref().map(|c| c.opens_at),
        closes_at: cycle.as_ref().map(|c| c.closes_at),
        d_day,
        issued_after: target_month,
    }
}

/// GET /api/cycles/current — the submission period for the current KST month.
pub async fn current(
    State(state): State<AppState>,
    _user: CurrentUser,
) -> Result<Json<CycleView>, AppError> {
    let now = Utc::now();
    let month = kst::current_month(now);
    let mut conn = state.pool.get().await?;
    let cycle = cycles::table
        .find(month)
        .select(Cycle::as_select())
        .first(&mut conn)
        .await
        .optional()?;
    Ok(Json(view(month, cycle, now)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn states_and_d_day_use_kst_dates() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let cycle = || {
            let (opens_at, closes_at) = kst::month_window(month);
            assert_eq!(opens_at, at("2026-10-01T00:00:00+09:00"));
            assert_eq!(closes_at, at("2026-11-01T00:00:00+09:00"));
            Some(Cycle {
                opens_at,
                closes_at,
            })
        };
        assert_eq!(
            view(month, None, at("2026-10-16T12:00:00Z")).state,
            CycleState::NotSet
        );

        let before = view(month, cycle(), at("2026-09-30T12:00:00+09:00"));
        assert_eq!(
            (before.state, before.d_day),
            (CycleState::Upcoming, Some(31))
        );

        let mid = view(month, cycle(), at("2026-10-16T12:00:00+09:00"));
        assert_eq!((mid.state, mid.d_day), (CycleState::Open, Some(15)));

        // 2026-10-31T15:30Z is already Nov 1 00:30 in KST: closed, D+1
        let after = view(month, cycle(), at("2026-10-31T15:30:00Z"));
        assert_eq!((after.state, after.d_day), (CycleState::Closed, Some(-1)));

        // next month's 1st 00:00 KST is the exclusive close
        let edge = view(month, cycle(), at("2026-11-01T00:00:00+09:00"));
        assert_eq!((edge.state, edge.d_day), (CycleState::Closed, Some(-1)));
        let first = view(month, cycle(), at("2026-10-01T00:00:00+09:00"));
        assert_eq!(first.state, CycleState::Open);

        let last_day = view(month, cycle(), at("2026-10-31T23:59:59.999999+09:00"));
        assert_eq!(
            (last_day.state, last_day.d_day),
            (CycleState::Open, Some(0))
        );
    }

    #[test]
    fn configured_deadline_drives_state_and_d_day() {
        let month = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let cycle = || {
            Some(Cycle {
                opens_at: at("2026-11-21T09:00:00+09:00"),
                closes_at: at("2026-11-28T18:00:00+09:00"),
            })
        };
        assert_eq!(
            view(month, cycle(), at("2026-11-21T08:59:59+09:00")).state,
            CycleState::Upcoming
        );
        let open = view(month, cycle(), at("2026-11-21T09:00:00+09:00"));
        assert_eq!((open.state, open.d_day), (CycleState::Open, Some(7)));
        let closed = view(month, cycle(), at("2026-11-28T18:00:00+09:00"));
        assert_eq!((closed.state, closed.d_day), (CycleState::Closed, Some(0)));
    }
}
