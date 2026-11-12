"""The seed writes into whatever database DATABASE_URL names, so it first proves it is on a
developer's machine. Three facts, each enough to refuse:

1. `APP_ENV` is `local`. The server's env files say `production` (infra/vps/provision.sh) and the
   test suite's settings say `test`.
2. The database host is this machine's loopback: `localhost`, `127.0.0.1` or `::1`. The dev stack
   publishes PostgreSQL on 127.0.0.1:54329 (infra/compose/docker-compose.dev.yml). A compose
   service name such as `postgres` is not accepted: production's compose file would use it.
3. `APP_ORIGIN` is on this machine too. The server's is https://app.idraft.ai.

The server's own database is on its own loopback, so (2) alone would not keep the seed off it when
run there; (1) and (3) do, and `APP_ENV` defaults to `local`, so (3) also covers an env file that
lost its `APP_ENV`. A tunnel that brings another database to a local port passes (2): the seed
cannot see through one, so never point a local env file at a tunnel.
"""

from __future__ import annotations

from typing import Final
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

from idraft.config.settings import Settings

LOOPBACK: Final = frozenset({"localhost", "127.0.0.1", "::1"})


class NotDevelopmentError(Exception):
    """The settings do not describe a developer's machine. The message says which fact failed
    and never quotes the connection string."""


def _on_this_machine(host: str | None) -> bool:
    # No bracket handling: `make_url` and `urlsplit` already unwrap the one pair around an IPv6
    # literal, so a host that still carries a bracket (`[[::1]]`, `localhost]`) is not a loopback.
    return (host or "").lower() in LOOPBACK


def _database_host(settings: Settings) -> str | None:
    try:
        return make_url(settings.sqlalchemy_url).host
    except (ArgumentError, ValueError):
        # Never chain or quote the parser's error: SQLAlchemy's text includes the whole URL.
        raise NotDevelopmentError("DATABASE_URL could not be read as a database URL.") from None


def _origin_host(settings: Settings) -> str | None:
    try:
        return urlsplit(settings.app_origin).hostname
    except ValueError:
        raise NotDevelopmentError("APP_ORIGIN could not be read as a URL.") from None


def check_development(settings: Settings) -> None:
    if settings.app_env != "local":
        raise NotDevelopmentError(
            f"APP_ENV is {settings.app_env}; the seed runs only where it is local."
        )
    if not _on_this_machine(_database_host(settings)):
        raise NotDevelopmentError(
            "DATABASE_URL names a database that is not on this machine "
            "(localhost, 127.0.0.1 or ::1)."
        )
    if not _on_this_machine(_origin_host(settings)):
        raise NotDevelopmentError(
            "APP_ORIGIN is not on this machine (localhost, 127.0.0.1 or ::1)."
        )
