"""`python -m sightline.worker`: the worker container's command (docs/22 section 4.1)."""

from __future__ import annotations

import asyncio
import signal
import sys

from sightline.config.logging import configure_logging
from sightline.config.sentry import init_sentry
from sightline.config.settings import Settings, load_settings
from sightline.worker.app import run_worker
from sightline.worker.assembly import assemble


async def _run(settings: Settings) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    # SIGTERM is what `docker stop` and a deploy send; SIGINT is Ctrl-C in a terminal.
    for number in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(number, stop.set)
    await run_worker(settings, assemble, stop)


def main() -> int:
    settings = load_settings()
    if settings.process_role != "worker":
        sys.stderr.write("Invalid configuration:\n  PROCESS_ROLE: must be worker\n")
        return 2
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    init_sentry(settings)
    asyncio.run(_run(settings))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
