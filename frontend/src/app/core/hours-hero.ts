import { monthNumber, wonText } from '@otus/shared/core/format';
import { Me, TimeRequirement } from './api.models';

export interface HoursHeroCopy {
  headline: string;
  tone: 'progress' | 'met';
}

/** Display the server's current-month bucket without inferring a payment decision. */
export function hoursHeroCopy(hours: Me['study_hours']): HoursHeroCopy | null {
  switch (hours) {
    case 0:
      return { headline: '40시간 미만 (예상)', tone: 'progress' };
    case 40:
      return { headline: '40시간 이상 (예상)', tone: 'met' };
    case 80:
      return { headline: '80시간 이상 (예상)', tone: 'met' };
    default:
      return null;
  }
}

/**
 * "다음달(11월) 예상 수령 금액" and "50만 원": the month after the one being counted, with the
 * amount of the tier reached so far. The server gives the tier (`projected_tier`) and each tier's
 * won; this is a projection, the 최종 수령 대상 is decided by staff.
 */
export function expectedPayout(item: TimeRequirement): { label: string; amount: string } {
  const [year, month] = item.month.split('-').map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const amount = item.projected_tier
    ? (item.thresholds.find((t) => t.tier === item.projected_tier)?.amount ?? 0)
    : 0;
  return {
    label: `다음달(${monthNumber(next)}월) 예상 수령 금액`,
    amount: amount === 0 ? '0원' : wonText(amount),
  };
}

/** The two parts on one line, for screen readers and tests */
export function expectedPayoutText(item: TimeRequirement): string {
  const { label, amount } = expectedPayout(item);
  return `${label} ${amount}`;
}
