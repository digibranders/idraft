# Keyword Detail (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A box is ticked only when the command that proves the step ran in this session and its output is shown in the report; never tick from memory.

**Goal:** A keyword opens as a full page at `/{workspace}/{project}/seo/keywords/{tkId}` with everything the backend already serves about one tracked keyword: the rank history chart with depth bands, competitors, absolute rank and events; a SERP snapshot viewer (latest results and dated snapshots, the own site and tracked competitors marked, the features of a snapshot, a controlled download of the provider's raw answer for members who may read it); a SERP features strip with its history; the AI Overview history; the rank events feed; the target and ranking URL with its changes; competitor ranks over time; a six cell metric strip; and the page actions (Check now, open the ranking page, archive, change depth). The keyword inspector in Rankings links to it with "Open page", and a Cmd or Ctrl click on a row opens it in a new tab.

**Architecture:** Template T3 (docs/design-system/24-page-templates.md sections 5 and 9.4): a `DetailPageHeader`, a `MetricStrip`, two local tabs (Overview, SERP snapshots), an evidence column (8 of 12) and a right rail (4 of 12) that stack below 1280 px. Every read is a route that already exists in `backend/openapi/v1.json` and the generated client; the web app uses none of the new ones yet. As in the sibling plans, pure models decide what a cell, chart or row shows and the components only lay out. The page lives in the Rankings feature folder (`src/features/rankings/keyword-detail/`) because the lint boundaries forbid one feature importing another and the page shares the check-now hook, the rank cells, the inspector queries and the depth dialog with the list. The chart model is extracted from the inspector card and shared, not forked. The mock API learns every route first, from one deterministic rank world, so that the history chart, the snapshots, the features strip, the AI Overview history and the events agree with each other and with the row in the list.

**Tech Stack:** Next.js 16, React 19, TypeScript strict (`exactOptionalPropertyTypes`), TanStack Query 5, nuqs, next-intl, ECharts 6 (through `ChartFrame`), MSW, Vitest with Testing Library, Playwright.

---

## Read first

| What | Where |
|---|---|
| Executor rules and the lessons of the last reviews | This plan, "Executor rules and definition of done", and `docs/superpowers/plans/2026-10-01-keywords-ui.md` "Notes for the executor" (gates, no dashes, edit tools only, `design-taste-frontend` before markup). The review model is Sonnet in this plan, not Opus |
| The page | `docs/20-frontend-specification.md` sections 3.2 (route list, superseded by 11-navigation), 3.5 to 3.9, 4.6, 4.9, 5.4; `docs/design-system/24-page-templates.md` sections 5 (T3) and 9.4; `docs/design-system/16-drawers-dialogs-popovers.md` sections 1.1, 2.1, 2.7 (history rules, "Open page"), 3 (`DetailPageHeader`); `docs/design-system/23-application-patterns.md` sections 1 (levels), 4.1, 9 |
| Tables, badges, charts, accessibility, responsive | `docs/design-system/12-tables.md` (sections 5, 6, 9, 13), `14-badges-status.md` (feature labels, AI Overview, Stale, Archived), `15-data-visualization.md` (sections 2, 7, 11), `20-accessibility.md` (sections 3, 6, 12 and the spoken values table near line 440), `19-responsive-behavior.md` (line 367: T3 stacks below 1280 px) |
| Components that do not exist yet | `docs/design-system/25-component-inventory.md` sections 5.12 `DetailPageHeader`, 10.7 `Heatmap`, 12.1 `EventTimeline`, 4.17 `DatePicker` (Later: this plan uses a snapshot list select instead, Decision 7) |
| API | `backend/openapi/v1.json`: `GET {P}/tracked-keywords/{id}`, `.../rank-history`, `.../serp-current`, `.../serp-snapshots`, `.../serp-features`, `.../aio-history`, `GET {P}/serp-snapshots/{id}` and `/raw`, `GET {P}/seo/rank-events`; schemas `RankHistory`, `HistorySeries`, `HistoryPoint`, `HistoryBand`, `HistoryEvent`, `SerpCurrent`, `SerpResult`, `SerpSnapshotPage`, `SerpSnapshotSummary`, `SerpSnapshotDetail`, `SerpOrganicItem`, `SerpFeatureOut`, `SerpProvenance`, `SerpFeatureHistory`, `FeatureCheck`, `FeaturePresence`, `AioHistoryItem`, `RankEventPage`, `RankEventOut`, `EntityRef`, `UrlRef`, `RankCell`, `MetricValue` |
| Backend behaviour (read only) | `backend/src/idraft/api/ranks/routes.py` (permissions: `ReadData` is `data:read`, `ReadRaw` is `raw:read`), `service.py` (`window_dates` default `last_90d`, `event_page` 90 day rule, `serp_current`, `snapshot_detail`, `raw_answer` refusals, `aio_history` cap `AIO_HISTORY_MAX = 1000`), `history.py` (`WINDOWS`, `WINDOW_MAX_DAYS = 400`), `backend/src/idraft/ranks/events.py` (the exact event rules), `backend/src/idraft/api/permissions.py` (who holds `raw:read`), `backend/src/idraft/db/migrations/versions/0013_rank_collection.py` (21 event types, 16 feature types) |
| Existing code | `apps/web/src/features/rankings/**` (above all `keyword-inspector/{keyword-inspector.tsx,inspector-queries.ts,rank-history-section.tsx,rank-history-model.ts,demand-section.tsx,depth-dialog.tsx}`, `check-now/use-check-now.tsx`, `rank-cells.tsx`, `feature-cells.tsx`, `rankings-screen.tsx`, `rankings-route.tsx`, `rankings-queries.ts`), `src/components/app/{inspector,chart,metric,table,data-table,status,shell}/**`, `src/lib/{routes/paths.ts,navigation/registry.ts,charts/*,format/*,keywords/serp-features.ts,api/*,permissions/*}`, `src/mocks/**` (above all `rank-state.ts`, `rank-history.ts`, `handlers/rank-history.ts`, `handlers/tracked-keywords.ts`, `handlers/rules.ts` `cursorPage`, `respond.ts`, `keywords-codec.ts`), `src/test/{mock-api.ts,api-shapes.ts}`, `e2e/flows/rankings.spec.ts`, `src/app/[workspace]/[project]/settings/entities/[entityId]/page.tsx` (the model for a detail route) |
| Mock UI (visual reference only) | `apps/web/design-preview/`: there is **no** keyword detail mock (checked by grep). Nearest: `perf-detail.js` (a T3 detail in drawer and page: header, chart, "What changed"), `kw-inspector.js`, `index.html` lines 498 (SERP features card) and 783 to 797 (history panel), `charts.js` `hatch()` line 145 |

All commands run in `apps/web`. Before any markup invoke `design-taste-frontend` (house rule); the project's design system outranks its generic advice, and the precedence is: project docs and the API, then the existing app, then the mock UI.

## What the existing plan covers and what it misses

Facts verified on `develop` (518ed16) in this worktree.

| Check | Result |
|---|---|
| `grep -c` of `serp-current`, `serp-snapshots`, `rank-events`, `aio-history`, `Keyword Detail`, `tkId` in `docs/superpowers/plans/2026-10-29-rank-features-ui.md` | 0 for each. The 8 hits for `serp-features` are the file `src/lib/keywords/serp-features.ts` (the 16 feature codes), not the route `.../serp-features` |
| The same words in `apps/web/src` and `apps/web/e2e`, generated `schema.ts` excluded | 0 files. The generated client already has all of these routes (16 hits in `src/lib/api/schema.ts`), so no `pnpm gen:api` is needed |
| `docs/superpowers/plans/2026-10-01-keywords-ui.md` line 33 | Names "the full keyword page `/seo/keywords/[tkId]`" as not in that plan and "the rest still waits". No later plan picked it up |
| What `2026-10-29-rank-features-ui.md` built | Tasks 1 to 8 and 10: features, AI Overview and target marker columns, trend, competitor columns, the count strip, the 90 day rank history card in the inspector, Check now. Task 9 (average rank, visibility) is blocked on the backend. The card records what it leaves for a page: hollow markers inside a band, the events strip, "Show deep checks", other windows, absolute rank |
| Route and navigation | No `[tkId]` route exists under `src/app/[workspace]/[project]/seo/keywords/`. `registry.ts` has `keywords` live at `/seo/keywords` and `destinationOf` already matches `/seo/keywords/<id>` to it (longest prefix), so the sidebar item stays current. There is no `keywordDetailPath` in `src/lib/routes/paths.ts` |
| "Open page" | `InspectorHeader` has the `onOpenPage` prop and a `Maximize2` "Open page" icon button, but no caller passes it (`grep -rn onOpenPage src` finds only its definition). The row's Cmd or Ctrl click opens the **list** with `inspect=` in a new tab (`rankings-screen.tsx` `onRowOpen`), where 12-tables.md section 13 says it opens the full detail page |
| Layout trap | `src/app/[workspace]/[project]/seo/keywords/layout.tsx` renders `RankingsRoute` (the whole list screen) around **every** child. A `[tkId]` page placed beside it would render the list too. The list layout moves into a route group (Decision 1) |
| Lint boundary | `eslint.config.mjs` policy 3: "A feature never imports another feature". The page therefore lives in `features/rankings/keyword-detail/` |
| Missing components | `grep -rln "DetailPageHeader\|EventTimeline\|Heatmap" src` finds nothing. They are specified (inventory 5.12, 12.1, 10.7) and this plan builds them in `components/app/` where first needed |
| Mock gaps (all in `src/mocks`) | The rank history handler answers `serp_snapshot_id: null` on every point, `events: null`, `urls: {}`, `average_rank: null`, ignores `from`, `to`, `include` and `entity_ids`, and accepts `last_14d`, which the API refuses (`WINDOWS` is `last_7d`, `last_30d`, `last_90d`, `last_180d`, `last_365d`). `url_changed_at` is always null and a keyword's ranking path never changes. SERP features and the AI Overview are constants per keyword, not per check. The own and competitor rank walks are independent, so two entities can hold the same rank in one check, which no SERP can |
| A route the brief did not list | `GET {P}/tracked-keywords/{id}/aio-history` exists and is the source of the AI Overview history |
| Spec drift to note | Doc 20 section 5.4 lists `features-history`, `url-changes`, `linked-prompts`, `gsc`. The API has `serp-features` and `rank-events` instead of the first two and nothing for the last two. Related prompts (Phase 10a), the Search Console panel (Phase 12) and the Diagnostics tab (Phase 15) have no routes and are **not** in this plan |

## Facts this plan relies on

- **Detail** `GET {P}/tracked-keywords/{tracked_keyword_id}` (`detailQuery`, already used by the inspector): `TrackedKeywordDetail` with `keyword`, `location`, `device`, `os`, `search_engine`, `language_code`, `depth_profile`, `is_active`, `target_url`, `groups`, `terms`, `competitor_overrides`, `metrics`, `created_at` and `state` (`TrackedKeywordState`: `current: RankCell`, `change`, `best_rank`, `best_rank_at`, `worst_rank`, `first_ranked_at`, `feature_types_present`, `owned_feature_types`, `aio: AioStateInfo`, `target_url_match`, `url_changed_at`, `consecutive_failures`, `is_stale`, `last_observed_at`, `ranking_url_count`). An unknown or other project's keyword is `404`.
- **Rank history** `GET {P}/tracked-keywords/{id}/rank-history`: `window` is one of `last_7d`, `last_30d`, `last_90d` (default), `last_180d`, `last_365d`, or `from` and `to` (at most 400 days); `entity_ids` (`own` or uuids, at most 11, default own plus the effective competitors); `include` is any of `absolute`, `url`, `events`; `format` `points` or `columns`. Answer: `series[]` (`entity`, `points[]` of `{ date, observed_at, state: ranked | beyond_depth | failed, rank, depth_requested, url_id, serp_snapshot_id, absolute_rank }`), `bands[]` (`{ entity_id, from, to, kind: 'beyond_depth', depth_requested, label }`), `summary` (`checks`, `ranked_checks`, `beyond_depth_checks`, `failed_checks`, `average_rank: MetricValue | null`), `events[] | null` (`HistoryEvent`: `rank_event_id`, `occurred_at`, `event_type`, `entity_id`, `from_rank`, `to_rank`; only with `include=events`), `urls` (a map of `UrlRef`, only with `include=url`), `window`, `config_history`, `version_boundaries`, `deep_check_weekday`. Permission `data:read`.
- **SERP current** `GET .../serp-current`: `{ serp_snapshot_id | null, observed_at | null, results[] }`, the top 20 of the last check (`SerpResult`: `organic_rank`, `absolute_rank`, `url`, `domain`, `title`, `snippet`, `entity: EntityRef | null`). "Empty before the first check": `results: []`, ids null.
- **SERP snapshots** `GET .../serp-snapshots`: newest first, cursor page (`limit` 1 to 200, default 50, `next_cursor`, `has_more`), filters `from`, `to` (local days, included), `filter[depth_requested]` (1 to 700), `filter[has_ai_overview]`; a cursor made under other filters is `400 invalid_cursor`. Row `SerpSnapshotSummary`: `serp_snapshot_id`, `observed_at`, `observed_date`, `depth_requested`, `depth_returned`, `device`, `location_id`, `language_code`, `provider_code`, `served_from_cache`, `has_ai_overview`, `ai_overview_state` (`absent`, `present`, `present_async_loaded`, `present_not_loaded` or null), `item_types`, `own: RankCell`, `config_version`.
- **SERP snapshot** `GET {P}/serp-snapshots/{id}` (`observed_at` is a hint for the monthly table; `include=titles`): `SerpSnapshotDetail` = the summary plus `organic[]` (`SerpOrganicItem`: `organic_rank`, `absolute_rank`, `url`, `domain`, `entity` as the rules stood when it was checked, `title`, `snippet`), `features[]` (`SerpFeatureOut`: `feature_type`, `ordinal`, `rank_absolute`, `owned_by_project`, `owned_position`, `competitor_entity_ids`, `source_urls`, `payload`), `provenance` (`raw_payload_id`, `parser_version`, `canonicalizer_version`, `provider_task_id`, `collection_task_id`) and `titles_source` (`domain_rank_observations`, `serp_current_results` or `unavailable`). Titles exist only for the own and competitor entities' ranking pages and for the current top 20. `payload` is provider data of no documented shape: the UI never renders it.
- **Raw answer** `GET {P}/serp-snapshots/{id}/raw`: needs `raw:read`, held by owner, admin, editor and analyst; **not** by viewer or billing (`permissions.py`). It answers `application/json` with `Content-Disposition: attachment; filename="serp-snapshot-{id}.json"`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox`. `410 raw_expired` once past retention, `503 raw_unavailable` when it cannot be read now, `404` for an unknown snapshot. The body can be large and is untrusted provider data: the page offers a **download** only and never renders it.
- **SERP features** `GET .../serp-features`: `limit_checks` 1 to 200 (default 30, newest first), `from`, `to` (default window `last_90d`), `filter[feature_type_in]` (at most 20). Answer `checks[]` (`observed_at`, `serp_snapshot_id`, `depth_requested`, `features[]`) and `presence[]` (`feature_type`, `presence_rate`, `own_ownership_rate`, each a `MetricValue` with `numerator` and `denominator`, sorted by type). The 16 codes are mirrored in `src/lib/keywords/serp-features.ts`.
- **AI Overview history** `GET .../aio-history`: `from`, `to` (default `last_90d`), at most 1,000 checks, newest first. `AioHistoryItem`: `ai_overview_state` (`absent`, `present_not_cited`, `present_cited`, `not_loaded`, `unknown`), `own_cited`, `own_citation_position`, `competitors_cited: EntityRef[]`, `source_count`, `organic_rank: RankCell`, `serp_snapshot_id`, `observation_id`, `device`, `location_id`. The sources themselves are the `source_urls` of the `ai_overview` feature of that snapshot. There is no route that reads an AI Overview's answer text.
- **Rank events** `GET {P}/seo/rank-events`: newest first, cursor page (`limit` 1 to 200, default 50), `from` and `to` (dates are project local days, timestamps are instants), `filter[event_type_in]` (at most 30 values; an unknown value matches nothing), `filter[tracked_keyword_id]`, `filter[entity_id]`, `filter[group]`, `filter[term]`. Without a keyword filter a request covers at most 90 days (`422 window_too_large` with `limit_days`), with none given the last 90; **with** a keyword filter there is no bound. `RankEventOut`: `rank_event_id`, `event_type` (a plain string in the OpenAPI document), `occurred_at`, `entity`, `other_entity`, `from_rank`, `to_rank`, `from_url`, `to_url`, `feature_type`, `keyword`, `tracked_keyword_id`, `serp_snapshot_id`.
- **The 21 event types** (migration 0013) and when they are written (`ranks/events.py`): a check is compared with the state before it, within the smaller depth of the two; a first check writes none. `entered_top_N` and `lost_top_N` for N in 3, 10, 20, 100 (only the buckets within that depth). `new_ranking` only after at least 2 beyond-depth checks in a row; `lost_ranking` when the run reaches exactly 2 for a keyword that ranked before. `rank_gain` or `rank_drop` for **every** numeric change (thresholds belong to alert rules, so there is no "big move" filter on the server). `url_changed` when the ranking URL changes. `feature_gained` and `feature_lost` for **owned** features (`feature_type` set). `aio_appeared`, `aio_disappeared`, `aio_citation_gained`, `aio_citation_lost`. `overtaken_by` and `overtook` against a competitor (`other_entity`).
- **Permissions in the web app**: `data:read` is held by every role but billing. `useCan('data:read')` shows the no-access state as `RunsScreen` does. `useCan('raw:read')` decides whether the raw download exists on the page at all. `useCan('runs:trigger')` and `useCan('keywords:write')` gate Check now and the keyword actions as in the inspector.
- **Check now**: `useCheckNow` returns `inspectorAction(trackedId, active)` and `progress`; both work with an empty selection, so the page reuses them as they are (Task 3 adds a `presentation` argument).
- **Query keys** follow the path (`src/lib/api/keys.ts`): the detail, `rank-history`, `serp-current`, `serp-snapshots`, `serp-features` and `aio-history` keys all sit under `keywordsKey(scope)` (`[..., 'tracked-keywords', id, ...]`), so `refreshKeywords` after a Check now refreshes them. `GET {P}/serp-snapshots/{id}` and `GET {P}/seo/rank-events` do not, and Task 3 adds them to `refreshKeywords`.

## Decisions

Tables follow the global owner decisions of 2026-10-29: 12 px body text, capital header labels, compact 32 px rows, every column left aligned except the row actions column, all default columns visible at every width with the table scrolling sideways, the identity column resizable. This plan uses `DataTable` (long or sortable lists) and `PlainTable` (short fixed lists of a dozen rows at most) and the type-table tokens; nothing is restyled per screen.

1. **Route.** `/{workspace}/{project}/seo/keywords/{tkId}`, the child of the list page `/seo/keywords` (doc 20 section 3.2 writes `[project]/keywords/[tkId]`; that table is superseded by 11-navigation section 1.1, 16 section 2.7 and 24 section 9.4, which all say `/seo/keywords/[tkId]`). `tkId` is the tracked keyword's uuid; a value that is not a uuid is `notFound()` before any API call (`isUuid`, as `EntityEditorPage` does). The list screen moves into a route group so its layout does not wrap the detail: `seo/keywords/(list)/{layout.tsx,page.tsx,import/page.tsx}` by `git mv`, no URL changes; the detail is `seo/keywords/[tkId]/page.tsx`. `keywordDetailPath(workspace, project, trackedKeywordId)` in `src/lib/routes/paths.ts`. The legacy `/seo/rankings` redirect stays as it is and needs no `[tkId]` twin.
2. **Inspector link.** The existing `Maximize2` "Open page" icon button of `InspectorHeader` gets its handler (`onOpenPage` on `KeywordInspector`, passed by `RankingsScreen` through the same `guarded(...)` it uses for Close and stepping, so unsaved edits are asked about first). It pushes the detail path with `router.push`; Back returns to the list with `?inspect=keyword:{id}` still in the URL, so the inspector reopens (16 section 2.7, History rules, last row). J and K keep stepping the list while the inspector is open; the detail page has no list order, so it defines no J and K. A Cmd or Ctrl click or middle click on a row opens the detail page in a new tab (`window.open(keywordDetailPath(...), '_blank', 'noopener')`), replacing today's "list with the inspector in a new tab"; this follows 12-tables.md section 13 and is Open question 1.
3. **Permissions.** The page needs `data:read` (the API refuses billing with 403): without it the screen shows the no-access state, as `RunsScreen`. Check now needs `runs:trigger`, Archive and Change depth need `keywords:write`, exactly as in the inspector. **The raw answer** is offered only to members with `raw:read` (owner, admin, editor, analyst): for a viewer or billing member the control is absent, not disabled (doc 20 section 3.9). It is a download, never an in-page view (Facts); `410`, `503`, `403` and `404` each get their own sentence.
4. **URL state** (13-filters-search.md section 5 keys; the T3 template names `tab`, `win`, `cmp`, `obs`, `vs`, `stats`). All through one `nuqs` parser set in `keyword-detail/detail-url-state.ts`, defaults omitted:

   | Key | Meaning | Default | History |
   |---|---|---|---|
   | `tab` | `overview` or `snapshots` | `overview` | push |
   | `win` | `7d`, `30d`, `90d`, `180d`, `365d`: the window of the chart, the strip and the AI Overview history | `90d` | replace |
   | `comp` | The chart's competitor overlays, entity uuids, at most 5 (9.4: "Competitor overlays limited to 5") | the first 5 effective competitors by name | replace |
   | `show` | Chart layers on top of Organic: `absolute`, `events`, `deep` | none | replace |
   | `events` | Event kind filter of the feed (`rank,url,serp_feature,ai_citation,competitor`) | all | replace |
   | `obs` | The SERP snapshot shown (a snapshot id); absent means the latest check | absent | push |
   | `vs` | The snapshot it is compared with | absent | push |

   `obs` and `vs` keep the meaning the key table gives them (an observation and its comparison); on this page the observation is a SERP snapshot. `comp`, `show` and the `events` kinds are new rows of the key table (Task 13). The page never uses `inspect`.
5. **Tabs.** Overview and SERP snapshots only (24 section 9.4 "Tabs, justified"). Diagnostics is Phase 15 and has no routes. Everything else (competitor ranks, features, AI Overview history, events) is a section of Overview.
6. **Page anatomy** (24 section 9.4, with what the API can serve):

   ```text
   DetailPageHeader   back link "Keywords", h1 keyword, facts, state badges        [Open ranking page] [More] [Check now]
   MetricStrip md     Rank | Best rank | Average rank | Days in top 10 | Volume | AI Overview            (Task 5)
   Tabs               Overview | SERP snapshots                                                           (Task 3)
   Overview
     Evidence col 8/12                                         Right rail 4/12
     Rank history chart 240 px (Task 4, events Task 9)         SERP features, last 30 checks (Task 8)
     Target and ranking URL (Task 10)                          Events feed (Task 9)
     Competitor ranks (Task 10)
     AI Overview history (Task 11)
   SERP snapshots
     Snapshot picker + compare (Tasks 6, 7, 12), results table, features of the snapshot, raw download (Task 7)
   ```
7. **Snapshot picker is a list, not a calendar.** `DatePicker` is "Later" in the inventory and a calendar would offer days that have no snapshot. A `Select` lists the snapshots the API returned (newest first, "Oct 29, 02:00, top 20, rank 3"), with Previous and Next snapshot buttons. The first entry is "Latest check", served by `serp-current`; choosing the snapshot whose id equals `serp-current`'s id clears `obs`.
8. **Chart reuse.** `rank-history-model.ts` moves to `src/features/rankings/rank-history/` and the card's logic (summary sentence, band sentences, failed glyphs, meta line, `extendOption`) moves into the hook `useRankHistoryChart`. The inspector card and the page chart are two thin callers of the same hook and `ChartFrame`; nothing is copied.
9. **One state model for all sections.** `detailStateOf(state, isActive)` (Task 3) returns `archived`, `pending` (never checked), `failed`, `stale` or `live`, plus `failing`. Every section reads it, so a stale keyword says the same thing in the header, the strip and each panel, and a pending keyword shows the same "No checks yet" reason everywhere.
10. **"Big moves".** The API writes `rank_gain` and `rank_drop` for every numeric change and has no size filter, so the feed filters by event kind, not by size. Rank moves are a kind of their own inside `rank` and are shown, newest first, like every other event.
11. **Mock first, one world.** Every route is mocked from the same pure functions of `(trackedId, createdAt, now)` in `src/mocks/serp-world.ts`, built on the existing `checksOf` walk: nothing is stored, so the mock cookie budget in `keywords-codec.ts` does not grow. The mocks keep the real API's validation, filters, cursor binding and permissions (Task 2 lists them).
12. **Refresh.** `refreshKeywords` also invalidates `['ws', W, 'p', P, 'seo', 'rank-events']` and `['ws', W, 'p', P, 'serp-snapshots']`, so a finished Check now refreshes the whole page.

## Executor rules and definition of done

These are the lessons of the last reviews; a review finding that repeats one of them is a defect of the task, not a new finding.

1. **Stop after every task.** Implement, run the gates, commit locally (unpushed), then **stop and report**. Do not start the next task. The lead dispatches an independent review on the **Sonnet** model (never Opus or Fable) with the task section and the diff; its findings come back; fix each with its test first, run every gate again, and amend the task's commit (`git commit --amend --no-edit`; the branch is unpushed) so each task stays one reviewable commit. The builder never reviews its own work and never writes "reviewed".
2. **Honesty in the paper trail.** Tick a plan step only if you ran the command in this session and show its output. Write an as-built note only from a command output or a diff you show. Do not claim a gate you did not run. If a gate cannot run, say which and why.
3. **Tests must fail when the behaviour is wrong.** No `if (found)` around an assertion; assert that the element exists first, then its content. No class-name-only assertions: assert accessible names, roles and text (`getByRole(..., { name })`), not attributes or classes. No vacuous counters (a count of 0 passes a `<=` check): assert the expected number. Pure functions get a case per branch, including the empty case. A test written after the code must be shown to fail against a deliberately broken implementation at least once (say so in the report).
4. **No hardcoded English.** Every visible string is a message key in `messages/en.json` under `keywordDetail` (or the shared namespaces named in the task), ICU plurals for counts, and every number, date, time and relative time goes through `@/lib/format` (locale aware). Pure models return codes, never sentences. Accessible names are messages too.
5. **Honest states.** Pending (never checked), failed, stale, loading, error and empty are different and are worded the same everywhere (Decision 9). An error never looks like an empty list; an empty list never looks like loading; a stale value says it is stale and when it was last good. A section whose route failed shows its own retry and does not blank the others.
6. **Alternatives with real numbers.** Every chart has the summary sentence with the actual figures (first, last, best, count of checks, count hidden) and a table view; the features grid has a table view; colour is never the only signal (marker shapes, text, hatching).
7. **Keyboard and focus.** Every new control is reachable by Tab in a sensible order, operable with Enter or Space, shows the focus ring, and has an accessible name. A control that opens something returns focus where it came from. New tab keyboard: arrow keys move between tabs (the existing `Tabs`). Verify by tests that press keys, not only by reading code.
8. **Layout claims are checked in a real browser.** For every task that lays out something new, the e2e test measures bounding boxes (rail beside evidence at 1440 px, stacked at 1024 px, no horizontal page scroll at 390 px) and the builder saves screenshots at 1440, 1280, 1024 and 390 px under `test-results/` and lists their paths in the report. jsdom cannot show layout; do not claim it from jsdom.
9. **Do not weaken what exists.** Existing tests are not loosened, skipped or deleted to go green; if a test pins behaviour this plan changes on purpose (the mock's `average_rank: null`, a competitor rank, a Cmd click), change the expectation to the new correct value and say so in the report. Do not raise a timeout. Do not add a dependency; if one is needed, stop and ask.
10. **No dashes.** No em dash and no en dash anywhere (code, comments, copy, docs, commit messages): `LC_ALL=C grep -rnP "\xE2\x80[\x93\x94]" <changed files>` prints nothing. Number ranges are written "5 to 10". No attribution lines in commits. Short imperative subject, a body that says why.
11. **Blocked means blocked.** If a section needs a backend field that does not exist, mark the task step blocked with the exact request (see "Backend requests") and build nothing that fakes it.
12. **Gates before every commit** (all in `apps/web`, outputs shown): `pnpm lint`; `pnpm exec tsc --noEmit` (after `pnpm exec next typegen` whenever a route file moves or is added); `pnpm format:check`; `pnpm vitest run <the folders the task touched>`; `pnpm build`; `pnpm e2e e2e/flows/rankings.spec.ts e2e/flows/keyword-detail.spec.ts` (the second file exists from Task 3). **Task 13** also runs the full `pnpm test`, `NEXT_PUBLIC_API_MOCKING=off pnpm build` and the whole `pnpm e2e`.

## Task list

| # | Task | Status | Mock reference (`apps/web/design-preview/`) |
|---|---|---|---|
| 1 | Mock rank world: snapshot ids, per check features and AI Overview, URL changes, placed competitor ranks, rank history upgrade | Unblocked | none (data only) |
| 2 | Mock rank events and the SERP routes (current, snapshots, snapshot, raw, features, AI Overview history) | Unblocked | none (data only) |
| 3 | Route, page shell, `DetailPageHeader`, tabs, "Open page" and Cmd click, states | Unblocked | `perf-detail.js` header (lines 40 to 60), `kw-inspector.js` header |
| 4 | Rank history chart on the page: shared hook, window, competitors, absolute, deep checks | Unblocked | `index.html` History panel (783 to 797), `charts.js` `hatch()` (145) |
| 5 | Metric strip (six cells) | Unblocked | `customize.js` `NUMBER_DATA` `seo.*` (133 to 143) |
| 6 | SERP snapshots tab: latest results, snapshot picker, results table | Unblocked | none; table look: `kw-table.js` |
| 7 | Snapshot detail: provenance, features in the snapshot, AI Overview sources, ranking URL changes, controlled raw download | Unblocked | none |
| 8 | SERP features strip (`Heatmap`) in the rail | Unblocked | `index.html` "SERP features" card (498) |
| 9 | Rank events feed (`EventTimeline`) and the chart's event strip | Unblocked | `perf-detail.js` "What changed" (241) |
| 10 | Target and ranking URL panel; competitor ranks panel | Unblocked | none |
| 11 | AI Overview history | Unblocked | `prompts-parts.js` `keywordRow` (cited badge) |
| 12 | Compare two snapshots | Unblocked | none |
| 13 | End to end, responsive and accessibility checks, documents, whole-branch review | After 1 to 12 | none |

### Mock versus docs and API (which wins)

| Topic | Source A | Source B | Winner |
|---|---|---|---|
| Route | Doc 20 3.2 `keywords/[tkId]` under the project | 11, 16, 24 `/seo/keywords/[tkId]` and the live registry | 11, 16, 24 |
| Quick view | Doc 20 3.2 intercepting drawer | 16 section 2.7: `?inspect=` plus "Open page" | 16 |
| Competitor ranks "30 days ago" | 24 9.4 table of competing domains | The API has the **tracked** competitors' history, not every domain's | The API: the panel shows tracked competitors from the rank history; every domain of one check is in the SERP viewer |
| "URL stability 0.93" | 24 9.4 | No defined formula and no field | Not shown; the panel counts URL changes in the window instead |
| Days in top 10 | 24 9.4 strip | No API field | Computed from the rank history series of the window, labelled with its denominator |
| Volatility, "possible causes", cannibalization | Doc 20 5.4 | No data or route | Not in this plan |
| Raw payload | 20 section 4.9: "Raw mode ... fetched on open" | The raw route returns an attachment of untrusted size | Download only (Decision 3) |
| Compare with RBO distance | 24 9.4 | No route; a metric definition the owner has not fixed | Moved, new and dropped markers only (Task 12) |

## File structure

| File | Responsibility |
|---|---|
| Create `src/mocks/serp-world.ts` (+ test) | Snapshot ids, per check features and AI Overview, URL path walk, placed competitor ranks, the SERP of a check (pure) |
| Create `src/mocks/rank-events.ts` (+ test) | The TypeScript port of `own_events` and `overtake_events` over the mock checks (pure) |
| Create `src/mocks/handlers/rank-events.ts`, `handlers/serp.ts` (+ tests) | The seven new routes |
| Modify `src/mocks/rank-state.ts`, `rank-history.ts`, `handlers/rank-history.ts`, `factories/keyword.ts`, `respond.ts`, `handlers/index.ts`, `src/test/api-shapes.ts` (+ tests) | The upgraded world and history route; problem codes |
| Move `src/app/[workspace]/[project]/seo/keywords/{layout,page}.tsx`, `import/page.tsx` into `(list)/` ; Create `.../keywords/[tkId]/page.tsx` (+ test) | The route |
| Create `src/features/rankings/keyword-detail/*` | The screen, header, tabs, panels, models and queries (listed per task) |
| Create `src/features/rankings/rank-history/{rank-history-model.ts,use-rank-history-chart.ts}` (+ tests) | The shared chart logic (moved and extracted) |
| Create `src/components/app/shell/detail-page-header.tsx`, `components/app/status/event-timeline.tsx`, `components/app/chart/heatmap.tsx` (+ tests) | The three missing design system components |
| Modify `src/lib/routes/paths.ts`, `src/features/rankings/{index.ts,rankings-screen.tsx,rankings-queries.ts}`, `keyword-inspector/{keyword-inspector.tsx,inspector-queries.ts,rank-history-section.tsx,demand-section.tsx}`, `check-now/use-check-now.tsx`, `src/lib/charts/rank-chart.ts`, `src/lib/api/types.ts`, `messages/en.json` | Wiring |
| Create `e2e/flows/keyword-detail.spec.ts`; modify `e2e/flows/rankings.spec.ts`, `e2e/visual/pages.spec.ts` | Flows |
| Modify `docs/20-frontend-specification.md` (5.4 as built), `docs/design-system/{13-filters-search,24-page-templates,25-component-inventory}.md`, `docs/31-implementation-checklist.md`, `docs/review-log.md`, `docs/superpowers/plans/2026-10-29-rank-features-ui.md` (a pointer) | Documents (Task 13) |

---

### Task 1: Mock rank world v2

**Why first.** Every later task reads from this world. The current mock cannot show a snapshot (every history point has `serp_snapshot_id: null`), a URL change (the path never changes), a feature or AI Overview that comes and goes (both are constants per keyword), or a SERP that is possible (two entities can hold the same rank). It also differs from the API in ways that would make a UI test pass for the wrong reason: the real `summary.checks` is `ranked + beyond` and **excludes** failed checks (`history.py` `summary_of`), the mock counts them; real bands exist for every entity and split a run when the depth changes, the mock draws own bands at the run's smallest depth; the mock accepts `last_14d`, the API answers `422 invalid_window`.

**Files:**
- Create: `apps/web/src/mocks/serp-world.ts`, `apps/web/src/mocks/serp-world.test.ts`
- Modify: `apps/web/src/mocks/rank-history.ts` (+ `rank-history.test.ts`), `apps/web/src/mocks/rank-state.ts` (+ `rank-state.test.ts`), `apps/web/src/mocks/factories/keyword.ts`, `apps/web/src/mocks/handlers/rank-history.ts` (+ `handlers/rank-history.test.ts`), `apps/web/src/mocks/respond.ts` (problem `window_too_large`, 422), `apps/web/src/test/api-shapes.ts`, `apps/web/src/lib/api/types.ts`, `apps/web/src/features/rankings/keyword-inspector/rank-history-model.ts` and `rank-history-section.tsx` (+ their tests; Step 9)

**Mock reference:** none. This is data. The semantics to copy are the backend's: `backend/src/idraft/api/ranks/history.py` (`point_of`, `series_points`, `bands_of`, `summary_of`) and `service.py` `rank_history`.

- [x] **Step 1: Pin what must not move.** Add to `src/mocks/rank-history.test.ts` a test "keeps the rank and depth of every existing check" with the `(rank, depth)` pairs of the last 10 checks of three fixture keywords at `NOW = Date.parse('2026-11-02T12:00:00Z')`. Get the constants by running the **unchanged** code once in a throwaway test with `console.log`, paste them, delete the log, and show the passing run. Later steps may change paths, features and competitor ranks, never these, because other tests, the list and the e2e depend on them.
- [x] **Step 2: URL walk test first** (`rank-history.test.ts`):

```ts
describe('ranking URL walk', () => {
  it('changes the ranking path of some keywords every 17 to 29 days and of the rest never', () => {
    const changing = MOCK_TRACKED_KEYWORDS.filter((row) => {
      const paths = checksOf(row.tracked_keyword_id, row.created_at, NOW).flatMap((c) => (c.path === null ? [] : [c.path]));
      return new Set(paths).size > 1;
    });
    expect(changing.length).toBeGreaterThan(0);
    expect(changing.length).toBeLessThan(MOCK_TRACKED_KEYWORDS.length / 2);
  });

  it('gives a check the same path whatever the clock says', () => {
    let compared = 0;
    for (const row of MOCK_TRACKED_KEYWORDS.slice(0, 40)) {
      const early = checksOf(row.tracked_keyword_id, row.created_at, NOW);
      const later = checksOf(row.tracked_keyword_id, row.created_at, NOW + 3 * 86_400_000);
      for (const check of early) {
        const same = later.find((candidate) => candidate.observedAt === check.observedAt);
        if (same === undefined) continue; // slid out of the last 30
        expect(same.path).toBe(check.path);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(40 * 20);
  });
});
```

  Run: FAIL (no keyword changes path). **Implement** in `rank-history.ts`: a second stream `const urls = seeded(`${trackedId}:url`)` (it must **not** draw from the walk's stream, or every rank would move: Step 1 proves it), `changes = hashOf(`${trackedId}:url:changes`) % 3 === 0`, `period = 17 + (hashOf(`${trackedId}:url:period`) % 13)` days, `alternate` another entry of `PATHS`, and `pathAt(time) = changes && Math.floor(time / (period * DAY_MS)) % 2 === 1 ? alternate : path` (time-keyed, so a check never changes when the clock moves). Set `MockCheck.path` from it. Run: PASS, and Step 1's test still passes.
- [x] **Step 3: World tests first** (`serp-world.test.ts`). The world is a set of pure functions of `(trackedId, observedAt)`; no state:

```ts
import { describe, expect, it } from 'vitest';

import { MOCK_TRACKED_KEYWORDS } from './keyword-fixtures';
import { checksAt, rankStateOf } from './rank-state';
import { aioAt, featuresAt, placeRanks, snapshotIdOf } from './serp-world';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const DOMAIN = 'fynix.digital';
/** The fixture keywords that have checks (the pending and failed fixtures have none), with those checks. */
const CHECKED = MOCK_TRACKED_KEYWORDS.slice(0, 60).flatMap((row) => {
  const checks = checksAt(row.tracked_keyword_id, row.created_at, NOW, DOMAIN);
  return checks.length === 0 ? [] : [{ row, checks }];
});

describe('snapshotIdOf', () => {
  it('is a positive decimal text, the same for the same check, and unique across every fixture check', () => {
    const ids = CHECKED.flatMap(({ row, checks }) => checks.map((c) => snapshotIdOf(row.tracked_keyword_id, c.observedAt)));
    expect(CHECKED.length).toBeGreaterThan(50);
    expect(ids.length).toBeGreaterThan(50 * 20);
    for (const id of ids) expect(id).toMatch(/^[1-9]\d{0,9}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('features and AI Overview per check', () => {
  it('make the list state of a keyword the state of its latest check', () => {
    for (const { row, checks } of CHECKED) {
      const latest = checks[checks.length - 1];
      expect(latest).toBeDefined();
      const state = rankStateOf(row.tracked_keyword_id, row.created_at, NOW, DOMAIN);
      const features = featuresAt(row.tracked_keyword_id, latest?.observedAt ?? '', latest?.rank !== null);
      expect(new Set(state.feature_types_present)).toEqual(new Set(features.map((f) => f.type)));
      expect(new Set(state.owned_feature_types)).toEqual(new Set(features.filter((f) => f.owned).map((f) => f.type)));
      expect(state.aio.state).toBe(aioAt(row.tracked_keyword_id, latest?.observedAt ?? '').state);
    }
  });

  it('flicker: some features and AI Overview states change between checks, but not every check', () => {
    let featureFlips = 0;
    let aioFlips = 0;
    let transitions = 0;
    for (const { row, checks } of CHECKED) {
      checks.slice(1).forEach((cur, i) => {
        const prev = checks[i];
        expect(prev).toBeDefined();
        const id = row.tracked_keyword_id;
        const types = (c: typeof cur): string => featuresAt(id, c.observedAt, c.rank !== null).map((f) => f.type).join();
        transitions += 1;
        if (prev !== undefined && types(prev) !== types(cur)) featureFlips += 1;
        if (prev !== undefined && aioAt(id, prev.observedAt).state !== aioAt(id, cur.observedAt).state) aioFlips += 1;
      });
    }
    expect(transitions).toBeGreaterThan(50 * 20);
    expect(featureFlips).toBeGreaterThan(0);
    expect(aioFlips).toBeGreaterThan(0);
    expect(featureFlips).toBeLessThan(transitions / 2);
    expect(aioFlips).toBeLessThan(transitions / 2);
  });
});

describe('placeRanks', () => {
  it('keeps the own rank and gives each competitor a free rank at or below its walk, within the depth', () => {
    const placed = placeRanks({ own: 3, depth: 20, walks: [['a', 3], ['b', 3], ['c', 4], ['d', null], ['e', 25]] });
    expect([...placed]).toEqual([['a', 4], ['b', 5], ['c', 6], ['d', null], ['e', null]]);
  });

  it('puts a competitor beyond the depth when the free rank would pass it', () => {
    expect(placeRanks({ own: 20, depth: 20, walks: [['a', 20]] }).get('a')).toBeNull();
  });

  it('reserves nothing for an own site that does not rank', () => {
    expect(placeRanks({ own: null, depth: 20, walks: [['a', 3]] }).get('a')).toBe(3);
  });
});
```

  `CHECKED` is built once and its size is asserted, so no test passes because a keyword had nothing to compare. If two snapshot ids collide in the first test, lengthen the hash input (never loosen the uniqueness check). Run: FAIL (module missing).
- [x] **Step 4: Implement `serp-world.ts`.** Exports (all pure, no `Date.now()`, no storage):
  - `snapshotIdOf(trackedId, observedAt): string` = `String(hashOf(`${trackedId}:${observedAt}`) + 1)`, the formula `rankStateOf` already uses for `current.serp_snapshot_id`, now in one place.
  - `featuresAt(trackedId, observedAt, ownRanked): FeatureAt[]` where `FeatureAt = { type: string; owned: boolean; ordinal: number; positionAbsolute: number }`. The keyword's usual set is the six features of the existing `featuresOf(trackedId)` bits (`FEATURES` in `rank-state.ts`; move both here). With `h = hashOf(`${trackedId}:flip:${type}:${observedAt}`)`, a usual feature is present at a check unless `h % 6 === 0` and an unusual one is present only when `h % 12 === 1`, so about one check in six flips each way. `ai_overview` is present exactly when `aioAt(...)` shows a block (`present_cited`, `present_not_cited`, `not_loaded`). A feature is owned when the own site ranks at the check, the type is ownable (`OWNABLE_FEATURE_TYPES`) and `(hashOf(`${trackedId}:owned:${type}`) % 4 === 0) !== (hashOf(`${trackedId}:oflip:${type}:${observedAt}`) % 8 === 0)`; `ai_overview` is owned when its state is `present_cited` and the own site ranks, as `rankStateOf` has it today. Keying every hash by `observedAt` means a past check never changes when a new one arrives, and the list state, read from the latest check, simply moves with each new check.
  - `aioAt(trackedId, observedAt): { state: AioStateInfo['state']; position: number | null; sources: number }`: the keyword's usual state from the existing `aioOf` roll; a keyword whose roll is `unknown` stays `unknown`; otherwise one check in five takes another of `absent`, `present_not_cited`, `present_cited` by hash, and one in 25 of the present ones is `not_loaded`. `position` is `(hash % 5) + 1` for `present_cited`, `sources` is `3 + hash % 8` when a block is present, 0 otherwise.
  - `placeRanks({ own, depth, walks })` as the test states (walks in a fixed order, callers sort by entity id).
  - `worldChecks(input): WorldCheck[]` with `input = { trackedId, createdAt, now, domain, stoppedAt, own: EntityRef, competitors: EntityRef[] }`: the keyword's `checksAt` list, each check with `snapshotId`, `rank`, `depth`, `path`, `features`, `aio`, and the **placed** competitor ranks (a competitor's walk rank, read at the check's `observedAt`, is null when it is beyond the check's depth, then goes through `placeRanks`; a check with no walk entry, the mock's manual check, repeats the previous placed rank). It also gives `depthReturned` (equal to `depth`, one check in 12 returns `depth - 1`, to exercise "returned fewer than requested").
  - `serpOf(check, context): SerpItem[]` for ranks `1` to `depthReturned`: the own site at its rank, each placed competitor at its rank (hosts from the project's entity domains), every other rank a third-party host from a pool of 40 (never a host already used in this SERP), path `/{hash base 36}`. `SerpItem = { rank, host, path, entity: EntityRef | null }`. Titles and snippets are not part of it: `titleOf(item, keyword)` returns `{ title, snippet }` for the rows a route may title (Task 2).
  Run `pnpm vitest run src/mocks/serp-world.test.ts`: PASS. Add tests for `serpOf`: ranks are exactly `1..depthReturned` without gap or duplicate; the own site is at its rank and absent when it does not rank; a competitor is at its placed rank; no two items share a canonical URL.
- [x] **Step 5: Wire `rank-state.ts` (tests first).** `rankStateOf` takes `feature_types_present`, `owned_feature_types` and `aio` from the latest check through `featuresAt` and `aioAt`; `current.serp_snapshot_id` uses `snapshotIdOf`; `url_changed_at` is the `observedAt` of the latest check whose ranking path differs from the previous ranked check's (null when none). Update `rank-state.test.ts`: the existing "uses only the feature codes the backend knows" test stays as it is; add "`url_changed_at` is set for exactly the keywords whose path changed in their last 30 checks" and "`ranking_url_count` and `current.url` use the latest check's path". Where a test pinned a feature or AI Overview value of a fixture keyword, replace the pinned value with the one read from `featuresAt` and say so in the report; do not loosen a comparison.
- [x] **Step 6: Placed competitor ranks (tests first).** In `rank-state.test.ts`: for 60 fixtures with at least 2 effective competitors, at every check no two entities (own included) share a rank, every competitor rank is null or at most the check's depth, and a competitor's `depth` equals the own check's. Replace `competitorChecksOf` and `competitorRankOf` by the world's placed ranks (`worldChecks`), and update their two callers: `handlers/rank-history.ts` and `factories/keyword.ts` (`competitor_ranks`). Their output now ends where the own checks end (a stale keyword's competitors stop too). Two overlays that today live only in `handlers/rank-history.ts` make the history disagree with the list, and with the snapshots once those exist, so they move into the world and every route reads them from there: (a) the same-day extra check the handler adds for `CHECKED_FIXTURES[0]` (12 hours after its last check, one place better) becomes a real check in `worldChecks`, so the list, the history, the snapshots, the features and the events all have it, and the existing handler test that expects a same-day pair keeps passing; (b) the two failed points the handler paints on the last two checks of a failing keyword become failed **attempts** in `worldChecks` (`failed: true`, rank null, no snapshot, no feature row, no AI Overview item, no event), at the times of the last `FAILING_RUN` walk checks, which `checksAt` then leaves out of the good checks, so the list's `current` is the latest good check and `consecutive_failures` stays as it is. A failed attempt is a point in **every** series of the history, as the API's are. Show the before and after list state of those two fixtures in the report.
- [x] **Step 7: Rank history handler to the real semantics (tests first).** In `handlers/rank-history.test.ts` add, then make pass:
  1. `summary.checks` equals `ranked_checks + beyond_depth_checks` and excludes failed checks; for the failing fixture `failed_checks` is 2 and `checks` is the remaining count; for the all-failed fixture `checks` is 0 and `failed_checks` is 3. (This changes the existing assertion that `ranked + beyond = checks` with the failed fixtures; update the failed fixture expectations to the API's rule and say so.)
  2. `summary.average_rank` is a `MetricValue` with `metric: 'seo.average_rank'`, `unit: 'rank'`, `value` the mean of the own ranked ranks, `numerator` their sum, `denominator` their count, `n_observations` ranked plus beyond, `window` the answer's window; `null` when nothing ranked. Replace the existing `toBeNull()` assertion by this.
  3. Every non-failed point of every series has `serp_snapshot_id` equal to `snapshotIdOf(trackedId, observed_at)`, the same on the own and competitor points of one check; failed points have none and appear in every series, as the API's `failed_checks` are per keyword.
  4. `include=url` fills `url_id` of ranked points and `urls` (key `url_id`, value a `UrlRef`, the own host and the competitor's); `include=absolute` fills `absolute_rank` (`rank` plus the number of features above the organic results at that check, at most 2 as `rankStateOf` does) of ranked points; without them `url_id`, `absolute_rank` are null and `urls` is `{}`. `include=events` is accepted and answers `events: []` until Task 2 fills it; an unknown include value is `422`.
  5. `window` is one of `last_7d`, `last_30d`, `last_90d`, `last_180d`, `last_365d`, else `422 invalid_window` at `window`; `from` and `to` (dates) win over `window`; `from` after `to` is `422 range_invalid` at `from`; more than 400 days is `422 window_too_large` with `limit_days: 400`; the answer's `window` is the first and last local day.
  6. `entity_ids` selects and orders the series (`own` is the primary own entity); more than 11 is `422 too_many_entities` at `entity_ids`; an id that is not an entity of the project is dropped, as `rank_history` drops it.
  7. `bands` exist for **every** returned entity, and a run of beyond-depth points ends when the depth changes; the label is `not in top {depth}`.
  Implement. The scenario cookie `mock_rank_history` keeps working for the inspector's tests; give its fixtures the same summary rule.
- [x] **Step 8: Shapes and types.** `src/test/api-shapes.ts`: widen `RANK_HISTORY` (`events` nullable array of `HistoryEvent`, `urls` a record of `UrlRef`, `average_rank` a `MetricValue` or null). `src/lib/api/types.ts`: export `HistoryEvent`, `HistoryBand`, `HistorySeries`, `HistoryPoint`, `SerpCurrent`, `SerpResult`, `SerpSnapshotSummary`, `SerpSnapshotDetail`, `SerpOrganicItem`, `SerpFeatureOut`, `SerpFeatureHistory`, `FeatureCheck`, `FeaturePresence`, `AioHistoryItem`, `RankEventOut`, `SerpProvenance`, so the app names them in one file.
- [x] **Step 9: The inspector card under the API's rule.** With `checks` excluding failed checks, a keyword whose every check failed has `summary.checks === 0` and `failed_checks > 0`. `rankHistoryChart` sets `empty: summary.checks === 0` and `RankHistorySection` derives its all-failed sentence from `checks > 0 && failed === checks`, so against the API the card would say "No checks yet" for a keyword whose checks all failed. Write the failing test first in `rank-history-model.test.ts` (`empty` is true only when `checks + failed_checks === 0`; an all-failed history is not empty and is flagged all-failed when `checks === 0 && failed_checks > 0`), correct any fixture in `rank-history-model.test.ts` or `keyword-inspector.test.tsx` that counts failed checks inside `checks`, then fix the model and the section. This is a real defect the old mock hid; say so in the report.
- [x] **Step 10: Gates** (rule 12; unit scope `pnpm vitest run src/mocks src/test src/features/rankings`). The rankings e2e must stay green.
- [x] **Step 11: Commit** `git commit -m "Mocks: a rank world with snapshots, URL changes and per check features"`, then **stop and report** (rule 1).
- [ ] **Step 12 (lead, not the builder): independent review on Sonnet** with this task's section and the diff, fixes with their tests first, every gate again, `git commit --amend --no-edit`.
- **As-built facts and known mock differences**:
  - `include`/`format` errors use `value_error` and `entity_ids` uses `invalid_uuid` (the backend gives `literal_error` / `string_pattern_mismatch`).
  - An entity id that has a role in the project but is outside the keyword's effective set is accepted and gets all-null ranks.
  - The window-422 test lost its `code === 'validation_failed'` assertion and now expects `invalid_window`.
  - The `not_loaded` expectation in `rank-state.test.ts` was broadened.
  - In the e2e `rankings.spec.ts`, the Updated header is present at all widths and Pending is 4 at one viewport (was 3).
  - In the e2e `rankings.spec.ts`, 1280 px keyword column room was adjusted from 250 to 200.
  - In `rankings.test.tsx`, sparkline "from 19 to 12" became "from 18 to 10" (full string "from 18 to 10, best 8, 1 check beyond the depth checked") and in `rank-strip.test.tsx`, Top 20 "28" became "26", both now pinned to 2026-11-02T12:00:00Z (the old numbers were the real-clock snapshot of an earlier day).
  - `playwright.config.ts` reads `E2E_PORT`.
  - `costs.ts` `today()` uses `Date.now()`.
  - The manual check store lives in serp-world.ts because checksAt needs it and rank-state may not be imported by it (deviation from Step 4 stating the world is pure with no storage).
  - In serp-world.ts, OWN_ENTITY_REF uses canonical_name 'own' as a stable identifier, whereas the real API returns the project's own entity name ('Fynix' in the fixtures).

---

### Task 2: Mock rank events and the SERP routes

**Files:**
- Create: `apps/web/src/mocks/rank-events.ts`, `rank-events.test.ts`, `apps/web/src/mocks/handlers/rank-events.ts`, `handlers/rank-events.test.ts`, `apps/web/src/mocks/handlers/serp.ts`, `handlers/serp.test.ts`
- Modify: `apps/web/src/mocks/handlers/index.ts`, `handlers/rank-history.ts` (events), `apps/web/src/mocks/respond.ts` (problems `raw_expired` 410 and `raw_unavailable` 503; `window_too_large` came with Task 1), `apps/web/src/test/api-shapes.ts`

**Mock reference:** none. Contract: `ranks/routes.py` and `service.py`.

- [x] **Step 1: Event rules test first** (`rank-events.test.ts`). `rankEventsOf(checks: readonly EventCheck[]): WorldEvent[]` is a port of `own_events` and `overtake_events` (`backend/src/idraft/ranks/events.py`), same order within a check (top events by bucket, ranking events, movement events, feature events, AI Overview events, then overtakes). Build `EventCheck`s by hand in the tests:

```ts
const check = (rank: number | null, depth = 20, extra: Partial<EventCheck> = {}): EventCheck => ({
  observedAt: `2026-10-${String(1 + counter++).padStart(2, '0')}T02:00:00.000Z`, rank, depth, path: '/a',
  ownedFeatures: [], aio: 'absent', aioCited: null, competitors: new Map(), ...extra,
});
```

  Cases, each a test with exact expected `(type, fromRank, toRank)` lists: a first check writes nothing; 25 to 8 at depth 100 writes `entered_top_10`, `entered_top_20` (top 100 held before) and `rank_gain`; 8 to 12 writes `lost_top_10` and `rank_drop`; at depth 20, 8 to 12 compares within 20 and the top 100 bucket is skipped; a depth drop (previous depth 100 rank 60, now depth 20 beyond) writes nothing for ranks below 20 (smaller depth); `new_ranking` only after two beyond-depth checks and not after one; `lost_ranking` exactly when the run reaches 2 for a keyword that ranked before and not again at 3; a path change writes `url_changed` after the movement events; an owned feature appearing writes `feature_gained` with the code in `featureType`, an unowned one nothing; `aio_appeared` and `aio_citation_gained` only when the comparison holds in both checks (`aioCited` null means unknown, no event); a competitor passing the own site writes `overtaken_by` with its entity as `otherEntityId`, the own site passing it `overtook`, and a pair that is out of the depth in both checks writes nothing. Run: FAIL.
- [x] **Step 2: Implement `rank-events.ts`** with `changeOf` from `rank-state.ts` for the comparison kind, `TOP_BUCKETS = [3, 10, 20, 100]` and `DEBOUNCE_CHECKS = 2` as constants named as in the backend. Each event gets `id = String(hashOf(`${trackedId}:${observedAt}:${type}:${other ?? feature ?? ''}`) + 1)`, `occurredAt = observedAt` and the check's `snapshotId`. `worldEvents(input)` maps `worldChecks` to `EventCheck`s and returns events oldest first; the handler sorts newest first with the id as tiebreaker. The mock keeps 30 checks, so it has at most 30 checks of events; the handler's comment says so. Run: PASS.
- [x] **Step 3: Route tests first** (`handlers/rank-events.test.ts`, through `mockBrowser`, answers read through zod shapes `RANK_EVENT_PAGE`, `RANK_HISTORY` added to `api-shapes.ts`):
  1. `GET {P}/seo/rank-events?filter[tracked_keyword_id]=<id>` answers that keyword's events newest first with `entity.role === 'own'`, `keyword` its text, a `serp_snapshot_id` that is one of `rank-history`'s, and `from_url` and `to_url` `UrlRef`s on `url_changed` rows.
  2. `filter[event_type_in]=url_changed,entered_top_10` returns only those; an unknown type returns an empty page (not an error).
  3. `limit=2` pages with `next_cursor`; following it gives the next two with no overlap; a cursor reused with another filter is `400 invalid_cursor`; `limit=0` and `limit=201` are `422`.
  4. `from`/`to` as dates are project local days with `to` included; as timestamps they are instants.
  5. Without `filter[tracked_keyword_id]` a window above 90 days is `422 window_too_large` with `limit_days: 90`, none given covers the last 90 days; with the keyword filter there is no bound.
  6. A viewer reads (`data:read`); a billing member gets `403`; an unknown keyword uuid filter returns an empty page, as a filter on a keyword that has no events does.
  7. `include=events` on `rank-history` fills `events` with `HistoryEvent`s of the window and the returned entities only (`rank_event_id`, `occurred_at`, `event_type`, `entity_id`, `from_rank`, `to_rank`).
  Run: FAIL. **Implement** `handlers/rank-events.ts` using `keywordProjectCaller`, `pageRequest`, `cursorPage` (offset cursors bound to the filters string) and `queryError`; fill `events` in `handlers/rank-history.ts`; register in `index.ts`. PASS.
- [x] **Step 4: SERP route tests first** (`handlers/serp.test.ts`). For a fixture keyword with a check and for the pending and failed fixtures:
  - **serp-current**: 20 results at ranks 1 to 20, titles and snippets present, `entity` set on the own site and the placed competitors (their `role`), `serp_snapshot_id` and `observed_at` equal to the list state's `current.serp_snapshot_id` and `observed_at`; the pending keyword answers `{ serp_snapshot_id: null, observed_at: null, results: [] }`; `404` for an unknown keyword; the own rank in the SERP equals `state.current.rank`.
  - **serp-snapshots**: newest first, `limit`/cursor/`invalid_cursor` as above; `from`/`to` are local days included; `filter[depth_requested]` outside 1 to 700 is `422`; `filter[has_ai_overview]=true` keeps only snapshots whose `ai_overview_state` is `present*`; each row's `own` is the same `RankCell` the history point of that check implies; `observed_date` is the project-local date; the newest row's id equals `serp-current`'s.
  - **serp-snapshots/{id}**: `include=titles` gives titles for the own site, the placed competitors and, for the **latest** snapshot, all 20 top rows (`titles_source: 'serp_current_results'`); an older snapshot titles only the entity rows (`'domain_rank_observations'`); without `include` every title is null and `titles_source` is `'unavailable'`; `organic` has `depth_returned` items; `features` match `featuresAt` of that check with `owned_by_project`, `owned_position`, `competitor_entity_ids`, `source_urls` (the AI Overview feature has `sources` URLs); `provenance` ids are strings; an `id` of 0, negative or above `2^63 - 1` is `422`; an unknown id, or one of another project, is `404`; `observed_at` is accepted and not required.
  - **raw**: `raw:read` holders (analyst, editor, admin, owner) get `200` with `content-type: application/json`, `content-disposition: attachment; filename="serp-snapshot-{id}.json"` and `cache-control: private, no-store`; viewer and billing get `403`; a snapshot older than 14 days (the mock's retention, a mock choice, said in the handler's comment) is `410 raw_expired`; the scenario cookie `mock_serp_raw=unavailable` gives `503 raw_unavailable`; unknown id `404`.
  - **serp-features**: `limit_checks` 1 to 200 (default 30), newest first, `from`/`to` default to the last 90 days, `filter[feature_type_in]` of more than 20 values is `422`; `presence` has one entry per type that appears, sorted by type, with `presence_rate` and `own_ownership_rate` `MetricValue`s whose `numerator`/`denominator` equal the counts of the returned checks (ownership over the checks where the feature is present); a check in which nothing is present has `features: []`.
  - **aio-history**: newest first, at most 1,000, `from`/`to`; each item's `ai_overview_state`, `own_cited`, `own_citation_position`, `source_count`, `organic_rank` (a `RankCell`) and `competitors_cited` agree with `aioAt`, `featuresAt` and the history point of the same check; `competitors_cited` holds only effective competitors and only when a block is present.
  Run: FAIL.
- [x] **Step 5: Implement `handlers/serp.ts`** on `worldChecks`. Snapshot lookup by id scans the project's live keywords' checks (60 keywords of at most 30 checks: a few hundred hashes; say so in a comment) and refuses ids of another project. Register in `index.ts`. Add the zod shapes (`SERP_CURRENT`, `SERP_SNAPSHOT_PAGE`, `SERP_SNAPSHOT_DETAIL`, `SERP_FEATURE_HISTORY`, `AIO_HISTORY`, `RANK_EVENT_PAGE`) to `src/test/api-shapes.ts`. PASS.
- [x] **Step 6: Cookie budget.** Nothing new is stored. Add a test (or assert in the existing codec test) that `encodeKeywordChanges` of a state with the existing largest fixture edits is byte-for-byte the length it was; show the number before and after in the report.
- [x] **Step 7: Gates** (scope `pnpm vitest run src/mocks src/test`), rankings e2e. **Commit** `git commit -m "Mocks: rank events and the SERP routes"`, then **stop and report**.
- [ ] **Step 8 (lead): independent review on Sonnet**, fixes with tests first, gates again, amend.
- **As-built facts and known mock differences**:
  - Every SERP, rank-history and rank-events route builds its world input through `worldInputFor` in `serp-views.ts`, so all of them give the world the same domain: the project's primary domain host, or `null`. With no primary domain no check ranks, and no route shows an own result, URL or owned feature. `domain_id` of a SERP domain is a hash of the host (`serpDomainOf`), the same in every snapshot and keyword.
  - Raw download retention is 14 days, a mock choice (`410 raw_expired` after it); the cookie `mock_serp_raw=unavailable` gives `503 raw_unavailable`. The raw body is a small JSON of the snapshot, not a provider payload.
  - The codec is untouched by Task 2 and the edit state built in `keywords-codec.test.ts` still encodes to 495 bytes; that number is the size of that test's own state, not the largest fixture.
  - Backend divergences resolved in review: the first beyond-depth check counts as 1 for the `new_ranking` debounce; `aioCited` is `null` for `not_loaded`, `absent` and `unknown` checks (34 fake citation events across the fixtures before); `ai_overview` is never an owned feature or a feature event; date queries use project local days. The expected event count of `include=events` in `rank-history.test.ts` is now derived from `worldEvents` instead of a literal.
  - Day bounds are computed once per request as instants (`toTimeBounds`) from `new TZDate(year, month, day, zone)`. Building a `TZDate` from a `YYYY-MM-DD` string reads it in the zone of the machine, which this review caught on a machine that is not in UTC; `serp-views.test.ts` pins the instants for Berlin, New York and both clock changes.
  - Known mock differences: `filter[event_type_in]` (30 values) and `filter[feature_type_in]` (20 values) answer `422 too_long` over the limit, as the backend list parameters do; history `include=events` lists only the own site's events (every mock event belongs to the own entity) oldest first with ties in check order, where the backend orders by time then id and returns up to 5,000; on the events route events at one instant are ordered by `rank_event_id` descending; the world keeps 30 checks per keyword, so `serp-features` gives the same 30 for the default and for any larger `limit_checks`; `competitors_cited` lists the effective competitors ranked in the top 10 of a check whose block is `present_cited` or `present_not_cited` and nothing for `not_loaded`; `has_ai_mode_link` and `ai_overview_observation_id` are `null` and `cost_usd` is `0.002` in every snapshot; a snapshot lookup by id scans every live keyword of the project.
  - Not checked: no request was made against the running backend (the behaviour was read from `backend/src` and the openapi file); the order of events inside one instant on the history route is not the backend's id order; the whole-project events route (90 days, no keyword filter) takes about 35 ms median through the mock fetch in vitest on this machine, measured once, not pinned by a test.

---

### Task 3: Route, shell, header, tabs, Open page

**Files:**
- Move (`git mv`): `apps/web/src/app/[workspace]/[project]/seo/keywords/layout.tsx`, `page.tsx`, `import/page.tsx` into `.../keywords/(list)/`
- Create: `apps/web/src/app/[workspace]/[project]/seo/keywords/[tkId]/page.tsx`, `page.test.tsx`; `apps/web/src/components/app/shell/detail-page-header.tsx`, `detail-page-header.test.tsx`; `apps/web/src/features/rankings/keyword-detail/{keyword-detail-screen.tsx,detail-header.tsx,detail-state.ts,detail-state.test.ts,detail-url-state.ts,detail-url-state.test.ts,list-return.ts,list-return.test.ts,keyword-detail.test.tsx}`; `apps/web/src/features/rankings/keyword-inspector/use-keyword-archive.ts`; `apps/web/e2e/flows/keyword-detail.spec.ts`
- Modify: `src/lib/routes/paths.ts` (+ `paths.test.ts`), `src/features/rankings/{index.ts,rankings-screen.tsx,rankings-queries.ts,check-now/use-check-now.tsx}`, `keyword-inspector/{keyword-inspector.tsx,keyword-inspector.test.tsx,demand-section.tsx}`, `messages/en.json`

**Mock reference:** `perf-detail.js` lines 40 to 60 (title, subtitle, actions of a detail) and `kw-inspector.js` header: the order is title, facts line, state badges, actions. The back link, the `h1` and the meta line follow 16 section 3 and 24 section 5, which win.

- [x] **Step 1: Path helper test first** (`paths.test.ts`): `keywordDetailPath('acme', 'fynix', '0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d6e')` is `/acme/fynix/seo/keywords/0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d6e`; a slug is encoded as `rankingsPath` encodes it. Implement next to `rankingsPath`.
- [x] **Step 2: State model test first** (`detail-state.test.ts`, state fixtures built with a helper typed as `TrackedKeywordState`, no casts):

```ts
it.each([
  [{ active: false, current: 'ranked' }, 'archived'],
  [{ active: true, current: 'not_checked' }, 'pending'],
  [{ active: true, current: 'failed' }, 'failed'],
  [{ active: true, current: 'ranked', stale: true }, 'stale'],
  [{ active: true, current: 'beyond_depth', stale: false }, 'live'],
] as const)('%j is %s', (input, kind) => {
  expect(detailStateOf(stateWith(input), input.active).kind).toBe(kind);
});

it('flags a keyword whose last checks failed while it still has an older good one', () => {
  expect(detailStateOf(stateWith({ current: 'ranked', failures: 2 }), true)).toEqual({ kind: 'live', failing: true });
});
```

  Implement `detailStateOf(state, isActive): { kind: 'archived' | 'pending' | 'failed' | 'stale' | 'live'; failing: boolean }` (`failing` is `consecutive_failures > 0` unless the kind is `failed`). Order of precedence: archived, pending, failed, stale, live. `statusBadges(detailState)` returns the badge codes (`archived`, `pending`, `failed`, `stale`, `failing`), at most 4 (16 section 2.1).
- [x] **Step 3: URL state test first** (`detail-url-state.test.ts`): parsing `tab=snapshots` gives `snapshots`; an unknown tab falls back to `overview` without throwing (13 section 5 "never throws"); `overview` is written as no key; round trip of the whole table in Decision 4 as later tasks add keys (this task adds `tab` only). Implement with `nuqs` `parseAsStringLiteral`, in one `useDetailUrlState()` hook returning the values and setters; `tab` uses `history: 'push'`.
- [x] **Step 4: List return test first** (`list-return.test.ts`): `rememberListHref(sessionStorage, '?q=seo&sort=-rank')` then `listReturnHref(sessionStorage, path)` returns `path` with that query; with an empty or throwing storage (private window) it returns the bare path. Implement `list-return.ts` (all storage access in `try/catch`, the first thing the file says). `RankingsScreen` calls `rememberListHref` from an effect on its search string (the `inspect` and `itab` keys removed), so the back link of the page returns to the list as the person left it (DetailPageHeader spec "href restored from sessionStorage per tab").
- [x] **Step 5: `DetailPageHeader` component test first** (`detail-page-header.test.tsx`): renders a back `TextLink` named by `back.label` with `back.href`, the `h1` named by `objectName` carrying `lang`, the facts slot in the meta line, the actions slot right aligned, the `tabs` slot under the title row; `archived` shows a neutral "Archived" `Badge` in the meta line (label from props: `archivedLabel`) and hides actions it was not given. Assert accessible names and roles. Implement on `PageHeader` (`src/components/app/shell/page-header.tsx`): the back link row adds 24 px (24 section 5). It imports no feature and no query.
- [x] **Step 6: Extract the archive logic.** `keyword-inspector.tsx` has `setActive(active, keyword, undo)` with its toasts inline. Move it into `keyword-inspector/use-keyword-archive.ts` (`useKeywordArchive(scope)` returns `setActive`) and call it from the inspector; the inspector's tests pass **unchanged** (run them first and after; say so). The page's More menu uses the same hook.
- [x] **Step 7: Move the list into the route group.** `git mv` the three files into `(list)/`, then `pnpm exec next typegen`. No URL changes: show `pnpm build`'s route table before and after (the same `/[workspace]/[project]/seo/keywords` and `.../keywords/import` entries). `rankings-route.test.tsx` and `rankings/page.test.tsx` change only if they import by path.
- [x] **Step 8: The detail page route.** `.../keywords/[tkId]/page.tsx`, a server component like `EntityEditorPage`: `generateMetadata` titles it from `navigation.items.rankings`; `isUuid(tkId)` else `notFound()`; `requireMembership(workspace)`, the project among `projectsOfMembership` else `notFound()`; renders `<KeywordDetailScreen workspaceId projectId workspaceSlug projectSlug trackedKeywordId timeZone />`. `page.test.tsx`: a non-uuid calls `notFound` without reading the session; an unknown project calls `notFound`; a good address renders the screen with the ids. `loading.tsx` of the project already serves it.
- [x] **Step 9: Query invalidation.** In `rankings-queries.ts`, `refreshKeywords` also invalidates `[...projectKey, 'seo', 'rank-events']` and `[...projectKey, 'serp-snapshots']` (Decision 12). Test: after `refreshKeywords`, a cached `serp-snapshots/{id}` query and a cached `seo/rank-events` query are marked invalid.
- [x] **Step 10: Screen and header (tests first, `keyword-detail.test.tsx`, MSW with the real handlers).** `KeywordDetailScreen` reads `detailQuery(scope)` and renders, in order: `DetailPageHeader` (back link "Keywords" to `listReturnHref`; `h1` the keyword text with `lang={language_code}`; meta line `"{location} · {device} · {engine} · {language}"` and the depth label from `useDepthLabel`, then freshness `"Updated {relative}"` and `checkNow.progress`; a second line with the target URL path or "No target URL", the group paths and the term names, omitting empty parts; state badges from `statusBadges`; actions), the tabs (`Tabs variant="underline"`, Overview and SERP snapshots, `tab` in the URL, arrow keys move between tabs), and the panel of the tab, which renders **no sections yet** (each later task adds one; write no placeholder text). Actions: **Check now** (`checkNow.inspectorAction(id, active, 'page')`: add a third argument `presentation: 'inspector' | 'page'` to the existing function in `use-check-now.tsx`; `page` renders the primary `md` button of 24 section 9.4, `inspector` is unchanged; test both), absent for an archived keyword and for a member without `runs:trigger`; **Open ranking page** (a secondary link in a new tab with `rel="noopener noreferrer nofollow"`, only when `state.current.url` is http or https via `webHref`; absent otherwise); **More** (`Menu`): Copy link (the page URL, announced), Copy keyword, Edit settings (navigates to the list with `inspect=keyword:{id}`, so editing stays in the inspector, no second editor), Change depth (`DepthDialog`, `keywords:write`), Archive or Restore (`useKeywordArchive`, `keywords:write`). An archived keyword shows the `Archived` badge and its only actions are Copy link and Restore. States: while loading, a header and strip skeleton; `not_found` shows a full width `EmptyState` "This keyword is no longer tracked" with a link to the list (24 section 5 States); a failed read shows `SectionError` with Try again; no `data:read` shows the no-access `EmptyState` of `RunsScreen`. Tests (each asserts presence first, then content): header text for a ranked keyword; a pending fixture shows the "Not checked yet" badge and no Open ranking page; the stale fixture shows "Stale"; an archived fixture shows "Archived", no Check now, a Restore item; a viewer sees no Check now, no Archive, no Change depth; the tabs have two tabs and ArrowRight moves focus and selection; an unknown uuid shows the not-found state with a working link; the billing role shows the no-access state.
- [x] **Step 11: Open page and the row click (tests first).** `KeywordInspector` takes `onOpenPage: () => void` and passes it to the header (`header.onOpenPage`). `RankingsScreen` passes `() => guarded(() => router.push(keywordDetailPath(...)))`. Tests in `rankings.test.tsx`: the inspector shows an "Open page" button; with unsaved edits it asks first and does not navigate until the person discards; a Ctrl click on a row calls `window.open` with the detail path and `_blank`, `noopener`, and does **not** add `inspect` to the URL (spy on `window.open`); a plain click still opens the inspector. Change `onRowOpen`'s `new-tab` branch accordingly (Open question 1).
- [x] **Step 12: Messages.** `keywordDetail` namespace:

```json
"keywordDetail": {
  "back": "Keywords",
  "notFound": { "title": "This keyword is no longer tracked", "reason": "It was deleted, or you do not have access to its project.", "toList": "Back to Keywords" },
  "noAccess": { "title": "You cannot open this page", "reason": "Your role does not include reading rank data.", "toOverview": "Back to the project" },
  "loadFailed": { "title": "The keyword did not load", "reason": "Nothing else on this page can be shown until it does." },
  "header": {
    "facts": "{location} · {device} · {engine} · {language} · {depth}",
    "updated": "Updated {time}",
    "neverChecked": "Not checked yet",
    "target": "Target {path}",
    "noTarget": "No target URL",
    "badges": { "archived": "Archived", "pending": "Not checked yet", "failed": "Check failed", "stale": "Stale", "failing": "Last checks failed" },
    "checkNow": "Check now",
    "openRankingPage": "Open ranking page",
    "more": "More actions",
    "copyLink": "Copy link",
    "linkCopied": "Link copied",
    "editSettings": "Edit settings",
    "changeDepth": "Change depth",
    "archive": "Archive",
    "restore": "Restore"
  },
  "tabs": { "label": "Keyword sections", "overview": "Overview", "snapshots": "SERP snapshots" }
}
```

  (`·` is a middle dot, not a dash. The facts string is built from the same parts the inspector's badges use; reuse `rankings.inspector.engines.*`, `rankings.filters.devices.*`, `languageName`, `useDepthLabel`; add no second copy of them.)
- [x] **Step 13: End to end** (`e2e/flows/keyword-detail.spec.ts`, signed in as the editor `priya@digibranders.test`, 1440 x 900): (a) open Keywords, click the first keyword's row header, press the inspector's "Open page" button: the URL matches `/seo/keywords/<uuid>`, the `h1` is that keyword, the tab list has two tabs and the page has no horizontal scroll; (b) `page.goBack()` returns to `/seo/keywords?inspect=keyword:<id>` with the inspector open (`getByRole('complementary', { name: keyword })` visible), Escape closes it and the URL is the list without `inspect`, and `J` after reopening still steps to the next keyword; (c) a Ctrl click on another row opens a popup whose URL is its detail page, and the first page's URL is unchanged; (d) a direct visit to `/seo/keywords/00000000-0000-4000-8000-000000000000` shows the not-found state; (e) as `mei@digibranders.test` (viewer) the page opens and has no Check now; (f) `expectAccessible(page)` on the loaded page. Save screenshots at 1440, 1280, 1024 and 390 px; the header must not overflow at 390 (assert `document.documentElement.scrollWidth <= innerWidth`).
- [x] **Step 14: Gates** (rule 12; `pnpm vitest run src/app src/features/rankings src/components/app/shell src/lib/routes`). **Commit** `git commit -m "Keyword detail: the page, its header and the link from the inspector"`, then **stop and report**.
- [ ] **Step 15 (lead): independent review on Sonnet**, fixes with tests first, gates again, amend.

---

### Task 4: Rank history chart on the page

**Why second among the screens.** It is the most used evidence of the page, it needs only the history route, and it forces the one structural job of this plan: sharing the chart logic with the inspector instead of copying it.

**Files:**
- Move (`git mv`): `keyword-inspector/rank-history-model.ts` and `rank-history-model.test.ts` to `apps/web/src/features/rankings/rank-history/`
- Create: `rank-history/use-rank-history-chart.ts`, `use-rank-history-chart.test.tsx`, `rank-history/rank-stats.ts`, `rank-stats.test.ts`; `keyword-detail/{detail-queries.ts,rank-history-panel.tsx,rank-history-controls.tsx,rank-history-panel.test.tsx,detail-window.ts,detail-window.test.ts}`
- Modify: `keyword-inspector/rank-history-section.tsx` (becomes a thin caller), `keyword-inspector/inspector-queries.ts` (`rankHistoryQuery(scope, options?)`), `keyword-detail/{keyword-detail-screen.tsx,detail-url-state.ts,detail-url-state.test.ts}`, `messages/en.json` (the shared chart keys move from `rankings.inspector.rankHistory` to `rankings.rankHistory`, same English text), `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** `index.html` lines 783 to 797 (a bordered card, a title row, a one line note, then the chart) for the card chrome; the page uses `ChartFrame variant="panel"` at 240 px (24 section 9.4). `charts.js` `hatch()` line 145 for the 45 degree depth band, which `rankAxis` already draws. The axis, guides, band and series rules are 15-data-visualization.md section 7.

- [ ] **Step 1: Window helpers test first** (`detail-window.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { apiWindow, windowDates } from './detail-window';

describe('detail window', () => {
  it('names the API window of each choice', () => {
    expect(apiWindow('7d')).toBe('last_7d');
    expect(apiWindow('90d')).toBe('last_90d');
    expect(apiWindow('365d')).toBe('last_365d');
  });
  it('counts both ends: 7 days ending 2026-11-02 start on 2026-10-27', () => {
    expect(windowDates('7d', '2026-11-02')).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(windowDates('90d', '2026-11-02')).toEqual({ from: '2026-08-05', to: '2026-11-02' });
  });
  it('crosses a month and a year end', () => {
    expect(windowDates('30d', '2026-01-10')).toEqual({ from: '2025-12-12', to: '2026-01-10' });
  });
});
```

  Implement `detail-window.ts` (`WINDOWS = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 } as const`, `DEFAULT_WINDOW = '90d'`, `apiWindow(win)` = ``last_${WINDOWS[win]}d``, `windowDates(win, today)` with `Date.UTC` arithmetic on the ISO day so no time zone can shift it; `today` is `formatIsoDate(new Date(), timeZone)`). Extend `detail-url-state` with `win` (replace), `comp` and `show` (replace; `show` takes any of `absolute`, `events`, `deep`; unknown members are dropped; `comp` keeps at most 5 uuids) and test their round trips and defaults.
- [ ] **Step 2: Stats test first** (`rank-stats.test.ts`), over typed `HistoryPoint`s built with a helper:

```ts
it('counts best, worst, median and the days in the top 10 over non-failed checks', () => {
  const points = [
    point('2026-10-01', 'ranked', 12), point('2026-10-02', 'ranked', 8), point('2026-10-02', 'ranked', 9),
    point('2026-10-03', 'beyond_depth', null), point('2026-10-04', 'failed', null), point('2026-10-05', 'ranked', 3),
  ];
  expect(rankStats(points)).toEqual({
    best: 3, worst: 12, median: 8.5, ranked: 4, checks: 5, topTenDays: 2, daysChecked: 4,
  });
});
it('is all null and zero without points', () => {
  expect(rankStats([])).toEqual({ best: null, worst: null, median: null, ranked: 0, checks: 0, topTenDays: 0, daysChecked: 0 });
});
```

  Implement `rankStats(points: readonly HistoryPoint[]): RankStats` over the own series: failed points are ignored; `checks` counts non-failed points; `topTenDays` counts distinct local `date`s with a ranked point at rank 10 or better; `daysChecked` distinct dates with a non-failed point. These feed the strip (Task 5) and the chart footnote.
- [ ] **Step 3: Extract the model, test first.** `git mv` the model and its test to `rank-history/`; update imports; the existing tests pass unchanged (run before and after). Then add tests and options to `rankHistoryChart(history, options)`:

```ts
it('hides ranks deeper than 20 while deep checks are off, counts them, and keeps the axis at 20', () => {
  const model = rankHistoryChart(historyOf({ own: [rank(5, 20), rank(35, 100), beyond(20)] }), { ownName: (n) => n, deep: 'hide' });
  expect(model.depthMax).toBe(20);
  expect(model.series[0]?.values).toEqual([5, null, null]);
  expect(model.deepHidden).toBe(1);
});
it('shows them and extends the axis to the deepest check when on', () => {
  const model = rankHistoryChart(historyOf({ own: [rank(5, 20), rank(35, 100), beyond(20)] }), { ownName: (n) => n, deep: 'show' });
  expect(model.depthMax).toBe(100);
  expect(model.series[0]?.values).toEqual([5, 35, null]);
  expect(model.deepHidden).toBe(0);
});
it('keeps the inspector rule when no choice is made: the axis follows the deepest check', () => {
  const model = rankHistoryChart(historyOf({ own: [rank(5, 20), rank(35, 100), beyond(20)] }), { ownName: (n) => n });
  expect(model.depthMax).toBe(100);
  expect(model.series[0]?.values).toEqual([5, 35, null]);
});
it('adds the absolute rank of the own site as a dashed reference series named by absoluteName', () => {
  const model = rankHistoryChart(historyOf({ own: [rank(3, 20, { absolute: 5 })] }), { ownName: (n) => n, absoluteName: (n) => `${n} (absolute)`, absolute: true });
  expect(model.series.map((s) => [s.name, s.role.kind, s.values])).toEqual([['own', 'brand', [3]], ['own (absolute)', 'reference', [5]]]);
});
it('draws only the chosen competitors, in the order chosen', () => {
  const history = historyOf({ own: [rank(5, 20)], competitors: { a: [rank(2, 20)], b: [rank(9, 20)], c: [rank(12, 20)] } });
  const model = rankHistoryChart(history, { ownName: (n) => n, competitorIds: ['b', 'a'] });
  expect(model.series.map((s) => s.id)).toEqual(['own', 'b', 'a']);
});
it('drops bands deeper than 20 while deep checks are off', () => {
  const model = rankHistoryChart(historyOf({ own: [rank(5, 20), beyond(20), beyond(100)] }), { ownName: (n) => n, deep: 'hide' });
  expect(model.bands.map((b) => b.depth)).toEqual([20]);
});
```

  `historyOf({ own, competitors? })`, `rank(value, depth, extra?)` and `beyond(depth)` are typed builders local to the test file (no casts): `historyOf` gives the own entity the id and name `own`, a competitor the key it is given, one point per list entry on consecutive days, and a `summary` that follows the API's rule (`checks` = ranked plus beyond). Options: `deep: 'auto' | 'hide' | 'show'` (default `auto`, the inspector's current behaviour, so the card is unchanged), `absolute?: boolean`, `absoluteName?`, `competitorIds?: readonly string[] | null`. The result gains `deepHidden: number`. Run: FAIL, implement, PASS.
- [ ] **Step 4: Extract the hook, test first** (`use-rank-history-chart.test.tsx`, `renderHook` with the real `NextIntlClientProvider` messages): `useRankHistoryChart(history, { height, ...modelOptions })` returns `{ state: 'loading' | 'empty' | 'allFailed' | 'ready', frame }` where `frame` has `categories` (formatted with `formatChartDate`), `series`, `formatValue`, `extendOption` (built with `useCallback` from `rankAxis`, `plotHeight = height`), `summary` and `meta`. Move into it, unchanged in behaviour and wording: the summary sentence with first, last and best rank and the competitor count, the band sentences, the failed glyph indices, the all-failed sentence, the unranked sentence, the meta line with and without failed checks. Tests: a ready history gives a summary containing the real first, last and best numbers and the checks count; two bands give two band sentences; `deepHidden = 3` appends the sentence "3 deep checks are not drawn."; an empty history is `empty`; `checks === 0 && failed_checks > 0` is `allFailed` (Task 1 Step 9); `extendOption` called with a base option returns an option whose `yAxis.inverse` is true and whose first series has a `markLine` at 3, 10 and 20 (as `rank-chart.test.ts` does).
- [ ] **Step 5: The inspector card on the hook.** Rewrite `rank-history-section.tsx` to the query, the hook and `ChartFrame height={180}` only. Its tests (`keyword-inspector.test.tsx`, `rank-history-model.test.ts`) pass **unchanged**; show the run. Move the message keys with `git mv`-style care: grep for `rankings.inspector.rankHistory` before and after, and show that nothing else reads the old namespace.
- [ ] **Step 6: Queries.** In `inspector-queries.ts`:

```ts
export interface RankHistoryOptions {
  window?: `last_${7 | 30 | 90 | 180 | 365}d`;
  entityIds?: readonly string[];
  include?: readonly ('absolute' | 'url' | 'events')[];
}

/** The keyword's rank history; without options the last 90 days with the API's default entities, as the inspector reads it. */
export const rankHistoryQuery = (scope: KeywordScope, options: RankHistoryOptions = {}): ApiQueryOptions<typeof RANK_HISTORY> =>
  apiQuery(RANK_HISTORY, {
    params: {
      path: keywordPath(scope),
      query: {
        window: options.window ?? 'last_90d',
        ...(options.entityIds === undefined ? {} : { entity_ids: [...options.entityIds] }),
        ...(options.include === undefined ? {} : { include: [...options.include] }),
      },
    },
  });
```

  The inspector's call has no options, so its key and its cache entry are exactly what they are today (assert it in `inspector-queries` or the section test). In `detail-queries.ts` add `pageRankHistoryQuery(scope, win, competitorIds)` = `rankHistoryQuery(scope, { window: apiWindow(win), entityIds: ['own', ...competitorIds], include: ['absolute', 'events'] })`: one request per window, **all** effective competitors (at most 10, the API's 11 entity cap), `events` and `absolute` always included so toggling a layer never refetches; the chart draws the chosen five from it and Task 10's table lists them all. `effectiveCompetitorIds(entities, overrides)` and `projectEntitiesQuery` already exist; sort the ids by entity name; with more than 10 effective competitors the first 10 are asked for and the panel says "Showing 10 of {n} competitors" (a message, tested).
- [ ] **Step 7: Panel and controls, tests first** (`rank-history-panel.test.tsx`, MSW with the real handlers). `RankHistoryPanel` renders `ChartFrame variant="panel" height={240}` titled "Rank history" with: the meta line (`"{window text} · {checks} checks, {ranked} ranked · deep check {weekday}"`, the weekday from `deep_check_weekday` through `common.weekdays` as `project-settings/general-screen.tsx` does; if the mapping is more than 6 lines move it to `lib/format/weekday.ts` with its test and use it from both), a footnote with `rankStats` ("Best 3, worst 12, median 8.5, average 4.6 over 88 of 90 checks", the average from `summary.average_rank`, never recomputed), the controls row, and the chart. Controls (`rank-history-controls.tsx`): a window `Select` (`win`), a competitors `MultiSelect` (`comp`, at most 5: the sixth option is disabled with the reason "At most 5 competitors on the chart"), and a group "Chart layers" of toggle buttons with `aria-pressed`: **Absolute** and **Deep checks** (the **Events** toggle arrives in Task 9, `show=events`). Deep checks shows its hidden count as part of its name: "Deep checks (3 hidden)" while off and any are hidden, "Deep checks" otherwise.
  Tests: the default view asks for `window=last_90d`, `include=absolute,events` and `entity_ids=own,<all effective competitors by name>` (assert on the request URL the handler saw); choosing 30 days asks for `last_30d` and writes `win=30d`; Absolute adds a series named "{name} (absolute)" to the legend and the Table view without a new request; Deep checks off hides the points deeper than 20 and the toggle's name carries the hidden count, on shows them; the sixth competitor option is disabled and the reason is its accessible description; a failed read shows `SectionError` with Try again and the other panels of the page are unaffected (render two panels); an empty history shows "No checks yet" and the reason for the keyword's state (pending, failed, stale: Decision 9); the chart's accessible description contains the real first, last and best ranks; all controls are reachable with Tab in the order window, competitors, layers, and Space toggles a layer.
- [ ] **Step 8: Wire into the screen:** the Overview tab renders the evidence column container (`grid grid-cols-12 gap-4`; evidence `col-span-12 xl:col-span-8`, the rail `xl:col-span-4`, the rail empty until Task 8) with `RankHistoryPanel` first. `xl` here is the 1280 px breakpoint of this project's Tailwind scale; confirm the token name in `src/styles` and use the project's, not a literal.
- [ ] **Step 9: Messages** (`rankings.rankHistory` gets the moved keys plus `deepHidden`; `keywordDetail.history` is new):

```json
"keywordDetail": {
  "history": {
    "title": "Rank history",
    "meta": "{window} · {checks, plural, one {1 check} other {# checks}}, {ranked} ranked · deep check {weekday}",
    "window": { "label": "Window", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "180d": "Last 180 days", "365d": "Last 365 days" },
    "competitors": { "label": "Competitors on the chart", "count": "{count, plural, =0 {No competitors} one {1 competitor} other {# competitors}}", "limit": "At most 5 competitors on the chart", "showing": "Showing {shown} of {total} competitors" },
    "layers": { "label": "Chart layers", "absolute": "Absolute", "deep": "Deep checks", "deepHidden": "Deep checks ({count} hidden)" },
    "stats": "Best {best}, worst {worst}, median {median}, average {average} over {ranked} of {checks} checks",
    "statsUnranked": "Not ranked in any of the {checks, plural, one {1 check} other {# checks}} in this window",
    "deepNote": "{count, plural, one {1 deep check is not drawn.} other {# deep checks are not drawn.}}"
  }
}
```

- [ ] **Step 10: End to end** (`keyword-detail.spec.ts`): on a ranked fixture keyword at 1440 px the chart panel is visible with the legend naming the own site and up to five competitors; the Table view lists dates and ranks; switching to 30 days changes the table's row count to at most 30 and the URL gains `win=30d`; Absolute adds a legend entry; at 1440 px the chart panel's width is at least 60 percent of the content width and at 1024 px it is the full width (bounding boxes); screenshots at 1440, 1024 and 390 px; the canvas is not blank (read 20 sample pixels of the chart canvas through `page.evaluate` and expect more than one distinct colour).
- [ ] **Step 11: Gates**, **commit** `git commit -m "Keyword detail: the rank history chart, shared with the inspector"`, **stop and report**. **Step 12 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 5: Metric strip

**Files:**
- Create: `apps/web/src/features/rankings/keyword-detail/{strip-model.ts,strip-model.test.ts,detail-strip.tsx,detail-strip.test.tsx}`
- Modify: `keyword-detail/detail-queries.ts` (`aioHistoryQuery`), `keyword-inspector/demand-section.tsx` (export `volumeStripItem`), `keyword-detail-screen.tsx`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** `customize.js` `NUMBER_DATA` (`seo.*`, lines 133 to 143) for the cell labels; 24 section 9.4 for the six cells; the rank cell and change look follow `rank-cells.tsx`.

- [ ] **Step 1: Model test first** (`strip-model.test.ts`). The strip has six cells; the model returns codes and numbers, the component words them:

```ts
it('reads the rank cell by the keyword state, not by the raw flags', () => {
  expect(stripCells(input({ kind: 'pending' })).rank).toEqual({ kind: 'pending' });
  expect(stripCells(input({ kind: 'failed' })).rank).toEqual({ kind: 'failed' });
  expect(stripCells(input({ kind: 'stale', rank: 12, lastGood: '2026-10-30T02:00:00.000Z' })).rank).toMatchObject({ kind: 'value', rank: 12, stale: true });
  expect(stripCells(input({ kind: 'live', rank: 3 })).rank).toMatchObject({ kind: 'value', rank: 3, stale: false });
  expect(stripCells(input({ kind: 'live', rank: null, depth: 20 })).rank).toEqual({ kind: 'beyond', depth: 20 });
});
it('takes the average from the API and the days in the top 10 from the series, each with its denominator', () => {
  const cells = stripCells(input({ kind: 'live', rank: 4, average: 4.6, stats: { ranked: 88, checks: 90, topTenDays: 61, daysChecked: 90 } }));
  expect(cells.average).toEqual({ kind: 'value', value: 4.6, ranked: 88, checks: 90 });
  expect(cells.topTen).toEqual({ kind: 'value', days: 61, of: 90 });
});
it('has no average, and says so, when nothing ranked in the window', () => {
  const cells = stripCells(input({ kind: 'live', rank: null, depth: 20, average: null, stats: { ranked: 0, checks: 90, topTenDays: 0, daysChecked: 90 } }));
  expect(cells.average).toEqual({ kind: 'none', checks: 90 });
  expect(cells.topTen).toEqual({ kind: 'value', days: 0, of: 90 });
});
it('counts the AI Overview checks that could be read, not those that could not', () => {
  const items = [aio('present_cited'), aio('present_not_cited'), aio('absent'), aio('not_loaded'), aio('unknown')];
  expect(aioCounts(items)).toEqual({ present: 2, of: 3 });
});
```

  `best` is `state.best_rank` with `best_rank_at` (all time; the cell's context says so by date, not by window). A section that failed to load gives its cells `{ kind: 'unavailable' }` (rendered "n/a" with `unknown: not-applicable`), never zero.
- [ ] **Step 2: Implement `strip-model.ts`**: `stripCells({ state: DetailState, tracked: TrackedKeywordState, history: RankHistory | undefined, aio: readonly AioHistoryItem[] | undefined })` with the `rankStats` of Task 4 over the own series of `history`, and `aioCounts(items)`. Run: PASS.
- [ ] **Step 3: Component test first** (`detail-strip.test.tsx`, MSW real handlers): the strip is a group named "Summary for this keyword" with six cells in the order Rank, Best rank, Average rank, Days in top 10, Volume, AI Overview (assert the `dt` texts in order); the Rank cell shows the rank with its change (`RankChangeView`) and "Checked {datetime}"; the stale fixture says "Stale" and the last good check's date in the Rank cell's context; the pending fixture shows "Not checked yet" in Rank and "n/a" elsewhere, no zeros; Volume has the `Estimate` badge when `is_estimate`; the AI Overview cell reads like the table cell (`aioDisplay`: "Cited #2", "Present, not cited", "No AIO") with "{present} of {of} checks"; while loading the labels show and the values are bars; when the rank history read fails, Average rank and Days in top 10 read "n/a" and one banner "Some figures did not load" with Try again re-runs only the failed queries (spy on requests: the detail is not requested again).
- [ ] **Step 4: Implement `detail-strip.tsx`** on `MetricStrip size="md"`, one group `keyword`, six items; `volumeStripItem(detail)` is exported from `demand-section.tsx` and used by both strips (the inspector's `KeywordMetricStrip` calls it too; its tests pass unchanged). The strip reads `detailQuery`, the page's rank history query (same key as Task 4: one request) and `aioHistoryQuery(scope, { from, to })` from `windowDates(win, today)`; `aioHistoryQuery` is defined in `detail-queries.ts` and used again in Task 11 (same key, one request).
- [ ] **Step 5: Messages** (`keywordDetail.strip`):

```json
"strip": {
  "label": "Summary for this keyword",
  "rank": "Rank", "rankChecked": "Checked {time}", "rankStale": "Stale, last good check {time}", "rankBeyond": "Not in top {depth}",
  "rankPending": "Not checked yet", "rankFailed": "Check failed",
  "best": "Best rank", "bestAt": "{date}", "bestNone": "Never ranked",
  "average": "Average rank", "averageOf": "{ranked} of {checks, plural, one {1 check} other {# checks}}", "averageNone": "Not ranked in {checks, plural, one {1 check} other {# checks}}",
  "topTen": "Days in top 10", "topTenOf": "of {days, plural, one {1 day checked} other {# days checked}}",
  "aio": "AI Overview", "aioChecks": "{present} of {of, plural, one {1 check} other {# checks}}", "aioNoChecks": "No readable checks in this window",
  "unavailable": "n/a",
  "partialError": "Some figures did not load", "retry": "Try again"
}
```

- [ ] **Step 6: End to end:** the strip shows six cells at 1440 px in one row and wraps to two rows at 1024 px (bounding boxes: the second row's top is greater than the first row's bottom); the Rank cell value equals the Rank column of the same keyword in the list (read both and compare); axe on the page; screenshots at 1440, 1024, 390 px.
- [ ] **Step 7: Gates**, **commit** `git commit -m "Keyword detail: the metric strip"`, **stop and report**. **Step 8 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 6: SERP snapshots tab: latest results, picker, results table

**Files:**
- Modify: `apps/web/src/components/app/data-table/{data-table.tsx,types.ts}` (+ `data-table.test.tsx`): an optional `rowTone` prop; `apps/web/src/lib/tables/column-types.ts` (+ test) if a column type is missing
- Create: `keyword-detail/snapshots/{snapshots-tab.tsx,snapshot-picker.tsx,serp-table.tsx,serp-rows.ts,serp-rows.test.ts,snapshot-options.ts,snapshot-options.test.ts,snapshots-tab.test.tsx}`
- Modify: `keyword-detail/{detail-queries.ts,detail-url-state.ts,detail-url-state.test.ts,keyword-detail-screen.tsx}`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** none for a SERP viewer. Table look: the Keywords table (`kw-table.js`) and the shared type-table tokens; do not restyle.

- [ ] **Step 1: Row model test first** (`serp-rows.test.ts`):

```ts
it('orders by organic rank and names the kind of each row from its entity role', () => {
  const rows = serpRows([item(3, 'hubspot.com', entity('competitor')), item(1, 'fynix.digital', entity('own')), item(2, 'g2.com', null), item(4, 'zapier.com', entity('watch'))]);
  expect(rows.map((r) => [r.rank, r.kind])).toEqual([[1, 'own'], [2, 'other'], [3, 'competitor'], [4, 'watch']]);
});
it('keeps two results of one domain as two rows', () => {
  expect(serpRows([item(1, 'a.com', null), item(2, 'a.com', null)]).map((r) => r.key)).toEqual(['1', '2']);
});
it('keeps the absolute rank when it differs from the organic rank', () => {
  expect(serpRows([item(1, 'a.com', null, { absolute: 3 })])[0]?.absolute).toBe(3);
});
```

  `serpRows(items: readonly (SerpResult | SerpOrganicItem)[]): SerpRow[]`, `SerpRow = { key, rank, absolute, kind: 'own' | 'competitor' | 'watch' | 'other', entity, title, snippet, url, host }`. `kind` comes from `entity.role` only (the API's mapping; the client never guesses from a domain).
- [ ] **Step 2: Picker model test first** (`snapshot-options.test.ts`):

```ts
it('lists snapshots newest first with their depth and the own rank, and flags a ranking URL change from the next older one', () => {
  const options = snapshotOptions([snap('3', 'ranked', 4, '/pricing'), snap('2', 'ranked', 5, '/blog'), snap('1', 'beyond_depth', null, null)]);
  expect(options.map((o) => [o.id, o.urlChanged])).toEqual([['3', true], ['2', false], ['1', false]]);
});
it('does not call it a change when the older snapshot had no ranking URL', () => {
  const options = snapshotOptions([snap('2', 'ranked', 4, '/pricing'), snap('1', 'beyond_depth', null, null)]);
  expect(options.map((o) => o.urlChanged)).toEqual([false, false]);
});
it('clears obs when the chosen snapshot is the latest check', () => {
  expect(normaliseObs('9', '9')).toBeNull();
  expect(normaliseObs('8', '9')).toBe('8');
  expect(normaliseObs('8', null)).toBe('8');
});
it('steps to the neighbour snapshot and stops at the ends', () => {
  const ids = ['3', '2', '1'];
  expect(neighbour(ids, '2', 'newer')).toBe('3');
  expect(neighbour(ids, '2', 'older')).toBe('1');
  expect(neighbour(ids, '3', 'newer')).toBeNull();
  expect(neighbour(ids, '1', 'older')).toBeNull();
  expect(neighbour(ids, 'gone', 'older')).toBeNull();
});
```

  `snap(id, state, rank, path)` builds a typed `SerpSnapshotSummary` with an `own` `RankCell` (no casts).

  `snapshotOptions(rows)` returns `{ id, observedAt, observedDate, depth, depthReturned, own: RankCell, urlChanged, hasAio }[]`; `urlChanged` compares `own.url.canonical_url` with the next older row's, only when both exist. Implement.
- [ ] **Step 3: Table tone (shared component, test first).** In `data-table.test.tsx` add: a table given `rowTone={(row) => (row.mine ? 'own' : undefined)}` renders the same cells and the same accessible names for every row (the tone is visual only, so the entity cell must carry the meaning; the test asserts the "You" text is in the own row's cells), and the tone does not break keyboard navigation (ArrowDown moves from the own row to the next). Add `rowTone?: ((row: TRow) => 'own' | undefined) | undefined` to `DataTableProps`; the own row gets `bg-primary-subtle` (the token of 02-color-system; use the project's utility name, not a literal colour). The real-browser proof is in the end to end step.
- [ ] **Step 4: Queries** in `detail-queries.ts`: `serpCurrentQuery(scope)`, `snapshotsQuery(scope)` (a `useInfiniteQuery` over `serp-snapshots`, `limit: 50`, cursor from `page.next_cursor`, as `rankings-queries.ts` does for the list), `snapshotQuery(scope, id, observedAt)` for `GET {P}/serp-snapshots/{id}` with `include=titles` and the `observed_at` hint taken from the list row (monthly partitions: always pass it when the row is known). Keys: `serp-current` and `serp-snapshots` sit under `keywordsKey`; the snapshot detail is under `[...projectKey, 'serp-snapshots', id]`, which Task 3 made `refreshKeywords` invalidate.
- [ ] **Step 5: URL state:** add `obs` and `vs` (push) to `detail-url-state`; an `obs` that is not a decimal integer text is dropped; tests.
- [ ] **Step 6: Tab tests first** (`snapshots-tab.test.tsx`, MSW real handlers):
  1. The tab opens on "Latest check" (`obs` absent) and shows the top 20 of `serp-current`: 20 rows with rank, title, URL path in mono, host, entity and snippet; the own row (the fixture ranks) has "You" in the Entity column and the competitors' rows their names with the entity swatch; a result of no tracked entity has an empty Entity cell with a visually hidden "Not tracked".
  2. A keyword never checked shows `EmptyState` "No SERP snapshot yet" with the reason "The first check creates one" (the pending state wording of Decision 9); a failed keyword shows "The check failed, so there is no snapshot" (`failed`); both without calling `serp-snapshots/{id}`.
  3. The picker is a `Select` named "Snapshot" whose first option is "Latest check" and the rest "{date, time}, top {depth}, rank {n}" (or "not in top {depth}"), with "URL changed" in the option text where `urlChanged`; choosing an older snapshot writes `obs=<id>` (push), shows "Snapshot of {datetime}" and loads `serp-snapshots/{id}?include=titles&observed_at=...` (assert the request); choosing the newest clears `obs`; Previous snapshot and Next snapshot buttons step and are disabled at the ends with their reason in the accessible description; a Load older snapshots button appears only when `has_more` and appends the next page without losing the choice.
  4. A snapshot whose `titles_source` is `unavailable` shows rows by URL with a note "Titles are kept only for your pages, your competitors and the latest results"; an older snapshot shows titles for entity rows only.
  5. A snapshot that returned fewer results than requested says "{returned} of the top {depth} results were returned".
  6. A failed snapshot read shows `SectionError` with Try again and leaves the picker usable; an `obs` for a snapshot that does not exist (a stale link) shows "This snapshot is no longer available" with a link that clears `obs`.
  7. Keyboard: Tab reaches the picker, the two step buttons and the table in order; Enter on an option chooses it; the focus returns to the picker after a step button press.
- [ ] **Step 7: Implement** `snapshots-tab.tsx`, `snapshot-picker.tsx`, `serp-table.tsx` (a `DataTable` in client mode on `serpRows`, modelled on the minimal prop set `features/operations/runs-screen.tsx` uses; columns left aligned: `#` (organic rank, with the absolute rank as the cell's tooltip when different), Result (the identity column, pinned and resizable: title in `text-foreground`, below it host and path in mono with middle truncation), Entity (swatch and name, or "You"), Snippet (one line, full text in the tooltip), and the actions column with an "Open result" icon link (new tab, `webHref` only, `rel="noopener noreferrer nofollow"`); `rowTone` marks the own row). No sorting (the order is the page's); the search box filters by title, URL and entity. All default columns show at every width and the table scrolls sideways.
- [ ] **Step 8: Messages** (`keywordDetail.snapshots`):

```json
"snapshots": {
  "picker": { "label": "Snapshot", "latest": "Latest check", "option": "{when} · top {depth} · rank {rank}", "optionBeyond": "{when} · top {depth} · not in top {depth}", "urlChanged": "ranking URL changed", "previous": "Previous snapshot", "next": "Next snapshot", "older": "Load older snapshots", "atFirst": "This is the newest snapshot", "atLast": "This is the oldest snapshot loaded" },
  "heading": { "latest": "Latest check, {when}", "dated": "Snapshot of {when}" },
  "columns": { "rank": "Rank", "result": "Result", "entity": "Entity", "snippet": "Snippet", "open": "Open result" },
  "entity": { "you": "You", "watch": "Watched", "notTracked": "Not tracked" },
  "table": { "caption": "Organic results", "noun": { "one": "result", "other": "results" }, "search": "Filter results" },
  "titlesNote": "Titles are kept only for your pages, your competitors and the latest results.",
  "returned": "{returned} of the top {depth} results were returned.",
  "empty": { "pending": "No SERP snapshot yet", "pendingReason": "The first check creates one.", "failed": "The check failed, so there is no snapshot", "failedReason": "Check now tries again." },
  "gone": { "title": "This snapshot is no longer available", "clear": "Show the latest check" },
  "failed": "The snapshot did not load."
}
```

- [ ] **Step 9: End to end:** open the tab (`?tab=snapshots`) at 1440 px: the table has 20 rows, exactly one row is the own site (an `Entity` cell "You"), the own row's computed background differs from a third party row's (`getComputedStyle`), the competitor rows are named, the picker lists more than one snapshot; choose an older snapshot: `obs` is in the URL, Back removes it, the table has `depth_returned` rows; at 390 px the table scrolls inside its region and the page has no horizontal scroll; axe; screenshots at 1440, 1024, 390 px.
- [ ] **Step 10: Gates**, **commit** `git commit -m "Keyword detail: the SERP snapshots tab with the latest results and a snapshot picker"`, **stop and report**. **Step 11 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 7: Snapshot detail: provenance, features, AI Overview sources, raw download

**Files:**
- Create: `keyword-detail/snapshots/{snapshot-detail.tsx,snapshot-features.tsx,raw-download.ts,raw-download.test.ts,raw-download-button.tsx,snapshot-detail.test.tsx}`
- Modify: `keyword-detail/snapshots/snapshots-tab.tsx`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** none.

- [ ] **Step 1: Raw failure model test first** (`raw-download.test.ts`):

```ts
it.each([
  [410, 'raw_expired', 'expired'], [503, 'raw_unavailable', 'unavailable'], [403, 'forbidden', 'forbidden'],
  [404, 'not_found', 'notFound'], [500, undefined, 'failed'], [0, undefined, 'failed'],
] as const)('%i %s is %s', (status, code, expected) => {
  expect(rawFailureOf(status, code)).toBe(expected);
});
it('names the file as the API does', () => expect(rawFileName('812')).toBe('serp-snapshot-812.json'));
```

  Implement `rawFailureOf(status, code)` and `rawFileName(id)`. `downloadRaw(scope, snapshot)` reads `GET {P}/serp-snapshots/{id}/raw?observed_at=...` with the typed client (`parseAs: 'blob'`), makes an object URL, clicks a detached anchor with `download` set to `rawFileName`, and revokes the URL; it throws a typed error carrying `rawFailureOf(...)`. The page never renders the body and never puts it in the cache (no `useQuery`: a mutation).
- [ ] **Step 2: Detail component tests first** (`snapshot-detail.test.tsx`, MSW real handlers). With a snapshot selected the tab shows, under the picker, in this order:
  1. **Provenance line** (`type-meta`): "Checked {datetime in the project time zone} · {device} · {location} · {language} · top {requested}, {returned} returned · {provider code} · from cache" (the last part only when `served_from_cache`), and the own result: `RankCellView` for `own` with the ranking URL (`RankingUrlView`). No cost is shown: costs belong to the Costs screen.
  2. **Ranking URL change:** when the snapshot is flagged `urlChanged` in the picker model, a sentence "Ranking URL changed since the previous snapshot: {old path} to {new path}" with both paths as text; none when it did not.
  3. **Features in this snapshot** (`PlainTable`, at most 16 rows, left aligned): Feature (label via `FEATURE_MESSAGE_KEYS`, unknown codes shown by their code, never dropped), Position (`rank_absolute` or empty), Yours (a badge "Yours" with `#owned_position` when `owned_by_project`), Competitors (the names of `competitor_entity_ids` resolved against the project's entities, count when more than 2), Sources (the count of `source_urls`). Empty: "No SERP features in this snapshot".
  4. **AI Overview sources:** when the snapshot has an `ai_overview` feature, a disclosure "AI Overview sources ({n})" lists its `source_urls` as safe links (`webHref`, new tab, `nofollow`), the own domain marked "You", with the state from `ai_overview_state` ("Present", "Present, loaded after the page", "Present, not loaded" or "No AI Overview"). The `payload` of any feature is never rendered (assert: a feature fixture with a `payload` containing the text `<script>` shows nothing of it).
  5. **Raw answer:** a button "Download provider answer" present only for members with `raw:read`; for a viewer the button is absent (assert `queryByRole` is null and that the page does not mention the raw answer at all); on click it requests `/raw` once, shows a busy state, then a `status` message "Downloaded serp-snapshot-{id}.json"; the 14 day old fixture snapshot shows "The provider's answer is past its retention and was deleted." (410), the `mock_serp_raw=unavailable` cookie shows "The provider's answer could not be read now. Try again." with a working Try again (503), and focus returns to the button after each.
  6. The latest check (served from `serp-current`) has the same Features and Raw sections, reading the detail of `serp_snapshot_id` from `serp-current`.
- [ ] **Step 3: Implement** the components and wire them under the picker. Entity names come from `projectEntitiesQuery` (one request, cached with the inspector's). Run: PASS.
- [ ] **Step 4: Messages** (`keywordDetail.snapshots.detail`):

```json
"detail": {
  "provenance": "Checked {when} · {device} · {location} · {language} · top {requested}, {returned} returned · {provider}",
  "cached": "from cache",
  "own": "Your result",
  "urlChanged": "Ranking URL changed since the previous snapshot: {from} to {to}",
  "features": { "title": "SERP features in this snapshot", "caption": "SERP features", "feature": "Feature", "position": "Position", "yours": "Yours", "yoursAt": "Yours, #{position}", "competitors": "Competitors", "moreCompetitors": "{names} and {count} more", "sources": "Sources", "empty": "No SERP features in this snapshot" },
  "aio": { "title": "AI Overview sources ({count})", "state": { "absent": "No AI Overview", "present": "Present", "present_async_loaded": "Present, loaded after the page", "present_not_loaded": "Present, not loaded" }, "you": "You" },
  "raw": { "button": "Download provider answer", "busy": "Preparing the download", "done": "Downloaded {file}", "expired": "The provider's answer is past its retention and was deleted.", "unavailable": "The provider's answer could not be read now.", "forbidden": "You cannot download the provider's answer.", "notFound": "This snapshot no longer exists.", "failed": "The download failed.", "retry": "Try again" }
}
```

- [ ] **Step 5: End to end:** as the editor, choose the newest snapshot: the Features table has at least one row, the AI Overview disclosure expands with links that have `target="_blank"` and `rel` containing `noopener`, the Download button triggers a download (`page.waitForEvent('download')`) whose suggested file name is `serp-snapshot-<id>.json`; choose a snapshot older than 14 days: the expired sentence shows; as `mei@digibranders.test` (viewer) the button does not exist; axe; screenshots at 1440 and 390 px.
- [ ] **Step 6: Gates**, **commit** `git commit -m "Keyword detail: snapshot features, AI Overview sources and a controlled raw download"`, **stop and report**. **Step 7 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 8: SERP features strip

**Files:**
- Create: `apps/web/src/components/app/chart/heatmap.tsx`, `heatmap.test.tsx`; `keyword-detail/{features-model.ts,features-model.test.ts,features-panel.tsx,features-panel.test.tsx}`
- Modify: `keyword-detail/{detail-queries.ts,keyword-detail-screen.tsx}`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** `index.html` line 498, the "SERP features" card (title row, a count in `type-meta`); the grid follows 25 section 10.7 (`presence` scale: owned in `primary`, present in `chart-reference`, absent empty) and 24 section 9.4.

- [ ] **Step 1: Model test first** (`features-model.test.ts`):

```ts
it('lays out one row per feature seen, one column per check, oldest first, with the counts the API gives', () => {
  const grid = featureGrid(history([
    check('3', '2026-10-03', [['ai_overview', true], ['video', false]]),
    check('2', '2026-10-02', [['ai_overview', false]]),
    check('1', '2026-10-01', []),
  ], { ai_overview: [2, 3, 1, 2], video: [1, 3, 0, 1] }));
  expect(grid.checks.map((c) => c.snapshotId)).toEqual(['1', '2', '3']);
  expect(grid.rows.map((r) => [r.type, r.cells, r.present, r.owned, r.of])).toEqual([
    ['ai_overview', ['absent', 'present', 'owned'], 2, 1, 3],
    ['video', ['absent', 'absent', 'present'], 1, 0, 3],
  ]);
});
it('orders known features as the product lists them and unknown codes after, never dropping one', () => {
  const grid = featureGrid(history([check('1', '2026-10-01', [['zz_new_feature', false], ['video', false], ['ai_overview', false]])], {}));
  expect(grid.rows.map((r) => r.type)).toEqual(['ai_overview', 'video', 'zz_new_feature']);
});
it('has no rows for a window with no checks', () => {
  expect(featureGrid(history([], {})).rows).toEqual([]);
});
```

  `history(checks, presence)` builds a typed `SerpFeatureHistory` where `presence` maps a type to `[numerator, denominator, ownedNumerator, ownedDenominator]`. The counts shown come from the API's `presence_rate` and `own_ownership_rate` (`numerator` and `denominator`); a type seen in the checks but missing from `presence` (it cannot happen against the API) is counted from the checks. A second test over the mock's real answer asserts that the counts computed from the cells equal the API's numbers, so a mock that drifts fails.
- [ ] **Step 2: `Heatmap` component test first** (`heatmap.test.tsx`): renders a group named by `label` (the visual grid is `aria-hidden`); each row's label cell is a real text node "AI Overview" with its count "24 of 30"; the row's accessible description says "present in 24 of 30 checks, yours in 18"; a "Table" toggle (`aria-pressed`) swaps the grid for a `table` with a caption, a header row "Check, Depth, Features" and one row per check, newest first, whose Features cell lists names with "(yours)" for owned; legend swatches name the three states in text; cells are at least 8 px wide and 16 px tall (assert in the e2e, not jsdom). v1 implements `scale: 'presence'` only; the props are the inventory's (`rows`, `columns`, `cells`, `scale`, `cellLabels`) and a `scale` other than `presence` is a type error until a screen needs it. It is DOM, not ECharts: with 8 px cells the grid itself is the structure and the table is the alternative (a recorded deviation from 15 section 5, Task 13 writes it in the inventory).
- [ ] **Step 3: Panel tests first** (`features-panel.test.tsx`, MSW real handlers): a right rail panel "SERP features, last 30 checks" with the grid and the line "Yours in {n} of {m} AI Overview checks" only when `ai_overview` is present in some check; `limit_checks=30` is what is requested; a keyword with no checks shows "No checks yet" with the Decision 9 reason; a stale keyword says the strip ends at the last good check ("Last good check {date}"); a failed read shows the panel error with Try again while the chart still renders; with 16 features the panel height stays within 16 rows of 16 px plus gaps (e2e).
- [ ] **Step 4: Implement** (`Heatmap`, `featureGrid`, the panel in the rail, `serpFeaturesQuery(scope)` in `detail-queries.ts`), messages (`keywordDetail.features`: `title`, `caption`, `count`, `owned`, `legend`, `tableToggle`, `empty`, `emptyReason`, `staleNote`, `failed`) and wire the rail.
- [ ] **Step 5: End to end:** at 1440 px the rail sits to the right of the chart panel (rail left edge greater than evidence right edge) and at 1024 px below it (rail top greater than evidence bottom); the Table toggle shows a table with 30 rows for a keyword with 30 checks and one row per feature in the grid, each label ending in its "k of 30" count; the grid region is at least `rows x 16 px` tall and its width fits the rail without a horizontal scroll at 1440 px; for the AI Overview row, read the computed background of each cell by child index and the state of the same check from the Table view, and expect that cells of one state share a colour and cells of different states differ (absent, present, owned); axe; screenshots at 1440, 1024, 390 px.
- [ ] **Step 6: Gates**, **commit** `git commit -m "Keyword detail: the SERP features strip"`, **stop and report**. **Step 7 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 9: Rank events feed and the chart's event strip

**Files:**
- Create: `apps/web/src/components/app/status/event-timeline.tsx`, `event-timeline.test.tsx`; `keyword-detail/{events-model.ts,events-model.test.ts,events-panel.tsx,events-panel.test.tsx}`
- Modify: `keyword-detail/{detail-queries.ts,detail-url-state.ts,detail-url-state.test.ts,rank-history-controls.tsx,keyword-detail-screen.tsx}`, `src/lib/charts/rank-chart.ts` (+ `rank-chart.test.ts`), `rank-history/{rank-history-model.ts,rank-history-model.test.ts,use-rank-history-chart.ts}`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** `perf-detail.js` "What changed" (line 241): dated rows with a glyph and a short sentence. The structure is 18-notifications-alerts.md section 7 and 25 section 12.1 (64 px date column on a day's first event, rows at least 28 px, "Show older events" as a `secondary` button), which win.

- [ ] **Step 1: Kinds model test first** (`events-model.test.ts`):

```ts
const ALL_TYPES = [
  'entered_top_3', 'entered_top_10', 'entered_top_20', 'entered_top_100', 'lost_top_3', 'lost_top_10', 'lost_top_20', 'lost_top_100',
  'new_ranking', 'lost_ranking', 'rank_drop', 'rank_gain', 'url_changed', 'feature_gained', 'feature_lost',
  'aio_appeared', 'aio_disappeared', 'aio_citation_gained', 'aio_citation_lost', 'overtaken_by', 'overtook',
] as const;

it('puts each of the 21 event types of the backend in exactly one kind', () => {
  expect(ALL_TYPES).toHaveLength(21);
  for (const type of ALL_TYPES) expect(EVENT_KINDS.filter((kind) => typesOf([kind]).includes(type))).toHaveLength(1);
  expect(EVENT_KINDS.flatMap((kind) => typesOf([kind])).sort()).toEqual([...ALL_TYPES].sort());
});
it('does not guess the kind of a code it does not know', () => {
  expect(kindOf('entered_top_10')).toBe('rank');
  expect(kindOf('url_changed')).toBe('url');
  expect(kindOf('aio_citation_lost')).toBe('ai_citation');
  expect(kindOf('overtook')).toBe('competitor');
  expect(kindOf('something_new')).toBeNull();
});
it('asks for no type filter at all when every kind is chosen, and for the union otherwise', () => {
  expect(eventTypeFilter([...EVENT_KINDS])).toBeUndefined();
  expect(eventTypeFilter(['url', 'competitor'])).toEqual(['url_changed', 'overtaken_by', 'overtook']);
});
it('keeps an event of an unknown type visible under All, with its code', () => {
  expect(eventView(event('something_new')).kind).toBeNull();
});
it('reads rank values as ranks or as not ranked, never as zero', () => {
  expect(eventView(event('rank_gain', { from_rank: 8, to_rank: 3 })).values).toEqual({ from: { kind: 'rank', rank: 8 }, to: { kind: 'rank', rank: 3 } });
  expect(eventView(event('lost_ranking', { from_rank: 14, to_rank: null })).values.to).toEqual({ kind: 'none' });
});
it('takes the paths of a URL change from the event, and none when the API sent no URL', () => {
  const withUrls = eventView(event('url_changed', { from_url: urlRef('/blog'), to_url: urlRef('/pricing') }));
  expect(withUrls.paths).toEqual({ from: '/blog', to: '/pricing' });
  expect(eventView(event('url_changed', { from_url: null, to_url: null })).paths).toEqual({ from: null, to: null });
});
```

  `event(type, extra?)` and `urlRef(path)` are typed builders of `RankEventOut` and `UrlRef` in the test file (no casts). `EVENT_KINDS` is `['rank', 'url', 'serp_feature', 'ai_citation', 'competitor']`, the `TimelineEventKind`s of 25 section 12.1 that apply; `typesOf(kinds)` lists the types; the mapping is: rank = the four `entered_top_N`, four `lost_top_N`, `new_ranking`, `lost_ranking`, `rank_gain`, `rank_drop`; url = `url_changed`; serp_feature = `feature_gained`, `feature_lost`, `aio_appeared`, `aio_disappeared`; ai_citation = `aio_citation_gained`, `aio_citation_lost`; competitor = `overtaken_by`, `overtook`. `eventView(event: RankEventOut)` returns codes: `{ id, kind, type, at, values, paths, featureType, other, snapshotId }`, no English.
- [ ] **Step 2: `EventTimeline` component test first** (`event-timeline.test.tsx`): groups events by project local day, newest first, one `section` per day with a visually hidden `h4` holding the day, an `ol` of items, each with a `time` element carrying `datetime`, the sentence given by the caller and a source link; the date shows on a day's first event only; a group "Event types" of toggle buttons (`aria-pressed`) filters; "Show older events" appears only when `onLoadMore` is given, calls it once per press, and after the last page is gone focus moves to the list's heading (assert `document.activeElement`); an `aria-live` region announces "{n} more events loaded"; empty and loading states; a highlighted event (`highlightId`) is marked with `aria-current`. Props follow 25 section 12.1 (`events`, `filter`, `onFilterChange`, `pageSize`, `onLoadMore`, `highlightId`); the component receives finished sentences, it formats nothing. Implement.
- [ ] **Step 3: Query and URL state.** `rankEventsQuery(scope, kinds)` in `detail-queries.ts`: a `useInfiniteQuery` over `GET {P}/seo/rank-events` with `filter[tracked_keyword_id]`, `filter[event_type_in]` from `eventTypeFilter(kinds)` (omitted for all kinds), `limit: 50`, the cursor from `page.next_cursor`. Add `events` (comma list of kinds, replace) to `detail-url-state`; unknown kinds are dropped; test the round trip and that "all kinds" is written as no key.
- [ ] **Step 4: Panel tests first** (`events-panel.test.tsx`, MSW real handlers): the last panel of the rail is "Events" with the 50 newest events of the keyword, each sentence from the messages with real ranks ("Rank improved from #8 to #3"), URL changes naming both paths, feature events naming the feature (`FEATURE_MESSAGE_KEYS`), overtakes naming the competitor; each event has a link "Open snapshot" to `?tab=snapshots&obs=<snapshot id>`; pressing the "Ranking URL" toggle requests `filter[event_type_in]=url_changed` and writes `events=url`, and the list shows only URL changes; "Show older events" requests the next cursor and appends 50 without reordering what was there; a keyword with no events says "No events yet" plus the Decision 9 reason (pending: the first check is needed; failed; otherwise "Nothing has changed since tracking began"); a failed read has its own Try again.
- [ ] **Step 5: Implement** the component and the panel. Messages `keywordDetail.events`:

```json
"events": {
  "title": "Events", "filter": "Event types", "older": "Show older events", "olderLoaded": "{count} more events loaded", "open": "Open snapshot",
  "kinds": { "rank": "Rank", "url": "Ranking URL", "serp_feature": "SERP features", "ai_citation": "AI Overview citation", "competitor": "Competitors" },
  "rank": { "ranked": "#{rank}", "none": "not ranked" },
  "types": {
    "entered_top_3": "Entered the top 3, from {from} to {to}", "entered_top_10": "Entered the top 10, from {from} to {to}",
    "entered_top_20": "Entered the top 20, from {from} to {to}", "entered_top_100": "Entered the top 100, from {from} to {to}",
    "lost_top_3": "Left the top 3, from {from} to {to}", "lost_top_10": "Left the top 10, from {from} to {to}",
    "lost_top_20": "Left the top 20, from {from} to {to}", "lost_top_100": "Left the top 100, from {from} to {to}",
    "new_ranking": "Started ranking at {to}", "lost_ranking": "Stopped ranking, it was {from}",
    "rank_gain": "Rank improved from {from} to {to}", "rank_drop": "Rank dropped from {from} to {to}",
    "url_changed": "Ranking URL changed from {fromPath} to {toPath}",
    "feature_gained": "You now own {feature}", "feature_lost": "You no longer own {feature}",
    "aio_appeared": "An AI Overview appeared", "aio_disappeared": "The AI Overview disappeared",
    "aio_citation_gained": "Your site is now cited in the AI Overview", "aio_citation_lost": "Your site is no longer cited in the AI Overview",
    "overtaken_by": "{competitor} passed you, from {from} to {to}", "overtook": "You passed {competitor}, now at {to}",
    "unknown": "{code}"
  },
  "empty": "No events yet", "emptyNone": "Nothing has changed since tracking began.", "failed": "The events did not load."
}
```

- [ ] **Step 6: The chart's event strip, test first.** `rank-chart.test.ts`:

```ts
it('marks the events on the bottom edge of the plot with a shape per family, not by colour alone', () => {
  const option = rankAxis(base, tokens, { depthMax: 20, plotHeight: 240, bands: [], guide: () => '', bandLabel: () => '',
    eventMarks: [{ index: 1, family: 'url', label: 'Ranking URL changed' }, { index: 2, family: 'rank', label: 'Entered the top 10' }, { index: 3, family: 'aio', label: 'An AI Overview appeared' }] });
  const marks = (option.series as { markPoint?: { data: { coord: number[]; symbol: string; name: string }[] } }[])[0]?.markPoint?.data ?? [];
  expect(marks.map((m) => [m.coord[0], m.symbol, m.name])).toEqual([[1, 'diamond', 'Ranking URL changed'], [2, 'pin', 'Entered the top 10'], [3, 'rect', 'An AI Overview appeared']]);
});
it('keeps the failed check triangles beside the event marks', () => {
  const option = rankAxis(base, tokens, { depthMax: 20, plotHeight: 240, bands: [], guide: () => '', bandLabel: () => '', failedIndices: [0], failedLabel: 'Check failed', eventMarks: [{ index: 2, family: 'url', label: 'Ranking URL changed' }] });
  const marks = (option.series as { markPoint?: { data: { coord: number[]; symbol: string }[] } }[])[0]?.markPoint?.data ?? [];
  expect(marks.map((m) => [m.coord[0], m.symbol])).toEqual([[0, 'triangle'], [2, 'diamond']]);
});
```

  `eventMarks` is a new member of `RankAxisExtras` (`{ index; family: 'url' | 'rank' | 'aio'; label }[]`), merged into the one `markPoint` of the first series with the failed glyphs. In `rank-history-model.ts` add the pure `eventMarksOf(events: readonly HistoryEvent[], slots, ownEntityId, labelOf)`: only the chart families (`url_changed` is `url`; `entered_top_10` and `lost_top_10` are `rank`; `aio_appeared` and `aio_disappeared` are `aio`; 15 section 7 rule 6) and only events of the own entity; the index is the slot whose `observedAt` equals `occurred_at`, else the last slot of that local date, and an event outside the categories is dropped; the marks come back sorted by index. Test (`rank-history-model.test.ts`):

```ts
it('maps the chart families, drops a competitor event, and puts an event on the check it names', () => {
  const slots = [slot('2026-10-01T02:00:00.000Z', '2026-10-01'), slot('2026-10-02T02:00:00.000Z', '2026-10-02'), slot('2026-10-02T14:00:00.000Z', '2026-10-02')];
  const events = [
    hev('url_changed', '2026-10-02T14:00:00.000Z', 'own'), hev('aio_appeared', '2026-10-01T02:00:00.000Z', 'own'),
    hev('entered_top_10', '2026-10-02T02:00:00.000Z', 'rival'), hev('rank_gain', '2026-10-02T02:00:00.000Z', 'own'),
  ];
  expect(eventMarksOf(events, slots, 'own', (type) => type)).toEqual([
    { index: 0, family: 'aio', label: 'aio_appeared' }, { index: 2, family: 'url', label: 'url_changed' },
  ]);
});
``` The Events layer (`show=events`, a toggle "Events" beside Absolute and Deep checks, off by default) turns the marks on; the chart summary gains "{count} events are marked on the chart and listed under Events" when on. Recorded limit: 15 section 7 draws a strip **under** the x axis; this draws the glyphs on the bottom edge of the plot (a second grid for a real strip is Open question 4), and a screenshot in the end to end step shows they do not collide with the band label.
- [ ] **Step 7: End to end:** the Events panel lists events in newest first order (read two adjacent `time` values and compare); toggling Ranking URL leaves only URL rows; Show older events increases the row count; turning on the Events layer adds glyphs (the legend or the toggle's `aria-pressed` and the summary sentence change; the canvas pixel count of non-background pixels increases); at 1024 px the Events panel is below the features panel; axe; screenshots at 1440, 1024, 390 px.
- [ ] **Step 8: Gates**, **commit** `git commit -m "Keyword detail: the rank events feed and the chart's event glyphs"`, **stop and report**. **Step 9 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 10: Target and ranking URL; competitor ranks

**Files:**
- Create: `keyword-detail/{url-model.ts,url-model.test.ts,url-panel.tsx,competitor-ranks-model.ts,competitor-ranks-model.test.ts,competitor-ranks-panel.tsx,evidence-panels.test.tsx}`
- Modify: `keyword-detail/{detail-queries.ts,keyword-detail-screen.tsx}`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** none. Components: `PlainTable` (at most a dozen rows), `Badge`, `RankCellView`/`RankChangeView`, `EntitySwatch`.

- [ ] **Step 1: URL model test first** (`url-model.test.ts`):

```ts
it('says whether the ranking URL is the target, from the API and not from a string compare', () => {
  expect(targetMatchOf({ target: null, match: null })).toEqual({ kind: 'noTarget' });
  expect(targetMatchOf({ target: url('/pricing'), match: null })).toEqual({ kind: 'notRanking' });
  expect(targetMatchOf({ target: url('/pricing'), match: true })).toEqual({ kind: 'match' });
  expect(targetMatchOf({ target: url('/pricing'), match: false })).toEqual({ kind: 'mismatch' });
});
it('lists only ranking URL changes, newest first, with both paths and the snapshot', () => {
  const changes = urlChangesOf([event('rank_gain'), event('url_changed', { at: '2026-10-12T02:00:00Z', from: '/blog', to: '/pricing', snapshot: '7' }), event('url_changed', { at: '2026-10-30T02:00:00Z', from: '/pricing', to: '/blog', snapshot: '9' })]);
  expect(changes.map((c) => [c.fromPath, c.toPath, c.snapshotId])).toEqual([['/pricing', '/blog', '9'], ['/blog', '/pricing', '7']]);
});
it('counts the URL changes of the window from the history events of the own entity only', () => {
  const events = [hev('url_changed', 'own'), hev('url_changed', 'own'), hev('url_changed', 'rival'), hev('rank_gain', 'own')];
  expect(urlChangeCount(events, 'own')).toBe(2);
});
```

  `event`, `hev`, `url` are typed builders in the test file. `urlChangesOf(events: readonly RankEventOut[]): UrlChange[]` (`{ id, at, fromPath, toPath, snapshotId }`), `targetMatchOf({ target, match })`, `urlChangeCount(historyEvents, ownEntityId)`.
- [ ] **Step 2: Competitor model test first** (`competitor-ranks-model.test.ts`), over typed `RankHistory` builders:

```ts
// historyOfEntities({ Name: [[daysAgo, rank | null], ...] }, { today, depth }): the first key is the own entity
const history = historyOfEntities(
  { Fynix: [[33, 5], [5, 4], [0, 3]], HubSpot: [[33, 2], [5, 1], [0, 1]], Pipedrive: [[33, 3], [5, 6], [0, null]] },
  { today: '2026-11-02', depth: 20 },
);

it('compares the latest check with the one about 30 days earlier, else with the first check of the window', () => {
  const rows = competitorRows(history);
  expect(rows.map((r) => [r.entity.canonical_name, r.now, r.earlier, r.change])).toEqual([
    ['Fynix', 3, 5, { kind: 'up', by: 2 }], ['HubSpot', 1, 2, { kind: 'up', by: 1 }], ['Pipedrive', null, 3, { kind: 'dropped' }],
  ]);
  expect(comparisonDate(history)).toBe('2026-09-30');
});
it('falls back to the first check of a window shorter than 30 days', () => {
  const short = historyOfEntities({ Fynix: [[6, 9], [0, 7]], HubSpot: [[6, 4], [0, 5]] }, { today: '2026-11-02', depth: 20 });
  expect(competitorRows(short).map((r) => [r.earlier, r.change])).toEqual([[9, { kind: 'up', by: 2 }], [4, { kind: 'down', by: 1 }]]);
  expect(comparisonDate(short)).toBe('2026-10-27');
});
it('puts the own site first, then ranked entities by rank, then those beyond the depth, then those with no successful check, ties by name', () => {
  const mixed = historyOfEntities(
    { Fynix: [[0, 7]], Zeta: [[0, 2]], Alpha: [[0, 2]], Deep: [[0, null]], Gone: [[0, 'failed']] },
    { today: '2026-11-02', depth: 20 },
  );
  expect(competitorRows(mixed).map((r) => r.entity.canonical_name)).toEqual(['Fynix', 'Alpha', 'Zeta', 'Deep', 'Gone']);
});
it('counts the checks in which each entity ranked within the window', () => {
  expect(competitorRows(history).map((r) => r.ranked)).toEqual([{ k: 3, of: 3 }, { k: 3, of: 3 }, { k: 2, of: 3 }]);
});
```

  The change uses `classifyRankChange` from `lib/format/rank.ts` (read its signature; do not re-derive the rules), compared **within the smaller depth** of the two checks as the API does, so a rank deeper than the compared depth is "beyond", not a claimed move. The own row is first and named "You" in the panel; competitors follow in the order above. `historyOfEntities` is a typed builder in the test file (a rank of `'failed'` makes a failed point). Implement `competitorRows(history)` (the own entity is the series whose `entity.role` is `own`) and `comparisonDate(history)`.
- [ ] **Step 3: Panel tests first** (`evidence-panels.test.tsx`, MSW real handlers):
  1. **Target and ranking URL** panel: "Target /pricing", "Ranking /blog/best-crm", a "Mismatch" warning badge with the text (not colour alone) when `target_url_match === false`, "Matches target" when true, "No target URL" with no badge when none, "Not ranking" when the keyword does not rank; "{n} of your URLs rank" when `ranking_url_count > 1`; a `PlainTable` "Ranking URL changes" (Date, From, To, Snapshot) with the 10 newest from `rankEventsQuery` (`event_type_in=url_changed`), "Show all {n}" when the API has more, and each Snapshot cell a link to `?tab=snapshots&obs=`; "No ranking URL changes in the last 90 days" when none (the window follows `win`); "{n} ranking URL changes in the last {window}" from the history events; the pending keyword shows the Decision 9 sentence instead of an empty table.
  2. **Competitor ranks** panel: a `PlainTable` with Competitor (swatch, name, role as text), Now, Earlier, Change, Best in window, Ranked checks "28 of 30"; a caption "Compared with {date}"; tracked competitors only, with the line "Every domain of one check is in SERP snapshots" linking to the tab; with no effective competitors "No competitors are tracked for this keyword" and a link to the inspector's competitor settings (`?inspect=keyword:{id}` on the list); all values read from the same history request as the chart (assert one `rank-history` request in total for the page).
  3. Column set and alignment: every column is left aligned (`text-align` computed `left` for each header and cell in the e2e), none is hidden at 390 px; the table scrolls inside its region.
- [ ] **Step 4: Implement** both panels and wire them under the chart in the evidence column. Messages `keywordDetail.url` and `keywordDetail.competitors` (titles, column headers, badge texts, empty and error sentences, as above, all ICU). **Step 5: End to end** (rows exist, Mismatch badge text on a fixture whose ranking URL differs from its target, Snapshot links change the tab and `obs`; screenshots at 1440, 1024, 390 px; axe).
- [ ] **Step 6: Gates**, **commit** `git commit -m "Keyword detail: target and ranking URL, and competitor ranks"`, **stop and report**. **Step 7 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 11: AI Overview history

**Files:**
- Create: `keyword-detail/{aio-model.ts,aio-model.test.ts,aio-panel.tsx,aio-panel.test.tsx}`
- Modify: `keyword-detail/{detail-queries.ts,keyword-detail-screen.tsx}`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** `prompts-parts.js` `keywordRow` (the cited badge in `positive-subtle`); the cell wording is 12-tables.md section 6 and `AioStatusView`, which win.

- [ ] **Step 1: Model test first** (`aio-model.test.ts`):

```ts
it('maps an item to the cells the keywords table already uses', () => {
  const row = aioRow(item({ ai_overview_state: 'present_cited', own_citation_position: 2, competitors_cited: [ref('g2.com'), ref('hubspot.com'), ref('zapier.com')], source_count: 7 }));
  expect(row.display).toEqual({ kind: 'cited', position: 2 });
  expect(row.citedInstead).toEqual({ names: ['g2.com', 'hubspot.com'], more: 1 });
  expect(row.sources).toBe(7);
});
it('says nothing about citations for a check without an AI Overview or one that did not load', () => {
  expect(aioRow(item({ ai_overview_state: 'absent' })).display).toEqual({ kind: 'absent' });
  expect(aioRow(item({ ai_overview_state: 'not_loaded' })).display).toEqual({ kind: 'notLoaded' });
  expect(aioRow(item({ ai_overview_state: 'unknown' })).display).toEqual({ kind: 'unknown' });
  expect(aioRow(item({ ai_overview_state: 'absent' })).citedInstead).toEqual({ names: [], more: 0 });
});
it('counts checks with a block over the checks that could be read, with the strip\'s own function', () => {
  const items = [item({ ai_overview_state: 'present_cited' }), item({ ai_overview_state: 'absent' }), item({ ai_overview_state: 'not_loaded' })];
  expect(aioCounts(items)).toEqual({ present: 1, of: 2 });
});
```

  `aioCounts` is imported from `strip-model.ts` (one definition, two users); `item` and `ref` are typed builders of `AioHistoryItem` and `EntityRef`. `aioRow(item)` uses `aioDisplay({ state, citation_position: own_citation_position, observation_id }, organic_rank.state)` so the cell and the table cell cannot disagree.
- [ ] **Step 2: Panel tests first** (`aio-panel.test.tsx`, MSW real handlers): a `DataTable` (client mode, the minimal prop set of `runs-screen.tsx`) named "AI Overview checks" with Date, AI Overview (`AioStatusView`), Cited instead, Sources, Rank (`RankCellView`) and a "View snapshot" link column (right aligned, the only one); capped at 10 rows with a button "Show all {n} checks" that becomes "Show fewer" and keeps focus (assert `document.activeElement` is the same button after pressing Enter); the request carries `from` and `to` of `windowDates(win, today)`; a keyword with no AI Overview in the window says "No AI Overview in this window" (24 section 9.4 / 20 section 12 "not applicable"), a pending keyword the Decision 9 reason, a failed read its own Try again; "View snapshot" goes to `?tab=snapshots&obs=<serp_snapshot_id>`; there is **no** claim of showing the AI Overview's text (the API has no route for it: Backend requests 3).
- [ ] **Step 3: Implement** and wire below the competitor panel. Messages `keywordDetail.aio` (`title`, `caption`, `columns`, `citedInstead` with `{names} and {count} more`, `showAll`, `showFewer`, `empty`, `emptyReason`, `viewSnapshot`, `failed`). **Step 4: End to end:** rows exist and the first row's Date is newer than the last's; Show all expands and the row count increases; View snapshot opens the tab with `obs`; at 390 px the table scrolls inside its region; axe; screenshots.
- [ ] **Step 5: Gates**, **commit** `git commit -m "Keyword detail: AI Overview history"`, **stop and report**. **Step 6 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 12: Compare two snapshots

**Files:**
- Create: `keyword-detail/snapshots/{compare-model.ts,compare-model.test.ts,compare.test.tsx}`
- Modify: `keyword-detail/snapshots/{snapshots-tab.tsx,serp-table.tsx,snapshot-picker.tsx}`, `messages/en.json`, `e2e/flows/keyword-detail.spec.ts`

**Mock reference:** none. Not in scope: the top 10 RBO distance (24 section 9.4); it needs a metric definition the owner has not fixed. Task 13 records it in the documents as not built.

- [ ] **Step 1: Model test first** (`compare-model.test.ts`). Rows are matched by `url.url_id`; the comparison is read **within the smaller depth of the two snapshots**, as the backend reads a change, so a result below that depth is never called new:

```ts
it('marks a result as up, down, same or new against the older snapshot', () => {
  const result = compareSnapshots({ newer: rows([[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd']], 20), older: rows([[2, 'a'], [1, 'b'], [3, 'c']], 20) });
  expect(result.moves.get('a')).toEqual({ kind: 'up', by: 1 });
  expect(result.moves.get('b')).toEqual({ kind: 'down', by: 1 });
  expect(result.moves.get('c')).toEqual({ kind: 'same' });
  expect(result.moves.get('d')).toEqual({ kind: 'new' });
});
it('lists the older results that left the top of the newer one as dropped', () => {
  const result = compareSnapshots({ newer: rows([[1, 'a']], 20), older: rows([[1, 'z'], [2, 'a']], 20) });
  expect(result.dropped.map((r) => [r.rank, r.url.url_id])).toEqual([[1, 'z']]);
});
it('claims nothing below the smaller depth: a result at 30 in a depth 50 snapshot against a depth 20 one is beyond, not new', () => {
  const result = compareSnapshots({ newer: rows([[1, 'a'], [30, 'x']], 50), older: rows([[1, 'a']], 20) });
  expect(result.moves.get('x')).toEqual({ kind: 'beyond' });
  expect(result.comparedDepth).toBe(20);
});
it('does not call the older results below the compared depth dropped', () => {
  const result = compareSnapshots({ newer: rows([[1, 'a']], 20), older: rows([[1, 'a'], [40, 'y']], 100) });
  expect(result.dropped).toEqual([]);
});
```

  `rows(pairs, depth)` builds `SerpRow`s plus the snapshot's `depthReturned`. `compareSnapshots({ newer, older })` returns `{ moves: Map<key, Move>, dropped: SerpRow[], comparedDepth }`, `Move = same | up(by) | down(by) | new | beyond`. Run: FAIL, implement, PASS.
- [ ] **Step 2: Component tests first** (`compare.test.tsx`): a second `Select` "Compare with" lists the other loaded snapshots plus "None"; choosing one writes `vs=<id>` (push) and adds a **Change** column to the table with text ("Up 1", "Down 2", "New", "Same", "Beyond the compared depth") and an arrow icon whose meaning is also in the text; dropped results appear in a `PlainTable` "Left the top results" under the table; a note "Compared within the top {depth}, the smaller of the two checks" shows when the depths differ; `vs` equal to `obs` is dropped; `vs` of an unknown snapshot shows "This snapshot is no longer available" with a link that clears it; the Change column is left aligned like the others; with no `vs` nothing about comparison is on the page; Back removes `vs`.
- [ ] **Step 3: Implement**, messages `keywordDetail.snapshots.compare` (`label`, `none`, `up`, `down`, `same`, `new`, `beyond`, `droppedTitle`, `droppedCaption`, `depthNote`, `gone`), wire. **Step 4: End to end:** pick two snapshots: the Change column has at least one non-empty cell, the dropped table has a caption, the URL has `obs` and `vs`, Back removes `vs`; axe; screenshots at 1440 and 390 px.
- [ ] **Step 5: Gates**, **commit** `git commit -m "Keyword detail: compare two SERP snapshots"`, **stop and report**. **Step 6 (lead): Sonnet review**, fixes, gates, amend.

---

### Task 13: End to end, responsive and accessibility checks, documents, whole-branch review

**Files:**
- Modify: `apps/web/e2e/flows/keyword-detail.spec.ts`, `apps/web/e2e/flows/rankings.spec.ts` (only if a flow of Task 3 touches it), `apps/web/e2e/visual/pages.spec.ts`
- Modify (documents, Edit and Write tools only): `docs/20-frontend-specification.md` (section 3.2 "Built so far" table: the new route; section 5.4: an as-built paragraph that lists what is built and what is not: related prompts, GSC, Diagnostics, cannibalization, RBO, volatility, URL stability), `docs/design-system/24-page-templates.md` (section 9.4 as-built paragraph), `docs/design-system/13-filters-search.md` (section 5 key table: `win` also on the detail page, `comp`, `show`, `events` kinds, and `obs`, `vs` meaning a SERP snapshot on the keyword page), `docs/design-system/25-component-inventory.md` (`DetailPageHeader`, `EventTimeline`, `Heatmap` as built; deviations: `Heatmap` is DOM with a table view and `presence` only; event glyphs on the plot edge; `DataTable.rowTone`; `ChartFrame` consumers `useRankHistoryChart`), `docs/31-implementation-checklist.md` (line 145: Keyword Detail v1 built with the list of what remains), `docs/review-log.md` (a row), `docs/superpowers/plans/2026-10-29-rank-features-ui.md` (Task 7's as-built note: a pointer to this plan for the events strip, deep checks, other windows and absolute rank)

- [ ] **Step 1: The tour.** One end to end test walks the page as an editor at 1440 px: Keywords, open a ranked keyword, "Open page"; the order of the regions in the DOM and on screen is header, strip, tabs, chart, URL panel, competitor ranks, AI Overview history on the left and features, events on the right (bounding boxes); every panel has a heading; Check now: click it, advance the clock (`page.clock.runFor`) until the run completes, and the chart's meta line reports one more check than before (read the number before and after), the strip's Rank cell matches the list.
- [ ] **Step 2: Responsive.** At 1440, 1280, 1279, 1024, 768 and 390 px: no horizontal page scroll (`scrollWidth <= innerWidth`); the rail is beside the evidence column at 1440 and 1280 and below it at 1279 and narrower (left edges and tops); the strip is one row at 1440 and wraps by 1024; every table scrolls inside its own region at 390 px and keeps its identity column; the header actions wrap under the title below 768 px; the tab list is a scrollable row below 768 px. Save a screenshot per width (`test-results/keyword-detail-<width>.png`) and list the paths in the report.
- [ ] **Step 3: Keyboard and accessibility.** A keyboard-only flow (no mouse): Tab from the page start reaches the back link, Check now, Open ranking page, More, the tabs, the chart controls, the chart's Table view button, the panels' controls, in DOM order with a visible focus ring (assert `:focus-visible` outline width greater than 0 on each); Escape closes the More menu and returns focus to its button; arrow keys switch tabs; Enter on the snapshot picker option chooses it and the focus is back on the picker. Axe passes on the Overview tab, the SERP snapshots tab with a snapshot and a comparison open, in light and dark themes (`page.emulateMedia({ colorScheme })`), and for a viewer. The page text contains no en or em dash (`expectAccessible` checks it).
- [ ] **Step 4: Honest states in the browser:** the pending fixture, the failed fixture, the stale fixture and an archived fixture each load the page; for each, every panel shows the Decision 9 wording (a table of expected sentences in the test), none shows a zero where there is no data, and none shows a spinner after the page is idle.
- [ ] **Step 5: Visual.** Add the detail page (Overview, SERP snapshots) to `e2e/visual/pages.spec.ts` for the pinned image; no baseline is committed.
- [ ] **Step 6: Documents** as listed under Files, each with the real facts of the built page (route, the keys, what is not built and why, the mock-versus-API notes), no dash characters, and a review-log row. Do not edit `docs/20` text outside the two places named.
- [ ] **Step 7: Full gates** (all in `apps/web`, outputs shown): `pnpm lint`, `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm format:check`, `pnpm test` (the whole suite), `pnpm build`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm e2e` (the whole suite), the dash check over every file changed on the branch (`git diff --name-only develop...HEAD | xargs LC_ALL=C grep -nP "\xE2\x80[\x93\x94]"` prints nothing).
- [ ] **Step 8: Commit** `git commit -m "Keyword detail: end to end, responsive checks and documents"`, **stop and report**.
- [ ] **Step 9 (lead): whole-branch review on Sonnet** with this plan and the diff from the branch point (`git diff develop...HEAD`); every Critical and Important finding is fixed with its test first; the full gates again; amend. The branch is then merged into `develop` by the main session, never into `main` and never pushed by the builder.

---

## Order and sizing

Cheapest and most valuable first, with the dependencies that make the order forced.

| Run | Tasks | Size | Why this order |
|---|---|---|---|
| A | 1, 2 | Large, large | Nothing else can be built or tested without the world: it carries the snapshot ids that join the chart, the strip, the features and the events. The history handler fixes (failed checks outside `checks`, real bands, `include`) also correct a defect in the inspector card (Task 1 Step 9). Two commits because Task 2 is the second half of the same world and is independent to review |
| B | 3 | Medium to large | The route, the layout trap, "Open page" and the state model. Every later task renders inside it. The first thing a person can use |
| C | 4, 5 | Medium, medium | The chart is what people open the page for, and it needs only the history route; it forces the shared extraction, which is cheaper before more callers exist. The strip needs the chart's query and `rankStats`, so it follows |
| D | 6, 7 | Large, medium | The SERP viewer is the second reason for the page (roadmap Phase 4). 6 is the table and the picker; 7 adds the detail, which is where the permission and the raw download live |
| E | 8, 9, 10, 11 | Small to medium each | Four independent panels on routes the mock already serves. Order by value: features strip (cheap, uses the new `Heatmap`), events (also feeds the chart glyphs), URL and competitors (existing data), AI Overview history. They share `keyword-detail-screen.tsx` for wiring, so they go in sequence, not in parallel |
| F | 12 | Small | Pure comparison and one column; last because it needs both the picker and the table |
| G | 13 | Medium | After everything |

One builder can do A and B in one session (each task stops for review), C and D in the next, then E, F and G. If two builders are free, Task 8 (the `Heatmap`) and Task 9's `EventTimeline` component are independent of the screen after Task 3 and could be built in separate worktrees; the wiring commits then go in one after the other.

**Coverage of the brief.** Rank history with depth bands and competitors: 4. Chart events, absolute and deep checks: 4 and 9. SERP snapshot viewer with the own domain and competitors marked, a picker, the ranking URL change, features per snapshot, controlled raw: 6, 7. Features strip and history: 8 (and 7 per snapshot). AI Overview history: 11. Events feed: 9. Competitor ranks over time: 10. Target and ranking URL: 10. Metric strip: 5. Header, Check now, open ranking page, archive, depth, copy link: 3. Inspector link and Cmd click: 3. Compare: 12. Mock coverage of every route: 1 and 2. Documents: 13.

## Backend requests

None of these blocks a task of this plan. The first is for the list screen and was already requested by `2026-10-29-rank-features-ui.md` (Task 9); it is repeated so the request exists in one place with its exact shape.

1. **Rank summary** (for the Rankings strip: average rank, visibility, change against the previous period; it is **not** a task of this plan, and the detail page's Average rank comes from `rank-history`'s `summary.average_rank`):

   > `GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/rank-summary`, permission `data:read`. Query: every `filter[...]` of `GET {P}/tracked-keywords` (same names, same validation, same AND rules, `filter[q]` included), plus `compare` (`previous_period` or absent) and `window` (`last_7d`, `last_28d`, `last_90d`; default `last_7d`; used only for the comparison point). Answer `data`: `tracked`, `checked`, `ranked`, `top3`, `top10`, `top20` (integers); `average_rank` (`MetricValue`, `n_observations` the ranked plus beyond count, null when none ranked); `visibility` (`MetricValue`, a share from 0 to 1, with `scheme` and `volume_mode` named); `compare` with the same members as of the comparison date, or null without `compare`. `meta.as_of` is the timestamp of the newest check counted. Errors as the list (`422 validation_failed` per parameter).
2. **Typed codes in the OpenAPI document** (optional, removes a mirrored list): `RankEventOut.event_type` and `HistoryEvent.event_type` as an enum of the 21 types of migration 0013; `SerpFeatureOut.feature_type`, `FeaturePresence.feature_type` and `RankEventOut.feature_type` as an enum of the 16 codes. Today they are plain strings, so the web app mirrors both lists (`events-model.ts`, `lib/keywords/serp-features.ts`) and shows an unknown code by its code. With enums a new code would fail the build instead.
3. **A documented shape for `SerpFeatureOut.payload`** (optional, only if AI Overview text should be shown): the keys for `ai_overview` (text blocks, references) or a read route for one feature of a snapshot. The page renders only structured fields until then and never the payload.

## Open questions for the owner

Each has a default that the plan already follows; say so only if you want it changed.

1. **Cmd or Ctrl click on a Keywords row.** Today it opens the list with the inspector in a new tab. 12-tables.md section 13 says it opens the full detail page in a new tab; Task 3 changes it to that. Default: change it.
2. **The raw provider answer.** Default: a download for members with `raw:read` (owner, admin, editor, analyst), nothing for viewers, never rendered in the page, because it can be megabytes of untrusted data. Do you also want an escaped, collapsed in-page view for those roles (doc 20 section 4.9 "Raw mode")?
3. **Snapshot picker.** Default: a list of the snapshots that exist (with Previous and Next), not a calendar, because a calendar offers days with no snapshot and `DatePicker` is "Later" in the inventory. Is a calendar wanted for long histories?
4. **Event glyphs on the chart.** Default: drawn on the bottom edge of the plot. 15 section 7 shows a strip under the x axis, which needs a second chart grid and a taller chart. Worth the extra size?
5. **Two metric definitions.** "Days in top 10" counts distinct project local days with at least one check in the top 10, over the days checked (the API has no such field). Competitor ranks compare the latest check with the one about 30 days earlier, or with the first check of the window when the window is shorter. Confirm both, or give the definitions you want.

## As-built notes

- **Task 1 (Mocks: a rank world with snapshots, URL changes and per check features):** Created serp-world.ts and test suite implementing snapshotIdOf, featuresAt, aioAt, placeRanks, worldChecks, serpOf, and titleOf. Updated rank-history.ts with time-keyed URL path changes every 17 to 29 days without altering walk ranks. Rewrote handlers/rank-history.ts to enforce real API summary rules (checks excludes failed checks, average_rank MetricValue, serp_snapshot_id per point, url/absolute includes, entity ordering, and depth bands per entity). Adjusted rankHistoryChart and RankHistorySection so all-failed keywords display the all-failed state instead of "No checks yet". In playwright.config.ts, switched from ambient PORT to E2E_PORT (default 3100) to isolate e2e execution. In costs.ts, standardized today() to new Date(Date.now()). In rankings.spec.ts, updated the 1280px minimum keyword width room from 250px to 200px and asserted Updated column presence and pending status across widths. In existing unit tests, pinned the mock clock to 2026-11-02T12:00:00Z in rank-strip.test.tsx and rankings.test.tsx to preserve deterministic Top 20 counts (26) and the exact sparkline summary string, and aligned failed check points in keyword-inspector.test.tsx to observed_at: null. All 6 gates passed clean, including all 19 Playwright rankings E2E tests.
- **Task 3 (Keyword detail: the page, its header and the link from the inspector):** The list moved by `git mv` into `seo/keywords/(list)/` and `pnpm build` lists the same two list routes plus the new `/[workspace]/[project]/seo/keywords/[tkId]`. The page is a server route (`isUuid` else `notFound()`) that renders `KeywordDetailScreen` from `features/rankings/keyword-detail/`: `DetailPageHeader` (new, in `components/app/shell/`, built on `PageHeader`, which gained a `lang` prop and `break-words` on its `h1`), the two underline tabs (`tab` in the URL, push history) with empty panels, and the not found, no access (`data:read`), loading and load failed states. The archive logic of the inspector moved unchanged into `useKeywordArchive`; `useCheckNow().inspectorAction` takes a third `presentation` argument (`page` is the primary 36 px button, `inspector` stays the 32 px secondary one; only the e2e measures the difference). Differences from the plan text: `rememberListHref(storage, path, search)` takes the list path so each project keeps its own remembered query, and `RankingsRoute` (which already reads the search string) calls it, not `RankingsScreen`; `RankingsScreen` now takes `workspaceSlug` and `projectSlug` to build the page path for "Open page" (through `guarded`) and for the Cmd, Ctrl or middle click, which now calls `window.open(keywordDetailPath(...), '_blank', 'noopener')` where it opened the list with `inspect=` before (no existing test pinned the old behaviour: a search of `src` and `e2e` for `window.open`, `inspect=` and the modifier clicks found none); `DetailPageHeader` has `facts`, `secondary`, `badges` and `archived`/`archivedLabel` instead of `objectFacts`; the plan's message key `header.neverChecked` is not used (`Not checked yet` is the badge) and `loading`, `header.groups`, `header.terms` and `header.openRankingPageNewTab` were added; the Open ranking page link carries an `aria-label` that says it opens in a new tab. `refreshKeywords` now also invalidates `[...project, 'seo', 'rank-events']` and `[...project, 'serp-snapshots']`. In `rankings.test.tsx` the `next/navigation` mock now shares one `push` spy, and `rankings-harness.tsx` passes the two slugs. Gates, in `apps/web`: `pnpm lint` and `pnpm exec tsc --noEmit` clean, `pnpm format:check` clean, vitest `src/mocks src/test src/features/rankings src/app src/components/app/shell src/lib/routes` 1118 passed (629 in `src/features/rankings`, 489 elsewhere; two full runs on a machine with load average 15 to 30 timed out in `rankings.test.tsx`, `bulk.test.tsx` and `keyword-inspector.test.tsx` and failed `refresh.test.tsx` with `root.getElementById is not a function`, none of them touched, and each passed alone), `pnpm build` green, e2e `rankings.spec.ts` plus `keyword-detail.spec.ts` 35 passed (19 and 16). The e2e screenshots (`keyword-detail-{1440,1280,1024,390}-{light,dark}.png`) are written to `test-results/` only, which is git-ignored and overwritten by the next run, so no screenshot is committed. The `break-words` added to the `h1` of `PageHeader` applies to every page that uses it, not only this one. After review: the two empty tab panels carry `tabIndex={-1}` until Task 4 fills them, the More button is the 36 px `icon` size, the Open ranking page link is a `next/link` inside `LinkButton` (no eslint disable), the no access copy follows `RunsScreen`, and a keyword deleted while its page is open keeps showing the last read (TanStack keeps the data of a failed read).

