import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { BADGE_LABELS, StatusBadge } from '@otus/shared/ui/status-badge';
import {
  ArchiveCriteria,
  ArchiveFilter,
  ArchiveStatus,
  ArchiveView,
  DEFAULT_ARCHIVE_CRITERIA,
  ReviewKind,
} from '../core/admin.models';
import {
  NO_DOWNLOAD_NOTE,
  ARCHIVE_KIND_LABELS,
  archiveCriteriaSummary,
  archiveDescription,
  archiveNotice,
  archiveTitle,
  downloadLabel,
  filesSummary,
  folderNote,
  receivedAt,
  tableHeading,
} from '../core/archive-copy';
import { selectAllState, visibleRows } from '../core/archive-select';
import { DataTable } from '../ui/data-table';
import { Field } from '../ui/field';
import { PageHeader } from '../ui/page-header';

/**
 * A12 월 자료함 (final A12-archive-month.png, restyled like A18 and A07). Pure display: the
 * selection, search and filter come in as inputs and go out as events. Both buttons are
 * disabled unless `canDownload` (only the accountant); the note then says who may.
 */
@Component({
  selector: 'app-archive-view',
  imports: [Button, Card, DataTable, Field, InfoBox, PageHeader, RouterLink, StatusBadge],
  templateUrl: './archive-view.html',
  styleUrl: './archive-view.css',
})
export class ArchiveViewComponent {
  readonly view = input.required<ArchiveView>();
  readonly selected = input.required<ReadonlySet<number>>();
  readonly query = input('');
  readonly filter = input<ArchiveFilter>('all');
  readonly criteria = input<ArchiveCriteria>(DEFAULT_ARCHIVE_CRITERIA);
  readonly canDownload = input(false);
  readonly busy = input(false);

  readonly toggle = output<number>();
  /** The header checkbox: select or clear the rows that are shown */
  readonly toggleShown = output<{ userIds: number[]; on: boolean }>();
  readonly queryChange = output<string>();
  readonly filterChange = output<ArchiveFilter>();
  readonly criteriaChange = output<ArchiveCriteria>();
  readonly resetFilters = output<void>();
  readonly download = output<void>();
  readonly options = output<void>();

  protected readonly noDownload = NO_DOWNLOAD_NOTE;
  protected readonly receivedAt = receivedAt;
  protected readonly filesSummary = filesSummary;
  protected readonly statusLabels = BADGE_LABELS;
  protected readonly kindLabels = ARCHIVE_KIND_LABELS;
  protected readonly statuses = [
    'pending_review',
    'approved',
    'revision_requested',
    'resubmitted',
  ] as const;
  protected readonly kinds = ['initial', 'monthly', 'supplement'] as const;

  protected readonly title = computed(() => archiveTitle(this.view().month));
  protected readonly description = computed(() => archiveDescription(this.view().month));
  protected readonly notice = computed(() => archiveNotice(this.view()));

  protected readonly shown = computed(() =>
    visibleRows(this.view().rows, this.query(), this.filter(), this.selected(), this.criteria()),
  );
  protected readonly chosen = computed(() =>
    this.shown().filter((row) => this.selected().has(row.userId)),
  );
  protected readonly heading = computed(() =>
    tableHeading(this.view().month, this.shown().length, this.chosen().length),
  );
  protected readonly allState = computed(() => selectAllState(this.shown(), this.selected()));
  protected readonly downloadText = computed(() => downloadLabel(this.chosen().length));
  protected readonly cannotStart = computed(
    () => !this.canDownload() || this.chosen().length === 0 || this.busy(),
  );
  protected readonly note = computed(() => folderNote(this.shown(), this.selected()));
  protected readonly criteriaCount = computed(
    () => this.criteria().status.length + this.criteria().kind.length,
  );
  protected readonly criteriaSummary = computed(() => archiveCriteriaSummary(this.criteria()));
  protected readonly hasFilters = computed(
    () => !!this.query().trim() || this.filter() !== 'all' || this.criteriaCount() > 0,
  );
  protected readonly empty = computed(() =>
    this.view().rows.length === 0 && !this.hasFilters()
      ? '이 달에 접수된 제출이 없어요.'
      : '조건에 맞는 교육생이 없어요.',
  );

  protected onToggleShown(on: boolean): void {
    this.toggleShown.emit({ userIds: this.shown().map((r) => r.userId), on });
  }

  protected toggleStatus(status: ArchiveStatus, on: boolean): void {
    this.criteriaChange.emit({
      ...this.criteria(),
      status: on
        ? [...this.criteria().status, status]
        : this.criteria().status.filter((value) => value !== status),
    });
  }

  protected toggleKind(kind: ReviewKind, on: boolean): void {
    this.criteriaChange.emit({
      ...this.criteria(),
      kind: on
        ? [...this.criteria().kind, kind]
        : this.criteria().kind.filter((value) => value !== kind),
    });
  }

  protected kindSummary(row: ArchiveView['rows'][number]): string {
    return row.kinds.map((kind) => ARCHIVE_KIND_LABELS[kind]).join(' · ');
  }
}
