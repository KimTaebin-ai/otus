ALTER TABLE admin_notices ADD COLUMN audience TEXT NOT NULL DEFAULT 'unsubmitted'
    CHECK (audience IN ('unsubmitted', 'under_40', 'hours_40_80', 'at_least_80'));
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'hours_projected', 'time_requirement_decided', 'final_decided',
    'submission_period_opened', 'submission_reminder', 'study_hours_notice',
    'submission_revision_requested', 'submission_approved',
    'bank_account_approved', 'bank_account_rejected'
));
