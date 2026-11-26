# Page search detail and Monitoring, plan 01: backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store what the page Search tab and the Monitoring tab read (daily totals with position, page history, breakdowns by query, location and device, tracked pages) and serve it under `{P}/fp/tracked-pages` and `{P}/fp/page-search`.

**Architecture:** The existing bulk `[date, page]` pull gains position and the address strings Google used. One shared module makes two filtered reads of Google for a single page (history, breakdown) and stores them with a marker; the worker calls it for tracked pages inside the Search Console pass, the API calls it when a drawer asks. Health, periods and aggregation are pure functions. No new job, queue or schedule.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy Core (async), Pydantic, Alembic, pytest with Testcontainers.

Date: 2026-11-26. Branch: `claude/gsc-page-detail-monitoring-6f43c3`, worktree `.claude/worktrees/gsc-page-detail-monitoring-6f43c3`. Work only there. Spec: `docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md` (read sections 3, 5, 6, 7 and 8 before task 1). The web side is plan 02 and starts after task 10 of this plan.

## Rules for every task

- Builder: one Sonnet session, one task at a time. Haiku may do task 10 (the export). Never Opus or Fable.
- Each task ends with: independent senior review on Sonnet (give the reviewer the diff and the spec section, not your conclusion), fix the findings, targeted checks green, commit. Commit messages are plain sentences, with no attribution lines.
- Tests first. Targeted and serial only, from `backend/`:
  `uv run pytest -n 0 --no-cov <paths>`, `uv run ruff check <paths>`, `uv run ruff format --check <paths>`, `uv run mypy <paths>`. No full `./check.sh`, no full suite, no other session's containers stopped.
- Backend tests need Docker through Colima. Before the first test of a session:

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend && uv sync --frozen
```

  Never restart Colima and never stop `idraft-dev-*` containers.
- No call to Google or DataForSEO. Google is `tests/providers/google/fake_google.py` and `tests/collectors/gsc_support.py`.
- Edit files with the Edit and Write tools, not `sed` or heredocs.
- Do not edit files of other sessions: nothing under `backend/src/idraft/api/internal_links/`, `backend/src/idraft/api/issues/`, `backend/src/idraft/crawl/`. Read `core.project_pages`, `core.crawl_pages` and `core.crawl_runs` only.
- No em-dashes or en-dashes in any string, comment or document. No visible word "GSC" in a description a person reads in the API docs: write "Search Console".

## Decisions taken as given (spec section 3)

- **B1** Bulk totals keep `position_sum` and Google's address strings; rows are kept 16 months, and for tracked pages for good.
- **B2** Page history: one filtered `[date]` call per page, once, recorded by a `history` row in `fp.gsc_page_fetches`.
- **B3** Breakdown: three filtered calls per page and period (`query` limit 100, `country` limit 50, `device` limit 25), recorded by markers of kind `query`, `country`, `device`.
- **B4** The page filter is `includingRegex` over stored strings (`fp.gsc_page_forms`), at most 8, else a pattern from the canonical address.
- **B5** The API calls Google itself for a drawer, under its own budget, never waiting: no token means `429 gsc_busy`.
- **B6** Final data only; a period is cut to the last final day; at most 92 days.
- **B7** Only a page with a row in `core.project_pages` can be tracked or read. Limit 200 a project. `projects:write` to change, `data:read` to read.

## File structure

| File | Responsibility |
|---|---|
| Modify `backend/src/idraft/providers/google/client.py` | `DimensionFilter`; `search_analytics(filters=...)`. |
| Modify `backend/tests/collectors/gsc_support.py`, `backend/tests/providers/google/test_client.py` | The fake serves filtered reads and a position per page row. |
| Create `backend/src/idraft/db/migrations/versions/00NN_page_search.py`; modify `backend/src/idraft/db/tables.py` | Schema of spec section 6. |
| Modify `backend/tests/db/test_tables.py`, `test_grants.py`, `support.py`, `backend/tests/security/test_cross_tenant.py` | The new tables in the registrations every table has. |
| Modify `backend/src/idraft/collectors/gsc_pages.py`, `gsc_sync.py` | Position and forms in the bulk pull; 16 months; tracked rows kept. |
| Create `backend/src/idraft/domain/page_search.py` | Pure: totals, periods, compare, health. |
| Create `backend/src/idraft/collectors/gsc_page_detail.py` | The page filter, history and breakdown fetch and store, markers, prune. Used by worker and API. |
| Modify `backend/src/idraft/collectors/gsc_sync.py`, `gsc_plan.py` | The tracked-page step of a pass; the planner's extra reason to send. |
| Modify `backend/src/idraft/collectors/gsc_limits.py` | `try_acquire`. |
| Create `backend/src/idraft/api/fp/live.py` | The API's own Google caller: token, budget, problems. |
| Create `backend/src/idraft/api/fp/pages_repository.py` | Reads: scope and state, tracked rows, totals, series, titles, suggestions. |
| Create `backend/src/idraft/api/fp/tracked.py`, `page_search.py`, `page_routes.py`; `backend/src/idraft/api/schemas/fp_pages.py` | Services, routes, schemas. |
| Modify `backend/src/idraft/api/main.py`, `backend/tests/api/test_route_access.py` | Router and access rows. |
| Create tests under `backend/tests/domain/`, `backend/tests/collectors/`, `backend/tests/api/fp/` | Named in each task. |
| Modify `backend/openapi/v1.json`, `docs/19-api-specification.md` | Regenerated contract and its catalog rows. |

---

### Task 1: A page filter in the Google client and in the fake

**Read first:** `backend/src/idraft/providers/google/client.py` lines 76 to 80 and `search_analytics`; `backend/tests/providers/google/test_client.py` (the existing `search_analytics` cases); `backend/tests/collectors/gsc_support.py` (`FakeSearchConsole._analytics`).

**Files:**
- Modify: `backend/src/idraft/providers/google/client.py`
- Modify: `backend/tests/collectors/gsc_support.py`
- Test: `backend/tests/providers/google/test_client.py`

- [ ] **Step 1: Write the failing tests** in `tests/providers/google/test_client.py`, beside the existing `search_analytics` cases and built the way they build the client and capture the request body:

```python
async def test_search_analytics_sends_a_filter_group_only_when_filters_are_given() -> None:
    # 1. Call search_analytics(..., dimensions=("date",), filters=(DimensionFilter("page", "includingRegex", "^https://a\\.example/x$"),))
    # 2. Assert the posted JSON has
    #    "dimensionFilterGroups": [{"groupType": "and", "filters": [
    #        {"dimension": "page", "operator": "includingRegex", "expression": "^https://a\\.example/x$"}]}]
    # 3. Call it again without filters and assert the key "dimensionFilterGroups" is absent.
```

Write it as real code with the helpers of that file. Run: `uv run pytest -n 0 --no-cov tests/providers/google/test_client.py -k filter_group`. Expected: FAIL, `DimensionFilter` is not defined.

- [ ] **Step 2: Implement** in `client.py`, after the `Dimension` type:

```python
type FilterOperator = Literal["equals", "contains", "includingRegex"]


@dataclass(frozen=True, slots=True)
class DimensionFilter:
    """One condition on a dimension of `searchAnalytics.query`. Conditions of a call are all
    required together."""

    dimension: Dimension
    operator: FilterOperator
    expression: str
```

Add the parameter `filters: Sequence[DimensionFilter] = ()` to `search_analytics` (keyword only, after `search_type`). Build the body as a local dict, then:

```python
        if filters:
            body["dimensionFilterGroups"] = [
                {
                    "groupType": "and",
                    "filters": [
                        {
                            "dimension": item.dimension,
                            "operator": item.operator,
                            "expression": item.expression,
                        }
                        for item in filters
                    ],
                }
            ]
```

Nothing else changes: the row check and the result are as before.

- [ ] **Step 3: Teach the fake.** In `FakeSearchConsole.__init__` add:

```python
        # Rows of a filtered read (one with `dimensionFilterGroups`), per property and
        # dimensions: dicts with "keys", "clicks", "impressions", "position".
        self.filtered: dict[tuple[str, tuple[str, ...]], list[dict[str, Any]]] = {}
        # A position per page of the `[date, page]` read; pages not named answer 3.0.
        self.page_positions: dict[str, float] = {}
```

Add the method:

```python
    def set_filtered(self, site: str, dimensions: tuple[str, ...], rows: list[dict[str, Any]]) -> None:
        self.filtered[(site, dimensions)] = rows

    def filtered_requests(self, site: str | None = None) -> list[dict[str, Any]]:
        return [
            body
            for requested, body in self.requests
            if "dimensionFilterGroups" in body and (site is None or requested == site)
        ]
```

In `_analytics`, right after `start, end = ...`:

```python
        if "dimensionFilterGroups" in body:
            dimensions = tuple(body["dimensions"])
            found = self.filtered.get((site, dimensions), [])
            if "date" in dimensions:
                at = dimensions.index("date")
                found = [
                    row
                    for row in found
                    if start <= date.fromisoformat(row["keys"][at]) <= end
                    and date.fromisoformat(row["keys"][at]) <= self.final_through
                ]
            found = found[body["startRow"] : body["startRow"] + body["rowLimit"]]
            return httpx.Response(200, json={"rows": [{"ctr": 0.1, **row} for row in found]} if found else {})
```

In the `[date, page]` branch replace `"position": 3.0` with `"position": self.page_positions.get(url, 3.0)`. Make `page_requests` and `detail_requests` ignore filtered bodies (`"dimensionFilterGroups" not in body`), so the existing tests keep counting what they counted.

- [ ] **Step 4: Run** `uv run pytest -n 0 --no-cov tests/providers/google/test_client.py tests/collectors/test_gsc_sync.py`. Expected: PASS (the sync tests prove the fake still serves the old shapes). Then `uv run ruff check src/idraft/providers/google tests/providers/google tests/collectors/gsc_support.py` and `uv run mypy src/idraft/providers/google`.

- [ ] **Step 5: Review, fix, commit.** `git commit -m "Search Console client: a filter on a dimension, and a fake that serves filtered reads"`

---

### Task 2: Schema

**Read first:** spec section 6; `backend/src/idraft/db/migrations/versions/0041_ai_referrals.py` (the style to copy) and `0027_internal_links_changes.py` lines 125 to 190 (`fp.gsc_page_daily`, and how `core.project_pages.set_by` refers to the user); `backend/src/idraft/db/tables.py` (`gsc_page_daily`, `project_pages`); how `fp.ai_referral_daily` appears in `tests/db/test_tables.py`, `tests/db/test_grants.py`, `tests/db/support.py` and `tests/security/test_cross_tenant.py`.

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/00NN_page_search.py`
- Modify: `backend/src/idraft/db/tables.py`, `backend/tests/db/test_tables.py`, `backend/tests/db/test_grants.py`, `backend/tests/db/support.py`, `backend/tests/security/test_cross_tenant.py`

- [ ] **Step 1: The revision number.** Run `git fetch origin develop` and `git ls-tree --name-only origin/develop backend/src/idraft/db/migrations/versions/ | tail -3`. `NN` is the newest number there plus one (0042 if 0041 is still the newest); `down_revision` is that newest number. If another branch you can see (`git branch -a`) already holds that number, say so in the task report; do not renumber theirs.

- [ ] **Step 2: Register the tables in the tests first.** Add the four new tables wherever `fp.ai_referral_daily` is registered: the table list of `tests/db/test_tables.py`; the tenant column map and a seed insert in `tests/db/support.py` and in `tests/security/test_cross_tenant.py`; and in `tests/db/test_grants.py` these expectations (use that file's helpers; `READ` is SELECT only):

| Table | API | Worker |
|---|---|---|
| `fp.gsc_page_daily` (change the existing line) | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE |
| `fp.gsc_page_forms` | SELECT | SELECT, INSERT, UPDATE |
| `fp.gsc_page_fetches` | SELECT, INSERT, DELETE | SELECT, INSERT, DELETE |
| `fp.gsc_page_breakdown` | SELECT, INSERT, DELETE | SELECT, INSERT, DELETE |
| `core.tracked_pages` | SELECT, INSERT, DELETE | SELECT |

Run `uv run pytest -n 0 --no-cov tests/db/test_tables.py tests/db/test_grants.py`. Expected: FAIL, the tables do not exist.

- [ ] **Step 3: Write the migration.** Module docstring: what the revision adds and why, in three or four lines, with `Revision ID` and `Revises`. `_TABLES` is the SQL of spec section 6, statements separated by blank lines, with one change: write `added_by` the way migration 0025 writes `core.project_pages.set_by` (same referenced table and delete rule). Then:

```python
def upgrade() -> None:
    op.execute("ALTER TABLE fp.gsc_page_daily ADD COLUMN position_sum numeric(14,2)")
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in (
        "fp.gsc_page_forms",
        "fp.gsc_page_fetches",
        "fp.gsc_page_breakdown",
        "core.tracked_pages",
    ):
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("fp.gsc_page_daily", api="INSERT, UPDATE", worker="UPDATE"),
        *grants("fp.gsc_page_forms", api="SELECT", worker="SELECT, INSERT, UPDATE"),
        *grants("fp.gsc_page_fetches", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"),
        *grants("fp.gsc_page_breakdown", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"),
        *grants("core.tracked_pages", api="SELECT, INSERT, DELETE", worker="SELECT"),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DROP TABLE core.tracked_pages, fp.gsc_page_breakdown, fp.gsc_page_fetches, fp.gsc_page_forms"
    )
    op.execute("ALTER TABLE fp.gsc_page_daily DROP COLUMN position_sum")
```

Add one index for the worker's and the list's read: `CREATE INDEX tracked_pages_workspace ON core.tracked_pages (workspace_id, project_id);`.

- [ ] **Step 4: `tables.py`.** Add `Column("position_sum", Numeric(14, 2))` to `gsc_page_daily` (nullable) and the four tables `gsc_page_forms`, `gsc_page_fetches`, `gsc_page_breakdown`, `tracked_pages`, columns and keys exactly as the SQL, in the style of `gsc_page_daily` (composite `ForeignKeyConstraint` to `integrations` or `projects`, `server_default=FetchedValue()` for defaulted columns).

- [ ] **Step 5: Run** the two test files of step 2 plus `tests/security/test_cross_tenant.py -k "tracked_pages or gsc_page"` and `tests/db/test_internal_links_changes_schema.py` (it names `fp.gsc_page_daily`). Expected: PASS. `uv run ruff check src/idraft/db tests/db` and `uv run mypy src/idraft/db`.

- [ ] **Step 6: Review, fix, commit.** `git commit -m "Page search: position per page and day, address forms, page fetches, breakdowns and tracked pages"`

---

### Task 3: The bulk pull keeps position and address forms, for 16 months

**Read first:** `backend/src/idraft/collectors/gsc_pages.py` (whole file); `gsc_sync.py` `_pages_window` and `_page_day`; `domain/gsc_pull.py` `history_start`; the page cases of `backend/tests/collectors/test_gsc_sync.py` (search `set_page_day`).

**Files:**
- Modify: `backend/src/idraft/collectors/gsc_pages.py`, `backend/src/idraft/collectors/gsc_sync.py`
- Test: `backend/tests/collectors/test_gsc_pages.py` (create it if the page cases live in `test_gsc_sync.py`; keep those where they are)

- [ ] **Step 1: Write the failing tests** (database tests, built like the page cases of `test_gsc_sync.py`: `make_property`, a `core.urls` row for each address, `FakeSearchConsole.set_page_day`):

1. `test_a_page_day_keeps_position_times_impressions`: the fake answers `https://acme.example/pricing` with 10 impressions and `page_positions` 4.0; after a pass the row has `position_sum == Decimal("40.00")`.
2. `test_two_spellings_of_one_page_are_summed_and_both_kept_as_forms`: `https://acme.example/pricing` (10 impressions, position 4.0) and `https://acme.example/pricing/` (30 impressions, position 2.0) on one day. Expect one row: impressions 40, `position_sum == Decimal("100.00")`, and two rows in `fp.gsc_page_forms` with `last_seen` that day.
3. `test_a_form_seen_again_moves_its_last_seen`: two days, the same spelling; one form row, `last_seen` the later day.
4. `test_rows_older_than_sixteen_months_go_and_a_tracked_page_keeps_them`: insert two rows dated `history_start(today) - 5 days`, one for a page with a `core.tracked_pages` row (insert a `core.project_pages` row first if the foreign keys need it) and one for another page; after a pass only the tracked page's old row remains.
5. `test_rows_of_forty_days_ago_are_kept`: a row 40 days old survives a pass (it was deleted before this change).

Run: `uv run pytest -n 0 --no-cov tests/collectors/test_gsc_pages.py`. Expected: FAIL.

- [ ] **Step 2: Implement in `gsc_pages.py`.**

`PageDayRow` becomes:

```python
@dataclass(frozen=True, slots=True)
class PageDayRow:
    url_hash: bytes
    clicks: int
    impressions: int
    position_sum: Decimal
    # The addresses exactly as Search Console returned them: what a page filter must name.
    forms: tuple[str, ...]
```

`page_day_rows` merges per `url_hash`: clicks and impressions summed, `position_sum += Decimal(str(row.position)) * row.impressions`, forms appended in order without repeats. `replace_page_day` writes `position_sum` quantized to `Decimal("0.01")`, and after the rows upserts the forms of the kept rows:

```python
    forms = [
        {
            "integration_id": facts.integration_id,
            "url_id": ids[row.url_hash],
            "page": form,
            "workspace_id": facts.workspace_id,
            "last_seen": day,
        }
        for row in rows
        if row.url_hash in ids
        for form in row.forms
    ]
    for start in range(0, len(forms), _CHUNK):
        statement = upsert(gsc_page_forms).values(forms[start : start + _CHUNK])
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=["integration_id", "url_id", "page"],
                set_={"last_seen": func.greatest(gsc_page_forms.c.last_seen, statement.excluded.last_seen)},
            )
        )
```

Delete `PAGE_KEEP_DAYS`. `prune_pages(db, facts, before)` keeps its signature and gains one clause: the page is not tracked in the integration's project.

```python
    tracked = select(tracked_pages.c.url_id).where(
        tracked_pages.c.workspace_id == facts.workspace_id,
        tracked_pages.c.project_id == facts.project_id,
    )
    # ... the existing delete, with: gsc_page_daily.c.url_id.not_in(tracked)
```

`page_clicks` is unchanged (other code reads it).

- [ ] **Step 3: Implement in `gsc_sync.py`.** In `_pages_window` replace the prune argument `end - timedelta(days=gsc_pages.PAGE_KEEP_DAYS)` by `history_start(pacific_today(self._ctx.now()))`. Nothing else: the window pulled stays the 28 days, and days pulled from now on accumulate.

- [ ] **Step 4: Run** `uv run pytest -n 0 --no-cov tests/collectors/test_gsc_pages.py tests/collectors/test_gsc_sync.py`, then `grep -rn "PAGE_KEEP_DAYS" backend/` (expected: nothing), `uv run ruff check src/idraft/collectors tests/collectors`, `uv run mypy src/idraft/collectors`.

- [ ] **Step 5: Review, fix, commit.** `git commit -m "Search Console page totals keep the position and the addresses Google used, for 16 months"`

---

### Task 4: Periods, totals and health as pure functions

**Read first:** spec sections 3 (D7, D12, D13) and 7.1; `docs/32-page-performance.md` section 6.1; the mock's `healthOf` in `/Users/a12345/Desktop/AI/idraft/platform/apps/web/design-preview/perf-calc.js` (read only; this task ports it).

**Files:**
- Create: `backend/src/idraft/domain/page_search.py`
- Test: `backend/tests/domain/test_page_search.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Periods, totals and the health verdict of a page's Search Console numbers
(docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md, D7, D12, D13)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from idraft.domain.page_search import (
    Totals,
    WindowTooLargeError,
    compare_window,
    health_of,
    last_full_month,
    window_of,
)


def totals(clicks: int, impressions: int, position: float | None = None) -> Totals:
    if position is None:
        return Totals(clicks, impressions)
    return Totals(clicks, impressions, Decimal(str(position)) * impressions, impressions)


def test_ctr_is_clicks_over_impressions_and_position_is_weighted_by_impressions() -> None:
    both = totals(10, 100, 2.0) + totals(0, 300, 6.0)
    assert both.ctr == pytest.approx(0.025)
    assert both.position == pytest.approx(5.0)


def test_nothing_shown_has_no_ctr_and_no_position() -> None:
    assert Totals().ctr is None
    assert Totals().position is None


def test_rows_without_a_position_do_not_pull_the_average() -> None:
    both = totals(1, 100, 4.0) + Totals(1, 900)
    assert both.impressions == 1000
    assert both.position == pytest.approx(4.0)


def test_the_last_full_month_ends_on_or_before_the_last_final_day() -> None:
    assert last_full_month(date(2026, 11, 22)) == (date(2026, 10, 1), date(2026, 10, 31))
    assert last_full_month(date(2026, 11, 30)) == (date(2026, 11, 1), date(2026, 11, 30))
    assert last_full_month(date(2026, 1, 3)) == (date(2025, 12, 1), date(2025, 12, 31))


def test_a_window_defaults_to_the_last_full_month_and_never_passes_the_last_final_day() -> None:
    final = date(2026, 11, 22)
    assert window_of(None, None, final) == (date(2026, 10, 1), date(2026, 10, 31))
    assert window_of(date(2026, 11, 1), date(2026, 11, 30), final) == (date(2026, 11, 1), final)
    assert window_of(None, date(2026, 11, 10), final) == (date(2026, 10, 14), date(2026, 11, 10))


def test_a_window_is_at_most_92_days_and_its_start_is_not_after_its_end() -> None:
    final = date(2026, 11, 22)
    assert window_of(date(2026, 8, 23), final, final) == (date(2026, 8, 23), final)
    with pytest.raises(WindowTooLargeError):
        window_of(date(2026, 8, 22), final, final)
    with pytest.raises(ValueError, match="after"):
        window_of(date(2026, 11, 10), date(2026, 11, 1), final)


def test_a_calendar_month_compares_with_the_month_before_and_any_other_range_with_as_many_days() -> None:
    assert compare_window(date(2026, 10, 1), date(2026, 10, 31), "previous_period") == (
        date(2026, 9, 1),
        date(2026, 9, 30),
    )
    assert compare_window(date(2026, 10, 5), date(2026, 10, 11), "previous_period") == (
        date(2026, 9, 28),
        date(2026, 10, 4),
    )
    assert compare_window(date(2026, 10, 1), date(2026, 10, 31), "none") is None


def test_the_same_period_last_year_keeps_the_dates_and_a_leap_day_falls_back() -> None:
    assert compare_window(date(2026, 10, 1), date(2026, 10, 31), "previous_year") == (
        date(2025, 10, 1),
        date(2025, 10, 31),
    )
    assert compare_window(date(2028, 2, 1), date(2028, 2, 29), "previous_year") == (
        date(2027, 2, 1),
        date(2027, 2, 28),
    )


@pytest.mark.parametrize(
    ("current", "previous", "days", "verdict", "basis", "small"),
    [
        (totals(0, 0), totals(0, 0), (30, 30), "no_data", "clicks", False),
        (totals(3, 10), totals(0, 0), (30, 30), "new", "clicks", False),
        (totals(0, 50), totals(25, 900), (30, 30), "lost", "clicks", False),
        (totals(5, 100), totals(5, 100), (30, 30), "low_data", "clicks", False),
        (totals(4, 400), totals(27, 400), (30, 30), "low_data", "clicks", True),
        (totals(100, 5000), totals(200, 5000), (30, 30), "sharp_drop", "clicks", False),
        (totals(317, 41200), totals(412, 39600), (31, 30), "declining", "clicks", False),
        (totals(150, 5000), totals(100, 5000), (30, 30), "growing", "clicks", False),
        (totals(105, 5000), totals(100, 5000), (30, 30), "stable", "clicks", False),
        (totals(10, 2000), totals(10, 1000), (30, 30), "growing", "impressions", False),
    ],
)
def test_the_verdict_table(
    current: Totals, previous: Totals, days: tuple[int, int], verdict: str, basis: str, small: bool
) -> None:
    health = health_of(current, previous, *days)
    assert (health.verdict, health.basis, health.small) == (verdict, basis, small)


def test_a_change_is_per_day_when_the_periods_differ_in_length() -> None:
    health = health_of(totals(317, 41200), totals(412, 39600), 31, 30)
    assert health.change == pytest.approx(-0.2554, abs=0.0001)
    assert health.absolute == pytest.approx(-108.73, abs=0.01)


def test_without_a_compared_period_a_page_is_stable_or_has_no_data() -> None:
    assert health_of(totals(3, 40), None, 30, 30).verdict == "stable"
    assert health_of(totals(0, 0), None, 30, 30).verdict == "no_data"


def test_thresholds_are_inclusive() -> None:
    assert health_of(totals(60, 5000), totals(100, 5000), 30, 30).verdict == "sharp_drop"
    assert health_of(totals(250, 5000), totals(275, 5000), 30, 30).verdict == "stable"
    assert health_of(totals(225, 5000), totals(250, 5000), 30, 30).verdict == "declining"


def test_flags_say_when_position_moved_and_when_fewer_people_clicked() -> None:
    slipped = health_of(totals(100, 1000, 5.9), totals(100, 1000, 3.8), 30, 30)
    assert slipped.flags == ("position_slipped",)
    improved = health_of(totals(100, 1000, 3.0), totals(100, 1000, 4.5), 30, 30)
    assert improved.flags == ("position_improved",)
    fewer = health_of(totals(50, 2000), totals(60, 1000), 30, 30)
    assert fewer.flags == ("ctr_fell_impressions_rose",)
    assert health_of(totals(100, 90, 9.0), totals(100, 90, 3.0), 30, 30).flags == ()
```

Run: `uv run pytest -n 0 --no-cov tests/domain/test_page_search.py`. Expected: FAIL, the module does not exist.

- [ ] **Step 2: Implement** `backend/src/idraft/domain/page_search.py`:

```python
"""A page's Search Console numbers as the Search tab and Monitoring read them: the period, the
period compared with, the totals and the health verdict (`page_health_v1`, docs/32 section 6.1).

CTR is summed clicks over summed impressions. Average position is the sum of position times
impressions over the impressions of the rows that carry a position: Google's own definition,
never an average of days. Nothing here reads a clock or a database.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Final, Literal

MAX_DAYS: Final = 92
# A period given by its end alone is this long, as the window of the Clicks columns.
DEFAULT_DAYS: Final = 28
HEALTH_VERSION: Final = "page_health_v1"
LOST_MIN_CLICKS: Final = 25
LOW_CLICKS: Final = 30
LOW_IMPRESSIONS: Final = 300
MIN_CLICKS: Final = 25
MIN_IMPRESSIONS: Final = 500
SHARP_DROP: Final = -0.40
MOVE: Final = 0.10
CTR_FALL: Final = -0.15
POSITION_SHIFT: Final = 1.5
POSITION_MIN_IMPRESSIONS: Final = 100

type Compare = Literal["none", "previous_period", "previous_year"]
type Verdict = Literal[
    "no_data", "new", "lost", "low_data", "sharp_drop", "declining", "growing", "stable"
]
type Basis = Literal["clicks", "impressions"]


class WindowTooLargeError(ValueError):
    """A period of more than `MAX_DAYS` days."""


@dataclass(frozen=True, slots=True)
class Totals:
    clicks: int = 0
    impressions: int = 0
    position_sum: Decimal = Decimal(0)
    # The impressions of the rows that carried a position (rows stored before positions were
    # kept carry none).
    position_impressions: int = 0

    def __add__(self, other: Totals) -> Totals:
        return Totals(
            self.clicks + other.clicks,
            self.impressions + other.impressions,
            self.position_sum + other.position_sum,
            self.position_impressions + other.position_impressions,
        )

    @property
    def ctr(self) -> float | None:
        return self.clicks / self.impressions if self.impressions else None

    @property
    def position(self) -> float | None:
        if not self.position_impressions:
            return None
        return float(self.position_sum / self.position_impressions)


@dataclass(frozen=True, slots=True)
class Health:
    verdict: Verdict
    basis: Basis = "clicks"
    # The relative change of the basis metric per day; None where no change is stated.
    change: float | None = None
    # The difference of the basis metric, the compared period scaled to this one's length.
    absolute: float = 0.0
    # The change is 10% or more on numbers too small to count (docs/32 section 6.1).
    small: bool = False
    flags: tuple[str, ...] = ()


def days_of(first: date, last: date) -> int:
    return (last - first).days + 1


def last_full_month(final_through: date) -> tuple[date, date]:
    """The last calendar month that ends on or before the last final day."""
    if final_through.day == calendar.monthrange(final_through.year, final_through.month)[1]:
        return final_through.replace(day=1), final_through
    end = final_through.replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end


def window_of(start: date | None, end: date | None, final_through: date) -> tuple[date, date]:
    """The period asked for, both days included, cut to the last final day. Neither date: the
    last full month. Raises `WindowTooLargeError` past `MAX_DAYS`, `ValueError` when the start
    is after the end."""
    if start is None and end is None:
        return last_full_month(final_through)
    last = min(end or final_through, final_through)
    first = start or last - timedelta(days=DEFAULT_DAYS - 1)
    if first > last:
        raise ValueError("the period starts after it ends")
    if days_of(first, last) > MAX_DAYS:
        raise WindowTooLargeError
    return first, last


def _is_calendar_month(first: date, last: date) -> bool:
    return (
        first.day == 1
        and (first.year, first.month) == (last.year, last.month)
        and last.day == calendar.monthrange(last.year, last.month)[1]
    )


def _year_before(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        # 29 February of a leap year
        return day.replace(year=day.year - 1, day=28)


def compare_window(first: date, last: date, compare: Compare) -> tuple[date, date] | None:
    """The days compared with: a whole calendar month with the month before it, any other
    period with as many days just before it, or the same dates a year earlier."""
    if compare == "none":
        return None
    if compare == "previous_year":
        return _year_before(first), _year_before(last)
    if _is_calendar_month(first, last):
        end = first - timedelta(days=1)
        return end.replace(day=1), end
    return first - timedelta(days=days_of(first, last)), first - timedelta(days=1)


def _flags(cur: Totals, prev: Totals, cur_days: int, prev_days: int) -> tuple[str, ...]:
    if not cur.impressions or not prev.impressions:
        return ()
    flags: list[str] = []
    if prev.clicks:
        ctr = (cur.clicks / cur.impressions) / (prev.clicks / prev.impressions) - 1
        shown = (cur.impressions / cur_days) / (prev.impressions / prev_days) - 1
        if ctr <= CTR_FALL and shown >= MOVE:
            flags.append("ctr_fell_impressions_rose")
    now, before = cur.position, prev.position
    enough = min(cur.impressions, prev.impressions) >= POSITION_MIN_IMPRESSIONS
    if now is not None and before is not None and enough and abs(now - before) >= POSITION_SHIFT:
        flags.append("position_slipped" if now > before else "position_improved")
    return tuple(flags)


def health_of(cur: Totals, prev: Totals | None, cur_days: int, prev_days: int) -> Health:
    """The verdict, by the rules of docs/32 section 6.1 in their order."""
    if prev is None:
        return Health("stable" if cur.impressions else "no_data")
    if not cur.impressions and not prev.impressions:
        return Health("no_data")
    if not prev.impressions:
        return Health("new", absolute=float(cur.clicks))
    flags = _flags(cur, prev, cur_days, prev_days)
    if prev.clicks >= LOST_MIN_CLICKS and not cur.clicks:
        return Health("lost", change=-1.0, absolute=-float(prev.clicks), flags=flags)
    clicks = cur.clicks + prev.clicks
    if clicks < LOW_CLICKS and cur.impressions + prev.impressions < LOW_IMPRESSIONS:
        return Health("low_data", flags=flags)

    basis: Basis = "clicks" if clicks >= LOW_CLICKS else "impressions"
    minimum = MIN_CLICKS if basis == "clicks" else MIN_IMPRESSIONS
    now = cur.clicks if basis == "clicks" else cur.impressions
    before = prev.clicks if basis == "clicks" else prev.impressions
    change = (now / cur_days) / (before / prev_days) - 1 if before else 0.0
    absolute = now - before * cur_days / prev_days
    material = abs(absolute) >= minimum
    verdict: Verdict = "stable"
    small = False
    if material and change <= SHARP_DROP:
        verdict = "sharp_drop"
    elif material and change <= -MOVE:
        verdict = "declining"
    elif material and change >= MOVE:
        verdict = "growing"
    elif not material and abs(change) >= MOVE:
        verdict, small = "low_data", True
    return Health(verdict, basis, change, absolute, small, flags)
```

- [ ] **Step 3: Run** the test file. Expected: PASS. If a case of the table fails, the test table is the specification (it restates docs/32 section 6.1 and the mock): fix the code, not the table, unless the arithmetic of the case is wrong, and say so in the report. `uv run ruff check src/idraft/domain/page_search.py tests/domain/test_page_search.py`, `uv run mypy src/idraft/domain/page_search.py`.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Page search: periods, totals and the health verdict as pure functions"`

---

### Task 5: Fetching and storing one page's history and breakdowns

**Read first:** spec sections 5.1, 5.5 and 6; `backend/src/idraft/collectors/gsc_store.py` (`IntegrationFacts`, `DEVICES`); `gsc_sync.py` `_Pass._query` (the call this module is handed); `db/engine.py` `workspace_transaction`.

**Files:**
- Create: `backend/src/idraft/collectors/gsc_page_detail.py`
- Test: `backend/tests/collectors/test_gsc_page_detail.py`

The module never opens a transaction around a call to Google: it reads, calls, then writes.

- [ ] **Step 1: Write the failing tests.** Pure ones first, as code:

```python
from idraft.collectors.gsc_page_detail import MAX_FORMS, page_pattern


def test_stored_forms_are_matched_exactly() -> None:
    pattern = page_pattern(
        "https://acme.example/pricing",
        ["https://acme.example/pricing", "https://acme.example/pricing/"],
    )
    assert pattern == r"^(https://acme\.example/pricing|https://acme\.example/pricing/)$"


def test_without_forms_either_scheme_and_the_trailing_slash_match() -> None:
    assert page_pattern("https://acme.example/pricing", []) == r"^https?://acme\.example/pricing/?$"
    assert page_pattern("https://acme.example/", []) == r"^https?://acme\.example/?$"


def test_an_address_with_a_query_is_matched_as_it_is() -> None:
    assert page_pattern("https://acme.example/p?id=7", []) == r"^https?://acme\.example/p\?id=7$"


def test_at_most_eight_forms_are_named() -> None:
    forms = [f"https://acme.example/p?x={n}" for n in range(12)]
    assert page_pattern("https://acme.example/p", forms).count("|") == MAX_FORMS - 1
```

Then database tests (a property from `make_property`, a `core.urls` row, a fake `query` function that records its keyword arguments and returns `AnalyticsRow` lists you give it; no HTTP is needed here):

1. `test_history_fills_missing_days_and_never_replaces_a_stored_day`: a stored row for day D (clicks 9, `position_sum` NULL) and the query answering D (clicks 1, position 2.0, impressions 10) and D+1 (clicks 4, impressions 20, position 3.0). After `ensure_history`: day D still has clicks 9 and now `position_sum` 20.00; day D+1 has clicks 4 and `position_sum` 60.00; a `history` marker exists with `date_from == history_start(today)`; the call asked for dimensions `("date",)` and one `includingRegex` page filter.
2. `test_history_is_fetched_once`: a second `ensure_history` returns False and makes no call.
3. `test_a_page_google_knows_nothing_about_still_gets_its_marker`: the query returns `[]`; a marker with `row_count` 0 exists.
4. `test_a_breakdown_stores_three_dimensions_and_their_markers`: the query answers by dimension; after `ensure_breakdown` the table holds the query text as key, the country in upper case (`"usa"` stored as `"USA"`), the device as given; three markers; `truncated` is true only for the dimension whose answer had exactly its row limit of rows. The calls asked for row limits 100, 50 and 25.
5. `test_a_breakdown_already_fetched_asks_nothing_and_a_missing_dimension_alone_is_asked`: delete the `device` marker; the next `ensure_breakdown` makes exactly one call.
6. `test_fetching_a_breakdown_again_replaces_its_rows`: call `store_breakdown` twice with different rows for one dimension; only the second set remains.
7. `test_prune_drops_old_fetches_except_a_tracked_page_s_calendar_months`: four marker sets `fetched_at` 31 days ago: untracked page and October; tracked page and 5 to 11 October; tracked page and the whole of October; untracked page fetched today. After `prune`: only the last two remain, with their breakdown rows. The `history` markers are never pruned.
8. `test_a_device_or_country_the_tables_have_no_place_for_is_left_out`: a device `"SMART_TV"` and a country `"x"` are skipped, not stored.

Run: `uv run pytest -n 0 --no-cov tests/collectors/test_gsc_page_detail.py`. Expected: FAIL.

- [ ] **Step 2: Implement.** Public surface, exact:

```python
"""One page's Search Console history and its breakdown by query, location and device: asked of
Google with a page filter, stored once and marked as fetched (spec sections 5 and 6). The worker
calls this for tracked pages inside a pass; the API calls it when a page's Search tab asks."""

HISTORY: Final = "history"
DIMENSIONS: Final = ("query", "country", "device")
ROW_LIMITS: Final = {"query": 100, "country": 50, "device": 25}
MAX_FORMS: Final = 8
# A fetch on demand is kept this long; a tracked page's calendar months are kept for good.
KEEP_FETCH_DAYS: Final = 30

type BreakdownDimension = Literal["query", "country", "device"]


class PageQuery(Protocol):
    """One `searchAnalytics.query` call for final data, within the caller's budget."""

    async def __call__(
        self,
        *,
        start: date,
        end: date,
        dimensions: Sequence[Dimension],
        filters: Sequence[DimensionFilter],
        row_limit: int,
    ) -> list[AnalyticsRow]: ...


@dataclass(frozen=True, slots=True)
class PageRef:
    url_id: int
    canonical_url: str


def page_pattern(canonical_url: str, forms: Sequence[str]) -> str: ...
async def page_filter(db: AsyncSession, facts: IntegrationFacts, page: PageRef) -> DimensionFilter: ...
async def fetched(db: AsyncSession, facts: IntegrationFacts, url_id: int, start: date, end: date) -> set[str]: ...
async def history_from(db: AsyncSession, facts: IntegrationFacts, url_id: int) -> date | None: ...
async def store_history(db: AsyncSession, facts: IntegrationFacts, url_id: int, start: date, end: date, rows: Sequence[AnalyticsRow]) -> int: ...
async def store_breakdown(db: AsyncSession, facts: IntegrationFacts, url_id: int, start: date, end: date, dimension: BreakdownDimension, rows: Sequence[AnalyticsRow]) -> int: ...
async def ensure_history(sessions: async_sessionmaker[AsyncSession], query: PageQuery, facts: IntegrationFacts, page: PageRef, *, today: date, final_through: date) -> bool: ...
async def ensure_breakdown(sessions: async_sessionmaker[AsyncSession], query: PageQuery, facts: IntegrationFacts, page: PageRef, start: date, end: date, *, only: Sequence[BreakdownDimension] = DIMENSIONS) -> int: ...
async def prune(db: AsyncSession, facts: IntegrationFacts, *, now: datetime) -> None: ...
```

Behaviour:

- `page_pattern`:

```python
def page_pattern(canonical_url: str, forms: Sequence[str]) -> str:
    """The regular expression a page filter names: the stored addresses exactly, or, with none
    stored, the canonical address under either scheme, with or without its trailing slash."""
    if forms:
        return "^(" + "|".join(re.escape(form) for form in forms[:MAX_FORMS]) + ")$"
    rest = canonical_url.split("://", 1)[1]
    if "?" in rest:
        return "^https?://" + re.escape(rest) + "$"
    return "^https?://" + re.escape(rest.rstrip("/")) + "/?$"
```

- `page_filter`: the page's forms from `fp.gsc_page_forms` for this integration, newest `last_seen` first then `page`, limit `MAX_FORMS`; returns `DimensionFilter("page", "includingRegex", page_pattern(...))`.
- `fetched`: the kinds among `DIMENSIONS` that have a marker for exactly `(url_id, start, end)`.
- `history_from`: `date_from` of the `history` marker, or None.
- `store_history`: rows have keys `(date,)`. Insert into `fp.gsc_page_daily` with `position_sum = Decimal(str(position)) * impressions` quantized to 0.01, `ON CONFLICT (integration_id, metric_date, url_id) DO UPDATE SET position_sum = excluded.position_sum WHERE fp.gsc_page_daily.position_sum IS NULL` (SQLAlchemy: `on_conflict_do_update(index_elements=[...], set_={...}, where=gsc_page_daily.c.position_sum.is_(None))`). Then upsert the marker `(kind='history', date_from=start, date_to=end, row_count=len(rows))` with `on_conflict_do_nothing`. A row whose date is not a date raises `GoogleResponseError`. Returns the number of rows given.
- `store_breakdown`: delete the rows of `(integration, url_id, start, end, dimension)`; insert the new ones (key: the query as returned; the country upper-cased and kept only when 3 characters long; the device upper-cased and kept only when in `gsc_store.DEVICES`; repeated keys summed); delete and insert the marker with `truncated = len(rows) >= ROW_LIMITS[dimension]`. Every statement names `workspace_id`.
- `ensure_history`: in one `workspace_transaction` read `history_from` and, when None, `page_filter`; when a marker exists return False. Else call `query(start=history_start(today), end=final_through, dimensions=("date",), filters=(filter,), row_limit=SEARCH_ANALYTICS_ROW_LIMIT)`, then in a new transaction `store_history`. Return True.
- `ensure_breakdown`: read `fetched` and the filter in one transaction; for each dimension of `only` without a marker, in order: call `query(start=start, end=end, dimensions=(dimension,), filters=(filter,), row_limit=ROW_LIMITS[dimension])`, then store in its own transaction. Returns the number of calls made. An exception of a call leaves the dimensions already stored in place.
- `prune`: delete breakdown rows and markers of kind in `DIMENSIONS` whose marker has `fetched_at < now - KEEP_FETCH_DAYS days`, unless the page is tracked in `facts.project_id` and `(date_from, date_to)` is a whole calendar month. Do it as two deletes that share one subquery of the marker keys to drop; breakdown rows first. Write the calendar month test in SQL: `date_from = date_trunc('month', date_from)::date AND date_to = (date_trunc('month', date_from) + interval '1 month - 1 day')::date`.

- [ ] **Step 3: Run** the test file. Expected: PASS. `uv run ruff check`, `uv run ruff format --check`, `uv run mypy` on the two files.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Page search: fetch a page's history and breakdowns from Search Console and store them once"`

---

### Task 6: The worker fetches tracked pages inside a pass

**Read first:** `backend/src/idraft/collectors/gsc_sync.py` (`_Pass._query`, `_Pass.run`, `_out_of_time`); `gsc_plan.py` `_send_unfinished`; `backend/tests/collectors/test_gsc_plan.py` (how a plan test seeds a property and collects sent tasks).

**Files:**
- Modify: `backend/src/idraft/collectors/gsc_sync.py`, `backend/src/idraft/collectors/gsc_plan.py`
- Test: `backend/tests/collectors/test_gsc_tracked_pages.py`, `backend/tests/collectors/test_gsc_plan.py`

- [ ] **Step 1: Write the failing tests** (`test_gsc_tracked_pages.py`; real passes through `sync_integration` with `FakeSearchConsole`; seed a `core.urls` row, a `core.project_pages` row if the keys need it, and a `core.tracked_pages` row; give the fake a final day so the pass has a window):

1. `test_a_pass_fetches_the_history_of_a_tracked_page_once`: `set_filtered(site, ("date",), [...])` with two days; after a pass the two `fp.gsc_page_daily` rows and the `history` marker exist; a second pass sends no filtered `("date",)` request.
2. `test_a_pass_fetches_the_last_full_month_and_the_month_before_for_a_tracked_page`: after a pass there are six breakdown markers: the three dimensions for `last_full_month(final_through)` and for `compare_window(..., "previous_period")` of it.
3. `test_a_page_that_is_not_tracked_is_not_fetched`: no filtered request at all.
4. `test_the_step_stops_on_the_budget_and_the_next_pass_goes_on`: three tracked pages and a `SyncContext.monotonic` that passes the deadline after the first page's fetches; the first pass reports `more=True` and the markers of one page; a second pass (fresh clock) completes the other two.
5. `test_a_quota_error_in_the_step_fails_the_pass_and_keeps_what_was_stored`: `quota_after` set so the second filtered call fails; outcome `FAILED`, the first marker stays.
6. In `test_gsc_plan.py`: `test_a_property_with_a_tracked_page_that_has_no_history_is_sent`: a property whose pull is complete (`complete: true`, current version) and whose schedule is not due is not sent; add a `core.tracked_pages` row and it is sent; add the `history` marker row and it is not sent again.

Run the two files. Expected: FAIL.

- [ ] **Step 2: Implement in `gsc_sync.py`.**

`_Pass._query` gains two keyword parameters, passed through to `google.search_analytics`: `filters: Sequence[DimensionFilter] = ()` and `row_limit: int | None = None` (None keeps `self._ctx.page_size`).

Add to `_Pass`:

```python
    async def _page_query(
        self,
        *,
        start: date,
        end: date,
        dimensions: Sequence[Dimension],
        filters: Sequence[DimensionFilter],
        row_limit: int,
    ) -> list[AnalyticsRow]:
        return await self._query(
            start=start, end=end, dimensions=dimensions, filters=filters, row_limit=row_limit
        )

    async def _tracked_pages(self, latest: date) -> bool:
        """The history and the two default months of every tracked page that lacks them, then
        the pruning of old fetches. True when it stopped on the budget."""
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            pages = await gsc_page_detail.tracked_refs(db, self._facts)
        today = pacific_today(self._ctx.now())
        month = last_full_month(latest)
        before = compare_window(*month, "previous_period")
        for page in pages:
            if self._out_of_time():
                return True
            sessions, facts = self._ctx.sessions, self._facts
            await gsc_page_detail.ensure_history(
                sessions, self._page_query, facts, page, today=today, final_through=latest
            )
            for window in (month, before):
                if window is not None:
                    await gsc_page_detail.ensure_breakdown(
                        sessions, self._page_query, facts, page, *window
                    )
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            await gsc_page_detail.prune(db, self._facts, now=self._ctx.now())
        return False
```

Add `tracked_refs(db, facts) -> list[PageRef]` to `gsc_page_detail.py`: the tracked pages of `facts.project_id` joined to `core.urls` (`urls.c.canonical_url`), ordered by `url_id`, every statement naming the workspace.

In `run`, right after the `_checkpoint(...recent_done=True...)` line and before the history sweep's `if`, add:

```python
        if self._ctx.page_totals and await self._tracked_pages(latest):
            return True
```

`self.calls` already counts every `_query`, so the report shows these calls.

- [ ] **Step 3: Implement in `gsc_plan.py`.** In `_send_unfinished`, add a third alternative to the `or_(...)`: an `exists()` over `tracked_pages` for the integration's `workspace_id` and `project_id` with no `gsc_page_fetches` row of `kind == 'history'` for that integration and `url_id` (a correlated `~exists()` inside). Update the function's comment and the module docstring's sentence about what is sent again. `PullState.read(...).retry_due(now)` still guards the send, so a failing property waits.

- [ ] **Step 4: Run** `uv run pytest -n 0 --no-cov tests/collectors/test_gsc_tracked_pages.py tests/collectors/test_gsc_plan.py tests/collectors/test_gsc_sync.py`. Expected: PASS. Ruff and mypy on `src/idraft/collectors`.

- [ ] **Step 5: Review, fix, commit.** `git commit -m "Search Console pass fetches the history and the default months of tracked pages"`

---

### Task 7: The API's own way to call Google

**Read first:** `backend/src/idraft/collectors/gsc_limits.py`; `backend/src/idraft/api/integrations/service.py` (`_configured`, `_google`, `_access_token`, and the function near line 640 that turns a `GoogleError` into a problem); `backend/src/idraft/api/problems.py` (how a problem class is declared, and how one carries `retry_after`); `backend/src/idraft/api/resources.py`.

**Files:**
- Modify: `backend/src/idraft/collectors/gsc_limits.py`
- Create: `backend/src/idraft/api/fp/live.py`
- Test: `backend/tests/collectors/test_gsc_limits.py` (add cases), `backend/tests/api/fp/test_live.py`

- [ ] **Step 1: Write the failing tests.**

`test_gsc_limits.py` (use the file's fake clock):

```python
async def test_try_acquire_takes_a_token_when_all_three_buckets_have_one() -> None:
    limiter = GscLimiter(Budgets(site_per_minute=60), clock=clock)   # clock: the file's fake
    assert limiter.try_acquire(user="u", site="s") == 0.0


async def test_try_acquire_says_how_long_to_wait_and_charges_nothing() -> None:
    # Spend the site's burst (10 tokens at 60 a minute), then:
    #   wait = limiter.try_acquire(user="u", site="s")
    #   assert 0.0 < wait <= 1.0
    # Another site of the same user is still served at once: the user bucket was not charged
    # by the refused call.
```

`tests/api/fp/test_live.py` (a property from `make_property` with the fake's token; build `LiveGoogle` with the fake's HTTP transport the way `tests/api/integrations` builds its service):

1. `test_a_query_calls_search_console_with_the_stored_token`: one filtered call reaches the fake with a bearer token.
2. `test_no_token_left_is_gsc_busy_with_the_wait`: a limiter with a spent bucket; `LiveGoogle.query(...)` raises `GscBusyError` and its `retry_after` is at least 1.
3. `test_googles_quota_error_is_gsc_busy_and_slows_the_property`: `fake.quota_after = 0`; `GscBusyError`.
4. `test_a_refused_refresh_token_is_reauth_and_a_refused_property_is_no_access`: `fake.kill_refresh_token(account)` raises `LiveStateError` with `state == "reauth_required"`; `fake.statuses[site] = 403` raises it with `state == "no_access"`.
5. `test_a_server_error_is_google_unavailable`: `fake.statuses[site] = 500` raises the `503 google_unavailable` problem.
6. `test_the_access_token_is_asked_for_once_per_object`: two queries, one call to the token endpoint.

Run. Expected: FAIL.

- [ ] **Step 2: `try_acquire`** in `GscLimiter`:

```python
    def try_acquire(self, *, user: str, site: str) -> float:
        """Take a token from each bucket when all three have one and return 0. Otherwise charge
        nothing and return the seconds until they would: for a caller that cannot wait."""
        buckets = (
            self._project,
            self._bucket(self._users, user, self._budgets.user_per_minute),
            self._bucket(self._sites, site, self._budgets.site_per_minute),
        )
        wait = max(bucket.wait_for_token() for bucket in buckets)
        if wait <= 0.0:
            for bucket in buckets:
                bucket.take()
        return max(wait, 0.0)
```

- [ ] **Step 3: `api/fp/live.py`.**

```python
"""Search Console asked from a request, for one page (spec decision D5). The budget is this
process's own and is never waited on: with no token left the request is refused as busy.

shortcut: one budget per API process. With several processes each has its own; move the buckets
to Redis together with the worker's (`collectors/gsc_limits.py`) before the totals near Google's
1,200 calls a minute per property.
"""

API_BUDGETS: Final = Budgets(project_per_minute=2_000.0, user_per_minute=120.0, site_per_minute=60.0)
API_LIMITER: Final = GscLimiter(API_BUDGETS)
QUOTA_RETRY_SECONDS: Final = 60


class GscBusyError(ProblemError):
    """429 gsc_busy: our budget or Google's quota. `retry_after` is in seconds."""


class LiveStateError(Exception):
    """Google refused the token or the property: the caller answers stored rows with this state."""

    def __init__(self, state: Literal["reauth_required", "no_access"]) -> None: ...


@dataclass(slots=True)
class LiveGoogle:
    sessions: async_sessionmaker[AsyncSession]
    google: GoogleClient
    cipher: EnvelopeCipher
    facts: IntegrationFacts
    limiter: GscLimiter = API_LIMITER

    async def query(self, *, start: date, end: date, dimensions: Sequence[Dimension],
                    filters: Sequence[DimensionFilter], row_limit: int) -> list[AnalyticsRow]: ...


def live_google(resources: Resources, facts: IntegrationFacts) -> LiveGoogle | None:
    """None where this installation has no Google client or encryption key."""
```

`query` satisfies `gsc_page_detail.PageQuery`. Its steps: the access token (first use: read the refresh token with `vault.read` in a `workspace_transaction`, then `google.refresh`; keep it on the object); `wait = limiter.try_acquire(user=facts.account, site=facts.site_url)` and raise `GscBusyError(retry_after=ceil(wait))` when positive; call `google.search_analytics(..., data_state="final", aggregation="auto", filters=filters, row_limit=row_limit)`; on `GoogleUnauthorizedError` refresh once and try once more. Map errors: `GoogleQuotaError` (call `limiter.quota_exceeded(site=...)`, raise `GscBusyError(retry_after=QUOTA_RETRY_SECONDS)`), `GoogleInvalidGrantError` and `SecretUnreadableError` (`LiveStateError("reauth_required")`), `GooglePermissionError` (`LiveStateError("no_access")`), every other `GoogleError` (the same `503 google_unavailable` problem the integrations service raises: reuse its class and code, do not invent a second one). Declare `GscBusyError` the way `problems.py` declares a 429 with `retry_after`; if no problem carries `retry_after` yet, add the field to the problem body as an extension member named `retry_after` and say so in the task report. Build the `GoogleClient` in `live_google` exactly as `IntegrationService._google` does (same settings, same `resources.http`). Nothing here logs a token, a query text or a response body.

- [ ] **Step 4: Run** the two test files; ruff and mypy on the changed files. Expected: PASS.

- [ ] **Step 5: Review, fix, commit.** `git commit -m "Page search: the API asks Search Console for one page within its own budget"`

---

### Task 8: Tracked pages routes

**Read first:** spec sections 7.1 and 7.2 (the first five routes); `backend/src/idraft/api/fp/routes.py`, `service.py`, `repository.py` (the pattern); `backend/src/idraft/api/keywords/gsc_repository.py` `scope_of`; `backend/src/idraft/api/internal_links/page_tiers.py` `_site_hosts` and `_audit` (read only: learn how the project's hosts are found and how an audit row is written, then do the same through the project repository and `idraft.api.audit`, without importing a private name of that module); `backend/src/idraft/extraction/urls.py` `canonicalize`; `backend/tests/api/fp/test_ai_referrals.py` (how a route test is built).

**Files:**
- Create: `backend/src/idraft/api/fp/pages_repository.py`, `backend/src/idraft/api/fp/tracked.py`, `backend/src/idraft/api/fp/page_routes.py`, `backend/src/idraft/api/schemas/fp_pages.py`
- Modify: `backend/src/idraft/api/main.py`, `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Test: `backend/tests/api/fp/test_tracked_pages.py`, `backend/tests/api/fp/pages_support.py`

- [ ] **Step 1: Test support.** `pages_support.py`: helpers that seed a workspace and project with a primary host, a Search Console integration whose `backfill_state` is a `PullState` with `recent_done=True` and a given `window_end`, pages (`core.urls`, `core.project_pages` with an optional tier, an optional finished `core.crawl_runs` row with a `core.crawl_pages` row that has a title), `fp.gsc_page_daily` rows (`clicks`, `impressions`, `position_sum`) and markers. Use `PullState(...).write({})` to make the state, never a hand-written dict.

- [ ] **Step 2: Write the failing tests** (`test_tracked_pages.py`; `FINAL = date(2026, 11, 22)`):

1. `test_the_list_gives_each_tracked_page_its_numbers_health_and_trend`: `/pricing` with 31 October days summing to 317 clicks and 41,200 impressions and 30 September days summing to 412 and 39,600, with position sums that give 5.9 and 3.8. `GET .../fp/tracked-pages` with no query: `meta.window` is October, `meta.compare_window` September, the row has `current.clicks == 317`, `current.ctr == pytest.approx(317 / 41200)`, `current.position == pytest.approx(5.9)`, `health.verdict == "declining"`, `health.flags == ["position_slipped"]`, `len(trend) == 31`, `history == "loading"`, and `title`, `tier_id`, `path` as seeded. With a `history` marker: `history == "ready"`.
2. `test_compare_none_gives_no_previous`: `previous is None`, `compare_window is None`, verdict `stable`.
3. `test_a_period_before_the_first_stored_day_has_no_previous`: a `history` marker with `date_from` after the compared window's start gives `previous is None`.
4. `test_states`: no integration gives `meta.state == "not_connected"` with every number None and the rows still listed; an integration without `recent_done` gives `pending`; status `reauth_required` gives that state with numbers; status `error` gives `no_access` with numbers.
5. `test_a_window_over_92_days_is_refused`: `422 window_too_large`.
6. `test_adding_by_address_and_by_id`: the body of the spec example; outcomes `added`, `already_tracked`, `wrong_host`, plus `invalid_url` for `"not a url"` and `not_crawled` for an address of the host with no `core.project_pages` row; a path `/pricing` resolves against the project's host; `clicks_28d` is the stored sum of the 28 days ending on `FINAL`; an audit row `tracked_page.add` exists.
7. `test_dry_run_writes_nothing_and_says_ok`.
8. `test_the_limit_of_200`: with 199 tracked, adding three pages gives `added`, `over_limit`, `over_limit` in input order, and `meta.tracked == 200`.
9. `test_remove_and_ids`: `POST .../remove` returns `removed`, the `fp.gsc_page_daily` rows of the page are still there, `GET .../ids` lists the rest.
10. `test_suggestions_are_the_untracked_pages_with_the_most_clicks`: three pages with 28-day clicks 50, 400, 90, the second tracked: the answer is the page with 90 clicks, then the one with 50; at most 25 rows.
11. `test_a_viewer_cannot_add_or_remove`: `403` for a member without `projects:write`.

Add the five routes to `tests/api/test_route_access.py` (GETs: the permission of `fp/ai-referrals`; the two POSTs: `projects:write`, copied from the entry of `PUT .../pages/tiers`) and to the route table of `tests/security/test_cross_tenant.py` (model: the `fp/ai-referrals` entry).

Run: `uv run pytest -n 0 --no-cov tests/api/fp/test_tracked_pages.py`. Expected: FAIL.

- [ ] **Step 3: Schemas** (`api/schemas/fp_pages.py`, Pydantic, in the style of `schemas/fp.py`): `PageNumbers {clicks: int, impressions: int, ctr: float | None, position: float | None}`; `PageHealth {verdict, basis, change: float | None, absolute: float, small: bool, flags: list[str]}` with `Literal` types for verdict and basis; `SearchWindow {from_ (alias "from"), to, days}`; `SearchState = Literal["ok", "pending", "not_connected", "reauth_required", "no_access"]`; `SearchMeta {state, property: str | None, final_through: date | None, window: SearchWindow | None, compare_window: SearchWindow | None}`; `TrackedPageRow`, `TrackedPagesMeta(SearchMeta) {limit: int, tracked: int}`, `TrackedPagesResponse`; `TrackedIdsResponse`; `TrackPagesRequest {urls: list[str] (max 500), url_ids: list[str] (max 500), dry_run: bool = False}` refusing a body with neither; `TrackOutcome`, `TrackPagesResponse`; `UntrackRequest {url_ids: list[str]` 1 to 200`}`, `UntrackResponse`; `SuggestionRow`, `SuggestionsResponse`. Url ids are strings on the wire, as in `schemas/internal_links.py`: copy how that file types them. Give every field a short `description`: the web reads them in the generated client.

- [ ] **Step 4: Repository** (`pages_repository.py`). Every statement names the workspace and the project.

```python
@dataclass(frozen=True, slots=True)
class SearchScope:
    state: SearchState
    integration_id: UUID | None = None
    site_url: str | None = None
    final_through: date | None = None

async def search_scope(db, workspace_id, project_id) -> SearchScope
async def tracked_rows(db, workspace_id, project_id) -> list[TrackedRow]      # url_id, canonical_url, path, tier_id, added_at, title
async def page_row(db, workspace_id, project_id, url_id) -> TrackedRow | None  # one page of core.project_pages, plus `tracked: bool`
async def totals(db, scope, project_id, url_ids, window) -> dict[int, Totals]
async def series(db, scope, project_id, url_id, window) -> dict[date, Totals]
async def clicks_by_day(db, scope, project_id, url_ids, window) -> dict[int, dict[date, int]]
async def history_starts(db, scope, url_ids) -> dict[int, date]
async def suggestions(db, scope, workspace_id, project_id, window, limit) -> list[...]
```

- `search_scope`: the project's `gsc` integration that is not `disabled`, with its connection. None: `not_connected`. Integration or connection `reauth_required`: that state. Integration `error`: `no_access`. Otherwise `ok` when `PullState.read(...).window_end` is set and `recent_done`, else `pending`. `final_through` is `window_end` in every state that has one.
- `totals`: `sum(clicks)`, `sum(impressions)`, `sum(position_sum)`, and `sum(impressions) FILTER (WHERE position_sum IS NOT NULL)` grouped by `url_id`, into `domain.page_search.Totals`.
- `title`: a left join to `core.crawl_pages` of the project's latest finished crawl. Find how "latest finished" is decided by reading `api/internal_links/page_tiers.py` `crawl_scope` (state and ordering columns of `core.crawl_runs`) and write the same condition as a scalar subquery here. If `core.crawl_pages` has no title column, read `tables.py` for where the title is kept and say what you used in the report.

- [ ] **Step 5: Service and routes.** `TrackedPagesService(sessions)` in `tracked.py` with `list`, `ids`, `add`, `remove`, `suggestions`; a project outside the workspace is `NotFoundError`, checked as `FpService` checks it. `TRACKED_PAGES_LIMIT: Final = 200`.

- `list`: scope; with no `final_through` every number is None. Else `first, last = window_of(start, end, final_through)` (map `WindowTooLargeError` to the `422 window_too_large` problem that `fp/ai-referrals` raises, and the `ValueError` to the validation error that route gives for a start after an end); `compared = compare_window(first, last, compare)`; totals for both windows in two queries; `previous` is None when `compared` is None, or when the page's `history_starts` is None or later than `compared[0]` and the page has no row in the compared window; `health_of(current, previous, days, compared days)`; `trend` from `clicks_by_day`, one value per day of the window, 0 for a day without a row.
- `add`: per input, in order: a path (starts with `/`) is joined to `https://<primary host>`; `canonicalize` (failure: `invalid_url`); host not one of the project's hosts: `wrong_host`; no `core.urls` row by `url_hash` joined to `core.project_pages` of the project: `not_crawled`; already tracked or repeated in this request: `already_tracked`; room left: `added` (insert) or `ok` (dry run); else `over_limit`. `url_ids` follow the same checks from `not_crawled` on. One transaction; lock the count with `SELECT ... FOR UPDATE` on the project row (or an advisory lock keyed by the project) so two requests cannot pass 200 together. One audit row when anything was added.
- Routes in `page_routes.py`: `router = APIRouter(prefix=f"{PROJECT}/fp", tags=["first-party"])` with the five routes of the spec; `ReadData` and a `WriteProject` dependency declared as `page_tier_routes.py` declares its own; summaries and descriptions in plain sentences that state the rules of spec section 7.2. Include the router in `main.py` next to `fp_router`.

- [ ] **Step 6: Run** `uv run pytest -n 0 --no-cov tests/api/fp/test_tracked_pages.py tests/api/test_route_access.py`, and `tests/security/test_cross_tenant.py -k tracked`. Ruff, format check and mypy on `src/idraft/api/fp src/idraft/api/schemas/fp_pages.py tests/api/fp`. Expected: PASS.

- [ ] **Step 7: Review, fix, commit.** `git commit -m "Tracked pages: list with numbers and health, add, remove, ids and suggestions"`

---

### Task 9: Page search routes

**Read first:** spec section 7.2 (the two `page-search` routes) and section 9; task 5's module; task 7's `live.py`; task 8's repository and schemas.

**Files:**
- Create: `backend/src/idraft/api/fp/page_search.py`
- Modify: `backend/src/idraft/api/fp/page_routes.py`, `backend/src/idraft/api/schemas/fp_pages.py`, `backend/src/idraft/api/fp/pages_repository.py`, `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Test: `backend/tests/api/fp/test_page_search.py`

- [ ] **Step 1: Write the failing tests** (the app wired to `FakeSearchConsole` the way `tests/api/integrations` wires the fake Google into `Resources`; `pages_support.py` for the rows):

1. `test_a_page_with_stored_history_answers_without_asking_google`: a `history` marker and rows; the detail has totals, health and a point per day of the window; `fake.requests` is empty.
2. `test_a_day_without_a_row_is_zero_with_no_position`.
3. `test_the_first_open_fetches_the_history_then_answers_from_it`: no marker; `set_filtered(site, ("date",), rows)`; the response's `series` holds those rows, `meta.history_from` is set, one filtered request was made; a second request makes none.
4. `test_a_busy_budget_still_answers_stored_rows`: the service given a limiter with a spent bucket; `200`, `meta.history_from is None`, no request reached the fake.
5. `test_a_page_outside_the_project_is_not_found`: a url id with no `core.project_pages` row for this project: `404 not_found`. Same for another workspace's project.
6. `test_not_connected_and_pending_answer_200_with_no_numbers`.
7. `test_a_breakdown_is_fetched_once_and_served_from_the_store`: `dimension=country` with compare: two filtered `("country",)` requests (window and compared window), rows merged by key, ordered by current clicks, `previous` None for a key only in the current period and `current` None for one only in the previous; `ctr` and `position` computed from the sums; the second request reaches Google with nothing.
8. `test_coverage_is_the_rows_clicks_over_the_page_s_clicks`: query rows summing to 88 clicks, page total 100: `coverage == pytest.approx(0.88)`; a page with no clicks: `coverage is None`.
9. `test_a_breakdown_that_cannot_be_fetched_is_429_gsc_busy_with_retry_after` (spent bucket, no marker) and `test_a_stored_breakdown_is_served_when_the_budget_is_spent`.
10. `test_reauth_required_serves_stored_breakdowns_and_fetches_nothing`: state `reauth_required`, one stored period: its rows come back; an unstored period gives `200` with `data == []`.
11. `test_an_unknown_dimension_is_422`.

Add both routes to `test_route_access.py` and the cross-tenant table. Run. Expected: FAIL.

- [ ] **Step 2: Implement** `PageSearchService` in `page_search.py`:

```python
class PageSearchService:
    def __init__(self, *, sessions, live: Callable[[IntegrationFacts], LiveGoogle | None]) -> None: ...
    async def detail(self, access, project_id, url_id, query: PageQuery) -> PageSearchResponse: ...
    async def breakdown(self, access, project_id, url_id, dimension, query: PageQuery) -> PageBreakdownResponse: ...
```

`detail`: project check, `page_row` (None: `NotFoundError`), `search_scope`. With `state == "ok"` and no history marker: load the `IntegrationFacts` (`gsc_store.load_integration`), build the live caller, `ensure_history(...)`; catch `GscBusyError` and the `503` problem and go on with stored rows; catch `LiveStateError` and answer with its state. Then totals, compared totals, health and both series exactly as task 8 computes them for one page (share the helper, do not copy it). `previous_series` is aligned to the compared window's own days.

`breakdown`: the same checks. For each of the window and the compared window: if `state == "ok"` and the dimension has no marker, `ensure_breakdown(..., only=(dimension,))`; here `GscBusyError` and the `503` problem are raised to the client, and `LiveStateError` answers stored rows with its state. Read the stored rows of both windows (add `breakdown_rows(db, scope, url_id, window, dimension) -> dict[str, Totals]` and `fetch_marker(...)` to the repository), merge keys, order by current clicks descending, then previous clicks descending, then key. `coverage`: sum of current rows' clicks over the page's clicks of the window, None when the page's clicks are 0, capped at 1.0. `row_limit` from `ROW_LIMITS`; `truncated` and `fetched_at` from the current window's marker (None before a fetch).

Routes: `GET /page-search/{url_id}` and `GET /page-search/{url_id}/breakdown` with `dimension: Literal["query", "country", "device"]`, `from`, `to`, `compare` (default `previous_period`). The dependency that builds the service passes `lambda facts: live_google(resources, facts)`.

- [ ] **Step 3: Run** `uv run pytest -n 0 --no-cov tests/api/fp/test_page_search.py tests/api/fp/test_tracked_pages.py tests/api/test_route_access.py` and `tests/security/test_cross_tenant.py -k "page_search or tracked"`. Ruff, format check, mypy. Expected: PASS.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Page search: a page's totals, health, daily series and breakdowns"`

---

### Task 10: The contract

**Files:**
- Modify: `backend/openapi/v1.json`, `docs/19-api-specification.md`

- [ ] **Step 1:** From `backend/`: `uv run python -m idraft.api.openapi > openapi/v1.json`.
- [ ] **Step 2:** `uv run pytest -n 0 --no-cov tests/api/test_openapi.py`. Expected: PASS. `git diff --stat openapi/v1.json` shows only the seven new paths and the new schemas.
- [ ] **Step 3:** In `docs/19-api-specification.md` section 3.10: replace the sentence that begins "The per-URL Search Console routes `{P}/page-performance/*`" by one that names the spec of 2026-11-26, and add seven rows to the first-party table (method, path, permission, request, response in one line each, errors `422 window_too_large`, `429 gsc_busy`, `503 google_unavailable`, phase 11). No dashes.
- [ ] **Step 4: Review, commit.** `git commit -m "OpenAPI and the API catalog: tracked pages and page search"`

If this branch is merged with another branch that changed `backend/openapi/v1.json`, never merge the file by hand: take either side and run step 1 again.

## Self-review

- Spec D1: task 3. D2: tasks 5, 6, 9. D3: tasks 5, 6, 9. D4: tasks 3, 5. D5: task 7. D6, D7, D12, D13: task 4. D8, D9, D10, D11: tasks 2, 8. D15: tasks 8, 9. Section 5.5 retention: tasks 3, 5, 6. Section 8: task 6. Section 14: tasks 2, 8, 9 (access and cross-tenant rows).
- Not in this plan by design (spec section 13): URL Inspection, shape D, search appearance, sitemap import, export route.
