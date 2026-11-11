import { Injectable, computed, signal } from '@angular/core';

import { DocType } from '@otus/shared/core/api-types';

/**
 * What the reviewer has done on the screen so far, kept between the review pages of one
 * submission: the documents opened ("확인 완료"), the internal memo, the reason and the chosen
 * documents of a 보완 요청. Screen state only: nothing is saved on a server, a reload starts over.
 * When the admin API exists, this is the one place that turns into calls.
 */
@Injectable({ providedIn: 'root' })
export class ReviewState {
  private submissionId: string | null = null;

  readonly viewed = signal<readonly DocType[]>([]);
  readonly memo = signal('');
  readonly reason = signal('');
  readonly selected = signal<readonly DocType[]>([]);
  readonly hasSelection = computed(() => this.selected().length > 0);

  /** Called by every review page; a different submission starts from nothing. */
  begin(submissionId: string): void {
    if (this.submissionId === submissionId) {
      return;
    }
    this.submissionId = submissionId;
    this.viewed.set([]);
    this.memo.set('');
    this.reason.set('');
    this.selected.set([]);
  }

  markViewed(docType: DocType): void {
    this.viewed.update((v) => (v.includes(docType) ? v : [...v, docType]));
  }

  toggle(docType: DocType): void {
    this.selected.update((s) =>
      s.includes(docType) ? s.filter((t) => t !== docType) : [...s, docType],
    );
  }
}
