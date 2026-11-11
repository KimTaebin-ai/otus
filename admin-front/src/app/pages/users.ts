import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  catchError,
  debounce,
  distinctUntilChanged,
  map,
  of,
  switchMap,
  tap,
  timer,
} from 'rxjs';

import { USERS_PAGE_SIZE, UserListRow, appendRows, toUserListRow } from '../core/admin-users';
import { ApiService, errorMessage } from '../core/api.service';
import { UsersViewComponent } from './users-view';

/**
 * `/users`: GET /api/admin/users. Typing in the search starts a new list after a short pause
 * (clearing it is immediate); the next page loads on scroll with `before`. The `query` text is
 * matched by the API as a partial, case-insensitive substring over the intra ID (login), the
 * display name and the Korean name (ko_name), so a partial intra ID or a partial Korean name
 * finds the student; each row shows the Korean/display name together with the login.
 */
@Component({
  selector: 'app-users',
  imports: [UsersViewComponent],
  template: `
    <app-users-view
      [rows]="rows()"
      [query]="query()"
      [hasMore]="nextBefore() !== null"
      [loading]="loading()"
      [error]="error()"
      (queryChange)="query.set($event)"
      (more)="loadMore()"
    />
  `,
})
export class Users {
  private readonly api = inject(ApiService);
  private readonly destroyed = inject(DestroyRef);

  protected readonly query = signal('');
  protected readonly rows = signal<UserListRow[]>([]);
  protected readonly nextBefore = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** The (trimmed) search the rows on screen belong to */
  private applied = '';

  constructor() {
    toObservable(this.query)
      .pipe(
        map((q) => q.trim()),
        distinctUntilChanged(),
        debounce((q) => (q === '' ? of(0) : timer(300))),
        tap((q) => {
          this.applied = q;
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((q) =>
          this.api.adminUsers({ query: q, limit: USERS_PAGE_SIZE }).pipe(
            catchError((err: unknown) => {
              this.rows.set([]);
              this.nextBefore.set(null);
              this.error.set(errorMessage(err));
              this.loading.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((page) => {
        this.rows.set(page.items.map(toUserListRow));
        this.nextBefore.set(page.next_before);
        this.loading.set(false);
      });
  }

  protected loadMore(): void {
    const before = this.nextBefore();
    if (before === null || this.loading()) {
      return;
    }
    const asked = this.applied;
    this.loading.set(true);
    this.error.set(null);
    this.api.adminUsers({ query: asked, limit: USERS_PAGE_SIZE, before }).subscribe({
      next: (page) => {
        if (asked !== this.applied) {
          return; // the search changed meanwhile: these rows belong to the old list
        }
        this.rows.update((shown) => appendRows(shown, page.items.map(toUserListRow)));
        this.nextBefore.set(page.next_before);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }
}
