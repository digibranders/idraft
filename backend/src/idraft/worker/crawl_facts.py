"""`python -m idraft.worker.crawl_facts`: fill the facts of a project's latest crawl from the raw
HTML it stored (see `collectors.crawl_facts`).

Runs with the worker's settings (`PROCESS_ROLE=worker`), for one project of one workspace: both
ids are required, so no other tenant is touched. It makes no new crawl, calls no provider and
spends nothing. It writes the facts only, never the links. It is safe to run again.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_facts import FactsOutcome, backfill_facts
from idraft.collectors.crawl_store import latest_run
from idraft.config.logging import configure_logging
from idraft.config.settings import load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.storage.raw import ObjectStore, RawStorageError, open_raw_store


async def facts_latest(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
) -> FactsOutcome | None:
    """The project's latest crawl with data, filled; None when there is none."""
    async with sessions() as db:
        run_id = await latest_run(db, workspace_id, project_id)
    if run_id is None:
        return None
    return await backfill_facts(sessions, store, workspace_id=workspace_id, run_id=run_id)


async def _run(workspace_id: uuid.UUID, project_id: uuid.UUID) -> FactsOutcome | None:
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
            return await facts_latest(
                create_session_factory(engine),
                store,
                workspace_id=workspace_id,
                project_id=project_id,
            )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m idraft.worker.crawl_facts",
        description="Fill one project's latest crawl with the facts of its stored HTML.",
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
    except (SQLAlchemyError, OSError, RawStorageError) as error:
        sys.stderr.write(f"The facts could not be filled: {type(error).__name__}\n")
        return 1
    if outcome is None:
        sys.stderr.write("Nothing was done: the project has no finished crawl.\n")
        return 1
    sys.stdout.write(
        f"Crawl {outcome.run_id}: facts of {outcome.read} pages written, "
        f"{outcome.missing} pages without stored HTML.\n"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
