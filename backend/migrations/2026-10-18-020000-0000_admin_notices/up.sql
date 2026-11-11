CREATE TABLE admin_notices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_month DATE NOT NULL CHECK (extract(day FROM target_month) = 1),
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role TEXT NOT NULL CHECK (actor_role IN ('operator', 'accountant', 'admin')),
    employed_excluded BIGINT NOT NULL CHECK (employed_excluded >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE admin_notice_operations (
    idempotency_key UUID PRIMARY KEY,
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    notice_id BIGINT NOT NULL REFERENCES admin_notices(id) ON DELETE RESTRICT,
    response_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE admin_notice_recipients (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notice_id BIGINT NOT NULL REFERENCES admin_notices(id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
    email_recipient TEXT,
    email_status TEXT NOT NULL CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
    email_attempts INTEGER NOT NULL DEFAULT 0 CHECK (email_attempts >= 0),
    claim_token UUID,
    claimed_at TIMESTAMPTZ,
    email_sent_at TIMESTAMPTZ,
    last_error_code TEXT,
    message_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (notice_id, user_id)
);
CREATE INDEX admin_notice_recipients_notice_idx ON admin_notice_recipients(notice_id, id);
CREATE INDEX admin_notice_recipients_pending_idx ON admin_notice_recipients(id)
    WHERE email_status IN ('pending', 'sending');
CREATE TABLE admin_notice_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notice_id BIGINT NOT NULL REFERENCES admin_notices(id) ON DELETE RESTRICT,
    recipient_id BIGINT REFERENCES admin_notice_recipients(id) ON DELETE RESTRICT,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    event TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_notice_events_notice_idx ON admin_notice_events(notice_id, id);
CREATE TRIGGER admin_notices_no_update_delete BEFORE UPDATE OR DELETE ON admin_notices
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_notices_no_truncate BEFORE TRUNCATE ON admin_notices
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_notice_operations_no_update_delete BEFORE UPDATE OR DELETE ON admin_notice_operations
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_notice_operations_no_truncate BEFORE TRUNCATE ON admin_notice_operations
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_notice_events_no_update_delete BEFORE UPDATE OR DELETE ON admin_notice_events
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER admin_notice_events_no_truncate BEFORE TRUNCATE ON admin_notice_events
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
