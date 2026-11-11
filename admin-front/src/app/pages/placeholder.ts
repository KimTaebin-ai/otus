import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** A screen without a design yet: its title (the route's `data.crumb`) and a note. */
@Component({
  selector: 'app-placeholder',
  template: `
    <h1>{{ title }}</h1>
    <p>준비 중이에요.</p>
  `,
  styles: `
    h1 {
      margin: 0 0 var(--space-1);
      font-size: var(--font-size-page-title);
    }
    p {
      margin: 0;
      color: var(--color-muted);
    }
  `,
})
export class Placeholder {
  protected readonly title = String(inject(ActivatedRoute).snapshot.data['crumb'] ?? '');
}
