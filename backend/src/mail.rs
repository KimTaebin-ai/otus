//! SMTP transport and a durable worker for explicitly requested admin notices.
//! Pending deliveries survive restarts. An interrupted SMTP attempt becomes
//! `delivery_unknown`, requiring manual retry because SMTP has no exactly-once ack.

use std::time::Duration;

use anyhow::{Context, ensure};
use chrono::NaiveDate;
use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use uuid::Uuid;

use crate::AppState;
use crate::domain::DocType;

pub struct MailConfig {
    recipient_domain: String,
    host: String,
    port: u16,
    tls: String,
    from: Mailbox,
    credentials: Option<Credentials>,
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn secret(name: &str) -> anyhow::Result<Option<String>> {
    if let Some(path) = env_value(&format!("{name}_FILE")) {
        let value =
            std::fs::read_to_string(path).with_context(|| format!("reading {name}_FILE"))?;
        return Ok(Some(value.trim_end_matches(['\r', '\n']).to_owned()));
    }
    Ok(env_value(name))
}

fn valid_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= 253
        && domain.split('.').all(|part| {
            !part.is_empty()
                && part.len() <= 63
                && !part.starts_with('-')
                && !part.ends_with('-')
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn loopback_host(host: &str) -> bool {
    host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

impl MailConfig {
    /// No default recipient domain: a missing SMTP configuration disables email.
    /// Partially configured SMTP is an error instead of silently changing delivery.
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let domain = env_value("MAIL_RECIPIENT_DOMAIN");
        let host = env_value("SMTP_HOST");
        let from = env_value("SMTP_FROM");
        if domain.is_none() && host.is_none() && from.is_none() {
            return Ok(None);
        }
        let recipient_domain = domain.context("MAIL_RECIPIENT_DOMAIN is required for SMTP")?;
        ensure!(
            valid_domain(&recipient_domain),
            "MAIL_RECIPIENT_DOMAIN is invalid"
        );
        let host = host.context("SMTP_HOST is required for SMTP")?;
        ensure!(
            !host.chars().any(char::is_whitespace),
            "SMTP_HOST is invalid"
        );
        let from = from
            .context("SMTP_FROM is required for SMTP")?
            .parse::<Mailbox>()
            .map_err(|_| anyhow::anyhow!("SMTP_FROM is invalid"))?;
        let tls = env_value("SMTP_TLS").unwrap_or_else(|| "tls".to_owned());
        ensure!(
            matches!(tls.as_str(), "tls" | "starttls" | "none"),
            "SMTP_TLS must be tls, starttls, or none"
        );
        ensure!(
            tls != "none" || loopback_host(&host),
            "SMTP_TLS=none requires a loopback SMTP_HOST"
        );
        let port = env_value("SMTP_PORT")
            .map(|value| value.parse::<u16>())
            .transpose()
            .context("SMTP_PORT is invalid")?
            .unwrap_or(if tls == "tls" { 465 } else { 587 });
        ensure!(port > 0, "SMTP_PORT must be nonzero");
        let credentials = match (env_value("SMTP_USERNAME"), secret("SMTP_PASSWORD")?) {
            (Some(user), Some(password)) => Some(Credentials::new(user, password)),
            (None, None) => None,
            _ => anyhow::bail!("SMTP_USERNAME and SMTP_PASSWORD(_FILE) must be supplied together"),
        };
        Ok(Some(Self {
            recipient_domain,
            host,
            port,
            tls,
            from,
            credentials,
        }))
    }
}

pub struct Mailer {
    recipient_domain: String,
    from: Mailbox,
    transport: AsyncSmtpTransport<Tokio1Executor>,
}

impl Mailer {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        MailConfig::from_env()?.map(Self::new).transpose()
    }

    fn new(config: MailConfig) -> anyhow::Result<Self> {
        let mut builder = match config.tls.as_str() {
            "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)?,
            "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)?,
            "none" if loopback_host(&config.host) => {
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
            }
            _ => anyhow::bail!("unencrypted SMTP requires a loopback host"),
        }
        .port(config.port)
        .timeout(Some(Duration::from_secs(10)));
        if let Some(credentials) = config.credentials {
            builder = builder.credentials(credentials);
        }
        Ok(Self {
            recipient_domain: config.recipient_domain.to_ascii_lowercase(),
            from: config.from,
            transport: builder.build(),
        })
    }

    pub fn recipient_domain(&self) -> &str {
        &self.recipient_domain
    }

    /// A login can never introduce a different mailbox, header, or domain.
    pub fn recipient(&self, login: &str) -> Result<String, &'static str> {
        if login.is_empty()
            || login.len() > 64
            || !login
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        {
            return Err("invalid_recipient");
        }
        let address = format!("{login}@{}", self.recipient_domain);
        address
            .parse::<Mailbox>()
            .map_err(|_| "invalid_recipient")?;
        Ok(address)
    }

    pub async fn send_notice(
        &self,
        recipient: &str,
        month: NaiveDate,
        closes_at: Option<chrono::DateTime<chrono::Utc>>,
        audience: crate::domain::NoticeAudience,
        message_id: Uuid,
    ) -> Result<(), &'static str> {
        let (subject, body) = if audience.study_hours().is_some() {
            (
                format!("[OTUS] {} 지원금 시간 요건 안내", month.format("%Y년 %m월")),
                format!(
                    "{} 학습 시간은 {} 구간입니다.\n하루 최대 12시간을 반영한 최근 집계 기준입니다.\n최종 지원금 지급 여부는 서류 검토와 별도로 확인해주세요.\n",
                    month.format("%Y년 %m월"),
                    audience.label()
                ),
            )
        } else {
            let closes_at = closes_at.ok_or("invalid_message")?;
            (
                format!("[OTUS] {} 서류 제출 안내", month.format("%Y년 %m월")),
                format!(
                    "{} 고용보험가입내역서를 준비해주세요.\n해당 월 1일 이후 발급본이 필요합니다.\n{}까지 OTUS 서비스의 제출 화면에서 PDF를 제출해주세요.\n",
                    month.format("%Y년 %m월"),
                    (closes_at - chrono::TimeDelta::seconds(1))
                        .with_timezone(&crate::kst::offset())
                        .format("%Y-%m-%d %H:%M KST")
                ),
            )
        };
        self.send_message(recipient, &subject, &body, message_id)
            .await
    }

    pub async fn send_message(
        &self,
        recipient: &str,
        subject: &str,
        body: &str,
        message_id: Uuid,
    ) -> Result<(), &'static str> {
        let mailbox = recipient
            .parse::<Mailbox>()
            .map_err(|_| "invalid_recipient")?;
        // Preserve the address selected by the explicit send/retry operation.
        // A configuration change must not redirect an already queued recipient.
        let message = Message::builder()
            .from(self.from.clone())
            .to(mailbox)
            .message_id(Some(format!("<{message_id}@{}>", self.recipient_domain)))
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_owned())
            .map_err(|_| "invalid_message")?;
        // Bound the entire attempt, not only individual SMTP commands. Never log
        // SMTP errors: responses can echo recipients or authentication details.
        match tokio::time::timeout(Duration::from_secs(30), self.transport.send(message)).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(_)) => Err("smtp_failed"),
            Err(_) => Err("delivery_unknown"),
        }
    }
}

/// An email copy of an in-app notification, queued with it (`event_emails`).
pub struct EventMail {
    pub subject: String,
    pub body: String,
}

/// "2026-10" → "10월"
fn month_label(month: &str) -> String {
    month
        .split('-')
        .nth(1)
        .and_then(|m| m.parse::<u32>().ok())
        .map_or_else(|| "이번 달".to_owned(), |m| format!("{m}월"))
}

fn closing(origin: &str, path: &str) -> String {
    format!(
        "\nOTUS에서 확인해주세요: {}{path}\n",
        origin.trim_end_matches('/')
    )
}

/// 승인 / 보완 요청 of a submission. `kind` is the notification kind.
pub fn review_email(
    kind: &str,
    month: &str,
    comment: Option<&str>,
    doc_types: &[DocType],
    origin: &str,
) -> Option<EventMail> {
    let m = month_label(month);
    match kind {
        "submission_approved" => Some(EventMail {
            subject: format!("[OTUS] {m} 서류가 승인됐어요"),
            body: format!(
                "{m} 서류 검토가 끝나 승인됐습니다.\n최종 지원금 수령 대상 여부는 시간 요건 판정과 함께 운영팀이 별도로 확정합니다.\n{}",
                closing(origin, "/history")
            ),
        }),
        "submission_revision_requested" => {
            let mut body = format!("{m} 서류에 보완이 필요합니다.\n");
            if !doc_types.is_empty() {
                let labels: Vec<&str> = doc_types.iter().map(|d| d.label()).collect();
                body.push_str(&format!("\n보완할 서류: {}\n", labels.join(", ")));
            }
            if let Some(comment) = comment.map(str::trim).filter(|c| !c.is_empty()) {
                body.push_str(&format!("검토 의견: {comment}\n"));
            }
            body.push_str("\n새 파일로 다시 제출해주세요.\n");
            body.push_str(&closing(origin, "/history"));
            Some(EventMail {
                subject: format!("[OTUS] {m} 서류 보완이 필요해요"),
                body,
            })
        }
        _ => None,
    }
}

/// The first time a month's count reaches the 40 / 80 hour line (a projection, not a decision).
pub fn hours_email(month: &str, hours: i64, origin: &str) -> EventMail {
    let m = month_label(month);
    EventMail {
        subject: format!("[OTUS] {m} 학습 시간 {hours}시간 이상이 됐어요 (예상)"),
        body: format!(
            "{m} 학습 시간이 {hours}시간 이상으로 집계됐습니다.\n하루 최대 12시간을 반영한 예상 구간이며, 최종 판정은 다음 달 1일에 이뤄집니다.\n{}",
            closing(origin, "/home")
        ),
    }
}

/// The month's 시간 요건 result. It never says the student "receives" the support: that is the
/// staff's separate 최종 수령 대상 decision.
pub fn decided_email(month: &str, status: &str, origin: &str) -> EventMail {
    let m = month_label(month);
    let result = match status {
        "met" => "시간 요건을 충족했습니다.",
        "not_met" => "시간 요건을 충족하지 못했습니다.",
        _ => "판정이 보류됐습니다. 운영팀이 다시 확인합니다.",
    };
    EventMail {
        subject: format!("[OTUS] {m} 시간 요건 판정 결과"),
        body: format!(
            "{m} 학습 시간 {result}\n최종 지원금 수령 대상 여부는 서류 검토와 함께 운영팀이 별도로 확정합니다.\n{}",
            closing(origin, "/home")
        ),
    }
}

/// Only consumes outboxes created by an admin send/retry or by a review/time-requirement
/// event. It never creates a monthly schedule or selects new recipients on its own.
pub fn spawn_worker(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(2));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            match crate::routes::admin_notices::process_one_email(&state).await {
                Ok(_) => {}
                Err(_) => {
                    tracing::warn!("notice outbox worker could not complete database processing")
                }
            }
            if process_one_event_email(&state).await.is_err() {
                tracing::warn!("event email worker could not complete database processing");
            }
        }
    });
}

#[derive(diesel::QueryableByName)]
struct EventDelivery {
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    id: i64,
    #[diesel(sql_type = diesel::sql_types::Text)]
    login: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    subject: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    body: String,
    #[diesel(sql_type = diesel::sql_types::Uuid)]
    message_id: Uuid,
}

/// Sends one queued event email. Claim, send and record are separate steps so no row lock or
/// pooled connection is held during SMTP; a claim older than 2 minutes counts as an interrupted
/// send (`delivery_unknown`) and is not retried on its own.
pub async fn process_one_event_email(state: &AppState) -> Result<bool, crate::error::AppError> {
    use diesel::OptionalExtension;
    use diesel::sql_types::{BigInt, Nullable, Text};
    use diesel_async::{AsyncConnection, RunQueryDsl};

    let mut conn = state.pool.get().await?;
    diesel::sql_query(
        "UPDATE event_emails SET status='failed', last_error_code='delivery_unknown', claim_token=NULL \
         WHERE status='sending' AND claimed_at < now() - interval '2 minutes'",
    )
    .execute(&mut conn)
    .await?;
    let token = Uuid::new_v4();
    let delivery = conn
        .transaction::<_, crate::error::AppError, _>(async |conn| {
            let delivery = diesel::sql_query(
                "SELECT e.id, u.login, e.subject, e.body, e.message_id \
                 FROM event_emails e JOIN users u ON u.id = e.user_id \
                 WHERE e.status='pending' ORDER BY e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED",
            )
            .get_result::<EventDelivery>(conn)
            .await
            .optional()?;
            if let Some(delivery) = &delivery {
                diesel::sql_query(
                    "UPDATE event_emails SET status='sending', claim_token=$2, claimed_at=now(), attempts=attempts+1 WHERE id=$1",
                )
                .bind::<BigInt, _>(delivery.id)
                .bind::<diesel::sql_types::Uuid, _>(token)
                .execute(conn)
                .await?;
            }
            Ok(delivery)
        })
        .await?;
    let Some(delivery) = delivery else {
        return Ok(false);
    };
    drop(conn);
    let (status, error) = match &state.mailer {
        None => ("skipped", Some("smtp_not_configured")),
        Some(mailer) => match mailer.recipient(&delivery.login) {
            Err(code) => ("failed", Some(code)),
            Ok(recipient) => match mailer
                .send_message(
                    &recipient,
                    &delivery.subject,
                    &delivery.body,
                    delivery.message_id,
                )
                .await
            {
                Ok(()) => ("sent", None),
                Err(code) => ("failed", Some(code)),
            },
        },
    };
    let mut conn = state.pool.get().await?;
    diesel::sql_query(
        "UPDATE event_emails SET status=$2, last_error_code=$3, \
         sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END, claim_token=NULL \
         WHERE id=$1 AND claim_token=$4 AND status='sending'",
    )
    .bind::<BigInt, _>(delivery.id)
    .bind::<Text, _>(status)
    .bind::<Nullable<Text>, _>(error)
    .bind::<diesel::sql_types::Uuid, _>(token)
    .execute(&mut conn)
    .await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    #[test]
    fn review_emails_carry_the_reason_and_the_documents() {
        let approved = review_email(
            "submission_approved",
            "2026-10",
            None,
            &[],
            "https://otus.test/",
        )
        .unwrap();
        assert_eq!(approved.subject, "[OTUS] 10월 서류가 승인됐어요");
        assert!(approved.body.contains("https://otus.test/history"));
        assert!(!approved.body.contains("//history"));

        let revision = review_email(
            "submission_revision_requested",
            "2026-10",
            Some(" 10월 1일 이후 발급본이 아닙니다. "),
            &[DocType::EmploymentInsurance],
            "https://otus.test",
        )
        .unwrap();
        assert_eq!(revision.subject, "[OTUS] 10월 서류 보완이 필요해요");
        assert!(revision.body.contains("보완할 서류: 고용보험가입내역서"));
        assert!(
            revision
                .body
                .contains("검토 의견: 10월 1일 이후 발급본이 아닙니다.")
        );
        assert!(review_email("hours_projected", "2026-10", None, &[], "x").is_none());
    }

    #[test]
    fn hour_notices_stay_projections_and_never_promise_payment() {
        let hours = hours_email("2026-10", 40, "https://otus.test");
        assert!(hours.subject.contains("40시간") && hours.subject.contains("예상"));
        for status in ["met", "not_met", "on_hold"] {
            let mail = decided_email("2026-10", status, "https://otus.test");
            assert!(mail.body.contains("운영팀이 별도로 확정"), "{status}");
        }
        assert!(
            decided_email("2026-10", "met", "o")
                .body
                .contains("충족했습니다")
        );
        assert!(
            decided_email("2026-10", "not_met", "o")
                .body
                .contains("충족하지 못했습니다")
        );
    }

    fn test_mailer(port: u16) -> Mailer {
        Mailer::new(MailConfig {
            recipient_domain: "example.test".into(),
            host: "127.0.0.1".into(),
            port,
            tls: "none".into(),
            from: "OTUS <noreply@example.test>".parse().unwrap(),
            credentials: None,
        })
        .unwrap()
    }

    #[test]
    fn rejects_header_and_recipient_injection() {
        let mailer = test_mailer(2525);
        assert_eq!(
            mailer.recipient("dong-kim_2").unwrap(),
            "dong-kim_2@example.test"
        );
        for login in ["", "a@other.test", "a,b", "a\r\nBcc:x", "a+b", ".a", "a..b"] {
            assert!(mailer.recipient(login).is_err(), "{login:?}");
        }
        for domain in ["", "@example.test", "a/b", "a\nb", "-a.test", "a..test"] {
            assert!(!valid_domain(domain));
        }
        assert!(!loopback_host("smtp.example.test"));
        assert!(loopback_host("127.0.0.1"));
        assert!(loopback_host("::1"));
    }

    #[test]
    fn refuses_remote_plaintext_smtp_without_connecting() {
        let result = Mailer::new(MailConfig {
            recipient_domain: "example.test".into(),
            host: "smtp.example.test".into(),
            port: 25,
            tls: "none".into(),
            from: "noreply@example.test".parse().unwrap(),
            credentials: None,
        });
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn sends_only_to_local_fake_smtp() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mailer = test_mailer(listener.local_addr().unwrap().port());
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            writer
                .write_all(b"220 localhost ESMTP test\r\n")
                .await
                .unwrap();
            let mut lines = BufReader::new(reader).lines();
            let mut data = false;
            let mut received = String::new();
            while let Some(line) = lines.next_line().await.unwrap() {
                if data {
                    if line == "." {
                        writer.write_all(b"250 queued\r\n").await.unwrap();
                        data = false;
                    } else {
                        received.push_str(&line);
                        received.push('\n');
                    }
                } else if line.starts_with("EHLO ") {
                    writer
                        .write_all(b"250-localhost\r\n250 8BITMIME\r\n")
                        .await
                        .unwrap();
                } else if line.starts_with("MAIL FROM:") || line.starts_with("RCPT TO:") {
                    received.push_str(&line);
                    received.push('\n');
                    writer.write_all(b"250 ok\r\n").await.unwrap();
                } else if line == "DATA" {
                    data = true;
                    writer.write_all(b"354 send data\r\n").await.unwrap();
                } else if line == "QUIT" {
                    writer.write_all(b"221 goodbye\r\n").await.unwrap();
                    break;
                } else {
                    panic!("unexpected test SMTP command: {line}");
                }
            }
            received
        });
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let result = mailer
            .send_notice(
                "dummy@example.test",
                month,
                Some(crate::kst::month_window(month).1),
                crate::domain::NoticeAudience::Unsubmitted,
                Uuid::nil(),
            )
            .await;
        assert!(result.is_ok());
        let received = tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        assert!(received.contains("RCPT TO:<dummy@example.test>"));
        assert!(
            received.contains("Message-ID: <00000000-0000-0000-0000-000000000000@example.test>")
        );
        assert!(!received.contains("Bcc:"));
    }
}
