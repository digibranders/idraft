# WP-64: AI Overview engine and cross-channel backend (needs rank data, OD-13)

| Field | Value |
|---|---|
| Wave | W6: Blocked by the provider or the owner: AI Overview engine and cross-channel, discovery sources, engine expansion, LLM features, first-party signals |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-64-aio-xch-api` in `.claude/worktrees/wp-64` (`infra/dev/wp-start WP-64 aio-xch-api`) |
| Depends on (merged on develop first) | [WP-44 links-generate](WP-44-links-generate.md), [WP-58 stats-api](WP-58-stats-api.md) |
| Owner decisions | D-50 When rank data is reliable again (AI Overview, matrix, SEO per topic) (default: Owner and the rank session decide; wave 6 waits) |
| Estimate | 12 Sonnet-agent tasks, about 9 hours with one task in flight |
| Rows | 17 (built already: 1, to do: 16) |

## Goal

Blocked until rank tracking resumes (OD-13, D-50). AI Overview as the fourth engine: engine row, AIO observations from rank checks, extraction, per prompt AIO through the primary linked keyword with `source_state`, AIO citation by rank bucket, AI Mode on tracked keywords; volume weighted SEO visibility per topic (B9b); link suggestions; matrix, page intelligence, rank association, AI-first opportunities; fan-out queries where we rank; SEO competitor suggestions and cross-channel competitors.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/09, docs/10, docs/15
- docs/19 3.8.1 to 3.8.3
- ADR-DS-022 decision 11

## Files this package owns

- `backend/src/idraft/api/xch/ (new)`
- `backend/src/idraft/collectors/ai_mode_keyword.py (new)`
- `backend/src/idraft/api/ai/aio*.py (new)`

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

C7 AIO part and C14, pushed first with stubs and gen:api.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; Sonnet implementers per part; one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-64 aio-xch-api`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-64-aio-xch-api.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | AIO engine, observations, extraction, per prompt cell | BE-ENGINES-06, BE-AIO-01..03, BE-AIO-06, CF-19 |
| 2 | AIO by rank bucket, AI Mode keywords | BE-AIO-04, BE-AIO-05, BE-COLLECT-12 |
| 3 | SEO visibility per topic | BE-TOPICS-09 |
| 4 | Links suggest, matrix, page intelligence, association, opportunities | BE-BILLING-PLAN-LINKS-03, BE-BILLING-PLAN-LINKS-05..07 |
| 5 | Fan-out where we rank; competitor suggestions; cross-channel competitors | BE-FANOUT-05, BE-COMPETITORS-07, BE-COMPETITORS-09 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Nothing here starts before D-50 says rank data is reliable again
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

- One commit per task, message `WP-64: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-64 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-64 <status> | branch ai/wp-64-aio-xch-api @ <short sha> | rows done <n>/17 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-ENGINES-06 | BE | NOT BUILT | `google_ai_overview` engine row (`serp_ai`, keyword level, collected w |
| BE-AIO-01 | BE | BUILT | Keyword level AI Overview presence and citation from rank checks (`has |
| BE-AIO-02 | BE | NOT BUILT | AI Overview answers as `ai.observations` (`serp_snapshot_id`, `tracked |
| BE-AIO-03 | BE | NOT BUILT | AI Overview per prompt through the primary linked keyword, summary cel |
| BE-AIO-04 | BE | NOT BUILT | AIO citation rate by rank bucket `GET {P}/xch/aio-citation-by-rank` wi |
| BE-AIO-05 | BE | NOT BUILT | AI Mode on tracked keywords (`ai_mode_keyword`) |
| BE-AIO-06 | BE | NOT BUILT | AI Overview extraction (mentions and citations of the AIO answer throu |
| CF-19 | CF | SPEC | AI Overview engine cell with `source_state` (`no_linked_keyword`, `not |
| BE-COLLECT-12 | BE | NOT BUILT | Workload `ai_mode_keyword`: AI Mode on tracked keywords of opt-in grou |
| BE-TOPICS-09 | BE | NOT BUILT | `GET {P}/seo/metrics/breakdown?dimension=term` with volume weighted vi |
| BE-BILLING-PLAN-LINKS-03 | BE | NOT BUILT | `POST {P}/keyword-prompt-links/suggest`, `.../decide` (cluster, semant |
| BE-BILLING-PLAN-LINKS-05 | BE | NOT BUILT | SEO and AI matrix `GET {P}/xch/matrix`, `.../rows`, `.../clusters`, `c |
| BE-BILLING-PLAN-LINKS-06 | BE | NOT BUILT | Page intelligence `GET {P}/pages`, `.../{url_id}`, `.../series`, `.../ |
| BE-BILLING-PLAN-LINKS-07 | BE | NOT BUILT | `GET {P}/xch/rank-citation-association`, `GET {P}/opportunities/ai-fir |
| BE-FANOUT-05 | BE | NOT BUILT | Fan-out queries where own ranks (F5, `matched_keyword`, `own_rank`) |
| BE-COMPETITORS-07 | BE | NOT BUILT | SEO competitor suggestions `GET {P}/competitor-suggestions` |
| BE-COMPETITORS-09 | BE | NOT BUILT | Cross-channel competitor views `GET {P}/xch/competitors`, `GET {P}/xch |
