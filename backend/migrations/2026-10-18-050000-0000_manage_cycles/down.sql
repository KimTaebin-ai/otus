-- Refuse rollback when custom periods exist; never silently widen saved periods.
ALTER TABLE cycles ADD CONSTRAINT cycles_whole_kst_month CHECK (
    opens_at = (target_month::timestamp AT TIME ZONE 'Asia/Seoul')
    AND closes_at = ((target_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')
);
DROP TABLE cycle_changes;
ALTER TABLE cycles DROP COLUMN version;
ALTER TABLE cycles DROP CONSTRAINT cycles_within_target_month;
