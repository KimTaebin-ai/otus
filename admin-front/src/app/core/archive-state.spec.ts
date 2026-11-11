import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Me } from '@otus/shared/core/api-types';
import { ArchiveFileSaver, ArchiveResponse, toArchiveView } from './archive-api';
import { ArchiveState } from './archive-state';
import { AuthService } from './auth.service';

const RESPONSE: ArchiveResponse = {
  month: '2026-09',
  months: ['2026-10', '2026-09'],
  rows: [
    {
      user_id: 1,
      name: '교육생',
      login: 'sample',
      files: ['employment_insurance', 'employment_insurance'],
      base_docs: ['bankbook'],
      previous: ['employment_insurance'],
      submitted_at: '2026-09-21T09:12:00+09:00',
      status: 'resubmitted',
      kinds: ['supplement'],
    },
  ],
};
const PATH = '/api/admin/archive/2026-09';
const JOB = {
  job_id: '11111111-1111-4111-8111-111111111111',
  status: 'ready',
  zip_name: '2026년 9월_지원금 자료.zip',
  student_count: 1,
  pdf_count: 2,
  expires_at: '2026-09-21T09:30:00+09:00',
};

// Auth is already established by the route guard; these tests focus on archive HTTP.
const me = (role: Me['role'] = 'accountant') => ({ id: 7, role }) as Me;

describe('ArchiveState real API workflow', () => {
  let http: HttpTestingController;
  let state: ArchiveState;
  let auth: { me: ReturnType<typeof signal<Me | null>> };
  let save: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    auth = { me: signal<Me | null>(me()) };
    save = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: ArchiveFileSaver, useValue: { save } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    state = TestBed.inject(ArchiveState);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });

  function load(): void {
    state.load('2026-09');
    http.expectOne(PATH).flush(RESPONSE);
  }

  it('loads the list without creating a ZIP and preserves independent-chain duplicate documents', () => {
    load();
    expect(state.view()?.rows[0].files).toEqual(['employment_insurance', 'employment_insurance']);
    expect(state.selectedRows()).toHaveLength(1);
    expect(state.status()).toBeNull();
    expect(state.downloadStarted()).toBe(false);
    state.load('2026-09'); // options/download navigation reuses the same current view
    http.expectNone((r) => r.method === 'POST');
    http.expectNone(PATH);
  });

  it('exports only selected search matches, excluding hidden selected students', () => {
    state.load('2026-09');
    http.expectOne(PATH).flush({
      ...RESPONSE,
      rows: [
        RESPONSE.rows[0],
        {
          ...RESPONSE.rows[0],
          user_id: 2,
          name: '다른 교육생',
          login: 'another',
        },
      ],
    });
    expect(state.selected().size).toBe(2);
    state.query.set(' SAMPLE ');
    expect(state.selectedRows().map((row) => row.userId)).toEqual([1]);
    state.startExport();
    const request = http.expectOne(`${PATH}/exports`);
    expect(request.request.body.user_ids).toEqual([1]);
    expect(request.request.body.expected_pdf_count).toBe(2);
    request.flush({}, { status: 403, statusText: 'Forbidden' });
  });

  it('uses the same server filters for the rows, preview and ZIP request', () => {
    load();
    state.setCriteria({ status: ['approved'], kind: ['supplement'] });
    http.expectOne(`${PATH}?status=approved&kind=supplement`).flush({
      ...RESPONSE,
      rows: [{ ...RESPONSE.rows[0], status: 'approved', files: ['employment_insurance'] }],
    });
    expect(state.selectedRows()).toHaveLength(1);
    expect(state.selectedRows()[0].files).toHaveLength(1);
    state.startExport();
    const request = http.expectOne(`${PATH}/exports`);
    expect(request.request.body).toEqual({
      user_ids: [1],
      include_base_docs: false,
      include_previous: false,
      expected_pdf_count: 1,
      filters: { status: 'approved', kind: 'supplement' },
    });
    request.flush(
      { error: { message: '자료가 바뀌었어요.' } },
      { status: 409, statusText: 'Conflict' },
    );
    http.expectOne(`${PATH}?status=approved&kind=supplement`).flush({ ...RESPONSE, rows: [] });
    expect(state.selectedRows()).toEqual([]);
    state.retry();
    http.expectNone((r) => r.method === 'POST');
  });

  it('cancels stale filter reads, restores matches on reset and resets criteria for another month', () => {
    load();
    state.setCriteria({ status: ['approved'], kind: [] });
    const old = http.expectOne(`${PATH}?status=approved`);
    state.setCriteria({ status: ['approved'], kind: ['initial'] });
    expect(old.cancelled).toBe(true);
    http.expectOne(`${PATH}?status=approved&kind=initial`).flush({ ...RESPONSE, rows: [] });
    expect(state.startExport()).toBe(false);
    state.query.set('missing');
    state.resetFilters();
    http.expectOne(PATH).flush(RESPONSE);
    expect(state.query()).toBe('');
    expect(state.selectedRows()).toHaveLength(1);
    state.setCriteria({ status: [], kind: ['monthly'] });
    http.expectOne(`${PATH}?kind=monthly`).flush({ ...RESPONSE, rows: [] });
    state.load('2026-10');
    http.expectOne('/api/admin/archive/2026-10').flush({ ...RESPONSE, month: '2026-10', rows: [] });
    expect(state.criteria()).toEqual({ status: [], kind: [] });
    http.expectNone((r) => r.method === 'POST');
  });

  it('shares canonical multi-select filters with ZIP requests and ignores reordered choices', () => {
    load();
    const criteria = {
      status: ['resubmitted', 'approved'] as const,
      kind: ['supplement', 'monthly'] as const,
    };
    state.setCriteria(criteria);
    const path = `${PATH}?status=approved,resubmitted&kind=monthly,supplement`;
    http.expectOne(path).flush(RESPONSE);
    state.setCriteria({ status: ['approved', 'resubmitted'], kind: ['monthly', 'supplement'] });
    http.expectNone(path);
    expect(state.selectedRows()).toHaveLength(1);
    state.startExport();
    const request = http.expectOne(`${PATH}/exports`);
    expect(request.request.body.filters).toEqual({
      status: 'approved,resubmitted',
      kind: 'monthly,supplement',
    });
    expect(state.downloadCriteria()).toEqual(criteria);
    request.flush({}, { status: 403, statusText: 'Forbidden' });
  });

  it('cancels an old month read and resets selection/options on the next month', () => {
    state.load('2026-09');
    const old = http.expectOne(PATH);
    state.load('2026-10');
    expect(old.cancelled).toBe(true);
    http.expectOne('/api/admin/archive/2026-10').flush({ ...RESPONSE, month: '2026-10', rows: [] });
    expect(state.view()?.month).toBe('2026-10');
    expect(state.selected().size).toBe(0);
    expect(state.options()).toEqual({ baseDocs: false, previous: false });
  });

  it('posts only on click, polls the job and reports download only after ZIP bytes arrive', async () => {
    load();
    state.setOption('baseDocs', true);
    state.setOption('previous', true);
    expect(state.startExport()).toBe(true);
    expect(state.startExport()).toBe(false); // double-click cannot create another job
    const request = http.expectOne(`${PATH}/exports`);
    expect(request.request.body).toEqual({
      user_ids: [1],
      include_base_docs: true,
      include_previous: true,
      expected_pdf_count: 4,
    });
    expect(request.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    request.flush({ job_id: JOB.job_id, status: 'creating' });
    await vi.advanceTimersByTimeAsync(0);
    http
      .expectOne(`${PATH}/exports/${JOB.job_id}`)
      .flush({ ...JOB, status: 'creating', pdf_count: 4 });
    http.expectNone(`${PATH}/exports/${JOB.job_id}/file`);
    await vi.advanceTimersByTimeAsync(1500);
    http.expectOne(`${PATH}/exports/${JOB.job_id}`).flush({ ...JOB, pdf_count: 4 });
    expect(state.receiving()).toBe(true);
    expect(state.downloadStarted()).toBe(false);
    const file = http.expectOne(`${PATH}/exports/${JOB.job_id}/file`);
    expect(file.request.responseType).toBe('blob');
    const blob = new Blob(['PK sample'], { type: 'application/zip' });
    file.flush(blob, { headers: { 'Content-Type': 'application/zip' } });
    expect(save).toHaveBeenCalledWith(blob, JOB.zip_name);
    expect(state.downloadStarted()).toBe(true);
    expect(state.receiving()).toBe(false);
    state.retry();
    http.expectNone((r) => r.method === 'POST');
    http
      .expectOne(`${PATH}/exports/${JOB.job_id}/file`)
      .flush(blob, { headers: { 'Content-Type': 'application/zip' } });
  });

  it('uses the same idempotency key after an uncertain network failure', () => {
    load();
    state.startExport();
    const first = http.expectOne(`${PATH}/exports`);
    const key = first.request.headers.get('Idempotency-Key');
    first.error(new ProgressEvent('error'));
    expect(state.status()).toBe('failed');
    state.retry();
    const retry = http.expectOne(`${PATH}/exports`);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush(
      { error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' } },
      { status: 429, statusText: 'Too Many Requests' },
    );
  });

  it('waits for Retry-After before replaying the exact creation request and key', async () => {
    load();
    state.startExport();
    const first = http.expectOne(`${PATH}/exports`);
    const key = first.request.headers.get('Idempotency-Key');
    const body = first.request.body;
    first.flush(
      { error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' } },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '3' } },
    );
    expect(state.status()).toBe('creating');
    expect(state.error()).toBeNull();
    expect(state.retryAfter()).toBe(3);
    state.setOption('previous', true);
    state.retry();
    expect(state.startExport()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.retryAfter()).toBe(1);
    http.expectNone(`${PATH}/exports`);
    await vi.advanceTimersByTimeAsync(1000);
    const next = http.expectOne(`${PATH}/exports`);
    expect(next.request.headers.get('Idempotency-Key')).toBe(key);
    expect(next.request.body).toEqual(body);
    expect(state.retryAfter()).toBe(0);
    next.flush({ job_id: JOB.job_id, status: 'creating' });
  });

  it('retries a rate-limited ZIP file without creating another archive', async () => {
    load();
    state.startExport();
    http.expectOne(`${PATH}/exports`).flush({ job_id: JOB.job_id, status: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(`${PATH}/exports/${JOB.job_id}`).flush(JOB);
    http.expectOne(`${PATH}/exports/${JOB.job_id}/file`).flush(
      new Blob([
        JSON.stringify({
          error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' },
        }),
      ]),
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '2' } },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(state.retryAfter()).toBe(2);
    expect(state.receiving()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    http.expectNone((r) => r.method === 'POST');
    const blob = new Blob(['PK sample'], { type: 'application/zip' });
    http.expectOne(`${PATH}/exports/${JOB.job_id}/file`).flush(blob, {
      headers: { 'Content-Type': 'application/zip' },
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(blob, JOB.zip_name);
    expect(state.downloadStarted()).toBe(true);
  });

  it('cancels a delayed retry when the user cancels or changes account', async () => {
    load();
    for (const cancel of [
      () => state.cancelWait(),
      () => {
        auth.me.set({ ...me(), id: 8 });
        state.load('2026-09');
        http.expectOne(PATH).flush(RESPONSE);
      },
    ]) {
      state.startExport();
      http.expectOne(`${PATH}/exports`).flush(
        {},
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Retry-After': '2' },
        },
      );
      cancel();
      expect(state.retryAfter()).toBe(0);
      await vi.advanceTimersByTimeAsync(3000);
      http.expectNone((r) => r.method === 'POST');
      expect(save).not.toHaveBeenCalled();
    }
  });

  it('bounds automatic retries and falls back to a delay when Retry-After is invalid', async () => {
    load();
    state.startExport();
    for (let attempt = 0; attempt < 4; attempt++) {
      http
        .expectOne(`${PATH}/exports`)
        .flush(
          { error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' } },
          { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': 'invalid' } },
        );
      if (attempt < 3) {
        expect(state.retryAfter()).toBe(30);
        await vi.advanceTimersByTimeAsync(30000);
      }
    }
    expect(state.status()).toBe('failed');
    expect(state.retryAfter()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    http.expectNone((r) => r.method === 'POST');
  });

  it('refreshes changed counts on 409 and makes a fresh request after explicit retry', () => {
    load();
    state.startExport();
    const first = http.expectOne(`${PATH}/exports`);
    const key = first.request.headers.get('Idempotency-Key');
    first.flush(
      { error: { code: 'INVALID_STATE', message: '자료가 바뀌었어요.' } },
      { status: 409, statusText: 'Conflict' },
    );
    http
      .expectOne(PATH)
      .flush({ ...RESPONSE, rows: [{ ...RESPONSE.rows[0], files: ['employment_insurance'] }] });
    expect(state.error()).toBe('자료가 바뀌었어요.');
    state.retry();
    const next = http.expectOne(`${PATH}/exports`);
    expect(next.request.headers.get('Idempotency-Key')).not.toBe(key);
    expect(next.request.body.expected_pdf_count).toBe(1);
    next.flush(
      { error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' } },
      { status: 429, statusText: 'Too Many Requests' },
    );
  });

  it('shows expired jobs and creates no replacement until the user retries', async () => {
    load();
    state.startExport();
    http.expectOne(`${PATH}/exports`).flush({ job_id: JOB.job_id, status: 'creating' });
    await vi.advanceTimersByTimeAsync(0);
    http
      .expectOne(`${PATH}/exports/${JOB.job_id}`)
      .flush(
        { error: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' } },
        { status: 404, statusText: 'Not Found' },
      );
    expect(state.expired()).toBe(true);
    expect(state.error()).toContain('만료');
    http.expectNone((r) => r.method === 'POST');
    expect(save).not.toHaveBeenCalled();
  });

  it('blocks non-accountants and honors a fresh server 403', () => {
    auth.me.set(me('operator'));
    load();
    expect(state.startExport()).toBe(false);
    http.expectNone((r) => r.method === 'POST');
    auth.me.set(me());
    state.startExport();
    http
      .expectOne(`${PATH}/exports`)
      .flush(
        { error: { code: 'FORBIDDEN', message: '권한이 없습니다.' } },
        { status: 403, statusText: 'Forbidden' },
      );
    expect(state.canDownload()).toBe(false);
    expect(state.error()).toContain('회계');
  });

  it('prunes selected users removed by a refresh', () => {
    load();
    state.load('2026-09', true);
    http.expectOne(PATH).flush({ ...RESPONSE, rows: [] });
    expect(state.selected().size).toBe(0);
    expect(state.startExport()).toBe(false);
  });

  it('decodes a JSON Blob error from the ZIP endpoint without claiming a download', async () => {
    load();
    state.startExport();
    http.expectOne(`${PATH}/exports`).flush({ job_id: JOB.job_id, status: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(`${PATH}/exports/${JOB.job_id}`).flush(JOB);
    http.expectOne(`${PATH}/exports/${JOB.job_id}/file`).flush(
      new Blob([JSON.stringify({ error: { code: 'NOT_FOUND', message: '만료되었습니다.' } })], {
        type: 'application/json',
      }),
      { status: 404, statusText: 'Not Found' },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(state.expired()).toBe(true);
    expect(state.downloadStarted()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('clears another logged-in staff member’s cached data before a new read', () => {
    load();
    auth.me.set({ ...me(), id: 8 });
    state.load('2026-09');
    expect(state.view()).toBeNull();
    expect(state.selected().size).toBe(0);
    http.expectOne(PATH).flush({ ...RESPONSE, rows: [] });
    expect(state.view()?.rows).toEqual([]);
  });
});

it('keeps an empty requested month selectable without inventing dates', () => {
  const view = toArchiveView({ ...RESPONSE, months: [], rows: [] });
  expect(view.months).toEqual(['2026-09']);
  expect(view.rows).toEqual([]);
});
