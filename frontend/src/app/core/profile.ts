import { BankAccountState, Me } from './api.models';

/** "취업 중" / "미취업" (final U03 "내 정보", U06 pill) */
export function employmentStatusText(employed: boolean): string {
  return employed ? '취업 중' : '미취업';
}

/** employmentStatusText() from GET /api/me, or "—" before it loads */
export function employmentText(me: Me | null): string {
  return me ? employmentStatusText(me.employed) : '—';
}

/**
 * "카카오뱅크{separator}•••• 1234" from GET /api/me/bank-account: the approved account in use
 * (masked by the server), or "—" when none is approved yet.
 */
export function accountText(bank: BankAccountState | null, separator: string): string {
  const current = bank?.current;
  return current ? `${current.bank}${separator}${current.account_number_masked}` : '—';
}

/** One entry of "최근 변경". `item`/`status` fill the history table, `summary` the timeline. */
export interface ChangeItem {
  /** KST ISO time, so entries sort as plain strings */
  at: string;
  item: string;
  status: string;
  summary: string;
}

const BANK_STATUS_LABELS = {
  pending: '검토 대기',
  approved: '승인 완료',
  rejected: '반려',
} as const;

/**
 * "최근 변경" from what the API has (no history endpoint): the last employment change, and the
 * pending, current and last rejected bank requests. Newest first.
 */
export function recentChanges(me: Me | null, bank: BankAccountState | null): ChangeItem[] {
  const items: ChangeItem[] = [];
  if (me?.employment_updated_at) {
    const text = employmentStatusText(me.employed);
    items.push({
      at: me.employment_updated_at,
      item: `취업 상태 · ${text}`,
      status: '저장 완료',
      summary: `취업 상태 · ${text}으로 변경`,
    });
  }
  const requests = [
    { account: bank?.pending, label: BANK_STATUS_LABELS.pending },
    { account: bank?.current, label: BANK_STATUS_LABELS.approved },
    { account: bank?.last_rejected, label: BANK_STATUS_LABELS.rejected },
  ];
  for (const { account, label } of requests) {
    if (account) {
      items.push({
        at: account.decided_at ?? account.requested_at,
        item: '계좌 변경',
        status: label,
        summary: `계좌 변경 · ${label}`,
      });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
