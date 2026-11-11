import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';

import { Cycle, DocType, IDEMPOTENCY_HEADER, Submission, SubmissionFile } from '../core/api.models';
import { AccountDraft } from '../core/account-draft';
import { AuthService } from '../core/auth.service';
import { Initial } from './initial';

/** GET /api/cycles/current (api.md) */
const cycle: Cycle = {
  target_month: '2026-10',
  state: 'open',
  opens_at: '2026-10-01T00:00:00+09:00',
  closes_at: '2026-11-01T00:00:00+09:00',
  d_day: 15,
  issued_after: '2026-10-01',
};

@Component({ template: '' })
class Home {}

const TYPES: DocType[] = ['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'];

function file(type: DocType): SubmissionFile {
  return {
    file_id: `f-${type}`,
    doc_type: type,
    original_name: `${type}.pdf`,
    size: 2048,
    uploaded_at: '2026-10-16T21:12:00+09:00',
  };
}

const draft: Submission = {
  id: 's-1',
  kind: 'initial',
  target_month: '2026-10',
  status: 'draft',
  parent_id: null,
  submitted_at: null,
  review_comment: null,
  required_doc_types: TYPES,
  files: TYPES.slice(0, 3).map(file),
  created_at: '2026-10-16T21:10:00+09:00',
};

describe('Initial (U02)', () => {
  let fixture: ComponentFixture<Initial>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'home', component: Home }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setMe({
      id: 1,
      login: 'dongmin',
      display_name: '동민',
      role: 'student',
      is_demo: true,
      study_hours: 0,
      employed: false,
      employment_updated_at: null,
      initial_submitted: false,
    });
    fixture = TestBed.createComponent(Initial);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    http.expectOne('/api/cycles/current').flush(cycle);
    http.expectOne('/api/submissions').flush(draft);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const submitButton = () =>
    [...el.querySelectorAll<HTMLButtonElement>('.bar button')].find(
      (b) => b.textContent?.trim() === '첫 서류 제출하기',
    )!;

  async function uploadLast(): Promise<void> {
    fixture.debugElement
      .queryAll((d) => d.name === 'app-upload-slot')[3]
      .triggerEventHandler('uploaded', file('employment_insurance'));
    await fixture.whenStable();
  }

  function fillAccount(): void {
    const account = TestBed.inject(AccountDraft);
    account.bank.set('신한은행');
    account.number.set('110-123-456789');
    account.file.set(new File(['%PDF-1.7'], 'bankbook.pdf', { type: 'application/pdf' }));
    fixture.detectChanges();
  }

  /** The 계좌 request that goes out before the final submit (answers it, returns its form) */
  function flushAccount(): FormData {
    const req = http.expectOne('/api/me/bank-account');
    expect(req.request.method).toBe('PUT');
    req.flush({ current: null, pending: null, last_rejected: null });
    return req.request.body as FormData;
  }

  it('marks what is missing in red when submit is clicked, and sends nothing', async () => {
    expect(submitButton().disabled).toBe(false);
    expect(el.querySelector('.row.invalid')).toBeNull();
    submitButton().click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.row.invalid').length).toBe(1);
    expect(el.querySelector('#bank')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#account-number')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('.status.error')?.textContent).toContain('빨간색');
    http.expectNone('/api/me/bank-account');
    await uploadLast();
    expect(el.querySelector('.row.invalid')).toBeNull();
    fillAccount();
    expect(el.querySelector('#account-number')?.getAttribute('aria-invalid')).toBe('false');
    expect(el.querySelector('.status.error')).toBeNull();
  });

  it('asks for 은행, 계좌번호 and 예금주; 예금주 starts as the name', async () => {
    await uploadLast();
    expect(el.querySelector<HTMLInputElement>('#holder')!.value).toBe('동민');
    fillAccount();
    const holder = el.querySelector<HTMLInputElement>('#holder')!;
    holder.value = '';
    holder.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    submitButton().click();
    fixture.detectChanges();
    expect(holder.getAttribute('aria-invalid')).toBe('true');
    TestBed.inject(AccountDraft).number.set('12');
    holder.value = '김동민';
    holder.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(holder.getAttribute('aria-invalid')).toBe('false');
    expect(el.querySelector('#account-number')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('sends the 계좌 with the 통장사본 before the final submit', async () => {
    await uploadLast();
    fillAccount();
    submitButton().click();
    const form = flushAccount();
    expect(form.get('bank')).toBe('신한은행');
    expect(form.get('account_number')).toBe('110123456789');
    expect((form.get('file') as File).name).toBe('bankbook.pdf');
    await fixture.whenStable();
    http.expectOne('/api/submissions/s-1/finalize').flush(draft);
    await fixture.whenStable();
    expect(TestBed.inject(AccountDraft).number()).toBe('');
  });

  it('downloads the stored 통장사본 when the page was reloaded after uploading it', async () => {
    await uploadLast();
    fillAccount();
    TestBed.inject(AccountDraft).file.set(null);
    submitButton().click();
    http.expectOne('/api/files/f-bankbook').flush(new Blob(['%PDF-1.7']));
    await fixture.whenStable();
    const form = flushAccount();
    expect((form.get('file') as File).name).toBe('bankbook.pdf');
    http.expectOne('/api/submissions/s-1/finalize').flush(draft);
  });

  it('shows the period as dates only, ending on the last day (closes_at is exclusive)', () => {
    const box = el.querySelector('app-info-box')?.textContent ?? '';
    expect(box).toContain('10.01 – 10.31');
    expect(box).not.toContain('00:00');
    expect(box).not.toContain('11.01');
  });

  it('reuses the idempotency key on retry and makes a new one after an upload', async () => {
    await uploadLast();
    fillAccount();
    submitButton().click();
    flushAccount();
    await fixture.whenStable();
    const first = http.expectOne('/api/submissions/s-1/finalize');
    const key = first.request.headers.get(IDEMPOTENCY_HEADER);
    expect(key).toBeTruthy();
    first.flush(null, { status: 0, statusText: 'offline' });
    await fixture.whenStable();

    submitButton().click();
    const retry = http.expectOne('/api/submissions/s-1/finalize');
    expect(retry.request.headers.get(IDEMPOTENCY_HEADER)).toBe(key);
    retry.flush(null, { status: 500, statusText: 'error' });
    await fixture.whenStable();

    await uploadLast();
    submitButton().click();
    const fresh = http.expectOne('/api/submissions/s-1/finalize');
    expect(fresh.request.headers.get(IDEMPOTENCY_HEADER)).not.toBe(key);
    fresh.flush({ ...draft, status: 'pending_review', submitted_at: '2026-10-16T21:20:00+09:00' });
    await fixture.whenStable();
    expect(TestBed.inject(AuthService).me()?.initial_submitted).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/home');
  });
});

describe('Initial (U02) outside the submission period', () => {
  /** `draftResponse` null means the draft call isn't expected at all. */
  async function render(
    period: Cycle,
    draftResponse: Submission | 'closed' | null,
  ): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Initial);
    fixture.detectChanges();
    http.expectOne('/api/cycles/current').flush(period);
    if (draftResponse === 'closed') {
      http
        .expectOne('/api/submissions')
        .flush(
          { error: { code: 'CYCLE_CLOSED', message: '접수 기간이 아닙니다.' } },
          { status: 422, statusText: 'Unprocessable Entity' },
        );
    } else if (draftResponse) {
      http.expectOne('/api/submissions').flush(draftResponse);
    }
    await fixture.whenStable();
    fixture.detectChanges();
    http.verify();
    return fixture.nativeElement as HTMLElement;
  }

  const bar = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.bar button')];

  it('shows the closed design: amber box, 기간 종료 rows, one disabled button (final U02-initial-closed)', async () => {
    // all four files there: only the period can keep submit disabled
    const el = await render(
      { ...cycle, target_month: '2026-09', state: 'closed' },
      {
        ...draft,
        files: TYPES.map(file),
      },
    );
    expect(el.querySelector('app-info-box')?.textContent).toContain(
      '9월 최초 서류 접수가 마감되었어요.',
    );
    expect(bar(el).map((b) => b.textContent?.trim())).toEqual(['제출 기간 종료']);
    expect(bar(el)[0].disabled).toBe(true);
    expect(el.querySelector('.bar .status')?.textContent).toContain(
      '최초 등록을 완료한 이후 대시보드를 이용할 수 있습니다.',
    );
  });

  it('labels empty rows 기간 종료 and shows no red error when closed without a draft', async () => {
    const el = await render({ ...cycle, state: 'closed' }, 'closed');
    expect(el.querySelectorAll('app-upload-slot .action.muted')).toHaveLength(4);
    expect(el.querySelector('app-upload-slot')?.textContent).toContain('기간 종료');
    expect(el.querySelector('.load-error')).toBeNull();
  });

  it('does not create a draft before the period opens (it would be a 422)', async () => {
    const el = await render({ ...cycle, state: 'upcoming' }, null);
    expect(bar(el)[0].disabled).toBe(true);
    expect(el.textContent).toContain('접수 시작 전');
  });

  it('handles a month with no period set without creating a draft', async () => {
    const el = await render(
      { ...cycle, state: 'not_set', opens_at: null, closes_at: null, d_day: null },
      null,
    );
    expect(bar(el)[0].disabled).toBe(true);
    expect(el.querySelector('app-info-box')).not.toBeNull();
  });
});
