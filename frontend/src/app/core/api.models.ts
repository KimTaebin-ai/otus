// Mirrors api.md (the source of truth). Keep in sync when api.md changes.
// The types admin-front also uses are in shared/core/api-types.ts, re-exported here.

import { DocType, SubmissionStatus } from '@otus/shared/core/api-types';

export * from '@otus/shared/core/api-types';

export type SubmissionKind = 'initial' | 'monthly' | 'supplement';

export interface SubmissionFile {
  file_id: string;
  doc_type: DocType;
  original_name: string;
  size: number;
  /** ISO 8601, KST (+09:00) */
  uploaded_at: string;
}

export interface Submission {
  id: string;
  kind: SubmissionKind;
  /** YYYY-MM */
  target_month: string;
  status: SubmissionStatus;
  parent_id: string | null;
  /** null while draft */
  submitted_at: string | null;
  /** only while revision_requested */
  review_comment: string | null;
  required_doc_types: DocType[];
  files: SubmissionFile[];
  created_at: string;
}

/** POST /api/submissions/{id}/finalize header (api.md) */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export interface CreateSubmissionRequest {
  kind: SubmissionKind;
  target_month: string;
  parent_id?: string | null;
}

/** GET /api/submissions query. All optional. */
export interface ListSubmissionsQuery {
  /** YYYY-MM */
  month?: string;
  limit?: number;
  include_drafts?: boolean;
}

export type CycleState = 'not_set' | 'upcoming' | 'open' | 'closed';

export interface Cycle {
  /** YYYY-MM */
  target_month: string;
  state: CycleState;
  opens_at: string | null;
  closes_at: string | null;
  /** days until closes_at in KST (0 = today, negative = past), null when not_set */
  d_day: number | null;
  /** 발급 기준 (YYYY-MM-DD): documents must be issued on or after this date */
  issued_after: string;
}

export interface BankAccount {
  bank: string;
  /** always masked, e.g. "•••• 6789"; the full number never reaches the client */
  account_number_masked: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_at: string;
  decided_at: string | null;
  /** rejection reason */
  decision_note: string | null;
  /** the 통장사본 sent with the request */
  bankbook: { file_id: string; original_name: string; size: number } | null;
}

export interface BankAccountState {
  /** approved account used for payment; null until one is approved */
  current: BankAccount | null;
  /** change awaiting review; current stays in use until it's approved */
  pending: BankAccount | null;
  last_rejected: BankAccount | null;
}

export interface BankAccountChangeRequest {
  bank: string;
  account_number: string;
  /** new 통장사본 PDF, required */
  bankbook: File;
}

/** Demo only: stands in for the reviewer screens */
export interface DevSetStatusRequest {
  status: 'approved' | 'revision_requested';
  review_comment?: string;
  revision_doc_types?: DocType[];
}

/** GET /api/submissions, newest first */
export interface SubmissionList {
  items: Submission[];
}

export type TimePhase = 'in_progress' | 'awaiting_decision' | 'decided';
export type TimeTier = 'tier_1' | 'tier_2';

/** GET /api/me/time-requirements item. 시간 요건·서류·최종 수령 대상은 서로 다른 축이다. */
export interface TimeRequirement {
  /** YYYY-MM */
  month: string;
  phase: TimePhase;
  /** when the count was last updated */
  as_of: string;
  /** integer seconds, after the 12 h/day cap */
  recognized_seconds: number;
  /** policy of that month, ascending by seconds. The only source of hours and won */
  thresholds: { tier: TimeTier; seconds: number; amount: number }[];
  /** in_progress only: the tier reached so far (not a decision) */
  projected_tier: TimeTier | null;
  decides_at: string;
  /** decided only */
  result: {
    status: 'met' | 'not_met' | 'on_hold';
    /** only when met */
    tier: TimeTier | null;
    decided_at: string;
  } | null;
  final: {
    status: 'undecided' | 'eligible' | 'not_eligible';
    /** won, when eligible */
    amount: number | null;
    decided_at: string | null;
  };
}

export interface TimeRequirementList {
  items: TimeRequirement[];
}

/** GET /api/me/time-requirements query. All optional. */
export interface TimeRequirementQuery {
  /** YYYY-MM */
  month?: string;
  /** default 12, max 36 */
  limit?: number;
}

/** GET /api/notifications. Wording lives in FE; read state belongs to the server. */
export interface AppNotification {
  id: number;
  kind: string;
  created_at: string;
  read_at: string | null;
  data: {
    month?: string;
    tier?: TimeTier;
    status?: string;
    submission_id?: string;
    decision_note?: string;
    study_hours?: 0 | 40 | 80;
    title?: string;
    body?: string;
  };
}

export interface NotificationList {
  items: AppNotification[];
  next_before: number | null;
}
