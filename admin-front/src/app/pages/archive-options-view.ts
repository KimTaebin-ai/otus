import { Component, computed, input, output } from '@angular/core';

import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import {
  ArchiveCriteria,
  ArchiveOptions,
  ArchiveRow,
  DEFAULT_ARCHIVE_CRITERIA,
} from '../core/admin.models';
import {
  NOTHING_SELECTED_NOTE,
  NO_DOWNLOAD_NOTE,
  OPTIONS_FOOTNOTE,
  folderRows,
  optionsNotice,
  archiveCriteriaSummary,
} from '../core/archive-copy';
import { planArchive } from '../core/archive-plan';
import { DataTable } from '../ui/data-table';
import { Field } from '../ui/field';
import { PageHeader } from '../ui/page-header';

/**
 * A13 내려받기 옵션 (final A13-download-options.png, restyled like A18 and A07). Pure display:
 * the preview is `planArchive` over the selected rows, so it shows exactly the names the ZIP
 * will have. Starting is disabled unless `canDownload` (only the accountant) and someone is selected.
 */
@Component({
  selector: 'app-archive-options-view',
  imports: [Button, Card, DataTable, Field, InfoBox, PageHeader],
  templateUrl: './archive-options-view.html',
  styleUrl: './archive-options-view.css',
})
export class ArchiveOptionsViewComponent {
  readonly month = input.required<string>();
  /** The selected rows, in table order */
  readonly rows = input.required<readonly ArchiveRow[]>();
  readonly options = input.required<ArchiveOptions>();
  readonly criteria = input<ArchiveCriteria>(DEFAULT_ARCHIVE_CRITERIA);
  readonly canDownload = input(false);
  readonly busy = input(false);

  readonly optionChange = output<{ key: keyof ArchiveOptions; on: boolean }>();
  readonly download = output<void>();
  readonly back = output<void>();

  protected readonly footnote = OPTIONS_FOOTNOTE;
  protected readonly nothing = NOTHING_SELECTED_NOTE;
  protected readonly noDownload = NO_DOWNLOAD_NOTE;
  protected readonly criteriaSummary = computed(() => archiveCriteriaSummary(this.criteria()));

  protected readonly plan = computed(() => planArchive(this.month(), this.rows(), this.options()));
  protected readonly notice = computed(() => optionsNotice(this.plan(), this.options()));
  protected readonly folders = computed(() => folderRows(this.plan()));
  protected readonly cannotStart = computed(
    () => !this.canDownload() || this.rows().length === 0 || this.busy(),
  );
}
