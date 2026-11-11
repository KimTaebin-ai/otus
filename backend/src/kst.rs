//! api.md: times are ISO 8601 in KST (+09:00), months are `YYYY-MM`.

use chrono::{DateTime, Datelike, FixedOffset, Months, NaiveDate, NaiveTime, SecondsFormat, Utc};
use serde::Serializer;

pub fn offset() -> FixedOffset {
    FixedOffset::east_opt(9 * 3600).expect("valid offset")
}

pub fn serialize<S: Serializer>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(
        &dt.with_timezone(&offset())
            .to_rfc3339_opts(SecondsFormat::Secs, false),
    )
}

pub fn serialize_opt<S: Serializer>(dt: &Option<DateTime<Utc>>, s: S) -> Result<S::Ok, S::Error> {
    match dt {
        Some(dt) => serialize(dt, s),
        None => s.serialize_none(),
    }
}

/// The KST calendar month containing `now`, as its first day.
pub fn current_month(now: DateTime<Utc>) -> NaiveDate {
    let local = now.with_timezone(&offset()).date_naive();
    local.with_day(1).expect("day 1 exists")
}

/// 00:00 KST on `day`.
pub fn start_of(day: NaiveDate) -> DateTime<Utc> {
    day.and_time(NaiveTime::MIN)
        .and_local_timezone(offset())
        .unwrap()
        .with_timezone(&Utc)
}

/// Calendar bounds for `month` (its first day):
/// `[1st 00:00 KST, next month's 1st 00:00 KST)`.
/// Configured submission windows must stay within these bounds.
pub fn month_window(month: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
    (start_of(month), start_of(month + Months::new(1)))
}

/// `YYYY-MM` → the first day of that month.
pub fn parse_month(s: &str) -> Option<NaiveDate> {
    if s.len() != 7
        || !s.bytes().enumerate().all(|(index, byte)| {
            if index == 4 {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
    {
        return None;
    }
    let (y, m) = s.split_once('-')?;
    if y.len() != 4 || m.len() != 2 {
        return None;
    }
    NaiveDate::from_ymd_opt(y.parse().ok()?, m.parse().ok()?, 1)
}

pub fn serialize_month<S: Serializer>(d: &NaiveDate, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&format!("{:04}-{:02}", d.year(), d.month()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months() {
        assert_eq!(parse_month("2026-10"), NaiveDate::from_ymd_opt(2026, 10, 1));
        for bad in ["2026-13", "2026-1", "26-10", "2026/10", "2026-10-01", ""] {
            assert_eq!(parse_month(bad), None, "{bad}");
        }
        for bad in ["2026-+1", "+026-10", "2026- 1", "２０２６-10", "2026-１０"] {
            assert_eq!(parse_month(bad), None, "{bad}");
        }
    }

    #[test]
    fn kst_format() {
        let utc = DateTime::parse_from_rfc3339("2026-10-16T12:10:00.123Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut out = Vec::new();
        serialize(&utc, &mut serde_json::Serializer::new(&mut out)).unwrap();
        assert_eq!(out, br#""2026-10-16T21:10:00+09:00""#);
    }
}
