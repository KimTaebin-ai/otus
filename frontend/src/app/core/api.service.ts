import { HttpClient, HttpErrorResponse, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  ApiErrorBody,
  AuthMethods,
  BankAccountChangeRequest,
  BankAccountState,
  CreateSubmissionRequest,
  Cycle,
  IDEMPOTENCY_HEADER,
  DevSetStatusRequest,
  DocType,
  ListSubmissionsQuery,
  Me,
  NotificationList,
  Submission,
  SubmissionFile,
  SubmissionList,
  TimeRequirementList,
  TimeRequirementQuery,
} from './api.models';

/**
 * Thin wrappers over the endpoints in api.md. Always use relative `/api/...` URLs:
 * Angular only attaches the X-XSRF-TOKEN header to relative URLs, and the backend
 * rejects state-changing requests without it.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  authMethods(): Observable<AuthMethods> {
    return this.http.get<AuthMethods>('/api/auth/methods');
  }

  /**
   * 42 login is a full-page navigation (not XHR): the browser goes to 42 and comes back
   * through /api/auth/42/callback, which redirects to / or /login?error=<code>.
   */
  readonly fortyTwoLoginUrl = '/api/auth/42/login';

  demoLogin(login: string, displayName?: string): Observable<Me> {
    return this.http.post<Me>('/api/auth/demo-login', {
      login,
      display_name: displayName || undefined,
    });
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', null);
  }

  me(): Observable<Me> {
    return this.http.get<Me>('/api/me');
  }

  /** 201 creates a draft, 200 returns the existing draft for the same kind + month */
  createSubmission(body: CreateSubmissionRequest): Observable<Submission> {
    return this.http.post<Submission>('/api/submissions', body);
  }

  /** 취업 상태: saved immediately; returns the updated user */
  setEmployment(employed: boolean): Observable<Me> {
    return this.http.patch<Me>('/api/me/employment', { employed });
  }

  /** 기수·한글 이름: partial update (omitted = keep); returns the updated user */
  setProfile(profile: {
    ordinal?: string;
    ko_name?: string;
    date_of_birth?: string;
  }): Observable<Me> {
    return this.http.patch<Me>('/api/me/profile', profile);
  }

  bankAccount(): Observable<BankAccountState> {
    return this.http.get<BankAccountState>('/api/me/bank-account');
  }

  /**
   * Creates a pending change with the new 통장사본; the current account stays in use until
   * approved. Emits upload progress events, then the response.
   */
  requestBankAccountChange(
    body: BankAccountChangeRequest,
  ): Observable<HttpEvent<BankAccountState>> {
    const form = new FormData();
    form.append('bank', body.bank);
    form.append('account_number', body.account_number);
    form.append('file', body.bankbook, body.bankbook.name);
    return this.http.put<BankAccountState>('/api/me/bank-account', form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  /** An original the user owns (e.g. to send a stored 통장사본 on with a 계좌 request) */
  fetchFile(fileId: string): Observable<Blob> {
    return this.http.get(`/api/files/${fileId}`, { responseType: 'blob' });
  }

  /** Demo only (404 when demo login is off) */
  devReviewBankAccount(
    decision: 'approved' | 'rejected',
    note?: string,
  ): Observable<BankAccountState> {
    return this.http.post<BankAccountState>('/api/dev/me/bank-account/review', { decision, note });
  }

  /**
   * Download URL for an original document (a submission file or a bankbook copy). Open it
   * as a navigation (`<a [href]="api.fileUrl(id)">`): the server sends it as an attachment.
   * Only the owner or a 회계·지정 담당자 gets it; anyone else gets 404.
   */
  fileUrl(fileId: string): string {
    return `/api/files/${encodeURIComponent(fileId)}`;
  }

  /** The original PDF as a Blob, for the in-page preview (the download URL is an attachment). */
  fileBlob(fileId: string): Observable<Blob> {
    return this.http.get(this.fileUrl(fileId), { responseType: 'blob' });
  }

  /** Demo only (404 when demo login is off) */
  devSetStatus(submissionId: string, body: DevSetStatusRequest): Observable<Submission> {
    return this.http.post<Submission>(`/api/dev/submissions/${submissionId}/status`, body);
  }

  /**
   * Emits progress events (HttpEventType.UploadProgress) for the upload progress bar,
   * then the response. `doc_type` goes first so the server can reject it before the file.
   */
  uploadFile(
    submissionId: string,
    docType: DocType,
    file: File,
  ): Observable<HttpEvent<SubmissionFile>> {
    const form = new FormData();
    form.append('doc_type', docType);
    form.append('file', file, file.name);
    return this.http.post<SubmissionFile>(`/api/submissions/${submissionId}/files`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  /** History, newest first; drafts are excluded unless include_drafts. */
  listSubmissions(query: ListSubmissionsQuery = {}): Observable<SubmissionList> {
    let params = new HttpParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<SubmissionList>('/api/submissions', { params });
  }

  /** Newest month first. The current month is always there, even with no record yet. */
  timeRequirements(query: TimeRequirementQuery = {}): Observable<TimeRequirementList> {
    let params = new HttpParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<TimeRequirementList>('/api/me/time-requirements', { params });
  }

  /** Period and D-day for the current KST month, computed by the server. */
  currentCycle(): Observable<Cycle> {
    return this.http.get<Cycle>('/api/cycles/current');
  }

  notifications(before?: number): Observable<NotificationList> {
    let params = new HttpParams();
    if (before !== undefined) params = params.set('before', before);
    return this.http.get<NotificationList>('/api/notifications', { params });
  }

  unreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>('/api/notifications/unread-count');
  }

  markNotificationRead(id: number): Observable<void> {
    return this.http.post<void>(`/api/notifications/${id}/read`, null);
  }

  markAllNotificationsRead(): Observable<void> {
    return this.http.post<void>('/api/notifications/read-all', null);
  }

  /**
   * 최종 제출. Reuse the same `idempotencyKey` when retrying one submit so a lost response
   * can't submit twice.
   */
  finalize(submissionId: string, idempotencyKey: string): Observable<Submission> {
    return this.http.post<Submission>(`/api/submissions/${submissionId}/finalize`, null, {
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
    });
  }
}

/** The api.md error message, or a generic one for network/unknown errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiErrorBody> | null;
    if (body?.error?.message) {
      return body.error.message;
    }
    if (err.status === 0) {
      return '서버에 연결할 수 없습니다.';
    }
    // the proxy rejects very large uploads before the backend sees them, without a JSON body
    if (err.status === 413) {
      return '파일 용량이 너무 큽니다.';
    }
    if (err.status === 429) {
      return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    }
  }
  return '알 수 없는 오류가 발생했습니다.';
}
