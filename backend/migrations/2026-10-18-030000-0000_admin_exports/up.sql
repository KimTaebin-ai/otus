CREATE TABLE archive_export_jobs (
    id UUID PRIMARY KEY,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_month DATE NOT NULL CHECK (extract(day FROM target_month) = 1),
    idempotency_key UUID NOT NULL,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    snapshot TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'failed')),
    student_count BIGINT NOT NULL CHECK (student_count > 0),
    pdf_count BIGINT NOT NULL CHECK (pdf_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    key_id SMALLINT,
    size_bytes BIGINT,
    sha256 BYTEA CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
    UNIQUE (created_by, idempotency_key)
);
CREATE UNIQUE INDEX archive_export_jobs_one_creating_idx ON archive_export_jobs(created_by)
    WHERE status = 'creating';
CREATE INDEX archive_export_jobs_expiry_idx ON archive_export_jobs(expires_at) WHERE status = 'ready';
CREATE TABLE archive_export_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES archive_export_jobs(id) ON DELETE RESTRICT,
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('requested', 'ready', 'failed', 'downloaded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX archive_export_events_job_idx ON archive_export_events(job_id, id);
CREATE TRIGGER archive_exports_no_update_delete BEFORE UPDATE OR DELETE ON archive_export_events
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER archive_exports_no_truncate BEFORE TRUNCATE ON archive_export_events
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
ALTER TABLE file_access_log
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'download' CHECK (purpose IN ('download', 'bulk_export')),
    ADD COLUMN export_job_id UUID REFERENCES archive_export_jobs(id) ON DELETE RESTRICT,
    ADD CONSTRAINT file_access_log_export_purpose CHECK ((purpose = 'bulk_export') = (export_job_id IS NOT NULL));
