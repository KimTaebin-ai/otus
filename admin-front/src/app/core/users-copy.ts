import { UserListRow } from './admin-users';
import { studentLabel } from './cohort';

/** Screen copy for the /users list. Only what GET /api/admin/users gives: the profile line. */

export const USERS_TITLE = '사용자 관리';
export const USERS_DESCRIPTION = '교육생의 취업 상태와 최초 서류 등록 여부를 확인해요.';

export function employmentText(employed: boolean): string {
  return employed ? '취업 중' : '미취업';
}

export function initialText(submitted: boolean): string {
  return submitted ? '등록 완료' : '미등록';
}

/** "교육생 12명" or, when more pages exist, "교육생 20명 이상" */
export function usersHeading(count: number, more: boolean): string {
  return more ? `교육생 ${count}명 이상` : `교육생 ${count}명`;
}

export function usersEmpty(query: string): string {
  return query.trim() ? `"${query.trim()}"에 맞는 교육생이 없어요.` : '아직 교육생이 없어요.';
}

export interface UserRowCopy {
  id: number;
  name: string;
  login: string;
  employment: string;
  initial: string;
}

export function userRows(rows: UserListRow[]): UserRowCopy[] {
  return rows.map((r) => ({
    id: r.id,
    name: studentLabel(r.name, r.profile),
    login: r.login,
    employment: employmentText(r.employed),
    initial: initialText(r.initialSubmitted),
  }));
}
