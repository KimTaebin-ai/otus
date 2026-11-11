-- Issue #10: server-held notifications. The bell's read state lives here, not in
-- localStorage. `data` is a JSON object stored as TEXT (the server only ever
-- writes it via serde_json) so no account numbers or secrets can ride along
-- unnoticed -- writers must keep it to the api.md fields per kind.
CREATE TABLE notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN (
        'hours_projected', 'time_requirement_decided', 'final_decided',
        'submission_period_opened', 'submission_reminder',
        'submission_revision_requested', 'submission_approved',
        'bank_account_approved', 'bank_account_rejected'
    )),
    data TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
