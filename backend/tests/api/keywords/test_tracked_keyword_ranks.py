"""The rank state of tracked keywords (plan Task 7, decisions R23 to R27): the `state` of every
row and of the detail, the rank filters and sorts, and the rank blocks of `include`."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api.resources import Resources
from sightline.collectors.seo_rank_ingest import ingest
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import errors, keyword_project, project_url, tracked_id
from tests.collectors.rank_support import (
    OWN_HOST,
    RIVAL_HOST,
    World,
    _entity,
    answer,
    fetched_task,
)
from tests.collectors.support import NOW, Project, empty_ledger
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import BASE_URL, PostgresServer

DAY = timedelta(days=1)
Ledger = async_sessionmaker[AsyncSession]


@pytest.fixture
async def worker_db(migrated: PostgresServer, redis_url: str) -> AsyncIterator[Ledger]:
    # An empty ledger and registry: identical stored answers are registered once, and the
    # object of an earlier test's store would be missing from this one.
    await empty_ledger(migrated)
    settings = Settings(
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url("app_worker")),
        redis_url=SecretStr(redis_url),
        db_pool_size=4,
        log_level="critical",
        app_env="test",
    )
    engine = create_engine(settings)
    yield create_session_factory(engine)
    await engine.dispose()


async def _world(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller, World]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project_id = await keyword_project(pg, workspace)
    project = Project(workspace.id, project_id)
    world = World(
        project,
        own=await _entity(pg, project, "Acme", OWN_HOST, "own", primary=True),
        rival=await _entity(pg, project, "Rival", RIVAL_HOST, "competitor"),
    )
    return workspace, project_id, owner, world


def _results(own_at: int | None, rival_at: int | None = None, total: int = 12) -> list[str]:
    total = max(total, own_at or 0, rival_at or 0)
    urls = [f"https://elsewhere-{i}.example/page" for i in range(1, total + 1)]
    if own_at is not None:
        urls[own_at - 1] = f"https://www.{OWN_HOST}/pricing"
    if rival_at is not None:
        urls[rival_at - 1] = f"https://{RIVAL_HOST}/crm"
    return urls


async def _check(
    sessions: Ledger,
    pg: PostgresServer,
    world: World,
    tracked: str,
    urls: list[str],
    *,
    days_ago: int = 0,
    extra: list[dict[str, Any]] | None = None,
    depth: int = 20,
) -> None:
    store = MemoryStore()
    when = NOW - days_ago * DAY
    await fetched_task(
        sessions,
        pg,
        world,
        uuid.UUID(tracked),
        answer(urls, when=when, extra=extra, depth=depth),
        store,
        fetched_at=when,
    )
    await ingest(sessions, store)


async def _list(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, caller: Caller, **params: Any
) -> list[dict[str, Any]]:
    response = await api.get(
        project_url(workspace, project, "tracked-keywords"), params=params, headers=caller.headers
    )
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["data"]
    return rows


def _texts(rows: list[dict[str, Any]]) -> list[str]:
    return [row["keyword"]["text"] for row in rows]


async def test_a_keyword_never_checked_is_not_checked_and_has_a_first_check_change(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, _ = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")

    (row,) = await _list(api, workspace, project, owner)
    detail = await api.get(
        project_url(workspace, project, "tracked-keywords", tracked), headers=owner.headers
    )

    for state in (row["state"], detail.json()["data"]["state"]):
        assert state["current"] == {
            "state": "not_checked",
            "rank": None,
            "absolute_rank": None,
            "depth_requested": None,
            "url": None,
            "observed_at": None,
            "serp_snapshot_id": None,
        }
        assert state["change"]["label"] == "first_check"
        assert (state["last_observed_at"], state["ranking_url_count"]) == (None, 0)
        assert state["aio"]["state"] == "unknown"
    assert row["sparkline"] is None
    assert row["competitor_ranks"] is None


async def test_a_checked_keyword_shows_its_rank_change_and_urls(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    await _check(worker_db, migrated, world, tracked, _results(12, 8), days_ago=1)
    await _check(worker_db, migrated, world, tracked, _results(4, 8))

    (row,) = await _list(api, workspace, project, owner)

    state = row["state"]
    assert state["current"]["state"] == "ranked"
    assert (state["current"]["rank"], state["current"]["depth_requested"]) == (4, 20)
    assert state["current"]["url"]["path"] == "/pricing"
    assert state["current"]["url"]["host"] == f"www.{OWN_HOST}"
    assert state["change"] == {
        "value": 8,
        "label": "numeric",
        "previous_rank": 12,
        "previous_observed_at": (NOW - DAY).isoformat().replace("+00:00", "Z"),
    }
    assert (state["best_rank"], state["worst_rank"]) == (4, 12)
    assert state["ranking_url_count"] == 1
    assert state["aio"]["state"] == "absent"
    assert state["is_stale"] is False
    assert state["current"]["serp_snapshot_id"] is not None


async def test_a_keyword_beyond_the_depth_is_beyond_depth_not_unranked(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    await _check(worker_db, migrated, world, tracked, _results(None))

    (row,) = await _list(api, workspace, project, owner)

    assert row["state"]["current"]["state"] == "beyond_depth"
    assert row["state"]["current"]["rank"] is None
    assert row["state"]["current"]["depth_requested"] == 20


@pytest.fixture
async def ranked(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> tuple[Workspace, uuid.UUID, Caller, World]:
    """Keywords `a` (rank 3, up from 9), `b` (rank 15, down from 6), `c` (beyond the depth,
    ranked before), `d` (rank 7, first check) and `e` (never checked)."""
    workspace, project, owner, world = await _world(resources, migrated)
    ids = {
        name: await tracked_id(api, workspace, project, owner, name)
        for name in ("a", "b", "c", "d", "e")
    }
    for name, before, now in (("a", 9, 3), ("b", 6, 15), ("c", 5, None)):
        await _check(worker_db, migrated, world, ids[name], _results(before), days_ago=1)
        await _check(worker_db, migrated, world, ids[name], _results(now))
    await _check(worker_db, migrated, world, ids["d"], _results(7))
    return workspace, project, owner, world


async def test_the_rank_filters(
    api: httpx.AsyncClient,
    ranked: tuple[Workspace, uuid.UUID, Caller, World],
) -> None:
    workspace, project, owner, _ = ranked

    async def texts(**params: Any) -> list[str]:
        return _texts(await _list(api, workspace, project, owner, **params))

    assert await texts(**{"filter[rank_lte]": 7}) == ["a", "d"]
    assert await texts(**{"filter[rank_gte]": 7}) == ["b", "d"]
    assert await texts(**{"filter[rank_is_null]": "true"}) == ["c"]
    assert await texts(**{"filter[rank_is_null]": "false"}) == ["a", "b", "d"]
    assert await texts(**{"filter[improved]": "true"}) == ["a"]
    assert await texts(**{"filter[declined]": "true"}) == ["b"]
    assert await texts(**{"filter[rank_change_label_in]": "numeric"}) == ["a", "b"]
    assert await texts(**{"filter[rank_change_label_in]": "lost"}) == ["c"]
    assert await texts(**{"filter[rank_change_label_in]": "first_check"}) == ["d", "e"]
    assert await texts(**{"filter[rank_change_label_in]": "lost,first_check"}) == ["c", "d", "e"]
    assert await texts(**{"filter[aio_state]": "absent"}) == ["a", "b", "c", "d"]
    assert await texts(**{"filter[is_stale]": "true"}) == []
    assert await texts(**{"filter[target_url_match]": "true"}) == []


async def test_a_keyword_without_a_numeric_change_is_neither_improved_nor_declined(
    api: httpx.AsyncClient, ranked: tuple[Workspace, uuid.UUID, Caller, World]
) -> None:
    workspace, project, owner, _ = ranked

    async def texts(**params: Any) -> list[str]:
        return _texts(await _list(api, workspace, project, owner, **params))

    assert await texts(**{"filter[improved]": "false"}) == ["b", "c", "d", "e"]
    assert await texts(**{"filter[declined]": "false"}) == ["a", "c", "d", "e"]
    # What a row shows as unknown or not stale is what the filters match.
    assert await texts(**{"filter[aio_state]": "unknown"}) == ["e"]
    assert await texts(**{"filter[is_stale]": "false"}) == ["a", "b", "c", "d", "e"]
    ranking_url = (await _list(api, workspace, project, owner))[0]["state"]["current"]["url"]
    assert await texts(**{"filter[ranking_url_id]": ranking_url["url_id"]}) == ["a", "b", "d"]


async def test_features_and_failures_are_filterable_and_shown(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    with_video = await tracked_id(api, workspace, project, owner, "with video")
    plain = await tracked_id(api, workspace, project, owner, "plain")
    failing = await tracked_id(api, workspace, project, owner, "failing")
    video = {
        "type": "video",
        "rank_absolute": 2,
        "position": "left",
        "items": [{"url": f"https://www.{OWN_HOST}/video"}, {"url": f"https://{RIVAL_HOST}/v"}],
    }
    await _check(worker_db, migrated, world, with_video, _results(4), extra=[video])
    await _check(worker_db, migrated, world, plain, _results(4))
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
        "consecutive_failures, is_stale) SELECT id, workspace_id, project_id, 3, true "
        "FROM seo.tracked_keywords WHERE id = $1",
        uuid.UUID(failing),
    )

    async def texts(**params: Any) -> list[str]:
        return _texts(await _list(api, workspace, project, owner, **params))

    assert await texts(**{"filter[feature_present]": "video"}) == ["with video"]
    assert await texts(**{"filter[feature_owned]": "video"}) == ["with video"]
    assert await texts(**{"filter[feature_owned]": "local_pack"}) == []
    assert await texts(**{"filter[is_stale]": "true"}) == ["failing"]
    (row,) = [
        r for r in await _list(api, workspace, project, owner) if r["keyword"]["text"] == "failing"
    ]
    assert row["state"]["current"]["state"] == "failed"
    assert row["state"]["change"]["label"] == "first_check"
    assert row["state"]["consecutive_failures"] == 3


async def test_a_competitor_removed_from_the_project_is_not_shown_on_the_row(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    await _check(worker_db, migrated, world, tracked, _results(4, 6))
    shown = await _list(api, workspace, project, owner, include="competitor_ranks")
    assert len(shown[0]["competitor_ranks"]) == 1

    await execute(
        migrated,
        "UPDATE core.project_entities SET removed_at = now() WHERE entity_id = $1",
        world.rival,
    )

    (row,) = await _list(api, workspace, project, owner, include="competitor_ranks")
    assert row["competitor_ranks"] == []


async def test_the_change_label_filter_agrees_with_the_label_a_row_shows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The label is derived in Python for display and in SQL for the filter: over every pair of
    ranks and depths the two say the same."""
    workspace, project, owner, _ = await _world(resources, migrated)
    cases = [
        (previous, previous_depth, current, depth)
        for previous in (None, 4, 30)
        for previous_depth in (20, 100)
        for current in (None, 4, 30)
        for depth in (20, 100)
        if (current is None or current <= depth)
        and (previous is None or previous <= previous_depth)
    ]
    tracked = {}
    for number, case in enumerate(cases):
        tracked[await tracked_id(api, workspace, project, owner, f"kw {number}")] = case
    for tracked_key, (previous, previous_depth, current, depth) in tracked.items():
        await execute(
            migrated,
            "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
            "last_observed_at, current_rank, current_depth_requested, previous_rank, "
            "previous_observed_at, previous_depth_requested) "
            "SELECT id, workspace_id, project_id, now(), $2, $3, $4, now() - interval '1 day', $5 "
            "FROM seo.tracked_keywords WHERE id = $1",
            uuid.UUID(tracked_key),
            current,
            depth,
            previous,
            previous_depth,
        )

    rows = await _list(api, workspace, project, owner, limit=200)

    by_label: dict[str, set[str]] = {}
    for row in rows:
        by_label.setdefault(row["state"]["change"]["label"], set()).add(row["tracked_keyword_id"])
    assert set(by_label) == {
        "numeric",
        "new",
        "lost",
        "consistent_beyond",
        "unchanged_beyond",
    }
    for label, expected in by_label.items():
        found = await _list(
            api, workspace, project, owner, limit=200, **{"filter[rank_change_label_in]": label}
        )
        assert {row["tracked_keyword_id"] for row in found} == expected, label


async def test_a_rank_sorts_beyond_depth_and_unchecked_last_both_ways(
    api: httpx.AsyncClient, ranked: tuple[Workspace, uuid.UUID, Caller, World]
) -> None:
    workspace, project, owner, _ = ranked

    ascending = _texts(await _list(api, workspace, project, owner, sort="current_rank"))
    descending = _texts(await _list(api, workspace, project, owner, sort="-current_rank"))
    by_change = _texts(await _list(api, workspace, project, owner, sort="-rank_change"))
    by_best = _texts(await _list(api, workspace, project, owner, sort="best_rank"))
    by_time = _texts(await _list(api, workspace, project, owner, sort="-last_observed_at,keyword"))

    assert ascending == ["a", "d", "b", "c", "e"]
    assert descending == ["b", "d", "a", "c", "e"]
    # Change: a gained 6, b lost 9; c and d have none (c lost its place, d is new).
    assert by_change[:2] == ["a", "b"]
    # Best ranks: a 3 (it was 9 before), c 5, b 6, d 7.
    assert by_best == ["a", "c", "b", "d", "e"]
    assert by_time[-1] == "e"


async def test_a_page_through_a_rank_sort_visits_every_keyword_once(
    api: httpx.AsyncClient, ranked: tuple[Workspace, uuid.UUID, Caller, World]
) -> None:
    workspace, project, owner, _ = ranked
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params: dict[str, Any] = {"sort": "-current_rank", "limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = await api.get(
            project_url(workspace, project, "tracked-keywords"),
            params=params,
            headers=owner.headers,
        )
        assert response.status_code == 200, response.text
        seen += _texts(response.json()["data"])
        cursor = response.json()["page"]["next_cursor"]
        if cursor is None:
            break
    assert seen == ["b", "d", "a", "c", "e"]


async def test_a_cursor_does_not_cross_filters(
    api: httpx.AsyncClient, ranked: tuple[Workspace, uuid.UUID, Caller, World]
) -> None:
    workspace, project, owner, _ = ranked
    first = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"sort": "current_rank", "limit": 1},
        headers=owner.headers,
    )
    cursor = first.json()["page"]["next_cursor"]

    reused = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"sort": "current_rank", "limit": 1, "cursor": cursor, "filter[rank_lte]": 20},
        headers=owner.headers,
    )

    assert reused.status_code == 400


async def test_the_rank_blocks_of_include(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    video = {
        "type": "video",
        "rank_absolute": 2,
        "position": "left",
        "items": [{"url": f"https://www.{OWN_HOST}/video"}, {"url": f"https://{RIVAL_HOST}/v"}],
    }
    aio = {
        "type": "ai_overview",
        "rank_absolute": 1,
        "position": "left",
        "asynchronous_ai_overview": False,
        "references": [{"url": f"https://www.{OWN_HOST}/pricing"}, {"url": "https://x.example/r"}],
        "items": [{"type": "ai_overview_element", "text": "x"}],
    }
    await _check(worker_db, migrated, world, tracked, _results(12, 8), days_ago=2)
    await _check(worker_db, migrated, world, tracked, _results(6, 3), days_ago=1)
    await _check(worker_db, migrated, world, tracked, _results(4, 3), extra=[video, aio])

    (row,) = await _list(
        api, workspace, project, owner, include="sparkline,competitor_ranks,features,aio"
    )

    assert [(p["rank"], p["state"]) for p in row["sparkline"]["points"]] == [
        (12, "ranked"),
        (6, "ranked"),
        (4, "ranked"),
    ]
    assert row["sparkline"]["depth_mode"] == "daily_depth"
    (rival,) = row["competitor_ranks"]
    assert rival["entity"]["canonical_name"] == "Rival"
    assert (rival["current"]["state"], rival["current"]["rank"]) == ("ranked", 3)
    assert (rival["change"]["label"], rival["change"]["value"]) == ("numeric", 0)
    assert rival["current"]["url"]["host"] == RIVAL_HOST
    by_type = {feature["feature_type"]: feature for feature in row["features"]}
    assert by_type["video"]["owned_by_project"] is True
    assert by_type["video"]["owned_position"] == 1
    assert by_type["ai_overview"]["owned_by_project"] is True
    assert row["aio"]["state"] == "present_cited"
    assert row["aio"]["citation_position"] == 1
    assert [url["host"] for url in row["aio"]["cited_urls"]] == [f"www.{OWN_HOST}", "x.example"]
    assert row["state"]["owned_feature_types"] == ["video"]
    assert "ai_overview" in row["state"]["feature_types_present"]


async def test_the_detail_carries_the_state(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    await _check(worker_db, migrated, world, tracked, _results(2))

    detail = await api.get(
        project_url(workspace, project, "tracked-keywords", tracked), headers=owner.headers
    )

    state = detail.json()["data"]["state"]
    assert (state["current"]["state"], state["current"]["rank"]) == ("ranked", 2)
    assert state["change"]["label"] == "first_check"


async def test_another_workspaces_ranks_are_never_shown(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    other_workspace, other_project, other_owner, other_world = await _world(resources, migrated)
    mine = await tracked_id(api, workspace, project, owner, "crm")
    theirs = await tracked_id(api, other_workspace, other_project, other_owner, "crm")
    await _check(worker_db, migrated, world, mine, _results(2, 5))
    await _check(worker_db, migrated, other_world, theirs, _results(9, 3))

    (row,) = await _list(api, workspace, project, owner, include="competitor_ranks,sparkline")
    (other_row,) = await _list(
        api, other_workspace, other_project, other_owner, include="competitor_ranks"
    )

    assert row["state"]["current"]["rank"] == 2
    assert other_row["state"]["current"]["rank"] == 9
    assert [c["current"]["rank"] for c in row["competitor_ranks"]] == [5]
    assert [c["current"]["rank"] for c in other_row["competitor_ranks"]] == [3]
    snapshots = await fetch(migrated, "SELECT DISTINCT workspace_id FROM seo.serp_snapshots")
    assert {r["workspace_id"] for r in snapshots} >= {workspace.id, other_workspace.id}


async def test_an_unknown_rank_sort_is_refused_by_name(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, _ = await _world(resources, migrated)

    response = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"sort": "current_rank,current_rank"},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert errors(response) == [("sort", "invalid_sort")]
