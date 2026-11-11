import { monthNumber } from '@otus/shared/core/format';

/** "2026-09" → "2026년 9월" */
export function monthLabel(month: string): string {
  return `${month.slice(0, 4)}년 ${monthNumber(month)}월`;
}
