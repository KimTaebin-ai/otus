// 시간 요건(로그인 인정 시간) 카드의 화면용 타입과 상태 → 문구.
//
// api.md에 아직 시간 요건 API가 없다 (제안서: docs/api-proposal-eligibility.md). 그래서 이 타입은
// API 응답이 아니라 카드가 보여줄 값만 담는다. API가 생기면 응답 → 이 타입 변환 함수만 추가한다.
// 시간·금액·판정 시각은 전부 서버 값: 프런트는 기준 시간이나 판정 시각을 계산하지 않는다.
//
// 문구 규칙: 월중은 "달성(예상)"까지만, 지난달은 "시간 요건"까지만 말한다. 수령 대상은
// final(운영팀 확정)이 있을 때만 말한다. 시간 요건 충족을 "지원금을 받는다"로 쓰지 않는다.

import { hourMinute, hoursText, monthDay, monthNumber, wonText } from './format';

/** U+2060 WORD JOINER: invisible, forbids a line break between its neighbours */
export const NO_BREAK = '\u2060';

/** One tier of the policy: e.g. 40시간 → 50만 원 */
export interface TimeThreshold {
  seconds: number;
  /** won */
  amount: number;
}

/** This month, still being counted */
export interface CurrentMonthView {
  /** "2026-10" */
  month: string;
  /** When the count was last updated (KST ISO) */
  asOf: string;
  recognizedSeconds: number;
  /** Ascending by seconds */
  thresholds: TimeThreshold[];
  /** When the month is decided, e.g. "2026-11-01T09:00:00+09:00" */
  decidesAt: string;
}

export type TimeResultStatus = 'met' | 'not_met' | 'on_hold';
export type FinalStatus = 'undecided' | 'eligible' | 'not_eligible';

/** Last month: waiting for the decision, or decided */
export interface PreviousMonthView {
  month: string;
  recognizedSeconds: number;
  thresholds: TimeThreshold[];
  decidesAt: string;
  /** null until the decision runs (awaiting_decision) */
  result: {
    status: TimeResultStatus;
    /** The tier reached when met (won), else null */
    amount: number | null;
  } | null;
  /** Staff's final 수령 대상 decision; wins over `result` once it's not undecided */
  final: {
    status: FinalStatus;
    /** won, when eligible */
    amount: number | null;
  };
}

/** Badge colors (--badge-hours-<tone>-* in _tokens.scss) */
export type TimeTone =
  'progress' | 'projected' | 'waiting' | 'met' | 'not-met' | 'on-hold' | 'eligible' | 'ineligible';

export type CurrentState = 'no_record' | 'below' | 'projected';
export type PreviousState =
  'awaiting_decision' | 'not_met' | 'met' | 'on_hold' | 'eligible' | 'not_eligible';

export interface TimeCopy<S> {
  state: S;
  tone: TimeTone;
  badge: string;
  title: string;
  lines: string[];
}

/** "50만 원 구간" */
export function tierLabel(amount: number): string {
  return `${wonText(amount)} 구간`;
}

export function currentCopy(v: CurrentMonthView): TimeCopy<CurrentState> {
  const month = monthNumber(v.month);
  const reached = v.thresholds.filter((t) => v.recognizedSeconds >= t.seconds).at(-1);
  const next = v.thresholds.find((t) => v.recognizedSeconds < t.seconds);
  // under a minute left would cut down to "0시간": say so instead. NO_BREAK keeps "구간(40시간)까지"
  // one word: Chrome breaks around the parentheses even with word-break: keep-all.
  const left = next ? next.seconds - v.recognizedSeconds : 0;
  const remaining = next
    ? `${tierLabel(next.amount)}${NO_BREAK}(${hoursText(next.seconds)})${NO_BREAK}까지 ${left < 60 ? '1분 미만' : hoursText(left)} 남았어요`
    : null;
  const decides = `${monthDay(v.decidesAt)} ${hourMinute(v.decidesAt)}에 시간 요건을 판정해요.`;

  if (reached) {
    return {
      state: 'projected',
      tone: 'projected',
      badge: '달성(예상)',
      title: `${tierLabel(reached.amount)} 시간을 채웠어요`,
      lines: [
        `${month}월 인정 ${hoursText(v.recognizedSeconds)}${remaining ? ` · ${remaining}` : ''}`,
        `판정 전 예상이에요. ${decides}`,
        '수령 대상은 서류 승인과 함께 운영팀이 정해요.',
      ],
    };
  }
  return {
    state: v.recognizedSeconds === 0 ? 'no_record' : 'below',
    tone: 'progress',
    badge: '집계 중',
    title:
      v.recognizedSeconds === 0
        ? '아직 시간을 채우지 못했어요'
        : `${month}월 인정 ${hoursText(v.recognizedSeconds)}`,
    lines: [...(remaining ? [remaining] : []), decides],
  };
}

export function previousCopy(v: PreviousMonthView): TimeCopy<PreviousState> {
  const month = monthNumber(v.month);
  const hours = `인정 ${hoursText(v.recognizedSeconds)}`;
  const result = v.result;

  if (!result) {
    return {
      state: 'awaiting_decision',
      tone: 'waiting',
      badge: '판정 대기',
      title: `${month}월 시간 요건을 판정하고 있어요`,
      lines: [`${monthDay(v.decidesAt)} ${hourMinute(v.decidesAt)}에 결과가 나와요.`],
    };
  }
  // final wins once staff decided; a not_met month stays "not met", which already says why
  if (v.final.status === 'eligible') {
    const amount = v.final.amount ?? result.amount;
    return {
      state: 'eligible',
      tone: 'eligible',
      badge: '수령 대상',
      title: `${month}월 수령 대상으로 확정됐어요`,
      lines: [`${amount !== null ? `${wonText(amount)} · ` : ''}지급 일정은 따로 안내해드릴게요.`],
    };
  }
  if (v.final.status === 'not_eligible' && result.status !== 'not_met') {
    return {
      state: 'not_eligible',
      tone: 'ineligible',
      badge: '해당 없음',
      title: `${month}월은 수령 대상이 아니에요`,
      lines: ['운영팀 확인 결과예요. 궁금한 점은 운영팀에 문의해주세요.'],
    };
  }
  switch (result.status) {
    case 'met':
      return {
        state: 'met',
        tone: 'met',
        badge: '시간 요건 충족',
        title: `${month}월 · ${result.amount !== null ? tierLabel(result.amount) : '시간 요건 충족'}`,
        lines: [hours, '수령 대상은 서류 승인 후 운영팀이 확정해요.'],
      };
    case 'not_met': {
      const first = v.thresholds[0];
      return {
        state: 'not_met',
        tone: 'not-met',
        badge: '미충족',
        title: `${month}월 시간 요건을 채우지 못했어요`,
        lines: [first ? `${hours} · 기준 ${hoursText(first.seconds)}` : hours],
      };
    }
    case 'on_hold':
      return {
        state: 'on_hold',
        tone: 'on-hold',
        badge: '판단 보류',
        title: `${month}월 시간 판정을 확인하고 있어요`,
        lines: ['운영팀이 확인한 뒤 알려드릴게요.'],
      };
  }
}
