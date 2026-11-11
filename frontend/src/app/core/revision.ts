import { Submission, SubmissionKind } from './api.models';

/** A submission chain: the first submission of a kind and the newest of it and its supplements. */
export interface Outcome {
  /** The kind's first submission (`monthly` or `initial`) */
  monthly: Submission;
  /** The newest of it and its supplements; its status is what the user sees. */
  latest: Submission;
}

/**
 * The chain that starts with the submission of `kind`, or null when there is none. `items` come
 * newest first and exclude drafts. A supplement belongs to the chain through `parent_id`, so
 * the same list can hold the chain of an `initial` and one of a `monthly`.
 */
export function chainOutcome(items: Submission[], kind: SubmissionKind): Outcome | null {
  const first = items.find((s) => s.kind === kind);
  if (!first) {
    return null;
  }
  // oldest first, so a supplement's parent is already in the chain when it's checked
  const chain = new Set([first.id]);
  for (const s of [...items].reverse()) {
    if (s.kind === 'supplement' && s.parent_id && chain.has(s.parent_id)) {
      chain.add(s.id);
    }
  }
  return { monthly: first, latest: items.find((s) => chain.has(s.id)) ?? first };
}

/** Where a student answers a 재검토 요청: the 최초 4종 chain has its own screen, the rest is /submit. */
export type RevisionPath = '/submit' | '/submit/initial';

/** The screen for the revision request on `s`, following `parent_id` up to the chain's first submission. */
export function revisionPath(s: Submission, items: Submission[]): RevisionPath {
  let root = s;
  for (let i = 0; i < items.length && root.kind === 'supplement' && root.parent_id; i++) {
    const parent = items.find((x) => x.id === root.parent_id);
    if (!parent) {
      break;
    }
    root = parent;
  }
  return root.kind === 'initial' ? '/submit/initial' : '/submit';
}
