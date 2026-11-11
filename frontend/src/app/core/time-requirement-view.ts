import { CurrentMonthView, PreviousMonthView } from '@otus/shared/core/time-requirement';
import { TimeRequirement } from './api.models';

export interface TimeRequirementViews {
  current: CurrentMonthView | null;
  previous: PreviousMonthView | null;
  /** Staff's decision on the current month, if any (normally still undecided) */
  currentFinal: { status: 'undecided' | 'eligible' | 'not_eligible'; amount: number | null } | null;
}

/**
 * GET /api/me/time-requirements (newest first) → what the card shows. Hours, won and times come
 * from the response as is: the thresholds of each month are the only place a tier's amount is read.
 */
export function toTimeRequirementViews(items: TimeRequirement[]): TimeRequirementViews {
  const current = items.find((i) => i.phase === 'in_progress');
  // the newest month that has left in_progress (awaiting_decision or decided)
  const previous = items.find((i) => i.phase !== 'in_progress');
  return {
    current: current ? toCurrentView(current) : null,
    previous: previous ? toPreviousView(previous) : null,
    currentFinal: current ? { status: current.final.status, amount: current.final.amount } : null,
  };
}

export function toCurrentView(i: TimeRequirement): CurrentMonthView {
  return {
    month: i.month,
    asOf: i.as_of,
    recognizedSeconds: i.recognized_seconds,
    thresholds: thresholdsOf(i),
    decidesAt: i.decides_at,
  };
}

export function toPreviousView(i: TimeRequirement): PreviousMonthView {
  const thresholds = thresholdsOf(i);
  const result = i.result;
  return {
    month: i.month,
    recognizedSeconds: i.recognized_seconds,
    thresholds,
    decidesAt: i.decides_at,
    result: result
      ? {
          status: result.status,
          amount: result.tier
            ? (i.thresholds.find((t) => t.tier === result.tier)?.amount ?? null)
            : null,
        }
      : null,
    final: { status: i.final.status, amount: i.final.amount },
  };
}

function thresholdsOf(i: TimeRequirement): { seconds: number; amount: number }[] {
  return i.thresholds.map(({ seconds, amount }) => ({ seconds, amount }));
}
