import { ArchiveRow } from './admin.models';
import { selectAllState, visibleRows } from './archive-select';

function row(userId: number, name: string, login: string): ArchiveRow {
  return {
    userId,
    name,
    login,
    files: ['employment_insurance'],
    baseDocs: [],
    previous: [],
    submittedAt: '2026-09-21T09:12:00+09:00',
    status: 'pending_review',
    kinds: ['monthly'],
  };
}

const ROWS = [row(1, '동민', 'dongkim2'), row(2, '이서연', 'Seoyeon'), row(3, '김하린', 'harin')];

describe('visibleRows', () => {
  const none = new Set<number>();

  it('shows everyone without a search', () => {
    expect(visibleRows(ROWS, '', 'all', none)).toEqual(ROWS);
    expect(visibleRows(ROWS, '   ', 'all', none)).toEqual(ROWS);
  });

  it('searches the name and the login, in any case', () => {
    expect(visibleRows(ROWS, '서연', 'all', none).map((r) => r.userId)).toEqual([2]);
    expect(visibleRows(ROWS, ' SEOYEON ', 'all', none).map((r) => r.userId)).toEqual([2]);
    expect(visibleRows(ROWS, 'kim', 'all', none).map((r) => r.userId)).toEqual([1]);
    expect(visibleRows(ROWS, '없는사람', 'all', none)).toEqual([]);
  });

  it('keeps only the selected ones in the 선택한 사람 view, and combines it with the search', () => {
    const selected = new Set([1, 3]);
    expect(visibleRows(ROWS, '', 'selected', selected).map((r) => r.userId)).toEqual([1, 3]);
    expect(visibleRows(ROWS, 'harin', 'selected', selected).map((r) => r.userId)).toEqual([3]);
    expect(visibleRows(ROWS, 'seoyeon', 'selected', selected)).toEqual([]);
  });

  it('ORs checkbox choices within groups and ANDs status, kind and student search', () => {
    const rows: ArchiveRow[] = [
      { ...ROWS[0], status: 'approved', kinds: ['initial'] },
      { ...ROWS[1], status: 'resubmitted', kinds: ['supplement'] },
      { ...ROWS[2], status: 'approved', kinds: ['monthly'] },
    ];
    const criteria = {
      status: ['approved', 'resubmitted'] as const,
      kind: ['initial', 'supplement'] as const,
    };
    expect(visibleRows(rows, '', 'all', none, criteria).map((r) => r.userId)).toEqual([1, 2]);
    expect(visibleRows(rows, 'seo', 'all', none, criteria).map((r) => r.userId)).toEqual([2]);
    expect(visibleRows(rows, '', 'all', none, { ...criteria, kind: [] })).toHaveLength(3);
  });
});

describe('selectAllState', () => {
  it('is none, some or all over the shown rows', () => {
    expect(selectAllState(ROWS, new Set())).toBe('none');
    expect(selectAllState(ROWS, new Set([2]))).toBe('some');
    expect(selectAllState(ROWS, new Set([1, 2, 3]))).toBe('all');
    // people hidden by a search do not count
    expect(selectAllState([ROWS[0]], new Set([1, 2]))).toBe('all');
    expect(selectAllState([], new Set([1]))).toBe('none');
  });
});
