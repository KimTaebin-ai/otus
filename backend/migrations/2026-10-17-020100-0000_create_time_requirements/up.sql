-- Issue #10: one recognised-hours snapshot per student per month. Three axes
-- stay separate columns: result (시간 요건), tier, and final (최종 수령 대상,
-- decided by staff, never auto-filled from result).
CREATE TABLE time_requirements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    target_month DATE NOT NULL,
    recognized_seconds BIGINT NOT NULL DEFAULT 0,
    as_of TIMESTAMPTZ NOT NULL DEFAULT now(),
    result_status TEXT CHECK (result_status IN ('met', 'not_met', 'on_hold')),
    tier TEXT CHECK (tier IN ('tier_1', 'tier_2')),
    decided_at TIMESTAMPTZ,
    final_status TEXT NOT NULL DEFAULT 'undecided'
        CHECK (final_status IN ('undecided', 'eligible', 'not_eligible')),
    final_amount BIGINT,
    final_decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, target_month),
    CHECK (
        (result_status IS NULL AND tier IS NULL)
        OR (result_status = 'met' AND tier IS NOT NULL)
        OR (result_status IN ('not_met', 'on_hold') AND tier IS NULL)
    )
);
CREATE INDEX time_requirements_month_idx ON time_requirements (target_month);
SELECT diesel_manage_updated_at('time_requirements');
