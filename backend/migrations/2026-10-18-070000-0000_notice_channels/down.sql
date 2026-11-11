-- Preserve immutable delivery history; do not invent notifications or delete
-- recipient records to make an older schema accept channel-specific sends.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admin_notices WHERE channel <> 'both') THEN
        RAISE EXCEPTION 'Cannot roll back after channel-specific notices have been sent';
    END IF;
END $$;
ALTER TABLE admin_notice_recipients DROP CONSTRAINT admin_notice_recipients_email_status_check;
ALTER TABLE admin_notice_recipients ADD CONSTRAINT admin_notice_recipients_email_status_check
    CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
ALTER TABLE admin_notice_recipients ALTER COLUMN notification_id SET NOT NULL;
ALTER TABLE admin_notices DROP COLUMN channel;
