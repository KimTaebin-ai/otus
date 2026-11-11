-- Drops the constraint only; windows normalised by up.sql are not restored.
ALTER TABLE cycles DROP CONSTRAINT cycles_whole_kst_month;
