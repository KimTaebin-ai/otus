import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PeriodList, SubmissionPeriod } from '../core/periods-api';
import { Periods } from './periods';

const NEXT: SubmissionPeriod = {
  target_month: '2026-11',
  opens_at: null,
  closes_at: null,
  version: null,
  state: 'not_set',
};
const SAVED: SubmissionPeriod = {
  ...NEXT,
  opens_at: '2026-11-21T09:00:00+09:00',
  closes_at: '2026-12-01T00:00:00+09:00',
  version: 1,
  state: 'upcoming',
};
const LIST: PeriodList = { current_month: '2026-10', year: 2026, can_manage: true, items: [NEXT] };

describe('submission period settings', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'periods', component: Periods }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create('/periods?month=2026-11');
    el = harness.routeNativeElement as HTMLElement;
  });
  afterEach(() => {
    harness.fixture.destroy();
    http.verify({ ignoreCancelled: true });
  });

  async function render(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  async function load(page = LIST): Promise<void> {
    http.expectOne('/api/admin/cycles?year=2026').flush(page);
    if (page.items.some((row) => row.target_month === '2026-11')) {
      http.expectOne('/api/admin/cycles/2026-11/history').flush([]);
    }
    await render();
  }
  async function input(id: string, value: string): Promise<void> {
    const control = el.querySelector<HTMLInputElement>(id)!;
    control.value = value;
    control.dispatchEvent(new Event('input'));
    await render();
  }
  function submit(): void {
    el.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  it('adds a future period, persists KST times and reloads the saved history', async () => {
    await load();
    expect(el.querySelector<HTMLInputElement>('#period-end')!.value).toBe('2026-11-30T23:59:59');
    await input('#period-start', '2026-11-21T09:00');
    submit();
    const req = http.expectOne('/api/admin/cycles/2026-11');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      opens_at: '2026-11-21T00:00:00.000Z',
      closes_at: '2026-11-30T15:00:00.000Z',
      expected_version: null,
    });
    submit();
    http.expectNone((r) => r.method === 'PUT');
    req.flush(SAVED);
    http.expectOne('/api/admin/cycles/2026-11/history').flush([
      {
        ...SAVED,
        actor_name: '운영담당',
        actor_role: 'operator',
        created_at: '2026-10-18T10:00:00+09:00',
        previous_opens_at: null,
        previous_closes_at: null,
      },
    ]);
    await render();
    expect(el.textContent).toContain('2026년 11월 제출 기간을 저장했습니다.');
    expect(el.textContent).toContain('운영담당');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('reloads conflicts instead of overwriting another editor and uses the latest version', async () => {
    await load({ ...LIST, items: [SAVED] });
    await input('#period-start', '2026-11-20T09:00');
    submit();
    const req = http.expectOne('/api/admin/cycles/2026-11');
    expect(req.request.body.expected_version).toBe(1);
    req.flush({}, { status: 409, statusText: 'Conflict' });
    http
      .expectOne('/api/admin/cycles?year=2026')
      .flush({ ...LIST, items: [{ ...SAVED, version: 2, opens_at: '2026-11-19T09:00:00+09:00' }] });
    http.expectOne('/api/admin/cycles/2026-11/history').flush([]);
    await render();
    expect(el.querySelector<HTMLInputElement>('#period-start')!.value).toBe('2026-11-19T09:00');
    expect(el.textContent).toContain('다른 담당자가 기간을 변경했습니다');
    http.expectNone((r) => r.method === 'PUT');
    await input('#period-start', '2026-11-20T09:00');
    submit();
    const retry = http.expectOne('/api/admin/cycles/2026-11');
    expect(retry.request.body.expected_version).toBe(2);
    retry.flush({}, { status: 403, statusText: 'Forbidden' });
    await render();
    expect(el.querySelector('button[type="submit"]')).toBeNull();
  });

  it('prevents edits for accountants and past months', async () => {
    await load({ ...LIST, can_manage: false });
    expect(el.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
    submit();
    http.expectNone((r) => r.method === 'PUT');
    expect(el.textContent).toContain('운영 담당자와 관리자가');
  });

  it('keeps historical months read-only even for managers', async () => {
    await load();
    await harness.navigateByUrl('/periods?month=2026-09');
    http
      .expectOne('/api/admin/cycles?year=2026')
      .flush({ ...LIST, items: [{ ...SAVED, target_month: '2026-09', state: 'closed' }] });
    http.expectOne('/api/admin/cycles/2026-09/history').flush([]);
    await render();
    submit();
    http.expectNone((r) => r.method === 'PUT');
    expect(el.textContent).toContain('지난달 기간은 조회만 가능합니다.');
  });

  it('does not submit reversed or cross-month periods', async () => {
    await load();
    for (const end of ['2026-10-31T23:59', '2026-12-01T00:00']) {
      await input('#period-end', end);
      submit();
      http.expectNone((r) => r.method === 'PUT');
      expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    }
  });

  it('cancels stale history when switching months and shows history failures', async () => {
    http.expectOne('/api/admin/cycles?year=2026').flush(LIST);
    const old = http.expectOne('/api/admin/cycles/2026-11/history');
    await harness.navigateByUrl('/periods?month=2026-12');
    expect(old.cancelled).toBe(true);
    http
      .expectOne('/api/admin/cycles?year=2026')
      .flush({ ...LIST, items: [{ ...NEXT, target_month: '2026-12' }] });
    http
      .expectOne('/api/admin/cycles/2026-12/history')
      .flush({ error: { message: '이력 조회 실패' } }, { status: 500, statusText: 'Error' });
    await render();
    expect(el.textContent).toContain('이력 조회 실패');
    expect(el.querySelector<HTMLInputElement>('#period-start')!.value).toBe('2026-12-01T00:00');
  });
  it('loads the selected year and restores its editor on browser navigation', async () => {
    await load();
    await harness.navigateByUrl('/periods?month=2027-01');
    http
      .expectOne('/api/admin/cycles?year=2027')
      .flush({ ...LIST, year: 2027, items: [{ ...NEXT, target_month: '2027-01' }] });
    http.expectOne('/api/admin/cycles/2027-01/history').flush([]);
    await render();
    expect(el.textContent).toContain('2027년 1월 제출 기간');
    expect(el.querySelector<HTMLInputElement>('#period-start')!.value).toBe('2027-01-01T00:00');
    await harness.navigateByUrl('/periods?month=2026-11');
    await load();
    expect(el.textContent).toContain('2026년 11월 제출 기간');
  });

  it('keeps the new month visible if the URL changes while the old month is saving', async () => {
    await load();
    await input('#period-start', '2026-11-21T09:00');
    submit();
    const save = http.expectOne('/api/admin/cycles/2026-11');
    await harness.navigateByUrl('/periods?month=2027-01');
    expect(el.querySelector('#period-start')).toBeNull();
    save.flush(SAVED);
    http.expectOne('/api/admin/cycles?year=2027').flush({
      ...LIST,
      year: 2027,
      items: [{ ...NEXT, target_month: '2027-01' }],
    });
    http.expectOne('/api/admin/cycles/2027-01/history').flush([]);
    await render();
    expect(el.textContent).toContain('2027년 1월 제출 기간');
    expect(el.textContent).not.toContain('2026년 11월 제출 기간을 저장했습니다.');
  });
});
