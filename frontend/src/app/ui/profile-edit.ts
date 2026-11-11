import { Component, computed, effect, inject, signal } from '@angular/core';

import { COHORTS } from '@otus/shared/core/api-types';
import { Button } from '@otus/shared/ui/button';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MIN_BIRTH_DATE, validBirthDate, validKoreanName } from '../pages/profile-setup';

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * 기수·한글 이름·생년월일 edit form on /settings. Saved with `PATCH /api/me/profile` (only the changed
 * fields are sent); the response updates `AuthService.me`. A 기수 that isn't in `COHORTS`
 * (the API takes free text, e.g. "9기A") stays selectable as the current value.
 */
@Component({
  selector: 'app-profile-edit',
  imports: [Button],
  template: `
    <form (submit)="save($event)" novalidate>
      <div class="field">
        <label for="edit-ordinal">기수</label>
        <select id="edit-ordinal" (change)="ordinal.set($any($event.target).value)">
          @if (!known()) {
            <option [value]="ordinal()" selected>{{ ordinal() || '기수를 선택해주세요' }}</option>
          }
          @for (option of cohorts; track option.value) {
            <option [value]="option.value" [selected]="option.value === ordinal()">
              {{ option.label }}
            </option>
          }
        </select>
      </div>
      <div class="field">
        <label for="edit-ko-name">한글 이름</label>
        <input
          id="edit-ko-name"
          type="text"
          maxlength="20"
          [value]="koName()"
          [attr.aria-invalid]="nameInvalid()"
          (input)="koName.set($any($event.target).value)"
        />
        @if (nameInvalid()) {
          <p class="notice error" role="alert">한글 이름을 공백 없이 2자 이상 입력해주세요.</p>
        }
      </div>
      <div class="field">
        <label for="edit-birth">생년월일</label>
        <input
          id="edit-birth"
          type="date"
          [min]="minBirth"
          [value]="birth()"
          [attr.aria-invalid]="birthInvalid()"
          (input)="birth.set($any($event.target).value)"
        />
        @if (birthInvalid()) {
          <p class="notice error" role="alert">생년월일을 정확히 입력해주세요.</p>
        }
      </div>
      <p class="notice" [class.error]="notice()?.kind === 'error'" aria-live="polite">
        @if (notice(); as n) {
          {{ n.text }}
        }
      </p>
      <button appButton type="submit" [disabled]="!canSave()">
        {{ saving() ? '저장하는 중…' : '저장' }}
      </button>
    </form>
  `,
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    label {
      font-weight: var(--font-weight-medium);
    }

    select,
    input {
      box-sizing: border-box;
      width: 100%;
      height: 48px;
      padding: 0 var(--space-2);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      font: inherit;
    }

    input[aria-invalid='true'] {
      border-color: var(--color-red);
    }

    .notice {
      margin: 0;
      min-height: 1.5em;
      color: var(--color-teal);
    }

    .notice.error {
      color: var(--color-red);
    }
  `,
})
export class ProfileEdit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly cohorts = COHORTS;
  protected readonly ordinal = signal('');
  protected readonly koName = signal('');
  protected readonly birth = signal('');
  protected readonly minBirth = MIN_BIRTH_DATE;
  protected readonly saving = signal(false);
  protected readonly notice = signal<Notice | null>(null);

  protected readonly known = computed(() => COHORTS.some((c) => c.value === this.ordinal()));
  protected readonly nameInvalid = computed(
    () => this.koName() !== '' && !validKoreanName(this.koName()),
  );
  protected readonly birthInvalid = computed(
    () => this.birth() !== '' && !validBirthDate(this.birth()),
  );
  private readonly changes = computed(() => {
    const me = this.auth.me();
    const ordinal = this.ordinal();
    const koName = this.koName().trim();
    const birth = this.birth();
    return {
      ...(ordinal && ordinal !== (me?.ordinal ?? '') ? { ordinal } : {}),
      ...(koName && koName !== (me?.ko_name ?? '') ? { ko_name: koName } : {}),
      ...(birth && birth !== (me?.date_of_birth ?? '') ? { date_of_birth: birth } : {}),
    };
  });
  protected readonly canSave = computed(
    () =>
      !this.saving() &&
      Object.keys(this.changes()).length > 0 &&
      (this.koName() === '' || validKoreanName(this.koName())) &&
      !this.birthInvalid(),
  );

  constructor() {
    // fill the form from the saved profile (also when /api/me finishes loading late)
    effect(() => {
      const me = this.auth.me();
      this.ordinal.set(me?.ordinal ?? '');
      this.koName.set(me?.ko_name ?? '');
      this.birth.set(me?.date_of_birth ?? '');
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (!this.canSave()) {
      return;
    }
    this.saving.set(true);
    this.notice.set(null);
    this.api.setProfile(this.changes()).subscribe({
      next: (me) => {
        this.auth.setMe(me);
        this.notice.set({ kind: 'ok', text: '✓ 저장했어요.' });
        this.saving.set(false);
      },
      error: (err: unknown) => {
        this.notice.set({ kind: 'error', text: errorMessage(err) });
        this.saving.set(false);
      },
    });
  }
}
