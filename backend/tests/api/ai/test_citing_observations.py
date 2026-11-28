"""`citing_observations` against Postgres: the ids of the answers that cite one address."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

from idraft.api.ai.citation_board_repository import citing_observations
from idraft.api.ai.source_repository import SourceScope
from idraft.api.resources import Resources
from idraft.db.engine import workspace_transaction
from tests.api.ai.sources_support import (
    GUIDE,
    WIKI,
    Cite,
    World,
    answer,
    derivation_of,
    make_world,
    page_ids,
)
from tests.api.auth.support import execute, fetchrow
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")


def scope_of(world: World, prompt: Prompt, **changes: object) -> SourceScope:
    now = datetime.now(UTC)
    scope = SourceScope(
        workspace_id=world.project.workspace_id,
        project_id=world.project.id,
        since=now - timedelta(days=30),
        until=now + timedelta(seconds=1),
        engine_codes=ENGINES,
        prompt_ids=(prompt.id,),
    )
    return replace(scope, **changes)  # type: ignore[arg-type]


async def citing(
    resources: Resources, pg: PostgresServer, world: World, scope: SourceScope, url: str
) -> frozenset[int]:
    url_id, _ = await page_ids(pg, url)
    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        return await citing_observations(db, scope, url_id)


async def observed_at_of(pg: PostgresServer, observation_id: int) -> datetime:
    row = await fetchrow(
        pg, "SELECT observed_at FROM ai.observations WHERE id = $1", observation_id
    )
    moment: datetime = row["observed_at"]
    return moment


async def test_returns_the_answers_that_cite_the_address_and_no_others(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    first = await answer(migrated, world, prompt, days_ago=3, cites=[Cite(GUIDE), Cite(WIKI)])
    second = await answer(migrated, world, prompt, days_ago=2, cites=[Cite(GUIDE)])
    await answer(migrated, world, prompt, days_ago=1, cites=[Cite(WIKI)])
    await answer(migrated, world, prompt, days_ago=1)

    found = await citing(resources, migrated, world, scope_of(world, prompt), GUIDE)

    assert found == frozenset({first, second})


async def test_an_address_cited_twice_in_one_answer_gives_the_id_once(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    twice = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE), Cite(GUIDE)])

    found = await citing(resources, migrated, world, scope_of(world, prompt), GUIDE)

    assert found == frozenset({twice})


async def test_an_address_nobody_cites_gives_an_empty_set(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    await answer(migrated, world, prompt, days_ago=1, cites=[Cite(WIKI)])
    await page_ids(migrated, GUIDE)

    found = await citing(resources, migrated, world, scope_of(world, prompt), GUIDE)

    assert found == frozenset()


async def test_an_answer_of_another_project_of_the_workspace_is_not_returned(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    mine = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    foreign = replace(world, project=other, derivation_id=await derivation_of(migrated, other))
    foreign_prompt = await add_prompt(migrated, other, "Best managed SOC providers?")
    await answer(migrated, foreign, foreign_prompt, days_ago=1, cites=[Cite(GUIDE)])

    found = await citing(resources, migrated, world, scope_of(world, prompt), GUIDE)

    assert found == frozenset({mine})


async def test_the_period_is_closed_at_since_and_open_at_until(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    only = await answer(migrated, world, prompt, days_ago=2, cites=[Cite(GUIDE)])
    moment = await observed_at_of(migrated, only)
    tick = timedelta(microseconds=1)

    def read(since: datetime, until: datetime) -> SourceScope:
        return scope_of(world, prompt, since=since, until=until)

    at_since = await citing(
        resources, migrated, world, read(moment, moment + timedelta(days=1)), GUIDE
    )
    just_before_since = await citing(
        resources, migrated, world, read(moment + tick, moment + timedelta(days=1)), GUIDE
    )
    at_until = await citing(
        resources, migrated, world, read(moment - timedelta(days=1), moment), GUIDE
    )
    just_before_until = await citing(
        resources, migrated, world, read(moment - timedelta(days=1), moment + tick), GUIDE
    )

    assert at_since == frozenset({only})
    assert just_before_since == frozenset()
    assert at_until == frozenset()
    assert just_before_until == frozenset({only})


async def test_flagged_citations_are_left_out_only_when_the_scope_excludes_flags(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    clean = await answer(migrated, world, prompt, days_ago=3, cites=[Cite(GUIDE)])
    internal = await answer(migrated, world, prompt, days_ago=2, cites=[Cite(GUIDE)])
    redirect = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])
    for observation_id, flag in ((internal, "engine_internal"), (redirect, "unresolved_redirect")):
        await execute(
            migrated,
            "UPDATE ai.citations SET flags = ARRAY[$2]::text[] WHERE observation_id = $1",
            observation_id,
            flag,
        )
    excluding = scope_of(world, prompt, excluded_flags=("engine_internal", "unresolved_redirect"))

    left_out = await citing(resources, migrated, world, excluding, GUIDE)
    kept = await citing(resources, migrated, world, scope_of(world, prompt), GUIDE)

    assert left_out == frozenset({clean})
    assert kept == frozenset({clean, internal, redirect})
