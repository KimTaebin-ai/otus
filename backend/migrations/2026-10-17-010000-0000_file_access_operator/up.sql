-- Issue #9: operators (운영 담당자) may also open originals, alongside accountants.
-- The log stays append-only; only the allowed access bases widen.
ALTER TABLE file_access_log DROP CONSTRAINT file_access_log_access_basis_check;
ALTER TABLE file_access_log
    ADD CONSTRAINT file_access_log_access_basis_check
    CHECK (access_basis IN ('owner', 'operator', 'accountant'));
