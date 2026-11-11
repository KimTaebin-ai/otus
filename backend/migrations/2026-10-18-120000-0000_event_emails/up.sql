-- Email copies of the in-app notifications for review results (승인, 보완 요청) and the
-- 시간 요건 notices. A row is written in the same transaction as its notification, so a rolled
-- back review never emails. The worker (mail.rs) sends it; a send that was interrupted becomes
-- `failed` / `delivery_unknown` and is not retried on its own (SMTP has no exactly-once ack).
-- The recipient is resolved from the user's login at send time, never stored.
CREATE TABLE event_emails (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notification_id BIGINT NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE RESTRICT,
    subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claim_token UUID,
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error_code TEXT,
    message_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX event_emails_pending_idx ON event_emails(id) WHERE status IN ('pending', 'sending');
