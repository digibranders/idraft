# Topics & Prompts: parity with the approved design preview

Status: written 2026-11-12; the owner decided the open product decisions of section 4 on 2026-11-12 (D-3, D-6 and D-8, plus the backend decisions of the handoff section 5). Read-only analysis; nothing was run. Gap statuses are as of `origin/develop` at `6d681a5`.
Sources compared: the preview (`apps/web/design-preview/prompts*.js`, `index.html`), the real app (`apps/web/src/features/prompts/*`, `apps/web/src/lib/api/schema.ts`), the backend (`backend/src/idraft/api/ai/*`, migration `0018_ai_prompts.py`), and the specs ([ADR-DS-022](../../design-system/adr/ADR-DS-022-topics-and-prompts.md), [24-page-templates](../../design-system/24-page-templates.md) 9.5, [20-frontend-specification](../../20-frontend-specification.md) 5.6, 5.7, 5.11, [23-application-patterns](../../design-system/23-application-patterns.md) 4.2, [19-api-specification](../../19-api-specification.md) 3.7, the [slice 1 spec](2026-11-11-ai-prompt-tracking-slice-1-design.md)).
Companions: [competitor study](2026-11-12-ai-visibility-competitor-study.md), [web plan](../plans/2026-11-12-ai-prompts-w2-web-parity.md), [backend handoff](../plans/2026-11-12-ai-prompts-d-backend-handoff.md), [roadmap](../plans/2026-11-12-ai-visibility-roadmap.md). The backend plan for the summary additions is [D1](../plans/2026-11-12-ai-prompts-d1-summary-additions.md).

## 1. Goal and the rule of this spec

The real Topics & Prompts page reaches the approved preview where the data exists, and says plainly where it does not. The preview is a layout spec only: its numbers are invented in several places (section 3), so a data contract is taken from the backend and the docs, never from the preview.

## 2. What exists today

Real app: tabs Topics and Prompts. Per enabled engine two columns, Mentioned and Cited, as counts ("4 of 8"). Filter bar: Topic, Country (Prompts tab only), Engine, Branded (Include). Window 7, 28 or 90 days. **Topic drawer exists** (`apps/web/src/features/prompts/topic-inspector.tsx`): Overview (three averaged rates, per-engine rates, 5 top prompts) and Prompts tabs. Prompt inspector is one scroll (facts, by engine, answers; Run now; Archive with Undo); answer viewer with marks, sources and raw download (410 and 503 handled). Add prompts dialog with API lint, quota and bulk-create outcomes. Loading, empty, filtered-empty, error, partial and no-engine states are built and are richer than the preview. Run now is mocked end to end.

**Not built:** the metric strip (the Prompts feature has no `MetricStrip`), rate columns, sorting on Topics, deltas, any menu, bulk bar, export, saved views, inspector tabs.

Backend on `origin/develop`: `GET/POST {P}/prompts`, `bulk-create`, `lint`, `GET/PATCH/DELETE prompts/{id}`, `POST prompts/{id}/run-now`, `GET/PUT/DELETE engines`, `GET ai/observations` (+ `{id}`, `{id}/raw`), `GET ai/prompts-summary` (`from`, `to`, `filter[engine_code_in]`, `include_branded`; per prompt and topic per engine: mentioned, cited, outcomes, share of voice as `MetricCell`, plus the tracked `entities` list). **B1 is built** (`6d681a5`): `last_observed_at` and `last_valid_at` on prompt and topic rows (the web client needs `pnpm gen:api`). The backend session's [D1 plan](../plans/2026-11-12-ai-prompts-d1-summary-additions.md) adds, as opt-in parameters, `filter[country_iso]`, `filter[term]`, `branded_only`, `compare=previous_period`, `include=series,entities`. Not built anywhere: panels, versions routes, saved views, exports, citations aggregates, AI Overview, keyword links, candidates, the fan-out route.

Reusable parts: `MetricStrip` (`apps/web/src/components/app/metric`), `SparklineCell`, `ChartFrame` and `EChart`, `DataTable` (bulk actions, column chooser, `/` search, tree rows), `lib/stats` (`wilsonInterval`, `isDetectableChange`, `MIN_OBSERVATIONS = 4`, panel sizing), client export (`features/rankings/export`), `useVocabularies` (topic tree), `GET {P}/runs`, the schedules screen.

## 3. Status words

Status of the real app per gap: **BUILT**, **PARTIAL**, **MISSING**. Backend column: **ready** (API exists), **B n** (backend item, see handoff and D1), **blocked S n** (needs slice n). Size: S under a day, M one to three days, L more. Task is the web task of the [web plan](../plans/2026-11-12-ai-prompts-w2-web-parity.md).

## 4. Product decisions

| # | Decision | Applied in the plan | Caveat or decision of 2026-11-12 |
|---|---|---|---|
| D-1 | Counts or percent | Percent next to the count in every rate cell ("83%" with "5 of 6" in the cell or its tooltip), and a hatched insufficient-data pill with "N obs" when a cell has fewer than `MIN_OBSERVATIONS` (4) valid answers. The preview shows a bare percent, the real app a bare count, the ADR and docs 16 and 19 say a count with its ratio: this takes the docs' form and adds the pill. With 2 answers a week and 28 days a cell has at most 8 answers, so a bare "50%" over 4 answers is what UI rule 11 warns against | none |
| D-2 | Previous period delta | Two summary reads (current window and the preceding window of equal length) and the unpaired `isDetectableChange` from `lib/stats`. The delta is coloured only when detectable (rule 6). Labelled "interim test" in its tooltip until slice 3 (paired test). When D1 Task 3 is on develop the second read becomes `compare=previous_period` | The verdict and the number can disagree: the displayed value is prompt weighted, the test pools answers (ADR-DS-022 calls it temporary) |
| D-3 | Nested topics | **Decided 2026-11-12: an indented tree on the Topics tab.** A parent row rolls up its children, children indent under it (expand and collapse), and a note says rows do not add up to the parent. The table depth stays at two levels: a topic deeper than level 2 gets no row of its own, its counts roll up into its level 2 and level 1 rows, and the drawer shows its name as a path. The category subtitle and the path badge stay | Decided; the sub-task is in W2 (parent counts roll up, so a prompt in a child counts in the child row and again in each ancestor row) |
| D-4 | Panels and Versions tabs | Hidden until slice 4 (as the slice 1 spec says). The preview shows them; do not build stubs | none |
| D-5 | Manual run limit | 20 manual runs a day per project (`MANUAL_RUNS_PER_DAY`, `429 manual_run_limit`) plus the month's answers cap (`422 quota_exceeded`). Bulk Run now on the web is capped at 20 a day and says so, until B7 makes it one run | To be discussed in a separate session, no decision yet; the capped version stays meanwhile |
| D-6 | Cadence | **Decided 2026-11-12: twice a week (Monday and Thursday) for every prompt**, as built and as Settings > Engines says; weekly may become a per panel option later. Doc 11 section 8 is corrected. The Panels tab copy of the preview (Core weekly, Discovery monthly) is not copied, and the mocks set weekly by `c1abdd4` go back to twice a week when W14 starts | Decided; Panels (AP-10) is unblocked on cadence |
| D-7 | Branded prompts | Excluded from rates unless included (doc 16 rule 4); the Branded filter becomes three way (Excluded, Included, Only) | `is_branded` means "names the OWN brand" (doc 16, backend); the preview lint also errors on competitor aliases: keep the backend definition |
| D-8 | Prompt type | **Decided 2026-11-12: a server rule at create plus a person override** in the Add dialog and `PATCH`, no LLM (" vs " or "versus" gives comparison, "how to" gives how_to, a leading interrogative gives question), and `filter[prompt_type_in]` on `GET {P}/prompts` (B16). The Type filter and badge stay hidden until B16 is on develop | Decided; B16 is unblocked |
| D-9 | Rank in the Latest card | Never show `own_mention_order` as Rank; structured list rank is slice 2 | none |
| D-10 | Competitor and trend numbers | Never invent them. A tab is empty with a reason until its backend item lands | none |

**D-3, the choice made.** Of the three options considered (an indented tree with a note that rows do not sum to parents; leaf topics only with the category as a subtitle, as the preview does; the current flat overlapping list), the owner chose the indented tree on 2026-11-12, and on the same date the owner kept the table depth at two levels. The preview drops the "rows do not sum to parents" note that doc 20 5.11 had; the real page keeps it.

## 5. Gap table

Order column of the earlier analysis: 1 frontend only, 2 frontend plus a small backend addition, 3 slice 2 or 3 work, 4 slice 4 work.

### 5.1 Page header, filter bar, strip

| # | Item | Preview (file, function) | Real | Data needed | Backend | Size | Task |
|---|---|---|---|---|---|---|---|
| G01 | Header meta "Updated Sep 28, 02:10, 13 topics, 250 prompts" | `prompts.js` `renderStrip`, `renderFooter`; `prompts-topics.js` `renderChrome` | PARTIAL: meta is the date window only (`prompts-screen.tsx`) | time of last answer; topic and prompt counts | B1 BUILT (`last_observed_at`) | S | W6 |
| G02 | Saved view menu: Default, Branded prompts, Discovery panel, "Save view as" | `index.html` `#menu-prompt-view`; `prompts-state.js` `VIEWS` | MISSING | filter presets, then persisted views | Presets web only. Persistence B8 (`{P}/saved-views`, `core.saved_views` not created). Discovery preset blocked S4 | S presets, M persist | W5 (presets) |
| G03 | More menu: Export CSV, Import prompts, Copy link, Generate from keywords | `#menu-prompt-more`; `prompts.js` `exportRows` | MISSING | rows; URL | Export and Copy link web only. Generate from keywords B18 (S4) | S, L | W5 |
| G04 | Import button | preview note only | MISSING | CSV parse | `bulk-create` (up to 1,000) ready; upload route Ph 11 | M | W5 (CSV into the Add dialog) |
| G05 | Compare control and deltas on strip, rows, drawers | `#ed-compare`; `deltaNode`; `changeFor` | MISSING | summary of the previous window; detectable flag | Two reads ready. `compare=previous_period` is D1 Task 3 (B4). Same period last year: no data. Paired test: S3 | M | W3 |
| G06 | "Detectable changes only" chip | `FIELDS`, `inScope` | MISSING | deltas (G05) | after G05; server verdict S3 | S | W3 |
| G07 | Date range (top bar) | top bar | PARTIAL: 7, 28, 90 select | custom from and to | ready (`from`, `to`, 92 days max) | S | W5 |
| G08 | Branded filter three way | `BRANDED_LABEL`; `FIELDS.branded` | PARTIAL: Include only | `branded_only` | Prompts tab web only (rows carry `is_branded`). Topics tab and strip: D1 Task 2 (B2) | S, S | W5, W6 |
| G09 | Panel filter chip | `FIELDS.panel` | MISSING | panels | blocked S4 | M | W14 |
| G10 | Type filter chip and badge | `FIELDS.type`, `promptLine` | MISSING | prompt type per prompt | `Prompt.prompt_type` exists but the Add dialog sets `question` on every prompt (`API_DEFAULTS` in `add-prompts-dialog.tsx`); no `filter[prompt_type_in]`. Source decided (D-8); B16 builds the rule and the filter | M | W17 (after B16) |
| G11 | Country filter on Topics tab | top bar location | PARTIAL: Prompts tab only | summary scoped by country | D1 Task 2 (B2) | S | W6 |
| G12 | Strip: "Prompts" card plus one card per engine (value, delta, "Cited 21%, SOV 27%", counts in tooltip); single engine shows 4 rates | `renderStrip`, `engineCard`, `scopeRate` | MISSING: no strip | per engine prompt weighted mention and citation, pooled SOV, topic count | web computes from `prompts-summary` prompt rows. Recommendation card S2. Deltas G05 | M | W1 |
| G13 | Insufficient data state (under 4 answers) | `prompts-parts.js` `insufficient`; `lib/stats` `rateState` | MISSING | n per cell | web (`MIN_OBSERVATIONS`) | S | W1 |
| G14 | Mobile list rows below 768 px | `listRowFor`; `listRow` | MISSING (no list mode in `DataTable`; not visually checked) | none | web | M | W16 |

### 5.2 Topics tab

| # | Item | Preview | Real | Data needed | Backend | Size | Task |
|---|---|---|---|---|---|---|---|
| G20 | Topic row subtitle "Category, N prompts" | `topicRow` | PARTIAL: name only | parent from topic tree | ready (`useVocabularies`) | S | W2 |
| G21 | Mention rate column: equal weight average over engines, "avg of N", delta, counts in tooltip | `topicRateCell`, `groupAverage` | MISSING | per engine topic cells | ready; `acrossEngines()` exists in `prompt-model.ts` | S | W2 (delta W3) |
| G22 | Citation rate column (average) | `COLUMNS.citation` | MISSING | same | ready | S | W2 |
| G23 | Sorting on Topics, default Mention rate desc | `SORTS` | MISSING (`NO_SORT` in `topics-table.tsx`) | none | web | S | W2 |
| G24 | Top engine column | `topEngineCell` | MISSING (deliberate shortcut) | per engine mentioned values | ready | S | W2 |
| G25 | Expand all and Collapse all | `data-topic-expand-all` | MISSING | none | web | S | W2 |
| G26 | Select topics, bulk bar (Run now, Export, Clear, "N topics selected, M prompts") | `renderChrome`, bulkBar | MISSING | topic prompt ids | Export web. Run now for many prompts: B7 | M | W5 |
| G27 | Topic row menu (Open, Show in Prompts, Add prompt, Run now, Export CSV) | `#menu-topic-row` | MISSING | none | web except Run now (B7) | M | W5 |
| G28 | "Show in Prompts" with the topic filter | `showInPrompts` | PARTIAL: filter shared in the URL, no menu action | none | web | S | W5 |
| G29 | Trend sparkline column (weekly mention rate) | `groupTrend`, `sparkCell` | MISSING | weekly points per topic | `include=series` is D1 Task 4 (B3) | M | W11 |
| G30 | Updated column and Stale badge | `updatedCell`, `groupUpdated` | MISSING | last observed, last valid | B1 BUILT | S | W6 |
| G31 | SEO visibility and Top 10 columns (topic's tracked keywords) | `seoOf`, `COLUMNS.seo/top10` | MISSING | tracked count, top 10, volume weighted visibility | Top 10 and counts: `GET {P}/tracked-keywords` `filter[term]`, `filter[rank_lte]=10`, `page.total`. Visibility: B9 (`seo/metrics/breakdown?dimension=term`, not built). Verify that keyword and prompt topics share one vocabulary | M | W16 |
| G32 | Nested topics | fixed two levels (`TOPIC_PARENT`) | PARTIAL: flat and overlapping, no subtitle | tree depth | ready. Decided (D-3): indented tree, two levels | M | W2 (subtitle and the indented tree) |
| G33 | Footer "13 topics, 250 prompts, Updated ..." | `renderChrome` | PARTIAL: DataTable footer count only | G01 | ready | S | W2 |

### 5.3 Prompts tab

| # | Item | Preview | Real | Data needed | Backend | Size | Task |
|---|---|---|---|---|---|---|---|
| G40 | Mention rate (avg of N) and Citation rate columns, default sort Mention rate desc | `rowFor`, `renderHead`, `promptRateCell` | MISSING: default sort A to Z | per engine cells | ready | S | W2 |
| G41 | Engine columns with metric switcher (Mention, Citation, Recommendation, Share of voice) and grouped header | `#prompt-metric`, `renderHead` | PARTIAL: fixed pair per engine | SOV cell per engine | SOV ready (`share_of_voice`). Recommendation blocked S2 (B14) | S | W2 |
| G42 | Recommendation rate column | `COLUMNS.recommendation` | MISSING | `own_recommended` | column exists, null; no summary cell. S2 (B14) | M | blocked S2 |
| G43 | Top competitor column | `competitorCell`, `topCompetitor` | MISSING | per entity counts per prompt | D1 Task 5 (B5) `include=entities` | M | W8 |
| G44 | Trend and Updated or Stale columns | `promptTrendCell`, `promptUpdatedCell` | MISSING | G29, G30 | B1 BUILT; B3 | M | W6, W11 |
| G45 | Topic column with path tooltip and badge | `topicCell` | PARTIAL: plain text | `prompt.terms[].path` | ready | S | W2 |
| G46 | Row menu: Open, Run now, Edit prompt, Copy prompt, Archive; right click | `#menu-prompt-row` | MISSING (Run now and Archive inside the inspector only) | none | Run now, Archive, `PATCH` ready. "Edit prompt" text is slice 4 (text immutable); the menu offers Edit details instead | M | W5 |
| G47 | Bulk bar: "N selected", "Select all N matching", Run now, Add to panel, Export, Archive | `renderSelection`, `bulkBar` | MISSING | ids | Export web. Archive: `DELETE` per id works (150 at most); `bulk-archive` is documented (doc 19 line 1093), not built (B7). Run now B7. Add to panel S4 | M | W5 |
| G48 | Interval tooltips (95% Wilson) on rates | `engineValue`, `intervalText` | MISSING | k, n | web `wilsonInterval`; backend `ci` S3 | S | W4 |
| G49 | Pagination 25 with counter | `renderFooter` | BUILT (`DataTable`) | | | | |

### 5.4 Panels and Versions (the real page has neither tab; both stay hidden until slice 4)

| # | Item | Real | Backend | Size | Task |
|---|---|---|---|---|---|
| G60 | Panels table (name, Locked, kind, prompt count, schedule, engines, changes in 90 days, last run) | MISSING | blocked S4: `ai.prompt_panels`, `ai.panel_memberships` not created; routes `{P}/panels`. Schedule and last run readable now | L | W14 |
| G61 | Panel kinds, create, rename, delete | MISSING | S4 (experiment Ph 15) | L | W14 |
| G62 | Core lock, unlock with reason, memberships, 10% churn warning | MISSING | S4 (`panels:core:modify`) | L | W14 |
| G63 | Promotion candidates from Discovery | MISSING | S4 and Ph 9 | L | W14 |
| G64 | Membership history list | MISSING | S4 | M | W14 |
| G65 | Sizing guidance: flip rate per engine, "can detect N points" | MISSING | formula in `lib/stats/panel.ts`; flip rate needs paired runs (`ai.flip_rate`, S3). Do not ship constants | M | W14 |
| G66 | Run now for a panel | MISSING | needs B7 and panels | M | W14 |
| G67 | Versions table | MISSING | S4; project wide feed is B12 (new route) | M | W14 |
| G68 | Restore a version | MISSING | S4 (B11). Decided: a restore is not a `change_kind`; it re-points `current_version_id` and writes an audit entry (section 6 item 9) | M | W14 |
| G69 | Edit prompt text as a new version | MISSING | S4 (`POST prompts/{id}/versions`) | L | W14 |
| G70 | Version boundary marker on charts | MISSING | S4 | S | W14 |

### 5.5 Add prompts dialog

| # | Item | Real | Backend | Size | Task |
|---|---|---|---|---|---|
| G80 | Paste lines, lint, quota, per line results | BUILT (stronger than the preview) | | | |
| G81 | Panel select and "Reason" for core | MISSING | S4 | S | W14 |
| G82 | Open Add prompts with a topic preselected | MISSING | web (`AddPromptsDialog` takes defaults) | S | W5 |
| G83 | Lint rules: 5 to 60 words, one question, leading wording, language mismatch, competitor alias | PARTIAL: API lint has `contains_brand_alias` and `engine_limit` only | B17; slice 4 is the natural home | M | blocked |

### 5.6 Prompt inspector (preview 440 px, tabs Latest, History, Citations, Competitors, Stats)

| # | Item | Real | Data needed and backend | Size | Task |
|---|---|---|---|---|---|
| G90 | Tabs instead of one scroll | MISSING | web | M | W4 |
| G91 | Header badges: topic path, type, panel, version, Branded | PARTIAL: topic only when opened from a topic; Branded; Archived | `terms[].path` ready. Type is empty data (D-8); panel and version S4 | S | W4 |
| G92 | Strip: mention per engine plus citation average | PARTIAL: "By engine" key values as text | cells ready | S | W4 |
| G93 | Latest: latest valid answer per engine with highlighted brands, facts, source chips, "Open evidence" | PARTIAL: answers list and viewer exist, no latest cards | `GET ai/observations/{id}` one read per engine. Rank and Recommended S2 (D-9) | M | W4 |
| G94 | History: 28 day rolling mention chart with 95% band | MISSING | `GET ai/observations` `filter[prompt_id]` (about 80 rows per 90 days, one 200 row page); interval web; backend ci S3 | M | W4 |
| G95 | History: last 10 observations table with ticks | PARTIAL | ready; Recommended S2 | S | W4 |
| G96 | History: event list (added, stale, new model reported) | MISSING | created_at and `model_reported` ready; version and panel events S4 | S | W4 |
| G97 | Citations tab: top 5 domains with role and count, top 5 pages | MISSING | B6 `GET {P}/ai/citations` and `ai/sources/*` with `filter[prompt_id]`. Summing 20 to 30 detail reads in the web is not recommended | M | W7 |
| G98 | Competitors tab: entity by engine | MISSING | web counts `facts.competitor_mentions` from the observation list for ONE prompt (names from `summary.entities`). Recommendation S2 | M | W4 |
| G99 | Competitors tab: related keywords, "Link a keyword" | MISSING | blocked S4 (`core.keyword_prompt_links`) | L | W14 |
| G100 | Stats tab: estimate, interval bar, sample per engine | MISSING | web (`wilsonInterval`); backend ci S3 | S | W4 |
| G101 | Run now, Archive, J and K stepping, "3 of 250", topic badge back | BUILT | | | |
| G102 | "Open statistics", "Open page" (Prompt Detail T3) | MISSING | T3 route `/ai/prompts/[promptId]` is not in slice 1 | L | blocked S4 |

### 5.7 Topic drawer (preview Overview, Prompts, Competitors, Related)

| # | Item | Real | Backend | Size | Task |
|---|---|---|---|---|---|
| G110 | Header "Add prompt" button | MISSING | web | S | W5 |
| G111 | Three rate cards with change, "avg of N" | PARTIAL: rates without change | G05 | S | W3 |
| G112 | Visibility trend: own brand vs 3 most mentioned competitors, 8 weeks | MISSING | D1 Tasks 4 and 5 (`include=series,entities`); the preview's competitor lines are random jitter | L | W11 |
| G113 | By engine: bar plus rate plus "k of n" | PARTIAL: text rates, no bar | ready | S | W2 |
| G114 | "In search" card: keyword count, SEO visibility, Top 10, link to Rankings | MISSING | see G31 | M | W16 |
| G115 | Top prompts: 5 rows with mention, citation, change, "View all" | PARTIAL: no change column | G05 | S | W3 |
| G116 | Competitors tab | MISSING (`topic-inspector.tsx` has a shortcut comment) | D1 Task 5 (B5) | M | W8 |
| G117 | Related tab: sibling topics, related keywords | MISSING | siblings from the topic tree; keywords `GET {P}/tracked-keywords` `filter[term]`, `include=aio`; linked badge S4 | M | W16 |
| G118 | J and K steps between topics; "3 of 13" | MISSING | web | S | W5 |

### 5.8 Cross-cutting

| # | Item | Real | Backend | Size | Task |
|---|---|---|---|---|---|
| G120 | AI Overview as fourth engine | MISSING | blocked S2: no engine seed, no links table, `source_state` contract open in the ADR (B13) | L | blocked S2 |
| G121 | Recommendation, prominence, sentiment | MISSING | S2: columns exist in `observation_facts`, null (B14) | L | blocked S2 |
| G122 | Copy link; shared link restores the drawer (`?inspect=prompt:` or `topic:`) | BUILT | | | |
| G123 | Keyboard: `/` search, J and K step, Enter | PARTIAL: `/` and prompt J and K; no topic J and K | G118 | | W5 |
| G124 | Export (CSV of rows, bulk or all) | MISSING | client export (pattern of `features/rankings/export`); server `POST {P}/exports` not needed yet | S | W5 |
| G125 | Edit prompt metadata (topic, importance, type, intent) | MISSING | `PATCH prompts/{id}` ready | M | W5 |

The ids are not contiguous (the earlier analysis numbered 77 gaps). BUILT rows: G49, G80, G101, G122. Every other row is open, and each names its task or its blocker.

## 6. Preview mistakes we must not copy

| # | What the preview does | What we do |
|---|---|---|
| 1 | Manual runs: `MANUAL_RUNS_LEFT = 400` "this month", computed as prompts times engines; Run now "queued then the toast" | Real limit is 20 manual runs a day per project (`MANUAL_RUNS_PER_DAY`, `429 manual_run_limit`) plus the month's answers cap (`max_ai_observations_per_month`, `422 quota_exceeded`). Answers arrive in minutes through the standard queue. A bulk run of 30 prompts exceeds the day limit until B7 makes it one run |
| 2 | `PROMPT_QUOTA = 600`, 302 fixture prompts (250 core, 12 branded, 40 discovery) | Base plan is 150 active prompts (`max_active_prompts`, slice spec 4.7). Do not tune pagination or "Select all N matching" to 250 |
| 3 | Panels tab says Core "Weekly", Discovery "Monthly" | Decision D-6, decided: twice a week (Monday and Thursday). Doc 11 section 8 is corrected; commit `c1abdd4` made the mocks weekly, so they go back to twice a week when W14 starts |
| 4 | Every panel lists ChatGPT, Gemini and AI Mode | Doc 11 section 8: Discovery uses ChatGPT and AI Mode, Experiment is configurable |
| 5 | Bare percent with the sample in a tooltip | Decision D-1 |
| 6 | Invented numbers: competitor trend lines (random jitter in `entitySeries`), competitor recommendation "roughly half of mentions", random citation shares with hard coded domains, versions' authors and reasons (`CHANGE_REASONS`), flip rates (`FLIP_RATE`), membership history | Layout only. The data contracts are B3, B5, B6, B10, B11 |
| 7 | Two fixed topic levels, one row per leaf | Decision D-3, decided: an indented tree of at most two levels (deeper topics roll up into their level 2 row and get no row). The API returns a row for every topic and every ancestor and counts roll up, so the tree shows each parent row with its children indented under it and a note that rows do not add up to the parent |
| 8 | `isDetectableChange(pooled, pooled)` on pooled answers while the shown value is prompt weighted; panel sizing uses McNemar on paired runs | Decision D-2: label the interim test; keep the two models apart in the copy |
| 9 | Versions tab has no restore; doc 11 rule 3 says a restore re-points `current_version_id` and writes no row, doc 04 and migration 0018 restrict `change_kind` to `initial, wording, typo, context`, doc 19 lists `restore` | Decided 2026-11-12: a restore is not a `change_kind`; doc 19 is corrected (a restore re-points `current_version_id` and writes an audit entry) |
| 10 | Lint treats a brand name in a core prompt and a 5 word minimum as errors | The API warns on own aliases only (`contains_brand_alias`) and refuses over 2,000 characters; `is_branded` names the OWN brand (doc 16 rule 4). Keep the backend definition (D-7) |
| 11 | Add dialog without country, language or run estimate | The real dialog is right: the API requires a country every enabled engine has. Do not remove fields to match |
| 12 | Dead links: "Open page", "Edit prompt", "Open statistics", "Link a keyword", "Import", "Generate from keywords" are `data-preview-note` stubs | T3 `/ai/prompts/[promptId]` is not in slice 1 (a prompt opens in the inspector only). Do not render a link without a target |
| 13 | Hard coded "Updated Sep 28, 02:10" in three renderers; header says "250 core prompts" while the strip says "Prompts" | Time from the last answer (B1); one noun |
| 14 | "Rank" in the Latest card | Only `own_mention_order` exists in slice 1 (order of first mention). Structured list rank is S2 (D-9) |
| 15 | Stale docs: 24-page-templates 9.5 still describes the old Explorer (tabs Explorer, Panels, Versions; strip Mention, Citation, Recommend., SOV, Prompts); ADR decision 12 replaced the strip; decision 10 says 14 sidebar items (16 as built); the ADR (decision 11) and the slice spec (open point 1) disagree on AI Overview in slice 1 (the spec says slice 2) | Update the docs when W1 lands; follow the slice spec |
| 16 | Topic columns in the owner's brief (Mentioned, Cited, Share of voice, AI Overview) differ from the preview's Topics columns (Prompts, Mention rate, Citation rate, Top engine, Trend, SEO visibility, Top 10, Updated) | Share of voice appears on the Prompts tab metric switcher, the strip and the drawer cards only |

## 7. Acceptance of parity

The page is at parity when the checklist in [the roadmap, section 8](../plans/2026-11-12-ai-visibility-roadmap.md) is all ticked for the slice 1 data rows (W1 to W5), and every remaining gap above is either blocked on a named backend item or slice, or deliberately dropped here. Gaps never silently remain.

## 8. Not verified

A visual diff of the two screens, the mobile layout of the real tables, whether tracked keyword topic terms use the same vocabulary as prompt topics, and the exact share of voice numerator semantics at topic level (`summary.py` `_topic_engine`: one answer, one weight; D1 decision 8 confirms it for entity cells).
