# WP-73: Release gates and the first real-data acceptance run

| Field | Value |
|---|---|
| Wave | X: Cross-wave: quality sweeps, docs, releases and acceptance |
| Kind | infra |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-73-release-acceptance` in `.claude/worktrees/wp-73` (`infra/dev/wp-start WP-73 release-acceptance`) |
| Depends on (merged on develop first) | none |
| Owner decisions | D-26 Real provider spend: resume Eventus schedules and run the acceptance (default: A monthly AI budget of USD 10 for Eventus: its 72 prompts on 3 engines cost about USD 2.25 a month on the schedule (USD 4.70 at the 150 prompt base plan) and about USD 0.26 per full Run now, so USD 10 covers the schedule, the two acceptance runs and Run now headroom) |
| Estimate | 4 Sonnet-agent tasks, about 3 hours with one task in flight |
| Rows | 1 (built already: 0, to do: 1) |

## Goal

Run each release through the quiet window and the lock when the owner says "ship it"; after D-26 (budget and yes), resume the Eventus schedules and run the Phase 7 acceptance: two consecutive runs of the project's prompts on three engines with at least 95% valid and costs within 10% of the estimate, then the owner reviews the pages on real answers.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/ops/release-and-deploy.md
- docs/ops/ai-first-run.md

## Files this package owns

- no code; operates infra/ship.sh through infra/dev/heavy

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

None.


## Model plan

The coordinator runs it; no subagent edits code here.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-73 release-acceptance`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-73-release-acceptance.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Release gate checklist per release | process |
| 2 | Acceptance run after D-26 | BE-COLLECT-20 |
| 3 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- `main` moves only through `infra/ship.sh` on the owner's word
- `shellcheck -x` clean on every script changed
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- Prove it bites (risky code: money, tenants, locks, cursors, statistics): for every guard the package adds, the reviewer removes or weakens it in a scratch commit that is never pushed, runs the targeted test, records that it fails, and restores the guard; the list of guards and the failing test names go into the package report
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-73: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-73 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-73 <status> | branch ai/wp-73-release-acceptance @ <short sha> | rows done <n>/1 | steps <n>/4 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-COLLECT-20 | BE | NOT BUILT | Acceptance at full capacity: two consecutive runs of 150 prompts x 3 e |
