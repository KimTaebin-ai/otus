import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AdminMonth } from '../core/admin-month';
import { Dashboard } from './dashboard';

describe('Dashboard route', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: Dashboard }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // October 18th: the working month is November (reviewing October's study)
    TestBed.inject(AdminMonth).working.set('2026-11');
  });
  afterEach(() => http.verify());

  /** A working month's list is two requests (the month before and the month itself). */
  const windowRequests = () => {
    const found = http.match(
      (r) => r.url === '/api/admin/submissions' && r.params.get('limit') === '50',
    );
    expect(found).toHaveLength(2);
    const latest = found
      .map((r) => r.request.params.get('month') ?? '')
      .sort()
      .at(-1);
    const main = found.find((r) => r.request.params.get('month') === latest)!;
    return {
      found,
      main,
      answer: (body: object, opts?: { status: number; statusText: string }) => {
        for (const r of found) {
          if (r.cancelled) continue;
          if (r === main || opts) r.flush(body, opts);
          else r.flush({ month: '', months: [], items: [], next_before: null });
        }
      },
    };
  };
  it('works on the month from today, not from the address', async () => {
    const harness = await RouterTestingHarness.create('/?month=2026-03');
    const requests = windowRequests();
    expect(requests.found.map((r) => r.request.params.get('month')).sort()).toEqual([
      '2026-10',
      '2026-11',
    ]);
    requests.answer({ month: '2026-11', months: ['2026-11'], items: [], next_before: null });
    http
      .match((request) => request.url === '/api/admin/notices/submission-reminder')
      .forEach((request) => request.flush({ targets: [] }));
    harness.detectChanges();
    const text = harness.routeNativeElement!.textContent;
    expect(text).toContain('10월 학습 지원금 제출 현황');
    expect(text).toContain('10월 1일 ~ 11월 15일 제출분');
  });

  it('loads actual monthly rows and provides operational links without invented totals', async () => {
    const harness = await RouterTestingHarness.create('/');
    windowRequests().answer({
      month: '2026-11',
      months: ['2026-10'],
      next_before: null,
      items: [
        {
          user: {
            id: 9,
            login: 'nosubmit',
            display_name: '김미제출',
            employed: false,
            initial_submitted: false,
          },
          chains: [],
          last_submitted_at: null,
        },
        {
          user: {
            id: 8,
            login: 'working',
            display_name: '취업자',
            employed: true,
            initial_submitted: true,
          },
          chains: [],
          last_submitted_at: null,
        },
        {
          user: {
            id: 3,
            login: 'reviewdemo',
            display_name: '실제 응답 교육생',
            employed: false,
            initial_submitted: true,
          },
          chains: [
            {
              root_submission_id: 'initial',
              root_kind: 'initial',
              latest_submission_id: 'initial',
              latest_kind: 'initial',
              status: 'pending_review',
              submitted_at: '2026-10-12T12:00:00+09:00',
              supplement_count: 0,
            },
          ],
          last_submitted_at: '2026-10-12T12:00:00+09:00',
        },
      ],
    });
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('10월 학습 지원금 제출 인원');
    expect(text).toContain('학습 지원금');
    expect(el.querySelector('.counts')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '1명제출1명미제출2명제출 대상',
    );
    expect(text).toContain('취업 중 1명은 제외했어요');
    expect([...el.querySelectorAll('.counts a')].map((a) => a.getAttribute('href'))).toEqual([
      '/submissions?status=submitted',
      '/submissions?status=unsubmitted',
      '/submissions?status=all',
    ]);
    expect(text).toContain('실제 응답 교육생');
    expect(text).not.toContain('김미제출');
    expect(text).toContain('10월 학습 지원금 제출 현황');
    expect(text).toContain('월별 제출 내역');
    expect(text).toContain('제출 안내 보내기');
    expect(text).toContain('파일 일괄 다운로드');
    expect(el.querySelector('a[href="/submissions/initial"]')).not.toBeNull();
    expect(text).not.toContain('관리자 API가 준비되면');
    expect(text).not.toMatch(/40시간|계좌 1건|대상 확정/);
  });

  it('shows an API failure and keeps the available workflow links', async () => {
    const harness = await RouterTestingHarness.create('/');
    windowRequests().answer(
      { error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('서버 오류가 발생했습니다.');
    expect(el.textContent).toContain('월별 제출 내역');
    expect(el.textContent).not.toContain('등록된 교육생이 없어요.');
  });

  it('shows the layout with the preview data in dev builds', async () => {
    const harness = await RouterTestingHarness.create('/?preview');
    const el = harness.routeNativeElement as HTMLElement;
    // the preview data is a dynamic import, which whenStable does not wait for
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(el.textContent).toContain('10월 지원금 운영 현황');
    });
    const text = el.textContent ?? '';
    expect(text).toContain('재검토 요청');
    expect(text).toContain('40시간 달성(예상)');
    expect(text).toContain('계좌 1건');
    // v1.0: no 유예 or 개명, no help or history buttons
    expect(text).not.toMatch(/유예|개명|변경 이력|자료 보관함|관리자 가이드/);
    expect([...el.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      '대상·시간 요건 확인',
      '월별 제출 내역',
      '제출 안내 보내기',
    ]);
  });
});
