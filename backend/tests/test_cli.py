"""`python -m sightline.cli create-operator`: the way the first account comes to exist."""

import io
import uuid

import httpx
import pytest

from sightline import cli
from sightline.api.auth.passwords import verify_password
from tests.api.auth.support import fetch, fetchrow
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
    typed: str = PASSWORD + "\n",
) -> tuple[int, str, str]:
    if database_url is None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    else:
        monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("sys.stdin", io.StringIO(typed))
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

    assert again == cli.Outcome.EXISTS
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
    assert err == f"An account with the email {email} already exists. Nothing was changed.\n"


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
    assert "must connect as migrator" in err
    assert "pw" not in err, "the connection string must not be echoed"


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
        database_url=f"postgresql://migrator:SECRETPW@{black_hole}/sightline",
    )
    assert (code, out) == (1, "")
    assert err == "Could not connect to the database.\n"


def test_no_command_prints_usage(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as stopped:
        cli.main([])
    assert stopped.value.code == 2
    assert "create-operator" in capsys.readouterr().err
