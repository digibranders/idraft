# WP-25 inspector-completion: detailed task plan

Brief: [WP-25](../../ai-visibility/work-packages/WP-25-inspector-completion.md). Rows: web.md section 2.11.
Branch `ai/wp-25-inspector-completion`, worktree `.claude/worktrees/wp-25`, cut from `origin/develop` at `74fae3bf`.
Owner decision taken at its default, never blocked on: **D-02** six tabs (Latest, History, Citations, Competitors,
Fan-out only when an enabled engine exposes it, Stats); Versions and Runs are sections of History later; DS23 4.1
is amended by an As built note to allow 6. Citations (WP-21) and Fan-out (WP-24) are not built here.

## House rules (every task, every reviewer checks them)

- Tokens only (no raw colours, no arbitrary px); type utilities only (`type-meta`, `type-body`, ...); `num` on numbers.
- Every number and date through `@/lib/format` (`formatInteger`, `formatPercent`, `formatInterval`,
  `formatSampleCount`, `formatRelative`, `formatChartDate`, `formatIsoDate`, `formatDateRange`, `formatDetailDateTime`).
- No em-dash or en-dash anywhere: code, comments, copy, docs, commit messages (`src/test/source-text.test.ts` bites).
- Every percent shows its count; unknown is never 0 (`EMPTY_VALUE`, `n/a`, a gap); colour only for a detectable
  change; engines are never pooled silently (one engine per line, per panel, per marker).
- Copy lives in `apps/web/messages/en.json` under `prompts.inspector.*` only. No other namespace.
- Edit files only with the file tools (Read, Edit, Write). No shell heredocs, `sed`, or replace scripts.
- Tests first: write the failing tests, run them and see them fail for the right reason, then implement.
- Commit per task: `WP-25: <task title>` (no attribution lines, no dashes), staging only the task's files.
- Push: `git fetch origin && git rebase origin/develop`, re-run the task's targeted checks, `git push origin HEAD:develop`.
- Heavy commands only through the lock: `infra/dev/heavy --label wp25-<x> --wait 30 --max 30 -- bash -c '...'`;
  `pnpm typecheck` in the medium lane: `infra/dev/heavy --lane medium --label wp25-tc -- bash -c 'cd apps/web && pnpm typecheck'`.
- Targeted checks of a task (from the worktree root):
  `cd apps/web && pnpm exec vitest run <test files>`; `pnpm exec eslint <changed files>`;
  `pnpm exec prettier --check <changed files>`; then `pnpm typecheck` once (medium lane).

## Shared-file risk

- `prompt-inspector.tsx` is sole-owned in wave 2 by WP-25, but WP-17 (header, menus) and WP-20 (`topic-inspector.tsx`)
  work next to it in wave 2. Keep edits in the `header={{...}}` object and the `builtInTabs` render lines small and
  local; do not reorder imports or reformat untouched code. Rebase on `origin/develop` before every task starts and
  before every push.
- Leases to ask the coordinator for before the task starts (record path, WP-25, since):
  `components/ui/tabs.tsx`, `components/ui/tabs.test.tsx`, `components/app/inspector/inspector-tabs.tsx` (Task 2);
  `components/design-system/metric-parts-section.tsx` and its test (Task 8). Commit and push Task 8 early and
  alone (tiny diff), so other sessions rebase over it; on a conflict keep both sides.
- `apps/web/messages/en.json`: two parallel subagents never both edit it (see the schedule).

## What exists (read from code at 74fae3bf)

- Tabs: `builtInTabs` in `prompt-inspector.tsx` (latest, history, competitors, stats) plus the seam
  `seams/inspector-tabs.ts` (`PROMPT_TAB_ENTRIES`, `promptTabs`, anchors `after: 'history'` for WP-21 and
  `after: 'competitors'` with `available` for WP-24). There is no `PROMPT_TABS` constant any more; the seam already
  holds any number of tabs. `InspectorTabs` passes `TAB_ROW` as `listClassName` to `ui/tabs.tsx`; the underline list
  is `relative flex gap-6`, no overflow handling. Six labels at 14 px need about 440 px of row; the 440 px inspector
  gives 408 px (16 px padding each side), and the sheet at 390 px gives 358 px. Six tabs overflow. DS16 2.3 and DS19
  rule 3 forbid horizontal scrolling and ask for a trailing "More tabs" menu (`Tabs overflow="menu"`, DS25 3.38),
  which is not built.
- Header: `badges` shows `firstTopic.name` with the path only as a `Tooltip` when not opened from a topic (WB-PI-06
  partial). `freshness` is a prop of `InspectorHeader` that the prompt inspector never passes, so WB-PI-04 has no
  freshness (the keyword inspector passes `t('updated', { time: formatRelative(...) })`). The `h2` is the plain prompt
  text, not in quotes (WB-PI-01, see Open questions).
- Latest: `topSources` keeps 3 hosts and renders `Badge` chips "host (role)"; no "+N" overflow and no domain link.
  `DomainChipList` (`components/app/cells/domain-chip.tsx`: `label`, `domains: { domain, href? }[]`, `max` default 3,
  "+N" popover) and `displayDomain` (`@/lib/format/url`) are merged. No domain inspector route exists yet (WP-21/22).
- History: `historyEvents(createdAt, observations)` gives `added` and `model` events. No stale event. The chart is a
  `ChartFrame kind="line"` with `extendOption` calling `rateBandOption`, which already takes
  `boundaries?: ChartBoundary[]` (`{ at: <category label>, label }`) drawn by `boundaryMarkLines`; the inspector passes
  none. `small-multiples.tsx` shows how it reserves grid room for the label (`BOUNDARY_ROOM = 24`).
  The engine choice (WB-PIH-02) is the `ChartFrame` legend toggle (`hidden` set), not a `Select`.
- Stats: `inspector-stats.tsx` prints `words('sample', { k, n })` as text, `ConfidenceIndicator form="text-and-bar"`,
  `words('method')`. No `SampleCount`, no aggregation label, no "Open statistics". `StatisticsPanel`
  (`state`, `placement: 'inspector-tab'`, `backTo: { label, onBack }`, content `StatisticsContent`), `SampleCount`
  (`k`, `n`, `noun: 'answers'`), `MetricInfo` (`onOpenStatistics`) are merged and have no consumer yet.
- Design system: `metric-parts-section.tsx` has groups Delta ... StatisticsPanel (asserted as `GROUP_TITLES` in its
  test); `ConfidenceIndicator` has no specimen. Adding a group there needs no change to `registry.ts` or
  `section-slugs.ts`, so the registry trio is not touched.
- Hashes (WB-PI-23, CF-26): `ObservationDetail` in `schema.ts` has no hash field. The backend computes
  `answer_hash` (`collectors/ai_prompt_ingest.py`) and the raw payload `sha256` (`collectors/raw_payloads.py`) but does
  not serve them. CF-26 is step 1 of WP-26 (not started), which owns `observation_routes.py`, `observations.py` and
  `answer-inspector.tsx`. WP-25 may not touch `schema.ts`.
- Stale rule: "no valid answer for twice the schedule interval" (WB-STATE-11, CF-27) is WP-18's (not started). Prompts
  are asked twice a week, so twice the interval is 7 days.

## Row map

| Row | Found | Task |
|---|---|---|
| WB-PI-01, 02, 05, 08, 09, 10, 12, 16, 17 | built, tests exist (`prompt-inspector.test.tsx`, `inspector-tabs.test.tsx`) | 1 confirm |
| WB-PI-04 | position and type built, freshness missing | 1 |
| WB-PI-06 | path only in a tooltip | 1 |
| WB-PI-15 | seam holds 6; row overflows | 1 (capacity test), 2 (overflow menu, docs) |
| WB-PI-18, 19 | shared `inspector.test.tsx` ("is a modal sheet below 768 px", "resizes from the keyboard") | 1 confirm, browser check |
| WB-PI-22 | not built | 7 |
| WB-PI-23 | blocked on CF-26 (WP-26) | 9 (conditional) |
| WB-PIL-01, 02, 04, 05, 06 | built, tests in `inspector-tabs.test.tsx` "the Latest tab" | 3 confirm |
| WB-PIL-03 | 3 chips, no overflow | 3 |
| WB-PIH-01, 03, 04, 05, 07 | built, tests in "the History tab" and `history-model.test.ts` | 4 confirm |
| WB-PIH-02 | built as the legend toggle | 5 confirm (add a test) |
| WB-PIH-08 | not built | 4 |
| WB-PIH-11 | not built | 5 |
| WB-PIS-01, 02, 03 | built, tests in "the Stats tab", `stats-model.test.ts` | 6 confirm |
| WB-PIS-04 | sample as text, no aggregation | 6 |
| WB-PIS-06 | no specimen | 8 |

## Schedule (at most 2 subagents at once, disjoint files, at most one of them edits `en.json`)

1. Pair A: Task 1 and Task 8 in parallel (Task 8 pushed first, alone).
2. Pair B: Task 2 and Task 3 in parallel (Task 3 does not edit `en.json`).
3. Task 4, then Task 5 (both `inspector-history.tsx`, `history-model.ts`).
4. Task 6, then Task 7 (both `inspector-stats.tsx`; Task 7 also `prompt-inspector.tsx`).
5. Task 9 (conditional), Task 10, final review.

Sequential on `prompt-inspector.tsx`: 1, 2, 7. Each task ends with a fresh Sonnet reviewer (PASS or a numbered fix
list), then the commit and push.

---

## Task 1: Header freshness, topic path badge, six tab capacity

Rows: WB-PI-04, WB-PI-06, WB-PI-15 (capacity part); confirms WB-PI-01, 02, 05, 08, 09, 10, 12, 16, 17, 18, 19.
Files: `features/prompts/prompt-inspector.tsx`, `features/prompts/prompt-inspector.test.tsx`,
`features/prompts/inspector-tabs.test.tsx`, `messages/en.json` (`prompts.inspector.updated`).

Tests first:
- `prompt-inspector.test.tsx` "shows when the prompt was last answered beside its position": with the summary row's
  `last_observed_at` set (override the summary handler with `server.use`), the header meta line has
  "Updated <formatRelative>"; with `last_observed_at: null` there is no "Updated" text (not "0", not "never").
- "shows the topic path as the badge when the prompt is opened from the Prompts tab": a prompt whose first topic term
  has `path !== name` (use a nested fixture term or override the prompt read) shows the path as the visible badge
  text, still reachable by keyboard; opened from a topic (existing test at line 246) the badge stays the topic name
  button. A top-level topic still shows its name once (the existing `'SEO'` x2 assertion keeps passing).
- `inspector-tabs.test.tsx` "holds six tabs in the D-02 order": `promptTabs(builtIns, [citations, fanout], context)`
  with stub entries `{ id: 'citations', after: 'history' }` and `{ id: 'fanout', after: 'competitors', available: () => true }`
  gives `latest, history, citations, competitors, fanout, stats`; with `available: () => false` it gives five.

Implementation:
- `header.freshness`: `counts.row?.last_observed_at == null ? null : <span>{t('updated', { time: formatRelative(counts.row.last_observed_at, timeZone) })}</span>`.
  Key `prompts.inspector.updated`: "Updated {time}".
- Badge branch `topic == null`: render the path as the badge text (`firstTopic.path`), keep the `Tooltip` with the path
  for a truncated badge, add `max-w-full truncate` on the badge. Leave the `topic != null` branch as it is.
- Do not add quotes to the title (see Open questions).

UI checks: header at 390 (sheet) and 1280 (docked), light and dark, Default and Compact; long path truncates, no
horizontal page scroll; axe in the component test already runs (`expect(await axe(container))`).
Prove it bites: set `freshness` from `last_valid_at` or show "Updated" for null and the test fails; render `name`
again and the path test fails; drop the `after` anchor in a stub and the order test fails.

## Task 2: Tab overflow into "More tabs" (D-02 made real)

Rows: WB-PI-15. Lease: `components/ui/tabs.tsx`, `components/ui/tabs.test.tsx`,
`components/app/inspector/inspector-tabs.tsx`. Also `prompt-inspector.tsx` (one prop), `messages/en.json`
(`prompts.inspector.moreTabs`), `docs/design-system/23-application-patterns.md` 4.1 and
`docs/design-system/16-drawers-dialogs-popovers.md` 2.3 (append-only As built notes).

Tests first (`tabs.test.tsx`; jsdom has no layout, so stub `HTMLElement.prototype.offsetWidth`/`clientWidth` and a
`ResizeObserver` that calls back once):
- "moves the tabs that do not fit into a More tabs menu outside the tab list": 6 items at 80 px each in a 400 px
  row with `overflowLabel="More tabs"` shows 4 tabs in the `tablist`, a button named "More tabs" outside it, and the
  menu lists the other 2.
- "keeps the chosen tab visible, swapping out the last visible one": choosing a hidden item from the menu calls
  `onValueChange` with it, and it is then a visible tab while the former last visible tab moves into the menu.
- "shows no More tabs button when every tab fits, or when no overflowLabel is given" (keyword and topic inspectors
  unchanged).
- Arrow keys and Home/End move only among the visible tabs (existing keyboard test keeps passing).

Implementation:
- `TabsProps.overflowLabel?: string | undefined` (underline only). When set: measure the list's width and each tab's
  width (`ResizeObserver` on the list, widths read once per items change), compute the visible count leaving room
  for the 32 px trigger; the chosen tab always counts as visible. Render hidden items outside the list as a
  `Menu` (`components/ui/menu.tsx`, `items: MenuItemDef[]`, `trigger` an `IconButton`-sized ghost button with the
  `Ellipsis` icon and `aria-label={overflowLabel}`). Indicator unchanged. No horizontal scroll, no fade.
- `InspectorTabsProps.overflowLabel?: string | undefined` passed through; prompt inspector passes `t('moreTabs')`
  ("More tabs"). Update the `items` doc line: "At most six for the prompt inspector (D-02); the rest move into More tabs".
- Docs (append-only, below the existing text): DS23 4.1 Tabs row and DS16 2.3 rules: "> As built (2026-11-13,
  WP-25): decision D-02 allows six prompt inspector tabs (Latest, History, Citations, Competitors, Fan-out when an
  enabled engine exposes it, Stats). Tabs that do not fit the row move into a trailing More tabs menu
  (`overflowLabel` on `Tabs` and `InspectorTabs`)."

UI checks: with two temporary stub entries in a local, uncommitted edit of `PROMPT_TAB_ENTRIES` (revert before the
commit), at 440 docked, 390 sheet, 768 and 1024 overlay: no tab label truncated, no horizontal scroll, More tabs
reachable by Tab and Enter, Escape closes the menu, focus returns to the trigger; light and dark, Compact; axe.
Prove it bites: make the chosen tab overflow-eligible and the swap test fails; remove the room for the trigger and
the 4-visible test fails.

## Task 3: Latest source chips with overflow

Rows: WB-PIL-03; confirms WB-PIL-01, 02, 04, 05, 06 (existing tests in `inspector-tabs.test.tsx` "the Latest tab").
Files: `features/prompts/inspector-latest.tsx`, new `features/prompts/inspector-latest.test.tsx`. No `en.json` edit
(it reuses `latest.sourcesLabel`; the then unused `latest.source` key is removed in Task 10).

Tests first (`inspector-latest.test.tsx`, render `InspectorLatest` with `renderWithProviders` and MSW
`server.use` handlers for `newestAnswerQuery` and `observationQuery` paths, copied from the handlers in
`inspector-tabs.test.tsx`):
- "names the first three cited domains in citation order and the rest behind +N": an answer citing 5 distinct hosts
  (citation_index out of order, one host twice, one `www.` host) shows 3 chips in `citation_index` order, deduped by
  `displayDomain`, and a "+2" button whose popover lists the other 2.
- "shows no overflow chip for three domains or fewer, and no list for none".
- "draws the chips in the neutral chip style, with no role colour" (no `Badge tone="info"`; the own domain's citation
  is said by the Cited fact badge).

Implementation: replace `topSources` (cap 3) with `citedDomains(citations)`: sorted by `citation_index`, mapped
through `displayDomain(host)`, unique, all of them; render `<DomainChipList label={latest('sourcesLabel')}
domains={domains.map((domain) => ({ domain }))} />`. No `href`: the domain inspector does not exist yet (WP-21/22
adds the link). Drop `SOURCE_ROLE_KEYS` and the `latest('source', ...)` call.
UI checks: card at 390 and 1280, light and dark; popover keyboard path (Enter opens, Escape closes); axe.
Prove it bites: keep the old 3 cap and the "+2" test fails; dedupe by raw host and the `www.` test fails.

## Task 4: History stale event

Rows: WB-PIH-08; confirms WB-PIH-01, 03, 04, 05, 07.
Files: `features/prompts/history-model.ts`, `history-model.test.ts`, `inspector-history.tsx`, new
`features/prompts/inspector-history.test.tsx`, `prompt-inspector.tsx` is NOT touched (`range` and `engines` are
already props of `InspectorHistory`), `messages/en.json` (`prompts.inspector.history.eventStale`).

Tests first:
- `history-model.test.ts` "adds a stale event for each enabled engine with no valid answer for 7 days or more":
  `staleEvents(engineCodes, observations, { from, end })` where `end` is an ISO instant. Gemini valid on Oct 20 and
  Oct 30, ChatGPT valid every 3 days: one event for Gemini dated Oct 20 with `days: 10`; a gap of exactly 7 days
  counts, 6 does not; an engine with no valid answer in the list gets one event from `from` with the window's days;
  invalid answers (`facts?.is_valid !== true`) do not end a gap; engines not in `engineCodes` get none.
- "measures the last gap to the end of the window, never past now" (end given as the earlier of window end and now).
- `inspector-history.test.tsx` "lists a stale engine in the events with its days": render `InspectorHistory` with
  props (no server needed: `counts` and `answers` are props) and see "No valid answer on Gemini for 10 days" with
  its date, newest first among the events, and no stale event while `answers.status === 'loading'`.

Implementation:
- `STALE_AFTER_DAYS = 7` in `history-model.ts` with the comment
  `// shortcut: twice the twice-weekly schedule, replace with the shared stale rule of WP-18 (CF-27) when it lands`.
- `HistoryEvent.kind` gains `'stale'` with `days?: number`; `staleEvents` returns events with id `stale:<engine>:<at>`;
  `historyEvents` keeps its signature; the tab merges `[...historyEvents(...), ...staleEvents(...)]` sorted newest
  first. Days are whole days, `Math.floor(ms / 86_400_000)`.
- Window end instant in the tab: the end of `range.to` in the project zone, capped at `Date.now()`; derive with the
  existing date helpers (no new library).
- Icon for stale: `CircleSlash` (lucide) in `text-foreground-tertiary` (no colour: a stale engine is not a detectable
  change). Key `eventStale`: "No valid answer on {engine} for {days, plural, one {# day} other {# days}}".
- The answers list holds at most 200 rows: when `answers.hasMore` the oldest gap is not measured; say nothing extra.
UI checks: Events at 390 and 1280, light and dark, Compact; axe in the component test.
Prove it bites: change 7 to 8 and the "exactly 7 days" test fails; count invalid answers as valid and the
invalid-answer test fails; drop the `Date.now()` cap and the "never past now" test fails.

## Task 5: History model change marker on the chart

Rows: WB-PIH-11; confirms WB-PIH-02 (adds the legend toggle test).
Files: `history-model.ts`, `history-model.test.ts`, `inspector-history.tsx`, `inspector-history.test.tsx`,
`messages/en.json` (`prompts.inspector.history.markerModel`, `history.markerNote`).

Tests first:
- `history-model.test.ts` "puts a model change on the week it happened in": `modelBoundaries(events, weeks, timeZone)`
  maps each `model` event to the latest `weeks` entry `<= formatIsoDate(event.at, timeZone)`; an event before the
  first week is dropped; two engines changing in one week give two boundaries, each naming its engine.
- `inspector-history.test.tsx` "draws a dashed marker for each model change and says it under the Table view": the
  `extendOption` result (spy on `rateBandOption` with `vi.spyOn` on `@/lib/charts/rate-band-chart`, or read the
  rendered option the frame passes to the mocked `EChart`, as `small-multiples.test.tsx` does) has
  `boundaries: [{ at: 'Oct 27', label: 'ChatGPT: gpt-5' }]`; the Table view (click "Table" in the frame) shows the
  marker note "Model change on ChatGPT, week of Oct 27: gpt-4o to gpt-5".
- "lets the legend hide an engine" (WB-PIH-02 confirm): pressing the Gemini legend button sets `aria-pressed=false`.

Implementation:
- `modelBoundaries` returns `{ at: formatChartDate(week), label: t('markerModel', { engine, model: to }) }` built in
  the tab (the model returns `{ week, engineCode, to, from }`, the tab adds words).
- Pass `boundaries` into `rateBandOption(...)` in `extendOption`, and add top grid room as `small-multiples.tsx`
  does (`BOUNDARY_ROOM` copy, 24 px) only when a boundary is drawn.
- Table view words: `ChartFrame` has no boundary slot, so put the markers in the frame `footnote` as a
  `type-meta` list (`markerNote`: "Model change on {engine}, week of {date}: {from} to {to}"), so they are read with
  and without the chart. Label in the chart: "{engine}: {model}", short.
UI checks: chart at 440 docked and 390 sheet, label not clipped, light and dark (the dashed line uses
`tokens.foregroundMuted`), Compact; axe.
Prove it bites: map to the earliest week instead of the latest `<=` and the week test fails; pool both engines into
one label and the two-engine test fails.

## Task 6: Stats SampleCount and aggregation label

Rows: WB-PIS-04; confirms WB-PIS-01, 02, 03.
Files: `features/prompts/inspector-stats.tsx`, new `features/prompts/inspector-stats.test.tsx`, `messages/en.json`
(`prompts.inspector.stats.aggregation`; remove `stats.sample` if no longer used).

Tests first (render `InspectorStats` with props):
- "says the sample with SampleCount": a line with k 5 of n 8 has `[data-slot="sample-count"]` with "5 of 8 answers";
  a `none` line shows `n/a` style `EMPTY_VALUE`, never "0 of 0".
- "names the aggregation of each engine": each engine section has "Gemini only: each valid answer of this prompt
  counted once" (`aggregation`), so no reader takes it for a pooled rate.
- The existing "the Stats tab" tests (estimate, interval, too few, method) keep passing.

Implementation: replace the sample `span` with `<SampleCount k={line.stats.k} n={line.stats.n} noun="answers" />`
when `state !== 'none'`; add one `type-meta` line per engine section after the list:
`words('aggregation', { engine: engine.engine.label })`.
UI checks: 390 and 1280, light and dark, Compact; axe.
Prove it bites: pass `n` as `k` and the "5 of 8" test fails; render the aggregation once for the tab and the
per-engine test fails.

## Task 7: Open statistics from the Stats tab

Rows: WB-PI-22.
Files: `inspector-stats.tsx`, `inspector-stats.test.tsx`, `stats-model.ts`, `stats-model.test.ts`,
`prompt-inspector.tsx` (two props on the Stats render line), `messages/en.json`
(`prompts.inspector.stats.openStatistics`, `openStatisticsLabel`, `definitionMention`, `definitionCitation`,
`metricMention`, `metricCitation`, `intervalMethod`).

Tests first:
- `stats-model.test.ts` "builds the statistics panel content of one rate of one engine": `statisticsContent(row,
  { metricName, engine, scopeText, definition, methodText })` gives `estimate.numerator/denominator` k and n,
  `noun: 'answers'`, `prompts: 1`, `observationWeighted: null`, `insufficient: { valid: n, required: MIN_OBSERVATIONS }`
  below the minimum and `null` otherwise, `interval` from the Wilson interval or `null`, `comparison: null`,
  `boundaries: []`.
- `inspector-stats.test.tsx` "opens the statistics of a rate and comes back": each line with a sample has a button
  "Open statistics" named "Open statistics for Mention on Gemini"; pressing it shows `[data-slot="statistics-panel"]`
  for Gemini Mention with the window as scope text, and "Back to Stats" returns to the list with focus on the same
  button. No button on a `none` line.
- `prompt-inspector.test.tsx` "starts the Stats tab on its list for the next prompt": open a panel, press J, the list
  is shown again (the tab is keyed by the prompt).

Implementation:
- `InspectorStats` gains `range: DateRange` and keeps `{ engineCode, metric } | null` in state; the open view renders
  `<StatisticsPanel placement="inspector-tab" state={{ kind: 'ready', data }} backTo={{ label: t('tabStats'), onBack }} />`.
  Focus: move to the panel's back button on open, back to the opening button on return (refs, no timers).
- `prompt-inspector.tsx`: `<InspectorStats key={promptId} range={range} ... />`. Nothing else in the file.
- `scopeText`: `formatDateRange(range.from, range.to)`; definitions in one sentence each; `methodText` reuses
  the Wilson wording.
UI checks: panel inside the tab at 440 and 390, light and dark, Compact; keyboard open and back; axe.
Prove it bites: drop `key={promptId}` and the J test fails; give `insufficient` for state `ok` and the model test
fails; pool both engines into one panel and the engine-name test fails.

## Task 8: ConfidenceIndicator in the design system page

Rows: WB-PIS-06. Lease: `components/design-system/metric-parts-section.tsx`, `metric-parts-section.test.tsx`.
Push early and alone.

Tests first: `metric-parts-section.test.tsx` `GROUP_TITLES` gains `'ConfidenceIndicator'` (after `'SampleCount'`);
"shows each form of the confidence indicator": the group has rows Text, Text and bar, Bar, Unknown, and the Unknown
row shows no percent and no bar.
Implementation: one `SpecimenGroup title="ConfidenceIndicator"` with note "23 section 8. The interval is the 95
percent Wilson interval; an unknown estimate shows no bar." and rows using `ConfidenceIndicator` (`estimate`, `low`,
`high`, `form`, `label`) for `text`, `text-and-bar`, `bar`, and `estimate={null}`. Literal English as the other
specimens use; no `en.json`.
UI checks: `/design-system/metric-parts` at 390 and 1280, light and dark; axe (the section test runs it).
Prove it bites: put the group after StatisticsPanel and the title order test fails.

## Task 9 (conditional): Hashed evidence

Rows: WB-PI-23. Start only after `git fetch origin && git rebase origin/develop`.
1. `grep -n "sha256" apps/web/src/lib/api/schema.ts` inside `ObservationDetail`. Absent: do not build; report
   WB-PI-23 `blocked: CF-26 not on develop (WP-26 step 1)` and skip to Task 10.
2. Present and WP-26 already shows them in the answer viewer (`answer-inspector.tsx`): confirm with its test, add an
   assertion in `inspector-latest.test.tsx` that "Open the full answer" reaches the viewer, close the row as confirmed.
3. Present and not shown anywhere: in `inspector-latest.tsx` add one `type-meta` line per card, "Answer SHA-256
   <first 12 hex>" with `CopyButton` (`components/app/cells/copy-button.tsx`: `text`, `label`, `announcement`,
   `placement="inline"`, `inGrid={false}`) for the full value, and the same for the raw hash; a `null` hash shows no
   line, never zeros. Tests first in `inspector-latest.test.tsx` (shown, copied, null hidden). Keys under
   `prompts.inspector.latest`. Mock: add the fields to `mocks/handlers/prompt-answers.ts` detail only if WP-26 did not.
Prove it bites: render a null hash as zeros and the null test fails.

## Task 10: e2e flow, As built notes, full checks

Process rows. Files: new `apps/web/e2e/flows/ai-prompt-inspector.spec.ts` (and `apps/web/e2e/support/ai-prompt-inspector.ts`
only if a helper is shared), `docs/20-frontend-specification.md` 4.6 and 4.8, `docs/design-system/25-component-inventory.md`
(Tabs 3.38, ConfidenceIndicator), `messages/en.json` (remove the unused `latest.source` and `stats.sample` keys).

e2e (mock world, `signIn` and `expectAccessible` from `../support`, pattern of `ai-prompts.spec.ts`): open the first
Fynix prompt from the Prompts tab (`?tab=prompts&inspect=prompt:<id>`); header shows the topic path and "Updated";
Latest shows at most 3 domain chips and "+N" when there are more; History shows the model change marker note (the
profile mock's `model_change`) and the events; Stats shows `SampleCount`, the aggregation line, opens statistics and
comes back; at 390 the inspector is a sheet and the tab row has no horizontal scroll
(`scrollWidth <= clientWidth`); axe at 1280 and 390 in light and dark.
As built notes (append-only, no dashes): doc 20 4.6 (model change markers on the prompt History chart through
`rateBandOption` `boundaries`, the words repeated in the footnote for the Table view), doc 20 4.8 (Stats lines use
`SampleCount`), DS25 3.38 (`overflowLabel`, More tabs), DS25 ConfidenceIndicator (specimen on the metric parts page).
Full checks, one job, through the lock:
`infra/dev/heavy --label wp25-final --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm build'`,
then `infra/dev/heavy --label wp25-e2e --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-prompt-inspector.spec.ts e2e/flows/ai-prompts.spec.ts e2e/flows/design-system.spec.ts'`.

## Final review (fresh Sonnet reviewer)

Reads the brief, this plan and `git diff origin/develop...HEAD`; checks every row in the Row map against the code
and a test; checks the house rules across the whole diff (grep for U+2014 and U+2013, raw colours, `toFixed`,
`toLocaleString`); opens the Prompts page with `NEXT_PUBLIC_API_MOCKING=all` at 390, 768, 1024 and 1280 in light and
dark, Default and Compact, and walks each tab by keyboard; returns PASS or a numbered fix list.

## UI check setup (every task with UI checks)

Follow the Dev Server Policy: reuse this worktree's server if one is listening, else
`cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev -- --port <free port>`; never kill another server; at most 2
web dev servers on the machine. Test on the `localhost` origin in a background tab; `127.0.0.1` tabs are the
owner's. Stop the server when the task ends.

## Open questions (defaults taken)

- WB-PI-01 says "prompt text in quotes"; the `h2` has no quotes. The landmark is labelled by the `h2`, so quotes
  change the inspector's accessible name in 7 test files and the e2e helpers. Default: not changed here; reported
  to the coordinator as a finding for a later lease on `inspector-header.tsx`.
- WB-PI-23 depends on CF-26 (WP-26). Default: Task 9 decides at run time; blocked if the fields are not on develop.
- Stale threshold 7 days until WP-18 ships the CF-27 rule (shortcut comment in the code).
- Source chips have no domain inspector link until WP-21/22 add the route.
