#!/bin/sh
# Run only in the isolated test-tools container, with the repo mounted at /repo.
set -eu
export PYTHONDONTWRITEBYTECODE=1
case "${DATABASE_URL:-}" in
  postgres://otus:otus-test-only@127.0.0.1:5432/otus_admin_test) ;;
  *) echo 'Refusing to run without the dedicated otus_admin_test database.' >&2; exit 1 ;;
esac
cd /work
diesel migration run --migration-dir /repo/backend/migrations
diesel print-schema > /tmp/admin-generated-schema.rs
cmp /tmp/admin-generated-schema.rs /repo/backend/src/schema.rs
cargo fmt --manifest-path /repo/backend/Cargo.toml --check
cargo test --locked --manifest-path /repo/backend/Cargo.toml
cargo clippy --locked --manifest-path /repo/backend/Cargo.toml --all-targets -- -D warnings
cargo build --locked --manifest-path /repo/backend/Cargo.toml
python3 /repo/scripts/admin-api-smoke.py --binary "$CARGO_TARGET_DIR/debug/otus-backend"
python3 /repo/scripts/study-hours-smoke.py --binary "$CARGO_TARGET_DIR/debug/otus-backend"
