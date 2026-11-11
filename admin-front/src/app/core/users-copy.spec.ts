import { studentLabel } from './cohort';
import { UserListRow } from './admin-users';
import { employmentText, initialText, userRows, usersEmpty, usersHeading } from './users-copy';

const ROW: UserListRow = {
  id: 3,
  name: '동민',
  login: 'dongmin',
  employed: true,
  initialSubmitted: false,
};

describe('users copy', () => {
  it('words the profile line', () => {
    expect(employmentText(true)).toBe('취업 중');
    expect(employmentText(false)).toBe('미취업');
    expect(initialText(true)).toBe('등록 완료');
    expect(initialText(false)).toBe('미등록');
  });

  it('turns rows into screen rows', () => {
    expect(userRows([ROW])).toEqual([
      {
        id: 3,
        name: studentLabel('동민'),
        login: 'dongmin',
        employment: '취업 중',
        initial: '미등록',
      },
    ]);
  });

  it('counts, and says "이상" while more pages exist', () => {
    expect(usersHeading(12, false)).toBe('교육생 12명');
    expect(usersHeading(20, true)).toBe('교육생 20명 이상');
  });

  it('explains an empty list, with or without a search', () => {
    expect(usersEmpty('')).toBe('아직 교육생이 없어요.');
    expect(usersEmpty(' 동 ')).toBe('"동"에 맞는 교육생이 없어요.');
  });

  it('uses none of the words the policy kept off the screens', () => {
    const all = JSON.stringify([userRows([ROW]), usersHeading(1, true), usersEmpty('x')]);
    expect(all).not.toMatch(/수령 대상|대상 확정|해당 없음|판단 보류|유예/);
  });
});
