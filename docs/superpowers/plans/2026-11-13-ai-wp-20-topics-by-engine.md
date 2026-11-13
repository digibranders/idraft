# WP-20 topics by engine and the topic drawer: task plan

Brief: [docs/ai-visibility/work-packages/WP-20-topics-by-engine.md](../../ai-visibility/work-packages/WP-20-topics-by-engine.md). Contract: [c2-summary.md](../../ai-visibility/contracts/c2-summary.md) (change log C-1 to C-19). Requirements: R-09 and R-11 (topic part) in [owner-requirements.md](../../ai-visibility/owner-requirements.md).
Worktree `.claude/worktrees/ai-prompts-web-8c68b5`, branch `ai/wp-20-topics-by-engine` (the brief says `.claude/worktrees/wp-20`: report the branch actually used in `wp-status`), base `e5ea65d0` (the F-14 commit). Every fact below was read in this worktree at that commit.
Paths: `F` = `apps/web/src/features/prompts`, `T` = `F/topics-by-engine` (new), `D` = `F/topic-drawer` (new), `C` = `apps/web/src/components/app/chart`.
Rows: 37 (9 built, confirmed by a test and not rebuilt; 28 to do). Tasks: 7, strictly one after another. Estimate: about 10 hours with one task in flight (the brief says 9 tasks and 7 hours: see section 7).

## How to read this plan

Section 0 lists the facts that change the work. Section 1 is the rules every implementer follows. Section 2 settles every open design question (the owner may overrule a default). Section 3 lists the files, the ownership and the leases to ask the coordinator for. Section 4 holds the 7 tasks (files, tests first, notes, checks, rows, commit). Section 5 maps the 37 rows to a task, a file and a test. Sections 6 and 7 give the order, the conflicts and the risks.

## 0. Facts found (they change the plan)

| # | Fact | Consequence |
|---|---|---|
| F1 | The page reads ONE summary (`prompts-screen.tsx` about line 309): `summaryQuery(scope, range, includeBranded, { country, include: ['series'] })`, all rows, `keepPreviousData`, enabled when an engine is on. The strip, both tabs and both drawers use it. `SummaryScope` in `prompt-queries.ts` allows `include` of `series` and `entities` only and has no `rows`. | Topic cells, topic series and every prompt row are already on the page. New reads go in files of this package (`T/topic-entities-query.ts`, `D/topic-trend-query.ts`); `prompt-queries.ts` is not edited. |
| F2 | The generated `schema.ts` has `rows`, `include` (five values), `compare`, `filter[term]`, and on `WeekCells` the fields `prompts`, `is_pooled`, `pool` and `entities`. | No regeneration is needed. |
| F3 | The mock `prompts-summary` handler (`mocks/handlers/prompt-answers.ts`, about line 506) lists its allowed query names: `rows` is a `422`; `include` accepts `series` and `entities` only; `WeekCells.entities` is never produced (`weekCells` in `mocks/prompt-summary.ts` has no entities). F-14 pooling is mirrored. | The mock must learn `rows` (task 2) and entities per week (task 5), or the dev server and e2e (`NEXT_PUBLIC_API_MOCKING=all`) answer `422`. Lease. |
| F4 | The Topics table has no metric: its columns are the two average rates, Top engine, Trend (average over engines) and a Mentioned and a Cited count column per engine, all visible. Its sort ids come from its columns (`sortValues` in `topics-table.tsx`). | Added columns register their sort ids by themselves. |
| F5 | `useEngineRateColumns(engines, cellsOf, metric)` in `rate-columns.tsx` is generic over the row and already builds one column per engine for a metric, with the insufficient pill, share of voice words, the `<code>_rate` sort id and the "valid of all" tooltip. The Prompts tab uses it; Topics does not. | Task 2 imports it. `rate-columns.tsx` is not edited. |
| F6 | `trend-model.ts` and `trend-column.tsx` average the engines and ignore `is_pooled` and `pool`. `weeklyHistory` (`history-model.ts`) drops every point whose counts are not whole, and every topic point is (its numerator is a sum of prompt rates). | A topic series needs its own model (`T/series-model.ts`). The built Trend column is WP-18's: flagged, not edited. |
| F7 | `HeatmapGrid` sends a cell to a `Route` through `href` only; it has no click callback. The frame pattern (ChartFrame html mode, `HeatmapGrid`, `heatmapCsv`, `useRateTipWords`) is in `components/design-system/chart-grids-section.tsx`. | Heat map cells are links built from the current address (`T/drill.ts`). |
| F8 | `DataTableList` (the phone list) exists but no table wires it: Topics has no phone list yet (WP-18 WB-TOP-34 does that). | Task 3 builds the line texts of WB-TPE-17 and wires them only where no other list exists (task 3 step 0). |
| F9 | `Inspector` takes `header.badges`, `frequentAction`, `navigation`, `positionText`, `moreActions` and `onStep` (J and K through `useShortcut` inside it). The topic drawer uses `positionText` for the prompt count today. | The prompt count becomes a badge ("12 prompts" stays visible: WB-TI-01 is built); `positionText` becomes "3 of 13" (the message `prompts.inspector.position` exists). |
| F10 | Add prompt is `openAdd(termId)` in the screen (opens `AddPromptsDialog` with `defaults.termId`). Run now is `usePromptActions().run(ids)` (asks first above one prompt, needs `runs:trigger`, disabled reason `actions.busyReason` or the list still loading), the topic row menu's action. The run API is wired (`RUN_NOW`, `bulkRun`); nothing is stubbed. | The drawer gets both as callbacks in one `extras` prop; nothing new is built for running. |
| F11 | `seams/topic-tabs.ts` holds commented WP-20 lines that name `../inspector/topic/topic-competitors-tab` and `topic-related-tab`. The folder this package owns is `topic-drawer/`. `TopicTabContext` has no scope or range. | The two entries live in `D/`; the import path in the two seam lines changes with them. Tabs read a React context of this package. |
| F12 | `topic-inspector.tsx` is leased to WP-16 task T10 (L3). Its plan wraps the Overview body in `DrawerCustomizer screen="inspector.topic"`, puts a Customize item in More and a save bar in the footer. `inspector.topic` has no card types (builtin cards are `[]`); WP-16 L5 owns `lib/layouts/catalog.ts`. | Tasks 1 to 6 never touch `topic-inspector.tsx`. Task 7 changes it once, after WP-16 merged, keeping WP-16's wrapper. This package registers no layout card type: it only makes each Overview section its own component (D-16). |
| F13 | `components/app/chart/topic-engine-panel.tsx` does not exist. AI_DEVELOPMENT_UI_RULES rule 19: a new component gets a gallery entry. | Task 4 adds one specimen to an existing gallery file (lease) and not a new section. |
| F14 | `tracked-keywords` takes `filter[term]` (a list: the term or one under it), `filter[rank_lte]` and `limit`, and returns `page.total`. Whether prompt topics and keyword topics are one vocabulary is not checked yet (BE-TOPICS-07, WP-18 task 1). | The In search card reads two lists with `limit=1`. A total of 0 is said as "no tracked keyword is given this topic", never as a rank fact. |
| F15 | Project entities carry a stored `color_index` (`projectEntitiesQuery`, read by `inspector-latest.tsx` and `inspector-competitors.tsx`). | Competitor lines take their chart role from it (own brand `chart-1`, others `chart-2` to `chart-6`, fallback by order). |
| F16 | `topic-drawer.test.tsx` asserts the By engine texts "38%", "3 of 8", "8 of 8" and the weighted note inside the "By engine" section, and many tests answer `SUMMARY_PATH` for every query with one fixed body. | New reads must read a body without `entities`, `series` or `rows` blocks as unknown, never as a crash or a zero. Task 7 updates those assertions. |
| F17 | e2e flows are named `ai-<slug>.spec.ts` (MASTER-PLAN 3.6); `ai-prompts.spec.ts` is WP-17's. The e2e project builds and serves a standalone app (`webServer`); `E2E_PORT` picks the port. | The spec is `apps/web/e2e/flows/ai-topics-by-engine.spec.ts` (the brief says `topics-by-engine.spec.ts`: convention wins, flagged). |
| F18 | The approved preview (`design-preview/prompts-topic-inspector.js`) has the drawer: header badges (category, prompt count, scope), Add prompt, previous and next, "Topic, 3 of 13"; Overview (three cards, visibility trend against competitors, engine rows with bar and k of n, In search, top prompts); Prompts; Competitors (entity by engine table); Related (siblings, keywords). It has NO By engine view, heat map, comparison sentence or per engine trend. | Those follow DS 24 9.5 and overview-and-charts.md sections 10.2 (CH-40), 10.4 and 10.5. No new visual language. |
| F19 | WP-17, WP-18 and WP-19 are `not_started` in `tracker.json`; WP-16 is `building`. | `topics-table.tsx` and `prompts-screen.tsx` have no other editor now. The leases still go through the coordinator. |
| F20 | `STALE_AFTER_DAYS = 7` in `history-model.ts` is the interim stale rule (CF-27 and WB-STATE-11 are WP-18's). | The drawer reuses it and carries the same `shortcut:` comment. |

## 1. Rules in force for every implementer

- One fresh Sonnet subagent per task (Haiku and Sonnet only, never Opus), one subagent at a time. A fresh Sonnet reviewer reads the task, this plan and the diff after every task, runs the task's targeted tests, checks these rules and returns PASS or a numbered fix list; the implementer fixes and the reviewer checks again.
- Tests first, red for the right reason, then code, green, then checks, then ONE commit `WP-20: <task title>` naming only the task's files (task 1 makes two: `WP-20: message keys` and `WP-20: per engine model`). No attribution lines. Never stage another session's files. No push unless the coordinator says so (planned pushes: after task 3 and after task 7, each after `git fetch origin && git rebase origin/develop` and a re-run of the targeted tests; `git push origin HEAD:develop`). Never push `main`, never run `infra/ship.sh`.
- Edit files with the file tools only (no heredocs, `sed` or replace scripts). Delete a generated `apps/web/AGENTS.md` or `CLAUDE.md` if a tool makes one: `git status` shows neither.
- No dev server. A browser check uses `pnpm dev` on port 3006 with `NEXT_PUBLIC_API_MOCKING=all`, only when the coordinator allows it; the in-app browser cannot register the MSW worker, so use headless Playwright for any screenshot.
- UI tasks (2, 3, 4, 5, 6, 7) invoke `Skill(skill="design-taste-frontend")` before writing markup. The project design system outranks it: follow `DESIGN_SYSTEM.md`, `docs/design-system/` and the approved preview; never invent a visual pattern; no new font, radius or colour.
- Tokens and `type-*` utilities only (no raw colours, no arbitrary values); spacing steps 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 only; numbers and dates through `@/lib/format` (no `Intl`, `toFixed`, `toLocaleString` in components); every percent shows its count; an unknown value is never 0; colour only for a detectable change; no `any`; no em-dash or en-dash anywhere, comments and tests included (ranges say "to"); files are ASCII (`grep -nP '[^\x00-\x7F]' <files>` prints nothing, except where a file already holds the typographic minus it reads from `@/lib/format`).
- Every visible string is a key in `apps/web/messages/en.json` under `prompts.topicDrawer` (section 2.7 lists them). A string is never built by joining parts in code: ICU messages, `formatList` and `@/lib/format` do that.
- Checks, from `apps/web`, per task (replace `<files>` with the task's source and test files):
  - light (no lock): `pnpm exec eslint <files> --max-warnings 0` and `pnpm exec prettier --check <files>`.
  - medium: `infra/dev/heavy --lane medium --label wp-20-tN -- bash -c 'cd apps/web && pnpm typecheck'`.
  - medium targeted tests: `infra/dev/heavy --lane medium --label wp-20-tN-test -- bash -c 'cd apps/web && pnpm vitest run <paths> --maxWorkers=2'`.
  - Full `pnpm test`, `pnpm build` and e2e run ONLY in task 7, through `infra/dev/heavy`, and only when the first line of `/tmp/idraft-health/state` is `level=OK` (it was at 14:27 on 2026-11-13; read it again before each heavy run).
- After any edit of `topics-table.tsx` or `prompts-screen.tsx`, the whole folder runs: `pnpm vitest run src/features/prompts --maxWorkers=2` (medium lane).

## 2. Decisions settled

### 2.1 Request shapes (C-15)

| Read | File and hook | Query | Feeds | Enabled |
|---|---|---|---|---|
| Page read (unchanged) | `prompts-screen.tsx` | all rows, `include=series`, `include_branded`, `filter[country_iso]` | topic and prompt cells, prompt rows (child rows, drawer Prompts tab, top prompts, strip) | as today |
| Entities read (new) | `T/topic-entities-query.ts`: `topicEntitiesQuery`, `useTopicEntities` | `rows=topics`, `include=entities`, `from`, `to`, `include_branded`, `filter[country_iso]` | leader columns, Competitors tab | the By engine view is on, or the Competitors tab is open |
| Drawer trend read (new) | `D/topic-trend-query.ts`: `topicTrendQuery`, `useTopicTrend` | `rows=topics`, `include=series,entities`, `filter[term]=<topic id>`, same scope | per engine trend (CF-31), own against top 3 (N3) | the Overview is shown |

- Why: C-15 measured `rows=topics` with `series,entities` at 12 to 16 KB and all rows with entities at 2.1 MB for one entity and 14.5 MB at 20. The page keeps its read; entities come in small reads of topic rows only. `filter[term]` keeps the weekly entity cells (the heavy part) to one topic.
- Under `filter[term]` the topic rows are the term and the topics below it; the hook picks the row whose `term_id` equals the key. The key `__none` (prompts without a topic) has no `filter[term]`: its per engine trend comes from the page read's row with `term_id` null, and its own against top 3 chart says it is read per topic (an empty state with that reason).
- Not asked: `include=total` (no row of this package needs a project total: the strip has them), `compare` (WP-19 passes it; cells that carry `previous` already show their change, section 2.5), `co_mentions`, `cells`, `group_by`.
- Each hook is `useQuery({ ...query, enabled, placeholderData: keepPreviousData })`. Keys come from `apiQuery`, so `refreshPrompts` (which invalidates `aiKey`) reaches them. They are not added to `prompt-queries.ts`.

### 2.2 Data model (plain functions, unit tested, in `T/`)

- One value (`engine-values.ts`): a topic or prompt, an engine and a metric (`mentioned`, `cited`, `share_of_voice`) give `{ state, value, answers, successes, prompts, reason }` from `cellFigure` and `validAnswers`: the percent, the valid answers behind it ("k of n"; share of voice says "n answers naming a brand", never k), the prompts a topic cell weights. `state` is `ok` from `MIN_OBSERVATIONS` (4) valid answers, `insufficient` under, `none` with no answer. Unknown is never 0.
- Averages (WB-TPE-18): every number across engines says "avg of N", N being the engines that show a rate (`averageRate`, `acrossEngines`, existing), and its tooltip names them (`prompts.rate.avgTip`). No new view pools engines silently.
- Best and worst engine: among engines with `state` ok. Ties go to the engine that comes first in the order shown, for both. A best of 0 means no engine names the brand: no best engine (the rule of `topEngine`).
- Spread: best minus worst in points, exact, shown with 1 decimal and unsigned ("12.6 pts"); unknown when fewer than 2 engines have a rate. Its tooltip names the best and weakest engine with their rates and counts and lists the engines left out for too few answers.
- Sort by an engine: the built column id `<engine_code>_rate` (value null last in both directions). Sort by the gap: id `engine_gap`.
- Leader per engine (`leaders.ts`, WB-TPE-08): among tracked competitors (never the own brand) the highest `share_of_voice.value` on the engine, only when the engine's share of voice denominator is at least 4. A tie goes to the higher `mentioned.value`, then to the order of the entities the API lists (competitors by name). Every competitor at 0 gives "None named". Fewer than 4 answers naming a tracked brand gives "too few". The inventory text allows Mentioned or share of voice: share of voice is chosen because its shares add up to 1 over the entities, so it is the one comparable value (default; owner may overrule).
- Own against top 3 (N3, `series-model.ts`): the 3 competitors with the highest window Mentioned on the chosen engine (for "avg of N", the equal weight average over engines that have a rate), ties by entity order, a competitor with 0 mentions is never top. Own brand `chart-1`, others by stored `color_index`. Entity weekly points are the `WeekCells.entities` of the point, over the very weeks the point holds.
- Weekly point (`series-model.ts`): `{ weekStart, value, k, n, prompts, pooled, pool, band, thin }`. The value is the cell's prompt weighted value; `n` the valid answers (`pooled.trials`); the band is the 95 percent Wilson interval of the pooled answers (`wilsonInterval(pooled.successes, pooled.trials)`, R8) from 4 answers; `thin` under 4 answers (hollow, no band); a week with no valid answer is a gap, never 0. A cell with unreadable counts is a gap.
- Engine comparison sentence (`comparison.ts`, WB-TPE-11): kinds `gap` (best, worst, points), `equal`, `zero`, `none` (fewer than 2 engines), each with the engines left out. For `gap` the difference is tested unpaired on the pooled answer counts (`isDetectableChange`, Newcombe): "within normal variation" or "larger than normal variation", both labelled "unpaired test on pooled answers"; no test sentence for share of voice (its numerator is not a count) or when an engine is thin. Words come from counts only.

### 2.3 Views and URL state

- `view` (new key, read with its own `useQueryState`): absent is the List (today's table, untouched), `engines` is By engine, `heatmap` is the Heat map. Anything else is the List. The default stays the List: WP-18 polishes that table in parallel and the existing tests assume it; flipping the default is one constant (`DEFAULT_TOPICS_VIEW`).
- `metric` is the page's existing key: Mention (absent), `citation`, `sov`. One state for the Prompts tab, the By engine view, the Heat map and the drawer's engine panel. The switcher is a Select over `RATE_METRICS` with the labels `prompts.metric.*` (the Prompts tab's is inline in `prompts-screen.tsx` and cannot be reused without editing it): `T/metric-select.tsx`.
- `eng` (new key): the engine the drawer's Prompts tab is filtered to. The drawer clears it when it unmounts.
- `sort`: the table's own ids. The heat map reads the same key and offers three orders: `prompts` (its default, per CH-04), `avg_rate` (average of the chosen metric; an id the table ignores) and `engine_gap`.
- Drill-down (WB-TPE-07, WB-TPE-12): `?inspect=topic:<id>&itab=prompts&eng=<code>`, every other key kept. In a table cell it is a button that writes those keys through nuqs (`useInspector().open` plus `eng`, one URL update). In the heat map it is a link (`drillHref`). Two clicks rule: click a topic name (1), click an engine row in the drawer's By engine panel (2) and the Prompts tab shows that engine's prompts; from the By engine view or the heat map it is one click.
- The Prompts tab filter keeps the prompts of the topic with an answer on the engine (`n_observations > 0` on that engine) ordered by the chosen metric on that engine, high to low, a prompt without a rate last. Known limit: J and K inside a prompt opened from the filtered list still step through the unfiltered order (`originOrder` is in the screen).

### 2.4 Trends and pooling language (F-14, C-18)

Every trend surface of this package (the per engine sparklines, the drawer's per engine chart and own against top 3; the heat map is not a trend) reads `is_pooled`, `pool.weeks`, `pool.window` and `prompts` and never draws a pooled point as a plain weekly one. A point is marked by its words, since a canvas line cannot restyle one point: (1) the point's tooltip title and the table form row name "N weeks to Oct 26" (`pooling.pointTitle`); (2) the footnote carries the C-18 sentence (`pooling.sentence`) whenever any point of the chart is pooled; (3) a sparkline's tooltip says how many of its points are pooled. A point under 4 answers is hollow with no band (R2).

### 2.5 The drawer

- Header (`D/header-model.ts`, `D/use-topic-header.tsx`): title is the topic name; badges (at most 3): the category path (the topic's ancestors joined by the tree's own ` / `, from `NamedTerm.path`; a level 3 topic therefore shows "Root / Parent", WB-TI-23; a top level topic shows no category badge), the prompt count ("12 prompts"), the scope of the counts ("3 engines, Germany, non-branded", joined with `formatList`). The category badge takes the keyboard and its tooltip has the whole path (the pattern of `prompt-inspector.tsx`). `freshness` is "Updated {time}" from the topic row's `last_observed_at`. `positionText` is "3 of 13" (`prompts.inspector.position`) when the topic is in the list the Topics tab last drew, else none; `navigation` is Previous and Next; `onStep` gives J and K (`useShortcut` is inside `Inspector`). The order comes from `D/topic-order-store.ts`, a small store keyed by project that the Topics view fills (the topic rows in the order drawn) and empties when it unmounts.
- Actions: `frequentAction` holds Add prompt (secondary, `Plus`) then Run now (secondary, `Play`) in one wrapping row. Add prompt calls `extras.onAddPrompt(termId)` (the screen's `openAdd`: the dialog opens with the topic chosen) and is absent for a role without `prompts:write` or for "No topic". Run now calls `extras.run.onRun(promptIds)` (the screen's `actions.run`: asks first above one prompt) and is absent without `runs:trigger`; it is disabled with its reason when `extras.run.blockedReason` is set, when the topic holds no prompt, or while its prompts are not known. If the two buttons do not fit the header at 390 or 440 px, Run now moves to the first item of `moreActions` (decide at the browser check in task 6; default: both buttons).
- Tabs: Overview, Prompts, Competitors, Related. Competitors and Related come through the two seam entries (`topicCompetitorsTab`, `topicRelatedTab`). Competitors is offered while the summary loads or when it lists a tracked competitor. Related is offered when the topic has siblings, worked out from `descendants` alone (the parent of a topic is the smallest other topic set that holds it; siblings share a parent; a top level topic's siblings are the other top level topics).
- Overview, in order: Rates (three cards, built), By engine (the panel and the comparison sentence), Trend by engine, Visibility trend against competitors, In search, Top prompts (built). Each is its own component with a stable id so a later layout package can register them.
- By engine panel (`C/topic-engine-panel.tsx`, SC-26): rows per engine in the fixed order: logo and name, bar, percent, "k of n answers, p prompts" (share of voice: "n answers naming a brand, p prompts"), the change in points when the cell carries `previous` (`Delta`, coloured only when detectable), a `thin` marker under 4 answers, "No answers" with none. A metric control (Mention, Citation, Share of voice) sits in its header and writes `metric`. Each row is a link to `?inspect=topic:<id>&itab=prompts&eng=<code>`. The footnote is the existing `topics.weighted` note. The panel is presentational (rows in, `BarList` out); the drawer part `D/engine-panel.tsx` builds the rows from the model.
- In search (`D/in-search.tsx`, WB-TI-13): two tracked keyword lists with `limit=1` (`filter[term]=<id>` and the same with `filter[rank_lte]=10`), read as `page.total`: "Keywords: N tracked and given this topic" and "Top 10: M of N tracked" with an "Open in Rankings" link to `/seo/keywords?tag=<id>`. Unknown states: loading skeleton; a failed read is an inline error with Retry that leaves the drawer intact; N of 0 is "No tracked keyword is given this topic" with the reason (F14). Not shown for "No topic".
- Related tab: sibling topics with prompt count and mention rate (avg of N), at most 10 by prompt count, each opens that topic's drawer on the Related tab; a note counts the rest.
- Competitors tab: a table, rows the tracked entities (own first, at most 20), columns the engines shown, cell the chosen value (Mentioned or Share of voice, with the answers behind it), the leader per engine in `type-body-strong` (weight 500) and named for screen readers. WP-23 (WB-TI-18) later decorates this tab (swatch, `BarList`); this package builds the table so the tab exists (WB-TPE-13).
- Stale: when the topic's `last_valid_at` is older than `STALE_AFTER_DAYS`, the panel and the charts show "No valid answer since {date}" in the meta line.
- Change on the cards (WB-TI-09) and the change column on top prompts (WB-TI-16) are WP-19's. The panel shows a change only when a cell has `previous`.

### 2.6 States, keyboard, widths

- Every new surface has: loading (skeleton, no full-page spinner); empty (reason and action); error (retry, other content stays); partial (an engine with no data: "No answers", the comparison names it, the heat cell says "n/a"); stale (above). A refetch keeps the previous data (`keepPreviousData`) and the table, chart frame and heat frame show their static refetch bar through `status: 'refetching'`; `InspectorSection` has no bar, so drawer sections keep their content untouched.
- Keyboard: view switch (arrow keys of the segmented control), metric Select (Enter, arrows), engine column sort (header Enter or Space), engine cell drill-down (arrow to the cell, then F2 or Tab in widget mode to its button, Enter), heat map cells (the grid's arrows, Enter follows the link), Export (Tab, Enter), drawer: J and K (`useShortcut`, hints in the tooltips), Add prompt and Run now (Tab), panel rows (Tab, Enter), tabs (arrows), Escape closes (built).
- Widths 390 (the drawer is a sheet, the Topics tab is the phone list), 768 (drawer lies over), 1024, 1280 (docked); light and dark; Default and Compact density. The By engine view and the List are one phone list below 768 px (rows say the best engine and the engine count); the heat map stays a scrolling grid.

### 2.7 Messages (`apps/web/messages/en.json`, only under `prompts.topicDrawer`)

Keys are fixed; English is the draft (ASCII, no dash, "cannot" in full, no straight double quotes, no exclamation mark; `pnpm vitest run src/i18n` must pass). Existing keys of `topicDrawer` stay: the old string `topicDrawer.byEngine` ("By engine", used by the Overview section until task 7) stays as it is, so the new group below is named `byEngineView`.

- `tabCompetitors` "Competitors"; `tabRelated` "Related".
- `view`: `label` "Topic view", `list` "List", `engines` "By engine", `heatmap` "Heat map".
- `byEngineView`: `gapHeader` "Engine gap"; `gapTip` "Best engine minus weakest engine, in points, over the engines that have a rate."; `gapValue` "{points} pts"; `gapSome` "{best} {bestRate} against {worst} {worstRate}, over {count, number} engines."; `gapNone` "A gap needs a rate on at least 2 engines."; `gapLeftOut` "Left out for too few answers: {engines}."; `leaderHeader` "Leader on {engine}"; `leaderCell` "{name} {share}"; `leaderNone` "None named"; `leaderNoneTip` "No tracked competitor is named in the answers of this topic on {engine}."; `leaderFewTip` "Too few answers that name a tracked brand on {engine}: {count, number} of the {min, number} it needs."; `leaderLoadingTip` "Competitors are loading."; `leaderTip` "{name}: {share} share of voice on {engine}, {answers, plural, one {# answer} other {# answers}} naming a brand. Own brand {own}."; `leaderTied` "Tied on share of voice with {others}. The higher mention rate comes first, then the order of the entities."; `leaderNote` "Leader: the tracked competitor with the highest share of voice in the answers of the topic on the engine."; `trendHeader` "Trend on {engine}"; `trendTip` "{pooled, number} of {total, number} weekly points show several weeks together."; `drillLabel` "Open the prompts of {topic} on {engine}"; `entitiesFailed` "Competitors could not be loaded. The other columns are shown."; `exportButton` "Export by engine"; `exported` "{count, plural, one {# topic exported} other {# topics exported}}"; `exportNone` "No topic to export"; `exportTopic` "Topic"; `exportParent` "Parent topic"; `exportPrompts` "Prompts"; `exportRate` "{engine} {metric} (%)"; `exportCounted` "{engine} answers that count"; `exportAnswers` "{engine} valid answers"; `exportChange` "{engine} change (points)"; `exportGap` "Engine gap (points)"; `exportBest` "Best engine"; `exportEngines` "Engines with a rate"; `listContext` "Best on {engine} {rate}, {count, plural, one {# engine} other {# engines}}"; `listNone` "No engine has a rate yet".
- `heat`: `title` "{metric} by topic and engine"; `meta` "{topics, plural, one {# topic} other {# topics}}, {engines, plural, one {# engine} other {# engines}}"; `rowHeader` "Topic"; `promptsHeader` "Prompts"; `average` "avg of {count, number}"; `averageTip` "Equal weight average of {engines}, each engine counting once."; `orderLabel` "Order rows by"; `orderPrompts` "Prompts"; `orderRate` "Average rate"; `orderGap` "Engine gap"; `footnote` "Topic rows overlap: a prompt in two topics counts in both. Each cell is prompt weighted. A cell over fewer than {min, number} answers shows its answers, not a rate."; `searchIgnored` "Search does not narrow the heat map."; `summary` "{metric} of {topics, plural, one {# topic} other {# topics}} on {engines, plural, one {# engine} other {# engines}}. Each cell links to the prompts behind it."; `cellLink` "{topic} on {engine}: {value}".
- `pooling`: `sentence` "A topic point with fewer than 10 prompts answering that week shows the last 4 weeks together, clipped to the window. A prompt point always shows 4 weeks."; `pointTitle` "{weeks, plural, one {1 week} other {# weeks}} to {date}".
- `header`: `addPrompt` "Add prompt"; `runNow` "Run now"; `runNoPrompts` "This topic holds no prompt to run."; `categoryTip` "Where the topic sits: {path}"; `scopeEngines` "{count, plural, one {# engine} other {# engines}}"; `scopeBranded` "Branded included"; `scopeNonBranded` "Non-branded"; `scopeLabel` "Scope of the counts: {scope}".
- `panel`: `caption` "{metric} by engine"; `metricLabel` "Metric of the engine panel"; `labelHeader` "Engine"; `valueHeader` "{metric}"; `contextHeader` "Answers"; `changeHeader` "Change"; `context` "{basis}, {prompts, plural, one {# prompt} other {# prompts}}"; `shareContext` "{answers, plural, one {# answer} other {# answers}} naming a brand, {prompts, plural, one {# prompt} other {# prompts}}"; `noAnswers` "No answers"; `rowName` "{engine}: {value}, {basis}"; `rowTip` "Opens the prompts of this topic on {engine}."; `stale` "No valid answer since {date}."
- `compare`: `gap` "Best on {best} at {bestRate}, weakest on {worst} at {worstRate}, a gap of {points} pts."; `within` "The difference is within normal variation (unpaired test on pooled answers)."; `detectable` "The difference is larger than normal variation (unpaired test on pooled answers)."; `noTest` "Too few answers to test the difference."; `noTestShare` "No test is given for share of voice."; `equal` "Every engine with a rate is at {rate}."; `none` "Fewer than 2 engines have a rate, so there is nothing to compare."; `zero` "No engine names the brand in this topic."; `leftOut` "Left out for too few answers: {engines}."
- `trend`: `title` "Trend by engine"; `meta` "{metric}, weekly"; `weekColumn` "Week"; `cell` "{value}, {basis}, {prompts, plural, one {# prompt} other {# prompts}}"; `cellThin` "{basis}, {prompts, plural, one {# prompt} other {# prompts}}, too few answers for a rate"; `cellNone` "No valid answer"; `footnote` "The band is the 95% interval of the pooled answers. A hollow point has fewer than {min, number} answers."; `summary` "{metric} of the topic on each engine, week by week."; `noSeriesTitle` "No weekly points yet"; `noSeriesReason` "This topic has no answer in the weeks of the window."
- `rivals`: `title` "Visibility trend against competitors"; `meta` "Mention rate of the own brand and the {count, number} most mentioned competitors"; `engineLabel` "Engine"; `engineAverage` "avg of {count, number} engines"; `own` "{name}, own brand"; `footnote` "Each competitor keeps the colour chosen for it in the entities. A competitor with no mention in the window is not shown."; `noneTitle` "No competitor named"; `noneReason` "No tracked competitor is named in the answers of this topic on the chosen engine."; `unavailableTitle` "Read per topic"; `unavailableReason` "Prompts without a topic have no weekly read of competitors."; `summary` "Mention rate of the own brand and of the competitors named most, week by week."
- `inSearch`: `title` "In search"; `keywords` "Keywords"; `keywordsNote` "tracked and given this topic"; `top10` "Top 10"; `top10Note` "of {total, number} tracked"; `open` "Open in Rankings"; `noneTitle` "No tracked keyword is given this topic"; `noneReason` "Tracked keywords carry their own topics. Give this topic to a keyword in Rankings to count it here."; `failedTitle` "The search counts could not be loaded".
- `competitors`: `title` "Competitors by engine"; `entity` "Entity"; `own` "own brand"; `metricLabel` "Competitor metric"; `metricMentioned` "Mentioned"; `metricShare` "Share of voice"; `cell` "{value}, {basis}"; `leads` "leads on {engine}"; `footnote` "The tracked set of the answers read, at most 20 entities, the own brand first. The leading competitor on each engine is in bold."; `emptyTitle` "No tracked competitor"; `emptyReason` "Add a competitor in Entities to compare it here."; `failedTitle` "Competitors could not be loaded".
- `related`: `title` "Topics beside this one"; `topic` "Topic"; `prompts` "Prompts"; `mention` "Mention"; `more` "{count, plural, one {# more topic is} other {# more topics are}} in the Topics table."; `emptyTitle` "No topic beside this one"; `emptyReason` "This topic has no sibling in the tree."; `open` "Open the topic {name}".
- `promptsTab`: `engineChip` "Engine: {engine}"; `engineChipRemove` "Show every engine"; `note` "{count, plural, one {# prompt has} other {# prompts have}} answers on {engine}, ordered by {metric}."; `emptyTitle` "No prompt has an answer on {engine}"; `emptyReason` "Show every engine to list the prompts of this topic."

## 3. Files, ownership and leases

Owned (the brief): `topic-inspector.tsx` (sole owner in wave 2, but leased to WP-16, task 7 only), `D/` (new), `T/` (new), `C/topic-engine-panel.tsx`. Also owned by being new: `e2e/flows/ai-topics-by-engine.spec.ts` and the tests beside every new file. Tests of an owned file: `topic-drawer.test.tsx` (task 7).

New files (nothing else is created):

- `T/`: `cells-fixtures.ts` (test builders), `engine-values.ts`, `leaders.ts`, `series-model.ts`, `comparison.ts`, `drill.ts`, `use-drill.ts`, `topic-entities-query.ts`, `engine-columns.tsx`, `metric-select.tsx`, `view-switch.tsx`, `topics-view.tsx`, `topic-rows.ts`, `heat-model.ts`, `topic-heatmap.tsx`, `by-engine-export.ts`, `topics-mobile-list.tsx`, `list-lines.ts`, each with its test beside it.
- `D/`: `drawer-context.tsx`, `test-support.tsx`, `topic-trend-query.ts`, `engine-panel.tsx`, `comparison-line.tsx`, `engine-trend.tsx`, `rivals-trend.tsx`, `engine-sections.tsx`, `entity-table-model.ts`, `topic-competitors-tab.tsx`, `related-model.ts`, `topic-related-tab.tsx`, `header-model.ts`, `use-topic-header.tsx`, `topic-order-store.ts`, `prompts-behind.ts`, `engine-filter.tsx`, `in-search.tsx`, each with its test.
- `C/topic-engine-panel.tsx` and `.test.tsx`.

### LEASES TO ASK THE COORDINATOR FOR

| # | Exact path | Owner now | Edit (smallest) | Why | Needed by |
|---|---|---|---|---|---|
| L1 | `apps/web/src/features/prompts/topics-table.tsx` | WP-18 | (a) `type TopicRow` becomes `export type TopicRow`; (b) two optional props: `viewColumns?: readonly DataTableColumn<TopicRow>[] \| undefined` (columns that replace the per engine count columns) and `onTopicOrderChange?: ((keys: readonly string[]) => void) \| undefined`; (c) in the `columns` memo `...engineColumns.map(blankOnMore)` becomes `...(viewColumns ?? engineColumns).map(blankOnMore)`, deps updated; (d) one `useEffect` that reports the keys of the topic rows in drawn order, as `onPromptOrderChange` does for prompts | The By engine view replaces the count columns; J and K between topics need the drawn order. The rest of the By engine view is built outside the file | task 2 |
| L2 | `apps/web/src/features/prompts/prompts-screen.tsx` | WP-17 | Hunk 1 (task 2): import `TopicsView` and render it in place of `TopicsTable` with the same props plus `scope`, `range`, `includeBranded`, `country`. Hunk 2 (task 7): pass one `extras` prop to `TopicInspector` (`scope`, `range`, `includeBranded`, `country`, `workspaceSlug`, `projectSlug`, `tree`, `countryName`, `onAddPrompt: canWrite ? openAdd : null`, `run: canRun ? { onRun: actions.run, blockedReason: actions.busyReason ?? listReason } : null`) | The view wrapper and the drawer need the screen's scope and its two actions. Two hunks, about 25 lines | tasks 2 and 7 |
| L3 | `apps/web/src/features/prompts/topic-inspector.tsx` | WP-20, leased to WP-16 (T10, L3) | Task 7 only: new prop `extras`; the provider around the body; `useTopicHeader` spread into `header` and `onStep`; the "By engine" `InspectorSection` replaced by `<TopicEngineSections />`; the local `Rate` removed. WP-16's `DrawerCustomizer` wrapper, `guardClose`, More item and footer stay as they are | Brief step 5; WP-16 plan says WP-20 rebases onto its edit | task 7 (ask before it starts: has WP-16 merged, and who rebases onto whom) |
| L4 | `apps/web/src/mocks/handlers/prompt-answers.ts`, `apps/web/src/mocks/prompt-summary.ts` and their tests `apps/web/src/mocks/handlers/prompt-series.test.ts`, `apps/web/src/mocks/prompt-summary.test.ts` | nobody named (the F-14 commit of this package edited them) | Task 2: accept `rows=topics` and `rows=none`. Task 5: entity cells inside each weekly point when `series` and `entities` are both asked | The mock `422`s on `rows` and never sends `WeekCells.entities` (F3) | tasks 2 and 5 |
| L5 | `apps/web/messages/en.json` | shared file | Additive: new sub-objects under `prompts.topicDrawer` only (section 2.7); no new top-level key; the namespace was pre-created for this package. One early commit (task 1) | Every string of the package | task 1 |
| L6 | `apps/web/src/features/prompts/seams/topic-tabs.ts` | seam file (MASTER-PLAN 3.4 allows it) | Uncomment the two WP-20 import lines and the two slot lines, with the import path changed to `../topic-drawer/topic-competitors-tab` and `../topic-drawer/topic-related-tab`. Nothing else in the file | The tabs | task 7 |
| L7 | `apps/web/src/components/design-system/chart-parts-section.tsx` | WP-05 (merged) | One specimen group of `TopicEnginePanel` (rule 19). No new section, so `registry.ts`, `section-slugs.ts` and `registry.test.tsx` stay as they are | A new shared component needs a gallery entry | task 4 |
| L8 | `docs/design-system/24-page-templates.md` (section 9.5) and `docs/design-system/25-component-inventory.md` (SC-26 and the deviations list) | docs | Append-only "As built (2026-11-13, WP-20)" paragraphs | The web as built note the brief asks for | task 7 |

Not requested, on purpose: `prompt-queries.ts` (own query files), `export-rows.ts` (the by engine export has other columns and its own builder), `rate-columns.tsx`, `prompt-columns.tsx`, `trend-column.tsx`, `topic-tree.ts` (imports only), `lib/layouts/catalog.ts` (WP-16 L5), `registry.ts`, `en.json` outside `prompts.topicDrawer`.

## 4. Tasks

### Task 1: Message keys and the per engine model (two commits)

**1a `WP-20: message keys`.** Add every key of section 2.7 to `en.json` under `prompts.topicDrawer`. Files: `apps/web/messages/en.json`. Check: `pnpm vitest run src/i18n --maxWorkers=2` (the catalog rules: no dash, no contraction, no double space, camelCase). Haiku may write the strings; Sonnet commits.

**1b `WP-20: per engine model`.** Pure functions, no React.

Files (create): `T/cells-fixtures.ts` (builders `cell(k, n)`, `weighted(k, n, prompts)` with `pooled`, `engine(code, metrics)`, `entityCells`, `week(...)`), `T/engine-values.ts`, `T/leaders.ts`, `T/series-model.ts`, `T/comparison.ts`, `T/drill.ts`, and a `.test.ts` beside each.

Signatures:
```ts
// engine-values.ts
export interface EngineValue { code: string; state: RateState; value: number | null; answers: number; successes: number | null; prompts: number | null; observations: number; reason: RateReason | null }
export function engineValue(cells: readonly EngineSummary[] | undefined, code: string, metric: CellMetric): EngineValue;
export interface BestWorst { best: EngineValue | null; worst: EngineValue; spread: number; counted: number; leftOut: string[] }
export function bestWorst(values: readonly EngineValue[]): BestWorst | null;   // null under 2 engines with state ok
export const engineGapOf: (values: readonly EngineValue[]) => number | null;    // the sort value
// leaders.ts
export type LeaderState = 'leader' | 'none-named' | 'too-few' | 'unknown';
export interface EntityLeader { engineCode: string; state: LeaderState; entityId: string | null; name: string | null; share: MetricCell | null; mentioned: MetricCell | null; own: MetricCell | null; tiedWith: string[] }
export function leaderOn(engine: EngineSummary | undefined, tracked: readonly SummaryEntity[]): EntityLeader;
export function topCompetitors(engine: EngineSummary | undefined, tracked: readonly SummaryEntity[], count: number): string[];
// series-model.ts
export interface TopicPoint { weekStart: string; value: number | null; k: number | null; n: number; prompts: number; pooled: boolean; weeks: number; window: PointPool['window'] | null; band: Interval | null; thin: boolean }
export function enginePoints(cell: EngineSummary | undefined, metric: CellMetric): TopicPoint[] | null;   // null: no series
export function averagePoints(series: readonly TopicPoint[][]): TopicPoint[];                             // equal weight per week, engines with a rate only
export function poolNote(points: readonly TopicPoint[]): { pooled: number; total: number };
export interface EntityLine { entityId: string; name: string; role: 'own' | 'competitor'; points: TopicPoint[] }
export function entityLines(cell: EngineSummary | undefined, tracked: readonly SummaryEntity[], top: number): EntityLine[];
// comparison.ts
export type Comparison =
  | { kind: 'none'; leftOut: string[] } | { kind: 'zero'; leftOut: string[] } | { kind: 'equal'; value: number; leftOut: string[] }
  | { kind: 'gap'; best: EngineValue; worst: EngineValue; points: number; test: 'within' | 'detectable' | 'too-few' | 'share'; leftOut: string[] };
export function compareEngines(values: readonly EngineValue[], metric: CellMetric): Comparison;
// drill.ts
export const ENGINE_PARAM = 'eng';
export type TopicsView = 'list' | 'engines' | 'heatmap';
export const parseView: (value: string | null) => TopicsView;
export const parseEngineParam: (value: string | null, codes: readonly string[]) => string | null;
export function drillHref(pathname: string, search: string, topicKey: string, engineCode: string): Route;
```

Tests first (names; each asserts the value and the words data it names):
- `engine-values.test.ts`: `reads a topic cell as its percent, the answers behind it and the prompts it weights`; `reads a prompt cell by its denominator`; `is insufficient under 4 valid answers and none with no answer, never 0`; `gives the reason a share of voice is missing: no answers, none valid, no brand named`; `takes the best and the weakest engine among those with a rate`; `breaks a tie by the order the engines are shown in`; `leaves an engine with too few answers out and names it`; `has no gap under 2 engines with a rate`; `has no best engine when every rate is 0`; `gives the exact spread, not the spread of rounded percents`; `an average across engines says how many engines took part and never counts a missing engine as 0` (WB-TPE-18).
- `leaders.test.ts`: `picks the competitor with the highest share of voice on the engine`; `never picks the own brand`; `breaks a tie by the higher mention rate, then by the order of the entities, and names the tied`; `says none named when every competitor is at 0`; `says too few when fewer than 4 answers name a tracked brand`; `is unknown without entity cells`; `ignores an entity that is not in the tracked set`; `gives the own share beside the leader`; `takes the 3 most mentioned competitors by window mentions, ties by order`; `never takes a competitor with 0 mentions`.
- `series-model.test.ts`: `reads a pooled topic point with its pool weeks, window and the prompts of its own week`; `reads an unpooled point as its own week`; `puts the Wilson band on the pooled answers from 4 answers`; `makes a point under 4 answers hollow with no band`; `makes a week with no valid answer a gap, never 0`; `makes a cell with unreadable counts a gap`; `counts the pooled points of a series`; `averages engines per week with equal weight over the engines that have a point`; `builds an entity line per tracked entity from the week entity cells`; `leaves an entity missing from a week as a gap`; `orders lines own first then the top competitors`.
- `comparison.test.ts`: `names best, weakest and the gap in points`; `says within normal variation when the unpaired interval holds 0`; `says larger than normal variation when it excludes 0`; `gives no test for share of voice`; `gives no test when an engine is thin`; `names the engines left out`; `says every engine is equal when the rates tie`; `says nothing to compare under 2 engines`; `says no engine names the brand when the best is 0`.
- `drill.test.ts`: `builds the drill-down address and keeps the other keys`; `replaces an earlier inspect, itab and eng`; `keeps the key __none`; `parses eng against the engines shown and drops an unknown code`; `reads view: list by default, engines, heatmap, anything else is list`.

Notes: import `cellFigure`, `validAnswers`, `averageRate`, `hasRate` from `@/lib/rates/rate-model`, `MIN_OBSERVATIONS`, `wilsonInterval`, `isDetectableChange`, `rateState` from `@/lib/stats`. Do not copy them. `engineValue` for a topic cell reads `prompts` from the denominator when `pooled` is set and from nothing for a prompt cell (`null`). Messages are not imported in these files: they return data and the components put words to it.
Checks: light, medium typecheck, `pnpm vitest run src/features/prompts/topics-by-engine --maxWorkers=2`.
Rows: none closed here (proofs of WB-TPE-05, 06, 08, 11, 14, 18 start here and finish in tasks 2, 4, 5 and 7).

### Task 2: Topics tab, By engine view

Step 0: read `git log origin/develop -- apps/web/src/features/prompts/topics-table.tsx` and `prompts-screen.tsx`; if WP-17 or WP-18 changed them, rebase and re-read before the hunks.

Files (create): `T/topic-entities-query.ts`, `T/metric-select.tsx`, `T/view-switch.tsx`, `T/use-drill.ts`, `T/engine-columns.tsx`, `T/topics-view.tsx`, and `D/topic-order-store.ts` (the store `T/topics-view.tsx` fills; task 6 reads it). Tests beside each, `D/topic-order-store.test.ts` included. Modify: L1 hunks in `topics-table.tsx`, L2 hunk 1 in `prompts-screen.tsx`, L4 hunk 1 (`rows`) in the two mock files and one new test `mocks/handlers/prompt-summary-rows.test.ts` (new file, no lease).

Types and signatures:
```ts
// topic-entities-query.ts
export interface TopicReadScope { scope: PromptScope; range: DateRange; includeBranded: boolean; country: string | null }
export const topicEntitiesQuery = (read: TopicReadScope): ApiQueryOptions<typeof SUMMARY>;
export interface EntityRead { status: 'loading' | 'failed' | 'ready'; rows: ReadonlyMap<string, TopicSummaryRow>; tracked: readonly SummaryEntity[]; fetching: boolean; retry: () => void }
export function useTopicEntities(read: TopicReadScope, enabled: boolean): EntityRead;   // key of a row: term_id ?? NO_TOPIC
// engine-columns.tsx
export interface ByEngineOptions<TRow> { engines: readonly ProjectEngine[]; cellsOf: (row: TRow) => readonly EngineSummary[] | undefined; topicKeyOf: (row: TRow) => string | null; entities: EntityRead; metric: RateMetric; onDrill: (topicKey: string, engineCode: string) => void }
export function useByEngineColumns<TRow>(options: ByEngineOptions<TRow>): DataTableColumn<TRow>[];
// topics-view.tsx
export type TopicsViewProps = TopicsTableProps & TopicReadScope;
export function TopicsView(props: TopicsViewProps): ReactElement;
```
`cellsOf` and `topicKeyOf` are module level functions (the columns are keyed by their identity).

Behaviour:
- `TopicsView` reads `view` (and `metric`). List: `<TopicsTable {...props} viewSwitch={<>{ViewSwitch}{props.viewSwitch}</>} onTopicOrderChange={set} />`. By engine: `<TopicsTable key="engines" {...props} viewColumns={columns} viewSwitch={<>{MetricSelect}{ViewSwitch}{ExportButton}{props.viewSwitch}</>} status={refetching if entities fetch} />`; the `key` resets the column chooser when the view changes. The Heat map and the phone list arrive in task 3: until then the view switch has two items (List, By engine) and `?view=heatmap` reads as the List.
- `useByEngineColumns` returns, in order: the engine rate columns of `useEngineRateColumns` (visible, each cell for a topic row wrapped in a drill button and its tooltip gaining the leader sentence when entities are read), the Engine gap column (id `engine_gap`, priority 3, sortable), then in the chooser only (`defaultVisible: false`): the per engine count columns of `useEngineColumns(..., { sortable: true, defaultVisible: false })`, one Trend column per engine (ids `trend_<code>`, `SparklineCell`, priority 3, tooltip with the pooled count and the C-18 sentence when any point is pooled) and one Leader column per engine (ids `leader_<code>`).
- The drill button: `Button variant="link"` with `CELL_CONTROL`, `aria-label` `byEngineView.drillLabel`, `onClick` calls `onDrill`. A prompt row's engine cell stays plain text. The drill (`use-drill.ts`) calls `useInspector().open({ type: 'topic', id }, { tab: 'prompts' })` and writes `eng` with nuqs in the same tick.
- Entities read failing: `Banner tone="warning"` above the table ("Competitors could not be loaded...", Retry), leader cells blank with `leaderLoadingTip`; the rest shows.
- The topic order store (`D/topic-order-store.ts`): `setTopicOrder(projectId, keys | null)`, `useTopicOrder(projectId)`; `TopicsView` writes it from `onTopicOrderChange` and clears it on unmount.
- Mock: accept `rows` (`topics` or `none`, else `422` at `rows`); `topics` leaves `prompts` empty, `none` leaves both lists; everything else as before.

Tests first:
- `topic-entities-query.test.ts`: `asks for topic rows with entities and nothing else`; `sends the window, the branded choice and the country`; `reads a body with no entity blocks as no entities`; `keeps the last rows while the next window is read`.
- `engine-columns.test.tsx`: `shows one rate column per engine for the chosen metric with its percent and its count`; `shows the insufficient pill under 4 answers and n/a with none`; `sorts by an engine rate, a row without one last in both directions`; `sorts by the engine gap`; `the gap cell says best and weakest with rates and counts and names the engines left out`; `the gap is n/a under 2 engines with a rate`; `a topic engine cell is a button that opens the drawer on Prompts with that engine`; `a prompt row engine cell is plain text`; `leader columns wait in the chooser and show the leader with share and count`; `the leader says None named, too few or nothing while loading`; `trend columns wait in the chooser, draw a line and say how many points are pooled with the C-18 sentence`; `no column writes a 0 for a missing value`.
- `topics-view.test.tsx` (harness of `topic-drawer.test.tsx`: `PromptsScreen`, MSW, `renderOn`): `opens on the List exactly as before`; `shows the By engine columns for ?view=engines and the metric of ?metric=`; `the metric select writes ?metric and changes the columns`; `the view switch writes ?view and keeps the other keys`; `sorts by the ChatGPT rate from ?sort=chatgpt_web_rate`; `an engine cell opens the drawer on the Prompts tab with ?eng=`; `a topic opened onto its prompts shows each prompt with its value on every engine (child rows)`; `reads the entities once for the view and not in the List`; `keeps the rows and shows the refetch bar while entities refetch`; `says competitors could not be loaded and keeps the other columns`; `an unknown view is the List`; `fills the topic order store in drawn order and empties it on unmount`.
- `prompt-summary-rows.test.ts` (mock): `rows=topics leaves the prompt rows out and keeps the topic rows`; `rows=none leaves both lists`; `an unknown rows value is 422 at rows`; `without rows every row is returned as before`.
- `topic-order-store.test.ts`: `keeps the order per project`; `empties`.

Checks: light on changed files; medium typecheck; targeted: `src/features/prompts/topics-by-engine src/features/prompts/topic-drawer src/mocks` then the whole `src/features/prompts` folder (L1, L2 changed).
Rows: WB-TPE-02, 03, 04, 05, 06, 07 (table side), 08, 15.
Commit: `WP-20: Topics by engine view`.

### Task 3: Topics tab, heat map, export and phone rows

Step 0: `grep -rn DataTableList apps/web/src/features/prompts`. If WP-18 has wired a phone list into Topics, build only `list-lines.ts` and hand its two functions to that call site (a one function lease, asked first); otherwise wire `topics-mobile-list.tsx` as below and tell the coordinator that WP-18 WB-TOP-34 should adopt or delete it.

Files (create): `T/topic-rows.ts`, `T/heat-model.ts`, `T/topic-heatmap.tsx`, `T/by-engine-export.ts`, `T/list-lines.ts`, `T/topics-mobile-list.tsx`, tests beside each. Modify: `T/view-switch.tsx` (third item), `T/topics-view.tsx` (heat map, export button, phone list).

Signatures:
```ts
// topic-rows.ts: the topic tree of the page as plain heads (shared by the heat map and the phone list)
export interface TopicHead { key: string; name: string; path: string; promptCount: number; engines: readonly EngineSummary[]; members: readonly PromptSummaryRow[] | null; children: TopicHead[] }
export function topicHeads(args: { summary: PromptsSummary | undefined; tree: readonly NamedTerm[]; descendants: TopicDescendants; kept: ReadonlySet<string>; filtering: boolean; search: string | null; locale: string }): TopicHead[];
// heat-model.ts
export interface HeatInput { head: TopicHead; value: EngineValue[]; average: AverageRate; gap: number | null }
export function heatOrder(heads: readonly TopicHead[], order: 'prompts' | 'avg_rate' | 'engine_gap', metric: CellMetric, codes: readonly string[]): TopicHead[];
// by-engine-export.ts
export function buildByEngineExport(heads: readonly TopicHead[], engines: readonly ProjectEngine[], metric: RateMetric, labels: ByEngineExportLabels): CsvTable;
export const byEngineFileName = (metric: RateMetric, range: DateRange): string;
// list-lines.ts
export function topicListLines(head: TopicHead, engines: readonly ProjectEngine[]): { identity: string; best: { code: string; value: number } | null; engines: number };
```
Behaviour:
- Heat map: `ChartFrame kind="html"` with `HeatmapGrid scale="sequential"` and its Table form, `heatmapCsv` in the frame menu, `useRateTipWords` and `rateTipText` for every cell tip (counts, prompts, pooled weeks never apply: cells are window cells). Rows: the top level topics, children in place (two levels, as the table; the third level waits for WP-18 WB-TOP-11), "No topic" last. Columns: the engines shown in order, then "avg of N" only when 2 or more engines are shown, labelled equal weight. Cell: percent, hatched "n ans" under 4 answers, "n/a" with none. `href` is `drillHref` (the current pathname and search from `usePathname` and `useSearchParams`). Prompts column. A toolbar row above the frame: metric Select, "Order rows by" Select (`heat.order*`), view switch. Footnote `heat.footnote`. `heat.searchIgnored` shows when `?q` is set. `status` loading, refetching, error (the screen's `errorState`), empty (the screen's empty states).
- Export: a ghost button "Export by engine" in the By engine toolbar. Rows: every topic of the tree (parents then children; "Parent topic" column), columns Topic, Parent topic, Prompts, then per engine `{engine} {metric} (%)` (a number, 1 decimal), `{engine} answers that count` (whole successes; empty for share of voice, which has none), `{engine} valid answers`, then Engine gap (points), Best engine, Engines with a rate; change columns (`{engine} change (points)`) only when any engine cell carries `previous`, empty where it has none. Every text through `safeText`; unknown is an empty cell, never 0. Downloads through `csvBlob` and `downloadBlob`, one toast `byEngineView.exported` or `exportFailed` (existing `prompts.bulk.exportFailed`).
- Phone (under 768 px, `useMediaQuery(LIST_MEDIA)`): `DataTableList` of the topic heads (children follow their parent, identity is the path "Parent / Child"), line 1 identity and the average mention rate with `valueLabel` "Mention rate", line 2 `listContext` ("Best on AI Mode 41%, 3 engines") or `listNone`, no delta. The row opens the drawer on Overview.

Tests first:
- `topic-rows.test.ts`: `lists the top level topics with their children under them`; `keeps only the topics a filter keeps and the topics below them`; `finds a topic by its name or by the text of one of its prompts`; `puts No topic last and never under a parent`.
- `heat-model.test.ts`: `orders by prompts, then by name`; `orders by the average rate of the chosen metric, a topic without one last`; `orders by the engine gap, a topic without one last`; `the average appears only with 2 or more engines and counts only engines with a rate`.
- `by-engine-export.test.ts`: `writes one row per topic with a parent column`; `writes each engine rate as a number with its counts`; `leaves share of voice counts empty, never 0`; `leaves an engine without answers empty`; `adds the change columns only when a cell has previous`; `writes text so a spreadsheet does not read a formula`; `names the file by metric and window`.
- `list-lines.test.ts`: `names the best engine with its rate and counts the engines that show a rate`; `says no engine has a rate yet`; `never names an engine with a best rate of 0`.
- `topic-heatmap.test.tsx`: `prints every cell value with the counts in its tip`; `hatches a cell under 4 answers with its answers and says n/a with none`; `shows the average column only with 2 or more engines and names the engines in its tip`; `a cell links to the drawer on Prompts with that engine and keeps the filters`; `a row opens the drawer on Overview`; `children open in place with the chevron and the keyboard`; `the order select writes ?sort`; `the Table form says the same in words`; `says search does not narrow it when ?q is set`; `shows skeleton, empty, error with retry and the refetch state`; `the footnote says topic rows overlap`.
- `topics-view.test.tsx` additions: `the view switch offers List, By engine and Heat map`; `Export by engine downloads the file and toasts the count`; `renders the phone list under 768 px with the best engine and the engine count`; `the phone list opens the drawer`.
- `topics-mobile-list.test.tsx`: `renders two line rows`; `opens the topic drawer on Overview`; `keeps the topic order for the drawer's Previous and Next`.

Checks: light, medium typecheck, targeted `src/features/prompts/topics-by-engine` then the whole `src/features/prompts` folder. Push point 1 (after the coordinator's word): rebase, re-run, push.
Rows: WB-TPE-07 (heat side), WB-TPE-16, WB-TPE-17 (list line).
Commit: `WP-20: Topics heat map, export and phone rows`.

### Task 4: Drawer Overview: engine panel, per engine trend, comparison

Files (create): `C/topic-engine-panel.tsx`, `D/drawer-context.tsx`, `D/test-support.tsx`, `D/topic-trend-query.ts`, `D/engine-panel.tsx`, `D/comparison-line.tsx`, `D/engine-trend.tsx`, `D/engine-sections.tsx`, tests beside each. Modify: L7 (`chart-parts-section.tsx`, one specimen).

Types and signatures:
```ts
// C/topic-engine-panel.tsx
export interface EnginePanelRow { code: string; label: string; state: 'ok' | 'insufficient' | 'none'; value: number | null; valueText: string; contextText: string | null; noneText: string; accessibleText: string; tip?: string; href?: Route; delta?: ComparisonRow['delta'] }
export interface TopicEnginePanelProps { caption: string; labelHeader: string; valueHeader: string; contextHeader: string; changeHeader?: string; rows: readonly EnginePanelRow[]; density?: Density }
export function TopicEnginePanel(props: TopicEnginePanelProps): ReactElement;   // BarList mode="comparison", own: false, EngineLogo icon, thin and none kinds
// D/drawer-context.tsx
export interface TopicDrawerExtras { scope: PromptScope; range: DateRange; includeBranded: boolean; country: string | null; workspaceSlug: string; projectSlug: string; tree: readonly NamedTerm[]; countryName: (iso: string) => string; onAddPrompt: ((termId: string) => void) | null; run: { onRun: (promptIds: readonly string[]) => void; blockedReason: string | null } | null }
export interface TopicDrawerState { topicKey: string; summary: PromptsSummary | undefined; counts: TopicCounts; engines: readonly ProjectEngine[]; descendants: TopicDescendants; extras: TopicDrawerExtras }
export function TopicDrawerProvider(props: { value: TopicDrawerState; children: ReactNode }): ReactElement;
export function useTopicDrawer(): TopicDrawerState;      // throws a descriptive Error outside the provider
// D/topic-trend-query.ts
export const topicTrendQuery = (read: TopicReadScope, termId: string): ApiQueryOptions<typeof SUMMARY>;
export interface TopicTrend { status: 'loading' | 'failed' | 'ready'; row: TopicSummaryRow | undefined; tracked: readonly SummaryEntity[]; fetching: boolean; retry: () => void }
export function useTopicTrend(read: TopicReadScope, topicKey: string, enabled: boolean): TopicTrend;   // __none: row from the page summary, no read
// D/engine-sections.tsx
export function TopicEngineSections(): ReactElement;   // fragment of InspectorSections: By engine, Trend by engine (tasks 5 and 6 add Visibility trend and In search here)
```
Behaviour:
- `TopicEnginePanel` stays generic (rows in, `BarList` out) so the prompt inspector strip and the Overview can reuse it (SC-26). The By engine section of the drawer is `InspectorSection title="By engine"`: the panel, the metric control (Mention, Citation, Share of voice; writes `metric`; labels `prompts.metric.*`), the comparison sentence, the weighted note. Row `href` is `?inspect=topic:<id>&itab=prompts&eng=<code>` built with `drillHref`.
- Panel values come from `engineValue`; the change comes from `previous` (`delta`: points between the cell and `previous`, `isDetectable` from `isDetectableChange` on pooled counts, absent without `previous`; `formatMetricDelta`).
- Trend by engine: `ChartFrame kind="line"` with a Wilson band per engine from `rateBandOption` and `enginePoints` (the pattern of `inspector-history.tsx`: `engineRole` colours, `cellText` for the Table form, `titles` from `pooling.pointTitle`), footnote `trend.footnote` plus `pooling.sentence` when `poolNote` says any point is pooled. States: loading, empty (`trend.noSeriesTitle`), error with Retry, `refetching` keeps the chart, partial (an engine without a series is simply not drawn and the table form says so), stale (`panel.stale` in the meta line).
- `useTopicTrend` reads `filter[term]` under `enabled`; for `__none` it returns the page summary's row and never reads.
- Every component reads its data from `useTopicDrawer()`; tests render through `D/test-support.tsx` (`renderDrawerPart(ui, { summary, engines, extras })`).

Tests first:
- `topic-engine-panel.test.tsx`: `draws a row per engine with logo, bar, percent and the counts beside it`; `a row under 4 answers shows the small sample marker and no bar`; `a row without answers says so and is never 0`; `a row is a link when it has an href, named by engine and value`; `shows the change only when a row has one`; `has a table form and passes the accessibility check`.
- `engine-panel.test.tsx`: `lists every engine shown in order with percent and k of n`; `share of voice says answers naming a brand and never a count of successes`; `the metric control switches Mention, Citation and Share of voice and writes ?metric`; `an engine row leads to the Prompts tab filtered to that engine`; `shows the weighted note`; `shows the change in points only when cells carry previous, coloured only when detectable`; `an engine with no data says no answers`; `loading is a skeleton, a failed read has Retry, an unknown topic says so`; `keeps the rows while a new window is read`.
- `comparison-line.test.tsx`: `says best and weakest with rates and the gap in points`; `says within normal variation or larger, labelled unpaired on pooled answers`; `names the engines left out`; `says there is nothing to compare under 2 engines`; `says no engine names the brand`; `never writes a rate of 0 for an engine without data`.
- `engine-trend.test.tsx`: `draws one line per engine with the weekly rate and a table form with the same words`; `says the C-18 sentence in the footnote only when a point is pooled`; `the table row of a pooled point names the weeks it holds`; `a point under 4 answers is hollow with no band`; `a week with no valid answer is a gap`; `says there are no weekly points yet when the series is absent`; `keeps the chart while it refetches`; `reads the weeks of filter[term] for a topic and the page row for No topic`.
- `topic-trend-query.test.ts`: `asks rows=topics with include=series,entities and filter[term]`; `takes the row whose term_id is the key`; `reads a body without series as no series`.
- `drawer-context.test.tsx`: `throws outside the provider with a clear message`.
- Gallery: the existing gallery test file must still pass (`src/components/design-system`).

Checks: light, medium typecheck, targeted `src/components/app/chart src/components/design-system src/features/prompts/topic-drawer`.
Rows: SC-26, WB-TPE-09, 10, 11, 12 (panel link), WB-TI-10 (the built row is now proven by the panel test), WB-TI-11, CF-31.
Commit: `WP-20: Topic drawer engine panel and trend`.

### Task 5: Drawer competitors: own against top 3, Competitors tab, Related tab

Files (create): `D/rivals-trend.tsx`, `D/entity-table-model.ts`, `D/topic-competitors-tab.tsx`, `D/related-model.ts`, `D/topic-related-tab.tsx`, tests beside each. Modify: `D/engine-sections.tsx` (adds the Visibility trend section), L4 hunk 2 (entities per week in the two mock files and their tests).

Signatures:
```ts
// entity-table-model.ts
export interface EntityTableRow { entityId: string; name: string; role: 'own' | 'competitor'; cells: { engineCode: string; value: MetricCell | null; leads: boolean }[] }
export function entityTable(row: TopicSummaryRow | undefined, tracked: readonly SummaryEntity[], codes: readonly string[], metric: 'mentioned' | 'share_of_voice'): EntityTableRow[];   // own first, then competitors, at most 20
// related-model.ts
export function parentOf(key: string, descendants: TopicDescendants): string | null;       // smallest other set that holds the key
export interface Sibling { key: string; name: string; promptCount: number; mention: AverageRate }
export function siblingsOf(key: string, summary: PromptsSummary | undefined, descendants: TopicDescendants, codes: readonly string[]): { shown: Sibling[]; more: number } | null;   // null: descendants not read
// topic-competitors-tab.tsx / topic-related-tab.tsx
export const topicCompetitorsTab: TopicInspectorTab;   // id 'competitors', available while loading or with a tracked competitor
export const topicRelatedTab: TopicInspectorTab;        // id 'related', available with siblings
```
Behaviour:
- Mock: when `include` holds `series` and `entities`, each `WeekCells` carries `entities` for `cellEntityIds` over the very weeks the point holds (the pool when pooled); topic points weight Mentioned by prompt and share of voice by answer; absent unless both are asked. Arithmetic in `mocks/prompt-summary.ts` (`weeklySeries` gets the entity counts per prompt and week), handler passes them.
- Rivals chart (WB-TI-12, WB-TPE-14): `ChartFrame kind="line"`, engine Select (default "avg of N engines" when 2 or more engines have a series, then each engine), lines: own brand `chart-1`, the 3 top competitors with their stored colour (`projectEntitiesQuery`, `color_index`; fallback by order), band per line, hollow under 4 answers, the same pooled language as task 4 (`pooling.sentence` in the footnote when any plotted point is pooled), legend with swatches and names (`rivals.own`). States: loading, empty (`rivals.noneTitle`), "No topic" (`rivals.unavailableTitle`), error with Retry, partial (an engine without series is not an option), refetching keeps the chart. Never an invented line: a competitor with no mention in the window is not drawn.
- Competitors tab (WB-TPE-13): `InspectorSection` with a Mentioned or Share of voice control (default Share of voice, the leader rule's metric), a table (entities down, engines across, `Truncate` names, own brand first and tagged "own brand"), each cell value with the answers behind it, the leader per engine in `type-body-strong` with an sr-only "leads on {engine}", the footnote. Data: `useTopicEntities` (cached from the By engine view when it ran), the row of the topic key (also `__none`). States: loading, no tracked competitor (empty with the Entities hint), failed (`competitors.failedTitle`, Retry), partial (an engine without cells shows "No answers").
- Related tab (WB-TI-19): table of siblings (`related-model`): name button (opens that drawer on the Related tab through `useInspector().open`), prompts, mention rate "avg of N" with its count in the tooltip, at most 10 by prompt count, `related.more` for the rest; empty `related.emptyTitle`; while `descendants` is not read the tab body is a skeleton.

Tests first:
- `entity-table-model.test.ts`: `puts the own brand first then competitors, at most 20`; `marks the leader of each engine`; `gives a null cell for an entity without cells, never 0`; `uses mentioned or share of voice as asked`.
- `related-model.test.ts`: `finds the parent as the smallest other topic that holds it`; `lists the topics that share its parent`; `lists the other top level topics for a top level topic`; `orders by prompts, caps at 10 and counts the rest`; `is null while descendants are not read`.
- `rivals-trend.test.tsx`: `draws the own brand and the three most mentioned competitors`; `defaults to the average of the engines and names how many took part`; `switches to one engine`; `uses the stored colour of a competitor`; `says the C-18 sentence when a plotted point is pooled`; `never draws a competitor with no mention`; `says no competitor is named`; `says No topic is read per topic`; `shows loading, error with Retry and keeps the chart while refetching`.
- `topic-competitors-tab.test.tsx`: `shows entities by engine with the answers behind each value, own first`; `marks and names the leader on each engine`; `switches between Mentioned and Share of voice`; `says no tracked competitor with the Entities hint`; `retries a failed read`; `an engine without cells says no answers`; `states the 20 entity cap in the footnote`; `is offered while loading and when a competitor is tracked, not otherwise`.
- `topic-related-tab.test.tsx`: `lists sibling topics with prompts and mention and opens one on the Related tab`; `says no sibling`; `counts the topics it does not list`; `is offered only with siblings`.
- Mock tests (`prompt-series.test.ts` additions): `a weekly point carries entity cells when series and entities are asked`; `a pooled point carries the entity cells of the weeks it pools`; `a topic point weights Mentioned by prompt and share of voice by answer`; `entities are absent from a point unless both includes are asked`.

Checks: light, medium typecheck, targeted `src/features/prompts/topic-drawer src/mocks`.
Rows: WB-TPE-13, WB-TPE-14, WB-TI-12, WB-TI-19, WB-TI-07 (the two tabs exist; they are switched on in task 7).
Commit: `WP-20: Topic drawer competitors and related`.

### Task 6: Drawer header, Prompts tab by engine, In search

Files (create): `D/header-model.ts`, `D/use-topic-header.tsx`, `D/prompts-behind.ts`, `D/engine-filter.tsx`, `D/in-search.tsx`, tests beside each. Modify: `D/engine-sections.tsx` (adds In search last).

Signatures:
```ts
// header-model.ts
export interface TopicBadgesInput { key: string; tree: readonly NamedTerm[]; promptCount: number; engines: readonly ProjectEngine[]; country: string | null; includeBranded: boolean }
export function categoryOf(key: string, tree: readonly NamedTerm[]): { text: string; path: string } | null;   // ancestors joined; null for a top level topic
export function scopeParts(input: TopicBadgesInput): { engines: number | string; country: string | null; branded: boolean };
// use-topic-header.tsx
export function useTopicHeader(args: { topicKey: string; row: TopicSummaryRow | undefined; prompts: readonly PromptSummaryRow[] | null }): { badges: ReactNode; frequentAction: ReactNode; navigation: InspectorNavigation | null; positionText: string | null; freshness: ReactNode; onStep: ((direction: 'next' | 'previous') => void) | undefined };
// prompts-behind.ts
export function promptsBehindCell(prompts: readonly PromptSummaryRow[], engineCode: string, metric: CellMetric): PromptSummaryRow[];
// in-search.tsx
export interface InSearchCounts { keywords: number; top10: number }
export function useInSearch(read: TopicReadScope, topicKey: string, enabled: boolean): { status: 'loading' | 'failed' | 'ready'; counts: InSearchCounts | null; retry: () => void };
```
Behaviour:
- `useTopicHeader` reads `useTopicDrawer()`, `useInspector()` (position and step), `useTopicOrder(project)`. Badges: category (level 2 and below, keyboard focusable, tooltip with the full path), prompt count, scope (aria `header.scopeLabel`). Add prompt and Run now as in section 2.5. J and K: `onStep` is `undefined` when the topic is not in the order.
- Prompts tab (WB-TPE-12): `D/engine-filter.tsx` is `EngineFilteredPrompts`, the content of the Prompts tab: reads `eng` (validated against `engines`), shows a removable neutral chip (`promptsTab.engineChip`, remove `engineChipRemove`) and the note, lists `promptsBehindCell` (each row the prompt button as `PromptList` has it, with the chosen metric's value and k of n on that engine); empty `promptsTab.emptyTitle` with the remove action; clears `eng` on unmount. Without `eng` it lists every prompt as today.
- In search: two reads as section 2.5; the card is `InspectorSection title="In search"` with two key values and the Rankings link; the link is built with `rankingsPath` plus the `tag` filter value (`formatEnumList`).

Tests first:
- `header-model.test.ts`: `gives no category for a top level topic`; `gives the parent name for a level 2 topic and the path for a level 3 topic`; `says the scope as engines, country and branded choice`; `names a single engine instead of counting it`.
- `use-topic-header.test.tsx`: `shows the category, prompt count and scope as badges, the prompt count text unchanged`; `the category badge takes the keyboard and its tooltip has the whole path`; `Add prompt calls the screen with the topic and is absent without prompts:write and for No topic`; `Run now calls the screen with the topic's prompt ids and is absent without runs:trigger`; `Run now is disabled with its reason while another action runs, while the list loads and when the topic holds no prompt`; `says 3 of 13 and steps with the buttons`; `J and K step to the next and previous topic and stop at the ends`; `has no counter or steps when the topic is not in the list`; `shows when the topic was last answered`.
- `prompts-behind.test.ts`: `keeps the prompts with an answer on the engine`; `orders by the chosen metric on that engine, a prompt without a rate last`; `breaks a tie by text`.
- `engine-filter.test.tsx`: `lists every prompt without eng`; `shows the chip and only that engine's prompts with eng`; `each row shows the value and k of n on that engine`; `drops an eng that is not an engine shown`; `the chip removes the filter`; `says no prompt has an answer on the engine`; `clears eng when the drawer closes`.
- `in-search.test.tsx`: `reads the keywords and the Top 10 of the topic with limit=1 and filter[term]`; `says the counts with the keywords they are of`; `says no tracked keyword is given this topic for a total of 0`; `has an inline error with Retry that leaves the drawer intact`; `links to Rankings filtered to the topic`; `is not offered for No topic`; `shows a skeleton while loading`.

Browser check (only when the coordinator allows): headless Playwright against `pnpm dev` port 3006 at 390 and 440 px: do Add prompt and Run now fit the header? Decide section 2.5's fallback.
Checks: light, medium typecheck, targeted `src/features/prompts/topic-drawer`.
Rows: WB-TI-02, 03, 04, 05, 13, 23, WB-TPE-12 (the filtered Prompts tab).
Commit: `WP-20: Topic drawer header, prompts by engine and In search`.

### Task 7: Wire the drawer, e2e, as built notes, final checks (the final task)

Step 0 (before any edit): ask the coordinator whether WP-16 has merged and who rebases (L3). `git fetch origin && git rebase origin/develop`. Read `topic-inspector.tsx` as it is then. If WP-16 is not merged and the coordinator wants this package first, WP-16 rebases onto it and this task keeps the file as it is today plus its own hunks.

Files (modify): `F/topic-inspector.tsx` (L3), `F/prompts-screen.tsx` (L2 hunk 2), `F/seams/topic-tabs.ts` (L6), `F/topic-drawer.test.tsx`, the docs of L8. Create: `F/topics-by-engine.test.tsx` (the confirm tests below), `apps/web/e2e/flows/ai-topics-by-engine.spec.ts`.

Edits:
- `topic-inspector.tsx`: new prop `extras: TopicDrawerExtras`; wrap the body in `TopicDrawerProvider`; call `useTopicHeader` and spread its result into `header` (`badges`, `frequentAction`, `navigation`, `positionText`, `freshness`) and `onStep` into `Inspector`; replace the "By engine" `InspectorSection` with `<TopicEngineSections />` (Rates and Top prompts stay as they are); replace the Prompts panel list with `EngineFilteredPrompts`; delete the local `Rate` and the imports it leaves unused; update the `shortcut:` doc comment (the tabs, the trend, J and K now exist). Keep WP-16's wrapper if present.
- `prompts-screen.tsx`: build `extras` once and pass it (L2 hunk 2).
- `seams/topic-tabs.ts`: the four lines of L6.
- `topic-drawer.test.tsx`: update only the assertions inside the By engine section to the panel's texts ("38%" stays; "3 of 8" becomes a match on "3 of 8 answers, 2 prompts"; the weighted note stays); everything about opening, Show all, Escape, unknown topic, prompts from a topic and the modified click stays untouched.

Tests first (`topics-by-engine.test.tsx`, harness of `topic-drawer.test.tsx`), the confirm of the 9 built rows and the integration of the new surfaces:
- `WB-TI-01 shows the topic name, the type Topic, the prompt count as a badge and Back` ; `WB-TI-06 opens on Overview and Prompts remains a tab`; `WB-TI-08 shows Mentioned, Cited and Share of voice with avg of N`; `WB-TI-10 shows each engine with its percent and k of n`; `WB-TI-15 lists the top 5 prompts with their mentions and View all`; `WB-TI-17 lists every prompt of the topic and below and opens the prompt inspector`; `WB-TI-21 says a topic with no row does not exist, an empty topic has no prompts, and a failed read has Retry`; `WB-TI-22 keeps the topic list for a prompt opened from the drawer and the badge returns to the tab`; `WB-TPE-18 every average in the By engine view, the heat map, the Mention column and the drawer says avg of N and names its engines`.
- New: `the drawer shows the four tabs Overview, Prompts, Competitors and Related`; `opening a topic name and then an engine row lists that engine's prompts (two clicks)`; `Add prompt opens the add dialog with the topic chosen`; `Run now asks first and starts the topic's prompts`; `J and K step topics in the order of the table and say 2 of N`; `a refetch keeps the drawer content`; `No topic has no Add prompt, no In search and says its competitors per topic`.
- `prompts.test.tsx` and the other prompts tests must pass untouched.

e2e (`ai-topics-by-engine.spec.ts`, owned by this task, run once at the end; pattern of `ai-prompt-inspector.spec.ts`: `signIn`, `expectAccessible`, `idraft.theme` in localStorage, `?density=compact`): `By engine view: a column per engine, the metric switches, a sort by an engine, the gap column, one click from an engine cell to the prompts of that engine`; `two clicks from a topic name to the prompts behind one engine`; `heat map: cells print value and counts and a cell opens the drawer Prompts tab for that engine`; `drawer: J and K step topics and the counter says 2 of N, Add prompt opens the dialog with the topic chosen, Run now asks first`; `Competitors and Related tabs`; `phone 390: topic rows say the best engine and the engine count, the drawer is a sheet and the panel stacks`; `axe: no serious or critical finding on the By engine view, the heat map and the drawer Overview at 390, 768, 1024 and 1280 px, light and dark, Default and Compact`.

Docs (append-only, L8): `24-page-templates.md` 9.5 "As built (2026-11-13, WP-20)": the three Topics views, `view`, `metric` and `eng` keys, the three reads, the drawer sections and tabs, the leader and gap rules, the pooled language. `25-component-inventory.md`: SC-26 as built (`TopicEnginePanel`), the deviation that the `inspector.topic` cards are separate components while their layout registration waits for WP-16 L5.

Final checks (heavy lane; read `/tmp/idraft-health/state` first, `level=OK` required):
1. `infra/dev/heavy --label wp-20-final -- bash -c 'pnpm install --frozen-lockfile && cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build'`.
2. e2e once: `infra/dev/heavy --label wp-20-e2e --wait 60 --max 40 -- bash -c 'cd apps/web && E2E_PORT=3112 pnpm e2e -- ai-topics-by-engine.spec.ts ai-prompts.spec.ts ai-prompt-inspector.spec.ts'` (the last two prove nothing regressed). Never earlier, never twice unless it fails.
3. A second fresh Sonnet reviewer reads the whole package diff against the brief's acceptance criteria and the 37 rows, and opens the Topics tab (three views) and the drawer (four tabs) at 390, 768, 1024 and 1280 px in both themes and both densities (headless Playwright).
4. `git fetch origin && git rebase origin/develop`, re-run the targeted tests, push `git push origin HEAD:develop` (fast forward), `infra/dev/wp-status WP-20 merged "..."` and report to the coordinator.

Checks of the task itself before the final run: light on every changed file, medium typecheck, the folder `src/features/prompts`.
Rows: confirms WB-TI-01, 06, 08, 10, 15, 17, 21, 22 and WB-TPE-18; switches on WB-TI-07 and every drawer row.
Commit: `WP-20: Topic drawer wiring, e2e and as built notes`.

## 5. Rows closed (37)

BUILT rows are confirmed by a test, not rebuilt. File is the main file; the test is a file and a test name.

| Row | Status | Task | File | Test that proves it |
|---|---|---|---|---|
| WB-TPE-02 | to do | 2 | `T/engine-columns.tsx`, `T/metric-select.tsx` | `topics-view.test.tsx`: the metric select writes ?metric and changes the columns |
| WB-TPE-03 | to do | 2 | `T/topics-view.tsx`, `T/view-switch.tsx` | `topics-view.test.tsx`: shows the By engine columns for ?view=engines |
| WB-TPE-04 | to do | 2 | `T/engine-columns.tsx`, `T/series-model.ts` | `engine-columns.test.tsx`: trend columns wait in the chooser, draw a line and say how many points are pooled |
| WB-TPE-05 | to do | 2 | `T/engine-columns.tsx`, `T/engine-values.ts` | `engine-columns.test.tsx`: the gap cell says best and weakest; `engine-values.test.ts`: gives the exact spread |
| WB-TPE-06 | to do (partial) | 2 | `T/engine-columns.tsx` | `engine-columns.test.tsx`: sorts by an engine rate; `topics-view.test.tsx`: sorts by the ChatGPT rate from ?sort= |
| WB-TPE-07 | to do | 2 and 3 | `T/use-drill.ts`, `T/topic-heatmap.tsx` | `engine-columns.test.tsx`: a topic engine cell is a button that opens the drawer; `topic-heatmap.test.tsx`: a cell links to the drawer on Prompts; e2e two clicks |
| WB-TPE-08 | to do | 2 | `T/leaders.ts`, `T/engine-columns.tsx` | `leaders.test.ts`: picks the competitor with the highest share of voice; `engine-columns.test.tsx`: leader columns |
| WB-TPE-09 | to do (partial) | 4 | `C/topic-engine-panel.tsx`, `D/engine-panel.tsx` | `topic-engine-panel.test.tsx`: draws a row per engine; `engine-panel.test.tsx`: lists every engine shown in order |
| WB-TPE-10 | to do | 4 | `D/engine-trend.tsx`, `T/series-model.ts` | `engine-trend.test.tsx`: draws one line per engine |
| WB-TPE-11 | to do | 4 | `T/comparison.ts`, `D/comparison-line.tsx` | `comparison-line.test.tsx`: says best and weakest with rates and the gap |
| WB-TPE-12 | to do | 4 and 6 | `D/engine-panel.tsx`, `D/engine-filter.tsx` | `engine-panel.test.tsx`: an engine row leads to the Prompts tab filtered; `engine-filter.test.tsx`: shows the chip and only that engine's prompts |
| WB-TPE-13 | to do | 5 | `D/topic-competitors-tab.tsx` | `topic-competitors-tab.test.tsx`: shows entities by engine with the answers behind each value |
| WB-TPE-14 | to do | 5 | `D/rivals-trend.tsx` | `rivals-trend.test.tsx`: draws the own brand and the three most mentioned competitors; switches to one engine |
| WB-TPE-15 | to do | 2 | `T/engine-columns.tsx` (child rows use the same columns) | `topics-view.test.tsx`: a topic opened onto its prompts shows each prompt with its value on every engine |
| WB-TPE-16 | to do (partial) | 3 | `T/by-engine-export.ts` | `by-engine-export.test.ts`: writes each engine rate as a number with its counts |
| WB-TPE-17 | to do | 3 and 4 | `T/list-lines.ts`, `T/topics-mobile-list.tsx`, `C/topic-engine-panel.tsx` | `list-lines.test.ts`; `topics-view.test.tsx`: renders the phone list under 768 px; e2e phone 390 |
| WB-TPE-18 | BUILT | 1 and 7 | `rate-columns.tsx` (`useRateColumns`), `topic-inspector.tsx` (`headline`), `rate-model.ts` (`acrossEngines`) | `topics-by-engine.test.tsx`: WB-TPE-18 every average says avg of N; `engine-values.test.ts`: an average says how many engines took part |
| WB-TI-01 | BUILT | 7 | `topic-inspector.tsx` (`Inspector` header) | `topics-by-engine.test.tsx`: WB-TI-01 shows the name, the type, the prompt count and Back |
| WB-TI-02 | to do (partial) | 6 | `D/header-model.ts`, `D/use-topic-header.tsx` | `use-topic-header.test.tsx`: shows the category, prompt count and scope as badges |
| WB-TI-03 | to do | 6 and 7 | `D/use-topic-header.tsx`, `prompts-screen.tsx` | `use-topic-header.test.tsx`: Add prompt calls the screen with the topic; `topics-by-engine.test.tsx`: Add prompt opens the add dialog with the topic chosen |
| WB-TI-04 | to do | 6 and 7 | `D/use-topic-header.tsx` | `use-topic-header.test.tsx`: Run now calls the screen with the topic's prompt ids; `topics-by-engine.test.tsx`: Run now asks first |
| WB-TI-05 | to do | 6 and 7 | `D/use-topic-header.tsx`, `D/topic-order-store.ts` | `use-topic-header.test.tsx`: J and K step to the next and previous topic; e2e J and K |
| WB-TI-06 | BUILT | 7 | `topic-inspector.tsx` (`builtInTabs`), `prompt-model.ts` (`TOPIC_TAB`) | `topics-by-engine.test.tsx`: WB-TI-06 opens on Overview and Prompts remains a tab; `topic-drawer.test.tsx`: opens on Overview from the name of a topic |
| WB-TI-07 | to do | 5 and 7 | `D/topic-competitors-tab.tsx`, `D/topic-related-tab.tsx`, `seams/topic-tabs.ts` | `topics-by-engine.test.tsx`: the drawer shows the four tabs |
| WB-TI-08 | BUILT | 7 | `topic-inspector.tsx` (`headline`) | `topics-by-engine.test.tsx`: WB-TI-08 shows Mentioned, Cited and Share of voice with avg of N; `topic-drawer.test.tsx`: reads the answers behind a topic rate |
| WB-TI-10 | BUILT | 4 and 7 | `topic-inspector.tsx` (`Rate`, replaced by the panel) | `engine-panel.test.tsx`: lists every engine shown in order with percent and k of n; `topics-by-engine.test.tsx`: WB-TI-10 |
| WB-TI-11 | to do | 4 | `C/topic-engine-panel.tsx` | `topic-engine-panel.test.tsx`: draws a row per engine with logo, bar, percent |
| WB-TI-12 | to do | 5 | `D/rivals-trend.tsx` | `rivals-trend.test.tsx`: defaults to the average of the engines and names how many took part |
| WB-TI-13 | to do | 6 | `D/in-search.tsx` | `in-search.test.tsx`: reads the keywords and the Top 10 of the topic with limit=1 and filter[term] |
| WB-TI-15 | BUILT | 7 | `topic-inspector.tsx` (`PromptList`, `TOPIC_TOP_PROMPTS`) | `topics-by-engine.test.tsx`: WB-TI-15 lists the top 5 prompts |
| WB-TI-17 | BUILT | 6 and 7 | `topic-inspector.tsx` (`promptsPanel`), `prompt-model.ts` (`topicPrompts`) | `topics-by-engine.test.tsx`: WB-TI-17; `topic-drawer.test.tsx`: offers the prompts of an open parent in Show all |
| WB-TI-19 | to do | 5 | `D/topic-related-tab.tsx`, `D/related-model.ts` | `topic-related-tab.test.tsx`: lists sibling topics with prompts and mention |
| WB-TI-21 | BUILT | 7 | `topic-inspector.tsx` (`missing`, `failed`, `noPrompts`) | `topics-by-engine.test.tsx`: WB-TI-21; `topic-drawer.test.tsx`: says a topic the summary has no row for does not exist |
| WB-TI-22 | BUILT | 7 | `prompts-screen.tsx` (`promptFrom`), `prompt-model.ts` (`topicOriginOf`) | `topic-drawer.test.tsx`: keeps the topic as its list, and the topic badge leads back; `topics-by-engine.test.tsx`: WB-TI-22 |
| WB-TI-23 | to do (partial) | 6 | `D/header-model.ts` | `header-model.test.ts`: gives the parent name for a level 2 topic and the path for a level 3 topic |
| SC-26 | SPEC | 4 | `C/topic-engine-panel.tsx` | `topic-engine-panel.test.tsx` (all); the gallery specimen |
| CF-31 | SPEC | 4 | `D/topic-trend-query.ts` | `topic-trend-query.test.ts`: asks rows=topics with include=series,entities and filter[term]; `engine-trend.test.tsx`: reads the weeks of filter[term] |

## 6. Order and dependencies

Strictly 1, 2, 3, 4, 5, 6, 7; one subagent at a time. Why:

- Task 1 (keys, model) is imported by every later task. The keys commit goes first so no later task touches `en.json`.
- Task 2 needs L1, L2 (hunk 1) and L4 (hunk 1) granted. Task 3 needs task 2 (`TopicsView`, the view switch). Pushing after task 3 is safe: the Topics tab is complete and the drawer is untouched.
- Task 4 needs task 1 only; it creates `drawer-context.tsx` and `engine-sections.tsx`, which tasks 5 and 6 extend. It needs L7. Tasks 4 to 6 add components that nothing renders yet, so the existing drawer keeps working between them.
- Task 5 needs L4 (hunk 2). The seam lines stay commented until task 7, because the tabs read the drawer context that only task 7 provides.
- Task 6 needs the order store of task 2.
- Task 7 needs L2 (hunk 2), L3 (after WP-16), L6 and L8, and runs the heavy checks and the e2e once.
- Ask the coordinator now for: L1, L2, L4, L5, L7 before task 2; L3, L6, L8 before task 7. Message keys (L5) are additive, so a conflict with another package is resolved by keeping both sides and running `pnpm vitest run src/i18n`.

## 7. Decisions, conflicts and risks for the coordinator

| # | Item | Assumed here |
|---|---|---|
| 1 | Default view | The List stays the default; By engine and Heat map are one click away (`DEFAULT_TOPICS_VIEW`). Owner may want By engine as the default (R-09 "first class"). |
| 2 | Leader rule | Highest share of voice among tracked competitors, tie by mention rate then entity order; "None named" and "too few" are words, not blanks. |
| 3 | Spread unit | 1 decimal, unsigned, computed from exact values. |
| 4 | Comparison test | Unpaired Newcombe on pooled answer counts, labelled as such (the API's paired test does not exist yet); none for share of voice. |
| 5 | Pooled points | Marked by words (tooltip title, table form, C-18 sentence), not by restyling a point: a canvas line cannot. A sparkline cannot mark a point either. |
| 6 | Add prompt and Run now | Both in the header's frequent action row; Run now falls back to More if they do not fit at 390 px (task 6 browser check). |
| 7 | In search | Counts come from tracked keywords with `filter[term]`; 0 is worded as "no tracked keyword is given this topic" because BE-TOPICS-07 (one vocabulary) is unchecked. SEO visibility (WB-TI-14) and related keywords (WB-TI-20) stay out of scope. |
| 8 | Heat map and search | The heat map ignores `?q` and says so. |
| 9 | Phone | By engine and List are the same phone list; the heat map keeps its grid. |
| 10 | Stale | Interim 7 days (`STALE_AFTER_DAYS`), to be replaced by WP-18's rule. |

Conflicts between the brief and the code (all handled above, none blocks):
1. The brief names `topic-inspector.tsx` sole owner, but WP-16 holds a lease on it for T10 (L3). Task 7 waits for WP-16.
2. WP-23 (WB-TI-18) also plans the drawer's Competitors tab. This package builds the tab and its entity by engine table (WB-TPE-13); WP-23 should decorate it, not rebuild it.
3. The brief gives no mock handler to this package, but the mock refuses `rows` and never sends entities per week (F3): L4.
4. WP-18 owns `topics-table.tsx`, `rate-columns.tsx` and `trend-*` and plans phone rows (WB-TOP-34); this package needs two small hunks in `topics-table.tsx` (L1) and builds the phone line texts (WB-TPE-17). If WP-18 lands first, only `list-lines.ts` is handed over.
5. The commented seam lines name `../inspector/topic/...`; the owned folder is `topic-drawer/`. The path changes in two lines.
6. The brief asks for `e2e/flows/topics-by-engine.spec.ts`; the house convention (MASTER-PLAN 3.6) is `ai-<slug>.spec.ts`, so the spec is `ai-topics-by-engine.spec.ts`.
7. The brief reads WB-TPE-08 as "entities only with `filter[term]` until gzip". C-15 and gzip on develop make `rows=topics` entity reads cheap, so the Topics tab reads entities for all topics; `filter[term]` is kept for the drawer's weekly entity read.
8. The built List-view Trend column (WP-18) ignores `is_pooled`; it should carry the C-18 sentence in its tooltip. Not edited here.
9. Estimate: 7 tasks and about 10 hours, against the brief's 9 tasks and 7 hours.

Risks and not verified:
- `HeatmapGrid` inside `ChartFrame` at 390 px, the two header buttons at 440 px, and the panel stacking are checked only in the browser step of tasks 6 and 7.
- `next/navigation` is mocked in the prompts tests without `useSearchParams`: only the heat map reads it, so only tests that mount the heat map add it to their mock.
- The existing prompts tests count requests to the summary in a few places; the entities and trend reads add requests only when the By engine view or the drawer is open. Task 2 and task 7 run the whole `src/features/prompts` folder to catch it.
- If WP-16's `DrawerCustomizer` expects each Overview section to be a registered card, the sections of `engine-sections.tsx` are the units to register (WP-16 L5); this package does not edit the layout catalog.
- Not verified: the exact props of `Select`, `SegmentedControl`, `FilterChip`, `ChartFrame` line mode and `DataTableList` beyond what the sources above show; each task's first step is to read the component it uses.
