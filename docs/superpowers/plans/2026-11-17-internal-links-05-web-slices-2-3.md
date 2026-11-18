# Internal links 05: web slices 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web side of slices 2 and 3 of the internal link tracker, in the real app: the canvas as the mock now has it (real pan and zoom, the focus card that stands out, one journey at a time, growth that keeps the place, selection and move, the By tier layout with lanes), the crawl picker with "Older crawl" and "Back to latest", the Changes tab with alerts and alert settings, the Opportunities tab, the Path finder, the rank, AI citation, anchor and change columns on Pages and in the page inspector, tier suggestions, and the client summary export. Every screen matches the design preview (`apps/web/design-preview/il-*.js`) apart from the owner decisions listed here.

**Architecture:** Pure modules first (canvas view maths, one-journey rule, tier lanes, curves, changes and suggestion formatting), then the data layer (generated client, queries, mutations, MSW world and handlers), then URL state and the tab registry, then screens, each in `apps/web/src/features/internal-links/` next to the screens of plan 03. The canvas work changes `apps/web/src/components/app/link-canvas/` and its design-system section. No new dependency: the mock's own viewport (`il-canvas.js`) is ported, the spec's React Flow and ELK are not used (decision D1).

**Tech Stack:** Next.js (App Router), React 19, TypeScript strict, TanStack Query, `openapi-fetch` client generated from `backend/openapi/v1.json`, `nuqs`, `next-intl`, Tailwind with the design-system tokens, Lucide icons, MSW, Vitest and Testing Library, Playwright and axe.

---

## Where this plan sits

- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md` sections 3, 7.1, 7.5 (changed 2026-11-17) and 7.10.
- Mock: `apps/web/design-preview/il.js` (header, tabs, `clientSummary`), `il-model.js` (definitions), `il-changes.js`, `il-opps.js`, `il-pages.js`, `il-drawer.js`, `il-links.js`, `il-journey.js`, `il-journey-layout.js`, `il-canvas.js`, `il-settings.js`, `il-dialogs.js`. The mock reads the real crawl of eventussecurity.com by default and the illustrative set with `?data=sample` (which has crawl history, rank, citations and mentions); use `?data=sample` for every comparison in this plan.
- Plan 03 (web slice 1) is `docs/superpowers/plans/2026-11-16-internal-links-03-web-slice-1.md`. This plan continues it in the same worktree `.claude/worktrees/internal-links-web` (branch `feat/internal-links-web`) and needs, as built on 2026-11-17: tasks 0 to 7 (tokens, `TierBadge`, pure journey modules, `LinkCard`, `LinkCanvas`, client, shell, Pages tab). Parts of this plan also need plan 03's Task 9 (inspector), 10 (Links tab), 11 (Journey tab), 12 (Tier flow tab) and 14 (settings screens); each task below says which. If one is not merged yet, the task waits for it and the session starts the next one that does not.
- Plan 04 (backend slices 2 and 3) supplies the API of the contract table below. Tasks 1 to 7 and 11 need no API. Task 8 onward needs `backend/openapi/v1.json` from plan 04 Task 15 on `develop`; if it is not there, the session stops after Task 7 and reports. It never invents a schema.
- "Task 4b" (the canvas rework named in the roadmap) is Tasks 1 to 7 here. Plan 03's canvas is the one of the mock of 2026-11-16 (columns on a 64 px spine, elbow edges, four zoom steps, no minimap, nothing animates; `link-canvas.tsx` was last changed on 17 November at 01:09); the spec section 7.5 and the mock changed after that on 2026-11-17. Plan 03 has no task for it, and Task 0 of this plan checks again before starting.
- **Level of detail, read this before assigning a task.** Tasks 1 to 4 (pure modules), 8 (client, types, reads, writes), 10 (address state, crawl choice) and the pure parts of 11 have complete code and tests and can go to a Haiku or Sonnet subagent as written. Tasks 5 to 7 (canvas) and 9 (MSW) have complete code for the new files and exact edit instructions for `link-canvas.tsx` and the existing handlers, which a Sonnet agent reads against the real file. Tasks 12 to 20 (header, Changes, alert settings, Pages additions, inspector, Opportunities, Path finder, Links status and client summary, final checks) are **outlines**: files, the tests to write as bullet assertions, the data and copy, and the order of work, with the key components and pure functions in code. They sit on screens of plan 03 that were not built when this plan was written (inspector, Links tab, Journey tab, settings, bulk bar), so exact code would have been guessed. When the screen a task needs has landed, the Opus planning session turns the task into the full step form (failing test, run, implement, run, commit) before a subagent takes it.
- Worktree and branch exist; merge `develop` into the branch before each task that touches a shared file. The gate at the end of every task, from the repository root and then in `apps/web`:

```bash
pnpm install --frozen-lockfile
cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
```

- Rules every task follows (`AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`, plan 03 decisions W1 to W22): colours and spacing from tokens only, type through the `type-*` utilities, no em dash or en dash in any copy or comment, records in tables, the inspector on the right, address state through the shared `nuqs` parsers, icons from Lucide, every string in `apps/web/messages/en.json`, every button and control reachable by keyboard with a visible focus ring, both themes. Edit files with the file tools, never shell heredocs. Never `git add -A`; every commit names its files. No attribution lines in commit messages. Do not edit `apps/web/design-preview/` (the mock is the reference) and do not edit the backend.
- Shared files this plan changes and other tracks also change: `apps/web/messages/en.json`, `apps/web/src/lib/api/schema.ts` (regenerated), `apps/web/src/mocks/handlers/index.ts`, `apps/web/src/lib/navigation/registry.ts` (not changed here), `apps/web/src/components/design-system/` registry. Merge `develop` before the final gate.

---

## Decisions

- **D1. The canvas is the mock's viewport, ported, not React Flow.** Spec 7.5 names React Flow and `elkjs`. Plan 03 (decision W9) already built the canvas without them: columns of cards in the DOM, SVG edges measured from the cards, the layout computed by a pure module (`journey-layout.ts`). The mock's viewport (`il-canvas.js`: pan, zoom, glide, minimap, controls) is plain code. This plan ports that and keeps the DOM cards, so tokens, badges, focus rings and the keyboard model stay as plan 03 built and reviewed them, and no dependency is added. The owner's spec line is met in behaviour; if the owner wants the libraries named in the spec, that is a later change of the viewport only.
- **D2. The viewport is one transform.** The canvas has a `view = {x, y, scale}`; the world (columns and edges) is a child with `transform: translate(x, y) scale(scale)` and `transform-origin: 0 0`. Wheel, drag and keys change the view; nothing scrolls. Edges are measured from cards in world coordinates by dividing the rectangle by `scale` (plan 03 already divides by `zoom`).
- **D3. One journey at a time is a pure rule.** Card keys are `o:<id>.<id>` and `i:<id>.<id>` (plan 03 `cardKey`): the ids are the path from the focus, so the cards on a card's own path are exactly the keys whose id list is a prefix of its own. `openExclusive` closes every other opened card, group and "+N more" on that side and keeps the path. `openTogether` (the selection bar's "Show their links") opens without closing.
- **D4. By tier is a switch next to the scope switch.** The layout is state of the Journey (`jl=tier` in the address, default step), with the lanes hidden by chips in `jt` (a comma list of tier positions). It changes only where cards stand and how lines are coloured; opening, selecting and moving work as in By step.
- **D5. The crawl picker is `run` in the address.** `run` is a crawl id; absent means the latest. Every read of every tab adds `run` when it is set. An older crawl shows "Older crawl" and "Back to latest". Crawl history comes from `GET link-crawls` (plan 02), which now says per crawl `links_available` and `previous_run_id` (plan 04 Task 9): a crawl whose links were dropped is listed but disabled in the picker for tabs that need links, and its link level tabs show the `410 links_dropped` message.
- **D6. The client summary is built in the browser.** Spec 7.10 and the mock build it from data the page already has. It uses the tier flow (editorial), the tier strip, the worklist counts and the lost links to the important tiers (`changes/links?only=top`), and downloads a standalone HTML file. No endpoint.
- **D7. Delivery of alerts is in the app; email and Slack are shown but not selectable.** The settings channel menu lists the three channels of the mock; "Email" and "Slack" are disabled with the reason "Available when the alerts service ships" (plan 04 D5, open point O2). The banner always says "Alert shown in the app".
- **D8. The Links tab "First seen" and "Lost on" columns are one crawl deep.** Plan 04 open point O7: the tab shows "Added" and "Lost" for the crawl in view from the stored differences, and the Status menu (Active, Lost since last crawl, All) filters between the edges list and `changes/links`. A date of first sight across all crawls is not built.
- **D9. Rank and AI citation columns show today's numbers on an older crawl** (plan 04 D7). The tooltips say "today".
- **D10. UI rules inherited from plan 03 stay:** the UI never shows an equity share; "Equity change" in Changes and the Pages column is a change in points of share of the crawl, which the owner's mock shows, and it is shown only there (decision W4 is about the share itself; the mock's Pages tab shows "Equity change" and the Changes tab shows it). Open point P1 asks the owner to confirm.
- **D11. Tier suggestions open from a chip in the Pages issues row** as in the mock, in a popover table with Accept, Dismiss and Accept all, and call the API; nothing changes until accepted.
- **D12. Opportunities are a `DataTable` with selection**, the bulk bar of plan 03 (decision W11 pattern), and the "Planned fixes" CSV from the API (`export=planned`).

## Dependencies between tasks

| Task | What | Needs |
|---|---|---|
| 0 | Check plan 03 and plan 04 state, baseline | Nothing |
| 1 | Pure canvas view maths | 0 |
| 2 | Pure one-journey rule | 0 |
| 3 | Pure tier lanes | 0 |
| 4 | Pure curves | 0 |
| 5 | Viewport, view controls, minimap in `LinkCanvas` | 1, 4; plan 03 Task 4 |
| 6 | Focus card, card tools, info panel, selection, move, controls panel | 5 |
| 7 | Growth that keeps the place; By tier layout, switch and chips | 2, 3, 6; plan 03 Task 11 |
| 8 | Generated client, types, queries, mutations | Plan 04 Task 15 |
| 9 | MSW world and handlers | 8 |
| 10 | Address state, tab registry, messages | 8 |
| 11 | Pure formatting of changes, suggestions, paths, client summary | 8 |
| 12 | Header: crawl picker, context line, tab badges | 9, 10; plan 03 Task 6 |
| 13 | Changes tab | 9, 10, 11, 12 |
| 14 | Alert settings | 9, 13; plan 03 Task 14 |
| 15 | Pages tab: columns, flags, worklists, tier suggestions | 9, 10, 11; plan 03 Task 7 |
| 16 | Inspector additions | 9, 11; plan 03 Task 9 |
| 17 | Opportunities tab | 9, 10, 11 |
| 18 | Path finder | 7, 9, 10; plan 03 Task 11 |
| 19 | Links tab status and the client summary | 9, 11; plan 03 Task 10, 12 |
| 20 | States, Playwright, axe, parity, final checks | All |

Tasks 1 to 4 can run in parallel at once; 5 to 7 in order; 8 to 11 after the contract; 12 before 13 to 19; 13 to 19 are independent of each other after 12.

## File map

| File | Task | What it holds |
|---|---|---|
| `src/lib/internal-links/canvas-view.ts` (+ test) | 1 | View maths |
| `src/lib/internal-links/journey-open.ts` (+ test) | 2 | One journey at a time |
| `src/lib/internal-links/tier-lanes.ts` (+ test) | 3 | Lanes, one card per page, line direction |
| `src/lib/internal-links/journey-curves.ts` (+ test) | 4 | Curves, fan, tier routes |
| `src/components/app/link-canvas/canvas-viewport.tsx`, `view-controls.tsx`, `minimap.tsx` (+ tests) | 5 | Viewport and controls |
| `src/components/app/link-canvas/link-canvas.tsx`, `link-card.tsx`, `card-tools.tsx`, `info-panel.tsx`, `selection-bar.tsx`, `canvas-help.tsx`, `tier-lanes-view.tsx` | 5 to 7 | Canvas changes |
| `src/components/design-system/link-canvas-section.tsx`, `docs/design-system/25-component-inventory.md` | 5 to 7 | Spec and preview |
| `src/lib/api/schema.ts` | 8 | Regenerated |
| `src/lib/internal-links/types.ts`, `queries.ts`, `mutations.ts` | 8 | Contract types, reads, writes |
| `src/mocks/internal-links-changes-world.ts`, `src/mocks/handlers/internal-links-changes.ts` (+ tests), `src/mocks/handlers/index.ts` | 9 | MSW |
| `src/features/internal-links/url-state.ts`, `tabs.ts`, `src/lib/internal-links/crawl-choice.ts` | 10 | Address, tabs, which crawl |
| `messages/en.json` | 10 to 19 | Strings |
| `src/lib/internal-links/changes-format.ts`, `suggestions-format.ts`, `route-format.ts`, `client-summary.ts` (+ tests) | 11, 19 | Pure formatting |
| `src/features/internal-links/crawl-header.tsx`, `crawl-picker.tsx`, `context-line.tsx`, `internal-links-screen.tsx`, `tab-badge.tsx` | 12 | Header |
| `src/features/internal-links/changes/*` | 13 | Changes tab |
| `src/features/internal-links/settings/alert-settings.tsx` | 14 | Alert rules |
| `src/features/internal-links/pages/*` | 15 | Pages additions |
| `src/features/internal-links/inspector/*` | 16 | Inspector additions |
| `src/features/internal-links/opportunities/*` | 17 | Opportunities |
| `src/features/internal-links/journey/path-finder.tsx` | 18 | Path finder |
| `src/features/internal-links/links/*`, `export/client-summary-action.ts` | 19 | Links status, summary |
| `e2e/internal-links-slices-2-3.spec.ts` | 20 | Playwright |

## Mock to app map (per-screen parity)

| Screen or part | Mock file and function | App file | Task |
|---|---|---|---|
| Page header, two lines, context line | `il.js` `pageRow`, `statItems`, `tabs` | `crawl-header.tsx`, `context-line.tsx`, `tab-badge.tsx` | 12 |
| Crawl picker, Older crawl, Back to latest | `il.js` crawl menu, `il-model.js` `setCrawl` | `crawl-picker.tsx` | 12 |
| Changes tab (strip, banner, tables, moved) | `il-changes.js` `render` | `changes/changes-tab.tsx` | 13 |
| Alert rules | `il-dialogs.js`, `il-settings.js` | `settings/alert-settings.tsx` | 14 |
| Pages new columns, flag, worklists | `il-pages.js` `COLUMNS`, `il-model.js` `WORKLISTS`, `flags` | `pages/page-columns.tsx`, `worklist-chips.tsx` | 15 |
| Suggested tiers | `il-pages.js` suggestions popover | `pages/tier-suggestions.tsx` | 15 |
| Inspector additions | `il-drawer.js` | `inspector/*` | 16 |
| Opportunities tab | `il-opps.js` | `opportunities/opportunities-tab.tsx` | 17 |
| Path finder | `il-journey.js` path view, `il-model.js` `findPaths` | `journey/path-finder.tsx` | 18 |
| Links tab Status menu, Added and Lost | `il-links.js` | `links/*` | 19 |
| Client summary | `il.js` `clientSummary` | `export/client-summary-action.ts` | 19 |
| Canvas viewport, controls, minimap | `il-canvas.js` | `canvas-viewport.tsx`, `view-controls.tsx`, `minimap.tsx` | 5 |
| Focus card, tools, info, selection, move | `il-journey.js` | `link-card.tsx`, `card-tools.tsx`, `info-panel.tsx`, `selection-bar.tsx` | 6 |
| One journey at a time, growth | `il-journey.js` `toggle`, `glide` | `journey-open.ts`, `link-canvas.tsx` | 2, 7 |
| By tier layout | `il-journey.js` `buildTierColumns`, `route` | `tier-lanes.ts`, `tier-lanes-view.tsx` | 3, 7 |

## Message keys

New namespaces and where they go in `messages/en.json`: `internalLinks.picker`, `internalLinks.context`, `internalLinks.changes`, `internalLinks.opportunities`, `internalLinks.alerts`, `internalLinks.suggestions`, `internalLinks.inspectorExtras`, `internalLinks.paths`, `internalLinks.summary`, plus additions to `internalLinks.columns`, `internalLinks.flags`, `internalLinks.worklists`, `internalLinks.tabs` and `linkCanvas`. Each task lists the keys it adds, and adds them in the same commit.

## URL state

| Key | Meaning | Task |
|---|---|---|
| `run` | A crawl id; absent is the latest | 10 |
| `tab` | gains `changes`, `opportunities` | 10 |
| `jv` | gains `paths` (the Path finder) | 10 |
| `jl` | `tier` for the By tier layout; absent is By step | 7, 10 |
| `jt` | Tier lanes turned off, positions with commas (`99` is Untiered) | 7, 10 |
| `cs` | Changes tab: `lost` scope `editorial` or `all` | 13 |
| `os`, `ot`, `oq` | Opportunities: status, target tier, search | 17 |
| `inspect` | gains nothing; the inspector shows the new parts | 16 |

## Open points for the owner

- **P1. Equity change.** The mock shows "Equity change" (points of share) on the Pages tab and in Changes, while the owner decided on 2026-11-16 that the UI never shows an equity share. Recommendation: show the change in points where the mock does, name it "Link strength change" in copy, and never show the share. Confirm or remove the column and the Changes figure.
- **P2. Email and Slack alerts** (D7): disabled until the alerts service exists (plan 04 O2).
- **P3. Client summary** is a download built in the browser (D6). A shareable link needs a page the server renders; not in this release.
- **P4. Libraries.** D1: the canvas has no React Flow or elkjs. Confirm.
- **P5. First seen** (D8, plan 04 O7).
- **P6. Search box and sort on rank columns.** The API sorts Pages by `change` only; rank, citation and anchor columns do not sort (they are read for the rows shown). Recommendation: accept; a sort by rank needs an aggregate the Pages query does not have.

---

### Task 0: Check plan 03 and plan 04, and set up

**Files:** none unless a check below says so.

- [ ] **Step 1: See what plan 03 has built**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-web
git fetch origin && git status --short | head && git log --oneline -5
ls apps/web/src/features/internal-links apps/web/src/features/internal-links/pages apps/web/src/components/app/link-canvas
grep -n "ORDER\|LINKS_TABS" apps/web/src/features/internal-links/tabs.ts
```

Expected: the files of plan 03 Tasks 0 to 7 exist. `tabs.ts` lists the tabs built so far (`pages` at least). Note which of the Links, Journey and Tier flow tabs, the inspector and the settings screens exist; Tasks 12 to 19 below name what each needs.

- [ ] **Step 2: Check the canvas against the spec of 2026-11-17**

```bash
grep -n "minimap\|Minimap\|ZOOMS\|COLUMN_GAP\|Back to the focus\|backToFocus" apps/web/src/components/app/link-canvas/*.tsx | head
```

Expected: `ZOOMS` and `COLUMN_GAP` are found and no minimap or back-to-focus. If the rework is already there, mark Tasks 5 to 7 as done and go to Task 8.

- [ ] **Step 3: Check the contract**

```bash
grep -c "changes/summary\|internal-links/opportunities\|tier-suggestions\|internal-links/paths" apps/web/src/lib/api/schema.ts
git -C /Users/a12345/Desktop/AI/idraft/platform log --oneline -3 -- backend/openapi/v1.json
```

Expected: after plan 04 Task 15 the count is 4 or more once `pnpm gen:api` ran. If `backend/openapi/v1.json` on `develop` has no `changes/summary`, tasks 8 onward wait.

- [ ] **Step 4: Baseline**

```bash
pnpm install --frozen-lockfile
cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
```

Expected: all pass. Nothing is committed in this task.

---

### Task 1: Pure canvas view maths

**Files:**
- Create: `apps/web/src/lib/internal-links/canvas-view.ts`, `canvas-view.test.ts`

**Read first:** `apps/web/design-preview/il-canvas.js` (the whole file: `MIN_SCALE`, `zoomAt`, `fit`, `firstView`, `reveal`), spec section 7.5 "Viewport", `apps/web/src/lib/internal-links/journey-geometry.ts` (the `Box` type).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/internal-links/canvas-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  BUTTON_STEP,
  MAX_SCALE,
  MIN_SCALE,
  centerOn,
  fitView,
  firstView,
  panBy,
  revealMinimum,
  stepZoom,
  toScreen,
  toWorld,
  zoomAt,
  type View,
} from './canvas-view';

const VIEWPORT = { width: 1000, height: 600 };

describe('canvas view', () => {
  it('maps a world point to the screen and back', () => {
    const view: View = { x: 40, y: -20, scale: 0.5 };
    const screen = toScreen(view, { x: 100, y: 200 });
    expect(screen).toEqual({ x: 90, y: 80 });
    expect(toWorld(view, screen)).toEqual({ x: 100, y: 200 });
  });

  it('zooms toward a point and keeps the world point under it still', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const next = zoomAt(view, 2, { x: 300, y: 200 });
    expect(next.scale).toBe(2);
    expect(toWorld(next, { x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
  });

  it('clamps the zoom between 25 and 200 percent', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    expect(zoomAt(view, 100, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, 0.001, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
  });

  it('pans by a distance on the screen', () => {
    expect(panBy({ x: 10, y: 10, scale: 1 }, -5, 20)).toEqual({ x: 5, y: 30, scale: 1 });
  });

  it('steps the zoom by a quarter around the middle of the viewport', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const larger = stepZoom(view, 1, VIEWPORT);
    expect(larger.scale).toBe(1 + BUTTON_STEP);
    expect(toWorld(larger, { x: 500, y: 300 })).toEqual({ x: 500, y: 300 });
    expect(stepZoom({ x: 0, y: 0, scale: MIN_SCALE }, -1, VIEWPORT).scale).toBe(MIN_SCALE);
  });

  it('fits everything inside the viewport with a margin and never zooms past 100 percent', () => {
    const small = fitView({ left: 0, top: 0, width: 200, height: 100 }, VIEWPORT);
    expect(small.scale).toBe(1);
    const wide = fitView({ left: 0, top: 0, width: 4000, height: 300 }, VIEWPORT);
    expect(wide.scale).toBeLessThan(0.25 + 0.001);
    expect(wide.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    const centred = fitView({ left: 100, top: 100, width: 400, height: 200 }, VIEWPORT);
    const middle = toScreen(centred, { x: 300, y: 200 });
    expect(middle.x).toBeCloseTo(500, 5);
    expect(middle.y).toBeCloseTo(300, 5);
  });

  it('shows the whole journey when it is readable at 70 percent or more', () => {
    const content = { left: 0, top: 0, width: 1200, height: 500 };
    const focus = { left: 500, top: 200, width: 288, height: 56 };
    const view = firstView(content, focus, VIEWPORT);
    expect(view.scale).toBeGreaterThanOrEqual(0.7);
    expect(view.scale).toBeLessThan(1);
  });

  it('shows the focus page at 85 percent when the whole journey would be a blur', () => {
    const content = { left: 0, top: 0, width: 6000, height: 2000 };
    const focus = { left: 2800, top: 900, width: 288, height: 56 };
    const view = firstView(content, focus, VIEWPORT);
    expect(view.scale).toBe(0.85);
    const middle = toScreen(view, { x: 2944, y: 928 });
    expect(middle.x).toBeCloseTo(500, 5);
    expect(middle.y).toBeCloseTo(300, 5);
  });

  it('centres a box without changing the zoom unless one is given', () => {
    const view = centerOn({ x: 0, y: 0, scale: 0.5 }, { left: 400, top: 300, width: 100, height: 50 }, VIEWPORT);
    expect(view.scale).toBe(0.5);
    expect(toScreen(view, { x: 450, y: 325 })).toEqual({ x: 500, y: 300 });
    expect(centerOn(view, { left: 0, top: 0, width: 10, height: 10 }, VIEWPORT, 1).scale).toBe(1);
  });

  it('pans the least it takes to show a box with a margin, and not at all when it shows', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const inside = { left: 100, top: 100, width: 100, height: 50 };
    expect(revealMinimum(view, inside, VIEWPORT)).toBe(view);
    const outside = { left: 1100, top: 100, width: 100, height: 50 };
    const moved = revealMinimum(view, outside, VIEWPORT, 24);
    expect(moved.y).toBe(0);
    expect(moved.x).toBe(VIEWPORT.width - 24 - (1100 + 100));
    expect(toScreen(moved, { x: 1200, y: 100 }).x).toBe(VIEWPORT.width - 24);
  });
});
```

- [ ] **Step 2: Run and see it fail**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/canvas-view.test.ts
```

Expected: FAIL (cannot find module `./canvas-view`).

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/internal-links/canvas-view.ts`:

```ts
import type { Box } from './journey-geometry';

/**
 * The canvas viewport (spec 7.5, mock `il-canvas.js`): a point of the world is at `world * scale + (x, y)` on the
 * screen. Pure; the component keeps the view in state and calls these.
 */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;
/** The zoom buttons and the plus and minus keys move by a quarter. */
export const BUTTON_STEP = 0.25;
/** A whole journey is shown at the first view only when it stays this readable (spec 7.5 "First view"). */
export const READABLE_SCALE = 0.7;
/** Otherwise the focus page, at this zoom. */
export const FOCUS_SCALE = 0.85;
const FIT_MARGIN = 32;

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const toScreen = (view: View, point: Point): Point => ({
  x: point.x * view.scale + view.x,
  y: point.y * view.scale + view.y,
});

export const toWorld = (view: View, point: Point): Point => ({
  x: (point.x - view.x) / view.scale,
  y: (point.y - view.y) / view.scale,
});

/** Zoom to `scale` (clamped) keeping the world point under `anchor` (a screen point) where it is. */
export function zoomAt(view: View, scale: number, anchor: Point): View {
  const next = clampScale(scale);
  const world = toWorld(view, anchor);
  return { x: anchor.x - world.x * next, y: anchor.y - world.y * next, scale: next };
}

export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x + dx, y: view.y + dy });

const middleOf = (viewport: Size): Point => ({ x: viewport.width / 2, y: viewport.height / 2 });

/** One button step in or out, around the middle of the viewport. The size is a whole quarter of 100 percent. */
export function stepZoom(view: View, direction: 1 | -1, viewport: Size): View {
  const quarters = Math.round(view.scale / BUTTON_STEP) + direction;
  return zoomAt(view, quarters * BUTTON_STEP, middleOf(viewport));
}

/** Everything in view with a margin, centred, never past 100 percent. */
export function fitView(content: Box, viewport: Size, margin: number = FIT_MARGIN): View {
  const scale = clampScale(
    Math.min(
      1,
      (viewport.width - margin * 2) / Math.max(content.width, 1),
      (viewport.height - margin * 2) / Math.max(content.height, 1),
    ),
  );
  return {
    scale,
    x: viewport.width / 2 - (content.left + content.width / 2) * scale,
    y: viewport.height / 2 - (content.top + content.height / 2) * scale,
  };
}

/** The box in the middle of the viewport, at `scale` or the current zoom. */
export function centerOn(view: View, box: Box, viewport: Size, scale: number = view.scale): View {
  const next = clampScale(scale);
  return {
    scale: next,
    x: viewport.width / 2 - (box.left + box.width / 2) * next,
    y: viewport.height / 2 - (box.top + box.height / 2) * next,
  };
}

/**
 * The view when a journey first opens: the whole journey when it is readable at 70 percent or more, otherwise the focus
 * page at 85 percent, so the first thing seen is never a blur.
 */
export function firstView(content: Box, focus: Box, viewport: Size): View {
  const whole = fitView(content, viewport);
  if (whole.scale >= READABLE_SCALE) return whole;
  return centerOn(whole, focus, viewport, FOCUS_SCALE);
}

/** Pans the least it takes to show `box` (world coordinates) inside the viewport with `margin`; the same object when it shows. */
export function revealMinimum(view: View, box: Box, viewport: Size, margin: number = 24): View {
  const left = box.left * view.scale + view.x;
  const right = (box.left + box.width) * view.scale + view.x;
  const top = box.top * view.scale + view.y;
  const bottom = (box.top + box.height) * view.scale + view.y;
  let dx = 0;
  let dy = 0;
  if (right > viewport.width - margin) dx = viewport.width - margin - right;
  if (left + dx < margin) dx = margin - left;
  if (bottom > viewport.height - margin) dy = viewport.height - margin - bottom;
  if (top + dy < margin) dy = margin - top;
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}
```

- [ ] **Step 4: Run, gate, commit**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/canvas-view.test.ts && pnpm lint && pnpm typecheck && pnpm format:check
git add apps/web/src/lib/internal-links/canvas-view.ts apps/web/src/lib/internal-links/canvas-view.test.ts
git commit -m "Internal links: canvas view maths for pan, zoom, fit and first view"
```

Expected: PASS. In `revealMinimum` a box wider than the viewport shows its left edge (the left rule wins); the tests do not cover it because no journey card is wider than a viewport.

---

### Task 2: Pure one-journey-at-a-time rule

**Files:**
- Create: `apps/web/src/lib/internal-links/journey-open.ts`, `journey-open.test.ts`

**Read first:** `apps/web/src/lib/internal-links/journey-layout.ts` (`cardKey`, `groupKey`, `moreKey`, `FOCUS_KEY`, `JourneyState`, `pruneJourney`), `journey-codec.ts`, spec 7.5 "Growing", mock `il-journey.js` (search `toggle` and `opened`).

- [ ] **Step 1: Write the failing test**

Create `journey-open.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { openExclusive, openTogether, parseCardKey, type OpenSets } from './journey-open';
import { cardKey, groupKey, moreKey } from './journey-layout';

const sets = (open: string[], groups: string[] = [], more: [string, number][] = []): OpenSets => ({
  open: new Set(open),
  groups: new Set(groups),
  more: new Map(more),
});

describe('parseCardKey', () => {
  it('reads the side and the path of ids', () => {
    expect(parseCardKey(cardKey('out', ['12', '34']))).toEqual({ side: 'o', ids: ['12', '34'] });
    expect(parseCardKey(cardKey('in', ['7']))).toEqual({ side: 'i', ids: ['7'] });
    expect(parseCardKey('f')).toBeNull();
    expect(parseCardKey('g:o:f:template')).toBeNull();
  });
});

describe('openExclusive', () => {
  const a = cardKey('out', ['1']);
  const ab = cardKey('out', ['1', '2']);
  const c = cardKey('out', ['3']);
  const left = cardKey('in', ['9']);

  it('opens a card and keeps the cards on its own path open', () => {
    const next = openExclusive(sets([a]), ab);
    expect([...next.open].sort()).toEqual([a, ab].sort());
  });

  it('closes every other opened card on its side', () => {
    const next = openExclusive(sets([a, ab]), c);
    expect([...next.open]).toEqual([c]);
  });

  it('leaves the other side alone', () => {
    const next = openExclusive(sets([a, left]), c);
    expect([...next.open].sort()).toEqual([c, left].sort());
  });

  it('drops groups and more counts of cards that closed, and keeps those on the path', () => {
    const onPath = groupKey('out', a, 'template');
    const elsewhere = groupKey('out', c, 'auto_generated');
    const next = openExclusive(
      sets([a, c], [onPath, elsewhere], [[moreKey(a), 8], [moreKey(c), 16]]),
      ab,
    );
    expect([...next.groups]).toEqual([onPath]);
    expect([...next.more]).toEqual([[moreKey(a), 8]]);
    expect([...next.open].sort()).toEqual([a, ab].sort());
  });

  it('closes a card that is open (a second press)', () => {
    const next = openExclusive(sets([a, ab]), ab);
    expect([...next.open]).toEqual([a]);
  });
});

describe('openTogether', () => {
  it('opens several cards without closing others', () => {
    const a = cardKey('out', ['1']);
    const b = cardKey('out', ['2']);
    const c = cardKey('out', ['3']);
    const next = openTogether(sets([a]), [b, c]);
    expect([...next.open].sort()).toEqual([a, b, c].sort());
  });
});
```

- [ ] **Step 2: Run and see it fail**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/journey-open.test.ts
```

- [ ] **Step 3: Implement**

```ts
import { FOCUS_KEY } from './journey-layout';

/**
 * One journey at a time (spec 7.5 "Growing", decision D3): opening a card closes every other opened card on its side,
 * except the cards on its own path from the focus page. Card keys are `<side>:<id>.<id>...` with the ids the path from
 * the focus (`cardKey` in `journey-layout.ts`), so the cards on a card's own path are the keys whose id list is a prefix
 * of its own. Pure.
 */
export interface OpenSets {
  open: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  more: ReadonlyMap<string, number>;
}

export interface ParsedCardKey {
  side: 'o' | 'i';
  ids: string[];
}

const CARD = /^([oi]):(\d+(?:\.\d+)*)$/;
const GROUP = /^g:([oi]):(.+):(editorial|auto_generated|template|both)$/;
const MORE = /^m:(.+)$/;

export function parseCardKey(key: string): ParsedCardKey | null {
  const match = CARD.exec(key);
  if (match === null) return null;
  return { side: match[1] === 'i' ? 'i' : 'o', ids: (match[2] ?? '').split('.') };
}

const sideOf = (key: string): 'o' | 'i' | null => {
  const card = parseCardKey(key);
  if (card !== null) return card.side;
  const group = GROUP.exec(key);
  return group === null ? null : group[1] === 'i' ? 'i' : 'o';
};

const isPrefix = (shorter: readonly string[], longer: readonly string[]): boolean =>
  shorter.length <= longer.length && shorter.every((id, index) => longer[index] === id);

/** Whether `key` is the card `target` or one on the path from the focus to it. */
const onPathOf = (key: string, target: ParsedCardKey): boolean => {
  const card = parseCardKey(key);
  return card !== null && card.side === target.side && isPrefix(card.ids, target.ids);
};

/** The card a group or "+N more" key hangs under: a card key or the focus. */
const ownerOf = (key: string): string | null => {
  const group = GROUP.exec(key);
  if (group !== null) return group[2] ?? null;
  const more = MORE.exec(key);
  return more === null ? null : (more[1] ?? null);
};

/**
 * The sets after pressing the card `key`: it opens (or closes when open), and on its side every opened card, group and
 * "+N more" that is not on its path closes. A key that is not a card key (a group card) keeps its parent's path.
 */
export function openExclusive(current: OpenSets, key: string): OpenSets {
  const target = parseCardKey(key);
  const wasOpen = current.open.has(key) || current.groups.has(key);
  const side = sideOf(key);
  // A group key keeps the path of the card it hangs under
  const group = GROUP.exec(key);
  const owner = group === null ? null : parseCardKey(group[2] ?? '');
  const path = target ?? owner;
  const keepCard = (candidate: string): boolean => {
    if (sideOf(candidate) !== side) return true;
    if (candidate === key) return !wasOpen;
    return path !== null && onPathOf(candidate, path);
  };
  const open = new Set([...current.open].filter(keepCard));
  const groups = new Set(
    [...current.groups].filter((candidate) => {
      if (sideOf(candidate) !== side) return true;
      if (candidate === key) return !wasOpen;
      const parent = ownerOf(candidate);
      return parent !== null && (parent === FOCUS_KEY || (path !== null && onPathOf(parent, path)));
    }),
  );
  if (!wasOpen) (target === null ? groups : open).add(key);
  const alive = (candidate: string): boolean => {
    const parent = ownerOf(candidate);
    return parent === null || parent === FOCUS_KEY || open.has(parent) || groups.has(parent);
  };
  const more = new Map([...current.more].filter(([moreOwner]) => alive(`m:${moreOwner.replace(/^m:/, '')}`)));
  return { open, groups, more };
}

/** The selection bar's "Show their links": several cards open together, nothing closes. */
export function openTogether(current: OpenSets, keys: readonly string[]): OpenSets {
  return { open: new Set([...current.open, ...keys]), groups: current.groups, more: current.more };
}
```

- [ ] **Step 4: Run and fix**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/journey-open.test.ts
```

Expected: PASS. Two points to check against the real keys: `moreKey(owner)` is `m:${owner}` and the keys in `more` are the *full* `m:` keys (`journey-layout.ts` line 130 and `pruneJourney`); if `more` there holds the owner without the prefix, change `alive(...)` call in the `more` filter to pass the map key unchanged. The test fixes which of the two is right: it uses `moreKey(a)` as the map key, as `buildJourney` reads it.

- [ ] **Step 5: Gate and commit**

```bash
cd apps/web && pnpm lint && pnpm typecheck && pnpm format:check
git add apps/web/src/lib/internal-links/journey-open.ts apps/web/src/lib/internal-links/journey-open.test.ts
git commit -m "Internal links: the one-journey-at-a-time rule for the canvas"
```

---

### Task 3: Pure tier lanes

**Files:**
- Create: `apps/web/src/lib/internal-links/tier-lanes.ts`, `tier-lanes.test.ts`

**Read first:** mock `il-journey.js` `buildTierColumns` (lines 786 to 880), `lanePos`, `route`, and the line colour code in `drawEdges` (search `byTier`); spec 7.5 "Two layouts".

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { UNTIERED_LANE, direction, laneOf, laneSet, placeOnce } from './tier-lanes';

describe('laneOf', () => {
  it('is the tier position, and 99 for Untiered', () => {
    expect(laneOf(1)).toBe(1);
    expect(laneOf(null)).toBe(UNTIERED_LANE);
  });
});

describe('direction', () => {
  it('goes up toward T1, down to a lower tier, or sideways', () => {
    expect(direction(3, 1)).toBe('up');
    expect(direction(UNTIERED_LANE, 4)).toBe('up');
    expect(direction(1, 2)).toBe('down');
    expect(direction(2, UNTIERED_LANE)).toBe('down');
    expect(direction(2, 2)).toBe('side');
  });
});

describe('laneSet', () => {
  const tiers = [1, 2, 3, 4];

  it('lists lanes from the lowest tier on the left to T1 on the right, Untiered first', () => {
    const lanes = laneSet({ tiers, inView: new Set([1, 3, UNTIERED_LANE]), focusLane: 3, hidden: new Set() });
    expect(lanes.map((lane) => lane.pos)).toEqual([UNTIERED_LANE, 4, 3, 2, 1]);
  });

  it('shows the Untiered lane only when an untiered page is in view', () => {
    const lanes = laneSet({ tiers, inView: new Set([1, 3]), focusLane: 3, hidden: new Set() });
    expect(lanes.map((lane) => lane.pos)).toEqual([4, 3, 2, 1]);
  });

  it('turns a lane off with a chip but never the focus page lane', () => {
    const lanes = laneSet({ tiers, inView: new Set([1, 3]), focusLane: 3, hidden: new Set([3, 4]) });
    expect(lanes.map((lane) => lane.pos)).toEqual([3, 2, 1]);
  });

  it('marks the focus lane and counts the pages in each lane, empty lanes included', () => {
    const lanes = laneSet({ tiers, inView: new Set([1]), focusLane: 1, hidden: new Set(), counts: new Map([[1, 4]]) });
    const t1 = lanes.find((lane) => lane.pos === 1);
    const t2 = lanes.find((lane) => lane.pos === 2);
    expect(t1).toMatchObject({ isFocus: true, count: 4, empty: false });
    expect(t2).toMatchObject({ isFocus: false, count: 0, empty: true });
  });
});

describe('placeOnce', () => {
  it('puts a page on the canvas once however many links reach it, and aliases the others', () => {
    const placed = placeOnce([
      { key: 'o:1', urlId: '1' },
      { key: 'i:2', urlId: '2' },
      { key: 'o:1.2', urlId: '2' },
      { key: 'o:1.3', urlId: '3' },
    ]);
    expect(placed.cards.map((card) => card.key)).toEqual(['o:1', 'i:2', 'o:1.3']);
    expect(placed.alias.get('o:1.2')).toBe('i:2');
    expect(placed.alias.has('o:1')).toBe(false);
  });

  it('keeps the focus page as the first placement', () => {
    const placed = placeOnce([{ key: 'o:5', urlId: '9' }], { key: 'f', urlId: '9' });
    expect(placed.cards).toEqual([]);
    expect(placed.alias.get('o:5')).toBe('f');
  });
});
```

- [ ] **Step 2: Run and see it fail**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/tier-lanes.test.ts
```

- [ ] **Step 3: Implement**

```ts
/**
 * The By tier layout (spec 7.5 "Two layouts", mock `il-journey.js` `buildTierColumns`): one lane per tier, the lowest on
 * the left and T1 on the right, so a line that runs left to right goes up toward the money pages. A page is one card
 * however many links reach it. Pure.
 */
import { UNTIERED_POSITION, tierPosition, type TierCodeLike } from './tiers';

/** Untiered is the last position (99, `tiers.ts`), so it is the lowest lane. */
export const UNTIERED_LANE = UNTIERED_POSITION;

/** The lane of a tier position (1 is T1); Untiered is 99. */
export const laneOf = (position: number | null): number => position ?? UNTIERED_LANE;

/** The lane of a page's tier (`null` is Untiered). */
export const laneOfTier = (tier: TierCodeLike | null): number => tierPosition(tier);

export type LineDirection = 'up' | 'down' | 'side';

/** A link from lane `from` to lane `to`: up a tier, down a tier or inside one. */
export function direction(from: number, to: number): LineDirection {
  if (to < from) return 'up';
  if (to > from) return 'down';
  return 'side';
}

export interface Lane {
  pos: number;
  isFocus: boolean;
  count: number;
  empty: boolean;
}

export interface LaneInput {
  /** The positions of the workspace's tiers (1 to 8). */
  tiers: readonly number[];
  /** The lanes of the pages on the canvas now. */
  inView: ReadonlySet<number>;
  focusLane: number;
  /** Lanes the user turned off with a chip. */
  hidden: ReadonlySet<number>;
  counts?: ReadonlyMap<number, number>;
}

/**
 * The lanes shown, left to right: Untiered (only when an untiered page is in view), then the lowest tier up to T1. A
 * chip turns a lane off, except the focus page's own lane.
 */
export function laneSet({ tiers, inView, focusLane, hidden, counts = new Map() }: LaneInput): Lane[] {
  const order = [UNTIERED_LANE, ...[...tiers].sort((a, b) => b - a)];
  return order
    .filter((pos) => {
      if (pos === focusLane) return true;
      if (hidden.has(pos)) return false;
      return pos === UNTIERED_LANE ? inView.has(UNTIERED_LANE) : true;
    })
    .map((pos) => {
      const count = counts.get(pos) ?? 0;
      return { pos, isFocus: pos === focusLane, count, empty: count === 0 };
    });
}

export interface PlacedCard {
  key: string;
  urlId: string;
}

/**
 * The cards of the canvas in reading order, each page once. The focus page is placed first; a later card of the same page
 * is an alias of the first, so its lines go to the card that is there.
 */
export function placeOnce(
  order: readonly PlacedCard[],
  focus?: PlacedCard,
): { cards: PlacedCard[]; alias: Map<string, string> } {
  const first = new Map<string, string>();
  if (focus !== undefined) first.set(focus.urlId, focus.key);
  const cards: PlacedCard[] = [];
  const alias = new Map<string, string>();
  for (const card of order) {
    const existing = first.get(card.urlId);
    if (existing === undefined) {
      first.set(card.urlId, card.key);
      cards.push(card);
    } else {
      alias.set(card.key, existing);
    }
  }
  return { cards, alias };
}
```

- [ ] **Step 4: Run, gate, commit**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/tier-lanes.test.ts && pnpm lint && pnpm typecheck && pnpm format:check
git add apps/web/src/lib/internal-links/tier-lanes.ts apps/web/src/lib/internal-links/tier-lanes.test.ts
git commit -m "Internal links: tier lanes, one card per page and line direction"
```

---

### Task 4: Pure curves

**Files:**
- Create: `apps/web/src/lib/internal-links/journey-curves.ts`, `journey-curves.test.ts`
- Modify: `apps/web/src/lib/internal-links/journey-geometry.ts` (`EdgeLook` gains the By tier directions)

**Read first:** `journey-geometry.ts` whole (`Box`, `edgeLook`, `returnArrowPath`), mock `il-journey.js` `route` and `edgeLook`, spec 7.5 "Layout" (curves, dot at the source, arrowhead at the target, "a shared vertical trunk drew them on top of each other").

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { COLUMN_GAP, curvePath, fanOffset, tierRoute } from './journey-curves';
import { directionLook } from './journey-curves';

const from = { left: 0, top: 100, width: 240, height: 42 };
const to = { left: 352, top: 300, width: 240, height: 42 };

describe('curvePath', () => {
  it('leaves the right edge of the source and arrives at the left edge of the target', () => {
    const { d, start, end } = curvePath(from, to, 0);
    expect(start).toEqual({ x: 240, y: 121 });
    expect(end).toEqual({ x: 352, y: 321 });
    expect(d.startsWith('M240,121 C')).toBe(true);
    expect(d.endsWith('352,321')).toBe(true);
  });

  it('gives lines of one card different shapes, so none runs on top of another', () => {
    const shapes = new Set([0, 1, 2, 3].map((index) => curvePath(from, to, index).d));
    expect(shapes.size).toBe(4);
  });

  it('keeps the gap between columns at 112 pixels', () => {
    expect(COLUMN_GAP).toBe(112);
  });
});

describe('fanOffset', () => {
  it('spreads index 0 to count minus 1 around zero', () => {
    expect(fanOffset(0, 1)).toBe(0);
    expect(fanOffset(0, 3)).toBeLessThan(0);
    expect(fanOffset(2, 3)).toBeGreaterThan(0);
    expect(fanOffset(1, 3)).toBe(0);
  });
});

describe('tierRoute', () => {
  it('goes from the right edge to the left edge when the target lane is to the right', () => {
    const route = tierRoute(from, to, 0);
    expect(route.start).toEqual({ x: 240, y: 121 });
    expect(route.end).toEqual({ x: 352, y: 321 });
  });

  it('enters a card in a lane to the left from its right edge', () => {
    const left = { left: -352, top: 300, width: 240, height: 42 };
    const route = tierRoute(from, left, 0);
    expect(route.start).toEqual({ x: 0, y: 121 });
    expect(route.end).toEqual({ x: -112, y: 321 });
  });

  it('swings round the right side for a card in the same lane, by a different amount each time', () => {
    const below = { left: 0, top: 300, width: 240, height: 42 };
    const a = tierRoute(from, below, 0);
    const b = tierRoute(from, below, 2);
    expect(a.start).toEqual({ x: 240, y: 121 });
    expect(a.end).toEqual({ x: 240, y: 321 });
    expect(a.d).not.toBe(b.d);
  });
});

describe('directionLook', () => {
  it('is green up, blue down and grey dashed sideways, and a redirect or a broken target still wins', () => {
    expect(directionLook('up', 200)).toEqual({ tone: 'up', dash: null });
    expect(directionLook('down', 200)).toEqual({ tone: 'down', dash: null });
    expect(directionLook('side', 200)).toEqual({ tone: 'side', dash: '6 4' });
    expect(directionLook('up', 301).tone).toBe('redirect');
    expect(directionLook('down', 404).tone).toBe('broken');
  });
});
```

- [ ] **Step 2: Run and see it fail**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/journey-curves.test.ts
```

- [ ] **Step 3: Implement**

```ts
import type { Box } from './journey-geometry';
import type { LineDirection } from './tier-lanes';

/** The space between two columns (spec 7.5: 112 px, to give the curves room). */
export const COLUMN_GAP = 112;

export interface Point {
  x: number;
  y: number;
}

export interface Drawn {
  d: string;
  /** Where the dot sits (the source end). */
  start: Point;
  /** Where the arrowhead sits (the target end). */
  end: Point;
}

const midY = (box: Box): number => box.top + box.height / 2;

/** A spread around zero for line `index` of `count` leaving one card, so curves do not share a trunk. */
export const fanOffset = (index: number, count: number): number => (index - (count - 1) / 2) * 14;

/**
 * A smooth curve from the middle of the source's right edge to the middle of the target's left edge (By step). Its
 * control points lean by `fan` pixels, so the curves of a card with many links separate (spec 7.5 "Layout").
 */
export function curvePath(from: Box, to: Box, index: number, count = 1): Drawn {
  const start = { x: from.left + from.width, y: midY(from) };
  const end = { x: to.left, y: midY(to) };
  const reach = Math.max(48, Math.abs(end.x - start.x) * 0.5);
  const lean = fanOffset(index, Math.max(count, index + 1));
  const d = `M${start.x},${start.y} C${start.x + reach},${start.y + lean} ${end.x - reach},${end.y + lean} ${end.x},${end.y}`;
  return { d, start, end };
}

/**
 * A line between two cards in the By tier layout (mock `route`): from the right edge of the source to the left edge of the
 * target when the target is to the right; into the right edge of a target in a lane to the left (a link down a tier); and
 * round the right side for a card in the same lane, each swinging out by a different amount so no line runs over the
 * cards it passes.
 */
export function tierRoute(from: Box, to: Box, index: number): Drawn {
  const fromRight = from.left + from.width;
  const toRight = to.left + to.width;
  if (to.left >= fromRight - 1) {
    const start = { x: fromRight, y: midY(from) };
    const end = { x: to.left, y: midY(to) };
    const reach = Math.max(48, (end.x - start.x) * 0.5);
    return {
      d: `M${start.x},${start.y} C${start.x + reach},${start.y} ${end.x - reach},${end.y} ${end.x},${end.y}`,
      start,
      end,
    };
  }
  if (toRight <= from.left + 1) {
    const start = { x: from.left, y: midY(from) };
    const end = { x: toRight, y: midY(to) };
    const reach = Math.max(48, Math.abs(start.x - end.x) * 0.5);
    return {
      d: `M${start.x},${start.y} C${start.x - reach},${start.y} ${end.x + reach},${end.y} ${end.x},${end.y}`,
      start,
      end,
    };
  }
  const start = { x: fromRight, y: midY(from) };
  const end = { x: toRight, y: midY(to) };
  const bulge = Math.min(96, 28 + Math.abs(end.y - start.y) * 0.12 + index * 10);
  return {
    d: `M${start.x},${start.y} C${start.x + bulge},${start.y} ${end.x + bulge},${end.y} ${end.x},${end.y}`,
    start,
    end,
  };
}

export type DirectionTone = 'up' | 'down' | 'side' | 'redirect' | 'broken';

export interface DirectionLook {
  tone: DirectionTone;
  dash: string | null;
}

/** The colour and dash of a By tier line: green up, blue down, grey dashed sideways; amber (redirect) and red (broken) win. */
export function directionLook(direction: LineDirection, targetStatus: number | null): DirectionLook {
  if (targetStatus !== null && targetStatus >= 400) return { tone: 'broken', dash: null };
  if (targetStatus !== null && targetStatus >= 300) return { tone: 'redirect', dash: null };
  return { tone: direction, dash: direction === 'side' ? '6 4' : null };
}
```

- [ ] **Step 4: Run, gate, commit**

`journey-geometry.ts` is left as it is: the existing elbow and `edgeLook` stay for the By step layout until Task 5 replaces their use; Task 5 deletes `elbowPath` and its test when nothing imports it.

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/journey-curves.test.ts && pnpm lint && pnpm typecheck && pnpm format:check
git add apps/web/src/lib/internal-links/journey-curves.ts apps/web/src/lib/internal-links/journey-curves.test.ts
git commit -m "Internal links: curve geometry for the canvas and the By tier routes"
```

Expected: PASS (the by-tier "same lane" test differs by `index * 10` in the bulge).

---
### Task 5: Viewport, view controls and minimap

**Files:**
- Create: `apps/web/src/components/app/link-canvas/canvas-viewport.tsx`, `view-controls.tsx`, `minimap.tsx` and a test for each
- Modify: `apps/web/src/components/app/link-canvas/link-canvas.tsx`, `link-canvas.test.tsx`
- Delete: `apps/web/src/components/app/link-canvas/zoom-controls.tsx`
- Modify: `apps/web/src/lib/internal-links/journey-geometry.ts` (drop `elbowPath` and `CORNER` when unused) and its test
- Modify: `apps/web/src/components/design-system/link-canvas-section.tsx`, `docs/design-system/25-component-inventory.md` (14.17)
- Modify: `apps/web/messages/en.json` (`linkCanvas`)

**Read first:** `link-canvas.tsx` (the whole file; the edits below name its identifiers), `link-card.tsx`, `lib/internal-links/canvas-view.ts` and `journey-curves.ts` (Tasks 1 and 4), the mock `il-canvas.js` (pan, wheel, pinch, glide, minimap, controls), `docs/design-system/25-component-inventory.md` section 14.17 and `docs/design-system/21-motion.md`, `20-accessibility.md` section 7.1.

The canvas stops scrolling. Its world (the columns and the SVG) sits in a child with `transform: translate(x, y) scale(scale)`; a controlled `view` lives in the Journey tab and is passed down with `onViewChange`.

- [ ] **Step 1: Write the failing viewport test**

Create `canvas-viewport.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasViewport } from './canvas-viewport';
import type { View } from '@/lib/internal-links/canvas-view';

function setup(view: View = { x: 0, y: 0, scale: 1 }) {
  const onViewChange = vi.fn();
  render(
    <CanvasViewport label="Journey" view={view} onViewChange={onViewChange} size={{ width: 1000, height: 600 }}>
      <button type="button">card</button>
    </CanvasViewport>,
  );
  const region = screen.getByRole('group', { name: 'Journey' });
  return { region, onViewChange };
}

describe('CanvasViewport', () => {
  it('places the world with a transform and nothing scrolls', () => {
    const { region } = setup({ x: 40, y: 20, scale: 0.5 });
    const world = region.firstElementChild as HTMLElement;
    expect(world.style.transform).toBe('translate(40px, 20px) scale(0.5)');
    expect(region.className).toContain('overflow-hidden');
  });

  it('zooms toward the cursor on Ctrl and wheel', () => {
    const { region, onViewChange } = setup();
    fireEvent.wheel(region, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 100 });
    const next = onViewChange.mock.calls[0]?.[0] as View;
    expect(next.scale).toBeGreaterThan(1);
  });

  it('pans on a plain wheel or a two finger scroll', () => {
    const { region, onViewChange } = setup();
    fireEvent.wheel(region, { deltaX: 30, deltaY: 50 });
    expect(onViewChange).toHaveBeenCalledWith({ x: -30, y: -50, scale: 1 });
  });

  it('pans when the empty background is dragged, and not when a card is', () => {
    const { region, onViewChange } = setup();
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 140, clientY: 110 });
    expect(onViewChange).toHaveBeenCalledWith({ x: 40, y: 10, scale: 1 });
    onViewChange.mockClear();
    fireEvent.pointerUp(region, { pointerId: 1 });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'card' }), { pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(region, { pointerId: 2, clientX: 50, clientY: 50 });
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('answers the keys of the canvas when the empty canvas has focus', () => {
    const { region, onViewChange } = setup();
    region.focus();
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(onViewChange).toHaveBeenLastCalledWith({ x: -40, y: 0, scale: 1 });
    fireEvent.keyDown(region, { key: 'ArrowRight', shiftKey: true });
    expect(onViewChange).toHaveBeenLastCalledWith({ x: -160, y: 0, scale: 1 });
    fireEvent.keyDown(region, { key: '+' });
    expect((onViewChange.mock.lastCall?.[0] as View).scale).toBe(1.25);
    fireEvent.keyDown(region, { key: '1' });
    expect((onViewChange.mock.lastCall?.[0] as View).scale).toBe(1);
  });
});
```

Create `view-controls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ViewControls } from './view-controls';

const base = {
  percent: 85,
  minimap: false,
  onZoomOut: vi.fn(),
  onZoomIn: vi.fn(),
  onActualSize: vi.fn(),
  onFit: vi.fn(),
  onCenterFocus: vi.fn(),
  onResetPositions: vi.fn(),
  onToggleMinimap: vi.fn(),
  onHelp: vi.fn(),
  canReset: true,
};

describe('ViewControls', () => {
  it('is a toolbar named Canvas view with every control a person can press', async () => {
    const user = userEvent.setup();
    const props = { ...base, onFit: vi.fn(), onZoomIn: vi.fn(), onActualSize: vi.fn() };
    render(<ViewControls {...props} />);
    expect(screen.getByRole('toolbar', { name: 'Canvas view' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Fit everything' }));
    await user.click(screen.getByRole('button', { name: '85%, return to 100%' }));
    expect(props.onZoomIn).toHaveBeenCalled();
    expect(props.onFit).toHaveBeenCalled();
    expect(props.onActualSize).toHaveBeenCalled();
  });

  it('says whether the minimap is on and disables reset when no card moved', () => {
    render(<ViewControls {...base} minimap canReset={false} />);
    expect(screen.getByRole('button', { name: 'Hide the map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Reset card positions' })).toBeDisabled();
  });
});
```

Create `minimap.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Minimap } from './minimap';

describe('Minimap', () => {
  it('draws a box per card and the part in view, and moves the view when pressed', () => {
    const onMove = vi.fn();
    render(
      <Minimap
        label="Map of the journey"
        content={{ left: 0, top: 0, width: 2000, height: 1000 }}
        cards={[
          { key: 'a', left: 0, top: 0, width: 240, height: 42 },
          { key: 'b', left: 400, top: 200, width: 240, height: 42 },
        ]}
        shown={{ left: 0, top: 0, width: 1000, height: 600 }}
        onMove={onMove}
      />,
    );
    const map = screen.getByRole('img', { name: 'Map of the journey' });
    expect(map.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(map.querySelector('[data-shown]')).not.toBeNull();
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 60, clientY: 30 });
    expect(onMove).toHaveBeenCalled();
    const target = onMove.mock.calls[0]?.[0] as { x: number; y: number };
    expect(target.x).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and see them fail**

```bash
cd apps/web && pnpm exec vitest run src/components/app/link-canvas
```

Expected: FAIL (modules missing).

- [ ] **Step 3: The viewport**

Create `canvas-viewport.tsx`:

```tsx
'use client';

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import { MAX_SCALE, MIN_SCALE, panBy, stepZoom, zoomAt, type Size, type View } from '@/lib/internal-links/canvas-view';
import { cn } from '@/lib/utils';

export interface CanvasViewportProps {
  /** The accessible name of the region. */
  label: string;
  view: View;
  onViewChange: (view: View) => void;
  /** The size of the region in pixels (the canvas measures it and passes it back). */
  size: Size;
  /** Called on a plain key the viewport does not own (Home, 0, F): the canvas decides. */
  onKey?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** A press on the empty background starts a selection box with Shift (the canvas draws it). */
  onBackgroundPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => boolean;
  children: ReactNode;
  className?: string;
}

const KEY_STEP = 40;
const KEY_STEP_BIG = 160;
const WHEEL_ZOOM = 0.0015;
/** A fast drag glides to a stop (spec 7.5 "Pan"); not under reduced motion. */
const GLIDE_FRICTION = 0.92;
const GLIDE_MIN = 0.4;

const reducedMotion = (): boolean =>
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

/**
 * The pannable, zoomable viewport of the canvas (spec 7.5 "Viewport", mock `il-canvas.js`): drag the empty background,
 * two finger scroll or wheel to pan, Ctrl or Cmd and wheel or a pinch to zoom toward the cursor, Space and drag, and the
 * keys when the empty canvas has focus. The children are the world; they move by one transform and nothing scrolls.
 */
export function CanvasViewport({
  label,
  view,
  onViewChange,
  size,
  onKey,
  onBackgroundPointerDown,
  children,
  className,
}: CanvasViewportProps): ReactElement {
  const region = useRef<HTMLDivElement>(null);
  const latest = useRef(view);
  latest.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; t: number } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const space = useRef(false);
  const glide = useRef<number | null>(null);

  const stopGlide = (): void => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  };
  useEffect(() => stopGlide, []);

  const local = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = region.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    stopGlide();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM * (event.deltaMode === 1 ? 16 : 1));
      onViewChange(zoomAt(latest.current, latest.current.scale * factor, local(event.clientX, event.clientY)));
      return;
    }
    onViewChange(panBy(latest.current, -event.deltaX, -event.deltaY));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const onCard = (event.target as HTMLElement).closest('[data-node], button, a, input, [data-canvas-control]') !== null;
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a !== undefined && b !== undefined) {
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: latest.current.scale };
        drag.current = null;
      }
      return;
    }
    if (onCard && !space.current) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (onBackgroundPointerDown?.(event) === true) return;
    stopGlide();
    const point = local(event.clientX, event.clientY);
    drag.current = { x: point.x, y: point.y, vx: 0, vy: 0, t: performance.now() };
    region.current?.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    if (pinch.current !== null && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      onViewChange(zoomAt(latest.current, pinch.current.scale * (distance / Math.max(pinch.current.distance, 1)), centre));
      return;
    }
    const start = drag.current;
    if (start === null) return;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const now = performance.now();
    const dt = Math.max(now - start.t, 1);
    drag.current = { x: point.x, y: point.y, vx: (dx / dt) * 16, vy: (dy / dt) * 16, t: now };
    onViewChange(panBy(latest.current, dx, dy));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const last = drag.current;
    drag.current = null;
    if (last === null || reducedMotion()) return;
    let { vx, vy } = last;
    if (Math.hypot(vx, vy) < 4) return;
    const tick = (): void => {
      vx *= GLIDE_FRICTION;
      vy *= GLIDE_FRICTION;
      if (Math.hypot(vx, vy) < GLIDE_MIN) {
        glide.current = null;
        return;
      }
      onViewChange(panBy(latest.current, vx, vy));
      glide.current = requestAnimationFrame(tick);
    };
    glide.current = requestAnimationFrame(tick);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const big = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const current = latest.current;
    let next: View | null = null;
    if (event.key === 'ArrowLeft') next = panBy(current, big, 0);
    else if (event.key === 'ArrowRight') next = panBy(current, -big, 0);
    else if (event.key === 'ArrowUp') next = panBy(current, 0, big);
    else if (event.key === 'ArrowDown') next = panBy(current, 0, -big);
    else if (event.key === '+' || event.key === '=') next = stepZoom(current, 1, size);
    else if (event.key === '-') next = stepZoom(current, -1, size);
    else if (event.key === '1') next = zoomAt(current, 1, { x: size.width / 2, y: size.height / 2 });
    else if (event.key === ' ') {
      space.current = true;
      event.preventDefault();
      return;
    }
    if (next === null) {
      onKey?.(event);
      return;
    }
    event.preventDefault();
    onViewChange(next);
  };

  return (
    <div
      ref={region}
      role="group"
      aria-label={label}
      tabIndex={0}
      data-min-scale={MIN_SCALE}
      data-max-scale={MAX_SCALE}
      className={cn(
        'relative touch-none overflow-hidden bg-surface-subtle outline-none focus-visible:ring-2 focus-visible:ring-focus',
        className,
      )}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') space.current = false;
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform"
        style={{ transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})` }}
      >
        {children}
      </div>
    </div>
  );
}
```

The wheel handler calls `preventDefault`, which React 19 allows on `onWheel` only when the listener is not passive: attach it by a ref in a `useEffect` with `{ passive: false }` if the test environment or the browser logs "Unable to preventDefault inside passive event listener" (do this instead of the JSX `onWheel` then; the test fires `fireEvent.wheel(region, ...)` which reaches both).

The dot grid (spec: "behind the cards moves and scales with the view") is the region's background: add to the region element `style={{ backgroundImage: 'radial-gradient(var(--color-border-subtle) 1px, transparent 1px)', backgroundSize: `${String(24 * view.scale)}px ${String(24 * view.scale)}px`, backgroundPosition: `${String(view.x)}px ${String(view.y)}px` }}` (the token name is the one `DESIGN_SYSTEM.md` gives for the subtle border).

- [ ] **Step 4: The view controls**

Create `view-controls.tsx`:

```tsx
'use client';

import { HelpCircle, Map, Maximize2, RotateCcw, Target, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

export interface ViewControlsProps {
  /** The zoom in percent. */
  percent: number;
  minimap: boolean;
  canReset: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onActualSize: () => void;
  onFit: () => void;
  onCenterFocus: () => void;
  onResetPositions: () => void;
  onToggleMinimap: () => void;
  onHelp: () => void;
}

/** The toolbar at the bottom left of the canvas (spec 7.5 "View controls"): zoom, fit, centre, reset, map and help. */
export function ViewControls(props: ViewControlsProps): ReactElement {
  const t = useTranslations('linkCanvas.controls');
  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      data-canvas-control=""
      className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-sm"
    >
      <IconButton icon={ZoomOut} label={t('zoomOut')} variant="ghost" size="icon-sm" onClick={props.onZoomOut} />
      <Button
        variant="ghost"
        size="sm"
        className="num min-w-12"
        aria-label={t('actualSize', { percent: props.percent })}
        onClick={props.onActualSize}
      >
        {t('percent', { percent: props.percent })}
      </Button>
      <IconButton icon={ZoomIn} label={t('zoomIn')} variant="ghost" size="icon-sm" onClick={props.onZoomIn} />
      <IconButton icon={Maximize2} label={t('fit')} variant="ghost" size="icon-sm" onClick={props.onFit} />
      <IconButton icon={Target} label={t('center')} variant="ghost" size="icon-sm" onClick={props.onCenterFocus} />
      <IconButton
        icon={RotateCcw}
        label={t('reset')}
        variant="ghost"
        size="icon-sm"
        disabled={!props.canReset}
        onClick={props.onResetPositions}
      />
      <IconButton
        icon={Map}
        label={props.minimap ? t('hideMap') : t('showMap')}
        variant="ghost"
        size="icon-sm"
        aria-pressed={props.minimap}
        onClick={props.onToggleMinimap}
      />
      <IconButton icon={HelpCircle} label={t('help')} variant="ghost" size="icon-sm" onClick={props.onHelp} />
    </div>
  );
}
```

If `IconButton` does not take `aria-pressed` or `variant="ghost"`, read `components/ui/icon-button.tsx` and use the props it has (plan 03 Task 4 built `ZoomControls` with `variant="secondary"`); the test pins the accessible names and the pressed state only.

- [ ] **Step 5: The minimap**

Create `minimap.tsx`:

```tsx
'use client';

import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import type { Box } from '@/lib/internal-links/journey-geometry';

export interface MinimapCard extends Box {
  key: string;
}

export interface MinimapProps {
  label: string;
  /** The extent of the world. */
  content: Box;
  cards: readonly MinimapCard[];
  /** The part of the world in view, in world coordinates. */
  shown: Box;
  /** Pressing or dragging asks for the view to move so this world point is centred. */
  onMove: (centre: { x: number; y: number }) => void;
}

const WIDTH = 176;
const HEIGHT = 112;

/** The map at the bottom right (spec 7.5 "Minimap"): every card, and the part in view; press or drag to move the view. */
export function Minimap({ label, content, cards, shown, onMove }: MinimapProps): ReactElement {
  const scale = Math.min(WIDTH / Math.max(content.width, 1), HEIGHT / Math.max(content.height, 1));
  const toWorld = (event: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: content.left + (event.clientX - rect.left) / scale,
      y: content.top + (event.clientY - rect.top) / scale,
    };
  };
  return (
    <svg
      role="img"
      aria-label={label}
      data-canvas-control=""
      width={WIDTH}
      height={HEIGHT}
      className="hidden rounded-md border border-border bg-surface shadow-sm sm:block"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onMove(toWorld(event));
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) onMove(toWorld(event));
      }}
    >
      {cards.map((card) => (
        <rect
          key={card.key}
          data-card=""
          x={(card.left - content.left) * scale}
          y={(card.top - content.top) * scale}
          width={Math.max(card.width * scale, 2)}
          height={Math.max(card.height * scale, 2)}
          className="fill-foreground-tertiary"
        />
      ))}
      <rect
        data-shown=""
        x={(shown.left - content.left) * scale}
        y={(shown.top - content.top) * scale}
        width={shown.width * scale}
        height={shown.height * scale}
        className="fill-primary/10 stroke-primary"
        strokeWidth={1}
      />
    </svg>
  );
}
```

- [ ] **Step 6: Put them in `LinkCanvas`**

In `link-canvas.tsx`:

1. Props. Replace `zoom: Zoom;` with `view: View; onViewChange: (view: View) => void; minimap: boolean; onToggleMinimap: () => void; onHelp: () => void; positions: ReadonlyMap<string, { dx: number; dy: number }>; onResetPositions: () => void;` and the handle: `LinkCanvasHandle` becomes `{ fit: () => void; centerFocus: () => void }`. Remove the imports of `ZOOMS` and `Zoom`; import `View`, `fitView`, `firstView`, `centerOn`, `zoomAt`, `stepZoom` from `canvas-view` and `curvePath` and `COLUMN_GAP` from `journey-curves` (delete the local `COLUMN_GAP = 64` constant).
2. State. Add `const [size, setSize] = useState({ width: 1000, height: MIN_HEIGHT })`; the existing `height` state and its `fit` layout effect already measure the region, so set `size` there from `scroller.current.clientWidth` and `height`.
3. Edges. In `draw`, change every `/ zoom` to `/ view.scale` (the rectangles are read from the transformed `inner`). Replace the line geometry: `d: elbowPath(inbound ? child : parent, inbound ? parent : child)` becomes `curvePath(from, to, index, count).d` where `from` and `to` are `inbound ? child : parent` and `inbound ? parent : child`, `index` is the position of the child among the children of the same parent (count the lines by `item.parentKey` while looping) and `count` the number of children of that parent. Add the dot and the arrowhead: for each line also keep `start` and `end` from `curvePath` and draw `<circle r={3}>` at `start` in the line's colour and a `markerEnd` arrowhead (a second `<marker>` in the line colour, one per tone) on the path.
4. The DOM. Replace the `<div ref={scroller} ... className="overflow-auto ..." style={{ height }}>` and its inner sizing `<div style={{ width: edges.width * zoom ...}}>` by

```tsx
      <div ref={scroller} className="relative" style={{ height }}>
        <CanvasViewport
          label={t('label')}
          view={view}
          onViewChange={onViewChange}
          size={size}
          className="h-full"
        >
          <div
            ref={inner}
            role="presentation"
            className="relative flex w-max items-start p-4"
            style={{ columnGap: COLUMN_GAP }}
            onFocus={...unchanged}
          >
            {/* the svg and the columns, unchanged */}
          </div>
        </CanvasViewport>
        <div className="absolute bottom-3 left-3">
          <ViewControls ... />
        </div>
        {minimap ? (
          <div className="absolute right-3 bottom-3">
            <Minimap ... />
          </div>
        ) : null}
      </div>
```

   with `ViewControls` props from the view (`percent: Math.round(view.scale * 100)`, `onZoomOut: () => onViewChange(stepZoom(view, -1, size))`, `onActualSize: () => onViewChange(zoomAt(view, 1, { x: size.width / 2, y: size.height / 2 }))`, `onFit: fit`, `onCenterFocus: centerFocus`) and `Minimap` props from the same measurements (`content` is `{ left: 0, top: 0, width: edges.width, height: edges.height }`, `cards` from `nodesOf()` boxes, `shown` is the viewport converted to world: `{ left: -view.x / view.scale, top: -view.y / view.scale, width: size.width / view.scale, height: size.height / view.scale }`, `onMove: (c) => onViewChange(centerOn(view, { left: c.x, top: c.y, width: 0, height: 0 }, size))`).
4. The handle and the first view. `fit` is `onViewChange(fitView(content, size))`; `centerFocus` centres the focus card's box. Add an effect that runs when the focus page changes (`focus.urlId`) and the first time the layout is not pending: `onViewChange(firstView(content, focusBox, size))`. The Journey tab keeps the last view in a ref per focus and restores it after a re-render, so a tier change does not move the picture (spec 7.5 "First view").
5. Delete `zoom-controls.tsx`, its import and its keys (`zoomLevel`, `zoomOut`, `zoomIn`, `fit`), and remove `elbowPath` and `CORNER` from `journey-geometry.ts` with their tests when nothing imports them (`grep -rn elbowPath apps/web/src`).
6. Keys on the canvas region (spec 7.5 "Keyboard"): the viewport owns the arrows, plus, minus and 1; pass `onKey` for `0` (fit) and `Home` (centre the focus page).

Update `link-canvas.test.tsx`: its zoom tests (`ZOOMS`, "does not pull focus back to an old card when only the zoom changes") now pass a `view` and assert the transform string and that focus stays; add tests that the canvas shows no scrollbar region (`overflow-hidden`), that the toolbar and the map toggle exist, and that `Fit everything` calls `onViewChange` with a view whose `scale` is at most 1.

- [ ] **Step 7: Messages, design-system section, gate, commit**

Add to `messages/en.json` under `linkCanvas`:

```json
"controls": {
  "label": "Canvas view",
  "zoomOut": "Zoom out",
  "zoomIn": "Zoom in",
  "percent": "{percent}%",
  "actualSize": "{percent}%, return to 100%",
  "fit": "Fit everything",
  "center": "Centre on the focus page",
  "reset": "Reset card positions",
  "showMap": "Show the map",
  "hideMap": "Hide the map",
  "help": "Legend and controls"
},
"map": "Map of the journey"
```

(use `"map"` as the `label` of `Minimap`). Update `link-canvas-section.tsx` so the preview shows the viewport, the controls and the minimap in both themes, and section 14.17 of `docs/design-system/25-component-inventory.md` (view controls, minimap off until turned on, pan and zoom gestures, first view rule, the 112 px column gap).

```bash
cd apps/web && pnpm exec vitest run src/components/app/link-canvas src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/components/app/link-canvas apps/web/src/lib/internal-links/journey-geometry.ts apps/web/src/lib/internal-links/journey-geometry.test.ts apps/web/src/components/design-system/link-canvas-section.tsx apps/web/messages/en.json docs/design-system/25-component-inventory.md
git commit -m "Internal links: the canvas is a pannable, zoomable viewport with controls and a minimap"
```

Add `git rm apps/web/src/components/app/link-canvas/zoom-controls.tsx` before the commit. Review step (roadmap): a review of the canvas for keyboard use and screen reader names in both themes after this task.

---

### Task 6: The focus card, card tools, info panel, selection, move and the controls panel

**Files:**
- Create: `apps/web/src/lib/internal-links/canvas-selection.ts` (+ test), `components/app/link-canvas/info-panel.tsx`, `selection-bar.tsx`, `canvas-help.tsx` (+ tests)
- Modify: `link-card.tsx`, `link-canvas.tsx`, their tests, `link-canvas-section.tsx`
- Modify: `apps/web/messages/en.json` (`linkCanvas`)

**Read first:** `link-card.tsx` (the `tools`, `tip`, `back` props), spec 7.5 "Layout" (focus card), "Info panel", "Selecting and moving", mock `il-journey.js` (search `selected`, `infoPanel`, `drag`, `marquee`), `lib/a11y/use-shortcut`.

- [ ] **Step 1: Pure selection helpers, test first**

Create `canvas-selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { boxesIn, toggleSelected, withOffsets } from './canvas-selection';

describe('canvas selection', () => {
  const boxes = new Map([
    ['a', { left: 0, top: 0, width: 240, height: 42 }],
    ['b', { left: 400, top: 0, width: 240, height: 42 }],
    ['c', { left: 0, top: 100, width: 240, height: 42 }],
  ]);

  it('finds the cards a selection box touches', () => {
    expect(boxesIn(boxes, { left: -10, top: -10, width: 300, height: 60 })).toEqual(['a']);
    expect(boxesIn(boxes, { left: 100, top: 20, width: 400, height: 100 }).sort()).toEqual(['a', 'b', 'c']);
    expect(boxesIn(boxes, { left: 700, top: 0, width: 10, height: 10 })).toEqual([]);
  });

  it('adds a card with Shift or Cmd and takes it away the second time', () => {
    expect([...toggleSelected(new Set(['a']), 'b')]).toEqual(['a', 'b']);
    expect([...toggleSelected(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });

  it('moves a card and the cards selected with it by the same distance', () => {
    const moved = withOffsets(new Map([['a', { dx: 5, dy: 5 }]]), ['a', 'b'], 10, -4);
    expect(moved.get('a')).toEqual({ dx: 15, dy: 1 });
    expect(moved.get('b')).toEqual({ dx: 10, dy: -4 });
  });
});
```

- [ ] **Step 2: Run, see it fail, implement**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links/canvas-selection.test.ts
```

Create `canvas-selection.ts`:

```ts
import type { Box } from './journey-geometry';

/** The keys of the cards whose box a selection box (world coordinates) touches. */
export function boxesIn(boxes: ReadonlyMap<string, Box>, area: Box): string[] {
  const found: string[] = [];
  for (const [key, box] of boxes) {
    const apart =
      box.left > area.left + area.width ||
      box.left + box.width < area.left ||
      box.top > area.top + area.height ||
      box.top + box.height < area.top;
    if (!apart) found.push(key);
  }
  return found;
}

/** Shift or Cmd and click: adds a card, or takes it away when it was selected. */
export function toggleSelected(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export interface Offset {
  dx: number;
  dy: number;
}

/** The positions after dragging `keys` by (dx, dy): kept per focus page for the session, "Reset card positions" clears them. */
export function withOffsets(
  current: ReadonlyMap<string, Offset>,
  keys: readonly string[],
  dx: number,
  dy: number,
): Map<string, Offset> {
  const next = new Map(current);
  for (const key of keys) {
    const before = next.get(key) ?? { dx: 0, dy: 0 };
    next.set(key, { dx: before.dx + dx, dy: before.dy + dy });
  }
  return next;
}
```

- [ ] **Step 3: The components, test first**

Create `info-panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InfoPanel } from './info-panel';

const facts = {
  title: 'SOC as a service',
  tier: 'T1 Money pages',
  status: '200',
  depth: '2',
  linkingEditorial: '12',
  linkingAll: '30',
  placement: 'Content',
  rel: 'follow',
};

describe('InfoPanel', () => {
  it('lists the facts and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InfoPanel label="Info" facts={facts} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Info' })).toBeInTheDocument();
    expect(screen.getByText('T1 Money pages')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
```

Create `selection-bar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SelectionBar } from './selection-bar';

describe('SelectionBar', () => {
  it('says how many cards are selected and offers set tier, show their links and clear', async () => {
    const user = userEvent.setup();
    const handlers = { onSetTier: vi.fn(), onShowLinks: vi.fn(), onClear: vi.fn() };
    render(<SelectionBar count={3} {...handlers} />);
    expect(screen.getByText('3 cards selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show their links' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(handlers.onShowLinks).toHaveBeenCalled();
    expect(handlers.onClear).toHaveBeenCalled();
  });

  it('uses the singular for one card', () => {
    render(<SelectionBar count={1} onSetTier={vi.fn()} onShowLinks={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('1 card selected')).toBeInTheDocument();
  });
});
```

Run `pnpm exec vitest run src/components/app/link-canvas` and see them fail.

- [ ] **Step 4: Implement the components**

Create `info-panel.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';

export interface InfoFacts {
  title: string;
  tier: string;
  status: string;
  depth: string;
  linkingEditorial: string;
  linkingAll: string;
  /** This link's placement and rel; empty for the focus card. */
  placement: string;
  rel: string;
}

export interface InfoPanelProps {
  label: string;
  facts: InfoFacts;
  onClose: () => void;
}

/**
 * The info panel of a card (spec 7.5 "Info panel"): title, tier, status, depth, linking pages and this link's placement
 * and rel. It opens from the card's Info button only, never on hover or focus (it covered the cards a person was
 * reading), and closes on the button again, a click elsewhere, Escape, or a pan or zoom.
 */
export function InfoPanel({ label, facts, onClose }: InfoPanelProps): ReactElement {
  const t = useTranslations('linkCanvas.info');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onPress = (event: PointerEvent): void => {
      if (panel.current !== null && !panel.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [onClose]);
  const rows: [string, string][] = [
    [t('tier'), facts.tier],
    [t('status'), facts.status],
    [t('depth'), facts.depth],
    [t('linkingEditorial'), facts.linkingEditorial],
    [t('linkingAll'), facts.linkingAll],
    ...(facts.placement === '' ? [] : ([[t('placement'), facts.placement], [t('rel'), facts.rel]] as [string, string][])),
  ];
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      data-canvas-control=""
      className="absolute top-full left-0 z-(--z-popover) mt-1 w-64 rounded-md border border-border bg-surface p-3 shadow-md"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 type-body-strong text-foreground">{facts.title}</p>
        <IconButton icon={X} label={t('close')} variant="ghost" size="icon-xs" onClick={onClose} />
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 type-meta">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-foreground-tertiary">{name}</dt>
            <dd className="num text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

Create `selection-bar.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';

export interface SelectionBarProps {
  count: number;
  onSetTier: () => void;
  onShowLinks: () => void;
  onClear: () => void;
}

/** "N cards selected" with Set tier, Show their links and Clear (spec 7.5 "Selecting and moving"). */
export function SelectionBar({ count, onSetTier, onShowLinks, onClear }: SelectionBarProps): ReactElement {
  const t = useTranslations('linkCanvas.selection');
  return (
    <div
      role="region"
      aria-label={t('label')}
      data-canvas-control=""
      className="flex flex-wrap items-center gap-2 rounded-md border border-primary-border bg-primary-subtle px-3 py-2"
    >
      <span className="type-body-strong text-primary-text">{t('count', { count })}</span>
      <Button variant="secondary" size="sm" onClick={onSetTier}>
        {t('setTier')}
      </Button>
      <Button variant="secondary" size="sm" onClick={onShowLinks}>
        {t('showLinks')}
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        {t('clear')}
      </Button>
    </div>
  );
}
```

Create `canvas-help.tsx`: a `Dialog` (read `components/ui/dialog.tsx` for the house dialog) titled "Legend and controls" with two lists: the gestures and keys of spec 7.5 ("Pan", "Zoom", "Select", "Move", "Keyboard") and the legend that plan 03's `Legend` function draws (move that function here and render it inside the dialog; the permanent legend row under the canvas goes: spec 7.5 "There is no permanent legend row under the canvas"). It takes `open` and `onOpenChange`. Test: it renders the six line styles and the words "Shift and drag".

- [ ] **Step 5: The card changes**

In `link-card.tsx`:

1. The focus card stands out (spec 7.5): when `focus` is true the card is 288 px wide (`w-72`, others `w-60`), has `border-2 border-primary` and a halo `shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]`, a larger path (`type-body-strong`), and a third line "N out and N clicks from home": new props `outText: string | null` and `depthText: string | null` shown only when `focus`. The column heading of the focus column becomes a primary badge "Focus page" (in `link-canvas.tsx`: `<Badge tone="primary">`; its column function takes the label as before).
2. The hover tools (shown on hover or keyboard focus of the card, and always on a touch screen, which plan 03 already does) become Info, Make focus and Details. Replace the `tip` prop and its `Tooltip` by `info: { facts: InfoFacts; open: boolean; onToggle: () => void; label: string } | null` and render the "i" button (`icon={Info}`, label from `linkCanvas.info.open`) which toggles `open`; when `open` the card renders `<InfoPanel>` below itself. Lines and the back-link marker keep their small `Tooltip`s.
3. A card accepts `selected: boolean` (a 2 px `ring-primary` outline and `aria-selected`-like name suffix is not added: selection is announced by the bar), `onSelectToggle: (event) => void` for Shift or Cmd and click, `offset: { dx: number; dy: number }` applied as `style={{ transform: translate(...) }}`, and `onDragStart: (event: PointerEvent) => void` for dragging (pointer events; not for touch, so a tap always opens).

In `link-canvas.tsx`: keep `selected: Set<string>` and `positions: Map<string, Offset>` in the Journey tab state (props: `selected`, `onSelectedChange`, `positions`, `onPositionsChange`), draw the selection box on Shift-drag of the background (the `onBackgroundPointerDown` prop of `CanvasViewport` returns true when Shift is held and starts a box; the box is a div in the region; at pointer up `boxesIn(boxes, area)` selects), implement the drag of a card with `withOffsets` (the lines follow because `draw` reads the cards' boxes on every position change: call `draw()` in a `requestAnimationFrame` while dragging), show `SelectionBar` at the top of the canvas when `selected.size > 0`, and give `Escape` the order spec 7.5 asks: clear the selection first, then return focus to the focus card. `onShowLinks` calls the Journey tab's `openTogether` (Task 2) with the selected card keys; `onSetTier` opens plan 03's bulk tier menu for the selected cards' page ids.

- [ ] **Step 6: Messages, test, gate, commit**

Add under `linkCanvas`: `"info": { "open": "Info", "close": "Close", "tier": "Tier", "status": "Status", "depth": "Depth", "linkingEditorial": "Editorial links in", "linkingAll": "All links in", "placement": "Link placement", "rel": "Link rel" }`, `"selection": { "label": "Selected cards", "count": "{count, plural, one {# card selected} other {# cards selected}}", "setTier": "Set tier", "showLinks": "Show their links", "clear": "Clear" }`, `"focusBadge": "Focus page"`, `"focusOut": "{count} out", "focusDepth": "{count} clicks from home"`, `"helpTitle": "Legend and controls"` and the gesture lines of `canvas-help.tsx` (one key per line of spec 7.5 "Keyboard").

Extend `link-canvas.test.tsx`: the focus card has the primary border class and the third line; Info opens the panel and Escape closes it; Shift-click selects two cards and the bar says "2 cards selected"; "Show their links" calls the handler with both keys; dragging a card changes its transform and Reset restores it.

```bash
cd apps/web && pnpm exec vitest run src/components/app/link-canvas src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/lib/internal-links/canvas-selection.ts apps/web/src/lib/internal-links/canvas-selection.test.ts apps/web/src/components/app/link-canvas apps/web/src/components/design-system/link-canvas-section.tsx apps/web/messages/en.json
git commit -m "Internal links: the focus card stands out, with card tools, an info panel on demand, selection and moving cards"
```

---

### Task 7: Growth that keeps the place, and the By tier layout

**Files:**
- Create: `apps/web/src/lib/internal-links/tier-layout.ts` (+ test), `components/app/link-canvas/use-growth.ts` (+ test), `lane-chips.tsx`, `layout-switch.tsx` (+ tests)
- Modify: `link-canvas.tsx`, its test, `apps/web/src/features/internal-links/url-state.ts` (`jl`, `jt` keys; the keys are added to `LinksKey` in Task 10, so here the Journey tab reads them through `useLinksState`; if Task 10 is not done yet, add the two keys now and let Task 10 reuse them)
- Modify: `apps/web/messages/en.json` (`linkCanvas`, `internalLinks.journey`)

**Read first:** `lib/internal-links/journey-layout.ts` (`JourneyItem`, `JourneyLayout`), `tier-lanes.ts` and `journey-curves.ts` (Tasks 3 and 4), mock `il-journey.js` (`buildTierColumns`, `glide`, the lane chips at lines 1586 to 1620), spec 7.5 "Two layouts" and "Growing never loses the place".

- [ ] **Step 1: The tier layout, test first**

Create `tier-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { tierLayout } from './tier-layout';
import type { JourneyItem, JourneyLayout } from './journey-layout';

interface N {
  url_id: string;
  tier: { code: string; name: string } | null;
}
const node = (id: string, code: string | null): N => ({
  url_id: id,
  tier: code === null ? null : { code, name: code },
});
const card = (key: string, id: string, code: string | null, parentKey: string, dir: 'out' | 'in' = 'out'): JourneyItem<N> =>
  ({
    kind: 'card',
    key,
    urlId: id,
    node: node(id, code),
    parentKey,
    dir,
    step: 1,
    canOpen: true,
    open: false,
    bothWays: false,
    backs: [],
  }) as unknown as JourneyItem<N>;

const layout = (outItems: JourneyItem<N>[], inItems: JourneyItem<N>[] = []): JourneyLayout<N> =>
  ({
    out: [{ step: 1, items: outItems }],
    in: inItems.length === 0 ? [] : [{ step: 1, items: inItems }],
    cardCount: outItems.length + inItems.length,
    validKeys: new Set(),
    pending: false,
  }) as unknown as JourneyLayout<N>;

describe('tierLayout', () => {
  const tiers = [1, 2, 3, 4];

  it('puts each card in the lane of its tier and the focus page in its own', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T4', 'f')]),
      focus: { urlId: '1', position: 3 },
      tiers,
      hidden: new Set(),
    });
    expect(result.lanes.map((lane) => lane.pos)).toEqual([4, 3, 2, 1]);
    expect(result.cardsByLane.get(1)?.map((item) => item.key)).toEqual(['o:2']);
    expect(result.cardsByLane.get(4)?.map((item) => item.key)).toEqual(['o:3']);
    expect(result.lanes.find((lane) => lane.pos === 3)?.isFocus).toBe(true);
  });

  it('draws one line per link between cards on the canvas, coloured by direction', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T4', 'f')]),
      focus: { urlId: '1', position: 3 },
      tiers,
      hidden: new Set(),
    });
    const toT1 = result.lines.find((line) => line.to === 'o:2');
    const toT4 = result.lines.find((line) => line.to === 'o:3');
    expect(toT1?.direction).toBe('up');
    expect(toT4?.direction).toBe('down');
  });

  it('shows a page reached twice as one card with two lines', () => {
    const result = tierLayout({
      layout: layout([
        card('o:2', '2', 'T1', 'f'),
        card('o:3', '3', 'T2', 'f'),
        card('o:3.2', '2', 'T1', 'o:3'),
      ]),
      focus: { urlId: '1', position: 3 },
      tiers,
      hidden: new Set(),
    });
    expect(result.cardsByLane.get(1)).toHaveLength(1);
    expect(result.lines.filter((line) => line.to === 'o:2')).toHaveLength(2);
  });

  it('leaves out a lane a chip turned off, with its cards and lines', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T4', 'f')]),
      focus: { urlId: '1', position: 3 },
      tiers,
      hidden: new Set([4]),
    });
    expect(result.lanes.map((lane) => lane.pos)).not.toContain(4);
    expect(result.lines.every((line) => line.to !== 'o:3')).toBe(true);
  });

  it('draws a line from a stub to the card it points at', () => {
    const stub = {
      kind: 'stub',
      key: 'o:5.2',
      urlId: '2',
      node: node('2', 'T1'),
      parentKey: 'o:5',
      dir: 'out',
      at: { dir: 'out', step: 1 },
    } as unknown as JourneyItem<N>;
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:5', '5', 'T2', 'f'), stub]),
      focus: { urlId: '1', position: 3 },
      tiers,
      hidden: new Set(),
    });
    expect(result.lines.some((line) => line.from === 'o:5' && line.to === 'o:2')).toBe(true);
  });

  it('counts an empty lane as zero pages, which is a finding', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f')]),
      focus: { urlId: '1', position: 3 },
      tiers,
      hidden: new Set(),
    });
    expect(result.lanes.find((lane) => lane.pos === 2)).toMatchObject({ count: 0, empty: true });
  });
});
```

- [ ] **Step 2: Implement `tier-layout.ts`**

```ts
import type { JourneyItem, JourneyLayout, JourneyNeighbor } from './journey-layout';
import { directionLook } from './journey-curves';
import { laneOfTier, laneSet, placeOnce, direction, type Lane, type LineDirection } from './tier-lanes';

export interface TierLine {
  from: string;
  to: string;
  direction: LineDirection;
  scope: JourneyNeighbor['scope'];
  status: number | null;
}

export type TierCard<N extends JourneyNeighbor> = Extract<JourneyItem<N>, { kind: 'card' }>;

export interface TierLayout<N extends JourneyNeighbor> {
  lanes: Lane[];
  cardsByLane: Map<number, TierCard<N>[]>;
  /** Groups and "+N more" go in the lane of the card they hang under. */
  extrasByLane: Map<number, JourneyItem<N>[]>;
  lines: TierLine[];
  /** Card keys that are the same page as an earlier card: their lines go to that card. */
  alias: Map<string, string>;
}

export interface TierLayoutInput<N extends JourneyNeighbor> {
  layout: JourneyLayout<N>;
  focus: { urlId: string; position: number };
  /** The positions of the workspace's tiers. */
  tiers: readonly number[];
  hidden: ReadonlySet<number>;
}

/**
 * The By tier layout (spec 7.5, mock `buildTierColumns`): one lane per tier, a page one card however many links reach
 * it, and every link between cards on the canvas a line (a page reached twice shows two lines, not two cards).
 */
export function tierLayout<N extends JourneyNeighbor>({
  layout,
  focus,
  tiers,
  hidden,
}: TierLayoutInput<N>): TierLayout<N> {
  const order: JourneyItem<N>[] = [];
  const steps = Math.max(layout.out.length, layout.in.length);
  for (let step = 0; step < steps; step += 1) {
    order.push(...(layout.in[step]?.items ?? []), ...(layout.out[step]?.items ?? []));
  }
  const cards = order.filter((item): item is TierCard<N> => item.kind === 'card');
  const inView = new Set(cards.map((item) => laneOfTier(item.node.tier)));
  const placed = placeOnce(
    cards.map((item) => ({ key: item.key, urlId: item.urlId })),
    { key: 'f', urlId: focus.urlId },
  );
  const lanes = laneSet({ tiers, inView, focusLane: focus.position, hidden });
  const shown = new Set(lanes.map((lane) => lane.pos));
  const cardsByLane = new Map<number, TierCard<N>[]>(lanes.map((lane) => [lane.pos, []]));
  const byKey = new Map(cards.map((item) => [item.key, item]));
  for (const placedCard of placed.cards) {
    const item = byKey.get(placedCard.key);
    if (item === undefined) continue;
    const pos = laneOfTier(item.node.tier);
    if (shown.has(pos)) cardsByLane.get(pos)?.push(item);
  }
  const laneOfKey = (key: string): number | null => {
    if (key === 'f') return focus.position;
    const item = byKey.get(placed.alias.get(key) ?? key);
    return item === undefined ? null : laneOfTier(item.node.tier);
  };
  const resolve = (key: string): string => placed.alias.get(key) ?? key;
  const lines: TierLine[] = [];
  const seen = new Set<string>();
  const extrasByLane = new Map<number, JourneyItem<N>[]>();
  for (const item of order) {
    if (item.kind === 'group' || item.kind === 'more') {
      const lane = laneOfKey(resolve(item.parentKey));
      if (lane !== null && shown.has(lane)) extrasByLane.set(lane, [...(extrasByLane.get(lane) ?? []), item]);
      continue;
    }
    if (item.kind !== 'card' && item.kind !== 'stub') continue;
    const parent = resolve(item.parentKey);
    // A stub is a page already on the canvas: its line goes to the card that is there
    const original =
      item.kind === 'stub' ? (cards.find((candidate) => candidate.urlId === item.urlId)?.key ?? null) : item.key;
    if (original === null) continue;
    const targetKey = resolve(original);
    const [from, to] = item.dir === 'in' ? [targetKey, parent] : [parent, targetKey];
    const fromLane = laneOfKey(from);
    const toLane = laneOfKey(to);
    if (fromLane === null || toLane === null || !shown.has(fromLane) || !shown.has(toLane)) continue;
    const id = `${from}>${to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push({
      from,
      to,
      direction: direction(fromLane, toLane),
      scope: item.node.scope,
      status: item.node.status_code,
    });
  }
  for (const lane of lanes) {
    const count = (cardsByLane.get(lane.pos)?.length ?? 0) + (lane.isFocus ? 1 : 0);
    lane.count = count;
    lane.empty = count === 0;
  }
  return { lanes, cardsByLane, extrasByLane, lines, alias: placed.alias };
}

export { directionLook };
```

Run `pnpm exec vitest run src/lib/internal-links/tier-layout.test.ts`. Expected: PASS.

- [ ] **Step 3: Growth that keeps the place, test first**

Create `use-growth.test.ts` with a pure test of the part that decides, no DOM animation: `planGrowth(before, after, pressedKey)` returns `{ pan: {dx, dy}, move: Map<key, {dx, dy}>, enter: string[], leave: string[] }`:

```ts
import { describe, expect, it } from 'vitest';

import { planGrowth } from './use-growth';

const box = (left: number, top: number) => ({ left, top, width: 240, height: 42 });

describe('planGrowth', () => {
  it('keeps the pressed card where it was on screen by panning the view by what it moved', () => {
    const plan = planGrowth(
      new Map([['a', box(0, 0)], ['b', box(400, 0)]]),
      new Map([['a', box(0, 0)], ['b', box(400, 60)], ['c', box(800, 0)]]),
      'b',
      0.5,
    );
    expect(plan.pan).toEqual({ dx: 0, dy: -30 });
  });

  it('glides every other card from its old place to its new one', () => {
    const plan = planGrowth(
      new Map([['a', box(0, 0)], ['b', box(400, 0)]]),
      new Map([['a', box(0, 40)], ['b', box(400, 40)]]),
      'b',
      1,
    );
    expect(plan.move.get('a')).toEqual({ dx: 0, dy: -40 });
    expect(plan.move.has('b')).toBe(false);
  });

  it('fades new cards in and closed cards out', () => {
    const plan = planGrowth(
      new Map([['a', box(0, 0)], ['gone', box(400, 0)]]),
      new Map([['a', box(0, 0)], ['fresh', box(400, 0)]]),
      'a',
      1,
    );
    expect(plan.enter).toEqual(['fresh']);
    expect(plan.leave).toEqual(['gone']);
  });
});
```

- [ ] **Step 4: Implement `use-growth.ts`**

```ts
'use client';

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

import type { Box } from '@/lib/internal-links/journey-geometry';

export interface GrowthPlan {
  /** The pan, in screen pixels, that keeps the pressed card still on the screen. */
  pan: { dx: number; dy: number };
  /** Cards that stay: where they were, relative to where they are now (world pixels). */
  move: Map<string, { dx: number; dy: number }>;
  enter: string[];
  leave: string[];
}

export const GLIDE_MS = 300;
export const FADE_IN_MS = 180;

/**
 * What a card opening or closing does to the picture (spec 7.5 "Growing never loses the place"): the pressed card stays
 * exactly where it is on screen (the view pans by what it moved), every other card glides from its old place to its new
 * one, new cards fade in and closed cards fade out where they stood. Pure.
 */
export function planGrowth(
  before: ReadonlyMap<string, Box>,
  after: ReadonlyMap<string, Box>,
  pressedKey: string,
  scale: number,
): GrowthPlan {
  const pressedBefore = before.get(pressedKey);
  const pressedAfter = after.get(pressedKey);
  const pan =
    pressedBefore === undefined || pressedAfter === undefined
      ? { dx: 0, dy: 0 }
      : {
          dx: (pressedBefore.left - pressedAfter.left) * scale,
          dy: (pressedBefore.top - pressedAfter.top) * scale,
        };
  const move = new Map<string, { dx: number; dy: number }>();
  for (const [key, box] of after) {
    const old = before.get(key);
    if (old === undefined || key === pressedKey) continue;
    // After the pan, the pressed card is still; so a card's old place in the new frame is its old place plus the pressed
    // card's shift in the world
    const shiftX = pressedBefore !== undefined && pressedAfter !== undefined ? pressedAfter.left - pressedBefore.left : 0;
    const shiftY = pressedBefore !== undefined && pressedAfter !== undefined ? pressedAfter.top - pressedBefore.top : 0;
    const dx = old.left + shiftX - box.left;
    const dy = old.top + shiftY - box.top;
    if (dx !== 0 || dy !== 0) move.set(key, { dx, dy });
  }
  return {
    pan,
    move,
    enter: [...after.keys()].filter((key) => !before.has(key)),
    leave: [...before.keys()].filter((key) => !after.has(key)),
  };
}

const reduced = (): boolean =>
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

export interface GrowthHandle {
  /** Call just before a card opens or closes: remembers where every card stands. */
  begin: (pressedKey: string) => void;
}

/**
 * Plays a growth plan on the canvas DOM after the layout changed. `root` holds the cards (`[data-node][data-key]`),
 * `commit` applies the plan's pan to the view, and nothing happens under reduced motion (everything is instant).
 */
export function useGrowth(
  root: RefObject<HTMLElement | null>,
  layoutKey: unknown,
  scale: number,
  commit: (pan: { dx: number; dy: number }, pressedBox: Box | null) => void,
): GrowthHandle {
  const pending = useRef<{ key: string; boxes: Map<string, Box>; clones: Map<string, HTMLElement> } | null>(null);
  const read = useCallback((): Map<string, Box> => {
    const boxes = new Map<string, Box>();
    const origin = root.current?.getBoundingClientRect();
    if (root.current === null || origin === undefined) return boxes;
    for (const element of root.current.querySelectorAll<HTMLElement>('[data-node][data-key]')) {
      const rect = element.getBoundingClientRect();
      boxes.set(element.dataset.key ?? '', {
        left: (rect.left - origin.left) / scale,
        top: (rect.top - origin.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      });
    }
    return boxes;
  }, [root, scale]);

  const begin = useCallback(
    (key: string) => {
      if (reduced()) return;
      const clones = new Map<string, HTMLElement>();
      for (const element of root.current?.querySelectorAll<HTMLElement>('[data-node][data-key]') ?? []) {
        clones.set(element.dataset.key ?? '', element.cloneNode(true) as HTMLElement);
      }
      pending.current = { key, boxes: read(), clones };
    },
    [read, root],
  );

  useLayoutEffect(() => {
    const before = pending.current;
    pending.current = null;
    if (before === null || root.current === null) return;
    const after = read();
    const plan = planGrowth(before.boxes, after, before.key, scale);
    commit(plan.pan, after.get(before.key) ?? null);
    const elements = new Map(
      [...root.current.querySelectorAll<HTMLElement>('[data-node][data-key]')].map((element) => [
        element.dataset.key ?? '',
        element,
      ]),
    );
    for (const [key, shift] of plan.move) {
      elements.get(key)?.animate(
        [{ transform: `translate(${String(shift.dx)}px, ${String(shift.dy)}px)` }, { transform: 'translate(0, 0)' }],
        { duration: GLIDE_MS, easing: 'ease-in-out' },
      );
    }
    for (const key of plan.enter) {
      elements.get(key)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: 'ease-out' });
    }
    for (const key of plan.leave) {
      const ghost = before.clones.get(key);
      const box = before.boxes.get(key);
      if (ghost === undefined || box === undefined) continue;
      ghost.removeAttribute('data-node');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('inert', '');
      Object.assign(ghost.style, {
        position: 'absolute',
        left: `${String(box.left)}px`,
        top: `${String(box.top)}px`,
        width: `${String(box.width)}px`,
        pointerEvents: 'none',
      });
      root.current.append(ghost);
      ghost
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_IN_MS, easing: 'ease-in' })
        .finished.then(() => ghost.remove())
        .catch(() => ghost.remove());
    }
  }, [layoutKey]);

  return { begin };
}
```

(The effect depends on `layoutKey` only, on purpose; add `// eslint-disable-next-line react-hooks/exhaustive-deps` with that reason if the lint rule of the repo complains.)

In `link-canvas.tsx`: create `const growth = useGrowth(inner, layout, view.scale, (pan, box) => { onViewChange(revealMinimum(panBy(view, pan.dx, pan.dy), <box of the pressed card and its new children>, size)); })`; the function `opening` (existing) calls `growth.begin(key)` first. Under reduced motion `begin` does nothing, the layout changes at once and the view is not moved. For the "pans the least it takes to show the card and its new children" part, the box passed is the union of the pressed card's box and the boxes of the cards that entered (`plan.enter`); change the `commit` callback to receive them: extend `useGrowth`'s `commit(pan, pressedBox, enteredBoxes)` accordingly and union them with a small helper in `canvas-view.ts` (`unionOf(boxes: Box[]): Box`, add it with its test).

- [ ] **Step 5: The By tier layout in the canvas**

Create `layout-switch.tsx` (a segmented control "By step | By tier" built on the house `SegmentedControl`; read `components/ui/segmented-control.tsx` for its name and props; test: two radio-like options, the selected one is pressed) and `lane-chips.tsx` (one toggle chip per tier plus Untiered, `aria-pressed`, the focus lane's chip disabled with the reason "The focus page's lane stays on"; a chip off means `hidden` has its position; test: pressing calls `onToggle(position)`). In `link-canvas.tsx` add the props `layoutMode: 'step' | 'tier'`, `tierPositions: readonly number[]`, `hiddenLanes: ReadonlySet<number>`, `onToggleLane: (position: number) => void` and, when `layoutMode === 'tier'`, build the columns from `tierLayout(...)`: one `<div>` per lane (focus lane `w-72` with a tinted background `bg-primary-subtle`, others `w-60`, a dashed border, header "T3 Content pages" with the count "4 pages", and the text "No T2 page in view" for an empty lane) holding `renderItem` of its cards, the focus card in its lane, and the lane's group and "+N more" items. The lines come from `tierLayout.lines`: each is drawn with `tierRoute(fromBox, toBox, index)` and the colour of `directionLook(direction, status)` (new strokes `stroke-positive-text` for up, `stroke-primary` for down, `stroke-border-strong` dashed for side, with the amber and red ones as before); the legend dialog gains the three direction lines. The first view fits all lanes down to 50% and shows the lanes nearest T1 at 50% beyond that: pass `minScale: 0.5` to `firstView` through a new optional parameter (`fitView(content, viewport, margin, minScale)`) and, when the whole content would need less, centre on the T1 side (`centerOn` of the union of the T1 and T2 lanes).

The Journey tab (plan 03 Task 11) holds the state: `layoutMode` from `jl` (`tier` or absent), `hiddenLanes` from `jt`, the switch placed next to the scope switch in its toolbar, the chips in a row under the toolbar while the layout is By tier. The tree list is unaffected.

- [ ] **Step 6: Tests, messages, gate, commit**

Add to `link-canvas.test.tsx`: in tier mode the lanes are headed T1 to T4 left to right with the right counts; a page reached twice is one card; turning a chip off removes its lane; the focus lane cannot be turned off; an empty lane says "No T2 page in view"; opening a card in step mode closes another opened card on its side (using `openExclusive`, wired in the Journey tab) but keeps its path.

Messages under `linkCanvas`: `"layout": { "step": "By step", "tier": "By tier", "label": "Layout" }`, `"lanes": { "label": "Tiers shown", "focusLocked": "The focus page's lane stays on", "empty": "No {tier} page in view", "pages": "{count, plural, one {# page} other {# pages}}" }`, and the three direction legend keys `"up": "Up a tier"`, `"down": "Down a tier"`, `"side": "Same tier"`.

```bash
cd apps/web && pnpm exec vitest run src/components/app/link-canvas src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/lib/internal-links apps/web/src/components/app/link-canvas apps/web/src/features/internal-links apps/web/src/components/design-system/link-canvas-section.tsx apps/web/messages/en.json
git commit -m "Internal links: growth keeps the place and the By tier layout with lanes and tier chips"
```

Review step: the same canvas review as Task 5, now with the By tier layout, in both themes.

---

### Task 8: The generated client, types, queries and mutations

**Files:**
- Modify: `apps/web/src/lib/api/schema.ts` (generated), `apps/web/src/lib/internal-links/types.ts`, `queries.ts`, `mutations.ts`, `queries.test.ts`, `mutations.test.tsx`

**Read first:** `lib/internal-links/queries.ts` and `mutations.ts` (the literal path constants and the `apiQuery` and `apiMutation` style), plan 04 "API contract" table, `AGENTS.md` ("the web session regenerates the client in its own commit").

- [ ] **Step 1: Regenerate the client in its own commit**

```bash
git merge develop
cd apps/web && pnpm gen:api && pnpm typecheck
git add apps/web/src/lib/api/schema.ts
git commit -m "Internal links: regenerate the API client for slices 2 and 3"
```

Expected: typecheck passes. If a name used below is missing from `Schemas` (for example `ChangesSummary`), the contract of plan 04 changed: stop and report, do not invent a type.

- [ ] **Step 2: The failing tests**

Append to `queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  changeLinksParams,
  changesSummaryQuery,
  moreIncludes,
  opportunitiesParams,
  pageParams,
  DEFAULT_PAGE_QUERY,
  withRun,
} from './queries';

const SCOPE = { workspaceId: 'w', projectId: 'p' };

describe('slices 2 and 3 reads', () => {
  it('adds run only when a crawl is chosen', () => {
    expect(withRun({ scope: 'editorial' }, null)).toEqual({ scope: 'editorial' });
    expect(withRun({ scope: 'editorial' }, 'abc')).toEqual({ scope: 'editorial', run: 'abc' });
  });

  it('asks the pages list for the extras the visible columns need', () => {
    expect(moreIncludes(['change', 'rank', 'citations', 'anchors', 'matches', 'clicks'])).toEqual([
      'changes',
      'keywords',
      'citations',
      'anchors',
      'gsc',
    ]);
    expect(moreIncludes(['page', 'tier'])).toEqual([]);
    expect(pageParams({ ...DEFAULT_PAGE_QUERY, include: ['changes', 'anchors'] }).include).toEqual([
      'changes',
      'anchors',
    ]);
    expect(pageParams(DEFAULT_PAGE_QUERY)).not.toHaveProperty('include');
  });

  it('builds the lost links parameters', () => {
    expect(changeLinksParams({ change: 'lost', linkScope: 'all', only: 'top', offset: 0, limit: 50 }, 'r1')).toEqual({
      change: 'lost',
      link_scope: 'all',
      only: 'top',
      offset: 0,
      limit: 50,
      run: 'r1',
    });
  });

  it('builds the opportunities parameters and leaves unset filters out', () => {
    expect(opportunitiesParams({ status: null, tier: null, q: null, offset: 0, limit: 50 }, null)).toEqual({
      offset: 0,
      limit: 50,
    });
    expect(opportunitiesParams({ status: 'open', tier: '1', q: 'soc', offset: 50, limit: 50 }, null)).toEqual({
      status: 'open',
      'filter[target_tier]': '1',
      q: 'soc',
      offset: 50,
      limit: 50,
    });
  });

  it('makes a query key that starts with the project', () => {
    const options = changesSummaryQuery(SCOPE, null);
    expect(JSON.stringify(options.queryKey)).toContain('p');
  });
});
```

Run `pnpm exec vitest run src/lib/internal-links/queries.test.ts` (FAIL: the exports are missing).

- [ ] **Step 3: Types**

Append to `types.ts`:

```ts
export type ChangesSummary = Schemas['ChangesSummary'];
export type ChangeLink = Schemas['ChangeLink'];
export type ChangePage = Schemas['ChangePage'];
export type ChangeLinkPage = Schemas['ChangeLinkPage'];
export type MovedPage = Schemas['MovedPage'];
export type PageExtras = Schemas['PageExtras'];
export type PageDetailExtras = Schemas['PageDetailExtras'];
export type Opportunity = Schemas['Opportunity'];
export type OpportunityPage = Schemas['OpportunityPage'];
export type OpportunityStatus = Opportunity['status'];
export type TierSuggestionRow = Schemas['TierSuggestionRow'];
export type TierSuggestionList = Schemas['TierSuggestionList'];
export type Routes = Schemas['Routes'];
export type Route = Schemas['Route'];
export type AlertSettings = Schemas['AlertSettings'];
export type ChangeKind = 'lost' | 'added';
export type ChangeScope = 'editorial' | 'all';
export type ChangeOnly = 'top' | 'all';
/** The parts of a page row the Pages tab can ask for (`include`). */
export type PageInclude = 'changes' | 'keywords' | 'citations' | 'anchors' | 'gsc';
```

Extend the existing unions: `PageFlagFilter` gains `'generic_anchors'`, `PageWorklist` gains `'lost_links_top' | 'weak_outlinks'`, `PageSort` gains `'change' | '-change'`, and add `'link-crawls'`-level `CrawlRun` fields come with the regenerated type.

- [ ] **Step 4: Queries**

In `queries.ts` add the path constants and the functions (every function takes the chosen `run` id or `null`):

```ts
const CHANGES_SUMMARY = `${P}/internal-links/changes/summary` as const;
const CHANGES_LINKS = `${P}/internal-links/changes/links` as const;
const CHANGES_PAGES = `${P}/internal-links/changes/pages` as const;
const OPPORTUNITIES = `${P}/internal-links/opportunities` as const;
const SUGGESTIONS = `${P}/internal-links/tier-suggestions` as const;
const ROUTES = `${P}/internal-links/paths` as const;

type ChangeLinksParams = NonNullable<paths[typeof CHANGES_LINKS]['get']['parameters']['query']>;
type OpportunityParams = NonNullable<paths[typeof OPPORTUNITIES]['get']['parameters']['query']>;

/** The `run` parameter of every read: a chosen crawl, or none for the latest. */
export const withRun = <T extends object>(params: T, run: string | null): T & { run?: string } =>
  run === null ? params : { ...params, run };

/** Which `include` parts the visible optional columns need (the column ids of `page-columns.tsx`). */
export function moreIncludes(visible: readonly string[]): PageInclude[] {
  const want = new Set<PageInclude>();
  for (const id of visible) {
    if (id === 'change' || id === 'equityChange') want.add('changes');
    if (id === 'rank' || id === 'keywords') want.add('keywords');
    if (id === 'citations') want.add('citations');
    if (id === 'anchors' || id === 'matches') want.add('anchors');
    if (id === 'clicks' || id === 'impressions') want.add('gsc');
  }
  const order: PageInclude[] = ['changes', 'keywords', 'citations', 'anchors', 'gsc'];
  return order.filter((part) => want.has(part));
}

export const changesSummaryQuery = (scope: LinksScope, run: string | null): ApiQueryOptions<typeof CHANGES_SUMMARY> => ({
  ...apiQuery('get', CHANGES_SUMMARY, { params: { path: pathOf(scope), query: withRun({}, run) } }),
});
```

Write the other readers in the same shape as `worklistsQuery` of the file (copy its body and change the path and query): `changeLinksQuery(scope, query, run)`, `movedPagesQuery(scope, run, limit)`, `opportunitiesQuery(scope, query, run)`, `tierSuggestionsQuery(scope)`, `routesQuery(scope, urlId, run)` (the url id goes through `checkUrlId`). Add the parameter builders `changeLinksParams` and `opportunitiesParams` as tested above, the CSV path helpers `changeLinksPath(scope)` and `opportunitiesPath(scope)` (as `pagesPath`), and extend `PageQuery` with `include: readonly PageInclude[]` (default `[]`), `pageParams` with `...(query.include.length === 0 ? {} : { include: [...query.include] })`, and `pageDetailQuery` and every existing reader with the optional `run` (add a trailing `run: string | null = null` and pass it through `withRun`; the key then includes it). Add `export const changesKeys = (scope) => [...projectKey(scope), 'internal-links', 'changes']` style keys next to `internalLinksKeys` so a tier change refreshes Changes, Opportunities and suggestions too: extend `internalLinksKeys(scope)` to include their key prefixes.

- [ ] **Step 5: Mutations**

In `mutations.ts` add:

```ts
export const decideOpportunitiesMutation = apiMutation('put', `${P}/internal-links/opportunities/decisions`);
export const acceptSuggestionsMutation = apiMutation('post', `${P}/internal-links/tier-suggestions/accept`);
export const dismissSuggestionsMutation = apiMutation('post', `${P}/internal-links/tier-suggestions/dismiss`);
```

(the alert settings use the existing `updateSettingsMutation`). Add a test in `mutations.test.tsx` that each posts to its path with the body it is given (copy the pattern of the existing `setTiersMutation` test).

- [ ] **Step 6: Run, gate, commit**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/lib/internal-links/types.ts apps/web/src/lib/internal-links/queries.ts apps/web/src/lib/internal-links/queries.test.ts apps/web/src/lib/internal-links/mutations.ts apps/web/src/lib/internal-links/mutations.test.tsx
git commit -m "Internal links: types, reads and writes for changes, opportunities, suggestions and paths"
```

---

### Task 9: The mock API (MSW)

**Files:**
- Create: `apps/web/src/mocks/internal-links-changes-world.ts` (+ test), `apps/web/src/mocks/handlers/internal-links-changes.ts` (+ test)
- Modify: `apps/web/src/mocks/handlers/index.ts`, `apps/web/src/mocks/internal-links-world.ts` (export what the new world needs), `apps/web/src/mocks/handlers/internal-links.ts` (accept `include`, `run`, the new flags and worklists, the crawl fields)

**Read first:** `mocks/internal-links-world.ts` (`crawledPages`, `pageRow`, `edgeRows`, `neighborsOf`, `crawlsOf`, `tierRef`, `assignedTier`, `worklists`), `mocks/handlers/internal-links.ts` (`mock`, `workspaceCaller`, `problem`, `invalid`, how a list handler reads query parameters and answers `meta`), `mocks/state.ts` (`onMockReset`), plan 04 contract.

- [ ] **Step 1: Failing tests for the world**

Create `internal-links-changes-world.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  changeLinks,
  changesSummary,
  decideOpportunities,
  movedPages,
  opportunities,
  routesTo,
  tierSuggestions,
} from './internal-links-changes-world';
import { crawledPages } from './internal-links-world';

const idOf = (path: string): string => {
  const page = crawledPages().find((candidate) => candidate.path === path);
  if (page === undefined) throw new Error(`no page ${path}`);
  return page.id;
};

describe('the mock crawl history', () => {
  it('has links lost since the last crawl, some to T1 and T2 pages', () => {
    const summary = changesSummary(null);
    expect(summary.editorial_lost).toBeGreaterThan(0);
    expect(summary.lost_to_top).toBeGreaterThan(0);
    expect(summary.state).toBe('ready');
    expect(summary.alert?.lost_links).toBe(summary.lost_to_top);
  });

  it('lists lost links with the most important targets first', () => {
    const rows = changeLinks({ change: 'lost', linkScope: 'editorial', only: 'all', offset: 0, limit: 50 }).data;
    const positions = rows.map((row) => (row.target.tier === null ? 99 : Number(row.target.tier.code.slice(1))));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(rows[0]?.priority).toMatch(/^lost_to_t/);
  });

  it('keeps only the important targets with only=top', () => {
    const rows = changeLinks({ change: 'lost', linkScope: 'editorial', only: 'top', offset: 0, limit: 50 }).data;
    expect(rows.every((row) => row.target.tier !== null && ['T1', 'T2'].includes(row.target.tier.code))).toBe(true);
  });

  it('lists the pages that moved most', () => {
    const moved = movedPages(8).data;
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThanOrEqual(8);
  });
});

describe('opportunities', () => {
  it('lists open ones, and a decision moves a pair between the counts', () => {
    const before = opportunities({ status: null, tier: null, q: null, offset: 0, limit: 50 });
    expect(before.meta.counts.open).toBeGreaterThan(0);
    const first = before.data[0];
    if (first === undefined) throw new Error('no opportunity');
    const result = decideOpportunities(
      [{ source_url_id: first.source.url_id, target_url_id: first.target.url_id }],
      'accepted',
    );
    expect(result).toEqual({ matched: 1, changed: 1 });
    expect(opportunities({ status: 'accepted', tier: null, q: null, offset: 0, limit: 50 }).data).toHaveLength(1);
    decideOpportunities([{ source_url_id: first.source.url_id, target_url_id: first.target.url_id }], 'open');
  });
});

describe('suggestions and routes', () => {
  it('suggests a higher tier for a busy page and never for a manual tier', () => {
    const list = tierSuggestions();
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.meta.gsc_state).toBe('ok');
  });

  it('finds the route from home, shorter over every link than over editorial ones', () => {
    const routes = routesTo(idOf('/services/soc-as-a-service'));
    expect(routes.any?.steps[0]?.page.path).toBe('/');
    expect(routes.any?.clicks).toBeLessThanOrEqual(routes.editorial?.clicks ?? Infinity);
  });
});
```

Run `pnpm exec vitest run src/mocks/internal-links-changes-world.test.ts` (FAIL).

- [ ] **Step 2: The world**

Create `internal-links-changes-world.ts`. It derives a previous crawl from the one finished crawl of `internal-links-world.ts`: the previous crawl is the current edges minus a fixed list of `ADDED` pairs (links that exist now and did not then), plus a fixed list of `LOST` pairs (links the previous crawl had and the current one does not). Both lists name pages by path so they survive a change of ids:

```ts
import { crawledPages, edgeRows, linksWorld, pageRow, tierRef } from './internal-links-world';
import { onMockReset } from './state';
import type {
  ChangeLink,
  ChangePage,
  ChangesSummary,
  MovedPage,
  Opportunity,
  OpportunityStatus,
  Routes,
  TierSuggestionRow,
} from '@/lib/internal-links/types';

const HOST = 'https://eventussecurity.com';
const PREVIOUS_RUN_ID = '0192e4a0-1000-7000-8000-000000000000';

/** Editorial links the previous crawl had that this one lost: [from path, to path, anchor, placement still linking it]. */
const LOST: readonly (readonly [string, string, string, string | null])[] = [
  ['/blog/soc-vs-mdr', '/services/managed-detection-and-response', 'managed detection and response', null],
  ['/compare/eventus-vs-in-house-soc', '/pricing', 'compare plans', 'navigation'],
  ['/resources/case-studies/private-bank-soc', '/contact', 'Talk to us', 'navigation'],
  ['/blog/incident-response-plan-template', '/services/incident-response', 'incident response retainer', null],
  ['/industries/manufacturing', '/services/ot-security', 'OT security', null],
];
/** Editorial links this crawl has that the previous one did not: [from path, to path, anchor]. */
const ADDED: readonly (readonly [string, string, string])[] = [
  ['/blog/vapt-checklist', '/blog/iso-27001-checklist', 'ISO 27001 checklist'],
  ['/services/managed-siem', '/services/incident-response', 'incident response'],
];

const pageByPath = (path: string) => crawledPages().find((page) => page.path === path);

function changePage(path: string): ChangePage {
  const page = pageByPath(path);
  if (page === undefined) throw new Error(`The mock crawl has no page ${path}`);
  return {
    url_id: page.id,
    url: `${HOST}${page.path}`,
    path: page.path,
    tier: tierRef(pageRow(page, 'editorial').tier?.tier_id ?? null),
  };
}

const position = (tier: ChangePage['tier']): number => (tier === null ? 99 : Number(tier.code.slice(1)));
const priority = (tier: ChangePage['tier']): ChangeLink['priority'] =>
  position(tier) === 1 ? 'lost_to_t1' : position(tier) === 2 ? 'lost_to_t2' : 'lower';

function lostRows(): ChangeLink[] {
  return LOST.map(([from, to, anchor, still]) => {
    const target = changePage(to);
    return {
      source: changePage(from),
      target,
      anchor,
      placement: 'content',
      priority: priority(target.tier),
      still_linked_by: (still as ChangeLink['still_linked_by']) ?? null,
    };
  }).sort((a, b) => position(a.target.tier) - position(b.target.tier) || a.source.path.localeCompare(b.source.path));
}

function addedRows(): ChangeLink[] {
  return ADDED.map(([from, to, anchor]) => ({
    source: changePage(from),
    target: changePage(to),
    anchor,
    placement: 'content',
    priority: 'none',
    still_linked_by: null,
  }));
}

const alertSettings = { enabled: true, max_position: 2, threshold: 1, channel: 'app' as const };

export function changesSummary(run: string | null): ChangesSummary {
  const lost = lostRows();
  const top = lost.filter((row) => position(row.target.tier) <= alertSettings.max_position);
  return {
    run_id: run ?? '0192e4a0-1000-7000-8000-000000000001',
    previous_run_id: PREVIOUS_RUN_ID,
    previous_finished_at: '2026-11-07T03:12:00Z',
    state: 'ready',
    editorial_lost: lost.length,
    editorial_added: addedRows().length,
    all_lost: lost.filter((row) => row.still_linked_by === null).length,
    all_added: addedRows().length,
    lost_to_top: top.length,
    important_max_position: alertSettings.max_position,
    pages_added: 1,
    pages_lost: 0,
    alert:
      top.length >= alertSettings.threshold
        ? {
            lost_links: top.length,
            max_position: alertSettings.max_position,
            threshold: alertSettings.threshold,
            channel: 'app',
            delivery_state: 'shown_in_app',
          }
        : null,
  };
}

export interface ChangeLinkQuery {
  change: 'lost' | 'added';
  linkScope: 'editorial' | 'all';
  only: 'top' | 'all';
  offset: number;
  limit: number;
}

export function changeLinks(query: ChangeLinkQuery): { data: ChangeLink[]; meta: Record<string, unknown> } {
  const base = query.change === 'lost' ? lostRows() : addedRows();
  const scoped = query.linkScope === 'all' && query.change === 'lost' ? base.filter((row) => row.still_linked_by === null) : base;
  const rows =
    query.only === 'top' ? scoped.filter((row) => position(row.target.tier) <= alertSettings.max_position) : scoped;
  return {
    data: rows.slice(query.offset, query.offset + query.limit),
    meta: {
      run_id: '0192e4a0-1000-7000-8000-000000000001',
      previous_run_id: PREVIOUS_RUN_ID,
      change: query.change,
      link_scope: query.linkScope,
      only: query.only,
      total: rows.length,
      truncated: false,
    },
  };
}

export function movedPages(limit: number): { data: MovedPage[]; meta: { run_id: string; previous_run_id: string } } {
  const rows: MovedPage[] = [
    ['/pricing', -2, -2.1, 0, null],
    ['/services/ot-security', -1, -1.4, null, 'lost' as const],
    ['/blog/iso-27001-checklist', 1, 0.6, -1, null],
    ['/services/incident-response', 1, 0.5, 0, null],
  ].map(([path, delta, points, depth, state]) => ({
    page: changePage(path as string),
    editorial_in: 4,
    editorial_in_delta: delta as number,
    equity_points: points as number,
    depth: typeof depth === 'number' ? 2 + depth : null,
    depth_state: (state as MovedPage['depth_state']) ?? null,
    depth_delta: typeof depth === 'number' ? depth : null,
  }));
  return {
    data: rows.slice(0, limit),
    meta: { run_id: '0192e4a0-1000-7000-8000-000000000001', previous_run_id: PREVIOUS_RUN_ID },
  };
}

// ---------------------------------------------------------------------------------------------
// Opportunities

const MENTIONS: readonly (readonly [string, string, string, string])[] = [
  ['/blog/siem-use-cases', '/services/incident-response', 'incident response retainer',
    'Teams without an incident response retainer often lose a full day just finding the right people to call.'],
  ['/blog/vapt-checklist', '/services/iso-27001-compliance', 'ISO 27001',
    'Many buyers now ask for ISO 27001 evidence before they accept a test report from a new vendor.'],
  ['/blog/cloud-misconfigurations', '/services/managed-detection-and-response', 'managed detection and response',
    'A managed detection and response team can catch these misconfigurations within hours instead of weeks.'],
  ['/industries/banking', '/services/managed-siem', 'managed SIEM',
    'Banks that run a managed SIEM get one view of branch, cloud and card system logs.'],
  ['/about', '/contact', 'contact our team',
    'If you want to discuss a project, contact our team and we reply to every request within a day.'],
];

let decisions = new Map<string, Exclude<OpportunityStatus, 'open'>>();
onMockReset(() => {
  decisions = new Map();
});

export interface OpportunityQuery {
  status: OpportunityStatus | null;
  tier: string | null;
  q: string | null;
  offset: number;
  limit: number;
}

const allOpportunities = (): Opportunity[] =>
  MENTIONS.map(([from, to, phrase, context]) => {
    const source = changePage(from);
    const target = changePage(to);
    const key = `${source.url_id}>${target.url_id}`;
    return {
      key,
      source,
      target,
      phrase,
      context,
      anchor: phrase,
      source_equity_share: null,
      status: decisions.get(key) ?? 'open',
      origin: 'keyword' as const,
    };
  }).sort((a, b) => position(a.target.tier) - position(b.target.tier));

export function opportunities(query: OpportunityQuery): {
  data: Opportunity[];
  meta: { run_id: string; total: number; counts: { open: number; accepted: number; dismissed: number } };
} {
  const all = allOpportunities();
  const counts = {
    open: all.filter((row) => row.status === 'open').length,
    accepted: all.filter((row) => row.status === 'accepted').length,
    dismissed: all.filter((row) => row.status === 'dismissed').length,
  };
  const needle = query.q?.toLowerCase() ?? null;
  const rows = all.filter(
    (row) =>
      (query.status === null || row.status === query.status) &&
      (query.tier === null || (query.tier === 'none' ? row.target.tier === null : position(row.target.tier) === Number(query.tier))) &&
      (needle === null || row.source.path.toLowerCase().includes(needle) || row.target.path.toLowerCase().includes(needle)),
  );
  return {
    data: rows.slice(query.offset, query.offset + query.limit),
    meta: { run_id: '0192e4a0-1000-7000-8000-000000000001', total: rows.length, counts },
  };
}

export function decideOpportunities(
  items: readonly { source_url_id: string; target_url_id: string }[],
  status: OpportunityStatus,
): { matched: number; changed: number } {
  const known = new Set(allOpportunities().map((row) => row.key));
  let matched = 0;
  let changed = 0;
  for (const item of items) {
    const key = `${item.source_url_id}>${item.target_url_id}`;
    if (!known.has(key)) continue;
    matched += 1;
    const before = decisions.get(key) ?? 'open';
    if (before === status) continue;
    if (status === 'open') decisions.delete(key);
    else decisions.set(key, status);
    changed += 1;
  }
  return { matched, changed };
}

export function plannedFixesCsv(): string {
  const all = allOpportunities();
  const chosen = all.some((row) => row.status === 'accepted')
    ? all.filter((row) => row.status === 'accepted')
    : all.filter((row) => row.status === 'open');
  const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  return [
    'Source URL,Target URL,Anchor,Context,Status',
    ...chosen.map((row) => [row.source.url, row.target.url, row.anchor, row.context, row.status].map(cell).join(',')),
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Tier suggestions and routes

const dismissed = new Set<string>();
onMockReset(() => dismissed.clear());

export function tierSuggestions(): { data: TierSuggestionRow[]; meta: { run_id: string; gsc_state: 'ok' } } {
  const t2 = linksWorld().tiers[1];
  const rows: TierSuggestionRow[] = [
    ['/blog/what-is-a-soc', { kind: 'clicks' as const, clicks: 1810, rank: null, keyword: null, volume: null }],
    ['/blog/soc-vs-mdr', { kind: 'rank' as const, clicks: null, rank: 5, keyword: 'soc vs mdr', volume: 2400 }],
  ]
    .filter(([path]) => !dismissed.has(String(path)))
    .map(([path, reason]) => {
      const page = changePage(path as string);
      return {
        url_id: page.url_id,
        url: page.url,
        path: page.path,
        title: pageByPath(page.path)?.title ?? null,
        from_tier: page.tier,
        to_tier: tierRef(t2?.tier_id ?? null) ?? { tier_id: 'tier-2', code: 'T2', name: 'Supporting pages' },
        reasons: [reason as TierSuggestionRow['reasons'][number]],
      };
    });
  return { data: rows, meta: { run_id: '0192e4a0-1000-7000-8000-000000000001', gsc_state: 'ok' } };
}

export function dismissSuggestions(urlIds: readonly string[] | 'all'): { matched: number; changed: number } {
  const rows = tierSuggestions().data.filter((row) => urlIds === 'all' || urlIds.includes(row.url_id));
  for (const row of rows) dismissed.add(row.path);
  return { matched: rows.length, changed: rows.length };
}

/** The shortest route from home over `scope`: every followed link, or editorial links only (redirects are followed). */
function route(toId: string, editorialOnly: boolean): Routes['any'] {
  const home = crawledPages().find((page) => page.path === '/');
  if (home === undefined) return null;
  const edges = edgeRows(editorialOnly ? 'editorial' : 'all');
  const previous = new Map<string, { from: string; anchor: string; placement: string; scope: string }>();
  let frontier = [home.id];
  const seen = new Set(frontier);
  while (frontier.length > 0 && !seen.has(toId)) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of edges.filter((candidate) => candidate.source.url_id === id && candidate.is_followed)) {
        const target = edge.target.url_id;
        if (seen.has(target)) continue;
        seen.add(target);
        previous.set(target, { from: id, anchor: edge.anchor, placement: edge.placement, scope: edge.scope });
        next.push(target);
      }
    }
    frontier = next;
  }
  if (!seen.has(toId)) return null;
  const steps: NonNullable<Routes['any']>['steps'] = [];
  for (let id = toId; ; ) {
    const hop = previous.get(id);
    const page = crawledPages().find((candidate) => candidate.id === id);
    if (page === undefined) return null;
    steps.unshift({
      page: changePage(page.path),
      status_code: page.status ?? 200,
      anchor: hop?.anchor ?? null,
      placement: (hop?.placement as NonNullable<Routes['any']>['steps'][number]['placement']) ?? null,
      scope: (hop?.scope as NonNullable<Routes['any']>['steps'][number]['scope']) ?? null,
      via_redirect: false,
    });
    if (hop === undefined) break;
    id = hop.from;
  }
  return { clicks: steps.length - 1, steps };
}

export function routesTo(urlId: string): Routes {
  const page = crawledPages().find((candidate) => candidate.id === urlId);
  if (page === undefined) throw new Error(`No page ${urlId}`);
  return { target: changePage(page.path), any: route(urlId, false), editorial: route(urlId, true) };
}
```

`crawledPages`, `edgeRows`, `linksWorld`, `pageRow` and `tierRef` are exported by plan 03's world. The fields used on `EdgeRow` are the plan 02 names (`source.url_id`, `anchor`, `placement`, `scope`, `is_followed`) and `FixturePage.status` is optional (`page.status ?? 200`); export the `FixturePage` type from `internal-links-world.ts` if the compiler asks for it.

- [ ] **Step 3: Handlers, test first**

Create `handlers/internal-links-changes.test.ts` (use the pattern of `handlers/internal-links.test.ts` for the request helper: copy its `request` and `ids` helpers) asserting: `GET changes/summary` answers the summary with `state: "ready"`; `GET changes/links?change=lost` answers `data` and `meta.total`; `GET changes/links?change=lost&format=csv` answers `text/csv`; `PUT opportunities/decisions` with a viewer cookie is refused (403 `forbidden`) and with an editor changes the counts; `GET opportunities?export=planned` answers CSV; `GET tier-suggestions` and `POST tier-suggestions/accept` (accepting sets a manual tier through the existing world function that the `PUT pages/tiers` handler uses, so the row's tier changes in `GET pages`); `GET paths?url_id=` answers `Routes` and a malformed id answers 422.

Then create `handlers/internal-links-changes.ts` with the handlers, each in the form of the existing ones:

```ts
import { HttpResponse, type HttpHandler } from 'msw';

import { mock, problem, workspaceCaller } from './internal-links';
import {
  changeLinks, changesSummary, decideOpportunities, dismissSuggestions, movedPages, opportunities,
  plannedFixesCsv, routesTo, tierSuggestions,
} from '../internal-links-changes-world';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links';

const int = (value: string | null, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

export const internalLinkChangeHandlers: HttpHandler[] = [
  mock('get', `${P}/changes/summary`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: changesSummary(new URL(request.url).searchParams.get('run')) });
  }),
  // changes/links, changes/pages, opportunities, opportunities/decisions, tier-suggestions (+ accept, dismiss), paths:
  // each reads its query the way `int` does, answers with the world function above, and refuses a role without
  // the permission of the contract with `workspaceCaller(...)` as the handler above does.
];
```

Fill in the remaining handlers fully, one per route of the contract (the comment above lists them): `changes/links` reads `change`, `link_scope`, `only`, `offset`, `limit`, `format` (CSV rows: `Change,Source,Target,Anchor,Link type,Target tier,Still linked from`), `changes/pages` reads `limit`, `opportunities` reads `status`, `filter[target_tier]`, `q`, `offset`, `limit`, `export`; `opportunities/decisions` (permission `projects:write`) validates `items` (1 to 500) and `status` and answers `{ data: decideOpportunities(...) }`; `tier-suggestions/accept` (permission `projects:write`) calls the same world function the `PUT pages/tiers` handler of `internal-links.ts` calls for each suggestion (read how that handler sets `manual` tiers and reuse its function; export it if it is private) and then `dismissSuggestions` is not called; `tier-suggestions/dismiss` calls `dismissSuggestions`; `paths` validates `url_id` with `UrlIdError` rules (422 `validation_failed` for a malformed id, 404 `not_found` for an id not in the crawl). Export `mock`, `problem` and `workspaceCaller` from `internal-links.ts` if they are not exported yet. Register `...internalLinkChangeHandlers` in `handlers/index.ts` next to `internalLinkHandlers`.

- [ ] **Step 4: Extend the existing handlers**

In `handlers/internal-links.ts` and the world: the pages handler accepts `include` (a comma list) and fills `extras` for the rows from small functions in the changes world (`extrasOf(page, include)`: change from the `LOST` and `ADDED` lists and the `movedPages` table, keywords and citations from a small table of the Eventus pages, anchors computed from `edgeRows('editorial')` with the generic anchor list of plan 04, GSC state `ok` with clicks from the fixture), accepts `filter[flags]=generic_anchors`, the worklists `lost_links_top` and `weak_outlinks` (computed from the same data), `sort=change`, and puts `links_available: true` in `meta`; the crawl list answers the three new `CrawlRun` fields (`links_available` true for the latest two crawls, false for older; `previous_run_id`; `enrich_state: 'done'`) with four runs so the picker has something to pick (`crawlsOf` builds them: extend it to return four finished runs, newest first, the latest `is_latest`); `worklists` answers `lost_links_top` and `weak_outlinks`; the page detail answers `extras` (`PageDetailExtras`); settings answer and accept `internal_links.alerts` (merge, refuse `email` and `slack` with 422 `validation_failed`); an older `run` on `edges`, `neighbors` and `changes/links` for a run with `links_available: false` answers `410 links_dropped`.

- [ ] **Step 5: Run, gate, commit**

```bash
cd apps/web && pnpm exec vitest run src/mocks && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/mocks
git commit -m "Internal links: mock API for changes, opportunities, tier suggestions, paths and the new page columns"
```

---

### Task 10: Address state, tabs and the chosen crawl

**Files:**
- Modify: `apps/web/src/features/internal-links/url-state.ts` (+ test), `tabs.ts` (+ test)
- Create: `apps/web/src/lib/internal-links/crawl-choice.ts` (+ test)
- Modify: `apps/web/messages/en.json` (`internalLinks.tabs`)

**Read first:** `url-state.ts` (`LinksKey`, `parseLinksSearch`, `useLinksState`), `tabs.ts`, `lib/internal-links/crawl-view.ts` or `crawl-reads.ts` (how the latest crawl is found: `is_latest`), spec 7.10 "Crawl picker".

- [ ] **Step 1: Failing tests**

Add to `url-state.test.ts`:

```ts
import { parseLinksSearch } from './url-state';

describe('slices 2 and 3 address keys', () => {
  it('reads the chosen crawl, the new tabs and the new journey keys', () => {
    const state = parseLinksSearch({
      tab: 'changes',
      run: '0192e4a0-1000-7000-8000-000000000001',
      jl: 'tier',
      jt: '4,99',
      jv: 'paths',
      cs: 'all',
      os: 'open',
      ot: '1',
      oq: 'soc',
    });
    expect(state.tab).toBe('changes');
    expect(state.run).toBe('0192e4a0-1000-7000-8000-000000000001');
    expect(state.layout).toBe('tier');
    expect([...state.hiddenLanes]).toEqual([4, 99]);
    expect(state.journeyView).toBe('paths');
    expect(state.changesScope).toBe('all');
    expect(state.oppStatus).toBe('open');
    expect(state.oppTier).toBe('1');
    expect(state.oppQuery).toBe('soc');
  });

  it('falls back on a value the app does not know', () => {
    const state = parseLinksSearch({ tab: 'nope', run: 'not-a-uuid', jl: 'x', jt: 'a,b', cs: 'x', os: 'x', ot: '9' });
    expect(state.tab).toBe('pages');
    expect(state.run).toBeNull();
    expect(state.layout).toBe('step');
    expect(state.hiddenLanes.size).toBe(0);
    expect(state.changesScope).toBe('editorial');
    expect(state.oppStatus).toBeNull();
    expect(state.oppTier).toBeNull();
  });
});
```

Add to a new `crawl-choice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { chosenCrawl, isOlder, pickableCrawls } from './crawl-choice';
import type { CrawlRun } from './types';

const run = (id: string, over: Partial<CrawlRun> = {}): CrawlRun =>
  ({
    run_id: id,
    state: 'ready',
    is_latest: false,
    links_available: true,
    created_at: '2026-11-0' + id.length + 'T00:00:00Z',
    ...over,
  }) as CrawlRun;

describe('crawl choice', () => {
  const runs = [run('c4', { is_latest: true }), run('c3'), run('c2', { links_available: false }), run('c1', { state: 'failed' })];

  it('lists only crawls with data, newest first', () => {
    expect(pickableCrawls(runs).map((item) => item.run_id)).toEqual(['c4', 'c3', 'c2']);
  });

  it('chooses the crawl in the address when it has data, and the latest otherwise', () => {
    expect(chosenCrawl(runs, 'c3')?.run_id).toBe('c3');
    expect(chosenCrawl(runs, 'c1')?.run_id).toBe('c4');
    expect(chosenCrawl(runs, null)?.run_id).toBe('c4');
    expect(chosenCrawl([], null)).toBeNull();
  });

  it('says a crawl is older when it is not the latest', () => {
    expect(isOlder(runs, 'c3')).toBe(true);
    expect(isOlder(runs, null)).toBe(false);
    expect(isOlder(runs, 'c4')).toBe(false);
  });
});
```

Run both (FAIL).

- [ ] **Step 2: Implement**

`crawl-choice.ts`:

```ts
import type { CrawlRun } from './types';

const HAS_DATA = new Set<string>(['ready', 'stopped_at_ceiling']);

/** Crawls a person can open in the screens: those with data, newest first (the list comes newest first). */
export const pickableCrawls = (runs: readonly CrawlRun[]): CrawlRun[] => runs.filter((item) => HAS_DATA.has(item.state));

/** The crawl the screens show: the one in the address when it has data, otherwise the latest. */
export function chosenCrawl(runs: readonly CrawlRun[], run: string | null): CrawlRun | null {
  const pickable = pickableCrawls(runs);
  const wanted = run === null ? undefined : pickable.find((item) => item.run_id === run);
  return wanted ?? pickable.find((item) => item.is_latest) ?? pickable[0] ?? null;
}

/** Whether the address shows a crawl that is not the latest ("Older crawl", "Back to latest"). */
export function isOlder(runs: readonly CrawlRun[], run: string | null): boolean {
  const chosen = chosenCrawl(runs, run);
  return chosen !== null && !chosen.is_latest;
}
```

In `url-state.ts`: add `'run' | 'jl' | 'jt' | 'cs' | 'os' | 'ot' | 'oq'` to `LinksKey`; `LinksTabId` becomes `'pages' | 'links' | 'journey' | 'flow' | 'changes' | 'opportunities'` and `TABS` lists all six (the order of the mock: Pages, Links, Journey, Tier flow, Changes, Opportunities); `LinksState` gains `run: string | null` (a UUID, else `null`), `layout: 'step' | 'tier'`, `hiddenLanes: ReadonlySet<number>` (positions 1 to 8 and 99; anything else is dropped), `changesScope: 'editorial' | 'all'`, `oppStatus: OpportunityStatus | null`, `oppTier: string | null` (`1` to `8` or `none`), `oppQuery: string | null` (1 to 200 characters), and `journeyView` accepts `'paths'`; `parseLinksSearch` and the `useLinksState` parsers (`parseAsString` for each) read them the way the existing keys are read; `setSearch` takes the new keys. `PAGE_SORTS` gains `'change'` and `'-change'`, `WORKLISTS` gains `'lost_links_top'` and `'weak_outlinks'`. In `tabs.ts` extend `ORDER` to the six ids; the entries are added by Tasks 13 and 17 (an unbuilt tab is not listed, as in plan 03).

- [ ] **Step 3: Run, gate, commit**

Add to `messages/en.json` under `internalLinks.tabs`: `"changes": "Changes"`, `"opportunities": "Opportunities"`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links/url-state.ts apps/web/src/features/internal-links/url-state.test.ts apps/web/src/features/internal-links/tabs.ts apps/web/src/features/internal-links/tabs.test.ts apps/web/src/lib/internal-links/crawl-choice.ts apps/web/src/lib/internal-links/crawl-choice.test.ts apps/web/messages/en.json
git commit -m "Internal links: address keys for the chosen crawl, the new tabs, the layout and the lanes"
```

---

### Task 11: Pure formatting for changes, suggestions, routes and the client summary

**Files:**
- Create: `apps/web/src/lib/internal-links/changes-format.ts`, `suggestions-format.ts`, `route-format.ts`, `client-summary.ts` and a test for each

**Read first:** mock `il-changes.js` (`priorityBadge`, `delta`, `CHANNEL_TEXT`), `il-model.js` (`alertTierText`, `pageDelta`), `il.js` (`clientSummary`, `statItems`), `il-pages.js` (the suggestion reasons text), `il-journey.js` path view text.

- [ ] **Step 1: Failing tests**

`changes-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { alertTierText, depthMove, formatDelta, priorityTone, sinceText } from './changes-format';

describe('changes format', () => {
  it('names the important tiers', () => {
    expect(alertTierText(1)).toBe('T1');
    expect(alertTierText(2)).toBe('T1 and T2');
    expect(alertTierText(4)).toBe('T1 to T4');
  });

  it('tones a priority: T1 negative unless a menu still links it, T2 warning, the rest neutral', () => {
    expect(priorityTone('lost_to_t1', null)).toBe('negative');
    expect(priorityTone('lost_to_t1', 'navigation')).toBe('warning');
    expect(priorityTone('lost_to_t2', null)).toBe('warning');
    expect(priorityTone('lower', null)).toBe('neutral');
  });

  it('formats a change with its sign, and depth the other way round (deeper is worse)', () => {
    expect(formatDelta(2, 'in')).toEqual({ text: '+2', tone: 'positive' });
    expect(formatDelta(-3, 'in')).toEqual({ text: '-3', tone: 'negative' });
    expect(formatDelta(0, 'in')).toBeNull();
    expect(formatDelta(2, 'depth')).toEqual({ text: '+2', tone: 'negative' });
    expect(formatDelta(-1, 'depth')).toEqual({ text: '-1', tone: 'positive' });
    expect(formatDelta(1.25, 'points')).toEqual({ text: '+1.3 pts', tone: 'positive' });
    expect(formatDelta(null, 'in')).toBeNull();
  });

  it('sizes a depth move, with levels only', () => {
    expect(depthMove({ depth_state: null, depth_delta: -3 })).toBe(3);
    expect(depthMove({ depth_state: 'lost', depth_delta: null })).toBe(0);
  });

  it('says since when', () => {
    expect(sinceText('2026-11-07T03:12:00Z', 'UTC')).toBe('7 Nov');
    expect(sinceText(null, 'UTC')).toBeNull();
  });
});
```

`suggestions-format.test.ts` asserts `reasonText({ kind: 'clicks', clicks: 1810 }, t)` gives "1,810 clicks in 28 days" and `{ kind: 'rank', rank: 5, keyword: 'soc vs mdr', volume: 2400 }` gives "ranks #5 for 'soc vs mdr' (2,400 searches)" (the function takes plain format callbacks so it needs no `useTranslations`: `reasonText(reason, { clicks: (n) => string, rank: (r, k, v) => string })` returns `string`; the component passes `t`-based callbacks).

`route-format.test.ts` asserts `closerNote({ any: 2, editorial: 4 })` is `{ kind: 'menus', difference: 2 }`, `closerNote({ any: 3, editorial: 3 })` is `null`, `closerNote({ any: 3, editorial: null })` is `{ kind: 'noEditorial' }`, `closerNote({ any: null, editorial: null })` is `{ kind: 'unreachable' }`.

`client-summary.test.ts` asserts that `clientSummaryHtml(input)` returns a string that starts with `<!doctype html>`, contains the host in the `<title>`, one table row per tier with pages, share of pages (`pct`) and average depth, the editorial flow matrix with `From` and `To T1` headers, only the worklists with a count above zero, the lost links to important tiers (or "No editorial links to T1 and T2 pages were lost since the last crawl."), escapes `<`, `&` and quotes in every cell (`<script>` in a page path becomes `&lt;script&gt;`), contains no em dash or en dash character, and has no external `src` or `href` (a standalone page).

- [ ] **Step 2: Implement**

`changes-format.ts`:

```ts
import type { ChangeLink } from './types';

/** "T1", "T1 and T2" or "T1 to T4": the tiers the alert setting covers (mock `alertTierText`). */
export const alertTierText = (maxPosition: number): string =>
  maxPosition <= 1 ? 'T1' : maxPosition === 2 ? 'T1 and T2' : `T1 to T${String(maxPosition)}`;

export type Tone = 'negative' | 'warning' | 'positive' | 'neutral';

/** A pair that is still linked another way (the menu, say) is a smaller loss (mock `priorityBadge`). */
export function priorityTone(priority: ChangeLink['priority'], stillLinkedBy: string | null): Tone {
  if (priority === 'lost_to_t1') return stillLinkedBy === null ? 'negative' : 'warning';
  if (priority === 'lost_to_t2') return 'warning';
  return 'neutral';
}

export type DeltaKind = 'in' | 'depth' | 'points';

/** A change with its sign and tone; `null` for no change or no earlier number. Deeper is worse, so depth flips the tone. */
export function formatDelta(value: number | null, kind: DeltaKind): { text: string; tone: Tone } | null {
  if (value === null || value === 0) return null;
  const good = kind === 'depth' ? value < 0 : value > 0;
  const number = kind === 'points' ? value.toFixed(1) : String(value);
  const text = `${value > 0 ? '+' : ''}${number}${kind === 'points' ? ' pts' : ''}`;
  return { text, tone: good ? 'positive' : 'negative' };
}

/** The size of a depth change in levels; a page that became reachable or unreachable has none. */
export const depthMove = (change: { depth_state: 'lost' | 'found' | null; depth_delta: number | null }): number =>
  change.depth_state === null && change.depth_delta !== null ? Math.abs(change.depth_delta) : 0;

/** "7 Nov": the date a comparison starts, in the project's time zone. */
export function sinceText(iso: string | null, timeZone: string): string | null {
  if (iso === null) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).formatToParts(new Date(iso));
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${day} ${month}`;
}
```

`suggestions-format.ts`:

```ts
import type { TierSuggestionRow } from './types';

export interface ReasonWords {
  clicks: (count: string) => string;
  rank: (rank: string, keyword: string, volume: string) => string;
}

const grouped = (value: number): string => value.toLocaleString('en-US');

/** One reason of a suggestion in words (mock `tierSuggestions` reasons). */
export function reasonText(reason: TierSuggestionRow['reasons'][number], words: ReasonWords): string {
  if (reason.kind === 'clicks') return words.clicks(grouped(reason.clicks ?? 0));
  return words.rank(String(reason.rank ?? 0), reason.keyword ?? '', grouped(reason.volume ?? 0));
}
```

`route-format.ts`:

```ts
export type CloserNote =
  | { kind: 'menus'; difference: number }
  | { kind: 'noEditorial' }
  | { kind: 'unreachable' }
  | null;

/** The sentence under the two routes: menus make the page closer than the editorial links do (spec 7.10 "Path finder"). */
export function closerNote(clicks: { any: number | null; editorial: number | null }): CloserNote {
  if (clicks.any === null) return { kind: 'unreachable' };
  if (clicks.editorial === null) return { kind: 'noEditorial' };
  return clicks.editorial > clicks.any ? { kind: 'menus', difference: clicks.editorial - clicks.any } : null;
}
```

`client-summary.ts`: a pure function building the standalone HTML from plain input (`{ host, crawledOn, pages, tiers: {label, pages, depth}[], keys: string[], matrix: number[][], worklists: {label, count}[], lost: {from, to, anchor}[], importantText }`) with the same inline styles as the mock (`TH`, `TD`, the `htmlTable` helper), `esc` for every cell, all strings taken from the `messages` through a `words` argument (so no copy lives here), and `download(html)` as a separate tiny function that makes the Blob and clicks an `a[download]`. Copy the structure of `il.js` `clientSummary` lines 162 to 183 and replace its text literals by the `words` fields.

- [ ] **Step 3: Run, gate, commit**

```bash
cd apps/web && pnpm exec vitest run src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm format:check
git add apps/web/src/lib/internal-links/changes-format.ts apps/web/src/lib/internal-links/changes-format.test.ts apps/web/src/lib/internal-links/suggestions-format.ts apps/web/src/lib/internal-links/suggestions-format.test.ts apps/web/src/lib/internal-links/route-format.ts apps/web/src/lib/internal-links/route-format.test.ts apps/web/src/lib/internal-links/client-summary.ts apps/web/src/lib/internal-links/client-summary.test.ts
git commit -m "Internal links: pure formatting for changes, suggestions, routes and the client summary"
```

---
### Task 12: The page header: crawl picker, context line and tab badges

**Files:**
- Create: `apps/web/src/features/internal-links/crawl-picker.tsx`, `context-line.tsx`, `tab-badge.tsx` (+ tests), `apps/web/src/lib/internal-links/context-stats.ts` (+ test)
- Modify: `apps/web/src/features/internal-links/crawl-header.tsx`, `internal-links-screen.tsx`, `summary-strip.tsx` (replaced by the context line), `crawl-reads.ts`, their tests
- Modify: `apps/web/messages/en.json` (`internalLinks.picker`, `internalLinks.context`, `internalLinks.header`)

**Read first:** `crawl-header.tsx`, `internal-links-screen.tsx`, `summary-strip.tsx`, `crawl-reads.ts` (how `latest` and `active` are found), `lib/internal-links/crawl-choice.ts` (Task 10), spec 7.1 "Page header layout" (decided 2026-11-17) and 7.10 "Crawl picker", mock `il.js` (`pageRow`, `statItems`, `tabs`, the crawl menu).

The header becomes two lines. Line 1: the tabs on the left, Crawl now (primary), Export and More on the right; tab icons from `xl`, labels alone below it. Line 2, the context line: the crawl in scope with its menu, "Older crawl" and "Back to latest" when an earlier crawl is shown, then Tiered, T1 pages, T1 average depth, No editorial links in and the lost-links figure when there is one; it never wraps and scrolls sideways when too long. Below `md` the tabs take the whole first line and scroll sideways (the selected tab scrolled into view), the actions drop to a line of their own right aligned, and Export moves into More.

- [ ] **Step 1: Failing tests**

`context-stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { contextStats } from './context-stats';

const strip = (pages: number[], depths: (number | null)[]) =>
  pages.map((count, index) => ({
    tier: index < 4 ? { tier_id: `t${String(index + 1)}`, code: `T${String(index + 1)}`, name: 'x' } : null,
    pages: count,
    equity_share: 0,
    average_depth: depths[index] ?? null,
  }));

describe('contextStats', () => {
  it('counts tiered pages, T1 pages and their average depth', () => {
    const stats = contextStats({
      tiers: strip([10, 20, 30, 5, 35], [1.34, 2, 3, 4, null]),
      editorialOrphans: 7,
      lostToTop: 3,
      importantText: 'T1 and T2',
    });
    expect(stats.tiered).toEqual({ tiered: 65, total: 100, untiered: 35 });
    expect(stats.t1Pages).toBe(10);
    expect(stats.t1Depth).toBe(1.3);
    expect(stats.noEditorial).toBe(7);
    expect(stats.lost).toEqual({ count: 3, important: 'T1 and T2' });
  });

  it('leaves the lost figure out when there is none, and the depth when T1 is empty', () => {
    const stats = contextStats({ tiers: strip([0, 4, 0, 0, 0], [null, 2, null, null, null]), editorialOrphans: 0, lostToTop: 0, importantText: 'T1' });
    expect(stats.lost).toBeNull();
    expect(stats.t1Depth).toBeNull();
  });
});
```

`crawl-picker.test.tsx`: render `CrawlPicker` with four runs (one without links, one failed); open it; it lists the three with data newest first with date, trigger and page count; the one without links is disabled with the reason "Its links were dropped; Pages and Tier flow still work" when `needsLinks` is true and enabled when false; choosing one calls `onChoose(runId)`; when an older crawl is chosen the "Older crawl" badge and a "Back to latest" button show, and pressing it calls `onChoose(null)`.

`tab-badge.test.tsx`: `TabBadge` renders the count visibly with `aria-hidden` and the sr-only text ", 3 alerts" so the tab's name is "Changes, 3 alerts"; for Opportunities "12 open".

Run `pnpm exec vitest run src/features/internal-links src/lib/internal-links` (FAIL).

- [ ] **Step 2: Implement `context-stats.ts`**

```ts
import type { TierStat } from './types';

export interface ContextInput {
  tiers: readonly TierStat[];
  editorialOrphans: number;
  lostToTop: number;
  importantText: string;
}

export interface ContextStats {
  tiered: { tiered: number; total: number; untiered: number };
  t1Pages: number;
  t1Depth: number | null;
  noEditorial: number;
  lost: { count: number; important: string } | null;
}

/** The numbers of the context line (mock `statItems`), from the tier strip, the worklist counts and the lost-link count. */
export function contextStats({ tiers, editorialOrphans, lostToTop, importantText }: ContextInput): ContextStats {
  const total = tiers.reduce((sum, row) => sum + row.pages, 0);
  const untiered = tiers.filter((row) => row.tier === null).reduce((sum, row) => sum + row.pages, 0);
  const t1 = tiers.find((row) => row.tier?.code === 'T1');
  return {
    tiered: { tiered: total - untiered, total, untiered },
    t1Pages: t1?.pages ?? 0,
    t1Depth: t1?.average_depth == null || t1.pages === 0 ? null : Math.round(t1.average_depth * 10) / 10,
    noEditorial: editorialOrphans,
    lost: lostToTop > 0 ? { count: lostToTop, important: importantText } : null,
  };
}
```

- [ ] **Step 3: The components**

`crawl-picker.tsx` (a `Menu` of radio items; read `components/ui/menu.tsx` for the item shape used in `crawl-header.tsx`: `MenuItemDef` with `id`, `label`, `detail`, `onSelect`, `disabledReason`, `checked`):

```tsx
'use client';

import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { formatTableDate } from '@/lib/format';
import { chosenCrawl, pickableCrawls } from '@/lib/internal-links/crawl-choice';
import type { CrawlRun } from '@/lib/internal-links/types';

export interface CrawlPickerProps {
  runs: readonly CrawlRun[];
  /** The crawl id in the address, or `null` for the latest. */
  run: string | null;
  timeZone: string;
  /** The tab in view reads links, so a crawl whose links were dropped cannot be chosen for it. */
  needsLinks: boolean;
  onChoose: (run: string | null) => void;
}

/** The crawl in scope and the menu of earlier crawls (spec 7.1 context line, 7.10 "Crawl picker"). */
export function CrawlPicker({ runs, run, timeZone, needsLinks, onChoose }: CrawlPickerProps): ReactElement | null {
  const t = useTranslations('internalLinks.picker');
  const chosen = chosenCrawl(runs, run);
  if (chosen === null) return null;
  const items: MenuItemDef[] = pickableCrawls(runs).map((item) => ({
    id: item.run_id,
    label: formatTableDate(item.finished_at ?? item.created_at, timeZone),
    detail: t('detail', { trigger: t(`trigger.${item.trigger}`), count: item.pages_crawled }),
    checked: item.run_id === chosen.run_id,
    ...(needsLinks && !item.links_available
      ? { disabledReason: t('linksDropped') }
      : { onSelect: () => onChoose(item.is_latest ? null : item.run_id) }),
  }));
  return (
    <span className="flex items-center gap-2">
      <Menu
        align="start"
        trigger={
          <Button variant="ghost" size="sm" icon={History}>
            {t('crawled', {
              date: formatTableDate(chosen.finished_at ?? chosen.created_at, timeZone),
              count: chosen.pages_crawled,
            })}
          </Button>
        }
        items={items}
      />
      {chosen.is_latest ? null : (
        <>
          <Badge tone="warning">{t('older')}</Badge>
          <Button variant="secondary" size="sm" onClick={() => onChoose(null)}>
            {t('backToLatest')}
          </Button>
        </>
      )}
    </span>
  );
}
```

`tab-badge.tsx`:

```tsx
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

/** The count on a tab: visible for sighted users (`aria-hidden`), with the same words as hidden text, so the tab is named "Changes, 3 alerts". */
export function TabBadge({ count, text, tone }: { count: number; text: string; tone: 'negative' | 'neutral' }): ReactElement {
  return (
    <>
      <Badge tone={tone} aria-hidden="true" className="num">
        {String(count)}
      </Badge>
      <span className="sr-only">{`, ${text}`}</span>
    </>
  );
}
```

`context-line.tsx`: one `<ul className="flex items-center gap-x-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">` with items from `contextStats`: "Tiered 65 of 100" (a button that opens the Pages tab filtered to Untiered when `untiered > 0`, as the mock's `showUntiered`), "T1 pages 10", "T1 average depth 1.3", "No editorial links in 7" (a button to the `editorial_orphans` worklist), and, when `lost` is not null, "N editorial links lost to T1 and T2" in `text-negative-text` as a link to the Changes tab. Each takes its labels from `internalLinks.context` and shows its number with `num`. The line is `aria-label`led "Crawl in scope".

Rework `crawl-header.tsx` and `internal-links-screen.tsx` to the two lines: line 1 `flex flex-wrap items-center justify-between gap-x-3 gap-y-2` with the tabs group (a `role="tablist"`, `inline-flex min-w-0 max-w-full overflow-x-auto`, scroll the selected tab into view on mount with `scrollIntoView({ inline: 'nearest', block: 'nearest' })`) and the actions; line 2 the `CrawlPicker` and `ContextLine` side by side. The actions group takes `w-full justify-end md:w-auto`; the Export button is hidden below `md` and "Export this tab (CSV)" and "Client summary (HTML)" are added to the More menu there (`extraItems`). `onChoose` writes `run` to the address (`setSearch({ run })`, `null` removes it). The screen reads the crawl list it already reads, `chosenCrawl(runs, state.run)`, and passes `run: chosen.is_latest ? null : chosen.run_id` to every query of the tabs (the `LinksTabContext` gains `run: string | null`; plan 03's tabs forward it to their queries through the optional `run` parameter that Task 8 added). `needsLinks` is true for the Links, Journey, Changes (links part) and Opportunities tabs and false for Pages and Tier flow. When the crawl in the address cannot be used for the tab (links dropped), the tab shows the empty state "This crawl no longer holds its links. Pages and Tier flow still show it." with a "Back to latest" button instead of the 410 error.

- [ ] **Step 4: Messages, run, gate, commit**

`internalLinks.picker`: `"crawled": "Crawled {date}, {count, plural, one {# page} other {# pages}}"`, `"detail": "{trigger}, {count, plural, one {# page} other {# pages}}"`, `"trigger": { "website_added": "Website added", "schedule": "Schedule", "manual": "Manual", "ceiling_retry": "Higher limit" }`, `"older": "Older crawl"`, `"backToLatest": "Back to latest"`, `"linksDropped": "Its links were dropped; Pages and Tier flow still work"`. `internalLinks.context`: `"label": "Crawl in scope"`, `"tiered": "Tiered"`, `"of": "{tiered} of {total}"`, `"t1Pages": "T1 pages"`, `"t1Depth": "T1 average depth"`, `"noEditorial": "No editorial links in"`, `"lost": "{count, plural, one {# editorial link} other {# editorial links}} lost to {tiers} pages"`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/src/lib/internal-links/context-stats.ts apps/web/src/lib/internal-links/context-stats.test.ts apps/web/messages/en.json
git commit -m "Internal links: two line header with the crawl picker, the context line and tab badges"
```

Compare with the mock at `?data=sample` at 1440, 1024 and 390 px: the two lines, the badge text, the sideways scroll.

---

### Task 13: The Changes tab

**Files:**
- Create: `apps/web/src/features/internal-links/changes/changes-tab.tsx`, `changes-strip.tsx`, `alert-banner.tsx`, `lost-links-panel.tsx`, `new-links-panel.tsx`, `moved-pages-panel.tsx`, `offset-paging.ts` and a test for each; `apps/web/src/features/internal-links/changes/index.ts`
- Modify: `apps/web/src/features/internal-links/tabs.ts` (the entry), `url-state.ts` (`cs`), `apps/web/messages/en.json` (`internalLinks.changes`)

**Read first:** mock `il-changes.js` (the whole file), `features/internal-links/pages/pages-tab.tsx` (the `DataTable` props, empty and error states, `registerExport`), `crawl-states.tsx` (how a pending or failed crawl is shown), `lib/internal-links/changes-format.ts` and `queries.ts` (Tasks 8 and 11), spec 7.10 "Changes tab".

- [ ] **Step 1: Failing tests**

`offset-paging.test.ts` pins the pure paging state used by the three tables: `nextOffset(offset, limit, total)` returns `offset + limit` while it is below `total` and `null` after; `previousOffset(offset, limit)` returns `Math.max(0, offset - limit)` or `null` at 0; `rangeOf(offset, count, total)` returns `{ from, to }` with `from = offset + 1` and `to = offset + count` (and `{ from: 0, to: 0 }` for none).

`changes-tab.test.tsx` (use the harness of plan 03, `src/test/internal-links-harness.tsx`, and the MSW world of Task 9) asserts, with the mock crawl:

- the strip reads "Editorial links lost 5", "Editorial links added 2", "Lost to T1 and T2 pages N" in negative tone, "Pages added 1", all "since 7 Nov";
- the alert banner says "N editorial links to T1 and T2 pages were lost since 7 Nov." and "Alert shown in the app", with a "Change alert rules" button that opens the alert settings (Task 14);
- the Lost links table lists T1 targets first with the Priority badge ("Lost to T1", "Lost to T2", "Lower priority") and "Still linked from Navigation" or "No longer linked"; its menu "Show" switches between "Only T1 and T2 targets" and "All lost links" and the table follows; "Links" switches Editorial and All;
- the New links table and the "Pages that moved most" table show their rows, with "+2" in positive tone and a depth increase in negative tone, and "No longer reachable" for `depth_state: 'lost'`;
- a first crawl shows "This is the first crawl." and "Changes appear after the next crawl."; a `pending` summary shows skeleton tables with "Working out what changed"; an `unavailable` one shows "Changes could not be worked out for this crawl";
- a crawl whose links were dropped shows the empty state of Task 12;
- the keyboard order is strip, banner button, each table's controls, rows.

- [ ] **Step 2: Implement**

`offset-paging.ts`:

```ts
export const nextOffset = (offset: number, limit: number, total: number): number | null =>
  offset + limit < total ? offset + limit : null;

export const previousOffset = (offset: number, limit: number): number | null =>
  offset > 0 ? Math.max(0, offset - limit) : null;

export const rangeOf = (offset: number, count: number, total: number): { from: number; to: number; total: number } =>
  count === 0 ? { from: 0, to: 0, total } : { from: offset + 1, to: offset + count, total };
```

`changes-strip.tsx` renders the house `MetricStrip` (read `components/app/metric-strip` for its props: items with label, value, sub and tone) with the four metrics of the mock, `aria-label` "Changes since the last crawl". `alert-banner.tsx` is a `role="status"` box with the warning icon, the two lines of text and the "Change alert rules" button; the delivery line is `internalLinks.changes.delivery.shown_in_app` ("Alert shown in the app") or `channel_unavailable` ("Alert shown in the app. Email and Slack need the alerts service."). `lost-links-panel.tsx`, `new-links-panel.tsx` and `moved-pages-panel.tsx` are `DataTable`s in the form of `page-columns.tsx`: `col.keyword` for the page columns (path with the title below, a button opening the inspector through `context.inspect.open(url_id)`), `TierBadge` columns, a text column for the anchor in quotes, a text column for the link type (`placement` word from `linkCanvas.placement`), the Priority `Badge` (`tone` from `priorityTone`), and the "Still linked" cell. Each has a panel head with the title and a one line meta text from the mock, its controls (`Menu` for Links and Show) and a `server` offset paging block using `offset-paging.ts` and the `changeLinksQuery`. `changes-tab.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';

import { AlertBanner } from './alert-banner';
import { ChangesStrip } from './changes-strip';
import { LostLinksPanel } from './lost-links-panel';
import { MovedPagesPanel } from './moved-pages-panel';
import { NewLinksPanel } from './new-links-panel';
import type { LinksTabContext } from '../tabs';
import { changeLinksPath, changesSummaryQuery } from '@/lib/internal-links/queries';
import { downloadCsvFrom } from '@/lib/internal-links/download';
import { sinceText } from '@/lib/internal-links/changes-format';

export function ChangesTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.changes');
  const scope = { workspaceId: context.workspaceId, projectId: context.projectId };
  const summary = useQuery(changesSummaryQuery(scope, context.run));
  const [only, setOnly] = useState<'top' | 'all' | null>(null);
  const { registerExport } = context;
  const since = sinceText(summary.data?.data.previous_finished_at ?? null, context.timeZone);

  // The tab exports the lost links as CSV (the Export menu's "Export this tab")
  useEffect(() => {
    registerExport(() =>
      downloadCsvFrom(changeLinksPath(scope), {
        change: 'lost',
        link_scope: context.state.changesScope,
        only: only ?? 'all',
        format: 'csv',
        ...(context.run === null ? {} : { run: context.run }),
      }, 'internal-links-lost-links.csv'),
    );
    return () => registerExport(null);
  }, [registerExport, scope.workspaceId, scope.projectId, context.run, context.state.changesScope, only]);

  if (summary.isPending) return <ChangesSkeleton label={t('loading')} />;
  if (summary.isError) return <ChangesError onRetry={() => void summary.refetch()} />;
  const data = summary.data.data;
  if (data.state === 'first_crawl') return <FirstCrawl />;
  if (data.state === 'pending') return <ChangesSkeleton label={t('pending')} />;
  if (data.state === 'unavailable') return <ChangesUnavailable />;
  const top = data.lost_to_top > 0;
  const shown = only ?? (top ? 'top' : 'all');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {data.alert === null ? null : <AlertBanner alert={data.alert} since={since ?? ''} onChangeRules={context.openAlertSettings} />}
      <ChangesStrip summary={data} since={since ?? ''} />
      <LostLinksPanel context={context} summary={data} only={shown} onOnlyChange={setOnly} since={since ?? ''} />
      <NewLinksPanel context={context} since={since ?? ''} />
      <MovedPagesPanel context={context} since={since ?? ''} />
    </div>
  );
}
```

Write the small helpers it names in the same task: `ChangesSkeleton` (table skeletons with the `sr-only` label), `ChangesError` (the house error state with Retry), `FirstCrawl`, `ChangesUnavailable` (empty states, copy from the keys below), `downloadCsvFrom(path, query, filename)` in `lib/internal-links/download.ts` (the CSV download function plan 03 Task 5 built for Pages and Links: reuse it if it has this shape, else add this wrapper around it), and `context.openAlertSettings` (a callback the screen provides in Task 14; until then a no-op). The `LinksTabContext` in `tabs.ts` gains `run: string | null` (Task 12) and `openAlertSettings: () => void`. Register the entry in `tabs.ts`: `{ id: 'changes', label: (t) => t('tabs.changes'), render: (context) => createElement(ChangesTab, { context }) }`; the tab badge of Task 12 shows the alert count (`summary.alert?.lost_links`, read by the screen from the same query).

- [ ] **Step 3: Messages, run, gate, commit**

`internalLinks.changes`: `"loading": "Loading changes"`, `"pending": "Working out what changed"`, `"firstTitle": "This is the first crawl."`, `"firstText": "Changes appear after the next crawl."`, `"unavailableTitle": "Changes could not be worked out for this crawl"`, `"unavailableText": "The crawl is still complete. Crawl again to compare."`, `"strip": { "label": "Changes since the last crawl", "lost": "Editorial links lost", "added": "Editorial links added", "lostTop": "Lost to {tiers} pages", "pagesAdded": "Pages added", "since": "since {date}", "sinceEditorial": "editorial links, since {date}" }`, `"alert": "{count, plural, one {# editorial link} other {# editorial links}} to {tiers} pages {count, plural, one {was} other {were}} lost since {date}."`, `"delivery": { "shown_in_app": "Alert shown in the app", "channel_unavailable": "Alert shown in the app. Email and Slack need the alerts service." }`, `"changeRules": "Change alert rules"`, `"lostTitle": "Lost links"`, `"lostMeta": "{kind} the crawl of {date} had and this crawl no longer finds, one row per source and target page."`, `"addedTitle": "New links"`, `"addedMeta": "{kind} this crawl found that the crawl of {date} did not have, one row per source and target page."`, `"movedTitle": "Pages that moved most"`, `"movedMeta": "The live pages whose editorial links in or click depth changed most since {date}."`, `"kindEditorial": "Editorial links"`, `"kindAll": "Links"`, `"links": "Links"`, `"show": "Show"`, `"showTop": "Only {tiers} targets"`, `"showAll": "All lost links"`, `"showAllButton": "Show all lost links"`, `"emptyLost": "No {kind} were lost: every one from the last crawl is still there."`, `"emptyLostTop": "No lost link points to {tiers} pages. The links that were lost went to lower tiers."`, `"emptyAdded": "No {kind} were added: this crawl found nothing new."`, `"emptyMoved": "No page moved: editorial links in and click depth are the same as in the last crawl."`, `"priority": { "lost_to_t1": "Lost to T1", "lost_to_t2": "Lost to T2", "lower": "Lower priority", "stillInMenu": "still in menu" }`, `"stillLinked": "Still linked from {placement}"`, `"noLonger": "No longer linked"`, `"unreachable": "No longer reachable"`, `"reachable": "Now reachable"`, and the column headers `columns.source`, `sourceTier`, `target`, `targetTier`, `anchor`, `linkType`, `priority`, `stillLinked`, `page`, `tier`, `editorialIn`, `depth`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/src/lib/internal-links/download.ts apps/web/messages/en.json
git commit -m "Internal links: the Changes tab with lost and new links, the alert and the pages that moved most"
```

---

### Task 14: Alert settings

**Files:**
- Create: `apps/web/src/features/internal-links/settings/alert-settings.tsx` (+ test)
- Modify: plan 03's crawl settings dialog and the project "Internal links" settings section (Task 14 of plan 03: `settings/internal-links-settings.tsx` and the dialog the screen opens), `internal-links-screen.tsx` (`openAlertSettings`), `apps/web/messages/en.json` (`internalLinks.alerts`)

**Read first:** mock `il-dialogs.js` and `il-settings.js` (the alert rules fields), plan 03 Task 14 (how the schedule, JavaScript and subdomains settings are saved), `lib/internal-links/mutations.ts` (`updateSettingsMutation`), spec 7.10 "Alert rules".

- [ ] **Step 1: Failing test**

`alert-settings.test.tsx`: renders the form with `alerts = { enabled: true, max_position: 2, threshold: 1, channel: 'app' }` and asserts the switch "Alert me when links to important pages are lost", the "Important pages" select showing "T1 and T2" with "T1 only" as the other offered value, the threshold number field with "1" (the field refuses 0 and 51 with "Enter a number from 1 to 50."), the channel select offering "In the app" and listing "Email" and "Slack" disabled with the reason "Available when the alerts service ships"; saving sends one `PATCH settings` with `{ internal_links: { alerts: { enabled, max_position, threshold, channel } } }` (only the changed members), shows a success toast and keeps the form values; a 422 from the server shows its message under the form; a viewer (no `projects:write`) sees the values as text with no Save.

- [ ] **Step 2: Implement**

`AlertSettings` takes `{ scope: LinksScope; value: AlertSettings; canEdit: boolean; onSaved?: () => void }`. It holds the draft in `useState`, validates the threshold with a pure `checkThreshold(text): string | null` exported from the same file (and tested), builds the patch from the members that changed, and calls `useMutation(updateSettingsMutation)`; on success it invalidates `linkSettingsQuery`, `changesSummaryQuery` and the crawl keys (`internalLinksKeys(scope)`). Use the house form components (read `components/ui/switch.tsx`, `select.tsx`, `number-field` or `input.tsx` as plan 03 Task 14 did for the schedule select) and the house toast. Put the form in both places: a section "Alerts" in the project's Internal links settings, and the body of the dialog the Changes tab opens through `openAlertSettings` (the screen owns `const [alertsOpen, setAlertsOpen]`; the dialog uses the house `Dialog` of `components/ui/dialog.tsx` with the title "Alert rules" and Close).

- [ ] **Step 3: Messages, run, gate, commit**

`internalLinks.alerts`: `"title": "Alert rules"`, `"section": "Alerts"`, `"enabled": "Alert me when links to important pages are lost"`, `"important": "Important pages"`, `"t1": "T1 only"`, `"t1t2": "T1 and T2"`, `"tiersTo": "T1 to T{count}"`, `"threshold": "Lost links that raise an alert"`, `"thresholdHint": "From 1 to 50."`, `"thresholdError": "Enter a number from 1 to 50."`, `"channel": "Channel"`, `"app": "In the app"`, `"email": "Email"`, `"slack": "Slack"`, `"unavailable": "Available when the alerts service ships"`, `"save": "Save"`, `"saved": "Alert rules saved"`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links/settings && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/messages/en.json
git commit -m "Internal links: alert rules in the crawl settings and the project settings"
```

---

### Task 15: Pages tab: rank, citation, anchor and change columns, the new flag and worklists, and suggested tiers

**Files:**
- Modify: `apps/web/src/features/internal-links/pages/page-columns.tsx`, `pages-tab.tsx`, `worklist-chips.tsx`, `page-filters.ts`, their tests, `apps/web/src/lib/internal-links/page-flags.ts` (+ test)
- Create: `apps/web/src/features/internal-links/pages/tier-suggestions.tsx` (+ test)
- Modify: `apps/web/messages/en.json` (`internalLinks.columns`, `.flags`, `.worklists`, `.suggestions`)

**Read first:** mock `il-pages.js` (`COLUMNS`, the Change and rank cells, the suggestions popover), `il-model.js` (`WORKLISTS`, `flags`), `pages/page-columns.tsx` and `pages-tab.tsx` (the column chooser, `REQUIRED_COLUMNS`, `columnState`), `lib/internal-links/queries.ts` (`moreIncludes`, `PageQuery.include`).

- [ ] **Step 1: Failing tests**

Extend `page-columns.test.tsx` with these cases using a `PageRow` that has `extras` filled:

- the Change column (visible by default) shows "+2" in positive tone, "-3" in negative, nothing for 0, "New" for `is_new`, and "n/a" with the tooltip "No earlier crawl" for a row without `extras.change`;
- hidden by default and in the chooser: "Link strength change" (points, `formatDelta(…, 'points')`; decision P1), "Tracked keywords" (the `tracked` count), "Average rank" (`average_rank`, one decimal; "n/a" without), "AI citations" (the `total` with the tooltip "ChatGPT 14, Gemini 9, AI Mode 6, last 28 days, today's numbers"), "Anchors" (`distinct` and `generic_share` as "4 anchors, 25% generic"), "Anchor matches keyword" ("Yes", "No" or "No keywords"), and "Clicks" and "Impressions" from `extras.gsc` (labelled "Google data, last 28 days"; `not_connected` shows "Not connected", `pending` "Syncing");
- `pageFlags` (the pure function of `page-flags.ts`) now maps the API flag `generic_anchors` to the label "Mostly generic anchors" with warning tone;
- the sort of the Change column maps to `change` and `-change` (`SORT_FIELD.change = 'change'`) and the other new columns are not sortable.

Extend `pages-tab.test.tsx`: with the Change column visible the request carries `include=changes`; turning on "Average rank" adds `keywords` and "AI citations" adds `citations` (`moreIncludes` of the visible columns); the two new worklist chips "Lost links to T1 and T2" and "T1 pages linking out to weak pages" show their counts from `worklists` and set `view` in the address; choosing "Mostly generic anchors" in the flag filter sends `filter[flags]=generic_anchors`.

`tier-suggestions.test.tsx`: the chip "Suggested tiers 2" (only when the list is not empty) opens a popover table with page, from tier, to tier badges, the reasons in words ("1,810 clicks in 28 days", "ranks #5 for 'soc vs mdr' (2,400 searches)"), and Accept and Dismiss per row and "Accept all"; Accept calls `POST tier-suggestions/accept` with `{ url_ids: [id] }`, Accept all with `{ all: true }`, Dismiss calls `.../dismiss`; each success invalidates the pages, flow and suggestions queries (the tier column updates), shows a toast ("1 page moved to T2"), and the row leaves the list; with `gsc_state: 'not_connected'` the popover says "Search Console is not connected, so only tracked keyword ranks are used." and a viewer sees the rows without the buttons.

- [ ] **Step 2: Implement the columns**

In `page-columns.tsx` add, in the `all` array after the existing optional columns, columns built with the `custom` helper and `col.count` as the existing ones are (read their definitions: each has `id`, `type`, `header`, `cell`, `priority`, `defaultVisible`), with ids `change`, `equityChange`, `keywords`, `rank`, `citations`, `anchors`, `matches`, `clicks`, `impressions`; only `change` has `defaultVisible: true`. A cell reads `row.extras?.<part>`; while the part was not requested (`extras === null`) it shows nothing, and the Pages tab asks for the parts of the visible columns so that cannot last. Write the cell helpers as small pure functions in a new `page-extras-cells.tsx` next to the columns (each returns a `ReactNode`; test them in `page-columns.test.tsx`). In `pages-tab.tsx`, compute `include` with `moreIncludes(visibleColumnIds)` and put it in the `PageQuery`; the query key includes it, so changing the chooser refetches the current page once.

`page-flags.ts`: add `generic_anchors` to the flag table (label key `flags.generic_anchors`, tone `warning`) and to the type of `RowFlag` it maps. `page-filters.ts`: the flag filter offers it. `worklist-chips.tsx`: add the two chips in the order of the mock (after Links to non-indexable pages) with the counts `worklists.lost_links_top` and `worklists.weak_outlinks`; the first chip's label is "Lost links to {tiers}" with `tiers` from the alert setting (`alertTierText(max_position)`, read from the settings query the header already holds).

- [ ] **Step 3: Tier suggestions**

`tier-suggestions.tsx`: a chip (`Button variant="secondary" size="sm"`) with the count that opens a `Popover` (read `components/ui/popover.tsx`) holding a compact table (`role="table"` through the house table primitives; this is a bounded list of at most a few dozen rows, so it is not a `DataTable`) and the actions; uses `tierSuggestionsQuery`, `acceptSuggestionsMutation`, `dismissSuggestionsMutation`, `reasonText` and `TierBadge`. Mount it in the issues row of `pages-tab.tsx` after the worklist chips.

- [ ] **Step 4: Messages, run, gate, commit**

`internalLinks.columns` gains `change`, `equityChange` ("Link strength change"), `keywords`, `rank`, `citations`, `anchors`, `matches`, `clicks`, `impressions` with their tooltips; `internalLinks.flags.generic_anchors`: "Mostly generic anchors"; `internalLinks.worklists.lost_links_top`: "Lost links to {tiers}", `.weak_outlinks`: "T1 pages linking out to weak pages"; `internalLinks.suggestions`: `"chip": "Suggested tiers"`, `"title": "Suggested tiers"`, `"intro": "Pages that earn clicks or rank well but sit in a lower tier. Nothing changes until you accept."`, `"from": "Now"`, `"to": "Suggested"`, `"why": "Why"`, `"accept": "Accept"`, `"dismiss": "Dismiss"`, `"acceptAll": "Accept all"`, `"clicks": "{count} clicks in 28 days"`, `"rank": "ranks #{rank} for '{keyword}' ({volume} searches)"`, `"moved": "{count, plural, one {# page} other {# pages}} moved"`, `"gscOff": "Search Console is not connected, so only tracked keyword ranks are used."`, `"none": "No suggestions."`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/src/lib/internal-links apps/web/messages/en.json
git commit -m "Internal links: rank, citation, anchor and change columns, the generic anchor flag, two worklists and suggested tiers"
```

---

### Task 16: Inspector additions

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/extras-sections.tsx` (+ test)
- Modify: the page inspector of plan 03 Task 9 (`features/internal-links/inspector/page-inspector.tsx` or the file that Task built), its test, `apps/web/messages/en.json` (`internalLinks.inspectorExtras`)

**Read first:** mock `il-drawer.js` (the four sections), plan 03 Task 9 (the inspector's structure and how its sections are built), `lib/internal-links/changes-format.ts`.

- [ ] **Step 1: Failing test**

`extras-sections.test.tsx` renders `ExtrasSections` with a `PageDetailExtras` and asserts:

- "Changes since the last crawl": editorial links in change ("+2" positive), the link strength change in points, the depth change ("1 level deeper", "No longer reachable", "Now reachable"), or "New page" for `is_new`; the section is absent when `extras.change` is null (the crawl has no earlier one);
- "Tracked keywords" (labelled "idraft rank tracking"): a small table keyword, rank ("n/a" without), places moved (up arrow and a number, positive tone; down, negative), volume; "No tracked keywords for this page." when empty;
- "AI citations": the three engines with their counts and "last 28 days" and the total; a line "Cited in 0 answers" when all are 0;
- "Anchor text pointing here": the top anchors with the count and a "Generic" badge, "N distinct, X% generic", and "An anchor contains a tracked keyword" or "No anchor contains a tracked keyword" or nothing when `matches_keyword` is null;
- Google data (`gsc`) shows "Clicks 1,320, impressions 28,400, last 28 days (Google data)" or "Search Console is not connected." or "Search Console is syncing."

- [ ] **Step 2: Implement**

`extras-sections.tsx` exports `ExtrasSections({ extras }: { extras: PageDetailExtras }): ReactElement` returning the sections as `<section aria-labelledby>`s with `h3` titles in the style of the inspector's existing sections (read one section of the Task 9 inspector and copy its wrapper component, for example a `Section` from `components/app/inspector`). Render it in the page inspector after "Linking pages by tier and by placement" and before the capped tables of linking pages and outlinks, as the mock orders them.

- [ ] **Step 3: Messages, run, gate, commit**

`internalLinks.inspectorExtras`: `"changes": "Changes since the last crawl"`, `"new": "New page"`, `"editorialIn": "Editorial links in"`, `"strength": "Link strength"`, `"depth": "Click depth"`, `"deeper": "{count, plural, one {# level deeper} other {# levels deeper}}"`, `"shallower": "{count, plural, one {# level shallower} other {# levels shallower}}"`, `"keywords": "Tracked keywords"`, `"keywordsSource": "idraft rank tracking"`, `"noKeywords": "No tracked keywords for this page."`, `"rank": "Rank"`, `"moved": "Places moved"`, `"volume": "Searches a month"`, `"citations": "AI citations"`, `"citationsSub": "Answers that cited this page, last 28 days (today's numbers)"`, `"chatgpt": "ChatGPT"`, `"gemini": "Gemini"`, `"aiMode": "AI Mode"`, `"cited": "{count, plural, one {Cited in # answer} other {Cited in # answers}}"`, `"anchors": "Anchor text pointing here"`, `"generic": "Generic"`, `"anchorSummary": "{distinct} distinct, {share}% generic"`, `"matches": "An anchor contains a tracked keyword"`, `"noMatch": "No anchor contains a tracked keyword"`, `"gsc": "Google Search Console"`, `"gscOk": "{clicks} clicks, {impressions} impressions, last 28 days (Google data)"`, `"gscOff": "Search Console is not connected."`, `"gscPending": "Search Console is syncing."`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links/inspector && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/messages/en.json
git commit -m "Internal links: changes, tracked keywords, AI citations and anchor text in the page inspector"
```

---

### Task 17: The Opportunities tab

**Files:**
- Create: `apps/web/src/features/internal-links/opportunities/opportunities-tab.tsx`, `opportunity-columns.tsx`, `mention-text.tsx`, `copy-instruction.ts` (+ tests)
- Modify: `tabs.ts`, `url-state.ts` (already has `os`, `ot`, `oq`), `apps/web/messages/en.json` (`internalLinks.opportunities`)

**Read first:** mock `il-opps.js` (the whole file), plan 03 Task 8 (the bulk bar and row selection of the Pages table), `pages-tab.tsx`, `lib/internal-links/mutations.ts` (`decideOpportunitiesMutation`), the house toast and clipboard helpers (`lib/clipboard`).

- [ ] **Step 1: Failing tests**

`copy-instruction.test.ts`: `instruction(row)` returns `On https://eventussecurity.com/blog/siem-use-cases link the words "incident response retainer" to https://eventussecurity.com/services/incident-response.` (from `row.source.url`, `row.phrase`, `row.target.url`).

`mention-text.test.tsx`: `MentionText` marks the phrase in its sentence with a `<mark>`-styled span, found without regard to case, and shows the phrase first when it is not in the sentence.

`opportunities-tab.test.tsx` (harness and MSW world of Tasks 9 and 10):

- the table shows Source page and tier, the mention in its sentence with the phrase highlighted, target page and tier, the suggested anchor in quotes, status, and actions Accept, Dismiss and a copy button named "Copy instruction for /blog/siem-use-cases";
- the status chips All, Open, Accepted, Dismissed carry their counts (`meta.counts`) and set `os`; the target tier select sets `ot`; the search sets `oq` (debounced as the Pages search is: `search-draft.ts`);
- Accept calls `PUT opportunities/decisions` with `{ items: [{ source_url_id, target_url_id }], status: 'accepted' }`, the row's status becomes "Accepted" with Undo, and a toast says "Planned: add a link on /blog/siem-use-cases to /services/incident-response" with focus staying on the row's action (focus restore as the mock does); Undo sends `status: 'open'`;
- selecting rows shows the bulk bar "2 opportunities selected" with Accept, Dismiss and "Clear selection", and a bulk accept sends one request with both pairs;
- "Planned fixes" downloads `opportunities?export=planned` as `internal-links-planned-fixes.csv`, and says "Nothing to export" when the API's CSV has no rows;
- empty states: "No opportunities" ("Every mention of an important page already links to it."), "No open opportunities" with "Show all", "No opportunities match" with "Clear filters";
- a viewer sees no Accept or Dismiss, only the rows and Copy.

- [ ] **Step 2: Implement**

`copy-instruction.ts`:

```ts
import type { Opportunity } from '@/lib/internal-links/types';

/** What the copy button puts on the clipboard (mock `instruction`). */
export const instruction = (row: Pick<Opportunity, 'source' | 'target' | 'phrase'>): string =>
  `On ${row.source.url} link the words "${row.phrase}" to ${row.target.url}.`;
```

`mention-text.tsx`:

```tsx
import type { ReactElement } from 'react';

/** The context sentence with the phrase marked; the phrase is found without regard to case (mock `mention`). */
export function MentionText({ context, phrase }: { context: string; phrase: string }): ReactElement {
  const at = context.toLowerCase().indexOf(phrase.toLowerCase());
  const mark = 'rounded-sm bg-primary-subtle px-0.5 type-body-strong text-foreground';
  if (at < 0) {
    return (
      <p className="type-meta text-foreground-secondary">
        <span className={mark}>{phrase}</span> {context}
      </p>
    );
  }
  return (
    <p className="type-meta text-foreground-secondary">
      {context.slice(0, at)}
      <span className={mark}>{context.slice(at, at + phrase.length)}</span>
      {context.slice(at + phrase.length)}
    </p>
  );
}
```

`opportunity-columns.tsx` builds the `DataTableColumn<Opportunity>` array in the style of `page-columns.tsx` (selection column handled by the `DataTable`'s selection feature as plan 03 Task 8 used it; read how). `opportunities-tab.tsx` holds: the status chips (`aria-pressed`), the toolbar (search, count text "5 opportunities" or "2 of 5 opportunities", target tier `Select`, the Planned fixes button), the bulk bar, the table with `server` offset paging (Task 13's `offset-paging.ts`), the mutations with optimistic status, and the empty states. Focus handling: after Accept, Dismiss or Undo on a row, focus goes to the same row's first action button, or to the nearest row when the row left the filtered list, or to the search box when the list is empty (the mock's `applyRestore`); implement with a `useRef` of the last acted key and an effect on `data`. Register the tab entry in `tabs.ts`; the tab badge of Task 12 shows `meta.counts.open`.

- [ ] **Step 3: Messages, run, gate, commit**

`internalLinks.opportunities`: `"caption": "Link opportunities"`, `"one": "opportunity"`, `"other": "opportunities"`, `"search": "Search source or target"`, `"targetTier": "Target tier"`, `"all": "All"`, `"status": { "all": "All", "open": "Open", "accepted": "Accepted", "dismissed": "Dismissed" }`, `"planned": "Planned fixes"`, `"plannedTip": "Download the accepted opportunities as CSV, or every open one when nothing is accepted yet"`, `"nothingToExport": "Nothing to export"`, `"nothingToExportText": "There are no accepted or open opportunities."`, `"accept": "Accept"`, `"dismiss": "Dismiss"`, `"undo": "Undo"`, `"copy": "Copy instruction for {path}"`, `"copied": "Instruction copied"`, `"selected": "{count, plural, one {# opportunity selected} other {# opportunities selected}}"`, `"clear": "Clear selection"`, `"plannedToast": "Planned"`, `"plannedText": "Add a link on {from} to {to}"`, `"dismissedToast": "Dismissed"`, `"reopened": "Reopened"`, `"emptyTitle": "No opportunities"`, `"emptyText": "Every mention of an important page already links to it."`, `"noOpenTitle": "No open opportunities"`, `"noOpenText": "Every open opportunity has been accepted or dismissed. Choose All to review those decisions."`, `"showAll": "Show all"`, `"noMatchTitle": "No opportunities match"`, `"noMatchText": "Nothing matches this search, status and target tier. Clear the filters to see every opportunity."`, `"clearFilters": "Clear filters"`, and the column headers `source`, `sourceTier`, `mentions`, `target`, `targetTier`, `anchor`, `statusHeader`, `actions`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links/opportunities && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/messages/en.json
git commit -m "Internal links: the Opportunities tab with accept, dismiss, undo, bulk actions, copy and planned fixes"
```

---

### Task 18: The Path finder

**Files:**
- Create: `apps/web/src/features/internal-links/journey/path-finder.tsx`, `route-chain.tsx` (+ tests)
- Modify: the Journey tab of plan 03 Task 11 (`features/internal-links/journey/journey-tab.tsx`): the view switch gains Path finder, the page picker label, `apps/web/messages/en.json` (`internalLinks.paths`)

**Read first:** mock `il-journey.js` (the path view: search `paths`, `pathTarget`, `routeChain`), `il-model.js` (`findPaths`), the Journey tab of plan 03 Task 11 (the toolbar, the focus picker, the view switch Canvas | Tree list), `lib/internal-links/route-format.ts` (Task 11), spec 7.10 "Path finder".

- [ ] **Step 1: Failing tests**

`route-chain.test.tsx`: `RouteChain` renders an ordered list (`role="list"`) of step cards; each card shows the path, a `TierBadge`, the status badge when not 200, and between two cards the link used as "linked as 'SOC as a service'" with the link scope word ("menu and footer", "auto-generated", none for editorial) and "301 redirect" for a redirect step; the first card is labelled "Home page"; the last is the target and carries `aria-current="step"`; its heading says "N clicks" ("0 clicks" for the home page itself).

`path-finder.test.tsx`: with the mock routes, shows two chains titled "Over any link" and "Over editorial links only"; when the editorial route is longer, the sentence "Menus make this page 2 clicks closer than the editorial links do."; when `editorial` is null, "No editorial links lead here from the home page. It is reached only through menus or auto-generated links."; when both are null "This page cannot be reached from the home page."; "Open in canvas" calls `openJourney(urlId)` and switches the view to canvas (`jv` removed); the page picker is labelled "Find the way to" in this view and "Focus page" in the others and there is exactly one picker; the Path finder is reached from the view switch and from the address `jv=paths`.

- [ ] **Step 2: Implement**

`route-chain.tsx`:

```tsx
'use client';

import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import type { Route } from '@/lib/internal-links/types';

/** One route from the home page as a chain of step cards with the link used between them (spec 7.10). */
export function RouteChain({ title, route }: { title: string; route: Route }): ReactElement {
  const t = useTranslations('internalLinks.paths');
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h3 className="type-subsection-title">
        {title} <span className="num type-meta text-foreground-secondary">{t('clicks', { count: route.clicks })}</span>
      </h3>
      <ol className="flex flex-col gap-1">
        {route.steps.map((step, index) => {
          const last = index === route.steps.length - 1;
          return (
            <li key={step.page.url_id} className="flex flex-col gap-1">
              {step.anchor === null ? null : (
                <p className="flex items-center gap-1.5 ps-4 type-meta text-foreground-secondary">
                  <ArrowDown className="size-icon-sm text-foreground-tertiary" aria-hidden="true" />
                  {step.via_redirect
                    ? t('redirect')
                    : t('linkedAs', { anchor: step.anchor })}
                  {step.scope === null || step.scope === 'editorial' ? null : (
                    <span className="text-foreground-tertiary">{t(`scope.${step.scope}`)}</span>
                  )}
                </p>
              )}
              <div
                aria-current={last ? 'step' : undefined}
                className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate type-table text-foreground">{step.page.path}</span>
                {index === 0 ? <Badge tone="neutral">{t('home')}</Badge> : null}
                <TierBadge tier={step.page.tier} />
                {step.status_code !== null && step.status_code !== 200 ? (
                  <Badge tone={step.status_code >= 400 ? 'negative' : 'warning'}>{String(step.status_code)}</Badge>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

`path-finder.tsx` reads `routesQuery(scope, urlId, run)` for the focus page (the one page picker of the Journey toolbar), renders the two chains and the sentence from `closerNote`, and the "Open in canvas" button. In the Journey tab, add `paths` to the view switch (Canvas, Tree list, Path finder), render `PathFinder` for `jv=paths`, and give the toolbar's picker the label from the view (`t(view === 'paths' ? 'paths.pickerLabel' : 'journey.focusPage')`). Remove the layout switch and the lane chips in this view.

- [ ] **Step 3: Messages, run, gate, commit**

`internalLinks.paths`: `"pickerLabel": "Find the way to"`, `"any": "Over any link"`, `"editorial": "Over editorial links only"`, `"clicks": "{count, plural, one {# click} other {# clicks}}"`, `"home": "Home page"`, `"linkedAs": "linked as '{anchor}'"`, `"redirect": "301 redirect"`, `"scope": { "auto_generated": "auto-generated", "template": "menu and footer" }`, `"menus": "Menus make this page {count, plural, one {# click} other {# clicks}} closer than the editorial links do."`, `"noEditorial": "No editorial links lead here from the home page. It is reached only through menus or auto-generated links."`, `"unreachable": "This page cannot be reached from the home page."`, `"openInCanvas": "Open in canvas"`, `"view": "Path finder"`.

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/messages/en.json
git commit -m "Internal links: the Path finder as a third Journey view"
```

---

### Task 19: The Links tab status menu, and the client summary

**Files:**
- Modify: the Links tab of plan 03 Task 10 (`features/internal-links/links/links-tab.tsx`, its columns), `url-state.ts` (`ls`: `active`, `lost`, `all`; add the key here), `crawl-header.tsx` (the Export menu entry)
- Create: `apps/web/src/features/internal-links/links/lost-links-table.tsx`, `apps/web/src/features/internal-links/export/client-summary-action.ts` (+ tests), `apps/web/messages/en.json` (`internalLinks.links`, `internalLinks.summary`)

**Read first:** mock `il-links.js` (First seen, Lost on, the Status menu), plan 03 Task 10 (the Links tab), `lib/internal-links/client-summary.ts` (Task 11), mock `il.js` `clientSummary`, decision D6 and D8 above.

- [ ] **Step 1: Failing tests**

`links-tab.test.tsx` additions: a "Status" menu with Active (default), "Lost since last crawl" and All, setting `ls` in the address; Active is the edges table with a new "Added" column showing "This crawl" for links that the crawl added (the rows of `changes/links?change=added&link_scope=all` limit 200 are fetched once and matched by `source>target`; a row not in that list shows nothing); Lost shows `lost-links-table` (Source page, Source tier, Target page, Target tier, Anchor, Placement, "Lost on" = the crawl date, Priority) from `changes/links?change=lost&link_scope=all`, with the count; All shows the Active table and below it the Lost table under its own heading; a crawl with no earlier crawl hides the Status menu and the Added column; a crawl whose links were dropped shows the Task 12 empty state.

`client-summary-action.test.ts`: `buildClientSummary(queryClient, scope, run, words)` reads the editorial tier flow, the worklists, the lost links to the important tiers (`only: 'top'`, `link_scope: 'editorial'`, limit 200) and the crawl, and returns the HTML of `clientSummaryHtml` with the right tables; with the MSW world it contains the host, "T1 Money pages", the worklist "Under-linked T1 pages" only when its count is above zero, and the lost links of the mock; running the action calls `download` once with the file name `internal-links-summary.html` and shows the toast "Client summary ready".

- [ ] **Step 2: Implement**

In the Links tab, add the Status menu to the toolbar (the same `Menu` select the Scope menu uses, `ScopeMenu`'s sibling `StatusMenu` in `links/status-menu.tsx`), the `Added` column to the columns array (`custom('added', 'badge', t('columns.added'), (row) => addedKeys.has(`${row.source.url_id}>${row.target.url_id}`) ? <Badge tone="positive">{t('thisCrawl')}</Badge> : null, { defaultVisible: true })`), and `lost-links-table.tsx` (a `DataTable<ChangeLink>` with offset paging). `client-summary-action.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';

import { clientSummaryHtml, downloadHtml, type SummaryWords } from '@/lib/internal-links/client-summary';
import { alertTierText } from '@/lib/internal-links/changes-format';
import { changeLinksQuery, changesSummaryQuery, tierFlowQuery, worklistsQuery } from '@/lib/internal-links/queries';
import type { CrawlRun, LinksScope } from '@/lib/internal-links/types';

/** Reads what the summary needs (it is all cached after a visit to the tabs) and makes the standalone page (decision D6). */
export async function buildClientSummary(
  client: QueryClient,
  scope: LinksScope,
  run: CrawlRun,
  host: string,
  words: SummaryWords,
): Promise<string> {
  const id = run.is_latest ? null : run.run_id;
  const [flow, lists, summary, lost] = await Promise.all([
    client.fetchQuery(tierFlowQuery(scope, 'editorial', id)),
    client.fetchQuery(worklistsQuery(scope, id)),
    client.fetchQuery(changesSummaryQuery(scope, id)),
    client.fetchQuery(changeLinksQuery(scope, { change: 'lost', linkScope: 'editorial', only: 'top', offset: 0, limit: 200 }, id)),
  ]);
  return clientSummaryHtml({
    host,
    crawl: run,
    flow: flow.data,
    worklists: lists.data,
    lost: lost.data,
    importantText: alertTierText(summary.data.important_max_position),
    words,
  });
}

export { downloadHtml };
```

(Adjust the field names to `clientSummaryHtml`'s input from Task 11; the test pins them.) The Export menu entry "Client summary (HTML)" in `crawl-header.tsx` runs `buildClientSummary`, then `downloadHtml(html, 'internal-links-summary.html')` and the toast; while it runs the entry reads "Preparing the summary" and is disabled.

- [ ] **Step 3: Messages, run, gate, commit**

`internalLinks.links`: `"status": "Status"`, `"active": "Active"`, `"lost": "Lost since last crawl"`, `"all": "All"`, `"added": "Added"`, `"thisCrawl": "This crawl"`, `"lostOn": "Lost on"`, `"lostTitle": "Lost links"`. `internalLinks.summary`: `"menu": "Client summary (HTML)"`, `"preparing": "Preparing the summary"`, `"ready": "Client summary ready"`, `"readyText": "Saved as internal-links-summary.html."`, and every text of the page (title "Internal links summary for {host}", "Crawl of {date}, {pages}", "Tiers", the column headers, "Links between tiers", "Editorial links, one per pair of pages. Rows link to columns.", "Open worklists", "No worklist has pages in this crawl.", "Lost editorial links to {tiers} pages", "No editorial links to {tiers} pages were lost since the last crawl.", "Link counts use editorial links.").

```bash
cd apps/web && pnpm exec vitest run src/features/internal-links src/lib/internal-links && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
git add apps/web/src/features/internal-links apps/web/src/lib/internal-links apps/web/messages/en.json
git commit -m "Internal links: Status menu and Added column on Links, and the client summary export"
```

---

### Task 20: States, Playwright, axe, parity and the final checks

**Files:**
- Create: `apps/web/e2e/internal-links-slices-2-3.spec.ts`, `apps/web/e2e/support/internal-links-slices-2-3.ts`
- Modify: the existing states test of plan 03 Task 16 (add the new tabs), the design-system preview if a new component needs an entry, `docs/design-system/25-component-inventory.md`

**Read first:** `apps/web/e2e/` (the flow of plan 03 Task 17: its support file, how it signs in, how axe is run in both themes), `docs/design-system/20-accessibility.md`, the parity table of this plan.

- [ ] **Step 1: States**

Extend plan 03's states test so each new tab renders, in both themes and both densities, and with the mock set to each of: loading (the request held), error (500), empty (no earlier crawl, no opportunities, no suggestions), first crawl, enrichment `pending`, enrichment `unavailable`, links dropped (410), Search Console `not_connected` and `pending`. Each state has its text and a Retry where the house error state has one.

- [ ] **Step 2: The Playwright flow**

`internal-links-slices-2-3.spec.ts`: sign in, open Internal links on the Eventus project with the mock API, and follow this flow (it is spec section 11's flow for slices 2 and 3):

1. The header shows two lines; open the crawl menu; choose the crawl of 7 Nov; the badge "Older crawl" and "Back to latest" show, the address has `run=`; Pages shows that crawl's counts; "Back to latest" clears it.
2. Open Changes: the alert banner says links to T1 and T2 pages were lost; "Show" switches to all lost links; the Priority badges and "Still linked from Navigation" show; open "Change alert rules", set the threshold to 3, save; the banner disappears; reset to 1.
3. Pages: turn on "Average rank" and "AI citations" in the chooser; the numbers show; open "Suggested tiers", accept one; its tier column becomes T2 and the Tier flow tab reflects it.
4. Opportunities: accept one (toast, status "Accepted"), copy the instruction (clipboard permission granted in the test), select two and dismiss them, "Planned fixes" downloads the CSV with the accepted row.
5. Journey: open a page, switch Layout to "By tier"; lanes T4 to T1 show with counts, "No T2 page in view" appears for an empty lane; turn the T4 chip off; open a card and see another opened card close; open the Info panel of a card; Shift-click two cards and "Show their links"; zoom with Ctrl and wheel; turn the map on; reload and see the same layout and lanes from the address.
6. Path finder: switch to Path finder; two chains show and the sentence about menus; "Open in canvas" returns to the canvas on that page.
7. Export, Client summary (HTML): a file named `internal-links-summary.html` downloads and contains the host.

Run axe on Changes, Opportunities, the Path finder, the By tier canvas, the suggestions popover and the alert dialog, in both themes, with no violations (the helper plan 03 Task 17 uses).

- [ ] **Step 3: Visual baselines**

Add baselines for Changes, Opportunities, the By tier canvas and the Path finder, light and dark, at 1440 px, with the date and any time-dependent text frozen as plan 03's baselines do.

- [ ] **Step 4: Parity against the mock**

Open the mock (`apps/web/design-preview/index.html#/internal-links?data=sample`) and the app side by side at 1440 and 390 px and tick every row of the "Mock to app map" table: layout, copy (apart from the decisions D1, D7, D8, D10 and open points P1 to P6), states, keyboard. Record any difference in a short list at the end of this plan under "As built"; fix those that are mistakes.

- [ ] **Step 5: Final checks**

```bash
git merge develop
pnpm install --frozen-lockfile
cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
pnpm exec playwright test e2e/internal-links-slices-2-3.spec.ts
grep -rnP "\x{2014}|\x{2013}" src/features/internal-links src/lib/internal-links src/components/app/link-canvas messages/en.json | head
```

Expected: every command passes and the last prints nothing (the copy has no em or en dash).

- [ ] **Step 6: Commit and hand over**

```bash
git add apps/web/e2e apps/web/src docs/design-system/25-component-inventory.md docs/superpowers/plans/2026-11-17-internal-links-05-web-slices-2-3.md
git commit -m "Internal links: states, Playwright flow, axe and visual baselines for slices 2 and 3"
```

The review hand-off is the same as plan 03 Task 18: an independent review on the Opus model of the diff of this plan, a keyboard and screen reader pass of the canvas (both layouts, both themes), and the owner's look on `develop` before release.

---

## Self-review

### Spec coverage (slices 2 and 3, web)

| Requirement | Task |
|---|---|
| Crawl history, crawl picker, "Older crawl", "Back to latest", tabs follow the crawl | 10, 12 |
| Two line page header and context line (spec 7.1, decided 2026-11-17) | 12 |
| Changes tab: strip, alert banner, lost links (T1 first, Priority, still linked), new links, pages that moved most | 11, 13 |
| Alert rules (on or off, important tiers, threshold, channel) | 14 |
| Pages columns: Change, equity change, tracked keywords, average rank, AI citations, anchors, anchor matches keyword, clicks | 15 |
| Flag "Mostly generic anchors"; worklists "Lost links to T1 and T2" and "T1 pages linking out to weak pages" | 15 |
| Tier suggestions with Accept, Dismiss, Accept all | 15 (rules and API are plan 04 Tasks 4 and 13) |
| Inspector: changes, tracked keywords, AI citations, anchor text | 16 |
| Opportunities: accept, dismiss, undo, bulk, copy instruction, planned fixes | 17 |
| Path finder: two routes, "menus make it closer", "Open in canvas", one picker | 11, 18 |
| Links tab: Status menu, Added and Lost | 19 |
| Client summary HTML | 11, 19 |
| Canvas: real pan and zoom, view controls, minimap off until turned on, first view rule | 1, 5 |
| Canvas: focus card stands out, back to focus, hover tools, info panel on demand, selection, move, legend and controls panel | 6 |
| Canvas: one journey at a time, growth keeps the place | 2, 7 |
| Canvas: By tier layout with lanes T4 to T1, one card per page, line colours, lane chips, switch next to the scope switch | 3, 4, 7 |
| Curves with dot and arrowhead, 112 px between columns | 4, 5 |
| MSW handlers for every new endpoint | 9 |
| Playwright, axe, visual baselines, parity | 20 |

Not built, by decision: React Flow and elkjs (D1); email and Slack alert channels (D7); a first-seen date across all crawls (D8); a sort by rank (P6).

### Placeholder scan

No "TBD" and no "similar to task N". Tasks 13 to 19 name components of plan 03 that were not built when this plan was written (the inspector, the Links tab, the settings screens, the bulk bar); each of those tasks has a "Read first" that points at the plan 03 task that builds them, and a dependency in the table. Where a house component's props are not known to this plan (`IconButton` variants, `Menu` item fields, `DataTable` selection), the task says which file to read and the tests pin the behaviour rather than the props.

### Type consistency

`View`, `Box`, `Size` (Task 1) are used by Tasks 5 to 7; `OpenSets`, `openExclusive`, `openTogether` (Task 2) by Task 7's Journey tab; `Lane`, `laneSet`, `placeOnce`, `direction`, `UNTIERED_LANE` (Task 3) by `tierLayout` (Task 7); `curvePath`, `tierRoute`, `directionLook`, `COLUMN_GAP` (Task 4) by Tasks 5 and 7; the API types of Task 8 are the generated ones, imported from `lib/internal-links/types.ts` only; `LinksTabContext.run` and `openAlertSettings` (Tasks 12 to 14) are added in `tabs.ts` once; `offset-paging.ts` (Task 13) is used by Tasks 13, 17 and 19.

### Assumptions not verified

- Plan 03's tasks 8 to 18 land before Tasks 12 to 19 here (the table says which task needs which).
- The generated client has the schema names of plan 04's contract table (Task 8 stops if one is missing).
- `IconButton` takes `aria-pressed`, `Menu` items take `checked`, and `DataTable` has the selection feature plan 03 Task 8 used (each task tells the executor to read the house component and gives tests that fail if a prop is wrong).
- `Intl.DateTimeFormat('en-GB', ...)` gives "7 Nov" in the project's time zone (the test pins it).
