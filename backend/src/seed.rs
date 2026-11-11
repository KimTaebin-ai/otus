//! `otus-backend seed`: demo data for the hackathon checkpoints. Safe to re-run.
//!
//! - cycles: this KST month and last month, each one whole KST calendar month
//!   (`kst::month_window`); last month is therefore closed
//! - dongmin (동민): last month's 최초 4종 approved → logs in to home, ready for U04
//! - seoyeon (이서연): approved 최초 4종 + this month's monthly with 재검토 요청 → U05
//! - reviewdemo (최초검토 샘플): this month's 최초 4종 pending_review
//! - supplementdemo (보완검토 샘플): approved 최초 4종 + monthly/supplement resubmitted
//! - employeddemo (취업제외 샘플): approved 최초 4종, employed, no submission this month
//!
//! Any new demo-login ID still starts from U02.
//! - case01..case16: the scenario matrix in docs/demo-cases.md
//!   (submissions, eligibility tiers, notifications, employed, originals).

use std::path::Path;

use chrono::{Datelike, Months, NaiveDate, Utc};
use diesel::prelude::*;
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use uuid::Uuid;

use crate::crypto::FieldCipher;
use crate::domain::{DocType, Kind, Status};
use crate::kst;
use crate::models::{NewSubmission, NewSubmissionEvent, NewSubmissionFile};
use crate::schema::{
    cycles, notifications, submission_events, submission_files, submissions, time_requirements,
    users,
};
use crate::storage::Received;

/// A tiny valid one-page PDF, so seeded files pass the same checks as uploads.
fn sample_pdf(title: &str) -> Vec<u8> {
    let text = format!("BT /F1 18 Tf 72 720 Td (SAMPLE - {title}) Tj ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{text}\nendstream", text.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
    ];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n{obj}\nendobj\n", i + 1).bytes());
    }
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for off in offsets {
        pdf.extend(format!("{off:010} 00000 n \n").bytes());
    }
    pdf.extend(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .bytes(),
    );
    pdf
}

struct Seeded<'a> {
    kind: Kind,
    month: NaiveDate,
    parent_id: Option<Uuid>,
    docs: &'a [DocType],
    /// transitions applied in order, starting from draft
    statuses: &'a [Status],
    /// review_comment and revision_doc_types when it ends in revision_requested
    review: Option<(&'a str, &'a [DocType])>,
}

struct Seeder<'a> {
    upload_dir: &'a Path,
    file_cipher: &'a FieldCipher,
}

impl Seeder<'_> {
    async fn ensure_cycle(
        &self,
        conn: &mut AsyncPgConnection,
        month: NaiveDate,
    ) -> anyhow::Result<()> {
        let (opens, closes) = kst::month_window(month);
        diesel::insert_into(cycles::table)
            .values((
                cycles::target_month.eq(month),
                cycles::opens_at.eq(opens),
                cycles::closes_at.eq(closes),
            ))
            .on_conflict_do_nothing()
            .execute(conn)
            .await?;
        Ok(())
    }

    /// Returns None when the demo user already exists (its data was seeded before).
    async fn new_demo_user(
        &self,
        conn: &mut AsyncPgConnection,
        login: &str,
        name: &str,
    ) -> anyhow::Result<Option<i64>> {
        self.new_demo_user_with_role(conn, login, name, "student")
            .await
    }

    async fn new_demo_user_with_role(
        &self,
        conn: &mut AsyncPgConnection,
        login: &str,
        name: &str,
        role: &str,
    ) -> anyhow::Result<Option<i64>> {
        let exists: Option<i64> = users::table
            .filter(users::is_demo.eq(true))
            .filter(users::login.eq(login))
            .select(users::id)
            .first(conn)
            .await
            .optional()?;
        if exists.is_some() {
            return Ok(None);
        }
        Ok(Some(
            diesel::insert_into(users::table)
                .values((
                    users::login.eq(login),
                    users::display_name.eq(name),
                    users::role.eq(role),
                    users::is_demo.eq(true),
                ))
                .returning(users::id)
                .get_result(conn)
                .await?,
        ))
    }

    /// One time_requirements row (demo snapshot; on_hold keeps tier empty).
    async fn time_row(
        &self,
        conn: &mut AsyncPgConnection,
        user_id: i64,
        month: NaiveDate,
        seconds: i64,
        status: Option<&str>,
        tier: Option<&str>,
    ) -> anyhow::Result<()> {
        diesel::insert_into(time_requirements::table)
            .values((
                time_requirements::user_id.eq(user_id),
                time_requirements::target_month.eq(month),
                time_requirements::recognized_seconds.eq(seconds),
                time_requirements::result_status.eq(status),
                time_requirements::tier.eq(tier),
                time_requirements::decided_at.eq(status.map(|_| Utc::now())),
            ))
            .on_conflict((time_requirements::user_id, time_requirements::target_month))
            .do_update()
            .set((
                time_requirements::recognized_seconds.eq(seconds),
                time_requirements::result_status.eq(status),
                time_requirements::tier.eq(tier),
            ))
            .execute(conn)
            .await?;
        Ok(())
    }

    /// One server notification (issue #10 kinds only), read or unread.
    async fn notify(
        &self,
        conn: &mut AsyncPgConnection,
        user_id: i64,
        kind: &str,
        data: String,
        read: bool,
    ) -> anyhow::Result<()> {
        diesel::insert_into(notifications::table)
            .values((
                notifications::user_id.eq(user_id),
                notifications::kind.eq(kind),
                notifications::data.eq(data),
                notifications::read_at.eq(read.then(Utc::now)),
            ))
            .execute(conn)
            .await?;
        Ok(())
    }

    /// A submitted submission with sample files, moved through `statuses` in order.
    async fn submission(
        &self,
        conn: &mut AsyncPgConnection,
        user_id: i64,
        seeded: Seeded<'_>,
    ) -> anyhow::Result<Uuid> {
        let Seeded {
            kind,
            month,
            parent_id,
            docs,
            statuses,
            review,
        } = seeded;
        let id = Uuid::new_v4();
        diesel::insert_into(submissions::table)
            .values(NewSubmission {
                id,
                user_id,
                kind,
                target_month: month,
                parent_id,
                required_doc_types: docs.iter().copied().map(Some).collect(),
            })
            .execute(conn)
            .await?;
        for &doc in docs {
            // encrypted like real uploads; if the transaction rolls back, the startup sweep
            // removes the unreferenced file
            let title = if kind == Kind::Supplement {
                format!("{} - supplementary copy", doc.as_str())
            } else {
                doc.as_str().to_owned()
            };
            let file = Received::from_bytes(sample_pdf(&title));
            let file_id = Uuid::new_v4();
            let row = NewSubmissionFile {
                id: file_id,
                submission_id: id,
                doc_type: doc,
                original_name: if kind == Kind::Supplement {
                    format!("{}_보완_샘플.pdf", doc.label())
                } else {
                    format!("{}_샘플.pdf", doc.label())
                },
                size_bytes: file.size as i64,
                sha256: file.sha256.clone(),
                key_id: Some(self.file_cipher.key_id()),
            };
            file.store(self.upload_dir, file_id, self.file_cipher)
                .await
                .map_err(|_| anyhow::anyhow!("storing a seed file failed"))?
                .commit();
            diesel::insert_into(submission_files::table)
                .values(row)
                .execute(conn)
                .await?;
        }
        let mut from = Status::Draft;
        for &to in statuses {
            let note = (to == Status::RevisionRequested)
                .then(|| review.map(|(c, _)| c.to_owned()))
                .flatten();
            diesel::insert_into(submission_events::table)
                .values(NewSubmissionEvent {
                    submission_id: id,
                    from_status: Some(from),
                    to_status: to,
                    actor_user_id: user_id,
                    idempotency_key: None,
                    note,
                })
                .execute(conn)
                .await?;
            from = to;
        }
        let (comment, revision_docs) = match review {
            Some((c, d)) if from == Status::RevisionRequested => {
                (Some(c.to_owned()), d.iter().copied().map(Some).collect())
            }
            _ => (None, Vec::new()),
        };
        diesel::update(submissions::table.find(id))
            .set((
                submissions::status.eq(from),
                // The DB ties draft <=> submitted_at IS NULL; a seeded draft
                // (case02) must stay unsubmitted.
                submissions::submitted_at.eq((from != Status::Draft).then(Utc::now)),
                submissions::review_comment.eq(comment),
                submissions::revision_doc_types.eq(revision_docs),
            ))
            .execute(conn)
            .await?;
        if let Some(parent_id) = parent_id {
            anyhow::ensure!(
                kind == Kind::Supplement && from == Status::Resubmitted,
                "a seeded supplement must end in resubmitted"
            );
            // Mirror finalize: the parent keeps its original submission time and
            // review reason, but both it and the completed child await re-review.
            let changed = diesel::update(
                submissions::table
                    .find(parent_id)
                    .filter(submissions::user_id.eq(user_id))
                    .filter(submissions::target_month.eq(month))
                    .filter(submissions::status.eq(Status::RevisionRequested)),
            )
            .set(submissions::status.eq(Status::Resubmitted))
            .execute(conn)
            .await?;
            anyhow::ensure!(
                changed == 1,
                "seed supplement parent is not awaiting revision"
            );
            diesel::insert_into(submission_events::table)
                .values(NewSubmissionEvent {
                    submission_id: parent_id,
                    from_status: Some(Status::RevisionRequested),
                    to_status: Status::Resubmitted,
                    actor_user_id: user_id,
                    idempotency_key: None,
                    note: Some(format!("보완 제출 {id}")),
                })
                .execute(conn)
                .await?;
        }
        Ok(id)
    }
}

pub async fn run(
    conn: &mut AsyncPgConnection,
    upload_dir: &Path,
    file_cipher: &FieldCipher,
) -> anyhow::Result<()> {
    let this_month = kst::current_month(Utc::now());
    let last_month = this_month - Months::new(1);
    let seeder = Seeder {
        upload_dir,
        file_cipher,
    };
    conn.transaction::<_, anyhow::Error, _>(async move |conn| {
        seeder.ensure_cycle(conn, this_month).await?;
        seeder.ensure_cycle(conn, last_month).await?;
        let initial = |month| Seeded {
            kind: Kind::Initial,
            month,
            parent_id: None,
            docs: DocType::ALL,
            statuses: &[Status::PendingReview, Status::Approved],
            review: None,
        };

        if let Some(dongmin) = seeder.new_demo_user(conn, "dongmin", "동민").await? {
            seeder
                .submission(conn, dongmin, initial(last_month))
                .await?;
            tracing::info!("seeded dongmin (동민)");
        }
        // Staff demo accounts (issue #9): log in with these demo logins to check the
        // admin surface and original-file permissions per role.
        for (login, name, role) in [
            ("opsdemo", "운영담당", "operator"),
            ("accountdemo", "회계담당", "accountant"),
            // Browser checks must not consume the human demo account's ZIP quota.
            ("accounttest", "자동검증 회계담당", "accountant"),
            ("admindemo", "관리자", "admin"),
        ] {
            seeder
                .new_demo_user_with_role(conn, login, name, role)
                .await?;
        }
        if let Some(seoyeon) = seeder.new_demo_user(conn, "seoyeon", "이서연").await? {
            seeder
                .submission(conn, seoyeon, initial(last_month))
                .await?;
            let comment = format!("{}월 1일 이후 발급본이 아닙니다.", this_month.month());
            let monthly = Seeded {
                kind: Kind::Monthly,
                month: this_month,
                parent_id: None,
                docs: &[DocType::EmploymentInsurance],
                statuses: &[Status::PendingReview, Status::RevisionRequested],
                review: Some((&comment, &[DocType::EmploymentInsurance])),
            };
            seeder.submission(conn, seoyeon, monthly).await?;
            tracing::info!("seeded seoyeon (이서연)");
        }
        // Staff API fixtures use their own demo logins. Re-running seed leaves
        // every previously created account, review decision and file untouched.
        if let Some(reviewdemo) = seeder
            .new_demo_user(conn, "reviewdemo", "최초검토 샘플")
            .await?
        {
            seeder
                .submission(
                    conn,
                    reviewdemo,
                    Seeded {
                        kind: Kind::Initial,
                        month: this_month,
                        parent_id: None,
                        docs: DocType::ALL,
                        statuses: &[Status::PendingReview],
                        review: None,
                    },
                )
                .await?;
            tracing::info!("seeded reviewdemo (최초검토 샘플)");
        }
        if let Some(supplementdemo) = seeder
            .new_demo_user(conn, "supplementdemo", "보완검토 샘플")
            .await?
        {
            seeder
                .submission(conn, supplementdemo, initial(last_month))
                .await?;
            let monthly_id = seeder
                .submission(
                    conn,
                    supplementdemo,
                    Seeded {
                        kind: Kind::Monthly,
                        month: this_month,
                        parent_id: None,
                        docs: &[DocType::EmploymentInsurance],
                        statuses: &[Status::PendingReview, Status::RevisionRequested],
                        review: Some((
                            "샘플: 고용보험가입내역서의 발급일을 확인하고 다시 제출해 주세요.",
                            &[DocType::EmploymentInsurance],
                        )),
                    },
                )
                .await?;
            seeder
                .submission(
                    conn,
                    supplementdemo,
                    Seeded {
                        kind: Kind::Supplement,
                        month: this_month,
                        parent_id: Some(monthly_id),
                        docs: &[DocType::EmploymentInsurance],
                        statuses: &[Status::Resubmitted],
                        review: None,
                    },
                )
                .await?;
            tracing::info!("seeded supplementdemo (보완검토 샘플)");
        }
        if let Some(employeddemo) = seeder
            .new_demo_user(conn, "employeddemo", "취업제외 샘플")
            .await?
        {
            seeder
                .submission(conn, employeddemo, initial(last_month))
                .await?;
            diesel::update(users::table.find(employeddemo))
                .set((
                    users::employed.eq(true),
                    users::employment_updated_at.eq(Utc::now()),
                ))
                .execute(conn)
                .await?;
            tracing::info!("seeded employeddemo (취업제외 샘플)");
        }
        // Eligibility demo users (issue #10 checkpoint): current-month tiers and
        // one of each last-month result, so the home card states can all be seen.
        for (login, name, cur_secs, last_secs, last_status, last_tier) in [
            ("elig0", "시간0", 0_i64, 100_000_i64, Some("not_met"), None),
            (
                "eliglow",
                "시간40미만",
                83_400,
                150_000,
                Some("met"),
                Some("tier_1"),
            ),
            (
                "eligmid",
                "시간40이상",
                189_000,
                300_000,
                Some("met"),
                Some("tier_2"),
            ),
            (
                "elighigh",
                "시간80이상",
                309_600,
                100_000,
                Some("on_hold"),
                None,
            ),
        ] {
            seeder.new_demo_user(conn, login, name).await?;
            let uid: i64 = users::table
                .filter(users::is_demo.eq(true))
                .filter(users::login.eq(login))
                .select(users::id)
                .first(conn)
                .await?;
            for (month, secs, status, tier) in [
                (this_month, cur_secs, None, None),
                (last_month, last_secs, last_status, last_tier),
            ] {
                diesel::insert_into(time_requirements::table)
                    .values((
                        time_requirements::user_id.eq(uid),
                        time_requirements::target_month.eq(month),
                        time_requirements::recognized_seconds.eq(secs),
                        time_requirements::result_status.eq(status),
                        time_requirements::tier.eq(tier),
                        time_requirements::decided_at.eq(status.map(|_| Utc::now())),
                    ))
                    .on_conflict((time_requirements::user_id, time_requirements::target_month))
                    .do_update()
                    .set((
                        time_requirements::recognized_seconds.eq(secs),
                        time_requirements::result_status.eq(status),
                        time_requirements::tier.eq(tier),
                    ))
                    .execute(conn)
                    .await?;
            }
        }
        // ---- 15 demo cases (docs/demo-cases.md) -------------------------
        // Exactly 16 extra logins, case01..case16; dongmin/seoyeon and the
        // fixtures above are untouched. Idempotent like the rest of the
        // seed: an existing login is skipped with all of its data.
        let month_str = |m: NaiveDate| format!("{:04}-{:02}", m.year(), m.month());
        macro_rules! case_user {
            ($login:literal, $name:literal) => {
                seeder.new_demo_user(conn, $login, $name).await?
            };
        }
        // case01: brand-new student, nothing submitted, 0h this month.
        let _ = case_user!("case01", "케이스01 신규");
        // case02: initial draft in progress (2 of 4 files uploaded).
        if let Some(u) = case_user!("case02", "케이스02 작성중") {
            seeder.submission(conn, u, Seeded { kind: Kind::Initial, month: this_month, parent_id: None, docs: &[DocType::IdCard, DocType::Bankbook], statuses: &[], review: None }).await?;
        }
        // case03: initial pending review this month (admin review queue).
        if let Some(u) = case_user!("case03", "케이스03 검토대기") {
            seeder.submission(conn, u, Seeded { kind: Kind::Initial, month: this_month, parent_id: None, docs: DocType::ALL, statuses: &[Status::PendingReview], review: None }).await?;
        }
        // case04: everything approved (initial last month, monthly this month).
        if let Some(u) = case_user!("case04", "케이스04 승인완료") {
            seeder.submission(conn, u, initial(last_month)).await?;
            seeder.submission(conn, u, Seeded { kind: Kind::Monthly, month: this_month, parent_id: None, docs: &[DocType::EmploymentInsurance], statuses: &[Status::PendingReview, Status::Approved], review: None }).await?;
        }
        // case05: monthly revision requested, one document to resubmit.
        if let Some(u) = case_user!("case05", "케이스05 보완요청") {
            seeder.submission(conn, u, initial(last_month)).await?;
            seeder.submission(conn, u, Seeded { kind: Kind::Monthly, month: this_month, parent_id: None, docs: &[DocType::EmploymentInsurance], statuses: &[Status::PendingReview, Status::RevisionRequested], review: Some(("케이스: 발급일을 확인해 주세요.", &[DocType::EmploymentInsurance])) }).await?;
        }
        // case06: supplement resubmitted after a revision request.
        if let Some(u) = case_user!("case06", "케이스06 보완재제출") {
            seeder.submission(conn, u, initial(last_month)).await?;
            let monthly = seeder.submission(conn, u, Seeded { kind: Kind::Monthly, month: this_month, parent_id: None, docs: &[DocType::EmploymentInsurance], statuses: &[Status::PendingReview, Status::RevisionRequested], review: Some(("케이스: 보완 제출 샘플.", &[DocType::EmploymentInsurance])) }).await?;
            seeder.submission(conn, u, Seeded { kind: Kind::Supplement, month: this_month, parent_id: Some(monthly), docs: &[DocType::EmploymentInsurance], statuses: &[Status::Resubmitted], review: None }).await?;
        }
        // case07: eligibility 0h, last month not_met (decided).
        if let Some(u) = case_user!("case07", "케이스07 시간0") {
            seeder.time_row(conn, u, this_month, 0, None, None).await?;
            seeder.time_row(conn, u, last_month, 90_000, Some("not_met"), None).await?;
        }
        // case08: under 40h this month; last month met tier_1.
        if let Some(u) = case_user!("case08", "케이스08 40미만") {
            seeder.time_row(conn, u, this_month, 120_000, None, None).await?;
            seeder.time_row(conn, u, last_month, 150_000, Some("met"), Some("tier_1")).await?;
        }
        // case09: 40-80h this month (projected tier_1); last month tier_2.
        if let Some(u) = case_user!("case09", "케이스09 40to80") {
            seeder.time_row(conn, u, this_month, 200_000, None, None).await?;
            seeder.time_row(conn, u, last_month, 300_000, Some("met"), Some("tier_2")).await?;
        }
        // case10: 80h+ this month; last month on_hold (never shown as 0h).
        if let Some(u) = case_user!("case10", "케이스10 80이상보류") {
            seeder.time_row(conn, u, this_month, 300_000, None, None).await?;
            seeder.time_row(conn, u, last_month, 100_000, Some("on_hold"), None).await?;
        }
        // case11: two unread notifications (projected + decided).
        if let Some(u) = case_user!("case11", "케이스11 미읽음알림") {
            seeder.notify(conn, u, "hours_projected", format!("{{\"month\":\"{}\",\"tier\":\"tier_1\"}}", month_str(this_month)), false).await?;
            seeder.notify(conn, u, "time_requirement_decided", format!("{{\"month\":\"{}\",\"status\":\"met\",\"tier\":\"tier_1\"}}", month_str(last_month)), false).await?;
        }
        // case12: notifications all read (unread-count 0 with history).
        if let Some(u) = case_user!("case12", "케이스12 읽은알림") {
            seeder.notify(conn, u, "hours_projected", format!("{{\"month\":\"{}\",\"tier\":\"tier_2\"}}", month_str(this_month)), true).await?;
            seeder.notify(conn, u, "time_requirement_decided", format!("{{\"month\":\"{}\",\"status\":\"met\",\"tier\":\"tier_2\"}}", month_str(last_month)), true).await?;
        }
        // case13: employed student (card hidden by FE), 40h+ snapshot.
        if let Some(u) = case_user!("case13", "케이스13 취업중") {
            seeder.submission(conn, u, initial(last_month)).await?;
            diesel::update(users::table.find(u)).set((users::employed.eq(true), users::employment_updated_at.eq(Utc::now()))).execute(conn).await?;
            seeder.time_row(conn, u, this_month, 200_000, None, None).await?;
        }
        // case14: only last (closed) month activity; this month untouched.
        if let Some(u) = case_user!("case14", "케이스14 마감월") {
            seeder.submission(conn, u, initial(last_month)).await?;
            seeder.submission(conn, u, Seeded { kind: Kind::Monthly, month: last_month, parent_id: None, docs: &[DocType::EmploymentInsurance], statuses: &[Status::PendingReview, Status::Approved], review: None }).await?;
        }
        // case15: submitted originals for the staff-permission demo — view
        // as opsdemo/accountdemo (200), admindemo and other students (404).
        if let Some(u) = case_user!("case15", "케이스15 원본권한") {
            seeder.submission(conn, u, Seeded { kind: Kind::Initial, month: this_month, parent_id: None, docs: DocType::ALL, statuses: &[Status::PendingReview], review: None }).await?;
        }
        // case16: initial 4 papers already submitted THIS month (the 4
        // include that month's employment-insurance certificate). Trying to
        // also create/finalize a monthly for the same month is rejected
        // 409 INVALID_STATE by the duplicate rule — nothing extra is seeded
        // for the blocked attempt, because a rejected create leaves no row;
        // the demo is driving the attempt itself (docs/demo-cases.md).
        if let Some(u) = case_user!("case16", "케이스16 중복차단") {
            seeder.submission(conn, u, Seeded { kind: Kind::Initial, month: this_month, parent_id: None, docs: DocType::ALL, statuses: &[Status::PendingReview], review: None }).await?;
        }
        // Demo profiles for users.ordinal / users.ko_name / users.date_of_birth.
        // None of the three exists in the 42 payload (no cohort ordinal; display
        // names are not language-tagged; no birth date), so real logins leave
        // them NULL until an admin fills them in. Demo accounts get plausible
        // values here instead. ordinal is free text, so the seeds deliberately
        // mix the written forms ("5", "7기", "8a", "9기A"). Idempotent, scoped
        // to demo users; the staff-role seeds (opsdemo/accountdemo/admindemo)
        // stay NULL on purpose.
        struct DemoProfile {
            login: &'static str,
            ordinal: &'static str,
            ko_name: &'static str,
            born: (i32, u32, u32),
        }
        const DEMO_PROFILES: &[DemoProfile] = &[
            DemoProfile { login: "dongmin", ordinal: "5", ko_name: "김동민", born: (2001, 3, 14) },
            DemoProfile { login: "seoyeon", ordinal: "6", ko_name: "이서연", born: (2002, 7, 2) },
            DemoProfile { login: "case01", ordinal: "7기", ko_name: "박지훈", born: (2000, 1, 25) },
            DemoProfile { login: "case02", ordinal: "7a", ko_name: "김하은", born: (2003, 11, 8) },
            DemoProfile { login: "case03", ordinal: "8", ko_name: "이준호", born: (1999, 5, 30) },
            DemoProfile { login: "case04", ordinal: "8b", ko_name: "최서아", born: (2002, 9, 17) },
            DemoProfile { login: "case05", ordinal: "9기", ko_name: "정우진", born: (2001, 12, 3) },
            DemoProfile { login: "case06", ordinal: "9기A", ko_name: "한지민", born: (2003, 4, 21) },
            DemoProfile { login: "case07", ordinal: "10", ko_name: "김도현", born: (2000, 8, 11) },
            DemoProfile { login: "case08", ordinal: "10a", ko_name: "이수아", born: (2004, 2, 29) },
            DemoProfile { login: "case09", ordinal: "11", ko_name: "박민준", born: (2001, 6, 15) },
            DemoProfile { login: "case10", ordinal: "11기B", ko_name: "최예린", born: (2002, 10, 5) },
            DemoProfile { login: "case11", ordinal: "12", ko_name: "윤태양", born: (2003, 1, 19) },
            DemoProfile { login: "case12", ordinal: "12a", ko_name: "서지우", born: (2000, 4, 7) },
            DemoProfile { login: "case13", ordinal: "13", ko_name: "강현우", born: (1999, 9, 23) },
            DemoProfile { login: "case14", ordinal: "13기", ko_name: "문채원", born: (2002, 5, 12) },
            DemoProfile { login: "case15", ordinal: "14", ko_name: "오승민", born: (2001, 8, 28) },
            DemoProfile { login: "case16", ordinal: "14a", ko_name: "이도윤", born: (2000, 6, 18) },
        ];
        for profile in DEMO_PROFILES {
            let (year, month, day) = profile.born;
            diesel::update(
                users::table
                    .filter(users::login.eq(profile.login))
                    .filter(users::is_demo.eq(true)),
            )
            .set((
                users::ordinal.eq(Some(profile.ordinal)),
                users::ko_name.eq(Some(profile.ko_name)),
                users::date_of_birth.eq(NaiveDate::from_ymd_opt(year, month, day)),
            ))
            .execute(conn)
            .await?;
        }
        Ok(())
    })
    .await?;
    tracing::info!("seed done: cycles for {last_month} and {this_month}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_window_is_whole_kst_month_with_exclusive_close() {
        let w = |y, m| {
            let (o, c) = kst::month_window(NaiveDate::from_ymd_opt(y, m, 1).unwrap());
            (o.to_rfc3339(), c.to_rfc3339())
        };
        // December rolls over into next year's January
        assert_eq!(
            w(2026, 12),
            (
                "2026-11-30T15:00:00+00:00".into(),
                "2026-12-31T15:00:00+00:00".into()
            )
        );
        // leap-year February: 29 days
        assert_eq!(
            w(2028, 2),
            (
                "2028-01-31T15:00:00+00:00".into(),
                "2028-02-29T15:00:00+00:00".into()
            )
        );
        // common-year February: 28 days
        assert_eq!(
            w(2027, 2),
            (
                "2027-01-31T15:00:00+00:00".into(),
                "2027-02-28T15:00:00+00:00".into()
            )
        );
        // 30- and 31-day months
        assert_eq!(w(2026, 9).1, "2026-09-30T15:00:00+00:00");
        assert_eq!(w(2026, 10).1, "2026-10-31T15:00:00+00:00");
    }

    #[test]
    fn sample_pdf_has_magic_and_eof() {
        let pdf = sample_pdf("id_card");
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.ends_with(b"%%EOF\n"));
    }
}
