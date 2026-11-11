-- PRD S-6 / M-8: an account change comes with a new 통장사본 for the reviewer to
-- compare against. The PDF is stored like submission files (UPLOAD_DIR/<id>).
-- Nullable only for requests made before this migration; the API always requires it.
ALTER TABLE bank_account_changes
    ADD COLUMN bankbook_file_id UUID UNIQUE,
    ADD COLUMN bankbook_original_name TEXT,
    ADD COLUMN bankbook_size_bytes BIGINT CHECK (bankbook_size_bytes > 0),
    ADD COLUMN bankbook_sha256 BYTEA CHECK (octet_length(bankbook_sha256) = 32),
    ADD CHECK (
        (bankbook_file_id IS NULL) = (bankbook_original_name IS NULL)
        AND (bankbook_file_id IS NULL) = (bankbook_size_bytes IS NULL)
        AND (bankbook_file_id IS NULL) = (bankbook_sha256 IS NULL)
    );
