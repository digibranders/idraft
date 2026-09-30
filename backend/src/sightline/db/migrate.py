"""Alembic entry points. The config is built in code so it works from an installed package."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncConnection

from sightline.config.settings import load_settings, to_sqlalchemy_url

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
VERSION_SCHEMA = "ops"
_CURRENT = text(f"SELECT version_num FROM {VERSION_SCHEMA}.alembic_version")


def alembic_config(database_url: str | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    if database_url is not None:
        # configparser treats % as interpolation, so it is doubled
        config.set_main_option("sqlalchemy.url", to_sqlalchemy_url(database_url).replace("%", "%%"))
    return config


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    if head is None:
        raise RuntimeError("No migration head: the migrations directory is empty")
    return head


async def current_revision(connection: AsyncConnection) -> str | None:
    """The revision stored in the database, or None before the first migration."""
    try:
        revision: str | None = (await connection.execute(_CURRENT)).scalar_one_or_none()
    except ProgrammingError:
        return None
    return revision


def upgrade_to_head(database_url: str) -> None:
    command.upgrade(alembic_config(database_url), "head")


def main() -> None:
    """`python -m sightline.db.migrate`: what the migrator container runs on deploy."""
    upgrade_to_head(load_settings().database_url)


if __name__ == "__main__":  # pragma: no cover
    main()
