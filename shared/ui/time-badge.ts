import { Component, input } from '@angular/core';

import { TimeTone } from '../core/time-requirement';

/**
 * Pill badge for the 시간 요건 card, shaped like app-status-badge. The label is projected;
 * colors come from --badge-hours-<tone>-* in _tokens.scss.
 */
@Component({
  selector: 'app-time-badge',
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      height: var(--height-badge);
      padding: 0 var(--space-badge-x);
      border: var(--border-width) solid transparent;
      border-radius: var(--radius-pill);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }
    :host([data-tone='progress']) {
      background: var(--badge-hours-progress-bg);
      color: var(--badge-hours-progress-fg);
    }
    :host([data-tone='projected']) {
      background: var(--badge-hours-projected-bg);
      color: var(--badge-hours-projected-fg);
      border: var(--border-width) dashed var(--badge-hours-projected-border);
    }
    :host([data-tone='waiting']) {
      background: var(--badge-hours-waiting-bg);
      color: var(--badge-hours-waiting-fg);
    }
    :host([data-tone='met']) {
      background: var(--badge-hours-met-bg);
      color: var(--badge-hours-met-fg);
    }
    :host([data-tone='not-met']) {
      background: var(--badge-hours-not-met-bg);
      color: var(--badge-hours-not-met-fg);
    }
    :host([data-tone='on-hold']) {
      background: var(--badge-hours-on-hold-bg);
      color: var(--badge-hours-on-hold-fg);
    }
    :host([data-tone='eligible']) {
      background: var(--badge-hours-eligible-bg);
      color: var(--badge-hours-eligible-fg);
    }
    :host([data-tone='ineligible']) {
      background: var(--badge-hours-ineligible-bg);
      color: var(--badge-hours-ineligible-fg);
    }
  `,
  host: { '[attr.data-tone]': 'tone()' },
})
export class TimeBadge {
  readonly tone = input.required<TimeTone>();
}
