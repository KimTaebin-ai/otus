import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { DocType, Role, SubmissionStatus } from '@otus/shared/core/api-types';
import { ReviewKind, ReviewView } from './admin.models';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';

export interface SubmissionRecord {
  id: string;
  kind: ReviewKind;
  target_month: string;
  status: SubmissionStatus;
  parent_id: string | null;
  submitted_at: string;
  required_doc_types: DocType[];
  revision_doc_types: DocType[];
  review_comment: string | null;
  files: {
    id: string;
    doc_type: DocType;
    original_name: string;
    size_bytes: number;
    uploaded_at: string;
  }[];
}
export interface SubmissionDetail extends SubmissionRecord {
  user: {
    id: number;
    name: string;
    login: string;
    employed: boolean;
    ordinal?: string | null;
    ko_name?: string | null;
    date_of_birth?: string | null;
  };
  root_id: string;
  latest_submission_id: string;
  cycle: { opens_at: string; closes_at: string; issued_after: string } | null;
}
export interface SubmissionEvent {
  id: number;
  submission_id: string;
  at: string;
  action: 'submitted' | 'resubmitted' | 'approved' | 'revision_requested';
  actor: { name: string; role: Role };
  review_comment: string | null;
  revision_doc_types: DocType[];
}
export interface ReviewNavigation {
  previous_id: string | null;
  next_id: string | null;
  remaining_count: number;
}
export type ReviewBody =
  | { status: 'approved' }
  | {
      status: 'revision_requested';
      review_comment: string;
      revision_doc_types: DocType[];
    };
export interface ReviewResult {
  id: string;
  status: SubmissionStatus;
  reviewed_by: { name: string; role: Role };
  reviewed_at: string;
}

export function toReviewView(detail: SubmissionDetail, events: SubmissionEvent[]): ReviewView {
  return {
    submissionId: detail.id,
    userId: detail.user.id,
    name: detail.user.ko_name?.trim() || detail.user.name,
    profile: detail.user,
    login: detail.user.login,
    employed: detail.user.employed,
    kind: detail.kind,
    month: detail.target_month,
    status: detail.status,
    submittedAt: detail.submitted_at,
    docs: detail.required_doc_types.flatMap((type) =>
      detail.files
        .filter((f) => f.doc_type === type)
        .map((f) => ({
          docType: f.doc_type,
          fileId: f.id,
          fileName: f.original_name,
          sizeBytes: f.size_bytes,
        })),
    ),
    period: detail.cycle
      ? { opensAt: detail.cycle.opens_at, closesAt: detail.cycle.closes_at }
      : null,
    events,
  };
}

@Injectable({ providedIn: 'root' })
export class ReviewApi {
  private readonly http = inject(HttpClient);
  detail(id: string) {
    return this.http.get<SubmissionDetail>('/api/admin/submissions/' + encodeURIComponent(id));
  }
  history(id: string) {
    return this.http.get<{ root_id: string; items: SubmissionRecord[] }>(
      '/api/admin/submissions/' + encodeURIComponent(id) + '/history',
    );
  }
  events(id: string) {
    return this.http.get<{ root_id: string; items: SubmissionEvent[] }>(
      '/api/admin/submissions/' + encodeURIComponent(id) + '/events',
    );
  }
  navigation(id: string, month: string) {
    return this.http.get<ReviewNavigation>(
      '/api/admin/submissions/' + encodeURIComponent(id) + '/navigation',
      { params: { month } },
    );
  }
  /** The API orders submissions; the header moves between distinct students. */
  userNavigation(id: string, month: string, userId: number): Observable<ReviewNavigation> {
    return this.navigation(id, month).pipe(
      switchMap((navigation) =>
        forkJoin({
          previous_id: this.otherUser(navigation.previous_id, month, userId, 'previous_id'),
          next_id: this.otherUser(navigation.next_id, month, userId, 'next_id'),
        }).pipe(map((neighbors) => ({ ...navigation, ...neighbors }))),
      ),
    );
  }
  private otherUser(
    id: string | null,
    month: string,
    userId: number,
    direction: 'previous_id' | 'next_id',
  ): Observable<string | null> {
    if (!id) return of(null);
    return this.detail(id).pipe(
      switchMap((detail) =>
        detail.user.id !== userId
          ? of(id)
          : this.navigation(id, month).pipe(
              switchMap((navigation) =>
                this.otherUser(navigation[direction], month, userId, direction),
              ),
            ),
      ),
    );
  }
  review(id: string, body: ReviewBody, key: string) {
    return this.http.post<ReviewResult>(
      '/api/admin/submissions/' + encodeURIComponent(id) + '/review',
      body,
      {
        headers: new HttpHeaders({ 'Idempotency-Key': key }),
      },
    );
  }
}
