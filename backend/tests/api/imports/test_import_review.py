"""Cases found by the Part A review of keyword imports."""

from __future__ import annotations

import json
import uuid

import httpx

from idraft.api.body_limit import UPLOAD_MAX_BYTES
from idraft.api.imports.service import _filename
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.imports.support import (
    create_paste,
    created_import,
    imports_url,
    preview,
    status_of,
)
from tests.api.keywords.support import errors, keyword_project, vocabulary
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

ROWS = [{"row_no": 1, "keyword": "crm", "outcome": "new", "action": "create"}]


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def test_a_column_mapping_for_pasted_lines_is_refused_in_a_change_too(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], ROWS)

    response = await api.patch(
        imports_url(workspace, project, data["import_id"]),
        json={"column_mapping": {"x": "keyword"}},
        headers=owner.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("column_mapping", "not_applicable")]
    assert await status_of(migrated, data["import_id"]) == "preview_ready"


async def test_an_import_that_never_reached_a_preview_has_no_report(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    url = imports_url(workspace, project, data["import_id"])

    cancelled = await api.post(url + "/cancel", headers=owner.headers)
    report = await api.get(url + "/report", headers=owner.headers)

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["data"]["operation"]["links"]["result"] is None
    assert problem(report) == (409, "invalid_state_transition")


async def test_an_import_that_failed_while_writing_keeps_its_report(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], ROWS, status="failed")
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET error_code = 'write_failed' WHERE id = $1",
        uuid.UUID(data["import_id"]),
    )
    url = imports_url(workspace, project, data["import_id"])

    shown = await api.get(url, headers=owner.headers)
    report = await api.get(url + "/report", headers=owner.headers)

    operation = shown.json()["data"]["operation"]
    assert operation["error"]["code"] == "write_failed"
    assert operation["links"]["result"].endswith("/report")
    assert report.status_code == 200


async def test_a_cancelled_preview_has_its_report_link(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], ROWS)

    cancelled = await api.post(
        imports_url(workspace, project, data["import_id"], "cancel"), headers=owner.headers
    )

    assert cancelled.json()["data"]["operation"]["links"]["result"].endswith("/report")


async def test_a_file_over_50_mb_is_refused_and_one_of_exactly_50_mb_is_kept(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    url = imports_url(workspace, project, "upload")
    header = b"keyword\n"

    fits = await api.post(
        url,
        files={"file": ("big.csv", header + b"a" * (UPLOAD_MAX_BYTES - len(header)), "text/csv")},
        headers=owner.headers,
    )
    over = await api.post(
        url,
        files={
            "file": ("big.csv", header + b"a" * (UPLOAD_MAX_BYTES - len(header) + 1), "text/csv")
        },
        headers=owner.headers,
    )

    assert fits.status_code == 202, fits.text
    assert problem(over) == (413, "payload_too_large")
    assert len(import_store.objects) == 1


def test_a_file_name_is_kept_without_control_characters_or_a_path() -> None:
    assert _filename("key\x00words\x07.csv") == "keywords.csv"
    assert _filename("C:\\exports\\q3/key words.csv") == "key words.csv"
    assert _filename("\x00\x07") is None
    assert _filename(None) is None


async def test_a_default_group_path_with_a_control_character_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await create_paste(
        api, workspace, project, owner, defaults={"group_path": "Pro\x00duct"}
    )

    assert problem(response) == (422, "validation_failed")
    assert import_store.objects == {}


async def test_a_member_limited_to_projects_cannot_use_an_import_that_files_terms_workspace_wide(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    made = await api.post(
        imports_url(workspace, project, "upload"),
        files={"file": ("keywords.csv", b"Term\ncrm\n", "text/csv")},
        data={"options": json.dumps({"defaults": {"topic_vocabulary_id": topics}})},
        headers=owner.headers,
    )
    import_id = made.json()["data"]["import_id"]
    await preview(migrated, workspace, import_id, ROWS)
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[project])
    url = imports_url(workspace, project, import_id)

    remapped = await api.patch(
        url, json={"column_mapping": {"Term": "keyword"}}, headers=scoped.headers
    )
    confirmed = await api.post(
        url + "/confirm", json={"duplicate_action": "skip"}, headers=scoped.headers
    )

    assert problem(remapped) == (403, "forbidden")
    assert problem(confirmed) == (403, "forbidden")
    assert await status_of(migrated, import_id) == "preview_ready"
    by_owner = await api.post(
        url + "/confirm", json={"duplicate_action": "skip"}, headers=owner.headers
    )
    assert by_owner.status_code == 202, by_owner.text
