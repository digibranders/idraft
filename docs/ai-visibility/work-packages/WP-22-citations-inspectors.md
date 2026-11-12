# WP-22: Citations: New and lost, domain and source inspectors, country, mobile

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-22-citations-inspectors` in `.claude/worktrees/wp-22` (`infra/dev/wp-start WP-22 citations-inspectors`) |
| Depends on (merged on develop first) | [WP-21 citations-core](WP-21-citations-core.md), [WP-14 sources-lane](WP-14-sources-lane.md) |
| Owner decisions | none |
| Estimate | 6 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 16 (built already: 0, to do: 16) |

## Goal

Finish the Citations page: New and lost tab (C5 and C6 with the rule in `MetricInfo`), unresolved redirect and engine-internal toggles, country scope on Citations, fan-out, competitors and overview pages, mobile list rows, the domain inspector (header, strip, share trend per engine, engine table, co-mentioned entities, SEO SOV of the domain, top pages, top prompts) and the source inspector (header, prompts, last answers).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- web.md 2.18 WB-DOM and WB-SRC
- docs/16 C5, C6

## Files this package owns

- `apps/web/src/features/citations/new-lost/`
- `apps/web/src/features/citations/domain-inspector/`
- `apps/web/src/features/citations/source-inspector/`

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

Consumes the sources lane (series, country, min_support, lost, cited with).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Two Sonnet implementers (tab and toggles; inspectors), one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-22 citations-inspectors`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-22-citations-inspectors.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | New and lost tab, toggles | WB-CIT-13, WB-CIT-18 |
| 2 | Country scope on the AI pages | WB-CIT-21, WB-NAV-08 |
| 3 | Mobile rows | WB-CIT-20 |
| 4 | Domain inspector | WB-DOM-01..08 |
| 5 | Source inspector | WB-SRC-01..03 |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Inspectors step with J and K over the table rows
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

- One commit per task, message `WP-22: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-22 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-22 <status> | branch ai/wp-22-citations-inspectors @ <short sha> | rows done <n>/16 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-CIT-13 | WB | NOT BUILT | New and lost tab: C5 and C6 lists with the rule in `MetricInfo` |
| WB-CIT-18 | WB | NOT BUILT | Include unresolved redirects and engine-internal links toggles (off) |
| WB-CIT-20 | WB | NOT BUILT | Mobile list rows |
| WB-CIT-21 | WB | NOT BUILT | Country scope |
| WB-NAV-08 | WB | NOT BUILT | Country scope on Citations, Fan-out, Competitors, Overview pages |
| WB-DOM-01 | WB | NOT BUILT | Domain inspector header: domain, category, role, freshness |
| WB-DOM-02 | WB | NOT BUILT | Strip: units, share, observations, prompts |
| WB-DOM-03 | WB | NOT BUILT | Overview: share trend per engine |
| WB-DOM-04 | WB | NOT BUILT | Overview: per engine breakdown table |
| WB-DOM-05 | WB | NOT BUILT | Overview: entities co-mentioned when cited |
| WB-DOM-06 | WB | NOT BUILT | Overview: SEO SOV of the domain on project keywords |
| WB-DOM-07 | WB | NOT BUILT | Pages tab: top 10 cited pages |
| WB-DOM-08 | WB | NOT BUILT | Prompts tab: top 10 prompts citing the domain with engine |
| WB-SRC-01 | WB | NOT BUILT | Source (cited URL) inspector: title escaped, host, trend, engines |
| WB-SRC-02 | WB | NOT BUILT | Source inspector Prompts tab |
| WB-SRC-03 | WB | NOT BUILT | Source inspector Answers tab: last 10 answers, open evidence with the  |
