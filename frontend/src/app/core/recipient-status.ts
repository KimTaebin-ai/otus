import { hoursText, monthNumber, wonText } from '@otus/shared/core/format';
import { CurrentMonthView, tierLabel } from '@otus/shared/core/time-requirement';

/** What the home "수령 대상" box says about this month. */
export interface RecipientStatus {
  /** Box label, e.g. "수령 대상 · 10월" */
  label: string;
  value: string;
  /** eligible = teal, not-eligible = red: the box colors its value and background by it */
  tone: 'eligible' | 'not-eligible';
  sub: string;
}

/**
 * Am I a 수령 대상 this month? It follows this month's recognized hours against the tiers of the
 * response. While the month runs it is an estimate ("예상"); only staff's `final` makes it
 * "대상 확정" or "해당 없음".
 */
export function recipientStatus(
  v: CurrentMonthView,
  final: { status: 'undecided' | 'eligible' | 'not_eligible'; amount: number | null } | null = null,
): RecipientStatus {
  const label = `수령 대상 · ${monthNumber(v.month)}월`;
  if (final?.status === 'eligible') {
    return {
      label,
      value: '대상 확정',
      tone: 'eligible',
      sub: `${final.amount !== null ? `${wonText(final.amount)} · ` : ''}지급 일정은 따로 안내해드릴게요.`,
    };
  }
  if (final?.status === 'not_eligible') {
    return { label, value: '해당 없음', tone: 'not-eligible', sub: '운영팀 확인 결과예요.' };
  }
  const reached = v.thresholds.filter((t) => v.recognizedSeconds >= t.seconds).at(-1);
  if (reached) {
    return {
      label,
      value: '대상 (예상)',
      tone: 'eligible',
      sub: `${tierLabel(reached.amount)} 시간을 채웠어요. 서류 승인과 함께 운영팀이 확정해요.`,
    };
  }
  const first = v.thresholds[0];
  return {
    label,
    value: '대상 아님 (예상)',
    tone: 'not-eligible',
    sub: first
      ? `${hoursText(first.seconds)}을 채우면 ${tierLabel(first.amount)} 대상이 돼요.`
      : '시간을 집계하고 있어요.',
  };
}
