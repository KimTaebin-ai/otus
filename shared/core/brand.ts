// Service name. The final design images say "42 Support" / "42 SUPPORT"; that was a
// placeholder. Take every on-screen name and logo from here. "42" meaning the school or the
// 42 account ("42 계정으로 로그인") is not the service name and stays as is.

export const BRAND_NAME = 'OTUS';

/** U01 left panel footer */
export const BRAND_FOOTER = `${BRAND_NAME} · DOCUMENT SUBMISSION`;

/** Browser tab title for a route: "홈 · OTUS" */
export function pageTitle(page: string): string {
  return `${page} · ${BRAND_NAME}`;
}
