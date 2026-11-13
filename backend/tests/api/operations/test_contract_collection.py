"""The contract of the AI coverage of a run and of daily AI collection (WP-03 T3a, built by WP-30
T1; contracts C3 and N5): the access checks answer first, then the bodies (their data is in
`test_ai_coverage.py` and `test_collection_daily.py`), and the API document carries both
routes."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.support import ai_project
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

UNAUTHENTICATED = (401, "unauthenticated")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

DAILY = "ai/collection/daily?from=2026-11-01&to=2026-11-07&filter[engine_code_in]=gemini_web"


def _paths() -> list[str]:
    return [f"runs/{uuid.uuid4()}/ai-coverage", DAILY]


@pytest.mark.parametrize("which", [0, 1])
async def test_both_check_access_first(
    which: int, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """401 without a session, 404 for a stranger and for an unknown project, 403 for a role
    without `data:read`; the bodies answer only after that."""
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    owner = await member(resources, migrated, workspace, "owner")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, _paths()[which])

    assert problem(await api.get(url)) == UNAUTHENTICATED
    assert problem(await api.get(url, headers=outsider.headers)) == NOT_FOUND
    assert problem(await api.get(url, headers=billing.headers)) == FORBIDDEN
    unknown = project_url(workspace, uuid.uuid4(), _paths()[which])
    assert problem(await api.get(unknown, headers=owner.headers)) == NOT_FOUND


async def test_a_run_that_does_not_exist_is_not_found_through_the_service(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "runs", uuid.uuid4(), "ai-coverage"),
        headers=viewer.headers,
    )

    assert problem(response) == NOT_FOUND


async def test_a_bad_run_id_or_engine_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    bad_run = await api.get(
        project_url(workspace, project, "runs", "nope", "ai-coverage"), headers=viewer.headers
    )
    bad_engine = await api.get(
        project_url(
            workspace, project, "ai/collection/daily?filter[engine_code_in]=perplexity_web"
        ),
        headers=viewer.headers,
    )

    four_engines = await api.get(
        project_url(
            workspace,
            project,
            "ai/collection/daily?filter[engine_code_in]=chatgpt_web,gemini_web,google_ai_mode,"
            "chatgpt_web",
        ),
        headers=viewer.headers,
    )

    assert problem(bad_run) == INVALID
    assert problem(bad_engine) == INVALID
    assert problem(four_engines) == INVALID


def test_the_api_document_has_coverage_and_daily() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"

    assert f"{prefix}/runs/{{run_id}}/ai-coverage" in paths
    assert f"{prefix}/ai/collection/daily" in paths
    for name in (
        "AiCoverage",
        "AiCoverageEngine",
        "AiCoverageMissing",
        "InvalidByStatus",
        "CollectionDay",
        "CollectionDailyMeta",
        "AnswerStatusCounts",
    ):
        assert name in schemas, name
    day = schemas["CollectionDay"]["properties"]
    assert "date" in day
    assert "date_" not in day
    assert schemas["AiCoverage"]["properties"]["by_engine"]["maxItems"] == 3
    assert schemas["CollectionDailyMeta"]["properties"]["engine_codes"]["maxItems"] == 3
    assert schemas["CollectionDailyResponse"]["properties"]["data"]["maxItems"] == 276


def test_the_coverage_schema_has_partial_and_no_invalid_partial() -> None:
    """A partial answer counts as valid (doc 07 section 5.5), so it is not an invalid status; the
    engine says how many of its valid answers were partial."""
    schemas = build_openapi()["components"]["schemas"]

    assert set(schemas["InvalidByStatus"]["properties"]) == {"empty", "refused", "error"}
    assert set(schemas["InvalidByStatus"]["required"]) == {"empty", "refused", "error"}
    engine = schemas["AiCoverageEngine"]["properties"]
    assert set(engine) == {
        "engine_code",
        "planned",
        "observed",
        "valid",
        "partial",
        "invalid_by_status",
        "valid_rate",
    }
    assert "partial" in schemas["AiCoverageEngine"]["required"]
    assert engine["partial"]["type"] == "integer"
    assert "valid" in engine["partial"]["description"]
