# WP-54: Extraction: markdown structure, structured rank, recommendation, sentiment

| Field | Value |
|---|---|
| Wave | W5: Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-54-extract-recommend` in `.claude/worktrees/wp-54` (`infra/dev/wp-start WP-54 extract-recommend`) |
| Depends on (merged on develop first) | [WP-12 summary-lane](WP-12-summary-lane.md) |
| Owner decisions | D-44 Competitor sentiment (default: Off (cost)); D-45 Who labels the AI gold set (default: An Opus pass drafts labels for 200 answers; the owner's team reviews them) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 17 (built already: 8, to do: 9) |

## Goal

Slice 2 extractor work: stage 3 markdown structure (blocks, inline markers, offsets), stage 6 structured lists, stage 9 recommendation rules, stage 10 lexicon sentiment, prominence filled, the summary cells recommended, recommended given mentioned, structured top 3 and 5, median rank, sentiment shares, the gold set as a merge gate (D-45).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/13 stages 3, 6, 7, 9, 10 and section 7
- docs/16 A5, A6, A9 to A11, A13

## Files this package owns

- `backend/src/idraft/extraction/`
- `backend/src/idraft/collectors/ai_facts*.py`
- `backend/tests/extraction/`
- backend/src/idraft/api/schemas/ai.py: EngineSummary recommendation cells (lease from the summary lane)

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

C2 later cells and C4 observation detail changes; contract note first.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; Sonnet implementers per stage in sequence (shared extraction files); one Sonnet reviewer; gold set precision and recall reported per stage.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-54 extract-recommend`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-54-extract-recommend.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Markdown structure | BE-EXTRACT-03, BE-EXTRACT-05 |
| 2 | Structured lists and rank | BE-RECOMMEND-01, BE-RECOMMEND-07 |
| 3 | Recommendation rules | BE-RECOMMEND-02 |
| 4 | Sentiment by lexicon | BE-RECOMMEND-03 |
| 5 | Prominence and summary cells | BE-RECOMMEND-05, BE-RECOMMEND-06, CF-18 |
| 6 | Gold set gate; built rows confirmed | BE-EXTRACT-17, BE-EXTRACT-01, BE-EXTRACT-02, BE-EXTRACT-04, BE-EXTRACT-06..09 |
| 7 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Gold set targets of doc 13 section 7 met or reported as a blocker
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

- One commit per task, message `WP-54: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-54 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-54 <status> | branch ai/wp-54-extract-recommend @ <short sha> | rows done <n>/17 | steps <n>/8 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-EXTRACT-01 | BE | BUILT | Stage 1 URL canonicalization into `core.urls` and `core.domains` |
| BE-EXTRACT-02 | BE | BUILT | Stage 2 domain role (own, competitor, third party) per citation |
| BE-EXTRACT-03 | BE | NOT BUILT | Stage 3 document structure (markdown blocks, inline marker mapping to  |
| BE-EXTRACT-04 | BE | BUILT | Stages 4 and 5 alias matching (Aho-Corasick, RE2) and disambiguation,  |
| BE-EXTRACT-05 | BE | PARTIAL | Stage 7 mention assembly: count, first offset, `mention_order`, promin |
| BE-EXTRACT-06 | BE | BUILT | `ai.entity_mentions`, `ai.observation_facts`, `ai.derivations` written |
| BE-EXTRACT-07 | BE | BUILT | `ai.citations` with `citation_index`, `occurrences`, `domain_role`, `r |
| BE-EXTRACT-08 | BE | BUILT | Validity rule (`is_valid` false for error, refused, empty, under 40 ch |
| BE-EXTRACT-09 | BE | BUILT | Entity config version bump on alias, entity or role change |
| BE-EXTRACT-17 | BE | NOT BUILT | AI gold set with doc 13 section 7 targets as merge gates |
| BE-RECOMMEND-01 | BE | NOT BUILT | Stage 6 structured list parsing: `structured_rank`, `structured_list_s |
| BE-RECOMMEND-02 | BE | NOT BUILT | Stage 9 recommendation rules (`is_recommended`, confidence, ambiguous) |
| BE-RECOMMEND-03 | BE | NOT BUILT | Stage 10 sentiment by lexicon, own brand, four classes; competitor sen |
| BE-RECOMMEND-05 | BE | PARTIAL | Prominence fact `own_prominence` filled and A11 cell |
| BE-RECOMMEND-06 | BE | NOT BUILT | Summary cells `recommended` (A5), recommended given mentioned (A6), st |
| BE-RECOMMEND-07 | BE | BUILT | Rank shown only as structured list rank; `own_mention_order` never sho |
| CF-18 | CF | SPEC | Recommendation, prominence, sentiment cells (`recommended` MetricCell, |
