import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  map,
  of,
  skip,
  switchMap,
  tap,
} from 'rxjs';
import { AdminMonth } from '../core/admin-month';

import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { Spinner } from '@otus/shared/ui/spinner';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import {
  AdminSubmissionsApi,
  MonthlyListOptions,
  MonthlyStudentRow,
  SubmissionFilter,
  submissionMonthLabel,
} from '../core/admin-submissions-api';
import { errorMessage } from '../core/api.service';
import { studentLabel } from '../core/cohort';
import { intraProfileUrl } from '../core/intra';
import { NoticesApi } from '../core/notices-api';
import { countRows } from '../core/window-counts';
import {
  HoursTone,
  hoursBand,
  hoursMonthFor,
  reviewWindow,
  submissionTiming,
  TIMING_LABELS,
} from '../core/study-hours';
import { AuthService } from '../core/auth.service';
import { canOpenOriginals } from '../core/roles';
import { DataTable } from '../ui/data-table';
import { Field } from '../ui/field';
import { PageHeader } from '../ui/page-header';

const FILTERS: { value: SubmissionFilter; label: string }[] = [
  { value: 'submitted', label: '제출자 (검토 상태 전체)' },
  { value: 'all', label: '제출 대상자 (미제출 포함)' },
  { value: 'unsubmitted', label: '미제출' },
  { value: 'pending_review', label: '검토 중' },
  { value: 'resubmitted', label: '재검토 대기' },
  { value: 'revision_requested', label: '재검토 요청' },
  { value: 'approved', label: '서류 승인' },
];

/** The group named in the heading for each 서류 상태 filter */
const HEADING_SUBJECT: Record<SubmissionFilter, string> = {
  submitted: '제출자',
  all: '제출 대상자',
  unsubmitted: '미제출자',
  pending_review: '검토 중인 교육생',
  resubmitted: '재검토 대기자',
  revision_requested: '재검토 요청 대상자',
  approved: '서류 승인자',
};

interface PageRequest {
  options: MonthlyListOptions;
  append: boolean;
}

@Component({
  selector: 'app-submissions',
  imports: [
    Button,
    Card,
    DataTable,
    Field,
    NgTemplateOutlet,
    PageHeader,
    RouterLink,
    Spinner,
    StatusBadge,
  ],
  template: `
    <app-page-header eyebrow="월별 제출 내역" [heading]="heading()" [description]="description()" />

    @if (counts(); as c) {
      <dl class="counts" aria-label="해당 월 제출 인원">
        <div class="submitted">
          <dt>제출</dt>
          <dd>{{ c.submitted }}명</dd>
        </div>
        <div class="unsubmitted">
          <dt>미제출</dt>
          <dd>{{ c.unsubmitted }}명</dd>
        </div>
        <div class="total">
          <dt>제출 대상</dt>
          <dd>{{ c.total }}명</dd>
        </div>
        @if (c.employed > 0) {
          <p class="muted">취업 중 {{ c.employed }}명 제외 · 임시 저장은 미제출</p>
        }
      </dl>
    }

    <form class="filters" (submit)="$event.preventDefault(); applyFilters()">
      <app-field label="서류 상태">
        <select
          aria-label="서류 상태"
          [value]="status()"
          (change)="changeStatus($any($event.target).value)"
        >
          @for (filter of filters; track filter.value) {
            <option [value]="filter.value" [selected]="filter.value === status()">
              {{ filter.label }}
            </option>
          }
        </select>
      </app-field>
      <app-field label="교육생 검색">
        <input
          type="search"
          maxlength="100"
          aria-label="교육생 검색"
          placeholder="이름 또는 인트라 ID"
          [value]="query()"
          (input)="typing($any($event.target).value)"
        />
      </app-field>
    </form>

    <app-card
      [heading]="listHeading()"
      footnote="최초 4종에는 해당 월의 고용보험 서류가 포함되어 별도 월별 검토가 표시되지 않아요. 다음 달부터 월별 서류를 확인합니다."
    >
      <div cardAction class="actions">
        @if (canReview()) {
          <button
            appButton
            size="sm"
            type="button"
            [disabled]="loading() || reviewing() || !month()"
            (click)="startReview()"
          >
            {{ reviewing() ? '검토 대기 확인 중…' : '연속 검토 시작' }}
          </button>
        }
        @if (hoursMonth(); as study) {
          <button
            appButton
            size="sm"
            variant="secondary"
            type="button"
            [routerLink]="['/archive', study]"
          >
            파일 일괄 다운로드
          </button>
        }
        <button
          appButton
          size="sm"
          variant="secondary"
          type="button"
          routerLink="/notices"
          [queryParams]="{ month: hoursMonth() }"
        >
          제출 대상 안내
        </button>
      </div>
      @if (reviewMessage(); as message) {
        <p role="status" class="notice">{{ message }}</p>
      }
      @if (reviewError(); as message) {
        <p role="alert" class="error">{{ message }}</p>
      }
      <div class="table-scroll" [attr.aria-busy]="loading()">
        <app-data-table>
          <table>
            <colgroup>
              <col class="index-column" />
              <col class="student-column" />
              <col />
              <col class="hours-column" />
              <col class="profile-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" class="index"><span class="sr-only">번호</span></th>
                <th scope="col">교육생</th>
                <th scope="col">선택 월의 제출</th>
                <th scope="col">
                  학습 시간
                  @if (hoursMonth(); as hm) {
                    <span class="th-sub">{{ monthName(hm) }}</span>
                  }
                  <span class="th-sub">누르면 인트라에서 확인해요</span>
                </th>
                <th scope="col">현재 정보</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.user.id; let i = $index) {
                <tr>
                  <td class="index">{{ i + 1 }}</td>
                  <td>
                    <a class="link" [routerLink]="['/users', row.user.id]">{{
                      label(row.user.display_name, row.user)
                    }}</a>
                    <span class="muted login">{{ row.user.login }}</span>
                  </td>
                  <td>
                    @for (chain of row.chains; track chain.root_submission_id) {
                      <div class="chain">
                        <a class="link" [routerLink]="['/submissions', chain.latest_submission_id]">
                          {{ chain.root_kind === 'initial' ? '최초 4종' : '월별 서류' }}
                          @if (chain.supplement_count > 0) {
                            <span> · 보완 {{ chain.supplement_count }}회</span>
                          }
                        </a>
                        <app-status-badge [status]="chain.status" />
                        <span class="muted submitted-at">
                          {{ dateTime(chain.submitted_at) }}
                          @if (timing(chain.submitted_at); as t) {
                            <span class="timing" [class]="'timing ' + t">{{
                              timingLabels[t]
                            }}</span>
                          }
                        </span>
                      </div>
                    } @empty {
                      <app-status-badge status="missing" />
                    }
                  </td>
                  <td>
                    <!-- the cell opens the student's 42 Intra profile, to check the hours by hand -->
                    @if (intraUrl(row.user.login); as url) {
                      <a
                        class="hours-link"
                        [href]="url"
                        target="_blank"
                        rel="noopener noreferrer"
                        [attr.aria-label]="
                          row.user.login + '의 인트라 프로필에서 학습 시간 확인 (새 창)'
                        "
                      >
                        <ng-container *ngTemplateOutlet="hoursCell; context: { $implicit: row }" />
                        <span class="out" aria-hidden="true">↗</span>
                      </a>
                    } @else {
                      <ng-container *ngTemplateOutlet="hoursCell; context: { $implicit: row }" />
                    }
                  </td>
                  <td>
                    {{ row.user.employed ? '취업 중' : '미취업' }}
                    <span class="muted login">{{
                      row.user.initial_submitted ? '최초 서류 제출 완료' : '최초 서류 미완료'
                    }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </app-data-table>
      </div>
      @if (error(); as message) {
        <div class="empty">
          <p role="alert" class="error">{{ message }}</p>
          <button appButton variant="secondary" type="button" (click)="applyFilters()">
            다시 불러오기
          </button>
        </div>
      } @else if (loading()) {
        <app-spinner label="제출 내역을 불러오는 중…" [size]="rows().length ? 'inline' : 'card'" />
      } @else if (rows().length === 0) {
        <p class="empty">선택한 조건에 맞는 교육생이 없어요.</p>
      }
    </app-card>
    @if (nextBefore() !== null) {
      <div #sentinel class="more" aria-hidden="true"></div>
    }

    <ng-template #hoursCell let-row>
      @if (row.user.employed) {
        <span class="muted">취업 중 · 제외</span>
      } @else if (hoursOf(row.user.id); as band) {
        <span class="hours" [class]="'hours ' + band.tone">{{ band.label }}</span>
      } @else {
        <span class="muted">—</span>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .actions,
    .filters {
      display: flex;
      align-items: end;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .filters app-field:first-child {
      min-width: 12rem;
    }
    .filters app-field:nth-child(2) {
      width: 16rem;
      max-width: 100%;
    }
    .counts {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: 0;
    }
    .counts div {
      display: flex;
      align-items: baseline;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-2);
      border-radius: 999px;
    }
    .counts .submitted {
      background: var(--color-mint);
      color: var(--color-teal);
    }
    .counts .unsubmitted {
      background: var(--color-red-bg);
      color: var(--color-red);
    }
    .counts .total {
      background: var(--color-blue-bg);
      color: var(--color-blue);
    }
    .counts dt {
      font-size: var(--font-size-caption);
    }
    .counts dd {
      margin: 0;
      font-weight: var(--font-weight-medium);
    }
    input,
    select {
      width: 100%;
      min-width: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      outline: none;
    }
    .table-scroll {
      overflow-x: auto;
    }
    table {
      min-width: 42rem;
    }
    .index-column {
      width: 3rem;
    }
    .index {
      color: var(--color-muted);
      font-size: var(--font-size-caption);
      text-align: center;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .student-column {
      width: 20%;
    }
    .profile-column {
      width: 16%;
    }
    .hours-column {
      width: 14%;
    }
    .th-sub {
      display: block;
      font-weight: var(--font-weight-regular, 400);
      font-size: var(--font-size-caption);
    }
    .hours {
      display: inline-block;
      padding: 2px var(--space-2);
      border-radius: 999px;
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }
    .hours-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px;
      margin: -2px -4px;
      border-radius: var(--radius-sm);
      color: inherit;
      text-decoration: none;
    }
    .hours-link:hover,
    .hours-link:focus-visible {
      background: var(--color-mint);
    }
    .hours-link .out {
      color: var(--color-teal);
      font-size: var(--font-size-caption);
    }
    .hours.low {
      background: var(--color-red-bg);
      color: var(--color-red);
    }
    .hours.mid {
      background: var(--color-blue-bg);
      color: var(--color-blue);
    }
    .hours.high {
      background: var(--color-mint);
      color: var(--color-teal);
    }
    .hours.unknown {
      background: var(--color-amber-bg);
      color: var(--color-amber);
    }
    a {
      color: var(--color-teal);
      font-weight: var(--font-weight-medium);
      text-decoration: none;
    }
    .link {
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.2em;
      transition:
        color 0.2s ease,
        text-decoration-color 0.2s ease,
        text-underline-offset 0.2s ease;
    }
    .link:hover,
    .link:focus-visible {
      color: var(--color-blue);
      text-decoration-color: currentColor;
      text-underline-offset: 0.35em;
    }
    @media (prefers-reduced-motion: reduce) {
      .link {
        transition: none;
      }
    }
    .muted {
      color: var(--color-muted);
      font-size: var(--font-size-caption);
    }
    .login {
      display: block;
      margin-top: var(--space-1);
    }
    .chain {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-1);
      padding: var(--space-1) 0;
    }
    .timing {
      display: inline-block;
      margin-left: var(--space-1);
      padding: 1px var(--space-1);
      border-radius: 999px;
      font-weight: var(--font-weight-medium);
    }
    .timing.in {
      background: var(--color-mint);
      color: var(--color-teal);
    }
    .timing.late {
      background: var(--color-amber-bg);
      color: var(--color-amber);
    }
    .timing.early {
      background: var(--color-blue-bg);
      color: var(--color-blue);
    }
    .submitted-at {
      margin-left: var(--space-1);
    }
    .empty {
      padding: var(--space-3) 0;
      text-align: center;
      color: var(--color-muted);
    }
    .error {
      color: var(--color-red);
    }
    .notice {
      color: var(--color-muted);
    }
    .more {
      min-height: 1px;
    }
    p {
      margin: 0;
    }
    .empty button {
      margin-top: var(--space-2);
    }
  `,
})
export class Submissions {
  private readonly api = inject(AdminSubmissionsApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly selectedMonth = inject(AdminMonth);
  private readonly destroyed = inject(DestroyRef);
  private readonly requests = new Subject<PageRequest>();
  private readonly typed = new Subject<void>();
  private applied: MonthlyListOptions = {};

  protected readonly filters = FILTERS;
  protected readonly dateTime = dotDateTime;
  protected readonly label = studentLabel;
  protected readonly intraUrl = intraProfileUrl;
  protected readonly query = signal('');
  protected readonly status = signal<SubmissionFilter>('submitted');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly notices = inject(NoticesApi);
  private countsMonth?: string;
  protected readonly counts = signal<{
    submitted: number;
    unsubmitted: number;
    total: number;
    employed: number;
  } | null>(null);
  /** The working month, from today's date: its review judges the month before it */
  protected readonly month = signal<string | null>(null);
  /** The month's saved study-hour band per student, from the same preview as the counts */
  private readonly studyHours = signal<Map<number, 0 | 40 | 80 | null>>(new Map());
  /** The month the hours are of: the last finished month (September when working in October) */
  protected readonly hoursMonth = signal<string | null>(null);
  protected readonly monthName = submissionMonthLabel;
  protected hoursOf(userId: number): { tone: HoursTone; label: string } | null {
    const map = this.studyHours();
    return map.size && map.has(userId) ? hoursBand(map.get(userId)) : null;
  }
  /** The count grows with the scrolling: "N명 이상" until the last page is loaded. */
  protected readonly listHeading = computed(() => {
    if (this.loading() && this.rows().length === 0) return '교육생 제출 현황';
    const more = this.nextBefore() !== null ? ' 이상' : '';
    return `교육생 제출 현황 · ${this.rows().length}명${more}`;
  });
  private readonly window = computed(() => {
    const month = this.month();
    return month ? reviewWindow(month) : null;
  });
  protected readonly timingLabels = TIMING_LABELS;
  /** Inside the review window, or before / after it (null while the month is not known) */
  protected timing(submittedAt: string) {
    const w = this.window();
    return w ? submissionTiming(submittedAt, w) : null;
  }
  protected readonly heading = computed(() => this.window()?.title ?? '월별 제출 내역');
  protected readonly description = computed(() => {
    const range = this.window()?.range;
    const view = `보기 · ${HEADING_SUBJECT[this.status()]}`;
    return range
      ? `${range}를 검토해요. ${view}`
      : '교육생별 제출 상태와 보완 이력을 확인하고 서류 검토를 이어가세요.';
  });
  protected readonly rows = signal<MonthlyStudentRow[]>([]);
  protected readonly nextBefore = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly reviewing = signal(false);
  protected readonly reviewMessage = signal<string | null>(null);
  protected readonly reviewError = signal<string | null>(null);
  protected readonly canReview = computed(() =>
    canOpenOriginals(this.auth.me()?.role ?? 'student'),
  );

  constructor() {
    // Infinite scroll: load the next page when the end marker comes into view. Re-observing after
    // every page also loads again when a short page leaves the marker on screen.
    effect((onCleanup) => {
      const target = this.sentinel()?.nativeElement;
      this.rows();
      if (!target || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.loadMore();
      });
      observer.observe(target);
      onCleanup(() => observer.disconnect());
    });
    // live search: reload shortly after the last keystroke
    this.typed
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyed))
      .subscribe(() => this.applyFilters());
    const route = inject(ActivatedRoute);
    const params = route.snapshot.queryParamMap;
    this.query.set(params.get('query') ?? '');
    const filter = params.get('status');
    if (FILTERS.some((option) => option.value === filter))
      this.status.set(filter as SubmissionFilter);
    this.requests
      .pipe(
        tap((request) => {
          this.loading.set(true);
          this.error.set(null);
          this.reviewMessage.set(null);
          this.reviewError.set(null);
          if (!request.append) {
            this.rows.set([]);
            this.nextBefore.set(null);
          }
        }),
        switchMap((request) =>
          this.api.listWindow(request.options).pipe(
            map((page) => ({ page, append: request.append })),
            catchError((error: unknown) => {
              this.error.set(errorMessage(error));
              this.loading.set(false);
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((result) => {
        if (!result) return;
        const { page, append } = result;
        this.month.set(page.month);
        this.loadCounts(page.month);
        this.applied.month = page.month;
        this.rows.update((rows) =>
          append
            ? [
                ...rows,
                ...page.items.filter((item) => !rows.some((row) => row.user.id === item.user.id)),
              ]
            : page.items,
        );
        this.nextBefore.set(page.next_before);
        this.loading.set(false);
      });
    // the arrows in the header move to another window: load it
    toObservable(this.selectedMonth.viewing)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed(this.destroyed))
      .subscribe((month) => {
        this.month.set(month);
        this.applyFilters();
      });
    route.queryParamMap
      .pipe(
        map((params) => params.get('status')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((status) => {
        // a link with ?status= (the dashboard counts) picks that filter, even on this page
        if (FILTERS.some((option) => option.value === status))
          this.status.set(status as SubmissionFilter);
        this.month.set(this.selectedMonth.viewing());
        this.applyFilters();
      });
  }

  /**
   * Counting like the dashboard card: 취업 중 left out, 임시 저장 counted as 미제출, and only the
   * submissions inside the window (one made after the deadline is not counted). The hours column
   * comes from the saved aggregate of the study month.
   */
  private loadCounts(month: string): void {
    if (this.countsMonth === month) return;
    this.countsMonth = month;
    this.counts.set(null);
    this.studyHours.set(new Map());
    const hoursMonth = hoursMonthFor(month);
    this.hoursMonth.set(hoursMonth);
    this.api
      .windowRows(month)
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (rows) => {
          if (this.countsMonth === month) this.counts.set(countRows(rows));
        },
        error: () => {
          if (this.countsMonth === month) this.counts.set(null);
        },
      });
    this.notices
      .preview(hoursMonth, ['all'])
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (r) => {
          if (this.countsMonth === month)
            this.studyHours.set(new Map(r.targets.map((t) => [t.user_id, t.study_hours])));
        },
        error: () => undefined,
      });
  }

  protected typing(value: string): void {
    this.query.set(value);
    this.typed.next();
  }

  protected applyFilters(): void {
    this.applied = {
      month: this.month() ?? undefined,
      query: this.query().trim(),
      status: this.status(),
      limit: 20,
    };
    this.requests.next({ options: { ...this.applied }, append: false });
  }

  protected changeStatus(status: SubmissionFilter): void {
    this.status.set(status);
    this.applyFilters();
  }

  protected loadMore(): void {
    const before = this.nextBefore();
    if (before === null || this.loading()) return;
    this.requests.next({ options: { ...this.applied, before }, append: true });
  }

  protected startReview(): void {
    const month = this.month();
    if (!month || !this.canReview() || this.reviewing()) return;
    this.reviewing.set(true);
    this.reviewMessage.set(null);
    this.reviewError.set(null);
    this.api
      .windowQueue(month)
      .pipe(
        takeUntilDestroyed(this.destroyed),
        finalize(() => this.reviewing.set(false)),
      )
      .subscribe({
        next: (page) => {
          if (this.month() !== month) return;
          const first = page.items[0];
          if (first) void this.router.navigate(['/submissions', first.id]);
          else this.reviewMessage.set('이 검토 기간에 검토 대기 중인 제출이 없어요.');
        },
        error: (error: unknown) => {
          if (this.month() === month) this.reviewError.set(errorMessage(error));
        },
      });
  }
}
