"""The lint estimate: what the prompts that would be created cost on the standard queue, per
engine and in all (prompt-dialogs N05; C1 change log, estimate rounding). The seeded price book
has 0.0012 a task on each engine."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any

import httpx

from idraft.api.resources import Resources
from idraft.domain.ai_engines import ENGINES, EngineCode
from tests.api.ai.sources_support import statements
from tests.api.ai.support import ai_project, enable_engine, seed_prompts
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import member
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

# Statements the `texts` shape sends (session, membership, project, matcher rules, quota), then
# what `items` adds: the project's prompts, its enabled engines and the price book.
TEXTS_STATEMENTS = 8
ITEMS_STATEMENTS = TEXTS_STATEMENTS + 3

BOOK = "ops.provider_price_book"

type Row = tuple[int, int, Decimal | None, int, Decimal | None]


def _item(text: str) -> dict[str, str]:
    return {"text": text, "language_code": "en", "country_iso": "US"}


async def _lint(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    headers: dict[str, str],
    items: list[dict[str, str]],
    **changes: Any,
) -> dict[str, Any]:
    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"items": items, **changes},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _rows(estimate: dict[str, Any]) -> dict[str, Row]:
    """Each engine's numbers, money as `Decimal` so they compare by value."""

    def money(value: str | None) -> Decimal | None:
        return None if value is None else Decimal(value)

    return {
        row["engine_code"]: (
            row["prompts_fit"],
            row["answers_per_month"],
            money(row["monthly_cost_usd"]),
            row["run_now_answers"],
            money(row["run_now_cost_usd"]),
        )
        for row in estimate["engines"]
    }


@asynccontextmanager
async def _without_price(pg: PostgresServer, *codes: EngineCode) -> AsyncIterator[None]:
    """The price book has no price today for these engines: it starts in the future."""
    endpoints = [ENGINES[code].endpoint for code in codes]
    original = await fetch(
        pg, f"SELECT id, valid_from FROM {BOOK} WHERE endpoint = ANY($1)", endpoints
    )
    await execute(
        pg, f"UPDATE {BOOK} SET valid_from = current_date + 30 WHERE endpoint = ANY($1)", endpoints
    )
    try:
        yield
    finally:
        for row in original:
            await execute(
                pg, f"UPDATE {BOOK} SET valid_from = $1 WHERE id = $2", row["valid_from"], row["id"]
            )


async def test_the_estimate_counts_answers_and_cost_per_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")

    body = await _lint(
        api, workspace, project, viewer.headers, [_item(f"question {n}?") for n in range(3)]
    )

    estimate = body["estimate"]
    # 3 prompts x 2 runs a week x 52 weeks / 12 months = 26 answers, rounded down.
    assert _rows(estimate) == {
        "chatgpt_web": (3, 26, Decimal("0.03"), 3, Decimal("0.0036")),
    }
    assert Decimal(estimate["total_monthly_cost_usd"]) == Decimal("0.03")
    assert set(estimate) == {"engines", "total_monthly_cost_usd"}
    assert set(estimate["engines"][0]) == {
        "engine_code",
        "prompts_fit",
        "answers_per_month",
        "monthly_cost_usd",
        "run_now_answers",
        "run_now_cost_usd",
    }


async def test_one_prompt_costs_a_cent_and_eight_answers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")

    body = await _lint(api, workspace, project, viewer.headers, [_item("best crm?")])

    # 2 x 52 / 12 = 8.67 answers, rounded down; 8.67 x 0.0012 = 0.0104, to the cent.
    assert _rows(body["estimate"]) == {
        "chatgpt_web": (1, 8, Decimal("0.01"), 1, Decimal("0.0012")),
    }
    assert body["estimate"]["total_monthly_cost_usd"] == "0.01"


async def test_150_prompts_on_three_engines_cost_4_68(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    for code in EngineCode:
        await enable_engine(migrated, workspace, project, code.value)

    # No quota is set: the lint does not refuse past it.
    body = await _lint(
        api, workspace, project, viewer.headers, [_item(f"question {n}?") for n in range(150)]
    )

    full = (150, 1300, Decimal("1.56"), 150, Decimal("0.18"))
    assert _rows(body["estimate"]) == {
        "chatgpt_web": full,
        "gemini_web": full,
        "google_ai_mode": full,
    }
    assert [row["engine_code"] for row in body["estimate"]["engines"]] == [
        "chatgpt_web",
        "gemini_web",
        "google_ai_mode",
    ]
    assert Decimal(body["estimate"]["total_monthly_cost_usd"]) == Decimal("4.68")


async def test_ai_mode_leaves_out_a_prompt_over_700_characters(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    for code in EngineCode:
        await enable_engine(migrated, workspace, project, code.value)

    body = await _lint(api, workspace, project, viewer.headers, [_item("x" * 701)])

    fits = {code: row[0] for code, row in _rows(body["estimate"]).items()}
    assert fits == {"chatgpt_web": 1, "gemini_web": 1, "google_ai_mode": 0}
    # An engine that takes none of them costs nothing: priced, so zero, not null.
    assert _rows(body["estimate"])["google_ai_mode"] == (0, 0, Decimal("0"), 0, Decimal("0"))


async def test_tracked_and_repeated_items_cost_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")
    await seed_prompts(migrated, workspace, project, 1)

    body = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [
            _item("prompt 1"),
            _item("new one?"),
            _item("new one?"),
            _item("x" * 2001),
            _item("new two?"),
        ],
    )

    assert body["quota"]["would_create"] == 2
    assert _rows(body["estimate"])["chatgpt_web"][0] == 2


async def test_an_engine_without_a_price_has_null_cost_and_the_total_sums_the_rest(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    for code in EngineCode:
        await enable_engine(migrated, workspace, project, code.value)
    items = [_item(f"question {n}?") for n in range(3)]

    async with _without_price(migrated, EngineCode.GEMINI_WEB):
        some = await _lint(api, workspace, project, viewer.headers, items)
    async with _without_price(migrated, *EngineCode):
        none = await _lint(api, workspace, project, viewer.headers, items)

    # The answers do not depend on the price; only the money does.
    assert _rows(some["estimate"]) == {
        "chatgpt_web": (3, 26, Decimal("0.03"), 3, Decimal("0.0036")),
        "gemini_web": (3, 26, None, 3, None),
        "google_ai_mode": (3, 26, Decimal("0.03"), 3, Decimal("0.0036")),
    }
    assert Decimal(some["estimate"]["total_monthly_cost_usd"]) == Decimal("0.06")
    assert _rows(none["estimate"]) == {code.value: (3, 26, None, 3, None) for code in EngineCode}
    assert none["estimate"]["total_monthly_cost_usd"] is None


async def test_without_enabled_engines_the_estimate_is_empty(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    body = await _lint(api, workspace, project, viewer.headers, [_item("best crm?")])

    assert body["estimate"] == {"engines": [], "total_monthly_cost_usd": None}


async def test_engine_codes_sent_replace_the_enabled_engines(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")

    body = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [_item("best crm?")],
        engine_codes=["google_ai_mode", "gemini_web", "google_ai_mode"],
    )

    # Each once, in the engines' own order, whatever the order sent.
    assert list(_rows(body["estimate"])) == ["gemini_web", "google_ai_mode"]


async def test_a_disabled_engine_is_not_estimated(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")
    await enable_engine(migrated, workspace, project, "gemini_web")
    await execute(
        migrated,
        "UPDATE ai.project_engines SET is_enabled = false "
        "WHERE project_id = $1 AND engine_code = 'gemini_web'",
        project,
    )

    body = await _lint(api, workspace, project, viewer.headers, [_item("best crm?")])

    assert list(_rows(body["estimate"])) == ["chatgpt_web"]


async def test_texts_shape_has_no_estimate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")

    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"texts": ["best crm?"]},
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    assert "estimate" not in response.json()


async def test_the_estimate_adds_two_statements_whatever_the_number_of_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    for code in EngineCode:
        await enable_engine(migrated, workspace, project, code.value)
    one = [_item("best crm?")]
    many = [_item(f"question {n}?") for n in range(200)]
    await _lint(api, workspace, project, viewer.headers, one)

    with statements(resources) as single:
        await _lint(api, workspace, project, viewer.headers, one)
    with statements(resources) as large:
        await _lint(api, workspace, project, viewer.headers, many)

    # The enabled engines and one price lookup for all three of them.
    assert len(single) == len(large) == ITEMS_STATEMENTS, large


async def test_the_estimate_stores_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web")
    counts = (
        "SELECT (SELECT count(*) FROM ai.prompts) AS prompts, "
        "(SELECT count(*) FROM ai.prompt_versions) AS versions, "
        "(SELECT count(*) FROM ops.audit_logs) AS audits, "
        "(SELECT count(*) FROM core.workspace_quotas) AS quotas"
    )
    before = dict(await fetchrow(migrated, counts))

    await _lint(api, workspace, project, editor.headers, [_item("brand new?")])

    assert dict(await fetchrow(migrated, counts)) == before
