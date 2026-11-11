import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { HttpEventType } from '@angular/common/http';
import { catchError, filter, map, of, switchMap, tap, throwError, Observable } from 'rxjs';

import { dotMonthDay, lastMoment } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { CountPill } from '@otus/shared/ui/count-pill';
import { InfoBox } from '@otus/shared/ui/info-box';
import { ApiErrorBody, DocType, Submission, SubmissionFile, Cycle } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { AccountDraft } from '../core/account-draft';
import { AuthService } from '../core/auth.service';
import { BANKS } from '../core/banks';
import { DocGuideBox } from '../ui/doc-guide';
import { UploadSlot } from '../ui/upload-slot';

/** Shown before the draft loads; the draft's `required_doc_types` wins after that. */
const INITIAL_DOC_TYPES: DocType[] = [
  'id_card',
  'resident_abstract',
  'bankbook',
  'employment_insurance',
];

/**
 * U02 최초 4종 (final U02-initial-empty.png / U02-initial-ready.png).
 *
 * Gets the current cycle, then the `initial` draft (POST /api/submissions returns the
 * existing one). Each row uploads into the draft as soon as a file is picked, so "임시 저장"
 * only confirms that (user decision 2026-10-17). "첫 서류 제출하기" needs every required file
 * and an open cycle.
 */
@Component({
  selector: 'app-initial',
  imports: [Button, Card, CountPill, DocGuideBox, InfoBox, UploadSlot],
  templateUrl: './initial.html',
  styleUrl: './initial.css',
})
export class Initial {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly account = inject(AccountDraft);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly me = this.auth.me;
  protected readonly cycle = signal<Cycle | null>(null);
  protected readonly draft = signal<Submission | null>(null);
  /** Current file per doc type, from the draft and later uploads. */
  private readonly files = signal<Partial<Record<DocType, SubmissionFile>>>({});

  protected readonly loadError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly saved = signal(false);
  /**
   * One key per submit attempt. A retry after a failed or lost response reuses it so the
   * server can't submit twice; a new upload changes what's submitted, so it gets a new key.
   */
  private idempotencyKey: string | null = null;

  protected readonly banks = BANKS;
  protected readonly touchedNumber = signal(false);
  /** 예금주: starts as the 한글 이름 and can be changed. api.md has no field for it, so it is only checked here. */
  protected readonly holderInput = signal<string | null>(null);
  protected readonly holder = computed(() => this.holderInput() ?? this.me()?.display_name ?? '');
  protected readonly numberError = computed(
    () => this.touchedNumber() && this.account.number() !== '' && !this.account.numberValid(),
  );
  protected readonly accountReady = computed(
    () =>
      this.account.bank().trim().length > 0 &&
      this.account.numberValid() &&
      this.holder().trim().length > 0,
  );
  /** What was already sent as 계좌 요청, so a retry after a failed finalize doesn't send it twice */
  private sentAccount: string | null = null;

  protected readonly docTypes = computed(
    () => this.draft()?.required_doc_types ?? INITIAL_DOC_TYPES,
  );
  protected readonly readyCount = computed(
    () => this.docTypes().filter((type) => this.files()[type]).length,
  );
  protected readonly allReady = computed(() => this.readyCount() === this.docTypes().length);
  protected readonly isOpen = computed(() => this.cycle()?.state === 'open');
  /** Final U02-initial-closed.png: no upload or submit outside the period. */
  protected readonly locked = computed(() => !!this.cycle() && !this.isOpen());
  protected readonly ended = computed(() => this.cycle()?.state === 'closed');
  protected readonly canSubmit = computed(
    () =>
      !!this.draft() &&
      this.allReady() &&
      this.accountReady() &&
      this.isOpen() &&
      !this.submitting(),
  );
  /** The button works whenever submitting is possible at all; missing items are shown on click. */
  protected readonly canTrySubmit = computed(
    () => !!this.draft() && this.isOpen() && !this.submitting(),
  );
  /** Set by a click on submit with something missing; the red marks then follow the live state. */
  protected readonly attempted = signal(false);
  protected readonly bankInvalid = computed(() => this.attempted() && !this.account.bank().trim());
  protected readonly numberInvalid = computed(
    () => this.numberError() || (this.attempted() && !this.account.numberValid()),
  );
  protected readonly holderInvalid = computed(() => this.attempted() && !this.holder().trim());
  protected readonly showMissing = computed(
    () => this.attempted() && !(this.allReady() && this.accountReady()),
  );
  protected readonly canSave = computed(
    () => !!this.draft() && this.readyCount() > 0 && !this.submitting(),
  );

  /** "10.01 – 10.31" from the server's KST timestamps: dates only, like the other screens */
  protected readonly period = computed(() => {
    const c = this.cycle();
    if (!c) {
      return '';
    }
    if (!c.opens_at || !c.closes_at) {
      return '아직 정해지지 않았어요';
    }
    return `${dotMonthDay(c.opens_at)} – ${dotMonthDay(lastMoment(c.closes_at))}`;
  });
  /** "9" for "9월 고용보험가입내역서 · 9월 1일 이후 발급본" */
  protected readonly month = computed(() => {
    const m = this.cycle()?.target_month.split('-')[1];
    return m ? String(Number(m)) : '';
  });

  protected readonly status = computed(() => {
    if (this.saved()) {
      return '임시 저장됐어요. 다음에 이어서 마무리할 수 있어요.';
    }
    if (this.locked()) {
      return '최초 등록을 완료한 이후 대시보드를 이용할 수 있습니다.';
    }
    return this.allReady()
      ? this.accountReady()
        ? '본인 명의 서류와 고용보험내역서 발급일을 확인했어요.'
        : '은행, 계좌번호, 예금주를 입력하면 제출할 수 있어요.'
      : `파일 ${this.docTypes().length}개를 준비하면 제출할 수 있어요.`;
  });

  constructor() {
    this.api
      .currentCycle()
      .pipe(
        tap((cycle) => this.cycle.set(cycle)),
        // before the period (or with none set) the API refuses to create a draft (422)
        switchMap((cycle) =>
          cycle.state === 'upcoming' || cycle.state === 'not_set'
            ? of(null)
            : this.api.createSubmission({ kind: 'initial', target_month: cycle.target_month }).pipe(
                // a closed period still returns an existing draft; without one there's just nothing to show
                catchError((err: unknown) =>
                  isCycleClosed(err) ? of(null) : throwError(() => err),
                ),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (draft) => {
          this.draft.set(draft);
          this.files.set(Object.fromEntries((draft?.files ?? []).map((f) => [f.doc_type, f])));
        },
        error: (err: unknown) => this.loadError.set(errorMessage(err)),
      });
  }

  protected description(type: DocType): string {
    switch (type) {
      case 'id_card':
        return '내 이름과 사진을 확인할 수 있는 신분증 PDF';
      case 'resident_abstract':
        return '본인 명의로 발급한 주민등록초본 PDF';
      case 'bankbook':
        return '지원금을 받을 본인 명의 계좌의 통장사본 PDF';
      case 'employment_insurance': {
        const m = this.month();
        return m ? `${m}월 고용보험가입내역서 · ${m}월 1일 이후 발급본` : '고용보험가입내역서 PDF';
      }
    }
  }

  protected fileOf(type: DocType): SubmissionFile | null {
    return this.files()[type] ?? null;
  }

  protected onUploaded(file: SubmissionFile): void {
    this.files.update((files) => ({ ...files, [file.doc_type]: file }));
    this.idempotencyKey = null;
    this.saved.set(false);
    this.submitError.set(null);
  }

  protected onUploadedFile(type: DocType, file: File): void {
    // the 통장사본 also goes to PUT /api/me/bank-account when submitting
    if (type === 'bankbook') {
      this.account.file.set(file);
      this.sentAccount = null;
    }
  }

  protected onBank(event: Event): void {
    this.account.bank.set((event.target as HTMLSelectElement).value);
  }

  protected onNumber(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/[^\d\s-]/g, '');
    input.value = cleaned;
    this.account.number.set(cleaned);
  }

  protected save(): void {
    this.submitError.set(null);
    this.saved.set(true);
  }

  /**
   * PUT /api/me/bank-account with the 통장사본 (the PDF picked in this visit, or the stored one
   * when the page was reloaded after uploading). Skipped when the same data was already sent.
   */
  private sendAccount(): Observable<unknown> {
    const stored = this.files()['bankbook'];
    const bank = this.account.bank().trim();
    const number = this.account.digits();
    const signature = `${bank}|${number}|${stored?.file_id ?? ''}`;
    if (this.sentAccount === signature) {
      return of(null);
    }
    const picked = this.account.file();
    const file$: Observable<File> = picked
      ? of(picked)
      : stored
        ? this.api
            .fetchFile(stored.file_id)
            .pipe(
              map((blob) => new File([blob], stored.original_name, { type: 'application/pdf' })),
            )
        : throwError(() => new Error('통장사본을 먼저 올려주세요.'));
    return file$.pipe(
      switchMap((bankbook) =>
        this.api.requestBankAccountChange({ bank, account_number: number, bankbook }),
      ),
      filter((event) => event.type === HttpEventType.Response),
      tap(() => (this.sentAccount = signature)),
    );
  }

  protected submit(): void {
    const draft = this.draft();
    const me = this.me();
    if (!draft || !me || !this.canTrySubmit()) {
      return;
    }
    if (!this.canSubmit()) {
      this.attempted.set(true);
      this.submitError.set(null);
      // let the red marks render, then bring the first one into view
      setTimeout(() =>
        document
          .querySelector('.row.invalid, [aria-invalid="true"]')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      );
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.submitError.set(null);
    this.saved.set(false);
    const key = this.idempotencyKey;
    this.sendAccount()
      .pipe(
        switchMap(() => this.api.finalize(draft.id, key)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.account.clear();
          this.auth.setMe({ ...me, initial_submitted: true });
          void this.router.navigateByUrl('/home');
        },
        error: (err: unknown) => {
          this.submitError.set(errorMessage(err));
          this.submitting.set(false);
        },
      });
  }
}

function isCycleClosed(err: unknown): boolean {
  return (
    err instanceof HttpErrorResponse &&
    (err.error as Partial<ApiErrorBody> | null)?.error?.code === 'CYCLE_CLOSED'
  );
}
