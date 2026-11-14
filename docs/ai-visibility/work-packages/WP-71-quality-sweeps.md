# WP-71: Quality sweeps: e2e, axe at four widths, visual, responsive, copy rules

| Field | Value |
|---|---|
| Wave | X: Cross-wave: quality sweeps, docs, releases and acceptance |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-71-quality-sweeps` in `.claude/worktrees/wp-71` (`infra/dev/wp-start WP-71 quality-sweeps`) |
| Depends on (merged on develop first) | none |
| Owner decisions | none |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 31 (built already: 21, to do: 10) |

## Goal

At the end of every wave (and before every release) one session runs the cross-cutting checks over every AI surface merged in that wave: axe at 390, 768, 1024 and 1280 px in light and dark, visual snapshots in the pinned Playwright image, responsive rows for the new pages and charts, browser zoom 200%, target sizes, reduced motion, colour never the only carrier, copy and data rules; files bugs back to the owning package or fixes small ones itself.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/design-system/20-accessibility.md
- docs/design-system/19-responsive-behavior.md

## Files this package owns

- `apps/web/e2e/flows/ai-a11y.spec.ts (new)`
- `apps/web/e2e/visual/ (AI pages)`

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

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

One Sonnet runner per sweep; Haiku writes the page list and the report table.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-71 quality-sweeps`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-71-quality-sweeps.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Axe, visual and responsive sweep per wave | WB-A11Y-01, WB-A11Y-05, WB-A11Y-13, WB-A11Y-14, WB-RSP-07, WB-RSP-08, WB-RSP-10, WB-E2E-11, WB-E2E-12, WB-STATE-09 |
| 2 | Built cross-cutting rules confirmed | WB-A11Y-02..04, WB-A11Y-06..10, WB-A11Y-12, WB-COPY-01..03, WB-DATA-01, WB-DATA-03..05, WB-E2E-01..05 |
| 3 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Zero axe violations of serious or critical impact on every AI surface
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

- One commit per task, message `WP-71: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-71 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-71 <status> | branch ai/wp-71-quality-sweeps @ <short sha> | rows done <n>/31 | steps <n>/4 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-A11Y-01 | WB | PARTIAL | axe clean at 390, 768, 1024, 1280 in both themes for every AI surface  |
| WB-A11Y-02 | WB | BUILT | Rate cells: accessible name with percent, count and state ("Insufficie |
| WB-A11Y-03 | WB | BUILT | Sparkline accessible name lists each week's rate |
| WB-A11Y-04 | WB | BUILT | Charts have a Table view with the same numbers |
| WB-A11Y-05 | WB | NOT BUILT | Colour is never the only carrier: Delta has a sign and words; own bran |
| WB-A11Y-06 | WB | BUILT | Treegrid level, position, set size, expanded state |
| WB-A11Y-07 | WB | BUILT | Inspector is a `complementary` landmark named by the object |
| WB-A11Y-08 | WB | BUILT | Marks in the answer have accessible names |
| WB-A11Y-09 | WB | BUILT | Announcer for async results (lint, bulk run, archive) instead of live  |
| WB-A11Y-10 | WB | BUILT | Focus stays on the toggled row, the switch, the menu trigger after an  |
| WB-A11Y-12 | WB | BUILT | Untrusted text (answers, titles, domains) escaped; links `rel="noopene |
| WB-A11Y-13 | WB | NOT VERIFIED | Target sizes 24 px minimum (WCAG 2.2) on list rows and chips |
| WB-A11Y-14 | WB | NOT VERIFIED | Reduced motion respected on chart transitions |
| WB-RSP-07 | WB | NOT BUILT | Citations, Competitors, Overview (new pages) |
| WB-RSP-08 | WB | NOT BUILT | Charts |
| WB-RSP-10 | WB | NOT BUILT | Browser zoom 200% on 1280 (640 CSS px) gets the mobile layout with a s |
| WB-E2E-01 | WB | BUILT | Editor turns an engine on, pastes prompts, finds them |
| WB-E2E-02 | WB | BUILT | Viewer reads an answer with marks and sources, sees no forbidden actio |
| WB-E2E-03 | WB | BUILT | Analyst runs a prompt now, told when one is pending, finds the raw lin |
| WB-E2E-04 | WB | BUILT | Editor archives a prompt and brings it back with Undo |
| WB-E2E-05 | WB | BUILT | Inspector tabs (Stats method note) |
| WB-E2E-11 | WB | NOT VERIFIED | Axe at four widths, both themes, on Topics, Prompts, inspector |
| WB-E2E-12 | WB | NOT VERIFIED | Visual snapshots of AI pages (`e2e/visual/pages.spec.ts`) |
| WB-STATE-09 | WB | PARTIAL | Waits for a backend item |
| WB-COPY-01 | WB | BUILT | Every string in `messages/en.json` under the one `prompts` key (or a n |
| WB-COPY-02 | WB | BUILT | No dash as punctuation, no `!`, curly quotes, "cannot" (`i18n/messages |
| WB-COPY-03 | WB | BUILT | Numbers and dates through `@/lib/format` only |
| WB-DATA-01 | WB | BUILT | Every percent with its count; topic cells read answers from `pooled`;  |
| WB-DATA-03 | WB | BUILT | Nothing invented: tabs that wait show an empty state, mock data only i |
| WB-DATA-04 | WB | BUILT | Engines in fixed order, one label per engine |
| WB-DATA-05 | WB | BUILT | Branded excluded unless included (doc 16 rule 4) |
