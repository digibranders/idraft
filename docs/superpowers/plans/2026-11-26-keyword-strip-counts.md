# Keyword Strip Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Keywords list reads its six strip counts in one request instead of six, so the page makes five fewer requests and one fewer network wave.

**Architecture:** The list route `GET /tracked-keywords` already takes about 30 filter parameters and an `include` list of optional blocks. Add `counts` to `include`: when asked, the response's `page` also holds `counts`, computed in one SQL statement over the same filtered set with `count(*) FILTER (WHERE ...)`. The web strip then sends one `limit=1&include=counts` read, and the arithmetic that decides which counts the filters rule out (`stripQueries` in the web app) is replaced by the SQL itself.

**Tech Stack:** FastAPI, SQLAlchemy Core, pytest with Testcontainers; Next.js 16, TanStack Query, openapi-typescript.

---

## Why

Measured on 2026-11-26 in the signed-in browser: the Keywords list makes 22 requests in 4 to 5 waves and finishes at 2.6 to 2.8 s. Seven of them are `tracked-keywords?limit=1` reads made only to read `page.total`: six strip counts (`apps/web/src/features/rankings/strip/strip-queries.ts:53-61`) and `useTrackedCount` (`rankings-queries.ts:439-442`). Each wave costs 250 to 450 ms of network, and a burst of requests competes for the 10 API connections.

## Rules for whoever executes this

- Work on `develop`. Never ship; release only when the owner says so.
- Targeted serial tests only (`-n 0 --no-cov <path>`), and Docker through Colima (export the two variables in `AGENTS.md` first).
- Backend commits update `backend/openapi/v1.json`; the web client is regenerated in its own commit right after (`pnpm gen:api` in `apps/web`).
- A session works on `features/ai-overview` at the same time. This plan touches only `features/rankings` and the keywords API.
- Use the file tools to edit, not shell heredocs. After each task, an independent review on Sonnet.

## What the counts mean

All six are counts of tracked keywords inside the list's current filters (`filters.conditions`), using the rank column `STATE.current_rank`:

| Count | Condition added to the filters |
|---|---|
| `total` | none |
| `ranked` | `current_rank IS NOT NULL` |
| `beyond` | `current_rank IS NULL` |
| `top3` | `current_rank <= 3` |
| `top10` | `current_rank <= 10` |
| `top20` | `current_rank <= 20` |

A count the filters rule out (for example `top3` under `rank_gte=5`) comes out 0 by itself, which is what `stripQueries` computes by hand today. One difference to check in Task 1: the web today sends `beyond` as `rank_is_null=true`, and `filters.py:284-294` says how a null rank interacts with the other rank filters; the test in Task 1 pins the behaviour.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `backend/src/idraft/api/schemas/keywords.py` | Modify | `counts` in `TrackedInclude`; `TrackedKeywordCounts`; optional `counts` on `TrackedKeywordPageInfo` |
| `backend/src/idraft/api/keywords/repository.py` | Modify | `count_buckets`: the one statement |
| `backend/src/idraft/api/keywords/service.py` | Modify | `page()` calls it when `counts` is in `include` |
| `backend/src/idraft/api/keywords/routes.py` | Modify | Passes the counts through to `TrackedKeywordPageInfo` |
| `backend/tests/api/keywords/test_tracked_keyword_counts.py` | Create | The behaviour, through the API |
| `backend/openapi/v1.json` | Regenerate | The contract |
| `apps/web/src/lib/api/schema.ts` | Regenerate | `pnpm gen:api` |
| `apps/web/src/features/rankings/strip/strip-queries.ts` | Modify | One query instead of six |
| `apps/web/src/features/rankings/strip/strip-queries.test.ts` | Modify | Matches the new shape |

---

### Task 1: The counts in the list response (backend)

**Files:**
- Modify: `backend/src/idraft/api/schemas/keywords.py:234-245` and `:539`
- Modify: `backend/src/idraft/api/keywords/repository.py` (next to `count_tracked`, about line 559)
- Modify: `backend/src/idraft/api/keywords/service.py:700-743`
- Modify: `backend/src/idraft/api/keywords/routes.py:420-430`
- Test: `backend/tests/api/keywords/test_tracked_keyword_counts.py`

- [ ] **Step 1: Read the helpers the test needs**

```bash
sed -n 1,80p backend/tests/api/keywords/support.py
grep -n "def " backend/tests/api/keywords/support.py
```

Note the helper that creates tracked keywords with a rank (look for `tracked_id` and for how `test_keywords.py` seeds `seo.tracked_keyword_state.current_rank`). Use those; do not invent fixtures.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/api/keywords/test_tracked_keyword_counts.py`. Seed five keywords of one project with current ranks 2, 8, 15, 40 and none (beyond depth), then assert, using the helpers found in Step 1:

```python
"""The strip counts of the keyword list (include=counts): one read for six counts."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

RANKS = [2, 8, 15, 40, None]  # top3, top10, top20, ranked deeper, beyond depth


async def _seeded(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = await keyword_project(pg, workspace)
    await _track_with_ranks(pg, workspace, project, RANKS)  # write with the helper from Step 1
    return workspace, project, owner


async def _counts(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, caller: Caller, **query: str
) -> dict[str, int]:
    response = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"limit": "1", "include": "counts", **query},
        headers=caller.headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()["page"]
    assert body["total"] == body["counts"]["total"]
    counts: dict[str, int] = body["counts"]
    return counts


async def test_the_counts_split_the_filtered_keywords_by_rank(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _seeded(resources, migrated)
    assert await _counts(api, workspace, project, owner) == {
        "total": 5, "ranked": 4, "beyond": 1, "top3": 1, "top10": 2, "top20": 3,
    }


async def test_a_count_the_filters_rule_out_is_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _seeded(resources, migrated)
    counts = await _counts(api, workspace, project, owner, **{"filter[rank_gte]": "10"})
    assert (counts["top3"], counts["top10"], counts["beyond"]) == (0, 0, 0)
    assert counts["top20"] == 1


async def test_the_counts_are_left_out_unless_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _seeded(resources, migrated)
    response = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"limit": "1"},
        headers=owner.headers,
    )
    assert "counts" not in response.json()["page"] or response.json()["page"]["counts"] is None
```

`_track_with_ranks` is written in this step from the Step 1 helpers (insert the tracked keywords and their `tracked_keyword_state.current_rank`); it is the only fixture code, and it must use the repository's own seed helpers, not raw guesses at columns. The expected numbers: `ranked` counts ranks 2, 8, 15 and 40; `top20` counts 2, 8 and 15; under `rank_gte=10` only 15 and 40 remain, so `top20` is 1 and the rest are 0.

- [ ] **Step 3: Run it and see it fail**

```bash
cd backend && uv run pytest -n 0 --no-cov tests/api/keywords/test_tracked_keyword_counts.py -q
```

Expected: FAIL with `422` (the `counts` include is not known yet).

- [ ] **Step 4: Schema**

In `backend/src/idraft/api/schemas/keywords.py`, add `"counts"` to the `TrackedInclude` Literal after `"aio"`, then replace `TrackedKeywordPageInfo`:

```python
class TrackedKeywordCounts(BaseModel):
    """The strip counts of the list, over the keywords its filters match (`include=counts`)."""

    total: int
    ranked: int = Field(description="Ranked at the latest check.")
    beyond: int = Field(description="Beyond the depth at the latest check.")
    top3: int
    top10: int
    top20: int


class TrackedKeywordPageInfo(CursorPageInfo):
    total: int
    counts: TrackedKeywordCounts | None = Field(
        default=None, description="Present only when `include` asks for `counts`."
    )
```

- [ ] **Step 5: Repository**

In `backend/src/idraft/api/keywords/repository.py`, after `count_tracked`, add (use the rank column and `_listed` exactly as `filters.py` does; import `STATE` the way `filters.py` does):

```python
async def count_buckets(
    db: AsyncSession, workspace_id: UUID, conditions: Sequence[ColumnElement[bool]]
) -> dict[str, int]:
    """The strip counts of a filtered list in one statement: the filtered keywords, and how many
    of them ranked, are beyond the depth, or rank in the top 3, 10 and 20."""
    rank = STATE.current_rank
    row = (
        await db.execute(
            _listed(workspace_id)
            .with_only_columns(
                func.count().label("total"),
                func.count().filter(rank.is_not(None)).label("ranked"),
                func.count().filter(rank.is_(None)).label("beyond"),
                func.count().filter(rank <= 3).label("top3"),
                func.count().filter(rank <= 10).label("top10"),
                func.count().filter(rank <= 20).label("top20"),
                maintain_column_froms=False,
            )
            .where(*conditions)
        )
    ).one()
    return {name: int(value) for name, value in row._mapping.items()}
```

- [ ] **Step 6: Service and route**

In `service.py`, in `page()` right after `total = await repository.count_tracked(...)` add:

```python
            counts = (
                await repository.count_buckets(db, access.workspace_id, where)
                if "counts" in include
                else None
            )
```

add `counts: dict[str, int] | None = None` to `TrackedPageResult` (defined near `service.py:203`) and return it: `TrackedPageResult(rows=rows, next_cursor=next_cursor, total=total, counts=counts)`.

In `routes.py`, in the `TrackedKeywordPageInfo(...)` call add:

```python
            counts=None if result.counts is None else TrackedKeywordCounts(**result.counts),
```

and import `TrackedKeywordCounts` with the other schema imports.

- [ ] **Step 7: Run the test, then the neighbours**

```bash
uv run pytest -n 0 --no-cov tests/api/keywords/test_tracked_keyword_counts.py tests/api/keywords/test_keywords.py tests/api/keywords/test_tracked_keyword_countries.py -q
```

Expected: all PASS.

- [ ] **Step 8: Regenerate the contract, lint, commit**

Find how the OpenAPI file is produced (`grep -rn "v1.json" backend/tests backend/check.sh backend/pyproject.toml` shows the export command or the test that fails when it is stale), regenerate it, then:

```bash
uv run ruff check src tests/api/keywords && uv run ruff format --check src tests/api/keywords && uv run mypy src/idraft/api/keywords src/idraft/api/schemas/keywords.py tests/api/keywords/test_tracked_keyword_counts.py
git add backend/src/idraft/api/schemas/keywords.py backend/src/idraft/api/keywords backend/tests/api/keywords/test_tracked_keyword_counts.py backend/openapi/v1.json
git commit -m "Tracked keywords: include=counts returns the strip counts of the filtered list in one statement"
```

### Task 2: The strip reads one request (web)

**Files:**
- Modify: `apps/web/src/lib/api/schema.ts` (regenerated)
- Modify: `apps/web/src/features/rankings/strip/strip-queries.ts`
- Modify: `apps/web/src/features/rankings/strip/strip-queries.test.ts`

- [ ] **Step 1: Regenerate the client**

```bash
cd apps/web && pnpm gen:api
git diff --stat src/lib/api/schema.ts
```

Expected: `counts` on the page info and in the include enum. Commit as its own commit: `git add apps/web/src/lib/api/schema.ts && git commit -m "Web: regenerate the API client for include=counts"`.

- [ ] **Step 2: Write the failing test**

Read `strip-queries.test.ts` for its current style, then replace the tests of `stripQueries` with a test of the new hook shape: given a mocked `readPage` that returns `{ page: { total: 5, counts: { total: 5, ranked: 4, beyond: 1, top3: 1, top10: 2, top20: 3 } } }`, `useStripCounts` calls `readPage` exactly once with `include: ['counts']` and `limit: 1`, and returns those six numbers.

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/rankings/strip/strip-queries.test.ts
```

- [ ] **Step 4: Replace the six queries with one**

In `strip-queries.ts`, delete `TOPS`, `DEEPEST` and `stripQueries`; keep `STRIP_COUNTS` and `StripCount`. Replace `useStripCounts` with:

```ts
/** The six counts, read in one request that carries the list's filters. */
export function useStripCounts(scope: ProjectScope, filters: KeywordFilters, enabled: boolean): StripCounts {
  const result = useQuery({
    queryKey: [...keywordsKey(scope), filters, 'strip'],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { page } = await readPage(scope, { ...filters, limit: 1, include: ['counts'] }, signal);
      return page.counts ?? null;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
  const counts: Record<StripCount, number | null> | null =
    result.isPending || result.data === undefined ? null : (result.data ?? null);
  return {
    counts,
    itemErrors: Object.fromEntries(STRIP_COUNTS.map((id) => [id, result.isError])) as Record<StripCount, boolean>,
    loading: result.isPending,
    fetching: result.isFetching,
    error: result.isError,
    refetch: async () => {
      await result.refetch();
    },
  };
}
```

Change the import at the top to `import { useQuery } from '@tanstack/react-query';`. If `ListQuery` does not accept `include` as an array, follow how `rankings-queries.ts` already passes `include` for the list read and do the same.

- [ ] **Step 5: Check the callers and run the checks for the folder**

```bash
cd apps/web && grep -rn "stripQueries\|useStripCounts" src | grep -v "strip-queries"
pnpm vitest run src/features/rankings && pnpm typecheck && pnpm lint
```

Expected: no remaining caller of `stripQueries`; everything passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/rankings/strip
git commit -m "Keywords strip: one include=counts read replaces six limit=1 reads"
```

### Task 3: Measure

- [ ] **Step 1: After the owner releases**, load `https://app.idraft.ai/digibranders/eventus-security/seo/keywords` in the signed-in browser and read the request list.

Expected: `tracked-keywords` calls fall from 8 to 3 (the list read, the strip read, `useTrackedCount`), requests from 22 to 17, and the last response arrives earlier than the 2.6 s measured on 2026-11-26.

## Left for later

`useTrackedCount` (the page meta line) still sends its own `limit=1` read; the total of the unfiltered project could come from the same request when no filter is set. Not worth the coupling today.
