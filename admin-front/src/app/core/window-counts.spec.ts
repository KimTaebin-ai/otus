import { MonthlyStudentRow } from './admin-submissions-api';
import { countRows } from './window-counts';

const row = (id: number, employed: boolean, chains: number): MonthlyStudentRow => ({
  user: { id, login: `l${id}`, display_name: `n${id}`, employed, initial_submitted: true },
  chains: Array.from({ length: chains }, (_, i) => ({
    root_submission_id: `${id}-${i}`,
    root_kind: 'monthly' as const,
    latest_submission_id: `${id}-${i}`,
    latest_kind: 'monthly' as const,
    status: 'pending_review' as const,
    submitted_at: '2026-10-10T10:00:00+09:00',
    supplement_count: 0,
  })),
  last_submitted_at: null,
});

describe('countRows', () => {
  it('counts students with a chain in the window, leaves 취업 중 out', () => {
    expect(
      countRows([row(1, false, 1), row(2, false, 0), row(3, true, 1), row(4, false, 2)]),
    ).toEqual({
      submitted: 2,
      unsubmitted: 1,
      total: 3,
      employed: 1,
    });
  });
});
