import { DOC_TYPE_LABELS, DocType } from '@otus/shared/core/api-types';
import {
  dotDateTime,
  dotMonthDay,
  hourMinute,
  lastMoment,
  monthDay,
  monthNumber,
} from '@otus/shared/core/format';
import { ReviewDecision, ReviewDoc, ReviewEvent, ReviewKind, ReviewView } from './admin.models';
import { monthLabel } from './labels';
import { ROLE_LABELS } from './roles';

/**
 * Screen copy for the document review (A02, A03). Wording of statuses is the student app's
 * (BADGE_LABELS); "승인" is always a document approval, never the 수령 대상 decision.
 * Dates come from the cycle, never from literals (the period starts on the 1st).
 */

/** A reason for asking the student to re-submit: required, at most 1000 characters (same as the dev status API). */
export const REASON_MAX = 1000;
/** The internal memo; the student never sees it. */
export const MEMO_MAX = 2000;

export type ReasonProblem = 'empty' | 'too_long' | null;

export function reasonProblem(reason: string): ReasonProblem {
  const text = reason.trim();
  if (!text) {
    return 'empty';
  }
  return [...text].length > REASON_MAX ? 'too_long' : null;
}

/** Document name for tabs, rows and previews */
export function docLabel(docType: DocType): string {
  return DOC_TYPE_LABELS[docType];
}

export interface Checklist {
  /** Shown above the lines */
  intro: string;
  lines: [string, string, string];
}

const CHECKLISTS: Record<DocType, [string, string, string]> = {
  id_card: [
    '제출자와 서류의 이름이 일치해요',
    '본인 확인에 필요한 정보가 보여요',
    '글자와 사진을 확인할 수 있어요',
  ],
  resident_abstract: [
    '제출자와 서류의 이름이 일치해요',
    '주민등록초본으로 제출했어요',
    '필요한 내용과 모든 페이지가 보여요',
  ],
  bankbook: [
    '예금주가 {name}님과 일치해요',
    '설정된 지급 계좌와 일치해요',
    '은행명과 계좌 정보를 확인할 수 있어요',
  ],
  employment_insurance: [
    '제출자와 서류의 이름이 일치해요',
    '{M}월 1일 이후에 발급된 서류예요',
    '모든 페이지를 확인할 수 있어요',
  ],
};

/** The three "이 서류에서 확인할 내용" lines. The bankbook line uses the student's name. */
export function checklist(docType: DocType, month: string, name: string): Checklist {
  const lines = CHECKLISTS[docType].map((line) =>
    line.replace('{M}', monthNumber(month)).replace('{name}', name),
  ) as Checklist['lines'];
  return { intro: '서류의 이름과 내용을 직접 확인해주세요.', lines };
}

/** The mint box above the insurance checklist: "9월 1일 이후 발급본" + the submission period. */
export function issuedBox(v: ReviewView): { title: string; period: string } {
  if (!v.period) {
    return {
      title: `${monthNumber(v.month)}월 1일 이후 발급본`,
      period: '설정된 제출 기간이 없습니다.',
    };
  }
  const last = lastMoment(v.period.closesAt);
  return {
    title: `${monthNumber(v.month)}월 1일 이후 발급본`,
    period: `제출 기간: ${monthDay(v.period.opensAt)} – ${monthDay(last)} ${hourMinute(last)}`,
  };
}

const KIND_LABELS: Record<ReviewKind, string> = {
  initial: '최초 등록',
  monthly: '월별 제출',
  supplement: '보완 제출',
};

/** "최초 등록 · 서류 4개" */
export function kindSummary(v: ReviewView): string {
  return `${KIND_LABELS[v.kind]} · 서류 ${v.docs.length}개`;
}

/** "2026.09.21 09:41 제출 · 9월 접수 건" */
export function submittedSummary(v: ReviewView): string {
  return `${dotDateTime(v.submittedAt)} 제출 · ${monthNumber(v.month)}월 접수 건`;
}

/** "2026년 9월 · 보완 대상 서류 1개" (the result of a request) */
export function revisionSummary(v: ReviewView, count: number): string {
  return `${monthLabel(v.month)} · 보완 대상 서류 ${count}개`;
}

/** "2026년 9월 · 제출 서류 보완" (while writing the request) */
export function composeSummary(v: ReviewView): string {
  return `${monthLabel(v.month)} · 제출 서류 보완`;
}

export function isInitial(v: ReviewView): boolean {
  return v.kind === 'initial';
}

/** The first word of the wording that changes between the 4 initial documents and one monthly document. */
export function allLabel(v: ReviewView): string {
  return v.docs.length > 1 ? `${v.docs.length}종` : '서류';
}

export function reviewTitle(v: ReviewView): string {
  return isInitial(v)
    ? `${v.name}님의 첫 서류를 확인해주세요`
    : `${v.name}님의 ${monthNumber(v.month)}월 서류를 확인해주세요`;
}

export function reviewDescription(v: ReviewView): string {
  return v.docs.length > 1
    ? `${v.docs.length}종의 PDF를 각각 열어보고, 승인하거나 필요한 서류만 보완을 요청하세요.`
    : 'PDF를 열어보고, 승인하거나 보완이 필요하면 요청하세요.';
}

/** The primary button of the review: "4종 승인 검토" / "승인 검토" */
export function approveReviewLabel(v: ReviewView): string {
  return v.docs.length > 1 ? `${v.docs.length}종 승인 검토` : '승인 검토';
}

/** Under the memo: tells what is still to do before approving. `unseen` = documents not opened yet. */
export function approveHint(v: ReviewView, unseen: number): string {
  if (unseen > 0) {
    return `아직 확인하지 않은 서류가 ${unseen}개 있어요.`;
  }
  return v.docs.length > 1
    ? `승인 전, 위의 ${v.docs.length}종 PDF를 모두 살펴봐주세요.`
    : '승인 전, 위의 PDF를 살펴봐주세요.';
}

export const MEMO_PLACEHOLDER = [
  '확인한 내용을 기록할 수 있어요.',
  '이 메모는 사용자에게 보이지 않아요.',
];

export function confirmTitle(): string {
  return '승인하기 전에 한 번 더 확인해주세요';
}

export function confirmCardTitle(v: ReviewView): string {
  return `승인할 서류 ${v.docs.length}개`;
}

export function confirmApproveLabel(v: ReviewView): string {
  return v.docs.length > 1 ? `${v.docs.length}종 모두 승인하기` : '승인 확정하기';
}

export const AFTER_APPROVAL = [
  '제출 상태가 ‘서류 승인’으로 바뀌어요.',
  '처리 담당자와 시각이 기록돼요.',
  '사용자가 제출 이력에서 결과를 볼 수 있어요.',
  '교육생에게 승인 알림이 가요.',
];

/**
 * "고용보험가입내역서: 2026.09.19 발급 · 9월 1일 이후 발급 기준 충족" for the insurance document,
 * or null when it is not in this submission or has no issue date.
 */
export function issuedCheck(v: ReviewView): string | null {
  const doc = v.docs.find((d) => d.docType === 'employment_insurance');
  if (!doc?.issuedOn) {
    return null;
  }
  const met = doc.issuedOn >= `${v.month}-01`;
  return `${docLabel(doc.docType)}: ${doc.issuedOn.replaceAll('-', '.')} 발급 · ${monthNumber(v.month)}월 1일 이후 발급 기준 ${met ? '충족' : '미충족'}`;
}

export function approvedTitle(v: ReviewView): string {
  return `${v.name}님의 서류를 승인했어요`;
}

export const APPROVED_DESCRIPTION = '검토 결과가 제출 내역에 반영되었습니다.';

/** "최초 등록 서류 4종 확인 완료" / "9월 고용보험가입내역서 확인 완료" */
export function approvedBanner(v: ReviewView): string {
  return isInitial(v)
    ? `최초 등록 서류 ${v.docs.length}종 확인 완료`
    : `${monthNumber(v.month)}월 ${v.docs.map((d) => docLabel(d.docType)).join('·')} 확인 완료`;
}

/** The person who handled it: their role and real name ("운영 담당자 지우"). */
export function handler(actor: ReviewDecision['actor']): string {
  return `${ROLE_LABELS[actor.role]} ${actor.name}`;
}

/** "09.21 10:32 · 운영 담당자 지우님이 서류를 승인했어요." */
export function eventLine(e: ReviewEvent): { when: string; text: string } {
  const who = e.actor.role === 'student' ? `${e.actor.name}님이` : `${handler(e.actor)}님이`;
  const what: Record<ReviewEvent['action'], string> = {
    submitted: '서류를 제출했어요.',
    resubmitted: '보완 서류를 제출했어요.',
    approved: '서류를 승인했어요.',
    revision_requested: '보완을 요청했어요.',
  };
  return { when: `${dotMonthDay(e.at)} ${hourMinute(e.at)}`, text: `${who} ${what[e.action]}` };
}

export function revisionTitle(v: ReviewView): string {
  return `${v.name}님께 보완할 내용을 알려주세요`;
}

export const REVISION_DESCRIPTION =
  '선택한 서류와 사유가 사용자에게 표시됩니다. 내부 메모와 구분해주세요.';

export const REASON_HELP = '사용자가 무엇을 다시 준비해야 하는지 구체적으로 적어주세요.';

/** Why the "보완 요청 확정" button is off, or null when it can be pressed. */
export function revisionBlocker(selected: number, reason: string): string | null {
  if (selected === 0) {
    return '보완을 요청할 서류를 하나 이상 골라주세요.';
  }
  const problem = reasonProblem(reason);
  if (problem === 'empty') {
    return '보완 사유를 적어주세요.';
  }
  return problem === 'too_long' ? `보완 사유는 ${REASON_MAX}자 이하로 적어주세요.` : null;
}

/** "2026.09.30 23:59": the day the period ends, from the cycle */
export function resubmitDue(v: ReviewView): string {
  if (!v.period) return '설정된 제출 기간이 없습니다.';
  return dotDateTime(lastMoment(v.period.closesAt));
}

/** "9월 30일 23:59까지 다시 제출해주세요." */
export function dueSentence(v: ReviewView): string {
  if (!v.period) return '현재 보완 제출을 받을 수 없습니다.';
  const last = lastMoment(v.period.closesAt);
  return `${monthDay(last)} ${hourMinute(last)}까지 다시 제출해주세요.`;
}

export const STUDENT_PREVIEW_NOTES = [
  '선택한 서류만 다시 제출하면 돼요.',
  '기존 파일·기록은 보관 정책에 따라 관리해요.',
];

export function requestedTitle(v: ReviewView): string {
  return `${v.name}님께 보완을 요청했어요`;
}

export const REQUESTED_DESCRIPTION =
  '제출 상태가 재검토 요청으로 바뀌고, 사용자가 사유를 확인할 수 있습니다.';

export const WAITING_BOX = {
  title: '새 파일을 기다리고 있어요',
  body: '사용자가 다시 제출하면 검토 목록에서 ‘재검토 대기’ 상태로 확인할 수 있어요.',
};

/** Docs that are in `types`, keeping the submission's order */
export function pick(docs: ReviewDoc[], types: DocType[]): ReviewDoc[] {
  return docs.filter((d) => types.includes(d.docType));
}

/** 1234567 → "1.2 MB", 840000 → "840 KB" */
export function sizeText(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
