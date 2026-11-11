import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import {
  EMPTY,
  Subject,
  catchError,
  distinctUntilChanged,
  filter,
  forkJoin,
  fromEvent,
  interval,
  map,
  merge,
  of,
  startWith,
  switchMap,
  takeUntil,
} from 'rxjs';

import {
  BrowserNotifyState,
  askBrowserNotifications,
  askOnFirstVisit,
  browserNotifyState,
  newItems,
  showBrowserNotices,
} from '@otus/shared/core/browser-notify';
import { hourMinute, lastMoment, monthDay, monthNumber } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { AppNotification, BankAccountState, Cycle } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { NotificationCopy, notificationCopy } from '../core/notification-copy';

/** What the notices are computed from: the period, this month's monthly and the account state. */
interface Source {
  /** null when the period or the list couldn't be loaded */
  cycle: { cycle: Cycle; hasSubmitted: boolean } | null;
  bank: BankAccountState | null;
}

interface Notice extends NotificationCopy {
  /** Server id when delivered through /api/notifications; otherwise a legacy storage key. */
  id?: number;
  key: string;
  /** The card stays after it was read (the 서류 제출 안내); the others only show while unread */
  stays: boolean;
}

/**
 * Server-delivered notifications and read state. Until all event producers exist, retain
 * the existing period/account hints and their local read flags (see HANDOFF.md).
 * A delivered reminder takes precedence over the synthesized hint for that month.
 */
@Component({
  selector: 'app-notifications',
  imports: [Button, RouterLink],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
  host: {
    '(document:click)': 'outsideClick($event)',
    '(keydown.escape)': 'close(true)',
  },
})
export class Notifications {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bell = viewChild<ElementRef<HTMLButtonElement>>('bell');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly open = signal(false);
  /** Whether the browser may show OS notifications (asked for with a click on the panel button) */
  protected readonly browserState = signal<BrowserNotifyState>(browserNotifyState());
  /** Ids already seen in this session; null before the first load (no replay of old ones) */
  private knownIds: Set<string> | null = null;
  private readonly source = signal<Source | null>(null);
  private readonly received = signal<{ notice: AppNotification; read: boolean }[]>([]);
  private readonly serverUnread = signal(0);
  private readonly refresh = new Subject<void>();
  private readonly sessionEnded = new Subject<void>();
  private readonly pageCancelled = new Subject<void>();
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly reading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly readError = signal<string | null>(null);
  protected readonly nextBefore = signal<number | null>(null);
  /** Bumped after a write to storage, so `unread` recomputes. */
  private readonly readVersion = signal(0);
  private readonly legacyNotices = computed((): Notice[] => {
    const s = this.source();
    if (!s) {
      return [];
    }
    const list: Notice[] = [];
    const c = s.cycle;
    // employed students are left out of missing-submission reminders
    const hasReminder = this.received().some(
      ({ notice }) =>
        ['submission_reminder', 'submission_period_opened'].includes(notice.kind) &&
        notice.data?.month === c?.cycle.target_month,
    );
    if (
      c &&
      c.cycle.state === 'open' &&
      !c.hasSubmitted &&
      !this.auth.me()?.employed &&
      !hasReminder
    ) {
      const cycle = c.cycle;
      const month = `${monthNumber(cycle.target_month)}월`;
      const last = lastMoment(cycle.closes_at);
      list.push({
        key: `otus.notice.read:${this.userId()}:${cycle.target_month}`,
        stays: true,
        meta: `서류 제출 안내 · ${monthDay(cycle.opens_at)}`,
        title: `${month} 서류, 준비하고 계신가요?`,
        lines: [
          this.auth.me()?.initial_submitted
            ? `${month} 고용보험가입내역서를 준비해주세요.`
            : '최초 등록에 필요한 서류 4종을 준비해주세요.',
          `${monthDay(cycle.issued_after + 'T00:00:00')} 이후 발급된 고용보험가입내역서 PDF를`,
          `${monthDay(last)} ${hourMinute(last)}까지 올려주세요.`,
        ],
        action: this.auth.me()?.initial_submitted
          ? '이번 달 서류 제출하기 →'
          : '첫 서류 등록하기 →',
        link: this.auth.me()?.initial_submitted ? '/submit' : '/initial',
      });
    }
    const approved = s.bank?.current;
    if (approved?.decided_at) {
      list.push({
        key: `otus.notice.read:${this.userId()}:account-approved:${approved.decided_at}`,
        stays: false,
        meta: `계좌 변경 · ${monthDay(approved.decided_at)} ${hourMinute(approved.decided_at)}`,
        title: '계좌 변경이 승인됐어요',
        lines: [
          `${approved.bank} ${approved.account_number_masked}`,
          '이 계좌가 지급 계좌로 바뀌었어요.',
        ],
        action: '내 정보 보기 →',
        link: '/settings',
      });
    }
    const rejected = s.bank?.last_rejected;
    if (rejected?.decided_at) {
      list.push({
        key: `otus.notice.read:${this.userId()}:account-rejected:${rejected.decided_at}`,
        stays: false,
        meta: `계좌 변경 · ${monthDay(rejected.decided_at)} ${hourMinute(rejected.decided_at)}`,
        title: '계좌 변경 요청이 반려됐어요',
        lines: [rejected.decision_note ?? '', '새 통장사본으로 다시 요청할 수 있어요.'].filter(
          Boolean,
        ),
        action: '계좌 다시 요청하기 →',
        link: '/settings',
      });
    }
    return list;
  });

  protected readonly unreadCount = computed(() => {
    this.readVersion();
    return this.serverUnread() + this.legacyNotices().filter((n) => !this.isRead(n)).length;
  });
  protected readonly shown = computed(() => {
    this.readVersion();
    const delivered: Notice[] = this.received().map(({ notice }) => ({
      ...notificationCopy(
        notice,
        this.source()?.cycle?.cycle ?? null,
        this.auth.me()?.initial_submitted ?? false,
      ),
      key: `server:${notice.id}`,
      id: notice.id,
      stays: true,
    }));
    return [...delivered, ...this.legacyNotices().filter((n) => n.stays || !this.isRead(n))];
  });
  protected readonly unread = computed(() => this.unreadCount() > 0);

  protected readonly label = computed(() =>
    this.unread() ? `알림, 새 알림 ${this.unreadCount()}개` : '알림',
  );

  constructor() {
    // first visit: the browser's permission prompt right away (the panel button stays for later)
    askOnFirstVisit((state) => this.browserState.set(state));
    const navigation = inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd));
    toObservable(computed(() => this.auth.me()?.id ?? null))
      .pipe(
        distinctUntilChanged(),
        switchMap((userId) => {
          this.sessionEnded.next();
          this.pageCancelled.next();
          this.knownIds = null;
          this.source.set(null);
          this.received.set([]);
          this.serverUnread.set(0);
          this.nextBefore.set(null);
          this.open.set(false);
          this.loading.set(false);
          this.loadingMore.set(false);
          this.reading.set(false);
          this.loadError.set(null);
          this.readError.set(null);
          if (userId === null) return EMPTY;
          return merge(
            navigation,
            this.refresh,
            // also while the tab is in the background: that is when a browser notification helps
            interval(60_000).pipe(filter(() => !this.open())),
            fromEvent(document, 'visibilitychange').pipe(
              filter(() => document.visibilityState === 'visible'),
            ),
          ).pipe(
            startWith(null),
            filter(() => !this.reading()),
            switchMap(() => {
              this.pageCancelled.next();
              this.loadingMore.set(false);
              this.loading.set(true);
              this.loadError.set(null);
              return forkJoin({
                delivered: forkJoin({
                  list: this.api.notifications(),
                  unread: this.api.unreadCount(),
                }).pipe(
                  catchError((error: unknown) => {
                    this.loadError.set(errorMessage(error));
                    return of(null);
                  }),
                ),
                // no period or no list: no notice, rather than a guess
                cycle: this.api.currentCycle().pipe(
                  switchMap((cycle) =>
                    this.api.listSubmissions({ month: cycle.target_month }).pipe(
                      map((list) => ({
                        cycle,
                        hasSubmitted: list.items.some(
                          (i) => i.kind === 'monthly' || i.kind === 'initial',
                        ),
                      })),
                    ),
                  ),
                  catchError(() => of(null)),
                ),
                bank: this.api.bankAccount().pipe(catchError(() => of(null))),
              });
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ delivered, cycle, bank }) => {
        this.source.set({ cycle, bank });
        if (delivered) {
          this.notifyBrowser(delivered.list.items, cycle?.cycle ?? null);
          this.received.set(
            delivered.list.items.map((notice) => ({ notice, read: notice.read_at !== null })),
          );
          this.serverUnread.set(delivered.unread.count);
          this.nextBefore.set(delivered.list.next_before);
        }
        this.loading.set(false);
      });
  }

  /** A new unread notification also shows as an OS notification, when the user allowed it. */
  private notifyBrowser(items: AppNotification[], cycle: Cycle | null): void {
    const { fresh, ids } = newItems(this.knownIds, items, (n) => String(n.id));
    this.knownIds = ids;
    const initialSubmitted = this.auth.me()?.initial_submitted ?? false;
    showBrowserNotices(
      fresh
        .filter((n) => n.read_at === null)
        .map((n) => {
          const copy = notificationCopy(n, cycle, initialSubmitted);
          return {
            title: copy.title,
            body: copy.lines.join(' '),
            tag: `otus-notice-${n.id}`,
            path: copy.link,
          };
        }),
      'otus-notice-summary',
    );
  }

  protected async enableBrowser(): Promise<void> {
    this.browserState.set(await askBrowserNotifications());
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(true);
      return;
    }
    this.open.set(true);
    this.reload();
    // the panel exists after the next render
    afterNextRender(() => this.panel()?.nativeElement.focus(), { injector: this.injector });
  }

  /** `restoreFocus`: Esc and "닫기" return to the bell; an outside click leaves the focus where it went. */
  protected close(restoreFocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    if (restoreFocus) {
      this.bell()?.nativeElement.focus();
    }
  }

  protected outsideClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close(false);
    }
  }

  private userId(): string | number {
    return this.auth.me()?.id ?? '';
  }

  protected isRead(notice: Notice): boolean {
    this.readVersion();
    if (notice.id !== undefined) {
      return this.received().find(({ notice: item }) => item.id === notice.id)?.read ?? false;
    }
    try {
      return localStorage.getItem(notice.key) === '1';
    } catch {
      return false;
    }
  }

  private markLegacyRead(key: string): void {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // unread stays unread: harmless
    }
    this.readVersion.update((v) => v + 1);
  }

  protected reload(): void {
    if (!this.reading()) this.refresh.next();
  }

  protected more(): void {
    const before = this.nextBefore();
    if (before === null || this.loading() || this.loadingMore() || this.reading()) return;
    this.loadingMore.set(true);
    this.loadError.set(null);
    this.api
      .notifications(before)
      .pipe(
        takeUntil(this.pageCancelled),
        takeUntil(this.sessionEnded),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (list) => {
          this.received.update((items) => {
            const known = new Set(items.map(({ notice }) => notice.id));
            return [
              ...items,
              ...list.items
                .filter((notice) => !known.has(notice.id))
                .map((notice) => ({ notice, read: notice.read_at !== null })),
            ];
          });
          this.nextBefore.set(list.next_before);
          this.loadingMore.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(errorMessage(error));
          this.loadingMore.set(false);
        },
      });
  }

  protected markRead(notice: Notice): void {
    if (this.isRead(notice) || this.reading() || this.loading() || this.loadingMore()) return;
    if (notice.id === undefined) {
      this.markLegacyRead(notice.key);
      return;
    }
    this.reading.set(true);
    this.readError.set(null);
    this.api
      .markNotificationRead(notice.id)
      .pipe(takeUntil(this.sessionEnded), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.received.update((items) =>
            items.map((item) => (item.notice.id === notice.id ? { ...item, read: true } : item)),
          );
          this.serverUnread.update((count) => Math.max(0, count - 1));
          this.reading.set(false);
        },
        error: (error: unknown) => {
          this.readError.set(errorMessage(error));
          this.reading.set(false);
        },
      });
  }

  protected markAllRead(): void {
    if (this.reading() || this.loading() || this.loadingMore()) return;
    this.reading.set(true);
    this.readError.set(null);
    this.api
      .markAllNotificationsRead()
      .pipe(takeUntil(this.sessionEnded), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.legacyNotices().forEach((notice) => this.markLegacyRead(notice.key));
          this.received.update((items) => items.map((item) => ({ ...item, read: true })));
          this.serverUnread.set(0);
          this.reading.set(false);
        },
        error: (error: unknown) => {
          this.readError.set(errorMessage(error));
          this.reading.set(false);
        },
      });
  }
}
