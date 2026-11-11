import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Button } from '@otus/shared/ui/button';
import { AuthService } from '../core/auth.service';
import { ADMIN_BRAND } from '../core/brand';
import { ROLE_LABELS } from '../core/roles';

/** A logged-in user without a staff role. The role comes from GET /api/me only. */
@Component({
  selector: 'app-forbidden',
  imports: [Button],
  template: `
    <main class="card">
      <p class="logo">{{ brand }}</p>
      <h1>관리자 권한이 없는 계정이에요</h1>
      @if (auth.me(); as me) {
        <p class="who">{{ me.display_name }} ({{ me.login }}) · {{ roleLabels[me.role] }}</p>
      }
      <p class="desc">운영 담당자나 회계·지정 담당자 계정으로 다시 로그인하세요.</p>
      <button appButton variant="secondary" type="button" (click)="logout()">로그아웃</button>
    </main>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: var(--space-3);
      background: var(--color-bg);
    }
    .card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
      max-width: var(--width-login-form);
      padding: var(--space-5);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    .logo {
      margin: 0;
      color: var(--color-teal);
      font-size: var(--font-size-logo-sm);
      font-weight: var(--font-weight-bold);
    }
    h1 {
      margin: 0;
      font-size: var(--font-size-feature-title);
    }
    .who,
    .desc {
      margin: 0;
      color: var(--color-muted);
    }
  `,
})
export class Forbidden {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly brand = ADMIN_BRAND;
  protected readonly roleLabels = ROLE_LABELS;

  protected logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
