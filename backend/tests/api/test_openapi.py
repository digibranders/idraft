import json
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI

from idraft.api.openapi import build_openapi, render_openapi
from tests.api.auth.support import cookie, make_user, open_session
from tests.conftest import PostgresServer

COMMITTED = Path(__file__).parents[2] / "openapi" / "v1.json"
PROBLEM_REF = {"$ref": "#/components/schemas/Problem"}


def _operations(document: dict[str, Any]) -> list[dict[str, Any]]:
    return [op for item in document["paths"].values() for op in item.values()]


def test_openapi_is_version_3_1_and_lists_the_health_routes() -> None:
    document = build_openapi()
    assert str(document["openapi"]).startswith("3.1")
    assert {"/api/healthz", "/api/readyz"} <= set(document["paths"])


def test_every_operation_documents_errors_as_problem_json() -> None:
    document = build_openapi()
    operations = _operations(document)
    assert operations
    for operation in operations:
        default = operation["responses"]["default"]
        assert default["content"] == {"application/problem+json": {"schema": PROBLEM_REF}}
        assert "422" not in operation["responses"]


def test_the_problem_schema_is_the_only_error_schema() -> None:
    schemas = build_openapi()["components"]["schemas"]
    assert {"type", "title", "status", "instance", "code", "request_id"} <= set(
        schemas["Problem"]["required"]
    )
    assert "ValidationItem" in schemas
    assert "HTTPValidationError" not in schemas
    assert "ValidationError" not in schemas


def test_committed_document_matches_the_code() -> None:
    assert COMMITTED.read_text() == render_openapi(), (
        "backend/openapi/v1.json is stale. Regenerate it with: "
        "uv run python -m idraft.api.openapi > openapi/v1.json"
    )


def test_the_document_does_not_depend_on_the_environment(monkeypatch: Any) -> None:
    before = render_openapi()
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", "mysql://nope")
    monkeypatch.setenv("SENTRY_DSN", "https://public@o0.ingest.sentry.io/0")
    assert render_openapi() == before


def test_rendered_document_is_stable_json() -> None:
    assert json.loads(render_openapi()) == build_openapi()
    assert render_openapi().endswith("\n")


SERVED = "/api/v1/openapi.json"


async def test_the_document_is_not_served_without_a_session(client: httpx.AsyncClient) -> None:
    response = await client.get(SERVED)
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


async def test_a_signed_in_user_gets_the_committed_document(
    app: FastAPI, client: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(app.state.resources, user)

    response = await client.get(SERVED, headers=cookie(token))

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == json.loads(COMMITTED.read_text())


def test_the_document_does_not_list_the_route_that_serves_it() -> None:
    assert SERVED not in build_openapi()["paths"]


async def test_the_served_document_is_never_cached(
    app: FastAPI, client: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(app.state.resources, user)
    response = await client.get(SERVED, headers=cookie(token))
    assert response.headers["cache-control"] == "no-store"
