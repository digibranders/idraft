"""The Citations page routes (WP-76) against Postgres: the repository reads, then each route.
Numbers are worked out by hand from the answers in each test."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from idraft.api.ai import citation_board_repository as repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.resources import Resources
from idraft.db.engine import workspace_transaction
from tests.api.ai.citation_board_support import make_run, run_answer
from tests.api.ai.sources_support import GUIDE, OWN, Cite, World, make_world
from tests.api.auth.support import execute
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer


def scope_of(
    world: World, prompt_ids: tuple[UUID, ...], *, days: int = repository.LOOKBACK_DAYS
) -> SourceScope:
    now = datetime.now(UTC)
    return SourceScope(
        workspace_id=world.project.workspace_id,
        project_id=world.project.id,
        since=now - timedelta(days=days),
        until=now + timedelta(seconds=1),
        engine_codes=("chatgpt_web", "gemini_web", "google_ai_mode"),
        prompt_ids=prompt_ids,
    )


def days_ago_of(moment: datetime) -> float:
    return (datetime.now(UTC) - moment).total_seconds() / 86400.0


async def test_lookback_answers_carry_their_run_and_mentions(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=1)
    await run_answer(
        migrated,
        world,
        prompt,
        run=run,
        days_ago=1,
        cites=[world.own_cite()],
        own_mentioned=True,
        mentions=[world.rival],
    )
    # Outside a 5 day lookback, inside the partitions the test database keeps
    await run_answer(migrated, world, prompt, run=None, days_ago=20)

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,), days=5))

    (only,) = answers
    assert (only.run_id, only.run_key, only.own_mentioned) == (run, str(run), True)
    assert only.competitors_mentioned == frozenset({world.rival})


async def test_lookback_answers_come_newest_first(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=3)
    ids = [
        await run_answer(migrated, world, prompt, run=run, days_ago=days) for days in (3, 1, 2, 0.5)
    ]

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,)))

    assert [a.observation_id for a in answers] == [ids[3], ids[1], ids[2], ids[0]]


async def test_units_are_one_per_url_per_answer_and_skip_flagged_citations(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=1)
    oid = await run_answer(
        migrated,
        world,
        prompt,
        run=run,
        days_ago=1,
        cites=[world.own_cite(), world.own_cite(), Cite(GUIDE)],
    )
    await execute(
        migrated,
        "UPDATE ai.citations SET flags = ARRAY['unresolved_redirect'] "
        "WHERE observation_id = $1 AND raw_url = $2",
        oid,
        GUIDE,
    )
    scope = replace(scope_of(world, (prompt.id,)), excluded_flags=("unresolved_redirect",))

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope)
        units = await repository.units_of(db, scope, answers)

    assert [(u.url, u.domain_role) for u in units[oid]] == [(OWN, "own")]


async def test_an_answer_without_a_run_is_its_own_run_per_utc_day(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    yesterday = (datetime.now(UTC) - timedelta(days=1)).replace(
        hour=12, minute=0, second=0, microsecond=0
    )
    moments = [
        yesterday - timedelta(days=1),
        yesterday,
        yesterday + timedelta(minutes=5),
    ]
    for moment in moments:
        await run_answer(migrated, world, prompt, run=None, days_ago=days_ago_of(moment))

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,)))

    keys = [a.run_key for a in answers]
    assert all(a.run_key.startswith("day:") and a.run_id is None for a in answers)
    # newest first: the two replicates of yesterday share a key, the day before has its own
    assert keys[0] == keys[1] == f"day:{yesterday.date()}"
    assert keys[2] == f"day:{(yesterday - timedelta(days=1)).date()}"


async def test_tracked_competitors_entity_names_and_run_number(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    workspace_id, project_id = world.project.workspace_id, world.project.id
    await execute(
        migrated,
        "UPDATE core.project_entities SET color_index = 3 WHERE project_id = $1 AND entity_id = $2",
        project_id,
        world.rival,
    )
    first = await make_run(migrated, world, days_ago=10)
    second = await make_run(migrated, world, days_ago=5)
    third = await make_run(migrated, world, days_ago=1)
    failed = await make_run(migrated, world, days_ago=3)
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'failed' WHERE id = $1", failed
    )

    async with workspace_transaction(
        resources.sessions, workspace_id, user_id=world.owner.user_id
    ) as db:
        competitors = await repository.tracked_competitors(db, workspace_id, project_id)
        names = await repository.entity_names(
            db, workspace_id, project_id, {world.rival, world.own}
        )
        nothing = await repository.entity_names(db, workspace_id, project_id, set())
        numbers = [
            await repository.run_number(db, workspace_id, project_id, run)
            for run in (first, second, third, failed, None)
        ]

    (rival,) = competitors
    assert (rival.entity_id, rival.name, rival.color_index) == (world.rival, "CyberNX", 3)
    assert rival.domain == "cybernx.com"
    assert names == {world.rival: ("CyberNX", 3), world.own: ("Eventus Security", None)}
    assert nothing == {}
    # The failed run is not counted, but its own number is the completed runs up to its start
    assert numbers == [1, 2, 3, 2, None]
