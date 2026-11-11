-- Ancestor approvals must use the same immutable actor snapshot as the leaf
-- decision. Keep an explicit relation instead of reading a mutable user profile.
CREATE TABLE admin_review_event_links (
    event_id BIGINT PRIMARY KEY REFERENCES submission_events(id) ON DELETE RESTRICT,
    decision_id BIGINT NOT NULL REFERENCES admin_review_decisions(id) ON DELETE RESTRICT
);
CREATE INDEX admin_review_event_links_decision_idx ON admin_review_event_links(decision_id);

-- Recover only old propagated events whose chain, actor, transaction timestamp
-- and existing leaf-ID note all identify a recorded decision. Never guess an
-- actor for legacy/demo events without an immutable decision snapshot.
WITH RECURSIVE ancestors AS (
    SELECT d.id AS decision_id, d.submission_id AS reviewed_id,
           d.actor_user_id, d.created_at, s.parent_id AS submission_id
    FROM admin_review_decisions d JOIN submissions s ON s.id = d.submission_id
    WHERE d.decision = 'approved' AND s.parent_id IS NOT NULL
    UNION
    SELECT a.decision_id, a.reviewed_id, a.actor_user_id, a.created_at, s.parent_id
    FROM ancestors a JOIN submissions s ON s.id = a.submission_id
    WHERE s.parent_id IS NOT NULL
)
INSERT INTO admin_review_event_links (event_id, decision_id)
SELECT e.id, a.decision_id FROM ancestors a
JOIN submission_events e ON e.submission_id = a.submission_id
    AND e.to_status = 'approved' AND e.actor_user_id = a.actor_user_id
    AND e.created_at = a.created_at
    AND e.note = format('보완 제출 %s 승인', a.reviewed_id);

CREATE TRIGGER admin_review_event_links_no_update_delete
    BEFORE UPDATE OR DELETE ON admin_review_event_links
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_review_event_links_no_truncate
    BEFORE TRUNCATE ON admin_review_event_links
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
