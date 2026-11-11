import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AuthService } from '../core/auth.service';
import { AdminShell } from './admin-shell';
import { AdminMonth, adjacentMonth } from '../core/admin-month';
import { Periods } from '../pages/periods';

describe('AdminShell', () => {
  const currentMonth = () =>
    TestBed.inject(HttpTestingController).expectOne('/api/admin/cycles').flush({
      current_month: '2026-10',
      year: 2026,
      can_manage: false,
      items: [],
    });
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminShell],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(AuthService).setMe({
      id: 2,
      login: 'jiwoo',
      display_name: '지우',
      role: 'accountant',
      is_demo: true,
      study_hours: 0,
      employed: false,
      employment_updated_at: null,
      initial_submitted: false,
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('shows the user with their role', () => {
    const fixture = TestBed.createComponent(AdminShell);
    currentMonth();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('지우');
    expect(text).toContain('회계·지정 담당자');
    expect(text).not.toContain('jiwoo');
  });

  it('shows unread employment and bank changes on the bell and clears them when opened', async () => {
    const fixture = TestBed.createComponent(AdminShell);
    currentMonth();
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    await vi.waitFor(() =>
      http.expectOne('/api/admin/activity?limit=20').flush({
        items: [
          {
            id: 'bank:7',
            kind: 'bank_account_requested',
            user: { id: 12, login: 'dm', display_name: '동민' },
            occurred_at: '2999-10-18T11:00:00+09:00',
            data: { status: 'pending' },
          },
          {
            id: 'employment:12:1',
            kind: 'employment_changed',
            user: { id: 12, login: 'dm', display_name: '동민' },
            occurred_at: '2999-10-18T10:00:00+09:00',
            data: { employed: true },
          },
        ],
      }),
    );
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.badge')?.textContent).toContain('2');
    el.querySelector<HTMLButtonElement>('.bell-button')!.click();
    fixture.detectChanges();
    const text = el.querySelector('.bell-panel')?.textContent ?? '';
    expect(text).toContain('동민님이 계좌 변경을 요청했어요 (검토 대기)');
    expect(text).toContain('동민님이 취업 상태를 취업 중으로 변경했어요');
    expect(el.querySelector('.badge')).toBeNull();
    localStorage.removeItem('otus-admin-activity-seen');
    fixture.destroy();
  });

  it('lists staff menus including period settings without a help card', () => {
    const fixture = TestBed.createComponent(AdminShell);
    currentMonth();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(labels).toEqual([
      '현황 대시보드',
      '월별 제출 내역',
      '사용자 관리',
      '알림 보내기',
      '제출 기간 설정',
    ]);
    expect(el.textContent).toContain('제출 기간 설정');
    expect(el.textContent).not.toContain('관리자 가이드');
  });

  it('logs out and goes to /login', async () => {
    const fixture = TestBed.createComponent(AdminShell);
    currentMonth();
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.logout')!.click();
    TestBed.inject(HttpTestingController).expectOne('/api/auth/logout').flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    expect(TestBed.inject(AuthService).me()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(TestBed.inject(AdminMonth).selected()).toBeNull();
  });

  it('names the review window from today, with no 조회 월 filter', () => {
    // October 18th: the working month is November, reviewing October's study
    TestBed.inject(AdminMonth).working.set('2026-11');
    const fixture = TestBed.createComponent(AdminShell);
    currentMonth();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.review-window')?.textContent).toContain(
      '10월 학습에 대한 지원금 지급 건 검토',
    );
    expect(el.querySelector('.review-window')?.textContent).toContain(
      '10월 1일 ~ 11월 15일 제출분',
    );
    expect(el.querySelector('#admin-month')).toBeNull();
    expect(el.textContent).not.toContain('조회 월');
  });

  it('moves between review windows with arrows and cannot go past today', () => {
    const months = TestBed.inject(AdminMonth);
    months.working.set('2026-11');
    const fixture = TestBed.createComponent(AdminShell);
    currentMonth();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const next = el.querySelector<HTMLButtonElement>('[aria-label="다음 검토 기간"]')!;
    expect(next.disabled).toBe(true);
    el.querySelector<HTMLButtonElement>('[aria-label="이전 검토 기간"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.review-window')?.textContent).toContain('9월 학습에 대한');
    expect(el.querySelector('.review-window')?.textContent).toContain('지난 검토');
    expect(next.disabled).toBe(false);
    next.click();
    fixture.detectChanges();
    expect(el.querySelector('.review-window')?.textContent).toContain('10월 학습에 대한');
    expect(next.disabled).toBe(true);
  });

  it('steps through months', () => {
    expect(adjacentMonth('2025-12', 1)).toBe('2026-01');
    expect(adjacentMonth('2026-01', -1)).toBe('2025-12');
    expect(adjacentMonth('0001-01', -1)).toBeNull();
    expect(adjacentMonth('9998-12', 1)).toBeNull();
  });
});

describe('shared month navigation with period settings', () => {
  it('changes the editor month through the header and blocks month changes during saving', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: AdminShell, children: [{ path: 'periods', component: Periods }] },
        ]),
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create('/periods?month=2026-11');
    const el = harness.routeNativeElement as HTMLElement;
    const row = (month: string) => ({
      target_month: month,
      opens_at: null,
      closes_at: null,
      version: null,
      state: 'not_set',
    });
    const page = {
      current_month: '2026-10',
      year: 2026,
      can_manage: true,
      items: [row('2026-10'), row('2026-11')],
    };
    http.expectOne('/api/admin/cycles').flush(page);
    http.expectOne('/api/admin/cycles?year=2026').flush(page);
    http.expectOne('/api/admin/cycles/2026-11/history').flush([]);
    await vi.waitFor(() => http.expectOne('/api/admin/activity?limit=20').flush({ items: [] }));
    harness.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#admin-month')!.value).toBe('2026-11');

    el.querySelector<HTMLButtonElement>('[aria-label="이전 월"]')!.click();
    await harness.fixture.whenStable();
    http.expectOne('/api/admin/cycles?year=2026').flush(page);
    http.expectOne('/api/admin/cycles/2026-10/history').flush([]);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/periods?month=2026-10');
    expect(el.querySelector<HTMLInputElement>('#admin-month')!.value).toBe('2026-10');
    expect(el.querySelector<HTMLInputElement>('#period-start')!.value).toBe('2026-10-01T00:00');

    el.querySelector('app-periods form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const save = http.expectOne('/api/admin/cycles/2026-10');
    harness.detectChanges();
    expect(el.querySelector<HTMLFieldSetElement>('.month-navigation')!.disabled).toBe(true);
    save.flush({
      ...row('2026-10'),
      opens_at: '2026-10-01T00:00:00+09:00',
      closes_at: '2026-11-01T00:00:00+09:00',
      version: 1,
      state: 'open',
    });
    http.expectOne('/api/admin/cycles/2026-10/history').flush([]);
    harness.detectChanges();
    expect(el.querySelector<HTMLFieldSetElement>('.month-navigation')!.disabled).toBe(false);
    expect(el.textContent).toContain('2026년 10월 제출 기간을 저장했습니다.');
    http.verify();
  });
});
