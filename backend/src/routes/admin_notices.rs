//! Explicit audience notifications: transactional in-app notification + email outbox.

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::sql_types::{Array, BigInt, Bool, Date, Integer, Nullable, Text, Timestamptz};
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::AppState;
use crate::domain::{NoticeAudience, NoticeChannel};
use crate::error::AppError;
use crate::extract::ApiJson;
use crate::kst;
use crate::session::{CurrentUser, require_staff};

fn default_channel() -> NoticeChannel {
    NoticeChannel::Both
}

fn default_audience() -> NoticeAudience {
    NoticeAudience::Unsubmitted
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewQuery {
    month: Option<String>,
    #[serde(default = "default_audience")]
    audience: NoticeAudience,
    audiences: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SendRequest {
    month: String,
    #[serde(
        default = "default_audience",
        skip_serializing_if = "NoticeAudience::is_unsubmitted"
    )]
    audience: NoticeAudience,
    #[serde(
        default = "default_channel",
        skip_serializing_if = "NoticeChannel::is_both"
    )]
    channel: NoticeChannel,
    expected_count: i64,
    target_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    audiences: Option<Vec<NoticeAudience>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type = BigInt)]
    id: i64,
}

#[derive(QueryableByName)]
struct Candidate {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    display_name: String,
    #[diesel(sql_type = Nullable<Text>)]
    ordinal: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    ko_name: Option<String>,
    #[diesel(sql_type = Nullable<Date>)]
    date_of_birth: Option<NaiveDate>,
    #[diesel(sql_type = Text)]
    login: String,
    #[diesel(sql_type = Bool)]
    employed: bool,
    #[diesel(sql_type = Bool)]
    initial_submitted: bool,
    #[diesel(sql_type = Bool)]
    draft: bool,
    #[diesel(sql_type = Bool)]
    submitted: bool,
    #[diesel(sql_type = Nullable<BigInt>)]
    recognized_seconds: Option<i64>,
    #[diesel(sql_type = Nullable<Timestamptz>)]
    as_of: Option<DateTime<Utc>>,
}

#[derive(QueryableByName)]
struct Notice {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Date)]
    target_month: NaiveDate,
    #[diesel(sql_type = Text)]
    audience: NoticeAudience,
    #[diesel(sql_type = Text)]
    channel: NoticeChannel,
    #[diesel(sql_type = BigInt)]
    employed_excluded: i64,
    #[diesel(sql_type = Timestamptz)]
    created_at: DateTime<Utc>,
    #[diesel(sql_type = Array<Text>)]
    audiences: Vec<NoticeAudience>,
    #[diesel(sql_type = Nullable<Text>)]
    title: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    body: Option<String>,
}

#[derive(QueryableByName)]
struct Operation {
    #[diesel(sql_type = BigInt)]
    actor_user_id: i64,
    #[diesel(sql_type = Text)]
    operation: String,
    #[diesel(sql_type = Text)]
    request_hash: String,
    #[diesel(sql_type = Text)]
    response_json: String,
}

#[derive(QueryableByName, Serialize)]
struct Recipient {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    user_id: i64,
    #[diesel(sql_type = Nullable<Text>)]
    email_recipient: Option<String>,
    #[diesel(sql_type = Text)]
    email_status: String,
    #[diesel(sql_type = Integer)]
    email_attempts: i32,
    #[diesel(sql_type = Nullable<Timestamptz>)]
    #[serde(serialize_with = "kst::serialize_opt")]
    email_sent_at: Option<DateTime<Utc>>,
    #[diesel(sql_type = Nullable<Text>)]
    last_error_code: Option<String>,
}

#[derive(Default, Serialize)]
struct EmailCounts {
    pending: usize,
    sending: usize,
    sent: usize,
    failed: usize,
    skipped: usize,
}

fn email_counts(recipients: &[Recipient]) -> EmailCounts {
    let mut counts = EmailCounts::default();
    for recipient in recipients {
        match recipient.email_status.as_str() {
            "pending" => counts.pending += 1,
            "sending" => counts.sending += 1,
            "sent" => counts.sent += 1,
            "failed" => counts.failed += 1,
            "skipped" => counts.skipped += 1,
            _ => {}
        }
    }
    counts
}

fn time_string(time: DateTime<Utc>) -> String {
    time.with_timezone(&kst::offset())
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

fn digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn target_fingerprint(
    month: NaiveDate,
    audience: NoticeAudience,
    candidates: &[Candidate],
    closes_at: Option<DateTime<Utc>>,
    recipient_domain: Option<&str>,
) -> String {
    let mut targets: Vec<_> = candidates
        .iter()
        .filter(|target| !target.employed)
        .map(|target| (target.id, target.login.as_str()))
        .collect();
    targets.sort_unstable();
    digest(
        &serde_json::to_vec(&(
            "notice-audience-v1",
            month,
            audience,
            targets,
            closes_at,
            recipient_domain,
        ))
        .expect("serializable target IDs"),
    )
}

fn idempotency_key(headers: &HeaderMap) -> Result<Uuid, AppError> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| AppError::InvalidRequest("Idempotency-Key 헤더(UUID)가 필요합니다.".into()))
}

fn parse_month(month: &str) -> Result<NaiveDate, AppError> {
    kst::parse_month(month)
        .ok_or_else(|| AppError::InvalidRequest("month는 YYYY-MM 형식이어야 합니다.".into()))
}

async fn lock_key(conn: &mut AsyncPgConnection, key: Uuid) -> Result<(), AppError> {
    let hash = Sha256::digest(format!("admin-notice:{key}").as_bytes());
    let lock = i64::from_be_bytes(hash[..8].try_into().expect("eight-byte hash prefix"));
    diesel::sql_query("SELECT pg_advisory_xact_lock($1)")
        .bind::<BigInt, _>(lock)
        .execute(conn)
        .await?;
    Ok(())
}

async fn replay(
    conn: &mut AsyncPgConnection,
    key: Uuid,
    actor_id: i64,
    operation: &str,
    hash: &str,
) -> Result<Option<Value>, AppError> {
    let previous = diesel::sql_query(
        "SELECT actor_user_id, operation, request_hash, response_json FROM admin_notice_operations WHERE idempotency_key = $1",
    )
    .bind::<diesel::sql_types::Uuid, _>(key)
    .get_result::<Operation>(conn)
    .await
    .optional()?;
    match previous {
        None => Ok(None),
        Some(previous)
            if previous.actor_user_id == actor_id
                && previous.operation == operation
                && previous.request_hash == hash =>
        {
            Ok(Some(serde_json::from_str(&previous.response_json)?))
        }
        Some(_) => Err(AppError::InvalidState(
            "이미 다른 요청에 쓴 Idempotency-Key입니다.".into(),
        )),
    }
}

async fn remember(
    conn: &mut AsyncPgConnection,
    key: Uuid,
    actor: i64,
    operation: &str,
    hash: &str,
    notice: i64,
    response: &Value,
) -> Result<(), AppError> {
    diesel::sql_query("INSERT INTO admin_notice_operations (idempotency_key, actor_user_id, operation, request_hash, notice_id, response_json) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind::<diesel::sql_types::Uuid, _>(key)
        .bind::<BigInt, _>(actor)
        .bind::<Text, _>(operation)
        .bind::<Text, _>(hash)
        .bind::<BigInt, _>(notice)
        .bind::<Text, _>(response.to_string())
        .execute(conn).await?;
    Ok(())
}

async fn audit(
    conn: &mut AsyncPgConnection,
    notice: i64,
    recipient: Option<i64>,
    actor: Option<i64>,
    event: &str,
    detail: Value,
) -> Result<(), AppError> {
    diesel::sql_query("INSERT INTO admin_notice_events (notice_id,recipient_id,actor_user_id,event,detail) VALUES ($1,$2,$3,$4,$5)")
        .bind::<BigInt, _>(notice)
        .bind::<Nullable<BigInt>, _>(recipient)
        .bind::<Nullable<BigInt>, _>(actor)
        .bind::<Text, _>(event)
        .bind::<Text, _>(detail.to_string())
        .execute(conn).await?;
    Ok(())
}

async fn candidates(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
) -> Result<Vec<Candidate>, AppError> {
    Ok(diesel::sql_query(
        "SELECT u.id,u.display_name,u.ordinal,u.ko_name,u.date_of_birth,u.login,u.employed, \
         EXISTS(SELECT 1 FROM submissions i WHERE i.user_id=u.id AND i.kind='initial' AND i.status<>'draft') AS initial_submitted, \
         EXISTS(SELECT 1 FROM submissions d WHERE d.user_id=u.id AND d.target_month=$1 AND d.status='draft') AS draft, \
         EXISTS(SELECT 1 FROM submissions s WHERE s.user_id=u.id AND s.target_month=$1 AND s.status<>'draft') AS submitted, \
         CASE WHEN t.result_status='on_hold' THEN NULL ELSE t.recognized_seconds END AS recognized_seconds,t.as_of \
         FROM users u LEFT JOIN time_requirements t ON t.user_id=u.id AND t.target_month=$1 WHERE u.role='student' \
         ORDER BY u.id",
    ).bind::<Date, _>(month).load(conn).await?)
}

fn matches_audience(target: &Candidate, audience: NoticeAudience) -> bool {
    if audience == NoticeAudience::All {
        return true;
    }
    if audience == NoticeAudience::Employed {
        return target.employed;
    }
    if !target.initial_submitted {
        return false;
    }
    if audience == NoticeAudience::Eligible {
        return target
            .recognized_seconds
            .is_some_and(|seconds| seconds >= 144_000);
    }
    match audience.study_hours() {
        None => !target.submitted,
        Some(hours) => target
            .recognized_seconds
            .is_some_and(|seconds| crate::study_time::hours_bucket(seconds) == hours),
    }
}

fn validate_legacy(audience: NoticeAudience) -> Result<(), AppError> {
    if matches!(
        audience,
        NoticeAudience::All | NoticeAudience::Eligible | NoticeAudience::Employed
    ) {
        return Err(AppError::InvalidRequest(
            "제목·내용과 audiences를 함께 입력해주세요.".into(),
        ));
    }
    Ok(())
}

fn normalize_groups(mut groups: Vec<NoticeAudience>) -> Result<Vec<NoticeAudience>, AppError> {
    if groups.is_empty() || groups.len() > 7 {
        return Err(AppError::InvalidRequest(
            "발송 대상을 1개 이상 선택해주세요.".into(),
        ));
    }
    groups.sort_unstable_by_key(|group| group.as_str());
    groups.dedup();
    Ok(groups)
}

fn validate_composition(body: &SendRequest) -> Result<Vec<NoticeAudience>, AppError> {
    match (&body.audiences, &body.title, &body.body) {
        (None, None, None) => {
            validate_legacy(body.audience)?;
            Ok(Vec::new())
        }
        (Some(groups), Some(title), Some(content)) => {
            if title.trim().is_empty()
                || title.chars().count() > 120
                || title.chars().any(char::is_control)
                || content.trim().is_empty()
                || content.chars().count() > 5000
                || content
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
            {
                return Err(AppError::InvalidRequest("제목은 1~120자, 내용은 1~5000자로 입력해주세요. 제목에는 줄바꿈을 넣을 수 없습니다.".into()));
            }
            normalize_groups(groups.clone())
        }
        _ => Err(AppError::InvalidRequest(
            "제목·내용과 발송 대상을 함께 입력해주세요.".into(),
        )),
    }
}

fn matches_selection(
    target: &Candidate,
    legacy: NoticeAudience,
    groups: &[NoticeAudience],
) -> bool {
    if groups.is_empty() {
        matches_audience(target, legacy)
    } else {
        groups.iter().any(|group| matches_audience(target, *group))
    }
}

fn included(target: &Candidate, groups: &[NoticeAudience]) -> bool {
    !target.employed
        || groups.contains(&NoticeAudience::All)
        || groups.contains(&NoticeAudience::Employed)
}

fn selection_fingerprint(
    month: NaiveDate,
    legacy: NoticeAudience,
    groups: &[NoticeAudience],
    candidates: &[Candidate],
    closes_at: Option<DateTime<Utc>>,
    domain: Option<&str>,
) -> String {
    if groups.is_empty() {
        return target_fingerprint(month, legacy, candidates, closes_at, domain);
    }
    let mut targets: Vec<_> = candidates
        .iter()
        .filter(|t| included(t, groups))
        .map(|t| (t.id, t.login.as_str()))
        .collect();
    targets.sort_unstable();
    digest(
        &serde_json::to_vec(&("notice-composer-v1", month, groups, targets, domain))
            .expect("serializable targets"),
    )
}

async fn selection_deadline(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    legacy: NoticeAudience,
    groups: &[NoticeAudience],
) -> Result<Option<DateTime<Utc>>, AppError> {
    if groups.is_empty() {
        return deadline(conn, month, legacy).await;
    }
    // A composed notice may discuss past submissions even after the period closes.
    if month > kst::current_month(Utc::now()) {
        return Err(AppError::InvalidRequest(
            "미래 월의 발송 대상은 조회할 수 없습니다.".into(),
        ));
    }
    Ok(None)
}

async fn lock_selection(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    legacy: NoticeAudience,
    groups: &[NoticeAudience],
) -> Result<(), AppError> {
    lock_hours(
        conn,
        month,
        if groups.is_empty() {
            legacy
        } else {
            NoticeAudience::All
        },
    )
    .await
}

async fn deadline(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    audience: NoticeAudience,
) -> Result<Option<DateTime<Utc>>, AppError> {
    if audience == NoticeAudience::Unsubmitted {
        return Ok(Some(
            crate::cycle::ensure_open(conn, month).await?.closes_at,
        ));
    }
    if month > kst::current_month(Utc::now()) {
        return Err(AppError::InvalidRequest(
            "미래 월에는 시간 요건 알림을 보낼 수 없습니다.".into(),
        ));
    }
    Ok(None)
}

async fn lock_hours(
    conn: &mut AsyncPgConnection,
    month: NaiveDate,
    audience: NoticeAudience,
) -> Result<(), AppError> {
    if audience != NoticeAudience::Unsubmitted {
        // Hold the existing snapshots through send/retry; hourly refresh cannot
        // change an approved audience while its notification is being committed.
        let _: Vec<IdRow> = diesel::sql_query(
            "SELECT id FROM time_requirements WHERE target_month=$1 ORDER BY id FOR SHARE",
        )
        .bind::<Date, _>(month)
        .load(conn)
        .await?;
    }
    Ok(())
}

/// Snapshots older than this are flagged on hours-based sends. The hourly
/// job refreshes current-month rows every hour, so >2h means at least one
/// refresh cycle was missed (or the row predates the job) — worth a staff
/// warning, not a hard refusal: the notice may be urgent, the preview has
/// always exposed each target's `as_of`, and refusing would let a stuck
/// refresh block all hours-based communication. `on_hold` rows carry no
/// seconds at all and are never counted here (never treated as 0h).
pub const SNAPSHOT_STALE_AFTER: chrono::TimeDelta = chrono::TimeDelta::hours(2);

fn uses_hours_audiences(legacy: NoticeAudience, groups: &[NoticeAudience]) -> bool {
    legacy.study_hours().is_some()
        || legacy == NoticeAudience::Eligible
        || groups.iter().any(|g| {
            g.study_hours().is_some() || *g == NoticeAudience::Eligible
        })
}

/// (count of stale snapshots, oldest as_of) among the final targets of a
/// hours-based selection. Non-hours selections always report (0, None).
fn stale_hours_snapshots<'a>(
    targets: impl Iterator<Item = &'a Candidate>,
    legacy: NoticeAudience,
    groups: &[NoticeAudience],
    now: DateTime<Utc>,
) -> (usize, Option<DateTime<Utc>>) {
    if !uses_hours_audiences(legacy, groups) {
        return (0, None);
    }
    let mut count = 0;
    let mut oldest: Option<DateTime<Utc>> = None;
    for target in targets {
        if target.recognized_seconds.is_none() {
            continue; // on_hold / unknown: excluded from hours audiences already
        }
        let stale = target
            .as_of
            .is_none_or(|as_of| now - as_of > SNAPSHOT_STALE_AFTER);
        if stale {
            count += 1;
            if target.as_of.is_some_and(|a| oldest.is_none_or(|o| a < o)) {
                oldest = target.as_of;
            }
        }
    }
    (count, oldest)
}

async fn lock_students(conn: &mut AsyncPgConnection) -> Result<(), AppError> {
    // Finalize takes the same owner row before the submission row. Employment
    // updates already lock users, so eligibility remains stable through commit.
    let _: Vec<IdRow> =
        diesel::sql_query("SELECT id FROM users WHERE role='student' ORDER BY id FOR UPDATE")
            .load(conn)
            .await?;
    Ok(())
}

async fn recipients(conn: &mut AsyncPgConnection, notice: i64) -> Result<Vec<Recipient>, AppError> {
    Ok(diesel::sql_query("SELECT id,user_id,email_recipient,email_status,email_attempts,email_sent_at,last_error_code FROM admin_notice_recipients WHERE notice_id=$1 ORDER BY user_id")
        .bind::<BigInt, _>(notice).load(conn).await?)
}

fn result(notice: &Notice, service_sent: usize, recipients: &[Recipient]) -> Value {
    let service_sent = if notice.channel.service() {
        service_sent
    } else {
        0
    };
    json!({
        "notice_id": notice.id,
        "month": notice.target_month.format("%Y-%m").to_string(),
        "audience": notice.audience,
        "channel": notice.channel,
        "audiences": notice.audiences,
        "title": notice.title,
        "body": notice.body,
        "sent": service_sent,
        "failed": 0,
        "service": {"sent": service_sent, "failed": 0},
        "email": email_counts(recipients),
        "employed_excluded": notice.employed_excluded,
        "sent_at": time_string(notice.created_at)
    })
}

pub async fn preview(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<PreviewQuery>, QueryRejection>,
) -> Result<Json<Value>, AppError> {
    require_staff(&user)?;
    let Query(query) = query
        .map_err(|_| AppError::InvalidRequest("안내 미리보기 조회 조건을 확인해주세요.".into()))?;
    let month = query
        .month
        .as_deref()
        .map(parse_month)
        .transpose()?
        .unwrap_or_else(|| kst::current_month(Utc::now()));
    let groups = match query.audiences.as_deref() {
        Some(value) => normalize_groups(
            value
                .split(',')
                .map(str::parse)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| AppError::InvalidRequest("발송 대상 조건을 확인해주세요.".into()))?,
        )?,
        None => {
            validate_legacy(query.audience)?;
            Vec::new()
        }
    };
    let mut conn = state.pool.get().await?;
    let closes_at = selection_deadline(&mut conn, month, query.audience, &groups).await?;
    let all = candidates(&mut conn, month).await?;
    let unknown = all
        .iter()
        .filter(|target| {
            target.initial_submitted && !target.employed && target.recognized_seconds.is_none()
        })
        .count();
    let unsubmitted = all
        .iter()
        .filter(|target| target.initial_submitted && !target.submitted)
        .count();
    let candidates: Vec<_> = all
        .into_iter()
        .filter(|target| matches_selection(target, query.audience, &groups))
        .collect();
    let excluded: Vec<_> = candidates
        .iter()
        .filter(|target| !included(target, &groups))
        .collect();
    let targets: Vec<_> = candidates.iter().filter(|target| included(target, &groups)).map(|target| json!({
        "user_id": target.id,
        "name": crate::admin_data::student_label(target.ordinal.as_deref(), target.ko_name.as_deref(), &target.display_name, target.date_of_birth),
        "login": target.login,
        "employed": target.employed,
        "status": if target.submitted { "submitted" } else if target.draft { "draft" } else { "missing" },
        "study_hours": target.recognized_seconds.map(crate::study_time::hours_bucket),
        "as_of": target.as_of.map(time_string),
        "email": state.mailer.as_ref().and_then(|mailer| mailer.recipient(&target.login).ok()),
    })).collect();
    let (stale_count, stale_oldest) = stale_hours_snapshots(
        candidates.iter().filter(|target| included(target, &groups)),
        query.audience,
        &groups,
        Utc::now(),
    );
    Ok(Json(json!({
        "month": month.format("%Y-%m").to_string(),
        "months": [month.format("%Y-%m").to_string()],
        "audience": query.audience,
        "audiences": groups,
        "hours_snapshot_stale_count": stale_count,
        "hours_snapshot_stale": stale_count > 0,
        "hours_snapshot_oldest_as_of": stale_oldest.map(time_string),
        "closes_at": closes_at.map(time_string),
        "unsubmitted": unsubmitted,
        "matched": candidates.len(),
        "hours_unknown": unknown,
        "employed_excluded": excluded.len(),
        "employed_names": excluded.iter().map(|target| target.display_name.as_str()).collect::<Vec<_>>(),
        "targets": targets,
        "target_fingerprint": selection_fingerprint(month, query.audience, &groups, &candidates, closes_at, state.mailer.as_ref().map(|mailer| mailer.recipient_domain())),
        "email_available": state.mailer.is_some(),
    })))
}

pub async fn send(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    ApiJson(body): ApiJson<SendRequest>,
) -> Result<Json<Value>, AppError> {
    require_staff(&user)?;
    let key = idempotency_key(&headers)?;
    let month = parse_month(&body.month)?;
    if body.expected_count < 0 || body.target_fingerprint.len() != 64 {
        return Err(AppError::InvalidRequest(
            "미리보기의 대상 수와 target_fingerprint가 필요합니다.".into(),
        ));
    }
    let groups = validate_composition(&body)?;
    let hash = digest(&serde_json::to_vec(&body)?);
    let mut conn = state.pool.get().await?;
    let response = conn.transaction::<_, AppError, _>(async move |conn| {
        lock_key(conn, key).await?;
        if let Some(response) = replay(conn, key, user.id, "send", &hash).await? {
            return Ok(response);
        }
        lock_students(conn).await?;
        let closes_at = selection_deadline(conn, month, body.audience, &groups).await?;
        lock_selection(conn, month, body.audience, &groups).await?;
        let current: Vec<_> = candidates(conn, month).await?.into_iter().filter(|target| matches_selection(target, body.audience, &groups)).collect();
        let targets: Vec<_> = current.iter().filter(|target| included(target, &groups)).collect();
        if targets.is_empty() {
            return Err(AppError::InvalidState("발송 대상이 없습니다.".into()));
        }
        if targets.len() as i64 != body.expected_count || selection_fingerprint(month, body.audience, &groups, &current, closes_at, state.mailer.as_ref().map(|mailer| mailer.recipient_domain())) != body.target_fingerprint {
            return Err(AppError::InvalidState("대상이 바뀌었습니다. 미리보기를 다시 확인해주세요.".into()));
        }
        let excluded = (current.len() - targets.len()) as i64;
        let notice = diesel::sql_query("INSERT INTO admin_notices(target_month,actor_user_id,actor_role,employed_excluded,audience,channel,audiences,title,body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,target_month,audience,channel,employed_excluded,created_at,audiences,title,body")
            .bind::<Date, _>(month).bind::<BigInt, _>(user.id)
            .bind::<Text, _>(user.role.as_str()).bind::<BigInt, _>(excluded).bind::<Text, _>(body.audience).bind::<Text, _>(body.channel)
            .bind::<Array<Text>, _>(&groups).bind::<Nullable<Text>, _>(&body.title).bind::<Nullable<Text>, _>(&body.body)
            .get_result::<Notice>(conn).await?;
        for target in &targets {
            let (kind, data) = if let (Some(title), Some(content)) = (&body.title, &body.body) {
                ("admin_notice", json!({"month": body.month, "title": title, "body": content}))
            } else if let Some(hours) = body.audience.study_hours() {
                ("study_hours_notice", json!({"month": month.format("%Y-%m").to_string(), "study_hours": hours}))
            } else {
                ("submission_reminder", json!({"month": month.format("%Y-%m").to_string()}))
            };
            let notification_id = if body.channel.service() {
                Some(diesel::sql_query("INSERT INTO notifications(user_id,kind,data) VALUES ($1,$2,$3) RETURNING id")
                    .bind::<BigInt, _>(target.id).bind::<Text, _>(kind)
                    .bind::<Text, _>(data.to_string())
                    .get_result::<IdRow>(conn).await?.id)
            } else { None };
            let (email, status, error) = if body.channel.email() {
                let address = state.mailer.as_ref().ok_or("smtp_not_configured")
                    .and_then(|mailer| mailer.recipient(&target.login));
                match address {
                    Ok(address) => (Some(address), "pending", None),
                    Err(error) => (None, "failed", Some(error)),
                }
            } else { (None, "not_requested", None) };
            let recipient = diesel::sql_query("INSERT INTO admin_notice_recipients(notice_id,user_id,notification_id,email_recipient,email_status,last_error_code,message_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id")
                .bind::<BigInt, _>(notice.id).bind::<BigInt, _>(target.id)
                .bind::<Nullable<BigInt>, _>(notification_id).bind::<Nullable<Text>, _>(email)
                .bind::<Text, _>(status).bind::<Nullable<Text>, _>(error)
                .bind::<diesel::sql_types::Uuid, _>(Uuid::new_v4())
                .get_result::<IdRow>(conn).await?;
            audit(conn, notice.id, Some(recipient.id), Some(user.id), if body.channel.service() { "service_sent" } else { "email_requested" }, json!({"channel":body.channel,"email_status":status,"error_code":error})).await?;
        }
        let recipients = recipients(conn, notice.id).await?;
        let (stale_count, _) = stale_hours_snapshots(targets.iter().copied(), body.audience, &groups, Utc::now());
        if stale_count > 0 {
            tracing::warn!(notice_id = notice.id, stale_count, "hours notice sent from stale time_requirements snapshots");
        }
        let mut response = result(&notice, targets.len(), &recipients);
        response["hours_snapshot_stale_count"] = json!(stale_count);
        response["hours_snapshot_stale"] = json!(stale_count > 0);
        audit(conn, notice.id, None, Some(user.id), "send_requested", json!({"target_count":targets.len()})).await?;
        remember(conn, key, user.id, "send", &hash, notice.id, &response).await?;
        Ok(response)
    }).await?;
    Ok(Json(response))
}

pub async fn status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    require_staff(&user)?;
    let id: i64 = id.parse().map_err(|_| AppError::NotFound)?;
    let mut conn = state.pool.get().await?;
    let notice = diesel::sql_query(
        "SELECT id,target_month,audience,channel,employed_excluded,created_at,audiences,title,body FROM admin_notices WHERE id=$1",
    )
    .bind::<BigInt, _>(id)
    .get_result::<Notice>(&mut conn)
    .await
    .optional()?
    .ok_or(AppError::NotFound)?;
    let recipients = recipients(&mut conn, id).await?;
    let mut response = result(&notice, recipients.len(), &recipients);
    response["recipients"] = serde_json::to_value(recipients)?;
    Ok(Json(response))
}

pub async fn retry(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    require_staff(&user)?;
    let id: i64 = id.parse().map_err(|_| AppError::NotFound)?;
    let key = idempotency_key(&headers)?;
    let hash = digest(format!("retry:{id}").as_bytes());
    let mut conn = state.pool.get().await?;
    let response = conn.transaction::<_, AppError, _>(async move |conn| {
        lock_key(conn, key).await?;
        if let Some(response) = replay(conn, key, user.id, "retry", &hash).await? { return Ok(response); }
        lock_students(conn).await?;
        // Notices are immutable. Lock only recipient rows below: locking the
        // parent notice can deadlock a worker inserting its audit FK after the
        // recipient's user was moved out of the student role.
        let notice = diesel::sql_query("SELECT id,target_month,audience,channel,employed_excluded,created_at,audiences,title,body FROM admin_notices WHERE id=$1")
            .bind::<BigInt, _>(id).get_result::<Notice>(conn).await.optional()?.ok_or(AppError::NotFound)?;
        if !notice.channel.email() { return Err(AppError::InvalidState("이메일 발송을 선택하지 않은 알림입니다.".into())); }
        selection_deadline(conn, notice.target_month, notice.audience, &notice.audiences).await?;
        lock_selection(conn, notice.target_month, notice.audience, &notice.audiences).await?;
        let failed: Vec<Recipient> = diesel::sql_query("SELECT id,user_id,email_recipient,email_status,email_attempts,email_sent_at,last_error_code FROM admin_notice_recipients WHERE notice_id=$1 AND email_status='failed' ORDER BY user_id FOR UPDATE")
            .bind::<BigInt, _>(id).load(conn).await?;
        if failed.is_empty() { return Err(AppError::InvalidState("재시도할 실패 대상이 없습니다.".into())); }
        let current = candidates(conn, notice.target_month).await?;
        for recipient in &failed {
            let target = current.iter().find(|target| target.id == recipient.user_id && included(target, &notice.audiences) && matches_selection(target, notice.audience, &notice.audiences));
            let (address, status, error) = if let Some(target) = target {
                match state.mailer.as_ref().ok_or("smtp_not_configured").and_then(|mailer| mailer.recipient(&target.login)) {
                    Ok(address) if recipient.email_recipient.as_ref().is_some_and(|original| original != &address) =>
                        (recipient.email_recipient.clone(), "skipped", Some("recipient_changed")),
                    Ok(address) => (Some(address), "pending", None),
                    Err(error) => (recipient.email_recipient.clone(), "failed", Some(error)),
                }
            } else { (recipient.email_recipient.clone(), "skipped", Some("no_longer_target")) };
            diesel::sql_query("UPDATE admin_notice_recipients SET email_recipient=$2,email_status=$3,last_error_code=$4,claim_token=NULL,claimed_at=NULL WHERE id=$1")
                .bind::<BigInt, _>(recipient.id).bind::<Nullable<Text>, _>(address)
                .bind::<Text, _>(status).bind::<Nullable<Text>, _>(error).execute(conn).await?;
            audit(conn,id,Some(recipient.id),Some(user.id),"email_retry_requested",json!({"email_status":status,"error_code":error})).await?;
        }
        let current_recipients = recipients(conn,id).await?;
        let mut response = result(&notice,0,&current_recipients);
        response["retried"] = json!(failed.len());
        remember(conn,key,user.id,"retry",&hash,id,&response).await?;
        Ok(response)
    }).await?;
    Ok(Json(response))
}

#[derive(QueryableByName)]
struct Delivery {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = BigInt)]
    notice_id: i64,
    #[diesel(sql_type = BigInt)]
    user_id: i64,
    #[diesel(sql_type = Nullable<Text>)]
    email_recipient: Option<String>,
    #[diesel(sql_type = Date)]
    target_month: NaiveDate,
    #[diesel(sql_type = Text)]
    audience: NoticeAudience,
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    message_id: Uuid,
    #[diesel(sql_type = Array<Text>)]
    audiences: Vec<NoticeAudience>,
    #[diesel(sql_type = Nullable<Text>)]
    title: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    body: Option<String>,
}

/// Claim is committed before SMTP. If the process crashes after SMTP accepted a
/// message, the lease becomes `delivery_unknown`, never an automatic duplicate.
///
/// Lock discipline (review fix): no `users`/recipient row locks are held
/// across the SMTP attempt. Three short phases instead —
///   1. claim: one transaction flips pending -> sending with a lease token;
///   2. pre-check: one short transaction verifies the claim is still ours,
///      holds the time_requirements SHARE locks only while re-reading the
///      audience, and decides send vs skip;
///   3. SMTP runs with no transaction (and no pooled connection) held;
///   4. finalize: one short transaction records the outcome, guarded by the
///      claim token, plus its audit row.
///
/// Crash windows are unchanged from the locked version: crash after claim or
/// after a successful SMTP but before finalize leaves the row `sending`
/// until the lease sweep marks it `delivery_unknown` — it is never resent
/// automatically, so nobody gets a duplicate; crash after finalize is fully
/// recorded. The eligibility re-check and the send are no longer atomic:
/// a user whose status changes during the (<=30s) SMTP window may still
/// receive that one already-approved email, which the finalize step cannot
/// unsend — that bounded window is the price of not locking user rows
/// across a network call.
pub async fn process_one_email(state: &AppState) -> Result<bool, AppError> {
    let mut conn = state.pool.get().await?;
    diesel::sql_query("WITH expired AS (UPDATE admin_notice_recipients SET email_status='failed',last_error_code='delivery_unknown',claim_token=NULL WHERE email_status='sending' AND claimed_at < now() - interval '2 minutes' RETURNING id,notice_id) INSERT INTO admin_notice_events(notice_id,recipient_id,event,detail) SELECT notice_id,id,'email_failed','{\"error_code\":\"delivery_unknown\"}' FROM expired")
        .execute(&mut conn).await?;
    let token = Uuid::new_v4();
    let delivery = conn.transaction::<_, AppError, _>(async |conn| {
        let delivery = diesel::sql_query("SELECT r.id,r.notice_id,r.user_id,r.email_recipient,n.target_month,n.audience,r.message_id,n.audiences,n.title,n.body FROM admin_notice_recipients r JOIN admin_notices n ON n.id=r.notice_id WHERE r.email_status='pending' AND n.channel IN ('email','both') ORDER BY r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED")
            .get_result::<Delivery>(conn).await.optional()?;
        if let Some(delivery) = &delivery {
            diesel::sql_query("UPDATE admin_notice_recipients SET email_status='sending',claim_token=$2,claimed_at=now(),email_attempts=email_attempts+1 WHERE id=$1")
                .bind::<BigInt, _>(delivery.id).bind::<diesel::sql_types::Uuid, _>(token).execute(conn).await?;
        }
        Ok(delivery)
    }).await?;
    let Some(delivery) = delivery else {
        return Ok(false);
    };
    // Phase 2 (short transaction): decide, holding no row locks afterwards.
    enum Phase {
        Final(&'static str, Option<&'static str>),
        Send(Option<DateTime<Utc>>),
    }
    let phase = conn.transaction::<_, AppError, _>(async |conn| {
        let active = diesel::sql_query("SELECT id FROM admin_notice_recipients WHERE id=$1 AND email_status='sending' AND claim_token=$2")
            .bind::<BigInt, _>(delivery.id).bind::<diesel::sql_types::Uuid, _>(token)
            .get_result::<IdRow>(conn).await.optional()?;
        if active.is_none() { return Ok(Phase::Final("", None)); }
        lock_selection(conn, delivery.target_month, delivery.audience, &delivery.audiences).await?;
        let open = selection_deadline(conn,delivery.target_month,delivery.audience,&delivery.audiences).await;
        let phase = match open {
            Err(AppError::CycleClosed) => Phase::Final("skipped",Some("cycle_closed")),
            Err(error) => return Err(error),
            Ok(closes_at) => {
                let target = candidates(conn,delivery.target_month).await?.into_iter()
                    .find(|target| target.id == delivery.user_id && included(target, &delivery.audiences) && matches_selection(target, delivery.audience, &delivery.audiences));
                if target.is_none() { Phase::Final("skipped",Some("no_longer_target")) }
                else if let (Some(mailer),Some(recipient)) = (&state.mailer,&delivery.email_recipient) {
                    // A login or recipient-domain change must not send an old
                    // queued address or silently redirect an approved recipient.
                    let current_address = target.as_ref().and_then(|target| mailer.recipient(&target.login).ok());
                    if current_address.as_ref() != Some(recipient) {
                        Phase::Final("skipped",Some("recipient_changed"))
                    } else { Phase::Send(closes_at) }
                } else { Phase::Final("failed",Some("smtp_not_configured")) }
            }
        };
        Ok(phase)
    }).await?;
    // Phase 3: SMTP with no transaction and no pooled connection held.
    let (status,error) = match phase {
        Phase::Final("", _) => return Ok(true), // claim lost; nothing to record
        Phase::Final(status, error) => (status, error),
        Phase::Send(closes_at) => {
            drop(conn);
            let (Some(mailer),Some(recipient)) = (&state.mailer,&delivery.email_recipient) else {
                return Ok(true); // pre-check already classified this; defensive
            };
            let sent = if let (Some(title), Some(body)) = (&delivery.title, &delivery.body) {
                mailer.send_message(recipient, title, body, delivery.message_id).await
            } else {
                mailer.send_notice(recipient,delivery.target_month,closes_at,delivery.audience,delivery.message_id).await
            };
            match sent {
                Ok(()) => ("sent",None),
                Err(error) => ("failed",Some(error)),
            }
        }
    };
    // Phase 4 (short transaction): record the outcome under our claim token.
    let mut conn = state.pool.get().await?;
    conn.transaction::<_, AppError, _>(async |conn| {
        let updated = diesel::sql_query("UPDATE admin_notice_recipients SET email_status=$2,last_error_code=$3,email_sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END,claim_token=NULL WHERE id=$1 AND claim_token=$4 AND email_status='sending'")
            .bind::<BigInt, _>(delivery.id).bind::<Text, _>(status).bind::<Nullable<Text>, _>(error)
            .bind::<diesel::sql_types::Uuid, _>(token).execute(conn).await?;
        // Lease was taken over (expired mid-send): its owner records the
        // outcome; writing ours would corrupt the new attempt's history.
        if updated == 0 { return Ok(()); }
        audit(conn,delivery.notice_id,Some(delivery.id),None,&format!("email_{status}"),json!({"error_code":error})).await?;
        Ok(())
    }).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_defaults_preserve_old_idempotency_hashes() {
        let old = format!(
            r#"{{"month":"2026-10","expected_count":1,"target_fingerprint":"{}"}}"#,
            "a".repeat(64)
        );
        let mut request: SendRequest = serde_json::from_str(&old).unwrap();
        assert_eq!(request.channel, NoticeChannel::Both);
        assert_eq!(serde_json::to_string(&request).unwrap(), old);
        request.channel = NoticeChannel::Email;
        assert_ne!(
            digest(&serde_json::to_vec(&request).unwrap()),
            digest(old.as_bytes())
        );
        request.channel = NoticeChannel::Service;
        assert_ne!(
            digest(&serde_json::to_vec(&request).unwrap()),
            digest(old.as_bytes())
        );
    }

    fn candidate(id: i64, employed: bool) -> Candidate {
        Candidate {
            id,
            display_name: "Dummy".into(),
            ordinal: None,
            ko_name: None,
            date_of_birth: None,
            login: format!("dummy{id}"),
            employed,
            initial_submitted: true,
            draft: false,
            submitted: false,
            recognized_seconds: Some(0),
            as_of: None,
        }
    }

    #[test]
    fn hour_audiences_partition_boundaries_without_treating_unknown_as_zero() {
        for (seconds, audience) in [
            (0, NoticeAudience::Under40),
            (143_999, NoticeAudience::Under40),
            (144_000, NoticeAudience::Hours40To80),
            (287_999, NoticeAudience::Hours40To80),
            (288_000, NoticeAudience::AtLeast80),
        ] {
            let mut target = candidate(1, false);
            target.submitted = true;
            target.recognized_seconds = Some(seconds);
            assert!(!matches_audience(&target, NoticeAudience::Unsubmitted));
            for group in [
                NoticeAudience::Under40,
                NoticeAudience::Hours40To80,
                NoticeAudience::AtLeast80,
            ] {
                assert_eq!(matches_audience(&target, group), group == audience);
            }
        }
        let mut unknown = candidate(1, false);
        unknown.recognized_seconds = None;
        assert!(!matches_audience(&unknown, NoticeAudience::Under40));
        assert!(matches_audience(&unknown, NoticeAudience::Unsubmitted));
    }

    #[test]
    fn employed_selection_is_independent_of_registration_and_hours() {
        let mut target = candidate(1, true);
        target.initial_submitted = false;
        target.recognized_seconds = None;
        let groups = [NoticeAudience::Employed];
        assert!(matches_selection(
            &target,
            NoticeAudience::Unsubmitted,
            &groups
        ));
        assert!(included(&target, &groups));
        assert!(!included(&target, &[NoticeAudience::Under40]));
        target.submitted = true;
        assert!(matches_audience(&target, NoticeAudience::Employed));
        target.employed = false;
        assert!(!matches_audience(&target, NoticeAudience::Employed));
        assert!(validate_legacy(NoticeAudience::Employed).is_err());
    }

    #[test]
    fn employed_union_retains_students_matching_another_selected_condition() {
        let mut target = candidate(1, true);
        target.recognized_seconds = Some(288_000);
        let groups = [NoticeAudience::Employed, NoticeAudience::AtLeast80];
        assert!(matches_selection(
            &target,
            NoticeAudience::Unsubmitted,
            &groups
        ));
        assert!(included(&target, &groups));
        target.employed = false;
        assert!(matches_selection(
            &target,
            NoticeAudience::Unsubmitted,
            &groups
        ));
        assert!(included(&target, &groups));
        target.recognized_seconds = Some(0);
        assert!(!matches_selection(
            &target,
            NoticeAudience::Unsubmitted,
            &groups
        ));
    }

    #[test]
    fn stale_snapshot_warning_respects_two_hour_threshold_and_on_hold() {
        let now = DateTime::parse_from_rfc3339("2026-10-18T12:00:00Z")
            .unwrap()
            .to_utc();
        let mut fresh = candidate(1, false);
        fresh.recognized_seconds = Some(150_000);
        fresh.as_of = Some(now - chrono::TimeDelta::hours(1));
        let mut edge = candidate(2, false);
        edge.recognized_seconds = Some(150_000);
        edge.as_of = Some(now - SNAPSHOT_STALE_AFTER);
        let mut stale = candidate(3, false);
        stale.recognized_seconds = Some(150_000);
        stale.as_of = Some(now - chrono::TimeDelta::hours(3));
        let mut on_hold = candidate(4, false);
        on_hold.recognized_seconds = None; // never treated as 0h / stale hours
        on_hold.as_of = Some(now - chrono::TimeDelta::hours(9));
        let targets = [&fresh, &edge, &stale, &on_hold];
        let (count, oldest) = stale_hours_snapshots(
            targets.into_iter(),
            NoticeAudience::Hours40To80,
            &[],
            now,
        );
        assert_eq!(count, 1);
        assert_eq!(oldest, stale.as_of);
        // Grouped composer selections use the same rule...
        let (group_count, _) = stale_hours_snapshots(
            [&stale].into_iter(),
            NoticeAudience::Unsubmitted,
            &[NoticeAudience::AtLeast80],
            now,
        );
        assert_eq!(group_count, 1);
        // ...and non-hours selections never warn.
        let (none, _) = stale_hours_snapshots(
            [&stale].into_iter(),
            NoticeAudience::Unsubmitted,
            &[],
            now,
        );
        assert_eq!(none, 0);
    }

    #[test]
    fn fingerprint_cannot_be_reused_for_a_different_audience() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let targets = [candidate(1, false)];
        assert_ne!(
            target_fingerprint(month, NoticeAudience::Under40, &targets, None, None),
            target_fingerprint(month, NoticeAudience::Hours40To80, &targets, None, None),
        );
    }

    #[test]
    fn fingerprint_checks_identity_not_only_count() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let first = vec![candidate(1, false), candidate(2, false)];
        let changed = vec![candidate(1, false), candidate(3, false)];
        assert_ne!(
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &first,
                Some(kst::month_window(month).1),
                None
            ),
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &changed,
                Some(kst::month_window(month).1),
                None
            )
        );
        let reordered = vec![candidate(2, false), candidate(1, false), candidate(4, true)];
        assert_eq!(
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &first,
                Some(kst::month_window(month).1),
                None
            ),
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &reordered,
                Some(kst::month_window(month).1),
                None
            )
        );
        assert_ne!(
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &first,
                Some(kst::month_window(month).1),
                None
            ),
            target_fingerprint(
                month + chrono::Months::new(1),
                NoticeAudience::Unsubmitted,
                &first,
                Some(kst::month_window(month).1),
                None
            )
        );
    }

    #[test]
    fn preview_cannot_be_reused_after_recipient_domain_or_smtp_availability_changes() {
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let candidates = vec![candidate(1, false)];
        let original = target_fingerprint(
            month,
            NoticeAudience::Unsubmitted,
            &candidates,
            Some(kst::month_window(month).1),
            Some("example.test"),
        );
        assert_ne!(
            original,
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &candidates,
                Some(kst::month_window(month).1),
                Some("other.test")
            )
        );
        assert_ne!(
            original,
            target_fingerprint(
                month,
                NoticeAudience::Unsubmitted,
                &candidates,
                Some(kst::month_window(month).1),
                None
            )
        );
    }

    #[test]
    fn missing_smtp_cannot_count_as_email_success() {
        let recipient = Recipient {
            id: 1,
            user_id: 1,
            email_recipient: None,
            email_status: "failed".into(),
            email_attempts: 0,
            email_sent_at: None,
            last_error_code: Some("smtp_not_configured".into()),
        };
        let counts = email_counts(&[recipient]);
        assert_eq!(counts.sent, 0);
        assert_eq!(counts.pending, 0);
        assert_eq!(counts.failed, 1);
    }
}
