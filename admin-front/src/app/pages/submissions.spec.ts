import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Role } from '@otus/shared/core/api-types';
import { MonthlyStudentRow, MonthlySubmissions } from '../core/admin-submissions-api';
import { AdminMonth } from '../core/admin-month';
import { AuthService } from '../core/auth.service';
import { Submissions } from './submissions';

@Component({ template: '검토 상세' })
class ReviewStub {}

const row = (id: number): MonthlyStudentRow => ({
  user: {
    id,
    login: `demo${id}`,
    display_name: `교육생${id}`,
    employed: false,
    initial_submitted: false,
  },
  // a waiting submission inside the September 1st to October 15th window
  chains: [
    {
      root_submission_id: `root${id}`,
      root_kind: 'monthly',
      latest_submission_id: `root${id}`,
      latest_kind: 'monthly',
      status: 'pending_review',
      submitted_at: '2026-10-10T10:00:00+09:00',
      supplement_count: 0,
    },
  ],
  last_submitted_at: '2026-10-10T10:00:00+09:00',
});

const page = (
  items: MonthlyStudentRow[],
  next_before: number | null = null,
): MonthlySubmissions => ({
  month: '2026-10',
  months: ['2026-10', '2026-09'],
  items,
  next_before,
});

describe('Monthly submissions', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;
  const me = signal<{ role: Role }>({ role: 'operator' });

  beforeEach(async () => {
    me.set({ role: 'operator' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'submissions', component: Submissions },
          { path: 'submissions/:id', component: ReviewStub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { me } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // working in October: the September 1st to October 15th window
    TestBed.inject(AdminMonth).working.set('2026-10');
    harness = await RouterTestingHarness.create('/submissions');
    el = harness.routeNativeElement as HTMLElement;
  });
  afterEach(() => {
    http
      .match((request) => request.url === '/api/admin/notices/submission-reminder')
      .filter((request) => !request.cancelled)
      .forEach((request) => request.flush({ targets: [] }));
    http.verify();
  });

  const empty = () => page([]);
  /**
   * A working month's list is two requests, the month before and the month itself (the status
   * filter is applied in the browser). This returns the pair as one: the later month's body is
   * `flush`ed, the earlier month answers empty.
   */
  const open = (
    matches: (request: {
      params: { get(name: string): string | null; has(name: string): boolean };
    }) => boolean,
  ) => {
    const found = http.match(
      (request) => request.url === '/api/admin/submissions' && matches(request),
    );
    expect(found.length).toBeGreaterThan(0);
    const months = found.map((r) => r.request.params.get('month') ?? '');
    const latest = months.reduce((a, b) => (b > a ? b : a));
    const main = found.find((r) => (r.request.params.get('month') ?? '') === latest) ?? found[0];
    return {
      request: main.request,
      get cancelled() {
        return found.every((r) => r.cancelled);
      },
      flush: (body: unknown, opts?: { status: number; statusText: string }, counts = empty()) => {
        for (const r of found) {
          if (r.cancelled) continue;
          if (r === main || opts) r.flush(body as object, opts);
          else r.flush(empty(), opts);
        }
        // the counts ask for the whole window once the list is in: answer them right away
        const more = http.match(
          (r) => r.url === '/api/admin/submissions' && !r.params.has('before'),
        );
        const latest = more
          .map((r) => r.request.params.get('month') ?? '')
          .sort()
          .at(-1);
        for (const r of more) r.flush(r.request.params.get('month') === latest ? counts : empty());
      },
    };
  };
  const first = () => open((request) => !request.params.has('before'));
  const button = (text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    )!;

  it('shows initial and monthly review links for their respective students alongside missing students', () => {
    const submitted = row(4);
    submitted.user.initial_submitted = true;
    submitted.chains = [
      {
        root_submission_id: 'initial',
        root_kind: 'initial',
        latest_submission_id: 'repair',
        latest_kind: 'supplement',
        status: 'resubmitted',
        submitted_at: '2026-10-12T12:00:00+09:00',
        supplement_count: 1,
      },
    ];
    const monthly = row(3);
    monthly.user.initial_submitted = true;
    monthly.chains = [
      {
        root_submission_id: 'monthly',
        root_kind: 'monthly',
        latest_submission_id: 'monthly',
        latest_kind: 'monthly',
        status: 'pending_review',
        submitted_at: '2026-10-10T11:00:00+09:00',
        supplement_count: 0,
      },
    ];
    first().flush(page([submitted, monthly]));
    harness.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(el.textContent).toContain('보완 1회');
    expect(el.textContent).toContain('재검토 대기');
    expect(el.textContent).toContain('검토 중');
    expect(el.querySelector('a[href="/submissions/repair"]')).not.toBeNull();
    expect(el.querySelector('a[href="/submissions/monthly"]')).not.toBeNull();
    expect(el.textContent).not.toContain('관리자 API가 준비되면');
  });

  it('searches and filters on the server, resetting pagination', () => {
    first().flush(page([row(4)], 4));
    harness.detectChanges();
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = ' 교육생 ';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    let request = first();
    expect(request.request.params.get('query')).toBe('교육생');
    request.flush(page([row(3)]));
    harness.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="서류 상태"]')!;
    select.value = 'unsubmitted';
    select.dispatchEvent(new Event('change'));
    request = first();
    // the filter is applied in the browser, on the chains inside the window
    expect(request.request.params.has('before')).toBe(false);
    request.flush(page([]));
    harness.detectChanges();
    expect(el.textContent).toContain('선택한 조건에 맞는 교육생이 없어요.');
  });

  it('searches while typing and shows the status picked from a link', async () => {
    first().flush(page([row(4)]));
    harness.detectChanges();
    vi.useFakeTimers();
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = '동민';
    input.dispatchEvent(new Event('input'));
    expect(el.querySelector('button[type="submit"]')).toBeNull();
    vi.advanceTimersByTime(299);
    http.expectNone((r) => r.params.get('query') === '동민');
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    first().flush(page([row(3)]));
    await harness.navigateByUrl('/submissions?status=unsubmitted');
    harness.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="서류 상태"]')!;
    expect(select.selectedOptions[0].value).toBe('unsubmitted');
    first().flush(page([]));
  });

  it("counts the window's submitted and unsubmitted, leaving out 취업 중 and a late submission", () => {
    const none = (id: number): MonthlyStudentRow => ({
      ...row(id),
      chains: [],
      last_submitted_at: null,
    });
    const employed = { ...row(4), user: { ...row(4).user, employed: true } };
    // student 3 submitted after October 15th: that chain is outside the window, so he has none in it
    first().flush(page([]), undefined, page([row(1), none(2), none(3), employed]));
    harness.detectChanges();
    expect(el.querySelector('.counts')?.textContent?.replace(/\s+/g, '')).toContain(
      '제출1명미제출2명제출대상3명',
    );
    expect(el.textContent).toContain('취업 중 1명 제외');
  });

  it("opens the student's 42 Intra profile from the study-hours cell, to check the hours by hand", () => {
    first().flush(page([row(5)]));
    harness.detectChanges();
    const link = el.querySelector<HTMLAnchorElement>('tbody a.hours-link')!;
    expect(link.getAttribute('href')).toBe('https://profile.intra.42.fr/users/demo5');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('aria-label')).toContain('demo5');
  });

  it('lists submitters first, with the status filter left of the search', () => {
    const request = first();
    request.flush(page([]));
    harness.detectChanges();
    const labels = [...el.querySelectorAll('form app-field')].map((f) => f.getAttribute('label'));
    expect(labels).toEqual(['서류 상태', '교육생 검색']);
    expect(el.textContent).not.toContain('더 보기');
    expect(el.querySelector('h1')?.textContent).toContain('월 학습에 대한 지원금 지급 건 검토');
  });

  it('loads the next page on scroll without duplicating a student and cancels stale pagination', () => {
    const observers: { callback: (entries: { isIntersecting: boolean }[]) => void }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          observers.push({ callback });
        }
        observe() {}
        disconnect() {}
      },
    );
    first().flush(page([row(5), row(4)], 4));
    harness.detectChanges();
    expect(el.querySelector('.more')).not.toBeNull();
    observers.at(-1)!.callback([{ isIntersecting: true }]);
    open((request) => request.params.get('before') === '4').flush(page([row(4), row(3)], 3));
    harness.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(el.textContent).toContain('교육생 제출 현황 · 3명 이상');
    observers.at(-1)!.callback([{ isIntersecting: true }]);
    const stale = open((request) => request.params.get('before') === '3');
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="서류 상태"]')!;
    select.value = 'approved';
    select.dispatchEvent(new Event('change'));
    expect(stale.cancelled).toBe(true);
    first().flush(page([]));
    harness.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('starts with the earliest queue item and carries its month into the review route', async () => {
    first().flush(page([row(4)]));
    harness.detectChanges();
    button('연속 검토 시작').click();
    // the queue of both months is asked for; only what falls in the window counts
    const requests = http.match((request) => request.url === '/api/admin/review-queue');
    expect(requests.map((r) => r.request.params.get('month')).sort()).toEqual([
      '2026-09',
      '2026-10',
    ]);
    for (const request of requests)
      request.flush({
        month: request.request.params.get('month'),
        items:
          request.request.params.get('month') === '2026-10'
            ? [
                { id: 'late-review', submitted_at: '2026-10-17T10:00:00+09:00' },
                { id: 'first-review', submitted_at: '2026-10-10T10:00:00+09:00' },
              ]
            : [],
        next_after: null,
      });
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/submissions/first-review');
  });

  it('explains an empty queue and hides review start for the admin role', () => {
    first().flush(page([]));
    harness.detectChanges();
    button('연속 검토 시작').click();
    for (const request of http.match((r) => r.url === '/api/admin/review-queue'))
      request.flush({ month: '2026-10', items: [], next_after: null });
    harness.detectChanges();
    expect(el.textContent).toContain('검토 대기 중인 제출이 없어요.');
    me.set({ role: 'admin' });
    harness.detectChanges();
    expect(button('연속 검토 시작')).toBeUndefined();
  });

  it('shows server errors with a retry and never labels a failed request as empty', () => {
    first().flush(
      { error: { code: 'FORBIDDEN', message: '권한이 없습니다.' } },
      { status: 403, statusText: 'Forbidden' },
    );
    harness.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('권한이 없습니다.');
    expect(el.textContent).not.toContain('조건에 맞는 교육생이 없어요.');
    button('다시 불러오기').click();
    first().flush(page([row(2)]));
    harness.detectChanges();
    expect(el.textContent).toContain('교육생2');
  });

  it('shows the study hours in their own column, coloured by band', () => {
    first().flush(page([row(1), row(2), row(3)]));
    const hours = [0, 40, 80];
    for (const preview of http.match((r) => r.url === '/api/admin/notices/submission-reminder'))
      preview.flush({
        targets: hours.map((h, i) => ({
          user_id: i + 1,
          name: 'n',
          login: 'l',
          employed: false,
          status: 'missing',
          study_hours: h,
        })),
      });
    harness.detectChanges();
    const tones = [...el.querySelectorAll('.hours')].map((e) => e.className.replace('hours ', ''));
    expect(tones.sort()).toEqual(['high', 'low', 'mid']);
    expect(el.querySelector('th:nth-child(4)')?.textContent).toContain('학습 시간');
  });
});
