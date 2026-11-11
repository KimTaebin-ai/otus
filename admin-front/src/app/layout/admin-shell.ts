import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs';

import { BRAND_NAME } from '@otus/shared/core/brand';
import { AuthService } from '../core/auth.service';
import { ROLE_LABELS, menuFor, menuItemFor } from '../core/roles';
import { AdminMonth, isAdminMonth } from '../core/admin-month';
import { PeriodsApi } from '../core/periods-api';
import { reviewWindow, workingMonthAt } from '../core/study-hours';
import { ActivityService, activityText } from '../core/activity';

/**
 * Admin shell (docs/design/README.md "관리자"): dark sidebar with the logo, the menu for the
 * user's role (`ADMIN_MENU`) and the user row, top bar with the breadcrumb, avatar and logout.
 * The help card and the bell of the images are left out on purpose.
 */
@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './admin-shell.html',
  styleUrl: './admin-shell.css',
})
export class AdminShell {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly months = inject(AdminMonth);
  private readonly periods = inject(PeriodsApi);
  private readonly destroyed = inject(DestroyRef);
  protected readonly monthError = signal(false);
  protected readonly activePage = signal<{ monthChangeBlocked?: () => boolean } | null>(null);

  protected readonly activity = inject(ActivityService);
  protected readonly activityText = activityText;
  protected readonly bellOpen = signal(false);

  protected readonly brand = BRAND_NAME;
  protected readonly roleLabels = ROLE_LABELS;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** The deepest route's `data.crumb` */
  protected readonly crumb = computed(() => {
    this.url();
    return routeCrumb(this.router.routerState.snapshot.root) ?? '';
  });

  /** The menu item the URL belongs to (also for screens under it, like the 자료함) */
  protected readonly activePath = computed(() => menuItemFor(this.url())?.path);

  protected readonly menu = computed(() => {
    const me = this.auth.me();
    return me ? menuFor(me.role) : [];
  });

  protected readonly initial = computed(() => this.auth.me()?.display_name.charAt(0) ?? '');
  protected readonly selectedMonth = computed(() => {
    this.url();
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return (
      route.paramMap.get('month') ?? route.queryParamMap.get('month') ?? this.months.selected()
    );
  });
  /** Which submissions the staff are judging now (from today's date), for the header */
  protected readonly window = computed(() => reviewWindow(this.months.viewing()));

  constructor() {
    // keep "today" fresh for a tab that stays open across the 15th
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe(() => this.months.working.set(workingMonthAt(Date.now())));
    effect(() => {
      const month = this.selectedMonth();
      if (month && isAdminMonth(month)) this.months.selected.set(month);
    });
    this.loadCurrentMonth();
    this.activity.start();
    this.destroyed.onDestroy(() => this.activity.stop());
  }

  /** Look at the window before, or back toward today's; there is no window after today's. */
  protected stepWindow(delta: -1 | 1): void {
    this.months.step(delta);
  }

  protected toggleBell(): void {
    const open = !this.bellOpen();
    this.bellOpen.set(open);
    if (open) this.activity.markSeen();
  }

  protected loadCurrentMonth(): void {
    this.monthError.set(false);
    this.periods
      .list()
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: (page) => {
          this.months.current.set(page.current_month);
          this.months.selected.update((month) => month ?? page.current_month);
        },
        error: () => this.monthError.set(true),
      });
  }

  protected logout(): void {
    this.auth.logout().subscribe(() => {
      this.activity.stop();
      this.months.selected.set(null);
      this.months.current.set(null);
      void this.router.navigateByUrl('/login');
    });
  }
}

function routeCrumb(route: ActivatedRouteSnapshot): string | null {
  const child = route.firstChild ? routeCrumb(route.firstChild) : null;
  const own = route.data['crumb'];
  return child ?? (typeof own === 'string' ? own : null);
}
