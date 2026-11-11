import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { BRAND_NAME } from '@otus/shared/core/brand';
import { AuthService } from '../core/auth.service';
import { Notifications } from './notifications';

/**
 * Shell for U02 (/initial): no sidebar, a top bar with the small logo + "/ 첫 서류 등록" and
 * "이름 · 인트라ID" + logout on the right, and the content centered (final U02-initial-*.png).
 */
@Component({
  selector: 'app-onboarding-shell',
  imports: [RouterOutlet, Notifications],
  template: `
    <header class="topbar">
      <p class="brand">
        <span class="logo-name">{{ brand }}</span>
        <span class="crumb">/ 첫 서류 등록</span>
      </p>
      <div class="topbar-right">
        <app-notifications />
        @if (auth.me(); as me) {
          <span class="who">{{ me.display_name }} · {{ me.login }}</span>
        }
        <button type="button" class="logout" (click)="logout()">로그아웃</button>
      </div>
    </header>
    <main class="content">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--color-bg);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: var(--height-topbar-onboarding);
      padding: 0 var(--space-4);
      background: var(--color-surface);
    }

    .brand {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      margin: 0;
    }

    .logo-name {
      font-size: var(--font-size-logo-sm);
      font-weight: var(--font-weight-bold);
      color: var(--color-teal);
    }

    .crumb {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .who {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
    }

    .logout {
      padding: 0;
      border: 0;
      background: none;
      color: var(--color-muted);
      font: inherit;
      font-size: var(--font-size-caption);
      cursor: pointer;
    }

    .logout:focus-visible {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }

    @media (max-width: 720px) {
      .topbar {
        height: auto;
        min-height: 64px;
        padding: var(--space-1) var(--space-2);
      }

      .who,
      .crumb {
        display: none;
      }

      .content {
        width: calc(100% - 2 * var(--space-2));
      }
    }

    .content {
      width: min(var(--width-onboarding), calc(100% - 2 * var(--space-4)));
      margin: 0 auto;
      padding: var(--space-3) 0 var(--space-5);
    }
  `,
})
export class OnboardingShell {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly brand = BRAND_NAME;

  protected logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
