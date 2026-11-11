import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { Button } from '@otus/shared/ui/button';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ADMIN_BRAND } from '../core/brand';
import { landingPath } from '../core/guards';
import { ADMIN_42_LOGIN_URL, loginErrorMessage } from '../core/login-errors';

/**
 * Admin login. 42 OAuth on the admin surface when the server has it configured; the demo
 * login takes an existing login name (the hackathon deployment uses it). The role guard decides where the user lands afterwards.
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
  private readonly api = inject(ApiService);

  protected readonly brand = ADMIN_BRAND;
  /** Starts with the reason from the 42 callback (`/login?error=<code>`), if any */
  protected readonly error = signal<string | null>(
    loginErrorMessage(inject(ActivatedRoute).snapshot.queryParamMap.get('error')),
  );
  protected readonly busy = signal(false);
  protected readonly demoLogin = signal('');
  /** undefined until loaded */
  protected readonly methods = toSignal(
    this.api.authMethods().pipe(catchError(() => of({ forty_two: false, demo: false }))),
  );

  protected loginWith42(): void {
    // a full-page navigation: the backend runs the OAuth exchange and redirects back
    this.busy.set(true);
    window.location.assign(ADMIN_42_LOGIN_URL);
  }

  protected loginAsDemo(): void {
    const login = this.demoLogin().trim();
    if (!login) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.auth.demoLogin(login).subscribe({
      next: (me) => void this.router.navigateByUrl(landingPath(me)),
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
