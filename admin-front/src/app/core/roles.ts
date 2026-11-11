import { Role } from '@otus/shared/core/api-types';

/**
 * Roles allowed into the admin app. Both 운영 담당자 and 회계·지정 담당자 can open originals
 * and review. This only picks the screen: the backend must check the role on every admin API.
 */
export const STAFF_ROLES: readonly Role[] = ['operator', 'accountant', 'admin'];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  student: '교육생',
  operator: '운영 담당자',
  accountant: '회계·지정 담당자',
  admin: '관리자',
};

export type MenuIcon = 'dashboard' | 'upload' | 'users' | 'bell' | 'calendar';

export interface MenuItem {
  /** Absolute path; the item is active for it and everything under it */
  path: string;
  label: string;
  icon: MenuIcon;
  /** Who sees the item and may open the screen. The one place that says who gets what. */
  roles: readonly Role[];
  /** Other paths that belong to the item (the 자료함 lives under 월별 제출 내역) */
  also?: readonly string[];
}

/**
 * The sidebar and `menuGuard` both read this table. Period edits are additionally
 * limited to operator/admin by the server; accountants may inspect the settings.
 */
export const ADMIN_MENU: readonly MenuItem[] = [
  { path: '/', label: '현황 대시보드', icon: 'dashboard', roles: STAFF_ROLES },
  {
    path: '/submissions',
    label: '월별 제출 내역',
    icon: 'upload',
    roles: STAFF_ROLES,
    also: ['/archive'],
  },
  { path: '/users', label: '사용자 관리', icon: 'users', roles: STAFF_ROLES },
  { path: '/notices', label: '알림 보내기', icon: 'bell', roles: STAFF_ROLES },
  { path: '/periods', label: '제출 기간 설정', icon: 'calendar', roles: STAFF_ROLES },
];

export function menuFor(role: Role): MenuItem[] {
  return ADMIN_MENU.filter((item) => item.roles.includes(role));
}

/** The menu item a URL belongs to: "/users/3?x=1" → the "/users" item. "/" matches only "/". */
export function menuItemFor(url: string): MenuItem | undefined {
  const path = url.split(/[?#]/)[0];
  return ADMIN_MENU.find((item) =>
    [item.path, ...(item.also ?? [])].some((p) =>
      p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`),
    ),
  );
}

/** Only these roles may open a student's original documents (admin sees the button disabled). */
export const OPEN_ORIGINAL_ROLES: readonly Role[] = ['operator', 'accountant'];

export function canOpenOriginals(role: Role): boolean {
  return OPEN_ORIGINAL_ROLES.includes(role);
}

/** Only the accountant may start a bulk download (a ZIP of many students' originals). */
export const DOWNLOAD_ARCHIVE_ROLES: readonly Role[] = ['accountant'];

export function canDownloadArchive(role: Role): boolean {
  return DOWNLOAD_ARCHIVE_ROLES.includes(role);
}
