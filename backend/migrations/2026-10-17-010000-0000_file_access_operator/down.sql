ALTER TABLE file_access_log DROP CONSTRAINT file_access_log_access_basis_check;
ALTER TABLE file_access_log
    ADD CONSTRAINT file_access_log_access_basis_check
    CHECK (access_basis IN ('owner', 'accountant'));
