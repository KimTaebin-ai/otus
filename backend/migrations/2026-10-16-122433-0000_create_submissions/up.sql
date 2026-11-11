-- Enum values match api.md (the source of truth).
-- kind: initial (최초 4종) / monthly (고용보험가입내역서) / supplement (보완 제출 for parent_id)
-- status: draft → pending_review (검토 대기) → approved
--                                           ↘ revision_requested (재검토 요청) → resubmitted (재검토 대기)
CREATE TABLE submissions (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('initial', 'monthly', 'supplement')),
    -- api.md target_month (YYYY-MM), stored as the first day of the month
    target_month DATE NOT NULL CHECK (extract(day FROM target_month) = 1),
    parent_id UUID REFERENCES submissions (id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_review', 'approved', 'revision_requested', 'resubmitted')),
    -- set when leaving draft
    submitted_at TIMESTAMPTZ,
    -- reviewer's reason, shown while status = revision_requested
    review_comment TEXT,
    -- fixed at creation: initial = all 4, monthly = employment_insurance,
    -- supplement = the parent's revision_doc_types (or the parent's required list)
    required_doc_types TEXT[] NOT NULL
        CHECK (cardinality(required_doc_types) > 0
            AND required_doc_types <@ ARRAY['id_card', 'resident_abstract', 'bankbook', 'employment_insurance']),
    -- doc types the reviewer asked to resubmit; a supplement requires exactly these
    -- (empty = all of the parent's documents)
    revision_doc_types TEXT[] NOT NULL DEFAULT '{}'
        CHECK (revision_doc_types <@ ARRAY['id_card', 'resident_abstract', 'bankbook', 'employment_insurance']),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'supplement') = (parent_id IS NOT NULL)),
    CHECK ((status = 'draft') = (submitted_at IS NULL))
);

SELECT diesel_manage_updated_at('submissions');

-- POST /api/submissions returns the existing draft for the same kind + target_month
-- (+ parent for supplements)
CREATE UNIQUE INDEX submissions_one_draft_idx
    ON submissions (user_id, kind, target_month, parent_id) NULLS NOT DISTINCT
    WHERE status = 'draft';
-- 최초 4종 can only be submitted once
CREATE UNIQUE INDEX submissions_one_initial_idx
    ON submissions (user_id) WHERE kind = 'initial' AND status <> 'draft';
-- one submitted monthly per month (corrections go through supplements)
CREATE UNIQUE INDEX submissions_one_monthly_idx
    ON submissions (user_id, target_month) WHERE kind = 'monthly' AND status <> 'draft';
CREATE INDEX submissions_parent_id_idx ON submissions (parent_id);

-- Files are never deleted (no auto-deletion until a retention policy exists).
-- Re-uploading a doc_type adds a new row and points the old one at it via superseded_by.
CREATE TABLE submission_files (
    -- also the on-disk filename under UPLOAD_DIR
    id UUID PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
    doc_type TEXT NOT NULL
        CHECK (doc_type IN ('id_card', 'resident_abstract', 'bankbook', 'employment_insurance')),
    original_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
    -- deferred: the old row is pointed at the new one before the new one is inserted,
    -- because the partial unique index below allows only one current file per doc_type
    superseded_by UUID REFERENCES submission_files (id) DEFERRABLE INITIALLY DEFERRED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX submission_files_current_idx
    ON submission_files (submission_id, doc_type) WHERE superseded_by IS NULL;

-- Status history (이력) and idempotency: a repeated finalize with the same
-- idempotency_key returns the existing transition instead of applying it twice.
CREATE TABLE submission_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    idempotency_key UUID UNIQUE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX submission_events_submission_id_idx ON submission_events (submission_id);
