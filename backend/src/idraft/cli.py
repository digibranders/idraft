"""Operator commands, run by hand on the host: `python -m idraft.cli <command>`.

`create-operator` makes the first account. Registration is by invitation, and an invitation needs
someone to send it, so the first person comes in this way. It connects as `migrator`: the API's
own database role cannot make anyone a platform operator (docs/04-data-model.md section 13.1).

`seed-eventus` makes the Eventus Security AI prompt tracking project in a development database
from `fixtures/ai-prompts/eventus-security.json`, as the API's role and a workspace owner. It
refuses to run anywhere but a developer's machine (docs/ops/dev-eventus-seed.md).

`ai-quality` prints the AI quality checks of one UTC day (docs/25-observability.md section 9). It
connects as `migrator` too, reads across workspaces and writes nothing.

`backfill-prompt-intent` gives every live prompt whose intent is `unknown` the intent and funnel
stage its wording rule gives (`idraft.ai.intent`). It connects as `migrator`, and a second run
changes nothing.

`link-prompt-keywords` links every live prompt that has no keyword link to its head search phrase
(`idraft.ai.keyword_phrase`), making the keyword when the workspace has none. The keyword is not
tracked, so it costs no rank checks. With `--queue-metrics` it also queues one keyword metrics run
a project for the linked keywords that have no metrics yet (about 0.0004 USD a keyword, paid when
the worker plans the run). It connects as `migrator`, and a second run links nothing new.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from pathlib import Path

import asyncpg
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import SQLAlchemyError

from idraft.api.auth.passwords import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    WeakPasswordError,
    WeakPasswordReason,
    check_policy,
    hash_password,
)
from idraft.api.schemas.common import Email, Name
from idraft.config.settings import load_migrator_settings, load_settings
from idraft.devseed.guard import NotDevelopmentError, check_development

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


def _seed_eventus(arguments: argparse.Namespace) -> int:
    # Order matters: the guard runs before the fixture is read or any connection is opened.
    settings = load_settings()
    try:
        check_development(settings)
    except NotDevelopmentError as error:
        return _fail(f"Refused: {error} Nothing was written.")
    # Imported here: the seed pulls in the API's services, and the other commands stay light
    # (tests/test_cli.py keeps fastapi out of `import idraft.cli`).
    from idraft.devseed.context import SeedError
    from idraft.devseed.fixture import DEFAULT_FIXTURE, FixtureError, load_fixture
    from idraft.devseed.run import run_seed

    try:
        fixture = load_fixture(arguments.fixture or DEFAULT_FIXTURE)
    except FixtureError as error:
        return _fail(str(error))
    try:
        report = asyncio.run(run_seed(settings, fixture, arguments.workspace))
    except SeedError as error:
        return _fail(str(error))
    except (OSError, TimeoutError, SQLAlchemyError, asyncpg.PostgresError) as error:
        # The type only: a driver's message can quote the connection string.
        return _fail(
            f"The database could not be used ({type(error).__name__}). Earlier steps may already "
            "be written; run the seed again once the database is reachable."
        )
    sys.stdout.write("\n".join(report.lines()) + "\n")
    return 0


async def _quality_report(
    database_url: str, day: date, workspace_id: uuid.UUID | None, project_id: uuid.UUID | None
) -> str | None:
    """The table of AI quality checks for `day`, or None when the role is not the owner."""
    # Imported here with the other lazy imports: the checks stay out of `import idraft.cli`.
    from idraft.ai.quality import ai_quality_checks, render_table

    connection = await asyncpg.connect(database_url, timeout=CONNECT_TIMEOUT_SECONDS)
    try:
        if await connection.fetchval("SELECT current_user") != OWNER_ROLE:
            return None
        results = await ai_quality_checks(
            connection, day, workspace_id=workspace_id, project_id=project_id
        )
    finally:
        await connection.close()
    return render_table(results, day)


def _ai_quality(arguments: argparse.Namespace) -> int:
    settings = load_migrator_settings()
    day: date = arguments.day or datetime.now(UTC).date() - timedelta(days=1)
    try:
        report = asyncio.run(
            _quality_report(settings.asyncpg_dsn, day, arguments.workspace, arguments.project)
        )
    except (OSError, TimeoutError, asyncpg.PostgresError) as error:
        return _fail(_database_problem(error))
    if report is None:
        return _fail(f"This command must connect as {OWNER_ROLE}. Check DATABASE_URL.")
    sys.stdout.write(report + "\n")
    return 0


_UNKNOWN_PROMPTS = """
    SELECT p.id, v.text
    FROM ai.prompts p JOIN ai.prompt_versions v ON v.id = p.current_version_id
    WHERE p.intent = 'unknown' AND p.deleted_at IS NULL
"""
# `intent = 'unknown'` again: a person may have set it since the read. A funnel stage someone set
# is kept. `updated_at` moves with the row.
_SET_INTENT = """
    UPDATE ai.prompts
    SET intent = $2,
        funnel_stage = CASE WHEN funnel_stage = 'unknown' THEN $3 ELSE funnel_stage END,
        updated_at = now()
    WHERE id = ANY($1::uuid[]) AND intent = 'unknown'
"""


async def backfill_prompt_intent(database_url: str) -> dict[str, int] | None:
    """Prompts changed, by the intent they were given; None when the role is not the owner.

    Only `unknown` rows are touched: `ai.prompts` keeps no source for the intent, and an intent a
    person set is never `unknown`."""
    from idraft.ai.intent import classify_prompt_intent

    connection = await asyncpg.connect(database_url, timeout=CONNECT_TIMEOUT_SECONDS)
    try:
        if await connection.fetchval("SELECT current_user") != OWNER_ROLE:
            return None
        groups: dict[tuple[str, str], list[uuid.UUID]] = {}
        for row in await connection.fetch(_UNKNOWN_PROMPTS):
            groups.setdefault(classify_prompt_intent(row["text"]), []).append(row["id"])
        changed: dict[str, int] = {}
        async with connection.transaction():
            for (intent, stage), ids in groups.items():
                if intent == "unknown":
                    continue
                status = await connection.execute(_SET_INTENT, ids, intent, stage)
                changed[intent] = changed.get(intent, 0) + int(status.rsplit(" ", 1)[1])
        return changed
    finally:
        await connection.close()


def _backfill_prompt_intent(arguments: argparse.Namespace) -> int:
    settings = load_migrator_settings()
    try:
        changed = asyncio.run(backfill_prompt_intent(settings.asyncpg_dsn))
    except (OSError, TimeoutError, asyncpg.PostgresError) as error:
        return _fail(_database_problem(error))
    if changed is None:
        return _fail(f"This command must connect as {OWNER_ROLE}. Check DATABASE_URL.")
    lines = [f"{intent}: {count}" for intent, count in sorted(changed.items())]
    sys.stdout.write("\n".join([*lines, f"changed {sum(changed.values())} prompts"]) + "\n")
    return 0


_UNLINKED_PROMPTS = """
    SELECT p.id, p.workspace_id, p.project_id, p.language_code, v.text
    FROM ai.prompts p JOIN ai.prompt_versions v ON v.id = p.current_version_id
    WHERE p.is_active AND p.deleted_at IS NULL
      AND ($1::uuid IS NULL OR p.project_id = $1)
      AND NOT EXISTS (SELECT 1 FROM core.keyword_prompt_links l WHERE l.prompt_id = p.id)
    ORDER BY p.created_at, p.id
"""
# `xmax = 0` is true for a row this statement inserted and false for one it found.
_FIND_OR_MAKE_KEYWORD = """
    INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (workspace_id, normalized_text, language_code)
    DO UPDATE SET text = seo.keywords.text
    RETURNING id, (xmax = 0) AS made
"""
_LINK = """
    INSERT INTO core.keyword_prompt_links
        (workspace_id, project_id, keyword_id, prompt_id, link_type, is_primary, status,
         method_version)
    VALUES ($1, $2, $3, $4, 'generated', true, 'active', $5)
    ON CONFLICT (project_id, keyword_id, prompt_id) DO NOTHING
"""
# Linked keywords of a project with no metrics at any place, and no keyword metrics run waiting.
_WITHOUT_METRICS = """
    SELECT l.workspace_id, l.project_id, array_agg(DISTINCT l.keyword_id) AS keyword_ids
    FROM core.keyword_prompt_links l
    JOIN ai.prompts p ON p.id = l.prompt_id AND p.workspace_id = l.workspace_id
    JOIN core.projects pr ON pr.id = l.project_id AND pr.workspace_id = l.workspace_id
    WHERE l.status = 'active' AND p.is_active AND p.deleted_at IS NULL
      AND pr.deleted_at IS NULL AND ($1::uuid IS NULL OR l.project_id = $1)
      AND NOT EXISTS (SELECT 1 FROM seo.keyword_metrics_current m
                      WHERE m.keyword_id = l.keyword_id AND m.workspace_id = l.workspace_id)
      AND NOT EXISTS (SELECT 1 FROM ops.collection_runs r
                      WHERE r.project_id = l.project_id AND r.workspace_id = l.workspace_id
                        AND r.workload = 'keyword_metrics' AND r.status = 'planned')
    GROUP BY l.workspace_id, l.project_id
"""
_QUEUE_RUN = """
    INSERT INTO ops.collection_runs
        (workspace_id, project_id, workload, window_start, window_end, trigger, status,
         created_by_type, config_snapshot)
    VALUES ($1, $2, 'keyword_metrics', now(), now() + interval '1 hour', 'manual', 'planned',
            'system', $3::jsonb)
"""
HEAD_PHRASE_METHOD = 1
KEYWORD_METRICS_USD = 0.0004


async def link_prompt_keywords(
    database_url: str, *, queue_metrics: bool, project: uuid.UUID | None = None
) -> dict[str, float] | None:
    """What was linked and queued, by name; None when the role is not the owner.

    Each live prompt without any link gets its head phrase as keyword (made when the workspace has
    none) and a primary `generated` link. A prompt whose text has no usable phrase is skipped and
    counted. Nothing is tracked, so no rank check is ever made for these keywords."""
    import json

    from idraft.ai.keyword_phrase import head_phrase
    from idraft.keywords.text import KeywordRefusedError, check_keyword, normalize

    connection = await asyncpg.connect(database_url, timeout=CONNECT_TIMEOUT_SECONDS)
    try:
        if await connection.fetchval("SELECT current_user") != OWNER_ROLE:
            return None
        counts: dict[str, float] = {
            "prompts": 0,
            "linked": 0,
            "keywords_made": 0,
            "keywords_reused": 0,
            "skipped": 0,
        }
        async with connection.transaction():
            for row in await connection.fetch(_UNLINKED_PROMPTS, project):
                counts["prompts"] += 1
                phrase = head_phrase(row["text"])
                try:
                    text = check_keyword(phrase) if phrase else None
                except KeywordRefusedError:
                    text = None
                if text is None:
                    counts["skipped"] += 1
                    continue
                keyword = await connection.fetchrow(
                    _FIND_OR_MAKE_KEYWORD,
                    row["workspace_id"],
                    text,
                    normalize(text),
                    row["language_code"],
                )
                assert keyword is not None
                counts["keywords_made" if keyword["made"] else "keywords_reused"] += 1
                await connection.execute(
                    _LINK,
                    row["workspace_id"],
                    row["project_id"],
                    keyword["id"],
                    row["id"],
                    HEAD_PHRASE_METHOD,
                )
                counts["linked"] += 1
            counts["runs_queued"] = counts["keywords_queued"] = 0
            if queue_metrics:
                for row in await connection.fetch(_WITHOUT_METRICS, project):
                    ids = [str(keyword_id) for keyword_id in row["keyword_ids"]]
                    await connection.execute(
                        _QUEUE_RUN,
                        row["workspace_id"],
                        row["project_id"],
                        json.dumps({"selector": {"keyword_ids": ids}}),
                    )
                    counts["runs_queued"] += 1
                    counts["keywords_queued"] += len(ids)
            counts["estimated_usd"] = round(counts["keywords_queued"] * KEYWORD_METRICS_USD, 4)
        return counts
    finally:
        await connection.close()


def _link_prompt_keywords(arguments: argparse.Namespace) -> int:
    settings = load_migrator_settings()
    try:
        counts = asyncio.run(
            link_prompt_keywords(
                settings.asyncpg_dsn,
                queue_metrics=arguments.queue_metrics,
                project=arguments.project,
            )
        )
    except (OSError, TimeoutError, asyncpg.PostgresError) as error:
        return _fail(_database_problem(error))
    if counts is None:
        return _fail(f"This command must connect as {OWNER_ROLE}. Check DATABASE_URL.")
    sys.stdout.write("\n".join(f"{name}: {value:g}" for name, value in counts.items()) + "\n")
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
    seed = commands.add_parser(
        "seed-eventus",
        help="development only: seed the Eventus Security AI prompt tracking project",
    )
    seed.add_argument("--workspace", default="digibranders", help="the workspace slug")
    seed.add_argument(
        "--fixture",
        type=Path,
        help="the fixture JSON to read (default: fixtures/ai-prompts/eventus-security.json)",
    )
    seed.set_defaults(run=_seed_eventus)
    quality = commands.add_parser(
        "ai-quality",
        help="print the AI quality checks (docs/25 section 9) for one UTC day; reads, never writes",
    )
    quality.add_argument(
        "--day", type=date.fromisoformat, help="the UTC day, YYYY-MM-DD (default: yesterday)"
    )
    quality.add_argument("--workspace", type=uuid.UUID, help="read one workspace only")
    quality.add_argument("--project", type=uuid.UUID, help="read one project only")
    quality.set_defaults(run=_ai_quality)
    backfill = commands.add_parser(
        "backfill-prompt-intent",
        help="set intent and funnel stage from the wording of every prompt whose intent is unknown",
    )
    backfill.set_defaults(run=_backfill_prompt_intent)
    link = commands.add_parser(
        "link-prompt-keywords",
        help="link every live prompt without a keyword to its head search phrase",
    )
    link.add_argument(
        "--queue-metrics",
        action="store_true",
        help="also queue a keyword metrics run for linked keywords that have no metrics yet",
    )
    link.add_argument("--project", type=uuid.UUID, help="one project only")
    link.set_defaults(run=_link_prompt_keywords)
    arguments = parser.parse_args(argv)
    code: int = arguments.run(arguments)
    return code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
