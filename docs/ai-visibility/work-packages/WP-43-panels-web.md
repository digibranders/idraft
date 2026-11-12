# WP-43: Panels web: Panels tab, add to panel, locked core flows, filters

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-43-panels-web` in `.claude/worktrees/wp-43` (`infra/dev/wp-start WP-43 panels-web`) |
| Depends on (merged on develop first) | [WP-42 panels-api](WP-42-panels-api.md), [WP-29 edit-archive](WP-29-edit-archive.md) |
| Owner decisions | none |
| Estimate | 8 Sonnet-agent tasks, about 6 hours with one task in flight |
| Rows | 39 (built already: 0, to do: 39) |

## Goal

The Panels tab and every panel flow of prompt-dialogs.md section 13: table, kinds, create, rename, delete, lock and unlock with reason, add and remove members with the churn warning, membership history, sizing guidance placeholder until flip rate, promotion candidates, Run now for a panel, panel filter chip, lock icon and panel column, Add dialog panel and reason fields, bulk add to panel, Discovery panel preset, inspector panels line, version and panel events.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- prompt-dialogs.md section 13
- web.md 2.14

## Files this package owns

- `apps/web/src/features/prompts/panels/ (new)`

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

Consumes C9 panels.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; two Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-43 panels-web`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-43-panels-web.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Panels tab, kinds, create, rename, delete, lock | WB-PNL-01..05, PD-PAN-01..04, PD-PAN-09, WB-TPH-16 |
| 2 | Members, churn, history, core reason, limits | WB-PNL-06, WB-PNL-07, PD-PAN-05..08, PD-PAN-10, PD-PAN-13, PD-ERR-23, PD-ARC-08 |
| 3 | Promotion, Run now, panel inspector | WB-PNL-09..11, PD-PAN-12 |
| 4 | Filters, columns, Add dialog fields, bulk and row items, preset, inspector line, events | WB-TPF-09, PD-PAN-11, WB-PRM-04, WB-PRM-22, WB-ADD-14, PD-ADD-17, PD-ADD-18, WB-BLK-10, PD-ROW-06, PD-BULK-08, WB-TPH-05, PD-INS-08, WB-PIH-09, WB-PI-07 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- An editor sees locked core changes disabled with "Only an admin can change the locked core panel."
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

- One commit per task, message `WP-43: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-43 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-43 <status> | branch ai/wp-43-panels-web @ <short sha> | rows done <n>/39 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-PNL-01 | WB | NOT BUILT | Panels table: name, Locked badge, kind, prompts, schedule, engines, ch |
| WB-PNL-02 | WB | NOT BUILT | Panel kinds core, discovery, experiment, custom (G61) |
| WB-PNL-03 | WB | NOT BUILT | Create panel dialog (name, kind, engines, cadence) |
| WB-PNL-04 | WB | NOT BUILT | Rename, delete panel (confirm) |
| WB-PNL-05 | WB | NOT BUILT | Core lock and unlock with reason (`panels:core:modify`) (G62) |
| WB-PNL-06 | WB | NOT BUILT | Add and remove members with reason, 10% churn warning banner (G62) |
| WB-PNL-07 | WB | NOT BUILT | Membership history list (who, why, when; adds and removals filter) (G6 |
| WB-PNL-09 | WB | NOT BUILT | Promotion candidates from Discovery with check columns, Promote dialog |
| WB-PNL-10 | WB | NOT BUILT | Run now for a panel (G66) |
| WB-PNL-11 | WB | NOT BUILT | Panel row opens a panel inspector or `panels/[panelId]` |
| PD-PAN-01 | PD | NOT BUILT | Panels tab |
| PD-PAN-02 | PD | NOT BUILT | Create panel |
| PD-PAN-03 | PD | NOT BUILT | Rename |
| PD-PAN-04 | PD | NOT BUILT | Delete |
| PD-PAN-05 | PD | NOT BUILT | Add to panel |
| PD-PAN-06 | PD | NOT BUILT | Remove from panel |
| PD-PAN-07 | PD | NOT BUILT | Locked core reason dialog |
| PD-PAN-08 | PD | NOT BUILT | Churn warning |
| PD-PAN-09 | PD | NOT BUILT | Lock and unlock |
| PD-PAN-10 | PD | NOT BUILT | Membership history |
| PD-PAN-11 | PD | NOT BUILT | Panel filter chip |
| PD-PAN-12 | PD | NOT BUILT | Run now for a panel |
| PD-PAN-13 | PD | NOT BUILT | Core size limit |
| WB-TPH-16 | WB | NOT BUILT | Panels and Versions tabs in the switch |
| PD-ERR-23 | PD | SPEC | B10 `panel_locked`, `reason_required`, `core_panel_exists`, `core_pane |
| PD-ARC-08 | PD | NOT BUILT | Locked core member |
| WB-TPF-09 | WB | NOT BUILT | Panel filter chip, default "Panel: Core" (G09) |
| WB-PRM-04 | WB | NOT BUILT | Lock icon for a locked core panel member |
| WB-PRM-22 | WB | NOT BUILT | Panel column |
| WB-ADD-14 | WB | NOT BUILT | Panel select and Reason for a locked core (G81) |
| PD-ADD-17 | PD | NOT BUILT | Panel |
| PD-ADD-18 | PD | NOT BUILT | Reason (locked panel) |
| WB-BLK-10 | WB | NOT BUILT | Bulk Add to panel (Discovery, Brand watch; Core locked) |
| PD-ROW-06 | PD | NOT BUILT | Add to panel, Remove from panel |
| PD-BULK-08 | PD | NOT BUILT | Add to panel, Remove from panel |
| WB-TPH-05 | WB | NOT BUILT | Saved view "Discovery panel" preset |
| PD-INS-08 | PD | NOT BUILT | Panels line |
| WB-PIH-09 | WB | NOT BUILT | Events: version and panel membership |
| WB-PI-07 | WB | NOT BUILT | Badges: type, panel, version (G91) |
