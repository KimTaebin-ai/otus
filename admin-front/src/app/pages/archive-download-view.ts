import { Component, computed, input, output } from '@angular/core';

import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { NoticePanel } from '@otus/shared/ui/notice-panel';
import { dotMonthDay, hourMinute, monthNumber } from '@otus/shared/core/format';
import {
  ArchiveCriteria,
  ArchiveOptions,
  ArchiveRow,
  DEFAULT_ARCHIVE_CRITERIA,
  DownloadStatus,
} from '../core/admin.models';
import { ArchiveExportStatus } from '../core/archive-api';
import {
  blockedReason,
  downloadHeading,
  downloadRows,
  helpCards,
  planSummary,
  archiveCriteriaSummary,
} from '../core/archive-copy';
import { planArchive } from '../core/archive-plan';
import { DataTable } from '../ui/data-table';
import { PageHeader } from '../ui/page-header';

/**
 * A14 다운로드 시작 (final A14-download-started.png, restyled like A18 and A07), plus the
 * creating and failed states the image does not have. Pure display. It never says the
 * download started for a role that may not download, or for an empty selection.
 */
@Component({
  selector: 'app-archive-download-view',
  imports: [Button, Card, DataTable, InfoBox, NoticePanel, PageHeader],
  templateUrl: './archive-download-view.html',
  styleUrl: './archive-download-view.css',
})
export class ArchiveDownloadViewComponent {
  readonly month = input.required<string>();
  /** The selected rows, in table order */
  readonly rows = input.required<readonly ArchiveRow[]>();
  readonly options = input.required<ArchiveOptions>();
  readonly criteria = input<ArchiveCriteria>(DEFAULT_ARCHIVE_CRITERIA);
  readonly status = input<DownloadStatus | null>(null);
  readonly canDownload = input(false);
  readonly receiving = input(false);
  readonly retryAfter = input(0);
  readonly downloadStarted = input(false);
  readonly error = input<string | null>(null);
  readonly expired = input(false);
  readonly preview = input(false);
  readonly job = input<ArchiveExportStatus | null>(null);

  readonly archive = output<void>();
  readonly editOptions = output<void>();
  readonly retry = output<void>();
  readonly cancelWait = output<void>();

  protected readonly plan = computed(() => planArchive(this.month(), this.rows(), this.options()));
  protected readonly criteriaSummary = computed(() => archiveCriteriaSummary(this.criteria()));
  protected readonly blocked = computed(() =>
    blockedReason(this.canDownload(), this.rows().length),
  );
  protected readonly head = computed(() => {
    if (this.blocked()) return { heading: '내려받을 수 없어요', description: this.blocked()! };
    if (this.expired())
      return {
        heading: '다운로드 작업이 만료되었어요',
        description: '자료를 확인하고 새 ZIP을 만들어 주세요.',
      };
    if (this.retryAfter() > 0)
      return {
        heading: '다운로드 순서를 기다리고 있어요',
        description: '서버가 안내한 대기 시간이 지나면 자동으로 다시 시도해요.',
      };
    if (this.receiving())
      return {
        heading: '파일을 내려받고 있어요',
        description: '파일을 받으면 브라우저에 저장을 요청해요.',
      };
    const status = this.status();
    if (status === null)
      return {
        heading: 'ZIP 파일 내려받기',
        description: '구성을 확인한 뒤 아래 버튼을 눌러 내려받으세요.',
      };
    if (status === 'ready' && !this.downloadStarted())
      return {
        heading: 'ZIP 파일이 준비됐어요',
        description: '아래 버튼으로 파일을 내려받을 수 있어요.',
      };
    if (status === 'failed')
      return {
        heading: '다운로드를 완료하지 못했어요',
        description: '오류를 확인하고 다시 시도해 주세요.',
      };
    return downloadHeading(status);
  });
  protected readonly summary = computed(() => {
    const job = this.job();
    return job
      ? `교육생 ${job.student_count}명 · PDF ${job.pdf_count}개 + 제출 목록`
      : planSummary(this.plan());
  });
  protected readonly zipName = computed(() => this.job()?.zip_name ?? this.plan().zipName);
  protected readonly expiry = computed(() => {
    const at = this.job()?.expires_at;
    return at ? `${dotMonthDay(at)} ${hourMinute(at)}` : null;
  });
  protected readonly cards = computed(() => helpCards(this.plan()));
  protected readonly table = computed(() => downloadRows(this.plan(), this.options()));
  protected readonly archiveLabel = computed(() => `${monthNumber(this.month())}월 자료함으로`);
}
