"""The rank state of tracked keywords (plan Task 7, decisions R23 to R27): the `state` of every
row and of the detail, the rank filters and sorts, and the rank blocks of `include`."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.seo_rank_ingest import ingest
from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.providers.dataforseo.serp_parse import PARSER_VERSION, parse_serp
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
    store: MemoryStore | None = None,
    ingest_it: bool = True,
) -> None:
    store = store or MemoryStore()
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
    if ingest_it:
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
            "depth_returned": None,
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


async def test_a_check_that_reached_less_far_than_asked_says_how_far_it_reached(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    # Twenty were asked for; the provider had 12 to give and the site is not among them.
    await _check(worker_db, migrated, world, tracked, _results(None, total=12))

    (row,) = await _list(api, workspace, project, owner)

    current = row["state"]["current"]
    assert (current["state"], current["depth_requested"], current["depth_returned"]) == (
        "beyond_depth",
        20,
        12,
    )


async def test_a_rank_lost_at_one_check_is_flagged_as_not_yet_confirmed(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    await _check(worker_db, migrated, world, tracked, _results(5), days_ago=2)
    await _check(worker_db, migrated, world, tracked, _results(None), days_ago=1)

    (row,) = await _list(api, workspace, project, owner)
    assert row["state"]["current"]["state"] == "beyond_depth"
    assert row["state"]["drop_unconfirmed"] is True

    # A second check that still cannot find it stands.
    await _check(worker_db, migrated, world, tracked, _results(None))
    (row,) = await _list(api, workspace, project, owner)
    assert row["state"]["drop_unconfirmed"] is False


async def test_a_snapshot_with_an_empty_rank_slot_lists_the_other_results_at_their_ranks(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    # Rank 2 repeats rank 1, so its slot stays empty; the own site is the provider's third.
    urls = [
        "https://elsewhere-1.example/page",
        "https://elsewhere-1.example/page#again",
        f"https://www.{OWN_HOST}/pricing",
    ]
    await _check(worker_db, migrated, world, tracked, urls)

    (row,) = await _list(api, workspace, project, owner)
    snapshot = row["state"]["current"]["serp_snapshot_id"]
    detail = await api.get(
        project_url(workspace, project, "serp-snapshots", snapshot), headers=owner.headers
    )

    assert detail.status_code == 200, detail.text
    organic = detail.json()["data"]["organic"]
    assert [item["organic_rank"] for item in organic] == [1, 3]
    assert organic[1]["entity"]["canonical_name"] == "Acme"
    assert row["state"]["current"]["rank"] == 3


async def test_a_keyword_that_never_ranked_has_no_drop_to_confirm(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    await _check(worker_db, migrated, world, tracked, _results(None))

    (row,) = await _list(api, workspace, project, owner)
    assert row["state"]["drop_unconfirmed"] is False


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


async def test_every_own_page_that_ranks_is_listed_best_first(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    results = _results(9, 3)
    results[3] = f"https://www.{OWN_HOST}/crm-guide"
    await _check(worker_db, migrated, world, tracked, results)

    (plain,) = await _list(api, workspace, project, owner)
    (row,) = await _list(api, workspace, project, owner, include="ranking_urls")

    assert plain["ranking_urls"] is None
    assert row["state"]["ranking_url_count"] == 2
    assert [
        (page["url"]["path"], page["rank"], page["shares_rank"]) for page in row["ranking_urls"]
    ] == [
        ("/crm-guide", 4, False),
        ("/pricing", 9, False),
    ]
    assert row["ranking_urls"][0]["url"]["host"] == f"www.{OWN_HOST}"
    # The page at the best rank is the one the state names
    assert row["state"]["current"]["url"]["path"] == "/crm-guide"


async def test_a_keyword_that_never_ranked_lists_no_pages(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _world(resources, migrated)
    unchecked = await tracked_id(api, workspace, project, owner, "never checked")
    beyond = await tracked_id(api, workspace, project, owner, "beyond")
    await _check(worker_db, migrated, world, beyond, _results(None, 3))

    rows = await _list(api, workspace, project, owner, include="ranking_urls")

    by_id = {row["tracked_keyword_id"]: row for row in rows}
    assert by_id[unchecked]["ranking_urls"] == []
    assert by_id[beyond]["ranking_urls"] == []


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


# Real answers of DataForSEO's standard queue for the Fynix site (India, desktop, depth 100),
# trimmed to what the parser reads. Captured on 2026-11-03 with the app's own request body: two
# readings of each keyword a few hours apart, which differ (the provider's SERP moves between
# readings).
LIVE_FIXTURES = Path(__file__).parents[2] / "fixtures" / "dataforseo" / "live"
FYNIX = "fynix.digital"


def _fixture(name: str) -> bytes:
    return (LIVE_FIXTURES / f"{name}.json").read_bytes()


def _provider_rank(name: str) -> int:
    """The `rank_group` of the first organic result of the Fynix site in the raw answer."""
    items = json.loads(_fixture(name))["tasks"][0]["result"][0]["items"]
    ranks = [i["rank_group"] for i in items if i["type"] == "organic" and FYNIX in i["domain"]]
    return int(ranks[0])


async def _fynix_world(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller, World]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project_id = await keyword_project(pg, workspace)
    project = Project(workspace.id, project_id)
    world = World(
        project,
        own=await _entity(pg, project, "Fynix", FYNIX, "own", primary=True),
        rival=await _entity(pg, project, "Rival", RIVAL_HOST, "competitor"),
    )
    return workspace, project_id, owner, world


async def _read(
    worker_db: Ledger,
    pg: PostgresServer,
    world: World,
    tracked: str,
    fixture: str,
    store: MemoryStore,
    *,
    days_ago: int,
    manual: bool,
) -> None:
    when = NOW - days_ago * DAY
    selector = {"tracked_keyword_ids": [tracked]} if manual else None
    await fetched_task(
        worker_db,
        pg,
        world,
        uuid.UUID(tracked),
        _fixture(fixture),
        store,
        fetched_at=when,
        selector=selector,
    )
    await ingest(worker_db, store)


async def test_the_standard_queue_answers_for_fynix_digital_reach_the_api_as_the_provider_gave_them(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _fynix_world(resources, migrated)
    store = MemoryStore()
    tracked = await tracked_id(api, workspace, project, owner, "fynix digital")
    found, missing = (
        "standard_fynix_digital_1154_found_rank_1",
        "standard_fynix_digital_1327_not_found",
    )

    await _read(worker_db, migrated, world, tracked, found, store, days_ago=1, manual=True)
    (row,) = await _list(api, workspace, project, owner)
    state = row["state"]
    assert _provider_rank(found) == 1
    assert (state["current"]["state"], state["current"]["rank"]) == ("ranked", 1)
    assert state["current"]["url"]["host"] == "www.fynix.digital"
    assert state["current"]["depth_returned"] == 96
    assert (state["aio"]["state"], state["check"]["status"]) == ("present_cited", "completed")

    # The later reading does not have the site. It is stored as a reading, the earlier one is
    # kept, and the drop is shown as not yet confirmed rather than as a fact.
    await _read(worker_db, migrated, world, tracked, missing, store, days_ago=0, manual=False)
    (row,) = await _list(api, workspace, project, owner)
    state = row["state"]
    assert state["current"]["state"] == "beyond_depth"
    assert (state["current"]["depth_requested"], state["current"]["depth_returned"]) == (100, 99)
    assert state["drop_unconfirmed"] is True
    assert (state["change"]["label"], state["change"]["previous_rank"]) == ("lost", 1)
    assert state["check"]["status"] == "completed"
    assert (state["aio"]["state"]) == "present_not_cited"

    snapshots = await fetch(
        migrated,
        "SELECT id, depth_requested, depth_returned, parser_version, collection_task_id, "
        "organic_url_ids FROM seo.serp_snapshots WHERE tracked_keyword_id = $1 "
        "ORDER BY observed_at",
        uuid.UUID(tracked),
    )
    assert [(s["depth_requested"], s["depth_returned"]) for s in snapshots] == [
        (100, 96),
        (100, 99),
    ]
    assert {s["parser_version"] for s in snapshots} == {PARSER_VERSION}
    for stored, name in zip(snapshots, (found, missing), strict=True):
        parsed = parse_serp(_fixture(name))
        assert len(stored["organic_url_ids"]) == parsed.depth_returned
        assert sum(slot is None for slot in stored["organic_url_ids"]) == (
            parsed.depth_returned - len(parsed.organic)
        )
    # The first reading is still readable through the API at the ranks the provider gave
    first = await api.get(
        project_url(workspace, project, "serp-snapshots", str(snapshots[0]["id"])),
        headers=owner.headers,
    )
    organic = first.json()["data"]["organic"]
    assert organic[0]["organic_rank"] == 1
    assert organic[0]["entity"]["canonical_name"] == "Fynix"
    assert [item["organic_rank"] for item in organic] == sorted(
        r.organic_rank for r in parse_serp(_fixture(found)).organic
    )


async def test_fynix_keeps_the_providers_rank_and_a_manual_check_equals_a_scheduled_one(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    workspace, project, owner, world = await _fynix_world(resources, migrated)
    store = MemoryStore()
    manual = await tracked_id(api, workspace, project, owner, "fynix manual")
    scheduled = await tracked_id(api, workspace, project, owner, "fynix scheduled")
    reading = "standard_fynix_1150_rank_21"
    # Two repeated URLs above the site: renumbering from the kept results gave 19, not 21
    parsed = parse_serp(_fixture(reading))
    renumbered = 1 + sum(1 for r in parsed.organic if r.organic_rank < _provider_rank(reading))

    await _read(worker_db, migrated, world, manual, reading, store, days_ago=0, manual=True)
    await _read(worker_db, migrated, world, scheduled, reading, store, days_ago=0, manual=False)

    rows = {r["keyword"]["text"]: r["state"] for r in await _list(api, workspace, project, owner)}
    assert _provider_rank(reading) == 21
    assert renumbered == 19
    for name in ("fynix manual", "fynix scheduled"):
        assert rows[name]["current"]["rank"] == 21
    keys = ("rank", "absolute_rank", "depth_requested", "depth_returned")
    assert {k: rows["fynix manual"]["current"][k] for k in keys} == {
        k: rows["fynix scheduled"]["current"][k] for k in keys
    }
    assert rows["fynix manual"]["aio"] == rows["fynix scheduled"]["aio"] | {
        "observation_id": rows["fynix manual"]["aio"]["observation_id"]
    }
    # The later reading, a few hours on, found it at 19: the provider's own rank
    await _read(
        worker_db,
        migrated,
        world,
        manual,
        "standard_fynix_1324_rank_19",
        store,
        days_ago=0,
        manual=True,
    )
    later = {r["keyword"]["text"]: r["state"] for r in await _list(api, workspace, project, owner)}
    assert (
        later["fynix manual"]["current"]["rank"]
        == _provider_rank("standard_fynix_1324_rank_19")
        == 19
    )
