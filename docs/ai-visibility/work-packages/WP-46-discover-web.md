# WP-46: Discover > Prompts: candidates inbox and suggestions (W12)

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-46-discover-web` in `.claude/worktrees/wp-46` (`infra/dev/wp-start WP-46 discover-web`) |
| Depends on (merged on develop first) | [WP-45 candidates-api](WP-45-candidates-api.md), [WP-10 controls](WP-10-controls.md) |
| Owner decisions | none |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 31 (built already: 0, to do: 31) |

## Goal

The `/discover/prompts` page and the Suggestions tab of the Add dialog: status segmented control, candidates table with editable text, chips and filters, per row Add and Already tracked, bulk triage, honesty banner, evidence inspector with triage keys (r, s, a), customer FAQ upload, fan-out source chip, optimistic triage, Discover count badge, navigation live.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- prompt-dialogs.md section 8
- docs/20 5.13
- docs/design-system/24 9.11

## Files this package owns

- `apps/web/src/features/discover/ (new)`
- `apps/web/src/app/[workspace]/[project]/discover/`
- `apps/web/e2e/flows/ai-discover.spec.ts`

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

Consumes C10.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; two Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-46 discover-web`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-46-discover-web.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Route, tabs, status control, nav badge | WB-IA-06, WB-DSC-01, WB-DSC-02, WB-NAV-02 |
| 2 | Candidates table, filters, row add, tracked state | WB-DSC-03..05, PD-CAND-01..04, PD-CAND-08, PD-CAND-09 |
| 3 | Edit and add, reject, snooze, bulk, honesty, empty | WB-DSC-06, WB-DSC-07, WB-DSC-13, PD-CAND-05..07, PD-CAND-10..13, PD-STATE-09, PD-ERR-25 |
| 4 | Inspector with triage keys, FAQ upload, fan-out chip, Suggestions tab | WB-DSC-08, WB-DSC-10, WB-DSC-12, WB-KEY-08, PD-CAND-14, PD-CAND-20 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Triage keys respect the single-key shortcut preference
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

- One commit per task, message `WP-46: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-46 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-46 <status> | branch ai/wp-46-discover-web @ <short sha> | rows done <n>/31 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-IA-06 | WB | NOT BUILT | Discover (Prompts, Opportunities tabs) |
| WB-DSC-01 | WB | NOT BUILT | Route `/discover/prompts`, tabs Keywords, Prompts, Opportunities with  |
| WB-DSC-02 | WB | NOT BUILT | Status `SegmentedControl` New, Accepted, Snoozed, Rejected |
| WB-DSC-03 | WB | NOT BUILT | Candidates table: text (editable before accept), source chip, source l |
| WB-DSC-04 | WB | NOT BUILT | Stage and intent `FilterChip`s (AP-03, U-06) |
| WB-DSC-05 | WB | NOT BUILT | Per row Add and "Already tracked" state (AP-09) |
| WB-DSC-06 | WB | NOT BUILT | Bulk bar: Accept, Snooze, Reject, Topic, Intent, Priority, Add to disc |
| WB-DSC-07 | WB | NOT BUILT | Banner "Generated phrasing, not an observed user prompt"; "Bing ground |
| WB-DSC-08 | WB | NOT BUILT | Evidence panel inspector 400 px with triage footer (Reject r, Snooze s |
| WB-DSC-10 | WB | NOT BUILT | Customer FAQ upload with personal data warning and 30 day retention |
| WB-DSC-12 | WB | NOT BUILT | Fan-out query source chip on candidates |
| WB-DSC-13 | WB | NOT BUILT | Optimistic triage with failure return and toast |
| WB-NAV-02 | WB | NOT BUILT | Discover count badge (new candidates) |
| WB-KEY-08 | WB | NOT BUILT | `r`, `s`, `a` triage keys |
| PD-CAND-01 | PD | NOT BUILT | Page and tabs |
| PD-CAND-02 | PD | NOT BUILT | Filter chips |
| PD-CAND-03 | PD | NOT BUILT | Sort |
| PD-CAND-04 | PD | NOT BUILT | Row "Add" |
| PD-CAND-05 | PD | NOT BUILT | Row "Edit and add" |
| PD-CAND-06 | PD | NOT BUILT | Reject |
| PD-CAND-07 | PD | NOT BUILT | Snooze |
| PD-CAND-08 | PD | NOT BUILT | Already tracked state |
| PD-CAND-09 | PD | NOT BUILT | Near duplicate |
| PD-CAND-10 | PD | NOT BUILT | Bulk bar |
| PD-CAND-11 | PD | NOT BUILT | Bulk accept partial |
| PD-CAND-12 | PD | NOT BUILT | Honesty |
| PD-CAND-13 | PD | NOT BUILT | Empty state |
| PD-CAND-14 | PD | NOT BUILT | Candidate inspector |
| PD-CAND-20 | PD | NOT BUILT | "Suggestions" tab in the Add dialog |
| PD-STATE-09 | PD | SPEC | Candidates, filtered empty |
| PD-ERR-25 | PD | SPEC | N10 `decide` rejected codes `tracked`, `quota_exceeded`, `panel_locked |
