import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BankDecision, BankReview } from './bank-review';

const PENDING = {
  requestId: 11,
  bankName: '국민은행',
  last4: '6789',
  requestedAt: '2026-10-16T23:13:10+09:00',
  bankbook: { fileId: 'f-1', name: '통장사본.pdf' },
};

@Component({
  imports: [BankReview],
  template: `<app-bank-review
    [pending]="pending"
    [current]="current"
    [canDecide]="canDecide()"
    [busy]="busy()"
    [error]="error()"
    (decide)="decisions.push($event)"
  />`,
})
class Host {
  pending = PENDING;
  current: { bankName: string; last4: string; bankbookChangedAt: string | null } | null = {
    bankName: '신한은행',
    last4: '1234',
    bankbookChangedAt: null,
  };
  canDecide = signal(true);
  busy = signal(false);
  error = signal<string | null>(null);
  decisions: BankDecision[] = [];
}

function render(withoutCurrent = false) {
  const fixture = TestBed.createComponent(Host);
  if (withoutCurrent) fixture.componentInstance.current = null;
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  return { fixture, el, host: fixture.componentInstance, button };
}

describe('BankReview (지원금 계좌 승인)', () => {
  it('shows the requested and the current account masked, and the 통장사본 to open', () => {
    const { el } = render();
    expect(el.textContent).toContain('국민은행 · •••• 6789');
    expect(el.textContent).toContain('신한은행 · •••• 1234');
    expect(el.textContent).toContain('승인하기 전까지는 지금 쓰는 계좌로 지급돼요.');
    expect(el.querySelector('a.open')?.getAttribute('href')).toBe('/api/files/f-1');
    expect(el.querySelector('a.open')?.getAttribute('rel')).toContain('noopener');
  });

  it('approves only after the 통장사본 was checked', () => {
    const { fixture, el, host, button } = render();
    expect(button('계좌 승인').disabled).toBe(true);
    const box = el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button('계좌 승인').click();
    expect(host.decisions).toEqual([{ requestId: 11, decision: 'approved' }]);
  });

  it('rejects only with a reason, which goes out trimmed', () => {
    const { fixture, el, host, button } = render();
    button('반려').click();
    fixture.detectChanges();
    expect(button('반려 확정').disabled).toBe(true);
    const area = el.querySelector<HTMLTextAreaElement>('#bank-reject-note')!;
    area.value = '  계좌번호가 달라요.  ';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('반려 확정').click();
    expect(host.decisions).toEqual([
      { requestId: 11, decision: 'rejected', note: '계좌번호가 달라요.' },
    ]);
  });

  it('cancelling a rejection goes back to the approval and drops the typed reason', () => {
    const { fixture, el, button } = render();
    button('반려').click();
    fixture.detectChanges();
    const area = el.querySelector<HTMLTextAreaElement>('#bank-reject-note')!;
    area.value = '사유';
    area.dispatchEvent(new Event('input'));
    button('취소').click();
    fixture.detectChanges();
    expect(el.querySelector('#bank-reject-note')).toBeNull();
    button('반려').click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLTextAreaElement>('#bank-reject-note')!.value).toBe('');
  });

  it('cannot decide while busy, and shows a server error', () => {
    const { fixture, el, host, button } = render();
    host.error.set('이미 처리됐어요.');
    host.busy.set(true);
    fixture.detectChanges();
    expect(button('반려').disabled).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('이미 처리됐어요.');
  });

  it('is read-only for a role that may not decide (admin): no buttons, no 통장사본 link', () => {
    const { fixture, el, host } = render();
    host.canDecide.set(false);
    fixture.detectChanges();
    expect(el.querySelectorAll('button')).toHaveLength(0);
    expect(el.querySelector('a.open')).toBeNull();
    expect(el.textContent).toContain('운영·회계 담당자만');
  });

  it('a first registration says there is no current account', () => {
    const { el } = render(true);
    expect(el.textContent).toContain('없음 (첫 등록)');
  });
});
