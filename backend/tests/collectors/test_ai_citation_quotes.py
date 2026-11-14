"""Ingest keeps the quote of each cited source in `ai.citations.quote` (WP-26 BE-SOURCES-21): the
passage Gemini's scraper gave, nothing for an engine that gives none."""

from __future__ import annotations

import pytest

from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.auth.support import fetch
from tests.collectors.ai_support import (
    AiWorld,
    add_prompt,
    at_now,
    chatgpt_answer,
    fetched_ai_task,
    make_ai_world,
)
from tests.collectors.rank_support import Ledger
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

CAPTURED = FIXTURES / "captured"
QUESTION = "What are the best managed SOC providers in India?"


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


async def _quotes(pg: PostgresServer, task_id: int) -> list[str | None]:
    rows = await fetch(
        pg,
        "SELECT c.quote FROM ai.citations c JOIN ai.observations o "
        "ON o.id = c.observation_id AND o.observed_at = c.observed_at "
        "WHERE o.collection_task_id = $1 ORDER BY c.citation_index",
        task_id,
    )
    return [row["quote"] for row in rows]


async def test_ingest_writes_the_quote_of_each_gemini_source(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    task_id = await fetched_ai_task(
        worker_db,
        migrated,
        world.project,
        prompt,
        at_now(CAPTURED / "gemini_scraper_answer.json"),
        store,
        engine_code="gemini_web",
    )

    await ingest(worker_db, store)

    quotes = await _quotes(migrated, task_id)
    # The two sources that are only in the answer's list have no quote.
    assert [quote is not None for quote in quotes] == [False, True, True, False, True]
    assert quotes[4] is not None
    assert quotes[4].startswith("Factosecure is emerging as a startup-focused")


async def test_an_answer_without_quotes_writes_null(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    task_id = await fetched_ai_task(
        worker_db,
        migrated,
        world.project,
        prompt,
        chatgpt_answer(
            "Several firms run managed SOCs in India, with 24x7 monitoring and response.",
            ["https://news.example/soc"],
        ),
        store,
    )

    await ingest(worker_db, store)

    assert await _quotes(migrated, task_id) == [None]
