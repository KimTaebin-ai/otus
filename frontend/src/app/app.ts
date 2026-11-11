import { Component, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';

import { Spinner } from '@otus/shared/ui/spinner';

/**
 * Root. Until the first navigation finishes (the guards fetch /api/me and the page chunk loads)
 * a full-screen spinner replaces the blank page; later navigations show a thin top bar.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Spinner],
  template: `
    @if (!ready()) {
      <app-spinner class="boot" size="page" label="OTUS를 불러오는 중…" />
    }
    @if (ready() && navigating()) {
      <div class="progress" role="progressbar" aria-label="페이지 이동 중"></div>
    }
    <router-outlet />
  `,
  styles: `
    .boot {
      min-height: 100vh;
    }

    .progress {
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 1000;
      height: 3px;
      overflow: hidden;
      background: var(--color-mint);
    }

    .progress::after {
      content: '';
      display: block;
      height: 100%;
      width: 40%;
      background: var(--color-teal);
      animation: slide 1s ease-in-out infinite;
    }

    @keyframes slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(250%);
      }
    }
  `,
})
export class App {
  protected readonly ready = signal(false);
  protected readonly navigating = signal(false);

  constructor() {
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.navigating.set(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.navigating.set(false);
        // a cancel is usually a guard redirect; the next navigation follows right away
        if (!(event instanceof NavigationCancel)) {
          this.ready.set(true);
        }
      }
    });
  }
}
