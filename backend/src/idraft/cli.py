"""Operator commands, run by hand on the host: `python -m idraft.cli <command>`.

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

from idraft.api.auth.passwords import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    WeakPasswordError,
    WeakPasswordReason,
    check_policy,
    hash_password,
)
from idraft.api.schemas.common import Email, Name
from idraft.config.settings import load_migrator_settings

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
_IS_OPERATOR = "SELECT is_platform_operator FROM auth.users WHERE email = $1"
_INSERT_AUDIT = """
    INSERT INTO ops.audit_logs (actor_type, actor_id, action, target_type, target_id)
    VALUES ('system', 'cli', 'auth.operator_created', 'user', $1)
"""


class Outcome(StrEnum):
    CREATED = "created"
    EXISTS_AS_OPERATOR = "exists_as_operator"
    EXISTS_AS_MEMBER = "exists_as_member"
    NOT_OWNER = "not_owner"


class _InputError(Exception):
    """The password could not be read. The message is for the person at the terminal."""


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
                is_operator = await connection.fetchval(_IS_OPERATOR, email)
                return Outcome.EXISTS_AS_OPERATOR if is_operator else Outcome.EXISTS_AS_MEMBER
            await connection.execute(_INSERT_AUDIT, str(user_id))
        return Outcome.CREATED
    finally:
        await connection.close()


def _read_password() -> str:
    """The password, from a prompt that does not echo, or from stdin when it is not a terminal.

    Read as bytes and decoded here, so input that is not UTF-8 is an answer, not a traceback.
    """
    if sys.stdin is None:
        raise _InputError("No password was given: standard input is closed.")
    if sys.stdin.isatty():  # pragma: no cover - needs a terminal
        first = getpass.getpass("Password: ")
        if first != getpass.getpass("Again: "):
            raise _InputError("The two passwords differ.")
        return first
    try:
        return sys.stdin.buffer.readline().decode("utf-8").rstrip("\r\n")
    except UnicodeDecodeError:
        raise _InputError("The password must be UTF-8 text.") from None


def _fail(message: str) -> int:
    sys.stderr.write(message + "\n")
    return 1


def _database_problem(error: Exception) -> str:
    """What went wrong, in words. Nothing from the exception is printed: it can quote the DSN."""
    if isinstance(error, asyncpg.InvalidAuthorizationSpecificationError):
        return "The database refused the credentials in DATABASE_URL."
    if isinstance(error, asyncpg.InvalidCatalogNameError):
        return "The database named in DATABASE_URL does not exist."
    if isinstance(error, asyncpg.UndefinedTableError | asyncpg.InvalidSchemaNameError):
        return "The schema is not migrated. Run python -m idraft.db.migrate first."
    if isinstance(error, asyncpg.PostgresError):
        return f"The database reported an error ({type(error).__name__})."
    return "Could not connect to the database."


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

    try:
        password = _read_password()
        check_policy(password, email=email)
    except _InputError as error:
        return _fail(str(error))
    except WeakPasswordError as error:
        return _fail(_WEAK[error.reason])

    try:
        outcome = asyncio.run(
            create_operator(settings.asyncpg_dsn, email=email, name=name, password=password)
        )
    except (OSError, TimeoutError, asyncpg.PostgresError) as error:
        return _fail(_database_problem(error))
    if outcome is Outcome.NOT_OWNER:
        return _fail(f"This command must connect as {OWNER_ROLE}. Check DATABASE_URL.")
    if outcome is Outcome.EXISTS_AS_OPERATOR:
        return _fail(
            f"An account with the email {email} already exists and is a platform operator. "
            "Nothing was changed."
        )
    if outcome is Outcome.EXISTS_AS_MEMBER:
        return _fail(
            f"An account with the email {email} already exists and is not a platform operator. "
            "This command does not promote accounts. Nothing was changed."
        )
    sys.stdout.write(f"Created platform operator {email}.\n")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m idraft.cli", description=__doc__)
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
