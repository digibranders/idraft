"""The prompt list's funnel stage, importance and branded filters, its `sort`, and
`filter[is_active]=any` (contract C1, BE-PROMPTS-12 and prompt-dialogs N13)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import cursor_key, forged_cursor, statements
from tests.api.ai.support import added, ai_project, seed_prompts
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

INVALID = (422, "validation_failed")
INVALID_CURSOR = (400, "invalid_cursor")
SORTS = (
    "text",
    "-text",
    "importance",
    "-importance",
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
)

# text, funnel stage, importance, is_branded
PROMPTS = (
    ("alpha", "tofu", 5, False),
    ("bravo", "mofu", 3, True),
    ("charlie", "bofu", 1, False),
    ("delta", "tofu", 3, True),
)


async def _scene(
    resources: Resources, migrated: PostgresServer
) -> tuple[Workspace, Caller, uuid.UUID, str]:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    return workspace, editor, project, project_url(workspace, project, "prompts")


async def _seed(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, editor: Caller
) -> dict[str, str]:
    """The four prompts above, written through the API (oldest first); text to id."""
    return {
        text: await added(
            api,
            workspace,
            project,
            editor,
            text,
            funnel_stage=funnel_stage,
            importance=importance,
            is_branded=is_branded,
        )
        for text, funnel_stage, importance, is_branded in PROMPTS
    }


def _texts(response: httpx.Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [row["current_version"]["text"] for row in response.json()["data"]]


def _cursor(response: httpx.Response) -> str:
    assert response.status_code == 200, response.text
    cursor: str | None = response.json()["page"]["next_cursor"]
    assert cursor is not None
    return cursor


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        pytest.param({"filter[funnel_stage_in]": "tofu"}, {"alpha", "delta"}, id="funnel one"),
        pytest.param(
            {"filter[funnel_stage_in]": "mofu,bofu"}, {"bravo", "charlie"}, id="funnel two"
        ),
        pytest.param({"filter[importance_in]": "3"}, {"bravo", "delta"}, id="importance one"),
        pytest.param({"filter[importance_in]": "1,5"}, {"alpha", "charlie"}, id="importance two"),
        pytest.param({"filter[is_branded]": "true"}, {"bravo", "delta"}, id="branded"),
        pytest.param({"filter[is_branded]": "false"}, {"alpha", "charlie"}, id="not branded"),
        pytest.param(
            {
                "filter[funnel_stage_in]": "tofu,mofu",
                "filter[importance_in]": "3",
                "filter[is_branded]": "true",
            },
            {"bravo", "delta"},
            id="all together",
        ),
        pytest.param(
            {
                "filter[funnel_stage_in]": "tofu",
                "filter[importance_in]": "3",
                "filter[is_branded]": "true",
            },
            {"delta"},
            id="all narrowing",
        ),
        pytest.param({"filter[funnel_stage_in]": "retention"}, set(), id="nothing matches"),
    ],
)
async def test_each_new_filter_narrows_the_list(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
    expected: set[str],
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    await _seed(api, workspace, project, editor)

    response = await api.get(url, params=params, headers=editor.headers)

    assert set(_texts(response)) == expected
    assert len(_texts(response)) == len(expected)


async def test_the_list_never_hides_branded_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    await _seed(api, workspace, project, editor)

    plain = await api.get(url, headers=editor.headers)
    asked = await api.get(url, params={"filter[is_branded]": "true"}, headers=editor.headers)

    # A list is not a rate: the branded prompts are there with no filter, newest first.
    assert _texts(plain) == ["delta", "charlie", "bravo", "alpha"]
    assert _texts(asked) == ["delta", "bravo"]


async def test_is_active_any_lists_both(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    ids = await _seed(api, workspace, project, editor)
    archived = await api.patch(
        project_url(workspace, project, "prompts", ids["bravo"]),
        json={"is_active": False},
        headers=editor.headers,
    )
    assert archived.status_code == 200, archived.text

    default = await api.get(url, headers=editor.headers)
    active = await api.get(url, params={"filter[is_active]": "true"}, headers=editor.headers)
    only_archived = await api.get(
        url, params={"filter[is_active]": "false"}, headers=editor.headers
    )
    both = await api.get(url, params={"filter[is_active]": "any"}, headers=editor.headers)
    narrowed = await api.get(
        url,
        params={"filter[is_active]": "any", "filter[is_branded]": "true"},
        headers=editor.headers,
    )
    first = await api.get(
        url, params={"filter[is_active]": "any", "limit": "3"}, headers=editor.headers
    )
    rest = await api.get(
        url,
        params={"filter[is_active]": "any", "limit": "3", "cursor": _cursor(first)},
        headers=editor.headers,
    )
    crossed = await api.get(
        url, params={"limit": "3", "cursor": _cursor(first)}, headers=editor.headers
    )

    assert _texts(default) == _texts(active) == ["delta", "charlie", "alpha"]
    assert _texts(only_archived) == ["bravo"]
    assert _texts(both) == ["delta", "charlie", "bravo", "alpha"]
    assert _texts(narrowed) == ["delta", "bravo"]
    assert _texts(first) + _texts(rest) == ["delta", "charlie", "bravo", "alpha"]
    # `any` is a scope of its own: its cursor is not the cursor of the active list.
    assert problem(crossed) == INVALID_CURSOR


async def _rows(pg: PostgresServer, project: uuid.UUID) -> dict[str, dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT p.id, v.text, p.importance, p.created_at, p.updated_at FROM ai.prompts p "
        "JOIN ai.prompt_versions v ON v.id = p.current_version_id WHERE p.project_id = $1",
        project,
    )
    return {str(row["id"]): dict(row) for row in rows}


async def _make_ties(pg: PostgresServer, ids: list[str]) -> None:
    """Seven prompts with importance 3, 3, 1, 5, 3, 1, 5, and instants that repeat: the first
    two share a creation time, the next two another, and updates fall on three instants."""
    start = dt.datetime(2026, 1, 1, tzinfo=dt.UTC)
    created = [0, 0, 1, 1, 2, 3, 4]
    updated = [5, 6, 5, 6, 7, 7, 5]
    for prompt_id, born, touched in zip(ids, created, updated, strict=True):
        await execute(
            pg,
            "UPDATE ai.prompts SET created_at = $2, updated_at = $3 WHERE id = $1",
            uuid.UUID(prompt_id),
            start + dt.timedelta(days=born),
            start + dt.timedelta(days=touched),
        )


async def _walk(
    api: httpx.AsyncClient, url: str, caller: Caller, sort: str, *, limit: int
) -> tuple[list[str], int]:
    """The ids of every page of a sorted list, in order, and the number of pages. Bounded, so a
    paging fault fails the test instead of hanging it."""
    seen: list[str] = []
    cursor: str | None = None
    for pages in range(1, 11):
        params = {
            "sort": sort,
            "limit": str(limit),
            **({} if cursor is None else {"cursor": cursor}),
        }
        response = await api.get(url, params=params, headers=caller.headers)
        assert response.status_code == 200, response.text
        seen += [row["prompt_id"] for row in response.json()["data"]]
        cursor = response.json()["page"]["next_cursor"]
        if cursor is None:
            return seen, pages
    raise AssertionError("the list did not end within 10 pages")


@pytest.mark.parametrize("sort", SORTS)
async def test_each_sort_orders_and_pages_without_gaps_or_repeats(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    ids = [
        await added(api, workspace, project, editor, f"prompt {name}", importance=importance)
        for name, importance in zip("abcdefg", (3, 3, 1, 5, 3, 1, 5), strict=True)
    ]
    await _make_ties(migrated, ids)
    rows = await _rows(migrated, project)
    field = sort.removeprefix("-")
    descending = sort.startswith("-")
    # Postgres compares uuids bytewise, as Python compares their integers.
    expected = [
        prompt_id
        for prompt_id, _ in sorted(
            rows.items(),
            key=lambda item: (item[1][field], uuid.UUID(item[0])),
            reverse=descending,
        )
    ]

    seen, pages = await _walk(api, url, editor, sort, limit=3)

    assert pages == 3
    assert seen == expected
    assert len(set(seen)) == 7


async def test_a_cursor_from_another_sort_is_invalid(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    await _seed(api, workspace, project, editor)

    by_importance = await api.get(
        url, params={"sort": "-importance", "limit": "1"}, headers=editor.headers
    )
    unsorted_page = await api.get(url, params={"limit": "1"}, headers=editor.headers)
    cursor = _cursor(by_importance)
    flipped = await api.get(
        url, params={"sort": "importance", "limit": "1", "cursor": cursor}, headers=editor.headers
    )
    other_field = await api.get(
        url, params={"sort": "-text", "limit": "1", "cursor": cursor}, headers=editor.headers
    )
    dropped = await api.get(url, params={"limit": "1", "cursor": cursor}, headers=editor.headers)
    added_sort = await api.get(
        url,
        params={"sort": "-importance", "limit": "1", "cursor": _cursor(unsorted_page)},
        headers=editor.headers,
    )
    same = await api.get(
        url, params={"sort": "-importance", "limit": "1", "cursor": cursor}, headers=editor.headers
    )

    for response in (flipped, other_field, dropped, added_sort):
        assert problem(response) == INVALID_CURSOR
    assert same.status_code == 200, same.text


@pytest.mark.parametrize(
    ("first", "second"),
    [
        pytest.param(
            {"filter[funnel_stage_in]": "tofu"}, {"filter[funnel_stage_in]": "mofu"}, id="funnel"
        ),
        pytest.param(
            {"filter[funnel_stage_in]": "tofu"},
            {"filter[funnel_stage_in]": "tofu,mofu"},
            id="funnel wider",
        ),
        pytest.param(
            {"filter[importance_in]": "3"}, {"filter[importance_in]": "1"}, id="importance"
        ),
        pytest.param({"filter[is_branded]": "true"}, {"filter[is_branded]": "false"}, id="branded"),
        pytest.param({"filter[is_branded]": "true"}, {}, id="branded dropped"),
        pytest.param({}, {"filter[importance_in]": "3"}, id="importance added"),
    ],
)
async def test_a_cursor_does_not_cross_to_another_filter_set(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    first: dict[str, str],
    second: dict[str, str],
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    for index in range(3):
        await added(
            api,
            workspace,
            project,
            editor,
            f"prompt {index}",
            funnel_stage="tofu",
            importance=3,
            is_branded=True,
        )

    issued = await api.get(url, params={"limit": "1", **first}, headers=editor.headers)
    crossed = await api.get(
        url,
        params={"limit": "1", "cursor": _cursor(issued), **second},
        headers=editor.headers,
    )

    assert problem(crossed) == INVALID_CURSOR


async def test_a_cursor_without_sort_still_works_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    ids = await _seed(api, workspace, project, editor)

    first = await api.get(url, params={"limit": "2"}, headers=editor.headers)
    rest = await api.get(
        url, params={"limit": "2", "cursor": _cursor(first)}, headers=editor.headers
    )

    # Newest first, and the key is the id alone, exactly as before sorting existed.
    assert cursor_key(_cursor(first)) == [ids["charlie"]]
    assert _texts(first) + _texts(rest) == ["delta", "charlie", "bravo", "alpha"]
    assert rest.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False}


async def test_a_sort_cursor_holds_the_value_and_the_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    ids = await _seed(api, workspace, project, editor)

    by_text = await api.get(url, params={"sort": "text", "limit": "1"}, headers=editor.headers)
    by_importance = await api.get(
        url, params={"sort": "-importance", "limit": "1"}, headers=editor.headers
    )
    by_creation = await api.get(
        url, params={"sort": "created_at", "limit": "1"}, headers=editor.headers
    )

    # A text can be 2,000 characters: the cursor of a text sort names the prompt, not its text.
    assert cursor_key(_cursor(by_text)) == [ids["alpha"]]
    assert cursor_key(_cursor(by_importance)) == [5, ids["alpha"]]
    created_key = cursor_key(_cursor(by_creation))
    assert created_key[1] == ids["alpha"]
    assert dt.datetime.fromisoformat(created_key[0]).tzinfo is not None


@pytest.mark.parametrize(
    ("sort", "key"),
    [
        pytest.param("importance", ["x", str(uuid.uuid4())], id="importance not a number"),
        pytest.param("importance", [10**15, str(uuid.uuid4())], id="importance out of range"),
        pytest.param("importance", [3], id="importance without an id"),
        pytest.param("importance", [3, "not-an-id"], id="not an id"),
        pytest.param("importance", [3, 4], id="id not text"),
        pytest.param("created_at", ["yesterday", str(uuid.uuid4())], id="not an instant"),
        pytest.param("created_at", ["2026-01-01T00:00:00", str(uuid.uuid4())], id="no offset"),
        pytest.param("created_at", [5, str(uuid.uuid4())], id="instant not text"),
        pytest.param("text", [5, str(uuid.uuid4())], id="text key of two"),
        pytest.param("text", [5], id="text key not an id"),
        pytest.param("text", [], id="text key empty"),
    ],
)
async def test_a_forged_sort_cursor_is_invalid_not_a_server_error(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    sort: str,
    key: list[Any],
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    await _seed(api, workspace, project, editor)
    real = await api.get(url, params={"sort": sort, "limit": "1"}, headers=editor.headers)

    forged = await api.get(
        url,
        params={"sort": sort, "limit": "1", "cursor": forged_cursor(_cursor(real), key)},
        headers=editor.headers,
    )

    assert problem(forged) == INVALID_CURSOR


def _long_texts(kind: str) -> list[str]:
    """Three texts of the longest size a prompt may have, in ascending order: 2,000 ASCII
    characters, or 600 CJK ones (code points built here, so this file stays ASCII)."""
    if kind == "ascii":
        return [letter * 2000 for letter in "bcd"]
    return [chr(0x4E00 + step) * 600 for step in range(3)]


@pytest.mark.parametrize("sort", ["text", "-text"])
@pytest.mark.parametrize("kind", ["ascii", "cjk"])
async def test_a_text_sort_pages_the_longest_texts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str, kind: str
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    texts = _long_texts(kind)
    ids = [await added(api, workspace, project, editor, text) for text in texts]
    first = await api.get(url, params={"sort": sort, "limit": "1"}, headers=editor.headers)

    seen, pages = await _walk(api, url, editor, sort, limit=1)

    assert seen == (ids[::-1] if sort.startswith("-") else ids)
    assert pages == 3
    # The cursor names the prompt, not its text: it stays short however long the text is.
    assert cursor_key(_cursor(first)) == [seen[0]]
    assert len(_cursor(first)) < 200


async def test_a_text_cursor_names_only_a_prompt_of_this_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    for text in ("prompt b", "prompt c", "prompt d"):
        await added(api, workspace, project, editor, text)
    sibling = await ai_project(migrated, workspace)
    # Sorts before every text of `project`: were its position used, the page would not be empty.
    of_sibling = await added(api, workspace, sibling, editor, "aaa sibling secret")
    elsewhere = await make_workspace(migrated)
    stranger = await member(resources, migrated, elsewhere, "editor")
    abroad = await ai_project(migrated, elsewhere)
    of_stranger = await added(api, elsewhere, abroad, stranger, "aaa stranger secret")

    for sort in ("text", "-text"):
        real = await api.get(url, params={"sort": sort, "limit": "1"}, headers=editor.headers)
        for anchor in (of_sibling, of_stranger, str(uuid.uuid4())):
            response = await api.get(
                url,
                params={
                    "sort": sort,
                    "limit": "5",
                    "cursor": forged_cursor(_cursor(real), [anchor]),
                },
                headers=editor.headers,
            )

            # An anchor the project does not have is no position: an empty page, nothing shown.
            assert response.status_code == 200, response.text
            assert response.json()["data"] == []
            assert response.json()["page"] == {"limit": 5, "next_cursor": None, "has_more": False}
            assert "secret" not in response.text


@pytest.mark.parametrize("sort", ["created_at", "-created_at", "updated_at", "-updated_at"])
async def test_instants_less_than_a_second_apart_page_in_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    ids = [await added(api, workspace, project, editor, f"prompt {n}") for n in range(6)]
    base = dt.datetime(2026, 1, 1, tzinfo=dt.UTC)
    # Six instants 7 microseconds apart, the updates in another order than the creations.
    for step, (prompt_id, touched) in enumerate(zip(ids, (3, 1, 4, 0, 5, 2), strict=True)):
        await execute(
            migrated,
            "UPDATE ai.prompts SET created_at = $2, updated_at = $3 WHERE id = $1",
            uuid.UUID(prompt_id),
            base + dt.timedelta(microseconds=7 * step),
            base + dt.timedelta(microseconds=7 * touched),
        )
    rows = await _rows(migrated, project)
    field = sort.removeprefix("-")
    expected = [
        prompt_id
        for prompt_id, _ in sorted(
            rows.items(), key=lambda item: item[1][field], reverse=sort.startswith("-")
        )
    ]

    seen, pages = await _walk(api, url, editor, sort, limit=2)

    assert seen == expected
    assert pages == 3


@pytest.mark.parametrize("sort", SORTS)
async def test_the_last_page_of_a_sorted_list_has_no_cursor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    for name, importance in zip("abcdef", (1, 2, 3, 4, 5, 3), strict=True):
        await added(api, workspace, project, editor, f"prompt {name}", importance=importance)

    first = await api.get(url, params={"sort": sort, "limit": "3"}, headers=editor.headers)
    second = await api.get(
        url,
        params={"sort": sort, "limit": "3", "cursor": _cursor(first)},
        headers=editor.headers,
    )

    # Exactly `limit` rows are left: they are the last page, not a page before an empty one.
    assert len(_texts(second)) == 3
    assert second.json()["page"] == {"limit": 3, "next_cursor": None, "has_more": False}


async def test_a_sort_cursor_of_an_unsorted_list_must_hold_one_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    ids = await _seed(api, workspace, project, editor)
    real = await api.get(url, params={"limit": "1"}, headers=editor.headers)

    forged = await api.get(
        url,
        params={"limit": "1", "cursor": forged_cursor(_cursor(real), [3, ids["alpha"]])},
        headers=editor.headers,
    )

    assert problem(forged) == INVALID_CURSOR


@pytest.mark.parametrize(
    "params",
    [
        pytest.param({"filter[importance_in]": "6"}, id="importance above"),
        pytest.param({"filter[importance_in]": "0"}, id="importance below"),
        pytest.param({"filter[importance_in]": "3,high"}, id="importance not a number"),
        pytest.param({"filter[funnel_stage_in]": "middle"}, id="funnel stage unknown"),
        pytest.param({"filter[funnel_stage_in]": "tofu,middle"}, id="one funnel stage unknown"),
        pytest.param({"filter[is_branded]": "maybe"}, id="branded not a boolean"),
        pytest.param({"filter[is_active]": "all"}, id="active not any"),
        pytest.param({"sort": "volume"}, id="sort unknown"),
        pytest.param({"sort": "--text"}, id="sort doubled"),
        pytest.param({"sort": "text,importance"}, id="sort a list"),
    ],
)
async def test_bounds_are_422(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    _, editor, _, url = await _scene(resources, migrated)

    response = await api.get(url, params=params, headers=editor.headers)

    assert problem(response) == INVALID


async def test_the_page_is_one_statement_whatever_the_filters_and_sort(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project, url = await _scene(resources, migrated)
    await _seed(api, workspace, project, editor)
    everything = {
        "filter[funnel_stage_in]": "tofu,mofu",
        "filter[importance_in]": "3,5",
        "filter[is_branded]": "true",
        "filter[is_active]": "any",
        "sort": "-importance",
        "limit": "1",
    }
    first = await api.get(url, params=everything, headers=editor.headers)
    cursor = _cursor(first)

    with statements(resources) as plain:
        await api.get(url, headers=editor.headers)
    with statements(resources) as filtered:
        await api.get(url, params=everything, headers=editor.headers)
    with statements(resources) as later:
        await api.get(url, params={**everything, "cursor": cursor}, headers=editor.headers)

    # A text sort reads the text of its anchor prompt: still the same statement.
    by_text = await api.get(url, params={"sort": "text", "limit": "1"}, headers=editor.headers)
    with statements(resources) as continued:
        await api.get(
            url,
            params={"sort": "text", "limit": "1", "cursor": _cursor(by_text)},
            headers=editor.headers,
        )

    def on_prompts(seen: list[str]) -> int:
        return sum("FROM ai.prompts" in statement for statement in seen)

    assert on_prompts(plain) == on_prompts(filtered) == on_prompts(later) == 1
    assert on_prompts(continued) == 1
    assert len(plain) == len(filtered) == len(later) == len(continued)


async def test_the_list_checks_access_before_it_reads_the_new_members(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts")

    refused = await api.get(url, params={"sort": "-importance"}, headers=billing.headers)
    unseen = await api.get(url, params={"sort": "-importance"}, headers=outsider.headers)

    assert problem(refused) == (403, "forbidden")
    assert problem(unseen) == (404, "not_found")


async def test_the_list_without_additions_answers_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts")

    listed = await api.get(url, headers=viewer.headers)
    archived = await api.get(url, params={"filter[is_active]": "false"}, headers=viewer.headers)

    assert listed.status_code == 200, listed.text
    assert len(listed.json()["data"]) == 1
    assert archived.status_code == 200, archived.text
    assert archived.json()["data"] == []
