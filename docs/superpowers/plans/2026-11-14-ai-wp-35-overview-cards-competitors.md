# WP-35: Overview cards of the competitors family: detailed task plan

Package brief: `docs/ai-visibility/work-packages/WP-35-overview-cards-competitors.md`. Branch `ai/wp-35-cards-competitors`
in `.claude/worktrees/wp-35`. Web only (`apps/web`). Written 2026-11-14 by the planner; read the code at the
paths below before relying on a name, because WP-33 T7 to T13 and WP-34 and WP-36 land on develop while this runs.

## 1. What is built, what is not (verified in the worktree at 9216e710)

| Fact | Where | Consequence |
|---|---|---|
| `COMPETITOR_CARDS = {}` is mine; `cards/registry.ts` spreads it over a pending placeholder per active key and throws for a key that is not an active `ai_overview` type | `features/ai-overview/cards/competitors/index.ts`, `cards/registry.ts` | A key I list must be `status: 'active'` with `ai_overview` in `screens` |
| Active `ai_overview` types of the family: `ai.share_of_voice`, `ai.lost_to_competitor`, `ai.competitor_trend`, `ai.sov_over_time`, `ai.sov_rank`, `ai.co_mentions`, `ai.competitor_table`, `ai.opportunities` (all `aiCard(...)` in `lib/layouts/catalog.ts`) | catalog.ts lines 203 to 280 and 555 | 8 cards. Options: engine on 6 of them, `rows` (5|10, opportunities 4|8), `competitors` (3|5), `metric` (mention|share_of_voice) |
| `competitors.summary` and `competitors.share_of_voice` are `screens: ['overview']` (the project Overview), group `cross`, channels EITHER. They are not `ai_overview` types | catalog.ts lines 705 and 713 | They cannot go in `COMPETITOR_CARDS` (the registry throws). They belong to the project Overview, WP-40 (competitor table). See decision D-1 for how WB-OV-09 closes |
| The summary type already has `entities`, per engine `entities[]` (cells `mentioned`, `share_of_voice`, `previous`), `series[].entities[]` (N3), `total`, `co_mentions` (N14), `compare_window`, `previous_answers`, `entity_config_versions`, and the `filter[opportunity]` parameter | `lib/api/schema.ts` `PromptsSummary`, `EngineSummary`, `EntityCells`, `WeekCells`, `EngineCoMentions` | The real route has everything. No `schema.ts` change |
| `SummaryOptions.include` is `('series' | 'entities')[]` only | `features/ai-overview/data/overview-queries.ts` | `total` and `co_mentions` need a one line widening: lease L-A |
| The mock summary answers `series` and `entities` only. `include=total` and `include=co_mentions` are a `literal_error`; `compare` is ignored; weekly entity cells exist, `total` does not | `mocks/handlers/prompt-answers.ts` (`includeOf`, the `prompts-summary` handler), `mocks/prompt-summary.ts` | Weekly cards (CH-06, CH-19, CH-29) and CH-38 cannot be drawn against the mock without lease L-B |
| `mocks/handlers/competitors.ts` is an empty array (WP-39) and `ai/competitors` and `overview/competitors` are `501` until WP-32 pushes | `mocks/handlers/competitors.ts` | Cards read the summary through the Overview hooks; the routes replace module internals later (section 3.1) |
| `useOverviewPeriods(options)` reads the current window and, with compare on, the previous window as a second summary read with the same options; it returns `paired` and `settled` | `data/use-overview-reads.ts` | Deltas come from two reads of the same shape, so the mock needs no `compare` support |
| Not on develop yet: `drillHref`, `useExportBlock`, `RefetchBar` and `FreshnessIndicator` (WP-33 T7 to T13), the `ai-overview` e2e support file | grep of `src` | Re-check at the start of each card task. If `drillHref` exists, rows link with it; else rows are plain text (a link is never built by hand). If `useExportBlock` exists, a card with a Table view registers its block |
| The summary entity has `entity_id`, `name`, `role` only. `color_index` and `added_at` live on `GET {P}/entities` (`ProjectEntity`) | `schema.ts` `SummaryEntity`, `ProjectEntity` | The family reads `{P}/entities` itself (section 3.3). Fynix fixtures give own colour 1 and competitors 2 to 6 |
| Import boundary: a feature may import `lib`, `components`, `providers`, itself and `@/features/layouts` only | `eslint.config.mjs` policies 3 | The data module lives in `cards/competitors/`; WP-39's Competitors page cannot import it and will write its own reads |
| Parts exist: `ChartFrame` (`kind: 'html' | 'line' | 'bar'`), `ChartLegend`, `BarList` and `BarListTable` and `barListCsv`, `StackedShareBar`, `HeatmapGrid`, `StepBars`, `IntervalBar`, `SmallMultiples`, `SmallSampleMarker`, `use-rate-tip-words`, `heat-bins`, `PlainTable`, `Delta` and `DeltaCell`, `SampleCount`, `MetricInfo`, `EngineLogo`, `EngineBadge`, `EntitySwatch`, `SparklineCell` | `components/app/chart/*`, `components/app/metric/*`, `components/app/engine/*`, `components/app/table/plain-table.tsx`, `components/app/entity/entity-swatch.tsx`, `components/app/sparkline/*`; helpers `lib/charts/{boundaries,category-chart,rate-band-chart,rate-tip,small-sample,tooltip-row}.ts`, `lib/stats`, `lib/rates`, `lib/compare`, `lib/format` | No new shared part is needed. `OpportunityStatus` of DS 25 16.6 is not built anywhere; `ai.opportunities` uses `BarList` (D-6) |
| `rankAxis` of `lib/charts/rank-chart.ts` is for SERP depth: fixed guides at 3, 10, 20 and "Top 3" words | `lib/charts/rank-chart.ts` | CH-29 writes its own small `extendOption` (D-8) |
| `aiOverview.competitors` already exists in `messages/en.json` as `{}` | `messages/en.json` line 4360 on | Namespace is mine; no shared skeleton commit is needed beyond adding sub-objects |

## 2. Decisions and defaults taken

| # | Decision | Why |
|---|---|---|
| D-1 | WB-OV-08 (share of voice by entity BarList) closes with `ai.share_of_voice`. WB-OV-09 (competitors summary table, AI SOV per engine) closes with `ai.competitor_table`, the AI table of the `/ai` page. `competitors.summary` stays a `screens: ['overview']` card of the project Overview (WP-40). Optional task O1 (flagged, not default) adds `ai_overview` to its `screens` and registers a thin card that shows the same table plus a Search column of "Not available" | The registry cannot hold a non active key; changing `screens` needs `pnpm gen:layout-catalog` and the regenerated backend `catalog.json`, which needs a coordinator lease |
| D-2 | No SEO share of voice number anywhere in this package (follow-up F-26: not built, `seo` is declared and absent in c5). The model carries `SEO_SHARE = { available: false, reason: 'not_built' }`; only O1 renders it, as "Not available" with the reason in a tooltip. No placeholder number, no zero | R6, c5 "SEO half is not built" |
| D-3 | CH-05 and the "Lost to" rows of `ai.opportunities` use the CH-05 rule at prompt level: the competitor is named in at least one valid answer of the prompt on that engine, the engine's own Mentioned count for that prompt is 0, and the prompt has 4 or more valid answers. The server rule `filter[opportunity]=lost_to:<id>` (c2 C-6) is per answer and keeps more prompts, so a drill count can be larger than the card. The card says "named and you are not named in any answer" in its tooltip. When `ai/competitors` with `include=lost_prompts` is on develop, the module takes `lost_prompts_total` and `lost_prompts_with_min_answers` instead | Summary prompt rows carry cells, not per answer facts |
| D-4 | An engine is the card's option, not an in card switcher. The catalog makes these cards reusable per engine (`maxInstances` is the engine count), so a second selector would fight the options popover. The title row shows the engine mark and name. Engines are never pooled; the only average is the equal weight "Average of N engines" column of the table, labelled as such | catalog `PER_ENGINE`; R3 |
| D-5 | CH-06 (`ai.competitor_trend`) draws mention rate (entity `mentioned` cell, prompt weighted with `pooled.successes` of `pooled.trials`, Wilson interval in the tooltip), as inventory CH-06 and W-7 say. The catalog description says "share of voice". The catalog text is not changed (lease); the card title row says "Mention rate". Listed as open question Q-3. Competitors drawn: the `competitors` option (3 or 5) with the highest window mention rate, 4 or more answers, ties by name | Weekly SOV is CH-19 |
| D-6 | `ai.opportunities` is a `BarList` (comparison mode, neutral bars, no own row) of counts: Named, not cited; Cited, not named; Lost to `<competitor>`; No tracked brand named. Sorted by count, cut at the `rows` option (4 or 8), no score, no verdict words ("opportunity", "should", "because" are not used in rows). A prompt counts once per row across the engines in scope, by the server rules of c2 C-6 except Lost to (D-3) | WB-OV-08 style; DS 25 16.6 word rules |
| D-7 | CH-38 draws the full symmetric matrix of the top 8 tracked entities (you first, then by mention rate), not only the lower triangle: `HeatCell` has no blank state and an empty cell would read as unknown. Diagonal is the entity's answers named over the engine's valid answers, taken from `mentioned.pooled` (successes over trials). A pair absent from `pairs` is 0 of n, a real zero | `heatmap-grid.tsx` cell states |
| D-8 | CH-29 is a line chart on an inverted integer rank axis, written as the card's own `extendOption`. Ranks are of the weekly shares: the API's points as read when any point is pooled (C-11), else a client trailing four week pool of the unpooled points, clipped at the window start. Ties share the lower rank (1, 2, 2, 4). A week with fewer than 4 answers naming a tracked brand has no rank (a gap). Own plus the top 5 competitors by window share are drawn; the footnote says how many tracked brands are not drawn | Inventory CH-29: "pooled", "ties drawn as shared ranks" |
| D-9 | The tracked set boundary: `entity_config_versions.length > 1` is the only trigger. The boundary line is placed on the week that holds a competitor's `added_at` (from `{P}/entities`) when that date is inside the window. Without that read the footnote says the set changed and no line is drawn. Every SOV footnote names the set ("you and 5 competitors") and lists the added dates inside the window | R9, inventory 3.6 |
| D-10 | Colours: own is `chart-1`; a competitor takes `color_index` 2 to 6 from `{P}/entities`; with no index it takes the next free slot in name order; a seventh and later entity folds into "Other tracked" (`chart-other`) in CH-19 and is not drawn in CH-06 and CH-29 | DS 15 rule 12 |
| D-11 | Share of voice has no count of successes (numerator is a sum of shares). Rows show the percent and the denominator ("of 1,412 answers naming a tracked brand"); the count beside a competitor percent is its Mentioned count ("named in 466 of 1,800 answers", from `mentioned.pooled`). Deltas of share of voice are never coloured (no test); mention deltas are coloured only when `isDetectableChange` says so (interim unpaired test, `test="interim"`) | `lib/compare/change-model.ts` rules |
| D-12 | Four request shapes cover the family, each one request however many cards use it (shared query key): `prompt-rows` = `include: ['entities','total']`; `totals` = `include: ['entities','total'], rows: 'none'`; `pairs` = `include: ['co_mentions','entities','total'], rows: 'none'`; `weekly` = `include: ['entities','series','total'], rows: 'none'`. C-15 says the weekly and totals shapes are 12 to 16 KB; only `prompt-rows` is large and only lost-to and opportunities need it | c2 C-15 |
| D-13 | Heights: `ai.share_of_voice` 280 (frame `height` 280, list body), `ai.lost_to_competitor` 240, `ai.opportunities` 240, `ai.competitor_trend` 240, `ai.sov_over_time` 280, `ai.sov_rank` 240, `ai.co_mentions` 280, `ai.competitor_table` 280. Each skeleton is the panel of `pending-skeleton.tsx` at that body height | DS 15 `ChartHeight` is 140, 180, 240 or 280 |
| D-14 | Density: every table or grid in a card is `compact` (embedded rule, DS 04) | `h-row-compact` for embedded tables |

## 3. Design

### 3.1 The data seam of the family

One folder, `apps/web/src/features/ai-overview/cards/competitors/`, owns a client module that derives everything the eight
cards show from the summary read through the Overview hooks. The cards never touch `PromptsSummary` shapes; they call the
module's hooks and render its plain data. When `ai/competitors` and `overview/competitors` are real (WP-32), only
`data/use-competitor-reads.ts` and the `model/` functions change; the cards stay.

```text
cards/competitors/
  index.ts                      COMPETITOR_CARDS (T4, T5, T6 each add their lines)
  skeletons.tsx                 one skeleton per card at its final height (T3)
  model/                        pure, no React, own unit tests
    summary-fixtures.ts         typed builders of PromptsSummary for tests (T2)
    types.ts                    TrackedEntity, ShareFigure, MentionFigure, EntityCell, EngineEntityTotals, WeeklyPoint
    tracked-set.ts              trackedSetOf, trackedSetNote, boundariesOf, weekOf (Monday of a day in a zone)
    entity-totals.ts            entityTotals(summary, code, tracked): from `total`, else from prompt rows
    weekly-series.ts            weeklyShares, foldOthers, weeklyMention, rankSeries
    lost-to.ts                  lostToRows, opportunityRows
    co-mentions.ts              coMentionMatrix
    seo-share.ts                SEO_SHARE not available constant (D-2)
  data/
    tracked-set-query.ts        apiQuery of `{P}/entities` (color_index, added_at, role, removed_at)
    use-competitor-reads.ts     useCompetitorReads(shape), useTrackedSet()
  parts/
    card-engine.ts              useCardEngine(options): engine code, availability, reason
    frame-state.ts              mapReadToFrame(...): ChartFrame status, notice, error, empty
    tracked-footnote.tsx        the footnote of every SOV chart
    not-available.tsx           (O1 only)
  <card>-card.tsx and test      eight cards
```

`entityTotals` (the heart): for one window and one engine, per tracked entity the share of voice
(`numerator` over `denominator`, summed) and the Mentioned figure (`k` and `n` from `pooled.successes` and `pooled.trials`,
`value` from the cell, `prompts` from the cell's denominator). Source order: `summary.total.engines[engine].entities`
when `total` is present (the real server and the extended mock), else a sum over `summary.prompts[*].engines[engine].entities`
(`rows` all). With neither it returns `unread`, which is never zero. `rateState(answersNaming)` decides `ok` or
`insufficient` (fewer than 4). Previous window: the same function on the previous read; `null` when that engine has no
entry or no answer.

The tracked set note (`trackedSetOf(summary, entityRows)`) is one value: names and roles from `summary.entities`
(own first), `color_index` and `added_at` from the entities read, `changed` from `entity_config_versions.length > 1`,
`boundaries` (week label and "Zoho added" words inputs) and `addedInWindow` (dates for the footnote). It never invents a
date: no read, no date.

### 3.2 States every card shows (one mapping, `parts/frame-state.ts`)

| Situation | Frame | Words |
|---|---|---|
| Summary read loading | `loading` (skeleton at final height, from `ChartFrame`) | none |
| Read ready | `ready` | |
| Scope change refetch | `refetching` (data kept, the shell shows the RefetchBar) | |
| Read failed, no data | `error` with `onRetry` = `Read.refetch`, `errorId` | "Could not load share of voice" |
| Later read failed, data kept (`Read.stale`) | `ready` with `notice: { kind: 'stale' }` | "These are the last figures read" |
| Previous window failed or empty, current fine | `ready` with `notice: { kind: 'partial' }` and no deltas | "No comparison: the previous period could not be read" |
| Engine off or outside the engine filter | `empty` | "ChatGPT is not asked in this scope" and why (Settings > Engines with `canManageEngines`, else ask an admin) |
| Fewer than 4 answers name a tracked brand | `empty` | "Too few answers name a tracked brand (3)" |
| Only the own brand is tracked | `empty` | "No competitor is tracked" with a link to Settings > Entities |
| No valid answer in the window | `empty` | "No valid answers on ChatGPT in these 28 days" |
| Customize mode (`live` false) | queries `subscribed: live` and the card renders inside the grid's `inert` | |

Every percent shows its count (D-11); unknown is `n/a` through `EMPTY_VALUE`, never 0; colour only through `Delta`; no
em or en dash in any message; engines are never pooled silently.

### 3.3 Card by card (better than the Nuwtonic dashboard)

The Nuwtonic dashboard (`nuwtonic-dashboard.md`, `nuwtonic-vs-idraft-synthesis.md`) shows a donut of share of voice with
three different totals for one brand (15.6 %, 18.6 %, 14.6 %), a pressure score of hidden weights, "momentum" that is
minus the mention count on one day of data, bars sorted ascending under a title that says sorted by pressure, no engine
split, no window, no sample size, and no trend. Each card below answers one of those: one denominator printed, per engine,
a window, a count beside every percent, a real weekly trend, and a boundary when the tracked set changed.

| Card (key, default width) | Chart and parts | What it shows | States beyond 3.2 | Why honest |
|---|---|---|---|---|
| CH-02 `ai.share_of_voice` (half, third) | `ChartFrame kind="html"`, `BarList` comparison, own `chart-1`, `EngineLogo` in the title row, `Delta` per row, `BarListTable` for the Table view, `barListCsv` for the menu | Entities ranked by share of voice on one engine, value "33%", context "named in 466 of 1,800 answers", meta "of 1,412 answers naming a tracked brand, 28 days", own row always shown (top N plus own), "Show all N" | 3.2 | One formula (per answer, 1 over the tracked brands named), one denominator, tracked set footnote, thin gives a sentence |
| CH-05 `ai.lost_to_competitor` (third, half) | `BarList` comparison, neutral bars, value "23 prompts", context "of 212 prompts with 4 or more answers" | One row per competitor: prompts where it is named and you are not (D-3); footnote "38 prompts have too few answers" | no competitor tracked; every row 0 shows "No prompt is lost to a competitor on ChatGPT" (a real zero of a known total) | The "of 212" is printed; prompts with too few answers are counted, not hidden |
| opportunities `ai.opportunities` (half, third) | `BarList` comparison, neutral | Named, not cited; Cited, not named; Lost to X; No tracked brand named, each "N prompts" of M prompts in scope, by count | prompt rows read failed shows the card error | Counts by documented conditions, no score |
| CH-06 `ai.competitor_trend` (half, two thirds, full) | `ChartFrame kind="line"`, `categoryChartOption` through `rateBandOption` with `band: null` (no bands by default), hollow thin points (`smallSamplePoint`), `boundaryMarkLines` through `extendOption`, `ChartLegend` toggles | Weekly mention rate of you and the top N competitors, tooltip "41%, 98 of 238 answers" per entity sorted by value, summary text "You 34%, HubSpot 41%: gap 7 points" | fewer than 2 weeks of points: "A trend needs two weeks of answers" | k of n in every tooltip, small samples hollow, boundary when the set changed |
| CH-19 `ai.sov_over_time` (two thirds, half, full) | `ChartFrame kind="bar" stacked`, 100 percent columns (axis max 1 through `extendOption`), own at the bottom, "Other tracked" on top, `Patterns` toggle | Weekly share of voice of every tracked brand, tooltip "27%, of 412 answers naming a tracked brand that week"; a week with fewer than 4 such answers is an empty column "too few" | same | Shares sum to 1 by construction; pooled weeks named (C-18) |
| CH-29 `ai.sov_rank` (half, two thirds) | `ChartFrame kind="line"` with the card's rank `extendOption` | Rank of you and the top brands by weekly share, tooltip gives the shares and counts, ties shared | fewer than 3 tracked brands: "A rank needs at least 3 tracked brands" | Pooled, tied, gaps for thin weeks, footnote says ranks of small weekly samples move |
| CH-38 `ai.co_mentions` (half, two thirds) | `ChartFrame kind="html"`, `HeatmapGrid` (sequential bins, `compact`), `heatmapCsv` | Share of answers that name both brands, one engine; tooltip "HubSpot and you named together in 212 of 1,800 answers" | fewer than 4 valid answers: insufficient cells | Counts in every tooltip; a missing pair is a real 0 |
| `ai.competitor_table` (half, two thirds, full) | `ChartFrame kind="html"`, `PlainTable`, `EntitySwatch`, `EngineBadge` headers, `DeltaCell`, `SampleCount` | One row per brand (you first), one column per engine in scope plus "Average of N engines, equal weight", value per the `metric` option with its count line, change since the previous period | engine columns with no answer show "No answers" | Each cell is one engine; no pooled column except the labelled average |

Hooks and keyboard: BarList rows and heat cells are links when a drill href exists (focus ring from the parts); single key
shortcuts are not added by this package. Reduced motion: no animation anywhere (ChartFrame sets it).

## 4. Tasks

Each task is one fresh Sonnet implementer (tests first, seen red, file tools only, no heredocs, `sed` or replace scripts)
then one fresh Sonnet reviewer (PASS or a numbered fix list). Commit `WP-35: <title>`, naming only this package's files,
no attribution lines, no dashes. Order: T1 and T2 (together), T3, then T4, T5, T6 (two at a time at most), T7, T8, T9.

House rules for every file: Tailwind v4 token and `type-*` utilities only; `@/lib/format` for every number and date; every
word from `messages/en.json` under `aiOverview.competitors`; no hex, no arbitrary px; no `any`; no `Intl`, `toFixed` or
`toLocaleString`; no em or en dash anywhere; `'use client'` on every card file; default export `ComponentType<CardProps>`.

Checks used below (from the worktree root; never plain `pnpm test`, `pnpm build` or `pnpm e2e` before T9):

- FILE: one test file, no lock: `cd apps/web && pnpm exec vitest run <file>`
- TARGET: `infra/dev/heavy --lane medium --label wp35-<task>-test -- bash -c 'cd apps/web && pnpm exec vitest run src/features/ai-overview/cards/competitors --maxWorkers=2'`
- LINT, TYPES, FORMAT: `infra/dev/heavy --lane medium --label wp35-<task>-lint -- bash -c 'cd apps/web && pnpm lint && pnpm typecheck && pnpm format:check'`
- MESSAGES (any task that edits `en.json`): FILE on `src/i18n/messages.test.ts`
- FULL (T9 only): `infra/dev/heavy --label wp35-test --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'`, then `pnpm build` and `pnpm e2e` the same way

Test setup for component tests: `vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule)`,
`stubViewport()` from `@/test/customize-harness`, `vi.setSystemTime(new Date('2026-11-12T12:00:00Z'))`,
`renderWithProviders(cardInOverview({ type, Card, world: 'fynix' }), { searchParams })` from
`@/test/ai-overview-harness`; the Eventus project needs `setAiSeeded(true)` from `@/mocks/ai-seed`. The harness does not take
options, so a test passes a wrapper `Card` that renders the real card with fixed `options`
(`(p) => <ShareOfVoiceCard {...p} options={{ engine: 'gemini_web', rows: '5' }} />`). Deterministic states
(thin, no competitor, changed set, failed read) use `server.use(http.get(mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary'), ...))`
with a body from `model/summary-fixtures.ts`.

### T1: shared reads and mock totals (leases L-A, L-B)

Rows: process (unblocks CH-06, CH-19, CH-29, CH-38). Needs the coordinator's lease first. Ask whether WP-34 or WP-36 already
requested `include=total` in the mock; if so wait for it and rebase instead.

Files modify: `apps/web/src/features/ai-overview/data/overview-queries.ts` (`SummaryOptions.include` becomes
`readonly ('series' | 'entities' | 'total' | 'co_mentions')[]`, one line and its doc comment),
`apps/web/src/features/ai-overview/data/overview-queries.test.ts` (one case),
`apps/web/src/mocks/handlers/prompt-answers.ts` (`includeOf` accepts `total` and `co_mentions`; the handler builds `total`
as `topicRow` of every prompt in scope, with `series` and `entities` when asked, and `co_mentions` from the counted answers'
`mentions`; `include=cells` and the rest stay refused),
`apps/web/src/mocks/prompt-summary.ts` (the pair counting helper), and the existing literal error case in
`apps/web/src/mocks/handlers/prompt-answers.test.ts` if it pins the old message. New:
`apps/web/src/mocks/handlers/prompt-summary-total.test.ts`.
Modify `apps/web/messages/en.json`: under `aiOverview.competitors` add empty sub-objects `common`, `shareOfVoice`, `lostTo`,
`opportunities`, `trend`, `sovOverTime`, `sovRank`, `coMentions`, `table`, `notAvailable` (so later diffs sit in separate
hunks), in this same commit.

Tests first (`prompt-summary-total.test.ts`, MSW `server`, Fynix and Eventus worlds; `overview-queries.test.ts`):
- `the total of include=total equals a topic row over every prompt in scope for each engine`
- `total carries series and entities when they are asked with it`
- `rows=none with include=total still answers the total and empty row lists`
- `co_mentions has one entry per engine shown with answers equal to the engine's valid answers`
- `a pair is a below b by id, only pairs with one answer or more, sorted by answers then ids`
- `a pair count never exceeds either entity's own answers`
- `cells and an unknown include value are still a literal_error`
- `the response keys equal the generated PromptsSummary keys` (as `ai-overview.test.ts` does for the fan-out mock)
- `summary params carry total and co_mentions sorted and once` (overview-queries)

Break on purpose (the reviewer does each, sees the named test fail, reverts): count a pair when either entity is named;
drop the `rows=none` handling of `total`; stop sorting `include`.

Commands: FILE on the two test files, TARGET on `src/features/ai-overview/data` and `src/mocks/handlers` (medium lane),
MESSAGES, LINT, TYPES, FORMAT. Acceptance: existing mock tests still pass; no other WP's test changes meaning.
Commit `WP-35: summary totals and co-mentions in the mock`.

### T2: the pure model (parallel with T1; no shared file)

Rows: process (the seam for all eight cards). Files new, all under `apps/web/src/features/ai-overview/cards/competitors/model/`:
`summary-fixtures.ts`, `types.ts`, `tracked-set.ts`, `entity-totals.ts`, `weekly-series.ts`, `lost-to.ts`, `co-mentions.ts`,
`seo-share.ts` and a `.test.ts` beside each.

Tests first (names are the test titles; fixtures typed against `PromptsSummary`, no hand cast):
`entity-totals.test.ts`
- `share of voice is the sum of numerators over the sum of denominators of the prompt rows, not the mean of the shares`
- `a total block gives the same figures as the prompt rows on the same data`
- `mention k and n come from pooled successes and trials`
- `fewer than 4 answers naming a tracked brand is insufficient with no value`
- `an engine the summary does not list is unread and never zero`
- `shares of all tracked entities add up to 1 on an engine with answers`
- `own entities come first and competitors keep the summary order`
- `a previous window with no entry for the engine gives no previous`
`tracked-set.test.ts`
- `names you and the competitors once`; `watch and removed entities are not in the set`
- `changed is true only with more than one entity config version`
- `a boundary sits on the Monday week that holds a competitor added inside the window`
- `a competitor added before the window has no boundary and no date in the footnote list`
- `without the entities read a changed set has no boundary and no dates`
- `the week of a day near midnight is read in the project zone`
`weekly-series.test.ts`
- `weeks come oldest first with their Monday as the label`
- `a week with fewer than 4 answers naming a tracked brand has no share`
- `a pooled point keeps its pool weeks for the tooltip`
- `entities beyond the palette fold into Other tracked and the column still adds up to 1`
- `weekly mention k and n are the pooled successes over trials`
- `ties share the lower rank: 1, 2, 2, 4`
- `rank pools the trailing four unpooled weeks and clips at the window start`
- `rank uses the points as read when any point is pooled`
`lost-to.test.ts`
- `a competitor is lost when named, the engine's own mentioned is 0 and the prompt has 4 or more valid answers`
- `a prompt with fewer than 4 valid answers is counted as too few, never lost`
- `a prompt where the own brand is named is never lost`
- `rows sort by prompts lost, then name; zero rows stay out`
- `an opportunity row counts a prompt once however many engines or competitors qualify`
- `nobody named is valid answers above the answers naming a tracked brand`
- `named not cited and cited not named read the outcome cells`
- `an engine outside the scope adds nothing`
`co-mentions.test.ts`
- `the matrix is symmetric with you first, then by mention rate, capped at the top 8`
- `a pair absent from pairs is 0 of the engine's answers`
- `the diagonal is answers named over valid answers from the pooled counts`
- `a diagonal whose trials differ from the engine answers is n/a`
- `fewer than 4 valid answers makes every cell insufficient`
`seo-share.test.ts`: `search share of voice is not available and carries a reason, never a number`

Break on purpose: replace sum over sum by a mean of shares; compare `< 4` with `<= 4`; make the Monday of the week the
Sunday; drop the `a < b` rule when mirroring pairs; return 0 for an unlisted engine; let `rankSeries` give ties distinct
ranks. Each must fail the named test.

Commands: FILE per test file while building, TARGET on the `model` folder, LINT, TYPES, FORMAT. Acceptance: pure
functions, explicit return types, no React import, no `any`. Commit `WP-35: competitor data model`.

### T3: reads, shared parts, skeletons (after T1 and T2)

Rows: process. Files new under `cards/competitors/`: `data/tracked-set-query.ts`, `data/use-competitor-reads.ts`,
`parts/card-engine.ts`, `parts/frame-state.ts`, `parts/tracked-footnote.tsx`, `skeletons.tsx`, tests beside each; modify
`apps/web/messages/en.json` (`competitors.common`).

Tests first:
`use-competitor-reads.test.tsx` (MSW, Fynix)
- `each shape asks its own include and rows` (listen on `server.events` `request:start`; assert the four parameter sets of D-12)
- `two cards of one shape make one request`
- `compare off asks no previous window`
- `useTrackedSet gives color_index, added_at and role from the entities read`
- `a failed entities read leaves the set without dates and is not an error of the card`
`frame-state.test.ts`: one case per row of section 3.2 (`loading`, `ready`, `refetching`, `error` with error id and retry,
`stale` notice, `partial` notice when only the previous read failed, `empty` for off engine, outside filter, too few,
no competitor, no valid answers)
`card-engine.test.tsx`: `an engine outside the filter or off is not asked and says why`, `an editor sees a link to engines, a viewer sees the admin sentence`
`tracked-footnote.test.tsx`: `names the set and lists added dates inside the window`, `says the set changed when no date is known`, `contains no dash`
`skeletons.test.tsx`: `each skeleton exposes the height of its frame` (a `data-height` or class equal to D-13)

Break on purpose: request `total` in `weekly` without `series`; swallow `Read.stale`; show the engines link to a viewer.

Commands: FILE per file, TARGET, MESSAGES, LINT, TYPES, FORMAT. Acceptance: `COMPETITOR_CARDS` still `{}`; the
registry test passes. Commit `WP-35: competitor reads and shared parts`.

### T4: share of voice, lost to a competitor, opportunities

Rows closed: CH-02, CH-05, WB-OV-08, the `ai.opportunities` card. Files new:
`share-of-voice-card.tsx`, `lost-to-card.tsx`, `opportunities-card.tsx` and a `.test.tsx` each; modify `index.ts` (three
entries `'ai.share_of_voice'`, `'ai.lost_to_competitor'`, `'ai.opportunities'` with `load: () => import('./...')` and the
skeletons) and `apps/web/messages/en.json` (`shareOfVoice`, `lostTo`, `opportunities`).

Tests first:
`share-of-voice-card.test.tsx`
- `shows a skeleton at its height, then the entities ranked by share of voice with you in chart-1` (own row has the `chart-1` fill class)
- `every row prints its percent and the count of answers it is named in; the meta line prints the denominator`
- `the footnote names the tracked set and the added dates`
- `a changed tracked set says so in the footnote`
- `fewer than 4 answers naming a tracked brand shows the too few sentence with the count`
- `an engine that is off says it is not asked`
- `only the own brand tracked says no competitor is tracked and links to entities for an editor`
- `a share delta is never coloured; a missing previous window shows no delta`
- `the Table view lists the same rows with the counts`
- `a failed read shows Retry, and Retry reads again; a failed refetch keeps the rows and says last figures read`
- `its percent equals the strip's share of voice figure for the same scope` (read the same engine through `buildAggregates`)
`lost-to-card.test.tsx`
- `lists competitors by prompts lost with the of N context`
- `prompts with too few answers are counted in the footnote`
- `a zero total says no prompt is lost, not an empty chart`
- `the tooltip says named and you are not named in any answer` (D-3 wording)
- `a row links with drillHref when it exists and is plain text when it is null`
`opportunities-card.test.tsx`
- `a prompt counts once in a row however many engines qualify`
- `rows are sorted by count and cut at the rows option`
- `no row uses the words opportunity, should, because or score`
- `the counts equal the prompts the Topics page filters by outcome` (compare with `outcomes` cells on Fynix)
- `loading, error and empty states`

Break on purpose: sum the entity shares per prompt instead of over answers; draw the own row neutral; drop the denominator
from the meta line; count a prompt twice per engine; let the card show a zero for an unread engine. Each fails a named test.

Browser: dev server per section 6, `/digibranders/fynix/ai`, Customize, add each card, check Gemini and AI Mode instances,
390 to 1280 px. Commands: FILE per file, TARGET, MESSAGES, LINT, TYPES, FORMAT. Commit `WP-35: share of voice, lost to and opportunities cards`.
Push to develop after review (rebase first).

### T5: competitor trend, share of voice over time, share of voice rank

Rows closed: CH-06, CH-19, CH-29. Files new: `competitor-trend-card.tsx`, `sov-over-time-card.tsx`, `sov-rank-card.tsx`,
`rank-axis.ts` (the card's own `extendOption` for the inverted integer axis), tests beside each; modify `index.ts` (three
entries) and `en.json` (`trend`, `sovOverTime`, `sovRank`).

Tests first:
`competitor-trend-card.test.tsx`
- `draws you and the competitors option's top 3 by window mention rate, 5 with the option 5`
- `the tooltip row of a week says the value with its k of n and sorts by value`
- `a thin week is a hollow point with the count, never a percent`
- `the legend toggles a series and keeps its colour`
- `a boundary line is drawn on the week a competitor was added when the set changed`
- `the summary sentence states the gap in points with both counts and uses larger than normal variation only when the interim test says so`
- `the Table view prints every week with value and k of n`
`sov-over-time-card.test.tsx`
- `columns are 100 percent: own at the bottom, other tracked on top, axis max 1`
- `a week with fewer than 4 answers naming a tracked brand is an empty column with too few`
- `the tooltip words say of N answers naming a tracked brand that week`
- `a pooled week says it holds the last 4 weeks`
- `the footnote names the tracked set and the boundary is drawn when it changed`
- `the Patterns toggle adds decals`
`sov-rank-card.test.tsx`
- `the rank axis is inverted, integer and starts at 1`
- `ties are drawn at the same rank`
- `a thin week is a gap, not rank last`
- `fewer than 3 tracked brands shows the needs 3 sentence`
- `the footnote says how many tracked brands are not drawn`
`rank-axis.test.ts`: `inverse true, min 1, max the entity count, interval 1, no SERP guide lines`

Break on purpose: draw the boundary one week early; treat a thin week as 0; give tied entities distinct ranks; sort the
tooltip ascending; leave the y axis max at the data max instead of 1 for the stacked share.

Browser: all three at 390, 768, 1024, 1280, light and dark; read the Network of the page to confirm one `weekly` request
for the three cards. Commands as T4. Commit `WP-35: competitor trend, share of voice over time and rank cards`.

### T6: co-mentions and the competitor table

Rows closed: CH-38, WB-OV-09 (D-1). Files new: `co-mentions-card.tsx`, `competitor-table-card.tsx`, tests; modify
`index.ts` and `en.json` (`coMentions`, `table`).

Tests first:
`co-mentions-card.test.tsx`
- `a symmetric matrix with you first, bins from the sequential scale and the printed percent in every cell`
- `a cell tooltip says named together in k of n answers`
- `the diagonal is the brand's answers over valid answers`
- `a missing pair prints 0%`
- `a diagonal that cannot be read prints n/a`
- `fewer than 4 valid answers prints the answer count in every cell`
- `the Table view prints each cell's words and the csv has the counts`
- `a keyboard user can move across cells with the arrow keys` (the grid's own behaviour, asserted through the card)
`competitor-table-card.test.tsx`
- `one row per brand with you first and one column per engine in scope`
- `the metric option switches mention rate and share of voice with their count lines`
- `the average column is labelled equal weight and appears only with two or more engines`
- `a mention change is coloured only when detectable; a share change never is`
- `an engine with no answer shows No answers, never 0`
- `rows option cuts the list and says how many more are tracked`
- `the table has a caption, column headers and no horizontal page scroll at 390 px` (the region scrolls, the page does not)
- `the first row you matches the strip's mention rate for the same engine and scope`

Break on purpose: report the diagonal as the pair share of the entity with itself from `pairs`; show 0 for an unread
engine; colour a share delta; average engines weighted by answers. Commands and commit as T4:
`WP-35: co-mentions and competitor table cards`.

### T7: the e2e flow

Files new only: `apps/web/e2e/flows/ai-overview-competitors.spec.ts`, `apps/web/e2e/support/ai-overview-competitors.ts`
(do not touch `e2e/support.ts`; reuse `signIn`, `expectAccessible` from it; if WP-33 added `e2e/support/ai-overview.ts`,
import it, never edit it). Flow: sign in as `priya@digibranders.test`, open `/digibranders/fynix/ai`, Customize, Start from
Competitive, Save; check the three cards of the Competitive preset; add `ai.sov_over_time`, `ai.sov_rank`, `ai.co_mentions`,
`ai.competitor_table`, `ai.lost_to_competitor`, `ai.opportunities` through the Add card slot; read one percent of share of
voice and its count; open the Table view of one card; change the engine option of one instance; open Settings > Entities
is not needed. Cases:
- `the Competitive preset shows its share of voice cards with a tracked set footnote`
- `every card of the family renders at 390, 768, 1024 and 1280 px in light and dark with no serious axe violation` (loop widths and themes through `idraft.theme` in `localStorage`)
- `a failed summary read shows Retry on the cards and the page keeps its header`
- `compare off hides every delta`
- `the keyboard path reaches the Table view button and a heat cell`
Run: `infra/dev/heavy --label wp35-e2e --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-overview-competitors.spec.ts'`. Commit `WP-35: competitor cards e2e flow`.

### T8: responsive, theme, density and axe pass (fix task)

Headless Playwright only against the dev server on port 3211 (section 6). For each of the 8 cards: 390, 768, 1024, 1280 px,
light and dark, Default and Compact density (Preferences), the three worlds (`fynix`, `eventus-security` with
`setAiSeeded` through the dev seed route, `cleanstart` with engines off). Check overflow, wrapped titles, label
truncation at 120 px of the BarList label column, contrast, focus ring, the keyboard path, the `inert` customize mode,
and that no card has a full page spinner or layout shift when its skeleton resolves (measure the card height before and
after). The task fixes what it finds in the card files only and adds a regression test for each fix. Commit
`WP-35: responsive and accessibility fixes`. If nothing needs fixing, no commit and the reviewer says so.

### T9: As built notes, rebase, final checks, push

Files modify, append only: `docs/20-frontend-specification.md` (an "As built" blockquote after the last note of 4.6: the
stacked 100 percent bars with a boundary series, the rank axis of CH-29, and the tracked set boundary rule D-9; and one
after the last note of 4.8: the competitor table of the AI Overview), `docs/design-system/25-component-inventory.md` (one
"As built" paragraph naming the consumers of `BarList`, `HeatmapGrid`, `PlainTable`, and that `OpportunityStatus` was not
used and why). No other doc. Then: `git fetch origin && git rebase origin/develop` (en.json and `competitors/index.ts` are
the likely conflicts; keep both sides; `catalog.json` is not touched), the FULL run, `pnpm build`, the e2e flow, LINT, TYPES,
FORMAT, `git push origin HEAD:develop`, `infra/dev/wp-status WP-35 merged "..."` and the report line of the brief. Commit
`WP-35: as built notes`.

### O1 (optional, flagged, not default): `competitors.summary` on `/ai`

Only if the coordinator wants the cross-channel table on the AI page. Needs a lease on
`apps/web/src/lib/layouts/catalog.ts` and on `backend/src/idraft/api/layouts/catalog.json` (WP-11): add `'ai_overview'`
to the `screens` of `competitors.summary`, run `pnpm gen:layout-catalog`, commit both in the same commit, run
`pnpm exec vitest run src/lib/layouts src/features/layouts` and `cd backend && uv run pytest tests/api/layouts --no-cov -n 2`
in the medium lane. Then add `competitors-summary-card.tsx` that reuses the table of T6 plus a Search column whose cells are
`NotAvailable` (`parts/not-available.tsx`: the words "Not available", a tooltip "Search share of voice needs click-through
and keyword volume data and is not measured yet", never a number), with its own test
`a search cell says not available, has an accessible name and renders no digit`. Break on purpose: render 0. Commit
`WP-35: competitors summary card`.

## 5. Parallelism and order

At most two subagents of this session at a time (MASTER-PLAN section 4); a reviewer counts, so a reviewer never runs beside
two implementers.

| Round | Together | Why they do not collide |
|---|---|---|
| 1 | T1 (mock, `overview-queries.ts`, `en.json` empty blocks) and T2 (`model/` only) | disjoint files |
| 2 | T3 alone | needs both |
| 3 | T4 and T5, or T4 and T6 | each owns its own card files and tests; both add one `index.ts` entry block and one `en.json` block with the single line Edit tool, so run LINT, TYPES and the TARGET once, by the later finisher, after both are written; reviewers run after both |
| 4 | T6 (or T5) alone | |
| 5 | T7, then T8 | needs every card |
| 6 | T9 | last |

Reviews run per task after the commit candidate exists: the reviewer reads the task, this plan and the diff, runs the task's
FILE and TARGET commands, performs the break on purpose mutations, checks the house rules and the rows, and returns PASS or
a numbered list. The final reviewer reads the whole diff against the brief's acceptance criteria and opens every card at the
four widths.

## 6. Dev server and browser checks

Reuse a dev server already running for this worktree; else start `NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p 3211`
in the background (never kill another process on a port; delete the `AGENTS.md` and `CLAUDE.md` that `next dev` writes in
`apps/web`). Headless Playwright only (the built-in pane cannot register the MSW worker). Pages: `/digibranders/fynix/ai`
(3 engines, 24 prompts, 5 competitors), `/digibranders/eventus-security/ai` (dev seed), `/digibranders/cleanstart/ai`
(engines off). Accounts: `priya@digibranders.test` (editor), `tomas@digibranders.test` (admin), `mei@digibranders.test` (viewer).

## 7. Row coverage

| Row | Inventory status | Task | Closed by |
|---|---|---|---|
| CH-02 Share of voice vs competitors | NOT BUILT | T4 | `ai.share_of_voice` |
| CH-05 Prompts lost to a competitor | NOT BUILT | T4 | `ai.lost_to_competitor` |
| CH-06 Own vs top competitors | NOT BUILT | T5 | `ai.competitor_trend` |
| CH-19 Share of voice over time | NOT BUILT | T5 | `ai.sov_over_time` |
| CH-29 Share of voice rank over time | NOT BUILT | T5 | `ai.sov_rank` |
| CH-38 Who we are named with | NOT BUILT | T6 | `ai.co_mentions` |
| WB-OV-08 Share of voice by entity BarList | NOT BUILT | T4 | `ai.share_of_voice` (same chart as CH-02, W-6) |
| WB-OV-09 Competitors summary table | NOT BUILT | T6 | `ai.competitor_table` (D-1); `competitors.summary` stays WP-40, or O1 |
| Competitor table card | no row of its own | T6 | `ai.competitor_table` |
| Opportunities card (W-9) | no row of its own | T4 | `ai.opportunities` |
| Enablers (mock totals, model, reads, e2e, notes) | process | T1, T2, T3, T7, T8, T9 | |

Rows done count for the status line: 8 of 8 after T6, steps 5 of 5 after T9.

## 8. Open questions for the coordinator

| Q | Question | Default taken |
|---|---|---|
| Q-1 | Lease L-A (`features/ai-overview/data/overview-queries.ts`, WP-33) and L-B (`mocks/handlers/prompt-answers.ts` and `mocks/prompt-summary.ts`, WP-20): does WP-34 or WP-36 ask for `include=total` in the mock too? If yes, one of us does it and the others rebase | T1 does it; if refused, T4 still works from prompt rows but T5 and the pairs of T6 show their error state against the mock |
| Q-2 | Is `competitors.summary` WP-40's? May WB-OV-09 close with `ai.competitor_table`, with O1 only on request? | Yes to both |
| Q-3 | The catalog text of `ai.competitor_trend` says share of voice, the inventory says mention rate. Change the text (lease on `catalog.ts`, regenerate `catalog.json`) or keep? | Keep; card draws mention rate and says "Mention rate" in its title row |
| Q-4 | Accept the prompt level rule of D-3 for CH-05 and Lost to until `ai/competitors` is real? | Yes; the card tooltip states the rule |
| Q-5 | May a family card read `{P}/entities` itself (colours and added dates), since the summary lacks both? | Yes, in `data/tracked-set-query.ts` with its own key |
| Q-6 | WP-33 T7 to T13 (drill links, export blocks, RefetchBar) are not on develop yet. Wait, or ship plain text rows and no export block now? | Ship without; each card task re-checks for `drillHref` and `useExportBlock` and adds them if present |
| Q-7 | Who swaps the reads to `ai/competitors` and `overview/competitors` when WP-32 pushes? | A follow-up of this package (module internals only), after the routes leave `501` and `pnpm gen:api` ran |

## 9. Risks

- Mock lease (Q-1) is the critical path for three cards and CH-38; T1 is first for that reason.
- Real payloads: the `prompt-rows` shape returns every prompt row with entity cells; with 20 entities it is large (c2 C-15 warns 14.5 MB at the worst case). Only the lost-to and opportunity cards use it; if a project is large, move them to `ai/competitors` with `include=lost_prompts` early.
- D-3 differs from the server rule, so "Lost to X: 23 prompts" can be smaller than the list the drill link opens. Wording and Q-4 cover it.
- The weekly points are pooled by the API (C-11) for topic, total and country rows under 10 prompts; CH-19 and CH-29 therefore show overlapping weeks for small projects. The footnote and the tooltip say so (C-18 sentence).
- The interim unpaired test is used for mention deltas and the CH-06 gap sentence although the answers overlap (it is a paired question). Marked `test="interim"`; replaced when `ai/stats/compare` exists (N12).
- Shared files with parallel edits: `messages/en.json` and `competitors/index.ts`. Mitigation: T1 creates the sub-objects, each task edits only its own block, rebase keeps both sides.
- Sibling packages (WP-34, WP-36, WP-37) are still empty; conventions here (`aiOverview.competitors`, `cards/competitors/<name>-card.tsx`, one skeletons file) follow plan section 5 of WP-33 and may need a small rename after they land.
- `HeatmapGrid` at 8 by 8 on a half card (about 456 px at 1024) may need the grid's horizontal scroll region; T6 and T8 check it and cut to 6 entities at that width if needed.
