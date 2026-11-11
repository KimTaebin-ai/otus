import { Route, Routes } from '@angular/router';

import { pageTitle } from './core/brand';
import type { ReviewStage } from './pages/submission-review';
import { forbiddenGuard, guestGuard, menuGuard, staffGuard } from './core/guards';

/** The steps of one review: /submissions/:id and below. The step is the route's `data.stage`. */
function reviewRoutes(): Route[] {
  const steps: [string, ReviewStage][] = [
    ['', 'review'],
    ['/approve', 'approve'],
    ['/approved', 'approved'],
    ['/revision', 'revision'],
    ['/revision/requested', 'requested'],
  ];
  return steps.map(([path, stage]) => ({
    path: `submissions/:id${path}`,
    title: pageTitle('서류 검토'),
    data: { crumb: '서류 검토', stage },
    loadComponent: () => import('./pages/submission-review').then((m) => m.SubmissionReview),
  }));
}

export const routes: Routes = [
  {
    path: 'login',
    title: pageTitle('로그인'),
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login').then((m) => m.Login),
  },
  {
    path: 'forbidden',
    title: pageTitle('권한 없음'),
    canActivate: [forbiddenGuard],
    loadComponent: () => import('./pages/forbidden').then((m) => m.Forbidden),
  },
  {
    path: '',
    canActivate: [staffGuard],
    canActivateChild: [menuGuard],
    loadComponent: () => import('./layout/admin-shell').then((m) => m.AdminShell),
    children: [
      {
        path: 'periods',
        title: pageTitle('제출 기간 설정'),
        data: { crumb: '제출 기간 설정' },
        loadComponent: () => import('./pages/periods').then((m) => m.Periods),
      },
      {
        path: '',
        pathMatch: 'full',
        title: pageTitle('현황 대시보드'),
        data: { crumb: '현황 대시보드' },
        loadComponent: () => import('./pages/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'submissions',
        title: pageTitle('월별 제출 내역'),
        data: { crumb: '월별 제출 내역' },
        loadComponent: () => import('./pages/submissions').then((m) => m.Submissions),
      },
      ...reviewRoutes(),
      {
        path: 'archive/:month',
        title: pageTitle('월 자료함'),
        data: { crumb: '월 자료함' },
        loadComponent: () => import('./pages/archive').then((m) => m.Archive),
      },
      {
        path: 'archive/:month/options',
        title: pageTitle('내려받기 옵션'),
        data: { crumb: '내려받기 옵션' },
        loadComponent: () => import('./pages/archive-options').then((m) => m.ArchiveOptionsPage),
      },
      {
        path: 'archive/:month/download',
        title: pageTitle('다운로드'),
        data: { crumb: '다운로드' },
        loadComponent: () => import('./pages/archive-download').then((m) => m.ArchiveDownload),
      },
      {
        path: 'users',
        title: pageTitle('사용자 관리'),
        data: { crumb: '사용자 관리' },
        loadComponent: () => import('./pages/users').then((m) => m.Users),
      },
      {
        path: 'users/:id',
        title: pageTitle('사용자 관리'),
        data: { crumb: '사용자 관리' },
        loadComponent: () => import('./pages/user-record').then((m) => m.UserRecord),
      },
      {
        path: 'notices',
        title: pageTitle('제출 안내'),
        data: { crumb: '제출 안내' },
        loadComponent: () => import('./pages/notices').then((m) => m.Notices),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
