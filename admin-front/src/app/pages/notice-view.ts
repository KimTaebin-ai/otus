import { NoticeChannel, noticeChannelLabel } from '../core/notice-channel';
import { audienceLabel } from '@otus/shared/core/notice-audience';
import { dotDateTime } from '@otus/shared/core/format';
import { Component, computed, input, output } from '@angular/core';

import { Card } from '@otus/shared/ui/card';
import { Button } from '@otus/shared/ui/button';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import { NoticeSendResult, NoticeStage, NoticeView } from '../core/admin.models';
import { NoticeDelivery } from '../core/notices-api';
import {
  noticeLink,
  emptyReason,
  noticeBody,
  noticeCards,
  noticeTitle,
  skippedCopy,
} from '../core/notice-copy';
import { DataTable } from '../ui/data-table';
import { StatCard } from '../ui/stat-card';
import { NoticeConfirm } from './notice-confirm';
import { NoticeSent } from './notice-sent';

/**
 * A07 알림 보내기 (final A07-notice-empty and A07-notice-sent). Pure display: the page,
 * and the confirm and result modals according to `stage`. Nothing here sends anything; the
 * outputs are for whoever owns the data. Email delivery is reported separately.
 */
@Component({
  selector: 'app-notice-view',
  imports: [Button, Card, DataTable, NoticeConfirm, NoticeSent, StatCard, StatusBadge],
  templateUrl: './notice-view.html',
  styleUrl: './notice-view.css',
})
export class NoticeViewComponent {
  readonly view = input.required<NoticeView>();
  readonly stage = input<NoticeStage>('compose');
  readonly result = input<NoticeSendResult | null>(null);
  readonly selectedChannel = input<NoticeChannel>('service');
  readonly emailAvailable = input<boolean | null>(null);
  readonly targetEmails = input<Record<string, string | null>>({});
  readonly busy = input(false);
  readonly uncertain = input(false);
  readonly actionError = input<string | null>(null);
  readonly delivery = input<NoticeDelivery | null>(null);
  readonly statusError = input<string | null>(null);
  readonly retryConfirm = input(false);
  readonly retryUncertain = input(false);
  readonly retryClosed = input(false);

  /** "보낼 내용 확인하기 →" */
  readonly review = output<void>();
  readonly cancel = output<void>();
  readonly send = output<void>();
  readonly done = output<void>();
  readonly reviewRetry = output<void>();
  readonly cancelRetry = output<void>();
  readonly retry = output<void>();
  readonly refreshStatus = output<void>();

  protected readonly channel = computed(() => noticeChannelLabel(this.selectedChannel()));
  protected readonly audienceLabel = audienceLabel;
  protected readonly dateTime = dotDateTime;
  protected readonly link = computed(() => noticeLink(this.view().audience));

  protected readonly cards = computed(() => noticeCards(this.view()));
  protected readonly title = computed(() => noticeTitle(this.view().month, this.view().audience));
  protected readonly body = computed(() =>
    noticeBody(this.view().month, this.view().closesAt, this.view().audience),
  );
  protected readonly reason = computed(() => emptyReason(this.view()));
  protected readonly skipped = computed(() => skippedCopy(this.view()));
}
