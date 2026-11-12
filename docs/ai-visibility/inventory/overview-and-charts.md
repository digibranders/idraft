# AI Visibility Overview and chart catalogue

Status: proposal for the owner and the plan writers, 2026-11-12. Read only: nothing in code changed.
Branch read: `ai/prompts-slice1` (develop tip) in worktree `.claude/worktrees/ai-prompts`.
Route: `/[workspace]/[project]/ai` (AI Visibility > Overview, `docs/design-system/11-navigation.md` section 3, "tabs: none").

Read for this spec: `docs/design-system/15-data-visualization.md`, `02-color-system.md` section 7, `12-tables.md`,
`19-responsive-behavior.md`, `24-page-templates.md` (T1 and 9.1 to 9.14), `25-component-inventory.md`,
`AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`, `docs/16-metrics-methodology.md`, `docs/17` (detectability),
`docs/19-api-specification.md` sections 3.7.x, `backend/openapi/v1.json`, the competitor study
`docs/superpowers/specs/2026-11-12-ai-visibility-competitor-study.md` and its working notes (Dashboard inventory,
synthesis sections 1, 2.3, 3, 5), `apps/web/design-preview/charts.js`, and the web code in
`apps/web/src/components/app/{chart,sparkline,metric}`, `apps/web/src/lib/{charts,stats}`, `apps/web/src/features/prompts`.

## 0. Findings that shape this spec

1. **There is no wireframe for `/ai` yet.** `24-page-templates.md` section 9.2 is the project Overview (SEO and AI
   together, route `/`), not the AI Visibility Overview. This document proposes the `/ai` page as a T1 page and should
   be copied into DS 24 as section 9.2a once accepted. Every AI item of 9.2 (strip items per engine, AI by engine
   table, competitor table) is kept consistent with what is drawn here.
2. **The metric routes do not exist.** `ai/metrics/overview`, `ai/metrics/{metric}`, `.../series`, `.../breakdown`,
   `ai/stats/*` and `ai/competitors` are specified in doc 19 (phase 9) and absent from `backend/openapi/v1.json`.
   Built AI reads: `ai/prompts-summary` (with `include=entities,series`, `filter[country_iso]`, `filter[term]`,
   `branded_only`), `ai/sources/domains`, `ai/sources/pages` (both with `compare=previous_period`),
   `ai/citations`, `ai/fanout-queries`, `ai/observations`, `engines`, `prompts`.
3. **The first wave needs no new route.** Project-level rates are exact from the prompt rows of the summary: a
   project rate is prompt weighted (mean of the prompts' rates), share of voice is per answer (sum the numerators and
   denominators of the prompt rows), and the weekly series adds up the same way. The prompts screen strip already
   does this client side (`features/prompts/strip-model.ts`). A server `total` row (N1) is an optimisation, not a
   blocker.
4. **`compare=previous_period` on the summary is specified but not built** (D1 task 3). Until it is, the page reads
   the summary a second time over the previous window, which is what the prompts screen does.
5. **The weekly series carries the own brand only.** `WeekCells` has `mentioned`, `cited`, `share_of_voice` and no
   entities, so a competitor trend needs a new field (N3).
6. **The ECharts wrapper registers only `LineChart` and `BarChart`** (`components/app/chart/echart.tsx`), and
   `ChartFrame` accepts `kind: 'line' | 'bar'` only. Heat-maps, the outcome bar and `BarList` are better as HTML
   (accessible, crisp text, no canvas); scatter needs `ScatterChart` registered; a Sankey needs `SankeyChart` and a
   design review (DS 15 section 5, "Source/citation graph: requires its own design review").
7. **`BarList`, `OutcomeMixBar` and `Heatmap` are in the component inventory (DS 25 section 10) and not built.**
   `ChartFrame`, `EChart`, `SparklineCell`, `MetricStrip`, `ConfidenceIndicator`, `rateBandOption` and
   `rankAxis` are built.
8. **Twice a week cadence** (owner decision Q3, 2026-11-12): a prompt gets about 2 valid answers per engine per week
   and about 8 in 28 days. A single week of one prompt is always below the 4 answer floor
   (`lib/stats/rates.ts`, `MIN_OBSERVATIONS = 4`), so prompt-level weekly points pool the trailing 4 weeks
   (`features/prompts/history-model.ts`, `POOLED_WEEKS = 4`). Project and topic weekly points are prompt weighted per
   week; section 1 rule R7 says when they pool.
9. **Engine colours and entity colours are two systems that never mix in one chart** (DS 14 section 4): engine charts
   ChatGPT `chart-1`, Gemini `chart-2`, AI Mode `chart-3`, AI Overview `chart-4`; entity charts own brand `chart-1`,
   competitors by their stored `color_index`. The Overview has both kinds, so every chart title names its kind ("by
   engine", "vs competitors").

10. **The Overview is a customizable dashboard (owner requirement, 2026-11-12).** The layout rules are built and
    tested as pure code in `apps/web/src/lib/layouts` (catalog, sanitize, draft reducer, row packing, resolution,
    availability), but no page in the app uses them, there is no `ai_overview` screen key, no layouts API, no
    `layouts:manage` key in the backend and no dnd-kit dependency. The static preview has customize mode on the
    project Overview and in the keyword drawer only (`design-preview/index.html` has one `data-screen`,
    `overview`); the Rankings and SEO pages are not customizable in the preview. Section 9 specifies the card
    catalog, presets and interactions, and splits platform work from Overview work.

## 1. Statistical honesty rules (bind every chart below)

| # | Rule | Source |
|---|---|---|
| R1 | Every rate shows its counts: "34%, 612 of 1,800 answers" on hover, in the Table view and in exports. A prompt-weighted rate also says "250 prompts, each counts once" | doc 16 rule 1, UI rule 11 |
| R2 | Fewer than 4 valid answers: no rate. The cell, point or bar says "3 answers" in `foreground-tertiary`, points are hollow 5 px circles with no band, heat-map cells are hatched | `rates.ts`, DS 15 section 4 |
| R3 | No engine pooling. A cross-engine figure is the equal-weight average of the per-engine values, labelled "avg of 3" with the engines named, and only shown next to the per-engine values | doc 16 rule 2 |
| R4 | No composite or opaque score (NFR-10). No "visibility score", "pressure index", grades, verdict pills, gauges or rings | doc 02 NFR-10, study drop classes SCORE |
| R5 | Changes are in points (`+2.1 pts`), never relative percent of a rate or rank. Coloured only when detectable (95% interval of the difference excludes 0); otherwise neutral with "within normal variation". Until slice 3 the test is the unpaired Newcombe interval on pooled counts (`lib/stats/change.ts`) and the footnote says "unpaired, pooled counts" | doc 17 section 6, UI rule 6 |
| R6 | Unknown is never zero: no answers is a gap, an engine without fan-out says "not exposed", a refused or failed answer is collection health, not a miss | doc 16 rules 3 and 5 |
| R7 | Weekly points: a prompt point always pools the trailing 4 weeks ("4 weeks to Oct 26"). A topic or project point is the prompt-weighted rate of that week; when fewer than `POOL_BELOW_PROMPTS` (proposed 10, owner to confirm) prompts have a valid answer in the week, the point pools the trailing 4 weeks as a prompt point does, and the tooltip says which | history-model, cadence Q3 |
| R8 | The interval of a weekly or window rate is the pooled Wilson interval while `ci` is null in the API (doc 16 section 13.2: conservative when any prompt has `n_i` of 1 or 2) | `lib/stats/wilson.ts` |
| R9 | Share of voice depends on the tracked set. Every SOV chart's footnote names the set and the date each competitor was added (`ProjectEntity.added_at`), and draws a boundary when `entity_config_versions` has more than one entry | doc 16 section 5 |
| R10 | Branded prompts are excluded by default (`Branded: Excluded` chip). A chart never mixes branded and non-branded prompts | doc 16 rule 4 |
| R11 | Mentions and citations are different units. Mention rate counts answers that name the brand; citation rate counts answers that cite an own URL; citation units count distinct URLs per answer. A chart never puts two units on one axis | study DB-04, DB-12 to DB-14 |
| R12 | One denominator per number across the page. A share shown in two places uses the same scope and says the same "of N" | study finding "three totals for one number" |

## 2. Data available today

| Data | Route and field | Grain | Notes |
|---|---|---|---|
| Mentioned, cited, outcome mix, share of voice per prompt per engine | `GET {P}/ai/prompts-summary` `prompts[].engines[]` (`EngineSummary`: `mentioned`, `cited`, `outcomes{mentioned_and_cited, mentioned_only, cited_only, neither}`, `share_of_voice`) | window (at most 92 days) | `MetricCell` `{ value, numerator, denominator, n_observations, pooled? }`; `ci` null until S3 |
| The same per topic (term path roll-up, prompt weighted) | `topics[].engines[]` | window | A prompt in two topics counts in both: topic values do not add up to the project |
| Per-entity Mentioned and SOV | `include=entities`: `engines[].entities[]` (`EntityCells`: `entity_id`, `mentioned`, `share_of_voice`), up to 20 entities | window | Own first, then competitors by name |
| Weekly series of the own brand | `include=series`: `engines[].series[]` (`WeekCells`: `week_start`, `mentioned`, `cited`, `share_of_voice`), at most 14 points | ISO week (Monday, project zone), first and last may be partial | No entities per week |
| Freshness | `last_observed_at`, `last_valid_at` per prompt and topic row | row | |
| Scope | `from`, `to`, `filter[engine_code_in]`, `filter[country_iso]`, `filter[term]`, `include_branded`, `branded_only` | | `entities`, `entity_config_versions`, `metric_context`, `engine_codes` in the response |
| Sources by registrable domain and role | `GET {P}/ai/sources/domains`: `citation_units`, `observations`, `prompts`, `engines[{engine_code, citation_units}]`, `source_share` (MetricCell), `first_seen_at`, `last_seen_at`; `compare=previous_period` adds `previous{citation_units, observations}`, `meta.previous_answers`; `meta.by_role` | window | Offset pages, `limit` at most 200 |
| Sources by page | `GET {P}/ai/sources/pages`: as above per `url_id`, with `url`, `host`, `title`; `filter[domain_role_in]=own` gives owned pages (C9) | window | |
| Citation rows | `GET {P}/ai/citations` | per citation | Evidence lists, not for charts |
| Fan-out queries (ChatGPT) | `GET {P}/ai/fanout-queries`: `observations`, `prompts`, `cited_domains` (top 5), `first_seen_at`, `last_seen_at`; `meta.answers`, `answers_with_fanout`, `answers_truncated`, `engines_without_fanout` | window | `min_support` default 2 |
| Answers | `GET {P}/ai/observations` (status, facts, `model_reported`, `observed_at`) | per answer | Cursor pages; fine for one prompt, too heavy for project aggregates |
| Engines | `GET {P}/engines` (enabled, schedule, estimated monthly cost) | project | Drives the no-engine state |
| Tracked entities | project entities with `color_index`, `added_at`, `role` | project | Colours and the SOV footnote |

Not built and needed later: `ci`, paired comparison, movers, volatility (S3); recommendation, structured rank,
prominence, sentiment, AI Overview, retrieved-not-cited, entity candidates (S2); keyword links, alerts (S4).

## 3. The Overview page

### 3.1 Questions it answers, in order

1. How often do AI answers name us, per engine, and is that moving? (strip, CH-01)
2. When they name us, do they also cite our pages? (CH-03)
3. Who else gets named, and are we gaining on them? (CH-02, CH-06)
4. Where are we strong or absent: which topics, which engines? (CH-04)
5. Which sources and which of our pages do the engines cite? (CH-07, CH-08)
6. What changed and what should we do next? (key changes with CH-09, opportunities with CH-05)

The page summarises and links; it never lists more than 10 records per panel (T1 rule).

### 3.2 Header, scope and URL state

| Part | Content |
|---|---|
| Title | "AI visibility" (`type-page-title`) |
| Meta line | "Updated Nov 12, 02:10" (newest `last_valid_at` of the scope), "250 prompts", "3 engines", "Oct 16 to Nov 12"; a stale `FreshnessIndicator` when the newest valid answer is older than 5 days (two missed collections) |
| Actions | "Customize" (`secondary`, `SlidersHorizontal`, a toggle with `aria-pressed`; 768 px and up; in the More menu below 1024 px), section 9.6. Secondary "Export" menu: "Numbers (CSV)" (strip and every panel's table view in one file), "Chart as PNG" per chart lives in each `ChartFrame` overflow; "Copy link" in the `...` menu. No primary action. "Create report" waits for Reports (M-12) |
| Top bar scope | Date range (`win` preset 28 days default, or `from`/`to`, at most 92 days because the API refuses more with `422 window_too_large`) and location (`loc`, mapped to `filter[country_iso]`; countries limited to those every enabled engine asks in) |
| Filter bar | `[vs previous period v]` compare scope (`cmp=prev`, default on; `off`), `[Engines: 3 v]` (`eng`), `[Topic v]` (`topic=term_id`, the term and its subtree, a tree picker over the taxonomy), `[Branded: Excluded x]` default chip (`branded=excluded`, `only`, `included`), "+ Filter" for further filters (intent, prompt type once they exist). Every card reads this scope; cards never store a topic or a competitor (layout rule: options are project agnostic) |
| URL | `win`, `from`, `to`, `cmp`, `loc`, `eng`, `topic`, `branded`, plus `inspect=metric:<engine>.<metric>` for the strip item inspector and `inspect=entity:<id>` for a competitor opened from a list. Parsers from `lib/filters/parsers.ts` |

Every read of the page uses the same scope, so every number on the page has one denominator (R12).

### 3.3 Default layout at 1280 px (main column 1,032 px: 1280 minus the 208 px sidebar and two 20 px gutters)

The Overview is a customizable dashboard (section 9). What follows is its built-in default (preset "Default",
section 9.5). Cards take the four widths of the layout engine (`apps/web/src/lib/layouts/rows.ts`): third 4,
half 6, two thirds 8, full 12 columns at 1280 and up; third and half 6, two thirds and full 12 from 768 to 1279;
everything 12 below 768. The order below is chosen so no row is left half empty at either wide or medium width.

```text
| AI visibility                                                     [Customize] [Export v] [...]     |
| Updated Nov 12, 02:10 . 250 prompts . 3 engines . Oct 16 to Nov 12                                   |
| [vs previous period v] [Engines: 3 v] [Topic v] [Branded: Excluded x] [+ Filter]                     |
+------------------------------------------------------------------------------------------------------+
| Notice region (only when present): no engine, first collection pending, partial run, stale           |
+------------------------------------------------------------------------------------------------------+
| Numbers: Prompts | ChatGPT mention       | Gemini mention        | AI Mode mention                    |
| 250              | 34%  +2.1 pts         | 29%  -0.8 pts         | 41%  -6.0 pts (detectable)         |
| in 13 topics     | Cited 21% . SOV 27%   | Cited 14% . SOV 24%   | Cited 33% . SOV 31%                |
+------------------+-----------------------+-----------------------+------------------------------------+
| 0 CH-37 What changed (full): "ChatGPT named you in 34% of answers, up 2.1 points (detectable). AI Mode   |
|   fell 6.0 points: 12 prompts lost, 9 of them to HubSpot. 37 new cited domains." [each fact links]     |
+------------------------------------------------------------------------------------------------------+
| 1 CH-01 Mention rate by engine, weekly (two thirds)        | 2 CH-03 Named and cited (third)         |
|  ChatGPT  ~~~~~~~band~~~~~~~~                              |  ChatGPT [#####|===|..|::::::::]        |
|  Gemini   ~~~~~~~band~~~~~~~~                              |  Gemini  [###|==|.|:::::::::::]         |
|  AI Mode  ~~~~~~~band~~~~~~~~   -- previous period         |  legend table: 4 outcomes, k of n       |
+------------------------------------------------------------+-----------------------------------------+
| 3 CH-07 Top cited domains (third)   | 4 CH-04 Mention rate by topic and engine (two thirds)          |
|  g2.com      Third party  10.4%     |  Topic        Prompts  ChatGPT  Gemini  AI Mode  avg of 3      |
|  northwind   Own           9.1%     |  CRM startups 17       [47%]    [38%]   [3 ans]  ...           |
+-------------------------------------+----------------------------------------------------------------+
| 5 CH-02 Share of voice vs competitors, ChatGPT (half)| 6 CH-06 You vs top 3 competitors (half)       |
|  Northwind (you)  ###########  27%                   |  ~~~~ you (chart-1, circles)                  |
|  HubSpot          ############# 33%                  |  ~~~~ HubSpot / Pipedrive / Zoho              |
+------------------------------------------------------+-----------------------------------------------+
| 7 Key changes (half)                      View all   | 8 Opportunities (half)            View all    |
|  AI Mode mention -6.0 pts (detectable)  [CH-09 bars] |  Named, not cited          41 prompts         |
|  12 prompts lost on Gemini                           |  Lost to HubSpot           23 prompts         |
|  New cited sources: 37 domains                       |  Cited, not named           6 prompts         |
|  ChatGPT reported a new model Nov 3                  |  No engine names anyone     9 prompts         |
+------------------------------------------------------+-----------------------------------------------+
```

The separator in meta lines is the middle dot of DS 22; this ASCII file writes it as " . ".

### 3.4 Widgets of the default

Card keys are those of the card catalog (section 9.4). Spans: 1280 and up / 768 to 1279 / below 768.

| # | Widget | Card key, width | Spans | Shows | Data source | Interactions |
|---|---|---|---|---|---|---|
| W-0 | Notice region | not a card (not customizable) | 12 / 12 / 12 | One `Banner` at a time, in this order: no engine enabled; first collection pending ("First answers after Nov 13, 02:00"); last run partial ("38 of 750 answers failed on Gemini, Nov 12" with "View run"); stale (newest valid answer older than 5 days) | `GET {P}/engines`; `last_observed_at` vs `last_valid_at`; `GET {P}/runs` (built), N5 for counts by status | Link to Settings > Engines or Runs |
| W-1 | Numbers zone (`MetricStrip md`) | numbers, 4 of at most 6 | one row / one row (4 items need 563 px) / two-column strip grid | Prompts in scope ("in 13 topics"), then mention rate per engine in fixed engine order: value (A1, prompt weighted), delta in points vs the previous window (R5), secondary line "Cited 21% . SOV 27%"; tooltip and `aria-describedby`: "612 of 1,800 valid answers, 250 prompts each counted once, 62 answers not valid". The person can add 2 more numbers (section 9.3) | `prompts-summary` prompt rows, client aggregation as `strip-model.ts`; previous window from a second read or N2 | Number click opens the metric inspector (`inspect=metric:chatgpt_web.mention`): CH-10, CH-13, the Wilson interval, "Show in Topics & Prompts" |
| W-10 | CH-37 What changed | `ai.change_summary`, full | 12 / 12 / 12 | Two to five sentences built from counted facts only (section 4.3, CH-37), each with its counts and a link to the evidence; nothing is written when nothing is detectable ("No change beyond normal variation in these 28 days") | The same reads as W-1, W-8 | Each fact is a link; "How this is written" opens the rules popover |
| W-2 | CH-01 | `ai.rate_trend_by_engine`, two thirds | 8 / 12 / 12 | Small multiples of the metric per engine, weekly, with band, shared axes, synced crosshair; compare on: previous window dashed `chart-reference` on the same week index; boundaries | `include=series` prompt rows, aggregated per week (R7); N1 later | Legend toggles engines; Table toggle; a week click drills to the prompts of that week |
| W-3 | CH-03 | `ai.outcome_mix`, third | 4 / 6 / 12 | One 100% stacked bar per engine: Named and cited, Named only, Cited only, Neither; legend table with k of n | `outcomes` cells | Segment click: `/ai/prompts?eng=X&outcome=mentioned_only` (outcome filter NEW, client side) |
| W-4 | CH-07 | `sources.top_domains`, third | 4 / 6 / 12 | Top 8 registrable domains by citation units with role badge, source share "of 18,420 units", own row `chart-1` | `ai/sources/domains?limit=8&compare=previous_period` | Row: `/ai/citations?tab=domains&inspect=domain:<registrable>` |
| W-5 | CH-04 | `ai.topic_heatmap`, two thirds | 8 / 12 / 12 (list form below 768) | Rows = top-level topics (10 by prompt count, "View all 13 topics"), columns = engines plus "avg of 3", cells on `seq-*`, hatched when insufficient | `topics[]` rows | Cell: `/ai/prompts?topic=<term>&eng=<engine>`; row: `/ai/prompts?inspect=topic:<term>` |
| W-6 | CH-02 | `ai.share_of_voice` (engine ChatGPT), half | 6 / 6 / 12 | `BarList` of SOV per tracked entity for one engine, own `chart-1`, competitors `chart-bar-neutral`, "of 1,412 answers naming a tracked brand"; footnote R9 | `include=entities` prompt rows | Row: entity inspector (`inspect=entity:<id>`); "View all" to `/competitors?tab=ai&eng=X` |
| W-7 | CH-06 | `ai.competitor_trend` (engine ChatGPT), half | 6 / 6 / 12 | Mention rate of the own brand and the 3 competitors with the highest mention rate, weekly. Until N3 ships, the default puts `ai.by_engine` (half) here | N3 | Legend toggles; a legend item opens that entity |
| W-8 | Key changes | `activity.key_changes`, half | 6 / 6 / 12 | `ChangeFeed`, at most 8 rows grouped Needs attention, Changes, Notices: detectable engine changes (inline CH-09 bars for the largest prompt movers), prompts gained or lost per engine (V1, V2), new sources (C5), collection failures, model changes, tracked-set changes | Two summary reads (or N2); `sources/domains?compare=previous_period`; N5; N9 | Each row links to its evidence with the scope in the URL |
| W-9 | Opportunities | `ai.opportunities`, half | 6 / 6 / 12 | `OpportunityStatus` rows with counts, no score: "Named, not cited", "Lost to <competitor>" (CH-05), "Cited, not named", "No engine names anyone" | prompt rows with `include=entities` | Row: `/ai/prompts?opp=<kind>&eng=...` (client side filter, N10 later) |

The built-in default respects the T1 rule that no card repeats a number of the strip in the same form; a customized
layout is bound only by the layout limits (12 cards, 6 numbers).

### 3.5 Other widths of the default

**1024 px** (main column 928 px: 56 px rail, 20 px gutters; medium packing). Rows: [CH-37 12], [CH-01 12], [CH-03 6 | CH-07 6],
[CH-04 12], [CH-02 6 | CH-06 6], [Key changes 6 | Opportunities 6]. Numbers stay one row. A half card is about 456 px:
the `BarList` needs 360 px and a 140 px small multiple reads at that width. CH-04 shows all engine columns (88 px each
plus a 240 px topic column). The filter bar shows scope triggers inline and filters through "+ Filter" only.

**768 px** (main column 736 px: no sidebar, 16 px gutters; still medium packing, the same rows as 1024). A half card
is about 360 px: CH-03 puts each engine label above its bar, CH-07 hides the role badge into the tooltip, CH-02 keeps
its label column at 120 px. Charts are 200 px tall; small multiples keep 140 px each. Numbers become the two-column
strip grid (96 px cells with the context line). The filter bar collapses to a "Filters" button with a count badge;
the date window stays in the top bar. CH-04 shows the topic column plus engine columns while they fit at 88 px; the
"avg of 3" column goes first, then engines from the last in the fixed order, and a "More columns" note says which are
hidden. 768 px is the narrowest width at which Customize is offered.

**390 px** (content 358 px; narrow packing: every card full width, in the saved order; display only, no Customize).
Numbers in a two-column grid. CH-01 one multiple per engine, 180 px each (container below 480 px). CH-03 bars full
width with labels above. CH-07 and CH-02 as `BarList` with the label above the bar. CH-04 as a list: one two-line row
per topic ("CRM for startups", "ChatGPT 47% . Gemini 38% . AI Mode 3 answers"). CH-06 180 px. Key changes and
opportunities as two-line rows. Date window and location move into the filter sheet. No horizontal page scroll; a
chart never scrolls sideways.

### 3.6 States

| State | Page | Each widget |
|---|---|---|
| Loading (first) | Header and filter bar render at once; each panel shows its skeleton at its final height (`SkeletonMetricStrip` with real labels, `SkeletonChart`). Sources and summary load in separate requests and resolve independently | No spinners, no layout shift |
| Refetching (scope changed) | Values stay at full opacity with `aria-busy`; no skeleton flash | Chart redraws once data arrives (no animation) |
| No engine enabled | Notice: "No AI engine is turned on for this project." with "Turn on engines" (Settings > Engines, `ai:manage`) or, without the permission, "Ask a workspace admin to turn on an engine". S1 shows only Prompts. Panels are absent, not disabled | n/a |
| Engines on, no prompts | Notice: "Add prompts to start collecting answers." with "Add prompts" (`/ai/prompts?dialog=add`). Panels absent | n/a |
| Before first collection | Notice with the first scheduled time. S1 engine items show `Pending` ("First answers Nov 13, 02:00"); each panel shows one `EmptyState` sentence | |
| Window with no valid answers | S1 engine items "No valid answers" with the count of invalid ones; charts draw the axes with an empty-state sentence ("No valid answers between Oct 16 and Nov 12. 18 answers failed: View runs") | |
| Engine filter excludes all | Not possible: the chip needs at least one engine | |
| Country with no prompts | "No prompts ask in Germany." with "Clear location" | |
| Small sample | Per R2 in every widget; the strip item shows "3 answers" as the value (`unknown: insufficient`) | |
| Compare window has no data | Deltas are absent (not 0), the footnote says "No answers in the previous 28 days"; dashed previous lines are omitted | `meta.previous_answers = 0` on sources means "no data", never "0 citations" |
| Error | Per panel: "Could not load share of voice." with "Retry"; the rest of the page stays. A failed summary read fails S1 to S5 except W-7 | `422 window_too_large` cannot happen from the UI (the picker caps at 92 days); a hand-made URL gets the message "Choose 92 days or fewer" |
| Partial run | Notice with the scope; numbers still show (invalid answers are excluded and counted) | |
| Tracked set changed in window | SOV panels show a version boundary and the footnote "Competitors changed on Nov 4: Zoho added. Earlier answers keep the earlier set." | from `entity_config_versions` |
| Fan-out engine missing | n/a on this page (fan-out is on Prompt detail and Discover) | |

### 3.7 Drill-downs (filters carried in the URL)

Every link copies `win`/`from`/`to`, `cmp`, `loc`, `eng`, `topic` and `branded` and adds its own:

| From | To | Added parameters |
|---|---|---|
| Strip engine item | Topics & Prompts, Prompts tab | `tab=prompts&eng=<engine>&sort=-mention` |
| CH-01 point (click a week) | Topics & Prompts, Prompts tab, the week as the window | `from=<week_start>&to=<week_end>` plus R7 note when pooled |
| CH-03 segment | Prompts tab | `outcome=<mentioned_only or ...>&eng=<engine>` |
| CH-02 / CH-06 entity | Competitors, AI tab, entity inspector | `/competitors?tab=ai&eng=<engine>&inspect=entity:<id>` |
| CH-04 cell / row | Prompts tab / topic inspector | `topic=<term>&eng=<engine>` / `inspect=topic:<term>` |
| CH-07 domain | Citations, Domains tab | `/ai/citations?tab=domains&inspect=domain:<registrable_domain>` |
| CH-08 page | Citations, Pages tab | `/ai/citations?tab=pages&role=own&inspect=url:<url_id>` |
| Key change row | Its evidence (prompt, topic, run, source) | the subject's `inspect=` |
| Opportunity row | Prompts tab with the opportunity filter | `opp=named_not_cited`, `opp=lost_to:<entity_id>`, `opp=cited_not_named`, `opp=nobody_named` |

### 3.8 Export

- "Numbers (CSV)": one file, one block per panel, each row with value, numerator, denominator, `n_observations`,
  prompts, engine, window, compare window, scope filters, method ("prompt weighted"), and `is_estimate: false`.
  Built client side like the Rankings export until `POST {P}/exports` exists (doc 19 section 3.12).
- PNG per chart from the `ChartFrame` overflow menu, always in the light theme, with the title, meta line and
  footnote drawn into the image (so the denominator travels with the picture).
- Copy link: the current URL (all scope is in it).

### 3.9 What the Overview does not show (from the study's drop list)

Visibility score, brand authority score, pressure index, momentum, "momentum leader", status pills, relative percent
deltas, mention-count totals presented as answers, donut charts, key-score bar chart, rank-weighted "visibility
share", average position over cited answers, the AI-written brand brief (study DB-02 to DB-32). Their honest
replacements are CH-02 (share of voice), CH-05 (lost to a competitor), CH-10 (period change with interval) and the
competitor table on Competitors.

## 4. Chart catalogue

### 4.1 Ranked list

Ranked by value to an SEO and marketing team: how often the question it answers is asked, and whether it leads to
an action. "OV" marks the Overview. Status: E existing data, N new data (section 5), S2/S3/S4 waits for that slice.

| Rank | ID | Name | Pages | Type | OV | Data | Size | Wave |
|---|---|---|---|---|---|---|---|---|
| 1 | CH-01 | Mention rate by engine over time | Overview, Topics & Prompts strip inspector, Prompt Detail, topic inspector | Line with 95% band, small multiples | yes | E (N1 optional) | M | 1 |
| 2 | CH-02 | Share of voice vs competitors | Overview, Competitors, topic inspector | Ranked horizontal bars (`BarList`) | yes | E | S | 1 |
| 3 | CH-03 | Named and cited, by engine (outcome mix) | Overview, Prompt Detail, topic inspector | 100% stacked horizontal bar | yes | E | S | 1 |
| 4 | CH-04 | Mention rate by topic and engine | Overview, Topics & Prompts (heat-map view) | Heat-map table | yes | E | M | 1 |
| 5 | CH-05 | Prompts lost to a competitor | Overview opportunities, Competitors | Ranked horizontal bars of prompt counts | yes | E | S | 1 |
| 6 | CH-06 | Own vs top competitors, mention rate over time | Overview, Competitors AI tab, topic inspector "Visibility trend" | Multi-line (entity chart) | yes | N3 | M | 2 |
| 7 | CH-07 | Top cited domains by role | Overview, Citations | `BarList` with role badge | yes | E | S | 1 |
| 8 | CH-08 | Your pages AI engines cite | Overview, Citations Pages, SEO > Pages | `BarList` | yes | E | S | 1 |
| 9 | CH-09 | Prompt movers | Overview key changes, Topics & Prompts | Diverging bars with interval whiskers | yes (inline) | E (two reads), N2 | M | 2 |
| 10 | CH-10 | Period comparison by engine | Metric inspector, Competitors, Prompt Detail | Dot plot with difference interval (dumbbell) | no | E (two reads), N2 | M | 2 |
| 11 | CH-11 | Prompt by engine heat-map | Topics & Prompts (view switch), topic inspector Prompts tab | Heat-map table | no | E | S | 1 |
| 12 | CH-12 | Prompt by week heat-map | Topic inspector, Prompt Explorer view | Heat-map table, pooled cells | no | E | M | 2 |
| 13 | CH-13 | What moved the mention rate | Metric inspector, Topics & Prompts | Waterfall | no | E (two reads) | M | 2 |
| 14 | CH-14 | Trend sparkline | Topics, Prompts, Citations, Competitors tables | Sparkline | no | E | S | 1 |
| 15 | CH-15 | Citation rate vs mention rate, by topic | Topics & Prompts, Citations | Scatter | no | E | M | 2 |
| 16 | CH-16 | Citation units by source role and engine | Citations, Sources | 100% stacked horizontal bar | no | E (one read per engine) or N7 | S | 1 |
| 17 | CH-17 | Top fan-out queries | Prompt Detail Fan-out, Discover | `BarList` with cited markers | no | E | S | 1 |
| 18 | CH-18 | Engine agreement | Overview (metric inspector), Topics & Prompts | Distribution bars | no | E | S | 2 |
| 19 | CH-19 | Share of voice over time | Competitors AI tab | 100% stacked vertical bars per week | no | N3 | M | 2 |
| 20 | CH-20 | Answer collection calendar | Runs, Overview notice drill-down | Calendar heat-map (HTML grid) | no | N5 | M | 2 |
| 21 | CH-21 | Answer status by engine and day | Runs, Settings > Engines | Stacked vertical bars | no | N5 | S | 2 |
| 22 | CH-22 | New and lost sources | Citations New and lost | Diverging bars by week | no | E (window), N6 (weekly) | S | 2 |
| 23 | CH-23 | Mention rate by country | Overview (country scope menu), Topics & Prompts | Grouped horizontal bars | no | E (one read per country) or N4 | M | 2 |
| 24 | CH-24 | Position in ranked lists | Prompt Detail, Competitors | Histogram (bars by position) | no | S2 | S | 3 |
| 25 | CH-25 | Sentiment when named | Prompt Detail, Competitors | 100% stacked bar per engine | no | S2 | S | 3 |
| 26 | CH-26 | Source diversity over time | Citations, Sources | Two-line small multiples | no | N6 | M | 3 |
| 27 | CH-27 | Retrieved but not cited (ChatGPT) | Citations Pages, SEO > Pages | `BarList` pairs | no | S2 | S | 3 |
| 28 | CH-28 | Fan-out queries we track | Prompt Detail Fan-out, Discover | 100% stacked bar | no | N11 | S | 3 |
| 29 | CH-29 | Share of voice rank over time | Competitors AI tab | Bump chart | no | N3 | M | 3 |
| 30 | CH-30 | Answers to visits | Overview (later), Reports | Step bars (funnel as bars) | no | Ph 12 (GA4) | L | 3 |
| 31 | CH-31 | Search demand vs AI mention | Matrix (prompt clusters) | Scatter (DS 15 section 8) | no | S4 links | L | 3 |
| 32 | CH-32 | Sources shared with competitors | Competitors source overlap | Sankey (entities to domains) | no | N8 | L | 3 |

Added on the second pass (owner request for a richer dashboard). The Rank column gives the place each would take
in the list above (2.5 sits between ranks 2 and 3).

| Rank | ID | Name | Pages | Type | OV | Data | Size | Wave |
|---|---|---|---|---|---|---|---|---|
| 0.5 | CH-37 | What changed (counted-facts summary) | Overview, Topics & Prompts, topic inspector, scheduled digest later | Templated sentences with inline numbers (text, not a chart) | yes | E (two reads), N2, N9 | M | 1 |
| 3.5 | CH-36 | Answer funnel: valid, named, named and cited | Overview (catalog), Prompt Detail, Reports | Nested step bars per engine | catalog | E | S | 1 |
| 4.5 | CH-33 | Mention rate per topic, small multiples | Topics & Prompts (chart view), Overview (catalog) | Small multiples of line with band, one per topic | catalog | E (topic rows carry `series`) | M | 2 |
| 9.5 | CH-38 | Who we are named with (co-mention matrix) | Competitors, Overview (catalog) | Heat-map table, entity by entity | catalog | N14 | M | 2 |
| 16.5 | CH-35 | Events and annotations strip | every time chart | Glyph strip under the x axis plus boundary lines | n/a (layer) | N9, N13 | M | 2 |
| 24.5 | CH-39 | Order of first mention | Prompt Detail, Competitors | Histogram by mention order | no | S2 | S | 3 |
| 26.5 | CH-34 | Citation units by domain, grouped by role | Citations, Sources | Treemap (role, then domain) | no | E | M | 3 |

### 4.1a Chart types left out, and why

| Type | Why it is left out | What answers the question instead |
|---|---|---|
| Donut and pie | Banned in V1 (DS 15 rule 6). Angles and areas compare badly, and across engines or weeks you would need one donut each. The studied tool's donuts showed one share three ways with three totals (study DB-11 to DB-14) | CH-03, CH-16, CH-19 (100% bars), CH-02 (ranked bars) |
| Gauges, rings, progress dials | A gauge needs a target or a 0 to 100 score. We have neither; inventing one is an opaque score (NFR-10) | Number with counts and delta (strip), CH-10 |
| Opaque or composite scores (visibility score, pressure index, authority, grades) | NFR-10 and doc 16: every number has a numerator and a denominator | The underlying rates, each with its counts |
| Dual y axes | Two scales on one plot let the designer choose the crossing point, so the reader sees whatever relation the axes suggest (DS 15 section 5.2) | Stacked small multiples on a shared x axis |
| 3D, gradients, glow, drop shadows on marks | Distort length and area and add noise (DS 15 rule 1) | Flat marks on tokens |
| Radar or spider | Its axes would carry different metrics with different denominators. Polygon area depends on the order of the axes, and the axes are read badly | CH-04 heat-map table, `ai.by_engine` table, CH-10 |
| Treemap or sunburst of topics | A prompt in two topics counts in both, so the areas do not partition the whole and overstate the overlap | CH-04, CH-33. A treemap is kept only where units do partition: CH-34, one domain per citation unit |
| Choropleth or world map | Projects ask in one to five countries, so a map is mostly empty land with colour on a few shapes, and country size is not the data | CH-23 grouped bars |
| Word clouds of fan-out queries or answer text | Word size mixes frequency and word length, with no axis and no counts | CH-17 ranked bars with counts |
| Stacked area of rates | Rates of different engines do not add up to a total | Small multiples (CH-01) |
| Animated race charts | Motion on load is forbidden (DS 21), and rank changes would be noise at weekly sample sizes | CH-29 static bump chart, pooled |

### 4.2 Shared encoding rules

- Frame: every chart sits in `ChartFrame` (title states metric and split, meta line states window, prompts and
  answers, footnote states method). Heights: overview main trend 280 px total for the multiples region, standard
  240, inspector 180, small multiple 140, matrix 480; 200 px below 768 px wide, 180 below a 480 px container.
- Colours: tokens only, read at runtime by `readChartTokens()`; the `EChart` wrapper re-reads them when the theme
  class on `<html>` changes, so light and dark need no reload. Bands 12% opacity light, 18% dark
  (`rateBandOption`). HTML charts use token utilities and switch with the theme by CSS.
- Engine charts: ChatGPT `chart-1` circle, Gemini `chart-2` square (`rect`), AI Mode `chart-3` triangle, AI Overview
  `chart-4` diamond (marker order of `category-chart.ts`). Entity charts: own `chart-1` circle 2 px solid,
  competitors `chart-<color_index>` with the next marker shapes, "Other" dashed `[8, 4]` `chart-other`, previous
  period dashed `[4, 4]` `chart-reference`.
- Rates: y from 0, ceiling = next tenth above the highest value or band, at least 10%, at most 100%
  (`rateCeiling`). Changes: symmetric around 0, 0 line `border-strong`.
- Tooltip rows: dot, name, value, "k of n answers", interval "28% to 41%", and "Fewer than 4 answers" for thin
  points. Text built as plain strings and escaped (`escapeHtml`).
- Table view on every chart (`ChartFrame` Table toggle) with value, k, n, prompts and interval columns.
- Summary sentence on every chart (`aria-describedby`), produced by the feature from the data, for example "ChatGPT
  mention rate 34%, up 2.1 points over 28 days, within normal variation".
- Keyboard: canvases are not navigable point by point; the Table toggle, the legend buttons and the linked tables
  are the keyboard path. HTML charts (`BarList`, outcome bar, heat-map table) are keyboard reachable by their rows or
  cells.

### 4.3 Chart specifications

Each entry: purpose; type and why; encodings; tooltip; legend; small samples; accessibility; data contract; size;
library.

**CH-01 Mention rate by engine over time**
- Purpose: is our AI visibility moving, per engine, beyond noise.
- Type: small multiples of a line with a 95% band, one per engine, shared axes and a synced crosshair
  (`echarts.connect`). One tangled chart of 3 to 4 bands overlaps; multiples keep each band readable.
- Encodings: x = ISO weeks of the window (labels "Oct 20"; partial first and last weeks labelled "partial" in the
  tooltip); y = rate 0 to ceiling, labels without decimals. Series per multiple: the engine line (engine colour, 2 px,
  markers because at most 14 points), band from R8, previous window dashed `chart-reference` when compare is on
  (same week index, not the same dates). Version boundaries (model change, entity set change, extractor change) as
  1 px dashed vertical `foreground-muted` lines labelled in `type-micro`. Series menu switches the metric: Mention,
  Citation, Share of voice (one metric for all multiples).
- Tooltip: "Week of Oct 20, 2026", then per visible engine: "34%, 81 of 238 answers, 61 prompts, 28% to 40%"; when
  pooled (R7): "4 weeks to Oct 26".
- Legend: names only, top right, toggles multiples; previous period as a dashed line swatch.
- Small samples: hollow 5 px point, no band, tooltip "Fewer than 4 answers"; a week without answers is a gap.
- A11y: summary per engine with first, last value and whether the change is detectable; Table view with week rows and
  one column group per engine (value, k of n, interval).
- Data: E: `prompts-summary?include=series` prompt rows; per week the prompt-weighted rate is the mean of
  `mentioned.value` over prompts with `denominator > 0` that week, `pooled` counts = sums of numerators and
  denominators. N1 removes the client loop. Previous window: second read or N2.
- Size M. Library: ECharts line (built) plus `rateBandOption` (built); small multiples need the new
  `SmallMultiples` wrapper (section 6).

**CH-02 Share of voice vs competitors**
- Purpose: of the answers that name any tracked brand, how much goes to us and to each competitor.
- Type: `BarList` comparison mode. A ranked length comparison of up to 15 entities; a donut is banned and reads
  worse.
- Encodings: one row per tracked entity sorted by SOV, own row in weight 600 with a `chart-1` bar, competitors
  `chart-bar-neutral`; value after the bar ("27%"); scale shared by rows from 0 to the largest value. Engine switcher
  in the title row (one engine at a time: no pooling). A 7th entity and beyond fold into "Other tracked" only past 15
  rows.
- Tooltip (row hover and focus): "HubSpot, 33% share of voice, 466 of 1,412 answers that name a tracked brand. Named
  in 41% of all 1,800 valid answers."
- Legend: none (labels name rows). Footnote R9 with added dates.
- Small samples: denominator below 4: the panel shows "Too few answers name a tracked brand (3)" instead of bars.
- A11y: `ul` with accessible text per row (DS 15 section 5.1); never drop the value text.
- Data: E: `include=entities`; per entity SOV = sum of the prompt rows' `share_of_voice.numerator` over the sum of
  denominators (each answer weighs the same, shares sum to 1). Entities from the response's `entities`.
- Size S. Library: HTML (`BarList`, to build).

**CH-03 Named and cited, by engine**
- Purpose: when engines name us, do they also cite our site, and the reverse.
- Type: 100% stacked horizontal bar per engine (DS 15 section 5.2): four parts of a whole, compared across engines.
- Encodings: segments in fixed order Named and cited, Named only, Cited only, Neither; colours from the palette in
  order but never `chart-1` (`chart-3` teal, `chart-4` plum, `chart-5` olive, `chart-other` for Neither), separated
  by 1 px `surface` gaps; inside labels at 6% or more with the contrast rule of 5.2. Rows labelled by engine with
  the engine logo. Prompt weighted (each prompt counts once); the legend table carries the pooled counts.
- Tooltip: "Named only on Gemini: 21% (prompt weighted), 270 of 1,296 answers".
- Legend: the `SimpleTable` below the bars: swatch, outcome, then per engine "21%, 270 of 1,296".
- Small samples: an engine with fewer than 4 valid answers shows "3 answers" in place of the bar.
- A11y: the legend table is the alternative; segments are not focusable, rows are (link to the prompt list filtered
  by outcome). Patterns toggle adds decals.
- Data: E: `outcomes` cells.
- Size S. Library: HTML (`OutcomeMixBar`, to build as the generic `StackedShareBar`).

**CH-04 Mention rate by topic and engine**
- Purpose: where are we strong or absent.
- Type: heat-map table: categories on both axes, one rate per cell; colour helps scanning, the number is printed.
- Encodings: rows = topics (top level by default; the chevron shows subtopics in place), columns = engines in fixed
  order then "avg of 3" (equal weight, R3); cell fill = 7 fixed bins of `seq-1` to `seq-7` (0, under 10, 10 to 20,
  20 to 35, 35 to 50, 50 to 70, 70 and up; bins stated in the footnote), cell text = rate in `num`, text colour per
  bin so the pair meets 4.5:1 (`foreground` on `seq-1` to `seq-4`, `foreground-inverse` on `seq-5` to `seq-7` in
  light; mirrored in dark, where `seq-7` is lightest). A column for Prompts (count). Rows sorted by prompt count,
  switchable to the average rate.
- Tooltip: "CRM for startups on ChatGPT: 47%, prompt weighted over 17 prompts, 64 of 136 answers".
- Legend: a 7-step bin key under the table with the bin bounds.
- Small samples: hatched `rank-band-none` style cell with "3 ans"; a cell with no answers is "n/a" on `surface`.
- A11y: a real `table` with headers; colour is redundant with the printed value; each cell is a link with an
  accessible name naming topic, engine and value.
- Data: E: `topics[]` (topic rows are prompt weighted with `pooled`). Note in the footnote that a prompt in two
  topics counts in both.
- Size M. Library: HTML (`HeatmapGrid`, to build). No ECharts heat-map: canvas cells cannot carry links or table
  semantics.

**CH-05 Prompts lost to a competitor**
- Purpose: which competitor takes the answers we are absent from (study M-23).
- Type: `BarList` of counts: one row per competitor, value = prompts where the competitor is named in at least one
  valid answer and the own brand in none, with at least 4 valid answers on the engine.
- Encodings: neutral bars for all rows (the own brand is not a row), value "23 prompts", context "of 250"; engine
  switcher shared with CH-02.
- Tooltip: "HubSpot is named and you are not in 23 prompts on ChatGPT (of 212 prompts with 4 or more answers)".
- Small samples: prompts with fewer than 4 valid answers are left out and counted in the footnote ("38 prompts have
  too few answers").
- A11y: list with accessible text; row opens the prompt list `opp=lost_to:<id>`.
- Data: E: prompt rows with `include=entities` (`entities[].mentioned.numerator > 0` and own `mentioned.numerator =
  0`).
- Size S. Library: HTML (`BarList`).

**CH-06 Own vs top competitors, mention rate over time**
- Purpose: are we gaining on the brands named instead of us.
- Type: line chart, entity kind, up to 4 series (own plus 3); more would tangle (DS 15 section 4.1).
- Encodings: x = weeks, y = mention rate; own `chart-1` with circles, competitors by `color_index` with their
  marker shapes; no bands by default (4 overlapping bands are unreadable), a "Show intervals" toggle switches to
  small multiples with bands. One engine at a time.
- Tooltip: per entity "41%, 98 of 238 answers"; sorted by value.
- Legend: names with swatch, toggles.
- Small samples: hollow points per R2; pooled per R7.
- A11y: Table view, summary "You 34%, HubSpot 41%: gap 7 points, within normal variation".
- Data: N3 (entities per week).
- Size M. Library: ECharts line (built).

**CH-07 Top cited domains by role**
- Purpose: which sites the engines lean on.
- Type: `BarList` comparison mode with a role badge (Own, Competitor, Third party) and the delta in source share.
- Encodings: own domain bar `chart-1`, others `chart-bar-neutral`; value "10.4% of citation units"; a neutral
  `Delta` "+1.1 pts" coloured only when detectable (two-proportion test on units, labelled "units, unpaired").
- Tooltip: "g2.com, 1,912 citation units in 1,104 answers, 211 prompts; previous 28 days 1,640 units".
- Small samples: rows below `min_support` 2 units are not listed (doc 16 C5).
- A11y: list; row opens the domain inspector.
- Data: E: `ai/sources/domains?limit=8&compare=previous_period` (`source_share`, `previous`, `meta.previous_answers`).
- Size S. Library: HTML.

**CH-08 Your pages AI engines cite**
- Purpose: which of our URLs earn citations, for the SEO team's page work (C9).
- Type: `BarList` of own pages.
- Encodings: path (host hidden when one own domain) with title in the tooltip, bar `chart-1`, value "612 units",
  context "in 88 prompts"; engine split in the tooltip.
- Tooltip: "/pricing: 612 citation units, ChatGPT 301, Gemini 112, AI Mode 199; first cited Sep 2".
- Small samples: none needed (counts); empty: "No answer cited your pages in this window" with a link to the
  prompts where you are named and not cited.
- Data: E: `ai/sources/pages?filter[domain_role_in]=own`.
- Size S. Library: HTML.

**CH-09 Prompt movers**
- Purpose: which prompts drove the change.
- Type: diverging horizontal bars of the change in points per prompt and engine, with the difference interval as a
  whisker; diverging length shows direction and size together.
- Encodings: bar from 0 to the change; fill neutral `chart-reference` unless detectable, then `positive-solid` or
  `negative-solid` from `formatMetricDelta` tones (never chosen locally); whisker 1 px `foreground-tertiary`; at most
  8 rows on the Overview, 25 on Topics & Prompts.
- Tooltip: "best crm for startups, ChatGPT: 25% to 75% (+50 pts), 2 of 8 then 6 of 8 answers; interval +9 to +77
  pts, detectable (unpaired)".
- Small samples: prompts with fewer than 4 answers in either window are excluded and counted.
- Ordering: by effect size; in S3 by the BH-filtered paired comparison (`ai/stats/movers`).
- A11y: rows are a list with the sentence above; Table view.
- Data: E (two summary reads, `differenceInterval`), N2, later doc 19 `ai/stats/movers`.
- Size M. Library: HTML bars (`IntervalBar`); ECharts is not needed.

**CH-10 Period comparison by engine**
- Purpose: one engine's or entity's rate now vs the previous window, with the uncertainty of the difference.
- Type: dot plot (dumbbell): two dots per row joined by a line, plus the difference interval on a second, aligned
  column. Two bars would invite reading the gap as precise.
- Encodings: rows = engines (or entities on Competitors); previous dot hollow `chart-reference`, current dot filled
  in the engine or entity colour; the difference column draws an interval bar around the point estimate with a 0
  line.
- Tooltip: "ChatGPT: 31.9% then 34.0%, +2.1 pts, 95% interval -1.4 to +5.6, within normal variation".
- Small samples: rows below 4 answers in either window show "Too few answers to compare".
- Data: E (two reads) or N2; S3 replaces the interval with the paired bootstrap from `ai/stats/compare`.
- Size M. Library: HTML/SVG inside `ChartFrame` (body slot, section 6) or ECharts `CustomChart`; HTML preferred.

**CH-11 Prompt by engine heat-map**
- Purpose: scan many prompts for engine disagreement.
- Type: heat-map table (`HeatmapGrid`), rows = prompts grouped by topic, columns = engines, same bins as CH-04.
- Tooltip: "8 of 12 answers, 67%, last valid answer Nov 11".
- Small samples: hatched "3 ans" (the common case at the prompt level in a 28 day window with one engine missing a
  run).
- Data: E: prompt rows. Virtualised past 100 rows.
- Size S (reuses CH-04). Library: HTML.

**CH-12 Prompt by week heat-map**
- Purpose: see when a prompt started or stopped naming us.
- Type: heat-map table, rows = prompts of one topic, columns = weeks; cells pool the trailing 4 weeks (R7), so
  every column carries about 8 answers.
- Encodings: `seq-*` bins; version boundaries as a 2 px `foreground-muted` column rule.
- Tooltip: "4 weeks to Oct 26: 5 of 8 answers, 62%".
- Data: E: `include=series` with `filter[term]`.
- Size M. Library: HTML.

**CH-13 What moved the mention rate**
- Purpose: explain a headline change exactly, without a model.
- Type: waterfall: previous rate, then the contribution of prompts that rose, prompts that fell, prompts added to
  the scope, prompts that left, then the current rate. For a prompt-weighted rate over the prompts common to both
  windows, the change is exactly the mean of their per-prompt changes, so the rising and falling parts add up; the
  "prompt set changed" bar is the remainder `(R1 - R0) - mean_common(r1 - r0)`, also exact.
- Encodings: start and end bars `chart-reference`; rising and falling contributions neutral fills with "+" and "-"
  labels (direction is in the label; colour only when the total change is detectable); the rows carry the prompt
  counts ("31 prompts up").
- Tooltip: "Prompts that rose: +4.8 pts from 31 prompts; top: best crm for startups +50 pts".
- Small samples: prompts below 4 answers in either window go into a separate "too few answers" bar, so the bars
  still add up.
- Data: E (two summary reads); N2.
- Size M. Library: ECharts stacked bar (built) with a transparent base series, or HTML; ECharts preferred for the
  axis.

**CH-14 Trend sparkline**
- Purpose: direction at a glance in tables.
- Type: `SparklineCell` (canvas, 64 x 16 or 20 px), as DS 15 section 9: rates drawn in a window of at least 20
  points; gaps where a week has no usable rate; own rows `chart-1` in mixed tables, gray otherwise; never red or
  green on the line.
- Data: E (`include=series`, prompt points pooled per R7); N6 for source rows.
- Size S. Library: built (`components/app/sparkline`); a rate variant uses `minSpan = 0.2`.

**CH-15 Citation rate vs mention rate, by topic**
- Purpose: find topics where engines name us but do not cite our pages (content gap) and the reverse.
- Type: scatter, x = mention rate, y = citation rate, one point per topic, size = prompts (sqrt, 4 to 14 px);
  a 45 degree reference line `chart-reference` ("cited as often as named").
- Encodings: points `chart-reference` 60% with 1 px `surface` outline; hovered `chart-1`; no quadrant colours; one
  engine at a time.
- Tooltip: topic, mention "47%, 64 of 136", citation "12%, 16 of 136", prompts 17.
- Small samples: topics with fewer than 4 answers are hollow and counted in the footnote.
- A11y: Table view; click opens the topic; below 1024 px replaced by the table (as the Matrix).
- Data: E: topic rows.
- Size M. Library: ECharts `ScatterChart` (register in the wrapper; small bundle addition).

**CH-16 Citation units by source role and engine**
- Purpose: do engines cite us, our competitors or third parties.
- Type: 100% stacked horizontal bar per engine: Own, Competitor, Third party.
- Encodings: Own `chart-1` (an entity segment, allowed), Competitor `chart-2`, Third party `chart-other`; counts in
  the legend table.
- Data: E: `ai/sources/domains` `meta.by_role` read once per engine (3 small reads), or N7.
- Size S. Library: HTML (`StackedShareBar`).

**CH-17 Top fan-out queries**
- Purpose: what ChatGPT searched before answering, and whether our domain was among the cited sources.
- Type: `BarList` of queries by answers that issued them, with a marker "own domain cited" when an own row is among
  `cited_domains`.
- Encodings: neutral bars; value "issued in 14 of 96 answers"; marker is a text badge, not colour alone.
- Empty and limits: Gemini and AI Mode say "Fan-out not exposed by this engine" (from
  `meta.engines_without_fanout`); `answers_truncated` shown in the footnote.
- Data: E: `ai/fanout-queries`.
- Size S. Library: HTML.

**CH-18 Engine agreement**
- Purpose: are we named everywhere or only by one engine.
- Type: distribution `BarList`: prompts named by 0, 1, 2 or 3 of the engines in scope, where "named by an engine"
  means at least one valid answer names the brand and the engine has at least 4 valid answers for the prompt.
- Encodings: distribution mode (fixed order 0 to 3), `seq-3` to `seq-6` for the four steps.
- Tooltip: "Named by 2 of 3 engines: 64 prompts".
- Data: E: prompt rows.
- Size S. Library: HTML.

**CH-19 Share of voice over time**
- Purpose: who gains the share of the answers week by week.
- Type: 100% stacked vertical bars per week (shares of a whole that sums to 100% by construction); bars over area
  because there are only 4 to 14 weeks and each week is a separate sample.
- Encodings: own `chart-1` at the bottom, competitors by `color_index`, "Other tracked" `chart-other` on top; 1 px
  `surface` separators; tracked-set boundaries as a vertical line.
- Tooltip: per entity share and "of 412 answers naming a tracked brand that week".
- Small samples: a week with fewer than 4 such answers is an empty column with "too few".
- Data: N3.
- Size M. Library: ECharts bar stacked (built).

**CH-20 Answer collection calendar**
- Purpose: did collection run as scheduled (Monday and Thursday), and where did answers fail.
- Type: calendar heat-map as an HTML grid (rows = weekdays, columns = weeks): it shows the cadence directly.
- Encodings: cell fill = share of scheduled answers that are valid on that day, `seq-*`; a day with no schedule is
  `surface`; failures marked with a glyph and count; budget-blocked days marked with a distinct glyph.
- Tooltip: "Thu Nov 6: 742 of 750 answers valid, 6 refused, 2 errors".
- Data: N5.
- Size M. Library: HTML (ECharts calendar needs `CalendarComponent` and canvas; not worth it for about 13 x 7 cells).

**CH-21 Answer status by engine and day**
- Purpose: collection health per engine.
- Type: stacked vertical bars per run day: valid, partial, empty, refused, error; small multiples per engine.
- Encodings: valid `chart-reference`, others palette in order with decals available; counts, not rates.
- Data: N5.
- Size S. Library: ECharts bar stacked (built).

**CH-22 New and lost sources**
- Purpose: which domains entered or dropped out of the citations.
- Type: diverging bars by week: new domains up, lost down (C5, C6 rules with `min_support`).
- Data: window level E (`compare=previous_period`: `previous.citation_units = 0` and current at least 2 is new,
  only when `meta.previous_answers > 0`); weekly N6; lost (C6) needs two following windows, so it shows only once
  they exist.
- Size S. Library: ECharts bar (built).

**CH-23 Mention rate by country**
- Purpose: market differences for multi-country projects.
- Type: grouped horizontal bars, rows = countries, bars = engines (at most 4 per group, DS 15 section 5).
- Data: E by one summary read per country with `filter[country_iso]` (countries from the prompts' markets); N4 for one
  read.
- Hidden when the project asks in one country.
- Size M. Library: ECharts bar (built), horizontal.

**CH-24 Position in ranked lists**
- Purpose: when an answer gives a ranked list, where are we in it (A9, A10).
- Type: histogram of structured rank 1, 2, 3, 4, 5, 6 and lower, plus "in a list, not ranked" and "list without us";
  counts with the share of answers that had a qualifying list (A9 denominator).
- Data: S2 (`own_structured_rank`, `had_structured_list`).
- Size S. Library: ECharts bar (built).

**CH-25 Sentiment when named**
- Purpose: tone of answers that name us (A13), four shares, never one score.
- Type: 100% stacked bar per engine: positive, neutral, negative, mixed, with classification coverage in the meta.
- Data: S2.
- Size S. Library: HTML (`StackedShareBar`).

**CH-26 Source diversity over time**
- Purpose: do engines rely on few or many sources (C3).
- Type: small multiples of distinct domains and effective number of sources (inverse HHI) per week; counts, so no
  band.
- Data: N6 or doc 19 `ai/sources/diversity`.
- Size M. Library: ECharts line (built).

**CH-27 Retrieved but not cited (ChatGPT)**
- Purpose: our pages ChatGPT read but did not cite (C8).
- Type: paired `BarList`: retrieved vs cited per own page.
- Data: S2.
- Size S. Library: HTML.

**CH-28 Fan-out queries we track**
- Purpose: how many of ChatGPT's searches are keywords we track (F3).
- Type: 100% stacked bar: matched a tracked keyword, not matched; link to "Add to keyword inbox".
- Data: N11.
- Size S. Library: HTML.

**CH-29 Share of voice rank over time**
- Purpose: ordering among competitors week to week.
- Type: bump chart on an inverted rank axis (`rankAxis`). Low value: ranks of shares over small weekly samples flip
  on noise. Shown only with the 4 week pooled shares and ties drawn as shared ranks; the tooltip gives the shares.
- Data: N3.
- Size M. Library: ECharts line (built) plus `rank-chart.ts`.

**CH-30 Answers to visits**
- Purpose: from answers that name or cite us to AI referral sessions (GA4).
- Type: step bars (horizontal bars of counts in order: valid answers, named, named and cited, AI referral sessions),
  not a funnel shape; the last step is a different source and unit and is drawn in a separate panel row with its own
  label (R11), never as a conversion rate from answers.
- Data: Ph 12 (doc 18 GA4).
- Size L. Library: HTML.

**CH-31 Search demand vs AI mention**
- Purpose: the SEO and AI matrix for prompt clusters (DS 15 section 8).
- Type: scatter with thresholds and quadrant labels as specified there.
- Data: S4 keyword-prompt links.
- Size L. Library: ECharts `ScatterChart` (register).

**CH-32 Sources shared with competitors**
- Purpose: which domains are cited when a competitor is named, compared with us (C7).
- Type: Sankey from entities (left) to top domains (right), width = citation units in answers naming the entity. Needs
  its own design review (DS 15 section 5) and `SankeyChart`; the `SimpleTable` of DS 24 9.8 ships first.
- Data: N8 or doc 19 `ai/sources/competitor-overlap`.
- Size L. Library: ECharts `SankeyChart` (register, design review).

**CH-33 Mention rate per topic, small multiples**
- Purpose: which topics are moving, without a tangle of lines.
- Type: small multiples (DS 15 section 4.1: many series of one kind), one 140 px panel per top-level topic, top 6 by
  prompt count with "Show all", shared y axis, synced crosshair, one engine at a time.
- Encodings: line in the engine colour with band (R8), hollow points when thin; the panel title carries the topic, its
  prompt count and the window value with the delta in points.
- Why useful: a team owns topics. This shows which topic drove the headline, which CH-01 cannot.
- Data: E: `topics[].engines[].series` (prompt weighted per week, R7 pooling below 10 prompts).
- Size M. Library: `SmallMultiples` (section 6).

**CH-34 Citation units by domain, grouped by role**
- Purpose: how concentrated the sources are, and how large our own slice is within the long tail.
- Type: treemap with two levels (role, then registrable domain), area = citation units. Allowed here because units do
  partition: each unit has exactly one domain and one role. Labels only on tiles of 48 by 24 px or more; the rest
  fold into "312 more domains".
- Encodings: Own `chart-1`, Competitor `chart-2`, Third party `chart-other` (role is the colour, the domain is the
  tile); 1 px `surface` borders; no gradients.
- Why useful: the effective number of sources (C3) as a picture. The `BarList` stays the default because length reads
  better than area; the treemap is an alternative view in the Citations frame.
- A11y: the Table view lists every tile; tiles are not focusable.
- Data: E: `ai/sources/domains` (first 200 rows plus `meta.citation_units` for the remainder).
- Size M. Library: ECharts `TreemapChart` (register; design review with CH-32).

**CH-35 Events and annotations strip**
- Purpose: put model changes, tracked-set changes, prompt-set changes and the team's own notes ("Published
  /pricing v2", "PR launch") next to the lines they might explain (study M-14, M-19).
- Type: an 8 px glyph strip under the x axis of every time chart, plus 1 px dashed boundary lines for system events
  (DS 15 section 7 events pattern). Glyph shapes by family: model change (circle), tracked set (square), prompt set
  (triangle), note (diamond); colour `foreground-muted` (events are context, not data).
- Interaction: hover or focus shows the event; the legend toggles families; "Add note" in a time chart's overflow
  menu (`notes:write`, editor and above) opens a small form (date, text up to 140 characters, scope: project or
  topic).
- Honesty: notes never change a number. The tooltip of a point after a note says "Note on Nov 3: ...", never
  "because of".
- Data: N9 (system events), N13 (notes).
- Size M. Library: ECharts `markLine` and a custom glyph series (built components).

**CH-36 Answer funnel: valid, named, named and cited**
- Purpose: where visibility is lost between an answer and a citation of our site.
- Type: nested step bars per engine. Each step is a subset of the one before (answers, then valid answers, then
  answers naming us, then answers naming and citing us), so the bars can be drawn as one honest funnel. The shape is
  horizontal bars on a shared scale, not a trapezoid, so lengths stay comparable.
- Encodings: neutral `chart-reference` bars with the step's count and its share of the step before ("612 of 1,800
  valid answers, 34%"); the own-brand steps use `chart-1`. One row group per engine (no pooling).
- Why useful: it separates collection loss (answers not valid), visibility loss (not named) and citation loss
  (named, not cited). It is the honest version of the studied tool's "AI Answer Coverage" donut (DB-11).
- Note: this funnel uses pooled answer counts; the strip's mention rate is prompt weighted. The footnote says so,
  and the two differ when prompts have different answer counts.
- Data: E: prompt rows (`n_observations`, `mentioned`, `outcomes.mentioned_and_cited`, summed per engine).
- Size S. Library: HTML (`StepBars`, section 6).

**CH-37 What changed (counted-facts summary)**
- Purpose: a short summary a marketing lead reads first, with no invented insight.
- Type: text card. Two to five sentences from fixed templates, filled only with counted facts that pass the rules:
  1. Engine change: "ChatGPT named you in 34% of answers (612 of 1,800), up 2.1 points from 31.9%." Written only
     when the change is detectable (R5); otherwise one sentence for all engines: "Mention rates moved within normal
     variation."
  2. Prompts gained or lost per engine (V1, V2): "On AI Mode, 12 prompts that named you no longer do; 9 of them now
     name HubSpot."
  3. Share-of-voice leader change, only when the gap's interval excludes 0.
  4. Sources: "37 domains were cited for the first time (at least 2 citation units each)."
  5. Collection: "38 answers failed on Gemini on Nov 12" (only when there were failures).
- Rules: no causal words ("because", "due to", "drove"); no adjectives of judgement ("great", "worrying"); every
  number is a link to its evidence; the order is fixed (collection first when it affects the numbers). It is
  deterministic: no LLM writes it, so the same data always gives the same text and a test can check every template.
- Why useful: it is the honest answer to the studied tool's AI-written "Brand Analysis Brief" (DB-29 to DB-32), which
  had no sources, no dates and a "risk" that was not a risk.
- A11y: plain text; the links are listed in reading order.
- Data: E (two summary reads, `sources/domains?compare=previous_period`), N2, N5, N9.
- Size M. Library: none (React text with `@/lib/format`).

**CH-38 Who we are named with (co-mention matrix)**
- Purpose: which competitors the engines compare us with.
- Type: heat-map table, rows and columns are tracked entities, cell = share of valid answers that name both (diagonal
  = that entity's mention rate). Symmetric, so only the lower triangle is drawn.
- Encodings: `seq-*` bins as CH-04; counts in every cell's tooltip ("HubSpot and you named together in 212 of 1,800
  answers"); one engine at a time.
- Why useful: it shows the shortlist an answer puts us on. A heavy you-and-HubSpot cell means "compared with HubSpot";
  a heavy HubSpot-and-Pipedrive cell in a row where we are absent is a shortlist we are missing from.
- Data: N14.
- Size M. Library: HTML (`HeatmapGrid`).

**CH-39 Order of first mention**
- Purpose: when we are named, are we named first (A12).
- Type: histogram of mention order 1, 2, 3, 4 and later, per engine, counts with the share of answers that name us.
- Data: S2 (`own_mention_order`).
- Size S. Library: ECharts bar (built).

## 5. New API needs

Ordered by the wave that needs them. Shapes follow doc 19 conventions (snake_case, `MetricCell`, `meta.window`).

**N1 `include=total` on `GET {P}/ai/prompts-summary` (wave 2, optimisation).**
Adds one object over every prompt in scope, aggregated as a topic row is (prompt weighted Mentioned, Cited, outcomes
with `pooled`; SOV per answer):
```json
{ "data": { "...": "existing fields",
  "total": { "prompt_count": 250, "last_observed_at": "...", "last_valid_at": "...",
    "engines": [ { "engine_code": "chatgpt_web", "mentioned": {"value": 0.34, "numerator": 85.0, "denominator": 250, "n_observations": 1862, "pooled": {"successes": 612, "trials": 1800}},
                   "cited": {}, "outcomes": {}, "share_of_voice": {}, "entities": [], "series": [] } ] } } }
```
`entities` and `series` appear when requested by the same `include`. Removes the client loop over all prompt rows and
keeps the payload small when the Overview does not need prompt rows (`include=total` with a new `rows=none`).

**N2 `compare=previous_period` on `GET {P}/ai/prompts-summary` (wave 2; plan D1 task 3, specified, not built).**
Adds `meta.compare_window {from, to}`, `meta.previous_answers`, and on every `EngineSummary` (and entity cell) a
`previous` object with the same cells. The Overview, CH-09, CH-10 and CH-13 use it in place of a second read.

**N3 Entities per week: `series[].entities` (wave 2).**
With `include=series,entities`, each `WeekCells` gains `entities: EntityCells[]` (Mentioned and SOV per tracked
entity for that week, weighted as the week's own cells). Bound: 20 entities x 14 weeks per engine. Needed by CH-06,
CH-19, CH-29 and the topic inspector "Visibility trend" of DS 24 9.5.

**N4 Country breakdown (wave 2, optional).**
Either `GET {P}/ai/metrics/{metric}/breakdown?dimension=country` as doc 19 specifies, or the cheaper
`group_by=country` on the summary returning `by_country: [{ country_iso, engines: EngineSummary[] }]`. Until then
CH-23 makes one read per country (at most the project's markets, usually 1 to 3).

**N5 Collection health per day: `GET {P}/ai/collection/daily` (wave 2, new).**
Request: `from`, `to`, `filter[engine_code_in]`. Response:
```json
{ "data": [ { "date": "2026-11-06", "engine_code": "gemini_web", "scheduled": 250, "answers": 248,
              "by_status": { "complete": 240, "partial": 2, "empty": 1, "refused": 3, "error": 2 },
              "valid": 242, "budget_blocked": 0, "runs": ["run_id"] } ],
  "meta": { "window": {}, "engine_codes": [] } }
```
`scheduled` from the schedules active that day (null when unknown, never 0). Feeds W-0, CH-20, CH-21, Runs.

**N6 Weekly series on sources: `include=series` on `ai/sources/domains` and `ai/sources/pages` (wave 2).**
Per row `series: [{ week_start, citation_units, observations }]`, at most 14; and `meta.series: [{ week_start,
answers, citation_units, distinct_domains }]` for CH-22 and CH-26. Doc 19 `-trend` sort can be built on it.

**N7 Role split per engine: `meta.by_role_by_engine` on `ai/sources/domains` (wave 1 nice to have).**
`[{ engine_code, own: {citation_units, answers_citing}, competitor: {...}, third_party: {...} }]`. Saves 2 reads for
CH-16.

**N8 Competitor source overlap (wave 3).**
Doc 19 `GET {P}/ai/sources/competitor-overlap` as specified, with per pair `shared_domains: [{ registrable_domain,
units_with_entity, units_with_own }]` so CH-32 and the 9.8 table share one read.

**N9 Annotations: `GET {P}/ai/annotations` (wave 2, new).**
Request: `from`, `to`, `filter[engine_code_in]`. Response `data: [{ at, kind: 'model_changed' | 'entity_set_changed' |
'extractor_changed' | 'prompt_set_changed', engine_code?, from?, to?, label }]`, from `observations.model_reported`,
`entity_config_versions`, derivations and prompt membership. Draws the boundary lines on every time chart. Until then
the client reads `entity_config_versions` from the summary and skips model changes on project charts.

**N10 Outcome and opportunity filters on the summary (wave 2, optional).**
`filter[outcome]` and `filter[opportunity]` (`named_not_cited`, `lost_to:<entity_id>`, `cited_not_named`,
`nobody_named`) narrowing the prompt rows, so the drill-downs work server side with paging. Wave 1 filters the
already loaded rows client side; the summary returns every active prompt, so this is exact.

**N11 Fan-out keyword match (wave 3).**
On `FanoutQueryRow`: `matched_tracked_keyword_id` (exact normalised match, doc 16 F3) and `meta.matched_queries`.

**N12 Later, as specified in doc 19 (S3):** `ci` on every `MetricCell`, `ai/stats/compare` (paired), `ai/stats/movers`
(BH), `ai/stats/volatility`. They replace the client unpaired intervals; the charts do not change shape.

**N13 Chart notes: `GET/POST/DELETE {P}/notes` (wave 2, new).**
`POST` body `{ on: "2026-11-03", text: "Published /pricing v2", scope: { kind: "project" } | { kind: "term", term_id } }`
(text at most 140 characters, stored as text and shown escaped); `GET ?from&to` returns `data: [{ note_id, on, text,
scope, created_by: { user_id, name }, created_at }]`. Permission `notes:write` (editor and above) to write, `data:read`
to read. Used by CH-35.

**N14 Co-mention counts (wave 2, new).**
`include=co_mentions` on the summary: per engine `co_mentions: [{ a: entity_id, b: entity_id, answers }]` over the
valid answers in scope, with `answers` (the denominator) once per engine. Computed from
`observation_facts.own_mentioned` and `competitor_mentions`. Feeds CH-38.

## 6. Shared chart components

Build once in `apps/web/src/components/app/chart` (HTML ones) and `apps/web/src/lib/charts` (option builders).
Props are TypeScript; every component takes formatted strings from `@/lib/format`, never formats itself.

**ChartFrame (exists; extend).** Add a `body` mode for HTML charts so they get the same title row, legend, Table
toggle, overflow menu and footnote:
```ts
type ChartFrameProps =
  | (ExistingCategoryProps & { kind: 'line' | 'bar' })
  | { kind: 'html'; title: string; variant: 'panel' | 'inspector'; meta?: string | null; footnote?: ReactNode;
      controls?: ReactNode; legend?: readonly LegendItem[]; body: ReactNode; table: ReactNode;
      summary: string; status: 'loading' | 'ready' | 'empty' | 'error'; empty?: ReactNode; onRetry?: () => void;
      menu?: { png?: () => void; csv?: () => void; link?: string } };
```
Also add `status: 'empty' | 'error'` to the existing kinds, and the overflow menu (Download PNG in light theme,
Download CSV, Copy link) that DS 15 section 2 specifies and the built frame lacks.

**EChart (exists; extend registry on demand).** Register `ScatterChart` with CH-15 and `SankeyChart` only with CH-32,
each in its own dynamic chunk so routes without them do not pay the bytes (budget 170 KB gzip).

**ChartLegend.** Extract the built legend from `ChartFrame`:
```ts
interface LegendItem { id: string; name: string; role: SeriesRole; swatch: 'dot' | 'line' | 'marker'; pressed: boolean }
interface ChartLegendProps { title: string; items: readonly LegendItem[]; onToggle?: (id: string) => void }
```

**RateTooltip (formatter helper).** One function for every rate tooltip row:
```ts
interface RateTipInput { name: string; value: number | null; k: number | null; n: number; prompts?: number;
  band: Interval | null; thin: boolean; pooledWeeks?: number }
function rateTipRow(input: RateTipInput, t: Translator): string; // escaped plain text
```

**SmallSampleMarker.** The R2 rendering in three forms:
```ts
interface SmallSampleProps { answers: number; form: 'text' | 'cell' | 'point'; label?: string }
// text: "3 answers" tertiary; cell: hatched block with "3 ans"; point: series item style { hollow, 5 px, no band }
```

**Rate band series (exists: `rateBandOption`).** Keep; add `previous?: readonly (number | null)[]` drawn as the
reference dashed series, and `boundaries?: readonly { at: string; label: string }[]` rendered as `markLine`.

**SmallMultiples.**
```ts
interface SmallMultiplesProps { title: string; meta: string; footnote: ReactNode; categories: readonly string[];
  panels: readonly { id: string; name: string; role: SeriesRole; points: readonly (RateBandPoint | null)[];
    previous?: readonly (number | null)[] }[];
  boundaries?: readonly { at: string; label: string }[]; height: 140 | 180; summary: string; status: ... }
```
One shared `rateCeiling`, `echarts.connect` for the crosshair, one Table view for all panels.

**SparklineCell (exists).** Add `kind: 'rate' | 'count' | 'rank'` presets (rate: `minSpan` 0.2; rank: inverted
fixed 1 to 20) and `tooltipRows` (last 7 values with dates, DS 15 section 9).

**BarList.**
```ts
interface BarListRow { id: string; label: string; value: number; valueText: string; context?: string;
  emphasis: 'own' | 'neutral' | 'scale'; scaleToken?: string; badge?: ReactNode; delta?: ReactNode;
  href?: string; accessibleText: string }
interface BarListProps { mode: 'comparison' | 'distribution'; rows: readonly BarListRow[]; max?: number;
  showAllHref?: string; empty?: ReactNode }
```

**StackedShareBar** (the inventory's `OutcomeMixBar`, made generic for CH-03, CH-16, CH-25, CH-28).
```ts
interface ShareSegment { id: string; name: string; share: number | null; count: number; colorToken: string }
interface StackedShareBarProps { rows: readonly { id: string; label: ReactNode; total: number;
  segments: readonly ShareSegment[]; insufficient?: number }[]; denominatorLabel: string; patterns: boolean }
```
Renders the bars and the legend `SimpleTable` (the alternative).

**HeatmapGrid** (CH-04, CH-11, CH-12, CH-20).
```ts
interface HeatCell { value: number | null; answers: number; state: 'ok' | 'insufficient' | 'none';
  text: string; tip: string; href?: string }
interface HeatmapGridProps { caption: string; rowHeader: string; columns: readonly { id: string; label: ReactNode }[];
  rows: readonly { id: string; label: ReactNode; cells: readonly HeatCell[]; children?: ...; href?: string }[];
  scale: 'sequential' | 'diverging'; bins: readonly number[]; boundaries?: readonly number[] /* column indexes */ }
```
A real `table`; cell text only when the cell is at least 36 px wide; bins key below.

**IntervalBar** (CH-09, CH-10).
```ts
interface IntervalRow { id: string; label: ReactNode; estimate: number; low: number; high: number;
  previous?: number; current?: number; detectable: boolean | null; tone: 'positive' | 'negative' | 'neutral';
  text: string }
interface IntervalBarProps { rows: readonly IntervalRow[]; form: 'diverging' | 'dumbbell'; domain: [number, number] }
```

**StepBars** (CH-30, CH-36).
```ts
interface Step { id: string; label: string; count: number; ofPrevious: string | null; emphasis: 'own' | 'neutral' }
interface StepBarsProps { groups: readonly { id: string; label: ReactNode; steps: readonly Step[] }[]; scaleMax: number;
  footnote: string }
```

**ChangeSummary** (CH-37): `facts: readonly Fact[]` where `Fact` is a tagged union of the five templates with their
counts and evidence links; the component only renders, the fact list is built and tested in a pure
`change-summary-model.ts`.

**Boundary layer.** `boundaryMarkLines(boundaries, tokens)` in `lib/charts`, used by every time chart (1 px dashed
`foreground-muted`, `type-micro` label).

## 7. Build order

**Wave 0: the layouts platform package (P-LAYOUTS, section 9.1).** Backend `core.layouts` table, the five layout
routes, `layouts:manage`, audit entries; contracts move from `apps/web/src/lib/layouts` to `packages/contracts`; web
`features/layouts` (provider, grid with dnd-kit, card frame toolbar, catalog dialog, options popover, number catalog,
save bar, presets menu, undo). It can run in parallel with wave 1 charts: a card component takes
`{ options, width, mode }` and the page scope, and does not know about layouts.

**Wave 1: existing data only (no backend change).** Shared: `ChartFrame` html mode and overflow menu, `BarList`,
`StackedShareBar`, `HeatmapGrid`, `SmallMultiples`, `SmallSampleMarker`, `rateTipRow`, `StepBars`,
`ChangeSummary`. Charts: CH-01, CH-02, CH-03, CH-04 and CH-40, CH-05, CH-07, CH-08, CH-11, CH-14, CH-16, CH-17,
CH-36, CH-37 (engine and source facts), CH-41, CH-43, CH-44, CH-46. Cards: every wave 1 key of section 9.4.
With these, the default layout ships complete except CH-06 (replaced by `ai.by_engine` until N3), and the Topics
tab and drawer get the per-engine views of section 10.

**Wave 2: small backend additions N1, N2, N3, N5, N6, N9, N13, N14 (and optional N4, N7, N10).** Shared:
`IntervalBar`, boundary layer, `ScatterChart` registration. Charts: CH-06, CH-09, CH-10, CH-12, CH-13, CH-15, CH-18,
CH-19, CH-20, CH-21, CH-22, CH-23, CH-33, CH-35, CH-38, CH-42, CH-45.

**Wave 3: slice data and design reviews.** S2: CH-24, CH-25, CH-27, CH-39. S3: intervals from the API replace the
client ones in CH-01, CH-09, CH-10, CH-42 (no shape change). N6 and doc 19 diversity: CH-26. N11: CH-28. N3 with
pooling: CH-29. Ph 12: CH-30. S4 links: CH-31. Design review and N8: CH-32, CH-34.

## 8. Catalogue index of the topic charts (CH-40 to CH-46)

The topic charts are specified in section 10.2. Their place in the ranked list of 4.1 (same reading of the Rank
column as the second-pass table):

| Rank | ID | Name | Pages | Type | OV | Data | Size | Wave |
|---|---|---|---|---|---|---|---|---|
| 4.2 | CH-40 | Topic performance by engine (full matrix) | Overview, Topics tab heat-map view | Heat-map table with tree rows | catalog (default as CH-04) | E | M | 1 |
| 4.4 | CH-43 | Where engines disagree, by topic | Overview, topic drawer | Range dot plot | catalog | E | M | 1 |
| 4.6 | CH-41 | Strongest and weakest topics per engine | Overview | Paired `BarList` | catalog | E | S | 1 |
| 4.8 | CH-42 | Topics gaining or losing, by engine | Overview, Topics tab | Diverging interval bars | catalog | N2 or two reads | M | 2 |
| 6.5 | CH-45 | Topic trends by engine (trellis) | Overview, topic drawer | Small multiples grid | catalog | E | M | 2 |
| 9.7 | CH-44 | Named by one engine, not another | Overview, topic drawer | Table of engine pairs | catalog | E | S | 1 |
| 13.5 | CH-46 | What each topic adds to the overall rate | Overview | `BarList` in points | catalog | E | S | 1 |

In all, the catalogue has 46 charts (CH-01 to CH-46).

## 9. Customization: the Overview as a customizable dashboard

The Overview follows the layout design (`docs/superpowers/specs/2026-09-30-layout-customization-design.md`, called
"layout spec" below) and the preview's behaviour (`apps/web/design-preview/customize.js`). The parts that go
beyond the layout spec are marked **Proposed** and listed in section 13 for the owner, because the layout spec
decided against them or left them out.

### 9.1 What exists, and what is platform versus Overview work

| Piece | State today | Package |
|---|---|---|
| Layout document, widths, limits (12 cards, 6 numbers, 16 KB) | BUILT as pure TypeScript: `apps/web/src/lib/layouts/types.ts` | Platform |
| Catalog of card types and numbers | BUILT for `overview` (14 card types) and `inspector.keyword` (6 drawer cards): `catalog.ts`. `ScreenKey` has no `ai_overview` yet | Platform (the type and screen list); Overview (its entries) |
| Sanitize, resolve (personal, then team, then built-in), availability, row packing, draft edits (add, hide, move, width, option, number add, remove, move), change count | BUILT and tested: `sanitize.ts`, `resolve.ts`, `availability.ts`, `rows.ts`, `draft.ts`, `layouts.test.ts`, `retired.test.ts` | Platform |
| Use in the app | NONE: nothing outside `lib/layouts` imports it; the project Overview route only redirects (`app/[workspace]/[project]/page.tsx`) | Platform |
| Customize mode UI (toolbar, catalog dialog, options popover, Move menu, number catalog, save bar, discard and team-default confirmations, keyboard reorder, live announcements) | PREVIEW ONLY: `design-preview/customize.js` (1,331 lines, plain DOM, browser storage) on the project Overview and the keyword drawer | Platform (React in `features/layouts`) |
| Drag and drop library | NONE: `@dnd-kit` is not a dependency; the preview uses its own pointer code | Platform |
| Layouts API, `core.layouts` table, `layouts:manage`, audit entries | SPECIFIED (layout spec section 9, doc 19 rows at lines 1708 to 1712); absent from `backend/openapi/v1.json` and the backend | Platform |
| Contracts in `packages/contracts` (shared with the API's key validation) | NOT MOVED: still in `apps/web/src/lib/layouts` | Platform |
| Presets, undo and redo, draft history | NOT SPECIFIED, not in the preview | Platform (**Proposed**) |
| Rankings, SEO and page performance dashboards | Not customizable in the preview or the app; `rankings` and `pages` are screen keys of the layout spec with a numbers zone only | Later screens on the same platform |
| AI Overview catalog entries, numbers, presets, card components | NONE | Overview |

The platform package is built once and serves the project Overview, the AI Overview, the number strips of the
table pages (`prompts`, `citations`, `sources`, `rankings`, `pages`) and the drawers (`inspector.keyword`,
`inspector.prompt`, `inspector.topic` (new key)). Overview work is the `ai_overview` screen definition, its catalog
entries, its card components and its presets.

### 9.2 Screen definition

```ts
// in packages/contracts/src/layouts/catalog.ts once moved
ai_overview: {
  key: 'ai_overview',
  title: 'AI visibility',
  zones: { numbers: true, cards: true, widths: true },
  builtin: PRESETS.ai_overview.default,          // section 9.5
  presets: ['default', 'executive', 'seo_analyst', 'competitive', 'topic_owner'],   // Proposed field
}
```

`ScreenKey` gains `ai_overview` and `inspector.topic` (and `inspector.prompt` when the prompt drawer becomes
customizable). Limits stay those of the layout spec: 12 cards, 6 numbers, 16 KB. The catalog below has more than 12
card types; a layout chooses up to 12.

### 9.3 Number catalog (`ai_overview`)

Every AI number is for one engine (layout spec 5.3); adding one asks which engine. Each keeps its context line
(counts), which cannot be turned off.

| Metric key | Label | Per engine | Context line | Data | Wave |
|---|---|---|---|---|---|
| `ai.prompts_in_scope` (**new registry key**, doc 16 section 2.1) | Prompts | no | "in 13 topics" | prompt rows | 1 |
| `ai.valid_answers` (**new registry key**) | Valid answers | yes | "of 1,862 answers, 62 not valid" | `n_observations`, denominators | 1 |
| `ai.mention_rate` | Mention rate | yes | "612 of 1,800 answers"; secondary "Cited 21% . SOV 27%" | prompt rows | 1 |
| `ai.citation_rate` | Citation rate | yes | "378 of 1,800 answers" | prompt rows | 1 |
| `ai.mention_and_citation_rate` | Named and cited | yes | "301 of 1,800 answers" | `outcomes.mentioned_and_cited` | 1 |
| `ai.share_of_voice` | Share of voice | yes | "of 1,412 answers naming a tracked brand" | entity cells | 1 |
| `ai.citation_share` | Own citation share | yes | "1,676 of 18,420 citation units" | `sources/domains` `meta.by_role` | 1 |
| `ai.fanout_presence_rate` | Fan-out presence | yes (ChatGPT only; other engines say "Not exposed") | "96 of 600 answers" | `fanout-queries` meta | 1 |
| `ai.recommendation_rate` | Recommendation rate | yes | counts and classification coverage | S2 | 3 |

New registry keys must be added to doc 16 section 2.1 before they ship (doc 16: "If a metric is not in these two
documents, it does not ship").

### 9.4 Card catalog

Widths: T third, H half, 2T two thirds, F full; the first listed is the default; min and max are the narrowest and
widest listed. Options are enums (layout spec, first release), project agnostic, and shown in the Options popover.
"Window" options, where present, are `page` (follows the page's date range, the default), `4w` and `13w` (at most 92
days, the API cap); a card on its own window says so in its meta line and its compare follows that window
(**Proposed**). Identity: the option that makes two instances of a reusable type different (one per value). Screens:
AO `ai_overview`, OV project `overview`, IT `inspector.topic` (one column, no widths), IP `inspector.prompt`.

| Key (status) | Name | Chart | Group | Widths | Max inst. (identity) | Options and defaults | Data | Screens | Wave |
|---|---|---|---|---|---|---|---|---|---|
| `ai.change_summary` (new) | What changed | CH-37 | activity | F, 2T | 1 | Facts: 3 or 5 (5) | two summary reads, sources compare | AO, OV | 1 |
| `ai.rate_trend_by_engine` (new) | Rates by engine over time | CH-01 | ai | 2T, F | 3 (metric) | Metric: mention, citation, share of voice (mention); Window (page) | `include=series` | AO, OV | 1 |
| `ai.mention_trend` (existing) | Mention rate trend, one engine | CH-01 single panel | ai | H, 2T, F | 4 (engine) | Engine (ChatGPT) | `include=series` | AO, OV | 1 |
| `ai.by_engine` (existing; add AO) | AI by engine | table (A1, A2, A3, A7 per engine, equal-weight line) | ai | H, 2T, F | 1 | none | prompt rows | AO, OV | 1 |
| `ai.outcome_mix` (new) | Named and cited | CH-03 | ai | T, H | 1 | none | `outcomes` | AO, OV, IT, IP | 1 |
| `ai.answer_funnel` (new) | From answer to citation | CH-36 | ai | T, H | 1 | none | prompt rows | AO, IT, IP | 1 |
| `ai.share_of_voice` (new) | Share of voice, one engine | CH-02 | ai | H, T | 4 (engine) | Engine (ChatGPT); Rows: 5, 10 (10) | `include=entities` | AO, IT | 1 |
| `competitors.share_of_voice` (existing) | Share of voice (search or AI) | CH-02 | cross | T, H | 1 | Channel (search) | as built | OV | 1 |
| `ai.competitor_trend` (new) | You vs top competitors | CH-06 | ai | H, 2T, F | 4 (engine) | Engine (ChatGPT); Competitors: 3, 5 (3) | N3 | AO, IT | 2 |
| `ai.competitor_table` (new) | Competitors by engine | table: entity rows, engine columns | ai | H, 2T, F | 1 | Metric: mention, share of voice (mention); Rows: 5, 10 (5) | `include=entities` | AO | 1 |
| `ai.lost_to_competitor` (new) | Prompts lost to a competitor | CH-05 | ai | T, H | 4 (engine) | Engine (ChatGPT); Rows: 5, 10 (5) | `include=entities` | AO, IT | 1 |
| `ai.co_mentions` (new) | Who we are named with | CH-38 | ai | H, 2T | 4 (engine) | Engine (ChatGPT) | N14 | AO | 2 |
| `ai.sov_over_time` (new) | Share of voice over time | CH-19 | ai | 2T, H, F | 4 (engine) | Engine (ChatGPT) | N3 | AO | 2 |
| `ai.sov_rank` (new) | Share of voice rank | CH-29 | ai | H, 2T | 4 (engine) | Engine (ChatGPT) | N3 | AO | 3 |
| `ai.topic_heatmap` (new) | Topics by engine | CH-04 (compact CH-40) | ai | 2T, F | 3 (metric) | Metric: mention, citation, share of voice (mention); Rows: 5, 10, 20 (10); Level: top, all (top); Sort: prompts, rate, gap (prompts) | topic rows | AO, OV | 1 |
| `ai.topic_extremes` (new) | Strongest and weakest topics | CH-41 | ai | H, T, 2T | 3 (metric) | Metric (mention); Rows: 3, 5 (5) | topic rows | AO | 1 |
| `ai.topic_movers` (new) | Topics gaining or losing | CH-42 | ai | H, 2T | 3 (metric) | Metric (mention); Direction: both, up, down (both); Rows: 5, 10 (5) | N2 or two reads | AO | 2 |
| `ai.topic_engine_gap` (new) | Where engines disagree | CH-43 | ai | 2T, H, F | 3 (metric) | Metric (mention); Rows: 5, 10 (10) | topic rows | AO, IT | 1 |
| `ai.engine_disagreement` (new) | Named by one engine, not another | CH-44 | ai | H, 2T | 1 | Rows: 5, 10 (5) | prompt rows | AO, IT | 1 |
| `ai.topic_trends` (new) | Topic trends by engine | CH-45 | ai | F, 2T | 3 (metric) | Metric (mention); Topics: 3, 6 (6) | topic rows `series` | AO | 2 |
| `ai.topic_small_multiples` (new) | Topic trends, one engine | CH-33 | ai | 2T, F | 4 (engine) | Engine (ChatGPT); Topics: 6, 9 (6) | topic rows `series` | AO | 2 |
| `ai.topic_contribution` (new) | What each topic adds | CH-46 | ai | H, 2T | 4 (engine) | Engine (ChatGPT); View: level, change (level) | prompt rows | AO | 1 (change view 2) |
| `ai.prompt_heatmap` (new) | Prompts by engine | CH-11 | ai | 2T, F | 1 | Rows: 10, 20 (10); Sort: most named, least named (least) | prompt rows | AO, IT | 1 |
| `ai.top_prompts` (new) | Prompts to look at | list | ai | H, T | 1 | Show: most named, least named, largest change (least named); Rows: 5, 10 (5) | prompt rows | AO, IT | 1 |
| `ai.prompt_movers` (new) | Prompt movers | CH-09 | ai | H, 2T | 4 (engine) | Engine (ChatGPT); Direction (both); Rows: 5, 8 (5) | N2 or two reads | AO, IT | 2 |
| `ai.period_comparison` (new) | This period vs the last | CH-10 | ai | T, H | 3 (metric) | Metric (mention) | N2 or two reads | AO | 2 |
| `ai.change_waterfall` (new) | What moved the rate | CH-13 | ai | H, 2T | 4 (engine) | Engine (ChatGPT); Metric: mention, citation (mention) | N2 or two reads | AO | 2 |
| `ai.engine_agreement` (new) | Engine agreement | CH-18 | ai | T, H | 1 | none | prompt rows | AO | 2 |
| `ai.citation_vs_mention` (new) | Cited as often as named? | CH-15 | ai | H, 2T | 4 (engine) | Engine (ChatGPT) | topic rows | AO | 2 |
| `ai.country_breakdown` (new) | By country | CH-23 | ai | H, 2T | 3 (metric) | Metric (mention) | one read per country or N4 | AO (available only with 2 or more countries) | 2 |
| `sources.top_domains` (new) | Top cited domains | CH-07 | ai | T, H | 1 | Role: all, third party, competitor (all); Rows: 5, 8, 10 (8) | `sources/domains` | AO, OV, IT | 1 |
| `sources.own_pages` (new) | Your pages AI engines cite | CH-08 | ai | T, H | 1 | Rows: 5, 8, 10 (8) | `sources/pages` own | AO, OV, IT | 1 |
| `ai.citation_share_by_domain_type` (existing; add AO) | Citation units by source role | CH-16 | ai | T, H | 1 | none | `sources/domains` | AO, OV | 1 |
| `sources.new_lost` (new) | New and lost sources | CH-22 | ai | H, T | 1 | none | compare, N6 | AO | 2 |
| `sources.diversity` (new) | Source diversity | CH-26 | ai | H, 2T | 1 | none | N6 | AO | 3 |
| `ai.fanout_top` (new) | What ChatGPT searched | CH-17 | ai | H, T | 1 | Rows: 5, 10 (5) | `fanout-queries` (requires ChatGPT on) | AO, IT, IP | 1 |
| `ai.opportunities` (new) | AI opportunities | list (W-9) | ai | H, T | 1 | Rows: 4, 8 (4) | prompt rows | AO | 1 |
| `activity.key_changes` (existing; add AO) | Key changes | `ChangeFeed` | activity | H, 2T, F | 1 | Rows: 5, 8 (8) | two reads, N5, N9 | AO, OV | 1 |
| `activity.collection_status` (existing; add AO) | Collection status | text and counts | activity | T, H | 1 | none | `GET {P}/runs`, N5 | AO, OV | 1 |
| `ops.answer_calendar` (new) | Answers collected | CH-20 | activity | H, F | 1 | none | N5 | AO | 2 |
| `ops.answer_status` (new) | Answer status by engine | CH-21 | activity | H, 2T | 1 | none | N5 | AO | 2 |
| `ops.engines` (new) | Engines and schedule | table: engine, on or off, days asked (Mon, Thu), next run, estimated monthly cost | activity | T, H | 1 | none | `GET {P}/engines` | AO | 1 |
| `ops.ai_spend` (new) | AI spend | text and `Meter` against the budget (DS 23 11.2) | activity | T | 1 | none | `GET {W}/budgets/status`, `GET {W}/costs` (requires `costs:read`) | AO, OV | 1 |
| `ai.sample_coverage` (new) | Answers behind the numbers | distribution `BarList`: prompts with 4 or more valid answers per engine, fewer than 4, none; branded excluded count; prompts without a topic | activity | T, H | 1 | none | prompt rows | AO | 1 |
| `ai.alerts` (new, planned) | Alerts | `ChangeFeed` of alert events | activity | H, 2T | 1 | Rows: 5, 8 (5) | alert routes (S4) | AO, OV | 3 |
| `ai.sentiment` (new, planned) | Tone when named | CH-25 | ai | T, H | 1 | none | S2 | AO, IP | 3 |
| `ai.list_position` (new, planned) | Position in ranked lists | CH-24 | ai | T, H | 4 (engine) | Engine (ChatGPT) | S2 | AO, IP | 3 |

Availability (layout spec section 8): a card whose requirement the project lacks (no AI channel, ChatGPT off for
`ai.fanout_top`, one country for `ai.country_breakdown`, no budget for `ops.ai_spend`) is skipped in view and shown as
a placeholder with the reason in customize mode. `ops.ai_spend` is not listed for a person without `costs:read`.
Planned cards are not listed until their data exists (status `active` only).

**Numbers on the table pages.** `prompts`, `citations`, `sources` keep their numbers zone only (layout spec 4): the
Prompts tab offers the numbers of 9.3; Citations offers own citation share, distinct domains, citation units, new
sources; Sources offers the same.

### 9.5 Presets (layouts at 1280, 1024, 768 and 390 px)

A preset is a built-in layout document the person applies to the draft from the "Start from" menu (section 9.6).
It is not a stored named layout, so it stays inside the layout spec's "one layout per person per screen"; the
person saves the result as their layout, or as the team default with `layouts:manage` (**Proposed**: presets).
Rows below are computed with `packRows` (third and half 6 columns, two thirds and full 12 columns from 768 to 1279
px). Below 768 px every preset is one column in its order, display only.

**Default** (the built-in default, section 3.3). Numbers: Prompts, Mention rate ChatGPT, Gemini, AI Mode.

| # | Card | Width | 1280+ row | 768 to 1279 row |
|---|---|---|---|---|
| 1 | `ai.change_summary` | F | 1 | 1 |
| 2 | `ai.rate_trend_by_engine` (mention) | 2T | 2 (8) | 2 (12) |
| 3 | `ai.outcome_mix` | T | 2 (4) | 3 (6) |
| 4 | `sources.top_domains` | T | 3 (4) | 3 (6) |
| 5 | `ai.topic_heatmap` (mention) | 2T | 3 (8) | 4 (12) |
| 6 | `ai.share_of_voice` (ChatGPT) | H | 4 (6) | 5 (6) |
| 7 | `ai.competitor_trend` (ChatGPT); `ai.by_engine` until N3 | H | 4 (6) | 5 (6) |
| 8 | `activity.key_changes` (8) | H | 5 (6) | 6 (6) |
| 9 | `ai.opportunities` (4) | H | 5 (6) | 6 (6) |

No row is left part empty at either width. At 390 px: 9 cards in this order.

**Executive summary** (for a marketing lead: few cards, the story first). Numbers: Mention rate ChatGPT, Gemini, AI
Mode, Share of voice ChatGPT.

| # | Card | Width | 1280+ row | 768 to 1279 row |
|---|---|---|---|---|
| 1 | `ai.change_summary` (3 facts) | F | 1 | 1 |
| 2 | `ai.rate_trend_by_engine` (mention) | F | 2 | 2 |
| 3 | `ai.share_of_voice` (ChatGPT, 5 rows) | H | 3 | 3 |
| 4 | `ai.topic_extremes` (mention, 3 rows) | H | 3 | 3 |
| 5 | `ai.answer_funnel` | H | 4 | 4 |
| 6 | `ai.period_comparison` (mention); `ai.outcome_mix` until N2 | H | 4 | 4 |

**SEO analyst** (pages, sources and citations). Numbers: Prompts, Citation rate ChatGPT, Gemini, AI Mode, Own
citation share ChatGPT.

| # | Card | Width | 1280+ row | 768 to 1279 row |
|---|---|---|---|---|
| 1 | `sources.own_pages` (10) | H | 1 | 1 |
| 2 | `sources.top_domains` (third party, 10) | H | 1 | 1 |
| 3 | `ai.citation_vs_mention` (ChatGPT); `ai.topic_heatmap` (citation) until wave 2 | 2T | 2 (8) | 2 (12) |
| 4 | `ai.citation_share_by_domain_type` | T | 2 (4) | 3 (6) |
| 5 | `ai.fanout_top` (10) | H | 3 (6) | 3 (6) |
| 6 | `ai.prompt_movers` (ChatGPT); `ai.top_prompts` (least named) until N2 | H | 3 (6) | 4 (6) |
| 7 | `ai.opportunities` (8) | H | 4 (6) | 4 (6) |
| 8 | `ai.sample_coverage` | H | 4 (6) | 5 (6) |

The last medium row is half full; the "Add card" slot takes the free half in customize mode.

**Competitive** (share of voice and who wins). Numbers: Prompts, Share of voice ChatGPT, Gemini, AI Mode.

| # | Card | Width | 1280+ row | 768 to 1279 row |
|---|---|---|---|---|
| 1 | `ai.share_of_voice` (ChatGPT) | H | 1 | 1 |
| 2 | `ai.share_of_voice` (Gemini) | H | 1 | 1 |
| 3 | `ai.competitor_trend` (ChatGPT, 3) | F | 2 | 2 |
| 4 | `ai.lost_to_competitor` (ChatGPT) | H | 3 | 3 |
| 5 | `ai.competitor_table` (mention) | H | 3 | 3 |
| 6 | `ai.sov_over_time` (ChatGPT) | 2T | 4 (8) | 4 (12) |
| 7 | `sources.top_domains` (competitor) | T | 4 (4) | 5 (6) |
| 8 | `ai.co_mentions` (ChatGPT) | H | 5 (6) | 5 (6) |

Before wave 2, cards 3, 6 and 8 are replaced by `ai.competitor_table` (share of voice), `ai.topic_heatmap` (share of
voice) and `ai.engine_disagreement`.

**Topic owner** (owner requirement R-09; section 10). Numbers: Prompts, Mention rate ChatGPT, Gemini, AI Mode.

| # | Card | Width | 1280+ row | 768 to 1279 row |
|---|---|---|---|---|
| 1 | `ai.topic_heatmap` (mention, all levels, 20 rows) | F | 1 | 1 |
| 2 | `ai.topic_extremes` (mention) | H | 2 | 2 |
| 3 | `ai.topic_movers` (mention); `ai.topic_contribution` until N2 | H | 2 | 2 |
| 4 | `ai.topic_engine_gap` (mention) | 2T | 3 (8) | 3 (12) |
| 5 | `ai.sample_coverage` | T | 3 (4) | 4 (6) |
| 6 | `ai.topic_trends` (mention, 6) | F | 4 | 5 |
| 7 | `ai.engine_disagreement` | H | 5 (6) | 6 (6) |
| 8 | `ai.topic_contribution` (ChatGPT) | H | 5 (6) | 6 (6) |

At 768 to 1279 px row 4 holds only the coverage card (half empty). It is the one preset with a part-empty medium
row, accepted to keep the wide layout tight. Before wave 2, card 3 is `ai.topic_contribution` and card 8 is
`ai.top_prompts`; card 6 is `ai.topic_heatmap` (citation).

### 9.6 Customize interactions

**Entering and leaving.** As layout spec 5.1: the Customize toggle (768 px and up); a "Customizing" badge by the
title; the save bar pinned to the bottom; card content `inert` (links, hovers, refetching off) while the real data
stays visible; Escape leaves (through "Discard unsaved changes?" when the draft differs); navigation, Back and
closing the window are guarded by the same dialog; focus returns to the Customize button.

**Card toolbar** (a labelled group in the card header, every control a tab stop, 32 px, 44 px on touch):
drag handle (`GripVertical`, button "Reorder <card>"), Width (`Select` sm with the card's allowed widths only),
Options (`Settings2`, only when the type has options), Hide (`EyeOff`, tooltip "Hide card. Add it back from the
catalog"), More (`EllipsisVertical`: Move earlier, Move later, Move to start, Move to end, Duplicate with the next
free identity value **Proposed**).

**Drag and drop (pointer and touch)** with `@dnd-kit/core` and `@dnd-kit/sortable`, imported only by the layout grid
and the number strip:
- `DndContext` with `PointerSensor` (activation distance 4 px, so a click on the handle is not a drag),
  `TouchSensor` (delay 200 ms, tolerance 5 px, for tablets) and `KeyboardSensor` with a coordinate getter that
  follows the packed rows.
- `SortableContext` with `rectSortingStrategy` for cards, `horizontalListSortingStrategy` for numbers.
- The dragged card stays in place at 50% opacity; a `DragOverlay` copy follows the pointer with `shadow-drag`; a 2 px
  `primary` line midway in the gap shows the drop place (as the preview). The empty part of a row is a drop target
  ("Empty space in row 3").
- Collision detection `closestCenter`; auto scroll near the viewport edges; dropping on the card's own place moves
  nothing; reduced motion turns off the transforms (cards jump).
- Other cards move by `transform` only during the drag, so card contents do not re-render (layout spec 10).

**Keyboard reorder** (WCAG 2.1.1 and 2.5.7). On the drag handle: Space or Enter picks the card up; Left and Right
move one place earlier or later in order; Up and Down move to the card above or below in the packed rows (the same
column position, or the nearest); Home and End move to the start and the end; Space or Enter drops; Escape puts it
back. Moving focus away drops it where it is. Every step is announced in one polite live region with dnd-kit's
`announcements` set to our words: "Rank 2 of 9: Topics by engine, row 3, left". At an end: "Topics by engine is
already first". The handle's instructions are its description (read once, not on every card). The More menu is the
single-pointer and screen-reader path for the same moves.

**Size.** The layout spec decided preset widths and no free resize (decision 4), so the size control is the Width
select. **Proposed** as a pointer convenience: a resize grip on the right edge of a card in customize mode that
snaps to the card's allowed widths while dragging (preview of the new width as a dashed outline, the width name in a
tooltip) and writes the same `setCardWidth`; the Width select stays the keyboard and assistive path. Heights are not
resizable (they belong to the card type).

**Options popover.** One radio group per option (`fieldset` with a legend); the change shows at once in the card;
an identity value another instance of the type already uses is disabled with "Already on this page" (as
`setCardOption` refuses it). Options never name a topic, a competitor or a keyword (layout spec 6.1): the page scope
gives the topic.

**Catalog dialog** (720 px, layout spec 5.4). Search field; groups AI, Topics, Competitors, Sources, Activity (a
**Proposed** finer grouping of the `ai` group for this screen, 40 or more types); each entry: a small schematic, the
name, the one-sentence question, the data note ("needs 2 countries"), and its state: Add, Added (single use), Add
another (reusable, with the next free identity value), Not available here (reason), New (30 days). Adding appends
the card at the clicked slot or after the last card, closes the dialog, scrolls the card into view and focuses it.

**Number catalog.** "Add number" slot after the last number opens a list grouped by metric with the engine chosen in
the same step ("Mention rate: ChatGPT, Gemini, AI Mode"); combinations already shown are marked; at 6 numbers the slot
is gone and the list says "6 numbers is the most a strip shows".

**Empty slot placeholders.** After the last card an "Add card" slot takes the free columns of the last row
(`trailingSpace`), or half a row when the row is full; it reads "Add card. Opens the card catalog". The empty part of
any row is a dashed drop zone in customize mode, and clicking it opens the catalog at that index. A layout with no
cards shows only the slot and "This page has no cards. Add one from the catalog." A card unavailable in this project
is a placeholder with the reason, movable and hideable.

**Undo and redo** (**Proposed**; not in the layout spec or the preview). The draft reducer keeps a history of up to
50 drafts. Ctrl or Cmd plus Z undoes, Shift plus Ctrl or Cmd plus Z redoes, while focus is inside the page in
customize mode (not in a text field). The save bar gains Undo and Redo icon buttons with the next step in their
tooltip ("Undo: hide Top cited domains"). Hide also raises a toast "Top cited domains hidden" with an Undo action.
Every undo is announced. The history ends with the mode.

**Start from a preset** (**Proposed**). A "Start from" menu in the save bar: Default, Executive summary, SEO
analyst, Competitive, Topic owner, and "Team default" when one exists. Choosing one replaces the draft (a change like
Reset, counted, undoable, nothing stored until Save). No confirmation, because Undo restores the draft.

**Save bar** (`SaveBar`, layout spec 5.6): "3 changes . Applies to your view, in every project", then Undo, Redo,
Start from, Reset to default, Cancel, Save layout. The Save button's menu holds "Save as team default" and "Remove
team default" for `layouts:manage`, each with the confirmation of layout spec 5.6. Save failures keep the draft;
`412` opens "This layout was changed somewhere else." with "Keep mine" and "Load the other version". A read
failure shows the built-in default with "Your layout could not be loaded. Showing the default." and disables
Customize.

**Discard confirm.** "Discard unsaved changes?" (400 px, DS 16 section 4.3) with "Keep editing" (default focus) and
"Discard". Shown on Cancel, Escape and navigation when the change count is above 0.

### 9.7 Per-user and shared layouts

As layout spec 6.3 and 9: personal layout, else team default, else built-in default, one per person per
workspace per screen, used in every project. A team default needs `layouts:manage` (owner, admin) and writes
`ops.audit_logs`. "Your layout differs from the team default" shows in customize mode with Reset when a team default
exists.

## 10. Topics by engine (owner requirement R-09)

How each topic performs, per engine (ChatGPT, Gemini, AI Mode; AI Overview when S2 lands), as a first class view on
the Overview, the Topics tab and the topic drawer, with comparison across engines, trend over time and drill-down to
the prompts.

### 10.1 What the data gives today

`GET {P}/ai/prompts-summary?include=series,entities` returns, per topic row (`term_id`, `name`, `prompt_count`,
`last_observed_at`, `last_valid_at`) and per engine:

| Need | Field | Weighting |
|---|---|---|
| Mention rate | `engines[].mentioned` | prompt weighted: `numerator` = sum of the prompts' rates, `denominator` = prompts with a valid answer, `pooled` = answers |
| Citation rate | `engines[].cited` | same |
| Outcome mix | `engines[].outcomes.*` | same |
| Share of voice | `engines[].share_of_voice` | per answer (answers that name a tracked brand) |
| Per entity | `engines[].entities[]` (`mentioned` prompt weighted, `share_of_voice`) | as above |
| Weekly trend | `engines[].series[]` (`mentioned`, `cited`, `share_of_voice`), at most 14 weeks | per week prompt weighted; `pooled` adds up |
| Tree levels | a row for every term with prompts in scope, rolled up by term path | a prompt in two topics counts in both |
| Prompts behind a cell | the prompt rows of the same response (`topic_term_ids`) | |

Not given: the previous period (N2 or a second read), entities per week (N3), intervals (`ci` null until S3; the
client computes pooled Wilson, R8).

**N15 (optional, wave 2): topic-only reads.** `rows=topics` on the summary drops the prompt rows when a card needs
topic rows only (CH-40, CH-41, CH-45), so a project with 1,000 prompts does not ship them to the Overview. No separate
topic x engine route is needed: the summary already is that breakdown. doc 19's
`ai/metrics/{metric}/breakdown?dimension=topic` can wait for the metric routes.

### 10.2 Charts

**CH-40 Topic performance by engine (full matrix)**
- What: the full form of CH-04. Rows are the topic tree (top level, chevrons open subtopics in place, at most 3
  levels; "Prompts without a topic" as the last row), columns are engines in fixed order then "avg of 3". A metric
  switcher picks Mention, Citation or Share of voice, or "All three" (three narrow sub-columns per engine:
  M, C, SOV).
- Cells: value on `seq-*` bins with the number printed; below it in `type-label` "17 prompts" (rates) or "412
  answers" (SOV); hatched "3 ans" under 4 valid answers; "n/a" with no answers. The tooltip names topic, engine,
  metric, value, "prompt weighted over 17 prompts, 64 of 136 answers", the interval and the last valid answer.
- Sorting: by prompts, by one engine's value, or by the engine gap (CH-43). Columns are sortable buttons in the
  header.
- Drill: a cell opens a popover with the 5 prompts that weigh most on that cell (lowest and highest rates) with "k
  of n" each and "Show all 17 in Prompts" (`/ai/prompts?tab=prompts&topic=<term>&eng=<engine>&sort=<metric>`).
- Honesty: the footnote says that topic rows overlap; the "avg of 3" column only appears with 2 or more engines and
  is labelled equal weight.
- Data: E (topic rows). Pages: Overview (`ai.topic_heatmap` with Level: all), Topics tab heat-map view.
- Library: HTML (`HeatmapGrid` with tree rows). Size M.

**CH-41 Strongest and weakest topics per engine**
- What: per engine, the 5 topics with the highest and the 5 with the lowest rate, as two `BarList`s side by side
  (one engine per column at 1280; engines stacked below 768). Only topics with 4 or more valid answers and 3 or more
  prompts qualify; the rest are counted ("6 topics have too few answers").
- Why: the question "where do we win and lose on Gemini" in one glance, each bar with its counts.
- Data: E. Library: HTML (`BarList`). Size S.

**CH-42 Topics gaining or losing, by engine**
- What: diverging interval bars of each topic's change in points vs the previous window, per engine; only detectable
  moves are coloured and listed first; the others fold into "11 topics moved within normal variation".
- Interval: until S3, the unpaired difference on the topic's pooled answer counts, labelled "unpaired, pooled
  counts"; the topic's prompt set can differ between windows, so the row shows "same 17 prompts" or "15 of 17 prompts
  in both windows".
- Drill: a row opens CH-13 (waterfall) for that topic and engine in the topic drawer.
- Data: N2 or a second read. Library: HTML (`IntervalBar`). Size M.

**CH-43 Where engines disagree, by topic**
- What: a range dot plot. One row per topic, one dot per engine (engine colour and marker shape) on a shared 0 to
  100% axis, a 2 px `border` line from the lowest to the highest dot, rows sorted by the spread. A thin dot is
  hollow.
- Why: "ChatGPT names us in 47% of CRM pricing answers, AI Mode in 8%" is an action (content for that engine's
  sources). The spread is shown as points, never as a score.
- Tooltip: the three values with counts and the spread in points; "spread within normal variation" when the
  interval of the highest minus the lowest includes 0.
- Data: E. Library: HTML/SVG in `ChartFrame` html mode. Size M.

**CH-44 Named by one engine, not another**
- What: a table of engine pairs by topic: for each topic, the prompts where engine A named us in at least one valid
  answer and engine B in none of at least 4 valid answers, for each ordered pair ("ChatGPT yes, Gemini no: 6
  prompts"). Cells link to those prompts.
- Why: the per-prompt evidence behind CH-43.
- Data: E (prompt rows grouped by `topic_term_ids`). Library: HTML table. Size S.

**CH-45 Topic trends by engine (trellis)**
- What: small multiples in a grid, rows = topics (top 6 by prompts, option 3 or 6), columns = engines, 140 px each,
  shared y axis and x axis across the whole grid, synced crosshair along a row. Each panel is the weekly rate with
  the trailing 4-week pooled point and band (R7: topic points pool 4 weeks when fewer than 10 prompts have a valid
  answer that week, which is the usual case for a topic), hollow when thin.
- Why: shows whether a topic moves on all engines (a content change) or on one (an engine change).
- Data: E (topic rows `series`). Library: `SmallMultiples` (ECharts line). Size M.

**CH-46 What each topic adds to the overall rate**
- What: per engine, a `BarList` of each top-level topic's share of the project's prompt-weighted mention numerator:
  `sum of the rates of the topic's prompts / prompts in scope`, in points ("CRM for startups adds 3.2 points of the
  34%"). Change view (wave 2): each topic's part of the change between windows, computed over prompts common to both
  windows, as CH-13.
- Honesty: a prompt in two topics counts in both, so the bars can add up to more than the total; the footnote gives
  the sum ("bars add up to 38.1 points for a rate of 34.0%: 31 prompts are in two topics"). Prompts without a topic
  have their own bar.
- Data: E (prompt rows with `topic_term_ids`). Library: HTML (`BarList`). Size S.

### 10.3 On the Overview

The default layout keeps `ai.topic_heatmap` (CH-04, two thirds). The "Topic owner" preset (9.5) makes topics the
page. Every topic card is in the catalog (9.4): `ai.topic_heatmap` (CH-04 and CH-40), `ai.topic_extremes` (CH-41),
`ai.topic_movers` (CH-42), `ai.topic_engine_gap` (CH-43), `ai.engine_disagreement` (CH-44), `ai.topic_trends`
(CH-45), `ai.topic_small_multiples` (CH-33), `ai.topic_contribution` (CH-46). The page's Topic filter narrows every
card to a subtree, so a topic owner can save a layout and set the filter (the URL carries the topic, the layout does
not).

### 10.4 Topics tab (`/ai/prompts?tab=topics`)

- A view switch in the toolbar: Table (today's indented tree, DS 24 9.5) and Heat-map (CH-40 with the same rows,
  filters and sort), written to the URL as `view=heatmap`.
- The table gains an "Engine columns" `MetricSwitcher` as on the Prompts tab (Mention, Citation, SOV), so the
  per-engine cells of the tree show the chosen metric, each with its counts in the tooltip and the change in points
  when compare is on (coloured only when detectable).
- A "Spread" column (chooser, priority 3): the gap between the highest and lowest engine for the row, in points,
  from CH-43.
- The strip above stays the numbers zone of the `prompts` screen.

### 10.5 Topic drawer (440 px, `inspect=topic:<term_id>`)

The Overview tab becomes a one-column customizable drawer (`inspector.topic`). Built-in cards, in order:

1. **Performance by engine** (the panel the owner asked for): a `SimpleTable`, rows = engines, columns = Mention,
   Citation, Share of voice; each cell the value, "k of n answers, 17 prompts" below, the change in points when
   compare is on, and a 64 x 16 sparkline of the weekly pooled trend. A cell click opens the Prompts tab of the
   drawer filtered to that engine and sorted by that metric ("the prompts behind this cell").
2. **Trend by engine**: CH-45 for this topic only (one row of three 140 px panels at 440 px they stack as three rows
   of 120 px), with band and boundaries.
3. **Who wins this topic, per engine**: an engine switcher and a `BarList` of mention rate per tracked entity within
   the topic (`entities[].mentioned`, prompt weighted), own first in `chart-1`, then the competitors that score
   above us; the gap to the leader in points, coloured only when detectable; "Lost to" counts (CH-05 for the topic).
4. **Named and cited**: CH-03 for the topic.
5. **Where engines disagree**: CH-44 for the topic, with links to the prompts.
6. Existing: "In search" (keywords of the topic), "Top prompts in this topic".

Tabs keep their spec (Overview, Prompts, Competitors, Related); the Competitors tab gets the full entity by engine
table (mention and SOV with counts).

## 11. Why this beats Nuwtonic's dashboard

Element by element against the studied tool's Dashboard (inventory `nuwtonic-dashboard.md`, study section 3.3).

| Nuwtonic element | What is wrong with it | Our version |
|---|---|---|
| No date range, engine, country or compare control, while tooltips mention a "selected date range" (DB-02) | The reader cannot know what period a number covers | Top bar window and country, filter bar engines, topic, branded and compare, all in the URL; the meta line states the window and the compare window; every card reads the same scope |
| KPI "Detection rate 26.6%" with a Watch pill and a "68.1%" relative chip (DB-01 to DB-03) | Relative change of a rate, thresholds unstated, no n | Mention rate per engine, "612 of 1,800 answers", delta in points, coloured only when detectable, hatched or "3 answers" when small |
| Total mentions 63, from citation URLs (DB-04) | Mixes units with answers | Mentions are answers that name the brand (A1); citation units are separate and labelled (R11) |
| Average position #5.0, "400%" (DB-05) | Undefined position over cited answers only; percent change of a rank | Structured rank only from qualifying ranked lists (CH-24, S2), median with counts; never a percent change |
| Top 3 presence (DB-06) | Top 3 of citation order | Structured top 3 rate (A9) with the share of answers that had a list |
| Visibility score, brand authority score (DB-07, DB-08) | Opaque composites | None (NFR-10). The underlying rates, each with counts |
| Brand sentiment "Positive" (DB-09) | One word, no scale, no n | Four shares per engine with classification coverage (CH-25, S2) |
| "Your Key Scores" bar chart (DB-10) | Repeats the KPIs, red under 50 and green above with no thresholds | Removed. The trend (CH-01) and the funnel (CH-36) show the numbers in context |
| "AI Answer Coverage" donut 51 of 192 (DB-11) | A donut repeating one rate | CH-36 answer funnel per engine (valid, named, named and cited) and CH-03 outcome mix |
| "Mention Split" donut and "Mentions by Brand" bars (DB-12, DB-13), colours re-assigned by rank | Three totals for one share; a brand changes colour between charts | CH-02 share of voice, one formula, one denominator stated; own brand always `chart-1`, competitors by stored colour on every chart |
| "Top 10 Mention Share" and "Top 10 Visibility Share" donut and bar pairs (DB-14, DB-15) | A third total; an invented rank-weighted share | CH-07 top cited domains with source share and units; CH-34 treemap where units partition |
| Pressure index, momentum leader, competitor share, new entrants (DB-16 to DB-20) | Undefined blend; momentum from one day; "competitor share" is 100 minus own | CH-06 competitor trend, CH-19 SOV over time, CH-29 bump chart (pooled), CH-38 co-mentions, CH-05 prompts lost to a competitor; entrants as Competitors > Candidates (S2) |
| "Rank Position vs Mention Share" scatter, "strong rank zone" (DB-26) | Undefined axis, a judgement label | CH-15 citation vs mention by topic with a neutral 45 degree reference; the SEO and AI matrix (CH-31) with stated thresholds and descriptive quadrant labels |
| "Competitor Pressure Ranking" bars sorted ascending (DB-27) | Contradicts its own title | `BarList` sorted by value with counts |
| Competitor table, no sort, inner scroll (DB-28) | No sort, no denominators | `ai.competitor_table` and the Competitors page `DataTable`, sortable, own first, gap coloured only when detectable |
| AI-written "Brand Analysis Brief" with counts like "1 points" and a "risk" that was not one (DB-29 to DB-32) | Unsourced prose | CH-37 "What changed": fixed templates over counted facts, every number linked to evidence, no causal words |
| "Find Gaps" and "Improve Detection" buttons, credits (DB-17, DB-01) | Unexplained, may spend credits | Drill-downs that open the filtered evidence (section 3.7); opportunities with counts; nothing on the Overview spends money |
| One fixed long page, about 5,990 px at 1440 (U-01) | Low density, no choice | A dense, customizable dashboard (section 9): presets for executives, SEO analysts, competitive work and topic owners; per-user and team layouts |
| No trend over time | One snapshot | CH-01, CH-06, CH-19, CH-33, CH-45 with bands, pooled points and event markers (CH-35) |
| No per-engine split | One pooled number | Every rate per engine; equal-weight averages labelled |
| No topic view | none | Section 10: topic by engine matrix, extremes, movers, engine gaps, trends, contribution |
| No sample size, no small-sample handling | Percent of tiny bases | R1 and R2 everywhere: counts on hover and in tables, hollow points, hatched cells |
| No collection health | Errors invisible | Notice region, `activity.collection_status`, CH-20 calendar, CH-21 status by engine |
| Mobile: 11,100 px of stacked cards | | One column in the saved order with compact charts (180 px), list forms for tables, no horizontal scroll |

## 12. Visual quality bar

- **Reference**: the approved preview and the built Keywords and Prompts pages: 208 px sidebar, 20 px gutters, 16 px
  gaps, panels with a 1 px `border`, 8 px radius, 16 px padding, 48 px title rows, `type-*` utilities only, tokens
  only, Lucide icons through `Icon`.
- **Hierarchy**: page title, then the numbers zone (24/32 px values, the only large type on the page), then cards
  whose titles say metric and split ("Mention rate by engine"); one primary colour on the page (`chart-1` for our
  brand); everything else neutral.
- **Key numbers**: value, delta in points next to it (`Delta`, tone from `formatMetricDelta`), context line with the
  counts, "3 answers" in tertiary for small samples, a `MetricInfo` for the definition. Hover shows the counts;
  focus shows the same in the description.
- **Consistent frames**: every chart in `ChartFrame` with the same title row, legend, Table toggle, overflow menu and
  footnote; heights from DS 15 section 2; the same tooltip anatomy everywhere (`rateTipRow`).
- **Interactions**: hover tooltips follow the pointer and can be pinned (click, Escape to unpin); synced crosshairs
  across small multiples; legend toggles; every mark that leads somewhere is a link with a focus ring; row hover is
  instant (DS 21).
- **Motion** (DS 21): only state changes the person caused: popovers and menus 150 ms, dialogs and the inspector 200
  ms, hover colour 100 ms; chart data redraws instantly (`animation: false`); nothing animates on load;
  customize-mode moves use transforms, which reduced motion turns off.
- **Empty states that teach** (reason, then the next step):
  - CH-01 with one week of data: "Trends need at least 2 weeks. Prompts are asked on Mondays and Thursdays; the
    next answers arrive Thu Nov 13."
  - CH-02 with no competitors tracked: "Share of voice compares you with the brands you track. Add competitors in
    Settings > Entities." (with the permission check).
  - CH-04 with no topics: "Group prompts into topics to see where you are strong. Assign topics in Topics &
    Prompts."
  - CH-08 with no owned citations: "No answer cited your pages in these 28 days. 41 prompts name you without citing
    you: see them."
  - CH-17 on Gemini: "Gemini does not show the searches it ran. Fan-out queries come from ChatGPT."
  - Customize with no cards: "This page has no cards. Add one from the catalog."
- **Light and dark**: every token has a dark value; chart colours re-read on theme change; bands 12% and 18%; the
  heat-map bins mirror in dark (`seq-7` lightest); PNG exports always light.
- **No decorative noise**: no icons on cards for decoration, no coloured card headers, no pills, no gradients,
  shadows only on popovers and the drag overlay.

## 13. Open decisions for the owner

1. `POOL_BELOW_PROMPTS` (R7): 10 prompts proposed as the point below which a topic or project weekly point pools 4
   weeks.
2. Heat-map bins (CH-04, CH-40): the 7 fixed bins proposed in CH-04, shared by every rate heat-map so colours mean the
   same on every page.
3. Compare default on the Overview: on ("vs previous period"), as in DS 24 9.2.
4. Whether the Overview adds AI Overview as a strip item once S2 lands (it counts "AI Overviews", it is not asked).
5. Copy this page's wireframe into DS 24 as 9.2a.
6. Layout spec deviations (all **Proposed** in section 9): presets ("Start from" menu, applied to the draft, not
   stored as named layouts); undo and redo; a snapping resize grip as a pointer alternative to the Width select (the
   layout spec decided "no free resize"; the grip only snaps to allowed widths); a per-card Window option (weakens
   R12, "one denominator per page", so each such card states its window in its meta line); Duplicate in the More
   menu; finer catalog groups; the new screen key `inspector.topic`.
7. New metric registry keys `ai.prompts_in_scope` and `ai.valid_answers` (doc 16 section 2.1).
8. `notes:write` permission for chart notes (CH-35, N13): editor and above proposed.
