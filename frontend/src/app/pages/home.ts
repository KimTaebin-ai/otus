import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { Cycle, Submission } from '../core/api.models';
import { chainOutcome, RevisionPath, revisionPath } from '../core/revision';
import { ApiService, errorMessage } from '../core/api.service';
import { Card } from '@otus/shared/ui/card';
import { Spinner } from '@otus/shared/ui/spinner';
import { HomeDue } from './home-due';
import { HomeSubmitted } from './home-submitted';

/** Rows in "최근 제출 내역" */
const RECENT_LIMIT = 3;

type HomeState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      cycle: Cycle;
      /** Newest final submission for the cycle's target month; null → the "due" layout */
      current: Submission | null;
      recent: Submission[];
      /** Where "보완 제출하기" goes for `current` */
      revisionLink: RevisionPath;
    };

/**
 * U03 홈. Picks one of two layouts by whether the current target month has a final submission
 * (GET /api/submissions?month=, drafts excluded):
 * - HomeSubmitted (final U03-home-submitted.png): yes.
 * - HomeDue (final U03-home-due.png): no.
 */
@Component({
  selector: 'app-home',
  imports: [Card, HomeDue, HomeSubmitted, Spinner],
  template: `
    @if (state(); as s) {
      @if (s.kind === 'loading') {
        <!-- only the cards wait; the sidebar and top bar stay put -->
        <div class="loading-cards">
          <app-card heading="이번 달 제출">
            <app-spinner size="card" />
          </app-card>
          <app-card heading="최근 제출 내역">
            <app-spinner size="card" />
          </app-card>
        </div>
      } @else if (s.kind === 'error') {
        <p class="load-error" role="alert">{{ s.message }}</p>
      } @else if (s.kind === 'ready') {
        @if (s.current; as current) {
          <app-home-submitted
            [cycle]="s.cycle"
            [current]="current"
            [recent]="s.recent"
            [revisionLink]="s.revisionLink"
          />
        } @else {
          <app-home-due [cycle]="s.cycle" />
        }
      }
    }
  `,
  styleUrl: './home.css',
})
export class Home {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.currentCycle().pipe(
      switchMap((cycle) =>
        forkJoin({
          month: this.api.listSubmissions({ month: cycle.target_month }),
          // all of them: the 최초 4종 may be older than the rows shown
          all: this.api.listSubmissions(),
        }).pipe(
          map(({ month, all }): HomeState => {
            const current =
              pendingInitial(all.items) ?? month.items.find((s) => s.submitted_at) ?? null;
            return {
              kind: 'ready',
              cycle,
              // a revision request on the 최초 4종 comes first, whatever month it belongs to
              current,
              recent: all.items.slice(0, RECENT_LIMIT),
              revisionLink: current ? revisionPath(current, all.items) : '/submit',
            };
          }),
        ),
      ),
      catchError((err: unknown) => of<HomeState>({ kind: 'error', message: errorMessage(err) })),
    ),
    { initialValue: { kind: 'loading' } as HomeState },
  );
}

/** The newest submission of the initial chain when it is waiting for the student's 보완 제출. */
function pendingInitial(items: Submission[]): Submission | null {
  const latest = chainOutcome(items, 'initial')?.latest;
  return latest?.status === 'revision_requested' ? latest : null;
}
