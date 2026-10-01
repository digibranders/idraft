"""Phase 2 acceptance through the API (docs/29-phase-roadmap.md): a project with its own brand,
domains and five competitors; the alias test on 20 sample answers; locations searchable after a
sync against a fake DataForSEO."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from pydantic import SecretStr

from sightline.api.resources import Resources
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.providers.dataforseo.client import DataForSeoClient
from sightline.providers.dataforseo.locations import LOCATIONS_PATH
from sightline.worker.assembly import sync_dataforseo_locations
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member
from tests.conftest import BASE_URL, PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, Api, FakeGate, fixture

ANSWERS = Path(__file__).parents[1] / "fixtures" / "ai_answers" / "onboarding.json"
SAN_FRANCISCO = 1014221
COMPETITORS: list[dict[str, Any]] = [
    {"canonical_name": "HubSpot", "domains": [{"domain": "hubspot.com"}]},
    {
        "canonical_name": "Salesforce",
        "aliases": [
            {"alias": "SFDC", "case_sensitive": True},
            {"alias": "Salesforce Tower", "is_negative": True},
        ],
    },
    {"canonical_name": "Pipedrive"},
    {"canonical_name": "Zoho CRM"},
    {"canonical_name": "Monday", "is_ambiguous": True, "disambiguation_hints": ["crm"]},
]


async def _sync_locations(pg: PostgresServer, redis_url: str) -> None:
    """The monthly job, as the worker runs it, against a DataForSEO that answers the fixture."""
    settings = Settings(
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(pg.url("app_worker")),
        redis_url=SecretStr(redis_url),
        db_pool_size=2,
        log_level="critical",
        app_env="test",
    )
    engine = create_engine(settings)
    events: list[str] = []
    api = Api(events)
    api.answer("GET", LOCATIONS_PATH, fixture("locations"))
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
            client = DataForSeoClient(
                http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
            )
            report = await sync_dataforseo_locations(create_session_factory(engine), client)
    finally:
        await engine.dispose()
    assert report is not None
    assert report.listed == 9


def _project_url(workspace: Workspace, project_id: str, *parts: str) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/projects/{project_id}", *parts])


async def _competitor(
    api: httpx.AsyncClient, workspace: Workspace, owner: Caller, project_id: str, **body: Any
) -> str:
    created = await api.post(
        f"/api/v1/workspaces/{workspace.id}/entities",
        json={"entity_type": "brand", **body},
        headers=owner.headers,
    )
    assert created.status_code == 201, created.text
    entity_id: str = created.json()["data"]["entity_id"]
    given = await api.post(
        _project_url(workspace, project_id, "entities"),
        json={"entity_id": entity_id, "role": "competitor"},
        headers=owner.headers,
    )
    assert given.status_code == 201, given.text
    return entity_id


def _utf16_slice(text: str, start: int, end: int) -> str:
    return text.encode("utf-16-le")[start * 2 : end * 2].decode("utf-16-le")


async def test_a_project_is_onboarded_and_its_aliases_tested(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, redis_url: str
) -> None:
    await execute(migrated, "UPDATE core.projects SET default_location_id = NULL")
    await execute(migrated, "DELETE FROM core.provider_location_map")
    await execute(migrated, "DELETE FROM core.locations")
    await _sync_locations(migrated, redis_url)
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    # Locations are searchable once synced.
    found = await api.get(
        "/api/v1/locations", params={"filter[q]": "san francisco"}, headers=owner.headers
    )
    assert [row["location_id"] for row in found.json()["data"]] == [SAN_FRANCISCO]

    # A project with its own brand, its domains and a default location.
    created = await api.post(
        f"/api/v1/workspaces/{workspace.id}/projects",
        json={
            "name": "Fynix",
            "slug": "fynix",
            "primary_domain": "https://www.fynix.digital/",
            "default_location_id": SAN_FRANCISCO,
            "own_entity": {
                "canonical_name": "Fynix",
                "aliases": ["Fynix Digital"],
                "domains": ["https://www.fynix.digital/", "fynix.io"],
            },
        },
        headers=owner.headers,
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["data"]["project_id"]
    assert created.json()["data"]["default_location"]["location_id"] == SAN_FRANCISCO

    # Five competitors.
    for competitor in COMPETITORS:
        await _competitor(api, workspace, owner, project_id, **competitor)
    roles = await api.get(_project_url(workspace, project_id, "entities"), headers=owner.headers)
    assert [
        (row["entity"]["canonical_name"], row["role"], row["is_primary"])
        for row in roles.json()["data"]
    ] == [
        ("Fynix", "own", True),
        ("HubSpot", "competitor", False),
        ("Monday", "competitor", False),
        ("Pipedrive", "competitor", False),
        ("Salesforce", "competitor", False),
        ("Zoho CRM", "competitor", False),
    ]
    domains = await api.get(_project_url(workspace, project_id, "domains"), headers=owner.headers)
    assert sorted(
        (row["entity"]["canonical_name"], row["domain"]["host"]) for row in domains.json()["data"]
    ) == [("Fynix", "fynix.digital"), ("Fynix", "fynix.io"), ("HubSpot", "hubspot.com")]

    # The alias test highlights the right spans on each sample answer.
    answers = json.loads(ANSWERS.read_text())["answers"]
    assert len(answers) == 20
    for answer in answers:
        body = {key: answer[key] for key in ("text", "markdown") if key in answer}
        (text,) = body.values()
        response = await api.post(
            _project_url(workspace, project_id, "alias-test"), json=body, headers=owner.headers
        )
        assert response.status_code == 200, response.text
        spans = sorted(
            (
                (span["start"], mention["entity"]["canonical_name"], span)
                for mention in response.json()["data"]["mentions"]
                for span in mention["spans"]
            ),
            key=lambda found: (found[0], found[1]),
        )
        assert [
            [name, _utf16_slice(text, span["start"], span["end"]), span["status"]]
            for _, name, span in spans
        ] == answer["spans"], text
