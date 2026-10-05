"""The worker's side of keyword imports, part A (plan decisions D11 to D13; the imports
sub-plan, rules I2 to I6): parsing a source into the preview, and letting old previews expire.
As `app_worker`, with a memory store standing in for the bucket."""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.imports import ParseReport, expire_imports, parse_next
from sightline.storage.raw import RawStorageError, compress
from tests.api.auth.support import execute, fetch, fetchrow, make_user
from tests.api.keywords.support import LOCATION, OTHER_LOCATION, ensure_locations
from tests.collectors.support import Project, make_tenant
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_keyword_metrics import LosingStore, _track
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def no_imports(migrated: PostgresServer) -> None:
    """The worker claims any import in the database, so each test starts without any."""
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")


class BrokenStore(MemoryStore):
    """A bucket that does not answer."""

    async def get(self, key: str) -> bytes:
        raise RawStorageError("reading a payload failed: InternalError")


async def _project(pg: PostgresServer) -> Project:
    """A project whose defaults are the United States in English."""
    await ensure_locations(pg)
    project = await make_tenant(pg)
    await execute(
        pg,
        "UPDATE core.projects SET default_location_id = $2, default_language_code = 'en' "
        "WHERE id = $1",
        project.id,
        LOCATION,
    )
    return project


def _csv(text: str) -> dict[str, object]:
    return {"kind": "csv", "data": base64.b64encode(text.encode()).decode()}


async def _import(
    pg: PostgresServer,
    store: MemoryStore,
    project: Project,
    source: dict[str, object] | bytes,
    *,
    kind: str = "upload",
    mapping: dict[str, str] | None = None,
    defaults: dict[str, object] | None = None,
) -> uuid.UUID:
    """An import as the API records it: the source in the store, the import `uploaded`."""
    import_id = uuid.uuid4()
    key = f"imports/v1/{project.workspace_id}/{import_id}/source"
    body = source if isinstance(source, bytes) else compress(json.dumps(source).encode())
    await store.put(key, body)
    user = await make_user(pg, name="Importer")
    await execute(
        pg,
        "INSERT INTO seo.keyword_imports (id, workspace_id, project_id, source, upload_object_key, "
        "status, column_mapping, defaults, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, "
        "'uploaded', $6::jsonb, $7::jsonb, $8, now() + interval '7 days')",
        import_id,
        project.workspace_id,
        project.id,
        kind,
        key,
        json.dumps(mapping or {}),
        json.dumps(defaults or {}),
        user.id,
    )
    return import_id


async def _row(pg: PostgresServer, import_id: uuid.UUID) -> dict[str, Any]:
    found = await fetchrow(pg, "SELECT * FROM seo.keyword_imports WHERE id = $1", import_id)
    return dict(found)


async def _rows(pg: PostgresServer, import_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM seo.keyword_import_rows WHERE import_id = $1 ORDER BY row_no, part",
        import_id,
    )
    return [dict(row) for row in rows]


async def _tracked_id(pg: PostgresServer, project: Project, text: str) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "SELECT t.id FROM seo.tracked_keywords t JOIN seo.keywords k ON k.id = t.keyword_id "
        "WHERE t.project_id = $1 AND k.text = $2",
        project.id,
        text,
    )
    found: uuid.UUID = row["id"]
    return found


async def test_a_csv_import_reaches_its_preview_with_every_outcome(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    await _track(migrated, project, "crm")
    await _track(migrated, project, "erp", active=False)
    # The keyword exists in the workspace, typed differently, tracked elsewhere.
    await _track(migrated, project, "CRM Software", location=OTHER_LOCATION)
    # A deleted identity is brought back when the import writes: new again.
    await _track(migrated, project, "hr", deleted=True)
    source = _csv("keyword,device\ncrm,\nerp,\ncrm software,\nhr,\nsite:x.com,\ncrm,\nseo,both\n")
    import_id = await _import(migrated, store, project, source)

    report = await parse_next(worker_db, store)

    assert report == ParseReport(parsed=1)
    imported = await _row(migrated, import_id)
    assert imported["status"] == "preview_ready"
    assert imported["error_code"] is None
    assert json.loads(imported["counts"]) == {
        "rows_total": 8,
        "new": 3,
        "duplicate": 2,
        "variant": 1,
        "conflict": 1,
        "invalid": 1,
        "created": 0,
        "skipped": 0,
        "merged": 0,
    }
    # The mapping the worker used is kept, so the screen shows what each header became.
    assert json.loads(imported["column_mapping"]) == {"keyword": "keyword", "device": "device"}
    crm = await _tracked_id(migrated, project, "crm")
    erp = await _tracked_id(migrated, project, "erp")
    found = {
        (row["row_no"], row["part"]): (
            row["outcome"],
            row["reason_code"],
            row["action"],
            row["existing_tracked_keyword_id"],
            row["device"],
        )
        for row in await _rows(migrated, import_id)
    }
    assert found == {
        (1, 1): ("duplicate", "tracked", "skip", crm, "desktop"),
        (2, 1): ("conflict", "archived", "skip", erp, "desktop"),
        (3, 1): ("variant", "casing_differs", "create", None, "desktop"),
        (4, 1): ("new", None, "create", None, "desktop"),
        (5, 1): ("invalid", "search_operator_not_allowed", "skip", None, None),
        (6, 1): ("duplicate", "repeated_in_file", "skip", None, "desktop"),
        (7, 1): ("new", None, "create", None, "desktop"),
        (7, 2): ("new", None, "create", None, "mobile"),
    }


async def test_a_row_keeps_what_it_says_and_what_it_was(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    source = _csv(
        "Keyword,Country,Language,Note\n  CRM   Software ,gb,DE,keep me\nsite:x.com,,,bad\n"
    )
    import_id = await _import(migrated, store, project, source)

    await parse_next(worker_db, store)

    first, invalid = await _rows(migrated, import_id)
    assert (first["keyword_text"], first["normalized_text"]) == ("CRM Software", "crm software")
    assert (first["location_id"], first["language_code"]) == (OTHER_LOCATION, "de")
    # The source row as it was, with the columns the import does not read.
    assert json.loads(first["raw"]) == {
        "Keyword": "  CRM   Software ",
        "Country": "gb",
        "Language": "DE",
        "Note": "keep me",
    }
    # An invalid row shows what was typed, and no more.
    assert (invalid["keyword_text"], invalid["normalized_text"], invalid["location_id"]) == (
        "site:x.com",
        None,
        None,
    )
    assert invalid["reason"]


async def test_rows_take_the_imports_defaults_over_the_projects(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _import(
        migrated,
        store,
        project,
        _csv("keyword\ncrm\n"),
        defaults={"location_id": OTHER_LOCATION, "language_code": "fr", "device": "mobile"},
    )

    await parse_next(worker_db, store)

    (row,) = await _rows(migrated, import_id)
    assert (row["location_id"], row["language_code"], row["device"]) == (
        OTHER_LOCATION,
        "fr",
        "mobile",
    )


async def test_without_a_keyword_column_the_import_needs_a_mapping(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _import(migrated, store, project, _csv("Term,Device\ncrm,mobile\n"))

    report = await parse_next(worker_db, store)

    assert report == ParseReport(parsed=1)
    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == (
        "needs_mapping",
        "keyword_column_missing",
    )
    assert await _rows(migrated, import_id) == []
    # The user maps the column, and the API sets the import back to uploaded.
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET status = 'uploaded', column_mapping = $2::jsonb "
        "WHERE id = $1",
        import_id,
        json.dumps({"Term": "keyword"}),
    )

    await parse_next(worker_db, store)

    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("preview_ready", None)
    (row,) = await _rows(migrated, import_id)
    # The Device column was read all along; only the keyword needed the user.
    assert (row["keyword_text"], row["device"]) == ("crm", "mobile")


async def test_tags_or_a_topic_without_their_vocabulary_need_a_mapping(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    pasted = await _import(
        migrated, store, project, {"kind": "paste", "text": "crm\tb2b\n"}, kind="paste"
    )
    topic = await _import(migrated, store, project, _csv("keyword,topic\ncrm,CRM/Startups\n"))

    await parse_next(worker_db, store, limit=2)

    assert (await _row(migrated, pasted))["error_code"] == "tags_vocabulary_missing"
    assert (await _row(migrated, topic))["error_code"] == "topic_vocabulary_missing"
    # With the vocabularies named, both reach a preview.
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical) "
        "VALUES ($1, 'topic', 'Topics', true) RETURNING id",
        project.workspace_id,
    )
    defaults = json.dumps(
        {"tags_vocabulary_id": str(vocabulary["id"]), "topic_vocabulary_id": str(vocabulary["id"])}
    )
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET status = 'uploaded', defaults = $1::jsonb",
        defaults,
    )

    await parse_next(worker_db, store, limit=2)

    assert (await _row(migrated, pasted))["status"] == "preview_ready"
    assert (await _row(migrated, topic))["status"] == "preview_ready"


async def test_a_paste_and_api_rows_are_read_like_a_file(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    pasted = await _import(
        migrated, store, project, {"kind": "paste", "text": "crm\n\nerp\n"}, kind="paste"
    )
    api = await _import(
        migrated,
        store,
        project,
        {"kind": "api", "rows": [{"keyword": "crm", "device": "mobile"}, {"keyword": "erp"}]},
        kind="api",
    )

    await parse_next(worker_db, store, limit=2)

    assert [(r["row_no"], r["keyword_text"]) for r in await _rows(migrated, pasted)] == [
        (1, "crm"),
        (3, "erp"),
    ]
    assert [(r["row_no"], r["device"]) for r in await _rows(migrated, api)] == [
        (1, "mobile"),
        (2, "desktop"),
    ]


async def test_parsing_again_replaces_the_rows(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _import(migrated, store, project, _csv("keyword,other\ncrm,erp\n"))
    await parse_next(worker_db, store)
    assert [row["keyword_text"] for row in await _rows(migrated, import_id)] == ["crm"]
    # The user says the keyword is in the other column; the one called keyword is then left out.
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET status = 'uploaded', column_mapping = $2::jsonb "
        "WHERE id = $1",
        import_id,
        json.dumps({"other": "keyword"}),
    )

    await parse_next(worker_db, store)

    rows = await _rows(migrated, import_id)
    assert [(row["row_no"], row["keyword_text"]) for row in rows] == [(1, "erp")]
    assert json.loads((await _row(migrated, import_id))["column_mapping"]) == {"other": "keyword"}


async def test_an_unreadable_source_fails_the_import(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    not_utf8 = await _import(
        migrated, store, project, {"kind": "csv", "data": base64.b64encode(b"\xff\xfe").decode()}
    )
    corrupt = await _import(migrated, store, project, b"not a compressed object")
    wrong_kind = await _import(migrated, store, project, {"kind": "paste", "text": "crm"})

    report = await parse_next(worker_db, store, limit=3)

    assert report == ParseReport(failed=3)
    for import_id, code in (
        (not_utf8, "not_utf8"),
        (corrupt, "source_corrupt"),
        (wrong_kind, "source_corrupt"),
    ):
        imported = await _row(migrated, import_id)
        assert (imported["status"], imported["error_code"]) == ("failed", code)
        assert imported["finished_at"] is not None


async def test_too_many_rows_fail_the_import(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _import(
        migrated, store, project, {"kind": "paste", "text": "kw\n" * 10_001}, kind="paste"
    )

    await parse_next(worker_db, store)

    assert (await _row(migrated, import_id))["error_code"] == "too_many_rows"


async def test_a_bucket_that_does_not_answer_is_tried_again_until_it_is_given_up_on(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = BrokenStore()
    import_id = await _import(migrated, store, project, _csv("keyword\ncrm\n"))

    waiting = await parse_next(worker_db, store)

    assert waiting == ParseReport(waiting=1)
    assert (await _row(migrated, import_id))["status"] == "uploaded"
    # An hour later it is not the bucket's hiccup any more.
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET created_at = now() - interval '2 hours' WHERE id = $1",
        import_id,
    )

    given_up = await parse_next(worker_db, store)

    assert given_up == ParseReport(failed=1)
    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("failed", "source_unreadable")


async def test_one_unreadable_source_does_not_hold_up_the_next(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = LosingStore()
    lost = await _import(migrated, store, project, _csv("keyword\ncrm\n"))
    fine = await _import(migrated, store, project, _csv("keyword\nerp\n"))
    # The first one's object cannot be read; the second one's can.
    store.lost = {f"imports/v1/{project.workspace_id}/{lost}/source"}

    report = await parse_next(worker_db, store, limit=2)

    assert report == ParseReport(parsed=1, waiting=1)
    assert (await _row(migrated, lost))["status"] == "uploaded"
    assert (await _row(migrated, fine))["status"] == "preview_ready"


async def test_two_workers_parse_an_import_once(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _import(migrated, store, project, _csv("keyword\ncrm\nerp\n"))

    first, second = await asyncio.gather(
        parse_next(worker_db, store, limit=1), parse_next(worker_db, store, limit=1)
    )

    assert sorted([first.parsed, second.parsed]) == [0, 1]
    assert len(await _rows(migrated, import_id)) == 2


async def test_old_previews_expire(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    ids = {
        status: await _import(migrated, store, project, _csv("keyword\ncrm\n"))
        for status in ("uploaded", "needs_mapping", "preview_ready", "writing", "completed")
    }
    for status, import_id in ids.items():
        await execute(
            migrated,
            "UPDATE seo.keyword_imports SET status = $2, expires_at = now() - interval '1 minute' "
            "WHERE id = $1",
            import_id,
            status,
        )
    fresh = await _import(migrated, store, project, _csv("keyword\ncrm\n"))

    expired = await expire_imports(worker_db, now=datetime.now(UTC))

    assert expired == 3
    statuses = {
        status: (await _row(migrated, import_id))["status"] for status, import_id in ids.items()
    }
    assert statuses == {
        "uploaded": "expired",
        "needs_mapping": "expired",
        "preview_ready": "expired",
        "writing": "writing",
        "completed": "completed",
    }
    assert (await _row(migrated, ids["preview_ready"]))["finished_at"] is not None
    assert (await _row(migrated, fresh))["status"] == "uploaded"


async def test_five_thousand_rows_reach_the_preview_quickly(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    body = "keyword,device\n" + "".join(f"keyword number {n},both\n" for n in range(5000))
    import_id = await _import(migrated, store, project, _csv(body))

    started = time.monotonic()
    await parse_next(worker_db, store)
    elapsed = time.monotonic() - started

    assert (await _row(migrated, import_id))["status"] == "preview_ready"
    assert json.loads((await _row(migrated, import_id))["counts"])["new"] == 10_000
    # The acceptance target is well under 2 minutes in the test environment.
    assert elapsed < 30
