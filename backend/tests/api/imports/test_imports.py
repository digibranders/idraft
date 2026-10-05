"""Keyword imports (docs/19 section 3.6.3; the imports sub-plan, rules I1 to I13): the API stores
the source and records the import, the worker reads it, and the routes here show and change
the preview."""

from __future__ import annotations

import base64
import json
import uuid
from typing import Any

import httpx
import pytest

from sightline.api.resources import Resources
from sightline.storage.raw import decompress
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.conftest import AppFactory
from tests.api.entities.support import Caller, member, problem
from tests.api.imports.support import (
    create_paste,
    created_import,
    imports_url,
    preview,
    status_of,
)
from tests.api.keywords.support import errors, keyword_project, track, vocabulary
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

CSV = b"keyword,tags\ncrm,a\nerp,b\n"


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _audit(pg: PostgresServer, workspace: Workspace, action: str) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT target_id, before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = $2 ORDER BY occurred_at",
        workspace.id,
        action,
    )
    return [
        {
            "target_id": str(row["target_id"]),
            "before": None if row["before"] is None else json.loads(row["before"]),
            "after": json.loads(row["after"]),
        }
        for row in rows
    ]


async def _upload(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    *,
    content: bytes = CSV,
    filename: str = "keywords.csv",
    content_type: str = "text/csv",
    options: dict[str, Any] | None = None,
) -> httpx.Response:
    data = {} if options is None else {"options": json.dumps(options)}
    return await api.post(
        imports_url(workspace, project, "upload"),
        files={"file": (filename, content, content_type)},
        data=data,
        headers=caller.headers,
    )


def _both_parts() -> list[dict[str, Any]]:
    return [
        {"row_no": 1, "keyword": "crm", "outcome": "new", "action": "create"},
        {"row_no": 2, "keyword": "Erp", "outcome": "variant", "action": "create"},
        {
            "row_no": 3,
            "keyword": "seo",
            "outcome": "new",
            "action": "create",
            "part": 1,
        },
        {
            "row_no": 3,
            "keyword": "seo",
            "outcome": "new",
            "action": "create",
            "part": 2,
            "device": "mobile",
        },
        {
            "row_no": 4,
            "keyword": "crm",
            "outcome": "invalid",
            "action": "skip",
            "reason_code": "keyword_missing",
            "reason": "No keyword.",
        },
    ]


async def test_pasted_lines_are_stored_and_recorded_for_the_worker(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await create_paste(api, workspace, project, owner, "crm\terp\nseo\n")

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert (data["source"], data["status"], data["original_filename"]) == (
        "paste",
        "uploaded",
        None,
    )
    assert data["quota"] is None
    assert data["counts"]["rows_total"] == 0
    assert data["operation"]["kind"] == "keyword_import"
    assert data["operation"]["status"] == "queued"
    assert data["operation"]["progress"]["total"] is None
    assert data["operation"]["links"]["cancel"].endswith(
        f"/keyword-imports/{data['import_id']}/cancel"
    )
    assert data["operation"]["links"]["result"] is None
    (key,) = import_store.objects
    assert key == f"imports/v1/{workspace.id}/{data['import_id']}/source"
    assert json.loads(decompress(import_store.objects[key])) == {
        "kind": "paste",
        "text": "crm\terp\nseo\n",
    }
    row = await fetchrow(
        migrated,
        "SELECT upload_object_key, created_by FROM seo.keyword_imports WHERE id = $1",
        uuid.UUID(data["import_id"]),
    )
    assert (row["upload_object_key"], row["created_by"]) == (key, owner.user_id)
    (entry,) = await _audit(migrated, workspace, "keyword_import.created")
    assert entry["target_id"] == data["import_id"]


async def test_rows_given_in_the_request_are_stored_as_they_are(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    rows = [{"keyword": "crm", "device": "mobile"}, {"keyword": "erp"}]

    response = await api.post(
        imports_url(workspace, project),
        json={
            "source": "api",
            "rows": rows,
            "defaults": {"location_id": 2840, "priority": 2, "group_path": "Product/Pricing"},
        },
        headers=owner.headers,
    )

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert data["source"] == "api"
    assert data["defaults"] == {"location_id": 2840, "priority": 2, "group_path": "Product/Pricing"}
    (blob,) = import_store.objects.values()
    assert json.loads(decompress(blob)) == {"kind": "api", "rows": rows}


async def test_a_csv_file_is_stored_whole_with_the_options_that_came_with_it(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await _upload(
        api,
        workspace,
        project,
        owner,
        filename="C:\\exports\\q3/keywords.csv",
        options={"column_mapping": {"Term": "keyword"}, "defaults": {"device": "mobile"}},
    )

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert (data["source"], data["original_filename"], data["status"]) == (
        "upload",
        "keywords.csv",
        "uploaded",
    )
    assert data["column_mapping"] == {"Term": "keyword"}
    assert data["defaults"] == {"device": "mobile"}
    (blob,) = import_store.objects.values()
    stored = json.loads(decompress(blob))
    assert stored["kind"] == "csv"
    assert base64.b64decode(stored["data"]) == CSV


async def test_a_csv_without_a_content_type_is_known_by_its_name(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    named = await _upload(api, workspace, project, owner, content_type="application/octet-stream")
    unnamed = await _upload(
        api,
        workspace,
        project,
        owner,
        filename="keywords.dat",
        content_type="application/octet-stream",
    )

    assert named.status_code == 202, named.text
    assert problem(unnamed) == (415, "unsupported_media_type")


async def test_a_file_that_is_not_csv_is_refused_and_nothing_is_kept(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await _upload(
        api,
        workspace,
        project,
        owner,
        filename="keywords.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    assert problem(response) == (415, "unsupported_media_type")
    assert import_store.objects == {}
    assert (
        await fetch(migrated, "SELECT id FROM seo.keyword_imports WHERE project_id = $1", project)
        == []
    )


async def test_an_upload_with_options_that_are_not_json_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await api.post(
        imports_url(workspace, project, "upload"),
        files={"file": ("keywords.csv", CSV, "text/csv")},
        data={"options": "{not json"},
        headers=owner.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response)[0][0].startswith("options")


async def test_an_upload_without_a_file_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await api.post(
        imports_url(workspace, project, "upload"),
        data={"options": "{}"},
        headers=owner.headers,
    )

    assert problem(response) == (422, "validation_failed")


async def test_without_object_storage_an_import_is_refused(
    client_for: AppFactory, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    async with client_for() as bare:
        response = await create_paste(bare, workspace, project, owner)

    assert problem(response) == (503, "storage_unavailable")
    assert (
        await fetch(migrated, "SELECT id FROM seo.keyword_imports WHERE project_id = $1", project)
        == []
    )


async def test_a_source_the_bucket_does_not_take_is_not_recorded(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    import_store.fails = True

    response = await create_paste(api, workspace, project, owner)

    assert problem(response) == (503, "storage_unavailable")
    assert (
        await fetch(migrated, "SELECT id FROM seo.keyword_imports WHERE project_id = $1", project)
        == []
    )
    assert await _audit(migrated, workspace, "keyword_import.created") == []


@pytest.mark.parametrize(
    ("body", "path", "code"),
    [
        (
            {"source": "paste", "paste": "crm", "column_mapping": {"A": "keyword"}},
            "column_mapping",
            "not_applicable",
        ),
        (
            {
                "source": "api",
                "rows": [{"A": "crm"}],
                "column_mapping": {"A": "keyword", "a": "tags"},
            },
            "column_mapping",
            "header_repeated",
        ),
        (
            {
                "source": "api",
                "rows": [{"A": "crm"}],
                "column_mapping": {"A": "keyword", "B": "keyword"},
            },
            "column_mapping",
            "field_mapped_twice",
        ),
        (
            {"source": "paste", "paste": "crm", "defaults": {"location_id": 999999}},
            "defaults.location_id",
            "location_unknown",
        ),
        (
            {"source": "paste", "paste": "crm", "defaults": {"group_path": "/".join(["g"] * 11)}},
            "defaults.group_path",
            "group_path_invalid",
        ),
        (
            {
                "source": "paste",
                "paste": "crm",
                "defaults": {"tags_vocabulary_id": str(uuid.uuid4())},
            },
            "defaults.tags_vocabulary_id",
            "vocabulary_unknown",
        ),
        (
            {
                "source": "paste",
                "paste": "crm",
                "defaults": {"topic_vocabulary_id": str(uuid.uuid4())},
            },
            "defaults.topic_vocabulary_id",
            "vocabulary_unknown",
        ),
    ],
)
async def test_an_import_that_cannot_be_run_is_refused_whole(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
    body: dict[str, Any],
    path: str,
    code: str,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await api.post(imports_url(workspace, project), json=body, headers=owner.headers)

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [(path, code)]
    assert import_store.objects == {}


@pytest.mark.parametrize(
    "body",
    [
        {"source": "paste"},
        {"source": "paste", "paste": "crm", "rows": [{"keyword": "crm"}]},
        {"source": "api", "paste": "crm"},
        {"source": "api", "rows": []},
        {"source": "gsc", "paste": "crm"},
    ],
)
async def test_the_body_must_match_the_source(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    body: dict[str, Any],
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await api.post(imports_url(workspace, project), json=body, headers=owner.headers)

    assert problem(response) == (422, "validation_failed")


async def test_a_vocabulary_of_the_workspace_or_the_project_can_be_named(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)

    response = await create_paste(
        api, workspace, project, owner, defaults={"topic_vocabulary_id": topics}
    )

    assert response.status_code == 202, response.text
    assert response.json()["data"]["defaults"] == {"topic_vocabulary_id": topics}


async def test_a_member_limited_to_projects_cannot_name_a_workspace_wide_vocabulary(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _ = await _owner(resources, migrated)
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[project])
    topics = await vocabulary(migrated, workspace)

    refused = await create_paste(
        api, workspace, project, scoped, defaults={"topic_vocabulary_id": topics}
    )
    plain = await create_paste(api, workspace, project, scoped)

    assert problem(refused) == (403, "forbidden")
    assert plain.status_code == 202, plain.text


async def test_a_viewer_reads_imports_and_cannot_make_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    data = await created_import(api, workspace, project, owner)

    listed = await api.get(imports_url(workspace, project), headers=viewer.headers)
    fetched = await api.get(
        imports_url(workspace, project, data["import_id"]), headers=viewer.headers
    )
    created = await create_paste(api, workspace, project, viewer)
    uploaded = await _upload(api, workspace, project, viewer)
    changed = await api.patch(
        imports_url(workspace, project, data["import_id"]),
        json={"defaults": {}},
        headers=viewer.headers,
    )
    cancelled = await api.post(
        imports_url(workspace, project, data["import_id"], "cancel"), headers=viewer.headers
    )

    assert (listed.status_code, fetched.status_code) == (200, 200)
    assert [problem(r) for r in (created, uploaded, changed, cancelled)] == [(403, "forbidden")] * 4


async def test_the_import_list_is_newest_first_and_pages_by_cursor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    made = [(await created_import(api, workspace, project, owner))["import_id"] for _ in range(3)]
    await created_import(api, workspace, other, owner)

    first = await api.get(
        imports_url(workspace, project), params={"limit": 2}, headers=owner.headers
    )
    second = await api.get(
        imports_url(workspace, project),
        params={"limit": 2, "cursor": first.json()["page"]["next_cursor"]},
        headers=owner.headers,
    )

    assert [item["import_id"] for item in first.json()["data"]] == made[::-1][:2]
    assert first.json()["page"]["has_more"] is True
    assert [item["import_id"] for item in second.json()["data"]] == made[::-1][2:]
    assert second.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False}


async def test_the_import_list_filters_by_status_and_ties_its_cursor_to_the_filter(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    waiting = await created_import(api, workspace, project, owner)
    done = await created_import(api, workspace, project, owner)
    await created_import(api, workspace, project, owner)
    cancelled = await api.post(
        imports_url(workspace, project, done["import_id"], "cancel"), headers=owner.headers
    )
    assert cancelled.status_code == 200, cancelled.text

    only = await api.get(
        imports_url(workspace, project),
        params={"filter[status]": "cancelled"},
        headers=owner.headers,
    )
    paged = await api.get(
        imports_url(workspace, project), params={"limit": 1}, headers=owner.headers
    )
    reused = await api.get(
        imports_url(workspace, project),
        params={"filter[status]": "uploaded", "cursor": paged.json()["page"]["next_cursor"]},
        headers=owner.headers,
    )
    unknown = await api.get(
        imports_url(workspace, project), params={"filter[status]": "nope"}, headers=owner.headers
    )

    assert [item["import_id"] for item in only.json()["data"]] == [done["import_id"]]
    assert waiting["import_id"] not in [item["import_id"] for item in only.json()["data"]]
    assert problem(reused) == (400, "invalid_cursor")
    assert problem(unknown) == (422, "validation_failed")


async def test_an_import_of_another_project_or_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other_project = await keyword_project(migrated, workspace)
    data = await created_import(api, workspace, project, owner)
    stranger_workspace = await make_workspace(migrated)
    stranger = await member(resources, migrated, stranger_workspace, "owner")
    stranger_project = await keyword_project(migrated, stranger_workspace)
    routes = [
        ("get", ()),
        ("get", ("rows",)),
        ("get", ("report",)),
        ("post", ("cancel",)),
        ("patch", ()),
    ]

    seen: list[tuple[int, str]] = []
    for method, tail in routes:
        body: dict[str, Any] | None = {"defaults": {}} if method == "patch" else None
        for url_workspace, url_project, caller in (
            (workspace, other_project, owner),
            (stranger_workspace, stranger_project, stranger),
        ):
            response = await api.request(
                method,
                imports_url(url_workspace, url_project, data["import_id"], *tail),
                headers=caller.headers,
                json=body,
            )
            seen.append(problem(response))
    missing = await api.get(imports_url(workspace, project, uuid.uuid4()), headers=owner.headers)

    assert seen == [(404, "not_found")] * (len(routes) * 2)
    assert problem(missing) == (404, "not_found")
    assert await status_of(migrated, data["import_id"]) == "uploaded"


async def test_the_rows_wait_for_the_preview(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)

    rows = await api.get(
        imports_url(workspace, project, data["import_id"], "rows"), headers=owner.headers
    )
    report = await api.get(
        imports_url(workspace, project, data["import_id"], "report"), headers=owner.headers
    )

    assert problem(rows) == (409, "invalid_state_transition")
    assert problem(report) == (409, "invalid_state_transition")


async def test_a_ready_preview_shows_its_counts_quota_and_rows_in_file_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())

    shown = await api.get(imports_url(workspace, project, data["import_id"]), headers=owner.headers)
    rows = await api.get(
        imports_url(workspace, project, data["import_id"], "rows"), headers=owner.headers
    )

    view = shown.json()["data"]
    assert view["status"] == "preview_ready"
    assert view["counts"] == {
        "rows_total": 5,
        "new": 3,
        "duplicate": 0,
        "variant": 1,
        "conflict": 0,
        "invalid": 1,
        "created": 0,
        "skipped": 0,
        "merged": 0,
    }
    # Nothing is tracked: the planned writes are the rows to create.
    assert view["quota"]["used"] == 0
    assert view["quota"]["would_use"] == 4
    assert view["quota"]["limit"] > 0
    assert view["operation"]["status"] == "waiting_for_input"
    assert view["operation"]["progress"]["total"] == 5
    assert view["operation"]["links"]["result"].endswith("/report")
    assert [(r["row_no"], r["part"], r["outcome"], r["action"]) for r in rows.json()["data"]] == [
        (1, 1, "new", "create"),
        (2, 1, "variant", "create"),
        (3, 1, "new", "create"),
        (3, 2, "new", "create"),
        (4, 1, "invalid", "skip"),
    ]
    first = rows.json()["data"][0]
    assert first["keyword"] == "crm"
    assert first["normalized_text"] == "crm"
    assert (first["device"], first["location_id"], first["language_code"]) == (
        "desktop",
        2840,
        "en",
    )


async def test_rows_page_by_cursor_and_filter_by_outcome_and_action(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    url = imports_url(workspace, project, data["import_id"], "rows")

    first = await api.get(url, params={"limit": 2}, headers=owner.headers)
    second = await api.get(
        url,
        params={"limit": 2, "cursor": first.json()["page"]["next_cursor"]},
        headers=owner.headers,
    )
    last = await api.get(
        url,
        params={"limit": 2, "cursor": second.json()["page"]["next_cursor"]},
        headers=owner.headers,
    )
    outcomes = await api.get(
        url, params={"filter[outcome_in]": "variant,invalid"}, headers=owner.headers
    )
    skipped = await api.get(url, params={"filter[action]": "skip"}, headers=owner.headers)
    reused = await api.get(
        url,
        params={"filter[action]": "skip", "cursor": first.json()["page"]["next_cursor"]},
        headers=owner.headers,
    )

    keys = [
        [(r["row_no"], r["part"]) for r in page.json()["data"]] for page in (first, second, last)
    ]
    assert keys == [[(1, 1), (2, 1)], [(3, 1), (3, 2)], [(4, 1)]]
    assert last.json()["page"]["has_more"] is False
    assert [r["row_no"] for r in outcomes.json()["data"]] == [2, 4]
    assert [r["row_no"] for r in skipped.json()["data"]] == [4]
    assert problem(reused) == (400, "invalid_cursor")


async def test_row_actions_are_chosen_while_the_preview_is_ready(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    url = imports_url(workspace, project, data["import_id"])

    changed = await api.patch(
        url,
        json={
            "row_actions": [
                {"row_no": 2, "action": "skip"},
                {"row_no": 3, "part": 2, "action": "skip"},
            ]
        },
        headers=owner.headers,
    )
    rows = await api.get(url + "/rows", headers=owner.headers)

    assert changed.status_code == 202, changed.text
    view = changed.json()["data"]
    assert view["status"] == "preview_ready"
    # Two rows are no longer written.
    assert view["quota"]["would_use"] == 2
    assert [(r["row_no"], r["part"], r["action"]) for r in rows.json()["data"]] == [
        (1, 1, "create"),
        (2, 1, "skip"),
        (3, 1, "create"),
        (3, 2, "skip"),
        (4, 1, "skip"),
    ]
    (entry,) = await _audit(migrated, workspace, "keyword_import.updated")
    assert entry["after"] == {"changed": "row_actions", "row_actions": 2}


async def test_a_tracked_duplicate_and_an_archived_keyword_can_be_merged(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    rows = [
        {
            "row_no": 1,
            "outcome": "duplicate",
            "reason_code": "tracked",
            "action": "skip",
        },
        {"row_no": 2, "outcome": "conflict", "reason_code": "archived", "action": "skip"},
        {"row_no": 3, "outcome": "duplicate", "reason_code": "repeated_in_file", "action": "skip"},
    ]
    await preview(migrated, workspace, data["import_id"], rows)
    url = imports_url(workspace, project, data["import_id"])

    merged = await api.patch(
        url,
        json={"row_actions": [{"row_no": 1, "action": "merge"}, {"row_no": 2, "action": "merge"}]},
        headers=owner.headers,
    )
    repeated = await api.patch(
        url, json={"row_actions": [{"row_no": 3, "action": "merge"}]}, headers=owner.headers
    )

    assert merged.status_code == 202, merged.text
    assert problem(repeated) == (422, "validation_failed")
    assert errors(repeated) == [("row_actions.0.action", "action_not_allowed")]


@pytest.mark.parametrize(
    ("actions", "expected"),
    [
        ([{"row_no": 9, "action": "skip"}], [("row_actions.0", "row_unknown")]),
        ([{"row_no": 3, "part": 2, "action": "skip"}] * 2, [("row_actions.1", "row_repeated")]),
        ([{"row_no": 1, "action": "merge"}], [("row_actions.0.action", "action_not_allowed")]),
        ([{"row_no": 4, "action": "create"}], [("row_actions.0.action", "action_not_allowed")]),
        (
            [{"row_no": 1, "action": "force_separate"}],
            [("row_actions.0.action", "force_separate_not_available")],
        ),
        (
            [{"row_no": 9, "action": "skip"}, {"row_no": 1, "action": "merge"}],
            [("row_actions.0", "row_unknown"), ("row_actions.1.action", "action_not_allowed")],
        ),
    ],
)
async def test_a_row_action_the_row_cannot_take_refuses_all_of_them(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    actions: list[dict[str, Any]],
    expected: list[tuple[str, str]],
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    url = imports_url(workspace, project, data["import_id"])

    response = await api.patch(url, json={"row_actions": actions}, headers=owner.headers)

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == expected
    after = await api.get(url + "/rows", headers=owner.headers)
    assert [r["action"] for r in after.json()["data"]] == [
        "create",
        "create",
        "create",
        "create",
        "skip",
    ]


async def test_row_actions_do_not_travel_with_a_new_mapping_or_defaults(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    url = imports_url(workspace, project, data["import_id"])
    action = {"row_no": 1, "action": "skip"}

    with_mapping = await api.patch(
        url,
        json={"column_mapping": {"A": "keyword"}, "row_actions": [action]},
        headers=owner.headers,
    )
    with_defaults = await api.patch(
        url, json={"defaults": {"priority": 2}, "row_actions": [action]}, headers=owner.headers
    )

    assert [errors(r) for r in (with_mapping, with_defaults)] == [
        [("row_actions", "not_with_mapping")]
    ] * 2
    assert await status_of(migrated, data["import_id"]) == "preview_ready"


async def test_an_empty_change_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)

    response = await api.patch(
        imports_url(workspace, project, data["import_id"]), json={}, headers=owner.headers
    )

    assert problem(response) == (422, "validation_failed")


async def test_a_new_mapping_or_new_defaults_send_the_import_back_to_the_worker(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    url = imports_url(workspace, project, data["import_id"])

    remapped = await api.patch(
        url, json={"column_mapping": {"Term": "keyword"}}, headers=owner.headers
    )
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET status = 'needs_mapping' WHERE id = $1",
        uuid.UUID(data["import_id"]),
    )
    defaulted = await api.patch(
        url, json={"defaults": {"priority": 4, "device": "mobile"}}, headers=owner.headers
    )

    assert remapped.status_code == 202, remapped.text
    assert remapped.json()["data"]["status"] == "uploaded"
    assert remapped.json()["data"]["column_mapping"] == {"Term": "keyword"}
    assert remapped.json()["data"]["quota"] is None
    assert defaulted.json()["data"]["status"] == "uploaded"
    # Defaults are replaced whole; the mapping stays.
    assert defaulted.json()["data"]["defaults"] == {"priority": 4, "device": "mobile"}
    assert defaulted.json()["data"]["column_mapping"] == {"Term": "keyword"}
    entries = await _audit(migrated, workspace, "keyword_import.updated")
    assert [e["after"]["changed"] for e in entries] == ["source_settings", "source_settings"]


@pytest.mark.parametrize(
    ("body", "path", "code"),
    [
        ({"column_mapping": {"A": "keyword", "a": "tags"}}, "column_mapping", "header_repeated"),
        ({"column_mapping": {"A": "tags", "B": "tags"}}, "column_mapping", "field_mapped_twice"),
        ({"defaults": {"location_id": 999999}}, "defaults.location_id", "location_unknown"),
    ],
)
async def test_a_change_that_cannot_be_run_leaves_the_import_alone(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    body: dict[str, Any],
    path: str,
    code: str,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())

    response = await api.patch(
        imports_url(workspace, project, data["import_id"]), json=body, headers=owner.headers
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [(path, code)]
    assert await status_of(migrated, data["import_id"]) == "preview_ready"


@pytest.mark.parametrize(
    "status", ["writing", "completed", "completed_with_errors", "failed", "cancelled", "expired"]
)
async def test_an_import_past_the_preview_cannot_be_changed_or_cancelled(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    status: str,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts(), status=status)
    url = imports_url(workspace, project, data["import_id"])

    mapping = await api.patch(url, json={"column_mapping": {"A": "keyword"}}, headers=owner.headers)
    actions = await api.patch(
        url, json={"row_actions": [{"row_no": 1, "action": "skip"}]}, headers=owner.headers
    )
    cancel = await api.post(url + "/cancel", headers=owner.headers)

    assert [problem(r) for r in (mapping, actions, cancel)] == [
        (409, "invalid_state_transition")
    ] * 3
    assert await status_of(migrated, data["import_id"]) == status


async def test_a_preview_past_its_time_cannot_be_changed_before_the_worker_expires_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET expires_at = now() - interval '1 minute' WHERE id = $1",
        uuid.UUID(data["import_id"]),
    )
    url = imports_url(workspace, project, data["import_id"])

    actions = await api.patch(
        url, json={"row_actions": [{"row_no": 1, "action": "skip"}]}, headers=owner.headers
    )
    cancel = await api.post(url + "/cancel", headers=owner.headers)

    assert [problem(r) for r in (actions, cancel)] == [(409, "invalid_state_transition")] * 2


@pytest.mark.parametrize("status", ["uploaded", "needs_mapping", "preview_ready"])
async def test_an_import_can_be_cancelled_while_it_waits(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, status: str
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts(), status=status)

    response = await api.post(
        imports_url(workspace, project, data["import_id"], "cancel"), headers=owner.headers
    )

    assert response.status_code == 200, response.text
    view = response.json()["data"]
    assert (view["status"], view["operation"]["status"]) == ("cancelled", "cancelled")
    assert view["finished_at"] is not None
    assert view["operation"]["links"]["cancel"] is None
    (entry,) = await _audit(migrated, workspace, "keyword_import.cancelled")
    assert (entry["before"], entry["after"]) == ({"status": status}, {"status": "cancelled"})


async def test_a_failed_import_says_why(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET status = 'failed', error_code = 'too_many_rows' "
        "WHERE id = $1",
        uuid.UUID(data["import_id"]),
    )

    response = await api.get(
        imports_url(workspace, project, data["import_id"]), headers=owner.headers
    )

    view = response.json()["data"]
    assert (view["status"], view["error_code"]) == ("failed", "too_many_rows")
    assert view["operation"]["status"] == "failed"
    assert view["operation"]["error"] == {
        "code": "too_many_rows",
        "detail": "An import has at most 10,000 rows.",
    }
    rows = await api.get(
        imports_url(workspace, project, data["import_id"], "rows"), headers=owner.headers
    )
    assert rows.status_code == 200


async def test_an_expired_import_reads_as_failed_with_the_reason(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts(), status="expired")

    response = await api.get(
        imports_url(workspace, project, data["import_id"]), headers=owner.headers
    )

    operation = response.json()["data"]["operation"]
    assert operation["status"] == "failed"
    assert operation["error"]["code"] == "expired"


async def test_the_report_lists_every_row_and_neutralises_formulas(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    rows = [
        {"row_no": 1, "keyword": "crm", "outcome": "new", "action": "create", "result": "created"},
        {
            "row_no": 2,
            "keyword": '=HYPERLINK("http://x")',
            "outcome": "invalid",
            "action": "skip",
            "reason_code": "keyword_invalid",
            "reason": "+not a formula, a reason",
            "result": "skipped",
        },
        {"row_no": 3, "keyword": "@sum", "outcome": "new", "action": "create"},
    ]
    await preview(migrated, workspace, data["import_id"], rows, status="completed_with_errors")

    response = await api.get(
        imports_url(workspace, project, data["import_id"], "report"), headers=owner.headers
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (
        f'attachment; filename="import-{data["import_id"]}.csv"'
    )
    lines = response.text.splitlines()
    assert lines[0] == (
        "row_no,part,keyword,location_id,language_code,device,outcome,reason_code,reason,action,"
        "result,tracked_keyword_id,write_error_code"
    )
    assert lines[1] == "1,1,crm,2840,en,desktop,new,,,create,created,,"
    assert lines[2].startswith('2,1,"\'=HYPERLINK(""http://x"")",2840,en,desktop,invalid')
    assert '"\'+not a formula, a reason"' in lines[2]
    assert lines[3].startswith("3,1,'@sum,")
    assert len(lines) == 4


async def test_a_cancelled_preview_still_has_its_report(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())
    await api.post(
        imports_url(workspace, project, data["import_id"], "cancel"), headers=owner.headers
    )

    response = await api.get(
        imports_url(workspace, project, data["import_id"], "report"), headers=owner.headers
    )

    assert response.status_code == 200
    assert len(response.text.splitlines()) == 6


async def test_the_quota_counts_what_is_already_tracked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    assert (await track(api, workspace, project, owner, "already")).status_code == 201
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _both_parts())

    response = await api.get(
        imports_url(workspace, project, data["import_id"]), headers=owner.headers
    )

    quota = response.json()["data"]["quota"]
    assert (quota["used"], quota["would_use"]) == (1, 5)
