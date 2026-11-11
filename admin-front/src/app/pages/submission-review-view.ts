import { NgTemplateOutlet } from '@angular/common';
import { studentLabel } from '../core/cohort';
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DocType } from '@otus/shared/core/api-types';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { ReviewView } from '../core/admin.models';
import { intraProfileUrl } from '../core/intra';
import { HoursCheck } from '../core/study-hours';
import {
  MEMO_MAX,
  MEMO_PLACEHOLDER,
  approveHint,
  approveReviewLabel,
  checklist,
  eventLine,
  issuedBox,
  kindSummary,
  reviewDescription,
  reviewTitle,
  submittedSummary,
} from '../core/review-copy';
import { DocTabs } from '../ui/doc-tabs';
import { PdfSlot } from '../ui/pdf-slot';
import { ReviewHeader } from '../ui/review-header';

/**
 * 서류 검토 (final A02-initial-review-*.png; the monthly review has no image and is the same
 * screen with one tab). Pure display: tabs, the PDF area, "이 서류에서 확인할 내용", the internal
 * memo, "보완 요청" and "승인 검토", the latest record. A document counts as seen once its tab
 * was opened (`opened` is emitted for every tab that becomes current, the first one included);
 * "승인 검토" waits until all were. Seeing is screen state only.
 */
@Component({
  selector: 'app-submission-review-view',
  imports: [Button, Card, DocTabs, NgTemplateOutlet, PdfSlot, ReviewHeader, RouterLink],
  templateUrl: './submission-review-view.html',
  styleUrl: './submission-review-view.css',
})
export class SubmissionReviewViewComponent {
  readonly view = input.required<ReviewView>();
  readonly canOpenOriginals = input(false);
  readonly canReview = input(true);
  readonly canRequestRevision = input(true);
  readonly showMemo = input(true);
  /** The student's study hours of the month the 지원금 is worked out from; null while loading */
  readonly hours = input<HoursCheck | null>(null);
  /** Documents whose tab was opened */
  readonly viewed = input<readonly DocType[]>([]);
  readonly memo = input('');

  readonly opened = output<DocType>();
  readonly memoChange = output<string>();

  private readonly picked = signal<DocType | null>(null);

  protected readonly intraUrl = computed(() => intraProfileUrl(this.view().login));
  protected readonly types = computed(() => this.view().docs.map((d) => d.docType));
  protected readonly current = computed(() => this.picked() ?? this.types()[0]);
  protected readonly doc = computed(
    () => this.view().docs.find((d) => d.docType === this.current()) ?? this.view().docs[0],
  );
  protected readonly checks = computed(() =>
    checklist(this.current(), this.view().month, this.view().name),
  );
  protected readonly insuranceBox = computed(() =>
    this.current() === 'employment_insurance' ? issuedBox(this.view()) : null,
  );
  protected readonly unseen = computed(
    () => this.types().filter((t) => !this.viewed().includes(t) && t !== this.current()).length,
  );
  protected readonly hint = computed(() => approveHint(this.view(), this.unseen()));
  protected readonly last = computed(() => {
    const e = this.view().events[0];
    return e ? eventLine(e) : null;
  });

  protected readonly downloadName = computed(
    () => `${studentLabel(this.view().name, this.view().profile)}.pdf`,
  );
  protected readonly title = computed(() => reviewTitle(this.view()));
  protected readonly description = computed(() => reviewDescription(this.view()));
  protected readonly summary = computed(() => kindSummary(this.view()));
  protected readonly sub = computed(() => submittedSummary(this.view()));
  protected readonly approveLabel = computed(() => approveReviewLabel(this.view()));
  protected readonly memoMax = MEMO_MAX;
  protected readonly memoPlaceholder = MEMO_PLACEHOLDER.join('\n');

  constructor() {
    // the tab on screen is the one being looked at
    effect(() => this.opened.emit(this.current()));
  }

  protected pick(type: DocType): void {
    this.picked.set(type);
  }

  protected onMemo(event: Event): void {
    this.memoChange.emit((event.target as HTMLTextAreaElement).value);
  }
}
