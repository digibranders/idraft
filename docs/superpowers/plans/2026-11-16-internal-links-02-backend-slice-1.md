# Internal links 02: backend slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend of the internal link tracker, slice 1: crawl a project's site through DataForSEO On-Page (when the website is added, on a schedule and on "Crawl now"), store pages and link edges per crawl with their placement, compute click depth, depth without auto-generated links, PageRank equity share, per-scope counts, flags and the tier flow, keep workspace tiers, per-page tiers (manual beats the first matching rule), tier rules, CSV import and tags, and serve the read API that the Pages, Links, Journey and Tier flow screens of plan 03 are built from.

**Architecture:** One raw SQL migration (0025) adds four `core` tables (tier levels, tier rules, project pages, page terms) and five `seo` tables (crawl runs, crawl pages, crawl links partitioned by run, tier flow, tier stats) with row-level security and least-privilege grants. A new pure package `idraft.crawl` holds the rules and the maths (scopes, tier rules, ceiling, schedule, depth, PageRank with numpy and scipy, the template pass, edges from classified HTML); it imports the placement classifier of plan 01 (`idraft.crawl.placement`). A DataForSEO On-Page adapter sits next to the existing client. The worker drives a crawl with its own state table and a `crawl_tick` (queue scheduled crawls, budget check, post, poll the summary, cancel, hand over to ingest, retention), and a resumable `crawl_ingest` job (pages, non-indexable pages, raw HTML to R2, classification, the template pass, metrics, tier rules, tier flow). The API adds `idraft.api.internal_links` (tiers, rules, tags, crawls, reads) and an `internal_links` part to the project settings.

**Tech Stack:** Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2 Core (async), PostgreSQL 18 (asyncpg), Alembic with raw SQL, Taskiq on Redis streams, numpy and scipy (new), zstandard, pytest with Testcontainers, import-linter.

---

## Where this plan sits

- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md` (sections 3 to 6, 8, 9, 11, 12).
- Plan 01 (crawl spike, written in parallel): `docs/superpowers/plans/2026-11-16-internal-links-01-crawl-spike.md`. It builds the pure placement classifier `backend/src/idraft/crawl/placement.py` and records real On-Page payloads. Its results can change decisions D6, D7, D12 and D13 below; Task 0 says how.
- Plan 03 (web) is written after this plan from the API contract below.
- Worktree: `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-backend`, branch `feat/internal-links-backend`, cut from `develop`. Paths below are relative to the worktree. Work merges into `develop`, never `main` (AGENTS.md). Make it with:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform
git fetch origin
git worktree add .claude/worktrees/internal-links-backend -b feat/internal-links-backend origin/develop
```

- Every backend command runs in `backend/` with the Colima variables set:

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend
```

- The gate at the end of every task (each command must print what is shown; a partial pytest run takes `--no-cov`):

```bash
uv run ruff check --fix . && uv run ruff format .
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # N files already formatted
uv run mypy                    # Success: no issues found in N source files
uv run lint-imports            # Contracts: 8 kept, 0 broken. (6 before Task 2 and plan 01; 7 with one of them)
```

- Files this plan never touches: anything under `apps/web/` (plan 03 regenerates `apps/web/src/lib/api/schema.ts` in its own commit), `infra/`, `docs/ops/`, the design preview, and every file another session has uncommitted in the main checkout. Every commit names its files; never `git add -A` or `git add .`. No attribution lines in commit messages.
- Shared files this plan changes and other tracks also change: `backend/openapi/v1.json`, `backend/src/idraft/db/tables.py`, `backend/src/idraft/api/main.py`, `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/audit.py`, `backend/tests/api/test_route_access.py`, `backend/tests/db/support.py`, `backend/tests/db/test_grants.py`, `backend/pyproject.toml`, `backend/uv.lock`. Rebase on `develop` before each merge and regenerate `backend/openapi/v1.json` after a rebase that touched routes. If another branch has taken revision `0025` by then, renumber this migration to the next free number and set `down_revision` to the new head; nothing else in the plan depends on the number.

---

## Decisions

Each is a choice the spec left open or that the code forced. "Why" follows each one.

- **D1. Routes are workspace scoped.** The spec writes `{P}` as `/api/v1/projects/{project_id}`. Every project route in the code is `/api/v1/workspaces/{workspace_id}/projects/{project_id}/...` (`api/ai/engine_routes.py`, `api/operations/settings_routes.py`), and the membership dependency checks the project scope from the `project_id` path parameter (`api/workspaces/dependencies.py`, `workspace_member`). This plan uses that prefix. Tier settings are `/api/v1/workspaces/{workspace_id}/page-tiers`.
- **D2. Tables live in the `seo` and `core` schemas, not a new `crawl` schema.** The six schemas are fixed in migrations 0001 and 0002 and in `tests/db/support.py` (`SCHEMAS`), which the row-level security, grant and least-privilege tests walk. A seventh schema needs a CREATE, USAGE grants and every test list changed, for no gain. So the spec's `crawl.runs`, `crawl.pages`, `crawl.links` and `crawl.tier_flow` are `seo.crawl_runs`, `seo.crawl_pages`, `seo.crawl_links` and `seo.crawl_tier_flow`, plus `seo.crawl_tier_stats` (the per-tier strip, split out because it has another key). The core tables keep the spec's names: `core.page_tier_levels`, `core.project_pages`, `core.tier_rules`, `core.page_terms`.
- **D3. A crawl has its own run table and its own tick, not the task ledger.** `ops.collection_runs.trigger` allows only `schedule`, `manual`, `backfill` and `retry`; `ops.collection_tasks.subject_type` has no site; and `Provider.fetch` stores one payload per task, while a crawl is one post, many summary polls, paged pages, and one raw HTML call per page. Search Console already works this way (`collectors/gsc_plan.py`: "`ops.schedules` is the clock only"). `seo.crawl_runs` holds the spec's states, and `collectors/crawl_runs.py` moves them.
- **D4. The crawl schedule is not an `ops.schedules` row.** `idraft.domain.schedules.Cadence` has `daily`, `weekly` and `monthly` only, and the spec offers "every two weeks". The schedule is a project setting (`internal_links.schedule`), and `idraft.crawl.schedule.crawl_due` decides: due when the project's local time is inside its night slot (01:00 to 05:00, the minute picked from the project id so projects spread out) and the last crawl started at least the interval minus one day ago. A project with no crawl is due on its next night. So `TaskWorkload` gains nothing, and the three task-workload CHECKs stay as they are.
- **D5. Cost and budget.** DataForSEO charges On-Page when the task is posted (the summary documentation: "Your account is charged only for posting a task"). So the crawl tick, before it posts, calls `budget.check(..., workload=CostWorkload.SITE_CRAWL, estimate=ceiling x page price)`, and after a post it writes one cost event with the cost the post reported (`cost_source='provider_reported'`, `price_unit='page'`, `units=ceiling`; the price book estimate when the answer carries no cost). A new cost workload and budget group `site_crawl` (channel `seo`) is added to `idraft.domain.workloads`, to the CHECKs on `ops.provider_cost_events.workload` and `ops.budgets.workload`, and to the `BudgetGroup` Literal of `api/schemas/budgets.py`; `tests/db/test_domain_values.py` pins them together. `budget.check` takes `TaskWorkload | CostWorkload` (its body already maps either through `budget_group`). A crawl spends at post time, so nothing needs holding in `budget.committed` while it runs. "Crawl now" is checked in the request too, so a blocked crawl is refused with `422 budget_exceeded` and is not queued (spec section 9). The price book gets `on_page/task_post` at $0.00015 a page and $0.0015 with JavaScript (spec 6.1, verified 2026-11-16).
- **D6. No pingback.** Doc 04 section 11.2 says "polling only, no pingback (ADR-022)". The tick reads `GET /v3/on_page/summary/{id}` once a minute for each crawl under way, which also gives the "pages found so far" the screen shows. No public callback route is added.
- **D7. Edges come from our own HTML parse; the provider's `/links` is the fallback.** The spec reads `/on_page/links` and then matches each link to the classified HTML "by source page and href in document order". `/links` is not ordered by source and its ordering within a page is not documented, so matching needs every link of the crawl in memory, and nothing makes a mismatch visible. Instead, for each crawled HTML page with status 200, ingest reads its raw HTML (`/on_page/raw_html`, free), runs the plan 01 classifier, and writes that page's edges in one transaction: links are canonicalized (canonicalizer v1), kept when internal, deduplicated per (target, placement, anchor, kind) with an occurrence count. One page at a time keeps memory bounded and makes ingest resumable per page. A 200 page with no HTML gets its links from `/on_page/links` filtered by `page_from`, all `content`, and the page is flagged "Placement unknown" (spec section 9). The spike checks that our hrefs match the provider's links (open point O3).
- **D8. Link partitions per run, made and dropped through definer functions.** `seo.crawl_links` is `PARTITION BY LIST (run_id)`. The worker has no DDL right, so `seo.add_crawl_links_partition(uuid)` and `seo.drop_crawl_links_partition(uuid)` are `SECURITY DEFINER`, owned by the migrator, `EXECUTE` for `app_worker` only, exactly as `ops.maintain_partitions` is. Partitions belong to the migrator and carry no grants, which `tests/db/test_grants.py` and `tests/db/test_partitions.py` already require. Retention keeps the links of the last 4 finished crawls of a project (`ready` or `stopped_at_ceiling`) and drops older partitions; `seo.crawl_pages` is kept for every crawl (spec 6.5). Edge rows carry URL ids without foreign keys (as `ai.citations` does): 600,000 key checks per crawl buy nothing for rows that are written once.
- **D9. Raw HTML is overwritten per page, not kept per crawl.** The key is `crawl/v1/html/{project_id}/{url_hash_hex}.html.zst` in the existing raw bucket (`idraft.storage.raw.ObjectStore`, `compress`). A later crawl overwrites the same key, so only the latest HTML of each URL is kept (spec 6.3 step 2) and no delete call or lifecycle rule is needed. `ops.raw_payloads` is not used: it would take a row per page, and its retention classes have no slot for HTML. Shortcut: a page that leaves the site keeps its last HTML object; a cleanup joins the ops session's R2 lifecycle work when it matters.
- **D10. Tier-based page columns are computed at read time; only the tier flow is stored.** Tiers attach to the URL (spec 5.2), so "linked from tiers" and "outlinks to T1" are computed for the rows of the page being read (at most 200), from the edge indexes and `core.project_pages`. Only `seo.crawl_tier_flow` and `seo.crawl_tier_stats` are stored, and recomputed after a tier, rule or tier-level change by one SQL statement each (`collectors.crawl_store.recompute_tier_flow`). The request recomputes inline when the latest crawl holds at most 200,000 links; above that it sets `seo.crawl_runs.tier_flow_stale` and the crawl tick recomputes it within a minute (spec 6.6, "static refetch bar"). Reciprocal pairs are an `EXISTS` on the edge index at read time, not a stored flag.
- **D11. Per-page counts and flags are SQL over the stored edges; depth and PageRank are pure Python.** Counts per scope, top anchor and the orphan flags are three `UPDATE ... FROM (SELECT ... GROUP BY)` statements over the run's partition. Depth (breadth-first search) and PageRank (sparse matrix, numpy and scipy) are pure functions in `idraft.crawl.graph`, fed with (source, target, scope, followed) arrays read once.
- **D12. PageRank details.** Nodes are every crawled URL and every edge target. For each source, the out-degree is its number of distinct targets, followed or not; a nofollow pair's share is dropped. A 3xx page passes everything to its redirect target. A 4xx or 5xx page passes nothing; its value is reported as equity lost to errors. A 200 page with no links out (a dangling node) spreads its value over all nodes, as standard PageRank does (the spec is silent). Leaked value is not handed back; shares are each value divided by the sum, so shares add up to 1. Damping 0.85, stop when the largest change is under 1e-9 or after 100 rounds.
- **D13. The ceiling.** `crawl_ceiling`: no earlier finished crawl gives 2,000 (a probe); an earlier crawl that listed N sitemap pages (`checks.from_sitemap`) gives max(2,000, 3 x N); an earlier crawl with no sitemap page gives 50,000 (spec 6.2). "Crawl again with a higher limit" (`trigger='ceiling_retry'`) gives max(2 x the stopped crawl's ceiling, `crawl_ceiling` of the stopped crawl), at most 200,000. Because the post is billed by the ceiling (D5), open point O1 asks the owner about the 50,000 default once the spike has the real price.
- **D14. "Website added".** `ProjectCreate` gains `map_internal_links: bool = False`. The web form sends `true` by default (the ticked checkbox); the API default is false so the dev seed and API callers that set a domain never start a paid crawl by surprise. When true and `primary_domain` is set, the project insert and a `queued` crawl with `trigger='website_added'` commit together. A domain added later by `PATCH` is crawled on the project's next night through D4.
- **D15. Permissions map onto existing keys.** A new `Permission` would need `apps/web/src/lib/permissions/permissions.ts` changed, which this plan may not touch. Tier settings (add, rename, delete): `workspace:update` (owner and admin, spec 5.1). Page tiers, rules, CSV import and tags: `projects:write` (owner, admin, editor). Crawl now and cancel: `runs:trigger` (owner, admin, editor, analyst). Settings: the existing `projects:write` route. Every read: `data:read`.
- **D16. One tier per page, stored per URL.** `core.project_pages` has one row per (project, URL) with `tier_source` `manual` or `rule`. A manual row with a null tier is the spec's manual Untiered (`'none'`). No row means untiered by no rule. Rules are applied by `idraft.crawl.tiers.first_match` (first rule by position wins, manual beats rules) in `collectors.crawl_store.apply_rules`, after every rule change and after every crawl, so new pages arrive tagged. A CSV row whose URL is not in the latest crawl stores a manual row on the URL's `core.urls` id and is listed back as pending; it applies when a crawl finds the URL, with no extra code.
- **D17. Default tiers.** Migration 0025 gives every existing workspace T1 Money pages, T2 Supporting pages, T3 Content pages and T4 Utility pages; `WorkspaceService.create` inserts the same four next to `insert_default_quotas`. Workspaces that tests insert directly have none, so the tests that need tiers call `tests.api.internal_links.support.seed_tiers`.
- **D18. Tags are `core.page_terms` rows of `tag` vocabularies.** `PUT .../pages/tags` adds and removes terms of the project's or the workspace's vocabularies of kind `tag`; any other term is `422 validation_failed` with `not_a_tag`. Tags filter pages and edges and never enter the tier maths (spec 5.3). The existing `term-assignments` route is left alone: its subject types are tracked keywords and prompts.
- **D19. One template pass: plan 01's.** Plan 01 writes the pass as `idraft.crawl.placement.place_links`, with guards the spec text lacks (a steady link count per page, so article prose with changing links stays editorial; folders of at least 4 pages; "the same targets" as coverage with a page's dropped self link counted), and spike S-17 measures that one. Ingest stores edges page by page, so `idraft.crawl.template` rebuilds `place_links`' input from the stored candidate links of a crawl and applies what it returns; it holds no rule of its own (open point O4).
- **D20. CSV export.** The pages and edges lists take `format=csv` (spec 8) and return at most 100,000 rows with the same filters, as `text/csv`, cells that a spreadsheet would run as a formula prefixed with `'` (as `api/imports/service.py` does).
- **D21. Orphans in slice 1 are sitemap orphans.** The spec also counts "a page with Search Console clicks in the last 90 days that no crawled page links to". Search Console rows are keyed by query and page text, not by `core.urls` id, so joining them needs a URL mapping that slice 1 does not have. Slice 1 flags a crawled page found in the sitemap with no internal link in from any scope; the Search Console part waits for slice 2 (open point O5).

## Dependencies between tasks

| Task | What | Can start | Waits for |
|---|---|---|---|
| 0 | Read the spike results and adjust | When plan 01 reports | Plan 01 |
| 1 | Migration 0025, tables, workloads | At once | Nothing |
| 2 | `idraft.crawl` package: scopes, tier rules, ceiling, schedule | At once | Nothing |
| 3 | Tier levels service and API | After 1 | 1 |
| 4 | Depth and PageRank (numpy, scipy) | After 2 | 2 |
| 5 | Template pass over stored links | After 2 and plan 01 is merged | Plan 01 `place_links` |
| 6 | Page tiers, rules, preview, reset, CSV import, tags, tier flow store | After 1, 2, 3 | 1, 2, 3 |
| 7 | On-Page adapter | At once; payload shapes confirmed by 0 | 0 for the recorded fixtures |
| 8 | Edges from classified HTML | After 2 and plan 01 is merged | Plan 01 classifier |
| 9 | Crawl runs in the worker | After 1, 2, 7 | 1, 2, 7 |
| 10 | Crawl API, project settings, website added | After 1, 9 | 1, 9 |
| 11 | Ingest | After 4, 5, 6, 7, 8, 9 | Plan 01 through 8 |
| 12 | Read API | After 6; full data from 11 | 6 |
| 13 | OpenAPI check and hand-over to plan 03 | After 3, 6, 10, 12 | Those |
| 14 | End-to-end acceptance | Last | All, and the spike site |

Tasks 1, 2 and 7 can run in parallel at once; 3 and 4 after them; 5 and 8 the day plan 01 merges.

## File map

| File | Task | What it holds |
|---|---|---|
| `backend/src/idraft/db/migrations/versions/0025_internal_links.py` | 1 | The migration |
| `backend/src/idraft/db/tables.py` | 1 | Nine `Table` objects |
| `backend/src/idraft/domain/workloads.py` | 1 | `CostWorkload.SITE_CRAWL`, `BudgetGroup.SITE_CRAWL` |
| `backend/src/idraft/collectors/budget.py` | 1 | `check` takes a cost workload too |
| `backend/src/idraft/api/schemas/budgets.py` | 1 | `site_crawl` budget group |
| `backend/tests/db/support.py`, `test_grants.py`, `test_internal_links_schema.py` | 1 | Schema tests |
| `backend/src/idraft/crawl/__init__.py`, `scopes.py`, `tiers.py`, `ceiling.py`, `schedule.py` | 2 | Pure rules |
| `backend/pyproject.toml` | 2, 4 | Import contract, numpy, scipy, scipy-stubs |
| `backend/src/idraft/api/internal_links/__init__.py`, `problems.py`, `tier_levels.py`, `tier_level_routes.py` | 3 | Tier settings |
| `backend/src/idraft/api/schemas/internal_links.py` | 3, 6, 10, 12 | Request and response models |
| `backend/src/idraft/api/workspaces/service.py`, `workspaces/repository.py` | 3 | Default tiers for a new workspace |
| `backend/src/idraft/crawl/graph.py` | 4 | Depth and PageRank |
| `backend/src/idraft/crawl/template.py` | 5 | Template pass |
| `backend/src/idraft/collectors/crawl_store.py` | 6 | Latest run, rule application, tier flow |
| `backend/src/idraft/api/internal_links/page_tiers.py`, `page_tier_routes.py` | 6 | Page tiers, rules, import, tags |
| `backend/src/idraft/providers/dataforseo/on_page.py`, `client.py` | 7 | On-Page adapter, call family |
| `backend/tests/providers/dataforseo/test_on_page.py` | 7 | Adapter tests on documented payloads (replaced by the spike's) |
| `backend/src/idraft/crawl/hosts.py` | 6 | The site's hosts |
| `backend/src/idraft/crawl/edges.py` | 8 | Edges of one page |
| `backend/src/idraft/collectors/crawl_runs.py` | 9 | Queue, budget, post, progress, cancel, retention |
| `backend/src/idraft/worker/assembly.py` | 9, 11 | `crawl_tick`, `crawl_ingest` job |
| `backend/src/idraft/api/internal_links/crawls.py`, `crawl_routes.py` | 10 | Crawl API |
| `backend/src/idraft/api/operations/settings.py`, `schemas/operations.py` | 10 | `internal_links` settings |
| `backend/src/idraft/api/projects/service.py`, `projects/routes.py`, `schemas/projects.py` | 10 | `map_internal_links` |
| `backend/src/idraft/collectors/crawl_ingest.py` | 11 | Ingest |
| `backend/src/idraft/api/internal_links/reads.py`, `read_routes.py`, `csv_export.py` | 12 | Read API |
| `backend/src/idraft/api/audit.py`, `resources.py`, `main.py` | 3, 6, 10, 12 | Wiring |
| `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json` | 3, 6, 10, 12, 13 | Route table, contract |
| `backend/tests/collectors/crawl_support.py`, `backend/tests/collectors/test_crawl_end_to_end.py` | 9, 11, 14 | Stand-in provider, synthetic site, acceptance |

## Names

Other tasks and plan 03 depend on these. Signatures are exact.

**Database (migration `0025_internal_links.py`, `revision = "0025"`, `down_revision = "0024"`)**

- `core.page_tier_levels (id, workspace_id, position 1..8, name, description, created_at, updated_at)`, unique `(workspace_id, position)` deferrable, unique `(id, workspace_id)`.
- `core.tier_rules (id, workspace_id, project_id, position, match_type, value, tier_id, created_by, created_at)`, unique `(project_id, position)` deferrable.
- `core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source, rule_id, set_by, set_at)`, primary key `(project_id, url_id)`.
- `core.page_terms (project_id, url_id, term_id, workspace_id, created_at)`, primary key `(project_id, url_id, term_id)`.
- `seo.crawl_runs`, `seo.crawl_pages`, `seo.crawl_links` (partitioned by run), `seo.crawl_tier_flow`, `seo.crawl_tier_stats`. Columns in Task 1.
- Functions `seo.add_crawl_links_partition(p_run_id uuid) RETURNS void` and `seo.drop_crawl_links_partition(p_run_id uuid) RETURNS boolean`, `EXECUTE` for `app_worker` only.
- Cost workload and budget group `site_crawl`. Price book endpoint `on_page/task_post`, `price_unit='page'`.

**`idraft.db.tables`**: `page_tier_levels`, `tier_rules`, `project_pages`, `page_terms`, `crawl_runs`, `crawl_pages`, `crawl_links`, `crawl_tier_flow`, `crawl_tier_stats`.

**`idraft.domain.workloads`**: `CostWorkload.SITE_CRAWL = "site_crawl"`, `BudgetGroup.SITE_CRAWL = "site_crawl"`.

**`idraft.crawl`** (pure)

- `scopes`: `class LinkScope(StrEnum)` (`EDITORIAL="editorial"`, `AUTO_GENERATED="auto_generated"`, `TEMPLATE="template"`, `ALL="all"`), `EDGE_SCOPES: Final[tuple[LinkScope, ...]]`, `PLACEMENTS: Final[tuple[str, ...]]`, `scope_of(placement: str) -> LinkScope`, `in_scope(edge_scope: LinkScope, view: LinkScope) -> bool`.
- `tiers`: `MAX_TIERS = 8`, `DEFAULT_TIERS`, `tier_code(position: int) -> str`, `class MatchType(StrEnum)`, `TierRule(rule_id, position, match_type, value, tier_id)`, `check_rule_value(match_type: MatchType, value: str) -> str | None`, `rule_matches(rule: TierRule, path: str) -> bool`, `first_match(rules: Sequence[TierRule], path: str) -> TierRule | None`.
- `ceiling`: `FLOOR = 2_000`, `NO_SITEMAP = 50_000`, `MULTIPLIER = 3`, `RETRY_MAX = 200_000`, `crawl_ceiling(previous_sitemap_pages: int | None) -> int`, `retry_ceiling(previous_ceiling: int, previous_sitemap_pages: int | None) -> int`.
- `schedule`: `class CrawlSchedule(StrEnum)` (`weekly`, `every_two_weeks`, `monthly`, `off`), `INTERVALS`, `NIGHT_START`, `NIGHT_HOURS`, `SLOT_LENGTH`, `slot_offset(project_id: UUID) -> timedelta`, `crawl_due(*, schedule: CrawlSchedule, last_started: datetime | None, timezone: str, project_id: UUID, now: datetime) -> bool`.
- `graph`: `DAMPING`, `TOLERANCE`, `MAX_ROUNDS`, `Node(url_id, status_code, redirect_to)`, `Link(source, target, scope, followed)`, `click_depths(start: int, nodes: Mapping[int, Node], links: Iterable[Link], *, without_auto: bool = False) -> dict[int, int]`, `Equity(shares, lost_to_errors, rounds)`, `pagerank(nodes: Mapping[int, Node], links: Iterable[Link]) -> Equity`, `DEEP_EXTRA = 3`, `deep_only_through_auto(depth: int | None, depth_without_auto: int | None) -> bool`.
- `template`: `TemplateRow(link_id, source_url, target_url, container, placement)`, `template_placements(rows: Sequence[TemplateRow], pages: Sequence[str]) -> dict[int, str]` (through plan 01's `place_links`).
- `hosts`: `site_hosts(host: str, allowed_subdomains: Sequence[str]) -> frozenset[str]`.
- `edges`: `ANCHOR_MAX = 500`, `PageEdge(target, anchor, kind, placement, scope, rel, followed, occurrences, container_hash, template_candidate)`, `page_edges(links: Sequence[FoundLink], *, page: CanonicalUrl, hosts: frozenset[str]) -> list[PageEdge]`.

**Plan 01 contract this plan imports** (`idraft.crawl.placement`, as plan 01 Decision 13 confirms): `class Placement(StrEnum)` with exactly the values of `PLACEMENTS`; `@dataclass(frozen=True, slots=True) class FoundLink(href: str, anchor: str, kind: Literal["text", "image"], rel: frozenset[str], placement: Placement, container: str, open: bool)`; `classify(html: str, page_url: str) -> list[FoundLink]` (document order; `href` absolute; jump links, buttons and script-only controls already left out; a link rule 4 left open comes back `auto_generated` with `open` true); `place_links(pages: Mapping[str, Sequence[FoundLink]], ...) -> dict[str, list[FoundLink]]` (the template pass) and `MIN_FOLDER_PAGES`. Task 8 step 1 checks these names; `idraft.crawl.edges` and `idraft.crawl.template` are the only modules that import them.

**Provider** (`idraft.providers.dataforseo.on_page`): `FAMILY = "on_page"`, `TASK_POST = "on_page/task_post"`, `PAGE_LIMIT = 1000`, `CrawlOrder`, `PostedCrawl`, `CrawlSummary`, `PageItem`, `PageBatch`, `NonIndexableItem`, `NonIndexableBatch`, `LinkItem`, `class OnPage` with `post`, `summary`, `pages`, `non_indexable`, `links_from`, `raw_html`, `force_stop`.

**Collectors**

- `crawl_store`: `DATA_STATES`, `ACTIVE_STATES`, `INLINE_FLOW_LINKS = 200_000`, `latest_run(db, workspace_id, project_id) -> UUID | None`, `apply_rules(db, *, workspace_id, project_id) -> int`, `recompute_tier_flow(db, *, workspace_id, run_id) -> None`, `tiers_changed(db, *, workspace_id, project_id) -> None`.
- `crawl_runs`: `TICK_LIMIT`, `KEEP_RUNS = 4`, `FEW_PAGES = 3`, `INGEST_JOB = "crawl_ingest"`, `CrawlIngestTask(workspace_id, run_id)` with `dedupe_key`, `CrawlBusyError(run_id)`, `NoSiteError`, `NoStoppedCrawlError`, `crawl_price(db, *, javascript: bool, on: date) -> Decimal`, `queue_run(db, *, workspace_id, project_id, trigger, requested_by, now) -> UUID`, `CrawlTickReport`, `crawl_tick(sessions, on_page, send_ingest, *, now) -> CrawlTickReport`.
- `crawl_ingest`: `PASS_TIME`, `INGEST_FAILURES_MAX = 5`, `html_key(project_id: UUID, url_hash: bytes) -> str`, `IngestOutcome`, `ingest_run(sessions, on_page, store, task, *, deadline) -> IngestOutcome`.

**API**: `idraft.api.internal_links` with `tier_level_routes.router`, `page_tier_routes.router`, `crawl_routes.router`, `read_routes.router`; services `TierLevelService`, `PageTierService`, `CrawlService`, `LinkReadService` on `Resources.tier_levels`, `Resources.page_tiers`, `Resources.crawls`, `Resources.link_reads`. Problems: `TierLimitError` (422 `tier_limit`), `TierInUseError` (422 `tier_in_use`), `CrawlInProgressError` (409 `crawl_in_progress`), `NoWebsiteError` (422 `no_website`), `BudgetExceededError` (422 `budget_exceeded`), `NoCrawlError` (404 `no_crawl`).

**Audit actions**: `page_tier.created`, `page_tier.updated`, `page_tier.deleted`, `tier_rule.created`, `tier_rule.updated`, `tier_rule.deleted`, `page_tiers.changed`, `page_tags.changed`, `link_crawl.requested`, `link_crawl.cancelled`.

## Row-level security and permissions

- Every new table carries `workspace_id` with the `tenant_isolation` policy (`idraft.db.ddl.tenant_isolation`); every key between tenant tables includes `workspace_id` (`tests/db/test_rls.py` reads the catalog). The worker bypasses row-level security, so every worker statement names the workspace or the run, and the worker's `UPDATE` grants are on named columns only.
- One workspace can never read another's tiers, rules, pages, tags or crawls: Task 1 proves it table by table through `seed_tenant` and `test_rls.py`, and Tasks 3, 6, 10 and 12 prove it through the routes (a member of workspace A asking for workspace B's project gets 404, as `workspace_member` answers).

| Action | Permission | Roles |
|---|---|---|
| Read tiers, rules, pages, edges, journey, tier flow, crawls, settings | `data:read` | owner, admin, editor, analyst, viewer |
| Add, rename, delete tier levels | `workspace:update` | owner, admin |
| Set tiers on pages, reset, CSV import, rules, tags | `projects:write` | owner, admin, editor |
| Crawl now, cancel | `runs:trigger` | owner, admin, editor, analyst |
| Change internal links settings | `projects:write` | owner, admin, editor |

| Table | `app_api` | `app_worker` |
|---|---|---|
| `core.page_tier_levels` | SELECT, INSERT, DELETE; UPDATE (position, name, description, updated_at) | SELECT |
| `core.tier_rules` | SELECT, INSERT, DELETE; UPDATE (position, match_type, value, tier_id) | SELECT |
| `core.project_pages` | SELECT, INSERT, DELETE; UPDATE (tier_id, tier_source, rule_id, set_by, set_at) | SELECT, INSERT, DELETE; UPDATE (tier_id, tier_source, rule_id, set_at) |
| `core.page_terms` | SELECT, INSERT, DELETE | none |
| `seo.crawl_runs` | SELECT, INSERT; UPDATE (state, cancel_requested, error_code, finished_at, tier_flow_stale) | SELECT, INSERT; UPDATE (the run columns of `_RUN_WORKER_UPDATE`) |
| `seo.crawl_pages` | SELECT | SELECT, INSERT; UPDATE (the columns of `_PAGE_WORKER_UPDATE`) |
| `seo.crawl_links` | SELECT | SELECT, INSERT, DELETE; UPDATE (placement, scope) |
| `seo.crawl_tier_flow`, `seo.crawl_tier_stats` | SELECT, INSERT, DELETE | SELECT, INSERT, DELETE |

## API contract

`{W}` is `/api/v1/workspaces/{workspace_id}`, `{P}` is `{W}/projects/{project_id}`. Ids are UUID strings except `url_id` and `link_id`, which are 64-bit integers sent as strings (doc 04 section 2: observation ids are strings in the API). `run` is `latest` (default) or a crawl id; `scope` is `editorial` (default), `auto_generated`, `template` or `all`. A list with no finished crawl answers `404 no_crawl`. Unknown query parameters are `422` (`reject_unknown_query`).

| Method and path | Permission | Query or body | Response |
|---|---|---|---|
| `GET {W}/page-tiers` | data:read | none | `PageTierList {data: PageTier[]}` |
| `POST {W}/page-tiers` | workspace:update | `PageTierCreate {name 1..60, description 0..200 = ""}` | 201 `PageTierResponse {data: PageTier}`; 422 `tier_limit` at 8 |
| `PATCH {W}/page-tiers/{tier_id}` | workspace:update | `PageTierPatch {name?, description?}` (at least one) | `PageTierResponse` |
| `DELETE {W}/page-tiers/{tier_id}` | workspace:update | query `move_to` = a tier id or `none` | 204; 422 `tier_in_use` (`page_count`, `rule_count`) when used and `move_to` is missing; 422 `validation_failed` `move_to_self` |
| `GET {P}/tier-rules` | data:read | none | `TierRuleList {data: TierRule[]}` |
| `POST {P}/tier-rules` | projects:write | `TierRuleCreate {match_type, value, tier_id, position?}` | 201 `TierRuleResponse` |
| `PATCH {P}/tier-rules/{rule_id}` | projects:write | `TierRulePatch {match_type?, value?, tier_id?, position?}` | `TierRuleResponse` |
| `DELETE {P}/tier-rules/{rule_id}` | projects:write | none | 204 |
| `POST {P}/tier-rules/preview` | data:read | `TierRulePreviewRequest {match_type, value, position?, rule_id?}` | `TierRulePreviewResponse {data: {matching_pages, would_apply}}` (`would_apply`: matching pages with no manual tier that no earlier rule claims) |
| `PUT {P}/pages/tiers` | projects:write | `PageTierSet {url_ids? (1..5000) or filter?: PageFilter, tier_id: uuid or null}` (null is manual Untiered) | `BulkResponse {data: {matched, changed}}`; 422 `too_many_subjects` over 20,000 matches |
| `POST {P}/pages/tiers/reset` | projects:write | `PageSelection {url_ids? or filter?}` | `BulkResponse` |
| `POST {P}/pages/tiers/import` | projects:write | `TierImportRequest {csv: string up to 1 MB}` | `TierImportResponse {data: {accepted, pending: [{line, url}], errors: [{line, code, message}], applied}}`; nothing applies while `errors` is not empty |
| `PUT {P}/pages/tags` | projects:write | `PageTagChange {url_ids? or filter?, add: uuid[], remove: uuid[]}` | `TagChangeResponse {data: {matched, added, removed}}` |
| `GET {P}/link-crawls` | data:read | `cursor`, `limit` (50, max 200) | `CrawlRunPage {data: CrawlRun[], page: CursorPageInfo}` newest first |
| `POST {P}/link-crawls` | runs:trigger | `CrawlCreate {higher_limit: bool = false}` | 202 `CrawlRunResponse`; 409 `crawl_in_progress` (`run_id`); 422 `no_website`; 422 `budget_exceeded` (`budget_id`); 422 `validation_failed` `no_stopped_crawl` for `higher_limit` without a stopped crawl |
| `GET {P}/link-crawls/{run_id}` | data:read | none | `CrawlRunResponse` |
| `POST {P}/link-crawls/{run_id}/cancel` | runs:trigger | none | `CrawlRunResponse`; 409 `invalid_state_transition` unless `queued` or `crawling` |
| `GET {P}/internal-links/pages` | data:read | `run`, `scope`, `filter[tier]` (tier ids or `none`, commas), `filter[tag]` (term ids, any), `filter[status]` (`2xx`,`3xx`,`4xx`,`5xx`), `filter[indexable]` (bool), `filter[flags]` (all of: `orphan`, `editorial_orphan`, `deep_only_through_auto`, `placement_unknown`, `has_broken_outlinks`), `filter[worklist]` (`under_linked_t1`, `orphans`, `editorial_orphans`, `deep_only_through_auto`), `q` (path contains, 1..200), `sort` (`path`, `click_depth`, `linking_pages`, `outlinks`, `equity_share`, `status_code`, each with `-` for descending; default `-equity_share`), `cursor`, `limit` (50, max 200), `format` (`json`, `csv`) | `PageRowPage {data: PageRow[], page: CursorPageInfo, meta: {run_id, scope, total}}`, or `text/csv` |
| `GET {P}/internal-links/pages/{url_id}` | data:read | `run`, `scope` | `PageDetailResponse {data: PageDetail}`; 404 when the URL is not in the crawl |
| `GET {P}/internal-links/edges` | data:read | `run`, `scope`, `filter[source_tier]`, `filter[target_tier]`, `filter[tag]` (source or target), `filter[placement]` (commas), `filter[target_status]` (`2xx`..`5xx`), `filter[source]`, `filter[target]` (url ids), `filter[worklist]` (`broken_and_redirected`, `links_to_non_indexable`), `q_source`, `q_target`, `cursor`, `limit`, `format` | `EdgeRowPage {data: EdgeRow[], page, meta: {run_id, scope, total}}`, or `text/csv`. Order: template, auto-generated, editorial, then target path, then link id |
| `GET {P}/internal-links/neighbors` | data:read | `url_id` (required), `direction` (`in`, `out`), `run`, `scope`, `limit` (8, max 50), `offset` (0, max 10,000) | `NeighborList {data: Neighbor[], meta: NeighborMeta}` |
| `GET {P}/internal-links/tier-flow` | data:read | `run`, `scope` | `TierFlowResponse {data: TierFlow}` |
| `GET {P}/internal-links/worklists` | data:read | `run` | `WorklistsResponse {data: Worklists}` |
| `GET {P}/settings`, `PATCH {P}/settings` | data:read, projects:write | `ProjectSettingsPatch {seo?, internal_links?}` (at least one) | `ProjectSettingsResponse` with `internal_links` |
| `POST {W}/projects` | projects:write | `ProjectCreate` gains `map_internal_links: bool = false` | unchanged |

Response models (every field always present; `null` where shown):

- `PageTier {tier_id, position, code ("T1".."T8"), name, description, label ("T1 Money pages"), page_count, rule_count, updated_at}`
- `TierRef {tier_id, code, name}`; a `null` `TierRef` is Untiered.
- `TierRuleView {rule_id, position, match_type ("exact","prefix","pattern"), value, tier: TierRef, created_at}` (`TierRuleList {data: TierRuleView[]}`, `TierRuleResponse {data: TierRuleView}`)
- `CrawlRun {run_id, trigger ("website_added","schedule","manual","ceiling_retry"), state ("queued","crawling","processing","ready","stopped_at_ceiling","failed","cancelled"), ceiling, pages_found, pages_crawled, sitemap_pages (int or null), render_javascript, estimated_cost_usd (string or null), cost_usd (string or null), stop_reason (or null), error_code (or null: "site_blocked","site_unreachable","provider_error","budget_exceeded","submit_unknown","ingest_failed"), error_message (or null), hints ("render_javascript" when a JavaScript-free crawl found 3 pages or fewer), is_latest, created_at, submitted_at, finished_at, requested_by (UserRef or null)}`
- `PageRow {url_id, url, path, title, status_code, resource_type ("html","redirect","broken","other"), redirect_url, is_indexable, non_indexable_reason, canonical_url, in_sitemap, click_depth, depth_without_auto, equity_share (float 0..1 or null), linking_pages (in scope), linking_pages_all, outlinks (in scope), outlinks_all, linked_from_tiers: [{tier: TierRef or null, pages}] (in scope), outlinks_to_t1 (in scope), broken_outlinks, redirect_outlinks, non_indexable_outlinks, top_anchor, tier: TierRef or null, tier_source ("manual","rule" or null), tier_rule_id, tier_set_by: UserRef or null, tier_set_at, tags: [{term_id, name}], flags: [ "orphan", "editorial_orphan", "deep_only_through_auto", "placement_unknown", "broken", "redirect", "non_indexable" ]}`
- `PageDetail {page: PageRow, linking_by_tier: [{tier, pages}], linking_by_placement: [{placement, pages}], top_anchors: [{anchor, links}] (5), linking_pages: Neighbor[] (25, scope in view), outlinks: Neighbor[] (25), linking_pages_total, outlinks_total}`
- `EdgeRow {link_id, source: EdgePage, target: EdgePage, anchor, kind ("text","image"), placement, scope, rel: string[], is_followed, occurrences}` with `EdgePage {url_id, url, path, tier: TierRef or null, status_code, redirect_url, is_indexable}` (`status_code` null when the target was not crawled)
- `Neighbor {url_id, url, path, title, status_code, redirect_url_id, tier: TierRef or null, click_depth, linking_pages (in scope), linking_pages_all, equity_share, anchor, placement, scope, is_followed, rel, occurrences, links (link rows to this neighbor in scope), has_children, reciprocal}`. For `direction=out` the edge fields describe the link from the focus to the neighbor; for `in`, from the neighbor to the focus. `has_children` is whether the neighbor has links on the same side in the scope. `reciprocal` is whether the reverse link exists in the scope.
- `NeighborMeta {run_id, url_id, direction, scope, total, other_scopes: ScopeCount[] ({scope, pages}, each other edge scope with at least one page), focus: NeighborFocus {url_id, status_code, redirect_url_id}}`. A focus that is a redirect has one child, its target, with `placement` and `scope` null (spec 7.5); a focus not in the crawl answers 404 `not_found`.
- `TierFlow {run_id, scope, stale, cells: [{from_tier, to_tier, links}], tiers: [{tier, pages, equity_share, average_depth}]}` (Untiered is a `null` tier; every tier of the workspace appears in `tiers`, with 0 pages if none)
- `Worklists {run_id, under_linked_t1, orphans, editorial_orphans, deep_only_through_auto, broken_and_redirected, links_to_non_indexable}` (the two link lists count edges of every scope)
- `InternalLinksSettings {schedule ("weekly","every_two_weeks","monthly","off"; default "weekly"), render_javascript (false), allowed_subdomains (string[] up to 10 hosts, default [])}`, inside `ProjectSettings.internal_links`; the patch model `InternalLinksSettingsPatch` takes any of the three.
- `PageFilter` (the bulk bodies' `filter`, always on the latest crawl): `{tier_ids?: (uuid or "none")[], tag_ids?: uuid[], status?: ("2xx".."5xx")[], indexable?: bool, flags?: [...], worklist?, q?}`, the same meaning as the list's query.

## Errors and states (spec section 9)

| Case | Backend behaviour | What the API says |
|---|---|---|
| No website on the project | Crawl now refused; the schedule skips the project | `422 no_website` on `POST link-crawls`; lists answer `404 no_crawl` |
| First crawl running | Run `queued` then `crawling` with `pages_found` and `pages_crawled` updated every minute | `GET link-crawls/{id}` shows the progress; lists `404 no_crawl` until one finishes |
| Crawl failed | `state='failed'`, `error_code`, `error_message` in plain words; the last finished crawl stays `is_latest` | Run fields; `POST link-crawls` again is the retry |
| Stopped at the ceiling | Provider `crawl_stop_reason='limit_exceeded'`: ingested as usual, ends `stopped_at_ceiling` | `stop_reason`, `ceiling`; `POST link-crawls {higher_limit: true}` makes a `ceiling_retry` crawl (D13) |
| Site blocks the crawler | Summary `extended_crawl_status` in (`forbidden_robots`, `forbidden_meta_tag`, `forbidden_http_header`) or a start page 403: `failed` with `site_blocked` | `error_code='site_blocked'`; the web says to allow the crawler's user agent |
| Site unreachable | `site_unreachable`, `invalid_page_status_code` or `too_many_redirects`: `failed` with `site_unreachable` | `error_code='site_unreachable'` |
| Very few pages, script-heavy | `ready` with 3 pages or fewer and JavaScript off | `hints: ["render_javascript"]` |
| Budget exceeded | Crawl now: refused, not queued. Scheduled: `failed` with `budget_exceeded`, nothing posted | `422 budget_exceeded` or the run's `error_code` |
| Post timed out | The task may exist and be charged: `failed` with `submit_unknown`, never posted again blind | `error_code='submit_unknown'` |
| Raw HTML missing for a page | Links from the provider, all `content`; page `links_state='from_provider'` | `flags` has `placement_unknown` |
| Ingest failed for good | After 5 failed passes: `failed` with `ingest_failed`; the earlier crawl stays latest | `error_code='ingest_failed'` |
| Cancel | `queued`: `cancelled` at once. `crawling`: `cancel_requested`, the tick calls `force_stop` and ends it `cancelled` | `CrawlRun.state` |

## Open points for the owner

- **O1. Ceiling and price.** On-Page is billed when posted, by `max_crawl_pages` as far as the docs show (an example task of 10 pages cost $0.00125). The spec's 50,000 default for a site with no sitemap would then cost $7.50 a week whatever the site's size. The plan implements the spec; if the spike confirms billing by the ceiling, the recommendation is max(2,000, 3 x pages crawled last time) for sites with no sitemap, a one-line change in `crawl_ceiling`.
- **O2. JavaScript rendering price.** Ten times the base. The setting is off by default and the settings response states the multiplier; the plan adds no further guard.
- **O3. Our hrefs against the provider's links.** D7 builds edges from our own HTML parse. The spike compares, on the spike sites, our internal edge set with `/on_page/links` per page; a gap over 2% sends the plan back to matching against `/links`.
- **O4. Template thresholds.** Plan 01's constants (`TEMPLATE_SHARE`, `SAME_TARGETS`, `STEADY_COUNT`, `MIN_FOLDER_PAGES`) as the spike's hand check settles them; this plan follows them (D19).
- **O5. Search Console orphans** (D21) wait for slice 2.
- **O6. Raw HTML for every page.** The plan reads it for every 200 HTML page (free, one call each, about 10 minutes for 10,000 pages at the shared call limit). If the spike shows it is slow or limited, the spec's alternative (HTML only for pages the first pass cannot classify) changes Task 11 only.

---

### Task 0: Read the spike results and adjust this plan

**Files:**
- Modify: this plan, only where a result below says so.

- [ ] **Step 1: Read plan 01's report**: `docs/spikes/S-17.md` and the recorded answers plan 01 kept in its raw folder (plan 01 Decision 11).

- [ ] **Step 2: Check each assumption and record the outcome in a short "Spike outcome" list at the top of this plan**

| Assumption | Where it is used | If the spike says otherwise |
|---|---|---|
| A post is billed once, by `max_crawl_pages` (D5, O1) | Task 9 `_post` cost event | Bill per page crawled: write the cost event when the crawl ends (`pages_crawled x price`) instead of at post |
| `max_crawl_pages` stops cleanly with `crawl_stop_reason='limit_exceeded'` | Task 9 `_finish_crawl` | Map the reason the spike saw |
| `store_raw_html` costs nothing and `raw_html` is free with no own limit | Task 7 `raw_html`, Task 11 | Add a `raw_html` family limit in `FAMILY_LIMITS`; consider O6 |
| Field names of `summary`, `pages`, `non_indexable`, `raw_html`, `links` as in Task 7's readers (taken from the public documentation on 2026-11-16) | Task 7 | Change the readers (`_summary`, `_page`, `_link`) and the payloads in `tests/providers/dataforseo/test_on_page.py` to what was recorded; save the recorded answers as `backend/tests/fixtures/dataforseo/on_page/*.json` and parse each in a `gold` test |
| Our classified hrefs match the provider's internal links within 2% (O3) | Task 8, Task 11 | Go back to matching against `/links` |
| Plan 01's classifier names (Names section) | Task 8 | Adapt `idraft.crawl.edges` only |
| Template pass: plan 01's `place_links` is the one pass (D19) | Task 5 | If the gate picks another pass, Task 5 wraps that one instead |

- [ ] **Step 3: Commit the adjusted plan**

```bash
git add docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md
git commit -m "Internal links plan 02: spike outcome"
```

---

### Task 1: Migration 0025, table metadata and the crawl workload

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0025_internal_links.py`
- Modify: `backend/src/idraft/db/tables.py` (nine tables, after `ai_observation_facts`)
- Modify: `backend/src/idraft/domain/workloads.py`
- Modify: `backend/src/idraft/collectors/budget.py` (`check` signature)
- Modify: `backend/src/idraft/api/schemas/budgets.py` (`BudgetGroup` Literal)
- Modify: `backend/tests/db/support.py` (`TENANT_TABLES`, `seed_tenant`, new `seed_internal_links`)
- Modify: `backend/tests/db/test_grants.py` (`MATRIX`, `FUNCTIONS`)
- Modify: `backend/tests/db/test_tables.py` (`DECLARED`)
- Test: `backend/tests/db/test_internal_links_schema.py`, `backend/tests/domain/test_workloads.py` (existing file, one test added)

- [ ] **Step 1: Write the failing schema tests**

`backend/tests/db/test_internal_links_schema.py`:

```python
"""Migration 0025: tiers, tier rules, pages, tags and crawls (plan 02 Task 1)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, scoped, seed_tenant


async def test_every_existing_workspace_has_the_four_default_tiers(
    migrated: PostgresServer,
) -> None:
    # The migration seeded the workspaces that existed; a workspace made after it gets them
    # from the service (Task 3), so this reads one the migration saw: none in a fresh database
    # is fine, and every one that has tiers has exactly these.
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT workspace_id, array_agg(name ORDER BY position) AS names "
            "FROM core.page_tier_levels GROUP BY workspace_id"
        )
    for row in rows:
        assert row["names"][:4] == [
            "Money pages",
            "Supporting pages",
            "Content pages",
            "Utility pages",
        ]


async def test_positions_are_one_to_eight_and_unique_per_workspace(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "tiers")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
                "VALUES ($1, 9, 'Nine')",
                tenant.workspace_id,
            )
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
                "SELECT workspace_id, position, 'Again' FROM core.page_tier_levels "
                "WHERE workspace_id = $1 LIMIT 1",
                tenant.workspace_id,
            )


async def test_positions_close_up_in_one_statement(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "closeup")
    async with connection(migrated) as db:
        await db.execute(
            "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
            "SELECT $1, p, 'Tier ' || p FROM generate_series(2, 4) AS p",
            tenant.workspace_id,
        )
        await db.execute(
            "DELETE FROM core.page_tier_levels WHERE workspace_id = $1 AND position = 2",
            tenant.workspace_id,
        )
        # Deferrable unique key: the shift down passes through no duplicate.
        await db.execute(
            "UPDATE core.page_tier_levels SET position = position - 1 "
            "WHERE workspace_id = $1 AND position > 2",
            tenant.workspace_id,
        )
        positions = await db.fetch(
            "SELECT position FROM core.page_tier_levels WHERE workspace_id = $1 ORDER BY 1",
            tenant.workspace_id,
        )
    assert [row["position"] for row in positions] == [1, 2, 3]


async def test_a_rule_tier_needs_its_rule_and_a_manual_row_names_none(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "sources")
    async with connection(migrated) as db:
        url_id = await db.fetchval(
            "SELECT url_id FROM core.project_pages WHERE project_id = $1", tenant.project_id
        )
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE core.project_pages SET tier_source = 'rule', rule_id = NULL "
                "WHERE project_id = $1 AND url_id = $2",
                tenant.project_id,
                url_id,
            )


async def test_one_crawl_at_a_time_per_project(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "active")
    insert = (
        "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
        "settings, ceiling) VALUES ($1, $2, 'manual', $3, 'example.com', '{}', 2000)"
    )
    async with connection(migrated) as db:
        await db.execute(insert, tenant.workspace_id, tenant.project_id, "queued")
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(insert, tenant.workspace_id, tenant.project_id, "crawling")
        # Finished crawls do not count.
        await db.execute(insert, tenant.workspace_id, tenant.project_id, "failed")


async def test_links_land_in_the_partition_of_their_run(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "parts")
    async with connection(migrated) as db:
        run_id = await db.fetchval(
            "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, "
            "target_host, settings, ceiling) VALUES ($1, $2, 'manual', 'processing', "
            "'example.com', '{}', 2000) RETURNING id",
            tenant.workspace_id,
            tenant.project_id,
        )
        with pytest.raises(asyncpg.PostgresError):
            # No partition yet: the row has nowhere to go.
            await _link(db, tenant.workspace_id, run_id)
    async with scoped(migrated, "app_worker") as db:
        await db.execute("SELECT seo.add_crawl_links_partition($1)", run_id)
        await db.execute("SELECT seo.add_crawl_links_partition($1)", run_id)  # idempotent
        await _link(db, tenant.workspace_id, run_id)
        part = await db.fetchval(
            "SELECT tableoid::regclass::text FROM seo.crawl_links WHERE run_id = $1", run_id
        )
        assert part == f"seo.crawl_links_{run_id.hex}"
        assert await db.fetchval("SELECT seo.drop_crawl_links_partition($1)", run_id)
        assert not await db.fetchval("SELECT seo.drop_crawl_links_partition($1)", run_id)


async def test_partition_functions_refuse_what_is_not_a_run(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_worker") as db:
        with pytest.raises(asyncpg.RaiseError):
            await db.execute("SELECT seo.add_crawl_links_partition($1)", uuid.uuid4())
    async with scoped(migrated, "app_worker") as db:
        assert not await db.fetchval("SELECT seo.drop_crawl_links_partition($1)", uuid.uuid4())


async def test_the_api_cannot_make_or_drop_partitions(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("SELECT seo.add_crawl_links_partition($1)", uuid.uuid4())


async def test_the_crawl_price_is_in_the_price_book(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT unit_price_usd::text AS price, conditions->>'javascript' AS js "
            "FROM ops.provider_price_book WHERE endpoint = 'on_page/task_post' "
            "AND price_unit = 'page' ORDER BY 2"
        )
    assert [(row["js"], row["price"]) for row in rows] == [
        ("false", "0.00015000"),
        ("true", "0.00150000"),
    ]


async def _link(db: asyncpg.Connection[asyncpg.Record], workspace_id: uuid.UUID, run_id: uuid.UUID) -> None:
    await db.execute(
        "INSERT INTO seo.crawl_links (run_id, workspace_id, source_url_id, target_url_id, "
        "kind, placement, scope, is_followed) VALUES ($1, $2, 1, 2, 'text', 'content', "
        "'editorial', true)",
        run_id,
        workspace_id,
    )
```

Add to `backend/tests/domain/test_workloads.py`:

```python
def test_a_site_crawl_is_its_own_budget_group_on_the_seo_side() -> None:
    assert budget_group(CostWorkload.SITE_CRAWL) is BudgetGroup.SITE_CRAWL
    assert cost_workloads(BudgetGroup.SITE_CRAWL) == frozenset({CostWorkload.SITE_CRAWL})
    assert cost_channel(CostWorkload.SITE_CRAWL) is CostChannel.SEO
```

(with `budget_group`, `cost_workloads`, `cost_channel`, `BudgetGroup`, `CostChannel`, `CostWorkload` imported from `idraft.domain.workloads` if the file does not import them yet).

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/db/test_internal_links_schema.py tests/domain/test_workloads.py -q`
Expected: the schema tests fail with `UndefinedTableError: relation "core.page_tier_levels" does not exist`; the workload test with `AttributeError: SITE_CRAWL`.

- [ ] **Step 3: Write the migration**

`backend/src/idraft/db/migrations/versions/0025_internal_links.py`:

```python
"""Internal link tracker, slice 1: page tiers, tier rules, pages and tags per project, and
crawls with their pages, link edges and tier flow.

Plan `docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md`, decisions D2 to
D17:

- Tier levels belong to the workspace (positions 1 to 8, code and colour from the position);
  every existing workspace gets the four defaults here. The position key is deferrable, so
  deleting a tier closes the gap in one UPDATE.
- A page's tier is one `core.project_pages` row per project and URL: `manual` (a null tier is
  a manual Untiered) or `rule` (with its rule). Tags are terms on `core.page_terms`.
- Crawls are `seo.crawl_runs` with the spec's states; one may be under way per project. Pages
  are kept for every crawl; links are partitioned by crawl so that old crawls are dropped
  whole. The worker has no DDL right, so the partitions are made and dropped by two definer
  functions, as `ops.maintain_partitions` makes monthly ones.
- `site_crawl` joins the cost workloads and budget groups, and the On-Page price joins the
  price book.

Revision ID: 0025
Revises: 0024
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from alembic import op
from sqlalchemy import text

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_PLACEMENTS = (
    "('content','auto_generated','navigation','header','footer','sidebar','breadcrumb')"
)
_EDGE_SCOPES = "('editorial','auto_generated','template')"

_TABLES = f"""
CREATE TABLE core.page_tier_levels (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
    name         text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 60),
    description  text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT page_tier_levels_id_workspace_id_key UNIQUE (id, workspace_id),
    CONSTRAINT page_tier_levels_position_key UNIQUE (workspace_id, position)
        DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE core.tier_rules (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    position     integer NOT NULL CHECK (position BETWEEN 1 AND 500),
    match_type   text NOT NULL CHECK (match_type IN ('exact','prefix','pattern')),
    value        text NOT NULL CHECK (left(value, 1) = '/' AND length(value) <= 500),
    tier_id      uuid NOT NULL,
    created_by   uuid REFERENCES auth.users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tier_rules_id_workspace_id_key UNIQUE (id, workspace_id),
    CONSTRAINT tier_rules_position_key UNIQUE (project_id, position)
        DEFERRABLE INITIALLY IMMEDIATE,
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (tier_id, workspace_id) REFERENCES core.page_tier_levels(id, workspace_id)
);

CREATE INDEX tier_rules_tier ON core.tier_rules (tier_id);

CREATE TABLE core.project_pages (
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    workspace_id uuid NOT NULL,
    tier_id      uuid,
    tier_source  text NOT NULL CHECK (tier_source IN ('manual','rule')),
    rule_id      uuid,
    set_by       uuid REFERENCES auth.users(id),
    set_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id),
    CONSTRAINT project_pages_source_fits CHECK (
        (tier_source = 'rule' AND rule_id IS NOT NULL AND tier_id IS NOT NULL)
     OR (tier_source = 'manual' AND rule_id IS NULL)),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (tier_id, workspace_id) REFERENCES core.page_tier_levels(id, workspace_id),
    FOREIGN KEY (rule_id, workspace_id) REFERENCES core.tier_rules(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX project_pages_tier ON core.project_pages (workspace_id, tier_id);

CREATE INDEX project_pages_rule ON core.project_pages (rule_id) WHERE rule_id IS NOT NULL;

CREATE TABLE core.page_terms (
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    term_id      uuid NOT NULL,
    workspace_id uuid NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id, term_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (term_id, workspace_id) REFERENCES core.taxonomy_terms(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX page_terms_term ON core.page_terms (term_id);

CREATE TABLE seo.crawl_runs (
    id                    uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    trigger               text NOT NULL
                          CHECK (trigger IN ('website_added','schedule','manual','ceiling_retry')),
    state                 text NOT NULL DEFAULT 'queued'
                          CHECK (state IN ('queued','crawling','processing','ready',
                                           'stopped_at_ceiling','failed','cancelled')),
    target_host           text NOT NULL CHECK (length(target_host) BETWEEN 1 AND 255),
    settings              jsonb NOT NULL,
    ceiling               integer NOT NULL CHECK (ceiling BETWEEN 1 AND 1000000),
    provider_task_id      text,
    pages_found           integer NOT NULL DEFAULT 0,
    pages_crawled         integer NOT NULL DEFAULT 0,
    sitemap_pages         integer,
    estimated_cost_usd    numeric(14,6),
    cost_usd              numeric(14,6),
    stop_reason           text,
    error_code            text,
    error_message         text CHECK (length(error_message) <= 500),
    cancel_requested      boolean NOT NULL DEFAULT false,
    ingest_phase          text CHECK (ingest_phase IN ('pages','non_indexable','links',
                                                       'template','metrics','done')),
    ingest_token          text,
    ingest_offset         integer NOT NULL DEFAULT 0,
    ingest_failures       smallint NOT NULL DEFAULT 0,
    start_url_id          bigint REFERENCES core.urls(id),
    equity_lost_to_errors double precision,
    equity_p25            double precision,
    links_stored          integer NOT NULL DEFAULT 0,
    links_dropped_at      timestamptz,
    tier_flow_stale       boolean NOT NULL DEFAULT false,
    requested_by          uuid REFERENCES auth.users(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    submitted_at          timestamptz,
    crawled_at            timestamptz,
    finished_at           timestamptz,
    CONSTRAINT crawl_runs_id_workspace_id_key UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

-- One crawl under way per project (spec 6.2, "Crawl now").
CREATE UNIQUE INDEX crawl_runs_one_active ON seo.crawl_runs (project_id)
    WHERE state IN ('queued','crawling','processing');

CREATE INDEX crawl_runs_project_created ON seo.crawl_runs (project_id, created_at DESC, id DESC);

CREATE INDEX crawl_runs_working ON seo.crawl_runs (state, created_at)
    WHERE state IN ('queued','crawling','processing');

CREATE TABLE seo.crawl_pages (
    run_id                   uuid NOT NULL,
    url_id                   bigint NOT NULL REFERENCES core.urls(id),
    workspace_id             uuid NOT NULL,
    project_id               uuid NOT NULL,
    -- The URL as the provider crawled it: raw HTML and links are asked for by this one.
    crawled_url              text NOT NULL CHECK (length(crawled_url) BETWEEN 1 AND 8192),
    status_code              smallint,
    resource_type            text NOT NULL
                             CHECK (resource_type IN ('html','redirect','broken','other')),
    redirect_url_id          bigint REFERENCES core.urls(id),
    is_indexable             boolean NOT NULL DEFAULT true,
    non_indexable_reason     text CHECK (non_indexable_reason IN
                             ('robots_txt','meta_tag','http_header','attribute',
                              'too_many_redirects','canonical')),
    canonical_url_id         bigint REFERENCES core.urls(id),
    title                    text CHECK (length(title) <= 1000),
    in_sitemap               boolean NOT NULL DEFAULT false,
    links_state              text NOT NULL DEFAULT 'waiting'
                             CHECK (links_state IN ('waiting','from_html','from_provider','none')),
    click_depth              integer,
    depth_without_auto       integer,
    equity_share             double precision,
    linking_pages_editorial  integer NOT NULL DEFAULT 0,
    linking_pages_auto       integer NOT NULL DEFAULT 0,
    linking_pages_template   integer NOT NULL DEFAULT 0,
    linking_pages_all        integer NOT NULL DEFAULT 0,
    outlinks_editorial       integer NOT NULL DEFAULT 0,
    outlinks_auto            integer NOT NULL DEFAULT 0,
    outlinks_template        integer NOT NULL DEFAULT 0,
    outlinks_all             integer NOT NULL DEFAULT 0,
    broken_outlinks          integer NOT NULL DEFAULT 0,
    redirect_outlinks        integer NOT NULL DEFAULT 0,
    non_indexable_outlinks   integer NOT NULL DEFAULT 0,
    top_anchor               text,
    is_orphan                boolean NOT NULL DEFAULT false,
    is_editorial_orphan      boolean NOT NULL DEFAULT false,
    deep_only_through_auto   boolean NOT NULL DEFAULT false,
    PRIMARY KEY (run_id, url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX crawl_pages_links_waiting ON seo.crawl_pages (run_id, url_id)
    WHERE links_state = 'waiting';

CREATE INDEX crawl_pages_run_equity ON seo.crawl_pages (run_id, equity_share DESC, url_id);

CREATE TABLE seo.crawl_links (
    run_id             uuid NOT NULL,
    id                 bigint GENERATED ALWAYS AS IDENTITY,
    workspace_id       uuid NOT NULL,
    source_url_id      bigint NOT NULL,
    target_url_id      bigint NOT NULL,
    anchor             text NOT NULL DEFAULT '' CHECK (length(anchor) <= 500),
    kind               text NOT NULL CHECK (kind IN ('text','image')),
    placement          text NOT NULL CHECK (placement IN {_PLACEMENTS}),
    scope              text NOT NULL CHECK (scope IN {_EDGE_SCOPES}),
    rel                text[] NOT NULL DEFAULT '{{}}',
    is_followed        boolean NOT NULL,
    occurrences        smallint NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
    container_hash     bigint,
    template_candidate boolean NOT NULL DEFAULT false,
    PRIMARY KEY (run_id, id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
) PARTITION BY LIST (run_id);

CREATE INDEX crawl_links_run_source ON seo.crawl_links (run_id, source_url_id, scope);

CREATE INDEX crawl_links_run_target ON seo.crawl_links (run_id, target_url_id, scope);

CREATE TABLE seo.crawl_tier_flow (
    run_id       uuid NOT NULL,
    workspace_id uuid NOT NULL,
    scope        text NOT NULL CHECK (scope IN ('editorial','auto_generated','template','all')),
    from_tier_id uuid,
    to_tier_id   uuid,
    links        integer NOT NULL CHECK (links >= 0),
    CONSTRAINT crawl_tier_flow_cell_key UNIQUE NULLS NOT DISTINCT
        (run_id, scope, from_tier_id, to_tier_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.crawl_tier_stats (
    run_id        uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    tier_id       uuid,
    pages         integer NOT NULL CHECK (pages >= 0),
    equity_share  double precision NOT NULL,
    average_depth double precision,
    CONSTRAINT crawl_tier_stats_tier_key UNIQUE NULLS NOT DISTINCT (run_id, tier_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);
"""

# The worker cannot create tables. These two make and drop the partition of one crawl, and
# nothing else: the run must exist, and only a partition of seo.crawl_links is dropped.
_PARTITIONS = """
CREATE FUNCTION seo.add_crawl_links_partition(p_run_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '5s'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM seo.crawl_runs WHERE id = p_run_id) THEN
        RAISE EXCEPTION 'no crawl run %', p_run_id;
    END IF;
    EXECUTE format('CREATE TABLE IF NOT EXISTS seo.%I PARTITION OF seo.crawl_links '
                   'FOR VALUES IN (%L)',
                   'crawl_links_' || replace(p_run_id::text, '-', ''), p_run_id);
END $$;

CREATE FUNCTION seo.drop_crawl_links_partition(p_run_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '5s'
AS $$
DECLARE
    part regclass := to_regclass('seo.crawl_links_' || replace(p_run_id::text, '-', ''));
BEGIN
    IF part IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_inherits
        WHERE inhrelid = part AND inhparent = 'seo.crawl_links'::regclass) THEN
        RETURN false;
    END IF;
    EXECUTE format('DROP TABLE %s', part);
    RETURN true;
END $$;

REVOKE ALL ON FUNCTION seo.add_crawl_links_partition(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION seo.drop_crawl_links_partition(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION seo.add_crawl_links_partition(uuid) TO app_worker;

GRANT EXECUTE ON FUNCTION seo.drop_crawl_links_partition(uuid) TO app_worker;
"""

_OLD_COST_WORKLOADS = (
    "'seo_rank','ai_prompt','ai_mode_keyword','keyword_metrics','discovery',"
    "'ai_benchmark','gsc_sync','bing_sync','ga4_sync','cloudflare_sync',"
    "'ai_overview','extraction_llm','keyword_research','first_party'"
)
_OLD_BUDGET_GROUPS = (
    "'seo_rank','ai_prompt','keyword_research','ai_benchmark','extraction_llm','first_party','all'"
)


def _workload_checks(cost: str, groups: str) -> list[str]:
    return [
        "ALTER TABLE ops.provider_cost_events DROP CONSTRAINT provider_cost_events_workload_check",
        "ALTER TABLE ops.provider_cost_events ADD CONSTRAINT provider_cost_events_workload_check "
        f"CHECK (workload IN ({cost}))",
        "ALTER TABLE ops.budgets DROP CONSTRAINT budgets_workload_check",
        "ALTER TABLE ops.budgets ADD CONSTRAINT budgets_workload_check "
        f"CHECK (workload IN ({groups}))",
    ]


_TENANT_TABLES = (
    "core.page_tier_levels",
    "core.tier_rules",
    "core.project_pages",
    "core.page_terms",
    "seo.crawl_runs",
    "seo.crawl_pages",
    "seo.crawl_links",
    "seo.crawl_tier_flow",
    "seo.crawl_tier_stats",
)
_RUN_API_UPDATE = ("state", "cancel_requested", "error_code", "finished_at", "tier_flow_stale")
_RUN_WORKER_UPDATE = (
    "state",
    "provider_task_id",
    "pages_found",
    "pages_crawled",
    "sitemap_pages",
    "estimated_cost_usd",
    "cost_usd",
    "stop_reason",
    "error_code",
    "error_message",
    "ingest_phase",
    "ingest_token",
    "ingest_offset",
    "ingest_failures",
    "start_url_id",
    "equity_lost_to_errors",
    "equity_p25",
    "links_stored",
    "links_dropped_at",
    "tier_flow_stale",
    "submitted_at",
    "crawled_at",
    "finished_at",
)
_PAGE_WORKER_UPDATE = (
    "is_indexable",
    "non_indexable_reason",
    "links_state",
    "click_depth",
    "depth_without_auto",
    "equity_share",
    "linking_pages_editorial",
    "linking_pages_auto",
    "linking_pages_template",
    "linking_pages_all",
    "outlinks_editorial",
    "outlinks_auto",
    "outlinks_template",
    "outlinks_all",
    "broken_outlinks",
    "redirect_outlinks",
    "non_indexable_outlinks",
    "top_anchor",
    "is_orphan",
    "is_editorial_orphan",
    "deep_only_through_auto",
)
_DEFAULT_TIERS = (
    (1, "Money pages", "Pages that bring revenue: products, services, pricing."),
    (2, "Supporting pages", "Pages that lead to the money pages: categories, comparisons."),
    (3, "Content pages", "Articles and guides that earn visits and links."),
    (4, "Utility pages", "About, contact, legal and account pages."),
)
# Spec 6.1, verified on the pricing page on 2026-11-16: per page crawled, ten times with
# JavaScript rendering.
_CRAWL_PRICES = (
    (Decimal("0.00015"), '{"javascript": false}'),
    (Decimal("0.0015"), '{"javascript": true}'),
)


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("core.page_tier_levels", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "core.page_tier_levels",
            role="app_api",
            privilege="UPDATE",
            columns=("position", "name", "description", "updated_at"),
        ),
        *grants("core.tier_rules", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "core.tier_rules",
            role="app_api",
            privilege="UPDATE",
            columns=("position", "match_type", "value", "tier_id"),
        ),
        *grants(
            "core.project_pages",
            api="SELECT, INSERT, DELETE",
            worker="SELECT, INSERT, DELETE",
        ),
        column_grant(
            "core.project_pages",
            role="app_api",
            privilege="UPDATE",
            columns=("tier_id", "tier_source", "rule_id", "set_by", "set_at"),
        ),
        column_grant(
            "core.project_pages",
            role="app_worker",
            privilege="UPDATE",
            columns=("tier_id", "tier_source", "rule_id", "set_at"),
        ),
        *grants("core.page_terms", api="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_runs", api="SELECT, INSERT", worker="SELECT, INSERT"),
        column_grant("seo.crawl_runs", role="app_api", privilege="UPDATE", columns=_RUN_API_UPDATE),
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=_RUN_WORKER_UPDATE
        ),
        *grants("seo.crawl_pages", api="SELECT", worker="SELECT, INSERT"),
        column_grant(
            "seo.crawl_pages", role="app_worker", privilege="UPDATE", columns=_PAGE_WORKER_UPDATE
        ),
        *grants("seo.crawl_links", api="SELECT", worker="SELECT, INSERT, DELETE"),
        column_grant(
            "seo.crawl_links", role="app_worker", privilege="UPDATE", columns=("placement", "scope")
        ),
        *grants(
            "seo.crawl_tier_flow", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"
        ),
        *grants(
            "seo.crawl_tier_stats", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"
        ),
        *_workload_checks(f"{_OLD_COST_WORKLOADS},'site_crawl'", f"{_OLD_BUDGET_GROUPS},'site_crawl'"),
    ]
    for statement in script:
        op.execute(statement)
    for statement in statements(_PARTITIONS):
        op.execute(statement)
    bind = op.get_bind()
    for position, name, description in _DEFAULT_TIERS:
        bind.execute(
            text(
                "INSERT INTO core.page_tier_levels (workspace_id, position, name, description) "
                "SELECT id, :position, :name, :description FROM auth.workspaces"
            ),
            {"position": position, "name": name, "description": description},
        )
    for price, conditions in _CRAWL_PRICES:
        bind.execute(
            text(
                "INSERT INTO ops.provider_price_book (provider_code, endpoint, price_unit, "
                "unit_price_usd, conditions, valid_from, source_url, verified_at) VALUES "
                "('dataforseo', 'on_page/task_post', 'page', :price, CAST(:conditions AS jsonb), "
                ":valid_from, 'https://dataforseo.com/pricing/on-page/onpage-api', :verified)"
            ),
            {
                "price": price,
                "conditions": conditions,
                "valid_from": date(2026, 11, 16),
                "verified": date(2026, 11, 16),
            },
        )


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DELETE FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
        "AND endpoint = 'on_page/task_post'"
    )
    op.execute("DELETE FROM ops.provider_cost_events WHERE workload = 'site_crawl'")
    op.execute("DELETE FROM ops.budgets WHERE workload = 'site_crawl'")
    for statement in _workload_checks(_OLD_COST_WORKLOADS, _OLD_BUDGET_GROUPS):
        op.execute(statement)
    op.execute("DROP FUNCTION seo.drop_crawl_links_partition(uuid)")
    op.execute("DROP FUNCTION seo.add_crawl_links_partition(uuid)")
    op.execute(
        "DROP TABLE seo.crawl_tier_stats, seo.crawl_tier_flow, seo.crawl_links, "
        "seo.crawl_pages, seo.crawl_runs, core.page_terms, core.project_pages, "
        "core.tier_rules, core.page_tier_levels"
    )
```

The `_TABLES` f-string doubles the braces of `'{}'` (written `'{{}}'`); `statements` splits at blank lines, so no statement above holds one.

- [ ] **Step 4: Declare the tables**

Append to `backend/src/idraft/db/tables.py`, after `ai_observation_facts` (`Float` joins the `sqlalchemy` import list):

```python
page_tier_levels = Table(
    "page_tier_levels",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    Column("position", SmallInteger, nullable=False),
    Column("name", Text, nullable=False),
    Column("description", Text, nullable=False, server_default=FetchedValue()),
    _created_at(),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    UniqueConstraint("id", "workspace_id", name="page_tier_levels_id_workspace_id_key"),
    UniqueConstraint("workspace_id", "position", name="page_tier_levels_position_key"),
    schema="core",
)

tier_rules = Table(
    "tier_rules",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("position", Integer, nullable=False),
    Column("match_type", Text, nullable=False),
    Column("value", Text, nullable=False),
    Column("tier_id", Uuid, nullable=False),
    Column("created_by", Uuid, ForeignKey(users.c.id)),
    _created_at(),
    UniqueConstraint("id", "workspace_id", name="tier_rules_id_workspace_id_key"),
    UniqueConstraint("project_id", "position", name="tier_rules_position_key"),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"], [projects.c.id, projects.c.workspace_id], ondelete="CASCADE"
    ),
    ForeignKeyConstraint(
        ["tier_id", "workspace_id"], [page_tier_levels.c.id, page_tier_levels.c.workspace_id]
    ),
    schema="core",
)

project_pages = Table(
    "project_pages",
    metadata,
    Column("project_id", Uuid, primary_key=True),
    Column("url_id", BigInteger, ForeignKey(urls.c.id), primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("tier_id", Uuid),
    Column("tier_source", Text, nullable=False),
    Column("rule_id", Uuid),
    Column("set_by", Uuid, ForeignKey(users.c.id)),
    Column("set_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"], [projects.c.id, projects.c.workspace_id], ondelete="CASCADE"
    ),
    ForeignKeyConstraint(
        ["tier_id", "workspace_id"], [page_tier_levels.c.id, page_tier_levels.c.workspace_id]
    ),
    ForeignKeyConstraint(
        ["rule_id", "workspace_id"],
        [tier_rules.c.id, tier_rules.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="core",
)

page_terms = Table(
    "page_terms",
    metadata,
    Column("project_id", Uuid, primary_key=True),
    Column("url_id", BigInteger, ForeignKey(urls.c.id), primary_key=True),
    Column("term_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    _created_at(),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"], [projects.c.id, projects.c.workspace_id], ondelete="CASCADE"
    ),
    ForeignKeyConstraint(
        ["term_id", "workspace_id"],
        [taxonomy_terms.c.id, taxonomy_terms.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="core",
)

crawl_runs = Table(
    "crawl_runs",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("trigger", Text, nullable=False),
    Column("state", Text, nullable=False, server_default=FetchedValue()),
    Column("target_host", Text, nullable=False),
    Column("settings", JSONB, nullable=False),
    Column("ceiling", Integer, nullable=False),
    Column("provider_task_id", Text),
    Column("pages_found", Integer, nullable=False, server_default=FetchedValue()),
    Column("pages_crawled", Integer, nullable=False, server_default=FetchedValue()),
    Column("sitemap_pages", Integer),
    Column("estimated_cost_usd", Numeric(14, 6)),
    Column("cost_usd", Numeric(14, 6)),
    Column("stop_reason", Text),
    Column("error_code", Text),
    Column("error_message", Text),
    Column("cancel_requested", Boolean, nullable=False, server_default=FetchedValue()),
    Column("ingest_phase", Text),
    Column("ingest_token", Text),
    Column("ingest_offset", Integer, nullable=False, server_default=FetchedValue()),
    Column("ingest_failures", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("start_url_id", BigInteger, ForeignKey(urls.c.id)),
    Column("equity_lost_to_errors", Float),
    Column("equity_p25", Float),
    Column("links_stored", Integer, nullable=False, server_default=FetchedValue()),
    Column("links_dropped_at", DateTime(timezone=True)),
    Column("tier_flow_stale", Boolean, nullable=False, server_default=FetchedValue()),
    Column("requested_by", Uuid, ForeignKey(users.c.id)),
    _created_at(),
    Column("submitted_at", DateTime(timezone=True)),
    Column("crawled_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    UniqueConstraint("id", "workspace_id", name="crawl_runs_id_workspace_id_key"),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"], [projects.c.id, projects.c.workspace_id], ondelete="CASCADE"
    ),
    schema="seo",
)


def _run_key() -> ForeignKeyConstraint:
    """The crawl a row belongs to, in the row's own workspace."""
    return ForeignKeyConstraint(
        ["run_id", "workspace_id"], [crawl_runs.c.id, crawl_runs.c.workspace_id], ondelete="CASCADE"
    )


crawl_pages = Table(
    "crawl_pages",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("url_id", BigInteger, ForeignKey(urls.c.id), primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("crawled_url", Text, nullable=False),
    Column("status_code", SmallInteger),
    Column("resource_type", Text, nullable=False),
    Column("redirect_url_id", BigInteger, ForeignKey(urls.c.id)),
    Column("is_indexable", Boolean, nullable=False, server_default=FetchedValue()),
    Column("non_indexable_reason", Text),
    Column("canonical_url_id", BigInteger, ForeignKey(urls.c.id)),
    Column("title", Text),
    Column("in_sitemap", Boolean, nullable=False, server_default=FetchedValue()),
    Column("links_state", Text, nullable=False, server_default=FetchedValue()),
    Column("click_depth", Integer),
    Column("depth_without_auto", Integer),
    Column("equity_share", Float),
    *(
        Column(name, Integer, nullable=False, server_default=FetchedValue())
        for name in (
            "linking_pages_editorial",
            "linking_pages_auto",
            "linking_pages_template",
            "linking_pages_all",
            "outlinks_editorial",
            "outlinks_auto",
            "outlinks_template",
            "outlinks_all",
            "broken_outlinks",
            "redirect_outlinks",
            "non_indexable_outlinks",
        )
    ),
    Column("top_anchor", Text),
    Column("is_orphan", Boolean, nullable=False, server_default=FetchedValue()),
    Column("is_editorial_orphan", Boolean, nullable=False, server_default=FetchedValue()),
    Column("deep_only_through_auto", Boolean, nullable=False, server_default=FetchedValue()),
    _run_key(),
    schema="seo",
)

crawl_links = Table(
    "crawl_links",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("workspace_id", Uuid, nullable=False),
    Column("source_url_id", BigInteger, nullable=False),
    Column("target_url_id", BigInteger, nullable=False),
    Column("anchor", Text, nullable=False, server_default=FetchedValue()),
    Column("kind", Text, nullable=False),
    Column("placement", Text, nullable=False),
    Column("scope", Text, nullable=False),
    Column("rel", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    Column("is_followed", Boolean, nullable=False),
    Column("occurrences", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("container_hash", BigInteger),
    Column("template_candidate", Boolean, nullable=False, server_default=FetchedValue()),
    _run_key(),
    schema="seo",
)

crawl_tier_flow = Table(
    "crawl_tier_flow",
    metadata,
    Column("run_id", Uuid, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("scope", Text, nullable=False),
    Column("from_tier_id", Uuid),
    Column("to_tier_id", Uuid),
    Column("links", Integer, nullable=False),
    UniqueConstraint(
        "run_id", "scope", "from_tier_id", "to_tier_id", name="crawl_tier_flow_cell_key"
    ),
    _run_key(),
    schema="seo",
)

crawl_tier_stats = Table(
    "crawl_tier_stats",
    metadata,
    Column("run_id", Uuid, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("tier_id", Uuid),
    Column("pages", Integer, nullable=False),
    Column("equity_share", Float, nullable=False),
    Column("average_depth", Float),
    UniqueConstraint("run_id", "tier_id", name="crawl_tier_stats_tier_key"),
    _run_key(),
    schema="seo",
)
```

Add the nine qualified names to `DECLARED` in `backend/tests/db/test_tables.py`. If `test_tables.py` reports that `NULLS NOT DISTINCT` or a deferrable key reads differently from the metadata, match the metadata to what it prints (the comparison is the contract, as for `ai.*`).

- [ ] **Step 5: The workloads, the budget check and the budget groups**

`backend/src/idraft/domain/workloads.py`: add `SITE_CRAWL = "site_crawl"` at the end of `CostWorkload` under a comment `# A site crawl (On-Page): one post per crawl, no task of the ledger.`, `SITE_CRAWL = "site_crawl"` to `BudgetGroup` before `ALL`, `CostWorkload.SITE_CRAWL: BudgetGroup.SITE_CRAWL,` to `_GROUP_OF`, and `BudgetGroup.SITE_CRAWL: CostChannel.SEO,` to `_CHANNEL_OF`.

`backend/src/idraft/collectors/budget.py`: the signature of `check` becomes

```python
async def check(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    workload: TaskWorkload | CostWorkload,
    now: datetime,
    estimate: Decimal | None = None,
    memo: SpendMemo | None = None,
) -> BudgetVerdict:
```

and its import line becomes `from idraft.domain.workloads import BudgetGroup, CostWorkload, TaskWorkload, budget_group, cost_workloads`. The body is unchanged: `budget_group` takes either.

`backend/src/idraft/api/schemas/budgets.py`: add `"site_crawl",` to the `BudgetGroup` Literal before `"all"`.

- [ ] **Step 6: Seed one row per new tenant table and add the grants**

`backend/tests/db/support.py`: add to `TENANT_TABLES`

```python
    "core.page_tier_levels": "workspace_id",
    "core.tier_rules": "workspace_id",
    "core.project_pages": "workspace_id",
    "core.page_terms": "workspace_id",
    "seo.crawl_runs": "workspace_id",
    "seo.crawl_pages": "workspace_id",
    "seo.crawl_links": "workspace_id",
    "seo.crawl_tier_flow": "workspace_id",
    "seo.crawl_tier_stats": "workspace_id",
```

call `await seed_internal_links(db, workspace_id, project_id, owner_id, term_id)` at the end of `seed_tenant`, and add:

```python
async def seed_internal_links(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    term_id: uuid.UUID,
) -> uuid.UUID:
    """One row in every internal links table: a tier, a rule, a page with a manual tier and a
    tag, and a finished crawl with its page, one link, its tier flow and stats. Returns the
    crawl's id."""
    tier_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
        "VALUES ($1, 1, 'Money pages') RETURNING id",
        workspace_id,
    )
    rule_id = await db.fetchval(
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id, created_by) VALUES ($1, $2, 1, 'prefix', '/services/', $3, $4) RETURNING id",
        workspace_id,
        project_id,
        tier_id,
        owner_id,
    )
    url_id: int = await db.fetchval(
        "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version) "
        "SELECT sha256(convert_to($1, 'UTF8')), 'https://' || $1, d.id, '/services/a', 1 "
        "FROM core.domains d ORDER BY d.id LIMIT 1 RETURNING id",
        f"seed-{uuid.uuid4().hex}.example/services/a",
    )
    await db.execute(
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
        "tier_source, rule_id) VALUES ($1, $2, $3, $4, 'rule', $5)",
        project_id,
        url_id,
        workspace_id,
        tier_id,
        rule_id,
    )
    await db.execute(
        "INSERT INTO core.page_terms (project_id, url_id, term_id, workspace_id) "
        "VALUES ($1, $2, $3, $4)",
        project_id,
        url_id,
        term_id,
        workspace_id,
    )
    run_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
        "settings, ceiling, finished_at) VALUES ($1, $2, 'manual', 'ready', 'example.com', "
        "'{}', 2000, now()) RETURNING id",
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO seo.crawl_pages (run_id, url_id, workspace_id, project_id, crawled_url, "
        "status_code, resource_type) VALUES ($1, $2, $3, $4, 'https://example.com/services/a', "
        "200, 'html')",
        run_id,
        url_id,
        workspace_id,
        project_id,
    )
    await db.execute("SELECT seo.add_crawl_links_partition($1)", run_id)
    await db.execute(
        "INSERT INTO seo.crawl_links (run_id, workspace_id, source_url_id, target_url_id, kind, "
        "placement, scope, is_followed) VALUES ($1, $2, $3, $3, 'text', 'content', 'editorial', "
        "true)",
        run_id,
        workspace_id,
        url_id,
    )
    await db.execute(
        "INSERT INTO seo.crawl_tier_flow (run_id, workspace_id, scope, from_tier_id, to_tier_id, "
        "links) VALUES ($1, $2, 'editorial', $3, $3, 1)",
        run_id,
        workspace_id,
        tier_id,
    )
    await db.execute(
        "INSERT INTO seo.crawl_tier_stats (run_id, workspace_id, tier_id, pages, equity_share) "
        "VALUES ($1, $2, $3, 1, 1.0)",
        run_id,
        workspace_id,
        tier_id,
    )
    return run_id
```

The seed's URL uses the first domain row, which `seed_keywords` has already written in `seed_tenant`.

`backend/tests/db/test_grants.py`, add to `MATRIX`:

```python
    "core.page_tier_levels": (
        access("SELECT, INSERT, DELETE", UPDATE=("position", "name", "description", "updated_at")),
        READ,
    ),
    "core.tier_rules": (
        access("SELECT, INSERT, DELETE", UPDATE=("position", "match_type", "value", "tier_id")),
        READ,
    ),
    "core.project_pages": (
        access(
            "SELECT, INSERT, DELETE",
            UPDATE=("tier_id", "tier_source", "rule_id", "set_by", "set_at"),
        ),
        access("SELECT, INSERT, DELETE", UPDATE=("tier_id", "tier_source", "rule_id", "set_at")),
    ),
    "core.page_terms": (access("SELECT, INSERT, DELETE"), NONE),
    "seo.crawl_runs": (
        access(
            "SELECT, INSERT",
            UPDATE=("state", "cancel_requested", "error_code", "finished_at", "tier_flow_stale"),
        ),
        access("SELECT, INSERT", UPDATE=RUN_WORKER_UPDATE),
    ),
    "seo.crawl_pages": (READ, access("SELECT, INSERT", UPDATE=PAGE_WORKER_UPDATE)),
    "seo.crawl_links": (READ, access("SELECT, INSERT, DELETE", UPDATE=("placement", "scope"))),
    "seo.crawl_tier_flow": (access("SELECT, INSERT, DELETE"), access("SELECT, INSERT, DELETE")),
    "seo.crawl_tier_stats": (access("SELECT, INSERT, DELETE"), access("SELECT, INSERT, DELETE")),
```

with `RUN_WORKER_UPDATE` and `PAGE_WORKER_UPDATE` defined above `MATRIX` as tuples holding exactly the names of `_RUN_WORKER_UPDATE` and `_PAGE_WORKER_UPDATE` of the migration (copied, not imported: the test states the contract). Add to `FUNCTIONS`:

```python
    # A crawl's link partition (migration 0025).
    "seo.add_crawl_links_partition(uuid)": frozenset({"app_worker"}),
    "seo.drop_crawl_links_partition(uuid)": frozenset({"app_worker"}),
```

- [ ] **Step 7: Run the schema suite**

Run: `uv run pytest --no-cov tests/db tests/domain/test_workloads.py -q`
Expected: all pass, among them `test_internal_links_schema.py` (9 tests), `test_rls.py`, `test_grants.py`, `test_tables.py`, `test_domain_values.py` and `test_migrations.py` (which runs the downgrade and upgrade again).

- [ ] **Step 8: Gate and commit**

Run the gate. Then:

```bash
git add backend/src/idraft/db/migrations/versions/0025_internal_links.py backend/src/idraft/db/tables.py \
  backend/src/idraft/domain/workloads.py backend/src/idraft/collectors/budget.py \
  backend/src/idraft/api/schemas/budgets.py backend/tests/db/support.py backend/tests/db/test_grants.py \
  backend/tests/db/test_tables.py backend/tests/db/test_internal_links_schema.py \
  backend/tests/domain/test_workloads.py
git commit -m "Internal links: migration 0025 with tiers, rules, pages, tags and crawls"
```

The budget schema change alters `backend/openapi/v1.json` (the `BudgetGroup` enum): regenerate it in this commit with `uv run python -m idraft.api.openapi > openapi/v1.json` and add `backend/openapi/v1.json` to the `git add` line.

---

### Task 2: The `idraft.crawl` package: scopes, tier rules, ceiling and schedule

**Files:**
- Create: `backend/src/idraft/crawl/__init__.py`, `scopes.py`, `tiers.py`, `ceiling.py`, `schedule.py`
- Modify: `backend/pyproject.toml` (a contract for `idraft.crawl`; `idraft.crawl` joins the dev seed contract's `source_modules`)
- Test: `backend/tests/crawl/__init__.py`, `test_scopes.py`, `test_tiers.py`, `test_ceiling.py`, `test_schedule.py`

If plan 01 has already created `backend/src/idraft/crawl/__init__.py` and the contract, keep theirs and add only what is missing.

- [ ] **Step 1: Write the failing tests**

`backend/tests/crawl/__init__.py`: an empty file.

`backend/tests/crawl/test_scopes.py`:

```python
"""Placements and the link scopes the screens filter by (spec section 4)."""

import pytest

from idraft.crawl.scopes import EDGE_SCOPES, PLACEMENTS, LinkScope, in_scope, scope_of


@pytest.mark.parametrize(
    ("placement", "scope"),
    [
        ("content", LinkScope.EDITORIAL),
        ("auto_generated", LinkScope.AUTO_GENERATED),
        ("navigation", LinkScope.TEMPLATE),
        ("header", LinkScope.TEMPLATE),
        ("footer", LinkScope.TEMPLATE),
        ("sidebar", LinkScope.TEMPLATE),
        ("breadcrumb", LinkScope.TEMPLATE),
    ],
)
def test_every_placement_has_one_scope(placement: str, scope: LinkScope) -> None:
    assert scope_of(placement) is scope


def test_the_placements_are_the_seven_of_the_spec() -> None:
    assert len(PLACEMENTS) == 7
    assert {scope_of(placement) for placement in PLACEMENTS} == set(EDGE_SCOPES)


def test_an_unknown_placement_is_refused() -> None:
    with pytest.raises(ValueError, match="placement"):
        scope_of("menu")


def test_all_takes_every_scope_and_the_others_only_themselves() -> None:
    for edge in EDGE_SCOPES:
        assert in_scope(edge, LinkScope.ALL)
        assert in_scope(edge, edge)
    assert not in_scope(LinkScope.TEMPLATE, LinkScope.EDITORIAL)
```

`backend/tests/crawl/test_tiers.py`:

```python
"""Tier codes and tier rules: exact, prefix, pattern; the first match wins (spec 5.2)."""

import uuid

import pytest

from idraft.crawl.tiers import (
    DEFAULT_TIERS,
    MAX_TIERS,
    MatchType,
    TierRule,
    check_rule_value,
    first_match,
    rule_matches,
    tier_code,
)

T1, T2 = uuid.uuid4(), uuid.uuid4()


def _rule(position: int, match_type: MatchType, value: str, tier: uuid.UUID = T1) -> TierRule:
    return TierRule(
        rule_id=uuid.uuid4(), position=position, match_type=match_type, value=value, tier_id=tier
    )


def test_codes_come_from_positions() -> None:
    assert [tier_code(position) for position in range(1, MAX_TIERS + 1)] == [
        f"T{n}" for n in range(1, 9)
    ]
    with pytest.raises(ValueError, match="position"):
        tier_code(9)


def test_the_defaults_are_four_named_tiers() -> None:
    assert [name for name, _ in DEFAULT_TIERS] == [
        "Money pages",
        "Supporting pages",
        "Content pages",
        "Utility pages",
    ]


@pytest.mark.parametrize(
    ("match_type", "value", "path", "matches"),
    [
        (MatchType.EXACT, "/pricing", "/pricing", True),
        (MatchType.EXACT, "/pricing", "/pricing/", True),
        (MatchType.EXACT, "/pricing/", "/pricing", True),
        (MatchType.EXACT, "/", "/", True),
        (MatchType.EXACT, "/pricing", "/pricing/team", False),
        (MatchType.PREFIX, "/services/", "/services/seo", True),
        (MatchType.PREFIX, "/services/", "/services", False),
        (MatchType.PREFIX, "/blog", "/blogger", True),
        (MatchType.PATTERN, "/blog/*/comments", "/blog/2026/11/comments", True),
        (MatchType.PATTERN, "/blog/*", "/blog", False),
        (MatchType.PATTERN, "/*.pdf", "/files/guide.pdf", True),
        (MatchType.PATTERN, "/a.b", "/axb", False),
        (MatchType.PATTERN, "/a+b", "/a+b", True),
    ],
)
def test_rules_match_paths(match_type: MatchType, value: str, path: str, matches: bool) -> None:
    assert rule_matches(_rule(1, match_type, value), path) is matches


def test_the_first_rule_by_position_wins_whatever_the_list_order() -> None:
    late = _rule(2, MatchType.PREFIX, "/", T2)
    early = _rule(1, MatchType.PREFIX, "/services/", T1)
    assert first_match([late, early], "/services/seo") == early
    assert first_match([late, early], "/about") == late
    assert first_match([early], "/about") is None


@pytest.mark.parametrize(
    ("match_type", "value", "problem"),
    [
        (MatchType.EXACT, "pricing", "starts_with_slash"),
        (MatchType.PREFIX, "/" + "x" * 500, "too_long"),
        (MatchType.EXACT, "/a*b", "star_in_exact"),
        (MatchType.PATTERN, "/" + "*/" * 11, "too_many_stars"),
        (MatchType.PATTERN, "/blog/*", None),
    ],
)
def test_rule_values_are_checked(match_type: MatchType, value: str, problem: str | None) -> None:
    assert check_rule_value(match_type, value) == problem
```

`backend/tests/crawl/test_ceiling.py`:

```python
"""The crawl-trap safety stop (spec 6.2; plan decision D13)."""

import pytest

from idraft.crawl.ceiling import FLOOR, NO_SITEMAP, RETRY_MAX, crawl_ceiling, retry_ceiling


@pytest.mark.parametrize(
    ("sitemap_pages", "ceiling"),
    [(None, FLOOR), (0, NO_SITEMAP), (1, FLOOR), (666, FLOOR), (667, 2001), (2000, 6000)],
)
def test_three_times_the_sitemap_and_never_under_the_floor(
    sitemap_pages: int | None, ceiling: int
) -> None:
    assert crawl_ceiling(sitemap_pages) == ceiling


def test_a_retry_doubles_or_follows_the_sitemap_whichever_is_higher() -> None:
    assert retry_ceiling(2000, None) == 4000
    assert retry_ceiling(2000, 5000) == 15000
    assert retry_ceiling(150_000, 1) == RETRY_MAX


def test_a_negative_count_is_a_bug() -> None:
    with pytest.raises(ValueError, match="sitemap"):
        crawl_ceiling(-1)
```

`backend/tests/crawl/test_schedule.py`:

```python
"""When a scheduled crawl is due (plan decision D4)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from idraft.crawl.schedule import (
    NIGHT_HOURS,
    SLOT_LENGTH,
    CrawlSchedule,
    crawl_due,
    slot_offset,
)

PROJECT = uuid.UUID("00000000-0000-0000-0000-000000000000")  # slot at 01:00 sharp
LONDON = "Europe/London"


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    # November: London is on UTC.
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def test_the_slot_is_inside_the_night_and_stable_per_project() -> None:
    other = uuid.uuid4()
    assert slot_offset(PROJECT) == timedelta(0)
    assert slot_offset(other) == slot_offset(other)
    assert timedelta(0) <= slot_offset(other) <= timedelta(hours=NIGHT_HOURS) - SLOT_LENGTH


def _first_crawl_due(now: datetime) -> bool:
    return crawl_due(
        schedule=CrawlSchedule.WEEKLY,
        last_started=None,
        timezone=LONDON,
        project_id=PROJECT,
        now=now,
    )


def test_a_project_with_no_crawl_is_due_in_its_next_slot_only() -> None:
    assert _first_crawl_due(_at(17, 1, 10))
    assert not _first_crawl_due(_at(17, 0, 59))
    assert not _first_crawl_due(_at(17, 2, 0))


@pytest.mark.parametrize(
    ("schedule", "days_since", "due"),
    [
        (CrawlSchedule.WEEKLY, 7, True),
        (CrawlSchedule.WEEKLY, 6, True),  # a day of slack keeps the same night each week
        (CrawlSchedule.WEEKLY, 5, False),
        (CrawlSchedule.EVERY_TWO_WEEKS, 13, True),
        (CrawlSchedule.EVERY_TWO_WEEKS, 12, False),
        (CrawlSchedule.MONTHLY, 27, True),
        (CrawlSchedule.MONTHLY, 26, False),
        (CrawlSchedule.OFF, 400, False),
    ],
)
def test_the_interval_since_the_last_crawl(
    schedule: CrawlSchedule, days_since: int, due: bool
) -> None:
    now = _at(30, 1, 5)
    assert (
        crawl_due(
            schedule=schedule,
            last_started=now - timedelta(days=days_since, minutes=5),
            timezone=LONDON,
            project_id=PROJECT,
            now=now,
        )
        is due
    )


def test_the_slot_is_read_in_the_project_time_zone() -> None:
    # 01:05 in New York is 06:05 UTC in November.
    now = datetime(2026, 11, 17, 6, 5, tzinfo=UTC)
    assert crawl_due(
        schedule=CrawlSchedule.WEEKLY,
        last_started=None,
        timezone="America/New_York",
        project_id=PROJECT,
        now=now,
    )


def test_a_naive_time_is_refused() -> None:
    with pytest.raises(ValueError, match="aware"):
        crawl_due(
            schedule=CrawlSchedule.WEEKLY,
            last_started=None,
            timezone=LONDON,
            project_id=PROJECT,
            now=datetime(2026, 11, 17, 1, 5),
        )
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/crawl -q`
Expected: collection errors, `ModuleNotFoundError: No module named 'idraft.crawl'` (or `idraft.crawl.scopes` when plan 01 has made the package).

- [ ] **Step 3: Write the modules**

`backend/src/idraft/crawl/__init__.py`:

```python
"""The internal link tracker's pure rules (plan 02): link scopes, tiers, the crawl ceiling and
schedule, depth and equity, the template pass and the edges of one page. Plan 01 adds the
placement classifier (`idraft.crawl.placement`). No database, no network."""
```

`backend/src/idraft/crawl/scopes.py`:

```python
"""Where a link sits (its placement) and the three scopes the screens filter by (spec section
4). `all` is a view of the three, never a scope a link has."""

from __future__ import annotations

from enum import StrEnum
from typing import Final


class LinkScope(StrEnum):
    EDITORIAL = "editorial"
    AUTO_GENERATED = "auto_generated"
    TEMPLATE = "template"
    ALL = "all"


EDGE_SCOPES: Final = (LinkScope.EDITORIAL, LinkScope.AUTO_GENERATED, LinkScope.TEMPLATE)
# `seo.crawl_links.placement` lists the same values (migration 0025); plan 01's `Placement`
# enum holds them too (tests/crawl/test_edges.py keeps the three equal).
PLACEMENTS: Final = (
    "content",
    "auto_generated",
    "navigation",
    "header",
    "footer",
    "sidebar",
    "breadcrumb",
)


def scope_of(placement: str) -> LinkScope:
    if placement == "content":
        return LinkScope.EDITORIAL
    if placement == "auto_generated":
        return LinkScope.AUTO_GENERATED
    if placement in PLACEMENTS:
        return LinkScope.TEMPLATE
    raise ValueError(f"not a placement: {placement!r}")


def in_scope(edge_scope: LinkScope, view: LinkScope) -> bool:
    """Whether a link of `edge_scope` shows when `view` is the scope in view."""
    return view is LinkScope.ALL or edge_scope is view
```

`backend/src/idraft/crawl/tiers.py`:

```python
"""Tier codes and tier rules (spec 5.1 and 5.2).

A tier's code is its position: T1 is the most important. A rule names one tier and matches a
page's path (`core.urls.path`, which has no query): `exact` (a trailing slash does not count),
`prefix` (the path starts with the value) or `pattern` (`*` stands for any run of characters,
slashes included; everything else is literal). Rules are tried by position and the first that
matches wins; a manual tier beats every rule, which the caller decides before asking.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from typing import Final
from uuid import UUID

MAX_TIERS: Final = 8
VALUE_MAX: Final = 500
STARS_MAX: Final = 10
# Name and one-line description of T1 to T4 (migration 0025 seeds the same).
DEFAULT_TIERS: Final = (
    ("Money pages", "Pages that bring revenue: products, services, pricing."),
    ("Supporting pages", "Pages that lead to the money pages: categories, comparisons."),
    ("Content pages", "Articles and guides that earn visits and links."),
    ("Utility pages", "About, contact, legal and account pages."),
)


class MatchType(StrEnum):
    EXACT = "exact"
    PREFIX = "prefix"
    PATTERN = "pattern"


@dataclass(frozen=True, slots=True)
class TierRule:
    rule_id: UUID
    position: int
    match_type: MatchType
    value: str
    tier_id: UUID


def tier_code(position: int) -> str:
    if not 1 <= position <= MAX_TIERS:
        raise ValueError(f"a tier position is 1 to {MAX_TIERS}, got {position}")
    return f"T{position}"


def check_rule_value(match_type: MatchType, value: str) -> str | None:
    """The problem with a rule's value as a validation code, or None when it is fine."""
    if not value.startswith("/"):
        return "starts_with_slash"
    if len(value) > VALUE_MAX:
        return "too_long"
    if match_type is not MatchType.PATTERN and "*" in value:
        return "star_in_exact" if match_type is MatchType.EXACT else "star_in_prefix"
    if value.count("*") > STARS_MAX:
        return "too_many_stars"
    return None


def _trimmed(path: str) -> str:
    return path.rstrip("/") or "/"


@cache
def _pattern(value: str) -> re.Pattern[str]:
    # Literal except `*`; at most STARS_MAX stars and VALUE_MAX characters keep it cheap.
    return re.compile(".*".join(re.escape(part) for part in value.split("*")), re.DOTALL)


def rule_matches(rule: TierRule, path: str) -> bool:
    if rule.match_type is MatchType.EXACT:
        return _trimmed(path) == _trimmed(rule.value)
    if rule.match_type is MatchType.PREFIX:
        return path.startswith(rule.value)
    return _pattern(rule.value).fullmatch(path) is not None


def first_match(rules: Sequence[TierRule], path: str) -> TierRule | None:
    for rule in sorted(rules, key=lambda rule: rule.position):
        if rule_matches(rule, path):
            return rule
    return None
```

`backend/src/idraft/crawl/ceiling.py`:

```python
"""The crawl-trap safety stop (spec 6.2; plan decision D13). A crawl ends at its ceiling as
`stopped_at_ceiling` and keeps what it found."""

from __future__ import annotations

from typing import Final

FLOOR: Final = 2_000
NO_SITEMAP: Final = 50_000
MULTIPLIER: Final = 3
RETRY_MAX: Final = 200_000


def crawl_ceiling(previous_sitemap_pages: int | None) -> int:
    """`previous_sitemap_pages`: the sitemap pages the last finished crawl found, or None when
    the project has none. The first crawl is a probe at the floor."""
    if previous_sitemap_pages is None:
        return FLOOR
    if previous_sitemap_pages < 0:
        raise ValueError("a sitemap page count is never negative")
    if previous_sitemap_pages == 0:
        return NO_SITEMAP
    return max(FLOOR, MULTIPLIER * previous_sitemap_pages)


def retry_ceiling(previous_ceiling: int, previous_sitemap_pages: int | None) -> int:
    """"Crawl again with a higher limit": double the stopped crawl's ceiling, or what its
    sitemap asks for when that is higher."""
    wanted = max(2 * previous_ceiling, crawl_ceiling(previous_sitemap_pages))
    return min(RETRY_MAX, wanted)
```

`backend/src/idraft/crawl/schedule.py`:

```python
"""When a scheduled crawl is due (plan decision D4).

At night in the project's time zone: the night runs from 01:00 for four hours, and each project
has its own one-hour slot in it, picked from its id, so crawls spread out. A crawl is due in its
slot once the interval since the last crawl started has passed, less a day, so the crawl falls
on the same night each time. A project that has never been crawled is due in its next slot.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, time, timedelta
from enum import StrEnum
from types import MappingProxyType
from typing import Final
from uuid import UUID
from zoneinfo import ZoneInfo


class CrawlSchedule(StrEnum):
    WEEKLY = "weekly"
    EVERY_TWO_WEEKS = "every_two_weeks"
    MONTHLY = "monthly"
    OFF = "off"


INTERVALS: Final[Mapping[CrawlSchedule, timedelta]] = MappingProxyType(
    {
        CrawlSchedule.WEEKLY: timedelta(days=7),
        CrawlSchedule.EVERY_TWO_WEEKS: timedelta(days=14),
        CrawlSchedule.MONTHLY: timedelta(days=28),
    }
)
NIGHT_START: Final = time(1, 0)
NIGHT_HOURS: Final = 4
SLOT_LENGTH: Final = timedelta(hours=1)
_SLACK: Final = timedelta(days=1)
_SLOT_MINUTES: Final = int((timedelta(hours=NIGHT_HOURS) - SLOT_LENGTH).total_seconds() // 60)


def slot_offset(project_id: UUID) -> timedelta:
    """Where in the night the project's slot starts: 0 to 3 hours after NIGHT_START."""
    return timedelta(minutes=project_id.int % (_SLOT_MINUTES + 1))


def crawl_due(
    *,
    schedule: CrawlSchedule,
    last_started: datetime | None,
    timezone: str,
    project_id: UUID,
    now: datetime,
) -> bool:
    if now.tzinfo is None or (last_started is not None and last_started.tzinfo is None):
        raise ValueError("times must be aware")
    interval = INTERVALS.get(schedule)
    if interval is None:
        return False
    if last_started is not None and now - last_started < interval - _SLACK:
        return False
    local = now.astimezone(ZoneInfo(timezone))
    start = datetime.combine(local.date(), NIGHT_START, tzinfo=local.tzinfo) + slot_offset(
        project_id
    )
    return start <= local < start + SLOT_LENGTH
```

- [ ] **Step 4: The import contract**

Add to `backend/pyproject.toml`, after the "ranks is pure" contract:

```toml
[[tool.importlinter.contracts]]
name = "crawl is pure: no database, workers, entrypoints or I/O libraries"
type = "forbidden"
source_modules = ["idraft.crawl"]
forbidden_modules = [
  "idraft.api", "idraft.worker", "idraft.collectors", "idraft.providers", "idraft.db",
  "idraft.storage", "idraft.config",
  "sqlalchemy", "asyncpg", "redis", "httpx", "fastapi", "starlette",
]
```

and add `"idraft.crawl",` to `source_modules` of "the dev seed is reached only from the operator CLI" (after `"idraft.config",`), which `tests/devseed/test_import_contract.py` requires for every package.

- [ ] **Step 5: Run the tests**

Run: `uv run pytest --no-cov tests/crawl tests/devseed/test_import_contract.py -q`
Expected: all pass. `uv run lint-imports` prints `Contracts: 7 kept, 0 broken.` (8 once plan 01's placement contract is on `develop`).

- [ ] **Step 6: Gate and commit**

```bash
git add backend/src/idraft/crawl/__init__.py backend/src/idraft/crawl/scopes.py \
  backend/src/idraft/crawl/tiers.py backend/src/idraft/crawl/ceiling.py \
  backend/src/idraft/crawl/schedule.py backend/pyproject.toml backend/tests/crawl/__init__.py \
  backend/tests/crawl/test_scopes.py backend/tests/crawl/test_tiers.py \
  backend/tests/crawl/test_ceiling.py backend/tests/crawl/test_schedule.py
git commit -m "Internal links: pure scopes, tier rules, crawl ceiling and schedule"
```

---

### Task 3: Tier levels: service, routes and the defaults of a new workspace

**Files:**
- Create: `backend/src/idraft/api/internal_links/__init__.py`, `problems.py`, `tier_levels.py`, `tier_level_routes.py`
- Create: `backend/src/idraft/api/schemas/internal_links.py`
- Modify: `backend/src/idraft/api/workspaces/service.py` (default tiers next to `insert_default_quotas`)
- Modify: `backend/src/idraft/api/audit.py` (`AuditAction` gains the ten actions of the Names section at once)
- Modify: `backend/src/idraft/api/resources.py` (`tier_levels: TierLevelService`), `backend/src/idraft/api/main.py` (build the service, include the router)
- Modify: `backend/tests/api/test_route_access.py` (`EXPECTED`)
- Modify: `backend/openapi/v1.json` (regenerated)
- Test: `backend/tests/api/internal_links/__init__.py`, `support.py`, `test_tier_levels.py`

- [ ] **Step 1: Test helpers**

`backend/tests/api/internal_links/__init__.py`: an empty file.

`backend/tests/api/internal_links/support.py`:

```python
"""Helpers for the internal links route tests: tiers, crawls, pages and links written
directly, so a route test needs no worker."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from idraft.crawl.scopes import scope_of
from idraft.crawl.tiers import DEFAULT_TIERS
from tests.api.auth.support import Workspace, execute, fetch, fetchrow
from tests.conftest import PostgresServer


def tiers_url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/page-tiers", *map(str, parts)])


async def seed_tiers(pg: PostgresServer, workspace: Workspace, count: int = 4) -> list[uuid.UUID]:
    """The workspace's default tiers (decision D17), the first `count` of them."""
    ids = []
    for position, (name, description) in enumerate(DEFAULT_TIERS[:count], start=1):
        row = await fetchrow(
            pg,
            "INSERT INTO core.page_tier_levels (workspace_id, position, name, description) "
            "VALUES ($1, $2, $3, $4) RETURNING id",
            workspace.id,
            position,
            name,
            description,
        )
        ids.append(row["id"])
    return ids


async def url_id(pg: PostgresServer, url: str) -> int:
    """The `core.urls` row of an https URL on example.com, made when missing."""
    host, _, path = url.removeprefix("https://").partition("/")
    path = "/" + path
    await execute(
        pg,
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ($1, 'example.com', 'com') ON CONFLICT (host) DO NOTHING",
        host,
    )
    row = await fetchrow(
        pg,
        "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version) "
        "SELECT $1, $2, id, $3, 1 FROM core.domains WHERE host = $4 "
        "ON CONFLICT (url_hash) DO UPDATE SET path = excluded.path RETURNING id",
        hashlib.sha256(f"{host}{path}".encode()).digest(),
        f"https://{host}{path}",
        path,
        host,
    )
    found: int = row["id"]
    return found


@dataclass(frozen=True)
class SeedLink:
    source: str
    target: str
    placement: str = "content"
    anchor: str = ""
    followed: bool = True


async def seed_crawl(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    pages: Sequence[tuple[str, int]],
    links: Sequence[SeedLink] = (),
    *,
    state: str = "ready",
) -> tuple[uuid.UUID, dict[str, int]]:
    """A finished crawl of `pages` (path, status) on example.com with `links` between them.
    Counts and metrics are left at their defaults; tests that need them set them."""
    run = await fetchrow(
        pg,
        "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
        "settings, ceiling, finished_at) VALUES ($1, $2, 'manual', $3, 'example.com', '{}', "
        "2000, now()) RETURNING id",
        workspace.id,
        project_id,
        state,
    )
    run_id: uuid.UUID = run["id"]
    ids = {}
    for path, status in pages:
        ids[path] = await url_id(pg, f"https://example.com{path}")
        await execute(
            pg,
            "INSERT INTO seo.crawl_pages (run_id, url_id, workspace_id, project_id, crawled_url, "
            "status_code, resource_type, links_state) VALUES ($1, $2, $3, $4, $6, $5, "
            "CASE WHEN $5 BETWEEN 300 AND 399 THEN 'redirect' WHEN $5 >= 400 THEN 'broken' "
            "ELSE 'html' END, 'from_html')",
            run_id,
            ids[path],
            workspace.id,
            project_id,
            status,
            f"https://example.com{path}",
        )
    await execute(pg, "SELECT seo.add_crawl_links_partition($1)", run_id)
    for link in links:
        await execute(
            pg,
            "INSERT INTO seo.crawl_links (run_id, workspace_id, source_url_id, target_url_id, "
            "anchor, kind, placement, scope, is_followed) "
            "VALUES ($1, $2, $3, $4, $5, 'text', $6, $7, $8)",
            run_id,
            workspace.id,
            ids[link.source],
            ids[link.target],
            link.anchor,
            link.placement,
            scope_of(link.placement).value,
            link.followed,
        )
    return run_id, ids


async def audit_rows(pg: PostgresServer, workspace: Workspace, action: str) -> list[dict[str, object]]:
    """The entries of one action, `before` and `after` decoded (asyncpg gives jsonb as text)."""
    rows = await fetch(
        pg,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 AND action = $2 "
        "ORDER BY id",
        workspace.id,
        action,
    )
    return [
        {name: None if row[name] is None else json.loads(row[name]) for name in ("before", "after")}
        for row in rows
    ]
```

`seed_crawl` and `SeedLink` are used from Task 6 on.

- [ ] **Step 2: Write the failing route tests**

`backend/tests/api/internal_links/test_tier_levels.py`:

```python
"""Workspace tier settings (spec 5.1; plan decisions D15 and D17)."""

from __future__ import annotations

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import audit_rows, seed_tiers, tiers_url, url_id
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


async def test_any_member_reads_the_tiers_with_codes_labels_and_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.get(tiers_url(workspace), headers=viewer.headers)

    assert response.status_code == 200, response.text
    tiers = response.json()["data"]
    assert [(tier["code"], tier["label"]) for tier in tiers] == [
        ("T1", "T1 Money pages"),
        ("T2", "T2 Supporting pages"),
        ("T3", "T3 Content pages"),
        ("T4", "T4 Utility pages"),
    ]
    assert tiers[0]["tier_id"] == str(t1)
    assert {tier["page_count"] for tier in tiers} == {0}
    assert {tier["rule_count"] for tier in tiers} == {0}


async def test_a_new_workspace_starts_with_the_four_defaults(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    owner = await member(resources, migrated, await make_workspace(migrated), "owner")
    # Whatever the registration mode of the test settings, an operator may create one.
    await execute(
        migrated, "UPDATE auth.users SET is_platform_operator = true WHERE id = $1", owner.user_id
    )
    created = await api.post(
        "/api/v1/workspaces",
        json={"name": "Tiered", "slug": "tiered-ws", "timezone": "Europe/London"},
        headers=owner.headers,
    )
    assert created.status_code == 201, created.text
    workspace_id = created.json()["data"]["workspace_id"]

    names = await fetchrow(
        migrated,
        "SELECT array_agg(name ORDER BY position) AS names FROM core.page_tier_levels "
        "WHERE workspace_id = $1",
        workspace_id,
    )

    assert names["names"] == ["Money pages", "Supporting pages", "Content pages", "Utility pages"]


async def test_owners_and_admins_add_up_to_eight(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await seed_tiers(migrated, workspace)

    for position in range(5, 9):
        added = await api.post(
            tiers_url(workspace), json={"name": f"Tier {position}"}, headers=admin.headers
        )
        assert added.status_code == 201, added.text
        assert added.json()["data"]["code"] == f"T{position}"
    refused = await api.post(tiers_url(workspace), json={"name": "Nine"}, headers=admin.headers)

    assert problem(refused) == (422, "tier_limit")
    assert len(await audit_rows(migrated, workspace, "page_tier.created")) == 4


@pytest.mark.parametrize("role", ["editor", "analyst", "viewer"])
async def test_other_roles_cannot_change_tiers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    t1, *_ = await seed_tiers(migrated, workspace)

    added = await api.post(tiers_url(workspace), json={"name": "X"}, headers=caller.headers)
    renamed = await api.patch(tiers_url(workspace, t1), json={"name": "X"}, headers=caller.headers)
    deleted = await api.delete(tiers_url(workspace, t1), headers=caller.headers)

    assert {added.status_code, renamed.status_code, deleted.status_code} == {403}


async def test_rename_keeps_the_pages_on_their_tier(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.patch(
        tiers_url(workspace, t1),
        json={"name": "Revenue pages", "description": "Where the money is."},
        headers=owner.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["label"] == "T1 Revenue pages"
    assert response.json()["data"]["tier_id"] == str(t1)
    (entry,) = await audit_rows(migrated, workspace, "page_tier.updated")
    assert entry["after"] == {"name": "Revenue pages", "description": "Where the money is."}


async def test_an_unused_tier_is_deleted_at_once_and_positions_close_up(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    _, t2, t3, _ = await seed_tiers(migrated, workspace)

    deleted = await api.delete(tiers_url(workspace, t2), headers=owner.headers)
    listed = await api.get(tiers_url(workspace), headers=owner.headers)

    assert deleted.status_code == 204, deleted.text
    codes = {tier["tier_id"]: tier["code"] for tier in listed.json()["data"]}
    assert codes[str(t3)] == "T2"
    assert len(codes) == 3


async def test_a_used_tier_asks_where_its_pages_and_rules_go(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/services/', $3)",
        workspace.id,
        project,
        t2,
    )

    refused = await api.delete(tiers_url(workspace, t2), headers=owner.headers)
    to_self = await api.delete(
        tiers_url(workspace, t2), params={"move_to": str(t2)}, headers=owner.headers
    )
    moved = await api.delete(
        tiers_url(workspace, t2), params={"move_to": str(t1)}, headers=owner.headers
    )

    assert problem(refused) == (422, "tier_in_use")
    assert refused.json()["rule_count"] == 1
    assert refused.json()["page_count"] == 0
    assert problem(to_self) == (422, "validation_failed")
    assert moved.status_code == 204, moved.text
    rule = await fetchrow(migrated, "SELECT tier_id FROM core.tier_rules WHERE project_id = $1", project)
    assert rule["tier_id"] == t1


async def test_deleting_to_untiered_moves_manual_pages_and_drops_the_rules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    manual = await url_id(migrated, "https://example.com/manual")
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project,
        manual,
        workspace.id,
        t2,
    )
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/x/', $3)",
        workspace.id,
        project,
        t2,
    )

    response = await api.delete(
        tiers_url(workspace, t2), params={"move_to": "none"}, headers=owner.headers
    )

    assert response.status_code == 204, response.text
    page = await fetchrow(
        migrated,
        "SELECT tier_id, tier_source FROM core.project_pages WHERE project_id = $1 AND url_id = $2",
        project,
        manual,
    )
    assert (page["tier_id"], page["tier_source"]) == (None, "manual")
    rules = await fetchrow(
        migrated, "SELECT count(*) AS n FROM core.tier_rules WHERE project_id = $1", project
    )
    assert rules["n"] == 0
    listed = await api.get(tiers_url(workspace), headers=owner.headers)
    assert [tier["tier_id"] for tier in listed.json()["data"]][:1] == [str(t1)]


async def test_another_workspace_cannot_see_or_change_these_tiers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    t1, *_ = await seed_tiers(migrated, workspace)
    stranger_workspace = await make_workspace(migrated, name="Other")
    stranger = await member(resources, migrated, stranger_workspace, "owner")

    read = await api.get(tiers_url(workspace), headers=stranger.headers)
    changed = await api.patch(
        tiers_url(stranger_workspace, t1), json={"name": "Mine"}, headers=stranger.headers
    )

    assert read.status_code == 404
    assert changed.status_code == 404
```

- [ ] **Step 3: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/internal_links/test_tier_levels.py -q`
Expected: every test fails with `404` from the unknown route (the creation test fails on the empty tier list).

- [ ] **Step 4: The problems and the tier schemas**

`backend/src/idraft/api/internal_links/__init__.py`:

```python
"""The internal link tracker's routes (plan 02): tier settings, page tiers, rules and tags,
crawls, and the reads of the Pages, Links, Journey and Tier flow screens."""
```

`backend/src/idraft/api/internal_links/problems.py`:

```python
"""Problem codes of the internal link tracker (docs/19 section 2.6 shapes). The app loads every
module that defines problem classes, and a code belongs to one class
(tests/api/test_problems.py)."""

from __future__ import annotations

from idraft.api.problems import ProblemError


class TierLimitError(ProblemError):
    status, code, title = 422, "tier_limit", "A workspace has at most 8 tiers"


class TierInUseError(ProblemError):
    """Carries `page_count` and `rule_count`: pass `move_to` to say where they go."""

    status, code, title = 422, "tier_in_use", "Pages or rules use this tier"


class CrawlInProgressError(ProblemError):
    """Carries `run_id`: the crawl under way."""

    status, code, title = 409, "crawl_in_progress", "A crawl of this site is under way"


class NoWebsiteError(ProblemError):
    status, code, title = 422, "no_website", "The project has no website to crawl"


class BudgetExceededError(ProblemError):
    """Carries `budget_id`: the budget the crawl would pass."""

    status, code, title = 422, "budget_exceeded", "A budget would be passed"


class NoCrawlError(ProblemError):
    status, code, title = 404, "no_crawl", "The site has no finished crawl yet"
```

`backend/src/idraft/api/schemas/internal_links.py` (Task 3 part; Tasks 6, 10 and 12 append to it):

```python
"""Bodies and answers of the internal link tracker's routes (plan 02, API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from idraft.api.schemas.common import Body, Patch, printable

TierName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=60),
    AfterValidator(printable),
]
TierDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(printable)
]


class TierRef(BaseModel):
    tier_id: UUID
    code: str
    name: str


class PageTier(BaseModel):
    tier_id: UUID
    position: int
    code: str = Field(description="T1 to T8, from the position.")
    name: str
    description: str
    label: str = Field(description='Code and name as filters show it: "T1 Money pages".')
    page_count: int = Field(description="Pages of the workspace's projects on this tier.")
    rule_count: int
    updated_at: datetime


class PageTierList(BaseModel):
    data: list[PageTier]


class PageTierResponse(BaseModel):
    data: PageTier


class PageTierCreate(Body):
    name: TierName
    description: TierDescription = ""


class PageTierPatch(Patch):
    name: TierName | None = None
    description: TierDescription | None = None

    @model_validator(mode="after")
    def _says_something(self) -> PageTierPatch:
        if not self.model_fields_set:
            raise ValueError("give a name or a description")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("a tier's name cannot be null")
        return self
```

- [ ] **Step 5: The service**

`backend/src/idraft/api/internal_links/tier_levels.py`:

```python
"""Workspace tier settings (spec 5.1). A tier's code and colour come from its position; adding
appends the next position; deleting moves the tier's pages and rules to another tier or to
Untiered in the same transaction and closes the positions up. Every write locks the
workspace's tiers first, so two at once cannot both take position 5. Every change is audited.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.internal_links.problems import TierInUseError, TierLimitError
from idraft.api.problems import NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import PageTierCreate, PageTierPatch
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.tiers import DEFAULT_TIERS, MAX_TIERS, tier_code
from idraft.db.engine import workspace_transaction
from idraft.db.tables import page_tier_levels, project_pages, tier_rules

_levels = page_tier_levels


@dataclass(frozen=True, slots=True)
class TierLevel:
    tier_id: UUID
    position: int
    name: str
    description: str
    page_count: int
    rule_count: int
    updated_at: datetime

    @property
    def code(self) -> str:
        return tier_code(self.position)

    @property
    def label(self) -> str:
        return f"{self.code} {self.name}"


async def insert_default_tiers(db: AsyncSession, workspace_id: UUID) -> None:
    """T1 to T4 of a new workspace (decision D17); migration 0025 gave the old ones the same."""
    await db.execute(
        insert(_levels),
        [
            {"workspace_id": workspace_id, "position": position, "name": name, "description": text}
            for position, (name, text) in enumerate(DEFAULT_TIERS, start=1)
        ],
    )


async def list_levels(db: AsyncSession, workspace_id: UUID) -> list[TierLevel]:
    pages = (
        select(func.count())
        .where(project_pages.c.workspace_id == workspace_id, project_pages.c.tier_id == _levels.c.id)
        .scalar_subquery()
    )
    rules = (
        select(func.count())
        .where(tier_rules.c.workspace_id == workspace_id, tier_rules.c.tier_id == _levels.c.id)
        .scalar_subquery()
    )
    rows = await db.execute(
        select(
            _levels.c.id,
            _levels.c.position,
            _levels.c.name,
            _levels.c.description,
            _levels.c.updated_at,
            pages.label("page_count"),
            rules.label("rule_count"),
        )
        .where(_levels.c.workspace_id == workspace_id)
        .order_by(_levels.c.position)
    )
    return [
        TierLevel(
            tier_id=row.id,
            position=row.position,
            name=row.name,
            description=row.description,
            page_count=row.page_count,
            rule_count=row.rule_count,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


async def _locked(db: AsyncSession, workspace_id: UUID) -> list[TierLevel]:
    await db.execute(
        select(_levels.c.id).where(_levels.c.workspace_id == workspace_id).with_for_update()
    )
    return await list_levels(db, workspace_id)


def _one(levels: Sequence[TierLevel], tier_id: UUID) -> TierLevel:
    for level in levels:
        if level.tier_id == tier_id:
            return level
    raise NotFoundError


def _query_error(name: str, code: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("query", name), "type": code, "msg": message}])


class TierLevelService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list(self, access: WorkspaceAccess) -> list[TierLevel]:
        async with self._transaction(access) as db:
            return await list_levels(db, access.workspace_id)

    async def add(
        self, access: WorkspaceAccess, body: PageTierCreate, info: RequestInfo
    ) -> TierLevel:
        async with self._transaction(access) as db:
            levels = await _locked(db, access.workspace_id)
            if len(levels) >= MAX_TIERS:
                raise TierLimitError
            tier_id: UUID = (
                await db.execute(
                    insert(_levels)
                    .values(
                        workspace_id=access.workspace_id,
                        position=len(levels) + 1,
                        name=body.name,
                        description=body.description,
                    )
                    .returning(_levels.c.id)
                )
            ).scalar_one()
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_tier.created",
                target_type="page_tier",
                target_id=tier_id,
                info=info,
                after={"name": body.name, "description": body.description},
            )
            return _one(await list_levels(db, access.workspace_id), tier_id)

    async def rename(
        self, access: WorkspaceAccess, tier_id: UUID, body: PageTierPatch, info: RequestInfo
    ) -> TierLevel:
        async with self._transaction(access) as db:
            before = _one(await _locked(db, access.workspace_id), tier_id)
            changes = body.model_dump(exclude_unset=True)
            await db.execute(
                update(_levels)
                .where(_levels.c.workspace_id == access.workspace_id, _levels.c.id == tier_id)
                .values(**changes, updated_at=func.now())
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_tier.updated",
                target_type="page_tier",
                target_id=tier_id,
                info=info,
                before={name: getattr(before, name) for name in changes},
                after=changes,
            )
            return _one(await list_levels(db, access.workspace_id), tier_id)

    async def delete(
        self,
        access: WorkspaceAccess,
        tier_id: UUID,
        move_to: UUID | Literal["none"] | None,
        info: RequestInfo,
    ) -> None:
        """Pages on the tier (manual or by rule) and the rules that name it move to `move_to`;
        to Untiered, manual pages become manual Untiered and the rules are deleted (a rule names
        a tier), which deletes their rule rows. A tier nothing uses needs no `move_to`."""
        async with self._transaction(access) as db:
            levels = await _locked(db, access.workspace_id)
            gone = _one(levels, tier_id)
            used = gone.page_count > 0 or gone.rule_count > 0
            if used and move_to is None:
                raise TierInUseError(page_count=gone.page_count, rule_count=gone.rule_count)
            if move_to == tier_id:
                raise _query_error("move_to", "move_to_self", "Move to another tier or `none`.")
            target = _one(levels, move_to).tier_id if isinstance(move_to, UUID) else None
            workspace = access.workspace_id
            await db.execute(
                update(project_pages)
                .where(project_pages.c.workspace_id == workspace, project_pages.c.tier_id == tier_id)
                .where(project_pages.c.tier_source == "manual")
                .values(tier_id=target, set_by=access.user_id, set_at=func.now())
            )
            if target is None:
                await db.execute(
                    delete(tier_rules).where(
                        tier_rules.c.workspace_id == workspace, tier_rules.c.tier_id == tier_id
                    )
                )
            else:
                await db.execute(
                    update(tier_rules)
                    .where(tier_rules.c.workspace_id == workspace, tier_rules.c.tier_id == tier_id)
                    .values(tier_id=target)
                )
                await db.execute(
                    update(project_pages)
                    .where(
                        project_pages.c.workspace_id == workspace,
                        project_pages.c.tier_id == tier_id,
                    )
                    .values(tier_id=target)
                )
            await db.execute(
                delete(_levels).where(_levels.c.workspace_id == workspace, _levels.c.id == tier_id)
            )
            await db.execute(
                update(_levels)
                .where(_levels.c.workspace_id == workspace, _levels.c.position > gone.position)
                .values(position=_levels.c.position - 1, updated_at=func.now())
            )
            await audit.record(
                db,
                workspace_id=workspace,
                actor_id=access.user_id,
                action="page_tier.deleted",
                target_type="page_tier",
                target_id=tier_id,
                info=info,
                before={
                    "name": gone.name,
                    "page_count": gone.page_count,
                    "rule_count": gone.rule_count,
                },
                after={"move_to": None if target is None else str(target)},
            )
```

- [ ] **Step 6: The routes, the wiring and the workspace default**

`backend/src/idraft/api/internal_links/tier_level_routes.py`:

```python
"""Workspace tier settings (spec 5.1): every member reads them; owners and admins change them
(`workspace:update`, decision D15)."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.tier_levels import TierLevel, TierLevelService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import (
    PageTier,
    PageTierCreate,
    PageTierList,
    PageTierPatch,
    PageTierResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/page-tiers", tags=["internal-links"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
ManageTiers = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.WORKSPACE_UPDATE))
]


def get_tier_levels(resources: Annotated[Resources, Depends(get_resources)]) -> TierLevelService:
    return resources.tier_levels


Levels = Annotated[TierLevelService, Depends(get_tier_levels)]


def tier_view(level: TierLevel) -> PageTier:
    return PageTier(
        tier_id=level.tier_id,
        position=level.position,
        code=level.code,
        name=level.name,
        description=level.description,
        label=level.label,
        page_count=level.page_count,
        rule_count=level.rule_count,
        updated_at=level.updated_at,
    )


@router.get("", summary="The workspace's page tiers, T1 first")
async def list_tiers(access: ReadData, levels: Levels) -> PageTierList:
    return PageTierList(data=[tier_view(level) for level in await levels.list(access)])


@router.post(
    "",
    status_code=201,
    summary="Add the next tier",
    description="Appends the next position (T5, then up to T8); `422 tier_limit` at 8.",
)
async def add_tier(
    body: PageTierCreate, access: ManageTiers, levels: Levels, info: Info
) -> PageTierResponse:
    return PageTierResponse(data=tier_view(await levels.add(access, body, info)))


@router.patch("/{tier_id}", summary="Rename a tier or change its description")
async def rename_tier(
    tier_id: UUID, body: PageTierPatch, access: ManageTiers, levels: Levels, info: Info
) -> PageTierResponse:
    return PageTierResponse(data=tier_view(await levels.rename(access, tier_id, body, info)))


@router.delete(
    "/{tier_id}",
    status_code=204,
    summary="Delete a tier, moving its pages and rules",
    description="`move_to` is another tier's id or `none` (Untiered). A tier that pages or "
    "rules use and no `move_to` is `422 tier_in_use` with `page_count` and `rule_count`. "
    "Positions close up: deleting T2 makes T3 the new T2.",
)
async def delete_tier(
    tier_id: UUID,
    access: ManageTiers,
    levels: Levels,
    info: Info,
    move_to: Annotated[UUID | Literal["none"] | None, Query()] = None,
) -> Response:
    await levels.delete(access, tier_id, move_to, info)
    return Response(status_code=204)
```

`backend/src/idraft/api/workspaces/service.py`: right after `await repository.insert_default_quotas(db, workspace_id)` in `create`, add `await insert_default_tiers(db, workspace_id)`, imported as `from idraft.api.internal_links.tier_levels import insert_default_tiers`.

`backend/src/idraft/api/audit.py`: add to `AuditAction`, after `"budget.deleted",`:

```python
    "page_tier.created",
    "page_tier.updated",
    "page_tier.deleted",
    "tier_rule.created",
    "tier_rule.updated",
    "tier_rule.deleted",
    "page_tiers.changed",
    "page_tags.changed",
    "link_crawl.requested",
    "link_crawl.cancelled",
```

`backend/src/idraft/api/resources.py`: import `TierLevelService` from `idraft.api.internal_links.tier_levels` and add `tier_levels: TierLevelService` after `ai_sources`. `backend/src/idraft/api/main.py`: where the other services are built from `sessions`, build `tier_levels=TierLevelService(sessions=sessions)` the same way `ai_engines=EngineService(sessions=sessions)` is built, import `router as tier_level_routes_router` from `idraft.api.internal_links.tier_level_routes`, and `app.include_router(tier_level_routes_router)` after `prompt_routes_router`.

`backend/tests/api/test_route_access.py`, add to `EXPECTED`:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/page-tiers"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/page-tiers"): "workspace:update",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/page-tiers/{tier_id}"): "workspace:update",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/page-tiers/{tier_id}"): "workspace:update",
```

- [ ] **Step 7: Run the tests and regenerate the contract**

```bash
uv run pytest --no-cov tests/api/internal_links tests/api/test_route_access.py tests/api/test_problems.py -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest --no-cov tests/api/test_openapi.py -q
```

Expected: all pass.

- [ ] **Step 8: Gate and commit**

```bash
git add backend/src/idraft/api/internal_links/__init__.py backend/src/idraft/api/internal_links/problems.py \
  backend/src/idraft/api/internal_links/tier_levels.py backend/src/idraft/api/internal_links/tier_level_routes.py \
  backend/src/idraft/api/schemas/internal_links.py backend/src/idraft/api/workspaces/service.py \
  backend/src/idraft/api/audit.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py \
  backend/tests/api/test_route_access.py backend/openapi/v1.json \
  backend/tests/api/internal_links/__init__.py backend/tests/api/internal_links/support.py \
  backend/tests/api/internal_links/test_tier_levels.py
git commit -m "Internal links: workspace page tiers with add, rename and delete with move"
```

---

### Task 4: Click depth and PageRank equity

**Files:**
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (numpy and scipy; scipy-stubs for mypy)
- Create: `backend/src/idraft/crawl/graph.py`
- Test: `backend/tests/crawl/test_graph.py`

- [ ] **Step 1: Add the dependencies**

```bash
uv add "numpy>=2.3" "scipy>=1.16"
uv add --dev "scipy-stubs>=1.16"
uv sync
uv run python -c "import numpy, scipy.sparse; print(numpy.__version__, scipy.__version__)"
```

Expected: two version numbers. numpy ships its own types; `scipy-stubs` gives mypy strict the sparse matrix types, so no `ignore_missing_imports` override is added. The memory note "installs allowed" covers adding them; the lock file changes and is committed with this task.

- [ ] **Step 2: Write the failing tests**

`backend/tests/crawl/test_graph.py`:

```python
"""Click depth and internal PageRank on small graphs with known answers (spec 6.4 and 11;
plan decision D12)."""

import pytest

from idraft.crawl.graph import (
    MAX_ROUNDS,
    Link,
    Node,
    click_depths,
    deep_only_through_auto,
    pagerank,
)
from idraft.crawl.scopes import LinkScope

E, A, T = LinkScope.EDITORIAL, LinkScope.AUTO_GENERATED, LinkScope.TEMPLATE


def _nodes(*items: tuple[int, int] | tuple[int, int, int]) -> dict[int, Node]:
    nodes = {}
    for item in items:
        url_id, status, *redirect = item
        nodes[url_id] = Node(url_id, status, redirect[0] if redirect else None)
    return nodes


def _link(source: int, target: int, scope: LinkScope = E, *, followed: bool = True) -> Link:
    return Link(source, target, scope, followed)


def test_depth_counts_clicks_and_a_redirect_is_a_hop() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 301, 4), (4, 200), (5, 200))
    links = [_link(1, 2), _link(2, 3), _link(1, 5, followed=False)]

    depths = click_depths(1, nodes, links)

    assert depths == {1: 0, 2: 1, 3: 2, 4: 3}


def test_depth_without_auto_generated_links_leaves_them_out() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200))
    links = [_link(1, 2, T), _link(2, 3, A), _link(1, 3, A)]

    assert click_depths(1, nodes, links) == {1: 0, 2: 1, 3: 1}
    assert click_depths(1, nodes, links, without_auto=True) == {1: 0, 2: 1}


@pytest.mark.parametrize(
    ("depth", "without_auto", "flagged"),
    [(2, None, True), (1, 5, True), (2, 5, False), (12, 12, False), (None, None, False)],
)
def test_deep_only_through_previous_and_next(
    depth: int | None, without_auto: int | None, flagged: bool
) -> None:
    assert deep_only_through_auto(depth, without_auto) is flagged


def test_a_home_page_and_three_leaves_linking_both_ways() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200), (4, 200))
    links = [_link(1, leaf) for leaf in (2, 3, 4)] + [_link(leaf, 1) for leaf in (2, 3, 4)]

    equity = pagerank(nodes, links)

    assert equity.shares[1] == pytest.approx(0.4797297, abs=1e-6)
    for leaf in (2, 3, 4):
        assert equity.shares[leaf] == pytest.approx(0.1734234, abs=1e-6)
    assert sum(equity.shares.values()) == pytest.approx(1.0)
    assert equity.lost_to_errors == 0.0
    assert equity.rounds < MAX_ROUNDS


def test_a_redirect_passes_everything_to_its_target() -> None:
    # 1 links to the redirect 2, which goes to 3; 3 links back to 1.
    nodes = _nodes((1, 200), (2, 301, 3), (3, 200))
    equity = pagerank(nodes, [_link(1, 2), _link(3, 1)])

    for url_id in (1, 2, 3):
        assert equity.shares[url_id] == pytest.approx(1 / 3, abs=1e-6)


def test_a_nofollow_link_counts_in_the_out_degree_and_passes_nothing() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200))
    links = [_link(1, 2), _link(1, 3, followed=False), _link(2, 1), _link(3, 1)]

    equity = pagerank(nodes, links)

    assert equity.shares[1] == pytest.approx(0.5268292, abs=1e-5)
    assert equity.shares[2] == pytest.approx(0.3485366, abs=1e-5)
    assert equity.shares[3] == pytest.approx(0.1246341, abs=1e-5)


def test_an_error_page_keeps_what_it_gets_and_passes_nothing() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 404))
    equity = pagerank(nodes, [_link(1, 2), _link(1, 3), _link(2, 1), _link(3, 1)])

    assert equity.shares[2] == pytest.approx(equity.shares[3])
    assert equity.lost_to_errors == pytest.approx(equity.shares[3])
    assert equity.lost_to_errors == pytest.approx(0.3031935, abs=1e-5)
    assert sum(equity.shares.values()) == pytest.approx(1.0)


def test_a_page_with_no_links_out_spreads_its_value() -> None:
    equity = pagerank(_nodes((1, 200), (2, 200)), [_link(1, 2)])

    assert equity.shares[1] == pytest.approx(0.5 / 1.425, abs=1e-6)
    assert equity.shares[2] == pytest.approx(1 - 0.5 / 1.425, abs=1e-6)


def test_every_link_of_a_pair_counts_once_and_self_links_never() -> None:
    once = pagerank(_nodes((1, 200), (2, 200)), [_link(1, 2), _link(2, 1)])
    twice = pagerank(
        _nodes((1, 200), (2, 200)),
        [_link(1, 2), _link(1, 2, T), _link(1, 1), _link(2, 1)],
    )
    assert twice.shares == pytest.approx(once.shares)


def test_a_target_that_was_not_crawled_is_a_node() -> None:
    equity = pagerank(_nodes((1, 200)), [_link(1, 9)])
    assert set(equity.shares) == {1, 9}


def test_nothing_to_rank() -> None:
    equity = pagerank({}, [])
    assert (equity.shares, equity.lost_to_errors, equity.rounds) == ({}, 0.0, 0)
```

- [ ] **Step 3: Run them to see them fail**

Run: `uv run pytest --no-cov tests/crawl/test_graph.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.crawl.graph'`.

- [ ] **Step 4: Write the module**

`backend/src/idraft/crawl/graph.py`:

```python
"""Click depth and internal PageRank of one crawl (spec 6.4; plan decision D12).

Depth: breadth-first from the start URL over followed links of every placement; a redirect is a
hop to its target. The same search without auto-generated links finds pages that only
previous and next links reach.

PageRank: damping 0.85, until the largest change is under 1e-9 or for 100 rounds, over unique
(source, target) pairs. A source's out-degree counts every distinct target, followed or not, and
a nofollow pair's share is dropped. A redirect passes everything to its target. An error page
(4xx, 5xx) passes nothing and keeps what it gets: that is the equity lost to errors. A 200 page
with no link out spreads its value over every node. Shares are values over their sum.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final

import numpy as np
from scipy.sparse import csr_matrix

from idraft.crawl.scopes import LinkScope

DAMPING: Final = 0.85
TOLERANCE: Final = 1e-9
MAX_ROUNDS: Final = 100
# "Deep only through previous and next": more than this many clicks deeper without them.
DEEP_EXTRA: Final = 3


@dataclass(frozen=True, slots=True)
class Node:
    url_id: int
    # None for a URL that was linked but not crawled.
    status_code: int | None
    redirect_to: int | None = None

    @property
    def is_error(self) -> bool:
        return self.status_code is not None and self.status_code >= 400


@dataclass(frozen=True, slots=True)
class Link:
    source: int
    target: int
    scope: LinkScope
    followed: bool


@dataclass(frozen=True, slots=True)
class Equity:
    shares: dict[int, float]
    lost_to_errors: float
    rounds: int


def click_depths(
    start: int, nodes: Mapping[int, Node], links: Iterable[Link], *, without_auto: bool = False
) -> dict[int, int]:
    forward: dict[int, set[int]] = {}
    for link in links:
        if not link.followed or link.source == link.target:
            continue
        if without_auto and link.scope is LinkScope.AUTO_GENERATED:
            continue
        forward.setdefault(link.source, set()).add(link.target)
    for node in nodes.values():
        if node.redirect_to is not None and node.redirect_to != node.url_id:
            forward.setdefault(node.url_id, set()).add(node.redirect_to)
    depths = {start: 0}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for target in forward.get(current, ()):
            if target not in depths:
                depths[target] = depths[current] + 1
                queue.append(target)
    return depths


def deep_only_through_auto(depth: int | None, depth_without_auto: int | None) -> bool:
    if depth is None:
        return False
    if depth_without_auto is None:
        return True
    return depth_without_auto - depth > DEEP_EXTRA


def _pairs(nodes: Mapping[int, Node], links: Iterable[Link]) -> dict[tuple[int, int], bool]:
    """Each distinct (source, target) and whether any of its links is followed."""
    pairs: dict[tuple[int, int], bool] = {}
    for link in links:
        source = nodes.get(link.source)
        if link.source == link.target or (
            source is not None and (source.is_error or source.redirect_to is not None)
        ):
            continue
        key = (link.source, link.target)
        pairs[key] = pairs.get(key, False) or link.followed
    for node in nodes.values():
        if node.redirect_to is not None and not node.is_error and node.redirect_to != node.url_id:
            pairs[(node.url_id, node.redirect_to)] = True
    return pairs


def pagerank(nodes: Mapping[int, Node], links: Iterable[Link]) -> Equity:
    pairs = _pairs(nodes, links)
    ids = sorted({*nodes, *(source for source, _ in pairs), *(target for _, target in pairs)})
    if not ids:
        return Equity(shares={}, lost_to_errors=0.0, rounds=0)
    index = {url_id: position for position, url_id in enumerate(ids)}
    size = len(ids)
    error = np.zeros(size, dtype=bool)
    for node in nodes.values():
        error[index[node.url_id]] = node.is_error
    out_degree = np.zeros(size)
    for source, _ in pairs:
        out_degree[index[source]] += 1
    followed = [(source, target) for (source, target), follows in pairs.items() if follows]
    matrix = csr_matrix(
        (
            [1.0 / out_degree[index[source]] for source, _ in followed],
            ([index[target] for _, target in followed], [index[source] for source, _ in followed]),
        ),
        shape=(size, size),
    )
    dangling = (out_degree == 0) & ~error
    rank = np.full(size, 1.0 / size)
    rounds = 0
    while rounds < MAX_ROUNDS:
        rounds += 1
        spread = DAMPING * float(rank[dangling].sum()) / size
        new = (1 - DAMPING) / size + DAMPING * (matrix @ rank) + spread
        change = float(np.abs(new - rank).max())
        rank = new
        if change < TOLERANCE:
            break
    shares = rank / float(rank.sum())
    return Equity(
        shares={url_id: float(shares[position]) for url_id, position in index.items()},
        lost_to_errors=float(shares[error].sum()),
        rounds=rounds,
    )
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest --no-cov tests/crawl/test_graph.py -q`
Expected: 15 passed.

- [ ] **Step 6: Gate and commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/src/idraft/crawl/graph.py backend/tests/crawl/test_graph.py
git commit -m "Internal links: click depth and PageRank equity on a sparse matrix"
```

---

### Task 5: The template pass over stored links

Waits for plan 01's `backend/src/idraft/crawl/placement.py` on `develop`, like Task 8: the rule of the pass is plan 01's `place_links` (decision D19).

**Files:**
- Create: `backend/src/idraft/crawl/template.py`
- Test: `backend/tests/crawl/test_template.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/crawl/test_template.py`:

```python
"""The template pass run over a crawl's stored candidate links (spec 6.3; decision D19). The
rule is plan 01's `place_links`; these tests check that stored rows reach it and come back."""

from idraft.crawl.placement import MIN_FOLDER_PAGES
from idraft.crawl.template import TemplateRow, template_placements

SITE = "https://example.com"


def _rows(
    container: int, targets_by_page: dict[str, list[str]], placement: str = "content"
) -> list[TemplateRow]:
    rows = []
    for page, targets in targets_by_page.items():
        for target in targets:
            rows.append(
                TemplateRow(
                    link_id=len(rows) + container * 1000,
                    source_url=f"{SITE}{page}",
                    target_url=f"{SITE}{target}",
                    container=container,
                    placement=placement,
                )
            )
    return rows


POSTS = [f"/blog/post-{n}" for n in range(1, 7)]
PAGES = [f"{SITE}{post}" for post in POSTS]


def test_an_unmarked_menu_with_the_same_links_on_every_page_is_navigation() -> None:
    menu = ["/blog/post-1", "/blog/post-2", "/blog/post-3"]
    rows = _rows(7, {post: [t for t in menu if t != post] for post in POSTS})

    placements = template_placements(rows, PAGES)

    assert set(placements.values()) == {"navigation"}
    assert len(placements) == len(rows)


def test_a_related_block_of_three_changing_links_is_auto_generated() -> None:
    related = {post: [f"/x/{post}-{n}" for n in range(3)] for post in POSTS}

    placements = template_placements(_rows(8, related), PAGES)

    assert set(placements.values()) == {"auto_generated"}


def test_prose_with_changing_links_stays_content() -> None:
    prose = {post: [f"/x/{post}-{n}" for n in range(index % 3 + 1)] for index, post in enumerate(POSTS)}

    assert template_placements(_rows(9, prose), PAGES) == {}


def test_a_small_folder_is_left_to_the_first_pass() -> None:
    few = POSTS[: MIN_FOLDER_PAGES - 1]
    rows = _rows(7, {post: ["/a", "/b"] for post in few})

    assert template_placements(rows, [f"{SITE}{post}" for post in few]) == {}


def test_an_open_link_no_block_claims_stays_auto_generated_and_unchanged() -> None:
    rows = _rows(10, {POSTS[0]: ["/a"]}, placement="auto_generated")

    assert template_placements(rows, PAGES) == {}
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/crawl/test_template.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.crawl.template'`.

- [ ] **Step 3: Write the module**

`backend/src/idraft/crawl/template.py`:

```python
"""The second placement pass over a crawl's stored links (spec 6.3; plan decision D19).

Ingest stores each page's edges as it reads the page, so the pass, which needs every page of
a folder at once, runs afterwards over the stored rows. The rule is plan 01's
`idraft.crawl.placement.place_links` (folder size, the 50% share, the same-targets coverage and
the steady-count guard, measured by spike S-17): this module only rebuilds its input from the
rows (the candidates: links the first pass called `content` or left open) and returns the links
it moved. Stored edges are counted once per (target, placement, anchor), so a block's link
count per page is a count of distinct links.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from idraft.crawl.placement import FoundLink, Placement, place_links


@dataclass(frozen=True, slots=True)
class TemplateRow:
    link_id: int
    source_url: str
    target_url: str
    container: int
    # The first pass's placement: `content`, or `auto_generated` for a link it left open.
    placement: str


def template_placements(rows: Sequence[TemplateRow], pages: Sequence[str]) -> dict[int, str]:
    """The new placement of each link the pass moves, by link id. `pages` are the canonical
    URLs of every page whose HTML was classified, so folder sizes count pages without
    candidates too."""
    by_page: dict[str, list[TemplateRow]] = {url: [] for url in pages}
    for row in rows:
        by_page.setdefault(row.source_url, []).append(row)
    found = {
        url: [
            FoundLink(
                href=row.target_url,
                anchor="",
                kind="text",
                rel=frozenset(),
                placement=Placement(row.placement),
                container=str(row.container),
                open=row.placement == Placement.AUTO_GENERATED,
            )
            for row in links
        ]
        for url, links in by_page.items()
    }
    placed = place_links(found)
    return {
        row.link_id: str(after.placement)
        for url, links in by_page.items()
        for row, after in zip(links, placed[url], strict=True)
        if str(after.placement) != row.placement
    }
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest --no-cov tests/crawl/test_template.py -q`
Expected: 5 passed. A failure here is a disagreement with plan 01's rule as merged: read its decision 6 and its fixtures, and change the test's site shape, never the rule.

- [ ] **Step 5: Gate and commit**

```bash
git add backend/src/idraft/crawl/template.py backend/tests/crawl/test_template.py
git commit -m "Internal links: template pass over stored links through plan 01's rule"
```

---

### Task 6: Page tiers, rules, preview, reset, CSV import, tags and the tier flow store

**Files:**
- Create: `backend/src/idraft/collectors/crawl_store.py`
- Create: `backend/src/idraft/api/internal_links/page_filter.py`, `page_tiers.py`, `page_tier_routes.py`
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (append)
- Modify: `backend/src/idraft/api/internal_links/tier_levels.py` (`delete` re-applies rules and the tier flow)
- Modify: `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/main.py`, `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json`
- Test: `backend/tests/collectors/test_crawl_store.py`, `backend/tests/api/internal_links/test_page_tiers.py`, `backend/tests/api/internal_links/test_tier_rules.py`, `backend/tests/api/internal_links/test_tier_import.py`, `backend/tests/api/internal_links/test_page_tags.py`

- [ ] **Step 1: Write the failing store tests**

`backend/tests/collectors/test_crawl_store.py`:

```python
"""Rule tiers and the tier flow of the latest crawl (spec 5.2 and 6.6; decisions D10, D16).
As the worker, which runs them after a crawl; the API runs the same functions."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_store import apply_rules, latest_run, recompute_tier_flow
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


async def test_the_latest_finished_crawl_is_the_one_in_scope(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    older, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    newer, _ = await seed_crawl(migrated, workspace, project, [("/", 200)], state="stopped_at_ceiling")
    await seed_crawl(migrated, workspace, project, [("/", 200)], state="failed")
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        assert await latest_run(db, workspace.id, project) == newer
    assert older != newer


async def test_rules_tag_new_pages_and_never_touch_a_manual_tier(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/services/seo", 200), ("/services/ppc", 200), ("/blog/a", 200), ("/about", 200)],
    )
    for position, value, tier in ((1, "/services/seo", t2), (2, "/services/", t1)):
        await execute(
            migrated,
            "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
            "tier_id) VALUES ($1, $2, $3, $4, $5, $6)",
            workspace.id,
            project,
            position,
            "exact" if position == 1 else "prefix",
            value,
            tier,
        )
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, NULL, 'manual')",
        project,
        ids["/services/ppc"],
        workspace.id,
    )
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        changed = await apply_rules(db, workspace_id=workspace.id, project_id=project)

    rows = await fetch(
        migrated,
        "SELECT url_id, tier_id, tier_source FROM core.project_pages WHERE project_id = $1",
        project,
    )
    found = {row["url_id"]: (row["tier_id"], row["tier_source"]) for row in rows}
    assert changed == 1
    assert found == {
        ids["/services/seo"]: (t2, "rule"),  # the first matching rule wins
        ids["/services/ppc"]: (None, "manual"),  # manual Untiered beats the prefix rule
    }


async def test_the_tier_flow_counts_unique_pairs_per_scope_and_all(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/pricing", 200), ("/blog/a", 200)],
        [
            SeedLink("/blog/a", "/pricing", "content", "See plans"),
            SeedLink("/blog/a", "/pricing", "content", "Pricing"),
            SeedLink("/blog/a", "/pricing", "navigation", "Pricing"),
            SeedLink("/", "/pricing", "navigation", "Pricing"),
            SeedLink("/", "/blog/a", "content"),
        ],
    )
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project,
        ids["/pricing"],
        workspace.id,
        t1,
    )
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        await recompute_tier_flow(db, workspace_id=workspace.id, run_id=run)

    rows = await fetch(
        migrated,
        "SELECT scope, from_tier_id, to_tier_id, links FROM seo.crawl_tier_flow WHERE run_id = $1",
        run,
    )
    cells = {(row["scope"], row["from_tier_id"], row["to_tier_id"]): row["links"] for row in rows}
    assert cells == {
        ("editorial", None, t1): 1,
        ("editorial", None, None): 1,
        ("template", None, t1): 2,
        ("all", None, t1): 2,
        ("all", None, None): 1,
    }
    stats = await fetch(
        migrated, "SELECT tier_id, pages FROM seo.crawl_tier_stats WHERE run_id = $1", run
    )
    assert {row["tier_id"]: row["pages"] for row in stats} == {t1: 1, None: 2}
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/collectors/test_crawl_store.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.collectors.crawl_store'`.

- [ ] **Step 3: Write the store**

`backend/src/idraft/collectors/crawl_store.py`:

```python
"""What the API and the worker both do to a project's crawls (plan decisions D10 and D16): find
the crawl in scope, give pages their rule tiers, and recompute the tier flow.

Every statement names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final
from uuid import UUID

from sqlalchemy import bindparam, delete, func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.crawl.tiers import MatchType, TierRule, first_match
from idraft.db.tables import (
    crawl_pages,
    crawl_runs,
    crawl_tier_flow,
    crawl_tier_stats,
    project_pages,
    tier_rules,
    urls,
)

# Crawls whose data the screens show; the latest of them is `run=latest`.
DATA_STATES: Final = ("ready", "stopped_at_ceiling")
ACTIVE_STATES: Final = ("queued", "crawling", "processing")
# A tier change recomputes the flow in the request up to this many links (spec 6.6).
INLINE_FLOW_LINKS: Final = 200_000
_ROWS_PER_STATEMENT: Final = 5_000


async def latest_run(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> UUID | None:
    found: UUID | None = (
        await db.execute(
            select(crawl_runs.c.id)
            .where(
                crawl_runs.c.workspace_id == workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_runs.c.state.in_(DATA_STATES),
            )
            .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return found


async def project_rules(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[TierRule]:
    rows = await db.execute(
        select(tier_rules).where(
            tier_rules.c.workspace_id == workspace_id, tier_rules.c.project_id == project_id
        )
    )
    return [
        TierRule(
            rule_id=row.id,
            position=row.position,
            match_type=MatchType(row.match_type),
            value=row.value,
            tier_id=row.tier_id,
        )
        for row in rows
    ]


def _chunks[T](items: Sequence[T]) -> list[Sequence[T]]:
    return [items[start : start + _ROWS_PER_STATEMENT] for start in range(0, len(items), _ROWS_PER_STATEMENT)]


async def apply_rules(db: AsyncSession, *, workspace_id: UUID, project_id: UUID) -> int:
    """Give every page of the latest crawl, and every URL that has a rule tier, the tier of the
    first rule that matches its path; a page with a manual tier is left as it is. Returns the
    rows added, changed or removed."""
    rules = await project_rules(db, workspace_id, project_id)
    run_id = await latest_run(db, workspace_id, project_id)
    current = {
        row.url_id: row
        for row in await db.execute(
            select(
                project_pages.c.url_id,
                project_pages.c.tier_id,
                project_pages.c.tier_source,
                project_pages.c.rule_id,
            ).where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.project_id == project_id,
            )
        )
    }
    crawled = (
        select(crawl_pages.c.url_id).where(
            crawl_pages.c.workspace_id == workspace_id, crawl_pages.c.run_id == run_id
        )
        if run_id is not None
        else None
    )
    candidate_ids = set(current)
    if crawled is not None:
        candidate_ids |= set((await db.execute(crawled)).scalars())
    paths = dict(
        (
            await db.execute(
                select(urls.c.id, urls.c.path).where(urls.c.id.in_(sorted(candidate_ids)))
            )
        ).tuples()
    ) if candidate_ids else {}
    added: list[dict[str, object]] = []
    changed: list[dict[str, object]] = []
    removed: list[int] = []
    for url_id, path in paths.items():
        row = current.get(url_id)
        if row is not None and row.tier_source == "manual":
            continue
        match = first_match(rules, path)
        if match is None:
            if row is not None:
                removed.append(url_id)
        elif row is None:
            added.append(
                {
                    "project_id": project_id,
                    "url_id": url_id,
                    "workspace_id": workspace_id,
                    "tier_id": match.tier_id,
                    "tier_source": "rule",
                    "rule_id": match.rule_id,
                }
            )
        elif (row.tier_id, row.rule_id) != (match.tier_id, match.rule_id):
            changed.append({"b_url": url_id, "b_tier": match.tier_id, "b_rule": match.rule_id})
    for chunk in _chunks(added):
        await db.execute(insert(project_pages), list(chunk))
    if changed:
        await db.execute(
            update(project_pages)
            .where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.project_id == project_id,
                project_pages.c.url_id == bindparam("b_url"),
            )
            .values(tier_id=bindparam("b_tier"), rule_id=bindparam("b_rule"), set_at=func.now()),
            changed,
        )
    for chunk in _chunks(removed):
        await db.execute(
            delete(project_pages).where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.project_id == project_id,
                project_pages.c.url_id.in_(chunk),
                project_pages.c.tier_source == "rule",
            )
        )
    return len(added) + len(changed) + len(removed)


_FLOW = text(
    """
    WITH pairs AS (
        SELECT DISTINCT l.source_url_id, l.target_url_id, l.scope
        FROM seo.crawl_links l
        WHERE l.run_id = :run_id AND l.workspace_id = :workspace_id
          AND l.source_url_id <> l.target_url_id
    ), tagged AS (
        SELECT p.source_url_id, p.target_url_id, p.scope,
               fp.tier_id AS from_tier, tp.tier_id AS to_tier
        FROM pairs p
        LEFT JOIN core.project_pages fp ON fp.workspace_id = :workspace_id
             AND fp.project_id = :project_id AND fp.url_id = p.source_url_id
        LEFT JOIN core.project_pages tp ON tp.workspace_id = :workspace_id
             AND tp.project_id = :project_id AND tp.url_id = p.target_url_id
    )
    INSERT INTO seo.crawl_tier_flow (run_id, workspace_id, scope, from_tier_id, to_tier_id, links)
    SELECT :run_id, :workspace_id, scope, from_tier, to_tier, count(*)
    FROM tagged GROUP BY scope, from_tier, to_tier
    UNION ALL
    SELECT :run_id, :workspace_id, 'all', from_tier, to_tier,
           count(DISTINCT (source_url_id, target_url_id))
    FROM tagged GROUP BY from_tier, to_tier
    """
)
_STATS = text(
    """
    INSERT INTO seo.crawl_tier_stats (run_id, workspace_id, tier_id, pages, equity_share,
                                      average_depth)
    SELECT :run_id, :workspace_id, pp.tier_id, count(*), coalesce(sum(cp.equity_share), 0),
           avg(cp.click_depth)
    FROM seo.crawl_pages cp
    LEFT JOIN core.project_pages pp ON pp.workspace_id = :workspace_id
         AND pp.project_id = cp.project_id AND pp.url_id = cp.url_id
    WHERE cp.run_id = :run_id AND cp.workspace_id = :workspace_id
    GROUP BY pp.tier_id
    """
)


async def recompute_tier_flow(db: AsyncSession, *, workspace_id: UUID, run_id: UUID) -> None:
    """The flow matrix and the per-tier strip of one crawl, from its links and today's tiers."""
    project_id = (
        await db.execute(
            select(crawl_runs.c.project_id).where(
                crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id
            )
        )
    ).scalar_one()
    keys = {"run_id": run_id, "workspace_id": workspace_id, "project_id": project_id}
    for table in (crawl_tier_flow, crawl_tier_stats):
        await db.execute(
            delete(table).where(table.c.run_id == run_id, table.c.workspace_id == workspace_id)
        )
    await db.execute(_FLOW, keys)
    await db.execute(_STATS, {"run_id": run_id, "workspace_id": workspace_id})
    await db.execute(
        update(crawl_runs)
        .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id)
        .values(tier_flow_stale=False)
    )


async def tiers_changed(db: AsyncSession, *, workspace_id: UUID, project_id: UUID) -> None:
    """After a tier, rule or tier-level change: the latest crawl's flow, now or by the tick."""
    run_id = await latest_run(db, workspace_id, project_id)
    if run_id is None:
        return
    links = (
        await db.execute(
            select(crawl_runs.c.links_stored).where(
                crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id
            )
        )
    ).scalar_one()
    if links <= INLINE_FLOW_LINKS:
        await recompute_tier_flow(db, workspace_id=workspace_id, run_id=run_id)
    else:
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id)
            .values(tier_flow_stale=True)
        )
```

Run: `uv run pytest --no-cov tests/collectors/test_crawl_store.py -q`
Expected: 3 passed.

- [ ] **Step 4: Write the failing route tests**

`backend/tests/api/internal_links/test_page_tiers.py`:

```python
"""Setting tiers on pages: bulk by ids or filter, manual Untiered, reset to rule (spec 5.2)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, audit_rows, seed_crawl, seed_tiers
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/pricing", 200), ("/blog/a", 200), ("/blog/b", 200), ("/gone", 404)]


async def _tiers(pg: PostgresServer, project: uuid.UUID) -> dict[int, tuple[uuid.UUID | None, str]]:
    rows = await fetch(
        pg, "SELECT url_id, tier_id, tier_source FROM core.project_pages WHERE project_id = $1", project
    )
    return {row["url_id"]: (row["tier_id"], row["tier_source"]) for row in rows}


async def test_an_editor_sets_a_tier_on_selected_pages_and_the_flow_follows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated, workspace, project, PAGES, [SeedLink("/blog/a", "/pricing", "content")]
    )

    response = await api.put(
        project_url(workspace, project, "pages", "tiers"),
        json={"url_ids": [str(ids["/pricing"]), "999999999"], "tier_id": str(t1)},
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"matched": 1, "changed": 1}
    assert (await _tiers(migrated, project))[ids["/pricing"]] == (t1, "manual")
    flow = await fetch(
        migrated,
        "SELECT to_tier_id, links FROM seo.crawl_tier_flow WHERE run_id = $1 AND scope = 'editorial'",
        run,
    )
    assert [(row["to_tier_id"], row["links"]) for row in flow] == [(t1, 1)]
    assert len(await audit_rows(migrated, workspace, "page_tiers.changed")) == 1


async def test_a_filter_selects_every_matching_page_and_null_is_manual_untiered(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)

    response = await api.put(
        project_url(workspace, project, "pages", "tiers"),
        json={"filter": {"q": "/blog/"}, "tier_id": None},
        headers=editor.headers,
    )

    assert response.json()["data"] == {"matched": 2, "changed": 2}
    tiers = await _tiers(migrated, project)
    assert tiers == {ids["/blog/a"]: (None, "manual"), ids["/blog/b"]: (None, "manual")}


async def test_reset_to_rule_removes_the_manual_tier(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'exact', '/pricing', $3)",
        workspace.id,
        project,
        t1,
    )
    url = project_url(workspace, project, "pages", "tiers")
    await api.put(url, json={"url_ids": [str(ids["/pricing"])], "tier_id": str(t2)}, headers=editor.headers)

    response = await api.post(f"{url}/reset", json={"url_ids": [str(ids["/pricing"])]}, headers=editor.headers)

    assert response.json()["data"] == {"matched": 1, "changed": 1}
    assert (await _tiers(migrated, project))[ids["/pricing"]] == (t1, "rule")


async def test_a_tier_of_another_workspace_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    other_tier, *_ = await seed_tiers(migrated, await make_workspace(migrated, name="Other"))
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)

    response = await api.put(
        project_url(workspace, project, "pages", "tiers"),
        json={"url_ids": [str(ids["/"])], "tier_id": str(other_tier)},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")


async def test_viewers_cannot_set_tiers_and_there_must_be_a_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    body = {"url_ids": ["1"], "tier_id": str(t1)}
    url = project_url(workspace, project, "pages", "tiers")

    assert (await api.put(url, json=body, headers=viewer.headers)).status_code == 403
    assert problem(await api.put(url, json=body, headers=editor.headers)) == (404, "no_crawl")
```

`backend/tests/api/internal_links/test_tier_rules.py`:

```python
"""Tier rules: ordered, first match wins, applied to every page, with a preview (spec 5.2)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl, seed_tiers
from tests.api.keywords.support import errors, keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/services/seo", 200), ("/services/ppc", 200), ("/blog/a", 200), ("/", 200)]


async def test_rules_apply_in_order_and_a_new_first_rule_shifts_the_others(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, t3, _ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")

    first = await api.post(
        url, json={"match_type": "prefix", "value": "/services/", "tier_id": str(t1)},
        headers=editor.headers,
    )
    second = await api.post(
        url,
        json={"match_type": "exact", "value": "/services/ppc", "tier_id": str(t2), "position": 1},
        headers=editor.headers,
    )
    pattern = await api.post(
        url, json={"match_type": "pattern", "value": "/blog/*", "tier_id": str(t3)},
        headers=editor.headers,
    )
    listed = await api.get(url, headers=editor.headers)

    assert {first.status_code, second.status_code, pattern.status_code} == {201}
    assert [(rule["position"], rule["value"]) for rule in listed.json()["data"]] == [
        (1, "/services/ppc"),
        (2, "/services/"),
        (3, "/blog/*"),
    ]
    assert listed.json()["data"][0]["tier"]["code"] == "T2"
    rows = await fetch(
        migrated, "SELECT url_id, tier_id FROM core.project_pages WHERE project_id = $1", project
    )
    assert {row["url_id"]: row["tier_id"] for row in rows} == {
        ids["/services/seo"]: t1,
        ids["/services/ppc"]: t2,
        ids["/blog/a"]: t3,
    }


async def test_the_preview_counts_what_a_rule_would_decide(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")
    await api.post(
        url, json={"match_type": "exact", "value": "/services/seo", "tier_id": str(t1)},
        headers=editor.headers,
    )

    preview = await api.post(
        f"{url}/preview", json={"match_type": "prefix", "value": "/services/"}, headers=editor.headers
    )

    assert preview.json()["data"] == {"matching_pages": 2, "would_apply": 1}


async def test_deleting_a_rule_takes_its_tiers_away_and_moving_one_reorders(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")
    a = (await api.post(url, json={"match_type": "prefix", "value": "/services/", "tier_id": str(t1)}, headers=editor.headers)).json()["data"]
    b = (await api.post(url, json={"match_type": "prefix", "value": "/blog/", "tier_id": str(t2)}, headers=editor.headers)).json()["data"]

    moved = await api.patch(f"{url}/{b['rule_id']}", json={"position": 1}, headers=editor.headers)
    deleted = await api.delete(f"{url}/{a['rule_id']}", headers=editor.headers)

    assert moved.json()["data"]["position"] == 1
    assert deleted.status_code == 204
    rows = await fetch(migrated, "SELECT tier_id FROM core.project_pages WHERE project_id = $1", project)
    assert [row["tier_id"] for row in rows] == [t2]


async def test_rule_values_are_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "tier-rules"),
        json={"match_type": "exact", "value": "pricing", "tier_id": str(t1)},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("value", "starts_with_slash")]
```

`backend/tests/api/internal_links/test_tier_import.py`:

```python
"""CSV import of tiers: url and tier, pending rows, errors by line (spec 5.2)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import fetch, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import seed_crawl, seed_tiers
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_rows_apply_and_unknown_urls_are_kept_as_pending(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/", 200), ("/pricing", 200)])
    csv = (
        "url,tier\n"
        "https://example.com/pricing,T1\n"
        "https://example.com/new-page,supporting pages\n"
    )

    response = await api.post(
        project_url(workspace, project, "pages", "tiers", "import"),
        json={"csv": csv},
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["accepted"], data["applied"], data["errors"]) == (2, True, [])
    assert data["pending"] == [{"line": 3, "url": "https://example.com/new-page"}]
    rows = await fetch(
        migrated, "SELECT url_id, tier_id FROM core.project_pages WHERE project_id = $1", project
    )
    tiers = {row["url_id"]: row["tier_id"] for row in rows}
    assert tiers[ids["/pricing"]] == t1
    assert t2 in tiers.values()


async def test_any_error_applies_nothing_and_names_its_line(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, [("/pricing", 200)])
    csv = "url,tier\nhttps://example.com/pricing,T1\nhttps://example.com/x,Gold\nnot a url,T2\n"

    response = await api.post(
        project_url(workspace, project, "pages", "tiers", "import"),
        json={"csv": csv},
        headers=editor.headers,
    )

    data = response.json()["data"]
    assert data["applied"] is False
    assert [(error["line"], error["code"]) for error in data["errors"]] == [
        (3, "unknown_tier"),
        (4, "invalid_url"),
    ]
    assert await fetch(migrated, "SELECT 1 FROM core.project_pages WHERE project_id = $1", project) == []
```

`backend/tests/api/internal_links/test_page_tags.py`:

```python
"""Free tags on pages through `tag` vocabularies (spec 5.3; decision D18)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl, seed_tiers
from tests.api.keywords.support import errors, keyword_project, project_url
from tests.conftest import PostgresServer


async def _term(pg: PostgresServer, workspace_id: uuid.UUID, kind: str, name: str) -> uuid.UUID:
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) VALUES ($1, $2, $3) "
        "RETURNING id",
        workspace_id,
        kind,
        f"{name} {uuid.uuid4().hex[:6]}",
    )
    slug = name.lower().replace(" ", "-")
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3, $4, $4) RETURNING id",
        workspace_id,
        vocabulary["id"],
        name,
        slug,
    )
    term_id: uuid.UUID = term["id"]
    return term_id


async def test_tags_are_added_and_removed_in_bulk(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/a", 200), ("/b", 200)])
    launch = await _term(migrated, workspace.id, "tag", "Launch")
    url = project_url(workspace, project, "pages", "tags")
    every = [str(ids["/a"]), str(ids["/b"])]

    added = await api.put(url, json={"url_ids": every, "add": [str(launch)], "remove": []}, headers=editor.headers)
    again = await api.put(url, json={"url_ids": every, "add": [str(launch)], "remove": []}, headers=editor.headers)
    removed = await api.put(url, json={"url_ids": [str(ids["/a"])], "add": [], "remove": [str(launch)]}, headers=editor.headers)

    assert added.json()["data"] == {"matched": 2, "added": 2, "removed": 0}
    assert again.json()["data"] == {"matched": 2, "added": 0, "removed": 0}
    assert removed.json()["data"] == {"matched": 1, "added": 0, "removed": 1}
    rows = await fetch(migrated, "SELECT url_id FROM core.page_terms WHERE project_id = $1", project)
    assert [row["url_id"] for row in rows] == [ids["/b"]]


async def test_a_term_that_is_not_a_tag_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/a", 200)])
    topic = await _term(migrated, workspace.id, "topic", "Pricing")

    response = await api.put(
        project_url(workspace, project, "pages", "tags"),
        json={"url_ids": [str(ids["/a"])], "add": [str(topic)], "remove": []},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("add", "not_a_tag")]
    assert await fetch(migrated, "SELECT 1 FROM core.page_terms WHERE project_id = $1", project) == []
```

Some lines above are longer than 100 characters; `ruff format` wraps them (none of them is a long string).

- [ ] **Step 5: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/internal_links -q -k "page_tiers or tier_rules or tier_import or page_tags"`
Expected: failures with `404` on the unknown routes.

- [ ] **Step 6: Append the schemas**

Append to `backend/src/idraft/api/schemas/internal_links.py` (`Literal` joins the `typing` import):

```python
StatusClass = Literal["2xx", "3xx", "4xx", "5xx"]
PageFlag = Literal[
    "orphan", "editorial_orphan", "deep_only_through_auto", "placement_unknown", "has_broken_outlinks"
]
PageWorklist = Literal["under_linked_t1", "orphans", "editorial_orphans", "deep_only_through_auto"]
UrlId = Annotated[int, Field(gt=0, le=9_223_372_036_854_775_807)]
BULK_IDS_MAX: Final = 5_000
BULK_MATCH_MAX: Final = 20_000
TERMS_MAX: Final = 50
CSV_MAX: Final = 900_000
CSV_ROWS_MAX: Final = 20_000


class PageFilter(Body):
    """The Pages list's filters as a bulk body (`run` is always the latest crawl)."""

    tier_ids: Annotated[list[UUID | Literal["none"]], Field(max_length=9)] | None = None
    tag_ids: Annotated[list[UUID], Field(max_length=TERMS_MAX)] | None = None
    status: Annotated[list[StatusClass], Field(max_length=4)] | None = None
    indexable: bool | None = None
    flags: Annotated[list[PageFlag], Field(max_length=5)] | None = None
    worklist: PageWorklist | None = None
    q: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None


class PageSelection(Body):
    """Exactly one of `url_ids` and `filter`."""

    url_ids: Annotated[list[UrlId], Field(min_length=1, max_length=BULK_IDS_MAX)] | None = None
    filter: PageFilter | None = None

    @model_validator(mode="after")
    def _one_way(self) -> PageSelection:
        if (self.url_ids is None) == (self.filter is None):
            raise ValueError("give exactly one of `url_ids` and `filter`")
        return self


class PageTierSet(PageSelection):
    tier_id: UUID | None = Field(description="null sets the pages to Untiered by hand.")


class BulkResult(BaseModel):
    matched: int = Field(description="Pages of the latest crawl the selection named.")
    changed: int


class BulkResponse(BaseModel):
    data: BulkResult


class TierImportRequest(Body):
    csv: Annotated[str, StringConstraints(min_length=1, max_length=CSV_MAX)] = Field(
        description="Columns `url` and `tier` (a code such as T1, a name, or `none`)."
    )


class ImportPending(BaseModel):
    line: int
    url: str


class ImportProblem(BaseModel):
    line: int
    code: Literal["invalid_url", "other_site", "unknown_tier", "missing_column", "too_many_rows"]
    message: str


class TierImportResult(BaseModel):
    accepted: int
    pending: list[ImportPending] = Field(
        description="Valid rows whose URL the latest crawl did not find; they apply when a "
        "crawl finds it."
    )
    errors: list[ImportProblem]
    applied: bool = Field(description="False while `errors` is not empty: nothing was changed.")


class TierImportResponse(BaseModel):
    data: TierImportResult


MatchTypeName = Literal["exact", "prefix", "pattern"]
RuleValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
RulePosition = Annotated[int, Field(ge=1, le=500)]


class TierRuleView(BaseModel):
    rule_id: UUID
    position: int
    match_type: MatchTypeName
    value: str
    tier: TierRef
    created_at: datetime


class TierRuleList(BaseModel):
    data: list[TierRuleView]


class TierRuleResponse(BaseModel):
    data: TierRuleView


class TierRuleCreate(Body):
    match_type: MatchTypeName
    value: RuleValue
    tier_id: UUID
    position: RulePosition | None = Field(default=None, description="Left out, the rule goes last.")


class TierRulePatch(Patch):
    match_type: MatchTypeName | None = None
    value: RuleValue | None = None
    tier_id: UUID | None = None
    position: RulePosition | None = None

    @model_validator(mode="after")
    def _says_something(self) -> TierRulePatch:
        if not self.model_fields_set:
            raise ValueError("give at least one member")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("members of a rule cannot be null")
        return self


class TierRulePreviewRequest(Body):
    match_type: MatchTypeName
    value: RuleValue
    position: RulePosition | None = None
    rule_id: UUID | None = Field(default=None, description="The rule being edited, if any.")


class TierRulePreview(BaseModel):
    matching_pages: int = Field(description="Pages of the latest crawl whose path matches.")
    would_apply: int = Field(
        description="Of those, the pages with no manual tier that no earlier rule claims."
    )


class TierRulePreviewResponse(BaseModel):
    data: TierRulePreview


class PageTagChange(PageSelection):
    add: Annotated[list[UUID], Field(max_length=TERMS_MAX)]
    remove: Annotated[list[UUID], Field(max_length=TERMS_MAX)]


class TagChangeResult(BaseModel):
    matched: int
    added: int
    removed: int


class TagChangeResponse(BaseModel):
    data: TagChangeResult
```

`Final` joins the `typing` import.

- [ ] **Step 7: The page filter**

`backend/src/idraft/api/internal_links/page_filter.py`:

```python
"""The Pages filter as SQL (API contract; reused by the bulk bodies and the read routes).

The rows are a crawl's pages, with their URL and, outer-joined, the project's tier row:
`crawl_pages AS cp`, `urls AS u`, `project_pages AS pp`. Every condition here is on those
three.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import ColumnElement, Join, and_, exists, false, or_, select

from idraft.api.schemas.internal_links import PageFilter
from idraft.db.tables import crawl_pages, page_terms, page_tier_levels, project_pages, urls

_STATUS: Final = {"2xx": (200, 299), "3xx": (300, 399), "4xx": (400, 499), "5xx": (500, 599)}
_FLAGS: Final = {
    "orphan": crawl_pages.c.is_orphan,
    "editorial_orphan": crawl_pages.c.is_editorial_orphan,
    "deep_only_through_auto": crawl_pages.c.deep_only_through_auto,
    "placement_unknown": crawl_pages.c.links_state == "from_provider",
    "has_broken_outlinks": crawl_pages.c.broken_outlinks > 0,
}
# Under-linked T1 pages (spec 7.2): fewer than 3 editorial linking pages, deeper than 3 clicks,
# or in the lowest quarter of equity share.
UNDER_LINKED_PAGES: Final = 3
UNDER_LINKED_DEPTH: Final = 3


@dataclass(frozen=True, slots=True)
class PageScope:
    workspace_id: UUID
    project_id: UUID
    run_id: UUID
    # The crawl's 25th percentile of equity share among its 200 pages (`crawl_runs.equity_p25`).
    equity_p25: float | None


def page_rows(scope: PageScope) -> Join:
    return crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id).outerjoin(
        project_pages,
        and_(
            project_pages.c.workspace_id == scope.workspace_id,
            project_pages.c.project_id == scope.project_id,
            project_pages.c.url_id == crawl_pages.c.url_id,
        ),
    )


def tier_of_position(scope: PageScope, position: int) -> ColumnElement[UUID]:
    return (
        select(page_tier_levels.c.id)
        .where(
            page_tier_levels.c.workspace_id == scope.workspace_id,
            page_tier_levels.c.position == position,
        )
        .scalar_subquery()
    )


def _contains(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def page_conditions(found: PageFilter, scope: PageScope) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [
        crawl_pages.c.workspace_id == scope.workspace_id,
        crawl_pages.c.run_id == scope.run_id,
    ]
    if found.tier_ids is not None:
        ids = [tier for tier in found.tier_ids if isinstance(tier, UUID)]
        either: list[ColumnElement[bool]] = [project_pages.c.tier_id.in_(ids)] if ids else []
        if "none" in found.tier_ids:
            either.append(project_pages.c.tier_id.is_(None))
        conditions.append(or_(*either) if either else false())
    if found.tag_ids:
        conditions.append(
            exists().where(
                page_terms.c.workspace_id == scope.workspace_id,
                page_terms.c.project_id == scope.project_id,
                page_terms.c.url_id == crawl_pages.c.url_id,
                page_terms.c.term_id.in_(found.tag_ids),
            )
        )
    if found.status:
        conditions.append(
            or_(*(crawl_pages.c.status_code.between(*_STATUS[name]) for name in found.status))
        )
    if found.indexable is not None:
        conditions.append(crawl_pages.c.is_indexable.is_(found.indexable))
    for flag in found.flags or ():
        conditions.append(_FLAGS[flag])
    if found.worklist == "under_linked_t1":
        weak = [
            crawl_pages.c.linking_pages_editorial < UNDER_LINKED_PAGES,
            crawl_pages.c.click_depth > UNDER_LINKED_DEPTH,
        ]
        if scope.equity_p25 is not None:
            weak.append(crawl_pages.c.equity_share <= scope.equity_p25)
        conditions += [project_pages.c.tier_id == tier_of_position(scope, 1), or_(*weak)]
    elif found.worklist == "orphans":
        conditions.append(crawl_pages.c.is_orphan)
    elif found.worklist == "editorial_orphans":
        conditions.append(crawl_pages.c.is_editorial_orphan)
    elif found.worklist == "deep_only_through_auto":
        conditions.append(crawl_pages.c.deep_only_through_auto)
    if found.q is not None:
        conditions.append(urls.c.path.ilike(_contains(found.q), escape="\\"))
    return conditions

```

- [ ] **Step 8: The service**

`backend/src/idraft/api/internal_links/page_tiers.py`:

```python
"""Tiers and tags on a project's pages, and its tier rules (spec 5.2 and 5.3; decisions D16 and
D18). Every write locks the project row first, so two at once do not interleave, re-applies
the rules where they may have changed, recomputes the latest crawl's tier flow, and is audited.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import UUID

from sqlalchemy import case, delete, func, insert, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.page_filter import PageScope, page_conditions, page_rows
from idraft.api.internal_links.problems import NoCrawlError
from idraft.api.problems import NotFoundError, TooManySubjectsError, invalid_field
from idraft.api.projects import repository as project_repository
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import (
    BULK_MATCH_MAX,
    CSV_ROWS_MAX,
    ImportPending,
    ImportProblem,
    MatchTypeName,
    PageSelection,
    PageTagChange,
    PageTierSet,
    TierImportResult,
    TierRuleCreate,
    TierRulePatch,
    TierRulePreview,
    TierRulePreviewRequest,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.crawl_store import apply_rules, latest_run, project_rules, tiers_changed
from idraft.crawl.hosts import site_hosts
from idraft.crawl.tiers import MatchType, TierRule, check_rule_value, first_match, rule_matches
from idraft.db import dictionaries
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    crawl_pages,
    crawl_runs,
    page_terms,
    page_tier_levels,
    project_pages,
    projects,
    taxonomy_terms,
    taxonomy_vocabularies,
    tier_rules,
    urls,
)
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize


@dataclass(frozen=True, slots=True)
class RuleRecord:
    rule_id: UUID
    position: int
    match_type: MatchTypeName
    value: str
    tier_id: UUID
    tier_position: int
    tier_name: str
    created_at: datetime


async def crawl_scope(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, run: UUID | None
) -> PageScope:
    """The crawl a read or a bulk change is about: `run`, or the latest finished one."""
    run_id = run if run is not None else await latest_run(db, access.workspace_id, project_id)
    if run_id is None:
        raise NoCrawlError
    row = (
        await db.execute(
            select(crawl_runs.c.equity_p25, crawl_runs.c.state).where(
                crawl_runs.c.workspace_id == access.workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_runs.c.id == run_id,
            )
        )
    ).one_or_none()
    if row is None or row.state not in ("ready", "stopped_at_ceiling"):
        raise NotFoundError
    return PageScope(access.workspace_id, project_id, run_id, row.equity_p25)


async def select_pages(db: AsyncSession, scope: PageScope, selection: PageSelection) -> list[int]:
    """The latest crawl's pages a bulk body names: its ids that are in the crawl, or every page
    the filter matches (`422 too_many_subjects` over 20,000)."""
    statement = select(crawl_pages.c.url_id).select_from(page_rows(scope))
    if selection.url_ids is not None:
        statement = statement.where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id.in_(selection.url_ids),
        )
    else:
        assert selection.filter is not None
        statement = statement.where(*page_conditions(selection.filter, scope))
    found = list((await db.execute(statement.limit(BULK_MATCH_MAX + 1))).scalars())
    if len(found) > BULK_MATCH_MAX:
        raise TooManySubjectsError(limit=BULK_MATCH_MAX)
    return found


async def _tier_ids(db: AsyncSession, workspace_id: UUID) -> dict[UUID, tuple[int, str]]:
    rows = await db.execute(
        select(page_tier_levels.c.id, page_tier_levels.c.position, page_tier_levels.c.name).where(
            page_tier_levels.c.workspace_id == workspace_id
        )
    )
    return {row.id: (row.position, row.name) for row in rows}


async def _check_tier(db: AsyncSession, workspace_id: UUID, tier_id: UUID | None) -> None:
    if tier_id is not None and tier_id not in await _tier_ids(db, workspace_id):
        raise invalid_field("tier_id", code="tier_unknown", message="No such tier in the workspace.")


async def _set_manual(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    url_ids: Sequence[int],
    tier_id: UUID | None,
) -> int:
    """Manual rows for these URLs; returns how many were added or changed."""
    changed = 0
    for start in range(0, len(url_ids), 5_000):
        statement = upsert(project_pages).values(
            [
                {
                    "project_id": project_id,
                    "url_id": url_id,
                    "workspace_id": access.workspace_id,
                    "tier_id": tier_id,
                    "tier_source": "manual",
                    "set_by": access.user_id,
                }
                for url_id in url_ids[start : start + 5_000]
            ]
        )
        statement = statement.on_conflict_do_update(
            index_elements=[project_pages.c.project_id, project_pages.c.url_id],
            set_={
                "tier_id": statement.excluded.tier_id,
                "tier_source": "manual",
                "rule_id": None,
                "set_by": statement.excluded.set_by,
                "set_at": func.now(),
            },
            where=(project_pages.c.tier_source != "manual")
            | project_pages.c.tier_id.is_distinct_from(statement.excluded.tier_id),
        )
        result = await db.execute(statement.returning(project_pages.c.url_id))
        changed += len(result.all())
    return changed
```

The rest of `page_tiers.py`:

```python
_RULE_MESSAGES = {
    "starts_with_slash": "A rule matches a path, which starts with `/`.",
    "too_long": "At most 500 characters.",
    "star_in_exact": "`*` is for pattern rules; an exact rule matches one path.",
    "star_in_prefix": "`*` is for pattern rules; a prefix rule matches the start of a path.",
    "too_many_stars": "At most 10 `*` in a pattern.",
}
RULES_MAX = 500
_CLOSE_POSITIONS = text(
    """
    UPDATE core.tier_rules r SET position = o.n
    FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY position) AS n
          FROM core.tier_rules WHERE workspace_id = :workspace_id AND project_id = :project_id) o
    WHERE r.id = o.id AND r.position <> o.n
    """
)


def _check_value(match_type: str, value: str) -> None:
    problem = check_rule_value(MatchType(match_type), value)
    if problem is not None:
        raise invalid_field("value", code=problem, message=_RULE_MESSAGES[problem])


async def close_rule_positions(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> None:
    """Positions 1 to N again after rules were removed."""
    await db.execute(_CLOSE_POSITIONS, {"workspace_id": workspace_id, "project_id": project_id})


async def rule_records(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[RuleRecord]:
    rows = await db.execute(
        select(
            tier_rules,
            page_tier_levels.c.position.label("tier_position"),
            page_tier_levels.c.name.label("tier_name"),
        )
        .join(page_tier_levels, page_tier_levels.c.id == tier_rules.c.tier_id)
        .where(tier_rules.c.workspace_id == workspace_id, tier_rules.c.project_id == project_id)
        .order_by(tier_rules.c.position)
    )
    return [
        RuleRecord(
            rule_id=row.id,
            position=row.position,
            match_type=cast(MatchTypeName, row.match_type),
            value=row.value,
            tier_id=row.tier_id,
            tier_position=row.tier_position,
            tier_name=row.tier_name,
            created_at=row.created_at,
        )
        for row in rows
    ]


async def _site_hosts(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> frozenset[str]:
    project = await project_repository.get_project(db, workspace_id, project_id)
    if project is None:
        raise NotFoundError
    if project.primary_host is None:
        return frozenset()
    settings = (
        await db.execute(
            select(projects.c.settings).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one()
    allowed = (settings or {}).get("internal_links", {}).get("allowed_subdomains", [])
    return site_hosts(project.primary_host, allowed)


def _tier_names(tiers: dict[UUID, tuple[int, str]]) -> dict[str, UUID | None]:
    """What a CSV `tier` cell may say, lower case: a code, a name, a label, or Untiered."""
    names: dict[str, UUID | None] = {"none": None, "untiered": None}
    for tier_id, (position, name) in tiers.items():
        for spelling in (f"t{position}", name.lower(), f"t{position} {name.lower()}"):
            names[spelling] = tier_id
    return names


def parse_tier_csv(
    text_in: str, tiers: dict[UUID, tuple[int, str]], hosts: frozenset[str]
) -> tuple[list[tuple[int, CanonicalUrl, UUID | None]], list[ImportProblem]]:
    """Rows as (line, URL, tier), the last row of a URL winning, and the problems by line."""
    reader = csv.reader(io.StringIO(text_in))
    header = [cell.strip().lower() for cell in next(reader, [])]
    if "url" not in header or "tier" not in header:
        return [], [
            ImportProblem(
                line=1, code="missing_column", message="The first line names `url` and `tier`."
            )
        ]
    names = _tier_names(tiers)
    rows: dict[bytes, tuple[int, CanonicalUrl, UUID | None]] = {}
    problems: list[ImportProblem] = []
    for line, record in enumerate(reader, start=2):
        if not any(cell.strip() for cell in record):
            continue
        if len(rows) + len(problems) >= CSV_ROWS_MAX:
            problems.append(
                ImportProblem(line=line, code="too_many_rows", message=f"At most {CSV_ROWS_MAX} rows.")
            )
            break
        cells = dict(zip(header, record, strict=False))
        tier_text = " ".join((cells.get("tier") or "").split()).lower()
        try:
            url = canonicalize((cells.get("url") or "").strip())
        except UrlRejectedError:
            problems.append(
                ImportProblem(line=line, code="invalid_url", message="Not an http or https URL.")
            )
            continue
        if url.host.name not in hosts:
            problems.append(
                ImportProblem(line=line, code="other_site", message="Not a page of this site.")
            )
            continue
        if tier_text not in names:
            problems.append(
                ImportProblem(
                    line=line, code="unknown_tier", message=f"No tier is called {tier_text!r}."
                )
            )
            continue
        rows[url.url_hash] = (line, url, names[tier_text])
    return sorted(rows.values(), key=lambda row: row[0]), problems


class PageTierService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def _audit(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        info: RequestInfo,
        after: audit.Snapshot,
    ) -> None:
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action="page_tiers.changed",
            target_type="project",
            target_id=project_id,
            info=info,
            after=after,
        )

    async def set_tiers(
        self, access: WorkspaceAccess, project_id: UUID, body: PageTierSet, info: RequestInfo
    ) -> tuple[int, int]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await crawl_scope(db, access, project_id, None)
            await _check_tier(db, access.workspace_id, body.tier_id)
            ids = await select_pages(db, scope, body)
            changed = await _set_manual(db, access, project_id, ids, body.tier_id)
            await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
            await self._audit(
                db,
                access,
                project_id,
                info,
                {
                    "tier_id": None if body.tier_id is None else str(body.tier_id),
                    "pages": len(ids),
                    "changed": changed,
                },
            )
            return len(ids), changed

    async def reset(
        self, access: WorkspaceAccess, project_id: UUID, body: PageSelection, info: RequestInfo
    ) -> tuple[int, int]:
        """Manual tiers go; the rules decide again."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await crawl_scope(db, access, project_id, None)
            ids = await select_pages(db, scope, body)
            removed = 0
            for start in range(0, len(ids), 5_000):
                result = await db.execute(
                    delete(project_pages)
                    .where(
                        project_pages.c.workspace_id == access.workspace_id,
                        project_pages.c.project_id == project_id,
                        project_pages.c.url_id.in_(ids[start : start + 5_000]),
                        project_pages.c.tier_source == "manual",
                    )
                    .returning(project_pages.c.url_id)
                )
                removed += len(result.all())
            await apply_rules(db, workspace_id=access.workspace_id, project_id=project_id)
            await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
            await self._audit(db, access, project_id, info, {"reset": len(ids), "changed": removed})
            return len(ids), removed

    async def import_tiers(
        self, access: WorkspaceAccess, project_id: UUID, csv_text: str, info: RequestInfo
    ) -> TierImportResult:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            hosts = await _site_hosts(db, access.workspace_id, project_id)
            rows, problems = parse_tier_csv(
                csv_text, await _tier_ids(db, access.workspace_id), hosts
            )
            if problems:
                return TierImportResult(accepted=len(rows), pending=[], errors=problems, applied=False)
            found = await dictionaries.urls_for(db, [url for _, url, _ in rows])
            run_id = await latest_run(db, access.workspace_id, project_id)
            crawled: set[int] = set()
            if run_id is not None:
                crawled = set(
                    (
                        await db.execute(
                            select(crawl_pages.c.url_id).where(
                                crawl_pages.c.workspace_id == access.workspace_id,
                                crawl_pages.c.run_id == run_id,
                            )
                        )
                    ).scalars()
                )
            by_tier: dict[UUID | None, list[int]] = {}
            pending = []
            for line, url, tier_id in rows:
                url_id = found[url.url_hash].id
                by_tier.setdefault(tier_id, []).append(url_id)
                if url_id not in crawled:
                    pending.append(ImportPending(line=line, url=url.url))
            for tier_id, ids in by_tier.items():
                await _set_manual(db, access, project_id, ids, tier_id)
            await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
            await self._audit(
                db, access, project_id, info, {"source": "csv", "pages": len(rows)}
            )
            return TierImportResult(accepted=len(rows), pending=pending, errors=[], applied=True)

    async def change_tags(
        self, access: WorkspaceAccess, project_id: UUID, body: PageTagChange, info: RequestInfo
    ) -> tuple[int, int, int]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await crawl_scope(db, access, project_id, None)
            wanted = set(body.add) | set(body.remove)
            tags = set(
                (
                    await db.execute(
                        select(taxonomy_terms.c.id)
                        .join(
                            taxonomy_vocabularies,
                            taxonomy_vocabularies.c.id == taxonomy_terms.c.vocabulary_id,
                        )
                        .where(
                            taxonomy_terms.c.id.in_(sorted(wanted)),
                            taxonomy_vocabularies.c.workspace_id == access.workspace_id,
                            taxonomy_vocabularies.c.kind == "tag",
                            or_(
                                taxonomy_vocabularies.c.project_id.is_(None),
                                taxonomy_vocabularies.c.project_id == project_id,
                            ),
                        )
                    )
                ).scalars()
            ) if wanted else set()
            if wanted - tags:
                field = "add" if set(body.add) - tags else "remove"
                raise invalid_field(
                    field, code="not_a_tag", message="Only terms of a tag vocabulary tag pages."
                )
            ids = await select_pages(db, scope, body)
            added = removed = 0
            pairs = [(url_id, term_id) for url_id in ids for term_id in body.add]
            for start in range(0, len(pairs), 5_000):
                result = await db.execute(
                    upsert(page_terms)
                    .values(
                        [
                            {
                                "project_id": project_id,
                                "url_id": url_id,
                                "term_id": term_id,
                                "workspace_id": access.workspace_id,
                            }
                            for url_id, term_id in pairs[start : start + 5_000]
                        ]
                    )
                    .on_conflict_do_nothing()
                    .returning(page_terms.c.url_id)
                )
                added += len(result.all())
            if body.remove:
                for start in range(0, len(ids), 5_000):
                    result = await db.execute(
                        delete(page_terms)
                        .where(
                            page_terms.c.workspace_id == access.workspace_id,
                            page_terms.c.project_id == project_id,
                            page_terms.c.url_id.in_(ids[start : start + 5_000]),
                            page_terms.c.term_id.in_(body.remove),
                        )
                        .returning(page_terms.c.url_id)
                    )
                    removed += len(result.all())
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_tags.changed",
                target_type="project",
                target_id=project_id,
                info=info,
                after={
                    "add": [str(term) for term in body.add],
                    "remove": [str(term) for term in body.remove],
                    "pages": len(ids),
                },
            )
            return len(ids), added, removed

    async def list_rules(self, access: WorkspaceAccess, project_id: UUID) -> list[RuleRecord]:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            return await rule_records(db, access.workspace_id, project_id)

    async def _rule_changed(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        rule_id: UUID,
        action: audit.AuditAction,
        info: RequestInfo,
        before: audit.Snapshot | None,
        after: audit.Snapshot | None,
    ) -> None:
        await apply_rules(db, workspace_id=access.workspace_id, project_id=project_id)
        await tiers_changed(db, workspace_id=access.workspace_id, project_id=project_id)
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action=action,
            target_type="tier_rule",
            target_id=rule_id,
            info=info,
            before=before,
            after=after,
        )

    async def create_rule(
        self, access: WorkspaceAccess, project_id: UUID, body: TierRuleCreate, info: RequestInfo
    ) -> RuleRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            _check_value(body.match_type, body.value)
            await _check_tier(db, access.workspace_id, body.tier_id)
            rules = await rule_records(db, access.workspace_id, project_id)
            if len(rules) >= RULES_MAX:
                raise invalid_field("position", code="rule_limit", message="At most 500 rules.")
            position = min(body.position or len(rules) + 1, len(rules) + 1)
            await db.execute(
                update(tier_rules)
                .where(
                    tier_rules.c.workspace_id == access.workspace_id,
                    tier_rules.c.project_id == project_id,
                    tier_rules.c.position >= position,
                )
                .values(position=tier_rules.c.position + 1)
            )
            rule_id: UUID = (
                await db.execute(
                    insert(tier_rules)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        position=position,
                        match_type=body.match_type,
                        value=body.value,
                        tier_id=body.tier_id,
                        created_by=access.user_id,
                    )
                    .returning(tier_rules.c.id)
                )
            ).scalar_one()
            after = {"match_type": body.match_type, "value": body.value, "position": position}
            await self._rule_changed(
                db, access, project_id, rule_id, "tier_rule.created", info, None, after
            )
            return next(
                rule for rule in await rule_records(db, access.workspace_id, project_id)
                if rule.rule_id == rule_id
            )

    async def update_rule(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        rule_id: UUID,
        body: TierRulePatch,
        info: RequestInfo,
    ) -> RuleRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            rules = await rule_records(db, access.workspace_id, project_id)
            rule = next((found for found in rules if found.rule_id == rule_id), None)
            if rule is None:
                raise NotFoundError
            changes = body.model_dump(exclude_unset=True)
            _check_value(changes.get("match_type", rule.match_type), changes.get("value", rule.value))
            if "tier_id" in changes:
                await _check_tier(db, access.workspace_id, changes["tier_id"])
            old = rule.position
            new = min(changes.pop("position", old), len(rules))
            # One statement, so the deferrable position key is checked once, after the move.
            await db.execute(
                update(tier_rules)
                .where(
                    tier_rules.c.workspace_id == access.workspace_id,
                    tier_rules.c.project_id == project_id,
                )
                .values(
                    position=case(
                        (tier_rules.c.id == rule_id, new),
                        (
                            (tier_rules.c.position >= new) & (tier_rules.c.position < old),
                            tier_rules.c.position + 1,
                        ),
                        (
                            (tier_rules.c.position > old) & (tier_rules.c.position <= new),
                            tier_rules.c.position - 1,
                        ),
                        else_=tier_rules.c.position,
                    )
                )
            )
            if changes:
                await db.execute(
                    update(tier_rules)
                    .where(tier_rules.c.workspace_id == access.workspace_id, tier_rules.c.id == rule_id)
                    .values(**changes)
                )
            await self._rule_changed(
                db,
                access,
                project_id,
                rule_id,
                "tier_rule.updated",
                info,
                {"match_type": rule.match_type, "value": rule.value, "position": old},
                {
                    "match_type": changes.get("match_type", rule.match_type),
                    "value": changes.get("value", rule.value),
                    "position": new,
                },
            )
            return next(
                found for found in await rule_records(db, access.workspace_id, project_id)
                if found.rule_id == rule_id
            )

    async def delete_rule(
        self, access: WorkspaceAccess, project_id: UUID, rule_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            gone = (
                await db.execute(
                    delete(tier_rules)
                    .where(
                        tier_rules.c.workspace_id == access.workspace_id,
                        tier_rules.c.project_id == project_id,
                        tier_rules.c.id == rule_id,
                    )
                    .returning(tier_rules.c.match_type, tier_rules.c.value)
                )
            ).one_or_none()
            if gone is None:
                raise NotFoundError
            await close_rule_positions(db, access.workspace_id, project_id)
            await self._rule_changed(
                db,
                access,
                project_id,
                rule_id,
                "tier_rule.deleted",
                info,
                {"match_type": gone.match_type, "value": gone.value},
                None,
            )

    async def preview_rule(
        self, access: WorkspaceAccess, project_id: UUID, body: TierRulePreviewRequest
    ) -> TierRulePreview:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            _check_value(body.match_type, body.value)
            scope = await crawl_scope(db, access, project_id, None)
            others = sorted(
                (
                    rule
                    for rule in await project_rules(db, access.workspace_id, project_id)
                    if rule.rule_id != body.rule_id
                ),
                key=lambda rule: rule.position,
            )
            candidate = TierRule(
                rule_id=body.rule_id or UUID(int=0),
                position=0,
                match_type=MatchType(body.match_type),
                value=body.value,
                tier_id=UUID(int=0),
            )
            at = min((body.position or len(others) + 1) - 1, len(others))
            ordered = [*others[:at], candidate, *others[at:]]
            ordered = [
                TierRule(rule.rule_id, position, rule.match_type, rule.value, rule.tier_id)
                for position, rule in enumerate(ordered, start=1)
            ]
            chosen = ordered[at]
            rows = await db.execute(
                select(urls.c.path, project_pages.c.tier_source)
                .select_from(page_rows(scope))
                .where(crawl_pages.c.workspace_id == scope.workspace_id, crawl_pages.c.run_id == scope.run_id)
            )
            matching = would = 0
            for row in rows:
                if not rule_matches(chosen, row.path):
                    continue
                matching += 1
                if row.tier_source != "manual" and first_match(ordered, row.path) == chosen:
                    would += 1
            return TierRulePreview(matching_pages=matching, would_apply=would)
```

- [ ] **Step 9: The host rule**

`backend/src/idraft/crawl/hosts.py` (used by the CSV import here and by Task 8):

```python
"""Which hosts are the project's site (plan decision D7): the website's host with and without
`www.`, plus the allowed subdomains of the project settings."""

from __future__ import annotations

from collections.abc import Sequence


def site_hosts(host: str, allowed_subdomains: Sequence[str]) -> frozenset[str]:
    bare = host.lower().removeprefix("www.")
    return frozenset({bare, f"www.{bare}", *(name.lower() for name in allowed_subdomains)})
```

`backend/tests/crawl/test_hosts.py`:

```python
from idraft.crawl.hosts import site_hosts


def test_the_site_is_its_host_with_and_without_www_and_the_allowed_subdomains() -> None:
    assert site_hosts("www.Example.com", ["Blog.example.com"]) == {
        "example.com",
        "www.example.com",
        "blog.example.com",
    }
```

- [ ] **Step 10: The routes**

`backend/src/idraft/api/internal_links/page_tier_routes.py`:

```python
"""Tiers, rules and tags of a project's pages (spec 5.2 and 5.3). Reading needs `data:read`;
changing needs `projects:write` (decision D15)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from idraft.api.internal_links.page_tiers import PageTierService, RuleRecord
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import (
    BulkResponse,
    BulkResult,
    PageSelection,
    PageTagChange,
    PageTierSet,
    TagChangeResponse,
    TagChangeResult,
    TierImportRequest,
    TierImportResponse,
    TierRef,
    TierRuleCreate,
    TierRuleList,
    TierRulePatch,
    TierRulePreviewRequest,
    TierRulePreviewResponse,
    TierRuleResponse,
    TierRuleView,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.crawl.tiers import tier_code

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["internal-links"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_page_tiers(resources: Annotated[Resources, Depends(get_resources)]) -> PageTierService:
    return resources.page_tiers


PageTiers = Annotated[PageTierService, Depends(get_page_tiers)]


def rule_view(rule: RuleRecord) -> TierRuleView:
    return TierRuleView(
        rule_id=rule.rule_id,
        position=rule.position,
        match_type=rule.match_type,
        value=rule.value,
        tier=TierRef(tier_id=rule.tier_id, code=tier_code(rule.tier_position), name=rule.tier_name),
        created_at=rule.created_at,
    )


@router.put(
    "/pages/tiers",
    summary="Set or clear a tier on pages of the latest crawl",
    description="`url_ids` (up to 5,000) or `filter` (the Pages filters; `422 "
    "too_many_subjects` over 20,000). `tier_id: null` sets Untiered by hand, which beats every "
    "rule; `POST .../pages/tiers/reset` gives the pages back to their rules. `404 no_crawl` "
    "before the first finished crawl.",
)
async def set_page_tiers(
    project_id: UUID, body: PageTierSet, access: WriteProject, service: PageTiers, info: Info
) -> BulkResponse:
    matched, changed = await service.set_tiers(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))


@router.post("/pages/tiers/reset", summary="Give pages back to their rule tier")
async def reset_page_tiers(
    project_id: UUID, body: PageSelection, access: WriteProject, service: PageTiers, info: Info
) -> BulkResponse:
    matched, changed = await service.reset(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))


@router.post(
    "/pages/tiers/import",
    summary="Set tiers from a CSV of url and tier",
    description="`tier` is a code (T1), a name, `T1 Money pages`, or `none`. A URL the latest "
    "crawl did not find is stored and listed in `pending`; it applies when a crawl finds it. "
    "While any row has an error (`errors`, by line) nothing is changed and `applied` is false.",
)
async def import_page_tiers(
    project_id: UUID, body: TierImportRequest, access: WriteProject, service: PageTiers, info: Info
) -> TierImportResponse:
    return TierImportResponse(data=await service.import_tiers(access, project_id, body.csv, info))


@router.put(
    "/pages/tags",
    summary="Add and remove tags on pages of the latest crawl",
    description="Terms of the project's or the workspace's `tag` vocabularies; any other term "
    "is `422 validation_failed` with `not_a_tag`. Adding a tag a page has, or removing one it "
    "has not, changes nothing.",
)
async def change_page_tags(
    project_id: UUID, body: PageTagChange, access: WriteProject, service: PageTiers, info: Info
) -> TagChangeResponse:
    matched, added, removed = await service.change_tags(access, project_id, body, info)
    return TagChangeResponse(data=TagChangeResult(matched=matched, added=added, removed=removed))


@router.get("/tier-rules", summary="The project's tier rules, first rule first")
async def list_tier_rules(project_id: UUID, access: ReadData, service: PageTiers) -> TierRuleList:
    return TierRuleList(data=[rule_view(rule) for rule in await service.list_rules(access, project_id)])


@router.post(
    "/tier-rules",
    status_code=201,
    summary="Add a tier rule",
    description="`exact` (the path, a trailing slash aside), `prefix` (the path starts with it) "
    "or `pattern` (`*` is any run of characters). Left without `position` it goes last; with "
    "one, the rules from there move down. The rules apply to every page at once.",
)
async def create_tier_rule(
    project_id: UUID, body: TierRuleCreate, access: WriteProject, service: PageTiers, info: Info
) -> TierRuleResponse:
    return TierRuleResponse(data=rule_view(await service.create_rule(access, project_id, body, info)))


@router.patch("/tier-rules/{rule_id}", summary="Change or move a tier rule")
async def update_tier_rule(
    project_id: UUID,
    rule_id: UUID,
    body: TierRulePatch,
    access: WriteProject,
    service: PageTiers,
    info: Info,
) -> TierRuleResponse:
    record = await service.update_rule(access, project_id, rule_id, body, info)
    return TierRuleResponse(data=rule_view(record))


@router.delete("/tier-rules/{rule_id}", status_code=204, summary="Delete a tier rule")
async def delete_tier_rule(
    project_id: UUID, rule_id: UUID, access: WriteProject, service: PageTiers, info: Info
) -> Response:
    await service.delete_rule(access, project_id, rule_id, info)
    return Response(status_code=204)


@router.post(
    "/tier-rules/preview",
    summary="How many pages a rule would match and decide",
    description="Counts on the latest crawl, as if the rule stood at `position` (last when left "
    "out) among the others; `rule_id` is the rule being edited, left out of the others.",
)
async def preview_tier_rule(
    project_id: UUID, body: TierRulePreviewRequest, access: ReadData, service: PageTiers
) -> TierRulePreviewResponse:
    return TierRulePreviewResponse(data=await service.preview_rule(access, project_id, body))
```

- [ ] **Step 11: Tier deletion re-applies rules; wiring; route table**

In `TierLevelService.delete` (`tier_levels.py`), collect the projects the tier touches before changing anything:

```python
            touched = set(
                (
                    await db.execute(
                        select(tier_rules.c.project_id)
                        .where(tier_rules.c.workspace_id == workspace, tier_rules.c.tier_id == tier_id)
                        .union(
                            select(project_pages.c.project_id).where(
                                project_pages.c.workspace_id == workspace,
                                project_pages.c.tier_id == tier_id,
                            )
                        )
                    )
                ).scalars()
            )
```

and after the positions close up, before the audit entry:

```python
            for project_id in sorted(touched):
                await close_rule_positions(db, workspace, project_id)
                await apply_rules(db, workspace_id=workspace, project_id=project_id)
                await tiers_changed(db, workspace_id=workspace, project_id=project_id)
```

with `from idraft.api.internal_links.page_tiers import close_rule_positions` and `from idraft.collectors.crawl_store import apply_rules, tiers_changed`. The `touched` block goes right after the `move_to == tier_id` check.

`resources.py`: `page_tiers: PageTierService`; `main.py`: `page_tiers=PageTierService(sessions=sessions)` and `app.include_router(page_tier_routes_router)` after the tier level router.

`tests/api/test_route_access.py`, add:

```python
    ("PUT", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/pages/tiers"): "projects:write",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/pages/tiers/reset"): (
        "projects:write"
    ),
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/pages/tiers/import"): (
        "projects:write"
    ),
    ("PUT", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/pages/tags"): "projects:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tier-rules"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tier-rules"): (
        "projects:write"
    ),
    ("PATCH", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tier-rules/{rule_id}"): (
        "projects:write"
    ),
    ("DELETE", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tier-rules/{rule_id}"): (
        "projects:write"
    ),
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tier-rules/preview"): (
        "data:read"
    ),
```

The CSV tests need the project's website: add to `tests/api/internal_links/support.py`

```python
async def set_website(pg: PostgresServer, project_id: uuid.UUID, host: str = "example.com") -> None:
    await url_id(pg, f"https://{host}/")
    await execute(
        pg,
        "UPDATE core.projects SET primary_domain_id = (SELECT id FROM core.domains WHERE host = $1) "
        "WHERE id = $2",
        host,
        project_id,
    )
```

and call `await set_website(migrated, project)` right after `keyword_project` in both tests of `test_tier_import.py`.

- [ ] **Step 12: Run everything of this task and regenerate the contract**

```bash
uv run pytest --no-cov tests/collectors/test_crawl_store.py tests/crawl tests/api/internal_links tests/api/test_route_access.py -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest --no-cov tests/api/test_openapi.py -q
```

Expected: all pass.

- [ ] **Step 13: Gate and commit**

```bash
git add backend/src/idraft/collectors/crawl_store.py backend/src/idraft/crawl/hosts.py \
  backend/src/idraft/api/internal_links/page_filter.py backend/src/idraft/api/internal_links/page_tiers.py \
  backend/src/idraft/api/internal_links/page_tier_routes.py backend/src/idraft/api/internal_links/tier_levels.py \
  backend/src/idraft/api/schemas/internal_links.py backend/src/idraft/api/resources.py \
  backend/src/idraft/api/main.py backend/tests/api/test_route_access.py backend/openapi/v1.json \
  backend/tests/collectors/test_crawl_store.py backend/tests/crawl/test_hosts.py \
  backend/tests/api/internal_links/support.py backend/tests/api/internal_links/test_page_tiers.py \
  backend/tests/api/internal_links/test_tier_rules.py backend/tests/api/internal_links/test_tier_import.py \
  backend/tests/api/internal_links/test_page_tags.py
git commit -m "Internal links: page tiers, tier rules with preview, CSV import, tags and tier flow"
```

---

### Task 7: The On-Page adapter

**Files:**
- Create: `backend/src/idraft/providers/dataforseo/on_page.py`
- Modify: `backend/src/idraft/providers/dataforseo/client.py` (`FAMILY_LIMITS` gains `on_page`)
- Test: `backend/tests/providers/dataforseo/test_on_page.py`

The paths, request members and result fields below are from DataForSEO's public documentation, read on 2026-11-16 (`/v3/on_page/task_post`, `summary`, `pages`, `non_indexable`, `links`, `raw_html`, `force_stop`). Task 0 checks them against the spike's recorded answers.

- [ ] **Step 1: Write the failing tests**

`backend/tests/providers/dataforseo/test_on_page.py`:

```python
"""The On-Page adapter against a stand-in DataForSEO (plan 02 Task 7)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from decimal import Decimal

import httpx
import pytest

from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.client import FAMILY_LIMITS, DataForSeoClient
from idraft.providers.dataforseo.on_page import FAMILY, CrawlOrder, OnPage
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    envelope,
    task_answer,
)

TASK = "11161234-1535-0216-0000-5b2e1e3c3b86"


@pytest.fixture
def events() -> list[str]:
    return []


@pytest.fixture
def api(events: list[str]) -> Api:
    return Api(events)


@pytest.fixture
async def on_page(api: Api, events: list[str]) -> AsyncIterator[OnPage]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield OnPage(client)


def test_on_page_calls_have_their_own_limit() -> None:
    assert FAMILY in FAMILY_LIMITS


async def test_a_crawl_is_posted_with_the_settings_of_the_spec(api: Api, on_page: OnPage) -> None:
    api.answer(
        "POST",
        "/v3/on_page/task_post",
        envelope([task_answer(task_id=TASK, cost=Decimal("0.3"), status_code=20100)]),
    )

    posted = await on_page.post(
        CrawlOrder(
            host="www.example.com",
            max_crawl_pages=2000,
            enable_javascript=False,
            allowed_subdomains=("blog.example.com",),
            tag="run-1",
        )
    )

    assert (posted.task_id, posted.cost_usd) == (TASK, Decimal("0.300000"))
    assert api.posted() == [
        {
            "target": "example.com",
            "start_url": "https://www.example.com/",
            "max_crawl_pages": 2000,
            "respect_sitemap": True,
            "store_raw_html": True,
            "enable_javascript": False,
            "allow_subdomains": False,
            "allowed_subdomains": ["blog.example.com"],
            "tag": "run-1",
        }
    ]


async def test_a_post_that_may_have_arrived_is_a_timeout(api: Api, on_page: OnPage) -> None:
    def hang(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    api.on("POST", "/v3/on_page/task_post", hang)

    with pytest.raises(ProviderCallError) as raised:
        await on_page.post(
            CrawlOrder("example.com", 2000, enable_javascript=False, allowed_subdomains=(), tag="t")
        )
    assert raised.value.error.kind is ProviderErrorKind.TIMEOUT


async def test_the_summary_says_how_far_the_crawl_is(api: Api, on_page: OnPage) -> None:
    result = {
        "crawl_progress": "in_progress",
        "crawl_status": {"max_crawl_pages": 2000, "pages_in_queue": 40, "pages_crawled": 120},
        "crawl_stop_reason": None,
        "domain_info": {"extended_crawl_status": "no_errors", "checks": {"sitemap": True}},
    }
    api.answer("GET", f"/v3/on_page/summary/{TASK}", envelope([task_answer(task_id=TASK, result=[result])]))

    summary = await on_page.summary(TASK)

    assert (summary.finished, summary.pages_crawled, summary.pages_in_queue) == (False, 120, 40)
    assert (summary.has_sitemap, summary.extended_status, summary.stop_reason) == (
        True,
        "no_errors",
        None,
    )


async def test_pages_come_in_batches_with_a_token(api: Api, on_page: OnPage) -> None:
    page = {
        "resource_type": "html",
        "status_code": 200,
        "location": None,
        "url": "https://example.com/pricing",
        "meta": {"title": "Pricing", "canonical": "https://example.com/pricing"},
        "checks": {"from_sitemap": True, "is_redirect": False},
    }
    redirect = {
        "resource_type": "redirect",
        "status_code": 301,
        "location": "https://example.com/new",
        "url": "https://example.com/old",
        "meta": None,
        "checks": {"from_sitemap": False},
    }
    result = {
        "crawl_progress": "finished",
        "total_items_count": 2,
        "items_count": 2,
        "items": [page, redirect],
        "search_after_token": "abc",
    }
    api.answer("POST", "/v3/on_page/pages", envelope([task_answer(task_id=TASK, result=[result])]))

    batch = await on_page.pages(TASK, token="prev")

    assert api.posted() == [{"id": TASK, "limit": 1000, "search_after_token": "prev"}]
    assert batch.token == "abc"
    assert [(item.url, item.status_code, item.location, item.from_sitemap) for item in batch.items] == [
        ("https://example.com/pricing", 200, None, True),
        ("https://example.com/old", 301, "https://example.com/new", False),
    ]
    assert batch.items[0].title == "Pricing"


async def test_raw_html_and_its_absence(api: Api, on_page: OnPage) -> None:
    api.answer(
        "POST",
        "/v3/on_page/raw_html",
        envelope([task_answer(task_id=TASK, result=[{"items": {"html": "<html></html>"}}])]),
    )
    assert await on_page.raw_html(TASK, "https://example.com/") == "<html></html>"

    api.answer(
        "POST",
        "/v3/on_page/raw_html",
        envelope([task_answer(task_id=TASK, result=[{"items": None}])]),
    )
    assert await on_page.raw_html(TASK, "https://example.com/") is None


async def test_the_provider_links_of_one_page_keep_anchors_and_images(
    api: Api, on_page: OnPage
) -> None:
    items = [
        {"type": "anchor", "link_to": "https://example.com/a", "text": "A", "dofollow": True},
        {"type": "image", "link_to": "https://example.com/b", "text": "", "image_alt": "B", "dofollow": False},
        {"type": "canonical", "link_to": "https://example.com/", "dofollow": True},
    ]
    api.answer(
        "POST",
        "/v3/on_page/links",
        envelope([task_answer(task_id=TASK, result=[{"items": items, "total_items_count": 3}])]),
    )

    links = await on_page.links_from(TASK, "https://example.com/blog/x?page=2")

    assert api.posted()[0]["page_from"] == "/blog/x?page=2"
    assert api.posted()[0]["filters"] == ["direction", "=", "internal"]
    assert [(link.link_to, link.anchor, link.kind, link.dofollow) for link in links] == [
        ("https://example.com/a", "A", "text", True),
        ("https://example.com/b", "B", "image", False),
    ]


async def test_non_indexable_pages_and_force_stop(api: Api, on_page: OnPage) -> None:
    api.answer(
        "POST",
        "/v3/on_page/non_indexable",
        envelope(
            [
                task_answer(
                    task_id=TASK,
                    result=[
                        {
                            "total_items_count": 1,
                            "items": [{"reason": "meta_tag", "url": "https://example.com/x"}],
                        }
                    ],
                )
            ]
        ),
    )
    api.answer("POST", "/v3/on_page/force_stop", envelope([task_answer(task_id=TASK)]))

    batch = await on_page.non_indexable(TASK, offset=0)
    await on_page.force_stop(TASK)

    assert [(item.url, item.reason) for item in batch.items] == [("https://example.com/x", "meta_tag")]
    assert batch.total == 1
    assert json.loads(api.requests[-1].content) == [{"id": TASK}]


async def test_an_answer_that_is_not_what_was_asked_is_a_schema_mismatch(
    api: Api, on_page: OnPage
) -> None:
    api.answer(
        "POST",
        "/v3/on_page/pages",
        envelope([task_answer(task_id=TASK, result=[{"items": [{"status_code": "x"}]}])]),
    )

    with pytest.raises(ProviderCallError) as raised:
        await on_page.pages(TASK, token=None)
    assert raised.value.error.kind is ProviderErrorKind.SCHEMA_MISMATCH
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/providers/dataforseo/test_on_page.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.providers.dataforseo.on_page'`.

- [ ] **Step 3: Write the adapter**

Add to `FAMILY_LIMITS` in `backend/src/idraft/providers/dataforseo/client.py`:

```python
    # On-Page: a crawl's summary every minute, then its pages and one raw HTML call per page
    # (internal links plan 02); kept well under the account's limit for the other calls.
    "on_page": Limit(per_minute=600, burst=50),
```

`backend/src/idraft/providers/dataforseo/on_page.py`:

```python
"""DataForSEO On-Page for the internal link tracker (spec 6.1 and 6.3; plan decisions D5 to
D7).

One crawl is one posted task, paid when posted. The summary says how far it is; when it has
finished, its pages, its non-indexable pages and each page's raw HTML are read (results stay 30
days at DataForSEO, raw HTML 7). The links of a page are read from the provider only when its
HTML is missing. Every call takes a turn under the `on_page` family limit.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_UP, Decimal
from typing import Final, Literal, Protocol
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, ValidationError

from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.client import DataForSeoClient, TaskAnswer
from idraft.providers.dataforseo.errors import read_status

FAMILY: Final = "on_page"
# The endpoint of the crawl's cost event and its price (migration 0025).
TASK_POST: Final = "on_page/task_post"
PAGE_LIMIT: Final = 1000
_TASK_ID: Final = re.compile(r"[0-9A-Za-z-]{1,64}")
_COST_STEP: Final = Decimal("0.000001")
_LINK_TYPES: Final = {"anchor": "text", "image": "image"}
K = ProviderErrorKind


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


@dataclass(frozen=True, slots=True)
class CrawlOrder:
    host: str
    max_crawl_pages: int
    enable_javascript: bool
    allowed_subdomains: tuple[str, ...]
    tag: str

    def body(self) -> dict[str, object]:
        body: dict[str, object] = {
            # The documentation: the domain without the protocol or `www`.
            "target": self.host.removeprefix("www."),
            "start_url": f"https://{self.host}/",
            "max_crawl_pages": self.max_crawl_pages,
            "respect_sitemap": True,
            "store_raw_html": True,
            "enable_javascript": self.enable_javascript,
            "allow_subdomains": False,
            "tag": self.tag,
        }
        if self.allowed_subdomains:
            body["allowed_subdomains"] = list(self.allowed_subdomains)
        return body


class PostedCrawl(_Model):
    task_id: str
    cost_usd: Decimal | None


class CrawlSummary(_Model):
    finished: bool
    pages_crawled: int
    pages_in_queue: int
    stop_reason: str | None
    extended_status: str | None
    has_sitemap: bool | None


class PageItem(_Model):
    url: str
    status_code: int | None
    resource_type: str
    location: str | None
    title: str | None
    canonical: str | None
    from_sitemap: bool


class PageBatch(_Model):
    items: list[PageItem]
    token: str | None
    total: int


class NonIndexableItem(_Model):
    url: str
    reason: str


class NonIndexableBatch(_Model):
    items: list[NonIndexableItem]
    total: int


class LinkItem(_Model):
    link_to: str
    anchor: str
    kind: Literal["text", "image"]
    dofollow: bool


class OnPageApi(Protocol):
    """What the crawl workload calls; `OnPage` is the real one, tests use a stand-in."""

    async def post(self, order: CrawlOrder) -> PostedCrawl: ...
    async def summary(self, task_id: str) -> CrawlSummary: ...
    async def pages(self, task_id: str, *, token: str | None) -> PageBatch: ...
    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch: ...
    async def links_from(self, task_id: str, page_url: str) -> list[LinkItem]: ...
    async def raw_html(self, task_id: str, url: str) -> str | None: ...
    async def force_stop(self, task_id: str) -> None: ...


def _mismatch(message: str) -> ProviderCallError:
    return ProviderCallError(ProviderError(kind=K.SCHEMA_MISMATCH, message=message))


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _cost(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, int | Decimal):
        return None
    number = Decimal(value)
    if not number.is_finite() or number < 0 or number >= Decimal(10) ** 8:
        return None
    return number.quantize(_COST_STEP, rounding=ROUND_UP)


def _summary(result: Mapping[str, object]) -> CrawlSummary:
    status = _mapping(result.get("crawl_status"))
    domain = _mapping(result.get("domain_info"))
    sitemap = _mapping(domain.get("checks")).get("sitemap")
    return CrawlSummary.model_validate(
        {
            "finished": result.get("crawl_progress") == "finished",
            "pages_crawled": status.get("pages_crawled") or 0,
            "pages_in_queue": status.get("pages_in_queue") or 0,
            "stop_reason": result.get("crawl_stop_reason"),
            "extended_status": domain.get("extended_crawl_status"),
            "has_sitemap": sitemap if isinstance(sitemap, bool) else None,
        }
    )


def _page(raw: object) -> PageItem:
    item = _mapping(raw)
    meta = _mapping(item.get("meta"))
    checks = _mapping(item.get("checks"))
    return PageItem.model_validate(
        {
            "url": item.get("url"),
            "status_code": item.get("status_code"),
            "resource_type": item.get("resource_type") or "other",
            "location": item.get("location"),
            "title": meta.get("title"),
            "canonical": meta.get("canonical"),
            "from_sitemap": checks.get("from_sitemap") is True,
        }
    )


def _link(raw: object) -> LinkItem | None:
    item = _mapping(raw)
    kind = _LINK_TYPES.get(str(item.get("type")))
    if kind is None:
        return None
    anchor = item.get("text") or (item.get("image_alt") if kind == "image" else "") or ""
    return LinkItem.model_validate(
        {
            "link_to": item.get("link_to"),
            "anchor": anchor,
            "kind": kind,
            "dofollow": item.get("dofollow") is not False,
        }
    )


def _items(found: Mapping[str, object]) -> Sequence[object]:
    items = found.get("items") or []
    if not isinstance(items, Sequence) or isinstance(items, str):
        raise _mismatch("items that are not a list")
    return items


def _relative(url: str) -> str:
    parts = urlsplit(url)
    return (parts.path or "/") + (f"?{parts.query}" if parts.query else "")


class OnPage:
    def __init__(self, client: DataForSeoClient) -> None:
        self._client = client

    async def _call(
        self,
        method: Literal["GET", "POST"],
        path: str,
        body: list[dict[str, object]] | None = None,
        *,
        sending: bool = False,
    ) -> tuple[TaskAnswer, Mapping[str, object] | None]:
        answered = await self._client.call(method, path, family=FAMILY, sending=sending, body=body)
        task = answered.tasks[0] if answered.tasks else None
        if task is None:
            raise ProviderCallError(
                ProviderError(
                    kind=K.TIMEOUT if sending else K.PROVIDER_ERROR,
                    message="the answer names no task",
                )
            )
        outcome = read_status(task.status_code, task.status_message, sending=sending)
        if isinstance(outcome, ProviderError):
            raise ProviderCallError(outcome)
        first = task.result[0] if task.result else None
        if first is not None and not isinstance(first, Mapping):
            raise _mismatch("a result that is not an object")
        return task, first

    async def post(self, order: CrawlOrder) -> PostedCrawl:
        task, _ = await self._call("POST", "/v3/on_page/task_post", [order.body()], sending=True)
        if task.id is None or not _TASK_ID.fullmatch(task.id):
            # Created and charged, with an id we cannot keep: the outcome is unknown to us.
            raise ProviderCallError(ProviderError(kind=K.TIMEOUT, message="no usable task id"))
        return PostedCrawl(task_id=task.id, cost_usd=_cost(task.cost))

    async def summary(self, task_id: str) -> CrawlSummary:
        _, result = await self._call("GET", f"/v3/on_page/summary/{task_id}")
        try:
            return _summary(result or {})
        except ValidationError:
            raise _mismatch("a summary that cannot be read") from None

    async def pages(self, task_id: str, *, token: str | None) -> PageBatch:
        body: dict[str, object] = {"id": task_id, "limit": PAGE_LIMIT}
        if token is not None:
            body["search_after_token"] = token
        _, result = await self._call("POST", "/v3/on_page/pages", [body])
        found = result or {}
        try:
            pages = [_page(item) for item in _items(found)]
        except ValidationError:
            raise _mismatch("a page that cannot be read") from None
        next_token = found.get("search_after_token")
        total = found.get("total_items_count")
        return PageBatch(
            items=pages,
            token=next_token if isinstance(next_token, str) and next_token and pages else None,
            total=total if isinstance(total, int) else len(pages),
        )

    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch:
        body: dict[str, object] = {"id": task_id, "limit": PAGE_LIMIT, "offset": offset}
        _, result = await self._call("POST", "/v3/on_page/non_indexable", [body])
        found = result or {}
        try:
            items = [NonIndexableItem.model_validate(_mapping(item)) for item in _items(found)]
        except ValidationError:
            raise _mismatch("a non-indexable page that cannot be read") from None
        total = found.get("total_items_count")
        return NonIndexableBatch(items=items, total=total if isinstance(total, int) else len(items))

    async def links_from(self, task_id: str, page_url: str) -> list[LinkItem]:
        body: dict[str, object] = {
            "id": task_id,
            "page_from": _relative(page_url),
            "limit": PAGE_LIMIT,
            "filters": ["direction", "=", "internal"],
        }
        _, result = await self._call("POST", "/v3/on_page/links", [body])
        try:
            found = [_link(item) for item in _items(result or {})]
        except ValidationError:
            raise _mismatch("a link that cannot be read") from None
        return [link for link in found if link is not None]

    async def raw_html(self, task_id: str, url: str) -> str | None:
        try:
            _, result = await self._call("POST", "/v3/on_page/raw_html", [{"id": task_id, "url": url}])
        except ProviderCallError as failure:
            if failure.error.kind is K.NOT_FOUND_EXPIRED:
                return None
            raise
        html = _mapping(_mapping(result).get("items")).get("html")
        return html if isinstance(html, str) and html else None

    async def force_stop(self, task_id: str) -> None:
        await self._call("POST", "/v3/on_page/force_stop", [{"id": task_id}])
```

The `post` test compares the body as a list of one dict, so key order does not matter.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest --no-cov tests/providers/dataforseo -q`
Expected: all pass (the new 9 and the existing adapter tests).

- [ ] **Step 5: Gate and commit**

```bash
git add backend/src/idraft/providers/dataforseo/on_page.py backend/src/idraft/providers/dataforseo/client.py \
  backend/tests/providers/dataforseo/test_on_page.py
git commit -m "Internal links: DataForSEO On-Page adapter"
```

---

### Task 8: Edges of one page from the classified HTML

Waits for plan 01's `backend/src/idraft/crawl/placement.py` on `develop`. Until then the module does not exist and this task cannot start; nothing else in Tasks 1 to 7 imports it.

**Files:**
- Create: `backend/src/idraft/crawl/edges.py`
- Test: `backend/tests/crawl/test_edges.py`

- [ ] **Step 1: Check plan 01's contract**

Run: `uv run python -c "from idraft.crawl.placement import Placement, FoundLink, classify; import inspect; print(list(Placement), inspect.signature(classify), FoundLink.__dataclass_fields__.keys())"`
Expected: the seven placements of `PLACEMENTS`, `(html: str, page_url: str) -> list[FoundLink]`, and the fields `href, anchor, kind, rel, placement, container, open`. If a name differs, use plan 01's name in `edges.py` and in the tests below; nothing outside `edges.py` reads the classifier.

- [ ] **Step 2: Write the failing tests**

`backend/tests/crawl/test_edges.py`:

```python
"""The edges one crawled page gives (spec 6.3; plan decision D7)."""

from __future__ import annotations

from idraft.crawl.edges import ANCHOR_MAX, page_edges
from idraft.crawl.hosts import site_hosts
from idraft.crawl.placement import FoundLink, Placement, classify
from idraft.crawl.scopes import PLACEMENTS, LinkScope
from idraft.extraction.urls import canonicalize

PAGE = canonicalize("https://example.com/blog/post-b")
HOSTS = site_hosts("example.com", [])


def _found(
    href: str,
    placement: Placement = Placement.CONTENT,
    *,
    anchor: str = "Read",
    rel: frozenset[str] = frozenset(),
    kind: str = "text",
    container: str = "main>div.body",
    open_: bool = False,
) -> FoundLink:
    return FoundLink(
        href=href,
        anchor=anchor,
        kind=kind,  # type: ignore[arg-type]
        rel=rel,
        placement=placement,
        container=container,
        open=open_,
    )


def test_the_placements_of_the_classifier_are_the_stored_ones() -> None:
    assert {str(placement) for placement in Placement} == set(PLACEMENTS)


def test_links_are_kept_when_internal_and_counted_once_per_placement_and_anchor() -> None:
    edges = page_edges(
        [
            _found("https://example.com/pricing", anchor="See  plans"),
            _found("https://example.com/pricing?utm_source=menu", anchor="See plans"),
            _found("https://example.com/pricing", Placement.NAVIGATION, anchor="Pricing"),
            _found("https://other.example.org/x"),
            _found("https://example.com/blog/post-b#comments"),
            _found("mailto:hello@example.com"),
        ],
        page=PAGE,
        hosts=HOSTS,
    )

    found = {(edge.target.path, edge.placement, edge.anchor, edge.occurrences) for edge in edges}
    assert found == {
        ("/pricing", "content", "See plans", 2),
        ("/pricing", "navigation", "Pricing", 1),
    }
    scopes = {edge.placement: edge.scope for edge in edges}
    assert scopes == {"content": LinkScope.EDITORIAL, "navigation": LinkScope.TEMPLATE}


def test_nofollow_image_anchors_and_template_candidates() -> None:
    (image,) = page_edges(
        [_found("https://example.com/a", anchor="Logo", kind="image", rel=frozenset({"nofollow"}))],
        page=PAGE,
        hosts=HOSTS,
    )
    (open_link,) = page_edges(
        [_found("https://example.com/b", Placement.AUTO_GENERATED, open_=True)],
        page=PAGE,
        hosts=HOSTS,
    )
    (long,) = page_edges([_found("https://example.com/c", anchor="x" * 900)], page=PAGE, hosts=HOSTS)

    assert (image.kind, image.followed, image.rel) == ("image", False, ("nofollow",))
    assert image.template_candidate
    assert open_link.template_candidate and open_link.scope is LinkScope.AUTO_GENERATED
    assert len(long.anchor) == ANCHOR_MAX
    assert image.container_hash is not None


def test_the_cleanstart_shape_gives_previous_and_next_as_auto_generated() -> None:
    html = """
    <html><body>
      <header><nav><a href="/">Home</a><a href="/blog">Blog</a></nav></header>
      <main>
        <article><p>Body with <a href="/pricing">our plans</a>.</p></article>
        <section aria-label="Article navigation">
          <a rel="prev" href="/blog/post-a">Previous: Post A</a>
          <a rel="next" href="/blog/post-c">Next: Post C</a>
        </section>
      </main>
      <footer><a href="/privacy">Privacy</a></footer>
    </body></html>
    """
    edges = page_edges(classify(html, PAGE.url), page=PAGE, hosts=HOSTS)

    by_path = {edge.target.path: edge.scope for edge in edges}
    assert by_path == {
        "/": LinkScope.TEMPLATE,
        "/blog": LinkScope.TEMPLATE,
        "/pricing": LinkScope.EDITORIAL,
        "/blog/post-a": LinkScope.AUTO_GENERATED,
        "/blog/post-c": LinkScope.AUTO_GENERATED,
        "/privacy": LinkScope.TEMPLATE,
    }
```

The `type: ignore` on `kind` stays: the helper takes a plain string so the image case reads naturally, and `FoundLink.kind` is a `Literal`.

- [ ] **Step 3: Run them to see them fail**

Run: `uv run pytest --no-cov tests/crawl/test_edges.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.crawl.edges'`.

- [ ] **Step 4: Write the module**

`backend/src/idraft/crawl/edges.py`:

```python
"""The internal links of one crawled page as stored edges (spec 6.3 step 4; plan decision D7).

Each classified link's href is canonicalized (canonicalizer v1). Links to another site, links
that cannot name a page and links from the page to itself (jump links included: the fragment
is not part of a page's URL) are dropped. What is left is counted once per (target, placement,
anchor, kind) with its occurrences; it is followed when any occurrence lacks `nofollow`. A
link the first pass called `content`, or left open (rule 4), is a template candidate for the
second pass (`idraft.crawl.template`).
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final, Literal

from idraft.crawl.placement import FoundLink
from idraft.crawl.scopes import LinkScope, scope_of
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize

ANCHOR_MAX: Final = 500
_OCCURRENCES_MAX: Final = 32_767


@dataclass(frozen=True, slots=True)
class PageEdge:
    target: CanonicalUrl
    anchor: str
    kind: Literal["text", "image"]
    placement: str
    scope: LinkScope
    rel: tuple[str, ...]
    followed: bool
    occurrences: int
    container_hash: int | None
    template_candidate: bool


def container_hash(container: str) -> int:
    """A stable signed 64-bit number for a container path (`seo.crawl_links.container_hash`)."""
    digest = hashlib.blake2b(container.encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def page_edges(
    links: Sequence[FoundLink], *, page: CanonicalUrl, hosts: frozenset[str]
) -> list[PageEdge]:
    found: dict[tuple[bytes, str, str, str], PageEdge] = {}
    for link in links:
        try:
            target = canonicalize(link.href)
        except UrlRejectedError:
            continue
        if target.host.name not in hosts or target.url_hash == page.url_hash:
            continue
        anchor = " ".join(link.anchor.split())[:ANCHOR_MAX]
        placement = str(link.placement)
        followed = "nofollow" not in link.rel
        key = (target.url_hash, placement, anchor, link.kind)
        before = found.get(key)
        if before is not None:
            found[key] = replace(
                before,
                occurrences=min(before.occurrences + 1, _OCCURRENCES_MAX),
                followed=before.followed or followed,
            )
            continue
        found[key] = PageEdge(
            target=target,
            anchor=anchor,
            kind=link.kind,
            placement=placement,
            scope=scope_of(placement),
            rel=tuple(sorted(link.rel)),
            followed=followed,
            occurrences=1,
            container_hash=container_hash(link.container) if link.container else None,
            template_candidate=placement == "content" or link.open,
        )
    return list(found.values())
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest --no-cov tests/crawl -q`
Expected: all pass. A failure of `test_the_cleanstart_shape_...` is a classifier finding for plan 01, not something to work around here.

- [ ] **Step 6: Gate and commit**

```bash
git add backend/src/idraft/crawl/edges.py backend/tests/crawl/test_edges.py
git commit -m "Internal links: edges of a page from its classified links"
```

---

### Task 9: Crawl runs in the worker: queue, budget, post, progress, cancel, retention

**Files:**
- Create: `backend/src/idraft/collectors/crawl_runs.py`
- Test: `backend/tests/collectors/crawl_support.py`, `backend/tests/collectors/test_crawl_runs.py`

The tick is wired into the worker in Task 11, together with the ingest job it hands crawls to.

- [ ] **Step 1: The stand-in provider**

`backend/tests/collectors/crawl_support.py`:

```python
"""A stand-in for DataForSEO On-Page that answers from memory, and the project a crawl test
needs (a website on example.com)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.on_page import (
    CrawlOrder,
    CrawlSummary,
    LinkItem,
    NonIndexableBatch,
    NonIndexableItem,
    PageBatch,
    PageItem,
    PostedCrawl,
)
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.internal_links.support import set_website
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


def summary(
    *,
    finished: bool,
    crawled: int = 0,
    queue: int = 0,
    stop: str | None = None,
    status: str | None = "no_errors",
    sitemap: bool | None = True,
) -> CrawlSummary:
    return CrawlSummary(
        finished=finished,
        pages_crawled=crawled,
        pages_in_queue=queue,
        stop_reason=stop,
        extended_status=status,
        has_sitemap=sitemap,
    )


@dataclass
class FakeOnPage:
    pages: list[PageItem] = field(default_factory=list)
    html: dict[str, str] = field(default_factory=dict)
    links: dict[str, list[LinkItem]] = field(default_factory=dict)
    non_indexable_items: list[NonIndexableItem] = field(default_factory=list)
    # One per call; the last one repeats.
    summaries: list[CrawlSummary] = field(
        default_factory=lambda: [summary(finished=True, crawled=3)]
    )
    post_error: ProviderError | None = None
    html_error: ProviderError | None = None
    cost: Decimal | None = Decimal("0.3")
    batch: int = 2
    posted: list[CrawlOrder] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)

    async def post(self, order: CrawlOrder) -> PostedCrawl:
        self.posted.append(order)
        if self.post_error is not None:
            raise ProviderCallError(self.post_error)
        return PostedCrawl(task_id=f"task-{len(self.posted)}", cost_usd=self.cost)

    async def summary(self, task_id: str) -> CrawlSummary:
        self.calls.append(f"summary {task_id}")
        return self.summaries.pop(0) if len(self.summaries) > 1 else self.summaries[0]

    async def pages(self, task_id: str, *, token: str | None) -> PageBatch:
        start = int(token or 0)
        end = start + self.batch
        return PageBatch(
            items=self.pages[start:end],
            token=str(end) if end < len(self.pages) else None,
            total=len(self.pages),
        )

    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch:
        return NonIndexableBatch(
            items=self.non_indexable_items[offset : offset + self.batch],
            total=len(self.non_indexable_items),
        )

    async def links_from(self, task_id: str, page_url: str) -> list[LinkItem]:
        self.calls.append(f"links {page_url}")
        return self.links.get(page_url, [])

    async def raw_html(self, task_id: str, url: str) -> str | None:
        self.calls.append(f"html {url}")
        if self.html_error is not None:
            raise ProviderCallError(self.html_error)
        return self.html.get(url)

    async def force_stop(self, task_id: str) -> None:
        self.stopped.append(task_id)


async def clear_crawls(pg: PostgresServer) -> None:
    """A crawl tick looks at every crawl and every project with a website in the database, so
    a crawl test starts with none left by earlier tests."""
    await execute(pg, "DELETE FROM seo.crawl_runs")
    await execute(
        pg, "UPDATE core.projects SET primary_domain_id = NULL WHERE primary_domain_id IS NOT NULL"
    )


async def site_project(pg: PostgresServer) -> tuple[Workspace, uuid.UUID]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    await set_website(pg, project)
    return workspace, project
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/collectors/test_crawl_runs.py`:

```python
"""Crawl runs in the worker (spec 6.1, 6.2 and 9; plan decisions D3 to D6, D8, D13)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_runs import (
    CrawlBusyError,
    CrawlIngestTask,
    NoStoppedCrawlError,
    crawl_tick,
    queue_run,
)
from idraft.crawl.schedule import NIGHT_START, slot_offset
from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderError
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.internal_links.support import seed_crawl
from tests.collectors.crawl_support import FakeOnPage, clear_crawls, site_project, summary
from tests.collectors.support import NOW, Project, make_budget
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


async def _queue(
    sessions: Sessions, workspace_id: uuid.UUID, project_id: uuid.UUID, trigger: str = "manual"
) -> uuid.UUID:
    async with sessions() as db, db.begin():
        return await queue_run(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            trigger=trigger,  # type: ignore[arg-type]
            requested_by=None,
            now=NOW,
        )


async def _run(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, object]:
    return dict(await fetchrow(pg, "SELECT * FROM seo.crawl_runs WHERE id = $1", run_id))


class _Sent:
    def __init__(self) -> None:
        self.tasks: list[CrawlIngestTask] = []

    async def __call__(self, task: CrawlIngestTask) -> bool:
        self.tasks.append(task)
        return True


async def test_the_first_crawl_is_a_probe_and_the_next_follows_the_sitemap(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)

    first = await _queue(worker_db, workspace.id, project)
    row = await _run(migrated, first)
    assert (row["ceiling"], row["target_host"], row["state"]) == (2000, "example.com", "queued")
    assert row["estimated_cost_usd"] == Decimal("0.300000")
    with pytest.raises(CrawlBusyError) as busy:
        await _queue(worker_db, workspace.id, project)
    assert busy.value.run_id == first

    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'stopped_at_ceiling', sitemap_pages = 1500 WHERE id = $1",
        first,
    )
    retry = await _queue(worker_db, workspace.id, project, "ceiling_retry")
    assert (await _run(migrated, retry))["ceiling"] == 4500
    await execute(migrated, "UPDATE seo.crawl_runs SET state = 'ready' WHERE id = $1", retry)
    with pytest.raises(NoStoppedCrawlError):
        await _queue(worker_db, workspace.id, project, "ceiling_retry")


async def test_a_due_project_is_queued_in_its_night_slot(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    on_page = FakeOnPage()
    slot = datetime.combine(NOW.date(), NIGHT_START, tzinfo=UTC) + slot_offset(project)

    early = await crawl_tick(worker_db, None, _Sent(), now=slot - timedelta(minutes=1))
    due = await crawl_tick(worker_db, None, _Sent(), now=slot + timedelta(minutes=5))

    assert (early.queued, due.queued) == (0, 1)
    rows = await fetch(
        migrated, "SELECT trigger, state FROM seo.crawl_runs WHERE project_id = $1", project
    )
    assert [(row["trigger"], row["state"]) for row in rows] == [("schedule", "queued")]
    assert on_page.posted == []


async def test_a_queued_crawl_is_posted_and_its_cost_recorded(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage(summaries=[summary(finished=False, crawled=10, queue=90)])

    report = await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert report.posted == 1
    assert (row["state"], row["provider_task_id"], row["pages_found"]) == ("crawling", "task-1", 100)
    (order,) = on_page.posted
    assert (order.host, order.max_crawl_pages, order.tag) == ("example.com", 2000, str(run_id))
    event = await fetchrow(
        migrated,
        "SELECT workload, channel, endpoint, cost_usd, cost_source, units FROM "
        "ops.provider_cost_events WHERE run_id = $1",
        run_id,
    )
    assert dict(event) == {
        "workload": "site_crawl",
        "channel": "seo",
        "endpoint": "on_page/task_post",
        "cost_usd": Decimal("0.300000"),
        "cost_source": "provider_reported",
        "units": Decimal("2000.0000"),
    }


async def test_a_budget_stops_a_crawl_before_it_is_posted(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    await make_budget(migrated, Project(workspace.id, project), "0", workload="site_crawl")
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage()

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"]) == ("failed", "budget_exceeded")
    assert on_page.posted == []


async def test_a_post_that_may_have_arrived_is_never_sent_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage(post_error=ProviderError(kind=ProviderErrorKind.TIMEOUT, message="read"))

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)
    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"]) == ("failed", "submit_unknown")
    assert len(on_page.posted) == 1


async def test_a_post_the_limiter_held_back_waits_for_the_next_tick(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage(post_error=ProviderError(kind=ProviderErrorKind.NOT_SENT, message="busy"))

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["submitted_at"]) == ("queued", None)


async def test_a_finished_crawl_goes_to_ingest_and_a_blocked_one_fails(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    other_workspace, blocked_project = await site_project(migrated)
    done = await _queue(worker_db, workspace.id, project)
    blocked = await _queue(worker_db, other_workspace.id, blocked_project)
    for run_id, task in ((done, "task-done"), (blocked, "task-blocked")):
        await execute(
            migrated,
            "UPDATE seo.crawl_runs SET state = 'crawling', provider_task_id = $2, "
            "submitted_at = now() WHERE id = $1",
            run_id,
            task,
        )
    finished = summary(finished=True, crawled=2000, stop="limit_exceeded")
    refused = summary(finished=True, crawled=1, status="forbidden_robots")
    on_page = FakeOnPage()
    sent = _Sent()

    async def answer(task_id: str) -> object:
        return finished if task_id == "task-done" else refused

    on_page.summary = answer  # type: ignore[method-assign,assignment]
    await crawl_tick(worker_db, on_page, sent, now=NOW)

    assert (await _run(migrated, done))["state"] == "processing"
    assert (await _run(migrated, done))["stop_reason"] == "limit_exceeded"
    assert [task.run_id for task in sent.tasks] == [done]
    row = await _run(migrated, blocked)
    assert (row["state"], row["error_code"]) == ("failed", "site_blocked")


async def test_cancelling_a_crawl_under_way_stops_it_at_the_provider(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'crawling', provider_task_id = 'task-x', "
        "submitted_at = now(), cancel_requested = true WHERE id = $1",
        run_id,
    )
    on_page = FakeOnPage()

    report = await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    assert report.cancelled == 1
    assert on_page.stopped == ["task-x"]
    assert (await _run(migrated, run_id))["state"] == "cancelled"


async def test_only_the_last_four_finished_crawls_keep_their_links(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    runs = [(await seed_crawl(migrated, workspace, project, [("/", 200)]))[0] for _ in range(5)]

    report = await crawl_tick(worker_db, FakeOnPage(), _Sent(), now=NOW)

    assert report.dropped == 1
    kept = await fetch(
        migrated,
        "SELECT id FROM seo.crawl_runs WHERE project_id = $1 AND links_dropped_at IS NULL",
        project,
    )
    assert {row["id"] for row in kept} == set(runs[1:])
    part = await fetchrow(
        migrated, "SELECT to_regclass($1) AS found", f"seo.crawl_links_{runs[0].hex}"
    )
    assert part["found"] is None
```

The `type: ignore` comments stay: the test passes a plain string for the trigger and replaces one method of the stand-in.

- [ ] **Step 3: Run them to see them fail**

Run: `uv run pytest --no-cov tests/collectors/test_crawl_runs.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.collectors.crawl_runs'`.

- [ ] **Step 4: Write the module**

`backend/src/idraft/collectors/crawl_runs.py`:

```python
"""Crawls of a project's site (spec 6.1, 6.2 and 9; plan decisions D3 to D6, D8 and D13).

A crawl moves `queued`, `crawling`, `processing`, then `ready` or `stopped_at_ceiling`; it can
end `failed` or `cancelled` on the way. One tick, under the worker's lock, takes each step once,
each run in its own transaction so one run never holds up another:

1. queue the scheduled crawls that are due (`idraft.crawl.schedule.crawl_due`);
2. post queued crawls: the budget first; a post that may have reached the provider is never
   sent again;
3. read the summary of the crawls under way, and stop the ones a person cancelled;
4. hand finished crawls to the ingest job, again on every tick while they process (the queue
   drops a message that is already waiting);
5. recompute the tier flows marked stale;
6. drop the link partitions of all but the last four finished crawls of each project.

Every statement names the workspace or the run: the worker bypasses row-level security.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal
from uuid import UUID

import structlog
from pydantic import BaseModel
from sqlalchemy import Row, and_, exists, func, insert, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import budget
from idraft.collectors.crawl_store import ACTIVE_STATES, DATA_STATES, recompute_tier_flow
from idraft.crawl.ceiling import crawl_ceiling, retry_ceiling
from idraft.crawl.schedule import CrawlSchedule, crawl_due
from idraft.db.tables import (
    crawl_runs,
    domains,
    projects,
    provider_cost_events,
    provider_price_book,
    workspaces,
)
from idraft.domain.retries import ProviderErrorKind
from idraft.domain.workloads import CostWorkload, cost_channel
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.on_page import TASK_POST, CrawlOrder, OnPageApi

TICK_LIMIT: Final = 50
KEEP_RUNS: Final = 4
# A crawl with JavaScript off that found this few pages suggests turning it on (spec 9).
FEW_PAGES: Final = 3
INGEST_JOB: Final = "crawl_ingest"
_BLOCKED: Final = frozenset({"forbidden_robots", "forbidden_meta_tag", "forbidden_http_header"})
_UNREACHABLE: Final = frozenset(
    {"site_unreachable", "invalid_page_status_code", "too_many_redirects"}
)
# Kinds after which the post certainly did not reach the provider: try again next tick.
_NOT_SENT: Final = frozenset({ProviderErrorKind.NOT_SENT, ProviderErrorKind.RATE_LIMITED})
_MESSAGES: Final = {
    "budget_exceeded": "A budget for site crawls would be passed.",
    "submit_unknown": "The crawl may have been sent; it is not sent again.",
    "site_blocked": "The site refuses the crawler (robots.txt, a meta tag or a header).",
    "site_unreachable": "The site could not be reached.",
}
Trigger = Literal["website_added", "schedule", "manual", "ceiling_retry"]
K = ProviderErrorKind
_log = structlog.get_logger(__name__)


class CrawlIngestTask(BaseModel):
    """The message of the `crawl_ingest` job: one finished crawl."""

    workspace_id: UUID
    run_id: UUID

    @property
    def dedupe_key(self) -> str:
        return f"{INGEST_JOB}:{self.run_id}"


type SendIngest = Callable[[CrawlIngestTask], Awaitable[bool]]


class CrawlBusyError(Exception):
    def __init__(self, run_id: UUID) -> None:
        super().__init__(f"crawl {run_id} is under way")
        self.run_id = run_id


class NoSiteError(Exception):
    """The project has no website, or is gone."""


class NoStoppedCrawlError(Exception):
    """A higher limit was asked for, and the latest crawl did not stop at its ceiling."""


@dataclass(frozen=True, slots=True)
class LinkSettings:
    schedule: CrawlSchedule
    render_javascript: bool
    allowed_subdomains: tuple[str, ...]


def link_settings(stored: Mapping[str, Any] | None) -> LinkSettings:
    """The project's `internal_links` settings with their defaults (spec 7.8)."""
    part = (stored or {}).get("internal_links") or {}
    return LinkSettings(
        schedule=CrawlSchedule(part.get("schedule", CrawlSchedule.WEEKLY)),
        render_javascript=bool(part.get("render_javascript", False)),
        allowed_subdomains=tuple(part.get("allowed_subdomains", ())),
    )


@dataclass(frozen=True, slots=True)
class CrawlTickReport:
    queued: int = 0
    posted: int = 0
    failed: int = 0
    progressed: int = 0
    finished: int = 0
    cancelled: int = 0
    ingest_sent: int = 0
    flows: int = 0
    dropped: int = 0

    @property
    def quiet(self) -> bool:
        return self == CrawlTickReport()


async def crawl_price(db: AsyncSession, *, javascript: bool, on: date) -> Decimal:
    book = provider_price_book
    price = (
        await db.execute(
            select(book.c.unit_price_usd)
            .where(
                book.c.provider_code == "dataforseo",
                book.c.endpoint == TASK_POST,
                book.c.price_unit == "page",
                book.c.conditions["javascript"].as_boolean().is_(javascript),
                book.c.valid_from <= on,
                or_(book.c.valid_to.is_(None), book.c.valid_to > on),
            )
            .order_by(book.c.valid_from.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if price is None:
        raise LookupError("the price book has no On-Page price")
    return Decimal(price)


async def queue_run(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    trigger: Trigger,
    requested_by: UUID | None,
    now: datetime,
) -> UUID:
    """A queued crawl of the project's website with its settings, ceiling and estimate."""
    site = (
        await db.execute(
            select(projects.c.settings, domains.c.host)
            .join(domains, domains.c.id == projects.c.primary_domain_id)
            .where(
                projects.c.workspace_id == workspace_id,
                projects.c.id == project_id,
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if site is None:
        raise NoSiteError
    settings = link_settings(site.settings)
    previous = (
        await db.execute(
            select(crawl_runs.c.state, crawl_runs.c.ceiling, crawl_runs.c.sitemap_pages)
            .where(
                crawl_runs.c.workspace_id == workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_runs.c.state.in_(DATA_STATES),
            )
            .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
            .limit(1)
        )
    ).one_or_none()
    if trigger == "ceiling_retry":
        if previous is None or previous.state != "stopped_at_ceiling":
            raise NoStoppedCrawlError
        ceiling = retry_ceiling(previous.ceiling, previous.sitemap_pages)
    else:
        ceiling = crawl_ceiling(None if previous is None else previous.sitemap_pages)
    price = await crawl_price(db, javascript=settings.render_javascript, on=now.date())
    run_id: UUID | None = (
        await db.execute(
            upsert(crawl_runs)
            .values(
                workspace_id=workspace_id,
                project_id=project_id,
                trigger=trigger,
                target_host=site.host,
                settings={
                    "render_javascript": settings.render_javascript,
                    "allowed_subdomains": list(settings.allowed_subdomains),
                    "schedule": settings.schedule.value,
                },
                ceiling=ceiling,
                estimated_cost_usd=price * ceiling,
                requested_by=requested_by,
            )
            .on_conflict_do_nothing(
                index_elements=[crawl_runs.c.project_id],
                index_where=crawl_runs.c.state.in_(ACTIVE_STATES),
            )
            .returning(crawl_runs.c.id)
        )
    ).scalar_one_or_none()
    if run_id is None:
        active = (
            await db.execute(
                select(crawl_runs.c.id).where(
                    crawl_runs.c.workspace_id == workspace_id,
                    crawl_runs.c.project_id == project_id,
                    crawl_runs.c.state.in_(ACTIVE_STATES),
                )
            )
        ).scalar_one()
        raise CrawlBusyError(active)
    return run_id


async def _finish(
    db: AsyncSession,
    run: Row[Any],
    state: str,
    *,
    now: datetime,
    error_code: str | None = None,
    message: str | None = None,
) -> None:
    await db.execute(
        update(crawl_runs)
        .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
        .values(
            state=state,
            error_code=error_code,
            error_message=None if message is None else message[:500],
            finished_at=now,
        )
    )


async def _queue_scheduled(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    started = (
        select(crawl_runs.c.project_id, func.max(crawl_runs.c.created_at).label("last"))
        .group_by(crawl_runs.c.project_id)
        .subquery()
    )
    under_way = exists().where(
        crawl_runs.c.project_id == projects.c.id, crawl_runs.c.state.in_(ACTIVE_STATES)
    )
    # shortcut: reads every project with a website each minute; page it when there are
    # tens of thousands of projects.
    async with sessions() as db, db.begin():
        rows = (
            await db.execute(
                select(
                    projects.c.id,
                    projects.c.workspace_id,
                    projects.c.timezone,
                    projects.c.settings,
                    started.c.last,
                )
                .join(workspaces, workspaces.c.id == projects.c.workspace_id)
                .outerjoin(started, started.c.project_id == projects.c.id)
                .where(
                    projects.c.status == "active",
                    projects.c.deleted_at.is_(None),
                    workspaces.c.status == "active",
                    projects.c.primary_domain_id.is_not(None),
                    ~under_way,
                )
            )
        ).all()
    due = [
        row
        for row in rows
        if crawl_due(
            schedule=link_settings(row.settings).schedule,
            last_started=row.last,
            timezone=row.timezone,
            project_id=row.id,
            now=now,
        )
    ]
    queued = 0
    for row in due[:TICK_LIMIT]:
        try:
            async with sessions() as db, db.begin():
                await queue_run(
                    db,
                    workspace_id=row.workspace_id,
                    project_id=row.id,
                    trigger="schedule",
                    requested_by=None,
                    now=now,
                )
            queued += 1
        except (CrawlBusyError, NoSiteError):
            continue
    return queued


PostOutcome = Literal["posted", "failed", "cancelled", "waiting", "none"]


async def _post_one(
    sessions: async_sessionmaker[AsyncSession], on_page: OnPageApi, now: datetime
) -> PostOutcome:
    async with sessions() as db, db.begin():
        run = (
            await db.execute(
                select(crawl_runs)
                .where(crawl_runs.c.state == "queued")
                .order_by(crawl_runs.c.created_at, crawl_runs.c.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).one_or_none()
        if run is None:
            return "none"
        if run.cancel_requested:
            await _finish(db, run, "cancelled", now=now)
            return "cancelled"
        if run.submitted_at is not None:
            # A post was begun and its outcome never written: it may have been charged.
            await _finish(
                db, run, "failed", now=now, error_code="submit_unknown",
                message=_MESSAGES["submit_unknown"],
            )
            return "failed"
        verdict = await budget.check(
            db,
            workspace_id=run.workspace_id,
            project_id=run.project_id,
            workload=CostWorkload.SITE_CRAWL,
            now=now,
            estimate=run.estimated_cost_usd,
        )
        if not verdict.allowed:
            await _finish(
                db, run, "failed", now=now, error_code="budget_exceeded",
                message=_MESSAGES["budget_exceeded"],
            )
            return "failed"
        await db.execute(
            update(crawl_runs).where(crawl_runs.c.id == run.id).values(submitted_at=now)
        )
    order = CrawlOrder(
        host=run.target_host,
        max_crawl_pages=run.ceiling,
        enable_javascript=bool(run.settings.get("render_javascript")),
        allowed_subdomains=tuple(run.settings.get("allowed_subdomains", ())),
        tag=str(run.id),
    )
    try:
        posted = await on_page.post(order)
    except ProviderCallError as failure:
        async with sessions() as db, db.begin():
            if failure.error.kind in _NOT_SENT:
                await db.execute(
                    update(crawl_runs).where(crawl_runs.c.id == run.id).values(submitted_at=None)
                )
                return "waiting"
            unknown = failure.error.kind is K.TIMEOUT
            await _finish(
                db,
                run,
                "failed",
                now=now,
                error_code="submit_unknown" if unknown else "provider_error",
                message=_MESSAGES["submit_unknown"] if unknown else failure.error.message,
            )
        return "failed"
    cost = posted.cost_usd if posted.cost_usd is not None else run.estimated_cost_usd
    async with sessions() as db, db.begin():
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.id == run.id)
            .values(state="crawling", provider_task_id=posted.task_id, cost_usd=cost)
        )
        await db.execute(
            insert(provider_cost_events).values(
                occurred_at=now,
                workspace_id=run.workspace_id,
                project_id=run.project_id,
                provider_code="dataforseo",
                endpoint=TASK_POST,
                workload=CostWorkload.SITE_CRAWL.value,
                channel=cost_channel(CostWorkload.SITE_CRAWL).value,
                run_id=run.id,
                subject_type="site",
                subject_id=run.target_host,
                units=run.ceiling,
                price_unit="page",
                cost_usd=cost,
                cost_source="provider_reported" if posted.cost_usd is not None else "price_book_estimate",
                billing_period=now.date().replace(day=1),
            )
        )
    return "posted"


ProgressOutcome = Literal["progressed", "finished", "failed", "cancelled", "waiting"]


async def _progress_one(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    run: Row[Any],
    now: datetime,
) -> ProgressOutcome:
    if run.cancel_requested:
        try:
            await on_page.force_stop(run.provider_task_id)
        except ProviderCallError as failure:
            _log.warning("crawl not stopped at the provider", run_id=str(run.id), kind=failure.error.kind.value)
        async with sessions() as db, db.begin():
            await _finish(db, run, "cancelled", now=now)
        return "cancelled"
    try:
        found = await on_page.summary(run.provider_task_id)
    except ProviderCallError as failure:
        if failure.error.kind is not K.NOT_FOUND_EXPIRED:
            return "waiting"
        async with sessions() as db, db.begin():
            await _finish(db, run, "failed", now=now, error_code="provider_error", message=failure.error.message)
        return "failed"
    values: dict[str, object] = {
        "pages_crawled": found.pages_crawled,
        "pages_found": found.pages_crawled + found.pages_in_queue,
    }
    async with sessions() as db, db.begin():
        where = and_(crawl_runs.c.id == run.id, crawl_runs.c.state == "crawling")
        if not found.finished:
            await db.execute(update(crawl_runs).where(where).values(**values))
            return "progressed"
        code = (
            "site_blocked" if found.extended_status in _BLOCKED
            else "site_unreachable" if found.extended_status in _UNREACHABLE
            else None
        )
        if code is not None:
            await db.execute(update(crawl_runs).where(where).values(**values))
            await _finish(db, run, "failed", now=now, error_code=code, message=_MESSAGES[code])
            return "failed"
        await db.execute(
            update(crawl_runs)
            .where(where)
            .values(
                **values,
                state="processing",
                stop_reason=found.stop_reason,
                crawled_at=now,
                ingest_phase="pages",
            )
        )
    return "finished"


async def _rows(
    sessions: async_sessionmaker[AsyncSession], *conditions: Any
) -> list[Row[Any]]:
    async with sessions() as db:
        return list(
            (
                await db.execute(
                    select(crawl_runs).where(*conditions).order_by(crawl_runs.c.created_at).limit(TICK_LIMIT)
                )
            ).all()
        )


_RETIRED = text(
    """
    SELECT id FROM (
        SELECT id, state, row_number() OVER (PARTITION BY project_id
                                             ORDER BY created_at DESC, id DESC) AS place
        FROM seo.crawl_runs
        WHERE links_dropped_at IS NULL
          AND (state IN ('ready', 'stopped_at_ceiling')
               OR (state IN ('failed', 'cancelled') AND ingest_phase IS NOT NULL))
    ) ranked
    WHERE state IN ('failed', 'cancelled') OR place > :keep
    LIMIT :limit
    """
)


async def _retire(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """Links of crawls past the last four finished ones, and of crawls that failed or were
    cancelled after ingest began, go; their pages stay (spec 6.5)."""
    async with sessions() as db, db.begin():
        ids = list((await db.execute(_RETIRED, {"keep": KEEP_RUNS, "limit": TICK_LIMIT})).scalars())
        for run_id in ids:
            await db.execute(text("SELECT seo.drop_crawl_links_partition(:run_id)"), {"run_id": run_id})
            await db.execute(
                update(crawl_runs).where(crawl_runs.c.id == run_id).values(links_dropped_at=now)
            )
    return len(ids)


async def crawl_tick(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi | None,
    send_ingest: SendIngest,
    *,
    now: datetime,
) -> CrawlTickReport:
    """One pass over every crawl. With no provider (no DataForSEO credentials) crawls are
    queued and wait; nothing is posted."""
    counts: dict[str, int] = dict.fromkeys(
        ("posted", "failed", "progressed", "finished", "cancelled", "ingest_sent", "flows"), 0
    )
    queued = await _queue_scheduled(sessions, now)
    if on_page is not None:
        for _ in range(TICK_LIMIT):
            outcome = await _post_one(sessions, on_page, now)
            if outcome in ("none", "waiting"):
                break
            counts[outcome] += 1
        for run in await _rows(sessions, crawl_runs.c.state == "crawling"):
            outcome_ = await _progress_one(sessions, on_page, run, now)
            if outcome_ != "waiting":
                counts[outcome_] += 1
    for run in await _rows(sessions, crawl_runs.c.state == "processing"):
        if await send_ingest(CrawlIngestTask(workspace_id=run.workspace_id, run_id=run.id)):
            counts["ingest_sent"] += 1
    for run in await _rows(
        sessions, crawl_runs.c.tier_flow_stale, crawl_runs.c.state.in_(DATA_STATES)
    ):
        async with sessions() as db, db.begin():
            await recompute_tier_flow(db, workspace_id=run.workspace_id, run_id=run.id)
        counts["flows"] += 1
    dropped = await _retire(sessions, now)
    return CrawlTickReport(queued=queued, dropped=dropped, **counts)
```

Wrap the long lines with `ruff format`.

- [ ] **Step 5: Run the tests**

Run: `uv run pytest --no-cov tests/collectors/test_crawl_runs.py -q`
Expected: 9 passed.

- [ ] **Step 6: Gate and commit**

```bash
git add backend/src/idraft/collectors/crawl_runs.py backend/tests/collectors/crawl_support.py \
  backend/tests/collectors/test_crawl_runs.py
git commit -m "Internal links: crawl runs with schedule, budget, post, progress, cancel and retention"
```

---

### Task 10: Crawl API, internal links settings and the website-added crawl

**Files:**
- Create: `backend/src/idraft/api/internal_links/crawls.py`, `crawl_routes.py`
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (append crawl models)
- Modify: `backend/src/idraft/api/schemas/operations.py` (`InternalLinksSettings`, `InternalLinksSettingsPatch`; `ProjectSettings` and `ProjectSettingsPatch` gain `internal_links`)
- Modify: `backend/src/idraft/api/operations/settings.py` (merge and audit the new part)
- Modify: `backend/src/idraft/api/schemas/projects.py` (`map_internal_links`), `backend/src/idraft/api/projects/routes.py`, `backend/src/idraft/api/projects/service.py`
- Modify: `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/main.py`, `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json`
- Modify: `backend/tests/api/operations/test_settings.py` (the default settings body)
- Test: `backend/tests/api/internal_links/test_crawls.py`, `backend/tests/api/internal_links/test_link_settings.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/internal_links/test_crawls.py`:

```python
"""Crawl now, progress, cancel and the website-added crawl (spec 6.2 and 9; decisions D14, D15)."""

from __future__ import annotations

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import audit_rows, seed_crawl, set_website
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.support import Project, make_budget
from tests.conftest import PostgresServer


async def test_an_analyst_starts_a_crawl_and_a_second_one_waits(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    analyst = await member(resources, migrated, workspace, "analyst")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")

    started = await api.post(url, json={}, headers=analyst.headers)
    again = await api.post(url, json={}, headers=analyst.headers)
    listed = await api.get(url, headers=analyst.headers)

    assert started.status_code == 202, started.text
    run = started.json()["data"]
    assert (run["state"], run["trigger"], run["ceiling"], run["estimated_cost_usd"]) == (
        "queued",
        "manual",
        2000,
        "0.300000",
    )
    assert run["requested_by"]["user_id"] == str(analyst.user_id)
    assert problem(again) == (409, "crawl_in_progress")
    assert again.json()["run_id"] == run["run_id"]
    assert [row["run_id"] for row in listed.json()["data"]] == [run["run_id"]]
    assert len(await audit_rows(migrated, workspace, "link_crawl.requested")) == 1


async def test_a_project_without_a_website_cannot_be_crawled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)

    response = await api.post(project_url(workspace, project, "link-crawls"), json={}, headers=owner.headers)

    assert problem(response) == (422, "no_website")


async def test_a_crawl_a_budget_would_stop_is_not_queued(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    budget_id = await make_budget(migrated, Project(workspace.id, project), "0.10", workload="site_crawl")

    response = await api.post(project_url(workspace, project, "link-crawls"), json={}, headers=owner.headers)

    assert problem(response) == (422, "budget_exceeded")
    assert response.json()["budget_id"] == str(budget_id)
    assert await fetch(migrated, "SELECT 1 FROM seo.crawl_runs WHERE project_id = $1", project) == []


async def test_a_higher_limit_needs_a_crawl_that_stopped_at_its_ceiling(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")

    refused = await api.post(url, json={"higher_limit": True}, headers=owner.headers)
    stopped, _ = await seed_crawl(migrated, workspace, project, [("/", 200)], state="stopped_at_ceiling")
    retried = await api.post(url, json={"higher_limit": True}, headers=owner.headers)

    assert problem(refused) == (422, "validation_failed")
    assert retried.json()["data"]["trigger"] == "ceiling_retry"
    assert retried.json()["data"]["ceiling"] == 4000
    assert stopped is not None


async def test_cancel_ends_a_queued_crawl_and_asks_the_worker_to_stop_a_running_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")
    queued = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]

    cancelled = await api.post(f"{url}/{queued}/cancel", headers=owner.headers)
    again = await api.post(f"{url}/{queued}/cancel", headers=owner.headers)
    running = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]
    await execute(migrated, "UPDATE seo.crawl_runs SET state = 'crawling' WHERE id = $1", running)
    asked = await api.post(f"{url}/{running}/cancel", headers=owner.headers)

    assert cancelled.json()["data"]["state"] == "cancelled"
    assert problem(again) == (409, "invalid_state_transition")
    assert asked.json()["data"]["state"] == "crawling"
    row = await fetchrow(migrated, "SELECT cancel_requested FROM seo.crawl_runs WHERE id = $1", running)
    assert row["cancel_requested"] is True


@pytest.mark.parametrize("role", ["viewer"])
async def test_viewers_read_crawls_and_cannot_start_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "link-crawls")

    read = await api.get(f"{url}/{run}", headers=caller.headers)
    started = await api.post(url, json={}, headers=caller.headers)

    assert read.json()["data"]["is_latest"] is True
    assert started.status_code == 403


async def test_another_workspace_cannot_read_or_start_these_crawls(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")
    url = project_url(workspace, project, "link-crawls")

    read = await api.get(f"{url}/{run}", headers=stranger.headers)
    started = await api.post(url, json={}, headers=stranger.headers)

    assert (read.status_code, started.status_code) == (404, 404)


async def test_a_new_project_with_the_box_ticked_queues_its_first_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    body = {"name": "Site", "slug": "site-crawled", "primary_domain": "example.com"}

    ticked = await api.post(
        f"/api/v1/workspaces/{workspace.id}/projects",
        json={**body, "map_internal_links": True},
        headers=owner.headers,
    )
    plain = await api.post(
        f"/api/v1/workspaces/{workspace.id}/projects",
        json={**body, "slug": "site-plain"},
        headers=owner.headers,
    )

    assert ticked.status_code == 201, ticked.text
    runs = await fetch(
        migrated,
        "SELECT project_id, trigger FROM seo.crawl_runs WHERE workspace_id = $1",
        workspace.id,
    )
    assert [(str(row["project_id"]), row["trigger"]) for row in runs] == [
        (ticked.json()["data"]["project_id"], "website_added")
    ]
    assert plain.status_code == 201
```

`backend/tests/api/internal_links/test_link_settings.py`:

```python
"""The project's internal links settings (spec 7.8)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_settings_default_to_weekly_without_javascript(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(project_url(workspace, project, "settings"), headers=viewer.headers)

    assert response.json()["data"]["internal_links"] == {
        "schedule": "weekly",
        "render_javascript": False,
        "allowed_subdomains": [],
    }


async def test_a_patch_of_the_internal_links_part_keeps_the_seo_part(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    url = project_url(workspace, project, "settings")
    await api.patch(url, json={"seo": {"default_device": "mobile"}}, headers=editor.headers)

    response = await api.patch(
        url,
        json={"internal_links": {"schedule": "monthly", "allowed_subdomains": ["Blog.Example.com"]}},
        headers=editor.headers,
    )
    bad = await api.patch(url, json={"internal_links": {"schedule": "daily"}}, headers=editor.headers)

    data = response.json()["data"]
    assert data["seo"]["default_device"] == "mobile"
    assert data["internal_links"] == {
        "schedule": "monthly",
        "render_javascript": False,
        "allowed_subdomains": ["blog.example.com"],
    }
    assert problem(bad) == (422, "validation_failed")
```

Change the expected body of `test_a_new_project_has_the_default_settings` in `backend/tests/api/operations/test_settings.py`: after `"seo": {...},` add `"internal_links": {"schedule": "weekly", "render_javascript": False, "allowed_subdomains": []},`.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/internal_links/test_crawls.py tests/api/internal_links/test_link_settings.py tests/api/operations/test_settings.py -q`
Expected: failures: `404` for `link-crawls`, the unknown member `map_internal_links` (422), and no `internal_links` in the settings.

- [ ] **Step 3: The settings**

In `backend/src/idraft/api/schemas/operations.py`, after `SeoSettings`:

```python
CrawlScheduleName = Literal["weekly", "every_two_weeks", "monthly", "off"]
SUBDOMAINS_MAX: Final = 10


def _hosts(value: list[str]) -> list[str]:
    """Allowed subdomains as `core.domains` writes hosts; each one once."""
    found: list[str] = []
    for given in value:
        host = normalize_host(given).name
        if host not in found:
            found.append(host)
    return found


SubdomainList = Annotated[
    list[Annotated[str, StringConstraints(min_length=1, max_length=253)]],
    Field(max_length=SUBDOMAINS_MAX),
    AfterValidator(_hosts),
]


class InternalLinksSettings(BaseModel):
    schedule: CrawlScheduleName = "weekly"
    render_javascript: bool = Field(
        default=False, description="Crawls render JavaScript; each page costs ten times as much."
    )
    allowed_subdomains: list[str] = Field(default_factory=list)


class InternalLinksSettingsPatch(Patch):
    schedule: CrawlScheduleName | None = None
    render_javascript: bool | None = None
    allowed_subdomains: SubdomainList | None = None

    _not_null = field_validator("schedule", "render_javascript", "allowed_subdomains")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> InternalLinksSettingsPatch:
        if not self.model_fields_set:
            raise ValueError("give at least one setting to change")
        return self
```

`ProjectSettings` gains `internal_links: InternalLinksSettings = Field(default_factory=InternalLinksSettings)` after `seo`. `ProjectSettingsPatch` becomes:

```python
class ProjectSettingsPatch(Body):
    """A JSON merge patch (RFC 7396) of the settings: members left out keep their value."""

    seo: SeoSettingsPatch | None = None
    internal_links: InternalLinksSettingsPatch | None = None

    @model_validator(mode="after")
    def _says_something(self) -> ProjectSettingsPatch:
        if self.seo is None and self.internal_links is None:
            raise ValueError("give `seo` or `internal_links`")
        return self
```

with `normalize_host` imported from `idraft.extraction.urls` and `AfterValidator`, `StringConstraints`, `Final`, `Annotated` imported where missing. A host `normalize_host` refuses raises `ValueError`, which Pydantic reports as a field error.

In `backend/src/idraft/api/operations/settings.py`:

```python
def _view(stored: Mapping[str, Any], entity_config_version: int) -> ProjectSettings:
    return ProjectSettings(
        seo=SeoSettings.model_validate(stored.get("seo") or {}),
        internal_links=InternalLinksSettings.model_validate(stored.get("internal_links") or {}),
        entity_config_version=entity_config_version,
    )


def _snapshot(stored: Mapping[str, Any]) -> audit.Snapshot:
    """Both parts as an audit entry holds them: one member per setting."""
    seo = SeoSettings.model_validate(stored.get("seo") or {}).model_dump(mode="json")
    links = InternalLinksSettings.model_validate(stored.get("internal_links") or {}).model_dump(
        mode="json"
    )
    return {
        **{f"seo.{name}": value for name, value in seo.items()},
        **{f"internal_links.{name}": value for name, value in links.items()},
    }
```

`_seo_snapshot` is replaced by `_snapshot` at its two calls, and `update` merges both parts:

```python
            changed = dict(stored)
            for part, patch in (("seo", body.seo), ("internal_links", body.internal_links)):
                if patch is not None:
                    changed[part] = {
                        **(stored.get(part) or {}),
                        **patch.model_dump(mode="json", exclude_unset=True),
                    }
```

The module docstring's first sentence becomes "Project settings (docs/19 section 3.3; doc 04 section 4): the `seo` defaults tracked keyword creation uses and the `internal_links` crawl settings (internal links plan 02)." Existing audit tests that read `seo.*` members keep passing: the entry gains `internal_links.*` members beside them.

- [ ] **Step 4: Crawl schemas, service and routes**

Append to `backend/src/idraft/api/schemas/internal_links.py`:

```python
CrawlState = Literal[
    "queued", "crawling", "processing", "ready", "stopped_at_ceiling", "failed", "cancelled"
]
CrawlTrigger = Literal["website_added", "schedule", "manual", "ceiling_retry"]


class CrawlRun(BaseModel):
    run_id: UUID
    trigger: CrawlTrigger
    state: CrawlState
    ceiling: int = Field(description="The safety stop: the crawl ends at this many pages.")
    pages_found: int = Field(description="Crawled and still queued, while it runs.")
    pages_crawled: int
    sitemap_pages: int | None
    render_javascript: bool
    estimated_cost_usd: Usd | None
    cost_usd: Usd | None
    stop_reason: str | None
    error_code: str | None
    error_message: str | None
    hints: list[Literal["render_javascript"]]
    is_latest: bool = Field(description="The crawl `run=latest` reads.")
    created_at: datetime
    submitted_at: datetime | None
    finished_at: datetime | None
    requested_by: UserRef | None


class CrawlRunPage(BaseModel):
    data: list[CrawlRun]
    page: CursorPageInfo


class CrawlRunResponse(BaseModel):
    data: CrawlRun


class CrawlCreate(Body):
    higher_limit: bool = Field(
        default=False,
        description="Crawl again with a higher limit after a crawl stopped at its ceiling.",
    )
```

(`Usd` from `idraft.api.schemas.metrics`, `UserRef` from `idraft.api.schemas.common`, `CursorPageInfo` from `idraft.api.pagination`.)

`backend/src/idraft/api/internal_links/crawls.py`:

```python
"""Crawl now, the crawl list and cancel (spec 6.2 and 9; decisions D5, D13 to D15).

A crawl is queued here and moved on by the worker (`idraft.collectors.crawl_runs`). Crawl now is
judged against the budget in the request, so a crawl a budget would stop is refused and never
queued. Cancel ends a queued crawl at once and asks the worker to stop a running one.
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import Row, Select, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.problems import (
    BudgetExceededError,
    CrawlInProgressError,
    NoWebsiteError,
)
from idraft.api.pagination import CursorParams, cursor_instant, decode_cursor, encode_cursor
from idraft.api.problems import InvalidStateTransitionError, NotFoundError, invalid_field
from idraft.api.request_info import RequestInfo
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors import budget
from idraft.collectors.crawl_runs import (
    FEW_PAGES,
    CrawlBusyError,
    NoSiteError,
    NoStoppedCrawlError,
    queue_run,
)
from idraft.collectors.crawl_store import latest_run
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_runs, users
from idraft.domain.workloads import CostWorkload

_LIST_SCOPE = {"list": "link-crawls"}


def runs_query(workspace_id: UUID, project_id: UUID) -> Select[Any]:
    return (
        select(crawl_runs, users.c.name.label("requester_name"), users.c.email.label("requester_email"))
        .outerjoin(users, users.c.id == crawl_runs.c.requested_by)
        .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.project_id == project_id)
    )


def hints(run: Row[Any]) -> list[Literal["render_javascript"]]:
    few = run.state == "ready" and run.pages_crawled <= FEW_PAGES
    return ["render_javascript"] if few and not run.settings.get("render_javascript") else []


class CrawlService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def _one(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, run_id: UUID
    ) -> Row[Any]:
        row = (
            await db.execute(runs_query(access.workspace_id, project_id).where(crawl_runs.c.id == run_id))
        ).one_or_none()
        if row is None:
            raise NotFoundError
        return row

    async def list(
        self, access: WorkspaceAccess, project_id: UUID, page: CursorParams
    ) -> tuple[list[Row[Any]], UUID | None, str | None]:
        """Newest first; the latest finished crawl's id; the next cursor."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            statement = runs_query(access.workspace_id, project_id)
            if page.cursor is not None:
                created, run_id = decode_cursor(page.cursor, scope=_LIST_SCOPE)
                statement = statement.where(
                    tuple_(crawl_runs.c.created_at, crawl_runs.c.id)
                    < tuple_(cursor_instant(created), UUID(str(run_id)))
                )
            rows = list(
                (
                    await db.execute(
                        statement.order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
                        .limit(page.limit + 1)
                    )
                ).all()
            )
            latest = await latest_run(db, access.workspace_id, project_id)
        more = len(rows) > page.limit
        rows = rows[: page.limit]
        cursor = (
            encode_cursor([rows[-1].created_at.isoformat(), str(rows[-1].id)], scope=_LIST_SCOPE)
            if more
            else None
        )
        return rows, latest, cursor

    async def get(
        self, access: WorkspaceAccess, project_id: UUID, run_id: UUID
    ) -> tuple[Row[Any], UUID | None]:
        async with self._transaction(access) as db:
            row = await self._one(db, access, project_id, run_id)
            return row, await latest_run(db, access.workspace_id, project_id)

    async def start(
        self, access: WorkspaceAccess, project_id: UUID, higher_limit: bool, info: RequestInfo
    ) -> tuple[Row[Any], UUID | None]:
        now = datetime.now(UTC)
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            try:
                run_id = await queue_run(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    trigger="ceiling_retry" if higher_limit else "manual",
                    requested_by=access.user_id,
                    now=now,
                )
            except NoSiteError:
                raise NoWebsiteError from None
            except CrawlBusyError as busy:
                raise CrawlInProgressError(run_id=str(busy.run_id)) from None
            except NoStoppedCrawlError:
                raise invalid_field(
                    "higher_limit",
                    code="no_stopped_crawl",
                    message="The latest crawl did not stop at its ceiling.",
                ) from None
            row = await self._one(db, access, project_id, run_id)
            verdict = await budget.check(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=CostWorkload.SITE_CRAWL,
                now=now,
                estimate=row.estimated_cost_usd,
            )
            if verdict.blocked_by is not None:
                # Raised inside the transaction: the queued row goes with it.
                raise BudgetExceededError(budget_id=str(verdict.blocked_by))
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="link_crawl.requested",
                target_type="link_crawl",
                target_id=run_id,
                info=info,
                after={"trigger": row.trigger, "ceiling": row.ceiling},
            )
            return row, await latest_run(db, access.workspace_id, project_id)

    async def cancel(
        self, access: WorkspaceAccess, project_id: UUID, run_id: UUID, info: RequestInfo
    ) -> tuple[Row[Any], UUID | None]:
        async with self._transaction(access) as db:
            run = (
                await db.execute(
                    select(crawl_runs.c.state)
                    .where(
                        crawl_runs.c.workspace_id == access.workspace_id,
                        crawl_runs.c.project_id == project_id,
                        crawl_runs.c.id == run_id,
                    )
                    .with_for_update()
                )
            ).one_or_none()
            if run is None:
                raise NotFoundError
            where = (crawl_runs.c.workspace_id == access.workspace_id) & (crawl_runs.c.id == run_id)
            if run.state == "queued":
                await db.execute(
                    update(crawl_runs).where(where).values(state="cancelled", finished_at=datetime.now(UTC))
                )
            elif run.state == "crawling":
                await db.execute(update(crawl_runs).where(where).values(cancel_requested=True))
            else:
                raise InvalidStateTransitionError("Only a queued or running crawl can be cancelled.")
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="link_crawl.cancelled",
                target_type="link_crawl",
                target_id=run_id,
                info=info,
                before={"state": run.state},
            )
            row = await self._one(db, access, project_id, run_id)
            return row, await latest_run(db, access.workspace_id, project_id)
```

A queued crawl the API cancels may already be locked by the worker's post; the `FOR UPDATE` waits for it, and a crawl the worker has meanwhile moved to `crawling` is cancelled through `cancel_requested`.

`backend/src/idraft/api/internal_links/crawl_routes.py`:

```python
"""A project's crawls (spec 6.2 and 9). Reading needs `data:read`; Crawl now and cancel need
`runs:trigger` (decision D15)."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import Row

from idraft.api.internal_links.crawls import CrawlService, hints
from idraft.api.pagination import Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.common import UserRef
from idraft.api.schemas.internal_links import CrawlCreate, CrawlRun, CrawlRunPage, CrawlRunResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls",
    tags=["internal-links"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
TriggerRuns = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]


def get_crawls(resources: Annotated[Resources, Depends(get_resources)]) -> CrawlService:
    return resources.crawls


Crawls = Annotated[CrawlService, Depends(get_crawls)]


def crawl_view(row: Row[Any], latest: UUID | None) -> CrawlRun:
    return CrawlRun(
        run_id=row.id,
        trigger=row.trigger,
        state=row.state,
        ceiling=row.ceiling,
        pages_found=row.pages_found,
        pages_crawled=row.pages_crawled,
        sitemap_pages=row.sitemap_pages,
        render_javascript=bool(row.settings.get("render_javascript")),
        estimated_cost_usd=row.estimated_cost_usd,
        cost_usd=row.cost_usd,
        stop_reason=row.stop_reason,
        error_code=row.error_code,
        error_message=row.error_message,
        hints=hints(row),
        is_latest=row.id == latest,
        created_at=row.created_at,
        submitted_at=row.submitted_at,
        finished_at=row.finished_at,
        requested_by=None
        if row.requested_by is None
        else UserRef(user_id=row.requested_by, name=row.requester_name, email=row.requester_email),
    )


@router.get("", summary="The project's crawls, newest first")
async def list_crawls(
    project_id: UUID, access: ReadData, crawls: Crawls, page: Cursor
) -> CrawlRunPage:
    rows, latest, cursor = await crawls.list(access, project_id, page)
    return CrawlRunPage(
        data=[crawl_view(row, latest) for row in rows],
        page=CursorPageInfo(limit=page.limit, next_cursor=cursor, has_more=cursor is not None),
    )


@router.post(
    "",
    status_code=202,
    summary="Crawl now",
    description="Queues a crawl of the project's website. One crawl per project runs at a time "
    "(`409 crawl_in_progress` with its `run_id`). `422 no_website` without a website; `422 "
    "budget_exceeded` (with `budget_id`) when the crawl would pass a budget, and nothing is "
    "queued. `higher_limit` crawls again after a crawl stopped at its ceiling, with twice the "
    "limit or what the sitemap asks for.",
)
async def start_crawl(
    project_id: UUID, body: CrawlCreate, access: TriggerRuns, crawls: Crawls, info: Info
) -> CrawlRunResponse:
    row, latest = await crawls.start(access, project_id, body.higher_limit, info)
    return CrawlRunResponse(data=crawl_view(row, latest))


@router.get("/{run_id}", summary="One crawl, with its progress")
async def get_crawl(
    project_id: UUID, run_id: UUID, access: ReadData, crawls: Crawls
) -> CrawlRunResponse:
    row, latest = await crawls.get(access, project_id, run_id)
    return CrawlRunResponse(data=crawl_view(row, latest))


@router.post(
    "/{run_id}/cancel",
    summary="Cancel a queued or running crawl",
    description="A queued crawl ends at once; a running one is stopped by the worker within a "
    "minute. `409 invalid_state_transition` for any other state.",
)
async def cancel_crawl(
    project_id: UUID, run_id: UUID, access: TriggerRuns, crawls: Crawls, info: Info
) -> CrawlRunResponse:
    row, latest = await crawls.cancel(access, project_id, run_id, info)
    return CrawlRunResponse(data=crawl_view(row, latest))
```

- [ ] **Step 5: Website added**

`backend/src/idraft/api/schemas/projects.py`, in `ProjectCreate` after `primary_domain`:

```python
    map_internal_links: bool = Field(
        default=False,
        description="With `primary_domain`, queue the first crawl of the site's internal links. "
        "The web form sends true (the checkbox is ticked by default).",
    )
```

`backend/src/idraft/api/projects/routes.py`: pass `map_internal_links=body.map_internal_links` to `projects.create`. `backend/src/idraft/api/projects/service.py`: `create` takes `map_internal_links: bool = False` and, right after the `project.created` audit entry, when it is true and `domain_id` is not None:

```python
                if map_internal_links and domain_id is not None:
                    await queue_run(
                        db,
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        trigger="website_added",
                        requested_by=access.user_id,
                        now=datetime.now(UTC),
                    )
```

with `from idraft.collectors.crawl_runs import queue_run`. A new project has no crawl, so `CrawlBusyError` cannot be raised here, and no budget check is made (spec 6.2: onboarding never waits; the worker checks the budget before posting).

- [ ] **Step 6: Wiring, route table, contract**

`resources.py`: `crawls: CrawlService`; `main.py`: `crawls=CrawlService(sessions=sessions)`, include `crawl_routes.router`. `test_route_access.py`:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls"): (
        "runs:trigger"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls/{run_id}"): (
        "data:read"
    ),
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls/{run_id}/cancel",
    ): "runs:trigger",
```

```bash
uv run pytest --no-cov tests/api/internal_links tests/api/operations/test_settings.py tests/api/projects tests/api/test_route_access.py -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest --no-cov tests/api/test_openapi.py -q
```

Expected: all pass.

- [ ] **Step 7: Gate and commit**

```bash
git add backend/src/idraft/api/internal_links/crawls.py backend/src/idraft/api/internal_links/crawl_routes.py \
  backend/src/idraft/api/schemas/internal_links.py backend/src/idraft/api/schemas/operations.py \
  backend/src/idraft/api/operations/settings.py backend/src/idraft/api/schemas/projects.py \
  backend/src/idraft/api/projects/routes.py backend/src/idraft/api/projects/service.py \
  backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/test_route_access.py \
  backend/openapi/v1.json backend/tests/api/operations/test_settings.py \
  backend/tests/api/internal_links/test_crawls.py backend/tests/api/internal_links/test_link_settings.py
git commit -m "Internal links: crawl now, cancel, crawl settings and the website-added crawl"
```

---

### Task 11: Ingest, and the worker wiring

**Files:**
- Create: `backend/src/idraft/collectors/crawl_ingest.py`
- Modify: `backend/src/idraft/worker/assembly.py` (the `crawl` tick and the `crawl_ingest` job)
- Modify: `backend/tests/collectors/crawl_support.py` (the synthetic site)
- Test: `backend/tests/collectors/test_crawl_ingest.py`, `backend/tests/worker/test_assembly.py` (one test added)

- [ ] **Step 1: The synthetic site**

Append to `backend/tests/collectors/crawl_support.py`:

```python
SITE = "https://example.com"
_NAV = (
    '<header><nav><a href="/">Home</a><a href="/pricing">Pricing</a>'
    '<a href="/blog">Blog</a></nav></header>'
)
_FOOTER = '<footer><a href="/privacy">Privacy</a></footer>'


def page_html(
    main: str, *, article: bool = False, prev: str | None = None, next_: str | None = None
) -> str:
    """A page of the synthetic site: menu, main content, previous and next as on
    cleanstart.com (a section labelled "Article navigation" outside the article), footer."""
    body = f"<article>{main}</article>" if article else main
    steps = [
        f'<a rel="{rel}" href="{href}">{label}: {href}</a>'
        for rel, label, href in (("prev", "Previous", prev), ("next", "Next", next_))
        if href is not None
    ]
    joined = "".join(steps)
    section = f'<section aria-label="Article navigation">{joined}</section>' if steps else ""
    return f"<html><body>{_NAV}<main>{body}{section}</main>{_FOOTER}</body></html>"


def synthetic_site() -> FakeOnPage:
    """Eleven pages. `/blog/d` is reached only through "Next" (deep only through previous and
    next, and an editorial orphan); `/orphan` is in the sitemap and linked from nowhere, and
    its HTML is missing (placement unknown); `/old` redirects to `/pricing`; `/gone` is 404."""
    html = {
        f"{SITE}/": page_html('<p><a href="/blog/a">Read our guide</a></p>'),
        # Another container than the home page's paragraph: two pages of four sharing one
        # block of one changing link would be a template block to plan 01's pass.
        f"{SITE}/pricing": page_html(
            '<div class="intro"><a href="/blog/c">How it works</a></div>'
        ),
        f"{SITE}/blog": page_html(
            '<ul><li><a href="/blog/a">A</a></li>'
            '<li><a href="/blog/b">B</a></li></ul>'
        ),
        f"{SITE}/blog/a": page_html(
            '<p><a href="/pricing">See plans</a></p>', article=True, next_="/blog/b"
        ),
        f"{SITE}/blog/b": page_html(
            "<p>No links here.</p>", article=True, prev="/blog/a", next_="/blog/c"
        ),
        f"{SITE}/blog/c": page_html(
            '<p><a href="/old">Old page</a> and <a href="/gone">a gone page</a></p>',
            article=True,
            prev="/blog/b",
            next_="/blog/d",
        ),
        f"{SITE}/blog/d": page_html("<p>The end.</p>", article=True, prev="/blog/c"),
        f"{SITE}/privacy": page_html("<p>Privacy.</p>"),
    }

    def item(path: str, status: int = 200, *, location: str | None = None, sitemap: bool = False) -> PageItem:
        return PageItem(
            url=f"{SITE}{path}",
            status_code=status,
            resource_type="redirect" if location else ("broken" if status >= 400 else "html"),
            location=location,
            title=path,
            canonical=None,
            from_sitemap=sitemap,
        )

    pages = [
        item("/", sitemap=True),
        item("/pricing", sitemap=True),
        item("/blog"),
        item("/blog/a"),
        item("/blog/b"),
        item("/blog/c"),
        item("/blog/d"),
        item("/privacy"),
        item("/orphan", sitemap=True),
        item("/old", 301, location=f"{SITE}/pricing"),
        item("/gone", 404),
    ]
    return FakeOnPage(
        pages=pages,
        html=html,
        summaries=[summary(finished=True, crawled=len(pages))],
        non_indexable_items=[NonIndexableItem(url=f"{SITE}/privacy", reason="meta_tag")],
    )
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/collectors/test_crawl_ingest.py`:

```python
"""Ingest of a finished crawl (spec 6.3 and 6.4; plan decisions D7 to D12)."""

from __future__ import annotations

import time
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_ingest import INGEST_FAILURES_MAX, html_key, ingest_run
from idraft.collectors.crawl_runs import CrawlIngestTask, crawl_tick, queue_run
from idraft.domain.retries import ProviderErrorKind
from idraft.extraction.urls import canonicalize
from idraft.providers.contract import ProviderError
from idraft.storage.raw import decompress
from tests.api.auth.support import fetch, fetchrow
from tests.collectors.crawl_support import (
    SITE,
    FakeOnPage,
    clear_crawls,
    site_project,
    synthetic_site,
)
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


async def _crawled(
    pg: PostgresServer, sessions: Sessions, on_page: FakeOnPage
) -> tuple[CrawlIngestTask, uuid.UUID]:
    """A project with a crawl the provider has finished, handed to ingest by the tick."""
    workspace, project = await site_project(pg)
    sent: list[CrawlIngestTask] = []

    async def send(task: CrawlIngestTask) -> bool:
        sent.append(task)
        return True

    async with sessions() as db, db.begin():
        await queue_run(
            db,
            workspace_id=workspace.id,
            project_id=project,
            trigger="manual",
            requested_by=None,
            now=NOW,
        )
    await crawl_tick(sessions, on_page, send, now=NOW)  # posts
    await crawl_tick(sessions, on_page, send, now=NOW)  # reads the finished summary
    return sent[-1], project


async def _pages(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, dict[str, object]]:
    rows = await fetch(
        pg,
        "SELECT u.path, p.* FROM seo.crawl_pages p JOIN core.urls u ON u.id = p.url_id "
        "WHERE p.run_id = $1",
        run_id,
    )
    return {row["path"]: dict(row) for row in rows}


async def test_a_crawl_becomes_pages_links_and_metrics(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    store = MemoryStore()
    task, project = await _crawled(migrated, worker_db, on_page)

    outcome = await ingest_run(worker_db, on_page, store, task, deadline=time.monotonic() + 60)

    run = await fetchrow(migrated, "SELECT * FROM seo.crawl_runs WHERE id = $1", task.run_id)
    assert (run["state"], run["ingest_phase"], outcome.failed) == ("ready", "done", False)
    assert run["sitemap_pages"] == 3
    pages = await _pages(migrated, task.run_id)
    assert len(pages) == 11
    depth = {path: page["click_depth"] for path, page in pages.items()}
    assert depth == {
        "/": 0, "/pricing": 1, "/blog": 1, "/blog/a": 1, "/privacy": 1, "/blog/b": 2,
        "/blog/c": 2, "/blog/d": 3, "/old": 3, "/gone": 3, "/orphan": None,
    }
    pricing = pages["/pricing"]
    assert (
        pricing["linking_pages_editorial"],
        pricing["linking_pages_template"],
        pricing["linking_pages_all"],
        pricing["top_anchor"],
    ) == (1, 7, 7, "See plans")
    assert (pages["/blog/c"]["broken_outlinks"], pages["/blog/c"]["redirect_outlinks"]) == (1, 1)
    assert pages["/blog/d"]["deep_only_through_auto"] and pages["/blog/d"]["is_editorial_orphan"]
    assert pages["/orphan"]["is_orphan"] and pages["/orphan"]["links_state"] == "from_provider"
    assert pages["/privacy"]["is_indexable"] is False
    assert pages["/privacy"]["non_indexable_reason"] == "meta_tag"
    assert pages["/old"]["redirect_url_id"] == pricing["url_id"]
    shares = [page["equity_share"] for page in pages.values()]
    assert sum(shares) == pytest.approx(1.0)
    assert pricing["equity_share"] > pages["/blog/d"]["equity_share"]
    scopes = await fetch(
        migrated,
        "SELECT u.path, l.scope FROM seo.crawl_links l JOIN core.urls u ON u.id = l.target_url_id "
        "WHERE l.run_id = $1 AND l.source_url_id = $2",
        task.run_id,
        pages["/blog/c"]["url_id"],
    )
    assert {(row["path"], row["scope"]) for row in scopes} >= {
        ("/blog/d", "auto_generated"),
        ("/blog/b", "auto_generated"),
        ("/old", "editorial"),
        ("/pricing", "template"),
    }
    key = html_key(project, canonicalize(f"{SITE}/pricing").url_hash)
    assert b"How it works" in decompress(store.objects[key])
    flow = await fetch(migrated, "SELECT 1 FROM seo.crawl_tier_flow WHERE run_id = $1", task.run_id)
    assert flow


async def test_ingest_carries_on_from_its_checkpoint(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    task, _ = await _crawled(migrated, worker_db, on_page)

    passes = 0
    while passes < 50:
        passes += 1
        # An expired deadline: each pass takes one step and stops.
        await ingest_run(worker_db, on_page, None, task, deadline=0.0)
        run = await fetchrow(migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", task.run_id)
        if run["state"] != "processing":
            break

    pages = await _pages(migrated, task.run_id)
    assert run["state"] == "ready"
    assert passes > 5
    assert pages["/pricing"]["linking_pages_template"] == 7


async def test_a_start_page_that_refuses_the_crawler_fails_the_crawl(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.pages[0] = on_page.pages[0].model_copy(update={"status_code": 403, "resource_type": "broken"})
    task, _ = await _crawled(migrated, worker_db, on_page)

    await ingest_run(worker_db, on_page, None, task, deadline=time.monotonic() + 60)

    run = await fetchrow(migrated, "SELECT state, error_code FROM seo.crawl_runs WHERE id = $1", task.run_id)
    assert (run["state"], run["error_code"]) == ("failed", "site_blocked")


async def test_a_pass_that_keeps_failing_ends_the_crawl_and_keeps_the_last_good_one(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.html_error = ProviderError(kind=ProviderErrorKind.PROVIDER_ERROR, message="boom")
    task, _ = await _crawled(migrated, worker_db, on_page)

    for _ in range(INGEST_FAILURES_MAX):
        await ingest_run(worker_db, on_page, None, task, deadline=time.monotonic() + 60)

    run = await fetchrow(
        migrated, "SELECT state, error_code, ingest_failures FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    assert (run["state"], run["error_code"], run["ingest_failures"]) == (
        "failed",
        "ingest_failed",
        INGEST_FAILURES_MAX,
    )
```

Format with `ruff format`; it wraps the long lines.

- [ ] **Step 3: Run them to see them fail**

Run: `uv run pytest --no-cov tests/collectors/test_crawl_ingest.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.collectors.crawl_ingest'`.

- [ ] **Step 4: Write the ingest**

`backend/src/idraft/collectors/crawl_ingest.py`:

```python
"""Reading a finished crawl into pages, links and metrics (spec 6.3 and 6.4; plan decisions D7
to D12).

Ingest works in phases kept on the run row (`ingest_phase`, `ingest_token`, `ingest_offset`).
Each step commits its rows and the next checkpoint together, so a pass can stop after any step
and the next pass, on any worker, carries on:

- `pages`: the crawled pages, 1,000 a step, their URLs added to `core.urls`; the crawl's link
  partition is made first, and a start page that refuses the crawler ends the crawl;
- `non_indexable`: the pages search engines may not index;
- `links`: 25 pages a step: each page's raw HTML (kept in R2, latest only), the classifier and
  the page's edges; the provider's links for a page with no HTML, all `content`;
- `template`: the second placement pass;
- `metrics`: counts, flags, depth and equity, the rule tiers and the tier flow; then the crawl
  is `ready`, or `stopped_at_ceiling` when the provider stopped it there.

A failed step is tried again by the next pass (the tick sends one every minute while the crawl
processes); after five failed passes the crawl ends `failed` with `ingest_failed`, and the
crawl before it stays the latest. Every statement names the run: the worker bypasses row-level
security.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final
from uuid import UUID

import structlog
from sqlalchemy import Row, bindparam, delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import aliased

from idraft.collectors.crawl_runs import CrawlIngestTask
from idraft.collectors.crawl_store import apply_rules, recompute_tier_flow
from idraft.crawl.edges import PageEdge, page_edges
from idraft.crawl.graph import Link, Node, click_depths, deep_only_through_auto, pagerank
from idraft.crawl.hosts import site_hosts
from idraft.crawl.placement import FoundLink, Placement, classify
from idraft.crawl.scopes import LinkScope, scope_of
from idraft.crawl.template import TemplateRow, template_placements
from idraft.db import dictionaries
from idraft.db.tables import crawl_links, crawl_pages, crawl_runs, urls
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize
from idraft.providers.dataforseo.on_page import LinkItem, OnPageApi
from idraft.storage.raw import ObjectStore, compress

# A pass ends well inside the queue's handler limit (8 minutes, worker/queues.py).
PASS_TIME: Final = timedelta(minutes=6)
INGEST_FAILURES_MAX: Final = 5
HTML_PAGES_PER_STEP: Final = 25
_LINK_ROWS_PER_STATEMENT: Final = 2_000
_RESOURCE_TYPES: Final = frozenset({"html", "redirect", "broken"})
_REASONS: Final = frozenset(
    {"robots_txt", "meta_tag", "http_header", "attribute", "too_many_redirects"}
)
_REFUSED: Final = frozenset({401, 403})
_log = structlog.get_logger(__name__)

type Step = Callable[
    [async_sessionmaker[AsyncSession], OnPageApi, ObjectStore | None, Row[Any]], Awaitable[None]
]


@dataclass(frozen=True, slots=True)
class IngestOutcome:
    phase: str | None
    steps: int
    failed: bool = False


def html_key(project_id: UUID, url_hash: bytes) -> str:
    """Where a page's latest raw HTML is kept (decision D9): one object per project and URL,
    overwritten by the next crawl."""
    return f"crawl/v1/html/{project_id}/{url_hash.hex()}.html.zst"


def _canonical(raw: str | None) -> CanonicalUrl | None:
    if not raw:
        return None
    try:
        return canonicalize(raw)
    except UrlRejectedError:
        return None


async def _set_run(db: AsyncSession, run: Row[Any], **values: object) -> None:
    await db.execute(
        update(crawl_runs)
        .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
        .values(**values)
    )


async def _pages(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: Row[Any],
) -> None:
    batch = await on_page.pages(run.provider_task_id, token=run.ingest_token)
    found = [
        (item, url, _canonical(item.location), _canonical(item.canonical))
        for item in batch.items
        if (url := _canonical(item.url)) is not None
    ]
    async with sessions() as db, db.begin():
        if run.ingest_token is None:
            await db.execute(
                text("SELECT seo.add_crawl_links_partition(:run_id)"), {"run_id": run.id}
            )
        known = await dictionaries.urls_for(
            db, [url for row in found for url in row[1:] if url is not None]
        )
        values = []
        for item, url, redirect, canonical in found:
            url_id = known[url.url_hash].id
            canonical_id = None if canonical is None else known[canonical.url_hash].id
            elsewhere = canonical_id is not None and canonical_id != url_id
            values.append(
                {
                    "run_id": run.id,
                    "url_id": url_id,
                    "workspace_id": run.workspace_id,
                    "project_id": run.project_id,
                    "crawled_url": item.url[:8192],
                    "status_code": item.status_code,
                    "resource_type": item.resource_type
                    if item.resource_type in _RESOURCE_TYPES
                    else "other",
                    "redirect_url_id": None if redirect is None else known[redirect.url_hash].id,
                    "is_indexable": not elsewhere,
                    "non_indexable_reason": "canonical" if elsewhere else None,
                    "canonical_url_id": canonical_id,
                    "title": None if item.title is None else item.title[:1000],
                    "in_sitemap": item.from_sitemap,
                    "links_state": "waiting"
                    if item.resource_type == "html" and item.status_code == 200
                    else "none",
                }
            )
        if values:
            await db.execute(upsert(crawl_pages).values(values).on_conflict_do_nothing())
        if batch.token is not None:
            await _set_run(db, run, ingest_token=batch.token)
            return
        start = canonicalize(f"https://{run.target_host}/")
        start_id = (await dictionaries.urls_for(db, [start]))[start.url_hash].id
        status = (
            await db.execute(
                select(crawl_pages.c.status_code).where(
                    crawl_pages.c.run_id == run.id, crawl_pages.c.url_id == start_id
                )
            )
        ).scalar_one_or_none()
        if status in _REFUSED:
            await _set_run(
                db,
                run,
                state="failed",
                error_code="site_blocked",
                error_message="The start page refuses the crawler.",
                finished_at=datetime.now(UTC),
            )
            return
        await _set_run(
            db, run, ingest_phase="non_indexable", ingest_token=None, ingest_offset=0, start_url_id=start_id
        )


async def _non_indexable(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: Row[Any],
) -> None:
    batch = await on_page.non_indexable(run.provider_task_id, offset=run.ingest_offset)
    by_reason: dict[str, list[CanonicalUrl]] = {}
    for item in batch.items:
        url = _canonical(item.url)
        if url is not None and item.reason in _REASONS:
            by_reason.setdefault(item.reason, []).append(url)
    offset = run.ingest_offset + len(batch.items)
    async with sessions() as db, db.begin():
        known = await dictionaries.urls_for(db, [url for found in by_reason.values() for url in found])
        for reason, found in by_reason.items():
            await db.execute(
                update(crawl_pages)
                .where(
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.url_id.in_([known[url.url_hash].id for url in found]),
                )
                .values(is_indexable=False, non_indexable_reason=reason)
            )
        done = not batch.items or offset >= batch.total
        await _set_run(db, run, ingest_offset=offset, ingest_phase="links" if done else "non_indexable")


def _as_found(link: LinkItem) -> FoundLink:
    """A link the provider found, for a page whose HTML is missing: its placement is unknown and
    taken as content (spec section 9)."""
    return FoundLink(
        href=link.link_to,
        anchor=link.anchor,
        kind=link.kind,
        rel=frozenset() if link.dofollow else frozenset({"nofollow"}),
        placement=Placement.CONTENT,
        container="",
        open=False,
    )


async def _links(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: Row[Any],
) -> None:
    hosts = site_hosts(run.target_host, run.settings.get("allowed_subdomains", []))
    async with sessions() as db:
        waiting = (
            await db.execute(
                select(crawl_pages.c.url_id, crawl_pages.c.crawled_url, urls.c.canonical_url, urls.c.url_hash)
                .join(urls, urls.c.id == crawl_pages.c.url_id)
                .where(crawl_pages.c.run_id == run.id, crawl_pages.c.links_state == "waiting")
                .order_by(crawl_pages.c.url_id)
                .limit(HTML_PAGES_PER_STEP)
            )
        ).all()
    if not waiting:
        async with sessions() as db, db.begin():
            await _set_run(db, run, ingest_phase="template")
        return
    found: list[tuple[int, list[PageEdge], str]] = []
    for page in waiting:
        source = canonicalize(page.canonical_url)
        html = await on_page.raw_html(run.provider_task_id, page.crawled_url)
        if html is not None:
            if store is not None:
                await store.put(html_key(run.project_id, page.url_hash), compress(html.encode()))
            links = classify(html, page.crawled_url)
            state = "from_html"
        else:
            links = [_as_found(link) for link in await on_page.links_from(run.provider_task_id, page.crawled_url)]
            state = "from_provider"
        found.append((page.url_id, page_edges(links, page=source, hosts=hosts), state))
    async with sessions() as db, db.begin():
        known = await dictionaries.urls_for(db, [edge.target for _, edges, _ in found for edge in edges])
        stored = 0
        for url_id, edges, state in found:
            await db.execute(
                delete(crawl_links).where(
                    crawl_links.c.run_id == run.id, crawl_links.c.source_url_id == url_id
                )
            )
            rows = [
                {
                    "run_id": run.id,
                    "workspace_id": run.workspace_id,
                    "source_url_id": url_id,
                    "target_url_id": known[edge.target.url_hash].id,
                    "anchor": edge.anchor,
                    "kind": edge.kind,
                    "placement": edge.placement,
                    "scope": edge.scope.value,
                    "rel": list(edge.rel),
                    "is_followed": edge.followed,
                    "occurrences": edge.occurrences,
                    "container_hash": edge.container_hash,
                    "template_candidate": edge.template_candidate,
                }
                for edge in edges
            ]
            for start in range(0, len(rows), _LINK_ROWS_PER_STATEMENT):
                await db.execute(insert(crawl_links).values(rows[start : start + _LINK_ROWS_PER_STATEMENT]))
            stored += len(rows)
            await db.execute(
                update(crawl_pages)
                .where(crawl_pages.c.run_id == run.id, crawl_pages.c.url_id == url_id)
                .values(links_state=state)
            )
        await _set_run(db, run, links_stored=crawl_runs.c.links_stored + stored)


async def _template(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: Row[Any],
) -> None:
    async with sessions() as db, db.begin():
        source = aliased(urls)
        target = aliased(urls)
        rows = (
            await db.execute(
                select(
                    crawl_links.c.id,
                    source.c.canonical_url.label("source_url"),
                    target.c.canonical_url.label("target_url"),
                    crawl_links.c.container_hash,
                    crawl_links.c.placement,
                )
                .join(source, source.c.id == crawl_links.c.source_url_id)
                .join(target, target.c.id == crawl_links.c.target_url_id)
                .where(
                    crawl_links.c.run_id == run.id,
                    crawl_links.c.template_candidate,
                    crawl_links.c.container_hash.is_not(None),
                )
                .order_by(crawl_links.c.source_url_id, crawl_links.c.id)
            )
        ).all()
        pages = (
            await db.execute(
                select(urls.c.canonical_url)
                .join(crawl_pages, crawl_pages.c.url_id == urls.c.id)
                .where(crawl_pages.c.run_id == run.id, crawl_pages.c.links_state == "from_html")
            )
        ).scalars()
        changes = template_placements(
            [
                TemplateRow(
                    link_id=row.id,
                    source_url=row.source_url,
                    target_url=row.target_url,
                    container=row.container_hash,
                    placement=row.placement,
                )
                for row in rows
            ],
            list(pages),
        )
        if changes:
            await db.execute(
                update(crawl_links)
                .where(crawl_links.c.run_id == run.id, crawl_links.c.id == bindparam("b_id"))
                .values(placement=bindparam("b_placement"), scope=bindparam("b_scope")),
                [
                    {"b_id": link_id, "b_placement": placement, "b_scope": scope_of(placement).value}
                    for link_id, placement in changes.items()
                ],
            )
        await _set_run(db, run, ingest_phase="metrics")


_INCOMING = text(
    """
    UPDATE seo.crawl_pages p SET
        linking_pages_editorial = c.editorial, linking_pages_auto = c.auto,
        linking_pages_template = c.template, linking_pages_all = c.every
    FROM (SELECT target_url_id AS url_id,
                 count(DISTINCT source_url_id) FILTER (WHERE scope = 'editorial') AS editorial,
                 count(DISTINCT source_url_id) FILTER (WHERE scope = 'auto_generated') AS auto,
                 count(DISTINCT source_url_id) FILTER (WHERE scope = 'template') AS template,
                 count(DISTINCT source_url_id) AS every
          FROM seo.crawl_links WHERE run_id = :run_id GROUP BY target_url_id) c
    WHERE p.run_id = :run_id AND p.url_id = c.url_id
    """
)
_OUTGOING = text(
    """
    UPDATE seo.crawl_pages p SET
        outlinks_editorial = c.editorial, outlinks_auto = c.auto, outlinks_template = c.template,
        outlinks_all = c.every, broken_outlinks = c.broken, redirect_outlinks = c.redirect,
        non_indexable_outlinks = c.non_indexable
    FROM (SELECT l.source_url_id AS url_id,
                 count(DISTINCT l.target_url_id) FILTER (WHERE l.scope = 'editorial') AS editorial,
                 count(DISTINCT l.target_url_id) FILTER (WHERE l.scope = 'auto_generated') AS auto,
                 count(DISTINCT l.target_url_id) FILTER (WHERE l.scope = 'template') AS template,
                 count(DISTINCT l.target_url_id) AS every,
                 count(DISTINCT l.target_url_id) FILTER (WHERE t.status_code >= 400) AS broken,
                 count(DISTINCT l.target_url_id)
                     FILTER (WHERE t.status_code BETWEEN 300 AND 399) AS redirect,
                 count(DISTINCT l.target_url_id) FILTER (WHERE NOT t.is_indexable) AS non_indexable
          FROM seo.crawl_links l
          LEFT JOIN seo.crawl_pages t ON t.run_id = l.run_id AND t.url_id = l.target_url_id
          WHERE l.run_id = :run_id GROUP BY l.source_url_id) c
    WHERE p.run_id = :run_id AND p.url_id = c.url_id
    """
)
_TOP_ANCHOR = text(
    """
    UPDATE seo.crawl_pages p SET top_anchor = a.anchor
    FROM (SELECT DISTINCT ON (target_url_id) target_url_id, anchor
          FROM (SELECT target_url_id, anchor, sum(occurrences) AS uses
                FROM seo.crawl_links
                WHERE run_id = :run_id AND scope = 'editorial' AND anchor <> ''
                GROUP BY target_url_id, anchor) counted
          ORDER BY target_url_id, uses DESC, anchor) a
    WHERE p.run_id = :run_id AND p.url_id = a.target_url_id
    """
)
_FLAGS = text(
    """
    UPDATE seo.crawl_pages SET
        is_orphan = in_sitemap AND linking_pages_all = 0 AND url_id IS DISTINCT FROM :start,
        is_editorial_orphan = coalesce(status_code = 200, false) AND linking_pages_all > 0
            AND linking_pages_editorial = 0 AND url_id IS DISTINCT FROM :start
    WHERE run_id = :run_id
    """
)
_SUMMARY = text(
    """
    SELECT count(*) FILTER (WHERE in_sitemap) AS sitemap_pages,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY equity_share)
               FILTER (WHERE status_code = 200) AS equity_p25
    FROM seo.crawl_pages WHERE run_id = :run_id
    """
)


async def _metrics(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: Row[Any],
) -> None:
    async with sessions() as db, db.begin():
        for statement in (_INCOMING, _OUTGOING, _TOP_ANCHOR):
            await db.execute(statement, {"run_id": run.id})
        await db.execute(_FLAGS, {"run_id": run.id, "start": run.start_url_id})
        nodes = {
            row.url_id: Node(row.url_id, row.status_code, row.redirect_url_id)
            for row in await db.execute(
                select(crawl_pages.c.url_id, crawl_pages.c.status_code, crawl_pages.c.redirect_url_id)
                .where(crawl_pages.c.run_id == run.id)
            )
        }
        links = [
            Link(row.source_url_id, row.target_url_id, LinkScope(row.scope), row.is_followed)
            for row in await db.execute(
                select(
                    crawl_links.c.source_url_id,
                    crawl_links.c.target_url_id,
                    crawl_links.c.scope,
                    crawl_links.c.is_followed,
                ).where(crawl_links.c.run_id == run.id)
            )
        ]
        start = run.start_url_id
        depths = {} if start is None else click_depths(start, nodes, links)
        without = {} if start is None else click_depths(start, nodes, links, without_auto=True)
        equity = pagerank(nodes, links)
        # Shares of the crawled pages only (spec 6.4): links to pages past the ceiling hold
        # some value, which is not shown.
        total = sum(equity.shares.get(url_id, 0.0) for url_id in nodes) or 1.0
        if nodes:
            await db.execute(
                update(crawl_pages)
                .where(crawl_pages.c.run_id == run.id, crawl_pages.c.url_id == bindparam("b_url"))
                .values(
                    click_depth=bindparam("b_depth"),
                    depth_without_auto=bindparam("b_without"),
                    equity_share=bindparam("b_share"),
                    deep_only_through_auto=bindparam("b_deep"),
                ),
                [
                    {
                        "b_url": url_id,
                        "b_depth": depths.get(url_id),
                        "b_without": without.get(url_id),
                        "b_share": equity.shares.get(url_id, 0.0) / total,
                        "b_deep": deep_only_through_auto(depths.get(url_id), without.get(url_id)),
                    }
                    for url_id in nodes
                ],
            )
        lost = sum(equity.shares.get(url_id, 0.0) for url_id, node in nodes.items() if node.is_error)
        summary = (await db.execute(_SUMMARY, {"run_id": run.id})).one()
        await _set_run(
            db,
            run,
            state="stopped_at_ceiling" if run.stop_reason == "limit_exceeded" else "ready",
            ingest_phase="done",
            finished_at=datetime.now(UTC),
            sitemap_pages=summary.sitemap_pages,
            equity_p25=summary.equity_p25,
            equity_lost_to_errors=lost / total,
        )
        # The crawl is the latest from here on, in this transaction: rules and flow follow it.
        await apply_rules(db, workspace_id=run.workspace_id, project_id=run.project_id)
        await recompute_tier_flow(db, workspace_id=run.workspace_id, run_id=run.id)


_STEPS: Final[dict[str, Step]] = {
    "pages": _pages,
    "non_indexable": _non_indexable,
    "links": _links,
    "template": _template,
    "metrics": _metrics,
}


async def _failed_pass(sessions: async_sessionmaker[AsyncSession], run: Row[Any]) -> None:
    async with sessions() as db, db.begin():
        failures = run.ingest_failures + 1
        values: dict[str, object] = {"ingest_failures": failures}
        if failures >= INGEST_FAILURES_MAX:
            values |= {
                "state": "failed",
                "error_code": "ingest_failed",
                "error_message": "The crawl could not be read; the previous crawl is still shown.",
                "finished_at": datetime.now(UTC),
            }
        await _set_run(db, run, **values)


async def ingest_run(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    task: CrawlIngestTask,
    *,
    deadline: float,
) -> IngestOutcome:
    """One pass: steps until the crawl is done or `deadline` (`time.monotonic()`) has passed;
    at least one step is taken."""
    steps = 0
    while True:
        async with sessions() as db:
            run = (
                await db.execute(
                    select(crawl_runs).where(
                        crawl_runs.c.workspace_id == task.workspace_id,
                        crawl_runs.c.id == task.run_id,
                    )
                )
            ).one_or_none()
        if run is None or run.state != "processing" or run.ingest_phase not in _STEPS:
            return IngestOutcome(phase=None if run is None else run.ingest_phase, steps=steps)
        try:
            await _STEPS[run.ingest_phase](sessions, on_page, store, run)
        except Exception:
            # Retried by the next pass; a bug fails the crawl after five, it never loops.
            _log.exception("crawl ingest step failed", run_id=str(run.id), phase=run.ingest_phase)
            await _failed_pass(sessions, run)
            return IngestOutcome(phase=run.ingest_phase, steps=steps, failed=True)
        steps += 1
        if time.monotonic() >= deadline:
            return IngestOutcome(phase=run.ingest_phase, steps=steps)
```

The ingest reads the start URL as `https://{target_host}/` (spec 6.1) and the provider's own spelling of each page (`crawled_url`) for raw HTML and links, since the canonical form may drop a trailing slash the site serves.

- [ ] **Step 5: Wire the tick and the job**

In `backend/src/idraft/worker/assembly.py`, next to the other constants:

```python
# Crawls of sites for the internal link tracker (plan 02 Task 9): once a minute.
CRAWL_EVERY = timedelta(seconds=60)
CRAWL_LOCK = timedelta(seconds=55)
```

a helper below `dataforseo_client`:

```python
def crawl_provider(context: WorkerContext) -> OnPage | None:
    """On-Page with the account's client; None without DataForSEO credentials, when crawls are
    queued and never posted."""
    client = dataforseo_client(context.settings, context.http, context.redis)
    return None if client is None else OnPage(client)
```

and in `assemble`, before the `return`:

```python
    on_page = crawl_provider(context)
    if on_page is not None:

        async def crawl_ingest(task: CrawlIngestTask) -> None:
            outcome = await ingest_run(
                context.sessions,
                on_page,
                context.raw_store,
                task,
                deadline=time.monotonic() + PASS_TIME.total_seconds(),
            )
            _log.info("crawl ingest pass", run_id=str(task.run_id), **asdict(outcome))

        context.queues.register("process", INGEST_JOB, crawl_ingest)

    async def send_crawl_ingest(task: CrawlIngestTask) -> bool:
        if on_page is None:
            return False
        return await context.queues.enqueue(INGEST_JOB, task, dedupe_key=task.dedupe_key)

    async def crawls() -> None:
        now = await database_time(context.sessions)
        report = await crawl_tick(context.sessions, on_page, send_crawl_ingest, now=now)
        if not report.quiet:
            _log.info("crawl tick", **asdict(report))
```

and add `Tick(name="crawl", interval=CRAWL_EVERY, action=crawls, lock_ttl=CRAWL_LOCK),` to the returned ticks. Imports: `import time`; `from idraft.collectors.crawl_ingest import PASS_TIME, ingest_run`; `from idraft.collectors.crawl_runs import INGEST_JOB, CrawlIngestTask, crawl_tick`; `from idraft.providers.dataforseo.on_page import OnPage`.

Add to `backend/tests/worker/test_assembly.py`:

```python
async def test_the_crawl_tick_runs_every_minute_and_without_credentials_posts_nothing(
    context: WorkerContext,
) -> None:
    ticks = {tick.name: tick for tick in assemble(context)}

    assert (ticks["crawl"].interval, ticks["crawl"].lock_ttl) == (
        timedelta(seconds=60),
        timedelta(seconds=55),
    )
    await ticks["crawl"].action()
```

- [ ] **Step 6: Run the tests**

```bash
uv run pytest --no-cov tests/collectors/test_crawl_ingest.py tests/collectors/test_crawl_runs.py tests/worker/test_assembly.py -q
```

Expected: all pass.

- [ ] **Step 7: Gate and commit**

```bash
git add backend/src/idraft/collectors/crawl_ingest.py backend/src/idraft/worker/assembly.py \
  backend/tests/collectors/crawl_support.py backend/tests/collectors/test_crawl_ingest.py \
  backend/tests/worker/test_assembly.py
git commit -m "Internal links: crawl ingest with checkpoints, placement, metrics and the worker wiring"
```

---

### Task 12: Read API: pages, inspector, edges, neighbors, tier flow, worklists, CSV

**Files:**
- Create: `backend/src/idraft/api/internal_links/csv_export.py`, `reads.py`, `read_routes.py`
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (append read models)
- Modify: `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/main.py`, `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json`
- Test: `backend/tests/api/internal_links/test_reads_pages.py`, `test_reads_neighbors.py`, `test_reads_edges.py`, `test_reads_flow.py`

- [ ] **Step 1: Write the failing tests**

A shared site for the read tests, in `backend/tests/api/internal_links/support.py`:

```python
READ_PAGES = [
    ("/", 200), ("/pricing", 200), ("/blog", 200), ("/blog/a", 200), ("/blog/b", 200),
    ("/old", 301), ("/gone", 404),
]
READ_LINKS = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/", "/blog", "navigation", "Blog"),
    SeedLink("/blog", "/blog/a", "content", "Post A"),
    SeedLink("/blog", "/blog/b", "content", "Post B"),
    SeedLink("/blog/a", "/pricing", "content", "See plans"),
    SeedLink("/pricing", "/blog/a", "content", "Read the guide"),
    SeedLink("/blog/a", "/blog/b", "auto_generated", "Next"),
    SeedLink("/blog/b", "/blog/a", "auto_generated", "Previous"),
    SeedLink("/blog/b", "/old", "content", "Old"),
    SeedLink("/blog/b", "/gone", "content", "Gone"),
]


async def read_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A finished crawl with counts and metrics set as ingest would, and tiers: /pricing is a
    manual T1, /blog/a a manual T3."""
    tiers = await seed_tiers(pg, workspace)
    run_id, ids = await seed_crawl(pg, workspace, project_id, READ_PAGES, READ_LINKS)
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET redirect_url_id = $2 WHERE run_id = $1 AND url_id = $3",
        run_id,
        ids["/pricing"],
        ids["/old"],
    )
    for statement in (_INCOMING_SQL, _OUTGOING_SQL):
        await execute(pg, statement, run_id)
    depth = {"/": 0, "/pricing": 1, "/blog": 1, "/blog/a": 2, "/blog/b": 2, "/old": 3, "/gone": 3}
    share = {
        "/": 0.2,
        "/pricing": 0.3,
        "/blog": 0.1,
        "/blog/a": 0.2,
        "/blog/b": 0.1,
        "/old": 0.05,
        "/gone": 0.05,
    }
    for path, url in ids.items():
        await execute(
            pg,
            "UPDATE seo.crawl_pages SET click_depth = $3, equity_share = $4 "
            "WHERE run_id = $1 AND url_id = $2",
            run_id,
            url,
            depth[path],
            share[path],
        )
    for path, tier in (("/pricing", tiers[0]), ("/blog/a", tiers[2])):
        await execute(
            pg,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project_id,
            ids[path],
            workspace.id,
            tier,
        )
    return run_id, ids, tiers


# The counts ingest writes (Task 11), for a seeded crawl.
_INCOMING_SQL = """
UPDATE seo.crawl_pages p SET
    linking_pages_editorial = c.e, linking_pages_auto = c.a, linking_pages_template = c.t,
    linking_pages_all = c.n
FROM (SELECT target_url_id AS url_id,
             count(DISTINCT source_url_id) FILTER (WHERE scope = 'editorial') AS e,
             count(DISTINCT source_url_id) FILTER (WHERE scope = 'auto_generated') AS a,
             count(DISTINCT source_url_id) FILTER (WHERE scope = 'template') AS t,
             count(DISTINCT source_url_id) AS n
      FROM seo.crawl_links WHERE run_id = $1 GROUP BY target_url_id) c
WHERE p.run_id = $1 AND p.url_id = c.url_id
"""
_OUTGOING_SQL = """
UPDATE seo.crawl_pages p SET
    outlinks_editorial = c.e, outlinks_auto = c.a, outlinks_template = c.t, outlinks_all = c.n
FROM (SELECT source_url_id AS url_id,
             count(DISTINCT target_url_id) FILTER (WHERE scope = 'editorial') AS e,
             count(DISTINCT target_url_id) FILTER (WHERE scope = 'auto_generated') AS a,
             count(DISTINCT target_url_id) FILTER (WHERE scope = 'template') AS t,
             count(DISTINCT target_url_id) AS n
      FROM seo.crawl_links WHERE run_id = $1 GROUP BY source_url_id) c
WHERE p.run_id = $1 AND p.url_id = c.url_id
"""
```

(`Workspace` and `uuid` are already imported in that module.)

`backend/tests/api/internal_links/test_reads_pages.py`:

```python
"""The Pages tab and the inspector (spec 7.2 and 7.4)."""

from __future__ import annotations

import csv
import io

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_pages_list_counts_in_the_scope_in_view_and_sorts_by_equity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    editorial = await api.get(url, headers=viewer.headers)
    every = await api.get(url, params={"scope": "all"}, headers=viewer.headers)

    assert editorial.status_code == 200, editorial.text
    rows = editorial.json()["data"]
    assert rows[0]["path"] == "/pricing"
    pricing = rows[0]
    assert (pricing["linking_pages"], pricing["linking_pages_all"]) == (1, 2)
    assert pricing["tier"]["code"] == "T1"
    assert pricing["tier_source"] == "manual"
    (from_tier,) = pricing["linked_from_tiers"]
    assert (from_tier["tier"]["code"], from_tier["pages"]) == ("T3", 1)
    assert editorial.json()["meta"]["total"] == 7
    every_pricing = next(row for row in every.json()["data"] if row["path"] == "/pricing")
    assert every_pricing["linking_pages"] == 2
```

```python
async def test_filters_worklists_and_cursor_paging(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    errors = await api.get(url, params={"filter[status]": "3xx,4xx"}, headers=viewer.headers)
    untiered = await api.get(url, params={"filter[tier]": "none", "q": "blog"}, headers=viewer.headers)
    first = await api.get(url, params={"sort": "path", "limit": 3}, headers=viewer.headers)
    second = await api.get(
        url,
        params={"sort": "path", "limit": 3, "cursor": first.json()["page"]["next_cursor"]},
        headers=viewer.headers,
    )

    assert {row["path"] for row in errors.json()["data"]} == {"/old", "/gone"}
    assert {row["path"] for row in untiered.json()["data"]} == {"/blog", "/blog/b"}
    assert [row["path"] for row in first.json()["data"]] == ["/", "/blog", "/blog/a"]
    assert [row["path"] for row in second.json()["data"]] == ["/blog/b", "/gone", "/old"]
    flags = {row["path"]: row["flags"] for row in errors.json()["data"]}
    assert flags == {"/old": ["redirect"], "/gone": ["broken"]}


async def test_the_inspector_shows_tiers_placements_anchors_and_capped_lists(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/pricing"]),
        params={"scope": "all"},
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert data["page"]["path"] == "/pricing"
    assert {(row["placement"], row["pages"]) for row in data["linking_by_placement"]} == {
        ("navigation", 1),
        ("content", 1),
    }
    assert [anchor["anchor"] for anchor in data["top_anchors"]] == ["Pricing", "See plans"]
    assert {row["path"] for row in data["linking_pages"]} == {"/", "/blog/a"}
    assert data["linking_pages_total"] == 2
    missing = await api.get(
        project_url(workspace, project, "internal-links", "pages", 999_999_999),
        headers=viewer.headers,
    )
    assert missing.status_code == 404


async def test_csv_follows_the_filter_and_defuses_formulas(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"format": "csv", "filter[tier]": "none"},
        headers=viewer.headers,
    )

    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert {row["path"] for row in rows} == {"/", "/blog", "/blog/b", "/old", "/gone"}
    assert rows[0].keys() >= {"url", "tier", "status_code", "click_depth", "equity_share"}


async def test_no_finished_crawl_is_a_404_with_its_own_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=viewer.headers
    )

    assert problem(response) == (404, "no_crawl")


async def test_another_workspace_cannot_read_the_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=stranger.headers
    )

    assert response.status_code == 404
```

`backend/tests/api/internal_links/test_reads_neighbors.py`:

```python
"""One journey step, either side (spec 7.5 and 8)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _step(
    api: httpx.AsyncClient, url: str, headers: dict[str, str], **params: object
) -> dict[str, object]:
    response = await api.get(url, params=params, headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


async def test_links_out_in_scope_with_reciprocal_pairs_and_group_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")

    body = await _step(api, url, viewer.headers, url_id=ids["/blog/a"], direction="out")

    data = body["data"]
    assert isinstance(data, list)
    assert [(row["path"], row["anchor"], row["reciprocal"]) for row in data] == [
        ("/pricing", "See plans", True),
    ]
    meta = body["meta"]
    assert isinstance(meta, dict)
    assert meta["total"] == 1
    assert meta["other_scopes"] == [{"scope": "auto_generated", "pages": 1}]


async def test_links_in_sort_by_tier_then_equity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")

    body = await _step(
        api, url, viewer.headers, url_id=ids["/blog/a"], direction="in", scope="all"
    )

    data = body["data"]
    assert isinstance(data, list)
    # /pricing is T1; /blog and /blog/b are both untiered with the same share: the id decides.
    assert [row["path"] for row in data] == ["/pricing", "/blog", "/blog/b"]
    assert [row["has_children"] for row in data] == [True, True, True]


async def test_a_redirect_focus_has_one_child_its_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")

    body = await _step(api, url, viewer.headers, url_id=ids["/old"], direction="out")

    data = body["data"]
    assert isinstance(data, list)
    assert [(row["path"], row["placement"]) for row in data] == [("/pricing", None)]
    meta = body["meta"]
    assert isinstance(meta, dict)
    assert meta["focus"]["redirect_url_id"] == str(ids["/pricing"])
```

`backend/tests/api/internal_links/test_reads_edges.py`:

```python
"""The Links tab (spec 7.3)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_edges_filter_by_tier_and_worklist_template_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, _, tiers = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "edges")

    to_t1 = await api.get(
        url, params={"scope": "all", "filter[target_tier]": str(tiers[0])}, headers=viewer.headers
    )
    broken = await api.get(
        url,
        params={"scope": "all", "filter[worklist]": "broken_and_redirected"},
        headers=viewer.headers,
    )

    assert [(row["source"]["path"], row["scope"]) for row in to_t1.json()["data"]] == [
        ("/", "template"),
        ("/blog/a", "editorial"),
    ]
    assert {
        (row["target"]["path"], row["target"]["status_code"]) for row in broken.json()["data"]
    } == {("/old", 301), ("/gone", 404)}
    assert to_t1.json()["data"][0]["target"]["tier"]["code"] == "T1"
```

`backend/tests/api/internal_links/test_reads_flow.py`:

```python
"""The Tier flow tab and the worklist counts (spec 7.2 and 7.6)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from idraft.collectors.crawl_store import recompute_tier_flow
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_matrix_has_untiered_as_its_own_row_and_every_tier_in_the_strip(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, _, _ = await read_site(migrated, workspace, project)
    async with workspace_transaction(resources.sessions, workspace.id) as db:
        await recompute_tier_flow(db, workspace_id=workspace.id, run_id=run)

    response = await api.get(
        project_url(workspace, project, "internal-links", "tier-flow"), headers=viewer.headers
    )

    data = response.json()["data"]
    cells = {
        (
            None if cell["from_tier"] is None else cell["from_tier"]["code"],
            None if cell["to_tier"] is None else cell["to_tier"]["code"],
        ): cell["links"]
        for cell in data["cells"]
    }
    assert cells == {("T3", "T1"): 1, ("T1", "T3"): 1, (None, "T3"): 1, (None, None): 3}
    strip = {
        None if row["tier"] is None else row["tier"]["code"]: row["pages"] for row in data["tiers"]
    }
    assert strip == {"T1": 1, "T2": 0, "T3": 1, "T4": 0, None: 5}
    assert data["stale"] is False


async def test_worklist_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "worklists"), headers=viewer.headers
    )

    data = response.json()["data"]
    assert (data["broken_and_redirected"], data["links_to_non_indexable"]) == (2, 0)
    # /pricing (T1) has one editorial linking page: under 3.
    assert data["under_linked_t1"] == 1
```

Editorial cells: `/blog/a` (T3) to `/pricing` (T1); `/pricing` to `/blog/a`; `/blog` (untiered) to `/blog/a`; `/blog` to `/blog/b`, and `/blog/b` to `/old` and to `/gone`, are three untiered pairs.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/internal_links -q -k reads`
Expected: `404` on the unknown routes.

- [ ] **Step 3: Append the read models**

Append to `backend/src/idraft/api/schemas/internal_links.py`:

```python
LinkScopeName = Literal["editorial", "auto_generated", "template", "all"]
EdgeScopeName = Literal["editorial", "auto_generated", "template"]
PlacementName = Literal[
    "content", "auto_generated", "navigation", "header", "footer", "sidebar", "breadcrumb"
]
RowFlag = Literal[
    "orphan",
    "editorial_orphan",
    "deep_only_through_auto",
    "placement_unknown",
    "broken",
    "redirect",
    "non_indexable",
]
PageSort = Literal[
    "path", "-path", "click_depth", "-click_depth", "linking_pages", "-linking_pages",
    "outlinks", "-outlinks", "equity_share", "-equity_share", "status_code", "-status_code",
]
EdgeWorklist = Literal["broken_and_redirected", "links_to_non_indexable"]
UrlIdText = Annotated[str, Field(description="A `core.urls` id: a 64-bit integer as a string.")]


class TermRef(BaseModel):
    term_id: UUID
    name: str


class TierCount(BaseModel):
    tier: TierRef | None = Field(description="null is Untiered.")
    pages: int


class PageRow(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    title: str | None
    status_code: int | None
    resource_type: Literal["html", "redirect", "broken", "other"]
    redirect_url: str | None
    is_indexable: bool
    non_indexable_reason: str | None
    canonical_url: str | None
    in_sitemap: bool
    click_depth: int | None
    depth_without_auto: int | None
    equity_share: float | None
    linking_pages: int = Field(description="Unique pages linking here, in the scope in view.")
    linking_pages_all: int
    outlinks: int = Field(description="Unique pages linked from here, in the scope in view.")
    outlinks_all: int
    linked_from_tiers: list[TierCount]
    outlinks_to_t1: int
    broken_outlinks: int
    redirect_outlinks: int
    non_indexable_outlinks: int
    top_anchor: str | None
    tier: TierRef | None
    tier_source: Literal["manual", "rule"] | None
    tier_rule_id: UUID | None
    tier_set_by: UserRef | None
    tier_set_at: datetime | None
    tags: list[TermRef]
    flags: list[RowFlag]


class ListMeta(BaseModel):
    run_id: UUID
    scope: LinkScopeName
    total: int


class PageRowPage(BaseModel):
    data: list[PageRow]
    page: CursorPageInfo
    meta: ListMeta


class Neighbor(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    title: str | None
    status_code: int | None = Field(description="null when the page was not crawled.")
    redirect_url_id: UrlIdText | None
    tier: TierRef | None
    click_depth: int | None
    linking_pages: int
    linking_pages_all: int
    equity_share: float | None
    anchor: str | None
    placement: PlacementName | None
    scope: EdgeScopeName | None
    is_followed: bool
    rel: list[str]
    occurrences: int
    links: int = Field(description="Link rows between the two pages in the scope in view.")
    has_children: bool
    reciprocal: bool = Field(description="The two pages link both ways in the scope in view.")


class ScopeCount(BaseModel):
    scope: EdgeScopeName
    pages: int


class NeighborFocus(BaseModel):
    url_id: UrlIdText
    status_code: int | None
    redirect_url_id: UrlIdText | None


class NeighborMeta(BaseModel):
    run_id: UUID
    url_id: UrlIdText
    direction: Literal["in", "out"]
    scope: LinkScopeName
    total: int
    other_scopes: list[ScopeCount]
    focus: NeighborFocus


class NeighborList(BaseModel):
    data: list[Neighbor]
    meta: NeighborMeta


class PlacementCount(BaseModel):
    placement: PlacementName
    pages: int


class AnchorCount(BaseModel):
    anchor: str
    links: int


class PageDetail(BaseModel):
    page: PageRow
    linking_by_tier: list[TierCount]
    linking_by_placement: list[PlacementCount]
    top_anchors: list[AnchorCount]
    linking_pages: list[Neighbor]
    outlinks: list[Neighbor]
    linking_pages_total: int
    outlinks_total: int


class PageDetailResponse(BaseModel):
    data: PageDetail


class EdgePage(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    tier: TierRef | None
    status_code: int | None
    redirect_url: str | None
    is_indexable: bool | None


class EdgeRow(BaseModel):
    link_id: UrlIdText
    source: EdgePage
    target: EdgePage
    anchor: str
    kind: Literal["text", "image"]
    placement: PlacementName
    scope: EdgeScopeName
    rel: list[str]
    is_followed: bool
    occurrences: int


class EdgeRowPage(BaseModel):
    data: list[EdgeRow]
    page: CursorPageInfo
    meta: ListMeta


class TierFlowCell(BaseModel):
    from_tier: TierRef | None
    to_tier: TierRef | None
    links: int


class TierStat(BaseModel):
    tier: TierRef | None
    pages: int
    equity_share: float
    average_depth: float | None


class TierFlow(BaseModel):
    run_id: UUID
    scope: LinkScopeName
    stale: bool = Field(description="A tier change is being applied; read again in a minute.")
    cells: list[TierFlowCell]
    tiers: list[TierStat]


class TierFlowResponse(BaseModel):
    data: TierFlow


class Worklists(BaseModel):
    run_id: UUID
    under_linked_t1: int
    orphans: int
    editorial_orphans: int
    deep_only_through_auto: int
    broken_and_redirected: int = Field(description="Links of every scope.")
    links_to_non_indexable: int = Field(description="Links of every scope.")


class WorklistsResponse(BaseModel):
    data: Worklists
```

- [ ] **Step 4: CSV cells**

`backend/src/idraft/api/internal_links/csv_export.py`:

```python
"""CSV of the Pages and Links lists (decision D20)."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence
from typing import Final

EXPORT_ROWS_MAX: Final = 100_000
# What a spreadsheet takes for a formula when it opens a cell (as api/imports/service.py).
_FORMULA_START: Final = ("=", "+", "-", "@", "\t", "\r")


def neutral(cell: object) -> str:
    text = "" if cell is None else str(cell)
    return "'" + text if text.startswith(_FORMULA_START) else text


def csv_text(header: Sequence[str], rows: Iterable[Sequence[object]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow([neutral(cell) for cell in row])
    return out.getvalue()
```

- [ ] **Step 5: The reads**

`backend/src/idraft/api/internal_links/reads.py`:

```python
"""Reads of a crawl for the Pages, Links, Journey and Tier flow screens (spec 7 and 8;
decisions D10, D11 and D20).

Rows are a crawl's pages and edges with today's tiers (tiers belong to the URL, not to the
crawl). Counts in a scope are the stored per-page columns; "linked from tiers", "outlinks to
T1", reciprocal pairs and the journey's group counts are computed for the rows being read.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any, Final, Literal
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Row,
    Text,
    and_,
    case,
    distinct,
    exists,
    func,
    literal,
    or_,
    select,
    true,
    tuple_,
)
from sqlalchemy.dialects.postgresql import aggregate_order_by, array_agg
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import aliased

from idraft.api.internal_links.csv_export import EXPORT_ROWS_MAX, csv_text
from idraft.api.internal_links.page_filter import (
    PageScope,
    page_conditions,
    page_rows,
    tier_of_position,
)
from idraft.api.internal_links.page_tiers import crawl_scope
from idraft.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import NotFoundError
from idraft.api.schemas.common import UserRef
from idraft.api.schemas.internal_links import (
    AnchorCount,
    EdgePage,
    EdgeRow,
    Neighbor,
    NeighborFocus,
    NeighborMeta,
    PageDetail,
    PageFilter,
    PageRow,
    PlacementCount,
    ScopeCount,
    TermRef,
    TierCount,
    TierFlow,
    TierFlowCell,
    TierRef,
    TierStat,
    Worklists,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.scopes import EDGE_SCOPES, LinkScope
from idraft.crawl.tiers import tier_code
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    crawl_links,
    crawl_pages,
    crawl_runs,
    crawl_tier_flow,
    crawl_tier_stats,
    page_terms,
    page_tier_levels,
    project_pages,
    taxonomy_terms,
    urls,
    users,
)

DETAIL_LIST: Final = 25
_DEPTH_LAST: Final = 2_147_483_647
_LINKING: Final = {
    LinkScope.EDITORIAL: crawl_pages.c.linking_pages_editorial,
    LinkScope.AUTO_GENERATED: crawl_pages.c.linking_pages_auto,
    LinkScope.TEMPLATE: crawl_pages.c.linking_pages_template,
    LinkScope.ALL: crawl_pages.c.linking_pages_all,
}
_OUTLINKS: Final = {
    LinkScope.EDITORIAL: crawl_pages.c.outlinks_editorial,
    LinkScope.AUTO_GENERATED: crawl_pages.c.outlinks_auto,
    LinkScope.TEMPLATE: crawl_pages.c.outlinks_template,
    LinkScope.ALL: crawl_pages.c.outlinks_all,
}
_SCOPE_RANK: Final = {"template": 0, "auto_generated": 1, "editorial": 2}
Direction = Literal["in", "out"]


def _in_view(view: LinkScope, table: Any = crawl_links) -> ColumnElement[bool]:
    return true() if view is LinkScope.ALL else table.c.scope == view.value


@dataclass(frozen=True, slots=True)
class Tiers:
    """The workspace's tiers by id, read once per request."""

    refs: dict[UUID, TierRef]
    positions: dict[UUID, int]

    def ref(self, tier_id: UUID | None) -> TierRef | None:
        return None if tier_id is None else self.refs.get(tier_id)


async def load_tiers(db: AsyncSession, workspace_id: UUID) -> Tiers:
    rows = (
        await db.execute(
            select(page_tier_levels.c.id, page_tier_levels.c.position, page_tier_levels.c.name)
            .where(page_tier_levels.c.workspace_id == workspace_id)
            .order_by(page_tier_levels.c.position)
        )
    ).all()
    return Tiers(
        refs={
            row.id: TierRef(tier_id=row.id, code=tier_code(row.position), name=row.name)
            for row in rows
        },
        positions={row.id: row.position for row in rows},
    )


def _flags(row: Row[Any]) -> list[str]:
    flags = []
    if row.is_orphan:
        flags.append("orphan")
    if row.is_editorial_orphan:
        flags.append("editorial_orphan")
    if row.deep_only_through_auto:
        flags.append("deep_only_through_auto")
    if row.links_state == "from_provider":
        flags.append("placement_unknown")
    status = row.status_code or 0
    if status >= 400:
        flags.append("broken")
    elif 300 <= status < 400:
        flags.append("redirect")
    if not row.is_indexable:
        flags.append("non_indexable")
    return flags


def _sort_column(name: str, view: LinkScope) -> ColumnElement[Any]:
    key = name.lstrip("-")
    if key == "path":
        return urls.c.path
    if key == "click_depth":
        return func.coalesce(crawl_pages.c.click_depth, _DEPTH_LAST)
    if key == "linking_pages":
        return _LINKING[view]
    if key == "outlinks":
        return _OUTLINKS[view]
    if key == "equity_share":
        return func.coalesce(crawl_pages.c.equity_share, -1.0)
    return func.coalesce(crawl_pages.c.status_code, 0)


def _cursor_value(name: str, raw: str) -> object:
    key = name.lstrip("-")
    try:
        if key == "path":
            return raw
        if key == "equity_share":
            return float(raw)
        return int(raw)
    except ValueError:
        raise invalid_cursor() from None


def _page_select(scope: PageScope, view: LinkScope, sort: str) -> Any:
    return (
        select(
            crawl_pages,
            urls.c.canonical_url,
            urls.c.path,
            project_pages.c.tier_id,
            project_pages.c.tier_source,
            project_pages.c.rule_id,
            project_pages.c.set_by,
            project_pages.c.set_at,
            _LINKING[view].label("in_view_linking"),
            _OUTLINKS[view].label("in_view_outlinks"),
            _sort_column(sort, view).label("sort_key"),
        )
        .select_from(page_rows(scope))
    )


async def _page_rows(
    db: AsyncSession, scope: PageScope, view: LinkScope, tiers: Tiers, rows: Sequence[Row[Any]]
) -> list[PageRow]:
    """Rows of the Pages list with what is computed for them alone."""
    ids = [row.url_id for row in rows]
    if not ids:
        return []
    linked: dict[int, list[TierCount]] = {}
    sources = aliased(project_pages)
    for target, tier_id, pages in await db.execute(
        select(crawl_links.c.target_url_id, sources.c.tier_id, func.count(distinct(crawl_links.c.source_url_id)))
        .select_from(
            crawl_links.outerjoin(
                sources,
                and_(
                    sources.c.workspace_id == scope.workspace_id,
                    sources.c.project_id == scope.project_id,
                    sources.c.url_id == crawl_links.c.source_url_id,
                ),
            )
        )
        .where(
            crawl_links.c.run_id == scope.run_id,
            crawl_links.c.target_url_id.in_(ids),
            crawl_links.c.source_url_id != crawl_links.c.target_url_id,
            _in_view(view),
        )
        .group_by(crawl_links.c.target_url_id, sources.c.tier_id)
    ):
        linked.setdefault(target, []).append(TierCount(tier=tiers.ref(tier_id), pages=pages))
    t1 = next((tier for tier, position in tiers.positions.items() if position == 1), None)
    to_t1: dict[int, int] = {}
    if t1 is not None:
        targets = aliased(project_pages)
        to_t1 = dict(
            (
                await db.execute(
                    select(crawl_links.c.source_url_id, func.count(distinct(crawl_links.c.target_url_id)))
                    .join(
                        targets,
                        and_(
                            targets.c.workspace_id == scope.workspace_id,
                            targets.c.project_id == scope.project_id,
                            targets.c.url_id == crawl_links.c.target_url_id,
                        ),
                    )
                    .where(
                        crawl_links.c.run_id == scope.run_id,
                        crawl_links.c.source_url_id.in_(ids),
                        targets.c.tier_id == t1,
                        _in_view(view),
                    )
                    .group_by(crawl_links.c.source_url_id)
                )
            ).tuples()
        )
    tags: dict[int, list[TermRef]] = {}
    for url_id, term_id, name in await db.execute(
        select(page_terms.c.url_id, taxonomy_terms.c.id, taxonomy_terms.c.name)
        .join(taxonomy_terms, taxonomy_terms.c.id == page_terms.c.term_id)
        .where(
            page_terms.c.workspace_id == scope.workspace_id,
            page_terms.c.project_id == scope.project_id,
            page_terms.c.url_id.in_(ids),
        )
        .order_by(taxonomy_terms.c.name)
    ):
        tags.setdefault(url_id, []).append(TermRef(term_id=term_id, name=name))
    other_ids = {
        url_id
        for row in rows
        for url_id in (row.redirect_url_id, row.canonical_url_id)
        if url_id is not None
    }
    other_urls = dict(
        (await db.execute(select(urls.c.id, urls.c.canonical_url).where(urls.c.id.in_(other_ids)))).tuples()
    ) if other_ids else {}
    setters = {row.set_by for row in rows if row.set_by is not None}
    people = {
        row.id: UserRef(user_id=row.id, name=row.name, email=row.email)
        for row in await db.execute(
            select(users.c.id, users.c.name, users.c.email).where(users.c.id.in_(setters))
        )
    } if setters else {}
    return [
        PageRow(
            url_id=str(row.url_id),
            url=row.canonical_url,
            path=row.path,
            title=row.title,
            status_code=row.status_code,
            resource_type=row.resource_type,
            redirect_url=other_urls.get(row.redirect_url_id),
            is_indexable=row.is_indexable,
            non_indexable_reason=row.non_indexable_reason,
            canonical_url=other_urls.get(row.canonical_url_id),
            in_sitemap=row.in_sitemap,
            click_depth=row.click_depth,
            depth_without_auto=row.depth_without_auto,
            equity_share=row.equity_share,
            linking_pages=row.in_view_linking,
            linking_pages_all=row.linking_pages_all,
            outlinks=row.in_view_outlinks,
            outlinks_all=row.outlinks_all,
            linked_from_tiers=sorted(
                linked.get(row.url_id, []),
                key=lambda count: tiers.positions.get(count.tier.tier_id, 99) if count.tier else 99,
            ),
            outlinks_to_t1=to_t1.get(row.url_id, 0),
            broken_outlinks=row.broken_outlinks,
            redirect_outlinks=row.redirect_outlinks,
            non_indexable_outlinks=row.non_indexable_outlinks,
            top_anchor=row.top_anchor,
            tier=tiers.ref(row.tier_id),
            tier_source=row.tier_source,
            tier_rule_id=row.rule_id,
            tier_set_by=people.get(row.set_by),
            tier_set_at=row.set_at,
            tags=tags.get(row.url_id, []),
            flags=_flags(row),
        )
        for row in rows
    ]


_PAGE_CSV_HEADER: Final = (
    "url", "path", "title", "tier", "status_code", "indexable", "click_depth", "linking_pages",
    "linking_pages_all", "outlinks", "equity_share", "in_sitemap", "top_anchor", "flags",
)


@dataclass(frozen=True, slots=True)
class PageList:
    rows: list[PageRow]
    total: int
    next_cursor: str | None
    run_id: UUID


@dataclass(frozen=True, slots=True)
class NeighborPage:
    rows: list[Neighbor]
    meta: NeighborMeta


class LinkReadService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        # One snapshot for the page, its counts and its total.
        return workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id, isolation_level="REPEATABLE READ"
        )

    async def pages(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        view: LinkScope,
        found: PageFilter,
        sort: str,
        cursor: str | None,
        limit: int,
    ) -> PageList:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            conditions = page_conditions(found, scope)
            total = (
                await db.execute(select(func.count()).select_from(page_rows(scope)).where(*conditions))
            ).scalar_one()
            column = _sort_column(sort, view)
            descending = sort.startswith("-")
            cursor_scope = {"run": str(scope.run_id), "view": view.value, "sort": sort, "filter": found.model_dump(mode="json")}
            statement = _page_select(scope, view, sort).where(*conditions)
            if cursor is not None:
                value, url_id = decode_cursor(cursor, scope=cursor_scope)
                after = tuple_(column, crawl_pages.c.url_id)
                bound = tuple_(literal(_cursor_value(sort, str(value))), literal(int(url_id)))
                statement = statement.where(after < bound if descending else after > bound)
            order = (column.desc(), crawl_pages.c.url_id.desc()) if descending else (column, crawl_pages.c.url_id)
            rows = (await db.execute(statement.order_by(*order).limit(limit + 1))).all()
            more = len(rows) > limit
            rows = rows[:limit]
            next_cursor = (
                encode_cursor([str(rows[-1].sort_key), rows[-1].url_id], scope=cursor_scope)
                if more
                else None
            )
            return PageList(
                rows=await _page_rows(db, scope, view, tiers, rows),
                total=total,
                next_cursor=next_cursor,
                run_id=scope.run_id,
            )

    async def pages_csv(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, view: LinkScope, found: PageFilter, sort: str
    ) -> str:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            column = _sort_column(sort, view)
            rows = (
                await db.execute(
                    _page_select(scope, view, sort)
                    .where(*page_conditions(found, scope))
                    .order_by(column.desc() if sort.startswith("-") else column, crawl_pages.c.url_id)
                    .limit(EXPORT_ROWS_MAX)
                )
            ).all()
        return csv_text(
            _PAGE_CSV_HEADER,
            (
                (
                    row.canonical_url,
                    row.path,
                    row.title,
                    None if (tier := tiers.ref(row.tier_id)) is None else f"{tier.code} {tier.name}",
                    row.status_code,
                    row.is_indexable,
                    row.click_depth,
                    row.in_view_linking,
                    row.linking_pages_all,
                    row.in_view_outlinks,
                    row.equity_share,
                    row.in_sitemap,
                    row.top_anchor,
                    " ".join(_flags(row)),
                )
                for row in rows
            ),
        )
```

The rest of `reads.py` (the class continues):

```python
    async def neighbors(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        url_id: int,
        direction: Direction,
        view: LinkScope,
        limit: int,
        offset: int,
    ) -> NeighborPage:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            return await neighbor_page(db, scope, tiers, url_id, direction, view, limit, offset)

    async def page_detail(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, url_id: int, view: LinkScope
    ) -> PageDetail:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            rows = (
                await db.execute(
                    _page_select(scope, view, "path").where(
                        crawl_pages.c.workspace_id == scope.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                        crawl_pages.c.url_id == url_id,
                    )
                )
            ).all()
            if not rows:
                raise NotFoundError
            (page,) = await _page_rows(db, scope, view, tiers, rows)
            by_placement = [
                PlacementCount(placement=placement, pages=pages)
                for placement, pages in await db.execute(
                    select(crawl_links.c.placement, func.count(distinct(crawl_links.c.source_url_id)))
                    .where(
                        crawl_links.c.run_id == scope.run_id,
                        crawl_links.c.target_url_id == url_id,
                        crawl_links.c.source_url_id != url_id,
                        _in_view(view),
                    )
                    .group_by(crawl_links.c.placement)
                    .order_by(crawl_links.c.placement)
                )
            ]
            anchors = [
                AnchorCount(anchor=anchor, links=int(uses))
                for anchor, uses in await db.execute(
                    select(crawl_links.c.anchor, func.sum(crawl_links.c.occurrences).label("uses"))
                    .where(
                        crawl_links.c.run_id == scope.run_id,
                        crawl_links.c.target_url_id == url_id,
                        crawl_links.c.anchor != "",
                        _in_view(view),
                    )
                    .group_by(crawl_links.c.anchor)
                    .order_by(func.sum(crawl_links.c.occurrences).desc(), crawl_links.c.anchor)
                    .limit(5)
                )
            ]
            linking = await neighbor_page(db, scope, tiers, url_id, "in", view, DETAIL_LIST, 0)
            outlinks = await neighbor_page(db, scope, tiers, url_id, "out", view, DETAIL_LIST, 0)
            return PageDetail(
                page=page,
                linking_by_tier=page.linked_from_tiers,
                linking_by_placement=by_placement,
                top_anchors=anchors,
                linking_pages=linking.rows,
                outlinks=outlinks.rows,
                linking_pages_total=linking.meta.total,
                outlinks_total=outlinks.meta.total,
            )

    async def tier_flow(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, view: LinkScope
    ) -> TierFlow:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            stale = (
                await db.execute(select(crawl_runs.c.tier_flow_stale).where(crawl_runs.c.id == scope.run_id))
            ).scalar_one()
            cells = [
                TierFlowCell(from_tier=tiers.ref(row.from_tier_id), to_tier=tiers.ref(row.to_tier_id), links=row.links)
                for row in await db.execute(
                    select(crawl_tier_flow).where(
                        crawl_tier_flow.c.run_id == scope.run_id,
                        crawl_tier_flow.c.scope == view.value,
                    )
                )
            ]
            stats = {
                row.tier_id: row
                for row in await db.execute(
                    select(crawl_tier_stats).where(crawl_tier_stats.c.run_id == scope.run_id)
                )
            }
            strip = [
                TierStat(
                    tier=ref,
                    pages=0 if (row := stats.get(tier_id)) is None else row.pages,
                    equity_share=0.0 if row is None else row.equity_share,
                    average_depth=None if row is None else row.average_depth,
                )
                for tier_id, ref in [*tiers.refs.items(), (None, None)]
            ]
            return TierFlow(run_id=scope.run_id, scope=view.value, stale=stale, cells=cells, tiers=strip)

    async def worklists(self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None) -> Worklists:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)

            async def pages(worklist: str) -> int:
                found = PageFilter.model_validate({"worklist": worklist})
                return (
                    await db.execute(
                        select(func.count()).select_from(page_rows(scope)).where(*page_conditions(found, scope))
                    )
                ).scalar_one()

            async def links(worklist: str) -> int:
                return (
                    await db.execute(
                        select(func.count())
                        .select_from(_edge_rows(scope))
                        .where(*_edge_conditions(scope, EdgeQuery(worklist=worklist)))
                    )
                ).scalar_one()

            return Worklists(
                run_id=scope.run_id,
                under_linked_t1=await pages("under_linked_t1"),
                orphans=await pages("orphans"),
                editorial_orphans=await pages("editorial_orphans"),
                deep_only_through_auto=await pages("deep_only_through_auto"),
                broken_and_redirected=await links("broken_and_redirected"),
                links_to_non_indexable=await links("links_to_non_indexable"),
            )

    async def edges(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        query: EdgeQuery,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[EdgeRow], int, str | None, UUID]:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            conditions = _edge_conditions(scope, query)
            total = (
                await db.execute(select(func.count()).select_from(_edge_rows(scope)).where(*conditions))
            ).scalar_one()
            rank = case(_SCOPE_RANK, value=crawl_links.c.scope)
            statement = _edge_select(scope).where(*conditions)
            cursor_scope = {"run": str(scope.run_id), "query": query.key()}
            if cursor is not None:
                place, path, link_id = decode_cursor(cursor, scope=cursor_scope)
                statement = statement.where(
                    tuple_(rank, _TARGET_URL.c.path, crawl_links.c.id)
                    > tuple_(literal(int(place)), literal(str(path)), literal(int(link_id)))
                )
            rows = (
                await db.execute(
                    statement.order_by(rank, _TARGET_URL.c.path, crawl_links.c.id).limit(limit + 1)
                )
            ).all()
            more = len(rows) > limit
            rows = rows[:limit]
            next_cursor = (
                encode_cursor(
                    [_SCOPE_RANK[rows[-1].scope], rows[-1].target_path, rows[-1].id], scope=cursor_scope
                )
                if more
                else None
            )
            return [_edge_row(row, tiers) for row in rows], total, next_cursor, scope.run_id

    async def edges_csv(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, query: EdgeQuery
    ) -> str:
        async with self._transaction(access) as db:
            scope = await crawl_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            rank = case(_SCOPE_RANK, value=crawl_links.c.scope)
            rows = (
                await db.execute(
                    _edge_select(scope)
                    .where(*_edge_conditions(scope, query))
                    .order_by(rank, _TARGET_URL.c.path, crawl_links.c.id)
                    .limit(EXPORT_ROWS_MAX)
                )
            ).all()

        def label(tier_id: UUID | None) -> str | None:
            ref = tiers.ref(tier_id)
            return None if ref is None else f"{ref.code} {ref.name}"

        return csv_text(
            (
                "source_url", "source_tier", "target_url", "target_tier", "anchor", "placement",
                "scope", "rel", "target_status", "target_indexable", "occurrences",
            ),
            (
                (
                    row.source_url, label(row.source_tier_id), row.target_url, label(row.target_tier_id),
                    row.anchor, row.placement, row.scope, " ".join(row.rel), row.target_status,
                    row.target_indexable, row.occurrences,
                )
                for row in rows
            ),
        )
```

And the module-level helpers for edges and the journey, after `_page_rows`:

```python
_SOURCE_URL = aliased(urls)
_TARGET_URL = aliased(urls)
_TARGET_PAGE = aliased(crawl_pages)
_SOURCE_TIER = aliased(project_pages)
_TARGET_TIER = aliased(project_pages)
_STATUS_RANGES: Final = {"2xx": (200, 299), "3xx": (300, 399), "4xx": (400, 499), "5xx": (500, 599)}


@dataclass(frozen=True, slots=True)
class EdgeQuery:
    view: LinkScope = LinkScope.ALL
    source_tiers: tuple[UUID | None, ...] | None = None
    target_tiers: tuple[UUID | None, ...] | None = None
    tag_ids: tuple[UUID, ...] = ()
    placements: tuple[str, ...] = ()
    target_status: tuple[str, ...] = ()
    source: int | None = None
    target: int | None = None
    worklist: str | None = None
    q_source: str | None = None
    q_target: str | None = None

    def key(self) -> str:
        return repr(self)


def _edge_rows(scope: PageScope) -> Any:
    def tier_join(alias: Any, column: Any) -> Any:
        return and_(
            alias.c.workspace_id == scope.workspace_id,
            alias.c.project_id == scope.project_id,
            alias.c.url_id == column,
        )

    return (
        crawl_links.join(_SOURCE_URL, _SOURCE_URL.c.id == crawl_links.c.source_url_id)
        .join(_TARGET_URL, _TARGET_URL.c.id == crawl_links.c.target_url_id)
        .outerjoin(
            _TARGET_PAGE,
            and_(_TARGET_PAGE.c.run_id == crawl_links.c.run_id, _TARGET_PAGE.c.url_id == crawl_links.c.target_url_id),
        )
        .outerjoin(_SOURCE_TIER, tier_join(_SOURCE_TIER, crawl_links.c.source_url_id))
        .outerjoin(_TARGET_TIER, tier_join(_TARGET_TIER, crawl_links.c.target_url_id))
    )


def _tier_condition(alias: Any, wanted: tuple[UUID | None, ...]) -> ColumnElement[bool]:
    ids = [tier for tier in wanted if tier is not None]
    either = [alias.c.tier_id.in_(ids)] if ids else []
    if None in wanted:
        either.append(alias.c.tier_id.is_(None))
    return or_(*either)


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _edge_conditions(scope: PageScope, query: EdgeQuery) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [
        crawl_links.c.workspace_id == scope.workspace_id,
        crawl_links.c.run_id == scope.run_id,
        _in_view(query.view),
    ]
    if query.source_tiers is not None:
        conditions.append(_tier_condition(_SOURCE_TIER, query.source_tiers))
    if query.target_tiers is not None:
        conditions.append(_tier_condition(_TARGET_TIER, query.target_tiers))
    if query.tag_ids:
        tagged = select(page_terms.c.url_id).where(
            page_terms.c.workspace_id == scope.workspace_id,
            page_terms.c.project_id == scope.project_id,
            page_terms.c.term_id.in_(query.tag_ids),
        )
        conditions.append(
            or_(crawl_links.c.source_url_id.in_(tagged), crawl_links.c.target_url_id.in_(tagged))
        )
    if query.placements:
        conditions.append(crawl_links.c.placement.in_(query.placements))
    if query.target_status:
        conditions.append(
            or_(*(_TARGET_PAGE.c.status_code.between(*_STATUS_RANGES[name]) for name in query.target_status))
        )
    if query.source is not None:
        conditions.append(crawl_links.c.source_url_id == query.source)
    if query.target is not None:
        conditions.append(crawl_links.c.target_url_id == query.target)
    if query.worklist == "broken_and_redirected":
        conditions.append(_TARGET_PAGE.c.status_code >= 300)
    elif query.worklist == "links_to_non_indexable":
        conditions.append(_TARGET_PAGE.c.is_indexable.is_(False))
    if query.q_source:
        conditions.append(_SOURCE_URL.c.path.ilike(_like(query.q_source), escape="\\"))
    if query.q_target:
        conditions.append(_TARGET_URL.c.path.ilike(_like(query.q_target), escape="\\"))
    return conditions


def _edge_select(scope: PageScope) -> Any:
    redirect = aliased(urls)
    return (
        select(
            crawl_links,
            _SOURCE_URL.c.canonical_url.label("source_url"),
            _SOURCE_URL.c.path.label("source_path"),
            _TARGET_URL.c.canonical_url.label("target_url"),
            _TARGET_URL.c.path.label("target_path"),
            _TARGET_PAGE.c.status_code.label("target_status"),
            _TARGET_PAGE.c.is_indexable.label("target_indexable"),
            redirect.c.canonical_url.label("target_redirect"),
            _SOURCE_TIER.c.tier_id.label("source_tier_id"),
            _TARGET_TIER.c.tier_id.label("target_tier_id"),
        )
        .select_from(_edge_rows(scope).outerjoin(redirect, redirect.c.id == _TARGET_PAGE.c.redirect_url_id))
    )


def _edge_row(row: Row[Any], tiers: Tiers) -> EdgeRow:
    return EdgeRow(
        link_id=str(row.id),
        source=EdgePage(
            url_id=str(row.source_url_id),
            url=row.source_url,
            path=row.source_path,
            tier=tiers.ref(row.source_tier_id),
            status_code=None,
            redirect_url=None,
            is_indexable=None,
        ),
        target=EdgePage(
            url_id=str(row.target_url_id),
            url=row.target_url,
            path=row.target_path,
            tier=tiers.ref(row.target_tier_id),
            status_code=row.target_status,
            redirect_url=row.target_redirect,
            is_indexable=row.target_indexable,
        ),
        anchor=row.anchor,
        kind=row.kind,
        placement=row.placement,
        scope=row.scope,
        rel=list(row.rel),
        is_followed=row.is_followed,
        occurrences=row.occurrences,
    )


async def neighbor_page(
    db: AsyncSession,
    scope: PageScope,
    tiers: Tiers,
    url_id: int,
    direction: Direction,
    view: LinkScope,
    limit: int,
    offset: int,
) -> NeighborPage:
    """One journey step (spec 8): the pages on one side of the focus in the scope in view, with
    the link between, tier, metrics, `has_children` and `reciprocal`, sorted by tier then
    equity share; and the pages of the other scopes as counts for the group cards. The canvas
    decides "new", "back link" and "seen elsewhere" itself."""
    focus = (
        await db.execute(
            select(crawl_pages.c.status_code, crawl_pages.c.redirect_url_id).where(
                crawl_pages.c.workspace_id == scope.workspace_id,
                crawl_pages.c.run_id == scope.run_id,
                crawl_pages.c.url_id == url_id,
            )
        )
    ).one_or_none()
    if focus is None:
        raise NotFoundError
    mine, theirs = (
        (crawl_links.c.source_url_id, crawl_links.c.target_url_id)
        if direction == "out"
        else (crawl_links.c.target_url_id, crawl_links.c.source_url_id)
    )
    on_side = and_(
        crawl_links.c.run_id == scope.run_id,
        mine == url_id,
        theirs != url_id,
    )
    if direction == "out" and focus.redirect_url_id is not None:
        # A redirect has one child, its target (spec 7.5); it is not a link of the page.
        grouped = select(
            literal(focus.redirect_url_id).label("url_id"),
            literal(0).label("links"),
            literal(1).label("occurrences"),
            literal(True).label("followed"),
            literal(None, Text).label("anchor"),
            literal(None, Text).label("placement"),
            literal(None, Text).label("scope"),
            literal("", Text).label("rel"),
        ).subquery()
    else:

        def first(column: Any) -> Any:
            ordered = aggregate_order_by(column, crawl_links.c.occurrences.desc(), crawl_links.c.id)
            return array_agg(ordered)[1]

        grouped = (
            select(
                theirs.label("url_id"),
                func.count().label("links"),
                func.sum(crawl_links.c.occurrences).label("occurrences"),
                func.bool_or(crawl_links.c.is_followed).label("followed"),
                first(crawl_links.c.anchor).label("anchor"),
                first(crawl_links.c.placement).label("placement"),
                first(crawl_links.c.scope).label("scope"),
                first(func.array_to_string(crawl_links.c.rel, " ")).label("rel"),
            )
            .where(on_side, _in_view(view))
            .group_by(theirs)
            .subquery()
        )
    page = aliased(crawl_pages)
    tier = aliased(project_pages)
    level = aliased(page_tier_levels)
    reverse = aliased(crawl_links)
    back = and_(
        reverse.c.run_id == scope.run_id,
        reverse.c.source_url_id == (grouped.c.url_id if direction == "out" else url_id),
        reverse.c.target_url_id == (url_id if direction == "out" else grouped.c.url_id),
        _in_view(view, reverse),
    )
    side = _OUTLINKS if direction == "out" else _LINKING
    children = getattr(page.c, side[view].name)
    rows = (
        await db.execute(
            select(
                grouped,
                urls.c.canonical_url,
                urls.c.path,
                page.c.title,
                page.c.status_code,
                page.c.redirect_url_id,
                page.c.click_depth,
                page.c.equity_share,
                getattr(page.c, _LINKING[view].name).label("in_view_linking"),
                page.c.linking_pages_all,
                tier.c.tier_id,
                (func.coalesce(children, 0) > 0).label("has_children"),
                exists().where(back).label("reciprocal"),
            )
            .select_from(
                grouped.join(urls, urls.c.id == grouped.c.url_id)
                .outerjoin(page, and_(page.c.run_id == scope.run_id, page.c.url_id == grouped.c.url_id))
                .outerjoin(
                    tier,
                    and_(
                        tier.c.workspace_id == scope.workspace_id,
                        tier.c.project_id == scope.project_id,
                        tier.c.url_id == grouped.c.url_id,
                    ),
                )
                .outerjoin(level, level.c.id == tier.c.tier_id)
            )
            .order_by(
                level.c.position.asc().nulls_last(),
                page.c.equity_share.desc().nulls_last(),
                grouped.c.url_id,
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()
    total = (await db.execute(select(func.count()).select_from(grouped))).scalar_one()
    others: list[ScopeCount] = []
    if view is not LinkScope.ALL and not (direction == "out" and focus.redirect_url_id is not None):
        others = [
            ScopeCount(scope=edge_scope, pages=pages)
            for edge_scope, pages in await db.execute(
                select(crawl_links.c.scope, func.count(distinct(theirs)))
                .where(on_side, crawl_links.c.scope != view.value)
                .group_by(crawl_links.c.scope)
                .order_by(crawl_links.c.scope)
            )
        ]
    neighbors = [
        Neighbor(
            url_id=str(row.url_id),
            url=row.canonical_url,
            path=row.path,
            title=row.title,
            status_code=row.status_code,
            redirect_url_id=None if row.redirect_url_id is None else str(row.redirect_url_id),
            tier=tiers.ref(row.tier_id),
            click_depth=row.click_depth,
            linking_pages=row.in_view_linking or 0,
            linking_pages_all=row.linking_pages_all or 0,
            equity_share=row.equity_share,
            anchor=row.anchor,
            placement=row.placement,
            scope=row.scope,
            is_followed=row.followed,
            rel=row.rel.split() if row.rel else [],
            occurrences=int(row.occurrences),
            links=int(row.links),
            has_children=bool(row.has_children),
            reciprocal=bool(row.reciprocal),
        )
        for row in rows
    ]
    meta = NeighborMeta(
        run_id=scope.run_id,
        url_id=str(url_id),
        direction=direction,
        scope=view.value,
        total=total,
        other_scopes=others,
        focus=NeighborFocus(
            url_id=str(url_id),
            status_code=focus.status_code,
            redirect_url_id=None if focus.redirect_url_id is None else str(focus.redirect_url_id),
        ),
    )
    return NeighborPage(rows=neighbors, meta=meta)
```

- [ ] **Step 6: The routes**

`backend/src/idraft/api/internal_links/read_routes.py`:

```python
"""Reads of a project's crawls for the Pages, Links, Journey and Tier flow screens (spec 7 and
8). Every route needs `data:read`; `run` is `latest` or a crawl id, `scope` the link scope in
view (editorial by default). `404 no_crawl` before the first finished crawl."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response

from idraft.api.internal_links.reads import EdgeQuery, LinkReadService
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import (
    EdgeRowPage,
    EdgeWorklist,
    LinkScopeName,
    ListMeta,
    NeighborList,
    PageDetailResponse,
    PageFilter,
    PageFlag,
    PageRowPage,
    PageSort,
    PageWorklist,
    PlacementName,
    StatusClass,
    TierFlowResponse,
    WorklistsResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.crawl.scopes import LinkScope

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links",
    tags=["internal-links"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Run = Annotated[Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")]
Scope = Annotated[LinkScopeName, Query()]
Output = Annotated[Literal["json", "csv"], Query(alias="format")]
TierList = list[UUID | Literal["none"]] | None
TierIds = Annotated[TierList, Commas, Query(alias="filter[tier]", max_length=9)]
SourceTiers = Annotated[TierList, Commas, Query(alias="filter[source_tier]", max_length=9)]
TargetTiers = Annotated[TierList, Commas, Query(alias="filter[target_tier]", max_length=9)]
Tags = Annotated[list[UUID] | None, Commas, Query(alias="filter[tag]", max_length=50)]
Statuses = Annotated[list[StatusClass] | None, Commas, Query(alias="filter[status]", max_length=4)]
TargetStatuses = Annotated[
    list[StatusClass] | None, Commas, Query(alias="filter[target_status]", max_length=4)
]
Flags = Annotated[list[PageFlag] | None, Commas, Query(alias="filter[flags]", max_length=5)]
Placements = Annotated[
    list[PlacementName] | None, Commas, Query(alias="filter[placement]", max_length=7)
]
PathText = Annotated[str | None, Query(min_length=1, max_length=200)]
UrlIdQuery = Annotated[int, Query(gt=0, le=9_223_372_036_854_775_807)]
_CSV = {200: {"content": {"text/csv": {}}, "description": "With `format=csv`: the rows as CSV."}}


def get_reads(resources: Annotated[Resources, Depends(get_resources)]) -> LinkReadService:
    return resources.link_reads


Reads = Annotated[LinkReadService, Depends(get_reads)]


def _run(run: Literal["latest"] | UUID) -> UUID | None:
    return run if isinstance(run, UUID) else None


def _tiers(given: list[UUID | Literal["none"]] | None) -> tuple[UUID | None, ...] | None:
    if given is None:
        return None
    return tuple(tier if isinstance(tier, UUID) else None for tier in given)


def _csv(text: str, name: str) -> Response:
    return Response(
        content=text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )


@router.get(
    "/pages",
    summary="Pages of a crawl, with link counts in the scope in view",
    response_model=PageRowPage,
    responses=_CSV,
)
async def list_pages(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    page: Cursor,
    run: Run = "latest",
    scope: Scope = "editorial",
    tiers: TierIds = None,
    tags: Tags = None,
    status: Statuses = None,
    indexable: Annotated[bool | None, Query(alias="filter[indexable]")] = None,
    flags: Flags = None,
    worklist: Annotated[PageWorklist | None, Query(alias="filter[worklist]")] = None,
    q: PathText = None,
    sort: Annotated[PageSort, Query()] = "-equity_share",
    output: Output = "json",
) -> PageRowPage | Response:
    found = PageFilter(
        tier_ids=tiers, tag_ids=tags, status=status, indexable=indexable, flags=flags,
        worklist=worklist, q=q,
    )
    view = LinkScope(scope)
    if output == "csv":
        text = await reads.pages_csv(access, project_id, run=_run(run), view=view, found=found, sort=sort)
        return _csv(text, "pages")
    listed = await reads.pages(
        access, project_id, run=_run(run), view=view, found=found, sort=sort,
        cursor=page.cursor, limit=page.limit,
    )
    return PageRowPage(
        data=listed.rows,
        page=CursorPageInfo(limit=page.limit, next_cursor=listed.next_cursor, has_more=listed.next_cursor is not None),
        meta=ListMeta(run_id=listed.run_id, scope=scope, total=listed.total),
    )


@router.get("/pages/{url_id}", summary="One page: the inspector")
async def get_page(
    project_id: UUID,
    url_id: Annotated[int, Path(gt=0, le=9_223_372_036_854_775_807)],
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    scope: Scope = "editorial",
) -> PageDetailResponse:
    detail = await reads.page_detail(access, project_id, run=_run(run), url_id=url_id, view=LinkScope(scope))
    return PageDetailResponse(data=detail)


@router.get(
    "/edges",
    summary="Link edges of a crawl",
    description="Template links first, then auto-generated, then editorial, so template fixes "
    "come first; then by target path.",
    response_model=EdgeRowPage,
    responses=_CSV,
)
async def list_edges(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    page: Cursor,
    run: Run = "latest",
    scope: Scope = "editorial",
    source_tiers: SourceTiers = None,
    target_tiers: TargetTiers = None,
    tags: Tags = None,
    placements: Placements = None,
    target_status: TargetStatuses = None,
    source: Annotated[int | None, Query(alias="filter[source]", gt=0)] = None,
    target: Annotated[int | None, Query(alias="filter[target]", gt=0)] = None,
    worklist: Annotated[EdgeWorklist | None, Query(alias="filter[worklist]")] = None,
    q_source: PathText = None,
    q_target: PathText = None,
    output: Output = "json",
) -> EdgeRowPage | Response:
    query = EdgeQuery(
        view=LinkScope(scope),
        source_tiers=_tiers(source_tiers),
        target_tiers=_tiers(target_tiers),
        tag_ids=tuple(tags or ()),
        placements=tuple(placements or ()),
        target_status=tuple(target_status or ()),
        source=source,
        target=target,
        worklist=worklist,
        q_source=q_source,
        q_target=q_target,
    )
    if output == "csv":
        return _csv(await reads.edges_csv(access, project_id, run=_run(run), query=query), "links")
    rows, total, cursor, run_id = await reads.edges(
        access, project_id, run=_run(run), query=query, cursor=page.cursor, limit=page.limit
    )
    return EdgeRowPage(
        data=rows,
        page=CursorPageInfo(limit=page.limit, next_cursor=cursor, has_more=cursor is not None),
        meta=ListMeta(run_id=run_id, scope=scope, total=total),
    )


@router.get(
    "/neighbors",
    summary="One journey step, links out or links in",
    description="The pages on one side of `url_id` in the scope in view, 8 at a time "
    "(`offset` for more), sorted by tier then equity share, with the link between, "
    "`has_children` and `reciprocal`; `meta.other_scopes` counts the pages of the other "
    "scopes for the group cards. A redirect's one child, links out, is its target. The canvas "
    "decides new pages, back links and pages seen elsewhere itself.",
)
async def neighbors(
    project_id: UUID,
    url_id: UrlIdQuery,
    direction: Annotated[Literal["in", "out"], Query()],
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    scope: Scope = "editorial",
    limit: Annotated[int, Query(ge=1, le=50)] = 8,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> NeighborList:
    found = await reads.neighbors(
        access, project_id, run=_run(run), url_id=url_id, direction=direction,
        view=LinkScope(scope), limit=limit, offset=offset,
    )
    return NeighborList(data=found.rows, meta=found.meta)


@router.get("/tier-flow", summary="Links from tier to tier, and each tier's share")
async def tier_flow(
    project_id: UUID, access: ReadData, reads: Reads, run: Run = "latest", scope: Scope = "editorial"
) -> TierFlowResponse:
    return TierFlowResponse(data=await reads.tier_flow(access, project_id, run=_run(run), view=LinkScope(scope)))


@router.get("/worklists", summary="Counts of the saved worklists")
async def worklists(
    project_id: UUID, access: ReadData, reads: Reads, run: Run = "latest"
) -> WorklistsResponse:
    return WorklistsResponse(data=await reads.worklists(access, project_id, run=_run(run)))
```

- [ ] **Step 7: Wiring, route table, run and contract**

`resources.py`: `link_reads: LinkReadService`; `main.py`: `link_reads=LinkReadService(sessions=sessions)` and `app.include_router(read_routes_router)`. `test_route_access.py`:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}",
    ): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/edges"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/neighbors"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-flow"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/worklists"): (
        "data:read"
    ),
```

```bash
uv run pytest --no-cov tests/api/internal_links tests/api/test_route_access.py -q
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest --no-cov tests/api/test_openapi.py -q
```

Expected: all pass.

- [ ] **Step 8: Gate and commit**

```bash
git add backend/src/idraft/api/internal_links/csv_export.py backend/src/idraft/api/internal_links/reads.py \
  backend/src/idraft/api/internal_links/read_routes.py backend/src/idraft/api/schemas/internal_links.py \
  backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/test_route_access.py \
  backend/openapi/v1.json backend/tests/api/internal_links/support.py \
  backend/tests/api/internal_links/test_reads_pages.py backend/tests/api/internal_links/test_reads_neighbors.py \
  backend/tests/api/internal_links/test_reads_edges.py backend/tests/api/internal_links/test_reads_flow.py
git commit -m "Internal links: read API for pages, inspector, links, journey, tier flow and worklists"
```

---

### Task 13: The contract check and the hand-over to plan 03

**Files:**
- Modify: `backend/openapi/v1.json` (only if it drifted)
- Modify: `docs/04-data-model.md` (an "As built (migration 0025)" note under section 5.3), `docs/19-api-specification.md` (an "Internal links (plan 02)" subsection listing the routes of the API contract above)

- [ ] **Step 1: Regenerate and compare**

```bash
uv run python -m idraft.api.openapi > openapi/v1.json
git diff --stat -- openapi/v1.json
uv run pytest --no-cov tests/api/test_openapi.py tests/api/test_route_access.py tests/api/test_problems.py -q
```

Expected: no diff (each API task committed its own), and the three files pass. If there is a diff, a task forgot to commit its regeneration: commit it here.

- [ ] **Step 2: Check the contract against the plan**

```bash
uv run python - <<'PY'
import json
spec = json.load(open("openapi/v1.json"))
for path in sorted(spec["paths"]):
    if any(part in path for part in ("page-tiers", "tier-rules", "/pages/", "link-crawls", "internal-links")):
        print(" ".join(sorted(spec["paths"][path])).upper(), path)
PY
```

Expected: 18 paths with 23 operations (4 tier settings, 5 rules, 4 page tier and tag routes, 4 crawl routes, 6 reads), with the workspace-scoped prefix of decision D1. The settings and project routes, which changed in place, are not matched by this filter.

- [ ] **Step 3: Write the as-built notes**

`docs/04-data-model.md`, at the end of section 5.3: "**As built (migration 0025, internal links).** Page tags are `core.page_terms` rows of `tag` vocabularies. Tiers: `core.page_tier_levels` (workspace, positions 1 to 8), `core.tier_rules`, `core.project_pages`. Crawls live in `seo.crawl_runs`, `seo.crawl_pages`, `seo.crawl_links` (partitioned by crawl, made and dropped by `seo.add_crawl_links_partition` and `seo.drop_crawl_links_partition`), `seo.crawl_tier_flow` and `seo.crawl_tier_stats`. Plan: docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md." `docs/19-api-specification.md`: a subsection "Internal links (plan 02)" with the contract table of this plan, copied as it stands after Tasks 3 to 12. Both in sentence case, no dashes as punctuation.

- [ ] **Step 4: Tell the web session**

The web session (plan 03) regenerates its client in its own commit, as AGENTS.md says: `cd apps/web && pnpm gen:api`, then `pnpm typecheck`. This plan never touches `apps/web/`. The hand-over message names the merge commit on `develop` and the contract section of this plan.

- [ ] **Step 5: Commit**

```bash
git add docs/04-data-model.md docs/19-api-specification.md
git commit -m "Internal links: as-built notes for the data model and the API"
```

(and `backend/openapi/v1.json` if Step 1 found a drift).

---

### Task 14: End-to-end acceptance

**Files:**
- Modify: `backend/tests/collectors/crawl_support.py` (an HTTP stand-in that serves the synthetic site)
- Test: `backend/tests/collectors/test_crawl_end_to_end.py`

- [ ] **Step 1: Serve the synthetic site as DataForSEO would**

Add `import json`, `import httpx` and `from tests.providers.dataforseo.support import Api, as_json, envelope, task_answer` to the imports of `backend/tests/collectors/crawl_support.py`, and append:

```python
E2E_TASK = "11161234-1535-0216-0000-e2e000000001"


def _raw_page(item: PageItem) -> dict[str, object]:
    return {
        "resource_type": item.resource_type,
        "status_code": item.status_code,
        "location": item.location,
        "url": item.url,
        "meta": {"title": item.title, "canonical": item.canonical},
        "checks": {"from_sitemap": item.from_sitemap},
    }


def serve(site: FakeOnPage, api: Api) -> None:
    """The site's crawl through the real adapter: the post, a finished summary, pages two at a
    time with a token, the non-indexable pages and each page's raw HTML."""
    api.answer(
        "POST",
        "/v3/on_page/task_post",
        envelope([task_answer(task_id=E2E_TASK, cost=Decimal("0.3"), status_code=20100)]),
    )
    finished = {
        "crawl_progress": "finished",
        "crawl_status": {"pages_in_queue": 0, "pages_crawled": len(site.pages)},
        "crawl_stop_reason": "empty_queue",
        "domain_info": {"extended_crawl_status": "no_errors", "checks": {"sitemap": True}},
    }
    api.answer(
        "GET",
        f"/v3/on_page/summary/{E2E_TASK}",
        envelope([task_answer(task_id=E2E_TASK, result=[finished])]),
    )

    def pages(request: httpx.Request) -> httpx.Response:
        (asked,) = json.loads(request.content)
        start = int(asked.get("search_after_token") or 0)
        end = start + 2
        result = {
            "total_items_count": len(site.pages),
            "items": [_raw_page(item) for item in site.pages[start:end]],
            "search_after_token": str(end) if end < len(site.pages) else None,
        }
        return as_json(envelope([task_answer(task_id=E2E_TASK, result=[result])]))

    def raw_html(request: httpx.Request) -> httpx.Response:
        (asked,) = json.loads(request.content)
        html = site.html.get(asked["url"])
        result = {"items": None if html is None else {"html": html}}
        return as_json(envelope([task_answer(task_id=E2E_TASK, result=[result])]))

    api.on("POST", "/v3/on_page/pages", pages)
    api.on("POST", "/v3/on_page/raw_html", raw_html)
    items = [{"reason": item.reason, "url": item.url} for item in site.non_indexable_items]
    api.answer(
        "POST",
        "/v3/on_page/non_indexable",
        envelope(
            [task_answer(task_id=E2E_TASK, result=[{"total_items_count": len(items), "items": items}])]
        ),
    )
    api.answer(
        "POST",
        "/v3/on_page/links",
        envelope([task_answer(task_id=E2E_TASK, result=[{"total_items_count": 0, "items": []}])]),
    )
```

- [ ] **Step 2: The end-to-end test**

`backend/tests/collectors/test_crawl_end_to_end.py`:

```python
"""A crawl of the synthetic site from the website-added trigger to the journey, through the
real On-Page adapter, the crawl tick, the ingest and the read queries (spec section 11,
"ingest from recorded DataForSEO payloads")."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.internal_links.reads import load_tiers, neighbor_page
from idraft.collectors.crawl_ingest import ingest_run
from idraft.collectors.crawl_runs import CrawlIngestTask, crawl_tick, queue_run
from idraft.crawl.scopes import LinkScope
from idraft.db.engine import workspace_transaction
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import OnPage
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.internal_links.support import seed_tiers
from tests.collectors.crawl_support import clear_crawls, serve, site_project, synthetic_site
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, Api, FakeGate

Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


@pytest.fixture
async def on_page() -> AsyncIterator[OnPage]:
    api = Api([])
    serve(synthetic_site(), api)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        yield OnPage(DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD, origin=ORIGIN))


async def test_a_new_site_is_crawled_ingested_and_walked(
    migrated: PostgresServer, worker_db: Sessions, on_page: OnPage
) -> None:
    workspace, project = await site_project(migrated)
    t1, *_ = await seed_tiers(migrated, workspace)
    async with worker_db() as db, db.begin():
        run_id = await queue_run(
            db,
            workspace_id=workspace.id,
            project_id=project,
            trigger="website_added",
            requested_by=None,
            now=NOW,
        )
    sent: list[CrawlIngestTask] = []

    async def send(task: CrawlIngestTask) -> bool:
        sent.append(task)
        return True

    report = await crawl_tick(worker_db, on_page, send, now=NOW)
    outcome = await ingest_run(worker_db, on_page, MemoryStore(), sent[0], deadline=time.monotonic() + 120)

    assert (report.posted, report.finished, outcome.failed) == (1, 1, False)
    run = await fetchrow(migrated, "SELECT state, pages_crawled, cost_usd FROM seo.crawl_runs WHERE id = $1", run_id)
    assert (run["state"], run["pages_crawled"]) == ("ready", 11)
    pages = await fetch(migrated, "SELECT count(*) AS n FROM seo.crawl_pages WHERE run_id = $1", run_id)
    assert pages[0]["n"] == 11

    pricing = await fetchrow(
        migrated,
        "SELECT p.url_id FROM seo.crawl_pages p JOIN core.urls u ON u.id = p.url_id "
        "WHERE p.run_id = $1 AND u.path = '/pricing'",
        run_id,
    )
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project,
        pricing["url_id"],
        workspace.id,
        t1,
    )
    scope = PageScope(workspace.id, project, run_id, None)
    async with workspace_transaction(worker_db, workspace.id) as db:
        tiers = await load_tiers(db, workspace.id)
        into = await neighbor_page(db, scope, tiers, pricing["url_id"], "in", LinkScope.ALL, 8, 0)
        out = await neighbor_page(db, scope, tiers, pricing["url_id"], "out", LinkScope.EDITORIAL, 8, 0)

    assert into.meta.total == 7
    assert [(row.path, row.anchor, row.reciprocal) for row in out.rows] == [
        ("/blog/c", "How it works", False)
    ]
    # The menu and the footer: Home, Blog, Privacy (the menu's link to /pricing itself is dropped).
    assert [(count.scope, count.pages) for count in out.meta.other_scopes] == [("template", 3)]
```

- [ ] **Step 3: Run it, then the whole suite**

```bash
uv run pytest --no-cov tests/collectors/test_crawl_end_to_end.py -q
./check.sh
```

Expected: the test passes; `check.sh` ends with every check green, pytest with `Required test coverage of 90% reached`.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/collectors/crawl_support.py backend/tests/collectors/test_crawl_end_to_end.py
git commit -m "Internal links: end-to-end crawl of a synthetic site through the real adapter"
```

- [ ] **Step 5: Manual acceptance on the spike site**

On this machine, with a `.env`, `.env.worker` and `.env.migrator` holding a DataForSEO login (backend/README.md, "Running locally"), and the database migrated (`uv run --env-file .env.migrator python -m idraft.db.migrate`):

1. Start the API (`uv run --env-file .env uvicorn idraft.api.main:create_app --factory --no-access-log --port 8000`) and the worker (`uv run --env-file .env.worker python -m idraft.worker`) in two background shells. Check first that nothing of this project already listens (AGENTS.md and the dev server policy: `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'python|uvicorn'`); use another port if 8000 is taken, never stop another process.
2. As an owner, create a project with `primary_domain` set to the spike site (`cleanstart.com`) and `map_internal_links: true`. Expected: a `queued` crawl with `trigger='website_added'` and ceiling 2,000.
3. Watch `GET .../link-crawls/{id}` every minute: `crawling` with `pages_found` rising, then `processing`, then `ready` (or `stopped_at_ceiling` on a site over 2,000 pages: then `POST .../link-crawls {"higher_limit": true}`).
4. Compare with the spike's hand check of 100 links (plan 01 report): the share of editorial, auto-generated and template placements that match must be at least 95%, and every blog post with previous and next links must show them as auto-generated (`GET .../internal-links/edges?filter[source]=<post url_id>&scope=all`).
5. Check one cost event of workload `site_crawl` for the post, its cost against DataForSEO's dashboard for the task.
6. Write the outcome (pages, minutes, cost, placement accuracy, anything that surprised) into the "Spike outcome" list at the top of this plan and commit it.

Stop the two shells you started when done.

---

## Self-review

### Spec coverage (slice 1, backend)

| Spec requirement | Section | Task |
|---|---|---|
| Crawl when a website is added, opt-out checkbox | 3, 6.2, 7.8 | 10 (`map_internal_links`, D14) |
| Weekly refresh, two weeks, monthly, off, at night in the project's time zone, spread | 6.2, 7.8 | 2 (`crawl_due`), 9 (tick), 10 (settings) |
| Crawl now, one crawl per project, progress | 6.2 | 1 (unique index), 9, 10 |
| Ceiling: 3 x sitemap, at least 2,000, 50,000 without a sitemap; stopped at ceiling; crawl again with a higher limit | 6.2 | 2 (`ceiling`), 9, 10 |
| Run states queued, crawling, processing, ready, stopped_at_ceiling, failed, cancelled | 6.2 | 1, 9, 11 |
| On-Page task settings (target, start URL, ceiling, respect sitemap, raw HTML, JavaScript, subdomains) | 6.1 | 7, 9 |
| Pingback | 6.1 | Not built: polling only (D6, ADR-022) |
| Cost to the ledger, workspace budget check | 6.1 | 1 (workload), 9 (post), 10 (Crawl now) |
| Pages, non-indexable pages, URLs through `core.urls` with canonicalizer v1 | 6.3 step 1 | 11 |
| Raw HTML zstd in R2, latest only | 6.3 step 2 | 11 (D9) |
| Placement classification (plan 01) and the template pass | 6.3 step 3 | 5, 8, 11 |
| Jump links and self links dropped | 6.3 | 8 |
| Edges deduplicated per source, target, placement, anchor with occurrences | 6.3 step 4 | 8 |
| Click depth with redirects; without auto-generated links; deep only through previous and next | 6.4 | 4, 11 |
| PageRank 0.85, 1e-9, 100 rounds, redirects, nofollow, error sinks, sparse matrix, numpy and scipy | 6.4 | 4 |
| Per page per scope: linking pages, by tier, outlinks; outlinks to T1, broken, redirects, non-indexable, top anchor, orphan, editorial orphan | 6.4 | 11 (stored), 12 (by tier and to T1 at read) |
| Reciprocal pairs | 6.4 | 12 (read time, D10) |
| Tier flow per scope; tier equity share, pages, average depth | 6.4 | 6, 11, 12 |
| Tables of 6.5, workspace isolation | 6.5 | 1 (D2) |
| Keep the last 4 crawls' links, pages for every crawl | 6.5 | 1 (partitions), 9 (retention) |
| Tier change needs no crawl; inline up to a size, a job above | 6.6 | 6 (`tiers_changed`, D10), 9 (stale flows) |
| Workspace tiers: four defaults, rename, add to 8, delete with move-to, codes by position, Untiered fixed | 5.1, 7.7 | 1, 3, 6 |
| One tier per page, bulk by ids or "all matching", manual beats first matching rule, manual Untiered, reset to rule, source shown | 5.2 | 6, 12 (`tier_source`, `tier_set_by`, `tier_rule_id`) |
| Rules exact, prefix, pattern, ordered, preview count, apply to every crawl | 5.2 | 2, 6, 11 |
| CSV import with pending rows and line errors | 5.2 | 6 |
| Tags through the taxonomy, bulk add and remove, filters | 5.3 | 6, 12 |
| Pages table filters, sort, columns, cursor paging, CSV export | 7.2, 8 | 6 (filter), 12 |
| Worklists: under-linked T1, orphans, editorial orphans, deep only through previous and next, broken and redirected, links to non-indexable | 7.2 | 6 (page filter), 12 |
| Links table with filters and CSV | 7.3 | 12 |
| Page inspector payload | 7.4 | 12 |
| Neighbors: one step, both directions, scope, limit 8, offset, has children, reciprocal, counts of other scopes; redirect focus | 7.5, 8 | 12 |
| Tier flow tab, Untiered as its own row and column | 7.6 | 12 |
| Project settings: schedule, render JavaScript, allowed subdomains; recent crawls | 7.8 | 10 |
| Errors and states of section 9 | 9 | 9, 10, 11 (error and state table) |
| Tests of section 11 (backend unit and integration, RLS; tier delete with move; one workspace cannot read another's tiers or crawls) | 11 | 1 (catalog RLS), 3 (tiers, delete with move to a tier and to Untiered, other workspace), 6, 10 (other workspace on crawls), 12 (other workspace on pages), 14 |
| Orphans from Search Console clicks | 4 | Slice 2 (D21, O5) |

### Name consistency

- `crawl_store`: `latest_run`, `project_rules`, `apply_rules`, `recompute_tier_flow`, `tiers_changed`, `DATA_STATES`, `ACTIVE_STATES` are defined in Task 6 and used in Tasks 9 to 12 with those signatures.
- `crawl_runs`: `CrawlIngestTask`, `INGEST_JOB`, `queue_run`, `crawl_tick`, `CrawlBusyError`, `NoSiteError`, `NoStoppedCrawlError`, `FEW_PAGES`, `link_settings` are defined in Task 9; Task 10 (API), Task 11 (ingest and wiring) and Task 14 use them.
- `OnPageApi` (Task 7) is what `crawl_tick` and `ingest_run` take; `FakeOnPage` (Task 9) and `OnPage` (Task 7) both satisfy it.
- `PageScope`, `page_rows`, `page_conditions`, `tier_of_position` (Task 6 `page_filter.py`) and `crawl_scope`, `select_pages` (Task 6 `page_tiers.py`) are used by Task 12.
- `site_hosts` lives in `idraft.crawl.hosts` (Task 6) and is used by Tasks 6, 11 and 14.
- Schema names in the API contract match `api/schemas/internal_links.py` as appended in Tasks 3, 6, 10 and 12 (`TierRulePreview.would_apply`, `CrawlRun.hints`, `NeighborMeta.other_scopes`).
- Audit actions used: `page_tier.*` (Task 3), `tier_rule.*`, `page_tiers.changed`, `page_tags.changed` (Task 6), `link_crawl.requested`, `link_crawl.cancelled` (Task 10), all added to `AuditAction` in Task 3.

### Assumptions not verified

- DataForSEO On-Page field names and paths are from the public documentation read on 2026-11-16, not from recorded answers; Task 0 checks them against the spike. In particular whether `max_crawl_pages` decides the price at post time (D5, O1) and whether `store_raw_html` is free (the docs say `raw_html` is free and do not list `store_raw_html` as charged).
- Plan 01's classifier names and signature (`Placement`, `FoundLink`, `classify`) are this plan's assumption, since plan 01 was being written at the same time; Task 8 Step 1 checks them.
- `tests/db/test_tables.py` compares deferrable unique keys and `NULLS NOT DISTINCT` keys the same way as plain ones; if it reports them differently, Task 1 Step 4 matches the metadata to its report.
- That SQLAlchemy renders `on_conflict_do_nothing(index_where=...)` with the predicate inline (literal values, not parameters), so PostgreSQL infers the partial unique index `crawl_runs_one_active` on every execution; Task 9's busy test runs it twice in one test but on one connection.
- Plan 01's `place_links` counts links per page for its steady-count guard; this plan feeds it deduplicated edges (one per target, placement and anchor), so a block's count is a count of distinct links (Task 5's docstring says so).
- That an identity column on the partitioned `seo.crawl_links` needs no sequence grant for `app_worker` (as `ai.observations` already works); `tests/db/test_grants.py` and Task 1's partition test prove it.
- The cost of reading every project with a website once a minute in `crawl_tick` (marked as a shortcut in the code).
