import { ADMIN_42_LOGIN_URL, loginErrorMessage } from './login-errors';

describe('admin login errors', () => {
  it('starts the 42 login on the admin surface', () => {
    expect(ADMIN_42_LOGIN_URL).toBe('/api/auth/42/login?surface=admin');
  });

  it('explains staff_only (a 교육생 used the admin login)', () => {
    expect(loginErrorMessage('staff_only')).toBe(
      '관리자 계정이 아니에요. 운영·회계 담당자 계정으로 로그인해 주세요.',
    );
  });

  it('keeps the student app codes and falls back for unknown ones', () => {
    expect(loginErrorMessage('oauth_denied')).toBe('42 로그인을 취소했습니다.');
    expect(loginErrorMessage('nope')).toBe(
      '42 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    );
    expect(loginErrorMessage(null)).toBeNull();
  });
});
