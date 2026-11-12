"""The contract of the AI coverage of a run and of daily AI collection (WP-03 T3a; contracts C3
and N5): the access checks answer first, then `501 not_implemented` until WP-30 builds the
bodies. The owner deletes this file when it writes the real tests."""

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

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

DAILY = "ai/collection/daily?from=2026-11-01&to=2026-11-07&filter[engine_code_in]=gemini_web"


def _paths() -> list[str]:
    return [f"runs/{uuid.uuid4()}/ai-coverage", DAILY]


async def test_run_coverage_answers_501_for_a_reader(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "runs", uuid.uuid4(), "ai-coverage"),
        headers=viewer.headers,
    )

    assert problem(response) == NOT_BUILT


async def test_daily_collection_answers_501_for_a_reader(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, DAILY),
        headers=viewer.headers,
    )

    assert problem(response) == NOT_BUILT


@pytest.mark.parametrize("which", [0, 1])
async def test_both_check_access_first(
    which: int, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, _paths()[which])

    assert problem(await api.get(url, headers=billing.headers)) == FORBIDDEN
    assert problem(await api.get(url, headers=outsider.headers)) == NOT_FOUND


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

    assert problem(bad_run) == INVALID
    assert problem(bad_engine) == INVALID


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
