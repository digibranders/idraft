# WP-36 detailed task plan: Overview cards, topics by engine and prompts

Brief: [docs/ai-visibility/work-packages/WP-36-overview-cards-topics.md](../../ai-visibility/work-packages/WP-36-overview-cards-topics.md).
Branch `ai/wp-36-cards-topics` in `.claude/worktrees/wp-36`, cut from `origin/develop` at `9216e710`. Kind: web. Rows: 13
(CH-04, CH-11, CH-12, CH-15, CH-33, CH-40, CH-41, CH-42, CH-43, CH-44, CH-45, CH-46, WB-TPE-01). Owner requirements R-06 to
R-09: a greater version of the approved dashboard, and topic performance BY ENGINE as a first class view on the Overview.

Specs: [overview-and-charts.md](../../ai-visibility/inventory/overview-and-charts.md) sections 1 (R1 to R12), 4.2, 4.3 (CH-04,
CH-11, CH-12, CH-15, CH-33), 9.4, 9.5, 10 (CH-40 to CH-46), 12; [c2-summary.md](../../ai-visibility/contracts/c2-summary.md)
(C-10, C-11, C-18); [c8-metrics.md](../../ai-visibility/contracts/c8-metrics.md) line 314; the WP-33 plan section 5 (the card
contract) at [2026-11-13-ai-wp-33-overview-shell.md](2026-11-13-ai-wp-33-overview-shell.md); WP-20 design in
[24-page-templates.md](../../design-system/24-page-templates.md) 9.5 "As built" and
[2026-11-13-ai-wp-20-topics-by-engine.md](2026-11-13-ai-wp-20-topics-by-engine.md); DS 15 (charts), DS 17 (states), DS 25 (parts).

Rules for every task (the brief's, repeated so a fresh agent has them in one place): one fresh Sonnet implementer per task,
tests written first and seen red, files edited only with the file tools (never shell heredocs, `sed` or replace scripts); then
one fresh Sonnet reviewer who reads this task, the diff and the guards table, runs the task's targeted tests, breaks each guard
on purpose (section 2.10), and returns PASS or a numbered fix list. At most two subagents of this session at once. One commit per
task, message `WP-36: <task title>`, naming only this package's files, no attribution lines, no dashes. No em-dash or en-dash
in any string, comment, test name or doc line.

## 0. What exists and what was verified

Read in this worktree on 2026-11-14 (planning). Everything below was read in code, not assumed, unless it is in section 9.

| # | Fact | Consequence |
|---|---|---|
| V1 | WP-33 is partly merged: `OverviewProvider`, `useOverview` (scope, engines, `enabledEngines`, `canManageEngines`, `setScope`), the hooks `useOverviewSummary(options?)`, `useOverviewPeriods(options?)`, `useOverviewSources`, `useOverviewFanout`, `useOverviewSchedule`, `buildAggregates`, `cards/registry.ts` (throws for a key that is not an active `ai_overview` type), `cards/pending-card.tsx`, `pending-skeleton.tsx`, the presets, and `src/test/ai-overview-harness.tsx` (`cardInOverview`, `overviewAs`, worlds `fynix`, `cleanstart`, `eventus-security`). NOT merged here: scope bar, numbers zone, notices, `drilldown/drill-links.ts`, export registry, `RefetchBar`, navigation flip. | Cards depend only on what exists. Links use a local fallback (D12). The page-level e2e opens `/ai` by URL |
| V2 | `SummaryOptions = { period?, include?: ('series'\|'entities')[], rows?: 'topics'\|'none' }`. Same options share one query key. `useOverviewPeriods(options)` returns `{ current, previous, paired, settled }`: `previous` is `null` when `scope.compare` is off or the window is before year 2000; `paired` is false while one window is the old scope and the other the new; `settled` is false while any read is loading or refetching. `Read<T>` has `status` (`idle`, `loading`, `ready`, `refetching`, `error`), `data`, `errorId`, `stale`, `refetch`. | The shell already solved paired and settled; a card must treat `!paired` as "no previous" and `!settled` as "refetching" |
| V3 | The strip's read is `useOverviewPeriods()` with default options (both windows, all rows, no include). The summary mock (`mocks/handlers/prompt-answers.ts` line 515) accepts `include=series,entities` and `rows=topics\|none`, not `compare`, `cells` or `total`. | Cards that use default options add no request. Series cards use their own options. No card may ask `compare`, `include=cells` or `include=total` |
| V4 | Topic rows (`TopicSummaryRow`: `term_id`, `name`, `prompt_count`, `engines[]`, `last_valid_at`) carry per engine `mentioned`, `cited`, `share_of_voice`, `outcomes`, and with `include=series` a `series: WeekCells[]` whose points are pooled by the API when fewer than 10 prompts answered that week (`is_pooled`, `pool: { weeks, window, reason, below_prompts }`). A topic cell is prompt weighted: `denominator` is the prompts, `pooled` is `{ successes, trials }` the answers. Prompt rows have whole counts in `numerator` and `denominator` and always pooled weekly points (`prompt_point`). | D-04 (10 prompts) is applied by the API and by the mock (`mocks/prompt-summary.ts` line 278 `few_prompts`). Cards never pool on the client; they read the fields and say it in words (C-18) |
| V5 | `c8-metrics.md` line 314: the topic family and `ai.topic_trends` stay on the summary (`rows=topics`, `include=series`); `breakdown?dimension=topic` is "the same numbers". | The 501 stub of `ai/metrics/{metric}/breakdown` (WP-32) never blocks these cards, and no swap is planned. If WP-32 ever serves a faster read, only `use-topic-reads.ts` changes |
| V6 | WP-20 parts are in `features/prompts/topics-by-engine/`: pure `engine-values.ts` (EngineValue, engineValue, bestEngine, bestWorst, engineGapOf, SAME_RATE), `comparison.ts` (compareEngines), `heat-model.ts`, `leaders.ts`, `series-model.ts` (TopicPoint, enginePoints, averagePoints, poolNote; it imports `@/features/prompts/history-model` for `STALE_AFTER_DAYS`), `topic-rows.ts` and `drill.ts`; tree helpers `features/prompts/topic-tree.ts` and `topicDescendants`, `topicsBelow`, `topicMembers`, `NO_TOPIC` in `features/prompts/prompt-model.ts`. A feature may not import another feature (lint, boundaries policy), so none of these can be imported from `features/ai-overview`. | Section 2.4: reuse lib code, copy the small pure parts locally (T2) with a `shortcut:` comment, and ask for the move (lease L-A) |
| V7 | Shared and importable: `@/lib/rates/rate-model` (`cellFigure`, `averageRate`, `acrossEngines`, `hasRate`, `validAnswers`, `sortByKeys`, `CellMetric`), `@/lib/rates/strip-model` (`engineRates`, `RateReason`), `@/lib/compare/change-model` (`rateChange`, `engineChangeOf`, `averageChangeOf`, `deltaInput`, `RateChange`), `@/lib/compare/compare-model`, `@/lib/stats` (`rateState`, `MIN_OBSERVATIONS`, `isDetectableChange`, `differenceInterval`, `wilsonInterval`), `@/lib/charts/*` (`rateBandOption`, `rate-tip`, `small-sample`, `category-chart` `SeriesRole`), `@/lib/format`, `@/lib/keywords/taxonomy-reads` (`useVocabularies`, `NamedTerm`), `@/lib/routes/paths` (`projectPath`), `@/lib/inspector/placement` (`formatInspectTarget`), `@/lib/csv/csv-write`. Components: `ChartFrame`, `HeatmapGrid` (+ `heatmapCsv`, bins in `heat-bins.ts`), `SmallMultiples` (+ exported `smallMultipleOption`, `rateCeilingOf`), `BarList`, `IntervalBar` (+ `changeDomain`), `TopicEnginePanel`, `PlainTable`, `Delta`, `DeltaCell`, `SampleCount`, `SmallSampleMarker`, `InsufficientPill`, `EngineLogo`, `EngineBadge`, `ChartLegend`, `Banner`, `EmptyState`, `InlineError`, `echart-scatter` (dynamic import only, a test enforces it). `useRateTipWords()` in `components/app/chart`. | The change arithmetic of WP-19 is reused untouched (D15) |
| V8 | `RefetchBar` and `FreshnessIndicator` do not exist in `components/app/status`. `ChartFrame` has `status: 'refetching'` that keeps the chart. | Cards use the frame's refetching state; the page-wide bar is WP-33's |
| V9 | `lib/layouts/catalog.ts` already holds all 11 keys with widths, options and defaults (read lines 270 to 500). Options (sanitized, every key present): `metric` mention\|citation\|share_of_voice; `rows`; `level` top\|all; `sort` prompts\|rate\|gap (heat map) or most_named\|least_named (prompt heat map); `direction` both\|up\|down; `topics` 3\|6 (trends) or 6\|9 (multiples); `engine` chatgpt_web\|gemini_web\|google_ai_mode; `view` level\|change; `show` most_named\|least_named\|largest_change. Built-in layout has `ai.topic_heatmap` (metric mention, rows 10, level top). Presets "Topic owner" uses heat map, extremes, movers, engine gap, trends, engine disagreement, contribution. | No catalog edit is needed for this package |
| V10 | `ai.prompt_movers` (CH-09) is assigned to WP-34 by the WP-34 brief (CH-09 in its goal and step 4) and by the WP-33 plan section 5 item 12. `ai.citation_vs_mention` (CH-15) is assigned to WP-36 by both. | D7, D9 and open question Q1 |
| V11 | `apps/web/src/features/ai-overview/ai-overview-screen.test.tsx` (WP-33) asserts the nine built-in cards are all `[data-slot="pending-card"]`. The moment any package registers a real card in the built-in layout (the heat map is one) that test fails. | Lease L-B, needed in T4 |
| V12 | Playwright runs only `e2e/flows/*.spec.ts` (`testMatch` in `playwright.config.ts`), so the spec path named in the request, `apps/web/e2e/ai-overview-topics.spec.ts`, would never run. | The spec is `apps/web/e2e/flows/ai-overview-topics.spec.ts`, helpers in `apps/web/e2e/support/ai-overview-topics.ts` (D11). `e2e/support.ts` is not touched (it has `signIn`, `expectAccessible`, `waitForContent`) |
| V13 | `setAiSeeded(true)` (Eventus, 92 days) is on by default only in the dev server (`development` plus `NEXT_PUBLIC_API_MOCKING=all`); tests and the e2e build start with Fynix (3 engines, 24 prompts). | Unit tests turn Eventus on; the e2e uses Fynix; the browser pass on port 3212 sees Eventus |

## 1. Goal and what "done" means

Eleven cards of the family `topics` (registry file `cards/topics/index.ts`), each a file `cards/topics/<name>-card.tsx` with a
default export `ComponentType<CardProps>` and a skeleton at its final frame height, plus one reusable component for CH-12 that
has no catalog key. Each shows: the numbers of one engine, never pooled across engines silently, each with its counts; a rate under
4 valid answers is its answer count and never a percent; an unknown is n/a and never 0; colour only for a detectable change; the
topic overlap footnote on every topic card; loading skeleton at the frame height, empty (reason and one action), error (retry),
stale and partial notices, a refetch that keeps the previous data; both themes; 390, 768, 1024 and 1280 px; axe clean; a keyboard
path; every word in `messages/en.json` under `aiOverview.topics`.

## 2. Design

### 2.1 Folder layout (`apps/web/src/features/ai-overview/cards/topics/`, the only folder this package owns)

```text
index.ts                    TOPIC_CARDS (11 keys), named export PromptWeekHeatmapCard (T10)            T1, T3 (skeleton), T10
card-heights.ts             TOPIC_CARD_KEYS, TopicCardKey, CARD_HEIGHT (one height per card)            T1
model-types.ts              TopicMetric, CELL_OF, EngineInfo, TopicNode, TopicData, constants            T1
options.ts                  metricOf, engineOf, countOf, enumOf (option strings to typed values)         T2
topic-nodes.ts              topicDescendants, topicsBelow, topicMembers, buildTopicNodes, leavesOf,      T2
                            topLevelOf, overlapCount, NO_TOPIC
engine-values.ts            local copy of WP-20 engine-values + compareEngines (shortcut, lease L-A)     T2
topic-change.ts             attachPrevious, topicChange, commonPrompts                                    T2
topic-points.ts             local copy of WP-20 TopicPoint, enginePoints, averagePoints, poolNote         T2
engine-role.ts              engineRole(code): SeriesRole (fixed order colours)                            T2
topic-rows.ts               topicEngineRows, orderRows (prompts, rate, gap)                               T2
prompt-rows.ts              promptEngineRows (value per engine, average, last valid)                      T2
use-topic-reads.ts          useTopicSummary(options), useTopicPeriods(options), READ_OPTIONS              T2
links.ts                    topicDrawerHref, promptHref, promptsTabHref, topicsTabHref (fallback D12)     T2
card-frame.tsx              TopicCardFrame, phaseOf, partial and stale notices                            T3
card-skeleton.tsx           topicSkeleton(height)                                                         T3
use-topic-words.ts          useTopicWords (rate tips, percent, answers, prompts, pooled sentence)         T3
topic-footnote.tsx          TopicFootnote (overlap, small sample, weighting, pooling, compare test)       T3
topic-card-test-kit.tsx     fixtures and helpers for the card tests (MetricCell, rows, serveSummary)      T3
<name>-card.tsx, parts/, <name>-model.ts, tests beside them                                            T4 to T11
```

Card files and keys (T1 creates all eleven as stubs that re-export `../pending-card`, so the registry never changes again):

| Key | File | Height | Task |
|---|---|---|---|
| `ai.topic_heatmap` | `topic-heatmap-card.tsx` | 280 | T4 |
| `ai.topic_extremes` | `topic-extremes-card.tsx` | 240 | T5 |
| `ai.topic_engine_gap` | `topic-engine-gap-card.tsx` | 240 | T5 |
| `ai.engine_disagreement` | `engine-disagreement-card.tsx` | 180 | T6 |
| `ai.topic_movers` | `topic-movers-card.tsx` | 240 | T7 |
| `ai.topic_contribution` | `topic-contribution-card.tsx` | 240 | T7 |
| `ai.topic_trends` | `topic-trends-card.tsx` | 280 | T8 |
| `ai.topic_small_multiples` | `topic-small-multiples-card.tsx` | 280 | T8 |
| `ai.prompt_heatmap` | `prompt-heatmap-card.tsx` | 280 | T9 |
| `ai.top_prompts` | `top-prompts-card.tsx` | 180 | T9 |
| `ai.citation_vs_mention` | `citation-vs-mention-card.tsx` | 280 | T11 |
| (no key) CH-12 | `prompt-week/` , `prompt-week-card.tsx` | 280 | T10 |

The heights are the `ChartHeight` values of `ChartFrame` (140, 180, 240, 280) and are a first guess: the implementer of each card
may change its entry in `card-heights.ts` when the finished frame needs it, and then the skeleton follows (one source).

### 2.2 The data seam: which hook gives what

All reads go through `@/features/ai-overview` hooks (`useOverview`, `useOverviewSummary`, `useOverviewPeriods`), wrapped once in
`use-topic-reads.ts`. A card never calls `apiQuery`, never reads the URL, never imports the Prompts page.

| Card | Wrapper | Options passed to the shell hook | Windows | Why |
|---|---|---|---|---|
| heat map, extremes, gap, disagreement, scatter, prompt heat map | `useTopicSummary()` | none (default, shares the strip's current read) | current | topic rows and prompt rows, no extra request |
| movers, contribution, top prompts | `useTopicPeriods()` | none (default, shares both of the strip's reads) | current and previous | change needs both windows; the join is `attachPrevious` (2.5) |
| trends, small multiples | `useTopicSummary(READ.topicSeries)` | `{ include: ['series'], rows: 'topics' }` | current | weekly points of topic rows, prompt rows left out |
| prompt by week (CH-12) | `useTopicSummary(READ.promptSeries)` | `{ include: ['series'] }` | current | prompt rows carry their pooled weekly points |

`useTopicSummary` and `useTopicPeriods` return `TopicData` (T1 types, T2 implements):

```ts
export type Phase = 'idle' | 'loading' | 'ready' | 'refetching' | 'error';   // idle: no asked engine, nothing is read
export interface EngineInfo { code: EngineCode; label: string }
export interface TopicData {
  phase: Phase;
  stale: boolean;                      // a refetch failed and the data is the last that was read
  errorId: string | null;
  retry: () => void;
  paired: boolean;                     // always true for useTopicSummary
  settled: boolean;
  compared: boolean;                   // a previous window was read AND paired (useTopicPeriods only)
  scope: OverviewScope;
  engines: readonly EngineInfo[];      // asked engines: enabled, inside scope.engines, catalog order ChatGPT, Gemini, AI Mode
  summary: PromptsSummary | undefined;
  previous: PromptsSummary | null;    // null when off, unavailable, or not paired
  nodes: readonly TopicNode[];         // two level tree of the topic rows, narrowed to scope.topic's subtree
  previousNodes: ReadonlyMap<string, TopicNode> | null;   // flat by key; null with no previous
  prompts: readonly PromptSummaryRow[];                   // [] when rows were left out (promptsRead false)
  previousPrompts: readonly PromptSummaryRow[] | null;
  promptsRead: boolean;
  descendants: TopicDescendants;       // topic id to the ids below it, from the vocabulary trees
  tree: { pending: boolean; failed: boolean };
  aggregates: OverviewAggregates | null;   // buildAggregates({ current, previous (null unless paired), engines, chosenEngines, topicsKept, sources: null, fanout: null })
  lastValidAt: string | null;
}
```

Where the pieces come from: topic rows with their weekly series are `summary.topics[].engines[].series` (V4). The previous period
is the second read of `useOverviewPeriods` (`previous`), joined to the current rows by `term_id` for topics and `prompt_id` for
prompts. `paired` and `settled` come from the same hook and gate every change (a card shows no change while `!paired`, and the
frame is `refetching` while `!settled`). The vocabulary tree (`useVocabularies({ workspaceId, projectId })`) gives parents so the
rows become a two level tree and `scope.topic` narrows to a subtree. The aggregates give the project level figure only where a
card prints one (CH-46's headline rate), so it equals the strip's (R12).

A new small pure model module is needed in four places: `topic-nodes.ts` (tree), `topic-rows.ts` (what each topic is per engine),
`topic-change.ts` (the two window join), `prompt-rows.ts` (prompt rows per engine). The card specific arithmetic (extremes,
gap rows, movers, contribution, trellis, pairs, scatter points) lives in `<card>-model.ts` beside each card, owned by that card's
task, so tasks that run together never edit the same file.

### 2.3 The WP-20 design carried over

- Heat map bins D-05: the 7 fixed bins are inside `HeatmapGrid` (`heat-bins.ts`); the card never maps a rate to a colour itself.
- Gap, trend and leader columns of WP-20 become: the gap is `bestWorst().spread` in points (T5, T9), the trend is the weekly line
  (T8), the leader (a competitor) is WP-35's.
- Drill down by `?eng=`: a cell links to the Prompts page with the topic drawer open on its Prompts tab filtered to the engine:
  `inspect=topic:<id>&itab=prompts&eng=<code>` (the keys of `drill.ts`: `ENGINE_PARAM = 'eng'`, `formatInspectTarget`).
- Comparison sentence (`compareEngines`): the tip of a gap row says "within normal variation", "detectable" or "too few answers"
  from counts only.
- Pooling D-04: 10 prompts, 4 weeks, applied by the API (V4); the footnote sentence is C-18: "A topic weekly point with fewer than 10
  prompts answering that week shows the last 4 weeks together (clipped to the window); a prompt point always shows 4 weeks."
- Change: `lib/compare/change-model` (`engineChangeOf`, `averageChangeOf`, `rateChange`, `deltaInput`) with `Delta`/`DeltaCell`
  (`test="interim"`), labelled "unpaired, pooled counts" (R5).

### 2.4 Parts a feature cannot import: decisions and lease requests

| WP-20 part | Where it is | Decision now | Lease request (move, WP-20 re-exports, no caller changes) |
|---|---|---|---|
| `engine-values.ts`, `compareEngines` of `comparison.ts` | `features/prompts/topics-by-engine/` | T2 copies the pure functions to `cards/topics/engine-values.ts` with `// shortcut: copy of features/prompts/topics-by-engine/engine-values.ts, move to lib/rates (lease L-A)`; a parity test imports the originals | `apps/web/src/lib/rates/engine-values.ts` and `lib/rates/engine-comparison.ts` |
| pure part of `series-model.ts` (TopicPoint, enginePoints, averagePoints, poolNote) | same | copy to `topic-points.ts` (without `isStale`, `entityLines`, the `history-model` import); parity test | `apps/web/src/lib/charts/topic-points.ts` |
| `topic-tree.ts`, `topicDescendants`, `topicsBelow`, `topicMembers`, `NO_TOPIC` | `features/prompts/` | copy to `topic-nodes.ts` (a generic 2 level tree over `NamedTerm`); parity test | `apps/web/src/lib/topics/topic-tree.ts` |
| `engineRole` | `features/prompts/history-model.ts` | 6 line copy in `engine-role.ts` | `lib/charts/engine-role.ts` |
| `TopicHeatmap` component, `topic-rows.ts` (`topicHeads`) | WP-20 | not reused: they use `prompts` messages and page state. Rebuilt on `HeatmapGrid` and the local model | none (they are page level) |
| `HeatmapGrid`, `SmallMultiples`, `BarList`, `IntervalBar`, `TopicEnginePanel`, `PlainTable`, bins, `useRateTipWords`, `rateTipText` | `components/app`, `lib` | used as they are | none |

Reuse rule for lib code WP-20 already imports: `cellFigure`, `averageRate`, `hasRate`, `sortByKeys`, `rateChange`,
`engineChangeOf`, `averageChangeOf`, `isDetectableChange`, `differenceInterval`, `wilsonInterval`, `rateState`, `rateTipText`,
`rateBandOption`, `smallSamplePoint` are imported, never copied.

### 2.5 The join of two windows (`topic-change.ts`)

The WP-19 change functions read a cell's `previous`. The Overview reads the previous window as its own response, so
`attachPrevious(now: readonly EngineSummary[], before: readonly EngineSummary[] | undefined): EngineSummary[]` returns the
current cells with `previous` set to `{ mentioned, cited, outcomes, share_of_voice }` of the same engine in `before` (none when the
engine is absent or `before` is undefined; the V4 rule "no data is not a rate of 0" stays). Then `engineChangeOf(joined, code,
metric)` and `averageChangeOf(joined, codes, metric)` give a `RateChange` (`points`, `detectable`, `now` and `before` sides with
`successes`, `answers`, `prompts`) with the exact arithmetic the Topics tab uses. `topicChange(node, previousNode, code, metric)`
wraps it. `commonPrompts(now, before)` returns the prompt ids present in both windows, for "15 of 17 prompts in both windows".

### 2.6 Honest states (one rule set, enforced by the shared frame in T3 and tested again per card)

| State | What the card shows |
|---|---|
| loading | the card's skeleton (`topicSkeleton(CARD_HEIGHT[key])`), and inside the frame the frame's own skeleton at the same height; no spinner |
| idle, no engine asked | empty state: reason "No engine is part of this view" (engine filter leaves them out, or none is on); action "Use all engines" (`setScope({ engines: null })`) when the filter caused it, "Turn on engines" link to Settings when `canManageEngines`, else a sentence naming a workspace admin |
| empty, no topic or no prompt | reason teaches ("Group prompts into topics to see where you are strong"), action "Open Topics and prompts" (link) or "Clear topic" (`setScope({ topic: null })`) when `scope.topic` is what emptied it |
| empty, no valid answer | "No valid answers in these 28 days on ChatGPT", action "Open Topics and prompts" |
| error | `InlineError` with the card's title, the request id, Retry (`retry()`), in the frame height |
| refetching (`phase === 'refetching'` or `!settled`) | `ChartFrame status="refetching"`: the body stays at full opacity |
| stale (`data.stale`) | frame notice `kind: 'stale'`: "These are the last figures read" |
| partial | frame notice `kind: 'partial'`: "Partial data: ChatGPT has no valid answer in this window" when an asked engine has no rate in any row (named, never silent) |
| small sample | the cell, bar or point says "3 answers" (`SmallSampleMarker`, hatched cell) and prints no percent; thin lines are hollow with no band |
| unknown | n/a (`EMPTY_VALUE`), never "0%" and never a bar of length 0 |
| change | `Delta` with `test="interim"`; coloured only when `detectable === true`; "within normal variation" otherwise; absent (never 0) when either window has no rate or the windows are not paired |
| engines | one value per engine; an average appears only from 2 engines with a rate, labelled "avg of N" with the engines named in its tip |
| customize mode | `live` is false: the card renders inert from the cached reads (no extra read gating, see D16) |

Every percent shows its count (R1: "47%, 64 of 136 answers, 17 prompts, each counts once"; share of voice: "answers that name a
brand", it has no count of successes). The footnote of every topic card says that topics overlap (a prompt in two topics counts
in both) and, when prompt rows are read, how many prompts are in more than one topic.

### 2.7 Messages

Namespace `aiOverview.topics` only (D10). T1 adds the skeleton below as one tiny commit-sized edit; each card task fills only its
own object by replacing its `{}` (so tasks that run together never edit the same lines). camelCase, ICU plural for counts,
straight apostrophes avoided (write "does not"), no dashes, no `!`.

```text
aiOverview.topics = {
  common: {}, heatmap: {}, extremes: {}, gap: {}, disagreement: {}, movers: {}, trends: {}, multiples: {},
  contribution: {}, promptHeatmap: {}, topPrompts: {}, promptWeek: {}, scatter: {}
}
```

`common` (T3) holds: `windowMeta`, `noTopic` ("Prompts without a topic"), `overlap`, `overlapCount`, `smallSample`, `weighting`,
`pooled` (the C-18 sentence), `compareTest` ("unpaired, pooled counts"), `staleNotice`, `partialNotice`, `emptyNoEngine*`,
`emptyNoTopics*`, `emptyNoAnswers*`, `errorTitle`, `retry`, `showAll`, `usingAllEngines`, `clearTopic`, `openTopics`, `avg`
("avg of {count}"), `metric.mention|citation|share_of_voice`. An unknown value is written with `EMPTY_VALUE` from `@/lib/format`, not a message.

### 2.8 Checks used by every task

- C1 TARGETED (no lock): `cd apps/web && pnpm exec vitest run <paths>`
- C2 MESSAGES (any task that edits `en.json`): `cd apps/web && pnpm exec vitest run src/i18n/messages.test.ts`
- C3 FORMAT (light): `cd apps/web && pnpm exec prettier --write <changed files>`
- C4 MEDIUM LANE, one call each (read `infra/dev/README.md` for the syntax):
  `infra/dev/heavy --lane medium --label wp36-tN-lint -- bash -c 'cd apps/web && pnpm lint'`,
  `... --label wp36-tN-types -- bash -c 'cd apps/web && pnpm typecheck'`,
  `... --label wp36-tN-format -- bash -c 'cd apps/web && pnpm format:check'`
- C5 HEAVY (T13 only): `infra/dev/heavy --label wp36-test --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'`,
  then `--label wp36-build ... 'cd apps/web && pnpm build'`, then `--label wp36-e2e ... 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-overview-topics.spec.ts e2e/flows/ai-layouts.spec.ts'`
- Dev server (browser looks only): reuse one that already runs for this worktree (`lsof -nP -iTCP -sTCP:LISTEN`, match the cwd); else
  `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p 3212` in the background; never kill a process on a port; delete the
  `AGENTS.md` and `CLAUDE.md` that `next dev` writes in `apps/web`. Pages: `/digibranders/eventus-security/ai` (seeded in dev),
  `/digibranders/fynix/ai`, `/digibranders/cleanstart/ai` (engines off). Accounts: `priya@digibranders.test` (editor),
  `tomas@digibranders.test` (admin), `mei@digibranders.test` (viewer).

Test harness for every card test (copy the head of `ai-overview-screen.test.tsx`):

```ts
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
beforeEach(() => { vi.setSystemTime(new Date('2026-11-12T12:00:00Z')); stubViewport(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
renderWithProviders(cardInOverview({ type: 'ai.topic_heatmap', Card, width: 'two_thirds', world: 'fynix' }), { searchParams: 'engine=chatgpt_web' });
// Eventus: setAiSeeded(true) before rendering, world: 'eventus-security'
```

`stubViewport` and `serveLayouts` come from `@/test/customize-harness`, `gate` from `@/test/gate`, `server` from `@/test/msw`,
`axe` from `@/test/axe` (`expect(await axe(container)).toHaveNoViolations()`). A refetch is provoked with the `queryClient`
returned by `renderWithProviders` (`invalidateQueries`) and a gated or failing MSW response. Deterministic data comes from
`topic-card-test-kit.tsx` (T3), served over `GET .../ai/prompts-summary` with `server.use`.

### 2.9 Decisions taken by default (reverse on the coordinator's word)

| # | Decision |
|---|---|
| D1 | Cards aggregate on the client behind `useOverviewSummary` and `useOverviewPeriods`; default options share the strip's requests. No card asks `compare`, `cells`, `total` or the 501 breakdown route |
| D2 | A small local model in `cards/topics/` (copies of WP-20 pure parts with `shortcut:` comments) until lease L-A; parity tests import the originals so a drift fails |
| D3 | Granularity: heat map follows the `level` option; extremes, gap, disagreement, movers and scatter use leaf topics (the most specific, so parents are not ranked beside their own children); trends, multiples and contribution use top level topics (one panel or bar per top level topic, as the spec says) |
| D4 | Engines never pooled; an average column or number exists only from 2 engines with a rate and says "avg of N" with the engines named |
| D5 | CH-43 draws no dot for an engine under 4 answers (R2 beats the spec's hollow dot); the row says "Gemini: 3 answers" in text |
| D6 | CH-11 rows are prompts sorted by the average rate, each with its topic path as a second line; grouping rows under topic rows is a follow-up (`HeatmapGrid` cannot start rows opened) |
| D7 | `ai.prompt_movers` (CH-09) is WP-34's (V10). Not built here. T9b exists only if the coordinator says WP-34 will not build it |
| D8 | CH-12 is a reusable component plus a thin card, NOT registered (no catalog key). Wiring needs a lease (L-D); recorded as a follow-up |
| D9 | CH-15 is built here as `ai.citation_vs_mention` (brief and contract agree); the scatter loads through a dynamic import of `echart-scatter` only |
| D10 | All words under `aiOverview.topics`; no `aiOverview.prompts` namespace (another package could add one) |
| D11 | e2e in `e2e/flows/ai-overview-topics.spec.ts` (V12) |
| D12 | Links: `drillHref` of WP-33 T10 when `drilldown/drill-links.ts` exists on develop at T2 time, else local `links.ts`; either way a test parses the links with the Prompts page parsers (`parseTab`, `parseMetric`, `parseView`, `parseEngineParam`) so a rename of a key fails here |
| D13 | Weekly pooling is the API's (V4). `POOL_BELOW_PROMPTS = 10` appears only in words, read from `pool.below_prompts` when a point has it |
| D14 | CH-46 `view=change` is built (the catalog offers it): contribution of each top level topic to the change of the prompt weighted rate over the prompts common to both windows, neutral bars (no test exists for a split), the remainder from prompts added or left is stated, not allocated |
| D15 | Every change uses WP-19 arithmetic through `attachPrevious` (2.5) and is labelled "unpaired, pooled counts" |
| D16 | The reads have no `enabled` flag, so customize mode (`live` false) still reads (cached, shared). A flag in `SummaryOptions` is lease L-C, optional |
| D17 | A topic filter in the scope narrows every topic card to that topic and below, also client side (the server filters prompts, not the rows of topics above) |
| D18 | CH-40's "All three" metric is not offered (the catalog has no such value); its prompt popover is replaced by the link to the topic drawer Prompts tab |
| D19 | Pushes to `develop`: after T3 (milestone M1), T6, T8, T11 and T13, each after fetch, rebase, targeted tests and the medium lane |

### 2.10 How a reviewer breaks a guard on purpose

Each task lists "guards": invariants that must have a test that fails BY NAME when the guard is removed. The reviewer removes or
inverts the guard in the code (a one line edit, reverted after), runs the named test, and records that it failed. A guard whose
test does not fail is a fix item (the test is too weak). Guards are the honest states and the data rules, not style.

## 3. Tasks

Order: T1, then T2 and T3 together, then T4 with T5, T6 with T7, T8 with T9, T10 with T11, then T12, T13. T9b only on the
coordinator's word. Section 5 lists the files each task touches.

---

### T1: scaffold, card slots, types and the messages namespace

Files (new): `cards/topics/model-types.ts`, `card-heights.ts`, `card-heights.test.ts`, `index.test.ts`, the eleven stub card files of 2.1
(each exactly `export { default } from '../pending-card';`). Modify: `cards/topics/index.ts`, `apps/web/messages/en.json` (the skeleton of
2.7, additive).

Exports: `model-types.ts` holds `TopicMetric` (`'mention' | 'citation' | 'share_of_voice'`), `CELL_OF: Record<TopicMetric, CellMetric>`
(`mention` to `mentioned`, `citation` to `cited`, `share_of_voice` to `share_of_voice`), `EngineInfo`, `Phase`, `TopicNode`
(`key`, `termId`, `name`, `path`, `parentKey`, `level: 1 | 2`, `promptCount`, `engines`, `members: readonly PromptSummaryRow[] | null`,
`lastValidAt`, `children`), `TopicData` (2.2), `MIN_PROMPTS_TO_RANK = 3`, `POOL_BELOW_PROMPTS = 10`. `card-heights.ts` holds
`TOPIC_CARD_KEYS` (the eleven keys as a `const` tuple), `TopicCardKey`, `CARD_HEIGHT: Record<TopicCardKey, ChartHeight>`. `index.ts`
holds `TOPIC_CARDS` with eleven entries `{ load: () => import('./<file>'), skeleton: PendingSkeleton }` (T3 swaps the skeleton).

Tests first:
- `index.test.ts`: `lists exactly the eleven cards of the topics family`, `every key is an active ai_overview card type`, `lists no card of another package` (a typed list of the keys WP-34, WP-35 and WP-37 own, from WP-33 plan 5.12, including `ai.prompt_movers`), `every entry loads a default export that is a component`, `the registry accepts the family` (`cardEntries([TOPIC_CARDS])` does not throw).
- `card-heights.test.ts`: `has a height for every key and no other`, `every height is one of 140, 180, 240, 280`.
- messages: `src/i18n/messages.test.ts` stays green with the skeleton (empty objects). If it rejects empty objects, put one placeholder key per object and say so.

Guards: the family lists exactly 11 keys (`index.test.ts > lists exactly the eleven cards of the topics family`); no foreign key
(`lists no card of another package`); a typo in a key throws in the registry (`the registry accepts the family`).

Checks: C1 on the three test files plus `cards/registry.test.ts` and `ai-overview-screen.test.tsx` (must stay green: the stubs are pending
cards), C2, C3, C4. Rows: process. Commit `WP-36: topics card slots, types and messages namespace`.

---

### T2: shared model and reads (runs with T3)

Files (new): `options.ts`, `topic-nodes.ts`, `engine-values.ts`, `topic-change.ts`, `topic-points.ts`, `engine-role.ts`, `topic-rows.ts`,
`prompt-rows.ts`, `use-topic-reads.ts`, `links.ts`, and one `.test.ts(x)` beside each. Never edit `index.ts`, `en.json`, `card-frame.tsx`.

Signatures:

```ts
// options.ts: option strings are sanitized by the layout, so an unknown value falls back to the catalog default, never throws
metricOf(value: string): TopicMetric; engineOf(value: string): EngineCode; countOf(value: string, fallback: number): number;
enumOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T;
// topic-nodes.ts
export const NO_TOPIC = '__none';
topicDescendants(tree: readonly NamedTerm[], extra: Iterable<string>): Map<string, Set<string>>;
topicsBelow(chosen: readonly string[], d: TopicDescendants): Set<string>;
topicMembers<T extends Pick<PromptSummaryRow, 'topic_term_ids'>>(termId: string | null, prompts: readonly T[], d: TopicDescendants): T[] | null;
buildTopicNodes(args: { topics: readonly TopicSummaryRow[]; prompts: readonly PromptSummaryRow[]; tree: readonly NamedTerm[]; descendants: TopicDescendants; kept: ReadonlySet<string> | null; noTopicName: string }): TopicNode[];
leavesOf(nodes: readonly TopicNode[]): TopicNode[];   // rows with no children (a top level row without children is a leaf), "No topic" excluded
topLevelOf(nodes: readonly TopicNode[]): TopicNode[]; // "No topic" excluded
overlapCount(prompts: readonly PromptSummaryRow[], nodes: readonly TopicNode[]): number; // prompts in more than one top level topic
// engine-values.ts (copy of WP-20): EngineValue, engineValue(cells, code, metric), bestEngine, bestWorst, engineGapOf, SAME_RATE, compareEngines(values, metric): Comparison
// topic-change.ts
attachPrevious(now: readonly EngineSummary[], before: readonly EngineSummary[] | undefined): EngineSummary[];
topicChange(node: TopicNode, before: TopicNode | undefined, code: string, metric: CellMetric): RateChange | null;
commonPrompts(now: readonly PromptSummaryRow[] | null, before: readonly PromptSummaryRow[] | null): { both: number; now: number } | null;
// topic-rows.ts
interface TopicEngineRow { node: TopicNode; values: EngineValue[]; average: AverageRate; gap: number | null; spread: BestWorst | null }
topicEngineRows(nodes: readonly TopicNode[], codes: readonly string[], metric: CellMetric): TopicEngineRow[];
orderRows(rows: readonly TopicEngineRow[], order: 'prompts' | 'rate' | 'gap', topLevelOnly: boolean): TopicEngineRow[];  // No topic last
// prompt-rows.ts
interface PromptEngineRow { prompt: PromptSummaryRow; values: EngineValue[]; average: AverageRate; lastValidAt: string | null; path: string | null }
promptEngineRows(prompts: readonly PromptSummaryRow[], codes: readonly string[], metric: CellMetric, tree: readonly NamedTerm[]): PromptEngineRow[];
// use-topic-reads.ts
export const READ = { topicSeries: { include: ['series'], rows: 'topics' }, promptSeries: { include: ['series'] } } as const satisfies Record<string, SummaryOptions>;
useTopicSummary(options?: SummaryOptions): TopicData;  useTopicPeriods(options?: SummaryOptions): TopicData;
// links.ts: all return a Route and carry the scope (window, cmp, country, engine, branded) exactly as the Prompts page reads it
topicDrawerHref(ctx, topicKey: string): Route;  topicEngineHref(ctx, topicKey: string, engineCode: string): Route;
promptHref(ctx, promptId: string): Route;  promptsTabHref(ctx, extra?: { sort?: string; topic?: string; engine?: string }): Route;
topicsTabHref(ctx, extra: { view: 'heatmap' | 'engines'; metric: TopicMetric; sort?: string }): Route;
```

`ctx` is `{ workspaceSlug, projectSlug, scope }` (from `useOverview()`); a link omits what is a default (compare on, branded excluded,
no country). Read `features/prompts/prompt-model.ts` lines 56 to 100 and `topics-by-engine/drill.ts` for the exact keys before writing
`links.ts`; if `drilldown/drill-links.ts` exists, `links.ts` becomes thin wrappers around `drillHref` (D12).

Tests first:
- `options.test.ts`: `metricOf maps the three catalog values`, `an unknown value falls back to the catalog default`, `countOf reads 5, 10, 20 and falls back`, `engineOf accepts the three engine codes and falls back to ChatGPT`.
- `topic-nodes.test.ts`: `a prompt rolls up to every topic above it`, `topicsBelow keeps the chosen topic and the ones below it`, `a third level topic stands for its second level topic`, `the row of no topic has key __none and comes last`, `kept narrows rows to the chosen subtree`, `a child whose parent is not kept stands at the top level`, `members are null while the tree does not hold the topic`, `leavesOf gives rows with no children and top level rows without children`, `leavesOf and topLevelOf leave out the no topic row`, `overlapCount counts a prompt in two top level topics once`, `parity: buildTopicNodes gives the order and nesting of topicHeads of WP-20 on the Eventus fixture`.
- `engine-values.test.ts`: `an unknown rate is null and never 0`, `under 4 valid answers is insufficient with no value`, `no valid answer is none with its reason`, `share of voice counts the answers that name a brand`, `bestWorst needs two engines with a rate`, `a best rate of 0 has no best engine`, `a tie goes to the engine shown first`, `spread is exact, not the difference of two rounded percents`, `compareEngines says within, detectable or too few from counts only`, `parity: equals WP-20 engineValue and bestWorst for every row and engine of the Eventus summary` (the test imports `@/features/prompts/topics-by-engine/engine-values`, allowed in tests).
- `topic-change.test.ts`: `attachPrevious sets previous from the other window for the same engine`, `an engine absent from the other window gets no previous`, `no previous window gives cells unchanged`, `the change of the joined cells equals engineChangeOf on cells that carry previous natively`, `a change is null when either side has under 4 answers (never 0)`, `detectable comes from isDetectableChange on pooled counts and is null for share of voice`, `commonPrompts counts prompt ids in both windows`, `commonPrompts is null when either side is absent`.
- `topic-points.test.ts`: `a week without a valid answer is a gap with value null`, `a point under 4 answers is thin with no band`, `a pooled point reports its weeks and window`, `a point with counts that cannot be real is a gap`, `averagePoints takes only engines with a rate and never counts a 0`, `poolNote counts pooled points of the shown ones`, `parity: enginePoints equals WP-20 enginePoints on a topic row with series`.
- `topic-rows.test.ts`: `one value per asked engine in the fixed order`, `the average is the equal weight of engines with a rate and says how many`, `the gap is null under two engines with a rate`, `orderRows by prompts, by rate and by gap, rows without a value last`, `the no topic row is last whatever the order`, `a tie goes to the name`.
- `prompt-rows.test.ts`: `a prompt value per engine from its own cell`, `the average is over engines with a rate`, `the row keeps its last valid time`, `the topic path comes from the tree or is null`.
- `use-topic-reads.test.tsx` (harness with a probe Card that prints `JSON.stringify` of the fields it needs): `default options ask the summary once with no include and no rows`, `READ.topicSeries asks include=series and rows=topics`, `READ.promptSeries asks include=series only`, `useTopicPeriods asks both windows and reports paired and compared`, `compare off gives no previous and compared false`, `no asked engine is idle and asks nothing`, `the engines are the enabled ones inside the engine filter in catalog order`, `a failed read is error with an error id and retry refetches`, `a failed refetch keeps the data and sets stale`, `a scope topic keeps that topic and the ones below it`, `the aggregates equal the strip's arithmetic (engineRates) for each engine`, `while the windows are not paired the previous is null`. First case to run, as a probe of V4: `the mock gives topic rows weekly series on Fynix and Eventus with rows=topics` (if red, stop and report: the series cards cannot be built on the mock).
- `links.test.ts`: `a topic drawer link carries inspect, itab, eng and the scope keys`, `defaults write nothing (compare on, branded excluded, no country)`, `the Topics tab link carries view and metric`, `the links are read by the Prompts page parsers` (imports `parseTab`, `parseMetric`, `parseView`, `parseEngineParam`), `a link built from a topic with an odd character is encoded`.

Guards:

| Guard | Test that fails when it is removed |
|---|---|
| unknown is null, never 0 | `engine-values.test.ts > an unknown rate is null and never 0` |
| under 4 answers has no value | `engine-values.test.ts > under 4 valid answers is insufficient with no value` |
| no change without a rate on both sides | `topic-change.test.ts > a change is null when either side has under 4 answers (never 0)` |
| previous only when the windows are paired | `use-topic-reads.test.tsx > while the windows are not paired the previous is null` |
| default options add no request | `use-topic-reads.test.tsx > default options ask the summary once with no include and no rows` |
| the average says how many engines | `topic-rows.test.ts > the average is the equal weight of engines with a rate and says how many` |
| the no topic row is last and is not a topic | `topic-nodes.test.ts > the row of no topic has key __none and comes last`, `leavesOf and topLevelOf leave out the no topic row` |
| a topic filter narrows rows (D17) | `use-topic-reads.test.tsx > a scope topic keeps that topic and the ones below it` |
| local copies match WP-20 | the four `parity:` tests |
| link keys match the Prompts page | `links.test.ts > the links are read by the Prompts page parsers` |

Checks: C1 on the files, C3, C4. Rows: process (data seam). Commit `WP-36: topics shared model and reads`.

---

### T3: shared card shell, skeleton, words, footnote and test kit (runs with T2)

Files (new): `card-frame.tsx`, `card-frame.test.tsx`, `card-skeleton.tsx`, `card-skeleton.test.tsx`, `use-topic-words.ts` (+ test),
`topic-footnote.tsx` (+ test), `topic-card-test-kit.tsx`. Modify: `index.ts` (skeleton per key), `en.json` (`aiOverview.topics.common`
only). T3 uses the T1 types only (not T2 code), so it runs beside T2.

Signatures:

```ts
// card-skeleton.tsx
topicSkeleton(height: ChartHeight): ComponentType;   // the panel of ChartFrame: p-4, a text-14 title line, a block of the height (as PendingSkeleton)
// card-frame.tsx
export type CardPhase = { status: 'loading' | 'ready' | 'refetching' } | { status: 'empty'; empty: ChartEmpty } | { status: 'error'; error: ChartError };
phaseOf(input: { data: Pick<TopicData, 'phase' | 'stale' | 'errorId' | 'retry' | 'settled'>; empty: ChartEmpty | null; errorTitle: string }): { phase: CardPhase; notice: ChartNotice | undefined };
interface TopicCardFrameProps { cardKey: TopicCardKey; title: string; meta: string | null; summary: string; data: TopicData; empty: ChartEmpty | null; partialEngines: readonly string[]; footnote: ReactNode; body: ReactNode; table: ReactNode; controls?: ReactNode; legend?: readonly LegendItem[]; menu?: HtmlChartMenu }
TopicCardFrame(props): ReactElement;   // ChartFrame kind="html" variant="panel", height CARD_HEIGHT[cardKey]; adds the idle (no engine) empty state itself
// use-topic-words.ts
useTopicWords(): { percent(v: number | null): string; cellTip(v: EngineValue, counted: boolean): string; rateTip: RateTipWords; metricLabel(m: TopicMetric): string; answers(n: number): string; prompts(n: number): string }
// topic-footnote.tsx
TopicFootnote(props: { overlapPrompts: number | null; pooled: boolean; weighting: 'prompt' | 'answer'; compareTest?: boolean; extra?: ReactNode }): ReactElement;
// topic-card-test-kit.tsx (test support; exports below are used by T4 to T11 tests)
cell(k: number, n: number, opts?: { prompts?: number; value?: number | null }): MetricCell;   // typed against Schemas['MetricCell'], read schema.ts for the required keys
engineCells(code: string, spec: { mentioned: [k: number, n: number]; cited?: [number, number]; sov?: [number, number]; series?: WeekSpec[]; previous?: {...} }): EngineSummary;
topicRow(id: string, name: string, promptCount: number, engines: EngineSummary[]): TopicSummaryRow;
promptRow(id: string, text: string, topicIds: string[], engines: EngineSummary[], lastValidAt?: string): PromptSummaryRow;
summaryOf(rows: { topics?: TopicSummaryRow[]; prompts?: PromptSummaryRow[] }): PromptsSummary;
serveSummary(respond: PromptsSummary | ((url: URL) => PromptsSummary | Response)): void;   // server.use(http.get(.../ai/prompts-summary))
serveVocabularies(terms: { id: string; name: string; parent: string | null }[]): void;        // so the tree knows the parents
```

Tests first:
- `card-skeleton.test.tsx`: `has a title line and a block of the frame height (h-35, h-45, h-60, h-70)`, `is hidden from assistive technology`, `its outer box equals the pending skeleton for 180`.
- `card-frame.test.tsx` (`phaseOf` pure, then the frame through `cardInOverview`): `loading is the frame skeleton at the card height`, `refetching keeps the body and sets the refetching status`, `not settled is refetching`, `error shows the title, the request id and Retry that calls retry`, `idle with the engine filter shows Use all engines and it clears the engine key`, `idle with canManageEngines and no engine on shows Turn on engines as a link`, `idle without the permission says to ask a workspace admin`, `stale shows the last figures read notice and keeps the body`, `partial names the engines without a valid answer`, `an empty state has a reason and exactly one action`, `the Table toggle shows the table form`, `the footnote is inside the frame`, `axe has no violations in each status`.
- `use-topic-words.test.tsx`: `percent of null is n/a, never 0%`, `a thin cell tip says the answers and no percent`, `a counted cell tip says k of n answers, the interval and the prompts`, `a share of voice tip says answers that name a brand`, `metric labels`.
- `topic-footnote.test.tsx`: `always says topics overlap`, `says how many prompts are in more than one topic when known`, `says the pooled sentence only when a point is pooled`, `says the prompt weighting or the answer weighting`, `says the test is unpaired on pooled counts when asked`, `says rates under 4 answers are not shown`.

Guards:

| Guard | Test |
|---|---|
| skeleton and frame share the height | `card-skeleton.test.tsx > has a title line and a block of the frame height (h-35, h-45, h-60, h-70)` and `card-frame.test.tsx > loading is the frame skeleton at the card height` |
| no percent for a thin cell | `use-topic-words.test.tsx > a thin cell tip says the answers and no percent` |
| n/a never 0 | `use-topic-words.test.tsx > percent of null is n/a, never 0%` |
| the overlap sentence is always present | `topic-footnote.test.tsx > always says topics overlap` |
| a refetch keeps the body | `card-frame.test.tsx > refetching keeps the body and sets the refetching status` |
| an engine left out is named, not silent | `card-frame.test.tsx > partial names the engines without a valid answer` |
| an empty state always has an action | `card-frame.test.tsx > an empty state has a reason and exactly one action` |

Checks: C1, C2 (the `common` block), C3, C4. Then MILESTONE M1: with T2 merged, `git fetch origin && git rebase origin/develop`, C1 on T1 to T3 files plus
`cards/registry.test.ts` and `ai-overview-screen.test.tsx`, C4, `git push origin HEAD:develop`, `infra/dev/wp-status WP-36 building "shared model and shell"` and the report line. Rows: process.
Commit `WP-36: topics card shell, words and test kit`.

---

### T4: heat map, CH-04 and CH-40, WB-TPE-01 (runs with T5)

Rows: CH-04, CH-40, WB-TPE-01. Files (new): `topic-heatmap-card.tsx` (replaces the stub; default export `TopicHeatmapCard`), `heatmap-model.ts`,
`topic-heatmap-card.test.tsx`, `heatmap-model.test.ts`. Modify `en.json` (`aiOverview.topics.heatmap`), and, with lease L-B,
`features/ai-overview/ai-overview-screen.test.tsx` (count pending cards from the registry instead of 9).

Card: `ChartFrame` html via `TopicCardFrame` (key `ai.topic_heatmap`, height 280). Options: `metric`, `rows` (5, 10, 20), `level` (top, all), `sort`
(prompts, rate, gap). Read: `useTopicSummary()`. Columns: one per asked engine (logo and name), then `avg of N` only from 2 engines
(R3). Rows: `topLevelOf`/the tree from `buildTopicNodes`; with `level=all` a topic's second level children are `HeatRow.children`
(the grid's chevron opens them in place); the no topic row is last. `heatmap-model.ts`: `heatRows(data, { metric, level, sort, rows })` returns
`{ rows: HeatRow[]; total: number; shown: number; columns: HeatColumn[]; csv: CsvTable }` using `topicEngineRows`/`orderRows` and the cell words
of `useTopicWords`. A cell: percent text when `state === 'ok'`, empty text with `state` `insufficient` (the grid hatches it and prints "3 ans") or `none`
(n/a); `tip` = "{topic} on {engine}: {value words}" from `cellTip`; `href` = `topicEngineHref` (not for `none`). The row `href` is `topicDrawerHref`. `rows`
cuts to N rows and the frame gets a link "Show all {total} topics" (`topicsTabHref` with `view=heatmap`, the metric and the sort) under the grid. Meta:
"{topics} topics, {engines} engines, {prompts} prompts, {window}". Footnote: the 7 bins in words, "prompt weighted: each prompt counts once", the average
rule, the overlap sentence (`TopicFootnote` with `overlapPrompts`). Table form: `HeatmapGrid form="table"`; CSV from `heatmapCsv`; menu `fileName`
`topic-heat-map-<metric>`.

Tests first (`topic-heatmap-card.test.tsx`, deterministic kit data plus a Fynix and an Eventus smoke; `heatmap-model.test.ts` pure):
- `renders a row per top level topic and a column per asked engine, then avg of 3 from two engines`
- `one asked engine has no average column`
- `an engine outside the engine filter is not a column`
- `a cell under 4 answers is hatched, says 3 ans and prints no percent`
- `a cell with no answers says n/a and never 0%`
- `every cell tip has k of n answers and the prompts (R1)`, and `share of voice tip says answers that name a brand`
- `level all opens a topic in place and top shows no chevron`
- `rows cuts to N topics and Show all names the total and keeps metric and sort in the link`
- `sort by prompts, rate and gap orders the rows and the no topic row stays last`
- `a cell links to the topic drawer Prompts tab with eng, and the topic name links to the drawer Overview` (parsed with `parseEngineParam`)
- `a topic filter in the scope narrows the rows to that topic and the ones below`
- `the footnote names the bins, the prompt weighting, the average rule and that topics overlap`
- `the Table form prints each cell's words and the CSV has the same words`
- `values equal the WP-20 engine values for every topic and engine of the Eventus summary` (parity)
- `asks the summary once with no include and no rows` (request count)
- states: `loading`, `no engine asked`, `no topics`, `no valid answers`, `error and Retry`, `refetching keeps the grid`, `stale`, `partial`
- `axe`, `keyboard: arrow keys move between cells and Enter on a linked cell follows its link`

Guards:

| Guard | Test |
|---|---|
| no percent under 4 answers | `a cell under 4 answers is hatched, says 3 ans and prints no percent` |
| n/a never 0 | `a cell with no answers says n/a and never 0%` |
| average only from 2 engines | `one asked engine has no average column` |
| counts in every tip | `every cell tip has k of n answers and the prompts (R1)` |
| overlap footnote | `the footnote names the bins, the prompt weighting, the average rule and that topics overlap` |
| no topic row last | `sort by prompts, rate and gap orders the rows and the no topic row stays last` |
| drill carries the engine | `a cell links to the topic drawer Prompts tab with eng, and the topic name links to the drawer Overview` |
| one request | `asks the summary once with no include and no rows` |
| equal to the Topics tab | `values equal the WP-20 engine values for every topic and engine of the Eventus summary` |
| a refetch keeps data | `refetching keeps the grid` |

Checks: C1 on the card, model, `cards/registry.test.ts`, `ai-overview-screen.test.tsx`; C2; C3; C4. Browser look: Eventus at 1280 light and dark, Customize on, the card at
`two_thirds` and `full`. Commit `WP-36: topic heat map`.

---

### T5: strongest and weakest topics (CH-41) and where engines disagree (CH-43) (runs with T4)

Rows: CH-41, CH-43. Files (new): `topic-extremes-card.tsx`, `extremes-model.ts` (+ test), `topic-engine-gap-card.tsx`, `gap-model.ts` (+ test), `parts/engine-range-plot.tsx` (+ test), card tests. Modify `en.json` (`extremes`, `gap`).

CH-41: options `metric`, `rows` (3, 5). Read `useTopicSummary()`. `extremesModel(rows: TopicEngineRow[], code, { count })` over `leavesOf`: a topic is eligible
when `value.state === 'ok'` and `value.prompts >= MIN_PROMPTS_TO_RANK` (3); the rest are counted ("6 topics have too few answers or prompts"). Strongest = highest `count` with a rate above 0; weakest =
lowest `count` of the eligible ones that are not in strongest (a topic is never in both); ties by prompts then name. One section per asked engine (logo, name); inside, two `BarList` comparison lists side by
side from `@lg` (container) and stacked below, `own: false`, value text the percent, context "{k} of {n} answers, {p} prompts". Each row links to `topicEngineHref`. An engine with no eligible
topic says why in text. `rows` 3 or 5.

CH-43: options `metric`, `rows` (5, 10). `gapRows(rows: TopicEngineRow[], count)` over `leavesOf`: topics with at least 2 engines with a rate, ordered by `spread.spread` (points) then prompts, top N;
`compareEngines` gives the sentence kind. `EngineRangePlot` (card local, HTML, not a canvas): one `li` per topic, a shared 0 to 100 percent axis, a `bg-border` 2 px line from the lowest to the highest dot, a dot
per engine with a rate (engine colour by `engineRole` and a marker shape by engine order: circle, square, triangle; a thin or empty engine has no dot, D5), position by inline `left: {pct}%` and
nothing else arbitrary. Row text: topic, spread "39 points", the words from the comparison kind ("within normal variation", "detectable", "too few answers"). A row is a link to the topic drawer. Table form: topic, one
column per engine (value with counts or "3 answers" or n/a), spread, sentence. CSV the same.

Tests first:
- `extremes-model.test.ts`: `a topic under 4 answers or under 3 prompts is not eligible and is counted`, `strongest takes the highest and skips a rate of 0`, `weakest takes the lowest of the rest and never repeats a strongest topic`, `a tie goes to the prompts then the name`, `the no topic row is never ranked`, `parents are not ranked beside their children (leaves only)`.
- `topic-extremes-card.test.tsx`: `one section per asked engine`, `two lists side by side with the count of rows asked`, `the too few answers count is in the footnote`, `every bar has k of n answers and prompts`, `a row links to the topic drawer on that engine`, `an engine with no eligible topic says why`, `the overlap footnote`, `metric share of voice says answers that name a brand`, states (as T4), axe, keyboard (rows are links in tab order).
- `gap-model.test.ts`: `needs two engines with a rate`, `orders by spread in points, exact`, `a thin engine is listed as answers and has no dot`, `the sentence is within, detectable or too few from counts only`, `share of voice has no test and says so`, `top N`.
- `engine-range-plot.test.tsx`: `a dot per engine with a rate at its percent on one shared axis`, `a thin engine has no dot and says its answers in text`, `the line spans the lowest to the highest dot`, `each row is a list item with the full sentence as its accessible text`, `the Table form lists every engine's value with counts`, `axe`.
- `topic-engine-gap-card.test.tsx`: `rows ordered by spread`, `a row says the spread in points and the verdict words`, `one asked engine is an empty state "Needs two engines" with Use all engines`, `the overlap footnote`, `a row links to the drawer`, states, axe.

Guards:

| Guard | Test |
|---|---|
| eligibility floor (4 answers, 3 prompts) | `extremes-model.test.ts > a topic under 4 answers or under 3 prompts is not eligible and is counted` |
| no topic in both lists | `extremes-model.test.ts > weakest takes the lowest of the rest and never repeats a strongest topic` |
| leaves only | `extremes-model.test.ts > parents are not ranked beside their children (leaves only)` |
| no dot for a thin engine (D5) | `engine-range-plot.test.tsx > a thin engine has no dot and says its answers in text` |
| spread is exact points | `gap-model.test.ts > orders by spread in points, exact` |
| verdict words from counts only | `gap-model.test.ts > the sentence is within, detectable or too few from counts only` |
| two engines needed | `topic-engine-gap-card.test.tsx > one asked engine is an empty state "Needs two engines" with Use all engines` |
| overlap footnote on both | the two `the overlap footnote` tests |

Checks: C1, C2, C3, C4. Commit `WP-36: strongest and weakest topics, engine gap`.

---

### T6: named by one engine, not another (CH-44) (runs with T7)

Rows: CH-44. Files (new): `engine-disagreement-card.tsx`, `disagreement-model.ts` (+ test), card test. Modify `en.json` (`disagreement`).

Options `rows` (5, 10). Read `useTopicSummary()` (prompt rows needed: `promptsRead`; if not, `empty`). Model `disagreementRows(prompts, nodes, descendants, codes)`: for each leaf topic and each
ordered pair (A, B) of asked engines, count prompts of the topic where A named the brand in at least one valid answer (`mentioned.numerator >= 1`) and B named it in none of at least 4 valid answers
(`mentioned.denominator >= 4 && mentioned.numerator === 0`); prompts with under 4 valid answers on A or B are not decided and are counted apart ("38 prompts have too few answers on an engine"). Rows are (topic, pair) with
count above 0, ordered by count then topic name then pair order, top N. A row: topic path, "ChatGPT yes, Gemini no", "6 prompts of 17", the topic as a link to the drawer (the pair filter is not a key
the Prompts page reads, so the count is text, flagged follow-up `DRILL_SUPPORT`). Part: `PlainTable` (columns topic, pair, prompts) inside the frame body; the Table form is the same table with the prompt texts of the first 3
prompts per row (accessible). With fewer than 2 asked engines: empty "Needs two engines", action Use all engines. A project where no prompt disagrees: empty reason "No prompt names you on one engine and misses you on another, among prompts with at least 4 answers on both" (this is good news, so no action but "Open Topics and prompts"). Footnote: the pair rule in words, the too few answers count, the overlap sentence.

Tests first:
- `disagreement-model.test.ts`: `a prompt counts when A named it once and B had at least 4 answers and none named it`, `a prompt with 3 answers on B is undecided and counted apart`, `numerator 0 with 4 answers is a miss, not unknown`, `pairs are ordered: ChatGPT yes Gemini no differs from Gemini yes ChatGPT no`, `a prompt in two topics counts in both`, `rows with count 0 are not listed`, `ordering and top N`, `leaves only`.
- `engine-disagreement-card.test.tsx`: `lists the topic, the pair words and the prompt count`, `a topic links to the drawer`, `needs two engines`, `no disagreement is its own empty reason`, `rows cut to N`, `the undecided count is in the footnote`, `the overlap footnote`, states, axe, keyboard.

Guards:

| Guard | Test |
|---|---|
| a miss needs 4 answers | `disagreement-model.test.ts > a prompt with 3 answers on B is undecided and counted apart` |
| a zero with enough answers is a miss, a thin zero is not | `disagreement-model.test.ts > numerator 0 with 4 answers is a miss, not unknown` |
| pairs are ordered | `disagreement-model.test.ts > pairs are ordered: ChatGPT yes Gemini no differs from Gemini yes ChatGPT no` |
| two engines needed | `engine-disagreement-card.test.tsx > needs two engines` |
| overlap footnote | `engine-disagreement-card.test.tsx > the overlap footnote` |

Checks: C1, C2, C3, C4. Then PUSH point (step 1 complete: T4, T5, T6): fetch, rebase, C1 on all `cards/topics`, C4, `git push origin HEAD:develop`, `wp-status`. Commit `WP-36: named by one engine, not another`.

---

### T7: topics gaining or losing (CH-42) and what each topic adds (CH-46) (runs with T6)

Rows: CH-42, CH-46. Files (new): `topic-movers-card.tsx`, `movers-model.ts` (+ test), `topic-contribution-card.tsx`, `contribution-model.ts` (+ test), card tests. Modify `en.json` (`movers`, `contribution`).

CH-42: options `metric`, `direction` (both, up, down), `rows` (5, 10). Read `useTopicPeriods()`. `moversModel(data, { metric, direction, count })`: for every leaf topic (current) and asked engine,
`topicChange(node, previousNodes.get(node.key), code, CELL_OF[metric])` (2.5); keep the changes that exist; apply `direction` (up: points above 0, down: below 0); detectable moves first (by absolute points, then name), then the rest
fold into one line "{n} topics moved within normal variation" (and "{m} could not be compared" for rows with no change). Rows are (topic, engine). `IntervalBar form="diverging"` with `changeDomain`, interval
`differenceInterval({ k: now.successes, n: now.answers }, { k: before.successes, n: before.answers })` (an estimate outside its interval means the weighted and pooled changes disagree: that row is `kind: 'none'` with "Change cannot be tested", not drawn
with a made up interval); `change` is `deltaInput(change)`, `test: 'interim'`; the bar is coloured only when detectable. The tip says "same 17 prompts" or "15 of 17 prompts in both windows" from `commonPrompts(node.members, previousNode.members)`
(omitted when members are null). Row link: topic drawer. Empty reasons: compare off ("Comparison is off", action "Compare with the previous period" sets `compare: true`), previous window without answers ("No answers in the previous {n} days"), nothing moved.
`!paired` is refetching, never a change.

CH-46: options `engine`, `view` (level, change). Read `useTopicPeriods()` (previous used by `change` only). `levelModel(data, code)`: P = prompts with at least 1 valid answer on the engine (the strip's `RateFigure.prompts`), each prompt's rate `r = numerator / denominator`;
the headline R = (sum of r) / P is `data.aggregates.engines[code].mentioned.value` (a test asserts equality, R12); for each top level topic (`topLevelOf`, members by `topicMembers`) the contribution is (sum of r of its prompts with an answer) / P in points; prompts without a topic have their own bar;
the sum of the bars can exceed R and the footnote says "bars add up to 38.1 points for a rate of 34.0%: 31 prompts are in two topics". `changeModel(data, code)`: C = prompts common to both windows with at least 1 valid answer in both; topic contribution = (sum over its common prompts of r1 minus r0) / |C|; headline change over C;
the part of the total change from prompts added or left is stated as a remainder, not allocated; bars neutral (no test for a split), labelled "no test for this split". `BarList` comparison rows, value in points ("3.2 points of the 34%"), context "{n} prompts". Under 4 valid answers on the engine in total: insufficient state, no bars.

Tests first:
- `movers-model.test.ts`: `a change needs a rate on both sides`, `detectable moves come first ordered by absolute points`, `the others fold into one counted line`, `direction up keeps only gains and down only losses`, `an estimate outside its pooled interval is not drawn with an interval`, `commonPrompts words: same N prompts or X of N`, `leaves only`, `rows are topic and engine pairs`, `a topic absent from the previous window is not compared (never 0)`.
- `topic-movers-card.test.tsx`: `colours a bar only when detectable (tone from formatMetricDelta)`, `the interim label unpaired, pooled counts is in the footnote`, `compare off is an empty state with Compare with the previous period that turns it on`, `an empty previous window says so`, `not paired shows refetching and no change`, `a row links to the drawer`, `the overlap footnote`, `requests: current and previous, no include`, states, axe, keyboard.
- `contribution-model.test.ts`: `R equals the strip's mention rate for the engine (R12 parity with buildAggregates)`, `the contribution of a topic is the sum of its prompts' rates over the prompts with an answer`, `prompts without a topic have their own bar`, `bars can add up to more than R and the overlap count is exact`, `change view uses only prompts common to both windows`, `the remainder of prompts added or left is stated, not allocated`, `under 4 answers is insufficient`.
- `topic-contribution-card.test.tsx`: `level view: a bar per top level topic with points and prompts`, `the footnote gives the sum and the overlapping prompts`, `change view bars are neutral and say no test`, `change view with compare off is an empty state with an action`, `engine outside the filter is an empty state with Use all engines`, states, axe.

Guards:

| Guard | Test |
|---|---|
| colour only when detectable | `topic-movers-card.test.tsx > colours a bar only when detectable (tone from formatMetricDelta)` |
| no change without a rate on both sides | `movers-model.test.ts > a change needs a rate on both sides` |
| not paired means no change | `topic-movers-card.test.tsx > not paired shows refetching and no change` |
| no invented interval | `movers-model.test.ts > an estimate outside its pooled interval is not drawn with an interval` |
| prompt set change is stated | `movers-model.test.ts > commonPrompts words: same N prompts or X of N` |
| equal to the strip | `contribution-model.test.ts > R equals the strip's mention rate for the engine (R12 parity with buildAggregates)` |
| overlap is stated with the sum | `topic-contribution-card.test.tsx > the footnote gives the sum and the overlapping prompts` |
| change view neutral | `topic-contribution-card.test.tsx > change view bars are neutral and say no test` |

Checks: C1, C2, C3, C4. Commit `WP-36: topic movers and topic contribution`.

---

### T8: topic trends by engine (CH-45) and topic small multiples (CH-33) (runs with T9)

Rows: CH-45, CH-33. Files (new): `topic-trends-card.tsx`, `trend-model.ts` (+ test), `parts/topic-trellis.tsx` (+ test), `topic-small-multiples-card.tsx`, `multiples-model.ts` (+ test), card tests. Modify `en.json` (`trends`, `multiples`).

Read `useTopicSummary(READ.topicSeries)` (topic rows, no prompt rows, so `rowsRead` is false and `aggregates` is not used). Top topics: `topLevelOf` ordered by prompts, then name; the count from the option.

CH-33 (options `engine`, `topics` 6 or 9): `SmallMultiples` with one panel per top topic: `id` topic key, `name` "{topic} ({n} prompts)", `role` = `engineRole(engine)` for every panel, `points: (RateBandPoint | null)[]` from `enginePoints(cell, 'mentioned')`
(`value`, `band` from the pooled Wilson interval when not thin, `thin`, `tip` from `useTopicWords().pointTip`), `cellText` the same words per week (R1: "34%, 81 of 238 answers, 17 prompts"; a pooled point adds "4 weeks to Oct 26"), `height` 140, `titles` with the pool span, `menu: { fileName: 'topic-trends-<engine>' }`. The panel title does not carry a window
delta (no previous series is read, follow-up F5: the latest week is printed by the part). Footnote: the C-18 sentence only when a point is pooled, the band rule, the overlap sentence.

CH-45 (options `metric`, `topics` 3 or 6): `TopicTrellis` (card local, in `parts/`): a grid of panels, rows = topics, columns = asked engines (3 columns from `@xl`, 1 below), each panel an `EChart` with `smallMultipleOption` (exported by `components/app/chart/small-multiples`)
on ONE shared ceiling (`rateCeilingOf` over every panel), the weekly points of that topic and engine, `group` per topic row so the crosshair is connected along a row, x labels only on the last row, 140 px each. A panel without a series says "No weekly data" in text (a gap, never 0). The Table form: rows are weeks, columns are the panels "Topic, Engine" with the same words as the tooltips (`PlainTable`, wrapped in `overflow-x-auto`);
CSV via `chartCsv`. Shows `ChartLegend` of engines (toggle hides a column).

Tests first:
- `trend-model.test.ts`: `top N topics by prompts then name, top level only`, `a week without a valid answer is a gap`, `a thin point is hollow with no band`, `a pooled point carries its weeks and window`, `one ceiling for every panel`, `an engine without a series has no points (not zeros)`, `the table rows are the weeks of the union of series`.
- `topic-trellis.test.tsx` (mock `echart` with the dynamic import stub used by `small-multiples.test.tsx`): `renders a panel per topic and engine`, `rows are topics and columns are engines`, `panels of one row share a group, rows differ`, `x labels only on the last row`, `a panel without a series says no weekly data`, `the Table form has a column per panel with k of n answers`, `legend toggles an engine column`, `axe`.
- `multiples-model.test.ts`: `panels per top topic by prompts`, `every panel has the engine role of the chosen engine`, `cellText says k of n answers and prompts, and the pooling`, `an engine not asked is an empty state`.
- `topic-trends-card.test.tsx` and `topic-small-multiples-card.test.tsx`: `ask the summary with include=series and rows=topics and nothing else`, `the pooled sentence appears only when a point is pooled`, `the overlap footnote`, `topics 3 or 6 and 6 or 9 cut the panels`, `the latest week is named in each panel`, `the summary sentence names the metric and the engines`, `no previous series is read`, states (a failed refetch is stale), axe, keyboard (legend buttons, Table toggle; the canvas is not a tab stop).

Guards:

| Guard | Test |
|---|---|
| a gap, never 0 | `trend-model.test.ts > a week without a valid answer is a gap` |
| thin is hollow with no band | `trend-model.test.ts > a thin point is hollow with no band` |
| one shared ceiling | `trend-model.test.ts > one ceiling for every panel` |
| crosshair connected along a row only | `topic-trellis.test.tsx > panels of one row share a group, rows differ` |
| pooling is said, only when it happens | `topic-trends-card.test.tsx > the pooled sentence appears only when a point is pooled` |
| no extra reads | `topic-trends-card.test.tsx > ask the summary with include=series and rows=topics and nothing else` |
| overlap footnote | both cards' `the overlap footnote` |
| table has the counts | `topic-trellis.test.tsx > the Table form has a column per panel with k of n answers` |

Checks: C1, C2, C3, C4. Commit `WP-36: topic trends and topic small multiples`.

---

### T9: prompts by engine (CH-11) and prompts to look at (runs with T8)

Rows: CH-11, and the "prompts to look at" card (no inventory row). Files (new): `prompt-heatmap-card.tsx`, `prompt-heat-model.ts` (+ test), `top-prompts-card.tsx`, `top-prompts-model.ts` (+ test), card tests. Modify `en.json` (`promptHeatmap`, `topPrompts`).

CH-11 (options `rows` 10 or 20, `sort` most_named or least_named, default least): read `useTopicSummary()`. `promptEngineRows` (T2) then sort by the equal weight average with `sortByKeys` (a row without a rate always last), cut to N; D6: flat rows, label = prompt text, a second `type-meta` line with the topic path. `HeatmapGrid` sequential, columns engines then `avg of N` from 2 engines, cells with the words "8 of 12 answers, 67%, last valid answer Nov 11" (`tip`), hatched under 4 answers (the common case at prompt level),
link to the prompt inspector (`promptHref`); a "Show all {total} prompts" link to the Prompts tab with the sort. Prompts are cut after sorting so the cut never hides the worst. Footnote: the bins, "each prompt is one row, rates are over its own answers", no topic overlap sentence needed here (rows are prompts) but a prompt in two topics is one row.

Top prompts (options `show` most_named, least_named, largest_change, `rows` 5 or 10; default least): read `useTopicPeriods()`. most and least named: the equal weight average of the engines with a rate, rows with no rate are not listed and counted ("12 prompts have too few answers"), `BarList` comparison rows (value the average with "avg of N engines" and the counts per engine in the tip). Largest change: per prompt `averageChangeOf(attachPrevious(now, before), codes, metric)`
(engines with a rate in BOTH windows, the same set on both sides, as WP-19); ordered by absolute points, detectable first; `Delta` with `test="interim"`, coloured only when detectable; prompts absent from the previous window are not compared; compare off is an empty state with an action. Each row links to the prompt inspector. Width third or half: one column list.

Tests first:
- `prompt-heat-model.test.ts`: `sort least named is ascending by the average and rows without a rate are last`, `sort most named is descending`, `the cut is after the sort`, `a prompt in two topics is one row`, `the topic path is the first topic's path`, `engines outside the filter are not columns`.
- `prompt-heatmap-card.test.tsx`: `a row per prompt with its topic path`, `a cell under 4 answers is hatched and says its answers`, `the tip says k of n answers, the percent and the last valid answer`, `a cell links to the prompt inspector`, `Show all names the total`, `avg column only from 2 engines`, `rows 10 and 20`, `asks the summary once`, states, axe, keyboard (grid arrows).
- `top-prompts-model.test.ts`: `most and least named use the equal weight average over engines with a rate`, `a prompt with no engine rate is counted apart, never ranked as 0`, `largest change uses the engines with a rate in both windows`, `absent from the previous window is not compared`, `detectable first then absolute points`, `the average change says how many engines took part`.
- `top-prompts-card.test.tsx`: `show most named, least named, largest change`, `rows 5 and 10`, `a row has the percent with avg of N and the counts in its tip`, `largest change colours only a detectable change`, `compare off is an empty state with an action for largest change only`, `the too few answers count is in the footnote`, `a row links to the prompt inspector`, states, axe, keyboard.

Guards:

| Guard | Test |
|---|---|
| unknown sorts last in both directions | `prompt-heat-model.test.ts > sort least named is ascending by the average and rows without a rate are last` |
| cut after sort | `prompt-heat-model.test.ts > the cut is after the sort` |
| a thin cell shows its answers | `prompt-heatmap-card.test.tsx > a cell under 4 answers is hatched and says its answers` |
| never ranked as 0 | `top-prompts-model.test.ts > a prompt with no engine rate is counted apart, never ranked as 0` |
| change over a fixed engine set | `top-prompts-model.test.ts > largest change uses the engines with a rate in both windows` |
| colour only when detectable | `top-prompts-card.test.tsx > largest change colours only a detectable change` |

Checks: C1, C2, C3, C4. Commit `WP-36: prompt heat map and prompts to look at`.

---

### T9b (only on the coordinator's word): prompt movers (CH-09, `ai.prompt_movers`)

Not planned by default (D7, Q1). If the coordinator says WP-34 will not build it: add `ai.prompt_movers` to `TOPIC_CARDS` and `TOPIC_CARD_KEYS`, a stub file, `prompt-movers-card.tsx`, `prompt-movers-model.ts`, messages `aiOverview.topics.promptMovers` (add the object), options `engine`, `direction`, `rows` (5 or 8). Read `useTopicPeriods()`; per prompt `engineChangeOf(attachPrevious(...), engine, mentioned)`; `IntervalBar form="dumbbell"` (previous and current rate dots, engine colour) or `diverging`; detectable first; honest states as T7; guards: no change without a rate on both sides, colour only when detectable, absent prompts not compared. One task, one commit `WP-36: prompt movers`. WP-34 must be told so it drops CH-09.

---

### T10: prompt by week, CH-12 (runs with T11)

Rows: CH-12. Files (new): `prompt-week/prompt-week-model.ts` (+ test), `prompt-week/prompt-week-heatmap.tsx` (+ test; presentational), `prompt-week-card.tsx` (+ test; container, NOT in `TOPIC_CARDS`). Modify `index.ts` (adds only the named export `PromptWeekHeatmapCard`), `en.json` (`promptWeek`).

Model `promptWeekGrid({ prompts, termId, descendants, code, metric })`: the prompts of one topic and below (`topicMembers`) with their pooled weekly points (`enginePoints(promptEngineCell, key)`), columns = the Mondays of the union of series (at most 14), rows ordered by the last pooled value then prompt text, the prompt weekly cell = the point (`value`, `k`, `n`, `weeks`, `window`). The tooltip: "4 weeks to Oct 26: 5 of 8 answers, 62%" (`pooled weeks` from `pool.weeks`); a point under 4 answers is hatched with its answers; a week with no point is n/a. `PromptWeekHeatmap` props: `{ grid, caption, rowHeader, density }` (no hook, no feature import: any feature can render it once wired). Version boundary columns need prompt versions, which the summary does not carry: not drawn, follow-up. `PromptWeekHeatmapCard` reads `useTopicSummary(READ.promptSeries)`, picks the topic with a local `Select` (view state, never an option; default `scope.topic` or the topic with the most prompts), the engine with a local `Select` (default the first asked engine), and the metric from `options.metric` if present else mention.

Tests first:
- `prompt-week-model.test.ts`: `rows are the prompts of the topic and below`, `columns are the Mondays of the series, at most 14`, `a pooled point carries weeks and window`, `a point under 4 answers is thin with its answers`, `a missing week is n/a, never 0`, `rows ordered by the last value then text`, `an engine without a series gives rows without points`.
- `prompt-week-heatmap.test.tsx`: `cell tips say N weeks to date, k of n answers and the percent`, `a thin cell is hatched and says its answers`, `a missing week says n/a`, `columns are weeks with the Monday date`, `renders without the Overview provider (presentational)`, `axe`, `keyboard grid arrows`.
- `prompt-week-card.test.tsx` (harness): `shows the topic with the most prompts by default and follows the scope topic`, `changing the topic or the engine changes the rows`, `asks include=series only`, `the pooled sentence C-18 is in the footnote`, `is not listed in TOPIC_CARDS` (index test), states.

Guards:

| Guard | Test |
|---|---|
| a prompt point is always pooled and says its weeks | `prompt-week-model.test.ts > a pooled point carries weeks and window`, `prompt-week-heatmap.test.tsx > cell tips say N weeks to date, k of n answers and the percent` |
| n/a never 0 | `prompt-week-heatmap.test.tsx > a missing week says n/a` |
| presentational part has no Overview dependency | `prompt-week-heatmap.test.tsx > renders without the Overview provider (presentational)` |
| not a registered card | `index.test.ts > lists exactly the eleven cards of the topics family` (still eleven) |

Checks: C1, C2, C3, C4. Commit `WP-36: prompt by week heat map component`. Follow-up recorded: wiring needs lease L-D.

---

### T11: citation rate vs mention rate (CH-15) (runs with T10)

Rows: CH-15. Files (new): `citation-vs-mention-card.tsx`, `scatter-model.ts` (+ test), `scatter-option.ts` (+ test), card test. Modify `en.json` (`scatter`).

Options `engine`. Read `useTopicSummary()`. `scatterPoints(rows, code)` over `leavesOf`: a point needs a rate on BOTH `mentioned` and `cited` (`state === 'ok'`); the others are counted ("6 topics have too few answers") and listed in the Table form with their answers. x mention, y citation, size from prompts (`sqrt`, 4 to 14 px), one shared axis 0 to the next tenth above the highest value of either (same on both axes so the 45 degree line "cited as often as named" is the diagonal). `scatter-option.ts`: `scatterOption(points, tokens, words)` returns the ECharts option (scatter series with `chart-reference` at 60 percent and a 1 px `surface` outline, emphasis `chart-1`, a `markLine` diagonal in `chart-reference` dashed, tooltip plain text of the topic, "Mention 47%, 64 of 136", "Citation 12%, 16 of 136", "17 prompts"; every string escaped through the shared helper). The card body loads the canvas with `dynamic(() => import('@/components/app/chart/echart-scatter').then((m) => m.ScatterEChart), { ssr: false, loading: () => <Skeleton .../> })`
(never a static import: `echart-scatter.test.ts` fails on it). The canvas is not keyboard navigable, so the Table form (topic, mention with counts, citation with counts, prompts, gap in points) is the keyboard path; the summary sentence names the topics with the largest gap. No quadrant colours. Footnote: the reference line, the leaf topics, the small sample rule, the overlap sentence.

Tests first:
- `scatter-model.test.ts`: `a point needs a rate on mention and citation`, `others are counted and listed with their answers`, `size is the square root of prompts between 4 and 14`, `the axis is one ceiling for both`, `the gap is mention minus citation in points`, `leaves only, the no topic row is not a point`.
- `scatter-option.test.ts` (tokens from `lib/design/read-tokens` test fixture used by `rate-band-chart.test.ts`): `one scatter series with the points`, `a diagonal reference line`, `colours come from the tokens`, `the tooltip text is plain and escaped`, `no animation`.
- `citation-vs-mention-card.test.tsx` (stub `echart-scatter` through `vi.mock` of the dynamic import path, which the scatter test allows): `loads the scatter by dynamic import only` (read the card source text), `the Table form lists every topic with counts`, `a topic under 4 answers on either rate is in the count, not a point`, `engine outside the filter is an empty state with Use all engines`, `the footnote names the reference line and that topics overlap`, `the summary sentence`, states, axe.

Guards:

| Guard | Test |
|---|---|
| both rates needed | `scatter-model.test.ts > a point needs a rate on mention and citation` |
| one axis for both | `scatter-model.test.ts > the axis is one ceiling for both` |
| dynamic import only | `citation-vs-mention-card.test.tsx > loads the scatter by dynamic import only` and the existing `echart-scatter.test.ts` |
| no unescaped tooltip | `scatter-option.test.ts > the tooltip text is plain and escaped` |
| the table is complete | `citation-vs-mention-card.test.tsx > the Table form lists every topic with counts` |
| overlap footnote | `citation-vs-mention-card.test.tsx > the footnote names the reference line and that topics overlap` |

Checks: C1, C2, C3, C4. PUSH point (steps 2 and 3 done): fetch, rebase, C1 on all `cards/topics`, C4, push, `wp-status`. Commit `WP-36: citation vs mention scatter`.

---

### T12: e2e flow and the browser pass

Files (new): `apps/web/e2e/flows/ai-overview-topics.spec.ts`, `apps/web/e2e/support/ai-overview-topics.ts`. Nothing else (never `e2e/support.ts`).

Read `e2e/flows/ai-layouts.spec.ts` and `e2e/support/layouts.ts` first (how a layout is stored, widths, themes, densities, `preferenceKey`). Page `/digibranders/fynix/ai`, signed in with `signIn` as an editor. The topic cards: seed the personal layout through the mock if `support/layouts.ts` offers a seed for
`ai_overview`; else through the UI: Customize, Start from "Topic owner", Save (seven of the cards), then add `ai.topic_small_multiples`, `ai.prompt_heatmap`, `ai.top_prompts`, `ai.citation_vs_mention` from the catalog. Fynix has 3 engines and 24 prompts, so a card can show thin cells honestly.

Tests (each its own `test`):
1. `the heat map shows topics by engine with counts in the cell names and an avg column` (WB-TPE-01, CH-04)
2. `a heat map cell opens the topic drawer on the Prompts tab filtered to its engine` (WB-TPE-01: URL has `inspect=topic:`, `itab=prompts`, `eng=`)
3. `Topic owner preset shows every topic card with its overlap footnote`
4. `the engine option of a card with an engine choice changes the card and not the page scope`
5. `the page scope (engine filter, topic) narrows every topic card; the URL survives reload and Back`
6. `a thin cell says its answers and prints no percent; no cell says 0% for an unknown` (scan the text of the card for `0%` next to "n/a" and "ans")
7. `compare off turns the movers card into its empty state with the action, and the action turns it on`
8. `a failed summary shows the card error with Retry and Retry recovers` (fault cookie of the summary mock, as `ai-prompts.spec.ts` does)
9. `loading shows skeletons and no spinner`
10. `keyboard: Tab reaches the grid, arrows move between cells, Enter follows a cell link, Escape leaves customize`
11. `axe: no serious or critical violation at 390, 768, 1024 and 1280 px, light and dark, Default and Compact` (use `expectAccessible`)
12. `no horizontal page scroll at 390 and no text with an em or en dash`

Browser pass (a person or agent, not committed): dev server reused or on port 3212, Eventus (`/digibranders/eventus-security/ai`), Fynix and Cleanstart, headless Playwright Chromium (the built-in pane cannot register the MSW worker), the Topic owner layout and the four extra cards: at 390, 768, 1024 and 1280 px, light and dark (`localStorage 'idraft.theme'`), Default and Compact density (Preferences): overflow, wrapped
controls, truncated labels, contrast of every heat bin, focus rings, the keyboard path, hover tips, the Table toggle, PNG and CSV menu entries, the frame height before and after data (card tops equal). Record findings as fixes in the card's file and re-run its tests.

Checks: C1 is not enough: run the spec through the heavy lane `--label wp36-e2e` (C5). Rows: WB-TPE-01 (proof), all card rows (proof). Commit `WP-36: e2e flow for the topic cards`.

---

### T13: As built notes, rebase, final checks, whole-diff review, push

Files (modify, append only): `docs/20-frontend-specification.md` (new blockquote paragraphs after the section 4.6 "As built" notes, and after the 4.8 table conventions if the heat map or prompt tables add any, `As built (AI visibility topic and prompt cards, WP-36, 2026-11-14, plan docs/superpowers/plans/2026-11-14-ai-wp-36-overview-cards-topics.md)`: the eleven cards, the read seam (2.2), the honest state rules (2.6), the decisions of 2.9 that deviate from the spec (D3, D5, D6, D7, D14), the follow-ups), `docs/design-system/25-component-inventory.md` (append next to the WP-06 and WP-20 notes in section 10: `EngineRangePlot`, `TopicTrellis`, `PromptWeekHeatmap` are feature local parts in `cards/topics/parts/` and `prompt-week/`, with their props and the follow-up to promote them), this plan's own "As built" section at its end (what was built per task, deviations, leases granted or refused, test counts). The docs edits are appends and need the coordinator's ack (L-H).

Steps:
1. `git fetch origin && git rebase origin/develop`; resolve `en.json` by keeping both sides, then C2; rerun C1 on all of `cards/topics`, `cards/registry.test.ts`, `ai-overview-screen.test.tsx`, `src/lib/layouts`, `src/features/layouts`.
2. C4 three calls, then C5: tests, build, e2e (the heavy lane, one job at a time, `--wait 30 --max 30`).
3. Whole-diff review by a second fresh Sonnet reviewer: read the brief's acceptance criteria and the 13 rows, the diff of the package, the guards tables (break three at random), and open every card at the four widths (T12's browser pass list).
4. Fix list, re-check, then `git push origin HEAD:develop` (fast-forward only; if rejected, rebase again), `infra/dev/wp-status WP-36 merged "<note>"` and the report line:
   `WP-36 merged | branch ai/wp-36-cards-topics @ <sha> | rows done 13/13 | steps 4/5 | blockers: none | next: tracker update by the coordinator`.
Never `git push origin main`, never `infra/ship.sh`.

Rows: process. Commit `WP-36: As built notes and final checks`.

## 4. Rows

| Row | Task | Proof |
|---|---|---|
| CH-04 | T4 | heat map card tests, e2e 1 |
| CH-40 | T4 (`level=all` is the full matrix; "All three" not offered, D18) | `level all opens a topic in place`, parity with WP-20 |
| WB-TPE-01 | T4, T12 | cell link test, e2e 1 and 2 |
| CH-41 | T5 | extremes model and card tests |
| CH-43 | T5 | gap model, range plot and card tests |
| CH-44 | T6 | disagreement model and card tests |
| CH-42 | T7 | movers model and card tests |
| CH-46 | T7 | contribution model (R12 parity) and card tests |
| CH-45 | T8 | trellis, trend model and card tests |
| CH-33 | T8 | multiples model and card tests |
| CH-11 | T9 | prompt heat model and card tests |
| prompts to look at (brief goal, no inventory row) | T9 | top prompts model and card tests |
| CH-12 | T10 (component only; no catalog key, wiring is follow-up F1) | week model and heat map tests |
| CH-15 | T11 | scatter model, option and card tests |

## 5. Order, parallelism and file ownership (at most 2 subagents at once)

| Wave | Tasks | Files they touch (disjoint) |
|---|---|---|
| 1 | T1 | `model-types.ts`, `card-heights.ts`, `index.ts`, 11 stub cards, `en.json` skeleton, 2 tests |
| 2 | T2 with T3 | T2: `options`, `topic-nodes`, `engine-values`, `topic-change`, `topic-points`, `engine-role`, `topic-rows`, `prompt-rows`, `use-topic-reads`, `links` and their tests. T3: `card-frame`, `card-skeleton`, `use-topic-words`, `topic-footnote`, `topic-card-test-kit`, their tests, `index.ts` (skeleton per key), `en.json` `common` |
| 3 | T4 with T5 | T4: `topic-heatmap-card`, `heatmap-model`, tests, `en.json` `heatmap`, the WP-33 screen test (L-B). T5: `topic-extremes-card`, `extremes-model`, `topic-engine-gap-card`, `gap-model`, `parts/engine-range-plot`, tests, `en.json` `extremes` and `gap` |
| 4 | T6 with T7 | T6: `engine-disagreement-card`, `disagreement-model`, tests, `en.json` `disagreement`. T7: `topic-movers-card`, `movers-model`, `topic-contribution-card`, `contribution-model`, tests, `en.json` `movers` and `contribution` |
| 5 | T8 with T9 | T8: `topic-trends-card`, `trend-model`, `parts/topic-trellis`, `topic-small-multiples-card`, `multiples-model`, tests, `en.json` `trends` and `multiples`. T9: `prompt-heatmap-card`, `prompt-heat-model`, `top-prompts-card`, `top-prompts-model`, tests, `en.json` `promptHeatmap` and `topPrompts` |
| 6 | T10 with T11 | T10: `prompt-week/*`, `prompt-week-card.tsx`, `index.ts` (one export line), `en.json` `promptWeek`. T11: `citation-vs-mention-card`, `scatter-model`, `scatter-option`, tests, `en.json` `scatter` |
| 7 | T12 | `e2e/flows/ai-overview-topics.spec.ts`, `e2e/support/ai-overview-topics.ts` |
| 8 | T13 | docs appends, this plan's As built |

Rules that keep parallel tasks apart: after T3 nobody edits `index.ts` (except T10's one export line, which runs beside T11 that does not touch it), the T2 and T3 files, or another task's `en.json` object. A card that needs a new
shared function adds it in its own `<card>-model.ts`; a defect in a shared file is reported to the coordinator, fixed in a separate small commit `WP-36: fix <file>` while nothing else runs, then both pending tasks rebase. When an `Edit` of `en.json` or `index.ts` reports that the file changed, re-read only the lines around the object being replaced and retry.

## 6. Lease requests (for the coordinator)

| # | File (owner) | Smallest edit | Why | Fallback without it |
|---|---|---|---|---|
| L-A | new `apps/web/src/lib/rates/engine-values.ts`, `lib/rates/engine-comparison.ts`, `lib/charts/topic-points.ts`, `lib/topics/topic-tree.ts`, `lib/charts/engine-role.ts`; and `features/prompts/topics-by-engine/engine-values.ts`, `comparison.ts`, `series-model.ts`, `features/prompts/topic-tree.ts`, `features/prompts/prompt-model.ts`, `history-model.ts` (WP-20) re-export from them | Move the pure functions of 2.4 (git mv, WP-20 files become re-exports, tests move with them) | One definition of "engine value", "best and weakest", "weekly point" and "topic tree" for the Prompts page and the Overview (R12) | T2 local copies with `shortcut:` comments and parity tests (nothing blocks) |
| L-B | `apps/web/src/features/ai-overview/ai-overview-screen.test.tsx` (WP-33) | Replace the fixed count of 9 pending cards by the count of built-in cards whose type is not in any family map; the assertion of titles stays | The first real card in the built-in layout (the heat map) turns that test red; WP-34, WP-35 and WP-37 hit it the same way | Needed in T4. Without it T4 cannot be green: stop and ask |
| L-C | `apps/web/src/features/ai-overview/data/overview-queries.ts`, `data/use-overview-reads.ts`, `overview-context.tsx` (WP-33) | `SummaryOptions.enabled?: boolean` (default true) so a card in customize mode (`live` false) does not read | D16; saves the series reads while editing | None needed; cards read (cached, shared) |
| L-D | `apps/web/src/lib/layouts/catalog.ts` + `pnpm gen:layout-catalog` (WP-33), or `features/prompts/topic-drawer/` (WP-20) | A catalog key `ai.prompt_by_week` mapped to `PromptWeekHeatmapCard`, or a drawer slot that renders `PromptWeekHeatmap` | CH-12 has no screen until one of these exists | CH-12 ships as a component and a tested card, not on a screen (follow-up F1) |
| L-E | `apps/web/src/components/app/chart/small-multiples.tsx` (WP-06) | An optional `columns?: 1 \| 2 \| 3` prop | The trellis of T8 could be a `SmallMultiples` instead of a card local part | `parts/topic-trellis.tsx` built on the exported `smallMultipleOption` and `rateCeilingOf` (follow-up F3) |
| L-F | `docs/20-frontend-specification.md`, `docs/design-system/25-component-inventory.md` | Append only (T13) | The brief asks for As built notes in the relevant spec | Notes only in this plan's As built |
| L-G | `apps/web/messages/en.json` | Additive `aiOverview.topics` skeleton in T1 and the objects below it | Allowed by the brief as a tiny early commit | none needed |

Not touched: `lib/layouts/catalog.ts` (the 11 keys exist), `lib/navigation/registry.ts`, `mocks/handlers/index.ts`, `e2e/support.ts`, `components/ui/*`, other packages' card folders, `design-preview/*`, tracker files, the main checkout.

## 7. Open questions for the coordinator

1. **Q1 (blocks nothing): `ai.prompt_movers`.** The brief of WP-34 lists CH-09 and the WP-33 contract assigns the key to WP-34; the request for this plan listed it for WP-36. Default: not built here (D7). Say so if WP-34 will not build it and T9b runs.
2. **Q2 (blocks T4): L-B.** Who edits the WP-33 screen test that counts nine pending cards, and when. Default: T4 makes the registry based edit (one assertion) and tells WP-34 and WP-35.
3. **Q3: `drillHref` and `RefetchBar` of WP-33 T9 and T10.** If they are on `develop` before T2, links wrap `drillHref` (D12). Otherwise the local `links.ts` stays and a follow-up swaps it.
4. **Q4: topic granularity (D3).** Leaf topics for ranking and gaps, top level for trends, multiples and contribution. Confirm or choose one level for all.
5. **Q5: CH-12 home (L-D).** A catalog key `ai.prompt_by_week` on the Overview, a topic drawer card, or both.
6. **Q6: Eventus in the e2e.** The e2e build starts with Fynix only (V13); the Eventus checks stay in unit tests and the manual browser pass.

## 8. Not verified (read these first in T1 and T2, and report what was found)

- U1: that the summary mock serves topic rows with `series` for `rows=topics&include=series` on Fynix and Eventus (the first case of `use-topic-reads.test.tsx` is the probe). If red, the series cards (T8, T10) wait for the mock owner (WP-20 holds `prompt-answers.ts` and `prompt-summary.ts`).
- U2: that `src/i18n/messages.test.ts` accepts the empty objects of the T1 skeleton (the existing `aiOverview.topics: {}` suggests yes).
- U3: the exact shape of `TaxonomyScope` and that `useVocabularies` returns the topic trees for Fynix and Eventus in the harness (seed the terms with `serveVocabularies` otherwise).
- U4: the exact required keys of `Schemas['MetricCell']` (the kit builders are typed against them).
- U5: that prompt row cells have whole `numerator` and `denominator` in the mock (CH-44 and CH-12 rely on it; the model throws a named error for a non whole count instead of guessing).
- U6: how `e2e/support/layouts.ts` seeds a stored layout for `ai_overview` (T12 falls back to the UI path).
- U7: that `HeatmapGrid` accepts a `ReactNode` label with two lines (CH-11 second line) without breaking its row height; if not, the topic path goes into the tip and the row `name` only.
- U8: heights of the finished frames (the table of 2.1 is a first guess).
- U9: the keys the Prompts page reads for `inspect=prompt:<id>` and for the `sort` of a link from the Overview (T2 reads `prompt-model.ts` and `use-inspector`).

## 9. Follow-ups

- F1: wire CH-12 (L-D) and the topic drawer's "Prompt by week".
- F2: group the prompt heat map under topic rows (D6) when `HeatmapGrid` can start rows opened.
- F3: fold the trellis into `SmallMultiples` (`columns`, L-E); promote `EngineRangePlot` and the local WP-20 copies to `components/app` and `lib` (L-A).
- F4: topic only reads (`rows=topics`) for the cards that need no prompt rows, to cut the payload on big projects (N15 of the inventory); today only the series cards use it.
- F5: a previous period dashed line in CH-33 panels and a window delta in the panel title once the previous series is read.
- F6: a `DRILL_SUPPORT` for the engine pair and outcome filters of the Prompts page (CH-44 rows become links to the prompts).
- F7: prompt version boundary columns in CH-12 (needs prompt versions in the read).
- F8: the metric inspector and a "Show in Topics and prompts" from every card (WP-33 follow-up F3).
- F9: AI Overview as a fourth engine column when slice 2 lands (D-19): `ENGINES` in the catalog and every card follow `data.engines`, so no card change is expected.

## 10. Decisions taken by the package session after planning (2026-11-14)

- L-B is closed: WP-34 changed `ai-overview-screen.test.tsx` to count pending cards from the family maps (develop adc1b6cf). No edit of that test here.
- `ai.prompt_movers` (CH-09) belongs to WP-34: task T9b is not built. The brief row list of WP-36 does not include it.
- Leases L-A, L-C and L-E are not requested: the fallbacks (local copies with parity tests, card-local trellis) are used. L-D (wiring CH-12) is a follow-up for the coordinator.
- Open question 4 (topic granularity): the plan's choice stands (leaf topics for extremes, gap, disagreement, movers, scatter; top level for trends, multiples, contribution).
- The e2e spec lives in `apps/web/e2e/flows/ai-overview-topics.spec.ts`.
- Drill links and export blocks: `drillHref` and `useExportBlock` are not on develop; cards use the local `links.ts` and no export block until they land.
- WP-35 owns `include=total` and `include=co_mentions` in the summary query and mock; no local copy here.
