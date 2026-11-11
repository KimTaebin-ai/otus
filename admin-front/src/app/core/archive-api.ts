import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';

import { DocType, SubmissionStatus } from '@otus/shared/core/api-types';
import {
  ArchiveCriteria,
  ArchiveView,
  DEFAULT_ARCHIVE_CRITERIA,
  DownloadStatus,
  ReviewKind,
} from './admin.models';

/** Transport shapes from api.md; the presentational models remain camelCase. */
export interface ArchiveResponse {
  month: string;
  months: string[];
  rows: {
    user_id: number;
    name: string;
    login: string;
    files: DocType[];
    base_docs: DocType[];
    previous: DocType[];
    submitted_at: string;
    status: Exclude<SubmissionStatus, 'draft'>;
    kinds: ReviewKind[];
  }[];
}

export interface ArchiveExportRequest {
  user_ids: number[];
  include_base_docs: boolean;
  include_previous: boolean;
  expected_pdf_count: number;
  filters?: { status?: string; kind?: string };
}

/** One canonical comma-separated value per group, shared by list and ZIP requests. */
export function archiveFilters(criteria: ArchiveCriteria): ArchiveExportRequest['filters'] {
  const status = [...new Set(criteria.status)].sort().join(',');
  const kind = [...new Set(criteria.kind)].sort().join(',');
  return status || kind ? { ...(status ? { status } : {}), ...(kind ? { kind } : {}) } : undefined;
}

export interface ArchiveCreated {
  job_id: string;
  status: DownloadStatus;
}

export interface ArchiveExportStatus extends ArchiveCreated {
  zip_name: string;
  student_count: number;
  pdf_count: number;
  expires_at: string | null;
  error?: string;
}

export function toArchiveView(response: ArchiveResponse): ArchiveView {
  return {
    month: response.month,
    months: response.months.includes(response.month)
      ? response.months
      : [response.month, ...response.months],
    rows: response.rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      login: row.login,
      files: row.files,
      baseDocs: row.base_docs,
      previous: row.previous,
      submittedAt: row.submitted_at,
      status: row.status,
      kinds: row.kinds,
    })),
  };
}

@Injectable({ providedIn: 'root' })
export class ArchiveApi {
  private readonly http = inject(HttpClient);

  list(
    month: string,
    criteria: ArchiveCriteria = DEFAULT_ARCHIVE_CRITERIA,
  ): Observable<ArchiveResponse> {
    let params = new HttpParams();
    const filters = archiveFilters(criteria);
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.kind) params = params.set('kind', filters.kind);
    return this.http.get<ArchiveResponse>(this.path(month), { params });
  }

  create(month: string, body: ArchiveExportRequest, key: string): Observable<ArchiveCreated> {
    return this.http.post<ArchiveCreated>(`${this.path(month)}/exports`, body, {
      headers: { 'Idempotency-Key': key },
    });
  }

  status(month: string, id: string): Observable<ArchiveExportStatus> {
    return this.http.get<ArchiveExportStatus>(this.jobPath(month, id));
  }

  file(month: string, id: string): Observable<HttpResponse<Blob>> {
    return this.http
      .get(`${this.jobPath(month, id)}/file`, {
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        catchError((error: unknown) => {
          // XHR returns JSON error responses as Blob too when responseType is blob.
          if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
            return throwError(() => error);
          }
          return from(error.error.text()).pipe(
            mergeMap((text) => {
              let body: unknown = null;
              try {
                body = JSON.parse(text);
              } catch {
                /* retain the HTTP status */
              }
              return throwError(
                () =>
                  new HttpErrorResponse({
                    error: body,
                    headers: error.headers,
                    status: error.status,
                    statusText: error.statusText,
                    url: error.url ?? undefined,
                  }),
              );
            }),
          );
        }),
      );
  }

  private path(month: string): string {
    return `/api/admin/archive/${encodeURIComponent(month)}`;
  }

  private jobPath(month: string, id: string): string {
    return `${this.path(month)}/exports/${encodeURIComponent(id)}`;
  }
}

/** The browser is asked to save only after the authenticated file GET succeeded. */
@Injectable({ providedIn: 'root' })
export class ArchiveFileSaver {
  private readonly document = inject(DOCUMENT);

  save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    this.document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      // Allow the browser to begin consuming the object URL before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
}
