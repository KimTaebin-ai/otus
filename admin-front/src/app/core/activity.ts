import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, EMPTY, Observable, Subscription, switchMap, timer } from 'rxjs';

import {
  BrowserNotifyState,
  askBrowserNotifications,
  askOnFirstVisit,
  browserNotifyState,
  newItems,
  showBrowserNotices,
} from '@otus/shared/core/browser-notify';

export interface ActivityItem {
  id: string;
  kind: 'employment_changed' | 'bank_account_requested';
  user: { id: number; login: string; display_name: string };
  occurred_at: string;
  data: { employed?: boolean; status?: string };
}

export const ACTIVITY_POLL_MS = 30_000;
const SEEN_KEY = 'otus-admin-activity-seen';

/** One line for the bell and the dashboard card. Never shows an account number. */
export function activityText(item: ActivityItem): string {
  const name = item.user.display_name;
  if (item.kind === 'employment_changed') {
    return `${name}님이 취업 상태를 ${item.data.employed ? '취업 중' : '미취업'}으로 변경했어요`;
  }
  const status = item.data.status;
  const tail =
    status === 'approved'
      ? '(승인됨)'
      : status === 'rejected'
        ? '(반려됨)'
        : status === 'cancelled'
          ? '(취소됨)'
          : '(검토 대기)';
  return `${name}님이 계좌 변경을 요청했어요 ${tail}`;
}

/**
 * Staff activity feed: employment changes and bank-account change requests. There is no push
 * channel, so it polls; "unread" is the viewer's own last-seen time kept in this browser.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly http = inject(HttpClient);
  private polling?: Subscription;
  /** Ids seen since `start()`; null before the first load, so old items are not replayed */
  private knownIds: Set<string> | null = null;
  /** Whether the browser may show OS notifications (asked for with a click on the bell panel) */
  readonly browserState = signal<BrowserNotifyState>(browserNotifyState());
  readonly items = signal<ActivityItem[]>([]);
  readonly failed = signal(false);
  private readonly seenAt = signal<number>(readSeen());
  readonly unread = computed(
    () => this.items().filter((i) => Date.parse(i.occurred_at) > this.seenAt()).length,
  );

  fetch(limit = 20): Observable<{ items: ActivityItem[] }> {
    return this.http.get<{ items: ActivityItem[] }>('/api/admin/activity', {
      params: { limit },
    });
  }

  start(): void {
    // first visit: the browser's permission prompt right away (the bell button stays for later)
    askOnFirstVisit((state) => this.browserState.set(state));
    this.polling ??= timer(0, ACTIVITY_POLL_MS)
      .pipe(
        switchMap(() =>
          this.fetch().pipe(
            catchError(() => {
              this.failed.set(true);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((page) => {
        this.failed.set(false);
        this.notifyBrowser(page.items);
        this.items.set(page.items);
      });
  }

  /** A new change also shows as an OS notification, when the user allowed it. */
  private notifyBrowser(items: ActivityItem[]): void {
    const { fresh, ids } = newItems(this.knownIds, items, (i) => i.id);
    this.knownIds = ids;
    showBrowserNotices(
      fresh.map((item) => ({
        title: 'OTUS Admin',
        body: activityText(item),
        tag: `otus-admin-${item.id}`,
        path: `/users/${item.user.id}`,
      })),
      'otus-admin-summary',
    );
  }

  async enableBrowser(): Promise<void> {
    this.browserState.set(await askBrowserNotifications());
  }

  stop(): void {
    this.polling?.unsubscribe();
    this.polling = undefined;
    this.knownIds = null;
    this.items.set([]);
  }

  markSeen(): void {
    const newest = Math.max(0, ...this.items().map((i) => Date.parse(i.occurred_at)));
    if (newest <= this.seenAt()) return;
    this.seenAt.set(newest);
    try {
      localStorage.setItem(SEEN_KEY, String(newest));
    } catch {
      // storage can be blocked; the badge then only lasts for this page load
    }
  }
}

function readSeen(): number {
  try {
    const value = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
