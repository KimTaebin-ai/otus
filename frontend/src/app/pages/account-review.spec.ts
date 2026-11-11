import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { AccountDraft } from '../core/account-draft';
import { Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { accountDraftGuard } from '../core/guards';
import { AccountReview } from './account-review';

const ME: Me = {
  id: 1,
  login: 'dongmin',
  display_name: '동민',
  role: 'student',
  is_demo: true,
  study_hours: 0,
  employed: false,
  employment_updated_at: null,
  initial_submitted: true,
};

describe('Account review', () => {
  function setup(fill = true) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(AuthService).setMe(ME);
    const draft = TestBed.inject(AccountDraft);
    if (fill) {
      draft.bank.set('우리은행');
      draft.number.set('1002-123-454567');
      draft.file.set(new File(['%PDF-1.4'], '통장사본_동민_변경.pdf', { type: 'application/pdf' }));
    }
    const http = TestBed.inject(HttpTestingController);
    return { draft, http };
  }

  function open(http: HttpTestingController, pending: unknown = null) {
    const fixture = TestBed.createComponent(AccountReview);
    fixture.detectChanges();
    http.expectOne('/api/me/bank-account').flush({ current: null, pending, last_rejected: null });
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('goes back to /settings when there is nothing in memory (after a reload)', () => {
    setup(false);
    const result = TestBed.runInInjectionContext(() => accountDraftGuard({} as never, {} as never));
    expect(result instanceof UrlTree && TestBed.inject(Router).serializeUrl(result)).toBe(
      '/settings',
    );
  });

  it('shows the typed values read-only with the number masked', () => {
    const { http } = setup();
    const { el } = open(http);
    const t = text(el);
    expect(t).toContain('계좌 변경을 검토 요청해주세요');
    expect(t).toContain('승인 전까지 기존 지급 계좌가 유지돼요.');
    expect(t).toContain('우리은행');
    expect(t).toContain('•••• •••• 4567');
    expect(t).not.toContain('100212345');
    expect(t).toContain('동민');
    expect(t).toContain('통장사본_동민_변경.pdfPDF첨부 완료');
    expect(t).toContain('승인 결과는 서비스 알림으로 받아요.');
    expect(t).not.toContain('이메일');
    expect(el.querySelector('input')).toBeNull();
  });

  it('says a pending request is replaced', () => {
    const { http } = setup();
    const { el } = open(http, {
      bank: '카카오뱅크',
      account_number_masked: '•••• 1111',
      status: 'pending',
      requested_at: '2026-10-17T10:00:00+09:00',
      decided_at: null,
      decision_note: null,
      bankbook: null,
    });
    expect(text(el)).toContain('이전 변경 요청이 대체돼요');
    expect(text(el)).toContain('카카오뱅크 •••• 1111');
  });

  it('sends one PUT with the digits and file, shows progress, clears the draft and moves on', () => {
    const { draft, http } = setup();
    const { fixture, el } = open(http);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const submit = el.querySelector<HTMLButtonElement>('.actions button')!;
    submit.click();
    submit.click();
    fixture.detectChanges();
    const req = http.expectOne('/api/me/bank-account');
    expect(req.request.method).toBe('PUT');
    const form = req.request.body as FormData;
    expect(form.get('bank')).toBe('우리은행');
    expect(form.get('account_number')).toBe('1002123454567');
    expect((form.get('file') as File).name).toBe('통장사본_동민_변경.pdf');
    expect(submit.disabled).toBe(true);
    req.event({ type: 1, loaded: 50, total: 100 });
    fixture.detectChanges();
    expect(el.querySelector('.progress')?.getAttribute('aria-valuenow')).toBe('50');
    req.flush({ current: null, pending: null, last_rejected: null });
    expect(draft.file()).toBeNull();
    expect(draft.number()).toBe('');
    expect(navigate).toHaveBeenCalledWith('/settings/account/requested');
  });

  it('keeps the draft and allows a retry after an error', () => {
    const { draft, http } = setup();
    const { fixture, el } = open(http);
    const submit = el.querySelector<HTMLButtonElement>('.actions button')!;
    submit.click();
    http
      .expectOne('/api/me/bank-account')
      .flush(
        {
          error: {
            code: 'INVALID_STATE',
            message: '계좌 변경 요청은 하루 5번까지 할 수 있습니다.',
          },
        },
        { status: 409, statusText: 'x' },
      );
    fixture.detectChanges();
    expect(el.querySelector('.error')?.textContent).toContain('하루 5번');
    expect(submit.disabled).toBe(false);
    expect(draft.ready()).toBe(true);
  });

  it('cancel goes to /settings and keeps what was typed', () => {
    const { draft, http } = setup();
    const { el } = open(http);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelectorAll<HTMLButtonElement>('.actions button')[1].click();
    expect(navigate).toHaveBeenCalledWith('/settings');
    expect(draft.ready()).toBe(true);
  });
});
