"""What extraction is told about a project, read as the worker reads it (`app_worker`, without
row-level security): the tracked entities of that project, their aliases, sites and roles."""

from __future__ import annotations

import uuid

import pytest

from idraft.collectors.ai_context import AiContextCache, load_ai_context
from idraft.extraction.urls import canonicalize
from tests.api.auth.support import execute
from tests.collectors.ai_support import AiWorld, make_ai_world
from tests.collectors.rank_support import Ledger
from tests.conftest import PostgresServer


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


async def test_the_matcher_finds_the_projects_names_aliases_and_sites(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await execute(
        migrated,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, $3)",
        project.workspace_id,
        world.own,
        "Eventus",
    )

    async with worker_db() as db:
        context = await load_ai_context(
            db, workspace_id=project.workspace_id, project_id=project.id
        )

    assert context is not None
    found = context.matcher.match("Eventus beats CyberNX; see eventussecurity.com.")
    assert [(m.entity_id, [s.match_method for s in m.spans]) for m in found.mentions] == [
        (world.own, ["alias_word", "alias_domain"]),
        (world.rival, ["alias_name"]),
    ]
    assert context.roles == {world.own: "own", world.rival: "competitor"}
    own_page = context.resolver.resolve_url(canonicalize("https://www.eventussecurity.com/soc"))
    assert (own_page.domain_role, own_page.entity_id) == ("own", world.own)
    assert context.entity_config_version == 1


async def test_an_entity_not_tracked_in_ai_answers_and_other_workspaces_are_left_out(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    # The same brands in another workspace: never this project's.
    await make_ai_world(migrated)
    await execute(
        migrated,
        "UPDATE core.project_entities SET track_ai = false WHERE entity_id = $1",
        world.rival,
    )
    project = world.project

    async with worker_db() as db:
        context = await load_ai_context(
            db, workspace_id=project.workspace_id, project_id=project.id
        )

    assert context is not None
    found = context.matcher.match("CyberNX and Eventus Security run SOCs.")
    assert [mention.entity_id for mention in found.mentions] == [world.own]
    assert context.roles == {world.own: "own"}
    # Its site is still a rule, so it does not fall through to a broader one.
    rival_page = context.resolver.resolve_url(canonicalize("https://cybernx.com/"))
    assert (rival_page.domain_role, rival_page.entity_id) == ("competitor", world.rival)


async def test_a_pass_builds_each_projects_context_once(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    cache = AiContextCache()

    async with worker_db() as db:
        first = await cache.get(db, project.workspace_id, project.id)
        await execute(
            migrated,
            "UPDATE core.projects SET entity_config_version = 2 WHERE id = $1",
            project.id,
        )
        again = await cache.get(db, project.workspace_id, project.id)
    async with worker_db() as db:
        fresh = await load_ai_context(db, workspace_id=project.workspace_id, project_id=project.id)

    assert again is first
    assert fresh is not None
    assert fresh.entity_config_version == 2


async def test_a_project_that_is_gone_has_no_context(worker_db: Ledger, world: AiWorld) -> None:
    async with worker_db() as db:
        missing = await load_ai_context(
            db, workspace_id=world.project.workspace_id, project_id=uuid.uuid4()
        )

    assert missing is None
