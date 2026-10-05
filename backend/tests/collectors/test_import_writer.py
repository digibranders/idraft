"""The worker's side of keyword imports, part B (plan decisions D11 to D13; the imports
sub-plan, rule I8): writing a confirmed import in batches. As `app_worker`; previews are made by
`parse_next`, and confirming is what the API does, written here as the SQL it comes to."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.import_writer import WriteReport, write_next
from sightline.collectors.imports import parse_next
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.keywords.support import LOCATION, OTHER_LOCATION
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_imports import _csv, _import, _project, _row, _rows
from tests.collectors.test_keyword_metrics import _track
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def clean(migrated: PostgresServer) -> AsyncIterator[None]:
    """The worker claims any import in the database, and other tests count keywords in all of
    it: each test starts without imports and leaves no tracked keywords behind."""
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    yield
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    await execute(migrated, "DELETE FROM seo.tracked_keywords")


async def _vocabulary(
    pg: PostgresServer,
    project: Project,
    kind: str,
    *,
    hierarchical: bool = False,
    single: bool = False,
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical, "
        "is_single_valued) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        project.workspace_id,
        kind,
        f"{kind} {uuid.uuid4().hex[:6]}",
        hierarchical,
        single,
    )
    found: uuid.UUID = row["id"]
    return found


async def _confirmed(
    pg: PostgresServer,
    worker_db: Ledger,
    store: MemoryStore,
    project: Project,
    source: dict[str, object],
    *,
    kind: str = "upload",
    defaults: dict[str, object] | None = None,
    actions: dict[str, str] | None = None,
) -> uuid.UUID:
    """An import read into its preview and then confirmed. `actions` sets the action of rows
    by SQL condition on the row (for example `outcome = 'conflict'`)."""
    import_id = await _import(pg, store, project, source, kind=kind, defaults=defaults)
    await parse_next(worker_db, store)
    for condition, action in (actions or {}).items():
        await execute(
            pg,
            f"UPDATE seo.keyword_import_rows SET action = $2 WHERE import_id = $1 AND {condition}",
            import_id,
            action,
        )
    await execute(
        pg,
        "UPDATE seo.keyword_imports SET status = 'writing', duplicate_action = 'skip' "
        "WHERE id = $1",
        import_id,
    )
    return import_id


async def _results(
    pg: PostgresServer, import_id: uuid.UUID
) -> dict[tuple[int, int], tuple[Any, ...]]:
    return {
        (row["row_no"], row["part"]): (
            row["result"],
            row["tracked_keyword_id"],
            row["write_error_code"],
        )
        for row in await _rows(pg, import_id)
    }


async def _tracked(pg: PostgresServer, project: Project) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT t.*, k.text FROM seo.tracked_keywords t JOIN seo.keywords k ON k.id = t.keyword_id "
        "WHERE t.project_id = $1 ORDER BY k.text, t.device",
        project.id,
    )
    return [dict(row) for row in rows]


async def _groups(pg: PostgresServer, tracked_id: uuid.UUID) -> list[str]:
    rows = await fetch(
        pg,
        "SELECT g.path FROM seo.keyword_group_members m JOIN seo.keyword_groups g "
        "ON g.id = m.group_id WHERE m.tracked_keyword_id = $1 ORDER BY g.path",
        tracked_id,
    )
    return [row["path"] for row in rows]


async def _terms(pg: PostgresServer, tracked_id: uuid.UUID) -> list[tuple[str, str, str]]:
    rows = await fetch(
        pg,
        "SELECT v.kind, t.name, l.assigned_by FROM seo.tracked_keyword_terms l "
        "JOIN core.taxonomy_terms t ON t.id = l.term_id "
        "JOIN core.taxonomy_vocabularies v ON v.id = t.vocabulary_id "
        "WHERE l.tracked_keyword_id = $1 ORDER BY v.kind, lower(t.name)",
        tracked_id,
    )
    return [(row["kind"], row["name"], row["assigned_by"]) for row in rows]


async def test_new_rows_become_tracked_keywords_with_their_fields_and_links(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    topics = await _vocabulary(migrated, project, "topic", hierarchical=True)
    source = _csv(
        "keyword,device,priority,intent,funnel_stage,target_url,group,tags,topic\n"
        "crm software,,2,commercial,bofu,https://example.com/crm?utm_source=x,Product/Pricing,"
        "b2b|SaaS,CRM/Startups\n"
        "erp,both,,,,,,,\n"
    )
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        source,
        defaults={"tags_vocabulary_id": str(tags), "topic_vocabulary_id": str(topics)},
    )

    report = await write_next(worker_db)

    assert report == WriteReport(batches=1, finished=1)
    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("completed", None)
    assert imported["finished_at"] is not None
    assert json.loads(imported["counts"])["created"] == 3
    assert json.loads(imported["counts"])["rows_total"] == 3
    tracked = await _tracked(migrated, project)
    assert [(t["text"], t["device"]) for t in tracked] == [
        ("crm software", "desktop"),
        ("erp", "desktop"),
        ("erp", "mobile"),
    ]
    crm = tracked[0]
    assert (crm["source"], crm["priority"], crm["intent"], crm["intent_source"]) == (
        "csv_import",
        2,
        "commercial",
        "manual",
    )
    assert crm["funnel_stage"] == "bofu"
    assert crm["location_id"] == LOCATION
    assert crm["is_active"] is True
    target = await fetchrow(
        migrated, "SELECT canonical_url FROM core.urls WHERE id = $1", crm["target_url_id"]
    )
    assert "example.com/crm" in target["canonical_url"]
    assert "utm_source" not in target["canonical_url"]
    assert await _groups(migrated, crm["id"]) == ["Product/Pricing"]
    assert await _terms(migrated, crm["id"]) == [
        ("tag", "b2b", "import"),
        ("tag", "SaaS", "import"),
        ("topic", "Startups", "import"),
    ]
    # The plain row has none of them.
    assert await _groups(migrated, tracked[1]["id"]) == []
    assert await _terms(migrated, tracked[1]["id"]) == []
    results = await _results(migrated, import_id)
    assert {key: value[0] for key, value in results.items()} == {
        (1, 1): "created",
        (2, 1): "created",
        (2, 2): "created",
    }
    assert results[(1, 1)][1] == crm["id"]
    # Terms are made along the topic's path, under the vocabulary, with `import` as the source.
    made = await fetch(
        migrated,
        "SELECT name, source, path FROM core.taxonomy_terms WHERE vocabulary_id = $1 ORDER BY path",
        topics,
    )
    assert [(m["name"], m["source"], m["path"]) for m in made] == [
        ("CRM", "import", "crm"),
        ("Startups", "import", "crm/startups"),
    ]


async def test_a_paste_and_api_rows_record_their_own_source(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        {"kind": "paste", "text": "crm\tb2b\n"},
        kind="paste",
        defaults={"tags_vocabulary_id": str(tags)},
    )
    await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        {"kind": "api", "rows": [{"keyword": "erp"}]},
        kind="api",
    )

    await write_next(worker_db)

    tracked = await _tracked(migrated, project)
    assert [(t["text"], t["source"]) for t in tracked] == [("crm", "bulk_paste"), ("erp", "api")]
    assert await _terms(migrated, tracked[0]["id"]) == [("tag", "b2b", "import")]


async def test_a_casing_variant_is_tracked_under_the_stored_keyword(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    keyword_id = await _track(migrated, project, "crm software", location=OTHER_LOCATION)
    await _confirmed(migrated, worker_db, store, project, _csv("keyword\nCRM Software\n"))

    await write_next(worker_db)

    tracked = await _tracked(migrated, project)
    assert sorted((t["location_id"], t["keyword_id"]) for t in tracked) == sorted(
        [(LOCATION, keyword_id), (OTHER_LOCATION, keyword_id)]
    )
    assert {t["text"] for t in tracked} == {"crm software"}


async def test_a_deleted_keyword_comes_back_with_its_stored_settings(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    await _track(migrated, project, "crm", deleted=True)
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET priority = 5, is_active = false WHERE project_id = $1",
        project.id,
    )
    (before,) = await _tracked(migrated, project)
    import_id = await _confirmed(
        migrated, worker_db, store, project, _csv("keyword,priority\ncrm,1\n")
    )

    await write_next(worker_db)

    (after,) = await _tracked(migrated, project)
    assert after["id"] == before["id"]
    assert (after["deleted_at"], after["is_active"], after["priority"]) == (None, True, 5)
    assert (await _results(migrated, import_id))[(1, 1)][:2] == ("created", before["id"])


async def test_a_big_import_is_written_in_batches_and_resumes(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    lines = "\n".join(f"keyword number {n}" for n in range(2500))
    import_id = await _confirmed(
        migrated, worker_db, store, project, {"kind": "paste", "text": lines}, kind="paste"
    )

    first = await write_next(worker_db, batch_limit=1)
    second = await write_next(worker_db, batch_limit=1)
    in_between = await _row(migrated, import_id)
    written = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM seo.keyword_import_rows WHERE import_id = $1 "
        "AND result IS NOT NULL",
        import_id,
    )
    third = await write_next(worker_db, batch_limit=1)

    assert (first, second, third) == (
        WriteReport(batches=1, finished=0),
        WriteReport(batches=1, finished=0),
        WriteReport(batches=1, finished=1),
    )
    assert in_between["status"] == "writing"
    assert written["n"] == 2000
    imported = await _row(migrated, import_id)
    assert imported["status"] == "completed"
    assert json.loads(imported["counts"])["created"] == 2500
    assert len(await _tracked(migrated, project)) == 2500
    assert await write_next(worker_db) == WriteReport()


async def test_merging_files_a_duplicate_and_brings_back_an_archived_keyword(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    topics = await _vocabulary(migrated, project, "topic", hierarchical=True, single=True)
    await _track(migrated, project, "crm")
    await _track(migrated, project, "erp", active=False)
    (crm, erp) = await _tracked(migrated, project)
    # The tracked keyword has a group and a term of the single-valued vocabulary already.
    old_group = await fetchrow(
        migrated,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, 'Old', 'Old') RETURNING id",
        project.workspace_id,
        project.id,
    )
    await execute(
        migrated,
        "INSERT INTO seo.keyword_group_members (workspace_id, project_id, group_id, "
        "tracked_keyword_id) VALUES ($1, $2, $3, $4)",
        project.workspace_id,
        project.id,
        old_group["id"],
        crm["id"],
    )
    kept = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'Kept', 'kept', 'kept') RETURNING id",
        project.workspace_id,
        topics,
    )
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keyword_terms (tracked_keyword_id, term_id, workspace_id) "
        "VALUES ($1, $2, $3)",
        crm["id"],
        kept["id"],
        project.workspace_id,
    )
    source = _csv("keyword,group,tags,topic\ncrm,Product,first,Other\nerp,Product,,\ncrm,,extra,\n")
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        source,
        defaults={"tags_vocabulary_id": str(tags), "topic_vocabulary_id": str(topics)},
        actions={"reason_code IN ('tracked', 'archived')": "merge"},
    )

    await write_next(worker_db)

    results = await _results(migrated, import_id)
    assert results == {
        (1, 1): ("merged", crm["id"], None),
        (2, 1): ("merged", erp["id"], None),
        # The repeat in the file adds its tags to the keyword of its first row.
        (3, 1): ("skipped", crm["id"], None),
    }
    assert await _groups(migrated, crm["id"]) == ["Old", "Product"]
    assert await _terms(migrated, crm["id"]) == [
        ("tag", "extra", "import"),
        ("tag", "first", "import"),
        ("topic", "Kept", "manual"),
    ]
    assert await _groups(migrated, erp["id"]) == ["Product"]
    (revived,) = [t for t in await _tracked(migrated, project) if t["text"] == "erp"]
    assert revived["is_active"] is True
    imported = await _row(migrated, import_id)
    assert imported["status"] == "completed"
    assert json.loads(imported["counts"])["merged"] == 2
    assert json.loads(imported["counts"])["skipped"] == 1


async def test_a_batch_that_no_longer_fits_the_quota_is_not_written(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(migrated, worker_db, store, project, _csv("keyword\na\nb\nc\n"))
    # Something else filled the workspace between the confirm and the write.
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 2) "
        "ON CONFLICT (workspace_id) DO UPDATE SET max_tracked_keywords = 2",
        project.workspace_id,
    )

    await write_next(worker_db)

    assert await _tracked(migrated, project) == []
    results = await _results(migrated, import_id)
    assert set(results.values()) == {("failed", None, "quota_exceeded")}
    imported = await _row(migrated, import_id)
    assert imported["status"] == "completed_with_errors"


async def test_an_archived_keyword_is_not_brought_back_over_the_quota(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    await _track(migrated, project, "kept")
    await _track(migrated, project, "old", active=False)
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        _csv("keyword\nold\n"),
        actions={"outcome = 'conflict'": "merge"},
    )
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 1) "
        "ON CONFLICT (workspace_id) DO UPDATE SET max_tracked_keywords = 1",
        project.workspace_id,
    )

    await write_next(worker_db)

    assert (await _results(migrated, import_id))[(1, 1)] == ("failed", None, "quota_exceeded")
    (old,) = [t for t in await _tracked(migrated, project) if t["text"] == "old"]
    assert old["is_active"] is False
    assert (await _row(migrated, import_id))["status"] == "completed_with_errors"


async def test_a_keyword_tracked_since_the_preview_is_skipped_with_its_id(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))
    await _track(migrated, project, "crm")
    (tracked,) = await _tracked(migrated, project)

    await write_next(worker_db)

    assert (await _results(migrated, import_id))[(1, 1)] == ("skipped", tracked["id"], None)
    assert len(await _tracked(migrated, project)) == 1
    assert (await _row(migrated, import_id))["status"] == "completed"


async def test_a_merge_target_deleted_since_the_preview_fails_its_row(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    await _track(migrated, project, "crm")
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        _csv("keyword\ncrm\nerp\n"),
        actions={"outcome = 'duplicate'": "merge"},
    )
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now(), is_active = false "
        "WHERE project_id = $1",
        project.id,
    )

    await write_next(worker_db)

    results = await _results(migrated, import_id)
    assert results[(1, 1)] == ("failed", None, "tracked_keyword_gone")
    assert results[(2, 1)][0] == "created"
    assert (await _row(migrated, import_id))["status"] == "completed_with_errors"


async def test_a_project_deleted_since_the_confirm_ends_the_import(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(migrated, worker_db, store, project, _csv("keyword\ncrm\n"))
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project.id)

    report = await write_next(worker_db)

    assert report == WriteReport(batches=1, finished=1)
    imported = await _row(migrated, import_id)
    assert (imported["status"], imported["error_code"]) == ("failed", "project_gone")
    assert imported["finished_at"] is not None
    assert (await _results(migrated, import_id))[(1, 1)][0] is None
    assert await _tracked(migrated, project) == []


async def test_a_row_that_no_longer_reads_is_failed_and_the_others_are_written(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        _csv(f"keyword,location\ncrm,{LOCATION}\nerp,{OTHER_LOCATION}\n"),
    )
    await execute(
        migrated, "UPDATE core.locations SET is_active = false WHERE id = $1", OTHER_LOCATION
    )
    try:
        await write_next(worker_db)
    finally:
        await execute(
            migrated, "UPDATE core.locations SET is_active = true WHERE id = $1", OTHER_LOCATION
        )

    results = await _results(migrated, import_id)
    assert results[(1, 1)][0] == "created"
    assert results[(2, 1)] == ("failed", None, "location_unknown")
    assert (await _row(migrated, import_id))["status"] == "completed_with_errors"


async def test_two_workers_write_each_row_once(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    lines = "\n".join(f"keyword number {n}" for n in range(60))
    import_id = await _confirmed(
        migrated, worker_db, store, project, {"kind": "paste", "text": lines}, kind="paste"
    )

    await asyncio.gather(
        write_next(worker_db, batch_limit=10, batch_size=10),
        write_next(worker_db, batch_limit=10, batch_size=10),
    )
    while not (await write_next(worker_db, batch_size=10)).quiet:
        pass

    tracked = await _tracked(migrated, project)
    assert len(tracked) == 60
    results = await _results(migrated, import_id)
    assert len(results) == 60
    assert {value[0] for value in results.values()} == {"created"}
    assert len({value[1] for value in results.values()}) == 60
    assert (await _row(migrated, import_id))["status"] == "completed"


async def test_terms_of_a_vocabulary_deleted_since_the_preview_are_left_out(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    tags = await _vocabulary(migrated, project, "tag")
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        _csv("keyword,tags\ncrm,b2b\n"),
        defaults={"tags_vocabulary_id": str(tags)},
    )
    await execute(migrated, "DELETE FROM core.taxonomy_vocabularies WHERE id = $1", tags)

    await write_next(worker_db)

    (tracked,) = await _tracked(migrated, project)
    assert await _terms(migrated, tracked["id"]) == []
    assert (await _results(migrated, import_id))[(1, 1)][0] == "created"
    assert (await _row(migrated, import_id))["status"] == "completed"


async def test_a_topic_of_several_names_does_not_fit_a_flat_vocabulary(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    flat = await _vocabulary(migrated, project, "topic")
    await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        _csv("keyword,topic\ncrm,CRM/Startups\nerp,Finance\n"),
        defaults={"topic_vocabulary_id": str(flat)},
    )

    await write_next(worker_db)

    crm, erp = await _tracked(migrated, project)
    assert await _terms(migrated, crm["id"]) == []
    assert await _terms(migrated, erp["id"]) == [("topic", "Finance", "import")]


async def test_only_skipped_rows_end_the_import_with_nothing_written(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await _project(migrated)
    store = MemoryStore()
    import_id = await _confirmed(
        migrated,
        worker_db,
        store,
        project,
        _csv("keyword\ncrm\nsite:x.com\n"),
        actions={"outcome = 'new'": "skip"},
    )

    await write_next(worker_db)

    assert {v[0] for v in (await _results(migrated, import_id)).values()} == {"skipped"}
    assert await _tracked(migrated, project) == []
    imported = await _row(migrated, import_id)
    assert imported["status"] == "completed"
    assert json.loads(imported["counts"])["skipped"] == 2
