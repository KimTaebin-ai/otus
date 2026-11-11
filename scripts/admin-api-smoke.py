#!/usr/bin/env python3
"""Exercise all six admin features against an isolated DB and local SMTP sink.

DATABASE_URL must point at otus_admin_test. The supplied backend binary runs with
synthetic keys, uploads, users and example.test mail addresses in a temp directory.
"""
import argparse
import base64
import csv
import io
import os
from pathlib import Path
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile


class SmtpSink(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), SmtpSession)
        self.messages = []
        self.failed_once = set()
        self.lock = threading.Lock()


class SmtpSession(socketserver.StreamRequestHandler):
    def reply(self, value):
        self.wfile.write(value.encode() + b"\r\n")
        self.wfile.flush()

    def handle(self):
        self.reply("220 localhost OTUS test SMTP")
        recipient = None
        while line := self.rfile.readline():
            command = line.decode().rstrip("\r\n")
            verb = command.split(" ", 1)[0].upper()
            if verb in ("EHLO", "HELO"):
                self.reply("250-localhost\r\n250 8BITMIME")
            elif verb == "RCPT":
                recipient = command.split(":", 1)[1].strip().strip("<>")
                with self.server.lock:
                    fail = recipient.startswith("smtp_fail_") and recipient not in self.server.failed_once
                    if fail:
                        self.server.failed_once.add(recipient)
                self.reply("450 synthetic temporary failure" if fail else "250 accepted")
            elif verb == "DATA":
                self.reply("354 end with a dot")
                content = []
                while (part := self.rfile.readline()) not in (b".\r\n", b".\n", b""):
                    content.append(part[1:] if part.startswith(b"..") else part)
                with self.server.lock:
                    self.server.messages.append((recipient, b"".join(content)))
                self.reply("250 queued")
            elif verb == "QUIT":
                self.reply("221 bye")
                return
            else:
                self.reply("250 ok")


def eventually(action, predicate, seconds=35):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        value = action()
        if predicate(value):
            return value
        time.sleep(0.1)
    raise AssertionError(f"timed out: {value!r}")


def exercise_seed():
    from admin_api_testlib import Client, CURRENT_MONTH, sql

    staff = Client.sql_session(int(sql("SELECT id FROM users WHERE login='accountdemo' AND is_demo")))
    queue = staff.request("GET", f"/api/admin/review-queue?month={CURRENT_MONTH}")
    by_login = {item["user"]["login"]: item for item in queue["items"]}
    assert by_login["reviewdemo"]["status"] == "pending_review", queue
    supplement = by_login["supplementdemo"]
    assert supplement["kind"] == "supplement" and supplement["status"] == "resubmitted", supplement
    history = staff.request("GET", f"/api/admin/submissions/{supplement['id']}/history")
    assert [item["kind"] for item in history["items"]] == ["supplement", "monthly"], history
    file_id = history["items"][0]["files"][0]["id"]
    assert b"SAMPLE" in staff.request("GET", f"/api/files/{file_id}")
    archive = staff.request("GET", f"/api/admin/archive/{CURRENT_MONTH}")
    row = next(row for row in archive["rows"] if row["login"] == "supplementdemo")
    assert len(row["base_docs"]) == 3 and row["previous"] == ["employment_insurance"], row
    targets = staff.request("GET", f"/api/admin/notices/submission-reminder?month={CURRENT_MONTH}")["targets"]
    assert "employeddemo" not in {target["login"] for target in targets}
    print("PASS repeatable seed: review queue, supplement history, base documents and employed exclusion", flush=True)


def exercise_archive_and_email(sink, upload_dir):
    from admin_api_testlib import Client, CURRENT_MONTH, PREVIOUS_MONTH, new_key, seed_user, sql

    suffix = uuid.uuid4().hex[:8]
    accountant = Client.sql_session(seed_user("zip_staff_" + suffix, role="accountant"))
    operator = Client.sql_session(seed_user("zip_ops_" + suffix, role="operator"))
    admin = Client.sql_session(seed_user("zip_admin_" + suffix, role="admin"))
    student_id = seed_user("zip_student_" + suffix)
    student = Client.sql_session(student_id)
    initial = student.create_finalize()
    initial_id = initial["id"]
    accountant.request("POST", f"/api/admin/submissions/{initial_id}/review", {"status": "approved"}, key=new_key())
    monthly = student.create_finalize(kind="monthly")
    monthly_id = monthly["id"]
    accountant.request("POST", f"/api/admin/submissions/{monthly_id}/review", {
        "status": "revision_requested", "review_comment": "더미 보완 요청", "revision_doc_types": ["employment_insurance"]
    }, key=new_key())
    supplement = student.create_finalize(kind="supplement", parent_id=monthly_id, doc_types=["employment_insurance"])
    accountant.request("POST", f"/api/admin/submissions/{supplement['id']}/review", {"status": "approved"}, key=new_key())
    archive = accountant.request("GET", f"/api/admin/archive/{CURRENT_MONTH}")
    row = next(r for r in archive["rows"] if r["user_id"] == student_id)
    assert len(row["files"]) == 5, row
    assert row["previous"] == ["employment_insurance"], row
    payload = {"user_ids": [student_id], "include_base_docs": False, "include_previous": True, "expected_pdf_count": 6}
    endpoint = f"/api/admin/archive/{CURRENT_MONTH}/exports"
    operator.request("POST", endpoint, payload, expected=403, key=new_key())
    admin.request("POST", endpoint, payload, expected=403, key=new_key())
    accountant.request("POST", endpoint, {**payload, "expected_pdf_count": 5}, expected=409, key=new_key())
    key = new_key()
    made = accountant.request("POST", endpoint, payload, expected=202, key=key)
    replay = accountant.request("POST", endpoint, payload, expected=202, key=key)
    assert replay["job_id"] == made["job_id"]
    accountant.request("POST", endpoint, {**payload, "include_previous": False}, expected=409, key=key)
    job = endpoint + "/" + made["job_id"]
    eventually(lambda: accountant.request("GET", job), lambda r: r["status"] == "ready")
    other = Client.sql_session(seed_user("zip_other_" + suffix, role="accountant"))
    other.request("GET", job, expected=404)
    data = accountant.request("GET", job + "/file")
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        names = zipped.namelist()
        assert len([n for n in names if n.endswith(".pdf")]) == 6, names
        assert any("_2.pdf" in n for n in names), names
        csv_name = next(n for n in names if n.endswith("제출목록.csv"))
        assert zipped.read(csv_name).startswith(b"\xef\xbb\xbf")
        assert all(zipped.read(n).startswith(b"%PDF-") for n in names if n.endswith(".pdf"))
    assert int(sql(f"SELECT count(*) FROM file_access_log WHERE export_job_id='{made['job_id']}' AND purpose='bulk_export'")) == 6
    assert int(sql(f"SELECT count(*) FROM archive_export_events WHERE job_id='{made['job_id']}' AND action='downloaded'")) == 1
    for path in upload_dir.rglob("*"):
        if path.is_file():
            assert not path.read_bytes().startswith((b"%PDF-", b"PK\x03\x04")), path
    # The export creator's role is checked anew on every request.
    creator = sql(f"SELECT created_by FROM archive_export_jobs WHERE id='{made['job_id']}'")
    sql(f"UPDATE users SET role='operator' WHERE id={creator}")
    accountant.request("GET", job + "/file", expected=403)
    sql(f"UPDATE users SET role='accountant' WHERE id={creator}")
    sql(f"UPDATE archive_export_jobs SET expires_at=now()-interval '1 second' WHERE id='{made['job_id']}'")
    accountant.request("GET", job + "/file", expected=404)
    print("PASS archive: two chains, previous submissions, ZIP/CSV, audit, RBAC, expiry, encrypted storage", flush=True)

    recipient_id = seed_user("smtp_ok_" + suffix)
    failed_id = seed_user("smtp_fail_" + suffix)
    changed_id = seed_user("smtp_fail_changed_" + suffix)
    employed_id = seed_user("smtp_employed_" + suffix, employed=True)
    for uid in (recipient_id, failed_id, changed_id, employed_id):
        sid = new_key()
        # These already-onboarded fixture students need their current monthly document.
        sql(f"""INSERT INTO submissions(id,user_id,kind,target_month,status,submitted_at,required_doc_types)
          VALUES('{sid}',{uid},'initial','{PREVIOUS_MONTH}-01','approved',
          ('{PREVIOUS_MONTH}-01'::date AT TIME ZONE 'Asia/Seoul'),
          ARRAY['id_card','resident_abstract','bankbook','employment_insurance'])""")
    preview = operator.request("GET", f"/api/admin/notices/submission-reminder?month={CURRENT_MONTH}")
    targets = {r["user_id"] for r in preview["targets"]}
    assert {recipient_id, failed_id} <= targets and employed_id not in targets, preview
    assert preview["email_available"] is True
    body = {"month": CURRENT_MONTH, "expected_count": len(preview["targets"]), "target_fingerprint": preview["target_fingerprint"]}
    notice_endpoint = "/api/admin/notices/submission-reminder"
    operator.request("POST", notice_endpoint, {**body, "target_fingerprint": "0" * 64}, expected=409, key=new_key())
    send_key = new_key()
    result = operator.request("POST", notice_endpoint, body, key=send_key)
    assert operator.request("POST", notice_endpoint, body, key=send_key) == result
    # A sent reminder must be usable from the student's actual in-app inbox,
    # including when that recipient's SMTP delivery fails.
    recipient = Client.sql_session(recipient_id)
    other = Client.sql_session(failed_id)
    inbox = recipient.request("GET", "/api/notifications")
    reminders = [n for n in inbox["items"] if n["kind"] == "submission_reminder"]
    assert len(reminders) == 1, inbox  # same-key replay did not send twice
    notification = reminders[0]
    assert notification["data"] == {"month": CURRENT_MONTH}
    assert notification["read_at"] is None
    assert recipient.request("GET", "/api/notifications/unread-count")["count"] == 1
    assert any(n["kind"] == "submission_reminder" for n in other.request("GET", "/api/notifications")["items"])
    other.request("POST", f"/api/notifications/{notification['id']}/read", expected=404)
    for _ in range(2):
        recipient.request("POST", f"/api/notifications/{notification['id']}/read", expected=204)
    assert recipient.request("GET", "/api/notifications/unread-count")["count"] == 0
    assert recipient.request("GET", "/api/notifications")["items"][0]["read_at"] is not None
    assert Client.sql_session(employed_id).request("GET", "/api/notifications")["items"] == []
    status_path = f"/api/admin/notices/{result['notice_id']}"
    completed = eventually(lambda: operator.request("GET", status_path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    recipients = {r["user_id"]: r for r in completed["recipients"]}
    assert recipients[recipient_id]["email_status"] == "sent", completed
    assert recipients[failed_id]["email_status"] == "failed", completed
    assert recipients[changed_id]["email_status"] == "failed", completed
    # A retry must not silently redirect the original confirmed recipient.
    sql(f"UPDATE users SET login='smtp_changed_{suffix}' WHERE id={changed_id}")
    retry_key = new_key()
    retry = operator.request("POST", status_path + "/retry", key=retry_key)
    assert operator.request("POST", status_path + "/retry", key=retry_key) == retry
    retried = eventually(lambda: operator.request("GET", status_path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    assert next(r for r in retried["recipients"] if r["user_id"] == failed_id)["email_status"] == "sent", retried
    changed = next(r for r in retried["recipients"] if r["user_id"] == changed_id)
    assert changed["email_status"] == "skipped" and changed["last_error_code"] == "recipient_changed", changed
    assert changed["email_recipient"] == "smtp_fail_changed_" + suffix + "@example.test", changed
    with sink.lock:
        assert not any(recipient == "smtp_changed_" + suffix + "@example.test" for recipient, _ in sink.messages)
    # A distinct action may send again immediately: there is deliberately no 24h cooldown.
    preview = operator.request("GET", f"/api/admin/notices/submission-reminder?month={CURRENT_MONTH}")
    second = operator.request("POST", notice_endpoint, {"month": CURRENT_MONTH, "expected_count": len(preview["targets"]), "target_fingerprint": preview["target_fingerprint"]}, key=new_key())
    assert second["notice_id"] != result["notice_id"]
    eventually(lambda: operator.request("GET", f"/api/admin/notices/{second['notice_id']}"), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    with sink.lock:
        mine = [message for recipient, message in sink.messages if recipient == "smtp_ok_" + suffix + "@example.test"]
    assert len(mine) == 2, len(mine)
    assert int(sql(f"SELECT count(*) FROM notifications WHERE user_id={recipient_id} AND kind='submission_reminder'")) == 2
    assert recipient.request("GET", "/api/notifications/unread-count")["count"] == 1
    latest = recipient.request("GET", "/api/notifications?limit=1")
    assert latest["next_before"] == latest["items"][0]["id"]
    older = recipient.request("GET", f"/api/notifications?limit=1&before={latest['next_before']}")
    assert older["items"][0]["id"] == notification["id"] and older["next_before"] is None
    recipient.request("POST", "/api/notifications/read-all", expected=204)
    assert recipient.request("GET", "/api/notifications/unread-count")["count"] == 0
    assert all(n["read_at"] is not None for n in recipient.request("GET", "/api/notifications")["items"])
    print("PASS in-app notifications: delivery, SMTP failure independence, unread/read-all, pagination, ownership, resend", flush=True)
    print("PASS SMTP: preview snapshot, local delivery, failure/retry, idempotency, immediate resend, employed exclusion", flush=True)


def exercise_archive_filters():
    from admin_api_testlib import Client, CURRENT_MONTH, new_key, seed_user, sql

    suffix = uuid.uuid4().hex[:8]
    staff = Client.sql_session(seed_user("filter_staff_" + suffix, role="accountant"))
    students = [Client.sql_session(seed_user(f"filter_{suffix}_{i}")) for i in range(2)]
    ids = [student.me["id"] for student in students]
    initial = [student.create_finalize() for student in students]
    monthly = [student.create_finalize(kind="monthly") for student in students]
    review = lambda submission, body: staff.request("POST", f"/api/admin/submissions/{submission['id']}/review", body, key=new_key())
    review(monthly[0], {"status": "approved"})
    review(initial[1], {"status": "approved"})
    endpoint = f"/api/admin/archive/{CURRENT_MONTH}"
    for query in ("status=draft", "kind=unknown", "status=", "unexpected=true",
                  "status=approved,draft", "kind=initial,unknown", "status=approved,", "kind=all,monthly"):
        staff.request("GET", endpoint + "?" + query, expected=400)
    approved = staff.request("GET", endpoint + "?status=approved")["rows"]
    chosen = {row["user_id"]: row for row in approved if row["user_id"] in ids}
    assert len(chosen[ids[0]]["files"]) == 1 and chosen[ids[0]]["kinds"] == ["monthly"]
    assert len(chosen[ids[1]]["files"]) == 4 and chosen[ids[1]]["kinds"] == ["initial"]
    for kind, expected in (("initial", ids[1]), ("monthly", ids[0])):
        rows = staff.request("GET", endpoint + "?status=approved&kind=" + kind)["rows"]
        assert [r["user_id"] for r in rows if r["user_id"] in ids] == [expected]
    # A status change after preview must not silently broaden the export.
    review(monthly[1], {"status": "revision_requested", "review_comment": "필터 재검증 샘플"})
    stale = {"user_ids": [ids[1]], "include_base_docs": False, "include_previous": False,
             "expected_pdf_count": 1, "filters": {"status": "pending_review", "kind": "monthly"}}
    staff.request("POST", endpoint + "/exports", stale, expected=409, key=new_key())
    staff.request("POST", endpoint + "/exports", {**stale, "filters": {"status": "draft"}}, expected=400, key=new_key())
    payload = {"user_ids": ids, "include_base_docs": False, "include_previous": False,
               "expected_pdf_count": 5, "filters": {"status": "approved"}}
    key = new_key()
    made = staff.request("POST", endpoint + "/exports", payload, expected=202, key=key)
    staff.request("POST", endpoint + "/exports", {**payload, "filters": {"status": "approved", "kind": "initial"}}, expected=409, key=key)
    job = endpoint + "/exports/" + made["job_id"]
    eventually(lambda: staff.request("GET", job), lambda r: r["status"] == "ready")
    with zipfile.ZipFile(io.BytesIO(staff.request("GET", job + "/file"))) as zipped:
        assert len([n for n in zipped.namelist() if n.endswith(".pdf")]) == 5
        csv_name = next(n for n in zipped.namelist() if n.endswith("제출목록.csv"))
        entries = list(csv.DictReader(io.StringIO(zipped.read(csv_name).decode("utf-8-sig"))))
        assert len(entries) == 5 and all(row["검토 상태"] == "서류 승인" for row in entries), entries

    # Multiple checkbox choices OR within a group, AND across groups, in list and ZIP.
    filters = {"status": "revision_requested,approved", "kind": "monthly,initial"}
    rows = staff.request("GET", endpoint + "?status=" + filters["status"] + "&kind=" + filters["kind"])["rows"]
    chosen = {row["user_id"]: row for row in rows if row["user_id"] in ids}
    assert len(chosen[ids[0]]["files"]) == 1 and chosen[ids[0]]["kinds"] == ["monthly"]
    assert len(chosen[ids[1]]["files"]) == 5 and chosen[ids[1]]["kinds"] == ["initial", "monthly"]
    sql(f"UPDATE archive_export_jobs SET created_at=now()-interval '301 seconds' WHERE id='{made['job_id']}'")
    payload = {**payload, "expected_pdf_count": 6, "filters": filters}
    key = new_key()
    made = staff.request("POST", endpoint + "/exports", payload, expected=202, key=key)
    reordered = {"status": "approved,revision_requested,approved", "kind": "initial,monthly"}
    replay = staff.request("POST", endpoint + "/exports", {**payload, "filters": reordered}, expected=202, key=key)
    assert replay["job_id"] == made["job_id"]
    job = endpoint + "/exports/" + made["job_id"]
    eventually(lambda: staff.request("GET", job), lambda r: r["status"] == "ready")
    with zipfile.ZipFile(io.BytesIO(staff.request("GET", job + "/file"))) as zipped:
        assert len([n for n in zipped.namelist() if n.endswith(".pdf")]) == 6
        csv_name = next(n for n in zipped.namelist() if n.endswith("제출목록.csv"))
        entries = list(csv.DictReader(io.StringIO(zipped.read(csv_name).decode("utf-8-sig"))))
        assert len(entries) == 6 and sum(row["검토 상태"] == "서류 승인" for row in entries) == 5, entries

    # A supplement filter keeps inherited originals, and only that chain's older files.
    review(initial[0], {"status": "revision_requested", "review_comment": "통장 보완 샘플", "revision_doc_types": ["bankbook"]})
    students[0].create_finalize(kind="supplement", parent_id=initial[0]["id"], doc_types=["bankbook"])
    rows = staff.request("GET", endpoint + "?kind=supplement&status=resubmitted")["rows"]
    row = next(row for row in rows if row["user_id"] == ids[0])
    assert row["kinds"] == ["supplement"] and len(row["files"]) == 4 and row["previous"] == ["bankbook"], row
    sql(f"UPDATE archive_export_jobs SET created_at=now()-interval '301 seconds' WHERE id='{made['job_id']}'")
    payload = {"user_ids": [ids[0]], "include_base_docs": False, "include_previous": True,
               "expected_pdf_count": 5, "filters": {"kind": "supplement", "status": "resubmitted"}}
    made = staff.request("POST", endpoint + "/exports", payload, expected=202, key=new_key())
    job = endpoint + "/exports/" + made["job_id"]
    eventually(lambda: staff.request("GET", job), lambda r: r["status"] == "ready")
    with zipfile.ZipFile(io.BytesIO(staff.request("GET", job + "/file"))) as zipped:
        assert len([n for n in zipped.namelist() if n.endswith(".pdf")]) == 5
        assert len([n for n in zipped.namelist() if "이전제출본" in n]) == 1
    print("PASS archive filters: mixed-chain approval scope, combined kinds, stale selection, idempotency, inherited supplement files", flush=True)


def exercise_bulk_archive_retry():
    from admin_api_testlib import Client, CURRENT_MONTH, PREVIOUS_MONTH, new_key, seed_user, sql

    suffix = uuid.uuid4().hex[:8]
    staff_id = seed_user("bulk_staff_" + suffix, role="accountant")
    staff = Client.sql_session(staff_id)
    ids = []
    expected_hours = ["0", "0", "40", "40", "80", "확인 불가", "확인 불가", "확인 불가", "80"]
    for index in range(9):
        student_id = seed_user(f"bulk_{suffix}_{index}")
        ids.append(student_id)
        student = Client.sql_session(student_id)
        student.create_finalize(kind="initial" if index < 8 else "monthly")
        seconds = [0, 143999, 144000, 287999, 288000, None, 288000, 288000, 400000][index]
        if seconds is not None:
            hours_month = PREVIOUS_MONTH if index == 7 else CURRENT_MONTH
            result_status = "'on_hold'" if index == 6 else "NULL"
            sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds,result_status) VALUES ({student_id},'{hours_month}-01',{seconds},{result_status})")
    endpoint = f"/api/admin/archive/{CURRENT_MONTH}/exports"
    payload = {"user_ids": ids, "include_base_docs": False, "include_previous": False, "expected_pdf_count": 33}
    key = new_key()
    made = staff.request("POST", endpoint, payload, expected=202, key=key)
    # Updating the aggregate after the request must not alter this export's snapshot.
    sql(f"UPDATE time_requirements SET recognized_seconds=288000 WHERE user_id={ids[0]} AND target_month='{CURRENT_MONTH}-01'")
    job = endpoint + "/" + made["job_id"]
    status = eventually(lambda: staff.request("GET", job), lambda r: r["status"] == "ready")
    assert status["student_count"] == 9 and status["pdf_count"] == 33, status
    data = staff.request("GET", job + "/file")
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        pdfs = [n for n in zipped.namelist() if n.endswith(".pdf")]
        assert len(pdfs) == 33 and len({n.rsplit("/", 1)[0] for n in pdfs}) == 9
        csv_name = next(n for n in zipped.namelist() if n.endswith("제출목록.csv"))
        assert len(zipped.read(csv_name).decode("utf-8-sig").splitlines()) == 34
        table = csv.DictReader(io.StringIO(zipped.read(csv_name).decode("utf-8-sig")))
        assert table.fieldnames == ["이름", "login", "제출 종류", "파일 종류", "접수 시각", "검토 상태", "학습 시간"]
        rows = list(table)
        for index, expected in enumerate(expected_hours):
            person = [row for row in rows if row["login"] == f"bulk_{suffix}_{index}"]
            assert len(person) == (4 if index < 8 else 1), person
            assert {row["학습 시간"] for row in person} == {expected}, person

    # Only synthetic test DB timestamps are moved; deployment jobs/audit stay intact.
    sql(f"UPDATE archive_export_jobs SET created_at=now()-interval '295 seconds' WHERE id='{made['job_id']}'")
    next_key = new_key()
    limited = staff.request("POST", endpoint, payload, expected=429, key=next_key)
    assert limited["error"]["code"] == "RATE_LIMITED", limited
    retry_after = int(staff.last_headers["Retry-After"])
    assert 1 <= retry_after <= 5, staff.last_headers
    assert staff.request("POST", endpoint, payload, expected=202, key=key)["job_id"] == made["job_id"]
    assert int(sql(f"SELECT count(*) FROM archive_export_jobs WHERE created_by={staff_id}")) == 1
    # Wait exactly the server's remaining interval, then replay the rejected key.
    time.sleep(retry_after)
    second = staff.request("POST", endpoint, payload, expected=202, key=next_key)
    second_job = endpoint + "/" + second["job_id"]
    eventually(lambda: staff.request("GET", second_job), lambda r: r["status"] == "ready")
    with zipfile.ZipFile(io.BytesIO(staff.request("GET", second_job + "/file"))) as zipped:
        csv_name = next(n for n in zipped.namelist() if n.endswith("제출목록.csv"))
        rows = list(csv.DictReader(io.StringIO(zipped.read(csv_name).decode("utf-8-sig"))))
        assert {row["학습 시간"] for row in rows if row["login"] == f"bulk_{suffix}_0"} == {"80"}
    assert staff.request("GET", job + "/file") == data
    assert int(sql(f"SELECT count(*) FROM archive_export_jobs WHERE created_by={staff_id}")) == 2
    print("PASS bulk archive: 9 students / 33 PDFs + CSV hours (40/80 boundaries, unknown/on-hold, selected month, immutable snapshot), accurate Retry-After and replay", flush=True)


def exercise_notice_audiences(sink):
    from admin_api_testlib import Client, CURRENT_MONTH, PREVIOUS_MONTH, new_key, seed_user, sql
    from email import policy
    from email.parser import BytesParser

    endpoint = "/api/admin/notices/submission-reminder"
    suffix = uuid.uuid4().hex[:8]
    staff = Client.sql_session(seed_user("hours_ops_" + suffix, role="operator"))
    fixtures = []
    for index, seconds in enumerate([0, 143999, 144000, 287999, 288000, None, 0, 288000, 288000]):
        # One transient SMTP failure can be retried only while still in this band.
        login = ("smtp_fail_hours_" if index == 8 else f"hours_{index}_") + suffix
        uid = seed_user(login, employed=index == 7)
        sql(f"INSERT INTO submissions(id,user_id,kind,target_month,status,submitted_at,required_doc_types) VALUES ('{new_key()}',{uid},'initial','{PREVIOUS_MONTH}-01','approved',now(),ARRAY['id_card','resident_abstract','bankbook','employment_insurance'])")
        if seconds is not None:
            status = "'on_hold'" if index == 6 else "NULL"
            sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds,result_status) VALUES ({uid},'{PREVIOUS_MONTH}-01',{seconds},{status})")
        fixtures.append((uid, login))
    ids = {uid for uid, _ in fixtures}
    previews = {}
    groups = [("under_40", 0, [0, 1]), ("hours_40_80", 40, [2, 3]), ("at_least_80", 80, [4, 8])]
    for audience, hours, indexes in groups:
        preview = staff.request("GET", f"{endpoint}?month={PREVIOUS_MONTH}&audience={audience}")
        previews[audience] = preview
        assert preview["audience"] == audience and preview["closes_at"] is None, preview
        assert preview["hours_unknown"] >= 2, preview
        assert {target["user_id"] for target in preview["targets"]} & ids == {fixtures[i][0] for i in indexes}, preview
        for target in preview["targets"]:
            assert target["study_hours"] == hours and target["as_of"], target
        # Same IDs/count in another audience still require a matching preview.
        body = {"month": PREVIOUS_MONTH, "audience": audience, "expected_count": len(preview["targets"]), "target_fingerprint": preview["target_fingerprint"]}
        if audience == "hours_40_80":
            stale = dict(body)
            sql(f"UPDATE time_requirements SET recognized_seconds=143999 WHERE user_id={fixtures[2][0]} AND target_month='{PREVIOUS_MONTH}-01'")
            sql(f"UPDATE time_requirements SET recognized_seconds=144000 WHERE user_id={fixtures[1][0]} AND target_month='{PREVIOUS_MONTH}-01'")
            staff.request("POST", endpoint, stale, expected=409, key=new_key())
            sql(f"UPDATE time_requirements SET recognized_seconds=144000 WHERE user_id={fixtures[2][0]} AND target_month='{PREVIOUS_MONTH}-01'")
            sql(f"UPDATE time_requirements SET recognized_seconds=143999 WHERE user_id={fixtures[1][0]} AND target_month='{PREVIOUS_MONTH}-01'")
        key = new_key()
        sent = staff.request("POST", endpoint, body, key=key)
        assert staff.request("POST", endpoint, body, key=key) == sent
        staff.request("POST", endpoint, {**body, "audience": "unsubmitted"}, expected=409, key=key)
        status_path = f"/api/admin/notices/{sent['notice_id']}"
        completed = eventually(lambda: staff.request("GET", status_path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
        assert completed["audience"] == audience
        for index in indexes:
            uid, login = fixtures[index]
            inbox = Client.sql_session(uid).request("GET", "/api/notifications")["items"]
            assert len(inbox) == 1 and inbox[0]["kind"] == "study_hours_notice", inbox
            assert inbox[0]["data"] == {"month": PREVIOUS_MONTH, "study_hours": hours}, inbox
        if audience == "at_least_80":
            failed = fixtures[8][0]
            assert next(r for r in completed["recipients"] if r["user_id"] == failed)["email_status"] == "failed"
            sql(f"UPDATE time_requirements SET recognized_seconds=287999 WHERE user_id={failed} AND target_month='{PREVIOUS_MONTH}-01'")
            retried = staff.request("POST", status_path + "/retry", key=new_key())
            assert retried["service"]["sent"] == 0
            skipped = next(r for r in staff.request("GET", status_path)["recipients"] if r["user_id"] == failed)
            assert skipped["email_status"] == "skipped" and skipped["last_error_code"] == "no_longer_target", skipped
    for index in [5, 6, 7]:
        assert Client.sql_session(fixtures[index][0]).request("GET", "/api/notifications")["items"] == []
    student = Client.sql_session(fixtures[0][0])
    student.request("GET", endpoint + "?audience=under_40", expected=403)
    preview = previews["under_40"]
    student.request("POST", endpoint, {"month": PREVIOUS_MONTH, "audience": "under_40", "expected_count": len(preview["targets"]), "target_fingerprint": preview["target_fingerprint"]}, expected=403, key=new_key())
    staff.request("GET", endpoint + "?audience=typo", expected=400)
    staff.request("GET", f"{endpoint}?month={PREVIOUS_MONTH}&audience=unsubmitted", expected=422)
    future = sql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul' + interval '1 month','YYYY-MM')")
    staff.request("GET", f"{endpoint}?month={future}&audience=under_40", expected=400)
    with sink.lock:
        messages = [BytesParser(policy=policy.default).parsebytes(message) for recipient, message in sink.messages if recipient == fixtures[0][1] + "@example.test"]
    assert len(messages) == 1 and "지원금 시간 요건 안내" in str(messages[0]["Subject"])
    content = messages[0].get_content()
    assert "40시간 미만" in content and "12시간" in content and "PDF" not in content, content
    print("PASS notice audiences: exact 40/80 boundaries, submitted recipients, unknown/employed exclusion, stale identities, replay, SMTP, changed-band retry, closed/past months and RBAC", flush=True)


def exercise_notice_channels(sink):
    from admin_api_testlib import Client, new_key, seed_user, sql

    suffix = uuid.uuid4().hex[:8]
    staff = Client.sql_session(seed_user("channel_ops_" + suffix, role="operator"))
    login = "smtp_fail_channel_" + suffix
    uid = seed_user(login)
    month = sql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul' - interval '2 months','YYYY-MM')")
    sql(f"INSERT INTO submissions(id,user_id,kind,target_month,status,submitted_at,required_doc_types) VALUES ('{new_key()}',{uid},'initial','{month}-01','approved',now(),ARRAY['id_card','resident_abstract','bankbook','employment_insurance'])")
    sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds) VALUES ({uid},'{month}-01',144000)")
    student = Client.sql_session(uid)
    endpoint = "/api/admin/notices/submission-reminder"
    preview = staff.request("GET", f"{endpoint}?month={month}&audience=hours_40_80")
    assert [target["user_id"] for target in preview["targets"]] == [uid], preview
    base = {"month": month, "audience": "hours_40_80", "expected_count": 1, "target_fingerprint": preview["target_fingerprint"]}
    for invalid in ["", "sms", [], None]:
        staff.request("POST", endpoint, {**base, "channel": invalid}, expected=400, key=new_key())
    def inbox():
        return student.request("GET", "/api/notifications")["items"]
    for index, channel in enumerate(["service", "email", "both"]):
        body = {**base, "channel": channel}
        key = new_key()
        sent = staff.request("POST", endpoint, body, key=key)
        assert sent["channel"] == channel
        assert staff.request("POST", endpoint, body, key=key) == sent
        staff.request("POST", endpoint, {**body, "channel": "email" if channel == "service" else "service"}, expected=409, key=key)
        notice_id = sent["notice_id"]
        path = f"/api/admin/notices/{notice_id}"
        progress = eventually(lambda: staff.request("GET", path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
        assert progress["channel"] == channel
        recipient = progress["recipients"][0]
        assert len(inbox()) == (2 if channel == "both" else 1), inbox()
        assert progress["service"]["sent"] == (0 if channel == "email" else 1), progress
        assert sql(f"SELECT notification_id IS NULL FROM admin_notice_recipients WHERE notice_id={notice_id}") == ("t" if channel == "email" else "f")
        if channel == "service":
            assert all(count == 0 for count in progress["email"].values()), progress
            assert recipient["email_status"] == "not_requested" and recipient["email_attempts"] == 0 and recipient["email_recipient"] is None and recipient["last_error_code"] is None, recipient
            staff.request("POST", path + "/retry", expected=409, key=new_key())
            with sink.lock:
                assert not any(address == login + "@example.test" for address, _ in sink.messages)
        elif channel == "email":
            assert progress["email"]["failed"] == 1 and progress["service"] == {"sent": 0, "failed": 0}, progress
            retry_key = new_key()
            retry = staff.request("POST", path + "/retry", key=retry_key)
            assert staff.request("POST", path + "/retry", key=retry_key) == retry
            completed = eventually(lambda: staff.request("GET", path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
            assert completed["email"]["sent"] == 1 and completed["service"]["sent"] == 0, completed
            assert len(inbox()) == 1
        else:
            assert progress["email"]["sent"] == 1, progress
    # The service-only record cannot be picked up by the SMTP worker later.
    with sink.lock:
        messages = [message for address, message in sink.messages if address == login + "@example.test"]
    assert len(messages) == 2, len(messages)
    assert int(sql(f"SELECT count(*) FROM notifications WHERE user_id={uid}")) == 2
    print("PASS notice channels: service only without email/outbox failure, email only without app notification, both, exact replay, changed-channel rejection and email-only retry", flush=True)



def exercise_notice_composer(sink):
    from admin_api_testlib import Client, new_key, seed_user, sql
    from email import policy
    from email.parser import BytesParser

    endpoint = "/api/admin/notices/submission-reminder"
    suffix = uuid.uuid4().hex[:8]
    staff_id = seed_user("compose_ops_" + suffix, role="operator")
    staff = Client.sql_session(staff_id)
    month = sql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul' - interval '3 months','YYYY-MM')")
    fixtures = []
    for index, seconds in enumerate([0, 144000, 288000, None, 288000, None]):
        login = ("smtp_fail_composed_" if index == 1 else f"composed_{index}_") + suffix
        uid = seed_user(login, employed=index == 4)
        if index != 5:
            sql(f"INSERT INTO submissions(id,user_id,kind,target_month,status,submitted_at,required_doc_types) VALUES ('{new_key()}',{uid},'initial','{month}-01'::date - interval '1 month','approved',now(),ARRAY['id_card','resident_abstract','bankbook','employment_insurance'])")
        if seconds is not None:
            sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds) VALUES ({uid},'{month}-01',{seconds})")
        if index == 2:
            sql(f"INSERT INTO submissions(id,user_id,kind,target_month,status,submitted_at,required_doc_types) VALUES ('{new_key()}',{uid},'monthly','{month}-01','pending_review',now(),ARRAY['employment_insurance'])")
        fixtures.append((uid, login))
    ids = {uid for uid, _ in fixtures}
    def preview(groups):
        return staff.request("GET", f"{endpoint}?month={month}&audiences={','.join(groups)}")
    def target_ids(p):
        return {t["user_id"] for t in p["targets"]}
    unsubmitted = preview(["unsubmitted"])
    assert target_ids(unsubmitted) & ids == {fixtures[i][0] for i in [0, 1, 3]}
    eligible = preview(["eligible"])
    assert target_ids(eligible) == {fixtures[i][0] for i in [1, 2]}
    union = preview(["unsubmitted", "eligible"])
    assert target_ids(union) == target_ids(unsubmitted) | target_ids(eligible)
    all_students = preview(["all"])
    assert ids <= target_ids(all_students) and staff_id not in target_ids(all_students)
    assert all_students["employed_excluded"] == 0
    assert next(t for t in all_students["targets"] if t["user_id"] == fixtures[4][0])["employed"] is True
    selected = preview(["eligible", "hours_40_80", "at_least_80"])
    assert len(selected["targets"]) == 2
    assert selected["target_fingerprint"] == preview(["hours_40_80", "eligible", "eligible", "at_least_80"])["target_fingerprint"]
    title = "[운영팀] 직접 작성한 알림"
    content = "첫 번째 문장\n\n동일한 문장\n동일한 문장\n<b>HTML이 아닌 본문</b>"
    body = {"month": month, "audiences": selected["audiences"], "title": title, "body": content, "channel": "both", "expected_count": 2, "target_fingerprint": selected["target_fingerprint"]}
    for fields in [{"title": " "}, {"title": "x" * 121}, {"title": "hello\r\nBcc:bad@example.test"}, {"body": "\n"}, {"body": "x" * 5001}, {"body": "bad\x00body"}, {"audiences": []}, {"audiences": ["typo"]}]:
        staff.request("POST", endpoint, {**body, **fields}, expected=400, key=new_key())
    staff.request("GET", endpoint + "?audiences=", expected=400)
    student = Client.sql_session(fixtures[1][0])
    student.request("GET", endpoint + "?audiences=all", expected=403)
    student.request("POST", endpoint, body, expected=403, key=new_key())
    # Same selection with changed membership cannot use the previous preview.
    sql(f"UPDATE users SET employed=true WHERE id={fixtures[1][0]}")
    staff.request("POST", endpoint, body, expected=409, key=new_key())
    sql(f"UPDATE users SET employed=false WHERE id={fixtures[1][0]}")
    key = new_key()
    sent = staff.request("POST", endpoint, body, key=key)
    assert sent["title"] == title and sent["body"] == content and sent["service"]["sent"] == 2
    assert staff.request("POST", endpoint, body, key=key) == sent
    staff.request("POST", endpoint, {**body, "title": "changed"}, expected=409, key=key)
    path = f"/api/admin/notices/{sent['notice_id']}"
    progress = eventually(lambda: staff.request("GET", path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    assert progress["email"]["sent"] == 1 and progress["email"]["failed"] == 1, progress
    assert len(progress["recipients"]) == 2
    for i in [1, 2]:
        inbox = Client.sql_session(fixtures[i][0]).request("GET", "/api/notifications")["items"]
        assert len(inbox) == 1 and inbox[0]["kind"] == "admin_notice", inbox
        assert inbox[0]["data"] == {"month": month, "title": title, "body": content}, inbox
    # Retry uses the stored composition even if a person moves between selected bands.
    sql(f"UPDATE time_requirements SET recognized_seconds=288000 WHERE user_id={fixtures[1][0]} AND target_month='{month}-01'")
    retry_key = new_key()
    retry = staff.request("POST", path + "/retry", key=retry_key)
    assert retry["service"]["sent"] == 0 and retry["title"] == title
    assert staff.request("POST", path + "/retry", key=retry_key) == retry
    progress = eventually(lambda: staff.request("GET", path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    assert progress["email"]["sent"] == 2
    assert len(student.request("GET", "/api/notifications")["items"]) == 1
    with sink.lock:
        messages = [BytesParser(policy=policy.default).parsebytes(data) for address, data in sink.messages if address in {fixtures[i][1] + "@example.test" for i in [1, 2]}]
    assert len(messages) == 2
    for message in messages:
        assert str(message["Subject"]) == title
        assert message.get_content().replace("\r\n", "\n").rstrip("\n") == content
    # All means all students, including initial-registration and employed accounts.
    all_students = preview(["all"])
    all_body = {**body, "channel": "service", "audiences": ["all"], "expected_count": len(all_students["targets"]), "target_fingerprint": all_students["target_fingerprint"]}
    sent_all = staff.request("POST", endpoint, all_body, key=new_key())
    assert sent_all["service"]["sent"] == len(all_students["targets"])
    for i in [4, 5]:
        inbox = Client.sql_session(fixtures[i][0]).request("GET", "/api/notifications")["items"]
        assert len(inbox) == 1 and inbox[0]["data"]["body"] == content
    print("PASS composed notices: custom content, union/dedup, all students, validation/RBAC, stale preview, idempotency, plain SMTP and content-preserving retry", flush=True)


def exercise_employed_notices(sink):
    from admin_api_testlib import Client, new_key, seed_user, sql

    endpoint = "/api/admin/notices/submission-reminder"
    suffix = uuid.uuid4().hex[:8]
    staff_id = seed_user("employed_ops_" + suffix, role="operator", employed=True)
    staff = Client.sql_session(staff_id)
    month = sql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul' - interval '4 months','YYYY-MM')")
    fixtures = []
    for index, seconds in enumerate([0, None, 288000, 288000, None]):
        login = (f"smtp_fail_emp_{index}_" if index < 2 else f"emp_notice_{index}_") + suffix
        uid = seed_user(login, employed=index < 3)
        if index not in [1, 4]:
            sql(f"INSERT INTO submissions(id,user_id,kind,target_month,status,submitted_at,required_doc_types) VALUES ('{new_key()}',{uid},'initial','{month}-01','approved',now(),ARRAY['id_card','resident_abstract','bankbook','employment_insurance'])")
        if seconds is not None:
            sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds) VALUES ({uid},'{month}-01',{seconds})")
        fixtures.append((uid, login))
    ids = {uid for uid, _ in fixtures}
    def preview(groups):
        return staff.request("GET", f"{endpoint}?month={month}&audiences={','.join(groups)}")
    def target_ids(p):
        return {t["user_id"] for t in p["targets"]}
    employed = preview(["employed"])
    assert target_ids(employed) & ids == {fixtures[i][0] for i in [0, 1, 2]}
    assert staff_id not in target_ids(employed) and employed["employed_excluded"] == 0
    assert all(t["employed"] for t in employed["targets"])
    hours = preview(["at_least_80"])
    assert target_ids(hours) & ids == {fixtures[3][0]}
    selected = preview(["employed", "at_least_80"])
    assert target_ids(selected) == target_ids(employed) | target_ids(hours)
    assert len(selected["targets"]) == len(target_ids(selected))
    assert selected["target_fingerprint"] == preview(["employed", "at_least_80", "employed"])["target_fingerprint"]
    assert target_ids(preview(["all", "employed"])) == target_ids(preview(["all"]))
    staff.request("GET", endpoint + "?audience=employed", expected=400)
    body = {"month": month, "audiences": selected["audiences"], "title": "취업자 안내", "body": "취업 상태를 확인해주세요.", "channel": "both", "expected_count": len(selected["targets"]), "target_fingerprint": selected["target_fingerprint"]}
    student = Client.sql_session(fixtures[0][0])
    student.request("GET", endpoint + "?audiences=employed", expected=403)
    student.request("POST", endpoint, body, expected=403, key=new_key())
    # Swap employment between two users without changing the total recipient count.
    sql(f"UPDATE users SET employed=false WHERE id={fixtures[0][0]}; UPDATE users SET employed=true WHERE id={fixtures[4][0]}")
    assert len(preview(["employed", "at_least_80"])["targets"]) == body["expected_count"]
    staff.request("POST", endpoint, body, expected=409, key=new_key())
    sql(f"UPDATE users SET employed=true WHERE id={fixtures[0][0]}; UPDATE users SET employed=false WHERE id={fixtures[4][0]}")
    key = new_key()
    sent = staff.request("POST", endpoint, body, key=key)
    assert sent["audiences"] == selected["audiences"] and sent["employed_excluded"] == 0
    assert sent["service"]["sent"] == body["expected_count"]
    assert staff.request("POST", endpoint, body, key=key) == sent
    path = f"/api/admin/notices/{sent['notice_id']}"
    progress = eventually(lambda: staff.request("GET", path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    assert len(progress["recipients"]) == len(target_ids(selected))
    for i in [0, 1, 2, 3]:
        inbox = Client.sql_session(fixtures[i][0]).request("GET", "/api/notifications")["items"]
        assert len(inbox) == 1 and inbox[0]["data"]["title"] == body["title"], inbox
    assert Client.sql_session(fixtures[4][0]).request("GET", "/api/notifications")["items"] == []
    for i in [0, 1]:
        assert next(r for r in progress["recipients"] if r["user_id"] == fixtures[i][0])["email_status"] == "failed"
    # A failed recipient who is no longer employed or in a selected hours band is skipped.
    sql(f"UPDATE users SET employed=false WHERE id={fixtures[0][0]}")
    retry = staff.request("POST", path + "/retry", key=new_key())
    assert retry["service"]["sent"] == 0
    progress = eventually(lambda: staff.request("GET", path), lambda r: r["email"]["pending"] + r["email"]["sending"] == 0)
    skipped = next(r for r in progress["recipients"] if r["user_id"] == fixtures[0][0])
    assert skipped["email_status"] == "skipped" and skipped["last_error_code"] == "no_longer_target"
    assert next(r for r in progress["recipients"] if r["user_id"] == fixtures[1][0])["email_status"] == "sent"
    assert len(Client.sql_session(fixtures[1][0]).request("GET", "/api/notifications")["items"]) == 1
    with sink.lock:
        delivered = [address for address, _ in sink.messages if address in {login + "@example.test" for _, login in fixtures}]
    assert fixtures[0][1] + "@example.test" not in delivered
    assert delivered.count(fixtures[1][1] + "@example.test") == 1
    print("PASS employed notices: current student employment, no registration/hour requirement, union/dedup, RBAC, stale membership, app/email delivery and retry revalidation", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    args = parser.parse_args()
    from urllib.parse import urlparse
    assert urlparse(os.environ["DATABASE_URL"]).path == "/otus_admin_test", "isolated test DB required"
    with tempfile.TemporaryDirectory(prefix="otus-admin-api-") as directory, SmtpSink() as sink:
        root = Path(directory)
        uploads = root / "uploads"
        uploads.mkdir()
        threading.Thread(target=sink.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://localhost:{port}"
        key = base64.b64encode(bytes([7]) * 32).decode()
        env = {**os.environ, "BIND_ADDR": f"127.0.0.1:{port}", "APP_ORIGIN": origin,
               "APP_ORIGINS": origin, "DEMO_LOGIN_ENABLED": "true", "UPLOAD_DIR": str(uploads),
               "FORTY_TWO_CLIENT_ID": "", "CLAMAV_ADDR": "", "BANK_ACCOUNT_KEY": key,
               "FILE_ENCRYPTION_KEY": base64.b64encode(bytes([8]) * 32).decode(),
               "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(sink.server_address[1]),
               "SMTP_TLS": "none", "SMTP_FROM": "OTUS <noreply@example.test>", "MAIL_RECIPIENT_DOMAIN": "example.test",
               "EXPORT_REQUEST_INTERVAL_SECONDS": "300", "TEST_BASE_URL": origin, "TEST_ORIGIN": origin}
        # The temporary cwd has no .env; the deployed credentials never enter this process.
        os.environ.update(env)
        from admin_api_testlib import sql
        counts_query = """SELECT row_to_json(c) FROM (SELECT
            (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM submissions) AS submissions,
            (SELECT count(*) FROM submission_files) AS files,
            (SELECT count(*) FROM submission_events) AS events) c"""
        before = None
        for _ in range(2):
            seeded = subprocess.run([str(Path(args.binary).resolve()), "seed"], cwd=root, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            if seeded.returncode:
                raise RuntimeError(seeded.stdout)
            after = sql(counts_query)
            if before is not None:
                assert before == after, "re-running seed duplicated users, submissions, files or events"
            before = after
        log_path = root / "backend.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen([str(Path(args.binary).resolve())], cwd=root, env=env, stdout=log, stderr=log)
            try:
                for _ in range(200):
                    if process.poll() is not None:
                        raise RuntimeError(log_path.read_text())
                    try:
                        urllib.request.urlopen(origin + "/api/health", timeout=1).close()
                        break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("backend did not start")
                exercise_seed()
                subprocess.run([sys.executable, str(Path(__file__).with_name("admin-review-smoke.py"))], env=env, check=True)
                exercise_archive_and_email(sink, uploads)
                exercise_archive_filters()
                exercise_bulk_archive_retry()
                exercise_notice_audiences(sink)
                from admin_periods_test import exercise_periods
                exercise_periods(sink)
                exercise_notice_channels(sink)
                exercise_notice_composer(sink)
                exercise_employed_notices(sink)
                print("PASS all six admin API features", flush=True)
            except BaseException:
                print(log_path.read_text()[-12000:], file=sys.stderr)
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                sink.shutdown()


if __name__ == "__main__":
    main()
