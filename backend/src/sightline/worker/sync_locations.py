"""`python -m sightline.worker.sync_locations`: the location sync once, now (plan decision D8).

Runs with the worker's settings (`PROCESS_ROLE=worker`). Without arguments it asks DataForSEO
for its location list, which needs `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` and calls the
account (the list is free). `--from-file PATH` reads a saved answer instead, with no network and
no credentials; `tests/fixtures/dataforseo/locations.json` fills a local database that way.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import httpx
from redis.asyncio import Redis
from sqlalchemy.exc import SQLAlchemyError

from sightline.collectors.locations import LocationSyncReport, sync_locations
from sightline.config.logging import configure_logging
from sightline.config.settings import Settings, load_settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.providers.contract import ProviderCallError
from sightline.providers.dataforseo.locations import LocationListError, read_locations
from sightline.worker.app import HTTP_TIMEOUT, REDIS_TIMEOUT_SECONDS
from sightline.worker.assembly import dataforseo_client, sync_dataforseo_locations


async def run(settings: Settings, saved: bytes | None) -> LocationSyncReport | None:
    """None when there is no list to read: no saved answer, and no DataForSEO credentials."""
    engine = create_engine(settings)
    sessions = create_session_factory(engine)
    try:
        if saved is not None:
            return await sync_locations(sessions, read_locations(saved))
        redis = Redis.from_url(
            settings.redis_url.get_secret_value(),
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=False) as http:
                return await sync_dataforseo_locations(
                    sessions, dataforseo_client(settings, http, redis)
                )
        finally:
            await redis.aclose()
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m sightline.worker.sync_locations",
        description="Sync the locations collection can target, from DataForSEO or a saved file.",
    )
    parser.add_argument(
        "--from-file",
        type=Path,
        metavar="PATH",
        help="a saved answer of GET /v3/serp/google/locations, read instead of calling DataForSEO",
    )
    arguments = parser.parse_args(argv)
    settings = load_settings()
    if settings.process_role != "worker":
        sys.stderr.write("Invalid configuration:\n  PROCESS_ROLE: must be worker\n")
        return 2
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    saved = None
    if arguments.from_file is not None:
        try:
            saved = arguments.from_file.read_bytes()
        except OSError as error:
            sys.stderr.write(f"The file could not be read: {error}\n")
            return 1
    try:
        report = asyncio.run(run(settings, saved))
    except LocationListError as error:
        sys.stderr.write(f"The locations could not be read: {error}\n")
        return 1
    except ProviderCallError as error:
        sys.stderr.write(f"The DataForSEO call failed: {error.error.kind.value}\n")
        return 1
    except (SQLAlchemyError, OSError) as error:
        # The database, or Redis for the call limiter, could not be used.
        sys.stderr.write(f"The sync could not run: {type(error).__name__}\n")
        return 1
    if report is None:
        sys.stderr.write(
            "No DataForSEO credentials, so there is nothing to sync. "
            "Use --from-file to read a saved list.\n"
        )
        return 1
    untrusted = " (deactivation skipped: the list was not trusted)"
    sys.stdout.write(
        f"{report.listed} locations, {report.skipped} skipped, "
        f"{report.deactivated} deactivated"
        + (untrusted if report.deactivation_skipped else "")
        + "\n"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
