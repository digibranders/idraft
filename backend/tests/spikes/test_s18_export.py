"""S-18 export: the tool that saves what the internal links read API says about one project's
latest crawl. The tool builds the real application in this process, over the test database, the
test Redis and the test object store; nothing leaves the machine."""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from idraft.api.auth.sessions import SessionStore
from idraft.api.internal_links.reads import LinkReadService
from idraft.api.problems import NotFoundError
from idraft.collectors.crawl_ingest import html_key
from idraft.storage.raw import RawStore, compress, s3_client
from spikes.s18_export import RefusedError, check_out_dir, main
from tests.api.auth.support import (
    User,
    Workspace,
    add_member,
    fetch,
    make_user,
    make_workspace,
)
from tests.api.internal_links.support import READ_LINKS, READ_PAGES, read_site
from tests.api.keywords.support import keyword_project
from tests.conftest import (
    TEST_SECRETS_KEY,
    TEST_TOTP_KEY,
    ObjectServer,
    PostgresServer,
)

REPOSITORY = Path(__file__).resolve().parents[3]
PAGE_COUNT = len(READ_PAGES)
EDGE_COUNT = len(READ_LINKS)
NO_HTML = "/gone"
FILES = (
    "run.json",
    "runs.json",
    "tier-flow-all.json",
    "tier-flow-editorial.json",
    "worklists.json",
    "page-tiers.json",
    "tier-rules.json",
    "crawl_pages.json",
    "crawl_links_summary.json",
    "manifest.json",
)


@pytest.fixture
async def bucket(object_server: ObjectServer) -> str:
    name = f"raw-{uuid.uuid4().hex[:12]}"
    async with s3_client(
        endpoint=object_server.endpoint,
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
    ) as client:
        await client.create_bucket(Bucket=name)
    return name


@pytest.fixture(autouse=True)
def environment(
    monkeypatch: pytest.MonkeyPatch,
    migrated: PostgresServer,
    redis_url: str,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    """The API's environment, as `uv run --env-file` would give it, on a local origin."""
    values = {
        "PROCESS_ROLE": "api",
        "APP_ENV": "local",
        "APP_ORIGIN": "http://localhost:3000",
        "DATABASE_URL": migrated.url("app_api"),
        "REDIS_URL": redis_url,
        "TOTP_ENCRYPTION_KEY": TEST_TOTP_KEY.get_secret_value(),
        "SECRETS_ENCRYPTION_KEY": TEST_SECRETS_KEY.get_secret_value(),
        "BREACHED_PASSWORD_CHECK": "false",
        "LOG_LEVEL": "critical",
        "DB_POOL_SIZE": "4",
        "R2_RAW_ENDPOINT": object_server.endpoint,
        "R2_RAW_BUCKET": bucket,
        "R2_RAW_ACCESS_KEY_ID": object_server.access_key_id,
        "R2_RAW_SECRET_ACCESS_KEY": object_server.secret_access_key,
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
def secrets(object_server: ObjectServer) -> list[str]:
    """Values that must never reach a file or the output."""
    return [
        "api-pw",
        object_server.secret_access_key,
        TEST_TOTP_KEY.get_secret_value(),
        TEST_SECRETS_KEY.get_secret_value(),
        "__Host-session",
    ]


@pytest.fixture
def tokens(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The cookie value of every session the tool makes."""
    seen: list[str] = []
    original = SessionStore.create

    async def spy(self: SessionStore, db: Any, **given: Any) -> Any:
        token, context = await original(self, db, **given)
        seen.append(token)
        return token, context

    monkeypatch.setattr(SessionStore, "create", spy)
    return seen


@dataclass(frozen=True)
class Site:
    workspace: Workspace
    project: uuid.UUID
    run_id: uuid.UUID
    ids: dict[str, int]
    members: list[User]
    html: dict[str, bytes]


async def make_site(
    pg: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    *,
    roles: Sequence[str] = ("owner",),
) -> Site:
    """A finished crawl of 7 pages and 10 links, a member for each role, and the raw HTML of
    every page but one."""
    workspace = await make_workspace(pg)
    members = []
    for role in roles:
        user = await make_user(pg)
        await add_member(pg, workspace, user, role)
        members.append(user)
    project = await keyword_project(pg, workspace)
    run_id, ids, _ = await read_site(pg, workspace, project)
    rows = await fetch(
        pg, "SELECT id, url_hash FROM core.urls WHERE id = ANY($1)", list(ids.values())
    )
    hashes = {row["id"]: bytes(row["url_hash"]) for row in rows}
    html = {
        path: f"<html><body>{path} café</body></html>\n".encode() for path in ids if path != NO_HTML
    }
    async with s3_client(
        endpoint=object_server.endpoint,
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
    ) as client:
        store = RawStore(client, bucket)
        for path, body in html.items():
            await store.put(html_key(project, hashes[ids[path]]), compress(body))
    return Site(workspace, project, run_id, ids, members, html)


async def export(
    capsys: pytest.CaptureFixture[str],
    site: Site,
    out: Path,
    *extra: str,
    with_workspace: bool = True,
) -> tuple[int, str]:
    argv = ["--project", str(site.project), "--out", str(out)]
    if with_workspace:
        argv += ["--workspace", str(site.workspace.id)]
    code = await main([*argv, *extra])
    captured = capsys.readouterr()
    return code, captured.out + captured.err


def names(folder: Path) -> list[str]:
    return sorted(file.name for file in folder.iterdir())


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


async def sessions_of(pg: PostgresServer, users: Sequence[User]) -> list[Any]:
    return await fetch(
        pg,
        "SELECT user_id, revoked_at FROM auth.sessions WHERE user_id = ANY($1)",
        [user.id for user in users],
    )


# What is exported


async def test_every_response_is_saved_in_full_across_cursor_pages(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out, "--page-size", "2")

    assert code == 0, text
    for name in FILES:
        assert (out / name).is_file(), name
    run = load(out / "run.json")["data"]
    assert (run["run_id"], run["is_latest"], run["state"]) == (str(site.run_id), True, "ready")
    assert [row["run_id"] for row in load(out / "runs.json")["data"]] == [str(site.run_id)]

    page_files = sorted((out / "pages").iterdir())
    assert [file.name for file in page_files] == [f"page-{n:04d}.json" for n in range(1, 5)]
    bodies = [load(file) for file in page_files]
    assert [len(body["data"]) for body in bodies] == [2, 2, 2, 1]
    assert [body["page"]["has_more"] for body in bodies] == [True, True, True, False]
    assert {body["meta"]["scope"] for body in bodies} == {"all"}
    rows = [row for body in bodies for row in body["data"]]
    assert sorted(row["path"] for row in rows) == sorted(path for path, _ in READ_PAGES)
    assert len({row["url_id"] for row in rows}) == PAGE_COUNT

    edge_files = sorted((out / "edges").iterdir())
    assert [file.name for file in edge_files] == [f"edges-{n:04d}.json" for n in range(1, 6)]
    edge_bodies = [load(file) for file in edge_files]
    assert sum(len(body["data"]) for body in edge_bodies) == EDGE_COUNT
    assert edge_bodies[0]["meta"]["total"] == EDGE_COUNT

    assert (
        load(out / "tier-flow-all.json")["data"] != load(out / "tier-flow-editorial.json")["data"]
    )
    assert load(out / "worklists.json")["data"]
    assert len(load(out / "page-tiers.json")["data"]) == 4
    assert load(out / "tier-rules.json")["data"] == []


async def test_a_page_detail_file_matches_each_page(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out, "--page-size", "2")

    assert code == 0, text
    rows = {row["url_id"]: row for file in (out / "pages").iterdir() for row in load(file)["data"]}
    details = {file.stem: load(file)["data"] for file in (out / "page-detail").iterdir()}
    assert set(details) == set(rows)
    for url_id, detail in details.items():
        assert detail["page"]["url_id"] == url_id
        assert detail["page"]["path"] == rows[url_id]["path"]
        assert detail["page"]["linking_pages"] == rows[url_id]["linking_pages"]


async def test_the_raw_html_is_saved_exactly_and_a_missing_object_is_listed(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out)

    assert code == 0, text
    saved = {file.stem: file.read_bytes() for file in (out / "html").iterdir()}
    assert saved == {str(site.ids[path]): body for path, body in site.html.items()}
    manifest = load(out / "manifest.json")
    (missing,) = manifest["missing_html"]
    assert (missing["url_id"], missing["path"]) == (str(site.ids[NO_HTML]), NO_HTML)
    assert manifest["counts"]["html"] == PAGE_COUNT - 1


async def test_the_stored_rows_are_saved_as_plain_json(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out)

    assert code == 0, text
    pages = load(out / "crawl_pages.json")
    assert len(pages) == PAGE_COUNT
    by_path = {row["path"]: row for row in pages}
    assert by_path["/pricing"]["url"] == "https://example.com/pricing"
    assert by_path["/pricing"]["status_code"] == 200
    assert by_path["/pricing"]["run_id"] == str(site.run_id)
    assert by_path["/old"]["status_code"] == 301
    assert by_path["/old"]["redirect_url_id"] == site.ids["/pricing"]
    summary = load(out / "crawl_links_summary.json")
    assert sum(group["links"] for group in summary) == EDGE_COUNT
    assert {"placement", "scope", "kind", "is_followed", "links"} == set(summary[0])
    assert {"navigation", "content", "auto_generated"} == {group["placement"] for group in summary}


async def test_the_manifest_says_what_was_exported(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out, "--page-size", "2")

    assert code == 0, text
    manifest = load(out / "manifest.json")
    assert manifest["project_id"] == str(site.project)
    assert manifest["workspace_id"] == str(site.workspace.id)
    assert manifest["run_id"] == str(site.run_id)
    assert manifest["exported_at"].endswith("Z")
    assert manifest["counts"] == {
        "runs": 1,
        "pages": PAGE_COUNT,
        "page_files": 4,
        "edges": EDGE_COUNT,
        "edge_files": 5,
        "page_detail": PAGE_COUNT,
        "html": PAGE_COUNT - 1,
        "page_tiers": 4,
        "tier_rules": 0,
        "crawl_pages": PAGE_COUNT,
        "crawl_links": EDGE_COUNT,
    }
    assert manifest["failures"] == []
    assert manifest["html_skipped"] is None
    pages_path = "/internal-links/pages?scope=all&limit=2&sort=path"
    assert any(path.endswith(pages_path) for path in manifest["api_paths"])
    assert {
        "run",
        "runs",
        "pages",
        "edges",
        "page_detail",
        "html",
        "crawl_pages",
        "crawl_links_summary",
    } <= set(manifest["shapes"])
    assert "pages=7" in text


async def test_without_object_storage_the_html_is_skipped_and_the_manifest_says_so(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    for name in ("R2_RAW_ENDPOINT", "R2_RAW_ACCESS_KEY_ID", "R2_RAW_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(name)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out)

    assert code == 0, text
    manifest = load(out / "manifest.json")
    assert "R2_RAW" in manifest["html_skipped"]
    assert manifest["counts"]["html"] == 0
    assert not (out / "html").exists() or not any((out / "html").iterdir())


# Secrets and the session


async def test_no_secret_reaches_a_file_or_the_output(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    secrets: list[str],
    tokens: list[str],
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out)

    assert code == 0, text
    assert len(tokens) == 1
    written = [text] + [
        file.read_bytes().decode("utf-8", errors="ignore")
        for file in out.rglob("*")
        if file.is_file()
    ]
    for value in [*secrets, *tokens]:
        assert not any(value in part for part in written), value


async def test_the_session_is_revoked_afterwards(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)

    code, text = await export(capsys, site, tmp_path / "export")

    assert code == 0, text
    (session,) = await sessions_of(migrated, site.members)
    assert session["revoked_at"] is not None
    assert "session revoked" in text


async def test_the_session_is_revoked_when_the_export_stops_early(
    migrated: PostgresServer,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    """A project with no crawl: nothing to export."""
    workspace = await make_workspace(migrated)
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")
    project = await keyword_project(migrated, workspace)

    code = await main(
        [
            "--project",
            str(project),
            "--workspace",
            str(workspace.id),
            "--out",
            str(tmp_path / "export"),
        ]
    )

    assert code == 2
    assert "no crawl" in capsys.readouterr().out
    (session,) = await sessions_of(migrated, [owner])
    assert session["revoked_at"] is not None


# Who acts


async def test_the_oldest_owner_acts_even_when_an_admin_is_older(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(
        migrated, object_server, bucket, roles=("admin", "owner", "owner", "viewer")
    )
    admin, first_owner, second_owner, viewer = site.members

    code, text = await export(capsys, site, tmp_path / "export")

    assert code == 0, text
    assert f"acting as owner {first_owner.id}" in text
    assert [str(other.id) for other in (admin, second_owner, viewer) if str(other.id) in text] == []
    assert len(await sessions_of(migrated, [first_owner])) == 1
    assert await sessions_of(migrated, [admin, second_owner, viewer]) == []


async def test_an_admin_acts_when_there_is_no_owner(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket, roles=("viewer", "admin"))

    code, text = await export(capsys, site, tmp_path / "export")

    assert code == 0, text
    assert f"acting as admin {site.members[1].id}" in text


async def test_a_workspace_without_an_owner_or_admin_is_refused(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket, roles=("editor",))

    code, text = await export(capsys, site, tmp_path / "export")

    assert code == 2
    assert "owner" in text
    assert await sessions_of(migrated, site.members) == []
    assert not (tmp_path / "export").exists()


# Refusals


async def test_a_run_that_is_not_local_is_refused_before_anything_is_made(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    monkeypatch.setenv("APP_ENV", "test")

    code, text = await export(capsys, site, tmp_path / "export")

    assert code == 2
    assert "APP_ENV" in text
    assert await sessions_of(migrated, site.members) == []
    assert not (tmp_path / "export").exists()


async def test_an_out_folder_in_the_repository_that_is_not_ignored_is_refused(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    site = await make_site(migrated, object_server, bucket)
    out = REPOSITORY / "backend" / "spikes" / f"not-ignored-{uuid.uuid4().hex[:8]}"

    code, text = await export(capsys, site, out)

    assert code == 2
    assert "not ignored" in text
    assert await sessions_of(migrated, site.members) == []
    assert not out.exists()


async def test_an_out_folder_that_is_not_empty_is_refused(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    (tmp_path / "old.json").write_text("{}", encoding="utf-8")

    code, text = await export(capsys, site, tmp_path)

    assert code == 2
    assert "not an empty folder" in text
    assert names(tmp_path) == ["old.json"]
    assert await sessions_of(migrated, site.members) == []


def test_the_out_folder_rule(tmp_path: Path) -> None:
    check_out_dir(REPOSITORY / "backend" / "spikes" / "raw" / "project-a")
    check_out_dir(tmp_path / "anywhere" / "deeper")
    for inside in (
        REPOSITORY,
        REPOSITORY / "docs" / "export",
        REPOSITORY / "backend" / "spikes" / "export",
    ):
        with pytest.raises(RefusedError, match="not ignored"):
            check_out_dir(inside)


async def test_an_unknown_project_is_refused(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)

    code = await main(
        [
            "--project",
            str(uuid.uuid4()),
            "--workspace",
            str(site.workspace.id),
            "--out",
            str(tmp_path / "export"),
        ]
    )

    assert code == 2
    assert "no project" in capsys.readouterr().out
    assert await sessions_of(migrated, site.members) == []


async def test_the_api_role_needs_the_workspace_to_see_a_project(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)

    code, text = await export(capsys, site, tmp_path / "export", with_workspace=False)

    assert code == 2
    assert "--workspace" in text
    assert await sessions_of(migrated, site.members) == []


async def test_the_workspace_must_own_the_project(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    site = await make_site(migrated, object_server, bucket)
    other = await make_workspace(migrated)

    code = await main(
        ["--project", str(site.project), "--workspace", str(other.id), "--out", str(tmp_path / "o")]
    )

    assert code == 2
    assert "no project" in capsys.readouterr().out


# A response that is not 2xx


async def test_a_failed_call_is_recorded_the_rest_is_exported_and_the_exit_is_non_zero(
    migrated: PostgresServer,
    object_server: ObjectServer,
    bucket: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    site = await make_site(migrated, object_server, bucket)

    async def refuse(self: LinkReadService, *args: Any, **given: Any) -> Any:
        raise NotFoundError("gone for this test")

    monkeypatch.setattr(LinkReadService, "worklists", refuse)
    out = tmp_path / "export"

    code, text = await export(capsys, site, out)

    assert code == 1, text
    assert not (out / "worklists.json").exists()
    assert (out / "tier-flow-all.json").is_file()
    assert len(list((out / "page-detail").iterdir())) == PAGE_COUNT
    manifest = load(out / "manifest.json")
    (failure,) = manifest["failures"]
    assert failure["path"].endswith("/internal-links/worklists")
    assert (failure["status"], failure["code"]) == (404, "not_found")
    assert "worklists" in text
    (session,) = await sessions_of(migrated, site.members)
    assert session["revoked_at"] is not None
