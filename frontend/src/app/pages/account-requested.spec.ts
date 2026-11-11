import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { BankAccount, Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { AccountRequested } from './account-requested';

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

const approved: BankAccount = {
  bank: '카카오뱅크',
  account_number_masked: '•••• 1234',
  status: 'approved',
  requested_at: '2026-02-20T10:00:00+09:00',
  decided_at: '2026-02-20T11:00:00+09:00',
  decision_note: null,
  bankbook: null,
};
const pending: BankAccount = {
  bank: '우리은행',
  account_number_masked: '•••• 4567',
  status: 'pending',
  requested_at: '2026-09-22T10:10:00+09:00',
  decided_at: null,
  decision_note: null,
  bankbook: { file_id: 'f2', original_name: '통장사본_동민_변경.pdf', size: 1000 },
};

describe('Account requested', () => {
  function setup(state: object) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(AuthService).setMe(ME);
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AccountRequested);
    fixture.detectChanges();
    http.expectOne('/api/me/bank-account').flush(state);
    fixture.detectChanges();
    return { fixture, navigate, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('draws the pending request from the server, with the old account', () => {
    const { el, navigate } = setup({ current: approved, pending, last_rejected: null });
    const t = text(el);
    expect(t).toContain('계좌 변경을 요청했어요');
    expect(t).toContain('동민 · dongmin · 승인 전 기존 지급 정보 유지');
    expect(t).toContain('새 통장사본 검토 대기');
    expect(t).toContain('기존 지급 계좌: 카카오뱅크 •••• 1234. 승인되면 요청한 계좌로 갱신돼요.');
    expect(t).toContain('우리은행 •••• 4567 / 예금주 동민');
    expect(t).toContain('통장사본_동민_변경.pdf');
    expect(t).toContain('09.22 10:10 제출 · 회계 담당자 확인 대기');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('works without an approved account yet', () => {
    const { el } = setup({ current: null, pending, last_rejected: null });
    expect(text(el)).toContain('아직 승인된 지급 계좌가 없어요.');
  });

  it('goes to /settings when nothing is pending (e.g. already decided)', () => {
    const { navigate } = setup({ current: approved, pending: null, last_rejected: null });
    expect(navigate).toHaveBeenCalledWith('/settings');
  });
});
