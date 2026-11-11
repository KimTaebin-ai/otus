import { Injectable, computed, signal } from '@angular/core';

import { workingMonthAt } from './study-hours';

/** The server supplies the current month; navigation keeps the selected month across pages. */
@Injectable({ providedIn: 'root' })
export class AdminMonth {
  readonly selected = signal<string | null>(null);
  readonly current = signal<string | null>(null);
  /**
   * The month the staff are working in, from today's date (not chosen): its review judges the
   * month before it, see `reviewWindow`.
   */
  readonly working = signal(workingMonthAt(Date.now()));
  /** How many review windows back from today's the staff are looking at: 0 = now, -1 = the one before */
  readonly offset = signal(0);
  /** The window being looked at: today's working month, or an earlier one (never a later one) */
  readonly viewing = computed(() => adjacentMonth(this.working(), this.offset()) ?? this.working());
  /** A later window than today's does not exist yet */
  readonly canGoNext = computed(() => this.offset() < 0);

  /** Move to the window before (-1) or after (+1); the next one past today's is refused. */
  step(delta: -1 | 1): void {
    const next = this.offset() + delta;
    if (next > 0) return;
    this.offset.set(next);
  }
}

export function isAdminMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '0001-01' && value <= '9998-12';
}

export function adjacentMonth(month: string | null, offset: number): string | null {
  if (!month || !isAdminMonth(month)) return null;
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + offset;
  const value = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
  return isAdminMonth(value) ? value : null;
}
