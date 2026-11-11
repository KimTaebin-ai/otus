import {
  ADMIN_MENU,
  ROLE_LABELS,
  canDownloadArchive,
  canOpenOriginals,
  isStaff,
  menuFor,
  menuItemFor,
} from './roles';

describe('roles', () => {
  it('treats operator, accountant and admin as staff', () => {
    expect(isStaff('operator')).toBe(true);
    expect(isStaff('accountant')).toBe(true);
    expect(isStaff('admin')).toBe(true);
    expect(isStaff('student')).toBe(false);
  });

  it('labels the staff roles', () => {
    expect(ROLE_LABELS.operator).toBe('운영 담당자');
    expect(ROLE_LABELS.accountant).toBe('회계·지정 담당자');
    expect(ROLE_LABELS.admin).toBe('관리자');
  });

  it('shows staff menus including period settings', () => {
    for (const role of ['operator', 'accountant', 'admin'] as const) {
      expect(menuFor(role).map((item) => item.label)).toEqual([
        '현황 대시보드',
        '월별 제출 내역',
        '사용자 관리',
        '알림 보내기',
        '제출 기간 설정',
      ]);
    }
    expect(menuFor('student')).toEqual([]);
    expect(ADMIN_MENU.some((item) => item.label.includes('기간'))).toBe(true);
  });

  it('finds the menu item of a URL', () => {
    expect(menuItemFor('/')?.label).toBe('현황 대시보드');
    expect(menuItemFor('/users')?.label).toBe('사용자 관리');
    expect(menuItemFor('/users/3?tab=x')?.label).toBe('사용자 관리');
    expect(menuItemFor('/notices#top')?.label).toBe('알림 보내기');
    expect(menuItemFor('/archive/2026-09/options')?.label).toBe('월별 제출 내역');
    expect(menuItemFor('/archives')).toBeUndefined();
    expect(menuItemFor('/usersx')).toBeUndefined();
    expect(menuItemFor('/forbidden')).toBeUndefined();
  });

  it('lets only operator and accountant open originals', () => {
    expect(canOpenOriginals('operator')).toBe(true);
    expect(canOpenOriginals('accountant')).toBe(true);
    expect(canOpenOriginals('admin')).toBe(false);
    expect(canOpenOriginals('student')).toBe(false);
  });

  it('lets only the accountant start a bulk download', () => {
    expect(canDownloadArchive('accountant')).toBe(true);
    expect(canDownloadArchive('operator')).toBe(false);
    expect(canDownloadArchive('admin')).toBe(false);
    expect(canDownloadArchive('student')).toBe(false);
  });
});
