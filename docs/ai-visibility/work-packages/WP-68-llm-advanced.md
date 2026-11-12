# WP-68: LLM-backed and Phase 15 analytics: adjudication, claims, diagnostics, experiments

| Field | Value |
|---|---|
| Wave | W6: Blocked by the provider or the owner: AI Overview engine and cross-channel, discovery sources, engine expansion, LLM features, first-party signals |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-68-llm-advanced` in `.claude/worktrees/wp-68` (`infra/dev/wp-start WP-68 llm-advanced`) |
| Depends on (merged on develop first) | [WP-54 extract-recommend](WP-54-extract-recommend.md), [WP-58 stats-api](WP-58-stats-api.md) |
| Owner decisions | D-27 LLM use (adjudication, category classification, candidate variants, onboarding suggestions) (default: No until a provider and a budget are chosen; rules and templates first) |
| Estimate | 14 Sonnet-agent tasks, about 10 hours with one task in flight |
| Rows | 13 (built already: 0, to do: 13) |

## Goal

Blocked by D-27 (LLM spend and provider): the LLM client with JSON schema output, data delimiters and cost events, the `extraction_llm` budget, stage 11 adjudication, claims review behind a flag, LLM competitor and topic suggestions at onboarding (web too), prompt and keyword diagnostics, content gap, experiment panels, population intervals, answer similarity, the Diagnostics tab on Prompt Detail.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/13 stage 11
- docs/24 7.2 (prompt injection)
- docs/15 section 8
- docs/17 4.3

## Files this package owns

- `backend/src/idraft/llm/ (new)`
- `backend/src/idraft/diagnostics/ (new)`
- `apps/web/src/features/prompt-detail/diagnostics/`
- `apps/web/src/features/onboarding/llm-suggestions/`

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

C4 claims, diagnostics routes of doc 19 3.8.3, contract notes per part.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans and reviews the LLM client and prompt-injection defences; Sonnet implements.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-68 llm-advanced`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-68-llm-advanced.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | LLM client and budget | BE-OPS-11, BE-BILLING-PLAN-LINKS-12 |
| 2 | Adjudication and claims | BE-RECOMMEND-04, BE-RECOMMEND-08 |
| 3 | Onboarding suggestions | BE-COMPETITORS-10, WB-SET-16 |
| 4 | Diagnostics and content gap | BE-REPORTS-05, BE-REPORTS-06, BE-GEO-10, WB-PD-15 |
| 5 | Experiments, population intervals, answer similarity | BE-PANELS-11, BE-STATS-09, BE-STATS-10 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Answer text reaches the LLM only inside data delimiters; injection fixtures do not change output
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
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

- One commit per task, message `WP-68: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-68 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-68 <status> | branch ai/wp-68-llm-advanced @ <short sha> | rows done <n>/13 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-OPS-11 | BE | NOT BUILT | LLM client for extraction and generation (provider adapter, JSON schem |
| BE-BILLING-PLAN-LINKS-12 | BE | NOT BUILT | `extraction_llm` budget group and cost events |
| BE-RECOMMEND-04 | BE | NOT BUILT | Stage 11 budgeted LLM adjudication (uncertain mentions, ambiguous reco |
| BE-RECOMMEND-08 | BE | NOT BUILT | Claims: `ai.claims`, `ai.claim_occurrences`, `GET {P}/ai/claims`, `... |
| BE-COMPETITORS-10 | BE | NOT BUILT | LLM suggestions for competitors and topics at onboarding (DB-31) |
| WB-SET-16 | WB | NOT BUILT | Onboarding: LLM competitor and topic suggestions with accept or reject |
| BE-REPORTS-05 | BE | NOT BUILT | Prompt diagnostics `GET {P}/diagnostics/prompts/{id}` (evidence then h |
| BE-REPORTS-06 | BE | NOT BUILT | Keyword diagnostics with linked prompts evidence (E8) |
| BE-GEO-10 | BE | NOT BUILT | Content gap: topics and entities in competitor recommending answers ab |
| WB-PD-15 | WB | NOT BUILT | Diagnostics tab ("why did we lose this prompt") (M-18) |
| BE-PANELS-11 | BE | NOT BUILT | Experiment panels (treatment and control, frozen) |
| BE-STATS-09 | BE | NOT BUILT | Population intervals (cluster bootstrap) and competitor gap bootstrap |
| BE-STATS-10 | BE | NOT BUILT | Answer similarity (MinHash) |
