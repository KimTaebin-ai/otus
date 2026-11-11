ALTER TABLE file_access_log DROP CONSTRAINT file_access_log_export_purpose,
    DROP COLUMN export_job_id, DROP COLUMN purpose;
DROP TABLE archive_export_events;
DROP TABLE archive_export_jobs;
