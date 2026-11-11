import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  EMPTY,
  Subscription,
  catchError,
  distinctUntilChanged,
  exhaustMap,
  map,
  timer,
} from 'rxjs';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { dotDateTime } from '@otus/shared/core/format';
import { AdminMonth } from '../core/admin-month';
import { NoticeSendResult } from '../core/admin.models';
import { errorMessage } from '../core/api.service';
import { NoticeChannel, noticeChannelLabel } from '../core/notice-channel';
import {
  NOTICE_TARGET_GROUPS,
  NoticeTargetGroup,
  NoticeDelivery,
  NoticePreviewResponse,
  NoticeSendRequest,
  NoticesApi,
  toNoticeResult,
} from '../core/notices-api';
import { DataTable } from '../ui/data-table';
import { NoticeSent } from './notice-sent';

/** One page: `compose` (write, pick channel and targets), `confirm` (the same page, locked, with the send check) and `sent`. */
type NoticeStage = 'compose' | 'confirm' | 'sent';

@Component({
  selector: 'app-notices',
  imports: [Button, Card, FormsModule, DataTable, NoticeSent],
  templateUrl: './notices.html',
  styleUrl: './notices.css',
})
export class Notices {
  private readonly api = inject(NoticesApi);
  private readonly destroyed = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly months = inject(AdminMonth);
  private readonly injector = inject(Injector);
  private readonly confirmHeading = viewChild<ElementRef<HTMLElement>>('confirmHeading');
  private requestedMonth?: string;
  protected previewMode = false;
  protected readonly groups = NOTICE_TARGET_GROUPS;
  protected readonly selectedGroups = signal<NoticeTargetGroup[]>([]);
  protected readonly title = signal('');
  protected readonly content = signal('');
  protected readonly serviceChecked = signal(true);
  protected readonly emailChecked = signal(false);
  protected readonly channel = computed<NoticeChannel>(() =>
    this.serviceChecked() ? (this.emailChecked() ? 'both' : 'service') : 'email',
  );
  protected readonly channelLabel = computed(() => noticeChannelLabel(this.channel()));
  protected readonly groupLabels = computed(() =>
    this.groups
      .filter((g) => this.selectedGroups().includes(g.value))
      .map((g) => g.label)
      .join(' · '),
  );
  protected readonly preview = signal<NoticePreviewResponse | null>(null);
  protected readonly stage = signal<NoticeStage>('compose');
  protected readonly result = signal<NoticeSendResult | null>(null);
  protected readonly delivery = signal<NoticeDelivery | null>(null);
  protected readonly emailAvailable = signal<boolean | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly uncertain = signal(false);
  protected readonly retryConfirm = signal(false);
  protected readonly retryUncertain = signal(false);
  protected readonly retryClosed = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly statusError = signal<string | null>(null);
  protected readonly draftValid = computed(
    () =>
      !!this.title().trim() &&
      [...this.title()].length <= 120 &&
      !/[\r\n]/.test(this.title()) &&
      !!this.content().trim() &&
      [...this.content()].length <= 5000,
  );
  /** Why "발송하기" is not available yet, in one line */
  protected readonly missing = computed(() => {
    if (!this.draftValid()) return '알림 제목과 내용을 입력해주세요.';
    if (!this.selectedGroups().length) return '발송 대상을 하나 이상 선택해주세요.';
    if (this.loading()) return '선택한 조건에 맞는 학생을 확인하고 있어요.';
    if (!this.preview()?.targets.length) return '선택한 조건에 해당하는 학생이 없어요.';
    if (!this.serviceChecked() && !this.emailChecked())
      return '발송 채널을 하나 이상 선택해주세요.';
    if (this.emailChecked() && this.emailAvailable() !== true) return '이메일을 보낼 수 없어요.';
    return '';
  });
  protected readonly locked = computed(
    () => this.busy() || this.uncertain() || this.stage() === 'confirm' || this.stage() === 'sent',
  );
  protected readonly canReview = computed(
    () =>
      this.draftValid() &&
      !this.loading() &&
      !this.locked() &&
      !!this.preview()?.targets.length &&
      (this.serviceChecked() || this.emailChecked()) &&
      (!this.emailChecked() || this.emailAvailable() === true),
  );
  readonly monthChangeBlocked = computed(() => this.locked() || this.retryUncertain());
  protected readonly dateTime = dotDateTime;
  private pendingSend: { body: NoticeSendRequest; key: string } | null = null;
  private retryKey: string | null = null;
  private poll: Subscription | null = null;
  private previewRequest: Subscription | null = null;

  constructor() {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      this.previewMode = this.route.snapshot.queryParamMap.has('preview');
    }
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('month')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((month) => {
        if (this.monthChangeBlocked()) return;
        this.requestedMonth = month ?? this.months.selected() ?? undefined;
        this.previewRequest?.unsubscribe();
        this.preview.set(null);
        this.loading.set(false);
        this.loadError.set(null);
        if (this.stage() === 'compose') this.load();
      });
  }

  /** "발송하기": opens the send check on this same page (nothing is sent yet) */
  protected next(): void {
    if (this.stage() === 'compose' && this.canReview()) {
      this.actionError.set(null);
      this.moveTo('confirm');
    }
  }

  /** "수정하기": back to editing, with the draft and the selections as they were */
  protected previous(): void {
    if (this.busy() || this.uncertain()) return;
    if (this.stage() === 'confirm') {
      this.moveTo('compose');
    }
  }

  private moveTo(stage: NoticeStage): void {
    this.stage.set(stage);
    if (stage === 'confirm') {
      afterNextRender(() => this.confirmHeading()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }

  protected toggleGroup(group: NoticeTargetGroup, event: Event): void {
    if (this.locked()) return;
    const checked = (event.target as HTMLInputElement).checked;
    const selected = this.selectedGroups().filter((value) => value !== group && value !== 'all');
    this.selectedGroups.set(
      checked ? (group === 'all' ? ['all'] : [...selected, group]) : selected,
    );
    this.actionError.set(null);
    this.load();
  }

  protected toggleChannel(channel: 'service' | 'email', event: Event): void {
    if (this.locked() || (channel === 'email' && this.emailAvailable() === false)) return;
    (channel === 'service' ? this.serviceChecked : this.emailChecked).set(
      (event.target as HTMLInputElement).checked,
    );
  }

  protected load(month?: string): void {
    if (this.locked() || this.pendingSend) return;
    this.previewRequest?.unsubscribe();
    this.preview.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    if (!this.selectedGroups().length) return;
    if ((typeof ngDevMode === 'undefined' || ngDevMode) && this.previewMode) {
      void import('../dev/preview-data').then((data) => {
        if (this.destroyed.destroyed) return;
        const v =
          this.route.snapshot.queryParamMap.get('preview') === 'empty'
            ? data.NOTICE_EMPTY_PREVIEW
            : data.NOTICE_PREVIEW;
        this.preview.set({
          month: v.month,
          months: v.months,
          audience: v.audience,
          audiences: this.selectedGroups(),
          matched: v.targets.length,
          hours_unknown: 0,
          closes_at: v.closesAt,
          unsubmitted: v.unsubmitted,
          employed_excluded: v.employedExcluded,
          employed_names: v.employedNames,
          targets: v.targets.map((t, i) => ({
            ...t,
            user_id: i + 1,
            study_hours: t.studyHours ?? null,
            as_of: t.asOf ?? null,
            email: null,
          })),
          target_fingerprint: '',
          email_available: false,
        });
        this.emailAvailable.set(false);
        this.emailChecked.set(false);
      });
      return;
    }
    this.loading.set(true);
    this.previewRequest = this.api
      .preview(month ?? this.requestedMonth, this.selectedGroups())
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (response) => {
          this.preview.set(response);
          this.requestedMonth = response.month;
          this.months.selected.set(response.month);
          this.emailAvailable.set(response.email_available);
          if (!response.email_available) this.emailChecked.set(false);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.loadError.set(errorMessage(error));
        },
      });
  }

  protected send(): void {
    if (this.busy() || this.stage() !== 'confirm') return;
    if (this.previewMode) {
      this.result.set({
        sent: this.preview()?.targets.length ?? 0,
        failed: 0,
        employedExcluded: this.preview()?.employed_excluded ?? 0,
        sentAt: '2026-10-18T14:30:00+09:00',
      });
      this.moveTo('sent');
      return;
    }
    if (!this.pendingSend) {
      const preview = this.preview();
      if (
        !preview?.targets.length ||
        !this.draftValid() ||
        (!this.serviceChecked() && !this.emailChecked()) ||
        (this.emailChecked() && this.emailAvailable() !== true)
      )
        return;
      this.pendingSend = {
        key: crypto.randomUUID(),
        body: {
          month: preview.month,
          audiences: preview.audiences ?? this.selectedGroups(),
          channel: this.channel(),
          title: this.title(),
          body: this.content(),
          expected_count: preview.targets.length,
          target_fingerprint: preview.target_fingerprint,
        },
      };
    }
    this.busy.set(true);
    this.actionError.set(null);
    const request = this.pendingSend;
    this.api
      .send(request.body, request.key)
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (response) => {
          this.pendingSend = null;
          this.uncertain.set(false);
          this.busy.set(false);
          this.retryClosed.set(false);
          this.result.set(toNoticeResult(response));
          this.delivery.set(response);
          this.statusError.set(null);
          this.moveTo('sent');
          if (response.channel !== 'service') this.pollStatus(response.notice_id);
          else this.poll?.unsubscribe();
        },
        error: (error) => {
          this.busy.set(false);
          if (error instanceof HttpErrorResponse && [400, 403, 409, 422].includes(error.status)) {
            this.pendingSend = null;
            this.uncertain.set(false);
            this.moveTo('compose');
            this.actionError.set(errorMessage(error));
            this.load(request.body.month);
          } else {
            this.uncertain.set(true);
            this.actionError.set(`${errorMessage(error)} 발송 결과를 다시 확인해주세요.`);
          }
        },
      });
  }

  protected done(): void {
    if (this.busy() || this.retryUncertain()) return;
    this.poll?.unsubscribe();
    this.moveTo('compose');
    this.title.set('');
    this.content.set('');
    this.selectedGroups.set([]);
    this.preview.set(null);
    this.delivery.set(null);
    this.result.set(null);
    this.actionError.set(null);
    this.retryConfirm.set(false);
  }

  protected retryEmail(): void {
    const delivery = this.delivery();
    if (this.previewMode || this.busy() || !delivery || !this.retryConfirm() || this.retryClosed())
      return;
    if (!delivery.email.failed && !this.retryKey) return;
    this.retryKey ??= crypto.randomUUID();
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .retry(delivery.notice_id, this.retryKey)
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (response) => {
          this.retryKey = null;
          this.retryUncertain.set(false);
          this.retryConfirm.set(false);
          this.busy.set(false);
          // Retry reports service.sent=0; retain the original service delivery total.
          this.delivery.set(response);
          this.pollStatus(response.notice_id);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.actionError.set(errorMessage(error));
          if (
            error instanceof HttpErrorResponse &&
            [400, 403, 404, 409, 422].includes(error.status)
          ) {
            this.retryKey = null;
            this.retryUncertain.set(false);
            this.retryConfirm.set(false);
            if (error.status === 422) this.retryClosed.set(true);
            this.pollStatus(delivery.notice_id);
          } else {
            this.retryUncertain.set(true);
          }
        },
      });
  }

  protected refreshStatus(): void {
    const delivery = this.delivery();
    if (delivery) this.pollStatus(delivery.notice_id);
  }

  private pollStatus(id: number): void {
    this.poll?.unsubscribe();
    this.poll = timer(0, 2000)
      .pipe(
        exhaustMap(() =>
          this.api.status(id).pipe(
            catchError((error: unknown) => {
              this.statusError.set(errorMessage(error));
              if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status))
                this.poll?.unsubscribe();
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((response) => {
        this.delivery.set(response);
        this.result.set(toNoticeResult(response));
        this.statusError.set(null);
        if (response.email.pending + response.email.sending === 0) this.poll?.unsubscribe();
      });
  }
}
