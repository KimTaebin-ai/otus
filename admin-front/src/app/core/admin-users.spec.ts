import {
  AdminUserDetail,
  AdminUserItem,
  appendRows,
  toBankView,
  toUserListRow,
  toUserRecordView,
} from './admin-users';

const ITEM: AdminUserItem = {
  id: 7,
  login: 'dongmin',
  display_name: '동민',
  employed: false,
  initial_submitted: true,
};

const DETAIL: AdminUserDetail = {
  id: 7,
  login: 'dongmin',
  display_name: '동민',
  role: 'student',
  employed: true,
  employment_updated_at: '2026-09-01T10:00:00+09:00',
  initial_submitted: false,
};

describe('admin users', () => {
  it('maps a list item to a row', () => {
    expect(toUserListRow(ITEM)).toMatchObject({
      id: 7,
      name: '동민',
      login: 'dongmin',
      employed: false,
      initialSubmitted: true,
    });
  });

  it('maps the detail to a profile-only view: unknown parts are empty, not invented', () => {
    const v = toUserRecordView(DETAIL);
    expect(v).toMatchObject({
      name: '동민',
      login: 'dongmin',
      employed: true,
      employmentChangedAt: '2026-09-01T10:00:00+09:00',
      initialSubmitted: false,
      profileOnly: true,
      bank: null,
      currentMonth: null,
      lastSubmittedAt: null,
    });
    expect(v.records).toEqual([]);
    expect(v.initialDocs.docs).toEqual([]);
  });

  it('keeps a never-changed employment time as null', () => {
    expect(
      toUserRecordView({ ...DETAIL, employment_updated_at: null }).employmentChangedAt,
    ).toBeNull();
  });

  it('appends a page without repeating a user', () => {
    const a = toUserListRow(ITEM);
    const b = toUserListRow({ ...ITEM, id: 6, login: 'x' });
    expect(appendRows([a], [a, b]).map((r) => r.id)).toEqual([7, 6]);
  });
});

describe('toBankView (GET /api/admin/users/{id}/bank-account)', () => {
  const req = (bank: string, status: string) => ({
    id: 11,
    bank,
    account_number_masked: '•••• 6789',
    status,
    requested_at: '2026-10-16T23:13:10+09:00',
    decided_at: status === 'approved' ? '2026-10-16T23:20:00+09:00' : null,
  });

  it('shows the approved account by its bank and last four digits', () => {
    const view = toBankView({
      current: req('신한은행', 'approved'),
      pending: null,
      last_rejected: null,
    });
    expect(view.bank).toEqual({
      bankName: '신한은행',
      last4: '6789',
      bankbookChangedAt: '2026-10-16T23:20:00+09:00',
    });
    expect(view.bankPending).toBeNull();
    expect(view.bankUnavailable).toBe(false);
  });

  it('keeps a change waiting for review apart from the account in use', () => {
    const view = toBankView({
      current: null,
      pending: req('국민은행', 'pending'),
      last_rejected: null,
    });
    expect(view.bank).toBeNull();
    expect(view.bankPending).toEqual({
      requestId: 11,
      bankName: '국민은행',
      last4: '6789',
      requestedAt: '2026-10-16T23:13:10+09:00',
      bankbook: null,
    });
  });
});
