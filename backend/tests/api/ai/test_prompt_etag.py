"""The ETag of a prompt and `If-Match` on its PATCH (prompt-dialogs N11; contract C1 change log).

The ETag is the first 32 hex characters of a SHA-256 over the prompt's snapshot and current
version id, quoted. `updated_at` is not in it, because a terms-only change does not bump it."""

from __future__ import annotations

import re
import uuid
from itertools import pairwise

import httpx

from idraft.api.resources import Resources
from tests.api.ai.support import added, ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import project_url, term, vocabulary
from tests.conftest import PostgresServer

FORMAT = re.compile(r'^"[0-9a-f]{32}"$')
PRECONDITION_FAILED = (412, "precondition_failed")
NOT_FOUND = (404, "not_found")
FORBIDDEN = (403, "forbidden")
INVALID = (422, "validation_failed")


async def _etag(api: httpx.AsyncClient, url: str, caller: Caller) -> str:
    response = await api.get(url, headers=caller.headers)
    assert response.status_code == 200, response.text
    return response.headers["ETag"]


async def _changes(pg: PostgresServer, workspace: Workspace, prompt_id: str) -> tuple[int, int]:
    """Audit rows and versions of the prompt: what a refused change must leave as it was."""
    audits = await fetch(
        pg,
        "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1 AND target_id = $2",
        workspace.id,
        prompt_id,
    )
    versions = await fetch(
        pg, "SELECT 1 FROM ai.prompt_versions WHERE prompt_id = $1", uuid.UUID(prompt_id)
    )
    return len(audits), len(versions)


async def test_get_and_patch_return_an_etag(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)

    read = await api.get(url, headers=editor.headers)
    again = await api.get(url, headers=editor.headers)
    changed = await api.patch(url, json={"importance": 1}, headers=editor.headers)

    assert FORMAT.match(read.headers["ETag"])
    assert again.headers["ETag"] == read.headers["ETag"]
    assert FORMAT.match(changed.headers["ETag"])
    assert changed.headers["ETag"] != read.headers["ETag"]
    assert changed.headers["ETag"] == await _etag(api, url, editor)


async def test_the_etag_changes_with_terms_and_metadata(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    crm = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    url = project_url(workspace, project, "prompts", prompt_id)
    seen = [await _etag(api, url, editor)]

    bodies: list[dict[str, object]] = [
        {"term_ids": [crm]},
        {"term_ids": []},
        {"importance": 1},
        {"intent": "commercial"},
        {"funnel_stage": "bofu"},
        {"prompt_type": "comparison"},
        {"is_branded": True},
        {"is_active": False},
    ]
    for body in bodies:
        changed = await api.patch(url, json=body, headers=editor.headers)
        assert changed.status_code == 200, changed.text
        seen.append(await _etag(api, url, editor))

    # Each change moves the tag, so a terms-only change is not hidden by an unchanged
    # `updated_at`. Removing the term gives the first tag back: the tag is of the content.
    assert all(before != after for before, after in pairwise(seen))
    assert seen[2] == seen[0]


async def test_two_prompts_with_the_same_metadata_have_different_etags(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    first = await added(api, workspace, project, editor, "One?")
    second = await added(api, workspace, project, editor, "Two?")

    one = await _etag(api, project_url(workspace, project, "prompts", first), editor)
    two = await _etag(api, project_url(workspace, project, "prompts", second), editor)

    assert one != two


async def test_a_matching_if_match_changes_the_prompt(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)
    current = await _etag(api, url, editor)

    changed = await api.patch(
        url, json={"importance": 1}, headers={**editor.headers, "If-Match": current}
    )

    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["importance"] == 1


async def test_a_stale_if_match_is_412_and_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)
    stale = await _etag(api, url, editor)
    # Someone else changes the prompt between the read and the change.
    other = await api.patch(url, json={"intent": "commercial"}, headers=editor.headers)
    assert other.status_code == 200, other.text
    before = await api.get(url, headers=editor.headers)
    rows = await _changes(migrated, workspace, str(prompt_id))

    refused = await api.patch(
        url,
        json={"importance": 1, "is_active": False},
        headers={**editor.headers, "If-Match": stale},
    )

    after = await api.get(url, headers=editor.headers)
    assert problem(refused) == PRECONDITION_FAILED
    assert after.json() == before.json()
    assert after.headers["ETag"] == before.headers["ETag"]
    assert await _changes(migrated, workspace, str(prompt_id)) == rows


async def test_a_source_only_change_moves_the_etag(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Saying the value a prompt already has changes who decided it, and a client holding the
    old tag has not seen that."""
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    flagged, typed = await seed_prompts(migrated, workspace, project, 2)
    await execute(
        migrated,
        "UPDATE ai.prompts SET prompt_type_source = 'rule', is_branded_source = 'computed' "
        "WHERE id = ANY($1)",
        [flagged, typed],
    )
    for prompt_id, body, field, source in (
        (flagged, {"is_branded": False}, "is_branded_source", "override"),
        (typed, {"prompt_type": "question"}, "prompt_type_source", "person"),
    ):
        url = project_url(workspace, project, "prompts", prompt_id)
        read = await api.get(url, headers=editor.headers)
        tag = read.headers["ETag"]
        assert read.json()["data"][field] != source
        assert all(read.json()["data"][name] == value for name, value in body.items())

        same_value = await api.patch(url, json=body, headers=editor.headers)

        assert same_value.status_code == 200, same_value.text
        assert same_value.json()["data"][field] == source
        assert same_value.headers["ETag"] != tag
        assert await _etag(api, url, editor) == same_value.headers["ETag"]
        late = await api.patch(
            url, json={"importance": 1}, headers={**editor.headers, "If-Match": tag}
        )
        assert problem(late) == PRECONDITION_FAILED


async def test_a_stale_if_match_is_answered_before_terms_and_quota_are_looked_at(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    resting, _active = await seed_prompts(migrated, workspace, project, 2)
    await execute(migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", resting)
    await set_prompt_quota(migrated, workspace, 1)
    url = project_url(workspace, project, "prompts", resting)
    stale = await _etag(api, url, editor)
    assert (await api.patch(url, json={"importance": 1}, headers=editor.headers)).status_code == 200
    unknown_term = {"term_ids": [str(uuid.uuid4())]}
    bring_back = {"is_active": True}

    unknown_stale = await api.patch(
        url, json=unknown_term, headers={**editor.headers, "If-Match": stale}
    )
    quota_stale = await api.patch(
        url, json=bring_back, headers={**editor.headers, "If-Match": stale}
    )
    current = await _etag(api, url, editor)
    unknown_current = await api.patch(
        url, json=unknown_term, headers={**editor.headers, "If-Match": current}
    )
    quota_current = await api.patch(
        url, json=bring_back, headers={**editor.headers, "If-Match": current}
    )

    # With the current tag the same bodies are refused for their own reasons, so the 412 above
    # is the tag being compared first.
    assert problem(unknown_stale) == PRECONDITION_FAILED
    assert problem(quota_stale) == PRECONDITION_FAILED
    assert problem(unknown_current) == INVALID
    assert problem(quota_current) == (422, "quota_exceeded")


async def test_if_match_star_and_lists_match(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)
    stale = await _etag(api, url, editor)
    assert (await api.patch(url, json={"importance": 2}, headers=editor.headers)).status_code == 200

    async def change(if_match: str, importance: int) -> httpx.Response:
        return await api.patch(
            url, json={"importance": importance}, headers={**editor.headers, "If-Match": if_match}
        )

    star = await change("*", 3)
    listed = await change(f'{stale}, "{"0" * 32}" , {await _etag(api, url, editor)}', 4)
    weak = await change("W/" + await _etag(api, url, editor), 5)
    no_match = await change(f'{stale}, "{"1" * 32}"', 1)
    empty = await change(",", 1)
    assert [response.status_code for response in (star, listed, weak)] == [200, 200, 200]
    assert [problem(response) for response in (no_match, empty)] == [PRECONDITION_FAILED] * 2
    assert (await api.get(url, headers=editor.headers)).json()["data"]["importance"] == 5

    # The tag as it is now, without its quotes, and nothing between the read and the change: it
    # is the right value in the wrong form, so only the form can refuse it.
    bare = (await _etag(api, url, editor)).strip('"')
    unquoted = await change(bare, 1)

    assert problem(unquoted) == PRECONDITION_FAILED
    assert (await api.get(url, headers=editor.headers)).json()["data"]["importance"] == 5


async def test_if_match_on_a_missing_prompt_is_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", uuid.uuid4())

    star = await api.patch(url, json={"importance": 1}, headers={**editor.headers, "If-Match": "*"})
    named = await api.patch(
        url, json={"importance": 1}, headers={**editor.headers, "If-Match": '"' + "a" * 32 + '"'}
    )

    assert problem(star) == NOT_FOUND
    assert problem(named) == NOT_FOUND


async def test_a_viewer_is_refused_before_if_match_is_looked_at(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)

    stale = await api.patch(
        url, json={"importance": 1}, headers={**viewer.headers, "If-Match": '"' + "a" * 32 + '"'}
    )
    too_long = await api.patch(
        url, json={"importance": 1}, headers={**viewer.headers, "If-Match": "x" * 129}
    )

    assert problem(stale) == FORBIDDEN
    assert problem(too_long) == FORBIDDEN


async def test_if_match_over_128_characters_is_422(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)

    over = await api.patch(
        url, json={"importance": 1}, headers={**editor.headers, "If-Match": "x" * 129}
    )
    at_limit = await api.patch(
        url, json={"importance": 1}, headers={**editor.headers, "If-Match": "x" * 128}
    )

    assert problem(over) == INVALID
    assert problem(at_limit) == PRECONDITION_FAILED


async def test_a_change_without_if_match_works_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    changed = await api.patch(
        project_url(workspace, project, "prompts", prompt_id),
        json={"importance": 1},
        headers=editor.headers,
    )

    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["importance"] == 1
