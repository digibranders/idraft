"""The whole seed: what it makes, that a second run changes nothing, that what a person must fix
stops it before the first write, and what its report says loudly."""

from __future__ import annotations

import uuid

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import SecretStr

from idraft.api.problems import QuotaExceededError, invalid_field
from idraft.config.settings import Settings
from idraft.devseed import run
from idraft.devseed.context import SeedError, Sessions
from idraft.devseed.engines import EngineChanges
from idraft.devseed.project import EntityChanges
from idraft.devseed.prompts import PromptChanges
from idraft.devseed.run import SeedReport, run_seed, seed_eventus
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import execute
from tests.conftest import PostgresServer
from tests.devseed.support import FIXTURE, gulf_locations, owner_workspace, world_counts

_ALIASES = sum(
    len({alias.casefold() for alias in part.aliases} - {part.name.casefold()})
    for part in [FIXTURE.brand, *FIXTURE.competitors]
)
_NO_ENTITY_CHANGES = EntityChanges(
    created=0, aliases_added=0, domains_added=0, updated=0, roles_given=0
)


def _report(
    *,
    engines: EngineChanges | None = None,
    prompts: PromptChanges | None = None,
    entities: EntityChanges | None = None,
    created: bool = False,
) -> SeedReport:
    return SeedReport(
        workspace_slug="digibranders",
        workspace_id=uuid.UUID(int=1),
        project_slug="eventus-security",
        project_id=uuid.UUID(int=2),
        project_created=created,
        entities=entities or _NO_ENTITY_CHANGES,
        terms_created=0,
        engines=engines or EngineChanges(turned_on=(), widened=(), left_off=(), paused=0),
        prompts=prompts or PromptChanges(created=0, found=72, archived=0, differing=0),
        active_prompts=72,
        prompt_limit=150,
    )


async def test_the_seed_makes_the_project_and_a_second_run_changes_nothing(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)

    report = await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert report.project_created
    assert report.entities == EntityChanges(
        created=9, aliases_added=0, domains_added=0, updated=0, roles_given=9
    )
    assert report.terms_created == 29
    assert report.engines == EngineChanges(
        turned_on=(EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB),
        widened=(),
        left_off=(),
        paused=2,
    )
    assert report.prompts == PromptChanges(created=72, found=0, archived=0, differing=0)
    assert (report.active_prompts, report.prompt_limit) == (72, 150)
    counts = await world_counts(migrated, workspace)
    assert {name: value for name, value in counts.items() if name != "audit"} == {
        "projects": 1,
        "entities": 9,
        "aliases": _ALIASES,
        "entity_domains": 9,
        "roles": 9,
        "terms": 29,
        "engines": 2,
        "schedules": 2,
        "active_schedules": 0,
        "prompts": 72,
        "versions": 72,
        "observations": 0,
        "runs": 0,
    }

    again = await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert not again.project_created
    assert again.entities == _NO_ENTITY_CHANGES
    assert again.terms_created == 0
    assert again.engines == EngineChanges(turned_on=(), widened=(), left_off=(), paused=0)
    assert again.prompts == PromptChanges(created=0, found=72, archived=0, differing=0)
    assert await world_counts(migrated, workspace) == counts


async def test_what_a_person_changed_stays_and_is_reported(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    first = await seed_eventus(sessions, FIXTURE, workspace.slug)
    await execute(
        migrated,
        "UPDATE ai.project_engines SET is_enabled = false "
        "WHERE project_id = $1 AND engine_code = 'chatgpt_web'",
        first.project_id,
    )
    await execute(
        migrated,
        "UPDATE ai.prompts SET importance = importance % 5 + 1 WHERE id = "
        "(SELECT id FROM ai.prompts WHERE project_id = $1 LIMIT 1)",
        first.project_id,
    )
    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = true WHERE project_id = $1 "
        "AND workload = 'ai_prompt' AND deleted_at IS NULL",
        first.project_id,
    )
    before = await world_counts(migrated, workspace)

    again = await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert again.engines == EngineChanges(
        turned_on=(), widened=(), left_off=(EngineCode.CHATGPT_WEB,), paused=2
    )
    assert again.prompts == PromptChanges(created=0, found=72, archived=0, differing=1)
    after = await world_counts(migrated, workspace)
    # Only the pause of the two resumed schedules (and its audit entries) was written.
    assert after["active_schedules"] == 0
    assert {k: v for k, v in after.items() if k not in ("audit", "active_schedules")} == {
        k: v for k, v in before.items() if k not in ("audit", "active_schedules")
    }


async def test_prompts_past_the_quota_stop_the_seed_with_nothing_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    other = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, other, 40)
    await set_prompt_quota(migrated, workspace, 100)
    before = await world_counts(migrated, workspace)

    with pytest.raises(SeedError, match="Nothing was written"):
        await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert await world_counts(migrated, workspace) == before


async def test_a_missing_country_stops_the_seed_with_nothing_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    await execute(migrated, "UPDATE core.locations SET is_active = false WHERE id = 2784")
    try:
        with pytest.raises(SeedError, match="AE"):
            await seed_eventus(sessions, FIXTURE, workspace.slug)
        assert (await world_counts(migrated, workspace))["projects"] == 0
    finally:
        await gulf_locations(migrated)


def test_the_report_of_a_first_run_names_each_step() -> None:
    report = _report(
        created=True,
        entities=EntityChanges(
            created=9, aliases_added=1, domains_added=2, updated=0, roles_given=9
        ),
        engines=EngineChanges(
            turned_on=(EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB),
            widened=(),
            left_off=(),
            paused=2,
        ),
        prompts=PromptChanges(created=72, found=0, archived=0, differing=0),
    )

    text = "\n".join(report.lines())

    assert "project eventus-security (" in text
    assert "created." in text
    assert "Entities: 9 made, 1 aliases and 2 domains added, 0 changed, 9 roles given." in text
    assert "Topics: 0 terms made." in text
    assert "Engines turned on: chatgpt_web, gemini_web. Engines widened: none." in text
    assert "WARNING: AI schedules paused: 2." in text
    assert "resumes them in the app" in text
    assert "Prompts: 72 made, 0 found" in text
    assert "Active prompts in the workspace: 72 of 150." in text
    assert "No answers were made" in text
    assert "left off" not in text.lower()


def test_the_report_of_a_second_run_is_calm() -> None:
    text = "\n".join(_report().lines())

    assert "already there" in text
    assert "AI schedules paused: 0." in text
    assert "WARNING" not in text


def test_an_engine_left_off_is_a_loud_warning() -> None:
    report = _report(
        engines=EngineChanges(
            turned_on=(),
            widened=(EngineCode.GEMINI_WEB,),
            left_off=(EngineCode.CHATGPT_WEB,),
            paused=0,
        )
    )

    text = "\n".join(report.lines())

    assert "Engines widened: gemini_web." in text
    assert (
        "WARNING: chatgpt_web was turned off by a person, so the seed left it off. Prompts for "
        "countries it does not run in will not be answered by it."
    ) in text


def test_differences_and_domain_conflicts_are_reported() -> None:
    report = _report(
        prompts=PromptChanges(created=0, found=72, archived=3, differing=5),
        entities=EntityChanges(
            created=0,
            aliases_added=0,
            domains_added=1,
            updated=0,
            roles_given=0,
            domain_conflicts=(
                "example.com was added to Darkwatch SOC, and another entity of a project that "
                "names it claims it too",
            ),
        ),
    )

    text = "\n".join(report.lines())

    assert "Prompts: 0 made, 72 found, 3 archived, 5 differing from the fixture." in text
    assert (
        "WARNING: found prompts that differ from the fixture: 5. They were left as they are."
        in text
    )
    assert "WARNING: found prompts that are archived: 3. They were left archived." in text
    assert (
        "WARNING: example.com was added to Darkwatch SOC, and another entity of a project that "
        "names it claims it too. The seed kept it, as the API does (domain_role_conflict)."
    ) in text


def _settings() -> Settings:
    return Settings(
        process_role="cli",
        app_env="local",
        app_origin="http://localhost:3000",
        database_url=SecretStr("postgresql://app_api:secret-pw@127.0.0.1:9/idraft"),
        redis_url=SecretStr("redis://127.0.0.1:6379/0"),
    )


async def test_a_refusal_of_the_api_becomes_a_message(monkeypatch: pytest.MonkeyPatch) -> None:
    async def refuse(*_: object) -> SeedReport:
        raise QuotaExceededError("Too many prompts.", limit=150, used=140, requested=72)

    monkeypatch.setattr(run, "seed_eventus", refuse)

    with pytest.raises(SeedError) as caught:
        await run_seed(_settings(), FIXTURE, "digibranders")

    assert str(caught.value) == (
        "The API refused a step: Workspace limit reached (quota_exceeded). Too many prompts."
    )


async def test_a_refused_field_names_its_code(monkeypatch: pytest.MonkeyPatch) -> None:
    async def refuse(*_: object) -> SeedReport:
        error: RequestValidationError = invalid_field(
            "location_ids",
            code="location_not_supported",
            message="ChatGPT runs in active countries only.",
        )
        raise error

    monkeypatch.setattr(run, "seed_eventus", refuse)

    with pytest.raises(SeedError) as caught:
        await run_seed(_settings(), FIXTURE, "digibranders")

    assert str(caught.value) == (
        "The API refused a step: location_ids: ChatGPT runs in active countries only "
        "(location_not_supported)."
    )
