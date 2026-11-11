-- Preserve the actual decision and actor at review time, independently of
-- subsequent supplements, profile changes, or a repeated HTTP request.
CREATE TABLE admin_review_decisions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
    event_id BIGINT NOT NULL UNIQUE REFERENCES submission_events(id) ON DELETE RESTRICT,
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL CHECK (actor_role IN ('operator', 'accountant')),
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'revision_requested')),
    review_comment TEXT,
    revision_doc_types TEXT[] NOT NULL DEFAULT '{}',
    idempotency_key UUID NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (decision <> 'revision_requested' OR
        (review_comment IS NOT NULL AND char_length(btrim(review_comment)) BETWEEN 1 AND 1000)),
    CHECK (revision_doc_types <@ ARRAY['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'])
);
CREATE INDEX admin_review_decisions_submission_idx ON admin_review_decisions(submission_id, id DESC);
CREATE INDEX submissions_admin_queue_idx ON submissions(target_month, submitted_at, id)
    WHERE status IN ('pending_review', 'resubmitted');

CREATE FUNCTION admin_audit_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER admin_reviews_no_update_delete BEFORE UPDATE OR DELETE ON admin_review_decisions
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_reviews_no_truncate BEFORE TRUNCATE ON admin_review_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
