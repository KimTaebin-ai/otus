import { Component, computed, input } from '@angular/core';

import { hourMinute, monthDay } from '@otus/shared/core/format';
import {
  CurrentMonthView,
  PreviousMonthView,
  currentCopy,
  previousCopy,
} from '@otus/shared/core/time-requirement';
import { Card } from '@otus/shared/ui/card';
import { HoursBar } from '@otus/shared/ui/hours-bar';
import { TimeBadge } from '@otus/shared/ui/time-badge';
import { formatMonth } from '../layout/shell';

/**
 * 시간 요건 card: this month's count (월중) and last month's result. A pure display component:
 * the page passes the values in, either part may be null. Not in final; built from tokens.
 * Not on the home page yet: it gets wired in once the time-requirement API exists
 * (docs/api-proposal-eligibility.md). Every state is previewed on /dev/ui.
 */
@Component({
  selector: 'app-time-requirement-card',
  imports: [Card, HoursBar, TimeBadge],
  template: `
    <app-card heading="시간 요건">
      @if (current(); as v) {
        @let copy = currentText()!;
        <section class="part" [attr.data-state]="copy.state">
          <header>
            <span class="label">{{ formatMonth(v.month) }} · {{ asOf(v.asOf) }} 기준</span>
            <app-time-badge [tone]="copy.tone">{{ copy.badge }}</app-time-badge>
          </header>
          <strong class="title">{{ copy.title }}</strong>
          <app-hours-bar [seconds]="v.recognizedSeconds" [thresholds]="v.thresholds" />
          @for (line of copy.lines; track $index) {
            <p class="line">{{ line }}</p>
          }
        </section>
      }
      @if (current() && previous()) {
        <hr />
      }
      @if (previous(); as v) {
        @let copy = previousText()!;
        <section class="part" [attr.data-state]="copy.state">
          <header>
            <span class="label">지난달 · {{ formatMonth(v.month) }}</span>
            <app-time-badge [tone]="copy.tone">{{ copy.badge }}</app-time-badge>
          </header>
          <strong class="title">{{ copy.title }}</strong>
          @for (line of copy.lines; track $index) {
            <p class="line">{{ line }}</p>
          }
        </section>
      }
    </app-card>
  `,
  styles: `
    .part {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-1);
    }
    .label {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }
    .title {
      font-size: var(--font-size-feature-title);
      font-weight: var(--font-weight-bold);
      line-height: 1.4;
    }
    .line {
      margin: 0;
      font-size: var(--font-size-body);
      color: var(--color-muted);
      line-height: 1.6;
      word-break: keep-all;
    }
    hr {
      width: 100%;
      margin: var(--space-1) 0;
      border: 0;
      border-top: var(--border-width) solid var(--color-border);
    }
  `,
})
export class TimeRequirementCard {
  readonly current = input<CurrentMonthView | null>(null);
  readonly previous = input<PreviousMonthView | null>(null);

  protected readonly currentText = computed(() => {
    const v = this.current();
    return v ? currentCopy(v) : null;
  });
  protected readonly previousText = computed(() => {
    const v = this.previous();
    return v ? previousCopy(v) : null;
  });

  protected readonly formatMonth = formatMonth;

  /** "10월 17일 14:00" */
  protected asOf(iso: string): string {
    return `${monthDay(iso)} ${hourMinute(iso)}`;
  }
}
