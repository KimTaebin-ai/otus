import { NoticeChannel } from './notice-channel';
import { NoticeAudience } from '@otus/shared/core/notice-audience';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NoticeSendResult, NoticeView } from './admin.models';

export type NoticeTargetGroup = NoticeAudience | 'eligible' | 'employed' | 'all';
export const NOTICE_TARGET_GROUPS: { value: NoticeTargetGroup; label: string }[] = [
  { value: 'unsubmitted', label: '미제출' },
  { value: 'under_40', label: '40시간 미만' },
  { value: 'hours_40_80', label: '40~80시간 구간' },
  { value: 'at_least_80', label: '80시간 이상' },
  { value: 'employed', label: '취업자' },
  { value: 'all', label: '전체 학생' },
];

export interface NoticePreviewResponse {
  audiences?: NoticeTargetGroup[];
  audience: NoticeAudience;
  matched: number;
  hours_unknown: number;
  month: string;
  months: string[];
  closes_at: string | null;
  unsubmitted: number;
  employed_excluded: number;
  employed_names: string[];
  targets: {
    user_id: number;
    name: string;
    login: string;
    employed: boolean;
    status: 'missing' | 'draft' | 'submitted';
    study_hours: 0 | 40 | 80 | null;
    as_of: string | null;
    email: string | null;
  }[];
  target_fingerprint: string;
  email_available: boolean;
}

export interface NoticeSendRequest {
  channel: NoticeChannel;
  audiences: NoticeTargetGroup[];
  title: string;
  body: string;
  month: string;
  expected_count: number;
  target_fingerprint: string;
}

export interface NoticeDelivery {
  audiences?: NoticeTargetGroup[];
  title?: string | null;
  body?: string | null;
  channel: NoticeChannel;
  audience: NoticeAudience;
  notice_id: number;
  month: string;
  sent: number;
  failed: number;
  service: { sent: number; failed: number };
  email: { pending: number; sending: number; sent: number; failed: number; skipped: number };
  employed_excluded: number;
  sent_at: string;
  retried?: number;
  recipients?: {
    id: number;
    user_id: number;
    email_recipient: string | null;
    email_status: 'not_requested' | 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
    email_attempts: number;
    email_sent_at: string | null;
    last_error_code: string | null;
  }[];
}

export function toNoticeView(response: NoticePreviewResponse): NoticeView {
  return {
    month: response.month,
    audience: response.audience,
    matched: response.matched,
    hoursUnknown: response.hours_unknown,
    months: response.months,
    closesAt: response.closes_at,
    unsubmitted: response.unsubmitted,
    employedExcluded: response.employed_excluded,
    employedNames: response.employed_names,
    targets: response.targets.map((target) => ({
      ...target,
      studyHours: target.study_hours,
      asOf: target.as_of,
    })),
  };
}

export function toNoticeResult(response: NoticeDelivery): NoticeSendResult {
  return {
    sent: response.service.sent,
    failed: response.service.failed,
    employedExcluded: response.employed_excluded,
    sentAt: response.sent_at,
  };
}

/** Explicit actions only. GETs never create a notification or queue an email. */
@Injectable({ providedIn: 'root' })
export class NoticesApi {
  private readonly http = inject(HttpClient);

  preview(
    month?: string,
    audiences: NoticeTargetGroup[] = ['unsubmitted'],
  ): Observable<NoticePreviewResponse> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    params = params.set('audiences', audiences.join(','));
    return this.http.get<NoticePreviewResponse>('/api/admin/notices/submission-reminder', {
      params,
    });
  }

  send(body: NoticeSendRequest, key: string): Observable<NoticeDelivery> {
    return this.http.post<NoticeDelivery>('/api/admin/notices/submission-reminder', body, {
      headers: { 'Idempotency-Key': key },
    });
  }

  status(id: number): Observable<NoticeDelivery> {
    return this.http.get<NoticeDelivery>(`/api/admin/notices/${id}`);
  }

  retry(id: number, key: string): Observable<NoticeDelivery> {
    return this.http.post<NoticeDelivery>(`/api/admin/notices/${id}/retry`, null, {
      headers: { 'Idempotency-Key': key },
    });
  }
}
