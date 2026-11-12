# WP-48: Alerts web: rule list, builder, bell, digest archive

| Field | Value |
|---|---|
| Wave | W4: Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-48-alerts-web` in `.claude/worktrees/wp-48` (`infra/dev/wp-start WP-48 alerts-web`) |
| Depends on (merged on develop first) | [WP-47 alerts-api](WP-47-alerts-api.md), [WP-08 app-parts-b](WP-08-app-parts-b.md) |
| Owner decisions | none |
| Estimate | 7 Sonnet-agent tasks, about 5 hours with one task in flight |
| Rows | 12 (built already: 0, to do: 12) |

## Goal

Settings > Alert rules (`RuleList`, rule builder from the rule schema, AI rule types grouped), the notification bell and center with unread count, events that open the inspector on History with the event highlighted, the digest archive, anomaly hold and flapping notices, the Alerts card later.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/20 5.17
- web.md 2.22

## Files this package owns

- `apps/web/src/features/alerts/ (new)`
- `apps/web/src/components/app/shell/notification-bell.tsx`
- `apps/web/src/app/[workspace]/[project]/settings/alert-rules/`

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

Consumes C11.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Two Sonnet implementers, one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-48 alerts-web`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-48-alerts-web.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Rule list and builder, nav entry | SC-24, WB-ALR-01..03, WB-SET-13, WB-IA-10 |
| 2 | Bell and center | SC-21, WB-NAV-09, WB-ALR-04, WB-ALR-05 |
| 3 | Digest archive and notices | WB-ALR-06, WB-ALR-07 |
| 4 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Bell items are keyboard reachable and named
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

- One commit per task, message `WP-48: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-48 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-48 <status> | branch ai/wp-48-alerts-web @ <short sha> | rows done <n>/12 | steps <n>/5 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| SC-21 | SC | SPEC | `NotificationBell` and `NotificationCenter` |
| SC-24 | SC | SPEC | `RuleList` and rule builder form from a schema |
| WB-ALR-01 | WB | NOT BUILT | Settings > Alert rules list (`RuleList`) with AI rule types grouped by |
| WB-ALR-02 | WB | NOT BUILT | Rule builder dialog: type, parameters from the rule schema, scope (top |
| WB-ALR-03 | WB | NOT BUILT | AI rule types: mention lost or gained, citation lost or gained, panel  |
| WB-ALR-04 | WB | NOT BUILT | Notification bell list, grouped, unread count |
| WB-ALR-05 | WB | NOT BUILT | Event opens the entity inspector with the event highlighted on History |
| WB-ALR-06 | WB | NOT BUILT | Digest archive view |
| WB-ALR-07 | WB | NOT BUILT | Anomaly hold and flapping mute notices |
| WB-SET-13 | WB | NOT BUILT | Settings > Alert rules |
| WB-IA-10 | WB | NOT BUILT | Settings > Alert rules |
| WB-NAV-09 | WB | NOT BUILT | Notification bell with AI alert events |
