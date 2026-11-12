# WP-00 coordination kit: detailed task plan

Brief: [docs/ai-visibility/work-packages/WP-00-coordination-kit.md](../../ai-visibility/work-packages/WP-00-coordination-kit.md).
Design: MASTER-PLAN sections 3.2 (names), 4 (lock), 6.2 and 6.4 (status files, report line).
Worktree: `.claude/worktrees/ai-wp-00-kit-b3c1a8` (branch `claude/ai-wp-00-kit-b3c1a8`). `wp-start` does not exist
yet, so this package keeps the worktree it was opened in; the push is `git push origin HEAD:develop` either way.
The status line still names `ai/wp-00-coordination-kit` only if the coordinator renames the branch; `wp-status`
reports whatever branch git says.

## Ground rules for every task

- One fresh Sonnet implementer per task, then one fresh Sonnet reviewer. Tests first: write the test cases of
  the task, run them, see them fail, then write the script.
- Edit files only with the file tools (Write, Edit). No shell heredocs, `sed -i` or replace scripts.
- Owned files only: `infra/dev/heavy`, `infra/dev/wp-status`, `infra/dev/wp-start`, `infra/dev/README.md`,
  `infra/test/dev-heavy.sh`. Nothing else is staged (this plan file is committed by the coordinator).
- All tests go in `infra/test/dev-heavy.sh`. A second file `infra/test/dev-wp.sh` would be a file the brief does
  not give this package, and one self-test is one command to run. The file is grouped in sections
  (`# heavy`, `# wp-status`, `# wp-start`) and takes an optional section name as `$1` to run one group.
- Shell style as in `infra/ship.sh`: `#!/usr/bin/env bash`, `set -euo pipefail`, `say` and `die` helpers,
  a usage comment at the top, shellcheck clean without blanket disables (a targeted `# shellcheck disable=SCnnnn`
  needs a one line reason).
- Bash 3.2 (the system `/bin/bash`) and 5.x (`/opt/homebrew/bin/bash`) both. Forbidden: associative arrays,
  `mapfile`/`readarray`, `${v,,}` `${v^^}`, `wait -n`, `$EPOCHREALTIME`, `$BASHPID`, `{fd}>` redirections,
  `coproc`, `declare -n`. Empty arrays under `set -u` break 3.2: avoid arrays, or expand as
  `${a[@]+"${a[@]}"}`. Large heredocs deadlock 3.2 (infra/test/lib.sh): build text with `printf`.
- Time in nanoseconds comes from perl, not python3: `/usr/bin/perl` ships with macOS and has `Time::HiRes`;
  `python3` on a clean Mac is the Xcode stub, which can open an install dialog and hang an agent.
  `now_ns() { perl -MTime::HiRes=gettimeofday -e '($s,$u)=gettimeofday; printf "%d%06d000\n",$s,$u'; }`
  gives a fixed 19 digit number, so ticket names sort as text. Seconds come from `date +%s`.
- ASCII only, no em-dashes or en-dashes, in scripts, messages and docs.
- Checks per task: `shellcheck -x` on the changed scripts and `infra/test/dev-heavy.sh` run under both bashes
  (`TEST_BASH=/bin/bash /bin/bash infra/test/dev-heavy.sh` and `TEST_BASH=/opt/homebrew/bin/bash
  /opt/homebrew/bin/bash infra/test/dev-heavy.sh`). Never a full backend or web suite: this package changes no
  backend or web code. Do not run `shellcheck -x infra/dev/*` literally: the glob includes `README.md`.
  Name the scripts.

## Task 1: heavy lock core and its self-test

Files: `infra/test/dev-heavy.sh` (new, heavy section), `infra/dev/heavy` (new).

Interface:

```text
infra/dev/heavy [--lane heavy|medium] [--label TEXT] [--wait MIN] [--max MIN] -- COMMAND [ARGS...]
infra/dev/heavy --status
```

Environment (all optional; the test overrides them, nobody else needs to):

| Variable | Default | Use |
|---|---|---|
| `IDRAFT_LOCK_ROOT` | `$(git rev-parse --path-format=absolute --git-common-dir)/idraft-locks` | Lock state root |
| `IDRAFT_HEALTH_DIR` | `/tmp/idraft-health` | Where `pause` and `state` are read (health-watch.sh `STATE_DIR`) |
| `IDRAFT_HEAVY_POLL` | `5` | Seconds between polls; fractions allowed (passed to `sleep`) |
| `IDRAFT_HEAVY_UNIT` | `60` | Seconds per "minute" of `--wait`, `--max` and the progress interval |
| `IDRAFT_HEAVY_GRACE` | `10` | Seconds between TERM and KILL of the command's process group |

State layout under `$root/<lane>/`: `slot-1` (and `slot-2` for medium) taken with `mkdir`;
`slot-N/owner` with lines `pid=`, `pgid=`, `label=`, `worktree=`, `cmd=` (args joined by `printf '%q '`),
`start=` (epoch seconds); `tickets/<epoch-ns>-<pid>` holding `label=` and `worktree=` lines.

Behaviour:

1. Parse options. Usage errors exit 64 with a one line message: unknown option, missing `--`, empty command,
   lane not `heavy` or `medium`, `--wait` not an integer >= 0, `--max` not an integer >= 1. Default label is
   the basename of COMMAND. Outside a git repository with no `IDRAFT_LOCK_ROOT`: die with exit 64.
2. `mkdir -p "$lane_dir/tickets"`, create the ticket, install `trap cleanup EXIT` and separate INT and TERM
   traps (see 6). `cleanup` is idempotent: removes our ticket, and removes our slot only if its `owner` still
   says `pid=$$` (a slot reaped and retaken by someone else is never removed).
3. Poll loop until a slot is taken. Each poll: (a) the stale sweep of Task 2 (a no-op stub in this task);
   (b) the pause check of Task 2 (stub); (c) rank = number of live tickets older than ours (text sort of names);
   free = slots without a directory; if rank < free, try `mkdir slot-N` for N = 1..slots, first success wins;
   (d) on success write `owner` (to `owner.tmp`, then `mv`), remove the ticket, leave the loop;
   (e) wait timeout: if `date +%s` >= start + wait*unit, print `heavy: gave up after <n>m waiting for <lane>`
   on stderr and exit 75; (f) every `unit` seconds print one progress line on stderr:
   `heavy: waiting for <label> (pid <pid>, 3m12s), <k> ahead`; (g) `sleep "$poll"`. Elapsed time is always
   measured with `date +%s`, never by summing polls (polls may be fractional).
4. Run: `set -m; "$@" </dev/null & child=$!; set +m`. With job control on, bash 3.2 and 5 put the background
   job in its own process group, so `pgid=$child`. Stdin is `/dev/null` because a job outside the terminal's
   foreground group that reads the terminal is stopped by SIGTTIN; heavy jobs never read stdin. The command is
   always run as `"$@"`, never through `eval` or `sh -c "$*"`, so arguments keep spaces and quotes.
5. Run timeout: a watchdog subshell sleeps max*unit seconds, then writes `$lane_dir/.timeout-$$`,
   sends `kill -TERM -- -$pgid`, sleeps the grace, sends `kill -KILL -- -$pgid`. The watchdog is also started
   under `set -m`, so it has its own group and `kill -- -$watchdog` removes it together with its `sleep` (no
   orphan sleep left for 40 minutes). The parent runs `wait "$child" || rc=$?`, kills the watchdog group, and
   exits 124 if the marker exists, otherwise the command's status. The marker is removed in `cleanup`.
6. INT or TERM to the wrapper: send TERM to the process group, wait up to the grace, KILL, run `cleanup`,
   exit 130 (INT) or 143 (TERM). The EXIT trap then runs `cleanup` again, harmlessly.
7. `--status` is read only in this task's form: for each lane print `heavy: idle` or one line per slot
   (`slot-1 pid 4242 label backend-check worktree <path> running 3m12s cmd <cmd>`), then the queue in order
   (`queue 1: pid 4300 label web-build waiting 1m05s`). Exit 0. Task 2 adds dead markers and the pause line.

Test cases to write first (each a shell function `t_<name>`, run in a fresh `mktemp -d` dir with
`IDRAFT_LOCK_ROOT`, `IDRAFT_HEALTH_DIR` exported inside it, `IDRAFT_HEAVY_POLL=0.2`, `IDRAFT_HEAVY_UNIT=1`,
`IDRAFT_HEAVY_GRACE=1`; a `wait_for <seconds> <test expression>` helper polls instead of fixed sleeps; a trap
kills leftover background jobs and removes the dir; the script is invoked as `"${TEST_BASH:-bash}" "$heavy"`):

| Test | Asserts |
|---|---|
| `t_usage` | no `--` exits 64; `--lane fast` exits 64; `--wait abc` exits 64; `--max 0` exits 64; `--` with no command exits 64 |
| `t_exit_code` | `-- sh -c 'exit 7'` exits 7; `-- true` exits 0; no slot or ticket left afterwards |
| `t_args_quoting` | `-- printf '%s|' 'a b' "c'd" '$HOME' ''` prints exactly `a b|c'd|$HOME||` |
| `t_fifo_order` | A holds (`sleep 1.5` then append `A` to `order.log`); start B, `wait_for` B's ticket, start C; final `order.log` is `A B C` (each job appends its name when it starts and when it ends; starts and ends never interleave) |
| `t_heavy_one_slot` | three heavy jobs that each touch `running/<name>` on start, record `ls running | wc -l` into `max.log`, remove on end: max recorded is 1 |
| `t_medium_two_slots` | same with `--lane medium`: max recorded is 2, never 3; the third job's start is after one of the first two ended |
| `t_lanes_independent` | a heavy holder does not delay a medium job (medium job finishes while heavy `sleep 3` holds) |
| `t_wait_timeout` | holder `sleep 5`; waiter `--wait 1` exits 75 in under 3 s; its ticket is gone; stderr names the lane |
| `t_progress_line` | waiter behind a holder for 2.5 s prints at least two `heavy: waiting for <holder label> (pid ` lines with `0 ahead` |
| `t_run_timeout` | `--max 1 -- sh -c 'echo $$ > p1; sleep 30 & echo $! > p2; wait'` exits 124 within 3 s; both pids in `p1`, `p2` are dead; `slot-1` is gone; a second job then starts at once |
| `t_term_wrapper` | TERM to a holder wrapper: wrapper exits 143, its command group is dead, slot and ticket gone |
| `t_lock_root_used` | after any job, state exists under `$IDRAFT_LOCK_ROOT/heavy/tickets` and nothing was created under the real `git rev-parse --git-common-dir`/idraft-locks by the test (compare a listing taken before and after) |
| `t_status_basic` | with one holder labelled `hold` and one waiter labelled `next`: `--status` prints a `slot-1` line with `label hold` and a `queue 1:` line with `label next`; with nothing running it prints `heavy: idle` and `medium: idle` |

Edge cases the reviewer checks by reading: a ticket is created before the first poll (so a later arrival
can never overtake); `rank < free` is computed from live tickets only; `owner` is written before the ticket is
removed, so `--status` never shows a job in neither place; no `eval`; stdin redirected; `wait` status kept
under `set -e` (`wait "$child" || rc=$?`).

Checks: `shellcheck -x infra/dev/heavy infra/test/dev-heavy.sh`; the heavy section of the self-test under both
bashes.

Commit: `WP-00: heavy lock core and its self-test`

Reviewer checklist:
- [ ] Tests are in the same commit and fail against a stub heavy (`exit 0`): copy the script aside, write the
      stub with the file tools, run the section, restore the script (never `git stash`)
- [ ] Exit codes 64, 75, 124, 130, 143 and pass through, as above
- [ ] No bash 4 features (grep the forbidden list); passes under `/bin/bash`
- [ ] Process group kill reaches grandchildren (`t_run_timeout` p2)
- [ ] Cleanup never removes a slot whose owner pid is not `$$`
- [ ] shellcheck clean, ASCII only, self-test under 60 s

## Task 2: stale recovery, the pause file and the full status

Files: `infra/dev/heavy`, `infra/test/dev-heavy.sh` (heavy section).

Behaviour:

1. Stale sweep on every poll, for both tickets and slots of the waiter's lane:
   - A ticket is stale when `kill -0 <pid>` fails. Remove it.
   - A slot is live while its wrapper pid answers `kill -0` or its command group answers `kill -0 -- -<pgid>`.
     Killing only the wrapper (kill -9, no trap) leaves the command running and using the machine, so the slot
     stays held until the group is gone too. When both are gone, remove the slot with `rm -rf` after renaming
     it to `stale-slot-N-<ns>` (a rename is atomic, so two reapers never remove a slot a third waiter just took).
   - A slot with no `owner` file is the window between `mkdir` and the `mv` of `owner`: it is stale only when
     older than 2 polls plus 5 s, age read with `perl -e 'print time - (stat shift)[9]' slot-N`.
   - Pid reuse: `owner` also stores `lstart=` from `ps -o lstart= -p $$`; a slot whose pid answers but whose
     `ps -o lstart=` differs is treated as a dead wrapper. Tickets keep the plain `kill -0` check with
     `# shortcut: a reused pid keeps a dead ticket queued until that process exits, upgrade if it is ever seen`.
2. Pause: before taking a slot, if `$IDRAFT_HEALTH_DIR/pause` exists, do not take one. On the first paused
   poll and then once per progress interval print `heavy: paused by infra/dev/health-watch.sh (<dir>/pause)`
   followed by the content of `<dir>/state` (or `no state file`). The wait timeout keeps counting; on timeout
   exit 75 with `heavy: gave up after <n>m, machine paused`. The pause never touches a running job. The ticket
   stays, so the queue order survives the pause.
3. `--status` additions: a first line `pause: on (<dir>/pause) <level line of state>` or `pause: off`;
   holders and tickets whose pids are dead are printed with ` (dead, removed at next poll)`; `--status` itself
   removes nothing.

Test cases to write first:

| Test | Asserts |
|---|---|
| `t_killed_holder_recovered` | holder `-- sleep 30`; read `pid` and `pgid` from its `owner`; `kill -9` the wrapper and `kill -9 -- -pgid`; a waiter started before the kill gets the slot within 2 s and exits 0 |
| `t_killed_wrapper_group_alive` | `kill -9` only the wrapper; for 1.5 s the waiter does not start and `--status` still shows the holder; after `kill -9 -- -pgid` the waiter starts within 2 s |
| `t_dead_ticket_skipped` | write `tickets/0000000000000000001-<pid of an exited sh>`; a new job starts at once and the fake ticket is gone |
| `t_ownerless_slot` | `mkdir slot-1` with no owner, `touch -t` it 1 minute into the past: a job starts within 2 s; a fresh ownerless `slot-1` is not reaped within 1 s |
| `t_pid_reuse_guard` | `slot-1/owner` with `pid=$$` of the test shell and a wrong `lstart=`: the slot is reaped and a job starts |
| `t_pause_blocks_then_releases` | write `pause` and `state` (`level=CRIT`); `--wait 10 -- touch ran` does not create `ran` within 1.5 s; stderr shows `paused by` and `level=CRIT`; `rm pause`; `ran` appears within 2 s; exit 0 |
| `t_pause_wait_timeout` | with `pause` present, `--wait 1` exits 75 and stderr says `machine paused` |
| `t_pause_keeps_running_job` | a running holder is not affected when `pause` appears (finishes with its own exit code) |
| `t_pause_keeps_order` | B then C queued while paused; on unpause B runs before C |
| `t_status_full` | `--status` shows `pause: on` with the state level; a dead ticket is listed with `dead`; after `--status` the dead ticket file still exists |

Checks: as Task 1.

Commit: `WP-00: heavy lock recovery, pause and status`

Reviewer checklist:
- [ ] Prove it bites (MASTER-PLAN 5, locks are risky): in a scratch copy, (1) drop the `kill -0 -- -pgid`
      half of the liveness rule and see `t_killed_wrapper_group_alive` fail; (2) drop the pause check and see
      `t_pause_blocks_then_releases` fail; (3) replace the rank rule with "any free slot" and see
      `t_fifo_order` or `t_pause_keeps_order` fail. Restore with the file tools; record test names in the review
- [ ] Reap is rename then remove; no window where a just taken slot is deleted
- [ ] `--status` is read only
- [ ] The pause message prints the state file, not a paraphrase
- [ ] Self-test still under 60 s on both bashes

## Task 3: status files and the worktree helper

Files: `infra/dev/wp-status` (new), `infra/dev/wp-start` (new), `infra/test/dev-heavy.sh` (sections
`wp-status`, `wp-start`).

`infra/dev/wp-status WP-NN <status> "<note>" [--rows N/T] [--tasks N/T] [--blockers TEXT] [--next TEXT]`

- `WP-NN` must match `^WP-[0-9][0-9]$` (bash `[[ =~ ]]` with the pattern in a variable, 3.2 safe). Status
  must be one of `planning building review blocked merged idle`. Note must be non empty. Anything else: exit 64
  and the usage line, no file written.
- Flags fall back to env `WP_ROWS`, `WP_TASKS`, `WP_BLOCKERS`, `WP_NEXT`. `--rows` and `--tasks` must match
  `^[0-9]+/[0-9]+$`, else exit 64; unknown values print `?/?`. Blockers default `none`. `next` defaults to the
  note, so the three positional words alone give a complete line.
- Branch from `git rev-parse --abbrev-ref HEAD`, sha from `git rev-parse --short HEAD`, both in the current
  worktree. Status dir is `$(git rev-parse --path-format=absolute --git-common-dir)/ai-visibility/status`,
  created with `mkdir -p`. Written to `WP-NN.txt.tmp.$$` then `mv` (atomic; the coordinator never reads half a
  line). File content: line 1 the report line, line 2 `note=<note>`, line 3 `at=<date +%Y-%m-%dT%H:%M:%S%z>`.
  The report line is also printed on stdout, ready to send to the coordinator:

```text
WP-NN <status> | branch <branch> @ <sha> | rows done <n>/<t> | tasks <n>/<t> | blockers: <list> | next: <text>
```

- A `|` or a newline in note, blockers or next would break the line format: replace newlines with spaces and
  `|` with `/` before writing.

`infra/dev/wp-start WP-NN <slug>`

- Validate `WP-NN` as above and slug `^[a-z0-9]+(-[a-z0-9]+)*$`; exit 64 otherwise. Paths use a lowercase
  `wp-NN`: worktree `<repo>/.claude/worktrees/wp-NN`, branch `ai/wp-NN-<slug>`.
- `repo="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"` as in `infra/ship.sh`, so it
  works from the main checkout or any worktree. All later git calls use `git -C "$repo"`.
- `git -C "$repo" fetch --quiet origin develop` first (die with the git error if it fails; no offline mode).
- Refuse (exit 1, nothing created) when `refs/heads/ai/wp-NN-<slug>` exists, when any local branch matches
  `ai/wp-NN-*` (one branch per package), when the path exists, or when `git worktree list --porcelain` already
  lists the path.
- `git -C "$repo" worktree add --no-track -b "$branch" "$path" origin/develop`. `--no-track` keeps the branch
  without an upstream, so a bare `git push` cannot go to `develop` by accident; the push is always the explicit
  `git push origin HEAD:develop`.
- Print the path, the branch, the base sha and the next command
  (`cd <path> && infra/dev/wp-status WP-NN planning "<note>"`). It does not start a session, write a plan or
  touch the main checkout's working tree.

Test fixture: in the temp dir, `git init --bare origin.git`; clone to `main`; one commit; push `develop`;
a second clone `other` used to push a newer `develop` commit. All git calls with `-c user.name=t
-c user.email=t@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null` so the user's global
config and hooks do not leak in.

Test cases to write first:

| Test | Asserts |
|---|---|
| `t_status_line` | in `main` on branch `ai/wp-07-demo`: `wp-status WP-07 building "first push"` prints exactly `WP-07 building \| branch ai/wp-07-demo @ <git short sha> \| rows done ?/? \| tasks ?/? \| blockers: none \| next: first push`; the same is line 1 of `<common>/ai-visibility/status/WP-07.txt`; line 2 is `note=first push` |
| `t_status_flags_and_env` | `--rows 3/10 --tasks 2/5 --blockers "WP-03" --next "wire it"` appear in their fields; with `WP_ROWS=1/2` in env and no flag, `rows done 1/2`; a flag beats the env |
| `t_status_bad_id` | `WP-7`, `wp-07`, `WP-123`, `WP-0a` exit 64; no file created |
| `t_status_bad_word` | `done`, `Merged`, empty exit 64; `idle` is accepted |
| `t_status_bad_counts` | `--rows 3` and `--tasks a/b` exit 64 |
| `t_status_sanitized` | a note with `a|b` and a newline gives one line with `a/b` |
| `t_status_from_worktree` | run in a linked worktree of `main`: file lands in the same common dir; branch is the worktree's |
| `t_status_overwrite` | two calls: file holds only the second line |
| `t_start_creates` | after `other` pushed a new develop commit, `wp-start WP-07 my-slug` in `main` creates `main/.claude/worktrees/wp-07` on `ai/wp-07-my-slug` at the new origin develop sha (proves the fetch) |
| `t_start_no_upstream` | `git rev-parse --abbrev-ref ai/wp-07-my-slug@{u}` fails |
| `t_start_from_worktree` | run from inside `main/.claude/worktrees/wp-07`: `wp-start WP-08 next` creates `main/.claude/worktrees/wp-08`, not a nested path |
| `t_start_refuses_branch` | existing `ai/wp-09-x`: `wp-start WP-09 x` and `wp-start WP-09 y` exit 1; no worktree created |
| `t_start_refuses_path` | an existing directory `main/.claude/worktrees/wp-10`: exit 1; no branch created |
| `t_start_bad_args` | slugs `Bad`, `under_score`, `trail-`, `-lead`, `a--b`, empty; id `WP-1`: all exit 64 |

Checks: `shellcheck -x infra/dev/wp-status infra/dev/wp-start infra/test/dev-heavy.sh`; the `wp-status` and
`wp-start` sections, then the whole self-test, under both bashes.

Commit: `WP-00: status file and worktree helpers`

Reviewer checklist:
- [ ] The report line matches MASTER-PLAN 6.4 field for field (`tasks`, not the brief's older `steps`)
- [ ] The status file sits in the git common dir, outside the work tree; `git status` stays clean after a call
- [ ] `wp-start` fetches before branching and never changes the main checkout's HEAD or files
- [ ] No upstream on the new branch
- [ ] Tests never touch the real repository (all under the temp dir; check with `git -C <real repo> worktree
      list` before and after)
- [ ] shellcheck clean, bash 3.2 safe, ASCII only

## Task 4: infra/dev/README.md

File: `infra/dev/README.md` (new), one page, no more than about 120 lines. No tests; the reviewer reads it
against the scripts.

Contents, in this order:

1. What the folder is: tools that let several agent sessions share this Mac and report progress.
2. Commands, one line each with an example: `heavy`, `heavy --status`, `wp-start`, `wp-status`,
   `health-watch.sh`.
3. Lanes:
   - Heavy (1 at a time across all worktrees): `backend/check.sh` without a test path, `pytest` without a path,
     `pnpm test` without a path, `pnpm build`, `pnpm e2e`, `pnpm e2e:visual`, `infra/ship.sh`.
   - Medium (2 at a time): `pnpm typecheck`, `pnpm lint`, a vitest folder with `--maxWorkers=2`, a pytest path
     with `-n 2 --no-cov`.
   - Light (no lock): one test file, ruff or prettier on changed files, `git`.
   - Example: `infra/dev/heavy --label wp-12-check -- bash -c 'cd backend && ./check.sh'`.
4. Options and defaults: `--wait` 60, `--max` 40 (minutes), the env overrides table from Task 1 (marked "for the
   self-test").
5. Exit codes: command's own code, 64 usage, 75 gave up waiting (also while paused), 124 run timeout (the
   process group was killed), 130 and 143 interrupted.
6. The pause file: `infra/dev/health-watch.sh` writes `/tmp/idraft-health/state` and creates
   `/tmp/idraft-health/pause` at CRIT (disk, memory, swap or load), removes it after two calm samples; `heavy`
   starts nothing new while it exists and prints the state; running jobs are never stopped. Start the watcher
   once per machine: `nohup infra/dev/health-watch.sh >/dev/null 2>&1 &` (check first with
   `cat /tmp/idraft-health/pid` and `kill -0`). If it runs with a custom `STATE_DIR`, set `IDRAFT_HEALTH_DIR`
   to the same path.
7. Where state lives: `<git common dir>/idraft-locks/<lane>/` and `<git common dir>/ai-visibility/status/`,
   outside git and shared by every worktree. Recovery is automatic; never delete a slot by hand while its pid
   or group lives.
8. Quiet window before a release (MASTER-PLAN 4): finish or park the task with a local WIP commit (never
   `git stash`: the stash is shared by every worktree), push what is green, stop dev servers, start no heavy
   job. The coordinator runs `infra/dev/heavy --label release --wait 30 --max 30 -- infra/ship.sh` when both
   lanes are idle and `pgrep -f 'bash.*infra/ship.sh'` prints nothing.
9. Known limits: `infra/ship.sh` does not take the lock itself (an ops change); nested `heavy` in the same lane
   would wait for itself, so do not call `heavy` from a command already run by `heavy`.

Checks: `grep -nP '[^\x00-\x7F]' infra/dev/README.md` prints nothing; every command and number in it matches
the scripts (reviewer runs `infra/dev/heavy --status` and one usage error to compare text).

Commit: `WP-00: infra dev README`

Reviewer checklist:
- [ ] Heavy job list identical to MASTER-PLAN section 4
- [ ] Exit codes and defaults match the scripts
- [ ] Pause file path and health-watch start command correct
- [ ] Says never `git stash`; one page; no AI tells, ASCII only

## Task 5: as built notes, rebase, final checks, push, report

Files: `infra/dev/README.md` (an `## As built` section at its end).

Where the note goes: docs 19 (`docs/19-api-specification.md`) and 29 (`docs/29-phase-roadmap.md`) take As built
sections for backend packages, and web packages write into their spec. WP-00 changes neither backend nor web,
and `docs/ai-visibility/README.md` is not a file this package owns, so the note goes in the README this package
owns. The coordinator may link it from `docs/ai-visibility/README.md` with the tracker update.

As built contents (short): the three commands and the self-test; the decisions taken here (perl for
nanoseconds, slot liveness by wrapper pid or process group, rename then remove on reap, `--no-track` branches,
tests in one file, `tasks` field per MASTER-PLAN 6.4); what is not covered (pid reuse for tickets, the nested
lock, `ship.sh` not taking the lock, Linux `stat`/`ps` differences since only this Mac runs it).

Steps:

1. `git fetch origin && git rebase origin/develop` (no conflicts expected: all files are new).
2. `shellcheck -x infra/dev/heavy infra/dev/wp-status infra/dev/wp-start infra/test/dev-heavy.sh`. Also run it on
   `infra/dev/health-watch.sh` and report the result; that file is not this package's, so a finding there is
   reported to the coordinator, not fixed.
3. The self-test through the medium lane, both bashes:
   `infra/dev/heavy --lane medium --label wp-00-selftest -- /bin/bash infra/test/dev-heavy.sh` with
   `TEST_BASH=/bin/bash`, then the same with `/opt/homebrew/bin/bash`. The self-test sets its own
   `IDRAFT_LOCK_ROOT`, so it does not collide with the lock that runs it.
4. Acceptance check on the real lock: start `infra/dev/heavy --label a -- sleep 5` and
   `infra/dev/heavy --label b -- sleep 5` in the background a second apart; `infra/dev/heavy --status` shows
   `a` holding and `b` queued; `b` ends about 10 s after `a` started.
5. `git push origin HEAD:develop`; if rejected, back to step 1.
6. `infra/dev/wp-status WP-00 merged "kit on develop" --rows 0/0 --tasks 5/5` and send the printed line to the
   coordinator.

Commit: `WP-00: as built notes`

Final reviewer (fresh Sonnet, whole package diff against the brief's acceptance criteria):
- [ ] shellcheck clean on every script changed; self-test passes on both bashes
- [ ] Two real `heavy -- sleep 5` runs serialize and `--status` shows holder and queue
- [ ] Only owned files changed (`git diff --stat origin/develop...HEAD`)
- [ ] Commit messages `WP-00: <title>`, no attribution lines, no em-dashes or en-dashes anywhere
- [ ] As built note present; status line sent

## Report lines for this package

```text
WP-00 planning | branch <branch> @ <sha> | rows done 0/0 | tasks 0/5 | blockers: none | next: task 1 heavy core
WP-00 building | ... | tasks <n>/5 | blockers: none | next: <next task>
WP-00 merged | ... | rows done 0/0 | tasks 5/5 | blockers: none | next: coordinator dispatch
```

Until Task 3 lands, the coordinator writes these lines by hand; from Task 3 on, `infra/dev/wp-status` writes them.
