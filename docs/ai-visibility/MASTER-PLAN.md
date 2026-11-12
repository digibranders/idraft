# AI visibility: master implementation plan

Status: written 2026-11-12 at 23:30 (Mac local time) by the Opus chief planner, on branch `ai/prompts-slice1` at develop `246d3574`. Read only: no code changed. Companion files: [README](README.md) (index), [TRACKER.md](TRACKER.md) and [tracker.json](tracker.json) (progress), [work-packages/](work-packages/) (one brief per package).

## 1. Executive summary for the owner

**What exists.** Slice 1 of AI prompt tracking is built and on develop: prompts, engines (ChatGPT, Gemini, Google AI Mode), collection on the standard queue, light extraction, the summary route with `include=series` and `include=entities`, country, topic and Branded Only scopes (B1, B2, B3, B5), the citations, sources and fan-out reads with `compare=previous_period` on sources (B6, B19), bulk run and bulk archive (B7), the Eventus dev seed (D3), the Topics & Prompts page with the tree, rate columns, trend sparklines, bulk bar, row menus and the prompt inspector tabs Latest, History, Competitors and Stats. API compression (gzip) is also on develop (`de54a88d`), although the inventories still call it an ops item. Production serves release `a96ef0c9`; develop is ahead.

**What is left.** The four inventories hold 1312 rows. 16 are out of scope on purpose (8 DROP, 8 deferred or owned by the ops session). The other 1296 are assigned to exactly one of 74 work packages; 279 of them are built already and 1017 are still to do: 225 backend capabilities, 418 web elements, 46 charts, 26 shared component packages, 31 contract needs, 238 dialog rows and 33 API needs. The work packages add up to about 556 Sonnet-agent tasks (460 in the core waves 0 to 5).

**The honest schedule.** It is 23:30 on 2026-11-12. Nothing more can be built, reviewed and merged safely today: the release checks flake when the Mac is loaded, every task needs a review, and the first hours of any fan-out go to scaffolding that stops the sessions from colliding. Finishing the whole feature today is not possible. At the safe pace of this machine (5 working sessions, about 65 reviewed tasks a working day) the plan is:

| Working day | Waves | What becomes true | Ship candidate (only on your "ship it") |
|---|---|---|---|
| Tonight | none | You answer the decisions of section 2 (defaults are safe; only the gating ones stop work) | none |
| Day 1 (2026-11-13) | W0, start of W1 | Lock and scaffolding merged; contracts in the generated client; shared chart and component packages and the four backend lanes under way | none |
| Day 2 | W1 done, W2 starts | Layouts API, summary compare, prompt lint and filters, sources additions on develop; Citations, fan-out, compare, Topics & Prompts polish in progress | none |
| Day 3 | W2 | Topics & Prompts at full parity, Citations page and tab, fan-out tab, topic drawer by engine, the new Add, Import and Edit dialogs | Ship 1 at the end of day 3 |
| Day 4 to 5 | W3 | The AI Visibility Overview with full customization and five presets, the Competitors page, chart notes | Ship 2 at the end of day 5 |
| Day 6 to 7 | W4 | Versions, panels, keyword links and Generate, the Discover inbox, alerts, saved views, exports, Prompt Detail, command palette | Ship 3 at the end of day 7 |
| Day 8 to 9 | W5 | Recommendation and sentiment, competitor discovery, retrieved but not cited, server intervals and verdicts, the Sources page, webhooks | Ship 4 at the end of day 9 |
| After your decisions | W6, W7 | AI Overview engine and cross-channel (needs rank data back), discovery sources, more engines, LLM features, first-party signals; GEO only if you open it | per package |

Days are working days of 10 hours with 5 sessions; dependency waits are included as overlap between waves. Pages work on mocks and on the Eventus seed without answers; seeing them on real answers needs your yes and a budget (D-26), because the schedules are paused.

**What blocks on you.** Most decisions have a default that lets work continue. These gate work until answered: D-26 real provider spend and a budget (for the acceptance run and real answers), D-27 any LLM use, D-25 replicates, D-50 rank data reliability (AI Overview, matrix, SEO per topic), D-08 page-level AI readiness, D-29 shareable reports and scheduled report emails, D-24 personas, D-30 opportunity task status, D-51 first-party signals. The layouts contract also needs D-01, D-09 and D-10 before day 1 midday (defaults recommended).

**Concurrency.** At most 5 working sessions plus the coordinator, at most 2 subagents per session, at most 2 web dev servers at once, and every full test suite, build, e2e run and release through one lock (section 4).

## 2. Owner decisions

Answer in one go by ID ("D-01 yes, D-26 USD 10 ..."). "Gates work: yes" means the package or the named part waits for the answer; "no" means the default is used until you say otherwise.

| ID | Decision | Recommended default | Gates work | Packages that use it |
|---|---|---|---|---|
| D-01 | Overview presets: code (built-in documents behind a Start from menu) or stored named layouts | Code. No table change; the person saves the result as their layout or the team default | no (default lets work go on) | WP-03, WP-11, WP-16, WP-33 |
| D-02 | Prompt inspector tabs: 5 or 6 (and where Versions and Runs go) | 6 tabs: Latest, History, Citations, Competitors, Fan-out (only when an enabled engine exposes it), Stats. Versions and runs are sections of History; the full timeline is on Prompt Detail. DS 23 4.1 amended to allow 6 | no (default lets work go on) | WP-21, WP-24, WP-25 |
| D-03 | Compare on by default (Overview and Topics & Prompts) | On: vs previous period by default on both, `cmp=off` in the URL turns it off | no (default lets work go on) | WP-17, WP-19, WP-33 |
| D-04 | Pooling threshold POOL_BELOW_PROMPTS for topic and project weekly points | 10 prompts | no (default lets work go on) | WP-06, WP-12, WP-20, WP-34, WP-36 |
| D-05 | Heat-map bins shared by every rate heat-map | The 7 fixed bins of CH-04, mirrored in dark | no (default lets work go on) | WP-04, WP-06, WP-36 |
| D-06 | Undo and redo in customize mode | Yes: 50 drafts of history, ends with the mode, Hide raises a toast with Undo | no (default lets work go on) | WP-16 |
| D-07 | Undo of an add | Undo archives the created prompts (no hard delete); the toast says so | no (default lets work go on) | WP-27 |
| D-08 | Page-level AI readiness (GEO) in scope | Stays closed; optional wave 7 only on the owner's word | yes | WP-70 |
| D-09 | How personal layouts stay private inside a workspace (review log F10) | Row-level security policy on the current user id plus the application check, both tested | no (default lets work go on) | WP-03, WP-11 |
| D-10 | How the backend gets the layout catalog keys (packages/contracts does not exist) | A checked-in JSON generated by the web (`pnpm gen:layout-catalog`), freshness test on both sides, like gen:api | no (default lets work go on) | WP-03, WP-11 |
| D-11 | Who holds layouts:manage | Owner and admin | no (default lets work go on) | WP-01, WP-11 |
| D-12 | What shared layouts means | The team default only; no sharing with one person | no (default lets work go on) | WP-11, WP-16 |
| D-13 | Per-card Window option (weakens one denominator per page) | No in the first release | no (default lets work go on) | WP-33 |
| D-14 | Snapping resize grip as a pointer alternative to the Width select | Yes, snaps to allowed widths only | no (default lets work go on) | WP-15 |
| D-15 | Duplicate in the card More menu | Yes, with the next free identity value | no (default lets work go on) | WP-16 |
| D-16 | New screen key inspector.topic (customizable topic drawer) | Yes; the prompt inspector later | no (default lets work go on) | WP-02, WP-20 |
| D-17 | New metric registry keys ai.prompts_in_scope and ai.valid_answers | Yes, added to doc 16 2.1 first | no (default lets work go on) | WP-32 |
| D-18 | notes:write permission | Editor and above | no (default lets work go on) | WP-01, WP-38 |
| D-19 | AI Overview as a strip item and engine once slice 2 lands | Yes, labelled "AI Overviews", counted not asked | no (default lets work go on) | WP-33, WP-55, WP-65 |
| D-20 | Copy the Overview wireframe into DS 24 as 9.2a | Yes | no (default lets work go on) | WP-33, WP-72 |
| D-21 | Branded definition for lint | Own aliases only (as built); competitor aliases get their own warning rule | no (default lets work go on) | WP-13, WP-27 |
| D-22 | Who sets the funnel stage | The person, default unknown; no LLM | no (default lets work go on) | WP-13 |
| D-23 | Bulk archive by filter form | Yes (small) | no (default lets work go on) | WP-13 |
| D-24 | Personas (context_preamble) before panels | No; later, with a migration, when the owner asks | yes | WP-41 |
| D-25 | Replicates and spike S-05 (provider spend) | No until a budget is set | yes | WP-58 |
| D-26 | Real provider spend: resume Eventus schedules and run the acceptance | A monthly AI budget of USD 10 for Eventus: its 72 prompts on 3 engines cost about USD 2.25 a month on the schedule (USD 4.70 at the 150 prompt base plan) and about USD 0.26 per full Run now, so USD 10 covers the schedule, the two acceptance runs and Run now headroom | yes | WP-30, WP-67, WP-73 |
| D-27 | LLM use (adjudication, category classification, candidate variants, onboarding suggestions) | No until a provider and a budget are chosen; rules and templates first | yes | WP-45, WP-60, WP-66, WP-67, WP-68 |
| D-28 | Topic routes of doc 20 5.11 (Topic Explorer) | Drop; superseded by the Topics tab (ADR-DS-022) | no (default lets work go on) | WP-72 |
| D-29 | Reports: shareable link and PDF (M-12), scheduled reports (M-13) | Later: build the Reports page with Exports and Saved views first; annotations (M-14) yes now | yes | WP-38, WP-51 |
| D-30 | Opportunity task status (OP-12, a new table) | No for now | yes | WP-60 |
| D-31 | Domain category seed list source | Rules plus a small curated seed in the repository, no LLM | no (default lets work go on) | WP-60 |
| D-32 | Who maintains the publisher list | Deferred with source intelligence; start with a curated seed | no (default lets work go on) | WP-60 |
| D-33 | When to add the rollup table | When the summary p95 exceeds 800 ms at 150 prompts x 3 engines x 92 days, or before the first full-capacity month | no (default lets work go on) | WP-62 |
| D-34 | Hard delete of prompts added by mistake | No; archive only | no (default lets work go on) | plan-wide |
| D-35 | "Run now" or "Ask now" | Keep "Run now" on buttons | no (default lets work go on) | WP-17, WP-27 |
| D-36 | Prompt type facet and badge before panels | Yes, as soon as the prompts lane lands B16 | no (default lets work go on) | WP-18 |
| D-37 | Topic subtitle: one line or a category line | Keep the one-line form | no (default lets work go on) | WP-18 |
| D-38 | Trend: an 8 week line beside a 28 day table (second read) | Yes, now that gzip is on develop | no (default lets work go on) | WP-18 |
| D-39 | Expanded topic set in the URL | Already dropped by the owner; keep in memory | no (default lets work go on) | plan-wide |
| D-40 | Right-click row menu on every DataTable, Rankings included | Yes | no (default lets work go on) | WP-09 |
| D-41 | Effective sources (C3): web or backend | Backend (diversity read); the web may compute it in the interim | no (default lets work go on) | WP-14 |
| D-42 | Customize on phones | Display only below 768 px | no (default lets work go on) | WP-16 |
| D-43 | Archived view with Status All | Yes | no (default lets work go on) | WP-29 |
| D-44 | Competitor sentiment | Off (cost) | no (default lets work go on) | WP-54 |
| D-45 | Who labels the AI gold set | An Opus pass drafts labels for 200 answers; the owner's team reviews them | no (default lets work go on) | WP-54 |
| D-46 | Optimistic concurrency on prompt PATCH | Yes (ETag and If-Match) | no (default lets work go on) | WP-13, WP-29 |
| D-47 | Prompt Detail page in this programme | Yes, wave 4 | no (default lets work go on) | WP-52 |
| D-48 | Command palette in this programme | Yes, wave 4 | no (default lets work go on) | WP-53 |
| D-49 | Discovery panel engines | ChatGPT and AI Mode only | no (default lets work go on) | WP-42 |
| D-50 | When rank data is reliable again (AI Overview, matrix, SEO per topic) | Owner and the rank session decide; wave 6 waits | yes | WP-64, WP-66 |
| D-51 | First-party signals (Phase 12) in this programme | Yes after the core waves, when a GA4 or Cloudflare connection exists for a test project | yes | WP-69 |

D-52 (process, not a product choice): this plan follows today's instruction that Sonnet reviews every task. A memory note from earlier sessions asked for an Opus review after each task. Recommended: Sonnet per task, plus one Opus review at the end of each package marked risky (money, tenants, locks, cursors, statistics), which is 32 of the packages. Say "D-52 no" to drop the Opus end review.

## 3. Architecture of the fan-out

### 3.1 Sessions, lanes and dispatch

One coordinator session (Opus) and at most five working sessions. Each working session takes one work package at a time, in its own worktree, and runs it to merged. A lane is the suggested order of packages for a session that keeps the files it already knows; the coordinator may move a ready package to any free session. Rule: when a session finishes, the coordinator gives it the first ready package (all `dependsOn` merged, no open gating decision) in this priority: the critical path (layouts, summary lane, Overview), then the package with the most dependents, then wave order.

| Session | Lane (suggested order) |
|---|---|
| S0 coordinator (Opus) | [WP-00](work-packages/WP-00-coordination-kit.md) first (the lock), then the tracker, dispatch, merges watch, [WP-71](work-packages/WP-71-quality-sweeps.md) at each wave end, [WP-72](work-packages/WP-72-docs.md) (Haiku), [WP-73](work-packages/WP-73-release-acceptance.md) on your word |
| S1 backend platform | [WP-01](work-packages/WP-01-backend-scaffold.md), [WP-03](work-packages/WP-03-contract-pack.md), [WP-11](work-packages/WP-11-layouts-api.md), [WP-38](work-packages/WP-38-notes-annotations.md), [WP-49](work-packages/WP-49-saved-views.md), [WP-50](work-packages/WP-50-exports.md), [WP-47](work-packages/WP-47-alerts-api.md), [WP-63](work-packages/WP-63-ssrf-webhooks.md) |
| S2 backend data | [WP-12](work-packages/WP-12-summary-lane.md), [WP-14](work-packages/WP-14-sources-lane.md), [WP-32](work-packages/WP-32-overview-aggregates.md), [WP-54](work-packages/WP-54-extract-recommend.md), [WP-56](work-packages/WP-56-rederive-candidates.md), [WP-57](work-packages/WP-57-retrieval-fanout.md), [WP-58](work-packages/WP-58-stats-api.md), [WP-60](work-packages/WP-60-source-intel-api.md), [WP-62](work-packages/WP-62-performance.md) |
| S3 prompts end to end | [WP-13](work-packages/WP-13-prompts-lane.md), [WP-27](work-packages/WP-27-add-dialog.md), [WP-28](work-packages/WP-28-import-csv.md), [WP-29](work-packages/WP-29-edit-archive.md), [WP-41](work-packages/WP-41-versions.md), [WP-42](work-packages/WP-42-panels-api.md), [WP-43](work-packages/WP-43-panels-web.md), [WP-44](work-packages/WP-44-links-generate.md), [WP-45](work-packages/WP-45-candidates-api.md), [WP-46](work-packages/WP-46-discover-web.md) |
| S4 web platform and Overview | [WP-02](work-packages/WP-02-web-scaffold.md), [WP-04](work-packages/WP-04-chart-frame.md), [WP-05](work-packages/WP-05-chart-bars.md), [WP-06](work-packages/WP-06-chart-grids.md), [WP-15](work-packages/WP-15-layouts-react-core.md), [WP-16](work-packages/WP-16-layouts-react-customize.md), [WP-33](work-packages/WP-33-overview-shell.md), [WP-34](work-packages/WP-34-overview-cards-engines.md), [WP-35](work-packages/WP-35-overview-cards-competitors.md), [WP-36](work-packages/WP-36-overview-cards-topics.md), [WP-37](work-packages/WP-37-overview-cards-sources.md), [WP-40](work-packages/WP-40-project-overview-ai.md) |
| S5 web pages | [WP-07](work-packages/WP-07-app-parts-a.md), [WP-08](work-packages/WP-08-app-parts-b.md), [WP-09](work-packages/WP-09-table-extensions.md), [WP-10](work-packages/WP-10-controls.md), [WP-17](work-packages/WP-17-tp-header-filters.md), [WP-18](work-packages/WP-18-tp-tables.md), [WP-19](work-packages/WP-19-compare-deltas.md), [WP-20](work-packages/WP-20-topics-by-engine.md), [WP-21](work-packages/WP-21-citations-core.md), [WP-22](work-packages/WP-22-citations-inspectors.md), [WP-23](work-packages/WP-23-competitor-views.md), [WP-24](work-packages/WP-24-fanout-views.md), [WP-25](work-packages/WP-25-inspector-completion.md), [WP-26](work-packages/WP-26-evidence-viewer.md), [WP-30](work-packages/WP-30-runs-costs-health.md), [WP-31](work-packages/WP-31-settings-engines.md), [WP-39](work-packages/WP-39-competitors-page.md), [WP-48](work-packages/WP-48-alerts-web.md), [WP-51](work-packages/WP-51-reports.md), [WP-52](work-packages/WP-52-prompt-detail.md), [WP-53](work-packages/WP-53-command-palette.md), [WP-55](work-packages/WP-55-recommend-web.md), [WP-59](work-packages/WP-59-stats-web.md), [WP-61](work-packages/WP-61-sources-page.md) |
| Later (any free session) | [WP-64](work-packages/WP-64-aio-xch-api.md), [WP-65](work-packages/WP-65-aio-xch-web.md), [WP-66](work-packages/WP-66-discovery-sources.md), [WP-67](work-packages/WP-67-engine-expansion.md), [WP-68](work-packages/WP-68-llm-advanced.md), [WP-69](work-packages/WP-69-first-party-signals.md), [WP-70](work-packages/WP-70-geo-readiness.md) |

S5 holds the most packages because they are small web packages; the coordinator moves them to S4 or S1 whenever those lanes wait on a dependency.

### 3.2 Names

- Worktree `.claude/worktrees/wp-NN`, branch `ai/wp-NN-<slug>` from `origin/develop`, both created by `infra/dev/wp-start WP-NN <slug>`.
- Session title `WP-NN <slug>`; the coordinator session is `AI coordinator`.
- Detailed task plan `docs/superpowers/plans/<date>-ai-wp-NN-<slug>.md`, written by Opus at the start of the package and committed on its branch.
- Commits `WP-NN: <task title>`; no attribution lines, no dashes.
- Contract notes `docs/ai-visibility/contracts/<group>.md`.

### 3.3 Backend modules registered once in wave 0

[WP-01](work-packages/WP-01-backend-scaffold.md) creates each module below with an empty `APIRouter`, registers it in `api/main.py` and adds an anchor block per package in `EXPECTED` of `backend/tests/api/test_route_access.py` and in `backend/tests/security/test_cross_tenant.py` (`_TENANT_ROWS`, the special-case sets). Empty routers do not change `openapi/v1.json`. Packages of waves 6 and 7 register their own routers (few sessions run then; they take a lease on `main.py`).

| Module | Package |
|---|---|
| `api/layouts/routes.py` | [WP-11](work-packages/WP-11-layouts-api.md) |
| `api/ai/limits_routes.py` | [WP-13](work-packages/WP-13-prompts-lane.md) |
| `api/operations/collection_routes.py` | [WP-30](work-packages/WP-30-runs-costs-health.md) |
| `api/ai/metrics_routes.py, api/ai/competitor_routes.py` | [WP-32](work-packages/WP-32-overview-aggregates.md) |
| `api/ai/annotation_routes.py, api/notes/routes.py` | [WP-38](work-packages/WP-38-notes-annotations.md) |
| `api/ai/version_routes.py` | [WP-41](work-packages/WP-41-versions.md) |
| `api/ai/panel_routes.py` | [WP-42](work-packages/WP-42-panels-api.md) |
| `api/ai/link_routes.py` | [WP-44](work-packages/WP-44-links-generate.md) |
| `api/ai/candidate_routes.py, api/uploads/routes.py` | [WP-45](work-packages/WP-45-candidates-api.md) |
| `api/alerts/routes.py` | [WP-47](work-packages/WP-47-alerts-api.md) |
| `api/views/routes.py` | [WP-49](work-packages/WP-49-saved-views.md) |
| `api/exports/routes.py` | [WP-50](work-packages/WP-50-exports.md) |
| `api/reports/routes.py` | [WP-51](work-packages/WP-51-reports.md) |
| `api/ai/derivation_routes.py, api/entities/candidate_routes.py` | [WP-56](work-packages/WP-56-rederive-candidates.md) |
| `api/ai/retrieval_routes.py` | [WP-57](work-packages/WP-57-retrieval-fanout.md) |
| `api/ai/stats_routes.py` | [WP-58](work-packages/WP-58-stats-api.md) |
| `api/ai/source_intel_routes.py` | [WP-60](work-packages/WP-60-source-intel-api.md) |
| `api/webhooks/routes.py` | [WP-63](work-packages/WP-63-ssrf-webhooks.md) |

New schema modules: `api/schemas/ai_layouts.py`, `ai_limits.py`, `ai_metrics.py`, `ai_versions.py`, `ai_panels.py`, `ai_links.py`, `ai_candidates.py`, `ai_alerts.py`, `ai_views.py`, `ai_exports.py`, `ai_notes.py`, `ai_stats.py`, `ai_collection.py`. Permission keys added once: `layouts:manage` (owner, admin) and `notes:write` (owner, admin, editor); the others the specs name already exist (`panels:core:modify`, `views:write`, `alerts:write`, `exports:create`).

### 3.4 Web routes, seams and registrations created once in wave 0

[WP-02](work-packages/WP-02-web-scaffold.md) creates:

- Route files that render `notFound()` until their package flips the navigation entry to `live`: `/ai` ([WP-33](work-packages/WP-33-overview-shell.md)), `/ai/citations` ([WP-21](work-packages/WP-21-citations-core.md)), `/ai/sources` ([WP-61](work-packages/WP-61-sources-page.md)), `/ai/prompts/[promptId]` ([WP-52](work-packages/WP-52-prompt-detail.md)), `/competitors` ([WP-39](work-packages/WP-39-competitors-page.md)), `/discover/[tab]` ([WP-46](work-packages/WP-46-discover-web.md)), `/reports` ([WP-51](work-packages/WP-51-reports.md)), `/settings/alert-rules` ([WP-48](work-packages/WP-48-alerts-web.md)), `/settings/retention` ([WP-31](work-packages/WP-31-settings-engines.md)), `/matrix` ([WP-65](work-packages/WP-65-aio-xch-web.md)).
- Seams in `features/prompts/seams/`: `inspector-tabs.ts` (Latest, History, Citations, Competitors, Fan-out, Stats), `topic-tabs.ts` (Overview, Prompts, Competitors, Related), `actions.ts` (row menu, bulk bar, inspector More, each item an entry with its permission and availability), `columns.ts` (chooser columns), `toolbar.ts` (header and toolbar slots). Each later package adds its entry by exporting it from its own file and filling the pre-created import line, so `prompts-screen.tsx`, `prompt-inspector.tsx` and `topic-inspector.tsx` change only under a lease.
- One message namespace per package in `apps/web/messages/en.json` (top level for new pages: `aiOverview`, `citations`, `competitors`, `discover`, `layouts`, `alerts`, `reports`, `promptDetail`, `sources`, `notes`, `exports`, `savedViews`, `commandPalette`, `matrix`; under `prompts` for the page's packages: `add`, `import`, `edit`, `archive`, `generate`, `versions`, `panels`, `compare`, `citationsTab`, `fanout`, `topicDrawer`, `facets`, `limits`, `evidence`).
- One empty handler module per package in `apps/web/src/mocks/handlers/`, registered in `index.ts`.
- The moves out of `features/prompts` that several packages need (rate and strip models, `InsufficientPill`, the CSV and XLSX writers, the file dropzone) and the dnd-kit dependencies, so `pnpm-lock.yaml` changes once.

### 3.5 One session end to end, or two coordinated sessions

Rule: one session owns backend and web of a feature when the backend part is small or used by that feature only (kind `both`, or the prompts lane S3 which runs its backend package and then its web packages in sequence). Backend and web are split into two packages when the backend is large or serves several web packages, so the web can start against the contract and mocks at once.

| Shape | Packages | Why |
|---|---|---|
| End to end in one session | [WP-26](work-packages/WP-26-evidence-viewer.md), [WP-30](work-packages/WP-30-runs-costs-health.md), [WP-31](work-packages/WP-31-settings-engines.md), [WP-38](work-packages/WP-38-notes-annotations.md), [WP-41](work-packages/WP-41-versions.md), [WP-44](work-packages/WP-44-links-generate.md), [WP-49](work-packages/WP-49-saved-views.md), [WP-50](work-packages/WP-50-exports.md), [WP-51](work-packages/WP-51-reports.md), [WP-56](work-packages/WP-56-rederive-candidates.md), [WP-57](work-packages/WP-57-retrieval-fanout.md), [WP-68](work-packages/WP-68-llm-advanced.md), [WP-69](work-packages/WP-69-first-party-signals.md), [WP-70](work-packages/WP-70-geo-readiness.md) | Small backend, one consumer; one owner avoids a contract handover |
| Same session in sequence (lane S3) | [WP-13](work-packages/WP-13-prompts-lane.md), [WP-27](work-packages/WP-27-add-dialog.md), [WP-28](work-packages/WP-28-import-csv.md), [WP-29](work-packages/WP-29-edit-archive.md), [WP-42](work-packages/WP-42-panels-api.md), [WP-43](work-packages/WP-43-panels-web.md), [WP-45](work-packages/WP-45-candidates-api.md), [WP-46](work-packages/WP-46-discover-web.md) | Prompt management is one feature; the session that wrote lint and bulk update builds the dialogs that use them |
| Split, coordinated | [WP-11](work-packages/WP-11-layouts-api.md) with [WP-15](work-packages/WP-15-layouts-react-core.md), [WP-16](work-packages/WP-16-layouts-react-customize.md); [WP-12](work-packages/WP-12-summary-lane.md) with [WP-19](work-packages/WP-19-compare-deltas.md), [WP-20](work-packages/WP-20-topics-by-engine.md) and the Overview cards; [WP-32](work-packages/WP-32-overview-aggregates.md) with [WP-33](work-packages/WP-33-overview-shell.md), [WP-39](work-packages/WP-39-competitors-page.md); [WP-47](work-packages/WP-47-alerts-api.md) with [WP-48](work-packages/WP-48-alerts-web.md); [WP-54](work-packages/WP-54-extract-recommend.md) with [WP-55](work-packages/WP-55-recommend-web.md); [WP-58](work-packages/WP-58-stats-api.md) with [WP-59](work-packages/WP-59-stats-web.md); [WP-60](work-packages/WP-60-source-intel-api.md) with [WP-61](work-packages/WP-61-sources-page.md); [WP-64](work-packages/WP-64-aio-xch-api.md) with [WP-65](work-packages/WP-65-aio-xch-web.md) | Large backend or several consumers; the web builds on the contract pack and mocks in parallel |

### 3.6 File ownership and conflict hot spots

Every work package file lists the files it owns. Nobody edits a file another package owns. A shared file that a later package must change is taken by a lease: the session asks the coordinator, the coordinator records `{path, wp, since}` under `leases` in `tracker.json`, and releases it at the package's push.

| Hot spot | Protocol |
|---|---|
| `backend/src/idraft/api/main.py` | Registered once by [WP-01](work-packages/WP-01-backend-scaffold.md); waves 6 and 7 take a lease |
| `backend/src/idraft/api/resources.py`, `permissions.py` | Once by [WP-01](work-packages/WP-01-backend-scaffold.md); any later change needs a lease and a role matrix test |
| `backend/src/idraft/api/problems.py` | Known codes added once; a package's new code is a `ProblemError` subclass in its own module |
| `backend/src/idraft/api/schemas/ai.py` | New shapes go in new `ai_*.py` modules. Existing models have one writer at a time: summary models (EngineSummary, MetricCell, WeekCells, EntityCells, PromptsSummary) belong to [WP-12](work-packages/WP-12-summary-lane.md) until it merges, then by lease ([WP-54](work-packages/WP-54-extract-recommend.md), [WP-58](work-packages/WP-58-stats-api.md), [WP-64](work-packages/WP-64-aio-xch-api.md)); prompt models belong to [WP-13](work-packages/WP-13-prompts-lane.md), then by lease ([WP-41](work-packages/WP-41-versions.md), [WP-42](work-packages/WP-42-panels-api.md), [WP-44](work-packages/WP-44-links-generate.md)) |
| `backend/openapi/v1.json` | Generated. Never merged by hand: on a conflict take either side, then regenerate from the merged code (`cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`) |
| `apps/web/src/lib/api/schema.ts` | Generated by `pnpm gen:api` in the same push as the backend change (the release check `schema.test.ts` fails otherwise); on a conflict, regenerate after regenerating `v1.json` |
| `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py` | One anchor block per package (`# WP-NN <slug>`) with blank lines between; edit only inside your block |
| Migrations `backend/src/idraft/db/migrations/versions/` | Numbered at push time (3.9) |
| `apps/web/src/lib/navigation/registry.ts` and its test | All entries created `planned` in wave 0; a page package flips only its own line |
| `apps/web/messages/en.json` | Namespaces pre-created; edit only your namespace object; a conflict elsewhere in the file is resolved by keeping both sides, then `pnpm test src/i18n/messages.test.ts` |
| `apps/web/src/mocks/handlers/index.ts` | Registered once; packages edit only their handler module |
| `apps/web/e2e/support.ts`, `e2e/flows/ai-prompts.spec.ts` | `support.ts` frozen (add `e2e/support/<slug>.ts`); `ai-prompts.spec.ts` belongs to [WP-17](work-packages/WP-17-tp-header-filters.md) in wave 2; other packages write `e2e/flows/ai-<slug>.spec.ts` |
| `features/prompts/prompts-screen.tsx`, `prompt-inspector.tsx`, `topic-inspector.tsx` | Seams first ([WP-02](work-packages/WP-02-web-scaffold.md)); then one lease holder at a time: [WP-17](work-packages/WP-17-tp-header-filters.md), [WP-25](work-packages/WP-25-inspector-completion.md) and [WP-20](work-packages/WP-20-topics-by-engine.md) hold them in wave 2; others fill seams |
| Shared components in `components/app`, `lib/charts`, `lib/layouts` | Owned by the wave 1 package that builds them; a later change is a small follow-up under a lease, never a silent edit inside a feature package |
| `apps/web/package.json`, `pnpm-lock.yaml` | Known dependencies added in wave 0; a new one needs a lease and its own commit |
| docs 19 and 29 As built sections | Append-only, one section per package |
| `docs/ai-visibility/tracker.json`, `TRACKER.md` | The coordinator only |
| The shared dev database (`idraft-dev-postgres-1`) | Only migrations merged on develop are applied to it; a package with a new migration uses its own database `idraft_wp_NN` on the same server for manual checks |

### 3.7 Merge protocol

1. Work on the package branch in its worktree; one commit per task.
2. Before a push: `git fetch origin && git rebase origin/develop`. Resolve generated files by regeneration (3.6), migrations by renumbering (3.9), messages by keeping both sides.
3. Run the targeted checks of what changed (medium lane); for the last push of the package, or any push that touches a hot spot, run the package's full checks through `infra/dev/heavy`.
4. `git push origin HEAD:develop` (fast-forward only). If rejected, go back to step 2.
5. Announce: `infra/dev/wp-status` plus a message to the coordinator (section 6).
6. Partial pushes are welcome (contract first, then task by task) as long as develop stays green for what the push changed and `pnpm typecheck` passes.

### 3.8 Contract-first rule

OpenAPI first, then mocks, then web against mocks, then wire real. [WP-03](work-packages/WP-03-contract-pack.md) writes the shapes of every wave 1 and 2 route as schemas and `501` stubs before any body is written, so `schema.ts` has the types on day 1. Later backend packages push their own contract as their first push. A contract change after it is published goes in the contract note's change log and is announced to the consuming packages by the coordinator. Mock handlers have a test that they answer the generated shape. The first task after a backend package merges, for each consuming web package, is `pnpm gen:api` plus `pnpm typecheck`.

### 3.9 Migration numbering

Migrations are a linear Alembic chain (`0020` is the head at `246d3574`). A package writes its migration with a working name and, at push time, after the rebase, renames it to the next free number and sets `down_revision` to the current head. Two packages never push migrations at the same moment: the push of a migration takes the heavy lock (it runs `./check.sh`). Migrations are expand-then-contract only (docs/ops/release-and-deploy.md, forward-only rule).

## 4. Machine-load policy and the lock

**The machine.** 14 cores, 36 GiB of memory; Colima holds 10 CPUs and 16 GiB for Docker; the release checks run pytest on 8 workers and vitest on 6. Run in parallel, vitest and pytest time out. Load average was about 4 at 23:21 with the current sessions.

**Caps.**

| Resource | Cap | Why |
|---|---|---|
| Working sessions | 5, plus the coordinator | Agents are cheap on CPU, but each session runs local tools in bursts (tsc about 1.5 GiB and 1 core, eslint, targeted tests, a dev server); five bursts fit beside one heavy job without starving it |
| Subagents per session at once | 2 (one implementer and one reviewer, or two implementers on disjoint files) | Keeps at most 10 subagents running and a reviewer free for each implementer |
| Heavy lane (`infra/dev/heavy`) | 1 job at a time across all worktrees | A full suite or a build uses 6 to 10 cores; two at once is what makes the release checks flake |
| Medium lane (`infra/dev/heavy --lane medium`) | 2 jobs at a time | `pnpm typecheck`, `pnpm lint`, a vitest folder with `--maxWorkers=2`, a pytest path with `-n 2 --no-cov` |
| Light, no lock | any | One test file, ruff or prettier on changed files, `git` |
| Web dev servers | 2 at once, ports 3101 to 3105 by session number | About 1.5 to 2 GiB each; start for the browser check, stop after |
| Backend dev servers | 1 shared on the dev database for wiring checks, run by the coordinator | Avoids migrations of unmerged packages on the shared database |
| Load rule | If the 5 minute load average stays above 14, the coordinator pauses new tasks until it falls under 10 | Protects the heavy job in progress |

**Heavy jobs** (always through the heavy lane): `backend/check.sh` without a test path, `pytest` without a path, `pnpm test` without a path, `pnpm build`, `pnpm e2e`, `pnpm e2e:visual`, `infra/ship.sh`. During development a session runs only the targeted tests of its task.

**The lock design** ([WP-00](work-packages/WP-00-coordination-kit.md) builds it as `infra/dev/heavy`):

```text
infra/dev/heavy [--lane heavy|medium] [--label TEXT] [--wait MIN] [--max MIN] -- COMMAND [ARGS...]
infra/dev/heavy --status

state:  $(git rev-parse --path-format=absolute --git-common-dir)/idraft-locks/<lane>/
        shared by every worktree of the repository (the git common dir is one folder)
slots:  heavy 1, medium 2; slot N is the directory slot-N, taken with mkdir (atomic on APFS)
owner:  slot-N/owner holds pid, label, worktree, command, start time
queue:  tickets/<epoch-ns>-<pid> created on arrival; a waiter may take a slot only while its ticket is the
        oldest live ticket (FIFO); tickets and slots of dead pids are removed on every poll (stale recovery)
wait:   polls every 5 s; every 60 s prints "heavy: waiting for <label> (pid, 3m12s), 2 ahead";
        gives up after --wait minutes (default 60) with exit 75
run:    runs COMMAND in its own process group; after --max minutes (default 40) kills the group, exit 124
exit:   trap on EXIT, INT, TERM frees the slot and the ticket; the command's exit code is returned
status: prints holders and the queue of both lanes
```

Sketch of the core (the package writes and tests the real script):

```bash
dir="$(git rev-parse --path-format=absolute --git-common-dir)/idraft-locks/$lane"
now_ns() { python3 -c 'import time; print(time.time_ns())'; }   # macOS date has no %N
mkdir -p "$dir/tickets"; ticket="$dir/tickets/$(now_ns)-$$"; : > "$ticket"
trap 'rm -rf "$ticket" "${held:-/nonexistent}"' EXIT INT TERM
until held=$(take_slot); do reap_dead; check_wait_timeout; sleep 5; done   # take_slot: oldest ticket + mkdir
printf 'pid=%s label=%s cmd=%s start=%s\n' "$$" "$label" "$*" "$(date +%s)" > "$held/owner"
run_with_timeout "$max" "$@"   # background in a new process group, kill -TERM -- -pgid on timeout
```

**Quiet window before every release.** The coordinator announces it; each session finishes or parks its current task (a local WIP commit, never `git stash`), pushes what is green, stops its dev server and starts no heavy job. When `infra/dev/heavy --status` shows both lanes idle, the coordinator runs `infra/dev/heavy --label release --wait 30 --max 30 -- infra/ship.sh` in the background (after `pgrep -f 'bash.*infra/ship.sh'` prints nothing). The release holds the heavy lane for its whole run, so every other heavy job queues behind it. Making `infra/ship.sh` take the lock itself is an ops change: the coordinator raises it with the ops session.

## 5. Models, subagents, review gates and done criteria

| Work | Model | How |
|---|---|---|
| Coordination, dispatch, tracker, decisions, release | Opus (coordinator) | Reads reports, keeps the tracker, gives the next ready package, runs releases on the owner's word |
| Each package's detailed task plan | Opus, at the start of the package's session | Expands the package's steps into tasks with files, tests first and checks; commits it on the branch |
| Contracts ([WP-03](work-packages/WP-03-contract-pack.md)), statistics method ([WP-58](work-packages/WP-58-stats-api.md)), LLM and injection defences ([WP-68](work-packages/WP-68-llm-advanced.md)), SSRF fetcher ([WP-63](work-packages/WP-63-ssrf-webhooks.md)) | Opus writes or checks the method | Sonnet implements |
| Implementation | Sonnet, one fresh subagent per task | Tests first; file tools only (never shell heredocs, `sed`, replace scripts); one task, then hand back |
| Review | Sonnet, one fresh subagent per task, plus one for the whole package | Reads the task, the plan and the diff; runs the targeted tests; checks house rules; PASS or a numbered fix list |
| Mechanical work | Haiku | Message catalog entries, MSW mock data, fixtures, test boilerplate, anchor blocks, preset documents, As built drafts, the tracker table |

**Prove it bites** (every package marked risky: money, tenants, locks, cursors, statistics). For each guard the package adds (a workspace filter, a permission check, an If-Match comparison, a quota or budget sum, a keyset cursor bound, a detectability rule), the reviewer weakens it in a scratch commit that is never pushed, runs the targeted test, records that it fails, and restores the guard. The report lists the guards and the failing test names.

**Done criteria of a package.** Every step merged on develop; every row of the package either built or recorded with a named reason in the package report (a decision, a dependency); its acceptance criteria met; the checks of its kind green through the lock; for web, seen in a browser at 390, 768, 1024 and 1280 px in light and dark and axe clean; its e2e flow passing; As built notes written; the final report sent and the tracker updated by the coordinator.

**Release gate.** The owner said "ship it" or "release"; the quiet window holds; develop is green on the full checks; `schema.test.ts` is fresh; no live page calls a `501` stub (stubs may exist behind planned navigation, they answer after the permission check); the quality sweep of every surface in the release is done; the coordinator runs `infra/ship.sh` through the heavy lane, then checks `/api/readyz`, `/login` and the new pages on app.idraft.ai, and records the release in the tracker. Rollback only as the runbook says.

## 6. Coordination and the one progress view

### 6.1 The tracker

`tracker.json` is the machine readable source; `TRACKER.md` is the readable table (wave, package, status, rows done, blockers). Only the coordinator writes them, from the status files and messages, and pushes them on its own branch `ai/coordinator` to develop at most once an hour, so tracker commits never collide with package commits. The owner reads `TRACKER.md` only.

### 6.2 Status files

`infra/dev/wp-status WP-NN <status> "<note>"` writes `<git common dir>/ai-visibility/status/WP-NN.txt` (outside git, shared by every worktree). The coordinator reads all of them; nothing in git changes.

### 6.3 Leases

Recorded in `tracker.json` under `leases` as `{path, wp, since}`; one holder per path; released at the holder's push.

### 6.4 Report format

```text
WP-NN <status> | branch ai/wp-NN-<slug> @ <short sha> | rows done <n>/<total> | tasks <n>/<total> | blockers: <none or list> | next: <one line>
```

Sent at start (`planning`), plan committed (`building`), every push to develop, review start (`review`), blocked (`blocked`) and done (`merged`).

## 7. Waves

Waves are planning bands, not gates: a package starts when its `dependsOn` are merged and its gating decisions answered. At 65 reviewed tasks a working day:

| Wave | Name | Packages | Tasks | Days at 65 tasks a day | Can run at once | Entry | Exit |
|---|---|---|---|---|---|---|---|
| W0 | Scaffolding, contracts and the lock | WP-00, WP-01, WP-02, WP-03 | 22 | 0.3 | 3 (WP-00, WP-01 then WP-03, WP-02) | Nothing (starts first) | WP-01, WP-02, WP-03 merged on develop; `infra/dev/heavy` in use by every session; schema.ts regenerated |
| W1 | Shared web packages and the first backend lanes | WP-04, WP-05, WP-06, WP-07, WP-08, WP-09, WP-10, WP-11, WP-12, WP-13, WP-14 | 73 | 1.1 | 5 (all 11 packages are independent after W0) | WP-02 merged for web packages; WP-03 merged for backend lanes | Every shared component on the design-system page; layouts, summary, prompts and sources lanes merged with gen:api |
| W2 | Topics & Prompts, inspectors, Citations, dialogs, runs and settings | WP-15, WP-16, WP-17, WP-18, WP-19, WP-20, WP-21, WP-22, WP-23, WP-24, WP-25, WP-26, WP-27, WP-28, WP-29, WP-30, WP-31 | 121 | 1.9 | 5 (17 packages, most independent) | Per package: its dependsOn merged (most need one W1 package) | Topics & Prompts at parity with the preview; Citations live; Add, Import, Edit flows live; quality sweep of W2 done |
| W3 | AI Visibility Overview, Competitors page, notes | WP-32, WP-33, WP-34, WP-35, WP-36, WP-37, WP-38, WP-39, WP-40 | 60 | 0.9 | 5 (cards in parallel after the shell) | Layouts React packages and the chart packages merged | `/ai` live with five presets and every wave 1 and 2 card; `/competitors` live; quality sweep of W3 done |
| W4 | Slice 4 management: versions, panels, links and generate, inbox, alerts, views, exports, reports, Prompt Detail, command palette | WP-41, WP-42, WP-43, WP-44, WP-45, WP-46, WP-47, WP-48, WP-49, WP-50, WP-51, WP-52, WP-53 | 105 | 1.6 | 5 (three chains: prompts, platform, pages) | Prompts lane merged; per package dependsOn | Every slice 4 flow live; quality sweep of W4 done |
| W5 | Slice 2 and 3 data: extraction, recommendation, candidates, retrieval, statistics, source intelligence, performance, SSRF and webhooks | WP-54, WP-55, WP-56, WP-57, WP-58, WP-59, WP-60, WP-61, WP-62, WP-63 | 79 | 1.2 | 5 (two backend chains, web follows) | Summary lane merged; per package dependsOn; D-25 and D-27 only for their gated tasks | Recommendation and sentiment visible; server intervals replace the interim ones; Sources page live |
| W6 | Blocked by the provider or the owner: AI Overview engine and cross-channel, discovery sources, engine expansion, LLM features, first-party signals | WP-64, WP-65, WP-66, WP-67, WP-68, WP-69 | 67 | 1.0 | 3 once unblocked | D-50 (rank data), D-26 (spend), D-27 (LLM), D-51 (connections) | Each package's own exit criteria |
| W7 | Optional: page-level AI readiness | WP-70 | 12 | 0.2 | 1 | D-08 opened by the owner | Its own exit criteria |
| X | Cross-wave: quality sweeps, docs, releases and acceptance | WP-71, WP-72, WP-73 | 17 | 0.3 | 1 at each wave end | Runs at each wave end | Never closes before the last wave |

### 7.1 Every work package

| WP | Title | Wave | Kind | Depends on | Tasks | Rows (built) |
|---|---|---|---|---|---|---|
| [WP-00](work-packages/WP-00-coordination-kit.md) | Coordination kit: heavy-job lock, status files, worktree helper | W0 | infra | none | 4 | 0 (0) |
| [WP-01](work-packages/WP-01-backend-scaffold.md) | Backend scaffolding: routers, permissions, problem codes, test anchors | W0 | backend | none | 5 | 4 (2) |
| [WP-02](work-packages/WP-02-web-scaffold.md) | Web scaffolding: routes, navigation, seams, namespaces, mocks, moves, deps | W0 | web | none | 7 | 4 (0) |
| [WP-03](work-packages/WP-03-contract-pack.md) | Contract pack: OpenAPI shapes for the wave 1 and wave 2 backend items | W0 | backend | WP-01 | 6 | 0 (0) |
| [WP-04](work-packages/WP-04-chart-frame.md) | Chart platform: ChartFrame html mode, legend, tooltips, sample markers, boundaries | W1 | web | WP-02 | 6 | 1 (0) |
| [WP-05](work-packages/WP-05-chart-bars.md) | Chart parts: BarList, StackedShareBar, StepBars, IntervalBar | W1 | web | WP-02 | 5 | 1 (0) |
| [WP-06](work-packages/WP-06-chart-grids.md) | Chart parts: HeatmapGrid with tree rows, SmallMultiples, connected crosshair | W1 | web | WP-02 | 5 | 1 (0) |
| [WP-07](work-packages/WP-07-app-parts-a.md) | App components A: Delta, EngineLogo, Meter, Banner variants, statistics parts | W1 | web | WP-02 | 5 | 6 (0) |
| [WP-08](work-packages/WP-08-app-parts-b.md) | App components B: DomainCell, URLCell, count popover, ChangeFeed, inspector stepping | W1 | web | WP-02 | 5 | 4 (0) |
| [WP-09](work-packages/WP-09-table-extensions.md) | DataTable extensions: column groups, third tree level, right pin, context menu | W1 | web | WP-02 | 6 | 2 (0) |
| [WP-10](work-packages/WP-10-controls.md) | Mobile list rows, saved view presets menu, date range picker | W1 | web | WP-02 | 5 | 4 (0) |
| [WP-11](work-packages/WP-11-layouts-api.md) | Layouts API: core.layouts, five routes, catalog validation, audit | W1 | backend | WP-01, WP-03 | 8 | 14 (2) |
| [WP-12](work-packages/WP-12-summary-lane.md) | Summary additions: compare, total, rows, entities per week, co-mentions, filters | W1 | backend | WP-03 | 10 | 24 (8) |
| [WP-13](work-packages/WP-13-prompts-lane.md) | Prompt records: lint upgrade, type rule, filters, bulk update, quotas, provenance | W1 | backend | WP-03 | 10 | 31 (8) |
| [WP-14](work-packages/WP-14-sources-lane.md) | Sources and fan-out reads: series, country, min_support, lost, cited with, ads | W1 | backend | WP-03 | 8 | 21 (5) |
| [WP-15](work-packages/WP-15-layouts-react-core.md) | Layouts React core: registry, use-layout, provider, grid with dnd-kit, card frame | W2 | web | WP-02, WP-03 | 9 | 26 (7) |
| [WP-16](work-packages/WP-16-layouts-react-customize.md) | Layouts customize UI: catalog, numbers, save bar, team default, presets, undo | W2 | web | WP-15 | 9 | 24 (0) |
| [WP-17](work-packages/WP-17-tp-header-filters.md) | Topics & Prompts: header, filters, facets, strip, menus and shell items | W2 | web | WP-02, WP-07, WP-10, WP-13 | 8 | 75 (53) |
| [WP-18](work-packages/WP-18-tp-tables.md) | Topics & Prompts: table polish, stale, mobile rows, grouped header, In search counts | W2 | web | WP-09, WP-10, WP-07, WP-13 | 7 | 72 (46) |
| [WP-19](work-packages/WP-19-compare-deltas.md) | Compare with the previous period and deltas everywhere (W3) | W2 | web | WP-07, WP-12 | 6 | 10 (0) |
| [WP-20](work-packages/WP-20-topics-by-engine.md) | Topics by engine and the topic drawer (R-09, R-11 topic part) | W2 | web | WP-05, WP-06, WP-07, WP-12 | 9 | 37 (9) |
| [WP-21](work-packages/WP-21-citations-core.md) | Citations tab in the prompt inspector and the Citations page (Domains, Pages) | W2 | web | WP-08, WP-05, WP-10 | 9 | 31 (0) |
| [WP-22](work-packages/WP-22-citations-inspectors.md) | Citations: New and lost, domain and source inspectors, country, mobile | W2 | web | WP-21, WP-14 | 6 | 16 (0) |
| [WP-23](work-packages/WP-23-competitor-views.md) | Competitor views inside Topics & Prompts (W8) | W2 | web | WP-07, WP-05, WP-20 | 5 | 7 (2) |
| [WP-24](work-packages/WP-24-fanout-views.md) | Fan-out tab and views (W9) | W2 | web | WP-08, WP-05 | 5 | 13 (0) |
| [WP-25](work-packages/WP-25-inspector-completion.md) | Prompt inspector completion: header, Latest, History, Stats (R-11 prompt part) | W2 | web | WP-07, WP-08, WP-04 | 6 | 35 (26) |
| [WP-26](work-packages/WP-26-evidence-viewer.md) | Evidence viewer completion: citation markers, entity toggles, views, answer diff | W2 | both | WP-08 | 7 | 23 (9) |
| [WP-27](work-packages/WP-27-add-dialog.md) | Add prompts dialog redesign: plan block, checks, fields, topics, after the add (R-10) | W2 | web | WP-13, WP-07 | 10 | 132 (20) |
| [WP-28](work-packages/WP-28-import-csv.md) | Paste with columns and CSV import (R-10) | W2 | web | WP-27 | 6 | 32 (0) |
| [WP-29](work-packages/WP-29-edit-archive.md) | Edit details, archive and restore, row, bulk and inspector menus | W2 | web | WP-13 | 6 | 50 (12) |
| [WP-30](work-packages/WP-30-runs-costs-health.md) | Runs, costs, budgets and collection health (W21 freshness) | W2 | both | WP-03, WP-07 | 8 | 35 (22) |
| [WP-31](work-packages/WP-31-settings-engines.md) | Settings: engines page extras, data retention, setup checklist | W2 | both | WP-07 | 5 | 19 (12) |
| [WP-32](work-packages/WP-32-overview-aggregates.md) | Overview aggregate routes and the competitors read | W3 | backend | WP-12, WP-14 | 8 | 12 (2) |
| [WP-33](work-packages/WP-33-overview-shell.md) | AI Visibility Overview page: shell, scope, numbers, notices, presets, export | W3 | web | WP-16, WP-04, WP-07 | 7 | 7 (0) |
| [WP-34](work-packages/WP-34-overview-cards-engines.md) | Overview cards: rates by engine, outcomes, funnel, change summary, movers | W3 | web | WP-33, WP-05, WP-06, WP-19 | 8 | 11 (0) |
| [WP-35](work-packages/WP-35-overview-cards-competitors.md) | Overview cards: share of voice, lost to a competitor, competitor trends | W3 | web | WP-33, WP-05, WP-12 | 6 | 8 (0) |
| [WP-36](work-packages/WP-36-overview-cards-topics.md) | Overview cards: topics by engine and prompts | W3 | web | WP-33, WP-06, WP-20 | 7 | 13 (0) |
| [WP-37](work-packages/WP-37-overview-cards-sources.md) | Overview cards: sources, fan-out, activity and operations | W3 | web | WP-33, WP-05, WP-06, WP-30, WP-08 | 6 | 13 (0) |
| [WP-38](work-packages/WP-38-notes-annotations.md) | Chart notes and annotations (N9, N13, CH-35, M-14) | W3 | both | WP-01, WP-04 | 6 | 5 (0) |
| [WP-39](work-packages/WP-39-competitors-page.md) | Competitors page (Comparison, AI tab, inspector) | W3 | web | WP-32, WP-05, WP-06, WP-07 | 8 | 11 (0) |
| [WP-40](work-packages/WP-40-project-overview-ai.md) | Project Overview: AI cards and items (cross-channel) | W3 | web | WP-33 | 4 | 2 (0) |
| [WP-41](work-packages/WP-41-versions.md) | Versions: edit text, versions, restore, project feed, boundaries (B11, B12) | W4 | both | WP-13, WP-25 | 10 | 43 (1) |
| [WP-42](work-packages/WP-42-panels-api.md) | Panels backend: tables, core seed, routes, memberships, planner (B10) | W4 | backend | WP-41 | 10 | 14 (0) |
| [WP-43](work-packages/WP-43-panels-web.md) | Panels web: Panels tab, add to panel, locked core flows, filters | W4 | web | WP-42, WP-29 | 8 | 39 (0) |
| [WP-44](work-packages/WP-44-links-generate.md) | Keyword links and Generate from keywords (B18, N08, M-25) | W4 | both | WP-13, WP-27 | 9 | 34 (0) |
| [WP-45](work-packages/WP-45-candidates-api.md) | Prompt candidates inbox backend (B18 inbox, N10) | W4 | backend | WP-44 | 8 | 8 (0) |
| [WP-46](work-packages/WP-46-discover-web.md) | Discover > Prompts: candidates inbox and suggestions (W12) | W4 | web | WP-45, WP-10 | 8 | 31 (0) |
| [WP-47](work-packages/WP-47-alerts-api.md) | Alerts backend: rules, events, evaluation, AI rule types, digests | W4 | backend | WP-01, WP-14 | 10 | 14 (0) |
| [WP-48](work-packages/WP-48-alerts-web.md) | Alerts web: rule list, builder, bell, digest archive | W4 | web | WP-47, WP-08 | 7 | 12 (0) |
| [WP-49](work-packages/WP-49-saved-views.md) | Saved views persistence (B8) on every AI table | W4 | both | WP-10, WP-01 | 6 | 6 (1) |
| [WP-50](work-packages/WP-50-exports.md) | Server exports with AI kinds and the caveat header | W4 | both | WP-01 | 8 | 8 (0) |
| [WP-51](work-packages/WP-51-reports.md) | Reports page, shareable report and scheduled digests (M-12, M-13) | W4 | both | WP-50, WP-47, WP-49 | 8 | 7 (0) |
| [WP-52](work-packages/WP-52-prompt-detail.md) | Prompt Detail page `/ai/prompts/[promptId]` (T3) | W4 | web | WP-41, WP-21, WP-24, WP-06 | 8 | 17 (1) |
| [WP-53](work-packages/WP-53-command-palette.md) | Command palette (platform) | W4 | web | WP-02 | 5 | 4 (0) |
| [WP-54](work-packages/WP-54-extract-recommend.md) | Extraction: markdown structure, structured rank, recommendation, sentiment | W5 | backend | WP-12 | 10 | 17 (8) |
| [WP-55](work-packages/WP-55-recommend-web.md) | Recommendation, structured rank and sentiment on every AI page | W5 | web | WP-54 | 6 | 9 (0) |
| [WP-56](work-packages/WP-56-rederive-candidates.md) | Re-derivation, derivations routes and entity candidates (competitor discovery) | W5 | both | WP-54, WP-50 | 10 | 13 (0) |
| [WP-57](work-packages/WP-57-retrieval-fanout.md) | Retrieved but not cited, fan-out table and keyword match (C8, FO-07, F3) | W5 | both | WP-14, WP-24 | 8 | 10 (0) |
| [WP-58](work-packages/WP-58-stats-api.md) | Statistics backend: intervals, paired verdict, flip rate, movers, sizing (slice 3) | W5 | backend | WP-12, WP-42 | 10 | 19 (0) |
| [WP-59](work-packages/WP-59-stats-web.md) | Statistics web: server intervals, verdicts, volatility, sizing, replicates | W5 | web | WP-58, WP-52 | 5 | 6 (0) |
| [WP-60](work-packages/WP-60-source-intel-api.md) | Source intelligence backend: categories, publishers, overlap, opportunities | W5 | backend | WP-14 | 10 | 13 (0) |
| [WP-61](work-packages/WP-61-sources-page.md) | Sources page, opportunities and source overlap views | W5 | web | WP-60, WP-05 | 7 | 11 (0) |
| [WP-62](work-packages/WP-62-performance.md) | Performance: rollups, caching, EXPLAIN gate, quality counters | W5 | backend | WP-12, WP-32 | 6 | 5 (0) |
| [WP-63](work-packages/WP-63-ssrf-webhooks.md) | SSRF-safe fetcher and outbound webhooks | W5 | backend | WP-47 | 7 | 2 (0) |
| [WP-64](work-packages/WP-64-aio-xch-api.md) | AI Overview engine and cross-channel backend (needs rank data, OD-13) | W6 | backend | WP-44, WP-58 | 12 | 17 (1) |
| [WP-65](work-packages/WP-65-aio-xch-web.md) | AI Overview and cross-channel web: AIO columns, Matrix, keyword AI tab, pages | W6 | web | WP-64 | 9 | 12 (0) |
| [WP-66](work-packages/WP-66-discovery-sources.md) | Discovery sources: PAA, GSC questions, fan-out to inbox, modeled demand | W6 | backend | WP-45, WP-64 | 8 | 3 (0) |
| [WP-67](work-packages/WP-67-engine-expansion.md) | Engine and data expansion: forced search, official APIs, other surfaces, API keys | W6 | backend | WP-58 | 12 | 10 (0) |
| [WP-68](work-packages/WP-68-llm-advanced.md) | LLM-backed and Phase 15 analytics: adjudication, claims, diagnostics, experiments | W6 | both | WP-54, WP-58 | 14 | 13 (0) |
| [WP-69](work-packages/WP-69-first-party-signals.md) | First-party AI signals: GA4 referrals, crawlers, GSC generative, Bing AI (Ph 12) | W6 | both | WP-50 | 12 | 8 (0) |
| [WP-70](work-packages/WP-70-geo-readiness.md) | Page-level AI readiness (optional, only if the owner opens it, OD-11) | W7 | both | WP-63 | 12 | 21 (0) |
| [WP-71](work-packages/WP-71-quality-sweeps.md) | Quality sweeps: e2e, axe at four widths, visual, responsive, copy rules | X | web | none | 8 | 31 (21) |
| [WP-72](work-packages/WP-72-docs.md) | Docs: As built notes, drift fixes, design-system additions | X | docs | none | 5 | 2 (1) |
| [WP-73](work-packages/WP-73-release-acceptance.md) | Release gates and the first real-data acceptance run | X | infra | none | 4 | 1 (0) |

### 7.2 Day 1 dispatch (2026-11-13)

| Hour | S0 coordinator | S1 | S2 | S3 | S4 | S5 |
|---|---|---|---|---|---|---|
| 0 to 1 | [WP-00](work-packages/WP-00-coordination-kit.md) (lock first) | [WP-01](work-packages/WP-01-backend-scaffold.md) | waits | waits | [WP-02](work-packages/WP-02-web-scaffold.md) | waits |
| 1 to 3 | tracker, decisions | [WP-03](work-packages/WP-03-contract-pack.md) | waits for the contract | waits for the contract | [WP-02](work-packages/WP-02-web-scaffold.md) | [WP-07](work-packages/WP-07-app-parts-a.md) after the scaffold merges |
| 3 to 10 | dispatch, merges watch | [WP-11](work-packages/WP-11-layouts-api.md) | [WP-12](work-packages/WP-12-summary-lane.md) | [WP-13](work-packages/WP-13-prompts-lane.md) | [WP-04](work-packages/WP-04-chart-frame.md), [WP-05](work-packages/WP-05-chart-bars.md) | [WP-08](work-packages/WP-08-app-parts-b.md), [WP-09](work-packages/WP-09-table-extensions.md) |

[WP-14](work-packages/WP-14-sources-lane.md), [WP-06](work-packages/WP-06-chart-grids.md) and [WP-10](work-packages/WP-10-controls.md) start on day 2 morning or as soon as a session frees up.

## 8. Contradictions found in the inputs, and how this plan resolves them

| Topic | Contradiction | Resolution |
|---|---|---|
| API compression | Inventories (OD-8, CF-28, BE-METRICS-23, BE-OPS-12) say gzip is not in place; develop has `GZipMiddleware` and `test_compression.py` (`de54a88d`) | Treated as built on develop; the `include` size restriction lifts once it is released; the two rows stay excluded as ops work; [WP-72](work-packages/WP-72-docs.md) fixes the drift |
| Client regeneration | AGENTS.md in the main checkout says regenerate both in the same change; the worktree copy and the handoff say the web session regenerates in its own commit right after | Same push: the backend commit and the `pnpm gen:api` commit go to develop together, by the pusher |
| `filter[funnel_stage_in]` and importance filter | web.md WB-TPF-11 and WB-TPF-12 call them built; backend.md (drift 2) says not built | Backend wins: not built; [WP-13](work-packages/WP-13-prompts-lane.md) builds them and [WP-17](work-packages/WP-17-tp-header-filters.md) depends on it |
| B5 entity cells | The handoff status table says not built; the code and backend.md say built (`41586c30`) | Built |
| `include=series` | Doc 29 As built says not built; built (`fbbf689a`) | Built; [WP-72](work-packages/WP-72-docs.md) fixes doc 29 |
| Fan-out truncation flag | web.md CF-04 asks whether `FanoutMeta` carries it; backend.md says `meta.answers_truncated` is built | Built; the mock follows it |
| API need ids | overview-and-charts.md N1 to N15 and prompt-dialogs.md N01 to N14 use the same letter | Namespaced: `OV-N1` to `OV-N15` and `PD-N01` to `PD-N14`, `PD-B10` to `PD-B18` |
| Counts | The task brief says 14 Overview needs and 19 dialog needs; the files hold 15 (N15 is optional) and 18 rows | Counted as found: 15 and 18 |
| Presets | The layout spec rules out several named layouts per page; the owner requires presets | Presets as code applied to the draft (D-01), inside the one-layout rule |
| Tab count | DS 23 4.1 limits an inspector to 5 tabs; the prompt inspector needs 6 with Fan-out, and R-11 lists Versions and runs too | D-02: 6 tabs, Fan-out conditional, Versions and runs inside History, full timeline on Prompt Detail |
| Review model | A memory note asks for Opus review after each task; the brief says Sonnet reviews | Sonnet per task; Opus end review of risky packages proposed as D-52 |
| Cadence copy | Mocks of `c1abdd4` still say weekly; the owner decided twice a week | [WP-02](work-packages/WP-02-web-scaffold.md) sets the mocks to twice a week |
| Per-project layouts | BE-LAYOUTS-12 is listed as a capability; the layout spec decided one layout per person per workspace | Excluded as decided out |
| Topic Explorer routes | doc 20 5.11 specifies them; ADR-DS-022 superseded them with the Topics tab | D-28 drop; [WP-72](work-packages/WP-72-docs.md) records it |
| The deadline | R-04 asks for everything today; the plan was written at 23:30 | Section 1 schedule |

## 9. Risk register

| Risk | Effect | What the coordinator does |
|---|---|---|
| Provider or LLM spend without a yes | Real money on paused schedules | Schedules stay paused; no package may call a provider or an LLM in tests; D-25, D-26, D-27 gate the tasks that would; the acceptance run needs D-26 and a budget row first |
| Tenant isolation on new tables and routes | Data of one workspace visible to another | Every new route in the cross-tenant scan, every table with RLS and `_TENANT_ROWS`; prove it bites on every guard; Opus end review (D-52) |
| Machine load | Flaky checks, timeouts, slow sessions | Caps of section 4, the lock, targeted tests only, the load rule, the quiet window |
| Merge conflicts | Lost work, broken develop | Wave 0 scaffolding, ownership, leases, regeneration of generated files, rebase before push, anchors in shared test files |
| Review quality | Bugs merged in a confident tone | Fresh reviewer per task, a package-end reviewer, prove it bites, browser checks at four widths, quality sweeps at each wave end |
| Scope creep | Days added, nothing finished | Only inventory rows are built; anything new goes to owner-requirements.md first and into a package by the coordinator |
| Contract churn | Web built against shapes that change | Contract notes with change logs, announced changes, mock tests against generated types |
| 501 stubs in a release | A page calls a route that answers 501 | Release gate: no live page calls a stub; stubs sit behind planned navigation |
| Rank data at the provider | AI Overview and cross-channel cannot be trusted | Wave 6 waits for D-50 |
| Dev database polluted by unmerged migrations | Other sessions fail | Per-package databases (3.6) |
| Coordinator overload | Tracker stale, owner loses the view | Status files instead of chat, Haiku renders the table, hourly tracker push |
| Response size of `include=series,entities` | Slow drawers | gzip is on develop; release it; keep `rows=topics` and `filter[term]` for big projects |

## 10. Coverage check

Rows are read by script from the four inventory files at `246d3574` (ids in the first column of each table; status from the status column). Every row that is not DROP and not in the excluded register below is in exactly one work package; the generator refuses to write the plan otherwise.

| Inventory | Rows read | DROP | Excluded (register below) | Assigned to a WP | Of those built | Orphaned | In two WPs |
|---|---|---|---|---|---|---|---|
| backend.md BE-* | 298 | 0 | 8 | 290 | 65 | 0 | 0 |
| web.md WB-* (surfaces, IA, cross-cutting) | 620 | 8 | 0 | 612 | 194 | 0 | 0 |
| web.md SC-* | 26 | 0 | 0 | 26 | 0 | 0 | 0 |
| web.md CF-* | 31 | 0 | 0 | 31 | 0 | 0 | 0 |
| prompt-dialogs.md PD-* | 258 | 0 | 0 | 258 | 20 | 0 | 0 |
| overview-and-charts.md CH-* | 46 | 0 | 0 | 46 | 0 | 0 | 0 |
| API needs OV-N* and PD-N*/PD-B* | 33 | 0 | 0 | 33 | 0 | 0 | 0 |
| Total | 1312 | 8 | 8 | 1296 | 279 | 0 | 0 |

Inventory totals as the files state them:

- BE: 298 rows: 65 BUILT, 26 PARTIAL, 202 NOT BUILT, 5 DEFERRED BY OWNER
- WB: 537 surface rows (149 BUILT, 36 PARTIAL, 344 NOT BUILT, 8 DROP) plus 13 navigation entries and 70 cross-cutting rows
- SC: 26 shared component packages (none built as a whole)
- CF: 31 contract-first needs
- PD: 258 dialog rows (20 BUILT, 16 PARTIAL, 144 NOT BUILT, 78 specification rows: errors, roles, states, keyboard, tests) plus 18 API needs (N01 to N14, B10, B11, B12, B18)
- CH: 46 charts CH-01 to CH-46 (CH-14 sparkline exists in part)
- N: 15 Overview API needs N1 to N15 (namespaced OV-N1 to OV-N15) plus the 18 dialog needs (PD-N01 ... PD-B18)

Specification rows (dialog errors, roles, states, keyboard, tests) count as not built until the package that owns them proves them. The 8 DROP rows (WB-TPF-15, WB-TOP-04, WB-BLK-03, WB-PIH-13, WB-PIF-11, WB-OV-15, WB-SRCS-06, WB-GEO-12) stay recorded in web.md and are built by no package.

**Excluded register** (not DROP, not in any package):

| Row | Reason |
|---|---|
| BE-COLLECT-13 | DEFERRED BY OWNER: Run now uses the standard queue (OD-12) |
| BE-METRICS-12 | DEFERRED BY OWNER: Prompt Explorer routes replaced by the summary (S1 4.5) |
| BE-METRICS-23 | DEFERRED BY OWNER, ops session; note: gzip is on develop since de54a88d |
| BE-OPS-12 | DEFERRED BY OWNER, ops session; gzip is on develop since de54a88d |
| BE-OPS-13 | DEFERRED BY OWNER: VPS, release, backups, observability belong to the ops session |
| BE-ALERTS-15 | Ops session: platform alerts for operators (OD-8) |
| BE-LAYOUTS-12 | Decided out: one layout per person per workspace (layout spec decision 5) |
| BE-BILLING-PLAN-LINKS-13 | Out of AI scope: billing and plans are a product decision |

**Owner requirements.**

| R | Requirement | Where it is covered |
|---|---|---|
| R-01 | Build the entire feature | Every package; coverage table above |
| R-02 | One plan that fans out | This file, sections 3 to 7, and the 74 package files |
| R-03 | One clear progress view | TRACKER.md and tracker.json, section 6 |
| R-04 | Built today | Not possible safely; section 1 gives the realistic schedule |
| R-05 | Professional UI at the level of Keywords and Prompts | Common acceptance criteria of every web package; [WP-71](work-packages/WP-71-quality-sweeps.md) |
| R-06 | Overview dashboard with all summaries and charts | [WP-33](work-packages/WP-33-overview-shell.md) and the four card packages |
| R-07 | Greater than the preview, full customization | [WP-11](work-packages/WP-11-layouts-api.md), [WP-15](work-packages/WP-15-layouts-react-core.md), [WP-16](work-packages/WP-16-layouts-react-customize.md), [WP-33](work-packages/WP-33-overview-shell.md) |
| R-08 | Better than Nuwtonic, every honest chart | 46 charts across [WP-34](work-packages/WP-34-overview-cards-engines.md), [WP-35](work-packages/WP-35-overview-cards-competitors.md), [WP-36](work-packages/WP-36-overview-cards-topics.md), [WP-37](work-packages/WP-37-overview-cards-sources.md), [WP-38](work-packages/WP-38-notes-annotations.md), [WP-55](work-packages/WP-55-recommend-web.md), [WP-57](work-packages/WP-57-retrieval-fanout.md), [WP-61](work-packages/WP-61-sources-page.md), [WP-65](work-packages/WP-65-aio-xch-web.md), [WP-69](work-packages/WP-69-first-party-signals.md) |
| R-09 | Topics by engine on Overview, Topics tab and drawer | [WP-20](work-packages/WP-20-topics-by-engine.md), [WP-36](work-packages/WP-36-overview-cards-topics.md) |
| R-10 | Upgrade Add and Import prompts | [WP-13](work-packages/WP-13-prompts-lane.md), [WP-27](work-packages/WP-27-add-dialog.md), [WP-28](work-packages/WP-28-import-csv.md), [WP-29](work-packages/WP-29-edit-archive.md), [WP-44](work-packages/WP-44-links-generate.md), [WP-46](work-packages/WP-46-discover-web.md) |
| R-11 | Prompt inspector and topic drawer complete | [WP-25](work-packages/WP-25-inspector-completion.md), [WP-21](work-packages/WP-21-citations-core.md), [WP-23](work-packages/WP-23-competitor-views.md), [WP-24](work-packages/WP-24-fanout-views.md), [WP-26](work-packages/WP-26-evidence-viewer.md), [WP-41](work-packages/WP-41-versions.md), [WP-20](work-packages/WP-20-topics-by-engine.md), [WP-59](work-packages/WP-59-stats-web.md) |
| Constraints | Twice a week, restore not a kind, type rule, 20 a day cap, gzip to ops, GEO later, no spend without a yes, Sonnet reviews, gen:api with backend changes | Sections 2, 3.6, 4, 5 and the packages that touch each |
