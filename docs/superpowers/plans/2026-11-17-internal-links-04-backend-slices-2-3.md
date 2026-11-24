# Internal links 04: backend slices 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend of slices 2 and 3 of the internal link tracker: what changed between crawls (lost and added links, pages that moved, the alert for links lost to important pages), crawl history for the crawl picker, anchor statistics, tracked keyword, rank, AI citation and Search Console numbers per page, link opportunities with accept and dismiss, tier suggestions, the path finder, and the new flags and worklists, all read from the stored crawls of plan 02 and from the keyword, rank, Search Console and AI visibility tables that already exist.

**Architecture:** One migration (0026) adds a per-run change store (`seo.crawl_link_changes`, `seo.crawl_page_changes`), an alert record (`seo.crawl_alerts`), mentions (`seo.crawl_mentions`), the people's decisions (`core.link_opportunity_decisions`, `core.tier_suggestion_dismissals`), page totals from Search Console (`fp.gsc_page_daily`) and a few columns on `seo.crawl_runs` and `seo.crawl_pages`. Five small pure modules in `idraft.crawl` hold the rules (anchors, change classification, shortest route, tier suggestions, mentions). A new resumable worker job `crawl_enrich` runs after a crawl is `ready` (changes, alert, anchor counts, mentions), so a crawl is usable before its extras are. The API adds `idraft.api.internal_links` modules for changes, page extras, opportunities, tier suggestions and the path finder, and extends the pages list and the crawl list of plan 02 with opt-in parts. Nothing new is stored for rank or citations: they are read live for the rows being shown.

**Tech Stack:** Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2 Core (async), PostgreSQL 18 (asyncpg), Alembic with raw SQL, Taskiq on Redis streams, zstandard, pytest with Testcontainers, import-linter. No new dependency.

---

## Where this plan sits

- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md`, sections 3 (later slices), 7.1, 7.10 and 8.
- Mock (source of truth for every definition): `apps/web/design-preview/il-model.js` (`linkChanges`, `lostToTop`, `alertsFor`, `pageDelta`, `opportunities`, `tierSuggestions`, `anchorStats`, `findPaths`, `routeFromHome`, `WORKLISTS`, `setCrawl`), `il-changes.js`, `il-opps.js`, `il-pages.js`, `il-drawer.js`.
- Depends on: plan 02 complete through Task 12 and merged to `develop` (tables of migration 0025, `idraft.crawl`, `crawl_ingest`, the read API). As built on 2026-11-17 the backend worktree holds all of it up to commit `ea6f3a37`; Task 0 checks.
- Plan 05 (web) consumes the contract of this plan. It starts at its own Task 0 and needs `backend/openapi/v1.json` from Task 15 of this plan.
- Worktree: continue in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-backend` (branch `feat/internal-links-backend`) after plan 02 merged; or, if that worktree is gone, cut a new one with:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform
git fetch origin
git worktree add .claude/worktrees/internal-links-backend-2 -b feat/internal-links-backend-2 origin/develop
```

Paths below are relative to the worktree. Work merges into `develop`, never `main` (AGENTS.md).

- Every backend command runs in `backend/` with the Colima variables set:

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend
```

- The gate at the end of every task (a partial pytest run takes `--no-cov`):

```bash
uv run ruff check --fix . && uv run ruff format .
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # N files already formatted
uv run mypy                    # Success: no issues found in N source files
uv run lint-imports            # Contracts: N kept, 0 broken.
```

- Files this plan never touches: anything under `apps/web/` (plan 05 regenerates `apps/web/src/lib/api/schema.ts` in its own commit), `infra/`, `docs/ops/`, the design preview, and every file another session has uncommitted in the main checkout. Every commit names its files; never `git add -A` or `git add .`. No attribution lines in commit messages. No em or en dashes in code comments, messages or docs.
- Shared files this plan changes and other tracks also change: `backend/openapi/v1.json`, `backend/src/idraft/db/tables.py`, `backend/src/idraft/api/main.py`, `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/audit.py`, `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`, `backend/tests/db/support.py`, `backend/tests/db/test_grants.py`, `backend/src/idraft/worker/assembly.py`, `backend/src/idraft/collectors/gsc_sync.py` and `gsc_store.py` (Search Console owner). Rebase on `develop` before each merge and regenerate `backend/openapi/v1.json` after a rebase that touched routes. If another branch has taken revision `0026`, renumber the migration to the next free number and set `down_revision` to the new head; nothing else depends on the number.

---

## Decisions

Each is a choice the spec left open or that the code forced. "Why" follows.

- **D1. Extras are computed after the crawl is `ready`, by a second job.** `crawl_ingest` ends in one transaction that flips the run to `ready`, applies rules and recomputes the tier flow (plan 02 Task 11). Adding a link diff over two 600,000 row partitions, a mention scan that reads raw HTML from R2 and an alert there would lengthen that transaction and make a failure in an extra fail a crawl that is good. So `crawl_enrich` (new job, queue `process`) runs for runs in a data state whose `enrich_state` is `pending` or `running`, in phases `changes`, `anchors`, `mentions`, `done`, each phase one resumable step, five failures end it as `failed` and leave the crawl as it is. The crawl tick sends the job, as it sends `crawl_ingest`.
- **D2. Differences between crawls are stored per run, because link partitions are dropped.** Plan 02 keeps the links of the last 4 finished crawls (D8 there). A crawl's change against its predecessor needs the predecessor's links, so the diff is made once, while both partitions exist (the predecessor is always one of the last 4), and stored in `seo.crawl_link_changes` (one row per source and target pair that was lost or added, per link scope in `editorial` and `all`, the two scopes the Changes tab offers) and `seo.crawl_page_changes` (one row per page whose editorial links in, equity share or depth changed, or that is new). A page without a row did not change. Target tiers are not stored: the Priority cell and the "lost to T1 and T2" counts join `core.project_pages` when read, so a tier change moves them, as in the mock (`lostToTop` reads `tierIdOf`).
- **D3. "Lost" is per pair and scope, as the mock defines it.** A pair is lost in a scope when the previous crawl had at least one link from the source to the target in that scope and this crawl has none in that scope. `still_linked_by` is the placement of another link that still joins the pair in this crawl (for example `navigation`), or null. For scope `all` it is always null. A page is "added" when it is in this crawl and not in the previous one; "lost" when the reverse. Equity change is in points (`round((now - before) x 1000) / 10`, one decimal). Depth change is a number of levels (negative is shallower); `found` and `lost` when only one of the two crawls reaches the page.
- **D4. The alert is a record plus a derived banner.** `seo.crawl_alerts` holds one row per run that raised an alert, written by `crawl_enrich` with the settings of that moment (count, important tiers, threshold, channel, delivery state). The banner and the tab badge use the live numbers (`changes/summary`), because tiers can change after the crawl, exactly as the mock derives `alertsFor`. Only the record is used to decide that a delivery happened once.
- **D5. Delivery is in the app only, and no channel is invented.** The repository has no email sender, no webhook delivery and no notification table: `api/alerts/routes.py` is an empty router that the AI visibility package WP-47 fills (tables `ops.alert_rules`, `ops.alert_events`, digests, webhooks are in doc 04 section 11.5 and are not migrated). The channel setting accepts `app`, `email` and `slack` in the contract so the web contract does not change later; the API refuses `email` and `slack` with `422 validation_failed` (`channel_unavailable`) until WP-47 is merged, and `delivery_state` on the record is `shown_in_app` or `channel_unavailable`. Task 6 leaves one function, `deliver_alert`, as the only place that would hand the record to the alerts service. Open point O2.
- **D6. Alert settings live in the project settings.** `internal_links.alerts = {enabled, max_position, threshold, channel}` (defaults on, 2, 1, `app`), merged by the existing settings patch. No `ops.alert_rules` row, because those tables do not exist yet. `max_position` 1 means T1 only, 2 means T1 and T2; the contract allows 1 to 8, the web offers 1 and 2 (spec 7.10).
- **D7. Rank, citations, anchors and Search Console numbers are read live for the rows shown, never stored per crawl.** The Pages tab asks with `include=` (`changes`, `keywords`, `citations`, `anchors`, `gsc`) and gets `PageRow.extras`; each part is one grouped query over the rows of the page being read (at most 200), as plan 02 D10 does for "linked from tiers". An older crawl shows today's rank and citations (the mock does the same: `keywords` and `citations` do not depend on the crawl). Only what the crawl itself decides is stored: link and page changes, the editorial anchor counts that drive a flag, mentions.
- **D8. Which tracked keywords belong to a page.** A tracked keyword (`seo.tracked_keywords`, active, not deleted, same project) belongs to a page when its `target_url_id` is the page, or when it has no target and `seo.tracked_keyword_state.current_url_id` is the page. Several tracked keywords of one keyword (devices, locations) count once: the row with the best current rank, or any when none ranks. Rank is `current_rank` (null when not in the depth checked), `change` is `rank_change` (previous minus current, positive is improved, doc 04 section 7), volume is `seo.keyword_metrics_current.search_volume` of source `dataforseo_labs` for the keyword's location and language (`api/keywords/repository.py` `LABS`). Average rank is the mean of the ranking rows, one decimal, null when none ranks.
- **D9. AI citations.** `ai.citations` rows of the project with `url_id` equal to the page, `domain_role = 'own'`, whose answer (`ai.observations`, same id and `observed_at`) is not superseded (`superseded_by IS NULL`), in the last 28 days, counted as distinct answers per engine: `chatgpt_web`, `gemini_web`, `google_ai_mode` (migration 0018). The index `citations_url_observed (url_id, observed_at)` serves the lookup; every query also names the workspace and the project.
- **D10. Search Console has no page numbers today, so this plan adds them.** The pull of `fp.gsc_search_analytics` was changed on 2026-11-05 to run without the page dimension (`domain/gsc_pull.py`: version 2; every row has `url_id = 0`), because summing pages overstates impressions. Plan 02 D21 assumed otherwise. Clicks per page (columns, tier suggestions, the "has clicks but no link" orphan rule) therefore need a new store, `fp.gsc_page_daily` (one row per property, day and page: clicks, impressions, web search type, final days only), filled by one extra call per day (`[date, page]`) in the existing pull (Task 8). The Pages tab says "Google data, last 28 days" and shows the state from `api/keywords/gsc_repository.scope_of` (`not_connected`, `pending`, `ok`). Open point O1 asks the owner to confirm that the extra call is acceptable.
- **D11. Mentions are found while reading stored HTML, with a word index, not a regex per phrase.** A source page mentions a target when its visible text (text of `main` or `article` when present, otherwise of the body, leaving out text inside links, scripts, navigation, header, footer, aside and forms) holds one of the target's phrases: the target's tracked keywords (D8) and the anchors that at least 2 other pages use to link to it by editorial links, minus the generic anchors. Phrases are 1 to 5 words, at least 3 characters, not all digits. The scan lowercases the words of a page, builds every 1 to 5 word run and looks each up in a dictionary of all phrases, so a page costs time in proportion to its length, not to the number of phrases. One mention per (source, target) is stored, keyword phrases before anchor phrases, with the sentence around it. The mock's `mentions` are sample data; this is the real feature (spec 7.10).
- **D12. A mention stops being an opportunity the moment an editorial link exists.** `crawl_mentions` is per run and holds every mention found; the list drops a pair when `crawl_links` of that run has an editorial link from source to target (so the list is right even though mentions were found before). Only pages reachable from the start page (`click_depth IS NOT NULL`), live (200) and indexable are sources; targets are live and indexable pages (spec 7.10: "Only pages reachable from the home page are sources, because a link from an unreachable page passes no equity").
- **D13. Decisions belong to the project, not to a crawl.** `core.link_opportunity_decisions (project, source url, target url, status accepted or dismissed)`; "open" is no row. `core.tier_suggestion_dismissals (project, url)`. Accepting a tier suggestion is a normal manual tier change through `PageTierService.set_tiers` (plan 02 Task 6): one write path, one audit entry, the same tier flow recompute.
- **D14. The path finder reads level by level, not the whole graph.** A route from the start page to a page is found by a breadth-first search that asks the database for the links of the current frontier only (`source_url_id = ANY(frontier)`, one query per level, at most 12 levels). It never holds the 600,000 links of a large site in memory. Nofollow links are not followed; a redirect page's only step is its target (anchor `301 redirect`); among several links between the same two pages the first by scope order (editorial, auto-generated, template) is the step. Two searches: every followed link, and editorial links only (redirects always followed). The note "menus make the page closer" is the two lengths, sent as numbers.
- **D15. Older crawls.** Every read already takes `run`. This plan adds three rules. (a) `GET link-crawls` says per crawl whether its links are still kept (`links_available`, false once `links_dropped_at` is set, which happens past the last 4 finished crawls); page level numbers of a crawl without links stay readable, link level reads (edges, neighbors, path, changes links, opportunities) answer `410 links_dropped`. (b) The tier flow of a crawl that is not the latest is computed when read from today's tiers (the stored rows are those of the day the crawl was the latest) when its links are kept and it has at most `INLINE_FLOW_LINKS` links; otherwise the stored rows are returned with `stale = true`. (c) `Changes` of an older crawl are the stored diff of that crawl against its own predecessor.
- **D16. The client summary needs no endpoint.** Spec 7.10 and the mock build it in the browser from the tier flow, worklists and lost links; plan 05 does the same from endpoints that exist. Nothing is added here for it except `worklists` counts and `changes/links?only=top`.
- **D17. Paging of the new lists is by `offset` and `limit`.** Changes lists, opportunities and tier suggestions are bounded (a crawl's changes are capped at `CHANGES_MAX` rows per run and scope, 200,000, with a flag when the cap cut it), sorted by a priority that is computed by joins, and read with the filters on screen. Keyset cursors would carry five sort keys for no gain; `limit` is at most 200 and `offset` at most 100,000. The Pages list keeps its cursors.
- **D18. Permissions map onto existing keys.** Reads: `data:read`. Alert settings: the existing settings route (`projects:write`). Opportunity and tier suggestion decisions: `projects:write` (owner, admin, editor). Nothing new in `permissions.ts`.
- **D19. Performance for 50,000 pages.** The diff is SQL over two partitions with `DISTINCT ON` per pair (about 600,000 rows each) and runs in one statement per scope under `SET LOCAL statement_timeout = '5min'`; the existing indexes `(run_id, source_url_id, scope)` and `(run_id, target_url_id, scope)` serve the lookups. The mention scan reads 25 pages per step from R2 (HTML is compressed, a page is about 100 KB), keeps one step under 6 minutes and checkpoints `enrich_offset`. `fp.gsc_page_daily` is pruned to 35 days. The extras are bounded by the 200 rows of a page of the list.

## Dependencies between tasks

| Task | What | Can start | Waits for |
|---|---|---|---|
| 0 | Check slice 1 as built and set up | At once | Plan 02 merged |
| 1 | Migration 0026, tables, grants | After 0 | 0 |
| 2 | Pure rules: anchors and change classification | After 0 | 0 |
| 3 | Pure shortest route | After 0 | 0 |
| 4 | Pure tier suggestions | After 0 | 0 |
| 5 | Pure mentions | After 0 | 0 |
| 6 | `crawl_enrich`: changes, alert, anchors, worker wiring | After 1, 2 | 1, 2 |
| 7 | `crawl_enrich`: mentions | After 5, 6 | 5, 6 |
| 8 | Search Console page totals | After 1 | 1 |
| 9 | Crawl list for the picker, older crawls | After 1 | 1 |
| 10 | Changes API and alert settings | After 6, 9 | 6, 9 |
| 11 | Page extras, flags and worklists | After 6, 8, 2 | 6, 8, 2 |
| 12 | Opportunities API | After 7, 9 | 7, 9 |
| 13 | Tier suggestions API | After 4, 8 | 4, 8 |
| 14 | Path finder API | After 3, 9 | 3, 9 |
| 15 | Contract check and hand-over to plan 05 | After 10 to 14 | Those |
| 16 | Acceptance on a real crawl | Last | All, and a crawl |

Tasks 2 to 5 can run in parallel at once; 8 and 9 in parallel with 6.

## File map

| File | Task | What it holds |
|---|---|---|
| `backend/src/idraft/db/migrations/versions/0026_internal_links_changes.py` | 1 | The migration |
| `backend/src/idraft/db/tables.py` | 1 | Nine new `Table` objects, new columns |
| `backend/tests/db/support.py`, `test_grants.py`, `test_internal_links_changes_schema.py` | 1 | Schema tests |
| `backend/src/idraft/crawl/anchors.py`, `changes.py` | 2 | Anchor statistics, change classification, alert settings |
| `backend/src/idraft/crawl/paths.py` | 3 | Route rebuild from a search |
| `backend/src/idraft/crawl/suggest.py` | 4 | Tier suggestion rules |
| `backend/src/idraft/crawl/mentions.py` | 5 | Visible text, phrase index, mentions |
| `backend/src/idraft/collectors/crawl_enrich.py` | 6, 7 | The `crawl_enrich` job |
| `backend/src/idraft/collectors/crawl_runs.py`, `worker/assembly.py` | 6 | Tick sends the job; handler registered |
| `backend/src/idraft/collectors/gsc_pages.py`, `gsc_sync.py`, `gsc_store.py` | 8 | Page totals pull and store |
| `backend/src/idraft/collectors/crawl_store.py` | 9 | Read-only tier flow |
| `backend/src/idraft/api/internal_links/crawls.py`, `page_tiers.py`, `reads.py`, `problems.py` | 9 | Picker fields, `links_dropped` |
| `backend/src/idraft/api/schemas/internal_links_extra.py` | 9 to 14 | Request and response models of this plan |
| `backend/src/idraft/api/internal_links/changes.py`, `change_routes.py` | 10 | Changes reads |
| `backend/src/idraft/api/schemas/operations.py`, `api/operations/settings.py` | 10 | `internal_links.alerts` |
| `backend/src/idraft/api/internal_links/extras.py`, `page_filter.py`, `reads.py` | 11 | Page extras, flags, worklists |
| `backend/src/idraft/api/internal_links/opportunities.py`, `opportunity_routes.py` | 12 | Opportunities |
| `backend/src/idraft/api/internal_links/suggestions.py`, `suggestion_routes.py` | 13 | Tier suggestions |
| `backend/src/idraft/api/internal_links/route_finder.py`, `path_routes.py` | 14 | Path finder |
| `backend/src/idraft/api/audit.py`, `resources.py`, `main.py` | 10 to 14 | Wiring |
| `backend/tests/api/internal_links/support_changes.py` | 6 | Seeds for two crawls and their extras |
| `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`, `backend/openapi/v1.json` | 10 to 15 | Route table, isolation, contract |

## Names

Other tasks and plan 05 depend on these. Signatures are exact.

**Database (migration `0026_internal_links_changes.py`, `revision = "0026"`, `down_revision = "0025"`)**

- `seo.crawl_runs` new columns: `previous_run_id uuid`, `enrich_state text` (`pending`, `running`, `done`, `failed`; default `pending`), `enrich_phase text` (`changes`, `anchors`, `mentions`, `done`), `enrich_failures smallint`, `enrich_offset integer`.
- `seo.crawl_pages` new columns: `editorial_anchors integer`, `generic_anchors integer` (both `NOT NULL DEFAULT 0`).
- `seo.crawl_link_changes (run_id, workspace_id, change, scope, source_url_id, target_url_id, placement, anchor, still_linked_by)`, primary key `(run_id, change, scope, source_url_id, target_url_id)`.
- `seo.crawl_page_changes (run_id, workspace_id, url_id, is_new, editorial_in_delta, equity_points, depth_state, depth_delta)`, primary key `(run_id, url_id)`.
- `seo.crawl_alerts (run_id, workspace_id, project_id, lost_links, max_position, threshold, channel, delivery_state, created_at)`, primary key `(run_id)`.
- `seo.crawl_mentions (run_id, workspace_id, source_url_id, target_url_id, phrase, context, origin)`, primary key `(run_id, source_url_id, target_url_id)`.
- `core.link_opportunity_decisions (project_id, workspace_id, source_url_id, target_url_id, status, decided_by, decided_at)`, primary key `(project_id, source_url_id, target_url_id)`.
- `core.tier_suggestion_dismissals (project_id, workspace_id, url_id, dismissed_by, dismissed_at)`, primary key `(project_id, url_id)`.
- `fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, project_id, clicks, impressions, ingested_at)`, primary key `(integration_id, metric_date, url_id)`.

**`idraft.db.tables`**: `crawl_link_changes`, `crawl_page_changes`, `crawl_alerts`, `crawl_mentions`, `link_opportunity_decisions`, `tier_suggestion_dismissals`, `gsc_page_daily`, and the new columns on `crawl_runs` and `crawl_pages`.

**`idraft.crawl`** (pure)

- `anchors`: `GENERIC_ANCHORS: Final[frozenset[str]]`, `GENERIC_SHARE_MIN = 0.5`, `GENERIC_MIN_LINKS = 2`, `clean_anchor(text: str) -> str`, `is_generic(text: str) -> bool`, `AnchorGroup(text, count, generic)`, `AnchorStats(total, distinct, generic_count, generic_share, top, matches_keyword)`, `anchor_stats(anchors: Iterable[str], keywords: Sequence[str], *, limit: int = 5) -> AnchorStats`, `mostly_generic(total: int, generic: int) -> bool`.
- `changes`: `Priority = Literal["lost_to_t1", "lost_to_t2", "lower"]`, `priority_of(position: int | None) -> Priority`, `is_top(position: int | None, max_position: int) -> bool`, `equity_points(now: float | None, before: float | None) -> float`, `depth_change(was: int | None, now: int | None) -> tuple[Literal["lost", "found"] | None, int | None]`, `AlertSettings(enabled, max_position, threshold, channel)`, `alert_settings(stored: Mapping[str, Any] | None) -> AlertSettings`, `alert_due(lost_to_top: int, settings: AlertSettings) -> bool`, `CHANNELS`, `CHANGES_MAX = 200_000`.
- `paths`: `Hop(source, target, anchor, placement, scope)`, `Step(url_id, hop)`, `rebuild_route(parents: Mapping[int, Hop], start: int, target: int) -> list[Step] | None`, `MAX_LEVELS = 12`.
- `suggest`: `KeywordHit(keyword, rank, volume)`, `SuggestPage(url_id, tier_position, manual, clicks, hits)`, `Reason(kind, clicks, rank, keyword, volume)`, `TierSuggestion(url_id, to_position, reasons)`, `suggest_tiers(pages: Sequence[SuggestPage], *, tiers: int, dismissed: AbstractSet[int]) -> list[TierSuggestion]`, constants `BUSIEST_SHARE = 0.2`, `RANK_MAX = 5`, `VOLUME_MIN = 2_000`, `THIRD_TIER_CLICKS = 50`.
- `mentions`: `visible_text(html: str) -> str`, `phrase_key(phrase: str) -> str | None`, `PhraseIndex = dict[str, list[tuple[int, str]]]` (key to `(target_url_id, origin)`), `index_phrases(targets: Mapping[int, PhraseSet]) -> PhraseIndex`, `PhraseSet(keywords, anchors)`, `Mention(target_url_id, phrase, context, origin)`, `find_mentions(text: str, index: PhraseIndex, *, source_url_id: int, skip: AbstractSet[int], limit: int = MENTIONS_PER_PAGE) -> list[Mention]`.

**Collectors**

- `crawl_enrich`: `ENRICH_JOB = "crawl_enrich"`, `ENRICH_PASS_TIME`, `ENRICH_FAILURES_MAX = 5`, `MENTION_PAGES_PER_STEP = 25`, `CrawlEnrichTask(workspace_id, run_id)` with `dedupe_key`, `EnrichOutcome`, `enrich_run(sessions, store, task, *, deadline) -> EnrichOutcome`, `deliver_alert(db, *, run_id, record) -> str`.
- `gsc_pages`: `PAGE_DAYS = 28`, `PAGE_KEEP_DAYS = 35`, `PageDayRow(url_hash, clicks, impressions)`, `page_day_rows(rows: Sequence[AnalyticsRow], day: date) -> tuple[list[PageDayRow], int]`, `replace_page_day(db, facts, day, rows) -> int`, `stored_page_days(db, facts, start, end) -> set[date]`, `prune_pages(db, facts, before) -> None`, `page_clicks(db, workspace_id, project_id, integration_id, window) -> dict[int, PageClicks]`.
- `crawl_store`: `flow_rows(db, *, workspace_id, run_id) -> FlowRows` (read-only tier flow).

**API**: `ChangeService` (`Resources.link_changes`), `OpportunityService` (`Resources.link_opportunities`), `SuggestionService` (`Resources.tier_suggestions`), `RouteFinder` (`Resources.route_finder`); the pages list takes `include`. Problems: `LinksDroppedError` (410 `links_dropped`). Audit actions: `link_opportunity.decided`, `tier_suggestion.dismissed` (accepting a suggestion is a manual tier change and writes `page_tiers.changed`).

## Row-level security and permissions

- Every new table carries `workspace_id` with the `tenant_isolation` policy and every key between tenant tables includes `workspace_id` (`tests/db/test_rls.py` reads the catalog). The worker bypasses row-level security, so every worker statement names the workspace or the run.
- One workspace never reads another's changes, alerts, mentions, decisions, suggestions or page totals: Task 1 proves it table by table, and Tasks 10 to 14 prove it through the routes (cross-tenant cases listed in each task, added to `tests/security/test_cross_tenant.py`).
- `core.urls` is shared by every workspace. As in plan 02, no query here starts from a URL id: every read starts from a row of the crawl in scope (`seo.crawl_pages`, `seo.crawl_mentions`, `seo.crawl_link_changes` of the run, which is checked against project and workspace first) and reaches a URL only through it. Page totals from Search Console are joined by `integration_id` of the project's own property and `project_id`.

| Action | Permission | Roles |
|---|---|---|
| Read changes, extras, opportunities, suggestions, paths, crawl list | `data:read` | owner, admin, editor, analyst, viewer |
| Accept, dismiss or reopen opportunities; accept or dismiss tier suggestions | `projects:write` | owner, admin, editor |
| Change alert settings | `projects:write` (settings route) | owner, admin, editor |

| Table | `app_api` | `app_worker` |
|---|---|---|
| `seo.crawl_link_changes`, `seo.crawl_page_changes` | SELECT | SELECT, INSERT, DELETE |
| `seo.crawl_alerts` | SELECT | SELECT, INSERT, DELETE |
| `seo.crawl_mentions` | SELECT | SELECT, INSERT, DELETE |
| `core.link_opportunity_decisions` | SELECT, INSERT, DELETE; UPDATE (status, decided_by, decided_at) | none |
| `core.tier_suggestion_dismissals` | SELECT, INSERT, DELETE | none |
| `fp.gsc_page_daily` | SELECT | SELECT, INSERT, DELETE |
| `seo.crawl_runs` new columns | none new | UPDATE (`previous_run_id`, `enrich_state`, `enrich_phase`, `enrich_failures`, `enrich_offset`) |
| `seo.crawl_pages` new columns | none | UPDATE (`editorial_anchors`, `generic_anchors`) |

## API contract

`{W}` is `/api/v1/workspaces/{workspace_id}`, `{P}` is `{W}/projects/{project_id}`, `{L}` is `{P}/internal-links`. Ids are UUID strings except `url_id`, a 64-bit integer sent as a string (plan 02). `run` is `latest` (default) or a crawl id; `scope` is `editorial` (default), `auto_generated`, `template` or `all`. Unknown query parameters are `422`.

| Method and path | Permission | Query or body | Response |
|---|---|---|---|
| `GET {P}/link-crawls`, `GET {P}/link-crawls/{id}` | data:read | as plan 02 | `CrawlRun` gains `links_available`, `previous_run_id`, `enrich_state` |
| `GET {L}/changes/summary` | data:read | `run` | `ChangesSummaryResponse {data: ChangesSummary}` |
| `GET {L}/changes/links` | data:read | `run`, `change` (`lost`, `added`), `link_scope` (`editorial`, `all`; default `editorial`), `only` (`top`, `all`; default `all`), `offset`, `limit` (50, max 200), `format` (`json`, `csv`) | `ChangeLinkPage {data: ChangeLink[], meta: ChangeLinkMeta}`, or `text/csv` |
| `GET {L}/changes/pages` | data:read | `run`, `limit` (8, max 50) | `MovedPageList {data: MovedPage[], meta: {run_id, previous_run_id}}` |
| `GET {L}/pages` | data:read | as plan 02, plus `include` (comma list of `changes`, `keywords`, `citations`, `anchors`, `gsc`), `filter[flags]` gains `generic_anchors`, `filter[worklist]` gains `lost_links_top`, `weak_outlinks`, `sort` gains `change`, `-change` | `PageRow.extras: PageExtras \| null` (set when `include` is given); `meta.links_available` |
| `GET {L}/pages/{url_id}` | data:read | `run`, `scope` | `PageDetail.extras: PageDetailExtras` (always) |
| `GET {L}/worklists` | data:read | `run` | `Worklists` gains `lost_links_top`, `weak_outlinks` |
| `GET {L}/opportunities` | data:read | `run`, `status` (`open`, `accepted`, `dismissed`), `filter[target_tier]` (position 1 to 8, or `none`), `q`, `offset`, `limit`, `format` (`json`, `csv`), `export` (`planned`: CSV of accepted rows, or of open rows when none is accepted) | `OpportunityPage {data: Opportunity[], meta: OpportunityMeta}`, or `text/csv` |
| `PUT {L}/opportunities/decisions` | projects:write | `OpportunityDecisions {items: {source_url_id, target_url_id}[] (1..500), status: accepted \| dismissed \| open}` | `DecisionResponse {data: {matched, changed}}` |
| `GET {L}/tier-suggestions` | data:read | none | `TierSuggestionList {data: TierSuggestionRow[], meta: {gsc_state, run_id}}` |
| `POST {L}/tier-suggestions/accept` | projects:write | `SuggestionSelection {url_ids?: string[] (1..500), all?: true}` | `BulkResponse {data: {matched, changed}}` |
| `POST {L}/tier-suggestions/dismiss` | projects:write | `SuggestionSelection` | `BulkResponse` |
| `GET {L}/paths` | data:read | `run`, `url_id` (required) | `RoutesResponse {data: Routes}` |
| `GET/PATCH {P}/settings` | data:read, projects:write | `internal_links.alerts` | `InternalLinksSettings.alerts` |

Response models (every field always present; `null` where shown):

- `ChangesSummary {run_id, previous_run_id (or null), previous_finished_at (or null), state ("first_crawl","pending","ready"), editorial_lost, editorial_added, all_lost, all_added, lost_to_top, important_max_position, pages_added, pages_lost, alert: ChangeAlert or null}` and `ChangeAlert {lost_links, max_position, threshold, channel, delivery_state}`. `state` is `pending` until the `changes` phase of the run's enrichment is done, and `unavailable` after five failed passes. `alert` is set when alerts are enabled and `lost_to_top >= threshold`.
- `ChangeLink {source: ChangePage, target: ChangePage, anchor, placement, priority ("lost_to_t1","lost_to_t2","lower","none"), still_linked_by (placement or null)}`, `ChangePage {url_id, url, path, tier: TierRef or null}`. `priority` is `none` for added links.
- `ChangeLinkMeta {run_id, previous_run_id, change, link_scope, only, total, truncated}`.
- `MovedPage {page: ChangePage, editorial_in, editorial_in_delta, equity_points, depth, depth_state ("lost","found" or null), depth_delta (or null)}`.
- `PageExtras {change: PageChange or null, keywords: KeywordSummary or null, citations: CitationCounts or null, anchors: AnchorSummary or null, gsc: GscPage or null}`; each part is null when not asked for. `PageChange {is_new, editorial_in_delta (or null), equity_points (or null), depth_state (or null), depth_delta (or null)}`. `KeywordSummary {tracked, ranking, average_rank (or null), best_volume (or null)}`. `CitationCounts {chatgpt, gemini, ai_mode, total}`. `AnchorSummary {total, distinct, generic, generic_share, matches_keyword (bool or null)}`. `GscPage {state ("ok","pending","not_connected"), clicks (or null), impressions (or null), window_start, window_end}`.
- `PageDetailExtras {change: PageChange or null, keywords: KeywordRow[], citations: CitationCounts, anchors: AnchorDetail, gsc: GscPage}`; `KeywordRow {keyword, rank (or null), change (or null), volume (or null)}`; `AnchorDetail {total, distinct, generic, generic_share, matches_keyword, top: [{text, count, generic}]}`.
- `Opportunity {key, source: ChangePage, source_tier, target: ChangePage, phrase, context, anchor, source_equity_share, status, origin ("keyword","anchor")}` where `key` is `"{source_url_id}>{target_url_id}"`; `OpportunityMeta {run_id, total, counts: {open, accepted, dismissed}}`.
- `TierSuggestionRow {url_id, url, path, title, from_tier: TierRef or null, to_tier: TierRef, reasons: [{kind ("clicks","rank"), clicks, rank, keyword, volume}]}`.
- `Routes {target: ChangePage, any: Route or null, editorial: Route or null}`, `Route {clicks, steps: [{page: ChangePage, tier, status_code, anchor (or null), placement (or null), scope (or null), via_redirect}]}`.
- `InternalLinksSettings.alerts = {enabled: bool = true, max_position: 1..8 = 2, threshold: 1..50 = 1, channel: "app" | "email" | "slack" = "app"}`; `email` and `slack` are refused until the alerts service exists (D5).

## Errors and states

| Case | Backend behaviour | What the API says |
|---|---|---|
| First crawl, no earlier one | `previous_run_id` null, no diff | `changes/summary.state = "first_crawl"`; lists are empty |
| Enrichment not done | `enrich_state` `pending` or `running` | `state = "pending"`; extras that need it answer empty |
| Enrichment failed five times | `enrich_state = 'failed'`; the crawl stays usable | `CrawlRun.enrich_state = "failed"`; the web says changes are unavailable for this crawl |
| Older crawl whose links were dropped | Pages stay, links gone | `410 links_dropped` on link level reads; `links_available = false` |
| Search Console not connected, pull not done, or no page day stored in the window | No page totals | `gsc.state` `not_connected` or `pending` (`ok` needs one row of `fp.gsc_page_daily` in the window); clicks null; tier suggestions use rank only |
| No tracked keywords for a page | `keywords.tracked = 0` | counts are 0, average rank null |
| Opportunity pair the list no longer shows (accept, dismiss) | Decision not stored | in neither `matched` nor `changed`; `matched` is the number of submitted pairs that qualified, `changed` the number whose stored state changed |
| Opportunity pair with a stored decision that left the list (undo) | Decision deleted | counted in `matched` and `changed` |
| Crawl whose links are gone | `anchors` extra null in the list; the detail keeps the stored counts, `distinct`, `top` and `matches_keyword` null | `weak_outlinks` filter `410 links_dropped`, its worklist count 0 |
| Alert channel `email` or `slack` | Refused at the settings patch | `422 validation_failed` `channel_unavailable` |

## Open points for the owner

- **O1. Search Console per page.** The product pulls Search Console without the page dimension on purpose (impressions overstate when pages are summed). Page clicks need one more call per day, `[date, page]`, stored apart. It costs one extra call per property per day plus 28 calls once, within the existing budgets (`gsc_limits`). Recommendation: accept. Without it the clicks columns and the click rule of tier suggestions stay empty, and orphans stay sitemap orphans (plan 02 D21).
- **O2. Alert delivery by email and Slack.** The repository has no channel that can send either. WP-47 (alerts backend, not started) is planned to build rules, events, digests and webhooks. Recommendation: ship the in-app alert now (D5) and connect email and Slack when WP-47 is on `develop`, by making `deliver_alert` write an `ops.alert_events` row. The owner confirms that order.
- **O3. Rank columns on older crawls.** Rank and citations are today's, whichever crawl is open (D7). The alternative is a snapshot per crawl, which stores two more numbers per page per crawl and changes nothing on screen for the latest crawl. Recommendation: today's numbers.
- **O4. Mention sources.** The phrase sources are tracked keywords and the anchors other pages use (D11). Page titles, headings and Search Console queries are not used. Recommendation: judge the real list on the acceptance crawl (Task 16) before widening it.
- **O5. Orphans from Search Console.** With page totals (D10) a page with clicks in 28 days that no crawled page links to could join the orphan worklist. It needs a page that is not in the crawl, which the pages list has no row for. Left out; this plan does not change the orphan definition.
- **O6. Pages that moved most is capped at 8 in the mock.** The endpoint takes `limit` up to 50; the web shows 8.
- **O7. "First seen" on the Links tab.** The mock shows "First seen" and "Lost on" per link across all crawls. This plan stores the difference against the previous crawl only, so the real Links tab shows "Added" and "Lost" for the crawl in view and the Status menu (Active, Lost since last crawl, All) from `changes/links`. A true first-seen date per pair needs a record that outlives the dropped partitions (one row per pair ever seen, about the size of the links of the latest crawl). Recommendation: accept the one-crawl version for the release and add the record only if clients ask.

---

### Task 0: Check slice 1 as built and set up

**Files:**
- Modify: this plan, only where a check below says so.

- [ ] **Step 1: Read what slice 1 built**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-backend
git fetch origin && git log --oneline -5 && git status --short | head
ls backend/src/idraft/db/migrations/versions | tail -3
grep -n "reads.py\|crawl_ingest.py\|crawl_runs.py" -r backend/src/idraft/api/internal_links/__init__.py || true
```

Expected: migrations end at `0025_internal_links.py` (if `0026` exists already, renumber this plan's migration as the file map says), and the files `reads.py`, `crawl_ingest.py`, `crawl_runs.py`, `crawl_store.py`, `page_tiers.py` exist.

- [ ] **Step 2: Confirm the names this plan relies on**

```bash
cd backend
grep -n "def apply_rules\|def recompute_tier_flow\|def latest_run\|INLINE_FLOW_LINKS\|DATA_STATES" src/idraft/collectors/crawl_store.py
grep -n "class PageScope" -A8 src/idraft/api/internal_links/page_filter.py
grep -n "async def set_tiers" src/idraft/api/internal_links/page_tiers.py
grep -n "def scope_of" src/idraft/api/keywords/gsc_repository.py
grep -n "WINDOW_DAYS\|ALL_PAGES" src/idraft/domain/gsc_pull.py
grep -n "ai.citations\|citations_url_observed" src/idraft/db/migrations/versions/0018_ai_prompts.py | head -3
```

Expected: every name prints. If one is missing, stop and report it; do not invent a replacement.

- [ ] **Step 3: Baseline**

```bash
uv sync --frozen && ./check.sh
```

Expected: ruff, format, mypy, import contracts and pytest pass.

- [ ] **Step 4: Commit nothing.** This task changes no file unless a name differs; if so, fix the plan text and commit with `git add docs/superpowers/plans/2026-11-17-internal-links-04-backend-slices-2-3.md && git commit -m "Internal links plan 04: slice 1 as built"`.

---
### Task 1: Migration 0026 and table metadata

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0026_internal_links_changes.py`
- Modify: `backend/src/idraft/db/tables.py` (seven tables after `crawl_tier_stats`, new columns on `crawl_runs` and `crawl_pages`)
- Modify: `backend/tests/db/support.py` (`TENANT_TABLES`, `seed_internal_links`, the Search Console seed)
- Create: `backend/tests/db/test_internal_links_changes_schema.py`

**Read first:** `backend/src/idraft/db/migrations/versions/0025_internal_links.py` (the helpers `statements`, `tenant_isolation`, `grants`, `column_grant`, how the tables, grants and downgrade are laid out), `backend/src/idraft/db/tables.py` (the `crawl_runs` and `crawl_pages` definitions and `gsc_search_analytics`), `backend/tests/db/test_internal_links_schema.py`, `backend/tests/db/support.py` (`TENANT_TABLES`, `seed_internal_links`).

- [ ] **Step 1: Write the failing schema test**

Create `backend/tests/db/test_internal_links_changes_schema.py`:

```python
"""Migration 0026: crawl changes, alerts, mentions, decisions and Search Console page totals
(plan 04 Task 1)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, seed_tenant

NEW_TABLES = (
    "seo.crawl_link_changes",
    "seo.crawl_page_changes",
    "seo.crawl_alerts",
    "seo.crawl_mentions",
    "core.link_opportunity_decisions",
    "core.tier_suggestion_dismissals",
    "fp.gsc_page_daily",
)


async def test_every_new_table_has_row_level_security(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        for table in NEW_TABLES:
            schema, name = table.split(".")
            row = await db.fetchrow(
                "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = $1 AND c.relname = $2",
                schema,
                name,
            )
            assert row is not None, table
            assert row["relrowsecurity"] and row["relforcerowsecurity"], table


async def test_new_run_columns_start_pending_and_zero(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "enrich")
    async with connection(migrated) as db:
        row = await db.fetchrow(
            "SELECT enrich_state, enrich_phase, enrich_failures, enrich_offset, previous_run_id "
            "FROM seo.crawl_runs WHERE workspace_id = $1 LIMIT 1",
            tenant.workspace_id,
        )
    assert row is not None
    assert (row["enrich_state"], row["enrich_failures"], row["enrich_offset"]) == ("pending", 0, 0)
    assert row["enrich_phase"] is None and row["previous_run_id"] is None


async def test_a_change_is_lost_or_added_in_the_editorial_or_the_all_scope(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "changes")
    async with connection(migrated) as db:
        run = await db.fetchval(
            "SELECT id FROM seo.crawl_runs WHERE workspace_id = $1 LIMIT 1", tenant.workspace_id
        )
        for change, scope in (("moved", "editorial"), ("lost", "template")):
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(
                    "INSERT INTO seo.crawl_link_changes (run_id, workspace_id, change, scope, "
                    "source_url_id, target_url_id) VALUES ($1, $2, $3, $4, 1, 2)",
                    run,
                    tenant.workspace_id,
                    change,
                    scope,
                )


async def test_a_decision_is_accepted_or_dismissed_and_one_per_pair(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "decide")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, "
                "source_url_id, target_url_id, status) VALUES ($1, $2, 1, 2, 'open')",
                tenant.project_id,
                tenant.workspace_id,
            )
        await db.execute(
            "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, "
            "source_url_id, target_url_id, status) VALUES ($1, $2, 1, 2, 'accepted')",
            tenant.project_id,
            tenant.workspace_id,
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, "
                "source_url_id, target_url_id, status) VALUES ($1, $2, 1, 2, 'dismissed')",
                tenant.project_id,
                tenant.workspace_id,
            )


async def test_an_alert_names_a_run_of_its_own_workspace(migrated: PostgresServer) -> None:
    first = await seed_tenant(migrated, "alert-a")
    second = await seed_tenant(migrated, "alert-b")
    async with connection(migrated) as db:
        # A new run of the first workspace (the seeded one already has its alert).
        run = await db.fetchval(
            "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
            "settings, ceiling) VALUES ($1, $2, 'manual', 'failed', 'example.com', '{}', 2000) "
            "RETURNING id",
            first.workspace_id,
            first.project_id,
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.crawl_alerts (run_id, workspace_id, project_id, lost_links, "
                "max_position, threshold, channel, delivery_state) "
                "VALUES ($1, $2, $3, 1, 2, 1, 'app', 'shown_in_app')",
                run,
                second.workspace_id,
                second.project_id,
            )
    assert isinstance(run, uuid.UUID)
```

- [ ] **Step 2: Run it and see it fail**

```bash
uv run pytest tests/db/test_internal_links_changes_schema.py --no-cov -q
```

Expected: FAIL (`relation "seo.crawl_link_changes" does not exist`, or the new columns are missing).

- [ ] **Step 3: Write the migration**

Create `backend/src/idraft/db/migrations/versions/0026_internal_links_changes.py`:

```python
"""Internal link tracker, slices 2 and 3: what changed between crawls, the alert record,
mentions for link opportunities, the people's decisions and Search Console page totals.

Plan `docs/superpowers/plans/2026-11-17-internal-links-04-backend-slices-2-3.md`, decisions D1
to D13:

- `seo.crawl_runs` gets the diff's base (`previous_run_id`) and the state of its second job,
  `crawl_enrich` (D1). The crawl is usable while that job is `pending`.
- Changes are stored per run because link partitions are dropped past the last four crawls
  (D2). Only the pairs that were lost or added, and only the pages that moved, have rows.
- Mentions are per run; decisions belong to the project (D12, D13).
- `fp.gsc_page_daily` holds clicks and impressions per page and day, because the Search Console
  pull has no page dimension (D10).

Revision ID: 0026
Revises: 0025
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
ALTER TABLE seo.crawl_runs
    ADD COLUMN previous_run_id uuid,
    ADD COLUMN enrich_state text NOT NULL DEFAULT 'pending'
        CHECK (enrich_state IN ('pending','running','done','failed')),
    ADD COLUMN enrich_phase text CHECK (enrich_phase IN ('changes','anchors','mentions','done')),
    ADD COLUMN enrich_failures smallint NOT NULL DEFAULT 0,
    ADD COLUMN enrich_offset integer NOT NULL DEFAULT 0;

CREATE INDEX crawl_runs_enriching ON seo.crawl_runs (state, created_at)
    WHERE enrich_state IN ('pending','running');

ALTER TABLE seo.crawl_pages
    ADD COLUMN editorial_anchors integer NOT NULL DEFAULT 0,
    ADD COLUMN generic_anchors integer NOT NULL DEFAULT 0;

CREATE TABLE seo.crawl_link_changes (
    run_id          uuid NOT NULL,
    workspace_id    uuid NOT NULL,
    change          text NOT NULL CHECK (change IN ('lost','added')),
    scope           text NOT NULL CHECK (scope IN ('editorial','all')),
    source_url_id   bigint NOT NULL,
    target_url_id   bigint NOT NULL,
    placement       text NOT NULL,
    anchor          text NOT NULL DEFAULT '' CHECK (length(anchor) <= 500),
    still_linked_by text,
    PRIMARY KEY (run_id, change, scope, source_url_id, target_url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX crawl_link_changes_target ON seo.crawl_link_changes
    (run_id, change, scope, target_url_id);

CREATE TABLE seo.crawl_page_changes (
    run_id             uuid NOT NULL,
    workspace_id       uuid NOT NULL,
    url_id             bigint NOT NULL,
    is_new             boolean NOT NULL,
    editorial_in_delta integer,
    equity_points      double precision,
    depth_state        text CHECK (depth_state IN ('lost','found')),
    depth_delta        integer,
    PRIMARY KEY (run_id, url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.crawl_alerts (
    run_id         uuid PRIMARY KEY,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    lost_links     integer NOT NULL CHECK (lost_links >= 0),
    max_position   smallint NOT NULL CHECK (max_position BETWEEN 1 AND 8),
    threshold      smallint NOT NULL CHECK (threshold BETWEEN 1 AND 50),
    channel        text NOT NULL CHECK (channel IN ('app','email','slack')),
    delivery_state text NOT NULL CHECK (delivery_state IN ('shown_in_app','channel_unavailable')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.crawl_mentions (
    run_id        uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    source_url_id bigint NOT NULL,
    target_url_id bigint NOT NULL,
    phrase        text NOT NULL CHECK (length(phrase) BETWEEN 3 AND 200),
    context       text NOT NULL CHECK (length(context) <= 400),
    origin        text NOT NULL CHECK (origin IN ('keyword','anchor')),
    PRIMARY KEY (run_id, source_url_id, target_url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX crawl_mentions_target ON seo.crawl_mentions (run_id, target_url_id);

CREATE TABLE core.link_opportunity_decisions (
    project_id    uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    source_url_id bigint NOT NULL,
    target_url_id bigint NOT NULL,
    status        text NOT NULL CHECK (status IN ('accepted','dismissed')),
    decided_by    uuid REFERENCES auth.users(id),
    decided_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, source_url_id, target_url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE core.tier_suggestion_dismissals (
    project_id   uuid NOT NULL,
    workspace_id uuid NOT NULL,
    url_id       bigint NOT NULL,
    dismissed_by uuid REFERENCES auth.users(id),
    dismissed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE fp.gsc_page_daily (
    integration_id uuid NOT NULL,
    metric_date    date NOT NULL,
    url_id         bigint NOT NULL,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    clicks         integer NOT NULL CHECK (clicks >= 0),
    impressions    integer NOT NULL CHECK (impressions >= 0),
    ingested_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, metric_date, url_id),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX gsc_page_daily_project_url ON fp.gsc_page_daily (project_id, url_id, metric_date);
"""

_TENANT_TABLES = (
    "seo.crawl_link_changes",
    "seo.crawl_page_changes",
    "seo.crawl_alerts",
    "seo.crawl_mentions",
    "core.link_opportunity_decisions",
    "core.tier_suggestion_dismissals",
    "fp.gsc_page_daily",
)
_ENRICH_COLUMNS = (
    "previous_run_id",
    "enrich_state",
    "enrich_phase",
    "enrich_failures",
    "enrich_offset",
)


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("seo.crawl_link_changes", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_page_changes", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_alerts", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_mentions", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("core.link_opportunity_decisions", api="SELECT, INSERT, DELETE"),
        column_grant(
            "core.link_opportunity_decisions",
            role="app_api",
            privilege="UPDATE",
            columns=("status", "decided_by", "decided_at"),
        ),
        *grants("core.tier_suggestion_dismissals", api="SELECT, INSERT, DELETE"),
        *grants("fp.gsc_page_daily", api="SELECT", worker="SELECT, INSERT, DELETE"),
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=_ENRICH_COLUMNS
        ),
        column_grant(
            "seo.crawl_pages",
            role="app_worker",
            privilege="UPDATE",
            columns=("editorial_anchors", "generic_anchors"),
        ),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DROP TABLE fp.gsc_page_daily, core.tier_suggestion_dismissals, "
        "core.link_opportunity_decisions, seo.crawl_mentions, seo.crawl_alerts, "
        "seo.crawl_page_changes, seo.crawl_link_changes"
    )
    op.execute(
        "ALTER TABLE seo.crawl_pages DROP COLUMN editorial_anchors, "
        "DROP COLUMN generic_anchors"
    )
    op.execute("DROP INDEX seo.crawl_runs_enriching")
    op.execute(
        "ALTER TABLE seo.crawl_runs DROP COLUMN previous_run_id, DROP COLUMN enrich_state, "
        "DROP COLUMN enrich_phase, DROP COLUMN enrich_failures, DROP COLUMN enrich_offset"
    )
```

Check that `grants(...)` with no `worker=` argument is valid as in `core.page_terms` of 0025 (it is: `grants("core.page_terms", api="SELECT, INSERT, DELETE")`).

- [ ] **Step 4: Add the table metadata**

In `backend/src/idraft/db/tables.py`, add the new columns to `crawl_runs` (`Column("previous_run_id", Uuid)`, `Column("enrich_state", Text, nullable=False, server_default=FetchedValue())`, `Column("enrich_phase", Text)`, `Column("enrich_failures", SmallInteger, nullable=False, server_default=FetchedValue())`, `Column("enrich_offset", Integer, nullable=False, server_default=FetchedValue())`) and to `crawl_pages` (`Column("editorial_anchors", Integer, nullable=False, server_default=FetchedValue())`, `Column("generic_anchors", Integer, nullable=False, server_default=FetchedValue())`), each next to the columns of the same kind. Then add after `crawl_tier_stats`:

```python
crawl_link_changes = Table(
    "crawl_link_changes",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("change", Text, primary_key=True),
    Column("scope", Text, primary_key=True),
    Column("source_url_id", BigInteger, primary_key=True),
    Column("target_url_id", BigInteger, primary_key=True),
    Column("placement", Text, nullable=False),
    Column("anchor", Text, nullable=False, server_default=FetchedValue()),
    Column("still_linked_by", Text),
    schema="seo",
)

crawl_page_changes = Table(
    "crawl_page_changes",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("url_id", BigInteger, primary_key=True),
    Column("is_new", Boolean, nullable=False),
    Column("editorial_in_delta", Integer),
    Column("equity_points", Double),
    Column("depth_state", Text),
    Column("depth_delta", Integer),
    schema="seo",
)

crawl_alerts = Table(
    "crawl_alerts",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("lost_links", Integer, nullable=False),
    Column("max_position", SmallInteger, nullable=False),
    Column("threshold", SmallInteger, nullable=False),
    Column("channel", Text, nullable=False),
    Column("delivery_state", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    schema="seo",
)

crawl_mentions = Table(
    "crawl_mentions",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("source_url_id", BigInteger, primary_key=True),
    Column("target_url_id", BigInteger, primary_key=True),
    Column("phrase", Text, nullable=False),
    Column("context", Text, nullable=False),
    Column("origin", Text, nullable=False),
    schema="seo",
)

link_opportunity_decisions = Table(
    "link_opportunity_decisions",
    metadata,
    Column("project_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("source_url_id", BigInteger, primary_key=True),
    Column("target_url_id", BigInteger, primary_key=True),
    Column("status", Text, nullable=False),
    Column("decided_by", Uuid),
    Column("decided_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    schema="core",
)

tier_suggestion_dismissals = Table(
    "tier_suggestion_dismissals",
    metadata,
    Column("project_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("url_id", BigInteger, primary_key=True),
    Column("dismissed_by", Uuid),
    Column("dismissed_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    schema="core",
)

gsc_page_daily = Table(
    "gsc_page_daily",
    metadata,
    Column("integration_id", Uuid, primary_key=True),
    Column("metric_date", Date, primary_key=True),
    Column("url_id", BigInteger, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("clicks", Integer, nullable=False),
    Column("impressions", Integer, nullable=False),
    Column("ingested_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    schema="fp",
)
```

If `Double`, `Date`, `Boolean`, `Integer`, `SmallInteger` are not yet imported at the top of `tables.py`, add them to the existing `from sqlalchemy import ...` line (the file already uses all of them for other tables; `Double` may be missing: use `Float(precision=53)` instead if so and match what `crawl_pages.equity_share` uses).

- [ ] **Step 5: Add the tables to the shared test support**

In `backend/tests/db/support.py`: add to `TENANT_TABLES` (after `"seo.crawl_tier_stats": "workspace_id",`):

```python
    "seo.crawl_link_changes": "workspace_id",
    "seo.crawl_page_changes": "workspace_id",
    "seo.crawl_alerts": "workspace_id",
    "seo.crawl_mentions": "workspace_id",
    "core.link_opportunity_decisions": "workspace_id",
    "core.tier_suggestion_dismissals": "workspace_id",
    "fp.gsc_page_daily": "workspace_id",
```

In `seed_internal_links`, before `return run_id`, add one row to each of the five tables of this plan that hang on the run or the project:

```python
    await db.execute(
        "INSERT INTO seo.crawl_link_changes (run_id, workspace_id, change, scope, source_url_id, "
        "target_url_id, placement) VALUES ($1, $2, 'lost', 'editorial', $3, $3, 'content')",
        run_id,
        workspace_id,
        url_id,
    )
    await db.execute(
        "INSERT INTO seo.crawl_page_changes (run_id, workspace_id, url_id, is_new) "
        "VALUES ($1, $2, $3, true)",
        run_id,
        workspace_id,
        url_id,
    )
    await db.execute(
        "INSERT INTO seo.crawl_alerts (run_id, workspace_id, project_id, lost_links, "
        "max_position, threshold, channel, delivery_state) "
        "VALUES ($1, $2, $3, 1, 2, 1, 'app', 'shown_in_app')",
        run_id,
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO seo.crawl_mentions (run_id, workspace_id, source_url_id, target_url_id, "
        "phrase, context, origin) VALUES ($1, $2, $3, $3, 'managed soc', 'A managed SOC.', "
        "'keyword')",
        run_id,
        workspace_id,
        url_id,
    )
    await db.execute(
        "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, source_url_id, "
        "target_url_id, status, decided_by) VALUES ($1, $2, $3, $3, 'accepted', $4)",
        project_id,
        workspace_id,
        url_id,
        owner_id,
    )
    await db.execute(
        "INSERT INTO core.tier_suggestion_dismissals (project_id, workspace_id, url_id, "
        "dismissed_by) VALUES ($1, $2, $3, $4)",
        project_id,
        workspace_id,
        url_id,
        owner_id,
    )
```

In the function that seeds `fp.gsc_search_analytics` (find it with `grep -n "fp.gsc_search_analytics" tests/db/support.py`, it has the `integration_id` variable), after that insert add (use the variable names that function already has for the workspace and project):

```python
    await db.execute(
        "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
        "project_id, clicks, impressions) "
        "VALUES ($1, current_date, (SELECT id FROM core.urls ORDER BY id LIMIT 1), $2, $3, 1, 2)",
        integration_id,
        workspace_id,
        project_id,
    )
```

- [ ] **Step 6: Run the schema tests and the generic ones**

```bash
uv run pytest tests/db -n 4 --no-cov -q
```

Expected: PASS, including `test_rls.py`, `test_grants.py` and `test_domain_values.py` (they walk `TENANT_TABLES` and the catalog). If `test_grants.py` names an expected grant list per table, add the grants of the table above to it.

- [ ] **Step 7: Gate and commit**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/db/migrations/versions/0026_internal_links_changes.py backend/src/idraft/db/tables.py backend/tests/db/support.py backend/tests/db/test_internal_links_changes_schema.py backend/tests/db/test_grants.py
git commit -m "Internal links: migration 0026 with crawl changes, alerts, mentions, decisions and Search Console page totals"
```

(Leave `test_grants.py` out of the `git add` when it did not change.)

---

### Task 2: Pure rules: anchors and change classification

**Files:**
- Create: `backend/src/idraft/crawl/anchors.py`, `backend/src/idraft/crawl/changes.py`
- Create: `backend/tests/crawl/test_anchors.py`, `backend/tests/crawl/test_changes.py`

**Read first:** `backend/src/idraft/crawl/tiers.py` (module style), `apps/web/design-preview/il-model.js` lines 490 to 514 (`GENERIC_ANCHORS`, `cleanAnchor`, `anchorStats`) and 396 to 468 (`alertMaxPosition`, `linkChanges`, `pageDelta`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/crawl/test_anchors.py`:

```python
from __future__ import annotations

from idraft.crawl.anchors import (
    GENERIC_ANCHORS,
    anchor_stats,
    clean_anchor,
    is_generic,
    mostly_generic,
)


def test_quotes_and_spaces_around_an_anchor_are_dropped() -> None:
    assert clean_anchor('  "Read more" ') == "Read more"
    assert clean_anchor("“See plans”") == "See plans"


def test_generic_anchors_are_matched_without_case() -> None:
    assert is_generic("Click HERE")
    assert is_generic("  read more ")
    assert not is_generic("SOC as a service")
    assert "click here" in GENERIC_ANCHORS


def test_anchors_group_without_case_and_sort_by_count_then_text() -> None:
    stats = anchor_stats(
        ["SOC", "soc", "MDR", "here", "here", "here", "Alpha"], keywords=[], limit=3
    )
    assert stats.total == 7
    assert stats.distinct == 4
    assert [(row.text, row.count, row.generic) for row in stats.top] == [
        ("here", 3, True),
        ("SOC", 2, False),
        ("Alpha", 1, False),
    ]
    assert stats.generic_count == 3
    assert round(stats.generic_share, 3) == round(3 / 7, 3)


def test_matches_keyword_is_unknown_without_keywords() -> None:
    assert anchor_stats(["SOC"], keywords=[]).matches_keyword is None


def test_an_anchor_inside_a_keyword_or_around_one_matches_but_a_generic_one_does_not() -> None:
    assert anchor_stats(["soc"], keywords=["soc as a service"]).matches_keyword is True
    assert anchor_stats(["best managed soc provider"], keywords=["managed soc"]).matches_keyword
    assert anchor_stats(["here"], keywords=["here"]).matches_keyword is False
    assert anchor_stats(["pricing"], keywords=["soc"]).matches_keyword is False


def test_mostly_generic_needs_two_links_and_more_than_half() -> None:
    assert mostly_generic(total=4, generic=3)
    assert not mostly_generic(total=4, generic=2)
    assert not mostly_generic(total=1, generic=1)
    assert not mostly_generic(total=0, generic=0)
```

Create `backend/tests/crawl/test_changes.py`:

```python
from __future__ import annotations

import pytest

from idraft.crawl.changes import (
    AlertSettings,
    alert_due,
    alert_settings,
    depth_change,
    equity_points,
    is_top,
    priority_of,
)


def test_priority_follows_the_target_tier_position() -> None:
    assert priority_of(1) == "lost_to_t1"
    assert priority_of(2) == "lost_to_t2"
    assert priority_of(3) == "lower"
    assert priority_of(None) == "lower"


def test_a_target_is_top_up_to_the_setting_and_untiered_never_is() -> None:
    assert is_top(1, 2) and is_top(2, 2)
    assert not is_top(3, 2)
    assert not is_top(None, 2)


def test_equity_points_are_rounded_to_one_decimal_and_never_negative_zero() -> None:
    assert equity_points(0.0312, 0.0201) == 1.1
    assert equity_points(0.02, 0.02) == 0.0
    assert str(equity_points(0.02, 0.0200001)) == "0.0"
    assert equity_points(None, 0.5) == -50.0


@pytest.mark.parametrize(
    ("was", "now", "expected"),
    [
        (3, 5, (None, 2)),
        (5, 3, (None, -2)),
        (3, 3, (None, 0)),
        (None, 4, ("found", None)),
        (4, None, ("lost", None)),
        (None, None, (None, None)),
    ],
)
def test_depth_change(
    was: int | None, now: int | None, expected: tuple[str | None, int | None]
) -> None:
    assert depth_change(was, now) == expected


def test_settings_have_defaults_and_ignore_bad_stored_values() -> None:
    assert alert_settings(None) == AlertSettings(True, 2, 1, "app")
    stored = {"alerts": {"enabled": False, "max_position": 1, "threshold": 5, "channel": "slack"}}
    assert alert_settings(stored) == AlertSettings(False, 1, 5, "slack")
    assert alert_settings({"alerts": {"max_position": 99, "threshold": 0}}) == AlertSettings(
        True, 2, 1, "app"
    )


def test_an_alert_is_due_when_enabled_and_the_count_reaches_the_threshold() -> None:
    settings = AlertSettings(True, 2, 3, "app")
    assert not alert_due(2, settings)
    assert alert_due(3, settings)
    assert not alert_due(9, AlertSettings(False, 2, 1, "app"))
```

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/crawl/test_anchors.py tests/crawl/test_changes.py --no-cov -q
```

Expected: FAIL (`ModuleNotFoundError: idraft.crawl.anchors`).

- [ ] **Step 3: Implement `anchors.py`**

```python
"""Anchor texts pointing at a page (spec 7.10): how many are different, how many are generic
words such as "click here", and whether a descriptive one holds a tracked keyword. Pure; the
mock's `anchorStats` in `apps/web/design-preview/il-model.js` is the reference."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final

GENERIC_ANCHORS: Final = frozenset(
    {
        "click here",
        "read more",
        "learn more",
        "here",
        "this",
        "more",
        "link",
        "see more",
        "find out more",
        "details",
    }
)
# More than half of the editorial anchors, with at least two links (spec 7.10).
GENERIC_SHARE_MIN: Final = 0.5
GENERIC_MIN_LINKS: Final = 2
_QUOTES: Final = "\"'“‘”’"


def clean_anchor(text: str) -> str:
    """The anchor without spaces and quotes around it."""
    return text.strip().strip(_QUOTES).strip()


def is_generic(text: str) -> bool:
    return clean_anchor(text).lower() in GENERIC_ANCHORS


@dataclass(frozen=True, slots=True)
class AnchorGroup:
    text: str
    count: int
    generic: bool


@dataclass(frozen=True, slots=True)
class AnchorStats:
    total: int
    distinct: int
    generic_count: int
    generic_share: float
    top: list[AnchorGroup]
    # None when the page has no tracked keywords: nothing to match.
    matches_keyword: bool | None


def mostly_generic(total: int, generic: int) -> bool:
    return total >= GENERIC_MIN_LINKS and generic / total > GENERIC_SHARE_MIN


def anchor_stats(
    anchors: Iterable[str], keywords: Sequence[str], *, limit: int = 5
) -> AnchorStats:
    """Every link counts, not one per linking page. Texts group without letter case; the first
    spelling seen is the one shown."""
    groups: dict[str, AnchorGroup] = {}
    for raw in anchors:
        text = clean_anchor(raw)
        key = text.lower()
        seen = groups.get(key)
        groups[key] = AnchorGroup(
            text=seen.text if seen else text,
            count=(seen.count if seen else 0) + 1,
            generic=key in GENERIC_ANCHORS,
        )
    rows = sorted(groups.values(), key=lambda row: (-row.count, row.text.lower()))
    total = sum(row.count for row in rows)
    generic = sum(row.count for row in rows if row.generic)
    wanted = [word.lower() for word in keywords]
    matches: bool | None = None
    if wanted:
        matches = any(
            row.text
            and not row.generic
            and any(word in row.text.lower() or row.text.lower() in word for word in wanted)
            for row in rows
        )
    return AnchorStats(
        total=total,
        distinct=len(rows),
        generic_count=generic,
        generic_share=generic / total if total else 0.0,
        top=rows[:limit],
        matches_keyword=matches,
    )
```

- [ ] **Step 4: Implement `changes.py`**

```python
"""What a crawl changed against the one before it (spec 7.10), and the alert for links lost to
important pages. Pure; the mock's `linkChanges`, `lostToTop`, `alertsFor` and `pageDelta` are
the reference."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

type Priority = Literal["lost_to_t1", "lost_to_t2", "lower"]
type DepthState = Literal["lost", "found"]
CHANNELS: Final = ("app", "email", "slack")
# A crawl's stored changes stop here per scope; the API says so when a list was cut.
CHANGES_MAX: Final = 200_000


def priority_of(position: int | None) -> Priority:
    """The Priority cell of a lost link, from the tier position of its target (None is
    Untiered)."""
    if position == 1:
        return "lost_to_t1"
    if position == 2:
        return "lost_to_t2"
    return "lower"


def is_top(position: int | None, max_position: int) -> bool:
    """A target that counts as important: tier position 1 up to `max_position`."""
    return position is not None and 1 <= position <= max_position


def equity_points(now: float | None, before: float | None) -> float:
    """Change of equity share in points, one decimal (0.0312 against 0.0201 is 1.1)."""
    points = round(((now or 0.0) - (before or 0.0)) * 1000) / 10
    return points + 0.0  # turns -0.0 into 0.0


def depth_change(was: int | None, now: int | None) -> tuple[DepthState | None, int | None]:
    """(state, levels). A page one crawl reaches and the other does not has a state and no
    number; otherwise the number of levels deeper (positive) or shallower (negative)."""
    if was is None and now is None:
        return None, None
    if was is None:
        return "found", None
    if now is None:
        return "lost", None
    return None, now - was


@dataclass(frozen=True, slots=True)
class AlertSettings:
    enabled: bool
    max_position: int
    threshold: int
    channel: str


def alert_settings(stored: Mapping[str, Any] | None) -> AlertSettings:
    """The project's `internal_links.alerts` with defaults; a bad stored value falls back to
    its default, so a hand-edited setting never stops an evaluation."""
    given = (stored or {}).get("alerts") or {}
    position = given.get("max_position")
    threshold = given.get("threshold")
    channel = given.get("channel")
    return AlertSettings(
        enabled=given.get("enabled") is not False,
        max_position=position if isinstance(position, int) and 1 <= position <= 8 else 2,
        threshold=threshold if isinstance(threshold, int) and 1 <= threshold <= 50 else 1,
        channel=channel if channel in CHANNELS else "app",
    )


def alert_due(lost_to_top: int, settings: AlertSettings) -> bool:
    return settings.enabled and lost_to_top >= settings.threshold
```

- [ ] **Step 5: Run the tests, the gate, and commit**

```bash
uv run pytest tests/crawl/test_anchors.py tests/crawl/test_changes.py --no-cov -q
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/crawl/anchors.py backend/src/idraft/crawl/changes.py backend/tests/crawl/test_anchors.py backend/tests/crawl/test_changes.py
git commit -m "Internal links: anchor statistics and change classification rules"
```

Expected: tests pass (the `-0.0` test passes because of `+ 0.0`). If `lint-imports` complains that `idraft.crawl` imports something forbidden, these two modules import only the standard library.

---

### Task 3: Pure shortest route

**Files:**
- Create: `backend/src/idraft/crawl/paths.py`, `backend/tests/crawl/test_paths.py`

**Read first:** `apps/web/design-preview/il-model.js` lines 360 to 388 (`routeFromHome`, `findPaths`), plan 02 D14 above.

- [ ] **Step 1: Write the failing test**

```python
from __future__ import annotations

from idraft.crawl.paths import Hop, rebuild_route


def hop(source: int, target: int, anchor: str = "a") -> Hop:
    return Hop(source=source, target=target, anchor=anchor, placement="content", scope="editorial")


def test_a_route_is_the_start_then_every_hop_to_the_target() -> None:
    parents = {2: hop(1, 2, "services"), 3: hop(2, 3, "SOC")}
    route = rebuild_route(parents, 1, 3)
    assert route is not None
    assert [(step.url_id, step.hop.anchor if step.hop else None) for step in route] == [
        (1, None),
        (2, "services"),
        (3, "SOC"),
    ]


def test_the_start_page_is_a_route_of_one_step() -> None:
    route = rebuild_route({}, 1, 1)
    assert route is not None and [step.url_id for step in route] == [1]


def test_a_target_the_search_never_reached_has_no_route() -> None:
    assert rebuild_route({2: hop(1, 2)}, 1, 9) is None


def test_a_loop_in_the_parents_is_refused_instead_of_followed_forever() -> None:
    parents = {2: hop(3, 2), 3: hop(2, 3)}
    assert rebuild_route(parents, 1, 3) is None
```

- [ ] **Step 2: Run and see it fail**

```bash
uv run pytest tests/crawl/test_paths.py --no-cov -q
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```python
"""The shortest route from the start page to a page (spec 7.10, decision D14). The search runs
in the API one level at a time and keeps, for every page it reaches, the hop that reached it;
this module turns those hops into the route. Pure."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

# A site this deep in clicks is a crawl trap; the search stops here.
MAX_LEVELS: Final = 12


@dataclass(frozen=True, slots=True)
class Hop:
    """The link that reached a page. A redirect is a hop with anchor `301 redirect`."""

    source: int
    target: int
    anchor: str
    placement: str
    scope: str


@dataclass(frozen=True, slots=True)
class Step:
    url_id: int
    # None for the start page.
    hop: Hop | None


def rebuild_route(parents: Mapping[int, Hop], start: int, target: int) -> list[Step] | None:
    """From the start page to `target`, or None when the search did not reach it."""
    steps: list[Step] = []
    page = target
    for _ in range(MAX_LEVELS + 1):
        if page == start:
            steps.append(Step(start, None))
            return list(reversed(steps))
        hop = parents.get(page)
        if hop is None:
            return None
        steps.append(Step(page, hop))
        page = hop.source
    return None
```

- [ ] **Step 4: Run, gate, commit**

```bash
uv run pytest tests/crawl/test_paths.py --no-cov -q
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/crawl/paths.py backend/tests/crawl/test_paths.py
git commit -m "Internal links: route rebuild for the path finder"
```

---

### Task 4: Pure tier suggestions

**Files:**
- Create: `backend/src/idraft/crawl/suggest.py`, `backend/tests/crawl/test_suggest.py`

**Read first:** `apps/web/design-preview/il-model.js` lines 542 to 570 (`tierSuggestions`), spec 7.10 "Tier suggestions".

- [ ] **Step 1: Write the failing test**

```python
from __future__ import annotations

from idraft.crawl.suggest import KeywordHit, SuggestPage, suggest_tiers


def page(
    url_id: int,
    *,
    position: int | None = None,
    manual: bool = False,
    clicks: int = 0,
    hits: tuple[KeywordHit, ...] = (),
) -> SuggestPage:
    return SuggestPage(url_id, position, manual, clicks, hits)


def test_the_top_fifth_by_clicks_that_is_t3_or_lower_is_suggested_for_t2() -> None:
    pages = [page(i, position=3, clicks=c) for i, c in enumerate([500, 400, 10, 5, 1], start=1)]
    found = suggest_tiers(pages, tiers=4, dismissed=set())
    assert [(row.url_id, row.to_position) for row in found] == [(1, 2)]
    assert found[0].reasons[0].kind == "clicks" and found[0].reasons[0].clicks == 500


def test_a_page_ranking_one_to_five_for_a_big_keyword_is_suggested_with_the_best_rank() -> None:
    hits = (KeywordHit("soc", 4, 2900), KeywordHit("managed soc", 2, 2500), KeywordHit("x", 3, 100))
    found = suggest_tiers([page(1, position=4, hits=hits)], tiers=4, dismissed=set())
    assert len(found) == 1 and found[0].to_position == 2
    reason = found[0].reasons[0]
    assert (reason.kind, reason.rank, reason.keyword, reason.volume) == (
        "rank",
        2,
        "managed soc",
        2500,
    )


def test_an_untiered_page_with_fifty_clicks_goes_to_t3_when_nothing_else_applies() -> None:
    pages = [page(1, clicks=60)] + [page(i, clicks=1000, position=1) for i in range(2, 12)]
    found = {row.url_id: row for row in suggest_tiers(pages, tiers=4, dismissed=set())}
    assert found[1].to_position == 3 and found[1].reasons[0].clicks == 60


def test_manual_dismissed_and_already_high_pages_are_never_suggested() -> None:
    pages = [
        page(1, position=3, clicks=900, manual=True),
        page(2, position=3, clicks=800),
        page(3, position=2, clicks=700),
        page(4, position=1, clicks=600),
    ]
    assert suggest_tiers(pages, tiers=4, dismissed={2}) == []


def test_a_workspace_with_one_tier_suggests_nothing() -> None:
    assert suggest_tiers([page(1, position=3, clicks=999)], tiers=1, dismissed=set()) == []
```

- [ ] **Step 2: Run, see it fail**

```bash
uv run pytest tests/crawl/test_suggest.py --no-cov -q
```

- [ ] **Step 3: Implement**

```python
"""Suggested tiers from Search Console clicks and tracked keyword ranks (spec 7.10). Pure; the
mock's `tierSuggestions` is the reference. Nothing here writes: a person accepts a suggestion
and the usual manual tier change applies it (decision D13)."""

from __future__ import annotations

import math
from collections.abc import AbstractSet, Sequence
from dataclasses import dataclass
from typing import Final, Literal

BUSIEST_SHARE: Final = 0.2
RANK_MAX: Final = 5
VOLUME_MIN: Final = 2_000
THIRD_TIER_CLICKS: Final = 50


@dataclass(frozen=True, slots=True)
class KeywordHit:
    keyword: str
    rank: int | None
    volume: int | None


@dataclass(frozen=True, slots=True)
class SuggestPage:
    """A live, indexable page of the crawl. `tier_position` is None when Untiered; `manual`
    is true when a person chose the tier (or Untiered)."""

    url_id: int
    tier_position: int | None
    manual: bool
    clicks: int
    hits: Sequence[KeywordHit]


@dataclass(frozen=True, slots=True)
class Reason:
    kind: Literal["clicks", "rank"]
    clicks: int | None = None
    rank: int | None = None
    keyword: str | None = None
    volume: int | None = None


@dataclass(frozen=True, slots=True)
class TierSuggestion:
    url_id: int
    to_position: int
    reasons: list[Reason]


def suggest_tiers(
    pages: Sequence[SuggestPage], *, tiers: int, dismissed: AbstractSet[int]
) -> list[TierSuggestion]:
    """Pages in the top fifth by clicks, or ranking 1 to 5 for a keyword with 2,000 or more
    searches, that are T3 or lower, get T2; Untiered pages with 50 or more clicks get T3. A
    workspace with fewer than two tiers has no T2 to suggest."""
    if tiers < 2:
        return []
    busiest_count = math.ceil(len(pages) * BUSIEST_SHARE)
    ranked = sorted(pages, key=lambda item: item.clicks, reverse=True)[:busiest_count]
    busiest = {item.url_id for item in ranked if item.clicks > 0}
    found: list[TierSuggestion] = []
    for item in pages:
        if item.manual or item.url_id in dismissed:
            continue
        position = item.tier_position or math.inf
        reasons: list[Reason] = []
        if position >= 3 and item.url_id in busiest:
            reasons.append(Reason("clicks", clicks=item.clicks))
        best = sorted(
            (
                hit
                for hit in item.hits
                if hit.rank is not None
                and hit.rank <= RANK_MAX
                and (hit.volume or 0) >= VOLUME_MIN
            ),
            key=lambda hit: hit.rank or 0,
        )
        if position >= 3 and best:
            reasons.append(
                Reason("rank", rank=best[0].rank, keyword=best[0].keyword, volume=best[0].volume)
            )
        if reasons:
            found.append(TierSuggestion(item.url_id, 2, reasons))
        elif tiers >= 3 and item.tier_position is None and item.clicks >= THIRD_TIER_CLICKS:
            found.append(TierSuggestion(item.url_id, 3, [Reason("clicks", clicks=item.clicks)]))
    return found
```

- [ ] **Step 4: Run, gate, commit**

```bash
uv run pytest tests/crawl/test_suggest.py --no-cov -q
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/crawl/suggest.py backend/tests/crawl/test_suggest.py
git commit -m "Internal links: tier suggestion rules"
```

---

### Task 5: Pure mentions

**Files:**
- Create: `backend/src/idraft/crawl/mentions.py`, `backend/tests/crawl/test_mentions.py`

**Read first:** `backend/src/idraft/crawl/placement.py` lines 1 to 60 (it uses `html.parser.HTMLParser`; the same parser is used here, no new dependency), decision D11 above, `apps/web/design-preview/il-data.js` `mentions` for the shape of a mention.

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

from idraft.crawl.mentions import (
    PhraseSet,
    find_mentions,
    index_phrases,
    phrase_key,
    visible_text,
)

HTML = """
<html><body>
<header><a href="/">Home</a> managed soc in the header</header>
<nav>managed soc menu</nav>
<main>
  <h1>Cloud misconfigurations</h1>
  <p>A managed detection and response team can catch these within hours. See
  <a href="/pricing">our pricing</a> for details.</p>
  <script>var x = "managed soc";</script>
  <p>Teams ask about ISO 27001 before they buy. Not about 2026.</p>
</main>
<footer>managed soc footer</footer>
</body></html>
"""


def test_visible_text_is_the_main_content_without_links_scripts_and_template_blocks() -> None:
    text = visible_text(HTML)
    assert "managed detection and response team" in text
    assert "ISO 27001" in text
    for left_out in ("header", "menu", "footer", "our pricing", "var x"):
        assert left_out not in text


def test_a_page_without_main_or_article_uses_its_body() -> None:
    assert "Plain words" in visible_text("<body><p>Plain words here.</p></body>")


def test_phrase_keys_are_lowercase_words_and_too_short_or_numeric_ones_are_refused() -> None:
    assert phrase_key("  Managed   SOC ") == "managed soc"
    assert phrase_key("ab") is None
    assert phrase_key("2026") is None
    assert phrase_key("one two three four five six") is None
    assert phrase_key("click here") is None


def test_a_mention_is_found_with_its_sentence_and_the_text_as_written() -> None:
    index = index_phrases(
        {
            10: PhraseSet(keywords=["managed detection and response"], anchors=[]),
            11: PhraseSet(keywords=[], anchors=["ISO 27001"]),
        }
    )
    found = find_mentions(visible_text(HTML), index, source_url_id=1, skip=set())
    by_target = {mention.target_url_id: mention for mention in found}
    assert by_target[10].phrase == "managed detection and response"
    assert by_target[10].origin == "keyword"
    assert "A managed detection and response team can catch these within hours." in (
        by_target[10].context
    )
    assert by_target[11].phrase == "ISO 27001" and by_target[11].origin == "anchor"


def test_a_target_the_page_links_to_already_or_itself_is_skipped() -> None:
    index = index_phrases({10: PhraseSet(["iso 27001"], []), 1: PhraseSet(["ISO 27001"], [])})
    assert find_mentions(visible_text(HTML), index, source_url_id=1, skip={10}) == []


def test_a_keyword_phrase_wins_over_an_anchor_phrase_for_the_same_target() -> None:
    index = index_phrases({10: PhraseSet(["iso 27001"], ["before they buy"])})
    found = find_mentions(visible_text(HTML), index, source_url_id=1, skip=set())
    assert [(mention.phrase, mention.origin) for mention in found] == [("ISO 27001", "keyword")]


def test_a_phrase_must_match_whole_words() -> None:
    index = index_phrases({10: PhraseSet(["soc"], [])})
    assert find_mentions("The sock drawer and socks.", index, source_url_id=1, skip=set()) == []
    assert find_mentions("We run a SOC today.", index, source_url_id=1, skip=set())


def test_at_most_limit_mentions_come_back() -> None:
    targets = {n: PhraseSet([f"topic{n} words"], []) for n in range(100, 140)}
    text = " ".join(f"Read topic{n} words now." for n in range(100, 140))
    found = find_mentions(text, index_phrases(targets), source_url_id=1, skip=set(), limit=5)
    assert len(found) == 5
```

- [ ] **Step 2: Run, see it fail**

```bash
uv run pytest tests/crawl/test_mentions.py --no-cov -q
```

- [ ] **Step 3: Implement**

```python
"""Pages that mention a topic of another page (spec 7.10, decision D11). Pure.

`visible_text` takes the words a reader sees in the body of a page; `index_phrases` turns the
phrases of every target into a dictionary of 1 to 5 word keys; `find_mentions` reads each run
of 1 to 5 words of the text once and looks it up, so the time grows with the length of the
page and not with the number of phrases."""

from __future__ import annotations

import re
from collections.abc import AbstractSet, Mapping, Sequence
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final, Literal

from idraft.crawl.anchors import GENERIC_ANCHORS

MENTIONS_PER_PAGE: Final = 20
PHRASE_MIN_CHARS: Final = 3
PHRASE_MAX_WORDS: Final = 5
CONTEXT_MAX: Final = 240

type Origin = Literal["keyword", "anchor"]
type PhraseIndex = dict[str, list[tuple[int, Origin]]]

_WORD = re.compile(r"[^\W_][\w'’-]*", re.UNICODE)
_SENTENCE_END = re.compile(r"[.!?]\s")
# Text in these elements is not the page's own words about a topic.
_SKIP = frozenset(
    {"script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg", "a",
     "button", "select", "textarea", "template", "iframe"}
)
_BLOCKS = frozenset(
    {"p", "div", "li", "ul", "ol", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section",
     "article", "main", "tr", "td", "th", "table", "blockquote", "figcaption"}
)
_VOID = frozenset({"br", "img", "hr", "input", "meta", "link", "source", "wbr", "area", "col"})


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.main = 0
        self.has_main = False
        self.chunks: list[str] = []
        self.main_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID:
            self._break(tag)
            return
        if tag in _SKIP:
            self.skip += 1
        if tag in ("main", "article"):
            self.main += 1
            self.has_main = True
        self._break(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP and self.skip:
            self.skip -= 1
        if tag in ("main", "article") and self.main:
            self.main -= 1
        self._break(tag)

    def _break(self, tag: str) -> None:
        if tag in _BLOCKS:
            self.chunks.append(" ")
            self.main_chunks.append(" ")

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        self.chunks.append(data)
        if self.main:
            self.main_chunks.append(data)


def visible_text(html: str) -> str:
    """The body text of a page: the text of `main` or `article` when the page has one, else of
    the whole body, without text inside links, scripts, menus, header, footer, aside and
    forms. Whitespace is one space."""
    parser = _Text()
    parser.feed(html)
    parser.close()
    chosen = parser.main_chunks if parser.has_main else parser.chunks
    return re.sub(r"\s+", " ", "".join(chosen)).strip()


def phrase_key(phrase: str) -> str | None:
    """The dictionary key of a phrase: its words in lowercase, one space between. None for a
    phrase that is too short, too long, only digits, or a generic anchor."""
    words = [match.group(0).lower() for match in _WORD.finditer(phrase)]
    key = " ".join(words)
    if not words or len(key) < PHRASE_MIN_CHARS or len(words) > PHRASE_MAX_WORDS:
        return None
    if all(word.isdigit() for word in words) or key in GENERIC_ANCHORS:
        return None
    return key


@dataclass(frozen=True, slots=True)
class PhraseSet:
    """What a target page is called: its tracked keywords, and the anchors that other pages
    use to link to it."""

    keywords: Sequence[str]
    anchors: Sequence[str]


def index_phrases(targets: Mapping[int, PhraseSet]) -> PhraseIndex:
    index: PhraseIndex = {}
    for target, phrases in targets.items():
        pairs: tuple[tuple[Origin, Sequence[str]], ...] = (
            ("keyword", phrases.keywords),
            ("anchor", phrases.anchors),
        )
        for origin, texts in pairs:
            for text in texts:
                key = phrase_key(text)
                if key is None:
                    continue
                entry = index.setdefault(key, [])
                if all(found[0] != target for found in entry):
                    entry.append((target, origin))
    return index


@dataclass(frozen=True, slots=True)
class Mention:
    target_url_id: int
    phrase: str
    context: str
    origin: Origin


def _sentence(text: str, start: int, end: int) -> str:
    left = 0
    for match in _SENTENCE_END.finditer(text, 0, start):
        left = match.end()
    after = _SENTENCE_END.search(text, end)
    right = after.start() + 1 if after else len(text)
    sentence = text[left:right].strip()
    if len(sentence) > CONTEXT_MAX:
        cut = max(left, start - CONTEXT_MAX // 3)
        sentence = text[cut : cut + CONTEXT_MAX].strip()
    return sentence


def find_mentions(
    text: str,
    index: PhraseIndex,
    *,
    source_url_id: int,
    skip: AbstractSet[int],
    limit: int = MENTIONS_PER_PAGE,
) -> list[Mention]:
    """One mention per target: a keyword phrase before an anchor phrase, then the earliest in
    the text. A page never mentions itself and never a target in `skip` (the pages it already
    links to by an editorial link)."""
    spans = [(match.group(0).lower(), match.start(), match.end()) for match in _WORD.finditer(text)]
    best: dict[int, tuple[int, int, int, Origin, str]] = {}
    for first in range(len(spans)):
        for size in range(1, PHRASE_MAX_WORDS + 1):
            last = first + size
            if last > len(spans):
                break
            key = " ".join(word for word, _, _ in spans[first:last])
            for target, origin in index.get(key, ()):
                if target == source_url_id or target in skip:
                    continue
                rank = 0 if origin == "keyword" else 1
                start, end = spans[first][1], spans[last - 1][2]
                current = best.get(target)
                if current is None or (rank, start) < (current[0], current[1]):
                    best[target] = (rank, start, end, origin, text[start:end])
    ordered = sorted(best.items(), key=lambda item: (item[1][0], item[1][1], item[0]))
    return [
        Mention(
            target_url_id=target,
            phrase=shown,
            context=_sentence(text, start, end),
            origin=origin,
        )
        for target, (_, start, end, origin, shown) in ordered[:limit]
    ]
```

- [ ] **Step 4: Run, gate, commit**

```bash
uv run pytest tests/crawl/test_mentions.py --no-cov -q
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/crawl/mentions.py backend/tests/crawl/test_mentions.py
git commit -m "Internal links: visible text, phrase index and mentions"
```

Expected: all mention tests pass. `test_a_keyword_phrase_wins...` relies on the keyword rank sorting key `(rank, start)`; the page text holds both "ISO 27001" and "before they buy"; target 10 has both, one mention comes back and it is the keyword one.

---
### Task 6: `crawl_enrich`: changes, alert and anchor counts, and the worker wiring

**Files:**
- Create: `backend/src/idraft/collectors/crawl_enrich.py`
- Modify: `backend/src/idraft/collectors/crawl_runs.py` (`CrawlTickReport`, `crawl_tick`)
- Modify: `backend/src/idraft/worker/assembly.py`
- Create: `backend/tests/api/internal_links/support_changes.py`, `backend/tests/collectors/test_crawl_enrich.py`

**Read first:** `backend/src/idraft/collectors/crawl_ingest.py` (`_read_run`, `_long_transaction`, `_failed_pass`, the `ingest_run` loop, which this job copies in a smaller form), `backend/src/idraft/collectors/crawl_runs.py` (`CrawlIngestTask`, `crawl_tick`, `CrawlTickReport`), `backend/src/idraft/worker/assembly.py` (`ingest_handler`, `crawl_ticks`), `backend/tests/api/internal_links/support.py` (`seed_crawl`, `SeedLink`, `set_counts`, `seed_tiers`), `backend/tests/collectors/test_crawl_store.py`.

- [ ] **Step 1: Write the seeds for two crawls**

Create `backend/tests/api/internal_links/support_changes.py`:

```python
"""Two crawls of one project, the second after changes, for the tests of the change store,
the Changes reads, extras and opportunities (plan 04)."""

from __future__ import annotations

import uuid

from tests.api.auth.support import Workspace, execute
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/pricing", 200), ("/blog", 200), ("/blog/a", 200), ("/blog/b", 200)]
BEFORE = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/blog", "/pricing", "content", "See plans"),
    SeedLink("/blog/a", "/pricing", "content", "Plans"),
]
AFTER = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/blog/a", "/pricing", "navigation", "Plans"),
    SeedLink("/blog", "/blog/b", "content", "Click here"),
    SeedLink("/blog/a", "/blog/b", "content", "SOC pricing"),
]


async def two_crawls(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """(older run, newer run, url ids by path, tier ids). /pricing is a manual T1 and /blog/b a
    manual T3. Between the crawls /blog stopped linking to /pricing by a link in the text, and
    /blog/a kept a menu link to it; /blog/b gained two links in the text."""
    tiers = await seed_tiers(pg, workspace)
    older, ids = await seed_crawl(pg, workspace, project_id, PAGES, BEFORE)
    newer, _ = await seed_crawl(pg, workspace, project_id, PAGES, AFTER)
    for run in (older, newer):
        await set_counts(pg, run)
    for path, tier in (("/pricing", tiers[0]), ("/blog/b", tiers[2])):
        await execute(
            pg,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project_id,
            ids[path],
            workspace.id,
            tier,
        )
    return older, newer, ids, tiers
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/collectors/test_crawl_enrich.py`:

```python
"""The `crawl_enrich` job: what a crawl changed against the one before, the alert, and the
anchor counts (plan 04 Task 6, decisions D1 to D5)."""

from __future__ import annotations

import time
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.internal_links.support import seed_crawl
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _enrich(sessions: Sessions, workspace_id: uuid.UUID, run_id: uuid.UUID) -> None:
    outcome = await enrich_run(
        sessions,
        None,
        CrawlEnrichTask(workspace_id=workspace_id, run_id=run_id),
        deadline=time.monotonic() + 120,
    )
    assert not outcome.failed and not outcome.busy


async def _pairs(
    pg: PostgresServer, run: uuid.UUID, change: str, scope: str
) -> dict[tuple[str, str], str | None]:
    rows = await fetch(
        pg,
        "SELECT su.path AS source, tu.path AS target, c.still_linked_by FROM "
        "seo.crawl_link_changes c JOIN core.urls su ON su.id = c.source_url_id "
        "JOIN core.urls tu ON tu.id = c.target_url_id "
        "WHERE c.run_id = $1 AND c.change = $2 AND c.scope = $3",
        run,
        change,
        scope,
    )
    return {(row["source"], row["target"]): row["still_linked_by"] for row in rows}


async def test_lost_and_added_pairs_are_stored_per_scope_with_what_still_links_them(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    older, newer, _, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    assert await _pairs(migrated, newer, "lost", "editorial") == {
        ("/blog", "/pricing"): None,
        ("/blog/a", "/pricing"): "navigation",
    }
    assert await _pairs(migrated, newer, "lost", "all") == {("/blog", "/pricing"): None}
    assert set(await _pairs(migrated, newer, "added", "editorial")) == {
        ("/blog", "/blog/b"),
        ("/blog/a", "/blog/b"),
    }
    row = (
        await fetch(
            migrated,
            "SELECT previous_run_id, enrich_state, enrich_phase FROM seo.crawl_runs WHERE id = $1",
            newer,
        )
    )[0]
    assert (row["previous_run_id"], row["enrich_state"], row["enrich_phase"]) == (
        older,
        "done",
        "done",
    )


async def test_pages_that_moved_have_a_row_and_the_others_have_none(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, ids, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    rows = {
        row["url_id"]: row
        for row in await fetch(
            migrated,
            "SELECT url_id, is_new, editorial_in_delta FROM seo.crawl_page_changes "
            "WHERE run_id = $1",
            newer,
        )
    }
    assert set(rows) == {ids["/pricing"], ids["/blog/b"]}
    assert rows[ids["/pricing"]]["editorial_in_delta"] == -2
    assert rows[ids["/blog/b"]]["editorial_in_delta"] == 2
    assert not rows[ids["/pricing"]]["is_new"]


async def test_links_lost_to_t1_raise_one_alert_shown_in_the_app(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    rows = await fetch(
        migrated,
        "SELECT lost_links, max_position, threshold, channel, delivery_state "
        "FROM seo.crawl_alerts WHERE run_id = $1",
        newer,
    )
    assert [tuple(row.values()) for row in rows] == [(2, 2, 1, "app", "shown_in_app")]


async def test_a_disabled_alert_or_one_below_its_threshold_is_not_recorded(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE core.projects SET settings = jsonb_build_object('internal_links', "
        "jsonb_build_object('alerts', jsonb_build_object('threshold', 3))) WHERE id = $1",
        project,
    )

    await _enrich(worker_db, workspace.id, newer)

    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", newer)


async def test_a_chosen_email_channel_is_recorded_as_unavailable(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE core.projects SET settings = jsonb_build_object('internal_links', "
        "jsonb_build_object('alerts', jsonb_build_object('channel', 'email'))) WHERE id = $1",
        project,
    )

    await _enrich(worker_db, workspace.id, newer)

    state = await fetch(
        migrated, "SELECT delivery_state FROM seo.crawl_alerts WHERE run_id = $1", newer
    )
    assert state[0]["delivery_state"] == "channel_unavailable"


async def test_editorial_anchor_counts_and_generic_ones_are_stored_per_page(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, ids, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    row = (
        await fetch(
            migrated,
            "SELECT editorial_anchors, generic_anchors FROM seo.crawl_pages "
            "WHERE run_id = $1 AND url_id = $2",
            newer,
            ids["/blog/b"],
        )
    )[0]
    assert (row["editorial_anchors"], row["generic_anchors"]) == (2, 1)


async def test_the_first_crawl_has_no_changes_and_no_alert(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    first, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])

    await _enrich(worker_db, workspace.id, first)

    run = (
        await fetch(
            migrated,
            "SELECT previous_run_id, enrich_state FROM seo.crawl_runs WHERE id = $1",
            first,
        )
    )[0]
    assert run["previous_run_id"] is None and run["enrich_state"] == "done"
    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_link_changes WHERE run_id = $1", first)
    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", first)


async def test_running_it_again_leaves_the_same_rows(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await _enrich(worker_db, workspace.id, newer)
    before = await _pairs(migrated, newer, "lost", "editorial")

    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET enrich_state = 'pending', enrich_phase = NULL WHERE id = $1",
        newer,
    )
    await _enrich(worker_db, workspace.id, newer)

    assert await _pairs(migrated, newer, "lost", "editorial") == before
    assert len(await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", newer)) == 1


async def test_a_task_names_its_own_workspace_and_touches_nothing_else(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)

    outcome = await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=other.id, run_id=newer),
        deadline=time.monotonic() + 60,
    )

    assert outcome.phase is None and outcome.steps == 0
    state = await fetch(migrated, "SELECT enrich_state FROM seo.crawl_runs WHERE id = $1", newer)
    assert state[0]["enrich_state"] == "pending"


async def test_a_crawl_whose_predecessor_lost_its_links_still_gets_page_changes(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    older, newer, ids, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", older)

    await _enrich(worker_db, workspace.id, newer)

    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_link_changes WHERE run_id = $1", newer)
    pages = await fetch(migrated, "SELECT url_id FROM seo.crawl_page_changes WHERE run_id = $1", newer)
    assert {row["url_id"] for row in pages} == {ids["/pricing"], ids["/blog/b"]}
```

- [ ] **Step 3: Run and see them fail**

```bash
uv run pytest tests/collectors/test_crawl_enrich.py --no-cov -q
```

Expected: FAIL (`ModuleNotFoundError: idraft.collectors.crawl_enrich`).

- [ ] **Step 4: Implement the job**

Create `backend/src/idraft/collectors/crawl_enrich.py`:

```python
"""The second job of a crawl (plan 04 decision D1): what changed against the crawl before it,
the alert for links lost to important pages, anchor counts, and (Task 7) mentions.

It runs for crawls in a data state whose `enrich_state` is `pending` or `running`, one phase
at a time, each phase one transaction that moves the crawl to the next phase. Five failed
passes in a row end it as `failed`; the crawl itself is never touched, so a bug here cannot take
a good crawl away. Every statement names the workspace, because the worker bypasses row-level
security.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

import structlog
from pydantic import BaseModel
from sqlalchemy import ARRAY, Text, bindparam, case, delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.crawl.anchors import GENERIC_ANCHORS
from idraft.crawl.changes import CHANGES_MAX, AlertSettings, alert_due, alert_settings
from idraft.db.tables import (
    crawl_alerts,
    crawl_link_changes,
    crawl_page_changes,
    crawl_runs,
    projects,
)
from idraft.storage.raw import ObjectStore

ENRICH_JOB: Final = "crawl_enrich"
ENRICH_PASS_TIME: Final = timedelta(minutes=6)
ENRICH_FAILURES_MAX: Final = 5
_DATA_STATES: Final = ("ready", "stopped_at_ceiling")
_LONG_STATEMENT_TIMEOUT: Final = text("SET LOCAL statement_timeout = '5min'")
_EDGE_CHARS: Final = "\\s\"'\u201c\u2018\u201d\u2019"
_log = structlog.get_logger(__name__)


class CrawlEnrichTask(BaseModel):
    """The message of the `crawl_enrich` job: one finished crawl."""

    workspace_id: UUID
    run_id: UUID

    @property
    def dedupe_key(self) -> str:
        return f"{ENRICH_JOB}:{self.run_id}"


@dataclass(frozen=True, slots=True)
class EnrichOutcome:
    phase: str | None
    steps: int
    busy: bool = False
    failed: bool = False


@dataclass(frozen=True, slots=True)
class _Run:
    id: UUID
    workspace_id: UUID
    project_id: UUID
    created_at: datetime
    phase: str | None
    offset: int
    links_kept: bool


type Step = Callable[[async_sessionmaker[AsyncSession], ObjectStore | None, _Run], Awaitable[bool]]


async def _read_run(
    sessions: async_sessionmaker[AsyncSession], task: CrawlEnrichTask
) -> _Run | None:
    """The crawl, when it is in a data state and its enrichment has work left."""
    async with sessions() as db:
        row = (
            await db.execute(
                select(
                    crawl_runs.c.id,
                    crawl_runs.c.workspace_id,
                    crawl_runs.c.project_id,
                    crawl_runs.c.created_at,
                    crawl_runs.c.enrich_phase,
                    crawl_runs.c.enrich_offset,
                    crawl_runs.c.links_dropped_at,
                ).where(
                    crawl_runs.c.workspace_id == task.workspace_id,
                    crawl_runs.c.id == task.run_id,
                    crawl_runs.c.state.in_(_DATA_STATES),
                    crawl_runs.c.enrich_state.in_(("pending", "running")),
                )
            )
        ).one_or_none()
    if row is None:
        return None
    return _Run(
        id=row.id,
        workspace_id=row.workspace_id,
        project_id=row.project_id,
        created_at=row.created_at,
        phase=row.enrich_phase or "changes",
        offset=row.enrich_offset,
        links_kept=row.links_dropped_at is None,
    )


async def _locked(db: AsyncSession, run: _Run) -> bool:
    """One pass at a time per crawl: a transaction lock, gone with the transaction."""
    got: bool = (
        await db.execute(
            select(func.pg_try_advisory_xact_lock(func.hashtextextended(f"{ENRICH_JOB}:{run.id}", 0)))
        )
    ).scalar_one()
    return got


# ------------------------------------------------------------------------------------------
# Phase 1: changes against the previous crawl, and the alert

_PREVIOUS = text(
    """
    SELECT p.id, p.links_dropped_at IS NULL AS links_kept
    FROM seo.crawl_runs p
    WHERE p.workspace_id = CAST(:workspace_id AS uuid) AND p.project_id = CAST(:project_id AS uuid)
      AND p.state IN ('ready', 'stopped_at_ceiling')
      AND (p.created_at, p.id) < (CAST(:created_at AS timestamptz), CAST(:run_id AS uuid))
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1
    """
)
_PAGE_CHANGES = text(
    """
    INSERT INTO seo.crawl_page_changes (run_id, workspace_id, url_id, is_new, editorial_in_delta,
                                        equity_points, depth_state, depth_delta)
    SELECT c.run_id, c.workspace_id, c.url_id, p.url_id IS NULL,
           CASE WHEN p.url_id IS NULL THEN NULL
                ELSE c.linking_pages_editorial - p.linking_pages_editorial END,
           CASE WHEN p.url_id IS NULL THEN NULL ELSE
                (round(((coalesce(c.equity_share, 0) - coalesce(p.equity_share, 0)) * 1000)::numeric)
                 / 10)::double precision END,
           CASE WHEN p.url_id IS NULL THEN NULL
                WHEN p.click_depth IS NULL AND c.click_depth IS NOT NULL THEN 'found'
                WHEN p.click_depth IS NOT NULL AND c.click_depth IS NULL THEN 'lost' END,
           CASE WHEN p.url_id IS NOT NULL AND p.click_depth IS NOT NULL
                     AND c.click_depth IS NOT NULL THEN c.click_depth - p.click_depth END
    FROM seo.crawl_pages c
    LEFT JOIN seo.crawl_pages p ON p.run_id = CAST(:previous_id AS uuid)
         AND p.workspace_id = c.workspace_id AND p.url_id = c.url_id
    WHERE c.run_id = CAST(:run_id AS uuid) AND c.workspace_id = CAST(:workspace_id AS uuid)
      AND (p.url_id IS NULL
           OR c.linking_pages_editorial <> p.linking_pages_editorial
           OR c.click_depth IS DISTINCT FROM p.click_depth
           OR round(((coalesce(c.equity_share, 0) - coalesce(p.equity_share, 0)) * 1000)::numeric) <> 0)
    """
)
# One representative link per source and target pair in a scope: the first by scope order.
_PAIRS = """
    SELECT DISTINCT ON (source_url_id, target_url_id)
           source_url_id, target_url_id, placement, anchor
    FROM seo.crawl_links
    WHERE run_id = CAST(:{run} AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND source_url_id <> target_url_id {scope}
    ORDER BY source_url_id, target_url_id,
             CASE scope WHEN 'editorial' THEN 0 WHEN 'auto_generated' THEN 1 ELSE 2 END, id
"""
_LINK_CHANGES = """
    WITH now_pairs AS ({now}), before_pairs AS ({before})
    INSERT INTO seo.crawl_link_changes (run_id, workspace_id, change, scope, source_url_id,
                                        target_url_id, placement, anchor, still_linked_by)
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), 'added', :scope,
           n.source_url_id, n.target_url_id, n.placement, left(n.anchor, 500), NULL
    FROM (SELECT * FROM now_pairs n WHERE NOT EXISTS (
            SELECT 1 FROM before_pairs b
            WHERE b.source_url_id = n.source_url_id AND b.target_url_id = n.target_url_id)
          LIMIT :cap) n
    UNION ALL
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), 'lost', :scope,
           b.source_url_id, b.target_url_id, b.placement, left(b.anchor, 500),
           {still}
    FROM (SELECT * FROM before_pairs b WHERE NOT EXISTS (
            SELECT 1 FROM now_pairs n
            WHERE n.source_url_id = b.source_url_id AND n.target_url_id = b.target_url_id)
          LIMIT :cap) b
"""
_STILL_ANY_SCOPE = """(SELECT l.placement FROM seo.crawl_links l
        WHERE l.run_id = CAST(:run_id AS uuid) AND l.workspace_id = CAST(:workspace_id AS uuid)
          AND l.source_url_id = b.source_url_id AND l.target_url_id = b.target_url_id
        ORDER BY CASE l.scope WHEN 'editorial' THEN 0 WHEN 'auto_generated' THEN 1 ELSE 2 END, l.id
        LIMIT 1)"""
_LOST_TO_TOP = text(
    """
    SELECT count(*) FROM seo.crawl_link_changes lc
    JOIN core.project_pages pp ON pp.workspace_id = lc.workspace_id
         AND pp.project_id = CAST(:project_id AS uuid) AND pp.url_id = lc.target_url_id
    JOIN core.page_tier_levels t ON t.id = pp.tier_id AND t.workspace_id = pp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = 'lost' AND lc.scope = 'editorial' AND t.position <= :max_position
    """
)


def _link_change_statement(scope: str) -> Any:
    """The diff of one scope. `editorial` compares editorial links only and says what else still
    links a lost pair; `all` compares every link, so a lost pair has nothing left."""
    scope_filter = "AND scope = 'editorial'" if scope == "editorial" else ""
    return text(
        _LINK_CHANGES.format(
            now=_PAIRS.format(run="run_id", scope=scope_filter),
            before=_PAIRS.format(run="previous_id", scope=scope_filter),
            still=_STILL_ANY_SCOPE if scope == "editorial" else "NULL",
        )
    )


def deliver_alert(settings: AlertSettings) -> str:
    """The delivery state of a new alert (decision D5). The alert always shows in the app. Email
    and Slack have no sender in this repository yet; when the alerts service (WP-47) is merged
    this is the one place that writes its event and returns `delivered`."""
    return "shown_in_app" if settings.channel == "app" else "channel_unavailable"


async def _evaluate_alert(db: AsyncSession, run: _Run) -> None:
    stored = (
        await db.execute(
            select(projects.c.settings).where(
                projects.c.workspace_id == run.workspace_id, projects.c.id == run.project_id
            )
        )
    ).scalar_one()
    settings = alert_settings((stored or {}).get("internal_links"))
    count: int = (
        await db.execute(
            _LOST_TO_TOP,
            {
                "run_id": str(run.id),
                "workspace_id": str(run.workspace_id),
                "project_id": str(run.project_id),
                "max_position": settings.max_position,
            },
        )
    ).scalar_one()
    if not alert_due(count, settings):
        return
    await db.execute(
        crawl_alerts.insert().values(
            run_id=run.id,
            workspace_id=run.workspace_id,
            project_id=run.project_id,
            lost_links=count,
            max_position=settings.max_position,
            threshold=settings.threshold,
            channel=settings.channel,
            delivery_state=deliver_alert(settings),
        )
    )


async def _changes(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None, run: _Run
) -> bool:
    async with sessions() as db, db.begin():
        await db.execute(_LONG_STATEMENT_TIMEOUT)
        if not await _locked(db, run):
            return False
        for table in (crawl_link_changes, crawl_page_changes, crawl_alerts):
            await db.execute(
                delete(table).where(
                    table.c.run_id == run.id, table.c.workspace_id == run.workspace_id
                )
            )
        keys = {"run_id": str(run.id), "workspace_id": str(run.workspace_id)}
        previous = (
            await db.execute(
                _PREVIOUS,
                {
                    **keys,
                    "project_id": str(run.project_id),
                    "created_at": run.created_at,
                },
            )
        ).one_or_none()
        if previous is not None:
            both = {**keys, "previous_id": str(previous.id)}
            await db.execute(_PAGE_CHANGES, both)
            if previous.links_kept and run.links_kept:
                for scope in ("editorial", "all"):
                    await db.execute(
                        _link_change_statement(scope), {**both, "scope": scope, "cap": CHANGES_MAX}
                    )
        await _evaluate_alert(db, run)
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(
                previous_run_id=None if previous is None else previous.id,
                enrich_state="running",
                enrich_phase="anchors",
                enrich_offset=0,
                enrich_failures=0,
            )
        )
    return True


# ------------------------------------------------------------------------------------------
# Phase 2: editorial anchor counts per page, for the "Mostly generic anchors" flag

_ANCHORS = text(
    """
    UPDATE seo.crawl_pages p SET editorial_anchors = c.total, generic_anchors = c.generic
    FROM (SELECT target_url_id, count(*) AS total,
                 count(*) FILTER (WHERE lower(regexp_replace(anchor, :edge, '', 'g'))
                                        = ANY(:generic)) AS generic
          FROM seo.crawl_links
          WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
            AND scope = 'editorial' AND source_url_id <> target_url_id
          GROUP BY target_url_id) c
    WHERE p.run_id = CAST(:run_id AS uuid) AND p.workspace_id = CAST(:workspace_id AS uuid)
      AND p.url_id = c.target_url_id
    """
).bindparams(bindparam("generic", type_=ARRAY(Text)))


async def _anchors(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None, run: _Run
) -> bool:
    async with sessions() as db, db.begin():
        await db.execute(_LONG_STATEMENT_TIMEOUT)
        if not await _locked(db, run):
            return False
        if run.links_kept:
            await db.execute(
                _ANCHORS,
                {
                    "run_id": str(run.id),
                    "workspace_id": str(run.workspace_id),
                    "edge": f"^[{_EDGE_CHARS}]+|[{_EDGE_CHARS}]+$",
                    "generic": sorted(GENERIC_ANCHORS),
                },
            )
        # Task 7 changes the next phase to `mentions`.
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(enrich_state="done", enrich_phase="done", enrich_offset=0, enrich_failures=0)
        )
    return True


_STEPS: Final[dict[str, Step]] = {"changes": _changes, "anchors": _anchors}


async def _failed_pass(sessions: async_sessionmaker[AsyncSession], run: _Run) -> None:
    """Count a failed pass; the fifth in a row ends the enrichment as `failed`."""
    async with sessions() as db, db.begin():
        await db.execute(
            update(crawl_runs)
            .where(
                crawl_runs.c.workspace_id == run.workspace_id,
                crawl_runs.c.id == run.id,
                crawl_runs.c.enrich_state.in_(("pending", "running")),
            )
            .values(
                enrich_failures=crawl_runs.c.enrich_failures + 1,
                enrich_state=case(
                    (crawl_runs.c.enrich_failures + 1 >= ENRICH_FAILURES_MAX, "failed"),
                    else_=crawl_runs.c.enrich_state,
                ),
            )
        )


async def enrich_run(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore | None,
    task: CrawlEnrichTask,
    *,
    deadline: float,
) -> EnrichOutcome:
    """One pass: phases until the crawl is enriched or `deadline` (`time.monotonic()`) has
    passed; at least one phase is taken. It reads the database, and in Task 7 raw HTML from
    storage; it never calls a provider and spends nothing."""
    steps = 0
    while True:
        run = await _read_run(sessions, task)
        if run is None or run.phase not in _STEPS:
            return EnrichOutcome(phase=None if run is None else run.phase, steps=steps)
        try:
            applied = await _STEPS[run.phase](sessions, store, run)
        except Exception as failure:
            _log.error(
                "crawl enrich step failed",
                run_id=str(run.id),
                phase=run.phase,
                error=type(failure).__name__,
            )
            await _failed_pass(sessions, run)
            return EnrichOutcome(phase=run.phase, steps=steps, failed=True)
        if not applied:
            return EnrichOutcome(phase=run.phase, steps=steps, busy=True)
        steps += 1
        if time.monotonic() >= deadline:
            return EnrichOutcome(phase=run.phase, steps=steps)
```

- [ ] **Step 5: Run the tests**

```bash
uv run pytest tests/collectors/test_crawl_enrich.py --no-cov -q
```

Expected: PASS (10 tests). If `test_a_crawl_whose_predecessor_lost_its_links...` fails on the partition drop, the seed's `seed_crawl` made the partition with `seo.add_crawl_links_partition`, and `drop_crawl_links_partition` is executable by the test role; run it as the migrator through `execute` (it is).

- [ ] **Step 6: Let the tick send the job**

In `backend/src/idraft/collectors/crawl_runs.py`:

1. Add after `type SendIngest = ...`:

```python
type SendEnrich = Callable[[CrawlEnrichTask], Awaitable[bool]]
```

and import `from idraft.collectors.crawl_enrich import CrawlEnrichTask` with the other imports (`crawl_enrich` does not import `crawl_runs`, so there is no cycle).

2. Add the field `enrich_sent: int = 0` to `CrawlTickReport` (after `flows`), and `"enrich_sent"` to the tuple of count names at the top of `crawl_tick`.

3. Add a keyword parameter `send_enrich: SendEnrich | None = None` to `crawl_tick` (after `send_ingest`), and, before the `tier_flow_stale` loop:

```python
    if send_enrich is not None:
        for run in await _rows(
            sessions,
            crawl_runs.c.state.in_(DATA_STATES),
            crawl_runs.c.enrich_state.in_(("pending", "running")),
        ):
            with _isolated("enrich", run.id):
                if await send_enrich(CrawlEnrichTask(workspace_id=run.workspace_id, run_id=run.id)):
                    counts["enrich_sent"] += 1
```

In `backend/src/idraft/worker/assembly.py`: import `from idraft.collectors.crawl_enrich import ENRICH_JOB, ENRICH_PASS_TIME, CrawlEnrichTask, enrich_run`, then add next to `ingest_handler`:

```python
def enrich_handler(context: WorkerContext) -> Callable[[CrawlEnrichTask], Awaitable[None]]:
    """The `crawl_enrich` job: one pass over one crawl's extras. One at a time per worker
    process: the mention phase reads raw HTML and keeps one step's pages in memory."""
    one_at_a_time = asyncio.Semaphore(1)

    async def crawl_enrich(task: CrawlEnrichTask) -> None:
        async with one_at_a_time:
            outcome = await enrich_run(
                context.sessions,
                context.raw_store,
                task,
                deadline=time.monotonic() + ENRICH_PASS_TIME.total_seconds(),
            )
        _log.info("crawl enrich pass", run_id=str(task.run_id), **asdict(outcome))

    return crawl_enrich
```

and inside `crawl_ticks`, after the `if on_page is not None: context.queues.register(...)` block:

```python
    context.queues.register("process", ENRICH_JOB, enrich_handler(context))

    async def send_crawl_enrich(task: CrawlEnrichTask) -> bool:
        return await context.queues.enqueue(ENRICH_JOB, task, dedupe_key=task.dedupe_key)
```

and pass `send_enrich=send_crawl_enrich` in the `crawl_tick(...)` call.

- [ ] **Step 7: Run the crawl tests and the worker assembly tests**

```bash
uv run pytest tests/collectors tests/worker -n 4 --no-cov -q
```

Expected: PASS. A test that compares `CrawlTickReport()` to a report or lists the registered jobs (`tests/worker/test_assembly.py`) may need `enrich_sent` or the job name added; make the smallest change that states the new job.

- [ ] **Step 8: Gate and commit**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/collectors/crawl_enrich.py backend/src/idraft/collectors/crawl_runs.py backend/src/idraft/worker/assembly.py backend/tests/api/internal_links/support_changes.py backend/tests/collectors/test_crawl_enrich.py
git commit -m "Internal links: crawl_enrich job with link and page changes, the alert and anchor counts"
```

(Add any worker test file you changed in step 7 to the `git add` line by name.)

---

### Task 7: `crawl_enrich`: mentions

**Files:**
- Modify: `backend/src/idraft/collectors/crawl_enrich.py`
- Create: `backend/tests/collectors/test_crawl_enrich_mentions.py`

**Read first:** `backend/src/idraft/crawl/mentions.py` (Task 5), `backend/src/idraft/collectors/crawl_ingest.py` (`html_key`, how HTML is stored with `compress`), `backend/src/idraft/storage/raw.py` (`ObjectStore`, `decompress`, `RawStorageError`), `backend/src/idraft/api/keywords/repository.py` (`LABS`), `backend/tests/collectors/test_crawl_ingest.py` (how the tests build an in-memory store).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/collectors/test_crawl_enrich_mentions.py`:

```python
"""The mention phase of `crawl_enrich` (plan 04 Task 7, decisions D11 and D12)."""

from __future__ import annotations

import time
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from idraft.collectors.crawl_ingest import html_key
from idraft.storage.raw import RawStorageError, compress
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.internal_links.support import SeedLink, seed_crawl, set_counts
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        try:
            return self.objects[key]
        except KeyError:
            raise RawStorageError("reading a payload failed: NoSuchKey") from None


PAGE = (
    "<html><body><main><p>Teams ask about managed detection and response before they buy."
    " Our SOC as a service runs all night.</p></main></body></html>"
)


async def _site(
    pg: PostgresServer,
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int], MemoryStore]:
    """A crawl of four pages, all reachable, with the same HTML stored for each. "/" links to
    "/soc" in its text and to "/mdr" only through the menu."""
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    run, ids = await seed_crawl(
        pg,
        workspace,
        project,
        [("/", 200), ("/mdr", 200), ("/soc", 200), ("/blog/a", 200)],
        [
            SeedLink("/", "/mdr", "navigation", "MDR"),
            SeedLink("/", "/blog/a", "content", "Post"),
            SeedLink("/", "/soc", "content", "SOC as a service"),
        ],
    )
    await set_counts(pg, run)
    await execute(pg, "UPDATE seo.crawl_pages SET click_depth = 1 WHERE run_id = $1", run)
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET click_depth = 0 WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/"],
    )
    store = MemoryStore()
    for url in ids.values():
        row = await fetch(pg, "SELECT url_hash FROM core.urls WHERE id = $1", url)
        store.objects[html_key(project, row[0]["url_hash"])] = compress(PAGE.encode())
    return workspace, project, run, ids, store


async def _track(
    pg: PostgresServer, workspace: Workspace, project: uuid.UUID, keyword: str, target: int
) -> None:
    """A tracked keyword of a page (the keyword's text is its normalized text here)."""
    await execute(
        pg,
        "WITH k AS (INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $4, $4, 'en') RETURNING id) "
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, target_url_id) SELECT $1, $2, k.id, "
        "(SELECT default_location_id FROM core.projects WHERE id = $2), 'en', 'desktop', $3 FROM k",
        workspace.id,
        project,
        target,
        keyword,
    )


async def test_a_page_that_mentions_a_keyword_of_another_page_gets_a_mention(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, run, ids, store = await _site(migrated)
    await _track(migrated, workspace, project, "managed detection and response", ids["/mdr"])

    outcome = await enrich_run(
        worker_db,
        store,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 120,
    )

    assert not outcome.failed
    rows = await fetch(
        migrated,
        "SELECT su.path AS source, tu.path AS target, m.phrase, m.origin FROM seo.crawl_mentions m "
        "JOIN core.urls su ON su.id = m.source_url_id JOIN core.urls tu ON tu.id = m.target_url_id "
        "WHERE m.run_id = $1",
        run,
    )
    pairs = {(row["source"], row["target"], row["phrase"], row["origin"]) for row in rows}
    assert ("/", "/mdr", "managed detection and response", "keyword") in pairs
    # No page mentions itself.
    assert all(source != target for source, target, _, _ in pairs)
```

- [ ] **Step 2: Run, see it fail**

```bash
uv run pytest tests/collectors/test_crawl_enrich_mentions.py --no-cov -q
```

Expected: FAIL (no `crawl_mentions` rows: the phase does not exist yet).

- [ ] **Step 3: Add the phase**

In `crawl_enrich.py`:

1. Change the end of `_anchors`: `enrich_state="done", enrich_phase="done"` becomes `enrich_state="running", enrich_phase="mentions"` (the comment above it goes).
2. Add these imports: `from sqlalchemy.dialects.postgresql import insert as upsert`, `from idraft.crawl.mentions import PhraseSet, find_mentions, index_phrases, visible_text`, `from idraft.collectors.crawl_ingest import html_key`, `from idraft.storage.raw import ObjectStore, RawStorageError, decompress`, `from idraft.db.tables import crawl_mentions, crawl_pages, urls`.
3. Add the constants and the phase before `_STEPS`:

```python
MENTION_PAGES_PER_STEP: Final = 25
_KEYWORD_PHRASES = text(
    """
    SELECT tk.target_url_id AS url_id, k.text AS phrase
    FROM seo.tracked_keywords tk
    JOIN seo.keywords k ON k.id = tk.keyword_id AND k.workspace_id = tk.workspace_id
    WHERE tk.workspace_id = CAST(:workspace_id AS uuid) AND tk.project_id = CAST(:project_id AS uuid)
      AND tk.is_active AND tk.deleted_at IS NULL AND tk.target_url_id IS NOT NULL
    """
)
# Anchors at least two other pages use to link to a page by an editorial link.
_ANCHOR_PHRASES = text(
    """
    SELECT target_url_id AS url_id, min(anchor) AS phrase
    FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND scope = 'editorial' AND source_url_id <> target_url_id AND anchor <> ''
    GROUP BY target_url_id, lower(anchor)
    HAVING count(DISTINCT source_url_id) >= 2
    """
)


async def _mentions(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None, run: _Run
) -> bool:
    """25 source pages per step: read the stored HTML, take the visible text and look for the
    phrases of every live indexable target. A page whose HTML is gone has no mention."""
    keys = {"run_id": str(run.id), "workspace_id": str(run.workspace_id)}
    async with sessions() as db:
        sources = (
            await db.execute(
                select(crawl_pages.c.url_id, urls.c.url_hash)
                .join(urls, urls.c.id == crawl_pages.c.url_id)
                .where(
                    crawl_pages.c.workspace_id == run.workspace_id,
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.status_code == 200,
                    crawl_pages.c.is_indexable,
                    crawl_pages.c.click_depth.is_not(None),
                    crawl_pages.c.links_state == "from_html",
                    crawl_pages.c.url_id > run.offset,
                )
                .order_by(crawl_pages.c.url_id)
                .limit(MENTION_PAGES_PER_STEP)
            )
        ).all()
        targets = {
            row.url_id
            for row in await db.execute(
                select(crawl_pages.c.url_id).where(
                    crawl_pages.c.workspace_id == run.workspace_id,
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.status_code == 200,
                    crawl_pages.c.is_indexable,
                )
            )
        }
        keywords: dict[int, list[str]] = {}
        for row in await db.execute(
            _KEYWORD_PHRASES, {**keys, "project_id": str(run.project_id)}
        ):
            keywords.setdefault(row.url_id, []).append(row.phrase)
        anchors: dict[int, list[str]] = {}
        for row in await db.execute(_ANCHOR_PHRASES, keys):
            anchors.setdefault(row.url_id, []).append(row.phrase)
        sets = {
            url: PhraseSet(keywords.get(url, ()), anchors.get(url, ()))
            for url in targets
            if url in keywords or url in anchors
        }
        index = index_phrases(sets)
        already: dict[int, set[int]] = {}
        if sources:
            for row in await db.execute(
                text(
                    "SELECT DISTINCT source_url_id, target_url_id FROM seo.crawl_links "
                    "WHERE run_id = CAST(:run_id AS uuid) "
                    "AND workspace_id = CAST(:workspace_id AS uuid) AND scope = 'editorial' "
                    "AND source_url_id = ANY(:sources)"
                ).bindparams(bindparam("sources", type_=ARRAY(BigInteger))),
                {**keys, "sources": [row.url_id for row in sources]},
            ):
                already.setdefault(row.source_url_id, set()).add(row.target_url_id)
    found: list[dict[str, object]] = []
    for source in sources:
        if store is None or not index:
            break
        try:
            html = decompress(await store.get(html_key(run.project_id, source.url_hash)))
        except RawStorageError:
            continue
        text_of_page = visible_text(html.decode("utf-8", errors="replace"))
        for mention in find_mentions(
            text_of_page,
            index,
            source_url_id=source.url_id,
            skip=already.get(source.url_id, set()),
        ):
            found.append(
                {
                    "run_id": run.id,
                    "workspace_id": run.workspace_id,
                    "source_url_id": source.url_id,
                    "target_url_id": mention.target_url_id,
                    "phrase": mention.phrase[:200],
                    "context": mention.context[:400],
                    "origin": mention.origin,
                }
            )
    async with sessions() as db, db.begin():
        if not await _locked(db, run):
            return False
        if run.offset == 0:
            await db.execute(
                delete(crawl_mentions).where(
                    crawl_mentions.c.run_id == run.id,
                    crawl_mentions.c.workspace_id == run.workspace_id,
                )
            )
        if found:
            # A retried step may meet rows it already wrote: the primary key makes that harmless
            await db.execute(upsert(crawl_mentions).values(found).on_conflict_do_nothing())
        last = sources[-1].url_id if sources else run.offset
        finished = len(sources) < MENTION_PAGES_PER_STEP
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(
                enrich_state="done" if finished else "running",
                enrich_phase="done" if finished else "mentions",
                enrich_offset=0 if finished else last,
                enrich_failures=0,
            )
        )
    return True
```

Add `BigInteger` to the sqlalchemy import and register the phase: `_STEPS = {"changes": _changes, "anchors": _anchors, "mentions": _mentions}`.

- [ ] **Step 4: Run the mention test and the earlier enrich tests**

```bash
uv run pytest tests/collectors/test_crawl_enrich_mentions.py tests/collectors/test_crawl_enrich.py --no-cov -q
```

Expected: PASS. `test_crawl_enrich.py` passes `None` as the store, so its crawls finish with no mention (the step reads no HTML when `store` is None). If a test there asserted `enrich_phase == "done"` straight after anchors, it still does, because the `mentions` step runs in the same pass.

- [ ] **Step 5: Add the test for a pair that is already linked**

Append to `test_crawl_enrich_mentions.py`:

```python
async def test_a_target_the_source_already_links_to_by_an_editorial_link_is_not_a_mention(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, run, ids, store = await _site(migrated)
    await _track(migrated, workspace, project, "soc as a service", ids["/soc"])

    await enrich_run(
        worker_db,
        store,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 120,
    )

    rows = await fetch(
        migrated,
        "SELECT 1 FROM seo.crawl_mentions WHERE run_id = $1 AND source_url_id = $2 "
        "AND target_url_id = $3",
        run,
        ids["/"],
        ids["/soc"],
    )
    # "/" links to "/soc" in its text ("SOC as a service"), so there is no opportunity.
    assert rows == []
```

Run `uv run pytest tests/collectors/test_crawl_enrich_mentions.py --no-cov -q` (PASS).

- [ ] **Step 6: Gate and commit**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/collectors/crawl_enrich.py backend/tests/collectors/test_crawl_enrich_mentions.py
git commit -m "Internal links: mentions found in stored HTML by the crawl_enrich job"
```

---

### Task 8: Search Console page totals

**Files:**
- Create: `backend/src/idraft/collectors/gsc_pages.py`
- Modify: `backend/src/idraft/collectors/gsc_sync.py` (`SyncContext`, `_Pass`)
- Modify: `backend/src/idraft/worker/assembly.py` (`page_totals=True`)
- Modify: `backend/tests/collectors/gsc_support.py` (the fake)
- Create: `backend/tests/collectors/test_gsc_pages.py`

**Read first:** `backend/src/idraft/collectors/gsc_sync.py` (`_Pass._query`, `_day`, `_store`, `run`), `backend/src/idraft/collectors/gsc_store.py` (`IntegrationFacts`, `replace_day`, `_insert_chunks`), `backend/src/idraft/domain/gsc_pull.py` (decision text on `ALL_PAGES`), `backend/src/idraft/extraction/urls.py` (`canonicalize`, `CanonicalUrl.url_hash`), `backend/tests/collectors/gsc_support.py` (`FakeSearchConsole._analytics`, `make_property`, `sync_context`), `backend/tests/collectors/test_gsc_sync.py`.

Decision D10 explains why: the pull stores every row with `url_id = 0`, so no page number exists. This task adds one small table and one extra call per day (`[date, page]`), kept apart so the query rows stay as they are.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/collectors/test_gsc_pages.py`:

```python
"""Clicks and impressions per page and day (plan 04 Task 8, decision D10)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_pages import (
    PageDayRow,
    page_clicks,
    page_day_rows,
    prune_pages,
    replace_page_day,
    stored_page_days,
)
from idraft.collectors.gsc_store import load_integration
from idraft.db.engine import workspace_transaction
from idraft.providers.google.client import AnalyticsRow
from idraft.providers.google.errors import GoogleResponseError
from tests.api.internal_links.support import url_id
from tests.collectors.gsc_support import SITE, FakeSearchConsole, make_property, sync_context
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]
DAY = date(2026, 11, 10)


def row(page: str, clicks: int, impressions: int, day: date = DAY) -> AnalyticsRow:
    return AnalyticsRow(keys=(day.isoformat(), page), clicks=clicks, impressions=impressions, position=3.0)


def test_two_spellings_of_one_page_are_added_together_and_a_bad_address_is_set_aside() -> None:
    rows, skipped = page_day_rows(
        [
            row("https://example.com/pricing", 4, 40),
            row("https://EXAMPLE.com/pricing", 1, 10),
            row("not a url", 9, 90),
        ],
        DAY,
    )
    assert skipped == 1
    assert len(rows) == 1
    assert (rows[0].clicks, rows[0].impressions) == (5, 50)


def test_a_row_of_another_day_is_refused() -> None:
    with pytest.raises(GoogleResponseError):
        page_day_rows([row("https://example.com/", 1, 1, day=DAY + timedelta(days=1))], DAY)


async def test_a_day_replaces_the_day_and_only_known_urls_are_kept(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    known = await url_id(migrated, "https://example.com/pricing")
    rows, _ = page_day_rows(
        [row("https://example.com/pricing", 4, 40), row("https://example.com/never-seen-xyz", 1, 5)],
        DAY,
    )
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        written, unknown = await replace_page_day(db, facts, DAY, rows)
        again, _ = await replace_page_day(db, facts, DAY, rows)
        days = await stored_page_days(db, facts, DAY - timedelta(days=2), DAY)
        totals = await page_clicks(
            db, prop.workspace_id, prop.project_id, prop.integration_id, (DAY, DAY), None
        )
    assert (written, unknown, again) == (1, 1, 1)
    assert days == {DAY}
    assert (totals[known].clicks, totals[known].impressions) == (4, 40)


async def test_old_days_are_pruned(migrated: PostgresServer, worker_db: Sessions) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    await url_id(migrated, "https://example.com/pricing")
    old, new = DAY - timedelta(days=40), DAY
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        for day in (old, new):
            rows, _ = page_day_rows([row("https://example.com/pricing", 1, 1, day)], day)
            await replace_page_day(db, facts, day, rows)
        await prune_pages(db, facts, DAY - timedelta(days=35))
        days = await stored_page_days(db, facts, old, new)
    assert days == {new}


async def test_a_pass_with_page_totals_asks_for_page_rows_over_the_window_and_stores_them(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    from idraft.collectors.gsc_sync import sync_integration
    from tests.collectors.gsc_support import fill

    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    await url_id(migrated, "https://example.com/pricing")
    days = fill(fake, SITE, days=40)
    for day in days:
        fake.set_page_day(SITE, day, [("https://example.com/pricing", 3, 30)])

    report = await sync_integration(
        sync_context(worker_db, fake, page_totals=True), prop.workspace_id, prop.integration_id
    )

    assert report.more is False
    async with workspace_transaction(worker_db, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
        assert facts is not None
        stored = await stored_page_days(db, facts, days[0], days[-1])
    # The 28 days that end the window, not the older history.
    assert stored == set(days[-28:])
    assert {body["startDate"] for body in fake.page_requests() if body["startRow"] == 0} == {
        day.isoformat() for day in days[-28:]
    }


async def test_a_pass_without_page_totals_makes_no_page_request(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    from idraft.collectors.gsc_sync import sync_integration
    from tests.collectors.gsc_support import fill

    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    fill(fake, SITE, days=5)
    await sync_integration(sync_context(worker_db, fake), prop.workspace_id, prop.integration_id)
    assert fake.page_requests() == []
```

(`PageDayRow` is imported so the test fails early when the name is missing; remove the import if the linter flags it unused after the module exists.)

- [ ] **Step 2: Extend the fake**

In `backend/tests/collectors/gsc_support.py`, class `FakeSearchConsole`:

1. In `__init__` add `self.page_days: dict[str, dict[date, list[tuple[str, int, int]]]] = {}`.
2. Add the methods:

```python
    def set_page_day(self, site: str, day: date, rows: list[tuple[str, int, int]]) -> None:
        self.page_days.setdefault(site, {})[day] = rows

    def page_requests(self, site: str | None = None) -> list[dict[str, Any]]:
        return [
            body
            for requested, body in self.requests
            if body["dimensions"] == ["date", "page"] and (site is None or requested == site)
        ]
```

3. Change `detail_requests` so the page request does not count as a detail request:

```python
            if len(body["dimensions"]) > 1
            and body["dimensions"] != ["date", "page"]
            and (site is None or requested == site)
```

4. In `_analytics`, before `if body["dimensions"] == ["date"]:` add:

```python
        if body["dimensions"] == ["date", "page"]:
            pages = [
                {
                    "keys": [day.isoformat(), url],
                    "clicks": float(clicks),
                    "impressions": float(impressions),
                    "ctr": 0.1,
                    "position": 3.0,
                }
                for day, items in sorted(self.page_days.get(site, {}).items())
                if start <= day <= end and (body["dataState"] == "all" or day <= self.final_through)
                for url, clicks, impressions in items
            ]
            pages = pages[body["startRow"] : body["startRow"] + body["rowLimit"]]
            return httpx.Response(200, json={"rows": pages} if pages else {})
```

(The `start`, `end` and `site` variables are those the method already computes above that point.)

- [ ] **Step 3: Run, see them fail**

```bash
uv run pytest tests/collectors/test_gsc_pages.py --no-cov -q
```

Expected: FAIL (`ModuleNotFoundError: idraft.collectors.gsc_pages`).

- [ ] **Step 4: Implement the store**

Create `backend/src/idraft/collectors/gsc_pages.py`:

```python
"""Clicks and impressions per page and day from Search Console (plan 04 decision D10).

The query pull stores every row over all pages (`domain/gsc_pull.ALL_PAGES`), because summing
pages overstates impressions. A page's own numbers are asked for apart, with the dimensions
`[date, page]`, and kept in `fp.gsc_page_daily`: one row per property, day and page. They are
shown as what they are, Google's numbers for the page, never added up into a site total.

Only addresses that `core.urls` already knows are kept: a crawl or a tracked keyword made the
URL, and a page nobody crawled has no row in the screens that use these numbers.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.gsc_store import IntegrationFacts
from idraft.db.tables import gsc_page_daily, urls
from idraft.domain.gsc_pull import WINDOW_DAYS
from idraft.extraction.urls import UrlRejectedError, canonicalize
from idraft.providers.google.client import AnalyticsRow
from idraft.providers.google.errors import GoogleResponseError

PAGE_DAYS = WINDOW_DAYS
PAGE_KEEP_DAYS = 35
_CHUNK = 5_000


@dataclass(frozen=True, slots=True)
class PageDayRow:
    url_hash: bytes
    clicks: int
    impressions: int


@dataclass(frozen=True, slots=True)
class PageClicks:
    clicks: int
    impressions: int


def page_day_rows(rows: Sequence[AnalyticsRow], day: date) -> tuple[list[PageDayRow], int]:
    """`[date, page]` rows as rows to store, and how many were left out: an address the
    canonicalizer refuses. Spellings that canonicalize to one URL are added together."""
    merged: dict[bytes, tuple[int, int]] = {}
    skipped = 0
    for row in rows:
        stamp, page = row.keys
        if stamp != day.isoformat():
            raise GoogleResponseError("a row is of another day than the one asked for")
        try:
            url_hash = canonicalize(page).url_hash
        except (UrlRejectedError, ValueError):
            skipped += 1
            continue
        clicks, impressions = merged.get(url_hash, (0, 0))
        merged[url_hash] = (clicks + row.clicks, impressions + row.impressions)
    return [PageDayRow(key, *values) for key, values in merged.items()], skipped


async def replace_page_day(
    db: AsyncSession, facts: IntegrationFacts, day: date, rows: Sequence[PageDayRow]
) -> tuple[int, int]:
    """Make `rows` the day's rows. Returns (written, unknown): the rows kept, and the pages whose
    URL `core.urls` does not know. Running it again with the same rows changes nothing."""
    ids: dict[bytes, int] = {}
    for start in range(0, len(rows), _CHUNK):
        chunk = [row.url_hash for row in rows[start : start + _CHUNK]]
        found = await db.execute(select(urls.c.url_hash, urls.c.id).where(urls.c.url_hash.in_(chunk)))
        ids.update({row.url_hash: row.id for row in found})
    await db.execute(
        delete(gsc_page_daily).where(
            gsc_page_daily.c.workspace_id == facts.workspace_id,
            gsc_page_daily.c.integration_id == facts.integration_id,
            gsc_page_daily.c.metric_date == day,
        )
    )
    kept = [
        {
            "integration_id": facts.integration_id,
            "metric_date": day,
            "url_id": ids[row.url_hash],
            "workspace_id": facts.workspace_id,
            "project_id": facts.project_id,
            "clicks": row.clicks,
            "impressions": row.impressions,
        }
        for row in rows
        if row.url_hash in ids
    ]
    for start in range(0, len(kept), _CHUNK):
        await db.execute(upsert(gsc_page_daily).values(kept[start : start + _CHUNK]))
    return len(kept), len(rows) - len(kept)


async def stored_page_days(
    db: AsyncSession, facts: IntegrationFacts, start: date, end: date
) -> set[date]:
    rows = await db.execute(
        select(gsc_page_daily.c.metric_date)
        .where(
            gsc_page_daily.c.workspace_id == facts.workspace_id,
            gsc_page_daily.c.integration_id == facts.integration_id,
            gsc_page_daily.c.metric_date.between(start, end),
        )
        .distinct()
    )
    return {row.metric_date for row in rows}


async def prune_pages(db: AsyncSession, facts: IntegrationFacts, before: date) -> None:
    await db.execute(
        delete(gsc_page_daily).where(
            gsc_page_daily.c.workspace_id == facts.workspace_id,
            gsc_page_daily.c.integration_id == facts.integration_id,
            gsc_page_daily.c.metric_date < before,
        )
    )


async def page_clicks(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    window: tuple[date, date],
    url_ids: Collection[int] | None,
) -> dict[int, PageClicks]:
    """Clicks and impressions per page over `window` (inclusive), for `url_ids` or, when None,
    for every page that has a row. A page with no row in the window is absent, not zero: the
    caller says 0 only when the property is connected and its pull is `ok`."""
    statement = (
        select(
            gsc_page_daily.c.url_id,
            func.sum(gsc_page_daily.c.clicks).label("clicks"),
            func.sum(gsc_page_daily.c.impressions).label("impressions"),
        )
        .where(
            gsc_page_daily.c.workspace_id == workspace_id,
            gsc_page_daily.c.project_id == project_id,
            gsc_page_daily.c.integration_id == integration_id,
            gsc_page_daily.c.metric_date.between(*window),
        )
        .group_by(gsc_page_daily.c.url_id)
    )
    if url_ids is not None:
        statement = statement.where(gsc_page_daily.c.url_id.in_(list(url_ids)))
    return {
        row.url_id: PageClicks(int(row.clicks), int(row.impressions))
        for row in await db.execute(statement)
    }
```

- [ ] **Step 5: Hook the pull**

In `backend/src/idraft/collectors/gsc_sync.py`:

1. Add `page_totals: bool = False` as the last field of `SyncContext`, and import `from idraft.collectors import gsc_pages`.
2. In `_Pass`, add the methods (next to `_day` and `_stored`):

```python
    async def _page_day(self, day: date) -> list[AnalyticsRow]:
        rows: list[AnalyticsRow] = []
        while True:
            page = await self._query(
                start=day, end=day, dimensions=("date", "page"), start_row=len(rows)
            )
            if not page:
                return rows
            rows.extend(page)

    async def _pages_window(self, probe: Sequence[date], start: date, end: date) -> bool:
        """The page rows of the days of the window that have none yet, one call per day, and the
        pruning of days past `PAGE_KEEP_DAYS`. True when it stopped on the budget."""
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            have = await gsc_pages.stored_page_days(db, self._facts, start, end)
        for day in probe:
            if day < start or day > end or day in have:
                continue
            if self._out_of_time():
                return True
            rows, skipped = gsc_pages.page_day_rows(await self._page_day(day), day)
            async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
                written, unknown = await gsc_pages.replace_page_day(db, self._facts, day, rows)
            if skipped or unknown:
                _log.info(
                    "gsc page rows set aside",
                    integration_id=str(self._facts.integration_id),
                    day=day.isoformat(),
                    skipped=skipped,
                    unknown=unknown,
                    written=written,
                )
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            await gsc_pages.prune_pages(
                db, self._facts, end - timedelta(days=gsc_pages.PAGE_KEEP_DAYS)
            )
        return False
```

3. In `run()`, after the `for day in recent:` loop and before the comment "The sweep's ends are set once", add:

```python
        if self._ctx.page_totals and await self._pages_window(probe, window_start, latest):
            return True
```

In `backend/src/idraft/worker/assembly.py`, the `SyncContext(...)` call gets `page_totals=True`.

- [ ] **Step 6: Run**

```bash
uv run pytest tests/collectors/test_gsc_pages.py tests/collectors/test_gsc_sync.py tests/collectors/test_gsc_plan.py --no-cov -q
```

Expected: PASS. The old tests are unchanged because `page_totals` defaults to false and the fake excludes page requests from `detail_requests`.

- [ ] **Step 7: Gate and commit**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/collectors/gsc_pages.py backend/src/idraft/collectors/gsc_sync.py backend/src/idraft/worker/assembly.py backend/tests/collectors/gsc_support.py backend/tests/collectors/test_gsc_pages.py
git commit -m "Internal links: Search Console clicks per page, pulled apart from the query rows"
```

---
### Task 9: The crawl list for the picker, and older crawls

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`CrawlRun`, `ListMeta`)
- Modify: `backend/src/idraft/api/internal_links/crawls.py` (`CrawlRecord`, `_record`), `crawl_routes.py` (`crawl_view`)
- Modify: `backend/src/idraft/api/internal_links/problems.py`, `page_filter.py` (`PageScope`), `page_tiers.py` (`crawl_scope`), `reads.py`, `read_routes.py`
- Modify: `backend/src/idraft/collectors/crawl_store.py` (`flow_rows`)
- Create: `backend/tests/api/internal_links/test_older_crawls.py`

**Read first:** `backend/src/idraft/api/internal_links/crawls.py` (`CrawlRecord`, `_record`), `crawl_routes.py` (`crawl_view`), `page_tiers.py` (`crawl_scope`), `reads.py` (`tier_flow`, `edges`, `edges_csv`, `neighbors`), `collectors/crawl_store.py` (`_FLOW`, `_STATS`), `tests/api/internal_links/test_reads_flow.py`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/internal_links/test_older_crawls.py`:

```python
"""Older crawls (plan 04 Task 9, decision D15): the crawl list says what each crawl still
holds, links of a dropped crawl are gone with a plain error, and an older crawl's tier flow
follows today's tiers."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_crawl_list_says_which_crawls_still_hold_their_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, newer, _, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", older)
    await execute(migrated, "UPDATE seo.crawl_runs SET previous_run_id = $2 WHERE id = $1", newer, older)

    response = await api.get(project_url(workspace, project, "link-crawls"), headers=viewer.headers)

    runs = {run["run_id"]: run for run in response.json()["data"]}
    assert runs[str(older)]["links_available"] is False
    assert runs[str(newer)]["links_available"] is True
    assert runs[str(newer)]["previous_run_id"] == str(older)
    assert runs[str(newer)]["enrich_state"] == "pending"


async def test_links_of_a_dropped_crawl_are_gone_but_its_pages_are_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, _, ids, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", older)
    base = project_url(workspace, project, "internal-links")

    pages = await api.get(f"{base}/pages", params={"run": str(older)}, headers=viewer.headers)
    edges = await api.get(f"{base}/edges", params={"run": str(older)}, headers=viewer.headers)
    neighbors = await api.get(
        f"{base}/neighbors",
        params={"run": str(older), "url_id": ids["/"], "direction": "out"},
        headers=viewer.headers,
    )

    assert pages.status_code == 200
    assert pages.json()["meta"]["links_available"] is False
    assert problem(edges) == (410, "links_dropped")
    assert problem(neighbors) == (410, "links_dropped")


async def test_an_older_crawls_tier_flow_follows_the_tiers_of_today(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, newer, _, _ = await two_crawls(migrated, workspace, project)
    base = project_url(workspace, project, "internal-links")

    old = await api.get(
        f"{base}/tier-flow", params={"run": str(older), "scope": "editorial"}, headers=viewer.headers
    )
    latest = await api.get(
        f"{base}/tier-flow", params={"run": str(newer), "scope": "editorial"}, headers=viewer.headers
    )

    cells = {
        (
            None if cell["from_tier"] is None else cell["from_tier"]["code"],
            None if cell["to_tier"] is None else cell["to_tier"]["code"],
        ): cell["links"]
        for cell in old.json()["data"]["cells"]
    }
    # Two editorial pairs (/blog and /blog/a to /pricing, a T1 page) from untiered pages.
    assert cells == {(None, "T1"): 2}
    assert old.json()["data"]["stale"] is False
    # The latest crawl keeps its stored flow, which nothing has computed in this test.
    assert latest.json()["data"]["cells"] == []
```

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/api/internal_links/test_older_crawls.py --no-cov -q
```

Expected: FAIL (`KeyError: 'links_available'`).

- [ ] **Step 3: The contract fields**

In `schemas/internal_links.py`, `CrawlRun`: add after `is_latest`:

```python
    links_available: bool = Field(
        description="False once the crawl's links were dropped (past the last four finished "
        "crawls): its pages stay, links, journeys and changes of links are gone."
    )
    previous_run_id: UUID | None = Field(description="The crawl its changes are measured against.")
    enrich_state: Literal["pending", "running", "done", "failed"] = Field(
        description="State of the second job: changes, anchors and mentions."
    )
```

In `ListMeta` add `links_available: bool = True` (a plain default keeps the model valid for callers that do not know it, and Step 5 sets it everywhere it is built).

In `crawls.py`, `CrawlRecord` add `links_available: bool`, `previous_run_id: UUID | None`, `enrich_state: str`, and in `_record`: `links_available=row.links_dropped_at is None, previous_run_id=row.previous_run_id, enrich_state=row.enrich_state,`. In `crawl_routes.py` `crawl_view`, pass `links_available=record.links_available, previous_run_id=record.previous_run_id, enrich_state=record.enrich_state,` to `CrawlRun(...)`. (`_runs_query` selects every column of `crawl_runs`, so the new ones are there.)

- [ ] **Step 4: The problem, the scope and the guard**

In `problems.py` add:

```python
class LinksDroppedError(ProblemError):
    """The crawl's links were dropped to save space: only its pages are kept."""

    status, code, title = 410, "links_dropped", "This crawl no longer holds its links"
```

In `page_filter.py` extend the dataclass (defaults keep every existing positional call valid):

```python
@dataclass(frozen=True, slots=True)
class PageScope:
    workspace_id: UUID
    project_id: UUID
    run_id: UUID
    equity_p25: float | None
    links_dropped: bool = False
    # Tier positions 1 to this one count as important for the "lost to top tiers" worklist.
    alert_max_position: int = 2

    def require_links(self) -> None:
        if self.links_dropped:
            raise LinksDroppedError
```

with `from idraft.api.internal_links.problems import LinksDroppedError` at the top. In `page_tiers.py` `crawl_scope`: select `crawl_runs.c.links_dropped_at` next to `equity_p25` and `state`, read the project's alert setting, and return the longer scope:

```python
    settings = (
        await db.execute(
            select(projects.c.settings).where(
                projects.c.workspace_id == access.workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one_or_none()
    alerts = alert_settings((settings or {}).get("internal_links"))
    return PageScope(
        access.workspace_id,
        project_id,
        run_id,
        row.equity_p25,
        links_dropped=row.links_dropped_at is not None,
        alert_max_position=alerts.max_position,
    )
```

(import `projects` from `idraft.db.tables` and `alert_settings` from `idraft.crawl.changes`.)

In `reads.py`, call `scope.require_links()` on the line after `scope = await read_scope(...)` in `neighbors`, `edges` and `edges_csv` (not in `pages`, `pages_csv`, `page_detail`, `tier_flow` or `worklists`: they stay readable, with link counts that are the stored ones). Where the pages list builds its `ListMeta` (`read_routes.py` lines that call `ListMeta(run_id=..., scope=..., total=...)`), pass `links_available=not listed.links_dropped` and add `links_dropped: bool` to `PageList` and `EdgeList` (set `links_dropped=scope.links_dropped` where they are built).

- [ ] **Step 5: The tier flow of an older crawl**

In `crawl_store.py` split the two statements into a body and an insert, so one statement serves both:

```python
_FLOW_BODY = """
    WITH pairs AS (
        SELECT DISTINCT l.source_url_id, l.target_url_id, l.scope
        FROM seo.crawl_links l
        WHERE l.run_id = CAST(:run_id AS uuid) AND l.workspace_id = CAST(:workspace_id AS uuid)
          AND l.source_url_id <> l.target_url_id
    ), tagged AS (
        SELECT p.source_url_id, p.target_url_id, p.scope,
               fp.tier_id AS from_tier, tp.tier_id AS to_tier
        FROM pairs p
        LEFT JOIN core.project_pages fp ON fp.workspace_id = CAST(:workspace_id AS uuid)
             AND fp.project_id = CAST(:project_id AS uuid) AND fp.url_id = p.source_url_id
        LEFT JOIN core.project_pages tp ON tp.workspace_id = CAST(:workspace_id AS uuid)
             AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = p.target_url_id
    )
    SELECT scope, from_tier, to_tier, count(*) AS links FROM tagged
    GROUP BY scope, from_tier, to_tier
    UNION ALL
    SELECT 'all', from_tier, to_tier, count(DISTINCT (source_url_id, target_url_id)) AS links
    FROM tagged GROUP BY from_tier, to_tier
"""
_FLOW = text(
    "INSERT INTO seo.crawl_tier_flow (run_id, workspace_id, scope, from_tier_id, to_tier_id, "
    "links) SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), scope, from_tier, "
    "to_tier, links FROM (" + _FLOW_BODY + ") flow"
)
_FLOW_READ = text(_FLOW_BODY)
_STATS_BODY = """
    SELECT pp.tier_id, count(*) AS pages, coalesce(sum(cp.equity_share), 0) AS equity_share,
           avg(cp.click_depth) AS average_depth
    FROM seo.crawl_pages cp
    LEFT JOIN core.project_pages pp ON pp.workspace_id = CAST(:workspace_id AS uuid)
         AND pp.project_id = cp.project_id AND pp.url_id = cp.url_id
    WHERE cp.run_id = CAST(:run_id AS uuid) AND cp.workspace_id = CAST(:workspace_id AS uuid)
    GROUP BY pp.tier_id
"""
_STATS = text(
    "INSERT INTO seo.crawl_tier_stats (run_id, workspace_id, tier_id, pages, equity_share, "
    "average_depth) SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), tier_id, pages, "
    "equity_share, average_depth FROM (" + _STATS_BODY + ") stats"
)
_STATS_READ = text(_STATS_BODY)


@dataclass(frozen=True, slots=True)
class FlowCell:
    scope: str
    from_tier_id: UUID | None
    to_tier_id: UUID | None
    links: int


@dataclass(frozen=True, slots=True)
class FlowStat:
    tier_id: UUID | None
    pages: int
    equity_share: float
    average_depth: float | None


async def flow_rows(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, run_id: UUID
) -> tuple[list[FlowCell], list[FlowStat]]:
    """The flow matrix and the per-tier strip of one crawl from today's tiers, without storing
    them (an older crawl's flow, plan 04 D15)."""
    keys = {
        "run_id": str(run_id),
        "workspace_id": str(workspace_id),
        "project_id": str(project_id),
    }
    cells = [
        FlowCell(row.scope, row.from_tier, row.to_tier, row.links)
        for row in await db.execute(_FLOW_READ, keys)
    ]
    stats = [
        FlowStat(row.tier_id, row.pages, row.equity_share, row.average_depth)
        for row in await db.execute(
            _STATS_READ, {"run_id": keys["run_id"], "workspace_id": keys["workspace_id"]}
        )
    ]
    return cells, stats
```

(add `from dataclasses import dataclass` if missing). `recompute_tier_flow` keeps calling `db.execute(_FLOW, keys)` and `db.execute(_STATS, ...)` as it does; its tests stay green because the inserted columns are the same.

In `reads.py` `tier_flow`, after `stale` is read, insert before `cells = [...]`:

```python
            latest = await latest_run(db, access.workspace_id, project_id)
            links_stored: int = (
                await db.execute(
                    select(crawl_runs.c.links_stored).where(crawl_runs.c.id == scope.run_id)
                )
            ).scalar_one()
            if (
                scope.run_id != latest
                and not scope.links_dropped
                and links_stored <= INLINE_FLOW_LINKS
            ):
                live_cells, live_stats = await flow_rows(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    run_id=scope.run_id,
                )
                strip_by_tier = {row.tier_id: row for row in live_stats}
                return TierFlow(
                    run_id=scope.run_id,
                    scope=view.value,
                    stale=False,
                    cells=[
                        TierFlowCell(
                            from_tier=tiers.ref(cell.from_tier_id),
                            to_tier=tiers.ref(cell.to_tier_id),
                            links=cell.links,
                        )
                        for cell in live_cells
                        if cell.scope == view.value
                    ],
                    tiers=[
                        TierStat(
                            tier=ref,
                            pages=0 if (row := strip_by_tier.get(tier_id)) is None else row.pages,
                            equity_share=0.0 if row is None else row.equity_share,
                            average_depth=None if row is None else row.average_depth,
                        )
                        for tier_id, ref in [*tiers.refs.items(), (None, None)]
                    ],
                )
```

with the imports `from idraft.collectors.crawl_store import INLINE_FLOW_LINKS, flow_rows, latest_run`.

- [ ] **Step 6: Run, gate, commit**

```bash
uv run pytest tests/api/internal_links tests/collectors/test_crawl_store.py -n 4 --no-cov -q
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/api/schemas/internal_links.py backend/src/idraft/api/internal_links backend/src/idraft/collectors/crawl_store.py backend/tests/api/internal_links/test_older_crawls.py
git commit -m "Internal links: the crawl list says what each crawl holds, dropped links answer 410, older crawls follow today's tiers"
```

Expected: PASS, including the earlier read tests (their `ListMeta` and `PageScope` calls keep working through the defaults). Then regenerate the contract: `uv run python -m idraft.api.openapi > openapi/v1.json` and `git add backend/openapi/v1.json` in the same commit if the file changed.

---

### Task 10: The Changes API and the alert settings

**Files:**
- Create: `backend/src/idraft/api/schemas/internal_links_extra.py`
- Create: `backend/src/idraft/api/internal_links/changes.py`, `change_routes.py`
- Modify: `backend/src/idraft/api/schemas/operations.py`, `backend/src/idraft/api/operations/settings.py`
- Modify: `backend/src/idraft/api/resources.py`, `main.py`
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Create: `backend/tests/api/internal_links/test_changes_api.py`

**Read first:** `api/internal_links/reads.py` (`LinkReadService`, `load_tiers`, `read_scope`), `read_routes.py` (route style), `api/internal_links/csv_export.py`, `api/operations/settings.py` (`update`), `api/schemas/operations.py` (`InternalLinksSettings`), `api/resources.py`, `api/main.py`, `tests/api/internal_links/test_link_settings.py`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/internal_links/test_changes_api.py`:

```python
"""What changed between crawls and the alert settings (plan 04 Task 10)."""

from __future__ import annotations

import time
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _ready(
    pg: PostgresServer, sessions: Sessions
) -> tuple[Workspace, uuid.UUID, uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    older, newer, ids, tiers = await two_crawls(pg, workspace, project)
    await enrich_run(
        sessions,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=newer),
        deadline=time.monotonic() + 120,
    )
    return workspace, project, older, newer, ids, tiers


async def test_the_summary_counts_both_scopes_and_the_links_lost_to_important_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, older, newer, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "summary"),
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert data["state"] == "ready"
    assert data["previous_run_id"] == str(older)
    assert (data["editorial_lost"], data["editorial_added"]) == (2, 2)
    assert (data["all_lost"], data["all_added"]) == (1, 2)
    assert data["lost_to_top"] == 2 and data["important_max_position"] == 2
    assert (data["pages_added"], data["pages_lost"]) == (0, 0)
    assert data["alert"] == {
        "lost_links": 2,
        "max_position": 2,
        "threshold": 1,
        "channel": "app",
        "delivery_state": "shown_in_app",
    }
    assert newer


async def test_the_summary_follows_the_alert_settings_and_a_tier_change_moves_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, ids, tiers = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    url = project_url(workspace, project, "internal-links", "changes", "summary")
    await execute(
        migrated,
        "UPDATE core.projects SET settings = jsonb_build_object('internal_links', "
        "jsonb_build_object('alerts', jsonb_build_object('threshold', 3))) WHERE id = $1",
        project,
    )
    below = await api.get(url, headers=viewer.headers)
    # /pricing moves to T4: it no longer counts as important.
    await execute(
        migrated,
        "UPDATE core.project_pages SET tier_id = $3 WHERE project_id = $1 AND url_id = $2",
        project,
        ids["/pricing"],
        tiers[3],
    )
    moved = await api.get(url, headers=viewer.headers)

    assert below.json()["data"]["alert"] is None
    assert below.json()["data"]["lost_to_top"] == 2
    assert moved.json()["data"]["lost_to_top"] == 0


async def test_a_first_crawl_and_a_crawl_still_being_enriched_say_so(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "internal-links", "changes", "summary")

    pending = await api.get(url, headers=viewer.headers)
    await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 60,
    )
    first = await api.get(url, headers=viewer.headers)

    assert pending.json()["data"]["state"] == "pending"
    assert first.json()["data"]["state"] == "first_crawl"
    assert first.json()["data"]["alert"] is None


async def test_lost_links_list_t1_first_with_priority_and_what_still_links_the_pair(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project, "internal-links", "changes", "links")

    lost = await api.get(base, params={"change": "lost"}, headers=viewer.headers)
    top = await api.get(base, params={"change": "lost", "only": "top"}, headers=viewer.headers)
    added = await api.get(
        base, params={"change": "added", "link_scope": "all"}, headers=viewer.headers
    )

    rows = lost.json()["data"]
    assert [(row["source"]["path"], row["target"]["path"]) for row in rows] == [
        ("/blog", "/pricing"),
        ("/blog/a", "/pricing"),
    ]
    assert {row["priority"] for row in rows} == {"lost_to_t1"}
    assert [row["still_linked_by"] for row in rows] == [None, "navigation"]
    assert rows[0]["target"]["tier"]["code"] == "T1"
    assert lost.json()["meta"]["total"] == 2
    assert len(top.json()["data"]) == 2
    assert {row["priority"] for row in added.json()["data"]} == {"none"}


async def test_the_lost_links_come_as_csv(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "links"),
        params={"change": "lost", "format": "csv"},
        headers=viewer.headers,
    )

    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.splitlines()
    assert lines[0] == "Change,Source,Target,Anchor,Link type,Target tier,Still linked from"
    assert len(lines) == 3


async def test_pages_that_moved_most_come_with_their_numbers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "pages"),
        headers=viewer.headers,
    )

    rows = response.json()["data"]
    # Both moved by two; the tie is broken by path.
    assert [(row["page"]["path"], row["editorial_in_delta"]) for row in rows] == [
        ("/blog/b", 2),
        ("/pricing", -2),
    ]
    assert rows[1]["editorial_in"] == 0


async def test_a_member_of_another_workspace_gets_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    outsider_workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, outsider_workspace, "viewer")

    for tail in ("summary", "links", "pages"):
        response = await api.get(
            project_url(workspace, project, "internal-links", "changes", tail),
            params={"change": "lost"},
            headers=outsider.headers,
        )
        assert problem(response)[0] in (403, 404), tail


async def test_alert_settings_merge_and_email_and_slack_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    url = project_url(workspace, project, "settings")

    first = await api.patch(
        url, json={"internal_links": {"alerts": {"threshold": 5}}}, headers=editor.headers
    )
    second = await api.patch(
        url, json={"internal_links": {"alerts": {"max_position": 1}}}, headers=editor.headers
    )
    refused = await api.patch(
        url, json={"internal_links": {"alerts": {"channel": "email"}}}, headers=editor.headers
    )

    assert first.status_code == 200, first.text
    assert second.json()["data"]["internal_links"]["alerts"] == {
        "enabled": True,
        "max_position": 1,
        "threshold": 5,
        "channel": "app",
    }
    assert problem(refused) == (422, "validation_failed")
```

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/api/internal_links/test_changes_api.py --no-cov -q
```

Expected: FAIL (404 on the new routes).

- [ ] **Step 3: The models**

Create `backend/src/idraft/api/schemas/internal_links_extra.py`:

```python
"""Bodies and answers of slices 2 and 3 of the internal link tracker (plan 04, API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.schemas.internal_links import PlacementName, TierRef, UrlIdText

AlertChannel = Literal["app", "email", "slack"]
DeliveryState = Literal["shown_in_app", "channel_unavailable"]
LostPriority = Literal["lost_to_t1", "lost_to_t2", "lower", "none"]


class ChangePage(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    tier: TierRef | None = Field(description="null is Untiered.")


class ChangeAlert(BaseModel):
    lost_links: int
    max_position: int
    threshold: int
    channel: AlertChannel
    delivery_state: DeliveryState


class ChangesSummary(BaseModel):
    run_id: UUID
    previous_run_id: UUID | None
    previous_finished_at: datetime | None
    state: Literal["first_crawl", "pending", "ready", "unavailable"] = Field(
        description="`pending` until the crawl's changes are worked out, `unavailable` after "
        "five failed passes."
    )
    editorial_lost: int
    editorial_added: int
    all_lost: int
    all_added: int
    lost_to_top: int = Field(description="Editorial links lost to the important tiers.")
    important_max_position: int
    pages_added: int
    pages_lost: int
    alert: ChangeAlert | None


class ChangesSummaryResponse(BaseModel):
    data: ChangesSummary


class ChangeLink(BaseModel):
    source: ChangePage
    target: ChangePage
    anchor: str
    placement: PlacementName
    priority: LostPriority
    still_linked_by: PlacementName | None = Field(
        description="Another link that still joins the pair in this crawl (editorial scope)."
    )


class ChangeLinkMeta(BaseModel):
    run_id: UUID
    previous_run_id: UUID | None
    change: Literal["lost", "added"]
    link_scope: Literal["editorial", "all"]
    only: Literal["top", "all"]
    total: int
    truncated: bool = Field(description="The stored changes were cut at 200,000 rows.")


class ChangeLinkPage(BaseModel):
    data: list[ChangeLink]
    meta: ChangeLinkMeta


class MovedPage(BaseModel):
    page: ChangePage
    editorial_in: int
    editorial_in_delta: int | None
    equity_points: float | None
    depth: int | None
    depth_state: Literal["lost", "found"] | None
    depth_delta: int | None


class MovedPageMeta(BaseModel):
    run_id: UUID
    previous_run_id: UUID | None


class MovedPageList(BaseModel):
    data: list[MovedPage]
    meta: MovedPageMeta


class AlertSettings(BaseModel):
    enabled: bool = True
    max_position: int = Field(
        default=2, ge=1, le=8, description="Tier positions 1 to this one are important."
    )
    threshold: int = Field(default=1, ge=1, le=50, description="Lost links that raise an alert.")
    channel: AlertChannel = "app"
```

- [ ] **Step 4: The alert settings in the project settings**

In `api/schemas/operations.py`: import `AlertSettings` and `AlertChannel` from `idraft.api.schemas.internal_links_extra`, add to `InternalLinksSettings`:

```python
    alerts: AlertSettings = Field(
        default_factory=AlertSettings,
        description="The alert for links lost to the important tiers (spec 7.10).",
    )
```

Add the patch model next to `InternalLinksSettingsPatch`:

```python
class AlertSettingsPatch(Patch):
    enabled: bool | None = None
    max_position: Annotated[int, Field(ge=1, le=8)] | None = None
    threshold: Annotated[int, Field(ge=1, le=50)] | None = None
    channel: AlertChannel | None = None

    _not_null = field_validator("enabled", "max_position", "threshold", "channel")(refuse_null)

    @field_validator("channel")
    @classmethod
    def _only_the_app(cls, value: AlertChannel | None) -> AlertChannel | None:
        if value in ("email", "slack"):
            raise ValueError("channel_unavailable: email and Slack alerts are not available yet")
        return value
```

and give `InternalLinksSettingsPatch` the member `alerts: AlertSettingsPatch | None = None` (add `"alerts"` to its `refuse_null` validator names; its `_says_something` check already counts any set field).

In `api/operations/settings.py` `update`, merge the alerts one level deep: replace the loop body for `internal_links` with

```python
            for part, patch in (("seo", body.seo), ("internal_links", body.internal_links)):
                if patch is None:
                    continue
                given = patch.model_dump(mode="json", exclude_unset=True)
                merged = {**(stored.get(part) or {}), **given}
                if part == "internal_links" and "alerts" in given:
                    merged["alerts"] = {**((stored.get(part) or {}).get("alerts") or {}), **given["alerts"]}
                changed[part] = merged
```

- [ ] **Step 5: The service**

Create `backend/src/idraft/api/internal_links/changes.py`:

```python
"""Reads of what a crawl changed against the one before it (plan 04 D2 to D4, D17). The change
rows are stored by `crawl_enrich`; tiers are joined when read, so a tier change moves the
Priority and the "lost to important tiers" counts, as in the mock."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, Final, Literal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.csv_export import EXPORT_ROWS_MAX, csv_text
from idraft.api.internal_links.reads import Tiers, load_tiers, read_scope
from idraft.api.schemas.internal_links_extra import (
    ChangeAlert,
    ChangeLink,
    ChangeLinkMeta,
    ChangeLinkPage,
    ChangePage,
    ChangesSummary,
    MovedPage,
    MovedPageList,
    MovedPageMeta,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.changes import CHANGES_MAX, alert_due, alert_settings, priority_of
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_runs, projects

PLACEMENT_LABEL: Final = {
    "content": "Content",
    "auto_generated": "Auto-generated",
    "navigation": "Navigation",
    "footer": "Footer",
    "breadcrumb": "Breadcrumb",
    "header": "Header",
    "sidebar": "Sidebar",
}
_COUNTS = text(
    """
    SELECT count(*) FILTER (WHERE change = 'lost' AND scope = 'editorial') AS editorial_lost,
           count(*) FILTER (WHERE change = 'added' AND scope = 'editorial') AS editorial_added,
           count(*) FILTER (WHERE change = 'lost' AND scope = 'all') AS all_lost,
           count(*) FILTER (WHERE change = 'added' AND scope = 'all') AS all_added
    FROM seo.crawl_link_changes
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
    """
)
_LOST_TO_TOP = text(
    """
    SELECT count(*) FROM seo.crawl_link_changes lc
    JOIN core.project_pages pp ON pp.workspace_id = lc.workspace_id
         AND pp.project_id = CAST(:project_id AS uuid) AND pp.url_id = lc.target_url_id
    JOIN core.page_tier_levels t ON t.id = pp.tier_id AND t.workspace_id = pp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = 'lost' AND lc.scope = 'editorial' AND t.position <= :max_position
    """
)
_PAGES_LOST = text(
    """
    SELECT count(*) FROM seo.crawl_pages p
    WHERE p.run_id = CAST(:previous_id AS uuid) AND p.workspace_id = CAST(:workspace_id AS uuid)
      AND NOT EXISTS (SELECT 1 FROM seo.crawl_pages c
                      WHERE c.run_id = CAST(:run_id AS uuid) AND c.workspace_id = p.workspace_id
                        AND c.url_id = p.url_id)
    """
)
_LINKS = """
    SELECT lc.source_url_id, lc.target_url_id, lc.placement, lc.anchor, lc.still_linked_by,
           su.canonical_url AS source_url, su.path AS source_path,
           tu.canonical_url AS target_url, tu.path AS target_path,
           sp.tier_id AS source_tier, tp.tier_id AS target_tier, tl.position AS target_position
    FROM seo.crawl_link_changes lc
    JOIN core.urls su ON su.id = lc.source_url_id
    JOIN core.urls tu ON tu.id = lc.target_url_id
    LEFT JOIN core.project_pages sp ON sp.workspace_id = lc.workspace_id
         AND sp.project_id = CAST(:project_id AS uuid) AND sp.url_id = lc.source_url_id
    LEFT JOIN core.project_pages tp ON tp.workspace_id = lc.workspace_id
         AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = lc.target_url_id
    LEFT JOIN core.page_tier_levels tl ON tl.id = tp.tier_id AND tl.workspace_id = tp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = :change AND lc.scope = :scope {top}
    ORDER BY coalesce(tl.position, 99), su.path, tu.path
    LIMIT :limit OFFSET :offset
"""
_TOP = "AND tl.position <= :max_position"
_MOVED = text(
    """
    SELECT pc.url_id, pc.editorial_in_delta, pc.equity_points, pc.depth_state, pc.depth_delta,
           cp.linking_pages_editorial AS editorial_in, cp.click_depth, u.canonical_url, u.path,
           pp.tier_id
    FROM seo.crawl_page_changes pc
    JOIN seo.crawl_pages cp ON cp.run_id = pc.run_id AND cp.url_id = pc.url_id
         AND cp.workspace_id = pc.workspace_id
    JOIN core.urls u ON u.id = pc.url_id
    LEFT JOIN core.project_pages pp ON pp.workspace_id = pc.workspace_id
         AND pp.project_id = CAST(:project_id AS uuid) AND pp.url_id = pc.url_id
    WHERE pc.run_id = CAST(:run_id AS uuid) AND pc.workspace_id = CAST(:workspace_id AS uuid)
      AND NOT pc.is_new AND cp.status_code = 200
      AND (coalesce(pc.editorial_in_delta, 0) <> 0 OR coalesce(pc.depth_delta, 0) <> 0
           OR pc.depth_state IS NOT NULL)
    ORDER BY abs(coalesce(pc.editorial_in_delta, 0)) DESC, abs(coalesce(pc.depth_delta, 0)) DESC,
             u.path
    LIMIT :limit
    """
)


def _page(url_id: int, url: str, path: str, tier_id: UUID | None, tiers: Tiers) -> ChangePage:
    return ChangePage(url_id=str(url_id), url=url, path=path, tier=tiers.ref(tier_id))


class ChangeService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    @staticmethod
    async def _run_row(db: AsyncSession, access: WorkspaceAccess, run_id: UUID) -> Any:
        return (
            await db.execute(
                select(
                    crawl_runs.c.previous_run_id,
                    crawl_runs.c.enrich_state,
                    crawl_runs.c.enrich_phase,
                    crawl_runs.c.project_id,
                ).where(crawl_runs.c.workspace_id == access.workspace_id, crawl_runs.c.id == run_id)
            )
        ).one()

    @staticmethod
    def _state(row: Any) -> Literal["first_crawl", "pending", "ready", "unavailable"]:
        if row.enrich_phase in ("anchors", "mentions", "done") or row.enrich_state == "done":
            return "first_crawl" if row.previous_run_id is None else "ready"
        return "unavailable" if row.enrich_state == "failed" else "pending"

    @staticmethod
    async def _alert_settings(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> Any:
        stored = (
            await db.execute(
                select(projects.c.settings).where(
                    projects.c.workspace_id == access.workspace_id, projects.c.id == project_id
                )
            )
        ).scalar_one()
        return alert_settings((stored or {}).get("internal_links"))

    async def summary(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None
    ) -> ChangesSummary:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            row = await self._run_row(db, access, scope.run_id)
            keys = {"run_id": str(scope.run_id), "workspace_id": str(access.workspace_id)}
            counts = (await db.execute(_COUNTS, keys)).one()
            settings = await self._alert_settings(db, access, project_id)
            lost_to_top: int = (
                await db.execute(
                    _LOST_TO_TOP,
                    {
                        **keys,
                        "project_id": str(project_id),
                        "max_position": settings.max_position,
                    },
                )
            ).scalar_one()
            added = (
                await db.execute(
                    text(
                        "SELECT count(*) FROM seo.crawl_page_changes WHERE run_id = "
                        "CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid) "
                        "AND is_new"
                    ),
                    keys,
                )
            ).scalar_one()
            lost_pages = 0
            finished = None
            if row.previous_run_id is not None:
                lost_pages = (
                    await db.execute(_PAGES_LOST, {**keys, "previous_id": str(row.previous_run_id)})
                ).scalar_one()
                finished = (
                    await db.execute(
                        select(crawl_runs.c.finished_at).where(
                            crawl_runs.c.workspace_id == access.workspace_id,
                            crawl_runs.c.id == row.previous_run_id,
                        )
                    )
                ).scalar_one_or_none()
            alert = None
            if alert_due(lost_to_top, settings):
                alert = ChangeAlert(
                    lost_links=lost_to_top,
                    max_position=settings.max_position,
                    threshold=settings.threshold,
                    channel=settings.channel,
                    delivery_state="shown_in_app"
                    if settings.channel == "app"
                    else "channel_unavailable",
                )
            return ChangesSummary(
                run_id=scope.run_id,
                previous_run_id=row.previous_run_id,
                previous_finished_at=finished,
                state=self._state(row),
                editorial_lost=counts.editorial_lost,
                editorial_added=counts.editorial_added,
                all_lost=counts.all_lost,
                all_added=counts.all_added,
                lost_to_top=lost_to_top,
                important_max_position=settings.max_position,
                pages_added=added,
                pages_lost=lost_pages,
                alert=alert,
            )

    async def links(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        change: Literal["lost", "added"],
        link_scope: Literal["editorial", "all"],
        only: Literal["top", "all"],
        offset: int,
        limit: int,
    ) -> ChangeLinkPage:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            row = await self._run_row(db, access, scope.run_id)
            tiers = await load_tiers(db, access.workspace_id)
            settings = await self._alert_settings(db, access, project_id)
            keys = {
                "run_id": str(scope.run_id),
                "workspace_id": str(access.workspace_id),
                "project_id": str(project_id),
                "change": change,
                "scope": link_scope,
                "limit": limit,
                "offset": offset,
                "max_position": settings.max_position,
            }
            total_statement = text(
                "SELECT count(*) FROM seo.crawl_link_changes lc "
                "LEFT JOIN core.project_pages tp ON tp.workspace_id = lc.workspace_id "
                "AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = lc.target_url_id "
                "LEFT JOIN core.page_tier_levels tl ON tl.id = tp.tier_id "
                "AND tl.workspace_id = tp.workspace_id "
                "WHERE lc.run_id = CAST(:run_id AS uuid) "
                "AND lc.workspace_id = CAST(:workspace_id AS uuid) AND lc.change = :change "
                "AND lc.scope = :scope " + (_TOP if only == "top" else "")
            )
            total: int = (await db.execute(total_statement, keys)).scalar_one()
            found = (
                await db.execute(
                    text(_LINKS.format(top=_TOP if only == "top" else "")), keys
                )
            ).all()
            data = [
                ChangeLink(
                    source=_page(
                        item.source_url_id, item.source_url, item.source_path, item.source_tier, tiers
                    ),
                    target=_page(
                        item.target_url_id, item.target_url, item.target_path, item.target_tier, tiers
                    ),
                    anchor=item.anchor,
                    placement=item.placement,
                    priority=priority_of(item.target_position) if change == "lost" else "none",
                    still_linked_by=item.still_linked_by,
                )
                for item in found
            ]
            return ChangeLinkPage(
                data=data,
                meta=ChangeLinkMeta(
                    run_id=scope.run_id,
                    previous_run_id=row.previous_run_id,
                    change=change,
                    link_scope=link_scope,
                    only=only,
                    total=total,
                    truncated=total >= CHANGES_MAX,
                ),
            )

    async def links_csv(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        change: Literal["lost", "added"],
        link_scope: Literal["editorial", "all"],
        only: Literal["top", "all"],
    ) -> str:
        listed = await self.links(
            access,
            project_id,
            run=run,
            change=change,
            link_scope=link_scope,
            only=only,
            offset=0,
            limit=EXPORT_ROWS_MAX,
        )
        return csv_text(
            (
                "Change",
                "Source",
                "Target",
                "Anchor",
                "Link type",
                "Target tier",
                "Still linked from",
            ),
            (
                (
                    change.capitalize(),
                    item.source.path,
                    item.target.path,
                    item.anchor,
                    PLACEMENT_LABEL.get(item.placement, item.placement),
                    "Untiered" if item.target.tier is None else item.target.tier.code,
                    "" if item.still_linked_by is None
                    else PLACEMENT_LABEL.get(item.still_linked_by, item.still_linked_by),
                )
                for item in listed.data
            ),
        )

    async def moved(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, limit: int
    ) -> MovedPageList:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            row = await self._run_row(db, access, scope.run_id)
            tiers = await load_tiers(db, access.workspace_id)
            found = (
                await db.execute(
                    _MOVED,
                    {
                        "run_id": str(scope.run_id),
                        "workspace_id": str(access.workspace_id),
                        "project_id": str(project_id),
                        "limit": limit,
                    },
                )
            ).all()
            return MovedPageList(
                data=[
                    MovedPage(
                        page=_page(item.url_id, item.canonical_url, item.path, item.tier_id, tiers),
                        editorial_in=item.editorial_in,
                        editorial_in_delta=item.editorial_in_delta,
                        equity_points=item.equity_points,
                        depth=item.click_depth,
                        depth_state=item.depth_state,
                        depth_delta=item.depth_delta,
                    )
                    for item in found
                ],
                meta=MovedPageMeta(run_id=scope.run_id, previous_run_id=row.previous_run_id),
            )
```

(`Tiers` is exported from `reads.py` as the dataclass of that name.)

- [ ] **Step 6: The routes and the wiring**

Create `backend/src/idraft/api/internal_links/change_routes.py`:

```python
"""Changes between crawls (spec 7.10). Every route needs `data:read`; `run` is `latest` or a
crawl id. `410 links_dropped` for the link lists of a crawl whose links were dropped."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.changes import ChangeService
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links_extra import (
    ChangeLinkPage,
    ChangesSummaryResponse,
    MovedPageList,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Run = Annotated[Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")]
_CSV: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/csv": {}}, "description": "With `format=csv`: the rows as CSV."}
}


def get_changes(resources: Annotated[Resources, Depends(get_resources)]) -> ChangeService:
    return resources.link_changes


Changes = Annotated[ChangeService, Depends(get_changes)]


def _run(run: Literal["latest"] | UUID) -> UUID | None:
    return run if isinstance(run, UUID) else None


@router.get(
    "/summary",
    summary="Counts of what the crawl changed, and the alert for links lost to important pages",
    response_model=ChangesSummaryResponse,
)
async def changes_summary(
    project_id: UUID, access: ReadData, changes: Changes, run: Run = "latest"
) -> ChangesSummaryResponse:
    return ChangesSummaryResponse(
        data=await changes.summary(access, project_id, run=_run(run))
    )


@router.get(
    "/links",
    summary="Lost or added links against the previous crawl, important targets first",
    response_model=ChangeLinkPage,
    responses=_CSV,
)
async def changes_links(
    project_id: UUID,
    access: ReadData,
    changes: Changes,
    change: Annotated[Literal["lost", "added"], Query()],
    run: Run = "latest",
    link_scope: Annotated[Literal["editorial", "all"], Query()] = "editorial",
    only: Annotated[Literal["top", "all"], Query()] = "all",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    output: Annotated[Literal["json", "csv"], Query(alias="format")] = "json",
) -> ChangeLinkPage | Response:
    if output == "csv":
        text = await changes.links_csv(
            access, project_id, run=_run(run), change=change, link_scope=link_scope, only=only
        )
        return Response(
            content=text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="internal-links-{change}.csv"'},
        )
    return await changes.links(
        access,
        project_id,
        run=_run(run),
        change=change,
        link_scope=link_scope,
        only=only,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/pages",
    summary="Pages whose editorial links in, equity or depth moved most",
    response_model=MovedPageList,
)
async def changes_pages(
    project_id: UUID,
    access: ReadData,
    changes: Changes,
    run: Run = "latest",
    limit: Annotated[int, Query(ge=1, le=50)] = 8,
) -> MovedPageList:
    return await changes.moved(access, project_id, run=_run(run), limit=limit)
```

Wiring: in `resources.py` add `link_changes: ChangeService` (import it) next to `link_reads`; in `main.py` add `link_changes=ChangeService(sessions=sessions),`, import it, and include the router with the other internal links routers (`app.include_router(change_routes.router)` in the same place as `read_routes.router`). In `tests/api/test_route_access.py` add three lines (`"data:read"`) for `GET .../internal-links/changes/summary`, `/links` and `/pages`, in the same format as the neighbouring entries.

In `tests/security/test_cross_tenant.py` add to `INTERNAL_LINK_READS`:

```python
    ("/internal-links/changes/summary", {}, False),
    ("/internal-links/changes/links", {"change": "lost", "link_scope": "all"}, True),
    ("/internal-links/changes/pages", {}, False),
```

(the seeded crawl has one lost link whose source and target are the seeded page, so the second answer names it; the other two carry no page names.)

- [ ] **Step 7: Run everything, regenerate the contract, commit**

```bash
uv run pytest tests/api/internal_links tests/api/test_route_access.py tests/security -n 4 --no-cov -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/api/schemas/internal_links_extra.py backend/src/idraft/api/internal_links/changes.py backend/src/idraft/api/internal_links/change_routes.py backend/src/idraft/api/schemas/operations.py backend/src/idraft/api/operations/settings.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py backend/tests/api/internal_links/test_changes_api.py backend/openapi/v1.json
git commit -m "Internal links: Changes reads, lost link alert and its settings"
```

Expected: PASS. Review step (owner rule, roadmap): after this task, a review of row-level security and permissions, because it adds read paths.

---

### Task 11: Page extras, flags and worklists

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py` (extras models), `schemas/internal_links.py` (`PageRow.extras`, `PageDetail.extras`, `RowFlag`, `PageFlag`, `PageWorklist`, `PageSort`, `Worklists`)
- Create: `backend/src/idraft/api/internal_links/extras.py`
- Modify: `backend/src/idraft/api/internal_links/page_filter.py`, `reads.py`, `read_routes.py`
- Create: `backend/tests/api/internal_links/test_page_extras.py`

**Read first:** `api/internal_links/reads.py` (`_page_rows`, `pages`, `page_detail`, `worklists`, `_sort_column`, `_cursor_value`), `page_filter.py`, `api/keywords/gsc_repository.py` (`scope_of`, `GscScope`), `collectors/gsc_pages.py` (Task 8), `api/keywords/repository.py` (`LABS`), `db/tables.py` (`tracked_keywords`, `tracked_keyword_state`, `keyword_metrics_current`, `ai_citations`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/internal_links/test_page_extras.py`:

```python
"""Rank, citations, anchors, Search Console and change columns of the Pages tab, the new flag
and worklists (plan 04 Task 11, decisions D7 to D10)."""

from __future__ import annotations

import time
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support_changes import track_keyword, two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt

type Sessions = async_sessionmaker[AsyncSession]


async def _setup(
    pg: PostgresServer, sessions: Sessions
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, newer, ids, tiers = await two_crawls(pg, workspace, project)
    await enrich_run(
        sessions,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=newer),
        deadline=time.monotonic() + 120,
    )
    return workspace, project, newer, ids, tiers


async def test_extras_are_absent_unless_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=viewer.headers
    )

    assert {row["extras"] for row in response.json()["data"]} == {None}


async def test_change_and_anchor_columns_follow_the_stored_changes_and_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "changes,anchors"},
        headers=viewer.headers,
    )

    rows = {row["path"]: row for row in response.json()["data"]}
    assert rows["/pricing"]["extras"]["change"]["editorial_in_delta"] == -2
    assert rows["/blog"]["extras"]["change"] is None
    anchors = rows["/blog/b"]["extras"]["anchors"]
    assert (anchors["total"], anchors["distinct"], anchors["generic"]) == (2, 2, 1)
    assert anchors["matches_keyword"] is None
    assert str(ids["/pricing"]) == rows["/pricing"]["url_id"]


async def test_tracked_keywords_rank_and_volume_come_from_the_keyword_tables(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await track_keyword(
        migrated, workspace, project, "pricing plans", ids["/pricing"], rank=4, change=2, volume=2900
    )
    await track_keyword(
        migrated, workspace, project, "soc cost", ids["/pricing"], rank=None, change=None, volume=700
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "keywords"},
        headers=viewer.headers,
    )

    keywords = {row["path"]: row for row in response.json()["data"]}["/pricing"]["extras"][
        "keywords"
    ]
    assert keywords == {"tracked": 2, "ranking": 1, "average_rank": 4.0, "best_volume": 2900}
    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/pricing"]),
        headers=viewer.headers,
    )
    rows = detail.json()["data"]["extras"]["keywords"]
    assert {(row["keyword"], row["rank"], row["change"], row["volume"]) for row in rows} == {
        ("pricing plans", 4, 2, 2900),
        ("soc cost", None, None, 700),
    }


async def test_ai_citations_count_answers_of_the_last_28_days_per_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    # Two answers of ChatGPT and one of Gemini cite /pricing.
    for engine, days_ago in (("chatgpt_web", 1), ("chatgpt_web", 2), ("gemini_web", 3)):
        await insert_citation(migrated, workspace, project, ids["/pricing"], engine, days_ago)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "citations"},
        headers=viewer.headers,
    )

    citations = {row["path"]: row for row in response.json()["data"]}["/pricing"]["extras"][
        "citations"
    ]
    assert citations == {"chatgpt": 2, "gemini": 1, "ai_mode": 0, "total": 3}


async def test_search_console_is_not_connected_without_a_property(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "gsc"},
        headers=viewer.headers,
    )

    gsc = response.json()["data"][0]["extras"]["gsc"]
    assert gsc["state"] == "not_connected" and gsc["clicks"] is None


async def test_the_generic_anchor_flag_and_the_lost_link_and_weak_outlink_worklists(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, tiers = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project, "internal-links", "pages")
    # /blog/b has two editorial anchors and one is generic: not more than half, so no flag.
    plain = await api.get(base, params={"filter[flags]": "generic_anchors"}, headers=viewer.headers)
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET generic_anchors = 2 WHERE url_id = $1",
        ids["/blog/b"],
    )
    flagged = await api.get(base, params={"filter[flags]": "generic_anchors"}, headers=viewer.headers)
    lost = await api.get(base, params={"filter[worklist]": "lost_links_top"}, headers=viewer.headers)

    assert plain.json()["data"] == []
    assert [row["path"] for row in flagged.json()["data"]] == ["/blog/b"]
    assert "generic_anchors" in flagged.json()["data"][0]["flags"]
    assert [row["path"] for row in lost.json()["data"]] == ["/pricing"]
    counts = await api.get(
        project_url(workspace, project, "internal-links", "worklists"), headers=viewer.headers
    )
    assert counts.json()["data"]["lost_links_top"] == 1
    assert counts.json()["data"]["weak_outlinks"] == 0
    assert tiers


async def test_pages_sort_by_the_change_in_editorial_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"sort": "change", "limit": 2},
        headers=viewer.headers,
    )

    assert [row["path"] for row in response.json()["data"]][0] == "/pricing"


async def insert_citation(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    url_id: int,
    engine: str,
    days_ago: int,
) -> None:
    """One answer of `engine`, `days_ago` days old, that cites the page as the project's own
    domain. The statements are those of `seed_ai` in `tests/db/support.py`."""
    observation_class = "serp_ai" if engine == "google_ai_mode" else "consumer_ui"
    async with connection(pg) as db:
        prompt_id, version_id = await insert_prompt(
            db, workspace.id, project, f"Which tool is best {uuid.uuid4().hex}?"
        )
        raw_payload_id: int = await db.fetchval(
            "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
            "compression, content_type, provider_code, provider_endpoint, fetched_at, "
            "retention_class) VALUES ('r2', $1, $2, 10, 10, 'zstd', 'application/json', "
            "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper/task_get/advanced', now(), "
            "'ai_raw') RETURNING id",
            f"ai_raw/{uuid.uuid4().hex}",
            uuid.uuid4().bytes + uuid.uuid4().bytes,
        )
        observed_at = await db.fetchval("SELECT now() - make_interval(days => $1)", days_ago)
        observation_id: int = await db.fetchval(
            "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
            "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
            "location_id, language_code, provider_code, provider_endpoint, status, answer_text, "
            "answer_char_count, has_citations, citation_count, raw_payload_id, adapter_version, "
            "normalizer_version, canonicalizer_version) VALUES ($1, $1::date, $2, $3, $4, $5, "
            "$6, $7, 'Which tool is best?', (SELECT default_location_id FROM core.projects "
            "WHERE id = $3), 'en', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', "
            "'complete', 'Acme.', 5, true, 1, $8, 1, 1, 1) RETURNING id",
            observed_at,
            workspace.id,
            project,
            engine,
            observation_class,
            prompt_id,
            version_id,
            raw_payload_id,
        )
        await db.execute(
            "INSERT INTO ai.citations (observation_id, observed_at, citation_index, "
            "workspace_id, project_id, engine_code, url_id, domain_id, raw_url, citation_kind, "
            "domain_role) SELECT $1, $2, 1, $3, $4, $5, u.id, u.domain_id, u.canonical_url, "
            "'source_list', 'own' FROM core.urls u WHERE u.id = $6",
            observation_id,
            observed_at,
            workspace.id,
            project,
            engine,
            url_id,
        )



- [ ] **Step 1b: The seed for a tracked keyword with a rank and a volume**

Append to `backend/tests/api/internal_links/support_changes.py` (add `from tests.api.auth.support import fetchrow` to its imports):

```python
async def track_keyword(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    text: str,
    target_url_id: int,
    *,
    rank: int | None,
    change: int | None,
    volume: int | None,
) -> None:
    """A tracked keyword of a page with its current rank and change, and its search volume as
    the keyword list reads it (`seo.keyword_metrics_current`, source `dataforseo_labs`, which
    needs a snapshot row)."""
    row = await fetchrow(
        pg,
        "WITH k AS (INSERT INTO seo.keywords (workspace_id, text, normalized_text, "
        "language_code) VALUES ($1, $4, $4, 'en') RETURNING id), "
        "t AS (INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, "
        "location_id, language_code, device, target_url_id) SELECT $1, $2, k.id, "
        "(SELECT default_location_id FROM core.projects WHERE id = $2), 'en', 'desktop', $3 "
        "FROM k RETURNING id, keyword_id, location_id), "
        "s AS (INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, "
        "project_id, current_rank, rank_change) SELECT t.id, $1, $2, $5, $6 FROM t "
        "RETURNING tracked_keyword_id) "
        "SELECT t.keyword_id, t.location_id FROM t",
        workspace.id,
        project_id,
        target_url_id,
        text,
        rank,
        change,
    )
    if volume is None:
        return
    await execute(
        pg,
        "WITH snap AS (INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, "
        "location_id, language_code, source, fetched_at, search_volume, is_material_change) "
        "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', now(), $4, false) RETURNING id) "
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, fetched_at) "
        "SELECT $2, $3, 'en', 'dataforseo_labs', $1, snap.id, $4, now() FROM snap",
        workspace.id,
        row["keyword_id"],
        row["location_id"],
        volume,
    )
```

(`Workspace` comes from `tests.api.auth.support` as in the other helpers of the file.)

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/api/internal_links/test_page_extras.py --no-cov -q
```

Expected: FAIL (`KeyError: 'extras'`).

- [ ] **Step 3: The models**

Add these classes to `schemas/internal_links.py`, above `PageRow` (the row and the detail refer to them, so they live in the same module and need no forward reference); add `from datetime import date, datetime` to its imports:

```python
class PageChange(BaseModel):
    is_new: bool
    editorial_in_delta: int | None
    equity_points: float | None
    depth_state: Literal["lost", "found"] | None
    depth_delta: int | None


class KeywordSummary(BaseModel):
    tracked: int
    ranking: int
    average_rank: float | None
    best_volume: int | None


class CitationCounts(BaseModel):
    chatgpt: int
    gemini: int
    ai_mode: int
    total: int


class AnchorSummary(BaseModel):
    total: int
    distinct: int
    generic: int
    generic_share: float
    matches_keyword: bool | None


class GscPage(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    clicks: int | None = Field(description="Google's clicks for the page, last 28 days.")
    impressions: int | None
    window_start: date | None
    window_end: date | None


class PageExtras(BaseModel):
    change: PageChange | None = None
    keywords: KeywordSummary | None = None
    citations: CitationCounts | None = None
    anchors: AnchorSummary | None = None
    gsc: GscPage | None = None


class KeywordRow(BaseModel):
    keyword: str
    rank: int | None
    change: int | None = Field(description="Places moved since the last check; positive is up.")
    volume: int | None


class AnchorText(BaseModel):
    text: str
    count: int
    generic: bool


class AnchorDetail(AnchorSummary):
    top: list[AnchorText]


class PageDetailExtras(BaseModel):
    change: PageChange | None
    keywords: list[KeywordRow]
    citations: CitationCounts
    anchors: AnchorDetail
    gsc: GscPage
```

In the same module add to `PageRow` the member `extras: PageExtras | None = None` and to `PageDetail` the member `extras: PageDetailExtras`. Extend the literals: `RowFlag` gains `"generic_anchors"`, `PageFlag` gains `"generic_anchors"`, `PageWorklist` gains `"lost_links_top"` and `"weak_outlinks"`, `PageSort` gains `"change"` and `"-change"`, and `Worklists` gains `lost_links_top: int` and `weak_outlinks: int`.

- [ ] **Step 4: The extras module**

Create `backend/src/idraft/api/internal_links/extras.py`:

```python
"""The numbers next to a page that the crawl does not hold: change since the last crawl,
tracked keywords and their rank, AI citations, anchors and Search Console clicks (plan 04 D7 to
D10). Each part is one query over the rows being read; every query names the workspace and the
project, and starts from URL ids that came from a row of the crawl in scope."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import ARRAY, BigInteger, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.keywords.gsc_repository import scope_of
from idraft.api.schemas.internal_links import (
    AnchorDetail,
    AnchorSummary,
    AnchorText,
    CitationCounts,
    GscPage,
    KeywordRow,
    KeywordSummary,
    PageChange,
)
from idraft.collectors.gsc_pages import page_clicks
from idraft.crawl.anchors import anchor_stats
from idraft.db.tables import crawl_page_changes, crawl_runs

LABS: Final = "dataforseo_labs"
ENGINES: Final = {"chatgpt_web": "chatgpt", "gemini_web": "gemini", "google_ai_mode": "ai_mode"}
ANCHORS_PER_PAGE_MAX: Final = 5_000
INCLUDES: Final = ("changes", "keywords", "citations", "anchors", "gsc")

_KEYWORDS = text(
    """
    WITH owned AS (
        SELECT coalesce(tk.target_url_id, st.current_url_id) AS page_url, tk.keyword_id,
               k.text AS keyword, st.current_rank AS rank, st.rank_change AS change,
               m.search_volume AS volume
        FROM seo.tracked_keywords tk
        JOIN seo.keywords k ON k.id = tk.keyword_id AND k.workspace_id = tk.workspace_id
        LEFT JOIN seo.tracked_keyword_state st ON st.tracked_keyword_id = tk.id
             AND st.workspace_id = tk.workspace_id
        LEFT JOIN seo.keyword_metrics_current m ON m.keyword_id = tk.keyword_id
             AND m.location_id = tk.location_id AND m.language_code = tk.language_code
             AND m.source = :source AND m.workspace_id = tk.workspace_id
        WHERE tk.workspace_id = CAST(:workspace_id AS uuid)
          AND tk.project_id = CAST(:project_id AS uuid)
          AND tk.is_active AND tk.deleted_at IS NULL
    )
    SELECT DISTINCT ON (page_url, keyword_id) page_url, keyword, rank, change, volume
    FROM owned WHERE page_url = ANY(:ids)
    ORDER BY page_url, keyword_id, rank NULLS LAST
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))
_CITATIONS = text(
    """
    SELECT c.url_id, c.engine_code, count(DISTINCT c.observation_id) AS answers
    FROM ai.citations c
    JOIN ai.observations o ON o.id = c.observation_id AND o.observed_at = c.observed_at
         AND o.workspace_id = c.workspace_id
    WHERE c.workspace_id = CAST(:workspace_id AS uuid) AND c.project_id = CAST(:project_id AS uuid)
      AND c.url_id = ANY(:ids) AND c.domain_role = 'own'
      AND c.observed_at >= now() - interval '28 days' AND o.superseded_by IS NULL
    GROUP BY c.url_id, c.engine_code
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))
_ANCHORS = text(
    """
    SELECT target_url_id, lower(btrim(anchor)) AS key, min(anchor) AS shown, count(*) AS links
    FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND scope = 'editorial' AND source_url_id <> target_url_id AND target_url_id = ANY(:ids)
    GROUP BY target_url_id, lower(btrim(anchor))
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))


@dataclass(frozen=True, slots=True)
class _Keyword:
    keyword: str
    rank: int | None
    change: int | None
    volume: int | None


async def changes_of(
    db: AsyncSession, scope: PageScope, ids: Collection[int]
) -> dict[int, PageChange] | None:
    """None when the crawl has no previous one (the column shows nothing, not zeros)."""
    previous = (
        await db.execute(
            select(crawl_runs.c.previous_run_id).where(
                crawl_runs.c.workspace_id == scope.workspace_id, crawl_runs.c.id == scope.run_id
            )
        )
    ).scalar_one()
    if previous is None:
        return None
    return {
        row.url_id: PageChange(
            is_new=row.is_new,
            editorial_in_delta=row.editorial_in_delta,
            equity_points=row.equity_points,
            depth_state=row.depth_state,
            depth_delta=row.depth_delta,
        )
        for row in await db.execute(
            select(crawl_page_changes).where(
                crawl_page_changes.c.workspace_id == scope.workspace_id,
                crawl_page_changes.c.run_id == scope.run_id,
                crawl_page_changes.c.url_id.in_(list(ids)),
            )
        )
    }


async def _keyword_rows(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, list[_Keyword]]:
    found: dict[int, list[_Keyword]] = {}
    for row in await db.execute(
        _KEYWORDS,
        {
            "workspace_id": str(scope.workspace_id),
            "project_id": str(scope.project_id),
            "source": LABS,
            "ids": list(ids),
        },
    ):
        found.setdefault(row.page_url, []).append(
            _Keyword(row.keyword, row.rank, row.change, row.volume)
        )
    return found


def summarize_keywords(rows: Sequence[_Keyword]) -> KeywordSummary:
    ranks = [row.rank for row in rows if row.rank is not None]
    volumes = [row.volume for row in rows if row.volume is not None]
    return KeywordSummary(
        tracked=len(rows),
        ranking=len(ranks),
        average_rank=round(sum(ranks) / len(ranks), 1) if ranks else None,
        best_volume=max(volumes) if volumes else None,
    )


async def keywords_of(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, list[_Keyword]]:
    return await _keyword_rows(db, scope, ids)


def keyword_rows(rows: Sequence[_Keyword]) -> list[KeywordRow]:
    return [
        KeywordRow(keyword=row.keyword, rank=row.rank, change=row.change, volume=row.volume)
        for row in sorted(rows, key=lambda row: (row.rank is None, row.rank or 0, row.keyword))
    ]


async def citations_of(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, CitationCounts]:
    counts: dict[int, dict[str, int]] = {}
    for row in await db.execute(
        _CITATIONS,
        {
            "workspace_id": str(scope.workspace_id),
            "project_id": str(scope.project_id),
            "ids": list(ids),
        },
    ):
        name = ENGINES.get(row.engine_code)
        if name is not None:
            counts.setdefault(row.url_id, {})[name] = row.answers
    return {
        url: CitationCounts(
            chatgpt=found.get("chatgpt", 0),
            gemini=found.get("gemini", 0),
            ai_mode=found.get("ai_mode", 0),
            total=sum(found.values()),
        )
        for url, found in counts.items()
    }


NO_CITATIONS: Final = CitationCounts(chatgpt=0, gemini=0, ai_mode=0, total=0)


async def anchors_of(
    db: AsyncSession,
    scope: PageScope,
    ids: Sequence[int],
    keywords: dict[int, list[_Keyword]],
    *,
    top: int = 5,
) -> dict[int, AnchorDetail]:
    grouped: dict[int, list[str]] = {}
    for row in await db.execute(
        _ANCHORS,
        {"run_id": str(scope.run_id), "workspace_id": str(scope.workspace_id), "ids": list(ids)},
    ):
        bucket = grouped.setdefault(row.target_url_id, [])
        room = ANCHORS_PER_PAGE_MAX - len(bucket)
        bucket.extend([row.shown] * min(row.links, max(room, 0)))
    result: dict[int, AnchorDetail] = {}
    for url, anchors in grouped.items():
        stats = anchor_stats(anchors, [row.keyword for row in keywords.get(url, [])], limit=top)
        result[url] = AnchorDetail(
            total=stats.total,
            distinct=stats.distinct,
            generic=stats.generic_count,
            generic_share=stats.generic_share,
            matches_keyword=stats.matches_keyword,
            top=[AnchorText(text=g.text, count=g.count, generic=g.generic) for g in stats.top],
        )
    return result


def empty_anchors(keywords: Sequence[_Keyword]) -> AnchorDetail:
    return AnchorDetail(
        total=0,
        distinct=0,
        generic=0,
        generic_share=0.0,
        matches_keyword=None if not keywords else False,
        top=[],
    )


def anchor_summary(detail: AnchorDetail) -> AnchorSummary:
    return AnchorSummary(
        total=detail.total,
        distinct=detail.distinct,
        generic=detail.generic,
        generic_share=detail.generic_share,
        matches_keyword=detail.matches_keyword,
    )


async def gsc_of(db: AsyncSession, scope: PageScope, ids: Sequence[int]) -> dict[int, GscPage]:
    """Google's page numbers. `ok` shows 0 for a page with no row in the window (a count);
    `pending` and `not_connected` show none."""
    state = await scope_of(db, scope.workspace_id, scope.project_id)
    if state.state != "ok" or state.integration_id is None or state.window is None:
        empty = GscPage(
            state=state.state, clicks=None, impressions=None, window_start=None, window_end=None
        )
        return dict.fromkeys(ids, empty)
    totals = await page_clicks(
        db, scope.workspace_id, scope.project_id, state.integration_id, state.window, ids
    )
    return {
        url: GscPage(
            state="ok",
            clicks=totals[url].clicks if url in totals else 0,
            impressions=totals[url].impressions if url in totals else 0,
            window_start=state.window[0],
            window_end=state.window[1],
        )
        for url in ids
    }
```

- [ ] **Step 5: Use them in the list and the detail**

In `reads.py`: import the functions from `extras`, and `PageExtras`, `PageDetailExtras` from `idraft.api.schemas.internal_links` (the import block that already names `PageRow`). In `LinkReadService.pages`, add the parameter `include: Sequence[str] = ()`; after `rows = rows[:limit]` and before `return PageList(...)`:

```python
            page_rows_out = await _page_rows(db, scope, view, tiers, rows)
            if include:
                await attach_extras(db, scope, page_rows_out, set(include))
```

(and use `rows=page_rows_out` in the `PageList`). Add this function in `reads.py` above the service:

```python
async def attach_extras(
    db: AsyncSession, scope: PageScope, rows: list[PageRow], include: set[str]
) -> None:
    """Fills `row.extras` for the parts asked for, one grouped query per part."""
    ids = [int(row.url_id) for row in rows]
    if not ids:
        return
    changes = await changes_of(db, scope, ids) if "changes" in include else None
    keywords = await keywords_of(db, scope, ids) if include & {"keywords", "anchors"} else {}
    citations = await citations_of(db, scope, ids) if "citations" in include else {}
    anchors = await anchors_of(db, scope, ids, keywords) if "anchors" in include else {}
    gsc = await gsc_of(db, scope, ids) if "gsc" in include else {}
    for row in rows:
        url = int(row.url_id)
        row.extras = PageExtras(
            change=None if changes is None else changes.get(url),
            keywords=summarize_keywords(keywords.get(url, [])) if "keywords" in include else None,
            citations=citations.get(url, NO_CITATIONS) if "citations" in include else None,
            anchors=(
                anchor_summary(anchors.get(url) or empty_anchors(keywords.get(url, [])))
                if "anchors" in include
                else None
            ),
            gsc=gsc.get(url),
        )
```

In `page_detail`, after the `PageRow` of the page is built (the variable that holds it is the one passed as `page=` to `PageDetail(...)`), compute and pass:

```python
            url = int(page.url_id)
            kw = (await keywords_of(db, scope, [url])).get(url, [])
            anchor_detail = (await anchors_of(db, scope, [url], {url: kw})).get(url) or empty_anchors(kw)
            changed = await changes_of(db, scope, [url])
            ...
            extras=PageDetailExtras(
                change=None if changed is None else changed.get(url),
                keywords=keyword_rows(kw),
                citations=(await citations_of(db, scope, [url])).get(url, NO_CITATIONS),
                anchors=anchor_detail,
                gsc=(await gsc_of(db, scope, [url]))[url],
            ),
```

In `read_routes.py` `list_pages`: add the query parameter and pass it on:

```python
    include: Annotated[
        list[Literal["changes", "keywords", "citations", "anchors", "gsc"]] | None,
        Commas,
        Query(max_length=5, description="Parts to add to each row as `extras`."),
    ] = None,
```

and `include=include or ()` in the call to `reads.pages` (and in `pages_csv` leave it out). Sorting: in `reads.py`, `_sort_column` gets, before the final return,

```python
    if key == "change":
        return func.coalesce(crawl_page_changes.c.editorial_in_delta, 0)
```

and `_cursor_value` needs no change (an integer). In `page_filter.page_rows` add the outer join:

```python
def page_rows(scope: PageScope) -> Join:
    return (
        crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id)
        .outerjoin(
            project_pages,
            and_(
                project_pages.c.workspace_id == scope.workspace_id,
                project_pages.c.project_id == scope.project_id,
                project_pages.c.url_id == crawl_pages.c.url_id,
            ),
        )
        .outerjoin(
            crawl_page_changes,
            and_(
                crawl_page_changes.c.workspace_id == scope.workspace_id,
                crawl_page_changes.c.run_id == crawl_pages.c.run_id,
                crawl_page_changes.c.url_id == crawl_pages.c.url_id,
            ),
        )
    )
```

(keep the original body of `page_rows`: it already joins `project_pages` with those three conditions; only the second `outerjoin` is new).

- [ ] **Step 6: The flag and the worklists**

In `page_filter.py` add to `_FLAGS`:

```python
    "generic_anchors": and_(
        crawl_pages.c.editorial_anchors >= GENERIC_MIN_LINKS,
        crawl_pages.c.generic_anchors * 2 > crawl_pages.c.editorial_anchors,
    ),
```

(import `GENERIC_MIN_LINKS` from `idraft.crawl.anchors`, `and_`, `aliased`, `func`, `distinct` from sqlalchemy, `crawl_links`, `crawl_link_changes`, `page_tier_levels` from the tables) and in `page_conditions`, after the `deep_only_through_auto` branch:

```python
    elif found.worklist == "lost_links_top":
        conditions += [
            exists().where(
                crawl_link_changes.c.workspace_id == scope.workspace_id,
                crawl_link_changes.c.run_id == scope.run_id,
                crawl_link_changes.c.change == "lost",
                crawl_link_changes.c.scope == "editorial",
                crawl_link_changes.c.target_url_id == crawl_pages.c.url_id,
            ),
            project_pages.c.tier_id.in_(
                select(page_tier_levels.c.id).where(
                    page_tier_levels.c.workspace_id == scope.workspace_id,
                    page_tier_levels.c.position <= scope.alert_max_position,
                )
            ),
        ]
    elif found.worklist == "weak_outlinks":
        target = aliased(crawl_pages)
        target_tier = aliased(project_pages)
        weak = (
            select(func.count(distinct(crawl_links.c.target_url_id)))
            .select_from(
                crawl_links.join(
                    target,
                    and_(
                        target.c.run_id == crawl_links.c.run_id,
                        target.c.url_id == crawl_links.c.target_url_id,
                    ),
                ).outerjoin(
                    target_tier,
                    and_(
                        target_tier.c.workspace_id == scope.workspace_id,
                        target_tier.c.project_id == scope.project_id,
                        target_tier.c.url_id == crawl_links.c.target_url_id,
                    ),
                )
            )
            .where(
                crawl_links.c.run_id == scope.run_id,
                crawl_links.c.workspace_id == scope.workspace_id,
                crawl_links.c.source_url_id == crawl_pages.c.url_id,
                crawl_links.c.scope == "editorial",
                crawl_links.c.target_url_id != crawl_links.c.source_url_id,
                or_(
                    target_tier.c.tier_id.is_(None),
                    target_tier.c.tier_id == tier_of_position(scope, 4),
                    target.c.status_code != 200,
                    target.c.is_indexable.is_(False),
                ),
            )
            .correlate(crawl_pages)
            .scalar_subquery()
        )
        conditions += [
            crawl_pages.c.status_code == 200,
            project_pages.c.tier_id == tier_of_position(scope, 1),
            crawl_pages.c.outlinks_editorial >= WEAK_MIN_OUTLINKS,
            weak * 2 > crawl_pages.c.outlinks_editorial,
        ]
```

with `WEAK_MIN_OUTLINKS: Final = 3` beside `UNDER_LINKED_PAGES`. In `reads._flags` append (a stored row flag):

```python
    if row.editorial_anchors >= GENERIC_MIN_LINKS and row.generic_anchors * 2 > row.editorial_anchors:
        flags.append("generic_anchors")
```

In `reads.worklists` add `lost_links_top=await pages("lost_links_top"), weak_outlinks=await pages("weak_outlinks"),` to the `Worklists(...)` call.

- [ ] **Step 7: Run, regenerate, gate, commit**

```bash
uv run pytest tests/api/internal_links tests/security -n 4 --no-cov -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/api/schemas/internal_links_extra.py backend/src/idraft/api/schemas/internal_links.py backend/src/idraft/api/internal_links backend/tests/api/internal_links/test_page_extras.py backend/openapi/v1.json
git commit -m "Internal links: change, rank, citation, anchor and Search Console columns, the generic anchor flag and two worklists"
```

Expected: PASS. The statement-count test of plan 02 (`test_reads_size.py`) must still pass: without `include`, the pages list runs the same statements. If a `tests/api/internal_links` test pins the exact `Worklists` keys, add the two new ones.

---

### Task 12: Opportunities API

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py`
- Create: `backend/src/idraft/api/internal_links/opportunities.py`, `opportunity_routes.py`
- Modify: `backend/src/idraft/api/resources.py`, `main.py`, `audit.py`
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Create: `backend/tests/api/internal_links/test_opportunities.py`

**Read first:** `api/internal_links/changes.py` (Task 10, same style), `api/internal_links/page_tiers.py` (`_audit`, how `live_project(db, access, project_id, lock=True)` and `audit.record` are used), `api/request_info.py` (`Info`), `api/internal_links/page_tier_routes.py` (a write route with `Info`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/internal_links/test_opportunities.py`:

```python
"""Link opportunities: a page mentions a topic of another page without an editorial link
(plan 04 Task 12, decisions D11 to D13)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _mention(
    pg: PostgresServer, run: uuid.UUID, workspace: Workspace, source: int, target: int, phrase: str
) -> None:
    await execute(
        pg,
        "INSERT INTO seo.crawl_mentions (run_id, workspace_id, source_url_id, target_url_id, "
        "phrase, context, origin) VALUES ($1, $2, $3, $4, $5, $6, 'keyword')",
        run,
        workspace.id,
        source,
        target,
        phrase,
        f"Many teams look for {phrase} first.",
    )


async def _site(
    pg: PostgresServer,
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, newer, ids, _ = await two_crawls(pg, workspace, project)
    # Every page is reachable and live, as ingest leaves a healthy crawl.
    await execute(pg, "UPDATE seo.crawl_pages SET click_depth = 1 WHERE run_id = $1", newer)
    return workspace, project, newer, ids


async def test_an_open_mention_is_listed_with_both_pages_and_the_suggested_anchor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    body = response.json()
    row = body["data"][0]
    assert row["key"] == f"{ids['/blog']}>{ids['/pricing']}"
    assert (row["source"]["path"], row["target"]["path"]) == ("/blog", "/pricing")
    assert row["target"]["tier"]["code"] == "T1"
    assert (row["phrase"], row["anchor"], row["status"], row["origin"]) == (
        "pricing plans",
        "pricing plans",
        "open",
        "keyword",
    )
    assert "pricing plans" in row["context"]
    assert body["meta"]["counts"] == {"open": 1, "accepted": 0, "dismissed": 0}


async def test_a_pair_that_has_an_editorial_link_is_not_an_opportunity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    # /blog/a links to /blog/b in its text in the latest crawl.
    await _mention(migrated, run, workspace, ids["/blog/a"], ids["/blog/b"], "soc pricing")
    # A page that mentions itself is not one either.
    await _mention(migrated, run, workspace, ids["/blog"], ids["/blog"], "blog")

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    assert response.json()["data"] == []


async def test_a_source_that_cannot_be_reached_from_home_is_left_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET click_depth = NULL WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/blog"],
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    assert response.json()["data"] == []


async def test_accept_dismiss_and_undo_are_kept_for_the_project_and_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/pricing"], "plans and pricing")
    base = project_url(workspace, project, "internal-links", "opportunities")
    pair = {"source_url_id": str(ids["/blog"]), "target_url_id": str(ids["/pricing"])}

    accepted = await api.put(
        f"{base}/decisions", json={"items": [pair], "status": "accepted"}, headers=editor.headers
    )
    listed = await api.get(base, params={"status": "accepted"}, headers=editor.headers)
    undone = await api.put(
        f"{base}/decisions", json={"items": [pair], "status": "open"}, headers=editor.headers
    )
    counts = (await api.get(base, headers=editor.headers)).json()["meta"]["counts"]

    assert accepted.json()["data"] == {"matched": 1, "changed": 1}
    assert [row["status"] for row in listed.json()["data"]] == ["accepted"]
    assert undone.json()["data"] == {"matched": 1, "changed": 1}
    assert counts == {"open": 2, "accepted": 0, "dismissed": 0}


async def test_a_viewer_cannot_decide_and_a_pair_outside_the_crawl_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    base = project_url(workspace, project, "internal-links", "opportunities")
    body = {
        "items": [{"source_url_id": str(ids["/"]), "target_url_id": str(ids["/blog/b"])}],
        "status": "dismissed",
    }

    refused = await api.put(f"{base}/decisions", json=body, headers=viewer.headers)
    nothing = await api.put(f"{base}/decisions", json=body, headers=editor.headers)

    assert problem(refused)[0] == 403
    assert nothing.json()["data"] == {"matched": 0, "changed": 0}
    assert run


async def test_planned_fixes_export_accepted_rows_or_the_open_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/pricing"], "plans and pricing")
    base = project_url(workspace, project, "internal-links", "opportunities")

    open_rows = await api.get(base, params={"export": "planned"}, headers=editor.headers)
    await api.put(
        f"{base}/decisions",
        json={
            "items": [{"source_url_id": str(ids["/"]), "target_url_id": str(ids["/pricing"])}],
            "status": "accepted",
        },
        headers=editor.headers,
    )
    accepted = await api.get(base, params={"export": "planned"}, headers=editor.headers)

    assert open_rows.headers["content-type"].startswith("text/csv")
    assert len(open_rows.text.splitlines()) == 3
    assert open_rows.text.splitlines()[0] == "Source URL,Target URL,Anchor,Context,Status"
    assert len(accepted.text.splitlines()) == 2 and accepted.text.endswith("accepted\n")


async def test_filters_by_status_target_tier_and_search(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/blog/b"], "blog b topics")
    base = project_url(workspace, project, "internal-links", "opportunities")

    t1 = await api.get(base, params={"filter[target_tier]": "1"}, headers=viewer.headers)
    t3 = await api.get(base, params={"filter[target_tier]": "3"}, headers=viewer.headers)
    search = await api.get(base, params={"q": "/blog/b"}, headers=viewer.headers)

    assert [row["target"]["path"] for row in t1.json()["data"]] == ["/pricing"]
    assert [row["target"]["path"] for row in t3.json()["data"]] == ["/blog/b"]
    assert [row["target"]["path"] for row in search.json()["data"]] == ["/blog/b"]


async def test_another_workspaces_member_sees_nothing_of_the_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, _ = await _site(migrated)
    other = await make_workspace(migrated)
    outsider = await member(resources, migrated, other, "editor")
    base = project_url(workspace, project, "internal-links", "opportunities")

    listed = await api.get(base, headers=outsider.headers)
    decided = await api.put(
        f"{base}/decisions",
        json={"items": [{"source_url_id": "1", "target_url_id": "2"}], "status": "dismissed"},
        headers=outsider.headers,
    )

    assert problem(listed)[0] in (403, 404) and problem(decided)[0] in (403, 404)

```

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/api/internal_links/test_opportunities.py --no-cov -q
```

Expected: FAIL (404 on the new routes).

- [ ] **Step 3: The models**

Append to `schemas/internal_links_extra.py`:

```python
OpportunityStatus = Literal["open", "accepted", "dismissed"]


class Opportunity(BaseModel):
    key: str = Field(description='"{source_url_id}>{target_url_id}".')
    source: ChangePage
    target: ChangePage
    phrase: str
    context: str
    anchor: str = Field(description="The words to link: the phrase as written in the text.")
    source_equity_share: float | None
    status: OpportunityStatus
    origin: Literal["keyword", "anchor"]


class OpportunityCounts(BaseModel):
    open: int
    accepted: int
    dismissed: int


class OpportunityMeta(BaseModel):
    run_id: UUID
    total: int
    counts: OpportunityCounts


class OpportunityPage(BaseModel):
    data: list[Opportunity]
    meta: OpportunityMeta


class OpportunityPair(BaseModel):
    source_url_id: UrlId
    target_url_id: UrlId


class OpportunityDecisions(Body):
    items: list[OpportunityPair] = Field(min_length=1, max_length=500)
    status: OpportunityStatus


class DecisionResult(BaseModel):
    matched: int
    changed: int


class DecisionResponse(BaseModel):
    data: DecisionResult
```

with `from idraft.api.schemas.common import Body` and `from idraft.api.schemas.internal_links import UrlId` added to the imports at the top (`UrlId` accepts the string form of a 64-bit id).

- [ ] **Step 4: The service**

Create `backend/src/idraft/api/internal_links/opportunities.py`:

```python
"""Link opportunities (spec 7.10, plan 04 D11 to D13). The mentions of a crawl are stored by
`crawl_enrich`; this reads them the way the screen needs: pairs with no editorial link in the
crawl's own links, from sources reachable from the start page, to live indexable targets, with
today's tiers and the people's decisions."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, Final, Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.csv_export import EXPORT_ROWS_MAX, csv_text
from idraft.api.internal_links.reads import load_tiers, read_scope
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links_extra import (
    ChangePage,
    DecisionResult,
    Opportunity,
    OpportunityCounts,
    OpportunityDecisions,
    OpportunityMeta,
    OpportunityPage,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import link_opportunity_decisions

ROWS_MAX: Final = EXPORT_ROWS_MAX
# The rows of one crawl that are opportunities, with decisions and tiers. `{filters}` is a closed
# set of fragments built below, never text from the request.
_BASE = """
    SELECT m.source_url_id, m.target_url_id, m.phrase, m.context, m.origin,
           coalesce(d.status, 'open') AS status,
           su.canonical_url AS source_url, su.path AS source_path,
           tu.canonical_url AS target_url, tu.path AS target_path,
           sp.tier_id AS source_tier, tp.tier_id AS target_tier,
           tl.position AS target_position, scp.equity_share AS source_equity
    FROM seo.crawl_mentions m
    JOIN seo.crawl_pages scp ON scp.run_id = m.run_id AND scp.url_id = m.source_url_id
         AND scp.workspace_id = m.workspace_id
         AND scp.status_code = 200 AND scp.is_indexable AND scp.click_depth IS NOT NULL
    JOIN seo.crawl_pages tcp ON tcp.run_id = m.run_id AND tcp.url_id = m.target_url_id
         AND tcp.workspace_id = m.workspace_id AND tcp.status_code = 200 AND tcp.is_indexable
    JOIN core.urls su ON su.id = m.source_url_id
    JOIN core.urls tu ON tu.id = m.target_url_id
    LEFT JOIN core.project_pages sp ON sp.workspace_id = m.workspace_id
         AND sp.project_id = CAST(:project_id AS uuid) AND sp.url_id = m.source_url_id
    LEFT JOIN core.project_pages tp ON tp.workspace_id = m.workspace_id
         AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = m.target_url_id
    LEFT JOIN core.page_tier_levels tl ON tl.id = tp.tier_id AND tl.workspace_id = tp.workspace_id
    LEFT JOIN core.link_opportunity_decisions d ON d.workspace_id = m.workspace_id
         AND d.project_id = CAST(:project_id AS uuid)
         AND d.source_url_id = m.source_url_id AND d.target_url_id = m.target_url_id
    WHERE m.run_id = CAST(:run_id AS uuid) AND m.workspace_id = CAST(:workspace_id AS uuid)
      AND m.source_url_id <> m.target_url_id
      AND NOT EXISTS (
          SELECT 1 FROM seo.crawl_links l
          WHERE l.run_id = m.run_id AND l.workspace_id = m.workspace_id
            AND l.source_url_id = m.source_url_id AND l.target_url_id = m.target_url_id
            AND l.scope = 'editorial')
"""
_ORDER = "ORDER BY coalesce(tl.position, 99), scp.equity_share DESC NULLS LAST, su.path, tu.path"


def _filters(status: str | None, tier: str | None, query: str | None) -> tuple[str, dict[str, Any]]:
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if status is not None:
        clauses.append("AND coalesce(d.status, 'open') = :status")
        params["status"] = status
    if tier == "none":
        clauses.append("AND tl.position IS NULL")
    elif tier is not None:
        clauses.append("AND tl.position = :tier")
        params["tier"] = int(tier)
    if query:
        clauses.append("AND (su.path ILIKE :q ESCAPE '\\' OR tu.path ILIKE :q ESCAPE '\\')")
        params["q"] = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return " ".join(clauses), params


class OpportunityService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    async def list(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        status: Literal["open", "accepted", "dismissed"] | None,
        tier: str | None,
        query: str | None,
        offset: int,
        limit: int,
    ) -> OpportunityPage:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            tiers = await load_tiers(db, access.workspace_id)
            keys = {
                "run_id": str(scope.run_id),
                "workspace_id": str(access.workspace_id),
                "project_id": str(project_id),
            }
            filters, extra = _filters(status, tier, query)
            found = (
                await db.execute(
                    text(f"{_BASE} {filters} {_ORDER} LIMIT :limit OFFSET :offset"),
                    {**keys, **extra, "limit": limit, "offset": offset},
                )
            ).all()
            total: int = (
                await db.execute(
                    text(f"SELECT count(*) FROM ({_BASE} {filters}) counted"), {**keys, **extra}
                )
            ).scalar_one()
            by_status = {
                row.status: row.n
                for row in await db.execute(
                    text(f"SELECT status, count(*) AS n FROM ({_BASE}) s GROUP BY status"), keys
                )
            }
        return OpportunityPage(
            data=[
                Opportunity(
                    key=f"{row.source_url_id}>{row.target_url_id}",
                    source=ChangePage(
                        url_id=str(row.source_url_id),
                        url=row.source_url,
                        path=row.source_path,
                        tier=tiers.ref(row.source_tier),
                    ),
                    target=ChangePage(
                        url_id=str(row.target_url_id),
                        url=row.target_url,
                        path=row.target_path,
                        tier=tiers.ref(row.target_tier),
                    ),
                    phrase=row.phrase,
                    context=row.context,
                    anchor=row.phrase,
                    source_equity_share=row.source_equity,
                    status=row.status,
                    origin=row.origin,
                )
                for row in found
            ],
            meta=OpportunityMeta(
                run_id=scope.run_id,
                total=total,
                counts=OpportunityCounts(
                    open=by_status.get("open", 0),
                    accepted=by_status.get("accepted", 0),
                    dismissed=by_status.get("dismissed", 0),
                ),
            ),
        )

    async def planned_csv(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None
    ) -> str:
        """Accepted rows, or every open row when nothing is accepted (spec 7.10)."""
        accepted = await self.list(
            access, project_id, run=run, status="accepted", tier=None, query=None, offset=0,
            limit=ROWS_MAX,
        )
        chosen = accepted if accepted.data else await self.list(
            access, project_id, run=run, status="open", tier=None, query=None, offset=0,
            limit=ROWS_MAX,
        )
        return csv_text(
            ("Source URL", "Target URL", "Anchor", "Context", "Status"),
            (
                (row.source.url, row.target.url, row.anchor, row.context, row.status)
                for row in chosen.data
            ),
        )

    async def decide(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: OpportunityDecisions,
        info: RequestInfo,
    ) -> DecisionResult:
        """Accept, dismiss or reopen pairs that are mentions of the latest crawl. A pair that
        is not one is counted in neither number."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await read_scope(db, access, project_id, None)
            pairs = {(item.source_url_id, item.target_url_id) for item in body.items}
            valid = {
                (row.source_url_id, row.target_url_id)
                for row in await db.execute(
                    text(
                        "SELECT source_url_id, target_url_id FROM seo.crawl_mentions "
                        "WHERE run_id = CAST(:run_id AS uuid) "
                        "AND workspace_id = CAST(:workspace_id AS uuid) "
                        "AND (source_url_id, target_url_id) IN "
                        "(SELECT * FROM unnest(CAST(:sources AS bigint[]), CAST(:targets AS bigint[])))"
                    ),
                    {
                        "run_id": str(scope.run_id),
                        "workspace_id": str(access.workspace_id),
                        "sources": [source for source, _ in pairs],
                        "targets": [target for _, target in pairs],
                    },
                )
            }
            changed = 0
            for source, target in valid:
                if body.status == "open":
                    result = await db.execute(
                        link_opportunity_decisions.delete().where(
                            link_opportunity_decisions.c.workspace_id == access.workspace_id,
                            link_opportunity_decisions.c.project_id == project_id,
                            link_opportunity_decisions.c.source_url_id == source,
                            link_opportunity_decisions.c.target_url_id == target,
                        )
                    )
                    changed += result.rowcount or 0
                else:
                    statement = upsert(link_opportunity_decisions).values(
                        project_id=project_id,
                        workspace_id=access.workspace_id,
                        source_url_id=source,
                        target_url_id=target,
                        status=body.status,
                        decided_by=access.user_id,
                    )
                    result = await db.execute(
                        statement.on_conflict_do_update(
                            index_elements=["project_id", "source_url_id", "target_url_id"],
                            set_={
                                "status": body.status,
                                "decided_by": access.user_id,
                                "decided_at": text("now()"),
                            },
                            where=link_opportunity_decisions.c.status != body.status,
                        )
                    )
                    changed += result.rowcount or 0
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="link_opportunity.decided",
                target_type="project",
                target_id=project_id,
                info=info,
                after={"status": body.status, "pairs": len(valid), "changed": changed},
            )
            return DecisionResult(matched=len(valid), changed=changed)
```

The module imports `live_project` from `idraft.api.ai.engine_service`, as `reads.py` does.

- [ ] **Step 5: The routes and the wiring**

Create `backend/src/idraft/api/internal_links/opportunity_routes.py`:

```python
"""Link opportunities (spec 7.10): reads need `data:read`, decisions `projects:write`."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.opportunities import OpportunityService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links_extra import (
    DecisionResponse,
    OpportunityDecisions,
    OpportunityPage,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]
_CSV: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/csv": {}}, "description": "With `export=planned`: the planned fixes."}
}


def get_service(resources: Annotated[Resources, Depends(get_resources)]) -> OpportunityService:
    return resources.link_opportunities


Service = Annotated[OpportunityService, Depends(get_service)]


@router.get(
    "",
    summary="Pages that mention a topic of another page without linking to it",
    response_model=OpportunityPage,
    responses=_CSV,
)
async def list_opportunities(
    project_id: UUID,
    access: ReadData,
    service: Service,
    run: Annotated[Literal["latest"] | UUID, Query()] = "latest",
    status: Annotated[Literal["open", "accepted", "dismissed"] | None, Query()] = None,
    target_tier: Annotated[
        str | None, Query(alias="filter[target_tier]", pattern=r"^([1-8]|none)$")
    ] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    export: Annotated[Literal["planned"] | None, Query()] = None,
) -> OpportunityPage | Response:
    run_id = run if isinstance(run, UUID) else None
    if export == "planned":
        text = await service.planned_csv(access, project_id, run=run_id)
        return Response(
            content=text,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="internal-links-planned-fixes.csv"'},
        )
    return await service.list(
        access,
        project_id,
        run=run_id,
        status=status,
        tier=target_tier,
        query=q,
        offset=offset,
        limit=limit,
    )


@router.put(
    "/decisions",
    summary="Accept, dismiss or reopen opportunities",
    response_model=DecisionResponse,
)
async def decide(
    project_id: UUID,
    body: OpportunityDecisions,
    access: WriteData,
    service: Service,
    info: Info,
) -> DecisionResponse:
    return DecisionResponse(data=await service.decide(access, project_id, body, info))
```

Wiring: `resources.py` `link_opportunities: OpportunityService`; `main.py` constructs `OpportunityService(sessions=sessions)` and includes the router; `audit.py` gets `"link_opportunity.decided"` in the action list; `tests/api/test_route_access.py` gets `GET .../internal-links/opportunities` as `"data:read"` and `PUT .../internal-links/opportunities/decisions` as `"projects:write"`; `tests/security/test_cross_tenant.py` `INTERNAL_LINK_READS` gets `("/internal-links/opportunities", {}, False)` (the seeded mention has the same source and target, so the list is empty, which proves nothing leaks).

- [ ] **Step 6: Run, regenerate, gate, commit**

```bash
uv run pytest tests/api/internal_links tests/api/test_route_access.py tests/security -n 4 --no-cov -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/api/schemas/internal_links_extra.py backend/src/idraft/api/internal_links/opportunities.py backend/src/idraft/api/internal_links/opportunity_routes.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/src/idraft/api/audit.py backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py backend/tests/api/internal_links/test_opportunities.py backend/openapi/v1.json
git commit -m "Internal links: opportunities with accept, dismiss, undo and the planned fixes export"
```

---

### Task 13: Tier suggestions API

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py`
- Create: `backend/src/idraft/api/internal_links/suggestions.py`, `suggestion_routes.py`
- Modify: `backend/src/idraft/api/resources.py`, `main.py`, `audit.py`
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Create: `backend/tests/api/internal_links/test_tier_suggestions.py`

**Read first:** `crawl/suggest.py` (Task 4), `api/internal_links/page_tiers.py` (`PageTierService.set_tiers`, `_audit`), `api/internal_links/extras.py` (Task 11: `keywords_of`, `gsc_of` use), `collectors/gsc_pages.py` (`page_clicks`), `tests/api/internal_links/test_page_extras.py` (`_track`, a helper to copy).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/internal_links/test_tier_suggestions.py`:

```python
"""Suggested tiers from Search Console clicks and tracked keyword ranks (plan 04 Task 13)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import httpx

from idraft.api.resources import Resources
from idraft.collectors.crawl_store import apply_rules
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers
from tests.api.internal_links.support_changes import track_keyword
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.gsc_support import FakeSearchConsole, make_property
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/a", 200), ("/b", 200), ("/c", 200), ("/d", 200)]


async def _site(
    pg: PostgresServer, resources: Resources
) -> tuple[Workspace, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A crawl of five live pages; one rule makes every page a T3 page (by rule, so a
    suggestion may change it)."""
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    tiers = await seed_tiers(pg, workspace)
    run, ids = await seed_crawl(pg, workspace, project, PAGES, [SeedLink("/", "/a")])
    await execute(
        pg, "UPDATE seo.crawl_pages SET is_indexable = true, click_depth = 1 WHERE run_id = $1", run
    )
    await execute(
        pg,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/', $3)",
        workspace.id,
        project,
        tiers[2],
    )
    async with workspace_transaction(resources.sessions, workspace.id) as db:
        await apply_rules(db, workspace_id=workspace.id, project_id=project)
    return workspace, project, ids, tiers


async def _clicks(
    pg: PostgresServer, workspace: Workspace, project: uuid.UUID, ids: dict[str, int], clicks: dict[str, int]
) -> None:
    """A connected property whose pull is done, and the clicks of the pages."""
    fake = FakeSearchConsole()
    prop = await make_property(pg, fake, workspace=workspace, project_id=project)
    end = date.today() - timedelta(days=3)
    await execute(
        pg,
        "UPDATE fp.integrations SET status = 'active', backfill_state = $2::jsonb WHERE id = $1",
        prop.integration_id,
        f'{{"version": 2, "recent_done": true, "window_end": "{end.isoformat()}"}}',
    )
    for path, count in clicks.items():
        await execute(
            pg,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
            "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, $6 * 10)",
            prop.integration_id,
            end,
            ids[path],
            workspace.id,
            project,
            count,
        )


async def test_the_busiest_t3_page_is_suggested_for_t2_with_its_clicks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, tiers = await _site(migrated, resources)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _clicks(migrated, workspace, project, ids, {"/a": 900, "/b": 5, "/c": 1})

    response = await api.get(
        project_url(workspace, project, "internal-links", "tier-suggestions"), headers=viewer.headers
    )

    body = response.json()
    assert body["meta"]["gsc_state"] == "ok"
    rows = body["data"]
    assert [row["path"] for row in rows] == ["/a"]
    assert rows[0]["to_tier"]["code"] == "T2" and rows[0]["from_tier"]["code"] == "T3"
    assert rows[0]["reasons"] == [{"kind": "clicks", "clicks": 900, "rank": None, "keyword": None, "volume": None}]
    assert tiers


async def test_without_search_console_a_ranking_keyword_still_suggests_a_tier(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    viewer = await member(resources, migrated, workspace, "viewer")
    await track_keyword(
        migrated, workspace, project, "big topic", ids["/b"], rank=3, change=None, volume=5000
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "tier-suggestions"), headers=viewer.headers
    )

    assert response.json()["meta"]["gsc_state"] == "not_connected"
    row = response.json()["data"][0]
    assert row["path"] == "/b"
    assert (row["reasons"][0]["kind"], row["reasons"][0]["rank"], row["reasons"][0]["volume"]) == (
        "rank",
        3,
        5000,
    )


async def test_accept_sets_a_manual_tier_and_it_is_never_suggested_again(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    await _clicks(migrated, workspace, project, ids, {"/a": 900, "/b": 5})
    base = project_url(workspace, project, "internal-links", "tier-suggestions")

    accepted = await api.post(f"{base}/accept", json={"all": True}, headers=editor.headers)
    again = await api.get(base, headers=editor.headers)

    assert accepted.json()["data"] == {"matched": 1, "changed": 1}
    assert again.json()["data"] == []
    row = await fetch(
        migrated,
        "SELECT tier_source, set_by FROM core.project_pages WHERE project_id = $1 AND url_id = $2",
        project,
        ids["/a"],
    )
    assert row[0]["tier_source"] == "manual" and row[0]["set_by"] == editor.user_id


async def test_dismiss_hides_a_suggestion_for_the_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    await _clicks(migrated, workspace, project, ids, {"/a": 900})
    base = project_url(workspace, project, "internal-links", "tier-suggestions")

    dismissed = await api.post(
        f"{base}/dismiss", json={"url_ids": [str(ids["/a"])]}, headers=editor.headers
    )
    listed = await api.get(base, headers=editor.headers)

    assert dismissed.json()["data"] == {"matched": 1, "changed": 1}
    assert listed.json()["data"] == []


async def test_a_selection_needs_ids_or_all_and_a_viewer_cannot_accept(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project, "internal-links", "tier-suggestions")

    empty = await api.post(f"{base}/accept", json={}, headers=editor.headers)
    refused = await api.post(f"{base}/accept", json={"all": True}, headers=viewer.headers)

    assert problem(empty) == (422, "validation_failed")
    assert problem(refused)[0] == 403
```

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/api/internal_links/test_tier_suggestions.py --no-cov -q
```

Expected: FAIL (404).

- [ ] **Step 3: The models**

Append to `schemas/internal_links_extra.py`:

```python
class SuggestionReason(BaseModel):
    kind: Literal["clicks", "rank"]
    clicks: int | None
    rank: int | None
    keyword: str | None
    volume: int | None


class TierSuggestionRow(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    title: str | None
    from_tier: TierRef | None
    to_tier: TierRef
    reasons: list[SuggestionReason]


class TierSuggestionMeta(BaseModel):
    run_id: UUID
    gsc_state: Literal["ok", "pending", "not_connected"]


class TierSuggestionList(BaseModel):
    data: list[TierSuggestionRow]
    meta: TierSuggestionMeta


class SuggestionSelection(Body):
    url_ids: list[UrlId] | None = Field(default=None, min_length=1, max_length=500)
    all: Literal[True] | None = None

    @model_validator(mode="after")
    def _one_of(self) -> SuggestionSelection:
        if (self.url_ids is None) == (self.all is None):
            raise ValueError("give `url_ids` or `all`, not both and not neither")
        return self
```

(import `model_validator` from pydantic. `BulkResponse` of plan 02 is reused for the answers.)

- [ ] **Step 4: The service**

Create `backend/src/idraft/api/internal_links/suggestions.py`:

```python
"""Tier suggestions (spec 7.10, plan 04 D13). The list is computed when read from live data:
the crawl's live indexable pages with their tiers, Google's clicks per page over 28 days and
the ranks of tracked keywords. Accepting is a manual tier change through the usual service."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.extras import keywords_of
from idraft.api.internal_links.page_tiers import PageTierService
from idraft.api.internal_links.reads import load_tiers, read_scope
from idraft.api.keywords.gsc_repository import scope_of
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import PageTierSet
from idraft.api.schemas.internal_links_extra import (
    SuggestionReason,
    SuggestionSelection,
    TierSuggestionList,
    TierSuggestionMeta,
    TierSuggestionRow,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.gsc_pages import page_clicks
from idraft.crawl.suggest import KeywordHit, SuggestPage, TierSuggestion, suggest_tiers
from idraft.db.engine import workspace_transaction
from idraft.db.tables import tier_suggestion_dismissals

_PAGES = text(
    """
    SELECT cp.url_id, u.canonical_url, u.path, cp.title, pp.tier_id, pp.tier_source, tl.position
    FROM seo.crawl_pages cp
    JOIN core.urls u ON u.id = cp.url_id
    LEFT JOIN core.project_pages pp ON pp.workspace_id = cp.workspace_id
         AND pp.project_id = cp.project_id AND pp.url_id = cp.url_id
    LEFT JOIN core.page_tier_levels tl ON tl.id = pp.tier_id AND tl.workspace_id = pp.workspace_id
    WHERE cp.run_id = CAST(:run_id AS uuid) AND cp.workspace_id = CAST(:workspace_id AS uuid)
      AND cp.status_code = 200 AND cp.is_indexable
    """
)


class SuggestionService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], page_tiers: PageTierService
    ) -> None:
        self._sessions = sessions
        self._page_tiers = page_tiers

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    async def _compute(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID
    ) -> tuple[TierSuggestionMeta, list[TierSuggestionRow]]:
        scope = await read_scope(db, access, project_id, None)
        tiers = await load_tiers(db, access.workspace_id)
        by_position = {position: tier_id for tier_id, position in tiers.positions.items()}
        pages = (
            await db.execute(_PAGES, {"run_id": str(scope.run_id), "workspace_id": str(access.workspace_id)})
        ).all()
        ids = [page.url_id for page in pages]
        gsc = await scope_of(db, access.workspace_id, project_id)
        clicks = {}
        if gsc.state == "ok" and gsc.integration_id is not None and gsc.window is not None:
            found = await page_clicks(
                db, access.workspace_id, project_id, gsc.integration_id, gsc.window, None
            )
            clicks = {url: value.clicks for url, value in found.items()}
        keywords = await keywords_of(db, scope, ids)
        dismissed = set(
            (
                await db.execute(
                    select(tier_suggestion_dismissals.c.url_id).where(
                        tier_suggestion_dismissals.c.workspace_id == access.workspace_id,
                        tier_suggestion_dismissals.c.project_id == project_id,
                    )
                )
            ).scalars()
        )
        inputs = [
            SuggestPage(
                url_id=page.url_id,
                tier_position=page.position,
                manual=page.tier_source == "manual",
                clicks=clicks.get(page.url_id, 0),
                hits=[
                    KeywordHit(row.keyword, row.rank, row.volume)
                    for row in keywords.get(page.url_id, [])
                ],
            )
            for page in pages
        ]
        found_rows: list[TierSuggestion] = suggest_tiers(
            inputs, tiers=len(tiers.refs), dismissed=dismissed
        )
        by_url = {page.url_id: page for page in pages}
        rows = [
            TierSuggestionRow(
                url_id=str(item.url_id),
                url=by_url[item.url_id].canonical_url,
                path=by_url[item.url_id].path,
                title=by_url[item.url_id].title,
                from_tier=tiers.ref(by_url[item.url_id].tier_id),
                to_tier=tiers.refs[by_position[item.to_position]],
                reasons=[
                    SuggestionReason(
                        kind=reason.kind,
                        clicks=reason.clicks,
                        rank=reason.rank,
                        keyword=reason.keyword,
                        volume=reason.volume,
                    )
                    for reason in item.reasons
                ],
            )
            for item in found_rows
        ]
        return TierSuggestionMeta(run_id=scope.run_id, gsc_state=gsc.state), rows

    async def list(self, access: WorkspaceAccess, project_id: UUID) -> TierSuggestionList:
        async with self._transaction(access) as db:
            meta, rows = await self._compute(db, access, project_id)
        return TierSuggestionList(data=rows, meta=meta)

    async def _chosen(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, body: SuggestionSelection
    ) -> list[TierSuggestionRow]:
        _, rows = await self._compute(db, access, project_id)
        if body.all:
            return rows
        wanted = {str(url_id) for url_id in body.url_ids or ()}
        return [row for row in rows if row.url_id in wanted]

    async def accept(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: SuggestionSelection,
        info: RequestInfo,
    ) -> tuple[int, int]:
        """Each accepted page gets its suggested tier as a manual tier, through the usual change,
        one call per target tier. Returns (matched, changed)."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            chosen = await self._chosen(db, access, project_id, body)
        by_tier: dict[UUID, list[int]] = {}
        for row in chosen:
            by_tier.setdefault(row.to_tier.tier_id, []).append(int(row.url_id))
        matched = changed = 0
        for tier_id, url_ids in by_tier.items():
            found, moved = await self._page_tiers.set_tiers(
                access,
                project_id,
                PageTierSet(url_ids=url_ids, tier_id=tier_id),
                info,
            )
            matched += found
            changed += moved
        return matched, changed

    async def dismiss(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: SuggestionSelection,
        info: RequestInfo,
    ) -> tuple[int, int]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            chosen = await self._chosen(db, access, project_id, body)
            changed = 0
            for row in chosen:
                result = await db.execute(
                    upsert(tier_suggestion_dismissals)
                    .values(
                        project_id=project_id,
                        workspace_id=access.workspace_id,
                        url_id=int(row.url_id),
                        dismissed_by=access.user_id,
                    )
                    .on_conflict_do_nothing()
                )
                changed += result.rowcount or 0
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tier_suggestion.dismissed",
                target_type="project",
                target_id=project_id,
                info=info,
                after={"pages": len(chosen), "changed": changed},
            )
            return len(chosen), changed
```

Note on `accept`: `PageTierService.set_tiers` takes its own transaction and writes its own `page_tiers.changed` audit entry, so accepting adds no audit action of its own. A `PageTierSet` with `url_ids` is limited to 5,000 ids; a crawl that has more suggestions than that sends them in chunks of 5,000 (loop `for start in range(0, len(url_ids), 5000)`).

- [ ] **Step 5: The routes and the wiring**

Create `backend/src/idraft/api/internal_links/suggestion_routes.py`:

```python
"""Suggested tiers (spec 7.10): the list needs `data:read`, accept and dismiss `projects:write`."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.internal_links.suggestions import SuggestionService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import BulkResponse, BulkResult
from idraft.api.schemas.internal_links_extra import SuggestionSelection, TierSuggestionList
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-suggestions",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_service(resources: Annotated[Resources, Depends(get_resources)]) -> SuggestionService:
    return resources.tier_suggestions


Service = Annotated[SuggestionService, Depends(get_service)]


@router.get(
    "",
    summary="Pages whose clicks or keyword ranks say they belong in a higher tier",
    response_model=TierSuggestionList,
)
async def list_suggestions(
    project_id: UUID, access: ReadData, service: Service
) -> TierSuggestionList:
    return await service.list(access, project_id)


@router.post("/accept", summary="Set the suggested tiers", response_model=BulkResponse)
async def accept(
    project_id: UUID, body: SuggestionSelection, access: WriteData, service: Service, info: Info
) -> BulkResponse:
    matched, changed = await service.accept(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))


@router.post("/dismiss", summary="Hide suggestions", response_model=BulkResponse)
async def dismiss(
    project_id: UUID, body: SuggestionSelection, access: WriteData, service: Service, info: Info
) -> BulkResponse:
    matched, changed = await service.dismiss(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))
```

Wiring: `resources.py` `tier_suggestions: SuggestionService`; `main.py` constructs `SuggestionService(sessions=sessions, page_tiers=page_tiers)` (use the same `PageTierService` instance that goes into `Resources.page_tiers`: build it into a variable first), includes the router; `audit.py` gets `"tier_suggestion.dismissed"`; `test_route_access.py`: `GET .../tier-suggestions` is `"data:read"`, `POST .../accept` and `POST .../dismiss` are `"projects:write"`; `test_cross_tenant.py` `INTERNAL_LINK_READS` gets `("/internal-links/tier-suggestions", {}, False)`.

- [ ] **Step 6: Run, regenerate, gate, commit**

```bash
uv run pytest tests/api/internal_links tests/api/test_route_access.py tests/security -n 4 --no-cov -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/api/schemas/internal_links_extra.py backend/src/idraft/api/internal_links/suggestions.py backend/src/idraft/api/internal_links/suggestion_routes.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/src/idraft/api/audit.py backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py backend/tests/api/internal_links/test_tier_suggestions.py backend/openapi/v1.json
git commit -m "Internal links: tier suggestions from Search Console clicks and tracked keyword ranks"
```

---

### Task 14: Path finder API

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py`
- Create: `backend/src/idraft/api/internal_links/route_finder.py`, `path_routes.py`
- Modify: `backend/src/idraft/api/resources.py`, `main.py`
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Create: `backend/tests/api/internal_links/test_paths.py`

**Read first:** `crawl/paths.py` (Task 3), `api/internal_links/reads.py` (`neighbor_page`, how a redirect page is handled: `redirect_url_id`), `tests/api/internal_links/support.py` (`read_site`: the seeded site has a redirect `/old`, a 404 `/gone`, menu and editorial links).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/internal_links/test_paths.py`:

```python
"""The path finder: the shortest route from the start page over every link and over editorial
links only (plan 04 Task 14, decision D14)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, read_site, seed_crawl
from tests.api.internal_links.support_changes import start_at
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_route_over_any_link_can_be_shorter_than_the_editorial_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/blog/b"]},
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert data["target"]["path"] == "/blog/b"
    # "/" links to /blog by the menu, and /blog links to /blog/b in its text.
    assert [step["page"]["path"] for step in data["any"]["steps"]] == ["/", "/blog", "/blog/b"]
    assert data["any"]["clicks"] == 2
    # Editorial links only: "/" has none, so the page cannot be reached that way.
    assert data["editorial"] is None


async def test_each_step_names_the_link_that_reached_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/blog/b"]},
        headers=viewer.headers,
    )

    steps = response.json()["data"]["any"]["steps"]
    assert steps[0]["anchor"] is None and steps[0]["placement"] is None
    assert (steps[1]["anchor"], steps[1]["placement"], steps[1]["scope"]) == (
        "Blog",
        "navigation",
        "template",
    )
    assert (steps[2]["anchor"], steps[2]["scope"]) == ("Post B", "editorial")


async def test_a_redirect_is_one_step_to_its_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/old", 301), ("/new", 200)],
        [SeedLink("/", "/old", "content", "Old page")],
    )
    await start_at(migrated, run, ids["/"])
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET redirect_url_id = $2 WHERE run_id = $1 AND url_id = $3",
        run,
        ids["/new"],
        ids["/old"],
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/new"], "run": str(run)},
        headers=viewer.headers,
    )

    steps = response.json()["data"]["editorial"]["steps"]
    assert [step["page"]["path"] for step in steps] == ["/", "/old", "/new"]
    assert steps[2]["via_redirect"] is True and steps[2]["anchor"] == "301 redirect"


async def test_nofollow_links_are_not_followed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/a", 200)],
        [SeedLink("/", "/a", "content", "A", followed=False)],
    )
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/a"], "run": str(run)},
        headers=viewer.headers,
    )

    assert response.json()["data"]["any"] is None


async def test_the_start_page_is_a_route_of_one_step_and_a_foreign_page_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])
    other = await make_workspace(migrated)
    other_project = await keyword_project(migrated, other)
    _, other_ids = await seed_crawl(
        migrated, other, other_project, [("/", 200), ("/secret-xyz", 200)]
    )
    url = project_url(workspace, project, "internal-links", "paths")

    home = await api.get(url, params={"url_id": ids["/"]}, headers=viewer.headers)
    foreign = await api.get(
        url, params={"url_id": other_ids["/secret-xyz"]}, headers=viewer.headers
    )

    assert home.json()["data"]["any"]["clicks"] == 0
    assert problem(foreign) == (404, "not_found")
```

Append the helper to `backend/tests/api/internal_links/support_changes.py`:

```python
async def start_at(pg: PostgresServer, run: uuid.UUID, url_id: int) -> None:
    """Say which page the crawl started from (ingest records it; a seeded crawl has none)."""
    await execute(pg, "UPDATE seo.crawl_runs SET start_url_id = $2 WHERE id = $1", run, url_id)
```

- [ ] **Step 2: Run and see them fail**

```bash
uv run pytest tests/api/internal_links/test_paths.py --no-cov -q
```

Expected: FAIL (404 on the route).

- [ ] **Step 3: The models**

Append to `schemas/internal_links_extra.py`:

```python
class RouteStep(BaseModel):
    page: ChangePage
    status_code: int | None
    anchor: str | None = Field(description="The words of the link that reached this page.")
    placement: PlacementName | None
    scope: Literal["editorial", "auto_generated", "template"] | None
    via_redirect: bool


class Route(BaseModel):
    clicks: int
    steps: list[RouteStep]


class Routes(BaseModel):
    target: ChangePage
    any: Route | None = Field(description="Over every followed link; null when not reachable.")
    editorial: Route | None = Field(description="Over editorial links (and redirects) only.")


class RoutesResponse(BaseModel):
    data: Routes
```

- [ ] **Step 4: The finder**

Create `backend/src/idraft/api/internal_links/route_finder.py`:

```python
"""The shortest route from the start page to a page (spec 7.10, plan 04 D14), by a search that
asks the database for one level of links at a time."""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from typing import Final
from uuid import UUID

from sqlalchemy import ARRAY, BigInteger, and_, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.internal_links.reads import Tiers, load_tiers, read_scope
from idraft.api.problems import NotFoundError
from idraft.api.schemas.internal_links_extra import ChangePage, Route, Routes, RouteStep
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.paths import MAX_LEVELS, Hop, Step, rebuild_route
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_pages, crawl_runs, project_pages, urls

REDIRECT_ANCHOR: Final = "301 redirect"
_LEVEL_SQL = """
    SELECT DISTINCT ON (source_url_id, target_url_id)
           source_url_id, target_url_id, anchor, placement, scope
    FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND source_url_id = ANY(:frontier) AND is_followed AND source_url_id <> target_url_id
      {scope}
    ORDER BY source_url_id, target_url_id,
             CASE scope WHEN 'editorial' THEN 0 WHEN 'auto_generated' THEN 1 ELSE 2 END, id
"""


class RouteFinder:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    @staticmethod
    async def _search(
        db: AsyncSession,
        keys: dict[str, str],
        redirects: dict[int, int],
        start: int,
        target: int,
        *,
        editorial: bool,
    ) -> dict[int, Hop] | None:
        """Level by level from `start`: the hop that reached each page, or None when `target`
        was not reached within `MAX_LEVELS` clicks. A redirect page has one way on, its target."""
        statement = text(
            _LEVEL_SQL.format(scope="AND scope = 'editorial'" if editorial else "")
        ).bindparams(bindparam("frontier", type_=ARRAY(BigInteger)))
        parents: dict[int, Hop] = {}
        seen = {start}
        frontier = [start]
        for _ in range(MAX_LEVELS):
            if not frontier or target in seen:
                break
            following: list[int] = []
            plain: list[int] = []
            for page in frontier:
                goal = redirects.get(page)
                if goal is None:
                    plain.append(page)
                elif goal not in seen:
                    seen.add(goal)
                    parents[goal] = Hop(page, goal, REDIRECT_ANCHOR, "content", "editorial")
                    following.append(goal)
            if plain:
                for row in await db.execute(statement, {**keys, "frontier": plain}):
                    if row.target_url_id in seen:
                        continue
                    seen.add(row.target_url_id)
                    parents[row.target_url_id] = Hop(
                        row.source_url_id, row.target_url_id, row.anchor, row.placement, row.scope
                    )
                    following.append(row.target_url_id)
            frontier = following
        return parents if target in seen else None

    @staticmethod
    async def _pages(
        db: AsyncSession, scope: PageScope, tiers: Tiers, ids: Sequence[int]
    ) -> dict[int, ChangePage]:
        """The page cards of the given URL ids. The ids come from the crawl's own links, so no
        id of another workspace can be among them."""
        rows = await db.execute(
            select(urls.c.id, urls.c.canonical_url, urls.c.path, project_pages.c.tier_id)
            .select_from(
                urls.outerjoin(
                    project_pages,
                    and_(
                        project_pages.c.workspace_id == scope.workspace_id,
                        project_pages.c.project_id == scope.project_id,
                        project_pages.c.url_id == urls.c.id,
                    ),
                )
            )
            .where(urls.c.id.in_(list(ids)))
        )
        return {
            row.id: ChangePage(
                url_id=str(row.id),
                url=row.canonical_url,
                path=row.path,
                tier=tiers.ref(row.tier_id),
            )
            for row in rows
        }

    async def _route(
        self, db: AsyncSession, scope: PageScope, tiers: Tiers, steps: list[Step]
    ) -> Route:
        ids = [step.url_id for step in steps]
        cards = await self._pages(db, scope, tiers, ids)
        status = {
            row.url_id: row.status_code
            for row in await db.execute(
                select(crawl_pages.c.url_id, crawl_pages.c.status_code).where(
                    crawl_pages.c.workspace_id == scope.workspace_id,
                    crawl_pages.c.run_id == scope.run_id,
                    crawl_pages.c.url_id.in_(ids),
                )
            )
        }
        return Route(
            clicks=len(steps) - 1,
            steps=[
                RouteStep(
                    page=cards[step.url_id],
                    status_code=status.get(step.url_id),
                    anchor=None if step.hop is None else step.hop.anchor,
                    placement=None if step.hop is None else step.hop.placement,
                    scope=None if step.hop is None else step.hop.scope,
                    via_redirect=step.hop is not None and step.hop.anchor == REDIRECT_ANCHOR,
                )
                for step in steps
            ],
        )

    async def routes(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, url_id: int
    ) -> Routes:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            start = (
                await db.execute(
                    select(crawl_runs.c.start_url_id).where(
                        crawl_runs.c.workspace_id == access.workspace_id,
                        crawl_runs.c.id == scope.run_id,
                    )
                )
            ).scalar_one()
            held = (
                await db.execute(
                    select(crawl_pages.c.url_id).where(
                        crawl_pages.c.workspace_id == access.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                        crawl_pages.c.url_id == url_id,
                    )
                )
            ).scalar_one_or_none()
            if held is None or start is None:
                raise NotFoundError
            redirects = {
                row.url_id: row.redirect_url_id
                for row in await db.execute(
                    select(crawl_pages.c.url_id, crawl_pages.c.redirect_url_id).where(
                        crawl_pages.c.workspace_id == access.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                        crawl_pages.c.redirect_url_id.is_not(None),
                    )
                )
            }
            keys = {"run_id": str(scope.run_id), "workspace_id": str(access.workspace_id)}
            tiers = await load_tiers(db, access.workspace_id)
            built: dict[str, Route | None] = {}
            for name, editorial in (("any", False), ("editorial", True)):
                parents = await self._search(db, keys, redirects, start, url_id, editorial=editorial)
                steps = None if parents is None else rebuild_route(parents, start, url_id)
                built[name] = None if steps is None else await self._route(db, scope, tiers, steps)
            target = (await self._pages(db, scope, tiers, [url_id]))[url_id]
            return Routes(target=target, any=built["any"], editorial=built["editorial"])
```

- [ ] **Step 5: The route and the wiring**

Create `backend/src/idraft/api/internal_links/path_routes.py`:

```python
"""The path finder (spec 7.10). Needs `data:read`; `410 links_dropped` for a crawl whose links
were dropped."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.internal_links.route_finder import RouteFinder
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import UrlId
from idraft.api.schemas.internal_links_extra import RoutesResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_finder(resources: Annotated[Resources, Depends(get_resources)]) -> RouteFinder:
    return resources.route_finder


@router.get(
    "/paths",
    summary="The shortest route from the home page to a page, over every link and over editorial links",
    response_model=RoutesResponse,
)
async def paths(
    project_id: UUID,
    access: ReadData,
    finder: Annotated[RouteFinder, Depends(get_finder)],
    url_id: Annotated[UrlId, Query()],
    run: Annotated[Literal["latest"] | UUID, Query()] = "latest",
) -> RoutesResponse:
    run_id = run if isinstance(run, UUID) else None
    return RoutesResponse(data=await finder.routes(access, project_id, run=run_id, url_id=url_id))
```

Wiring: `resources.py` `route_finder: RouteFinder`; `main.py` `RouteFinder(sessions=sessions)` and the router; `test_route_access.py` `GET .../internal-links/paths` is `"data:read"`; `test_cross_tenant.py` `INTERNAL_LINK_READS` gets `("/internal-links/paths", {"url_id": "{url_id}"}, True)` (the seeded page is the start page of its crawl only when `start_url_id` is set: set it in `seed_internal_links` with `UPDATE seo.crawl_runs SET start_url_id = $2 WHERE id = $1` and the seeded page's url id, so the route is one step and names the page).

- [ ] **Step 6: Run, regenerate, gate, commit**

```bash
uv run pytest tests/api/internal_links tests/api/test_route_access.py tests/security tests/crawl -n 4 --no-cov -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run ruff check --fix . && uv run ruff format . && uv run mypy && uv run lint-imports
git add backend/src/idraft/api/schemas/internal_links_extra.py backend/src/idraft/api/internal_links/route_finder.py backend/src/idraft/api/internal_links/path_routes.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py backend/tests/db/support.py backend/tests/api/internal_links/test_paths.py backend/openapi/v1.json
git commit -m "Internal links: path finder over every link and over editorial links"
```

---

### Task 15: The contract check and the hand-over to plan 05

**Files:**
- Modify: `backend/openapi/v1.json` (regenerated)
- Modify: `docs/superpowers/plans/2026-11-17-internal-links-04-backend-slices-2-3.md` (the as-built note at the end)

- [ ] **Step 1: Regenerate and diff the contract**

```bash
uv run python -m idraft.api.openapi > openapi/v1.json
git diff --stat openapi/v1.json
```

Expected: only additions (new paths and schemas, new fields on `CrawlRun`, `PageRow`, `PageDetail`, `Worklists`, `ListMeta`, `InternalLinksSettings`).

- [ ] **Step 2: Check every route of the API contract table exists with the right permission**

```bash
python3 - <<'EOF'
import json
spec = json.load(open("openapi/v1.json"))
wanted = {
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes/summary": "get",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes/links": "get",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes/pages": "get",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities": "get",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities/decisions": "put",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-suggestions": "get",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-suggestions/accept": "post",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-suggestions/dismiss": "post",
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/paths": "get",
}
missing = [f"{m} {p}" for p, m in wanted.items() if m not in spec["paths"].get(p, {})]
assert not missing, missing
for name in ("ChangesSummary", "ChangeLink", "MovedPage", "PageExtras", "PageDetailExtras",
             "Opportunity", "TierSuggestionRow", "Routes", "AlertSettings"):
    assert name in spec["components"]["schemas"], name
print("contract ok")
EOF
```

Expected: `contract ok`.

- [ ] **Step 3: Full backend gate**

```bash
./check.sh
```

Expected: ruff, format, mypy, import contracts and pytest pass.

- [ ] **Step 4: Commit and tell the web session**

```bash
git add backend/openapi/v1.json docs/superpowers/plans/2026-11-17-internal-links-04-backend-slices-2-3.md
git commit -m "Internal links: contract of slices 2 and 3 for the web session"
```

Plan 05 regenerates the client with `pnpm gen:api` in `apps/web` in its own commit (AGENTS.md).

---

### Task 16: End-to-end acceptance on a real crawl

**Files:**
- Create: `backend/tests/collectors/test_crawl_enrich_end_to_end.py`
- Modify: `backend/spikes/s18_link_crawl.py` only if the driver must call the enrich job (read it first)

**Read first:** `backend/tests/collectors/test_crawl_end_to_end.py` (the synthetic site through the real adapter), `backend/spikes/s18_link_crawl.py` (the dev driver, hard cost cap), plan 02 Task 14.

- [ ] **Step 1: A synthetic end-to-end test**

Create `backend/tests/collectors/test_crawl_enrich_end_to_end.py`: run the end-to-end crawl of plan 02 twice on the same project (the second with one link removed in the stand-in site, as the existing test builds sites), call `enrich_run` with a `MemoryStore` holding the HTML the crawl read, and assert through the API that `changes/summary` counts the removed link, `changes/links` lists it, the pages list with `include=changes,anchors,keywords,citations,gsc` answers 200 and `paths` finds a route to a deep page. Copy the setup (stand-in provider, `crawl_tick`, `ingest_run` loop) from `test_crawl_end_to_end.py` and keep the assertions above as the only new ones. Run:

```bash
uv run pytest tests/collectors/test_crawl_enrich_end_to_end.py --no-cov -q
```

Expected: PASS.

- [ ] **Step 2: Acceptance on the real site (needs the owner's go, spends nothing)**

The first real crawl of eventussecurity.com (421 pages, 11,086 links) already exists from plan 02 Task 14. With the worker running locally (`CRAWLS_ENABLED=true`), the tick sends `crawl_enrich` for it. Check, in order:

```bash
# in psql on the dev database
SELECT id, enrich_state, enrich_phase, previous_run_id FROM seo.crawl_runs ORDER BY created_at DESC LIMIT 3;
SELECT count(*) FROM seo.crawl_mentions WHERE run_id = '<latest run id>';
SELECT count(*) FROM seo.crawl_page_changes WHERE run_id = '<latest run id>';
```

Expected: `enrich_state = 'done'`; no page changes for a first crawl; some mentions (the list is judged by a person: open the `opportunities` route and read the first 20 rows, record how many are real in a short note in `docs/superpowers/plans/` as-built notes). Run a second crawl ("Crawl now", about $0.06 for 421 pages at the base price, within the cap the owner set for plan 02) and read `changes/summary` and `changes/links`.

- [ ] **Step 3: Time the 50,000 page case**

Use the synthetic generator of plan 02 Task 12 (`tests/api/internal_links/test_reads_size.py` builds large crawls) to seed two crawls of 50,000 pages and 600,000 links each, run `enrich_run`, and record the seconds of each phase in the as-built notes. The limits: the changes phase under 5 minutes (its statement timeout), each mention step under 6 minutes, and `changes/links` under 500 ms for 50 rows with the T1 filter. If the diff misses its limit, the fallback is to compute the editorial scope first and the `all` scope in a second step.

- [ ] **Step 4: As-built notes and commit**

Add a short "As built" section to the end of this plan (what differs, the timings, the real-crawl mention check), then:

```bash
git add docs/superpowers/plans/2026-11-17-internal-links-04-backend-slices-2-3.md backend/tests/collectors/test_crawl_enrich_end_to_end.py
git commit -m "Internal links: acceptance of slices 2 and 3 on a real crawl"
```

---

## Self-review

### Spec coverage (slices 2 and 3, backend)

| Requirement (spec 3 and 7.10) | Task |
|---|---|
| Crawl history and the crawl picker (earlier crawls read-only) | 9 (`links_available`, `previous_run_id`, `links_dropped`, older tier flow); the list itself is plan 02 |
| Changes tab: strip, lost and new links, pages that moved most | 6 (store), 10 (reads) |
| Lost links "still linked from navigation", Priority T1 and T2 | 6 (`still_linked_by`), 10 (`priority`) |
| Alert banner, alert rules (on or off, important tiers, threshold, channel), "lost editorial links to T1 and T2" | 6 (record), 10 (summary, settings); delivery by email and Slack is open point O2 |
| Worklists "Lost links to T1 and T2" and "T1 pages linking out to weak pages" | 11 |
| Links tab columns "First seen" and "Lost on", Status menu | Partly: `changes/links` (Task 10) serves "Added", "Lost" and the Lost status for the crawl in view; a first-seen date across all crawls is open point O7 |
| Pages tab columns: Change, Equity change, Tracked keywords, Average rank, AI citations, Anchors, Anchor matches keyword | 11 (`include`), 6 (stored changes and anchor counts) |
| "Mostly generic anchors" flag | 6 (counts), 11 (flag) |
| Tracked keyword and rank columns, AI citation columns, GSC clicks | 11, with 8 for Search Console |
| Tier suggestions from Search Console clicks and tracked keyword ranks, accept all and dismiss | 4, 13, with 8 |
| Opportunities: accept, dismiss, undo, bulk, copy instruction, planned fixes export | 5, 7, 12 (copy instruction is built by the web from `Opportunity`) |
| Path finder, any link and editorial only, "menus make it closer" | 3, 14 |
| Inspector additions: changes, tracked keywords, AI citations, anchor text | 11 (`PageDetail.extras`) |
| Client summary HTML | None in the backend (D16); plan 05 builds it from existing endpoints |
| By tier canvas layout | None in the backend: it is a layout of the existing neighbors data; plan 05 |

### Placeholder scan

No "TBD", no "similar to task N". Three places tell the executor to complete a helper from an existing file because the data differs per repository state: the `insert_citation` helper of Task 11 (copy of the `seed_ai` statements), the Search Console seed row in Task 1 and the end-to-end setup in Task 16. Each names the file and the function to copy from and what to change.

### Type consistency

`CrawlEnrichTask`, `ENRICH_JOB`, `enrich_run` (Task 6) are used in Tasks 7, 10, 11, 12, 13. `PageScope.links_dropped`, `require_links`, `alert_max_position` (Task 9) are used by Tasks 10, 11, 12, 14. `ChangePage` is shared by Tasks 10, 12, 14. `AlertSettings` exists twice on purpose: the pure `idraft.crawl.changes.AlertSettings` (a frozen dataclass for the worker) and the pydantic `idraft.api.schemas.internal_links_extra.AlertSettings` (the settings model); the first reads the stored dict, the second validates the API. `BulkResponse`/`BulkResult` of plan 02 are reused for suggestions.

### Assumptions not verified

- Alembic revision `0026` is free on `develop` (Task 0 checks).
- `tests/db` generic tests (RLS, grants) need no more than the `TENANT_TABLES` entries (Task 1, step 6).
- The shape of `PullState.window` used by `scope_of` (`tuple[date, date] | None`) is as read on 2026-11-17.
- `canonicalize()` lowercases the host and refuses `not a url` with `UrlRejectedError`; Task 8's unit test pins both, and fails first if not.
- Page rows of Search Console are only stored for URLs that `core.urls` already has (D10).
- The 50,000 page timings of D19 are estimates until Task 16 step 3 measures them.
