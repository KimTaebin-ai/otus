import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, throwError } from 'rxjs';

import {
  dotDateTime,
  dotMonthDay,
  hourMinute,
  lastMoment,
  monthDay,
  monthNumber,
  objectParticle,
} from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import {
  ApiErrorBody,
  Cycle,
  DOC_TYPE_LABELS,
  DocType,
  Submission,
  SubmissionFile,
} from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { DocGuideBox } from '../ui/doc-guide';
import { UploadSlot } from '../ui/upload-slot';

/**
 * U05 보완 제출 (final U05-supplement-ready.png), shown inside /submit while the month's newest
 * submission is `revision_requested`.
 *
 * Creates the supplement draft (POST /api/submissions with `parent_id`; an existing draft is
 * returned) and builds one row per `required_doc_types` entry. Uploads go into the draft as soon
 * as a file is picked, so "임시 저장" only confirms that. Finalizing moves the supplement and
 * its parent to `resubmitted`.
 *
 * Not in final: the revision request's time (api.md has no such field, so only "보완 요청" shows),
 * the reviewer's name (fixed "운영 담당자"), the empty state before a new file is picked (the
 * empty U02 row), and the locked state after the period (disabled row and "제출 기간 종료").
 * "미리보기" is hidden: `GET /api/files/{id}` is a download.
 */
@Component({
  selector: 'app-supplement',
  imports: [Button, Card, DocGuideBox, InfoBox, UploadSlot],
  templateUrl: './supplement.html',
  styleUrl: './supplement.css',
})
export class Supplement {
  private readonly api = inject(ApiService);

  /** The month's first submission (the monthly): "최초 제출" in the record. */
  readonly root = input.required<Submission>();
  /** The submission the reviewer sent back; the supplement's parent. */
  readonly parent = input.required<Submission>();
  readonly cycle = input.required<Cycle>();

  /** The finalized supplement */
  readonly submitted = output<Submission>();

  protected readonly draft = signal<Submission | null>(null);
  private readonly files = signal<Partial<Record<DocType, SubmissionFile>>>({});
  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly saved = signal(false);
  private idempotencyKey: string | null = null;

  /** `/api/cycles/current` only describes this month, so its dates only fit a supplement for this month. */
  protected readonly sameMonth = computed(
    () => this.cycle().target_month === this.parent().target_month,
  );
  protected readonly open = computed(() =>
    this.sameMonth() ? this.cycle().state === 'open' : !!this.draft(),
  );
  protected readonly types = computed(
    () => this.draft()?.required_doc_types ?? this.parent().required_doc_types,
  );
  protected readonly labels = computed(() => this.types().map((t) => DOC_TYPE_LABELS[t]));
  /** "를" / "을" after the doc names */
  protected readonly objectOf = computed(() => objectParticle(this.labels().join(', ')));
  protected readonly readyCount = computed(
    () => this.types().filter((t) => this.files()[t]).length,
  );
  protected readonly ready = computed(() => this.readyCount() === this.types().length);
  protected readonly canSubmit = computed(
    () => !!this.draft() && this.open() && this.ready() && !this.submitting(),
  );
  protected readonly canSave = computed(
    () => !!this.draft() && this.open() && this.readyCount() > 0 && !this.submitting(),
  );

  protected readonly month = computed(() => monthNumber(this.parent().target_month));
  /** "10월 1일": the first day documents may be issued on, from the cycle */
  protected readonly issuedFrom = computed(() =>
    this.sameMonth() ? monthDay(this.cycle().issued_after) : '',
  );
  protected readonly deadline = computed(() =>
    this.sameMonth() && this.cycle().closes_at
      ? dotDateTime(lastMoment(this.cycle().closes_at))
      : null,
  );
  protected readonly requestedComment = computed(() => this.parent().review_comment ?? '');
  protected readonly firstSubmitted = computed(() => {
    const at = this.root().submitted_at;
    return at ? `${dotMonthDay(at)} ${hourMinute(at)}` : '—';
  });
  /** The files the first submission had for the documents asked for again */
  protected readonly firstFileNames = computed(() =>
    this.types()
      .map((t) => this.root().files.find((f) => f.doc_type === t)?.original_name)
      .filter((name): name is string => !!name),
  );
  /** The reviewer asked for only some of the documents: the others are fine */
  protected readonly partial = computed(
    () => this.types().length < this.root().required_doc_types.length,
  );
  /** The issue-date rule only applies to the 고용보험가입내역서 */
  protected readonly needsIssueDate = computed(() => this.types().includes('employment_insurance'));
  protected readonly heading = computed(() =>
    this.types().length === 1
      ? '한 부분만 보완하면 돼요'
      : `서류 ${this.types().length}개를 보완해주세요`,
  );
  protected readonly leftOver = computed(() =>
    this.types().length === 1
      ? '하나만'
      : `${this.types().length}개${this.partial() ? '만' : ' 모두'}`,
  );

  constructor() {
    toObservable(this.parent)
      .pipe(
        switchMap((parent) =>
          this.api
            .createSubmission({
              kind: 'supplement',
              target_month: parent.target_month,
              parent_id: parent.id,
            })
            .pipe(
              // a closed period just means there's no draft to fill in
              catchError((err: unknown) => (isCycleClosed(err) ? of(null) : throwError(() => err))),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (draft) => {
          this.draft.set(draft);
          this.files.set(Object.fromEntries((draft?.files ?? []).map((f) => [f.doc_type, f])));
          this.loaded.set(true);
        },
        error: (err: unknown) => {
          this.loadError.set(errorMessage(err));
          this.loaded.set(true);
        },
      });
  }

  /** The file the reviewer sent back, for the "이전 제출 파일" row. */
  protected previous(type: DocType): SubmissionFile | null {
    return this.parent().files.find((f) => f.doc_type === type) ?? null;
  }

  protected fileOf(type: DocType): SubmissionFile | null {
    return this.files()[type] ?? null;
  }

  protected description(type: DocType): string {
    const from = this.issuedFrom();
    return from && type === 'employment_insurance'
      ? `${from} 이후 발급된 고용보험가입내역서 PDF`
      : `새로 준비한 ${DOC_TYPE_LABELS[type]} PDF`;
  }

  protected onUploaded(file: SubmissionFile): void {
    this.files.update((files) => ({ ...files, [file.doc_type]: file }));
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
    this.api.finalize(draft.id, this.idempotencyKey).subscribe({
      next: (done) => this.submitted.emit(done),
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
