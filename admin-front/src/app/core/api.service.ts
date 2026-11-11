import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiErrorBody, AuthMethods, Me } from '@otus/shared/core/api-types';
import { AdminBankAccount, AdminUserDetail, AdminUserList, BankReviewRequest } from './admin-users';

/**
 * The api.md endpoints the admin app uses. Always use relative `/api/...` URLs:
 * Angular only attaches the X-XSRF-TOKEN header to relative URLs.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  authMethods(): Observable<AuthMethods> {
    return this.http.get<AuthMethods>('/api/auth/methods');
  }

  demoLogin(login: string): Observable<Me> {
    return this.http.post<Me>('/api/auth/demo-login', { login });
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', null);
  }

  me(): Observable<Me> {
    return this.http.get<Me>('/api/me');
  }

  adminBankAccount(id: number): Observable<AdminBankAccount> {
    return this.http.get<AdminBankAccount>(`/api/admin/users/${id}/bank-account`);
  }

  /** Approve or reject the student's pending 계좌 변경; answers with the account as it is now */
  reviewBankAccount(id: number, body: BankReviewRequest): Observable<AdminBankAccount> {
    return this.http.post<AdminBankAccount>(`/api/admin/users/${id}/bank-account/review`, body);
  }

  adminUsers(
    opts: { query?: string; limit?: number; before?: number | null } = {},
  ): Observable<AdminUserList> {
    let params = new HttpParams();
    if (opts.query) {
      params = params.set('query', opts.query);
    }
    if (opts.limit) {
      params = params.set('limit', opts.limit);
    }
    if (opts.before != null) {
      params = params.set('before', opts.before);
    }
    return this.http.get<AdminUserList>('/api/admin/users', { params });
  }

  adminUser(id: number): Observable<AdminUserDetail> {
    return this.http.get<AdminUserDetail>(`/api/admin/users/${id}`);
  }
}

/** The api.md error message, or a generic one (same as the student app's errorMessage). */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiErrorBody> | null;
    if (body?.error?.message) {
      return body.error.message;
    }
    if (err.status === 0) {
      return '서버에 연결할 수 없습니다.';
    }
    if (err.status === 429) {
      return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    }
  }
  return '알 수 없는 오류가 발생했습니다.';
}
