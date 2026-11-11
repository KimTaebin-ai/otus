import { Component, input } from '@angular/core';

let nextId = 0;

/**
 * A label over a white bordered box that holds the projected controls (A12's search and 보기,
 * A13's 포함 자료 and 추가 자료). The box is a labelled group; a lone input in it should also
 * carry its own `aria-label`.
 */
@Component({
  selector: 'app-field',
  template: `
    <span class="label" [id]="id">{{ label() }}</span>
    <div class="box" role="group" [attr.aria-labelledby]="id"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .label {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
    }

    .box {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: calc(var(--height-button) + var(--space-1) / 2);
      padding: 0 var(--space-alert);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      font-size: var(--font-size-body);
    }

    .box:focus-within {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
  protected readonly id = `field-${nextId++}`;
}
