"""Operator commands, run by hand on the host: `python -m sightline.cli <command>`.

`create-operator` makes the first account. Registration is by invitation, and an invitation needs
someone to send it, so the first person comes in this way. It connects as `migrator`: the API's
own database role cannot make anyone a platform operator (docs/04-data-model.md section 13.1).
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from collections.abc import Sequence
from enum import StrEnum

import asyncpg
from pydantic import TypeAdapter, ValidationError

from sightline.api.auth.passwords import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    WeakPasswordError,
    WeakPasswordReason,
    check_policy,
    hash_password,
)
from sightline.api.schemas.auth import Email, Name
from sightline.config.settings import load_migrator_settings

CONNECT_TIMEOUT_SECONDS = 5.0
OWNER_ROLE = "migrator"
_WEAK: dict[WeakPasswordReason, str] = {
    "too_short": f"The password must be at least {PASSWORD_MIN} characters.",
    "too_long": f"The password must be at most {PASSWORD_MAX} characters.",
    "contains_email": "The password must not contain the email name.",
    "breached": "The password appears in a known breach.",
    "unchanged": "The password is unchanged.",
}
_INSERT_USER = """
    INSERT INTO auth.users (email, name, password_hash, is_platform_operator, email_verified_at)
    VALUES ($1, $2, $3, true, now())
    ON CONFLICT (email) DO NOTHING
    RETURNING id
"""
_INSERT_AUDIT = """
    INSERT INTO ops.audit_logs (actor_type, actor_id, action, target_type, target_id)
    VALUES ('system', 'cli', 'auth.operator_created', 'user', $1)
"""


class Outcome(StrEnum):
    CREATED = "created"
    EXISTS = "exists"
    NOT_OWNER = "not_owner"


async def create_operator(database_url: str, *, email: str, name: str, password: str) -> Outcome:
    """Insert a verified platform operator. An existing account is never changed."""
    connection = await asyncpg.connect(database_url, timeout=CONNECT_TIMEOUT_SECONDS)
    try:
        if await connection.fetchval("SELECT current_user") != OWNER_ROLE:
            return Outcome.NOT_OWNER
        password_hash = hash_password(password)
        async with connection.transaction():
            user_id = await connection.fetchval(_INSERT_USER, email, name, password_hash)
            if user_id is None:
                return Outcome.EXISTS
            await connection.execute(_INSERT_AUDIT, str(user_id))
        return Outcome.CREATED
    finally:
        await connection.close()


def _read_password() -> str | None:
    """The password, from a prompt that does not echo, or from stdin when it is not a terminal.

    None when the two entries at the prompt differ.
    """
    if not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("Password: ")  # pragma: no cover - needs a terminal
    second = getpass.getpass("Again: ")  # pragma: no cover
    return first if first == second else None  # pragma: no cover


def _fail(message: str) -> int:
    sys.stderr.write(message + "\n")
    return 1


def _create_operator(arguments: argparse.Namespace) -> int:
    settings = load_migrator_settings()
    try:
        email = TypeAdapter(Email).validate_python(arguments.email)
    except ValidationError:
        return _fail("The email must be one address, without spaces or hidden characters.")
    try:
        name = TypeAdapter(Name).validate_python(arguments.name)
    except ValidationError:
        return _fail("The name must be 1 to 120 characters, without hidden characters.")

    password = _read_password()
    if password is None:  # pragma: no cover - needs a terminal
        return _fail("The two passwords differ.")
    try:
        check_policy(password, email=email)
    except WeakPasswordError as error:
        return _fail(_WEAK[error.reason])

    try:
        outcome = asyncio.run(
            create_operator(settings.asyncpg_dsn, email=email, name=name, password=password)
        )
    except (OSError, TimeoutError, asyncpg.PostgresError):
        # Nothing from the exception is printed: it can quote the connection string.
        return _fail("Could not connect to the database.")
    if outcome is Outcome.NOT_OWNER:
        return _fail(f"This command must connect as {OWNER_ROLE}. Check DATABASE_URL.")
    if outcome is Outcome.EXISTS:
        return _fail(f"An account with the email {email} already exists. Nothing was changed.")
    sys.stdout.write(f"Created platform operator {email}.\n")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m sightline.cli", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    operator = commands.add_parser(
        "create-operator",
        help="create a verified platform operator; reads the password from a prompt or stdin",
    )
    operator.add_argument("--email", required=True)
    operator.add_argument("--name", required=True)
    operator.set_defaults(run=_create_operator)
    arguments = parser.parse_args(argv)
    code: int = arguments.run(arguments)
    return code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
