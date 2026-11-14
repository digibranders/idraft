# WP-00: Coordination kit: heavy-job lock, status files, worktree helper

| Field | Value |
|---|---|
| Wave | W0: Scaffolding, contracts and the lock |
| Kind | infra |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-00-coordination-kit` in `.claude/worktrees/wp-00` (`infra/dev/wp-start WP-00 coordination-kit`) |
| Depends on (merged on develop first) | none |
| Owner decisions | none |
| Estimate | 4 Sonnet-agent tasks, about 3 hours with one task in flight |
| Rows | 0 (built already: 0, to do: 0) |

## Goal

Create the tools every session uses to share this Mac safely and to report progress: `infra/dev/heavy` (the lock that serializes full test suites, builds, e2e and releases), `infra/dev/wp-status` (writes the status file the coordinator reads) and `infra/dev/wp-start` (creates the worktree and branch of a work package with the right names). The coordinator session owns this package and the tracker.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/ai-visibility/MASTER-PLAN.md section 4 (the lock design)
- infra/ship.sh (read only)

## Files this package owns

- `infra/dev/heavy`
- `infra/dev/wp-status`
- `infra/dev/wp-start`
- `infra/dev/README.md`
- `infra/test/dev-heavy.sh`

## Files it must not touch

- Any file another work package owns (each WP file lists its own); ask the coordinator for a lease instead
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` except by regeneration in the same push as your own API change
- `backend/src/idraft/api/main.py`, `permissions.py`, `problems.py`, `resources.py` (WP-01 registered everything); new problem codes go in your own module as `ProblemError` subclasses
- `apps/web/src/lib/navigation/registry.ts` except flipping your own page's status to `live`
- `apps/web/src/mocks/handlers/index.ts` (WP-02 registered your handler module)
- `apps/web/e2e/support.ts` (add `apps/web/e2e/support/<slug>.ts` instead)
- Message namespaces of other packages in `apps/web/messages/en.json`
- `docs/ai-visibility/tracker.json` and `TRACKER.md` (the coordinator owns them)
- The main checkout, `.claude/worktrees/release`, Colima and the `idraft-dev-*` containers

## Contract

None. Produces the command line interfaces of section 4 of the master plan.


## Model plan

One Sonnet implementer for the three scripts and the self-test; one Sonnet reviewer. No Haiku work.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `git worktree add .claude/worktrees/wp-00 -b ai/wp-00-coordination-kit origin/develop` (the helper does not exist yet); report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-00-coordination-kit.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Write `infra/dev/heavy` to the design of MASTER-PLAN section 4: lanes heavy (1 slot) and medium (2 slots), FIFO tickets, stale owner recovery, wait and run timeouts, `--status` | process |
| 2 | Write `infra/dev/wp-status` (writes `<git-common-dir>/ai-visibility/status/WP-nn.txt` with the report line of MASTER-PLAN section 6.4) and `infra/dev/wp-start WP-nn slug` (worktree `.claude/worktrees/wp-nn`, branch `ai/wp-nn-slug` from `origin/develop`) | process |
| 3 | Self-test `infra/test/dev-heavy.sh`: two holders queue in order, a killed holder is recovered, a wait timeout exits 75, a run timeout exits 124 and frees the slot; shellcheck clean | process |
| 4 | `infra/dev/README.md`: one page, the commands and the rules of the lanes | process |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- `shellcheck -x infra/dev/*` is clean and `infra/test/dev-heavy.sh` passes
- Two sessions running `infra/dev/heavy -- sleep 5` at once run one after the other, and `infra/dev/heavy --status` shows holder and queue
- `shellcheck -x` clean on every script changed
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-00: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-00 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-00 <status> | branch ai/wp-00-coordination-kit @ <short sha> | rows done <n>/0 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
