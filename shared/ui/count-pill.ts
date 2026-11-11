import { Component, computed, input } from '@angular/core';

/**
 * "0 / 4개 준비" pill (gray), turning into the mint "4 / 4개 준비 완료" when everything is
 * ready (docs/design/README.md "count pill"). Goes in a card's `[cardAction]` slot.
 */
@Component({
  selector: 'app-count-pill',
  template: `{{ done() }} / {{ total() }}개 준비{{ complete() ? ' 완료' : '' }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      height: var(--height-badge);
      padding: 0 var(--space-badge-x);
      border-radius: var(--radius-pill);
      background: var(--color-bg);
      color: var(--color-muted);
      font-size: var(--font-size-caption);
      white-space: nowrap;
    }

    :host(.complete) {
      background: var(--color-mint);
      color: var(--color-teal);
    }
  `,
  host: { '[class.complete]': 'complete()' },
})
export class CountPill {
  readonly done = input.required<number>();
  readonly total = input.required<number>();

  protected readonly complete = computed(() => this.total() > 0 && this.done() >= this.total());
}
