import { Injectable, inject } from '@angular/core';
import { DocType } from '@otus/shared/core/api-types';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { AdminUserDetail, toBankView, toUserRecordView } from './admin-users';
import { ApiService } from './api.service';
import {
  AdminSubmissionsApi,
  MonthlyStudentRow,
  SubmissionChainSummary,
} from './admin-submissions-api';
import { InitialDoc, UserRecordRow, UserRecordView } from './admin.models';
import { ReviewApi, SubmissionEvent, SubmissionRecord } from './review-api';

/** The newest months to look through for one student's submissions */
const MAX_MONTHS = 12;
const INITIAL_DOC_ORDER: DocType[] = ['id_card', 'resident_abstract', 'bankbook'];

export interface ChainData {
  summary: SubmissionChainSummary;
  records: SubmissionRecord[];
  events: SubmissionEvent[];
}

export interface UserSubmissions {
  /** The month the first list call answered with: the current one */
  currentMonth: string;
  /** The student's chains in the current month */
  currentChains: SubmissionChainSummary[];
  chains: ChainData[];
}

/**
 * Builds the A18 view from the profile plus the student's submission chains. The bank account
 * comes from `UserRecordApi.load` (its own call), so here `bank` stays null.
 */
export function buildUserRecord(profile: AdminUserDetail, data: UserSubmissions): UserRecordView {
  const base = toUserRecordView(profile);
  const records: UserRecordRow[] = [];
  let lastSubmittedAt: string | null = null;
  for (const chain of data.chains) {
    const byId = new Map(chain.records.map((r) => [r.id, r]));
    if (!lastSubmittedAt || chain.summary.submitted_at > lastSubmittedAt)
      lastSubmittedAt = chain.summary.submitted_at;
    for (const e of chain.events) {
      const record = byId.get(e.submission_id);
      records.push({
        at: e.at,
        month: record?.target_month ?? data.currentMonth,
        action: e.action,
        submissionStatus: record?.status ?? null,
        actor: e.actor,
      });
    }
  }
  records.sort((a, b) => b.at.localeCompare(a.at));

  const initial = data.chains.find((c) => c.summary.root_kind === 'initial');
  const docs: InitialDoc[] = [];
  let approvedAt: string | null = null;
  if (initial) {
    // newest submission first: a 보완 제출 replaces the file of the same type
    for (const type of INITIAL_DOC_ORDER) {
      for (const record of initial.records) {
        const file = record.files.find((f) => f.doc_type === type);
        if (file) {
          docs.push({ docType: type, fileId: file.id });
          break;
        }
      }
    }
    // events are newest first, so the last approval is the first one
    approvedAt = [...initial.events].reverse().find((e) => e.action === 'approved')?.at ?? null;
  }

  const current =
    data.currentChains.find((c) => c.root_kind === 'monthly') ?? data.currentChains[0];
  return {
    ...base,
    profileOnly: false,
    bankUnavailable: true,
    lastSubmittedAt,
    currentMonth: {
      month: data.currentMonth,
      status: current ? current.status : 'missing',
      submissionId: current?.latest_submission_id ?? null,
    },
    records,
    initialDocs: { approvedAt, docs },
  };
}

@Injectable({ providedIn: 'root' })
export class UserRecordApi {
  private readonly submissions = inject(AdminSubmissionsApi);
  private readonly review = inject(ReviewApi);
  private readonly api = inject(ApiService);

  /** The admin API has no per-student endpoint, so this follows the monthly list and chains. */
  load(profile: AdminUserDetail): Observable<UserRecordView> {
    return this.loadRecord(profile).pipe(
      switchMap((view) =>
        this.api.adminBankAccount(profile.id).pipe(
          map((bank) => ({ ...view, ...toBankView(bank) })),
          // a failed account lookup leaves "—" and the unavailable note, not an error page
          catchError(() => of(view)),
        ),
      ),
    );
  }

  private loadRecord(profile: AdminUserDetail): Observable<UserRecordView> {
    const find = (month?: string) =>
      this.submissions.list({ month, query: profile.login, limit: 50, status: 'all' }).pipe(
        map((page) => ({
          page,
          row: page.items.find((r: MonthlyStudentRow) => r.user.id === profile.id),
        })),
      );
    return find().pipe(
      switchMap(({ page, row }) => {
        const current = page.month;
        const others = page.months
          .filter((m) => m <= current && m !== current)
          .slice(0, MAX_MONTHS);
        const currentChains = row?.chains ?? [];
        return forkJoin(others.map((m) => find(m))).pipe(
          map((rest) => [...currentChains, ...rest.flatMap((r) => r.row?.chains ?? [])]),
          switchMap((all) => {
            const unique = [...new Map(all.map((c) => [c.root_submission_id, c])).values()];
            if (unique.length === 0) return of([] as ChainData[]);
            return forkJoin(
              unique.map((summary) =>
                forkJoin({
                  history: this.review.history(summary.latest_submission_id),
                  events: this.review.events(summary.latest_submission_id),
                }).pipe(
                  map(({ history, events }) => ({
                    summary,
                    records: history.items,
                    events: events.items,
                  })),
                ),
              ),
            );
          }),
          map((chains) =>
            buildUserRecord(profile, { currentMonth: current, currentChains, chains }),
          ),
        );
      }),
      // a failed lookup leaves the profile-only view rather than an error page
      catchError(() => of(toUserRecordView(profile))),
    );
  }
}
