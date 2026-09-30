#!/usr/bin/env bash
# Runs once, as the PostgreSQL superuser, when the data directory is first initialised
# (docker-entrypoint-initdb.d). Creates the four roles of ADR-022 and hands the database to
# `migrator`. Used unchanged by production, the development stack, the image smoke test and the
# test suite, so a role can never differ between them.
set -euo pipefail
: "${PG_MIGRATOR_PASSWORD:?}" "${PG_API_PASSWORD:?}" "${PG_WORKER_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$PG_MIGRATOR_PASSWORD" \
  -v api_password="$PG_API_PASSWORD" \
  -v worker_password="$PG_WORKER_PASSWORD" \
  -v database="$POSTGRES_DB" <<'SQL'
-- migrator owns every schema and table and runs Alembic. Not a superuser.
CREATE ROLE migrator LOGIN PASSWORD :'migrator_password';
ALTER ROLE migrator SET lock_timeout = '2s';
ALTER ROLE migrator SET statement_timeout = '15min';

-- app_api serves users and is subject to row-level security.
CREATE ROLE app_api LOGIN NOBYPASSRLS PASSWORD :'api_password';
ALTER ROLE app_api SET statement_timeout = '15s';

-- app_worker plans, dispatches and maintains across workspaces. Never reachable from a request.
CREATE ROLE app_worker LOGIN BYPASSRLS PASSWORD :'worker_password';
ALTER ROLE app_worker SET statement_timeout = '120s';
GRANT pg_read_all_stats TO app_worker;

-- backup connects over the Unix socket with peer authentication, so it has no password.
CREATE ROLE backup LOGIN BYPASSRLS;
GRANT pg_read_all_data TO backup;

ALTER DATABASE :"database" OWNER TO migrator;
REVOKE ALL ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO app_api, app_worker, backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Not a trusted extension, so the superuser creates it; migrations create the trusted ones.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
