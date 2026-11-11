CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- 42 Intra user id; NULL only for demo users
    intra_id BIGINT UNIQUE,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    -- 교육생 / 운영 담당자 / 회계·지정 담당자 / 관리자 (PRD RBAC).
    -- Staff roles are granted only to whitelisted accounts, never at login.
    role TEXT NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'operator', 'accountant', 'admin')),
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (is_demo OR intra_id IS NOT NULL)
);

-- Demo logins live in their own namespace so a demo user can never
-- take over (or block) a real 42 login with the same name.
CREATE UNIQUE INDEX users_login_idx ON users (login) WHERE NOT is_demo;
CREATE UNIQUE INDEX users_demo_login_idx ON users (login) WHERE is_demo;

SELECT diesel_manage_updated_at('users');
