import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AdminSubmissionsApi, submissionMonthLabel } from './admin-submissions-api';

describe('AdminSubmissionsApi', () => {
  let http: HttpTestingController;
  let api: AdminSubmissionsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AdminSubmissionsApi);
  });
  afterEach(() => http.verify());

  it('lets the server choose the current month and omits the all-status filter', () => {
    api.list({ status: 'all' }).subscribe();
    const request = http.expectOne((request) => request.url === '/api/admin/submissions');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.has('month')).toBe(false);
    expect(request.request.params.has('status')).toBe(false);
    request.flush({ month: '2026-10', months: ['2026-10'], items: [], next_before: null });
  });

  it('sends the selected month, literal search, public status and user cursor', () => {
    api
      .list({ month: '2026-09', query: '이름 %', status: 'unsubmitted', limit: 5, before: 12 })
      .subscribe();
    const request = http.expectOne((request) => request.url === '/api/admin/submissions');
    expect(request.request.params.get('month')).toBe('2026-09');
    expect(request.request.params.get('query')).toBe('이름 %');
    expect(request.request.params.get('status')).toBe('unsubmitted');
    expect(request.request.params.get('before')).toBe('12');
    expect(request.request.params.get('limit')).toBe('5');
    request.flush({ month: '2026-09', months: ['2026-09'], items: [], next_before: null });
  });

  it('requests the earliest review candidate for the server month', () => {
    api.reviewQueue('2026-09').subscribe();
    const request = http.expectOne((request) => request.url === '/api/admin/review-queue');
    expect(request.request.params.get('month')).toBe('2026-09');
    expect(request.request.params.get('limit')).toBe('1');
    request.flush({ month: '2026-09', items: [], next_after: null });
    expect(submissionMonthLabel('2026-09')).toBe('2026년 9월');
  });

  describe('listWindow', () => {
    const user = { id: 1, login: 'a', display_name: 'A', employed: false, initial_submitted: true };
    const chain = (id: string, submitted_at: string) => ({
      root_submission_id: id,
      root_kind: 'monthly' as const,
      latest_submission_id: id,
      latest_kind: 'monthly' as const,
      status: 'pending_review' as const,
      submitted_at,
      supplement_count: 0,
    });
    // an Oct 10 and an Oct 17 submission, both with target month 2026-10
    const october = {
      month: '2026-10',
      months: ['2026-10'],
      next_before: null,
      items: [
        {
          user,
          chains: [
            chain('early', '2026-10-10T10:00:00+09:00'),
            chain('late', '2026-10-17T10:00:00+09:00'),
          ],
          last_submitted_at: '2026-10-17T10:00:00+09:00',
        },
      ],
    };
    const empty = (month: string) => ({ month, months: [month], next_before: null, items: [] });
    const open = (month: string) => {
      let result: string[] = [];
      api.listWindow({ month, status: 'all' }).subscribe((page) => {
        result = page.items.flatMap((row) => row.chains.map((c) => c.root_submission_id));
      });
      for (const request of http.match((r) => r.url === '/api/admin/submissions')) {
        const m = request.request.params.get('month')!;
        request.flush(m === '2026-10' ? october : empty(m));
      }
      return result;
    };

    it('lists every student with a submission in the window as 제출자, approved ones too', () => {
      let ids: number[] = [];
      api.listWindow({ month: '2026-10', status: 'submitted' }).subscribe((page) => {
        ids = page.items.map((row) => row.user.id);
      });
      for (const request of http.match((r) => r.url === '/api/admin/submissions')) {
        const m = request.request.params.get('month')!;
        request.flush(
          m === '2026-10'
            ? {
                ...october,
                items: [
                  {
                    ...october.items[0],
                    chains: [{ ...october.items[0].chains[0], status: 'approved' as const }],
                  },
                ],
              }
            : empty(m),
        );
      }
      expect(ids).toEqual([1]);
    });

    it('keeps an October 17th submission out of the October list', () => {
      expect(open('2026-10')).toEqual(['early']);
    });

    it('shows it in the November list, with the whole October inside that window', () => {
      expect(open('2026-11')).toEqual(['early', 'late']);
    });
  });
});
