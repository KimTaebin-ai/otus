import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, forkJoin, map, reduce, switchMap } from 'rxjs';

import { SubmissionStatus } from '@otus/shared/core/api-types';
import { ReviewKind } from './admin.models';
import { previousMonth, reviewWindow } from './study-hours';

export type PublicSubmissionStatus = Exclude<SubmissionStatus, 'draft'>;
/** `submitted` is composed on the client: 검토 중 (`pending_review`) plus 재검토 대기 (`resubmitted`). */
export type SubmissionFilter = 'all' | 'submitted' | 'unsubmitted' | PublicSubmissionStatus;
export const SUBMITTED_STATUSES = ['pending_review', 'resubmitted'] as const;

export interface SubmissionChainSummary {
  root_submission_id: string;
  root_kind: 'initial' | 'monthly';
  latest_submission_id: string;
  latest_kind: ReviewKind;
  status: PublicSubmissionStatus;
  submitted_at: string;
  supplement_count: number;
}

export interface MonthlyStudentRow {
  user: {
    id: number;
    login: string;
    display_name: string;
    employed: boolean;
    initial_submitted: boolean;
    ordinal?: string | null;
    ko_name?: string | null;
    date_of_birth?: string | null;
  };
  chains: SubmissionChainSummary[];
  last_submitted_at: string | null;
}

export interface MonthlySubmissions {
  month: string;
  months: string[];
  items: MonthlyStudentRow[];
  next_before: number | null;
}

export interface MonthlyListOptions {
  month?: string;
  query?: string;
  status?: SubmissionFilter;
  limit?: number;
  before?: number;
}

export interface ReviewQueuePage {
  month: string;
  items: {
    id: string;
    user: {
      id: number;
      name: string;
      login: string;
      employed: boolean;
      ordinal?: string | null;
      ko_name?: string | null;
      date_of_birth?: string | null;
    };
    kind: ReviewKind;
    target_month: string;
    status: 'pending_review' | 'resubmitted';
    submitted_at: string;
  }[];
  next_after: string | null;
}

/** The monthly list and queue contracts in api.md; all requests stay same-origin. */
@Injectable({ providedIn: 'root' })
export class AdminSubmissionsApi {
  private readonly http = inject(HttpClient);

  list(options: MonthlyListOptions = {}): Observable<MonthlySubmissions> {
    if (options.status === 'submitted') return this.listSubmitted(options);
    return this.request(options);
  }

  /**
   * 제출자 = 검토 중 + 재검토 대기. The server filters one status at a time, so ask for both with
   * the same cursor and keep only the ids both lists have fully covered; `next_before` is then
   * the last id shown, so no student is skipped or repeated between pages.
   */
  private listSubmitted(options: MonthlyListOptions): Observable<MonthlySubmissions> {
    return forkJoin(SUBMITTED_STATUSES.map((status) => this.request({ ...options, status }))).pipe(
      map((pages) => {
        const limit = options.limit ?? 20;
        const byId = new Map<number, MonthlyStudentRow>();
        for (const page of pages) for (const row of page.items) byId.set(row.user.id, row);
        const rows = [...byId.values()].sort((a, b) => b.user.id - a.user.id);
        // a list that has more pages is only known down to its last id
        const known = pages
          .filter((page) => page.next_before !== null)
          .map((page) => page.items[page.items.length - 1]?.user.id ?? 0);
        const cutoff = known.length ? Math.max(...known) : 0;
        const covered = rows.filter((row) => row.user.id >= cutoff).slice(0, limit);
        const hasMore = known.length > 0 || covered.length < rows.length;
        return {
          ...pages[0],
          items: covered,
          next_before: hasMore && covered.length ? covered[covered.length - 1].user.id : null,
        };
      }),
    );
  }

  /**
   * The list of a working month: what was submitted from the 1st of the month before to the 15th
   * of this month (see `reviewWindow`). The server groups by target month, so ask for both months,
   * keep each student's chains inside the window and apply the status filter here. Pages follow
   * the same cursor rule as `listSubmitted`.
   */
  listWindow(options: MonthlyListOptions): Observable<MonthlySubmissions> {
    if (!options.month) {
      // learn the current month first
      return this.request({ limit: 1 }).pipe(
        switchMap((page) => this.listWindow({ ...options, month: page.month })),
      );
    }
    const working = options.month;
    const window = reviewWindow(working);
    const filter = options.status ?? 'all';
    const base = { ...options, status: undefined, limit: 50 };
    return forkJoin(
      [previousMonth(working), working].map((m) => this.request({ ...base, month: m })),
    ).pipe(
      map((pages) => {
        const byId = new Map<number, MonthlyStudentRow>();
        for (const page of pages) {
          for (const row of page.items) {
            const chains = row.chains.filter((c) => {
              const at = Date.parse(c.submitted_at);
              return at >= window.startsAtMs && at < window.endsAtMs;
            });
            const merged = [...(byId.get(row.user.id)?.chains ?? []), ...chains];
            byId.set(row.user.id, {
              user: row.user,
              chains: merged,
              last_submitted_at:
                merged
                  .map((c) => c.submitted_at)
                  .sort()
                  .at(-1) ?? null,
            });
          }
        }
        const rows = [...byId.values()].sort((a, b) => b.user.id - a.user.id);
        // a list that has more pages is only known down to its last id
        const known = pages
          .filter((page) => page.next_before !== null)
          .map((page) => page.items[page.items.length - 1]?.user.id ?? 0);
        const cutoff = known.length ? Math.max(...known) : 0;
        const covered = rows.filter((row) => row.user.id >= cutoff);
        const months = [...new Set(pages.flatMap((page) => page.months).concat(working))]
          .sort()
          .reverse();
        return {
          month: working,
          months,
          items: covered.filter((row) => matchesFilter(row, filter)),
          next_before: known.length && covered.length ? covered[covered.length - 1].user.id : null,
        };
      }),
    );
  }

  /** Every student's row of the window, all pages (for the counts) */
  windowRows(workingMonth: string): Observable<MonthlyStudentRow[]> {
    return this.listWindow({ month: workingMonth, limit: 50 }).pipe(
      expand((page) =>
        page.next_before == null
          ? EMPTY
          : this.listWindow({ month: workingMonth, limit: 50, before: page.next_before }),
      ),
      reduce((all: MonthlyStudentRow[], page) => [...all, ...page.items], []),
    );
  }

  /**
   * The waiting submissions of the working month's window (see `listWindow`), oldest first. The
   * queue is by target month, so ask for both months and keep what is inside the window.
   */
  windowQueue(workingMonth: string): Observable<ReviewQueuePage> {
    const window = reviewWindow(workingMonth);
    return forkJoin(
      [previousMonth(workingMonth), workingMonth].map((m) => this.reviewQueue(m, 50)),
    ).pipe(
      map((pages) => ({
        month: workingMonth,
        next_after: null,
        items: pages
          .flatMap((page) => page.items)
          .filter((item) => {
            const at = Date.parse(item.submitted_at);
            return at >= window.startsAtMs && at < window.endsAtMs;
          })
          .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)),
      })),
    );
  }

  private request(options: MonthlyListOptions): Observable<MonthlySubmissions> {
    let params = new HttpParams().set('limit', options.limit ?? 20);
    if (options.month) params = params.set('month', options.month);
    if (options.query) params = params.set('query', options.query);
    if (options.status && options.status !== 'all') params = params.set('status', options.status);
    if (options.before != null) params = params.set('before', options.before);
    return this.http.get<MonthlySubmissions>('/api/admin/submissions', { params });
  }

  reviewQueue(month?: string, limit = 1): Observable<ReviewQueuePage> {
    let params = new HttpParams().set('limit', limit);
    if (month) params = params.set('month', month);
    return this.http.get<ReviewQueuePage>('/api/admin/review-queue', { params });
  }
}

/** Format the server's month without deriving dates in the browser. */
export function submissionMonthLabel(month: string): string {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}

/** The 서류 상태 filter against the chains inside the window */
function matchesFilter(row: MonthlyStudentRow, filter: SubmissionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unsubmitted') return row.chains.length === 0;
  // 제출자 = anyone with a submission in the window, whatever its review status, so the list
  // matches the 제출 count of the cards
  if (filter === 'submitted') return row.chains.length > 0;
  return row.chains.some((c) => c.status === filter);
}
