ALTER TABLE admin_notices ADD COLUMN channel TEXT NOT NULL DEFAULT 'both'
    CHECK (channel IN ('service', 'email', 'both'));
ALTER TABLE admin_notice_recipients ALTER COLUMN notification_id DROP NOT NULL;
ALTER TABLE admin_notice_recipients DROP CONSTRAINT admin_notice_recipients_email_status_check;
ALTER TABLE admin_notice_recipients ADD CONSTRAINT admin_notice_recipients_email_status_check
    CHECK (email_status IN ('not_requested', 'pending', 'sending', 'sent', 'failed', 'skipped'));
