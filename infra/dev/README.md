# infra/dev

Tools that let several agent sessions share this Mac and report their progress. Nothing here touches the
server or the release. Run every command from the repository root or any worktree.

## Commands

| Command | What it does | Example |
|---|---|---|
| `heavy` | Runs a heavy job when a slot is free, queues first in first out otherwise | `infra/dev/heavy --label wp-12-check -- bash -c 'cd backend && ./check.sh'` |
| `heavy --status` | Prints the pause state, the holders and the queue of both lanes. Read only | `infra/dev/heavy --status` |
| `wp-start` | Opens the worktree `.claude/worktrees/wp-NN` on branch `ai/wp-NN-<slug>`, cut from a fresh `origin/develop`, with no upstream | `infra/dev/wp-start WP-12 topics-tab` |
| `wp-status` | Writes the progress line of a package for the coordinator and prints it | `infra/dev/wp-status WP-12 building "first push" --rows 3/10 --tasks 2/5` |
| `health-watch.sh` | Samples disk, memory, swap and load, and raises the pause file at CRIT | `nohup infra/dev/health-watch.sh >/dev/null 2>&1 &` |

`wp-status` takes `planning`, `building`, `review`, `blocked`, `merged` or `idle`. Flags `--blockers` and
`--next` are optional; `WP_ROWS`, `WP_TASKS`, `WP_BLOCKERS` and `WP_NEXT` are the defaults for the four flags.
`wp-start` refuses (exit 1) when the package already has a branch or the path exists. Push work with
`git push origin HEAD:develop`, never a bare `git push`.

## Lanes

Slot counts: 1 heavy and 2 medium by default. When the Mac runs only this project, the coordinator raises them
by writing `heavy=2` and `medium=3` lines into `/tmp/idraft-health/slots` (the file is read on every call; a
missing or invalid value falls back to the default).

Heavy, 1 job at a time across all worktrees by default (`--lane heavy`, the default):

- `backend/check.sh` without a test path, `pytest` without a path
- `pnpm test` without a path, `pnpm build`, `pnpm e2e`, `pnpm e2e:visual`
- `infra/ship.sh`

Medium, 2 jobs at a time (`--lane medium`):

- `pnpm typecheck`, `pnpm lint`
- a vitest folder with `--maxWorkers=2`, a pytest path with `-n 2 --no-cov`

Light, no lock: one test file, ruff or prettier on changed files, `git`.

```bash
infra/dev/heavy --lane medium --label wp-12-types -- bash -c 'cd apps/web && pnpm typecheck'
```

During development run only the targeted tests of your task. The command runs as given, in its own process
group, with stdin from `/dev/null`.

## Options and defaults

| Option | Default | Meaning |
|---|---|---|
| `--lane heavy\|medium` | `heavy` | Which lane to take a slot in |
| `--label TEXT` | basename of the command | Name shown in `--status` and in the waiting lines |
| `--wait MIN` | 60 | Give up after MIN minutes in the queue, exit 75 |
| `--max MIN` | 40 | Kill the command's process group after MIN minutes, exit 124 |

Environment, for the self-test (nobody else needs to set these):

| Variable | Default | Use |
|---|---|---|
| `IDRAFT_LOCK_ROOT` | `<git common dir>/idraft-locks` | Lock state root |
| `IDRAFT_HEALTH_DIR` | `/tmp/idraft-health` | Where `pause` and `state` are read |
| `IDRAFT_HEAVY_POLL` | `5` | Seconds between polls, fractions allowed |
| `IDRAFT_HEAVY_UNIT` | `60` | Seconds per "minute" of `--wait`, `--max` and the progress line |
| `IDRAFT_HEAVY_GRACE` | `10` | Seconds between TERM and KILL of the command's group |

While it waits, `heavy` prints one line every minute on stderr, for example
`heavy: waiting for backend-check (pid 4242, 3m12s), 2 ahead`.

## Exit codes

| Code | Meaning |
|---|---|
| the command's own | The command ran; `heavy` passes its status through |
| 64 | Usage error, for example `heavy: missing -- before the command` or `heavy: --lane must be heavy or medium, got 'fast'` |
| 75 | Gave up waiting (`--wait`), also while the machine was paused |
| 124 | Run timeout (`--max`): the whole process group was killed |
| 129, 130, 143 | The wrapper got HUP, INT or TERM; the command's group is stopped first |

## The pause file

`infra/dev/health-watch.sh` writes `/tmp/idraft-health/state` every 30 seconds and creates
`/tmp/idraft-health/pause` at CRIT (disk, memory, swap or load). It removes the file after two calm samples.
While `pause` exists, `heavy` starts nothing new, keeps the queue order, and prints
`heavy: paused by infra/dev/health-watch.sh (/tmp/idraft-health/pause)` followed by the state file.
Running jobs are never stopped. The wait timeout keeps counting, so a long pause ends in exit 75.

Start the watcher once per machine. Check first:

```bash
cat /tmp/idraft-health/pid && kill -0 "$(cat /tmp/idraft-health/pid)" && echo running
```

If that prints no `running`, start it with `nohup infra/dev/health-watch.sh >/dev/null 2>&1 &`. If it runs
with a custom `STATE_DIR`, set `IDRAFT_HEALTH_DIR` to the same path for `heavy`.

## Where state lives

- `<git common dir>/idraft-locks/<lane>/`: `slot-N` directories (each with an `owner` file) and `tickets/`.
- `<git common dir>/ai-visibility/status/WP-NN.txt`: line 1 is the report line, then `note=` and `at=`.

Both are outside git and shared by every worktree. Recovery is automatic: on every poll, tickets of dead
waiters and slots of dead jobs are removed. A slot stays held while its wrapper or its command group is alive.
Never delete a slot by hand while its pid or group lives. `heavy --status` marks dead entries and removes nothing.
With nothing running it prints `pause: off`, `heavy: idle` and `medium: idle`; a holder reads
`heavy: slot-1 pid 4242 label backend-check worktree <path> running 3m12s cmd <cmd>`, a waiter
`heavy: queue 1: pid 4300 label web-build waiting 1m05s`.

## Quiet window before a release

The coordinator announces it. Each session finishes or parks its task with a local WIP commit (never
`git stash`: the stash is shared by every worktree), pushes what is green, stops its dev server and starts no
heavy job. When both lanes are idle and `pgrep -f 'bash.*infra/ship.sh'` prints nothing, the coordinator runs
`infra/dev/heavy --label release --wait 30 --max 30 -- infra/ship.sh` in the background.

## Self-test

```bash
infra/dev/heavy --label wp-00-selftest -- bash infra/test/dev-heavy.sh [all|heavy|wp-status|wp-start]
```

It sets its own lock root, so it does not collide with the lock that runs it. Run it in the heavy lane: two
copies at once count each other's watchdog processes and fail. `TEST_BASH` picks the bash that
runs the scripts under test.

## Known limits

- `infra/ship.sh` does not take the lock itself. That is an ops change; until then release only in the quiet window.
- Do not nest: a `heavy` call inside a command already run by `heavy` in the same lane waits for itself.
- A `kill -9` of the wrapper skips its cleanup. The slot stays held while the command's group is alive, and
  frees itself once the group is gone. The watchdog of that run exits at the same moment.
- If the OS reuses the pid of a dead waiter, its ticket stays queued until that process exits.

## As built (WP-00)

Built as `heavy`, `wp-status`, `wp-start` and the self-test `infra/test/dev-heavy.sh` (44 tests, about 35 s, run
under `/bin/bash` 3.2 and bash 5). The package changes no backend or web code, so docs 19 and 29 take no note.

Decisions taken:

- Nanosecond ticket names come from `perl` (`Time::HiRes`), not `python3`: on a clean Mac `python3` is the Xcode
  stub, which can open an install dialog.
- A slot is held while its wrapper pid (checked with its `ps` start time, against pid reuse) or its command's
  process group is alive. Reaping renames the slot first, then judges the renamed copy, then removes it.
- The watchdog polls once a second and leaves when the wrapper and the group are both gone.
- `wp-start` creates branches with `--no-track`, so a bare `git push` cannot reach `develop`, and allows one
  branch per package. It finds the repository from the current directory.
- The status line uses `tasks`, as MASTER-PLAN 6.4 does, not the `steps` of the WP-00 brief.
- All tests are in one file, as the brief names one self-test.

Not covered: pid reuse for tickets, a TERM sent to a waiting wrapper (acted on after the current poll, up to 5 s), nesting `heavy` in the same lane, `infra/ship.sh` taking the lock by itself,
Linux `stat` and `ps` differences (only this Mac runs it), a branch named like a tag in `wp-status`, and a
`wp-start` clone whose `remote.origin.fetch` does not cover `develop`.
