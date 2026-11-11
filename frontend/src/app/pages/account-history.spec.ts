import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BankAccount, Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { AccountHistory } from './account-history';

const ME: Me = {
  id: 1,
  login: 'dongmin',
  display_name: '동민',
  role: 'student',
  is_demo: true,
  study_hours: 0,
  employed: false,
  employment_updated_at: '2026-09-01T09:30:00+09:00',
  initial_submitted: true,
};

const approved: BankAccount = {
  bank: '카카오뱅크',
  account_number_masked: '•••• 1234',
  status: 'approved',
  requested_at: '2026-02-20T10:00:00+09:00',
  decided_at: '2026-02-20T11:00:00+09:00',
  decision_note: null,
  bankbook: { file_id: 'f1', original_name: '통장사본_동민.pdf', size: 1000 },
};

describe('Account history (U06)', () => {
  function setup(state: object) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(AuthService).setMe(ME);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AccountHistory);
    fixture.detectChanges();
    http.expectOne('/api/me/bank-account').flush(state);
    fixture.detectChanges();
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('shows the account, name, employment toggle, notice and the change table', () => {
    const { el } = setup({
      current: approved,
      pending: {
        ...approved,
        bank: '우리은행',
        account_number_masked: '•••• 4567',
        status: 'pending',
        decided_at: null,
        requested_at: '2026-09-22T10:10:00+09:00',
      },
      last_rejected: null,
    });
    const t = text(el);
    expect(t).toContain('내 정보와 변경 이력');
    expect(t).toContain('카카오뱅크 · •••• 1234 예금주 동민 통장사본_동민.pdf');
    expect(t).toContain('계좌사본 교체');
    expect(t).toContain('현재 이름 · 동민 인트라 ID · dongmin');
    expect(t).toContain('취업 상태는 선택하면 바로 저장돼요');
    expect(el.querySelectorAll('[role="radio"]').length).toBe(2);
    const rows = [...el.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim()),
    );
    expect(rows[0]).toEqual(['09.22 10:10', '계좌 변경', '검토 대기']);
    expect(rows[1]).toEqual(['09.01 09:30', '취업 상태 · 미취업', '저장 완료']);
    expect(rows[2]).toEqual(['02.20 11:00', '계좌 변경', '승인 완료']);
  });

  it('hides the rename button and the request list button', () => {
    const { el } = setup({ current: approved, pending: null, last_rejected: null });
    expect(text(el)).not.toContain('개명');
    expect(text(el)).not.toContain('변경 요청 내역 보기');
  });

  it('links 계좌사본 교체 to /settings', () => {
    const { el } = setup({ current: approved, pending: null, last_rejected: null });
    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('계좌사본 교체'),
    );
    expect(
      button?.getAttribute('ng-reflect-router-link') ?? button?.getAttribute('routerlink'),
    ).toBeTruthy();
  });
});
