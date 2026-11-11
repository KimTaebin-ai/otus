import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BankAccount, BankAccountState, Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { recentChanges } from '../core/profile';
import { Settings } from './settings';

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

function account(over: Partial<BankAccount> = {}): BankAccount {
  return {
    bank: '카카오뱅크',
    account_number_masked: '•••• 1234',
    status: 'approved',
    requested_at: '2026-02-20T10:00:00+09:00',
    decided_at: '2026-02-20T11:00:00+09:00',
    decision_note: null,
    bankbook: { file_id: 'f1', original_name: '통장사본_동민.pdf', size: 634880 },
    ...over,
  };
}

const NONE: BankAccountState = { current: null, pending: null, last_rejected: null };

describe('Settings (U06)', () => {
  function setup(me: Me = ME) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(AuthService).setMe(me);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('fills the account card from the current account', () => {
    const { fixture, http, el } = setup();
    http.expectOne('/api/me/bank-account').flush({ ...NONE, current: account() });
    fixture.detectChanges();
    const bank = el.querySelector<HTMLSelectElement>('#bank')!;
    expect(bank.value).toBe('카카오뱅크');
    const number = el.querySelector<HTMLInputElement>('#account-number')!;
    expect(number.value).toBe('');
    expect(number.placeholder).toBe('•••• 1234');
    expect(number.getAttribute('autocomplete')).toBe('off');
    expect(el.querySelector('.box')?.textContent?.trim()).toBe('동민');
    const t = text(el);
    expect(t).toContain('통장사본_동민.pdf · 620 KB');
    expect(t).toContain('새 사본 올리기');
    expect(t).toContain('최종 변경 2026.02.20');
    expect(t).toContain('등록 완료');
    expect(t).toContain('현재 · 미취업');
    expect(text(el)).not.toContain('아직 등록된 계좌가 없어요.');
  });

  it('says so when no account is approved yet', () => {
    const { fixture, http, el } = setup({ ...ME, initial_submitted: false });
    http.expectOne('/api/me/bank-account').flush(NONE);
    fixture.detectChanges();
    expect(text(el)).toContain('아직 등록된 계좌가 없어요.');
    expect(text(el)).toContain('미등록');
    expect(text(el)).toContain('아직 변경한 내용이 없어요.');
    expect(el.querySelector<HTMLInputElement>('#account-number')?.placeholder).toBe(
      '계좌번호를 입력해주세요',
    );
    expect(text(el)).toContain('통장사본 PDF를 올려주세요');
  });

  it('saves employment at once, updates me, and ignores clicks while saving', () => {
    const { fixture, http, el } = setup();
    http.expectOne('/api/me/bank-account').flush(NONE);
    const radios = el.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    radios[1].click();
    fixture.detectChanges();
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(radios[0].disabled).toBe(true);
    radios[0].click();
    const req = http.expectOne('/api/me/employment');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ employed: true });
    req.flush({ ...ME, employed: true, employment_updated_at: '2026-10-17T10:00:00+09:00' });
    fixture.detectChanges();
    expect(TestBed.inject(AuthService).me()?.employed).toBe(true);
    expect(text(el)).toContain('✓ 취업 중으로 저장했어요. 이제 미제출 안내는 보내지 않을게요.');
    expect(text(el)).toContain('현재 · 취업 중');
    expect(text(el)).toContain('2026.10.17취업 상태 · 취업 중으로 변경');
    http.verify();
  });

  it('puts the previous choice back and shows the error when saving fails', () => {
    const { fixture, http, el } = setup({ ...ME, employed: true });
    http.expectOne('/api/me/bank-account').flush(NONE);
    const radios = el.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[0].click();
    http
      .expectOne('/api/me/employment')
      .flush(
        { error: { code: 'INTERNAL_ERROR', message: '서버 오류' } },
        { status: 500, statusText: 'x' },
      );
    fixture.detectChanges();
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(TestBed.inject(AuthService).me()?.employed).toBe(true);
    expect(el.querySelector('.notice.error')?.textContent).toContain('서버 오류');
  });
});

describe('recentChanges', () => {
  it('lists employment and bank requests newest first', () => {
    const me: Me = { ...ME, employed: true, employment_updated_at: '2026-09-20T09:00:00+09:00' };
    const items = recentChanges(me, {
      current: account(),
      pending: account({
        status: 'pending',
        decided_at: null,
        requested_at: '2026-09-22T10:10:00+09:00',
      }),
      last_rejected: null,
    });
    expect(items.map((i) => i.summary)).toEqual([
      '계좌 변경 · 검토 대기',
      '취업 상태 · 취업 중으로 변경',
      '계좌 변경 · 승인 완료',
    ]);
  });
});
