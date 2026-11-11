import { UserRecordView } from './admin.models';
import {
  NOT_READY,
  NO_ORIGINALS_NOTE,
  docsEmpty,
  recordsEmpty,
  initialDocsCaption,
  recordCards,
  recordRows,
  reviewLink,
  summaryParts,
} from './user-record-copy';

const VIEW: UserRecordView = {
  name: '동민',
  login: 'dongkim2',
  employed: false,
  employmentChangedAt: '2026-09-01T10:00:00+09:00',
  bank: { bankName: '카카오뱅크', last4: '1234', bankbookChangedAt: '2026-02-20T09:00:00+09:00' },
  initialSubmitted: true,
  lastSubmittedAt: '2026-09-21T09:41:00+09:00',
  currentMonth: { month: '2026-09', status: 'pending_review' },
  records: [
    {
      at: '2026-09-21T09:41:00+09:00',
      month: '2026-09',
      action: 'submitted',
      submissionStatus: 'pending_review',
      actor: { name: '동민', role: 'student' },
    },
    {
      at: '2026-08-22T10:10:00+09:00',
      month: '2026-08',
      action: 'approved',
      submissionStatus: 'approved',
      actor: { name: '지우', role: 'accountant' },
    },
  ],
  initialDocs: {
    approvedAt: '2026-02-21T11:00:00+09:00',
    docs: [
      { docType: 'id_card', fileId: 'a' },
      { docType: 'resident_abstract', fileId: 'b' },
      { docType: 'bankbook', fileId: 'c' },
    ],
  },
};

describe('user record copy', () => {
  it('writes the summary line', () => {
    expect(summaryParts(VIEW)).toEqual([
      `인트라 ID · ${VIEW.login}`,
      '취업 상태 · 미취업',
      '최초 서류 등록 완료',
      '최근 제출 2026.09.21',
    ]);
    expect(
      summaryParts({ ...VIEW, employed: true, initialSubmitted: false, lastSubmittedAt: null }),
    ).toEqual([
      `인트라 ID · ${VIEW.login}`,
      '취업 상태 · 취업 중',
      '최초 서류 미등록',
      '제출 이력 없음',
    ]);
  });

  it('writes the three cards with the masked account and the student status wording', () => {
    expect(recordCards(VIEW)).toEqual([
      { label: '취업 상태', value: '미취업', sub: '최근 변경 2026.09.01' },
      { label: '받을 계좌', value: '카카오뱅크 · •••• 1234', sub: '통장사본 최종 변경 2026.02.20' },
      { label: '이번 달 제출', value: '검토 중', sub: '고용보험가입내역서 · 2026년 9월' },
    ]);
  });

  it('copes with no account, no change and a month without a submission', () => {
    const cards = recordCards({
      ...VIEW,
      employmentChangedAt: null,
      bank: null,
      currentMonth: { month: '2026-10', status: 'missing' },
    });
    expect(cards[0].sub).toBe('변경 이력 없음');
    expect(cards[1]).toEqual({ label: '받을 계좌', value: '등록된 계좌 없음', sub: '' });
    expect(cards[2].value).toBe('미제출');
  });

  it('never prints more than the last four digits of an account', () => {
    expect(JSON.stringify(recordCards(VIEW))).not.toMatch(/\d{5,}/);
  });

  it('writes the record rows: student by name, staff by role, month of the submission', () => {
    expect(recordRows(VIEW.records)).toEqual([
      { when: '09.21 09:41', month: '2026년 9월', action: '서류 제출 · 검토 대기', actor: '동민' },
      { when: '08.22 10:10', month: '2026년 8월', action: '서류 승인', actor: '회계·지정 담당자' },
    ]);
  });

  it('adds the waiting status only to submit lines whose submission still waits', () => {
    const base = {
      at: '2026-09-21T09:41:00+09:00',
      month: '2026-09',
      actor: VIEW.records[0].actor,
    };
    const rows = recordRows([
      { ...base, action: 'submitted', submissionStatus: 'pending_review' },
      { ...base, action: 'resubmitted', submissionStatus: 'resubmitted' },
      { ...base, action: 'submitted', submissionStatus: 'approved' },
      { ...base, action: 'bank_change_requested', submissionStatus: null },
      { ...base, action: 'approved', submissionStatus: 'pending_review' },
    ]);
    expect(rows.map((r) => r.action)).toEqual([
      '서류 제출 · 검토 대기',
      '보완 제출 · 재검토 대기',
      '서류 제출',
      '계좌 변경 요청',
      '서류 승인',
    ]);
  });

  it('captions the initial documents', () => {
    expect(initialDocsCaption(VIEW)).toBe('최초 승인 2026.02.21 · 3종 보관 중');
    expect(initialDocsCaption({ ...VIEW, initialDocs: { approvedAt: null, docs: [] } })).toBe(
      '최초 승인 전 · 0종 보관 중',
    );
  });

  it('says who may open originals', () => {
    expect(NO_ORIGINALS_NOTE).toBe('원본은 운영·회계 담당자만 열 수 있어요.');
  });

  describe('profile-only view (GET /api/admin/users/{id})', () => {
    const PROFILE: UserRecordView = {
      ...VIEW,
      bank: null,
      lastSubmittedAt: null,
      currentMonth: null,
      records: [],
      initialDocs: { approvedAt: null, docs: [] },
      profileOnly: true,
    };

    it('does not claim what it does not know', () => {
      expect(summaryParts(PROFILE)).toEqual([
        `인트라 ID · ${PROFILE.login}`,
        '취업 상태 · 미취업',
        '최초 서류 등록 완료',
      ]);
      const cards = recordCards(PROFILE);
      expect(cards[1]).toEqual({ label: '받을 계좌', value: '—', sub: NOT_READY });
      expect(cards[2]).toEqual({ label: '이번 달 제출', value: '—', sub: NOT_READY });
      expect(JSON.stringify(cards)).not.toMatch(/미제출|등록된 계좌 없음/);
      expect(initialDocsCaption(PROFILE)).toBe('최초 서류 등록 완료');
    });

    it('keeps the employment card, which the API does give', () => {
      expect(recordCards(PROFILE)[0]).toEqual({
        label: '취업 상태',
        value: '미취업',
        sub: '최근 변경 2026.09.01',
      });
    });

    it('explains the empty record and documents', () => {
      expect(recordsEmpty(PROFILE)).toContain('관리자 API가 준비되면');
      expect(docsEmpty(PROFILE)).toContain('관리자 API가 준비되면');
      expect(recordsEmpty({ ...PROFILE, profileOnly: false })).toBe('아직 기록이 없어요.');
    });
  });
});

describe('reviewLink (the way from A18 to /submissions/{id})', () => {
  const view = (currentMonth: UserRecordView['currentMonth']) =>
    ({ currentMonth }) as unknown as UserRecordView;

  it('invites a review while the submission waits for one', () => {
    expect(
      reviewLink(view({ month: '2026-10', status: 'pending_review', submissionId: 's-1' })),
    ).toEqual({ id: 's-1', month: '2026-10', waiting: true, label: '이번 달 제출 검토하기 →' });
    expect(
      reviewLink(view({ month: '2026-10', status: 'resubmitted', submissionId: 's-2' }))?.waiting,
    ).toBe(true);
  });

  it('only lets one look at a decided submission', () => {
    expect(
      reviewLink(view({ month: '2026-10', status: 'approved', submissionId: 's-1' })),
    ).toMatchObject({ waiting: false, label: '이번 달 제출 보기 →' });
  });

  it('has no link without a submission this month', () => {
    expect(
      reviewLink(view({ month: '2026-10', status: 'missing', submissionId: null })),
    ).toBeNull();
    expect(reviewLink(view(null))).toBeNull();
  });
});
