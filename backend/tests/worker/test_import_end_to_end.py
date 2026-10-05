"""A keyword import from the upload to tracked keywords (the imports sub-plan, task B3): the API
takes the file, the worker reads it into a preview, the API shows and changes the preview and
confirms it, the worker writes it, and the API shows what was written and the report. The API and
the worker share the database and the store of the sources."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import AsyncIterator
from dataclasses import replace

import httpx
import pytest

from sightline.api.resources import Resources
from sightline.collectors.registry import Registry
from sightline.worker.app import WorkerContext
from tests.api.auth.support import execute, make_workspace
from tests.api.conftest import api, auth_app, import_store, mailbox, resources
from tests.api.entities.support import member
from tests.api.imports.support import imports_url
from tests.api.keywords.support import keyword_project, project_url, vocabulary
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.worker.test_assembly import context, ticks_of

__all__ = ["api", "auth_app", "context", "import_store", "mailbox", "resources"]


@pytest.fixture(autouse=True)
async def clean(migrated: PostgresServer) -> AsyncIterator[None]:
    """Other tests count tracked keywords and imports in the whole database."""
    yield
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    await execute(migrated, "DELETE FROM seo.tracked_keywords")


FILE = (
    b"keyword,device,group,topic\n"
    b"crm software,both,Product/Pricing,CRM\n"
    b"erp,,Product,\n"
    b"site:x.com,,,\n"
    b"crm software,mobile,,\n"
)


async def test_a_file_becomes_tracked_keywords_and_a_report(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    context: WorkerContext,
    import_store: MemoryStore,
) -> None:
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    ticks = ticks_of(replace(context, raw_store=import_store), Registry())

    # The API takes the file; nothing is read yet.
    uploaded = await api.post(
        imports_url(workspace, project, "upload"),
        files={"file": ("keywords.csv", FILE, "text/csv")},
        data={"options": json.dumps({"defaults": {"topic_vocabulary_id": topics}})},
        headers=owner.headers,
    )
    assert uploaded.status_code == 202, uploaded.text
    import_id = uploaded.json()["data"]["import_id"]
    url = imports_url(workspace, project, import_id)
    assert uploaded.json()["data"]["status"] == "uploaded"

    # The worker reads it, and the API shows the preview.
    await ticks["keyword_imports"].action()
    ready = (await api.get(url, headers=owner.headers)).json()["data"]
    rows = (await api.get(url + "/rows", headers=owner.headers)).json()["data"]
    assert ready["status"] == "preview_ready"
    assert ready["counts"]["rows_total"] == 5
    assert (ready["counts"]["new"], ready["counts"]["invalid"], ready["counts"]["duplicate"]) == (
        3,
        1,
        1,
    )
    assert ready["quota"]["would_use"] == 3
    assert [(r["row_no"], r["part"], r["outcome"]) for r in rows] == [
        (1, 1, "new"),
        (1, 2, "new"),
        (2, 1, "new"),
        (3, 1, "invalid"),
        (4, 1, "duplicate"),
    ]

    # The person skips erp, and confirms.
    chosen = await api.patch(
        url, json={"row_actions": [{"row_no": 2, "action": "skip"}]}, headers=owner.headers
    )
    assert chosen.json()["data"]["quota"]["would_use"] == 2
    confirmed = await api.post(
        url + "/confirm", json={"duplicate_action": "skip"}, headers=owner.headers
    )
    assert confirmed.status_code == 202, confirmed.text
    assert confirmed.json()["data"]["status"] == "writing"

    # The worker writes it, and the API shows the result.
    await ticks["keyword_import_writes"].action()
    done = (await api.get(url, headers=owner.headers)).json()["data"]
    assert done["status"] == "completed"
    assert (done["counts"]["created"], done["counts"]["skipped"], done["counts"]["merged"]) == (
        2,
        3,
        0,
    )
    assert done["operation"]["status"] == "succeeded"
    assert done["operation"]["progress"] == {"done": 5, "total": 5, "unit": "rows"}
    assert done["finished_at"] is not None

    listed = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"include": "groups,terms"},
        headers=owner.headers,
    )
    keywords = listed.json()["data"]
    assert sorted((k["keyword"]["text"], k["device"]) for k in keywords) == [
        ("crm software", "desktop"),
        ("crm software", "mobile"),
    ]
    assert {k["source"] for k in keywords} == {"csv_import"}
    for keyword in keywords:
        assert [g["path"] for g in keyword["groups"]] == ["Product/Pricing"]
        assert [t["name"] for t in keyword["terms"]] == ["CRM"]

    # The report has a line for every part, with what became of it.
    report = await api.get(url + "/report", headers=owner.headers)
    assert report.status_code == 200
    lines = list(csv.DictReader(io.StringIO(report.text)))
    assert [(line["row_no"], line["part"], line["result"]) for line in lines] == [
        ("1", "1", "created"),
        ("1", "2", "created"),
        ("2", "1", "skipped"),
        ("3", "1", "skipped"),
        ("4", "1", "skipped"),
    ]
    assert all(line["tracked_keyword_id"] for line in lines[:2])

    # A second run of the writer finds nothing to do, and cancel is refused now.
    await ticks["keyword_import_writes"].action()
    again = await api.post(url + "/cancel", headers=owner.headers)
    assert again.status_code == 409
