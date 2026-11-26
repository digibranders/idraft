# Pages (Overview, All pages and the page drawer): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task by task. One subagent at a time, never two in parallel. Each task runs in a fresh context: the subagent
> reads "Rules for every task" and "Contracts" below, then its own task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Website audit page Pages of the real app: Overview at `/{workspace}/{project}/seo/pages`, All pages
at `/seo/pages/all`, and the page drawer with the tabs Overview, Search, Issues, AI and Links.

**Architecture:** One new backend module (`api/internal_links/inventory.py`) holds the words of spec section 4
as SQL, once. The Overview read counts with them and the pages list filters with them (`filter[view]`), so a
mark's number and its list's total come from the same predicate. On the web the existing Pages table and page
inspector of Internal links are not rewritten: they get narrow contexts, move under a new screen
(`features/internal-links/pages-page/`), and gain the View menu, the column groups and the drawer tabs. Pure
logic is in `src/lib/pages/`. What other sessions own (issues per page, tracking, the Search Console detail)
is a typed seam in `src/lib/pages/` that answers `unavailable` on this branch.

**Tech stack:** Python 3.13, FastAPI, SQLAlchemy Core (async), pytest with testcontainers Postgres, `uv`.
Next.js (App Router), React, TypeScript, TanStack Query, nuqs, next-intl, Tailwind v4 tokens, vitest with Testing
Library and MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-26-pages-overview-all-drawer-design.md`. Read the sections a task
names before starting it. The spec wins over this plan on what the product does; this plan wins on file names
and order.

---

## Rules for every task

- Work only in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7`
  (branch `claude/pages-overview-all-drawer-f3d1f7`), called `$WT` below. Absolute paths in shell commands. Never
  touch the main checkout, `main`, `develop`, another worktree, or `apps/web/design-preview/`. No push, no merge.
- Read `AGENTS.md` at `$WT` first.
- Other sessions own these files. Do not edit them:
  - `apps/web/src/components/app/inspector/inspector.tsx`, `inspector-layout.tsx`, `use-inspector.ts` and
    everything in `apps/web/src/lib/inspector/` (the shared drawer session, `claude/shared-drawer-121ede`). The
    drawer always lies over the page. Add no width, no docking and no breakpoint for the page drawer.
  - Anything of the Issues session (`backend/src/idraft/api/issues/`, `apps/web/src/lib/issues/`,
    `apps/web/src/features/internal-links/issues/`) and of the Search Console and Monitoring session. In shared
    files (`registry.ts`, `messages/en.json`, `openapi/v1.json`, `terms.md`, `test_route_access.py`) add or
    change only the Pages entries.
- Write and change files with the Write and Edit tools, not shell heredocs.
- Follow the code around you. Check an existing helper before writing one. No `any`, explicit return types,
  specific errors. Comments say why, in one line.
- Machine load: run only the commands a task lists, one at a time, one worker. No full `pnpm test`, no
  `pnpm lint` of the whole app, no `./check.sh`, no e2e, no `pnpm build` (Task 27 runs it once), no dev server
  (Task 27 only). Leave no process running. Never start, stop or restart Colima or Docker: if
  `colima status` says it is not running, stop and tell the lead.
- Words: no em dash and no en dash anywhere (code comments, strings, tests, commit messages). Ranges are
  written "0 to 6". No exclamation marks. Before writing or changing a visible string read
  `docs/glossary/final-list.md`. Every visible string goes in `apps/web/messages/en.json`. Banned in visible
  text: "Monitored" (say "Tracked"), "GSC" (say "Search Console"), "Rankings" and "Ranking" as a noun, "Source"
  as a label, "No data", "N/A", "window" (say "the last 28 days").
- UI tasks (any task that changes a `.tsx` that renders): first read `AI_DEVELOPMENT_UI_RULES.md` and
  `DESIGN_SYSTEM.md` at `$WT`, then invoke the `design-taste-frontend` skill. The project's design system
  outranks the skill: keep the project's fonts, tokens, radii and spacing. No hex colours, no arbitrary
  Tailwind values, type utilities only, numbers through `@/lib/format`.
- Commit at the end of each task on this branch, with the message the task gives. No attribution lines.
  Stage only the files of the task (`git add <paths>`, never `git add -A`).

**Backend commands** (in every shell that runs pytest):

```bash
colima status
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/backend
uv run ruff check <the files you changed>
uv run ruff format --check <the files you changed>
uv run mypy src/idraft/api/internal_links src/idraft/api/schemas <the test files you changed>
uv run lint-imports
uv run pytest -n 0 --no-cov <the test files of the task>
```

When a route, a query parameter or a schema changes, regenerate the committed document in the same commit:

```bash
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest -n 0 --no-cov tests/api/test_openapi.py tests/api/test_route_access.py
```

**Web commands:**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm exec eslint --max-warnings 0 <the files you changed>
pnpm typecheck
pnpm exec vitest run --maxWorkers=1 <the test files you changed or that cover your change>
pnpm exec prettier --check <the files you changed>
```

`pnpm typecheck` is `next typegen && tsc --noEmit`. Use it, not the bare `tsc`: the route pages use
`PageProps<'…'>`, which exists only after `next typegen`.

**The review steps.** Every task ends with the same two steps. The lead (the session that dispatches the
tasks) runs them, not the implementer:

1. *Independent senior review (Sonnet subagent).* A fresh Sonnet subagent is given: the task's text, the spec
   sections the task names, the output of `git show --stat HEAD` and `git show HEAD`, and this list. It checks
   that the diff does what the task and those spec sections say and nothing else; that every file touched is
   one the task names (and none of the forbidden files above); the repository rules (`AGENTS.md`, the house
   style of the files around); types and error handling; for UI: `AI_DEVELOPMENT_UI_RULES.md`,
   `DESIGN_SYSTEM.md`, keyboard reach, accessible names, focus after an action, colour never the only sign;
   visible words against `docs/glossary/final-list.md` and the banned list above; no em dash or en dash in a
   line the commit adds (`git show HEAD | grep -nP '^\+.*[\x{2012}-\x{2015}]'` prints nothing; lines that were
   already there are not this task's); the tests test behaviour and would fail
   without the change; the listed commands were run and passed. Each task adds what else its reviewer must
   look at. The reviewer reports findings with file and line, most serious first, and changes nothing.
2. *Fix what the review found.* A fresh Sonnet subagent (Haiku for a task marked Haiku) fixes every finding
   that is right, reruns the task's commands, and commits as `<the task's commit message> (review fixes)`. A
   finding that is wrong is answered in one line to the lead. The next task starts only after this.

## Contracts

These names are used by more than one task. A task that defines one says so; every other task uses it as
written here.

### C1. The words as SQL (spec section 4), `backend/src/idraft/api/internal_links/inventory.py`

`cp` is `crawl_pages`, `u` is `urls`, `BLOCKED` is `idraft.crawl.status.BLOCKED_STATUSES`.

| Word | Condition |
|---|---|
| counted | `cp.variant_of_url_id IS NULL` |
| variant | `cp.variant_of_url_id IS NOT NULL` |
| live | counted AND `cp.status_code = 200` AND `cp.resource_type = 'html'` |
| redirected | counted AND `cp.status_code BETWEEN 300 AND 399` |
| blocked | counted AND `cp.status_code IN BLOCKED` |
| client error | counted AND `cp.status_code BETWEEN 400 AND 499` AND NOT IN BLOCKED |
| server error | counted AND `cp.status_code BETWEEN 500 AND 599` |
| other | counted AND NOT (live OR redirected OR blocked OR client error OR server error), with a null status counted as other (`coalesce` the whole test to true) |
| indexable | live AND `cp.is_indexable` |
| reachable | live AND `cp.click_depth IS NOT NULL` |

### C2. `PageView` (defined in `backend/src/idraft/api/schemas/internal_links.py` beside `PageWorklist`)

| View id | Condition | Overview field with the same number |
|---|---|---|
| `live` | live | `status.live` |
| `indexable` | indexable | `indexable` |
| `not_indexable` | live AND NOT `is_indexable` | `not_indexable` |
| `redirects` | redirected | `status.redirected` |
| `errors` | client error OR server error | `status.client_error + status.server_error` |
| `client_errors` | client error | `status.client_error` |
| `server_errors` | server error | `status.server_error` |
| `blocked` | blocked | `status.blocked` |
| `other` | other | `status.other` |
| `variants` | variant (the filter then includes variants) | `status.variant` |
| `in_sitemap_indexable` | indexable AND `in_sitemap` | `sitemap.indexable_in_sitemap` |
| `not_in_sitemap` | indexable AND NOT `in_sitemap` | `sitemap.indexable_missing` |
| `sitemap_not_live` | counted AND `in_sitemap` AND NOT live | `sitemap.listed_not_live` |
| `sitemap_not_indexable` | live AND `in_sitemap` AND NOT `is_indexable` | `sitemap.listed_not_indexable` |
| `reachable` | reachable | `reachable` |
| `unreachable` | live AND `click_depth IS NULL` | `unreachable` |

`with_issues` and `tracked` are not in the literal on this branch: their sessions add them.

### C3. The section of a path (API definition)

`'/' || split_part(u.path, '/', 2) || '/'` when `split_part(u.path, '/', 3) <> ''`, else `'/'`. In words: a
page with one segment or none is in `/`, and a folder's own index (`/blog/`) is in `/` too.

| Path | Section |
|---|---|
| `/` | `/` |
| `/pricing` | `/` |
| `/blog/` | `/` |
| `/blog/post` | `/blog/` |
| `/blog/2026/post` | `/blog/` |

The web's `sectionOf` in `lib/internal-links/map-graph.ts` is another thing (the Link map's colour key, with
`home` and `top`). Do not use it for Pages.

### C4. API additions

- `GET …/internal-links/pages`: `filter[view]` (C2), `filter[folder]` (a section of C3, 1 to 200 characters),
  `filter[depth]` (0 to 6: reachable AND `least(click_depth, 6) = n`), sort keys `impressions` and
  `-impressions`. `PageFilter` gains `view`, `folder`, `depth` (all optional, default `None`).
- `GET …/internal-links/overview?run=latest` answering `PagesOverviewResponse` (spec 6.1).
- `GET …/internal-links/pages/{url_id}/search?run=latest` answering `PageSearchDailyResponse` (spec 9.5).

### C5. Web names

| Name | File | Shape |
|---|---|---|
| `PageView`, `PagesOverview`, `PageSearchDaily` | `src/lib/internal-links/types.ts` | from the generated client |
| `PAGE_SORTS` | `src/lib/internal-links/page-sorts.ts` | moved from `features/internal-links/url-state.ts`, which re-exports it |
| `PageQuery` additions | `src/lib/internal-links/queries.ts` | `view: PageView \| null; folder: string \| null; depth: number \| null; includeVariants: boolean` |
| `overviewQuery(scope, run)`, `pageSearchQuery(scope, urlId, run)` | `src/lib/internal-links/queries.ts` | `apiQuery` options, as `worklistsQuery` |
| `pagesTabPath(workspace, project, tab?)` | `src/lib/routes/paths.ts` | `tab` is `'overview' \| 'all'`; default `'overview'` |
| `PAGES_TABS`, `PagesTabId` | `src/lib/pages/tabs.ts` | `overview`, `all`, `monitoring` |
| `PagesState`, `parsePagesSearch`, `PAGES_DEFAULT_SORT`, `PAGES_REDIRECT_KEYS` | `src/lib/pages/url-state.ts` | below |
| `Seam<T>`, `useIssueTotals`, `usePageIssues`, `ISSUE_COLUMNS_AVAILABLE`, `issueCountsOf` | `src/lib/pages/issue-source.ts` | spec 10.1 |
| `TRACKING_AVAILABLE`, `useTrackedPages`, `useTrackPages`, `TrackOutcome` | `src/lib/pages/tracking.ts` | spec 10.2 |
| `PageSearchDetailSlot` | `src/lib/pages/search-detail-slot.tsx` | spec 10.3 |
| `usePageSearchDaily(scope, run, urlId)` | `src/lib/pages/search-daily.ts` | `Seam<PageSearchDaily>`, never `unavailable` on this branch |
| `PAGE_VIEW_MENU`, `viewCounts` | `src/lib/pages/views.ts` | Task 10 |
| `overviewModel` | `src/lib/pages/overview-model.ts` | Task 10 |
| `PagesContext` | `src/features/internal-links/pages/pages-context.ts` | Task 11 |
| `PageDrawerContext` | `src/features/internal-links/inspector/page-drawer-context.ts` | spec 9.2 |
| `PagesScreen` | `src/features/internal-links/pages-page/pages-screen.tsx` | `{ workspaceId, workspaceSlug, project, tab: 'overview' \| 'all' }` |
| `pagesAs(role, tab, project?)` | `src/test/pages-harness.tsx` | as `internalLinksAs` |

```ts
// src/lib/pages/url-state.ts
export interface PagesState {
  /** The crawl the address chooses, or null for the latest; a malformed id is in `invalidRun`. */
  run: string | null;
  invalidRun: string | null;
  scope: LinkScope;
  /** `view` of the address as a server view, or as one of the six page worklists. Never both. */
  view: PageView | null;
  worklist: PageWorklist | null;
  sort: PageSort;
  q: string | null;
  depth: number | null;
  variants: boolean;
}
export type PagesKey = 'run' | 'scope' | 'view' | 'sort' | 'q' | 'depth' | 'variants' | 'inspect' | 'itab';
export const PAGES_DEFAULT_SORT: PageSort = 'path';
/** The keys only the old Pages tab of Internal links wrote (spec 5.3). */
export const PAGES_REDIRECT_KEYS: readonly string[] =
  ['view', 'sort', 'q', 'tier', 'tag', 'status', 'idx', 'flag', 'cols', 'density'];
export function parsePagesSearch(search: Readonly<Partial<Record<PagesKey, string | null | undefined>>>): PagesState;
```

The folder is not in `PagesState`: `folder` is a key of the filter bar (`useUrlFilters`), as `tier` and `status`
are, so an Overview link that writes `folder=/blog/` sets the Folder filter (Task 20).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/idraft/api/internal_links/inventory.py` | C1, C2, C3 as SQL; the overview aggregate | 1, 2, 3 |
| `backend/src/idraft/api/schemas/internal_links.py` | `PageView`, `PageFilter.view/folder/depth`, `PageSort` | 1, 2, 4 |
| `backend/src/idraft/api/internal_links/page_filter.py` | applies view, folder, depth | 1, 2 |
| `backend/src/idraft/api/internal_links/read_routes.py` | the three parameters and the two routes | 1, 2, 3, 5 |
| `backend/src/idraft/api/schemas/internal_links_extra.py` | overview and search schemas | 3, 5 |
| `backend/src/idraft/api/internal_links/reads.py` | `LinkReadService.overview`, `.page_search`, `_sorter` | 3, 4, 5 |
| `backend/src/idraft/api/internal_links/page_sort.py` | the sort `impressions` | 4 |
| `backend/src/idraft/api/internal_links/extras.py` | `page_search_daily` | 5 |
| `backend/tests/api/internal_links/support_inventory.py`, `test_inventory.py`, `test_page_search.py` | tests | 1 to 5 |
| `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json` | two rows; regenerated | 1 to 5 |
| `apps/web/src/lib/api/schema.ts` | regenerated client, own commit | 6 |
| `apps/web/src/lib/internal-links/{types,queries,page-sorts}.ts` | types, reads, sorts | 7 |
| `apps/web/src/mocks/internal-links-inventory.ts`, `mocks/handlers/internal-links.ts` | the mocked API | 8 |
| `apps/web/src/lib/pages/*.ts(x)`, `lib/routes/paths.ts` | tabs, address, seams, views, overview model | 9, 10 |
| `apps/web/src/features/internal-links/pages/pages-context.ts`, `inspector/page-drawer-context.ts` | narrow contexts | 11 |
| `apps/web/src/features/internal-links/crawl-shell.tsx`, `crawl-header.tsx` | the crawl shell both screens use; the one-line header | 12 |
| `apps/web/src/features/internal-links/pages-page/*` | the screen and the Overview | 13, 21, 22 |
| `apps/web/src/app/[workspace]/[project]/seo/pages/**` | the two routes | 14 |
| `apps/web/src/lib/navigation/registry.ts` | `pages` is `live` | 14 |
| `apps/web/src/test/pages-harness.tsx` | test harness | 13 |
| `apps/web/src/features/internal-links/{tabs.ts,url-state.ts,internal-links-screen.tsx}`, `seo/internal-links/page.tsx` | the tab leaves, the redirect | 16 |
| `apps/web/src/components/app/data-table/{types.ts,toolbar.tsx,data-table.tsx,column-chooser.tsx}` | `toolbarStart`, chooser groups | 17 |
| `apps/web/src/features/internal-links/pages/*` | the table's changes | 11, 18 to 20 |
| `apps/web/src/features/internal-links/inspector/*` | the tabbed drawer | 11, 23 to 25 |
| `apps/web/messages/en.json`, `docs/design-system/11-navigation.md` | words (added by each UI task; audited in 26) | 13 to 26 |

---

## Part A. Backend

### Task 1: The words as SQL and `filter[view]` on the pages list

Spec sections 4, 6.2 (first three bullets), 7.3 (the paragraph "Server"), 12. Contracts C1, C2.

**Files:**
- Create: `backend/src/idraft/api/internal_links/inventory.py`
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`PageView`, `PageFilter`)
- Modify: `backend/src/idraft/api/internal_links/page_filter.py` (`page_conditions`)
- Modify: `backend/src/idraft/api/internal_links/read_routes.py` (`list_pages`)
- Create: `backend/tests/api/internal_links/support_inventory.py`, `backend/tests/api/internal_links/test_inventory.py`
- Modify: `backend/openapi/v1.json` (regenerated)

- [ ] **Step 1: Read first.** `page_filter.py` whole, `status_filter.py`, `backend/src/idraft/crawl/status.py`,
  `read_routes.py` (`list_pages`), `tests/api/internal_links/support.py` (`seed_crawl`, `set_counts`,
  `read_site`), `tests/api/internal_links/test_variants.py` (how a test sets `variant_of_url_id` and
  `is_indexable` with an `UPDATE`), `tests/api/internal_links/test_page_sort_extra.py` (`_site`, `_walk`, the
  `member` helper).

- [ ] **Step 2: The seeded crawl.** `support_inventory.py` exports

```python
async def inventory_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, *, sitemap: bool = True
) -> tuple[uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A finished crawl with one known case of each word of spec section 4. Returns the run id, the url ids
    by path and the tier ids."""
```

  It calls `seed_tiers` and `seed_crawl`, then sets the columns `seed_crawl` leaves at their defaults with
  `UPDATE seo.crawl_pages … WHERE run_id = $1 AND url_id = $2`, and `seo.crawl_runs.sitemap_pages` (a number
  when `sitemap`, null when not). The pages, exactly:

| Path | status | resource_type | is_indexable | in_sitemap | click_depth | is_orphan | other |
|---|---|---|---|---|---|---|---|
| `/` | 200 | html | true | true | 0 | false | |
| `/pricing` | 200 | html | true | true | 1 | false | tier 1 (manual) |
| `/blog/` | 200 | html | true | false | 1 | false | |
| `/blog/a` | 200 | html | true | true | 2 | false | tier 3 (manual) |
| `/blog/b` | 200 | html | false | true | 2 | false | `non_indexable_reason = 'noindex'` |
| `/blog/deep` | 200 | html | true | false | 9 | false | |
| `/docs/lost` | 200 | html | true | false | null | true | |
| `/blog/a-variant` | 200 | html | false | true | 2 | false | `variant_of_url_id` and `canonical_url_id` = `/blog/a` |
| `/old` | 301 | redirect | false | true | 3 | false | `redirect_url_id` = `/pricing` |
| `/gone` | 404 | broken | false | true | 3 | false | |
| `/down` | 500 | broken | false | false | null | true | |
| `/private` | 403 | broken | false | false | null | false | |
| `/file.pdf` | 200 | other | false | false | 2 | false | |
| `/unknown` | null | other | false | false | null | false | |

  `seed_crawl` takes `(path, status)` pairs with an `int` status: give `/unknown` 200 there and set its
  `status_code` to null in the update. The expected numbers, as a module constant the tests import:

```python
EXPECTED: Final = {
    "addresses": 14,
    "live": 7, "variant": 1, "redirected": 1, "client_error": 1, "server_error": 1, "blocked": 1, "other": 2,
    "indexable": 6, "not_indexable": 1, "reachable": 6, "unreachable": 1, "orphans": 2,
    "indexable_in_sitemap": 3, "indexable_missing": 3, "listed_not_live": 2, "listed_not_indexable": 1,
}
```

  Work each number out by hand from the table before trusting it, and correct the constant if the table says
  otherwise (the table is the truth).

- [ ] **Step 3: Write the failing tests** in `test_inventory.py`. One test per line:
  - for each view of `PageView` (parametrized), `GET …/internal-links/pages?filter[view]=<view>&scope=all`
    as a viewer answers 200 and `meta.total` equals the number C2 maps it to in `EXPECTED`;
  - `filter[view]=variants` lists `/blog/a-variant` without `filter[include_variants]`;
  - `filter[view]=live` with `filter[worklist]=orphans` is `422`;
  - an unknown view is `422`;
  - `format=csv` with `filter[view]=redirects` has the header and exactly the row of `/old`;
  - `filter[view]=errors&q=/go` lists only `/gone` (a view narrows, the search applies on top);
  - a member of another workspace gets `404` for the project.

- [ ] **Step 4: Run them, expect failures.**
  `uv run pytest -n 0 --no-cov tests/api/internal_links/test_inventory.py` fails on the unknown parameter.

- [ ] **Step 5: Implement.**
  - `schemas/internal_links.py`: `PageView = Literal[…the 16 ids of C2, in that order…]` beside `PageWorklist`.
    `PageFilter` gains `view: PageView | None = None` and a `model_validator(mode="after")` that raises
    `ValueError("give one of `view` and `worklist`, not both")` when both are set (this is the `422` of a bulk
    body).
  - `inventory.py`, with a module docstring that names the spec section:

```python
def view_condition(view: PageView) -> ColumnElement[bool]: ...
```

    The words of C1 are private functions of this module (`_counted()`, `_live()`, `_redirected()`,
    `_blocked()`, `_client_error()`, `_server_error()`, `_other()`, `_indexable()`, `_reachable()`), one
    definition each, and `view_condition` is a lookup over them. Reuse `BLOCKED_STATUSES`; do not write the
    three codes again.
  - `page_filter.py` `page_conditions`: after the flags, `if found.view is not None:
    conditions.append(view_condition(found.view))`; the variants line becomes "leave variants out unless
    `include_variants`, the `variant` flag, or `view == "variants"`".
  - `read_routes.py` `list_pages`: parameter
    `view: Annotated[PageView | None, Query(alias="filter[view]")] = None`. Before `PageFilter(...)` is built:
    when `view` and `worklist` are both given, raise
    `RequestValidationError([{"loc": ("query", "filter[view]"), "type": "view_with_worklist", "msg": "Give `filter[view]` or `filter[worklist]`, not both."}])`
    (the pattern of `_query_error` in `tier_levels.py`; a `ValueError` from the model here would be a 500).
    Pass `view=view` into `PageFilter`.

- [ ] **Step 6: Run the tests, expect pass.** Then the pages tests that share the filter, to prove nothing
  moved: `uv run pytest -n 0 --no-cov tests/api/internal_links/test_inventory.py tests/api/internal_links/test_reads_pages.py tests/api/internal_links/test_variants.py tests/api/internal_links/test_blocked_pages.py`.

- [ ] **Step 7: Regenerate the OpenAPI document and run the backend commands** of "Rules for every task" on
  the files of this task.

- [ ] **Step 8: Commit.**
  `git add backend/src/idraft/api/internal_links/inventory.py backend/src/idraft/api/internal_links/page_filter.py backend/src/idraft/api/internal_links/read_routes.py backend/src/idraft/api/schemas/internal_links.py backend/tests/api/internal_links/support_inventory.py backend/tests/api/internal_links/test_inventory.py backend/openapi/v1.json`
  then `git commit -m "Pages API: the page views as one predicate, filter[view] on the pages list"`.

- [ ] **Step 9: Independent senior review (Sonnet subagent).** Besides the common list: each condition of
  `inventory.py` against the table of spec section 4, word by word (blocked is not a client error; a null
  status is `other`; live needs `resource_type = 'html'`); every address of the seeded crawl falls in exactly
  one of the seven status groups; `EXPECTED` recomputed by hand from the table; the bulk bodies
  (`page_tiers.py`) still build their `PageFilter` unchanged.

- [ ] **Step 10: Fix what the review found**, rerun the commands, commit.

### Task 2: `filter[folder]` and `filter[depth]`

Spec 7.4. Contracts C3, C4.

**Files:**
- Modify: `backend/src/idraft/api/internal_links/inventory.py` (`section_of`, `depth_bucket`)
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`PageFilter.folder`, `.depth`)
- Modify: `backend/src/idraft/api/internal_links/page_filter.py`, `read_routes.py`
- Modify: `backend/tests/api/internal_links/test_inventory.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Write the failing tests** (the crawl of `inventory_site`, viewer, `scope=all`):
  - `filter[folder]=/blog/` lists exactly `/blog/a`, `/blog/b`, `/blog/deep` (the variant is left out as
    everywhere; `/blog/` itself is in `/`);
  - `filter[folder]=/` lists the pages C3 puts in `/` (`/`, `/pricing`, `/blog/`, `/old`, `/gone`, `/down`,
    `/private`, `/file.pdf`, `/unknown`);
  - `filter[view]=live&filter[folder]=/blog/` has `meta.total` 3;
  - `filter[depth]=2` lists `/blog/a`, `/blog/b` (live and at depth 2; `/file.pdf` is not live);
  - `filter[depth]=6` lists `/blog/deep` (depth 9 lands in "6 and more");
  - `filter[depth]=7` and `filter[depth]=-1` are `422`; a folder of 201 characters is `422`.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**

```python
def section_of() -> ColumnElement[str]:
    """The first folder of the path (C3 of the plan, spec section 4): `/blog/` for `/blog/post`, `/` for a
    page with one segment or none."""

def depth_bucket() -> ColumnElement[int]:
    """`least(click_depth, 6)`: the row 6 is 6 clicks and more."""
```

  `section_of` must give every row of the C3 table; write it with `func.split_part(urls.c.path, "/", 2)` and
  `func.split_part(urls.c.path, "/", 3)` in a `case`. `PageFilter` gains
  `folder: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None` and
  `depth: Annotated[int, Field(ge=0, le=6)] | None = None`. `page_conditions` appends
  `section_of() == found.folder` and, for depth, the reachable condition of C1 and
  `depth_bucket() == found.depth`. `list_pages` gains
  `folder: Annotated[str | None, Query(alias="filter[folder]", min_length=1, max_length=200)] = None` and
  `depth: Annotated[int | None, Query(alias="filter[depth]", ge=0, le=6)] = None`, passed into `PageFilter`.
  Add a unit test of `section_of` over the five rows of C3 through one `SELECT` on seeded `core.urls` rows
  (the helper `url_id` of `support.py` makes them).

- [ ] **Step 4: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands.**

- [ ] **Step 5: Commit.** `git commit -m "Pages API: filter[folder] and filter[depth] on the pages list"` with
  the five files staged by path.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: `section_of` against
  each row of C3; depth counts only reachable (live) pages, as the Overview's depth card will; the cursor of
  the list still carries the filter (`cursor_scope` uses `found.model_dump`, so a new field is in it without
  a change: confirm by reading `reads.py` `pages`).

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 3: The Overview read

Spec 6.1, 6.2, decisions D7 and D8, section 12. Contracts C1 to C4.

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py` (schemas)
- Modify: `backend/src/idraft/api/internal_links/inventory.py` (`overview_statement`)
- Modify: `backend/src/idraft/api/internal_links/reads.py` (`LinkReadService.overview`)
- Modify: `backend/src/idraft/api/internal_links/read_routes.py` (`@router.get("/overview")`)
- Modify: `backend/tests/api/test_route_access.py` (one row), `backend/tests/api/internal_links/test_inventory.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Read first.** `reads.py` (`LinkReadService._transaction`, `worklists`, `read_scope`,
  `load_tiers`, `Tiers.ref`), `page_filter.py` (`page_rows`), `schemas/internal_links.py` (`TierCount`,
  `TierRef`), `tests/api/test_route_access.py` (the rows of `internal-links`).

- [ ] **Step 2: Write the failing tests.**
  - `GET …/internal-links/overview` as a viewer on `inventory_site` answers 200; every number of `EXPECTED`
    equals its field (the mapping of C2, plus `addresses` and `orphans`);
  - the invariants of spec section 12: the seven status groups add up to `addresses`; `indexable +
    not_indexable == status.live`; `reachable + unreachable == status.live`; the seven depth rows add up to
    `reachable`, there are always 7, and row 6 holds `/blog/deep`; the tiers add up to `status.live` and the
    Untiered entry has `tier: null`; a tier with no live page is absent; the sections add up to `status.live`,
    are sorted largest first then by name in byte order, and `sections_total` is their count;
    `sitemap.indexable_in_sitemap + sitemap.indexable_missing == indexable`;
  - D8: for every view of `PageView` (parametrized) the overview's number equals `meta.total` of
    `GET …/pages?filter[view]=<view>&scope=all` on the same crawl;
  - `orphans` equals `meta.total` of `filter[worklist]=orphans`;
  - with `inventory_site(…, sitemap=False)`: `sitemap.state` is `no_sitemap`, the four counts are null;
  - `crawled_at` is the crawl's `finished_at`; `run_id` is the crawl's id; `run=<id of an older crawl>`
    answers that crawl's numbers (seed a second crawl with `seed_crawl`);
  - before any finished crawl: `404` with code `no_crawl`; a project of another workspace: `404 not_found`;
    a role without `data:read` is refused (copy how `test_reads_isolation.py` asserts both).

- [ ] **Step 3: Run, expect failures (404 on the route).**

- [ ] **Step 4: Schemas**, in `internal_links_extra.py` after `ChangesSummaryResponse`:

```python
class OverviewStatus(BaseModel):
    live: int
    variant: int
    redirected: int
    client_error: int
    server_error: int
    blocked: int
    other: int


class OverviewSitemap(BaseModel):
    state: Literal["read", "no_sitemap"]
    indexable_in_sitemap: int | None
    indexable_missing: int | None
    listed_not_live: int | None
    listed_not_indexable: int | None


class OverviewDepth(BaseModel):
    clicks: int = Field(description="0 to 6; 6 is 6 clicks and more.")
    pages: int


class OverviewSection(BaseModel):
    section: str = Field(description="The first folder of the path, `/` for a top-level page.")
    pages: int


class PagesOverview(BaseModel):
    run_id: UUID
    crawled_at: datetime | None
    addresses: int
    status: OverviewStatus
    indexable: int
    not_indexable: int
    reachable: int
    unreachable: int
    orphans: int
    sitemap: OverviewSitemap
    depth: list[OverviewDepth]
    tiers: list[TierCount]
    sections: list[OverviewSection]
    sections_total: int


class PagesOverviewResponse(BaseModel):
    data: PagesOverview
```

  Import `TierCount` from `schemas/internal_links.py`.

- [ ] **Step 5: The aggregate**, in `inventory.py`:

```python
SECTIONS_MAX: Final = 50

def overview_statement(scope: PageScope) -> Select[Any]:
    """One row: `addresses`, one `count(*) FILTER (WHERE view_condition(view))` per view of PageView
    (labelled with the view id), `orphans`, and `depth_0` to `depth_6`."""
```

  It selects from `crawl_pages JOIN urls` of the run (`workspace_id` and `run_id` both named, as every
  statement here). `orphans` is `_counted() AND crawl_pages.c.is_orphan`. Each depth column is the reachable
  condition AND `depth_bucket() == n`.

- [ ] **Step 6: The service**, `LinkReadService.overview(self, access, project_id, *, run: UUID | None) -> PagesOverview`,
  inside `self._transaction(access)`: `read_scope`; `load_tiers`; the aggregate row; a grouped count of live
  pages by `project_pages.c.tier_id` over `page_rows(scope)`; a grouped count of live pages by `section_of()`
  ordered by count descending then `collate(section, "C")`, limit `SECTIONS_MAX`; a count of distinct
  sections of live pages; the `crawl_runs` row (`sitemap_pages`, `finished_at`). `sitemap.state` is
  `no_sitemap` when `sitemap_pages` is null or 0, and the four counts are then `None`. Order the tiers by
  position with Untiered last (`Tiers.positions`).

- [ ] **Step 7: The route** in `read_routes.py`, after `worklists`:

```python
@router.get("/overview", summary="Counts of a crawl's pages for the Pages overview")
async def overview(
    project_id: UUID, access: ReadData, reads: Reads, run: Run = "latest"
) -> PagesOverviewResponse:
    return PagesOverviewResponse(data=await reads.overview(access, project_id, run=_run(run)))
```

  and the row in `tests/api/test_route_access.py` beside `internal-links/worklists`:
  `("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/overview"): ("data:read"),`.

- [ ] **Step 8: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands.**

- [ ] **Step 9: Commit.** `git commit -m "Pages API: the overview read of a crawl's pages"` with the seven
  files staged by path.

- [ ] **Step 10: Independent senior review (Sonnet subagent).** Besides the common list: the number of
  statements (at most five after `read_scope` and `load_tiers`) and that all run in the one transaction;
  no count is computed by a second definition of a word (everything goes through `view_condition` or the
  private words of `inventory.py`); the D8 test really compares the two routes for all 16 views; the
  route-access row exists; nothing computes an issue total (spec 6.3).

- [ ] **Step 11: Fix what the review found**, rerun, commit.

### Task 4: The sort `impressions`

Spec 7.2 (the paragraph "Backend change for this section").

**Files:**
- Modify: `backend/src/idraft/api/internal_links/page_sort.py`, `reads.py` (`_sorter`),
  `backend/src/idraft/api/schemas/internal_links.py` (`PageSort`)
- Modify: `backend/tests/api/internal_links/test_page_sort_extra.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Write the failing test**, a copy of
  `test_clicks_sort_by_google_clicks_and_are_all_equal_without_a_property` named
  `test_impressions_sort_by_google_impressions_and_are_all_equal_without_a_property`: without a property
  `-impressions` orders by page id only; with `gsc_property` and two `fp.gsc_page_daily` rows (`/c` 900
  impressions and 1 click, `/e` 400 impressions and 5 clicks, so the order differs from the clicks order)
  `-impressions` starts `/c`, `/e`, `impressions` ends `/e`, `/c`; `_walk` with `limit=2` returns every page
  once (paging over the tie of the four pages with 0).

- [ ] **Step 2: Run, expect `422` (unknown sort).**

- [ ] **Step 3: Implement.** `page_sort.py`: `_clicks(scope, gsc)` becomes
  `_gsc_total(scope, gsc, column: Literal["clicks", "impressions"])` summing `gsc_page_daily.c[column]`;
  `EXTRA_SORTS` gains `"impressions"`; `extra_sort` dispatches `clicks` and `impressions` to it.
  `reads.py` `_sorter`: `if sort.lstrip("-") in ("clicks", "impressions"):` reads the window (today only
  `clicks` does, so without this line the new sort is all zeros). `PageSort` gains `"impressions"` and
  `"-impressions"` after `"-clicks"`. `_cursor_value` needs no change (an integer is its default branch).

- [ ] **Step 4: Run** `uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_sort_extra.py`, expect
  pass. Regenerate the OpenAPI document. Run the backend commands.

- [ ] **Step 5: Commit.** `git commit -m "Pages API: sort the pages list by impressions"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: the clicks sort is
  unchanged in behaviour (its test still passes untouched); `_sorter` reads the window for both keys.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 5: The daily Search Console read of one page

Spec 9.5 and 15 point 3.

**Before dispatching (the lead, not the subagent):** ask the Search Console session whether it has shipped,
or is about to ship, a series route for one page. If it has, skip this task; Task 9 then points
`usePageSearchDaily` at that route. If not, tell that session this route is being built and go on.

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py`, `backend/src/idraft/api/internal_links/extras.py`,
  `reads.py`, `read_routes.py`
- Modify: `backend/tests/api/test_route_access.py`
- Create: `backend/tests/api/internal_links/test_page_search.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Read first.** `extras.py` (`gsc_window`, `gsc_of`), `api/keywords/gsc_repository.py`
  (`GscScope`), `tests/api/internal_links/support_changes.py` (`gsc_property`: its window ends
  `date.today() - timedelta(days=3)`), `test_page_extras.py` near line 346 (how a page day is inserted and
  which state follows).

- [ ] **Step 2: Write the failing tests** in `test_page_search.py` (the crawl of `read_site`):
  - no property: `state` is `not_connected`, `clicks`, `impressions`, `window_start`, `window_end` are null,
    `days` is `[]`;
  - a property with a window and no stored page day: `state` is `pending`, the same nulls;
  - a property and two stored days for `/pricing` (clicks 4 and 6, impressions 90 and 110): `state` is `ok`,
    `clicks` 10, `impressions` 200, `days` has one row for every day from `window_start` to `window_end`
    inclusive in date order, the two stored days carry their numbers and every other day is 0 and 0;
  - a page of the crawl with no stored row, while another page has one: `state` is `ok`, totals 0, every
    day 0;
  - a `url_id` the crawl in view does not hold: `404 not_found`; a `url_id` that is not digits: `422`;
  - another workspace's member: `404`; before any crawl: `404 no_crawl`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** Schemas:

```python
class PageSearchDay(BaseModel):
    date: date
    clicks: int
    impressions: int


class PageSearchDaily(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    window_start: date | None
    window_end: date | None
    clicks: int | None
    impressions: int | None
    days: list[PageSearchDay]


class PageSearchDailyResponse(BaseModel):
    data: PageSearchDaily
```

  `extras.py`: `async def page_search_daily(db: AsyncSession, scope: PageScope, url_id: int) -> PageSearchDaily`:
  `gsc_window`; without an integration or a window the empty answer with that state; else one
  `SELECT metric_date, clicks, impressions FROM fp.gsc_page_daily` for the workspace, the project, the
  integration, the URL and the window, and the days filled in Python from `window[0]` to `window[1]`.
  `reads.py`: `LinkReadService.page_search(self, access, project_id, *, run, url_id) -> PageSearchDaily`:
  `read_scope`, then `NotFoundError` unless `crawl_pages` has the row of `(workspace, run, url_id)` (the
  check `page_detail` makes through its select), then `page_search_daily`. Route:

```python
@router.get("/pages/{url_id}/search", summary="One page: Search Console clicks and impressions by day")
async def page_search(
    project_id: UUID, url_id: UrlIdPath, access: ReadData, reads: Reads, run: Run = "latest"
) -> PageSearchDailyResponse:
```

  The row in `test_route_access.py`:
  `("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/search"): "data:read",`.

- [ ] **Step 5: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands.**

- [ ] **Step 6: Commit.** `git commit -m "Pages API: Search Console clicks and impressions of one page by day"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the states mean what
  `gsc_window` says; the day fill is inclusive at both ends and never invents a day outside the window;
  every statement names the workspace; the 404 is for the crawl in view, not for any crawl.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 6 (Haiku): Regenerate the web client, alone in its commit

- [ ] **Step 1:**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm gen:api
pnpm typecheck
git add src/lib/api/schema.ts
git commit -m "Regenerate the API client for the Pages routes"
```

  Expected: `schema.ts` gains the paths `…/internal-links/overview` and `…/internal-links/pages/{url_id}/search`,
  the schemas `PagesOverview` and `PageSearchDaily`, and `filter[view]`, `filter[folder]`, `filter[depth]` on
  the pages list. `pnpm typecheck` passes. If it fails, stop and report: do not edit `schema.ts` by hand.

- [ ] **Step 2: Independent senior review (Sonnet subagent).** The commit holds `schema.ts` only, and its
  diff is only additions that the five backend commits explain.

- [ ] **Step 3: Fix what the review found** (regenerate again, never hand-edit), commit.

---

## Part B. Web: data, mocks and pure modules

### Task 7: Types, reads and sorts for the new API

Contracts C4, C5. Spec 7.2 (last paragraph), 7.3 (Server), 7.4.

**Files:**
- Modify: `apps/web/src/lib/internal-links/types.ts`, `queries.ts`, `queries.test.ts`
- Create: `apps/web/src/lib/internal-links/page-sorts.ts`, `search-text.ts`
- Modify: `apps/web/src/features/internal-links/url-state.ts` (re-exports only)
- Modify: `apps/web/src/features/internal-links/pages/page-filters.ts`, `page-columns.tsx`, `page-columns.test.tsx`

- [ ] **Step 1: Read first.** `lib/internal-links/queries.ts` lines 1 to 260 (`PageQuery`, `DEFAULT_PAGE_QUERY`,
  `pageParams`, `pageFilterOf`, `pagesQuery`, `pageDetailQuery`, `worklistsQuery`), `types.ts`,
  `features/internal-links/url-state.ts` (`PAGE_SORTS`, `searchText`), `pages/page-filters.ts` (`pageQueryOf`).

- [ ] **Step 2: Write the failing tests** in `queries.test.ts` (follow its existing cases for `pageParams`):
  - `pageParams` sends `filter[view]`, `filter[folder]`, `filter[depth]` and `filter[include_variants]` only
    when set, and never `filter[view]` together with `filter[worklist]` (a query with both throws
    `Error('A pages query has a view or a worklist, not both')`);
  - `pageFilterOf` carries `view`, `folder`, `depth`, and `include_variants` is the query's `includeVariants`;
  - `overviewQuery(scope, null)` and `overviewQuery(scope, 'RUN')` have different keys, both starting with
    the project key and `'internal-links'` (so `internalLinksKeys` reaches them);
  - `pageSearchQuery(scope, 'abc', null)` throws `UrlIdError` (as `pageDetailQuery` does).
  In `page-columns.test.tsx`: `sortOfKeys([{ id: 'impressions', desc: true }])` is `'-impressions'`.

- [ ] **Step 3: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/lib/internal-links/queries.test.ts src/features/internal-links/pages/page-columns.test.tsx`

- [ ] **Step 4: Implement.**
  - `types.ts`: `export type PageView = NonNullable<PageFilter['view']>;`,
    `export type PagesOverview = Schemas['PagesOverview'];`,
    `export type PageSearchDaily = Schemas['PageSearchDaily'];`; `PageSort` gains `'impressions' | '-impressions'`.
  - `page-sorts.ts`: `export const PAGE_SORTS: readonly PageSort[]` moved here from the feature's
    `url-state.ts`, with the two new keys after `'-clicks'`. `search-text.ts`: `searchText` and its
    `MAX_SEARCH_LENGTH` moved here. The feature's `url-state.ts` re-exports both
    (`export { PAGE_SORTS } from '@/lib/internal-links/page-sorts';`), so no other import changes.
  - `queries.ts`: `const OVERVIEW = \`${P}/internal-links/overview\` as const;` and
    `const PAGE_SEARCH = \`${P}/internal-links/pages/{url_id}/search\` as const;`;

```ts
export const overviewQuery = (scope: LinksScope, run: string | null): ApiQueryOptions<typeof OVERVIEW>;
export const pageSearchQuery = (scope: LinksScope, urlId: string, run: string | null): ApiQueryOptions<typeof PAGE_SEARCH>;
```

    written as `worklistsQuery` and `pageDetailQuery` are. `PageQuery` gains the four fields of C5;
    `DEFAULT_PAGE_QUERY` sets them to `null`, `null`, `null`, `false`; `pageParams` and `pageFilterOf` send
    them.
  - `page-filters.ts` `pageQueryOf`: sets the four new fields to `null`, `null`, `null`, `false` for now
    (Task 11 gives them values). `page-columns.tsx` `SORT_FIELD`: `impressions: 'impressions'`.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** on the files of this task, and also
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/url-state.test.ts src/features/internal-links/pages/page-filters.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: types, reads and sorts for the overview, the views and the page search"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: no hand-written copy
  of a response type; the query keys; nothing else in the app imports `PAGE_SORTS` or `searchText` from a
  path that no longer exports it (`grep -rn "PAGE_SORTS\|searchText" apps/web/src`).

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 8: The mocked API

Spec section 12 ("Mock handlers for the two new routes"). Contracts C2, C3, C4.

**Files:**
- Create: `apps/web/src/mocks/internal-links-inventory.ts`, `internal-links-inventory.test.ts`
- Modify: `apps/web/src/mocks/handlers/internal-links.ts`, `apps/web/src/mocks/handlers/internal-links.test.ts`

- [ ] **Step 1: Read first.** `mocks/handlers/internal-links.ts` lines 55 to 275 (`PAGE_QUERY`, `Criteria`,
  `criteriaOfUrl`, `criteriaOfFilter`, `pageMatches`, `SORTS`, `sortRows`) and the handlers of
  `internal-links/pages`, `pages/{url_id}` and `worklists`; `mocks/internal-links-world.ts` (`crawledPages`,
  `pageRow`, `pageExtras`); how the handlers test calls a handler (`mockBrowser` of `src/test/mock-api.ts`).
  Note how a variant row is treated by the list today and keep that for a request without a view.

- [ ] **Step 2: Write the failing tests.** `internal-links-inventory.test.ts`: `sectionOfPath` over the five
  rows of C3; `viewMatches` for one row of each of the seven status groups; `overviewOf(rows)` keeps the
  invariants of spec 12 (status groups add up to `addresses`; indexable plus not indexable is live; depth
  rows add up to reachable). `handlers/internal-links.test.ts`: for every `PageView`, the overview's number
  (mapping of C2) equals `meta.total` of the list with `filter[view]`; `filter[folder]` and `filter[depth]`
  narrow the list; `filter[view]` with `filter[worklist]` is 422; `sort=-impressions` orders by impressions;
  `GET …/pages/{url_id}/search` answers `ok` with 28 days whose clicks add up to `clicks`; a viewer of
  another workspace gets 404 for both new routes.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `internal-links-inventory.ts`:

```ts
export const PAGE_VIEWS: readonly PageView[];            // the 16 ids of C2, in order
export function sectionOfPath(path: string): string;      // C3
export function viewMatches(row: PageRow, view: PageView): boolean;
export function overviewOf(rows: readonly PageRow[], run: { run_id: string; finished_at: string | null; sitemap: boolean }): PagesOverview;
```

  A `PageRow` has no `resource_type`: the mock's live is counted and `status_code === 200` (say so in a
  one-line comment). `overviewOf` counts with `viewMatches` only, so the mock keeps D8 the way the API does.
  Handlers: `PAGE_QUERY` gains `'filter[view]'`, `'filter[folder]'`, `'filter[depth]'`,
  `'filter[include_variants]'`; `Criteria`, `criteriaOfUrl`, `criteriaOfFilter` and `pageMatches` gain `view`,
  `folder`, `depth`, `includeVariants`; the 422; `impressions` in the extra sorts beside `clicks`; the two new
  `mock('get', …)` handlers with `projectCaller(…, { permission: 'data:read', query: ['run'] })` and `readRun`,
  as the `worklists` handler. The search handler spreads the page's 28 day totals of `pageExtras(run, page,
  ['gsc'])` over 28 days by a fixed rule (the whole part of total over 28 on each day, the rest on the first
  days), and answers `pending` or `not_connected` when the world's `gsc` state says so.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** on the four files, and
  `pnpm exec vitest run --maxWorkers=1 src/mocks/internal-links-world.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: the mocked overview, page views and page search"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the mock's conditions
  against C2 line by line; the answers validate against the generated types (no cast to `unknown`); the
  existing list behaviour without the new parameters is unchanged.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 9: Tabs, the address, the path and the seams

Spec 5.1, 5.2, 7.3 (last paragraph), 9.5 (last paragraph), 10. Contract C5.

**Files:**
- Create: `apps/web/src/lib/pages/tabs.ts`, `tabs.test.ts`, `url-state.ts`, `url-state.test.ts`,
  `issue-source.ts`, `tracking.ts`, `search-detail-slot.tsx`, `search-daily.ts`, `seams.test.tsx`
- Modify: `apps/web/src/lib/routes/paths.ts`, `paths.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `tabs.test.ts`: `PAGES_TABS` is `overview`, `all`, `monitoring` in that order; `livePagesTabs()` is
    `overview`, `all` (a planned tab is not listed).
  - `paths.test.ts`: `pagesTabPath('acme', 'site')` is `/acme/site/seo/pages`; with `'all'` it ends `/seo/pages/all`.
  - `url-state.test.ts`: an empty address gives `view: null`, `worklist: null`, `sort: 'path'`, `q: null`,
    `depth: null`, `variants: false`, `scope: 'editorial'`, `run: null`; `view=live` is a
    view; `view=orphans` is a worklist and `view` stays null; an unknown `view` gives both null;
    `sort=-impressions` is kept and `sort=nope` falls back to `path`; `depth=0` and `depth=6` are kept, `depth=7`,
    `depth=-1`, `depth=2.5` and `depth=x` are null; `variants=1` is true and anything else false; `q` is
    trimmed and cut at 200; `run` in upper case is lower-cased, a malformed `run` is `run: null` with
    `invalidRun` its text.
  - `seams.test.tsx` (with `renderHook` inside the providers of `src/test/render.tsx`): `useIssueTotals`,
    `usePageIssues` and `useTrackedPages` answer `{ state: 'unavailable' }`; `ISSUE_COLUMNS_AVAILABLE` and
    `TRACKING_AVAILABLE` are `false`; `issueCountsOf(row)` is `null`; `PageSearchDetailSlot` renders nothing; `usePageSearchDaily` answers
    `loading`, then `ready` with 28 days against the mocked API (page 108 of the fixture crawl), and `error`
    with a working `retry` when the route answers 500.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**

```ts
// tabs.ts
export type PagesTabId = 'overview' | 'all' | 'monitoring';
export interface PagesTab { id: PagesTabId; path: '' | '/all' | '/performance'; status: 'live' | 'planned' }
export const PAGES_TABS: readonly PagesTab[];   // monitoring is 'planned'
export const livePagesTabs = (): readonly PagesTab[] => PAGES_TABS.filter((tab) => tab.status === 'live');
```

  `paths.ts`: `pagesTabPath` beside `rankingsPath`, built with `projectPath`. `url-state.ts` as in C5, pure,
  with no `'use client'` (the route's redirect imports it on the server); it uses `PAGE_SORTS`, `searchText`,
  `parseLinkScope` and `isUuid`. The three seam modules exactly as spec 10.1 to 10.3 writes them, each body
  answering `unavailable` (or `false`, or `null`), each with a file comment that names its owner session and
  says "replace the body, keep the signatures". `useTrackPages` answers
  `{ track: () => Promise.reject(new Error('Tracking is not available')), pending: false }`.
  `search-daily.ts`:

```ts
/** The days of one page in Search Console (spec 9.5). The hook is the contract, not the route. */
export function usePageSearchDaily(scope: LinksScope, run: string | null, urlId: string): Seam<PageSearchDaily>;
```

  from `useQuery(pageSearchQuery(scope, urlId, run))`. If Task 5 was skipped, the lead gives the other
  session's route here instead.

- [ ] **Step 4: Run the tests, expect pass. Run the web commands.**

- [ ] **Step 5: Commit.** `git commit -m "Pages: tabs, address state, path and the seams of the other sessions"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: the seam signatures
  against spec 10 character by character; `lib/pages` imports nothing from `features/` or `components/`;
  `url-state.ts` has no client-only import.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 10: The view definitions and the Overview model

Spec 6.4 (strip and cards 1 to 6), 7.3 (the table), 12 (`overview-model.ts`).

**Files:**
- Create: `apps/web/src/lib/pages/views.ts`, `views.test.ts`, `overview-model.ts`, `overview-model.test.ts`

- [ ] **Step 1: Write the failing tests.**
  `views.test.ts`: the menu order is the table of spec 7.3 (Pages: all, live, indexable, not_indexable,
  redirects, errors, variants, untiered; Sitemap: the four; Reach: reachable, unreachable; Link problems: the
  six page worklists then the two edge worklists); `viewCounts` gives `all` as `addresses - status.variant`
  and every other count from the field of C2 or from the worklists read; `visibleViews` hides a view whose
  count is 0 unless it is the active one, hides the sitemap section when `sitemap.state` is `no_sitemap`,
  lists `client_errors`, `server_errors`, `blocked`, `other` only while active, and always lists `all`.
  `overview-model.test.ts`, on a fixed `PagesOverview` (the JSON of spec 6.1 made consistent):
  - the strip has five rows with their hrefs: addresses (`variants=1`), live (`view=live`), indexable,
    orphans (`view=orphans`), errors (`view=errors`, count `client_error + server_error`);
  - status rows: seven, shares of `addresses`, each href `view=<the view of C2>`; a group of 0 keeps its row
    with `count: 0`;
  - funnel: four rows, three when `no_sitemap`;
  - sections: the 8 largest, then one folded row whose count is `status.live` less the 8 and whose `href` is
    null and `folded` is `sections_total - 8`; no folded row with 8 sections or fewer; a section's href is
    `view=live&folder=<section>`; shares of live;
  - tiers: href `view=live&tier=<tier_id>`, Untiered `view=live&tier=none`;
  - depth: seven rows `depth=<n>` then `unreachable` with `tone: 'warning'` and `view=unreachable`;
  - sitemap: four rows with the four sitemap views, or `null` with `no_sitemap`;
  - every href carries `run=<id>` when a run is given and no `run` when it is null;
  - for every row with a view, the count equals the field C2 names (the web half of D8).

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**

```ts
// views.ts
export type ViewId = 'all' | 'untiered' | PageView | PageWorklist | EdgeWorklist;
export type ViewSection = 'pages' | 'sitemap' | 'reach' | 'linkProblems';
export interface ViewEntry { id: ViewId; section: ViewSection; onlyWhenActive: boolean }
export const PAGE_VIEW_MENU: readonly ViewEntry[];
export function viewCounts(overview: PagesOverview, worklists: Worklists, untiered: number | null): Partial<Record<ViewId, number>>;
export function visibleViews(counts: Partial<Record<ViewId, number>>, active: ViewId, hasSitemap: boolean): ViewEntry[];

// overview-model.ts
export interface OverviewRow {
  id: string;
  count: number;
  /** 0 to 1, of `base`; null when the base is 0. */
  share: number | null;
  base: 'addresses' | 'live';
  href: Route | null;
  tone?: 'warning';
  /** The folded sections row: how many sections it holds. */
  folded?: number;
  tier?: TierRef | null;
}
export interface OverviewModel {
  strip: OverviewRow[]; status: OverviewRow[]; funnel: OverviewRow[]; sections: OverviewRow[];
  tiers: OverviewRow[]; depth: OverviewRow[]; sitemap: OverviewRow[] | null;
}
/** `allPages` builds the address of All pages for a query (the screen passes `pagesTabPath` and the run). */
export function overviewModel(data: PagesOverview, allPages: (query: Record<string, string>) => Route): OverviewModel;
export const SECTIONS_SHOWN = 8;
```

  Row ids are the message keys Task 21 uses (`live`, `variant`, `redirected`, `client_error`, `server_error`,
  `blocked`, `other`, `addresses`, `indexable`, `in_sitemap_indexable`, …): no visible text in this module.

- [ ] **Step 4: Run the tests, expect pass. Run the web commands.**

- [ ] **Step 5: Commit.** `git commit -m "Pages: the view menu's definitions and the overview model"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: each href against
  the "Opens" column of spec 6.4, and each one names a view or filter whose list total is the row's count
  (compare with C2 and C4: a depth row filters `depth`, which already means reachable); share bases
  (status of every address, everything else of live pages).

- [ ] **Step 7: Fix what the review found**, rerun, commit.

---

## Part C. Web: the screen, the routes and the move

### Task 11: Narrow contexts for the table and the drawer

Spec 7.1 change 1, 9.2, decision D4. Contract C5. No visible change: a refactor that every existing test
must survive.

**Files:**
- Create: `apps/web/src/features/internal-links/pages/pages-context.ts`,
  `apps/web/src/features/internal-links/inspector/page-drawer-context.ts`
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `page-filters.ts`, `page-filters.test.ts`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `neighbor-section.tsx`,
  `page-inspector.test.tsx`
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `internal-links-screen.tsx`

- [ ] **Step 1: Read first.** `pages-tab.tsx`, `page-inspector.tsx`, `neighbor-section.tsx`, `tabs.ts`
  (`LinksTabContext`), `internal-links-screen.tsx` (where `context` and the `PageInspector` are built),
  `components/ui/link-button.tsx`.

- [ ] **Step 2: The types.**

```ts
// pages/pages-context.ts
export interface PagesContext {
  scope: LinksScope;
  host: string;
  timeZone: string;
  crawl: CrawlInView;
  tiers: readonly PageTier[];
  state: PagesState;
  /** The sort the address leaves out. */
  defaultSort: PageSort;
  setSearch: (values: Partial<Record<PagesKey, string | null>>, options?: { history?: 'push' | 'replace' }) => void;
  inspect: { open: (urlId: string) => void; urlId: string | null; invalid: string | null; setOrder: (urlIds: readonly string[]) => void };
  openJourney: (urlId: string) => void;
  /** Opens Internal links > Links on a link worklist, on All links. */
  openEdgeWorklist: (worklist: EdgeWorklist) => void;
  registerExport: (run: (() => Promise<void>) | null) => void;
  taxonomyHref: Route;
}
/** Until the Pages tab leaves Internal links (Task 16): the table's context from a tab's. */
export function pagesContextOf(context: LinksTabContext): PagesContext;
```

  `page-drawer-context.ts` holds `PageDrawerContext` exactly as spec 9.2 writes it, and
  `drawerContextOf(context: LinksTabContext, canWrite: boolean): PageDrawerContext`, whose `hrefs` are built
  with `withQuery(context.hrefOf('/seo/internal-links'), …)`: `journey` is `tab=journey&focus=<id>`,
  `linksFrom` is `tab=links&src=<id>`, `linksTo` is `tab=links&tgt=<id>`; each also carries `run=<id>` when
  the crawl in view is not the latest and `scope=<scope>` when the link scope is not editorial (today's
  `setSearch` keeps both, a link must too); `issueCheck` answers `null`; `taxonomy` is
  `context.hrefOf('/settings/taxonomy')`.

- [ ] **Step 3: Change the tests first.** `page-inspector.test.tsx`: the cases that pressed "View all in
  Links" or "Open in journey" and read the written query now assert the control is a link with that `href`
  (`screen.getByRole('link', { name: … })` and `toHaveAttribute('href', …)`), for a latest crawl and for an
  older one (`run` in the href). `page-filters.test.ts`: `pageQueryOf` takes the state of C5 and passes
  `view`, `depth` and `variants` through (`includeVariants`); `folder` stays null until Task 20. Run, expect failures.

- [ ] **Step 4: Implement.**
  - `pages-tab.tsx`: `PagesTab({ context }: { context: PagesContext })`. Every use of `LinksTabContext` goes:
    `context.hrefOf(TAXONOMY_PATH)` becomes `context.taxonomyHref`; `openEdgeWorklist` is the context's;
    `DEFAULT_SORT` becomes `context.defaultSort`; `setSearch({ q })` and `setSearch({ view })` keep their
    keys. The row's "open in a new tab" keeps building its address from `window.location`.
  - `page-filters.ts`: `pageQueryOf(state: Pick<PagesState, 'scope' | 'view' | 'worklist' | 'sort' | 'q' | 'depth' | 'variants'>, values, cursor, limit, host)`.
  - `page-inspector.tsx`: `context: PageDrawerContext`; the prop `canWrite` goes (it is in the context);
    `state.scope` becomes `context.linkScope`; `context.inspect.open` becomes `context.openPage`; the two
    `viewAll` calls become hrefs; "Open in journey" becomes a `LinkButton` to `context.hrefs.journey(urlId)`;
    `taxonomyHref` is `context.hrefs.taxonomy`. `neighbor-section.tsx`: `onViewAll: () => void` becomes
    `viewAllHref: Route` and its button a link.
  - `tabs.ts`: the `pages` entry renders `createElement(PagesTab, { context: pagesContextOf(context) })`.
    `internal-links-screen.tsx`: passes `drawerContextOf(context, canWrite)` to `PageInspector`.
  - Every other caller of `PageInspector` or `NeighborSection` (`grep -rn "PageInspector\|NeighborSection" apps/web/src`)
    is updated the same way.

- [ ] **Step 5: Run** the tests of the feature that touch these files, one file at a time:
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector src/features/internal-links/pages`
  then `src/features/internal-links/internal-links-screen.test.tsx`. Expect pass. Run the web commands.

- [ ] **Step 6: Commit.** `git commit -m "Pages: the table and the page drawer take narrow contexts, exits become links"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: nothing a person sees
  changed except that three exits are links (they open in a new tab, carry the crawl and the scope, and are
  announced as links); `PagesTab` and `PageInspector` import nothing of `LinksTabContext`; no shared drawer
  file was edited.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 12: The crawl shell both screens use, and a one-line header

Spec 6.4 (states), 8 (the toolbar row). A refactor of Internal links with one addition: every existing test
passes unchanged, and Internal links looks the same. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/crawl-shell.tsx`, `crawl-shell.test.tsx`
- Modify: `apps/web/src/features/internal-links/internal-links-screen.tsx`
- Modify: `apps/web/src/features/internal-links/crawl-header.tsx`, `crawl-header.test.tsx`

- [ ] **Step 1: Read first.** `internal-links-screen.tsx` whole, `crawl-reads.ts`, `crawl-states.tsx`,
  `crawl-header.tsx`, `lib/internal-links/crawl-choice.ts`.

- [ ] **Step 2: Write the failing tests.**
  - `crawl-header.test.tsx`: with `layout="one-line"` the context (the picker and the context line) is in the
    same row as the tabs and the actions, between them, and scrolls sideways inside its own room instead of
    wrapping; without the prop the header is exactly as today (the existing cases stay untouched).
  - `crawl-shell.test.tsx` (a small component that calls the hook, rendered with the providers and the
    fixture projects of `src/test/internal-links-harness.tsx`): `stateBody` is null for a crawl that can be
    read and `view.kind` is `ready`; it is the no website, never crawled, first crawl and failed first crawl
    state for those scenarios (`setLinksScenario`); `inView` follows the `run` given; the end of a crawl is
    announced once.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**

```ts
// crawl-shell.tsx
export interface CrawlShellInput {
  workspaceId: string;
  workspaceSlug: string;
  project: InternalLinksProject;
  /** The crawl the address chooses, or null for the latest. */
  run: string | null;
  /** Buttons of the first crawl state (tier rules, import); the screen decides. */
  firstCrawlActions?: ReactNode;
}
export interface CrawlShell {
  scope: LinksScope;
  host: string;
  view: CrawlView;
  /** The crawl every read is made against. */
  inView: CrawlInView;
  runs: readonly CrawlRun[];
  tiers: readonly PageTier[];
  crawl: ReturnType<typeof useCrawlNow>;
  canCrawl: boolean;
  canEditTiers: boolean;
  /** The "crawls are not switched on" notice, or null. */
  notice: ReactElement | null;
  /** The body of every state but `ready`; null when the crawl can be read. */
  stateBody: ReactNode | null;
  /** The banners over a crawl that can be read (a newer crawl running or failed). */
  banners: ReactNode;
  hrefs: { settings: Route; tiers: Route; domains: Route };
}
export function useCrawlShell(input: CrawlShellInput): CrawlShell;
/** The page's Export: a tab registers its download, the header runs it once at a time. */
export function usePageExport(): {
  registerExport: (run: (() => Promise<void>) | null) => void;
  onExport: (() => void) | null;
  exporting: boolean;
};
```

  Both are the code of `InternalLinksContent`, moved, not rewritten: `useCrawls` with its announcement,
  `useWorkspaceTiers`, `crawlView`, `useCrawlNow`, `crawlInView`, the notice, the `switch` over `view.kind`
  for every case but `ready`, `CrawlBanners`, and the export block with its toast. `InternalLinksContent`
  then calls them. `crawl-header.tsx`: `layout?: 'two-line' | 'one-line'` (default `two-line`); with
  `one-line` the context is drawn inside the first row, after the tabs, in a
  `min-w-0 flex-1 overflow-x-auto scrollbar-none` container, and no second row exists.

- [ ] **Step 5: Run**, one command each: `src/features/internal-links/crawl-shell.test.tsx`,
  `crawl-header.test.tsx`, `internal-links-screen.test.tsx`, `states.test.tsx`, `crawl-in-view.test.tsx`,
  `crawl-context.test.tsx`, `blocked-pages.test.tsx`. Expect pass with no change to the last five files.
  Run the web commands.

- [ ] **Step 6: Commit.** `git commit -m "Internal links: the crawl shell as one hook, and a one-line crawl header"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the moved code is
  the same code (compare with `git show HEAD -M --stat` and the removed lines of `internal-links-screen.tsx`);
  no test of Internal links was edited; the default header is byte for byte the old markup; the one-line
  context can be reached and scrolled with the keyboard.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 13: The Pages screen

Spec 5.1, 5.2, 6.4 (strip and states), 8, 9.1. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/pages-page/pages-screen.tsx`, `use-pages-state.ts`,
  `overview-tab.tsx`, `pages-screen.test.tsx`
- Create: `apps/web/src/test/pages-harness.tsx`
- Not touched: `internal-links-screen.tsx`, `crawl-shell.tsx`, `crawl-header.tsx` (Task 12 made what this
  task needs; if something is missing there, stop and tell the lead)
- Modify: `apps/web/src/features/internal-links/index.ts` (export `PagesScreen`)
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `crawl-shell.tsx` (`useCrawlShell`, `usePageExport`, from Task 12) and
  `internal-links-screen.tsx` whole (how it uses them, and its inspector host, which this screen repeats with
  its own context), `crawl-header.tsx` (`layout="one-line"`), `components/app/shell/tab-nav.tsx`,
  `features/citations/board-screen.tsx` lines 220 to 360 (segmented route tabs in a fixed-height page),
  `components/app/metric/metric-strip.tsx`, `src/test/internal-links-harness.tsx`.

- [ ] **Step 2: Words.** Add the namespace `pages` to `messages/en.json`:

| Key | Text |
|---|---|
| `pages.title` | Pages |
| `pages.tabs.label` | Pages views |
| `pages.tabs.overview` | Overview |
| `pages.tabs.all` | All pages |
| `pages.strip.label` | Page counts of this crawl |
| `pages.strip.addresses` | Addresses crawled |
| `pages.strip.live` | Live pages |
| `pages.strip.indexable` | Indexable |
| `pages.strip.orphans` | Orphan pages |
| `pages.strip.errors` | Error pages |
| `pages.strip.withIssue` | Pages with an issue |
| `pages.strip.addressesTip` | Every address the crawl read, parameter variants included |
| `pages.strip.liveTip` | Pages that answered 200 with HTML, of every address |
| `pages.strip.liveBaseTip` | Of live pages |
| `pages.overview.loadFailed` | The page counts could not be loaded |
| `pages.overview.loadFailedReason` | Try again. If it keeps failing, the crawl may still be saving. |

  The crawl states keep their keys under `internalLinks.states`, `internalLinks.header` and
  `internalLinks.noAccess*`.

- [ ] **Step 3: Write the failing tests** in `pages-screen.test.tsx` with `pagesAs`:
  - a viewer on the Eventus fixture, tab `overview`: the navigation "Pages views" lists Overview (current)
    and All pages as links, and no Monitoring; the strip shows five numbers that equal the mocked overview
    read, each a link to All pages with the query of Task 10; there is no sixth number;
  - the All pages link carries `run` when the address has one, and nothing else;
  - tab `all` renders the grid named "Pages" with rows;
  - no `data:read`: the no access state; no website, never crawled, first crawl running, first crawl failed:
    the same states as Internal links (reuse the scenarios `states.test.tsx` sets with `setLinksScenario`);
  - the overview read failing shows the inline error with a retry that works;
  - `?inspect=page:108` opens the page drawer on both tabs; `?run=<unknown id>` shows the crawl not found
    state and no drawer;
  - `axe` finds nothing on each tab.

- [ ] **Step 4: Implement.**
  - `use-pages-state.ts` (`'use client'`): `usePagesState(): { state: PagesState; setSearch }` with nuqs
    `useQueryStates` over the keys of `PagesKey`, as `useLinksState`.
  - `pages-harness.tsx`: `pagesAs(role, tab, current = EVENTUS_LINKS)`, a copy of `internalLinksAs` that
    renders `PagesScreen`.
  - `pages-screen.tsx`: `PagesScreen` with the props of C5. The access check is the one of
    `InternalLinksScreen` (`useCan('data:read')`, the same empty state). The crawl reads, the states and the
    notice come from `useCrawlShell`, the export wiring from `usePageExport`; nothing of them is written
    again here. The page is
    `flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5` inside
    `InspectorLayout`, with no visible title (`PageToolbar` as Internal links uses it; the heading stays for
    assistive technology). The toolbar row is `CrawlHeader` with `layout="one-line"` (one 36 px row: spec
    section 8 counts on it) and `tabs` a
    `<TabNav variant="segmented" label={t('tabs.label')} items={…livePagesTabs()…} />` whose hrefs are
    `pagesTabPath` plus `run` when chosen, the `CrawlPicker`, `ContextLine` (its `untieredHref` is All pages
    with `tier=none`, its `changesHref` Internal links with `tab=changes`), Crawl now, Export and the menu
    (settings and tiers links; no summary, no share: pass `null`). The body is `OverviewTab` or
    `PagesTab` with a `PagesContext` built here: `defaultSort` is `PAGES_DEFAULT_SORT`; `openJourney` and
    `openEdgeWorklist` navigate with `useRouter().push` to Internal links (`tab=journey&focus=<id>`,
    `tab=links&lview=<worklist>&scope=all`), carrying `run`. The drawer host is the block of
    `InternalLinksScreen` with a `PageDrawerContext` whose hrefs point at Internal links.
  - `overview-tab.tsx`: `OverviewTab({ scope, run, allPages })` reads `overviewQuery`, builds
    `overviewModel`, and draws the strip (`MetricStrip size="md"`, one group, each item with `href` and
    `tip`) inside the scroll container `min-h-0 flex-1 overflow-y-auto`. The sixth number is added only when
    `useIssueTotals` answers `ready` (its href is `projectPath(…, '/seo/issues')`). Loading: the strip's own
    loading state. The cards come in Tasks 21 and 22.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands**, and
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/internal-links-screen.test.tsx src/features/internal-links/states.test.tsx src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: the screen with its tabs, the crawl states and the overview strip"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the crawl shell is
  shared with Internal links, not copied; the fixed-height layout classes are exactly those of spec 8; the
  toolbar is one row at `md` and wider, so that the sum of spec 8 (52, 12, 36, 12, 48, 64) puts the first
  row at 224 px; a
  planned tab is absent, not disabled; each strip number is a link with a name that says where it goes;
  nothing but `run` travels between the two tabs; no shared drawer file edited.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 14: The two routes and the sidebar entry

Spec 5.1, 5.4, 14 (the `registry.ts` row), 16 (routes and sidebar).

**Files:**
- Create: `apps/web/src/app/[workspace]/[project]/seo/pages/page.tsx`, `page.test.tsx`,
  `apps/web/src/app/[workspace]/[project]/seo/pages/all/page.tsx`, `all/page.test.tsx`
- Modify: `apps/web/src/lib/navigation/registry.ts`, `registry.test.ts`,
  `apps/web/src/features/shell/project-shell.test.tsx`
- Modify: `docs/design-system/11-navigation.md`

- [ ] **Step 1: Write the failing tests.** The two `page.test.tsx` are copies of
  `seo/internal-links/page.test.tsx` that expect `PagesScreen` with `tab: 'overview'` and `tab: 'all'`, the
  metadata title `pages.title`, and `notFound` for a project the member cannot open. `registry.test.ts`:
  `pages` is in `LIVE_NAVIGATION`, between `keywords` and `internalLinks` in the group `seo`;
  `destinationOf(LIVE_NAVIGATION, '/digibranders/fynix/seo/pages', …)` and the same with `/seo/pages/all`
  answer the `pages` entry (the test at line 223 expected `null`). `project-shell.test.tsx`: the sidebar
  lists "Pages /digibranders/fynix/seo/pages" before Internal links, and the case at line 350 follows.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.** `page.tsx` files copy `seo/internal-links/page.tsx` (membership, project lookup,
  `notFound`), typed `PageProps<'/[workspace]/[project]/seo/pages'>` and `…/seo/pages/all'>`, rendering
  `PagesScreen`. No `performance` folder. `registry.ts`: the `pages` entry gets `status: 'live'`; nothing else
  in that file changes (the Issues branch regroups it; see spec 14). `11-navigation.md`: in the table row
  "SEO > Pages" the tabs become "Overview, All pages, Monitoring (Monitoring is listed once it exists)", and
  in the row "SEO > Internal links" the word "Pages," stays until Task 16.

- [ ] **Step 4: Run the tests, expect pass. Run the web commands** (`pnpm typecheck` generates the route
  types first).

- [ ] **Step 5: Commit.** `git commit -m "Pages: the routes /seo/pages and /seo/pages/all, live in the sidebar"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: the diff of
  `registry.ts` is the one word; no route for Monitoring; the pages read no search parameter.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 15: Point the table's tests at All pages

The Pages table is now reachable two ways. Before it leaves Internal links, its tests move to the new host,
with no change to what they assert.

**Files (tests only):**
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.test.tsx`, `bulk.test.tsx`,
  `pages-extras.test.tsx`, `pages-tab-loop.test.tsx`, `tier-suggestions.test.tsx`,
  `apps/web/src/features/internal-links/inspector/page-inspector.test.tsx`
- Find the rest with `grep -rln "internalLinksAs" apps/web/src --include='*.test.tsx'`: a file of that list
  that reaches the Pages grid or the page inspector with no `tab` in its address belongs here too. The files
  about the Internal links screen itself (`internal-links-screen.test.tsx`, `states.test.tsx`,
  `crawl-header.test.tsx`, `crawl-in-view.test.tsx`, `crawl-context.test.tsx`, `rules/dialogs.test.tsx`,
  `export/client-summary-menu.test.tsx`) are Task 16's.

- [ ] **Step 1:** In each file that renders `internalLinksAs(…)` to reach the Pages table or the page
  inspector on the default tab, render `pagesAs(role, 'all', project)` instead, and change the mocked
  `usePathname` to `/digibranders/eventus-security/seo/pages/all`. A case that sets `tab=links`,
  `tab=journey` or another tab of Internal links stays on `internalLinksAs`. Two differences are expected
  and are the only assertions that may change: the default sort is `path` (a case that relied on
  `-linking_pages` as the default now passes `sort=-linking_pages` in its `searchParams`, or asserts the
  path order), and "Open in journey" and the link worklists navigate (assert `router.push` was called with
  the Internal links address) instead of writing `tab`.

- [ ] **Step 2: Run each file alone**, for example
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages/pages-tab.test.tsx`. Expect pass. A
  case that fails for another reason is a bug of Task 11 or 13: fix it there (in the component), not by
  weakening the test, and say so in the commit body.

- [ ] **Step 3: Run the web commands** on the changed files.

- [ ] **Step 4: Commit.** `git commit -m "Pages: the table's tests run on All pages"`.

- [ ] **Step 5: Independent senior review (Sonnet subagent).** Besides the common list: no assertion was
  removed or loosened except the two expected differences; every case of the listed files still exists
  (compare the `it(` counts before and after with `git show HEAD --stat` and a grep).

- [ ] **Step 6: Fix what the review found**, rerun, commit.

### Task 16: The Pages tab leaves Internal links, with the redirect

Spec 5.3, decision D2, 15 point 4, 16 (the redirect line).

**Files:**
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `tabs.test.ts`, `url-state.ts`, `url-state.test.ts`,
  `internal-links-screen.tsx`, `internal-links-screen.test.tsx`, `pages/pages-context.ts`
- Modify: `apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx`, `page.test.tsx`
- Modify: `apps/web/messages/en.json` (remove `internalLinks.tabs.pages`), `docs/design-system/11-navigation.md`
- Modify (not run here): `apps/web/e2e/support/internal-links.ts`, `apps/web/e2e/flows/internal-links.spec.ts`,
  `apps/web/e2e/visual/pages.spec.ts`

- [ ] **Step 1: Check the redirect rule again** (spec 5.3 asks the plan to repeat it):
  `grep -rn "setSearch(" apps/web/src/features/internal-links/journey apps/web/src/features/internal-links/map apps/web/src/features/internal-links/flow apps/web/src/features/internal-links/changes apps/web/src/features/internal-links/opportunities apps/web/src/features/internal-links/links`
  and `grep -rn "useUrlFilters\|useQueryStates" apps/web/src/features/internal-links --include='*.tsx' -l`.
  Journey, which becomes the default tab and so has no `tab` key, must write none of `PAGES_REDIRECT_KEYS`.
  If it writes one, stop and tell the lead: the rule of spec 5.3 would then redirect a Journey address.

- [ ] **Step 2: Write the failing tests.**
  - `seo/internal-links/page.test.tsx`, a table of addresses: `tab=pages` goes to `/seo/pages/all` with `tab`
    dropped; `tab=pages&view=orphans&tier=none` goes to `/seo/pages/all?view=orphans&tier=none`; each of
    `view`, `sort`, `q`, `tier`, `tag`, `status`, `idx`, `flag`, `cols`, `density` alone (no `tab`) redirects
    with the key kept; `inspect=page:108&itab=links&q=x` keeps all three; a repeated key (`tier=a&tier=b`)
    stays repeated; a bare address renders the screen; `focus=103&jv=tree&open=o%3A108` renders the screen;
    `tab=links&q=x&cols=a&density=default` renders the screen. Mock `redirect` of `next/navigation` to throw
    an error that carries its argument, as the file mocks `notFound`.
  - `tabs.test.ts` and `url-state.test.ts`: no `pages` id; the order is Journey, Link map, Links, Tier flow,
    Changes, Opportunities; an absent or unknown `tab` is `journey`.
  - `internal-links-screen.test.tsx`: a bare address opens Journey; no tab named Pages; choosing Journey
    writes no `tab` key; the context line's Untiered link goes to `/seo/pages/all?tier=none`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  - `page.tsx`: reads `searchParams` and, before anything else,

```ts
const query = await searchParams;
const moved = query.tab === 'pages' || (query.tab === undefined && PAGES_REDIRECT_KEYS.some((key) => query[key] !== undefined));
if (moved) redirect(withQuery(pagesTabPath(workspace, project, 'all'), queryOf(query, ['tab'])));
```

    and its file comment no longer says the page reads no search parameter.
  - `tabs.ts`: the `pages` entry, its import and its place in `ORDER` go; `ORDER` is journey 0, map 1,
    links 2, flow 3, changes 4, opportunities 5. `url-state.ts`: `LinksTabId` and `TABS` lose `pages`; the
    default is `journey`; `worklist`, `sort` and `q` leave `LinksState`, and `view`, `sort`, `q` leave
    `LinksKey` and `PARSERS` (only the old tab used them: confirm with a grep before removing each).
    `internal-links-screen.tsx`: the three `'pages'` fallbacks become `'journey'`; a tab change writes
    `tab: next === 'journey' ? null : next`; `untieredHref` is
    `withQuery(pagesTabPath(workspaceSlug, project.slug, 'all'), UNTIERED_QUERY)`. `pages-context.ts`:
    `pagesContextOf` is deleted (nothing uses it now).
  - `messages/en.json`: remove `internalLinks.tabs.pages`. `11-navigation.md`: the tabs of
    "SEO > Internal links" become Journey, Link map, Links, Tier flow, Changes, Opportunities, and the
    "As built" paragraph gets one sentence: the Pages tab moved to SEO > Pages > All pages on 2026-11-26,
    and old addresses redirect.
  - The e2e files: every step that opens Internal links to reach the Pages grid opens
    `/digibranders/eventus-security/seo/pages/all` instead (`pagesGrid`, `expectPagesLoaded`,
    `waitForState('pages')`, the visual page of the Pages tab). Do not run them. Tell the lead in the commit
    body that the visual snapshots of that page need regenerating in the main checkout.

- [ ] **Step 5: Run the tests of the feature folder by folder**, one command each:
  `src/features/internal-links/tabs.test.ts src/features/internal-links/url-state.test.ts`, then
  `internal-links-screen.test.tsx`, `states.test.tsx`, `crawl-header.test.tsx`, `crawl-in-view.test.tsx`,
  `crawl-context.test.tsx`, then the route test, then `src/i18n/messages.test.ts`. A test that relied on the
  default tab being Pages is updated to name the tab it means. Run the web commands (eslint also on the
  three e2e files).

- [ ] **Step 6: Commit.** `git commit -m "Internal links: the Pages tab moves to Pages > All pages, old addresses redirect"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the redirect table
  of spec 5.3 row by row; a Journey, Links or Opportunities address never redirects; every key but `tab`
  survives the redirect, `inspect` and `itab` included; `grep -rn "'pages'" apps/web/src/features/internal-links`
  finds no leftover of the tab id; no link in the app still points at the old tab
  (`grep -rn "seo/internal-links" apps/web/src --include='*.tsx' --include='*.ts'`).

- [ ] **Step 8: Fix what the review found**, rerun, commit.

---

## Part D. Web: All pages

### Task 17: `DataTable` gets a start slot and grouped columns in the chooser

Spec 7.1 changes 3 and 6. These are shared components: add only what is listed, change no existing
behaviour, and keep every existing test of the folder passing untouched. UI task.

**Files:**
- Modify: `apps/web/src/components/app/data-table/types.ts`, `toolbar.tsx`, `toolbar.test.tsx`,
  `data-table.tsx`, `data-table.test.tsx`, `column-chooser.tsx`, `column-chooser.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - `toolbar.test.tsx`: a `start` node is drawn before the search box (in DOM order) and the bar without one
    is unchanged.
  - `data-table.test.tsx`: `toolbarStart` reaches the toolbar; with `columnGroups` and grouped columns the
    column chooser shows each group's label as a heading over its columns.
  - `column-chooser.test.tsx`: columns with `group` labels `A, A, B` draw two headings, in order; a column
    without a group draws none; with no `group` anywhere the list is exactly as before; the headings are not
    tab stops and each checkbox keeps its own accessible name; moving a column still announces its place.

- [ ] **Step 2: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/components/app/data-table/toolbar.test.tsx src/components/app/data-table/column-chooser.test.tsx`

- [ ] **Step 3: Implement.**
  - `types.ts`: `/** A slot at the start of the toolbar, before the search box: the view menu. */ toolbarStart?: ReactNode;`
    beside `toolbarEnd`.
  - `toolbar.tsx`: `start?: ReactNode` in `DataTableToolbarProps`, drawn first in the bar.
    `data-table.tsx`: passes `start={toolbarStart}`.
  - `column-chooser.tsx`: `ColumnChooserColumn` gains `group?: string | undefined` (the translated label).
    Before the first column of each run that shares a group, one `<li role="presentation">` with the label in
    `type-label text-foreground-tertiary` and the list's own padding. `data-table.tsx` sets `group` on the
    chooser columns from `column.group?.label` only when `columnGroups` is on.

- [ ] **Step 4: Run** the three test files, then
  `pnpm exec vitest run --maxWorkers=1 src/components/app/data-table`. Expect pass. Run the web commands.

- [ ] **Step 5: Commit.** `git commit -m "DataTable: a toolbar start slot, and the column chooser shows column groups"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: both additions are
  opt in and a table that passes neither renders the same markup as before; the chooser's list is still one
  list for assistive technology; no token or spacing invented.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 18: All pages, the toolbar and the columns

Spec 7.1 changes 3, 5 and 6, 7.2, 8. UI task.

**Files:**
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `page-columns.tsx`,
  `page-extras-cells.tsx`, `page-columns.test.tsx`, `pages-tab.test.tsx`, `pages-extras.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words.**

| Key | Text |
|---|---|
| `pages.groups.page` | Page |
| `pages.groups.indexing` | Indexing |
| `pages.groups.issues` | Issues |
| `pages.groups.search` | Search |
| `pages.groups.ai` | AI |
| `pages.groups.links` | Links |
| `internalLinks.columns.reason` (changed) | Indexable |
| `internalLinks.columns.canonical` | Canonical |
| `internalLinks.columns.canonicalSelf` | This page |
| `internalLinks.columns.clicksTip` | Google Search clicks on this page in the last 28 days, from Search Console |
| `internalLinks.columns.impressionsTip` | Times this page was shown in Google Search in the last 28 days, from Search Console |

- [ ] **Step 2: Write the failing tests.**
  - `page-columns.test.tsx`: the columns come in the order and with the group of the table of spec 7.2; the
    default visible set is `page`, `tier`, `status`, `reason`, `flags`, `clicks`; `canonical` shows the
    canonical address, "This page" when it equals the row's `url`, and the "none" text when null, and does
    not sort; `clicks` and `impressions` carry the new tooltips; `impressions` sorts.
  - `pages-tab.test.tsx`: the header has the group cells Page, Indexing, Search (a group with one shown
    column draws no group cell: with the default set that is Issues, and AI and Links are not shown); the
    filter bar's "+ Filter" and the Columns button are inside the table's toolbar and no filter row exists
    outside the table; the link scope menu is absent with the default columns and present after `cols` shows
    `linking`; choosing a filter draws its chip in the toolbar; the Columns menu lists the group headings;
    with no `sort` in the address the request asks for `sort=path`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  - `page-columns.tsx`: `pageColumns` takes one more translator, `groups: (id: 'page' | 'indexing' | 'issues' | 'search' | 'ai' | 'links') => string`
    (the screen passes `useTranslations('pages.groups')`), sets `group: { id, label }` on every column, and
    returns them in the order of spec 7.2: Page (`page`, `tier`, `status`, `tags`), Indexing (`reason`,
    `canonical`, `sitemap`), Issues (`flags`), Search (`clicks`, `impressions`, `keywords`, `rank`), AI
    (`citations`), Links (`depth`, `linking`, `fromTiers`, `outlinks`, `change`, `toT1`, `broken`,
    `redirects`, `nonIndexable`, `topAnchor`, `anchors`, `matches`). `defaultVisible` is true only for
    `tier`, `status`, `reason`, `flags`, `clicks` (and the identity column). The new `canonical` column is a
    `col.text`.
  - `pages-tab.tsx`: `columnGroups`, `compactToolbar` and `toolbarParts={{ sortNote: false }}` on the table;
    the `div` with `FilterBar` and `ScopeMenu` goes, and `toolbarEnd` is
    `<><FilterBar compact fields={fields} values={values} onChange={setValues} />{scopeShown ? <ScopeMenu … /> : null}</>`
    where `scopeShown` is true while `visible` holds `linking`, `fromTiers` or `outlinks`. The root stays a
    column that fills the height the screen gives it (`flex min-h-0 flex-1 flex-col gap-3`), so the table
    scrolls inside its panel.
  - `FilterBar` is not changed. If the bar does not sit in the end slot without breaking the toolbar at
    1280 px wide, stop and report to the lead with a screenshot description; do not edit `filter-bar.tsx`.

- [ ] **Step 5: Run the tests of `src/features/internal-links/pages` one file at a time, expect pass. Run the
  web commands**, and `src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "All pages: column groups, the filter bar in the table toolbar, sorted by address"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the column table of
  spec 7.2 row by row (group, id, default); nothing sits between the page toolbar and the table panel except
  the worklist chips, which Task 19 removes; an old address with `cols=` still shows the columns it names;
  the tooltips say "last 28 days" and "Search Console".

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 19: The View menu replaces the worklist chips

Spec 7.1 change 2, 7.3, 11 (the announcement). UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/pages/view-menu.tsx`, `view-menu.test.tsx`
- Delete: `apps/web/src/features/internal-links/pages/worklist-chips.tsx`
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `pages-tab.test.tsx`,
  `variants-chip.test.tsx`, `tier-suggestions.test.tsx`, `page-filters.ts`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `worklist-chips.tsx` (everything it draws: the six page lists with counts, the
  two link lists, the important tiers name, the variants count, the coverage note, the "no issues" text,
  `TierSuggestions` with `onEmptied`), `components/ui/menu.tsx` (`MenuItemDef`: `kind: 'radio'`, `group`,
  `detail`, `closeOnClick`), `lib/pages/views.ts`, `context-line.tsx` and `lib/internal-links/context-stats.ts`
  (where the tiered and untiered counts come from).

- [ ] **Step 2: Words.**

| Key | Text |
|---|---|
| `pages.view.trigger` | View: {view} |
| `pages.view.label` | View |
| `pages.view.sections.pages` | Pages |
| `pages.view.sections.sitemap` | Sitemap |
| `pages.view.sections.reach` | Reach |
| `pages.view.sections.linkProblems` | Link problems |
| `pages.view.all` | All pages |
| `pages.view.live` | Live pages |
| `pages.view.indexable` | Indexable |
| `pages.view.not_indexable` | Not indexable |
| `pages.view.redirects` | Redirects |
| `pages.view.errors` | Error pages |
| `pages.view.client_errors` | Client errors |
| `pages.view.server_errors` | Server errors |
| `pages.view.blocked` | Blocked |
| `pages.view.other` | Other addresses |
| `pages.view.variants` | Parameter variants |
| `pages.view.untiered` | Untiered |
| `pages.view.in_sitemap_indexable` | Indexable and in the sitemap |
| `pages.view.not_in_sitemap` | Missing from the sitemap |
| `pages.view.sitemap_not_live` | In the sitemap, not live |
| `pages.view.sitemap_not_indexable` | In the sitemap, not indexable |
| `pages.view.reachable` | Reachable by links |
| `pages.view.unreachable` | Not reachable by links |
| `pages.view.opensLinks` | Opens Internal links, Links |
| `pages.view.announce` | {view}: {count, plural, one {# page} other {# pages}} |

  The six page worklists and the two link worklists keep their names under `internalLinks.worklists.*`. The
  coverage line is `internalLinks.coverage.incomplete` and the empty Link problems line is
  `internalLinks.pages.noIssues`, both unchanged.

- [ ] **Step 3: Write the failing tests.**
  - `view-menu.test.tsx`: the trigger reads "View: All pages" with no `view`; the menu lists the sections
    and views of spec 7.3 in order, each with its count as the item's detail; a view with 0 is absent unless
    active; with `no_sitemap` there is no Sitemap section; `client_errors` is listed only when the address
    has `view=client_errors`; Parameter variants is listed while its count is above 0; choosing Live pages
    writes `view=live` with a history entry and announces "Live pages: 389 pages"; choosing All pages clears
    `view`; choosing Untiered writes the filter `tier=none` and clears `view`; choosing a page worklist writes
    `view=<worklist>`; choosing a link worklist calls `openEdgeWorklist`; while the counts load the items show
    no count and are still choosable; the coverage line shows when `may_be_incomplete`; the menu is one tab
    stop and works with arrow keys and Enter.
  - `pages-tab.test.tsx`: no group named by `internalLinks.pages.worklistsLabel` exists; `view=live` in the
    address sends `filter[view]=live`; `view=orphans` sends `filter[worklist]=orphans`; the "Suggested tiers"
    chip sits in the table toolbar and, when its last row leaves, focus goes to the View button.
  - `variants-chip.test.tsx` and `tier-suggestions.test.tsx`: updated to reach the same things through the
    menu and the toolbar.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `view-menu.tsx`:

```ts
export interface ViewMenuProps {
  scope: LinksScope;
  run: string | null;
  linksAvailable: boolean;
  state: Pick<PagesState, 'view' | 'worklist'>;
  untieredActive: boolean;
  onView: (view: PageView | PageWorklist | null) => void;
  onUntiered: () => void;
  onEdgeWorklist: (worklist: EdgeWorklist) => void;
  /** The trigger, so the caller can send focus to it. */
  triggerRef?: Ref<HTMLButtonElement>;
}
export function ViewMenu(props: ViewMenuProps): ReactElement;
```

  It reads `overviewQuery`, `worklistsQuery` and the tier read `ContextLine` uses (shared through the query
  cache), builds the items with `PAGE_VIEW_MENU`, `viewCounts` and `visibleViews`, and draws a `Menu` whose
  trigger is a secondary `sm` button. Items are `kind: 'radio'` with `closeOnClick`, `group` the section
  name, `detail` the formatted count; the two link worklists are `kind: 'action'` with `description` from
  `pages.view.opensLinks`. `weak_outlinks` is left out when `linksAvailable` is false and `lost_links_top`
  takes its name from `useImportantTiers`, as the chips did. `pages-tab.tsx`: `WorklistChips` goes;
  `toolbarStart` is the `ViewMenu`; `toolbarEnd` starts with `<TierSuggestions scope={scope} onEmptied={focusView} />`;
  `pageQueryOf` already sends `view` or `worklist` (Task 11); a change of view calls
  `announce(t('view.announce', …))` once the new total is known (`lib/a11y/announcer`). `filtered`, `clear`
  and the filtered-empty state treat a server view as they treat a worklist ("Show all pages" clears it).
  Delete `worklist-chips.tsx` and the message keys only it used (`internalLinks.pages.worklistsLabel`,
  `allPages`, `variantsLink`, `linkCount`), after a grep shows no other user.

- [ ] **Step 6: Run the tests of the folder one file at a time, expect pass. Run the web commands** and the
  two message tests.

- [ ] **Step 7: Commit.** `git commit -m "All pages: one View menu with counts replaces the worklist chips"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the menu against the
  table of spec 7.3 (sections, ids, where each count comes from); every count shown is the total the list
  then shows; nothing the chip row held was lost (the spec's list in 7.1 change 2); the web never sends
  `filter[view]` and `filter[worklist]` together; the announcement fires once per change; no chip row is
  left above the table.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 20: Folder, depth and variants on All pages, and the two seams

Spec 7.2 (Issues and Tracked rows), 7.4, 7.5, 10.1, 10.2, decision D10. UI task.

**Files:**
- Modify: `apps/web/src/features/internal-links/pages/page-filters.ts`, `page-filters.test.ts`,
  `pages-tab.tsx`, `pages-tab.test.tsx`, `page-columns.tsx`, `page-columns.test.tsx`, `bulk.test.tsx`
- Create: `apps/web/src/features/internal-links/pages/seam-columns.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words.**

| Key | Text |
|---|---|
| `pages.filters.folder` | Folder |
| `pages.filters.depthChip` | {depth, plural, =0 {Home page} =6 {6 clicks and more from the home page} one {# click from the home page} other {# clicks from the home page}} |
| `pages.filters.variantsChip` | With parameter variants |
| `pages.filters.remove` | Remove the filter {filter} |
| `pages.columns.issues` | Issues |
| `pages.columns.issuesTip` | Issues found on this page, from the Issues page |
| `pages.columns.tracked` | Tracked |
| `pages.columns.trackedYes` | Tracked |
| `pages.columns.trackedNo` | Not tracked |
| `pages.track.action` | Track in Monitoring |
| `pages.track.onlySelection` | Choose the pages one by one to track them |
| `pages.track.done` | {added, plural, one {# page added} other {# pages added}} |
| `pages.track.already` | {count} already tracked |
| `pages.track.notLive` | {count} not added: not a live page |
| `pages.track.overLimit` | {count} not added: the limit is {limit} pages |
| `pages.track.failed` | The pages could not be tracked |

- [ ] **Step 2: Write the failing tests.**
  - `page-filters.test.ts`: `pageFilterFields` gets the sections and returns a `folder` field (single
    choice) with one option per section, largest first, labelled with the section itself; `pageQueryOf`
    sends `folder` from the filter value (only a value that starts with `/` and has at most 200 characters),
    and `depth` and `variants` from the state.
  - `pages-tab.test.tsx`: choosing a folder sends `filter[folder]`; `?depth=3` sends `filter[depth]=3` and
    draws a removable chip "3 clicks from the home page" whose button clears `depth`; `?variants=1` sends
    `filter[include_variants]=true` with its chip; the CSV export carries `filter[view]`, `filter[folder]`
    and `filter[depth]`; with the seams as they are (unavailable) there is no Issues column, no Tracked
    column and no "Track in Monitoring" action, in the table and in the Columns menu.
  - `page-columns.test.tsx`: with `issues: true` the `issues` column exists in the group Issues, is shown by
    default, and `flags` is hidden by default; with `tracked: true` the `tracked` column exists in Search,
    shown by default.
  - `bulk.test.tsx`: "select all matching" with `view=live&folder=/blog/` sends a bulk body whose `filter`
    has `view` and `folder`.
  - One test mocks `@/lib/pages/tracking` as available (`vi.mock`): the action appears for an explicit
    selection, is disabled with `pages.track.onlySelection` for "all matching", and its toast repeats the
    outcome's numbers and the limit the outcome reports.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  - `page-filters.ts`: `pageFilterFields(t, tiers, tags, tagsLoading, folders: { sections: readonly string[]; loading: boolean; label: string })`
    adds the `folder` field after `status`; `pageQueryOf` reads it into `folder` with `enumValuesOf`, as it
    reads `idx`. The key `folder` belongs to the filter bar alone, so the Overview's section links set this
    filter and its chip shows.
  - `pages-tab.tsx`: the sections come from `overviewQuery` (the read the Overview and the View menu share).
    The field's `optionsLoading` is true until that read has answered: `useUrlFilters` keeps an enum value
    from the address while its options load and drops one that is not an option once they are known (with the
    existing dropped-filter toast), so a section link of the Overview keeps its `folder` on arrival. Its
    value in the address is the section as it is (`folder=/blog/`); add a case to `pages-tab.test.tsx` that
    opens `?view=live&folder=/blog/` cold and sees the chip and the request.
    The depth and variants chips are drawn after the filter bar in `toolbarEnd`, each a `Tag` with a remove
    button named by `pages.filters.remove`.
  - `seam-columns.tsx`: `issuesColumn(…)` and `trackedColumn(…)`, each returning a column definition for the
    groups Issues and Search. `pageColumns` takes `{ issues: boolean; tracked: ReadonlySet<string> | null }`
    and adds them only when present. `pages-tab.tsx` passes `ISSUE_COLUMNS_AVAILABLE` and the `ready` data of
    `useTrackedPages`, and adds the bulk action only when `TRACKING_AVAILABLE`; the action calls
    `useTrackPages(scope).track(ids)` and builds the toast from the `TrackOutcome`. No limit is a constant of
    the web.
  - The Issues column's cell reads its numbers only through `issueCountsOf(row)` of
    `lib/pages/issue-source.ts` (null on this branch: the cell then shows the "none" text). No cast of
    `row.extras` anywhere: the generated type has no `issues` field until the Issues session adds it. The
    test of step 2 mocks `@/lib/pages/issue-source` to cover a row with counts.

- [ ] **Step 5: Run the tests of the folder one file at a time, expect pass. Run the web commands** and the
  two message tests.

- [ ] **Step 6: Commit.** `git commit -m "All pages: the folder filter, depth and variant chips, and the seams for issues and tracking"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: with the seams
  unavailable nothing of them is rendered, not even an empty column or a disabled button (spec D10); no
  number 200 or other limit in the web code; the bulk filter carries the view, the folder and the depth, so
  "all matching" changes what the list shows and nothing more; the chips are removable with the keyboard.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

---

## Part E. Web: the Overview cards

### Task 21: Cards 1 to 6

Spec 6.4 (cards 1 to 6, the percent bases, the states), 8 (the grid), 11 (charts). UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/pages-page/overview-cards.tsx`, `card-rows.tsx`,
  `overview-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/pages-page/overview-tab.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `components/app/chart/chart-frame.tsx` (the `kind: 'html'` props: `title`,
  `variant`, `height`, `summary`, `info`, `body`, `table`, `empty`, `status`), `bar-list.tsx` (the row shape
  with `href`, `accessibleText`, `tip`; the distribution mode and its colours), `rings-chart.tsx` and
  `lib/charts/rich-rings.ts` (one row is one ring; `segments` carry a colour token), `stacked-share-bar.tsx`
  (`StackedShareBar`, `StackedShareTable`: a row has an `href`, a segment has none), one existing card that
  uses `ChartFrame` with `BarList` (for example a card under `features/ai-overview/cards/`), and
  `lib/pages/overview-model.ts`.

- [ ] **Step 2: Words** (namespace `pages.cards`):

| Key | Text |
|---|---|
| `status.title` | Addresses by status |
| `status.info` | Every address the crawl read, by what it answered. Shares are of every address. |
| `status.center` | {count} live |
| `status.rows.live` | Live pages |
| `status.rows.variant` | Parameter variants |
| `status.rows.redirected` | Redirects |
| `status.rows.client_error` | Client errors |
| `status.rows.server_error` | Server errors |
| `status.rows.blocked` | Blocked |
| `status.rows.other` | Other |
| `funnel.title` | From crawled to indexable |
| `funnel.info` | How many addresses are live pages, how many of those Google may index, and how many of those the sitemap lists. |
| `funnel.rows.addresses` | Addresses crawled |
| `funnel.rows.live` | Live pages |
| `funnel.rows.indexable` | Indexable |
| `funnel.rows.in_sitemap_indexable` | Indexable and in the sitemap |
| `sections.title` | Pages by section |
| `sections.info` | Live pages by the first folder of their address. Shares are of live pages. |
| `sections.other` | {count, plural, one {Other sections (#)} other {Other sections (#)}} |
| `tiers.title` | Pages by tier |
| `tiers.info` | Live pages by their tier today. Shares are of live pages. |
| `depth.title` | Click depth |
| `depth.info` | How many clicks from the home page each live page is. Shares are of live pages. |
| `depth.row` | {depth, plural, =0 {Home page} =6 {6 clicks and more} one {# click} other {# clicks}} |
| `depth.unreachable` | Not reachable by links |
| `sitemap.title` | Sitemap coverage |
| `sitemap.info` | Indexable pages the sitemap lists and misses, and addresses it lists that are not live or not indexable. |
| `sitemap.rows.in_sitemap_indexable` | In the sitemap and indexable |
| `sitemap.rows.not_in_sitemap` | Indexable, missing from the sitemap |
| `sitemap.rows.sitemap_not_live` | In the sitemap, not live |
| `sitemap.rows.sitemap_not_indexable` | In the sitemap, not indexable |
| `sitemap.emptyTitle` | The crawl found no sitemap |
| `sitemap.emptyReason` | Add a sitemap to the website, then crawl again. |
| `table.row` | Group |
| `table.pages` | Pages |
| `table.share` | Share |
| `shareOfAddresses` | {share} of every address |
| `shareOfLive` | {share} of live pages |
| `opens` | {label}, {count}. Opens All pages |
| `summary` | {title}: {rows} |

- [ ] **Step 3: Write the failing tests** in `overview-tab.test.tsx` (with `pagesAs('viewer', 'overview')`
  on the Eventus fixture, numbers read from the mocked overview handler, not typed in):
  - six cards are drawn with their titles, in the order of spec 6.4;
  - every row of every card that names pages is a link whose accessible name follows `pages.cards.opens`
    and whose `href` is the model's; the folded sections row is not a link;
  - card 1: the centre reads the live count; a status group of 0 is absent from the legend list and present
    in the table; the legend rows are links;
  - each card's Chart and Table switch shows the same rows with counts and shares, works with the keyboard,
    and focus stays on the switch;
  - a status row's tooltip names "of every address"; a section row's names "of live pages";
  - with a crawl that found no sitemap (override the handler): card 6 shows its empty state and card 2 has
    three rows;
  - while the read loads: skeleton cards; when it fails: the inline error of Task 13 and no card;
  - choosing an older crawl in the picker changes the numbers (two handlers by `run`);
  - `axe` finds nothing.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.**
  - `card-rows.tsx`: `CardRowsTable({ caption, rows })`, the table of a card (row, pages, share; each row
    with an `href` a link), and `CardLegend({ rows })`, the same rows as a list of links for cards 1 and 6,
    whose marks are not focusable. Both take rows already translated:
    `{ id, label, countText, shareText, tip, href, accessibleText }`.
  - `overview-cards.tsx`: one component per card (`StatusCard`, `FunnelCard`, `SectionsCard`, `TiersCard`,
    `DepthCard`, `SitemapCard`), each a `ChartFrame` with `variant="panel"`, `kind="html"`, `summary` built
    from `pages.cards.summary`, `info`, and `table` a `CardRowsTable`. Card 1's body is `RingsChart` with one
    row (`names={false}`, `emphasis`), seven segments in the order of C2's status groups, a segment of 0
    left out, plus `CardLegend`. Cards 2 to 5 are `BarList` rows with `href` (card 4 with `TierBadge` as the
    row's `icon`; card 5's last row in the warning tone the model marks). Card 6 is `StackedShareBar` with
    one row and four segments, plus `CardLegend`; with `model.sitemap === null` the frame's empty state.
    Colours are existing tokens only: read `lib/design/read-tokens.ts` and the `ShareColor` and
    `BarScaleColor` unions and choose from them; invent none.
  - `overview-tab.tsx`: under the strip, the grid `grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4`
    inside the same scroll container. Loading draws six `ChartFrame`s in their loading state.

- [ ] **Step 6: Run the test file, expect pass. Run the web commands** and the two message tests.

- [ ] **Step 7: Commit.** `git commit -m "Pages overview: the status, funnel, section, tier, depth and sitemap cards"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: each card against
  its row of the table in spec 6.4 (chart, rows, what each opens); there is no "indexed by Google" row and
  no page types card (D11, D12); no sample or typed-in number in the component; a mark is never the only way
  in (legend and table rows carry the links); each chart has a text summary; the percent base is named.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 22: The Issues card, "Since the last crawl", and the Overview's export

Spec 6.3, 6.4 (cards 7 and 8, the Export paragraph), 10.1. UI task.

**Files:**
- Modify: `apps/web/src/features/internal-links/pages-page/overview-cards.tsx`, `overview-tab.tsx`,
  `overview-tab.test.tsx`, `pages-screen.tsx`
- Create: `apps/web/src/lib/pages/overview-csv.ts`, `overview-csv.test.ts`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words** (namespace `pages.cards`):

| Key | Text |
|---|---|
| `issues.title` | Issues |
| `issues.errors` | Pages with an error |
| `issues.warnings` | Pages with a warning |
| `issues.notices` | Pages with a notice |
| `issues.opens` | {label}, {count}. Opens Issues |
| `changes.title` | Since the last crawl |
| `changes.pagesAdded` | Pages added |
| `changes.pagesRemoved` | Pages removed |
| `changes.editorial` | Editorial links added and lost |
| `changes.editorialValue` | {added} added, {lost} lost |
| `changes.lostToTop` | Links lost to important tiers |
| `changes.opens` | {label}, {value}. Opens Internal links, Changes |
| `changes.firstCrawl` | This is the first crawl. Changes appear after the next one. |
| `changes.pending` | Comparing with the crawl before |
| `export.card` | Card |
| `export.row` | Row |
| `export.count` | Count |

  The `unavailable` state of card 8 uses the words the Changes tab already has: find its key under
  `internalLinks.changes` and use that key, do not write the sentence again.

- [ ] **Step 2: Write the failing tests.**
  - `overview-csv.test.ts`: `overviewCsv(model, labels)` returns a `CsvTable` with the header Card, Row,
    Count and one line per row of every card in card order, the folded sections row included, and no
    sitemap lines when `model.sitemap` is null.
  - `overview-tab.test.tsx`: card 8 shows four lines whose values come from the mocked changes summary, each
    a link to Internal links with `tab=changes` (and `run` when chosen); with `state: 'first_crawl'` the one
    sentence; with `pending` its sentence; there is no Issues card and the strip has five numbers while
    `useIssueTotals` is unavailable; with `@/lib/pages/issue-source` mocked `ready`, card 7 shows three rows
    that link to `/seo/issues?severity=error` (and `warning`, `notice`) and the strip has six numbers, the
    sixth equal to `withIssue`; the page's Export downloads `pages-overview.csv` (assert `downloadBlob` was
    called with a blob whose text has the header and the live count).

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `overview-csv.ts`:
  `export function overviewCsv(model: OverviewModel, labelOf: (card: keyof OverviewModel, row: OverviewRow) => string, header: readonly [string, string, string]): CsvTable`
  with `lib/csv/csv-write.ts`. `IssuesCard` and `ChangesCard` in `overview-cards.tsx`: card 7 is rendered
  only for `ready`; card 8 is a panel with four lines (label left, value right, the whole line a link), no
  chart, reading `changesSummaryQuery(scope, run)`. `overview-tab.tsx` registers the export
  (`registerExport(() => { downloadBlob(csvBlob(overviewCsv(…)), 'pages-overview.csv'); return Promise.resolve(); })`)
  while the read is ready and unregisters on unmount; `pages-screen.tsx` hands it `registerExport` as it does
  to All pages. The Overview computes no issue total (spec 6.3).

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** and the two message tests.

- [ ] **Step 6: Commit.** `git commit -m "Pages overview: the issues and changes cards, and the CSV export"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: nothing of the
  Issues card is rendered while the seam is unavailable; the issue numbers are only ever the seam's; cards 7
  and 8 follow `run`; the four states of card 8 against spec 6.4; the CSV holds every card's rows.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

---

## Part F. Web: the page drawer

The drawer is `PageInspector` on top of the shared `Inspector`. In Tasks 23 to 25 do not edit
`components/app/inspector/inspector.tsx`, `inspector-layout.tsx`, `use-inspector.ts` or `lib/inspector/*`;
call them as they are. The drawer always lies over the table: write nothing about docking or width.

### Task 23: Five tabs

Spec 9.1, 9.4 (the first paragraph, and the tabs AI and Links). UI task.

**Files:**
- Create: `apps/web/src/lib/pages/drawer-tabs.ts`, `drawer-tabs.test.ts`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `extras-sections.tsx`,
  `page-inspector.test.tsx`, `extras-sections.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `components/app/inspector/inspector-tabs.tsx` (`InspectorTabs`,
  `InspectorPanel`), `use-inspector.ts` (`tab`, `setTab`, `DEFAULT_INSPECTOR_TAB`), one tabbed inspector that
  exists (`grep -rln "InspectorTabs" apps/web/src/features`), `page-inspector.tsx`, `extras-sections.tsx`.

- [ ] **Step 2: Words** (namespace `pages.drawer`): `tabsLabel` "Page sections"; `tabs.overview` "Overview";
  `tabs.search` "Search"; `tabs.issues` "Issues"; `tabs.ai` "AI"; `tabs.links` "Links"; `ai.none` "No AI
  answer cited this page in the last 28 days".

- [ ] **Step 3: Write the failing tests.**
  - `drawer-tabs.test.ts`: `PAGE_DRAWER_TABS` is `overview`, `search`, `issues`, `ai`, `links`;
    `pageDrawerTab('links')` is `links`; `pageDrawerTab('nope')` and `pageDrawerTab('overview')` are
    `overview`.
  - `extras-sections.test.tsx`: `parts={['keywords']}` draws only the tracked keywords card; without `parts`
    every card is drawn as today.
  - `page-inspector.test.tsx`: the drawer has a tab list "Page sections" with the five tabs in order; with
    no `itab` Overview is selected; `itab=links` selects Links; choosing a tab writes `itab` (and removes it
    for Overview) without a history entry; an unknown `itab` shows Overview; the Links tab holds the strip
    (depth, links in, links out), linking pages by tier and by placement, the anchors card, the changes
    card, linking pages and outlinks with "View all in Links" as links; the AI tab holds the citations card,
    or the "none" sentence when the total is 0; stepping with J and K keeps the tab; the header keeps the
    path, the title line, the position and Previous and Next; the footer keeps Copy address, Visit and Open
    in journey; there is no Track control anywhere in the drawer; `axe` finds nothing on each tab.
  - Until Task 24 the Overview tab holds the tier and tags section and the flags section, and until Task 25
    the Search tab holds the tracked keywords card and the Google card and the Issues tab holds the flags
    section: the tests of this task assert only that each existing section is in exactly one tab or in the
    tabs this list names.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `drawer-tabs.ts`:

```ts
export const PAGE_DRAWER_TABS = ['overview', 'search', 'issues', 'ai', 'links'] as const;
export type PageDrawerTab = (typeof PAGE_DRAWER_TABS)[number];
export const pageDrawerTab = (value: string): PageDrawerTab;
```

  `extras-sections.tsx`: `parts?: readonly ('changes' | 'keywords' | 'citations' | 'anchors' | 'google')[]`
  (absent: all). `page-inspector.tsx`: it calls `useInspector()` itself for `tab` and `setTab` (hosts pass
  nothing new); the body is `InspectorTabs` with one `InspectorPanel` per tab; the sections move into the
  panels as the tests say; the error and not found bodies stay outside the tabs. Each tab's parts become
  small components in the same folder only where the file would pass 400 lines: `drawer-links-tab.tsx` for
  the Links tab.

- [ ] **Step 6: Run** `src/lib/pages/drawer-tabs.test.ts`, `src/features/internal-links/inspector`, then
  `src/features/internal-links/journey/journey-tab.test.tsx` and `internal-links-screen.test.tsx` (they open
  the drawer). Expect pass. Run the web commands and the two message tests.

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the tabs Overview, Search, Issues, AI and Links"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: nothing of the old
  inspector was dropped (list its sections from `git show HEAD~1:apps/web/src/features/internal-links/inspector/page-inspector.tsx`
  and find each in a tab); the tab order is the owner's; the tab is in the address; the drawer still opens
  from every tab of Internal links; no shared drawer file in the diff; no width or docking code.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 24: The drawer's Overview tab

Spec 9.4 (Overview), 10.1, 11 (tiles are buttons with full labels). UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/drawer-overview-tab.tsx`,
  `apps/web/src/lib/pages/drawer-tiles.ts`, `drawer-tiles.test.ts`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words** (namespace `pages.drawer.overview`):

| Key | Text |
|---|---|
| `chips.label` | Page facts |
| `chips.indexable` | Indexable |
| `chips.inSitemap` | In sitemap |
| `chips.notInSitemap` | Not in sitemap |
| `chips.variant` | Parameter variant |
| `tiles.label` | Page numbers |
| `tiles.clicks` | Clicks |
| `tiles.impressions` | Impressions |
| `tiles.keywords` | Tracked keywords |
| `tiles.citations` | AI citations |
| `tiles.linksIn` | Links in |
| `tiles.linksOut` | Links out |
| `tiles.depth` | Depth |
| `tiles.issues` | Issues |
| `tiles.last28` | last 28 days |
| `tiles.bestRank` | best rank {rank} |
| `tiles.noRank` | none rank yet |
| `tiles.linksNote` | {scope}, {count} in all |
| `tiles.depthNote` | clicks from the home page |
| `tiles.notReachable` | Not reachable by links |
| `tiles.notConnected` | Not connected |
| `tiles.notCollected` | Not collected yet |
| `tiles.issuesNone` | None found |
| `tiles.issuesNote` | {count, plural, one {# error} other {# errors}} |
| `tiles.opens` | {label}: {value}, {note}. Opens the {tab} tab. |
| `tiles.opensNoNote` | {label}: {value}. Opens the {tab} tab. |
| `attention.title` | Needs attention |
| `attention.none` | Nothing needs attention on this page |
| `attention.seeAll` | See all issues |
| `about.title` | About |
| `about.pageTitle` | Title |
| `about.address` | Address |
| `about.canonical` | Canonical |
| `about.redirectsTo` | Redirects to |
| `about.lastCrawled` | Last crawled |
| `about.noTitle` | No title |

  The issues note names the most severe kind present: add `tiles.issuesWarnings` and `tiles.issuesNotices`
  in the same plural form with "warning" and "notice".

- [ ] **Step 2: Write the failing tests.**
  - `drawer-tiles.test.ts`: `drawerTiles(detail, issues)` returns eight tiles in the order of spec 9.4 with
    `id`, `value` (a number or null), `state` (`ok`, `not_connected`, `pending`, `unreachable`), `note` parts
    and `tab`; clicks and impressions are `not_connected` or `pending` from `extras.gsc.state` and never 0
    in those states; the keywords note is the best rank or "none"; depth with a null `click_depth` is
    `unreachable`; with issues `unavailable` there are seven tiles; with `ready` the eighth carries the count
    of the most severe kind present.
  - `page-inspector.test.tsx`, Overview tab: the chips (status code, Indexable or the reason, In sitemap or
    Not in sitemap, the tier badge, "Parameter variant" for a variant) come from the page row; seven tiles
    are buttons in one group, each with the accessible name of `tiles.opens`; pressing Clicks selects the
    Search tab, AI citations the AI tab, Links in the Links tab, and `itab` follows; a Search Console tile
    reads "Not connected" for a project without a property; "Needs attention" lists the page's flags with
    their texts, or the "nothing" sentence; About shows the title, the address with a working copy button,
    the canonical, the redirect target for a redirect, and the crawl date; tier and tags work as before
    (reuse the existing cases: set a tier, reset to rule, add and remove a tag); with
    `@/lib/pages/issue-source` mocked `ready`: eight tiles, and "Needs attention" lists at most five issues,
    most severe first, with "See all issues" selecting the Issues tab.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `drawer-tiles.ts` is pure (no text, no React). `drawer-overview-tab.tsx`
  draws: the chips (`Badge`, `StatusBadge`, `TierBadge`); the tiles as one joined panel, `grid grid-cols-4`
  with `grid-cols-2` under the container width the design system names for the inspector, each a `button`
  (value in the metric type, label and note in `type-meta`), closing up to seven; "Needs attention"
  (`InspectorSection`): the flags list that exists today, or the issues from `usePageIssues` when `ready`;
  About (`KeyValues` of `components/app/inspector/key-values.tsx`); then the existing tier and tags section,
  moved here unchanged. `page-inspector.tsx` renders it in the Overview panel and passes `onTab` (the
  `setTab` of Task 23).

- [ ] **Step 5: Run** the two test files, expect pass. Run the web commands and the two message tests.

- [ ] **Step 6: Commit.** `git commit -m "Page drawer: the Overview tab with chips, tiles, needs attention and about"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the tile table of
  spec 9.4 row by row (value, note, tab, where the number comes from); a tile never shows 0 for "not
  connected" or "not collected"; no Track control; each tile is a button with a full name; the grid closes
  up with seven; no "No data" or "N/A"; colour is not the only sign on chips.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 25: The drawer's Search and Issues tabs

Spec 9.4 (Search, Issues), 9.5, 10.1, 10.3. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/drawer-search-tab.tsx`, `drawer-issues-tab.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `chart-frame.tsx` (the `kind: 'line'` props: `categories`, `categoryHeader`,
  `series`, `formatValue`, `height`, `summary`, `variant="inspector"`), one inspector that draws a line chart
  with it, `lib/pages/search-daily.ts`, `lib/pages/search-detail-slot.tsx`, `lib/pages/issue-source.ts`,
  `lib/routes/paths.ts` (`integrationsPath`), how `extras-sections.tsx` `GoogleBody` words the three states.

- [ ] **Step 2: Words** (namespace `pages.drawer`):

| Key | Text |
|---|---|
| `search.title` | Search Console, last 28 days |
| `search.clicks` | Clicks |
| `search.impressions` | Impressions |
| `search.day` | Day |
| `search.summary` | {clicks} clicks and {impressions} impressions from {start} to {end} |
| `search.notConnectedTitle` | Search Console is not connected |
| `search.notConnectedReason` | Connect Search Console to see this page's clicks and impressions. |
| `search.connect` | Open Integrations |
| `search.pendingTitle` | Not collected yet |
| `search.pendingReason` | The page numbers arrive after the next Search Console update. |
| `search.none` | Google reported no clicks or impressions for this page in these 28 days |
| `search.loadFailed` | The Search Console numbers could not be loaded |
| `issues.pending` | Checks from the Issues page appear here once they are available |
| `issues.none` | No issues found on this page |
| `issues.seeAll` | See all pages with this issue |
| `issues.loadFailed` | The issues of this page could not be loaded |
| `issues.severity.error` | Error |
| `issues.severity.warning` | Warning |
| `issues.severity.notice` | Notice |

- [ ] **Step 3: Write the failing tests** in `page-inspector.test.tsx`:
  - Search tab, in this order in the DOM: the Search Console section, then nothing of the slot, then the
    tracked keywords card;
  - `ok`: the two totals, and a chart "Search Console, last 28 days" with two series and a table of 28 rows
    reached with the Chart and Table switch;
  - `ok` with every day 0: the totals read 0 and the "no clicks or impressions" sentence replaces the chart;
  - `not_connected`: its title and reason, and the link "Open Integrations" only for a role that may connect
    (use the permission the Integrations screen checks; find it with a grep, do not guess);
  - `pending`: its title and reason;
  - the read failing: the inline error with a retry that works;
  - a mocked `PageSearchDetailSlot` that renders a marker appears between the chart and the keywords;
  - Issues tab while the seam is unavailable: the line of `issues.pending`, then the page's flags with their
    texts; never empty;
  - Issues tab with `usePageIssues` mocked `ready`: each issue with its severity badge (a word, not only a
    colour), its name and its detail, and "See all pages with this issue" as a link when
    `hrefs.issueCheck` gives one and absent when it gives `null`; `ready` with none: `issues.none`; `error`:
    the inline error with retry;
  - the Google card of the old inspector is gone from every tab (its numbers are the Search tab's).

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `drawer-search-tab.tsx`: `usePageSearchDaily(scope, run, urlId)`; a
  `MetricStrip size="sm"` with the two totals; `ChartFrame variant="inspector" kind="line"` with the days as
  categories (`formatIsoDate` in the project's time zone) and the two series, `height={180}`; then
  `<PageSearchDetailSlot scope urlId url timeZone />`; then `ExtrasSections parts={['keywords']}`.
  `drawer-issues-tab.tsx`: `usePageIssues`; the four states above. The name of an issue comes from the
  Issues session's messages when they exist: on this branch the tab takes a `nameOf: (checkId: string) => string`
  prop that `page-inspector.tsx` fills with the check id itself, marked with one comment that the Issues
  session replaces it. `page-inspector.tsx` renders both tabs and no longer passes `'google'` in any
  `parts`.

- [ ] **Step 6: Run** `src/features/internal-links/inspector`, expect pass. Run the web commands and the two
  message tests.

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the Search tab with 28 days of Search Console, and the Issues tab"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the Search tab's
  order and its three Search Console states against spec 9.4; no period other than the stored 28 days is
  offered; the slot is rendered with the props of spec 10.3 and draws nothing; the Issues tab is never empty
  and never invents an issue; "Search Console" is never abbreviated; the chart has its table and its
  summary.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

---

## Part G. Words and the final checks

### Task 26 (Haiku): Audit the words

Spec 11. The UI tasks added their own keys; this task only checks them.

**Files:** `apps/web/messages/en.json`, `docs/glossary/final-list.md` (read; change only on a finding)

- [ ] **Step 1: Run the checks.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm exec vitest run --maxWorkers=1 src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts
grep -nP "[\x{2012}-\x{2015}]" messages/en.json
node -e "const m=require('./messages/en.json');const w=(o,p=[])=>Object.entries(o).flatMap(([k,v])=>typeof v==='string'?[[p.concat(k).join('.'),v]]:w(v,p.concat(k)));for(const [k,v] of w(m.pages)) if(/Monitored|GSC|Rankings?\b|No data|N\/A|\bSource\b|window|!/.test(v)) console.log(k,'|',v)"
```

  Expected: the tests pass, the grep prints nothing, the script prints nothing.

- [ ] **Step 2: Find keys nothing uses.** For every key under `pages` and every key this plan added under
  `internalLinks.columns`, run `grep -rn "<last two segments of the key>" src` and list the keys with no user.
  Remove a key only when no code builds it from a template (`t(\`view.${id}\`)` uses every `pages.view.*`).

- [ ] **Step 3: Read `docs/glossary/terms.md` rows A5, A12 and A15 and `final-list.md`.** They were written
  in commit afc686bf. Confirm the visible strings use "Pages", "All pages", "Overview", "Tracked",
  "Parameter variant", "Orphan page", "Untiered", "Linking pages", "Outlinks", "Best rank" as those files
  write them. Report a mismatch; fix the string, not the glossary.

- [ ] **Step 4: Commit** only if something changed:
  `git commit -m "Pages: message audit"`.

- [ ] **Step 5: Independent senior review (Sonnet subagent).** Reads every string under `pages` in
  `messages/en.json` once, as a person would: plain sentences, the glossary's words, no dash, no
  exclamation mark, plural forms right, a state says what is true.

- [ ] **Step 6: Fix what the review found** (Haiku), rerun step 1, commit.

### Task 27: Final integration checks

Spec 12 ("On the running app"), 16 (the whole checklist). Run by the lead or a Sonnet subagent, alone, with
nothing else running.

- [ ] **Step 1: Backend, targeted.**

```bash
colima status
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/backend
uv run ruff check src/idraft/api/internal_links src/idraft/api/schemas tests/api/internal_links
uv run ruff format --check src/idraft/api/internal_links src/idraft/api/schemas tests/api/internal_links
uv run mypy src/idraft/api/internal_links src/idraft/api/schemas tests/api/internal_links
uv run lint-imports
uv run pytest -n 0 --no-cov tests/api/internal_links/test_inventory.py tests/api/internal_links/test_page_search.py tests/api/internal_links/test_page_sort_extra.py tests/api/internal_links/test_reads_pages.py tests/api/internal_links/test_variants.py tests/api/test_openapi.py tests/api/test_route_access.py
uv run python -m idraft.api.openapi | diff - openapi/v1.json
```

  Expected: all pass, and the `diff` prints nothing.

- [ ] **Step 2: Web, targeted.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm gen:api && git diff --exit-code src/lib/api/schema.ts
pnpm typecheck
pnpm exec eslint --max-warnings 0 src/lib/pages src/lib/internal-links src/lib/routes src/lib/navigation src/features/internal-links src/components/app/data-table src/mocks/handlers/internal-links.ts src/mocks/internal-links-inventory.ts src/test/pages-harness.tsx "src/app/[workspace]/[project]/seo"
pnpm exec prettier --check src/lib/pages src/features/internal-links src/components/app/data-table messages/en.json
pnpm exec vitest run --maxWorkers=1 src/lib/pages
pnpm exec vitest run --maxWorkers=1 src/lib/internal-links/queries.test.ts src/lib/routes src/lib/navigation
pnpm exec vitest run --maxWorkers=1 src/mocks/internal-links-inventory.test.ts src/mocks/handlers/internal-links.test.ts
pnpm exec vitest run --maxWorkers=1 src/components/app/data-table
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages-page
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/tabs.test.ts src/features/internal-links/url-state.test.ts src/features/internal-links/internal-links-screen.test.tsx src/features/internal-links/states.test.tsx
pnpm exec vitest run --maxWorkers=1 "src/app/[workspace]/[project]/seo" src/features/shell/project-shell.test.tsx src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts
```

  One command at a time. Expected: every one passes and `git diff --exit-code` prints nothing.

- [ ] **Step 3: The build, once** (the routes changed):

```bash
pnpm build
```

  Expected: it succeeds and lists `/[workspace]/[project]/seo/pages` and `/[workspace]/[project]/seo/pages/all`.
  Afterwards delete what it made: `rm -rf .next` from `apps/web` (it can be rebuilt).

- [ ] **Step 4: No shared drawer file changed, and no dash anywhere.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7
git diff --stat a8167b06..HEAD -- apps/web/src/components/app/inspector apps/web/src/lib/inspector apps/web/design-preview
git diff a8167b06..HEAD | grep -nP '^\+.*[\x{2012}-\x{2015}]'
```

  Expected: both print nothing.

- [ ] **Step 5 (optional, heavy; the lead decides): look at the running app at 1280 by 720.** Only with
  nothing else heavy running. Follow the Dev Server Policy:
  1. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'` and check whether a listener's working directory is
     this worktree's `apps/web`. If one is, reuse it.
  2. If none is, start one in the background on a free port, never killing anything:
     `NEXT_PUBLIC_API_MOCKING=all pnpm dev -- --port 3111` (take the next free port if 3111 is taken) and read
     the URL from its output.
  3. In the built-in browser at 1280 by 720, signed in to the mocked app, on the Eventus project:
     - All pages, no filter and no banner: measure the top of the first row
       (`document.querySelector('[role="grid"] [role="row"]:not(:has([role="columnheader"]))').getBoundingClientRect().top`).
       It must be at or above 224 (spec section 8). The page does not scroll; the table scrolls inside its panel under a
       pinned header. Repeat at 1920 by 1080.
     - Open a row: the drawer lies over the table and the table keeps its width.
     - Overview: every strip number and every card row opens All pages, and the list's total equals the
       number on the mark. Check at least one row of each card.
     - `/seo/internal-links?tab=pages&view=orphans&tier=none` lands on
       `/seo/pages/all?view=orphans&tier=none`; a bare `/seo/internal-links` opens Journey;
       `/seo/pages/performance` is the 404 page.
  4. Stop the server you started (only that one), and `rm -rf .next`.
  If the first row is below 224, report the measured parts (toolbar row, table toolbar, header rows) to the
  lead; do not hide a control to pass.

- [ ] **Step 6: Walk the acceptance checklist of spec section 16** line by line and write, for each line,
  the test or the observation that proves it. Lines that wait for another session ("after the Issues merge",
  "when tracking exists") are marked as waiting, with the seam that holds them.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** It is given the whole range
  `git log --oneline a8167b06..HEAD` and `git diff --stat a8167b06..HEAD`, spec sections 13, 14 and 16, and
  the checklist of step 6. It checks: nothing of spec 13 ("Not in this build") was built; the only changes
  to shared files are the Pages entries of spec 14; every acceptance line has its proof; the commits are in
  the order backend, client, web; no attribution line in any commit message
  (`git log a8167b06..HEAD --format=%B | grep -i "co-authored\|generated with"` prints nothing).

- [ ] **Step 8: Fix what the review found**, rerun the commands of the steps the fix touches, commit. Then
  report to the lead: what passed, what was not run (the full suites, e2e), and that the visual snapshots of
  the old Pages tab need regenerating in the main checkout. Do not merge and do not push.

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| 3 decisions D1 to D12 | D1 14; D2 16; D3 13, 23; D4 11, 23; D5 23 to 25 (no shared drawer file); D6 18 (pager untouched); D7 3; D8 1, 3, 8, 10; D9 19; D10 20, 22; D11, D12 21 |
| 4 words | 1 |
| 5 routes, tabs, redirects, sidebar | 9, 13, 14, 16 |
| 6 Overview | 3, 8, 10, 13, 21, 22 |
| 7 All pages | 1, 2, 4, 7, 11, 17 to 20 |
| 8 layout and the budget | 13, 18, 19, 27 |
| 9 drawer | 5, 9, 11, 23 to 25 |
| 10 seams | 9, 20, 22, 24, 25 |
| 11 words | every UI task, 26 |
| 12 tests | every task, 27 |
| 14 merge points | Rules, 14, 27 |
| 15 blocks | 5 (before dispatching), 9, 20 |
| 16 acceptance | 27 |
