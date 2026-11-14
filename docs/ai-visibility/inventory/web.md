# AI visibility: web (frontend) inventory

Status: written 2026-11-12 by a read-only pass over the worktree `.claude/worktrees/ai-prompts` (branch `ai/prompts-slice1`, tip `246d3574`). Nothing was run: no tests, no server, no browser. Every status below was checked by reading or grepping the code at that tip; statuses that rest on a doc note rather than code say so.

Companion: `docs/ai-visibility/inventory/backend.md` (written in parallel; BE ids there). This file names backend capabilities by a short descriptive key (section 0.3) plus the B number of the handoff plan where one exists, so the lead can map them.

## 0. How to read this file

### 0.1 Sources

| Key | Source |
|---|---|
| PAR | `docs/superpowers/specs/2026-11-12-topics-prompts-preview-parity.md` (gap ids G01 to G125, decisions D-1 to D-10) |
| GAP | Web session note `topics-prompts-gap-analysis.md` (same G ids; section 2 is the frontend-only list; section 4 lists preview mistakes) |
| STU | `docs/superpowers/specs/2026-11-12-ai-visibility-competitor-study.md` (ids AP, PR, DB, FO, CI, OP, GA, GD, GF, M, U) |
| SYN | Web session note `nuwtonic-vs-idraft-synthesis.md` (sections 2, 5, 6; same ids as STU) |
| W2 | `docs/superpowers/plans/2026-11-12-ai-prompts-w2-web-parity.md` (tasks W1 to W17) |
| RM | `docs/superpowers/plans/2026-11-12-ai-visibility-roadmap.md` (stages, parity checklist section 8) |
| PC | `docs/superpowers/plans/2026-11-11-ai-prompts-c-web.md` and the hand-over note `plan-c-web-handover.md` |
| DS24 | `docs/design-system/24-page-templates.md` (9.1 shell, 9.2 Overview, 9.5 Topics & Prompts, 9.6 Prompt Detail, 9.7 Citations, 9.8 Competitors, 9.9 Matrix, 9.10 Page Intelligence, 9.11 Discover) |
| DS23 | `docs/design-system/23-application-patterns.md` (2 MetricStrip, 4.2 inspector content, 5 evidence viewer, 6 comparison, 7.3 OpportunityStatus, 8 statistics, 9 timelines, 10 bulk, 14 saved views, 15 URL state) |
| DS25 | `docs/design-system/25-component-inventory.md` (component names) |
| DS12/13/15/16/17/19/20 | the matching `docs/design-system/nn-*.md` |
| D20 | `docs/20-frontend-specification.md` (5.6 Prompt Explorer, 5.7 Panels, 5.9 Citations, 5.10 Competitors, 5.13 Prompt Discovery, 5.17 Alerts, and the "As built" notes at lines 782 to 790) |
| D11, D14 | `docs/11-ai-prompt-system.md` (sections 3 panels, 4 lint, 5 discovery, 10 AI alerts), `docs/14-citation-intelligence.md` (sections 6, 7) |
| PV | The approved design preview `apps/web/design-preview` (`index.html`, `prompts.js`, `prompts-topics.js`, `prompts-inspector.js`, `prompts-topic-inspector.js`, `prompts-cells.js`, `prompts-state.js`, `customize.js`, `charts.js`, `interactions.js`); `index.html` line numbers are given as `PV:L<n>` |
| NAV | `docs/design-system/11-navigation.md` section 1.1 and `apps/web/src/lib/navigation/registry.ts` |

### 0.2 Status words

| Word | Meaning |
|---|---|
| BUILT | In the code at the tip; the file is named (relative to `apps/web/src`) |
| PARTIAL | Some of it is in the code; the cell says what is missing |
| NOT BUILT | Absent from the code |
| DROP | Specified somewhere but deliberately not built (a preview mistake, a dropped competitor data point, or a decision); kept so nothing is silently lost |

Size: S under a day, M one to three days, L more, for one Sonnet implementer with an Opus review. Mock: "Y" the MSW mock exists, "M" a mock must be written first (the route contract exists in `lib/api/schema.ts` or in a doc), "N" cannot be mocked usefully yet (no contract), "-" no backend needed.

### 0.3 Backend capability keys (to map to `backend.md`)

State on the tip, read from `apps/web/src/lib/api/schema.ts` and `git log` of `backend/src/idraft/api/ai`.

| Key | Capability | B id | On develop |
|---|---|---|---|
| BE-SUM | `GET {P}/ai/prompts-summary` with `from`, `to`, `filter[engine_code_in]`, `include_branded` | slice 1 | yes |
| BE-SUM-T | `last_observed_at`, `last_valid_at` on prompt and topic rows | B1 | yes |
| BE-SUM-S | `branded_only`, `filter[country_iso]`, `filter[term]` on the summary | B2 | yes |
| BE-SUM-SER | `include=series` (weekly points per engine) | B3 | yes |
| BE-SUM-CMP | `compare=previous_period` on the summary (previous cells, paired verdict later) | B4 | NO (not in the generated client) |
| BE-SUM-ENT | `include=entities` (per engine Mentioned and SOV per tracked entity) | B5 | yes |
| BE-OBS | `GET ai/observations` (list, `filter[prompt_id]`), `/{id}`, `/{id}/raw` | slice 1 | yes |
| BE-CIT | `GET {P}/ai/citations` (rows behind every count) | B6 | yes (web unused, no mock) |
| BE-SRC-D | `GET {P}/ai/sources/domains` with `compare=previous_period`, `sort`, role filter | B6 | yes (web unused, no mock) |
| BE-SRC-P | `GET {P}/ai/sources/pages` (same, `filter[registrable_domain]`) | B6 | yes (web unused, no mock) |
| BE-FO | `GET {P}/ai/fanout-queries` (`min_support`, `filter[prompt_id]`, `cited_domains`) | B19 | yes (web unused, no mock) |
| BE-RUN | `POST {P}/ai/runs` (up to 150 prompts, one manual run) | B7 | yes |
| BE-BARCH | `POST {P}/prompts/bulk-archive` | B7 | yes |
| BE-PR | prompts list, create, `bulk-create`, `lint`, `GET/PATCH/DELETE prompts/{id}`, `run-now` | slice 1 | yes |
| BE-ENG | `GET/PUT/DELETE {P}/engines` with cost estimate | slice 1 | yes |
| BE-SCH, BE-RUNS | `{P}/schedules`, `{P}/runs` (`filter[workload_in]=ai_prompt`) | platform | yes |
| BE-ENT, BE-TAX, BE-TK | entities and aliases, vocabularies (topic tree), `tracked-keywords` (`filter[term]`, `filter[rank_lte]`) | platform | yes |
| BE-VIEWS | `{P}/saved-views`, `core.saved_views` | B8 | no |
| BE-SEO-T | `seo/metrics/breakdown?dimension=term` (volume weighted visibility per topic) | B9b | no |
| BE-PNL | panels, memberships, sizing, promotion candidates | B10 | no (S4) |
| BE-VER | prompt versions, restore, timeline | B11 | no (S4) |
| BE-VFEED | project-wide version feed `prompt-versions` | B12 | no (S4) |
| BE-AIO | AI Overview engine from rank checks, `core.keyword_prompt_links`, `source_state` | B13 | no (S2) |
| BE-REC | recommendation, prominence, structured rank, sentiment cells | B14 | no (S2) |
| BE-CI | `ci` on `MetricCell`, volatility, flip rate, paired verdict | B15 | no (S3) |
| BE-TYPE | `prompt_type` server rule, `filter[prompt_type_in]` | B16 | no |
| BE-LINT | lint rules word count, multiple questions, leading, language, competitor alias | B17 | no |
| BE-CAND | `prompt-candidates`, `prompts/from-keywords/preview` | B18 | no (S4, Ph 11) |
| BE-LINK | keyword to prompt links (`core.keyword_prompt_links`) | in B13 | no (S4) |
| BE-OVR | `GET {P}/ai/metrics/overview` and `ai/metrics/{metric}/series`, `breakdown` | none (Ph 9) | no |
| BE-CMP | `GET {P}/ai/competitors`, `competitors/{id}`, candidates (`ai.entity_candidates`) | none (Ph 9, S2) | no |
| BE-SRCX | sources categories, publisher opportunities, competitor overlap, retrieved-not-cited | none (Ph 13, S2) | no |
| BE-ALR | `alert-rules`, `alert-events`, digests, notifications | none (S4, Ph 9) | no |
| BE-EXP | server exports `POST {P}/exports`, reports, PDF | none | no |
| BE-PD | Prompt Detail routes (`prompts/{id}/metrics`, `/timeline`, answer compare) | none (S4) | no |
| BE-GEO | SSRF-safe page fetch and AI readiness checks | none (W15, needs decision) | no |
| BE-QUOTA | manual runs used today, active prompt quota read | partial (errors carry `limit`, `used`) | partial |

## 1. Information architecture

### 1.1 Sitemap (AI visibility and the screens that carry AI data)

Paths are below the project root `/{workspace}/{project}`. "Live" is `status: 'live'` in `lib/navigation/registry.ts`; "planned" is absent from navigation and 404s today.

```text
Sidebar section 1
  Overview                          /                          planned (project Overview T1, AI cards; DS24 9.2)
  Matrix                            /matrix                    planned (SEO and AI matrix; DS24 9.9)
  SEO
    Keywords                        /seo/keywords              live (keyword inspector AI tab: planned)
    Pages                           /seo/pages                 planned (Page Intelligence AI columns; AI readiness tab if W15)
  AI Visibility (group label)
    Overview                        /ai                        planned (AI Visibility Overview, W13)
    Topics & Prompts                /ai/prompts                live
      ?tab=topics (default)           Topics tab (indented tree)
      ?tab=prompts                    Prompts tab (Prompt Explorer; DS24 also names /ai/prompts/explorer)
      ?tab=panels                     Panels tab (hidden until S4, D-4)
      ?tab=versions                   Versions tab (hidden until S4, D-4)
      ?inspect=topic:<termId>&itab=overview|prompts|competitors|related     topic inspector
      ?inspect=prompt:<id>&itab=latest|history|citations|competitors|stats|fanout   prompt inspector
      ?inspect=answer:<id>            answer viewer (inside the inspector, "Back to the prompt")
    Prompt Detail                   /ai/prompts/[promptId]     planned S4 (T3: Overview, Answers, Citations, Competitors, Fan-out, History)
    Citations                       /ai/citations              planned (W7)
      ?tab=domains (default) | pages | new-lost
      ?inspect=domain:<registrable>   domain inspector (Overview, Pages, Prompts)
      ?inspect=source:<urlId>         source inspector (Overview, Prompts, Answers)
    Sources                         /ai/sources                planned (Ph 13: Publishers, Categories, Opportunities)
Sidebar section 2
  Competitors                       /competitors               planned (Comparison, SEO, AI, Candidates; DS24 9.8)
  Discover                          /discover                  planned (count badge)
    /discover/keywords                Keywords tab (SEO, out of AI scope except fan-out source)
    /discover/prompts                 Prompts tab: candidates inbox, recommended prompts (W12, S4)
    /discover/opportunities           Opportunities tab (OpportunityStatus conditions, publisher opportunities)
Sidebar section 3
  Reports                           /reports                   planned (Scheduled, Exports, Saved views; M-12, M-13)
  Integrations                      /integrations              live (GA4 AI referrals, crawler imports: Ph 12)
  Runs                              /ops/runs                  live (AI runs, filter workload ai_prompt)
  Costs                             /costs                     live (AI workload spend)
  Settings                          /settings
    Project > Engines               /settings/engines          live (EnginesScreen)
    Project > Schedules             /settings/schedules        live (AI answer schedules)
    Project > Entities and aliases  /settings/entities         live (own brand and competitors)
    Project > Taxonomy              /settings/taxonomy         live (topic vocabulary)
    Project > Alert rules           /settings/alert-rules      planned (AI rule types, D11 section 10)
    Project > Data retention        /settings/retention        planned (raw answer retention)
    Workspace > Budgets and usage   /settings/workspace ...    planned (AI quota meter)
Top bar
  Date range (window)               all AI screens             live: 7, 28, 90 days; custom range planned
  Country scope                     AI screens                 live on Topics & Prompts
  Notification bell                 global                     planned (alert events open in the inspector)
  Command palette                   global                     planned (search prompts, topics, domains)
```

### 1.2 Navigation entries to add when each page lands

| ID | Entry | Route file to create | Registry change | Status |
|---|---|---|---|---|
| WB-IA-01 | AI Visibility > Overview | `app/[workspace]/[project]/ai/page.tsx` | `aiOverview` to `live` | NOT BUILT |
| WB-IA-02 | AI Visibility > Topics & Prompts | `app/[workspace]/[project]/ai/prompts/page.tsx` | `prompts` live | BUILT |
| WB-IA-03 | AI Visibility > Citations | `app/[workspace]/[project]/ai/citations/page.tsx` | `citations` to `live` | NOT BUILT |
| WB-IA-04 | AI Visibility > Sources | `app/[workspace]/[project]/ai/sources/page.tsx` | `sources` to `live` | NOT BUILT |
| WB-IA-05 | Competitors | `app/[workspace]/[project]/competitors/page.tsx` | `competitors` to `live` | NOT BUILT |
| WB-IA-06 | Discover (Prompts, Opportunities tabs) | `app/[workspace]/[project]/discover/[tab]/page.tsx` | `discover` to `live`, count badge | NOT BUILT |
| WB-IA-07 | Reports | `app/[workspace]/[project]/reports/page.tsx` | `reports` to `live` | NOT BUILT |
| WB-IA-08 | Prompt Detail | `app/[workspace]/[project]/ai/prompts/[promptId]/page.tsx` | none (not a nav item; breadcrumb child of Topics & Prompts) | NOT BUILT |
| WB-IA-09 | Settings > Engines | `app/[workspace]/[project]/settings/engines/page.tsx` | settings nav item | BUILT |
| WB-IA-10 | Settings > Alert rules | `app/[workspace]/[project]/settings/alert-rules/page.tsx` | settings nav item | NOT BUILT |
| WB-IA-11 | Pages > AI readiness tab | `app/[workspace]/[project]/seo/pages/[urlId]/...` | none | NOT BUILT (needs decision, W15) |
| WB-IA-12 | Matrix | `app/[workspace]/[project]/matrix/page.tsx` | `matrix` to `live` | NOT BUILT |
| WB-IA-13 | Overview (project) | `app/[workspace]/[project]/page.tsx` already redirects | `overview` to `live` | NOT BUILT (AI cards part) |

Each navigation change needs `pnpm build` and the registry test (`lib/navigation/registry.test.ts`) updated.

## 2. Surfaces

Table columns: ID, element, source, status (with file), backend need, mock, size, UI notes.

### 2.1 WB-NAV: shell, sidebar, top bar

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-NAV-01 | Sidebar group label "AI Visibility" with four children | NAV, DS24 9.1, PV:L57 | PARTIAL: registry has all four keys; only Topics & Prompts is live (`lib/navigation/registry.ts`) | none | - | S each with its page | Label is text, not a link; 32 px items, 18 px icons (MessageSquareText, MessageSquare, Quote, Globe) |
| WB-NAV-02 | Discover count badge (new candidates) | NAV, DS24 9.1 | NOT BUILT | BE-CAND counts | N | S | Badge shows only with a count; neutral |
| WB-NAV-03 | Sidebar collection status line "Last run 06:12" including the AI run | DS24 9.1, PV:L77 | NOT BUILT (not in `components/app/shell/sidebar.tsx`) | BE-RUNS | Y | S | `type-label` above Collapse; AI and SEO freshness |
| WB-NAV-04 | Breadcrumb "Project > Topics & Prompts", and child crumb for Prompt Detail | DS24 9.1 | BUILT for the page (`components/app/shell/breadcrumb.tsx`); child crumb NOT BUILT | none | - | S | House icon for root |
| WB-NAV-05 | Top bar window select 7, 28, 90 days | D20 782 | BUILT (`prompt-model.ts` `WINDOW_DAYS`, top bar slot) | BE-SUM | Y | - | "28d" under 640 px |
| WB-NAV-06 | Top bar custom date range up to 92 days (G07) | PAR G07, W5 | NOT BUILT (no `DateRangePicker` in `components`) | BE-SUM (92 days max, `422 window_too_large`) | Y | M (shared picker SC-08) | A longer range is refused with the reason in words |
| WB-NAV-07 | Top bar Country scope (one market, "All countries") | D20 784 | BUILT (`prompts-scope.tsx`) | BE-SUM-S | Y | - | Name from 1024 px, code below |
| WB-NAV-08 | Country scope on Citations, Fan-out, Competitors, Overview pages | M-11 | NOT BUILT | BE-CIT, BE-SRC-* do NOT take `filter[country_iso]` (schema) | M | S per page after BE | Hide the control where it does not apply (DS24 9.1) |
| WB-NAV-09 | Notification bell with AI alert events | D20 5.17, NAV | NOT BUILT | BE-ALR | N | L | Events open the entity inspector, History tab highlighted |
| WB-NAV-10 | Command palette finds prompts, topics, domains | DS25 5.14, PV:L1062 | NOT BUILT (no `CommandPalette`) | BE-PR list (`filter[q]`) | Y | L (platform) | `Cmd+K`; results grouped by type |
| WB-NAV-11 | Keyboard shortcuts dialog lists the AI page shortcuts (`/`, J, K, Enter, Escape, `[`) | DS 11 section 7 | PARTIAL: dialog exists (`components/app/shell/keyboard-shortcuts-dialog.tsx`); whether the prompts page registers its keys was not verified | none | - | S | |
| WB-NAV-12 | Project switch keeps AI page query minus `inspect`, `itab` | D20 1031 | PARTIAL: `carriesQuery` is set only for Runs and Costs; `prompts` does not carry its query | none | - | S | Decide per page; filters of one project (topic ids) must not follow |

### 2.2 WB-TPH: Topics & Prompts page header

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-TPH-01 | One row header under a visually hidden `h1` "Topics & Prompts" | D20 784 | BUILT (`prompts-screen.tsx`) | none | - | - | Matches Keywords header |
| WB-TPH-02 | "Updated {time}" from the newest `last_observed_at` (G01) | PAR G01, PR-13 | BUILT (`prompts-screen.tsx`, message `prompts.updated`) | BE-SUM-T | Y | - | Shown from a 64rem header container, moves into More below; dates of the window in its tooltip |
| WB-TPH-03 | Meta counts "13 topics, 250 prompts" in the header (G01, AP-23) | PAR G01, PV:L141 | PARTIAL: counts are in the strip Prompts chip tooltip and the footer, not in the header line | BE-SUM | Y | S | One noun only ("prompts", not "core prompts", PAR 6 item 13) |
| WB-TPH-04 | Saved view menu "View: Default" with Default, Branded prompts presets (G02) | PAR G02, PV:L1188 | NOT BUILT (no `views-model.ts`) | none for presets | - | S | Presets map to URL states; Branded prompts is `branded=only` |
| WB-TPH-05 | Saved view "Discovery panel" preset | PV:L1190 | NOT BUILT | BE-PNL | N | S after S4 | Hidden until panels exist |
| WB-TPH-06 | "Save view as", rename, delete, default, share (persisted views) | DS23 14, M-15, G02 | NOT BUILT | BE-VIEWS (B8) | M | M (shared SC-06) | `SavedViewMenu` shared with Rankings |
| WB-TPH-07 | More actions menu: Copy link | PV:L1196, G03 | BUILT (`prompts-screen.tsx` `copyLink`) | none | - | - | Toast "Link copied" |
| WB-TPH-08 | More actions menu: Export CSV (all rows in scope) | PV:L1196, G03, G124 | PARTIAL: export exists in the bulk bar and row menus (`export-rows.ts`, `lib/csv/csv-write.ts`); not in the More menu | none | - | S | Same writer; file name with window |
| WB-TPH-09 | More actions menu: Export XLSX | M-16, Rankings `export-file.ts` (`xlsx`) | NOT BUILT | none | - | S | Rankings has `ExportFormat = 'xlsx' or 'csv'`; reuse after moving to `lib` |
| WB-TPH-10 | More actions menu: Import prompts (CSV into the Add dialog, G04) | PAR G04, PV:L1196 | NOT BUILT | BE-PR `bulk-create` (1,000 max) | Y | M | Reuse `features/rankings/import/file-dropzone.tsx` pattern via a shared dropzone (SC-12) |
| WB-TPH-11 | Header "Import" button | PV:L144 | NOT BUILT (preview stub) | as above | Y | S | Preview had only a note; can live in More |
| WB-TPH-12 | More actions menu: Generate from keywords | PV:L1198, G03 | NOT BUILT | BE-CAND (B18) | N | L | Hidden until B18 (no dead link, PAR 6 item 12) |
| WB-TPH-13 | Primary "Add prompts" (icon only under 640 px) | D20 784 | BUILT (`prompts-screen.tsx`) | BE-PR | Y | - | `prompts:write` only |
| WB-TPH-14 | Active prompt quota meter in the header ("120 of 150 active prompts") | AP-17, U-19 | NOT BUILT | BE-QUOTA (workspace quota read) | M | S | `Meter` (SC-15); no red until over |
| WB-TPH-15 | Topics and Prompts switch as a segmented control at the toolbar end | D20 784 | BUILT (`prompts-screen.tsx`, `toolbarEnd`) | none | - | - | Radio group, history entry per change, focus kept |
| WB-TPH-16 | Panels and Versions tabs in the switch | PV:L152, DS24 9.5 | NOT BUILT (hidden by D-4) | BE-PNL, BE-VER | N | see WB-PNL, WB-VER | Do not render stubs |
| WB-TPH-17 | Cadence line "Asked twice a week, Monday and Thursday" | D-6, AP-10 | NOT BUILT on this page (Engines screen states it) | BE-SCH | Y | S | Never "weekly" (D-6) |
| WB-TPH-18 | Manual runs left today ("14 of 20 manual runs left today") before a click | PR-12 | NOT BUILT (the bulk confirm says how many are used half an hour after an answer) | BE-QUOTA (runs used today) | M | S | Also in the prompt inspector header |

### 2.3 WB-TPF: filter bar (shared by both tabs)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-TPF-01 | Filter button and chips that wrap beside it | D20 784, DS13 | BUILT (`prompts-screen.tsx`, `components/app/filters`) | none | - | - | No row when no filter is set |
| WB-TPF-02 | Topic filter (keeps the topic and every topic below) | D20 782 | BUILT | BE-SUM-S `filter[term]` available; web filters in the browser | Y | - | Path shown in the chip (`filters.topicWithPath`) |
| WB-TPF-03 | Engine filter | PR-21 | BUILT | BE-SUM | Y | - | One label per engine (ADR-DS-020) |
| WB-TPF-04 | Branded filter, Include only | D-7 | BUILT (`filters.brandedInclude`) | BE-SUM `include_branded` | Y | - | |
| WB-TPF-05 | Branded filter three way: Excluded (default chip), Included, Only (G08) | PAR G08, PV:L1077 | PARTIAL: Include only; no Only | BE-SUM-S `branded_only` (built) | Y | S | Default chip "Branded: Excluded" (DS24 9.5) |
| WB-TPF-06 | Compare select: vs previous period, No comparison (G05) | PAR G05, PV:L1045, DS25 6.3 | NOT BUILT | interim: two BE-SUM reads; later BE-SUM-CMP (B4) | Y (window params) | M | Same period last year not offered (no data) |
| WB-TPF-07 | "Detectable changes only" chip (G06) | PAR G06, PV:L1205 | NOT BUILT | as WB-TPF-06 | Y | S | In the URL; tooltip says "interim test" until S3 |
| WB-TPF-08 | Type filter chip (G10) | PAR G10, PV:L1203 | NOT BUILT | BE-TYPE (B16) | M | S after B16 | Hidden until B16 is on develop (W17) |
| WB-TPF-09 | Panel filter chip, default "Panel: Core" (G09) | PAR G09 | NOT BUILT | BE-PNL | N | M | S4 |
| WB-TPF-10 | Intent filter | D20 5.6 | NOT BUILT | BE-PR `filter[intent_in]` (built) | Y | S | Values from `Prompt.intent` |
| WB-TPF-11 | Funnel stage filter and column (AP-03) | STU AP-03 | NOT BUILT | BE-PR `filter[funnel_stage_in]` (built) | Y | S | Neutral `Badge`; who classifies is open |
| WB-TPF-12 | Importance filter (AP-21) | D20 5.6 | NOT BUILT | BE-PR | Y | S | 1 to 5 |
| WB-TPF-13 | Language filter | D20 5.6 | NOT BUILT | BE-PR `filter[language_code]` | Y | S | |
| WB-TPF-14 | Linked keyword present filter | D20 5.6 | NOT BUILT | BE-LINK | N | S | S4 |
| WB-TPF-15 | Sort menu in the filter bar (Mention, Citation, A to Z, Last updated) | PV:L1208 | DROP: sort lives on column headers (`sort` in the URL); "Last updated" sort waits for WB-PRM-14 | BE-SUM-T | - | - | Header sort is the house pattern |
| WB-TPF-16 | Reset filters | PV:L164 | BUILT (empty filtered state has "Clear filters") | none | - | - | |
| WB-TPF-17 | Dropped filters notice (a filter in the link that no longer applies) | messages `droppedFilters.*` | BUILT | none | - | - | |
| WB-TPF-18 | Filter sheet below 768 px (filters, window, country move into it) | DS19, PV:L85 | NOT VERIFIED (no visual check); treat as PARTIAL | none | - | S | `FilterSheet` (DS25 6.7) |

### 2.4 WB-TPS: metric strip

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-TPS-01 | Prompts chip (prompts in view, topics spanned in the tooltip) | PAR G12, W1 | BUILT (`prompts-strip.tsx`, `strip-model.ts`) | BE-SUM | Y | - | Inline chips (`MetricStrip size="inline"`) since the compact header |
| WB-TPS-02 | One chip per engine: Mention rate, Cited and SOV in the tooltip with counts | PAR G12, DB-01 | BUILT | BE-SUM | Y | - | Tooltip is a tab stop (`tip`) |
| WB-TPS-03 | Insufficient chip under 4 valid answers (hatched) | PAR G13, D-1 | BUILT (`rate-view.tsx` `InsufficientPill`) | none | - | - | |
| WB-TPS-04 | "n/a" with the reason when an engine has no answer | W1 | BUILT | none | - | - | |
| WB-TPS-05 | Change in points on each engine chip (vs previous period) | PAR G12, G05, PV `deltaNode` | NOT BUILT | as WB-TPF-06 | Y | S after Delta (SC-01) | Colour only when detectable (rule 6) |
| WB-TPS-06 | Single engine in scope: its four rates (Mentioned, Cited, SOV, Valid answers) | DS24 9.5, W1 | PARTIAL: the inline header shows one value per engine; the four-rate variant of the md strip is not drawn in the compact header (not verified visually) | BE-SUM | Y | S | Recommendation fourth rate waits for S2 |
| WB-TPS-07 | Recommendation rate item | DS24 9.5, G41 | NOT BUILT | BE-REC (B14) | N | S | S2 |
| WB-TPS-08 | AI Overview chip ("AI Overviews", not asked) | ADR-DS-022 dec 11, G120 | NOT BUILT | BE-AIO (B13) | N | M | S2 |
| WB-TPS-09 | Skeletons with labels while loading; hidden when no answers | W1 | BUILT | none | - | - | |
| WB-TPS-10 | "SOV" short label under 1,280 px | D20 782 | BUILT | none | - | - | |

### 2.5 WB-TOP: Topics tab

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-TOP-01 | Indented two level topic tree, parent rolls up, children indented (G32, D-3) | PAR D-3, W2b | BUILT (`topic-tree.ts`, `topics-table.tsx`) | BE-SUM, BE-TAX | Y | - | Drawn as Rankings By group |
| WB-TOP-02 | Rollup note "A parent row counts every prompt under it..." | W2b | BUILT (`topics.rollupNote`) | none | - | - | Only with a parent visible |
| WB-TOP-03 | Expand all, Collapse all (G25) | PAR G25 | BUILT (in memory, not URL) | none | - | - | |
| WB-TOP-04 | Expanded set in the URL so a link restores it | W2 test list | DROP (owner's brief kept it in memory) | none | - | - | Recorded in W2 status |
| WB-TOP-05 | Disclosure with accessible name "Expand Security group, 4 topics" | W2-T | BUILT (`topics.expandTopics`) | none | - | - | |
| WB-TOP-06 | Treegrid keys: Right expands, Left collapses or moves to parent, Enter and Space toggle | W2-T | BUILT through `DataTable` treegrid (not re-verified in this pass) | none | - | - | Single roving tab stop |
| WB-TOP-07 | Topic row: name plus muted count ("3 topics" or "10 prompts") | W2b | BUILT | BE-SUM | Y | - | |
| WB-TOP-08 | Topic subtitle "Category, N prompts" under the name (G20) | PAR G20, PV `topicRow` | PARTIAL: count beside the name on one line; no category line (W2b decision: compact row) | BE-TAX | Y | S | Decide whether to keep the one-line form |
| WB-TOP-09 | Child rows: topics (open the drawer) and "Show all N prompts of X" | W2b | BUILT | none | - | - | |
| WB-TOP-10 | A topic without children opens onto its prompts, eight most mentioned, then "Show all" | D20 782 | BUILT | none | - | - | |
| WB-TOP-11 | A level 2 topic opens onto its prompts (needs RowTree level 3) | `topics-table.tsx` shortcut comment | NOT BUILT (opens the drawer instead) | none | - | M (DataTable change SC-03) | |
| WB-TOP-12 | "No topic" row | D20 782 | BUILT | none | - | - | |
| WB-TOP-13 | Prompts count column | DS24 9.5 col 2 | BUILT (sortable) | BE-SUM | Y | - | |
| WB-TOP-14 | Mention rate column, avg of N, counts in tooltip, pill under 4 (G21) | PAR G21 | BUILT (`rate-columns.tsx`) | BE-SUM | Y | - | N counts engines that show a rate |
| WB-TOP-15 | Change on the Mention rate column | DS24 9.5 col 3, G21 | NOT BUILT | as WB-TPF-06 | Y | S | |
| WB-TOP-16 | Citation rate column (G22) | PAR G22 | BUILT | BE-SUM | Y | - | No change shown (DS24) |
| WB-TOP-17 | Top engine column (G24) | PAR G24 | PARTIAL: name and rate in words, no `EngineLogo` (none exists) | BE-SUM | Y | S (SC-02) | All rates in the tooltip |
| WB-TOP-18 | Per engine Mentioned and Cited count columns (column chooser) | D20 782 | BUILT | BE-SUM | Y | - | |
| WB-TOP-19 | Trend sparkline column, weekly mention rate (G29) | PAR G29, W11 | BUILT (`trend-column.tsx`, `trend-model.ts`) | BE-SUM-SER | Y | - | From 1280 px, gray line, gaps not zeros |
| WB-TOP-20 | Trend: hollow points under 4 answers | W11 | NOT BUILT | BE-SUM-SER | Y | S | |
| WB-TOP-21 | Trend: an 8 week line beside a 28 day table (second read 55 days back) | W11, D1 open point 1 | NOT BUILT (series follows the window) | BE-SUM-SER | Y | S | Decide; response size matters until gzip |
| WB-TOP-22 | SEO visibility column (volume weighted, keyword count below) (G31) | PAR G31, DS24 9.5 col 7 | NOT BUILT | BE-SEO-T (B9b) | N | M | Prompt filters do not apply; tooltip says so |
| WB-TOP-23 | Top 10 keywords column, "of 77 checked" (G31) | PAR G31, DS24 9.5 col 8 | NOT BUILT | BE-TK (`filter[term]`, `filter[rank_lte]=10`, `page.total`) | Y | M | Verify shared vocabulary first (RM risk) |
| WB-TOP-24 | Updated column, latest observation in the topic (G30) | PAR G30, W6 | NOT BUILT | BE-SUM-T | Y | S | `formatRelative`, exact time on hover |
| WB-TOP-25 | Stale badge on a topic whose last valid answer is older than twice the schedule interval | W6 | NOT BUILT | BE-SUM-T, BE-SCH | Y | S | Date in the tooltip |
| WB-TOP-26 | Sorting on every column, default Mention desc, rows without a rate last (G23) | PAR G23 | BUILT (`rate-model.ts` `sortByKeys`) | none | - | - | `sort` in the URL; siblings sort under their parent |
| WB-TOP-27 | Topic search in the toolbar (finds child topics) | DS24 9.5 | BUILT | none | - | - | `/` focuses it |
| WB-TOP-28 | Column chooser; Topic and Mention rate always on | DS24 9.5, PV:L1218 | BUILT (DataTable chooser) | none | - | - | |
| WB-TOP-29 | Density toggle | DS12 | BUILT (DataTable) | none | - | - | |
| WB-TOP-30 | Footer "N topics, M prompts" counted once (G33) | PAR G33 | BUILT (`topics.footerPrompts`) | none | - | - | "Updated ..." part of the preview footer not added |
| WB-TOP-31 | Row checkbox, select a topic selects its prompts | W5 | BUILT (`selection-model.ts`) | none | - | - | |
| WB-TOP-32 | Row opens the topic drawer; a modified click opens a new tab | D20 782 | BUILT | none | - | - | |
| WB-TOP-33 | Topic row menu (see WB-MNU) | PAR G27 | BUILT | - | - | - | |
| WB-TOP-34 | Mobile list rows under 768 px, two lines, open the drawer (G14) | PAR G14, DS19 6.7, PV `listRow` | NOT BUILT (no list mode in `DataTable`) | none | - | M (SC-04) | Line 1 name and Mention rate, line 2 category and counts |
| WB-TOP-35 | Row menu column scrolls out at 1280 px (only identity is pinned) | D20 788 | PARTIAL (known limit) | none | - | S (pin right column, SC-03) | |
| WB-TOP-36 | Empty states: no engine on (link to Settings > Engines), no prompts, no answers yet (says when they come), filtered empty, load error, partial list | D20 782, U-10 | BUILT (`prompts-screen.tsx`) | none | - | - | Richer than the preview |
| WB-TOP-37 | Loading skeleton rows, no flash of the empty state | DS17 | BUILT | none | - | - | |
| WB-TOP-38 | Refresh failure told without losing rows (`topics.refreshFailed`) | messages | BUILT | none | - | - | |
| WB-TOP-39 | AI Overview column on topics | owner brief, PAR 6 item 16 | NOT BUILT | BE-AIO | N | S | S2 |
| WB-TOP-40 | Pages repeatedly influencing a topic count | D14 section 6, D20 5.11 | NOT BUILT | BE-SRCX | N | M | Ph 13 |

### 2.6 WB-PRM: Prompts tab

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PRM-01 | Prompt column (text, pinned, two lines then tooltip) | AP-04, DS25 8.2 | BUILT (`prompt-columns.tsx`) | BE-PR | Y | - | |
| WB-PRM-02 | Branded chip on the prompt cell | D20 5.6 | PARTIAL: branded shown in the inspector; cell chip not verified | BE-PR `is_branded` | Y | S | |
| WB-PRM-03 | `PromptTypeBadge` on the prompt cell (hidden in compact density and narrow cells) (G10) | DS24 9.5 col 1 | NOT BUILT | BE-TYPE | M | S after B16 | Container query at 384 px |
| WB-PRM-04 | Lock icon for a locked core panel member | DS24 9.5 col 1 | NOT BUILT | BE-PNL | N | S | S4 |
| WB-PRM-05 | Topic badge with path tooltip (G45) | PAR G45 | BUILT | BE-SUM, BE-TAX | Y | - | Truncates without a native title |
| WB-PRM-06 | Country column | PR-05 | BUILT | BE-PR | Y | - | |
| WB-PRM-07 | Engine columns, one per engine for the metric chosen (G41) | PAR G41 | BUILT (headed "ChatGPT mention" etc.) | BE-SUM | Y | - | |
| WB-PRM-08 | Metric switcher select (Mention, Citation, SOV) in the toolbar, `metric=` | PAR G41, PV:L224 | BUILT | BE-SUM | Y | - | DS25 `MetricSwitcher` is the target name |
| WB-PRM-09 | Grouped two row header ("Mention rate by engine" over engine columns) | DS24 9.5 table row | NOT BUILT (`DataTable` has no column groups) | none | - | M (SC-03) | One engine: group collapses |
| WB-PRM-10 | Recommendation option in the switcher and column (G42) | PAR G42 | NOT BUILT | BE-REC | N | S | S2 |
| WB-PRM-11 | Mention rate (avg of N) and Citation rate columns, default sort Mention desc (G40) | PAR G40 | BUILT | BE-SUM | Y | - | |
| WB-PRM-12 | Change column per engine, coloured only when detectable | D20 5.6, DS24 9.5 extras | NOT BUILT | as WB-TPF-06 | Y | S | Most are gray |
| WB-PRM-13 | Top competitor column (entity, its rate; "none named" in words) (G43) | PAR G43, W8 | NOT BUILT | BE-SUM-ENT (built) | Y (mock serves entities) | M | Use the highest SOV, value null shows nothing |
| WB-PRM-14 | Updated column with Stale badge (G44) | PAR G44, W6 | NOT BUILT | BE-SUM-T | Y | S | |
| WB-PRM-15 | Trend column (G44) | W11 | BUILT (`trend-column.tsx`) | BE-SUM-SER | Y | - | |
| WB-PRM-16 | Per engine Mentioned and Cited counts in the column chooser | D20 782 | BUILT | BE-SUM | Y | - | |
| WB-PRM-17 | Interval (95% Wilson) in the rate tooltips (G48) | PAR G48 | NOT BUILT | none (web `wilsonInterval`); BE-CI later | - | S | Text "52% to 79%" |
| WB-PRM-18 | Fan-out per answer column (ChatGPT only, mean `fanout_count`) (FO-14) | STU FO-14 | NOT BUILT | BE-OBS `fanout_count` or BE-FO | Y | S | Gemini and AI Mode say "not exposed", never 0 |
| WB-PRM-19 | Volatility column (flip rate, citation Jaccard) | D20 5.6, DS24 extras | NOT BUILT | BE-CI | N | S | S3 |
| WB-PRM-20 | Linked keywords column (count and primary rank) | DS24 extras | NOT BUILT | BE-LINK | N | S | S4 |
| WB-PRM-21 | Versions count column, boundary icon if changed in window | DS24 extras | NOT BUILT | BE-VER | N | S | S4 |
| WB-PRM-22 | Panel column | DS24 extras | NOT BUILT | BE-PNL | N | S | S4 |
| WB-PRM-23 | Intent, Funnel stage, Importance columns | D20 5.6, AP-03, AP-21 | NOT BUILT | BE-PR | Y | S | Chooser columns |
| WB-PRM-24 | AI Overview engine column ("No AIO", "n/a", "not tracked") (G120) | DS24 9.5 col 5a | NOT BUILT | BE-AIO | N | M | S2 |
| WB-PRM-25 | Sorting on every column, default Mention desc, tie by name | D20 782 | BUILT | none | - | - | |
| WB-PRM-26 | Table search `/` | DS24 9.5 | BUILT | none | - | - | Search does not change the strip |
| WB-PRM-27 | Pagination 25 per page with counter (G49) | PAR G49 | BUILT (DataTable) | none | - | - | |
| WB-PRM-28 | Row checkbox and bulk bar (see WB-BLK) | W5 | BUILT | - | - | - | |
| WB-PRM-29 | Row opens the prompt inspector, J and K step | G101 | BUILT | none | - | - | |
| WB-PRM-30 | Responsive priorities: 1280 Prompt, engines, Mention, Citation; 1440 Topic, Trend; 1680 Top competitor, Updated | DS24 9.5, DS19 6.3 | PARTIAL: Trend from 1280; other priorities not verified | none | - | S | |
| WB-PRM-31 | Below 1280 the engine values move under the prompt | PV prompts.js L159 | NOT BUILT (not verified) | none | - | S | |
| WB-PRM-32 | Mobile list rows (G14) | PAR G14 | NOT BUILT | none | - | M (SC-04) | |
| WB-PRM-33 | Empty, filtered empty, partial page, error states | D20 782 | BUILT | none | - | - | |
| WB-PRM-34 | Persona preamble indicator | D20 5.6 | NOT BUILT | none in slice 1 | N | S | Later phase |

### 2.7 WB-BLK: selection and bulk bar (both tabs)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-BLK-01 | Selection as a set of prompt ids, dropped when scope changes | W5 | BUILT (`selection-model.ts`) | none | - | - | |
| WB-BLK-02 | Bar text "N selected"; on Topics "N topics selected, M prompts" | PAR G26, G47 | BUILT | none | - | - | Rankings bulk bar (`components/app/data-table/bulk-action-bar.tsx`) |
| WB-BLK-03 | "Select all N matching" with a hidden-by-filter note | PAR G47 | DROP for now (the list holds every matching prompt, as Rankings client mode) | none | - | S if server paging comes | Recorded in W5 status |
| WB-BLK-04 | Bulk Run now, one `POST ai/runs` per 150 prompts, confirm naming the runs and the 20 a day | W10 | BUILT (`use-prompt-actions.tsx`, `run-model.ts`) | BE-RUN | Y | - | One prompt keeps run-now |
| WB-BLK-05 | Run now refusals in words (paused provider, day limit, month quota, nothing to run, pending, archived, engine off, missing price) | W10 | BUILT | BE-RUN | Y | - | One summary toast |
| WB-BLK-06 | Bulk Archive, one `bulk-archive`, confirm above 100, Undo when every prompt changed | W10 | BUILT | BE-BARCH | Y | - | |
| WB-BLK-07 | Bulk Export CSV of the selection (formula safe) | W5, G124 | BUILT (`export-rows.ts`) | none | - | - | |
| WB-BLK-08 | Clear selection | PV:L194 | BUILT | none | - | - | |
| WB-BLK-09 | Bulk "Add prompt" for a topic selection | W5 step | NOT BUILT | BE-PR | Y | S | |
| WB-BLK-10 | Bulk Add to panel (Discovery, Brand watch; Core locked) | PV:L1249, G47 | NOT BUILT | BE-PNL | N | M | S4; reason for core |
| WB-BLK-11 | Bulk edit details (topic, importance, intent) | DS23 10 | NOT BUILT | BE-PR `PATCH` per id (no bulk patch route) | Y | M | Needs a bulk PATCH contract (CF-12) |
| WB-BLK-12 | Bulk restore (unarchive) from an Archived filter | AP-22 | NOT BUILT (Undo only) | BE-BARCH `archive=false` | Y | S | Needs an "Archived" scope |
| WB-BLK-13 | Keyboard: Shift click range, Escape clears | DS12 | BUILT through DataTable (not re-verified) | none | - | - | |

### 2.8 WB-MNU: row menus

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-MNU-01 | Prompt row: Open | PV:L1235 | BUILT (`use-prompt-actions.tsx`) | none | - | - | |
| WB-MNU-02 | Prompt row: Run now | PV:L1237 | BUILT | BE-PR run-now | Y | - | `runs:trigger` |
| WB-MNU-03 | Prompt row: Copy prompt | PV:L1237 | BUILT | none | - | - | |
| WB-MNU-04 | Prompt row: Archive | PV:L1239 | BUILT | BE-BARCH | Y | - | `prompts:write` |
| WB-MNU-05 | Prompt row: Edit details (opens WB-EDT) (G46, G125) | W5 | NOT BUILT | BE-PR `PATCH` | Y | M | Not "Edit prompt" (text immutable in S1) |
| WB-MNU-06 | Prompt row: Edit prompt text (new version) | PV:L1237 | NOT BUILT | BE-VER | N | L | S4 (WB-VER-08) |
| WB-MNU-07 | Prompt row: Open page (Prompt Detail) | PV:L1235 | NOT BUILT | BE-PD | N | L | S4; no link without a target |
| WB-MNU-08 | Prompt row: Copy link to the prompt (`?inspect=prompt:`) | G122 | PARTIAL: shared link restores the drawer; no menu item | none | - | S | |
| WB-MNU-09 | Topic row: Open | PV:L1244 | BUILT (`prompts-screen.tsx`) | none | - | - | |
| WB-MNU-10 | Topic row: Show in Prompts (topic as filter, others kept) (G28) | PAR G28 | BUILT | none | - | - | |
| WB-MNU-11 | Topic row: Add prompt (dialog with topic preselected) (G82) | PAR G82 | BUILT | BE-PR | Y | - | |
| WB-MNU-12 | Topic row: Run now | PV:L1246 | BUILT | BE-RUN | Y | - | |
| WB-MNU-13 | Topic row: Export CSV | PV:L1246 | BUILT | none | - | - | |
| WB-MNU-14 | Right click opens the row menu (`RowContextMenu`) | PV, DS25 3.28 | NOT BUILT (shared table has none, as Keywords) | none | - | M (SC-05) | Platform decision, also Rankings |
| WB-MNU-15 | Menu items carry their shortcut hint ("Open" Enter) | PV:L1235 | NOT VERIFIED | none | - | S | `Kbd` |

### 2.9 WB-ADD: Add prompts dialog

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-ADD-01 | Paste one prompt or many (one per line, up to 1,000) | G80 | BUILT (`add-prompts-dialog.tsx`) | BE-PR bulk-create | Y | - | |
| WB-ADD-02 | Counter of lines | messages `add.counter` | BUILT | none | - | - | |
| WB-ADD-03 | Per line findings: repeat, already tracked, branded, engine limit, too long, unsupported | G80 | BUILT | BE-PR lint | Y | - | |
| WB-ADD-04 | Topic select (with the topic preselected from a topic row) | G82 | BUILT (`defaults.termId`) | BE-TAX | Y | - | |
| WB-ADD-05 | Language select (required) | AP-12 | BUILT | none | - | - | |
| WB-ADD-06 | Country select limited to countries every enabled engine asks in | AP-11, L5 | BUILT (`countriesForEngines`) | BE-ENG | Y | - | Do not remove to match the preview (PAR 6 item 11) |
| WB-ADD-07 | Quota line "Adds N of your remaining M" and over-quota state | AP-17 | BUILT (`add.quota`, `add.quotaOver`) | BE-PR | Y | - | |
| WB-ADD-08 | Result view: created, skipped, rejected lines with reasons | G80 | BUILT | BE-PR | Y | - | Focus moves to the result title |
| WB-ADD-09 | Discard confirm on Escape or Cancel when lines are typed | PV:L1050, DS25 3.32 | BUILT (`add.discardDescription`) | none | - | - | |
| WB-ADD-10 | Cmd or Ctrl Enter submits | PV prompts.js L1058 | NOT VERIFIED | none | - | S | |
| WB-ADD-11 | Announcer for lint results (not live regions) | PC handover | BUILT | none | - | - | |
| WB-ADD-12 | Type select prefilled by the server rule, person can change it | W17, D-8 | NOT BUILT | BE-TYPE | M | S | Hidden until B16 |
| WB-ADD-13 | Intent, importance, funnel stage fields | AP-05, D20 5.6 | NOT BUILT (API defaults) | BE-PR | Y | S | |
| WB-ADD-14 | Panel select and Reason for a locked core (G81) | PAR G81, PV:L1266 | NOT BUILT | BE-PNL | N | S | S4 |
| WB-ADD-15 | Lint: 5 to 60 words, one question, leading wording, language mismatch, competitor alias (G83) | PAR G83, D11 4 | NOT BUILT | BE-LINT (B17) | N | M | Warnings, not errors, unless the backend says so (D-7) |
| WB-ADD-16 | Run time and cost estimate for the added prompts | PAR 6 item 11 | NOT BUILT | BE-ENG estimate | Y | S | "About N answers a month, about USD x" |
| WB-ADD-17 | CSV import step (file to lines, preview, then the same checks) (G04) | PAR G04 | NOT BUILT | BE-PR | Y | M | Shares the dropzone (SC-12) |
| WB-ADD-18 | Description sentence names the engines and the cadence | PV:L1260 | PARTIAL: neutral description exists; cadence wording not verified | BE-SCH | Y | S | "twice a week" (D-6) |

### 2.10 WB-EDT and other prompt dialogs

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-EDT-01 | Edit details dialog: topics (`term_ids`), importance, intent, Branded (G125) | PAR G125, W5 | NOT BUILT (no `edit-details-dialog.tsx`) | BE-PR `PATCH` | Y | M | No text field; API errors map to fields |
| WB-EDT-02 | Edit details: type (override) | W17 | NOT BUILT | BE-TYPE | M | S | |
| WB-EDT-03 | Edit details: funnel stage, language, country (if PATCH allows) | AP-03 | NOT BUILT | BE-PR (check PATCH fields) | Y | S | |
| WB-EDT-04 | Archive confirm (more than 100) | W10 | BUILT | BE-BARCH | Y | - | |
| WB-EDT-05 | Bulk Run confirm (runs, engines, 20 a day used) | W10 | BUILT | BE-RUN | Y | - | |
| WB-EDT-06 | Prompt editor (text) with lint, change kind, reason, "creates version N" warning (G69) | D20 5.6, PAR G69 | NOT BUILT | BE-VER, BE-LINT | N | L | S4 |
| WB-EDT-07 | Generate from keywords panel: pick tracked keywords, template sets, preview, budget | D20 5.13, D11 5.3 | NOT BUILT | BE-CAND | N | L | S4, Ph 11 |
| WB-EDT-08 | Link a keyword dialog (search tracked keywords, link type) (G99) | PV `linkKeywordRow` | NOT BUILT | BE-LINK | N | M | S4 |

### 2.11 WB-PI: prompt inspector (440 px)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PI-01 | Header: prompt text in quotes as `h2`, clamped to 2 lines | DS23 4.1 | BUILT (`prompt-inspector.tsx`) | BE-PR | Y | - | |
| WB-PI-02 | Header icons: previous (K), next (J), More, Close (Escape) | DS23 4.1, G101 | BUILT | none | - | - | |
| WB-PI-03 | Header "Open page" expand button | DS23 4.1 | NOT BUILT | BE-PD | N | S | S4 only |
| WB-PI-04 | Position "3 of 250", type word "Prompt", freshness | G101 | BUILT (`inspector.position`) | none | - | - | |
| WB-PI-05 | Badges: topic (returns to the topic drawer), Branded, Archived (G91) | PAR G91 | BUILT | none | - | - | |
| WB-PI-06 | Badge: topic path when opened from the Prompts tab (G91) | PAR G91 | PARTIAL: topic badge only when opened from a topic | BE-SUM | Y | S | |
| WB-PI-07 | Badges: type, panel, version (G91) | PAR G91 | NOT BUILT | BE-TYPE, BE-PNL, BE-VER | N | S | |
| WB-PI-08 | Run now button in the header | G101 | BUILT | BE-PR run-now | Y | - | Refusal reasons in words |
| WB-PI-09 | Archive with Undo; archived prompt shows no actions | AP-22 | BUILT | BE-PR | Y | - | |
| WB-PI-10 | Strip: Mention rate per engine with k of n, plus one Citation rate average (G92) | PAR G92 | BUILT (`inspector-strip.tsx`) | BE-SUM | Y | - | |
| WB-PI-11 | Strip: change per engine | W3 | NOT BUILT | as WB-TPF-06 | Y | S | |
| WB-PI-12 | Tabs Latest, History, Competitors, Stats in `?itab=` (G90) | PAR G90, W4 | BUILT (`PROMPT_TABS`) | none | - | - | Latest left out of the address |
| WB-PI-13 | Citations tab (G97) | PAR G97, W7, CI-15 | NOT BUILT (not in `PROMPT_TABS`) | BE-SRC-D, BE-SRC-P, BE-CIT with `filter[prompt_id]` (built) | M | M | See WB-PIC |
| WB-PI-14 | Fan-out tab, only when an enabled engine exposes fan-out | W9, U-07 | NOT BUILT | BE-FO (built) | M | M | See WB-PIF |
| WB-PI-15 | Tab count limit 5 (DS23 4.1) vs 6 with Fan-out | DS23 4.1, DS16 | DECISION NEEDED | none | - | - | Fan-out may fit Prompt Detail only, or replace a tab |
| WB-PI-16 | Facts section: topic, language, importance, added, added by | slice 1 | BUILT (`inspector.facts`) | BE-PR | Y | - | |
| WB-PI-17 | Load error with reason, unknown prompt, malformed id | PC | BUILT | none | - | - | |
| WB-PI-18 | Responsive: docked at 1440, overlay from 768, full-screen sheet below 768 | DS16 2.6, PV:L745 | BUILT by the shared inspector (not visually verified for prompts) | none | - | - | |
| WB-PI-19 | Resize handle | `components/app/inspector/inspector-resize-handle.tsx` | BUILT (shared) | none | - | - | |
| WB-PI-20 | Manual runs left today in the header row | PR-12 | NOT BUILT | BE-QUOTA | M | S | |
| WB-PI-21 | Header banner "Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13 pages cited" (CI-16) | STU CI-16 | NOT BUILT | BE-SRC-P count, BE-OBS | M | S | `Banner` in the inspector |
| WB-PI-22 | "Open statistics" link to the statistics panel (G102) | PV:L832 | NOT BUILT | none (formula) | - | M (SC-10) | |
| WB-PI-23 | Hashed evidence shown (answer and raw SHA-256) | STU L4 | NOT BUILT | BE-OBS (check fields) | Y | S | Optional, in the answer viewer details |

#### WB-PIL: Latest tab

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PIL-01 | Latest valid answer per engine over 90 days, first 280 characters marked (G93) | PAR G93 | BUILT (`inspector-latest.tsx`, `latest-model.ts`) | BE-OBS | Y | - | `ResponsePreview` |
| WB-PIL-02 | Facts per card: mentioned, cited, order of mention (never Rank) (D-9) | PAR D-9 | BUILT | BE-OBS | Y | - | |
| WB-PIL-03 | First three sources as chips, "+N" overflow | DS23 4.4 | PARTIAL: three sources; overflow chip and domain inspector link not built | BE-OBS | Y | S | `DomainChip` (SC-07) |
| WB-PIL-04 | "Open evidence" per engine to the answer viewer | G93 | BUILT (`inspector.latest.open`) | none | - | - | |
| WB-PIL-05 | Partial answers marked | W4 review | BUILT | none | - | - | |
| WB-PIL-06 | No valid answer, pending, no text states | messages | BUILT | none | - | - | |
| WB-PIL-07 | Recommended fact and structured Rank "1 of 3" | DS24 9.5 drawing | NOT BUILT | BE-REC | N | S | S2 |
| WB-PIL-08 | Replicate and status line "rep 3, Valid" | DS24 9.5 drawing | NOT BUILT (replicates are S3) | BE-CI replicates | N | S | |

#### WB-PIH: History tab

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PIH-01 | Mention rate chart per engine with 95% Wilson band (G94) | PAR G94 | BUILT (`inspector-history.tsx`, `lib/charts/rate-band-chart.ts`) | BE-SUM-SER | Y | - | Trailing 4 weeks pooled per point |
| WB-PIH-02 | Engine select for the chart | PV:L785 | BUILT (not re-verified) | none | - | - | |
| WB-PIH-03 | Hollow points under 4 answers, gap with none | W4 | BUILT | none | - | - | |
| WB-PIH-04 | Chart frame Table view with the same numbers | DS15 | BUILT | none | - | - | |
| WB-PIH-05 | Latest 10 answers table with outcome words (G95) | PAR G95 | BUILT | BE-OBS | Y | - | |
| WB-PIH-06 | Recommended tick column | PV:L791 | NOT BUILT | BE-REC | N | S | S2 |
| WB-PIH-07 | Events: added, engine reports another model (G96, M-19) | PAR G96 | BUILT (`historyEvents`) | BE-OBS `model_reported` | Y | - | |
| WB-PIH-08 | Event: "Gemini had no valid answer for N days" (stale) | W4 | NOT BUILT | BE-OBS | Y | S | |
| WB-PIH-09 | Events: version and panel membership | PAR G96 | NOT BUILT | BE-VER, BE-PNL | N | S | S4 |
| WB-PIH-10 | Version boundary marker on the chart (G70) | PAR G70 | NOT BUILT | BE-VER | N | S | |
| WB-PIH-11 | Model change marker on the chart | M-19, DS24 9.6 | NOT BUILT | BE-OBS | Y | S | markLine, label in the table view too |
| WB-PIH-12 | "Open full timeline" link (`itab=history` on Prompt Detail) | DS23 4.2 | NOT BUILT | BE-PD | N | S | |
| WB-PIH-13 | 28 day rolling series from daily answers | W4 plan | DROP (decided: trailing 4 weeks of the series) | - | - | - | |

#### WB-PIC: Citations tab (prompt)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PIC-01 | Top 5 domains with role and citation units (G97) | PAR G97, DS23 4.2 | NOT BUILT | BE-SRC-D `filter[prompt_id]` | M | M | `SimpleTable`, own row `surface-selected` |
| WB-PIC-02 | Top 5 pages with title and units | PAR G97 | NOT BUILT | BE-SRC-P `filter[prompt_id]` | M | S | `URLCell` (SC-07) |
| WB-PIC-03 | Per engine split of the top lists (engine select or columns) | CI-15, DS24 9.6 | NOT BUILT | BE-SRC-* `engines` per row | M | S | Fixed engine order |
| WB-PIC-04 | New and Lost markers vs the previous period | CI-15 | NOT BUILT | BE-SRC-D `compare=previous_period` | M | S | Neutral outline badges |
| WB-PIC-05 | Not cited state: "Not cited in 0 of 8 answers" with who is cited instead (PR-23) | STU PR-23 | NOT BUILT | BE-SRC-D | M | S | Neutral words, no paid action |
| WB-PIC-06 | Count cell popover listing up to 5 domains (U-15) | STU U-15 | NOT BUILT | BE-CIT | M | S (SC-09) | |
| WB-PIC-07 | Own page cited per answer ("Cited page" column) (PR-51, M-02) | STU PR-51 | NOT BUILT | BE-CIT role own | M | S | `displayUrl` |
| WB-PIC-08 | "Source 2 of 9" position, never "rank" (PR-32) | STU PR-32 | NOT BUILT | BE-CIT `citation_index` | M | S | |
| WB-PIC-09 | Empty and error states naming the cause | W2 rules | NOT BUILT | none | - | S | |
| WB-PIC-10 | `min_support` control | DS24 9.6 | NOT BUILT | BE-SRC-* (check param; fan-out has it) | M | S | Prompt Detail only in DS24 |

#### WB-PICO: Competitors tab (prompt)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PICO-01 | Counts of `facts.competitor_mentions` per entity, own first, one engine or all (G98) | PAR G98 | BUILT (`inspector-competitors.tsx`, `competitor-counts.ts`) | BE-OBS | Y | - | Says it reads the latest 200 at most |
| WB-PICO-02 | Switch to per entity Mentioned and SOV cells (W8) | W8 | NOT BUILT | BE-SUM-ENT with `filter[term]` or a prompt scope | Y | S | |
| WB-PICO-03 | Recommendation per entity (switch Mention or Recommendation) | PV:L812 | NOT BUILT | BE-REC | N | S | S2 |
| WB-PICO-04 | Related keywords with rank and AI Overview, "Link a keyword" (G99) | PAR G99 | NOT BUILT | BE-LINK, BE-TK | N | L | S4 |
| WB-PICO-05 | New and Lost per engine with k of n (U-16) | STU U-16 | NOT BUILT | BE-SUM-ENT, compare | Y | S | |
| WB-PICO-06 | No competitors tracked state with a link to Settings > Entities | messages | BUILT (`noneTrackedTitle`) | none | - | - | |

#### WB-PIS: Stats tab

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PIS-01 | Per engine Mention and Citation estimate, Wilson interval bar, sample (G100) | PAR G100 | BUILT (`inspector-stats.tsx`, `components/app/metric/confidence-indicator.tsx`) | none | - | - | |
| WB-PIS-02 | "Too few answers for a reliable rate" | W4 | BUILT | none | - | - | |
| WB-PIS-03 | Method note | W4 | BUILT (`inspector.stats.method`) | none | - | - | |
| WB-PIS-04 | Aggregation label and `SampleCount` component | DS24 9.5, DS25 9.6 | PARTIAL: sample shown as text; no `SampleCount` | none | - | S | |
| WB-PIS-05 | Server `ci` replaces the web interval | RM stage 4 | NOT BUILT | BE-CI | N | S | |
| WB-PIS-06 | `ConfidenceIndicator` registered in the design system page | W4 | NOT BUILT | none | - | S | `(internal)/design-system` |

#### WB-PIF: Fan-out tab (prompt) and fan-out views

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PIF-01 | Queries table: text, times used "In 6 of 12 ChatGPT answers", last seen (FO-01, FO-03, FO-05) | W9 | NOT BUILT | BE-FO | M | M | `DataTable`, sort, search |
| WB-PIF-02 | "New in window" badge with first seen date (FO-04) | W9 | NOT BUILT | BE-FO `first_seen_at` | M | S | Neutral |
| WB-PIF-03 | Expandable row: domains cited in those answers, worded as an association (FO-09) | W9, U-07 | NOT BUILT | BE-FO `cited_domains` | M | S | |
| WB-PIF-04 | `min_support` control, default 2 (FO-17) | W9 | NOT BUILT | BE-FO | M | S | In the URL |
| WB-PIF-05 | Engine note "Gemini and AI Mode do not expose fan-out" | W9 | NOT BUILT | none | - | S | Never zero |
| WB-PIF-06 | Truncated list note (`provider_extras` 16 KB bound) | RM risk | NOT BUILT | BE-FO truncated flag (check) | M | S | |
| WB-PIF-07 | Topic clusters of fan-out queries (FO-11) | STU FO-11 | NOT BUILT | BE-FO `filter[term]` | M | S | |
| WB-PIF-08 | Own retrieved and cited rate per query (FO-07) | STU FO-07 | NOT BUILT | BE-SRCX retrieved-not-cited | N | M | S2 |
| WB-PIF-09 | Matched keywords with rank, "Add to keyword inbox" (M-20) | DS24 9.6 | NOT BUILT | BE-TK, keyword candidates | N | M | Ph 15 |
| WB-PIF-10 | Project-wide fan-out view (all prompts) | STU N2 | NOT BUILT | BE-FO without `filter[prompt_id]` | M | M | Home: Discover or Citations tab; decide |
| WB-PIF-11 | No priority score | STU FO-08 | DROP | - | - | - | |

### 2.12 WB-ANS: answer viewer

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-ANS-01 | Answer text with own and competitor marks at UTF-16 spans | PR-27, L3 | BUILT (`answer-inspector.tsx`, `answer-segments.ts`, `marked-answer.tsx`) | BE-OBS | Y | - | Markdown shown as text |
| WB-ANS-02 | Mark accessible names (brand, how matched, how sure) | D20 782 | BUILT | none | - | - | |
| WB-ANS-03 | Mentions list with counts, order, uncertain flag, via product | messages `answer.*` | BUILT | BE-OBS | Y | - | |
| WB-ANS-04 | Sources with role (own, competitor, third party) and host (PR-31) | PR-31 | BUILT | BE-OBS | Y | - | |
| WB-ANS-05 | Ads note | D20 782 | BUILT | none | - | - | |
| WB-ANS-06 | Status: complete, partial, empty, refused, error, with reasons | L7 | BUILT | BE-OBS | Y | - | |
| WB-ANS-07 | Details: engine, observed, model, outcome, check | messages | BUILT | BE-OBS | Y | - | |
| WB-ANS-08 | Download raw answer (button), past retention 410, unavailable 503 | PC | BUILT | BE-OBS raw | Y | - | `raw:read` |
| WB-ANS-09 | Back to the prompt | D20 782 | BUILT | none | - | - | |
| WB-ANS-10 | Inline citation markers [n] jumping to the source list item (PR-29) | DS23 5.4, DS25 15.14 | NOT BUILT | BE-OBS citation offsets (check `first_char_offset`) | Y | M (SC-11) | |
| WB-ANS-11 | Entity toggle list (show or hide marks per entity) | DS25 15.15, SYN 6 item 6 | NOT BUILT | none | - | S | |
| WB-ANS-12 | Formatted and Raw view modes (`AnswerViewMode`) | DS25 15.18, PR-27 | NOT BUILT (text only) | none | - | M | SafeMarkdown needs the XSS fixtures (D20 8.2) |
| WB-ANS-13 | FactsFooter | DS23 5.5 | PARTIAL (details section) | none | - | S | |
| WB-ANS-14 | "Open at the provider" link | STU L3 | NOT VERIFIED | BE-OBS | Y | S | `rel="noopener noreferrer"` |
| WB-ANS-15 | Answer compare (latest vs last that named you) (M-03) | DS23 6.3 | NOT BUILT | BE-OBS | Y | L | Prompt Detail only |
| WB-ANS-16 | Quoted passage per source (CI-11) | STU CI-11, U-24 | NOT BUILT | not in `ai.citations` (Q1 open) | N | S | Only if the provider gives one |

### 2.13 WB-TI: topic inspector (440 px)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-TI-01 | Header: topic name, type "Topic", prompt count, back | D20 782 | BUILT (`topic-inspector.tsx`) | BE-SUM | Y | - | |
| WB-TI-02 | Header: category and scope badges | DS23 4.2 | PARTIAL: category path not in the header (not verified) | BE-TAX | Y | S | |
| WB-TI-03 | Header "Add prompt" button (G110) | PAR G110, PV:L755 | NOT BUILT | BE-PR | Y | S | Opens Add prompts with the topic |
| WB-TI-04 | Header "Run now" for the topic's prompts | PV:L755 | NOT BUILT | BE-RUN | Y | S | Same confirm as bulk |
| WB-TI-05 | J and K between topics, "3 of 13" (G118) | PAR G118 | NOT BUILT (shortcut comment) | none | - | S | |
| WB-TI-06 | Tabs Overview and Prompts in `itab` | D20 782 | BUILT (`TOPIC_TABS`) | none | - | - | |
| WB-TI-07 | Tabs Competitors and Related | DS23 4.2 | NOT BUILT | see below | - | - | Tabs added when data exists |
| WB-TI-08 | Three rate cards: Mentioned, Cited, SOV, avg of N | PAR G111 | BUILT | BE-SUM | Y | - | |
| WB-TI-09 | Change on the three cards (G111) | PAR G111, W3 | NOT BUILT | as WB-TPF-06 | Y | S | |
| WB-TI-10 | By engine rates with k of n | PAR G113 | BUILT (text) | BE-SUM | Y | - | |
| WB-TI-11 | By engine bars (G113) | PAR G113, W2 | NOT BUILT | BE-SUM | Y | S | `BarList` (SC-13) |
| WB-TI-12 | Visibility trend: own brand vs 3 most mentioned competitors, 8 weeks (G112) | PAR G112, W11 | NOT BUILT | BE-SUM-SER plus BE-SUM-ENT with `filter[term]` (both built); entity series per week needs both in one read | Y | M | Own brand `chart-1`; no jitter lines |
| WB-TI-13 | "In search" card: keyword count, Top 10, link to Rankings (G114) | PAR G114, W16 | NOT BUILT | BE-TK | Y | M | |
| WB-TI-14 | "In search" SEO visibility | PAR G114 | NOT BUILT | BE-SEO-T | N | S | |
| WB-TI-15 | Top 5 prompts with mention and citation | PAR G115 | BUILT | BE-SUM | Y | - | |
| WB-TI-16 | Change column on top prompts, "View all" | PAR G115 | PARTIAL: View all link exists (`onTabChange('prompts')`); no change | as WB-TPF-06 | Y | S | |
| WB-TI-17 | Prompts tab: every prompt of the topic and below, opens the prompt inspector with topic stepping | D20 782 | BUILT | none | - | - | No paging (150 cap) |
| WB-TI-18 | Competitors tab: entities by engine, own first with swatch, SOV `BarList`, tracked set and dates in the footnote (G116) | PAR G116, W8, DB-12 | NOT BUILT | BE-SUM-ENT `filter[term]` (built) | Y | M | 20 entity cap stated |
| WB-TI-19 | Related tab: sibling topics with prompts and mention (G117) | PAR G117 | NOT BUILT | BE-TAX, BE-SUM | Y | S | |
| WB-TI-20 | Related tab: related keywords with rank and AI Overview | PAR G117 | NOT BUILT | BE-TK `filter[term]`, `include=aio` | Y | M | Linked badge S4 |
| WB-TI-21 | Empty, unknown topic, load failed states | messages | BUILT | none | - | - | |
| WB-TI-22 | Prompt opened from the drawer keeps the topic list; badge returns to the drawer tab | D20 782 | BUILT | none | - | - | |
| WB-TI-23 | Deeper (level 3) topic name shown as a path | W2-T | PARTIAL (not verified) | BE-TAX | Y | S | |

### 2.14 WB-PNL: Panels tab (hidden until S4, D-4)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PNL-01 | Panels table: name, Locked badge, kind, prompts, schedule, engines, changed in 90 days, last run (G60) | PAR G60, PV:L274 | NOT BUILT | BE-PNL; schedules and runs readable | N | L | |
| WB-PNL-02 | Panel kinds core, discovery, experiment, custom (G61) | PAR G61 | NOT BUILT | BE-PNL | N | M | Experiment is Ph 15 |
| WB-PNL-03 | Create panel dialog (name, kind, engines, cadence) | PAR G61 | NOT BUILT | BE-PNL | N | M | Cadence twice a week default (D-6) |
| WB-PNL-04 | Rename, delete panel (confirm) | PAR G61 | NOT BUILT | BE-PNL | N | S | |
| WB-PNL-05 | Core lock and unlock with reason (`panels:core:modify`) (G62) | PAR G62, D20 5.7 | NOT BUILT | BE-PNL | N | M | |
| WB-PNL-06 | Add and remove members with reason, 10% churn warning banner (G62) | PAR G62 | NOT BUILT | BE-PNL `meta.churn_90d` | N | M | |
| WB-PNL-07 | Membership history list (who, why, when; adds and removals filter) (G64) | PAR G64 | NOT BUILT | BE-PNL | N | M | `EventTimeline` exists |
| WB-PNL-08 | Sizing guidance: measured flip rate per engine, "can detect N points", "Try a size" (G65, M-17) | PAR G65 | NOT BUILT | BE-CI flip rate, BE-PNL sizing; formula in `lib/stats/panel.ts` | N | M | Never ship the preview constants |
| WB-PNL-09 | Promotion candidates from Discovery with check columns, Promote dialog with reason (G63) | PAR G63, D20 5.7 | NOT BUILT | BE-PNL promotion-candidates | N | L | |
| WB-PNL-10 | Run now for a panel (G66) | PAR G66 | NOT BUILT | BE-RUN, BE-PNL | N | S | |
| WB-PNL-11 | Panel row opens a panel inspector or `panels/[panelId]` | D20 5.7 | NOT BUILT | BE-PNL | N | M | Decide inspector vs page |

### 2.15 WB-VER: Versions tab (hidden until S4)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-VER-01 | Versions table: date, prompt, change kind, "v2 to v3", author, reason; row opens prompt (G67) | PAR G67, PV:L309 | NOT BUILT | BE-VFEED (B12) | N | M | No invented authors |
| WB-VER-02 | Change kind filter, date range | B12 | NOT BUILT | BE-VFEED | N | S | |
| WB-VER-03 | Restore a version (audit entry, not a change kind) (G68) | PAR G68 | NOT BUILT | BE-VER restore | N | M | Confirm dialog |
| WB-VER-04 | Diff view of two versions | D20 5.6 Timeline | NOT BUILT | BE-VER | N | M | |
| WB-VER-05 | Version boundary on every AI chart of the prompt (G70) | PAR G70 | NOT BUILT | BE-VER | N | S | Shared chart markLine (SC-14) |
| WB-VER-06 | Rates not compared across a boundary | PV:L309 | NOT BUILT | BE-VER | N | S | |
| WB-VER-07 | "Header note: a wording change starts a new version" | PV:L309 | NOT BUILT | none | - | S | |
| WB-VER-08 | Edit prompt text as a new version (see WB-EDT-06) (G69) | PAR G69 | NOT BUILT | BE-VER | N | L | |

### 2.16 WB-PD: Prompt Detail page (T3, S4)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-PD-01 | Route `/ai/prompts/[promptId]`, `DetailPageHeader` with Edit, Statistics, More, primary Run now | DS24 9.6 | NOT BUILT | BE-PD | N | L | |
| WB-PD-02 | Meta line: version, core since, topic path, intent, type, branded | DS24 9.6 | NOT BUILT | BE-PR, BE-VER | N | S | |
| WB-PD-03 | Compare and Engines scopes | DS24 9.6 | NOT BUILT | as WB-TPF-06 | Y | S | |
| WB-PD-04 | Strip md: mention per engine, citation avg, recommendation, structured top 3 | DS24 9.6 | NOT BUILT | BE-SUM, BE-REC | Y | S | |
| WB-PD-05 | Overview tab: rate table with intervals and outcome mix bar per engine | DS24 9.6 | NOT BUILT | BE-SUM outcomes, BE-CI | Y | M | `OutcomeMixBar` (SC-13) |
| WB-PD-06 | Overview: per engine trend small multiples, 140 px, CI bands, version and model boundaries, connected crosshair | DS24 9.6 | NOT BUILT | BE-SUM-SER, BE-VER | Y | M | `SmallMultiples` (SC-14) |
| WB-PD-07 | Overview: recommendation and sentiment (four shares, no score) | DS24 9.6, DB-09 | NOT BUILT | BE-REC | N | M | |
| WB-PD-08 | Overview: related keywords | DS24 9.6 | NOT BUILT | BE-LINK | N | M | |
| WB-PD-09 | Answers tab: observations table with the evidence viewer split; compare two | DS24 9.6 | NOT BUILT | BE-OBS | Y | L | `obs=` in the URL |
| WB-PD-10 | Citations tab with `min_support` and engine split | DS24 9.6 | NOT BUILT | BE-SRC-* | M | M | Shares WB-PIC parts |
| WB-PD-11 | Competitors tab: mention, recommendation, SOV per entity, A14 gap with paired interval | DS24 9.6 | NOT BUILT | BE-SUM-ENT, BE-CI | Y | M | |
| WB-PD-12 | Fan-out tab | DS24 9.6 | NOT BUILT | BE-FO | M | M | Shares WB-PIF parts |
| WB-PD-13 | History tab: `EventTimeline` of versions, membership, model and extractor changes; volatility | DS24 9.6 | NOT BUILT | BE-VER, BE-CI | N | M | |
| WB-PD-14 | Statistics panel (`StatisticsPanel`) | D20 6 | NOT BUILT | none | - | M (SC-10) | |
| WB-PD-15 | Diagnostics tab ("why did we lose this prompt") (M-18) | D20 5.14 | NOT BUILT | none (Ph 15) | N | L | Hypotheses kept apart |

### 2.17 WB-OV: AI Visibility Overview `/ai` (W13)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-OV-01 | Route and nav entry | W13, NAV | NOT BUILT | none | - | S | |
| WB-OV-02 | Header with AI freshness "AI updated Sep 28, 02:10" | DS24 9.2 | NOT BUILT | BE-SUM-T | Y | S | |
| WB-OV-03 | Filter bar: Compare, Engine, Topic, Branded Excluded default chip | DS24 9.2 | NOT BUILT | BE-SUM-S, compare | Y | S | |
| WB-OV-04 | Strip: one mention item per engine (never pooled), change, k of n (DB-01) | W13, DB-01 | NOT BUILT | BE-SUM (or BE-OVR) | Y | S | Reuse `strip-model.ts` (move to `lib` if two features) |
| WB-OV-05 | Mention rate trend per engine with CI band (small multiples or one chart with series menu) | DS24 9.2, PV:L381 | NOT BUILT | BE-SUM-SER | Y | M | `ai.mention_trend` card |
| WB-OV-06 | AI by engine table: Mention, Citation, Recommendation, SOV, Own citation; equal-weight line with 2+ engines | DS24 9.2 S5, PV:L465 | NOT BUILT | BE-SUM, BE-SRC-D own share, BE-REC | Y | M | `SimpleTable` |
| WB-OV-07 | Citation share by domain type as a 100% bar (`OutcomeMixBar`), no donut | W13, PV:L513 | NOT BUILT | BE-SRC-D roles (built); categories BE-SRCX | M | M | |
| WB-OV-08 | Share of voice by entity `BarList` (own `chart-1`) | W13, DB-12, PV:L526 | NOT BUILT | BE-SUM-ENT | Y | M | Tracked set footnote |
| WB-OV-09 | Competitors summary table (AI SOV per engine) | DS24 9.2, PV:L478 | NOT BUILT | BE-SUM-ENT | Y | S | |
| WB-OV-10 | Key changes feed (detectable AI changes, collection issues, notices) | DS24 9.2 S4, PV:L440 | NOT BUILT | compare, BE-RUNS, BE-ALR | Y partly | M | `ChangeFeed` (SC-16) |
| WB-OV-11 | Collection status card (AI prompts answered, failed, next AI run) | PV:L533 | NOT BUILT | BE-RUNS, BE-SCH | Y | S | |
| WB-OV-12 | New sources count | PV:L448 | NOT BUILT | BE-SRC-D compare | M | S | |
| WB-OV-13 | Empty and no engine states | DS17 | NOT BUILT | none | - | S | |
| WB-OV-14 | Customizable layout (card catalog) | layout spec 2026-09-30 | NOT BUILT | none | - | L | Platform; out of AI scope |
| WB-OV-15 | No composite visibility score anywhere | DB-07, NFR-10 | DROP | - | - | - | |

### 2.18 WB-CIT: Citations page `/ai/citations` (W7)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-CIT-01 | Route, nav entry, `PageHeader` with Saved view, Export, More | DS24 9.7 | NOT BUILT | none | - | S | |
| WB-CIT-02 | Meta "Updated ..., 18,420 citation units in 4,812 observations" | DS24 9.7, CI-01 | NOT BUILT | BE-SRC-D `meta` | M | S | |
| WB-CIT-03 | Tabs Domains, Pages, New and lost (`tab=`) | DS24 9.7 | NOT BUILT | none | - | S | |
| WB-CIT-04 | Filter bar: Engines, Role (Own, Competitor, Third party with counts), Topic, Compare | DS24 9.7 | NOT BUILT | BE-SRC-* (`filter[domain_role_in]`, `filter[term]`, `compare`) | M | M | Role filter narrows rows, not the denominator |
| WB-CIT-05 | Strip: Citation units, Distinct domains, Effective sources (C3), Own citation share with change, New sources, Lost sources | DS24 9.7, CI-04 | NOT BUILT | BE-SRC-D meta; C3 computed in the web or BE | M | M | Own share always shown regardless of the role filter |
| WB-CIT-06 | Domains table: Domain (favicon), Role, Category, Units, Share, Change in share, per engine share, Cited with, New or Lost, Trend | DS24 9.7 | NOT BUILT (Domain, Role, Units, Share, engines, previous are in BE-SRC-D; Category, Cited with, Trend are not) | BE-SRC-D; BE-SRCX for category and Cited with; series not in the route | M | L | `DomainCell` (SC-07) |
| WB-CIT-07 | Domain row expands to its top 10 pages, "View all 48 pages" opens Pages filtered | DS24 9.7, DS12 16 | NOT BUILT | BE-SRC-P `filter[registrable_domain]` | M | M | One level |
| WB-CIT-08 | Observations and Prompts columns in the chooser | DS24 9.7 | NOT BUILT | BE-SRC-D | M | S | |
| WB-CIT-09 | `min_support` select | DS24 9.7 | NOT BUILT | BE-SRC-* (check param) | M | S | |
| WB-CIT-10 | Pages tab: URL with host, escaped title, role, units, share, engines, first seen, last seen | DS24 9.7, CI-07 | NOT BUILT | BE-SRC-P | M | M | `URLCell` |
| WB-CIT-11 | Pages tab: "Cited with" column (CI-14) | STU CI-14 | NOT BUILT | BE-SRCX | N | S | |
| WB-CIT-12 | Pages tab: "Retrieved, not cited (ChatGPT)" scope chip (C8) | DS24 9.7 | NOT BUILT | BE-SRCX | N | M | S2 |
| WB-CIT-13 | New and lost tab: C5 and C6 lists with the rule in `MetricInfo` | DS24 9.7 | NOT BUILT | BE-SRC-D compare (new = previous 0); lost needs 2 windows | M | M | "Lost after 0 units in 2 following windows" |
| WB-CIT-14 | Count cell popover of up to 5 domains (U-15) | STU U-15 | NOT BUILT | BE-CIT | M | S (SC-09) | |
| WB-CIT-15 | Prompts with no own page cited (M-02) | STU M-02 | NOT BUILT | BE-CIT | M | M | In words |
| WB-CIT-16 | Export CSV of the table | M-16 | NOT BUILT | none | - | S | Shared writer |
| WB-CIT-17 | Category override dialog on a domain row | D20 5.9 | NOT BUILT | BE-SRCX | N | S | Ph 13 |
| WB-CIT-18 | Include unresolved redirects and engine-internal links toggles (off) | D20 5.9 | NOT BUILT | not in the route | N | S | |
| WB-CIT-19 | Empty (no citations yet), error, loading states | DS17 | NOT BUILT | none | - | S | |
| WB-CIT-20 | Mobile list rows | DS19 6.7 | NOT BUILT | none | - | S (SC-04) | |
| WB-CIT-21 | Country scope | M-11 | NOT BUILT | BE-SRC-* lack `filter[country_iso]` | N | S | CF-08 |

#### WB-DOM and WB-SRC: domain and source inspectors

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-DOM-01 | Domain inspector header: domain, category, role, freshness | DS23 4.2 | NOT BUILT | BE-SRC-D | M | S | `?inspect=domain:` |
| WB-DOM-02 | Strip: units, share, observations, prompts | DS23 4.2 | NOT BUILT | BE-SRC-D | M | S | |
| WB-DOM-03 | Overview: share trend per engine | DS23 4.2 | NOT BUILT | series per domain not in the route | N | M | CF-07 |
| WB-DOM-04 | Overview: per engine breakdown table | DS23 4.2 | NOT BUILT | BE-SRC-D `engines` | M | S | |
| WB-DOM-05 | Overview: entities co-mentioned when cited | DS23 4.2 | NOT BUILT | BE-SRCX | N | M | |
| WB-DOM-06 | Overview: SEO SOV of the domain on project keywords | DS23 4.2 | NOT BUILT | SEO routes | N | M | |
| WB-DOM-07 | Pages tab: top 10 cited pages | DS23 4.2 | NOT BUILT | BE-SRC-P | M | S | |
| WB-DOM-08 | Prompts tab: top 10 prompts citing the domain with engine | DS23 4.2 | NOT BUILT | BE-CIT `filter[registrable_domain]` | M | S | Opens the prompt inspector |
| WB-SRC-01 | Source (cited URL) inspector: title escaped, host, trend, engines | DS23 4.2 | NOT BUILT | BE-SRC-P, BE-CIT `filter[url_id]` | M | M | |
| WB-SRC-02 | Source inspector Prompts tab | DS23 4.2 | NOT BUILT | BE-CIT | M | S | |
| WB-SRC-03 | Source inspector Answers tab: last 10 answers, open evidence with the marker focused | DS23 4.2 | NOT BUILT | BE-CIT, BE-OBS | M | S | |
| WB-SRC-04 | Quoted passage section (CI-11) | STU CI-11 | NOT BUILT | none | N | S | Conditional |

### 2.19 WB-SRCS: Sources page `/ai/sources` (Ph 13)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-SRCS-01 | Route, tabs Publishers, Categories, Opportunities | NAV | NOT BUILT | BE-SRCX | N | L | |
| WB-SRCS-02 | Categories: C4 category distribution per engine as 100% bars; C3 diversity | D20 5.9 | NOT BUILT | BE-SRCX | N | M | `StackedBar100` |
| WB-SRCS-03 | Publisher opportunities list: domain, reach, opportunity share, competitors mentioned, sample observations, page titles, category (D14 7) | D14 7, OP-08 to OP-10 | NOT BUILT | BE-SRCX | N | L | Header "Sources frequently cited in answers that mention competitors but not you" |
| WB-SRCS-04 | Opportunities rows: condition label, counts with n, popover, expandable checklist, related prompts link, status todo or done (U-09, OP-04, OP-07, OP-12, OP-14) | STU | NOT BUILT | BE-SRCX, a task status table | N | L | No LLM drafts, no credits |
| WB-SRCS-05 | Source gap: domains cited where competitors are named and you are not (M-05) | STU M-05 | NOT BUILT | BE-SRCX competitor-overlap | N | M | |
| WB-SRCS-06 | Drafted outreach content (Reddit, LinkedIn) | OP-13 | DROP (SCOPE) | - | - | - | |

### 2.20 WB-CMP: Competitors page `/competitors`

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-CMP-01 | Route, tabs Comparison, SEO, AI, Candidates (count) | DS24 9.8 | NOT BUILT | BE-CMP | N | L | |
| WB-CMP-02 | Header: Saved view, primary Add competitor (560 px dialog with SOV effect note) | DS24 9.8, D20 5.10 | NOT BUILT | BE-ENT | Y | M | Settings > Entities has the editor |
| WB-CMP-03 | Channel summary table: entity columns, AI rows per engine (SOV, mention, recommendation, citation share) | DS24 9.8, DB-28 | NOT BUILT | BE-SUM-ENT (mention, SOV); BE-REC; BE-SRC-D for citation share | Y | M | Own brand first, `chart-1` swatch |
| WB-CMP-04 | By topic entity comparison with MetricSwitcher and Gap vs leader, coloured only when detectable | DS24 9.8, DS23 6.1 | NOT BUILT | BE-SUM-ENT per topic row | Y | M | |
| WB-CMP-05 | Top competitor (DB-17) | STU DB-17 | NOT BUILT | BE-SUM-ENT | Y | S | |
| WB-CMP-06 | "Named in 35 of 192 answers" per entity per engine (DB-21) | STU DB-21 | NOT BUILT | BE-SUM-ENT | Y | S | |
| WB-CMP-07 | Prompts we lose to a named competitor, by importance (M-23) | STU M-23 | NOT BUILT | BE-OBS facts or BE-SUM-ENT per prompt | Y | M | |
| WB-CMP-08 | Source overlap with a competitor (C7, Jaccard) | DS24 9.8 | NOT BUILT | BE-SRCX | N | M | Ph 13 |
| WB-CMP-09 | Candidates tab: brands seen and not tracked, prompts and engines, Track (M-22, DB-20) | DS24 9.8 | NOT BUILT | BE-CMP candidates | N | M | S2; SOV boundary note |
| WB-CMP-10 | SOV charts draw a boundary when the tracked set changes | D20 5.10 | NOT BUILT | BE-ENT added dates | Y | S | |
| WB-CMP-11 | AI tab: per engine SOV trends | DS24 9.8 | NOT BUILT | entity series (CF-06) | N | M | |
| WB-CMP-12 | Competitor inspector (side by side, AI gap with interval, sources) | DS23 4.2 | NOT BUILT | BE-CMP, BE-CI | N | M | |

### 2.21 WB-DSC: Discover > Prompts and Opportunities (W12)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-DSC-01 | Route `/discover/prompts`, tabs Keywords, Prompts, Opportunities with counts | DS24 9.11 | NOT BUILT | BE-CAND | N | M | |
| WB-DSC-02 | Status `SegmentedControl` New, Accepted, Snoozed, Rejected | DS24 9.11 | NOT BUILT | BE-CAND | N | S | `status=new` default |
| WB-DSC-03 | Candidates table: text (editable before accept), source chip, source link, near duplicate indicator, suggested terms and intent, linked keywords, AI demand (Estimate), GSC impressions | D20 5.13 | NOT BUILT | BE-CAND | N | L | No volume column |
| WB-DSC-04 | Stage and intent `FilterChip`s (AP-03, U-06) | STU U-06 | NOT BUILT | BE-CAND | N | S | Neutral, no buyer intent colours |
| WB-DSC-05 | Per row Add and "Already tracked" state (AP-09) | STU AP-09 | NOT BUILT | BE-CAND, BE-PR | N | S | |
| WB-DSC-06 | Bulk bar: Accept, Snooze, Reject, Topic, Intent, Priority, Add to discovery panel, Add to core (reason) | D20 5.13, DS24 9.11 | NOT BUILT | BE-CAND, BE-PNL | N | M | No "Add all" without a preview |
| WB-DSC-07 | Banner "Generated phrasing, not an observed user prompt"; "Bing grounding phrase, not a user prompt" | D20 5.13 | NOT BUILT | BE-CAND source | N | S | |
| WB-DSC-08 | Evidence panel inspector 400 px with triage footer (Reject r, Snooze s, Accept a) | DS24 9.11 | NOT BUILT | BE-CAND | N | M | The one footer outside edit mode |
| WB-DSC-09 | Generate prompts primary action (from keywords) | DS24 9.11 | NOT BUILT | BE-CAND | N | M | Budget left shown |
| WB-DSC-10 | Customer FAQ upload with personal data warning and 30 day retention | D20 5.13 | NOT BUILT | BE-CAND uploads | N | M | Ph 11 |
| WB-DSC-11 | Opportunities tab: OpportunityStatus conditions with triage (Accept adds to a work list) | DS24 9.11, DS23 7.3 | NOT BUILT | BE-SRCX, matrix | N | L | |
| WB-DSC-12 | Fan-out query source chip on candidates | FO-01 | NOT BUILT | BE-FO, BE-CAND | N | S | |
| WB-DSC-13 | Optimistic triage with failure return and toast | D20 5.12 | NOT BUILT | BE-CAND | N | S | |

### 2.22 WB-ALR: AI alerts

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-ALR-01 | Settings > Alert rules list (`RuleList`) with AI rule types grouped by channel | D20 5.17, NAV | NOT BUILT | BE-ALR | N | M | |
| WB-ALR-02 | Rule builder dialog: type, parameters from the rule schema, scope (topics, prompts, engines), delivery, mode, preview count | D20 5.17 | NOT BUILT | BE-ALR, preview backtest | N | L | "Fires only when the 95% interval excludes zero" |
| WB-ALR-03 | AI rule types: mention lost or gained, citation lost or gained, panel change, competitor SOV overtake, new source, model changed, collection degraded (D11 10) | D11 10 | NOT BUILT | BE-ALR | N | M | "Possible change" until detectable |
| WB-ALR-04 | Notification bell list, grouped, unread count | DS25 5.16, 5.17 | NOT BUILT | BE-ALR notifications | N | M | |
| WB-ALR-05 | Event opens the entity inspector with the event highlighted on History | DS23 4.3 | NOT BUILT | BE-ALR | N | S | |
| WB-ALR-06 | Digest archive view | D20 5.17 | NOT BUILT | BE-ALR digests | N | M | |
| WB-ALR-07 | Anomaly hold and flapping mute notices | D20 5.17 | NOT BUILT | BE-ALR | N | S | |

### 2.23 WB-RPT: Reports and exports

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-RPT-01 | Client CSV export on every AI table | M-16 | PARTIAL: Topics and Prompts only (`export-rows.ts`) | none | - | S per table | Formula-safe writer `lib/csv/csv-write.ts` |
| WB-RPT-02 | XLSX export of AI tables | Rankings export | NOT BUILT | none | - | S | Move `features/rankings/export/export-file.ts` to `lib` (features cannot import each other) |
| WB-RPT-03 | Reports page: Scheduled, Exports, Saved views tabs | NAV | NOT BUILT | BE-EXP, BE-VIEWS | N | L | |
| WB-RPT-04 | Shareable report link and PDF per client project (M-12) | STU M-12 | NOT BUILT | BE-EXP | N | L | NEW |
| WB-RPT-05 | Scheduled report and digest email (M-13) | STU M-13 | NOT BUILT | BE-EXP, BE-ALR | N | L | |
| WB-RPT-06 | Chart annotations (page published, release) (M-14) | STU M-14 | NOT BUILT | annotations store | N | M | |
| WB-RPT-07 | Create report from Overview | DS24 9.2 | NOT BUILT | BE-EXP | N | S | |

### 2.24 WB-GEO: page-level AI readiness (W15, out of scope until decided)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-GEO-01 | "AI readiness" tab on SEO > Pages detail | W15, STU 4.7 | NOT BUILT | BE-GEO | N | L | Decision Q5 open |
| WB-GEO-02 | Target URL pick from watched pages or paste; the fetch it will make is shown (GA-01) | STU GA-01 | NOT BUILT | BE-GEO | N | M | |
| WB-GEO-03 | URL list or CSV import (GA-02) | STU GA-02 | NOT BUILT | BE-GEO | N | M | Wizard pattern of `features/rankings/import` |
| WB-GEO-04 | Pages analysed "11 of 38 watched pages checked, Oct 6" (GD-03) | STU GD-03 | NOT BUILT | BE-GEO | N | S | |
| WB-GEO-05 | Robots.txt per AI bot (GPTBot, Google-Extended, PerplexityBot), `llms.txt`, sitemap, meta robots (M-09) | STU M-09 | NOT BUILT | BE-GEO | N | M | Cheapest first |
| WB-GEO-06 | JSON-LD found vs expected for the page type (GD-16, M-10) | STU GD-16 | NOT BUILT | BE-GEO | N | M | |
| WB-GEO-07 | Checklist `SimpleTable`: check, status, the HTML fact behind it; no score (GD-15) | STU GD-15 | NOT BUILT | BE-GEO | N | M | |
| WB-GEO-08 | Failing checks per page with count of pages affected (GD-08) | STU GD-08 | NOT BUILT | BE-GEO | N | S | |
| WB-GEO-09 | Suggested fix snippet with copy, "suggestion, not applied" (GD-17) | STU GD-17 | NOT BUILT | BE-GEO | N | S | |
| WB-GEO-10 | Fix inbox with status suggested, reviewed, done (GF-02) | STU GF-02 | NOT BUILT | BE-GEO | N | M | |
| WB-GEO-11 | Freshness and authorship facts (GD-19), page type badge (GD-21), quotable passages (GD-25), content gaps (GD-18) | STU | NOT BUILT | BE-GEO, Ph 15 | N | M | |
| WB-GEO-12 | GEO scores, grades, "Critical" ratings, simulated answer | GD-01 to GD-24 | DROP (SCORE, NOISE) | - | - | - | |

### 2.25 WB-SET: settings that drive AI visibility

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-SET-01 | Settings > Engines: ChatGPT, Gemini, AI Mode with on or off, countries, estimated monthly cost before turning on | L6, PC task 3 | BUILT (`features/prompts/engines-screen.tsx`, route `settings/engines`) | BE-ENG | Y | - | |
| WB-SET-02 | Engines: turn off keeps saved countries; errors in words | PC | BUILT | BE-ENG | Y | - | |
| WB-SET-03 | Engines: cadence sentence "twice a week" | D-6 | BUILT (per RM decision 1, as built) | BE-SCH | Y | - | |
| WB-SET-04 | Engines: replicates per engine select | PV:L703 | NOT BUILT | BE-CI replicates | N | S | S3 |
| WB-SET-05 | Engines: AI Overview row "Collected with SERP checks, on the Rankings schedule" | PV:L706 | NOT BUILT | BE-AIO | N | S | S2 |
| WB-SET-06 | Engines: class column (Consumer UI, SERP AI, Official API) | PV:L701 | NOT BUILT (not verified) | BE-ENG | Y | S | |
| WB-SET-07 | Engines: Perplexity API row "Not available yet" | PV:L707 | NOT BUILT | none | - | S | Ph 14 class, never pooled |
| WB-SET-08 | Engines: estimated cost change summary on save | PV:L714 | PARTIAL (cost per engine shown; summary line not verified) | BE-ENG | Y | S | |
| WB-SET-09 | Settings > Schedules: the two AI answer schedules, pause and resume | PC task 10 | BUILT (`features/project-settings/schedules-screen.tsx`) | BE-SCH | Y | - | |
| WB-SET-10 | Settings > Entities and aliases: own brand, competitors, aliases, domains, colours | DB-12 | BUILT (`settings/entities`) | BE-ENT | Y | - | |
| WB-SET-11 | Entities: "added on" date per competitor shown for the SOV boundary footnote | DB-12 | NOT VERIFIED | BE-ENT | Y | S | |
| WB-SET-12 | Settings > Taxonomy (topic vocabulary) | D-3 | BUILT (`settings/taxonomy`) | BE-TAX | Y | - | |
| WB-SET-13 | Settings > Alert rules | WB-ALR-01 | NOT BUILT | BE-ALR | N | M | |
| WB-SET-14 | Settings > Data retention (raw answer retention class) | PV:L576 | NOT BUILT | retention API | N | M | |
| WB-SET-15 | Workspace > Budgets and usage: AI observations per month and active prompts meters | AP-17, DS23 11.2 | NOT BUILT | BE-QUOTA | M | M | `BudgetMeter` |
| WB-SET-16 | Onboarding: LLM competitor and topic suggestions with accept or reject (DB-31) | STU DB-31 | NOT BUILT | none | N | M | Low value |
| WB-SET-17 | Setup checklist steps for AI (engines on, prompts added, first answers) | DS23 13, PV:L355 | NOT BUILT | several | Y | M | Overview notice |

### 2.26 WB-OPS: runs and costs for AI

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-OPS-01 | Runs page lists AI runs with trigger and status | PR-15 | BUILT (`features/operations/runs-screen.tsx`) | BE-RUNS | Y | - | |
| WB-OPS-02 | Run inspector for an AI run (prompts, engines, valid rate) | DS23 4.3 | PARTIAL: `run-inspector.tsx` exists; AI-specific content (answers by status) not verified | BE-RUNS | Y | S | |
| WB-OPS-03 | Link from an AI page "Updated" to the run | M-24 | NOT BUILT | BE-RUNS | Y | S | |
| WB-OPS-04 | Collection progress while a run answers (`CollectionProgress`) on Topics & Prompts | DS23 12.1 | NOT BUILT on this page (`components/app/status/collection-progress.tsx` exists) | BE-RUNS | Y | S | |
| WB-OPS-05 | Collection degraded notice (valid rate under 90%) | PR-11, D11 10 | NOT BUILT | BE-RUNS or BE-ALR | Y | S | |
| WB-OPS-06 | Costs page: AI workload spend | D20 5.16 | BUILT (workload filter, `features/costs`) | costs | Y | - | |
| WB-OPS-07 | Unit cost per AI answer per engine | D20 5.16 | NOT BUILT | costs unit route | N | S | |

### 2.27 WB-XCH: AI data on other pages (cross-channel)

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-XCH-01 | Keyword inspector AI tab: `SEOAIStatus`, AI Overview last 10 checks, related prompts with mention and k of n | DS23 4.2 | NOT BUILT (AI part) | BE-LINK, BE-SUM | N | M | |
| WB-XCH-02 | Project Overview AI items in the strip, AI by engine table, competitors card | DS24 9.2 | NOT BUILT | as WB-OV | Y | M | Shares WB-OV models |
| WB-XCH-03 | Matrix: AI presence per keyword, quadrants, scatter | DS24 9.9 | NOT BUILT | BE-LINK, matrix route | N | L | |
| WB-XCH-04 | Page Intelligence: AI citation units per engine, prompts citing the URL, retrieved not cited | DS24 9.10 | NOT BUILT | BE-SRC-P, BE-CIT `filter[url_id]` | M | M | |
| WB-XCH-05 | Keyword to prompt coverage (M-25) | STU M-25 | NOT BUILT | BE-LINK | N | L | |
| WB-XCH-06 | AI referral sessions and crawler hits (M-21) | STU M-21 | NOT BUILT | first-party Ph 12 | N | L | |

### 2.28 WB-LAY: layout customization system (owner R-07)

The owner wants the AI Visibility Overview to be a greater version of the preview dashboard with the preview's full customization. The card catalog itself (which cards, charts and numbers the AI Overview offers, CH ids) is specified in `docs/ai-visibility/inventory/overview-and-charts.md`; this section lists only the layout machinery, which is shared by `overview`, `ai_overview`, the numbers zone of table pages and the drawer cards.

Sources: LAY = `docs/superpowers/specs/2026-09-30-layout-customization-design.md` (sections 5 to 13); PVC = `apps/web/design-preview/customize.js` and its markup in `index.html` (`#dlg-catalog`, `menu-card`, `menu-layout-save`, the Customize button at PV:L338, the save bar at PV:L555 to 559).

What exists in `apps/web/src`: only the pure rules in `lib/layouts` (`types.ts`, `catalog.ts`, `sanitize.ts`, `resolve.ts`, `availability.ts`, `rows.ts`, `draft.ts`, with `layouts.test.ts` and `retired.test.ts`), imported by nothing outside the folder. `ScreenKey` is `'overview' | 'inspector.keyword'` only. No React layout component, no `features/layouts`, no `@dnd-kit` in `apps/web/package.json`, no `packages/contracts` folder, no layout route in `lib/api/schema.ts`, no `layouts:manage` permission in `lib/permissions`. The preview holds the whole interaction, stored in browser storage.

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-LAY-01 | Layout document types (`LayoutDocument`, `NumberItem`, `CardItem`, widths) | LAY 6.1 | BUILT (`lib/layouts/types.ts`) | none | - | - | Spec placed it in `packages/contracts`; it lives in `lib/layouts` |
| WB-LAY-02 | Screen keys `ai_overview`, `prompts`, `citations`, `sources`, `inspector.prompt`, `inspector.topic` (and `inspector.citation`) | LAY 4 | NOT BUILT (`ScreenKey` has `overview`, `inspector.keyword`) | none | - | S | Add with each screen |
| WB-LAY-03 | Card and number catalog definitions (key, title, description, group, screens, widths, maxInstances, options, requires, status, addedOn) | LAY 7 | PARTIAL: `lib/layouts/catalog.ts` holds the `overview` and keyword drawer catalog; the AI Overview cards (overview-and-charts.md CH ids) are not in it | none | - | M | Generated JSON for the API validation (LAY 9.2) not built |
| WB-LAY-04 | Built-in default per screen (`SCREENS`) | LAY 7.1 | PARTIAL: `overview` and `inspector.keyword`; no `ai_overview` default | none | - | S | The default is the overview-and-charts.md proposal |
| WB-LAY-05 | `sanitizeLayout` (unknown types, widths, options, limits, duplicate identities, ids) and `sameLayout` | LAY 6.3 | BUILT (`lib/layouts/sanitize.ts`) | none | - | - | |
| WB-LAY-06 | `resolveLayout` personal, then team, then built-in; damaged document counts as absent | LAY 6.3 | BUILT (`lib/layouts/resolve.ts`) | none | - | - | |
| WB-LAY-07 | Document upgrade per schema version (`upgradeDocument`) | LAY 6.4 | NOT BUILT | none | - | S | Needed only at schema 2 |
| WB-LAY-08 | Retired card types render one release and cannot be added | LAY 6.4 | BUILT (`retired.test.ts`) | none | - | - | |
| WB-LAY-09 | `cardAvailability` against project capabilities and permissions | LAY 8 | BUILT (`lib/layouts/availability.ts`) | project capabilities (channels on, integrations, permissions) | Y | - | AI requirement reads "an engine is on" |
| WB-LAY-10 | `packRows`, `spanOf`, `trailingSpace` (12 column grid, third, half, two thirds, full per breakpoint) | LAY 6.2 | BUILT (`lib/layouts/rows.ts`) | none | - | - | |
| WB-LAY-11 | Draft reducer: add, hide, move, width, option, add number, remove number, move number, `changeCount`, `canAddCard`, identity values | LAY 5, 10 | BUILT (`lib/layouts/draft.ts`) | none | - | - | Spec note: `addCard` does not check the screen; fix in the app |
| WB-LAY-12 | Card registry: card type key to a lazy React component and its options form | LAY 10 | NOT BUILT | none | - | M | Existing panels become cards by being registered |
| WB-LAY-13 | `use-layout`: TanStack read and the three mutations, ETag, built-in fallback | LAY 10 | NOT BUILT | layout routes (CF-29) | M | M | |
| WB-LAY-14 | `LayoutProvider` per screen: effective layout, mode (view or customize), draft, actions | LAY 10 | NOT BUILT | none | - | M | Only place that knows the stored layout and the draft |
| WB-LAY-15 | `LayoutGrid` view mode: cards in order, rows that stay not full, shared row height, skeletons at final heights, lazy mount below the fold | LAY 6.2, 10 | NOT BUILT | none | - | M | |
| WB-LAY-16 | `LayoutGrid` customize mode: drag and drop with a 2 px primary drop line, 50% placeholder, `shadow-drag`, empty row parts as drop targets | LAY 5.2, PVC | NOT BUILT (no `@dnd-kit/core`, `@dnd-kit/sortable`) | none | - | L | Install dnd-kit (installs allowed) |
| WB-LAY-17 | `CardFrame`: frame and header; customize toolbar as a labelled group (handle, Width select, Options, Hide, More) | LAY 5.2, PVC | NOT BUILT | none | - | M | Every control a normal tab stop, 32 px (44 px on touch) |
| WB-LAY-18 | Card Width select offering only the type's widths; hidden in the drawer | LAY 5.2 | NOT BUILT | none | - | S | |
| WB-LAY-19 | Card Options popover (single choice enums; a reusable card cannot take a value another instance uses) | LAY 5.2, 15, PVC `menu-card` | NOT BUILT | none | - | S | Changes show at once |
| WB-LAY-20 | Card Hide with tooltip "Hide card. Add it back from the catalog"; focus to next, previous or Add card | LAY 5.2, 11 | NOT BUILT | none | - | S | |
| WB-LAY-21 | Card More menu: Move earlier, Move later, Move to start, Move to end (WCAG 2.5.7 alternative) | LAY 5.2, PVC | NOT BUILT | none | - | S | Shared Move menu |
| WB-LAY-22 | Keyboard reorder: handle "Reorder {card}" with described instructions, Space pick up, arrows move, Space drop, Escape put back, announcements "position 2 of 8", "already first" | LAY 5.2, 11 | NOT BUILT | none | - | M | One polite live region |
| WB-LAY-23 | Card content `inert` in customize mode; links, row clicks, chart hover and refetching off | LAY 5.1, 11 | NOT BUILT | none | - | S | |
| WB-LAY-24 | "Add card" slot after the last card (free third or half a row); empty page sentence "This page has no cards. Add one from the catalog." | LAY 5.2 | NOT BUILT | none | - | S | |
| WB-LAY-25 | Card catalog dialog 720 px: search, groups SEO, AI, Cross-channel, Activity, schematic per entry, states Add, Added, Add another, Not available with reason, New badge (30 days), "No cards match" | LAY 5.4, PVC `#dlg-catalog` | NOT BUILT | none | - | M | Not listed without permission; adding scrolls to and focuses the card |
| WB-LAY-26 | `NumberStrip` fed from the layout (`MetricStrip` with the layout's numbers, channel divider where SEO and AI meet) | LAY 5.3 | NOT BUILT (`MetricStrip` exists in `components/app/metric`) | none | - | M | 0 to 6 numbers; 0 hides the strip |
| WB-LAY-27 | Numbers in customize mode: handle, Remove, Move menu above each number; not a link while customizing | LAY 5.3 | NOT BUILT | none | - | M | |
| WB-LAY-28 | "Add number" slot and number catalog list grouped SEO and AI, already shown marked; an AI number asks for its engine, never pooled | LAY 5.3, 7.2, PVC | NOT BUILT | none | - | S | Context line cannot be turned off |
| WB-LAY-29 | Customize button (`secondary`, `SlidersHorizontal`, `aria-pressed`) in the header; in More below 1024 px; hidden below 768 px | LAY 5.1, PV:L338 | NOT BUILT | none | - | S | "Customize numbers" on table pages, "Customize cards" in drawers |
| WB-LAY-30 | "Customizing" badge on the title (text, not colour alone) | LAY 5.1, PV:L334 | NOT BUILT | none | - | S | |
| WB-LAY-31 | Layout save bar: "N changes, Applies to your view, in every project", Reset to default, Cancel, Save layout (disabled at 0 changes) | LAY 5.6, PV:L555 | NOT BUILT (`components/ui/save-bar.tsx` exists) | layout routes | M | M | No toast on save |
| WB-LAY-32 | "Your layout differs from the team default" line | LAY 16 point 2, PVC L737 | NOT BUILT | layout routes | M | S | |
| WB-LAY-33 | Save button menu: Save as team default, Remove team default (`layouts:manage` only) with confirm dialogs | LAY 5.6, PVC L1208 to 1241 | NOT BUILT | layout routes, permission `layouts:manage` | M | M | Setting it removes the admin's own personal layout |
| WB-LAY-34 | Discard unsaved changes dialog on any way out (link, Back, Forward, drawer close by button, scrim, Escape); Keep editing leaves the address as it was | LAY 5.1 | NOT BUILT for layouts (the dialog exists for forms) | none | - | M | Router guard needed |
| WB-LAY-35 | Escape leaves customize mode (through the dialog when changed); focus returns to Customize or the drawer More button | LAY 5.1 | NOT BUILT | none | - | S | |
| WB-LAY-36 | Narrow window below 768 px leaves the mode only when nothing is unsaved; open catalog or confirm closes with the mode | LAY 5.1, 5.6 | NOT BUILT | none | - | S | |
| WB-LAY-37 | Placeholder card with the reason in customize mode when the project lacks a requirement; skipped in view mode | LAY 8 | NOT BUILT | capabilities | Y | S | |
| WB-LAY-38 | Per card error boundary with Retry; other cards unaffected | LAY 8 | NOT BUILT | none | - | S | |
| WB-LAY-39 | Layout read failure: built-in default plus banner "Your layout could not be loaded. Showing the default." with Retry; Customize disabled | LAY 8 | NOT BUILT | layout routes | M | S | |
| WB-LAY-40 | Save failure in the save bar "Could not save. Try again."; draft kept | LAY 8 | NOT BUILT | layout routes | M | S | |
| WB-LAY-41 | `412` conflict dialog "This layout was changed somewhere else." with Keep mine and Load the other version | LAY 8, DS25 3.34 | NOT BUILT | layout routes with `If-Match` | M | S | `ConflictDialog` |
| WB-LAY-42 | Drawer cards customize mode (one column, no widths) for `inspector.prompt` and `inspector.topic` | LAY 5.5 | NOT BUILT | none | - | M | Keyword drawer first per LAY 14 |
| WB-LAY-43 | "Customize numbers" for table pages (Topics & Prompts strip, Citations strip) | LAY 4, 5.1 | NOT BUILT | none | - | M | The compact Topics & Prompts header uses inline chips: decide whether its numbers become customizable |
| WB-LAY-44 | Phones show the saved layout full width; editing needs 768 px | LAY 5.7 | NOT BUILT | none | - | S | |
| WB-LAY-45 | Reduced motion: cards jump without animation | LAY 11 | NOT BUILT | none | - | S | |
| WB-LAY-46 | Presets: built-in default and team default are the presets of the spec; several named layouts per page are out of scope (LAY 3) | owner R-07 "presets", LAY 3 | NOT BUILT; DECISION NEEDED if the owner means named presets (for example "Executive", "Analyst") | layout routes would need a name key | N | M | Raise with the owner |
| WB-LAY-47 | Unit, component, e2e (persist across reload and projects, reset, team default by admin, 412, unavailable card, read failure), axe in customize mode, visual regression | LAY 13 | PARTIAL: pure rule tests BUILT (`layouts.test.ts`); the rest NOT BUILT | layout routes | M | M | |
| WB-LAY-48 | Audit entries `layout.default.set` and `layout.default.remove` visible to admins | LAY 9.3 | NOT BUILT (web shows none) | backend audit | N | S | Backend item |

### 2.29 WB-TPE: topic performance by engine (owner R-09)

The owner wants each topic's overall performance per engine (ChatGPT, Gemini, Google AI Mode) as a first class view in three places, with comparison across engines, trend over time, drill-down to the prompts behind each cell, and the competitors winning the topic per engine. The Overview card is CH-04 "Mention rate by topic and engine" (`ai.topic_heatmap`) in `overview-and-charts.md` (its rows W-5); it is not repeated here.

What the code shows today per engine: the Topics tab has per engine Mentioned and Cited count columns (column chooser), an average Mention rate and Citation rate over the engines that show a rate, Top engine in words, and a weekly Trend sparkline averaged over the engines shown; the topic drawer has three averaged rate cards and a By engine section with each engine's Mentioned, Cited and Share of voice in text with k of n (`topic-inspector.tsx`). The data for every gap below is on develop: per engine topic cells in `topics[].engines[]` (BE-SUM), weekly points per engine with `include=series` (BE-SUM-SER), per entity cells per engine with `include=entities` (BE-SUM-ENT).

| ID | Element | Source | Status | Backend | Mock | Size | UI notes |
|---|---|---|---|---|---|---|---|
| WB-TPE-01 | Overview: topic by engine heatmap card (rows topics, columns engines plus avg of 3, hatched insufficient, cell drills to Topics & Prompts with `topic` and `eng`) | R-09, overview-and-charts.md CH-04 | NOT BUILT | BE-SUM topic rows | Y | see that file | Reference only |
| WB-TPE-02 | Topics tab: engine metric switcher like the Prompts tab (Mention, Citation, SOV per engine as columns) | R-09, WB-PRM-08 | NOT BUILT (Topics has fixed Mentioned and Cited counts per engine in the chooser, no percent per engine column) | BE-SUM | Y | S | Reuse `rate-columns.tsx` engine columns; percent beside count, pill under 4 |
| WB-TPE-03 | Topics tab: "By engine" view toggle that shows one column per engine for the chosen metric by default | R-09 | NOT BUILT | BE-SUM | Y | S | Segmented control or the switcher's default on Topics |
| WB-TPE-04 | Topics tab: per engine trend (sparkline per engine cell, or a Trend column per engine) | R-09, W11 | NOT BUILT (one averaged sparkline) | BE-SUM-SER per engine (built) | Y | M | Three sparklines at 96 px are dense: column per engine only from 1440, else in the tooltip |
| WB-TPE-05 | Topics tab: engine spread or gap column (best engine minus worst, in points, no colour unless detectable) | R-09 comparison | NOT BUILT | BE-SUM | Y | S | Label "Engine gap"; insufficient engines excluded and said |
| WB-TPE-06 | Topics tab: sort by any engine's rate | R-09 | PARTIAL: sort by each engine's Mentioned and Cited counts exists; no per engine rate sort | BE-SUM | Y | S | |
| WB-TPE-07 | Topics tab: cell drill-down, clicking an engine cell opens the drawer on that engine's prompts (or Show in Prompts with `eng=` and the topic) | R-09 drill-down | NOT BUILT | none | - | S | `?inspect=topic:<id>&itab=prompts&eng=` |
| WB-TPE-08 | Topics tab: winning competitor per engine (the entity with the highest SOV per engine on the topic) | R-09 competitors | NOT BUILT | BE-SUM-ENT with `filter[term]` per topic, or for all topics once gzip is on | Y | M | Ask entities only with `filter[term]` until gzip (WB-DATA-06); otherwise a column only in the drawer |
| WB-TPE-09 | Topic drawer: per engine performance panel, one row per engine with Mention, Citation, SOV as percent with k of n, bar, change, insufficient pill | R-09, G113 | PARTIAL: text rates and counts per engine (By engine); no bars, no change, no percent bar layout | BE-SUM | Y | S | `BarList` (SC-13); fixed engine order |
| WB-TPE-10 | Topic drawer: per engine trend chart (one line per engine, 8 to 14 weeks, Wilson band per line from 4 answers, hollow points under 4) | R-09 trend, G112 | NOT BUILT | BE-SUM-SER with `filter[term]` | Y | M | `rate-band-chart.ts` reused; table view; engine select or small multiples |
| WB-TPE-11 | Topic drawer: engine comparison sentence or table ("Best on AI Mode, 41%; weakest on Gemini, 29%; difference within normal variation") | R-09 comparison | NOT BUILT | BE-SUM | Y | S | Words only from counts; interim unpaired test labelled |
| WB-TPE-12 | Topic drawer: drill-down from an engine row to the prompts behind it (Prompts tab filtered to that engine and sorted by that engine's rate) | R-09 drill-down | NOT BUILT (Prompts tab lists every prompt, sorted on the first engine) | none | - | S | |
| WB-TPE-13 | Topic drawer: competitors winning the topic per engine (entity by engine table, own first, SOV and mention, the leader per engine marked in weight 500) | R-09 competitors, G116 | NOT BUILT (no Competitors tab) | BE-SUM-ENT `filter[term]` | Y | M | Same as WB-TI-18; one table answers both |
| WB-TPE-14 | Topic drawer: own vs top 3 competitors trend per engine | G112, R-09 | NOT BUILT | entity series per week (CF-06) | N | M | Wait for CF-06; no invented lines |
| WB-TPE-15 | Prompt rows under a topic (Topics tab child rows) show per engine values for the chosen metric | R-09 drill-down | NOT BUILT (child rows show the prompt name) | BE-SUM | Y | S | Same columns as the parent row |
| WB-TPE-16 | Export of the topic by engine table (CSV with per engine rate, count, change) | M-16 | PARTIAL: topic export exists; per engine rate columns not verified in `export-rows.ts` | none | - | S | |
| WB-TPE-17 | Mobile: topic list row shows the best engine and the engine count; the drawer's per engine panel stacks | DS19 6.7 | NOT BUILT | none | - | S (with SC-04) | |
| WB-TPE-18 | Comparison across engines never pooled silently: the average says "avg of N" and names the engines | DS24 9.5, rule | BUILT for the average column; to keep on every new view | none | - | - | |

## 3. Cross-cutting requirements

### 3.1 WB-STATE: empty, loading, error and honesty states (apply on every new surface)

| ID | State | Rule | Status |
|---|---|---|---|
| WB-STATE-01 | No engine on | Reason plus a link to Settings > Engines | BUILT on Topics & Prompts; to repeat on Overview, Citations, Competitors |
| WB-STATE-02 | No prompts | Reason plus Add prompts | BUILT on Topics & Prompts |
| WB-STATE-03 | No answers yet | Says when the first answers come (next schedule) | BUILT on Topics & Prompts |
| WB-STATE-04 | Filtered empty | Reason plus Clear filters | BUILT on Topics & Prompts |
| WB-STATE-05 | Load error with error id, retry | `InlineError`, `ErrorId` | BUILT on Topics & Prompts |
| WB-STATE-06 | Partial list (a page failed) | Says which part failed | BUILT on Topics & Prompts |
| WB-STATE-07 | Insufficient data (under 4 valid answers) | Hatched pill with "N obs", never a bare percent | BUILT (strip, rate columns); to apply on every new rate cell |
| WB-STATE-08 | Not exposed (fan-out on Gemini, AI Mode) | Words, never 0 | NOT BUILT |
| WB-STATE-09 | Waits for a backend item | Empty state that names the effect ("Citations appear here once ...") | PARTIAL (inspector Citations tab is simply absent today) |
| WB-STATE-10 | No access (permission) | No-access state with Back to Overview | BUILT on Topics & Prompts (`noAccessTitle`) |
| WB-STATE-11 | Stale (no valid answer for twice the interval) | Badge with date | NOT BUILT |
| WB-STATE-12 | Truncated list (fan-out bound, 200 answer page, 20 entity cap) | Note in words | PARTIAL (Competitors tab says 200) |
| WB-STATE-13 | Version or model boundary | Chart markLine and table row | NOT BUILT |
| WB-STATE-14 | No flash of empty before data | Skeletons keep labels | BUILT on Topics & Prompts |

### 3.2 WB-KEY: keyboard

| ID | Shortcut | Where | Status |
|---|---|---|---|
| WB-KEY-01 | `/` focuses the table search | Topics, Prompts, every AI table | BUILT (`components/app/data-table/toolbar.tsx`) |
| WB-KEY-02 | `j`, `k` next and previous record in an inspector | prompt inspector | BUILT; topic inspector NOT BUILT (G118); domain, source, candidate inspectors NOT BUILT |
| WB-KEY-03 | Enter opens the focused row | all tables | BUILT (DataTable) |
| WB-KEY-04 | Escape closes the inspector, menu or dialog, focus returns to the row | all | BUILT (shared) |
| WB-KEY-05 | Arrow keys in the treegrid (Right expand, Left collapse or parent) | Topics tab | BUILT (DataTable treegrid) |
| WB-KEY-06 | `[` collapses the sidebar | shell | BUILT (shared, not re-verified) |
| WB-KEY-07 | Cmd or Ctrl Enter submits Add prompts | Add dialog | NOT VERIFIED |
| WB-KEY-08 | `r`, `s`, `a` triage keys | Discover evidence panel | NOT BUILT |
| WB-KEY-09 | Cmd K command palette | shell | NOT BUILT |
| WB-KEY-10 | Single-key shortcuts respect the preference switch | Preferences | BUILT (preference exists; per page wiring not verified) |
| WB-KEY-11 | Shortcuts listed in the Help menu dialog | Help | PARTIAL (dialog exists, AI page list not verified) |

### 3.3 WB-RSP: responsive behaviour per width

| ID | Surface | 390 px | 768 px | 1024 px | 1280 px | Status |
|---|---|---|---|---|---|---|
| WB-RSP-01 | Shell | Drawer navigation, top bar compressed, date and country in the filter sheet | Drawer navigation | Sidebar as overlay rail, breadcrumb becomes project switcher | Sidebar collapsible rail | BUILT (shared shell; AI page not visually checked) |
| WB-RSP-02 | Topics & Prompts header | Two row header, Add prompts icon only (under 640), window "28d" | Country code, not name | Country name from 1024 | "Updated" visible from a 64rem container (about 1280 with sidebar) | BUILT (`94b9f0db`, not seen in a browser per D20 784) |
| WB-RSP-03 | Topics and Prompts tables | Two line list rows (G14) | Table with Topic and Mention rate only | Table, horizontal scroll with pinned identity | Prompts: engines, Mention, Citation, Trend; Topics: Prompts, Citation, Top engine, Trend | PARTIAL: list rows NOT BUILT; 1280 set BUILT |
| WB-RSP-04 | Inspectors (prompt, topic, answer) | Full screen sheet | Overlay | Overlay | Docked when 720 px main remains, else overlay | BUILT (shared) |
| WB-RSP-05 | Strip | Chips wrap | Chips wrap | One row | "SOV" short label under 1280 | BUILT |
| WB-RSP-06 | Bulk bar | Fixed bottom, icon buttons | Inline | Inline | Inline | BUILT through DataTable (not verified at 390) |
| WB-RSP-07 | Citations, Competitors, Overview (new pages) | List rows, strip wraps, two-panel rows stack | Two-panel rows stack | Two-panel rows stack below 1280 | Two panels side by side from 1280 (DS24 9.2) | NOT BUILT |
| WB-RSP-08 | Charts | Chart replaced by summary plus table where DS15 says (matrix scatter under 1024) | Chart full width | Chart full width | Small multiples in auto-fill grid | NOT BUILT for new charts |
| WB-RSP-09 | Dialogs | Full screen sheet | Centered 560 px | Centered | Centered | BUILT (shared `Dialog`) |
| WB-RSP-10 | Browser zoom 200% on 1280 (640 CSS px) gets the mobile layout with a switch to the full table | DS19 line 28 | - | - | - | NOT BUILT (needs the list row switch, SC-04) |

### 3.4 WB-A11Y: accessibility needs

| ID | Need | Status |
|---|---|---|
| WB-A11Y-01 | axe clean at 390, 768, 1024, 1280 in both themes for every AI surface (RM 8 quality bar) | PARTIAL: unit axe in feature tests; e2e axe at four widths not verified for AI |
| WB-A11Y-02 | Rate cells: accessible name with percent, count and state ("Insufficient data, 3 answers") | BUILT for the pill; to keep on every new cell |
| WB-A11Y-03 | Sparkline accessible name lists each week's rate | BUILT (`trend-column.tsx`) |
| WB-A11Y-04 | Charts have a Table view with the same numbers | BUILT on inspector History; required on every new chart |
| WB-A11Y-05 | Colour is never the only carrier: Delta has a sign and words; own brand row has text, not only tint | NOT BUILT for Delta (SC-01) |
| WB-A11Y-06 | Treegrid level, position, set size, expanded state | BUILT |
| WB-A11Y-07 | Inspector is a `complementary` landmark named by the object | BUILT (shared) |
| WB-A11Y-08 | Marks in the answer have accessible names | BUILT |
| WB-A11Y-09 | Announcer for async results (lint, bulk run, archive) instead of live regions in dialogs | BUILT (Add dialog, toasts) |
| WB-A11Y-10 | Focus stays on the toggled row, the switch, the menu trigger after an action | BUILT for Topics and Prompts |
| WB-A11Y-11 | Engine logos have text alternatives (never logo only, PR-54) | NOT BUILT (no logos yet) |
| WB-A11Y-12 | Untrusted text (answers, titles, domains) escaped; links `rel="noopener noreferrer"`, canonical `url` never `raw_url` | BUILT in the answer viewer; required in Citations and Fan-out |
| WB-A11Y-13 | Target sizes 24 px minimum (WCAG 2.2) on list rows and chips | NOT VERIFIED |
| WB-A11Y-14 | Reduced motion respected on chart transitions | NOT VERIFIED |

### 3.5 WB-COPY and WB-DATA rules (every task)

| ID | Rule | Status |
|---|---|---|
| WB-COPY-01 | Every string in `messages/en.json` under the one `prompts` key (or a new top level key per new feature: `citations`, `competitors`, `aiOverview`, `discover`) | BUILT for prompts |
| WB-COPY-02 | No dash as punctuation, no `!`, curly quotes, "cannot" (`i18n/messages.test.ts`) | BUILT (test) |
| WB-COPY-03 | Numbers and dates through `@/lib/format` only | BUILT |
| WB-DATA-01 | Every percent with its count; topic cells read answers from `pooled`; never `countText` for SOV | BUILT |
| WB-DATA-02 | Colour only for a detectable change; interim unpaired test labelled until S3 | NOT BUILT (no deltas yet) |
| WB-DATA-03 | Nothing invented: tabs that wait show an empty state, mock data only in `src/mocks` | BUILT so far |
| WB-DATA-04 | Engines in fixed order, one label per engine | BUILT |
| WB-DATA-05 | Branded excluded unless included (doc 16 rule 4) | BUILT |
| WB-DATA-06 | `include=series` and `include=entities` asked only with `filter[term]` or a small page until API gzip | PARTIAL: the page asks `include=series` on every read (479 KB for 28 days on mocks) |

### 3.6 WB-E2E: end to end coverage (`apps/web/e2e/flows/ai-prompts.spec.ts`)

| ID | Flow | Status |
|---|---|---|
| WB-E2E-01 | Editor turns an engine on, pastes prompts, finds them | BUILT |
| WB-E2E-02 | Viewer reads an answer with marks and sources, sees no forbidden action | BUILT |
| WB-E2E-03 | Analyst runs a prompt now, told when one is pending, finds the raw link | BUILT |
| WB-E2E-04 | Editor archives a prompt and brings it back with Undo | BUILT |
| WB-E2E-05 | Inspector tabs (Stats method note) | BUILT (latest commit `246d3574`) |
| WB-E2E-06 | Topics tree expand, rollup note, Show in Prompts | NOT BUILT |
| WB-E2E-07 | Bulk Run now and bulk Archive with the bulk routes | NOT BUILT |
| WB-E2E-08 | Export CSV downloads a file | NOT BUILT |
| WB-E2E-09 | Compare and deltas | NOT BUILT (feature not built) |
| WB-E2E-10 | Citations page and prompt Citations tab | NOT BUILT |
| WB-E2E-11 | Axe at four widths, both themes, on Topics, Prompts, inspector | NOT VERIFIED |
| WB-E2E-12 | Visual snapshots of AI pages (`e2e/visual/pages.spec.ts`) | NOT VERIFIED |

## 4. Coverage matrices

### 4.1 The 35 frontend-only gap items (gap analysis order 1)

| G | Item | WB id | Status | Task |
|---|---|---|---|---|
| G01 | Header meta from the last run | WB-TPH-02, WB-TPH-03 | BUILT (time), PARTIAL (counts) | W6 |
| G02 | Saved view presets | WB-TPH-04 | NOT BUILT | W5 |
| G03 | More menu Export and Copy link | WB-TPH-07, WB-TPH-08 | PARTIAL | W5 |
| G05 | Compare and deltas | WB-TPF-06, WB-TPS-05, WB-TOP-15, WB-PRM-12, WB-PI-11, WB-TI-09 | NOT BUILT | W3 |
| G06 | Detectable changes only | WB-TPF-07 | NOT BUILT | W3 |
| G08 | Branded three way (Prompts tab part) | WB-TPF-05 | PARTIAL | W5, W6 |
| G12 | Metric strip | WB-TPS-01 to 04 | BUILT | W1 |
| G13 | Insufficient pill | WB-TPS-03, WB-TOP-14 | BUILT | W1, W2 |
| G20 | Topic subtitle | WB-TOP-08 | PARTIAL | W2 |
| G21 | Topic Mention rate | WB-TOP-14 | BUILT (no delta) | W2 |
| G22 | Topic Citation rate | WB-TOP-16 | BUILT | W2 |
| G23 | Topic sorting | WB-TOP-26 | BUILT | W2 |
| G24 | Top engine | WB-TOP-17 | PARTIAL (no logo) | W2 |
| G25 | Expand all | WB-TOP-03 | BUILT | W2 |
| G27 | Topic row menu | WB-MNU-09 to 13 | BUILT | W5 |
| G28 | Show in Prompts | WB-MNU-10 | BUILT | W5 |
| G32 | Nested topics tree | WB-TOP-01 | BUILT | W2 |
| G33 | Footer counts | WB-TOP-30 | BUILT | W2 |
| G40 | Prompt rate columns and default sort | WB-PRM-11 | BUILT | W2 |
| G41 | Metric switcher, SOV, grouped header | WB-PRM-07 to 09 | PARTIAL (no grouped header) | W2 |
| G45 | Topic path badge | WB-PRM-05 | BUILT | W2 |
| G46 | Prompt row menu | WB-MNU-01 to 05 | PARTIAL (no Edit details) | W5 |
| G82 | Add prompts with a topic preselected | WB-MNU-11, WB-ADD-04 | BUILT (topic row); drawer button NOT BUILT | W5 |
| G90 | Inspector tabs | WB-PI-12 | BUILT | W4 |
| G91 | Header badges | WB-PI-05 to 07 | PARTIAL | W4 |
| G92 | Inspector strip | WB-PI-10 | BUILT | W4 |
| G93 | Latest cards | WB-PIL-01 to 06 | BUILT | W4 |
| G94 | History chart with band | WB-PIH-01 | BUILT | W4 |
| G95 | Last 10 answers | WB-PIH-05 | BUILT | W4 |
| G110 | Topic drawer Add prompt | WB-TI-03 | NOT BUILT | W5 |
| G111 | Drawer rate cards with change | WB-TI-08, WB-TI-09 | PARTIAL (no change) | W3 |
| G113 | By engine bars | WB-TI-11 | NOT BUILT | W2 |
| G115 | Top prompts with change | WB-TI-15, WB-TI-16 | PARTIAL | W3 |
| G118 | Topic J and K | WB-TI-05 | NOT BUILT | W5 |
| G124 | Export CSV | WB-BLK-07, WB-TPH-08 | BUILT (bulk), PARTIAL (More menu) | W5 |

Count by the first word of the status cell: BUILT 20, PARTIAL 9, NOT BUILT 6 (G02, G05, G06, G110, G113, G118).

### 4.2 Web plan W1 to W17

| Task | Scope | Status at the tip | Remaining WB ids |
|---|---|---|---|
| W1 | Strip, pill | BUILT | WB-TPS-05 (deltas, W3), WB-TPS-06 visual check |
| W2 | Rate columns, sorting, tree, footer, path | BUILT except logo and grouped header | WB-TOP-08, WB-TOP-17, WB-PRM-09, WB-TI-11 |
| W3 | Compare and deltas | NOT BUILT | WB-TPF-06, WB-TPF-07, WB-TPS-05, WB-TOP-15, WB-PRM-12, WB-PI-11, WB-TI-09, WB-TI-16, SC-01 |
| W4 | Inspector tabs | BUILT except Citations and the G48 tooltips | WB-PI-13, WB-PRM-17, WB-PIH-08, WB-PIS-06 |
| W5 | Menus, bulk, export, views, details | PARTIAL | WB-TPH-04, WB-TPH-08, WB-TPH-10, WB-TPF-05, WB-NAV-06, WB-MNU-05, WB-EDT-01, WB-TI-03, WB-TI-04, WB-TI-05 |
| W6 | Header meta, stale, country, branded only scope | PARTIAL (Updated and country BUILT) | WB-TOP-24, WB-TOP-25, WB-PRM-14, WB-TPF-05 |
| W7 | Citations tab and page | NOT BUILT (backend routes are on develop) | WB-PIC-*, WB-CIT-*, WB-DOM-*, WB-SRC-* |
| W8 | Competitor views | NOT BUILT (backend `include=entities` on develop, mock serves it) | WB-PRM-13, WB-TI-18, WB-PICO-02, WB-PICO-05 |
| W9 | Fan-out | NOT BUILT (backend route on develop) | WB-PIF-* |
| W10 | Bulk run and archive | BUILT | none |
| W11 | Trend sparklines and topic trend | PARTIAL (columns BUILT) | WB-TOP-20, WB-TOP-21, WB-TI-12 |
| W12 | Discover inbox | NOT BUILT (blocked S4) | WB-DSC-* |
| W13 | AI Visibility Overview | NOT BUILT | WB-OV-* |
| W14 | Panels and Versions | NOT BUILT (blocked S4) | WB-PNL-*, WB-VER-*, WB-ADD-14 |
| W15 | AI readiness | NOT BUILT (decision open) | WB-GEO-* |
| W16 | Topic SEO columns, In search, Related, mobile rows | NOT BUILT | WB-TOP-22, WB-TOP-23, WB-TOP-34, WB-PRM-32, WB-TI-13, WB-TI-14, WB-TI-19, WB-TI-20 |
| W17 | Prompt type | NOT BUILT (waits for B16) | WB-TPF-08, WB-PRM-03, WB-ADD-12, WB-EDT-02 |

### 4.3 Items found here that no W task names (proposed new tasks)

| WB id | Item | Proposal |
|---|---|---|
| WB-TPF-10 to 13, WB-PRM-23 | Intent, funnel stage, importance, language filters and columns | One S task, "W18 prompt facets" (API filters exist) |
| WB-PRM-18 | Fan-out per answer column | Fold into W9 |
| WB-TPH-14, WB-TPH-18, WB-PI-20 | Quota meter and manual runs left today | "W19 limits before the click", needs CF-11 |
| WB-PI-21 | Citations banner in the inspector header | Fold into W7 |
| WB-ANS-10 to 12 | Citation markers, entity toggles, formatted view | "W20 evidence viewer completion" |
| WB-NAV-03, WB-OPS-03 to 05 | Collection status and freshness links | "W21 freshness" (M-24) |
| WB-TPH-09, WB-RPT-02 | XLSX export | Fold into W5 after moving the writer to `lib` |
| WB-NAV-12 | Project switch carries the AI query | S, with W5 |
| WB-E2E-06 to 08 | Missing e2e flows | One S task after each feature |

### 4.4 Owner requirements R-01 to R-10 (`docs/ai-visibility/owner-requirements.md`)

| R | Requirement | Covered by | Notes |
|---|---|---|---|
| R-01 | Build the entire feature, web and backend, everything the specs and the Nuwtonic review name | Every section of this file (web side); `backend.md` | Dropped items are kept as DROP rows so nothing is silently lost |
| R-02 | One full plan that fans out across sessions | Section 5 (shared work packages), section 6 (contracts to agree first), sizes and mock column per row | The master plan groups rows into tasks; mock-first rows can start before the backend |
| R-03 | One tracker with every task and its status | The WB ids are stable and carry a status, for the tracker to import | Tracker itself is the lead's |
| R-04 | Built today, efficient and accurate | Mock column ("Y" rows can start now), backend state in section 0.3 (B2, B3, B5, B6, B7, B19 already on develop) | |
| R-05 | Professional and sleek UI at the level of Keywords and Prompts on every page | UI notes column; WB-RSP, WB-A11Y, WB-COPY, WB-DATA rules; SC-01 to SC-24 so new pages reuse the same parts | Every new page should be checked against the Keywords page in a browser before review |
| R-06 | Overview dashboard with all summaries, charts and graphs | WB-OV-01 to 15; card and chart catalog in `overview-and-charts.md` | |
| R-07 | Greater than the preview dashboard, with full customization (customize mode, catalog, move and options, presets, save and discard, per user and shared layouts) | WB-LAY-01 to 48 | Only the pure rules are BUILT; WB-LAY-46 asks what "presets" means |
| R-08 | Better than the Nuwtonic dashboard, all honest charts | `overview-and-charts.md` (CH ids); STU drop list kept as DROP rows (WB-OV-15, WB-GEO-12, WB-PIF-11) | |
| R-09 | Topic performance by engine on the Overview, Topics tab and topic drawer, with comparison, trend, drill-down and competitors per engine | WB-TPE-01 to 18 (plus WB-TI-11, WB-TI-12, WB-TI-18) | Data is on develop; this is web only work except WB-TPE-14 |
| R-10 | Upgrade the Add prompts and Import prompts dialogs (paste, CSV, generate from keywords, suggestions inbox, whole add flow) | WB-ADD-01 to 18, WB-EDT-01 to 08, WB-TPH-10 to 12, WB-DSC-01 to 13; full dialog spec in `docs/ai-visibility/inventory/prompt-dialogs.md` (PD ids) | prompt-dialogs.md is the detailed spec; rows here are the status index |
| Constraint | Twice a week cadence; restore not a change kind; type by server rule plus override; 20 a day cap stays; AI readiness optional late wave; schedules paused, no spend without a yes | WB-TPH-17, WB-SET-03, WB-VER-03, WB-ADD-12, WB-BLK-04, WB-GEO-01 | The 20 a day cap stays: WB-TPH-18 only shows the count, never raises it |

## 5. Shared component work

Each is a work package of its own, built once in `components/app` (or `components/ui`, or `lib`) with tests and an entry on the internal design-system page, before or with the first feature that needs it. Features never import each other.

| ID | Component | Needed by | Exists today | Size | Notes |
|---|---|---|---|---|---|
| SC-01 | `Delta` (points, polarity, `isDetectable`, neutral when not, null renders nothing, tooltip "Within normal variation" and "interim test") | W3, WB-OV, WB-CIT, WB-CMP | NO (`lib/format/delta.ts` `formatMetricDelta` only) | S | DS23 8.4; also `DeltaCell` for tables |
| SC-02 | `EngineLogo` and `EngineBadge` (logo plus name, text alternative, fixed order) | Top engine, strip, Citations engine columns, Overview | NO | S | ADR-DS-020; never logo only |
| SC-03 | `DataTable` extensions: column groups (two row header), a third tree level or lazy child rows, pinned right actions column, server paging with "Select all N matching" | WB-PRM-09, WB-TOP-11, WB-TOP-35, WB-BLK-03, WB-CIT-07 | Partial (tree rows level 1 or 2, left pin only) | M each | Shared with Rankings; regression risk |
| SC-04 | `DataTableList` mobile list rows (two lines, open the inspector) with a switch to the full table | G14 on every AI table, WB-RSP-10 | NO | M | DS19 6.7, DS25 7.10 |
| SC-05 | `RowContextMenu` (right click opens the row menu) | WB-MNU-14 | NO | S | Decide for Rankings too |
| SC-06 | `SavedViewMenu` presets now, persisted later | WB-TPH-04 to 06, Citations, Competitors | NO | S presets, M persisted | DS23 14; BE-VIEWS for persistence |
| SC-07 | `DomainCell`, `DomainChip`, `URLCell` (favicon per the project setting, host visible, escaped title, `displayUrl`, link to domain or source inspector) | WB-PIL-03, WB-PIC, WB-CIT, WB-PIF, WB-SRCS | NO (`lib/favicon.ts`, `lib/domains` exist) | M | DS23 4.4, DS25 8.8, 8.9, 15.27 |
| SC-08 | `DateRangePicker` (custom range with a 92 day cap and reason) | WB-NAV-06 | NO | M | DS25 4.18; the top bar date button |
| SC-09 | Count cell `Popover` listing up to 5 domains with counts | WB-PIC-06, WB-CIT-14, WB-PIF-03, WB-SRCS-04 | Popover primitive exists (`components/ui/popover.tsx`) | S | U-15 |
| SC-10 | `StatisticsPanel` and `MetricInfo` (definition, numerator, denominator, method) and `SampleCount` | WB-PI-22, WB-PIS-04, WB-PD-14, WB-CIT-13 | `ConfidenceIndicator` exists | M | D20 6 |
| SC-11 | `CitationMarker`, `CitationList`, `EntityToggleList`, `AnswerViewMode`, `SafeMarkdown` | WB-ANS-10 to 12 | `evidence-highlight.tsx` exists | M to L | XSS fixture tests required (D20 8.2) |
| SC-12 | Shared `FileDropzone` and CSV parse with preview | WB-TPH-10, WB-ADD-17, WB-GEO-03 | In `features/rankings/import/file-dropzone.tsx` (feature local) | S | Move to `components/app` |
| SC-13 | `BarList`, `OutcomeMixBar`, `StackedBar100` | WB-TI-11, WB-TI-18, WB-OV-07, WB-OV-08, WB-PD-05, WB-SRCS-02 | NO | M | DS15 rule 6 (no donut) |
| SC-14 | Chart markers and `SmallMultiples` (version and model boundaries as markLine, connected crosshair, hollow insufficient points, CI band helper reuse) | WB-PIH-10, WB-PIH-11, WB-PD-06, WB-OV-05, WB-VER-05 | `lib/charts/rate-band-chart.ts`, `ChartFrame`, `EChart` exist | M | |
| SC-15 | `Meter` and `BudgetMeter` | WB-TPH-14, WB-SET-15 | NO | S | DS23 11.2 |
| SC-16 | `ChangeFeed` and feed rows with `CountTabs` | WB-OV-10, alerts | NO | M | DS23 9.2, 9.3 |
| SC-17 | Shared export writer for XLSX and CSV in `lib` (move from `features/rankings/export`) | WB-RPT-01, WB-RPT-02, WB-CIT-16 | CSV writer in `lib/csv/csv-write.ts`; XLSX in rankings | S | |
| SC-18 | Strip and rate models usable by several features (move `rate-model.ts`, `strip-model.ts`, `rate-view.tsx` `InsufficientPill` to `lib` and `components/app/metric`) | WB-OV, WB-CMP, WB-CIT | In `features/prompts` | S | Needed the day a second feature shows AI rates |
| SC-19 | `Banner` variants for inspector headers (cited or not) | WB-PI-21 | `components/app/status/banner.tsx` exists | S | |
| SC-20 | `CommandPalette` | WB-NAV-10 | NO | L | Platform |
| SC-21 | `NotificationBell` and `NotificationCenter` | WB-NAV-09, WB-ALR-04 | NO | M | Platform |
| SC-22 | Inspector stepping for any table (generic J and K with "N of M") | WB-TI-05, domain, source, candidate inspectors | `use-inspector.ts` exists; prompt stepping is feature local | S | |
| SC-23 | `QuoteBox` and `ResponsePreview` as shared parts | WB-PIL-01, WB-XCH-01, WB-SRC-04 | Inside `inspector-latest.tsx` | S | DS23 4.4 |
| SC-24 | `RuleList` and rule builder form from a schema | WB-ALR-01, WB-ALR-02 | NO | L | |
| SC-25 | Layout system React layer: card registry, `use-layout`, `LayoutProvider`, `LayoutGrid` (with `@dnd-kit/core` and `@dnd-kit/sortable`), `CardFrame`, `NumberStrip`, card catalog dialog, options popover, Move menu, layout save bar with the team default menu, conflict and discard dialogs, Customize button | WB-LAY-12 to 45, WB-OV, project Overview | Pure rules in `lib/layouts` only | L (split in four: grid and frame, catalog and numbers, save and team default, drawer cards) | One package for every customizable screen; build before the AI Overview cards are wired |
| SC-26 | Per engine topic panel (rows per engine with bar, percent, k of n, change, pill) and per engine trend chart | WB-TPE-09, WB-TPE-10, WB-OV CH-04 drill targets | Parts exist (`rate-band-chart.ts`, `InsufficientPill`) | M | Shared by the topic drawer, the prompt inspector strip and the Overview |

## 6. Contract-first needs (API shapes the web needs)

To be matched with `backend.md`. "Exists" means the shape is in `apps/web/src/lib/api/schema.ts` at the tip; the web then needs only a mock that follows it (the mocks for B6 and B19 are missing).

| ID | Need | Used by | Contract state | Web action |
|---|---|---|---|---|
| CF-01 | Summary compare: `compare=previous_period` returning `previous: MetricCell` beside each cell (prompt, topic, engine, entity cells), later `is_detectable` and `ci` | W3, all deltas | NOT in schema (B4). Interim: two reads of BE-SUM with equal windows | Build on two reads, swap inside `prompt-queries.ts` |
| CF-02 | Citations aggregates for one prompt: `ai/sources/domains` and `ai/sources/pages` with `filter[prompt_id]`, `limit=5`, `engines`, `previous` | WB-PIC | Exists (`SourceDomainRow`: `registrable_domain`, `domain_role`, `role_entity_id`, `citation_units`, `observations`, `prompts`, `source_share`, `engines`, `first_seen_at`, `last_seen_at`, `previous`) | Write the MSW mock and its test to this shape |
| CF-03 | Citation rows behind a count: `ai/citations` with `filter[registrable_domain]`, `filter[url_id]`, `filter[prompt_id]`, cursor | WB-PIC-06, WB-CIT-14, WB-DOM-08, WB-SRC-02 | Exists (`CitationRow`) | Mock |
| CF-04 | Fan-out queries: `ai/fanout-queries` with `min_support`, `filter[prompt_id]`, `filter[term]`, rows with `query_text`, `normalized_text`, `engine_code`, `observations`, `prompts`, `prompt_ids`, `first_seen_at`, `last_seen_at`, `cited_domains`; meta with the answers denominator and a truncated flag | WB-PIF | Exists (`FanoutQueryRow`, `FanoutMeta`; confirm the truncated flag and denominator are in `FanoutMeta`) | Mock |
| CF-05 | Citations page strip meta: total units, answers, units per role, distinct domains; effective sources (C3) either computed by the web from all rows or returned | WB-CIT-05 | Partly exists (`SourcesMeta`); C3 not returned | Decide web vs backend for C3 |
| CF-06 | Per entity weekly series (own vs top 3 competitors per topic, per engine) | WB-TI-12, WB-CMP-11 | `include=series,entities` exists separately; an entity series per week is not in `HistorySeries` (check) | Confirm with backend; else add `series` inside `EntityCells` |
| CF-07 | Per domain weekly share series (Trend column, domain inspector) | WB-CIT-06, WB-DOM-03 | NOT in schema | New param `include=series` on sources routes |
| CF-08 | Country scope on citations, sources and fan-out routes (`filter[country_iso]`) | WB-NAV-08, WB-CIT-21 | NOT in schema (summary has it) | Ask backend for parity with the summary |
| CF-09 | `min_support` on sources routes, and "lost after 2 windows" | WB-CIT-09, WB-CIT-13, WB-PIC-10 | NOT in sources schema (fan-out has `min_support`); compare gives one previous window only | Ask backend |
| CF-10 | "Cited with" (entity most named in answers citing the domain) and domain category on domain rows | WB-CIT-06, WB-CIT-11 | NOT in schema | Ask backend (cheap join over `ai.entity_mentions`) |
| CF-11 | Limits before the click: manual runs used today and the limit, monthly answers used and cap, active prompts used and cap | WB-TPH-14, WB-TPH-18, WB-PI-20, WB-SET-15 | NOT in schema as a read (errors carry `limit`, `used`) | New `GET {P}/ai/limits` or fields on `GET {P}/engines` |
| CF-12 | Bulk PATCH of prompt metadata (`ids`, `term_ids`, `importance`, `intent`, `prompt_type`) | WB-BLK-11 | NOT in schema | Ask backend, or loop PATCH with a cap |
| CF-13 | Prompt type rule and `filter[prompt_type_in]` | W17 | NOT in schema (B16) | Mock the rule |
| CF-14 | Saved views CRUD (`screen_key`, `query_string`, `columns`, `sort`, shared, default) | SC-06 | NOT in schema (B8) | Presets only until then |
| CF-15 | Tracked keywords per topic: counts and Top 10 via `tracked-keywords` `filter[term]`, `filter[rank_lte]`, `page.total`; visibility via `seo/metrics/breakdown?dimension=term` | WB-TOP-22, WB-TOP-23, WB-TI-13 | Counts exist; breakdown NOT (B9b) | Verify shared vocabulary first |
| CF-16 | Overview aggregates: per engine mention, citation, SOV, own citation share, plus series, in one read (`ai/metrics/overview`) or composed from BE-SUM and BE-SRC-D | WB-OV | Composable today from existing routes; overview route NOT in schema | Compose first; move when the route lands |
| CF-17 | Competitor views: per entity per engine mention and SOV cells per prompt and topic | W8, WB-CMP | Exists (`EntityCells`, `include=entities`, cap 20) | Build now |
| CF-18 | Recommendation, prominence, sentiment cells (`recommended` MetricCell, sentiment four shares) | WB-PRM-10, WB-PD-07 | NOT in schema (B14) | Wait |
| CF-19 | AI Overview engine cell with `source_state` (`no_linked_keyword`, `not_tracked`, `no_surface`, `ok`) and `checks` | WB-PRM-24, WB-TPS-08 | NOT in schema (B13) | Wait |
| CF-20 | Panels, memberships, sizing, promotion candidates; `filter[panel]` on prompts | WB-PNL, WB-TPF-09 | NOT in schema (B10) | Wait for S4 contract |
| CF-21 | Versions per prompt, restore, project feed with author and reason | WB-VER, WB-PIH-09 | NOT in schema (B11, B12) | Wait |
| CF-22 | Prompt candidates (list, triage PATCH bulk, accept, generate preview) | WB-DSC | NOT in schema (B18) | Wait |
| CF-23 | Alert rules, events, digests, notifications | WB-ALR | NOT in schema | Wait |
| CF-24 | Server `ci` on `MetricCell` and paired verdict | WB-PIS-05 | NOT in schema (B15) | Keep the web Wilson interval |
| CF-25 | Answer citation offsets for inline markers (`first_char_offset`, `answer_block_index` on `CitationOut`) | WB-ANS-10 | Check `CitationOut` fields | Confirm |
| CF-26 | Answer and raw SHA-256 on the observation detail | WB-PI-23 | Check `ObservationDetail` fields | Confirm |
| CF-27 | Stale rule input: schedule interval per project for "twice the interval" | WB-TOP-25 | `GET {P}/schedules` exists | Derive in the web |
| CF-28 | Response size: API gzip before `include=series,entities` on full pages | WB-DATA-06 | Ops task (B0) | Restrict `include` until on |
| CF-29 | Layout routes: `GET {W}/layouts/{screen}` (ETag, `ResolvedLayout` with `source`, `team_default_exists`, `updated_by`), `PUT` and `DELETE {W}/me/layouts/{screen}` (`If-Match`, `412`), `PUT` and `DELETE {W}/layouts/{screen}/default` (`layouts:manage`), validation from the generated catalog JSON, table `core.layouts`, audit entries | WB-LAY-13, WB-LAY-31 to 41 | NOT in schema; spec in LAY 9 | Mock to LAY 9.2 first; browser storage only in the preview |
| CF-30 | Project capabilities read for card availability (AI channel on, engines on, integrations connected) | WB-LAY-09, WB-LAY-37 | Derivable from `GET {P}/engines` and integrations routes | Compose in the web |
| CF-31 | Per engine topic trend in one read for the drawer: `include=series` with `filter[term]` returns per engine weeks for the topic row | WB-TPE-10 | Exists (BE-SUM-SER, BE-SUM-S) | Build now |

## 7. Counts

Rows in section 2 (surface tables), by status, counted by script from the status column. DECISION NEEDED and NOT VERIFIED rows are counted as PARTIAL.

| Surface | Rows | BUILT | PARTIAL | NOT BUILT | DROP |
|---|---|---|---|---|---|
| WB-NAV | 12 | 3 | 3 | 6 | 0 |
| WB-TPH | 18 | 5 | 2 | 11 | 0 |
| WB-TPF | 18 | 6 | 2 | 9 | 1 |
| WB-TPS | 10 | 6 | 1 | 3 | 0 |
| WB-TOP | 40 | 25 | 3 | 11 | 1 |
| WB-PRM | 34 | 14 | 2 | 18 | 0 |
| WB-BLK | 13 | 8 | 0 | 4 | 1 |
| WB-MNU | 15 | 9 | 2 | 4 | 0 |
| WB-ADD | 18 | 10 | 2 | 6 | 0 |
| WB-EDT | 8 | 2 | 0 | 6 | 0 |
| WB-PI | 23 | 12 | 2 | 9 | 0 |
| WB-PIL | 8 | 5 | 1 | 2 | 0 |
| WB-PIH | 13 | 6 | 0 | 6 | 1 |
| WB-PIC | 10 | 0 | 0 | 10 | 0 |
| WB-PICO | 6 | 2 | 0 | 4 | 0 |
| WB-PIS | 6 | 3 | 1 | 2 | 0 |
| WB-PIF | 11 | 0 | 0 | 10 | 1 |
| WB-ANS | 16 | 9 | 2 | 5 | 0 |
| WB-TI | 23 | 8 | 3 | 12 | 0 |
| WB-PNL | 11 | 0 | 0 | 11 | 0 |
| WB-VER | 8 | 0 | 0 | 8 | 0 |
| WB-PD | 15 | 0 | 0 | 15 | 0 |
| WB-OV | 15 | 0 | 0 | 14 | 1 |
| WB-CIT | 21 | 0 | 0 | 21 | 0 |
| WB-DOM | 8 | 0 | 0 | 8 | 0 |
| WB-SRC | 4 | 0 | 0 | 4 | 0 |
| WB-SRCS | 6 | 0 | 0 | 5 | 1 |
| WB-CMP | 12 | 0 | 0 | 12 | 0 |
| WB-DSC | 13 | 0 | 0 | 13 | 0 |
| WB-ALR | 7 | 0 | 0 | 7 | 0 |
| WB-RPT | 7 | 0 | 1 | 6 | 0 |
| WB-GEO | 12 | 0 | 0 | 11 | 1 |
| WB-SET | 17 | 6 | 2 | 9 | 0 |
| WB-OPS | 7 | 2 | 1 | 4 | 0 |
| WB-XCH | 6 | 0 | 0 | 6 | 0 |
| WB-LAY | 48 | 7 | 3 | 38 | 0 |
| WB-TPE | 18 | 1 | 3 | 14 | 0 |
| Total | 537 | 149 | 36 | 344 | 8 |

Plus 13 navigation entries (2 BUILT), the cross-cutting rows of section 3, 26 shared components (SC-01 to SC-26) and 31 contract needs (CF-01 to CF-31). A row that mixes statuses is counted by the first word of its status cell.

## 8. Not verified in this pass

- Nothing was seen in a browser: every responsive, visual and axe statement about the built page rests on code and the "As built" notes (D20 784 says the compact header was not seen in a browser either).
- Whether the prompts page registers its shortcuts in the Help dialog; Cmd Enter in the Add dialog; the class column and cost summary on the Engines screen; the entities "added on" date.
- Whether `FanoutMeta` carries a truncated flag and the answers denominator, whether `CitationOut` carries character offsets, whether `ObservationDetail` carries the hashes (CF-04, CF-25, CF-26).
- That tracked-keyword topics and prompt topics share one vocabulary (RM risk; blocks WB-TOP-22, WB-TOP-23, WB-TI-13).
- The Nuwtonic page inventories were read through the competitor study and the synthesis, which quote them; the raw inventories were not re-read item by item.
