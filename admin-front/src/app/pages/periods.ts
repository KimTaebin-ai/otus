import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, distinctUntilChanged, map } from 'rxjs';

import { dotDateTime, lastMoment } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { PageHeader } from '../ui/page-header';
import { AdminMonth } from '../core/admin-month';
import { errorMessage } from '../core/api.service';
import { submissionMonthLabel } from '../core/admin-submissions-api';
import {
  PERIOD_LABELS,
  PeriodChange,
  PeriodList,
  PeriodsApi,
  SubmissionPeriod,
  periodDefaults,
  periodInput,
  periodSave,
} from '../core/periods-api';

@Component({
  selector: 'app-periods',
  imports: [FormsModule, RouterLink, Button, Card, InfoBox, PageHeader],
  templateUrl: './periods.html',
  styleUrl: './periods.css',
})
export class Periods {
  private readonly api = inject(PeriodsApi);
  private readonly destroyed = inject(DestroyRef);
  private readonly months = inject(AdminMonth);
  private readonly route = inject(ActivatedRoute);
  private requestedMonth: string | null = null;
  private listRequest?: Subscription;
  private historyRequest?: Subscription;
  protected readonly page = signal<PeriodList | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  readonly monthChangeBlocked = this.saving;
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly selected = signal<SubmissionPeriod | null>(null);
  protected readonly start = signal('');
  protected readonly end = signal('');
  protected readonly history = signal<PeriodChange[]>([]);
  protected readonly historyError = signal<string | null>(null);
  protected readonly historyLoading = signal(false);
  protected readonly labels = PERIOD_LABELS;
  protected readonly monthLabel = submissionMonthLabel;
  protected readonly dateTime = dotDateTime;
  protected readonly lastMoment = lastMoment;
  protected readonly editable = computed(() => {
    const selected = this.selected();
    const page = this.page();
    return !!selected && !!page?.can_manage && selected.target_month >= page.current_month;
  });
  protected readonly bounds = computed(() =>
    this.selected() ? periodDefaults(this.selected()!.target_month) : null,
  );
  protected readonly body = computed(() =>
    this.selected()
      ? periodSave(
          this.selected()!.target_month,
          this.start(),
          this.end(),
          this.selected()!.version,
        )
      : null,
  );
  protected readonly changed = computed(() => {
    const row = this.selected();
    const body = this.body();
    return (
      !!row &&
      !!body &&
      (!row.opens_at ||
        !row.closes_at ||
        Date.parse(row.opens_at) !== Date.parse(body.opens_at) ||
        Date.parse(row.closes_at) !== Date.parse(body.closes_at))
    );
  });

  constructor() {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('month')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((month) => {
        this.requestedMonth = month ?? this.months.selected();
        this.message.set(null);
        if (this.saving()) {
          this.selected.set(null);
          this.loading.set(true);
          return;
        }
        this.load();
      });
  }

  protected load(conflict = false): void {
    if (this.saving()) return;
    this.listRequest?.unsubscribe();
    this.historyRequest?.unsubscribe();
    this.selected.set(null);
    this.history.set([]);
    this.loading.set(true);
    this.error.set(null);
    const month = this.requestedMonth;
    this.listRequest = this.api
      .list(month ? Number(month.slice(0, 4)) : undefined)
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (page) => {
          this.page.set(page);
          this.months.current.set(page.current_month);
          this.loading.set(false);
          const row = page.items.find((p) => p.target_month === (month ?? page.current_month));
          if (row) {
            this.requestedMonth = row.target_month;
            this.months.selected.set(row.target_month);
            this.select(row);
          } else {
            this.error.set(
              '선택한 월의 제출 기간을 찾을 수 없습니다. 상단에서 월을 다시 선택해 주세요.',
            );
          }
          if (conflict) {
            this.error.set(
              '다른 담당자가 기간을 변경했습니다. 최신 내용을 불러왔으니 확인 후 다시 저장해 주세요.',
            );
          }
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.page.set(null);
          this.error.set(errorMessage(error));
        },
      });
  }

  protected select(row: SubmissionPeriod): void {
    if (this.saving() || this.loading()) return;
    this.historyRequest?.unsubscribe();
    this.selected.set(row);
    const defaults = periodDefaults(row.target_month);
    this.start.set(row.opens_at ? periodInput(row.opens_at) : defaults.start);
    this.end.set(row.closes_at ? periodInput(row.closes_at, 1000) : defaults.end);
    this.error.set(null);
    this.message.set(null);
    this.history.set([]);
    this.historyError.set(null);
    this.historyLoading.set(true);
    this.historyRequest = this.api
      .history(row.target_month)
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (history) => {
          this.history.set(history);
          this.historyLoading.set(false);
        },
        error: (error: unknown) => {
          this.historyError.set(errorMessage(error));
          this.historyLoading.set(false);
        },
      });
  }

  protected save(): void {
    const row = this.selected();
    const body = this.body();
    if (!row || !body || !this.editable() || !this.changed() || this.saving() || this.loading())
      return;
    this.saving.set(true);
    this.error.set(null);
    this.message.set(null);
    this.api
      .save(row.target_month, body)
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          if (this.requestedMonth !== row.target_month) {
            this.load();
            return;
          }
          this.page.update((page) =>
            page
              ? {
                  ...page,
                  items: page.items.map((p) => (p.target_month === saved.target_month ? saved : p)),
                }
              : page,
          );
          this.select(saved);
          this.message.set(`${submissionMonthLabel(saved.target_month)} 제출 기간을 저장했습니다.`);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          if (this.requestedMonth !== row.target_month) {
            this.load();
            return;
          }
          if (error instanceof HttpErrorResponse && error.status === 409) {
            this.load(true);
          } else {
            if (error instanceof HttpErrorResponse && error.status === 403) {
              this.page.update((page) => (page ? { ...page, can_manage: false } : page));
            }
            this.error.set(errorMessage(error));
          }
        },
      });
  }
}
