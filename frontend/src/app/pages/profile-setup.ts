import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { COHORTS, Cohort } from '@otus/shared/core/api-types';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { landingFor } from '../core/guards';

/** 한글 syllables and jamo, 2-20 characters (spaces are not allowed). */
const KOREAN_NAME = /^[가-힣ㄱ-ㅎㅏ-ㅣ]{2,20}$/;

/** The `COHORTS` value for a select value, or null when nothing (or something unknown) is picked. */
export function parseCohort(value: string): Cohort | null {
  return COHORTS.find((c) => c.value === value)?.value ?? null;
}

export const MIN_BIRTH_DATE = '1900-01-01';

/**
 * A real calendar date `YYYY-MM-DD` from 1900-01-01. The upper bound (today, KST) is the
 * server's: a future date comes back as 400 INVALID_REQUEST and is shown as the error.
 */
export function validBirthDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    return false;
  }
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const real = date.toISOString().slice(0, 10) === value;
  return real && value >= MIN_BIRTH_DATE;
}

export function validKoreanName(value: string): boolean {
  return KOREAN_NAME.test(value.trim());
}

/**
 * 기수·한글 이름·생년월일 (shown once, right after the first login and before U02). Saved with
 * PATCH /api/me/profile; the response is the updated user, which moves the guards on to 최초 4종.
 */
@Component({
  selector: 'app-profile-setup',
  imports: [Button, Card, InfoBox],
  template: `
    <header class="page-head">
      <p class="eyebrow">처음 한 번만 입력해요</p>
      <h1>{{ me()?.display_name }}님, 먼저 기본 정보를 알려주세요</h1>
      <p class="desc">운영팀이 서류를 확인할 때 사용해요. 입력한 뒤에 다음 단계로 넘어가요.</p>
    </header>

    <app-card heading="기본 정보">
      <form (submit)="submit($event)" novalidate>
        <div class="field">
          <label for="cohort">기수</label>
          <select
            id="cohort"
            [attr.aria-invalid]="cohortError()"
            [attr.aria-describedby]="cohortError() ? 'cohort-error' : null"
            (change)="cohort.set($any($event.target).value)"
            (blur)="touchedCohort.set(true)"
          >
            <option value="" disabled [selected]="!cohort()">기수를 선택해주세요</option>
            @for (option of cohorts; track option.value) {
              <option [value]="option.value" [selected]="option.value === cohort()">
                {{ option.label }}
              </option>
            }
          </select>
          @if (cohortError()) {
            <p id="cohort-error" class="error" role="alert">기수를 선택해주세요.</p>
          }
        </div>
        <div class="field">
          <label for="korean-name">한글 이름</label>
          <input
            id="korean-name"
            type="text"
            autocomplete="name"
            maxlength="20"
            placeholder="예: 홍길동"
            [value]="name()"
            [attr.aria-invalid]="nameError()"
            [attr.aria-describedby]="nameError() ? 'name-error' : null"
            (input)="name.set($any($event.target).value)"
            (blur)="touchedName.set(true)"
          />
          @if (nameError()) {
            <p id="name-error" class="error" role="alert">
              한글 이름을 공백 없이 2자 이상 입력해주세요.
            </p>
          }
        </div>

        <div class="field">
          <label for="birth-date">생년월일</label>
          <input
            id="birth-date"
            type="date"
            autocomplete="bday"
            [min]="minBirth"
            [value]="birth()"
            [attr.aria-invalid]="birthError()"
            [attr.aria-describedby]="birthError() ? 'birth-error' : null"
            (input)="birth.set($any($event.target).value)"
            (blur)="touchedBirth.set(true)"
          />
          @if (birthError()) {
            <p id="birth-error" class="error" role="alert">생년월일을 정확히 입력해주세요.</p>
          }
        </div>

        <app-info-box heading="신분증과 같은 이름으로 적어주세요">
          서류에 적힌 이름과 다르면 검토에서 확인을 요청할 수 있어요.
        </app-info-box>

        @if (submitError(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions">
          <button appButton type="submit" [disabled]="!canSubmit()">
            {{ submitting() ? '저장하는 중…' : '다음 →' }}
          </button>
        </div>
      </form>
    </app-card>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      max-width: 560px;
      margin: 0 auto;
    }

    .page-head {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .page-head p,
    h1 {
      margin: 0;
    }

    .eyebrow {
      font-size: var(--font-size-caption);
      color: var(--color-teal);
    }

    h1 {
      font-size: var(--font-size-page-title);
      line-height: 1.3;
      font-weight: var(--font-weight-bold);
    }

    .desc {
      font-size: var(--font-size-lead);
      color: var(--color-muted);
    }

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

    input::placeholder {
      color: var(--color-muted);
    }

    select:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--color-teal);
      outline-offset: 2px;
    }

    select[aria-invalid='true'],
    input[aria-invalid='true'] {
      border-color: var(--color-red);
    }

    .error {
      margin: 0;
      color: var(--color-red);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class ProfileSetup {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly me = this.auth.me;
  protected readonly cohorts = COHORTS;
  protected readonly cohort = signal('');
  protected readonly name = signal('');
  protected readonly touchedCohort = signal(false);
  protected readonly touchedName = signal(false);
  protected readonly touchedBirth = signal(false);
  protected readonly birth = signal('');
  protected readonly minBirth = MIN_BIRTH_DATE;
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected readonly cohortError = computed(
    () => this.touchedCohort() && parseCohort(this.cohort()) === null,
  );
  protected readonly nameError = computed(
    () => this.touchedName() && !validKoreanName(this.name()),
  );
  protected readonly birthError = computed(
    () => this.touchedBirth() && !validBirthDate(this.birth()),
  );
  protected readonly canSubmit = computed(
    () =>
      parseCohort(this.cohort()) !== null &&
      validKoreanName(this.name()) &&
      validBirthDate(this.birth()) &&
      !this.submitting(),
  );

  protected submit(event: Event): void {
    event.preventDefault();
    const cohort = parseCohort(this.cohort());
    if (
      cohort === null ||
      !validKoreanName(this.name()) ||
      !validBirthDate(this.birth()) ||
      this.submitting()
    ) {
      this.touchedCohort.set(true);
      this.touchedName.set(true);
      this.touchedBirth.set(true);
      return;
    }
    this.submitting.set(true);
    this.submitError.set(null);
    this.api
      .setProfile({ ordinal: cohort, ko_name: this.name().trim(), date_of_birth: this.birth() })
      .subscribe({
        next: (me) => {
          this.auth.setMe(me);
          void this.router.navigateByUrl(landingFor(me));
        },
        error: (err: unknown) => {
          this.submitError.set(errorMessage(err));
          this.submitting.set(false);
        },
      });
  }
}
