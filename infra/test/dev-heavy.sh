#!/usr/bin/env bash
# Self-test for infra/dev/heavy (and, in later sections, wp-status and wp-start).
#
# Usage: infra/test/dev-heavy.sh [all|heavy]
#        TEST_BASH=/bin/bash /bin/bash infra/test/dev-heavy.sh
#        TEST_BASH=/opt/homebrew/bin/bash /opt/homebrew/bin/bash infra/test/dev-heavy.sh
#
# Every test runs in a fresh temp dir with its own lock root and health dir, so it never touches the real
# lock state under the git common dir. TEST_BASH is the bash that runs the scripts under test.
# No bash 4 features and no large heredocs: this has to run under the bash 3.2 that macOS ships.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
heavy="$here/../dev/heavy"
bash_bin="${TEST_BASH:-bash}"

say() { printf '%s\n' "$*"; }
die() { printf 'dev-heavy.sh: %s\n' "$*" >&2; exit 1; }

# ---- helpers (run inside a test's subshell) ----

fail() { printf '  FAIL: %s\n' "$*" >&2; exit 1; }

eq() { # eq ACTUAL EXPECTED LABEL
  [ "$1" = "$2" ] || fail "$3: expected '$2', got '$1'"
}

# wait_for SECONDS CMD [ARGS...]: polls CMD every 50 ms until it succeeds, fails after SECONDS.
wait_for() {
  local tries=$(($1 * 20)) i=0
  shift
  while ! "$@" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -le "$tries" ] || fail "timed out waiting for: $*"
    sleep 0.05
  done
}

now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time() * 1000'; }

dead() { ! kill -0 "$1" 2>/dev/null; }
gone() { [ ! -e "$1" ]; }
has_text() { grep -q -- "$2" "$1"; }

# run_heavy ARGS...: synchronous; sets rc, leaves stdout in out/run.out and stderr in out/run.err.
run_heavy() {
  rc=0
  "$bash_bin" "$heavy" "$@" >"$work/out/run.out" 2>"$work/out/run.err" || rc=$?
}

# start_heavy NAME ARGS...: background; sets last_pid, output in out/NAME.out and out/NAME.err.
start_heavy() {
  local name="$1"
  shift
  "$bash_bin" "$heavy" "$@" >"$work/out/$name.out" 2>"$work/out/$name.err" &
  last_pid=$!
}

# owner_ready LANE N: slot N of LANE is held and its owner file carries the process group.
owner_ready() { grep -q '^pgid=[0-9]' "$IDRAFT_LOCK_ROOT/$1/slot-$2/owner"; }

tickets_are() { # tickets_are LANE COUNT
  local n
  n="$(find "$IDRAFT_LOCK_ROOT/$1/tickets" -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$n" -eq "$2" ]
}

assert_idle() { # assert_idle LANE: no slot and no ticket left
  [ -z "$(find "$IDRAFT_LOCK_ROOT/$1" -maxdepth 1 -name 'slot-*' 2>/dev/null)" ] || fail "$1: a slot is left"
  tickets_are "$1" 0 || fail "$1: a ticket is left"
}

# Job scripts the tests run under heavy.
write_jobs() {
  # record.sh NAME SECONDS: logs the number of jobs running at its start, and its start and end.
  cat >"$work/record.sh" <<'EOF'
mkdir -p running
: > "running/$1"
ls running | wc -l | tr -d ' ' >> max.log
echo "start:$1" >> order.log
sleep "$2"
echo "end:$1" >> order.log
rm -f "running/$1"
EOF
  # tree.sh: records its pid and a grandchild's pid, then waits.
  cat >"$work/tree.sh" <<'EOF'
echo $$ > p1
sleep 30 &
echo $! > p2
wait
EOF
}

# ---- tests: heavy ----

t_usage() {
  run_heavy true; eq "$rc" 64 "no --"
  run_heavy --lane fast -- true; eq "$rc" 64 "bad lane"
  run_heavy --wait abc -- true; eq "$rc" 64 "bad --wait"
  run_heavy --max 0 -- true; eq "$rc" 64 "--max 0"
  run_heavy --; eq "$rc" 64 "empty command"
  run_heavy --bogus -- true; eq "$rc" 64 "unknown option"
  run_heavy --lane; eq "$rc" 64 "missing option value"
  run_heavy -- ""; eq "$rc" 64 "empty command word"
  IDRAFT_HEAVY_POLL=1.2.3 run_heavy -- true; eq "$rc" 64 "poll 1.2.3"
  IDRAFT_HEAVY_POLL=. run_heavy -- true; eq "$rc" 64 "poll ."
  IDRAFT_HEAVY_UNIT=1.5 run_heavy -- true; eq "$rc" 64 "unit 1.5"
  IDRAFT_HEAVY_GRACE=x run_heavy -- true; eq "$rc" 64 "grace x"
}

t_exit_code() {
  run_heavy -- sh -c 'exit 7'; eq "$rc" 7 "exit 7 passes through"
  assert_idle heavy
  run_heavy -- true; eq "$rc" 0 "true"
  assert_idle heavy
}

t_args_quoting() {
  # shellcheck disable=SC2016  # the literal $HOME is the test input
  run_heavy -- printf '%s|' 'a b' "c'd" '$HOME' ''
  eq "$rc" 0 "printf rc"
  eq "$(cat "$work/out/run.out")" "a b|c'd|\$HOME||" "arguments keep spaces and quotes"
}

t_fifo_order() {
  local a b c
  start_heavy a -- sh record.sh A 1.5; a=$last_pid
  wait_for 5 owner_ready heavy 1
  start_heavy b -- sh record.sh B 0.3; b=$last_pid
  wait_for 5 tickets_are heavy 1
  start_heavy c -- sh record.sh C 0.3; c=$last_pid
  wait_for 5 tickets_are heavy 2
  wait "$a" "$b" "$c"
  eq "$(tr '\n' ' ' <"$work/order.log")" "start:A end:A start:B end:B start:C end:C " "FIFO order"
}

t_heavy_one_slot() {
  local a b c
  start_heavy a -- sh record.sh A 0.4; a=$last_pid
  start_heavy b -- sh record.sh B 0.4; b=$last_pid
  start_heavy c -- sh record.sh C 0.4; c=$last_pid
  wait "$a" "$b" "$c"
  eq "$(wc -l <"$work/max.log" | tr -d ' ')" 3 "all three ran"
  eq "$(sort -n "$work/max.log" | tail -n 1)" 1 "never more than one at a time"
}

t_medium_two_slots() {
  local a b c
  start_heavy a --lane medium -- sh record.sh A 1; a=$last_pid
  start_heavy b --lane medium -- sh record.sh B 1; b=$last_pid
  start_heavy c --lane medium -- sh record.sh C 1; c=$last_pid
  wait "$a" "$b" "$c"
  eq "$(wc -l <"$work/max.log" | tr -d ' ')" 3 "all three ran"
  eq "$(sort -n "$work/max.log" | tail -n 1)" 2 "two at a time, never three"
  eq "$(awk '/^end:/{exit} /^start:/{n++} END{print n}' "$work/order.log")" 2 "third starts after one ended"
}

t_lanes_independent() {
  local h
  start_heavy h --label holder -- sleep 3; h=$last_pid
  wait_for 5 owner_ready heavy 1
  run_heavy --lane medium -- true
  eq "$rc" 0 "medium job rc"
  kill -0 "$h" || fail "the heavy holder ended before the medium job did"
  kill -TERM "$h"
  wait "$h" || true
}

t_wait_timeout() {
  local h t0 t1
  start_heavy h -- sleep 5; h=$last_pid
  wait_for 5 owner_ready heavy 1
  t0=$(now_ms)
  run_heavy --wait 1 -- true
  t1=$(now_ms)
  eq "$rc" 75 "gave up"
  [ $((t1 - t0)) -lt 3000 ] || fail "waited $((t1 - t0)) ms"
  tickets_are heavy 0 || fail "the waiter's ticket is left"
  has_text "$work/out/run.err" 'gave up after 1m waiting for heavy' || fail "stderr: $(cat "$work/out/run.err")"
  kill -TERM "$h"
  wait "$h" || true
}

t_progress_line() {
  local h
  start_heavy h --label hold -- sleep 3.5; h=$last_pid
  wait_for 5 owner_ready heavy 1
  run_heavy --label next --wait 10 -- true
  eq "$rc" 0 "waiter rc"
  [ "$(grep -c '^heavy: waiting for hold (pid [0-9]*, .*), 0 ahead$' "$work/out/run.err")" -ge 2 ] ||
    fail "expected two progress lines, stderr: $(cat "$work/out/run.err")"
  wait "$h"
}

t_run_timeout() {
  local t0 t1 p1 p2
  t0=$(now_ms)
  run_heavy --max 1 -- sh tree.sh
  t1=$(now_ms)
  eq "$rc" 124 "run timeout"
  [ $((t1 - t0)) -lt 3000 ] || fail "took $((t1 - t0)) ms"
  p1=$(cat "$work/p1")
  p2=$(cat "$work/p2")
  wait_for 3 dead "$p1"
  wait_for 3 dead "$p2"
  assert_idle heavy
  t0=$(now_ms)
  run_heavy -- true
  t1=$(now_ms)
  eq "$rc" 0 "next job rc"
  [ $((t1 - t0)) -lt 2000 ] || fail "next job waited $((t1 - t0)) ms"
}

t_term_wrapper() {
  local h p1 p2
  start_heavy h -- sh tree.sh; h=$last_pid
  wait_for 5 owner_ready heavy 1
  wait_for 5 test -s "$work/p2"
  p1=$(cat "$work/p1")
  p2=$(cat "$work/p2")
  kill -TERM "$h"
  rc=0
  wait "$h" || rc=$?
  eq "$rc" 143 "wrapper exit on TERM"
  wait_for 3 dead "$p1"
  wait_for 3 dead "$p2"
  assert_idle heavy
}

# start_heavy_int NAME ARGS...: like start_heavy, but SIGINT has its default action. A plain background job of
# a non-interactive shell ignores SIGINT, and the wrapper would inherit that.
start_heavy_int() {
  local name="$1"
  shift
  perl -e '$SIG{INT} = "DEFAULT"; exec @ARGV' "$bash_bin" "$heavy" "$@" >"$work/out/$name.out" 2>"$work/out/$name.err" &
  last_pid=$!
}

# watchdog_procs MAX: how many processes run with "--max MAX " in their command line (MAX is a number nothing
# else uses). The wrapper counts one, and its watchdog subshell, a copy of the wrapper, counts another.
watchdog_procs() { pgrep -f -- "--max $1 " | wc -l | tr -d ' '; }
no_watchdog_left() { [ "$(watchdog_procs "$1")" -eq 0 ]; }

t_term_cancels_watchdog() {
  local h
  # The watchdog of a wrapper that is stopped early must not outlive it and write a stale marker.
  start_heavy h --max 1 -- sleep 30; h=$last_pid
  wait_for 5 owner_ready heavy 1
  sleep 0.3
  kill -TERM "$h"
  rc=0
  wait "$h" || rc=$?
  eq "$rc" 143 "wrapper exit on TERM"
  sleep 2.5
  [ -z "$(find "$IDRAFT_LOCK_ROOT/heavy" -maxdepth 1 -name '.timeout-*')" ] || fail "a stale .timeout marker was written"
  # A command that ignores TERM keeps the wrapper in its grace period. While the wrapper lives, the watchdog
  # does not end by itself, so only the wrapper's own kill can make it go: two processes is a left-over.
  IDRAFT_HEAVY_GRACE=2 start_heavy h --max 4177 -- sh -c 'trap "" TERM; while :; do sleep 0.1; done'; h=$last_pid
  wait_for 5 owner_ready heavy 1
  eq "$(watchdog_procs 4177)" 2 "wrapper and watchdog while running"
  kill -TERM "$h"
  sleep 0.4
  eq "$(watchdog_procs 4177)" 1 "only the wrapper is left in its grace period"
  rc=0
  wait "$h" || rc=$?
  eq "$rc" 143 "wrapper exit on TERM"
  wait_for 3 no_watchdog_left 4177
}

t_hup_wrapper() {
  local h p1 p2
  start_heavy h --max 4178 -- sh tree.sh; h=$last_pid
  wait_for 5 owner_ready heavy 1
  wait_for 5 test -s "$work/p2"
  p1=$(cat "$work/p1")
  p2=$(cat "$work/p2")
  kill -HUP "$h"
  rc=0
  wait "$h" || rc=$?
  eq "$rc" 129 "wrapper exit on HUP"
  wait_for 3 dead "$p1"
  wait_for 3 dead "$p2"
  wait_for 3 no_watchdog_left 4178
  assert_idle heavy
}

t_int_wrapper() {
  local h p1 p2
  start_heavy_int h --max 4179 -- sh tree.sh; h=$last_pid
  wait_for 5 owner_ready heavy 1
  wait_for 5 test -s "$work/p2"
  p1=$(cat "$work/p1")
  p2=$(cat "$work/p2")
  kill -INT "$h"
  rc=0
  wait "$h" || rc=$?
  eq "$rc" 130 "wrapper exit on INT"
  wait_for 3 dead "$p1"
  wait_for 3 dead "$p2"
  wait_for 3 no_watchdog_left 4179
  assert_idle heavy
}

t_lock_root_used() {
  local common real token h
  token="lockroot-$$-$(now_ms)"
  common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)"
  real="$common/idraft-locks"
  start_heavy h --label "$token" -- sleep 3; h=$last_pid
  wait_for 5 owner_ready heavy 1
  has_text "$IDRAFT_LOCK_ROOT/heavy/slot-1/owner" "label=$token" || fail "owner is not under IDRAFT_LOCK_ROOT"
  [ -d "$IDRAFT_LOCK_ROOT/heavy/tickets" ] || fail "no tickets dir under IDRAFT_LOCK_ROOT"
  if [ -d "$real" ] && grep -rq -- "$token" "$real"; then
    fail "the job left state under the real lock dir $real"
  fi
  kill -TERM "$h"
  wait "$h" || true
}

t_status_basic() {
  local h n
  run_heavy --status
  eq "$rc" 0 "status rc"
  has_text "$work/out/run.out" '^heavy: idle$' || fail "no 'heavy: idle': $(cat "$work/out/run.out")"
  has_text "$work/out/run.out" '^medium: idle$' || fail "no 'medium: idle': $(cat "$work/out/run.out")"
  start_heavy h --label hold -- sleep 4; h=$last_pid
  wait_for 5 owner_ready heavy 1
  start_heavy n --label next --wait 10 -- true; n=$last_pid
  wait_for 5 tickets_are heavy 1
  run_heavy --status
  eq "$rc" 0 "status rc with jobs"
  has_text "$work/out/run.out" 'slot-1 pid [0-9][0-9]* label hold ' || fail "no holder line: $(cat "$work/out/run.out")"
  has_text "$work/out/run.out" 'queue 1: pid [0-9][0-9]* label next ' || fail "no queue line: $(cat "$work/out/run.out")"
  has_text "$work/out/run.out" '^medium: idle$' || fail "medium is not idle: $(cat "$work/out/run.out")"
  kill -TERM "$n" "$h"
  wait "$n" "$h" || true
}

# ---- tests: heavy, recovery, pause and full status ----

# owner_field LANE N KEY: a value from the owner file of a slot.
owner_field() { grep "^$3=" "$IDRAFT_LOCK_ROOT/$1/slot-$2/owner" | cut -d= -f2-; }

# dead_pid: the pid of a process that has exited and been reaped.
dead_pid() {
  sh -c 'exit 0' &
  local p=$!
  wait "$p"
  printf '%s\n' "$p"
}

# own_lstart: the start time of the test script, normalised the way heavy records it.
own_lstart() { ps -o lstart= -p "$$" | awk '{ $1 = $1; print }'; }

# fake_owner PID LSTART: slot-1 of the heavy lane held by PID (no process group), with a given start time.
fake_owner() {
  mkdir -p "$IDRAFT_LOCK_ROOT/heavy/slot-1" "$IDRAFT_LOCK_ROOT/heavy/tickets"
  printf 'pid=%s\npgid=\nlabel=old\nworktree=x\ncmd=old\nstart=%s\nlstart=%s\n' "$1" "$(date +%s)" "$2" \
    >"$IDRAFT_LOCK_ROOT/heavy/slot-1/owner"
}

# fake_ticket PID [LANE]: a ticket older than any real one.
fake_ticket() {
  mkdir -p "$IDRAFT_LOCK_ROOT/${2:-heavy}/tickets"
  printf 'label=ghost\nworktree=x\n' >"$IDRAFT_LOCK_ROOT/${2:-heavy}/tickets/0000000000000000001-$1"
}

t_killed_holder_recovered() {
  local h w pg
  start_heavy h --max 4181 -- sleep 30; h=$last_pid
  wait_for 5 owner_ready heavy 1
  pg="$(owner_field heavy 1 pgid)"
  start_heavy w --wait 10 -- touch ran; w=$last_pid
  wait_for 5 tickets_are heavy 1
  kill -9 "$h"
  kill -9 -- "-$pg"
  { wait "$h"; } 2>/dev/null || true # the shell reports "Killed: 9" for a job killed this way
  wait_for 2 test -e "$work/ran"
  rc=0
  wait "$w" || rc=$?
  eq "$rc" 0 "waiter rc"
  wait_for 3 no_watchdog_left 4181
}

t_killed_wrapper_watchdog_exits() {
  local h pg
  # kill -9 gives the wrapper no chance to stop its watchdog: the watchdog must notice and end by itself.
  start_heavy h --max 4183 -- sleep 30; h=$last_pid
  wait_for 5 owner_ready heavy 1
  pg="$(owner_field heavy 1 pgid)"
  kill -9 "$h"
  { wait "$h"; } 2>/dev/null || true
  eq "$(watchdog_procs 4183)" 1 "the watchdog outlives the wrapper while the command's group runs"
  kill -9 -- "-$pg"
  wait_for 3 no_watchdog_left 4183
}

t_killed_wrapper_group_alive() {
  local h w pg
  start_heavy h --max 4182 -- sleep 30; h=$last_pid
  wait_for 5 owner_ready heavy 1
  pg="$(owner_field heavy 1 pgid)"
  start_heavy w --wait 10 -- touch ran; w=$last_pid
  wait_for 5 tickets_are heavy 1
  kill -9 "$h"
  { wait "$h"; } 2>/dev/null || true
  sleep 1.5
  gone "$work/ran" || fail "the waiter started while the command's group still ran"
  run_heavy --status
  has_text "$work/out/run.out" 'slot-1 pid [0-9][0-9]* label sleep ' || fail "no holder line: $(cat "$work/out/run.out")"
  ! has_text "$work/out/run.out" 'dead' || fail "a live group is shown as dead: $(cat "$work/out/run.out")"
  kill -9 -- "-$pg"
  wait_for 2 test -e "$work/ran"
  rc=0
  wait "$w" || rc=$?
  eq "$rc" 0 "waiter rc"
  wait_for 3 no_watchdog_left 4182
}

t_dead_ticket_skipped() {
  local t0 t1 p
  p="$(dead_pid)"
  fake_ticket "$p"
  t0=$(now_ms)
  run_heavy -- true
  t1=$(now_ms)
  eq "$rc" 0 "job rc"
  [ $((t1 - t0)) -lt 2000 ] || fail "waited $((t1 - t0)) ms behind a dead ticket"
  gone "$IDRAFT_LOCK_ROOT/heavy/tickets/0000000000000000001-$p" || fail "the dead ticket is left"
}

t_older_live_ticket_blocks() {
  local s w
  # A free lane is not enough: a live ticket older than ours has the right of way.
  sleep 30 &
  s=$!
  fake_ticket "$s"
  start_heavy w --wait 10 -- touch ran; w=$last_pid
  sleep 1
  gone "$work/ran" || fail "a newer waiter took the free slot past an older live ticket"
  kill "$s"
  { wait "$s"; } 2>/dev/null || true
  wait_for 2 test -e "$work/ran"
  rc=0
  wait "$w" || rc=$?
  eq "$rc" 0 "waiter rc"
}

t_older_live_tickets_block_medium() {
  local s1 s2 w
  sleep 30 &
  s1=$!
  sleep 30 &
  s2=$!
  fake_ticket "$s1" medium
  fake_ticket "$s2" medium
  start_heavy w --lane medium --wait 10 -- touch ran; w=$last_pid
  sleep 1
  gone "$work/ran" || fail "a newer waiter took a free slot past two older live tickets"
  kill "$s1"
  { wait "$s1"; } 2>/dev/null || true
  wait_for 2 test -e "$work/ran"
  rc=0
  wait "$w" || rc=$?
  eq "$rc" 0 "waiter rc with one older ticket left and two slots"
  kill "$s2"
  { wait "$s2"; } 2>/dev/null || true
}

t_ownerless_slot() {
  local t0 t1 w
  mkdir -p "$IDRAFT_LOCK_ROOT/heavy/slot-1" "$IDRAFT_LOCK_ROOT/heavy/tickets"
  perl -e 'utime time - 60, time - 60, $ARGV[0]' "$IDRAFT_LOCK_ROOT/heavy/slot-1"
  t0=$(now_ms)
  run_heavy -- true
  t1=$(now_ms)
  eq "$rc" 0 "job rc behind an old ownerless slot"
  [ $((t1 - t0)) -lt 2000 ] || fail "waited $((t1 - t0)) ms behind an old ownerless slot"
  mkdir "$IDRAFT_LOCK_ROOT/heavy/slot-1"
  start_heavy w --wait 10 -- touch ran; w=$last_pid
  sleep 1
  [ -d "$IDRAFT_LOCK_ROOT/heavy/slot-1" ] || fail "a fresh ownerless slot was reaped"
  gone "$work/ran" || fail "the job started in a fresh ownerless slot"
  kill -TERM "$w"
  wait "$w" || true
}

t_pid_reuse_guard() {
  # The test script is alive, so only the start time tells that it is not the wrapper that took the slot.
  fake_owner "$$" "$(own_lstart)"
  run_heavy --wait 1 -- true
  eq "$rc" 75 "a live owner with its own start time keeps the slot"
  fake_owner "$$" "Thu Jan  1 00:00:00 1970"
  run_heavy --wait 5 -- true
  eq "$rc" 0 "a reused pid does not hold the slot"
  assert_idle heavy
}

t_pause_blocks_then_releases() {
  local w
  mkdir -p "$IDRAFT_HEALTH_DIR"
  printf 'level=CRIT\nreasons=disk free 3 GB;\n' >"$IDRAFT_HEALTH_DIR/state"
  : >"$IDRAFT_HEALTH_DIR/pause"
  start_heavy w --wait 10 -- touch ran; w=$last_pid
  sleep 1.5
  gone "$work/ran" || fail "the job started while paused"
  has_text "$work/out/w.err" 'paused by infra/dev/health-watch.sh (.*/pause)' || fail "stderr: $(cat "$work/out/w.err")"
  has_text "$work/out/w.err" 'level=CRIT' || fail "the state file is not printed: $(cat "$work/out/w.err")"
  rm -f "$IDRAFT_HEALTH_DIR/pause"
  wait_for 2 test -e "$work/ran"
  rc=0
  wait "$w" || rc=$?
  eq "$rc" 0 "job rc after the pause"
}

t_pause_wait_timeout() {
  mkdir -p "$IDRAFT_HEALTH_DIR"
  : >"$IDRAFT_HEALTH_DIR/pause"
  run_heavy --wait 1 -- touch ran
  eq "$rc" 75 "gave up while paused"
  has_text "$work/out/run.err" 'gave up after 1m, machine paused' || fail "stderr: $(cat "$work/out/run.err")"
  has_text "$work/out/run.err" 'no state file' || fail "no state note: $(cat "$work/out/run.err")"
  gone "$work/ran" || fail "the job ran while paused"
  tickets_are heavy 0 || fail "the waiter's ticket is left"
}

t_pause_keeps_running_job() {
  local h
  mkdir -p "$IDRAFT_HEALTH_DIR"
  start_heavy h -- sh -c 'sleep 1; exit 5'; h=$last_pid
  wait_for 5 owner_ready heavy 1
  : >"$IDRAFT_HEALTH_DIR/pause"
  rc=0
  wait "$h" || rc=$?
  eq "$rc" 5 "a running job ends with its own code when the pause starts"
}

t_pause_keeps_order() {
  local b c
  mkdir -p "$IDRAFT_HEALTH_DIR"
  : >"$IDRAFT_HEALTH_DIR/pause"
  start_heavy b -- sh record.sh B 0.3; b=$last_pid
  wait_for 5 tickets_are heavy 1
  start_heavy c -- sh record.sh C 0.3; c=$last_pid
  wait_for 5 tickets_are heavy 2
  sleep 0.6
  gone "$work/order.log" || fail "a job started while paused"
  rm -f "$IDRAFT_HEALTH_DIR/pause"
  wait "$b" "$c"
  eq "$(tr '\n' ' ' <"$work/order.log")" "start:B end:B start:C end:C " "order after the pause"
}

t_status_full() {
  local p tk
  mkdir -p "$IDRAFT_HEALTH_DIR"
  printf 'level=CRIT\nreasons=swap\n' >"$IDRAFT_HEALTH_DIR/state"
  : >"$IDRAFT_HEALTH_DIR/pause"
  p="$(dead_pid)"
  fake_ticket "$p"
  fake_owner "$p" "$(own_lstart)"
  tk="$IDRAFT_LOCK_ROOT/heavy/tickets/0000000000000000001-$p"
  run_heavy --status
  eq "$rc" 0 "status rc"
  has_text "$work/out/run.out" '^pause: on (.*/pause) level=CRIT$' || fail "pause line: $(cat "$work/out/run.out")"
  has_text "$work/out/run.out" 'slot-1 pid .* (dead, removed at next poll)$' || fail "dead holder: $(cat "$work/out/run.out")"
  has_text "$work/out/run.out" 'queue .*label ghost .* (dead, removed at next poll)$' || fail "dead ticket: $(cat "$work/out/run.out")"
  [ -f "$tk" ] || fail "--status removed the dead ticket"
  [ -d "$IDRAFT_LOCK_ROOT/heavy/slot-1" ] || fail "--status removed the dead slot"
  rm -f "$IDRAFT_HEALTH_DIR/pause"
  run_heavy --status
  has_text "$work/out/run.out" '^pause: off$' || fail "pause off line: $(cat "$work/out/run.out")"
}

# ---- runner ----

# Leftover wrappers of a failed test get TERM, which makes them stop their command and free their slot.
# shellcheck disable=SC2329  # runs from the EXIT trap of the test subshell
kill_jobs() {
  local p
  for p in $(jobs -p); do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}

run_test() {
  local name="$1" rc=0
  work="$(mktemp -d "${TMPDIR:-/tmp}/idraft-heavy-test.XXXXXX")"
  (
    cd "$work"
    mkdir -p out
    IDRAFT_LOCK_ROOT="$work/locks" IDRAFT_HEALTH_DIR="$work/health"
    IDRAFT_HEAVY_POLL=0.2 IDRAFT_HEAVY_UNIT=1 IDRAFT_HEAVY_GRACE=1
    export IDRAFT_LOCK_ROOT IDRAFT_HEALTH_DIR IDRAFT_HEAVY_POLL IDRAFT_HEAVY_UNIT IDRAFT_HEAVY_GRACE
    trap kill_jobs EXIT
    write_jobs
    "$name"
  ) || rc=$?
  rm -rf "$work"
  return "$rc"
}

run_section() { # run_section TEST...
  local t
  for t in "$@"; do
    if run_test "$t"; then
      say "ok   $t"
      passed=$((passed + 1))
    else
      say "FAIL $t"
      failed=$((failed + 1))
    fi
  done
}

heavy_tests="t_usage t_exit_code t_args_quoting t_fifo_order t_heavy_one_slot t_medium_two_slots
t_lanes_independent t_wait_timeout t_progress_line t_run_timeout t_term_wrapper t_term_cancels_watchdog t_hup_wrapper t_int_wrapper t_lock_root_used t_status_basic
t_killed_holder_recovered t_killed_wrapper_group_alive t_killed_wrapper_watchdog_exits t_dead_ticket_skipped
t_older_live_ticket_blocks t_older_live_tickets_block_medium t_ownerless_slot t_pid_reuse_guard
t_pause_blocks_then_releases t_pause_wait_timeout t_pause_keeps_running_job t_pause_keeps_order t_status_full"

passed=0
failed=0
case "${1:-all}" in
  all | heavy)
    # shellcheck disable=SC2086  # a word list on purpose
    run_section $heavy_tests
    ;;
  *) die "usage: infra/test/dev-heavy.sh [all|heavy]" ;;
esac

say "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
