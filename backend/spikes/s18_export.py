"""S-18 export: what the internal links read API says about one project's latest crawl, saved as
JSON files, so a designer can build mock data from the real responses (internal link tracker).

    uv run --env-file <api env file> python spikes/s18_export.py \\
        --project <uuid> --workspace <uuid> --out backend/spikes/raw/<name>

It reads only the local database, the local object store and the API running in this process.
No provider is called. It builds the real application, signs in as the workspace's oldest owner
(an admin when there is none) with a session it makes the way sign-in does, calls the same routes
the web calls, and revokes that session when it is done. It writes to no crawl table.

It runs only with APP_ENV=local. `--out` must be a new or empty folder, and when it is inside
the repository it must be git-ignored (`backend/spikes/raw/` is). `--workspace` is needed with
the API's own database role: row-level security hides every project from a transaction that does
not name its workspace. A role that bypasses it (the worker's) finds the workspace itself, but
cannot make a session.

Layout of the folder:

    manifest.json               what was exported, counts, paths used, failures, missing HTML
    run.json, runs.json         the latest crawl, and the project's crawls
    pages/page-NNNN.json        one file per cursor page of the pages list (scope=all, by path)
    edges/edges-NNNN.json       one file per cursor page of the edges list (scope=all)
    page-detail/<url_id>.json   the inspector response of each page
    tier-flow-all.json, tier-flow-editorial.json, worklists.json
    page-tiers.json, tier-rules.json
    html/<url_id>.html          each page's raw HTML as ingest stored it
    crawl_pages.json            the stored seo.crawl_pages rows of the run, with url and path
    crawl_links_summary.json    stored link counts by placement, scope, kind and is_followed

Exit codes: 0 everything exported; 1 an API call was not 2xx (the rest is still exported) or
an error stopped the export; 2 a refusal or a bad argument.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import subprocess
import sys
from collections.abc import AsyncIterator, Mapping, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Final
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import FastAPI
from sqlalchemy import Uuid, any_, case, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.auth.dependencies import SESSION_COOKIE
from idraft.api.main import create_app
from idraft.api.resources import Resources
from idraft.collectors.crawl_ingest import html_key
from idraft.config.settings import Settings, load_settings
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_links, crawl_pages, memberships, projects, urls, users
from idraft.storage.raw import ObjectStore, RawStorageError, decompress, open_raw_store

Sessions = async_sessionmaker[AsyncSession]

EXIT_FAILED: Final = 1
EXIT_REFUSED: Final = 2
PAGE_SIZE_MAX: Final = 200
DETAIL_CONCURRENCY: Final = 8
GIT_TIMEOUT_SECONDS: Final = 20
HTTP_TIMEOUT_SECONDS: Final = 60.0
_PAGE_INFO = "page: {limit, next_cursor, has_more}"
SHAPES: Final = {
    "run": "run.json: one response body {data: the crawl run}.",
    "runs": f"runs.json: the first response body of the crawl list {{data: [run], {_PAGE_INFO}}}.",
    "pages": (
        f"pages/page-NNNN.json: one response body {{data: [page row], {_PAGE_INFO}, "
        "meta: {run_id, scope, total}}."
    ),
    "edges": (
        f"edges/edges-NNNN.json: one response body {{data: [edge row], {_PAGE_INFO}, "
        "meta: {run_id, scope, total}}."
    ),
    "page_detail": (
        "page-detail/<url_id>.json: one response body {data: {page, linking_by_tier, "
        "linking_by_placement, top_anchors, linking_pages, outlinks, linking_pages_total, "
        "outlinks_total}}."
    ),
    "tier_flow": "tier-flow-all.json and tier-flow-editorial.json: response bodies {data: flow}.",
    "worklists": "worklists.json: one response body {data: the counts of the saved worklists}.",
    "page_tiers": "page-tiers.json: one response body {data: [tier level]}, T1 first.",
    "tier_rules": "tier-rules.json: one response body {data: [rule]}, first rule first.",
    "html": "html/<url_id>.html: the raw HTML bytes ingest stored for that page.",
    "crawl_pages": (
        "crawl_pages.json: a list with one object per stored seo.crawl_pages row of the run, "
        "every column plus url and path from core.urls."
    ),
    "crawl_links_summary": (
        "crawl_links_summary.json: a list of {placement, scope, kind, is_followed, links}, "
        "one per group of stored seo.crawl_links rows."
    ),
}


class RefusedError(Exception):
    """A precondition does not hold. Nothing was exported."""


def say(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


# Where the files may go


def _git(folder: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", "-C", str(folder), *arguments],
            capture_output=True,
            text=True,
            check=False,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        raise RefusedError("git could not be run to check where --out is") from None


def check_out_dir(out: Path) -> None:
    """A folder inside a git repository must be ignored by it: real responses are not committed."""
    target = out.resolve()
    anchor = next(folder for folder in (target, *target.parents) if folder.is_dir())
    if _git(anchor, "rev-parse", "--show-toplevel").returncode != 0:
        return
    # A file inside the folder: a rule for a folder (`raw/`) matches through its parent.
    ignored = _git(anchor, "check-ignore", "-q", "--", str(target / "manifest.json"))
    if ignored.returncode == 1:
        raise RefusedError(f"--out {target} is inside the repository and is not ignored by git")
    if ignored.returncode != 0:
        raise RefusedError("git could not say whether --out is ignored")


def _check_empty(out: Path) -> None:
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise RefusedError(f"--out {out} exists and is not an empty folder")


# JSON files


def _encode(value: object) -> str:
    if isinstance(value, UUID | Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    raise TypeError(f"{type(value).__name__} is not plain JSON")


def _dump(body: object) -> str:
    return json.dumps(body, indent=2, ensure_ascii=False, default=_encode) + "\n"


# Who acts


class Actor:
    def __init__(self, workspace_id: UUID, user_id: UUID, role: str) -> None:
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.role = role


@contextlib.asynccontextmanager
async def _reading(sessions: Sessions, workspace_id: UUID | None) -> AsyncIterator[AsyncSession]:
    """One read-only transaction: scoped to the workspace when it is known."""
    if workspace_id is not None:
        async with workspace_transaction(sessions, workspace_id) as db:
            yield db
    else:
        async with sessions() as db, db.begin():
            yield db


async def _find_actor(sessions: Sessions, project_id: UUID, workspace_id: UUID | None) -> Actor:
    async with _reading(sessions, workspace_id) as db:
        owner_of: UUID | None = (
            await db.execute(
                select(projects.c.workspace_id).where(
                    projects.c.id == project_id, projects.c.deleted_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if owner_of is None or (workspace_id is not None and owner_of != workspace_id):
            if workspace_id is None:
                raise RefusedError(
                    f"no project {project_id} is visible to this database role; the API role sees "
                    "a project only inside its workspace, so pass --workspace"
                )
            raise RefusedError(f"no project {project_id} in workspace {workspace_id}")
        found = (
            await db.execute(
                select(memberships.c.user_id, memberships.c.role)
                .join(users, users.c.id == memberships.c.user_id)
                .where(
                    memberships.c.workspace_id == owner_of,
                    memberships.c.role.in_(("owner", "admin")),
                    users.c.disabled_at.is_(None),
                    or_(
                        memberships.c.project_ids.is_(None),
                        literal(project_id, Uuid) == any_(memberships.c.project_ids),
                    ),
                )
                .order_by(
                    case((memberships.c.role == "owner", 0), else_=1),
                    memberships.c.created_at,
                    memberships.c.id,
                )
                .limit(1)
            )
        ).one_or_none()
    if found is None:
        raise RefusedError(f"workspace {owner_of} has no active owner or admin to act as")
    return Actor(owner_of, found.user_id, found.role)


@contextlib.asynccontextmanager
async def _session_of(resources: Resources, user_id: UUID) -> AsyncIterator[str]:
    """A session for the user, made the way sign-in makes one, revoked when the block ends."""
    store = resources.session_store
    async with resources.sessions() as db, db.begin():
        token, context = await store.create(
            db,
            user_id=user_id,
            state="active",
            fresh=False,
            ip="127.0.0.1",
            user_agent="s18_export",
            now=datetime.now(UTC),
        )
    try:
        yield token
    finally:
        try:
            async with resources.sessions() as db, db.begin():
                token_hash = await store.revoke(
                    db, session_id=context.session_id, user_id=user_id, now=datetime.now(UTC)
                )
            if token_hash is not None:
                await store.forget([token_hash])
            say(f"session revoked ({context.session_id})")
        except Exception as failure:
            say(f"COULD NOT REVOKE session {context.session_id} ({type(failure).__name__})")


# The export


class Exporter:
    def __init__(
        self,
        client: httpx.AsyncClient,
        out: Path,
        *,
        workspace_id: UUID,
        project_id: UUID,
        page_size: int,
    ) -> None:
        self._client = client
        self._out = out
        self.base = f"/api/v1/workspaces/{workspace_id}/projects/{project_id}"
        self.workspace_url = f"/api/v1/workspaces/{workspace_id}"
        self.page_size = page_size
        self.api_paths: list[str] = []
        self.failures: list[dict[str, Any]] = []

    def write(self, name: str, text: str | bytes) -> None:
        target = self._out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(text, bytes):
            target.write_bytes(text)
        else:
            target.write_text(text, encoding="utf-8")

    def write_json(self, name: str, body: object) -> None:
        self.write(name, _dump(body))

    async def get(self, path: str, *, note: str | None = None) -> Any | None:
        """The body of a 2xx answer, or None after recording the failure."""
        shown = note or path
        if shown not in self.api_paths:
            self.api_paths.append(shown)
        response = await self._client.get(path)
        if response.is_success:
            return response.json()
        code: object = None
        with contextlib.suppress(ValueError):
            body = response.json()
            code = body.get("code") if isinstance(body, dict) else None
        self.failures.append({"path": path, "status": response.status_code, "code": code})
        say(f"FAILED {response.status_code} {code} {path}")
        return None

    async def single(self, path: str, name: str) -> Any | None:
        body = await self.get(path)
        if body is not None:
            self.write_json(name, body)
        return body

    async def listing(self, path: str, directory: str, stem: str) -> tuple[list[Any], int]:
        """Every cursor page of a list, one file each. Returns the rows and the file count."""
        rows: list[Any] = []
        files = 0
        cursor: str | None = None
        while True:
            url = path if cursor is None else f"{path}&cursor={quote(cursor, safe='')}"
            body = await self.get(url, note=path)
            if body is None:
                break
            files += 1
            self.write_json(f"{directory}/{stem}-{files:04d}.json", body)
            rows.extend(body["data"])
            cursor = body["page"]["next_cursor"]
            if not body["page"]["has_more"] or cursor is None:
                break
        return rows, files

    async def details(self, url_ids: Sequence[str]) -> int:
        gate = asyncio.Semaphore(DETAIL_CONCURRENCY)
        saved = 0

        async def one(url_id: str) -> None:
            nonlocal saved
            async with gate:
                body = await self.get(
                    f"{self.base}/internal-links/pages/{url_id}?scope=all",
                    note=f"{self.base}/internal-links/pages/{{url_id}}?scope=all",
                )
            if body is not None:
                self.write_json(f"page-detail/{url_id}.json", body)
                saved += 1

        await asyncio.gather(*(one(url_id) for url_id in url_ids))
        return saved


async def _stored_rows(
    sessions: Sessions, workspace_id: UUID, run_id: UUID
) -> tuple[list[dict[str, Any]], dict[int, bytes], list[dict[str, Any]]]:
    """The run's stored pages (with url and path), each page's url hash, and the link counts."""
    async with workspace_transaction(sessions, workspace_id) as db:
        pages = (
            await db.execute(
                select(crawl_pages, urls.c.canonical_url.label("url"), urls.c.path, urls.c.url_hash)
                .join(urls, urls.c.id == crawl_pages.c.url_id)
                .where(crawl_pages.c.run_id == run_id, crawl_pages.c.workspace_id == workspace_id)
                .order_by(urls.c.path, crawl_pages.c.url_id)
            )
        ).all()
        links = (
            await db.execute(
                select(
                    crawl_links.c.placement,
                    crawl_links.c.scope,
                    crawl_links.c.kind,
                    crawl_links.c.is_followed,
                    func.count().label("links"),
                )
                .where(crawl_links.c.run_id == run_id, crawl_links.c.workspace_id == workspace_id)
                .group_by(
                    crawl_links.c.placement,
                    crawl_links.c.scope,
                    crawl_links.c.kind,
                    crawl_links.c.is_followed,
                )
                .order_by(
                    crawl_links.c.placement,
                    crawl_links.c.scope,
                    crawl_links.c.kind,
                    crawl_links.c.is_followed,
                )
            )
        ).all()
    hashes = {row.url_id: bytes(row.url_hash) for row in pages}
    plain = [{k: v for k, v in row._mapping.items() if k != "url_hash"} for row in pages]
    return plain, hashes, [dict(row._mapping) for row in links]


async def _save_html(
    exporter: Exporter,
    store: ObjectStore,
    project_id: UUID,
    rows: Sequence[Mapping[str, Any]],
    hashes: Mapping[int, bytes],
) -> tuple[int, list[dict[str, str]]]:
    gate = asyncio.Semaphore(DETAIL_CONCURRENCY)
    saved = 0
    missing: list[dict[str, str]] = []

    async def one(row: Mapping[str, Any]) -> None:
        nonlocal saved
        url_id = str(row["url_id"])
        async with gate:
            try:
                packed = await store.get(html_key(project_id, hashes[int(url_id)]))
                html = await asyncio.to_thread(decompress, packed)
            except (RawStorageError, KeyError) as failure:
                missing.append({"url_id": url_id, "path": row["path"], "reason": str(failure)})
                return
        exporter.write(f"html/{url_id}.html", html)
        saved += 1

    await asyncio.gather(*(one(row) for row in rows))
    missing.sort(key=lambda item: int(item["url_id"]))
    return saved, missing


async def _export(
    resources: Resources, app: FastAPI, settings: Settings, args: argparse.Namespace
) -> int:
    actor = await _find_actor(resources.sessions, args.project, args.workspace)
    say(f"acting as {actor.role} {actor.user_id} of workspace {actor.workspace_id}")
    _check_empty(args.out)
    async with _session_of(resources, actor.user_id) as token:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport,
            base_url=settings.app_origin,
            headers={"Origin": settings.app_origin, "Cookie": f"{SESSION_COOKIE}={token}"},
            timeout=HTTP_TIMEOUT_SECONDS,
            follow_redirects=False,
        ) as client:
            exporter = Exporter(
                client,
                args.out,
                workspace_id=actor.workspace_id,
                project_id=args.project,
                page_size=args.page_size,
            )
            return await _run_export(exporter, resources, settings, args, actor)


async def _run_export(
    exporter: Exporter,
    resources: Resources,
    settings: Settings,
    args: argparse.Namespace,
    actor: Actor,
) -> int:
    base = exporter.base
    links = f"{base}/internal-links"
    runs = await exporter.single(f"{base}/link-crawls?limit={PAGE_SIZE_MAX}", "runs.json")
    if runs is None:
        raise RefusedError("the list of crawls could not be read; nothing is exported")
    latest = next((run for run in runs["data"] if run["is_latest"]), None)
    if latest is None:
        raise RefusedError(f"no crawl of project {args.project} has finished: nothing to export")
    run_id = UUID(latest["run_id"])
    say(f"latest crawl {run_id} state={latest['state']}")
    await exporter.single(f"{base}/link-crawls/{run_id}", "run.json")

    pages, page_files = await exporter.listing(
        f"{links}/pages?scope=all&limit={exporter.page_size}&sort=path", "pages", "page"
    )
    say(f"pages={len(pages)} files={page_files}")
    edges, edge_files = await exporter.listing(
        f"{links}/edges?scope=all&limit={exporter.page_size}", "edges", "edges"
    )
    say(f"edges={len(edges)} files={edge_files}")
    await exporter.single(f"{links}/tier-flow?scope=all", "tier-flow-all.json")
    await exporter.single(f"{links}/tier-flow?scope=editorial", "tier-flow-editorial.json")
    await exporter.single(f"{links}/worklists", "worklists.json")
    tiers = await exporter.single(f"{exporter.workspace_url}/page-tiers", "page-tiers.json")
    rules = await exporter.single(f"{base}/tier-rules", "tier-rules.json")
    detail_count = await exporter.details([str(row["url_id"]) for row in pages])
    say(f"page details={detail_count}")

    stored, hashes, link_groups = await _stored_rows(resources.sessions, actor.workspace_id, run_id)
    exporter.write_json("crawl_pages.json", stored)
    exporter.write_json("crawl_links_summary.json", link_groups)
    say(f"stored pages={len(stored)} link groups={len(link_groups)}")

    html_skipped: str | None = None
    html_count = 0
    missing: list[dict[str, str]] = []
    key = settings.r2_raw_access_key_id
    secret = settings.r2_raw_secret_access_key
    if settings.r2_raw_endpoint is None or key is None or secret is None:
        html_skipped = "raw storage (R2_RAW_*) is not configured in this environment"
        say(f"html skipped: {html_skipped}")
    else:
        async with open_raw_store(
            endpoint=settings.r2_raw_endpoint,
            bucket=settings.r2_raw_bucket,
            access_key_id=key.get_secret_value(),
            secret_access_key=secret.get_secret_value(),
            max_connections=DETAIL_CONCURRENCY,
        ) as store:
            html_count, missing = await _save_html(exporter, store, args.project, pages, hashes)
        say(f"html={html_count} missing={len(missing)}")

    counts = {
        "runs": len(runs["data"]),
        "pages": len(pages),
        "page_files": page_files,
        "edges": len(edges),
        "edge_files": edge_files,
        "page_detail": detail_count,
        "html": html_count,
        "page_tiers": len(tiers["data"]) if tiers is not None else 0,
        "tier_rules": len(rules["data"]) if rules is not None else 0,
        "crawl_pages": len(stored),
        "crawl_links": sum(group["links"] for group in link_groups),
    }
    exporter.write_json(
        "manifest.json",
        {
            "project_id": args.project,
            "workspace_id": actor.workspace_id,
            "run_id": run_id,
            "exported_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "page_size": exporter.page_size,
            "counts": counts,
            "runs_has_more": runs["page"]["has_more"],
            "api_paths": exporter.api_paths,
            "shapes": SHAPES,
            "missing_html": missing,
            "html_skipped": html_skipped,
            "failures": exporter.failures,
        },
    )
    say("counts: " + " ".join(f"{name}={value}" for name, value in counts.items()))
    say(f"exported to {args.out}")
    if exporter.failures:
        say(f"{len(exporter.failures)} API call(s) were not 2xx: see manifest.json")
        return EXIT_FAILED
    return 0


# Arguments and entry point


def _page_size(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError("not a number") from None
    if not 1 <= value <= PAGE_SIZE_MAX:
        raise argparse.ArgumentTypeError(f"must be 1 to {PAGE_SIZE_MAX}")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument("--project", type=UUID, required=True)
    parser.add_argument("--out", type=Path, required=True, help="a new or empty folder")
    parser.add_argument(
        "--workspace",
        type=UUID,
        help="the project's workspace; needed with the API database role (row-level security)",
    )
    parser.add_argument("--page-size", type=_page_size, default=PAGE_SIZE_MAX)
    return parser


async def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        settings = load_settings()
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else EXIT_REFUSED
    try:
        if settings.app_env != "local":
            raise RefusedError(
                f"APP_ENV is {settings.app_env}: this tool runs only against a local database"
            )
        check_out_dir(args.out)
        app = create_app(settings)
        async with app.router.lifespan_context(app):
            resources = app.state.resources
            if not isinstance(resources, Resources):
                raise TypeError("application resources are not initialised")
            return await _export(resources, app, settings, args)
    except RefusedError as refusal:
        say(f"refused: {refusal}")
        return EXIT_REFUSED
    except Exception as failure:
        # The class only: a message may quote a connection string or an address.
        say(f"failed: {type(failure).__name__}")
        return EXIT_FAILED


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
