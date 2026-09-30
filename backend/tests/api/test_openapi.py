import json
from pathlib import Path

from sightline.api.openapi import build_openapi, render_openapi

COMMITTED = Path(__file__).parents[2] / "openapi" / "v1.json"


def test_openapi_is_version_3_1_and_lists_the_health_routes() -> None:
    document = build_openapi()
    assert str(document["openapi"]).startswith("3.1")
    assert {"/api/healthz", "/api/readyz"} <= set(document["paths"])


def test_committed_document_matches_the_code() -> None:
    assert COMMITTED.read_text() == render_openapi(), (
        "backend/openapi/v1.json is stale. Regenerate it with: "
        "uv run python -m sightline.api.openapi > openapi/v1.json"
    )


def test_rendered_document_is_stable_json() -> None:
    assert json.loads(render_openapi()) == build_openapi()
    assert render_openapi().endswith("\n")
