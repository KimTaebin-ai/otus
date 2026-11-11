import { Component, input } from '@angular/core';

/**
 * Dashed panel with a clock icon, a bold title, a body line and a small hint. It stands in for
 * the upload area before the period opens (final U04-monthly-upcoming.png).
 */
@Component({
  selector: 'app-notice-panel',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
    <strong>{{ heading() }}</strong>
    <span class="body">{{ body() }}</span>
    @if (hint(); as text) {
      <span class="hint">{{ text }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-1);
      min-height: 248px;
      padding: var(--space-3);
      border: var(--border-width) dashed var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg);
      text-align: center;
    }

    svg {
      width: var(--size-icon);
      height: var(--size-icon);
      margin-bottom: var(--space-1);
      fill: none;
      stroke: var(--color-muted);
      stroke-width: 2;
      stroke-linecap: round;
    }

    strong {
      font-size: var(--font-size-feature-title);
      font-weight: var(--font-weight-bold);
    }

    .body {
      margin-bottom: var(--space-1);
      color: var(--color-muted);
    }

    .hint {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }
  `,
})
export class NoticePanel {
  readonly heading = input.required<string>();
  readonly body = input.required<string>();
  readonly hint = input<string>();
}
