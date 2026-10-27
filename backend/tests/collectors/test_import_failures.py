"""What the worker does with an import it cannot handle (the Part A review): it ends that import
and goes on with the others, instead of trying it again on every tick ahead of everything else."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import import_writer, imports
from idraft.collectors.import_writer import WriteReport, write_next
from idraft.collectors.imports import ParseReport, parse_next
from idraft.keywords import writer
from idraft.storage.raw import RawStorageError
from tests.api.auth.support import execute
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_import_writer import _confirmed, _results, _tracked
from tests.collectors.test_imports import BrokenStore, _csv, _import, _project, _row, _rows
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def clean(migrated: PostgresServer) -> AsyncIterator[None]:
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    yield
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    await execute(migrated, "DELETE FROM seo.tracked_keywords")


async def test_text_the_database_cannot_keep_makes_an_invalid_row_and_blocks_nothing(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    first = await _import(
        migrated, store, project, {"kind": "paste", "text": "foo\x00bar\ncrm\n"}, kind="paste"
    )
    second = await _import(migrated, store, project, _csv("keyword,group\nerp,Pro\x00duct\n"))

    report = await parse_next(worker_db, store, limit=2)

    assert report == ParseReport(parsed=2)
    assert (await _row(migrated, first))["status"] == "preview_ready"
    rows = await _rows(migrated, first)
    assert [(r["row_no"], r["outcome"], r["keyword_text"]) for r in rows] == [
        (1, "invalid", "foobar"),
        (2, "new", "crm"),
    ]
    (bad,) = await _rows(migrated, second)
    assert (bad["outcome"], bad["reason_code"]) == ("invalid", "cell_invalid")
    # What was stored has no NUL, and is the source row otherwise.
    assert json.loads(bad["raw"]) == {"keyword": "erp", "group": "Product"}


async def test_an_import_that_always_breaks_is_ended_and_the_next_one_is_read(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    broken = await _import(migrated, store, project, _csv("keyword\ncrm\n"))
    fine = await _import(migrated, store, project, _csv("keyword\nerp\n"))
    real = imports._preview

    async def preview(db: Any, imp: Any, payload: Any) -> None:
        if imp.id == broken:
            raise ValueError("a value no row can hold")
        await real(db, imp, payload)

    monkeypatch.setattr(imports, "_preview", preview)

    report = await parse_next(worker_db, store, limit=2)

    assert report == ParseReport(parsed=1, failed=1)
    ended = await _row(migrated, broken)
    assert (ended["status"], ended["error_code"]) == ("failed", "parse_failed")
    assert ended["finished_at"] is not None
    assert (await _row(migrated, fine))["status"] == "preview_ready"
    # It is not tried again.
    assert await parse_next(worker_db, store) == ParseReport()


async def test_a_database_error_that_may_pass_does_not_end_the_import(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    waiting = await _import(migrated, store, project, _csv("keyword\ncrm\n"))

    async def preview(db: Any, imp: Any, payload: Any) -> None:
        raise ConnectionError("the database went away")

    monkeypatch.setattr(imports, "_preview", preview)

    with pytest.raises(ConnectionError):
        await parse_next(worker_db, store)

    assert (await _row(migrated, waiting))["status"] == "uploaded"


async def test_an_import_read_before_is_not_given_up_on_when_the_bucket_fails(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    good = MemoryStore()
    import_id = await _import(migrated, good, project, _csv("keyword\ncrm\n"))
    await parse_next(worker_db, good)
    # A day later a person changes the defaults, which sets the import back to uploaded, and
    # the bucket does not answer once.
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET status = 'uploaded', created_at = now() - interval '1 day' "
        "WHERE id = $1",
        import_id,
    )

    report = await parse_next(worker_db, BrokenStore())

    assert report == ParseReport(waiting=1)
    assert (await _row(migrated, import_id))["status"] == "uploaded"
    assert len(await _rows(migrated, import_id)) == 1


async def test_an_import_never_read_is_given_up_on_after_an_hour_of_a_failing_bucket(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    import_id = await _import(migrated, MemoryStore(), project, _csv("keyword\ncrm\n"))
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET created_at = now() - interval '2 hours' WHERE id = $1",
        import_id,
    )

    report = await parse_next(worker_db, BrokenStore())

    assert report == ParseReport(failed=1)
    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("failed", "source_unreadable")


class _SomeDown(MemoryStore):
    """A bucket that cannot give back some keys."""

    def __init__(self) -> None:
        super().__init__()
        self.down: set[str] = set()

    async def get(self, key: str) -> bytes:
        if key in self.down:
            raise RawStorageError("reading a payload failed: InternalError")
        return await super().get(key)


async def test_imports_the_bucket_cannot_give_back_do_not_use_up_the_places_of_others(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = _SomeDown()
    stuck = [await _import(migrated, store, project, _csv("keyword\ncrm\n")) for _ in range(3)]
    fine = await _import(migrated, store, project, _csv("keyword\nerp\n"))
    store.down = {f"imports/v1/{project.workspace_id}/{import_id}/source" for import_id in stuck}

    report = await parse_next(worker_db, store, limit=1)

    # Three older imports wait for the bucket; the one behind them is still read.
    assert report == ParseReport(parsed=1, waiting=3)
    assert (await _row(migrated, fine))["status"] == "preview_ready"
    for import_id in stuck:
        assert (await _row(migrated, import_id))["status"] == "uploaded"


async def test_a_file_with_too_many_columns_fails_with_its_reason(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    header = ",".join(["keyword", *(f"c{n}" for n in range(150))])
    import_id = await _import(migrated, store, project, _csv(f"{header}\ncrm\n"))

    await parse_next(worker_db, store)

    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("failed", "too_many_columns")


async def test_an_import_that_always_breaks_while_writing_is_ended_and_the_next_is_written(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    broken = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))
    fine = await _confirmed(migrated, worker_db, store, project, _csv("keyword\nerp\n"))
    real = import_writer._write

    async def write(db: Any, imp: Any, project: Any, parts: Any) -> None:
        if imp.id == broken:
            raise ValueError("a value no keyword can hold")
        await real(db, imp, project, parts)

    monkeypatch.setattr(import_writer, "_write", write)

    report = await write_next(worker_db)

    assert report == WriteReport(batches=2, finished=2)
    ended = await _row(migrated, broken)
    assert (ended["status"], ended["error_code"]) == ("failed", "write_failed")
    assert (await _results(migrated, broken))[(1, 1)][0] is None
    assert (await _row(migrated, fine))["status"] == "completed"
    assert [t["text"] for t in await _tracked(migrated, project)] == ["erp"]


async def test_a_statement_the_database_refuses_ends_the_import_it_came_from(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A privilege the worker lacks fails the same way on every try: the import ends, and the
    imports behind it are written."""
    project = await _project(migrated)
    store = MemoryStore()
    refused = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))
    fine = await _confirmed(migrated, worker_db, store, project, _csv("keyword\nerp\n"))
    real = import_writer._write

    async def write(db: Any, imp: Any, project: Any, parts: Any) -> None:
        if imp.id == refused:
            await db.execute(text("DELETE FROM auth.users"))
        await real(db, imp, project, parts)

    monkeypatch.setattr(import_writer, "_write", write)

    report = await write_next(worker_db)

    assert report == WriteReport(batches=2, finished=2)
    ended = await _row(migrated, refused)
    assert (ended["status"], ended["error_code"]) == ("failed", "write_failed")
    assert (await _row(migrated, fine))["status"] == "completed"


async def test_a_project_deleted_while_a_batch_is_written_ends_the_import_with_nothing_kept(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))

    async def gone(*args: Any, **kwargs: Any) -> None:
        raise writer.ProjectGoneError(project.id)

    monkeypatch.setattr(writer, "write_tracked_keywords", gone)

    report = await write_next(worker_db)

    assert report == WriteReport(batches=1, finished=1)
    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("failed", "project_gone")
    assert (await _results(migrated, import_id))[(1, 1)][0] is None
