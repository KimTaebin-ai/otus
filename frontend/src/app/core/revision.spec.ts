import { Submission, SubmissionKind, SubmissionStatus } from './api.models';
import { chainOutcome, revisionPath } from './revision';

function sub(
  id: string,
  kind: SubmissionKind,
  status: SubmissionStatus,
  parent_id: string | null = null,
): Submission {
  return {
    id,
    kind,
    target_month: '2026-09',
    status,
    parent_id,
    submitted_at: '2026-09-21T09:41:00+09:00',
    review_comment: null,
    required_doc_types: ['id_card'],
    files: [],
    created_at: '2026-09-21T09:40:00+09:00',
  };
}

describe('chainOutcome', () => {
  // newest first, like GET /api/submissions
  const items = [
    sub('s-m', 'supplement', 'revision_requested', 'm-1'),
    sub('m-1', 'monthly', 'resubmitted'),
    sub('s-i', 'supplement', 'resubmitted', 'i-1'),
    sub('i-1', 'initial', 'resubmitted'),
  ];

  it('follows the initial and the monthly each to their own newest supplement', () => {
    expect(chainOutcome(items, 'initial')?.latest.id).toBe('s-i');
    expect(chainOutcome(items, 'monthly')?.latest.id).toBe('s-m');
  });

  it('is null without a submission of that kind', () => {
    expect(chainOutcome([sub('m-1', 'monthly', 'approved')], 'initial')).toBeNull();
  });
});

describe('revisionPath', () => {
  const items = [
    sub('s-m', 'supplement', 'revision_requested', 'm-1'),
    sub('m-1', 'monthly', 'resubmitted'),
    sub('s-i', 'supplement', 'revision_requested', 'i-1'),
    sub('i-1', 'initial', 'resubmitted'),
  ];

  it('sends a request on the initial chain to its own screen, also through a supplement', () => {
    expect(revisionPath(items[3], items)).toBe('/submit/initial');
    expect(revisionPath(items[2], items)).toBe('/submit/initial');
  });

  it('keeps the monthly chain on /submit', () => {
    expect(revisionPath(items[1], items)).toBe('/submit');
    expect(revisionPath(items[0], items)).toBe('/submit');
  });
});
