-- 관리자(admin) may also open originals (PDFs), like operators and accountants.
-- The log stays append-only; only the allowed access bases widen.
ALTER TABLE file_access_log DROP CONSTRAINT file_access_log_access_basis_check;
ALTER TABLE file_access_log
    ADD CONSTRAINT file_access_log_access_basis_check
    CHECK (access_basis IN ('owner', 'operator', 'accountant', 'admin'));
