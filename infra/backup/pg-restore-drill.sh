#!/usr/bin/env bash
# Monthly restore drill. Restores the newest dump into a temporary PostgreSQL container
# and compares row counts and checksums with the manifest. Never touches production data.
# Reference: docs/23-backup-disaster-recovery.md section 8
# Exit codes: 0 ok | 2 usage/config | 10 no or stale backup | 11 checksum mismatch | 12 archive unreadable | 13 restore failed | 14 data mismatch
set -Eeuo pipefail
umask 077
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SRC="${1:-r2-backups:seo-backups/daily}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-/etc/idraft/recovery.key}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
HC_URL="${HC_URL:-}"
SCRATCH_PORT="${SCRATCH_PORT:-54333}"
SCRATCH_MEM="${SCRATCH_MEM:-1g}"

here="$(cd "$(dirname "$0")" && pwd)"
readonly DEFAULT_CHECKS_SQL="$here/backup-checks.sql"
CHECKS_SQL="${CHECKS_SQL:-$DEFAULT_CHECKS_SQL}"

log() {
  printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$WORK/summary.txt"
}

die() {
  local code="$1"
  shift
  log "FAIL($code): $*"
  exit "$code"
}

[[ -r "$AGE_IDENTITY_FILE" ]] || die 2 "Recovery age identity file unreadable: $AGE_IDENTITY_FILE"

for bin in docker age rclone jq curl; do
  command -v "$bin" >/dev/null 2>&1 || die 2 "Missing required tool: $bin"
done

calc_file_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

WORK="$(mktemp -d /tmp/idraft-restore.XXXXXX)"
readonly WORK
CONTAINER="idraft-restore-drill-$$"
START_EPOCH="$(date +%s)"
touch "$WORK/summary.txt"

hc_ping() {
  local state="${1:-}"
  if [[ -z "$HC_URL" ]]; then
    return 0
  fi
  local ping_url="$HC_URL"
  if [[ -n "$state" ]]; then
    ping_url="${HC_URL}/${state}"
  fi
  curl -fsS -m 10 --retry 5 -o /dev/null --data-binary @"$WORK/summary.txt" "$ping_url" || true
}

# shellcheck disable=SC2329
on_exit() {
  local rc="$?"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  local total="$(( $(date +%s) - START_EPOCH ))"
  if (( rc == 0 )); then
    log "Restore drill passed in ${total}s."
    hc_ping ""
  else
    log "Restore drill failed with exit code $rc after ${total}s."
    hc_ping "$rc"
  fi
  rm -rf -- "$WORK"
  exit "$rc"
}
trap on_exit EXIT

hc_ping "start"
log "Starting restore drill from source: $SRC..."

# 1. Locate newest daily manifest in remote storage.
log "Searching for newest manifest..."
MANIFEST_NAME="$(rclone lsf "$SRC" --files-only --include '*.manifest.json' 2>/dev/null | sort | tail -n 1 || true)"
[[ -n "$MANIFEST_NAME" ]] || die 10 "No backup manifests found in $SRC"

log "Downloading manifest: $MANIFEST_NAME..."
rclone copyto "${SRC}/${MANIFEST_NAME}" "$WORK/manifest.json" || die 10 "Failed to download manifest $MANIFEST_NAME"

DUMP_KEY="$(jq -r '.dump.key // empty' "$WORK/manifest.json")"
EXPECTED_SHA="$(jq -r '.dump.sha256 // empty' "$WORK/manifest.json")"
EXPECTED_BYTES="$(jq -r '.dump.bytes // empty' "$WORK/manifest.json")"

[[ -n "$DUMP_KEY" && -n "$EXPECTED_SHA" ]] || die 10 "Malformed manifest content in $MANIFEST_NAME"

# 2. Download and verify encrypted dump file.
log "Downloading dump object: $DUMP_KEY ($EXPECTED_BYTES bytes)..."
rclone copyto "${SRC}/${DUMP_KEY}" "$WORK/$DUMP_KEY" || die 10 "Failed to download dump $DUMP_KEY"

ACTUAL_SHA="$(calc_file_sha256 "$WORK/$DUMP_KEY")"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  die 11 "SHA-256 checksum mismatch for dump: expected $EXPECTED_SHA, got $ACTUAL_SHA"
fi
log "Checksum verification passed: $ACTUAL_SHA"

# 3. Decrypt dump using offline recovery age identity.
log "Decrypting dump with recovery identity..."
DECRYPTED_DUMP="$WORK/restored.pgdump"
if ! age -d -i "$AGE_IDENTITY_FILE" "$WORK/$DUMP_KEY" > "$DECRYPTED_DUMP"; then
  die 12 "Failed to decrypt archive with provided age identity."
fi

# 4. Start temporary scratch PostgreSQL container.
log "Starting scratch PostgreSQL container ($CONTAINER)..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=drill-scratch-password \
  -e POSTGRES_DB=idraft \
  --memory="$SCRATCH_MEM" \
  -p "127.0.0.1:${SCRATCH_PORT}:5432" \
  "$PG_IMAGE" >/dev/null

log "Waiting for scratch container to accept connections..."
ready=false
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  die 13 "Scratch PostgreSQL container failed to become ready."
fi

# 5. Restore database from decrypted custom-format dump.
log "Restoring database from custom-format archive..."
if ! docker exec -i "$CONTAINER" pg_restore -U postgres -d idraft --no-owner --no-privileges < "$DECRYPTED_DUMP"; then
  log "WARNING: pg_restore exited with non-zero status (expected for pre-existing tables or warnings)."
fi

# 6. Run verification SQL query against restored database.
log "Executing verification SQL on restored database..."
RESTORED_CHECKS="$(docker exec -i "$CONTAINER" psql -U postgres -d idraft -X -q -A -t -v ON_ERROR_STOP=1 \
  -v win_start="$(jq -r '.checks.win_start' "$WORK/manifest.json")" \
  -v win_end="$(jq -r '.checks.win_end' "$WORK/manifest.json")" \
  < "$CHECKS_SQL")"

if ! printf '%s\n' "$RESTORED_CHECKS" | jq -e . >/dev/null; then
  die 14 "Restored checks query output is not valid JSON: $RESTORED_CHECKS"
fi

# 7. Compare counts and checksums between manifest and restored data.
log "Comparing restored counts and checksums with manifest..."
EXPECTED_COUNTS="$(jq -S '.checks.counts' "$WORK/manifest.json")"
ACTUAL_COUNTS="$(printf '%s\n' "$RESTORED_CHECKS" | jq -S '.counts')"

if [[ "$EXPECTED_COUNTS" != "$ACTUAL_COUNTS" ]]; then
  log "Count mismatch detected!"
  log "Expected: $EXPECTED_COUNTS"
  log "Actual:   $ACTUAL_COUNTS"
  die 14 "Restored row counts do not match manifest."
fi

EXPECTED_CHECKSUMS="$(jq -S '.checks.checksums' "$WORK/manifest.json")"
ACTUAL_CHECKSUMS="$(printf '%s\n' "$RESTORED_CHECKS" | jq -S '.checksums')"

if [[ "$EXPECTED_CHECKSUMS" != "$ACTUAL_CHECKSUMS" ]]; then
  log "Checksum mismatch detected!"
  log "Expected: $EXPECTED_CHECKSUMS"
  log "Actual:   $ACTUAL_CHECKSUMS"
  die 14 "Restored table checksums do not match manifest."
fi

log "All verification assertions passed: row counts and checksums match exactly."
exit 0
