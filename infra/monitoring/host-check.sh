#!/usr/bin/env bash
# Host resource and container monitoring check.
# Evaluates disk space, inodes, available memory, container health and TLS certificate expiry.
# Pings Healthchecks with status report on success or failure reason on critical alert.
# Reference: docs/22-infrastructure-devops.md section 9.4
set -Eeuo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CONFIG_FILE="${HOST_CHECK_CONFIG:-/etc/idraft/monitoring.env}"
if [[ -r "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

HC_URL="${HC_HOST_CHECK_URL:-${HC_URL:-}}"
DISK_TARGET="${CHECK_DISK_TARGET:-/}"
DISK_WARN="${DISK_WARN:-70}"
DISK_CRIT="${DISK_CRIT:-85}"
INODE_WARN="${INODE_WARN:-70}"
INODE_CRIT="${INODE_CRIT:-85}"
MEM_WARN_MB="${MEM_WARN_MB:-500}"
MEM_CRIT_MB="${MEM_CRIT_MB:-250}"
DOMAIN="${CHECK_DOMAIN:-app.idraft.ai}"
if [[ -z "${CHECK_CONTAINERS:-}" ]]; then
  CONTAINERS=(caddy web api worker postgres redis)
else
  # shellcheck disable=SC2206
  CONTAINERS=($CHECK_CONTAINERS)
fi

declare -a CRITICAL_ALERTS=()
declare -a WARNINGS=()
declare -a REPORT_LINES=()

log_report() {
  REPORT_LINES+=("$*")
}

# 1. Disk usage check
if disk_used=$(df -P "$DISK_TARGET" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}'); then
  log_report "Disk usage ($DISK_TARGET): ${disk_used}%"
  if (( disk_used >= DISK_CRIT )); then
    CRITICAL_ALERTS+=("Disk usage on $DISK_TARGET is critical: ${disk_used}% >= ${DISK_CRIT}%")
  elif (( disk_used >= DISK_WARN )); then
    WARNINGS+=("Disk usage on $DISK_TARGET is elevated: ${disk_used}% >= ${DISK_WARN}%")
  fi
else
  WARNINGS+=("Unable to check disk usage for $DISK_TARGET")
fi

# 2. Inodes usage check
if inode_used=$(df -i -P "$DISK_TARGET" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}'); then
  log_report "Inode usage ($DISK_TARGET): ${inode_used}%"
  if [[ "$inode_used" =~ ^[0-9]+$ ]]; then
    if (( inode_used >= INODE_CRIT )); then
      CRITICAL_ALERTS+=("Inode usage on $DISK_TARGET is critical: ${inode_used}% >= ${INODE_CRIT}%")
    elif (( inode_used >= INODE_WARN )); then
      WARNINGS+=("Inode usage on $DISK_TARGET is elevated: ${inode_used}% >= ${INODE_WARN}%")
    fi
  fi
fi

# 3. Available memory check
get_mem_available_mb() {
  if [[ -r /proc/meminfo ]]; then
    awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo
  elif command -v vm_stat >/dev/null 2>&1; then
    local free inactive
    free=$(vm_stat | awk '/Pages free/ {gsub("\\.","",$3); print $3}')
    inactive=$(vm_stat | awk '/Pages inactive/ {gsub("\\.","",$3); print $3}')
    echo $(( (free + inactive) * 4096 / 1048576 ))
  else
    echo "9999"
  fi
}

mem_avail_mb=$(get_mem_available_mb)
log_report "Available memory: ${mem_avail_mb} MB"
if (( mem_avail_mb < MEM_CRIT_MB )); then
  CRITICAL_ALERTS+=("Available memory is critical: ${mem_avail_mb} MB < ${MEM_CRIT_MB} MB")
elif (( mem_avail_mb < MEM_WARN_MB )); then
  WARNINGS+=("Available memory is low: ${mem_avail_mb} MB < ${MEM_WARN_MB} MB")
fi

# 4. Container health and restart check
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for name in "${CONTAINERS[@]}"; do
    c_status=$(docker inspect --format '{{.State.Status}} ({{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}})' "$name" 2>/dev/null || true)
    if [[ -z "$c_status" ]]; then
      # If stack is running under compose prefix (e.g. compose project), try matching suffix
      matched_id=$(docker ps -q -f "name=${name}" | head -n 1 || true)
      if [[ -n "$matched_id" ]]; then
        c_status=$(docker inspect --format '{{.State.Status}} ({{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}})' "$matched_id" 2>/dev/null || true)
      fi
    fi

    if [[ -z "$c_status" ]]; then
      c_status="missing"
    fi

    log_report "Container $name status: $c_status"
    if [[ "$c_status" == "missing" ]]; then
      if [[ "${CHECK_REQUIRE_ALL_CONTAINERS:-true}" == "true" ]]; then
        CRITICAL_ALERTS+=("Container $name is missing")
      fi
    elif [[ "$c_status" == *"unhealthy"* ]]; then
      CRITICAL_ALERTS+=("Container $name is unhealthy: $c_status")
    elif [[ "$c_status" != "running"* ]]; then
      CRITICAL_ALERTS+=("Container $name is not running: $c_status")
    fi
  done
fi

# 5. Certificate expiration check
if [[ -n "$DOMAIN" && "${SKIP_CERT_CHECK:-false}" != "true" ]]; then
  cert_end=$(echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
  if [[ -n "$cert_end" ]]; then
    exp_epoch="0"
    if date -u -d "$cert_end" +%s >/dev/null 2>&1; then
      exp_epoch=$(date -u -d "$cert_end" +%s)
    elif command -v date >/dev/null 2>&1; then
      exp_epoch=$(date -j -f "%b %d %T %Y %Z" "$cert_end" +%s 2>/dev/null || echo "0")
    fi
    now_epoch=$(date +%s)
    if (( exp_epoch > now_epoch )); then
      days_left=$(( (exp_epoch - now_epoch) / 86400 ))
      log_report "TLS certificate for $DOMAIN expires in $days_left days"
      if (( days_left < 7 )); then
        CRITICAL_ALERTS+=("TLS certificate for $DOMAIN expires in $days_left days (< 7 days)")
      elif (( days_left < 14 )); then
        WARNINGS+=("TLS certificate for $DOMAIN expires in $days_left days (< 14 days)")
      fi
    fi
  else
    log_report "TLS certificate check skipped for $DOMAIN (endpoint not answering directly)"
  fi
fi

# 6. Format summary report
SUMMARY_FILE=$(mktemp /tmp/idraft-host-check.XXXXXX)
# shellcheck disable=SC2064
trap "rm -f '$SUMMARY_FILE'" EXIT

{
  echo "Host Check Summary: $(date -u +'%Y-%m-%d %H:%M:%SZ')"
  echo "Host: $(hostname)"
  echo "---"
  for line in "${REPORT_LINES[@]}"; do
    echo "$line"
  done
  if (( ${#WARNINGS[@]} > 0 )); then
    echo "---"
    echo "WARNINGS (${#WARNINGS[@]}):"
    for w in "${WARNINGS[@]}"; do
      echo "  * $w"
    done
  fi
  if (( ${#CRITICAL_ALERTS[@]} > 0 )); then
    echo "---"
    echo "CRITICAL ALERTS (${#CRITICAL_ALERTS[@]}):"
    for c in "${CRITICAL_ALERTS[@]}"; do
      echo "  * $c"
    done
  fi
} > "$SUMMARY_FILE"

cat "$SUMMARY_FILE"

# 7. Ping Healthchecks
if [[ -n "$HC_URL" ]]; then
  if (( ${#CRITICAL_ALERTS[@]} > 0 )); then
    curl -fsS -m 10 --retry 3 -o /dev/null --data-binary @"$SUMMARY_FILE" "${HC_URL}/fail" || true
  else
    curl -fsS -m 10 --retry 3 -o /dev/null --data-binary @"$SUMMARY_FILE" "$HC_URL" || true
  fi
fi

if (( ${#CRITICAL_ALERTS[@]} > 0 )); then
  exit 1
fi

exit 0
