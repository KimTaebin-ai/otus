import {
  dotDateTime,
  dotMonthDay,
  hourMinute,
  lastMoment,
  monthDay,
  spokenTime,
} from '@otus/shared/core/format';
import { BankAccountState, Me } from './api.models';
import { accountText, employmentText } from './profile';

const me = (employed: boolean) => ({ employed }) as Me;

describe('profile text', () => {
  it('reads employment from /api/me', () => {
    expect(employmentText(null)).toBe('—');
    expect(employmentText(me(false))).toBe('미취업');
    expect(employmentText(me(true))).toBe('취업 중');
  });

  it('shows only the approved account, never a pending one', () => {
    const account = {
      bank: '카카오뱅크',
      account_number_masked: '•••• 1234',
      status: 'approved',
      requested_at: '2026-09-01T10:00:00+09:00',
      decided_at: null,
      decision_note: null,
      bankbook: null,
    } as const;
    const state = (current: typeof account | null): BankAccountState => ({
      current,
      pending: current ? null : { ...account, status: 'pending' },
      last_rejected: null,
    });
    expect(accountText(null, ' ')).toBe('—');
    expect(accountText(state(null), ' ')).toBe('—');
    expect(accountText(state(account), ' · ')).toBe('카카오뱅크 · •••• 1234');
  });
});

describe('format', () => {
  it('renders a missing time as a dash', () => {
    expect(monthDay(null)).toBe('—');
    expect(dotMonthDay(null)).toBe('—');
    expect(spokenTime(null)).toBe('—');
    expect(monthDay('2026-10-31T23:59:59+09:00')).toBe('10월 31일');
  });
});

describe('lastMoment (exclusive closes_at shown as the last day 23:59)', () => {
  it('steps back one second in KST, across month and year ends', () => {
    expect(lastMoment('2026-11-01T00:00:00+09:00')).toBe('2026-10-31T23:59:59+09:00');
    expect(lastMoment('2027-01-01T00:00:00+09:00')).toBe('2026-12-31T23:59:59+09:00');
    expect(lastMoment('2028-03-01T00:00:00+09:00')).toBe('2028-02-29T23:59:59+09:00');
    expect(lastMoment(null)).toBeNull();
  });

  it('shows closes_at = next month 1st 00:00 as "10월 31일 23:59"', () => {
    const last = lastMoment('2026-11-01T00:00:00+09:00');
    expect(`${monthDay(last)} ${hourMinute(last)}`).toBe('10월 31일 23:59');
    expect(dotDateTime(last)).toBe('2026.10.31 23:59');
  });
});
