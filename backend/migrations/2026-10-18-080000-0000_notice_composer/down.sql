-- Do not discard immutable custom content or make delivered notifications unreadable.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admin_notices WHERE cardinality(audiences) > 0)
       OR EXISTS (SELECT 1 FROM notifications WHERE kind = 'admin_notice') THEN
        RAISE EXCEPTION 'Custom notices exist; keep the composer migration applied';
    END IF;
END $$;
ALTER TABLE admin_notices DROP CONSTRAINT admin_notices_composition_check,
    DROP COLUMN audiences, DROP COLUMN title, DROP COLUMN body;
ALTER TABLE admin_notices DROP CONSTRAINT admin_notices_audience_check;
ALTER TABLE admin_notices ADD CONSTRAINT admin_notices_audience_check
    CHECK (audience IN ('unsubmitted','under_40','hours_40_80','at_least_80'));
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'hours_projected', 'time_requirement_decided', 'final_decided',
    'submission_period_opened', 'submission_reminder', 'study_hours_notice',
    'submission_revision_requested', 'submission_approved',
    'bank_account_approved', 'bank_account_rejected'
));
