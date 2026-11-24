"""`rederive-facts`: the facts of stored answers made again with the current extractor, from the
answer text in the database, with no provider and no object store."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from idraft import cli
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.collectors.ai_rederive import ProjectNotFoundError
from idraft.config.settings import to_sqlalchemy_url
from tests.api.auth.support import execute, fetch
from tests.collectors.ai_support import (
    AiWorld,
    add_prompt,
    chatgpt_answer,
    fetched_ai_task,
    make_ai_world,
)
from tests.collectors.rank_support import Ledger
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.test_cli import _run

TEXT = (
    "For a managed SOC in Mumbai we recommend Eventus Security. "
    "Eventus Security is a leading provider with a strong 24/7 team."
)
SOURCE = "https://eventussecurity.com/soc"


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


async def _stale_answer(worker_db: Ledger, pg: PostgresServer, world: AiWorld) -> int:
    """One ingested answer whose facts look as the first extractor left them: no recommendation,
    no tone, the own brand not seen, under a derivation of the old versions."""
    store = MemoryStore()
    prompt = await add_prompt(pg, world.project, "Which managed SOC providers are best?")
    await fetched_ai_task(
        worker_db, pg, world.project, prompt, chatgpt_answer(TEXT, [SOURCE]), store
    )
    await ingest(worker_db, store)
    await execute(
        pg,
        "UPDATE ai.derivations SET extractor_version = 1, recommendation_version = 0, "
        "sentiment_version = 0 WHERE project_id = $1",
        world.project.id,
    )
    await execute(
        pg,
        "UPDATE ai.observation_facts SET own_recommended = NULL, own_sentiment = NULL, "
        "own_mentioned = false WHERE project_id = $1",
        world.project.id,
    )
    rows = await fetch(pg, "SELECT id FROM ai.observations WHERE project_id = $1", world.project.id)
    assert len(rows) == 1
    observation_id: int = rows[0]["id"]
    return observation_id


async def _facts(pg: PostgresServer, observation_id: int) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT f.is_current, f.own_mentioned, f.own_recommended, f.own_sentiment, "
        "f.own_domain_cited, f.own_citation_count, f.total_citation_count, "
        "f.had_structured_list, f.own_structured_rank, d.extractor_version, "
        "d.recommendation_version, d.sentiment_version "
        "FROM ai.observation_facts f JOIN ai.derivations d ON d.id = f.derivation_id "
        "WHERE f.observation_id = $1 ORDER BY f.derivation_id",
        observation_id,
    )
    return [dict(row) for row in rows]


async def test_a_dry_run_reports_what_would_change_and_writes_nothing(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    observation_id = await _stale_answer(worker_db, migrated, world)
    before = await _facts(migrated, observation_id)

    report = await cli.rederive_facts(
        to_sqlalchemy_url(migrated.url("migrator")), world.project.id, dry_run=True
    )

    assert report is not None
    assert (report.candidates, report.rederived) == (1, 0)
    assert (report.mention_changes, report.recommended) == (1, 1)
    assert dict(report.sentiment) == {"positive": 1}
    assert await _facts(migrated, observation_id) == before


async def test_a_run_replaces_the_current_facts_and_keeps_the_old_ones_as_history(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    observation_id = await _stale_answer(worker_db, migrated, world)

    report = await cli.rederive_facts(
        to_sqlalchemy_url(migrated.url("migrator")), world.project.id, dry_run=False
    )

    assert report is not None
    assert (report.candidates, report.rederived) == (1, 1)
    old, new = await _facts(migrated, observation_id)
    assert (old["is_current"], old["own_recommended"]) == (False, None)
    assert new["is_current"]
    assert (new["own_mentioned"], new["own_recommended"], new["own_sentiment"]) == (
        True,
        True,
        "positive",
    )
    assert (new["extractor_version"], new["recommendation_version"]) == (2, 1)
    # The citation columns are carried over, not read again; no list is parsed.
    assert (new["own_domain_cited"], new["own_citation_count"], new["total_citation_count"]) == (
        old["own_domain_cited"],
        old["own_citation_count"],
        old["total_citation_count"],
    )
    assert (new["had_structured_list"], new["own_structured_rank"]) == (False, None)
    mentions = await fetch(
        migrated,
        "SELECT is_current, role FROM ai.entity_mentions WHERE observation_id = $1 "
        "ORDER BY derivation_id",
        observation_id,
    )
    assert [(row["is_current"], row["role"]) for row in mentions][-1] == (True, "own")
    assert sum(row["is_current"] for row in mentions) == 1


async def test_a_second_run_finds_nothing_to_do(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    observation_id = await _stale_answer(worker_db, migrated, world)
    url = to_sqlalchemy_url(migrated.url("migrator"))
    await cli.rederive_facts(url, world.project.id, dry_run=False)
    after_first = await _facts(migrated, observation_id)

    report = await cli.rederive_facts(url, world.project.id, dry_run=False)

    assert report is not None
    assert (report.candidates, report.rederived) == (0, 0)
    assert await _facts(migrated, observation_id) == after_first


async def test_an_unknown_project_is_refused(migrated: PostgresServer, world: AiWorld) -> None:
    with pytest.raises(ProjectNotFoundError):
        await cli.rederive_facts(
            to_sqlalchemy_url(migrated.url("migrator")), uuid.uuid4(), dry_run=True
        )


async def test_another_role_than_the_owner_is_refused(
    migrated: PostgresServer, world: AiWorld
) -> None:
    assert (
        await cli.rederive_facts(
            to_sqlalchemy_url(migrated.url("app_worker")), world.project.id, dry_run=True
        )
        is None
    )


def test_the_command_prints_the_counts(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["rederive-facts", "--project", str(uuid.uuid4()), "--dry-run"],
        database_url=migrated.url("migrator"),
    )

    assert (code, out) == (1, "")
    assert err == "The project is not there.\n"
