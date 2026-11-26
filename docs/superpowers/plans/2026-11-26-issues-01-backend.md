# Issues page, backend: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API of the Issues page: the list of checks with counts and the summary strip, and the pages of one
check, for the 29 checks that run on data the app already stores.

**Architecture:** Each check is one SQL condition on a row of `seo.crawl_pages` of the crawl in view
(`backend/src/idraft/api/issues/rules.py`). The list endpoint evaluates every condition once per page in a
subquery and aggregates. The pages of a check are the existing internal links Pages list with one more filter.
Nothing is stored and no worker changes. Spec: `docs/superpowers/specs/2026-11-26-issues-page-design.md`
(sections 3 to 6 and 11).

**Tech stack:** Python 3.13, FastAPI, SQLAlchemy Core (async), pytest with testcontainers Postgres, `uv`.

---

## Rules for every task

- Work in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/issues-page-8b4da8` only. Use absolute
  paths in shell commands. Never touch `apps/web/design-preview/` or the main checkout.
- Write and change files with the Write and Edit tools, not shell heredocs.
- Machine load: run only the commands listed in the task, serially. No full suite, no `./check.sh`, no build.
  Leave no process running. Do not restart Colima.
- Backend test environment, in every shell that runs pytest:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

- Targeted checks (replace the paths with the files you changed):

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/issues-page-8b4da8/backend
uv run ruff check src/idraft/api/issues src/idraft/api/internal_links tests/api/issues
uv run ruff format --check src/idraft/api/issues src/idraft/api/internal_links tests/api/issues
uv run mypy src/idraft/api/issues src/idraft/api/internal_links tests/api/issues
uv run lint-imports
uv run pytest -n 0 --no-cov tests/api/issues
```

- When a route, a query parameter or a schema changes, regenerate the committed document in the same commit
  and run its test:

```bash
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest -n 0 --no-cov tests/api/test_openapi.py tests/api/test_route_access.py
```

- Writing rules for comments, docstrings, error titles and commit messages: short plain sentences, no em or en
  dashes, no attribution lines in commits.
- Follow the code around you: every statement names the workspace, modules start with a docstring that says
  what the module is for, constants are `Final`, no `Any` where a type is known.
- Commit on the branch `claude/issues-page-8b4da8` at the end of each task. Do not push.

## File structure

| File | Responsibility |
|---|---|
| `backend/src/idraft/api/issues/__init__.py` | Package docstring |
| `backend/src/idraft/api/issues/catalogue.py` | The 29 checks: id, tab, category, severity, found by, what the check needs. No SQL |
| `backend/src/idraft/api/issues/rules.py` | `condition(check_id, crawl, sources)`: the SQL condition of each check |
| `backend/src/idraft/api/issues/sources.py` | `Sources` and `read_sources`: the state of Search Console, rank checks and AI answers for a project |
| `backend/src/idraft/api/issues/details.py` | `issue_details`: the "what was found" values of the pages on one list page |
| `backend/src/idraft/api/issues/service.py` | `IssueService.checks`: counts, clicks, example path, summary, states |
| `backend/src/idraft/api/issues/routes.py` | `GET …/issues` (JSON and CSV) |
| `backend/src/idraft/api/schemas/issues.py` | Response models and the `CheckId` literal |
| `backend/src/idraft/api/internal_links/read_routes.py` | `filter[issue]` and `include=issue` on `GET …/internal-links/pages` |
| `backend/src/idraft/api/internal_links/reads.py` | `pages` and `pages_csv` take `issue` |
| `backend/src/idraft/api/schemas/internal_links.py` | `PageExtras.issue` |
| `backend/tests/api/issues/support.py` | `audit_site`: the seeded crawl with one known case per check |
| `backend/tests/api/issues/test_rules.py`, `test_checks.py`, `test_issue_pages.py`, `test_sources.py` | Tests |

---

### Task 1: The catalogue, the 24 crawl rules, and `filter[issue]` on the Pages list

**Files:**
- Create: `backend/src/idraft/api/issues/__init__.py`, `catalogue.py`, `rules.py`
- Create: `backend/src/idraft/api/schemas/issues.py` (only `CheckId` in this task)
- Modify: `backend/src/idraft/api/internal_links/reads.py` (`pages`, `pages_csv`),
  `backend/src/idraft/api/internal_links/read_routes.py` (`list_pages`)
- Create: `backend/tests/api/issues/__init__.py`, `support.py`, `test_rules.py`
- Modify: `backend/openapi/v1.json` (regenerated)

- [ ] **Step 1: Write the catalogue.** `catalogue.py`:

```python
"""The checks of the Issues page (spec docs/superpowers/specs/2026-11-26-issues-page-design.md,
section 3): what each one is, with no SQL. The order is the order the API lists them in: by
tab, then by category. Names and help texts are the web's (`apps/web/messages/en.json`)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

Tab = Literal["technical", "on_page"]
Severity = Literal["error", "warning", "notice"]
FoundBy = Literal["crawl", "ranks", "gsc", "ga4", "ai"]
# What a check needs besides the crawl's pages; without it the check does not run.
Need = Literal["sitemap", "links", "gsc", "ranks", "ai"]

TITLE_MAX: Final = 60
TITLE_MIN: Final = 30
PATH_MAX: Final = 115
DEPTH_MAX: Final = 3


@dataclass(frozen=True, slots=True)
class Check:
    id: str
    tab: Tab
    category: str
    severity: Severity
    found_by: FoundBy = "crawl"
    need: Need | None = None


CHECKS: Final[tuple[Check, ...]] = (
    Check("status-4xx", "technical", "status", "error"),
    Check("status-5xx", "technical", "status", "error"),
    Check("clicks-page-broken", "technical", "earning_pages", "error", "gsc", "gsc"),
    Check("rank-page-broken", "technical", "earning_pages", "error", "ranks", "ranks"),
    Check("cited-page-broken", "technical", "earning_pages", "error", "ai", "ai"),
    Check("clicks-page-orphan", "technical", "earning_pages", "warning", "gsc", "gsc"),
    Check("redirect-broken", "technical", "redirects", "error"),
    Check("redirect-chain", "technical", "redirects", "warning"),
    Check("links-to-redirect", "technical", "redirects", "warning"),
    Check("redirect-pages", "technical", "redirects", "notice"),
    Check("canonical-broken", "technical", "indexing", "error"),
    Check("noindex", "technical", "indexing", "warning"),
    Check("canonical-elsewhere", "technical", "indexing", "notice"),
    Check("sitemap-broken", "technical", "sitemap", "error", need="sitemap"),
    Check("sitemap-nonindexable", "technical", "sitemap", "warning", need="sitemap"),
    Check("not-in-sitemap", "technical", "sitemap", "notice", need="sitemap"),
    Check("broken-internal-links", "technical", "links", "error"),
    Check("orphans", "technical", "links", "warning"),
    Check("editorial-orphans", "technical", "links", "warning"),
    Check("links-to-nonindexable", "technical", "links", "warning"),
    Check("deep-pages", "technical", "links", "notice"),
    Check("nofollow-internal", "technical", "links", "notice", need="links"),
    Check("title-missing", "on_page", "titles", "error"),
    Check("title-duplicate", "on_page", "titles", "warning"),
    Check("title-long", "on_page", "titles", "notice"),
    Check("title-short", "on_page", "titles", "notice"),
    Check("url-format", "on_page", "addresses", "notice"),
    Check("url-long", "on_page", "addresses", "notice"),
    Check("off-target", "on_page", "keywords", "warning", "ranks", "ranks"),
)
BY_ID: Final = {check.id: check for check in CHECKS}
```

`schemas/issues.py` gets `CheckId = Literal[...]` with the same 29 ids, in the same order, and a test asserts
`get_args(CheckId) == tuple(check.id for check in CHECKS)`.

- [ ] **Step 2: Write the seeded crawl.** `tests/api/issues/support.py` exports
  `async def audit_site(pg, workspace, project_id) -> tuple[uuid.UUID, dict[str, int]]`. It calls
  `seed_crawl` from `tests/api/internal_links/support.py` with the pages and links below, then sets the other
  columns with one `UPDATE seo.crawl_pages … WHERE run_id = $1 AND url_id = $2` per page, and sets
  `seo.crawl_runs.sitemap_pages = 12` and `start_url_id` to the id of `/`. `seed_crawl` gives every page with
  status 200 the resource type `html`; set `/file.pdf` to `other` afterwards. Unless a column is named, a page
  has: a title of 30 to 60 characters that no other page has, `in_sitemap = true`, `is_indexable = true`,
  `click_depth = 1`, all flags false, all counters 0.

| Path | Status | Columns that differ |
|---|---|---|
| `/` | 200 | `click_depth = 0` |
| `/services` | 200 | title `Services`; `broken_outlinks = 1`, `redirect_outlinks = 1`, `non_indexable_outlinks = 1` |
| `/pricing` | 200 | title `Shared title of two different pages here`; `is_editorial_orphan = true`, `linking_pages_all = 1` |
| `/Plans_Old` | 200 | the same title as `/pricing`; `in_sitemap = false` |
| `/gone` | 404 | `linking_pages_all = 1` |
| `/error` | 500 | `in_sitemap = false` |
| `/private` | 403 | none (in the sitemap: a refused page must not be found by any check) |
| `/old` | 301 | `redirect_url_id` = `/older`; `in_sitemap = false` |
| `/older` | 301 | `redirect_url_id` = `/services`; `in_sitemap = false` |
| `/dead-end` | 301 | `redirect_url_id` = `/gone`; `in_sitemap = false` |
| `/services-copy` | 200 | title `Services`; `canonical_url_id` and `variant_of_url_id` = `/services`; `is_indexable = false`, `non_indexable_reason = 'canonical'`, `click_depth = NULL` |
| `/canon-dead` | 200 | `canonical_url_id` and `variant_of_url_id` = `/gone`; `is_indexable = false`, `non_indexable_reason = 'canonical'`; `in_sitemap = false`, `click_depth = NULL` |
| `/hidden` | 200 | `is_indexable = false`, `non_indexable_reason = 'meta_tag'` |
| `/lost` | 200 | title `''`; `is_orphan = true` |
| `/a/b/c/d` | 200 | `click_depth = 4` |
| `/long-title` | 200 | a title of 70 characters |
| `/caf%C3%A9-menu` | 200 | none (a percent escape is not a capital letter) |
| `/` + `x` 120 times | 200 | none |
| `/file.pdf` | 200 | `resource_type = 'other'`, title `NULL` |

Links (`SeedLink`): `/` to `/services` (content); `/` to `/pricing` (navigation); `/Plans_Old` to `/services`
(content, `followed=False`).

`support.py` also exports the expected answer, used by every test of this plan:

```python
LONG_PATH: Final = "/" + "x" * 120
EXPECTED: Final[dict[str, list[str]]] = {
    "status-4xx": ["/gone"],
    "status-5xx": ["/error"],
    "redirect-broken": ["/dead-end"],
    "redirect-chain": ["/old"],
    "links-to-redirect": ["/services"],
    "redirect-pages": ["/dead-end", "/old", "/older"],
    "canonical-broken": ["/canon-dead"],
    "noindex": ["/hidden"],
    "canonical-elsewhere": ["/canon-dead", "/services-copy"],
    "sitemap-broken": ["/gone"],
    "sitemap-nonindexable": ["/hidden", "/services-copy"],
    "not-in-sitemap": ["/Plans_Old"],
    "broken-internal-links": ["/services"],
    "orphans": ["/lost"],
    "editorial-orphans": ["/pricing"],
    "links-to-nonindexable": ["/services"],
    "deep-pages": ["/a/b/c/d"],
    "nofollow-internal": ["/Plans_Old"],
    "title-missing": ["/lost"],
    "title-duplicate": ["/Plans_Old", "/pricing"],
    "title-long": ["/long-title"],
    "title-short": ["/services"],
    "url-format": ["/Plans_Old"],
    "url-long": [LONG_PATH],
}
```

- [ ] **Step 3: Write the failing test.** `tests/api/issues/test_rules.py`, in the style of
  `tests/api/internal_links/test_reads_pages.py` (fixtures `api`, `resources`, `migrated`; `make_workspace`,
  `member(..., "viewer")`, `keyword_project`, `project_url`):

```python
@pytest.mark.parametrize("check_id", sorted(EXPECTED))
async def test_a_check_finds_exactly_its_pages(
    check_id: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    found = await api.get(
        url, params={"filter[issue]": check_id, "sort": "path", "limit": 200}, headers=viewer.headers
    )

    assert found.status_code == 200, found.text
    assert sorted(row["path"] for row in found.json()["data"]) == sorted(EXPECTED[check_id])
    assert found.json()["meta"]["total"] == len(EXPECTED[check_id])
```

Add: `test_an_unknown_issue_is_refused` (`filter[issue]=nope` answers 422 as the route's other invalid query
values do: read one existing test of an invalid `filter[status]` and assert the same shape);
`test_the_issue_filter_composes_with_search` (`filter[issue]=redirect-pages&q=old` gives `/old` and `/older`);
`test_nofollow_on_a_crawl_without_links_is_410` (set `links_dropped_at = now()` on the run, expect 410 and code
`links_dropped`); `test_check_ids_match_the_catalogue` (step 1).

- [ ] **Step 4: Run it and see it fail.**

```bash
uv run pytest -n 0 --no-cov tests/api/issues/test_rules.py -x
```

Expected: failures, because `filter[issue]` is an unknown query parameter (400 or 422).

- [ ] **Step 5: Write the rules.** `rules.py`. `crawl` is anything with `workspace_id`, `project_id` and
  `run_id` (a `PageScope` fits); do not import `page_filter` here, so that it can import this module later
  without a cycle. Conditions are written on `crawl_pages` and `urls` as the Pages list joins them
  (`page_filter.page_rows`).

```python
"""The checks of the Issues page as SQL conditions (spec section 4).

A condition is true for a row of `seo.crawl_pages` (joined with `core.urls`, as `page_rows`
joins them) that the check found. The list of checks counts with it and the Pages list filters
with it, so a check has one definition. Words used: a page is *counted* when it is not a variant
of another crawled page, *live* when it is counted, answered 200 and is HTML, *redirected* when
it is counted and answered 3xx, *broken* when it is counted and answered 400 or more, except the
statuses that only refuse the crawler (`crawl/status.py`)."""

from __future__ import annotations

from typing import Any, Final, Protocol
from uuid import UUID

from sqlalchemy import ColumnElement, and_, exists, false, func, or_, select
from sqlalchemy.orm import aliased

from idraft.api.issues.catalogue import DEPTH_MAX, PATH_MAX, TITLE_MAX, TITLE_MIN
from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.tables import crawl_links, crawl_pages, urls


class CrawlRef(Protocol):
    @property
    def workspace_id(self) -> UUID: ...
    @property
    def project_id(self) -> UUID: ...
    @property
    def run_id(self) -> UUID: ...


def _counted(page: Any) -> ColumnElement[bool]:
    return page.c.variant_of_url_id.is_(None)


def _html_ok(page: Any) -> ColumnElement[bool]:
    return and_(page.c.status_code == 200, page.c.resource_type == "html")


def _live(page: Any) -> ColumnElement[bool]:
    return and_(_counted(page), _html_ok(page))


def _is_redirect(status: Any) -> ColumnElement[bool]:
    return status.between(300, 399)


def _is_broken(status: Any) -> ColumnElement[bool]:
    return and_(status >= 400, status.not_in(BLOCKED_STATUSES))


def _redirected(page: Any) -> ColumnElement[bool]:
    return and_(_counted(page), _is_redirect(page.c.status_code))


def _broken(page: Any) -> ColumnElement[bool]:
    return and_(_counted(page), _is_broken(page.c.status_code))


def _unreachable(page: Any) -> ColumnElement[bool]:
    return or_(_redirected(page), _broken(page))


def _target_status(column: Any) -> Any:
    """The status of the row of the same crawl that `column` (a URL id of this row) names."""
    target = aliased(crawl_pages)
    return (
        select(target.c.status_code)
        .where(
            target.c.workspace_id == crawl_pages.c.workspace_id,
            target.c.run_id == crawl_pages.c.run_id,
            target.c.url_id == column,
        )
        .correlate(crawl_pages)
        .scalar_subquery()
    )


def title_key(page: Any) -> Any:
    return func.lower(func.btrim(func.coalesce(page.c.title, "")))


def titled(page: Any) -> ColumnElement[bool]:
    """A page whose title can be shared: live, indexable, with a title."""
    return and_(_live(page), page.c.is_indexable, title_key(page) != "")


def _shared_titles(crawl: CrawlRef) -> Any:
    other = aliased(crawl_pages)
    key = title_key(other)
    return (
        select(key)
        .where(
            other.c.workspace_id == crawl.workspace_id, other.c.run_id == crawl.run_id, titled(other)
        )
        .group_by(key)
        .having(func.count() > 1)
    )


_PATH_NO_ESCAPES: Final = func.regexp_replace(urls.c.path, "%[0-9A-Fa-f]{2}", "", "g")
HAS_CAPITALS: Final = _PATH_NO_ESCAPES.op("~")("[A-Z]")
HAS_UNDERSCORES: Final = func.strpos(urls.c.path, "_") > 0
TITLE_LENGTH: Final = func.char_length(func.btrim(func.coalesce(crawl_pages.c.title, "")))
NOFOLLOW_LINKS: Final = and_(
    crawl_links.c.workspace_id == crawl_pages.c.workspace_id,
    crawl_links.c.run_id == crawl_pages.c.run_id,
    crawl_links.c.source_url_id == crawl_pages.c.url_id,
    crawl_links.c.target_url_id != crawl_links.c.source_url_id,
    crawl_links.c.is_followed.is_(False),
    crawl_links.c.ignored.is_(False),
)


def _crawl_condition(check_id: str, crawl: CrawlRef) -> ColumnElement[bool] | None:
    page = crawl_pages
    status = page.c.status_code
    other_canonical = and_(
        _html_ok(page),
        page.c.canonical_url_id.is_not(None),
        page.c.canonical_url_id != page.c.url_id,
    )
    canonical_status = _target_status(page.c.canonical_url_id)
    redirect_status = _target_status(page.c.redirect_url_id)
    rules: dict[str, ColumnElement[bool]] = {
        "status-4xx": and_(_broken(page), status < 500),
        "status-5xx": and_(_broken(page), status >= 500),
        "redirect-broken": and_(_redirected(page), _is_broken(redirect_status)),
        "redirect-chain": and_(_redirected(page), _is_redirect(redirect_status)),
        "links-to-redirect": and_(_live(page), page.c.redirect_outlinks > 0),
        "redirect-pages": _redirected(page),
        "canonical-broken": and_(
            other_canonical, or_(_is_redirect(canonical_status), _is_broken(canonical_status))
        ),
        "noindex": and_(_live(page), page.c.non_indexable_reason.in_(("meta_tag", "http_header"))),
        "canonical-elsewhere": other_canonical,
        "sitemap-broken": and_(_unreachable(page), page.c.in_sitemap),
        "sitemap-nonindexable": and_(_html_ok(page), page.c.in_sitemap, page.c.is_indexable.is_(False)),
        "not-in-sitemap": and_(_live(page), page.c.is_indexable, page.c.in_sitemap.is_(False)),
        "broken-internal-links": and_(_live(page), page.c.broken_outlinks > 0),
        "orphans": and_(_live(page), page.c.is_orphan),
        "editorial-orphans": and_(_live(page), page.c.is_editorial_orphan),
        "links-to-nonindexable": and_(_live(page), page.c.non_indexable_outlinks > 0),
        "deep-pages": and_(_live(page), page.c.click_depth > DEPTH_MAX),
        "nofollow-internal": and_(_live(page), exists().where(NOFOLLOW_LINKS)),
        "title-missing": and_(_live(page), title_key(page) == ""),
        "title-duplicate": and_(titled(page), title_key(page).in_(_shared_titles(crawl))),
        "title-long": and_(_live(page), TITLE_LENGTH > TITLE_MAX),
        "title-short": and_(_live(page), title_key(page) != "", TITLE_LENGTH < TITLE_MIN),
        "url-format": and_(_live(page), or_(HAS_CAPITALS, HAS_UNDERSCORES)),
        "url-long": and_(_live(page), func.char_length(urls.c.path) > PATH_MAX),
    }
    return rules.get(check_id)


def condition(check_id: str, crawl: CrawlRef) -> ColumnElement[bool]:
    """The condition of a check. A check that reads another source matches nothing until task 4
    gives this function the sources."""
    found = _crawl_condition(check_id, crawl)
    return false() if found is None else found
```

Fix what mypy and ruff ask for (line length is 100) without changing a rule. If a rule and the spec's table
disagree, the spec wins: stop and report instead of choosing.

- [ ] **Step 6: Take `issue` in the Pages list.** In `reads.py`, `LinkReadService.pages` and `pages_csv` get a
  keyword argument `issue: str | None = None`. When it is set:

```python
if issue is not None:
    if BY_ID[issue].need == "links":
        scope.require_links()
    # The check says which variants count, so the list's own variant filter is off.
    found = found.model_copy(update={"include_variants": True})
conditions = page_conditions(found, scope)
if issue is not None:
    conditions.append(condition(issue, scope))
```

`issue` joins the cursor scope (`cursor_scope["issue"] = issue`), so a cursor of one check is refused on
another. In `read_routes.py`, `list_pages` gets
`issue: Annotated[CheckId | None, Query(alias="filter[issue]")] = None` and passes it to both calls.

- [ ] **Step 7: Run the tests, the targeted checks, regenerate OpenAPI** (commands in "Rules for every task").
  Also run `uv run pytest -n 0 --no-cov tests/api/internal_links/test_reads_pages.py tests/api/internal_links/test_reads_paging.py`
  to see the list is unchanged without the filter. Expected: all pass.

- [ ] **Step 8: Commit.**

```bash
git add backend/src/idraft/api/issues backend/src/idraft/api/schemas/issues.py backend/src/idraft/api/internal_links/reads.py backend/src/idraft/api/internal_links/read_routes.py backend/tests/api/issues backend/openapi/v1.json
git commit -m "Issues: the catalogue, the 24 crawl rules and filter[issue] on the Pages list"
```

---

### Task 2: The list of checks: counts, example, summary, states, CSV

**Files:**
- Create: `backend/src/idraft/api/issues/service.py`, `routes.py`
- Modify: `backend/src/idraft/api/schemas/issues.py`, `backend/src/idraft/api/resources.py`,
  `backend/src/idraft/api/main.py`, `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json`
- Create: `backend/tests/api/issues/test_checks.py`

- [ ] **Step 1: Schemas.** In `schemas/issues.py` (pydantic `BaseModel`, as `schemas/internal_links.py`):

```python
NotRunReason = Literal["source_not_connected", "not_collected", "no_sitemap", "links_dropped"]


class IssueCheck(BaseModel):
    id: CheckId
    tab: Literal["technical", "on_page"]
    category: str
    severity: Literal["error", "warning", "notice"]
    found_by: Literal["crawl", "ranks", "gsc", "ga4", "ai"]
    state: Literal["ran", "not_run"]
    reason: NotRunReason | None = Field(description="Why the check did not run; null when it ran.")
    pages: int | None = Field(description="Pages the check found; null when it did not run.")
    clicks: int | None = Field(
        description="Search Console clicks of those pages in the window; null when the check "
        "did not run or `meta.gsc.state` is not `ok`."
    )
    example_path: str | None


class IssueSummary(BaseModel):
    pages_crawled: int = Field(description="Every address of the crawl, variants included.")
    pages_with_issue: int
    pages_with_error: int
    pages_with_warning: int
    pages_with_notice: int
    checks_ran: int
    checks_passed: int


class IssueGsc(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    window_start: date | None
    window_end: date | None


class IssueMeta(BaseModel):
    run_id: UUID
    crawled_at: datetime | None
    links_available: bool
    gsc: IssueGsc


class IssueListResponse(BaseModel):
    data: list[IssueCheck]
    summary: IssueSummary
    meta: IssueMeta
```

- [ ] **Step 2: Write the failing tests** in `test_checks.py`, on `audit_site`, against
  `project_url(workspace, project, "issues")`:

1. `test_each_check_counts_its_pages`: for every id in `EXPECTED`, `pages == len(EXPECTED[id])`,
   `state == "ran"`, `example_path == min(EXPECTED[id])` or `None` when the list is empty. Compare paths as
   bytes (`min(..., key=str.encode)`).
2. `test_the_rows_come_in_catalogue_order`: the ids equal `[check.id for check in CHECKS]`.
3. `test_the_summary_counts_an_address_once`: with `by = lambda severity: {path for id, paths in EXPECTED.items()
   if BY_ID[id].severity == severity for path in paths}`: `pages_with_error == len(by("error"))`, the same for
   warning and notice, `pages_with_issue == len(by("error") | by("warning") | by("notice"))`,
   `pages_crawled == 19`, `checks_ran == 24`, `checks_passed == 0`.
4. `test_the_other_sources_do_not_run_yet`: the five checks with `found_by != "crawl"` have
   `state == "not_run"`, `pages is None`, `clicks is None`. (Task 4 replaces this test.)
5. `test_sitemap_checks_do_not_run_without_a_sitemap`: set `sitemap_pages = 0` on the run; the three sitemap
   checks are `not_run` with `reason == "no_sitemap"`, and `pages_with_error` no longer counts `/gone` through
   `sitemap-broken` (it still counts through `status-4xx`, so assert `checks_ran == 21`).
6. `test_nofollow_does_not_run_without_links`: set `links_dropped_at = now()`; `nofollow-internal` is
   `not_run` with `links_dropped`, and `meta.links_available is False`.
7. `test_no_crawl_is_404`: a project without a crawl answers 404 with code `no_crawl`.
8. `test_another_workspace_sees_nothing`: a member of another workspace gets 404 for this project (copy the
   pattern of `tests/api/internal_links/test_reads_isolation.py`).
9. `test_csv`: `format=csv` answers `text/csv` with the header
   `Tab,Category,Check,Severity,Found by,State,Pages,Clicks` and 29 rows.

- [ ] **Step 3: Run and see them fail** (`uv run pytest -n 0 --no-cov tests/api/issues/test_checks.py -x`,
  expected 404 for the unknown route).

- [ ] **Step 4: Write the service.** `IssueService(sessions)` with
  `async def checks(self, access, project_id, *, run) -> IssueList`, in a `workspace_transaction` as
  `LinkReadService._transaction`. Steps inside the transaction:

1. `scope = await read_scope(db, access, project_id, run)` (from `internal_links/reads.py`).
2. Read `sitemap_pages` and `finished_at` of the run from `seo.crawl_runs`.
3. Decide each check's state: `need == "sitemap"` and no sitemap pages gives `no_sitemap`;
   `need == "links"` and `scope.links_dropped` gives `links_dropped`; `need in ("gsc", "ranks", "ai")` gives
   `not_collected` in this task (task 4 reads the real state).
4. One query for every check that runs. Each condition is evaluated once per page, in a subquery:

```python
flags = (
    select(
        urls.c.path.label("path"),
        *(condition(check.id, scope).label(f"c{index}") for index, check in running),
    )
    .select_from(crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id))
    .where(crawl_pages.c.workspace_id == scope.workspace_id, crawl_pages.c.run_id == scope.run_id)
    .subquery("flags")
)
```

   then one aggregate row: `func.count()` (pages crawled); per check `func.count().filter(flags.c[f"c{index}"])`
   and `func.min(expression.collate(flags.c.path, "C")).filter(flags.c[f"c{index}"])`; per severity
   `func.count().filter(or_(*columns of that severity))`; and the same over every column for
   `pages_with_issue`. A severity with no running check counts 0 without a filter on an empty `or_`.
5. Build the rows in catalogue order. `clicks` is `None` in this task.

   Add above the query: `# shortcut: every read runs this aggregate over the crawl's pages; store the counts
   per crawl when a read takes over a second on a real crawl.`

- [ ] **Step 5: Routes and wiring.** `routes.py`: router prefix
  `/api/v1/workspaces/{workspace_id}/projects/{project_id}/issues`, tag `issues`, `GET ""` with `access:
  ReadData`, `run: Run = "latest"`, `output: Output = "json"` (copy the three annotated types from
  `internal_links/read_routes.py`), `response_model=IssueListResponse`, and the CSV through
  `internal_links/csv_export.csv_text` with the file name `issues`. Add `issues: IssueService` to `Resources`
  and build it in `main.py` beside `link_reads`; `app.include_router(issues_router)`. Add the route to the
  table of `tests/api/test_route_access.py` with the entry the internal links pages route has.

- [ ] **Step 6: Run the tests, the targeted checks, regenerate OpenAPI.** Expected: all pass.

- [ ] **Step 7: Commit.** `git commit -m "Issues: the list of checks with counts, the summary and the states"`

---

### Task 3: What was found per page: `include=issue` and the CSV columns

**Files:**
- Create: `backend/src/idraft/api/issues/details.py`, `backend/tests/api/issues/test_issue_pages.py`
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`PageExtras.issue`),
  `backend/src/idraft/api/schemas/issues.py` (`IssueDetail`), `backend/src/idraft/api/internal_links/reads.py`
  (`attach_extras`, `pages_csv`), `backend/src/idraft/api/internal_links/read_routes.py` (`include`),
  `backend/openapi/v1.json`

- [ ] **Step 1: Schema.**

```python
class IssueDetail(BaseModel):
    """What a check found on one page (spec section 4, last column). The web writes the sentence."""

    target_path: str | None = None
    target_status: int | None = None
    count: int | None = None
    reason: str | None = None
```

`PageExtras` gets `issue: IssueDetail | None = None`. The route's `include` literal gets `"issue"`
(`max_length=6`). `include=issue` without `filter[issue]` leaves `extras.issue` null.

- [ ] **Step 2: Write the failing tests** (`test_issue_pages.py`, on `audit_site`, each asks the Pages list with
  `filter[issue]=<id>&include=issue&sort=path`):

| Check | Page | Expected `extras.issue` |
|---|---|---|
| `status-4xx` | `/gone` | `count == 1` (linking pages) |
| `redirect-broken` | `/dead-end` | `target_path == "/gone"`, `target_status == 404` |
| `redirect-chain` | `/old` | `target_path == "/older"`, `target_status == 301` |
| `redirect-pages` | `/older` | `target_path == "/services"`, `target_status == 200` |
| `canonical-broken` | `/canon-dead` | `target_path == "/gone"`, `target_status == 404` |
| `canonical-elsewhere` | `/services-copy` | `target_path == "/services"` |
| `noindex` | `/hidden` | `reason == "meta_tag"` |
| `sitemap-nonindexable` | `/services-copy` | `reason == "canonical"` |
| `links-to-redirect`, `broken-internal-links`, `links-to-nonindexable` | `/services` | `count == 1` |
| `editorial-orphans` | `/pricing` | `count == 1` |
| `deep-pages` | `/a/b/c/d` | `count == 4` |
| `nofollow-internal` | `/Plans_Old` | `count == 1` |
| `title-duplicate` | `/pricing` | `count == 1`, `target_path == "/Plans_Old"` |
| `title-long` | `/long-title` | `count == 70` |
| `title-short` | `/services` | `count == 8` |
| `url-format` | `/Plans_Old` | `reason == "both"` |
| `url-long` | the long path | `count == 121` |
| `orphans`, `not-in-sitemap`, `title-missing`, `status-5xx`, `sitemap-broken` | their page | all four fields null |

Plus `test_the_csv_of_a_check_has_the_detail_columns`: `format=csv&filter[issue]=redirect-broken` has the Pages
header followed by `Found address,Found status,Found count,Found reason,Clicks`, and the `/dead-end` row ends
with `/gone,404,,,` (clicks empty: no Search Console). And `test_the_csv_without_a_check_is_unchanged`.

- [ ] **Step 3: Run and see them fail.**

- [ ] **Step 4: Write `details.py`.**
  `async def issue_details(db, scope, check_id, ids) -> dict[int, IssueDetail]`: one statement per call, over
  `crawl_pages` joined with `urls`, `WHERE workspace, run, url_id = ANY(ids)`, that selects
  `url_id, target_path, target_status, count, reason` for the check's kind. Use the same building blocks as
  `rules.py` (`TITLE_LENGTH`, `HAS_CAPITALS`, `HAS_UNDERSCORES`, `NOFOLLOW_LINKS`, `title_key`, `titled`), never
  a second definition:

| Checks | `target_path`, `target_status` | `count` | `reason` |
|---|---|---|---|
| `redirect-broken`, `redirect-chain`, `redirect-pages` | outer join `urls` and `crawl_pages` (same run) on `redirect_url_id` | | |
| `canonical-broken`, `canonical-elsewhere` | the same on `canonical_url_id` | | |
| `status-4xx`, `editorial-orphans` | | `linking_pages_all` | |
| `links-to-redirect` | | `redirect_outlinks` | |
| `broken-internal-links` | | `broken_outlinks` | |
| `links-to-nonindexable` | | `non_indexable_outlinks` | |
| `deep-pages` | | `click_depth` | |
| `title-long`, `title-short` | | `TITLE_LENGTH` | |
| `url-long` | | `char_length(path)` | |
| `nofollow-internal` | | scalar subquery `count(*)` over `NOFOLLOW_LINKS` | |
| `noindex`, `sitemap-nonindexable` | | | `non_indexable_reason` |
| `url-format` | | | `capitals`, `underscores` or `both` (a `case`) |
| `title-duplicate` | another page's path | pages with the same title minus one | |
| every other check | all null: return `{}` without a query | | |

  For `title-duplicate`, group the crawl's titled pages once (`title_key`, `count(*)`, `min(path)`,
  `max(path)`, all `COLLATE "C"`) and join on the key: the other path is `min` unless it is the row's own path,
  then `max`.

- [ ] **Step 5: Wire it.** `attach_extras(db, scope, rows, include, *, issue=None)` fills `issue=` when
  `"issue" in include and issue is not None`. `pages_csv` with `issue` set adds the five columns: read the
  details and the clicks (`extras.gsc_of`) in chunks of 5,000 ids. Keep the CSV without `issue` byte for byte.

- [ ] **Step 6: Run the tests** (`tests/api/issues`, `tests/api/internal_links/test_page_extras.py`,
  `tests/api/internal_links/test_reads_pages.py`), the targeted checks, regenerate OpenAPI.

- [ ] **Step 7: Commit.** `git commit -m "Issues: what was found per page (include=issue) and the CSV of a check"`

---

### Task 4: The five checks that join another source, and clicks

**Files:**
- Create: `backend/src/idraft/api/issues/sources.py`, `backend/tests/api/issues/test_sources.py`
- Modify: `backend/src/idraft/api/issues/rules.py`, `service.py`, `details.py`,
  `backend/src/idraft/api/internal_links/reads.py`, `backend/tests/api/issues/test_checks.py`,
  `backend/openapi/v1.json` (only if a description changed)

- [ ] **Step 1: Sources.**

```python
@dataclass(frozen=True, slots=True)
class Sources:
    gsc: GscScope          # `extras.gsc_window`: ok (with property and window), pending or not_connected
    ranks: bool            # a tracked keyword of the project (active, not deleted) has a rank check
    ai: bool               # the project has an answer that was not superseded


async def read_sources(db: AsyncSession, scope: PageScope) -> Sources: ...
```

`ranks` is `EXISTS` over `seo.tracked_keywords` joined with `seo.tracked_keyword_state` where
`last_observed_at IS NOT NULL`; `ai` is `EXISTS` over `ai.observations` where `superseded_by IS NULL`. Read the
column names in `backend/src/idraft/db/tables.py` and the two statements `_KEYWORDS` and `_CITATIONS` in
`api/internal_links/extras.py`: the rules below are those definitions (decisions D8 and D9) as conditions.

- [ ] **Step 2: Rules.** `condition(check_id, crawl, sources: Sources | None = None)`. With `sources` None, or
  a source that is not there, the five checks stay `false()`.

| Check | Condition |
|---|---|
| `clicks-page-broken` | `_unreachable(page)` and `EXISTS` a row of `fp.gsc_page_daily` for this workspace, project, property (`sources.gsc.integration_id`), `metric_date` in the window, `url_id` = the page, `clicks > 0` |
| `clicks-page-orphan` | `_live(page)`, `is_orphan`, and the same `EXISTS` |
| `rank-page-broken` | `_unreachable(page)` and `EXISTS` a tracked keyword (this workspace and project, `is_active`, `deleted_at IS NULL`) whose state has `current_rank IS NOT NULL` and `current_url_id` = the page |
| `off-target` | `_counted(page)` and `EXISTS` a tracked keyword (same filters) with `target_url_id` = the page, whose state has `current_rank IS NOT NULL`, `current_url_id IS NOT NULL` and `current_url_id <> target_url_id` |
| `cited-page-broken` | `_unreachable(page)` and `EXISTS` a row of `ai.citations` (this workspace and project, `url_id` = the page, `domain_role = 'own'`, `observed_at >= now() - interval '28 days'`) joined with its `ai.observations` row where `superseded_by IS NULL` |

- [ ] **Step 3: Service.** `checks` calls `read_sources` and gives each check its real state:

| `need` | `not_run` when | `reason` |
|---|---|---|
| `gsc` | `sources.gsc.state == "not_connected"` | `source_not_connected` |
| `gsc` | `sources.gsc.state == "pending"` | `not_collected` |
| `ranks` | `not sources.ranks` | `not_collected` |
| `ai` | `not sources.ai` | `not_collected` |

  When the Search Console state is `ok`, the `flags` subquery also selects each page's clicks
  (`coalesce(totals.clicks, 0)`, with the grouped subquery of `page_sort._clicks` outer joined), and each check
  gets `func.sum(flags.c.clicks).filter(column)`, 0 when it found nothing. `meta.gsc` carries the state and the
  window.

- [ ] **Step 4: Pages list.** In `LinkReadService.pages` and `pages_csv`, when `issue` names a check with
  `need in ("gsc", "ranks", "ai")`, read the sources and pass them to `condition`. `details.py`: `count` for
  `rank-page-broken` and `off-target` is the number of distinct keywords, for `cited-page-broken` the number of
  distinct answers; `clicks-page-*` have no detail (the Clicks cell shows the number through `include=gsc`).

- [ ] **Step 5: Tests** (`test_sources.py`). Seed with the helpers the existing tests use: find how
  `tests/api/internal_links/test_page_extras.py` seeds a Search Console property with page days, tracked
  keywords with a state row, and citations, and reuse those helpers (import them; do not copy them).

1. No property: the two `gsc` checks are `not_run` with `source_not_connected`; every `clicks` is null;
   `meta.gsc.state == "not_connected"`.
2. A property with a window and no stored page day: `not_collected`; `meta.gsc.state == "pending"`.
3. A property with page days: 40 clicks on `/gone`, 7 on `/lost`, 5 on `/services`. Then
   `clicks-page-broken` finds `/gone`, `clicks-page-orphan` finds `/lost`; `status-4xx` has `clicks == 40`;
   `broken-internal-links` has `clicks == 5`; `title-short` (which found `/services`) has `clicks == 5`; a check
   that found nothing has `clicks == 0`. The Pages list with `filter[issue]=redirect-pages&sort=-clicks` still
   pages by cursor.
4. No tracked keyword: `rank-page-broken` and `off-target` are `not_collected`.
5. A keyword that ranks with `/gone`, and one with target `/pricing` that ranks with `/services`:
   `rank-page-broken` finds `/gone` with `count == 1`; `off-target` finds `/pricing` with `count == 1`. A
   keyword without a rank finds nothing. A deleted or inactive keyword finds nothing.
6. No answer: `cited-page-broken` is `not_collected`. An answer of today that cites `/old` as an own page: the
   check finds `/old`. A citation 40 days old, or of a superseded answer, finds nothing.
7. The summary counts the pages of the five checks once they run (`checks_ran == 29` with every source there).

   Update `test_the_other_sources_do_not_run_yet` in `test_checks.py` to the new reasons.

- [ ] **Step 6: Run the tests** (`tests/api/issues`, `tests/api/internal_links/test_page_extras.py`,
  `tests/api/internal_links/test_reads_paging.py`), the targeted checks, and regenerate OpenAPI.

- [ ] **Step 7: Commit.** `git commit -m "Issues: the checks that join Search Console, rank checks and AI answers, and clicks"`

---

## Later slices (not built by this plan)

Each needs its own plan. Dependencies are in the spec, section 10.

| Slice | Backend work |
|---|---|
| 2: stored HTML | Migration: new columns on `seo.crawl_pages` (`description`, `h1_count`, `word_count`, `text_hash`, `images_without_alt`, `has_open_graph`, `jsonld_errors`, `hreflang`, `http_resources`). An extractor beside `crawl/head.py`, called where `crawl_ingest` reads the HTML and in `crawl_relink`. Eleven rules and catalogue rows. No provider call |
| 3: provider fields | Keep `page_timing` in `providers/dataforseo/on_page.py` and a column for it (`slow-pages`). Read one real crawl's links answer for external links before designing `broken-external-links`. `broken-images` needs `load_resources` on the crawl order and the owner's yes: it triples the crawl price |
| 4: Search Console | `position` in the page pull (`collectors/gsc_pages.py`) and in `fp.gsc_page_daily` (`low-ctr`). A URL Inspection collector for the pages you track (`google-not-indexed`), 2,000 calls a day per property |
| 5: Google Analytics | A GA4 report of sessions per landing page stored per page and day, then `visits-page-broken` as a join like task 4 |
| 6: Cannibalization row | The Cannibalization backend. Then a catalogue row of a new kind that carries a count of keywords and a link, not pages |
| 7: older crawls and new issues | Nothing new to store: `run` already takes a crawl id. Design first |
