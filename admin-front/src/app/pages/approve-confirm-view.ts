import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DocType } from '@otus/shared/core/api-types';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { ReviewView } from '../core/admin.models';
import {
  AFTER_APPROVAL,
  confirmApproveLabel,
  confirmCardTitle,
  confirmTitle,
  docLabel,
  issuedCheck,
  kindSummary,
  submittedSummary,
} from '../core/review-copy';
import { HoursCheck, needsHoursConfirm } from '../core/study-hours';
import { ReviewHeader } from '../ui/review-header';

/**
 * 승인 전 확인 (final A02-initial-approve-confirm.png, A02-monthly-approve-confirm.png): the
 * documents about to be approved, each "확인 완료" once its tab was opened, the issue-date check of
 * the 고용보험가입내역서, "돌아가서 다시 확인" and the approve button. Pure display. "승인" here is the
 * document approval only.
 */
@Component({
  selector: 'app-approve-confirm-view',
  imports: [Button, Card, ReviewHeader, RouterLink],
  template: `
    <app-review-header
      [heading]="title"
      description="확정하면 제출 상태와 검토 기록에 승인 결과가 반영됩니다."
      [userId]="view().userId"
      [name]="view().name"
      [profile]="view().profile"
      [login]="view().login"
      [employed]="view().employed"
      [summary]="summary()"
      [sub]="sub()"
      [status]="view().status"
    />

    <div class="columns">
      <app-card>
        <h2 class="card-title">{{ cardTitle() }}</h2>
        <ul class="docs">
          @for (doc of view().docs; track doc.docType) {
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6"
                />
              </svg>
              <span class="name">
                <strong>{{ label(doc.docType) }}</strong>
                <span>{{ doc.fileName }}</span>
              </span>
              @if (viewed().includes(doc.docType)) {
                <span class="seen">확인 완료</span>
              }
            </li>
          }
        </ul>
        @if (issued(); as note) {
          <p class="issued">{{ note }}</p>
        }
        @if (hours(); as h) {
          <div class="hours" [class.met]="h.state === 'met'" role="status">
            <strong>{{ h.headline }}</strong>
            <span>{{ h.note }}</span>
            @if (needsConfirm()) {
              <label class="override">
                <input
                  type="checkbox"
                  [checked]="hoursConfirmed()"
                  (change)="hoursConfirmedChange.emit($any($event.target).checked)"
                />
                시간 요건을 직접 확인했고, 서류 승인을 진행해요
              </label>
            }
          </div>
        }
        <div class="actions">
          <button
            appButton
            variant="secondary"
            type="button"
            [routerLink]="['/submissions', view().submissionId]"
            queryParamsHandling="preserve"
          >
            돌아가서 다시 확인
          </button>
          <button appButton type="button" [disabled]="disabled()" (click)="confirm.emit()">
            {{ approveLabel() }}
          </button>
        </div>
      </app-card>

      <app-card>
        <h2 class="card-title">승인 후에는</h2>
        <ul class="after">
          @for (line of after; track line) {
            <li>{{ line }}</li>
          }
        </ul>
      </app-card>
    </div>
  `,
  styleUrl: './approve-confirm-view.css',
})
export class ApproveConfirmViewComponent {
  readonly view = input.required<ReviewView>();
  /** Documents whose tab was opened in the review */
  readonly viewed = input<readonly DocType[]>([]);
  readonly disabled = input(false);
  readonly confirm = output<void>();
  /** The submission month's study hours; null while loading or when it cannot be read */
  readonly hours = input<HoursCheck | null>(null);
  readonly hoursConfirmed = input(false);
  readonly hoursConfirmedChange = output<boolean>();
  protected readonly needsConfirm = computed(() => needsHoursConfirm(this.hours()));

  protected readonly title = confirmTitle();
  protected readonly after = AFTER_APPROVAL;
  protected readonly cardTitle = computed(() => confirmCardTitle(this.view()));
  protected readonly approveLabel = computed(() => confirmApproveLabel(this.view()));
  protected readonly issued = computed(() => issuedCheck(this.view()));
  protected readonly summary = computed(() => kindSummary(this.view()));
  protected readonly sub = computed(() => submittedSummary(this.view()));

  protected label(type: DocType): string {
    return docLabel(type);
  }
}
