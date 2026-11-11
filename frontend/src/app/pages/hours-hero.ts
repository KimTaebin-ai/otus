import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HoursBar } from '@otus/shared/ui/hours-bar';
import { catchError, map, of } from 'rxjs';

import { Me } from '../core/api.models';
import { ApiService } from '../core/api.service';
import { expectedPayout, hoursHeroCopy } from '../core/hours-hero';
import { toCurrentView } from '../core/time-requirement-view';

/**
 * A compact qualification summary using GET /api/me.study_hours, with the 시간 요건 progress bar
 * under it. The bar reads the current month's recognized seconds and thresholds from
 * GET /api/me/time-requirements; if that fails, the bar is left out and the headline stays.
 */
@Component({
  selector: 'app-hours-hero',
  imports: [HoursBar],
  template: `
    <section class="hours-hero" aria-labelledby="hours-title">
      <h2 id="hours-title">자격 요건</h2>
      <div class="summary">
        @if (copy(); as c) {
          <p class="headline" [attr.data-tone]="c.tone">{{ c.headline }}</p>
        } @else {
          <p class="failed" role="alert">자격 요건을 불러오지 못했어요. 새로고침해 주세요.</p>
        }
        @if (expected(); as e) {
          <p class="expected">
            <span class="label">{{ e.label }}</span>
            <strong class="amount">{{ e.amount }}</strong>
          </p>
        }
      </div>
      @if (bar(); as b) {
        <app-hours-bar class="bar" [seconds]="b.recognizedSeconds" [thresholds]="b.thresholds" />
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .hours-hero {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-1) var(--space-3);
    }
    .bar {
      margin-top: var(--space-1);
    }
    @media (max-width: 600px) {
      .hours-hero {
        padding: var(--space-2);
      }
      .summary {
        align-items: flex-start;
        flex-direction: column;
      }
      .expected {
        align-items: flex-start;
        text-align: left;
      }
    }
    h2,
    p {
      margin: 0;
      word-break: keep-all;
    }
    h2 {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
      color: var(--color-teal);
    }
    .headline {
      font-size: var(--font-size-feature-title);
      font-weight: var(--font-weight-bold);
      line-height: 1.3;
      color: var(--color-teal);
    }
    .headline[data-tone='progress'] {
      color: var(--color-amber);
    }
    .expected {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      text-align: right;
    }
    .expected .label {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }
    .expected .amount {
      font-size: var(--font-size-feature-title);
      font-weight: var(--font-weight-bold);
      line-height: 1.3;
      color: var(--color-ink);
    }
    .failed {
      font-size: var(--font-size-caption);
      color: var(--color-red);
    }
  `,
})
export class HoursHero {
  readonly studyHours = input.required<Me['study_hours']>();
  protected readonly copy = computed(() => hoursHeroCopy(this.studyHours()));
  private readonly requirements = toSignal(
    inject(ApiService)
      .timeRequirements({ limit: 2 })
      .pipe(
        map((list) => list.items.find((item) => item.phase === 'in_progress') ?? null),
        catchError(() => of(null)),
      ),
    { initialValue: null },
  );
  protected readonly bar = computed(() => {
    const item = this.requirements();
    return item ? toCurrentView(item) : null;
  });
  protected readonly expected = computed(() => {
    const item = this.requirements();
    return item ? expectedPayout(item) : null;
  });
}
