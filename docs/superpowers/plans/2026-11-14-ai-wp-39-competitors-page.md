# WP-39: Competitors page: detailed task plan

Brief: [docs/ai-visibility/work-packages/WP-39-competitors-page.md](../../ai-visibility/work-packages/WP-39-competitors-page.md). Contracts: [c5-competitors.md](../../ai-visibility/contracts/c5-competitors.md), [c8-metrics.md](../../ai-visibility/contracts/c8-metrics.md), [c2-summary.md](../../ai-visibility/contracts/c2-summary.md) (change log C-10, C-11, C-15, C-18). Template: DS 24 section 9.8, doc 20 section 5.10, inventory web.md section 2.20 (rows WB-IA-05 and WB-CMP-01 to 12).
Worktree `.claude/worktrees/wp-39`, branch `ai/wp-39-competitors-page`, cut from `origin/develop` e4ab649e. Web only (`apps/web`). Written 2026-11-14 by the planner. Every fact in section 1 was read in this worktree at that commit. Rows: 11 (0 built, 11 to do). Tasks: 8. Estimate: about 11 hours with one task in flight (the brief says 6 hours: the page has four tabs, a mock for three routes and an inspector; see risk 1).

## How to read this plan

Section 1 lists what exists and what does not (several things in the brief differ from the code). Section 2 holds the rules every implementer follows. Section 3 settles every design question (the owner may overrule a default). Section 4 lists the files, the ownership and the LEASES TO ASK THE COORDINATOR FOR. Section 5 holds the 8 tasks (files, tests first, checks, rows, commit). Section 6 maps the 11 rows to a task and a proving test. Sections 7 to 9 give the order, the browser checks and the risks.

## 1. Facts found (they change the plan)

| # | Fact | Where | Consequence |
|---|---|---|---|
| F1 | The route file is a stub: `competitors/page.tsx` re-exports the 404 page. `planned-routes.test.ts` pins `/competitors` as a 404 page | `app/[workspace]/[project]/competitors/page.tsx`, `planned-routes.test.ts` line 24 | Task 2 replaces the file and removes the test row (lease L2) |
| F2 | `NavKey` has `competitors` and the registry entry exists with `status: 'planned'` (section 2, `Users` icon, `data:read`). `registry.test.ts` pins the planned list (line 174) and the path lookup (line 184) | `lib/navigation/registry.ts` lines 157 to 164, `registry.test.ts` | Flip to `live`: one line, plus one line in the test (lease L1). The sidebar label `nav.competitors` exists in `en.json` |
| F3 | `messages/en.json` has the empty top level namespace `"competitors": {}` (line 6488). `aiOverview.competitors` (WP-35) is another namespace | `messages/en.json` | The namespace is mine: lease L3, additive only |
| F4 | `mocks/handlers/competitors.ts` exports an empty `competitorHandlers`, already spread in `handlers/index.ts`. `handlers/registered.test.ts` pins it as `[]` (line 19). No handler answers `ai/competitors`, `overview/competitors` or `ai/metrics/*`, and `pending.ts` has none, so in `NEXT_PUBLIC_API_MOCKING=all` they are unhandled | `mocks/handlers/` | My module is `competitors.ts` (registered, no `index.ts` edit). I must delete my slot from `registered.test.ts` (lease L4, precedent: WP-30 did the same for `ai-health`) |
| F5 | The generated client has the routes and models: `AiCompetitorsResponse`, `AiCompetitor`, `AiCompetitorEngine`, `LostPrompt`, `CompetitorSource`, `AiMetricSeries`, `AiMetricPoint`, `PointPool`, `AiMetricMeta` (with `entity_config_changes`), `AiEntityConfigChange`, `OverviewCompetitorsResponse`. `ai/competitors` has `include` of `lost_prompts` and `top_sources` only. There is no `include=entities` on it (that is the summary's) | `lib/api/schema.ts` lines 1151, 2017, 3031 to 3330, 7127 | No `pnpm gen:api`. The by topic table reads the summary (`rows=topics`, `include=entities`); the brief's "consumes `include=entities`" means that read |
| F6 | `InspectorType` already lists `competitor` and `candidate`; there is no `entity`. `WIDE_TYPES` (440 px) does not hold `competitor`, so the inspector is 400 px | `lib/inspector/placement.ts` | The inspector is `inspect=competitor:<entity_id>`, not `entity:<id>` as overview-and-charts W-6 says (doc is stale). No lease |
| F7 | "Add competitor" is built: `EntityDialog` in `features/entities/entity-dialog.tsx` (domain, name, track SEO or AI, aliases, the SOV effect banner `entitySettings.dialog.sov`, the count "n of 10 competitors tracked in SEO", success toast). It is not exported from the feature's `index.ts`. It needs `entities` (the project's `ProjectEntity` list), `scope`, `workspaceSlug`, `projectSlug`, and `canWriteEntities(membership)` gates it in Settings | `features/entities/` | No new dialog. A feature may not import another feature, but a route may: the route folder composes it and passes it in as a slot (precedent: `ai/ai-setup-slot.tsx` passes the onboarding checklist to the Overview) |
| F8 | `MetricSwitcher` (DS 25 section 9.8) is not built: no `components/app/metric/metric-switcher.tsx`. The prompts feature has its own `MetricSelect` over `Select` | `components/app/metric/`, `features/prompts/topics-by-engine/metric-select.tsx` | A `Select` of this feature (D-6). Only Mention and Share of voice exist per entity: `EntityCells` has `mentioned` and `share_of_voice`, nothing for citation or recommendation |
| F9 | Import boundary: a feature imports `lib`, `components`, `providers`, itself and `@/features/layouts` only. WP-35's reads and models (`features/ai-overview/cards/competitors/`), WP-20's leaders (`features/prompts/topics-by-engine/leaders.ts`), the Overview scope model and the citations scope hook are all other features | `eslint.config.mjs` policy 3 | This package writes its own small copies (scope parse, `Read`, tracked set, leader), as `features/citations` did. `lib/stats`, `lib/compare/change-model` (`rateChange`, `deltaInput`), `lib/rates/rate-model`, `lib/charts/*`, `lib/format` are shared and are reused. Follow-up F-1: lift the three copies into `lib` |
| F10 | The Overview cards of WP-35 already link to this page through `drillHref('competitors', ...)` (`share-of-voice-card`, `lost-to-card`, `co-mentions-card`, `competitor-table-card`); the link is `null` while `competitors` is planned. The keys it writes are `win`, `from`, `to`, `cmp`, `country`, `engine` (comma list), `topic`, `branded` | `ai-overview/drilldown/drill-links.ts`, `drill-links.test.ts` line 165 to 171 | The page must read exactly those keys (D-2), and flipping the entry live changes the Overview: its tests that pin "plain text where the drill seam has no page" may fail. Lease L5 and L6 |
| F11 | `DataTableColumn.header` and `PlainColumn.header` are `string`: no node, so no `EntitySwatch` in a column header. `PlainTable` has no group row or column span | `components/app/data-table/types.ts`, `table/plain-table.tsx` | The channel summary is a table of this feature (own markup, same classes as `PlainTable`); the by topic table is a `DataTable` with plain headers and a chip bar that carries the swatches (D-17) |
| F12 | `features/competitors/candidates/` is owned by WP-56 (step 4, WB-CMP-09). `GET {P}/entity-candidates` is not built (BE-COMPETITORS-06) | WP-56 brief, backend inventory | A seam: the Candidates tab is a file of this package that WP-56 replaces (D-15). No count is read, so none is shown |
| F13 | The mock summary always answers `entity_config_versions: [1]` and never `entity_config_changes`. Entity role changes live in a cookie (`mocks/entities-state.ts`, `entityConfigVersion`) and a role has `added_at` (`stateTime()` for a new one; the Fynix fixtures share one fixture day) | `mocks/handlers/prompt-answers.ts` line 882, `mocks/entity-fixtures.ts` | My mock derives `entity_config_changes` itself (D-16), so a boundary appears after "Add competitor" in the e2e |
| F14 | The summary mock supports `rows=topics`, `rows=none`, `include=entities,series,total,co_mentions`, `filter[engine_code_in]`, `include_branded`, `branded_only`, `filter[country_iso]`, `filter[term]` and `compare` windows (WP-12, WP-20, WP-35 T1). It does not support `filter[opportunity]` or `filter[outcome]` | `mocks/handlers/prompt-answers.ts` | `ai/competitors` and the series route are built over the summary mock by an in-process read (D-16), as the real routes are built over the summary (c5: "every number comes from the prompts summary") |
| F15 | The ProjectEntity read carries `added_at`, `color_index`, `domains[]`, `role`, `track_ai`, `removed_at`. `EntityRef` (rows of `ai/competitors`) carries `color_index` and `role` but no date or domain | `schema.ts` `ProjectEntity`, `EntityRef` | Colours come from `ai/competitors`; dates and the domain come from `GET {P}/entities`, read only where shown (AI tab, inspector) |
| F16 | Stored views are WP-49's. `SavedViewMenu` and `useSavedView` take presets and the keys a view governs; the Citations page is the working template (header, `InspectorLayout`, `TopBarPortal` with `DateRangePicker` and `CountryScopeControl`, `FilterBar`, `Tabs`) | `components/app/views/*`, `features/citations/citations-screen.tsx` | Presets only (D-23) |
| F17 | The statistics for a gap exist: `rateChange(now, before, metric)` in `lib/compare/change-model.ts` gives the points and `detectable` (interim unpaired Newcombe on the pooled answers; always `null` for share of voice), and `deltaInput(change)` feeds `Delta`/`DeltaCell`; `differenceInterval` in `lib/stats` gives the interval. The paired test (A14) needs `ai/stats/compare`, which is not built (WP-58) | `lib/compare/change-model.ts`, `lib/stats/change.ts` | Gap vs leader and the inspector gap use them with `test="interim"` (D-7, D-14) |
| F18 | `Inspector` takes `header`, `navigation`, `onStep` (J and K through `useShortcut`), `tabs`; `useInspector({ entryKeys })` drops entry keys when the record changes or closes; the Citations `CitationInspectorHost` is the template | `components/app/inspector/*`, `features/citations/domain-inspector/` | The inspector is built as a host in this feature (T7) |
| F19 | Tests helpers: `renderWithProviders` (`src/test/render.tsx`), `next-navigation` mock, `msw.ts`, `api-server.ts`, `axe.ts`, `citations-lists-harness.tsx` as an example of a page harness. e2e: `e2e/support.ts` is frozen; `e2e/support/layouts.ts` exports `EDITOR`, `THEMES`, `WIDTHS`, `expectNoSeriousViolations` | `src/test`, `e2e/` | A support file of my own: `e2e/support/ai-competitors.ts` |

## 2. Rules in force for every implementer (copy into every task prompt)

- One fresh subagent per task: Sonnet or Haiku only, never Opus. At most TWO subagents of this session run at once; the second is a read-only reviewer where possible (a reviewer counts as one of the two).
- Tests first, and a real red run before any code: the implementer pastes the failing run in the report. Then code, green, then checks, then ONE commit `WP-39: <task title>` made with explicit paths (`git commit -m "..." -- <paths>`), naming only this package's files. No attribution lines. Never stage another session's files.
- Edit files with the file tools only (Read, Edit, Write). No shell heredocs, `sed`, `perl` or replace scripts. Delete a generated `apps/web/AGENTS.md` or `apps/web/CLAUDE.md` if a tool makes one (`git status` must show neither).
- UI work (T2 to T7): invoke `Skill(skill="design-taste-frontend")` before writing markup. The project design system and the approved preview OUTRANK it: no new visual language, no new font, radius or colour. There is no approved preview screen for this page (the preview has only the nav entry), so DS 24 section 9.8, DS 23 sections 4.2 and 6.1 and the Citations page are the look. Tokens and `type-*` utilities only (no raw colours, no arbitrary values, spacing steps 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 only); every number and date through `@/lib/format` (no `Intl`, `toFixed`, `toLocaleString` in components).
- Product rules: every percent shows its count ("k of n"); unknown is never zero (`EMPTY_VALUE` or a reason); colour only for a detectable change; engines are never pooled silently (the only average anywhere is a labelled one); no `any`; explicit return types; specific errors.
- Words: every visible string is a key under `competitors` in `apps/web/messages/en.json` (section 3.20), read through next-intl; ICU for plurals; never build a sentence by joining parts in code. ASCII only. NO em dash and NO en dash anywhere (code, comments, tests, copy, commit messages); ranges say "to". "cannot" in full, no straight double quotes inside a message, no exclamation mark. `grep -nP '[^\x00-\x7F]'` on the task's files prints nothing, except a typographic minus a file reads from `@/lib/format`.
- No dev server unless a browser check needs it: port 3216 only, `NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p 3216`, started per section 8. The built-in browser pane cannot register the MSW worker: use headless Playwright (the e2e suite) and save screenshots to the scratchpad directory. Never kill a process on another port.
- Checks, from `apps/web` unless said (replace `<files>`):
  - FILE (no lock): `pnpm exec vitest run <test file>`; `pnpm exec eslint --max-warnings 0 <files>`; `pnpm exec prettier --check <files>`.
  - TYPES (medium): `infra/dev/heavy --lane medium --label wp39-tN-types -- bash -c 'cd apps/web && pnpm typecheck'`.
  - TARGET (medium): `infra/dev/heavy --lane medium --label wp39-tN-test -- bash -c 'cd apps/web && pnpm exec vitest run <paths> --maxWorkers=2'`.
  - MESSAGES (any task that edits `en.json`): FILE on `src/i18n/messages.test.ts`.
  - LINT of the whole app (medium; the coordinator requires it before every push): `infra/dev/heavy --lane medium --label wp39-tN-lint -- bash -c 'cd apps/web && pnpm lint && pnpm format:check'`.
  - FULL (T8 only): `pnpm test`, `pnpm build` and `pnpm e2e` through `infra/dev/heavy --label wp39-<what> --wait 120 --max 60 -- bash -c '...'`, only when `/tmp/idraft-health/pause` does not exist and memory free is at least 40 percent (read `/tmp/idraft-health/state` and `heavy --status` first). The test run uses `--maxWorkers=3`.
- Backup push after each reviewed task: `git push origin ai/wp-39-competitors-page` (the branch only; deleted after the final merge). NO push to `develop` before T8 (the page is not whole before it). Every push to `develop` is `git fetch origin && git rebase origin/develop` then `git push origin HEAD:develop`. Never push `main`, never run `infra/ship.sh`, never deploy.
- After every task a fresh Sonnet reviewer reads the task, this plan and the diff, runs the task's FILE and TARGET commands, does each "break on purpose" mutation (sees the named test fail, reverts it), checks these rules and the row list, and returns PASS or a numbered fix list. The implementer fixes; the reviewer checks again.

## 3. Decisions settled (the owner may overrule; the default and its reason are in the row)

### 3.1 Route and file layout (D-1)

`apps/web/src/app/[workspace]/[project]/competitors/page.tsx` replaces the stub (server component, same shape as `ai/citations/page.tsx`: `requireMembership`, `projectsOfMembership`, `notFound`, `generateMetadata` from `competitors.title`) and renders `<CompetitorsScreen ... addCompetitorSlot={...} />`. The route folder also holds `add-competitor-slot.tsx` (client, T2). The feature:

```text
features/competitors/
  index.ts                         CompetitorsScreen, props type
  competitors-screen.tsx           access check, engines read, scope, header, tabs, inspector host (T2, T7)
  competitors-states.tsx           NoAccess, LoadFailed, NoEngine, NoCompetitor (T2)
  header/competitors-header.tsx    title, meta line, Saved view, Add competitor, More (T2)
  scope/                           scope-model.ts, use-competitors-scope.ts, competitors-views.ts, filter-fields.ts,
                                   prompt-countries.ts, compare-select.tsx (T2)
  data/                            read-state.ts, competitors-queries.ts, use-competitors-reads.ts (T2)
  tabs/                            competitor-tabs.ts (the tab list and the Candidates seam), candidates-tab.tsx (T2)
  seo/seo-tab.tsx                  the honest not built state (T2)
  model/                           pure, no React, a test beside each (T3 to T7)
    types.ts, competitors-fixtures.ts (typed builders, tests only), entity-order.ts, channel-summary.ts,
    top-competitor.ts, named-in.ts, tracked-set-note.ts (T3); topic-gap.ts, topic-rows.ts (T4); lost-prompts.ts (T5);
    sov-series.ts, boundaries.ts (T6); entity-compare.ts (T7)
  comparison/                      comparison-tab.tsx, channel-summary-table.tsx, figure-cell.tsx, entity-chips.tsx,
                                   top-competitor-strip.tsx, tracked-note.tsx (T3); topic-comparison-table.tsx,
                                   topic-columns.tsx, metric-switch.tsx, engine-switch.tsx, topic-phone-list.tsx (T4);
                                   lost-prompts-section.tsx, lost-prompt-columns.tsx, lost-phone-list.tsx (T5)
  ai/                              ai-tab.tsx, engine-sov-chart.tsx, chart-option.ts (T6)
  inspector/                       inspector-host.tsx, competitor-inspector.tsx, side-by-side.tsx, sources-tab.tsx,
                                   use-inspector-reads.ts (T7)
  links.ts                         the hrefs to the Prompts page (topic, prompt) and the inspector (T4)
```

`features/competitors/candidates/` is WP-56's and is not created here.

### 3.2 Tabs and URL state (D-2)

All state is in the address, read with nuqs through pure parsers that never throw (a value that does not read falls back to the default and writes nothing). Keys that already exist on other pages are marked.

| Key | Values | Exists elsewhere | Notes |
|---|---|---|---|
| `tab` | absent (Comparison), `seo`, `ai`, `candidates` | `tab` on Citations and Prompts | Changing it pushes a history entry; `cols`, `q`, `sort` are cleared with it |
| `win`, `from`, `to` | the date range picker's | all AI pages | `useDateRangeParams`, max 92 days (the API limit), in the top bar |
| `cmp` | absent (on) or `off` | Overview, Citations | `parseCompare`, `cmpParam` of `lib/compare` |
| `country` | two capitals | Overview, Citations, Prompts | `CountryScopeControl` in the top bar; scope, not a view key |
| `engine` | comma list of engine codes, at most 3 | Overview, Prompts, Citations | The engines IN SCOPE: the channel summary, the top competitor strip and the AI tab show each. Absent is every enabled engine. The Overview cards write one code here |
| `eng` | one engine code | topic drawer (entry key), Overview W-6 link `/competitors?tab=ai&eng=X` | The ONE engine of the single engine surfaces (by topic table, prompts we lose). Not in scope falls back to the first engine in scope, in the fixed engine order |
| `metric` | absent (Mention), `sov` | Prompts (also `citation`) | By topic metric. `citation` or anything else reads as Mention |
| `topic` | a term id (UUID) | Overview, Citations | `filter[term]`: the topic and the topics below it |
| `branded` | `include`, `included`, `only`, absent | Overview, Prompts, Citations | `include` and `included` count branded prompts; `only` counts them alone; absent leaves them out |
| `lost` | an entity id | new | The competitor the "Prompts we lose" section shows; absent is the top competitor of `eng` |
| `sort`, `cols`, `density`, `q` | the table state of `lib/tables/table-state` | Prompts, Citations | The by topic table's; sort ids `topic`, `gap`, `e-<entity_id>` |
| `view` | a saved view id | all | `useSavedView` |
| `inspect`, `itab` | `competitor:<entity_id>`, `overview` (absent) or `sources` | all | The inspector. Entry keys of the inspector: none (no key belongs to one record) |

The view keys (governed by a saved view, never `inspect`, `itab`, the range or `country`): `tab`, `engine`, `eng`, `metric`, `topic`, `branded`, `cmp`, `lost`, `sort`, `cols`, `density`, `q`. The inbound links of the Overview are tested against the page's own parsers (T2: `scope/inbound-links.test.ts`, feeding every `drillHref('competitors', ...)` to `parseScope`).

### 3.3 Requests: which routes each tab reads (D-4)

One shared shape set, built in `data/competitors-queries.ts` with `apiQuery` and the generated types. `S` is the scope: `from`, `to`, `filter[engine_code_in]` (omitted when the scope is every engine; the API then takes every enabled or answering engine), `include_branded` and `branded_only` from `branded`, `filter[country_iso]`, `filter[term]`. Every read is `useQuery({ ...query, placeholderData: keepPreviousData })`, wrapped by `useRead` (status `idle`, `loading`, `ready`, `refetching`, `error`, `stale`), and its key sits under the project's `ai` prefix so a refresh of the entities reaches it. Reads wait for the engines read (nothing is asked with an unknown engine list).

| Read | Route and parameters | Feeds | Enabled when | Cost (c5, c8, c2 C-15) |
|---|---|---|---|---|
| Engines | `GET {P}/engines` | engine names, fixed order, "none on" state | always | cached across pages |
| R1 competitors | `GET {P}/ai/competitors` with `S` and `compare=previous_period` unless `cmp=off`; no `include`, no `entity_ids` | channel summary, top competitor, named in, chips, header count, inspector side by side, AI tab entity list | tab Comparison or AI, or the inspector is open | summary + 5 statements, +2 with compare; a few KB |
| R2 lost | `GET {P}/ai/competitors` with `S`, `filter[engine_code_in]=<eng>` (always the one engine), `include=lost_prompts`, `lost_limit=10`, no compare | the "Prompts we lose" section | tab Comparison, and `eng` is known | +1 statement; the lost lists of every competitor for one engine |
| R3 topic rows | `GET {P}/ai/prompts-summary` with `S` but `filter[engine_code_in]=<eng>`, `rows=topics`, `include=entities,total`, no compare | the by topic table, the leader per topic, the header freshness (`total.last_observed_at`) | tab Comparison, and `eng` is known | 12 to 16 KB (C-15); never the prompt rows |
| R4 series | `GET {P}/ai/metrics/ai.share_of_voice/series` with `S` (engines in scope), `entity_ids=<every tracked entity of R1, at most 20>` | the AI tab charts | tab AI, after R1 | summary + 2 statements |
| R5 entities | `GET {P}/entities` (generated `ProjectEntity` list) | added dates for boundary labels and the footnote, the domain and added date in the inspector header | tab AI, or the inspector is open | cached with Settings > Entities |
| R6 sources | `GET {P}/ai/competitors` with `S`, `entity_ids=<this entity>,<the own entities>`, `include=top_sources`, `sources_limit=5`, no compare | the inspector's Sources tab | `itab=sources` only | +1 statement |

Why: `lost_prompts` and `top_sources` cost statements, so each runs only where its surface is open. The AI tab asks for the series of every tracked entity at once (one request, at most 20 ids) and each chart draws the own brand and that engine's top 3 competitors; the legend turns the others on. The tabs with no read: SEO, Candidates. The inspector reuses R1 (same key, so no request when the page already holds it). Nothing here calls `overview/competitors` (it serves the project Overview, WP-40), and nothing calls `ai/stats/compare` (not built).

### 3.4 Header and Add competitor (D-5)

`PageHeader`: title "Competitors"; meta line "AI updated {relative time} on {engines}, {n} tracked competitors" (the time from `R3.total.last_observed_at`, "n" from `R1.meta.entities`; there is no "SEO updated" part because no SEO read exists, and the meta line says nothing about it); actions: `SavedViewMenu` (presets), the primary "Add competitor" button (only with `canWriteEntities(useMembership())`, else absent), a More menu with "Copy link". Add competitor opens the existing `EntityDialog` with role `competitor` (its 560 px size is DS 16's; if the dialog is another width that is a follow-up in `features/entities`, not here). Wiring: the route passes `addCompetitorSlot: (control: { open: boolean; onClose: () => void }) => ReactNode`; `route/add-competitor-slot.tsx` reads `projectEntitiesQuery` (its `entities` prop) and renders `<EntityDialog scope role={open ? 'competitor' : null} entities workspaceSlug projectSlug onClose />`. On close the screen invalidates its `ai`-prefixed reads (the tracked set and share of voice changed from today) and the dialog's own toast says so. The dialog already carries the SOV effect note (`entitySettings.dialog.sov`). Candidates "Track" is WP-56's.

### 3.5 The Comparison tab layout (D-8)

Top to bottom, inside one scrolling page (`PAGE_CLASS`, not the table filling layout of Citations, because the tab stacks four sections):

1. Filter row: `FilterBar` (Engine multi, Topic, Branded; ids are the URL keys) and "Compare with" (`cmp`), as on Citations. A `RefetchBar` under it while any of R1 to R3 refetches with data kept.
2. Competitor chips: one chip per tracked competitor (swatch from `color_index`, name, a button that opens the inspector).
3. Top competitor strip (WB-CMP-05): one card per engine in scope.
4. Channel summary (WB-CMP-03, 06).
5. By topic (WB-CMP-04).
6. Prompts we lose (WB-CMP-07).
7. A tracked set note under each SOV bearing section (WB-CMP-10 text part, R9): "Tracked brands: you and 5 competitors. Added: Zoho on Nov 4." and the changed set sentence when `entity_config_versions` has more than one entry.

### 3.6 Channel summary (D-8, WB-CMP-03, WB-CMP-06)

An own table markup (F11), `th scope="col"` per entity with its `EntitySwatch`, own brand first with `chart-1`, then the competitors in the order the API gives (by name), a caption for assistive technology, inside a region that scrolls sideways with a scroll hint when it does not fit. Entity header names that are competitors are buttons that open the inspector.

Rows are grouped by a group row (a full width `th scope="rowgroup"` row, `type-micro`). For each engine in scope, in the fixed engine order, a group "ChatGPT" holds four rows: Share of voice, Mention rate, Recommendation rate, Citation share. Cells (one `FigureCell` component):

| Row | Value | Second line (the count) | Change (cmp on) |
|---|---|---|---|
| Share of voice | `share_of_voice.value` as a percent | "of 1,412 answers naming a tracked brand" (its `denominator`) on the own column; on the others the same denominator is in the cell tooltip (a share has no count of successes) | `Delta` from `previous`, never coloured (no test for a share, rule R5) |
| Mention rate | `mention_rate.value` | "Named in 35 of 192 answers, 24 prompts" from `pooled.successes`, `pooled.trials` and `n_prompts` (WB-CMP-06). The headline is the prompt weighted value and is not `k / n` (c8 C-19): both are shown as the contract says | `Delta` via `rateChange` from `previous`, coloured only when `detectable` is true |
| Recommendation rate | the words "Not classified" with the reason in a tooltip (`suppressed_reason` `not_classified`) | none | none |
| Citation share | percent of `citation_share.value` | "6 of 24 citation units" | none (the contract has no `previous` there) |

Unknown states: `value` null with a zero denominator is `n/a` plus the reason "No answers on ChatGPT in this window" in the tooltip, never 0; fewer than 4 valid answers (`pooled.trials` for mention, `denominator` for share of voice and citation units) is the `InsufficientPill` and the count. After the engine groups comes one group "SEO" with ONE row "Share of voice, visibility and average rank" whose cell in every entity column is the words "Not available" (muted, `Tooltip` "Search share of voice needs keyword volumes and a click-through model. Neither is measured yet."), never a number or 0. Header tooltip of the table: "Each cell is one engine. Engines are not averaged here."

### 3.7 Top competitor (D-9, WB-CMP-05)

Per engine in scope one card (`MetricStrip` look, `type-metric-sm`): label "Top competitor on ChatGPT", value the name of the competitor whose `by_engine[engine].is_top_competitor` is true (a button that opens the inspector), context "33% share of voice, named in 466 of 1,800 answers. You: 27%". The server owns the rule (most share of voice numerator among tracked competitors; ties to the larger mention numerator, then name, then id; never the own brand; none when nobody was named). The client never recomputes it. It adds only: when another competitor's `share_of_voice.value` equals the top one at 9 decimals, the card says "Tied on share of voice with Zoho; the one named in more answers is shown." When no row of that engine has the flag and the engine has answers: "No competitor is named on ChatGPT" (a real zero over a known total). When the engine has no answer in scope: "No answers on ChatGPT" with the window. Different engines may have different top competitors; there is no overall top competitor.

### 3.8 Metric switcher and engine control (D-6)

`metric-switch.tsx`: a `Select` (size `sm`, `aria-label` "Metric") with two options, Mention rate and Share of voice (group "AI"; no SEO group, no Citation, no Recommendation: the entity cells carry none). `engine-switch.tsx`: a `SegmentedControl` of the engines in scope (writes `eng`), shown in the By topic and Prompts we lose headers; with one engine in scope it is a label.

### 3.9 By topic comparison and Gap vs leader (D-7, WB-CMP-04)

A `DataTable` (caption "Topics by brand", item noun topic, `density`, `cols`, `q`, `sort` in the address, client side: all rows come in one 12 to 16 KB read). Rows: the topic rows of R3, the prompts with no topic as the last row "No topic" when R3 has it; sorted by prompt count, most first, by default. Columns: Topic (identity, a real link to the topic drawer on the Prompts page, `links.ts`), then one column per tracked entity (own first, then competitors by name; by default the own brand and the five competitors with the most share of voice on `eng` are visible and the rest are in the column chooser, so the palette limit of six holds), then "Gap vs leader". Cell: `MetricCell` look: the chosen metric as a percent plus the count below it ("12 of 41 answers, 5 prompts" for mention; "of 88 answers naming a brand" for share of voice), `InsufficientPill` under 4 answers, `n/a` with no cell. The highest value in each row (over the visible AND the hidden entities, those with a rate) is `type-body-strong`, no colour; header tooltip: "Highest value in the row. Differences can be within normal variation."

The leader of a row: the entity (own included) with the highest value among those that have a rate (4 or more valid answers, a value); ties go to the own brand, then to the API order. Gap vs leader: own value minus leader value, in points, `<= 0`; "0 pts" when the own brand is the leader (the DS wording), `n/a` when the own brand has no rate or no competitor has one. Colour: `rateChange(ownReading, leaderReading, 'mentioned')` gives `detectable` from the interim unpaired test on the two pooled answer counts; the gap is coloured (negative) only when `detectable` is true; neutral when false or null; ALWAYS neutral for share of voice (no counts, `shareNoTest`). The `Delta` carries `test="interim"` and its tooltip ("larger than normal variation, unpaired test on pooled answers" or "within normal variation") and the leader's name and rate ("HubSpot 58%, 124 of 214 answers"). Sort by any entity column or by gap (null last in both directions).

Footnote: "A prompt in two topics counts in both. Topic rows do not add up to the project." Below 768 px the table is a `DataTableList` (T4): line 1 the topic and the own value, line 2 "Leader HubSpot 58%, gap 10.9 pts" with the counts; each row a real link.

### 3.10 Named in (D-10, WB-CMP-06)

It is the second line of every Mention rate cell of the channel summary (3.6) and of the by topic cells (3.9): "Named in 35 of 192 answers" = `mention_rate.pooled.successes` of `pooled.trials`. A cell whose `pooled` is absent (the engine had no answer) is `n/a`, never "0 of 0". The own brand and every competitor get it; there is no separate surface.

### 3.11 Prompts we lose (D-11, WB-CMP-07)

A section "Prompts we lose" for the engine `eng`: a `Select` of the tracked competitors (`lost`, default the top competitor of `eng`, else the first competitor with a lost list) and the sentence "HubSpot is named, and you are not, in 4 of the 12 prompts with 4 or more answers on ChatGPT" built from `lost_prompts_clear_total` (the 4) over `lost_prompts_with_min_answers` (the 12), nothing else. `lost_prompts_total` is the per-answer rule and is NEVER the numerator; a response with a clear total larger than the judged count shows `n/a`, never "4 of 3". The list is `lost_prompts` (at most 10 per entity and engine, already sorted by importance, then lost answers, then text, then id): columns Importance (1 to 5, a chip with a word, not a colour), Prompt (a link to the prompt inspector on the Prompts page), "Lost answers" ("2 of 3 answers" = `lost.numerator` of `lost.denominator`, a count not a percent). The table is client sorted by importance, most first; when `lost_prompts_total` is larger than the rows the note says "The 10 most important of 14 prompts are listed." States: loading skeleton; no competitor tracked (reason and a link to Settings > Entities); the engine has fewer than 4 valid answers on every prompt (`lost_prompts_with_min_answers` 0: "No prompt has 4 or more answers on ChatGPT yet"); a real zero ("HubSpot is not named without you in any prompt on ChatGPT": clear total 0 of a known count); error with Retry (the rest of the tab stays). Below 768 px a `DataTableList`.

### 3.12 SOV trends and boundaries (D-12, D-13, WB-CMP-10, WB-CMP-11)

AI tab: one `ChartFrame kind="line"` per engine in scope (two columns from 1024 px, one below), title "Share of voice on ChatGPT, weekly", from R4. Series: the own brand (role `brand`, `chart-1`) and the top 3 competitors by window share of voice on that engine (the order of R1's `share_of_voice.value`; a competitor with value 0 or null is never top), role `palette` by `color_index` (2 to 6; with none, the next free slot in name order); every other tracked entity is in the legend, off; entities beyond the palette are listed in the footnote ("2 tracked brands are not drawn"). Points: `value` of each week, a week with fewer than 4 answers naming a tracked brand (`denominator < 4`) is a hollow point with no percent (`smallSamplePoint`) and the words "too few answers"; a week with no answer is a gap, never 0. Tooltip row per entity: "27%, of 412 answers naming a tracked brand" sorted by value; the Table view prints the same per week. All charts share one y ceiling (the next tenth over the highest drawn value, at most 100 percent).

Pooling (C-18, F-14): a point with `is_pooled` is drawn at its week and worded as pooled: the tooltip title says "4 weeks to Nov 9" from `pool.weeks` and `pool.window.to`, the Table view cell ends "(4 weeks together)", and the chart footnote carries the sentence "A weekly point with fewer than 10 prompts answering that week shows the last 4 weeks together, clipped to the window." whenever any drawn point is pooled. A pooled point is never drawn as a plain weekly one.

Boundaries (R9, C-21, C-25): from `meta.entity_config_changes` of R4 (absent means one version, nothing is drawn). For every change after the first whose `from` day is inside the window, a dashed `boundaryMarkLines` line at the category of the Monday of the week that holds `from`; the label is "{name} added" when `GET {P}/entities` has one competitor whose `added_at` day equals `from` (the names joined when several), else "Tracked set changed". The chart footnote says what `from` is: "The first day answers were counted under the new set of tracked brands. It can be later than the day the set was edited." The first change (version 1, whose `from` can precede the window) draws no line. A change whose week is not a category of the chart is dropped (the helper does it). The footnote on every SOV section names the set: "Tracked brands: you and 5 competitors. Added: Zoho on Nov 4." (dates from R5, only those inside the window; without R5 the sentence says the set changed and lists no date, it never invents one).

### 3.13 The competitor inspector (D-14, WB-CMP-12)

`inspect=competitor:<entity_id>` opens a standard `Inspector` (400 px, J and K through the Inspector's own `useShortcut` in the order of the tracked competitors, "2 of 5", Escape closes and focus returns to the opener) mounted by `InspectorLayout` in the screen, like Citations. Header: the competitor's name, badges "Competitor" and "Tracked since Nov 4" (R5 `added_at`), the primary domain from R5 `domains`, meta "n of 5", More menu: Copy link, "Open in Entities" (Settings > Entities). Strip (3 cards, `MetricStrip`): Share of voice and Mention rate on the engine of `eng`, each "them" with "you" in the context line and the counts; a third card "Gap, mention rate" from `rateChange(you, them)`. Tabs: Overview, Sources (DS 4.2 also lists Keywords, which is SEO and not built, so it is not offered and the plan does not draw a disabled tab). Overview: "Side by side" section, one block per engine in scope, rows Share of voice, Mention rate, Citation share, Recommendation rate (columns: Metric, {name}, You, Gap): the gap of mention rate is points with its 95 percent interval (`differenceInterval` on the pooled answers, "about -6 pts, 95% interval -12 to 0") and the interim label "unpaired test on pooled answers"; the gap of share of voice has no interval and says "No test for a share of voice" (never coloured); citation share and recommendation rows show their values or "Not classified" with no gap. Sources: `top_sources` of R6 (at most 5 domains: domain, citation units, answers), the note "Domains cited with this brand as the role; the domains cited in answers that name it are not listed yet" (c5 C-18), and an empty state when `top_sources` is `[]`. States: loading skeleton per section; an `inspect` id that is not a tracked entity of R1 (removed, watched, or another project) is the "Not a tracked competitor" empty state with a link to Settings > Entities, never a crash and never a number; R1 failed is an inline error with Retry; a competitor with no answer on an engine has `n/a` cells and says why.

### 3.14 SEO tab (D-8)

No read. An `EmptyState` (heading level 2): title "Search competitors are not measured yet", reason "Search share of voice needs keyword volumes and a click-through model, and no read of competitor rankings exists yet. The channel summary shows these figures as not available instead of guessing.", action "Open Rankings" (link to `/seo/keywords`) and a second line "Add the keywords you want to track there: they are what search competitor figures will be counted over." Never a number.

### 3.15 Candidates tab (D-15)

`tabs/candidates-tab.tsx` exports `CandidatesTabPanel` and `useCandidatesCount()` (returns `null` now). The tab label shows no count while the count is `null` (unknown is never 0). The panel is an `EmptyState`: title "Candidate brands are not listed yet", reason "Brands that answers name and you do not track will be listed here with a Track action once brand discovery is built." WP-56 replaces these two exports with its `features/competitors/candidates/` implementation by editing only this file (a single line change of the import). The tab list in `tabs/competitor-tabs.ts` is the seam.

### 3.16 Mocks (D-16)

My module `apps/web/src/mocks/handlers/competitors.ts` (already registered; its slot in `registered.test.ts` is removed, L4). It answers `GET {P}/ai/competitors`, `GET {P}/overview/competitors` and `GET {P}/ai/metrics/{metric}/series`. Each reads the SUMMARY mock in process (an internal `fetch` of `GET {P}/ai/prompts-summary` for the same scope with the cookie of the request, `include=total,entities` plus `series` for the series route, prompt rows left out except for the lost prompts) and maps it with pure functions in `mocks/competitors-model.ts`, as the real routes do (c5), so every figure equals the summary's (R12). A first step of T1 is a spike test that the nested read works in the node server and in the browser worker; if it does not, lease L7 (an export of the summary builder from `prompt-answers.ts`) is used instead. The series handler answers only `ai.share_of_voice` and `ai.mention_rate` with `entity_ids`; for any other metric or without `entity_ids` it returns nothing, so the next handler (a later package's) answers. Lost prompts are computed from the fixture answers (`answersOf` and `entityCountsOf`, both exported) per competitor, prompt and engine, with a `shortcut:` comment naming the difference from the server (the fixtures have the per answer mentions, the server reads its fact tables). `meta.entity_config_changes`: one change per tracked competitor role whose `added_at` project day is after the fixture day, version 1 first (its `from` is the first answer day), so a competitor added by the Add dialog produces a boundary. Validation mirrors c5: unknown parameter `422 extra_forbidden`, `entity_ids` over 20, `lost_limit` outside 1 to 10, `sources_limit` outside 1 to 5, `include=bogus`, an engine code outside the three, `from` after `to`, windows over 92 days.

### 3.17 Colours and entities (D-17)

Colour roles by `EntityRef.color_index` (own `chart-1`, competitors 2 to 6, none gets the next free slot in name order, past six the dashed `chart-other` square of `EntitySwatch`). The swatch appears in the channel summary headers, the chips, the strip and the chart legend; DataTable headers cannot hold one (F11), so the chip bar above the table is the colour key. Follow-up F-2 (not requested): `DataTableColumn.header` accepting a leading node.

### 3.18 States for every surface (D-18)

| Surface | Loading | Empty (reason, action) | Error | Partial | Stale |
|---|---|---|---|---|---|
| Page (engines) | skeleton of the header, tabs and sections | none on: `NoEngine` (turn on an engine in Settings > Engines for an editor; ask an admin otherwise) | engines failed: `LoadFailed` with Retry (never an empty list: it would read as every engine) | none | none |
| Chips, strip, channel summary | skeleton at the final height | no competitor tracked: "No competitor is tracked" and "Add competitor" (if allowed, else the admin sentence) | R1 failed: inline error with Retry and the error id; the header, tabs and the other sections stay | an engine with no answer: its column cells `n/a` and its group row says "No answers in this window" | a later read failed with data kept: notice "These are the last figures read" and the data |
| By topic | table `loading` | no topic rows: "No prompt is in this scope" (links to the Prompts page); filter empty: `filteredEmptyState` | R3 failed: the table error state with Retry | entity cells missing (read without them): entity columns `n/a`, gap `n/a` | as above |
| Prompts we lose | skeleton rows | see 3.11 | own Retry | `eng` has no answers: "No answers on ChatGPT" | as above |
| AI tab | frame skeleton at 280 px | one tracked brand only: "No competitor is tracked"; fewer than two weeks: "A trend needs two weeks of answers" | R4 failed: frame error with Retry | an engine with no point: its frame `empty` with the reason | as above |
| SEO, Candidates | none | the not built states | none | none | none |
| Inspector | per section | not a tracked competitor | inline error with Retry | engine with no answer: `n/a` | as above |

A scope change keeps the previous data and shows the `RefetchBar` (`under-filter-bar` for the page reads, `under-section-heading` per section); the region carries `aria-busy`. No full page spinner anywhere.

### 3.19 Accessibility, widths, themes, density (D-19)

Tabs are the `Tabs` underline variant (arrow keys, `aria-label` "Competitor views"); every table has a caption; J and K only inside the inspector through `useShortcut` (hints in the tooltips), nothing else binds a single key; focus goes back to the opener on close; chart summaries (`summary` prop) say in words what each chart shows; colour is never the only signal (the swatch sits beside a name; a coloured gap also says its words). Widths: 390 (header actions wrap, chips scroll, the channel summary scrolls in its region with the scroll hint, by topic and lost are lists, charts one column, the inspector is a sheet), 768 (tables, inspector overlays), 1024 (charts two columns, inspector docks when 720 px of main column remain), 1280. Light and dark by tokens only. Default and Compact density: the `density` key drives the by topic and lost tables; the custom channel summary uses the compact row height as `PlainTable` does (an embedded table). Reduced motion: the chart frame sets it.

### 3.20 Messages (D-20)

Namespace `competitors` (top level, pre-created, lease L3). Groups and keys (English drafts are written by the implementer of each task; ICU plurals; ASCII):

- T2: `title`, `meta`, `metaNone`, `metaStale`, `noAccessTitle`, `noAccessReason`, `noEngineTitle`, `noEngineReason`, `noEngineAction`, `noEngineAdmin`, `loadFailedTitle`, `loadFailedReason`, `moreActions`, `copyLink`, `linkCopied`, `tabs.{label,comparison,seo,ai,candidates}`, `views.{default,shareOfVoice,brandedIncluded}`, `filters.{engine,topic,branded,brandedInclude,droppedTitle,droppedDescription}`, `compare.{label,previous,off}`, `scope.{country,allCountries,search,countryEmpty,clear,open,note}`, `header.{addCompetitor}`, `seo.{title,reason,action,hint}`, `candidates.{title,reason}`, `states.{refetching,stale,retry}`.
- T3: `chips.{label,open}`, `top.{label,value,context,tied,none,noAnswers,unknownEngine}`, `summary.{title,caption,metric,shareOfVoice,mentionRate,recommendationRate,citationShare,group,seoGroup,seoRow,seoNotAvailable,notClassified,noAnswers,groupNoAnswers,namedIn,shareDenominator,citationUnits,headerTip,scrollHint}`, `trackedSet.{note,added,changed,changedNoDates}`, `empty.{noCompetitorTitle,noCompetitorReason,noCompetitorAction,noCompetitorAdmin}`.
- T4: `topics.{title,caption,metric,metricLabel,engine,engineLabel,topic,gap,gapTip,gapZero,leaderIs,leaderNone,highestTip,rowLink,noTopic,footnote,noRowsTitle,noRowsReason,filteredTitle,filteredReason,listLine,searchPlaceholder}`.
- T5: `lost.{title,summary,summaryNone,summaryZero,summaryFew,competitor,competitorLabel,importance,importanceWord,prompt,lostAnswers,lostAnswersCount,cap,openPrompt,noCompetitorTitle,noCompetitorReason,failedTitle}`.
- T6: `ai.{title,chartTitle,meta,summary,footnote,footnoteNotDrawn,tooFew,tooFewTip,weekColumn,cell,cellThin,cellPooled,pooledSentence,pointTitle,noSeriesTitle,noSeriesReason,oneBrandTitle,oneBrandReason,failedTitle}`, `boundary.{added,changed,tip}`.
- T7: `inspector.{title,position,badgeCompetitor,badgeSince,domain,more,openEntities,strip.shareOfVoice,strip.mentionRate,strip.gap,tabs.label,tabs.overview,tabs.sources,sideBySide,metric,them,you,gap,gapInterval,gapInterim,noTestShare,notClassified,sources.title,sources.note,sources.domain,sources.units,sources.answers,sources.none,notTrackedTitle,notTrackedReason,failedTitle}`.

`src/i18n/messages.test.ts` must pass after every edit (it checks ASCII and the dash rule). Each task edits only its own group with single line edits, so parallel tasks do not collide.

### 3.21 Navigation and cross effects (D-21)

Flipping `competitors` to `live` (one line, L1) puts it in the sidebar (section 2, below Sources), makes the Overview card rows links (F10) and makes the breadcrumb and the command palette find it. The registry test and the planned-routes test change in the same commit (L1, L2), and the Overview folder tests run once in T2 (L5, L6).

### 3.22 Saved views (D-23)

Presets only (`competitors-views.ts`, like `citation-views.ts`): Default, "Share of voice by topic" (`metric=sov`), "Branded prompts included" (`branded=include`). Stored views are WP-49's.

## 4. Files, ownership and LEASES TO ASK THE COORDINATOR FOR

Owned (the brief): `apps/web/src/features/competitors/` (new; except `candidates/`, WP-56), `apps/web/src/app/[workspace]/[project]/competitors/`, `apps/web/e2e/flows/ai-competitors.spec.ts`. Owned by being new or by the slot: `apps/web/e2e/support/ai-competitors.ts`, `apps/web/src/mocks/handlers/competitors.ts` (registered), `apps/web/src/mocks/competitors-model.ts` and the tests beside every new file.

### LEASES TO ASK THE COORDINATOR FOR

| # | Exact path | Owner now | Edit (smallest) | Why | Needed by |
|---|---|---|---|---|---|
| L1 | `apps/web/src/lib/navigation/registry.ts` line 163 and `apps/web/src/lib/navigation/registry.test.ts` line 174 | shell (WP-02) | In the `competitors` entry (lines 157 to 164) `status: 'planned'` becomes `status: 'live'`. In the test, remove the `'competitors',` line of the planned pin (line 174) | The brief allows flipping my own page. The pin test would fail otherwise | T2 |
| L2 | `apps/web/src/app/[workspace]/[project]/planned-routes.test.ts` line 24 | WP-02 | Remove the row `['/competitors', () => import('./competitors/page')]` | The route is a page now, not the 404 file | T2 |
| L3 | `apps/web/messages/en.json`, namespace `competitors` (line 6488, `"competitors": {}`) | shared file | Additive only: sub-objects under `competitors`, one group per task (3.20). No other namespace is edited | Every string of the package | T2 first, then each UI task |
| L4 | `apps/web/src/mocks/handlers/registered.test.ts` line 19 | WP-02 | Remove the row `['competitors', 'competitorHandlers', () => import('./competitors')],` (the module is not empty any more). Precedent: WP-30 removed its `ai-health` row | The test pins the module as `[]` | T1 |
| L5 | `apps/web/src/features/ai-overview/drilldown/drill-links.test.ts` lines 165 to 177 | WP-33 | `for (const kind of ['competitors', 'sources'] as const)` becomes `['sources']`; the line `expect(isLive('prompts') && isLive('citations') && isLive('runs')).toBe(true)` and the list under it gain `competitors`; add the comment line "competitors is live since WP-39" | The test says a competitors link is `null` | T2 |
| L6 | `apps/web/src/features/ai-overview/cards/competitors/*.test.tsx` (WP-35, merged), only the assertions that fail after the flip | WP-35 | Expected: tests that say "plain text where the drill seam has no page, which is the case for competitors today" (`lost-to-card.test.tsx` line 245, `share-of-voice-card.test.tsx` line 456, `competitor-table-card.test.tsx` line 507) stub the seam or the registry; T2 runs `src/features/ai-overview` in the medium lane and edits only what fails, each edit one assertion | The flip changes what the cards render | T2 |
| L7 (conditional) | `apps/web/src/mocks/handlers/prompt-answers.ts` and `apps/web/src/mocks/prompt-summary.ts` | WP-12, WP-20, WP-35 | Only if the nested read spike of T1 fails: `export` the function that builds the summary body for a request (a small extraction) | The in process read of 3.16 | T1 (decided by its spike) |

Not needed: `handlers/index.ts` (WP-02 registered `competitorHandlers`), `lib/api/schema.ts` and `backend/openapi/v1.json` (no API change), `lib/inspector/placement.ts` (`competitor` exists; the 400 px width is kept), `features/entities/index.ts` (the route imports `@/features/entities/entity-dialog` and `@/features/entities/entity-queries` by path), `components/app/data-table` (no prop change).

## 5. Tasks

Each task is one fresh Sonnet implementer (rules in section 2), then one fresh Sonnet reviewer. Commit `WP-39: <title>`; one commit per task. After the commit and a PASS: backup push of the branch. Paths below are from `apps/web/src` unless they start with `e2e/`, `messages/`, `app/` (which is `src/app`) or `docs/`.

### T1: mocks for ai/competitors, overview/competitors and the entity series

Rows: process (the mocks the brief asks for; unblocks T3 to T7). Needs lease L4 (and maybe L7).
Files new: `mocks/competitors-model.ts`, `mocks/competitors-model.test.ts`, `mocks/handlers/competitors.test.ts`. Modify: `mocks/handlers/competitors.ts` (the handlers), `mocks/handlers/registered.test.ts` (L4).
Step 0, a spike (a test file kept until the spike is answered, `competitors-spike.test.ts`, then deleted): the handler of `competitors.ts` reads `GET {P}/ai/prompts-summary?...` in process with `fetch` and the request's cookie in the node server (`src/test/api-server.ts`); in the browser worker the same call goes back to the worker (read the MSW docs in `node_modules/msw`; the worker runs resolvers on the page thread). If the spike fails, stop and ask for L7.

Tests first (`competitors-model.test.ts`, pure, typed fixtures of `PromptsSummary` built with the same builders the summary mock tests use; and `handlers/competitors.test.ts` with the MSW `server`, Fynix, Eventus after `setAiSeeded(true)`, Cleanstart with engines off):
- `ai/competitors: own entities first, then competitors by name, at most 20, and the engines sorted by code`
- `ai/competitors: every figure equals the summary total cell for the same scope` (mention value, pooled, share of voice numerator and denominator)
- `ai/competitors: share of voice numerators of the tracked set add up to the denominator of an engine with answers`
- `ai/competitors: is_top_competitor is true for at most one competitor per engine, by share of voice numerator, then mention numerator, then name, then id, and never for the own brand`
- `ai/competitors: no competitor named gives no top competitor`
- `ai/competitors: entity_ids narrows the rows, ignores an id that is not tracked with 200, and reads the top flag before the narrowing`
- `ai/competitors: compare=previous_period adds previous to mention_rate and share_of_voice and compare_window and previous_answers to meta; none without compare`
- `ai/competitors: recommendation_rate is suppressed not_classified for every entity, with no value, numerator or denominator`
- `ai/competitors: include=lost_prompts gives lost_prompts, lost_prompts_total, lost_prompts_with_min_answers and lost_prompts_clear_total on competitor rows only; clear never exceeds with_min_answers; the rows are sorted by importance, lost answers, text, id and cut at lost_limit`
- `ai/competitors: include=top_sources gives at most sources_limit domains by citation units, [] for an entity with none, own rows included`
- `ai/competitors: 422 for lost_limit 0 and 11, sources_limit 6, include=bogus, more than 20 entity_ids, an engine code outside the three, from after to, a window over 92 days, and any unknown parameter`
- `ai/competitors: meta.entity_config_changes is absent with one version and lists version and from after a competitor was added, and from is a project day`
- `overview/competitors: rows equal the ai/competitors values value for value and carry no seo member`
- `series: one series per engine and listed entity, points weekly oldest first on Mondays, share of voice points have no pooled and a denominator of answers naming a tracked brand, mention rate points have pooled`
- `series: a pooled point carries is_pooled and pool with weeks, window, reason and below_prompts`
- `series: without entity_ids, or for another metric, the handler returns nothing so the next handler answers`
- `series: entity_ids on a key that does not take them is 422; an empty entity_ids is none`
- `the response keys equal the generated schema keys` for each of the three routes (assert every object's key set against a `satisfies AiCompetitorsResponse`, `OverviewCompetitorsResponse` and `AiSeriesResponse` fixture, as `ai-overview.test.ts` does for the fan-out mock)
- `a viewer, a member of another workspace and another project's id are 403 or 404 as the summary route is`

Break on purpose: take lost numerators from `lost_prompts_total` instead of the clear rule; put the own brand first only by name; sum shares per entity without the denominator; skip the top flag read before narrowing; return a point for an empty week with value 0. Each must fail the named test.
Checks: FILE per file, TARGET on `src/mocks/handlers/competitors.test.ts src/mocks/competitors-model.test.ts src/mocks/handlers/registered.test.ts src/mocks/handlers/prompt-answers.test.ts`, ESLINT of the files, TYPES, `prettier`. Acceptance: no other package's mock test changes meaning; `handlers/index.ts` untouched.
Commit `WP-39: competitor mocks`.

### T2: route, scope, reads, header, tabs, nav live

Rows: WB-IA-05, WB-CMP-01, WB-CMP-02. Needs leases L1, L2, L3, L5, L6.
Files new (a `.test.ts(x)` beside each): `features/competitors/index.ts`, `competitors-screen.tsx`, `competitors-states.tsx`, `header/competitors-header.tsx`, `scope/{scope-model,use-competitors-scope,competitors-views,filter-fields,prompt-countries,compare-select}.ts(x)`, `scope/inbound-links.test.ts`, `data/{read-state,competitors-queries,use-competitors-reads}.ts(x)`, `tabs/competitor-tabs.ts`, `tabs/candidates-tab.tsx`, `seo/seo-tab.tsx`, `comparison/comparison-tab.tsx` and `ai/ai-tab.tsx` (each a host that renders its section frames with their headings and empty bodies, which T3 to T6 fill; nothing reaches `develop` before T8), `app/[workspace]/[project]/competitors/add-competitor-slot.tsx` (+ test). Modify: `app/[workspace]/[project]/competitors/page.tsx` (the real page), `lib/navigation/registry.ts`, `lib/navigation/registry.test.ts`, `app/[workspace]/[project]/planned-routes.test.ts`, `features/ai-overview/drilldown/drill-links.test.ts`, `messages/en.json` (T2 groups). Templates to read first: `features/citations/citations-screen.tsx`, `citation-scope.ts`, `app/[workspace]/[project]/ai/ai-setup-slot.tsx`, `features/ai-overview/data/read-state.ts` and `scope/*`.

Tests first:
`scope/scope-model.test.ts`
- `a link with no key is the Comparison tab, every engine, cmp on, no country, no topic, branded excluded`
- `tab reads seo, ai and candidates; anything else is Comparison`
- `engine reads a comma list of known codes, once each, at most 3; none known is every engine`
- `eng reads one known code; an engine that is not in scope falls back to the first engine in scope in the fixed order`
- `metric sov is share of voice; citation, recommendation and anything else is mention`
- `branded include and included count branded prompts, only counts them alone, anything else leaves them out`
- `topic reads a UUID lowercased; anything else is no topic`
- `lost reads a UUID; anything else is none`
- `a value that does not read never throws and never writes to the address`
`scope/inbound-links.test.ts`
- `every drillHref competitors link of the Overview (narrowed engines, country, topic, branded, cmp off, a custom range) is read back by parseScope into the same scope` (import `drillHref` from `@/features/ai-overview`, with `DRILL_SUPPORT`, in a test only, as `drill-links.test.ts` imports the citations parser)
`scope/use-competitors-scope.test.tsx`: `setting a value that is the default removes its key`, `changing tab pushes history and clears cols, q and sort`, `the range comes from the picker and is at most 92 days`
`scope/competitors-views.test.ts`: `the view keys never include inspect, itab, the range or country`, `the presets set only their own keys`
`scope/filter-fields.test.ts`: `fields are engine multi, topic single and branded with one option`, `a link's engine is kept while the engines load`
`scope/prompt-countries.test.tsx`: `lists the countries of the first 200 prompts, keeps a link's country, draws nothing when there is none`
`data/read-state.test.tsx`: `idle, loading, ready, refetching, error and stale from a query`, `placeholder data is flagged as another scope's`
`data/competitors-queries.test.ts`: the request shapes of 3.3, parameter by parameter (`competitors`, `lostPrompts`, `topicRows`, `sovSeries`, `entities`, `sources`), `engine list omitted when every engine is in scope`, `compare is sent only when cmp is on and never to lost, topics, series or sources`, `entity_ids are sorted and at most 20`, `lost_limit is 10 and sources_limit 5`, `every key sits under the project's ai prefix`
`data/use-competitors-reads.test.tsx` (MSW): `R1 is one request for the Comparison tab and the inspector`, `R2, R3 and R6 are not asked on the AI tab, R4 is not asked on the Comparison tab, nothing is asked on SEO or Candidates`, `nothing is asked before the engines are known`, `a changed scope keeps the old data and reports refetching`
`tabs/competitor-tabs.test.ts`: `tab order is Comparison, SEO, AI, Candidates`, `the Candidates count is unknown and the label shows no number`
`seo/seo-tab.test.tsx`: `says search share of voice is not measured yet with its reason, links to Rankings and renders no digit`
`competitors-screen.test.tsx`: `a member without data:read is told so and nothing is read`, `engines loading shows the skeleton, not an empty state`, `no engine on shows the no engine state with the settings link for an editor and the admin sentence for a viewer`, `the engines read failing shows Retry and no empty list`, `the header has the title, the meta line, the saved view menu and the primary Add competitor only with entities:write`, `Add competitor opens the entity dialog for a competitor and closing it refreshes the reads`, `tabs write tab to the address and the panel follows`, `a link's dropped range shows its banner`
`add-competitor-slot.test.tsx`: `opens EntityDialog with role competitor and the project's entities`
`registry.test.ts`, `planned-routes.test.ts`, `drill-links.test.ts`: as the leases say; plus `registry` finds `/competitors` as a live destination and the sidebar lists it for data:read.

Break on purpose: let `eng` default to an engine out of scope; send `compare` to the lost read; ask R4 on the Comparison tab; show the Add competitor button to a viewer; write a key that is the default. Each fails a named test.

Browser: dev server per section 8; `/digibranders/fynix/competitors` loads the tab shell at 390 and 1280 px; `/digibranders/cleanstart/competitors` (engines off) shows the no engine state.
Checks: FILE per file, TARGET on `src/features/competitors src/lib/navigation "src/app/[workspace]/[project]" src/features/ai-overview` (medium lane, `--maxWorkers=2`; the Overview folder runs once here for L5 and L6), MESSAGES, ESLINT, TYPES, `prettier`. Commit `WP-39: competitors route, scope and header`.

### T3: channel summary, top competitor, named in

Rows: WB-CMP-03, WB-CMP-05, WB-CMP-06. Depends on T1 and T2.
Files new (a test beside each): `model/types.ts`, `model/competitors-fixtures.ts` (typed builders of `AiCompetitorsResponse` for tests), `model/entity-order.ts`, `model/channel-summary.ts`, `model/top-competitor.ts`, `model/named-in.ts`, `model/tracked-set-note.ts`, `comparison/channel-summary-table.tsx`, `comparison/figure-cell.tsx`, `comparison/entity-chips.tsx`, `comparison/top-competitor-strip.tsx`, `comparison/tracked-note.tsx`. Modify: `comparison/comparison-tab.tsx` (mounts chips, strip, table, note), `messages/en.json` (T3 groups).

Tests first:
`model/entity-order.test.ts`: `own entities first, competitors in the API order`, `a colour role comes from color_index: own chart 1, competitors 2 to 6`, `an entity with no index takes the next free slot in name order, past six it is other`
`model/channel-summary.test.ts`
- `one group per engine in scope in the fixed engine order, four rows each`
- `share of voice cell: value, the denominator "answers naming a tracked brand", no count of successes`
- `mention cell: value from the headline and the counts from pooled, never successes over trials as the value`
- `fewer than 4 valid answers is insufficient with its count and no value`
- `a null value with a zero denominator is unknown with the reason no answers, never 0`
- `recommendation is not classified with its reason, whatever the counts`
- `citation share is the value over units, with "k of n citation units"`
- `with compare, the mention change comes from rateChange on the previous cell and is coloured only when detectable; the share change is never coloured; a null previous gives no change`
- `an engine with no answer for any entity is a group that says so`
`model/top-competitor.test.ts`
- `the flagged competitor of each engine is the top competitor, and the model recomputes nothing`
- `no flag with answers is "none named"; no answers is "no answers"`
- `a tie on share of voice at 9 decimals names the other competitor and says the one named in more answers is shown`
- `different engines may have different top competitors; there is no overall one`
- `the own brand is never the top competitor even when its share is higher`
`model/named-in.test.ts`: `named in is pooled successes of trials`, `an absent pooled is unknown, never 0 of 0`, `a count above the trials is rejected as unknown`
`model/tracked-set-note.test.ts`: `names you and the competitors once, watch and removed entities are not in it`, `lists an added date only when it is inside the window`, `says the set changed when entity_config_versions has more than one entry`, `without the entities read a changed set says so and lists no date`, `no dash in any word`
`comparison/channel-summary-table.test.tsx`
- `own brand is the first column with the chart 1 swatch, a caption names the table, rows are grouped by engine with a group header row`
- `every percent is followed by its count in the same cell`
- `a competitor header is a button that opens the inspector with inspect=competitor:<id>; the own header is plain text`
- `the SEO group has one row of Not available cells with the reason and no digit`
- `a table wider than its region scrolls inside it, takes the keyboard and shows the scroll hint`
- `loading shows a skeleton of the final height, an error shows Retry and keeps the header, a stale read says last figures read`
`comparison/top-competitor-strip.test.tsx`: `one card per engine in scope with the name as a button, the share of voice with its count and "You: 27%"`, `tied, none named and no answers sentences`, `the card has no colour for a share of voice difference`
`comparison/entity-chips.test.tsx`: `a chip per tracked competitor with its swatch and a button that opens the inspector, reachable in order by Tab`, `no chip when no competitor is tracked and the empty state offers Add competitor to an editor`
`comparison/tracked-note.test.tsx`: `renders the note and the changed set sentence`

Break on purpose: use `pooled.successes / pooled.trials` as the mention value; make the top competitor the highest share without the flag; show 0 for a null value; colour a share change; drop the denominator line from the share cell; list a date outside the window. Each fails a named test.
Browser: `/digibranders/fynix/competitors` at 390, 768, 1024, 1280, light and dark, Default and Compact density; check the group rows, the scroll hint and the strip.
Checks: FILE, TARGET on `src/features/competitors`, MESSAGES, ESLINT, TYPES, `prettier`. Commit `WP-39: channel summary, top competitor and named in`.

### T4: by topic comparison with Gap vs leader

Rows: WB-CMP-04. Depends on T2 and T3 (the entity order and the fixtures). Runs beside T6.
Files new (a test beside each): `model/topic-rows.ts`, `model/topic-gap.ts`, `comparison/topic-comparison-table.tsx`, `comparison/topic-columns.tsx`, `comparison/metric-switch.tsx`, `comparison/engine-switch.tsx`, `comparison/topic-phone-list.tsx`, `links.ts`. Modify: `comparison/comparison-tab.tsx` (mounts the section: one mount line and its import), `messages/en.json` (T4 group).

Tests first:
`model/topic-rows.test.ts`: `a row per topic of the summary, sorted by prompt count, the no topic row last`, `a topic row with no cells for the engine is a row of unknown cells, not of zeros`, `the cell of an entity is its mentioned or share_of_voice cell with the answers behind it`
`model/topic-gap.test.ts`
- `the leader of a row is the entity with the highest value among those with a rate, own included, ties to the own brand then to the API order`
- `the gap is the own value minus the leader value in points and is 0 when the own brand leads`
- `the gap is unknown when the own brand has no rate, or no competitor has one`
- `an entity under 4 valid answers is insufficient and never the leader`
- `mention gap: detectable true only when the unpaired test on the pooled answers excludes 0 and the points and the pooled difference agree; false is within normal variation; counts that are not whole give null`
- `share of voice gap is never detectable (null), whatever the numbers`
- `hidden entities (not visible columns) still count for the leader`
`comparison/topic-comparison-table.test.tsx`
- `columns are the topic, the own brand and the five competitors with the most share of voice, the rest in the column chooser, then Gap vs leader`
- `the highest value of a row is bold with no colour; the header tooltip says differences can be within normal variation`
- `every cell prints its percent with its count`
- `a negative detectable mention gap is coloured negative with the interim test words; a within-variation gap is neutral; any share of voice gap is neutral`
- `the metric switch writes metric=sov and the cells change to share of voice with "of n answers naming a brand"`
- `the engine switch writes eng and the read is made for that engine only`
- `sorting by an entity column or by gap puts unknown last in both directions`
- `loading skeleton, a failed read shows Retry with the header intact, no rows shows its reason and a link to the Prompts page, a search with no match shows the filtered empty state`
- `the topic name is a link to the topic drawer on the Prompts page carrying the engine, the range and the country`
- `below 768 px the table is a list of two line rows, each a link, with the leader and the gap in line 2`
`comparison/metric-switch.test.tsx`: `two options Mention rate and Share of voice, no Citation or Recommendation, labelled Metric`
`links.test.ts`: `a topic link is read back by the inspect parser of lib/inspector/placement`, `a prompt link names the prompt and the engine`

Break on purpose: leave the own brand out of the leader; colour a share of voice gap; count only the visible columns for the leader; treat a missing cell as 0; sort unknown first. Each fails a named test.
Browser: at the four widths, both themes, both densities; Gap vs leader of the Fynix topics (find one detectable and one within variation, note their names in the report for the e2e).
Checks: FILE, TARGET on `src/features/competitors`, MESSAGES, ESLINT, TYPES, `prettier`. Commit `WP-39: by topic comparison`.

### T5: prompts we lose

Rows: WB-CMP-07. Depends on T2 and T3. Runs beside T7.
Files new (a test beside each): `model/lost-prompts.ts`, `comparison/lost-prompts-section.tsx`, `comparison/lost-prompt-columns.tsx`, `comparison/lost-phone-list.tsx`. Modify: `comparison/comparison-tab.tsx` (one mount line), `messages/en.json` (T5 group).

Tests first:
`model/lost-prompts.test.ts`
- `the shown competitor is the lost choice when it is tracked, else the top competitor of the engine, else the first competitor with a lost list`
- `the sentence uses lost_prompts_clear_total over lost_prompts_with_min_answers and never lost_prompts_total`
- `a clear total larger than the judged count is unknown, never "4 of 3"`
- `with_min_answers of 0 says no prompt has 4 or more answers`
- `rows keep the server order (importance, lost answers, text, id) and carry lost k of n answers, never a percent`
- `a list shorter than lost_prompts_total says it is the most important N of the total`
- `an own row has no lost block and is not offered in the competitor select`
`comparison/lost-prompts-section.test.tsx`
- `the competitor select lists the tracked competitors, writes lost, and the section reads one engine (eng) with lost_limit 10`
- `importance is a chip with a word, the prompt is a link to the prompt inspector, the lost answers cell says "2 of 3 answers"`
- `the table sorts by importance, most first, by default`
- `loading skeleton; no competitor tracked shows its reason and the Settings > Entities link; a real zero says the competitor is not named without you in any prompt; the engine with no answers says so`
- `a failed read shows Retry and leaves the other sections`
- `below 768 px a list of two line rows`
- `the lost read is not made on the AI tab, only on Comparison` (assert with the request listener)

Break on purpose: put `lost_prompts_total` over the judged count; show a percent; list an own row; drop the cap note. Each fails a named test.
Browser: four widths, both themes; Fynix has lost prompts for at least one competitor on ChatGPT (state in the report which).
Checks: as T4. Commit `WP-39: prompts we lose`.

### T6: AI tab: per engine share of voice trends and boundaries

Rows: WB-CMP-10, WB-CMP-11. Depends on T1, T2 and T3 (tracked note, entity order). Runs beside T4.
Files new (a test beside each): `model/sov-series.ts`, `model/boundaries.ts`, `ai/engine-sov-chart.tsx`, `ai/chart-option.ts`. Modify: `ai/ai-tab.tsx` (the host from T2 mounts the charts and the footnote), `messages/en.json` (T6 groups).
Templates to read first (do not import; they are another feature): `features/ai-overview/cards/competitors/sov-over-time-card.tsx`, `competitor-trend-card.tsx`, `chart-parts.ts`, `model/weekly-series.ts`, `model/tracked-set.ts` (week of a day in a zone); `lib/charts/boundaries.ts`, `small-sample.ts`, `category-chart.ts`; `components/app/chart/chart-frame.tsx`.

Tests first:
`model/sov-series.test.ts`
- `one chart per engine in scope; each draws the own brand and the engine's top 3 competitors by window share of voice, a competitor with no share is never top`
- `a point is the share of voice of the week with its denominator, answers naming a tracked brand`
- `a week under 4 answers naming a tracked brand is thin: no percent, hollow, with the answer count`
- `a week with no answer is a gap, never 0`
- `a pooled point keeps pool.weeks and pool.window.to for its title and is flagged`
- `entities past the palette are counted for the footnote and not drawn; the others are in the legend, off`
- `all engines share one y ceiling: the next tenth over the highest drawn value, at most 1`
- `fewer than 2 weeks of points is a trend that cannot be drawn`
`model/boundaries.test.ts`
- `no entity_config_changes draws nothing`
- `the first change (version 1) draws no line`
- `a later change whose from is inside the window draws a line at the category of the Monday of its week`
- `a later change before the window draws no line`
- `the label is "{name} added" when exactly one competitor's added_at day equals from, the names joined for several, else "Tracked set changed"`
- `the Monday of a day near midnight is read in the project zone`
- `without the entities read the label is "Tracked set changed" and carries no date`
`ai/engine-sov-chart.test.tsx`
- `a skeleton at 280 px, then a line chart whose frame summary names the engine and the weeks`
- `the legend toggles a series and keeps its colour; the own brand is chart-1; a competitor takes its color_index`
- `the tooltip row of a week reads "27%, of 412 answers naming a tracked brand" per entity sorted by value`
- `a pooled point says "4 weeks to Nov 9" in its tooltip title and the footnote carries the pooling sentence once when any drawn point is pooled`
- `a boundary line carries its label and the footnote says what from is`
- `the Table view lists every week with the same words`
- `the footnote names the tracked set and the added dates inside the window`
`ai/ai-tab.test.tsx`: `one frame per engine in scope, two columns from 1024 px`, `R4 is asked once for every tracked entity with at most 20 ids`, `one tracked brand shows the no competitor state`, `a failed R4 shows Retry in the frame and leaves the footnote`, `an engine with no points shows its own empty state and the others draw`, `compare does not apply: no previous series is drawn`

Break on purpose: draw the first version's change as a boundary; treat a thin week as 0; draw a pooled point without its words; compute the week of `from` in UTC; leave the y ceiling per chart. Each fails a named test.
Browser: AI tab at four widths, both themes; Add competitor through the dialog on `/digibranders/fynix/competitors?tab=ai` and see the boundary (mock rule 3.16); note the label.
Checks: FILE, TARGET on `src/features/competitors`, MESSAGES, ESLINT, TYPES, `prettier`. Commit `WP-39: share of voice trends and boundaries`.

### T7: the competitor inspector

Rows: WB-CMP-12. Depends on T3 (chips, strip, entity order), T1 and T2. Runs beside T5.
Files new (a test beside each): `model/entity-compare.ts`, `inspector/inspector-host.tsx`, `inspector/competitor-inspector.tsx`, `inspector/side-by-side.tsx`, `inspector/sources-tab.tsx`, `inspector/use-inspector-reads.ts`. Modify: `competitors-screen.tsx` (mount the host in `InspectorLayout`, the step order, the opener focus), `comparison/entity-chips.tsx` and `comparison/top-competitor-strip.tsx` only if their open handler needs a prop, `messages/en.json` (T7 group).
Templates: `features/citations/domain-inspector/inspector-host.tsx`, `domain-inspector.tsx`, `components/app/inspector/inspector.tsx` and `use-inspector.ts`.

Tests first:
`model/entity-compare.test.ts`
- `side by side rows per engine: share of voice, mention rate, citation share and recommendation, each with them, you and the gap`
- `the mention gap is you minus them in points with its 95 percent interval from the pooled answers (differenceInterval) and the interim label`
- `the share of voice gap has no interval and no test, so it is neutral`
- `citation share and recommendation rows carry no gap`
- `an engine with no answers or fewer than 4 for either side is unknown with the reason, never a gap of 0`
- `the own brand is the first own entity of the tracked set`
`inspector/competitor-inspector.test.tsx`
- `opens from ?inspect=competitor:<id> with the name, the Competitor badge, the tracked since date and the primary domain from the entities read`
- `the strip shows share of voice and mention rate for eng with the counts and a gap card`
- `tabs are Overview and Sources only; itab=sources is written to the address and Overview is left out`
- `the Overview side by side shows one block per engine in scope with the gap, its interval and the interim words`
- `the Sources tab asks R6 only when open and lists at most 5 domains with units and answers; [] shows its empty state and the contract note`
- `an id that is not a tracked competitor shows the not tracked state with the Settings link and no number`
- `R1 failed shows an inline error with Retry; R1 already held by the page is not asked again`
- `J and K step through the tracked competitors in order, the position reads "2 of 5", Escape closes and the focus returns to the opener`
- `at 390 px it is a sheet; the address keeps the page's own keys when it opens and closes`
`inspector/inspector-host.test.tsx`: `a record of another type opens nothing`, `stepping inside one project keeps the host and its focus`

Break on purpose: colour the share of voice gap; ask R6 on the Overview tab; compute the interval from the values instead of the counts; accept `entity` as a type; step into the own brand. Each fails a named test.
Browser: open from a chip, from the strip and from a channel summary header at 390, 768, 1024, 1280, both themes; keyboard path.
Checks: FILE, TARGET on `src/features/competitors`, MESSAGES, ESLINT, TYPES, `prettier`. Commit `WP-39: competitor inspector`.

### T8: e2e flow, responsive and accessibility pass, as built notes, final checks, push

Rows: process (proves all rows in a browser). The only task that runs `pnpm test`, `pnpm build` and e2e, once, through the lock.
Files new: `e2e/flows/ai-competitors.spec.ts`, `e2e/support/ai-competitors.ts` (do not touch `e2e/support.ts`; reuse `signIn` and, from `e2e/support/layouts.ts`, `EDITOR`, `THEMES`, `WIDTHS`, `expectNoSeriousViolations`). Modify, append only: `docs/20-frontend-specification.md` (an "As built (WP-39)" blockquote after the last paragraph of 5.10), `docs/design-system/24-page-templates.md` (one after 9.8), `docs/design-system/25-component-inventory.md` (one paragraph: `MetricSwitcher` was not built and why, the chip bar as colour key, the channel summary table's own markup and the lift follow-up F-2). Fix, in the package's own files only, what the browser pass finds, each fix with a regression test.
Flow (sign in as `priya@digibranders.test`, the Fynix project; `mei@digibranders.test` (viewer) for the permission case; `cleanstart` for the empty case), cases:
- `the Comparison tab shows the channel summary with counts, the top competitor per engine and Named in`
- `Gap vs leader is neutral unless detectable: every coloured gap has the interim test words and no share of voice gap is coloured` (use the topics named by T4)
- `the metric switch and the engine switch change the by topic table and the address`
- `prompts we lose lists a competitor's prompts by importance with k of n and the clear total over the judged count`
- `the SEO tab says search share of voice is not measured, with Rankings as the action`
- `the Candidates tab says candidates are not listed yet and shows no count`
- `the AI tab draws one chart per engine; adding a competitor through Add competitor draws a boundary labelled with its name and the footnote names the set`
- `the competitor inspector opens from the strip, shows the side by side with the interval and the sources, J and K step, Escape closes and the focus returns`
- `a viewer has no Add competitor button`
- `a failed competitors read shows Retry and the page keeps its header and tabs` (a route fault in the support file)
- `a link from an Overview card (engine and window keys) opens the page on that scope`
- `every tab at 390, 768, 1024 and 1280 px in light and dark, in Default and Compact density, has no serious axe violation and no sideways scroll of the page`
- `the keyboard path reaches Add competitor, the tabs, the metric switch, a chip, a table cell and the inspector`
Steps:
1. Write the spec and support file; run it ONCE at the end of the steps below, not while writing (a headless run of one case against the dev server on 3216 is allowed while writing).
2. Responsive, theme, density and axe pass in headless Playwright against the dev server on port 3216 (section 8): 4 widths, light and dark, Default and Compact, the three worlds (`fynix`, `eventus-security` after the dev seed, `cleanstart`), screenshots to the scratchpad. Fix what is found; each fix has a test.
3. As built notes (append only), then `git fetch origin && git rebase origin/develop` (conflict candidates: `messages/en.json`, `registry.ts`, `registry.test.ts`; keep both sides; never touch generated files).
4. Gates: confirm `/tmp/idraft-health/pause` is absent and memory free is at least 40 percent. Then FULL, one at a time through the lock: `infra/dev/heavy --label wp39-test --wait 120 --max 60 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'`; `infra/dev/heavy --label wp39-build --wait 120 --max 60 -- bash -c 'cd apps/web && pnpm build'`; `infra/dev/heavy --label wp39-e2e --wait 120 --max 60 -- bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-competitors.spec.ts'`. Then LINT of the whole app (`pnpm lint`, ESLint across `apps/web`, the coordinator requires it before every push), `pnpm typecheck`, `pnpm format:check`.
5. `git push origin HEAD:develop`; `infra/dev/wp-status WP-39 merged "..."` and the report line of the brief; delete the backup branch (`git push origin --delete ai/wp-39-competitors-page`).
The final reviewer (a second fresh Sonnet) reads the whole diff against the brief's acceptance criteria and the row map, and opens every tab and the inspector at the four widths.
Commits: `WP-39: competitors e2e flow and fixes`, then `WP-39: as built notes`.

## 6. Row map: 11 rows to a task and a proving test

| Row | Item | Task | Proving test (file: case) |
|---|---|---|---|
| WB-IA-05 | Competitors destination live | T2 | `lib/navigation/registry.test.ts`: the registry finds `/competitors` as a live destination; `competitors-screen.test.tsx`: the page renders for a member with data:read |
| WB-CMP-01 | Route, tabs Comparison, SEO, AI, Candidates (count) | T2 | `tabs/competitor-tabs.test.ts`: tab order and "the Candidates count is unknown and the label shows no number"; `seo/seo-tab.test.tsx`; e2e SEO and Candidates cases |
| WB-CMP-02 | Header: Saved view, Add competitor | T2 | `competitors-screen.test.tsx`: "Add competitor opens the entity dialog for a competitor and closing it refreshes the reads"; `add-competitor-slot.test.tsx`; the dialog's SOV note is `entities.test.tsx`'s |
| WB-CMP-03 | Channel summary | T3 | `model/channel-summary.test.ts` and `comparison/channel-summary-table.test.tsx`: "every percent is followed by its count", "the SEO group has one row of Not available cells" |
| WB-CMP-04 | By topic with metric switch and Gap vs leader coloured only when detectable | T4 | `model/topic-gap.test.ts`: detectable and share of voice cases; `comparison/topic-comparison-table.test.tsx`: coloured only when detectable; e2e "Gap vs leader is neutral unless detectable" |
| WB-CMP-05 | Top competitor | T3 | `model/top-competitor.test.ts`: "the flagged competitor of each engine is the top competitor" and tie, none and own cases; `comparison/top-competitor-strip.test.tsx` |
| WB-CMP-06 | "Named in 35 of 192 answers" per entity per engine | T3 | `model/named-in.test.ts`: "named in is pooled successes of trials"; `channel-summary.test.ts`: "mention cell: value from the headline and the counts from pooled" |
| WB-CMP-07 | Prompts we lose, by importance | T5 | `model/lost-prompts.test.ts`: "the sentence uses lost_prompts_clear_total over lost_prompts_with_min_answers and never lost_prompts_total", "never 4 of 3"; `lost-prompts-section.test.tsx`: sorted by importance |
| WB-CMP-10 | SOV charts draw a boundary when the tracked set changes | T6 | `model/boundaries.test.ts` (all cases); `ai/engine-sov-chart.test.tsx`: "a boundary line carries its label and the footnote says what from is"; e2e boundary after Add competitor |
| WB-CMP-11 | AI tab: per engine SOV trends | T6 | `model/sov-series.test.ts`: thin, gap, pooled cases; `ai/ai-tab.test.tsx`: "one frame per engine in scope" |
| WB-CMP-12 | Competitor inspector (side by side, AI gap with interval, sources) | T7 | `model/entity-compare.test.ts`: interval and share of voice cases; `inspector/competitor-inspector.test.tsx`: side by side, sources, not tracked, J and K |

Process rows (no inventory id): the mocks (T1: `handlers/competitors.test.ts`), the e2e flow and the browser pass (T8). Rows done for the status line: 3 of 11 after T2, 6 of 11 after T3, 7 of 11 after T4, 8 of 11 after T5, 10 of 11 after T6, 11 of 11 after T7; steps 5 of 6 after T7, 6 of 6 after T8.

## 7. Order and parallelism

At most two subagents of this session at a time; a reviewer counts as one. The pipeline: the reviewer of task N may run beside the implementer of task N+1 only when their files are disjoint (the table says which); two implementers never run beside a reviewer.

| Round | Implementers | Why they do not collide |
|---|---|---|
| 1 | T1 (mocks) and T2 (route, scope, reads, header) | disjoint files; only T2 edits `en.json`, the registry and the Overview test |
| 2 | T3 alone | needs T1 and T2; owns `comparison-tab.tsx` for the first time |
| 3 | T4 and T6 | T4 edits `comparison/*` and one mount line of `comparison-tab.tsx`; T6 edits `ai/*` and `model/sov-series.ts`, `model/boundaries.ts`; each edits only its own `en.json` group with single line edits |
| 4 | T5 and T7 | T5 edits `comparison/lost-*` and one mount line of `comparison-tab.tsx`; T7 edits `inspector/*`, `competitors-screen.tsx` and the open handlers of the chips and the strip (T3 files, no section of T5) |
| 5 | T8 alone | needs everything |

Each round ends with the reviewers (one at a time), then the backup push of the branch. Nothing goes to `develop` before T8. The coordinator can ask for an earlier `develop` push after T4 (7 of 11 rows): rebase, the targeted tests and the whole-app lint first.

## 8. Dev server and browser checks

Reuse a dev server already running for this worktree (check `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'` and match the process cwd, never only the port). Else start `NEXT_PUBLIC_API_MOCKING=all pnpm exec next dev -p 3216` in the background from `apps/web`; if 3216 is taken by another project, pick the next free port and never kill that process. Delete the `AGENTS.md` and `CLAUDE.md` that `next dev` writes in `apps/web`. The built-in browser pane cannot register the MSW worker: headless Playwright only, screenshots to the scratchpad directory. Pages: `/digibranders/fynix/competitors` (3 engines, 24 prompts, 5 competitors), `/digibranders/eventus-security/competitors` (dev seed), `/digibranders/cleanstart/competitors` (engines off). Accounts: `priya@digibranders.test` (editor), `tomas@digibranders.test` (admin), `mei@digibranders.test` (viewer). Widths 390, 768, 1024, 1280; light and dark through `localStorage` `idraft.theme`; Default and Compact through `density=compact` in the address.

## 9. Risks

1. Size: four tabs, three mock routes and an inspector is more than the brief's 6 hours. T8 is the likely overrun (browser pass fixes); the coordinator may split it.
2. The in process summary read of the mock (3.16) may not work in the browser worker. The T1 spike decides on day one; lease L7 is the fallback and widens T1 by about 30 minutes.
3. The server rule for lost prompts is per answer; the mock approximates it from fixture mentions. A `shortcut:` comment says so; the page uses only the contract fields and never recomputes.
4. The by topic read is the summary at topic rows with entities (12 to 16 KB). A project with 20 entities and many topics is larger; the read is made only on the Comparison tab and for one engine.
5. Copies of scope, `Read`, tracked set and leader exist in three features now (F9). A change to the rule in one must be made in the others until the lift (follow-up F-1).
6. `drillHref` links from the Overview start working when `competitors` is live; the keys must stay as 3.2 says. `scope/inbound-links.test.ts` fails first when either side renames a key.
7. The interim unpaired test is used for Gap vs leader and the inspector gap although the two sides share prompts (a paired question). It is labelled `interim` everywhere and replaced when `ai/stats/compare` (WP-58) exists. Share of voice gaps are never tested.
8. WP-56 replaces `tabs/candidates-tab.tsx`; WP-40 and WP-23 are untouched. If WP-56 lands first, T2 keeps its import of the seam and rebases.
9. The competitor inspector is 400 px (not wide). The side by side has three value columns; the table wraps its numbers under the name at 360 px. T7 checks it and the coordinator can approve a one line lease on `WIDE_TYPES` in `lib/inspector/placement.ts` if it reads badly.
10. Shared files with parallel edits: `messages/en.json` and `comparison-tab.tsx`. Mitigation: one group per task, single line edits, one mount line per section, the rebase keeps both sides.
11. Mock `entity_config_changes` is derived from role dates (3.16); the real server derives it from derivations (c8 C-25). The page reads only `from` and `version`, so the two agree on shape.
12. Follow-ups, not built here: F-1 lift the three copies into `lib`; F-2 swatch in `DataTableColumn.header`; the paired test (WP-58); SEO competitor data (no package); source overlap, WB-CMP-08 (WP-61 and later); Candidates, WB-CMP-09 (WP-56).
