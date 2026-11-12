"""The published contract of annotations and notes (WP-03 T3b; OV-N9, OV-N13, BE-REPORTS-09):
every route answers `501 not_implemented` after its access checks and a body check. WP-38 deletes
this file when it writes the real tests."""

from __future__ import annotations

import uuid
from typing import Any

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

NOTE = {"on": "2026-11-03", "text": "Published /pricing v2", "scope": {"kind": "project"}}


async def test_annotations_answer_501_for_a_reader(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "annotations"),
        params={"from": "2026-11-01", "to": "2026-11-07"},
        headers=viewer.headers,
    )

    assert problem(response) == NOT_BUILT


async def test_notes_list_answers_501_for_a_reader(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(project_url(workspace, project, "notes"), headers=viewer.headers)

    assert problem(response) == NOT_BUILT


async def test_writing_a_note_needs_notes_write(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    notes = project_url(workspace, project, "notes")
    one = project_url(workspace, project, "notes", str(uuid.uuid4()))

    assert problem(await api.post(notes, json=NOTE, headers=viewer.headers)) == FORBIDDEN
    assert problem(await api.delete(one, headers=viewer.headers)) == FORBIDDEN
    assert problem(await api.post(notes, json=NOTE, headers=editor.headers)) == NOT_BUILT
    assert problem(await api.delete(one, headers=editor.headers)) == NOT_BUILT


@pytest.mark.parametrize(
    "change",
    [
        {"text": "x" * 141},
        {"text": "one\ntwo"},
        {"scope": {"kind": "topic"}},
        {"scope": {"kind": "term"}},
        {"on": "11/03/2026"},
        {"extra": 1},
    ],
)
async def test_a_note_body_out_of_bounds_is_refused_before_501(
    change: dict[str, Any],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "notes"), json={**NOTE, **change}, headers=editor.headers
    )

    assert problem(response) == INVALID


@pytest.mark.parametrize(
    ("method", "tail"),
    [
        ("GET", ("ai", "annotations")),
        ("GET", ("notes",)),
        ("POST", ("notes",)),
        ("DELETE", ("notes", str(uuid.uuid4()))),
    ],
)
async def test_notes_and_annotations_refuse_another_workspace(
    method: str,
    tail: tuple[str, ...],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)

    response = await api.request(
        method,
        project_url(workspace, project, *tail),
        json=NOTE if method == "POST" else None,
        headers=outsider.headers,
    )

    assert problem(response) == NOT_FOUND


def test_the_api_document_has_annotations_and_notes() -> None:
    document = build_openapi()
    paths = document["paths"]
    project = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
    schemas = document["components"]["schemas"]

    assert set(paths[f"{project}/ai/annotations"]) == {"get"}
    assert set(paths[f"{project}/notes"]) == {"get", "post"}
    assert set(paths[f"{project}/notes/{{note_id}}"]) == {"delete"}
    for name in (
        "Annotation",
        "AnnotationList",
        "NoteCreate",
        "Note",
        "NoteList",
        "NoteResponse",
        "ProjectNoteScope",
        "TermNoteScope",
    ):
        assert name in schemas
    assert "from" in schemas["Annotation"]["properties"]
    assert "to" in schemas["Annotation"]["properties"]
