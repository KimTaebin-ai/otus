"""Period configuration checks, only through the guarded otus_admin_test helpers."""
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
from email import policy
from email.parser import BytesParser
import time
import uuid

from admin_api_testlib import Client, CURRENT_MONTH, PREVIOUS_MONTH, KST, month_window, new_key, seed_user, sql


def exercise_periods(sink):
    suffix = uuid.uuid4().hex[:8]
    operator_id = seed_user('period_ops_' + suffix, role='operator')
    operator = Client.sql_session(operator_id)
    admin = Client.sql_session(seed_user('period_admin_' + suffix, role='admin'))
    accountant = Client.sql_session(seed_user('period_account_' + suffix, role='accountant'))
    student = Client.sql_session(seed_user('period_student_' + suffix))
    year = int(CURRENT_MONTH[:4])
    next_month = (dt.datetime.fromisoformat(month_window(CURRENT_MONTH)[1])).strftime('%Y-%m')
    future_start, future_end = month_window(next_month)
    endpoint = '/api/admin/cycles/' + next_month
    body = {'opens_at': next_month + '-21T09:00:00+09:00', 'closes_at': future_end, 'expected_version': None}

    student.request('GET', '/api/admin/cycles', expected=403)
    assert accountant.request('GET', '/api/admin/cycles')['can_manage'] is False
    assert admin.request('GET', '/api/admin/cycles')['can_manage'] is True
    page = operator.request('GET', f'/api/admin/cycles?year={year}')
    assert page['current_month'] == CURRENT_MONTH and len(page['items']) == 12 and page['can_manage']
    for query in ('year=0', 'year=9999', 'year=x', 'unexpected=true'):
        operator.request('GET', '/api/admin/cycles?' + query, expected=400)
    for client in (accountant, student):
        client.request('PUT', endpoint, body, expected=403)
    for changed in (
        {'closes_at': body['opens_at']}, {'opens_at': future_end},
        {'opens_at': CURRENT_MONTH + '-01T00:00:00+09:00'},
        {'closes_at': future_end.replace('00:00:00', '00:00:01')},
        {'opens_at': next_month + '-21T09:00:00'}, {'expected_version': 0},
        {'opens_at': next_month + '-21T09:00:00.123+09:00'}, {'extra': True},
    ):
        operator.request('PUT', endpoint, {**body, **changed}, expected=400)
    past_start, past_end = month_window(PREVIOUS_MONTH)
    operator.request('PUT', '/api/admin/cycles/' + PREVIOUS_MONTH,
                     {'opens_at': past_start, 'closes_at': past_end, 'expected_version': 1}, expected=400)
    made = operator.request('PUT', endpoint, body)
    assert made['version'] == 1 and made['state'] == 'upcoming', made
    operator.request('PUT', endpoint, body, expected=409)
    edited = admin.request('PUT', endpoint, {**body, 'opens_at': next_month + '-20T09:00:00+09:00', 'expected_version': 1})
    assert edited['version'] == 2
    admin.request('PUT', endpoint, {**body, 'expected_version': 1}, expected=409)
    unchanged = admin.request('PUT', endpoint, {'opens_at': edited['opens_at'], 'closes_at': edited['closes_at'], 'expected_version': 2})
    assert unchanged['version'] == 2
    with ThreadPoolExecutor(max_workers=2) as workers:
        def change(day):
            client = Client.sql_session(operator_id)
            result = client.request('PUT', endpoint, {**body, 'opens_at': f'{next_month}-{day}T09:00:00+09:00', 'expected_version': 2}, expected=(200, 409))
            return client.last_status, result
        results = list(workers.map(change, [18, 19]))
    assert sorted(status for status, _ in results) == [200, 409], results
    history = accountant.request('GET', endpoint + '/history')
    assert [entry['version'] for entry in history] == [3, 2, 1], history
    assert history[-1]['previous_opens_at'] is None and history[0]['previous_opens_at'] == edited['opens_at']
    sql(f"UPDATE users SET display_name='Changed synthetic name' WHERE id={operator_id}")
    assert accountant.request('GET', endpoint + '/history')[0]['actor_name'] == history[0]['actor_name']
    for statement in (
        f"UPDATE cycle_changes SET actor_name='overwrite' WHERE target_month='{next_month}-01'",
        f"UPDATE cycles SET opens_at='{CURRENT_MONTH}-01T00:00:00+09:00' WHERE target_month='{next_month}-01'",
    ):
        try:
            sql(statement)
        except RuntimeError:
            pass
        else:
            raise AssertionError('audit or period CHECK allowed invalid mutation')
    assert next_month in accountant.request('GET', '/api/admin/submissions')['months']

    # Change only the isolated DB's current window and restore it even on failure.
    current_endpoint = '/api/admin/cycles/' + CURRENT_MONTH
    original = next(p for p in page['items'] if p['target_month'] == CURRENT_MONTH)
    current = original

    def save_current(start, end):
        nonlocal current
        current = operator.request('PUT', current_endpoint, {'opens_at': start, 'closes_at': end, 'expected_version': current['version']})
        return current

    submitted = student.create_finalize()
    draft = student.request('POST', '/api/submissions', {'kind': 'monthly', 'target_month': CURRENT_MONTH}, expected=(200, 201))
    student.upload(draft['id'], 'employment_insurance')
    notify_path = '/api/admin/notices/submission-reminder'
    preview = operator.request('GET', notify_path)
    now = dt.datetime.now(KST).replace(microsecond=0)
    start, end = map(dt.datetime.fromisoformat, month_window(CURRENT_MONTH))
    close = min(now + dt.timedelta(minutes=45), end)
    try:
        save_current(start.isoformat(), close.isoformat())
        actual = student.request('GET', '/api/cycles/current')
        assert actual['state'] == 'open' and actual['closes_at'] == close.isoformat(), actual
        fresh = operator.request('GET', notify_path)
        assert fresh['closes_at'] == close.isoformat() and fresh['target_fingerprint'] != preview['target_fingerprint']
        operator.request('POST', notify_path, {'month': CURRENT_MONTH, 'expected_count': len(preview['targets']), 'target_fingerprint': preview['target_fingerprint']}, expected=409, key=new_key())
        with sink.lock:
            before = len(sink.messages)
        notice = operator.request('POST', notify_path, {'month': CURRENT_MONTH, 'expected_count': len(fresh['targets']), 'target_fingerprint': fresh['target_fingerprint']}, key=new_key())
        until = time.monotonic() + 40
        while time.monotonic() < until:
            status = operator.request('GET', f"/api/admin/notices/{notice['notice_id']}")
            if status['email']['pending'] + status['email']['sending'] == 0:
                break
            time.sleep(0.1)
        else:
            raise AssertionError('local SMTP did not finish')
        with sink.lock:
            messages = [message for _, message in sink.messages[before:]]
        deadline_text = (close - dt.timedelta(seconds=1)).strftime('%Y-%m-%d %H:%M KST')
        assert messages, 'expected local test SMTP delivery'
        for raw in messages:
            message = BytesParser(policy=policy.default).parsebytes(raw)
            content = message.get_body(preferencelist=('plain',)).get_content() if message.is_multipart() else message.get_content()
            assert deadline_text in content, (deadline_text, content)

        closed_at = now - dt.timedelta(seconds=1)
        if closed_at > start:
            save_current(start.isoformat(), closed_at.isoformat())
            assert student.request('GET', '/api/cycles/current')['state'] == 'closed'
            student.request('POST', f"/api/submissions/{draft['id']}/finalize", expected=422, key=new_key())
            operator.request('GET', notify_path, expected=422)
            operator.request('POST', f"/api/admin/submissions/{submitted['id']}/review", {'status': 'revision_requested', 'review_comment': 'Synthetic check'}, expected=422, key=new_key())
            operator.request('POST', f"/api/admin/submissions/{submitted['id']}/review", {'status': 'approved'}, key=new_key())
            # New submissions are also closed, while reading archived files still works.
            other = Client.sql_session(seed_user('period_closed_' + suffix))
            other.request('POST', '/api/submissions', {'kind': 'initial', 'target_month': CURRENT_MONTH}, expected=422)
            accountant.request('GET', '/api/admin/archive/' + CURRENT_MONTH)
        if close - now > dt.timedelta(minutes=2):
            save_current((now + dt.timedelta(minutes=1)).isoformat(), close.isoformat())
            assert student.request('GET', '/api/cycles/current')['state'] == 'upcoming'
            student.request('POST', f"/api/submissions/{draft['id']}/finalize", expected=422, key=new_key())
    finally:
        save_current(original['opens_at'], original['closes_at'])
    student.request('POST', f"/api/submissions/{draft['id']}/finalize", key=new_key())
    # A role change takes effect on the next write, regardless of the cached UI.
    sql(f"UPDATE users SET role='accountant' WHERE id={operator_id}")
    operator.request('PUT', endpoint, {**body, 'expected_version': 3}, expected=403)
    print('PASS periods: RBAC, future months, validation, concurrent edits, immutable history, custom SMTP deadline, closed/upcoming gating and reopen', flush=True)
