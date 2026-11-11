import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Me } from '@otus/shared/core/api-types';
import { AuthService } from '../core/auth.service';
import { Archive } from './archive';
import { ArchiveOptionsPage } from './archive-options';
import { ArchiveDownload } from './archive-download';

const RESPONSE = {
  month: '2026-09',
  months: ['2026-10', '2026-09'],
  rows: [
    {
      user_id: 3,
      name: '자료교육생',
      login: 'demo',
      files: ['employment_insurance'],
      base_docs: ['id_card', 'resident_abstract', 'bankbook'],
      previous: [],
      submitted_at: '2026-09-21T09:12:00+09:00',
      status: 'pending_review',
      kinds: ['monthly'],
    },
  ],
};

describe('Archive real routes', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { me: signal({ id: 7, role: 'accountant' } as Me) } },
        provideRouter([
          { path: 'archive/:month', component: Archive },
          { path: 'archive/:month/options', component: ArchiveOptionsPage },
          { path: 'archive/:month/download', component: ArchiveDownload },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    http.verify({ ignoreCancelled: true });
  });

  const element = () => harness.routeNativeElement as HTMLElement;

  async function open(path: string): Promise<void> {
    harness = await RouterTestingHarness.create(path);
    http.expectOne('/api/admin/archive/2026-09').flush(RESPONSE);
    harness.detectChanges();
  }

  it('shows server rows and loads another month when the route changes', async () => {
    await open('/archive/2026-09');
    expect(element().textContent).toContain('자료교육생');
    expect(element().textContent).not.toContain('관리자 API가 준비되면');
    expect(element().querySelector('a.name')?.getAttribute('href')).toBe('/users/3');
    await harness.navigateByUrl('/archive/2026-10');
    http.expectOne('/api/admin/archive/2026-10').flush({ ...RESPONSE, month: '2026-10', rows: [] });
    harness.detectChanges();
    expect(element().textContent).toContain('10월 자료함');
    expect(element().textContent).toContain('이 달에 접수된 제출이 없어요.');
    http.expectNone((request) => request.method === 'POST');
  });

  it('opens options after refresh with actual data without creating an export', async () => {
    await open('/archive/2026-09/options');
    expect(element().textContent).toContain('자료교육생_demo');
    expect(element().textContent).toContain('이 구성으로 내려받기');
    http.expectNone((request) => request.method === 'POST');
  });

  it('keeps filtered people and files consistent from the table through options to export', async () => {
    await open('/archive/2026-09');
    const details = element().querySelector('details')!;
    expect(details.open).toBe(false);
    details.open = true;
    const status = element().querySelector<HTMLInputElement>(
      'input[name="archive-status"][value="approved"]',
    )!;
    status.click();
    http.expectOne('/api/admin/archive/2026-09?status=approved').flush({
      ...RESPONSE,
      rows: [{ ...RESPONSE.rows[0], status: 'approved' }],
    });
    harness.detectChanges();
    expect(element().textContent).toContain('다운로드 대상 1명');
    element()
      .querySelector<HTMLInputElement>('input[name="archive-status"][value="pending_review"]')!
      .click();
    http.expectOne('/api/admin/archive/2026-09?status=approved,pending_review').flush({
      ...RESPONSE,
      rows: [{ ...RESPONSE.rows[0], status: 'approved' }],
    });
    harness.detectChanges();
    expect(details.open).toBe(true);
    details.open = false;
    expect(element().textContent).toContain('적용 조건: 서류 승인, 검토 중');
    expect(element().querySelectorAll('input[name="archive-status"]:checked')).toHaveLength(2);
    http.expectNone((request) => request.method === 'GET');
    const search = element().querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = '없는사람';
    search.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(element().textContent).toContain('조건에 맞는 교육생이 없어요.');
    expect(
      [...element().querySelectorAll('button')].find((b) => b.textContent.includes('선택한 0명'))
        ?.disabled,
    ).toBe(true);
    search.value = 'demo';
    search.dispatchEvent(new Event('input'));
    await harness.navigateByUrl('/archive/2026-09/options');
    harness.detectChanges();
    expect(element().textContent).toContain('적용 조건: 서류 승인');
    expect(element().textContent).toContain('자료교육생_demo');
    [...element().querySelectorAll('button')]
      .find((b) => b.textContent.includes('이 구성으로 내려받기'))!
      .click();
    const request = http.expectOne('/api/admin/archive/2026-09/exports');
    expect(request.request.body.user_ids).toEqual([3]);
    expect(request.request.body.filters).toEqual({ status: 'approved,pending_review' });
    expect(request.request.body.expected_pdf_count).toBe(1);
    request.flush(
      {},
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '30' } },
    );
  });

  it('clears checkbox criteria on reset and treats an unchecked group as all', async () => {
    await open('/archive/2026-09');
    const monthly = element().querySelector<HTMLInputElement>(
      'input[name="archive-kind"][value="monthly"]',
    )!;
    monthly.click();
    http.expectOne('/api/admin/archive/2026-09?kind=monthly').flush(RESPONSE);
    harness.detectChanges();
    monthly.click();
    http.expectOne('/api/admin/archive/2026-09').flush(RESPONSE);
    harness.detectChanges();
    expect(element().querySelectorAll('input[name="archive-kind"]:checked')).toHaveLength(0);
    monthly.click();
    http.expectOne('/api/admin/archive/2026-09?kind=monthly').flush(RESPONSE);
    harness.detectChanges();
    [...element().querySelectorAll('button')]
      .find((button) => button.textContent.includes('필터 초기화'))!
      .click();
    http.expectOne('/api/admin/archive/2026-09').flush(RESPONSE);
    harness.detectChanges();
    expect(monthly.checked).toBe(false);
    expect(element().textContent).toContain('다운로드 대상 1명');
  });

  it('visiting the download URL never creates or claims to start a download', async () => {
    await open('/archive/2026-09/download');
    expect(element().textContent).toContain('아직 ZIP을 만들지 않았어요.');
    expect(element().textContent).not.toContain('다운로드를 시작했어요');
    expect(element().textContent).not.toContain('브라우저의 다운로드 목록에서');
    http.expectNone((request) => request.method === 'POST' || request.url.endsWith('/file'));
  });

  it('shows a cancellable wait instead of failure after a 429 response', async () => {
    await open('/archive/2026-09/download');
    [...element().querySelectorAll('button')]
      .find((b) => b.textContent.includes('이 구성으로 내려받기'))!
      .click();
    http.expectOne('/api/admin/archive/2026-09/exports').flush(
      {},
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '45' },
      },
    );
    harness.detectChanges();
    expect(element().textContent).toContain('다운로드 순서를 기다리고 있어요');
    expect(element().textContent).toContain('45초 후 자동으로 다시 시도');
    expect(element().textContent).not.toContain('다운로드를 완료하지 못했어요');
    const cancel = [...element().querySelectorAll('button')].find((b) =>
      b.textContent.includes('대기 취소'),
    )!;
    cancel.click();
    harness.detectChanges();
    expect(element().textContent).not.toContain('45초 후 자동으로 다시 시도');
  });

  it('shows a list permission error and a retry button instead of an empty placeholder', async () => {
    harness = await RouterTestingHarness.create('/archive/2026-09');
    http
      .expectOne('/api/admin/archive/2026-09')
      .flush(
        { error: { code: 'FORBIDDEN', message: '자료함을 볼 권한이 없습니다.' } },
        { status: 403, statusText: 'Forbidden' },
      );
    harness.detectChanges();
    expect(element().querySelector('[role="alert"]')?.textContent).toContain(
      '자료함을 볼 권한이 없습니다.',
    );
    expect(element().querySelector('button')?.textContent).toContain('다시 불러오기');
  });
});
