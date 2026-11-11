import { UserRecordView } from './admin.models';
import { StudentProfile } from './cohort';

// api.md GET /api/admin/users and /{id}: the only admin endpoints that exist so far.

export interface AdminUserItem {
  id: number;
  login: string;
  display_name: string;
  employed: boolean;
  initial_submitted: boolean;
  ordinal?: string | null;
  ko_name?: string | null;
  date_of_birth?: string | null;
}

export interface AdminUserList {
  items: AdminUserItem[];
  /** The `before` of the next page, null at the end */
  next_before: number | null;
}

export interface AdminUserDetail {
  id: number;
  login: string;
  display_name: string;
  role: string;
  employed: boolean;
  /** ISO 8601 KST, null when it was never changed */
  employment_updated_at: string | null;
  initial_submitted: boolean;
  ordinal?: string | null;
  ko_name?: string | null;
  date_of_birth?: string | null;
}

/** GET /api/admin/users/{id}/bank-account: the same shape as the student's own, masked */
export interface AdminBankAccount {
  current: AdminBankRequest | null;
  pending: AdminBankRequest | null;
  last_rejected: AdminBankRequest | null;
}

export interface AdminBankRequest {
  /** the request's id: a decision names it, so a newer request is never decided by mistake */
  id: number;
  bank: string;
  /** "•••• 1234", never the number */
  account_number_masked: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  bankbook?: { file_id: string; original_name: string; size: number } | null;
}

/** The body of POST /api/admin/users/{id}/bank-account/review */
export interface BankReviewRequest {
  request_id: number;
  decision: 'approved' | 'rejected';
  /** required (1–1000 chars) to reject, not allowed to approve */
  note?: string;
}

const last4 = (masked: string) => masked.slice(-4);

/** The approved account (and a change waiting for review) for the A18 cards */
export function toBankView(
  b: AdminBankAccount,
): Pick<UserRecordView, 'bank' | 'bankPending' | 'bankUnavailable'> {
  return {
    bank: b.current
      ? {
          bankName: b.current.bank,
          last4: last4(b.current.account_number_masked),
          bankbookChangedAt: b.current.decided_at ?? b.current.requested_at,
        }
      : null,
    bankPending: b.pending
      ? {
          requestId: b.pending.id,
          bankName: b.pending.bank,
          last4: last4(b.pending.account_number_masked),
          requestedAt: b.pending.requested_at,
          bankbook: b.pending.bankbook
            ? { fileId: b.pending.bankbook.file_id, name: b.pending.bankbook.original_name }
            : null,
        }
      : null,
    bankUnavailable: false,
  };
}

/** One line of the /users list */
export interface UserListRow {
  id: number;
  name: string;
  login: string;
  employed: boolean;
  initialSubmitted: boolean;
  profile?: StudentProfile;
}

export function toUserListRow(item: AdminUserItem): UserListRow {
  return {
    id: item.id,
    name: item.display_name,
    login: item.login,
    employed: item.employed,
    initialSubmitted: item.initial_submitted,
    profile: item,
  };
}

/**
 * The detail response has no bank account (it comes from its own call), submissions, record or documents yet, so those
 * parts stay empty and `profileOnly` tells the screen they are unknown.
 */
export function toUserRecordView(d: AdminUserDetail): UserRecordView {
  return {
    name: d.display_name,
    login: d.login,
    employed: d.employed,
    employmentChangedAt: d.employment_updated_at,
    bank: null,
    initialSubmitted: d.initial_submitted,
    lastSubmittedAt: null,
    currentMonth: null,
    records: [],
    initialDocs: { approvedAt: null, docs: [] },
    profileOnly: true,
    profile: d,
  };
}

/** Appends the next page to the rows already shown, without showing a user twice */
export function appendRows(shown: UserListRow[], next: UserListRow[]): UserListRow[] {
  const seen = new Set(shown.map((r) => r.id));
  return [...shown, ...next.filter((r) => !seen.has(r.id))];
}

export const USERS_PAGE_SIZE = 20;
