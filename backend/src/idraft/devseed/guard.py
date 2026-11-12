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

from idraft.config.settings import Settings

LOOPBACK: Final = frozenset({"localhost", "127.0.0.1", "::1"})


class NotDevelopmentError(Exception):
    """The settings do not describe a developer's machine. The message says which fact failed
    and never quotes the connection string."""


def _on_this_machine(host: str | None) -> bool:
    return (host or "").strip("[]").lower() in LOOPBACK


def check_development(settings: Settings) -> None:
    if settings.app_env != "local":
        raise NotDevelopmentError(
            f"APP_ENV is {settings.app_env}; the seed runs only where it is local."
        )
    if not _on_this_machine(make_url(settings.sqlalchemy_url).host):
        raise NotDevelopmentError(
            "DATABASE_URL names a database that is not on this machine "
            "(localhost, 127.0.0.1 or ::1)."
        )
    if not _on_this_machine(urlsplit(settings.app_origin).hostname):
        raise NotDevelopmentError(
            "APP_ORIGIN is not on this machine (localhost, 127.0.0.1 or ::1)."
        )
