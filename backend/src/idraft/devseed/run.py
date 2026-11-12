"""`python -m idraft.cli seed-eventus`: the Eventus Security AI prompt tracking project in a
development database (docs/ops/dev-eventus-seed.md; plan D3).

The seed only creates what is missing and never overwrites what a person set. Everything a person
must fix (the owner, the countries, a project that is archived or differs, the roles, the quota)
is checked before the first write.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi.exceptions import RequestValidationError

from idraft.api.problems import ProblemError
from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.devseed.context import SeedError, Sessions, country_locations, find_owner
from idraft.devseed.engines import EngineChanges, ensure_engines
from idraft.devseed.fixture import EventusFixture
from idraft.devseed.project import EntityChanges, ensure_entities, ensure_project, find_project
from idraft.devseed.prompts import (
    PromptChanges,
    check_prompt_quota,
    ensure_prompts,
    prompt_quota,
)
from idraft.devseed.topics import ensure_topics
from idraft.domain.ai_engines import EngineCode


@dataclass(frozen=True, slots=True)
class SeedReport:
    workspace_slug: str
    workspace_id: UUID
    project_slug: str
    project_id: UUID
    project_created: bool
    entities: EntityChanges
    terms_created: int
    engines: EngineChanges
    prompts: PromptChanges
    active_prompts: int
    prompt_limit: int

    def lines(self) -> list[str]:
        """What the command prints. A line that starts with WARNING needs a person's attention."""
        entities, engines, prompts = self.entities, self.engines, self.prompts
        state = "created" if self.project_created else "already there"
        lines = [
            f"Workspace {self.workspace_slug} ({self.workspace_id}), project "
            f"{self.project_slug} ({self.project_id}): {state}.",
            f"Entities: {entities.created} made, {entities.aliases_added} aliases and "
            f"{entities.domains_added} domains added, {entities.updated} changed, "
            f"{entities.roles_given} roles given.",
            *(
                f"WARNING: {conflict}. The seed kept it, as the API does (domain_role_conflict)."
                for conflict in entities.domain_conflicts
            ),
            f"Topics: {self.terms_created} terms made.",
            f"Engines turned on: {_names(engines.turned_on)}. "
            f"Engines widened: {_names(engines.widened)}.",
            *(
                f"WARNING: {code.value} was turned off by a person, so the seed left it off. "
                "Prompts for countries it does not run in will not be answered by it."
                for code in engines.left_off
            ),
        ]
        if engines.paused:
            lines.append(
                f"WARNING: AI schedules paused: {engines.paused}. The seed pauses every active "
                "AI schedule of the project so nothing spends by itself. They stay paused until "
                "a person resumes them in the app, and resuming them starts weekly spend."
            )
        else:
            lines.append("AI schedules paused: 0.")
        lines.append(
            f"Prompts: {prompts.created} made, {prompts.found} found, {prompts.archived} "
            f"archived, {prompts.differing} differing from the fixture."
        )
        if prompts.differing:
            lines.append(
                f"WARNING: found prompts that differ from the fixture: {prompts.differing}. "
                "They were left as they are."
            )
        if prompts.archived:
            lines.append(
                f"WARNING: found prompts that are archived: {prompts.archived}. "
                "They were left archived."
            )
        lines.append(
            f"Active prompts in the workspace: {self.active_prompts} of {self.prompt_limit}."
        )
        lines.append("No answers were made: they come from a run (docs/ops/dev-eventus-seed.md).")
        return lines


def _names(codes: tuple[EngineCode, ...]) -> str:
    return ", ".join(code.value for code in codes) or "none"


async def seed_eventus(
    sessions: Sessions, fixture: EventusFixture, workspace_slug: str
) -> SeedReport:
    access = await find_owner(sessions, workspace_slug)
    countries = {fixture.project.default_country} | {
        country for engine in fixture.engines for country in engine.countries
    }
    location_ids = await country_locations(sessions, countries)
    language = fixture.project.language_code
    found = await find_project(sessions, access, fixture.project.slug)
    await check_prompt_quota(sessions, access, found, language, fixture.prompts)
    project_id, created = await ensure_project(
        sessions, access, fixture.project, location_ids[fixture.project.default_country]
    )
    entities = await ensure_entities(
        sessions, access, project_id, fixture.brand, fixture.competitors
    )
    term_ids, terms_created = await ensure_topics(sessions, access, project_id, fixture.topics)
    engines = await ensure_engines(sessions, access, project_id, fixture.engines, location_ids)
    prompts = await ensure_prompts(
        sessions, access, project_id, language, fixture.prompts, term_ids
    )
    limit, used = await prompt_quota(sessions, access)
    return SeedReport(
        workspace_slug=workspace_slug,
        workspace_id=access.workspace_id,
        project_slug=fixture.project.slug,
        project_id=project_id,
        project_created=created,
        entities=entities,
        terms_created=terms_created,
        engines=engines,
        prompts=prompts,
        active_prompts=used,
        prompt_limit=limit,
    )


async def run_seed(settings: Settings, fixture: EventusFixture, workspace_slug: str) -> SeedReport:
    """`seed_eventus` on its own engine. A refusal a service raises (what the API would answer
    with a problem) becomes a `SeedError` that names it."""
    engine = create_engine(settings)
    try:
        return await seed_eventus(create_session_factory(engine), fixture, workspace_slug)
    except ProblemError as error:
        detail = f" {error.detail}" if error.detail else ""
        raise SeedError(
            f"The API refused a step: {error.title} ({error.problem_code}).{detail}"
        ) from None
    except RequestValidationError as error:
        found = "; ".join(
            f"{'.'.join(str(part) for part in item['loc'][1:])}: {item['msg'].rstrip('.')} "
            f"({item['type']})"
            for item in error.errors()
        )
        raise SeedError(f"The API refused a step: {found}.") from None
    finally:
        await engine.dispose()
