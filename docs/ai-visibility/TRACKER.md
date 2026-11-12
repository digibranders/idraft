# AI visibility tracker

Updated 2026-11-12T23:30:00+05:30 by the coordinator. Source of truth: `tracker.json` (this table is rendered from it). Status words: not_started, planning, building, review, merged, blocked.

**Rows: 279 of 1296 done (21%). Packages: 0 of 74 merged. Open decisions: 51.**

| Wave | Packages | Merged | Rows done | Status |
|---|---|---|---|---|
| W0 Scaffolding, contracts and the lock | 4 | 0 | 2 of 8 | not_started |
| W1 Shared web packages and the first backend lanes | 11 | 0 | 23 of 109 | not_started |
| W2 Topics & Prompts, inspectors, Citations, dialogs, runs and settings | 17 | 0 | 218 of 637 | not_started |
| W3 AI Visibility Overview, Competitors page, notes | 9 | 0 | 2 of 82 | not_started |
| W4 Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette | 13 | 0 | 3 of 237 | not_started |
| W5 Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks | 10 | 0 | 8 of 105 | not_started |
| W6 Blocked by the provider or the owner: AI Overview engine and cross-channel, discovery sources, engine expansion, LLM features, first-party signals | 6 | 0 | 1 of 63 | not_started |
| W7 Optional: page-level AI readiness | 1 | 0 | 0 of 21 | not_started |
| X Cross-wave: quality sweeps, docs, releases and acceptance | 3 | 0 | 22 of 34 | not_started |

| Wave | WP | Title | Kind | Status | Rows done | % | Blockers | Session |
|---|---|---|---|---|---|---|---|---|
| W0 | [WP-00](work-packages/WP-00-coordination-kit.md) | Coordination kit: heavy-job lock, status files, worktree helper | infra | not_started | 0 of 0 | n/a | none | |
| W0 | [WP-01](work-packages/WP-01-backend-scaffold.md) | Backend scaffolding: routers, permissions, problem codes, test anchors | backend | not_started | 2 of 4 | 50% | none | |
| W0 | [WP-02](work-packages/WP-02-web-scaffold.md) | Web scaffolding: routes, navigation, seams, namespaces, mocks, moves, deps | web | not_started | 0 of 4 | 0% | none | |
| W0 | [WP-03](work-packages/WP-03-contract-pack.md) | Contract pack: OpenAPI shapes for the wave 1 and wave 2 backend items | backend | not_started | 0 of 0 | n/a | WP-01 | |
| W1 | [WP-04](work-packages/WP-04-chart-frame.md) | Chart platform: ChartFrame html mode, legend, tooltips, sample markers, boundaries | web | not_started | 0 of 1 | 0% | WP-02 | |
| W1 | [WP-05](work-packages/WP-05-chart-bars.md) | Chart parts: BarList, StackedShareBar, StepBars, IntervalBar | web | not_started | 0 of 1 | 0% | WP-02 | |
| W1 | [WP-06](work-packages/WP-06-chart-grids.md) | Chart parts: HeatmapGrid with tree rows, SmallMultiples, connected crosshair | web | not_started | 0 of 1 | 0% | WP-02 | |
| W1 | [WP-07](work-packages/WP-07-app-parts-a.md) | App components A: Delta, EngineLogo, Meter, Banner variants, statistics parts | web | not_started | 0 of 6 | 0% | WP-02 | |
| W1 | [WP-08](work-packages/WP-08-app-parts-b.md) | App components B: DomainCell, URLCell, count popover, ChangeFeed, inspector stepping | web | not_started | 0 of 4 | 0% | WP-02 | |
| W1 | [WP-09](work-packages/WP-09-table-extensions.md) | DataTable extensions: column groups, third tree level, right pin, context menu | web | not_started | 0 of 2 | 0% | WP-02 | |
| W1 | [WP-10](work-packages/WP-10-controls.md) | Mobile list rows, saved view presets menu, date range picker | web | not_started | 0 of 4 | 0% | WP-02 | |
| W1 | [WP-11](work-packages/WP-11-layouts-api.md) | Layouts API: core.layouts, five routes, catalog validation, audit | backend | not_started | 2 of 14 | 14% | WP-01, WP-03 | |
| W1 | [WP-12](work-packages/WP-12-summary-lane.md) | Summary additions: compare, total, rows, entities per week, co-mentions, filters | backend | not_started | 8 of 24 | 33% | WP-03 | |
| W1 | [WP-13](work-packages/WP-13-prompts-lane.md) | Prompt records: lint upgrade, type rule, filters, bulk update, quotas, provenance | backend | not_started | 8 of 31 | 25% | WP-03 | |
| W1 | [WP-14](work-packages/WP-14-sources-lane.md) | Sources and fan-out reads: series, country, min_support, lost, cited with, ads | backend | not_started | 5 of 21 | 23% | WP-03 | |
| W2 | [WP-15](work-packages/WP-15-layouts-react-core.md) | Layouts React core: registry, use-layout, provider, grid with dnd-kit, card frame | web | not_started | 7 of 26 | 26% | WP-02, WP-03 | |
| W2 | [WP-16](work-packages/WP-16-layouts-react-customize.md) | Layouts customize UI: catalog, numbers, save bar, team default, presets, undo | web | not_started | 0 of 24 | 0% | WP-15 | |
| W2 | [WP-17](work-packages/WP-17-tp-header-filters.md) | Topics & Prompts: header, filters, facets, strip, menus and shell items | web | not_started | 53 of 75 | 70% | WP-02, WP-07, WP-10, WP-13 | |
| W2 | [WP-18](work-packages/WP-18-tp-tables.md) | Topics & Prompts: table polish, stale, mobile rows, grouped header, In search counts | web | not_started | 46 of 72 | 63% | WP-09, WP-10, WP-07, WP-13 | |
| W2 | [WP-19](work-packages/WP-19-compare-deltas.md) | Compare with the previous period and deltas everywhere (W3) | web | not_started | 0 of 10 | 0% | WP-07, WP-12 | |
| W2 | [WP-20](work-packages/WP-20-topics-by-engine.md) | Topics by engine and the topic drawer (R-09, R-11 topic part) | web | not_started | 9 of 37 | 24% | WP-05, WP-06, WP-07, WP-12 | |
| W2 | [WP-21](work-packages/WP-21-citations-core.md) | Citations tab in the prompt inspector and the Citations page (Domains, Pages) | web | not_started | 0 of 31 | 0% | WP-08, WP-05, WP-10 | |
| W2 | [WP-22](work-packages/WP-22-citations-inspectors.md) | Citations: New and lost, domain and source inspectors, country, mobile | web | not_started | 0 of 16 | 0% | WP-21, WP-14 | |
| W2 | [WP-23](work-packages/WP-23-competitor-views.md) | Competitor views inside Topics & Prompts (W8) | web | not_started | 2 of 7 | 28% | WP-07, WP-05, WP-20 | |
| W2 | [WP-24](work-packages/WP-24-fanout-views.md) | Fan-out tab and views (W9) | web | not_started | 0 of 13 | 0% | WP-08, WP-05 | |
| W2 | [WP-25](work-packages/WP-25-inspector-completion.md) | Prompt inspector completion: header, Latest, History, Stats (R-11 prompt part) | web | not_started | 26 of 35 | 74% | WP-07, WP-08, WP-04 | |
| W2 | [WP-26](work-packages/WP-26-evidence-viewer.md) | Evidence viewer completion: citation markers, entity toggles, views, answer diff | both | not_started | 9 of 23 | 39% | WP-08 | |
| W2 | [WP-27](work-packages/WP-27-add-dialog.md) | Add prompts dialog redesign: plan block, checks, fields, topics, after the add (R-10) | web | not_started | 20 of 132 | 15% | WP-13, WP-07 | |
| W2 | [WP-28](work-packages/WP-28-import-csv.md) | Paste with columns and CSV import (R-10) | web | not_started | 0 of 32 | 0% | WP-27 | |
| W2 | [WP-29](work-packages/WP-29-edit-archive.md) | Edit details, archive and restore, row, bulk and inspector menus | web | not_started | 12 of 50 | 24% | WP-13 | |
| W2 | [WP-30](work-packages/WP-30-runs-costs-health.md) | Runs, costs, budgets and collection health (W21 freshness) | both | not_started | 22 of 35 | 62% | WP-03, WP-07, D-26 | |
| W2 | [WP-31](work-packages/WP-31-settings-engines.md) | Settings: engines page extras, data retention, setup checklist | both | not_started | 12 of 19 | 63% | WP-07 | |
| W3 | [WP-32](work-packages/WP-32-overview-aggregates.md) | Overview aggregate routes and the competitors read | backend | not_started | 2 of 12 | 16% | WP-12, WP-14 | |
| W3 | [WP-33](work-packages/WP-33-overview-shell.md) | AI Visibility Overview page: shell, scope, numbers, notices, presets, export | web | not_started | 0 of 7 | 0% | WP-16, WP-04, WP-07 | |
| W3 | [WP-34](work-packages/WP-34-overview-cards-engines.md) | Overview cards: rates by engine, outcomes, funnel, change summary, movers | web | not_started | 0 of 11 | 0% | WP-33, WP-05, WP-06, WP-19 | |
| W3 | [WP-35](work-packages/WP-35-overview-cards-competitors.md) | Overview cards: share of voice, lost to a competitor, competitor trends | web | not_started | 0 of 8 | 0% | WP-33, WP-05, WP-12 | |
| W3 | [WP-36](work-packages/WP-36-overview-cards-topics.md) | Overview cards: topics by engine and prompts | web | not_started | 0 of 13 | 0% | WP-33, WP-06, WP-20 | |
| W3 | [WP-37](work-packages/WP-37-overview-cards-sources.md) | Overview cards: sources, fan-out, activity and operations | web | not_started | 0 of 13 | 0% | WP-33, WP-05, WP-06, WP-30, WP-08 | |
| W3 | [WP-38](work-packages/WP-38-notes-annotations.md) | Chart notes and annotations (N9, N13, CH-35, M-14) | both | not_started | 0 of 5 | 0% | WP-01, WP-04, D-29 | |
| W3 | [WP-39](work-packages/WP-39-competitors-page.md) | Competitors page (Comparison, AI tab, inspector) | web | not_started | 0 of 11 | 0% | WP-32, WP-05, WP-06, WP-07 | |
| W3 | [WP-40](work-packages/WP-40-project-overview-ai.md) | Project Overview: AI cards and items (cross-channel) | web | not_started | 0 of 2 | 0% | WP-33 | |
| W4 | [WP-41](work-packages/WP-41-versions.md) | Versions: edit text, versions, restore, project feed, boundaries (B11, B12) | both | not_started | 1 of 43 | 2% | WP-13, WP-25, D-24 | |
| W4 | [WP-42](work-packages/WP-42-panels-api.md) | Panels backend: tables, core seed, routes, memberships, planner (B10) | backend | not_started | 0 of 14 | 0% | WP-41 | |
| W4 | [WP-43](work-packages/WP-43-panels-web.md) | Panels web: Panels tab, add to panel, locked core flows, filters | web | not_started | 0 of 39 | 0% | WP-42, WP-29 | |
| W4 | [WP-44](work-packages/WP-44-links-generate.md) | Keyword links and Generate from keywords (B18, N08, M-25) | both | not_started | 0 of 34 | 0% | WP-13, WP-27 | |
| W4 | [WP-45](work-packages/WP-45-candidates-api.md) | Prompt candidates inbox backend (B18 inbox, N10) | backend | not_started | 0 of 8 | 0% | WP-44, D-27 | |
| W4 | [WP-46](work-packages/WP-46-discover-web.md) | Discover > Prompts: candidates inbox and suggestions (W12) | web | not_started | 0 of 31 | 0% | WP-45, WP-10 | |
| W4 | [WP-47](work-packages/WP-47-alerts-api.md) | Alerts backend: rules, events, evaluation, AI rule types, digests | backend | not_started | 0 of 14 | 0% | WP-01, WP-14 | |
| W4 | [WP-48](work-packages/WP-48-alerts-web.md) | Alerts web: rule list, builder, bell, digest archive | web | not_started | 0 of 12 | 0% | WP-47, WP-08 | |
| W4 | [WP-49](work-packages/WP-49-saved-views.md) | Saved views persistence (B8) on every AI table | both | not_started | 1 of 6 | 16% | WP-10, WP-01 | |
| W4 | [WP-50](work-packages/WP-50-exports.md) | Server exports with AI kinds and the caveat header | both | not_started | 0 of 8 | 0% | WP-01 | |
| W4 | [WP-51](work-packages/WP-51-reports.md) | Reports page, shareable report and scheduled digests (M-12, M-13) | both | not_started | 0 of 7 | 0% | WP-50, WP-47, WP-49, D-29 | |
| W4 | [WP-52](work-packages/WP-52-prompt-detail.md) | Prompt Detail page `/ai/prompts/[promptId]` (T3) | web | not_started | 1 of 17 | 5% | WP-41, WP-21, WP-24, WP-06 | |
| W4 | [WP-53](work-packages/WP-53-command-palette.md) | Command palette (platform) | web | not_started | 0 of 4 | 0% | WP-02 | |
| W5 | [WP-54](work-packages/WP-54-extract-recommend.md) | Extraction: markdown structure, structured rank, recommendation, sentiment | backend | not_started | 8 of 17 | 47% | WP-12 | |
| W5 | [WP-55](work-packages/WP-55-recommend-web.md) | Recommendation, structured rank and sentiment on every AI page | web | not_started | 0 of 9 | 0% | WP-54 | |
| W5 | [WP-56](work-packages/WP-56-rederive-candidates.md) | Re-derivation, derivations routes and entity candidates (competitor discovery) | both | not_started | 0 of 13 | 0% | WP-54, WP-50 | |
| W5 | [WP-57](work-packages/WP-57-retrieval-fanout.md) | Retrieved but not cited, fan-out table and keyword match (C8, FO-07, F3) | both | not_started | 0 of 10 | 0% | WP-14, WP-24 | |
| W5 | [WP-58](work-packages/WP-58-stats-api.md) | Statistics backend: intervals, paired verdict, flip rate, movers, sizing (slice 3) | backend | not_started | 0 of 19 | 0% | WP-12, WP-42, D-25 | |
| W5 | [WP-59](work-packages/WP-59-stats-web.md) | Statistics web: server intervals, verdicts, volatility, sizing, replicates | web | not_started | 0 of 6 | 0% | WP-58, WP-52 | |
| W5 | [WP-60](work-packages/WP-60-source-intel-api.md) | Source intelligence backend: categories, publishers, overlap, opportunities | backend | not_started | 0 of 13 | 0% | WP-14, D-27, D-30 | |
| W5 | [WP-61](work-packages/WP-61-sources-page.md) | Sources page, opportunities and source overlap views | web | not_started | 0 of 11 | 0% | WP-60, WP-05 | |
| W5 | [WP-62](work-packages/WP-62-performance.md) | Performance: rollups, caching, EXPLAIN gate, quality counters | backend | not_started | 0 of 5 | 0% | WP-12, WP-32 | |
| W5 | [WP-63](work-packages/WP-63-ssrf-webhooks.md) | SSRF-safe fetcher and outbound webhooks | backend | not_started | 0 of 2 | 0% | WP-47 | |
| W6 | [WP-64](work-packages/WP-64-aio-xch-api.md) | AI Overview engine and cross-channel backend (needs rank data, OD-13) | backend | not_started | 1 of 17 | 5% | WP-44, WP-58, D-50 | |
| W6 | [WP-65](work-packages/WP-65-aio-xch-web.md) | AI Overview and cross-channel web: AIO columns, Matrix, keyword AI tab, pages | web | not_started | 0 of 12 | 0% | WP-64 | |
| W6 | [WP-66](work-packages/WP-66-discovery-sources.md) | Discovery sources: PAA, GSC questions, fan-out to inbox, modeled demand | backend | not_started | 0 of 3 | 0% | WP-45, WP-64, D-27, D-50 | |
| W6 | [WP-67](work-packages/WP-67-engine-expansion.md) | Engine and data expansion: forced search, official APIs, other surfaces, API keys | backend | not_started | 0 of 10 | 0% | WP-58, D-26, D-27 | |
| W6 | [WP-68](work-packages/WP-68-llm-advanced.md) | LLM-backed and Phase 15 analytics: adjudication, claims, diagnostics, experiments | both | not_started | 0 of 13 | 0% | WP-54, WP-58, D-27 | |
| W6 | [WP-69](work-packages/WP-69-first-party-signals.md) | First-party AI signals: GA4 referrals, crawlers, GSC generative, Bing AI (Ph 12) | both | not_started | 0 of 8 | 0% | WP-50, D-51 | |
| W7 | [WP-70](work-packages/WP-70-geo-readiness.md) | Page-level AI readiness (optional, only if the owner opens it, OD-11) | both | not_started | 0 of 21 | 0% | WP-63, D-08 | |
| X | [WP-71](work-packages/WP-71-quality-sweeps.md) | Quality sweeps: e2e, axe at four widths, visual, responsive, copy rules | web | not_started | 21 of 31 | 67% | none | |
| X | [WP-72](work-packages/WP-72-docs.md) | Docs: As built notes, drift fixes, design-system additions | docs | not_started | 1 of 2 | 50% | none | |
| X | [WP-73](work-packages/WP-73-release-acceptance.md) | Release gates and the first real-data acceptance run | infra | not_started | 0 of 1 | 0% | D-26 | |

Blockers name the packages that must be merged first and the owner decisions that gate the package or part of it. Leases on shared files are listed in `tracker.json` under `leases`.
