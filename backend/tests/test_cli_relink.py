"""`link-prompt-keywords --relink`: generated links without a volume move to a better keyword."""

import asyncio
import uuid

import pytest

from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.keywords.support import LOCATION, ensure_locations
from tests.collectors.ai_support import add_prompt
from tests.collectors.support import Project, make_tenant
from tests.conftest import PostgresServer
from tests.test_cli import _run


async def _keyword(
    pg: PostgresServer, project: Project, text: str, *, volume: int | None, measured: bool = True
) -> uuid.UUID:
    """A keyword with a metrics row at the United States (a null volume is: measured, no data)."""
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $2, $2, 'en') RETURNING id",
        project.workspace_id,
        text,
    )
    if measured:
        snapshot = await fetchrow(
            pg,
            "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
            "language_code, source, fetched_at, search_volume, is_material_change) "
            "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', now(), $4, true) RETURNING id",
            project.workspace_id,
            keyword["id"],
            LOCATION,
            volume,
        )
        await execute(
            pg,
            "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
            "source, workspace_id, snapshot_id, search_volume, fetched_at) "
            "VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, $5, now())",
            keyword["id"],
            LOCATION,
            project.workspace_id,
            snapshot["id"],
            volume,
        )
    keyword_id: uuid.UUID = keyword["id"]
    return keyword_id


async def _link(
    pg: PostgresServer,
    project: Project,
    prompt: uuid.UUID,
    keyword: uuid.UUID,
    link_type: str,
    *,
    primary: bool = True,
) -> None:
    await execute(
        pg,
        "INSERT INTO core.keyword_prompt_links (workspace_id, project_id, keyword_id, prompt_id, "
        "link_type, is_primary, status) VALUES ($1, $2, $3, $4, $5, $6, 'active')",
        project.workspace_id,
        project.id,
        keyword,
        prompt,
        link_type,
        primary,
    )


def test_relink_replaces_generated_links_without_volume_and_removes_orphans(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    project = asyncio.run(make_tenant(migrated))
    texts = {
        "long": "Who are the best Managed SOC service providers in India?",
        "siem": "Best SIEM tools",
        "kept": "Managed SOC pricing",
        "manual": "Top managed soc service providers in India",
        "nodata": "Who is the best?",
    }

    async def seed() -> dict[str, uuid.UUID]:
        await ensure_locations(migrated)
        ids = {name: (await add_prompt(migrated, project, text)).id for name, text in texts.items()}
        measured = await _keyword(migrated, project, "managed soc", volume=500)
        await _link(migrated, project, ids["kept"], measured, "generated")
        long = await _keyword(migrated, project, "managed soc service providers india", volume=None)
        await _link(migrated, project, ids["long"], long, "generated")
        siem = await _keyword(migrated, project, "best siem tools", volume=None, measured=False)
        await _link(migrated, project, ids["siem"], siem, "generated")
        mine = await _keyword(migrated, project, "my own phrase", volume=None)
        await _link(migrated, project, ids["manual"], mine, "manual")
        await _link(migrated, project, ids["nodata"], mine, "generated")
        return {**ids, "long_keyword": long, "siem_keyword": siem, "mine": mine}

    ids = asyncio.run(seed())
    arguments = [
        "link-prompt-keywords",
        "--relink",
        "--queue-metrics",
        "--project",
        str(project.id),
    ]

    code, out, err = _run(monkeypatch, capsys, arguments, database_url=migrated.url("migrator"))

    assert (code, err) == (0, "")
    report = dict(line.split(": ") for line in out.splitlines())
    # long, siem and nodata have a generated link without a volume; "manual" has only a person's.
    assert report["relink_candidates"] == "3"
    assert (report["relinked"], report["relink_unchanged"], report["relink_skipped"]) == (
        "2",
        "0",
        "1",
    )
    assert report["orphan_keywords_deleted"] == "2"
    assert (report["runs_queued"], report["keywords_queued"]) == ("1", "1")
    links = asyncio.run(
        fetch(
            migrated,
            "SELECT l.prompt_id, k.normalized_text, l.link_type FROM core.keyword_prompt_links l "
            "JOIN seo.keywords k ON k.id = l.keyword_id WHERE l.project_id = $1",
            project.id,
        )
    )
    assert {(row["prompt_id"], row["normalized_text"], row["link_type"]) for row in links} == {
        (ids["long"], "managed soc", "generated"),
        (ids["siem"], "siem tools", "generated"),
        (ids["kept"], "managed soc", "generated"),
        (ids["manual"], "my own phrase", "manual"),
        (ids["nodata"], "my own phrase", "generated"),
    }
    left = asyncio.run(
        fetch(
            migrated,
            "SELECT id FROM seo.keywords WHERE id = ANY($1::uuid[])",
            [ids["long_keyword"], ids["siem_keyword"], ids["mine"]],
        )
    )
    assert [row["id"] for row in left] == [ids["mine"]]
    tracked = asyncio.run(
        fetch(migrated, "SELECT 1 FROM seo.tracked_keywords WHERE project_id = $1", project.id)
    )
    assert tracked == []

    code, out, err = _run(monkeypatch, capsys, arguments, database_url=migrated.url("migrator"))

    # Idempotent: the new phrase still waits for its metrics, so it stays; nothing else moves.
    report = dict(line.split(": ") for line in out.splitlines())
    assert (code, err) == (0, "")
    assert (report["relinked"], report["orphan_keywords_deleted"], report["linked"]) == (
        "0",
        "0",
        "0",
    )
    assert report["runs_queued"] == "0"


def test_relink_leaves_a_link_alone_when_the_prompt_also_has_a_person_link(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    project = asyncio.run(make_tenant(migrated))

    async def seed() -> uuid.UUID:
        await ensure_locations(migrated)
        prompt = (await add_prompt(migrated, project, "Best SIEM tools")).id
        generated = await _keyword(migrated, project, "best siem tools", volume=None)
        manual = await _keyword(migrated, project, "siem", volume=None)
        await _link(migrated, project, prompt, generated, "generated")
        await _link(migrated, project, prompt, manual, "manual", primary=False)
        return generated

    generated = asyncio.run(seed())

    code, out, err = _run(
        monkeypatch,
        capsys,
        ["link-prompt-keywords", "--relink", "--project", str(project.id)],
        database_url=migrated.url("migrator"),
    )

    report = dict(line.split(": ") for line in out.splitlines())
    assert (code, err, report["relink_candidates"]) == (0, "", "0")
    kept = asyncio.run(fetch(migrated, "SELECT 1 FROM seo.keywords WHERE id = $1", generated))
    assert len(kept) == 1
