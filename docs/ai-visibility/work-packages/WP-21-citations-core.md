# WP-21: Citations tab in the prompt inspector and the Citations page (Domains, Pages)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-21-citations-core` in `.claude/worktrees/wp-21` (`infra/dev/wp-start WP-21 citations-core`) |
| Depends on (merged on develop first) | [WP-08 app-parts-b](WP-08-app-parts-b.md), [WP-05 chart-bars](WP-05-chart-bars.md), [WP-10 controls](WP-10-controls.md) |
| Owner decisions | D-02 Prompt inspector tabs: 5 or 6 (and where Versions and Runs go) (default: 6 tabs: Latest, History, Citations, Competitors, Fan-out (only when an enabled engine exposes it), Stats. Versions and runs are sections of History; the full timeline is on Prompt Detail. DS 23 4.1 amended to allow 6) |
| Estimate | 9 Sonnet-agent tasks, about 7 hours with one task in flight |
| Rows | 31 (built already: 0, to do: 31) |

## Goal

Build the prompt Citations tab (top domains and pages, engine split, New and Lost markers, not cited state, count popover, cited page, positions never called rank, min_support) and the Citations page `/ai/citations` with Domains and Pages tabs (header, meta, filters, strip, domain rows expanding to pages, chooser columns, cited with, prompts with no own page, export, states), on the routes already on develop. Flip the navigation entry live.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- W2 plan W7
- docs/14-citation-intelligence.md
- docs/design-system/24 9.7
- web.md 2.11 Citations, 2.18

## Files this package owns

- `apps/web/src/features/citations/ (new)`
- `apps/web/src/features/prompts/inspector/citations/ (new)`
- `apps/web/src/app/[workspace]/[project]/ai/citations/`
- `apps/web/src/mocks/handlers/citations.ts`
- `apps/web/e2e/flows/ai-citations.spec.ts`

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

Consumes `ai/citations`, `ai/sources/domains`, `ai/sources/pages` (CF-02, CF-03) and the sources lane additions when merged.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; three Sonnet implementers (mocks and Citations tab; Domains tab; Pages tab and strip); one Sonnet reviewer; Haiku writes the MSW mocks to the generated types.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-21 citations-core`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-21-citations-core.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | MSW mocks for citations, domains, pages with tests | CF-02, CF-03 |
| 2 | Prompt Citations tab | WB-PIC-01..10, WB-PI-13, WB-PI-21 |
| 3 | Citations page shell, meta, filters, strip, nav live | WB-IA-03, WB-CIT-01..05 |
| 4 | Domains tab with expanding pages, chooser, min_support | WB-CIT-06..09 |
| 5 | Pages tab, cited with, no own page, export, states | WB-CIT-10, WB-CIT-11, WB-CIT-14..16, WB-CIT-19 |
| 6 | e2e | WB-E2E-10 |
| 7 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Every share shows "of N units"; a position says "Source 2 of 9", never rank
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-21: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-21 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-21 <status> | branch ai/wp-21-citations-core @ <short sha> | rows done <n>/31 | steps <n>/8 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| CF-02 | CF | SPEC | Citations aggregates for one prompt: `ai/sources/domains` and `ai/sour |
| CF-03 | CF | SPEC | Citation rows behind a count: `ai/citations` with `filter[registrable_ |
| WB-PIC-01 | WB | NOT BUILT | Top 5 domains with role and citation units (G97) |
| WB-PIC-02 | WB | NOT BUILT | Top 5 pages with title and units |
| WB-PIC-03 | WB | NOT BUILT | Per engine split of the top lists (engine select or columns) |
| WB-PIC-04 | WB | NOT BUILT | New and Lost markers vs the previous period |
| WB-PIC-05 | WB | NOT BUILT | Not cited state: "Not cited in 0 of 8 answers" with who is cited inste |
| WB-PIC-06 | WB | NOT BUILT | Count cell popover listing up to 5 domains (U-15) |
| WB-PIC-07 | WB | NOT BUILT | Own page cited per answer ("Cited page" column) (PR-51, M-02) |
| WB-PIC-08 | WB | NOT BUILT | "Source 2 of 9" position, never "rank" (PR-32) |
| WB-PIC-09 | WB | NOT BUILT | Empty and error states naming the cause |
| WB-PIC-10 | WB | NOT BUILT | `min_support` control |
| WB-PI-13 | WB | NOT BUILT | Citations tab (G97) |
| WB-PI-21 | WB | NOT BUILT | Header banner "Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13  |
| WB-IA-03 | WB | NOT BUILT | AI Visibility > Citations |
| WB-CIT-01 | WB | NOT BUILT | Route, nav entry, `PageHeader` with Saved view, Export, More |
| WB-CIT-02 | WB | NOT BUILT | Meta "Updated ..., 18,420 citation units in 4,812 observations" |
| WB-CIT-03 | WB | NOT BUILT | Tabs Domains, Pages, New and lost (`tab=`) |
| WB-CIT-04 | WB | NOT BUILT | Filter bar: Engines, Role (Own, Competitor, Third party with counts),  |
| WB-CIT-05 | WB | NOT BUILT | Strip: Citation units, Distinct domains, Effective sources (C3), Own c |
| WB-CIT-06 | WB | NOT BUILT | Domains table: Domain (favicon), Role, Category, Units, Share, Change  |
| WB-CIT-07 | WB | NOT BUILT | Domain row expands to its top 10 pages, "View all 48 pages" opens Page |
| WB-CIT-08 | WB | NOT BUILT | Observations and Prompts columns in the chooser |
| WB-CIT-09 | WB | NOT BUILT | `min_support` select |
| WB-CIT-10 | WB | NOT BUILT | Pages tab: URL with host, escaped title, role, units, share, engines,  |
| WB-CIT-11 | WB | NOT BUILT | Pages tab: "Cited with" column (CI-14) |
| WB-CIT-14 | WB | NOT BUILT | Count cell popover of up to 5 domains (U-15) |
| WB-CIT-15 | WB | NOT BUILT | Prompts with no own page cited (M-02) |
| WB-CIT-16 | WB | NOT BUILT | Export CSV of the table |
| WB-CIT-19 | WB | NOT BUILT | Empty (no citations yet), error, loading states |
| WB-E2E-10 | WB | NOT BUILT | Citations page and prompt Citations tab |
