// Preview data for the admin screens, dev builds only: a screen shows it when its URL has
// `?preview` (e.g. /?preview). It is imported dynamically behind `ngDevMode`, so production
// bundles do not contain it. There is no admin API yet; these are not mocks of one.

import {
  ArchiveView,
  DashboardView,
  NoticeSendResult,
  NoticeView,
  ReviewDecision,
  ReviewView,
  UserRecordView,
} from '../core/admin.models';

export const DASHBOARD_PREVIEW: DashboardView = {
  month: '2026-10',
  targets: 100,
  employedExcluded: 3,
  unsubmitted: 10,
  pendingReview: 14,
  revisionRequested: 6,
  hours: {
    inProgress: 128,
    projected: [
      { tier: 'tier_1', seconds: 144000, count: 31 },
      { tier: 'tier_2', seconds: 288000, count: 12 },
    ],
  },
  previous: {
    month: '2026-09',
    awaitingDecision: 0,
    met: 74,
    notMet: 20,
    onHold: 8,
    eligible: 70,
    notEligible: 2,
    undecided: 30,
  },
  tasks: { bankChangePending: 1, sendFailed: 1 },
};

const NAMES: [string, string, 'missing' | 'draft'][] = [
  ['정하늘', 'haneul', 'missing'],
  ['윤서준', 'seojun', 'missing'],
  ['한지우', 'jiwoo', 'missing'],
  ['임수빈', 'subin', 'draft'],
  ['장유나', 'yuna', 'missing'],
  ['오민재', 'minjae', 'missing'],
  ['배지안', 'jian', 'missing'],
];

/** 7 targets, 3 취업 중 (A07-notice-sent behind its modal) */
export const NOTICE_PREVIEW: NoticeView = {
  month: '2026-09',
  months: ['2026-10', '2026-09'],
  audience: 'unsubmitted',
  matched: 10,
  hoursUnknown: 0,
  unsubmitted: 10,
  employedExcluded: 3,
  employedNames: ['박서진', '최시우', '서지민'],
  targets: NAMES.map(([name, login, status]) => ({ name, login, employed: false, status })),
  closesAt: '2026-10-01T00:00:00+09:00',
};

/** 0 targets: every unsubmitted user is 취업 중 (A07-notice-empty) */
export const NOTICE_EMPTY_PREVIEW: NoticeView = {
  ...NOTICE_PREVIEW,
  matched: 3,
  unsubmitted: 3,
  targets: [],
};

export const NOTICE_SENT_PREVIEW: NoticeSendResult = {
  sent: 7,
  failed: 0,
  employedExcluded: 3,
  sentAt: '2026-09-21T14:30:00+09:00',
};

/** A18: a student whose 9월 submission is under review (A18-user-record) */
export const USER_RECORD_PREVIEW: UserRecordView = {
  name: '동민',
  login: 'dongkim2',
  employed: false,
  employmentChangedAt: '2026-09-01T10:00:00+09:00',
  bank: { bankName: '카카오뱅크', last4: '1234', bankbookChangedAt: '2026-02-20T09:30:00+09:00' },
  initialSubmitted: true,
  lastSubmittedAt: '2026-09-21T09:41:00+09:00',
  currentMonth: { month: '2026-09', status: 'pending_review', submissionId: 'sub-preview-1' },
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
    {
      at: '2026-08-21T16:12:00+09:00',
      month: '2026-08',
      action: 'submitted',
      submissionStatus: 'approved',
      actor: { name: '동민', role: 'student' },
    },
    {
      at: '2026-07-23T11:25:00+09:00',
      month: '2026-07',
      action: 'approved',
      submissionStatus: 'approved',
      actor: { name: '지우', role: 'accountant' },
    },
  ],
  initialDocs: {
    approvedAt: '2026-02-21T11:00:00+09:00',
    docs: [
      { docType: 'id_card', fileId: '00000000-0000-4000-8000-000000000001' },
      { docType: 'resident_abstract', fileId: '00000000-0000-4000-8000-000000000002' },
      { docType: 'bankbook', fileId: '00000000-0000-4000-8000-000000000003' },
    ],
  },
};

/** 서류 검토: the 최초 4종 of a student, waiting for review (A02-initial-review-*) */
export const REVIEW_PREVIEW: ReviewView = {
  submissionId: 'preview-initial',
  userId: 1,
  name: '동민',
  login: 'dongkim2',
  employed: false,
  kind: 'initial',
  month: '2026-09',
  status: 'pending_review',
  submittedAt: '2026-09-21T09:41:00+09:00',
  docs: [
    {
      docType: 'id_card',
      fileId: '00000000-0000-4000-8000-0000000000a1',
      fileName: '신분증_동민.pdf',
      sizeBytes: 1_200_000,
    },
    {
      docType: 'resident_abstract',
      fileId: '00000000-0000-4000-8000-0000000000a2',
      fileName: '주민등록초본_동민.pdf',
      sizeBytes: 840_000,
    },
    {
      docType: 'bankbook',
      fileId: '00000000-0000-4000-8000-0000000000a3',
      fileName: '통장사본_동민.pdf',
      sizeBytes: 620_000,
    },
    {
      docType: 'employment_insurance',
      fileId: '00000000-0000-4000-8000-0000000000a4',
      fileName: '고용보험_동민_202609.pdf',
      sizeBytes: 1_800_000,
      issuedOn: '2026-09-19',
    },
  ],
  period: { opensAt: '2026-09-01T00:00:00+09:00', closesAt: '2026-10-01T00:00:00+09:00' },
  events: [
    {
      at: '2026-09-21T09:41:00+09:00',
      action: 'submitted',
      actor: { name: '동민', role: 'student' },
    },
  ],
};

/** The month's 고용보험가입내역서 alone (A02-monthly-*; the review screen itself has no image) */
export const REVIEW_MONTHLY_PREVIEW: ReviewView = {
  ...REVIEW_PREVIEW,
  submissionId: 'preview-monthly',
  kind: 'monthly',
  docs: [REVIEW_PREVIEW.docs[3]],
};

/** Who handled it and when, for the result pages (A02-*-approved, A03-revision-requested) */
export const REVIEW_DECISION_PREVIEW: Record<ReviewDecision['result'], ReviewDecision> = {
  approved: {
    result: 'approved',
    actor: { name: '지우', role: 'accountant' },
    at: '2026-09-21T10:32:00+09:00',
  },
  revision_requested: {
    result: 'revision_requested',
    actor: { name: '지우', role: 'operator' },
    at: '2026-09-21T10:32:00+09:00',
  },
};

/** A03-revision-compose / -requested: the reason and document used when the page is opened directly */
export const REVIEW_REASON_PREVIEW =
  '서류 일부가 흐릿해서 내용을 확인하기 어려워요. 모든 페이지가 선명하게 보이는 PDF로 다시 제출해주세요.';

/** Three students of September (A12-archive-month.png) */
export const ARCHIVE_PREVIEW: ArchiveView = {
  month: '2026-09',
  months: ['2026-10', '2026-09'],
  rows: [
    {
      userId: 1,
      name: '동민',
      login: 'dongkim2',
      files: ['employment_insurance'],
      baseDocs: ['id_card', 'resident_abstract', 'bankbook'],
      previous: [],
      kinds: ['monthly'],
      submittedAt: '2026-09-21T09:12:00+09:00',
      status: 'pending_review',
    },
    {
      userId: 2,
      name: '이서연',
      login: 'seoyeon',
      files: ['employment_insurance'],
      baseDocs: ['id_card', 'resident_abstract', 'bankbook'],
      previous: [],
      kinds: ['monthly'],
      submittedAt: '2026-09-21T09:28:00+09:00',
      status: 'revision_requested',
    },
    {
      userId: 3,
      name: '김하린',
      login: 'harin',
      files: ['employment_insurance'],
      baseDocs: ['id_card', 'resident_abstract', 'bankbook'],
      previous: ['employment_insurance'],
      kinds: ['supplement'],
      submittedAt: '2026-09-21T09:41:00+09:00',
      status: 'approved',
    },
  ],
};
