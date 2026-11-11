-- Keep delivered notifications and immutable outbox history. Refuse to roll back
-- once the new audience feature has been used instead of deleting audit data.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admin_notices WHERE audience <> 'unsubmitted') THEN
        RAISE EXCEPTION 'Cannot roll back after study-hours notices have been sent';
    END IF;
END $$;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'hours_projected', 'time_requirement_decided', 'final_decided',
    'submission_period_opened', 'submission_reminder',
    'submission_revision_requested', 'submission_approved',
    'bank_account_approved', 'bank_account_rejected'
));
ALTER TABLE admin_notices DROP COLUMN audience;
