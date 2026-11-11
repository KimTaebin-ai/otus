import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of, Subscription, switchMap, timer } from 'rxjs';

import { DocType } from '@otus/shared/core/api-types';
import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import { ReviewDecision, ReviewView } from '../core/admin.models';
import { AuthService } from '../core/auth.service';
import { AdminMonth } from '../core/admin-month';
import { errorMessage } from '../core/api.service';
import {
  ReviewApi,
  ReviewBody,
  ReviewNavigation,
  SubmissionDetail,
  SubmissionEvent,
  SubmissionRecord,
  toReviewView,
} from '../core/review-api';
import { docLabel, eventLine, revisionBlocker } from '../core/review-copy';
import { NoticesApi } from '../core/notices-api';
import { ReviewState } from '../core/review-state';
import {
  HoursCheck,
  hoursCheck,
  hoursMonthFor,
  needsHoursConfirm,
  workingMonthOf,
} from '../core/study-hours';
import { canOpenOriginals } from '../core/roles';
import { ApproveConfirmViewComponent } from './approve-confirm-view';
import { ApprovedViewComponent } from './approved-view';
import { RevisionComposeViewComponent } from './revision-compose-view';
import { RevisionRequestedViewComponent } from './revision-requested-view';
import { SubmissionReviewViewComponent } from './submission-review-view';

export type ReviewStage = 'review' | 'approve' | 'approved' | 'revision' | 'requested';

@Component({
  selector: 'app-submission-review',
  imports: [
    Button,
    Card,
    StatusBadge,
    RouterLink,
    ApproveConfirmViewComponent,
    ApprovedViewComponent,
    RevisionComposeViewComponent,
    RevisionRequestedViewComponent,
    SubmissionReviewViewComponent,
  ],
  template: `
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <button appButton variant="secondary" (click)="load()">다시 불러오기</button>
    }
    @if (loading()) {
      <p role="status">제출 내역을 불러오고 있습니다.</p>
    }
    @if (view(); as v) {
      @if (!previewMode) {
        <nav class="navigation" aria-label="연속 검토">
          <a routerLink="/submissions">월별 제출 내역</a>
          @if (canOpen()) {
            <div class="user-navigation">
              @if (navigation(); as n) {
                <span class="remaining">다른 검토 대기 {{ n.remaining_count }}건</span>
              }
              <button
                appButton
                variant="secondary"
                type="button"
                [disabled]="busy() || !navigation()?.previous_id"
                (click)="moveUser('previous_id')"
              >
                <span aria-hidden="true">←</span> 이전 사용자
              </button>
              <button
                appButton
                variant="secondary"
                type="button"
                [disabled]="busy() || !navigation()?.next_id"
                (click)="moveUser('next_id')"
              >
                다음 사용자 <span aria-hidden="true">→</span>
              </button>
            </div>
          }
        </nav>
        @if (navigationError()) {
          <p role="alert">{{ navigationError() }}</p>
        }
        @if (detail()?.latest_submission_id !== v.submissionId) {
          <p>
            이 제출의 보완본이 있습니다.
            <a
              [routerLink]="['/submissions', detail()?.latest_submission_id]"
              [queryParams]="{ month: v.month }"
              >최신 보완본 보기</a
            >
          </p>
        }
        @if (canReview() && !canRequestRevision()) {
          <p role="status">현재 보완 제출 기간이 아니므로 승인만 가능합니다.</p>
        }
      }
      @switch (stage) {
        @case ('review') {
          @if (v.docs.length) {
            <app-submission-review-view
              [view]="v"
              [canOpenOriginals]="canOpen()"
              [canReview]="canReview()"
              [canRequestRevision]="canRequestRevision()"
              [showMemo]="previewMode"
              [hours]="hours()"
              [viewed]="state.viewed()"
              [memo]="state.memo()"
              (opened)="state.markViewed($event)"
              (memoChange)="state.memo.set($event)"
            />
          } @else {
            <h1>{{ v.name }}님의 제출 내역</h1>
            <p>조회할 첨부 파일이 없습니다.</p>
          }
        }
        @case ('approve') {
          <app-approve-confirm-view
            [view]="v"
            [viewed]="viewedOrAll()"
            [hours]="hours()"
            [hoursConfirmed]="hoursConfirmed()"
            (hoursConfirmedChange)="hoursConfirmed.set($event)"
            [disabled]="busy() || !canApprove()"
            (confirm)="submit('approved')"
          />
        }
        @case ('approved') {
          @if (decision(); as d) {
            <app-approved-view [view]="v" [decision]="d" />
          } @else {
            <p>승인 완료된 제출이 아닙니다.</p>
            <a [routerLink]="['/submissions', v.submissionId]">제출 내역 확인</a>
          }
        }
        @case ('revision') {
          <app-revision-compose-view
            [view]="v"
            [reason]="state.reason()"
            [selected]="state.selected()"
            [disabled]="busy() || !canRequestRevision()"
            (reasonChange)="state.reason.set($event)"
            (toggle)="state.toggle($event)"
            (confirm)="submit('revision_requested')"
          />
        }
        @case ('requested') {
          @if (decision(); as d) {
            <app-revision-requested-view
              [view]="v"
              [decision]="d"
              [docTypes]="asked()"
              [reasonText]="reasonText()"
            />
          } @else {
            <p>재검토 요청이 완료된 제출이 아닙니다.</p>
            <a [routerLink]="['/submissions', v.submissionId]">제출 내역 확인</a>
          }
        }
      }
      @if (!previewMode) {
        <section class="history" aria-labelledby="history-title">
          <app-card>
            <h2 id="history-title">제출·보완 이력</h2>
            @for (record of history(); track record.id) {
              <article>
                <h3>
                  <a
                    [routerLink]="['/submissions', record.id]"
                    [queryParams]="{ month: record.target_month }"
                  >
                    {{
                      record.kind === 'supplement'
                        ? '보완 제출'
                        : record.kind === 'initial'
                          ? '최초 제출'
                          : '월별 제출'
                    }}
                  </a>
                  <app-status-badge [status]="record.status" />
                </h3>
                <p>{{ formatTime(record.submitted_at) }}</p>
                @if (record.review_comment) {
                  <p>보완 사유: {{ record.review_comment }}</p>
                }
                <ul>
                  @for (file of record.files; track file.id) {
                    <li>
                      @if (canOpen()) {
                        <a [href]="'/api/files/' + file.id" target="_blank" rel="noopener">{{
                          file.original_name
                        }}</a>
                      } @else {
                        {{ file.original_name }}
                      }
                      · {{ docName(file.doc_type) }}
                    </li>
                  }
                </ul>
              </article>
            }
          </app-card>
          <app-card>
            <h2>검토 기록</h2>
            @for (event of events(); track event.id) {
              <article>
                <p>{{ formatTime(event.at) }} · {{ eventText(event) }}</p>
                @if (event.review_comment) {
                  <p>{{ event.review_comment }}</p>
                }
                @if (event.revision_doc_types.length) {
                  <p>
                    요청 서류:
                    @for (type of event.revision_doc_types; track type) {
                      {{ docName(type) }}
                    }
                  </p>
                }
              </article>
            } @empty {
              <p>검토 기록이 없습니다.</p>
            }
          </app-card>
        </section>
      }
    }
  `,
  styles: `
    .navigation {
      display: flex;
      gap: var(--space-3);
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-3);
    }
    .user-navigation {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-left: auto;
    }
    .remaining {
      color: var(--color-muted);
      font-size: var(--font-size-caption);
    }
    a {
      color: var(--color-teal);
    }
    [role='alert'] {
      color: var(--color-amber);
    }
    .history {
      display: grid;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    article + article {
      border-top: var(--border-width) solid var(--color-border);
      padding-top: var(--space-2);
      margin-top: var(--space-2);
    }
    h3 {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    p,
    li {
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
  `,
})
export class SubmissionReview {
  private readonly auth = inject(AuthService);
  private readonly months = inject(AdminMonth);
  private readonly api = inject(ReviewApi);
  private readonly notices = inject(NoticesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly state = inject(ReviewState);
  protected readonly stage = this.route.snapshot.data['stage'] as ReviewStage;
  protected readonly previewMode =
    (typeof ngDevMode === 'undefined' || !!ngDevMode) &&
    this.route.snapshot.queryParamMap.has('preview');
  protected readonly view = signal<ReviewView | null>(null);
  protected readonly detail = signal<SubmissionDetail | null>(null);
  protected readonly history = signal<SubmissionRecord[]>([]);
  protected readonly events = signal<SubmissionEvent[]>([]);
  protected readonly navigation = signal<ReviewNavigation | null>(null);
  protected readonly navigationError = signal('');
  protected readonly decision = signal<ReviewDecision | null>(null);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  /** The submission month's study hours (saved aggregate); null until known */
  protected readonly hours = signal<HoursCheck | null>(null);
  protected readonly hoursConfirmed = signal(false);
  /** The month whose 검토 기간 this submission is judged in (a Oct 17 submission: November) */
  protected readonly workingMonth = signal<string | null>(null);
  readonly monthChangeBlocked = this.busy;
  private readonly now = signal(Date.now());
  private readonly fallbackReason = signal('');
  private readonly requestedDocs = signal<DocType[]>([]);
  private loadSubscription?: Subscription;
  private requestBody = '';
  private requestKey = '';
  protected readonly formatTime = dotDateTime;
  protected readonly docName = docLabel;
  protected readonly eventText = (event: SubmissionEvent) => eventLine(event).text;
  protected readonly canOpen = computed(() => {
    const me = this.auth.me();
    return !!me && canOpenOriginals(me.role);
  });
  protected readonly canReview = computed(
    () =>
      this.previewMode ||
      (this.canOpen() &&
        this.detail()?.latest_submission_id === this.view()?.submissionId &&
        ['pending_review', 'resubmitted'].includes(this.view()?.status ?? '')),
  );
  protected readonly canRequestRevision = computed(() => {
    if (this.previewMode) return true;
    const period = this.view()?.period;
    const now = this.now();
    const month = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
    return (
      this.canReview() &&
      this.view()?.month === month &&
      !!period &&
      Date.parse(period.opensAt) <= now &&
      now < Date.parse(period.closesAt)
    );
  });
  protected readonly viewedOrAll = computed<readonly DocType[]>(() => {
    const v = this.view();
    return v && v.docs.length === 1 ? [v.docs[0].docType] : this.state.viewed();
  });
  protected readonly canApprove = computed(
    () =>
      this.previewMode ||
      (this.canReview() &&
        !!this.view()?.docs.length &&
        this.view()!.docs.every((doc) => this.viewedOrAll().includes(doc.docType)) &&
        // a month without a met 40-hour requirement needs the reviewer's explicit confirmation
        this.hours() !== null &&
        (!needsHoursConfirm(this.hours()) || this.hoursConfirmed())),
  );
  protected readonly asked = computed<readonly DocType[]>(() => {
    if (!this.previewMode && this.stage === 'requested') return this.requestedDocs();
    const v = this.view();
    if (!v) return [];
    return v.docs.length > 1
      ? this.state.selected().length
        ? this.state.selected()
        : [v.docs[0].docType]
      : v.docs.map((d) => d.docType);
  });
  protected readonly reasonText = computed(
    () => this.fallbackReason() || this.state.reason().trim(),
  );

  constructor() {
    effect(() => {
      const v = this.view();
      if (v) this.state.begin(v.submissionId);
    });
    this.destroyRef.onDestroy(() => this.loadSubscription?.unsubscribe());
    if ((typeof ngDevMode === 'undefined' || ngDevMode) && this.previewMode) {
      const preview = this.route.snapshot.queryParamMap.get('preview');
      void import('../dev/preview-data').then((m) => {
        this.view.set(preview === 'monthly' ? m.REVIEW_MONTHLY_PREVIEW : m.REVIEW_PREVIEW);
        this.decision.set(
          m.REVIEW_DECISION_PREVIEW[this.stage === 'requested' ? 'revision_requested' : 'approved'],
        );
        this.fallbackReason.set(m.REVIEW_REASON_PREVIEW);
      });
    } else {
      timer(0, 1000)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.now.set(Date.now()));
      this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    }
  }

  /** The saved study-hour aggregate of the submission's month; a failed read counts as unknown. */
  private loadHours(workingMonth: string, userId: number): void {
    // the 지원금 is worked out from the month before the one the staff are working in
    const month = hoursMonthFor(workingMonth);
    this.notices
      .preview(month, ['all'])
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      )
      .subscribe((r) => {
        if (this.detail()?.user.id !== userId) return;
        const target = r?.targets.find((t) => t.user_id === userId);
        this.hours.set(hoursCheck(month, target?.study_hours));
      });
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || this.previewMode) return;
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.view.set(null);
    this.decision.set(null);
    this.navigation.set(null);
    this.navigationError.set('');
    this.hours.set(null);
    this.hoursConfirmed.set(false);
    this.loadSubscription = forkJoin({
      detail: this.api.detail(id),
      history: this.api.history(id),
      events: this.api.events(id),
    })
      .pipe(
        switchMap((data) => {
          const navigation = this.canOpen()
            ? this.api.userNavigation(id, data.detail.target_month, data.detail.user.id).pipe(
                catchError(() => {
                  this.navigationError.set(
                    '이전·다음 사용자를 불러오지 못했습니다. 제출 내역은 계속 확인할 수 있습니다.',
                  );
                  return of(null);
                }),
              )
            : of(null);
          return forkJoin({ data: of(data), navigation });
        }),
      )
      .subscribe({
        next: ({ data, navigation }) => {
          // the month this submission is judged in (an Oct 17 submission: November)
          const working = workingMonthOf(data.detail.submitted_at);
          this.workingMonth.set(working);
          this.state.begin(id);
          this.detail.set(data.detail);
          this.loadHours(working, data.detail.user.id);
          this.history.set(data.history.items);
          this.events.set(data.events.items);
          this.navigation.set(navigation);
          this.view.set(toReviewView(data.detail, data.events.items));
          this.fallbackReason.set(data.detail.review_comment ?? '');
          const requested = data.detail.revision_doc_types.length
            ? data.detail.revision_doc_types
            : data.detail.required_doc_types;
          this.requestedDocs.set(requested);
          const action = this.stage === 'approved' ? 'approved' : 'revision_requested';
          const event = data.events.items.find(
            (e) => e.submission_id === id && e.action === action,
          );
          if (data.detail.status === action && event) {
            this.decision.set({ result: action, actor: event.actor, at: event.at });
            if (action === 'revision_requested') {
              this.fallbackReason.set(event.review_comment ?? data.detail.review_comment ?? '');
              this.requestedDocs.set(
                event.revision_doc_types.length ? event.revision_doc_types : requested,
              );
            }
          }
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.error.set(errorMessage(error));
        },
      });
  }

  protected submit(status: 'approved' | 'revision_requested'): void {
    const view = this.view();
    if (!view || this.busy()) return;
    const destination = status === 'approved' ? ['approved'] : ['revision', 'requested'];
    if (this.previewMode) {
      void this.router.navigate(
        ['/submissions', this.route.snapshot.paramMap.get('id'), ...destination],
        { queryParamsHandling: 'preserve' },
      );
      return;
    }
    this.now.set(Date.now());
    if (
      (status === 'approved' && !this.canApprove()) ||
      (status === 'revision_requested' && !this.canRequestRevision())
    )
      return;
    const selected =
      view.docs.length === 1 ? view.docs.map((d) => d.docType) : [...this.state.selected()];
    if (status === 'revision_requested' && revisionBlocker(selected.length, this.state.reason()))
      return;
    const body: ReviewBody =
      status === 'approved'
        ? { status }
        : {
            status,
            review_comment: this.state.reason().trim(),
            revision_doc_types: selected,
          };
    const signature = JSON.stringify([view.submissionId, body]);
    if (signature !== this.requestBody) {
      this.requestBody = signature;
      this.requestKey = crypto.randomUUID();
    }
    this.busy.set(true);
    this.error.set('');
    this.api
      .review(view.submissionId, body, this.requestKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          void this.router.navigate(['/submissions', view.submissionId, ...destination], {
            queryParams: { month: view.month },
          });
        },
        error: (error) => {
          this.busy.set(false);
          this.error.set(errorMessage(error));
        },
      });
  }

  protected moveUser(direction: 'previous_id' | 'next_id'): void {
    const id = this.navigation()?.[direction];
    const view = this.view();
    if (!id || !view || this.busy()) return;
    void this.router.navigate(['/submissions', id], { queryParams: { month: view.month } });
  }
}
