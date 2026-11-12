# WP-66: Discovery sources: PAA, GSC questions, fan-out to inbox, modeled demand

| Field | Value |
|---|---|
| Wave | W6: Blocked by the provider or the owner: AI Overview engine and cross-channel, discovery sources, engine expansion, LLM features, first-party signals |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-66-discovery-sources` in `.claude/worktrees/wp-66` (`infra/dev/wp-start WP-66 discovery-sources`) |
| Depends on (merged on develop first) | [WP-45 candidates-api](WP-45-candidates-api.md), [WP-64 aio-xch-api](WP-64-aio-xch-api.md) |
| Owner decisions | D-27 LLM use (adjudication, category classification, candidate variants, onboarding suggestions) (default: No until a provider and a budget are chosen; rules and templates first); D-50 When rank data is reliable again (AI Overview, matrix, SEO per topic) (default: Owner and the rank session decide; wave 6 waits) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 3 (built already: 0, to do: 3) |

## Goal

Blocked by rank data and spend: candidate sources from stored SERPs (PAA, related searches), GSC question queries, fan-out questions and competitor keywords; fan-out queries into the keyword inbox; modeled AI demand on candidates (labelled, sort only).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/11 sections 5.1 and 7
- docs/07 section 8

## Files this package owns

- `backend/src/idraft/discovery/ (new)`

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

Adds candidate `source` values; no new route.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; Sonnet implementers per source; one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-66 discovery-sources`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-66-discovery-sources.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Candidate sources | BE-PROMPTS-22 |
| 2 | Fan-out to keyword inbox | BE-FANOUT-07 |
| 3 | Modeled AI demand (spend) | BE-PROMPTS-24 |
| 4 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Modeled demand is labelled and never mixed into rates
- Every new route has its access line in `test_route_access.py` and is scanned by `test_cross_tenant.py` (inside the package's anchor block); every new table has RLS, grants and a `_TENANT_ROWS` entry
- Aggregates are one grouped query with a statement count test; new expensive parts are opt-in (`include=` or a parameter) and absent unless asked; branded prompts excluded by default
- `backend/openapi/v1.json` regenerated (`cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`) and, in the same push, `pnpm gen:api` and `pnpm typecheck` in apps/web
- Targeted pytest (`--no-cov`, `-n 2`) in the medium lane during work; `./check.sh` through `infra/dev/heavy` before the last push
- No real provider or LLM call in any test or check
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- Prove it bites (risky code: money, tenants, locks, cursors, statistics): for every guard the package adds, the reviewer removes or weakens it in a scratch commit that is never pushed, runs the targeted test, records that it fails, and restores the guard; the list of guards and the failing test names go into the package report
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-66: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-66 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-66 <status> | branch ai/wp-66-discovery-sources @ <short sha> | rows done <n>/3 | steps <n>/5 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-PROMPTS-22 | BE | NOT BUILT | Candidate sources: PAA and related searches from stored SERPs, GSC que |
| BE-FANOUT-07 | BE | NOT BUILT | Fan-out queries into the keyword inbox and as `fanout` link suggestion |
| BE-PROMPTS-24 | BE | NOT BUILT | Modeled AI demand on candidates (`seo.ai_demand_snapshots`, AI Keyword |
