import { AdminUserDetail } from './admin-users';
import { buildUserRecord } from './user-record-api';

const PROFILE: AdminUserDetail = {
  id: 7,
  login: 'dongmin',
  display_name: '동민',
  role: 'student',
  employed: false,
  employment_updated_at: null,
  initial_submitted: true,
};

const summary = (
  root_submission_id: string,
  root_kind: 'initial' | 'monthly',
  status = 'approved',
) =>
  ({
    root_submission_id,
    root_kind,
    latest_submission_id: root_submission_id,
    latest_kind: root_kind,
    status,
    submitted_at: '2026-10-02T09:00:00+09:00',
    supplement_count: 0,
  }) as never;

const file = (id: string, doc_type: string) => ({
  id,
  doc_type,
  original_name: id + '.pdf',
  size_bytes: 1,
  uploaded_at: '2026-09-02T09:00:00+09:00',
});

describe('buildUserRecord', () => {
  it('fills the record, the initial documents and this month from the chains', () => {
    const v = buildUserRecord(PROFILE, {
      currentMonth: '2026-10',
      currentChains: [summary('m1', 'monthly', 'pending_review')],
      chains: [
        {
          summary: summary('i1', 'initial'),
          records: [
            {
              id: 'i1',
              target_month: '2026-09',
              status: 'approved',
              files: [
                file('f1', 'id_card'),
                file('f2', 'employment_insurance'),
                file('f3', 'bankbook'),
              ],
            },
          ] as never,
          events: [
            {
              submission_id: 'i1',
              at: '2026-09-05T10:00:00+09:00',
              action: 'approved',
              actor: { name: '운영', role: 'operator' },
            },
            {
              submission_id: 'i1',
              at: '2026-09-02T09:00:00+09:00',
              action: 'submitted',
              actor: { name: '동민', role: 'student' },
            },
          ] as never,
        },
        { summary: summary('m1', 'monthly', 'pending_review'), records: [], events: [] },
      ],
    });
    expect(v.profileOnly).toBe(false);
    expect(v.bankUnavailable).toBe(true);
    expect(v.currentMonth).toMatchObject({ month: '2026-10', status: 'pending_review' });
    expect(v.currentMonth?.submissionId).toBeTruthy();
    expect(v.initialDocs.docs.map((d) => d.fileId)).toEqual(['f1', 'f3']);
    expect(v.initialDocs.approvedAt).toBe('2026-09-05T10:00:00+09:00');
    expect(v.records.map((r) => r.action)).toEqual(['approved', 'submitted']);
    expect(v.records[0].month).toBe('2026-09');
  });

  it('says missing when the month has no chain', () => {
    const v = buildUserRecord(PROFILE, { currentMonth: '2026-10', currentChains: [], chains: [] });
    expect(v.currentMonth).toEqual({ month: '2026-10', status: 'missing', submissionId: null });
    expect(v.lastSubmittedAt).toBeNull();
  });
});
