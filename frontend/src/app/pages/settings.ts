import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import { dotDate } from '@otus/shared/core/format';
import { Card } from '@otus/shared/ui/card';
import { BankAccountState } from '../core/api.models';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { employmentStatusText, recentChanges } from '../core/profile';
import { AccountCard } from './account-card';
import { EmploymentChoice } from '../ui/employment-choice';
import { ProfileEdit } from '../ui/profile-edit';

type BankLoad = { ok: true; state: BankAccountState } | { ok: false };

/**
 * U06 내 정보 (final U06-settings.png): 취업 상태 toggle, the 계좌 card, 내 계정, a static note and "최근 변경". Hidden: sidebar help card, the rename request
 * (no API).
 */
@Component({
  selector: 'app-settings',
  imports: [AccountCard, Card, EmploymentChoice, ProfileEdit],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  protected readonly me = inject(AuthService).me;
  private readonly load = toSignal<BankLoad | null>(
    inject(ApiService)
      .bankAccount()
      .pipe(
        map((state): BankLoad => ({ ok: true, state })),
        catchError(() => of<BankLoad>({ ok: false })),
      ),
    { initialValue: null },
  );

  protected readonly failed = computed(() => this.load()?.ok === false);
  protected readonly bank = computed(() => {
    const l = this.load();
    return l?.ok ? l.state : null;
  });

  protected readonly status = computed(() => employmentStatusText(this.me()?.employed ?? false));
  protected readonly changes = computed(() => recentChanges(this.me(), this.bank()).slice(0, 3));

  protected readonly dotDate = dotDate;
}
