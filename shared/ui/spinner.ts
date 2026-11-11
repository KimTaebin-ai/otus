import { Component, input } from '@angular/core';

/**
 * Loading indicator: a teal ring with a label. Loading belongs to the card that waits for its
 * data: `size="card"` centers it in a card-height area (the sidebar and top bar stay as they
 * are), `inline` is for a short line (e.g. the next page of a list). `page` fills a tall area
 * and is only for the very first load, before any shell exists. Announced as a status.
 */
@Component({
  selector: 'app-spinner',
  template: `
    <span class="ring" aria-hidden="true"></span>
    <span class="label">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: var(--color-muted);
      font-size: var(--font-size-caption);
    }

    :host(.card) {
      display: flex;
      justify-content: center;
      min-height: 9rem;
      padding: var(--space-3) 0;
    }

    :host(.page) {
      display: flex;
      justify-content: center;
      min-height: 40vh;
    }

    .ring {
      width: 28px;
      height: 28px;
      border: 3px solid var(--color-mint);
      border-top-color: var(--color-teal);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .ring {
        animation-duration: 2.4s;
      }
    }
  `,
  host: {
    role: 'status',
    'aria-live': 'polite',
    '[class.page]': "size() === 'page'",
    '[class.card]': "size() === 'card'",
  },
})
export class Spinner {
  readonly label = input('불러오는 중…');
  readonly size = input<'inline' | 'card' | 'page'>('inline');
}
