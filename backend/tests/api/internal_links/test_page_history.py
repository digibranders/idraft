"""GET internal-links/pages/{url_id}/history (page history design, spec 5): versions newest
first, first seen against where the kept history starts, unreadable pages, declared dates and
Google's last crawl."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.internal_links.page_history import (
    CheckRow,
    GoogleRow,
    HistoryRows,
    assemble_history,
)
from idraft.api.resources import Resources
from idraft.api.schemas.internal_links_history import VERSIONS_MAX
from idraft.crawl.page_history import Snapshot
from idraft.crawl.page_text import Heading
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

DAY0 = datetime(2026, 1, 1, tzinfo=UTC)


def _hash(label: str) -> bytes:
    return label.encode().ljust(16, b"\0")


def _snap(title: str, main: str, full: str | None = None, words: int = 100) -> Snapshot:
    return Snapshot(
        title, None, (Heading(2, "Intro"),), words, 5, 3, None, _hash(main), _hash(full or main)
    )


def _check(day: int, main: str, full: str, snapshot_id: int, **kw: Any) -> CheckRow:
    return CheckRow(
        run_id=uuid.uuid4(),
        date=DAY0 + timedelta(days=day),
        main_hash=_hash(main),
        full_hash=_hash(full),
        snapshot_id=snapshot_id,
        declared_at=kw.get("declared_at"),
        declared_source=kw.get("declared_source"),
        site_wide=kw.get("site_wide", False),
        declared_unreliable=kw.get("unreliable", False),
    )


def _rows(**kw: Any) -> HistoryRows:
    return HistoryRows(
        status=kw.get("status", 200),
        first_seen=DAY0,
        checks=kw["checks"],
        snapshots=kw["snapshots"],
        google=kw.get("google"),
    )


def test_assembly_lists_versions_newest_first_with_their_kinds() -> None:
    checks = [
        _check(1, "a", "a", 1),
        _check(2, "a", "a2", 1, site_wide=True),
        _check(3, "b", "b", 2),
        _check(4, "b", "c", 2, site_wide=True),
    ]
    history = assemble_history(
        _rows(checks=checks, snapshots={1: _snap("One", "a"), 2: _snap("Two", "b", "b")})
    )

    assert [v.kind for v in history.versions] == ["site_wide", "content", "site_wide", "first"]
    assert history.versions[1].changes[0].type == "title"
    assert history.versions[1].changes[0].after == "Two"
    assert (history.changes, history.last_change) == (1, DAY0 + timedelta(days=3))
    assert history.history_starts == DAY0 + timedelta(days=1)
    assert history.versions_capped is False


def test_a_site_wide_run_with_an_unchanged_page_shows_nothing() -> None:
    checks = [_check(1, "a", "a", 1), _check(2, "a", "a", 1, site_wide=True)]

    history = assemble_history(_rows(checks=checks, snapshots={1: _snap("One", "a")}))

    assert [v.kind for v in history.versions] == ["first"]


def test_declared_date_is_hidden_when_the_runs_dates_are_unreliable() -> None:
    declared = {"declared_at": DAY0, "declared_source": "json_ld"}
    checks = [_check(1, "a", "a", 1, **declared, unreliable=True)]
    shown = [_check(1, "a", "a", 1, **declared)]
    snaps = {1: _snap("One", "a")}

    hidden = assemble_history(_rows(checks=checks, snapshots=snaps))
    visible = assemble_history(_rows(checks=shown, snapshots=snaps))

    assert (hidden.declared, hidden.declared_unreliable) == (None, True)
    assert visible.declared is not None
    assert visible.declared.source == "json_ld"


def test_google_is_behind_when_its_crawl_is_older_than_the_last_change() -> None:
    checks = [_check(1, "a", "a", 1), _check(5, "b", "b", 2)]
    snaps = {1: _snap("One", "a"), 2: _snap("Two", "b")}

    behind = assemble_history(
        _rows(checks=checks, snapshots=snaps, google=GoogleRow(DAY0 + timedelta(days=2), "ok"))
    )
    current = assemble_history(
        _rows(checks=checks, snapshots=snaps, google=GoogleRow(DAY0 + timedelta(days=6), None))
    )
    unknown = assemble_history(_rows(checks=checks, snapshots=snaps, google=GoogleRow(None, None)))

    assert [h.google.behind for h in (behind, current, unknown) if h.google] == [True, False, False]
    assert unknown.tracked is True


@pytest.mark.parametrize(
    ("status", "readable", "why"),
    [(200, True, None), (301, False, "redirect"), (404, False, "error"), (None, False, "error")],
)
def test_only_a_200_page_is_readable(status: int | None, readable: bool, why: str | None) -> None:
    history = assemble_history(_rows(status=status, checks=[], snapshots={}))

    assert (history.readable, history.why, history.status) == (readable, why, status)
    assert history.history_starts is None
    assert history.last_change is None


def test_versions_are_capped_at_the_newest_hundred() -> None:
    checks = [_check(day, f"h{day}", f"h{day}", day + 1) for day in range(VERSIONS_MAX + 5)]
    snaps = {day + 1: _snap(f"T{day}", f"h{day}") for day in range(VERSIONS_MAX + 5)}

    history = assemble_history(_rows(checks=checks, snapshots=snaps))

    assert len(history.versions) == VERSIONS_MAX
    assert history.versions_capped is True
    assert history.changes == VERSIONS_MAX + 4
    assert history.versions[0].date == DAY0 + timedelta(days=VERSIONS_MAX + 4)


async def _crawl(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    day: int,
    pages: list[tuple[str, int]],
) -> tuple[uuid.UUID, dict[str, int]]:
    run_id, ids = await seed_crawl(pg, workspace, project, pages)
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET created_at = $2, crawled_at = $2 WHERE id = $1",
        run_id,
        DAY0 + timedelta(days=day),
    )
    return run_id, ids


async def _check_row(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    run_id: uuid.UUID,
    url: int,
    *,
    main: str,
    full: str,
    title: str | None = None,
    reuse: int | None = None,
    site_wide: bool = False,
    unreliable: bool = False,
    declared: datetime | None = None,
) -> int | None:
    """Like ingest: a changed page gets a snapshot, an unchanged one points at `reuse`, the
    snapshot of its last change."""
    snapshot = reuse
    if title is not None:
        row = await fetchrow(
            pg,
            "INSERT INTO seo.page_snapshots (workspace_id, project_id, url_id, run_id, taken_at, "
            "title, words, links_all, links_editorial, main_hash, full_hash) "
            "VALUES ($1, $2, $3, $4, now(), $5, 100, 5, 3, $6, $7) RETURNING id",
            workspace.id, project, url, run_id, title, _hash(main), _hash(full),
        )  # fmt: skip
        snapshot = row["id"]
    await execute(
        pg,
        "INSERT INTO seo.page_checks (run_id, url_id, workspace_id, project_id, main_hash, "
        "full_hash, declared_at, declared_source, snapshot_id) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        run_id, url, workspace.id, project, _hash(main), _hash(full), declared,
        "json_ld" if declared else None, snapshot,
    )  # fmt: skip
    await execute(
        pg,
        "INSERT INTO seo.page_history_runs (run_id, workspace_id, pages_checked, "
        "pages_main_changed, pages_site_wide, site_wide, declared_unreliable) "
        "VALUES ($1, $2, 1, 1, 0, $3, $4) ON CONFLICT (run_id) DO NOTHING",
        run_id, workspace.id, site_wide, unreliable,
    )  # fmt: skip
    return snapshot


async def test_the_history_of_a_page_over_three_crawls(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    pages = [("/", 200), ("/old", 301), ("/gone", 404)]
    # The first crawl predates the feature: no check, so history starts one crawl later.
    await _crawl(migrated, workspace, project, 0, pages)
    second, ids = await _crawl(migrated, workspace, project, 7, pages)
    third, _ = await _crawl(migrated, workspace, project, 14, pages)
    fourth, _ = await _crawl(migrated, workspace, project, 21, pages)
    fifth, _ = await _crawl(migrated, workspace, project, 28, pages)
    page = ids["/"]
    await _check_row(migrated, workspace, project, second, page, main="a", full="a", title="One")
    two = await _check_row(
        migrated, workspace, project, third, page, main="b", full="b", title="Two",
        declared=DAY0 + timedelta(days=13),
    )  # fmt: skip
    await _check_row(
        migrated, workspace, project, fourth, page, main="b", full="c", reuse=two, site_wide=True
    )
    await _check_row(migrated, workspace, project, fifth, page, main="b", full="c", reuse=two)
    base = project_url(workspace, project, "internal-links", "pages")

    body = (await api.get(f"{base}/{page}/history", headers=viewer.headers)).json()["data"]

    assert [(v["kind"], v["run_id"]) for v in body["versions"]] == [
        ("site_wide", str(fourth)),
        ("content", str(third)),
        ("first", str(second)),
    ]
    assert body["versions"][1]["changes"] == [
        {"type": "title", "level": None, "before": "One", "after": "Two", "delta": None}
    ]
    assert body["first_seen"].startswith("2026-01-01")
    assert body["history_starts"].startswith("2026-01-08")
    assert body["last_change"].startswith("2026-01-15")
    assert (body["changes"], body["readable"], body["why"]) == (1, True, None)
    # The newest check declares nothing, so there is no declared date to show.
    assert body["declared"] is None
    assert (body["google"], body["tracked"], body["versions_capped"]) == (None, False, False)

    old = (await api.get(f"{base}/{ids['/old']}/history", headers=viewer.headers)).json()["data"]
    gone = (await api.get(f"{base}/{ids['/gone']}/history", headers=viewer.headers)).json()["data"]
    assert (old["readable"], old["why"], old["status"]) == (False, "redirect", 301)
    assert (gone["readable"], gone["why"], gone["status"]) == (False, "error", 404)
    assert old["versions"] == []
    assert old["history_starts"] is None


async def test_the_newest_check_decides_declared_and_unreliable(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    declared = DAY0 + timedelta(days=3)
    first, ids = await _crawl(migrated, workspace, project, 1, [("/", 200)])
    latest, _ = await _crawl(migrated, workspace, project, 8, [("/", 200)])
    page = ids["/"]
    await _check_row(
        migrated,
        workspace,
        project,
        first,
        page,
        main="a",
        full="a",
        title="One",
        declared=declared,
    )
    await _check_row(
        migrated, workspace, project, latest, page, main="a", full="a", declared=declared
    )
    await execute(
        migrated,
        "INSERT INTO seo.page_google_crawl (project_id, url_id, workspace_id, last_crawl_time, "
        "coverage_state, inspected_at) VALUES ($1, $2, $3, $4, 'Submitted and indexed', now())",
        project, page, workspace.id, DAY0 + timedelta(days=9),
    )  # fmt: skip
    url = project_url(workspace, project, "internal-links", "pages", page, "history")

    shown = (await api.get(url, headers=viewer.headers)).json()["data"]
    await execute(
        migrated, "UPDATE seo.page_history_runs SET declared_unreliable = true WHERE run_id = $1",
        latest,
    )  # fmt: skip
    hidden = (await api.get(url, headers=viewer.headers)).json()["data"]

    assert shown["declared"]["source"] == "json_ld"
    assert shown["declared"]["date"].startswith("2026-01-04")
    assert (shown["declared_unreliable"], hidden["declared"], hidden["declared_unreliable"]) == (
        False, None, True,
    )  # fmt: skip
    assert shown["tracked"] is True
    assert shown["google"]["behind"] is False
    assert shown["google"]["coverage_state"] == "Submitted and indexed"


async def test_an_unknown_url_id_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await seed_crawl(migrated, workspace, project, [("/", 200)])

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages", 123456, "history"),
        headers=viewer.headers,
    )

    assert problem(response)[0] == 404


def test_a_content_check_without_its_snapshot_keeps_its_version() -> None:
    checks = [_check(1, "a", "a", 1), _check(2, "b", "b", 2)]

    history = assemble_history(_rows(checks=checks, snapshots={1: _snap("One", "a")}))

    assert [(v.kind, v.changes) for v in history.versions] == [("content", []), ("first", [])]
    assert history.changes == 1


async def test_checks_follow_run_ids_and_a_failed_crawl_is_not_first_seen(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    pages = [("/", 200)]
    failed, _ = await _crawl(migrated, workspace, project, 0, pages)
    await execute(migrated, "UPDATE seo.crawl_runs SET state = 'failed' WHERE id = $1", failed)
    # B is made after A (a later run id) but its crawl date is earlier.
    run_a, ids = await _crawl(migrated, workspace, project, 10, pages)
    run_b, _ = await _crawl(migrated, workspace, project, 11, pages)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET crawled_at = $2 WHERE id = $1",
        run_b,
        DAY0 + timedelta(days=5),
    )
    page = ids["/"]
    one = await _check_row(
        migrated, workspace, project, run_a, page, main="a", full="a", title="One"
    )
    await _check_row(migrated, workspace, project, run_b, page, main="b", full="b", title="Two")
    assert one is not None
    url = project_url(workspace, project, "internal-links", "pages", page, "history")

    body = (await api.get(url, headers=viewer.headers)).json()["data"]

    assert [(v["kind"], v["run_id"]) for v in body["versions"]] == [
        ("content", str(run_b)),
        ("first", str(run_a)),
    ]
    assert body["versions"][0]["date"].startswith("2026-01-06")
    assert body["first_seen"].startswith("2026-01-06")
