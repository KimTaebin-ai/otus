#!/bin/sh

# Runs once, when the data volume is initialized. The app connects as `otus`: not a
# superuser, owner of only its own database. The `postgres` superuser is for this only.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --no-password --dbname postgres <<SQL
\set app_password \`cat "$OTUS_APP_PASSWORD_FILE"\`
CREATE ROLE otus LOGIN PASSWORD :'app_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE otus OWNER otus;
REVOKE ALL ON DATABASE otus FROM PUBLIC;
SQL
