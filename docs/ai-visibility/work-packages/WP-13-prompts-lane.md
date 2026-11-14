# WP-13: Prompt records: lint upgrade, type rule, filters, bulk update, quotas, provenance

| Field | Value |
|---|---|
| Wave | W1: Shared web packages and the first backend lanes |
| Kind | backend |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-13-prompts-lane` in `.claude/worktrees/wp-13` (`infra/dev/wp-start WP-13 prompts-lane`) |
| Depends on (merged on develop first) | [WP-03 contract-pack](WP-03-contract-pack.md) |
| Owner decisions | D-21 Branded definition for lint (default: Own aliases only (as built); competitor aliases get their own warning rule); D-22 Who sets the funnel stage (default: The person, default unknown; no LLM); D-23 Bulk archive by filter form (default: Yes (small)); D-46 Optimistic concurrency on prompt PATCH (default: Yes (ETag and If-Match)) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 31 (built already: 8, to do: 23) |

## Goal

Give the Add, Import and Edit flows the API they need: lint that knows what is tracked and near duplicates (N01), the five lint rules (B17, N03) with `language_code`, `suggested_prompt_type`, the `prompt_type` server rule and override (B16, N02), the cost and answers estimate (N05), the branded override (N04), provenance (N07), the quota and limits read (N06, CF-11), list filters and sort (type, funnel, importance, branded, `is_active=any`), bulk update (N09), bulk archive by filter, ETag and If-Match on PATCH (N11), and term assignments and term counts for prompts.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- prompt-dialogs.md sections 1, 16, 18
- docs/11-ai-prompt-system.md section 4
- docs/19-api-specification.md 3.7.1, 3.5

## Files this package owns

- `backend/src/idraft/api/ai/prompt_service.py`
- `backend/src/idraft/api/ai/prompt_routes.py`
- `backend/src/idraft/api/ai/prompt_repository.py`
- `backend/src/idraft/api/ai/limits_routes.py (new)`
- backend/src/idraft/api/schemas/ai.py: Prompt, PromptCreate, PromptPatch, Lint*, PromptPage only
- `backend/src/idraft/api/schemas/ai_bulk.py`
- `backend/src/idraft/api/taxonomy/ (prompt subject only)`
- `backend/tests/api/ai/test_prompt*.py`

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

Implements contract C1 from the contract pack.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.

## Model plan

Opus plans; Sonnet implementers in sequence on the prompt service (two lanes in parallel only for the limits route and the taxonomy change, which touch other files); one Sonnet reviewer; prove-it-bites on quota and cost arithmetic and on the bulk update tenant scope. Haiku writes the lint rule fixture tables (positive, negative, non-Latin).

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-13 prompts-lane`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-13-prompts-lane.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Lint `items`, `tracked`, `near_duplicate_of`, `would_create` | PD-N01, BE-PROMPTS-08 |
| 2 | Five lint rules and `language_code` | BE-PROMPTS-09, PD-N03 |
| 3 | `prompt_type` rule, `prompt_type_source`, override, `suggested_prompt_type`, filter | BE-PROMPTS-10, BE-PROMPTS-11, PD-N02, CF-13 |
| 4 | Estimate in lint (cost and answers per engine) | PD-N05 |
| 5 | Branded override, provenance fields | PD-N04, PD-N07, BE-PROMPTS-15 |
| 6 | Quota and limits read: active prompts, manual runs today, monthly answers | PD-N06, BE-PROMPTS-16, CF-11 |
| 7 | List filters and sort, `is_active=any` | BE-PROMPTS-12, PD-N13 |
| 8 | Bulk update and bulk archive by filter | BE-PROMPTS-06, BE-PROMPTS-07, PD-N09, CF-12 |
| 9 | ETag and If-Match on PATCH | PD-N11 |
| 10 | Term assignments and term counts for prompts | BE-TOPICS-02, BE-TOPICS-03 |
| 11 | As built notes; built rows confirmed | BE-PROMPTS-01..05, BE-PROMPTS-25, BE-TOPICS-01 |
| 12 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Prove it bites: the quota check, the bulk update workspace scope and the If-Match comparison each have a test that fails when the guard is removed
- Lint stays `data:read` and stores nothing
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

- One commit per task, message `WP-13: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-13 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-13 <status> | branch ai/wp-13-prompts-lane @ <short sha> | rows done <n>/31 | steps <n>/13 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-PROMPTS-01 | BE | BUILT | Tables `ai.prompts`, `ai.prompt_versions` (`change_kind`, `change_reas |
| BE-PROMPTS-02 | BE | BUILT | `GET {P}/prompts` list with filters `q`, `term`, `intent_in`, `country |
| BE-PROMPTS-03 | BE | BUILT | `POST {P}/prompts` single create with quota, country check against ena |
| BE-PROMPTS-04 | BE | BUILT | `POST {P}/prompts/bulk-create` with `on_duplicate`, created, skipped,  |
| BE-PROMPTS-05 | BE | BUILT | `GET/PATCH/DELETE {P}/prompts/{id}` (PATCH metadata only, DELETE is ar |
| BE-PROMPTS-06 | BE | PARTIAL | `POST {P}/prompts/bulk-archive` by ids, archive or bring back within ` |
| BE-PROMPTS-07 | BE | NOT BUILT | `POST {P}/prompts/bulk-update` (topic, intent, importance, funnel, typ |
| BE-PROMPTS-08 | BE | BUILT | `POST {P}/prompts/lint`: `contains_brand_alias`, `engine_limit` |
| BE-PROMPTS-09 | BE | NOT BUILT | Lint rules `word_count` (5 to 60), `multiple_questions`, `leading_word |
| BE-PROMPTS-10 | BE | NOT BUILT | `prompt_type` server rule at create (OD-5) |
| BE-PROMPTS-11 | BE | NOT BUILT | `filter[prompt_type_in]` on `GET {P}/prompts` |
| BE-PROMPTS-12 | BE | NOT BUILT | `filter[funnel_stage_in]`, `filter[importance_in]`, `filter[is_branded |
| BE-PROMPTS-15 | BE | PARTIAL | `expected_frequency`, `source`, `creation_method` provenance fields |
| BE-PROMPTS-16 | BE | PARTIAL | Active prompt quota meter for the page header (used and limit) |
| BE-PROMPTS-25 | BE | BUILT | Prompt metadata audit log entries (metadata changes are not versions) |
| BE-TOPICS-01 | BE | BUILT | Prompts take topic terms (`term_ids` on create and patch), `ai.prompt_ |
| BE-TOPICS-02 | BE | PARTIAL | `POST {P}/term-assignments` with `subject_type: 'prompt'` |
| BE-TOPICS-03 | BE | NOT BUILT | `TermNode.prompt_count` on vocabulary term trees |
| CF-11 | CF | SPEC | Limits before the click: manual runs used today and the limit, monthly |
| CF-12 | CF | SPEC | Bulk PATCH of prompt metadata (`ids`, `term_ids`, `importance`, `inten |
| CF-13 | CF | SPEC | Prompt type rule and `filter[prompt_type_in]` |
| PD-N01 | N | NOT BUILT | Lint knows what the project tracks |
| PD-N02 | N | NOT BUILT | prompt_type rule and override |
| PD-N03 | N | NOT BUILT | Lint rules (B17) |
| PD-N04 | N | NOT BUILT | is_branded override at create |
| PD-N05 | N | NOT BUILT | Cost and answers estimate |
| PD-N06 | N | NOT BUILT | Workspace prompt quota read |
| PD-N07 | N | NOT BUILT | Provenance at create |
| PD-N09 | N | NOT BUILT | Bulk update |
| PD-N11 | N | NOT BUILT | Optimistic concurrency on PATCH |
| PD-N13 | N | NOT BUILT | Archived and active together |
