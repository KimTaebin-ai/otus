import { Component, input } from '@angular/core';

/**
 * Sidebar "도움이 필요하신가요?" card (final U03-home-due.png). The "도움말 보기 →" link shows
 * only when `href` is set: there is no help page yet.
 */
@Component({
  selector: 'app-help-card',
  template: `
    <aside class="help" aria-labelledby="help-title">
      <p id="help-title" class="title">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17h.01"
          />
        </svg>
        도움이 필요하신가요?
      </p>
      <p class="body">준비부터 제출까지<br />차근차근 안내해드릴게요.</p>
      @if (href(); as url) {
        <a class="link" [href]="url" target="_blank" rel="noopener noreferrer">도움말 보기 →</a>
      }
    </aside>
  `,
  styles: `
    .help {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-alert);
      border-radius: var(--radius-md);
      background: var(--color-bg);
    }
    p {
      margin: 0;
    }
    .title {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      font-size: var(--font-size-caption);
      color: var(--color-ink);
    }
    svg {
      flex: none;
      width: var(--space-2);
      height: var(--space-2);
      fill: none;
      stroke: var(--color-teal);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .body {
      font-size: var(--font-size-caption);
      line-height: 1.6;
      color: var(--color-muted);
    }
    .link {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
      color: var(--color-teal);
      text-decoration: none;
    }
  `,
})
export class HelpCard {
  /** Where "도움말 보기" goes; null hides the link */
  readonly href = input<string | null>(null);
}
