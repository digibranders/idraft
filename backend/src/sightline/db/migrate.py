"""Alembic entry points. The config is built in code so it works from an installed package."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import structlog
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from sightline.config.logging import configure_logging
from sightline.config.settings import load_migrator_settings, to_sqlalchemy_url
from sightline.db.probe import probe_database

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
VERSION_SCHEMA = "ops"
# Held for the whole run so two migrators never race (arbitrary constant, stable across releases).
ADVISORY_LOCK_KEY = 7_418_529_630
_PROBE_TIMEOUT_SECONDS = 10.0
_log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class MigrationState:
    """What this build knows about the schema history."""

    head: str
    known: frozenset[str]

    def is_current(self, database_revision: str | None) -> bool:
        """Whether the database can serve this build.

        Migrations are never reverted, and a release keeps working against the next release's
        schema (docs/22-infrastructure-devops.md section 8.5). So a revision this build has never
        heard of means a newer build migrated the database, and that is fine. Only a missing
        version row or a known older revision means the schema is behind.
        """
        if database_revision is None:
            return False
        return database_revision == self.head or database_revision not in self.known


def alembic_config(database_url: str | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    if database_url is not None:
        # configparser treats % as interpolation, so it is doubled
        config.set_main_option("sqlalchemy.url", to_sqlalchemy_url(database_url).replace("%", "%%"))
    return config


def migration_state() -> MigrationState:
    script = ScriptDirectory.from_config(alembic_config())
    heads = script.get_heads()
    if len(heads) != 1:
        raise RuntimeError(f"Expected exactly one migration head, found {len(heads)}")
    return MigrationState(
        head=heads[0],
        known=frozenset(revision.revision for revision in script.walk_revisions()),
    )


def upgrade_to_head(database_url: str) -> None:
    """Apply every pending revision. Blocking: from async code, run it in a thread."""
    command.upgrade(alembic_config(database_url), "head")


def main() -> None:
    """`python -m sightline.db.migrate`: what the migrator container runs on deploy."""
    settings = load_migrator_settings()
    configure_logging(service="migrator", version=settings.release_sha, level=settings.log_level)
    before = asyncio.run(
        probe_database(settings.asyncpg_dsn, within_seconds=_PROBE_TIMEOUT_SECONDS)
    )
    upgrade_to_head(settings.database_url.get_secret_value())
    _log.info(
        "migrations applied", from_revision=before.revision, to_revision=migration_state().head
    )


if __name__ == "__main__":  # pragma: no cover
    main()
