import { Component, input } from '@angular/core';

/**
 * Mint info box with a teal shield icon (docs/design/README.md "정보 박스"): teal `heading`,
 * optional `detail` after it, muted body from the projected content. E.g. U02 "이번 달 접수 기간".
 * The shield is teal except in the red tone.
 */
@Component({
  selector: 'app-info-box',
  host: { '[class]': 'tone()' },
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10c-4-1.5-7-5.5-7-10V6z M9 12l2 2l4-4" />
    </svg>
    <div class="text">
      <strong>
        {{ heading() }}
        @if (detail(); as text) {
          <span class="detail">{{ text }}</span>
        }
      </strong>
      <div class="body"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-alert);
      padding: var(--space-alert);
      border-radius: var(--radius-md);
      background: var(--color-mint);
    }

    :host(.amber) {
      background: var(--color-amber-bg);
    }

    :host(.amber) strong {
      color: var(--color-amber);
    }

    :host(.red) {
      background: var(--color-red-bg);
    }

    :host(.red) strong {
      color: var(--color-red);
    }

    :host(.red) svg {
      stroke: var(--color-red);
    }

    :host(.white) {
      border: var(--border-width) solid var(--color-border);
      background: var(--color-surface);
    }

    svg {
      flex: none;
      width: var(--size-icon);
      height: var(--size-icon);
      fill: none;
      stroke: var(--color-teal);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    strong {
      font-size: var(--font-size-alert-title);
      font-weight: var(--font-weight-medium);
      color: var(--color-teal);
    }

    .detail {
      margin-left: calc(var(--space-1) / 2);
    }

    .body {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }
  `,
})
export class InfoBox {
  readonly heading = input.required<string>();
  /** Shown after the heading with a gap, e.g. the period "10.01 – 10.31". */
  readonly detail = input<string>();
  /** mint is the default; amber = U02 closed, white = U04 closed, red = U05 supplement (final). */
  readonly tone = input<'mint' | 'amber' | 'white' | 'red'>('mint');
}
