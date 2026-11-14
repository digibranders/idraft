# WP-70: Page-level AI readiness (optional, only if the owner opens it, OD-11)

| Field | Value |
|---|---|
| Wave | W7: Optional: page-level AI readiness |
| Kind | both |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-70-geo-readiness` in `.claude/worktrees/wp-70` (`infra/dev/wp-start WP-70 geo-readiness`) |
| Depends on (merged on develop first) | [WP-63 ssrf-webhooks](WP-63-ssrf-webhooks.md) |
| Owner decisions | D-08 Page-level AI readiness (GEO) in scope (default: Stays closed; optional wave 7 only on the owner's word) |
| Estimate | 12 Sonnet-agent tasks, about 9 hours with one task in flight |
| Rows | 21 (built already: 0, to do: 21) |

## Goal

Only if D-08 opens it: robots.txt per AI bot, `llms.txt`, sitemap and meta robots, JSON-LD found vs expected, a checklist with the HTML fact (no score), page watchlist and URL import, page type and freshness facts, fix inbox with suggested snippets, time to first citation; on the web the AI readiness tab on SEO > Pages.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/superpowers/plans/2026-11-12-ai-prompts-d-backend-handoff.md section 2 (the ten backend rules)
- docs/superpowers/specs/2026-11-12-ai-visibility-competitor-study.md M-09, M-10, GD-15 to GF-02
- docs/32-page-performance.md

## Files this package owns

- `backend/src/idraft/readiness/ (new)`
- `apps/web/src/features/readiness/ (new)`

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

C15 page checks, contract note first.

Contract first: when the package adds or changes a route, its first push is the schemas and the route signatures (answering `501 not_implemented` until filled), the regenerated `openapi/v1.json` and, in the same push, the regenerated web client. The contract note goes in `docs/ai-visibility/contracts/`.
Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; Sonnet implementers; one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-70 geo-readiness`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-70-geo-readiness.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Checks: robots, llms.txt, sitemap, meta, JSON-LD | BE-GEO-02..05 |
| 2 | Checklist, watchlist, facts, fix inbox, time to first citation | BE-GEO-06..09, BE-SOURCES-24 |
| 3 | Web tab | WB-IA-11, WB-GEO-01..11 |
| 4 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- No score anywhere; every check shows the HTML fact
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

- One commit per task, message `WP-70: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-70 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-70 <status> | branch ai/wp-70-geo-readiness @ <short sha> | rows done <n>/21 | steps <n>/5 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| BE-GEO-02 | BE | NOT BUILT | robots.txt check per AI bot (GPTBot, Google-Extended, PerplexityBot, C |
| BE-GEO-03 | BE | NOT BUILT | `llms.txt` presence and parse |
| BE-GEO-04 | BE | NOT BUILT | Sitemap and meta robots checks for a page |
| BE-GEO-05 | BE | NOT BUILT | JSON-LD found vs expected for the page type (Article, BreadcrumbList,  |
| BE-GEO-06 | BE | NOT BUILT | Page checklist (pass, warning, fail with the HTML fact), no score (GD- |
| BE-GEO-07 | BE | NOT BUILT | Page watchlist and URL import for checks |
| BE-GEO-08 | BE | NOT BUILT | Page type label and freshness and authorship facts (GD-19, GD-21) |
| BE-GEO-09 | BE | NOT BUILT | Fix inbox with suggested snippet, status (suggested, reviewed, done),  |
| BE-SOURCES-24 | BE | NOT BUILT | Time to first citation for owned pages (sitemap `lastmod`) |
| WB-IA-11 | WB | NOT BUILT | Pages > AI readiness tab |
| WB-GEO-01 | WB | NOT BUILT | "AI readiness" tab on SEO > Pages detail |
| WB-GEO-02 | WB | NOT BUILT | Target URL pick from watched pages or paste; the fetch it will make is |
| WB-GEO-03 | WB | NOT BUILT | URL list or CSV import (GA-02) |
| WB-GEO-04 | WB | NOT BUILT | Pages analysed "11 of 38 watched pages checked, Oct 6" (GD-03) |
| WB-GEO-05 | WB | NOT BUILT | Robots.txt per AI bot (GPTBot, Google-Extended, PerplexityBot), `llms. |
| WB-GEO-06 | WB | NOT BUILT | JSON-LD found vs expected for the page type (GD-16, M-10) |
| WB-GEO-07 | WB | NOT BUILT | Checklist `SimpleTable`: check, status, the HTML fact behind it; no sc |
| WB-GEO-08 | WB | NOT BUILT | Failing checks per page with count of pages affected (GD-08) |
| WB-GEO-09 | WB | NOT BUILT | Suggested fix snippet with copy, "suggestion, not applied" (GD-17) |
| WB-GEO-10 | WB | NOT BUILT | Fix inbox with status suggested, reviewed, done (GF-02) |
| WB-GEO-11 | WB | NOT BUILT | Freshness and authorship facts (GD-19), page type badge (GD-21), quota |
