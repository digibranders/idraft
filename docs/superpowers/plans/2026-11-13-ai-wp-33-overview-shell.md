# WP-33 detailed task plan: AI Visibility Overview shell (scope, numbers, notices, presets, export)

Brief: [docs/ai-visibility/work-packages/WP-33-overview-shell.md](../../ai-visibility/work-packages/WP-33-overview-shell.md).
Branch `ai/wp-33-overview-shell` in the worktree `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6` (the brief names
`.claude/worktrees/wp-33`; this session stays where it was given), cut from `develop` at `9c1ca1ca` (WP-15 and WP-16
merged). Kind: web. Rows: 7 (WB-IA-01, WB-OV-01 to 04, 13, 14). Owner requirements R-06 to R-08: a GREATER version of
the approved preview dashboard with the same FULL customization, sleek and professional.

Specs: [overview-and-charts.md](../../ai-visibility/inventory/overview-and-charts.md) sections 1, 3, 9.1 to 9.7, 12;
[layout design](../specs/2026-09-30-layout-customization-design.md) (As built of WP-15 and WP-16 at the end of section
10); WP-16 plan section 5 (the integration contract this package consumes);
[24-page-templates.md](../../design-system/24-page-templates.md) T1 and 9.2; DS 17 (states), DS 25 (parts).

## 1. Scope

### 1.1 Goal

The page `/[workspace]/[project]/ai` as a T1 customizable dashboard, built so that the four card packages (WP-34 to 37,
other sessions) only add cards: header with AI freshness, scope in the URL (window, compare on by default, engines,
country, topic, branded), notices and the empty and no engine states, the numbers strip with the AI number catalog,
the `ai_overview` screen definition and its full card catalog, the five presets behind Start from (D-01: code),
Export Numbers (CSV), drill-down helpers, the data hooks every card reads through, the card registry with a
placeholder for every card not built yet, and the navigation entry flipped live last. Data: the reads that are built
and mocked today (summary with the previous window, engines, sources, fan-out meta, schedules). WP-32 (backend
aggregates) is not started and its routes are not in `openapi/v1.json`, so the shell isolates every read behind one hook
and swaps inside it later (section 3.3).

### 1.2 What exists (read before every task, do not rebuild)

| Exists | Where | Use here |
|---|---|---|
| `CustomizableScreen`, `CustomizeButton`, `CustomizingBadge`, `NumberStrip`, `CustomizableGrid`, `definePresets`, `defineCards`, `useLayoutCapabilities`, `useLayoutScreen`, `useCustomize`, `LayoutSaveBar` (inside the screen), `StartFromMenu` | `features/layouts/index.ts`, `customize-specimen.tsx` is the reference composition | The whole customize half of the page |
| `SCREENS.ai_overview` (zones numbers, cards, widths; `builtin` empty), `CARD_TYPES`/`NUMBER_TYPES` (all `screens: ['overview']`), `packRows`, `sanitizeLayout` | `lib/layouts/catalog.ts`, `rows.ts`, `sanitize.ts` | T2 fills them. A card type that does not list `ai_overview` in `screens` is dropped by `sanitizeLayout` |
| `PageHeader` with `titleAddon`, `MetricStripItem.href` | `components/app/shell/page-header.tsx`, `components/app/metric/metric-strip.tsx` (WP-16 leases, merged) | Header, numbers as links |
| `useDateRangeParams`, `DateRangePicker`, `TopBarPortal`, `useZoneDay`, `FilterBar`, `useUrlFilters`, `Banner`, `EmptyState`, `InlineError`, `Menu`, `Select`, `Popover`, `MultiSelect`, `Delta`, `EngineLogo` | `components/app/*`, `components/ui/*`, `lib/dom/use-zone-day` | Scope and states, exactly as `features/prompts/prompts-screen.tsx` uses them |
| `engineRates`, `RateFigure`, `shareOfVoiceTotals` (`lib/rates/strip-model.ts`), `cellFigure`, `averageRate` (`lib/rates/rate-model.ts`), `isDetectableChange`, `differenceInterval`, `MIN_OBSERVATIONS` (`lib/stats`), `formatMetricDelta`, `formatPercent`, `formatPointsDelta`, `formatSampleCount` (`lib/format`) | `lib/*` | One denominator per number: the same arithmetic as the Topics and Prompts strip, so R12 holds across pages |
| `csvBlob`, `downloadBlob`, `safeText`, `CsvTable` | `lib/csv/csv-write.ts` | Export Numbers |
| `useShortcut` (honours the single key switch) | `lib/a11y/use-shortcut.ts` | Shortcuts |
| MSW world: Eventus (dev seed, 92 days of answers), Fynix (3 engines, 24 prompts), Cleanstart (engines off); handlers for `prompts-summary` (series, entities, rows), `engines`, `schedules`, `runs`, `ai/sources/*` (WP-21 `citations.ts`) | `mocks/` | All page tests and the browser checks |
| `aiOverviewHandlers` (empty, registered by WP-02 after `promptAnswerHandlers`), namespace `aiOverview` with empty `engines`, `competitors`, `topics`, `sources` | `mocks/handlers/ai-overview.ts`, `messages/en.json` | Own handler module and message namespace |
| Route file `ai/page.tsx` re-exporting the 404 page; `planned-routes.test.ts` and `registry.test.ts` pin `/ai` and `aiOverview` as planned | `app/[workspace]/[project]/ai/page.tsx` | T5 replaces the route and removes its row from `planned-routes.test.ts`; T12 flips the entry and edits `registry.test.ts` |

### 1.3 Findings that shape the plan

| # | Finding | Consequence |
|---|---|---|
| F1 | The screen key is `ai_overview` (`overview` is the project Overview). Existing AI card types list only `overview`. | T2 adds `ai_overview` to the five reused types and adds every type of inventory 9.4 that WP-34 to 37 build, because presets and the built-in layout must sanitize unchanged (`definePresets` throws otherwise). Lease L2 |
| F2 | ESLint boundaries (`eslint.config.mjs` policy 3): a feature may import only its own feature. `features/layouts` is a feature, so `features/ai-overview` importing `@/features/layouts` fails `pnpm lint`. No production code outside `features/layouts` imports it today (WP-16 plan section 5 assumed it could). | Lease L1 (one policy line) is a BLOCKER for T5. Fallback in section 11 |
| F3 | The only handler array position available is after `promptAnswerHandlers`. MSW uses the first match, so `aiOverviewHandlers` cannot override `GET ai/prompts-summary`; the old summary mock rejects `compare`, `include=total` and `include=cells` with a 422 and WP-20 holds the lease on `prompt-answers.ts` and `prompt-summary.ts`. | The shell reads the summary twice (this window and the previous one) and aggregates on the client with `lib/rates`, which both the mock and the real API answer today. Swapping to one read with `compare=previous_period&include=total&rows=none` is follow-up F1 and touches only `data/` |
| F4 | `ai/metrics/*`, `ai/competitors` and `overview/competitors` (WP-32) are absent from `backend/openapi/v1.json` and `schema.ts`. WP-12 (summary compare, total, rows, cells, co-mentions, by country), WP-14 (sources with country, term and engine filters, changes, diversity, fan-out) and `ai/collection/daily` are built. | No typed mock for WP-32 can be written. The number strip needs nothing from WP-32 (spec 3.4: client aggregation of prompt rows, as `strip-model.ts` does). The seam is the hook set of 3.3 |
| F5 | `RefetchBar` and `FreshnessIndicator` are in DS 17 and DS 25 as V1 and exist nowhere in `components/app/status`. No package builds them. | T9 builds both. Lease L6 (new files only) puts them in `components/app/status/`; without it they live in `features/ai-overview/parts/` |
| F6 | URL keys differ. Built pages: Topics and Prompts reads `country` (ISO), `engine`, `topic`, `branded=include`, `win`/`from`/`to`; Rankings uses `loc` as a numeric location id. Spec 3.2 and DS 24 T1 name `loc`, `eng`, `branded=excluded|only|included`, `cmp`. | The Overview uses the keys the built AI page reads (`country`, `engine`, `topic`, `branded`) plus `cmp`. One translation table (`drilldown/drill-links.ts`) is the only place that knows both, so a later rename is one file (open to WP-17) |
| F7 | Summary mock has no `group_by=country`; countries on the page come from the prompts list (`country_iso`), as the Prompts page does. | `scope/prompt-countries.ts` reads `GET prompts` pages (own query key). Follow-up F5 replaces it with `by_country` |
| F8 | Sources and fan-out reads now take `filter[country_iso]`, `filter[term]`, engine and branded filters (inventory WB-NAV-08 is out of date). `fanout-queries` and `ai/collection/daily` have no mock (`fanoutHandlers`, `aiHealthHandlers` are empty stubs of WP-24 and WP-30). | The fan-out presence number needs one small mock answer for `fanout-queries` meta in `ai-overview.ts`, ordered after `fanoutHandlers`, so WP-24 supersedes it. The partial-run notice does not use `collection/daily`: it counts invalid answers from the same summary as the numbers (one denominator) |
| F9 | `planned-routes.test.ts` (WP-02) and `registry.test.ts` pin `/ai` and `aiOverview` as planned. | T5 removes the route row (L4) because the route stops being the 404 page there; T12 edits the registry pin (L3) when the entry flips |
| F10 | DS 25 meta line: "FreshnessIndicator first, then one scope fact; at most two middle dots". Spec 3.2 lists four facts. | Meta = freshness, prompts, engines (two dots). The window is in the top bar and in every tooltip and the export |
| F11 | The preview has no `/ai` screen (its nav entry is `data-nav-missing`). The approved truth is the project Overview of the preview plus the Prompts preview filter bar. | Section 2 |
| F12 | Spec 9.5 Competitive leaves card 8 (half) alone on a 1280 px row, which contradicts the "computed with `packRows`" claim. | T6 fixes it (section 4, T6) and the preset test fails on any other part empty row the spec did not accept |

## 2. Parity with the approved preview

Source: `apps/web/design-preview/index.html` (H), `customize.js` (C), `interactions.js` (I), the project Overview
(`data-view="overview"`, lines 330 to 567) and the Topics and Prompts filter bar (H160). The preview is the owner's
truth for what is seen; the spec (`overview-and-charts.md`) is the truth for data rules.

### 2.1 Parity table

"Card" means a card of the catalog built by WP-34 to 37 (or by WP-16 as platform), not here.

| # | Preview element (where) | Built in | Notes |
|---|---|---|---|
| P1 | Page padding `px-3 md:px-4 lg:px-5 pt-5 pb-8`, blocks 16 px apart (`gap-4`) (H327 to 329) | T5 | One class constant `OVERVIEW_PAGE_CLASS` in the screen (`PAGE_CLASS` is `gap-3 pt-3`, the table page rhythm) |
| P2 | Title `type-page-title` plus Customizing badge in one line, meta line 4 px under it (H334 to 336) | T5 (`PageHeader` `titleAddon`) | Title "AI visibility" |
| P3 | Meta "SEO updated 2h ago · AI updated Sep 28, 02:10" (H335) | T5, stale state T9 | AI only: "AI updated Nov 12, 02:10 · 250 prompts · 3 engines" |
| P4 | Customize toggle, `secondary`, `aria-pressed`, from 768 px (H338) | T5 (`CustomizeButton`) | WP-16 built it |
| P5 | "Create report" secondary button (H339) | none | WP-51 (Reports, D-29). Slot kept: `actions` order Customize, Export, More |
| P6 | More actions menu `...` with Export (H340, menu H1041) | T5 menu, T11 items | More: Copy link. Export is its own secondary menu (spec 3.2) |
| P7 | Setup checklist bar (H343) | none | Project Overview only (WP-40). Not on `/ai` |
| P8 | Notice region between header and strip (DS 24 T1) | T9 | One Banner at a time |
| P9 | Headline numbers: `MetricStrip md` from the layout's numbers zone, 0 to 6, channel divider, label with engine mark, value, delta, context (H358 to 362, C653 to 724) | T8 (`NumberStrip` `valueOf`) | AI channel only, so one group |
| P10 | Number is a link to the filtered table (H, DS 24 S1) | T8, T10 | Prompts page with `engine`, `sort`; the metric inspector is follow-up F3 |
| P11 | Filter bar after the strip: compare menu "vs previous period" (radio), default chip "Branded: Excluded" with remove, "+ Filter" (H364 to 373, I177, I1233) | T7 | Order follows the preview and DS T1; spec 3.3 draws it above the notice region (see 2.3) |
| P12 | Engines button with count (Topics and Prompts preview, H161) | T7 | Always visible on `/ai` (spec 3.2). At least one engine |
| P13 | Date range and location in the top bar, not in the filter bar (DS 13, UI rule 8) | T7 (`TopBarPortal`) | Window capped at 92 days |
| P14 | Cards zone: `grid-cols-1 md:grid-cols-12 gap-4` (H376) | `CustomizableGrid` (WP-15) | T5 mounts it |
| P15 | Card frame `@container min-w-0 bg-surface border border-border rounded-lg`, title row `min-h-12 px-4 py-3` with `type-section-title` and a `text-link` "View all" (H381 onward) | Cards (`ChartFrame` html mode); placeholder in T5 | The placeholder uses `ChartFrame` so a pending card has the final frame and height |
| P16 | Trend card: five small multiples, Series menu, Table toggle (H381 to 405) | Card: `ai.rate_trend_by_engine`, `ai.mention_trend` (WP-34) | |
| P17 | Rank distribution, SEO and AI matrix, Not classified, Top movers, SERP features (H406 to 438, H489 to 496) | none | SEO and cross-channel cards of the project Overview (`screens: ['overview']`) |
| P18 | Key changes with Needs attention, Changes, Notices groups (H439 to 452) | Card: `activity.key_changes` (WP-37) | |
| P19 | Opportunities list (H453 to 463) | Card: `ai.opportunities` (WP-35) | AI version (named not cited, lost to, cited not named, nobody named) |
| P20 | AI by engine table, equal-weight line (H464 to 476) | Card: `ai.by_engine` (WP-34) | |
| P21 | Competitors table (H477 to 488) | Cards: `ai.competitor_table`, `ai.share_of_voice` (WP-35) | |
| P22 | Citation share by domain type 100% bar and table (H512 to 524) | Card: `ai.citation_share_by_domain_type` (WP-37) | |
| P23 | Collection status list (H532 to 540) | Card: `activity.collection_status` (WP-37) | |
| P24 | Per engine mention trend (template H541) | Card: `ai.mention_trend` (WP-34) | |
| P25 | Layout save bar, scope text, Reset, Cancel, split Save (H551 to 562) | `LayoutSaveBar` (WP-16) | Built into `CustomizableScreen` |
| P26 | Customize mode: card toolbar, catalog, options, number catalog, Start from, discard, Escape, keyboard moves, phones display only (C) | WP-15 and WP-16 | T5 wires, T13 proves on `/ai` |
| P27 | Empty and no engine, before first collection, partial, stale (no preview) | T9 | Spec 3.6 |
| P28 | Export (a toast in the preview) | T11 | Numbers (CSV) |
| P29 | Presets (no preview control) | T6 | Start from in the save bar, as WP-16 built it |

### 2.2 Built beyond the preview (spec, rows, owner decisions)

Engines, country and topic scope; compare window shown with its dates; freshness with a stale state; the five presets;
Export Numbers (CSV); drill-down links that carry the scope; one placeholder per unbuilt card; notices for no engine,
no prompts, first collection pending, paused schedules, partial and stale; unknown is never zero; every percent with
its count; interim unpaired significance label (R5).

### 2.3 Where the preview, the spec, the rows and the design system disagree

| Point | Sources | Decision |
|---|---|---|
| Order of strip and filter bar | Preview and DS 24 T1: header, notice, strip, filter bar, cards. Spec 3.3: header, filter bar, notice, strip | Preview and DS win (visible behaviour). One reorder in `ai-overview-screen.tsx` if the owner prefers the spec |
| Meta line facts | Spec 3.2: freshness, prompts, engines, window. DS 25: freshness first, then one fact, at most two dots | DS wins: freshness, prompts, engines. The window is in the top bar |
| URL keys | Spec and DS: `loc`, `eng`, `branded=excluded\|only\|included`. Built: `country`, `engine`, `branded=include` | Built keys, plus `cmp` and `branded` three way. `drill-links.ts` translates (F6) |
| No engine page | Spec 3.6: Notice plus a strip with Prompts only, panels absent. Prompts page: one EmptyState | EmptyState in the body (no count read exists without the summary); the strip is absent. Recorded in T9 |
| Partial run source | Spec W-0: `GET runs` and N5 | Invalid answers of the window from the summary (n_observations minus valid), so the notice and the numbers share one denominator. N5 is follow-up F10 |
| Customize in 768 to 1023 px | WB-LAY-29: More below 1024 px. Preview: button from 768 px | Preview wins (decided in WP-16 and merged) |
| Preset engines | Spec 9.5 "until N2 or N3" variants | N2 is two reads (compare is built), N3 (entities per week) and N14 (co-mentions) are built by WP-12: the final variants are used, no "until" cards |
| Competitive preset rows | Spec 9.5 vs its own `packRows` claim | T6 section: card 8 `ai.sample_coverage` (third) added, `ai.co_mentions` becomes two thirds |
| Strip delta items | WP-34 goal lists "the strip delta items"; WB-OV-04 (this package) lists "change" | WP-33 builds the delta on every strip rate; WP-34's phrase is read as the period comparison card. Not a blocker; reverse on the coordinator's word |
| Catalog groups | Spec 9.6: AI, Topics, Competitors, Sources, Activity. WP-16: four `CardGroup` values | Four groups (`ai`, `cross`, `activity`, `seo`); finer groups are follow-up F11 |
| Per card Window option | Spec 9.4 Proposed; D-13 default No | No window options in any entry |

### 2.4 Design ambitions for the shell

Each is tied to an existing token or part, so "polished" is checkable in review.

| # | Ambition | Tokens and parts | Check |
|---|---|---|---|
| D1 | One large type on the page: the strip values (`type-metric`). Title `type-page-title`, card titles `type-section-title`, everything else `type-body`, `type-table`, `type-meta`. No second accent: `chart-1` is the own brand, everything else neutral | type utilities, `MetricStrip md` (76 px panel, full height dividers) | Reviewer greps for any other `type-` or palette use; screenshot at 1280 |
| D2 | One vertical rhythm: 16 px between header, notice, strip, filter bar and grid (`gap-4`), 4 px between title and meta, gutters 12, 16, 20 px at 390, 768, 1024 | `OVERVIEW_PAGE_CLASS`, `LayoutGrid` gap | Measured in the browser: equal gaps at four widths |
| D3 | The strip reads like an instrument, not a KPI card: engine logo before the label, value and delta on one line, a context line with counts ("612 of 1,800 answers"), hatching and the word "3 answers" for a small sample, the full counts in the tooltip and the cell description | `EngineLogo`, `MetricStrip` `unknown`, `Delta` with `test="interim"`, `formatSampleCount` | Unit test per state; axe |
| D4 | Scope is always visible and never ambiguous: header meta (freshness, prompts, engines), top bar window and country, filter bar compare with the previous window written out ("Oct 16 to Nov 12 against Sep 18 to Oct 15" in the menu header and the tooltip), the strip's `aria-label` names the window and "branded excluded" | `PageHeader` `meta`, `TopBarPortal`, `Menu` header, `formatDateRange` | Test: the same scope text appears in the meta, the export and the tooltips |
| D5 | Freshness is one fact with one warning: "AI updated Nov 12, 02:10" in `type-meta`; the relative time in a tooltip; when the newest valid answer is over 5 days old it becomes a `bg-warning-subtle text-warning-text` `h-badge` "Last answer 6 days ago". Colour appears only when it is a fact worth acting on | `FreshnessIndicator` (T9), `formatRelative`, `Banner` tone `warning` | Test at 4, 5 and 6 days |
| D6 | Notices are quiet and singular: one `Banner placement="region"` at a time in a fixed order, aligned to the card edges, with one action; never stacked, never a toast | `Banner`, `TextLink` | Precedence test; no two banners ever render |
| D7 | Every surface keeps its height through loading, empty, error and refetch, so nothing moves: the placeholder card, the strip skeleton with real labels, a 2 px static `RefetchBar` under the filter bar for a page wide refetch | `Skeleton`, `ChartFrame` heights (140 to 280), `RefetchBar` | Layout shift check: card tops equal before and after data |
| D8 | Trust by construction: no number without its count, no rate under 4 valid answers, unknown is never zero, a delta is coloured only when detectable and says "within normal variation" otherwise, engines are never pooled in the strip | `MIN_OBSERVATIONS`, `isDetectableChange`, `formatMetricDelta` | R12 parity test with the Topics and Prompts strip |
| D9 | Customize feels like part of the page: pressed look of the button, the badge beside the title, Start from in the save bar, placeholders that say why a card is unavailable, phones display only | WP-16 parts, `useBreakpoint` | e2e at 390 and 1280 |
| D10 | Both themes and both densities with no special cases: tokens only, `@container` cards, no fixed pixel widths | Tailwind token utilities (lint enforced) | Browser matrix in each task |

## 3. Design

### 3.1 Folder layout (`apps/web/src/features/ai-overview/`)

```text
index.ts                       AiOverviewScreen; hooks and types cards import (section 5)
ai-overview-screen.tsx         composition: permission, provider, CustomizableScreen, header, notices, strip, filter bar, grid
overview-context.tsx           OverviewProvider, useOverview() (project, scope, engines, can)
scope/        scope-model.ts, use-overview-scope.ts, scope-bar.tsx, compare-select.tsx, engines-control.tsx,
              topic-options.ts, branded-field.ts, country-control.tsx, prompt-countries.ts
data/         overview-queries.ts, use-overview-reads.ts, read-state.ts, aggregates.ts, topics-in-scope.ts
numbers/      number-model.ts, use-number-values.ts
header/       overview-header.tsx, meta-line.ts
notices/      notice-model.ts, overview-notices.tsx
states/       no-engine-state.tsx, no-prompts-state.tsx, strip-error.tsx
cards/        registry.ts, pending-card.tsx, engines/index.ts, competitors/index.ts, topics/index.ts, sources/index.ts,
              activity/index.ts          (the five family files start as empty maps; each card package owns its own)
presets/      presets.ts
drilldown/    drill-links.ts
export/       export-model.ts, export-registry.tsx, export-menu.tsx
parts/        refetch-bar.tsx, freshness-indicator.tsx   (only if lease L6 is refused)
```

Also new outside the feature: `app/[workspace]/[project]/ai/page.tsx` (replaces the 404 re-export),
`src/test/ai-overview-harness.tsx` (L5), `e2e/flows/ai-overview.spec.ts`, `e2e/support/ai-overview.ts`,
`mocks/handlers/ai-overview.ts` (+ test). Namespace `aiOverview` in `messages/en.json`.

### 3.2 Scope and URL

`OverviewScope` (T1) is the one value every read and card takes:

| Field | URL key | Default (writes nothing) | Notes |
|---|---|---|---|
| `range` | `win`, or `from` and `to` | 28 days ending today in the project zone | `useDateRangeParams({ today, maxDays: 92 })`; a refused link range falls back and `dropped` is shown as a banner |
| `compare` | `cmp=off` | on (D-03) | `previous` is as many days just before `range.from` (the server's `compare_window` rule) |
| `country` | `country=DE` | none | ISO, two capitals. Spec calls it `loc` (F6) |
| `engines` | `engine=chatgpt_web,gemini_web` | every enabled engine (`null`) | Comma list as `useUrlFilters` writes enum lists; unknown codes dropped; never empty |
| `topic` | `topic=<term id>` | none | One term and its subtree (`filter[term]`) |
| `branded` | `branded=only\|included` | `excluded` | Maps to `include_branded` and `branded_only` |

The preview's chip rules hold: removing the "Branded: Excluded" chip means Included (the chip goes), "+ Filter" brings
it back. `inspect=` is not used on this page in WP-33 (follow-up F3).

### 3.3 Data layer and the WP-32 seam

One query factory file, one hook per read, one status vocabulary. Cards and the shell read only through these hooks;
no component calls `apiQuery` for AI data.

| Hook (in `data/use-overview-reads.ts`) | Read | Returns |
|---|---|---|
| `useOverviewEngines()` | `GET {P}/engines` (the same query as `useLayoutCapabilities`, so one request) | `Read<ProjectEngine[]>` plus `enabled` |
| `useOverviewSummary(options?)` | `GET {P}/ai/prompts-summary` for `scope.range`, with `filter[engine_code_in]`, `filter[country_iso]`, `filter[term]`, `include_branded`, `branded_only`, and `options.include` (`series`, `entities`), `options.rows` | `Read<PromptsSummary>`; `keepPreviousData`; `enabled` only with an engine on |
| `useOverviewPeriods(options?)` | `useOverviewSummary` for the current window and, when `scope.compare`, for `scope.previous` | `{ current, previous }` |
| `useOverviewSources(options?)` | `GET {P}/ai/sources/domains?limit=1&compare=previous_period&include=...` (meta only), same scope filters | `Read<SourcesMeta>` (own citation share from `meta.by_role` and `citation_units`) |
| `useOverviewFanout()` | `GET {P}/ai/fanout-queries?limit=1` (meta only) | `Read<FanoutMeta>` (answers with fan-out over answers) |
| `useOverviewSchedule()` | `GET {P}/schedules`, the active AI workload's `next_run_at` and `is_active` | `Read<{ nextRunAt: string \| null; paused: boolean }>` |

`Read<T>` (`data/read-state.ts`): `{ status: 'loading' | 'ready' | 'refetching' | 'error'; data: T | undefined;
errorId: string | null; refetch(): void }`. A failed refetch with data stays `ready` with a flag `stale: true` (the
card says "These are the last figures read"). Nothing returns zero for a read that failed or did not run.

Swap seam for WP-32: the numbers and the aggregates come from `data/aggregates.ts` (`buildAggregates`), a pure function
of `{ current, previous, engines }`. When `ai/metrics/overview` is on `develop` and in `schema.ts`, only
`useOverviewPeriods` and `buildAggregates` change; `OverviewAggregates` (T4) is the stable shape, written to what
the metric routes will return (value, numerator, denominator, n per engine and metric). Follow-up F1 (one summary
read with `compare=previous_period&include=total&rows=none`) and F2 (WP-32) use the same seam.

### 3.4 The number catalog (inventory 9.3, wave 1)

| Metric key | Label | Engine | Value | Delta | Context line | Source |
|---|---|---|---|---|---|---|
| `ai.prompts_in_scope` | Prompts | none | prompts in scope | none | "in 13 topics" | summary prompt rows, topic rows (`topics-in-scope.ts`) |
| `ai.valid_answers` | Valid answers | one | valid answers | count change | "of 1,862 answers, 62 not valid" | `n_observations`, denominators |
| `ai.mention_rate` | Mention rate | one | prompt weighted rate | points, detectable only | "612 of 1,800 answers", secondary "Cited 21%, SOV 27%" in the tip | `engineRates` |
| `ai.citation_rate` | Citation rate | one | same | points | "378 of 1,800 answers" | `engineRates` |
| `ai.mention_and_citation_rate` | Named and cited | one | rate | points | "301 of 1,800 answers" | `outcomes.mentioned_and_cited` cells |
| `ai.share_of_voice` | Share of voice | one | per answer share | points, neutral (no interval yet) | "of 1,412 answers naming a tracked brand" | `shareOfVoiceTotals` |
| `ai.citation_share` | Own citation share | one | own units over all units | points | "1,676 of 18,420 citation units" | `useOverviewSources` |
| `ai.fanout_presence_rate` | Fan-out presence | one | answers with fan-out over answers | points | "96 of 600 answers"; other engines say "Not exposed" | `useOverviewFanout` |

`ai.recommendation_rate` stays on `overview` only (slice 2). AI Overview as an engine and strip item (D-19) waits for
slice 2 (follow-up F7). States of a number: loading (skeleton with the real label), ok, insufficient (fewer than 4 valid
answers: the words "3 answers", hatching, no rate), none (no answer: "No valid answers" with the invalid count),
engine off or outside the engine filter ("Not asked" with the reason in the context), not exposed, read failed ("n/a"
with the reason in the tooltip and one Retry in the strip error row), compare window empty (no delta, the tip says
"No answers in the previous 28 days"; never 0).

### 3.5 Notices and states (one table, used by T9)

Precedence in the notice region (one Banner at a time; the first that applies wins). The two empty states replace the
body.

| Order | Condition | Surface | Action |
|---|---|---|---|
| 1 | No engine enabled | Body EmptyState (icon `Power`) "No AI engine is on" | "Turn on engines" to Settings > Engines with `projects:write`; else "Ask a workspace admin to turn on an engine" |
| 2 | Engines on, project has no prompts | Body EmptyState (icon `MessageSquare`) | "Open Topics and prompts" |
| 3 | Schedules paused or first collection pending (engines on, prompts exist, no answer in any window) | Banner info "First answers arrive after Nov 13, 02:00" (from `useOverviewSchedule`), or "Scheduled AI runs are paused for this project" | none |
| 4 | Invalid answers in the window (n_observations over valid) on any engine | Banner warning "38 of 750 answers were not valid on Gemini in these 28 days" (worst engine first) | "View runs" (`/ops/runs`) when `runs:trigger` or `data:read` allows |
| 5 | Newest valid answer older than 5 days | Banner warning "The newest valid answer is 6 days old" | none |
| n/a | Window with no valid answers | Strip numbers "No valid answers"; each card its own empty sentence | |
| n/a | Compare window has no data | Deltas absent, footnote in the strip tooltip | |
| n/a | Summary read failed | Strip error row with Retry; cards keep their own states | |
| n/a | A link whose range was refused | Banner info with `common.dateRange.*` words, as the Prompts page | |
| n/a | Country with no prompts | Body EmptyState "No prompts ask in Germany." with "Clear location" | |

Refetch (scope change): values stay, `aria-busy` on the strip and the grid, a `RefetchBar` under the filter bar after
150 ms. First load: header and filter bar at once, strip skeleton with real labels, each card its own skeleton at its
final height. No full page spinner anywhere.

### 3.6 Composition (what `AiOverviewScreen` renders)

```tsx
<OverviewProvider ...>                                  // scope, project, engines, permissions
  <TopBarPortal><DateRangePicker/><CountryControl/></TopBarPortal>
  <CustomizableScreen screen="ai_overview" workspaceId workspaceName capabilities registry={CARDS} presets={presets}>
    <div className={OVERVIEW_PAGE_CLASS}>               // px-3 md:px-4 lg:px-5 pt-5 pb-8, gap-4
      <PageHeader title meta titleAddon={<CustomizingBadge/>} actions={<><CustomizeButton/><ExportMenu/><MoreMenu/></>}/>
      <OverviewNotices/>                                // one Banner
      <NumberStrip label valueOf status/>               // or the strip error row
      <ScopeBar/>                                       // compare, engines, FilterBar (topic, branded), RefetchBar
      <CustomizableGrid label/>
    </div>
  </CustomizableScreen>                                 // the save bar closes the screen, outside the padded div
</OverviewProvider>
```

`presets` is `useMemo(() => definePresets('ai_overview', [...]), [t])` (labels come from messages; its page test renders
it, so a typo fails a test and not the person). `registry` is `cards/registry.ts`, built once at module level.
`capabilities` come from `useLayoutCapabilities`; the page shows no grid and no Customize while engines load or are off.

### 3.7 Messages (namespace `aiOverview`, camelCase, curly quotes, no dashes, no "n't")

Reserved sub-objects `engines`, `competitors`, `topics`, `sources` belong to WP-34 to 37 and are never edited here.
Each task adds its block; Haiku may draft, the implementer checks `pnpm exec vitest run src/i18n/messages.test.ts`.

| Block | Keys (value) | Task |
|---|---|---|
| top | `title` "AI visibility", `noAccessTitle`, `noAccessReason`, `copyLink` "Copy link", `linkCopied` "Link copied", `moreActions` "More actions" | T5 |
| `meta` | `updated` "AI updated {time}", `prompts` "{count, plural, one {# prompt} other {# prompts}}", `engines` "{count, plural, one {# engine} other {# engines}}", `none` "No AI answers yet" | T5, T9 |
| `scope` | `compare` "Comparison", `comparePrevious` "vs previous period", `compareOff` "No comparison", `compareWindow` "{current} against {previous}", `engines` "Engines", `enginesCount` "{count, number} of {total, number}", `enginesMin` "At least one engine stays on", `topic` "Topic", `topicAll` "All topics", `topicWithPath` "{name}, {path}", `branded` "Branded", `brandedExcluded` "Excluded", `brandedOnly` "Only", `brandedIncluded` "Included", `country` "Country: {country}", `allCountries` "All countries", `countrySearch`, `countryEmpty`, `clear`, `open`, `dropped` words | T7 |
| `numbers` | `label` "AI visibility numbers for {window}, {branded}", `prompts` "Prompts", `inTopics` "in {count, plural, one {# topic} other {# topics}}", `ofAnswers` "{count, number} of {total, number} answers", `ofUnits` "{count, number} of {total, number} citation units", `ofNaming` "of {total, number} answers naming a tracked brand", `invalid` "{count, number} not valid", `fewAnswers` "{count, plural, one {# answer} other {# answers}}", `noValid` "No valid answers", `notAsked` "Not asked", `notExposed` "Not exposed", `outsideFilter` "Not in the engine filter", `engineOff` "Off in this project", `noPrevious` "No answers in the previous {days, plural, one {# day} other {# days}}", `tip*` sentences, `interim` "Unpaired test on pooled counts", `retry` | T8 |
| `notices` | `firstAnswers` "First answers arrive after {time}", `firstAnswersGeneric`, `paused` "Scheduled AI runs are paused for this project", `invalid` "{count, number} of {total, number} answers were not valid on {engine} in these {days} days", `stale` "The newest valid answer is {days, plural, one {# day} other {# days}} old", `viewRuns` "View runs", `freshnessStale` "Last answer {days} days ago" | T9 |
| `empty` | `noEngineTitle`, `noEngineReason`, `toEngines` "Turn on engines", `askAdmin` "Ask a workspace admin to turn on an engine", `noPromptsTitle`, `noPromptsReason`, `toPrompts` "Open Topics and prompts", `noCountryTitle` "No prompts ask in {country}.", `clearCountry` "Clear location" | T9 |
| `pending` | `title` "This card is not built yet", `reason` "It will show here as soon as its data is ready. You can keep it in your layout." | T5 |
| `export` | `menu` "Export", `numbers` "Numbers (CSV)", `exported`, `exportNone`, `exportFailed`, `partial` "{count, plural, one {# card was} other {# cards were}} still loading and left out." | T11 |
| `presets` | `executive` "Executive summary", `seoAnalyst` "SEO analyst", `competitive` "Competitive", `topicOwner` "Topic owner" | T6 |
| `shortcuts` | descriptions for the shortcuts dialog | T11 |

### 3.8 Checks used by every task

- TARGET: `infra/dev/heavy --lane medium --label wp33-tN-test -- bash -c 'cd apps/web && pnpm exec vitest run <paths> --maxWorkers=2'`
- LINT, TYPES, FORMAT: the same lane with `pnpm lint`, `pnpm typecheck`, `pnpm format:check` (from `apps/web`)
- MESSAGES (any task that edits `en.json`): TARGET on `src/i18n/messages.test.ts`
- CATALOG (T2 and any later catalog edit): `pnpm gen:layout-catalog`, commit `catalog.json` in the same commit, then
  TARGET on `src/lib/layouts` and `src/features/layouts`, and `cd backend && uv run pytest tests/api/layouts --no-cov -n 2` in the medium lane
- BROWSER (every task that draws something): headless Playwright Chromium (the built-in pane cannot register the MSW
  worker), recipe in the session scratchpad `dev-signin-recipe.md`. Dev server: reuse one that already runs for this
  worktree (dev server policy), else `NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p <free port>`; never kill a
  process on a port; delete the `AGENTS.md` and `CLAUDE.md` that `next dev` writes in `apps/web`. Pages:
  `/digibranders/fynix/ai` (3 engines, 24 prompts), `/digibranders/eventus-security/ai` (dev seed), `/digibranders/cleanstart/ai`
  (engines off). Accounts: `priya@digibranders.test` (editor), `tomas@digibranders.test` (admin, team default),
  `mei@digibranders.test` (viewer). Check at 390, 768, 1024 and 1280 px, light and dark, Default and Compact density
  (Preferences): overflow, wrapped controls, contrast, focus rings, the keyboard path, and `localStorage 'idraft.theme'`
  for the theme.
- Never plain `pnpm test`, `pnpm build` or `pnpm e2e` before T12; those go through the heavy lane
  (`infra/dev/heavy --label wp33-<what> -- ...` with `--maxWorkers=3`, only when the health gate allows).
- Every implementer: a fresh Sonnet subagent, tests first and seen red, file tools only (no heredocs, `sed`, scripts),
  one task at a time; then a fresh Sonnet reviewer returns PASS or a numbered fix list. Commit `WP-33: <title>` naming
  only this package's files (no attribution lines, no dashes).

House rules for every file: Tailwind v4 tokens and type utilities only (no arbitrary px or rem, palette classes, hex,
off scale spacing); `@/lib/format` for every number and date; every word from `messages/en.json`
(`i18next/no-literal-string` covers `src/features/**`); a feature imports app-component, ui, lib, providers and its own
feature, plus `features/layouts` once L1 is granted, never `design-system` or another feature; no em-dash or en-dash
anywhere; every percent shows its count; unknown is never zero; colour only for a detectable change; engines never
pooled silently; one denominator per number (R12); loading skeleton, empty (reason and action), error (retry),
partial and stale for every surface; no full page spinner; a refetch keeps data with the `RefetchBar`; a keyboard path
for every action and single key shortcuts only through `useShortcut`.

## 4. Tasks

Order: T1, T2, T3, T4, T5, T6 (milestone M1: push, the card packages can start), then T7 to T13. Pairs that touch
disjoint files and could run together if the coordinator allows two implementers: (T1, T2) and (T3, T4 after T1).

### T1: scope model and URL state

Files (new): `scope/scope-model.ts`, `scope-model.test.ts`, `scope/use-overview-scope.ts`, `use-overview-scope.test.tsx`.

Tests first:
- `scope-model.test.ts`: `previousWindow is as many days just before from (Oct 16 to Nov 12 gives Sep 18 to Oct 15)`, `previousWindow of one day`, `previousWindow crosses a month end and a leap day`, `parseCompare reads cmp=off as off and anything else as on`, `parseCountry accepts two capital letters only`, `parseEngines keeps known codes once in the order given and reads none as every engine`, `parseBranded defaults to excluded and reads only and included`, `brandedParams maps excluded to include_branded false, included to true, only to branded_only true`, `scopeKey is stable and equal for equal scopes`.
- `use-overview-scope.test.tsx` (nuqs test adapter, as `use-url-filters.test.tsx`): `an empty URL is the default scope`, `the keys cmp, country, engine, topic and branded are read`, `a change is written with replace and defaults are removed from the URL`, `a range the picker refuses falls back and reports dropped`, `today is a day of the project zone`.

Implementation: `OverviewScope` of 3.2 plus `setScope(patch)`; `useOverviewScope({ workspaceId, project })` composes
`useDateRangeParams({ today: useZoneDay(timeZone), maxDays: 92 })` (check `range-model.ts` for its default cap) with one
`useQueryStates` for the other keys (`history: 'replace'`). `previousWindow` follows the server rule documented in
`c2-summary.md` (`compare_window`). Pure functions take plain strings.

A11y: none (no UI). Rows: WB-OV-03 (URL half). Browser: none. Commit `WP-33: scope model and URL state`.

### T2: the ai_overview screen definition and the full card catalog (leases L2, L7)

Files (modify): `apps/web/src/lib/layouts/catalog.ts`; tests that count types or pin the empty builtin
(`screens.test.ts`, `layouts.test.ts`, `catalog-json.test.ts` as needed); generated
`backend/src/idraft/api/layouts/catalog.json` (`pnpm gen:layout-catalog`); `docs/16-metrics-methodology.md` section 2.1
(two rows). New test: `lib/layouts/ai-overview-catalog.test.ts`.

Tests first (`ai-overview-catalog.test.ts`, red until the catalog is filled): `every card of inventory 9.4 whose screens include AO is in the catalog with its widths, instance limit, identity option and option defaults` (an inline typed copy of the 9.4 table, row by row, independent of the implementation), `the identity option of a reusable type is its first option` (so `ai.share_of_voice` lists Engine before Rows), `the five reused types list overview and ai_overview`, `no planned type is listed (ai.alerts, ai.sentiment, ai.list_position)`, `ops.ai_spend needs costs:read`, `the built-in layout of ai_overview is the Default preset of 9.5 and sanitizes unchanged`, `every number of 9.3 wave 1 is catalogued: ai.prompts_in_scope has no engine, the others are per engine`, `ai.recommendation_rate is not on ai_overview`, `the catalog still stays within 12 cards and 6 numbers`.

Implementation notes:
- `dashboardCard(...)` keeps `screens: ['overview']`; add a `screens` extra and a thin `aiCard(...)` helper whose default is `['ai_overview']`. Reused types gain `ai_overview`: `ai.by_engine`, `ai.mention_trend`, `ai.citation_share_by_domain_type`, `activity.key_changes`, `activity.collection_status`. `competitors.share_of_voice` stays on `overview`.
- Add the 38 new card types of inventory 9.4 (every row marked AO whose card WP-34 to 37 builds): `ai.change_summary`, `ai.rate_trend_by_engine`, `ai.outcome_mix`, `ai.answer_funnel`, `ai.share_of_voice`, `ai.competitor_trend`, `ai.competitor_table`, `ai.lost_to_competitor`, `ai.co_mentions`, `ai.sov_over_time`, `ai.sov_rank`, `ai.topic_heatmap`, `ai.topic_extremes`, `ai.topic_movers`, `ai.topic_engine_gap`, `ai.engine_disagreement`, `ai.topic_trends`, `ai.topic_small_multiples`, `ai.topic_contribution`, `ai.prompt_heatmap`, `ai.top_prompts`, `ai.prompt_movers`, `ai.period_comparison`, `ai.change_waterfall`, `ai.engine_agreement`, `ai.citation_vs_mention`, `ai.country_breakdown`, `sources.top_domains`, `sources.own_pages`, `sources.new_lost`, `sources.diversity`, `ai.fanout_top`, `ai.opportunities`, `ops.answer_calendar`, `ops.answer_status`, `ops.engines`, `ops.ai_spend`, `ai.sample_coverage`. Titles, questions, groups (`ai`, `activity`), widths (first listed is the default), maximum instances, options and `addedOn: '2026-11-13'` as the 9.4 table says. Options are enums only and project agnostic; no Window option (D-13).
- `ai.fanout_top`, `ai.country_breakdown` and `ops.ai_spend` have `integration: null` and `permission: null` except `ops.ai_spend` (`costs:read`): the catalog cannot yet express "ChatGPT on", "two countries" or "a budget exists", so those cards state their own empty reason (CH-17: "Gemini does not show the searches it ran") (follow-up F4).
- `NUMBER_TYPES`: add `aiNumber` entries for `ai.valid_answers`, `ai.mention_and_citation_rate`, `ai.citation_share`, `ai.fanout_presence_rate` and an AI number with no engine for `ai.prompts_in_scope` (`perEngine: false`, channel `ai`); add `ai_overview` to `ai.mention_rate`, `ai.citation_rate`, `ai.share_of_voice`.
- `SCREENS.ai_overview.builtin` is the Default preset of 9.5: numbers `prompts`, `mention-chatgpt`, `mention-gemini`, `mention-ai-mode`; cards in the order of the 9.5 Default table with ids `change-summary`, `rate-trend`, `outcome-mix`, `top-domains`, `topic-heatmap`, `share-of-voice-chatgpt`, `competitor-trend-chatgpt`, `key-changes`, `opportunities` and the options of the table.
- D-17: add the rows for `ai.prompts_in_scope` ("Prompts in scope", prompts with a valid answer or not, counted once) and `ai.valid_answers` to doc 16 section 2.1 in this commit (lease L7), and tell the coordinator so WP-32 does not add them twice.
- After every later edit of this file run `pnpm gen:layout-catalog` and commit `catalog.json` (it stores `source_sha256`).

A11y: none. Rows: WB-OV-14 (screen definition), WB-OV-04 (number types). Browser: none. Commit `WP-33: ai_overview screen definition and card catalog`.

### T3: reads and hooks (the data seam)

Files (new): `data/read-state.ts`, `data/overview-queries.ts`, `data/use-overview-reads.ts`, `scope/prompt-countries.ts` and tests
(`overview-queries.test.ts`, `use-overview-reads.test.tsx`, `prompt-countries.test.tsx`); modify `mocks/handlers/ai-overview.ts`
and new `mocks/handlers/ai-overview.test.ts`.

Tests first:
- `overview-queries.test.ts`: `summary params carry the window, engines, country, topic and branded of the scope` (every combination of `branded`: excluded sends `include_branded=false`, included true, only `branded_only=true`), `the previous window is asked with its own from and to`, `an all-engines scope sends no engine filter`, `sources and fan-out ask limit 1`, `keys differ for different scopes and equal scopes share one entry`.
- `use-overview-reads.test.tsx` (MSW, Fynix and Eventus worlds): `engines are one request when useLayoutCapabilities reads them too`, `the summary is not asked while no engine is on`, `compare off asks no previous window`, `a scope change keeps the last data and reports refetching`, `a failed read reports error with an error id and Retry refetches`, `a failed refetch keeps the data and sets stale`, `useOverviewSchedule gives next_run_at and paused for the AI workload` (check the AI workload code in the schedules mock and the schema).
- `prompt-countries.test.tsx`: `the countries are those the prompts carry, sorted, plus the chosen one`, `pages are read until the list is whole, at most 1000 prompts`.
- `ai-overview.test.ts`: `the fan-out mock answers the generated FanoutQueryPage shape` (parse the response against `components['schemas']['FanoutQueryPage']` keys; `meta.answers_with_fanout` over `meta.answers` from the same answers the observations mock lists, ChatGPT only, `engines_without_fanout` names the others), `it is ordered after fanoutHandlers`.

Implementation: query factories use `apiQuery` with the generated paths (`GET {P}/ai/prompts-summary`, `.../ai/sources/domains`, `.../ai/fanout-queries`, `.../schedules`, `.../engines`); the Prompts page's `summaryQuery` cannot be imported (F2/boundaries), so the factory is written here with the same parameter names. `prompt-countries.ts` is a bounded `useInfiniteQuery` over `GET {P}/prompts` (200 per page, stop at 1000) with its own key, with a `// shortcut: replaced by by_country when the summary mock has it (follow-up F5)` note. The fan-out mock handler answers `meta` and an empty `data` list; it is the only handler this package registers and names WP-24 as its successor in its doc comment.

A11y: none. Rows: process (data seam). Browser: none (hooks), but run the dev server once and read the Network of the page in T5. Commit `WP-33: overview reads and hooks`.

### T4: aggregates (pure model of what the numbers and cards need)

Files (new): `data/aggregates.ts`, `data/aggregates.test.ts`, `data/topics-in-scope.ts`, `data/topics-in-scope.test.ts`.

`OverviewAggregates` (the stable shape; the WP-32 swap fills the same type):

```ts
interface RateCount { value: number | null; successes: number | null; answers: number; prompts: number; state: 'ok' | 'insufficient' | 'none'; reason: RateReason | null }
interface EngineAggregate {
  engineCode: EngineCode; label: string; asked: boolean;          // asked: enabled and inside the engine filter
  mentioned: RateCount; cited: RateCount; mentionedAndCited: RateCount; shareOfVoice: RateCount;
  validAnswers: number; allAnswers: number;                        // allAnswers - validAnswers = not valid
  previous: { mentioned: RateCount; cited: RateCount; mentionedAndCited: RateCount; shareOfVoice: RateCount; validAnswers: number } | null;
  detectable: { mentioned: boolean | null; cited: boolean | null; mentionedAndCited: boolean | null };  // null: no test
}
interface OverviewAggregates {
  promptCount: number; topicCount: number | null; engines: EngineAggregate[];
  lastValidAt: string | null; lastObservedAt: string | null; previousAnswers: number | null;
}
```

Tests first:
- `aggregates.test.ts`: `mention rate is the prompt weighted rate of engineRates, with the counts of the same cells` (equals `engineRates(prompts, code)` on the Fynix and Eventus fixtures, so the Overview and the Topics and Prompts strip show the same figure: R12), `share of voice is the sum of numerators over the sum of denominators`, `named and cited uses the outcomes cells`, `an engine outside the filter is not asked and has no figures`, `fewer than 4 valid answers is insufficient and has no value`, `no answer at all is none with its reason`, `valid and all answers are the denominator and n_observations sums`, `previous is null when compare is off and when the previous window has no answer (never zero)`, `detectable comes from isDetectableChange on pooled counts and is null for share of voice`, `engines keep the fixed order ChatGPT, Gemini, AI Mode`, `lastValidAt is the newest of the prompt rows`.
- `topics-in-scope.test.ts`: `counts the topic rows that hold a prompt and are not the no-topic row` (equals `topicsSpanned` of `features/prompts/prompt-model.ts` on the Eventus fixture: 13 topics; the test imports that function, tests may import anything), `a topic filter counts its subtree`, `null while the topic rows are absent`.

Implementation: pure, no React, `lib/rates` and `lib/stats` only; takes `PromptsSummary` (current and optional previous) and the enabled engines. No new arithmetic: where the Prompts page strip already computes a figure, call the same `lib` function.

A11y: none. Rows: WB-OV-04 (model half). Browser: none. Commit `WP-33: overview aggregates`.

### T5: route, screen shell, header, customize wiring, registry with placeholders (lease L1 gate, L4 partly, L5)

Gate: lease L1 must be granted (section 7); if not, stop and ask. Files (new): `app/[workspace]/[project]/ai/page.tsx`
(replaces the 404 re-export), `ai-overview-screen.tsx`, `overview-context.tsx`, `header/overview-header.tsx`,
`header/meta-line.ts`, `cards/registry.ts`, `cards/pending-card.tsx`, the five family `index.ts` files, `index.ts`,
`src/test/ai-overview-harness.tsx`, and tests; modify `messages/en.json` (`aiOverview` top, `meta`, `pending`);
edit `app/[workspace]/[project]/planned-routes.test.ts` (remove the `['/ai', ...]` row, lease L4: it fails the moment the route stops being the 404 page).

Tests first:
- `ai/page.test.tsx` (as `ai/prompts/page.test.tsx`): `the page finds the project among those the member can open and passes its zone and defaults`, `an unknown project is the 404 page`, `generateMetadata gives the title`.
- `ai-overview-screen.test.tsx` (harness): `without data:read the page says so and reads nothing`, `with no engine on the body is the no engine state` (T9 fills its words; here the empty state exists), `the header has the title, the Customizing badge in titleAddon, the meta line, Customize and More (Export arrives in T11)`, `Customize is hidden below 768 px`, `the grid shows nine cards of the built-in layout for Fynix`, `every one of them is a pending card with its catalog title and the pending sentence`, `a project with AI off shows placeholders for the AI cards in customize mode and no grid in view` (as WP-16 specimen), `Customize cannot be entered while the engines load`, `the save bar is not rendered by the page`.
- `cards/registry.test.ts`: `every active catalog card type of ai_overview has a registry entry` (fails when T2's catalog gains a type with no entry), `a family card replaces its pending entry` (spread order: pending first, families after), `the five family maps start empty and are Records of CardRegistration`.
- `overview-context.test.tsx`: `useOverview throws outside the provider with a named error`, `it gives project, scope, enabled engines and permissions`.

Implementation: `page.tsx` copies `ai/prompts/page.tsx` (membership, project lookup, `projectsOfMembership`). `AiOverviewScreen` composes as 3.6
with `OVERVIEW_PAGE_CLASS = 'flex flex-col gap-4 px-3 pt-5 pb-8 md:px-4 lg:px-5'`; permission with `useCan('data:read')`
(else `EmptyState` `Ban`, as the Prompts page). `OverviewProvider` value: `{ workspaceId, workspaceSlug, project, scope, setScope,
enabledEngines, canManageEngines (projects:write), canRunsView }`. `registry.ts`: `defineCards({ ...pendingEntries(), ...ENGINE_CARDS,
...COMPETITOR_CARDS, ...TOPIC_CARDS, ...SOURCE_CARDS, ...ACTIVITY_CARDS })` where `pendingEntries()` maps every active
`ai_overview` catalog key to `{ load: () => import('./pending-card'), skeleton }`; each family file is `export const X_CARDS:
Readonly<Record<string, CardRegistration>> = {}`. `PendingCard` is a `ChartFrame kind="html" status="empty"` (variant `panel`, height 180) with the
catalog title and `aiOverview.pending.*` (it keeps the final frame and height). Header: `PageHeader` with `titleAddon={<CustomizingBadge/>}`,
`meta={metaLine}` ("AI updated {time} · {n} prompts · {n} engines", `formatTableDateTime` for the time with the freshness
element of T9; until T9 plain text), actions `CustomizeButton` and a More
`Menu` with Copy link (the Export menu is added in T11, so no disabled stand-in ships here) (`copyText`, toast `linkCopied`). The strip and scope bar are placeholders (`Skeleton` blocks at final height) until T7 and T8.

A11y: one `h1`; the badge outside the heading; Customize `aria-pressed`; the grid labelled; More has a tooltip name.
Rows: WB-OV-01 (route), WB-OV-02 (header, freshness text), WB-OV-14 (wiring). Browser: Fynix at four widths, light and dark: header, placeholders in
the nine slots, Customize enter and leave, Escape; Cleanstart: no grid. Commit `WP-33: route, screen shell and card registry`.

### T6: the five presets, Start from, and the milestone push (M1)

Files (new): `presets/presets.ts`, `presets/presets.test.ts`; modify `ai-overview-screen.tsx` (pass `presets`), `en.json` (`presets`).

Tests first (`presets.test.ts`, with the harness for the `definePresets` call):
- `the four presets sanitize unchanged for ai_overview` (`definePresets` throws otherwise), `ids and labels are unique and none is builtin or team`, `each preset has at most 12 cards and 6 numbers`, `every AI number names an engine the API accepts`, `the built-in layout equals the Default of 9.5`.
- Rows with `packRows`: `Default: wide rows are [full], [two thirds, third], [third, two thirds], [half, half], [half, half]; medium rows are one per full or two thirds card and pairs of halves and thirds`, same for `Executive`, `SEO analyst`, `Competitive`, `Topic owner`, and `no row is part empty at wide or medium except SEO analyst medium row 5 and Topic owner medium row 4` (an explicit accepted list; any other part empty row fails).
- `Start from applies a preset to the draft, counts as changes and is undoable` is WP-16's; here only: `the menu lists Built-in default, then Executive summary, SEO analyst, Competitive, Topic owner`.

Documents (the tables of inventory 9.5, final variants):
- **Executive summary**: numbers `mention-chatgpt`, `mention-gemini`, `mention-ai-mode`, `sov-chatgpt`; cards `ai.change_summary` (facts 3, full), `ai.rate_trend_by_engine` (mention, full), `ai.share_of_voice` (ChatGPT, rows 5, half), `ai.topic_extremes` (mention, rows 3, half), `ai.answer_funnel` (half), `ai.period_comparison` (mention, half).
- **SEO analyst**: numbers `prompts`, `citation-chatgpt`, `citation-gemini`, `citation-ai-mode`, `citation-share-chatgpt`; cards `sources.own_pages` (10, half), `sources.top_domains` (third party, 10, half), `ai.citation_vs_mention` (ChatGPT, two thirds), `ai.citation_share_by_domain_type` (third), `ai.fanout_top` (10, half), `ai.prompt_movers` (ChatGPT, half), `ai.opportunities` (8, half), `ai.sample_coverage` (half).
- **Competitive**: numbers `prompts`, `sov-chatgpt`, `sov-gemini`, `sov-ai-mode`; cards `ai.share_of_voice` (ChatGPT, half), `ai.share_of_voice` (Gemini, half), `ai.competitor_trend` (ChatGPT, 3, full), `ai.lost_to_competitor` (ChatGPT, half), `ai.competitor_table` (mention, half), `ai.sov_over_time` (ChatGPT, two thirds), `sources.top_domains` (competitor, third), `ai.sample_coverage` (third, card 8, added: spec 9.5 leaves `ai.co_mentions` alone on a wide row, finding F12), `ai.co_mentions` (ChatGPT, two thirds, card 9). Wide rows: [half, half], [full], [half, half], [two thirds, third], [third, two thirds]; medium: [half, half], [full], [half, half], [two thirds], [third, third], [two thirds].
- **Topic owner**: numbers `prompts`, `mention-chatgpt`, `mention-gemini`, `mention-ai-mode`; cards `ai.topic_heatmap` (mention, level all, rows 20, full), `ai.topic_extremes` (half), `ai.topic_movers` (half), `ai.topic_engine_gap` (two thirds), `ai.sample_coverage` (third), `ai.topic_trends` (mention, 6, full), `ai.engine_disagreement` (half), `ai.topic_contribution` (ChatGPT, half).

Labels come from `aiOverview.presets.*` (no stored named layouts, D-01). The page builds `useMemo(() => definePresets('ai_overview', [...]), [t])`.

Milestone M1 (after this task): rebase, TARGET on every test file of T1 to T6 and `src/lib/layouts`, `src/features/layouts`, LINT, TYPES,
FORMAT, push to `develop`, report `building` with "cards can start". After M1 `develop` holds the catalog entries, the registry slots, the
context, the data hooks, the aggregates, the grid and the presets: the shell tasks that follow do not change what a card sees.

A11y: Start from is WP-16's menu. Rows: WB-OV-14. Browser: Fynix: apply each preset in customize mode at 1280 and 768 px, read the row packing against the tables, undo, Save, reload. Commit `WP-33: presets and Start from`.

### T7: top bar scope, compare, engines, topic, branded, URL filters

Files (new): `scope/scope-bar.tsx`, `scope/compare-select.tsx`, `scope/engines-control.tsx`, `scope/topic-options.ts`,
`scope/branded-field.ts`, `scope/country-control.tsx` and tests; modify `ai-overview-screen.tsx`, `en.json` (`scope`).

Tests first:
- `compare-select.test.tsx`: `defaults to vs previous period and No comparison writes cmp=off`, `the menu header names the two windows in words`, `the previous window dates come from previousWindow`, `keyboard: arrows and Enter choose, Escape closes`.
- `engines-control.test.tsx`: `lists the enabled engines with logos and the count on the trigger`, `the last engine cannot be turned off and says why`, `choosing all engines clears the key from the URL`, `an engine that is off in the project is not listed`.
- `topic-options.test.ts`: `flattens the topic vocabulary to options with their paths`, `two topics of one name are told apart by path`, `a topic of a link that the tree does not hold is kept while the tree loads` (as the Prompts page does).
- `scope-bar.test.tsx`: `renders compare, engines, then the filter bar with the Branded Excluded chip`, `removing the chip means Included and the chip goes`, `+ Filter offers Topic and brings Branded back`, `a link topic or engine that does not read is dropped and the person is told once`, `the country control lists the prompts' countries, shows the ISO code under 1024 px and is a label with one country`, `clearing the country clears country only`, `Reset filters appears while anything differs from the default and leaves the window and the country`.

Implementation: `ScopeBar` = `CompareSelect` + `EnginesControl` + `FilterBar` (fields `topic` single enum and `branded` single enum, values
`excluded` default, `only`, `included`; `useUrlFilters` for `topic`; `branded` goes through `useOverviewScope` so the default chip is
shown from the default and `branded=excluded` is never written). The top bar holds `DateRangePicker` and `CountryControl` through
`TopBarPortal`, exactly as the Prompts page (`CountryControl` is a copy of `PromptsCountryControl` with `aiOverview.scope` words and a
`// shortcut: copy of features/prompts/prompts-scope.tsx, move to components/app/filters (follow-up F5)` note: a feature cannot import a feature).
Below 768 px the filter bar is the "Filters" button with a count badge opening a `Sheet` with the same controls (spec 3.5; the window and country move into the sheet at 390 px).
`RefetchBar` is added in T9; here the controls only drive `setScope`.

A11y: every control a tab stop with an accessible name; chips are buttons with "Edit filter" and "Remove filter Branded"; the engines popover is a checkbox group in a labelled dialog; focus returns to the trigger. Rows: WB-OV-03. Browser: scope changes at four widths; the filter sheet at 390; compare menu text; Compact density. Commit `WP-33: scope bar`.

### T8: numbers zone and number catalog values

Files (new): `numbers/number-model.ts`, `numbers/use-number-values.ts`, `states/strip-error.tsx` and tests; modify `ai-overview-screen.tsx`, `en.json` (`numbers`).

Tests first:
- `number-model.test.ts` (pure, one `it.each` over the catalog of 3.4): `ai.prompts_in_scope shows the count and "in 13 topics"`, `ai.mention_rate shows the rate, the points delta, "612 of 1,800 answers" and the counts in the tip`, `a rate under 4 valid answers shows "3 answers" with the insufficient state and no delta`, `no answer shows "No valid answers" with the invalid count`, `an engine outside the engine filter shows Not asked with its reason`, `an engine that is off shows Off in this project`, `fan-out presence on Gemini shows Not exposed`, `a delta is absent, not zero, when the previous window has no answer`, `a delta is coloured only when detectable and neutral with "within normal variation" otherwise`, `share of voice delta is neutral (no test yet)`, `citation share reads meta.by_role own over citation_units with its counts`, `every number's tip names the window, the prompt count, and the invalid answers`, `no number string contains a dash`.
- `use-number-values.test.tsx`: `valueOf is pure and cheap (called for every number on every render)`, `status is loading until the summary has answered, refetching on a scope change`, `a failed summary read gives the strip error row with Retry and the numbers n/a`, `the sources number waits for its own read without blocking the rest`, `the R12 parity test: for Fynix and Eventus, each engine's mention rate and counts on this page equal the Topics and Prompts strip's for the same scope`.

Implementation: `useNumberValues()` returns `{ valueOf, status, error }`; `valueOf(item: NumberItem): NumberValue` is a lookup in `NUMBER_BUILDERS`
keyed by metric (`Omit<MetricStripItem, 'id' | 'label'>`: `value`, `unknown`, `delta` as `<Delta input test="interim" tip={false}/>` with `formatMetricDelta`
tones, `context`, `tip`, `href`). Rates use `formatPercent`, deltas `formatPointsDelta`, counts `formatInteger`; the tip carries the sentence "612 of 1,800 valid answers,
250 prompts each counted once, 62 answers not valid" and the interim label "Unpaired test on pooled counts". `NumberStrip` gets
`status` (`loading`, `ready`, `refetching`), the strip label is the window and "branded excluded". Links come from T10; until then `href` is absent
(a test pins that no href means a plain cell). Strip failure: a one row error (`InlineError` with Retry) in the strip's height, the cards keep their states.

A11y: each cell is a labelled group with `aria-describedby` for the tip (WP-16 `NumberStrip`); a number that leads somewhere is a link with a focus ring; "3 answers" is text, not colour. Rows: WB-OV-04. Browser: Fynix and Eventus at four widths, a chosen country with no prompts, a single engine filter, compare off, a window with no answers (a 1 day window on a Sunday). Commit `WP-33: numbers zone`.

### T9: notices, empty and no engine states, freshness, refetch bar

Files (new): `notices/notice-model.ts`, `notices/overview-notices.tsx`, `states/no-engine-state.tsx`, `states/no-prompts-state.tsx`, `header/freshness` use, and (L6) `components/app/status/refetch-bar.tsx`, `freshness-indicator.tsx`, else `parts/` copies, with tests; modify `ai-overview-screen.tsx`, `meta-line.ts`, `en.json` (`notices`, `empty`).

Tests first:
- `notice-model.test.ts`: the whole table of 3.5 in order: `no engine beats everything`, `no prompts`, `first collection pending names the next run from the schedule`, `paused schedules`, `invalid answers name the worst engine and its counts`, `stale after 5 days and not at 5`, `only one notice is returned`, `an engine outside the filter is not counted`, `invalid counts use the same denominator as the numbers`.
- `overview-notices.test.tsx`: `renders one Banner with the right tone, role only when it appears after load (live), and View runs when allowed`, `the dropped range notice is shown with the Prompts page's words`.
- `freshness-indicator.test.tsx`: `fresh shows the time in type-meta and the relative time in a tooltip`, `stale shows the warning badge from 5 days`, `none shows "No AI answers yet"`, `the time element has a datetime`, `relative text refreshes without announcing`.
- `refetch-bar.test.tsx`: `shown after 150 ms of refetching, hidden when done, static and 2 px, aria-hidden`.
- `no-engine-state.test.tsx`: `with projects:write the action goes to Settings > Engines, without it the sentence asks a workspace admin`, `no prompts opens Topics and prompts`, `a country with no prompts offers Clear location`.
- Screen tests (harness): `Cleanstart shows the no engine state and no strip or grid`, `refetching keeps the values at full opacity with aria-busy and the bar`, `a failed summary shows the strip error and the cards keep their own states`, `skeletons keep final heights (card tops do not move)`.

Implementation: `RefetchBar` per DS 25 11.6 (`active`, `position`), the page places it `under-filter-bar` for scope changes. `FreshnessIndicator` is the reduced V1 (states `fresh`, `stale`, `none` and the warning badge; the full state set stays follow-up F6) and takes the time as an instant and the zone.
The notice region renders `OverviewNotices` between header and strip. Banner placement `region`.

A11y: banners present on load have no role, ones that appear later use `live`; one primary action each; the warning badge is text and icon, never colour alone. Rows: WB-OV-13, WB-OV-02 (stale). Browser: Cleanstart, Fynix with schedules paused (mock cookie of `schedules`), a 5 day old window, a failed summary (mock fault), four widths, both themes. Commit `WP-33: notices, empty states and freshness`.

### T10: drill-down helpers and number links

Files (new): `drilldown/drill-links.ts`, `drill-links.test.ts`; modify `numbers/number-model.ts` (hrefs), `index.ts` (export the helpers).

Tests first (`drill-links.test.ts`):
- `every link carries window, cmp, country, engine, topic and branded of the scope` (a table over destinations: Prompts tab, Topics tab, topic drawer, Citations, Competitors).
- `the Prompts links are read by the Prompts page's own parsers` (the test imports `parseTab`, `parseSort`, `parseCountry` from `features/prompts/prompt-model` and `parseColumns`/`SORT_ID`, and asserts `tab`, `country`, `engine` and the sort id the link writes are accepted: this fails if WP-17 renames a key).
- `a destination that is not live in the navigation registry gives null, not a link to a 404 page` (Citations, Competitors, Sources while planned).
- `an engine number links to Prompts with that engine and the sort of its rate`, `outcome and opportunity parameters are written only for destinations that read them` (a `DRILL_SUPPORT` table, `false` today: the cards render plain text until WP-17 reads them).
- `branded excluded and compare on write nothing`, `the topic drawer is inspect=topic:<term> on the Prompts page`.

Implementation: `drillHref(kind, scope, extra): Route | null` with kinds `prompts`, `topic`, `topicDrawer`, `citations`, `competitors`, `sources`, `runs`, using `projectPath` and the `NAVIGATION` registry for liveness; a single translation table maps scope fields to each destination's keys (F6). `numbers` links: an engine number leads to `prompts` with `engine=<code>` and the rate sort; Prompts to `prompts`.

A11y: links are ordinary anchors with the number name. Rows: process (drill-down helpers). Browser: click a number at 1280, check the Prompts page opens with the engine and window carried. Commit `WP-33: drill-down helpers`.

### T11: Export Numbers (CSV), export registry, shortcuts

Files (new): `export/export-model.ts`, `export/export-registry.tsx`, `export/export-menu.tsx` and tests; modify `ai-overview-screen.tsx`, `en.json` (`export`, `shortcuts`).

Tests first:
- `export-model.test.ts`: `one flat table with a block column: for every number the value (a percent number), numerator, denominator, n_observations, prompts, engine, window from and to, compare from and to, country, topic, branded, method "prompt weighted", is_estimate false`, `an unknown value is an empty cell, never 0`, `text cells are written so a spreadsheet does not read them as a formula (safeText)`, `a block from a card follows the strip block with a blank line`, `the file name carries the project and the window`.
- `export-registry.test.tsx`: `a card registers a block with useExportBlock(id, getBlock) and unregisters on unmount`, `a block that returns null (still loading) is left out and counted in the note row`, `the registry is read when the menu item runs, not on every render`.
- `export-menu.test.tsx`: `Numbers (CSV) is disabled with a reason while the summary has not read`, `it downloads one file and toasts "{n} rows exported"`, `a failed build shows the error toast`, `the Export menu is a labelled secondary button with a menu, keyboard: Enter opens, arrows move, Escape closes`.
- Shortcuts: `the keys are registered through useShortcut: c toggles Customize when allowed (768 px and up), e opens the Export menu, and neither fires while typing or when single key shortcuts are off` (check the shortcuts dialog's key list for conflicts and add the descriptions through its seam, `docs/design-system/20-accessibility.md` section 14).

Implementation: `csvBlob` and `downloadBlob` from `lib/csv/csv-write.ts`; the table is built from `OverviewAggregates` and the scope, so the file equals the strip. `ExportProvider` (inside `OverviewProvider`) keeps a ref map of `{ id, getBlock }`; `useExportBlock(id, getBlock)` is the card API (section 5); WP-34 to 37 call it for their "Table (CSV)" content. PNG per chart stays in `ChartFrame`. Copy link is T5.

A11y: toasts are live regions already; the menu items have names; the disabled item has an `aria-describedby` reason. Rows: process (export). Browser: download in Chromium (`page.waitForEvent('download')`), open the CSV, compare a number to the strip. Commit `WP-33: export Numbers and shortcuts`.

### T12: navigation live and e2e part 1 (leases L3, L4)

Files (modify): `lib/navigation/registry.ts` (`aiOverview` status `live`, nothing else), `lib/navigation/registry.test.ts` (remove `aiOverview` from the planned pin); (new) `e2e/flows/ai-overview.spec.ts`, `e2e/support/ai-overview.ts`.

Tests first: the registry pin edit is the red test (it fails until the flip). `e2e/flows/ai-overview.spec.ts` part 1 (production build through the heavy lane, helpers in `support/ai-overview.ts`: `openOverview(page, project)`, `numbersOf(page)`, `waitForOverview`, widths and themes as `e2e/support/layouts.ts`):
1. `the sidebar lists AI visibility Overview for a member and it opens /ai` (WB-IA-01, WB-OV-01).
2. `Fynix: header, meta line, the four numbers with counts, notice region empty, nine cards in the built-in order` (placeholders are fine until WP-34 to 37 merge: the test asserts card titles, not contents).
3. `the window, compare, engines, country, topic and branded are in the URL and survive reload and Back`.
4. `a number links to Topics and Prompts with the scope carried`.
5. `Cleanstart: no engine state with the right action by role (editor vs viewer)`.
6. `the notice precedence with paused schedules`.
7. `loading shows skeletons and no spinner; a failed summary shows the strip error and Retry works` (fault cookie of the summary mock).
8. `axe: no serious or critical violation at 390, 768, 1024 and 1280 px, light and dark, Default and Compact`.
Never against the dev API; against the mock (`NEXT_PUBLIC_API_MOCKING=all`).

Commit `WP-33: navigation live and e2e flow`. Rows: WB-IA-01, WB-OV-01.

### T13: e2e part 2, docs, final checks, push

Files: `e2e/flows/ai-overview.spec.ts` (part 2), `docs/ai-visibility/inventory/overview-and-charts.md` (append "As built (WP-33)"), `docs/design-system/24-page-templates.md` (new 9.2a, D-20, L8), the plan's own "As built" at its end.

Tests first (e2e part 2): `Customize enters, a card is hidden with Undo, the catalog lists the AI types, Save, reload keeps the layout`, `every preset applies and leaves no part empty row except the accepted two (read from packRows, asserted on the DOM at 1280 and 768 px)`, `a team default by an admin is what a member sees, the differs line shows`, `Customize is absent at 390 px and the saved layout is full width in order`, `Export Numbers downloads a CSV whose numbers equal the strip`, `the keyboard path: Tab reaches header, notice action, every number, compare, engines, chips, cards' links; c and e shortcuts`, `Escape in customize asks first when the draft differs`, `unavailable AI cards are placeholders with a reason on a project with AI off`.

Work: the final review (second fresh Sonnet reviewer opens `/ai` at the four widths in both themes and densities and reads the whole diff against the brief's acceptance criteria and the 7 rows); `git fetch origin && git rebase origin/develop`, regenerate `catalog.json` if the file changed, resolve `en.json` by keeping both sides then the messages test; the 9.2a section in DS 24 documents the as-built order (header, notice, strip, filter bar, grid) and the meta rule; As built note in `overview-and-charts.md` (what was built, the deviations of 2.3, the seam of 3.3, the card contract); then the heavy lane: `infra/dev/heavy --label wp33-final -- bash -c 'cd apps/web && pnpm test --maxWorkers=3 && pnpm build'` and `pnpm e2e` for `ai-overview.spec.ts` and `ai-layouts.spec.ts` (customize must still pass), `cd backend && uv run pytest tests/api/layouts --no-cov -n 2`, and `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane. Push `git push origin HEAD:develop` (fast-forward only), report `merged`.

Commit `WP-33: e2e part 2, As built notes and final checks`. Rows: WB-OV-14 (proof), all rows confirmed.

## 5. Integration contract for WP-34 to 37

What the shell provides, all in `apps/web/src/features/ai-overview/` (a card is in the same feature, so it imports these directly; `features/layouts` through `@/features/layouts` once L1 is granted):

1. **Catalog entries exist.** Every card of inventory 9.4 for `ai_overview` (waves 1 and 2) is in `lib/layouts/catalog.ts` with its widths, instances and options. A card package does not edit the catalog for its own cards. If a card needs a different option, width or a new key (CH-34 treemap by role has no key in 9.4 and needs the design review first), it asks the coordinator for a lease on `catalog.ts` and runs `pnpm gen:layout-catalog` in the same commit.
2. **Register a card.** Each package owns its family file and fills its map (the file starts as `export const ENGINE_CARDS = {}`):

   ```ts
   // features/ai-overview/cards/engines/index.ts (WP-34 owns it from M1)
   export const ENGINE_CARDS: Readonly<Record<string, CardRegistration>> = {
     'ai.rate_trend_by_engine': { load: () => import('./rate-trend-card'), skeleton: RateTrendSkeleton },
   };
   ```

   `cards/registry.ts` spreads the five family maps over the pending placeholders, so a card replaces its placeholder by being listed. Default export of a card file: `ComponentType<CardProps>`. Skeleton at the card's final height.
3. **Card props** (`CardProps` of `@/features/layouts`): `item`, `options` (sanitized, every key present), `width`, `mode`, `live`. A card passes `subscribed: live` to its queries, renders inside `inert` in customize mode, and never stores a topic, a competitor or a keyword in its options (options are project agnostic).
4. **Scope and context.** `useOverview()` gives `{ workspaceId, workspaceSlug, project, scope, enabledEngines, canManageEngines }`; `scope` is the `OverviewScope` of 3.2 and is the only scope a card may use (R12). A card never reads the URL itself.
5. **Reads.** Cards read only through `useOverviewSummary({ include?, rows? })`, `useOverviewPeriods(options)`, `useOverviewSources(options)`, `useOverviewFanout()`, `useOverviewEngines()`, `useOverviewSchedule()` (3.3). Same options means one request (shared key). `include` values: `series`, `entities` (CH-01, CH-19), `rows: 'topics'` (the topic cards), `cells`, `total` and `co_mentions` are not served by the mock yet: a card that needs them asks the owner of `prompt-answers.ts` (WP-20, lease) before using them, and the swap to server totals is follow-up F1. Aggregates: `buildAggregates` and `OverviewAggregates` give project level figures with the same arithmetic as the strip.
6. **Frames and states.** Charts and html cards use `ChartFrame` (`kind="html"` for lists, tables and bars) so title, meta, legend, Table toggle, menu, footnote, stale and partial notices, empty, error and refetch look alike. Status mapping: `Read.status` loading/ready/refetching/error to `ChartStatus`; `Read.stale` to the `stale` notice. Empty reasons teach (inventory section 12). Heights from DS 15.
7. **Drill-down.** `drillHref(kind, scope, extra)` returns a `Route` or `null` (destination not live): render plain text on `null`. Never build a link to a page by hand.
8. **Export.** A card with a Table view calls `useExportBlock(id, () => block | null)`; the Export menu includes its block when it is ready.
9. **Numbers.** Card packages do not add numbers. A new number type is a catalog edit (lease) plus a builder in `numbers/number-model.ts` (a lease on this package's file).
10. **Messages.** Own sub-namespace of `aiOverview`: WP-34 `engines`, WP-35 `competitors`, WP-36 `topics`, WP-37 `sources` (WP-37's `activity` cards use `sources` too; ask before adding a sixth).
11. **Tests.** `src/test/ai-overview-harness.tsx` renders a card inside `OverviewProvider`, `CustomizableScreen` and the grid with a scope and a world (Fynix, Eventus); component tests need `@/test/next-navigation` and the harness. A card's test proves its states (loading, empty, error, stale, partial, refetching) and that its numbers equal the strip's for the same scope.
12. **Card to package map** (catalog key: package):
    - WP-34 `engines/`: `ai.rate_trend_by_engine`, `ai.mention_trend`, `ai.by_engine`, `ai.outcome_mix`, `ai.answer_funnel`, `ai.sample_coverage`, `ai.change_summary`, `ai.prompt_movers`, `ai.period_comparison`, `ai.change_waterfall`, `ai.engine_agreement`, `ai.country_breakdown`.
    - WP-35 `competitors/`: `ai.share_of_voice`, `ai.lost_to_competitor`, `ai.competitor_trend`, `ai.sov_over_time`, `ai.sov_rank`, `ai.co_mentions`, `ai.competitor_table`, `ai.opportunities`.
    - WP-36 `topics/`: `ai.topic_heatmap`, `ai.topic_extremes`, `ai.topic_movers`, `ai.topic_engine_gap`, `ai.engine_disagreement`, `ai.topic_trends`, `ai.topic_small_multiples`, `ai.topic_contribution`, `ai.prompt_heatmap`, `ai.citation_vs_mention`, `ai.top_prompts`.
    - WP-37 `sources/` and `activity/`: `sources.top_domains`, `sources.own_pages`, `ai.citation_share_by_domain_type`, `ai.fanout_top`, `sources.new_lost`, `sources.diversity`, `activity.key_changes`, `activity.collection_status`, `ops.answer_calendar`, `ops.answer_status`, `ops.engines`, `ops.ai_spend`.
13. **M1.** After the T6 push the coordinator may release WP-34 to 37 (the brief's dependency is "WP-33 merged"; M1 is enough for them to start). T7 to T13 change the page around the grid, not the contract.

## 6. Order, milestones and dependencies

T1, T2 (independent), T3 (needs T1), T4 (needs T3), T5 (needs T1 to T4 and lease L1), T6 (needs T2, T5), then M1.
T7 (needs T1, T5), T8 (needs T4, T5, T7), T9 (needs T5, T8), T10 (needs T8), T11 (needs T8), T12 (needs T10, T11), T13 last.
Dependencies outside the package: WP-16 (merged), WP-04 (`ChartFrame`, merged), WP-07 (`Delta`, `EngineLogo`, `Banner`, merged),
WP-21 (sources mock, merged), WP-12 and WP-14 (merged); `ai/prompts` page keys stay readable (T10 test guards them).
A release between M1 and T12 is safe: the page exists but the navigation entry is still `planned`, so it is reachable only by URL.

## 7. Lease requests (for the coordinator)

| # | File (owner) | Smallest edit | Why |
|---|---|---|---|
| L1 | `apps/web/eslint.config.mjs` (WP-02) | Add one policy after policy 3: `{ from: from('feature'), allow: { to: { element: { type: 'feature', captured: { feature: 'layouts' } } } } }`, with the comment "the layout platform, like lib". Test: `pnpm lint` on a scratch import | BLOCKER (F2). Every page package that customizes (WP-33, WP-17, WP-21, WP-25) needs it |
| L2 | `apps/web/src/lib/layouts/catalog.ts` and the tests that pin its counts (WP-15, WP-16) and the generated `backend/src/idraft/api/layouts/catalog.json` (WP-11) | T2: `screens` extra on `dashboardCard`, an `aiCard` helper, `ai_overview` on five types, 38 new card types, the new numbers, the built-in layout of `ai_overview`; regenerate the JSON in the same commit | F1. Hot spot: WP-17 and WP-21 add numbers here too; on a rebase conflict take either side then re-run `pnpm gen:layout-catalog` |
| L3 | `apps/web/src/lib/navigation/registry.test.ts` (WP-02) | Remove `'aiOverview'` from the planned pin (T12) | The flip is a deliberate one line change here and in `registry.ts` (allowed by the brief) |
| L4 | `apps/web/src/app/[workspace]/[project]/planned-routes.test.ts` (WP-02) | Remove the `['/ai', ...]` row (T5) | The route is no longer the 404 page |
| L5 | `apps/web/src/test/ai-overview-harness.tsx` (new file in shared test support, like WP-16's `customize-harness.tsx`) | New file | The card packages need one harness |
| L6 | `apps/web/src/components/app/status/refetch-bar.tsx`, `freshness-indicator.tsx` and their tests (new files only, DS 25 11.4 and 11.6) | New files; no existing file edited | F5. If refused they stay in `features/ai-overview/parts/` |
| L7 | `docs/16-metrics-methodology.md` section 2.1 (WP-32 owns D-17) | Two table rows for `ai.prompts_in_scope` and `ai.valid_answers` | "If a metric is not in the registry, it does not ship". Tell WP-32 |
| L8 | `docs/design-system/24-page-templates.md` (WP-72, D-20) | New section 9.2a, as built (T13) | D-20 default Yes |
| L9 | Folders of WP-34 to 37 | This package creates `cards/{engines,competitors,topics,sources,activity}/index.ts` (one export each, empty) so the registry compiles; each package owns its file from M1. Ack only | Contract item 2 |
| L10 (optional, later) | `apps/web/src/mocks/handlers/prompt-answers.ts`, `mocks/prompt-summary.ts` (WP-20) | Answer `compare=previous_period`, `include=total`, `include=cells`, `group_by=country`, `rows=none` | Only for follow-ups F1 and F5; nothing in this plan needs it |

Not touched: `lib/api/schema.ts`, `backend/openapi/v1.json`, `mocks/handlers/index.ts`, `e2e/support.ts`, `components/ui/*`, other packages'
folders (except L9), `design-preview/*`, tracker files, the main checkout, `.claude/worktrees/release`, Colima and the dev stack.

## 8. Rows

| Row | Task | Proof |
|---|---|---|
| WB-IA-01 | T12 (flip and page) | registry and route tests, e2e 1 |
| WB-OV-01 | T5 (route), T12 (nav) | page test, e2e 1 |
| WB-OV-02 | T5 (header), T9 (stale) | unit, e2e 2 |
| WB-OV-03 | T1 (URL), T7 (bar) | unit, e2e 3 |
| WB-OV-04 | T2 (types), T4 (model), T8 (values) | unit, R12 parity test, e2e 2 |
| WB-OV-13 | T9 | unit, e2e 5 to 7 |
| WB-OV-14 | T2, T5, T6, T13 | catalog and preset tests, e2e part 2 |
| process | T3, T10, T11 (seam, drill-down, export), T12 and T13 (e2e, As built, checks) | tests, final lane |

## 9. Decisions taken here (reverse on the coordinator's word)

1. Order is header, notice, strip, filter bar, grid (preview and DS), not the spec's filter bar first.
2. URL keys are the built AI page's (`country`, `engine`, `topic`, `branded`) plus `cmp`; one table translates.
3. Meta line is freshness, prompts, engines; the window lives in the top bar and tooltips.
4. All 38 new card types are catalogued now so presets validate; the placeholder card is `ChartFrame` empty with an honest sentence.
5. The summary is read for two windows and aggregated on the client (same arithmetic as the Prompts strip) until the mock and WP-19 support one read.
6. Partial run notice counts invalid answers of the window (one denominator); N5 comes later.
7. No engine and no prompts are body empty states; no Prompts-only strip.
8. The Competitive preset is changed from the spec (finding F12); two other presets keep the part empty medium rows the spec accepted.
9. Cards unavailable by engine, country or budget are not gated in the catalog (the capability type cannot say it); they state their own empty reason.
10. The metric inspector (`inspect=metric:`) is not part of this package.

## 10. Risks

| # | Risk | Answer |
|---|---|---|
| R1 | L1 refused or slow: no layout import from a feature | Fallback in section 11 (route composes with slots); the cost is a thinner feature API, so the coordinator should grant L1 |
| R2 | `catalog.ts` edits collide with WP-17, WP-21 and later pages (several add numbers) | T2 lands before M1 and is one commit; later edits regenerate `catalog.json`; the backend freshness test and `catalog-json.test.ts` catch a stale file |
| R3 | Client aggregation of 150 prompts by 3 engines on every scope change is slow | `useMemo` over the summary, no per card recompute; measured in T8 on Eventus; follow-up F1 moves it to the server |
| R4 | Two summary reads double the request count; WP-34 to 37 add `include` variants | Same options share one key; cards must use the hooks; an e2e assertion counts summary requests on first load (at most 3 on the default page) |
| R5 | `prompts` page keys change (WP-17) and drill-down links rot silently | T10 test uses the Prompts page's own parsers, so a rename fails here |
| R6 | A preset or the built-in layout references a type a card package renames | `definePresets` and the registry test fail in this package's CI, not for the person |
| R7 | The pending placeholder reaches production if a release happens before WP-34 to 37 merge | The entry is `planned` until T12; the coordinator should not release between T12 and the cards. The placeholder text is honest |
| R8 | `useLayoutCapabilities` reports no AI while engines load, so the page flashes the no engine state | The screen shows skeletons until `status !== 'loading'` and never the empty state from `loading` |
| R9 | The 768 to 1023 px header is crowded (Customize, Export, More) | The More menu takes Copy link only; if tight, Export moves into More under 1024 px (a one line change) |
| R10 | The fan-out mock handler duplicates WP-24's | Ordered after `fanoutHandlers`; WP-24 supersedes it; its comment says so |
| R11 | The interim unpaired test colours a delta that the paired test would not | Labelled "Unpaired test on pooled counts" in every tip (R5); share of voice stays neutral |

## 11. Open questions for the coordinator (blockers only)

1. **Q1 (blocks T5): grant lease L1** (feature to `features/layouts` in `eslint.config.mjs`), or choose the fallback: the route
   `page.tsx` (a route may import both features) composes `CustomizableScreen`, `CustomizeButton`, `NumberStrip` and
   `CustomizableGrid` and passes them to `AiOverviewScreen` as slots, with the card registry and presets built in the route. The fallback
   splits the page across a route and a feature, makes the e2e and test harness heavier and blocks WP-17, WP-21 and WP-25 the same way,
   so L1 is the recommended answer.

## 12. Follow-ups

- F1: one summary read with `compare=previous_period&include=total&rows=none` once the mock supports it (L10); only `data/` changes.
- F2: swap numbers and aggregates to `ai/metrics/overview` when WP-32 is on `develop` and in `schema.ts` (`useOverviewPeriods`, `buildAggregates`).
- F3: the metric inspector (`inspect=metric:<engine>.<metric>`, CH-10, CH-13, the Wilson interval, "Show in Topics and prompts").
- F4: capability keys for "ChatGPT on", "two countries" and "a budget exists" so cards can be unavailable in the catalog (WP-15 F4).
- F5: move `CompareSelect` and `CountryControl` to `components/app/filters`, shared with the Prompts page; countries from `by_country`.
- F6: the full `FreshnessIndicator` states (running, partial, delayed, failed, budget blocked) and use on the project Overview.
- F7: AI Overview as a strip item and engine once slice 2 lands (D-19): `google_ai_overview` in `ENGINES`, labelled "AI Overviews", counted not asked.
- F8: Create report on this page when Reports (WP-51) lands.
- F9: a Prompts-only strip in the no engine state (needs a prompt count read).
- F10: the partial run notice from `ai/collection/daily` (last run, by status) when WP-30 mocks it.
- F11: finer catalog groups (AI, Topics, Competitors, Sources, Activity) with the owner.
- F12: stored named layouts instead of code presets, if the owner changes D-01.
- F13: undo step names in the Undo tooltip (WP-16 F1) and the per card Window option if D-13 changes.
