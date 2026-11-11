#!/bin/sh
# Local-only, synthetic PostgreSQL/SMTP verification. The deployed pod is untouched.
set -eu
cd "$(dirname "$0")/.."
task_db="otus-admin-test-db-$$"
task_runner="otus-admin-verifier-$$"
cleanup() {
    podman rm -f --ignore "$task_runner" "$task_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
podman build -f scripts/admin-test.Containerfile -t localhost/otus-admin-test-tools .
podman run -d --name "$task_db" --restart=no \
    -e POSTGRES_PASSWORD=otus-test-only -e POSTGRES_USER=otus \
    -e POSTGRES_DB=otus_admin_test docker.io/library/postgres:18-alpine >/dev/null
ready=0
while [ "$ready" -lt 30 ]; do
    if podman exec "$task_db" pg_isready -U otus -d otus_admin_test >/dev/null 2>&1; then break; fi
    ready=$((ready + 1))
    sleep 1
done
podman run --rm --name "$task_runner" --network "container:$task_db" \
    -v "$PWD:/repo" -v otus-admin-test-target:/buildtarget \
    -v otus-admin-test-registry:/usr/local/cargo/registry \
    -e CARGO_TARGET_DIR=/buildtarget -e CARGO_BUILD_JOBS=2 \
    -e DATABASE_URL=postgres://otus:otus-test-only@127.0.0.1:5432/otus_admin_test \
    localhost/otus-admin-test-tools sh /repo/scripts/admin-verify-in-container.sh
