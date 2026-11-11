//! Current-month study-time buckets. Sessions come from ref/time.py's three
//! location queries; the shared policy splits at KST midnight and caps each day
//! at 12 hours before applying the monthly 40/80-hour thresholds.

use chrono::{DateTime, NaiveDate, Utc};

use crate::eligibility::{LocationSession, TIER1_SECONDS, TIER2_SECONDS};

pub fn hours_bucket(seconds: i64) -> u8 {
    if seconds >= TIER2_SECONDS {
        80
    } else if seconds >= TIER1_SECONDS {
        40
    } else {
        0
    }
}

pub fn monthly_hours(sessions: &[LocationSession], month: NaiveDate, as_of: DateTime<Utc>) -> u8 {
    hours_bucket(crate::eligibility::recognized_seconds(
        sessions, month, as_of,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value).unwrap().to_utc()
    }

    fn session(start: &str, end: Option<&str>) -> LocationSession {
        LocationSession {
            begin_at: at(start),
            end_at: end.map(at),
        }
    }

    fn october() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()
    }

    #[test]
    fn buckets_use_exact_seconds_without_rounding() {
        for (seconds, expected) in [
            (0, 0),
            (40 * 3600 - 1, 0),
            (40 * 3600, 40),
            (80 * 3600 - 1, 40),
            (80 * 3600, 80),
            (200 * 3600, 80),
        ] {
            assert_eq!(hours_bucket(seconds), expected);
        }
    }

    #[test]
    fn a_long_session_is_capped_per_kst_day() {
        let sessions = [session(
            "2026-10-01T00:00:00+09:00",
            Some("2026-10-02T16:00:00+09:00"),
        )];
        // 40 actual hours across two days => 24 recognised hours.
        assert_eq!(
            monthly_hours(&sessions, october(), at("2026-10-03T00:00:00+09:00")),
            0
        );
    }

    #[test]
    fn counts_carryover_and_active_sessions_only_inside_the_kst_month() {
        let sessions = [
            // October 1: 20 actual hours, capped at 12.
            session(
                "2026-09-28T00:00:00+09:00",
                Some("2026-10-01T20:00:00+09:00"),
            ),
            session("2026-10-02T00:00:00+09:00", None),
            session(
                "2026-09-01T00:00:00+09:00",
                Some("2026-09-20T00:00:00+09:00"),
            ),
            session("2026-11-01T00:00:00+09:00", None),
        ];
        // Oct 1–3 each contribute 12h. Oct 4's active session crosses 40h at 04:00.
        assert_eq!(
            monthly_hours(&sessions, october(), at("2026-10-04T03:59:59+09:00")),
            0
        );
        assert_eq!(
            monthly_hours(&sessions, october(), at("2026-10-04T04:00:00+09:00")),
            40
        );
    }

    #[test]
    fn clamps_at_month_end() {
        let sessions = [
            session(
                "2026-10-30T08:00:00.500+09:00",
                Some("2026-11-05T00:00:00+09:00"),
            ),
            session(
                "2026-10-01T00:00:00+09:00",
                Some("2026-10-01T00:00:00.500+09:00"),
            ),
        ];
        assert_eq!(
            monthly_hours(&sessions, october(), at("2026-11-06T00:00:00+09:00")),
            0
        );
        assert_eq!(
            monthly_hours(&[], october(), at("2026-10-10T00:00:00+09:00")),
            0
        );
    }

    #[test]
    fn multiple_sessions_share_the_daily_cap_and_reach_eighty_hours() {
        let mut sessions = Vec::new();
        for day in 1..=7 {
            sessions.push(session(
                &format!("2026-10-{day:02}T00:00:00+09:00"),
                Some(&format!("2026-10-{day:02}T08:00:00+09:00")),
            ));
            sessions.push(session(
                &format!("2026-10-{day:02}T12:00:00+09:00"),
                Some(&format!("2026-10-{day:02}T20:00:00+09:00")),
            ));
        }
        assert_eq!(
            monthly_hours(&sessions[..6], october(), at("2026-10-10T00:00:00+09:00")),
            0
        );
        assert_eq!(
            monthly_hours(&sessions[..8], october(), at("2026-10-10T00:00:00+09:00")),
            40
        );
        assert_eq!(
            monthly_hours(&sessions, october(), at("2026-10-10T00:00:00+09:00")),
            80
        );
    }
}
