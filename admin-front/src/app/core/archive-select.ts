import {
  ArchiveCriteria,
  ArchiveFilter,
  ArchiveRow,
  DEFAULT_ARCHIVE_CRITERIA,
} from './admin.models';

/**
 * The rows the table shows: the 교육생 search (name or login, any case, spaces around ignored)
 * and the 보기 filter ("선택한 사람" keeps only the selected ones).
 */
export function visibleRows(
  rows: readonly ArchiveRow[],
  query: string,
  filter: ArchiveFilter,
  selected: ReadonlySet<number>,
  criteria: ArchiveCriteria = DEFAULT_ARCHIVE_CRITERIA,
): ArchiveRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (criteria.status.length === 0 || criteria.status.includes(r.status)) &&
      (criteria.kind.length === 0 || criteria.kind.some((kind) => r.kinds.includes(kind))) &&
      (filter === 'all' || selected.has(r.userId)) &&
      (!needle || r.name.toLowerCase().includes(needle) || r.login.toLowerCase().includes(needle)),
  );
}

/** State of the header checkbox over the shown rows */
export function selectAllState(
  shown: readonly ArchiveRow[],
  selected: ReadonlySet<number>,
): 'none' | 'some' | 'all' {
  const n = shown.filter((r) => selected.has(r.userId)).length;
  return n === 0 ? 'none' : n === shown.length ? 'all' : 'some';
}
