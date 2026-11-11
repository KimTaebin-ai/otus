-- Student cohort (기수), Korean name, and date of birth. All nullable on
-- purpose: the 42 /v2/me payload carries none of them (no cohort ordinal —
-- pool_year/pool_month are a piscine calendar, not a cohort number; display
-- names are not language-tagged; no birth date), and demo/non-42 users may
-- have none. They are filled later (admin entry / roster import); existing
-- rows stay valid with NULL. IF NOT EXISTS keeps a re-run a no-op.
-- ordinal is free text on purpose: cohorts are written 5, 7기, 8a, 9기A…,
-- so only a non-blank, bounded value is enforced — no format regex.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ordinal TEXT
        CHECK (ordinal IS NULL OR char_length(btrim(ordinal)) BETWEEN 1 AND 50),
    ADD COLUMN IF NOT EXISTS ko_name TEXT
        CHECK (ko_name IS NULL OR char_length(btrim(ko_name)) BETWEEN 1 AND 50),
    ADD COLUMN IF NOT EXISTS date_of_birth DATE;
