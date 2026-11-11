-- Stored PDFs are encrypted at rest (AES-256-GCM with FILE_ENCRYPTION_KEY, bound to the
-- file id). key_id names the key; NULL marks a file stored as plaintext before this.
ALTER TABLE submission_files ADD COLUMN key_id SMALLINT;
ALTER TABLE bank_account_changes ADD COLUMN bankbook_key_id SMALLINT;
