#!/usr/bin/env bash
# Tests deploy.sh locally against Docker Compose, including automatic rollback on forced failure.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
infra_dir="$(cd "$here/.." && pwd)"
compose_file="$infra_dir/compose/docker-compose.yml"

test_dir="$(mktemp -d)"
export IDRAFT_RELEASES_DIR="$test_dir/releases"
mkdir -p "$IDRAFT_RELEASES_DIR"

cleanup() {
  echo "Cleaning up dryrun test containers and files..."
  docker compose -f "$compose_file" --env-file "$test_dir/env.test" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT

echo "=== 1. Preparing test environment ==="
python3 -c "
import sys
env_content = '''WEB_IMAGE=idraft-web:local
API_IMAGE=idraft-api:local
WORKER_IMAGE=idraft-worker:local
CADDY_IMAGE=caddy:2
POSTGRES_IMAGE=postgres:18
REDIS_IMAGE=redis:8
RELEASE_SHA=test-v1

DOMAIN=localhost
ACME_EMAIL=admin@localhost
APP_ENV=local
APP_ORIGIN=https://localhost

POSTGRES_DB=idraft
POSTGRES_USER=postgres
PG_SUPERUSER_PASSWORD=postgres-test-pass
PG_API_PASSWORD=api-test-pass
PG_WORKER_PASSWORD=worker-test-pass
PG_MIGRATOR_PASSWORD=migrator-test-pass

DATABASE_URL_API=postgresql://app_api:api-test-pass@postgres:5432/idraft
DATABASE_URL_WORKER=postgresql://app_worker:worker-test-pass@postgres:5432/idraft
DATABASE_URL_MIGRATOR=postgresql://migrator:migrator-test-pass@postgres:5432/idraft

REDIS_PASSWORD_APP=redis-app-local
REDIS_PASSWORD_HEALTHCHECK=redis-healthcheck-local
REDIS_PASSWORD_ADMIN=redis-admin-local
REDIS_URL_APP=redis://app:redis-app-local@redis:6379/0
REDIS_ACL_FILE=''' + sys.argv[2] + '''/compose/redis/users.acl

TOTP_ENCRYPTION_KEY=c29tZS0zMi1ieXRlLXJhbmRvbS1rZXktZm9yLXRvdHA=
REGISTRATION=invited
BREACHED_PASSWORD_CHECK=false

EMAIL_PROVIDER=console
EMAIL_API_KEY=
EMAIL_FROM=hello@localhost

COLLECT_CONCURRENCY=8
PROCESS_CONCURRENCY=4
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
R2_RAW_ENDPOINT=
R2_RAW_BUCKET=seo-raw
R2_RAW_ACCESS_KEY_ID=
R2_RAW_SECRET_ACCESS_KEY=
RESOLVE_UNKNOWN_SUBMISSIONS=false
INSTALLATION_ID=local
SENTRY_DSN_BACKEND=
SENTRY_DSN_WEB=
'''
with open(sys.argv[1], 'w') as f:
    f.write(env_content)
" "$test_dir/env.test" "$infra_dir"

python3 -c '
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"api": "idraft-api:local", "worker": "idraft-worker:local", "web": "idraft-web:local"}, f, indent=2)
' "$test_dir/digests-v1.json"

echo "=== 2. Starting database infrastructure ==="
docker compose -f "$compose_file" --env-file "$test_dir/env.test" up -d postgres redis >/dev/null

echo "Waiting for postgres and redis..."
for _ in $(seq 1 40); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' idraft-postgres 2>/dev/null)" = "healthy" ] && \
     [ "$(docker inspect -f '{{.State.Health.Status}}' idraft-redis 2>/dev/null)" = "healthy" ]; then
    break
  fi
  sleep 1
done

echo "=== 3. Testing successful initial deployment (v1) ==="
"$infra_dir/deploy.sh" "$test_dir/env.test" "$test_dir/digests-v1.json"

if [ ! -f "$IDRAFT_RELEASES_DIR/current.json" ]; then
  echo "Expected current.json to be created after successful deploy." >&2
  exit 1
fi
echo "Initial deployment (v1) succeeded."

echo "=== 3b. Testing second deployment (v2) to establish previous release history ==="
python3 -c '
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"api": "idraft-api:local", "worker": "idraft-worker:local", "web": "idraft-web:local"}, f, indent=2)
' "$test_dir/digests-v2.json"
"$infra_dir/deploy.sh" "$test_dir/env.test" "$test_dir/digests-v2.json"

if [ ! -f "$IDRAFT_RELEASES_DIR/previous.json" ]; then
  echo "Expected previous.json to be recorded after second deploy." >&2
  exit 1
fi
echo "Second deployment (v2) succeeded and recorded previous.json."

echo "=== 4. Testing forced failure with bad image digest ==="
python3 -c '
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({
        "api": "idraft-api:local",
        "worker": "idraft-worker:local",
        "web": "ghcr.io/digibranders/idraft-web-nonexistent@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }, f, indent=2)
' "$test_dir/digests-bad.json"

set +e
"$infra_dir/deploy.sh" "$test_dir/env.test" "$test_dir/digests-bad.json"
bad_exit=$?
set -e

if [ "$bad_exit" -eq 0 ]; then
  echo "Expected deploy of bad digest to fail, but it exited with 0!" >&2
  exit 1
fi
echo "Bad digest deploy failed as expected (exit code: $bad_exit)."

echo "=== 5. Verifying automatic rollback to previous release ==="
# Check that idraft-web is still running idraft-web:local
active_web="$(docker inspect -f '{{.Config.Image}}' idraft-web 2>/dev/null || true)"
if [ "$active_web" != "idraft-web:local" ]; then
  echo "Automatic rollback failed: active web image is $active_web, expected idraft-web:local" >&2
  exit 1
fi

# Verify the previous release is still serving traffic
status="$(curl -k -s -o /dev/null -w "%{http_code}" https://localhost/api/v1/me || true)"
if [ "$status" != "401" ]; then
  echo "Automatic rollback failed: /api/v1/me returned $status instead of 401" >&2
  exit 1
fi
echo "Automatic rollback verified: stack remains healthy and serves traffic."

echo "=== 6. Testing manual rollback command ==="
"$infra_dir/deploy.sh" --rollback "$test_dir/env.test"
status="$(curl -k -s -o /dev/null -w "%{http_code}" https://localhost/api/v1/me || true)"
if [ "$status" != "401" ]; then
  echo "Manual rollback failed: /api/v1/me returned $status instead of 401" >&2
  exit 1
fi

echo "Deploy dry-run tests passed successfully."
