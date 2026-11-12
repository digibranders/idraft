#!/usr/bin/env bash
# Watches this Mac's disk, memory, swap and load while many sessions work, so it does not hang.
#
# It only measures and reports. It never kills or stops anything.
#   - Every INTERVAL seconds it samples disk free, memory free, swap used and the 5 minute load.
#   - It prints one line when the level changes (OK, WARN, CRIT) and a heartbeat every 10 minutes.
#   - It writes the current level and numbers to $STATE_DIR/state, and every line to $STATE_DIR/health.log.
#   - On CRIT it creates $STATE_DIR/pause. The heavy job lock (infra/dev/heavy) refuses to start a new full
#     test run, build or e2e run while that file exists. It is removed after two OK or WARN samples in a row.
#
# Usage: infra/dev/health-watch.sh            (foreground, prints events)
#        INTERVAL=60 infra/dev/health-watch.sh
# Start it in the background with:  nohup infra/dev/health-watch.sh >/dev/null 2>&1 &
set -u

INTERVAL="${INTERVAL:-30}"
STATE_DIR="${STATE_DIR:-/tmp/idraft-health}"
DISK_PATH="${DISK_PATH:-/System/Volumes/Data}"
mkdir -p "$STATE_DIR"
echo "$$" >"$STATE_DIR/pid"

# Thresholds for a 14 core, 39 GB Mac that also runs a Colima VM with 10 CPUs and 16 GiB.
DISK_WARN_GB=25 DISK_CRIT_GB=15
MEMFREE_WARN_PCT=25 MEMFREE_CRIT_PCT=12
SWAP_WARN_MB=8192 SWAP_CRIT_MB=12288
LOAD_WARN=14 LOAD_CRIT=22

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$STATE_DIR/health.log"; }

sample() {
  disk_gb=$(df -k "$DISK_PATH" | awk 'NR==2{printf "%d", $4/1048576}')
  mem_pct=$(memory_pressure 2>/dev/null | awk '/free percentage/{gsub("%","",$NF); print $NF}')
  mem_pct=${mem_pct:-100}
  swap_mb=$(sysctl -n vm.swapusage | awk '{for(i=1;i<=NF;i++) if($i=="used"){v=$(i+2); gsub("M","",v); printf "%d", v}}')
  swap_mb=${swap_mb:-0}
  load5=$(sysctl -n vm.loadavg | awk '{printf "%d", $3}')
  heavy=$(pgrep -f 'vitest|pytest|next build|playwright test|check\.sh|ship\.sh' | wc -l | tr -d ' ')
}

level_of() {
  reasons=""
  level=OK
  if [ "$disk_gb" -lt "$DISK_CRIT_GB" ]; then level=CRIT; reasons="$reasons disk free ${disk_gb} GB;"
  elif [ "$disk_gb" -lt "$DISK_WARN_GB" ]; then level=WARN; reasons="$reasons disk free ${disk_gb} GB;"; fi
  if [ "$mem_pct" -lt "$MEMFREE_CRIT_PCT" ]; then level=CRIT; reasons="$reasons memory free ${mem_pct}%;"
  elif [ "$mem_pct" -lt "$MEMFREE_WARN_PCT" ]; then [ "$level" = OK ] && level=WARN; reasons="$reasons memory free ${mem_pct}%;"; fi
  if [ "$swap_mb" -gt "$SWAP_CRIT_MB" ]; then level=CRIT; reasons="$reasons swap used ${swap_mb} MB;"
  elif [ "$swap_mb" -gt "$SWAP_WARN_MB" ]; then [ "$level" = OK ] && level=WARN; reasons="$reasons swap used ${swap_mb} MB;"; fi
  if [ "$load5" -gt "$LOAD_CRIT" ]; then level=CRIT; reasons="$reasons load5 ${load5};"
  elif [ "$load5" -gt "$LOAD_WARN" ]; then [ "$level" = OK ] && level=WARN; reasons="$reasons load5 ${load5};"; fi
}

last=""
calm=0
beat=0
log "health-watch started (pid $$, every ${INTERVAL}s, state in $STATE_DIR)"
while true; do
  sample
  level_of
  numbers="disk ${disk_gb} GB free, memory ${mem_pct}% free, swap ${swap_mb} MB, load5 ${load5}, heavy jobs ${heavy}"
  printf 'level=%s\n%s\nreasons=%s\nat=%s\n' "$level" "$numbers" "${reasons:-none}" "$(date '+%Y-%m-%dT%H:%M:%S%z')" >"$STATE_DIR/state"
  if [ "$level" = CRIT ]; then
    : >"$STATE_DIR/pause"
    calm=0
  else
    calm=$((calm + 1))
    if [ "$calm" -ge 2 ] && [ -e "$STATE_DIR/pause" ]; then rm -f "$STATE_DIR/pause"; log "RESUME heavy jobs allowed again ($numbers)"; fi
  fi
  if [ "$level" != "$last" ]; then
    log "$level $numbers${reasons:+ | $reasons}"
    last="$level"
  else
    beat=$((beat + INTERVAL))
    if [ "$beat" -ge 600 ]; then log "$level heartbeat: $numbers"; beat=0; fi
  fi
  sleep "$INTERVAL"
done
