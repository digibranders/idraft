"""What the competitors tests share (contract C5, docs/ai-visibility/contracts/c5-competitors.md):
readers of `ai/competitors` over the seeded world of the summary tests, and the helpers that
shape a row. The expected numbers are worked out by hand in the tests from that world (see the
docstring of the `summary` fixture of `test_prompts_summary`)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from tests.api.ai.metrics_support import COMPETITORS, get_overview
from tests.api.ai.summary_support import Summary


async def get_competitors(world: Summary, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    """`ai/competitors` of the seeded world, as its owner."""
    return await get_overview(world, api, COMPETITORS, **params)


async def competitors_body(world: Summary, api: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    """The body of a read that answered 200."""
    response = await get_competitors(world, api, **params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def names(body: dict[str, Any]) -> list[str]:
    """The canonical names of the rows, in order."""
    return [row["entity"]["canonical_name"] for row in body["data"]]


def row_of(body: dict[str, Any], entity_id: uuid.UUID) -> dict[str, Any]:
    found: dict[str, Any] = next(
        row for row in body["data"] if row["entity"]["entity_id"] == str(entity_id)
    )
    return found


def entry(row: dict[str, Any], engine: str) -> dict[str, Any]:
    """The entry of one engine of a row."""
    found: dict[str, Any] = next(item for item in row["by_engine"] if item["engine_code"] == engine)
    return found


def counts(value: dict[str, Any]) -> tuple[Any, Any, Any]:
    """(numerator, denominator, n_observations) of a value."""
    return value["numerator"], value["denominator"], value["n_observations"]


def top_of(body: dict[str, Any], engine: str) -> list[str]:
    """The names of the rows flagged as the top competitor on one engine."""
    return [
        row["entity"]["canonical_name"]
        for row in body["data"]
        if entry(row, engine)["is_top_competitor"]
    ]
