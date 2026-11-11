import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from './auth.service';

/**
 * The 계좌 변경 the student is typing (/settings) and then confirms (account review). It lives
 * only in memory: the account number is sensitive, so it never goes to storage, a URL or a log,
 * and a reload (or logging out) drops it. Cleared after a successful request.
 */
@Injectable({ providedIn: 'root' })
export class AccountDraft {
  readonly bank = signal('');
  /** As typed: digits, with the `-` and spaces people add */
  readonly number = signal('');
  readonly file = signal<File | null>(null);

  /** api.md: digits only, 8–20, after stripping `-` and spaces */
  readonly digits = computed(() => this.number().replace(/[-\s]/g, ''));
  readonly numberValid = computed(() => /^\d{8,20}$/.test(this.digits()));
  readonly ready = computed(
    () => this.bank().trim().length > 0 && this.numberValid() && this.file() !== null,
  );

  constructor() {
    const me = inject(AuthService).me;
    effect(() => {
      if (!me()) {
        this.clear();
      }
    });
  }

  clear(): void {
    this.bank.set('');
    this.number.set('');
    this.file.set(null);
  }
}
