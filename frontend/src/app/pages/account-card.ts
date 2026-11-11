import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { dotDate, dotMonthDay, hourMinute } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { AccountDraft } from '../core/account-draft';
import { BankAccountState } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { BANKS } from '../core/banks';
import { formatSize, isPdf } from '../ui/upload-slot';

/**
 * "지원금을 받을 계좌" card on /settings (final U06-settings.png): bank, account number and 예금주,
 * the current 통장사본 row with "새 사본 올리기", and "새 계좌 저장하기" → account review.
 * 예금주 is the user's own name, read-only and never sent (api.md has no such field). The new
 * 통장사본 isn't uploaded here: PDF-checked, kept in memory, sent with the request on the next
 * screen. A pending request doesn't block a new one (it is replaced, which the next screen says).
 */
@Component({
  selector: 'app-account-card',
  imports: [Button, Card, InfoBox, RouterLink],
  templateUrl: './account-card.html',
  styleUrl: './account-card.css',
})
export class AccountCard {
  /** null while loading */
  readonly state = input<BankAccountState | null>(null);
  readonly failed = input(false);

  protected readonly draft = inject(AccountDraft);
  protected readonly me = inject(AuthService).me;
  private readonly router = inject(Router);

  protected readonly current = computed(() => this.state()?.current ?? null);
  protected readonly pending = computed(() => this.state()?.pending ?? null);
  protected readonly rejected = computed(() =>
    this.pending() ? null : (this.state()?.last_rejected ?? null),
  );
  /** The list, plus the bank already on the account when it isn't in it */
  protected readonly banks = computed(() => {
    const extra = this.current()?.bank;
    return extra && !(BANKS as readonly string[]).includes(extra) ? [extra, ...BANKS] : [...BANKS];
  });

  protected readonly touched = signal(false);
  protected readonly fileError = signal<string | null>(null);
  protected readonly numberError = computed(
    () => this.touched() && this.draft.number() !== '' && !this.draft.numberValid(),
  );

  constructor() {
    // start from the current bank; what the student already chose stays
    effect(() => {
      const bank = this.current()?.bank;
      if (bank && !this.draft.bank()) {
        this.draft.bank.set(bank);
      }
    });
  }

  protected onBank(event: Event): void {
    this.draft.bank.set((event.target as HTMLSelectElement).value);
  }

  protected onNumber(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/[^\d\s-]/g, '');
    input.value = cleaned;
    this.draft.number.set(cleaned);
  }

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!(await isPdf(file))) {
      this.fileError.set(`${file.name} 파일은 지원하지 않아요. PDF 파일만 올릴 수 있어요.`);
      return;
    }
    this.fileError.set(null);
    this.draft.file.set(file);
  }

  protected save(): void {
    if (this.draft.ready()) {
      void this.router.navigateByUrl('/settings/account/review');
    }
  }

  protected readonly formatSize = formatSize;
  protected readonly dotDate = dotDate;
  protected readonly dotMonthDay = dotMonthDay;
  protected readonly hourMinute = hourMinute;
}
