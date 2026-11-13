"""Contract C1, the lint body shapes, bulk update, bulk archive by filter and the limits read
(docs/ai-visibility/contracts/c1-prompts.md): each addition not built yet answers 501 once the
caller may use the route and the body is valid; left out, nothing changes. WP-13 deletes this
file when it writes the real tests."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
from pydantic import TypeAdapter, ValidationError

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from idraft.api.schemas.ai import PromptLintBody
from idraft.api.schemas.ai_bulk import PromptBulkUpdate
from tests.api.ai.support import ai_project, seed_prompts
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

PROJECT_PATH = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
ID = str(uuid.uuid4())
TERM = str(uuid.uuid4())
ITEM = {"text": "Is Acme good?", "language_code": "en", "country_iso": "US"}


def _codes(model: Any, body: dict[str, Any]) -> list[str]:
    adapter = model if isinstance(model, TypeAdapter) else TypeAdapter(model)
    with pytest.raises(ValidationError) as caught:
        adapter.validate_python(body)
    return [error["type"] for error in caught.value.errors()]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"ids": [ID]}, "nothing_to_change"),
        ({"ids": [ID], "add_term_ids": [TERM], "remove_term_ids": [TERM]}, "added_and_removed"),
        ({"set": {"importance": 1}}, "value_error"),
        ({"ids": [ID], "filter": {}, "set": {"importance": 1}}, "value_error"),
        ({"ids": [], "set": {"importance": 1}}, "too_short"),
        ({"ids": [ID], "set": {}}, "value_error"),
        ({"ids": [ID], "set": {"importance": None}}, "null_not_allowed"),
        ({"ids": [ID], "set": {"expected_frequency": "daily"}}, "extra_forbidden"),
        ({"filter": {"importance_in": [6]}, "set": {"is_branded": True}}, "less_than_equal"),
        ({"ids": [ID] * 1001, "set": {"importance": 1}}, "too_long"),
        ({"filter": {"q": "x" * 201}, "set": {"importance": 1}}, "string_too_long"),
        ({"filter": {"intent_in": []}, "set": {"importance": 1}}, "too_short"),
        ({"filter": {"intent_in": ["commercial"] * 101}, "set": {"importance": 1}}, "too_long"),
        ({"ids": [ID], "add_term_ids": [TERM] * 21}, "too_long"),
        ({"ids": [ID], "set": {"importance": 6}}, "less_than_equal"),
    ],
)
def test_a_bulk_update_body_breaking_a_rule_is_refused_with_its_code(
    body: dict[str, Any], code: str
) -> None:
    assert code in _codes(PromptBulkUpdate, body)


def test_a_bulk_update_body_that_says_something_is_accepted() -> None:
    by_ids = PromptBulkUpdate.model_validate({"ids": [ID], "set": {"importance": 1}})
    by_filter = PromptBulkUpdate.model_validate(
        {"filter": {"intent_in": ["commercial"]}, "add_term_ids": [TERM]}
    )

    assert by_ids.set is not None
    assert by_filter.filter is not None


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"items": []}, "too_short"),
        ({"items": [ITEM] * 1001}, "too_long"),
        ({"items": [{"text": "x?", "language_code": "en"}]}, "missing"),
        ({"items": [ITEM], "texts": ["x?"]}, "extra_forbidden"),
        ({"texts": []}, "too_short"),
    ],
)
def test_a_lint_items_body_is_refused_with_its_code(body: dict[str, Any], code: str) -> None:
    assert code in _codes(TypeAdapter(PromptLintBody), body)


async def test_lint_language_code_answers_501(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"texts": ["Is Acme good?"], "language_code": "en"},
        headers=viewer.headers,
    )

    assert problem(response) == NOT_BUILT


async def test_lint_checks_access_before_the_body_is_used(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", "lint")

    refused = await api.post(url, json={"items": [ITEM]}, headers=billing.headers)
    unseen = await api.post(url, json={"items": [ITEM]}, headers=outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(unseen) == NOT_FOUND


async def test_lint_without_additions_answers_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"texts": ["Is Acme good?"]},
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert "estimate" not in body
    assert "would_create" not in body["quota"]
    assert not {"tracked", "near_duplicate_of", "suggested_prompt_type"} & set(body["data"][0])


async def test_bulk_update_answers_501_after_the_permission_and_the_body(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", "bulk-update")

    valid = await api.post(
        url,
        json={"ids": [str(prompt_id)], "set": {"importance": 1}},
        headers=editor.headers,
    )
    empty = await api.post(url, json={"ids": [str(prompt_id)]}, headers=editor.headers)
    read = await api.get(
        project_url(workspace, project, "prompts", prompt_id), headers=editor.headers
    )

    assert problem(valid) == NOT_BUILT
    assert problem(empty) == INVALID
    assert "nothing_to_change" in [error["code"] for error in empty.json()["errors"]]
    assert read.json()["data"]["importance"] == 3


async def test_bulk_update_is_refused_to_a_viewer_and_another_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", "bulk-update")
    body = {"ids": [ID], "set": {"importance": 1}}

    refused = await api.post(url, json=body, headers=viewer.headers)
    unseen = await api.post(url, json=body, headers=outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(unseen) == NOT_FOUND


async def test_bulk_archive_by_filter_answers_501(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, 1)

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-archive"),
        json={"filter": {"intent_in": ["commercial"]}, "archive": True},
        headers=editor.headers,
    )
    listed = await api.get(project_url(workspace, project, "prompts"), headers=editor.headers)

    assert problem(response) == NOT_BUILT
    assert len(listed.json()["data"]) == 1


async def test_bulk_archive_by_ids_works_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-archive"),
        json={"ids": [str(prompt_id)], "archive": True},
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"matched": 1, "updated": 1}}


async def test_the_limits_read_answers_501_for_a_reader(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "limits"), headers=viewer.headers
    )

    assert problem(response) == NOT_BUILT


async def test_the_limits_read_checks_access_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "limits")

    refused = await api.get(url, headers=billing.headers)
    unseen = await api.get(url, headers=outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(unseen) == NOT_FOUND


def _required(schema: dict[str, Any]) -> set[str]:
    return set(schema.get("required", []))


def test_the_api_document_has_the_lint_bulk_and_limits_additions() -> None:
    document = build_openapi()
    schemas = document["components"]["schemas"]

    assert "post" in document["paths"][PROJECT_PATH + "/prompts/bulk-update"]
    assert "get" in document["paths"][PROJECT_PATH + "/ai/limits"]
    for name in (
        "PromptLintItems",
        "PromptLintItem",
        "LintTracked",
        "LintNearDuplicate",
        "LintEstimate",
        "EngineEstimate",
        "PromptSelectionFilter",
        "PromptBulkArchiveByFilter",
        "PromptBulkSet",
        "PromptBulkUpdate",
        "PromptBulkUpdateResponse",
        "AiLimits",
        "QuotaUse",
    ):
        assert name in schemas, name

    assert set(schemas["LintWarning"]["properties"]["rule"]["enum"]) == {
        "contains_brand_alias",
        "engine_limit",
        "word_count",
        "multiple_questions",
        "leading_wording",
        "language_mismatch",
        "contains_competitor_alias",
    }
    assert _required(schemas["PromptBulkArchive"]) == {"ids", "archive"}
    assert "texts" in _required(schemas["PromptLintRequest"])
