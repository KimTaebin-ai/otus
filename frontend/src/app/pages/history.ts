import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';

import { dotDateTime } from '@otus/shared/core/format';
import { Card } from '@otus/shared/ui/card';
import { InfoBox } from '@otus/shared/ui/info-box';
import { Spinner } from '@otus/shared/ui/spinner';
import { BADGE_LABELS, BadgeStatus, StatusBadge } from '@otus/shared/ui/status-badge';
import { Cycle, Submission, SubmissionKind } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { formatMonth } from '../layout/shell';
import { UploadSlot } from '../ui/upload-slot';
import { chainOutcome } from '../core/revision';

type HistoryState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: Submission[]; cycle: Cycle | null };

interface MonthGroup {
  /** YYYY-MM */
  month: string;
  /** Newest first, as the API returns them. */
  items: Submission[];
}

/** "최초 제출" / "월별 제출" in the 접수 정보 card and the left card title */
const KIND_LABELS: Record<SubmissionKind, string> = {
  initial: '최초 제출',
  monthly: '월별 제출',
  supplement: '보완 제출',
};

/** "최초 서류 4종을 제출했어요" in the top box */
const KIND_DOCS: Record<SubmissionKind, string> = {
  initial: '최초',
  monthly: '월별',
  supplement: '보완',
};

/**
 * U05 제출 이력 (final U05-history-pending.png). This pass shows submissions only;
 * 보완 제출 comes next. Drafts aren't listed (GET /api/submissions excludes them).
 * Hidden: the rows' "보기" link (no file view API) and "계좌사본 변경이 필요한가요?".
 */
@Component({
  selector: 'app-history',
  imports: [Card, InfoBox, RouterLink, Spinner, StatusBadge, UploadSlot],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class History {
  protected readonly state = toSignal(
    forkJoin({
      list: inject(ApiService).listSubmissions(),
      // the period only adds the 미제출 card and the 보완 link; the list works without it
      cycle: inject(ApiService)
        .currentCycle()
        .pipe(catchError(() => of(null))),
    }).pipe(
      map(({ list, cycle }): HistoryState => ({
        kind: 'ready',
        items: list.items,
        cycle,
      })),
      catchError((err: unknown) => of<HistoryState>({ kind: 'error', message: errorMessage(err) })),
    ),
    { initialValue: { kind: 'loading' } as HistoryState },
  );

  protected readonly latest = computed(() => {
    const s = this.state();
    if (s.kind !== 'ready') {
      return null;
    }
    // a submission waiting for the student comes first, otherwise the newest one
    return s.items.find((i) => i.status === 'revision_requested') ?? s.items[0] ?? null;
  });

  /** Months newest first; the API order (newest first) is kept inside a month. */
  protected readonly groups = computed<MonthGroup[]>(() => {
    const s = this.state();
    if (s.kind !== 'ready') {
      return [];
    }
    const groups: MonthGroup[] = [];
    const groupOf = (month: string): MonthGroup => {
      let group = groups.find((g) => g.month === month);
      if (!group) {
        group = { month, items: [] };
        groups.push(group);
      }
      return group;
    };
    for (const item of s.items) {
      groupOf(item.target_month).items.push(item);
    }
    return groups.sort((a, b) => b.month.localeCompare(a.month));
  });

  private readonly cycle = computed(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.cycle : null;
  });

  /**
   * An open period with no monthly for its month yet: shown as a 미제출 card (final U05-history-list).
   * Not when that month's submission was the 최초 4종, which already contains the month's 고용보험.
   */
  protected readonly missingMonth = computed(() => {
    const s = this.state();
    const cycle = this.cycle();
    if (s.kind !== 'ready' || cycle?.state !== 'open') {
      return null;
    }
    const covered = s.items.some(
      (i) => (i.kind === 'monthly' || i.kind === 'initial') && i.target_month === cycle.target_month,
    );
    return covered ? null : cycle.target_month;
  });

  protected readonly formatMonth = formatMonth;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly badgeLabels = BADGE_LABELS;

  /**
   * A month's status includes its 보완 제출: the monthly card shows the newest of the monthly and
   * its supplements. initial and supplement cards show their own status.
   */
  protected badgeStatus(item: Submission): BadgeStatus {
    const s = this.state();
    if (item.kind === 'supplement' || s.kind !== 'ready') {
      return item.status;
    }
    const month = s.items.filter((i) => i.target_month === item.target_month);
    return chainOutcome(month, item.kind)?.latest.status ?? item.status;
  }

  /** /submit only handles the period's month, so older months get no 보완 link. */
  protected canSupplement(item: Submission): boolean {
    if (item.kind === 'initial') {
      // the 최초 4종 has its own screen and no month limit (the supplement draft checks the period)
      return this.badgeStatus(item) === 'revision_requested';
    }
    return (
      item.kind === 'monthly' &&
      this.badgeStatus(item) === 'revision_requested' &&
      item.target_month === this.cycle()?.target_month
    );
  }

  /** Where the 보완 link of `item` goes */
  protected supplementLink(item: Submission): string {
    return item.kind === 'initial' ? '/submit/initial' : '/submit';
  }

  /** "최초 서류 4종을 제출했어요 · 검토 중" */
  protected latestHeading(s: Submission): string {
    return `${KIND_DOCS[s.kind]} 서류 ${s.files.length}종을 제출했어요 · ${BADGE_LABELS[s.status]}`;
  }

  /** "2026.09.21 09:41 접수 · 관리자가 서류를 확인하고 있어요. …" */
  protected latestBody(s: Submission): string {
    const at = s.submitted_at ? `${dotDateTime(s.submitted_at)} 접수 · ` : '';
    return `${at}${this.latestText(s)}`;
  }

  private latestText(s: Submission): string {
    switch (s.status) {
      case 'approved':
        return '서류가 승인됐어요. 수령 대상은 시간 요건 판정과 함께 운영팀이 확정해요.';
      case 'revision_requested':
        return s.kind === 'initial' || s.target_month === this.cycle()?.target_month
          ? '보완이 필요한 서류가 있어요. ‘보완 제출하기’에서 새 PDF를 올려주세요.'
          : '보완이 필요한 서류가 있어요.';
      case 'resubmitted':
        return '보완 서류를 받았어요. 운영팀이 다시 확인할게요.';
      default:
        return '관리자가 서류를 확인하고 있어요. 보완이 필요하면 안내해드립니다.';
    }
  }
}
