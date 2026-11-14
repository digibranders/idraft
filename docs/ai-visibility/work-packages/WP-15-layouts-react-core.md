# WP-15: Layouts React core: registry, use-layout, provider, grid with dnd-kit, card frame

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-15-layouts-react-core` in `.claude/worktrees/wp-15` (`infra/dev/wp-start WP-15 layouts-react-core`) |
| Depends on (merged on develop first) | [WP-02 web-scaffold](WP-02-web-scaffold.md), [WP-03 contract-pack](WP-03-contract-pack.md) |
| Owner decisions | D-14 Snapping resize grip as a pointer alternative to the Width select (default: Yes, snaps to allowed widths only) |
| Estimate | 9 Sonnet-agent tasks, about 7 hours with one task in flight |
| Rows | 26 (built already: 7, to do: 19) |

## Goal

Build the React layer of the layouts platform (one package for every customizable screen): card registry, `use-layout` (TanStack read and three mutations, ETag), `LayoutProvider`, `LayoutGrid` in view mode and customize mode with `@dnd-kit/core` and `@dnd-kit/sortable` (pointer, touch, keyboard sensors, drop line, DragOverlay, auto scroll, reduced motion), `CardFrame` with the customize toolbar (handle, Width, Options, Hide, More), keyboard reorder with announcements, inert content, Add card slot, document upgrade per schema, new screen keys. Works against the mock of C12a until the layouts API is on develop.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- layout spec sections 5, 6, 10
- overview-and-charts.md section 9.6
- apps/web/design-preview/customize.js
- apps/web/src/lib/layouts/

## Files this package owns

- `apps/web/src/features/layouts/ (new)`
- apps/web/src/lib/layouts/ (types, catalog screens, upgrade)
- `apps/web/src/mocks/handlers/layouts.ts`

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

Consumes C12a (layouts) through the generated client; mock first.

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; three Sonnet implementers in parallel on disjoint files (data hooks and provider; grid and dnd-kit; card frame and toolbar); one Sonnet reviewer; Haiku writes the mock and announcements catalog strings.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-15 layouts-react-core`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-15-layouts-react-core.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Screen keys, catalog types, `upgradeDocument` | WB-LAY-02, WB-LAY-03, WB-LAY-04, WB-LAY-07 |
| 2 | Card registry and `use-layout` with ETag | WB-LAY-12, WB-LAY-13 |
| 3 | `LayoutProvider` and `LayoutGrid` view mode | WB-LAY-14, WB-LAY-15, CF-30 |
| 4 | Customize mode drag and drop with dnd-kit | WB-LAY-16, SC-25 |
| 5 | `CardFrame`, Width, Options, Hide, More | WB-LAY-17..21 |
| 6 | Keyboard reorder, inert content, Add card slot | WB-LAY-22..24 |
| 7 | Built pure rules confirmed in use | WB-LAY-01, WB-LAY-05, WB-LAY-06, WB-LAY-08..11 |
| 8 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Keyboard only: pick up, move by row, drop, cancel; every step announced
- Pointer and touch drag at 768 and 1280 px; reduced motion makes cards jump
- Preview parity: the behaviours of `design-preview/customize.js` are all present
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

- One commit per task, message `WP-15: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-15 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-15 <status> | branch ai/wp-15-layouts-react-core @ <short sha> | rows done <n>/26 | steps <n>/9 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-LAY-01 | WB | BUILT | Layout document types (`LayoutDocument`, `NumberItem`, `CardItem`, wid |
| WB-LAY-02 | WB | NOT BUILT | Screen keys `ai_overview`, `prompts`, `citations`, `sources`, `inspect |
| WB-LAY-03 | WB | PARTIAL | Card and number catalog definitions (key, title, description, group, s |
| WB-LAY-04 | WB | PARTIAL | Built-in default per screen (`SCREENS`) |
| WB-LAY-05 | WB | BUILT | `sanitizeLayout` (unknown types, widths, options, limits, duplicate id |
| WB-LAY-06 | WB | BUILT | `resolveLayout` personal, then team, then built-in; damaged document c |
| WB-LAY-07 | WB | NOT BUILT | Document upgrade per schema version (`upgradeDocument`) |
| WB-LAY-08 | WB | BUILT | Retired card types render one release and cannot be added |
| WB-LAY-09 | WB | BUILT | `cardAvailability` against project capabilities and permissions |
| WB-LAY-10 | WB | BUILT | `packRows`, `spanOf`, `trailingSpace` (12 column grid, third, half, tw |
| WB-LAY-11 | WB | BUILT | Draft reducer: add, hide, move, width, option, add number, remove numb |
| WB-LAY-12 | WB | NOT BUILT | Card registry: card type key to a lazy React component and its options |
| WB-LAY-13 | WB | NOT BUILT | `use-layout`: TanStack read and the three mutations, ETag, built-in fa |
| WB-LAY-14 | WB | NOT BUILT | `LayoutProvider` per screen: effective layout, mode (view or customize |
| WB-LAY-15 | WB | NOT BUILT | `LayoutGrid` view mode: cards in order, rows that stay not full, share |
| WB-LAY-16 | WB | NOT BUILT | `LayoutGrid` customize mode: drag and drop with a 2 px primary drop li |
| WB-LAY-17 | WB | NOT BUILT | `CardFrame`: frame and header; customize toolbar as a labelled group ( |
| WB-LAY-18 | WB | NOT BUILT | Card Width select offering only the type's widths; hidden in the drawe |
| WB-LAY-19 | WB | NOT BUILT | Card Options popover (single choice enums; a reusable card cannot take |
| WB-LAY-20 | WB | NOT BUILT | Card Hide with tooltip "Hide card. Add it back from the catalog"; focu |
| WB-LAY-21 | WB | NOT BUILT | Card More menu: Move earlier, Move later, Move to start, Move to end ( |
| WB-LAY-22 | WB | NOT BUILT | Keyboard reorder: handle "Reorder {card}" with described instructions, |
| WB-LAY-23 | WB | NOT BUILT | Card content `inert` in customize mode; links, row clicks, chart hover |
| WB-LAY-24 | WB | NOT BUILT | "Add card" slot after the last card (free third or half a row); empty  |
| SC-25 | SC | SPEC | Layout system React layer: card registry, `use-layout`, `LayoutProvide |
| CF-30 | CF | SPEC | Project capabilities read for card availability (AI channel on, engine |
