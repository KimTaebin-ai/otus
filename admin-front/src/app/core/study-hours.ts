import { monthLabel } from './labels';

/** 지원금 요건: 해당 월 인정 학습 시간 40시간 이상 (api.md: 40·80시간 구간, 하루 12시간 상한) */
export type HoursState = 'met' | 'unmet' | 'unknown';

export interface HoursCheck {
  state: HoursState;
  /** "2026년 9월 학습 시간 · 80시간 이상" */
  headline: string;
  /** What the reviewer should know before approving */
  note: string;
}

const BAND: Record<0 | 40 | 80, string> = {
  0: '40시간 미만',
  40: '40시간 이상 80시간 미만',
  80: '80시간 이상',
};

/**
 * The saved aggregate of the submission's month. The system only suggests: staff still decide,
 * so an unmet or unknown result needs an explicit confirmation before approving.
 */
export function hoursCheck(month: string, hours: 0 | 40 | 80 | null | undefined): HoursCheck {
  const label = `${monthLabel(month)} 학습 시간`;
  if (hours === 0)
    return {
      state: 'unmet',
      headline: `${label} · ${BAND[0]}`,
      note: '지원금 시간 요건(40시간)을 채우지 못했어요.',
    };
  if (hours === 40 || hours === 80)
    return {
      state: 'met',
      headline: `${label} · ${BAND[hours]}`,
      note: '지원금 시간 요건(40시간)을 채웠어요.',
    };
  return {
    state: 'unknown',
    headline: `${label} · 집계 없음`,
    note: '저장된 집계가 없거나 판정이 보류됐어요. 요건을 직접 확인해 주세요.',
  };
}

/** Approving needs no extra step when the requirement is met */
export function needsHoursConfirm(check: HoursCheck | null): boolean {
  return !!check && check.state !== 'met';
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** The KST month of a timestamp, YYYY-MM */
function kstMonth(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function previousMonth(month: string): string {
  const [, y, m] = MONTH_RE.exec(month)!;
  return Number(m) === 1 ? `${Number(y) - 1}-12` : `${y}-${String(Number(m) - 1).padStart(2, '0')}`;
}

/**
 * The month whose study hours the 지원금 is worked out from, for the month the staff are working
 * in: working in October means September's hours, working in November means October's.
 */
export function hoursMonthFor(workingMonth: string): string {
  return previousMonth(workingMonth);
}

/**
 * The working month a submission is reviewed in: what was submitted up to the 15th is judged in
 * that month, the rest in the next one (an October 17th submission is judged in November).
 */
export function workingMonthOf(submittedAt: string): string {
  const month = kstMonth(Date.parse(submittedAt));
  const day = Number(
    new Date(Date.parse(submittedAt) + 9 * 60 * 60 * 1000).toISOString().slice(8, 10),
  );
  return day <= REVIEW_DEADLINE_DAY ? month : nextMonth(month);
}

export type HoursTone = 'low' | 'mid' | 'high' | 'unknown';

/** The colour class and short label of a saved band: 40시간 미만 / 이상 / 80시간 이상 */
export function hoursBand(hours: 0 | 40 | 80 | null | undefined): {
  tone: HoursTone;
  label: string;
} {
  if (hours === 0) return { tone: 'low', label: '40시간 미만' };
  if (hours === 40) return { tone: 'mid', label: '40시간 이상' };
  if (hours === 80) return { tone: 'high', label: '80시간 이상' };
  return { tone: 'unknown', label: '집계 없음' };
}

/** 운영진이 지원금 산출 서류를 검사하는 마감일 (다음 달 15일 전까지). 정책 값이라 한 곳에 둔다. */
export const REVIEW_DEADLINE_DAY = 15;

function nextMonth(month: string): string {
  const [, y, m] = MONTH_RE.exec(month)!;
  return Number(m) === 12
    ? `${Number(y) + 1}-01`
    : `${y}-${String(Number(m) + 1).padStart(2, '0')}`;
}

const monthNo = (month: string): number => Number(month.slice(5, 7));

export interface ReviewWindow {
  /** YYYY-MM of the study hours the 지원금 is worked out from */
  studyMonth: string;
  /** "9월 학습에 대한 지원금 지급 건 검토" */
  title: string;
  /** "9월 1일 ~ 10월 15일 제출분" */
  range: string;
  /** ms since the epoch: the window opens (inclusive) and ends (exclusive), in KST */
  startsAtMs: number;
  endsAtMs: number;
}

/**
 * Working in October means reviewing what was submitted from September 1st to October 15th, for
 * the 지원금 of September's study hours; November covers October 1st to November 15th.
 */
export function reviewWindow(workingMonth: string): ReviewWindow {
  const studyMonth = hoursMonthFor(workingMonth);
  const due = nextMonth(studyMonth);
  return {
    studyMonth,
    title: `${monthNo(studyMonth)}월 학습에 대한 지원금 지급 건 검토`,
    range: `${monthNo(studyMonth)}월 1일 ~ ${monthNo(due)}월 ${REVIEW_DEADLINE_DAY}일 제출분`,
    startsAtMs: Date.parse(`${studyMonth}-01T00:00:00+09:00`),
    // the deadline day is included until its last moment
    endsAtMs: Date.parse(
      `${due}-${String(REVIEW_DEADLINE_DAY + 1).padStart(2, '0')}T00:00:00+09:00`,
    ),
  };
}

export type SubmissionTiming = 'early' | 'in' | 'late';

/** Where a submission falls against the review window: before it, inside it, or after the 15th. */
export function submissionTiming(submittedAt: string, w: ReviewWindow): SubmissionTiming {
  const at = Date.parse(submittedAt);
  return at < w.startsAtMs ? 'early' : at >= w.endsAtMs ? 'late' : 'in';
}

export const TIMING_LABELS: Record<SubmissionTiming, string> = {
  early: '이전 제출',
  in: '검토 기한 내',
  late: '기한 이후 제출',
};

/**
 * The working month today: up to the 15th it is this month (judging last month's study), from the
 * 16th it is next month (judging this month's study). October 18th: November, the 10월 학습 review.
 */
export function workingMonthAt(nowMs: number): string {
  const month = kstMonth(nowMs);
  const day = Number(new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(8, 10));
  return day <= REVIEW_DEADLINE_DAY ? month : nextMonth(month);
}
