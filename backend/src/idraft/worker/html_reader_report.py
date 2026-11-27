"""`python -m idraft.worker.html_reader_report`: which crawls were read by an older HTML reader
(plan 12).

Lists the latest finished crawl of every project: its HTML reader version (null reads as 1), the
pages with few links read, its pages by how their links were read, and whether it is stale, that
is, read from HTML by an older reader than `HTML_READER_VERSION`. It only reads: it changes
nothing, calls no provider and spends nothing. The fix for a stale crawl is
`python -m idraft.worker.relink_crawl` for its project.

Runs with the worker's settings (`PROCESS_ROLE=worker`), which see every workspace.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_store import DATA_STATES
from idraft.config.logging import configure_logging
from idraft.config.settings import load_settings
from idraft.crawl.integrity import HTML_READER_VERSION
from idraft.db.engine import create_engine, create_session_factory

_LATEST = text(
    """
    SELECT DISTINCT ON (r.project_id) r.workspace_id, r.project_id, r.id AS run_id,
           coalesce(r.html_reader_version, 1) AS version, r.pages_links_suspect,
           (SELECT jsonb_object_agg(links_state, n) FROM
               (SELECT links_state, count(*) AS n FROM seo.crawl_pages
                WHERE run_id = r.id GROUP BY links_state) s) AS pages_by_state
    FROM seo.crawl_runs r
    WHERE r.state = ANY(CAST(:states AS text[]))
    ORDER BY r.project_id, r.created_at DESC, r.id DESC
    """
)


@dataclass(frozen=True, slots=True)
class ReaderRow:
    workspace_id: UUID
    project_id: UUID
    run_id: UUID
    version: int
    pages_links_suspect: int | None
    pages_by_state: dict[str, int]

    @property
    def stale(self) -> bool:
        """Read from HTML by an older reader. A crawl with no page read from HTML has nothing to
        read again."""
        return self.pages_by_state.get("from_html", 0) > 0 and self.version < HTML_READER_VERSION


async def reader_report(sessions: async_sessionmaker[AsyncSession]) -> list[ReaderRow]:
    async with sessions() as db:
        rows = (await db.execute(_LATEST, {"states": list(DATA_STATES)})).all()
    return [
        ReaderRow(
            workspace_id=row.workspace_id,
            project_id=row.project_id,
            run_id=row.run_id,
            version=row.version,
            pages_links_suspect=row.pages_links_suspect,
            pages_by_state=dict(row.pages_by_state or {}),
        )
        for row in rows
    ]


async def _run() -> list[ReaderRow]:
    engine = create_engine(load_settings())
    try:
        return await reader_report(create_session_factory(engine))
    finally:
        await engine.dispose()


def main() -> int:
    settings = load_settings()
    if settings.process_role != "worker":
        sys.stderr.write("Invalid configuration:\n  PROCESS_ROLE: must be worker\n")
        return 2
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    try:
        rows = asyncio.run(_run())
    except (SQLAlchemyError, OSError) as error:
        sys.stderr.write(f"The report could not run: {type(error).__name__}\n")
        return 1
    sys.stdout.write(f"Current HTML reader version: {HTML_READER_VERSION}\n")
    for row in rows:
        by_state = dict(sorted(row.pages_by_state.items()))
        sys.stdout.write(
            f"{'STALE' if row.stale else 'ok   '} workspace {row.workspace_id} "
            f"project {row.project_id} run {row.run_id} version {row.version} "
            f"suspect pages {row.pages_links_suspect} pages {by_state}\n"
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
