// Mirrors api.md (the source of truth): the types both apps use. The student app's
// frontend/src/app/core/api.models.ts re-exports these and adds the rest; together they mirror
// api.md. Keep in sync when api.md changes.

export type Role = 'student' | 'operator' | 'accountant' | 'admin';

export type SubmissionStatus =
  'draft' | 'pending_review' | 'approved' | 'revision_requested' | 'resubmitted';

export type DocType = 'id_card' | 'resident_abstract' | 'bankbook' | 'employment_insurance';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  id_card: '신분증',
  resident_abstract: '주민등록초본',
  bankbook: '통장사본',
  employment_insurance: '고용보험가입내역서',
};

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  draft: '임시 저장',
  pending_review: '검토 대기',
  approved: '승인 완료',
  revision_requested: '재검토 요청',
  resubmitted: '재검토 대기',
};

/** 기수 선택지. 지원금 지급이 끝난 교육생과 트랜스퍼 교육생도 고를 수 있다. */
export const COHORTS = [
  { value: '3A', label: '3기 A' },
  { value: '3B', label: '3기 B' },
  { value: '3C', label: '3기 C' },
  { value: '4A', label: '4기 A' },
  { value: '4B', label: '4기 B' },
  { value: 'ended', label: '지원금 지급 종료' },
  { value: 'transfer', label: '트랜스퍼 교육생' },
] as const;

export type Cohort = (typeof COHORTS)[number]['value'];

export interface Me {
  id: number;
  login: string;
  display_name: string;
  role: Role;
  is_demo: boolean;
  /** 취업 상태 (U06) */
  employed: boolean;
  employment_updated_at: string | null;
  /** U01 branching: false → U02 (최초 4종), true → U03 (home) */
  initial_submitted: boolean;
  /** 기수 (자유 텍스트, 1~50자). 본인이 입력하기 전에는 null */
  ordinal?: string | null;
  /** 한글 이름 (1~50자). 본인이 입력하기 전에는 null */
  ko_name?: string | null;
  /** 생년월일 (YYYY-MM-DD). 본인이 입력하기 전에는 null */
  date_of_birth?: string | null;
  /** 이번 달 KST 학습 시간 구간. 하루 최대 12시간 인정. 조회 불가 시 null. */
  study_hours: 0 | 40 | 80 | null;
}

/** Which login options the server has enabled */
export interface AuthMethods {
  forty_two: boolean;
  demo: boolean;
}

/** `/login?error=` codes set by the 42 OAuth callback */
export const LOGIN_ERRORS: Record<string, string> = {
  oauth_denied: '42 로그인을 취소했습니다.',
  oauth_state: '로그인 요청이 만료되었습니다. 다시 시도해 주세요.',
  not_campus_member: '42 경산 캠퍼스 교육생만 이용할 수 있습니다.',
  oauth_failed: '42 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'FILE_TOO_LARGE'
  | 'NOT_PDF'
  | 'CYCLE_CLOSED'
  | 'DOC_TYPE_NOT_ALLOWED'
  | 'MALWARE_DETECTED'
  | 'SCAN_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

/** Body of every error response */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
