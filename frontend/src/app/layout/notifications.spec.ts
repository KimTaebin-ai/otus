import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AppNotification, BankAccount, BankAccountState, Cycle, Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { Notifications } from './notifications';
import { OnboardingShell } from './onboarding-shell';

const ME: Me = {
  id: 7,
  login: 'dongmin',
  display_name: '동민',
  role: 'student',
  is_demo: true,
  study_hours: 0,
  employed: false,
  employment_updated_at: null,
  initial_submitted: true,
};

const CYCLE: Cycle = {
  target_month: '2026-10',
  state: 'open',
  opens_at: '2026-10-01T00:00:00+09:00',
  closes_at: '2026-11-01T00:00:00+09:00',
  d_day: 14,
  issued_after: '2026-10-01',
};

const account = (over: Partial<BankAccount> = {}): BankAccount => ({
  bank: '우리은행',
  account_number_masked: '•••• 4567',
  status: 'approved',
  requested_at: '2026-10-16T10:00:00+09:00',
  decided_at: '2026-10-16T10:30:00+09:00',
  decision_note: null,
  bankbook: null,
  ...over,
});

const REMINDER: AppNotification = {
  id: 101,
  kind: 'submission_reminder',
  created_at: '2026-10-18T12:30:00+09:00',
  read_at: null,
  data: { month: '2026-10' },
};

type Options = {
  cycle?: Cycle;
  monthly?: boolean;
  employed?: boolean;
  bank?: BankAccountState;
  items?: AppNotification[];
  count?: number;
  next?: number | null;
  initialSubmitted?: boolean;
  onboarding?: boolean;
  initialThisMonth?: boolean;
};

describe('Notifications (bell)', () => {
  function flush(http: HttpTestingController, opts: Options = {}) {
    const items = opts.items ?? [];
    http.expectOne('/api/notifications').flush({ items, next_before: opts.next ?? null });
    http.expectOne('/api/notifications/unread-count').flush({
      count: opts.count ?? items.filter((item) => item.read_at === null).length,
    });
    flushSource(http, opts);
  }

  function flushSource(http: HttpTestingController, opts: Options) {
    http.expectOne('/api/cycles/current').flush(opts.cycle ?? CYCLE);
    http
      .expectOne('/api/me/bank-account')
      .flush(opts.bank ?? { current: null, pending: null, last_rejected: null });
    http.expectOne('/api/submissions?month=2026-10').flush({
      items: opts.monthly
        ? [{ id: 'm', kind: 'monthly' }]
        : opts.initialThisMonth
          ? [{ id: 'i', kind: 'initial' }]
          : [],
    });
  }

  function setup(opts: Options = {}) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(AuthService).setMe({
      ...ME,
      employed: opts.employed ?? false,
      initial_submitted: opts.initialSubmitted ?? true,
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = opts.onboarding
      ? TestBed.createComponent(OnboardingShell)
      : TestBed.createComponent(Notifications);
    fixture.detectChanges();
    flush(http, opts);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const bell = el.querySelector('.bell') as HTMLButtonElement;
    const button = (label: string) => {
      const found = Array.from(el.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === label,
      );
      expect(found, label).toBeDefined();
      return found!;
    };
    const open = (updated = opts) => {
      bell.click();
      fixture.detectChanges();
      flush(http, updated);
      fixture.detectChanges();
    };
    const text = () => el.textContent?.replace(/\s+/g, ' ') ?? '';
    return { fixture, el, bell, http, button, open, text };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify({ ignoreCancelled: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('displays delivered reminders and suppresses the duplicate automatic period hint', () => {
    const { el, bell, open, text, http } = setup({ items: [REMINDER] });
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 1개');
    open();
    expect(el.querySelectorAll('.notice')).toHaveLength(1);
    expect(text()).toContain('10월 서류, 준비하고 계신가요?');
    expect(text()).toContain('2026.10.18 12:30');
    expect(text()).toContain('10월 31일 23:59까지 PDF로 올려주세요.');
    // Merely opening the inbox never reads notifications that have not been viewed.
    http.expectNone((r) => r.method === 'POST');
    expect(localStorage.getItem('otus.notice.read:7:2026-10')).toBeNull();
  });

  it('uses the server count, including notifications beyond the loaded page', () => {
    const { bell } = setup({ monthly: true, items: [REMINDER], count: 25, next: 101 });
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 25개');
  });

  it('renders composed content as text and keeps repeated lines and blank lines', () => {
    const { el, open } = setup({
      monthly: true,
      items: [
        {
          ...REMINDER,
          kind: 'admin_notice',
          data: {
            title: '<b>운영팀 안내</b>',
            body: '반복 문장\n\n반복 문장\n<img src=x onerror=alert(1)>',
          },
        },
      ],
    });
    open();
    const notice = el.querySelector('.notice')!;
    expect(notice.querySelector('h3')?.textContent).toBe('<b>운영팀 안내</b>');
    expect(notice.querySelector('b, img')).toBeNull();
    expect(notice.querySelector('.body')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(notice.querySelector('.body')?.textContent?.match(/반복 문장/g)).toHaveLength(2);
    expect(notice.querySelectorAll('.body br')).toHaveLength(4);
  });

  it('provides the inbox on the initial registration screen as well', () => {
    const { el, open, text } = setup({
      onboarding: true,
      initialSubmitted: false,
      items: [REMINDER],
    });
    open();
    expect(el.querySelector('app-notifications')).not.toBeNull();
    expect(text()).toContain('최초 등록에 필요한 서류 4종');
    expect(text()).toContain('첫 서류 등록하기');
  });

  it('does not add a monthly reminder when initial submission already covers this month', () => {
    const { el } = setup({ initialThisMonth: true });
    expect(el.querySelector('.dot')).toBeNull();
  });

  it('saves individual read state on the server and keeps the delivered card', () => {
    const { el, bell, http, fixture, open, button } = setup({ items: [REMINDER] });
    open();
    button('읽음으로 표시').click();
    const request = http.expectOne('/api/notifications/101/read');
    expect(request.request.method).toBe('POST');
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 1개');
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(el.querySelector('.dot')).toBeNull();
    expect(el.querySelector('.notice.read')).not.toBeNull();
    bell.click();
    open({ items: [{ ...REMINDER, read_at: '2026-10-18T12:40:00+09:00' }] });
    expect(el.querySelector('.dot')).toBeNull();
    expect(el.querySelectorAll('.notice')).toHaveLength(1);
  });

  it('does not trust localStorage for a delivered reminder', () => {
    localStorage.setItem('otus.notice.read:7:2026-10', '1');
    const { bell, open, text } = setup({ items: [REMINDER] });
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 1개');
    open();
    expect(text()).toContain('안 읽음');
  });

  it('keeps failed read requests unread and allows retry', () => {
    const { bell, http, fixture, open, button, text } = setup({ items: [REMINDER] });
    open();
    button('읽음으로 표시').click();
    http.expectOne('/api/notifications/101/read').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain('읽음 상태를 저장하지 못했어요.');
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 1개');
    button('읽음으로 표시').click();
    http.expectOne('/api/notifications/101/read').flush(null);
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('알림');
  });

  it('marks all read only after the server accepts the explicit action', () => {
    const { bell, http, fixture, open, button } = setup({ items: [REMINDER], count: 25 });
    open();
    button('모두 읽음').click();
    fixture.detectChanges();
    expect(button('모두 읽음').disabled).toBe(true);
    const request = http.expectOne('/api/notifications/read-all');
    expect(request.request.method).toBe('POST');
    request.error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 25개');
    button('모두 읽음').click();
    http.expectOne('/api/notifications/read-all').flush(null);
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('알림');
  });

  it('loads older notifications by cursor and preserves both cards', () => {
    const { el, http, fixture, open, button } = setup({ items: [REMINDER], next: 101 });
    open();
    button('이전 알림 더 보기').click();
    http.expectOne('/api/notifications?before=101').flush({
      items: [
        { ...REMINDER, id: 99, data: { month: '2026-09' }, read_at: '2026-10-01T01:00:00+09:00' },
      ],
      next_before: null,
    });
    fixture.detectChanges();
    expect(el.querySelectorAll('.notice')).toHaveLength(2);
    expect(el.querySelectorAll('.notice')[1].textContent).toContain('제출 이력 보기');
    expect(el.querySelectorAll('.notice')[1].textContent).not.toContain('10월 31일');
  });

  it('can retry a failed page without losing loaded notifications', () => {
    const { el, http, fixture, open, button } = setup({ items: [REMINDER], next: 101 });
    open();
    button('이전 알림 더 보기').click();
    http.expectOne('/api/notifications?before=101').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(el.querySelectorAll('.notice')).toHaveLength(1);
    button('이전 알림 더 보기').click();
    http.expectOne('/api/notifications?before=101').flush({ items: [], next_before: null });
  });

  it('shows a load error instead of claiming the inbox is empty, then recovers', () => {
    const { el, http, fixture, bell, button } = setup({ monthly: true });
    bell.click();
    http.expectOne('/api/notifications').error(new ProgressEvent('error'));
    http.expectOne('/api/notifications/unread-count'); // cancelled with the failed list
    flushSource(http, { monthly: true });
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('알림을 불러오지 못했어요.');
    expect(el.textContent).not.toContain('새 알림이 없어요.');
    button('새로고침').click();
    flush(http, { items: [REMINDER] });
    fixture.detectChanges();
    expect(el.querySelectorAll('.notice')).toHaveLength(1);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('refreshes on opening so an administrator send appears without reloading the app', () => {
    const { open, el } = setup({ monthly: true });
    open({ items: [REMINDER] });
    expect(el.querySelectorAll('.notice')).toHaveLength(1);
  });

  it('polls while the inbox is closed and cancels polling when destroyed', () => {
    vi.useFakeTimers();
    const { http, fixture, bell } = setup({ monthly: true });
    vi.advanceTimersByTime(60_000);
    flush(http, { items: [REMINDER] });
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 1개');
    fixture.destroy();
    vi.advanceTimersByTime(60_000);
    http.expectNone('/api/notifications');
  });

  it('clears another user’s inbox and cancels their pending read when the account changes', () => {
    const { el, bell, http, fixture, open, button } = setup({ items: [REMINDER] });
    open();
    button('읽음으로 표시').click();
    const read = http.expectOne('/api/notifications/101/read');
    TestBed.inject(AuthService).setMe({ ...ME, id: 8 });
    fixture.detectChanges();
    expect(read.cancelled).toBe(true);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    flush(http, { monthly: true });
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('알림');
    open({ monthly: true });
    expect(el.querySelectorAll('.notice')).toHaveLength(0);
  });

  it('cancels an old inbox request on logout without reintroducing its contents', () => {
    const { el, bell, http, fixture } = setup({ items: [REMINDER] });
    bell.click();
    const pending = http.match(() => true);
    TestBed.inject(AuthService).setMe(null);
    fixture.detectChanges();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((r) => r.cancelled)).toBe(true);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(bell.getAttribute('aria-label')).toBe('알림');
    http.expectNone('/api/notifications');
  });

  it('still shows automatic period guidance before an administrator sends a reminder', () => {
    const { el, bell, open, fixture, button } = setup();
    expect(bell.getAttribute('aria-label')).toBe('알림, 새 알림 1개');
    open();
    expect(el.textContent).toContain('10월 31일 23:59까지 올려주세요.');
    button('읽음으로 표시').click();
    fixture.detectChanges();
    expect(localStorage.getItem('otus.notice.read:7:2026-10')).toBe('1');
    expect(el.querySelector('.dot')).toBeNull();
    expect(el.querySelector('.notice')).not.toBeNull();
  });

  it('does not synthesize a reminder for employed or already submitted students', () => {
    const { el, fixture } = setup({ employed: true });
    expect(el.querySelector('.dot')).toBeNull();
    TestBed.inject(AuthService).setMe({ ...ME, employed: false });
    fixture.detectChanges();
    expect(el.querySelector('.dot')).not.toBeNull();
  });

  it('has no automatic reminder once submitted or the period is closed', () => {
    const { bell, el, open } = setup({ monthly: true });
    expect(el.querySelector('.dot')).toBeNull();
    open({ cycle: { ...CYCLE, state: 'closed' } });
    expect(bell.getAttribute('aria-label')).toBe('알림');
    expect(el.textContent).toContain('새 알림이 없어요.');
  });

  it('preserves bank approval and rejection hints until server producers are available', () => {
    const { el, open, text, button, fixture } = setup({
      monthly: true,
      bank: {
        current: account(),
        pending: null,
        last_rejected: account({
          status: 'rejected',
          decision_note: '통장사본과 계좌번호가 다릅니다.',
        }),
      },
    });
    open();
    expect(el.querySelectorAll('.notice')).toHaveLength(2);
    expect(text()).toContain('우리은행 •••• 4567');
    expect(text()).toContain('통장사본과 계좌번호가 다릅니다.');
    button('읽음으로 표시').click();
    fixture.detectChanges();
    expect(
      localStorage.getItem('otus.notice.read:7:account-approved:2026-10-16T10:30:00+09:00'),
    ).toBe('1');
    expect(el.querySelectorAll('.notice')).toHaveLength(1);
  });

  it('can receive and read server notices even when local storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { open, button, http, fixture, bell } = setup({ items: [REMINDER] });
    open();
    button('읽음으로 표시').click();
    http.expectOne('/api/notifications/101/read').flush(null);
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('알림');
  });

  it('returns focus to the bell on Escape and closes on an outside click', () => {
    const { open, el, fixture, bell } = setup();
    open();
    (el.querySelector('.popover') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(el.querySelector('.popover')).toBeNull();
    expect(document.activeElement).toBe(bell);
    open();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('.popover')).toBeNull();
  });
});
