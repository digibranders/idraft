"""`python -m idraft.worker.relink_crawl`: read a project's latest crawl again from the raw HTML it
stored, and redo its links, counts, flags and mentions from that (see `crawl_relink`).

Runs with the worker's settings (`PROCESS_ROLE=worker`), for one project of one workspace: both
ids are required, so no other tenant is touched. It makes no new crawl, calls no provider and
spends nothing. If the HTML of any page is gone, it changes nothing. It is safe to run again.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_relink import RelinkError, RelinkOutcome, relink_crawl
from idraft.collectors.crawl_store import latest_run
from idraft.config.logging import configure_logging
from idraft.config.settings import load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.storage.raw import ObjectStore, RawStorageError, open_raw_store


async def relink_latest(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
) -> RelinkOutcome | None:
    """The project's latest finished crawl, read again; None when there is none, or it is not
    ready to be."""
    async with sessions() as db:
        run_id = await latest_run(db, workspace_id, project_id)
    if run_id is None:
        return None
    return await relink_crawl(sessions, store, workspace_id=workspace_id, run_id=run_id)


async def _run(workspace_id: uuid.UUID, project_id: uuid.UUID) -> RelinkOutcome | None:
    settings = load_settings()
    if (
        settings.r2_raw_endpoint is None
        or settings.r2_raw_access_key_id is None
        or settings.r2_raw_secret_access_key is None
    ):
        raise RawStorageError("raw storage is not configured")
    engine = create_engine(settings)
    try:
        async with open_raw_store(
            endpoint=settings.r2_raw_endpoint,
            bucket=settings.r2_raw_bucket,
            access_key_id=settings.r2_raw_access_key_id.get_secret_value(),
            secret_access_key=settings.r2_raw_secret_access_key.get_secret_value(),
        ) as store:
            return await relink_latest(
                create_session_factory(engine),
                store,
                workspace_id=workspace_id,
                project_id=project_id,
            )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m idraft.worker.relink_crawl",
        description="Read one project's latest crawl again from its stored HTML, with no crawl.",
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
    except RelinkError as error:
        sys.stderr.write(f"Nothing was changed or the job did not end: {error}\n")
        return 1
    except (SQLAlchemyError, OSError, RawStorageError) as error:
        sys.stderr.write(f"The relink could not run: {type(error).__name__}\n")
        return 1
    if outcome is None:
        sys.stderr.write("Nothing was done: no finished crawl, or its second job has not ended.\n")
        return 1
    sys.stdout.write(
        f"Crawl {outcome.run_id}: {outcome.pages} pages read again, "
        f"links {outcome.links_before} to {outcome.links_after}.\n"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
