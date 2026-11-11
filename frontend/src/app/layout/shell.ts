import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { catchError, filter, map, of } from 'rxjs';

import { BRAND_NAME } from '@otus/shared/core/brand';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { HelpCard } from './help-card';
import { Notifications } from './notifications';

interface MenuItem {
  path: string;
  label: string;
  icon: 'home' | 'upload' | 'clock' | 'user';
}

/** "나의 지원금" menu (docs/design/README.md "셸"). */
/** Where "도움말 보기" goes. Empty until a help page exists: the card then has no link. */
const HELP_URL = '';

const MENU: MenuItem[] = [
  { path: '/home', label: '홈', icon: 'home' },
  { path: '/submit', label: '서류 제출', icon: 'upload' },
  { path: '/history', label: '내가 낸 서류', icon: 'clock' },
  { path: '/settings', label: '내 정보', icon: 'user' },
];

/**
 * Shell for U03–U06: sidebar (logo, menu, user row) and top bar (breadcrumb, target month,
 * bell, avatar, logout) and the help card above the user row.
 */
@Component({
  selector: 'app-shell',
  imports: [HelpCard, Notifications, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly brand = BRAND_NAME;
  protected readonly menu = MENU;
  protected readonly helpUrl = HELP_URL;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** The deepest route's `data.crumb` (e.g. the U06 account screens), else the menu name. */
  protected readonly crumb = computed(() => {
    const url = this.url();
    return (
      routeCrumb(this.router.routerState.snapshot.root) ??
      MENU.find((item) => url.startsWith(item.path))?.label ??
      ''
    );
  });

  /** "2026년 9월" from the server's target month; hidden if the cycle can't be loaded. */
  protected readonly targetMonth = toSignal(
    inject(ApiService)
      .currentCycle()
      .pipe(
        map((cycle) => formatMonth(cycle.target_month)),
        catchError(() => of(null)),
      ),
    { initialValue: null },
  );

  protected readonly initial = computed(() => this.auth.me()?.display_name.charAt(0) ?? '');

  protected logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}

/** "2026-09" → "2026년 9월". Plain string formatting, no date math. */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  return `${year}년 ${Number(m)}월`;
}

function routeCrumb(route: ActivatedRouteSnapshot): string | null {
  const child = route.firstChild ? routeCrumb(route.firstChild) : null;
  const own = route.data['crumb'];
  return child ?? (typeof own === 'string' ? own : null);
}
