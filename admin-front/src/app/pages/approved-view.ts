import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { BADGE_LABELS } from '@otus/shared/ui/status-badge';
import { studentLabel } from '../core/cohort';
import { ReviewDecision, ReviewView } from '../core/admin.models';
import {
  APPROVED_DESCRIPTION,
  approvedBanner,
  approvedTitle,
  eventLine,
  handler,
  kindSummary,
  submittedSummary,
} from '../core/review-copy';
import { ReviewHeader } from '../ui/review-header';

/**
 * 승인 완료 (final A02-initial-approved.png, A02-monthly-approved.png): the mint banner, the
 * result, who handled it and when (their role and real name), the review record and the two
 * buttons. Pure display; `view` is the submission after the approval (status `approved`).
 */
@Component({
  selector: 'app-approved-view',
  imports: [Button, Card, ReviewHeader, RouterLink],
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
      status="approved"
    />

    <app-card>
      <div class="banner">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <div>
          <strong>{{ banner() }}</strong>
          <span>{{ label() }} · {{ view().login }}</span>
        </div>
      </div>

      <dl>
        <div>
          <dt>처리 결과</dt>
          <dd>{{ result }}</dd>
        </div>
        <div>
          <dt>처리 담당자</dt>
          <dd>{{ by() }}</dd>
        </div>
        <div>
          <dt>처리 시각</dt>
          <dd>{{ at() }}</dd>
        </div>
      </dl>

      <hr />
      <h2>검토 기록</h2>
      <ul class="record">
        @for (line of lines(); track $index) {
          <li>{{ line.when }} · {{ line.text }}</li>
        }
      </ul>

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
  styleUrl: './approved-view.css',
})
export class ApprovedViewComponent {
  readonly view = input.required<ReviewView>();
  readonly decision = input.required<ReviewDecision>();

  protected readonly label = computed(() => studentLabel(this.view().name, this.view().profile));
  protected readonly description = APPROVED_DESCRIPTION;
  protected readonly result = BADGE_LABELS.approved;
  protected readonly title = computed(() => approvedTitle(this.view()));
  protected readonly banner = computed(() => approvedBanner(this.view()));
  protected readonly summary = computed(() => kindSummary(this.view()));
  protected readonly sub = computed(() => submittedSummary(this.view()));
  protected readonly by = computed(() => handler(this.decision().actor));
  protected readonly at = computed(() => dotDateTime(this.decision().at));
  /** The decision on top of what is already recorded, newest first */
  protected readonly lines = computed(() =>
    [
      { ...this.decision(), action: 'approved' as const },
      ...this.view().events.filter(
        (e) =>
          !(
            e.action === 'approved' &&
            e.at === this.decision().at &&
            e.actor.name === this.decision().actor.name
          ),
      ),
    ].map((e) => eventLine({ at: e.at, action: e.action, actor: e.actor })),
  );
}
