import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DocType } from '@otus/shared/core/api-types';
import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { studentLabel } from '../core/cohort';
import { ReviewDecision, ReviewView } from '../core/admin.models';
import {
  REQUESTED_DESCRIPTION,
  WAITING_BOX,
  handler,
  submittedSummary,
  requestedTitle,
  resubmitDue,
  revisionSummary,
  docLabel,
} from '../core/review-copy';
import { ReviewHeader } from '../ui/review-header';

/**
 * 보완 요청 완료 (final A03-revision-requested.png): waiting-for-a-new-file box, who was asked,
 * the re-submit deadline, who handled it and when, and the reason exactly as the student sees it.
 * Pure display; `view` is the submission after the request (status `revision_requested`).
 */
@Component({
  selector: 'app-revision-requested-view',
  imports: [Button, Card, InfoBox, ReviewHeader, RouterLink],
  template: `
    <app-review-header
      [heading]="title()"
      [description]="description"
      [userId]="view().userId"
      [name]="view().name"
      [profile]="view().profile"
      [login]="view().login"
      [employed]="view().employed"
      [summary]="summary()"
      [sub]="sub()"
      status="revision_requested"
    />

    <app-card>
      <app-info-box [heading]="waiting.title">{{ waiting.body }}</app-info-box>

      <dl>
        <div>
          <dt>요청 대상</dt>
          <dd>{{ label() }} · {{ view().login }}</dd>
        </div>
        <div>
          <dt>보완할 서류</dt>
          <dd>{{ names() }}</dd>
        </div>
        <div>
          <dt>재제출 마감</dt>
          <dd>{{ due() }}</dd>
        </div>
        <div>
          <dt>처리 담당자 / 시각</dt>
          <dd>{{ by() }} · {{ at() }}</dd>
        </div>
      </dl>

      <h2>사용자에게 전달한 사유</h2>
      <p class="reason">{{ reason() }}</p>

      <div class="actions">
        <button appButton type="button" routerLink="/submissions" queryParamsHandling="preserve">
          검토 목록으로
        </button>
        <button
          appButton
          variant="secondary"
          type="button"
          [routerLink]="['/users', view().userId]"
          queryParamsHandling="preserve"
        >
          사용자 전체 이력
        </button>
      </div>
    </app-card>
  `,
  styleUrl: './revision-requested-view.css',
})
export class RevisionRequestedViewComponent {
  readonly view = input.required<ReviewView>();
  protected readonly label = computed(() => studentLabel(this.view().name, this.view().profile));
  readonly decision = input.required<ReviewDecision>();
  /** The documents asked for again */
  readonly docTypes = input.required<readonly DocType[]>();
  /** The reason as written */
  readonly reasonText = input.required<string>();

  protected readonly description = REQUESTED_DESCRIPTION;
  protected readonly waiting = WAITING_BOX;
  protected readonly title = computed(() => requestedTitle(this.view()));
  protected readonly summary = computed(() => revisionSummary(this.view(), this.docTypes().length));
  protected readonly sub = computed(() => submittedSummary(this.view()));
  protected readonly names = computed(() => this.docTypes().map(docLabel).join(', '));
  protected readonly due = computed(() => resubmitDue(this.view()));
  protected readonly by = computed(() => handler(this.decision().actor));
  protected readonly at = computed(() => dotDateTime(this.decision().at));
  protected readonly reason = computed(() => this.reasonText().trim());
}
