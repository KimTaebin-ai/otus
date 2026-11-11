ALTER TABLE bank_account_changes
    DROP COLUMN bankbook_sha256,
    DROP COLUMN bankbook_size_bytes,
    DROP COLUMN bankbook_original_name,
    DROP COLUMN bankbook_file_id;
