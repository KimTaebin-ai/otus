-- Dropping the columns discards any cohort/Korean-name/birth-date data
-- entered since; that is the accepted cost of rolling this migration back
-- (the guarded migrations in this repo only refuse rollback for immutable
-- audit data, which these profile fields are not).
ALTER TABLE users
    DROP COLUMN IF EXISTS date_of_birth,
    DROP COLUMN IF EXISTS ko_name,
    DROP COLUMN IF EXISTS ordinal;
