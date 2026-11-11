-- Keep existing dates intact; allow a configurable window inside its KST month.
ALTER TABLE cycles DROP CONSTRAINT cycles_whole_kst_month;
ALTER TABLE cycles ADD CONSTRAINT cycles_within_target_month CHECK (
    opens_at >= (target_month::timestamp AT TIME ZONE 'Asia/Seoul')
    AND closes_at <= ((target_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')
);
ALTER TABLE cycles ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE cycle_changes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_month DATE NOT NULL REFERENCES cycles(target_month) ON DELETE RESTRICT,
    version BIGINT NOT NULL,
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL CHECK (actor_role IN ('operator', 'admin')),
    previous_opens_at TIMESTAMPTZ,
    previous_closes_at TIMESTAMPTZ,
    opens_at TIMESTAMPTZ NOT NULL,
    closes_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_month, version)
);
CREATE TRIGGER cycle_changes_no_update_delete BEFORE UPDATE OR DELETE ON cycle_changes
    FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
CREATE TRIGGER cycle_changes_no_truncate BEFORE TRUNCATE ON cycle_changes
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
