use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};

use crate::error::AppError;
use crate::kst;
use crate::models::Cycle;
use crate::schema::cycles;

/// `CYCLE_CLOSED` unless `target_month` is the current KST month and now is within its
/// configured window (`opens_at` inclusive, `closes_at` exclusive).
/// A month without a cycle is closed.
pub async fn ensure_open(
    conn: &mut AsyncPgConnection,
    target_month: NaiveDate,
) -> Result<Cycle, AppError> {
    let now = Utc::now();
    if kst::current_month(now) != target_month {
        return Err(AppError::CycleClosed);
    }
    let window: Option<(DateTime<Utc>, DateTime<Utc>)> = cycles::table
        .filter(cycles::target_month.eq(target_month))
        .select((cycles::opens_at, cycles::closes_at))
        // In a write transaction, keep period edits from racing the actual commit.
        .for_share()
        .first(conn)
        .await
        .optional()?;
    window
        // A concurrent settings update may have held the row past the deadline.
        .filter(|(o, c)| is_open(target_month, *o, *c, Utc::now()))
        .map(|(opens_at, closes_at)| Cycle {
            opens_at,
            closes_at,
        })
        .ok_or(AppError::CycleClosed)
}

/// The same rule as `ensure_open`, for a cycle row already in hand.
pub fn is_open(
    target_month: NaiveDate,
    opens_at: DateTime<Utc>,
    closes_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> bool {
    kst::current_month(now) == target_month && opens_at <= now && now < closes_at
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeDelta;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn boundary_instants() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let (opens, closes) = kst::month_window(month);
        let open = |now| is_open(month, opens, closes, now);
        let us = TimeDelta::microseconds(1);

        // the month's own 1st 00:00 KST is open, one microsecond before is closed
        assert!(open(at("2026-10-01T00:00:00+09:00")));
        assert!(!open(at("2026-10-01T00:00:00+09:00") - us));
        // the last microsecond of the month is open, next month's 1st 00:00 KST is closed
        assert!(open(at("2026-11-01T00:00:00+09:00") - us));
        assert!(!open(at("2026-11-01T00:00:00+09:00")));
        // 23:59:59.5 on the last day (lost by the old inclusive 23:59:59 close)
        assert!(open(at("2026-10-31T23:59:59.5+09:00")));
    }

    #[test]
    fn custom_window_has_inclusive_open_and_exclusive_close() {
        let month = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let opens = at("2026-11-21T09:00:00+09:00");
        let closes = at("2026-11-28T18:00:00+09:00");
        assert!(!is_open(
            month,
            opens,
            closes,
            opens - TimeDelta::seconds(1)
        ));
        assert!(is_open(month, opens, closes, opens));
        assert!(is_open(
            month,
            opens,
            closes,
            closes - TimeDelta::nanoseconds(1)
        ));
        assert!(!is_open(month, opens, closes, closes));
    }

    #[test]
    fn other_months_are_closed_even_inside_the_window() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let wide = (
            at("2026-01-01T00:00:00+09:00"),
            at("2027-01-01T00:00:00+09:00"),
        );
        assert!(!is_open(
            month,
            wide.0,
            wide.1,
            at("2026-11-15T12:00:00+09:00")
        ));
        assert!(is_open(
            month,
            wide.0,
            wide.1,
            at("2026-10-15T12:00:00+09:00")
        ));
    }

    #[test]
    fn december_and_leap_february_boundaries() {
        let us = TimeDelta::microseconds(1);
        let dec = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();
        let (o, c) = kst::month_window(dec);
        assert!(is_open(dec, o, c, at("2027-01-01T00:00:00+09:00") - us));
        assert!(!is_open(dec, o, c, at("2027-01-01T00:00:00+09:00")));

        let feb = NaiveDate::from_ymd_opt(2028, 2, 1).unwrap();
        let (o, c) = kst::month_window(feb);
        assert!(is_open(feb, o, c, at("2028-02-29T23:59:59+09:00")));
        assert!(!is_open(feb, o, c, at("2028-03-01T00:00:00+09:00")));
    }
}
