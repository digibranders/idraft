"""Helpers for the page search and Monitoring route tests: a project with a website, a Search
Console integration in a given state, pages, daily rows and markers written directly, so a route
test needs no worker and no Google."""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from decimal import Decimal

from idraft.domain.gsc_pull import PullState
from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.internal_links.support import seed_crawl, set_website, url_id
from tests.collectors.gsc_support import REDIRECT, make_property
from tests.conftest import PostgresServer
from tests.providers.google.fake_google import FakeGoogle

FINAL = date(2026, 11, 22)
HOST = "example.com"


async def connect(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    *,
    window_end: date | None = FINAL,
    recent_done: bool = True,
    status: str = "active",
    connection_status: str = "active",
) -> uuid.UUID:
    """A Search Console property of the project (an active connection with a stored secret, made
    by the pull tests' helper) whose pull is in the given state."""
    prop = await make_property(pg, FakeGoogle(REDIRECT), workspace=workspace, project_id=project_id)
    state = PullState(recent_done=recent_done, window_end=window_end).write({})
    await execute(
        pg,
        "UPDATE fp.integrations SET status = $2, backfill_state = $3::jsonb WHERE id = $1",
        prop.integration_id,
        status,
        json.dumps(state),
    )
    await execute(
        pg,
        "UPDATE fp.connections SET status = $2 WHERE id = $1",
        prop.connection_id,
        connection_status,
    )
    return prop.integration_id


async def seed_pages(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    titles: Mapping[str, str | None],
    *,
    tiers: Mapping[str, uuid.UUID] | None = None,
) -> dict[str, int]:
    """The project's website, and the pages `titles` names (path to title): each has a row in
    `core.project_pages` and one in a finished crawl. Returns the url id of each path."""
    await set_website(pg, project_id, HOST)
    run_id, ids = await seed_crawl(pg, workspace, project_id, [(path, 200) for path in titles])
    for path, title in titles.items():
        await execute(
            pg,
            "UPDATE seo.crawl_pages SET title = $3 WHERE run_id = $1 AND url_id = $2",
            run_id,
            ids[path],
            title,
        )
        tier = (tiers or {}).get(path)
        await execute(
            pg,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project_id,
            ids[path],
            workspace.id,
            tier,
        )
    return ids


async def uncrawled_url(pg: PostgresServer, path: str) -> int:
    """A `core.urls` row of the website that is no page of the project."""
    return await url_id(pg, f"https://{HOST}{path}")


async def track(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, ids: Sequence[int]
) -> None:
    await execute(
        pg,
        "INSERT INTO core.tracked_pages (project_id, url_id, workspace_id) "
        "SELECT $1, u, $2 FROM unnest($3::bigint[]) AS u",
        project_id,
        workspace.id,
        list(ids),
    )


async def bulk_pages(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    count: int,
    *,
    tracked: bool,
    integration_id: uuid.UUID | None = None,
    clicks: int | None = None,
) -> list[int]:
    """`count` pages `/bulk-N` of the website, tracked or not, each with one day of `clicks` at
    the last final day when asked. One statement a table, for the limit tests."""
    await set_website(pg, project_id, HOST)
    row = await fetchrow(
        pg,
        "WITH made AS (INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, "
        "canonicalizer_version) SELECT sha256(convert_to($2 || '/bulk-' || n, 'UTF8')), "
        "'https://' || $2 || '/bulk-' || n, d.id, '/bulk-' || n, 1 "
        "FROM generate_series(1, $1::int) AS n, core.domains d WHERE d.host = $2 "
        "ON CONFLICT (url_hash) DO UPDATE SET path = excluded.path RETURNING id) "
        "SELECT array_agg(id ORDER BY id) AS ids FROM made",
        count,
        HOST,
    )
    ids: list[int] = list(row["ids"])
    await execute(
        pg,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_source) "
        "SELECT $1, u, $2, 'manual' FROM unnest($3::bigint[]) AS u",
        project_id,
        workspace.id,
        ids,
    )
    if tracked:
        await track(pg, workspace, project_id, ids)
    if clicks is not None:
        assert integration_id is not None
        await execute(
            pg,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
            "project_id, clicks, impressions, position_sum) "
            "SELECT $1, $2, u, $3, $4, $5, $5 * 10, $5 * 10 * 3 FROM unnest($6::bigint[]) AS u",
            integration_id,
            FINAL,
            workspace.id,
            project_id,
            clicks,
            ids,
        )
    return ids


async def days(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    integration_id: uuid.UUID,
    page: int,
    first: date,
    clicks: Sequence[int],
    impressions: Sequence[int],
    position: str | None,
) -> None:
    """One row a day from `first`; `position` is the day's average, stored as position times
    impressions, or None for rows stored before positions were kept."""
    dates = [first + timedelta(days=offset) for offset in range(len(clicks))]
    sums = [
        None if position is None else Decimal(position) * impression for impression in impressions
    ]
    await execute(
        pg,
        "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
        "project_id, clicks, impressions, position_sum) SELECT $1, d, $2, $3, $4, c, i, p "
        "FROM unnest($5::date[], $6::int[], $7::int[], $8::numeric[]) AS t(d, c, i, p)",
        integration_id,
        page,
        workspace.id,
        project_id,
        dates,
        list(clicks),
        list(impressions),
        sums,
    )


async def marker(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    integration_id: uuid.UUID,
    page: int,
    kind: str,
    start: date,
    end: date,
    *,
    query_count: int | None = None,
    capped: bool = False,
) -> None:
    """A row of `fp.gsc_page_fetches`. A `query` marker carries its count, any other none."""
    await execute(
        pg,
        "INSERT INTO fp.gsc_page_fetches (integration_id, url_id, kind, date_from, date_to, "
        "workspace_id, project_id, row_count, query_count, query_count_capped) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)",
        integration_id,
        page,
        kind,
        start,
        end,
        workspace.id,
        project_id,
        query_count,
        capped,
    )
