"""A rank check that shows a Google AI Overview leaves an AI observation (stage 2 of the AI
Overview engine): written once, only for projects that turned the engine on, and for the
backfill from stored payloads. As `app_worker`."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from idraft.collectors.ai_overview_ingest import BackfillReport, backfill
from idraft.collectors.seo_rank_ingest import ingest
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.ai_support import enable_engine
from tests.collectors.rank_support import (
    OWN_HOST,
    Ledger,
    World,
    answer,
    fetched_task,
    make_world,
    track,
)
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

TEXT = "Acme is a good CRM for small teams."


def overview(*, asynchronous: bool | None = None, loaded: bool = True) -> dict[str, Any]:
    item: dict[str, Any] = {
        "type": "ai_overview",
        "rank_absolute": 1,
        "position": "left",
    }
    if asynchronous is not None:
        item["asynchronous_ai_overview"] = asynchronous
    if loaded:
        item["markdown"] = TEXT
        item["references"] = [
            {"url": f"https://www.{OWN_HOST}/pricing", "title": "Pricing", "source": "Acme"},
            {"url": "https://reviews.example.org/crm", "title": "CRM reviews"},
        ]
        item["items"] = [{"type": "ai_overview_element", "text": TEXT}]
    return item


def body(item: dict[str, Any]) -> bytes:
    urls = [f"https://elsewhere-{i}.example/page" for i in range(1, 6)]
    return answer(urls, extra=[item])


async def _count(pg: PostgresServer, table: str) -> int:
    row = await fetchrow(pg, f"SELECT count(*) AS n FROM {table}")
    n: int = row["n"]
    return n


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> World:
    return await make_world(migrated)


async def _checked(
    worker_db: Ledger,
    pg: PostgresServer,
    world: World,
    item: dict[str, Any],
    store: MemoryStore,
    text: str = "best crm",
) -> tuple[uuid.UUID, int]:
    keyword = await track(pg, world.project, text)
    task_id = await fetched_task(worker_db, pg, world, keyword, body(item), store)
    return keyword, task_id


async def test_a_shown_overview_becomes_an_observation_with_its_facts(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    await enable_engine(migrated, world.project, "google_ai_overview")
    store = MemoryStore()
    keyword, task_id = await _checked(worker_db, migrated, world, overview(), store)

    await ingest(worker_db, store)

    (row,) = await fetch(migrated, "SELECT * FROM ai.observations")
    assert (row["engine_code"], row["observation_class"], row["status"]) == (
        "google_ai_overview",
        "serp_ai",
        "complete",
    )
    assert (row["prompt_id"], row["prompt_version_id"], row["cost_usd"]) == (None, None, None)
    assert (row["tracked_keyword_id"], row["collection_task_id"]) == (keyword, task_id)
    assert (row["query_text"], row["answer_text"], row["answer_markdown"]) == (
        "best crm",
        TEXT,
        TEXT,
    )
    assert row["serp_observed_at"] == row["observed_at"]
    snapshot = await fetchrow(migrated, "SELECT id, raw_payload_id FROM seo.serp_snapshots")
    assert (row["serp_snapshot_id"], row["raw_payload_id"]) == (
        snapshot["id"],
        snapshot["raw_payload_id"],
    )
    assert (row["has_citations"], row["citation_count"]) == (True, 2)
    citations = await fetch(
        migrated,
        "SELECT citation_kind, domain_role, title FROM ai.citations ORDER BY citation_index",
    )
    assert [(c["citation_kind"], c["domain_role"], c["title"]) for c in citations] == [
        ("reference_card", "own", "Pricing"),
        ("reference_card", "third_party", "CRM reviews"),
    ]
    fact = await fetchrow(migrated, "SELECT * FROM ai.observation_facts")
    assert (fact["is_valid"], fact["own_domain_cited"], fact["tracked_keyword_id"]) == (
        True,
        True,
        keyword,
    )
    assert fact["prompt_id"] is None


async def test_ingesting_twice_writes_the_observation_once(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    await enable_engine(migrated, world.project, "google_ai_overview")
    store = MemoryStore()
    _, task_id = await _checked(worker_db, migrated, world, overview(), store)
    await ingest(worker_db, store)
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'fetched' WHERE id = $1", task_id
    )

    await ingest(worker_db, store)

    assert await _count(migrated, "ai.observations") == 1
    assert await _count(migrated, "ai.citations") == 2
    assert await _count(migrated, "ai.observation_facts") == 1


async def test_a_project_without_the_engine_enabled_gets_no_observation(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    store = MemoryStore()
    await _checked(worker_db, migrated, world, overview(), store)
    await ingest(worker_db, store)
    assert await _count(migrated, "ai.observations") == 0

    await enable_engine(migrated, world.project, "google_ai_overview", enabled=False)
    await _checked(worker_db, migrated, world, overview(), store, "second crm")
    await ingest(worker_db, store)

    assert await _count(migrated, "ai.observations") == 0
    assert await _count(migrated, "seo.serp_snapshots") == 2


async def test_an_overview_that_did_not_load_or_is_absent_gets_no_observation(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    await enable_engine(migrated, world.project, "google_ai_overview")
    store = MemoryStore()
    await _checked(worker_db, migrated, world, overview(asynchronous=True, loaded=False), store)
    keyword = await track(migrated, world.project, "other crm")
    await fetched_task(
        worker_db,
        migrated,
        world,
        keyword,
        answer([f"https://e{i}.example/" for i in range(3)]),
        store,
    )

    await ingest(worker_db, store)

    assert await _count(migrated, "seo.serp_snapshots") == 2
    assert await _count(migrated, "ai.observations") == 0


async def test_the_backfill_writes_from_stored_payloads_once(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    store = MemoryStore()
    await _checked(worker_db, migrated, world, overview(), store)
    await ingest(worker_db, store)  # the engine is off: a snapshot, no observation
    assert await _count(migrated, "ai.observations") == 0
    await enable_engine(migrated, world.project, "google_ai_overview")

    first = await backfill(worker_db, store)
    second = await backfill(worker_db, store)

    assert first == BackfillReport(candidates=1, written=1, skipped=0)
    assert second == BackfillReport()
    assert await _count(migrated, "ai.observations") == 1
    assert await _count(migrated, "ai.citations") == 2
