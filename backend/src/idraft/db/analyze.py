"""`python -m idraft.db.analyze`: refresh planner statistics of the AI tables.

For an operator after a restore, a major PostgreSQL upgrade or a bulk backfill
(docs/ops/planner-statistics.md). Unlike the deploy, it fails loudly: no statistics taken means
a non-zero exit.
"""

from __future__ import annotations

import asyncio

from idraft.config.logging import configure_logging
from idraft.config.settings import load_migrator_settings
from idraft.db.maintenance import analyze_database


def main() -> None:
    settings = load_migrator_settings()
    configure_logging(service="migrator", version=settings.release_sha, level=settings.log_level)
    asyncio.run(analyze_database(settings.asyncpg_dsn))


if __name__ == "__main__":  # pragma: no cover
    main()
