import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { dotMonthDay, hourMinute } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { BankAccountState } from '../core/api.models';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';

type Load = { ok: true; state: BankAccountState } | { ok: false };

/**
 * U06 계좌 변경 요청 완료 (final U06-account-requested.png, older style: content and layout only).
 * Always drawn from the server's `pending` request, so a reload shows the same screen; with no
 * pending request (already decided, or none) there is nothing to show and it goes to /settings.
 */
@Component({
  selector: 'app-account-requested',
  imports: [Button, Card, InfoBox, RouterLink],
  templateUrl: './account-requested.html',
  styleUrl: './account-requested.css',
})
export class AccountRequested {
  protected readonly me = inject(AuthService).me;
  private readonly load = toSignal<Load | null>(
    inject(ApiService)
      .bankAccount()
      .pipe(
        map((state): Load => ({ ok: true, state })),
        catchError(() => of<Load>({ ok: false })),
      ),
    { initialValue: null },
  );

  protected readonly failed = computed(() => this.load()?.ok === false);
  protected readonly pending = computed(() => {
    const l = this.load();
    return l?.ok ? l.state.pending : null;
  });
  protected readonly current = computed(() => {
    const l = this.load();
    return l?.ok ? l.state.current : null;
  });

  constructor() {
    const router = inject(Router);
    effect(() => {
      const l = this.load();
      if (l?.ok && !l.state.pending) {
        void router.navigateByUrl('/settings');
      }
    });
  }

  protected readonly dotMonthDay = dotMonthDay;
  protected readonly hourMinute = hourMinute;
}
