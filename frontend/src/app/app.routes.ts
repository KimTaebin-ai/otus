import { Routes } from '@angular/router';

import { pageTitle } from '@otus/shared/core/brand';
import {
  accountDraftGuard,
  authGuard,
  exemptGuard,
  guestGuard,
  initialPendingGuard,
  initialSubmittedGuard,
  profilePendingGuard,
} from './core/guards';
// Screen codes follow the team wireframes (교육생 U01–U11). Hackathon scope: U01–U06.
export const routes: Routes = [
  {
    path: 'login',
    title: pageTitle('로그인'),
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      // Shared component showcase; dev builds only (ngDevMode is false in production, so the
      // bundler drops it). Delete with pages/dev-ui.ts.
      ...(typeof ngDevMode === 'undefined' || ngDevMode
        ? [{ path: 'dev/ui', loadComponent: () => import('./pages/dev-ui').then((m) => m.DevUi) }]
        : []),
      // 기수·한글 이름: right after the first login, before U02
      {
        path: 'profile',
        title: pageTitle('기수·이름 입력'),
        canActivate: [profilePendingGuard],
        loadComponent: () => import('./layout/onboarding-shell').then((m) => m.OnboardingShell),
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/profile-setup').then((m) => m.ProfileSetup),
          },
        ],
      },
      // 지원금 지급 종료·트랜스퍼 교육생: no document registration (placeholder page)
      {
        path: 'hello',
        title: pageTitle('안내'),
        canActivate: [exemptGuard],
        loadComponent: () => import('./layout/onboarding-shell').then((m) => m.OnboardingShell),
        children: [{ path: '', loadComponent: () => import('./pages/hello').then((m) => m.Hello) }],
      },
      // U02 has no sidebar: its own top bar and a centered layout
      {
        path: 'initial',
        title: pageTitle('최초 4종 제출'),
        canActivate: [initialPendingGuard],
        loadComponent: () => import('./layout/onboarding-shell').then((m) => m.OnboardingShell),
        children: [
          { path: '', loadComponent: () => import('./pages/initial').then((m) => m.Initial) },
        ],
      },
      // U03–U06: sidebar shell
      {
        path: '',
        canActivate: [initialSubmittedGuard],
        loadComponent: () => import('./layout/shell').then((m) => m.Shell),
        children: [
          {
            path: 'home',
            title: pageTitle('홈'),
            loadComponent: () => import('./pages/home').then((m) => m.Home),
          },
          {
            path: 'submit',
            title: pageTitle('월별 제출'),
            loadComponent: () => import('./pages/monthly').then((m) => m.Monthly),
          },
          {
            path: 'submit/initial',
            title: pageTitle('최초 서류 보완 제출'),
            loadComponent: () => import('./pages/initial-revision').then((m) => m.InitialRevision),
          },
          {
            path: 'history',
            title: pageTitle('제출 이력'),
            loadComponent: () => import('./pages/history').then((m) => m.History),
          },
          {
            path: 'settings',
            children: [
              {
                path: '',
                title: pageTitle('내 정보'),
                loadComponent: () => import('./pages/settings').then((m) => m.Settings),
              },
              {
                path: 'account/requested',
                title: pageTitle('계좌 변경 요청'),
                data: { crumb: '계좌 변경을 요청했어요' },
                loadComponent: () =>
                  import('./pages/account-requested').then((m) => m.AccountRequested),
              },
              {
                path: 'history',
                title: pageTitle('내 정보와 변경 이력'),
                data: { crumb: '내 정보와 변경 이력' },
                loadComponent: () =>
                  import('./pages/account-history').then((m) => m.AccountHistory),
              },
              {
                path: 'account/review',
                title: pageTitle('계좌 변경 검토 요청'),
                data: { crumb: '계좌 변경 검토 요청해주세요' },
                canActivate: [accountDraftGuard],
                loadComponent: () => import('./pages/account-review').then((m) => m.AccountReview),
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
