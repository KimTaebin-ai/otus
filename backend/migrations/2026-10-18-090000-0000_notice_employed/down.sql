-- Keep immutable notice history when it uses the new audience.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM admin_notices
        WHERE 'employed' = ANY(audiences) OR audience = 'employed' OR cardinality(audiences) > 6
    ) THEN
        RAISE EXCEPTION 'Employed notices exist; keep the employed audience migration applied';
    END IF;
END $$;
ALTER TABLE admin_notices DROP CONSTRAINT admin_notices_composition_check;
ALTER TABLE admin_notices ADD CONSTRAINT admin_notices_composition_check CHECK (
    (cardinality(audiences) = 0 AND title IS NULL AND body IS NULL) OR
    (cardinality(audiences) BETWEEN 1 AND 6
     AND audiences <@ ARRAY['unsubmitted','under_40','hours_40_80','at_least_80','eligible','all']::TEXT[]
     AND array_position(audiences, NULL) IS NULL
     AND title IS NOT NULL AND char_length(btrim(title)) BETWEEN 1 AND 120
     AND body IS NOT NULL AND char_length(btrim(body)) BETWEEN 1 AND 5000)
);
ALTER TABLE admin_notices DROP CONSTRAINT admin_notices_audience_check;
ALTER TABLE admin_notices ADD CONSTRAINT admin_notices_audience_check
    CHECK (audience IN ('unsubmitted','under_40','hours_40_80','at_least_80','eligible','all'));
