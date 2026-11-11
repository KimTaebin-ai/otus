//! 42 API access for recognised hours (issue #10): client-credentials token and
//! `/v2/users/{login}/locations`. The OAuth login flow in `routes::oauth` is separate
//! (user token, dropped after /v2/me); this uses the app token and never stores it
//! beyond the call.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;

/// 429 backoff cap (issue review fix): a hostile/buggy `Retry-After` must not
/// park a fetch for hours. Restores the pre-25f2298 60s cap.
pub const MAX_RETRY_AFTER_SECS: u64 = 60;
/// Per-query page bound (restores the pre-25f2298 50-page cap). Hitting it is
/// an error: partial location lists must never be aggregated as complete.
pub const MAX_LOCATION_PAGES: u32 = 50;
/// How long `/api/me` may reuse one user's fetched month locations. Study
/// hours only move when the user logs in/out of a campus PC, the official
/// hourly job owns the stored snapshot, and this cache only feeds the 0/40/80
/// home bucket — 5 minutes keeps a whole class opening home from fanning out
/// to 42 per user, while the bucket can lag by at most one short window.
pub const LOCATIONS_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

/// The wait before retrying a 429: `Retry-After` honoured up to the cap,
/// 5s when the header is missing or unparsable. Pure so tests never sleep.
pub fn retry_after_delay(headers: &reqwest::header::HeaderMap) -> std::time::Duration {
    let secs = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(5)
        .min(MAX_RETRY_AFTER_SECS);
    std::time::Duration::from_secs(secs)
}

type FlightLock = Arc<tokio::sync::Mutex<()>>;

struct CachedLocations {
    sessions: Vec<LocationSession>,
    fetched_at: DateTime<Utc>,
}

/// In-process cache of one user's current-month locations, for `/api/me`
/// only (the hourly job/decisions always fetch fresh via
/// `fetch_month_locations`). Keyed by (user id, month).
///
/// Concurrency: a per-key tokio flight lock gives single-flight fetches —
/// concurrent callers for the same user wait for the one in-flight fetch
/// instead of stampeding 42; different users fetch in parallel. That flight
/// lock is held across the fetch on purpose (it *is* the single-flight
/// mechanism); the std mutexes guarding the maps are only held for brief
/// lookups/inserts, never across an await. Failures are never inserted: on
/// error the last known value (even stale) is served, and only a cold cache
/// propagates the error.
pub struct LocationsCache {
    ttl: std::time::Duration,
    entries: Mutex<HashMap<(i64, NaiveDate), CachedLocations>>,
    flights: Mutex<HashMap<(i64, NaiveDate), FlightLock>>,
}

impl Default for LocationsCache {
    fn default() -> Self {
        Self::new()
    }
}

impl LocationsCache {
    pub fn new() -> Self {
        Self::with_ttl(LOCATIONS_CACHE_TTL)
    }

    pub fn with_ttl(ttl: std::time::Duration) -> Self {
        Self {
            ttl,
            entries: Mutex::new(HashMap::new()),
            flights: Mutex::new(HashMap::new()),
        }
    }

    fn fresh(&self, key: (i64, NaiveDate), now: DateTime<Utc>) -> Option<Vec<LocationSession>> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.get(&key).and_then(|c| {
            (now - c.fetched_at < chrono::TimeDelta::from_std(self.ttl).unwrap_or_default())
                .then(|| c.sessions.clone())
        })
    }

    pub async fn get_or_fetch<F, Fut>(
        &self,
        user_id: i64,
        month: NaiveDate,
        now: DateTime<Utc>,
        fetch: F,
    ) -> anyhow::Result<Vec<LocationSession>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<Vec<LocationSession>>>,
    {
        let key = (user_id, month);
        if let Some(sessions) = self.fresh(key, now) {
            return Ok(sessions);
        }
        let flight = {
            let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
            flights
                .entry(key)
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = flight.lock().await;
        // A concurrent caller may have filled the cache while we waited.
        if let Some(sessions) = self.fresh(key, now) {
            return Ok(sessions);
        }
        match fetch().await {
            Ok(sessions) => {
                let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
                entries.insert(
                    key,
                    CachedLocations {
                        sessions: sessions.clone(),
                        fetched_at: now,
                    },
                );
                Ok(sessions)
            }
            Err(error) => {
                // Serve the last known value instead of flickering to
                // "unavailable"; the failure itself is never cached.
                let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
                match entries.get(&key) {
                    Some(cached) => Ok(cached.sessions.clone()),
                    None => Err(error),
                }
            }
        }
    }

    /// `/api/me` path: cached, single-flight, 20s-bounded fresh fetch.
    pub async fn load_month(
        &self,
        http: &reqwest::Client,
        ft: &FortyTwo,
        user_id: i64,
        login: &str,
        month: NaiveDate,
        now: DateTime<Utc>,
    ) -> anyhow::Result<Vec<LocationSession>> {
        let login = login.to_owned();
        self.get_or_fetch(user_id, month, now, || async move {
            tokio::time::timeout(
                std::time::Duration::from_secs(20),
                fetch_month_locations(http, ft, &login, month, now),
            )
            .await
            .map_err(|_| anyhow::anyhow!("42 aggregation timed out"))?
        })
        .await
    }
}

use crate::config::FortyTwo;
use crate::eligibility::LocationSession;

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize, Clone)]
struct LocationJson {
    begin_at: DateTime<Utc>,
    end_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
pub fn parse_locations(body: &str) -> anyhow::Result<Vec<LocationSession>> {
    let rows: Vec<LocationJson> = serde_json::from_str(body)?;
    Ok(rows
        .into_iter()
        .map(|r| LocationSession {
            begin_at: r.begin_at,
            end_at: r.end_at,
        })
        .collect())
}

async fn app_token(http: &reqwest::Client, ft: &FortyTwo) -> anyhow::Result<String> {
    let token: TokenResponse = http
        .post(format!("{}/oauth/token", ft.api_base))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", ft.client_id.as_str()),
            ("client_secret", ft.client_secret.as_str()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(token.access_token)
}

#[derive(Deserialize)]
struct MonthlyLocation {
    id: i64,
    #[serde(flatten)]
    session: LocationJson,
}

/// The three queries used by ref/time.py: sessions started this month, sessions
/// ended this month (including carryover), and active sessions. Dedupe by ID
/// before adding durations. Errors must not turn into a partial/zero total.
pub async fn fetch_month_locations(
    http: &reqwest::Client,
    ft: &FortyTwo,
    login: &str,
    month: NaiveDate,
    as_of: DateTime<Utc>,
) -> anyhow::Result<Vec<LocationSession>> {
    let (start, end) = crate::kst::month_window(month);
    let range = format!("{},{}", start.to_rfc3339(), as_of.min(end).to_rfc3339());
    let mut token = app_token(http, ft).await?;
    let mut refreshed = false;
    let mut all = BTreeMap::new();
    let mut url = reqwest::Url::parse(&ft.api_base)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("invalid 42 API base URL"))?
        .extend(["v2", "users", login, "locations"]);
    for (filter, value) in [
        ("range[begin_at]", range.as_str()),
        ("range[end_at]", range.as_str()),
        ("filter[active]", "true"),
    ] {
        let mut page = 1u32;
        loop {
            let mut retries = 0;
            let rows: Vec<MonthlyLocation> = loop {
                let response = http
                    .get(url.clone())
                    .bearer_auth(&token)
                    .query(&[
                        (filter, value),
                        ("sort", "begin_at"),
                        ("page[size]", "100"),
                        ("page[number]", &page.to_string()),
                    ])
                    .send()
                    .await?;
                if response.status() == reqwest::StatusCode::UNAUTHORIZED && !refreshed {
                    token = app_token(http, ft).await?;
                    refreshed = true;
                    continue;
                }
                if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && retries < 2 {
                    let wait = retry_after_delay(response.headers());
                    retries += 1;
                    tokio::time::sleep(wait).await;
                    continue;
                }
                break response.error_for_status()?.json().await?;
            };
            let full_page = rows.len() == 100;
            for row in rows {
                all.insert(
                    row.id,
                    LocationSession {
                        begin_at: row.session.begin_at,
                        end_at: row.session.end_at,
                    },
                );
            }
            if !full_page {
                break;
            }
            if page >= MAX_LOCATION_PAGES {
                // Never hand a truncated list to the aggregator as if it
                // were the whole month.
                anyhow::bail!("too many location pages (limit {MAX_LOCATION_PAGES})");
            }
            page += 1;
        }
    }
    Ok(all.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Json, Router,
        extract::Query,
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
    };
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct Mock42 {
        config: FortyTwo,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for Mock42 {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn serve(app: Router) -> Mock42 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Mock42 {
            config: FortyTwo {
                client_id: "test-client".into(),
                client_secret: "test-secret".into(),
                redirect_uri: "http://localhost/callback".into(),
                admin_redirect_uri: None,
                campus_id: 69,
                api_base: format!("http://{address}"),
            },
            task,
        }
    }

    fn location(id: i64) -> Value {
        json!({"id": id, "begin_at": "2026-10-10T01:00:00Z", "end_at": "2026-10-10T02:00:00Z"})
    }

    async fn month(mock: &Mock42) -> anyhow::Result<Vec<LocationSession>> {
        fetch_month_locations(
            &reqwest::Client::new(),
            &mock.config,
            "test-user",
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            DateTime::parse_from_rfc3339("2026-10-18T12:00:00+09:00")
                .unwrap()
                .to_utc(),
        )
        .await
    }

    #[tokio::test]
    async fn month_queries_all_pages_carryover_and_active_without_duplicates() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let app = Router::new()
            .route("/oauth/token", post(|| async { Json(json!({"access_token": "test"})) }))
            .route("/v2/users/test-user/locations", get(move |Query(q): Query<HashMap<String, String>>| {
                let seen = seen.clone();
                async move {
                    seen.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(q["page[size]"], "100");
                    assert_eq!(q["sort"], "begin_at");
                    let rows = if let Some(range) = q.get("range[begin_at]") {
                        assert_eq!(range, "2026-09-30T15:00:00+00:00,2026-10-18T03:00:00+00:00");
                        match q["page[number]"].as_str() {
                            "1" => (1..=100).map(location).collect::<Vec<_>>(),
                            "2" => vec![location(101)],
                            _ => panic!("unexpected page"),
                        }
                    } else if q.contains_key("range[end_at]") {
                        vec![location(1), json!({"id": 102, "begin_at": "2026-09-30T10:00:00Z", "end_at": "2026-10-01T01:00:00Z"})]
                    } else {
                        assert_eq!(q["filter[active]"], "true");
                        vec![location(101), json!({"id": 103, "begin_at": "2026-09-30T10:00:00Z", "end_at": null})]
                    };
                    Json(rows)
                }
            }));
        let mock = serve(app).await;
        let sessions = month(&mock).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        assert_eq!(sessions.len(), 103);
        assert!(sessions.last().unwrap().end_at.is_none());
        assert!(
            sessions[101].begin_at
                < crate::kst::start_of(NaiveDate::from_ymd_opt(2026, 10, 1).unwrap())
        );
    }

    #[tokio::test]
    async fn month_refreshes_expired_token_and_retries_rate_limit() {
        let tokens = Arc::new(AtomicUsize::new(0));
        let requests = Arc::new(AtomicUsize::new(0));
        let token_count = tokens.clone();
        let request_count = requests.clone();
        let app = Router::new()
            .route(
                "/oauth/token",
                post(move || {
                    let count = token_count.clone();
                    async move {
                        count.fetch_add(1, Ordering::SeqCst);
                        Json(json!({"access_token": "test"}))
                    }
                }),
            )
            .route(
                "/v2/users/test-user/locations",
                get(move || {
                    let count = request_count.clone();
                    async move {
                        match count.fetch_add(1, Ordering::SeqCst) {
                            0 => StatusCode::UNAUTHORIZED.into_response(),
                            1 => (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "0")])
                                .into_response(),
                            _ => Json(Vec::<Value>::new()).into_response(),
                        }
                    }
                }),
            );
        let mock = serve(app).await;
        assert!(month(&mock).await.unwrap().is_empty());
        assert_eq!(tokens.load(Ordering::SeqCst), 2);
        assert_eq!(requests.load(Ordering::SeqCst), 5);
    }

    #[tokio::test]
    async fn month_does_not_return_partial_totals_after_a_failed_page() {
        let app = Router::new()
            .route(
                "/oauth/token",
                post(|| async { Json(json!({"access_token": "test"})) }),
            )
            .route(
                "/v2/users/test-user/locations",
                get(|Query(q): Query<HashMap<String, String>>| async move {
                    if q["page[number]"] == "1" {
                        Json((1..=100).map(location).collect::<Vec<_>>()).into_response()
                    } else {
                        StatusCode::SERVICE_UNAVAILABLE.into_response()
                    }
                }),
            );
        let mock = serve(app).await;
        assert!(month(&mock).await.is_err());
    }

    #[tokio::test]
    async fn month_rejects_malformed_locations_and_repeated_unauthorized() {
        for status in [StatusCode::OK, StatusCode::UNAUTHORIZED] {
            let app = Router::new()
                .route(
                    "/oauth/token",
                    post(|| async { Json(json!({"access_token": "test"})) }),
                )
                .route(
                    "/v2/users/test-user/locations",
                    get(move || async move {
                        (
                            status,
                            Json(json!([{"id": 1, "begin_at": "invalid", "end_at": null}])),
                        )
                    }),
                );
            let mock = serve(app).await;
            assert!(month(&mock).await.is_err());
        }
    }

    #[test]
    fn retry_after_is_capped_at_sixty_seconds() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::RETRY_AFTER,
            reqwest::header::HeaderValue::from_static("3600"),
        );
        assert_eq!(
            retry_after_delay(&headers),
            std::time::Duration::from_secs(60)
        );
        headers.insert(
            reqwest::header::RETRY_AFTER,
            reqwest::header::HeaderValue::from_static("7"),
        );
        assert_eq!(retry_after_delay(&headers), std::time::Duration::from_secs(7));
        // Missing or unparsable falls back to 5s, never to an unbounded wait.
        assert_eq!(
            retry_after_delay(&reqwest::header::HeaderMap::new()),
            std::time::Duration::from_secs(5)
        );
        let mut bad = reqwest::header::HeaderMap::new();
        bad.insert(
            reqwest::header::RETRY_AFTER,
            reqwest::header::HeaderValue::from_static("soon"),
        );
        assert_eq!(retry_after_delay(&bad), std::time::Duration::from_secs(5));
    }

    #[tokio::test]
    async fn month_errors_at_page_bound_without_returning_partials() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let app = Router::new()
            .route("/oauth/token", post(|| async { Json(json!({"access_token": "test"})) }))
            .route(
                "/v2/users/test-user/locations",
                get(move || {
                    let seen = seen.clone();
                    async move {
                        seen.fetch_add(1, Ordering::SeqCst);
                        Json((1..=100).map(location).collect::<Vec<_>>())
                    }
                }),
            );
        let mock = serve(app).await;
        let error = month(&mock).await.expect_err("bound must fail");
        assert!(error.to_string().contains("too many location pages"), "{error}");
        // Exactly the bound on the first query; nothing partial was returned.
        assert_eq!(calls.load(Ordering::SeqCst), MAX_LOCATION_PAGES as usize);
    }

    fn cache_session() -> LocationSession {
        LocationSession {
            begin_at: DateTime::parse_from_rfc3339("2026-10-10T01:00:00Z")
                .unwrap()
                .to_utc(),
            end_at: None,
        }
    }

    #[tokio::test]
    async fn cache_hit_within_ttl_fetches_once() {
        let cache = LocationsCache::with_ttl(std::time::Duration::from_secs(300));
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-10-18T12:00:00Z")
            .unwrap()
            .to_utc();
        let calls = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let counter = calls.clone();
            let got = cache
                .get_or_fetch(7, month, now, || async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Ok(vec![cache_session()])
                })
                .await
                .unwrap();
            assert_eq!(got.len(), 1);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cache_failure_serves_last_known_and_is_never_cached_as_fresh() {
        let cache = LocationsCache::with_ttl(std::time::Duration::from_secs(60));
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let t0 = DateTime::parse_from_rfc3339("2026-10-18T12:00:00Z")
            .unwrap()
            .to_utc();
        cache
            .get_or_fetch(7, month, t0, || async { Ok(vec![cache_session()]) })
            .await
            .unwrap();
        // After the TTL, a failing fetch serves the stale value...
        let later = t0 + chrono::TimeDelta::minutes(10);
        let got = cache
            .get_or_fetch(7, month, later, || async {
                anyhow::bail!("upstream down")
            })
            .await
            .unwrap();
        assert_eq!(got.len(), 1);
        // ...but the failure was not cached as fresh: the next caller retries.
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        cache
            .get_or_fetch(7, month, later, || async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(Vec::new())
            })
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // A cold cache propagates the error instead of inventing a value.
        let cold = LocationsCache::new();
        assert!(
            cold.get_or_fetch(9, month, t0, || async {
                anyhow::bail!("upstream down")
            })
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn cache_single_flights_concurrent_callers_for_one_user() {
        let cache = Arc::new(LocationsCache::with_ttl(std::time::Duration::from_secs(300)));
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-10-18T12:00:00Z")
            .unwrap()
            .to_utc();
        let calls = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let cache = cache.clone();
            let counter = calls.clone();
            tasks.push(tokio::spawn(async move {
                cache
                    .get_or_fetch(7, month, now, || async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        Ok(vec![cache_session()])
                    })
                    .await
                    .unwrap()
            }));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap().len(), 1);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn parses_locations_with_open_session() {
        let rows = parse_locations(
            r#"[
              {"begin_at":"2026-10-10T01:00:00.000Z","end_at":"2026-10-10T05:00:00.000Z"},
              {"begin_at":"2026-10-11T01:00:00.000Z","end_at":null}
            ]"#,
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows[0].end_at.is_some());
        assert!(rows[1].end_at.is_none());
        assert!(parse_locations("not json").is_err());
        assert!(parse_locations(r#"{"x":1}"#).is_err());
    }
}
