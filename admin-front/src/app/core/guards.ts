import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map } from 'rxjs';

import { Me } from '@otus/shared/core/api-types';
import { AuthService } from './auth.service';
import { isStaff, menuItemFor } from './roles';

/** Where a user belongs: logged out → /login, student → /forbidden, staff → / */
export function landingPath(me: Me | null): string {
  if (!me) {
    return '/login';
  }
  return isStaff(me.role) ? '/' : '/forbidden';
}

/** Lets through users whose landing path is `path`; sends everyone else to theirs. */
function onlyFor(path: string): CanActivateFn {
  return () => {
    const router = inject(Router);
    return inject(AuthService)
      .ensureLoaded()
      .pipe(
        map((me): true | UrlTree => {
          const landing = landingPath(me);
          return landing === path ? true : router.parseUrl(landing);
        }),
      );
  };
}

/** The admin screens: staff only */
export const staffGuard = onlyFor('/');

/**
 * A staff user who may not see this menu item's screen (`ADMIN_MENU[].roles`) goes to `/`.
 * Put it on the shell route's `canActivateChild`, next to `staffGuard`.
 */
export const menuGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(
      map((me): true | UrlTree => {
        const item = menuItemFor(state.url);
        return !item || (me && item.roles.includes(me.role)) ? true : router.parseUrl('/');
      }),
    );
};

/** The login page redirects users who already have a session. */
export const guestGuard = onlyFor('/login');

/** The no-permission page is only for logged-in non-staff users. */
export const forbiddenGuard = onlyFor('/forbidden');
