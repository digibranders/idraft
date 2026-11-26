# Internal links 00: roadmap

This page says in what order the internal link tracker is built, who does what, where each piece lands, and what the owner has to decide. It does not repeat the plans. Read it first; then open the plan you are about to run.

- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md`
- Reference UI (done, on `develop`): the design preview route `#/internal-links`, files `apps/web/design-preview/il*.js`
- Plan 01, crawl spike: `2026-11-16-internal-links-01-crawl-spike.md`
- Plan 02, backend slice 1: `2026-11-16-internal-links-02-backend-slice-1.md`
- Plan 03, web slice 1: `2026-11-16-internal-links-03-web-slice-1.md`

## What exists today

| Piece | State |
|---|---|
| Research and spec | Done, merged and pushed |
| Mock in the design preview (all slices, including changes, alerts, opportunities and the path finder) | Done on `develop`, tested in a headless browser; the latest mock commits are local and not pushed |
| Backend and real app | Nothing built. Plans 01 to 03 are written. |
| Crawl spike S-17 | Not run. It spends real money, so it waits for the owner. |

## Scope of this program

Slice 1 only, as plans 02 and 03 define it: tiers and tags, bulk tagging, tier rules and CSV import, the crawl (on website add, weekly, Crawl now), Pages and Links tabs, the Journey canvas and tree list, the Tier flow, the settings screens. The slice 2 and 3 screens that the mock already shows (crawl picker, Changes, alerts, Opportunities, Path finder, rank and anchor columns, client summary) are built after slice 1 ships and are not planned yet.

The UI never shows an equity share (owner decision, 2026-11-16). The backend may compute it for ordering and for later use.

## Order

```
Plan 01 tasks 1 to 6 (no spend) ──┐
                                   ├─ owner go-ahead and two test sites ─ Plan 01 task 7 (about $2.75, cap $5) ─ write-up, gate ─┐
                                                                                                                                     │
Plan 02 tasks 1 to 4, 6, 7, 12 (no dependency on the spike) ───────────────────────────────────────────────────────────────────────┤
                                                                                                                                     ▼
                                                      Plan 02 task 0 (adjust to spike), tasks 5, 8, 9, 10, 11, 13, 14 ──── OpenAPI on develop
                                                                                                                                     │
Plan 03 tasks 0 to 4 (design system and pure modules, no API needed) ───────────────────────────────────────────────────────────────┤
                                                                                                                                     ▼
                                                                                        Plan 03 task 5 onward (generated client) ─ tasks 6 to 18
```

1. **Plan 01 first, in part.** Tasks 1 to 6 (classifier, spike script, tests) cost nothing and run at once. The paid run (task 7) waits for the owner. Plan 02 imports the classifier from plan 01, so plan 01 merges before plan 02 tasks 5 and 8.
2. **Plan 02 in parallel.** Tasks 1, 2, 3, 4, 6, 7 and 12 do not depend on the spike results and can start the day the backend worktree opens. Task 0 (read the spike, adjust the plan) comes before the tasks it can change: 5, 8, 9 and 11.
3. **Plan 03 in parallel with plan 02.** Tasks 0 to 4 (tier tokens, `TierBadge`, pure rules, journey layout, `LinkCard`, `LinkCanvas`) need no API. Task 5 needs `backend/openapi/v1.json` with the internal links routes on `develop`. If that is not there yet, the web session stops after task 4 and reports. It never invents a schema.
4. **Hand-over.** Plan 02 task 13 checks the contract against plan 03's expectations. The web session regenerates the client in its own commit right after (`pnpm gen:api`, AGENTS.md).
5. **Acceptance on a real site.** Plan 02 task 14 and plan 03 task 17 run against a real crawl of the spike sites. Only then does the owner decide to release.

## Worktrees and branches

| Plan | Worktree | Branch |
|---|---|---|
| 01 | `.claude/worktrees/internal-links-spike` | `feat/internal-links-spike` |
| 02 | `.claude/worktrees/internal-links-backend` | `feat/internal-links-backend` |
| 03 | `.claude/worktrees/internal-links-web` | `feat/internal-links-web` |
| 10 | `.claude/worktrees/link-map-backend` | `feat/link-map-backend` |
| 11 | `.claude/worktrees/link-map-web` | `feat/link-map-web` |

All three are cut from `origin/develop` and merge into `develop`. Nothing goes to `main` except through `infra/ship.sh` when the owner says to release (AGENTS.md). Shared files that other tracks also change (messages, design-system registry, tokens, `ProjectSettings`) are named in each plan; merge `develop` into the branch before the final gate.

## Review steps

Every plan task ends with an independent review (owner rule). Opus plans and reviews; Sonnet builds. In addition:

- After plan 02 task 3, 6 and 12: a review of row-level security and permissions, because these tasks add tables and read paths.
- After plan 02 task 9: a review of cost control (budget check before posting, no blind repost after a timeout).
- After plan 03 task 4 and task 11: a review of the canvas for keyboard use and screen reader names, in both themes.
- Before merging each branch: the gate of AGENTS.md for the parts touched (backend `./check.sh`; web lint, typecheck, test, format check, build).

## Decisions the owner has to make

| # | Decision | Needed before | Recommendation |
|---|---|---|---|
| D1 | Go-ahead to spend up to $5 on the spike, and the names of one WordPress site and one other CMS site to crawl besides cleanstart.com | Plan 01 task 7 | Approve; estimate is $2.75 |
| D2 | Crawl billing by `max_crawl_pages`: a site with no sitemap would cost about $7.50 a crawl at the 50,000 page ceiling (plan 02, O1) | Plan 02 task 9 | Decide after the spike prices it; likely use the larger of 2,000 and 3 times the pages seen last time |
| D3 | Template pass guards that amend spec 6.3 (steady count, minimum folder size, self links; plan 01 decision 6) | Plan 01 gate | Accept; the spec is edited at the gate |
| D4 | Pages list size: the house table sizes (100 or 200 rows) or the mock's 25 with "Show 25 more" (plan 03, P1) | Plan 03 task 7 | House sizes |
| D5 | Rules cannot set Untiered; tier flow is a table, not a chart; no 150 ms layout motion on the canvas (plan 03, P2 to P4) | Plan 03 tasks 11 to 13 | Accept all three for slice 1 |
| D6 | Push the unpushed mock commits on `develop` | Whenever | Push, they are reviewed and tested |
| D7 | Where this track sits next to the AI visibility program | Before staffing | Its own track; nothing here touches the AI visibility tables |

## Contract gaps the backend should close

Plan 03 lists, in its "Contract gaps for the backend" section, the places where the web has to work around the API (for example no `sort=tier` on pages, no dry run for CSV import, no bulk save of tier rules). Each has a web fallback written into plan 03, so none blocks the build. Closing them removes web code. Take them to the backend session after plan 02 task 12.

## Out of scope for the whole program

- Slice 2 and 3 screens in the real app (planned after slice 1 ships).
- Any equity share figure in the UI.
- Crawl limits and pricing (owner: discuss later).
- Two-factor and other hardening (build order: core features first).

## Done means

- The spike write-up exists and the spec reflects it.
- The backend passes `./check.sh` and its acceptance run on a real crawl of a spike site.
- The web passes its gate, the Playwright flow and axe on every tab in both themes.
- The real Internal links page matches the mock screen by screen, apart from the decisions D4 and D5.
- The owner reviewed it on `develop` and said to release.

## Slices 2 and 3

On 2026-11-17 the owner asked for everything in the real app, so slices 2 and 3 have plans of their own. They continue in the same worktrees and branches as plans 02 and 03.

- Plan 04, backend slices 2 and 3: `2026-11-17-internal-links-04-backend-slices-2-3.md` (17 tasks). Migration 0026, the `crawl_enrich` job (changes between crawls, the alert record, anchor counts, mentions), Search Console clicks per page, the changes, opportunities, tier suggestion and path finder APIs, rank, citation and anchor extras on the pages list and the inspector, and the contract for the web.
- Plan 05, web slices 2 and 3: `2026-11-17-internal-links-05-web-slices-2-3.md` (21 tasks). The canvas rework to the mock of 2026-11-17 (the "Task 4b" of the session notes: pan and zoom, minimap, focus card, one journey at a time, growth that keeps the place, the By tier layout), the crawl picker and the two line header, the Changes, Opportunities and Path finder screens, the new Pages and inspector parts, and the client summary.

Level of detail: plan 04 is in full step form. Plan 05 tasks 1 to 4, 8 and 10 are in full step form; tasks 5 to 7 and 9 have full code for new files and edit instructions for existing ones; tasks 12 to 20 are outlines that the Opus planning session expands when the plan 03 screens they build on (inspector, Links tab, Journey tab, settings, bulk bar) are merged.

Order:

```
Plan 02 done and merged ─ Plan 04 tasks 0 to 5 (pure rules, migration; no dependency on each other beyond 0) ─ 6, 7, 8, 9 ─ 10 to 14 ─ 15 (OpenAPI on develop) ─ 16 (acceptance)
Plan 03 tasks 0 to 7 done ─ Plan 05 tasks 0 to 7 (canvas rework, no API needed) ───────────────┐
Plan 03 tasks 8 to 18 ─────────────────────────────────────────────────────────────────────┼─ Plan 05 tasks 8 to 11 (needs plan 04 task 15) ─ 12 to 19 ─ 20
```

1. Plan 05 tasks 1 to 7 (the canvas) need no API and can start the day plan 03's canvas task is merged; they change `link-canvas.tsx`, so no other plan 03 task may edit it at the same time.
2. Plan 04 tasks 1 to 8 can start as soon as plan 02 is merged; tasks 10 to 14 need 6 and 9. The web session stops after its Task 7 until `backend/openapi/v1.json` carries the plan 04 routes.
3. Plan 05 tasks 12 to 19 each need a screen of plan 03 (inspector, Links tab, Journey tab, settings screens, bulk bar); each task names which.
4. Acceptance: plan 04 task 16 on the real crawl of eventussecurity.com (a second crawl, about $0.06), plan 05 task 20 on the mock and then on that crawl.

Changes to slice 1 that slices 2 and 3 need (the build sessions make them when they reach the task named):

| Where | Change | Task |
|---|---|---|
| `PageScope` and `crawl_scope` (plan 02) | `links_dropped` and `alert_max_position` fields; link level reads answer `410 links_dropped` | Plan 04 task 9 |
| `CrawlRun` and `ListMeta` (plan 02) | `links_available`, `previous_run_id`, `enrich_state`, `links_available` in the list meta | Plan 04 task 9 |
| `crawl_tick` and `CrawlTickReport` (plan 02) | A `send_enrich` argument and an `enrich_sent` count | Plan 04 task 6 |
| `crawl_store` (plan 02) | A read-only tier flow for crawls that are not the latest | Plan 04 task 9 |
| `fp.gsc_search_analytics` pull (Search Console) | An extra call per day for page totals, behind a flag in `SyncContext` | Plan 04 task 8 |
| Plan 02 decision D21 | Search Console rows have no page, so GSC orphans need the new page totals; orphans stay sitemap orphans | Plan 04 open point O5 |
| Plan 03 `LinkCanvas` (zoom steps, elbow edges, tooltips on hover) | Replaced by the viewport, curves and info panel | Plan 05 tasks 5 to 7 |
| Plan 03 `LinksTabContext`, `url-state.ts`, `tabs.ts`, `crawl-header.tsx` | `run`, six tabs, the two line header | Plan 05 tasks 10 and 12 |
| Plan 03 decision W19 ("no crawl picker in slice 1") | Superseded by the picker | Plan 05 task 12 |

New owner decisions these plans need (each is an open point in the plan named):

| # | Decision | Plan | Recommendation |
|---|---|---|---|
| D8 | Search Console clicks per page need one extra call a day per property (28 calls once): accept, or leave the click columns and the click rule of tier suggestions empty | 04, O1 | Accept |
| D9 | Email and Slack alert delivery waits for the alerts service (WP-47); slice 2 ships the in-app alert | 04, O2 and 05, P2 | Accept that order |
| D10 | Rank and AI citation columns show today's numbers on an older crawl | 04, O3 | Accept |
| D11 | Mention sources are tracked keywords and the anchors other pages use; judge the list on the real crawl before widening | 04, O4 | Accept |
| D12 | Links tab "First seen" is one crawl deep (Added and Lost for the crawl in view), not a date across all crawls | 04, O7 and 05, P5 | Accept |
| D13 | The UI shows "Link strength change" in points where the mock shows "Equity change", never the share itself | 05, P1 | Accept the wording, or remove the column |
| D14 | The canvas is the mock's viewport ported to the app, without React Flow and elkjs named in the spec | 05, P4 | Accept |
| D15 | The client summary is a download built in the browser; a shareable link is not in this release | 05, P3 | Accept |
| D16 | Rank, citation and anchor columns do not sort (only Change does) | 05, P6 | Accept |

## Link map (plans 10 and 11)

On 2026-11-26 the owner approved a "Link map" tab: the whole crawl as one interactive graph (a dot per live page, an arrow per body link), after a mock in `apps/web/design-preview` that went through two rounds of feedback on finding pages, naming them, colours and hover. It replaces the spec's "Whole-site graph picture: when asked".

- Plan 10, backend, `2026-11-26-internal-links-10-link-map-backend.md`: `GET .../internal-links/graph`, the whole crawl as nodes and edges, capped by `max_pages`.
- Plan 11, web, `2026-11-26-internal-links-11-link-map-web.md` (10 tasks): the graph query, the model, the deterministic layout in a Web Worker, the focus, the ECharts option, the canvas component, the tab, the design system entry and one browser flow. Plan 11 starts after plan 10 is on `origin/develop`.

Owner decisions taken on 2026-11-26:

| # | Decision | Plan | Taken |
|---|---|---|---|
| D17 | Menu and footer links are a property of the page, not edges of the graph; the card and a Highlight choice show them | 10 and 11, W4 | 2026-11-26 |
| D18 | The map is a tab of its own, named "Link map", after Journey | 11, W12 | 2026-11-26 |
| D19 | The renderer is the ECharts graph series with a cap of 3,000 pages; sigma.js is the upgrade when a customer needs a bigger map | 11, W1 and W3 | 2026-11-26 |
| D20 | Tiers are one hue each on the map, not the one-blue scale of the tier badge | 11, W5 | 2026-11-26 |
