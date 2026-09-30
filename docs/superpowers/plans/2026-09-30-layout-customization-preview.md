# Layout Customization (Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build delivery steps 1 to 4 of the [layout customization spec](../specs/2026-09-30-layout-customization-design.md): the tested layout logic, customize mode on the Overview and in the keyword drawer of the static preview, and the design-system document updates.

**Architecture:** The layout rules (catalog, sanitizing, resolution, row packing, the draft reducer) are pure TypeScript in `apps/web/src/lib/layouts/`, tested with Vitest. A build step strips the types and copies them into the preview as ES modules, so the preview runs the same code the tests cover. The preview UI is one new module, `design-preview/customize.js`, which moves real card nodes in and out of a grid and edits a draft through the reducer. Layouts persist in browser storage in the preview (the API of spec section 9 comes with the platform phase).

**Tech Stack:** TypeScript 6, Vitest 5, plain ES modules in the browser, Tailwind v4 token utilities, ECharts 6 (existing), pointer events for dragging (the app will use dnd-kit; the static preview has no bundler).

**Notes for the executor**

- `packages/contracts` does not exist yet. The pure logic lives in `apps/web/src/lib/layouts/` until it does; nothing in it imports React, the DOM or fetch, so moving it later is a file move.
- No `zod` dependency is added. Card options are enum-only in the first release, declared as data (`OptionDefinition`), which is enough to validate them and to render their form.
- This folder is not a git repository. "Commit" steps are replaced by running the checks (`npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `pnpm run preview`) and copying a backup of edited preview files to the session scratchpad before each structural edit to `index.html`.
- No em-dashes or en-dashes in any text. No hex colors or arbitrary Tailwind values in preview markup; sizes that depend on the viewport are set inline from script.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/web/src/lib/layouts/types.ts` | Types: `Width`, `ScreenKey`, `Channel`, `CardItem`, `NumberItem`, `LayoutDocument`, `OptionDefinition`, `CardTypeDefinition`, `NumberDefinition`, `ScreenDefinition`, `Capabilities` |
| `apps/web/src/lib/layouts/catalog.ts` | `LIMITS`, `ENGINES`, `CARD_TYPES`, `NUMBER_TYPES`, `SCREENS` (zones and built-in default per screen), lookups `cardType(key)`, `numberType(metric)` |
| `apps/web/src/lib/layouts/sanitize.ts` | `sanitizeLayout(raw, screen)`: the four rules of spec 6.3 plus shape repair |
| `apps/web/src/lib/layouts/resolve.ts` | `resolveLayout({ personal, team }, screen)`: personal, else team, else built-in |
| `apps/web/src/lib/layouts/availability.ts` | `cardAvailability(definition, capabilities)` |
| `apps/web/src/lib/layouts/rows.ts` | `spanOf(width, breakpoint)`, `packRows(cards, breakpoint)`, `trailingSpace(cards, breakpoint)` |
| `apps/web/src/lib/layouts/draft.ts` | Pure edit functions on a document and `changeCount(before, after)` |
| `apps/web/src/lib/layouts/index.ts` | Re-exports |
| `apps/web/src/lib/layouts/layouts.test.ts` | Tests for all of the above |
| `apps/web/design-preview/layouts-core.mjs` | Build step: transpile `src/lib/layouts/*.ts` to `design-preview/vendor/layouts/*.js` |
| `apps/web/design-preview/customize.js` | Preview UI: rendering from a layout, customize mode, catalog, options, save bar, storage, drawer |
| `apps/web/design-preview/index.html` | Overview cards become `data-card` nodes in a card bank; new card designs; catalog dialog, options popover and save bar markup |
| `apps/web/design-preview/interactions.js`, `charts.js` | Expose the helpers `customize.js` needs (`window.PreviewUI`, `PreviewCharts.refresh`) |

## Task 1: Types and catalog

**Files:** create `types.ts`, `catalog.ts`, `index.ts`, `layouts.test.ts`.

- [x] Write failing tests:
  - every card type's default width (first of `widths`) is one of the four widths; drawer-only types have no widths
  - every built-in default passes `sanitizeLayout` unchanged (added in Task 2) and references only known card types and metrics
  - `overview` built-in default is the eight cards of today's Overview in order, with widths `two_thirds, third, half, half, half, half, half, half`, and six numbers
  - card type keys and `metric + perEngine` pairs are unique
- [x] Run `npx vitest run src/lib/layouts` and see them fail (module not found).
- [x] Implement `types.ts` and `catalog.ts`:
  - `ENGINES = ['chatgpt_web', 'gemini_web', 'google_ai_mode', 'google_ai_overview']` with labels
  - `LIMITS = { cards: 12, numbers: 6 }`
  - the 14 dashboard card types of spec 7.1 and the 6 drawer card types of spec 7.3 (`inspector.key_numbers`, `inspector.rank_history`, `inspector.ai_by_engine`, `inspector.competing_domains`, `inspector.serp_features`, `inspector.url_history`)
  - the numbers of spec 7.2 with `channel` and `perEngine`
  - `SCREENS`: `overview` (numbers, cards with widths) and `inspector.keyword` (cards, no widths)
- [x] Run the tests: pass. Run lint and `tsc --noEmit`.

## Task 2: Sanitizing

**Files:** create `sanitize.ts`; extend the test file.

`sanitizeLayout(raw: unknown, screen: ScreenKey): { document: LayoutDocument; changed: boolean }`

- [x] Write failing tests, one per rule:
  - not an object, or wrong `schema`: returns the built-in default, `changed: true`
  - unknown card type, type not allowed on the screen, retired type: dropped
  - width not allowed for the type: replaced by the type's default; width removed on screens without widths
  - option with a value outside its definition: replaced by its default; unknown option keys removed; missing options filled with defaults
  - more instances than `maxInstances`: extra ones dropped
  - unknown metric, AI metric without a valid engine, SEO metric with an engine, duplicate metric and engine pair: dropped or repaired
  - more than 12 cards or 6 numbers: dropped from the end
  - missing or duplicate ids: replaced by `item-N`
  - a valid document returns `changed: false` and an equal document
- [x] Run: fail. Implement. Run: pass.

## Task 3: Resolution and availability

**Files:** create `resolve.ts`, `availability.ts`; extend tests.

- `resolveLayout(stored: { personal: unknown; team: unknown }, screen): { source: 'personal' | 'team' | 'builtin'; document: LayoutDocument }`. `null` and `undefined` mean "not stored". The chosen document is sanitized.
- `cardAvailability(definition, capabilities: { channels: Channel[]; permissions: string[]; integrations: string[] }): { state: 'available' } | { state: 'unavailable'; reason: string } | { state: 'hidden' }`. Missing permission gives `hidden`; a missing channel or integration gives `unavailable` with the sentence shown to the person ("AI tracking is off in this project").

- [x] Tests: personal wins over team; team over built-in; built-in when both absent; a corrupt personal document still resolves (to the sanitized result, source `personal`); `requiresAny` satisfied by either channel; permission gives `hidden`.
- [x] Fail, implement, pass.

## Task 4: Rows

**Files:** create `rows.ts`; extend tests.

- `spanOf(width, breakpoint: 'wide' | 'medium' | 'narrow'): number` per the table in spec 6.2.
- `packRows(cards, breakpoint): Array<Array<{ id: string; span: number }>>`: flow in order, wrap when a card does not fit, never stretch.
- `trailingSpace(cards, breakpoint): number`: free columns in the last row (12 when there are no cards).

- [x] Tests: `two_thirds + third` fills one row; `two_thirds + half` wraps and leaves 4; medium collapses `third` to 6 and `two_thirds` to 12; narrow puts every card on its own row; empty input.
- [x] Fail, implement, pass.

## Task 5: Draft edits and change count

**Files:** create `draft.ts`; extend tests.

Pure functions, each returning a new document (or the same one when the edit is not possible):
`addCard(doc, card, index?)`, `hideCard(doc, id)`, `moveCard(doc, id, toIndex)`, `setCardWidth(doc, id, width)`, `setCardOption(doc, id, key, value)`, `addNumber(doc, number, index?)`, `removeNumber(doc, id)`, `moveNumber(doc, id, toIndex)`, `canAddCard(doc, typeKey)`, `canAddNumber(doc, metric, engine?)`, `changeCount(before, after)`.

- [x] Tests: add respects the 12 limit and `maxInstances`; add fills default width and options; move clamps the index and keeps the other order; width must be allowed by the type; option must be a defined value; numbers respect the 6 limit and uniqueness; `changeCount` is 0 for equal documents, counts added, removed, resized and re-optioned items once each, and a reorder as one change per zone.
- [x] Fail, implement, pass. Run lint and `tsc --noEmit`.

## Task 6: Make the logic available to the preview

**Files:** create `design-preview/layouts-core.mjs`; modify `package.json` (`preview` script), `interactions.js`, `charts.js`.

- [x] `layouts-core.mjs`: for each `src/lib/layouts/*.ts` except tests, `ts.transpileModule` with `module: ESNext`, `target: ES2022`, add `.js` to relative import specifiers, write to `design-preview/vendor/layouts/`.
- [x] Add it to the `preview` script before the Tailwind step; add `@source "./customize.js"` to `preview.css`.
- [x] `interactions.js`: end the IIFE by exposing `window.PreviewUI` with the helpers `customize.js` uses. `charts.js`: add `refresh` (re-render charts, legends, stacked bars) to `PreviewCharts`.
- [x] Run `pnpm run preview`; check `vendor/layouts/index.js` loads in a browser console (`import('./vendor/layouts/index.js')`).

## Task 7: Overview renders from a layout

**Files:** modify `index.html`, create `customize.js`.

- [x] Back up `index.html`. Give each of the eight Overview panels `data-card="<type key>"` and move them into `<div id="card-bank" hidden>`; replace the four two-panel rows with one `<div data-zone="cards" data-screen="overview" class="grid grid-cols-1 md:grid-cols-12 gap-4">`. Replace the static metric strip with `<dl data-zone="numbers">`.
- [x] `customize.js`: read storage, `resolveLayout`, then `renderCards` (append nodes in order with the width classes `md:col-span-6 xl:col-span-4`, `md:col-span-6`, `md:col-span-12 xl:col-span-8`, `md:col-span-12`) and `renderNumbers` (cells built from a fixture keyed by metric and engine, with engine logos and the group divider where the channel changes).
- [x] Verify the Overview looks as before at 1536, 1100 and 390 px in both themes, with no console errors and no horizontal scroll.

## Task 8: The six new cards

**Files:** modify `index.html` (card bank), `customize.js`, `charts.js` (mention trend).

- [x] Static cards in the bank: Top movers, SERP features, Citation share by domain type, Share of voice, Collection status. Cards with options render their body from a fixture in `customize.js` (`renderCardBody(item)`).
- [x] `ai.mention_trend` is a `<template>`; each instance gets its own 120 px ECharts line with the interval band, the engine logo in its title and the latest value with its counts.
- [x] Verify each at its allowed widths in both themes.

## Task 9: Customize mode for cards

**Files:** modify `index.html` (Customize button, "Customizing" badge, add slot), `customize.js`.

- [x] Enter and leave: button `aria-pressed`, badge, Escape, card content `inert`, dashed outline.
- [x] Toolbar per card: drag handle, title, width `Select` (allowed widths only), options, hide, More menu (Move earlier, Move later, Move to start, Move to end).
- [x] Reordering three ways: pointer drag with a drop line and `shadow-drag`; keyboard on the handle (Space, arrows, Space, Escape); the More menu. One polite live region announces each change.
- [x] Focus: after a move it stays on the card's handle; after hide it goes to the next card's handle or to "Add card".
- [x] "Add card" slot sized by `trailingSpace`.

## Task 10: Catalog, options and numbers

**Files:** modify `index.html` (dialog, popover, listboxes), `customize.js`.

- [x] Catalog dialog (720 px): search, four groups, schematic, name, sentence, state (Add, Added, Add another, unavailable with reason, New badge for 30 days from `addedOn`).
- [x] Options popover generated from the type's `options`; changes apply to the draft and re-render the card body.
- [x] Numbers: remove button, drag sideways and Move left or right in a menu, "Add number" list grouped SEO and AI; an AI metric asks for the engine; 0 to 6.

## Task 11: Saving

**Files:** modify `index.html` (save bar), `customize.js`.

- [x] Save bar: change count, scope sentence, Reset to default, Cancel, Save layout with a menu holding "Save as team default" and "Remove team default" (the preview user is an owner).
- [x] Storage keys `preview-layout:personal:<screen>` and `preview-layout:team:<screen>`, every read and write in try/catch.
- [x] Discard confirmation through `PreviewUI.askDiscard` on Cancel, Escape and route change with changes; team default confirmation dialog.
- [x] Verify: save, reload, layout persists; reset returns to the team default when one exists; a corrupt stored value falls back without an error.

## Task 12: Drawer cards

**Files:** modify `index.html` (drawer cards get `data-card`; two new drawer cards; footer), `customize.js`, `interactions.js` (More menu item).

- [x] "Customize cards" in the drawer More menu; one-column customize mode (handle, hide, More), "Add card" opening the catalog filtered to `inspector.keyword`; footer with Reset to default, Cancel, Save layout.
- [x] Verify docked, overlay and sheet-width behavior (customize needs 768 px, so the menu item is hidden below that).

## Task 13: Documents

**Files:** the design-system documents of spec section 12, `review-log.md`, `26-implementation-guidelines.md` (preview contents).

- [x] Apply each row of spec section 12. Add ADR-DS-021 (customizable layouts: catalog, snapshot documents, personal over team over built-in).

## Task 14: Verification

Status 2026-09-30: all tasks executed inline. Deviations from the plan: the trend card has no stored options (single-choice options only), and the drawer footer has no team-default menu in the preview. Both are recorded in the spec, section 15.

- [x] `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `pnpm run preview`: all pass.
- [x] Browser, in a background tab: the full flow at 1536 and 1100 px in both themes; keyboard-only reorder; 820 px (customize available); 390 px (customize hidden, layout stacks); contrast of the new controls; no console errors.
- [x] Check the plan against the spec: every section 5 behavior has a verified step or is listed as not in the preview.
