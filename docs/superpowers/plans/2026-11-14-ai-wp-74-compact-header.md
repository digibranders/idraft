# WP-74: compact page header on every AI page

Status: in progress on branch `ai/wp-74-compact-header`.

## Owner feedback (verbatim)

"asked for the sleek UI and top part like keywords page for all pages, no useless clutter or empty spaces, you made the same mistake again"

## Plan summary

Deliver one consistent, professional, dense page header across the app matching the reference Keywords page (`/seo/keywords`). All page chrome above data collapses into a single slim toolbar row of approximately 36 to 40 px directly below the breadcrumb. No visible H1 heading, no subtitle blocks, no full-width banners, no separate tabs rows, and no tall tile strips.

## Task breakdown

### Task T0: Shared PageToolbar component
- Build `PageToolbar` in `apps/web/src/components/app/page-toolbar/page-toolbar.tsx` with dedicated slots:
  - `stats`: compact inline stat chips (label, value, optional secondary text, delta, tooltip with denominator/counts, honest unknown states).
  - `filters`: Filter button with active filter chips, scope controls (device, engine, country, compare) in one flowing row.
  - `tabs`: segmented control for page tabs (Domains, Pages, New and lost) inline in the toolbar row or table toolbar.
  - `status`: small inline status chips (for example `Schedules paused`, `Collecting answers`, `Updated 2h ago`) with tooltips.
  - `actions`: Export, `...` menu, primary action button.
- Support responsive wrapping (collapses cleanly at 1024, 768, and 390 px with scrollable stats row on mobile).
- Append documentation to `docs/design-system/25-component-inventory.md` and note in `docs/design-system/24-page-templates.md`.
- Unit tests in `apps/web/src/components/app/page-toolbar/page-toolbar.test.tsx`.

### Task T1: AI Overview migration (shippable alone)
- Migrate `apps/web/src/features/ai-overview/`:
  - Replace `OverviewHeader` (remove visible H1, subtitle, customize toolbar clutter).
  - Replace tall `NumbersZone` tile strip with compact inline stat chips.
  - Combine scope controls (compare, engines, branded) into the toolbar filters slot.
  - Replace full-width blue banner ("Scheduled AI runs are paused") with an inline `Schedules paused` status chip linking to Settings > Schedules.
  - Handle setup checklist: hide once setup is complete; add item in `...` menu ("Show setup steps") to reopen; when incomplete, display as a slim single line inside the toolbar area.
  - Card empty states: collapse empty cards to slim header plus one line; match skeleton heights to avoid layout shifts.
- Verify vertical offset of first card is within top 140 px below the breadcrumb.
- Targeted tests: `ai-overview-screen.test.tsx`, `ai-overview-states.test.tsx`.

### Task T2: Citations migration
- Migrate `apps/web/src/features/citations/`:
  - Hide visible H1 and subtitle (`titleHidden` with sr-only H1 for accessibility).
  - Move tabs (Domains, Pages, New and lost) into an inline segmented control in the toolbar.
  - Replace tall 6-tile `CitationsStrip` with compact inline stat chips in the toolbar.
  - Move notice banners:
    - "The 200 most cited domains are listed of 229..." moves to table footer.
    - "The previous period has no answers..." lives in compare select hint.
    - "Shares are of N citation units in M answers" moves to table column header info tooltip or footer.
  - Inline filter bar and compare select in the toolbar.
- Verify vertical offset of first table row is within top 140 px below the breadcrumb across all three tabs.
- Targeted tests: `citations-screen.test.tsx`, `citations-strip.test.tsx`, `domains-tab.test.tsx`, `pages-tab.test.tsx`.

### Task T3: Topics and Prompts migration
- Migrate `apps/web/src/features/prompts/`:
  - Ensure toolbar matches the shared `PageToolbar` pattern.
  - Move banners (e.g. collection status, dropped dates) into inline status chips or toolbar area.
  - Keep hunks small in `prompts-screen.tsx` to maintain clean rebase against parallel work.
- Targeted tests: `prompts.test.tsx` and related prompt tests.

### Task T4: Runs and Costs verification
- Audit `features/operations/runs-screen.tsx` and `features/costs/costs-screen.tsx`.
- If they already follow the compact Keywords pattern, leave them unchanged as instructed.

### Task T5: Test suite and E2E specs update
- Update existing E2E specs that asserted the old headers:
  - `ai-citations.spec.ts`
  - `ai-citations-inspectors.spec.ts`
  - `ai-overview.spec.ts`
  - `ai-overview-*.spec.ts`
  - `ai-prompts.spec.ts`
  - `ai-runs-costs.spec.ts`
- Run targeted unit tests and full capped test suite: `pnpm exec vitest run --maxWorkers=3`.

### Task T6: Final gate, AFTER screenshots, and merge
- Measure final vertical offsets at 1440 x 900 for all migrated pages.
- Capture AFTER screenshots at 1440 x 900 and 390 px (light and dark) and save to `docs/ai-visibility/screens/wp-74/`.
- Run all quality gates (`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`).
- Rebase on `origin/develop` and push fast-forward to `origin/develop`.
- Report final changes, measured numbers, and commit sha.
