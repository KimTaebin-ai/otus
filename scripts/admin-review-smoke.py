#!/usr/bin/env python3
"""Exercise review transactions against an already running isolated test backend.

Run with DATABASE_URL (database otus_admin_test), TEST_BASE_URL and, if needed,
TEST_ORIGIN. Only generated fixtures are used; this script never starts services
or reads backend/.env. Fixtures are retained for inspection after a failure.
"""

from concurrent.futures import ThreadPoolExecutor
import threading
from pathlib import Path
import urllib.parse
import uuid

from admin_api_testlib import (
    CURRENT_MONTH, PREVIOUS_MONTH, INITIAL_DOC_TYPES, Client,
    new_key, open_cycle, quote, seed_user, sql,
)


def error(client, method, path, status, code, body=None, key=None):
    result = client.request(method, path, body, expected=status, key=key)
    assert result["error"]["code"] == code, result
    return result


def review(client, submission_id, status="approved", comment=None, docs=None, key=None, expected=200):
    body = {"status": status}
    if comment is not None:
        body["review_comment"] = comment
    if docs is not None:
        body["revision_doc_types"] = docs
    result = client.request(
        "POST", f"/api/admin/submissions/{submission_id}/review", body,
        expected=expected, key=key or new_key(),
    )
    return result


def student_row(staff, login, status=None):
    query = {"month": CURRENT_MONTH, "query": login}
    if status:
        query["status"] = status
    rows = staff.request("GET", "/api/admin/submissions?" + urllib.parse.urlencode(query))["items"]
    assert len(rows) == 1 and rows[0]["user"]["login"] == login, rows
    return rows[0]


def queue_ids(staff):
    ids, cursor = [], None
    for _ in range(100):
        query = {"month": CURRENT_MONTH, "limit": 1}
        if cursor:
            query["after"] = cursor
        page = staff.request("GET", "/api/admin/review-queue?" + urllib.parse.urlencode(query))
        ids.extend(item["id"] for item in page["items"])
        cursor = page["next_after"]
        if not cursor:
            assert len(ids) == len(set(ids)), "cursor pagination repeated a submission"
            return ids
    raise AssertionError("review queue pagination did not terminate")


def decision_count(submission_id):
    return int(sql(
        "SELECT count(*) FROM admin_review_decisions "
        f"WHERE submission_id={quote(submission_id)};"
    ))


def notification_count(submission_id, kind=None):
    condition = f" AND kind={quote(kind)}" if kind else ""
    return int(sql(
        "SELECT count(*) FROM notifications "
        f"WHERE data::jsonb->>'submission_id'={quote(submission_id)}{condition};"
    ))


def concurrent_decisions(first, second):
    barrier = threading.Barrier(2)

    def run(action):
        barrier.wait(timeout=5)
        return action()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, action) for action in (first, second)]
        return [future.result(timeout=35) for future in futures]


def attempt(client, submission_id, key, status="approved"):
    result = review(
        client, submission_id, status,
        comment="동시 검토에서 보완 요청" if status == "revision_requested" else None,
        docs=["employment_insurance"] if status == "revision_requested" else None,
        key=key, expected=(200, 409),
    )
    return client.last_status, result


def run():
    assert sql("SELECT current_database();") == "otus_admin_test"
    open_cycle()
    prefix = "ar_" + uuid.uuid4().hex[:8]
    logins = {name: f"{prefix}_{name}" for name in ("ops", "acct", "admin", "alice", "bob", "carol", "empty", "employed")}
    ids = {
        name: seed_user(login, {"ops": "operator", "acct": "accountant", "admin": "admin"}.get(name, "student"), name == "employed")
        for name, login in logins.items()
    }
    # A SQL-created session proves the HTTP server shares the guarded test DB
    # before the only real demo login in this script creates a session there.
    ops = Client.sql_session(ids["ops"])
    acct = Client.sql_session(ids["acct"])
    admin = Client.sql_session(ids["admin"])
    alice = Client(logins["alice"])
    bob = Client.sql_session(ids["bob"])
    carol = Client.sql_session(ids["carol"])
    anonymous = Client()

    error(anonymous, "GET", "/api/admin/submissions", 401, "UNAUTHORIZED")
    error(alice, "GET", "/api/admin/submissions", 403, "FORBIDDEN")
    error(admin, "GET", "/api/admin/review-queue", 403, "FORBIDDEN")
    error(ops, "GET", "/api/admin/review-queue?limit=not-a-number", 400, "INVALID_REQUEST")
    error(ops, "GET", "/api/admin/submissions?month=2026-+1", 400, "INVALID_REQUEST")
    for path in ("/api/admin/notices/submission-reminder?month=2026-%2B1", "/api/admin/archive/2026-%2B1"):
        error(ops, "GET", path, 400, "INVALID_REQUEST")

    draft = alice.request("POST", "/api/submissions", {"kind": "initial", "target_month": CURRENT_MONTH}, expected=201)
    initial_id = draft["id"]
    original_id_card = alice.upload(initial_id, "id_card")["file_id"]
    for suffix in ("", "/history", "/events"):
        error(ops, "GET", f"/api/admin/submissions/{initial_id}{suffix}", 404, "NOT_FOUND")
    for viewer in (ops, acct, admin, bob):
        error(viewer, "GET", f"/api/files/{original_id_card}", 404, "NOT_FOUND")
    assert alice.request("GET", f"/api/files/{original_id_card}").startswith(b"%PDF-")
    assert student_row(ops, logins["alice"], "unsubmitted")["chains"] == []
    assert student_row(ops, logins["empty"], "unsubmitted")["chains"] == []
    assert student_row(ops, logins["employed"], "unsubmitted")["user"]["employed"] is True
    assert initial_id not in queue_ids(ops)
    print("PASS permissions, draft secrecy and unsubmitted students")

    monthly_id = alice.create_finalize("monthly")["id"]
    assert {item["root_kind"] for item in student_row(ops, logins["alice"])["chains"]} == {"monthly"}
    assert monthly_id in queue_ids(ops), "an initial draft suppressed a submitted monthly document"
    for doc_type in INITIAL_DOC_TYPES[1:]:
        alice.upload(initial_id, doc_type)
    alice.request("POST", f"/api/submissions/{initial_id}/finalize", key=new_key())
    for viewer in (ops, acct):
        assert viewer.request("GET", f"/api/files/{original_id_card}").startswith(b"%PDF-")
    error(admin, "GET", f"/api/files/{original_id_card}", 404, "NOT_FOUND")
    review(admin, initial_id, expected=403)
    review(alice, initial_id, expected=403)
    error(ops, "POST", f"/api/admin/submissions/{initial_id}/review", 400, "INVALID_REQUEST", {"status": "approved"})
    chains = student_row(ops, logins["alice"])["chains"]
    assert {item["root_kind"] for item in chains} == {"initial"}
    assert monthly_id not in queue_ids(ops)

    # Removing the CSRF token cannot make a valid reviewer request succeed.
    csrf = ops.cookies.pop("XSRF-TOKEN")
    try:
        review(ops, initial_id, expected=403)
    finally:
        ops.cookies["XSRF-TOKEN"] = csrf

    revision_key = new_key()
    reason = "통장 PDF의 모든 페이지가 보이게 다시 제출해주세요."
    revision = review(ops, initial_id, "revision_requested", reason, ["bankbook"], revision_key)
    assert revision["status"] == "revision_requested"
    assert review(ops, initial_id, "revision_requested", "  " + reason + "  ", ["bankbook", "bankbook"], revision_key) == revision
    review(ops, initial_id, "revision_requested", "다른 사유", ["bankbook"], revision_key, expected=409)
    review(acct, initial_id, "revision_requested", reason, ["bankbook"], revision_key, expected=409)
    review(ops, monthly_id, "revision_requested", reason, ["bankbook"], revision_key, expected=409)
    assert decision_count(initial_id) == 1
    assert notification_count(initial_id, "submission_revision_requested") == 1

    supplement_draft = alice.request("POST", "/api/submissions", {
        "kind": "supplement", "target_month": CURRENT_MONTH, "parent_id": initial_id,
    }, expected=201)
    supplement_id = supplement_draft["id"]
    assert supplement_draft["required_doc_types"] == ["bankbook"]
    replacement = alice.upload(supplement_id, "bankbook")
    before = ops.request("GET", f"/api/admin/submissions/{initial_id}/history")
    assert [item["id"] for item in before["items"]] == [initial_id]
    error(ops, "GET", f"/api/admin/submissions/{supplement_id}", 404, "NOT_FOUND")
    error(ops, "GET", f"/api/files/{replacement['file_id']}", 404, "NOT_FOUND")
    alice.request("POST", f"/api/submissions/{supplement_id}/finalize", key=new_key())
    queued = queue_ids(ops)
    assert initial_id not in queued and supplement_id in queued and monthly_id not in queued
    assert ops.request("GET", f"/api/admin/submissions/{supplement_id}/navigation")["remaining_count"] == len(queued) - 1
    review(ops, initial_id, expected=409)

    # An unchanged ancestor document is still part of the approved document set.
    # Corrupt its metadata only in the isolated fixture DB; no disk file is edited.
    original_sha = sql(f"SELECT encode(sha256,'hex') FROM submission_files WHERE id={quote(original_id_card)};")
    approval_key = new_key()
    sql(f"UPDATE submission_files SET sha256=decode(repeat('00',32),'hex') WHERE id={quote(original_id_card)};")
    try:
        failed = review(ops, supplement_id, key=approval_key, expected=500)
        assert failed["error"]["code"] == "INTERNAL_ERROR"
        assert decision_count(supplement_id) == 0
        assert notification_count(supplement_id) == 0
        states = sql(f"SELECT DISTINCT status FROM submissions WHERE id IN ({quote(initial_id)},{quote(supplement_id)});")
        assert states == "resubmitted", states
    finally:
        sql(f"UPDATE submission_files SET sha256=decode({quote(original_sha)},'hex') WHERE id={quote(original_id_card)};")
    approved = review(ops, supplement_id, key=approval_key)
    assert approved["status"] == "approved"
    assert review(ops, supplement_id, key=approval_key) == approved
    student_history = {item["id"]: item for item in alice.request("GET", "/api/submissions")["items"]}
    assert student_history[initial_id]["status"] == "approved"
    assert student_history[supplement_id]["status"] == "approved"
    assert student_history[monthly_id]["status"] == "pending_review", "initial approval crossed into monthly chain"
    assert notification_count(supplement_id, "submission_approved") == 1
    assert notification_count(initial_id, "submission_approved") == 0
    history = ops.request("GET", f"/api/admin/submissions/{initial_id}/history")
    assert [item["id"] for item in history["items"]] == [supplement_id, initial_id]
    assert len(history["items"][0]["files"]) == 1 and len(history["items"][1]["files"]) == 4
    assert student_row(ops, logins["alice"], "approved")["chains"][0]["latest_submission_id"] == supplement_id
    filtered = ops.request("GET", "/api/admin/submissions?" + urllib.parse.urlencode({
        "month": CURRENT_MONTH, "query": logins["alice"], "status": "pending_review",
    }))
    assert filtered["items"] == [], "hidden monthly documents leaked into the status filter"
    print("PASS partial supplement, parent exclusion, file integrity and atomic ancestor approval")

    sql(f"UPDATE users SET display_name='renamed reviewer', role='admin' WHERE id={ids['ops']};")
    try:
        error(ops, "GET", "/api/admin/review-queue", 403, "FORBIDDEN")
        events = acct.request("GET", f"/api/admin/submissions/{initial_id}/events")["items"]
        request_event = next(event for event in events if event["action"] == "revision_requested")
        assert request_event["review_comment"] == reason
        assert request_event["revision_doc_types"] == ["bankbook"]
        assert request_event["actor"] == {"name": logins["ops"], "role": "operator"}
        approvals = [event for event in events if event["action"] == "approved"]
        assert {event["submission_id"] for event in approvals} == {initial_id, supplement_id}
        assert all(event["actor"] == {"name": logins["ops"], "role": "operator"} for event in approvals), approvals
        # Exercise the upgrade for existing propagated events, not only new writes.
        migration = Path(__file__).resolve().parents[1] / "backend/migrations/2026-10-18-040000-0000_admin_review_event_links"
        sql("BEGIN; " + (migration / "down.sql").read_text() + (migration / "up.sql").read_text() + " COMMIT;")
        migrated = acct.request("GET", f"/api/admin/submissions/{initial_id}/events")["items"]
        assert migrated == events, "upgrading existing events changed their immutable actors"
    finally:
        sql(f"UPDATE users SET role='operator' WHERE id={ids['ops']};")
    # Replaying after later approval returns the original decision and original actor.
    assert review(ops, initial_id, "revision_requested", reason, ["bankbook"], revision_key) == revision
    assert review(ops, supplement_id, key=approval_key) == approved
    sql(f"UPDATE users SET display_name={quote(logins['ops'])} WHERE id={ids['ops']};")
    assert decision_count(initial_id) == 1 and decision_count(supplement_id) == 1
    print("PASS immutable history, changed-role authorization and exact idempotent replay")

    competing = bob.create_finalize("monthly")["id"]
    other_pending = Client.sql_session(ids["empty"]).create_finalize("monthly")["id"]
    same_receipt = CURRENT_MONTH + "-01T00:00:01+09:00"
    sql(f"UPDATE submissions SET submitted_at={quote(same_receipt)} WHERE id IN ({quote(competing)},{quote(other_pending)});")
    queued = queue_ids(ops)
    tied = [submission_id for submission_id in queued if submission_id in (competing, other_pending)]
    assert tied == sorted((competing, other_pending)), "queue lost its UUID tie-break ordering"
    first, second = tied
    nav = ops.request("GET", f"/api/admin/submissions/{first}/navigation")
    assert nav["next_id"] == queued[queued.index(first) + 1]
    reverse = ops.request("GET", f"/api/admin/submissions/{second}/navigation")
    assert reverse["previous_id"] == queued[queued.index(second) - 1]
    results = concurrent_decisions(
        lambda: attempt(ops, competing, new_key()),
        lambda: attempt(acct, competing, new_key(), "revision_requested"),
    )
    assert sorted(status for status, _ in results) == [200, 409], results
    assert decision_count(competing) == 1 and notification_count(competing) == 1
    assert competing not in queue_ids(ops)
    assert ops.request("GET", f"/api/admin/submissions/{competing}/navigation")["remaining_count"] >= 1

    prior_initial = carol.create_finalize("initial")["id"]
    open_cycle(PREVIOUS_MONTH)
    sql(
        f"UPDATE submissions SET target_month={quote(PREVIOUS_MONTH + '-01')}, "
        f"submitted_at={quote(PREVIOUS_MONTH + '-01T00:00:01+09:00')} WHERE id={quote(prior_initial)};"
    )
    repeated = carol.create_finalize("monthly")["id"]
    assert repeated in queue_ids(ops), "an initial submission from an earlier month suppressed monthly review"
    assert {item["root_kind"] for item in student_row(ops, logins["carol"])["chains"]} == {"monthly"}
    ops_second_session = Client.sql_session(ids["ops"])
    same_key = new_key()
    results = concurrent_decisions(
        lambda: attempt(ops, repeated, same_key),
        lambda: attempt(ops_second_session, repeated, same_key),
    )
    assert [status for status, _ in results] == [200, 200], results
    assert results[0][1] == results[1][1]
    assert decision_count(repeated) == 1 and notification_count(repeated) == 1
    print("PASS stable queue navigation, competing reviewers and simultaneous same-key retries")

    # Every descendant of a redundant monthly chain is excluded, even after
    # multiple rounds of supplementation. Originals and history remain readable.
    employed = Client.sql_session(ids["employed"])
    hidden_monthly = employed.create_finalize("monthly")["id"]
    review(ops, hidden_monthly, "revision_requested", "월별 서류 보완", ["employment_insurance"])
    hidden_supplement = employed.create_finalize("supplement", parent_id=hidden_monthly)["id"]
    review(ops, hidden_supplement, "revision_requested", "월별 서류 재보완", ["employment_insurance"])
    hidden_leaf = employed.create_finalize("supplement", parent_id=hidden_supplement)["id"]
    assert hidden_leaf in queue_ids(ops)
    visible_initial = employed.create_finalize("initial")["id"]
    assert [item["root_submission_id"] for item in student_row(ops, logins["employed"])["chains"]] == [visible_initial]
    queued = queue_ids(ops)
    assert visible_initial in queued and not set((hidden_monthly, hidden_supplement, hidden_leaf)).intersection(queued)
    for index, submission_id in enumerate(queued):
        nav = ops.request("GET", f"/api/admin/submissions/{submission_id}/navigation")
        assert nav["remaining_count"] == len(queued) - 1
        assert nav["previous_id"] == (queued[index - 1] if index else None)
        assert nav["next_id"] == (queued[index + 1] if index + 1 < len(queued) else None)
    history = ops.request("GET", f"/api/admin/submissions/{hidden_monthly}/history")["items"]
    assert {item["id"] for item in history} == {hidden_monthly, hidden_supplement, hidden_leaf}
    assert ops.request("GET", f"/api/admin/submissions/{hidden_leaf}")["status"] == "resubmitted"
    print("PASS initial-month coverage, draft/other-month boundaries, recursive supplements and navigation")

    # Reuse a still-pending, uploaded fixture for a historical closed month.
    open_cycle(PREVIOUS_MONTH)
    sql(
        f"UPDATE submissions SET target_month={quote(PREVIOUS_MONTH + '-01')}, "
        f"submitted_at={quote(PREVIOUS_MONTH + '-01T00:00:01+09:00')} WHERE id={quote(monthly_id)};"
    )
    closed = review(ops, monthly_id, "revision_requested", "마감 후에는 보완할 수 없습니다.", ["employment_insurance"], expected=422)
    assert closed["error"]["code"] == "CYCLE_CLOSED"
    assert decision_count(monthly_id) == 0
    historical = review(ops, monthly_id)
    assert historical["status"] == "approved" and historical["target_month"] == PREVIOUS_MONTH
    print("PASS closed-month revision rejection and approval")
    print(f"PASS administrator review smoke ({prefix}; isolated fixtures retained)")


if __name__ == "__main__":
    run()
