import { DOC_TYPE_LABELS, STATUS_LABELS } from '@otus/shared/core/api-types';
import { dotDate, dotMonthDay, hourMinute } from '@otus/shared/core/format';
import { BADGE_LABELS } from '@otus/shared/ui/status-badge';
import { RecordAction, UserRecordRow, UserRecordView } from './admin.models';
import { monthLabel } from './labels';
import { ROLE_LABELS } from './roles';

/** Screen copy for A18. Wording of statuses is the student app's (BADGE_LABELS). */

export const RECORD_ACTION_LABELS: Record<RecordAction, string> = {
  submitted: '서류 제출',
  resubmitted: '보완 제출',
  approved: '서류 승인',
  revision_requested: '재검토 요청',
  bank_change_requested: '계좌 변경 요청',
  bank_change_approved: '계좌 변경 승인',
  bank_change_rejected: '계좌 변경 반려',
  employment_changed: '취업 상태 변경',
};

/** The line under the name: "취업 상태 · 미취업 | 최초 서류 등록 완료 | 최근 제출 2026.09.21" */
export function summaryParts(v: UserRecordView): string[] {
  const parts = [
    `인트라 ID · ${v.login}`,
    `취업 상태 · ${v.employed ? '취업 중' : '미취업'}`,
    v.initialSubmitted ? '최초 서류 등록 완료' : '최초 서류 미등록',
  ];
  // profile-only views do not know the last submission, so they say nothing about it
  if (!v.profileOnly) {
    parts.push(v.lastSubmittedAt ? `최근 제출 ${dotDate(v.lastSubmittedAt)}` : '제출 이력 없음');
  }
  return parts;
}

/** Under a card whose data the admin API does not give yet */
export const NOT_READY = '관리자 API가 준비되면 나와요';
const BANK_NOT_READY = '계좌 정보를 불러오지 못했어요';

function bankSub(v: UserRecordView): string {
  if (v.bankPending) {
    return v.bank ? '변경 요청 검토 대기 중 · 승인 전까지 기존 계좌 사용' : '승인 대기 중';
  }
  if (v.bank?.bankbookChangedAt) {
    return `통장사본 최종 변경 ${dotDate(v.bank.bankbookChangedAt)}`;
  }
  if (v.bankUnavailable) {
    return BANK_NOT_READY;
  }
  return v.profileOnly ? NOT_READY : '';
}

export interface ReviewLinkCopy {
  /** /submissions/{id}?month=YYYY-MM */
  id: string;
  month: string;
  label: string;
  /** Waiting for a decision: the call to action, not only a look */
  waiting: boolean;
}

/** The way from a student's page to this month's review (null when nothing is submitted) */
export function reviewLink(v: UserRecordView): ReviewLinkCopy | null {
  const cm = v.currentMonth;
  if (!cm?.submissionId || cm.status === 'missing') {
    return null;
  }
  const waiting = cm.status === 'pending_review' || cm.status === 'resubmitted';
  return {
    id: cm.submissionId,
    month: cm.month,
    waiting,
    label: waiting ? '이번 달 제출 검토하기 →' : '이번 달 제출 보기 →',
  };
}

export interface RecordCardCopy {
  label: string;
  value: string;
  sub: string;
}

/** The three cards. The account is masked: the bank and "•••• 1234", never the number. */
export function recordCards(v: UserRecordView): RecordCardCopy[] {
  const cm = v.currentMonth;
  return [
    {
      label: '취업 상태',
      value: v.employed ? '취업 중' : '미취업',
      sub: v.employmentChangedAt ? `최근 변경 ${dotDate(v.employmentChangedAt)}` : '변경 이력 없음',
    },
    {
      label: '받을 계좌',
      value: v.bank
        ? `${v.bank.bankName} · •••• ${v.bank.last4}`
        : v.bankPending
          ? `${v.bankPending.bankName} · •••• ${v.bankPending.last4}`
          : v.profileOnly || v.bankUnavailable
            ? '—'
            : '등록된 계좌 없음',
      sub: bankSub(v),
    },
    cm
      ? {
          label: '이번 달 제출',
          value: cm.status === 'missing' ? '미제출' : BADGE_LABELS[cm.status],
          sub: `고용보험가입내역서 · ${monthLabel(cm.month)}`,
        }
      : { label: '이번 달 제출', value: '—', sub: NOT_READY },
  ];
}

export interface RecordRowCopy {
  when: string;
  month: string;
  action: string;
  actor: string;
}

/** A submit line whose submission is still waiting for review says so (api.md's labels). */
function waitingNote(row: UserRecordRow): string | undefined {
  const waiting =
    row.submissionStatus === 'pending_review' || row.submissionStatus === 'resubmitted';
  return waiting && (row.action === 'submitted' || row.action === 'resubmitted')
    ? STATUS_LABELS[row.submissionStatus!]
    : undefined;
}

/** "09.21 09:41" / "2026년 9월" / "서류 제출 · 검토 대기" / "동민" or the staff role */
export function recordRows(rows: UserRecordRow[]): RecordRowCopy[] {
  return rows.map((r) => ({
    when: `${dotMonthDay(r.at)} ${hourMinute(r.at)}`,
    month: monthLabel(r.month),
    action: [RECORD_ACTION_LABELS[r.action], waitingNote(r)].filter(Boolean).join(' · '),
    actor: r.actor.role === 'student' ? r.actor.name : ROLE_LABELS[r.actor.role],
  }));
}

export function initialDocsCaption(v: UserRecordView): string {
  if (v.profileOnly) {
    return v.initialSubmitted ? '최초 서류 등록 완료' : '최초 서류 미등록';
  }
  const { approvedAt, docs } = v.initialDocs;
  return [
    approvedAt ? `최초 승인 ${dotDate(approvedAt)}` : '최초 승인 전',
    `${docs.length}종 보관 중`,
  ].join(' · ');
}

export function docName(docType: keyof typeof DOC_TYPE_LABELS): string {
  return DOC_TYPE_LABELS[docType];
}

/** Shown when the role may not open originals (only operator and accountant may) */
export const NO_ORIGINALS_NOTE = '원본은 운영·회계 담당자만 열 수 있어요.';

/** The empty state of the record table: not yet known, or really nothing happened */
export function recordsEmpty(v: UserRecordView): string {
  return v.profileOnly
    ? '검토 및 변경 기록은 관리자 API가 준비되면 나와요.'
    : '아직 기록이 없어요.';
}

/** The empty state of the 최초 제출 서류 card */
export function docsEmpty(v: UserRecordView): string {
  return v.profileOnly ? '서류 목록은 관리자 API가 준비되면 나와요.' : '보관 중인 서류가 없어요.';
}
