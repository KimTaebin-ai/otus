import { Component, input, output } from '@angular/core';

export interface MonthOption {
  value: string;
  label: string;
}

/** The "2026년 9월 ⌄" select at the right of a page header (A07). A native select, restyled. */
@Component({
  selector: 'app-month-select',
  template: `
    <select [attr.aria-label]="label()" (change)="changed.emit($any($event.target).value)">
      @for (option of options(); track option.value) {
        <option [value]="option.value" [selected]="option.value === value()">
          {{ option.label }}
        </option>
      }
    </select>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }

    select {
      appearance: none;
      height: var(--height-button);
      padding: 0 var(--space-5) 0 var(--space-alert);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-ink);
      font: inherit;
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
    }

    select:focus-visible {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }

    svg {
      position: absolute;
      top: 50%;
      right: var(--space-2);
      width: calc(var(--size-icon) * 0.75);
      height: calc(var(--size-icon) * 0.75);
      transform: translateY(-50%);
      fill: none;
      stroke: var(--color-ink);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
  `,
})
export class MonthSelect {
  readonly options = input.required<MonthOption[]>();
  readonly value = input.required<string>();
  readonly label = input('월 선택');
  readonly changed = output<string>();
}
