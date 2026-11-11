import { StudentProfile } from './cohort';
import { NoticeAudience } from '@otus/shared/core/notice-audience';
// What the admin screens show. These are screen types; feature API services map
// the responses documented in api.md into them. The three axes (시간 요건, 서류 상태, 최종 수령 대상) are
// separate fields and are never merged into one.

import { DocType, Role, SubmissionStatus } from '@otus/shared/core/api-types';

export type TimeTier = 'tier_1' | 'tier_2';

/** Users whose highest tier so far is `tier`. `seconds` is the server's threshold, never hard-coded. */
export interface TierBucket {
  tier: TimeTier;
  seconds: number;
  count: number;
}

/** A00 현황 대시보드 for one month (the page's month, normally the current one). */
export interface DashboardView {
  /** YYYY-MM */
  month: string;
  /** 제출 대상: everyone who is expected to submit, 취업 중 already left out */
  targets: number;
  employedExcluded: number;
  /** 미제출 among the 제출 대상 (취업 중 left out), drafts included: the same number A07 sends to */
  unsubmitted: number;
  /** pending_review + resubmitted */
  pendingReview: number;
  /** revision_requested: waiting for the student's 보완 제출 */
  revisionRequested: number;
  /** 시간 요건 of the page's month, still being counted (phase in_progress) */
  hours: {
    inProgress: number;
    /** A user in tier_2 is not counted in tier_1 */
    projected: TierBucket[];
  };
  /** The month before: time requirement decided (result) and the final 수령 대상 (final) */
  previous: {
    /** YYYY-MM */
    month: string;
    /** phase awaiting_decision */
    awaitingDecision: number;
    met: number;
    notMet: number;
    onHold: number;
    eligible: number;
    notEligible: number;
    undecided: number;
  };
  tasks: {
    /** pending bank account change requests */
    bankChangePending: number;
    /** notices that failed to send and can be retried */
    sendFailed: number;
  };
}

/** One recipient in the selected notice audience. */
export interface NoticeTarget {
  name: string;
  login: string;
  employed: boolean;
  /** missing = 미제출, draft = 임시 저장만 한 사용자 */
  status: 'missing' | 'draft' | 'submitted';
  studyHours?: 0 | 40 | 80 | null;
  asOf?: string | null;
}

/** A07 알림 보내기 for one month and audience. */
export interface NoticeView {
  audience: NoticeAudience;
  matched: number;
  hoursUnknown: number;
  /** YYYY-MM of the selected month */
  month: string;
  /** Months the select offers, YYYY-MM */
  months: string[];
  /** 이번 달 미제출: drafts and 취업 중 included, before the exclusion */
  unsubmitted: number;
  /** 취업 중 among them, left out automatically */
  employedExcluded: number;
  /** Names of the 취업 중 people, shown under the list */
  employedNames: string[];
  /** Matched audience minus employed people. Empty = nothing to send. */
  targets: NoticeTarget[];
  /** Submission deadline, exclusive; null for study-hour notices. */
  closesAt: string | null;
}

export interface NoticeSendResult {
  sent: number;
  failed: number;
  employedExcluded: number;
  /** ISO 8601 KST */
  sentAt: string;
}

/** compose = the page, confirm = the check before sending, sent = the result modal */
export type NoticeStage = 'compose' | 'confirm' | 'sent';

/**
 * What one line of "검토 및 변경 기록" says happened. Submission lines follow the status
 * transitions of api.md; the others are the bank account and employment changes.
 */
export type RecordAction =
  | 'submitted'
  | 'resubmitted'
  | 'approved'
  | 'revision_requested'
  | 'bank_change_requested'
  | 'bank_change_approved'
  | 'bank_change_rejected'
  | 'employment_changed';

export interface UserRecordRow {
  /** ISO 8601 KST */
  at: string;
  /** YYYY-MM the line belongs to (the target month, not the time it happened) */
  month: string;
  action: RecordAction;
  /**
   * The current status of the submission this line is about; null for lines that are not about
   * a submission (bank account, employment). A submit line whose submission still waits for
   * review says so ("서류 제출 · 검토 대기"), older ones do not.
   */
  submissionStatus: SubmissionStatus | null;
  /** Who did it: the student by name, staff by role */
  actor: { name: string; role: Role };
}

export interface InitialDoc {
  docType: DocType;
  /** The file to open through GET /api/files/{id} (owner or accountant, audited) */
  fileId: string;
}

/** A18 사용자 관리 상세. The bank account is only ever the masked last four digits. */
export interface UserRecordView {
  name: string;
  /** 기수·한글 이름·생년월일 for the label; missing where the source has none */
  profile?: StudentProfile;
  login: string;
  employed: boolean;
  /** ISO 8601 KST, null when it was never changed */
  employmentChangedAt: string | null;
  /** The approved account; null when there is none */
  bank: {
    bankName: string;
    last4: string;
    /** When the bankbook copy last changed (ISO) */
    bankbookChangedAt: string | null;
  } | null;
  /** A change request waiting for review; the approved account stays in use until then */
  bankPending?: {
    requestId: number;
    bankName: string;
    last4: string;
    /** ISO 8601 KST */
    requestedAt: string;
    /** The 통장사본 sent with the request, to open and compare */
    bankbook: { fileId: string; name: string } | null;
  } | null;
  /** The 최초 4종 are in */
  initialSubmitted: boolean;
  lastSubmittedAt: string | null;
  /** This month's submission: its status, or missing; null when the API does not say */
  currentMonth: {
    month: string;
    status: SubmissionStatus | 'missing';
    /** The newest submission of this month's chain: the review page is /submissions/{id} */
    submissionId?: string | null;
  } | null;
  /** Newest first */
  records: UserRecordRow[];
  /** The first submission's documents except the monthly 고용보험가입내역서 */
  initialDocs: { approvedAt: string | null; docs: InitialDoc[] };
  /**
   * True when the view comes from GET /api/admin/users/{id}, which has the profile only: the
   * bank account, this month's submission, the record and the documents are then unknown, not
   * empty, and the screen says so instead of "no account" or "미제출".
   */
  profileOnly?: boolean;
  /** True when the bank account could not be loaded: `bank` is null because it is unknown */
  bankUnavailable?: boolean;
}

// ---- 서류 검토 (A02 검토 · 승인, A03 보완 요청) ----

/** api.md Kind: what kind of submission is being reviewed */
export type ReviewKind = 'initial' | 'monthly' | 'supplement';

export interface ReviewDoc {
  docType: DocType;
  /** The file to open through GET /api/files/{id} (accountant or owner, audited) */
  fileId: string;
  fileName: string;
  sizeBytes: number;
  /** When the document was issued (YYYY-MM-DD), read from the document by the reviewer; the monthly 고용보험가입내역서 only */
  issuedOn?: string;
}

export interface ReviewEvent {
  /** ISO 8601 KST */
  at: string;
  action: 'submitted' | 'resubmitted' | 'approved' | 'revision_requested';
  /** Who did it: the student, or the staff member who handled it */
  actor: { name: string; role: Role };
}

/** One submission as the reviewer sees it. Drafts never get here. */
export interface ReviewView {
  submissionId: string;
  userId: number;
  name: string;
  /** 기수·한글 이름·생년월일 for the label, when the source has them */
  profile?: StudentProfile;
  login: string;
  employed: boolean;
  kind: ReviewKind;
  /** YYYY-MM, the target month */
  month: string;
  status: SubmissionStatus;
  /** ISO 8601 KST */
  submittedAt: string;
  /** The current files, in `required_doc_types` order */
  docs: ReviewDoc[];
  /** The target month's submission period, the cycle's values (`closesAt` is exclusive) */
  period: { opensAt: string; closesAt: string } | null;
  /** Newest first */
  events: ReviewEvent[];
}

/** What the reviewer decided, shown on the result pages. */
export interface ReviewDecision {
  result: 'approved' | 'revision_requested';
  actor: { name: string; role: Role };
  /** ISO 8601 KST */
  at: string;
}

// ---- 월 자료함 (A12) ----

/** A draft never reaches the archive, so its status is not here. */
export type ArchiveStatus = Exclude<SubmissionStatus, 'draft'>;

/** One student's final submission of the month: the row of the 자료함 table. */
export interface ArchiveRow {
  userId: number;
  name: string;
  login: string;
  /** The current files of the final submission, in `required_doc_types` order */
  files: DocType[];
  /**
   * The approved 기본 서류 linked to this month (신분증, 주민등록초본, 통장사본) that are not
   * part of `files`. A bankbook change that is not approved yet is never here.
   */
  baseDocs: DocType[];
  /** Older versions of this month's files (replaced by a 보완 제출), oldest first */
  previous: DocType[];
  /** ISO 8601 KST */
  submittedAt: string;
  status: ArchiveStatus;
  /** Latest finalized kinds of the included submission chains. */
  kinds: ReviewKind[];
}

export interface ArchiveView {
  /** YYYY-MM */
  month: string;
  /** Months the select offers, YYYY-MM */
  months: string[];
  rows: ArchiveRow[];
}

/** 보기 filter of the table */
export type ArchiveFilter = 'all' | 'selected';

/** Applied by the server to both the list and the exported submission chains. */
export interface ArchiveCriteria {
  /** Empty arrays mean no restriction; choices within each group are ORed. */
  status: readonly ArchiveStatus[];
  kind: readonly ReviewKind[];
}

export const DEFAULT_ARCHIVE_CRITERIA: ArchiveCriteria = { status: [], kind: [] };

/** A13 추가 자료. The month's final submissions and the 제출목록.csv are always included. */
export interface ArchiveOptions {
  /** 기본 서류 3종: the approved versions linked to the month */
  baseDocs: boolean;
  /** 이전 제출본 */
  previous: boolean;
}

export const DEFAULT_ARCHIVE_OPTIONS: ArchiveOptions = { baseDocs: false, previous: false };

/** A14: the ZIP is being made, the browser download has started, or making it failed */
export type DownloadStatus = 'creating' | 'ready' | 'failed';
