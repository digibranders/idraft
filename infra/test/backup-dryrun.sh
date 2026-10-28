#!/usr/bin/env bash
# Tests pg-backup.sh and pg-restore-drill.sh locally against PostgreSQL container.
set -euo pipefail

export PATH="/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"

here="$(cd "$(dirname "$0")" && pwd)"
infra_dir="$(cd "$here/.." && pwd)"

test_dir="$(mktemp -d /tmp/idraft-backup-test.XXXXXX)"
export TEST_DIR="$test_dir"

cleanup() {
  echo "Cleaning up backup dryrun resources..."
  docker rm -f idraft-backup-test-db >/dev/null 2>&1 || true
  docker rm -f idraft-restore-drill-* >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT

echo "=== 1. Setting up temporary test keys and directories ==="
mkdir -p "$test_dir/remote" "$test_dir/config"

# Generate temporary age keypair
age-keygen -o "$test_dir/recovery.key" 2>/dev/null
age-keygen -y "$test_dir/recovery.key" > "$test_dir/backup-recipients.txt" 2>/dev/null

echo "=== 2. Starting test PostgreSQL container ==="
docker run -d --name idraft-backup-test-db \
  -e POSTGRES_PASSWORD=postgres-test-pass \
  -e POSTGRES_DB=idraft \
  -e PG_MIGRATOR_PASSWORD=migrator \
  -e PG_API_PASSWORD=api \
  -e PG_WORKER_PASSWORD=worker \
  -v "$infra_dir/compose/postgres/initdb/10-roles.sh:/docker-entrypoint-initdb.d/10-roles.sh:ro" \
  postgres:18 >/dev/null

echo "Waiting for test database..."
for _ in $(seq 1 30); do
  if docker exec idraft-backup-test-db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Running migrations against test database..."
docker run --rm --link idraft-backup-test-db:postgres \
  -e DATABASE_URL="postgresql://migrator:migrator@postgres:5432/idraft" \
  idraft-migrator:local python -m idraft.db.migrate >/dev/null

echo "Inserting test records into database..."
docker exec -i -u postgres idraft-backup-test-db psql -d idraft -v ON_ERROR_STOP=1 << 'SQL'
INSERT INTO auth.workspaces (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'Test Workspace', 'test-ws');
INSERT INTO core.projects (id, workspace_id, name, slug) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Test Project', 'test-proj');
SQL

echo "=== 3. Executing pg-backup.sh ==="
cat > "$test_dir/config/backup.env" <<ENV
REMOTE=$test_dir/remote
RECIPIENTS=$test_dir/backup-recipients.txt
PG_CONTAINER=idraft-backup-test-db
PG_DB=idraft
MIN_BYTES=100
ENV

BACKUP_CONFIG_FILE="$test_dir/config/backup.env" "$infra_dir/backup/pg-backup.sh"

echo "Verifying backup artifacts in remote storage..."
manifest="$(find "$test_dir/remote/daily" -name "*.manifest.json" | head -n 1)"
if [ -z "$manifest" ] || [ ! -f "$manifest" ]; then
  echo "Expected manifest file in $test_dir/remote/daily" >&2
  exit 1
fi

workspace_count="$(jq -r '.checks.counts["auth.workspaces"]' "$manifest")"
project_count="$(jq -r '.checks.counts["core.projects"]' "$manifest")"

if [ "$workspace_count" != "1" ] || [ "$project_count" != "1" ]; then
  echo "Unexpected counts in manifest: workspaces=$workspace_count, projects=$project_count" >&2
  exit 1
fi
echo "Backup succeeded and manifest verified (workspaces=$workspace_count, projects=$project_count)."

echo "=== 4. Executing pg-restore-drill.sh ==="
AGE_IDENTITY_FILE="$test_dir/recovery.key" \
PG_IMAGE="postgres:18" \
"$infra_dir/backup/pg-restore-drill.sh" "$test_dir/remote/daily"

echo "=== 5. Testing failure when remote is unreachable ==="
cat > "$test_dir/config/bad-remote.env" <<ENV
REMOTE=unreachable-r2-remote:seo-backups
RECIPIENTS=$test_dir/backup-recipients.txt
PG_CONTAINER=idraft-backup-test-db
PG_DB=idraft
MIN_BYTES=100
ENV

set +e
BACKUP_CONFIG_FILE="$test_dir/config/bad-remote.env" "$infra_dir/backup/pg-backup.sh" >/dev/null 2>&1
fail_exit=$?
set -e

if [ "$fail_exit" -eq 0 ]; then
  echo "Expected backup to fail with invalid remote, but it succeeded!" >&2
  exit 1
fi
echo "Backup failed loudly with invalid remote as expected (exit code: $fail_exit)."

echo "Backup and restore drill dry-run completed successfully."
