# Keywords: Clicks and Impressions columns, group sums, and the top bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Keywords table shows Search Console Clicks and Impressions (last 28 days, for the device and country shown, never an estimate) right after Volume, with CPC beside AI Overview; By group rows show the sums; the country control and a search field (interface only) live in the top bar.

**Architecture:** The API already carries `include=gsc` per row (`gsc: { state, clicks: {desktop, mobile}, impressions: {desktop, mobile}, window }`, designed in `docs/18-first-party-integrations.md` section 4.9). This plan only reads it: two columns whose cell is one of four states (`Value`, `0`, `Pending`, `Not connected`), sums in the browser for group rows, and the export columns. The top bar gets a portal slot so a page can contribute controls to it, and a search field that is a placeholder.

**Tech Stack:** Next.js, TypeScript strict, next-intl, MSW, vitest, Playwright.

**Source of truth:** `docs/18-first-party-integrations.md` section 4.9, `docs/design-system/24-page-templates.md` rows "Clicks and Impressions columns" and "Country scope", `docs/design-system/11-navigation.md` section 4 (top bar), the mock `kw-grouped-model.js` (`CLICKS_TIP`, `IMPRESSIONS_TIP`, columns) and `kw-grouped.js` (`appChrome`: the top bar).

## Precondition: the Search Console API must be committed

`include=gsc` and the `GscBlock` types exist only as uncommitted edits in the main checkout (`/Users/a12345/Desktop/AI/idraft/platform`: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`, `backend/src/idraft/api/keywords/*`), owned by the session that is building the Search Console pull (plan `docs/superpowers/plans/2026-11-04-search-console-clicks.md`, untracked there). Tasks 1 to 3 need that commit. Before starting:

1. `git -C /Users/a12345/Desktop/AI/idraft/platform log --oneline develop -- backend/openapi/v1.json` must show a commit that adds `GscBlock`. If it does not, stop and ask the owner for the order (the other session commits first, or the owner approves that this branch carries the edit).
2. In this worktree: `git merge develop`. If `backend/openapi/v1.json` or `apps/web/src/lib/api/schema.ts` conflict, do not hand-merge: take `develop`'s version of both (`git checkout --theirs`), then in `backend` run `uv run python -m idraft.api.openapi > openapi/v1.json` and in `apps/web` `pnpm gen:api` so this branch's own additions (the multi-country plan's filter and routes) are regenerated on top.

Task 4 (top bar) does not depend on it and may be done first.

What the reading side returns today: every row answers `pending` (the project has a Search Console connection) or `not_connected`; `ok` appears when the other session ships the pull. Build and test the four states with fixtures; the real numbers arrive with their work. The API sorts `gsc_clicks` and `gsc_impressions` do not exist yet: keep them out of `SORT_FIELDS`, and sort in memory in client mode through the columns' `sortValue`.

Work in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/keywords-grouped`; commands from `apps/web`. Known failures that are not yours: three vitest tests (rank trend sparkline, two rank-strip) and four e2e tests.

**Preconditions in this branch:** the one-device plan and the By group plan are merged here (rows are the shown device's; `GroupMeasures` exists in `grouped/grouped-rows.ts`). If the By group plan is not done yet, skip Task 2 and do it after.

---

### Task 1: The Clicks and Impressions columns

**Files:**
- Modify: `src/features/rankings/rankings-queries.ts` (`INCLUDE`, line ~54: add `'gsc'`), `src/features/rankings/keyword-columns.tsx`, `src/lib/tables/column-types.ts` (only if the width needs it), `messages/en.json` (`rankings.columns`, `rankings.gsc`), `src/mocks/factories/keyword.ts` and `src/mocks/handlers/tracked-keywords.ts` (the `gsc` include), `src/mocks/keyword-fixtures.ts`
- Create: `src/features/rankings/gsc-cells.ts` (pure helpers)
- Test: `gsc-cells.test.ts`, `rank-columns.test.tsx` or a new `gsc-columns.test.tsx`, `rankings.test.tsx`

- [ ] **Step 1: Failing tests for the pure reading**

`gsc-cells.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { gscValue } from './gsc-cells';

const ok = { state: 'ok', clicks: { desktop: 12, mobile: 3 }, impressions: { desktop: 340, mobile: 90 }, window: { start: '2026-10-07', end: '2026-11-03' } } as const;

describe('gscValue', () => {
  it('reads the figure of the device shown, never the two added', () => {
    expect(gscValue(ok, 'clicks', 'desktop')).toEqual({ kind: 'value', value: 12 });
    expect(gscValue(ok, 'impressions', 'mobile')).toEqual({ kind: 'value', value: 90 });
  });
  it('keeps a real zero as a value', () => {
    expect(gscValue({ ...ok, clicks: { desktop: 0, mobile: 0 } }, 'clicks', 'desktop')).toEqual({ kind: 'value', value: 0 });
  });
  it('names the states that have no figure', () => {
    expect(gscValue({ state: 'pending' }, 'clicks', 'desktop')).toEqual({ kind: 'pending' });
    expect(gscValue({ state: 'not_connected' }, 'impressions', 'desktop')).toEqual({ kind: 'notConnected' });
  });
  it('is not connected when the row did not carry the block', () => {
    expect(gscValue(null, 'clicks', 'desktop')).toEqual({ kind: 'notConnected' });
    expect(gscValue(undefined, 'clicks', 'desktop')).toEqual({ kind: 'notConnected' });
  });
  it('is pending when the state is ok but the device has no figure yet', () => {
    expect(gscValue({ state: 'ok', window: ok.window }, 'clicks', 'desktop')).toEqual({ kind: 'pending' });
  });
});
```

Run: `pnpm vitest run src/features/rankings/gsc-cells.test.ts`; expect FAIL.

- [ ] **Step 2: Implement `gsc-cells.ts`**

```ts
import type { components } from '@/lib/api/schema';

type Gsc = components['schemas']['GscBlock'];
export type GscMetric = 'clicks' | 'impressions';
export type GscReading = { kind: 'value'; value: number } | { kind: 'pending' } | { kind: 'notConnected' };

/** One figure of a keyword's Search Console block, for the device the table shows. */
export function gscValue(gsc: Gsc | null | undefined, metric: GscMetric, device: 'desktop' | 'mobile'): GscReading {
  if (gsc === null || gsc === undefined || gsc.state === 'not_connected') return { kind: 'notConnected' };
  if (gsc.state === 'pending') return { kind: 'pending' };
  const value = gsc[metric]?.[device];
  return value === undefined ? { kind: 'pending' } : { kind: 'value', value };
}
```

Run the test; expect PASS.

- [ ] **Step 3: Failing tests for the columns**

`gsc-columns.test.tsx` (copy the harness of `rank-columns.test.tsx`): the columns `gsc_clicks` and `gsc_impressions` sit right after `search_volume`, with headers `Clicks` and `Impressions`, header tooltips equal to the mock's `CLICKS_TIP` and `IMPRESSIONS_TIP` reworded for the app (no mention of the preview): `Clicks from Google Search Console in the last 28 days for this keyword in this country on the device shown. Not an estimate.`; a value shows formatted (`1,204`), `0` shows `0`, pending shows `Pending` with the tooltip `Search Console figures are being collected`, not connected shows `Not connected` with the tooltip `Connect Search Console in Settings, Integrations`; `sortValue` is the figure (null for the two states, sorted last); the cell reads `row.gsc` of the row shown (so Mobile shows the mobile figure). Both are `defaultVisible`, priority 2. And in `rankings.test.tsx`: the list request carries `include[]=gsc` (copy the existing include assertion).

Run: expect FAIL.

- [ ] **Step 4: Implement**

In `keyword-columns.tsx`, after the `search_volume` column:

```tsx
col.count<TrackedKeywordRow>('gsc_clicks', (row) => numberOf(gscValue(row.gsc, 'clicks', device)), {
  header: t('clicks'), headerTooltip: t('clicksTooltip'), priority: 2, width: 112,
  unknown: (row) => gscUnknown(gscValue(row.gsc, 'clicks', device)),
}),
col.count<TrackedKeywordRow>('gsc_impressions', (row) => numberOf(gscValue(row.gsc, 'impressions', device)), {
  header: t('impressions'), headerTooltip: t('impressionsTooltip'), priority: 2, width: 120, minWidth: 120,
  unknown: (row) => gscUnknown(gscValue(row.gsc, 'impressions', device)),
}),
```

with `numberOf = (reading) => reading.kind === 'value' ? reading.value : null` and `gscUnknown = (reading): UnknownValue => reading.kind === 'pending' ? { label: t('pending'), tooltip: t('gscPendingTooltip') } : { label: t('notConnected'), tooltip: t('gscNotConnectedTooltip') }` (helpers inside the `useMemo`, so they close over `t`). Width: the count type caps at 120; if the header `IMPRESSIONS` plus its sort arrow does not fit, raise `minWidth` and check with the test the file `column-types.test` style uses; do not change the type's cap without reading its comment.

Mocks: `include[]=gsc` adds to each row `gsc` from the fixture: the `fynix` project `{ state: 'ok', ... }` for a deterministic spread (clicks and impressions per device derived from the keyword's index, with some `0`), the `cleanstart` project `not_connected`, plus one keyword `pending` (add a `gscState` override in `keyword-table.ts`); update the mock's include allowlist so `gsc` is accepted.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run src/features/rankings src/mocks src/test && pnpm lint && pnpm typecheck && pnpm format:check` (only the three known failures may remain).

```bash
git add apps/web && git commit -m "Keywords: Clicks and Impressions columns from Search Console"
```

---

### Task 2: Group sums

**Files:**
- Modify: `src/features/rankings/grouped/grouped-rows.ts` (`GroupMeasures`, `groupMeasures`), `grouped-columns.tsx`
- Test: `grouped-rows.test.ts`, `grouped-columns.test.tsx`

Rule (docs 18 section 4.9): a group's Clicks (Impressions) is the sum of its keywords' figures for the device shown. Keywords without a figure (`pending`, `not connected`) add nothing; if no keyword of the group has a figure, the group shows the state (not connected beats pending); if some do and some do not, the sum is shown with a tooltip `n of m keywords have Search Console figures`.

- [ ] **Step 1: Failing tests**

`grouped-rows.test.ts`: `groupMeasures` gains `clicks: GscSum` and `impressions: GscSum` where `type GscSum = { kind: 'value'; value: number; counted: number; of: number } | { kind: 'pending' } | { kind: 'notConnected' }`; cases: all keywords `ok` sums to `{ value: 15, counted: 2, of: 2 }`; one `ok` and one `pending` gives `{ value, counted: 1, of: 2 }`; all `pending` gives `pending`; any `not_connected` with none ok gives `notConnected`; a group of zeros gives `{ value: 0 }` (a real zero). `grouped-columns.test.tsx`: the group row's Clicks and Impressions cells show the sum, the state word, or the sum with the `n of m` tooltip; the sum uses the device shown.

- [ ] **Step 2: Implement** with `gscValue` from Task 1, then run `pnpm vitest run src/features/rankings/grouped` and commit.

```bash
git add apps/web && git commit -m "Keywords: Clicks and Impressions sums in the By group view"
```

---

### Task 3: Export columns

**Files:**
- Modify: `src/features/rankings/export/export-model.ts` (`ExportColumnKind`, `ExportLabels`, `buildExport`), `export-file.ts` (format `clicks` and `impressions` kinds as integers), `rankings-screen.tsx` (labels), `messages/en.json` (`rankings.export.columns`)
- Test: `export-model.test.ts`, `export-file.test.ts`

Add `clicks` and `impressions` kinds after `volume`; the cell is the figure of the device shown, empty (`null`) when it is not `ok`. The list read for the export (`readAllKeywords`) must send `include[]=gsc` (it uses `INCLUDE`; check). 

- [ ] **Step 1: Failing tests:** a row with `gsc.state === 'ok'` exports its figures; `pending` and `not_connected` rows export empty cells; the header gains `Clicks` and `Impressions` after `Volume`; the workbook formats them as integers (`export-file.test.ts` pattern for `volume`).
- [ ] **Step 2: Implement, run, commit**

Run: `pnpm vitest run src/features/rankings/export && pnpm lint && pnpm typecheck`

```bash
git add apps/web && git commit -m "Keywords: Clicks and Impressions in the export"
```

---

### Task 4: The top bar: a slot, the country control and a search field

**Files:**
- Create: `src/components/app/shell/top-bar-slot.tsx` (context and portal), `src/components/app/shell/top-bar-search.tsx`
- Modify: `src/components/app/shell/top-bar.tsx`, `src/features/shell/project-shell.tsx` (provide the slot, render the search), `src/features/rankings/keyword-scope.tsx` (the country control as its own export), `src/features/rankings/rankings-screen.tsx` (use the portal), `messages/en.json` (`shell.search`)
- Test: `top-bar-slot.test.tsx`, `top-bar-search.test.tsx`, `rankings.test.tsx`, `src/features/shell/*.test.tsx` where the top bar is asserted

Behaviour (the mock `appChrome` and `11-navigation.md` section 4):
- **Slot.** `TopBar` renders, in its right group before the fixed controls, an empty element (`<div ref={setSlot} className="flex items-center gap-3" />`) and provides it through `TopBarSlotContext`. `TopBarPortal` (`children`) renders them into that element with `createPortal` when the element exists, and renders nothing without a top bar above it (a page rendered outside the shell does not break). The tests that mount the screen alone provide a slot through the harness (see Step 1).
- **Country control.** `KeywordScopeControls` is split: `KeywordDeviceControl` (the Desktop/Mobile switch, stays in the page toolbar) and `KeywordCountryControl` (the combobox, with the "only countries in use, plain label for one, All countries for more than one" behaviour of the multi-country plan). `RankingsScreen` renders the country control through `TopBarPortal`. Below 1024 px the top bar has no room: the portal keeps it, the control collapses to the country's ISO code and a map-pin icon (copy how the search field collapses).
- **Search field (interface only).** A button-looking field, 36 px high, 240 px wide from 1280 px up (360 and 440 as `11-navigation.md` says for wider windows; read the table), with a `Search` icon, the placeholder text `Search keywords, prompts, domains` and a `⌘K` hint box; below 1280 px it is a 36 px icon button. It does nothing yet: `aria-disabled="true"`, `title`/tooltip `Search is coming soon`, no focus trap, no handler. It is rendered by `ProjectShell` for every project page, left of the slot. Its accessible name is `Search`.
- Date range and notifications are not added (no screen uses them yet; `top-bar.tsx` says they join with the screens that need them).

- [ ] **Step 1: Failing tests**

`top-bar-slot.test.tsx`: a child of `TopBarPortal` appears inside the top bar's right group, between the search and the theme/help/user controls; without a `TopBar` ancestor it renders nothing and does not throw. `top-bar-search.test.tsx`: renders a button named `Search` with the hint `⌘K`, is `aria-disabled`, clicking it does nothing (no dialog, no navigation), has the tooltip text. `rankings.test.tsx`: the country control is no longer inside the page's toolbar (`within(toolbar)` has no `Country` button) and is inside the `banner`/top bar landmark, and still sends `filter[country_id]` when changed; the existing country tests keep working through a harness that mounts the screen inside the shell (update `rankingsAs` in `src/test/rankings-harness.tsx` to wrap with a `TopBar` test double that provides the slot, or add a `TopBarSlotProvider` with a plain `div`).

- [ ] **Step 2: Implement** as above.
- [ ] **Step 3: Run and check responsive behaviour in the browser**

Run: `pnpm vitest run src/components/app/shell src/features/shell src/features/rankings src/test && pnpm lint && pnpm typecheck && pnpm format:check`. Then start the app's mock-API dev server per the repo README (check `launch.json` and the dev server policy: reuse a running one, never kill a port occupant), open `/digibranders/fynix/seo/keywords`, and look at widths 1440, 1280, 1024 and 768 in the Browser pane: the top bar stays on one line, nothing overlaps, the search collapses to an icon below 1280 px, the country control collapses below 1024 px. Save no screenshots in the repo.

```bash
git add apps/web && git commit -m "Top bar: a slot for page controls, the country control moved in, and a search field (interface only)"
```

---

### Task 5: End to end, docs, full checks

**Files:**
- Modify: `e2e/flows/rankings.spec.ts`, `docs/design-system/24-page-templates.md`, `docs/design-system/11-navigation.md` (As built note on the slot and the search placeholder), `docs/18-first-party-integrations.md` (4.9 "Built so far": the web side), `docs/20-frontend-specification.md` (5.3)

- [ ] **Step 1: e2e:** the Clicks and Impressions headers sit after Volume; a project with a figure shows numbers and one without shows `Not connected`; the country control is in the top bar landmark; the search field is present and inert.
- [ ] **Step 2: Docs:** As built paragraphs; correct anything in `24-page-templates.md` that still places the country in the page toolbar.
- [ ] **Step 3: Final checks:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`.

```bash
git add apps/web docs && git commit -m "Keywords: Search Console columns and the top bar, end to end and in the docs"
```

---

## Self-review

- **Spec coverage:** Clicks and Impressions after Volume with the four states and the device shown (task 1); CPC beside AI Overview (done in the By group plan task 3; this plan relies on it); sums in By group (2); export (3); country in the top bar and a UI-only search (4); documentation of the Search Console source is already in docs/18 4.9.
- **Placeholders:** none. The Task 4 slot's fallback is stated (renders nothing without a top bar; the test harness provides one).
- **Type consistency:** `GscReading`, `gscValue`, `GscMetric` (task 1) feed `GscSum` (task 2) and the export (task 3); `TopBarPortal` and `TopBarSlotContext` (task 4) are the only new shell names.
- **Known limits:** real figures depend on the other session's pull and reading side (until then every row shows `Pending` or `Not connected`); `gsc_clicks` and `gsc_impressions` do not sort on the API in server mode; the search field does nothing by design.
