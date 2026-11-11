import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { dotMonthDay, hourMinute } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { BankAccountState } from '../core/api.models';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { recentChanges } from '../core/profile';
import { EmploymentChoice } from '../ui/employment-choice';

type Load = { ok: true; state: BankAccountState } | { ok: false };

/**
 * U06 내 정보와 변경 이력 (final U06-history.png, older style: content and layout only).
 * Hidden: "개명 정보 제출" (no rename API) and "변경 요청 내역 보기" (this screen is the history;
 * there is no longer list). The 취업 상태 radio of the image is the toggle card component.
 */
@Component({
  selector: 'app-account-history',
  imports: [Button, Card, EmploymentChoice, InfoBox, RouterLink],
  templateUrl: './account-history.html',
  styleUrl: './account-history.css',
})
export class AccountHistory {
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

  protected readonly loaded = computed(() => this.load() !== null);
  protected readonly failed = computed(() => this.load()?.ok === false);
  private readonly bank = computed(() => {
    const l = this.load();
    return l?.ok ? l.state : null;
  });
  protected readonly current = computed(() => this.bank()?.current ?? null);
  protected readonly changes = computed(() => recentChanges(this.me(), this.bank()));

  protected readonly dotMonthDay = dotMonthDay;
  protected readonly hourMinute = hourMinute;
}
