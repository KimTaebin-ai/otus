import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { map, of, switchMap, tap } from 'rxjs';

import { dotDate, hourMinute, lastMoment, monthDay, monthNumber } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { NoticePanel } from '@otus/shared/ui/notice-panel';
import { ApiErrorBody, Cycle, Submission, SubmissionFile } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Outcome, chainOutcome } from '../core/revision';
import { DocGuideBox } from '../ui/doc-guide';
import { DropPanel } from '../ui/drop-panel';
import { MonthlyDone } from './monthly-done';
import { Supplement } from './supplement';

/**
 * U04 월별 제출 (final U04-monthly-empty / -ready / -done.png).
 *
 * Looks at the target month's final submissions first (GET /api/submissions?month=, drafts
 * excluded). Only the `monthly` and its `supplement`s count as the monthly chain:
 * - none, but a submitted `initial` in the same month → the covered screen: the initial four
 *   already hold this month's employment-insurance certificate, and the API refuses a second
 *   one (409 INVALID_STATE), so no draft is created
 * - none → the monthly draft (POST /api/submissions returns the existing one) and the form
 * - latest is `revision_requested` → the supplement screen (U05, `app-supplement`)
 * - otherwise → the done screen, also right after a successful finalize
 *
 * Uploads go into the draft as soon as a file is picked, so "임시 저장" only confirms that
 * (same rule as U02).
 */
@Component({
  selector: 'app-monthly',
  imports: [
    Button,
    Card,
    DocGuideBox,
    DropPanel,
    InfoBox,
    MonthlyDone,
    NoticePanel,
    RouterLink,
    Supplement,
  ],
  templateUrl: './monthly.html',
  styleUrl: './monthly.css',
})
export class Monthly {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly me = this.auth.me;
  protected readonly cycle = signal<Cycle | null>(null);
  protected readonly draft = signal<Submission | null>(null);
  /** Set once the month's monthly is submitted: the form turns into the done screen. */
  protected readonly outcome = signal<Outcome | null>(null);
  /** Set while the month's newest submission is `revision_requested`: the supplement screen. */
  protected readonly revision = signal<Outcome | null>(null);
  protected readonly file = signal<SubmissionFile | null>(null);
  /** The month's 최초 4종 is already submitted, so a monthly would be a duplicate. */
  protected readonly coveredByInitial = signal(false);

  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly saved = signal(false);
  /**
   * One key per submit attempt. A retry after a failed or lost response reuses it so the
   * server can't submit twice; a new upload changes what's submitted, so it gets a new key.
   */
  private idempotencyKey: string | null = null;

  protected readonly isOpen = computed(() => this.cycle()?.state === 'open');
  protected readonly closed = computed(() => this.cycle()?.state === 'closed');
  protected readonly notSet = computed(() => this.cycle()?.state === 'not_set');
  protected readonly upcoming = computed(() => this.cycle()?.state === 'upcoming');
  /** Closed with a draft file: final U04-monthly-closed. Nothing can change any more. */
  protected readonly savedOnly = computed(() => this.closed() && !!this.file());
  protected readonly ready = computed(() => !!this.file());
  protected readonly canSubmit = computed(
    () => !!this.draft() && this.ready() && this.isOpen() && !this.submitting(),
  );
  protected readonly canSave = computed(() => !!this.draft() && this.ready() && !this.submitting());

  /** "10" for "10월 서류 제출" */
  protected readonly month = computed(() => {
    const c = this.cycle();
    return c ? monthNumber(c.target_month) : '';
  });
  /** "2026년 10월" */
  protected readonly monthLong = computed(() => {
    const c = this.cycle();
    return c ? `${c.target_month.slice(0, 4)}년 ${this.month()}월` : '';
  });
  /** "10월 1일", the first day documents may be issued on */
  protected readonly issuedFrom = computed(() => {
    const c = this.cycle();
    return c ? monthDay(c.issued_after) : '';
  });
  /** "2026.10.01" */
  protected readonly issuedDate = computed(
    () => this.cycle()?.issued_after.replaceAll('-', '.') ?? '',
  );
  /** "10월 31일": `closes_at` is exclusive, so the last day shown is the day before it */
  protected readonly deadline = computed(() =>
    monthDay(lastMoment(this.cycle()?.closes_at ?? null)),
  );
  /** "2026.10.01" for the bottom bar before the period opens (it always opens at 00:00) */
  protected readonly opensStamp = computed(() => dotDate(this.cycle()?.opens_at ?? null));
  /** "10월 1일" */
  protected readonly opensDay = computed(() => monthDay(this.cycle()?.opens_at ?? null));
  /** "10월 1일": the period opens at 00:00 on the 1st, so no time */
  protected readonly opensAt = computed(() => monthDay(this.cycle()?.opens_at ?? null));
  protected readonly closesAt = computed(() =>
    this.stamp(lastMoment(this.cycle()?.closes_at ?? null)),
  );
  protected readonly docCount = computed(() => this.draft()?.required_doc_types.length ?? 1);

  protected readonly status = computed(() => {
    if (this.saved()) {
      return '임시 저장됐어요. 다음에 이어서 마무리할 수 있어요.';
    }
    if (this.closed()) {
      return `${this.month()}월 접수가 끝났어요. 다음 제출 일정은 운영팀에 문의해주세요.`;
    }
    if (this.notSet()) {
      return '접수 기간 미정';
    }
    return this.ready()
      ? `내 이름과 ${this.issuedFrom()} 이후 발급일을 확인했어요.`
      : 'PDF를 올리면 제출 버튼이 활성화돼요.';
  });

  constructor() {
    this.api
      .currentCycle()
      .pipe(
        tap((cycle) => this.cycle.set(cycle)),
        switchMap((cycle) =>
          this.api.listSubmissions({ month: cycle.target_month }).pipe(
            map((list) => ({
              cycle,
              found: monthlyOutcome(list.items),
              covered: list.items.some((s) => s.kind === 'initial'),
            })),
          ),
        ),
        // before the period (or with none set) the API refuses to create a draft (422)
        tap(({ found, covered }) => this.coveredByInitial.set(!found && covered)),
        switchMap(({ cycle, found, covered }) =>
          found
            ? of(found)
            : covered || cycle.state === 'upcoming' || cycle.state === 'not_set'
              ? of(null)
              : this.api.createSubmission({ kind: 'monthly', target_month: cycle.target_month }),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (result) => {
          if (!result) {
            // no draft to show before the period opens
          } else if ('monthly' in result) {
            this.showOutcome(result);
          } else {
            this.draft.set(result);
            this.file.set(result.files.find((f) => f.doc_type === 'employment_insurance') ?? null);
          }
          this.loaded.set(true);
        },
        error: (err: unknown) => {
          const code = errorCode(err);
          if (code === 'INVALID_STATE' && !this.revision()) {
            // the initial four were submitted for this month after the list was read
            this.coveredByInitial.set(true);
          } else if (code !== 'CYCLE_CLOSED') {
            // a closed period only means there's no draft to fill in: the page says so itself
            this.loadError.set(errorMessage(err));
          }
          this.loaded.set(true);
        },
      });
  }

  protected onUploaded(file: SubmissionFile): void {
    this.file.set(file);
    this.idempotencyKey = null;
    this.saved.set(false);
    this.submitError.set(null);
  }

  protected save(): void {
    this.submitError.set(null);
    this.saved.set(true);
  }

  protected submit(): void {
    const draft = this.draft();
    if (!draft || !this.canSubmit()) {
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.submitError.set(null);
    this.saved.set(false);
    this.api
      .finalize(draft.id, this.idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (done) => this.showOutcome({ monthly: done, latest: done }),
        error: (err: unknown) => {
          this.submitError.set(errorMessage(err));
          this.submitting.set(false);
        },
      });
  }

  /** The supplement was submitted: the month now waits for re-review (`resubmitted`). */
  protected onSupplementSubmitted(done: Submission): void {
    const found = this.revision();
    if (found) {
      this.showOutcome({ monthly: found.monthly, latest: done });
    }
  }

  private showOutcome(found: Outcome): void {
    if (found.latest.status === 'revision_requested') {
      this.revision.set(found);
      return;
    }
    this.revision.set(null);
    this.outcome.set(found);
  }

  /** "10월 1일 00:00"; "—" when the month has no period yet */
  private stamp(iso: string | null): string {
    return iso ? `${monthDay(iso)} ${hourMinute(iso)}` : '—';
  }
}

/**
 * The target month's monthly submission and the newest of it and its supplements, or null
 * when the month has no submitted monthly. An `initial` is not looked at: the same month may
 * hold an initial and a monthly.
 */
export function monthlyOutcome(items: Submission[]): Outcome | null {
  return chainOutcome(items, 'monthly');
}

function errorCode(err: unknown): string | undefined {
  return err instanceof HttpErrorResponse
    ? (err.error as Partial<ApiErrorBody> | null)?.error?.code
    : undefined;
}
