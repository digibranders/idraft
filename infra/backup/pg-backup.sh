#!/usr/bin/env bash
# Nightly logical backup of PostgreSQL to Cloudflare R2 with age encryption.
# Reference: docs/23-backup-disaster-recovery.md section 6
# Exit codes: 0 ok | 2 config error | 3 dump or upload failed | 4 verification failed | 5 size anomaly
set -Eeuo pipefail
umask 077
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

readonly CONFIG_FILE="${BACKUP_CONFIG_FILE:-/etc/idraft/backup.env}"
here="$(cd "$(dirname "$0")" && pwd)"
readonly DEFAULT_CHECKS_SQL="$here/backup-checks.sql"

die() {
  local code="$1"
  shift
  printf 'ERROR: %s\n' "$*" >&2
  exit "$code"
}

log() {
  printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "${LOG:-/dev/null}"
}

if [[ -r "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

HC_URL="${HC_URL:-}"
REMOTE="${REMOTE:-r2-backups:seo-backups}"
RECIPIENTS="${RECIPIENTS:-/etc/idraft/backup-recipients.txt}"
PG_CONTAINER="${PG_CONTAINER:-idraft-postgres}"
PG_DB="${PG_DB:-idraft}"
MIN_BYTES="${MIN_BYTES:-1048576}"
ANOMALY_RATIO="${ANOMALY_RATIO:-0.5}"
CHECKS_SQL="${CHECKS_SQL:-$DEFAULT_CHECKS_SQL}"

if [[ -n "${RCLONE_CONFIG_FILE:-}" ]]; then
  export RCLONE_CONFIG="$RCLONE_CONFIG_FILE"
elif [[ -r /etc/idraft/rclone.conf ]]; then
  export RCLONE_CONFIG="/etc/idraft/rclone.conf"
fi

[[ -r "$RECIPIENTS" ]] || die 2 "Recipients file missing or unreadable: $RECIPIENTS"
[[ -r "$CHECKS_SQL" ]] || die 2 "Checks SQL file missing or unreadable: $CHECKS_SQL"

if grep -q 'AGE-SECRET-KEY' "$RECIPIENTS"; then
  die 2 "Recipients file contains an age private key! Aborting for safety."
fi

for bin in docker age rclone jq curl; do
  command -v "$bin" >/dev/null 2>&1 || die 2 "Required dependency missing: $bin"
done

calc_file_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

get_yesterday() {
  if date -u -d "yesterday" +%F >/dev/null 2>&1; then
    date -u -d "yesterday" +%F
  else
    date -u -v-1d +%F
  fi
}

TS="$(date -u +%Y%m%dT%H%M%SZ)"
readonly TS
WIN_END="$(date -u +%F)"
readonly WIN_END
WIN_START="$(get_yesterday)"
readonly WIN_START

readonly BASE="idraft-${TS}"
readonly DUMP_OBJ="${BASE}.pgdump.age"
readonly GLOBALS_OBJ="${BASE}.globals.sql.age"
readonly MANIFEST_OBJ="${BASE}.manifest.json"
readonly STAGING="${REMOTE}/staging"
readonly DAILY="${REMOTE}/daily"
readonly RCLONE_FLAGS=(--s3-chunk-size 16M --s3-upload-concurrency 2 --low-level-retries 10 --stats 0)

WORK="$(mktemp -d /tmp/idraft-backup.XXXXXX)"
readonly WORK
readonly LOG="${WORK}/backup.log"
touch "$LOG"

STAGED=()
START_EPOCH="$(date +%s)"
PSQL_PID=""

hc_ping() {
  local state="${1:-}"
  if [[ -z "$HC_URL" ]]; then
    return 0
  fi
  local ping_url="$HC_URL"
  if [[ -n "$state" ]]; then
    ping_url="${HC_URL}/${state}"
  fi
  local log_data=""
  if [[ -f "$LOG" ]]; then
    log_data="$(tail -c 10000 "$LOG" 2>/dev/null || true)"
  fi
  curl -fsS -m 10 --retry 5 --retry-connrefused -o /dev/null \
    --data-binary "$log_data" "$ping_url" || printf 'WARN: Healthchecks ping failed\n' >&2
}

# shellcheck disable=SC2329
on_exit() {
  local rc="$?"
  exec 3>&- 2>/dev/null || true
  if [[ -n "$PSQL_PID" ]]; then
    kill "$PSQL_PID" 2>/dev/null || true
  fi
  for obj in "${STAGED[@]}"; do
    rclone deletefile "${STAGING}/${obj}" 2>/dev/null || true
  done
  if (( rc == 0 )); then
    log "Backup completed successfully."
    hc_ping ""
  elif (( rc == 5 )); then
    log "Backup completed with size anomaly warning."
    hc_ping "5"
  else
    log "Backup failed with exit code $rc."
    hc_ping "$rc"
  fi
  rm -rf -- "$WORK"
  exit "$rc"
}
trap on_exit EXIT

check_pipeline() {
  local label="$1"
  shift
  local s
  for s in "$@"; do
    if (( s != 0 )); then
      die 3 "$label pipeline failed (exit statuses: $*)"
    fi
  done
}

remote_size() {
  rclone lsjson --stat "$1" | jq -r '.Size // 0'
}

hc_ping start
log "Starting backup ${BASE}..."

# 1. Snapshot session and 2. Dump in snapshot: run via helper script.
log "Exporting snapshot and creating encrypted database dump..."
STAGED+=("$DUMP_OBJ")
local_dump_tmp="${WORK}/${DUMP_OBJ}"
meta_tmp="${WORK}/meta.txt"

"$here/dump-snapshot.py" "$PG_CONTAINER" "$PG_DB" "$WIN_START" "$WIN_END" "$CHECKS_SQL" "$RECIPIENTS" "$local_dump_tmp" "$meta_tmp"

SNAPSHOT="$(head -n 1 "$meta_tmp" | tr -d '\r\n')"
CHECKS_JSON="$(sed -n '2p' "$meta_tmp" | tr -d '\r\n')"

printf '%s\n' "$CHECKS_JSON" | jq -e . >/dev/null || die 3 "Checks output is not valid JSON: $CHECKS_JSON"
log "Snapshot ${SNAPSHOT} exported, checks computed, and dump created."

DUMP_BYTES="$(wc -c < "$local_dump_tmp" | tr -d ' ')"
DUMP_SHA="$(calc_file_sha256 "$local_dump_tmp")"

log "Uploading encrypted dump to staging ($DUMP_BYTES bytes)..."
rclone copyto "${RCLONE_FLAGS[@]}" "$local_dump_tmp" "${STAGING}/${DUMP_OBJ}" || die 3 "Dump upload to staging failed"

# 3. Dump globals (roles without passwords, configuration).
log "Dumping PostgreSQL globals..."
STAGED+=("$GLOBALS_OBJ")
local_glob_tmp="${WORK}/${GLOBALS_OBJ}"

set +e
docker exec -u postgres "$PG_CONTAINER" \
  pg_dumpall -U backup -l "$PG_DB" --globals-only --no-role-passwords --no-password \
  | age -R "$RECIPIENTS" > "$local_glob_tmp"
glob_status=("${PIPESTATUS[@]}")
set -e
check_pipeline "pg_dumpall" "${glob_status[@]}"

GLOB_BYTES="$(wc -c < "$local_glob_tmp" | tr -d ' ')"
GLOB_SHA="$(calc_file_sha256 "$local_glob_tmp")"

log "Uploading encrypted globals to staging ($GLOB_BYTES bytes)..."
rclone copyto "${RCLONE_FLAGS[@]}" "$local_glob_tmp" "${STAGING}/${GLOBALS_OBJ}" || die 3 "Globals upload to staging failed"

# 4. Verify staged uploads against local sizes and minimum thresholds.
log "Verifying staged uploads..."
if (( DUMP_BYTES < MIN_BYTES )); then
  die 4 "Encrypted dump size (${DUMP_BYTES} bytes) is below minimum threshold (${MIN_BYTES} bytes)."
fi

remote_dump_size="$(remote_size "${STAGING}/${DUMP_OBJ}")"
if [[ "$remote_dump_size" != "$DUMP_BYTES" ]]; then
  die 4 "Remote size mismatch for dump: local=$DUMP_BYTES, remote=$remote_dump_size"
fi

remote_glob_size="$(remote_size "${STAGING}/${GLOBALS_OBJ}")"
if [[ "$remote_glob_size" != "$GLOB_BYTES" ]]; then
  die 4 "Remote size mismatch for globals: local=$GLOB_BYTES, remote=$remote_glob_size"
fi

# 5. Check for size anomaly compared to the previous daily manifest.
ANOMALY=false
PREV_MANIFEST="$(rclone lsf "$DAILY" --files-only --include '*.manifest.json' 2>/dev/null | sort | tail -n 1 || true)"
if [[ -n "$PREV_MANIFEST" ]]; then
  PREV_BYTES="$(rclone cat "${DAILY}/${PREV_MANIFEST}" 2>/dev/null | jq -r '.dump.bytes // empty' || true)"
  if [[ "$PREV_BYTES" =~ ^[0-9]+$ ]] && (( PREV_BYTES > 0 )); then
    if awk -v n="$DUMP_BYTES" -v p="$PREV_BYTES" -v r="$ANOMALY_RATIO" 'BEGIN { exit !(n < p * r) }'; then
      ANOMALY=true
      log "WARNING: Size anomaly detected! Current: ${DUMP_BYTES} bytes, Previous: ${PREV_BYTES} bytes."
    fi
  fi
fi

# 6. Promote staging objects to daily via server-side copy, then upload manifest last.
log "Promoting staging objects to daily..."
rclone copyto "${STAGING}/${DUMP_OBJ}" "${DAILY}/${DUMP_OBJ}" || die 3 "Promotion of dump to daily failed"
rclone copyto "${STAGING}/${GLOBALS_OBJ}" "${DAILY}/${GLOBALS_OBJ}" || die 3 "Promotion of globals to daily failed"

PG_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$PG_CONTAINER" 2>/dev/null || echo "postgres:18")"
CHECKS_SQL_B64="$(base64 < "$CHECKS_SQL" | tr -d '\n')"
RECIPIENTS_STR="$(grep -v '^#' "$RECIPIENTS" | tr '\n' ' ')"

jq -n \
  --arg ts "$TS" \
  --arg host "$(hostname)" \
  --arg snapshot "$SNAPSHOT" \
  --arg image "$PG_IMAGE" \
  --arg dump "$DUMP_OBJ" \
  --arg dsha "$DUMP_SHA" \
  --argjson dbytes "$DUMP_BYTES" \
  --arg glob "$GLOBALS_OBJ" \
  --arg gsha "$GLOB_SHA" \
  --argjson gbytes "$GLOB_BYTES" \
  --argjson duration "$(( $(date +%s) - START_EPOCH ))" \
  --argjson anomaly "$ANOMALY" \
  --arg recipients "$RECIPIENTS_STR" \
  --argjson checks "$CHECKS_JSON" \
  --arg checks_sql "$CHECKS_SQL_B64" \
  '{
    format_version: 1,
    created_at: $ts,
    host: $host,
    snapshot: $snapshot,
    postgres_image: $image,
    dump: {key: $dump, sha256: $dsha, bytes: $dbytes, format: "pg_dump custom, zstd level 6, age"},
    globals: {key: $glob, sha256: $gsha, bytes: $gbytes},
    recipients: $recipients,
    duration_s: $duration,
    size_anomaly: $anomaly,
    checks: $checks,
    checks_sql_b64: $checks_sql
  }' > "${WORK}/${MANIFEST_OBJ}"

log "Uploading manifest to daily..."
rclone copyto "${WORK}/${MANIFEST_OBJ}" "${DAILY}/${MANIFEST_OBJ}" || die 3 "Manifest upload to daily failed"

duration="$(( $(date +%s) - START_EPOCH ))"
log "Backup ${BASE} completed successfully: ${DUMP_BYTES} bytes, sha256 ${DUMP_SHA} in ${duration}s."

if [[ "$ANOMALY" = true ]]; then
  exit 5
fi

exit 0
