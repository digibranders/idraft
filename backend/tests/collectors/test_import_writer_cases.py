"""Cases found by the Part B review of the import writer."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import import_writer
from sightline.collectors.import_writer import WriteReport, write_next
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_import_writer import (
    _confirmed,
    _results,
    _terms,
    _tracked,
    _vocabulary,
    clean,  # noqa: F401  (an autouse fixture of that module)
)
from tests.collectors.test_imports import _csv, _project, _row
from tests.collectors.test_keyword_metrics import _track
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


async def test_a_deleted_keyword_with_two_terms_of_a_vocabulary_made_single_valued_keeps_the_first(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    topics = await _vocabulary(migrated, project, "topic", hierarchical=True)
    await _track(migrated, project, "crm", deleted=True)
    (old,) = await _tracked(migrated, project)
    for slug in ("alpha", "beta"):
        term = await fetchrow(
            migrated,
            "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            project.workspace_id,
            topics,
            slug,
            slug,
            slug,
        )
        await execute(
            migrated,
            "INSERT INTO seo.tracked_keyword_terms (tracked_keyword_id, term_id, workspace_id) "
            "VALUES ($1, $2, $3)",
            old["id"],
            term["id"],
            project.workspace_id,
        )
    # While the keyword was deleted, the vocabulary became single-valued.
    await execute(
        migrated,
        "UPDATE core.taxonomy_vocabularies SET is_single_valued = true WHERE id = $1",
        topics,
    )
    import_id = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))

    await write_next(worker_db)

    assert (await _results(migrated, import_id))[(1, 1)] == ("created", old["id"], None)
    assert (await _row(migrated, import_id))["status"] == "completed"
    assert await _terms(migrated, old["id"]) == [("topic", "alpha", "manual")]


async def test_a_repeat_in_a_later_batch_adds_its_tags_to_the_keyword_of_the_first_row(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    lines = ["crm\tfirst", *(f"filler {n}" for n in range(9)), "crm\textra|first"]
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        {"kind": "paste", "text": "\n".join(lines)},
        kind="paste",
        defaults={"tags_vocabulary_id": str(tags)},
    )

    # Five parts a batch: the first row is in the first batch, its repeat in the third.
    while not (await write_next(worker_db, batch_limit=1, batch_size=5)).quiet:
        pass

    (crm,) = [t for t in await _tracked(migrated, project) if t["text"] == "crm"]
    assert await _terms(migrated, crm["id"]) == [
        ("tag", "extra", "import"),
        ("tag", "first", "import"),
    ]
    assert (await _results(migrated, import_id))[(11, 1)] == ("skipped", crm["id"], None)
    made = await fetch(
        migrated, "SELECT name FROM core.taxonomy_terms WHERE vocabulary_id = $1", tags
    )
    assert sorted(row["name"] for row in made) == ["extra", "first"]


async def test_a_repeat_does_not_file_anything_under_a_keyword_deleted_since_its_batch(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    lines = ["crm\tfirst", *(f"filler {n}" for n in range(9)), "crm\textra"]
    await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        {"kind": "paste", "text": "\n".join(lines)},
        kind="paste",
        defaults={"tags_vocabulary_id": str(tags)},
    )
    await write_next(worker_db, batch_limit=1, batch_size=5)
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now(), is_active = false "
        "WHERE project_id = $1",
        project.id,
    )

    while not (await write_next(worker_db, batch_limit=1, batch_size=5)).quiet:
        pass

    (crm,) = [t for t in await _tracked(migrated, project) if t["text"] == "crm"]
    assert await _terms(migrated, crm["id"]) == [("tag", "first", "import")]


async def test_many_tags_over_many_rows_are_made_once_each(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    # 300 rows share 30 tags, and one tag differs only in case.
    lines = [f"keyword {n}\ttag {n % 30}|TAG 0" for n in range(300)]
    await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        {"kind": "paste", "text": "\n".join(lines)},
        kind="paste",
        defaults={"tags_vocabulary_id": str(tags)},
    )

    await write_next(worker_db)

    made = await fetch(
        migrated, "SELECT name FROM core.taxonomy_terms WHERE vocabulary_id = $1", tags
    )
    assert len(made) == 30
    held = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM seo.tracked_keyword_terms WHERE workspace_id = $1",
        project.workspace_id,
    )
    # Ten rows have `tag 0` of their own, which `TAG 0` repeats without regard to case: one
    # tag. The other 290 hold their own tag and `tag 0`.
    assert held["n"] == 10 + 290 * 2


async def test_an_import_another_worker_finished_is_not_ended_again(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))
    async with worker_db() as db, db.begin():
        claimed = await import_writer._claim(db)
    assert claimed is not None
    assert claimed.id == import_id
    # Another worker wrote it and finished it meanwhile.
    await write_next(worker_db)

    async with worker_db() as db, db.begin():
        await import_writer._end(db, claimed, "failed", error_code="write_failed")

    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("completed", None)
    assert WriteReport() == await write_next(worker_db)
    assert isinstance(import_id, uuid.UUID)
