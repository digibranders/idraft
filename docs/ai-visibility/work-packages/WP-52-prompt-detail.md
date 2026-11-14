# WP-52: Prompt Detail page `/ai/prompts/[promptId]` (T3)

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-52-prompt-detail` in `.claude/worktrees/wp-52` (`infra/dev/wp-start WP-52 prompt-detail`) |
| Depends on (merged on develop first) | [WP-41 versions](WP-41-versions.md), [WP-21 citations-core](WP-21-citations-core.md), [WP-24 fanout-views](WP-24-fanout-views.md), [WP-06 chart-grids](WP-06-chart-grids.md) |
| Owner decisions | D-47 Prompt Detail page in this programme (default: Yes, wave 4) |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 17 (built already: 1, to do: 16) |

## Goal

The deep Prompt Detail page: header with Edit and Statistics, meta line, compare and engine scopes, strip, Overview tab (rates with intervals, outcome mix, per engine trends with bands and boundaries, related keywords), Answers tab with the evidence split and compare, Citations, Competitors, Fan-out, History timeline, statistics panel, the Open page entries and the child breadcrumb.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/design-system/24 9.6
- web.md 2.16

## Files this package owns

- `apps/web/src/features/prompt-detail/ (new)`
- `apps/web/src/app/[workspace]/[project]/ai/prompts/[promptId]/`

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

Consumes existing reads plus versions and timeline.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; three Sonnet implementers (shell and Overview; Answers and History; the other tabs); one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-52 prompt-detail`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-52-prompt-detail.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Route, header, meta, scopes, strip, entries, breadcrumb | WB-IA-08, WB-PD-01..04, WB-PI-03, WB-MNU-07, WB-NAV-04, WB-PIH-12 |
| 2 | Overview tab | WB-PD-05, WB-PD-06, WB-PD-08 |
| 3 | Answers, Citations, Fan-out tabs (Competitors tab gap comes with statistics) | WB-PD-09, WB-PD-10, WB-PD-12 |
| 4 | History and statistics panel | WB-PD-13, WB-PD-14 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Every tab works at 390 px
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

- One commit per task, message `WP-52: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-52 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-52 <status> | branch ai/wp-52-prompt-detail @ <short sha> | rows done <n>/17 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-IA-08 | WB | NOT BUILT | Prompt Detail |
| WB-PD-01 | WB | NOT BUILT | Route `/ai/prompts/[promptId]`, `DetailPageHeader` with Edit, Statisti |
| WB-PD-02 | WB | NOT BUILT | Meta line: version, core since, topic path, intent, type, branded |
| WB-PD-03 | WB | NOT BUILT | Compare and Engines scopes |
| WB-PD-04 | WB | NOT BUILT | Strip md: mention per engine, citation avg, recommendation, structured |
| WB-PD-05 | WB | NOT BUILT | Overview tab: rate table with intervals and outcome mix bar per engine |
| WB-PD-06 | WB | NOT BUILT | Overview: per engine trend small multiples, 140 px, CI bands, version  |
| WB-PD-08 | WB | NOT BUILT | Overview: related keywords |
| WB-PD-09 | WB | NOT BUILT | Answers tab: observations table with the evidence viewer split; compar |
| WB-PD-10 | WB | NOT BUILT | Citations tab with `min_support` and engine split |
| WB-PD-12 | WB | NOT BUILT | Fan-out tab |
| WB-PD-13 | WB | NOT BUILT | History tab: `EventTimeline` of versions, membership, model and extrac |
| WB-PD-14 | WB | NOT BUILT | Statistics panel (`StatisticsPanel`) |
| WB-PI-03 | WB | NOT BUILT | Header "Open page" expand button |
| WB-MNU-07 | WB | NOT BUILT | Prompt row: Open page (Prompt Detail) |
| WB-NAV-04 | WB | BUILT | Breadcrumb "Project > Topics & Prompts", and child crumb for Prompt De |
| WB-PIH-12 | WB | NOT BUILT | "Open full timeline" link (`itab=history` on Prompt Detail) |
