import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { Me } from '@otus/shared/core/api-types';
import { ApiService } from './api.service';

/** The logged-in user. The session itself lives in an HttpOnly cookie the app can't read. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly _me = signal<Me | null>(null);
  private loaded = false;

  readonly me = this._me.asReadonly();

  /** Loads /api/me once (null when logged out); guards call this on navigation. */
  ensureLoaded(): Observable<Me | null> {
    if (this.loaded) {
      return of(this._me());
    }
    return this.api.me().pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 401) {
          return of(null);
        }
        throw err;
      }),
      tap((me) => this.setMe(me)),
    );
  }

  demoLogin(login: string): Observable<Me> {
    return this.api.demoLogin(login).pipe(tap((me) => this.setMe(me)));
  }

  logout(): Observable<void> {
    return this.api.logout().pipe(
      // the session may already have expired; either way we're logged out locally
      catchError(() => of(undefined)),
      map(() => this.setMe(null)),
    );
  }

  setMe(me: Me | null): void {
    this._me.set(me);
    this.loaded = true;
  }
}
