# Build from the repo root: podman build -f deploy/db.Containerfile -t localhost/otus-db .
# Stock Postgres plus an init script that creates the app's non-superuser role.
FROM docker.io/library/postgres:18-alpine
COPY deploy/db-init.sh /docker-entrypoint-initdb.d/10-otus-app-role.sh
