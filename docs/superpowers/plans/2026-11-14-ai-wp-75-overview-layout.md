# WP-75 detailed task plan: AI Visibility Overview layout, empty states and performance

Brief: Review the AI visibility Overview page (`/<workspace>/<project>/ai`), eliminate clutter and empty boxes, establish a clear first-screen story (how visible -> what changed -> trend -> sources -> competitors -> opportunities/key changes), implement slim adaptive empty states, fix card quality issues, optimize performance (134 prompts from 10 to 20s down to under 2s on mocks), update presets, pass all verification gates, and push fast-forward to `develop`.

Branch `ai/wp-75-overview-layout` in `.claude/worktrees/wp-75`, cut from `origin/develop`.

## 1. Scope and boundaries

- **Scope split with WP-74:** WP-74 owns the top header, toolbar, stat chips, notices, and setup bar. WP-75 owns what is BELOW the toolbar: the card grid, the built-in Default layout (`SCREENS.ai_overview.builtin`), the four presets (`features/ai-overview/presets/presets.ts`), card order, widths, heights, empty states, and card loading behavior.
- **Constraints:**
  - Push to `origin/develop` only (fast-forward `git push origin HEAD:develop`). Never push `main`. Never run `infra/ship.sh`.
  - No em-dashes or en-dashes anywhere in code, copy, docs, or commits. Plain hyphens only.
  - Short commit subjects: `WP-75: <what changed>`, no attribution lines.
  - No `any`, strict types, explicit return types, no new runtime dependencies.
  - User-visible text via `apps/web/messages/en.json` (additive keys); numbers and dates via `apps/web/src/lib/format`.
  - Heavy commands one at a time, vitest capped: `pnpm exec vitest run --maxWorkers=3`. Dev server stopped when done.
  - Always run `pnpm gen:layout-catalog` in the same commit whenever layout catalog changes.

## 2. Issues and solutions

### 2.1 Information hierarchy for the first screen (1440x900)
- **Problem:** Currently, the default layout has "What changed" (full), "Mention rate by engine" (two thirds), "Named and cited by engine" (third), "Top cited domains" (third), "Mention rate by topic and engine" (two thirds), "Share of voice on ChatGPT" (half), "Mention rate on ChatGPT" competitor trend (half), "Key changes" (half), "Opportunities" (half). On small/young projects, 5 of 9 cards are empty states. Competitor cards take up half-rows with repetitive empty states.
- **Solution:** Reorganize the Default layout to tell a clear first-screen story:
  1. Numbers strip (in header toolbar, WP-74)
  2. What changed (`ai.change_summary`, full)
  3. The trend: `ai.rate_trend_by_engine` (two_thirds) + `ai.outcome_mix` (third)
  4. Where answers come from: `sources.top_domains` (third) + `ai.topic_heatmap` (two_thirds) [or sources breakdown]
  5. Who beats me: `ai.share_of_voice` (half) + `ai.competitor_trend` (half)
  6. What to do: `activity.key_changes` (half) + `ai.opportunities` (half)
  Row packing is tight: no orphan half-cards, clean responsive stacking on 1280, 1024, 768, and 390.

### 2.2 Empty and not-ready cards taking massive space
- **Problem:** `ChartFrame` forces `minHeight: height` (140 to 280px) on empty states, rendering large 250px boxes with a single sentence. Young projects (e.g. Eventus with 1 run, no competitors, no topics) look half-built and broken.
- **Solution:**
  - Introduce a consistent **slim empty state** in `ChartFrame` (`components/app/chart/chart-frame.tsx`): when `status === 'empty'`, render a compact bar (~56 to 72px) with the card title, reason, and an accessible primary action button.
  - Implement adaptive ordering in the grid (`features/layouts/layout-grid.tsx`): in view mode, ready cards are ordered first and not-ready (empty) cards are placed at the bottom, so full data cards pack into equal-height rows without ragged bottoms next to slim empty cards.

### 2.3 Card quality fixes
- **What changed card:**
  - Fix duplicate sentence: ensure `noPrevious` sentence is never duplicated between summary/body or within facts.
  - Remove pinned footnote gap: change HTML body wrapper so loaded text content does not force a dead 140px min-height, allowing the footnote to sit naturally below the text.
  - Clear empty state when no facts are available.
- **Narrow third-width cards:**
  - Prevent label and number truncation at 1280px and 1024px. Ensure third-width cards use compact representations (e.g. bars only, table behind switch).
- **Equal height cards in rows & skeleton synchronization:**
  - Card frames in a grid row stretch to equal height.
  - Skeleton height must match loaded height via `loadingHeight` so no layout jumps occur.

### 2.4 Performance and loading order
- **Problem:** With 134 prompts, cards issue separate `prompts-summary` queries with different `include` parameters and separate previous-window queries. In addition, `useNearViewport` with `100% 0px` root margin mounts and fires queries for off-screen cards immediately on load, creating a 10 to 20s waterfall.
- **Solution:**
  - Tighten viewport observation in `useNearViewport` / `CardBody` so off-screen cards do not fire heavy queries until near.
  - Deduplicate and share summary reads through `features/ai-overview/data/`: above-the-fold cards share the summary query.
  - Show the first meaningful card in under 2 seconds on mocks.

### 2.5 Customize mode and presets
- **Problem:** Presets (`executive`, `seo_analyst`, `competitive`, `topic_owner`) must receive the same quality pass and packing rules.
- **Solution:** Update `features/ai-overview/presets/presets.ts`. Saved user layouts remain untouched (schema remains 1 in `upgrade.ts` as `LayoutDocument` schema shape has not changed).

## 3. Tasks

### T0: Shared Card Frame States (Tests first)
- Files: `components/app/chart/chart-frame.tsx`, `components/app/chart/chart-frame.test.tsx`, `features/layouts/layout-grid.tsx`, `features/layouts/layout-grid.test.tsx`, `features/layouts/cards/card-readiness.ts`.
- Tests: Test that `ChartFrame` with `status: 'empty'` renders a slim state (56 to 72px, accessible heading, reason, button). Test adaptive ordering helper (ready items first, empty items placed at bottom in view mode).
- Implementation:
  - Add slim empty state variant in `ChartFrame`.
  - Add card readiness tracking so the layout grid can adaptively position ready cards first and empty cards at the end in view mode.

### T1: Default Layout
- Files: `apps/web/src/lib/layouts/catalog.ts`, `apps/web/scripts/gen-layout-catalog.mjs`, `backend/app/layouts/catalog.json`.
- Implementation:
  - Rearrange `SCREENS.ai_overview.builtin` to match the 5.1 hierarchy:
    - Row 1: `ai.change_summary` (full)
    - Row 2: `ai.rate_trend_by_engine` (two_thirds) + `ai.outcome_mix` (third)
    - Row 3: `sources.top_domains` (third) + `ai.topic_heatmap` (two_thirds)
    - Row 4: `ai.share_of_voice` (half) + `ai.competitor_trend` (half)
    - Row 5: `activity.key_changes` (half) + `ai.opportunities` (half)
  - Run `pnpm gen:layout-catalog` to regenerate backend `catalog.json`.
  - Check `packRows` tests and update as needed.

### T2: Card Quality Fixes
- Files:
  - `features/ai-overview/cards/engines/change-summary-card.tsx`
  - `features/ai-overview/cards/engines/facts-model.ts`
  - `features/ai-overview/cards/engines/change-summary-card.test.tsx`
  - `components/app/chart/chart-frame.tsx`
- Implementation:
  - Remove duplicated sentence in `change-summary-card.tsx` / `facts-model.ts`.
  - Eliminate dead space above footnote in `change-summary-card.tsx` by allowing natural height when loaded.
  - Verify and adjust third-width cards for 1280px and 1024px measures.
  - Ensure skeleton heights match final heights.

### T3: Presets Pass
- Files: `features/ai-overview/presets/presets.ts`, `features/ai-overview/presets/presets.test.ts`.
- Implementation:
  - Review and update `executive`, `seo_analyst`, `competitive`, and `topic_owner` presets for packing, hierarchy, and 1280/1024 compatibility.
  - Verify preset tests pass.

### T4: Performance & Loading Order
- Files:
  - `features/ai-overview/data/use-overview-reads.ts`
  - `features/ai-overview/data/overview-queries.ts`
  - `features/ai-overview/cards/engines/use-card-data.ts`
  - `features/layouts/use-near-viewport.ts`
  - `features/layouts/layout-grid.tsx`
- Implementation:
  - Adjust lazy loading so below-the-fold cards do not fetch off-screen.
  - Deduplicate summary reads across above-the-fold cards.
  - Measure before/after load times on Eventus Security (134 prompts).

### T5: Tests and E2E Updates
- Files:
  - `e2e/flows/ai-overview.spec.ts`
  - `e2e/support/ai-overview.ts`
  - Unit tests across `features/ai-overview`, `features/layouts`, `lib/layouts`, `components/app/chart`.
- Implementation:
  - Update card title order and assertions in `ai-overview.spec.ts`.
  - Verify all unit and e2e tests pass.

### T6: Gates, As-Built Documentation, AFTER Screenshots
- Run verification gates:
  - `pnpm lint --max-warnings 0` [PASSED]
  - `pnpm typecheck` [PASSED]
  - `pnpm exec vitest run --maxWorkers=3` [PASSED]
  - E2E flows: `ai-overview`, `ai-overview-engines`, `ai-overview-competitors`, `ai-overview-sources`, `ai-overview-topics`, `ai-layouts-core`, `ai-layouts` [139/139 PASSED]
- Capture AFTER screenshots for comparison (/tmp/wp-75/after/) [COMPLETED, 11 screenshots]
- Write As-Built notes in `docs/20-frontend-specification.md` and `docs/design-system/24-page-templates.md` [COMPLETED]
- Commit and push fast-forward to `develop`.
