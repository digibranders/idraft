"""The published contract of the evidence viewer (docs/ai-visibility/contracts/evidence.md; WP-26
T0): `GET {P}/ai/observations/{observation_id}/compare` answers `501 not_implemented` after its
access and path checks, and the three new detail fields are optional in the API document. WP-26
T2 replaces the 501 test with the real ones."""

from __future__ import annotations

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

COMPARE = (
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/"
    "{observation_id}/compare"
)


async def test_compare_answers_501_for_a_reader_after_the_access_checks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    billing = await member(resources, migrated, workspace, "billing")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "observations", "1", "compare")

    assert problem(await api.get(url)) == (401, "unauthenticated")
    assert problem(await api.get(url, headers=billing.headers)) == FORBIDDEN
    assert problem(await api.get(url, headers=viewer.headers)) == NOT_BUILT


async def test_compare_is_404_for_a_non_member_and_for_a_project_outside_the_scope(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A project that does not exist in the workspace is the service's 404 (WP-26 T2)."""
    workspace = await make_workspace(migrated)
    elsewhere = await make_workspace(migrated, name="Elsewhere")
    project = await ai_project(migrated, workspace)
    other = await ai_project(migrated, workspace)
    outsider = await member(resources, migrated, elsewhere, "owner")
    scoped = await member(resources, migrated, workspace, "viewer", project_ids=[other])
    url = project_url(workspace, project, "ai", "observations", "1", "compare")

    assert problem(await api.get(url, headers=outsider.headers)) == NOT_FOUND
    assert problem(await api.get(url, headers=scoped.headers)) == NOT_FOUND


@pytest.mark.parametrize("observation_id", ["0", str(2**63), "-1", "abc"])
async def test_compare_validates_the_id_as_a_64_bit_integer(
    observation_id: str,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "observations", observation_id, "compare")

    assert problem(await api.get(url, headers=viewer.headers)) == INVALID


async def test_compare_accepts_the_largest_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "observations", str(2**63 - 1), "compare")

    assert problem(await api.get(url, headers=viewer.headers)) == NOT_BUILT


def test_the_new_fields_are_optional_in_openapi() -> None:
    schemas = build_openapi()["components"]["schemas"]

    for model, field in [
        ("CitationOut", "quote"),
        ("ObservationDetail", "answer_sha256"),
        ("ObservationDetail", "raw_sha256"),
    ]:
        assert field in schemas[model]["properties"], (model, field)
        assert field not in schemas[model].get("required", []), (model, field)
        assert schemas[model]["properties"][field].get("description"), (model, field)


def test_the_compare_route_is_published_with_its_response_model() -> None:
    document = build_openapi()
    operation = document["paths"][COMPARE]["get"]
    schemas = document["components"]["schemas"]

    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AnswerCompareResponse"
    }
    for problem_text in ("not_found", "no_baseline", "403", "422"):
        assert problem_text in operation["description"], problem_text
    assert {"AnswerCompare", "AnswerCompareResponse", "CompareSide"} <= set(schemas)
