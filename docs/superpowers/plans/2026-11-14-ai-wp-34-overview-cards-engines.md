# WP-34 detailed task plan: AI Visibility Overview cards, engines family

Brief: [docs/ai-visibility/work-packages/WP-34-overview-cards-engines.md](../../ai-visibility/work-packages/WP-34-overview-cards-engines.md).
Branch `ai/wp-34-cards-engines` in `.claude/worktrees/wp-34`, cut from `origin/develop` at `9216e710` (WP-33 milestone M1
merged: catalog, registry slots, context, data hooks, aggregates, presets; WP-19 compare helper and messages merged;
WP-05 and WP-06 chart parts merged). Kind: web. Rows: 11 (CH-01, CH-03, CH-09, CH-10, CH-13, CH-18, CH-23, CH-36, CH-37,
WB-OV-05, WB-OV-06). Owner requirements R-06 to R-08: a GREATER version of the approved preview dashboard, sleek,
professional, with every chart the data can honestly support.

Specs: [overview-and-charts.md](../../ai-visibility/inventory/overview-and-charts.md) section 1 (R1 to R12), 3.4 and 3.6
(widgets, states), 3.7 (drill-downs), 4.2 (shared encoding), 4.3 (CH-01 line 362, CH-03 401, CH-09 485, CH-10 500, CH-13
530, CH-18 584, CH-23 628, CH-36 733, CH-37 747), 5 (N1 to N4), 9.4 (card catalog), 12 (quality bar, empty states);
[web.md](../../ai-visibility/inventory/web.md) WB-OV-05 and WB-OV-06; [20-frontend-specification.md](../../20-frontend-specification.md)
4.6 (chart conventions and the As built notes of the chart platform); [25-component-inventory.md](../../design-system/25-component-inventory.md);
contracts [c2-summary.md](../../ai-visibility/contracts/c2-summary.md) (C-11 and C-18 pooling) and
[c8-metrics.md](../../ai-visibility/contracts/c8-metrics.md); the WP-33 plan
[2026-11-13-ai-wp-33-overview-shell.md](2026-11-13-ai-wp-33-overview-shell.md) section 5 (the card contract this package consumes).

## 1. Scope

### 1.1 Goal

Twelve cards of the catalog, all in `apps/web/src/features/ai-overview/cards/engines/` (the only folder this package
owns), each registered in `ENGINE_CARDS` so it replaces its pending placeholder:

| Catalog key | Chart | Widths (default first) | Options (default) | Frame |
|---|---|---|---|---|
| `ai.rate_trend_by_engine` | CH-01, WB-OV-05 | two thirds, full | metric: mention, citation, share of voice (mention) | `SmallMultiples`, one panel per asked engine, 140 px |
| `ai.mention_trend` | CH-01 single panel, WB-OV-05 | half, two thirds, full | engine (ChatGPT) | `SmallMultiples`, one panel, 180 px |
| `ai.by_engine` | WB-OV-06 | half, two thirds, full | none | `ChartFrame` html with `PlainTable`, 180 px |
| `ai.outcome_mix` | CH-03 | third, half | none | `ChartFrame` html with `StackedShareBar`, 180 px |
| `ai.answer_funnel` | CH-36 | third, half | none | `ChartFrame` html with `StepBars`, 180 px |
| `ai.sample_coverage` | distribution list | third, half | none | `ChartFrame` html with `BarList` distribution, 180 px |
| `ai.change_summary` | CH-37 | full, two thirds | facts: 3, 5 (5) | text card in a `ChartFrame` html, 140 px |
| `ai.prompt_movers` | CH-09 | half, two thirds | engine (ChatGPT), direction (both), rows 5 or 8 (5) | `ChartFrame` html with `IntervalBar` diverging, 240 px |
| `ai.period_comparison` | CH-10 | third, half | metric (mention) | `ChartFrame` html with `IntervalBar` dumbbell, 180 px |
| `ai.change_waterfall` | CH-13 | half, two thirds | engine (ChatGPT), metric: mention, citation (mention) | `ChartFrame` html with a local waterfall body, 240 px |
| `ai.engine_agreement` | CH-18 | third, half | none | `ChartFrame` html with `BarList` distribution, 180 px |
| `ai.country_breakdown` | CH-23 | half, two thirds | metric (mention) | `ChartFrame` html with one `TopicEnginePanel` per country, 240 px |

Widths and options are the catalog's (`lib/layouts/catalog.ts`, read, never edited here). There is no Window option
(D-13 default No). Engines are the three of `ENGINES` in the catalog: ChatGPT, Gemini, AI Mode. A card shows only the
engines that are asked (on in the project and inside the page's engine filter, `askedEngines`).

### 1.2 What exists (read before every task, do not rebuild)

| Exists | Where | Use here |
|---|---|---|
| Shell M1: `OverviewProvider`, `useOverview()` (scope, project, engines, `canManageEngines`, `canViewRuns`), `useOverviewSummary`, `useOverviewPeriods` (`current`, `previous`, `paired`, `settled`), `useOverviewSources`, `useOverviewSchedule`, `Read<T>` (`idle`, `loading`, `ready`, `refetching`, `error`, `stale`, `errorId`, `refetch`), `buildAggregates`, `OverviewAggregates` | `features/ai-overview/index.ts`, `overview-context.tsx`, `data/*` | The only way a card reads data. A card never calls `apiQuery` for a read the hooks have |
| `engineRates`, `RateFigure`, `shareOfVoiceTotals` (`lib/rates/strip-model.ts`), `cellFigure`, `averageRate`, `validAnswers` (`lib/rates/rate-model.ts`), `rateChange`, `deltaInput` (`lib/compare/change-model.ts`), `parseCompare`, `cmpParam` (`lib/compare/compare-model.ts`), `wilsonInterval`, `differenceInterval`, `isDetectableChange`, `equalWeightAverage`, `promptWeightedRate`, `MIN_OBSERVATIONS` (`lib/stats`) | `lib/*` | All arithmetic. A card adds no rate formula that is not in these |
| `ChartFrame` (kinds `line`, `bar`, `html`; states `loading`, `ready`, `refetching`, `empty`, `error`; `notice` stale or partial; `controls`; `footnote`; `summary`; menu CSV), `SmallMultiples` (finished `RateBandPoint`s, `previous`, boundaries, own frame, Table view, CSV), `BarList` (comparison and distribution, `BarListTable`, `barListCsv`), `StackedShareBar` and `StackedShareTable`, `StepBars` and `StepBarsTable`, `IntervalBar` (`diverging`, `dumbbell`, `changeDomain`), `TopicEnginePanel` (one row per engine, `ok`, `insufficient`, `none`), `SmallSampleMarker`, `Delta`, `DeltaCell`, `SampleCount`, `MetricInfo`, `PlainTable`, `EngineLogo`, `useRateTipWords`, `rateTipText`, `rateTipRow` | `components/app/chart`, `components/app/metric`, `components/app/engine`, `components/app/table`, `lib/charts` | Every drawing. The parts compute no rate and hold no string: the card passes finished numbers and words |
| `ENGINES` (code and label), `cardName`, card types and options | `lib/layouts/catalog.ts`, `lib/layouts` | Labels and option values |
| `CardProps` (`item`, `options`, `width`, `mode`, `live`), `defineCards`, `CardRegistration` | `features/layouts` | Registration |
| Harness: `cardInOverview({ type, Card, width, world, role })`, `overviewAs`, `overviewProject`, `CARD_ID`; `serveLayouts`, `stubViewport` | `src/test/ai-overview-harness.tsx`, `src/test/customize-harness.tsx` | Component tests of a card inside the real provider and grid. A test needs `vi.mock('next/navigation', ...)` from `@/test/next-navigation`, and `vi.mock('@/components/app/chart/echart', ...)` for a canvas card (see `components/app/chart/small-multiples.test.tsx`) |
| MSW world: Fynix (the page test counts 2 engines on, ChatGPT and Gemini; 24 prompts, 23 in DE and the Hindi prompt in IN), Cleanstart (engines off), Eventus Security with `setAiSeeded(true)` (92 days of answers); `prompts-summary` answers `include=series,entities`, `rows`, `filter[engine_code_in]`, `filter[country_iso]`, `filter[term]`, `include_branded`, `branded_only`, with API pooling of prompt points and topic points (C-11) | `mocks/handlers/prompt-answers.ts`, `mocks/prompt-summary.ts` | All card tests and browser checks |
| `ENGINE_CARDS = {}` and the registry test that every family key is an active `ai_overview` type | `cards/engines/index.ts`, `cards/registry.ts` | T1 to T5 fill the map |

### 1.3 Findings that shape the plan

| # | Finding | Consequence |
|---|---|---|
| F1 | The summary mock does not answer `compare`, `include=total`, `include=cells` or `group_by=country` (a 422 for `include` values other than `series` and `entities`); the real API does (`PromptsSummary.total`, `by_country`, `engines[].previous` are in `schema.ts`). WP-19's mock work is on branch `ai/wp-19-compare`, not on develop. WP-32's metric routes are not in `schema.ts` | Every card reads the summary twice (this window and the window before, `useOverviewPeriods`) and joins prompts by `prompt_id` on the client. This works against the mock and the real API today. No card uses `previous` cells, `total`, `by_country` or a metric route. The swap point is `use-card-data.ts` (T0) and the pure models (section 3.2) |
| F2 | Prompt rows of `include=series` are always pooled over the trailing 4 weeks by the API (C-11, `prompt_point`); topic, total and country points pool when fewer than `POOL_BELOW_PROMPTS = 10` prompts answered that week (D-04, in the API since WP-12). No `total` in the mock | CH-01 builds a project weekly point from the prompt rows: the sum of the prompts' pooled counts per week. Every such point is a 4 week pool, and the tooltip and footnote say so (R7). When `summary.total` carries a series (real API with `include=total`), `trend-model.ts` uses its points and its `is_pooled` and `pool`. A test pins both sources (T1) |
| F3 | `WeekCells` has no entities per week for competitors on prompt rows and share of voice has no count of successes | Share of voice points have a value and `n` (answers naming a brand) and no band; the footnote says "no interval for share of voice". Mention and citation points carry the Wilson interval of the pooled counts (R8) |
| F4 | No `ai/metrics/*`, no `ai/collection/daily`, no annotations (N9), no per week entities (N3) | No version boundaries are drawn. When `entity_config_versions` holds more than one version and the metric is share of voice, the footnote says the tracked set changed (R9) |
| F5 | The WP-33 branch `ai/wp-33-overview-shell` (at `7c251639`) holds `drilldown/drill-links.ts` (`drillHref`) and `export/export-registry.tsx` (`useExportBlock`) with their exports in `index.ts`; develop does not. `RefetchBar` and the freshness component are also WP-33's and absent | T0 checks develop after the rebase. If both exist, cards use them through `use-card-seams.ts`; if not, that file gives plain text and no export block, and T6 wires them (open question Q1). A card never builds a link by hand |
| F6 | `DrillKind` has no prompt destination (`inspect=prompt:<id>`); `DRILL_SUPPORT` is false for `outcome` and `opportunity` on every destination | Movers rows link to the Prompts page only when Q2 is granted; outcome segments and opportunity rows are plain text until WP-17 reads `outcome=` |
| F7 | `ai-overview-screen.test.tsx` (WP-33) pins that all nine cards of the built-in layout are pending (lines 81 to 102) | Each family that registers a built-in card breaks it. T1 makes that test count the pending cards from the registry (lease Q3) |
| F8 | `subscribed: live` in the `CardProps` doc is not an option of the shell's hooks. In customize mode a card mounts, and reads, but is `inert` | Reads are shared by key, so a card using the shell's default options costs no request; series and per country reads do. Accepted (customizing is short). Q5 |
| F9 | A feature may not import another feature (ESLint boundaries). `engineRole` and `rateCeilingOf` live in `features/prompts/history-model.ts`; the weekly point model in `features/prompts/topics-by-engine/series-model.ts`; `useRateWords` in `features/prompts/rate-view.tsx` | T0 and T1 write own small copies (role, ceiling is already `rateCeilingOf` in `components/app/chart/small-multiples.tsx`), with a `shortcut:` note; tests may import the originals to prove parity |
| F10 | The `PlainTable` and the chart parts hold no strings; the catalog has no Recommendation | WB-OV-06 has no Recommendation column (decision D2). `InlineError`, `EmptyState` and notices are built in the card with `aiOverview.engines.common` words |
| F11 | "The strip delta items" in the brief | See 1.4 |
| F12 | `chart-png.ts` has an ECharts body drawer only; no HTML rasteriser exists | HTML cards offer CSV and no PNG (spec 3.8 says PNG per chart). `SmallMultiples` offers CSV only by design. Recorded in the As built note |

### 1.4 "The strip delta items" (brief goal, last phrase)

Checked against the WP-33 plan (2.3, "Strip delta items"), `features/ai-overview/data/number-sources.ts` and contract
c8 C-24:

- WP-33 builds the delta on every strip rate it can (mention, citation, named and cited, share of voice: points,
  coloured only when detectable; valid answers: count change) from `buildAggregates` over two summary reads. Those are
  WB-OV-04 and are covered there.
- What WP-32 recorded as not built (C-24: strip deltas for `ai.citation_share`, `ai.fanout_presence_rate` and the valid
  answers per engine, and a `previous` on `engine_average`) needs `previous` cells that no read serves; it is WP-58
  (additive, later). Not in this package.
- The card side of the same idea is CH-10, `ai.period_comparison` (T4), and the Delta column of `ai.by_engine` (T1).

Decision D1: no task is added for strip delta items. The final report names this; if the coordinator means something
else, it is a new row.

## 2. Parity with the approved preview

Source: `apps/web/design-preview/index.html`, project Overview (`data-card="trend.visibility_mentions"`, lines 381 to
405; `data-card="ai.by_engine"`, lines 464 to 476). The spec is the truth for data rules.

| # | Preview | Built in | Note |
|---|---|---|---|
| P1 | Card frame `bg-surface border border-border rounded-lg`, title `type-section-title`, meta line `type-meta` with window, prompts and what the values are of | `ChartFrame` (every card) | Meta = window, prompts, answers, branded choice (`card-meta.ts`) |
| P2 | Trend card: one small multiple per engine, the Series menu in the title row, the Table toggle | T1 | The Series menu is a `Select` in `ChartFrame.controls` or the frame's controls slot, a viewer choice kept in component state; the saved default is the Metric option. The Table toggle is the frame's |
| P3 | AI by engine: title with "core, non-branded" beside it, `h-row-compact` rows, engine logo then name, Mention, Citation, SOV columns hidden under a container width, an equal-weight sentence under the table | T1 | The beside-title words become the meta line ("branded prompts left out"). The sentence is the footnote: "avg of 3 (ChatGPT, Gemini, AI Mode, each counted once): mention 30%". Columns drop by container query (`@xl`), not viewport |
| P4 | Method line under each chart | every card | `footnote` slot, one or two sentences |
| P5 | No icon on cards, no coloured headers, no pills | every card | Quality bar 12 |

Built beyond the preview: counts under every percent, the previous window dashed, small-sample markers, detectable
only colour, pooled wording, Table view and CSV on every card, loading and error and stale states, drill-down links that
carry the scope.

### 2.1 Design ambitions (checkable in review)

| # | Ambition | Check |
|---|---|---|
| A1 | One accent: `chart-1` for the own brand and for ChatGPT as an engine (engine charts: ChatGPT `chart-1`, Gemini `chart-2`, AI Mode `chart-3`); everything else neutral; no engine colour in an outcome chart (CH-03 uses `chart-3` to `chart-5` and `chart-other`, never `chart-1`) | Reviewer greps for palette classes and for `chart-1` in `outcome-mix` |
| A2 | One anatomy for a figure: value in `num`, its count beside it ("34%, 612 of 1,800 answers"), `Delta` only through `deltaInput`; same words in the cell, the tooltip, the Table view and the CSV | One test per card: the Table view text equals the accessible text |
| A3 | No layout shift: `ChartFrame` keeps `height` through loading, empty and error; the registry skeleton has the same height as the loaded frame (T0 test) | Test, plus browser: card tops equal before and after data |
| A4 | Everything reads at 390 px without sideways scroll: container queries (`@container` on the frame body), not viewport; BarList and StepBars already switch at 448 and 672 px containers | Browser at 390, 768, 1024, 1280 |

## 3. Design

### 3.1 Folder layout (`apps/web/src/features/ai-overview/cards/engines/`)

```text
index.ts                    ENGINE_CARDS (this package owns it from M1); each task adds its entries
engine-role.ts              engineRole, engineChartColor, engineLabel, ASKED order helpers            (T0)
card-phase.ts               cardPhase: reads to a ChartFrame status                                     (T0)
use-card-data.ts            useCardData: reads, aggregates, phase, stale, retry                         (T0)
use-frame-state.ts          useFrameState: status, empty, error, notice props of ChartFrame            (T0)
card-meta.ts                the meta line and footnote parts shared by every card                       (T0)
card-skeleton.tsx           skeletonOf(height): the registry skeleton at the frame's final height      (T0)
use-card-seams.ts           useCardDrill, useCardExport: thin wrappers over WP-33's helpers            (T0)
use-card-density.ts         the person's table density for BarList and StepBars                         (T0)
engines-fixtures.ts         test builders: promptRow, engineCells, summaryOf, week                      (T0, test only)
trend-model.ts, trend-frame.tsx, rate-trend-card.tsx, mention-trend-card.tsx                           (T1)
by-engine-model.ts, by-engine-card.tsx                                                                  (T1)
outcome-model.ts, outcome-mix-card.tsx; funnel-model.ts, answer-funnel-card.tsx;
coverage-model.ts, sample-coverage-card.tsx                                                             (T2)
prompt-pairs.ts, facts-model.ts, fact-sentences.tsx, use-new-sources.ts, change-summary-card.tsx       (T3)
movers-model.ts, prompt-movers-card.tsx; comparison-model.ts, period-comparison-card.tsx;
waterfall-model.ts, waterfall-body.tsx, change-waterfall-card.tsx                                       (T4)
agreement-model.ts, engine-agreement-card.tsx; country-model.ts, use-country-reads.ts,
country-breakdown-card.tsx                                                                              (T5)
```

Every model file has a `.test.ts` beside it and every card a `.test.tsx` beside it. Models are pure (no React, no
`useTranslations`): they return numbers, states and message keys with params; the card turns keys into words with
`useTranslations('aiOverview.engines.<card>')`. A card default-exports a component of `ComponentType<CardProps>`
(`export default function XCard(props: CardProps)`), which `index.ts` lazy loads.

### 3.2 The data path of each card (today, with the mock and the real API)

All reads are `useCardData` over the shell hooks (T0). "Paired" means `periods.paired` (current ready and previous ready or
absent by design); a change is drawn only when paired, otherwise the card shows the refetching state, never a change
between two scopes. `settled` is the refetch gate.

| Card | Reads | What the model does | Honest state when it cannot |
|---|---|---|---|
| `ai.rate_trend_by_engine` | `useOverviewPeriods({ include: ['series'] })` (the previous window too, for the dashed line); aggregates for the summary sentence | `trend-model.projectWeeks`: per asked engine and week, `k` and `n` summed over the prompts' pooled cells (mention: `mentioned`, citation: `cited`; share of voice: `share_of_voice` numerator and denominator), value = mean of the prompts' own rates (prompt weighted, C-19) for mention and citation, `numerator / denominator` for share of voice; band = Wilson of `k` over `n` (mention, citation); `thin` under 4 answers | See 3.4 |
| `ai.mention_trend` | the same read, one engine | the same model, one panel | engine off or outside the filter: empty with the reason |
| `ai.by_engine` | `useOverviewPeriods()`, `useOverviewSources()` | `buildAggregates` per engine: mention, citation, share of voice with counts and `change`; own citation from `citationShare`; the equal-weight line from `equalWeightAverage` over engines with a value | Own citation `n/a` with reason while the sources read is absent or "branded only" (the sources read cannot answer it) |
| `ai.outcome_mix` | `useOverviewSummary()` | `outcome-model`: per engine the four outcome shares, prompt weighted (the `figuresOf` trick of `buildAggregates`: map each prompt's outcome cell to a `mentioned` cell and call `engineRates`), counts pooled for the legend | engine under 4 valid answers: `thin`; none: "No valid answers" |
| `ai.answer_funnel` | `useOverviewSummary()` | `funnel-model`: per engine, summed over prompts: answers (`mentioned.n_observations`), valid (`mentioned.denominator`), named (`mentioned.numerator`), named and cited (`outcomes.mentioned_and_cited.numerator`); share of the step before | a share whose step before has under 4 answers is `thin` |
| `ai.sample_coverage` | `useOverviewSummary()`, one optional second read of the same factory with `branded: 'included'` for the branded count | `coverage-model`: per asked engine the prompts with 4 or more valid answers, with 1 to 3, with none; prompts with no topic; branded prompts left out (second read minus first) | the branded row says "n/a" if the second read fails; never 0 |
| `ai.change_summary` | `useOverviewPeriods()`, `useNewSources()` (own file: `GET ai/sources/changes?kind=new&limit=1`, `page.total` and `meta.min_support`) | `facts-model.buildFacts`: fixed templates, counted facts only (section 3.3) | no previous data: one sentence says so |
| `ai.prompt_movers` | `useOverviewPeriods()` | `prompt-pairs` joins prompts by `prompt_id`; `movers-model`: per prompt of one engine the change in points, `differenceInterval`, `isDetectableChange`; prompts under 4 valid answers in either window are left out and counted | compare off or no previous answers: empty that says how to turn it on |
| `ai.period_comparison` | `useOverviewPeriods()` | `comparison-model`: per asked engine the rate now and before with counts, `rateChange`, interval from `differenceInterval` (mention, citation); no interval for share of voice | row "Too few answers to compare" |
| `ai.change_waterfall` | `useOverviewPeriods()` | `waterfall-model`: exact decomposition (section 3.5) | start or end rate unknown: empty |
| `ai.engine_agreement` | `useOverviewSummary()` | `agreement-model`: prompts named by 0, 1, 2, 3 asked engines, over prompts that have 4 or more valid answers on every asked engine (D6) | fewer than 2 asked engines: empty that teaches |
| `ai.country_breakdown` | `usePromptCountries(project, scope.country)` (shell, `scope/prompt-countries.ts`) and `use-country-reads.ts` (`useQueries` over `overviewSummaryQuery` with `{ ...scope, country }`, `rows` default, `keepPreviousData`) | `country-model`: one `TopicEnginePanel` row set per country, the metric of the option, at most 8 countries by prompt count | fewer than 2 countries: empty; a failed country read: that group says so with Retry, the others stay |

### 3.3 CH-37 facts (T3), the whole rule set

`buildFacts(input): Fact[]` returns `{ id, kind, params, link }`, never text. Fixed order, each included only when its
condition holds, then cut to the Facts option (3 or 5) and a "+N more" note; the Table view lists all:

1. `collection` (first, because it changes how to read the rest): for each asked engine with `allAnswers > validAnswers`, one fact: "On Gemini, 38 of 750 answers were not valid in these 28 days." Worst engine first.
2. `engineChange`: for each asked engine whose mention change is detectable (`change.mentioned.detectable === true`): "ChatGPT mention rate is 34% (612 of 1,800 answers, 250 prompts), up 2.1 points from 31.9%." If no engine is detectable and at least one has a comparison: one fact `withinVariation`: "Mention rates moved within normal variation." If no engine has a comparison: `noPrevious`: "There are no answers in the previous 28 days to compare with."
3. `gainedLost`: for each engine, prompts that named the brand before and not now, and the reverse, over prompts with 4 or more valid answers on that engine in both windows: "On AI Mode, 12 prompts that named you no longer do; 7 prompts that did not name you now do." Written only when either number is above 0; the prompts left out for small samples are counted in the Table view.
4. `newSources`: "37 domains were cited for the first time (at least 2 citation units each)." Only when the read answered and the total is above 0 and the previous window has answers.

Not written: the share-of-voice leader fact of the spec (it needs an interval of the gap and share of voice has none, D7);
"lost" sources (needs two following windows). No causal words, no judgement adjectives: a test scans every template for
`because`, `due to`, `drove`, `caused`, `thanks to`, `great`, `worrying`, `strong`, `weak`, a dash, and "n't".
Each number in a sentence is a link to its evidence when `useCardDrill` gives one (engine facts: the Prompts page with
the engine; others plain text until the destination exists).

### 3.4 Honest states, one table, applied by every card

| State | Rule | Where it lives |
|---|---|---|
| Loading | `ChartFrame status="loading"` at `height`; registry skeleton at the same height (T0 test) | `card-skeleton.tsx`, `use-frame-state.ts` |
| Refetching | Data stays at full opacity; `status="refetching"`; while `!periods.settled` a change is never drawn from mixed scopes | `card-phase.ts` |
| Empty that teaches | Reason first, then the next step, with the real number or time; examples in 3.6 | per card messages |
| Error | The card's own `InlineError` through `ChartFrame status="error"`: title "Could not load {card}", Retry (`Read.refetch`), the error id; the rest of the page stays | `use-frame-state.ts` |
| Stale | `Read.stale` (a later read failed, data kept): `notice` kind `stale` "Stale: these are the last figures read" | `use-frame-state.ts` |
| Partial | The comparison read failed on a card that can show without it (`by_engine`, `outcome_mix` have no change): `notice` kind `partial` "Partial data: the previous window could not be read"; the Delta column is `n/a` | `use-frame-state.ts` |
| Insufficient | Under 4 valid answers: the words "3 answers" (`SmallSampleMarker`, `RateBandPoint.thin`, `BarList` kind `thin`), no rate, no bar, no band; never a 0 | models return `state: 'insufficient'` |
| Unknown | No answer, engine off, not exposed: a gap or "n/a" with the reason, never 0 | models return `none` with a reason key |
| Pooled | A pooled weekly point says "pooled over 4 weeks" with its last week (R7); the footnote says why | `trend-model.ts` |
| Averages | Cross-engine figures are labelled "avg of 3" with the engines named and sit beside the per-engine values (R3); never pooled | `by-engine-model.ts` |
| Counts | Every percent has its "k of n answers" in the cell, tooltip, Table view and CSV (R1); a prompt weighted rate also says "N prompts, each counts once" | every model |
| Colour | Only `deltaInput(...).isDetectable === true` colours a change (`formatMetricDelta` decides the tone); neutral otherwise with "within normal variation"; the tooltip says "unpaired, pooled counts" (R5, `test="interim"`) | `Delta`, `IntervalBar` |
| Drill-down | `useCardDrill` returns a `Route` or `null`; `null` renders plain text | `use-card-seams.ts` |

Keyboard path: every card's actions are the frame's (Table toggle, menu, legend toggles) and ordinary links or buttons;
no single key shortcut is added, so `useShortcut` is not used (D12).

### 3.5 The waterfall arithmetic (CH-13), exact

For one engine and metric (`mentioned` or `cited`), prompts with a valid answer count (`n >= 1`) in a window are `P1`
(now) and `P0` (before); `R1` and `R0` are the strip's prompt weighted rates (`engineRates(...)[metric].value`, which
the aggregates already hold). Let `C = P1 and P0`. Then `R1 - R0 = mean_C(r1 - r0) + remainder`, remainder
`= (R1 - mean_C(r1)) - (R0 - mean_C(r0))`. `mean_C(r1 - r0)` splits by prompt into four parts that add up exactly:
prompts of `C` with at least 4 valid answers in both windows and `r1 > r0` (rose), with `r1 < r0` (fell), the prompts of
`C` with fewer than 4 valid answers in either window (too few answers, signed), and unchanged prompts (contribute 0).
Each part is `sum over its prompts of (r1 - r0) / |C|`. Bars: start `R0`, rose, fell, too few answers, prompt set
changed (remainder), end `R1`. A test pins `start + rose + fell + tooFew + setChanged = end` within `1e-9` on the fixtures
and on randomly generated prompt sets. Start and end need `rateState` ok (pooled answers 4 or more) or the card is empty.
Colour: the start and end bars `chart-reference`; contribution bars neutral with "+" and "-" in the label; colour (via
`formatMetricDelta` tone) only when the total change is detectable.

### 3.6 Empty states that teach (sentences, to be drafted by the implementer in the same shape)

| Card | Case | Title and reason | Action |
|---|---|---|---|
| rate trend, mention trend | fewer than 2 weeks with answers | "Trends need at least 2 weeks" / "Prompts are asked on Mondays and Thursdays. The next answers arrive {time}." (time from `useOverviewSchedule().nextRunAt`, omitted when null) | none |
| mention trend | engine off in the project | "{engine} is off for this project" / "Turn it on to see its trend." | "Turn on engines" to Settings > Engines with `canManageEngines`, else "Ask a workspace admin to turn on an engine" |
| mention trend | engine outside the page's engine filter | "{engine} is not in the engine filter" / "Add it to the engines of this page to see its trend." | none |
| by engine, outcome mix, funnel, coverage | window with no valid answers | "No valid answers in these 28 days" / "{n} answers were not valid." (the invalid count when known) | "View runs" when `canViewRuns` and `drillHref('runs')` is not null |
| change summary | no previous window data | one sentence fact `noPrevious`, not an empty frame | none |
| movers, comparison, waterfall | comparison off | "The comparison is off" / "Turn on the comparison with the previous period to see what changed." | the page's compare control is a menu the card cannot open: text only |
| movers, comparison, waterfall | previous window has no answers | "No answers in the previous 28 days" / "There is nothing to compare with yet." | none |
| movers | no prompt has 4 or more valid answers in both windows | "No prompt can be compared" / "{n} prompts have fewer than 4 valid answers in one of the windows." | none |
| engine agreement | fewer than 2 asked engines | "Agreement needs 2 or more engines" / "Turn on another engine or add it to the engine filter." | as above |
| country breakdown | fewer than 2 countries | "This project asks in one country" / "Compare markets by adding prompts for another country." | "Open Topics and prompts" via `drillHref('prompts')` |

## 4. Messages (namespace `aiOverview.engines`, additive, camelCase, no dashes, no "n't", curly quotes)

`aiOverview.engines` exists and is empty (WP-33 reserved it). Each task adds its block and never edits another
namespace; `pnpm exec vitest run src/i18n/messages.test.ts` runs after each. Haiku may draft, the implementer checks.

| Block | Keys (intent) | Task |
|---|---|---|
| `common` | `stale`, `partialPrevious`, `errorTitle` ("Could not load {name}"), `errorReason` ("The server returned an error. The rest of the page is unchanged."), `retry`, `metaPrompts`, `metaAnswers`, `brandedExcluded`, `brandedOnly`, `brandedIncluded`, `avg` ("avg of {count}"), `unknownEngine`, `viewRuns`, `toEngines`, `askAdmin` | T0 |
| `trend` | title per metric, `series`, `summary*`, `cellText`, `pooledTo`, `partialWeek`, `footnote*`, empty sentences | T1 |
| `byEngine` | title, column headers, `ownCitation*`, `avgLine`, `footnote`, `summary` | T1 |
| `outcomeMix`, `funnel`, `coverage` | titles, segment and step names, legend words, `footnote`, `summary`, empty sentences | T2 |
| `changeSummary` | one message per fact kind, `more`, `howWritten`, `rules*`, `tableHeaders` | T3 |
| `movers`, `comparison`, `waterfall` | titles, headers, bar names, tips, `summary`, empty sentences | T4 |
| `agreement`, `country` | titles, step names ("Named by {n} of {total} engines"), `summary`, empty sentences | T5 |

## 5. Checks used by every task

- TARGET: `infra/dev/heavy --lane medium --label wp34-tN-test -- bash -c 'cd apps/web && pnpm exec vitest run <paths> --maxWorkers=2'`
- LINT, TYPES, FORMAT in the same lane, from `apps/web`: `pnpm exec eslint <touched files>`, `pnpm typecheck`, `pnpm format:check` (whole package is cheap enough; run full `pnpm lint` at T6)
- MESSAGES (any task that edits `messages/en.json`): TARGET on `src/i18n/messages.test.ts`
- BROWSER (every task that draws something): headless Playwright Chromium (the built-in pane cannot register the MSW worker), sign in as in `e2e/support.ts`; dev server reuse per the dev server policy, else `NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p <free port>`, never kill a process on a port, delete the `AGENTS.md` and `CLAUDE.md` that `next dev` writes in `apps/web`. Pages: `/digibranders/fynix/ai` (2 engines on, 24 prompts, 2 countries), `/digibranders/eventus-security/ai` (dev seed, 92 days), `/digibranders/cleanstart/ai` (engines off: no grid). To see a card that is not in the built-in layout: Customize, Add card, pick it (the layout holds 12 cards at most: Hide others first). Check at 390, 768, 1024 and 1280 px, light and dark (`localStorage 'idraft.theme'`), Default and Compact density (Preferences): overflow, wrapped controls, contrast, focus rings, the Table toggle, the keyboard path, and that card tops do not move between loading and loaded.
- Never plain `pnpm test`, `pnpm build` or `pnpm e2e` before T6; those go through the heavy lane at T6.
- Every implementer is a fresh Sonnet subagent: tests first and seen red, file tools only (no heredocs, `sed`, scripts), one task. Then a fresh Sonnet reviewer reads the task, this plan and the diff, runs the task's TARGET, breaks every guard of the task on purpose (the named test must fail), and returns PASS or a numbered fix list. Commit `WP-34: <task title>` naming only this package's files (no attribution lines, no dashes).

House rules for every file: Tailwind v4 token and type utilities only (no arbitrary px, rem or palette classes, no hex); `@/lib/format` for every number and date (`formatPercent`, `formatPointsDelta`, `formatInteger`, `formatSampleCount`, `formatInterval`, `formatChartDate`, `formatBusinessDate`, `formatDateRange`, `formatTableDateTime`); every word from `messages/en.json` (`i18next/no-literal-string` covers `src/features/**`); a feature imports app components, ui, lib, providers and its own feature, never `design-system` or another feature; no em-dash or en-dash anywhere including tests and comments; every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; one denominator per number (R12); no chart animation; no gradients.

## 6. Tasks

Order: T0, then T1 to T5 one after another (T3 before T4: `prompt-pairs.ts`), then T6. T2 and T1 touch disjoint files
and could run together if the coordinator allows two implementers after T0.

### T0: shared helpers (small, needed by all twelve cards)

Why: every card needs the same five things (the read and its phase, the frame state props, the meta line, the skeleton
height, the engine role), and the reviewer would otherwise compare twelve variants. Nothing here draws a chart.

Files (new): `engine-role.ts`, `card-phase.ts`, `use-card-data.ts`, `use-frame-state.ts`, `card-meta.ts`, `card-skeleton.tsx`,
`use-card-seams.ts`, `use-card-density.ts`, `engines-fixtures.ts`, tests beside each; modify `messages/en.json`
(`aiOverview.engines.common`). Before starting: `git fetch origin && git rebase origin/develop`; `grep` for
`drillHref` and `useExportBlock` in `features/ai-overview` (F5) and record which case holds in the commit message.

Tests first:
- `engine-role.test.ts`: `ChatGPT is the brand role, Gemini palette 2, AI Mode palette 3, any other engine is other` (copy of `engineRole`; also imports the original from `features/prompts/history-model` and asserts equal for the three codes: parity guard), `engineChartColor gives chart-1, chart-2, chart-3`, `engineLabel reads the catalog and never the code`.
- `card-phase.test.ts` (pure): `error with no data is error`, `a failed previous read on a card that needs it is error`, `a failed previous read on a card that does not need it is ready with partial`, `idle current read is empty`, `any loading required read is loading`, `unsettled periods are refetching, never ready` (guards the mixed scope change), `ready without content is empty`, `stale comes from the required reads only`.
- `use-card-data.test.tsx` (MSW, `cardInOverview` world and `renderHook` with the provider): `asked lists the enabled engines inside the scope choice in catalog order` (Fynix: ChatGPT, Gemini), `current and previous are two summary requests and a card that needs no previous makes one`, `the previous read is dropped while the two reads are not paired`, `aggregates equal the strip's figures for the same scope (R12 parity against engineRates on the same fixture)`, `a failed summary gives phase error with the error id and retry reads again`, `a failed refetch keeps the data and sets stale`.
- `use-frame-state.test.tsx`: `loading and refetching pass through`, `empty carries title, reason and action`, `error carries Retry, the error id words and retrying while the read runs`, `stale and partial become notices with the words of aiOverview.engines.common`.
- `card-meta.test.ts`: `meta is window, prompts, answers and the branded choice`, `branded excluded says branded prompts are left out`, `a prompt weighted figure says each prompt counts once`, `no string contains a dash`.
- `card-skeleton.test.tsx`: `the skeleton block has the height class of the frame it stands for, for 140, 180, 240 and 280` (renders `ChartFrame status="loading"` for each and compares the `h-*` of the skeleton block).
- `use-card-seams.test.tsx`: `useCardDrill returns a route carrying the scope when drillHref exists and null for a destination that is not live`, `useCardExport registers a block while mounted and removes it on unmount` (both skipped with an explicit `it.skip` naming F5 only if the helpers are absent after the rebase).
- `engines-fixtures.test.ts`: `promptRow(k, n) builds a cell whose value is k over n and null for n of 0`, `summaryOf builds a PromptsSummary the aggregates accept`. Also `world facts` in `use-card-data.test.tsx`: read and pin what the later tests rely on, from the mock itself: how many engines Fynix has on (the page test says 2), its prompts per country (the fixture has 23 in DE and the Hindi prompt in IN) and how many valid answers each engine has on the IN prompt, and that Eventus seeded covers 92 days. If a fact differs from this plan, fix the later task's test, not the world.

Implementation: `use-card-data.ts` exports `useCardData({ previous: 'none' | 'optional' | 'required', include?, sources? })`
returning `{ scope, project, workspaceSlug, asked, engines, current, previous, comparing, aggregates, sources, phase, stale,
partialPrevious, errorId, retry, canManageEngines, canViewRuns }`. It calls `useOverviewPeriods` (or `useOverviewSummary`
when `previous: 'none'`), `useOverviewEngines`, optionally `useOverviewSources`, then `buildAggregates` in a `useMemo`
with `previous` only while `periods.paired`. `use-frame-state.ts` returns the part of `ChartFrame` props that is common:
`{ status, empty?, error?, notice? }`. `card-skeleton.tsx` is `skeletonOf(height)` returning a component (panel with a title
line and a block of the frame's height, as `cards/pending-skeleton.tsx`). `use-card-seams.ts` wraps WP-33's helpers (F5); in
the fallback case it returns `() => null` and a no-op with a `// shortcut: wired in T6 when WP-33's drill links and export
registry are on develop` note. `use-card-density.ts` reads `usePreferences(userId)` (the user id the way
`features/session/apply-preferences.tsx` gets it) and returns `'default' | 'compact'`.

A11y: none (no UI). Rows: process. Browser: none. Commit `WP-34: shared card helpers`.

### T1: rates by engine over time, mention trend, AI by engine (rows CH-01, WB-OV-05, WB-OV-06)

Lease Q3 first: edit `features/ai-overview/ai-overview-screen.test.tsx` lines 81 to 102 and the pending count at 274 so
the count of pending cards is the built-in cards that no family registers (`Object.keys` of the union of family maps
against `SCREENS.ai_overview.builtin.cards`), not nine. The test fails the moment T1 registers a card unless this is done.

Files (new): `trend-model.ts`, `trend-frame.tsx`, `rate-trend-card.tsx`, `mention-trend-card.tsx`, `by-engine-model.ts`,
`by-engine-card.tsx`, tests beside each; modify `index.ts` (three entries with `skeletonOf(280)`, `skeletonOf(180)`,
`skeletonOf(180)`), `messages/en.json` (`trend`, `byEngine`).

Tests first:
- `trend-model.test.ts`: `a point is the mean of the prompts' own rates with k and n summed from the same cells` (equals `engineRates` mention of the one-week fixture: R12), `a share of voice point is numerator over denominator with no band and no k`, `a point with fewer than 4 answers is thin with no band`, `a week without answers is a gap, never 0`, `every point of a prompt row series says it is pooled over its weeks to its Monday` (R7), `a point of summary.total with is_pooled false is the week's own and says nothing about pooling`, `the previous series aligns on the week index and is values only`, `the first and last weeks are partial when the window cuts them` (from `scope.range`), `the summary sentence uses the aggregates' window figures: rate, count, change in points, within normal variation or detectable` (parity with the strip), `an engine that is not asked has no panel`.
- `trend-frame.test.tsx` (echart mocked, `renderWithProviders`): `one panel per asked engine in catalog order`, `the Series menu switches the metric of every panel and does not change the saved option`, `the legend toggles a panel and the last one cannot be hidden` (the part's announcement), `the previous window is dashed only when compare is on and paired`, `refetching keeps the panels`.
- `rate-trend-card.test.tsx` (`cardInOverview`, Fynix): `shows ChatGPT and Gemini and no AI Mode (off)`, `Table view lists weeks with value, k of n and interval per engine and equals the tooltip words`, `a loading card keeps its height`, `an error shows Retry and the error id and Retry reads again`, `stale shows the notice and keeps the panels`, `fewer than 2 weeks shows the empty sentence with the next run`, `meta names the window, prompts and branded choice`, `axe finds no violation`.
- `mention-trend-card.test.tsx`: `option engine picks the panel (default ChatGPT)`, `an engine off in the project says so and offers Settings > Engines to a member who may`, `an engine outside the page filter says so`, `one panel at 180 px`.
- `by-engine-model.test.ts`: `a row per asked engine with mention, citation and share of voice figures, counts and prompts`, `the equal-weight line averages the engines that have a value, names them, and exists from 2 values` (R3), `a delta is detectable only through isDetectableChange of the aggregates`, `own citation comes from the sources read and is n/a while that read is absent`, `an engine outside the filter has no row`.
- `by-engine-card.test.tsx`: `rows in engine order with logo and name`, `the footnote reads "avg of 2" with both engine names`, `no Recommendation column`, `a thin cell says "3 answers" and has no percent`, `the Table view adds k, n, prompts and interval columns and the CSV matches`, `the numbers equal the strip's for the same scope (R12)`, `a failed previous read shows the partial notice and n/a deltas`, `axe`.

Implementation: `trend-model.ts` has `projectWeeks(summary, code, metric)` (per F2: sums the prompts' cells per week, prefers
`summary.total` series when present), `trendPanels(...)` building `SmallMultiplePanel` (`points` of `RateBandPoint` with
`tip` from `rateTipText` plus the pooled words, `previous`, `cellText`), and `trendSummary(...)`. `trend-frame.tsx` holds the
viewer's metric state and `controls`, and builds `SmallMultiples` props (`height`, `variant: 'panel'`, `menu: { fileName }`,
`categories` from `formatChartDate`, `titles` "Week of Oct 20, 2026"). `by-engine-card.tsx` uses `ChartFrame kind="html"`
with a `PlainTable` (columns: Engine, Mention, Citation, Share of voice, Own citation; each cell is value, `SampleCount`
and `DeltaCell` with `test="interim"`), `footnote` for the average line, and `table` for the long form.

A11y: `role="img"` panels are the part's; each panel's latest value is its `aria-describedby`; the table has a caption.
Rows: CH-01, WB-OV-05, WB-OV-06. Browser: Fynix and Eventus at four widths, both themes, both densities, the Series menu,
compare off and on, Table toggle, an engine filter of one. Commit `WP-34: rates by engine, mention trend and AI by engine`.

### T2: named and cited, answer funnel, sample coverage (rows CH-03, CH-36; coverage has no row)

Files (new): `outcome-model.ts`, `outcome-mix-card.tsx`, `funnel-model.ts`, `answer-funnel-card.tsx`, `coverage-model.ts`,
`sample-coverage-card.tsx`, tests beside each; modify `index.ts`, `messages/en.json` (`outcomeMix`, `funnel`, `coverage`).

Tests first:
- `outcome-model.test.ts`: `the four shares of an engine add up to 1 over the prompts with a valid answer` (guard on the prompt weighting), `named and cited equals aggregates mentionedAndCited for the same scope` (R12), `legend counts are pooled answers: 270 of 1,296`, `fewer than 4 valid answers is thin and has no shares`, `no answer is none with no bar`, `segment order is fixed: named and cited, named only, cited only, neither`.
- `outcome-mix-card.test.tsx`: `one row per asked engine with logo and the denominator "n valid answers, p prompts"`, `no segment uses chart-1` (reads the `color` of every `ShareSegment`), `the legend table is the Table view and the CSV carries k of n`, `segment links are absent while DRILL_SUPPORT.outcome is false` (guards F6), `Patterns toggle is offered`, `states: loading height, empty for a window with no valid answers, error with Retry, stale`, `axe`.
- `funnel-model.test.ts`: `steps are answers, valid, named, named and cited per engine, each a subset of the step before` (fails when a count exceeds its parent), `a share is the count over the step before: 612 of 1,800 valid answers`, `the share under a step with fewer than 4 answers is thin`, `not valid answers are shown as collection loss and never as a miss` (R6), `the footnote says the funnel pools answers while the strip is prompt weighted`.
- `answer-funnel-card.test.tsx`: `groups per engine with own steps in chart-1`, `Table view equals the accessible text`, `a shared scale across engines`, `states`, `axe`.
- `coverage-model.test.ts`: `per engine the prompts with 4 or more, 1 to 3, and no valid answer add up to the prompts in scope`, `prompts without a topic are counted from topic_term_ids`, `branded prompts left out is the second read minus the first and is n/a, not 0, while the second read is absent or failed`, `with branded included or only the branded row says so and reads nothing`.
- `sample-coverage-card.test.tsx`: `distribution BarList with one group per engine`, `colours are the scale of the rows (rank-band or seq), none is chart-1`, `the second read is requested once and shares the key with an equal read`, `states`, `axe`.

Implementation notes: outcome shares reuse the `buildAggregates` trick (map `outcomes.<part>` to a `mentioned` cell, call
`engineRates`); do not copy its code, export nothing from the shell, write a six line local helper and a parity test.
`useBrandedPrompts()` in the coverage card reads `overviewSummaryQuery(project, { scope: { ...scope, branded: 'included' }, enabledEngines })`
through `useQuery` with `keepPreviousData`, `enabled` only when `scope.branded === 'excluded'`; if the reviewer finds the
second read heavy, the row is cut and recorded (default stays).

A11y: bars and steps are `BarList` and `StepBars` rows read once from `accessibleText`; segments are not focusable.
Rows: CH-03, CH-36. Browser: Fynix, Eventus at four widths, a one-engine filter, branded included, both themes and densities.
Commit `WP-34: outcome mix, answer funnel and sample coverage`.

### T3: what changed, the fact model (row CH-37)

Files (new): `prompt-pairs.ts` (shared with T4), `facts-model.ts`, `fact-sentences.tsx`, `use-new-sources.ts`,
`change-summary-card.tsx`, tests beside each; modify `index.ts`, `messages/en.json` (`changeSummary`).

Tests first:
- `prompt-pairs.test.ts`: `prompts are joined by prompt_id; a prompt in one window only is listed as added or left`, `per engine counts of both windows`, `a window pair with different prompt sets keeps both sets`, `rows of an engine not asked are absent`.
- `facts-model.test.ts` (the pure fact model, one `it.each` per template): `collection first and worst engine first`, `engine change only when detectable, one fact per such engine`, `no detectable change gives one within-variation fact`, `no previous data gives the noPrevious fact and nothing about change`, `gained and lost count prompts with 4 or more valid answers on the engine in both windows and report the left out`, `new sources only when the read answered, the total is above 0 and the previous window has answers`, `the order is fixed whatever the data`, `the Facts option cuts to 3 or 5 and reports how many more`, `a fact never carries a causal word or a judgement adjective` (scans every message value of `aiOverview.engines.changeSummary` for the list in 3.3), `the same input gives the same facts` (determinism), `share of voice leader is never written` (D7), `every number of a fact is also in its params with its denominator`.
- `fact-sentences.test.tsx`: `every fact kind renders its sentence with counts`, `a number links through useCardDrill and is plain text when null`, `How this is written opens a popover with the rules and closes with Escape`.
- `use-new-sources.test.tsx`: `asks kind=new with limit 1 and the scope's window, engines, country, topic and branded`, `does not run for branded only` (the endpoint takes `include_branded` only), `a failed read gives no fact and no card error` (optional read).
- `change-summary-card.test.tsx`: `reads as plain text in reading order, one list item per fact`, `the Table view lists every fact with its numbers, including those cut by the option`, `no previous data`, `states`, `Table CSV`, `axe`.

Implementation: `buildFacts` takes `{ aggregates, pairs, newSources, scope-derived words (window days) }` and returns facts as data;
`fact-sentences.tsx` maps kind to a message and links. `change-summary-card.tsx` is a `ChartFrame kind="html"` height 140
whose body is an ordered list; `summary` is the first fact.

A11y: plain text, links listed in reading order; the popover is a labelled button. Rows: CH-37. Browser: Fynix, Eventus,
compare on and off, a window with no previous answers (a 28 day window at the start of the data), both themes.
Commit `WP-34: what changed fact model and card`.

### T4: prompt movers, period comparison, what moved the rate (rows CH-09, CH-10, CH-13)

Lease Q2 (kind `prompt` in `drilldown/drill-links.ts`) is wanted here; without it the movers rows are plain text.

Files (new): `movers-model.ts`, `prompt-movers-card.tsx`, `comparison-model.ts`, `period-comparison-card.tsx`,
`waterfall-model.ts`, `waterfall-body.tsx`, `change-waterfall-card.tsx`, tests beside each; modify `index.ts`,
`messages/en.json` (`movers`, `comparison`, `waterfall`).

Tests first:
- `movers-model.test.ts`: `change in points per prompt and engine from the two windows' counts`, `the interval is differenceInterval and detectable is isDetectableChange` (parity), `prompts with fewer than 4 valid answers in either window are left out and counted`, `ordering is by absolute size and ties by text`, `Direction up and down filter after ordering and Rows 5 and 8 cap`, `a prompt that exists in one window only is not a mover`, `no previous answers gives the empty state key`.
- `prompt-movers-card.test.tsx`: `diverging rows with a whisker, neutral unless detectable`, `colour comes from formatMetricDelta tones only` (a non detectable row has the neutral class), `the tooltip words: 25% to 75% (+50 pts), 2 of 8 then 6 of 8 answers`, `the footnote counts the prompts left out and says unpaired, pooled counts`, `rows link to the prompt when drill gives a route`, `the engine option picks the engine`, `Table view and CSV`, `states`, `axe`.
- `comparison-model.test.ts`: `a row per asked engine with both rates, counts and the change`, `mention and citation have the interval of the difference and share of voice has none` (D5), `an engine under 4 answers in either window says "Too few answers to compare"`, `the metric option picks the cell`.
- `period-comparison-card.test.tsx`: `dumbbell rows, previous hollow and current filled in the engine colour`, `share of voice rows are words with the numbers and "no interval yet"`, `domain covers every interval (changeDomain)`, `states`, `axe`.
- `waterfall-model.test.ts`: `start plus rose plus fell plus too few plus set changed equals end within 1e-9` (fixtures and 200 generated prompt sets), `a prompt added or left goes to the set changed remainder`, `prompts under 4 answers in either window go only into too few answers`, `an unknown start or end rate is no waterfall`, `bars carry prompt counts ("31 prompts up")`.
- `change-waterfall-card.test.tsx`: `six rows in order with signed labels`, `colour only when the total change is detectable`, `the tooltip names the top prompt of each part`, `Table view`, `states`, `axe`.

Implementation: `waterfall-body.tsx` is a local HTML part (list of rows, each a track with a bar placed by percent
`left` and `width`, as `interval-bar.tsx` does; inline style percent only); it holds no string. Record in the As built note that
it is local and may move to `components/app/chart` later.

A11y: rows are a list read once from accessible text; the sentence above the list is `summary`. Rows: CH-09, CH-10, CH-13.
Browser: Eventus (92 days, enough prompts), Fynix, compare off, direction filter, both themes and densities.
Commit `WP-34: prompt movers, period comparison and waterfall`.

### T5: engine agreement, by country (rows CH-18, CH-23)

Files (new): `agreement-model.ts`, `engine-agreement-card.tsx`, `country-model.ts`, `use-country-reads.ts`,
`country-breakdown-card.tsx`, tests beside each; modify `index.ts`, `messages/en.json` (`agreement`, `country`).

Tests first:
- `agreement-model.test.ts`: `a prompt is named by an engine when one valid answer names the brand and the engine has 4 or more valid answers on it`, `prompts with fewer than 4 valid answers on any asked engine are left out and counted, never read as not named` (D6, R6), `steps are 0 to N for N asked engines and the counts add up to the compared prompts`, `fewer than 2 asked engines is the empty state key`, `scale colours are seq-3 to seq-6 in order`.
- `engine-agreement-card.test.tsx`: `a distribution BarList with "Named by 2 of 3 engines: 64 prompts"`, `a one engine page says why`, `Table view`, `states`, `axe`.
- `country-model.test.ts`: `groups are the countries of the prompts by prompt count, at most 8, the rest counted in the footnote`, `a group is a TopicEnginePanel row set per asked engine`, `thin and none rows are never 0`, `fewer than 2 countries is empty`, `the metric option picks mention, citation or share of voice`, `the scope's country filter is ignored by design and the meta says so`.
- `use-country-reads.test.tsx` (MSW): `one summary request per country with filter[country_iso] and the rest of the scope`, `a failed country read leaves the other groups and gives that group Retry`, `countries come from usePromptCountries (Fynix: DE and IN)`, `refetching keeps every group`.
- `country-breakdown-card.test.tsx`: `Fynix shows Germany with its rows and India (one prompt) as too few answers or no answer, never as 0` (the exact state is what the T0 world facts found), `the empty state with one country`, `Table view and CSV`, `states`, `axe`.

Implementation: `TopicEnginePanel` per country (caption the country name, from `Intl.DisplayNames` through `@/lib/format` if a
helper exists, else ISO code); one shared scale (the part takes `max` 1 as the topic drawer's does).

A11y: each group is a labelled list; countries are headings of level 3 inside the card. Rows: CH-18, CH-23. Browser: Fynix
(DE and IN) at four widths, both themes, the page's country filter set, Eventus. Commit `WP-34: engine agreement and by country`.

### T6: As built notes, e2e, rebase, final checks, push

Files: `apps/web/e2e/flows/ai-overview-engines.spec.ts`, `apps/web/e2e/support/ai-overview-engines.ts` (new);
append-only As built blocks in `docs/20-frontend-specification.md` after the last As built note of section 4.6 and in
`docs/design-system/25-component-inventory.md` beside the notes of `StepBars`, `BarList` and `IntervalBar` (section 10); wire
`use-card-seams.ts` to WP-33's helpers if T0 found them absent (F5) and add links and export blocks to the cards.

Tests first (e2e, production build through the heavy lane, against the mock):
1. `Fynix: the built-in layout shows What changed, Rates by engine and Named and cited as real cards` (no pending sentence for the three).
2. `every card of the family can be added in Customize and renders at 1280 px` (Hide to make room: 12 cards at most).
3. `the Table toggle of each card shows k of n answers`.
4. `compare off removes the dashed lines and the changes; compare on shows them`.
5. `a failed summary shows each card's error with Retry and Retry works` (fault cookie of the summary mock).
6. `Cleanstart shows no cards` and `a country filter of IN shows thin states, not zeros`.
7. `axe: no serious or critical violation at 390, 768, 1024 and 1280 px, light and dark, Default and Compact` for the cards of this family.
8. `no card moves between loading and loaded` (top offsets equal).

Work: the final review (a second fresh Sonnet reviewer opens `/ai` with all twelve cards at the four widths in both
themes and densities and reads the whole diff against the brief's acceptance criteria and the 11 rows); `git fetch origin &&
git rebase origin/develop`, resolve `en.json` by keeping both sides then the messages test; As built notes (what each card
reads, the deviations D1 to D14, F2 and F12, the seams, the local waterfall part); the heavy lane:
`infra/dev/heavy --label wp34-final -- bash -c 'cd apps/web && pnpm test --maxWorkers=3 && pnpm build'`, `pnpm e2e` for
`ai-overview-engines.spec.ts`, `ai-overview.spec.ts` (if on develop) and `ai-layouts.spec.ts`, then `pnpm lint`,
`pnpm typecheck`, `pnpm format:check` in the medium lane. Push `git push origin HEAD:develop` (fast-forward only), report `merged`.
Commit `WP-34: e2e, As built notes and final checks`. Rows: all eleven confirmed.

## 7. Rows

| Row | Task | Proof |
|---|---|---|
| CH-01, WB-OV-05 | T1 | `trend-model.test.ts`, `rate-trend-card.test.tsx`, `mention-trend-card.test.tsx`, e2e 2 |
| WB-OV-06 | T1 | `by-engine-model.test.ts`, `by-engine-card.test.tsx` (R12 parity) |
| CH-03 | T2 | `outcome-model.test.ts`, `outcome-mix-card.test.tsx` |
| CH-36 | T2 | `funnel-model.test.ts`, `answer-funnel-card.test.tsx` |
| CH-37 | T3 | `facts-model.test.ts` (the rules), `fact-sentences.test.tsx`, `change-summary-card.test.tsx`, e2e 1 |
| CH-09, CH-10, CH-13 | T4 | model and card tests, the additivity test |
| CH-18, CH-23 | T5 | model, read and card tests |
| process | T0, T6 | helper tests, e2e, As built notes |

Not rows, built anyway: `ai.sample_coverage` (T2), `ai.mention_trend` (T1, WB-OV-05).

## 8. Decisions taken by default (reverse on the coordinator's word)

1. D1: no task for "the strip delta items" (1.4).
2. D2: `ai.by_engine` has no Recommendation column: nothing classifies a recommendation yet (c8 C-15, suppressed `not_classified`) and an all `n/a` column is noise. The catalog description keeps its words until WP-31 or WP-58 changes them.
3. D3: no per card Window option (D-13). Every card follows the page window and compare.
4. D4 (D-04): `POOL_BELOW_PROMPTS = 10` and `POOL_WEEKS = 4` are applied by the API; the web shows `is_pooled` and `pool`. Until the mock serves `include=total`, a project weekly point built from prompt rows is always a 4 week pool and says so (F2).
5. D5: share of voice has no interval, so the CH-10 share of voice rows are words with numbers and no dumbbell, and CH-01 share of voice has no band.
6. D6: CH-18 counts only prompts with 4 or more valid answers on every asked engine; the spec would count a thin engine as "not named", which is unknown read as no (R6). The excluded prompts are counted in the footnote.
7. D7: the CH-37 share of voice leader fact and "lost sources" are not written (no interval, no data); the other four facts are.
8. D8: the waterfall is an HTML local part, not ECharts (`categoryChartOption` has no transparent base series); noted for promotion later.
9. D9: `ai.country_breakdown` ignores the page's country filter (its job is to split by country) and says so in its meta; fewer than 2 countries is its own empty state (the catalog cannot gate it, WP-33 decision 9). Fynix has DE and IN.
10. D10: the Series menu on the trend card is a viewer choice kept in component state; the saved default is the Metric option.
11. D11: HTML cards have CSV and no PNG (F12); no per card Copy link (the page has one).
12. D12: no single key shortcuts; no `useShortcut`.
13. D13: engines are the catalog three in catalog order; AI Overview as an engine waits for slice 2 (WP-33 follow-up F7).
14. D14: cards read in customize mode like in view mode (F8); no `live` gating of the shell's hooks.
15. D15: density for BarList and StepBars comes from the person's preference (`use-card-density.ts`), not from the URL (tables only).

## 9. Risks

| # | Risk | Answer |
|---|---|---|
| R1 | Client aggregation of 150 prompts by 3 engines by two windows per card slows a scope change | Every model is one pass over the rows, `useMemo` on the reads; `useCardData` shares one aggregate per card; measured on Eventus in T1 and T4; the swap to `total` and metric routes is the same seam |
| R2 | The summary request count grows (series variant, per country reads, branded count, new sources) | At most: summary, previous summary, series variant of both, sources, new sources, one per country, one branded count; e2e asserts at most 14 requests on the built-in layout page plus one family card |
| R3 | `en.json` conflicts with other packages on rebase | Own sub-namespace only; keep both sides; the messages test |
| R4 | WP-33 helpers late (F5) | T0 seam and T6 wiring; cards are correct without links |
| R5 | A reviewer cannot tell a guard was removed | Every test name states its guard; the reviewer breaks each on purpose |
| R6 | Local waterfall part grows into a second chart library | Capped at one body file, no string, tested through the card; promotion is a follow-up |
| R7 | Real API and mock differ (the real API serves `previous`, `total`, `by_country`) | Cards use none; once the mock serves them a follow-up swaps reads without changing models |

## 10. Open questions for the coordinator

1. **Q1 (T0, T6): WP-33 helpers.** `drilldown/drill-links.ts` and `export/export-registry.tsx` are on `ai/wp-33-overview-shell` (`7c251639`), not on develop. Ask WP-33 to push them before WP-34 T6 (preferably T0). Fallback is in the plan (cards ship without links and export blocks, T6 wires them).
2. **Q2 (T4): lease on `features/ai-overview/drilldown/drill-links.ts` (WP-33)**: add `DrillKind` `prompt` with `inspect=prompt:<promptId>` (the Prompts page's inspector, `lib/inspector/placement.ts` already has the `prompt` type) and `extra.promptId`. Without it the movers rows are plain text.
3. **Q3 (T1): lease on `features/ai-overview/ai-overview-screen.test.tsx` (WP-33), lines 81 to 102 and 274**: make the pending count come from the registry. The same edit is needed by WP-35 to WP-37; whoever merges first does it.
4. **Q4 (optional, later): lease on `mocks/handlers/prompt-answers.ts` and `mocks/prompt-summary.ts` (WP-20, WP-19 branch)**: answer `include=total` with series and `group_by=country`. Only to swap F2 and the country reads to single reads; nothing in this plan needs it.
5. **Q5 (optional): a `subscribed` option on the shell's hooks** (`data/use-overview-reads.ts`, WP-33) so a card in customize mode costs no request (F8). Default: not asked.
6. **Q6: the strip delta items.** Confirm D1 or say what else the phrase means.
7. **Q7: Recommendation column (D2).** Confirm it is left out of `ai.by_engine`.

## 11. Follow-ups

- F1: swap the reads to `total`, `compare`, `by_country` and the WP-32 metric routes through `use-card-data.ts` when the mock serves them.
- F2: share of voice intervals (WP-58) give CH-10 dumbbells and CH-01 bands for share of voice; the leader fact of CH-37.
- F3: PNG for HTML cards when an HTML rasteriser exists; promote the waterfall body to `components/app/chart`.
- F4: entities per week (N3) and annotations (N9) draw boundaries on CH-01.
- F5: outcome and opportunity links when WP-17 reads `outcome=` and `opportunity=` (`DRILL_SUPPORT`).
- F6: lost sources fact for CH-37 once two following windows exist.
- F7: the Recommendation column when recommendation is classified (S2).
