"""`python -m idraft.cli create-operator`: the way the first account comes to exist."""

import asyncio
import io
import subprocess
import sys
import uuid

import httpx
import pytest

from idraft import cli
from idraft.api.auth.passwords import verify_password
from tests.api.auth.support import execute, fetch, fetchrow
from tests.conftest import BASE_URL, PostgresServer

PASSWORD = "an operator passphrase 9"


def _email() -> str:
    return f"operator-{uuid.uuid4().hex[:10]}@agency.example"


def _run(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    arguments: list[str],
    *,
    database_url: str | None,
    typed: str | bytes = PASSWORD + "\n",
) -> tuple[int, str, str]:
    if database_url is None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    else:
        monkeypatch.setenv("DATABASE_URL", database_url)
    raw = typed if isinstance(typed, bytes) else typed.encode()
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8"))
    code = cli.main(arguments)
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_it_creates_a_verified_platform_operator(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    email = _email()

    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", email, "--name", "Asha Operator"],
        database_url=migrated.url("migrator"),
    )

    assert (code, err) == (0, "")
    assert out == f"Created platform operator {email}.\n"
    assert PASSWORD not in out


async def test_the_operator_it_creates_can_sign_in(
    client: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    email = _email()

    created = await cli.create_operator(
        migrated.url("migrator"), email=email, name="Asha Operator", password=PASSWORD
    )

    assert created == cli.Outcome.CREATED
    row = await fetchrow(migrated, "SELECT * FROM auth.users WHERE email = $1", email)
    assert row["is_platform_operator"] is True
    assert row["email_verified_at"] is not None
    assert row["name"] == "Asha Operator"
    assert verify_password(row["password_hash"], PASSWORD)
    audit = await fetch(
        migrated,
        "SELECT actor_type, actor_id, action, target_type FROM ops.audit_logs WHERE target_id = $1",
        str(row["id"]),
    )
    assert [tuple(item.values()) for item in audit] == [
        ("system", "cli", "auth.operator_created", "user")
    ]
    response = await client.post(
        "/api/v1/auth/sign-in",
        json={"email": email, "password": PASSWORD},
        headers={"Origin": BASE_URL},
    )
    assert response.json() == {"status": "signed_in"}


async def test_an_existing_email_is_left_alone(migrated: PostgresServer) -> None:
    email = _email()
    dsn = migrated.url("migrator")
    assert await cli.create_operator(dsn, email=email, name="First", password=PASSWORD) == (
        cli.Outcome.CREATED
    )

    again = await cli.create_operator(
        dsn, email=email.upper(), name="Second", password="a different passphrase"
    )

    assert again == cli.Outcome.EXISTS_AS_OPERATOR
    row = await fetchrow(
        migrated, "SELECT name, password_hash FROM auth.users WHERE email = $1", email
    )
    assert row["name"] == "First"
    assert verify_password(row["password_hash"], PASSWORD)


def test_a_second_run_for_the_same_email_exits_with_a_reason(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    email = _email()
    arguments = ["create-operator", "--email", email, "--name", "Asha"]
    assert _run(monkeypatch, capsys, arguments, database_url=migrated.url("migrator"))[0] == 0

    code, out, err = _run(monkeypatch, capsys, arguments, database_url=migrated.url("migrator"))

    assert (code, out) == (1, "")
    assert err == (
        f"An account with the email {email} already exists and is a platform operator. "
        "Nothing was changed.\n"
    )


@pytest.mark.parametrize("role", ["app_api", "app_worker", "superuser"])
def test_it_refuses_to_run_as_any_role_but_migrator(
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    role: str,
) -> None:
    email = _email()
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", email, "--name", "Asha"],
        database_url=migrated.url(role),
    )
    assert (code, out) == (1, "")
    assert err == "This command must connect as migrator. Check DATABASE_URL.\n"


@pytest.mark.parametrize(
    ("typed", "reason"),
    [
        ("short\n", "at least 12 characters"),
        ("x" * 129 + "\n", "at most 128 characters"),
        ("\n", "at least 12 characters"),
        ("", "at least 12 characters"),
    ],
)
def test_a_weak_password_is_refused_with_its_reason_and_not_echoed(
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    typed: str,
    reason: str,
) -> None:
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", _email(), "--name", "Asha"],
        database_url=migrated.url("migrator"),
        typed=typed,
    )
    assert (code, out) == (1, "")
    assert reason in err
    assert typed.strip() == "" or typed.strip() not in err


def test_a_password_containing_the_email_name_is_refused(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", "asha.rao@agency.example", "--name", "Asha"],
        database_url=migrated.url("migrator"),
        typed="asha.rao is my password\n",
    )
    assert code == 1
    assert "must not contain the email" in err


@pytest.mark.parametrize(
    "arguments",
    [
        ["create-operator", "--email", "not an address", "--name", "Asha"],
        ["create-operator", "--email", "a@b.example", "--name", ""],
        ["create-operator", "--email", "a@b.example", "--name", "x" * 121],
        ["create-operator", "--email", "a‮@b.example", "--name", "Asha"],
    ],
)
def test_a_malformed_email_or_name_is_refused(
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    arguments: list[str],
) -> None:
    code, out, err = _run(monkeypatch, capsys, arguments, database_url=migrated.url("migrator"))
    assert (code, out) == (1, "")
    assert err.startswith(("The email", "The name"))


def test_it_needs_a_database_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as stopped:
        _run(
            monkeypatch,
            capsys,
            ["create-operator", "--email", _email(), "--name", "Asha"],
            database_url=None,
        )
    assert stopped.value.code == 2


def test_an_unreachable_database_is_reported_without_the_password(
    black_hole: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "CONNECT_TIMEOUT_SECONDS", 0.3)
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", _email(), "--name", "Asha"],
        database_url=f"postgresql://migrator:SECRETPW@{black_hole}/idraft",
    )
    assert (code, out) == (1, "")
    assert err == "Could not connect to the database.\n"


def test_no_command_prints_usage(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as stopped:
        cli.main([])
    assert stopped.value.code == 2
    assert "create-operator" in capsys.readouterr().err


def test_an_existing_account_that_is_not_an_operator_is_not_promoted(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    email = _email()
    asyncio.run(
        execute(
            migrated,
            "INSERT INTO auth.users (email, name, password_hash) VALUES ($1, 'Member', 'x')",
            email,
        )
    )

    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", email, "--name", "Asha"],
        database_url=migrated.url("migrator"),
    )

    assert (code, out) == (1, "")
    assert "is not a platform operator" in err
    assert "does not promote accounts" in err
    row = asyncio.run(
        fetchrow(
            migrated, "SELECT is_platform_operator, name FROM auth.users WHERE email = $1", email
        )
    )
    assert (row["is_platform_operator"], row["name"]) == (False, "Member")


@pytest.mark.parametrize(
    "typed", [b"\xff\xfe invalid bytes passphrase\n", b"caf\xe9 au lait please\n"]
)
def test_a_password_that_is_not_utf8_is_refused_without_a_traceback(
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    typed: bytes,
) -> None:
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", _email(), "--name", "Asha"],
        database_url=migrated.url("migrator"),
        typed=typed,
    )
    assert (code, out, err) == (1, "", "The password must be UTF-8 text.\n")


def test_closed_standard_input_is_reported(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", migrated.url("migrator"))
    monkeypatch.setattr("sys.stdin", None)
    code = cli.main(["create-operator", "--email", _email(), "--name", "Asha"])
    assert code == 1
    assert capsys.readouterr().err == "No password was given: standard input is closed.\n"


def test_spaces_in_a_password_are_kept(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    email = _email()
    typed = "  spaces around the phrase  "
    code, _, _ = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", email, "--name", "Asha"],
        database_url=migrated.url("migrator"),
        typed=typed + "\r\nan ignored second line\n",
    )
    row = asyncio.run(fetchrow(migrated, "SELECT * FROM auth.users WHERE email = $1", email))
    assert code == 0
    assert verify_password(row["password_hash"], typed)
    assert not verify_password(row["password_hash"], typed.strip())


def test_the_stored_email_keeps_its_case_and_the_audit_row_has_no_workspace(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    email = "Ops." + _email()
    _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", email, "--name", "Asha"],
        database_url=migrated.url("migrator"),
    )
    row = asyncio.run(
        fetchrow(
            migrated,
            "SELECT u.email, a.workspace_id FROM auth.users u "
            "JOIN ops.audit_logs a ON a.target_id = u.id::text WHERE u.email = $1",
            email.lower(),
        )
    )
    assert (row["email"], row["workspace_id"]) == (email, None)


@pytest.mark.parametrize(
    ("database", "role", "message"),
    [
        ("idraft_not_there", "migrator", "The database named in DATABASE_URL does not exist.\n"),
        (
            "unmigrated",
            "migrator",
            "The schema is not migrated. Run python -m idraft.db.migrate first.\n",
        ),
    ],
)
def test_a_database_problem_is_named_without_the_connection_string(
    pg: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    database: str,
    role: str,
    message: str,
) -> None:
    if database == "unmigrated":
        asyncio.run(pg.create_database("cli_unmigrated"))
        database = "cli_unmigrated"
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", _email(), "--name", "Asha"],
        database_url=pg.url(role, database),
    )
    assert (code, out, err) == (1, "", message)


def test_wrong_credentials_are_named_as_such(
    pg: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    url = pg.url("migrator").replace("migrator-pw", "WRONG-SECRET")
    code, out, err = _run(
        monkeypatch,
        capsys,
        ["create-operator", "--email", _email(), "--name", "Asha"],
        database_url=url,
    )
    assert (code, out, err) == (1, "", "The database refused the credentials in DATABASE_URL.\n")


def test_help_exits_cleanly_and_an_unknown_command_does_not(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as helped:
        cli.main(["--help"])
    with pytest.raises(SystemExit) as unknown:
        cli.main(["promote-everyone"])
    assert (helped.value.code, unknown.value.code) == (0, 2)


def test_importing_the_cli_does_not_build_the_api() -> None:
    script = (
        "import sys, idraft.cli; print('fastapi' in sys.modules, 'idraft.api.main' in sys.modules)"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, check=True, timeout=60
    )
    assert result.stdout.strip() == "False False"
