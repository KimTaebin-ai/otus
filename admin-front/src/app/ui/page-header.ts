import { Component, input } from '@angular/core';

/**
 * Head of an admin page: teal `eyebrow`, page title, optional muted `description`. An element
 * with the `headerAction` attribute goes to the right (A18's main button, A07's month select).
 */
@Component({
  selector: 'app-page-header',
  template: `
    <div class="text">
      <p class="eyebrow">{{ eyebrow() }}</p>
      <h1>{{ heading() }}</h1>
      @if (description(); as text) {
        <p class="description">{{ text }}</p>
      }
    </div>
    <div class="action"><ng-content select="[headerAction]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
    }

    .text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    p,
    h1 {
      margin: 0;
    }

    .eyebrow {
      font-size: var(--font-size-caption);
      color: var(--color-teal);
    }

    h1 {
      font-size: var(--font-size-page-title);
      line-height: 1.3;
      font-weight: var(--font-weight-bold);
    }

    .action {
      margin-top: var(--space-3);
    }

    @media (max-width: 600px) {
      :host {
        flex-wrap: wrap;
      }

      .action {
        margin-top: 0;
      }
    }

    .description {
      font-size: var(--font-size-body);
      color: var(--color-muted);
    }
  `,
})
export class PageHeader {
  readonly eyebrow = input.required<string>();
  readonly heading = input.required<string>();
  readonly description = input<string>();
}
