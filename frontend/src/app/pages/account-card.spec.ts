import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AccountDraft } from '../core/account-draft';
import { BankAccount, BankAccountState, Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
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

const pdf = (name = '새통장.pdf') =>
  new File(['%PDF-1.4\n%%EOF'], name, { type: 'application/pdf' });

describe('AccountCard (/settings)', () => {
  function setup(state: BankAccountState) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(AuthService).setMe(ME);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    http.expectOne('/api/me/bank-account').flush(state);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      draft: TestBed.inject(AccountDraft),
      save: () => el.querySelector<HTMLButtonElement>('.foot button')!,
      number: () => el.querySelector<HTMLInputElement>('#account-number')!,
    };
  }

  async function pick(ctx: ReturnType<typeof setup>, file: File): Promise<void> {
    const input = ctx.el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r));
    ctx.fixture.detectChanges();
  }

  function type(ctx: ReturnType<typeof setup>, value: string): void {
    ctx.number().value = value;
    ctx.number().dispatchEvent(new Event('input'));
    ctx.fixture.detectChanges();
  }

  const NONE: BankAccountState = { current: account(), pending: null, last_rejected: null };

  it('enables 새 계좌 저장하기 only with a valid number and a new PDF, then goes to the review', async () => {
    const ctx = setup(NONE);
    expect(ctx.save().disabled).toBe(true);
    type(ctx, '3333-01-123456');
    expect(ctx.draft.digits()).toBe('333301123456');
    expect(ctx.save().disabled).toBe(true);
    await pick(ctx, pdf());
    expect(ctx.save().disabled).toBe(false);
    expect(ctx.el.querySelector('.row.done')?.textContent).toContain('새통장.pdf');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    ctx.save().click();
    expect(navigate).toHaveBeenCalledWith('/settings/account/review');
  });

  it('checks the number: digits only, 8–20, error after leaving the field', () => {
    const ctx = setup(NONE);
    type(ctx, 'abc12 34');
    expect(ctx.number().value).toBe('12 34');
    ctx.number().dispatchEvent(new Event('blur'));
    ctx.fixture.detectChanges();
    expect(ctx.el.textContent).toContain('계좌번호는 숫자 8~20자리로 입력해주세요.');
    type(ctx, '1'.repeat(21));
    expect(ctx.draft.numberValid()).toBe(false);
    type(ctx, '1'.repeat(20));
    expect(ctx.draft.numberValid()).toBe(true);
    expect(ctx.el.textContent).not.toContain('계좌번호는 숫자 8~20자리로');
  });

  it('refuses a file that is not a PDF', async () => {
    const ctx = setup(NONE);
    await pick(ctx, new File(['x'], '사진.jpg', { type: 'image/jpeg' }));
    expect(ctx.draft.file()).toBeNull();
    expect(ctx.el.textContent).toContain('사진.jpg 파일은 지원하지 않아요.');
  });

  it('keeps what was typed in memory only', () => {
    const ctx = setup(NONE);
    type(ctx, '12345678');
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(location.href).not.toContain('12345678');
  });

  it('offers a bank that is not in the list when it is the current one', () => {
    const ctx = setup({ ...NONE, current: account({ bank: '어딘가은행' }) });
    const options = [...ctx.el.querySelectorAll('#bank option')].map((o) => o.textContent?.trim());
    expect(options[1]).toBe('어딘가은행');
    expect(ctx.el.querySelector<HTMLSelectElement>('#bank')!.value).toBe('어딘가은행');
  });

  it('shows a pending request and still allows a new one', () => {
    const ctx = setup({
      ...NONE,
      pending: account({
        bank: '우리은행',
        account_number_masked: '•••• 4567',
        status: 'pending',
        decided_at: null,
        requested_at: '2026-09-22T10:10:00+09:00',
      }),
    });
    const t = ctx.el.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(t).toContain('계좌 변경을 검토 중이에요');
    expect(t).toContain('우리은행 •••• 4567 · 09.22 10:10 요청');
    expect(ctx.el.querySelector('a[href="/settings/account/requested"]')).not.toBeNull();
    expect(ctx.number()).not.toBeNull();
  });

  it('shows the rejection reason', () => {
    const ctx = setup({
      ...NONE,
      last_rejected: account({
        status: 'rejected',
        decision_note: '통장사본과 계좌번호가 다릅니다.',
      }),
    });
    expect(ctx.el.textContent).toContain('계좌 변경 요청이 반려됐어요');
    expect(ctx.el.textContent).toContain('통장사본과 계좌번호가 다릅니다.');
  });
});
