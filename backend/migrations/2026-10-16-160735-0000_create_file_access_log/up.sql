-- PRD: every view/download of an original document is recorded. Append-only: a trigger
-- rejects UPDATE, DELETE and TRUNCATE, so the app's own role can't rewrite history.
CREATE TABLE file_access_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- submission_files.id or bank_account_changes.bankbook_file_id
    file_id UUID NOT NULL,
    accessed_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- whose document it is; differs from accessed_by when staff open it
    owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- 'owner' or the staff role that allowed it
    access_basis TEXT NOT NULL CHECK (access_basis IN ('owner', 'accountant')),
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX file_access_log_file_idx ON file_access_log (file_id, accessed_at);
CREATE INDEX file_access_log_owner_idx ON file_access_log (owner_id, accessed_at);

CREATE FUNCTION file_access_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'file_access_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER file_access_log_no_update_delete
    BEFORE UPDATE OR DELETE ON file_access_log
    FOR EACH ROW EXECUTE FUNCTION file_access_log_append_only();
CREATE TRIGGER file_access_log_no_truncate
    BEFORE TRUNCATE ON file_access_log
    FOR EACH STATEMENT EXECUTE FUNCTION file_access_log_append_only();
