import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { Me } from './api.models';
import { AccountDraft } from './account-draft';
import { AuthService } from './auth.service';

/** 기수·한글 이름·생년월일 are all filled in. */
export function profileComplete(me: Me | null): boolean {
  return !!me && !!me.ordinal && !!me.ko_name && !!me.date_of_birth;
}

/** 지원금 지급 종료·트랜스퍼 교육생 don't register documents (current policy). */
export function documentsExempt(me: Me | null): boolean {
  return me?.ordinal === 'ended' || me?.ordinal === 'transfer';
}

/** U01 branching: where a user belongs right after login (profile → 최초 4종 → home) */
export function landingPath(initialSubmitted: boolean, profileDone = true, exempt = false): string {
  if (initialSubmitted) {
    return '/home';
  }
  if (!profileDone) {
    return '/profile';
  }
  return exempt ? '/hello' : '/initial';
}

/** `landingPath` for a loaded user. */
export function landingFor(me: Me): string {
  return landingPath(me.initial_submitted, profileComplete(me), documentsExempt(me));
}

/** Logged-in users only; others go to U01. */
export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(map((me) => (me ? true : router.parseUrl('/login'))));
};

/** U03–U06 need a submitted 최초 4종 (approval not required); otherwise go to U02. */
export const initialSubmittedGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(map((me) => (me?.initial_submitted ? true : router.parseUrl('/initial'))));
};

/** U02 is only for users who haven't submitted 최초 4종 yet, and only after the profile step. */
export const initialPendingGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(
      map((me) => {
        if (!me || me.initial_submitted) {
          return router.parseUrl('/home');
        }
        return profileComplete(me) && !documentsExempt(me) ? true : router.parseUrl(landingFor(me));
      }),
    );
};

/** 지원금 지급 종료·트랜스퍼 교육생 end up here instead of U02. */
export const exemptGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(
      map((me) =>
        me && !me.initial_submitted && profileComplete(me) && documentsExempt(me)
          ? true
          : router.parseUrl(me ? landingFor(me) : '/login'),
      ),
    );
};

/** The profile step (기수·한글 이름) comes before U02; once it's filled in, move on. */
export const profilePendingGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(
      map((me) =>
        me && !profileComplete(me) && !me.initial_submitted
          ? true
          : router.parseUrl(me ? landingFor(me) : '/login'),
      ),
    );
};

/** The login page redirects users who already have a session. */
export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureLoaded()
    .pipe(map((me) => (me ? router.parseUrl(landingFor(me)) : true)));
};

/** The account review needs a typed 계좌 변경 in memory; after a reload there is none → /settings. */
export const accountDraftGuard: CanActivateFn = () =>
  inject(AccountDraft).ready() ? true : inject(Router).parseUrl('/settings');
