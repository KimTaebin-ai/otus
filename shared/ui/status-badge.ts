import { Component, computed, input } from '@angular/core';

import { SubmissionStatus } from '../core/api-types';

/**
 * Screen copy for each api.md status. final wins over api.md's labels (STATUS_LABELS);
 * only "검토 중" is in final, the rest keep the api.md label (docs/design/README.md).
 */
export const BADGE_LABELS: Record<SubmissionStatus, string> = {
  draft: '임시 저장',
  pending_review: '검토 중',
  approved: '서류 승인',
  revision_requested: '재검토 요청',
  resubmitted: '재검토 대기',
};

/** "missing" is not an api.md status: a month with no submission yet (final U05-history-list "미제출"). */
export type BadgeStatus = SubmissionStatus | 'missing';

/** api.md status as a pill badge. Colors: --badge-<status>-bg/fg in _tokens.scss. */
@Component({
  selector: 'app-status-badge',
  template: `{{ label() }}`,
  styleUrl: './status-badge.css',
  host: { '[attr.data-status]': 'status()' },
})
export class StatusBadge {
  readonly status = input.required<BadgeStatus>();
  protected readonly label = computed(() => {
    const status = this.status();
    return status === 'missing' ? '미제출' : BADGE_LABELS[status];
  });
}
