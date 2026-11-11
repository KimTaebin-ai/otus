-- 취업 상태 (U06): the student changes it, it saves immediately, and the change time
-- is kept. Employed students are excluded from missing-submission reminders.
ALTER TABLE users
    ADD COLUMN employed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN employment_updated_at TIMESTAMPTZ;

-- 계좌 (PRD: 민감). Every change is a request reviewed before it takes effect; the
-- current account is the latest approved row, and the table is the 변경 전후 history.
-- The account number is encrypted per field (AES-256-GCM, key outside the DB, bound to
-- the user via associated data); only the last 4 digits are kept for masking.
CREATE TABLE bank_account_changes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    bank TEXT NOT NULL CHECK (char_length(bank) BETWEEN 1 AND 30),
    -- 12-byte nonce || ciphertext || 16-byte tag
    account_number_enc BYTEA NOT NULL CHECK (octet_length(account_number_enc) > 28),
    -- which encryption key; lets keys rotate without re-encrypting old rows at once
    key_id SMALLINT NOT NULL,
    account_last4 TEXT NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
    -- pending → approved / rejected; a newer request cancels an older pending one
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    decided_by BIGINT REFERENCES users (id) ON DELETE RESTRICT,
    decision_note TEXT,
    CHECK ((status IN ('pending', 'cancelled')) = (decided_by IS NULL))
);

CREATE UNIQUE INDEX bank_account_changes_one_pending_idx
    ON bank_account_changes (user_id) WHERE status = 'pending';
CREATE INDEX bank_account_changes_user_idx
    ON bank_account_changes (user_id, decided_at DESC) WHERE status = 'approved';
