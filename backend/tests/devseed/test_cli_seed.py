"""`python -m idraft.cli seed-eventus`: one command seeds the project, a second run changes
nothing, and the server's settings, a database elsewhere and a broken fixture are refused before
anything is read or connected."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import asyncpg
import pytest

from idraft import cli
from idraft.devseed import fixture, run
from idraft.devseed.guard import LOOPBACK
from tests.api.auth.support import fetch
from tests.conftest import PostgresServer
from tests.devseed.support import gulf_locations, owner_workspace

_UNREACHABLE = "postgresql://app_api:secret-pw@127.0.0.1:9/idraft"


def _environment(
    monkeypatch: pytest.MonkeyPatch,
    *,
    database_url: str,
    app_env: str = "local",
    app_origin: str = "http://localhost:3000",
) -> None:
    monkeypatch.setenv("PROCESS_ROLE", "cli")
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.setenv("APP_ORIGIN", app_origin)
    monkeypatch.setenv("DATABASE_URL", database_url)
    # Settings require one; the seed never connects to it.
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")


def _run(capsys: pytest.CaptureFixture[str], arguments: list[str]) -> tuple[int, str, str]:
    code = cli.main(arguments)
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def _spy(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record, in order, each step the command takes that reads or connects: the settings, the
    guard, the fixture, the seed, and every connection the database driver opens."""
    events: list[str] = []

    def wrap(owner: object, name: str, label: str) -> None:
        original: Callable[..., Any] = getattr(owner, name)

        def spy(*args: Any, **kwargs: Any) -> Any:
            events.append(label)
            return original(*args, **kwargs)

        monkeypatch.setattr(owner, name, spy)

    wrap(cli, "load_settings", "load_settings")
    wrap(cli, "check_development", "check_development")
    # The command imports these inside its handler, after the guard, so patching the module
    # attribute is what it sees.
    wrap(fixture, "load_fixture", "load_fixture")
    wrap(run, "run_seed", "run_seed")
    original_connect: Callable[..., Awaitable[Any]] = asyncpg.connect

    async def connect(*args: Any, **kwargs: Any) -> Any:
        events.append("connect")
        return await original_connect(*args, **kwargs)

    monkeypatch.setattr(asyncpg, "connect", connect)
    return events


def test_one_command_seeds_the_project_and_a_second_run_changes_nothing(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert migrated.host in LOOPBACK, "the test database must be on this machine for the guard"
    _, workspace = asyncio.run(owner_workspace(migrated))
    asyncio.run(gulf_locations(migrated))
    _environment(monkeypatch, database_url=migrated.url("app_api"))

    code, out, err = _run(capsys, ["seed-eventus", "--workspace", workspace.slug])

    assert (code, err) == (0, "")
    assert "created." in out
    assert "Topics: 29 terms made." in out
    assert "Engines turned on: chatgpt_web, gemini_web. Engines widened: none." in out
    assert "WARNING: AI schedules paused: 2." in out
    assert "Prompts: 72 made, 0 found, 0 archived, 0 differing from the fixture." in out
    assert "Active prompts in the workspace: 72 of 150." in out

    code, out, err = _run(capsys, ["seed-eventus", "--workspace", workspace.slug])

    assert (code, err) == (0, "")
    assert "already there" in out
    assert "AI schedules paused: 0." in out
    assert "Prompts: 0 made, 72 found, 0 archived, 0 differing from the fixture." in out
    assert "WARNING" not in out


def test_the_guard_runs_before_the_fixture_is_read_and_before_the_first_connection(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _environment(monkeypatch, database_url=migrated.url("app_api"))
    events = _spy(monkeypatch)

    code, _, err = _run(capsys, ["seed-eventus", "--workspace", "no-such-workspace"])

    assert code == 1
    assert "No active workspace 'no-such-workspace'" in err
    # `dict.fromkeys` keeps the first of each, in order: the driver opens several connections.
    assert list(dict.fromkeys(events)) == [
        "load_settings",
        "check_development",
        "load_fixture",
        "run_seed",
        "connect",
    ]


def test_a_refused_environment_reads_no_fixture_and_opens_no_connection(
    migrated: PostgresServer,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    _environment(
        monkeypatch,
        database_url=migrated.url("app_api"),
        app_env="production",
        app_origin="https://app.idraft.ai",
    )
    events = _spy(monkeypatch)

    code, out, err = _run(capsys, ["seed-eventus", "--fixture", str(broken)])

    assert (code, out) == (1, "")
    # The refusal comes first: the broken fixture is never looked at.
    assert err.startswith("Refused: APP_ENV is production")
    assert "is not valid" not in err
    assert events == ["load_settings", "check_development"]


def test_the_servers_settings_are_refused_and_nothing_is_written(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _, workspace = asyncio.run(owner_workspace(migrated))
    _environment(
        monkeypatch,
        database_url=migrated.url("app_api"),
        app_env="production",
        app_origin="https://app.idraft.ai",
    )

    code, out, err = _run(capsys, ["seed-eventus", "--workspace", workspace.slug])

    assert (code, out) == (1, "")
    assert err.startswith("Refused: APP_ENV is production")
    assert err.endswith("Nothing was written.\n")
    projects = asyncio.run(
        fetch(migrated, "SELECT 1 FROM core.projects WHERE workspace_id = $1", workspace.id)
    )
    assert projects == []


def test_a_database_on_another_host_is_refused_before_connecting(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _environment(
        monkeypatch, database_url="postgresql://app_api:secret-pw@db.example.com:5432/idraft"
    )
    events = _spy(monkeypatch)

    code, _, err = _run(capsys, ["seed-eventus"])

    assert code == 1
    assert "not on this machine" in err
    assert "secret-pw" not in err
    assert "connect" not in events


def test_a_broken_fixture_is_refused_before_connecting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    _environment(monkeypatch, database_url=_UNREACHABLE)
    events = _spy(monkeypatch)

    code, _, err = _run(capsys, ["seed-eventus", "--fixture", str(broken)])

    assert code == 1
    assert "is not valid" in err
    assert "connect" not in events


def test_an_unreachable_database_is_a_message_without_the_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _environment(monkeypatch, database_url=_UNREACHABLE)

    code, out, err = _run(capsys, ["seed-eventus"])

    assert (code, out) == (1, "")
    assert err.startswith("The database could not be used (")
    assert "secret-pw" not in err
    assert "127.0.0.1" not in err
    assert "Traceback" not in err


def test_a_missing_workspace_is_named(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _environment(monkeypatch, database_url=migrated.url("app_api"))

    code, _, err = _run(capsys, ["seed-eventus", "--workspace", "no-such-workspace"])

    assert code == 1
    assert "No active workspace 'no-such-workspace'" in err
