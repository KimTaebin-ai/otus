import { AppNotification, Cycle } from './api.models';
import { notificationCopy } from './notification-copy';

const cycle: Cycle = {
  target_month: '2026-10',
  state: 'open',
  opens_at: '2026-10-01T00:00:00+09:00',
  closes_at: '2026-11-01T00:00:00+09:00',
  d_day: 14,
  issued_after: '2026-10-01',
};
const notice: AppNotification = {
  id: 1,
  kind: 'submission_reminder',
  created_at: '2026-10-18T13:00:00+09:00',
  read_at: null,
  data: { month: '2026-10' },
};

describe('notification copy and destinations', () => {
  it('preserves composed titles, repeated lines and markup as plain text for every student', () => {
    const custom = {
      ...notice,
      kind: 'admin_notice',
      data: { title: '<b>운영 안내</b>', body: '같은 문장\n\n같은 문장\n<script>예시</script>' },
    };
    const copy = notificationCopy(custom, null, true);
    expect(copy.title).toBe(custom.data.title);
    expect(copy.lines.join('\n')).toBe(custom.data.body);
    expect(copy.link).toBe('/home');
    expect(notificationCopy(custom, null, false).link).toBe('/initial');
  });
  it('sends new students to the initial four documents and onboarded students to monthly submission', () => {
    const initial = notificationCopy(notice, cycle, false);
    expect(initial.link).toBe('/initial');
    expect(initial.lines.join(' ')).toContain('서류 4종');
    expect(notificationCopy(notice, cycle, true).link).toBe('/submit');
  });

  it('does not use the current month deadline or submit action for older or closed periods', () => {
    const old = notificationCopy({ ...notice, data: { month: '2026-09' } }, cycle, true);
    expect(old.title).toContain('9월');
    expect(old.link).toBe('/history');
    expect(old.lines.join(' ')).not.toContain('10월 31일');
    expect(notificationCopy(notice, { ...cycle, state: 'closed' }, true).link).toBe('/history');
    expect(notificationCopy(notice, null, true).lines.join(' ')).not.toContain('23:59');
  });

  it('routes review requests to history where initial and monthly supplements are distinguished', () => {
    const review = notificationCopy(
      { ...notice, kind: 'submission_revision_requested' },
      cycle,
      true,
    );
    expect(review.link).toBe('/history');
    expect(review.title).toContain('보완');
  });

  it('shows bank rejection text as data and links to settings', () => {
    const rejected = notificationCopy(
      {
        ...notice,
        kind: 'bank_account_rejected',
        data: { decision_note: '<script>example</script>' },
      },
      cycle,
      true,
    );
    expect(rejected.lines[0]).toBe('<script>example</script>');
    expect(rejected.link).toBe('/settings');
  });

  it('does not equate time or document approval with final eligibility', () => {
    for (const kind of ['hours_projected', 'time_requirement_decided', 'submission_approved']) {
      expect(notificationCopy({ ...notice, kind }, cycle, true).lines.join(' ')).toContain(
        '최종 수령 대상',
      );
    }
  });

  it('shows the notified month and hour band even after the submission period ends', () => {
    for (const [hours, label] of [
      [0, '40시간 미만'],
      [40, '40시간 이상 80시간 미만'],
      [80, '80시간 이상'],
    ] as const) {
      const copy = notificationCopy(
        { ...notice, kind: 'study_hours_notice', data: { month: '2026-09', study_hours: hours } },
        cycle,
        true,
      );
      expect(copy.title).toBe('9월 지원금 시간 요건 안내');
      expect(copy.lines.join(' ')).toContain(label);
      expect(copy.lines.join(' ')).toContain('12시간');
      expect(copy.lines.join(' ')).toContain('최종 지원금 지급 여부');
      expect(copy.link).toBe('/home');
    }
  });

  it('keeps unfamiliar notifications accessible without a guessed decision', () => {
    const unknown = notificationCopy({ ...notice, kind: 'future_kind', data: {} }, cycle, true);
    expect(unknown.title).toBe('새 알림이 도착했어요');
    expect(unknown.link).toBe('/home');
  });
});
