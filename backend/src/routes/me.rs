use axum::Json;
use axum::extract::State;
use chrono::{NaiveDate, Utc};
use diesel::dsl::exists;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::AppError;
use crate::models::User;
use crate::extract::ApiJson;
use crate::schema::{submissions, time_requirements, users};
use crate::session::CurrentUser;
use crate::{kst, study_time};

#[derive(Serialize)]
pub struct Me {
    id: i64,
    login: String,
    display_name: String,
    role: crate::domain::Role,
    is_demo: bool,
    /// 취업 상태 (U06)
    employed: bool,
    #[serde(serialize_with = "crate::kst::serialize_opt")]
    employment_updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// U01 branching: false → U02 (최초 4종), true → U03 (home).
    /// True once the initial submission left draft, even while awaiting review.
    initial_submitted: bool,
    /// Current KST month's recognised study-time bucket (0/40/80); null if unavailable.
    study_hours: Option<u8>,
    /// 42 cohort (기수), free text ("5", "7기", "8a"); null until entered
    /// (not carried by the 42 payload).
    ordinal: Option<String>,
    /// Korean name; null until entered.
    ko_name: Option<String>,
    /// Date of birth (YYYY-MM-DD); null until entered.
    date_of_birth: Option<chrono::NaiveDate>,
}

impl Me {
    pub async fn load(state: &AppState, user: User) -> Result<Self, AppError> {
        let now = Utc::now();
        let month = kst::current_month(now);
        let mut conn = state.pool.get().await?;
        let initial_submitted = diesel::select(exists(
            submissions::table
                .filter(submissions::user_id.eq(user.id))
                .filter(submissions::kind.eq("initial"))
                .filter(submissions::status.ne("draft")),
        ))
        .get_result(&mut conn)
        .await?;
        let demo_seconds: Option<i64> = if user.is_demo {
            time_requirements::table
                .filter(time_requirements::user_id.eq(user.id))
                .filter(time_requirements::target_month.eq(month))
                .select(time_requirements::recognized_seconds)
                .first(&mut conn)
                .await
                .optional()?
        } else {
            None
        };
        // External API latency must not hold a database connection.
        drop(conn);
        let study_hours = if user.is_demo {
            Some(study_time::hours_bucket(demo_seconds.unwrap_or(0)))
        } else if let Some(ft) = &state.config.forty_two {
            // Cached (5 min TTL, single-flight per user): a class opening
            // home at once must not fan out to 42 per user, and an upstream
            // failure serves the last known bucket instead of flickering
            // to null. Errors only surface here on a cold cache.
            match state
                .locations_cache
                .load_month(&state.http, ft, user.id, &user.login, month, now)
                .await
            {
                Ok(sessions) => Some(study_time::monthly_hours(&sessions, month, now)),
                Err(_) => {
                    tracing::warn!(user_id = user.id, "study-time fetch unavailable");
                    None
                }
            }
        } else {
            None
        };
        Ok(Self {
            id: user.id,
            login: user.login,
            display_name: user.display_name,
            role: user.role,
            is_demo: user.is_demo,
            employed: user.employed,
            employment_updated_at: user.employment_updated_at,
            initial_submitted,
            study_hours,
            ordinal: user.ordinal.clone(),
            ko_name: user.ko_name.clone(),
            date_of_birth: user.date_of_birth,
        })
    }
}

pub async fn me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Me>, AppError> {
    Ok(Json(Me::load(&state, user).await?))
}

/// PATCH /api/me/profile body. Every field is tri-state: omitted leaves the
/// stored value alone, an explicit `null` clears it, and a value replaces
/// it. (`Option<Option<_>>` with `#[serde(default)]` is what keeps "omitted"
/// distinguishable from "explicit null".)
/// `deserialize_with` for the tri-state fields: `#[serde(default)]` covers
/// the omitted case, and this wraps whatever is present so an explicit
/// `null` stays distinguishable (`Some(None)`) instead of collapsing into
/// the outer `None` plain `Option<Option<_>>` deserialization would give.
fn present_string<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(Deserialize)]
pub struct UpdateProfile {
    #[serde(default, deserialize_with = "present_string")]
    ordinal: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_string")]
    ko_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_string")]
    date_of_birth: Option<Option<String>>,
}

/// Profile text rule, mirroring the DB CHECK
/// (`char_length(btrim(x)) BETWEEN 1 AND 50`) so bad input is a 400 here,
/// never a 500 from the constraint: the value is trimmed, must not be blank
/// afterwards, and must fit 50 characters. Free-form cohort spellings
/// ("1", "3a", "4기A") are all fine — no format is imposed.
fn clean_profile_text(field: &str, raw: &str) -> Result<String, AppError> {
    let value = raw.trim();
    if value.is_empty() || value.chars().count() > 50 {
        return Err(AppError::InvalidRequest(format!(
            "{field}은(는) 공백을 제외하고 1~50자여야 합니다."
        )));
    }
    Ok(value.to_owned())
}

/// Oldest accepted birth date. Anything earlier is treated as a typo; the
/// DATE type itself would happily store year 1, which is never a real
/// student's birth date for this service.
pub const MIN_DATE_OF_BIRTH: NaiveDate = match NaiveDate::from_ymd_opt(1900, 1, 1) {
    Some(d) => d,
    None => unreachable!(),
};

/// Strict `YYYY-MM-DD` (same shape discipline as `kst::parse_month`), a real
/// calendar date, not in the future, and not before `MIN_DATE_OF_BIRTH`.
fn parse_date_of_birth(raw: &str, today: NaiveDate) -> Result<NaiveDate, AppError> {
    let invalid = || {
        AppError::InvalidRequest(
            "date_of_birth는 1900-01-01 이후 오늘 이전의 날짜를 YYYY-MM-DD 형식으로 입력해야 합니다."
                .into(),
        )
    };
    let well_formed = raw.len() == 10
        && raw.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    if !well_formed {
        return Err(invalid());
    }
    let date = NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| invalid())?;
    if date < MIN_DATE_OF_BIRTH || date > today {
        return Err(invalid());
    }
    Ok(date)
}

/// Resolve one tri-state field: omitted → keep, null → clear, value → clean.
fn resolve_text(
    field: &str,
    given: Option<Option<String>>,
    current: Option<String>,
) -> Result<Option<String>, AppError> {
    match given {
        None => Ok(current),
        Some(None) => Ok(None),
        Some(Some(raw)) => Ok(Some(clean_profile_text(field, &raw)?)),
    }
}

/// PATCH /api/me/profile — set/clear my own cohort, Korean name, birth date.
/// Mirrors PATCH /api/me/employment: one single-row update of the caller's
/// own record (there is no id in the route, so writing someone else is
/// impossible by construction), then the updated `Me`.
pub async fn set_profile(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<UpdateProfile>,
) -> Result<Json<Me>, AppError> {
    let today = Utc::now().with_timezone(&kst::offset()).date_naive();
    let ordinal = resolve_text("ordinal", body.ordinal, user.ordinal.clone())?;
    let ko_name = resolve_text("ko_name", body.ko_name, user.ko_name.clone())?;
    let date_of_birth = match body.date_of_birth {
        None => user.date_of_birth,
        Some(None) => None,
        Some(Some(raw)) => Some(parse_date_of_birth(&raw, today)?),
    };
    let mut conn = state.pool.get().await?;
    let user: User = diesel::update(users::table.find(user.id))
        .set((
            users::ordinal.eq(ordinal),
            users::ko_name.eq(ko_name),
            users::date_of_birth.eq(date_of_birth),
        ))
        .returning(User::as_returning())
        .get_result(&mut conn)
        .await?;
    drop(conn);
    Ok(Json(Me::load(&state, user).await?))
}

#[cfg(test)]
mod profile_tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 18).unwrap()
    }

    #[test]
    fn free_form_ordinals_pass_and_are_trimmed() {
        for ok in ["1", "3a", "4기A", "5", "7기", "  9기A  "] {
            assert!(clean_profile_text("ordinal", ok).is_ok(), "{ok}");
        }
        assert_eq!(
            clean_profile_text("ordinal", "  9기A  ").ok().unwrap(),
            "9기A"
        );
    }

    #[test]
    fn blank_and_too_long_text_is_rejected() {
        for bad in ["", "   ", " 	 "] {
            assert!(clean_profile_text("ko_name", bad).is_err(), "{bad:?}");
        }
        assert!(clean_profile_text("ko_name", &"가".repeat(50)).is_ok());
        assert!(clean_profile_text("ko_name", &"가".repeat(51)).is_err());
    }

    #[test]
    fn date_of_birth_bounds() {
        // lower boundary itself is in, the day before is out
        assert_eq!(
            parse_date_of_birth("1900-01-01", today()).ok().unwrap(),
            MIN_DATE_OF_BIRTH
        );
        assert!(parse_date_of_birth("1899-12-31", today()).is_err());
        // today is in, the future is out
        assert!(parse_date_of_birth("2026-10-18", today()).is_ok());
        assert!(parse_date_of_birth("2026-10-19", today()).is_err());
    }

    #[test]
    fn date_of_birth_format_and_calendar() {
        for bad in ["2026-2-3", "26-10-18", "20261018", "2026/10/18", "2026-02-30", "x"] {
            assert!(parse_date_of_birth(bad, today()).is_err(), "{bad}");
        }
    }

    #[test]
    fn tri_state_resolution() {
        let cur = Some("5".to_string());
        assert_eq!(resolve_text("ordinal", None, cur.clone()).ok().unwrap(), cur);
        assert_eq!(
            resolve_text("ordinal", Some(None), cur.clone()).ok().unwrap(),
            None
        );
        assert_eq!(
            resolve_text("ordinal", Some(Some("7기".into())), cur).ok().unwrap(),
            Some("7기".to_string())
        );
    }

    #[test]
    fn omitted_and_null_deserialize_differently() {
        let omitted: UpdateProfile = serde_json::from_str("{}").unwrap();
        assert!(omitted.ordinal.is_none());
        let cleared: UpdateProfile = serde_json::from_str(r#"{"ordinal":null}"#).unwrap();
        assert_eq!(cleared.ordinal, Some(None));
        let set: UpdateProfile = serde_json::from_str(r#"{"ordinal":"3a"}"#).unwrap();
        assert_eq!(set.ordinal, Some(Some("3a".to_string())));
    }
}

