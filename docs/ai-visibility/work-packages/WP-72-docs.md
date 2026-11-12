# WP-72: Docs: As built notes, drift fixes, design-system additions

| Field | Value |
|---|---|
| Wave | X: Cross-wave: quality sweeps, docs, releases and acceptance |
| Kind | docs |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-72-docs` in `.claude/worktrees/wp-72` (`infra/dev/wp-start WP-72 docs`) |
| Depends on (merged on develop first) | none |
| Owner decisions | D-20 Copy the Overview wireframe into DS 24 as 9.2a (default: Yes); D-28 Topic routes of doc 20 5.11 (Topic Explorer) (default: Drop; superseded by the Topics tab (ADR-DS-022)) |
| Estimate | 5 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 2 (built already: 1, to do: 1) |

## Goal

Keep the specs true: the doc drift of backend.md (include=series built, funnel filter not built, gzip built on develop, sources read without a rollup, Run now on the standard queue), As built notes per package in doc 19 and doc 29, DS 24 9.2a (the Overview wireframe), DS 15 additions for the new chart parts, doc 16 registry keys, the drop of the topic routes (D-28).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- backend.md doc drift list
- MASTER-PLAN section 8 (resolutions)

## Files this package owns

- docs/19-api-specification.md, docs/29-phase-roadmap.md (As built sections only)
- docs/design-system/24-page-templates.md 9.2a
- docs/16-metrics-methodology.md 2.1

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

Haiku writes the As built notes from each package's report; one Sonnet reviewer checks them.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-72 docs`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-72-docs.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Drift fixes and the topic routes drop | BE-OPS-10, BE-TOPICS-10 |
| 2 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- No em-dash or en-dash in any changed doc
- Plain ASCII, no em-dash or en-dash, links resolve
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-72: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-72 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-72 <status> | branch ai/wp-72-docs @ <short sha> | rows done <n>/2 | steps <n>/3 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-OPS-10 | BE | BUILT | As built notes in doc 19 and doc 29 at the end of each plan |
| BE-TOPICS-10 | BE | NOT BUILT | Topic detail `GET {P}/topics/tree`, `GET {P}/topics/{termId}` (Topic E |
