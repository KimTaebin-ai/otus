import { MonthlyStudentRow } from './admin-submissions-api';

export interface WindowCounts {
  submitted: number;
  unsubmitted: number;
  total: number;
  employed: number;
}

/**
 * 제출/미제출 counts of a review window, from its rows: 취업 중 left out, 임시 저장 counted as
 * 미제출. The rows hold only the chains inside the window, so a submission made after the
 * deadline (it belongs to the next window) is not counted.
 */
export function countRows(rows: MonthlyStudentRow[]): WindowCounts {
  const targets = rows.filter((row) => !row.user.employed);
  const submitted = targets.filter((row) => row.chains.length > 0).length;
  return {
    submitted,
    unsubmitted: targets.length - submitted,
    total: targets.length,
    employed: rows.length - targets.length,
  };
}
