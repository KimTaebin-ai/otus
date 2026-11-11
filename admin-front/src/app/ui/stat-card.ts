import { Component, input } from '@angular/core';

/**
 * Number card (A00, A07, A18): muted `label`, big `value`, muted `sub`. `layout="row"` puts the
 * texts on the left and the value on the right (A07's three cards); `layout="summary"` is
 * A18's roomier card with a 16px value (text values like "카카오뱅크 · •••• 1234");
 * `tone="mint"` is the mint card without a border (A07 "알림 발송 대상").
 */
@Component({
  selector: 'app-stat-card',
  host: {
    '[class.row]': "layout() === 'row'",
    '[class.summary]': "layout() === 'summary'",
    '[class.mint]': "tone() === 'mint'",
  },
  template: `
    <div class="text">
      <span class="label">{{ label() }}</span>
      @if (layout() !== 'row') {
        <strong class="value">{{ value() }}</strong>
      }
      @if (sub(); as text) {
        <span class="sub">{{ text }}</span>
      }
    </div>
    @if (layout() === 'row') {
      <strong class="value">{{ value() }}</strong>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-alert);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }

    :host(.mint) {
      border-color: transparent;
      background: var(--color-mint);
    }

    :host(.row) {
      padding: calc(var(--space-3) + var(--space-1) / 2) var(--space-alert);
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    :host(.summary) {
      padding: var(--space-3);
    }

    :host(.summary) .text {
      gap: calc(var(--space-1) * 1.5);
    }

    :host(.summary) .value {
      font-size: var(--font-size-card-title);
    }

    .text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .label,
    .sub {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    :host(.row) .label {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
      color: var(--color-ink);
    }

    :host(.mint) .label,
    :host(.mint) .value {
      color: var(--color-teal);
    }

    .value {
      font-size: var(--font-size-feature-title);
      font-weight: var(--font-weight-bold);
    }

    :host(.row) .value {
      font-size: var(--font-size-page-title);
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly sub = input<string>();
  readonly layout = input<'column' | 'row' | 'summary'>('column');
  readonly tone = input<'default' | 'mint'>('default');
}
