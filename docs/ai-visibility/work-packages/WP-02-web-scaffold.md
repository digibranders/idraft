# WP-02: Web scaffolding: routes, navigation, seams, namespaces, mocks, moves, deps

| Field | Value |
|---|---|
| Wave | W0: Scaffolding, contracts and the lock |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-02-web-scaffold` in `.claude/worktrees/wp-02` (`infra/dev/wp-start WP-02 web-scaffold`) |
| Depends on (merged on develop first) | none |
| Owner decisions | D-16 New screen key inspector.topic (customizable topic drawer) (default: Yes; the prompt inspector later) |
| Estimate | 7 Sonnet-agent tasks, about 5 hours with one task in flight |
| Rows | 4 (built already: 0, to do: 4) |

## Goal

Touch every web conflict hot spot once. Create the route files of every new page (each renders `notFound()` until its package flips it live), the navigation registry entries (status planned), the extension seams in `features/prompts` (inspector tab registry, topic drawer tab registry, row menu and bulk action registry, column registry, toolbar slots), one message namespace per package, one empty mock handler module per package registered in `mocks/handlers/index.ts`, and move the shared code out of `features/prompts` (rate model, strip model, insufficient pill, CSV and XLSX writer, file dropzone). Add the new dependencies (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) so `pnpm-lock.yaml` changes once.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- AI_DEVELOPMENT_UI_RULES.md
- DESIGN_SYSTEM.md
- docs/design-system/11-navigation.md
- docs/ai-visibility/inventory/web.md sections 1 and 5
- MASTER-PLAN section 3.4

## Files this package owns

- apps/web/src/app/[workspace]/[project]/ai/page.tsx and every new route file of MASTER-PLAN 3.4
- `apps/web/src/lib/navigation/registry.ts`
- `apps/web/src/lib/navigation/registry.test.ts`
- `apps/web/src/features/prompts/seams/ (new)`
- `apps/web/src/features/prompts/prompts-screen.tsx (seam wiring only)`
- `apps/web/src/features/prompts/prompt-inspector.tsx (seam wiring only)`
- `apps/web/src/features/prompts/topic-inspector.tsx (seam wiring only)`
- `apps/web/messages/en.json (namespaces)`
- `apps/web/src/mocks/handlers/index.ts`
- apps/web/src/mocks/handlers/<slug>.ts (new, empty)
- `apps/web/src/lib/rates/ (moved rate and strip models)`
- `apps/web/src/lib/export/ (moved writers)`
- `apps/web/src/components/app/metric/insufficient-pill.tsx (moved)`
- `apps/web/src/components/app/forms/file-dropzone.tsx (moved)`
- `apps/web/package.json`
- `pnpm-lock.yaml`

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

None. Produces the seam interfaces every web package fills (MASTER-PLAN 3.4).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus writes the seam interfaces in the task plan; two Sonnet implementers (routes and navigation; seams and moves), one Sonnet reviewer. Haiku writes the namespace skeletons and empty mock modules.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-02 web-scaffold`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-02-web-scaffold.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Route files for `/ai`, `/ai/citations`, `/ai/sources`, `/ai/prompts/[promptId]`, `/competitors`, `/discover/[tab]`, `/reports`, `/settings/alert-rules`, `/settings/retention` rendering `notFound()`; registry entries stay `planned`; registry test updated | WB-NAV-01 |
| 2 | Seams: inspector tab registry, topic drawer tab registry, action registry (row menu, bulk bar, inspector More), column registry, toolbar slots; the built tabs, actions and columns move behind them with no visible change (existing tests stay green) | process |
| 3 | Move `rate-model`, `strip-model`, `InsufficientPill`, the CSV writer and the rankings XLSX writer, and `file-dropzone` to `lib` and `components/app`; update imports | SC-12, SC-17, SC-18 |
| 4 | Message namespaces and empty mock handler modules per package (Haiku), registered once | process |
| 5 | Add the dnd-kit dependencies and the cadence wording fix in the mocks (twice a week, RM risk 1) | process |
| 6 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (through the lock), `pnpm build` (through the lock) green
- The Topics & Prompts page looks and behaves exactly as before at 390, 768, 1024 and 1280 px
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

- One commit per task, message `WP-02: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-02 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-02 <status> | branch ai/wp-02-web-scaffold @ <short sha> | rows done <n>/4 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-NAV-01 | WB | PARTIAL | Sidebar group label "AI Visibility" with four children |
| SC-12 | SC | SPEC | Shared `FileDropzone` and CSV parse with preview |
| SC-17 | SC | SPEC | Shared export writer for XLSX and CSV in `lib` (move from `features/ra |
| SC-18 | SC | SPEC | Strip and rate models usable by several features (move `rate-model.ts` |
