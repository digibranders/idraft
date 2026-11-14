"""The prompt lint: own brand names and engine limits, nothing stored (docs/19 section 3.7.1)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
from pydantic import TypeAdapter, ValidationError

from idraft.api.resources import Resources
from idraft.api.schemas.ai import PromptLintBody
from idraft.domain.ai_engines import PROMPT_TEXT_MAX
from tests.api.ai.sources_support import statements
from tests.api.ai.support import ai_project, set_prompt_quota
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import attach, member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt

# U+1F642: one character, two UTF-16 code units.
SMILE = chr(0x1F642)
# Statements the `texts` shape sends (session, membership, project, matcher rules, quota),
# measured before `items` was built so that `items` is seen to add exactly one.
TEXTS_STATEMENTS = 8


def _prompt(length: int) -> str:
    """A text of this many characters in words of 49 letters: long, but not a word count lint."""
    return (("a" * 49 + " ") * (length // 50 + 1))[:length]


def _item(text: str, country_iso: str = "US", language_code: str = "en") -> dict[str, str]:
    return {"text": text, "language_code": language_code, "country_iso": country_iso}


ITEM = {"text": "Is Acme good?", "language_code": "en", "country_iso": "US"}


def _codes(body: dict[str, Any]) -> list[str]:
    with pytest.raises(ValidationError) as caught:
        TypeAdapter(PromptLintBody).validate_python(body)
    return [error["type"] for error in caught.value.errors()]


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
    assert code in _codes(body)


async def _seed(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    text: str,
    *,
    country_iso: str = "US",
    language_code: str = "en",
    is_active: bool = True,
) -> uuid.UUID:
    async with connection(pg) as db:
        prompt_id, _ = await insert_prompt(
            db,
            workspace.id,
            project,
            text,
            country_iso=country_iso,
            language_code=language_code,
            is_active=is_active,
        )
    return prompt_id


async def _lint(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    headers: dict[str, str],
    items: list[dict[str, str]],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"items": items},
        headers=headers,
    )


async def test_the_lint_finds_own_brand_names_and_counts_against_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 40)
    own = await fetchrow(
        migrated,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', 'Acme') RETURNING id",
        workspace.id,
    )
    await execute(
        migrated,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, 'Acme')",
        workspace.id,
        own["id"],
    )
    await attach(migrated, workspace, project, own["id"], "own")

    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"texts": [f"{SMILE} Is Acme good for agencies?", "  Is Rival good for agencies?  "]},
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    branded, plain = response.json()["data"]
    assert branded["is_branded"] is True
    assert [(m["entity"]["canonical_name"], m["alias"]) for m in branded["matched_aliases"]] == [
        ("Acme", "Acme")
    ]
    # The emoji is one character and two UTF-16 units: the name starts at unit 6.
    warnings = branded["warnings"]
    assert [(w["rule"], w["severity"], w["engine_code"], w["span"]) for w in warnings] == [
        ("contains_brand_alias", "warning", None, {"start": 6, "end": 10})
    ]
    assert (plain["text"], plain["is_branded"], plain["warnings"]) == (
        "Is Rival good for agencies?",
        False,
        [],
    )
    assert response.json()["quota"] == {"limit": 40, "used": 0}
    assert await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project) == []


async def test_the_lint_warns_of_each_engine_a_prompt_is_too_long_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", "lint")

    every = await api.post(
        url, json={"texts": [_prompt(701), _prompt(2001)]}, headers=editor.headers
    )
    chatgpt = await api.post(
        url, json={"texts": [_prompt(701)], "engine_codes": ["chatgpt_web"]}, headers=editor.headers
    )

    assert every.status_code == 200, every.text
    over_mode, over_all = every.json()["data"]
    assert [(w["rule"], w["severity"], w["engine_code"]) for w in over_mode["warnings"]] == [
        ("engine_limit", "warning", "google_ai_mode")
    ]
    assert [(w["severity"], w["engine_code"]) for w in over_all["warnings"]] == [
        ("error", "chatgpt_web"),
        ("error", "gemini_web"),
        ("error", "google_ai_mode"),
    ]
    assert chatgpt.json()["data"][0]["warnings"] == []


async def test_lint_items_says_which_prompts_are_tracked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    active = await _seed(migrated, workspace, project, "best crm?")
    archived = await _seed(migrated, workspace, project, "best erp?", is_active=False)

    response = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [_item("best crm?"), _item("best erp?"), _item("best wiki?")],
    )

    assert response.status_code == 200, response.text
    crm, erp, wiki = response.json()["data"]
    assert crm["tracked"] == {"prompt_id": str(active), "is_active": True}
    assert erp["tracked"] == {"prompt_id": str(archived), "is_active": False}
    assert "tracked" not in wiki
    assert "near_duplicate_of" not in crm
    assert "near_duplicate_of" not in wiki


async def test_lint_items_finds_a_prompt_differing_only_in_case_and_spacing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    tracked = await _seed(migrated, workspace, project, "best crm?")

    response = await _lint(api, workspace, project, viewer.headers, [_item("Best  CRM?")])

    assert response.status_code == 200, response.text
    (item,) = response.json()["data"]
    assert item["near_duplicate_of"] == {"prompt_id": str(tracked), "text": "best crm?"}
    assert "tracked" not in item


async def test_a_prompt_in_another_market_is_neither_tracked_nor_near(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, workspace, project, "best crm?")

    response = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [
            _item("best crm?", country_iso="GB"),
            _item("Best  CRM?", country_iso="GB"),
            _item("best crm?", language_code="de"),
            _item("Best  CRM?", language_code="de"),
        ],
    )

    assert response.status_code == 200, response.text
    for item in response.json()["data"]:
        assert "tracked" not in item
        assert "near_duplicate_of" not in item


async def test_would_create_leaves_out_tracked_repeated_and_unsavable(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, workspace, project, "tracked already?")

    response = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [
            _item("tracked already?"),
            _item("new one?"),
            _item("new one?"),
            _item("x" * 2001),
            _item("new two?"),
        ],
    )

    assert response.status_code == 200, response.text
    assert response.json()["quota"]["would_create"] == 2
    assert len(response.json()["data"]) == 5


@pytest.mark.parametrize(("length", "counted"), [(PROMPT_TEXT_MAX, 1), (PROMPT_TEXT_MAX + 1, 0)])
async def test_would_create_stops_counting_just_past_the_longest_savable_text(
    length: int,
    counted: int,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await _lint(api, workspace, project, viewer.headers, [_item("x" * length)])

    assert response.status_code == 200, response.text
    assert response.json()["quota"]["would_create"] == counted


@pytest.mark.parametrize(
    ("tracked", "written", "language_code", "country_iso"),
    [
        # The sharp s folds to "ss" under casefold; lower() would leave it alone.
        ("Strasse?", "Stra\U000000dfe?", "de", "DE"),
        # An all caps Cyrillic text folds to the lowercase one.
        (
            "\U00000432\U0000043e\U0000043f\U00000440\U0000043e\U00000441?",
            "\U00000412\U0000041e\U0000041f\U00000420\U0000041e\U00000421?",
            "ru",
            "RU",
        ),
    ],
)
async def test_lint_items_folds_case_the_way_unicode_does(
    tracked: str,
    written: str,
    language_code: str,
    country_iso: str,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    prompt_id = await _seed(
        migrated, workspace, project, tracked, country_iso=country_iso, language_code=language_code
    )

    response = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [_item(written, country_iso=country_iso, language_code=language_code)],
    )

    assert response.status_code == 200, response.text
    (item,) = response.json()["data"]
    assert item["near_duplicate_of"] == {"prompt_id": str(prompt_id), "text": tracked}
    assert "tracked" not in item


async def test_lint_texts_answers_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, workspace, project, "best crm?")
    url = project_url(workspace, project, "prompts", "lint")
    await api.post(url, json={"texts": ["best crm?"]}, headers=viewer.headers)

    with statements(resources) as sent:
        response = await api.post(url, json={"texts": ["best crm?"]}, headers=viewer.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"data", "quota"}
    assert set(body["quota"]) == {"limit", "used"}
    assert {"tracked", "near_duplicate_of"}.isdisjoint(body["data"][0])
    assert len(sent) == TEXTS_STATEMENTS, sent


async def test_lint_suggests_a_type_for_every_text_in_both_shapes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    texts = ["Asana versus Trello for a team", "How to pick a CRM", "best crm", "Is Acme good?"]
    url = project_url(workspace, project, "prompts", "lint")

    old = await api.post(url, json={"texts": texts}, headers=viewer.headers)
    new = await _lint(api, workspace, project, viewer.headers, [_item(text) for text in texts])

    expected = ["comparison", "how_to", "other", "question"]
    for response in (old, new):
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert [row["suggested_prompt_type"] for row in data] == expected
        # The suggestion is a field, not a warning: no rule is added for it.
        assert all(
            warning["rule"] in {"engine_limit", "word_count", "contains_brand_alias"}
            for row in data
            for warning in row["warnings"]
        )


FRENCH = "Quelle est la meilleure solution de facturation ?"


async def _name(
    pg: PostgresServer, workspace: Workspace, project: uuid.UUID, name: str, role: str
) -> None:
    """A brand the project knows by `name`, in `role`."""
    entity = await fetchrow(
        pg,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', $2) RETURNING id",
        workspace.id,
        name,
    )
    await execute(
        pg,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, $3)",
        workspace.id,
        entity["id"],
        name,
    )
    await attach(pg, workspace, project, entity["id"], role)


async def test_lint_takes_a_language_code_for_texts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", "lint")

    english = await api.post(
        url, json={"texts": [FRENCH], "language_code": "en"}, headers=viewer.headers
    )
    french = await api.post(
        url, json={"texts": [FRENCH], "language_code": "fr"}, headers=viewer.headers
    )
    unsaid = await api.post(url, json={"texts": [FRENCH]}, headers=viewer.headers)

    assert english.status_code == french.status_code == unsaid.status_code == 200, english.text
    (mismatch,) = english.json()["data"][0]["warnings"]
    assert (mismatch["rule"], mismatch["severity"], mismatch["span"]) == (
        "language_mismatch",
        "warning",
        None,
    )
    assert french.json()["data"][0]["warnings"] == []
    assert unsaid.json()["data"][0]["warnings"] == []


async def test_lint_rules_run_on_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _name(migrated, workspace, project, "Acme", "own")
    await _name(migrated, workspace, project, "HubSpot", "competitor")

    response = await _lint(
        api,
        workspace,
        project,
        viewer.headers,
        [
            _item("Is HubSpot the best CRM for startups?"),
            _item("HubSpot vs Acme for a small agency"),
            _item(FRENCH),
            _item(FRENCH, language_code="fr"),
            _item("x" * 701),
        ],
    )

    assert response.status_code == 200, response.text
    competitor, comparison, english, french, long = response.json()["data"]
    assert [(w["rule"], w["severity"], w["span"]) for w in competitor["warnings"]] == [
        ("contains_competitor_alias", "warning", {"start": 3, "end": 10}),
        ("leading_wording", "warning", {"start": 15, "end": 19}),
    ]
    # A competitor never makes a prompt branded; an own name does.
    assert competitor["is_branded"] is False
    assert comparison["is_branded"] is True
    assert [(w["rule"], w["severity"]) for w in comparison["warnings"]] == [
        ("contains_brand_alias", "warning"),
        ("contains_competitor_alias", "info"),
    ]
    assert [w["rule"] for w in english["warnings"]] == ["language_mismatch"]
    assert french["warnings"] == []
    assert [w["rule"] for w in long["warnings"]] == ["word_count", "engine_limit"]


async def test_lint_stores_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, workspace, project, "best crm?")
    counts = (
        "SELECT (SELECT count(*) FROM ai.prompts) AS prompts, "
        "(SELECT count(*) FROM ai.prompt_versions) AS versions, "
        "(SELECT count(*) FROM ops.audit_logs) AS audits, "
        "(SELECT count(*) FROM core.workspace_quotas) AS quotas"
    )
    before = dict(await fetchrow(migrated, counts))

    response = await _lint(
        api, workspace, project, editor.headers, [_item("best crm?"), _item("brand new?")]
    )

    assert response.status_code == 200, response.text
    assert dict(await fetchrow(migrated, counts)) == before


async def test_lint_items_statement_count_does_not_grow_with_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, workspace, project, "best crm?")
    one = [_item("best crm?")]
    many = [_item(f"question {number}?", "US" if number % 2 else "GB") for number in range(200)]
    await _lint(api, workspace, project, viewer.headers, one)

    with statements(resources) as single:
        first = await _lint(api, workspace, project, viewer.headers, one)
    with statements(resources) as large:
        second = await _lint(api, workspace, project, viewer.headers, many)

    assert first.status_code == second.status_code == 200
    # The project's prompts, then the estimate's enabled engines and price book.
    assert len(large) == len(single) == TEXTS_STATEMENTS + 3, large


async def test_another_workspaces_prompt_is_not_tracked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, other, await ai_project(migrated, other), "best crm?")

    response = await _lint(
        api, workspace, project, viewer.headers, [_item("best crm?"), _item("Best  CRM?")]
    )

    assert response.status_code == 200, response.text
    for item in response.json()["data"]:
        assert "tracked" not in item
        assert "near_duplicate_of" not in item


async def test_another_projects_prompt_is_not_tracked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _seed(migrated, workspace, await ai_project(migrated, workspace), "best crm?")

    response = await _lint(
        api, workspace, project, viewer.headers, [_item("best crm?"), _item("Best  CRM?")]
    )

    assert response.status_code == 200, response.text
    for item in response.json()["data"]:
        assert "tracked" not in item
        assert "near_duplicate_of" not in item


async def test_lint_items_is_for_readers_and_404_for_a_foreign_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    billing = await member(resources, migrated, workspace, "billing")
    project = await ai_project(migrated, workspace)
    foreign = await ai_project(migrated, other)
    items = [_item("best crm?")]

    read = await _lint(api, workspace, project, viewer.headers, items)
    refused = await _lint(api, workspace, project, billing.headers, items)
    unseen = await _lint(api, workspace, foreign, viewer.headers, items)

    assert read.status_code == 200, read.text
    assert problem(refused) == (403, "forbidden")
    assert problem(unseen) == (404, "not_found")


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

    assert problem(refused) == (403, "forbidden")
    assert problem(unseen) == (404, "not_found")
