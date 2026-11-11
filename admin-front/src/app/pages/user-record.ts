import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Card } from '@otus/shared/ui/card';
import { Spinner } from '@otus/shared/ui/spinner';

import { toBankView, toUserRecordView } from '../core/admin-users';
import { UserRecordView } from '../core/admin.models';
import { ApiService, errorMessage } from '../core/api.service';
import { UserRecordApi } from '../core/user-record-api';
import { AuthService } from '../core/auth.service';
import { canOpenOriginals } from '../core/roles';
import { BankDecision } from '../ui/bank-review';
import { UserRecordViewComponent } from './user-record-view';

/**
 * A18 route (`/users/:id`). It reads `GET /api/admin/users/{id}` for the profile, then the
 * student's submissions through the monthly list and chain APIs (`UserRecordApi`); the bank
 * account through `GET /api/admin/users/{id}/bank-account`; in dev builds `/users/1?preview` shows the
 * whole layout with `dev/preview-data.ts`. Who may open originals comes from the logged-in
 * role (`canOpenOriginals`), the server checks it again.
 */
@Component({
  selector: 'app-user-record',
  imports: [Card, RouterLink, Spinner, UserRecordViewComponent],
  template: `
    @if (view(); as v) {
      <app-user-record-view
        [view]="v"
        [canOpenOriginals]="canOpen()"
        [canDecideBank]="canOpen()"
        [bankBusy]="bankBusy()"
        [bankError]="bankError()"
        (bankDecision)="decideBank($event)"
      />
    } @else if (problem(); as p) {
      <h1>사용자 관리</h1>
      <p role="alert">{{ p }}</p>
      <a routerLink="/users">← 사용자 목록</a>
    } @else {
      <app-card heading="사용자 정보">
        <app-spinner size="card" />
      </app-card>
    }
  `,
  styles: `
    h1 {
      margin: 0 0 var(--space-1);
      font-size: var(--font-size-page-title);
    }
    p {
      margin: 0 0 var(--space-2);
      color: var(--color-muted);
    }
    a {
      color: var(--color-teal);
    }
  `,
})
export class UserRecord {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly records = inject(UserRecordApi);

  protected readonly view = signal<UserRecordView | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly bankBusy = signal(false);
  protected readonly bankError = signal<string | null>(null);
  private userId: number | null = null;
  protected readonly canOpen = computed(() => {
    const me = this.auth.me();
    return !!me && canOpenOriginals(me.role);
  });

  constructor() {
    const route = inject(ActivatedRoute).snapshot;
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      if (route.queryParamMap.has('preview')) {
        void import('../dev/preview-data').then((m) => this.view.set(m.USER_RECORD_PREVIEW));
        return;
      }
    }
    // a path id that is not a whole number is an unknown user, like the server's 404
    const raw = route.paramMap.get('id') ?? '';
    const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
    if (id === null) {
      this.problem.set(NOT_FOUND);
      return;
    }
    this.userId = id;
    this.api.adminUser(id).subscribe({
      next: (d) => {
        // show the profile at once, then fill in the submissions when they arrive
        this.view.set(toUserRecordView(d));
        this.records.load(d).subscribe((v) => this.view.set(v));
      },
      error: (err: unknown) =>
        this.problem.set(
          err instanceof HttpErrorResponse && err.status === 404 ? NOT_FOUND : errorMessage(err),
        ),
    });
  }

  /** Approve or reject the pending 계좌 변경, then show the account as it is now. */
  protected decideBank(d: BankDecision): void {
    if (this.userId === null || this.bankBusy()) return;
    this.bankBusy.set(true);
    this.bankError.set(null);
    this.api
      .reviewBankAccount(this.userId, {
        request_id: d.requestId,
        decision: d.decision,
        ...(d.note ? { note: d.note } : {}),
      })
      .subscribe({
        next: (bank) => {
          this.view.update((v) => (v ? { ...v, ...toBankView(bank) } : v));
          this.bankBusy.set(false);
        },
        error: (err: unknown) => {
          this.bankBusy.set(false);
          this.bankError.set(
            err instanceof HttpErrorResponse && err.status === 409
              ? '이미 처리됐거나 학생이 새로 요청한 계좌 변경이에요. 최신 내용을 불러올게요.'
              : errorMessage(err),
          );
          if (err instanceof HttpErrorResponse && err.status === 409) this.reloadBank();
        },
      });
  }

  private reloadBank(): void {
    if (this.userId === null) return;
    this.api.adminBankAccount(this.userId).subscribe({
      next: (bank) => this.view.update((v) => (v ? { ...v, ...toBankView(bank) } : v)),
      error: () => {},
    });
  }
}

const NOT_FOUND = '찾을 수 없는 교육생이에요.';
