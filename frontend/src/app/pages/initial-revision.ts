import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { Cycle, Submission } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { Outcome, chainOutcome } from '../core/revision';
import { Supplement } from './supplement';

/**
 * 보완 제출 for the 최초 4종 (`/submit/initial`): the same screen as the monthly supplement
 * (U05, `app-supplement`), opened when the newest submission of the initial chain is
 * `revision_requested`. The reviewer picks which of the 4 documents to ask for again
 * (`revision_doc_types`), and the supplement draft asks for just those. Without a pending
 * request there is nothing to do here, so it goes home; so it does after the supplement was sent
 * (the home screen shows 재검토 대기).
 */
@Component({
  selector: 'app-initial-revision',
  imports: [Supplement],
  template: `
    @if (loadError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    } @else if (found(); as o) {
      <app-supplement
        [root]="o.monthly"
        [parent]="o.latest"
        [cycle]="cycle()!"
        (submitted)="done()"
      />
    }
  `,
  styles: `
    .load-error {
      margin: 0;
      color: var(--color-red);
    }
  `,
})
export class InitialRevision {
  private readonly router = inject(Router);

  protected readonly found = signal<Outcome | null>(null);
  protected readonly cycle = signal<Cycle | null>(null);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    const api = inject(ApiService);
    forkJoin({ cycle: api.currentCycle(), list: api.listSubmissions() }).subscribe({
      next: ({ cycle, list }) => {
        const outcome = chainOutcome(list.items, 'initial');
        if (outcome?.latest.status !== 'revision_requested') {
          void this.router.navigateByUrl('/home');
          return;
        }
        this.cycle.set(cycle);
        this.found.set(outcome);
      },
      error: (err: unknown) => this.loadError.set(errorMessage(err)),
    });
  }

  protected done(_submitted?: Submission): void {
    void this.router.navigateByUrl('/home');
  }
}
