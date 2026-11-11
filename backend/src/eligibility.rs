//! Recognised-hours policy (issue #10), pure so it is unit-tested without the 42 API.
//!
//! 하루 인정 = min(그날 로그인 합계, 12시간), split at KST midnight, whole seconds,
//! no rounding. 월 40h+ → tier_1 (500,000), 80h+ → tier_2 (1,000,000), else 미충족.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Months, NaiveDate, Utc};

use crate::domain::Tier;
use crate::kst;

pub const DAY_CAP_SECONDS: i64 = 12 * 3600;
pub const TIER1_SECONDS: i64 = 40 * 3600;
pub const TIER2_SECONDS: i64 = 80 * 3600;
pub const TIER1_AMOUNT: i64 = 500_000;
pub const TIER2_AMOUNT: i64 = 1_000_000;

pub fn thresholds() -> [(Tier, i64, i64); 2] {
    [
        (Tier::Tier1, TIER1_SECONDS, TIER1_AMOUNT),
        (Tier::Tier2, TIER2_SECONDS, TIER2_AMOUNT),
    ]
}

pub fn tier_for(seconds: i64) -> Option<Tier> {
    if seconds >= TIER2_SECONDS {
        Some(Tier::Tier2)
    } else if seconds >= TIER1_SECONDS {
        Some(Tier::Tier1)
    } else {
        None
    }
}

/// One 42 location session. `end_at: None` means still logged in: counted up to
/// `as_of` (and never past the month end).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocationSession {
    pub begin_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
}

/// Recognised seconds in `month` (its 1st): sessions are clamped to the KST month,
/// split at KST midnights, summed per day, then each day is capped at 12h.
pub fn recognized_seconds(
    sessions: &[LocationSession],
    month: NaiveDate,
    as_of: DateTime<Utc>,
) -> i64 {
    let (month_start, month_end) = kst::month_window(month);
    let mut per_day: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for s in sessions {
        let start = s.begin_at.max(month_start);
        let end = s
            .end_at
            .unwrap_or(as_of)
            .min(month_end)
            .min(as_of.max(s.begin_at));
        let mut cursor = start;
        while cursor < end {
            let local_day = cursor.with_timezone(&kst::offset()).date_naive();
            let next_midnight = kst::start_of(local_day + Duration::days(1));
            let seg_end = end.min(next_midnight);
            *per_day.entry(local_day).or_default() += (seg_end - cursor).num_seconds();
            cursor = seg_end;
        }
    }
    per_day.values().map(|v| (*v).min(DAY_CAP_SECONDS)).sum()
}

/// Next month's 1st, 09:00 KST — when `month` is decided.
pub fn decides_at(month: NaiveDate) -> DateTime<Utc> {
    kst::start_of(month + Months::new(1)) + Duration::hours(9)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    InProgress,
    AwaitingDecision,
    Decided,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::AwaitingDecision => "awaiting_decision",
            Self::Decided => "decided",
        }
    }
}

pub fn phase(month: NaiveDate, now: DateTime<Utc>, has_result: bool) -> Phase {
    if has_result {
        Phase::Decided
    } else if now < kst::start_of(month + Months::new(1)) {
        Phase::InProgress
    } else {
        Phase::AwaitingDecision
    }
}

/// The 1st-09:00 decision. A failed 42 fetch holds the decision (`on_hold`),
/// never guesses `not_met`.
pub fn decide(seconds: i64, fetch_failed: bool) -> (&'static str, Option<Tier>) {
    if fetch_failed {
        ("on_hold", None)
    } else {
        match tier_for(seconds) {
            Some(tier) => ("met", Some(tier)),
            None => ("not_met", None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    fn sess(begin: &str, end: &str) -> LocationSession {
        LocationSession {
            begin_at: at(begin),
            end_at: Some(at(end)),
        }
    }
    fn oct() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()
    }
    fn as_of() -> DateTime<Utc> {
        at("2026-11-05T00:00:00+09:00")
    }

    #[test]
    fn no_records_is_zero() {
        assert_eq!(recognized_seconds(&[], oct(), as_of()), 0);
    }

    #[test]
    fn splits_at_kst_midnight() {
        // 23:00 -> 01:00 KST: 1h on each day, neither day capped
        let s = [sess(
            "2026-10-10T23:00:00+09:00",
            "2026-10-11T01:00:00+09:00",
        )];
        assert_eq!(recognized_seconds(&s, oct(), as_of()), 7200);
        // a 20h session crossing midnight: 1h (23->24) capped fine + 19h next day capped to 12h
        let s = [sess(
            "2026-10-10T23:00:00+09:00",
            "2026-10-11T19:00:00+09:00",
        )];
        assert_eq!(
            recognized_seconds(&s, oct(), as_of()),
            3600 + DAY_CAP_SECONDS
        );
    }

    #[test]
    fn daily_cap_is_twelve_hours() {
        let s = [sess(
            "2026-10-10T00:00:00+09:00",
            "2026-10-10T20:00:00+09:00",
        )];
        assert_eq!(recognized_seconds(&s, oct(), as_of()), DAY_CAP_SECONDS);
        // two sessions the same day also share the cap
        let s = [
            sess("2026-10-10T00:00:00+09:00", "2026-10-10T08:00:00+09:00"),
            sess("2026-10-10T12:00:00+09:00", "2026-10-10T20:00:00+09:00"),
        ];
        assert_eq!(recognized_seconds(&s, oct(), as_of()), DAY_CAP_SECONDS);
    }

    #[test]
    fn clamps_to_month_and_open_session_to_as_of() {
        // starts in September, ends in October: only the October part counts
        let s = [sess(
            "2026-09-30T20:00:00+09:00",
            "2026-10-01T04:00:00+09:00",
        )];
        assert_eq!(recognized_seconds(&s, oct(), as_of()), 4 * 3600);
        // still logged in: counted to as_of, not beyond
        let open = [LocationSession {
            begin_at: at("2026-10-10T10:00:00+09:00"),
            end_at: None,
        }];
        assert_eq!(
            recognized_seconds(&open, oct(), at("2026-10-10T13:30:00+09:00")),
            3 * 3600 + 1800
        );
    }

    #[test]
    fn seconds_are_not_rounded() {
        let s = [sess(
            "2026-10-10T10:00:00+09:00",
            "2026-10-10T10:01:30+09:00",
        )];
        assert_eq!(recognized_seconds(&s, oct(), as_of()), 90);
    }

    #[test]
    fn tier_boundaries_are_exact() {
        assert_eq!(tier_for(TIER1_SECONDS - 1), None);
        assert_eq!(tier_for(TIER1_SECONDS), Some(Tier::Tier1));
        assert_eq!(tier_for(TIER2_SECONDS - 1), Some(Tier::Tier1));
        assert_eq!(tier_for(TIER2_SECONDS), Some(Tier::Tier2));
        assert_eq!(decide(TIER1_SECONDS - 1, false), ("not_met", None));
        assert_eq!(decide(TIER2_SECONDS, false), ("met", Some(Tier::Tier2)));
        assert_eq!(decide(TIER2_SECONDS, true), ("on_hold", None));
    }

    #[test]
    fn decides_at_is_next_month_first_0900_kst() {
        assert_eq!(decides_at(oct()), at("2026-11-01T09:00:00+09:00"));
        let dec = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();
        assert_eq!(decides_at(dec), at("2027-01-01T09:00:00+09:00"));
    }

    #[test]
    fn phases() {
        assert_eq!(
            phase(oct(), at("2026-10-15T00:00:00+09:00"), false),
            Phase::InProgress
        );
        assert_eq!(
            phase(oct(), at("2026-11-01T08:59:59+09:00"), false),
            Phase::AwaitingDecision
        );
        assert_eq!(
            phase(oct(), at("2026-11-01T09:00:00+09:00"), true),
            Phase::Decided
        );
    }
}
