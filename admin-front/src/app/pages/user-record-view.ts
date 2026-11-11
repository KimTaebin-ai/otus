import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { studentLabel } from '../core/cohort';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { UserRecordView } from '../core/admin.models';
import {
  NO_ORIGINALS_NOTE,
  docName,
  docsEmpty,
  initialDocsCaption,
  recordCards,
  recordsEmpty,
  reviewLink,
  recordRows,
  summaryParts,
} from '../core/user-record-copy';
import { DataTable } from '../ui/data-table';
import { PageHeader } from '../ui/page-header';
import { BankDecision, BankReview } from '../ui/bank-review';
import { StatCard } from '../ui/stat-card';

/**
 * A18 사용자 관리 상세 (final A18-user-record.png). Pure display. "열기 ↗" opens the original
 * through GET /api/files/{id} only when `canOpenOriginals`; otherwise it is disabled and the
 * note says who may. The account is shown masked, never in full.
 */
@Component({
  selector: 'app-user-record-view',
  imports: [BankReview, Button, Card, DataTable, PageHeader, RouterLink, StatCard],
  templateUrl: './user-record-view.html',
  styleUrl: './user-record-view.css',
})
export class UserRecordViewComponent {
  readonly view = input.required<UserRecordView>();
  readonly canOpenOriginals = input(false);
  /** Who may decide a 계좌 변경 (operator and accountant) */
  readonly canDecideBank = input(false);
  readonly bankBusy = input(false);
  readonly bankError = input<string | null>(null);
  readonly bankDecision = output<BankDecision>();

  protected readonly noOriginals = NO_ORIGINALS_NOTE;

  protected readonly title = computed(() => studentLabel(this.view().name, this.view().profile));
  protected readonly summary = computed(() => summaryParts(this.view()).join(' | '));
  protected readonly review = computed(() => reviewLink(this.view()));
  protected readonly cards = computed(() => recordCards(this.view()));
  protected readonly rows = computed(() => recordRows(this.view().records));
  protected readonly recordsEmpty = computed(() => recordsEmpty(this.view()));
  protected readonly docsEmpty = computed(() => docsEmpty(this.view()));
  protected readonly caption = computed(() => initialDocsCaption(this.view()));
  protected readonly docs = computed(() =>
    this.view().initialDocs.docs.map((d) => ({ name: docName(d.docType), fileId: d.fileId })),
  );
}
