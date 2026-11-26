# Internal links, plan 10: Link map graph read (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One read, `GET .../internal-links/graph`, that returns a whole crawl as the nodes and edges the Link map draws.

**Architecture:** A pure function folds stored pages and links into the map's graph (canonical live pages as nodes, one edge per page pair, menu and footer links as a count on the page). `LinkReadService.graph` reads three aggregates in one snapshot and hands them to that function. No migration, no new table, no change to ingest.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy Core (async), Pydantic, pytest with Testcontainers.

Date: 2026-11-26. Branch: `feat/link-map-backend`, worktree `.claude/worktrees/link-map-backend` (create it with `git worktree add .claude/worktrees/link-map-backend -b feat/link-map-backend origin/develop`). Builder: one Sonnet session, one task at a time. Each task ends with an independent review on Sonnet (never Opus or Fable). Targeted serial tests only (`-n 0 --no-cov` plus the test path); no full `./check.sh` in the worktree. The web side is plan 11 and starts after task 5 of this plan is on `origin/develop`.

Read first: `backend/src/idraft/api/internal_links/reads.py` (the service and `read_scope`), `read_routes.py` (how a route is declared), `docs/superpowers/plans/2026-11-24-internal-links-09-canonical-variants.md` (how variants are folded in the stored links), and the approved mock `apps/web/design-preview/il-map-layout.js` (`buildGraph` is the behaviour this plan ports).

---

## Decisions taken as given

- **G1 Nodes.** A node is a page of the crawl with `status_code = 200` and `variant_of_url_id IS NULL`. Redirects, errors and variants are never nodes.
- **G2 Redirects fold.** A link whose target is a redirect counts as a link to the page the redirect leads to, following `redirect_url_id` for at most 5 hops. A link that ends on a page that is not a node is dropped. Variants need no work here: ingest already re-pointed their links (plan 09), and their own links are `ignored`.
- **G3 Edges.** One edge per ordered page pair, from stored links with `ignored = false` whose scope is `editorial`, or `editorial` and `auto_generated` when `include_auto` is true. A link from a page to itself (after G2) is dropped. `links` on an edge is the sum of `occurrences`.
- **G4 Menu and footer links are not edges** (owner decision, 2026-11-26). They are a number on the target page: `sitewide_from` is how many pages link to it with a `template` scope link, and it is 0 unless that is at least half of the nodes (`SITEWIDE_SHARE = 0.5`).
- **G5 Counts.** `links_in` and `links_out` of a node are the number of edges into and out of it, from the folded edges. They are not the stored `linking_pages_*` counters, which count a redirect as its own page and do not add scopes together.
- **G6 Size cap.** `max_pages` (default 3,000, from 100 to 5,000) bounds the nodes. Over it, the nodes with the most edges are kept (ties: lower `url_id` first), `truncated` is true, and an edge is returned only when both its pages are kept. `links_in` and `links_out` stay the full counts. Measured on 2026-11-26: the browser draws 2,000 pages in 113 ms and zooms at 38 ms a step, 5,000 pages at 133 ms a step, so 3,000 is the default the web asks for.
- **G7 Errors and permission.** `data:read`. `404 not_found` for a project outside the workspace, `404 no_crawl` before a finished crawl, `410 links_dropped` for a crawl whose links were dropped: the same three as `GET .../neighbors`, by the same two calls (`read_scope`, `scope.require_links()`).

## Contract

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/graph`

| Query | Type | Default | Meaning |
|---|---|---|---|
| `run` | `latest` or a crawl id | `latest` | The crawl. |
| `include_auto` | bool | `false` | Draw auto-generated links (previous, next, related) as edges too. |
| `max_pages` | int, 100 to 5000 | `3000` | The most nodes returned (G6). |

Response `LinkGraphResponse`: `{ "data": LinkGraph }`.

| `LinkGraph` field | Type | Meaning |
|---|---|---|
| `run_id` | uuid | The crawl read. |
| `include_auto` | bool | As asked. |
| `pages_total` | int | Nodes the crawl has before the cap. |
| `truncated` | bool | `pages_total` is more than the nodes returned. |
| `home_url_id` | string or null | The node the crawl started from (the start page, through G2), null when it is not a node. |
| `nodes` | `GraphNode[]` | Most edges first, then `url_id`. |
| `edges` | `GraphEdge[]` | Ordered by source then target. |

`GraphNode`: `url_id` (string, as every url id of this API), `path`, `title` (string or null), `tier_id` (uuid or null: null is Untiered), `links_in`, `links_out`, `sitewide_from`.

`GraphEdge`: `source`, `target` (url ids as strings), `links` (int, at least 1).

The workspace's tiers are not repeated here: the web already has them (`GET .../page-tiers`).

## File structure

| File | Responsibility |
|---|---|
| Create `backend/src/idraft/api/internal_links/graph.py` | The pure fold: `build_graph` and its small input and output dataclasses. No database, no FastAPI. |
| Create `backend/tests/api/internal_links/test_graph_fold.py` | Unit tests of `build_graph`. |
| Modify `backend/src/idraft/api/schemas/internal_links.py` | `GraphNode`, `GraphEdge`, `LinkGraph`, `LinkGraphResponse`. |
| Modify `backend/src/idraft/api/internal_links/reads.py` | `LinkReadService.graph`: three statements, then `build_graph`. |
| Modify `backend/src/idraft/api/internal_links/read_routes.py` | The route. |
| Create `backend/tests/api/internal_links/test_reads_graph.py` | API tests on the seeded site. |
| Modify `backend/tests/security/test_cross_tenant.py` | The route in the cross-tenant table. |
| Modify `backend/openapi/v1.json` | Regenerated. |

---

### Task 1: The pure fold

**Files:**
- Create: `backend/src/idraft/api/internal_links/graph.py`
- Test: `backend/tests/api/internal_links/test_graph_fold.py`

- [ ] **Step 1: Write the failing tests**

```python
"""The Link map's graph: which pages are nodes, how links fold into edges (plan 10, G1 to G6)."""

from __future__ import annotations

from idraft.api.internal_links.graph import GraphLink, GraphPage, TemplateLinks, build_graph

HOME, PRICING, BLOG, POST_A, POST_B, OLD, GONE, VARIANT = range(1, 9)


def _pages() -> list[GraphPage]:
    def page(url_id: int, path: str, status: int = 200, **more: object) -> GraphPage:
        return GraphPage(
            url_id=url_id,
            path=path,
            title=None,
            status_code=status,
            redirect_url_id=more.get("redirect"),  # type: ignore[arg-type]
            is_variant=bool(more.get("variant", False)),
            tier_id=None,
        )

    return [
        page(HOME, "/"),
        page(PRICING, "/pricing"),
        page(BLOG, "/blog"),
        page(POST_A, "/blog/a"),
        page(POST_B, "/blog/b"),
        page(OLD, "/old", 301, redirect=PRICING),
        page(GONE, "/gone", 404),
        page(VARIANT, "/blog/a?x=1", variant=True),
    ]


def _links() -> list[GraphLink]:
    return [
        GraphLink(BLOG, POST_A, 1),
        GraphLink(BLOG, POST_B, 2),
        GraphLink(POST_A, PRICING, 1),
        GraphLink(PRICING, POST_A, 1),
        GraphLink(POST_B, OLD, 1),
        GraphLink(POST_B, GONE, 1),
        GraphLink(POST_A, POST_A, 1),
        GraphLink(VARIANT, PRICING, 1),
    ]


def test_only_live_pages_that_count_are_nodes() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=100)

    assert {node.url_id for node in graph.nodes} == {HOME, PRICING, BLOG, POST_A, POST_B}
    assert graph.pages_total == 5
    assert graph.truncated is False
    assert graph.home_url_id == HOME


def test_a_link_to_a_redirect_is_a_link_to_the_page_it_leads_to() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=100)

    edges = {(edge.source, edge.target): edge.links for edge in graph.edges}
    assert edges == {
        (BLOG, POST_A): 1,
        (BLOG, POST_B): 2,
        (POST_A, PRICING): 1,
        (PRICING, POST_A): 1,
        (POST_B, PRICING): 1,
    }


def test_counts_are_edges_in_and_out_after_the_fold() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=100)

    counts = {node.url_id: (node.links_in, node.links_out) for node in graph.nodes}
    assert counts == {
        HOME: (0, 0),
        PRICING: (2, 1),
        BLOG: (0, 2),
        POST_A: (2, 1),
        POST_B: (1, 1),
    }


def test_two_links_that_fold_onto_one_pair_add_up() -> None:
    links = [GraphLink(POST_B, OLD, 1), GraphLink(POST_B, PRICING, 3)]

    graph = build_graph(_pages(), links, [], home_url_id=HOME, max_pages=100)

    assert [(edge.source, edge.target, edge.links) for edge in graph.edges] == [(POST_B, PRICING, 4)]


def test_a_redirect_chain_is_followed_and_a_loop_ends() -> None:
    pages = [
        GraphPage(1, "/a", None, 301, 2, False, None),
        GraphPage(2, "/b", None, 301, 3, False, None),
        GraphPage(3, "/c", None, 200, None, False, None),
        GraphPage(4, "/loop-1", None, 301, 5, False, None),
        GraphPage(5, "/loop-2", None, 301, 4, False, None),
        GraphPage(6, "/from", None, 200, None, False, None),
    ]
    links = [GraphLink(6, 1, 1), GraphLink(6, 4, 1)]

    graph = build_graph(pages, links, [], home_url_id=None, max_pages=100)

    assert [(edge.source, edge.target) for edge in graph.edges] == [(6, 3)]


def test_a_page_in_the_menu_of_at_least_half_the_pages_is_sitewide() -> None:
    template = [TemplateLinks(PRICING, 3), TemplateLinks(BLOG, 2), TemplateLinks(OLD, 1)]

    graph = build_graph(_pages(), _links(), template, home_url_id=HOME, max_pages=100)

    sitewide = {node.url_id: node.sitewide_from for node in graph.nodes}
    # 5 nodes: half is 2.5. /old leads to /pricing, so its one page is added to /pricing's three.
    assert sitewide == {HOME: 0, PRICING: 4, BLOG: 0, POST_A: 0, POST_B: 0}


def test_over_the_cap_the_pages_with_the_most_edges_stay() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=3)

    assert [node.url_id for node in graph.nodes] == [PRICING, POST_A, BLOG]
    assert graph.pages_total == 5
    assert graph.truncated is True
    assert {(edge.source, edge.target) for edge in graph.edges} == {
        (BLOG, POST_A),
        (POST_A, PRICING),
        (PRICING, POST_A),
    }
    # The counts of a kept page are still its real counts
    assert next(node for node in graph.nodes if node.url_id == BLOG).links_out == 2


def test_the_start_page_is_named_through_a_redirect_and_dropped_when_not_a_node() -> None:
    assert build_graph(_pages(), [], [], home_url_id=OLD, max_pages=100).home_url_id == PRICING
    assert build_graph(_pages(), [], [], home_url_id=GONE, max_pages=100).home_url_id is None
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `backend/`): `uv run pytest tests/api/internal_links/test_graph_fold.py -n 0 --no-cov -q`
Expected: collection error, `ModuleNotFoundError: No module named 'idraft.api.internal_links.graph'`.

- [ ] **Step 3: Write the implementation**

```python
"""The Link map's graph from a crawl's stored pages and links (plan 10). Pure: no database.

A node is a live page that counts (status 200, not a variant). A link to a redirect is a link to
the page the redirect leads to. One edge per page pair. Menu and footer links are never edges:
they are a count on the page they point to, kept only when at least half the pages have it."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

SITEWIDE_SHARE: Final = 0.5
REDIRECT_HOPS: Final = 5


@dataclass(frozen=True, slots=True)
class GraphPage:
    url_id: int
    path: str
    title: str | None
    status_code: int | None
    redirect_url_id: int | None
    is_variant: bool
    tier_id: UUID | None


@dataclass(frozen=True, slots=True)
class GraphLink:
    """Links from one page to another in the scopes drawn; `links` is how many."""

    source: int
    target: int
    links: int


@dataclass(frozen=True, slots=True)
class TemplateLinks:
    """How many pages link to `target` from a menu, header, footer, sidebar or breadcrumb."""

    target: int
    sources: int


@dataclass(frozen=True, slots=True)
class BuiltNode:
    url_id: int
    path: str
    title: str | None
    tier_id: UUID | None
    links_in: int
    links_out: int
    sitewide_from: int


@dataclass(frozen=True, slots=True)
class BuiltGraph:
    pages_total: int
    truncated: bool
    home_url_id: int | None
    nodes: list[BuiltNode]
    edges: list[GraphLink]


def build_graph(
    pages: Sequence[GraphPage],
    links: Iterable[GraphLink],
    template: Iterable[TemplateLinks],
    *,
    home_url_id: int | None,
    max_pages: int,
) -> BuiltGraph:
    by_id = {page.url_id: page for page in pages}
    live = {page.url_id for page in pages if page.status_code == 200 and not page.is_variant}

    def resolve(url_id: int | None) -> int | None:
        """The node a url id stands for: itself, or the page its redirects lead to."""
        for _ in range(REDIRECT_HOPS + 1):
            if url_id is None or url_id in live:
                return url_id
            page = by_id.get(url_id)
            url_id = None if page is None else page.redirect_url_id
        return None

    edges: Counter[tuple[int, int]] = Counter()
    for link in links:
        target = resolve(link.target)
        if link.source in live and target is not None and target != link.source:
            edges[(link.source, target)] += link.links

    links_in: Counter[int] = Counter(target for _, target in edges)
    links_out: Counter[int] = Counter(source for source, _ in edges)

    template_sources: Counter[int] = Counter()
    for row in template:
        target = resolve(row.target)
        if target is not None:
            template_sources[target] += row.sources
    floor = SITEWIDE_SHARE * len(live)

    ranked = sorted(live, key=lambda url_id: (-(links_in[url_id] + links_out[url_id]), url_id))
    kept = ranked[:max_pages]
    kept_set = set(kept)
    nodes = [
        BuiltNode(
            url_id=url_id,
            path=by_id[url_id].path,
            title=by_id[url_id].title,
            tier_id=by_id[url_id].tier_id,
            links_in=links_in[url_id],
            links_out=links_out[url_id],
            # A redirect and its target can both be in a menu: never more pages than there are
            sitewide_from=(
                min(template_sources[url_id], len(live))
                if template_sources[url_id] >= floor
                else 0
            ),
        )
        for url_id in kept
    ]
    return BuiltGraph(
        pages_total=len(live),
        truncated=len(live) > len(kept),
        home_url_id=resolve(home_url_id),
        nodes=nodes,
        edges=[
            GraphLink(source, target, count)
            for (source, target), count in sorted(edges.items())
            if source in kept_set and target in kept_set
        ],
    )
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run pytest tests/api/internal_links/test_graph_fold.py -n 0 --no-cov -q`
Expected: `8 passed`.

- [ ] **Step 5: Lint, types, commit**

Run: `uv run ruff check src/idraft/api/internal_links/graph.py tests/api/internal_links/test_graph_fold.py && uv run ruff format --check src/idraft/api/internal_links/graph.py tests/api/internal_links/test_graph_fold.py && uv run mypy src/idraft/api/internal_links/graph.py`
Expected: no findings.

```bash
git add backend/src/idraft/api/internal_links/graph.py backend/tests/api/internal_links/test_graph_fold.py
git commit -m "Link map: fold a crawl's pages and links into the map's graph"
```

- [ ] **Step 6: Independent review (Sonnet)** of this commit against G1 to G6. Fix what it finds, commit, move on.

---

### Task 2: Response models

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (after `TierFlowResponse`, near line 616)

- [ ] **Step 1: Add the models**

```python
class GraphNode(BaseModel):
    url_id: UrlIdText
    path: str
    title: str | None
    tier_id: UUID | None = Field(description="The page's tier; null is Untiered.")
    links_in: int = Field(description="Pages that link to it in the scopes drawn, redirects folded.")
    links_out: int = Field(description="Pages it links to in the scopes drawn, redirects folded.")
    sitewide_from: int = Field(
        description="Pages that link to it from a menu, header, footer, sidebar or breadcrumb; "
        "0 unless that is at least half the pages. Those links are never edges."
    )


class GraphEdge(BaseModel):
    source: UrlIdText
    target: UrlIdText
    links: int = Field(ge=1, description="How many links the source has to the target.")


class LinkGraph(BaseModel):
    run_id: UUID
    include_auto: bool
    pages_total: int = Field(description="Live pages that count in the crawl, before `max_pages`.")
    truncated: bool = Field(description="True when `pages_total` is more than the nodes returned.")
    home_url_id: UrlIdText | None = Field(description="The page the crawl started from.")
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class LinkGraphResponse(BaseModel):
    data: LinkGraph
```

`UrlIdText` is defined lower in the same file (near line 326). Move the four classes below it if the import order requires it; keep them together.

- [ ] **Step 2: Check and commit**

Run: `uv run ruff check src/idraft/api/schemas/internal_links.py && uv run mypy src/idraft/api/schemas/internal_links.py`
Expected: no findings.

```bash
git add backend/src/idraft/api/schemas/internal_links.py
git commit -m "Link map: response models of the graph read"
```

---

### Task 3: The read and its route

**Files:**
- Modify: `backend/src/idraft/api/internal_links/reads.py` (a method on `LinkReadService`, after `tier_flow`)
- Modify: `backend/src/idraft/api/internal_links/read_routes.py` (after the `/tier-flow` route)
- Test: `backend/tests/api/internal_links/test_reads_graph.py`

The seeded site (`tests/api/internal_links/support.py`, `READ_PAGES`, `READ_LINKS`, `read_site`): pages `/`, `/pricing`, `/blog`, `/blog/a`, `/blog/b` are 200, `/old` is a 301 that `read_site` points at `/pricing`, `/gone` is a 404. `/pricing` is a manual T1 and `/blog/a` a manual T3. Editorial links: `/blog` to `/blog/a` and `/blog/b`, `/blog/a` to `/pricing`, `/pricing` to `/blog/a`, `/blog/b` to `/old` and `/gone`. Auto-generated: `/blog/a` to `/blog/b` and back. Navigation: `/` to `/pricing` and `/blog`.

- [ ] **Step 1: Write the failing tests**

```python
"""The Link map's graph read (plan 10)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _graph(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, **query: object
) -> tuple[dict[str, object], dict[str, int], list[object]]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, tiers = await read_site(migrated, workspace, project)
    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"),
        params={key: str(value).lower() for key, value in query.items()},
        headers=viewer.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["data"], ids, tiers


async def test_the_graph_has_the_live_pages_and_the_editorial_links_with_redirects_folded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, ids, tiers = await _graph(api, resources, migrated)
    path_of = {str(url_id): path for path, url_id in ids.items()}

    assert {path_of[node["url_id"]] for node in data["nodes"]} == {
        "/",
        "/pricing",
        "/blog",
        "/blog/a",
        "/blog/b",
    }
    assert {(path_of[edge["source"]], path_of[edge["target"]]) for edge in data["edges"]} == {
        ("/blog", "/blog/a"),
        ("/blog", "/blog/b"),
        ("/blog/a", "/pricing"),
        ("/pricing", "/blog/a"),
        ("/blog/b", "/pricing"),
    }
    assert data["pages_total"] == 5
    assert data["truncated"] is False
    assert data["include_auto"] is False
    by_path = {path_of[node["url_id"]]: node for node in data["nodes"]}
    assert (by_path["/pricing"]["links_in"], by_path["/pricing"]["links_out"]) == (2, 1)
    assert (by_path["/"]["links_in"], by_path["/"]["links_out"]) == (0, 0)
    assert by_path["/pricing"]["tier_id"] == str(tiers[0])
    assert by_path["/blog/a"]["tier_id"] == str(tiers[2])
    assert by_path["/blog"]["tier_id"] is None
    # Two navigation links from one page: nowhere near half of five pages
    assert all(node["sitewide_from"] == 0 for node in data["nodes"])
    # Every url id is a string, as on the other reads
    assert all(isinstance(node["url_id"], str) for node in data["nodes"])


async def test_auto_generated_links_are_edges_only_when_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, ids, _ = await _graph(api, resources, migrated, include_auto=True)
    path_of = {str(url_id): path for path, url_id in ids.items()}

    edges = {(path_of[edge["source"]], path_of[edge["target"]]) for edge in data["edges"]}
    assert ("/blog/a", "/blog/b") in edges
    assert ("/blog/b", "/blog/a") in edges
    assert data["include_auto"] is True


async def test_max_pages_outside_100_to_5000_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    for value in ("99", "5001"):
        response = await api.get(
            project_url(workspace, project, "internal-links", "graph"),
            params={"max_pages": value},
            headers=viewer.headers,
        )
        assert response.status_code == 422


async def test_a_project_without_a_crawl_answers_no_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"), headers=viewer.headers
    )

    assert response.status_code == 404
    assert response.json()["code"] == "no_crawl"
```

Add a fifth test for `410 links_dropped`: open `tests/api/internal_links/test_older_crawls.py`, find how it makes a crawl whose links were dropped (it sets `seo.crawl_runs.links_dropped_at`), and assert that `GET .../graph?run=<that crawl id>` answers 410 with `code == "links_dropped"`, using the same helper that file uses.

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/api/internal_links/test_reads_graph.py -n 0 --no-cov -q`
Expected: the graph tests fail with 404 (no such route).

- [ ] **Step 3: Add the service method**

In `reads.py`, extend the imports:

```python
from idraft.api.internal_links.graph import GraphLink, GraphPage, TemplateLinks, build_graph
from idraft.api.schemas.internal_links import GraphEdge, GraphNode, LinkGraph
```

Then, on `LinkReadService`, after `tier_flow`:

```python
    async def graph(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        include_auto: bool,
        max_pages: int,
    ) -> LinkGraph:
        """The whole crawl as the Link map draws it (plan 10): three aggregates, one snapshot."""
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            home: int | None = (
                await db.execute(
                    select(crawl_runs.c.start_url_id).where(
                        crawl_runs.c.workspace_id == access.workspace_id,
                        crawl_runs.c.id == scope.run_id,
                    )
                )
            ).scalar_one()
            pages = [
                GraphPage(
                    url_id=row.url_id,
                    path=row.path,
                    title=row.title,
                    status_code=row.status_code,
                    redirect_url_id=row.redirect_url_id,
                    is_variant=row.variant_of_url_id is not None,
                    tier_id=row.tier_id,
                )
                for row in await db.execute(
                    select(
                        crawl_pages.c.url_id,
                        urls.c.path,
                        crawl_pages.c.title,
                        crawl_pages.c.status_code,
                        crawl_pages.c.redirect_url_id,
                        crawl_pages.c.variant_of_url_id,
                        project_pages.c.tier_id,
                    )
                    .select_from(page_rows(scope))
                    .where(
                        crawl_pages.c.workspace_id == scope.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                    )
                )
            ]
            of_run = and_(
                crawl_links.c.workspace_id == scope.workspace_id,
                crawl_links.c.run_id == scope.run_id,
                crawl_links.c.ignored.is_(False),
            )
            drawn = [LinkScope.EDITORIAL.value]
            if include_auto:
                drawn.append(LinkScope.AUTO_GENERATED.value)
            links = [
                GraphLink(row.source_url_id, row.target_url_id, int(row.links))
                for row in await db.execute(
                    select(
                        crawl_links.c.source_url_id,
                        crawl_links.c.target_url_id,
                        func.sum(crawl_links.c.occurrences).label("links"),
                    )
                    .where(of_run, crawl_links.c.scope.in_(drawn))
                    .group_by(crawl_links.c.source_url_id, crawl_links.c.target_url_id)
                )
            ]
            template = [
                TemplateLinks(row.target_url_id, row.sources)
                for row in await db.execute(
                    select(
                        crawl_links.c.target_url_id,
                        func.count(func.distinct(crawl_links.c.source_url_id)).label("sources"),
                    )
                    .where(of_run, crawl_links.c.scope == LinkScope.TEMPLATE.value)
                    .group_by(crawl_links.c.target_url_id)
                )
            ]
        built = build_graph(pages, links, template, home_url_id=home, max_pages=max_pages)
        return LinkGraph(
            run_id=scope.run_id,
            include_auto=include_auto,
            pages_total=built.pages_total,
            truncated=built.truncated,
            home_url_id=None if built.home_url_id is None else str(built.home_url_id),
            nodes=[
                GraphNode(
                    url_id=str(node.url_id),
                    path=node.path,
                    title=node.title,
                    tier_id=node.tier_id,
                    links_in=node.links_in,
                    links_out=node.links_out,
                    sitewide_from=node.sitewide_from,
                )
                for node in built.nodes
            ],
            edges=[
                GraphEdge(source=str(edge.source), target=str(edge.target), links=edge.links)
                for edge in built.edges
            ],
        )
```

`select`, `and_`, `func`, `crawl_runs`, `crawl_pages`, `crawl_links`, `urls`, `project_pages`, `page_rows`, `LinkScope` and `read_scope` are already imported in this file; add any of `func` or `and_` that is missing from the `sqlalchemy` import block. If the page list uses a different column for the address path than `urls.c.path`, use the one `_page_select` in this file uses.

- [ ] **Step 4: Add the route**

In `read_routes.py`, add `LinkGraphResponse` to the schema imports, then after the `/tier-flow` route:

```python
@router.get(
    "/graph",
    summary="The whole crawl as a graph, for the Link map",
    description="Every live page that counts as a node and one edge per page pair that links in "
    "the body (and by auto-generated blocks with `include_auto`). A link to a redirect is a link "
    "to the page it leads to. Menu and footer links are not edges: `sitewide_from` on a node says "
    "how many pages have one, when that is at least half. Over `max_pages` the pages with the "
    "most edges are kept and `truncated` is true.",
)
async def graph(
    project_id: UUID,
    access: ReadData,
    reads: Reads,
    run: Run = "latest",
    include_auto: Annotated[bool, Query()] = False,
    max_pages: Annotated[int, Query(ge=100, le=5_000)] = 3_000,
) -> LinkGraphResponse:
    return LinkGraphResponse(
        data=await reads.graph(
            access, project_id, run=_run(run), include_auto=include_auto, max_pages=max_pages
        )
    )
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `uv run pytest tests/api/internal_links/test_reads_graph.py tests/api/internal_links/test_graph_fold.py -n 0 --no-cov -q`
Expected: all pass. If `home_url_id` matters to a later assertion, note that `seed_crawl` may leave `start_url_id` null; that is why the tests above do not assert it.

- [ ] **Step 6: Lint, types, commit**

Run: `uv run ruff check src/idraft/api/internal_links tests/api/internal_links/test_reads_graph.py && uv run ruff format --check src/idraft/api/internal_links tests/api/internal_links/test_reads_graph.py && uv run mypy src/idraft/api/internal_links`
Expected: no findings.

```bash
git add backend/src/idraft/api/internal_links/reads.py backend/src/idraft/api/internal_links/read_routes.py backend/tests/api/internal_links/test_reads_graph.py
git commit -m "Link map: GET internal-links/graph returns the crawl as nodes and edges"
```

- [ ] **Step 7: Independent review (Sonnet)** of tasks 2 and 3: the contract table above against the code, the three statements against row-level security (every statement filters by `workspace_id` and `run_id`), and the error cases of G7.

---

### Task 4: Tenant isolation and size

**Files:**
- Modify: `backend/tests/security/test_cross_tenant.py`
- Modify: `backend/tests/api/internal_links/test_reads_isolation.py` if it lists the read routes one by one (read it first)

- [ ] **Step 1: Add the route to the cross-tenant table.** Open `tests/security/test_cross_tenant.py`, find the entry for `("GET", _W + "/projects/{project_id}/internal-links/neighbors")` (near line 530) and add the graph route beside it in the same form:

```python
    ("GET", _W + "/projects/{project_id}/internal-links/graph"): {},
```

Use the exact value shape the neighbouring `GET` entries without required parameters use (an empty mapping, or the file's own marker for "no query").

- [ ] **Step 2: Run the two files**

Run: `uv run pytest tests/security/test_cross_tenant.py tests/api/internal_links/test_reads_isolation.py -n 0 --no-cov -q`
Expected: all pass, including the new route (a member of another workspace gets `404`).

- [ ] **Step 3: Time the read on the real crawl, once.** With the local database seeded with the Eventus crawl (the S-18 seed, 420 pages and about 15,000 links), call the route 5 times and note the server time from the access log. Expected: under 100 ms. Write the number in the "Built, with notes" section at the end of this file. If it is over 300 ms, stop and report before task 5.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/security/test_cross_tenant.py backend/tests/api/internal_links/test_reads_isolation.py
git commit -m "Link map: the graph read is in the cross-tenant checks"
```

---

### Task 5: Contract

**Files:**
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Regenerate**

Run (from `backend/`): `uv run python -m idraft.api.openapi > openapi/v1.json`

- [ ] **Step 2: Check**

Run: `uv run pytest tests/api/test_openapi.py -n 0 --no-cov -q`
Expected: pass. `git diff --stat openapi/v1.json` shows only the new path and the four new schemas.

- [ ] **Step 3: Commit, merge, tell the web session**

```bash
git add backend/openapi/v1.json
git commit -m "Link map: OpenAPI document with the graph read"
```

Merge `feat/link-map-backend` into `develop` and push `origin/develop` (never `main`). Then remove the worktree with `git worktree remove .claude/worktrees/link-map-backend` (keep the branch) and tell the web session that plan 11 can start with `pnpm gen:api`.

---

## Open points

- **P1.** `links` on an edge sums `occurrences`. If the Links tab counts a repeated link once, say so here and switch to `count(*)`; the web only shows the number in a tooltip.
- **P2.** A crawl over 5,000 live pages can never return every page. The web shows "the 3,000 most linked pages of N". A map of sections (one node per folder) is the later answer and is not in this plan.

## Done means

- The four test files of this plan pass, run serially.
- `ruff`, `ruff format --check` and `mypy` are clean on the files touched.
- `openapi/v1.json` is regenerated and its test passes.
- The read answers under 100 ms on the Eventus crawl (task 4, step 3).
- `develop` has the work and is pushed; nothing is released.

## Built, with notes

(The builder writes here: what was built, the timing of task 4, and anything that differed from the plan.)
