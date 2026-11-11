import { HttpEventType } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { AccountDraft } from '../core/account-draft';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

/**
 * U06 계좌 변경 확인 단계 (final U06-account-review.png, older style: content and layout only).
 * Shows what was typed on /settings, read-only (the number masked), and sends it with
 * `PUT /api/me/bank-account` on "계좌 변경 검토 요청". The draft only lives in memory, so
 * `accountDraftGuard` sends a reload back to /settings. A pending request is replaced by this
 * one (api.md); the page says so. api.md has no idempotency key for this call: the button is
 * disabled while it runs.
 */
@Component({
  selector: 'app-account-review',
  imports: [Button, Card, InfoBox],
  templateUrl: './account-review.html',
  styleUrl: './account-review.css',
})
export class AccountReview {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly draft = inject(AccountDraft);
  protected readonly me = inject(AuthService).me;

  // read once: the draft is cleared when the request succeeds
  protected readonly bank = this.draft.bank();
  private readonly digits = this.draft.digits();
  private readonly file = this.draft.file()!;
  protected readonly masked = `•••• •••• ${this.digits.slice(-4)}`;
  protected readonly fileName = this.file.name;

  protected readonly sending = signal(false);
  protected readonly progress = signal(0);
  protected readonly error = signal<string | null>(null);

  /** The request this one replaces, if any */
  private readonly existing = toSignal(this.api.bankAccount().pipe(catchError(() => of(null))), {
    initialValue: null,
  });
  protected readonly replaces = computed(() => this.existing()?.pending ?? null);

  protected submit(): void {
    if (this.sending()) {
      return;
    }
    this.sending.set(true);
    this.progress.set(0);
    this.error.set(null);
    this.api
      .requestBankAccountChange({
        bank: this.bank,
        account_number: this.digits,
        bankbook: this.file,
      })
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            this.progress.set(event.total ? Math.round((100 * event.loaded) / event.total) : 0);
          } else if (event.type === HttpEventType.Response) {
            this.draft.clear();
            void this.router.navigateByUrl('/settings/account/requested');
          }
        },
        error: (err: unknown) => {
          this.sending.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  /** The typed values stay in memory for the way back */
  protected cancel(): void {
    void this.router.navigateByUrl('/settings');
  }
}
