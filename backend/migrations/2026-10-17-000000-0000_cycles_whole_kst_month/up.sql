-- A cycle is one whole KST calendar month: opens_at = 1st 00:00 Asia/Seoul (inclusive),
-- closes_at = next month's 1st 00:00 Asia/Seoul (exclusive).
--
-- Existing rows are normalised to that window first so the constraint can be added.
-- RISK: this rewrites any non-whole-month window (e.g. the old PRD default 21st 09:00 ~
-- last day 23:59:59) to the whole month, which can reopen a month that was closed early
-- or widen a window. The down migration cannot restore the old values.
UPDATE cycles
SET opens_at = target_month::timestamp AT TIME ZONE 'Asia/Seoul',
    closes_at = (target_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'
WHERE opens_at IS DISTINCT FROM target_month::timestamp AT TIME ZONE 'Asia/Seoul'
   OR closes_at IS DISTINCT FROM (target_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul';

ALTER TABLE cycles ADD CONSTRAINT cycles_whole_kst_month CHECK (
    opens_at = (target_month::timestamp AT TIME ZONE 'Asia/Seoul')
    AND closes_at = ((target_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')
);
