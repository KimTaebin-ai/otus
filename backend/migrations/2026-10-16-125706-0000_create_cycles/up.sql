-- 접수 기간 per target month. Since 2026-10-17 a cycle is the whole KST calendar month,
-- [1st 00:00, next 1st 00:00) KST: see the cycles_whole_kst_month migration.
-- No row for a month = closed: upload, finalize and supplements are all locked.
CREATE TABLE cycles (
    -- first day of the month
    target_month DATE PRIMARY KEY CHECK (extract(day FROM target_month) = 1),
    opens_at TIMESTAMPTZ NOT NULL,
    closes_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (opens_at < closes_at)
);

SELECT diesel_manage_updated_at('cycles');
