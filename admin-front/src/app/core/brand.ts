import { BRAND_NAME } from '@otus/shared/core/brand';

export const ADMIN_BRAND = `${BRAND_NAME} Admin`;

/** Browser tab title for a route: "로그인 · OTUS Admin" */
export function pageTitle(page: string): string {
  return `${page} · ${ADMIN_BRAND}`;
}
