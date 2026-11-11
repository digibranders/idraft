"""Reading fetched AI answers into observations, citations, mentions and facts (spec sections
4.3 and 4.4). As `app_worker`, on the answers captured in spike S-04."""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest

from idraft.collectors import ai_prompt_ingest
from idraft.collectors.ai_prompt_ingest import current_derivation, ingest
from idraft.collectors.ingest_waits import IngestReport
from idraft.extraction import aliases
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.ai_support import (
    AiWorld,
    Prompt,
    add_prompt,
    at_now,
    chatgpt_answer,
    fetched_ai_task,
    make_ai_world,
)
from tests.collectors.rank_support import Ledger, _entity
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

CAPTURED = FIXTURES / "captured"
AI = FIXTURES / "ai"
QUESTION = "What are the best managed SOC providers in India?"


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


async def _observation(pg: PostgresServer, task_id: int) -> dict[str, Any]:
    row = await fetchrow(pg, "SELECT * FROM ai.observations WHERE collection_task_id = $1", task_id)
    return dict(row)


async def _facts(pg: PostgresServer, observation_id: int) -> dict[str, Any]:
    row = await fetchrow(
        pg, "SELECT * FROM ai.observation_facts WHERE observation_id = $1", observation_id
    )
    return dict(row)


async def _count(pg: PostgresServer, table: str, observation_id: int) -> int:
    row = await fetchrow(
        pg, f"SELECT count(*) AS n FROM {table} WHERE observation_id = $1", observation_id
    )
    count: int = row["n"]
    return count


async def _task_status(pg: PostgresServer, task_id: int) -> str:
    row = await fetchrow(pg, "SELECT status FROM ops.collection_tasks WHERE id = $1", task_id)
    status: str = row["status"]
    return status


async def _gemini(
    worker_db: Ledger, pg: PostgresServer, world: AiWorld, store: MemoryStore
) -> tuple[Prompt, int]:
    prompt = await add_prompt(pg, world.project, QUESTION)
    body = at_now(CAPTURED / "gemini_scraper_answer.json")
    task_id = await fetched_ai_task(
        worker_db, pg, world.project, prompt, body, store, engine_code="gemini_web"
    )
    return prompt, task_id


async def test_a_stored_answer_becomes_its_observation_citations_mentions_and_facts(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt, task_id = await _gemini(worker_db, migrated, world, store)

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    assert await _task_status(migrated, task_id) == "ingested"
    observation = await _observation(migrated, task_id)
    assert observation["status"] == "complete"
    assert (observation["engine_code"], observation["observation_class"]) == (
        "gemini_web",
        "consumer_ui",
    )
    assert (observation["prompt_id"], observation["prompt_version_id"]) == (
        prompt.id,
        prompt.version_id,
    )
    assert observation["query_text"] == QUESTION
    assert observation["model_reported"] == "3.5 Flash-Lite"
    assert observation["citation_count"] == 5
    assert observation["has_citations"]
    assert observation["cost_usd"] == Decimal("0.0012")
    assert observation["answer_char_count"] == len(observation["answer_text"])
    assert len(observation["answer_hash"]) == 32
    assert (
        observation["adapter_version"],
        observation["normalizer_version"],
        observation["canonicalizer_version"],
    ) == (1, 1, 1)
    citations = await fetch(
        migrated,
        "SELECT citation_index, domain_role, role_entity_id, citation_kind, occurrences "
        "FROM ai.citations WHERE observation_id = $1 ORDER BY citation_index",
        observation["id"],
    )
    assert [(row["citation_index"], row["domain_role"]) for row in citations] == [
        (1, "competitor"),
        (2, "third_party"),
        (3, "third_party"),
        (4, "own"),
        (5, "third_party"),
    ]
    assert (citations[0]["role_entity_id"], citations[3]["role_entity_id"]) == (
        world.rival,
        world.own,
    )
    mentions = await fetch(
        migrated,
        "SELECT entity_id, role, mention_count, first_char_offset, mention_order, "
        "mention_status, evidence_spans FROM ai.entity_mentions WHERE observation_id = $1 "
        "ORDER BY mention_order",
        observation["id"],
    )
    assert [(row["entity_id"], row["role"], row["mention_order"]) for row in mentions] == [
        (world.rival, "competitor", 1),
        (world.own, "own", 2),
    ]
    own = mentions[1]
    assert own["first_char_offset"] == observation["answer_text"].index("Eventus Security")
    assert own["mention_status"] == "accepted"
    assert len(own["evidence_spans"]) == own["mention_count"]
    facts = await _facts(migrated, observation["id"])
    assert facts["is_valid"]
    assert (facts["own_mentioned"], facts["own_domain_cited"]) == (True, True)
    assert (facts["own_citation_count"], facts["total_citation_count"]) == (1, 5)
    assert facts["tracked_entities_mentioned"] == 2
    assert (facts["competitor_mentions"], facts["competitor_cited"]) == (
        [world.rival],
        [world.rival],
    )
    assert facts["is_current"]
    derivation = await fetchrow(
        migrated, "SELECT * FROM ai.derivations WHERE id = $1", facts["derivation_id"]
    )
    assert (derivation["extractor_version"], derivation["entity_config_version"]) == (1, 1)


async def test_ingesting_twice_writes_one_observation(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    _, task_id = await _gemini(worker_db, migrated, world, store)
    await ingest(worker_db, store)
    # The task is fetched again, as if its first ingest had been rolled back after the commit.
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'fetched' WHERE id = $1", task_id
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    observation = await _observation(migrated, task_id)
    assert await _count(migrated, "ai.citations", observation["id"]) == 5
    assert await _count(migrated, "ai.entity_mentions", observation["id"]) == 2
    assert await _count(migrated, "ai.observation_facts", observation["id"]) == 1


async def test_an_answer_without_a_time_is_observed_when_its_task_was_ready(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    task_id = await fetched_ai_task(
        worker_db, migrated, world.project, prompt, at_now(AI / "task_error.json"), store
    )
    ready = (
        await fetchrow(migrated, "SELECT ready_at FROM ops.collection_tasks WHERE id = $1", task_id)
    )["ready_at"]
    await ingest(worker_db, store)
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'fetched' WHERE id = $1", task_id
    )

    await ingest(worker_db, store)

    rows = await fetch(
        migrated,
        "SELECT observed_at FROM ai.observations WHERE collection_task_id = $1",
        task_id,
    )
    assert [row["observed_at"] for row in rows] == [ready]


@pytest.mark.parametrize("offset", [timedelta(days=-400), timedelta(days=1)], ids=["old", "future"])
async def test_an_answer_time_outside_the_partitions_falls_back_to_the_fetched_time(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld, offset: timedelta
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    text = "Eventus Security runs a managed SOC for banks and telecom operators in India."
    body = chatgpt_answer(text, when=NOW + offset)
    task_id = await fetched_ai_task(worker_db, migrated, world.project, prompt, body, store)

    report = await ingest(worker_db, store)
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'fetched' WHERE id = $1", task_id
    )
    again = await ingest(worker_db, store)

    assert (report, again) == (IngestReport(ingested=1), IngestReport(ingested=1))
    rows = await fetch(
        migrated, "SELECT observed_at FROM ai.observations WHERE collection_task_id = $1", task_id
    )
    assert [row["observed_at"] for row in rows] == [NOW]
    assert await _task_status(migrated, task_id) == "ingested"


async def test_a_text_that_matches_too_often_keeps_its_citations_and_counts_in_no_rate(
    worker_db: Ledger,
    migrated: PostgresServer,
    world: AiWorld,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(aliases, "MAX_HITS", 2)
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    text = "Eventus Security, Eventus Security and again Eventus Security lead the Indian market."
    body = chatgpt_answer(text, ["https://eventussecurity.com/soc"])
    task_id = await fetched_ai_task(worker_db, migrated, world.project, prompt, body, store)

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    observation = await _observation(migrated, task_id)
    assert await _count(migrated, "ai.citations", observation["id"]) == 1
    assert await _count(migrated, "ai.entity_mentions", observation["id"]) == 0
    facts = await _facts(migrated, observation["id"])
    assert (facts["is_valid"], facts["own_mentioned"], facts["own_domain_cited"]) == (
        False,
        False,
        True,
    )
    assert await _task_status(migrated, task_id) == "ingested"


async def test_an_answer_that_fails_half_way_leaves_nothing_and_waits(
    worker_db: Ledger,
    migrated: PostgresServer,
    world: AiWorld,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refuse(*_: object, **__: object) -> None:
        raise RuntimeError("the fact row cannot be written now")

    monkeypatch.setattr(ai_prompt_ingest, "_insert_fact", refuse)
    store = MemoryStore()
    _, task_id = await _gemini(worker_db, migrated, world, store)

    report = await ingest(worker_db, store)

    assert report == IngestReport(waiting=1)
    for table in ("ai.observations", "ai.citations", "ai.entity_mentions"):
        row = await fetchrow(
            migrated,
            f"SELECT count(*) AS n FROM {table} WHERE workspace_id = $1",
            world.project.workspace_id,
        )
        assert row["n"] == 0, table
    task = await fetchrow(
        migrated,
        "SELECT status, last_error_code FROM ops.collection_tasks WHERE id = $1",
        task_id,
    )
    assert (task["status"], task["last_error_code"]) == ("fetched", "answer_not_written")


@pytest.mark.parametrize(
    ("fixture", "status", "error_code"),
    [
        ("chatgpt_refused", "refused", None),
        ("chatgpt_empty", "empty", None),
        ("task_error", "error", "40501"),
    ],
)
async def test_an_answer_that_counts_in_no_rate_is_stored_with_its_status(
    worker_db: Ledger,
    migrated: PostgresServer,
    world: AiWorld,
    fixture: str,
    status: str,
    error_code: str | None,
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    body = at_now(AI / f"{fixture}.json")
    task_id = await fetched_ai_task(worker_db, migrated, world.project, prompt, body, store)

    await ingest(worker_db, store)

    observation = await _observation(migrated, task_id)
    assert (observation["status"], observation["error_code"]) == (status, error_code)
    assert not (await _facts(migrated, observation["id"]))["is_valid"]
    assert await _task_status(migrated, task_id) == "ingested"


async def test_an_answer_of_another_shape_is_an_error_observation_with_its_payload(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    task_id = await fetched_ai_task(
        worker_db, migrated, world.project, prompt, b'{"tasks": []}', store
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    observation = await _observation(migrated, task_id)
    assert (observation["status"], observation["error_code"]) == ("error", "schema_mismatch")
    assert observation["answer_text"] is None
    assert observation["raw_payload_id"] is not None
    assert not (await _facts(migrated, observation["id"]))["is_valid"]


async def test_a_link_target_is_a_citation_and_never_a_mention(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    text = (
        "Several firms run managed SOCs in India; see "
        "[this list](https://eventussecurity.com/soc-list) for one view."
    )
    body = chatgpt_answer(text, ["https://eventussecurity.com/soc-list"])
    task_id = await fetched_ai_task(worker_db, migrated, world.project, prompt, body, store)

    await ingest(worker_db, store)

    observation = await _observation(migrated, task_id)
    facts = await _facts(migrated, observation["id"])
    assert (facts["own_mentioned"], facts["own_domain_cited"]) == (False, True)
    assert await _count(migrated, "ai.entity_mentions", observation["id"]) == 0


async def test_a_mention_outside_the_order_is_stored_with_no_order(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    watched = await _entity(migrated, world.project, "Zentrix Labs", "zentrix.example", "watch")
    prompt = await add_prompt(migrated, world.project, QUESTION)
    text = "Zentrix Labs and Eventus Security both run managed SOC services in India today."
    task_id = await fetched_ai_task(
        worker_db, migrated, world.project, prompt, chatgpt_answer(text), store
    )

    await ingest(worker_db, store)

    observation = await _observation(migrated, task_id)
    mentions = await fetch(
        migrated,
        "SELECT entity_id, role, mention_order FROM ai.entity_mentions WHERE observation_id = $1",
        observation["id"],
    )
    assert {row["entity_id"]: (row["role"], row["mention_order"]) for row in mentions} == {
        watched: ("watch", None),
        world.own: ("own", 1),
    }


async def test_the_task_of_a_deleted_prompt_is_ingested_into_nothing(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt, task_id = await _gemini(worker_db, migrated, world, store)
    await execute(migrated, "DELETE FROM ai.prompts WHERE id = $1", prompt.id)

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    rows = await fetch(
        migrated, "SELECT id FROM ai.observations WHERE collection_task_id = $1", task_id
    )
    assert rows == []


async def test_a_new_entity_configuration_gets_its_own_derivation(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    async with worker_db() as db, db.begin():
        first = await current_derivation(db, project.workspace_id, project.id, 1)
        again = await current_derivation(db, project.workspace_id, project.id, 1)
        second = await current_derivation(db, project.workspace_id, project.id, 2)

    assert first == again
    assert second != first


async def test_answers_of_two_projects_are_read_with_their_own_entities(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    other = await make_ai_world(migrated)
    await execute(
        migrated,
        "UPDATE core.project_entities SET track_ai = false WHERE project_id = $1",
        other.project.id,
    )
    _, mine = await _gemini(worker_db, migrated, world, store)
    theirs_prompt = await add_prompt(migrated, other.project, QUESTION)
    theirs = await fetched_ai_task(
        worker_db,
        migrated,
        other.project,
        theirs_prompt,
        at_now(CAPTURED / "gemini_scraper_answer.json"),
        store,
        engine_code="gemini_web",
    )

    await ingest(worker_db, store)

    assert (await _facts(migrated, (await _observation(migrated, mine))["id"]))["own_mentioned"]
    their_facts = await _facts(migrated, (await _observation(migrated, theirs))["id"])
    assert (their_facts["own_mentioned"], their_facts["tracked_entities_mentioned"]) == (False, 0)
    assert uuid.UUID(str(their_facts["project_id"])) == other.project.id
