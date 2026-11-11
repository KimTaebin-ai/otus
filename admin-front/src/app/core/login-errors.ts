import { LOGIN_ERRORS } from '@otus/shared/core/api-types';

/** Where the admin app starts a 42 login: the backend then uses the admin redirect URI. */
export const ADMIN_42_LOGIN_URL = '/api/auth/42/login?surface=admin';

/**
 * `/login?error=` codes on the admin login: the student app's, plus `staff_only`, which the
 * callback sends when a 교육생 logs in through the admin surface (no session is created).
 */
export const ADMIN_LOGIN_ERRORS: Record<string, string> = {
  ...LOGIN_ERRORS,
  staff_only: '관리자 계정이 아니에요. 운영·회계 담당자 계정으로 로그인해 주세요.',
};

export function loginErrorMessage(code: string | null): string | null {
  return code ? (ADMIN_LOGIN_ERRORS[code] ?? ADMIN_LOGIN_ERRORS['oauth_failed']) : null;
}
