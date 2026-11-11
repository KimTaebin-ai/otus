import { Component, computed, input } from '@angular/core';

import { hoursText } from '../core/format';
import { TimeThreshold } from '../core/time-requirement';

/**
 * 시간 요건 progress bar: filled up to the recognized time, with a mark and an "n시간" label at
 * each threshold. The bar ends at the top threshold (80시간); more time keeps it full.
 */
@Component({
  selector: 'app-hours-bar',
  template: `
    <div
      class="track"
      role="progressbar"
      aria-valuemin="0"
      [attr.aria-valuemax]="max()"
      [attr.aria-valuenow]="clamped()"
      [attr.aria-valuetext]="valueText()"
    >
      <span class="fill" [attr.data-tier]="tier()" [style.width.%]="percent(clamped())"></span>
      <!-- the top threshold is the bar's end, so it needs no mark -->
      @for (t of thresholds(); track t.seconds; let last = $last) {
        @if (!last) {
          <span class="mark" [style.left.%]="percent(t.seconds)"></span>
        }
      }
    </div>
    <div class="labels" aria-hidden="true">
      @for (t of thresholds(); track t.seconds) {
        <span [style.left.%]="percent(t.seconds)">{{ hoursText(t.seconds) }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .track {
      position: relative;
      height: var(--height-hours-bar);
      border-radius: var(--radius-pill);
      background: var(--hours-bar-track);
      overflow: hidden;
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--hours-bar-fill);
    }
    /* 0 = short of the first tier, 1 = first tier (40시간) reached, 2 = top tier (80시간) reached */
    .fill[data-tier='0'] {
      background: var(--hours-bar-fill-low);
    }
    .fill[data-tier='1'] {
      background: var(--hours-bar-fill);
    }
    .fill[data-tier='2'] {
      background: var(--hours-bar-fill-top);
    }
    .mark {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      margin-left: -2px;
      background: var(--color-surface);
    }
    .labels {
      position: relative;
      height: calc(var(--font-size-caption) * 1.6);
      margin-top: calc(var(--space-1) / 2);
      font-size: var(--font-size-caption);
      color: var(--hours-bar-mark);
    }
    .labels span {
      position: absolute;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .labels span:last-child {
      transform: translateX(-100%);
    }
  `,
})
export class HoursBar {
  readonly seconds = input.required<number>();
  /** Ascending by seconds */
  readonly thresholds = input.required<TimeThreshold[]>();

  protected readonly max = computed(() => this.thresholds().at(-1)?.seconds ?? 0);
  protected readonly clamped = computed(() => Math.min(this.seconds(), this.max()));
  /** How many tiers are reached, capped at 2 so more tiers keep the top color */
  protected readonly tier = computed(() =>
    Math.min(this.thresholds().filter((t) => this.seconds() >= t.seconds).length, 2),
  );
  protected readonly valueText = computed(() => `${hoursText(this.seconds())} 인정`);
  protected readonly hoursText = hoursText;

  protected percent(seconds: number): number {
    const max = this.max();
    return max > 0 ? (seconds / max) * 100 : 0;
  }
}
