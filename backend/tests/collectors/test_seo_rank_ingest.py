"""The rank ingest tick (plan R5, R17 to R22 of docs/superpowers/plans/2026-10-05-rank-ingest.md):
a stored SERP becomes a snapshot, its features, rank observations, the keyword's state, the
current top 20 and rank events, once. As `app_worker`."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest

from sightline.collectors import seo_rank_ingest
from sightline.collectors.ingest_waits import IngestReport
from sightline.collectors.seo_rank_ingest import ingest
from sightline.storage.raw import RawStorageError
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.rank_support import (
    DAY,
    OWN_HOST,
    RIVAL_HOST,
    Ledger,
    World,
    answer,
    fetched_task,
    make_world,
    track,
)
from tests.collectors.support import NOW, make_tenant
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer


class LosingStore(MemoryStore):
    """Storage that cannot read the objects under `lost`."""

    def __init__(self) -> None:
        super().__init__()
        self.lost: set[str] = set()

    async def get(self, key: str) -> bytes:
        if key in self.lost:
            raise RawStorageError("reading a payload failed: NoSuchKey")
        return await super().get(key)


def own(path: str = "pricing") -> str:
    return f"https://www.{OWN_HOST}/{path}"


def rival(path: str = "crm") -> str:
    return f"https://{RIVAL_HOST}/{path}"


def other(number: int) -> str:
    return f"https://elsewhere-{number}.example/page"


def results(own_at: int | None, rival_at: int | None = None, total: int = 12) -> list[str]:
    """`total` URLs where the own brand is at rank `own_at` and the rival at `rival_at`."""
    total = max(total, own_at or 0, rival_at or 0)
    urls = [other(i) for i in range(1, total + 1)]
    if own_at is not None:
        urls[own_at - 1] = own()
    if rival_at is not None:
        urls[rival_at - 1] = rival()
    return urls


async def _rows(pg: PostgresServer, table: str, keyword: uuid.UUID, order: str) -> list[Any]:
    return [
        dict(row)
        for row in await fetch(
            pg, f"SELECT * FROM {table} WHERE tracked_keyword_id = $1 ORDER BY {order}", keyword
        )
    ]


async def _state(pg: PostgresServer, keyword: uuid.UUID) -> dict[str, Any]:
    row = await fetchrow(
        pg, "SELECT * FROM seo.tracked_keyword_state WHERE tracked_keyword_id = $1", keyword
    )
    return dict(row)


async def _events(pg: PostgresServer, keyword: uuid.UUID) -> list[str]:
    rows = await fetch(
        pg,
        "SELECT event_type FROM seo.rank_events WHERE tracked_keyword_id = $1 "
        "ORDER BY occurred_at, id",
        keyword,
    )
    return [row["event_type"] for row in rows]


async def _task_status(pg: PostgresServer, task_id: int) -> str:
    row = await fetchrow(pg, "SELECT status FROM ops.collection_tasks WHERE id = $1", task_id)
    status: str = row["status"]
    return status


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> World:
    return await make_world(migrated)


async def test_a_stored_serp_becomes_its_facts(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    video = {
        "type": "video",
        "rank_absolute": 2,
        "position": "left",
        "items": [{"url": own("video"), "domain": f"www.{OWN_HOST}"}, {"url": rival("v")}],
    }
    store = MemoryStore()
    task_id = await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer(results(own_at=4, rival_at=7), extra=[video]),
        store,
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    assert await _task_status(migrated, task_id) == "ingested"
    (snapshot,) = await _rows(migrated, "seo.serp_snapshots", keyword, "id")
    assert (snapshot["depth_requested"], snapshot["depth_returned"], snapshot["device"]) == (
        20,
        12,
        "desktop",
    )
    assert snapshot["collection_task_id"] == task_id
    assert snapshot["provider_code"] == "dataforseo"
    assert snapshot["observed_at"] == NOW
    assert str(snapshot["cost_usd"]) == "0.000600"
    assert len(snapshot["organic_url_ids"]) == len(snapshot["organic_domain_ids"]) == 12

    (feature,) = await _rows(migrated, "seo.serp_features", keyword, "id")
    assert (feature["feature_type"], feature["owned_by_project"], feature["owned_position"]) == (
        "video",
        True,
        1,
    )
    assert feature["competitor_entity_ids"] == [world.rival]

    observations = {
        row["entity_id"]: row
        for row in await _rows(migrated, "seo.domain_rank_observations", keyword, "role")
    }
    assert (observations[world.own]["role"], observations[world.own]["organic_rank"]) == ("own", 4)
    assert observations[world.own]["all_organic_ranks"] == [4]
    assert observations[world.own]["owned_feature_types"] == ["video"]
    assert observations[world.rival]["organic_rank"] == 7

    state = await _state(migrated, keyword)
    assert (state["current_rank"], state["best_rank"], state["worst_rank"]) == (4, 4, 4)
    assert (state["previous_rank"], state["consecutive_beyond"]) == (None, 0)
    assert state["last_snapshot_id"] == snapshot["id"]
    assert state["owned_feature_types"] == ["video"]
    assert state["aio_state"] == "absent"

    current = await _rows(migrated, "seo.serp_current_results", keyword, "organic_rank")
    assert [row["organic_rank"] for row in current] == list(range(1, 13))
    assert await _events(migrated, keyword) == []


async def test_ingesting_twice_writes_one_snapshot(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    task_id = await fetched_task(worker_db, migrated, world, keyword, answer(results(3)), store)
    await ingest(worker_db, store)
    # The task is fetched again, as if its first ingest had been rolled back after the commit.
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'fetched' WHERE id = $1", task_id
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    assert len(await _rows(migrated, "seo.serp_snapshots", keyword, "id")) == 1
    assert len(await _rows(migrated, "seo.domain_rank_observations", keyword, "role")) == 2
    assert (await _state(migrated, keyword))["current_rank"] == 3


async def test_the_next_days_check_moves_the_state_and_writes_the_events(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer(results(own_at=12, rival_at=8), when=NOW - DAY),
        store,
        fetched_at=NOW - DAY,
    )
    await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer(results(own_at=2, rival_at=8), when=NOW),
        store,
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=2)
    state = await _state(migrated, keyword)
    assert (state["current_rank"], state["previous_rank"], state["rank_change"]) == (2, 12, 10)
    assert (state["best_rank"], state["worst_rank"]) == (2, 12)
    assert state["previous_observed_at"] == NOW - DAY
    assert await _events(migrated, keyword) == [
        "entered_top_3",
        "entered_top_10",
        "rank_gain",
        "overtook",
    ]
    (current,) = {
        row["serp_snapshot_id"]
        for row in await _rows(migrated, "seo.serp_current_results", keyword, "organic_rank")
    }
    assert current == state["last_snapshot_id"]


async def test_an_older_answer_ingested_late_leaves_history_and_moves_nothing(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    await fetched_task(worker_db, migrated, world, keyword, answer(results(5), when=NOW), store)
    await ingest(worker_db, store)
    before = await _state(migrated, keyword)
    await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer(results(1), when=NOW - DAY),
        store,
        fetched_at=NOW - DAY,
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    assert len(await _rows(migrated, "seo.serp_snapshots", keyword, "observed_at")) == 2
    assert await _state(migrated, keyword) == before
    assert await _events(migrated, keyword) == []
    current = await _rows(migrated, "seo.serp_current_results", keyword, "organic_rank")
    assert {row["serp_snapshot_id"] for row in current} == {before["last_snapshot_id"]}


async def test_a_deleted_keyword_gets_nothing_and_its_task_is_ingested(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    gone = await track(migrated, world.project, "gone", deleted=True)
    store = MemoryStore()
    task_id = await fetched_task(worker_db, migrated, world, gone, answer(results(1)), store)
    nameless = await fetched_task(
        worker_db, migrated, world, "not-a-keyword", answer(results(1)), store
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=2)
    assert await _task_status(migrated, task_id) == "ingested"
    assert await _task_status(migrated, nameless) == "ingested"
    assert await _rows(migrated, "seo.serp_snapshots", gone, "id") == []
    assert (await fetchrow(migrated, "SELECT count(*) AS n FROM seo.tracked_keyword_state"))[
        "n"
    ] == 0


async def test_an_answer_that_cannot_be_read_fails_its_task_with_the_payload_kept(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    html = await fetched_task(worker_db, migrated, world, keyword, b"<html>gateway</html>", store)
    no_echo = await fetched_task(
        worker_db, migrated, world, keyword, answer(results(1), echo=False), store
    )
    odd_device = await fetched_task(
        worker_db, migrated, world, keyword, answer(results(1), device="watch"), store
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(failed=3)
    for task_id in (html, no_echo, odd_device):
        row = await fetchrow(
            migrated,
            "SELECT status, last_error_code, raw_payload_id FROM ops.collection_tasks "
            "WHERE id = $1",
            task_id,
        )
        assert (row["status"], row["last_error_code"]) == ("failed", seo_rank_ingest.UNREADABLE)
        assert row["raw_payload_id"] is not None
    assert await _rows(migrated, "seo.serp_snapshots", keyword, "id") == []


async def test_a_missing_answer_waits_then_fails_after_a_day(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = LosingStore()
    task_id = await fetched_task(worker_db, migrated, world, keyword, answer(results(1)), store)
    store.lost = set(store.objects)

    report = await ingest(worker_db, store)

    assert report == IngestReport(waiting=1)
    row = await fetchrow(
        migrated,
        "SELECT status, last_error_code, next_attempt_at FROM ops.collection_tasks WHERE id = $1",
        task_id,
    )
    assert (row["status"], row["last_error_code"]) == ("fetched", seo_rank_ingest.NOT_READ)
    assert row["next_attempt_at"] > NOW
    assert (await ingest(worker_db, store)).quiet

    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET ready_at = now() - interval '25 hours', "
        "next_attempt_at = NULL WHERE id = $1",
        task_id,
    )
    assert await ingest(worker_db, store) == IngestReport(failed=1)
    assert await _task_status(migrated, task_id) == "failed"


async def test_a_write_that_fails_rolls_back_all_of_it_and_waits(
    worker_db: Ledger, migrated: PostgresServer, world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    task_id = await fetched_task(worker_db, migrated, world, keyword, answer(results(3)), store)

    async def fails(*_: Any, **__: Any) -> None:
        raise ValueError("a value the state cannot hold")

    monkeypatch.setattr(seo_rank_ingest, "_replace_current", fails)

    report = await ingest(worker_db, store)

    assert report == IngestReport(waiting=1)
    assert await _task_status(migrated, task_id) == "fetched"
    for table in (
        "seo.serp_snapshots",
        "seo.domain_rank_observations",
        "seo.tracked_keyword_state",
    ):
        assert await _rows(migrated, table, keyword, "tracked_keyword_id") == []


async def test_two_workspaces_never_mix(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    second = await make_world(migrated)
    mine = await track(migrated, world.project)
    theirs = await track(migrated, second.project)
    store = MemoryStore()
    await fetched_task(worker_db, migrated, world, mine, answer(results(2, 5)), store)
    await fetched_task(worker_db, migrated, second, theirs, answer(results(9, 3)), store)

    await ingest(worker_db, store)

    assert (await _state(migrated, mine))["current_rank"] == 2
    assert (await _state(migrated, theirs))["current_rank"] == 9
    for keyword, owner in ((mine, world), (theirs, second)):
        (snapshot,) = await _rows(migrated, "seo.serp_snapshots", keyword, "id")
        assert snapshot["workspace_id"] == owner.project.workspace_id
        entities = {
            row["entity_id"]
            for row in await _rows(migrated, "seo.domain_rank_observations", keyword, "role")
        }
        assert entities == {owner.own, owner.rival}


async def test_a_competitor_the_keyword_excludes_has_no_observation(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keyword_competitors (tracked_keyword_id, entity_id, "
        "workspace_id, mode) VALUES ($1, $2, $3, 'exclude')",
        keyword,
        world.rival,
        world.project.workspace_id,
    )
    store = MemoryStore()
    await fetched_task(worker_db, migrated, world, keyword, answer(results(2, 5)), store)

    await ingest(worker_db, store)

    observations = await _rows(migrated, "seo.domain_rank_observations", keyword, "role")
    assert [row["entity_id"] for row in observations] == [world.own]


async def test_a_project_without_a_primary_own_entity_has_a_state_and_no_events(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    await execute(
        migrated,
        "UPDATE core.project_entities SET is_primary = false WHERE project_id = $1",
        world.project.id,
    )
    store = MemoryStore()
    for day, rank in ((1, 15), (0, 2)):
        await fetched_task(
            worker_db,
            migrated,
            world,
            keyword,
            answer(results(rank), when=NOW - day * DAY),
            store,
            fetched_at=NOW - day * DAY,
        )

    await ingest(worker_db, store)

    state = await _state(migrated, keyword)
    assert (state["current_rank"], state["previous_rank"]) == (2, 15)
    assert await _events(migrated, keyword) == []


async def test_a_feature_type_the_registry_does_not_know_is_added(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    box = {"type": "brand_new_box", "rank_absolute": 3, "position": "left", "items": [{"x": 1}]}
    await fetched_task(worker_db, migrated, world, keyword, answer(results(2), extra=[box]), store)

    assert await ingest(worker_db, store) == IngestReport(ingested=1)
    (feature,) = await _rows(migrated, "seo.serp_features", keyword, "id")
    assert feature["feature_type"] == "other:brand_new_box"
    known = await fetchrow(
        migrated, "SELECT code FROM seo.serp_feature_types WHERE code = 'other:brand_new_box'"
    )
    assert known is not None


async def test_an_owned_feature_gained_and_a_url_change_are_events_of_the_primary_entity(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    video = {
        "type": "video",
        "rank_absolute": 2,
        "position": "left",
        "items": [{"url": own("video")}],
    }
    first = results(own_at=3)
    second = results(own_at=3)
    second[2] = own("pricing-new")
    await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer(first, when=NOW - DAY),
        store,
        fetched_at=NOW - DAY,
    )
    await fetched_task(
        worker_db, migrated, world, keyword, answer(second, extra=[video], when=NOW), store
    )

    await ingest(worker_db, store)

    rows = await fetch(
        migrated,
        "SELECT event_type, feature_type, entity_id, from_url_id, to_url_id "
        "FROM seo.rank_events WHERE tracked_keyword_id = $1 ORDER BY id",
        keyword,
    )
    assert [(row["event_type"], row["feature_type"]) for row in rows] == [
        ("url_changed", None),
        ("feature_gained", "video"),
    ]
    assert {row["entity_id"] for row in rows} == {world.own}
    assert rows[0]["from_url_id"] != rows[0]["to_url_id"]
    assert (await _state(migrated, keyword))["url_changed_at"] == NOW


async def test_the_providers_time_is_used_only_when_it_is_believable(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    keyword = await track(migrated, world.project)
    store = MemoryStore()
    await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer(results(2), when=NOW - 40 * DAY),
        store,
    )

    await ingest(worker_db, store)

    (snapshot,) = await _rows(migrated, "seo.serp_snapshots", keyword, "id")
    assert snapshot["observed_at"] == NOW


async def test_a_tenant_never_sees_another_tenants_task_for_a_keyword_it_does_not_own(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    """A task names a tracked keyword of another workspace: nothing is written for it."""
    stranger = await make_tenant(migrated)
    foreign = await track(migrated, stranger)
    store = MemoryStore()
    task_id = await fetched_task(worker_db, migrated, world, foreign, answer(results(1)), store)

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    assert await _task_status(migrated, task_id) == "ingested"
    assert await _rows(migrated, "seo.serp_snapshots", foreign, "id") == []
    assert timedelta(0) < DAY
