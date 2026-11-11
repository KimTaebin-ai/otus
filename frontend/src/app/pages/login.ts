import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { BRAND_FOOTER, BRAND_NAME } from '@otus/shared/core/brand';
import { Button } from '@otus/shared/ui/button';
import { LOGIN_ERRORS } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { landingFor } from '../core/guards';

/**
 * U01 로그인 (final U01-login.png). "42 계정으로 로그인" always starts the real
 * 42 OAuth flow; when the server has no 42 app configured it fails visibly
 * instead of silently opening a demo session. Demo login is a separate,
 * explicit action: the ID field below (only when the server enables demo
 * login), or `/login?demo=<login>` which forces the demo login for testing.
 */
@Component({
  selector: 'app-login',
  imports: [Button, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);

  protected readonly brand = BRAND_NAME;
  protected readonly footer = BRAND_FOOTER;
  /** Starts with the reason from the 42 callback (`/login?error=<code>`), if any */
  protected readonly error = signal<string | null>(this.callbackError());
  protected readonly busy = signal(false);
  /** Demo login ID typed into the demo field (demo environments only). */
  protected readonly demoId = signal('');
  /** undefined until loaded; the button stays disabled until then */
  protected readonly methods = toSignal(
    this.api.authMethods().pipe(catchError(() => of({ forty_two: false, demo: false }))),
  );

  private callbackError(): string | null {
    const code = this.route.snapshot.queryParamMap.get('error');
    return code ? (LOGIN_ERRORS[code] ?? LOGIN_ERRORS['oauth_failed']) : null;
  }

  protected login(): void {
    // `/login?demo=<login>` is an explicit testing hook: keep forcing the
    // demo login for it (the e2e harness signs in this way).
    const demo = this.route.snapshot.queryParamMap.get('demo');
    if (demo) {
      this.runDemoLogin(demo);
      return;
    }
    if (this.methods()?.forty_two) {
      // a full-page navigation: the backend runs the OAuth exchange and redirects back
      this.busy.set(true);
      window.location.assign(this.api.fortyTwoLoginUrl);
      return;
    }
    // No 42 app is configured here: say so instead of quietly signing the
    // visitor in as a seeded demo user.
    this.error.set(
      '이 환경에서는 42 로그인이 설정되어 있지 않아요. 데모 환경이라면 아래 데모 로그인으로 들어가 주세요.',
    );
  }

  /** The separate demo login: the typed ID only, exactly as documented. */
  protected loginAsDemo(): void {
    const login = this.demoId().trim();
    if (login) {
      this.runDemoLogin(login);
    }
  }

  private runDemoLogin(login: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.auth.demoLogin(login).subscribe({
      next: (me) => void this.router.navigateByUrl(landingFor(me)),
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
