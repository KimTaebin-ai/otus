-- Server-side sessions. Only SHA-256 hashes of the cookie value and the CSRF
-- token are stored, so a database leak does not allow session hijacking.
CREATE TABLE sessions (
    id_hash BYTEA PRIMARY KEY CHECK (octet_length(id_hash) = 32),
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    csrf_hash BYTEA NOT NULL CHECK (octet_length(csrf_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- idle timeout is checked against this
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- absolute lifetime
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
