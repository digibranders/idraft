# WP-37 detailed task plan: AI Visibility Overview cards, sources, fan-out, activity and operations

Brief: [docs/ai-visibility/work-packages/WP-37-overview-cards-sources.md](../../ai-visibility/work-packages/WP-37-overview-cards-sources.md).
Branch `ai/wp-37-cards-sources` in `.claude/worktrees/wp-37`, cut from `origin/develop` at `12e44d2b`, rebased by the coordinator on
`c1b77c07` (WP-35 competitor cards and `src/test/weekly-card-kit.tsx` are in the tree). Kind: web. Rows: 13. Tasks: 8 (T1 to T8), one fresh
Sonnet subagent each, one at a time. Every fact below was read in this worktree; nothing was run.
Paths: `O` = `apps/web/src/features/ai-overview`, `S` = `apps/web/src`, `W` = `apps/web`. Owned: `O/cards/sources/` and `O/cards/activity/`.

## 0. Facts found (they change the brief)

| # | Fact | Consequence |
|---|---|---|
| F1 | The catalog has NO `ai.top_domains`. The keys are `sources.top_domains`, `sources.own_pages`, `sources.new_lost`, `sources.diversity`, `ai.fanout_top`, `ai.citation_share_by_domain_type`, `activity.key_changes`, `activity.collection_status`, `ops.answer_calendar`, `ops.answer_status`, `ops.engines`, `ops.ai_spend` (`S/lib/layouts/catalog.ts` lines 507 to 585, 669, 731, 752). All twelve are active on `ai_overview` | The registry accepts all twelve in `SOURCE_CARDS` and `ACTIVITY_CARDS` today; no catalog edit |
| F2 | CH-16 and WB-OV-07 are ONE card: `ai.citation_share_by_domain_type` (catalog title "Citation share by domain type", inventory 9.4 says "Citation units by source role", CH-16). It is an existing key on `screens: overview, ai_overview`, widths third and half, AI channel | One card, closes both rows. The preview's categories (Owned, Media, Review sites, Community) need `category`, which the API does not return yet (WP-60): the card draws the three roles Own, Competitor, Third party, per engine |
| F3 | CH-34 (treemap) has NO catalog key and the spec says "an alternative view in the Citations frame", not an Overview card. WP-33 plan 5.1: a new key needs a coordinator lease on `catalog.ts` plus `pnpm gen:layout-catalog` and the backend `catalog.json` | Default D4: the treemap is a viewer switch (Bars or Treemap) inside `sources.top_domains`, no key, no lease. The echarts wrapper has no TreemapChart, so the treemap is HTML |
| F4 | WB-OV-12 (new sources count) has no key and no number type either. The preview shows it as one feed row ("New sources: 37 domains"); the Citations page offers it as a number. Citations page (WP-21) already has a New and lost tab | Closes in two places: the headline count of `sources.new_lost` (T4) and one row of `activity.key_changes` (T7), both from one pure `newSourcesCount` |
| F5 | The Overview hooks return the `meta` of one-row reads only (`useOverviewSources` and `useOverviewFanout` send `limit=1`). No hook returns domain rows, page rows, changes, diversity, fan-out rows, runs, daily collection or budgets. `useOverviewSchedule` gives only `nextRunAt` and `paused` | Hook gap G1: each family owns a data module, as WP-35 did (`cards/competitors/data/use-competitor-reads.ts`). Cards read the meta through the Overview hooks where they can (one request, one denominator with the strip) and rows through the family module. No component calls `apiQuery` |
| F6 | `S/lib/citations/source-queries.ts` already has the query factories (`sourceDomainsQuery`, `sourcePagesQuery`, `sourceChangesQuery`, `sourceDiversityQuery`) and `share-model.ts` has `unitShare`, `ownShare`, `roleUnits`, `engineTotals`, `engineShare`, `shareChange`, `isNewSource`. There is no fan-out rows factory (WP-24 not started) | Reuse them (lib is allowed). The family module adds only `source-filters.ts` (OverviewScope to `SourceFilters`) and a fan-out rows factory in `cards/sources/data` |
| F7 | Mocks answer `sources/domains` (series, compare, by_role_by_engine, min_support), `pages`, `changes`, `diversity` (`mocks/handlers/citations.ts`). The `ai/fanout-queries` mock lists NO rows (`rows = []` in `mocks/handlers/ai-overview.ts`, WP-33; WP-24's `fanout.ts` is empty). `ai-health.ts` (WP-30) is empty: no `ai/collection/daily`, `ai-coverage`, forecast or unit costs. `runs`, `schedules`, `costs`, `budgets/status` have mocks (`runs.ts`, `schedules.ts`, `costs.ts`). AI runs exist only for the seeded Eventus project | Lease M1 (fan-out rows), wait for WP-30 task 4a (daily). See section 6 |
| F8 | `ProjectEngine` already carries `estimated_monthly_cost_usd` and `is_enabled` (`GET engines`, shared by `useOverviewEngines`) | `ops.engines` needs no WP-30 route. Its "days asked" come from the schedules read (cadence, weekday) |
| F9 | `GET {W}/budgets/status` is BUILT (and mocked); `costs/forecast`, `costs/unit-costs`, `ai/collection/daily`, `runs/{id}/ai-coverage` are 501 stubs from WP-30 | `ops.ai_spend` is buildable now (spent, limit, state, pct). Forecast line is out of v1 (Q8). CH-20 and CH-21 wait for the daily route's mock |
| F10 | The catalog hides `ops.ai_spend` for a member without `costs:read` (`cardAvailability`, `permission: 'costs:read'`). A viewer has no `costs:read` | Acceptance proof is a test and an e2e step, plus the card makes no request without the permission (defence in depth) |
| F11 | `drillHref('citations', ...)` exists and `citations` is live; `sources` is `planned` so its link is `null`. `DrillExtra` has no tab, role, domain or page key | Own `parts/drill.ts` adds `tab`, `role` and `inspect=domain:<d>` to the `citations` link (D6). No lease on `drill-links.ts` |
| F12 | `ChangeFeed` draws its own frame and title (As built note, 25 section 12.2): a card frame around it doubles the border | `activity.key_changes` renders `ChangeFeed` alone, no `ChartFrame`. Recorded in the As built note |
| F13 | `SmallMultiples` is typed for rates (`RateBandPoint`, `formatPercent`); CH-26 plots counts | CH-26 uses `ChartFrame` `kind="line"` (categories and series with `formatValue`), engines as series, never pooled |
| F14 | `aiOverview.sources` is an empty object in `messages/en.json` (pre-created by WP-33); the contract says WP-37 owns it and the activity cards use it too | Activity words live in `aiOverview.sources.activity.*`. No new top-level namespace |
| F15 | Known gap: Overview read hooks take no `subscribed` option (WP-33). Reads of one key are shared | A card in customize mode mounts and reads (it is `inert`). Family hooks take `enabled` from `useCan` and the engine gates only. When WP-33 adds `subscribed`, pass `live` (note in the As built text) |

## 1. Rows to catalog keys

| Row | Item | Catalog key | Family map | Widths (catalog) | Frame and height | Task |
|---|---|---|---|---|---|---|
| CH-07 | Top cited domains by role | `sources.top_domains` | `SOURCE_CARDS` | third, half | html, `BarList` comparison (+ treemap view), 280 | T1 (T5) |
| CH-08 | Your pages AI engines cite | `sources.own_pages` | `SOURCE_CARDS` | third, half | html, `BarList`, 280 | T2 |
| CH-16 and WB-OV-07 | Citation units by role and engine, 100% bar | `ai.citation_share_by_domain_type` | `SOURCE_CARDS` | third, half | html, `StackedShareBar`, 180 | T2 |
| CH-17 | What ChatGPT searched | `ai.fanout_top` | `SOURCE_CARDS` | half, third | html, `BarList`, 240 | T3 |
| CH-22 and WB-OV-12 | New and lost sources, new count | `sources.new_lost` | `SOURCE_CARDS` | half, third | html, `CountTabs` and two `BarList`, 280 | T4 |
| CH-26 | Source diversity over time | `sources.diversity` | `SOURCE_CARDS` | half, two thirds | line frame, 240 | T4 |
| CH-34 | Treemap by role, design review first | none: view of `sources.top_domains` | `SOURCE_CARDS` | (the card's) | html, 240 body | T5 |
| WB-OV-11 | Collection status | `activity.collection_status` | `ACTIVITY_CARDS` | third, half | html text and counts, 180 | T6 |
| (goal line) | Engines and schedule | `ops.engines` | `ACTIVITY_CARDS` | third, half | html, `PlainTable`, 180 | T6 |
| (goal line) | AI spend | `ops.ai_spend` | `ACTIVITY_CARDS` | third | html, `BudgetMeter`, 140 | T6 |
| CH-20 | Answer collection calendar | `ops.answer_calendar` | `ACTIVITY_CARDS` | half, full | html grid, 240 | T7 |
| CH-21 | Answer status by engine and day | `ops.answer_status` | `ACTIVITY_CARDS` | half, two thirds | bar frame, stacked, 240 | T7 |
| WB-OV-10 | Key changes feed | `activity.key_changes` | `ACTIVITY_CARDS` | half, two thirds, full | `ChangeFeed` alone | T7 |

"Engines and schedule" and "AI spend" of the goal line are `ops.engines` and `ops.ai_spend`. They have no row among the 13 (inventory 9.4 only), so they are built in T6 as supporting work of WB-OV-11 and of the acceptance criterion; the row count stays 13.
All 12 keys: confirmed in the catalog (F1) and in the WP-33 plan 5.12 package map. The default layout holds `sources.top_domains` and `activity.key_changes`, so the Overview screen shows real cards for both after T1 and T7 (its test tells cards apart by item id since 31e25c47 and is NOT edited).

## 2. Decisions taken here (reverse on the coordinator's word)

| # | Decision | Why |
|---|---|---|
| D1 | One family data module per folder: `cards/sources/data/` and `cards/activity/data/`. Meta through the Overview hooks, rows through the module. `source-filters.ts` turns `OverviewScope` into `SourceFilters` with the same rules as `overviewSourcesQuery` (`askedEngines`, `brandedAskable`, `comparisonWindow`, engine filter left out when all enabled engines are asked, `filter[term]`, `filter[country_iso]`, `include_branded`). A parity test asserts the same request params as the shell's read for one scope, so a card's denominator equals the strip's | R12: one denominator, one scope |
| D2 | Flagged citations stay excluded (decision O1): no `include_unresolved_redirects` or `include_engine_internal`. The footnote of every sources card says so in one sentence | Matches the strip and the Citations page |
| D3 | Engines are never pooled silently. Domain, page, role and new/lost cards read the engines in scope as one citation-unit pool because the API aggregates them: the meta line names the engines ("ChatGPT, Gemini"), the footnote says "units pooled over these engines", each row's tooltip and Table view carry the per-engine split. CH-16 and CH-26 are per engine. `meta.effective_sources_engine_average` is labelled "equal-weight mean of the engines" | R7, R12 |
| D4 | CH-34: a short design review is T5 step 1 (checklist below). Default outcome: build an HTML squarified treemap as the second view of `sources.top_domains` at half width and in a container of 448 px or more. Fallback if any criterion fails: a role-grouped ranked bar list (three role sections, each with its units and share, domains under it). The fallback is also what a container under 448 px shows. CH-34 closes either way | Inventory 4.3 CH-34 and the banned-chart table keep the treemap only where units partition |
| D5 | CH-22 closes at window level: new and lost lists with counts (C5 and C6 rules from the route, `min_support` default 2), no weekly diverging bars until N6 gives first-seen weeks. The empty reason of "lost" says a lost source needs 2 windows after it | Spec: "weekly N6". Named reason recorded in the row note |
| D6 | Drill links: `parts/drill.ts` wraps `useCardDrill()('citations')`, adds `tab=domains|pages|new-lost`, `role`, and `inspect=domain:<registrable>` (typed with `formatInspectTarget`). A scope the Citations page cannot show (country set, branded only, window over 91 days) gives `null` and the row is plain text. Runs links use `drill('runs')`. Parity test feeds the links to the Citations page's own parsers (`features/citations/citation-scope.ts`) | The `inspect=domain` key is the page's |
| D7 | Skeletons: a keyed table in `parts/skeletons.tsx` at each card's frame height (pattern of `cards/competitors/skeletons.tsx`); a test asserts the heights equal the frame heights in section 1 | No layout shift |
| D8 | Shared things imported by relative path from other families: `cards/engines/use-card-seams.ts` (`useCardDrill`, `useCardExport`), `use-card-density.ts`, `engine-role.ts` (`engineChartColor`, `engineLabel`, `inCatalogOrder`), `card-phase.ts` (`cardPhase`), `use-card-data.ts` (only `useCardData` for key changes: aggregates and the comparison). Not reused: `use-frame-state.ts` and `card-meta.ts` (they say "valid answers" under `aiOverview.engines.common`); the family has its own `parts/frame-state.tsx` and `parts/source-meta.ts` under `aiOverview.sources.common`, same shape as `cards/competitors/parts/frame-state.tsx` | Words and facts differ: units, domains, runs |
| D9 | Test kit: chart card tests (CH-26, CH-21) import `S/test/weekly-card-kit.tsx` for `echartStandIn`, `drawnOption`, `drawnSeries`, `tooltipText`, `yAxisOf`, `renderCard` (card with fixed options inside provider, grid and export registry) and `readExport`. Its summary builders are for summaries and are not used. HTML cards use `renderWithProviders(cardInOverview(...))` plus an `ExportProvider` probe copied from the kit's pattern | WP-35 shipped it |
| D10 | `ops.ai_spend`: the card reads `budgets/status` only with `useCan('costs:read')`. The budget shown is the project's `ai_prompt` budget, else the workspace `ai_prompt` budget, else the `all` budget, and it names its scope ("Project budget", "Workspace budget"). Several budgets are never added up. No budget: empty state with the reason and a link to the budgets page only for `budgets:manage` (the page ships in WP-30; plain text until its route exists) | Money honesty |
| D11 | Collection and runs: `canViewRuns` from `useOverview()` gates the runs read; without it the card says "Run history is not available for your role". Counts are tasks (answers asked), never rates without their counts | Role matrix |

## 3. Data design

| Hook (family module) | Request | Used by |
|---|---|---|
| `useSourceDomains(options)` in `cards/sources/data/source-reads.ts` | `sourceDomainsQuery(filters, { limit, compare, include, minSupport })` for the scope, plus a second `limit=1` read over `meta.compare_window` when comparing and `previous_answers > 0` (the previous total that `shareChange` needs) | CH-07, CH-34, CH-16 (`include: ['by_role_by_engine']`) |
| `useSourcePages(options)` | `sourcePagesQuery(filters with roles ['own'], { limit })` | CH-08 |
| `useSourceChanges(kind)` | `sourceChangesQuery(filters, { kind, limit })`; the total is `page.total` | CH-22, WB-OV-12, T7 feed |
| `useSourceDiversity()` | `sourceDiversityQuery(filters)` with `include=series` added in the factory call (the lib factory has no `include`: T4 widens it additively, lease L5, or builds the request with `apiQuery` in the module) | CH-26 |
| `useFanoutRows(rows)` | `GET {P}/ai/fanout-queries` with scope filters, `filter[engine_code_in]` limited to engines that show fan-out (the Overview hook's rule), `limit`, `include` none | CH-17 |
| `useAiRuns()` in `cards/activity/data/activity-reads.ts` | `GET {P}/runs?filter[workload_in]=ai_prompt&limit=10`, `enabled: canViewRuns` | WB-OV-11, T7 feed |
| `useAiSchedules()` | `overviewSchedulesQuery(project)` (exported by `O/data/overview-queries.ts`), rows not just `nextRunAt` | `ops.engines`, WB-OV-11 |
| `useCollectionDaily()` | `GET {P}/ai/collection/daily` for `scope.range` and the asked engines | CH-20, CH-21, T7 feed (waits for WP-30) |
| `useBudgetStatus()` | `GET {W}/budgets/status`, `enabled: useCan('costs:read')` | `ops.ai_spend` |
| Existing, unchanged | `useOverview`, `useOverviewSources` (meta for the meta line and footnote), `useOverviewFanout` (meta: answers, `answers_with_fanout`, `engines_without_fanout`), `useOverviewEngines`, `useOverviewPeriods` (key changes, through `useCardData`) | all |

Mock handlers to add: only the fan-out rows (M1). The other routes are answered by existing mocks or by WP-30. `mocks/handlers/index.ts` is not edited.
All query keys start with the project and `ai` (the factories do), so a refresh of the prompts reaches them.

## 4. Folder layout

```text
cards/sources/
  index.ts                 SOURCE_CARDS (this package owns it): six keys
  data/source-filters.ts   OverviewScope to SourceFilters (+ test, parity with overviewSourcesQuery)
  data/source-reads.ts     the five hooks of section 3
  model/                   pure: domain-rows, page-rows, role-mix, changes-model, diversity-model, fanout-model, treemap-layout
  parts/                   frame-state.tsx, source-meta.ts, drill.ts, skeletons.tsx, role-treemap.tsx (T5), role-grouped-list.tsx (T5)
  top-domains-card.tsx  own-pages-card.tsx  role-share-card.tsx  fanout-top-card.tsx  new-lost-card.tsx  diversity-card.tsx
cards/activity/
  index.ts                 ACTIVITY_CARDS: six keys
  data/activity-reads.ts   useAiRuns, useAiSchedules, useCollectionDaily, useBudgetStatus
  model/                   collection-status, schedule-days, spend-model, calendar-model, status-model, feed-model
  parts/skeletons.tsx
  collection-status-card.tsx  engines-card.tsx  ai-spend-card.tsx  answer-calendar-card.tsx  answer-status-card.tsx  key-changes-card.tsx
```
Every card file: `'use client'`, default export `ComponentType<CardProps>`, `ChartFrame` (except the feed), data only through the hooks above, `useCardExport(item.id, getBlock)` with the Table view's rows, `useCardDrill` and `useCardDensity` from `../engines/`, words from `useTranslations('aiOverview.sources.<card>')`, `Delta`, `SampleCount`, `MetricInfo` from `components/app`. The registration entry is `'key': { load: () => import('./x-card'), skeleton: SOURCE_SKELETONS['key'] }`.

## 5. Common rules for every task

- Skill: invoke `design-taste-frontend` BEFORE the first markup or style file of T1, T2, T4, T5, T6, T7 (project docs outrank the skill's house style: Geist, the token set, radii and `type-*` utilities stay).
- Tests first and seen red for the right reason; then code; green; then the checks; then ONE commit `WP-37: <title>` naming only this package's files (no attribution, no dashes). File tools only (no heredocs, `sed`, replace scripts). Files are pure ASCII: `grep -nP '[^\x00-\x7F]' <files>` prints nothing (curly quotes in `en.json` follow the file's existing style: read first).
- A fresh Sonnet reviewer after every task: reads the task and the diff, runs the task's targeted tests, checks the house rules, returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks. Prove it bites: for each guard (detectable-only colour, `min_support` exclusion, unknown never zero, permission gate on spend, role gate on runs, pooled wording), the reviewer weakens it in a scratch commit that is never pushed, records the failing test name, restores it.
- House rules: tokens only (no hex, palette classes, arbitrary values), `type-*` utilities, `num` on compared numbers, spacing scale, `@/lib/format` for every number and date (`formatInteger`, `formatPercent`, `formatPointsDelta`, `formatDateRange`, `formatRelative`, `formatCurrency`, `formatList`, `EMPTY_VALUE`), no `Intl`, `toFixed`, `toLocaleString`; every word from `messages/en.json` (`i18next/no-literal-string` covers `src/features/**`); a feature imports app components, ui, lib, providers and its own feature only (not `features/citations`, `features/operations`, `features/costs`); no `any`, explicit return types, no non-null assertion; colour only from `formatMetricDelta` tones; no pie or donut; no em-dash or en-dash anywhere; every percent shows its count; unknown never zero; engines never pooled silently; provider text (query text, URLs, domains) is React text only, never markup; external links through `URLCell` or `DomainCell`.
- States for every card (tests name them): loading skeleton at final height, empty (reason and action), error (retry and error id), partial (comparison missing), stale (last figures read), refetching (data kept, no dimming, the frame's refetch bar), idle (no engine asked: empty, never zero), small sample ("n of m" with `SampleCount`), pooled wording, customize mode (card inside `inert`, no click targets).
- Responsive and themes: 390, 768, 1024, 1280 px, light and dark, Default and Compact density, no sideways scroll, targets 24 px, axe no serious or critical.
- Targeted check commands (from `apps/web`, medium lane, never plain `pnpm test`, `pnpm build` or `pnpm e2e` before T8): `infra/dev/heavy --lane medium --label wp37-tN-test -- bash -c 'cd apps/web && pnpm exec vitest run <paths> --maxWorkers=3'`, then `pnpm lint`, `pnpm typecheck`, `pnpm format:check`; any task that edits `en.json` also runs `pnpm exec vitest run src/i18n/messages.test.ts --maxWorkers=3`; every task also runs `pnpm exec vitest run src/features/ai-overview/cards/registry.test.ts src/features/ai-overview/ai-overview-screen.test.tsx --maxWorkers=3` (the registry throws for a key that is not an active `ai_overview` type).
- Browser check per task that draws (headless Playwright Chromium, the built-in pane cannot register the MSW worker): dev server on port 3213 only, `NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p 3213` (reuse one that already runs for this worktree; never kill a process to free a port; delete the `AGENTS.md` and `CLAUDE.md` that `next dev` writes in `apps/web`). Pages: `/digibranders/eventus-security/ai` (dev seed: 92 days of answers and AI runs) and `/digibranders/fynix/ai`. Accounts: `priya@digibranders.test` (editor), `mei@digibranders.test` (viewer, no `costs:read`).

## 6. Tasks

### T1: sources foundation and CH-07 top cited domains (rows CH-07)

Files (create): `O/cards/sources/data/source-filters.ts`, `data/source-reads.ts`, `model/domain-rows.ts`, `parts/frame-state.tsx`, `parts/source-meta.ts`, `parts/drill.ts`, `parts/skeletons.tsx`, `top-domains-card.tsx`, each with its `.test.ts(x)` beside. Change: `O/cards/sources/index.ts` (entry `sources.top_domains`), `W/messages/en.json` (`aiOverview.sources.common`, `aiOverview.sources.topDomains`).
Behaviour: `BarList` comparison mode, rows = domains by citation units (option `rows` 5, 8, 10; option `role` all, third_party, competitor passed as `roles`). Own domain bar `chart-1` with `own: true`; `DomainRoleBadge` as `badge`; value "10.4%" and context "1,912 of 18,420 units", tooltip "g2.com, 1,912 citation units in 1,104 answers, 211 prompts; previous 1,640 units" and the per-engine split; `Delta` of the share through `shareChange` with `test: 'interim'` and `isDetectable: null` (no detectability from the API: neutral, never coloured); rows below `min_support` 2 are not listed (route); `compare` read only while `scope.compare`. Meta: window, "N citation units in M answers", engines named. Footnote: pooled over these engines, flagged citations left out, `min_support`. Row link: `parts/drill.ts` to `citations?tab=domains&inspect=domain:<d>` (plain text when `null`). Table view: `BarListTable`; export block: `barListCsv` plus role and engine columns.
Tests first: `source-filters.test.ts` (all engines asked leaves the engine filter out; a subset sends it; country and topic; branded only is not askable; the params equal `overviewSourcesQuery` for the same scope); `source-reads.test.tsx` (one request for two cards with equal options; the previous-total read only with comparison on and `previous_answers > 0`); `domain-rows.test.ts` (share equals `unitShare`; thin share is `null` not 0; own row first flagged; a domain with two roles stays two rows); `drill.test.ts` (links parse back through the Citations page's `parseCitationScope`; country scope gives `null`); `skeletons.test.tsx` (heights); `top-domains-card.test.tsx` cases: loading skeleton, idle with no engine on (Cleanstart), empty ("No answer cited a source in this window"), error with retry and error id (`server.use` 500), stale, refetching keeps rows, partial (comparison missing: no delta, notice), small units ("fewer than 2 units not listed"), counts beside every percent, own row `chart-1` and role badge text, roles option narrows rows but the denominator stays the scope's total, drill link and plain text, Table view equals the accessible text, export block id equals `item.id`, keyboard (Tab reaches each row link, Enter follows), axe in both densities, no em-dash or en-dash in rendered text.
Rows closed: CH-07. i18n: `aiOverview.sources.common`, `aiOverview.sources.topDomains`. Leases: `W/messages/en.json` (own namespace). House rules: section 5.

### T2: CH-08 own pages and CH-16 and WB-OV-07 citation share by role (rows CH-08, CH-16, WB-OV-07)

Files (create): `model/page-rows.ts`, `model/role-mix.ts`, `own-pages-card.tsx`, `role-share-card.tsx` and tests. Change: `index.ts` (two entries), `en.json` (`ownPages`, `roleShare`).
Behaviour CH-08: `BarList` of own pages (`useSourcePages`), path shown with the host hidden when one own domain, title in the tooltip, bar `chart-1`, value "612 units", context "in 88 prompts", engine split in the tooltip ("ChatGPT 301, Gemini 112"), first cited date; row links to `citations?tab=pages&role=own&inspect=source:<url_id>`; empty: "No answer cited your pages in this window" with a link to Prompts where you are named and not cited (`drill('prompts')`); URLs through `URLCell` rules (unsafe schemes shown as text).
Behaviour CH-16 and WB-OV-07: `StackedShareBar` (Own `chart-1`, Competitor `chart-2`, Third party `chart-other`; `chart-1` only for the own segment), one row per asked engine from `meta.by_role_by_engine` (never pooled), `denominatorText` "of 2,842 citation units", an engine with no unit is `none` ("No citation on this engine", never 0%), fewer than the thin threshold uses `kind: 'thin'`; legend table has counts; Patterns toggle; no donut. Footnote: roles only, categories arrive with source intelligence.
Tests first: `page-rows.test.ts` (host hidden only with one own domain; units and prompts as in the row); `role-mix.test.ts` (shares add to 1 per engine; zero total is `none`; engine order is the catalog order; `roleUnits` parity with `meta.by_role` summed over engines); card tests with the T1 state list, plus: engines are separate rows, Table view equals the accessible text, export block, axe, 390 px legend does not overflow.
Rows closed: CH-08, CH-16, WB-OV-07. i18n: `ownPages`, `roleShare`.

### T3: CH-17 what ChatGPT searched (row CH-17; lease M1)

Files (create): `model/fanout-model.ts`, `fanout-top-card.tsx`, `S/mocks/ai-fanout-queries.ts` (new fixture builder, no owner) and tests. Change: `S/mocks/handlers/ai-overview.ts` (lease M1: the existing `ai/fanout-queries` handler fills `rows` and `page.total` from the fixture builder, honours `min_support`, `limit`, `offset`, `filter[engine_code_in]`; keeps `meta` as is; tell the WP-24 owner), its test file `ai-overview.test.ts`, `index.ts`, `en.json` (`fanout`).
Behaviour: `BarList` of queries by answers that issued them, value "issued in 14 of 96 answers" (`meta.answers` is the denominator, `answers_with_fanout` in the footnote), marker badge "Own domain cited" when an own row is among `cited_domains` (text badge, not colour alone), tooltip with the 5 `cited_domains` ("an association, not a link"). Engines without fan-out: "Fan-out is not exposed by Gemini and AI Mode" from `meta.engines_without_fanout`; no engine on that shows fan-out: empty state with the reason; `answers_truncated` in the footnote; option `rows` 5 or 10. Query text is provider text: React text only, cut by the route. No drill (WP-24 owns the Fan-out page; `null` until it is live).
Tests first: the mock handler returns rows that satisfy the generated `FanoutQueryPage` shape (zod typed on `Schemas`), order by observations, respect `min_support`; `fanout-model.test.ts` (own-cited marker; the denominator is `meta.answers`; unknown is not 0 when `engines_without_fanout` holds every engine in scope); card cases: states of section 5, hostile query text rendered as text (xss fixture `components/app/cells/xss-fixtures.ts`), Gemini-only scope shows the not-exposed empty state, Table view and export.
Rows closed: CH-17. i18n: `fanout`. Leases: M1.

### T4: CH-22 new and lost, WB-OV-12 count, CH-26 diversity (rows CH-22, CH-26, WB-OV-12)

Files (create): `model/changes-model.ts`, `model/diversity-model.ts`, `new-lost-card.tsx`, `diversity-card.tsx` and tests. Change: `index.ts`, `en.json` (`newLost`, `diversity`); `S/lib/citations/source-queries.ts` only if `sourceDiversityQuery` must take `include` (lease L5, additive optional parameter, existing tests untouched), else the module calls `apiQuery` for that one request.
Behaviour CH-22 and WB-OV-12: `CountTabs` "New 37" and "Lost 5" (counts from `page.total`, one request per kind), the headline "37 new domains" with "of 412 domains cited" (distinct domains from `meta` or diversity when read; omitted when unknown), the selected list as `BarList` (domain, units now, units before, role badge), the `newSourcesCount` pure function (also used by T7). New needs `meta.previous_answers > 0` else "No answers in the window before: new sources cannot be told" (never 0 new). Lost shows only what the route returns; empty reason explains C6. Row link: `citations?tab=new-lost&kind=new|lost`.
Behaviour CH-26: `ChartFrame kind="line"`, categories = weeks, one series per asked engine, a view control (Distinct domains or Effective sources, viewer state), each engine its colour via `engineChartColor`; value text "41 domains" or "18.6 effective sources" with the formula in `MetricInfo` (inverse HHI, both inputs visible in the Table view: units and domains per week); a week with no unit is a gap (null), not 0; `meta.effective_sources_engine_average` as a footnote labelled "equal-weight mean of the engines with units"; summary sentence names first and last point.
Tests first: `changes-model.test.ts` (count equals `page.total`; no previous answers is `null` not 0; min_support passthrough); `diversity-model.test.ts` (null week stays null; engines never summed; average only from the API field); card tests with the weekly-card-kit (`echartStandIn`, `drawnSeries` has one series per engine, `tooltipText`, gaps are `null`), states of section 5, the tab switch is keyboard operable and announces, Table view and export.
Rows closed: CH-22 (window level, D5), CH-26, WB-OV-12. i18n: `newLost`, `diversity`.

### T5: CH-34 treemap, design review first (row CH-34)

Step 1, design review (short, one subagent, output appended to this file under "T5 review result", then the implementer proceeds). Checklist: C1 tiles partition the whole (sum of tile units plus the remainder tile equals `meta.citation_units`; the remainder is "312 more domains", never dropped); C2 area equals units on one pass of a squarified layout, no minimum-area inflation; C3 role is colour and text ("Own", "Competitor", "Third party" label on the group, never colour alone), `chart-1` only for Own, label contrast from `LABEL_ON` of `stacked-share-bar.tsx`; C4 labels only on tiles of 48 by 24 px or more, others in the tooltip and the Table view; C5 Table view lists every tile with units, share and role, tiles are not focusable, an accessible summary sentence; C6 container under 448 px shows the fallback, not a squeezed treemap; C7 no gradients, 1 px `surface` borders, no animation. Outcome per criterion goes in the result: all pass means ship the treemap; any fail means ship only the fallback.
Files (create): `model/treemap-layout.ts` (pure squarify with a test), `parts/role-treemap.tsx`, `parts/role-grouped-list.tsx`, tests. Change: `top-domains-card.tsx` (a `Bars or Treemap` single-choice control in the frame's `controls`, viewer state, shown at half width only), `en.json` (`topDomains.treemap*`). The data is the T1 read with `limit=200` (one extra request only when the Treemap view is chosen) plus `meta.citation_units` for the remainder.
Tests first: `treemap-layout.test.ts` (areas proportional within 1 px of rounding; tiles do not overlap and fill the box; a zero-unit row is dropped and counted; deterministic order); `role-treemap.test.tsx` (remainder tile present and equals the difference; labels only above 48 by 24; Table view has every tile; no focusable tile; role words present; `chart-1` only on Own); `role-grouped-list.test.tsx` (three role sections with units and share, counts printed, domains under their role); container under 448 px renders the list (resize stub); card test for the control (keyboard, URL not touched, announce); axe in both themes.
Rows closed: CH-34 (decision and outcome recorded in the row note and in the As built text).

### T6: collection status, engines and schedule, AI spend (rows WB-OV-11; supports the acceptance criterion)

Files (create): `cards/activity/data/activity-reads.ts` (`useAiRuns`, `useAiSchedules`, `useBudgetStatus`), `model/collection-status.ts`, `model/schedule-days.ts`, `model/spend-model.ts`, `parts/skeletons.tsx`, `collection-status-card.tsx`, `engines-card.tsx`, `ai-spend-card.tsx` and tests. Change: `cards/activity/index.ts` (three entries), `en.json` (`activity.collection`, `activity.engines`, `activity.spend`).
Behaviour WB-OV-11 (`activity.collection_status`): the newest finished AI run ("AI prompts, Nov 12, 02:10: 238 of 250 answers asked collected, 12 failed" from `tasks_succeeded`, `tasks_failed`, `tasks_total`, counts always printed), an open run shown as "Collecting: 90 of 250", the next AI run from `useOverviewSchedule`, paused ("All AI schedules are paused", not "none"), budget blocked runs named; link "View runs" via `drill('runs')`; without `canViewRuns` the words of D11; no AI run yet: empty with the next run date.
Behaviour `ops.engines`: `PlainTable`, one row per project engine: logo and name, On or Off, days asked (Mon, Thu from the schedules: weekly weekday names, daily is "Every day", cron is "Custom schedule", none is "Not scheduled"), next run for the engine's schedule, estimated monthly cost from `estimated_monthly_cost_usd` marked "estimate" (null is "n/a", never $0; an engine that is off shows the cost "if on" labelled so). Engines are rows, never added up.
Behaviour `ops.ai_spend`: `BudgetMeter` (`pct`, `softLimitPct`, `state`) with "$12.40 of $50.00 this month (25%)", committed estimate named separately ("$1.20 committed by runs under way"), D10 budget choice, scope named. Without `costs:read` the card does not read (request count asserted zero) and shows nothing it should not (the catalog also hides it).
Tests first: `collection-status.test.ts` (newest finished run chosen; counts equal the run; paused versus none; budget_blocked named); `schedule-days.test.ts` (weekly weekday names in order, daily, cron, none); `spend-model.test.ts` (D10 choice order; pct from the API, not recomputed; no budget is `null`; money through `formatCurrency`); card tests: states of section 5, Eventus seed (`setAiSeeded(true)`, world `eventus-security`) has runs, Fynix has none (empty), a viewer (`role: 'viewer'`) renders spend with zero `budgets/status` requests, a role without runs access sees D11 words, hard exceeded state uses the meter's tone, keyboard, axe, Compact density row height `h-row-compact`.
Rows closed: WB-OV-11 (plus `ops.engines` and `ops.ai_spend` built). Reads of built routes only: no WP-30 dependency. i18n: `activity.collection`, `activity.engines`, `activity.spend`.

### T7: CH-20 calendar, CH-21 status, WB-OV-10 key changes (rows CH-20, CH-21, WB-OV-10; waits for WP-30)

Start condition: WP-30 task 4a (`ai/collection/daily` mock in `S/mocks/handlers/ai-health.ts`) is on develop. If it is not, T7 starts with the key changes feed (the part that needs no daily route) and the two chart cards follow after the rebase; the tests of the charts type their fixtures against `Schemas['CollectionDailyResponse']` through `server.use`.
Files (create): `data/activity-reads.ts` gains `useCollectionDaily`; `model/calendar-model.ts`, `model/status-model.ts`, `model/feed-model.ts`, `answer-calendar-card.tsx`, `answer-status-card.tsx`, `key-changes-card.tsx` and tests. Change: `index.ts` (three entries), `en.json` (`activity.calendar`, `activity.status`, `activity.keyChanges`).
CH-20: a calendar grid (rows weekdays, columns weeks): first try `HeatmapGrid` (read its As built note: `columns`, `rows`, `scale: 'sequential'`, fixed bins from `heat-bins.ts`); if its cell model cannot carry "no schedule", failure glyph and budget-blocked glyph, write `calendar-grid.tsx` as an HTML grid that uses `binOf` from `heat-bins.ts` (one bin function, as its guard test demands). Cell fill = valid over scheduled answers; no schedule that day is `surface`; a failure glyph with count and a distinct budget-blocked glyph (glyph and text, not colour alone); tooltip "Thu Nov 6: 742 of 750 answers valid, 6 refused, 2 errors"; `scheduled: null` is "Schedule unknown", never 0. One engine at a time through `CountTabs` (engines never pooled), default the first asked engine.
CH-21: `ChartFrame kind="bar" stacked`, categories = run days, series valid, partial, empty, refused, error as counts (not rates), valid `chart-reference`, others palette in order, Patterns available, one engine at a time through the same tab control, tooltip with counts and `scheduled`.
WB-OV-10: `ChangeFeed` alone (F12), groups "Needs attention", "Changes", "Notices" with counts: detectable engine rate falls (needs attention) and rises (changes) from `useCardData({ previous: 'optional' })` aggregates and `lib/compare/change-model` (`rateChange`, `isDetectableChange`; an undetectable move is never a row, never "fell by 0.4"), collection issues (latest run failures from `useAiRuns`, a day with refused or error answers from daily, budget blocked runs), "New sources: 37 domains" from T4's `newSourcesCount`, `hold` text when the comparison is off. Each row links through `drill`. Option `rows` 5 or 8. Rows announced through the page announcer (the part does it). Ordered most urgent first. Empty: "No change beyond normal variation in these 28 days".
Tests first: `calendar-model.test.ts` (weeks and weekdays in the project's zone; `scheduled: null` stays unknown; the cell value equals valid over scheduled; engine tabs never sum); `status-model.test.ts` (the five statuses add up to `answers`; `valid` is complete plus partial, as the route defines it: read WP-30 plan D1 and the c3 note first); `feed-model.test.ts` (detectable only; urgency order; zero new sources is a row only when it can be told; no comparison gives `hold`); card tests: states, drill links, export blocks (`readExport`), keyboard through the tabs and the feed rows, axe, 390 px calendar scrolls inside its container, Compact density.
Rows closed: CH-20, CH-21, WB-OV-10. i18n: `activity.calendar`, `activity.status`, `activity.keyChanges`.

### T8: e2e, As built notes, rebase, final checks, push (process; step 4 of the brief)

Files (create): `W/e2e/flows/ai-overview-sources.spec.ts`, `W/e2e/support/ai-overview-sources.ts` (shared constants and helpers; `e2e/support.ts` is frozen). Change (append only): `docs/20-frontend-specification.md` (an "As built: AI Overview source and activity cards (WP-37)" section) and `docs/design-system/25-component-inventory.md` (As built lines under 10.10 BarList, 10.6 and the stacked bar, 12.2 ChangeFeed, 17.2 BudgetMeter for the uses and the F12 note; the treemap as a feature part).
e2e flow (mock mode, dev port 3213 only, signed in as `priya@digibranders.test`, then `mei@digibranders.test`): open `/digibranders/eventus-security/ai`; the cards `sources.top_domains` and `activity.key_changes` of the built-in layout are real (titles "Top cited domains" and "Key changes", no pending card); add the other cards through customize (Add card) or open the SEO analyst preset for `sources.own_pages`, `ai.citation_share_by_domain_type`, `ai.fanout_top`; each new card visible with counts beside percents; a domain row link opens Citations with `tab=domains` and the domain inspector, the browser back returns with the Overview scope intact; the New and lost count opens `tab=new-lost`; "View runs" opens Runs; the Treemap view (if shipped) switches and the Table view lists every tile; `ops.ai_spend` is listed in the Add card catalog for the editor and shows the budget meter; as the viewer the catalog does not list AI spend and the page has no spend card and made no `budgets/status` request; no `console` error and no policy violation (`watchPolicy`); `expectAccessible` (no serious or critical) at 390, 768, 1024, 1280 in light and dark (theme through `localStorage 'idraft.theme'`), Default and Compact density through Preferences. The flow must not reload after a mock write.
Steps: `git fetch origin && git rebase origin/develop` (en.json: keep both sides then the i18n test; generated files never merged by hand); read `/tmp/idraft-health/state` for the lock (`level=OK`); delete untracked `W/AGENTS.md` and `W/CLAUDE.md` before and after builds; then `infra/dev/heavy --label wp37-web --wait 30 --max 40 -- bash -c 'cd apps/web && pnpm lint && pnpm typecheck && pnpm format:check && pnpm exec vitest run --maxWorkers=3 && pnpm build'`, then the e2e spec plus `e2e/flows/ai-layouts.spec.ts` and `design-system.spec.ts`. A second fresh Sonnet reviewer reads the whole diff against the brief's acceptance criteria and the row list and opens every changed page at the four widths in both themes and densities. `git push origin HEAD:develop` (fast-forward only), then `infra/dev/wp-status`. Rows closed: process.

## 7. Files outside the owned directories (leases)

| # | File (owner) | Task | Smallest edit |
|---|---|---|---|
| L1 | `W/messages/en.json` (shared) | T1 to T7 | Only objects under `aiOverview.sources` (pre-created, empty): `common`, `topDomains`, `ownPages`, `roleShare`, `fanout`, `newLost`, `diversity`, `activity.{collection,engines,spend,calendar,status,keyChanges}`. Additive, camelCase |
| L2 (M1) | `S/mocks/handlers/ai-overview.ts` and `ai-overview.test.ts` (WP-33), new `S/mocks/ai-fanout-queries.ts` | T3 | The fan-out handler lists rows from a fixture builder; meta unchanged. Delete the "WP-24 will own it" comment only if WP-24 has landed |
| L3 | `S/mocks/handlers/ai-health.ts` (WP-30) | T7 | None by this package: wait for WP-30 task 4a. If it slips past T6, ask the coordinator before writing the daily handler here |
| L4 | `W/e2e/flows/ai-overview-sources.spec.ts`, `W/e2e/support/ai-overview-sources.ts` | T8 | New files |
| L5 (optional) | `S/lib/citations/source-queries.ts` (WP-21) | T4 | `sourceDiversityQuery` takes an optional `include`; existing callers and tests unchanged. Without it the module builds the one request itself |
| L6 | `docs/20-frontend-specification.md`, `docs/design-system/25-component-inventory.md` | T8 | Append only |
| Not needed | `lib/layouts/catalog.ts`, `catalog.json`, `drilldown/drill-links.ts`, `data/overview-queries.ts`, `data/use-overview-reads.ts`, `mocks/handlers/index.ts`, `components/app/chart/echart.tsx`, `components/design-system/registry.ts`, `ai-overview-screen.test.tsx`, the harness | | Reasons in F3, F5, F11, D4, D6. The treemap stays a feature part, so no gallery entry |

## 8. Rows waiting on WP-30

| Row or card | Waits for | Plan |
|---|---|---|
| CH-20, CH-21 | `ai/collection/daily` mock (WP-30 task 4a) and the real route later | T7 starts after 4a; until the real route is wired the card reads the mock only. If the route answers 501 in the dev API the card shows its error state with retry |
| WB-OV-10 collection issues from daily | the same | The feed uses the runs read first; daily adds the refused and error days when present |
| `ops.ai_spend` forecast line | `costs/forecast` (stub) | Not in v1 (Q8) |
| `ops.engines` | none | Uses `estimated_monthly_cost_usd` of the engines read |
| WB-OV-11, `ops.ai_spend` | none | Built routes and existing mocks |
| Per engine coverage of a run (`runs/{id}/ai-coverage`) | stub | Not used |

## 9. Open questions (default taken)

| Q | Question | Default |
|---|---|---|
| Q1 | Does the coordinator want CH-34 as a catalog key or a saved option (lease on `catalog.ts`, regenerate `catalog.json`, backend catalog test)? | No: a viewer switch inside `sources.top_domains` (D4) |
| Q2 | Fan-out rows in the mock: this package edits WP-33's handler, or WP-24 adds them first? | Edit it (L2) and tell WP-24 |
| Q3 | WP-30 task 4a timing for T7? | Run T1 to T6 first; T7 after 4a |
| Q4 | A `subscribed` option on the Overview hooks (WP-33) | Not asked; pass `live` when it lands |
| Q5 | CH-22 weekly diverging bars need N6 (first-seen week per domain) | Window level only (D5) |
| Q6 | Domain categories (Owned, Media, Review, Community) need WP-60 | Roles only (F2) |
| Q7 | `/ai/sources` is planned, so links to the Sources page are plain text | Keep; WP-61 flips it |
| Q8 | Forecast line on `ops.ai_spend` | Omit until WP-30 builds the route |
| Q9 | `activity.key_changes` without a `ChartFrame` (F12) | Accept; revisit when `ChangeFeed` gets a frameless option |
| Q10 | `ops.engines` and `ops.ai_spend` are in no built-in layout or preset | Addable through Add card only; the coordinator may ask WP-33 for a preset line |
| Q11 | `ai.fanout_top` has no engine requirement in the catalog | The card's own empty state says why (T3) |
| Q12 | Detectability of a source share change has no API field | `test: 'interim'`, never coloured until the API sends `is_detectable` |

## 10. Rows

| Row | Task | Proof |
|---|---|---|
| CH-07 | T1 (T5 view) | `top-domains-card.test.tsx`, e2e domain row link |
| CH-08 | T2 | `own-pages-card.test.tsx` |
| CH-16, WB-OV-07 | T2 | `role-share-card.test.tsx` |
| CH-17 | T3 | `fanout-top-card.test.tsx`, mock handler shape test |
| CH-22, WB-OV-12 | T4 (T7 row) | `new-lost-card.test.tsx`, `changes-model.test.ts`, `feed-model.test.ts` |
| CH-26 | T4 | `diversity-card.test.tsx` |
| CH-34 | T5 | design review result and `role-treemap.test.tsx` or `role-grouped-list.test.tsx` |
| WB-OV-11 | T6 | `collection-status-card.test.tsx` |
| CH-20, CH-21 | T7 | `answer-calendar-card.test.tsx`, `answer-status-card.test.tsx` |
| WB-OV-10 | T7 | `key-changes-card.test.tsx` |

Estimate: T1 1.5 h (foundation), T2 1 h, T3 1 h, T4 1.5 h, T5 1.5 h, T6 1.5 h, T7 1.5 h, T8 1 h: about 10 h with one task in flight (the brief says 6 tasks and 4 hours; the data module, the treemap review and the closing task are the extra work).
