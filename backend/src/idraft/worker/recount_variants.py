"""`python -m idraft.worker.recount_variants`: fold the variants of a project's latest crawl, now
(plan 09). A crawl finished before variants were known keeps counting them until this runs.

Runs with the worker's settings (`PROCESS_ROLE=worker`), for one project of one workspace: both
ids are required, so no other tenant is touched. It makes no new crawl and calls no provider. It
is safe to run again; it does nothing for a crawl whose second job (changes, anchors, mentions)
has not ended.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_ingest import RecountOutcome, recount_variants
from idraft.collectors.crawl_store import latest_run
from idraft.config.logging import configure_logging
from idraft.config.settings import load_settings
from idraft.db.engine import create_engine, create_session_factory


async def recount_latest(
    sessions: async_sessionmaker[AsyncSession], *, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> RecountOutcome | None:
    """The project's latest finished crawl, recounted; None when there is none, or it is not
    ready to be."""
    async with sessions() as db:
        run_id = await latest_run(db, workspace_id, project_id)
    if run_id is None:
        return None
    return await recount_variants(sessions, workspace_id=workspace_id, run_id=run_id)


async def _run(workspace_id: uuid.UUID, project_id: uuid.UUID) -> RecountOutcome | None:
    engine = create_engine(load_settings())
    try:
        return await recount_latest(
            create_session_factory(engine), workspace_id=workspace_id, project_id=project_id
        )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m idraft.worker.recount_variants",
        description="Fold the variants of one project's latest crawl, without a new crawl.",
    )
    parser.add_argument("--workspace-id", type=uuid.UUID, required=True)
    parser.add_argument("--project-id", type=uuid.UUID, required=True)
    arguments = parser.parse_args(argv)
    settings = load_settings()
    if settings.process_role != "worker":
        sys.stderr.write("Invalid configuration:\n  PROCESS_ROLE: must be worker\n")
        return 2
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    try:
        outcome = asyncio.run(_run(arguments.workspace_id, arguments.project_id))
    except (SQLAlchemyError, OSError) as error:
        sys.stderr.write(f"The recount could not run: {type(error).__name__}\n")
        return 1
    if outcome is None:
        sys.stderr.write("Nothing was done: no finished crawl, or its second job has not ended.\n")
        return 1
    sys.stdout.write(
        f"Crawl {outcome.run_id}: {outcome.pages} pages, {outcome.pages_variant} variants.\n"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
