# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A Python backend project that boots a FastAPI app with validated settings, structured logs, request ids, RFC 9457 errors, health and readiness endpoints, a PostgreSQL connection with the tenant transaction helper, Alembic migrations, and a test suite that runs against real PostgreSQL 18 and Redis 8 containers.

**Architecture:** One `uv` project in `backend/` with the package layout locked in ADR-022 (`idraft.{api, worker, domain, extraction, providers, collectors, db, storage, config}`). import-linter enforces the purity rules. The app is built by a factory (`create_app(settings)`) so tests inject settings and nothing is read from the environment at import time. Migrations are SQL inside Alembic revisions, with the version table in the `ops` schema.

**Tech Stack:** Python 3.13, uv, FastAPI, Pydantic v2 and pydantic-settings, SQLAlchemy 2 (async, asyncpg), Alembic, redis-py (asyncio), structlog, Sentry SDK, pytest with pytest-asyncio, Testcontainers (`postgres:18`, `redis:8`), ruff, mypy (strict), import-linter.

**Source documents:** `docs/adr/ADR-022-python-backend-simplified-platform.md`, `docs/03-system-architecture.md` section 4, `docs/19-api-specification.md` sections 2.7 and 3.12, `docs/25-observability.md` section 3, `docs/26-testing-quality.md` section 2.2, `docs/04-data-model.md` sections 2, 13 and 14, `docs/22-infrastructure-devops.md` section 4.1.

**Out of scope (later plans):** tables and RLS policies (plan 2), the auth module (plan 3), the Taskiq worker, ledger and dispatcher (plan 4), the DataForSEO client and Phase 0 spikes (plan 5), droplet and deploy (plan 6).

**Decisions this plan makes (each is written back into the docs in Task 12):**

| Decision | Value | Why |
|---|---|---|
| Type checker | mypy, strict | First-class SQLAlchemy 2 and Pydantic plugins; closes open item L5 |
| Request id | `req_` plus the 26-character Crockford base32 form of a UUIDv7 | Doc 19 shows `req_01J9...`, doc 25 says UUIDv7; this is both |
| `/api/healthz` | Liveness only, `{"status":"ok"}`, no release, no database call | Doc 19 section 3.12 owns the route; doc 22 section 4.5 said otherwise |
| uvicorn entry | `idraft.api.main:create_app --factory` | No settings read at import time |
| RLS setting | Policies compare with `NULLIF(current_setting('app.workspace_id', true), '')::uuid` | After a transaction that used `set_config(..., true)`, PostgreSQL leaves the custom setting as an empty string on that connection, and `''::uuid` raises |
| `pg_stat_statements` | Created by the infrastructure init script, not by a migration | It is not a trusted extension, and the `migrator` role is not a superuser |
| Local ports | PostgreSQL on 54329, Redis on 63799 | This machine already runs Homebrew PostgreSQL 16 and Redis on the default ports |

**Shell note for this machine:** Docker Desktop is running but its CLI is not on the PATH. Prefix Docker and test commands with:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

---

## File structure

```
.gitignore
.github/workflows/backend.yml          CI: ruff, mypy, import-linter, pytest
backend/
  .python-version                      3.13
  pyproject.toml                       project, tools, import-linter contracts
  uv.lock
  alembic.ini                          developer CLI only; runtime builds its config in code
  Dockerfile                           target `api`
  .dockerignore
  .env.example                         local development values (no secrets)
  README.md                            how to run, test and migrate
  openapi/v1.json                      committed OpenAPI document
  src/idraft/
    __init__.py                        __version__
    py.typed
    api/__init__.py
    api/main.py                        create_app(settings), lifespan
    api/request_id.py                  new_request_id(), RequestIdMiddleware
    api/problems.py                    ProblemError hierarchy, handlers
    api/health.py                      /api/healthz, /api/readyz
    api/openapi.py                     build_openapi(), `python -m idraft.api.openapi`
    config/__init__.py
    config/settings.py                 Settings, load_settings(), to_sqlalchemy_url()
    config/logging.py                  configure_logging(), redaction
    config/sentry.py                   init_sentry()
    db/__init__.py
    db/engine.py                       create_engine(), create_session_factory(), workspace_transaction()
    db/migrate.py                      alembic_config(), head_revision(), current_revision(), upgrade_to_head(), main()
    db/migrations/env.py
    db/migrations/script.py.mako
    db/migrations/versions/0001_baseline.py
    worker/__init__.py  domain/__init__.py  extraction/__init__.py
    providers/__init__.py  collectors/__init__.py  storage/__init__.py
  tests/
    conftest.py                        containers, settings, app and client fixtures
    test_package.py
    config/test_settings.py
    config/test_logging.py
    config/test_sentry.py
    api/test_request_id.py
    api/test_problems.py
    api/test_health.py
    api/test_openapi.py
    db/test_engine.py
    db/test_migrations.py
infra/compose/docker-compose.dev.yml   postgres:18 and redis:8 for local development
```

---

### Task 0: Put the repository under git

**Files:**
- Create: `.gitignore`

- [x] **Step 1: Write `.gitignore`**

```gitignore
# dependencies
node_modules/
.pnpm-store/

# python
__pycache__/
*.py[cod]
.venv/
.mypy_cache/
.ruff_cache/
.pytest_cache/
.coverage
htmlcov/
.hypothesis/

# builds
.next/
dist/
*.tsbuildinfo
apps/web/design-preview/vendor/

# secrets and local config
.env
.env.*
!.env.example

# os and editors
.DS_Store
.idea/
.vscode/
```

- [x] **Step 2: Initialise and make the baseline commit**

```bash
cd "/Users/a12345/Desktop/AI/SEO Tool"
git init -b main
git add -A
git status --short | wc -l
git commit -m "Baseline: specification package, design system and preview"
```

Expected: a commit on `main`; `git status` is clean.

The working tree is shared with the UI session. From here on, every commit in this plan stages only its own paths (`backend/`, `infra/`, `.github/`, named docs). Never `git add -A` again and never switch branches in this checkout.

---

### Task 1: Project scaffold

**Files:**
- Create: `backend/.python-version`, `backend/pyproject.toml`, `backend/src/idraft/__init__.py`, `backend/src/idraft/py.typed`, the nine package `__init__.py` files, `backend/tests/test_package.py`

- [x] **Step 1: Create the project files**

`backend/.python-version`:

```
3.13
```

`backend/pyproject.toml`:

```toml
[project]
name = "idraft"
version = "0.1.0"
description = "SEO and AI search visibility platform: API and worker"
requires-python = ">=3.13,<3.14"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/idraft"]

[tool.ruff]
line-length = 100
target-version = "py313"
src = ["src", "tests"]

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM", "RUF", "ASYNC", "PT", "C4", "T20", "N"]

[tool.ruff.lint.isort]
known-first-party = ["idraft"]

[tool.mypy]
python_version = "3.13"
strict = true
warn_unreachable = true
files = ["src", "tests"]
plugins = ["pydantic.mypy"]

[[tool.mypy.overrides]]
module = ["testcontainers.*", "asgi_lifespan.*"]
ignore_missing_imports = true

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
addopts = "-ra --strict-markers --cov=idraft --cov-branch --cov-report=term-missing:skip-covered --cov-fail-under=90"

[tool.coverage.run]
omit = ["src/idraft/db/migrations/*"]

[tool.importlinter]
root_package = "idraft"
include_external_packages = true

[[tool.importlinter.contracts]]
name = "domain is pure: no internal imports, no I/O libraries"
type = "forbidden"
source_modules = ["idraft.domain"]
forbidden_modules = [
  "idraft.api", "idraft.worker", "idraft.collectors", "idraft.providers",
  "idraft.db", "idraft.storage", "idraft.config", "idraft.extraction",
  "sqlalchemy", "asyncpg", "redis", "httpx", "fastapi", "starlette",
]

[[tool.importlinter.contracts]]
name = "extraction is pure: no internal imports, no I/O libraries"
type = "forbidden"
source_modules = ["idraft.extraction"]
forbidden_modules = [
  "idraft.api", "idraft.worker", "idraft.collectors", "idraft.providers",
  "idraft.db", "idraft.storage", "idraft.config", "idraft.domain",
  "sqlalchemy", "asyncpg", "redis", "httpx", "fastapi", "starlette",
]

[[tool.importlinter.contracts]]
name = "providers never touch the database"
type = "forbidden"
source_modules = ["idraft.providers"]
forbidden_modules = [
  "idraft.db", "idraft.api", "idraft.worker", "idraft.collectors",
  "sqlalchemy", "asyncpg",
]

[[tool.importlinter.contracts]]
name = "lower layers never import the entrypoints"
type = "forbidden"
source_modules = ["idraft.collectors", "idraft.db", "idraft.storage", "idraft.config"]
forbidden_modules = ["idraft.api", "idraft.worker"]
```

`backend/src/idraft/__init__.py`:

```python
"""idraft.ai: SEO and AI search visibility platform."""

__version__ = "0.1.0"
```

`backend/src/idraft/py.typed`: empty file.

Each of `api`, `worker`, `domain`, `extraction`, `providers`, `collectors`, `db`, `storage`, `config` gets an `__init__.py` holding only its one-line docstring:

| Package | Docstring |
|---|---|
| `api` | `"""FastAPI application: routers, auth, tenancy, errors."""` |
| `worker` | `"""Taskiq tasks, planner and dispatcher ticks, maintenance schedule."""` |
| `domain` | `"""Pure business logic: metrics, rank derivation, statistics. No I/O."""` |
| `extraction` | `"""Pure extraction: canonicalizer, alias matcher, parsers. No I/O."""` |
| `providers` | `"""Provider adapters. Never imports the database layer."""` |
| `collectors` | `"""Workload orchestration: planners, submitters, fetchers, ingesters."""` |
| `db` | `"""Database engine, sessions, migrations and repository helpers."""` |
| `storage` | `"""Object storage client and raw payload reader and writer."""` |
| `config` | `"""Settings, logging and error reporting configuration."""` |

- [x] **Step 2: Add dependencies (uv resolves and pins current versions in `uv.lock`)**

```bash
cd "/Users/a12345/Desktop/AI/SEO Tool/backend"
uv add fastapi "uvicorn[standard]" pydantic pydantic-settings "sqlalchemy[asyncio]" asyncpg alembic redis structlog "sentry-sdk[fastapi]"
uv add --dev pytest pytest-asyncio pytest-cov httpx asgi-lifespan "testcontainers[postgres,redis]" ruff mypy import-linter
```

Expected: `uv.lock` and `.venv/` created, no resolution errors.

- [x] **Step 3: Write the first test**

`backend/tests/test_package.py`:

```python
import idraft


def test_package_exposes_version() -> None:
    assert idraft.__version__ == "0.1.0"
```

- [x] **Step 4: Run every check**

```bash
uv run pytest --no-cov -q
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run lint-imports
```

Expected: 1 test passes; ruff, mypy and all 4 import contracts pass.

- [x] **Step 5: Commit**

```bash
cd "/Users/a12345/Desktop/AI/SEO Tool"
git add .gitignore backend
git commit -m "Scaffold the backend project with lint, types and import contracts"
```

---

### Task 2: Settings

**Files:**
- Create: `backend/src/idraft/config/settings.py`
- Test: `backend/tests/config/test_settings.py` (and empty `backend/tests/config/__init__.py`, `backend/tests/__init__.py`)

- [x] **Step 1: Write the failing tests**

```python
import pytest
from pydantic import ValidationError

from idraft.config.settings import Settings, load_settings, to_sqlalchemy_url

BASE_ENV = {
    "APP_ORIGIN": "https://app.example.com",
    "DATABASE_URL": "postgresql://app_api:pw@postgres:5432/sightline",
    "REDIS_URL": "redis://app:pw@redis:6379/0",
}


def _set(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name in ("APP_ORIGIN", "DATABASE_URL", "REDIS_URL", "LOG_LEVEL", "DB_POOL_SIZE",
                 "DB_STATEMENT_TIMEOUT", "SENTRY_DSN", "PROCESS_ROLE", "RELEASE_SHA", "APP_ENV"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)


def test_loads_required_values_and_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, BASE_ENV)
    settings = Settings()
    assert settings.app_origin == "https://app.example.com"
    assert settings.process_role == "api"
    assert settings.release_sha == "dev"
    assert settings.environment == "local"
    assert settings.log_level == "info"
    assert settings.db_pool_size == 10
    assert settings.db_statement_timeout == "15s"
    assert settings.sentry_dsn is None


def test_app_origin_has_no_trailing_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "APP_ORIGIN": "https://app.example.com/"})
    assert Settings().app_origin == "https://app.example.com"


def test_sqlalchemy_url_uses_the_asyncpg_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, BASE_ENV)
    assert Settings().sqlalchemy_url == "postgresql+asyncpg://app_api:pw@postgres:5432/sightline"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgresql://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("postgres://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("postgresql+asyncpg://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
    ],
)
def test_to_sqlalchemy_url(url: str, expected: str) -> None:
    assert to_sqlalchemy_url(url) == expected


@pytest.mark.parametrize(
    "override",
    [
        {"DATABASE_URL": "mysql://u:p@h/db"},
        {"REDIS_URL": "http://redis:6379"},
        {"APP_ORIGIN": "app.example.com"},
        {"DB_STATEMENT_TIMEOUT": "fast"},
        {"DB_POOL_SIZE": "0"},
        {"LOG_LEVEL": "verbose"},
    ],
)
def test_rejects_invalid_values(monkeypatch: pytest.MonkeyPatch, override: dict[str, str]) -> None:
    _set(monkeypatch, {**BASE_ENV, **override})
    with pytest.raises(ValidationError):
        Settings()


def test_load_settings_exits_and_names_the_field_without_its_value(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _set(monkeypatch, {**BASE_ENV, "DATABASE_URL": "mysql://user:hunter2@h/db"})
    with pytest.raises(SystemExit) as exit_info:
        load_settings()
    assert exit_info.value.code == 2
    err = capsys.readouterr().err
    assert "DATABASE_URL" in err
    assert "hunter2" not in err


def test_load_settings_reports_missing_variables(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _set(monkeypatch, {"APP_ORIGIN": "https://app.example.com"})
    with pytest.raises(SystemExit):
        load_settings()
    err = capsys.readouterr().err
    assert "DATABASE_URL" in err
    assert "REDIS_URL" in err
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/config/test_settings.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'idraft.config.settings'`

- [x] **Step 3: Implement**

```python
"""Process settings, read once from the environment and validated at start.

Names match the Compose file (docs/22-infrastructure-devops.md section 4.1). Nothing here reads a
file: local development passes values with `uv run --env-file .env`.
"""

from __future__ import annotations

import re
import sys
from typing import Literal

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_POSTGRES_SCHEMES = ("postgresql+asyncpg://", "postgresql://", "postgres://")
_TIMEOUT_PATTERN = re.compile(r"^[1-9]\d*(ms|s|min)$")


def to_sqlalchemy_url(database_url: str) -> str:
    """Return the URL with the asyncpg driver, which is the only driver the platform uses."""
    for scheme in _POSTGRES_SCHEMES:
        if database_url.startswith(scheme):
            return "postgresql+asyncpg://" + database_url[len(scheme) :]
    raise ValueError("must be a postgresql:// URL")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", frozen=True)

    process_role: Literal["api", "worker", "migrator", "cli"] = "api"
    release_sha: str = "dev"
    environment: Literal["local", "test", "production"] = Field(
        default="local", validation_alias="APP_ENV"
    )
    app_origin: str
    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"
    database_url: str
    db_pool_size: int = Field(default=10, ge=1, le=50)
    db_statement_timeout: str = "15s"
    redis_url: str
    sentry_dsn: str | None = None

    @field_validator("app_origin")
    @classmethod
    def _validate_origin(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("must start with https:// or http://")
        return value.rstrip("/")

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        to_sqlalchemy_url(value)
        return value

    @field_validator("redis_url")
    @classmethod
    def _validate_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://")):
            raise ValueError("must be a redis:// or rediss:// URL")
        return value

    @field_validator("db_statement_timeout")
    @classmethod
    def _validate_timeout(cls, value: str) -> str:
        if not _TIMEOUT_PATTERN.fullmatch(value):
            raise ValueError("must be a duration such as 500ms, 15s or 2min")
        return value

    @field_validator("sentry_dsn")
    @classmethod
    def _empty_dsn_is_none(cls, value: str | None) -> str | None:
        return value or None

    @property
    def sqlalchemy_url(self) -> str:
        return to_sqlalchemy_url(self.database_url)


def _env_name(field: str) -> str:
    info = Settings.model_fields.get(field)
    alias = info.validation_alias if info is not None else None
    return alias if isinstance(alias, str) else field.upper()


def load_settings() -> Settings:
    """Build Settings, or stop the process with a message that names fields and never values."""
    try:
        return Settings()
    except ValidationError as error:
        lines = [
            f"  {_env_name(str(item['loc'][0]))}: {item['msg']}" for item in error.errors()
        ]
        sys.stderr.write("Invalid configuration:\n" + "\n".join(lines) + "\n")
        raise SystemExit(2) from None
```

- [x] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/config/test_settings.py --no-cov -q`
Expected: all pass. Then `uv run ruff check . && uv run mypy`.

- [x] **Step 5: Commit**

```bash
git add backend && git commit -m "Add validated settings that fail fast without leaking values"
```

---

### Task 3: Structured logging with redaction

**Files:**
- Create: `backend/src/idraft/config/logging.py`
- Test: `backend/tests/config/test_logging.py`

- [x] **Step 1: Write the failing tests**

```python
import io
import json

import structlog

from idraft.config.logging import REDACT_KEYS, configure_logging


def _capture(level: str = "info") -> io.StringIO:
    stream = io.StringIO()
    configure_logging(service="api", version="abc123", level=level, stream=stream)
    return stream


def _lines(stream: io.StringIO) -> list[dict[str, object]]:
    return [json.loads(line) for line in stream.getvalue().splitlines()]


def test_emits_one_json_object_with_the_fixed_fields() -> None:
    stream = _capture()
    structlog.get_logger().info("request finished", status_code=200, duration_ms=12)
    (line,) = _lines(stream)
    assert line["msg"] == "request finished"
    assert line["level"] == "info"
    assert line["service"] == "api"
    assert line["version"] == "abc123"
    assert line["status_code"] == 200
    assert str(line["ts"]).endswith("Z")
    assert "event" not in line


def test_respects_the_minimum_level() -> None:
    stream = _capture(level="warning")
    logger = structlog.get_logger()
    logger.info("hidden")
    logger.warning("shown")
    assert [line["msg"] for line in _lines(stream)] == ["shown"]


def test_redacts_every_secret_shaped_key_at_any_depth() -> None:
    stream = _capture()
    payload = {key: "s3cret" for key in REDACT_KEYS}
    structlog.get_logger().info(
        "outbound call",
        headers={"Authorization": "Basic s3cret", "Accept": "application/json"},
        nested=[{"inner": payload}],
        **{"password": "s3cret"},
    )
    raw = stream.getvalue()
    assert "s3cret" not in raw
    (line,) = _lines(stream)
    assert line["headers"] == {"Authorization": "[redacted]", "Accept": "application/json"}


def test_context_variables_are_merged() -> None:
    stream = _capture()
    structlog.contextvars.bind_contextvars(request_id="req_TEST")
    try:
        structlog.get_logger().info("with context")
    finally:
        structlog.contextvars.clear_contextvars()
    assert _lines(stream)[0]["request_id"] == "req_TEST"


def test_exceptions_become_an_err_object() -> None:
    stream = _capture()
    try:
        raise ValueError("boom")
    except ValueError:
        structlog.get_logger().exception("task failed")
    (line,) = _lines(stream)
    err = line["err"]
    assert isinstance(err, dict)
    assert err["type"] == "ValueError"
    assert err["message"] == "boom"
    assert "ValueError: boom" in str(err["stack"])
    assert "exc_info" not in line
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/config/test_logging.py --no-cov -q`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

```python
"""One JSON object per line on stdout, with secrets removed (docs/25-observability.md section 3)."""

from __future__ import annotations

import logging
import sys
import traceback
from collections.abc import Mapping, MutableMapping, Sequence
from typing import Any, TextIO

import structlog
from structlog.typing import EventDict, Processor, WrappedLogger

REDACT_KEYS: frozenset[str] = frozenset(
    {
        "authorization", "cookie", "set-cookie", "x-api-key",
        "password", "token", "access_token", "refresh_token", "id_token",
        "api_key", "apikey", "secret", "client_secret", "totp_secret",
        "dek", "dek_wrapped", "ciphertext",
    }
)
_CENSOR = "[redacted]"
_LEVELS: Mapping[str, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}


def _redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: _CENSOR if str(key).lower() in REDACT_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_redact(item) for item in value]
    return value


def _redact_processor(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    redacted: MutableMapping[str, Any] = _redact(event_dict)
    return redacted


def _exception_processor(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    exc_info = event_dict.pop("exc_info", None)
    if not exc_info:
        return event_dict
    error = exc_info if isinstance(exc_info, BaseException) else sys.exc_info()[1]
    if error is not None:
        event_dict["err"] = {
            "type": type(error).__name__,
            "message": str(error),
            "stack": "".join(traceback.format_exception(error)),
        }
    return event_dict


def configure_logging(
    *, service: str, version: str, level: str, stream: TextIO | None = None
) -> None:
    def add_service(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
        event_dict["service"] = service
        event_dict["version"] = version
        return event_dict

    processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
        add_service,
        _exception_processor,
        structlog.processors.EventRenamer("msg"),
        _redact_processor,
        structlog.processors.JSONRenderer(),
    ]
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(_LEVELS[level]),
        logger_factory=structlog.PrintLoggerFactory(file=stream or sys.stdout),
        cache_logger_on_first_use=False,
    )
```

- [x] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/config/test_logging.py --no-cov -q`, then `uv run ruff check . && uv run mypy`.

- [x] **Step 5: Commit**

```bash
git add backend && git commit -m "Add JSON logging with secret redaction"
```

---

### Task 4: Request ids

**Files:**
- Create: `backend/src/idraft/api/request_id.py`
- Test: `backend/tests/api/test_request_id.py` (and empty `backend/tests/api/__init__.py`)

- [x] **Step 1: Write the failing tests**

```python
import re
import time

import httpx
import structlog
from fastapi import FastAPI, Request

from idraft.api.request_id import REQUEST_ID_PATTERN, RequestIdMiddleware, new_request_id


def test_request_id_shape() -> None:
    value = new_request_id()
    assert REQUEST_ID_PATTERN.fullmatch(value)
    assert re.fullmatch(r"req_[0-9A-HJKMNP-TV-Z]{26}", value)


def test_request_ids_are_unique_and_sort_by_time() -> None:
    first = new_request_id()
    time.sleep(0.002)
    second = new_request_id()
    assert first != second
    assert first < second


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/echo")
    async def echo(request: Request) -> dict[str, object]:
        return {
            "state": request.state.request_id,
            "context": structlog.contextvars.get_contextvars().get("request_id"),
        }

    return app


async def _get(headers: dict[str, str] | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/echo", headers=headers)


async def test_generates_an_id_and_returns_it_in_the_header() -> None:
    response = await _get()
    header = response.headers["X-Request-Id"]
    assert REQUEST_ID_PATTERN.fullmatch(header)
    assert response.json() == {"state": header, "context": header}


async def test_keeps_a_well_formed_inbound_id() -> None:
    inbound = new_request_id()
    response = await _get({"X-Request-Id": inbound})
    assert response.headers["X-Request-Id"] == inbound


async def test_replaces_a_malformed_inbound_id() -> None:
    response = await _get({"X-Request-Id": "x\r\nSet-Cookie: a=b"})
    assert REQUEST_ID_PATTERN.fullmatch(response.headers["X-Request-Id"])


async def test_context_is_cleared_after_the_request() -> None:
    await _get()
    assert "request_id" not in structlog.contextvars.get_contextvars()
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/api/test_request_id.py --no-cov -q`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

```python
"""Request ids: `req_` plus a UUIDv7 in Crockford base32, so ids sort by time.

Python 3.13 has no uuid7 in the standard library; the 16 bytes are built per RFC 9562 section 5.7.
"""

from __future__ import annotations

import os
import re
import time

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
REQUEST_ID_PATTERN = re.compile(r"req_[0-9A-HJKMNP-TV-Z]{26}")
HEADER = "X-Request-Id"


def _uuid7_bytes() -> bytes:
    raw = bytearray((time.time_ns() // 1_000_000).to_bytes(6, "big") + os.urandom(10))
    raw[6] = (raw[6] & 0x0F) | 0x70  # version 7
    raw[8] = (raw[8] & 0x3F) | 0x80  # RFC 9562 variant
    return bytes(raw)


def new_request_id() -> str:
    number = int.from_bytes(_uuid7_bytes(), "big")
    return "req_" + "".join(_CROCKFORD[(number >> shift) & 31] for shift in range(125, -1, -5))


class RequestIdMiddleware:
    """Pure ASGI middleware: binds the id to the log context and returns it in a header."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inbound = Headers(scope=scope).get(HEADER, "")
        request_id = inbound if REQUEST_ID_PATTERN.fullmatch(inbound) else new_request_id()
        scope.setdefault("state", {})["request_id"] = request_id
        tokens = structlog.contextvars.bind_contextvars(request_id=request_id)

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            structlog.contextvars.reset_contextvars(**tokens)
```

- [x] **Step 4: Run to verify it passes**, then ruff and mypy.

- [x] **Step 5: Commit**

```bash
git add backend && git commit -m "Add sortable request ids bound to the log context"
```

---

### Task 5: Problem responses (RFC 9457)

**Files:**
- Create: `backend/src/idraft/api/problems.py`
- Test: `backend/tests/api/test_problems.py`

- [x] **Step 1: Write the failing tests**

```python
import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel, Field

from idraft.api.problems import ConflictError, NotFoundError, register_problem_handlers
from idraft.api.request_id import REQUEST_ID_PATTERN, RequestIdMiddleware

ORIGIN = "https://app.example.com"


class Item(BaseModel):
    name: str = Field(min_length=2)
    size: int = Field(le=100)


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=ORIGIN)

    @app.get("/missing")
    async def missing() -> None:
        raise NotFoundError("No project with that id.")

    @app.get("/duplicate")
    async def duplicate() -> None:
        raise ConflictError("Already exists.", code="duplicate", existing_id="0192")

    @app.post("/items")
    async def create(item: Item) -> Item:
        return item

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("SELECT secret FROM vault failed for user admin")

    return app


@pytest.fixture
async def client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=_app(), raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _assert_problem(response: httpx.Response, status: int, code: str) -> dict[str, object]:
    assert response.status_code == status
    assert response.headers["content-type"] == "application/problem+json"
    body: dict[str, object] = response.json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"] == f"{ORIGIN}/api/problems/{code}"
    assert REQUEST_ID_PATTERN.fullmatch(str(body["request_id"]))
    assert response.headers["X-Request-Id"] == body["request_id"]
    return body


async def test_problem_error_subclass(client: httpx.AsyncClient) -> None:
    body = _assert_problem(await client.get("/missing"), 404, "not_found")
    assert body["title"] == "Resource not found"
    assert body["detail"] == "No project with that id."
    assert body["instance"] == "/missing"


async def test_extensions_and_code_override(client: httpx.AsyncClient) -> None:
    body = _assert_problem(await client.get("/duplicate"), 409, "duplicate")
    assert body["existing_id"] == "0192"


async def test_unknown_route_is_not_found(client: httpx.AsyncClient) -> None:
    _assert_problem(await client.get("/nope"), 404, "not_found")


async def test_wrong_method(client: httpx.AsyncClient) -> None:
    _assert_problem(await client.delete("/missing"), 405, "method_not_allowed")


async def test_validation_errors_list_each_field(client: httpx.AsyncClient) -> None:
    response = await client.post("/items", json={"name": "a", "size": 500})
    body = _assert_problem(response, 422, "validation_failed")
    assert body["detail"] == "2 fields are invalid."
    errors = body["errors"]
    assert isinstance(errors, list)
    assert {(e["location"], e["path"], e["code"]) for e in errors} == {
        ("body", "name", "string_too_short"),
        ("body", "size", "less_than_equal"),
    }
    assert all(isinstance(e["message"], str) and e["message"] for e in errors)


async def test_single_validation_error_wording(client: httpx.AsyncClient) -> None:
    response = await client.post("/items", json={"name": "ok", "size": 500})
    assert response.json()["detail"] == "1 field is invalid."


async def test_malformed_json_is_bad_request(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/items", content=b"{not json", headers={"content-type": "application/json"}
    )
    _assert_problem(response, 400, "bad_request")


async def test_unexpected_errors_leak_nothing(client: httpx.AsyncClient) -> None:
    response = await client.get("/boom")
    body = _assert_problem(response, 500, "internal_error")
    assert "detail" not in body
    assert "vault" not in response.text
    assert "RuntimeError" not in response.text
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/api/test_problems.py --no-cov -q`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

```python
"""RFC 9457 problem responses (docs/19-api-specification.md section 2.7)."""

from __future__ import annotations

from typing import Any, ClassVar

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from idraft.api.request_id import HEADER, new_request_id

MEDIA_TYPE = "application/problem+json"
_log = structlog.get_logger(__name__)

_HTTP_STATUS_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "Bad request"),
    404: ("not_found", "Resource not found"),
    405: ("method_not_allowed", "Method not allowed"),
    413: ("payload_too_large", "Payload too large"),
    415: ("unsupported_media_type", "Unsupported media type"),
}


class ProblemError(Exception):
    """Base for every error the API returns on purpose. Subclasses fix status, code and title."""

    status: ClassVar[int] = 500
    code: ClassVar[str] = "internal_error"
    title: ClassVar[str] = "Internal error"

    def __init__(self, detail: str | None = None, *, code: str | None = None, **extensions: Any):
        super().__init__(detail or self.title)
        self.detail = detail
        self.problem_code = code or self.code
        self.extensions = extensions


class BadRequestError(ProblemError):
    status, code, title = 400, "bad_request", "Bad request"


class UnauthenticatedError(ProblemError):
    status, code, title = 401, "unauthenticated", "Authentication required"


class ForbiddenError(ProblemError):
    status, code, title = 403, "forbidden", "Not allowed"


class NotFoundError(ProblemError):
    status, code, title = 404, "not_found", "Resource not found"


class ConflictError(ProblemError):
    status, code, title = 409, "conflict", "Conflict"


def _request_id(request: Request) -> str:
    existing = getattr(request.state, "request_id", None)
    return existing if isinstance(existing, str) else new_request_id()


def problem_response(
    request: Request,
    *,
    app_origin: str,
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    **extensions: Any,
) -> JSONResponse:
    request_id = _request_id(request)
    body: dict[str, Any] = {
        "type": f"{app_origin}/api/problems/{code}",
        "title": title,
        "status": status,
    }
    if detail is not None:
        body["detail"] = detail
    body |= {"instance": request.url.path, "code": code, "request_id": request_id, **extensions}
    return JSONResponse(
        body, status_code=status, media_type=MEDIA_TYPE, headers={HEADER: request_id}
    )


def _validation_errors(error: RequestValidationError) -> list[dict[str, str]]:
    return [
        {
            "location": str(item["loc"][0]),
            "path": ".".join(str(part) for part in item["loc"][1:]),
            "code": str(item["type"]),
            "message": str(item["msg"]),
        }
        for item in error.errors()
    ]


def register_problem_handlers(app: FastAPI, *, app_origin: str) -> None:
    async def handle_problem(request: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, ProblemError)
        return problem_response(
            request,
            app_origin=app_origin,
            status=error.status,
            code=error.problem_code,
            title=error.title,
            detail=error.detail,
            **error.extensions,
        )

    async def handle_validation(request: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, RequestValidationError)
        errors = _validation_errors(error)
        if any(item["code"] == "json_invalid" for item in errors):
            return problem_response(
                request,
                app_origin=app_origin,
                status=400,
                code="bad_request",
                title="Bad request",
                detail="The request body is not valid JSON.",
            )
        count = len(errors)
        noun, verb = ("field", "is") if count == 1 else ("fields", "are")
        return problem_response(
            request,
            app_origin=app_origin,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail=f"{count} {noun} {verb} invalid.",
            errors=errors,
        )

    async def handle_http(request: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, HTTPException)
        code, title = _HTTP_STATUS_CODES.get(error.status_code, ("http_error", "Request failed"))
        return problem_response(
            request, app_origin=app_origin, status=error.status_code, code=code, title=title
        )

    async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:
        _log.error("unhandled exception", exc_info=error, route=request.url.path)
        return problem_response(
            request,
            app_origin=app_origin,
            status=500,
            code="internal_error",
            title="Internal error",
        )

    app.add_exception_handler(ProblemError, handle_problem)
    app.add_exception_handler(RequestValidationError, handle_validation)
    app.add_exception_handler(HTTPException, handle_http)
    app.add_exception_handler(Exception, handle_unexpected)
```

- [x] **Step 4: Run to verify it passes**, then ruff and mypy.

- [x] **Step 5: Commit**

```bash
git add backend && git commit -m "Add RFC 9457 problem responses for every error path"
```

---

### Task 6: Database engine, tenant transaction and test containers

**Files:**
- Create: `backend/src/idraft/db/engine.py`, `backend/tests/conftest.py`
- Test: `backend/tests/db/test_engine.py` (and empty `backend/tests/db/__init__.py`)

- [x] **Step 1: Write the container fixtures**

`backend/tests/conftest.py`:

```python
"""Shared fixtures: real PostgreSQL 18 and Redis 8, one pair per test session."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from idraft.config.settings import Settings
from idraft.db.engine import create_engine

POSTGRES_IMAGE = "postgres:18"
REDIS_IMAGE = "redis:8"


@pytest.fixture(scope="session")
def postgres_url() -> Iterator[str]:
    with PostgresContainer(POSTGRES_IMAGE, driver=None) as container:
        yield container.get_connection_url()


@pytest.fixture(scope="session")
def redis_url() -> Iterator[str]:
    with RedisContainer(REDIS_IMAGE) as container:
        host = container.get_container_host_ip()
        yield f"redis://{host}:{container.get_exposed_port(6379)}/0"


@pytest.fixture
def settings(postgres_url: str, redis_url: str) -> Settings:
    return Settings(
        app_origin="https://app.example.com",
        database_url=postgres_url,
        redis_url=redis_url,
        APP_ENV="test",
    )


@pytest.fixture
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(settings)
    yield engine
    await engine.dispose()
```

- [x] **Step 2: Write the failing tests**

`backend/tests/db/test_engine.py`:

```python
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory, workspace_transaction

WORKSPACE_SQL = text("SELECT NULLIF(current_setting('app.workspace_id', true), '')")


async def test_engine_connects_to_postgres_18(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        version = (await connection.execute(text("SHOW server_version_num"))).scalar_one()
    assert int(version) // 10000 == 18


async def test_statement_timeout_and_application_name_are_set(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        timeout = (await connection.execute(text("SHOW statement_timeout"))).scalar_one()
        name = (await connection.execute(text("SHOW application_name"))).scalar_one()
    assert timeout == "15s"
    assert name == "idraft-api"


async def test_statement_timeout_cancels_slow_queries(settings: Settings) -> None:
    fast = create_engine(settings.model_copy(update={"db_statement_timeout": "50ms"}))
    try:
        async with fast.connect() as connection:
            with pytest.raises(DBAPIError, match="statement timeout"):
                await connection.execute(text("SELECT pg_sleep(1)"))
    finally:
        await fast.dispose()


async def test_workspace_transaction_sets_the_tenant_for_its_transaction_only(
    engine: AsyncEngine,
) -> None:
    sessions = create_session_factory(engine)
    workspace_id = uuid.uuid4()

    async with workspace_transaction(sessions, workspace_id) as session:
        inside = (await session.execute(WORKSPACE_SQL)).scalar_one()
    assert inside == str(workspace_id)

    # One pooled connection, so the next transaction reuses the same server session.
    async with sessions() as session, session.begin():
        after = (await session.execute(WORKSPACE_SQL)).scalar_one()
    assert after is None


async def test_workspace_transaction_rolls_back_on_error(engine: AsyncEngine) -> None:
    sessions = create_session_factory(engine)
    async with engine.begin() as connection:
        await connection.execute(text("CREATE TABLE IF NOT EXISTS t_rollback (id int)"))
        await connection.execute(text("TRUNCATE t_rollback"))

    with pytest.raises(RuntimeError):
        async with workspace_transaction(sessions, uuid.uuid4()) as session:
            await session.execute(text("INSERT INTO t_rollback VALUES (1)"))
            raise RuntimeError("abort")

    async with engine.connect() as connection:
        count = (await connection.execute(text("SELECT count(*) FROM t_rollback"))).scalar_one()
    assert count == 0
```

Add to `conftest.py` so the pooled-connection test really reuses one connection: the `settings` fixture passes `db_pool_size=1`.

- [x] **Step 3: Run to verify failure**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
uv run pytest tests/db/test_engine.py --no-cov -q
```

Expected: FAIL, `No module named 'idraft.db.engine'`.

- [x] **Step 4: Implement**

`backend/src/idraft/db/engine.py`:

```python
"""Async engine, session factory and the per-transaction tenant setting.

The API role is subject to row-level security. Policies compare `workspace_id` with
`NULLIF(current_setting('app.workspace_id', true), '')::uuid`, so a transaction that never calls
`workspace_transaction` sees no tenant rows (docs/04-data-model.md section 13).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from idraft.config.settings import Settings

_SET_WORKSPACE = text("SELECT set_config('app.workspace_id', :workspace_id, true)")


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.sqlalchemy_url,
        pool_size=settings.db_pool_size,
        max_overflow=0,
        pool_pre_ping=True,
        connect_args={
            "server_settings": {
                "statement_timeout": settings.db_statement_timeout,
                "application_name": f"idraft-{settings.process_role}",
            }
        },
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@asynccontextmanager
async def workspace_transaction(
    sessions: async_sessionmaker[AsyncSession], workspace_id: UUID
) -> AsyncIterator[AsyncSession]:
    """One transaction scoped to one workspace. Commits on success, rolls back on error."""
    async with sessions() as session, session.begin():
        await session.execute(_SET_WORKSPACE, {"workspace_id": str(workspace_id)})
        yield session
```

- [x] **Step 5: Run to verify it passes**, then ruff and mypy.

- [x] **Step 6: Commit**

```bash
git add backend && git commit -m "Add the async engine and the tenant-scoped transaction"
```

---

### Task 7: Alembic baseline

**Files:**
- Create: `backend/src/idraft/db/migrate.py`, `backend/src/idraft/db/migrations/env.py`, `backend/src/idraft/db/migrations/script.py.mako`, `backend/src/idraft/db/migrations/versions/0001_baseline.py`, `backend/alembic.ini`
- Test: `backend/tests/db/test_migrations.py`

- [x] **Step 1: Write the failing tests**

```python
import asyncio

import asyncpg

from idraft.db.migrate import head_revision, upgrade_to_head

SCHEMAS = {"auth", "core", "seo", "ai", "fp", "ops"}
EXTENSIONS = {"citext", "pg_trgm", "pgcrypto", "btree_gist"}


def _fresh_database(postgres_url: str, name: str) -> str:
    async def create() -> None:
        connection = await asyncpg.connect(postgres_url)
        try:
            await connection.execute(f'DROP DATABASE IF EXISTS "{name}"')
            await connection.execute(f'CREATE DATABASE "{name}"')
        finally:
            await connection.close()

    asyncio.run(create())
    return postgres_url.rsplit("/", 1)[0] + f"/{name}"


def _query(url: str, sql: str) -> list[str]:
    async def run() -> list[str]:
        connection = await asyncpg.connect(url)
        try:
            return [row[0] for row in await connection.fetch(sql)]
        finally:
            await connection.close()

    return asyncio.run(run())


def test_there_is_exactly_one_head() -> None:
    assert head_revision() == "0001"


def test_upgrade_creates_schemas_extensions_and_the_version_row(postgres_url: str) -> None:
    url = _fresh_database(postgres_url, "migrate_fresh")
    upgrade_to_head(url)

    schemas = set(_query(url, "SELECT schema_name FROM information_schema.schemata"))
    extensions = set(_query(url, "SELECT extname FROM pg_extension"))
    version = _query(url, "SELECT version_num FROM ops.alembic_version")

    assert SCHEMAS <= schemas
    assert EXTENSIONS <= extensions
    assert version == [head_revision()]


def test_upgrade_is_idempotent(postgres_url: str) -> None:
    url = _fresh_database(postgres_url, "migrate_twice")
    upgrade_to_head(url)
    upgrade_to_head(url)
    assert _query(url, "SELECT version_num FROM ops.alembic_version") == [head_revision()]
```

These tests are synchronous on purpose: Alembic's environment runs its own event loop.

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/db/test_migrations.py --no-cov -q`
Expected: FAIL, `No module named 'idraft.db.migrate'`.

- [x] **Step 3: Implement**

`backend/src/idraft/db/migrate.py`:

```python
"""Alembic entry points. The config is built in code so it works from an installed package."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncConnection

from idraft.config.settings import load_settings, to_sqlalchemy_url

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
        raise RuntimeError("No migration head: the migrations directory is empty or branched")
    return head


async def current_revision(connection: AsyncConnection) -> str | None:
    """The revision stored in the database, or None before the first migration."""
    try:
        return (await connection.execute(_CURRENT)).scalar_one_or_none()
    except ProgrammingError:
        return None


def upgrade_to_head(database_url: str) -> None:
    command.upgrade(alembic_config(database_url), "head")


def main() -> None:
    """`python -m idraft.db.migrate`: what the migrator container runs on deploy."""
    upgrade_to_head(load_settings().database_url)


if __name__ == "__main__":
    main()
```

`backend/src/idraft/db/migrations/env.py`:

```python
"""Alembic environment: async engine, version table in the ops schema, SQL-first revisions."""

from __future__ import annotations

import asyncio
import os

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from idraft.config.settings import to_sqlalchemy_url
from idraft.db.migrate import VERSION_SCHEMA

config = context.config

if not config.get_main_option("sqlalchemy.url"):
    # Developer CLI (`uv run alembic ...`): the URL comes from the environment.
    config.set_main_option(
        "sqlalchemy.url", to_sqlalchemy_url(os.environ["DATABASE_URL"]).replace("%", "%%")
    )


def _run(connection: Connection) -> None:
    connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {VERSION_SCHEMA}"))
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=None,
        version_table="alembic_version",
        version_table_schema=VERSION_SCHEMA,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline mode is not supported: migrations run against a database.")

asyncio.run(_run_async())
```

`backend/src/idraft/db/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""

from __future__ import annotations

from alembic import op

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | tuple[str, ...] | None = ${repr(branch_labels)}
depends_on: str | tuple[str, ...] | None = ${repr(depends_on)}


def upgrade() -> None:
    op.execute("")


def downgrade() -> None:
    op.execute("")
```

`backend/src/idraft/db/migrations/versions/0001_baseline.py`:

```python
"""Baseline: trusted extensions and the six schemas.

pg_stat_statements is created by the infrastructure init script, because it is not a trusted
extension and the migrator role is not a superuser (docs/22-infrastructure-devops.md section 4.2).

Revision ID: 0001
Revises:
"""

from __future__ import annotations

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

EXTENSIONS = ("citext", "pg_trgm", "pgcrypto", "btree_gist")
SCHEMAS = ("auth", "core", "seo", "ai", "fp", "ops")


def upgrade() -> None:
    for extension in EXTENSIONS:
        op.execute(f"CREATE EXTENSION IF NOT EXISTS {extension}")
    for schema in SCHEMAS:
        op.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")


def downgrade() -> None:
    # Local development only. `ops` stays because it holds the version table.
    for schema in ("fp", "ai", "seo", "core", "auth"):
        op.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
```

`backend/alembic.ini` (developer CLI only):

```ini
[alembic]
script_location = src/idraft/db/migrations
file_template = %%(rev)s_%%(slug)s
```

- [x] **Step 4: Run to verify it passes**, then ruff and mypy.

- [x] **Step 5: Commit**

```bash
git add backend && git commit -m "Add Alembic with the baseline migration"
```

---

### Task 8: Application factory, Sentry and health endpoints

**Files:**
- Create: `backend/src/idraft/config/sentry.py`, `backend/src/idraft/api/health.py`, `backend/src/idraft/api/main.py`
- Modify: `backend/tests/conftest.py` (add `migrated_url`, `app`, `client`)
- Test: `backend/tests/config/test_sentry.py`, `backend/tests/api/test_health.py`

- [x] **Step 1: Extend the fixtures**

Append to `backend/tests/conftest.py` (and import `httpx`, `LifespanManager` from `asgi_lifespan`, `FastAPI`, `create_app`, `upgrade_to_head`):

```python
@pytest.fixture(scope="session")
def migrated_url(postgres_url: str) -> str:
    upgrade_to_head(postgres_url)
    return postgres_url


@pytest.fixture
def app_settings(migrated_url: str, redis_url: str) -> Settings:
    return Settings(
        app_origin="https://app.example.com",
        database_url=migrated_url,
        redis_url=redis_url,
        db_pool_size=2,
        APP_ENV="test",
    )


@pytest.fixture
async def app(app_settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(app_settings)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="https://app.example.com") as c:
        yield c
```

- [x] **Step 2: Write the failing tests**

`backend/tests/config/test_sentry.py`:

```python
from idraft.config.sentry import init_sentry
from idraft.config.settings import Settings

BASE = {
    "app_origin": "https://app.example.com",
    "database_url": "postgresql://u:p@h/db",
    "redis_url": "redis://h:6379/0",
}


def test_sentry_stays_off_without_a_dsn() -> None:
    assert init_sentry(Settings(**BASE)) is False


def test_sentry_starts_with_a_dsn() -> None:
    settings = Settings(**BASE, sentry_dsn="https://public@o0.ingest.sentry.io/0")
    assert init_sentry(settings) is True
```

`backend/tests/api/test_health.py`:

```python
from collections.abc import AsyncIterator

import httpx
import pytest
from asgi_lifespan import LifespanManager
from sqlalchemy import text

from idraft.api.main import create_app
from idraft.config.settings import Settings


async def test_healthz_is_alive_and_reveals_nothing(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-Id"].startswith("req_")


async def test_readyz_is_ready_when_everything_answers(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/readyz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"postgres": True, "redis": True, "migrations": True},
    }


@pytest.fixture
async def degraded_client(
    app_settings: Settings, request: pytest.FixtureRequest
) -> AsyncIterator[httpx.AsyncClient]:
    overrides: dict[str, object] = request.param
    app = create_app(app_settings.model_copy(update=overrides))
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="https://app.example.com") as c:
            yield c


@pytest.mark.parametrize(
    ("degraded_client", "expected"),
    [
        (
            {"redis_url": "redis://127.0.0.1:1/0"},
            {"postgres": True, "redis": False, "migrations": True},
        ),
        (
            {"database_url": "postgresql://nobody:x@127.0.0.1:1/none"},
            {"postgres": False, "redis": True, "migrations": False},
        ),
    ],
    indirect=["degraded_client"],
)
async def test_readyz_names_the_failing_checks_only(
    degraded_client: httpx.AsyncClient, expected: dict[str, bool]
) -> None:
    response = await degraded_client.get("/api/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "checks": expected}


async def test_readyz_fails_when_the_schema_is_behind(
    app_settings: Settings, postgres_url: str
) -> None:
    import asyncpg

    admin = await asyncpg.connect(postgres_url)
    try:
        await admin.execute('DROP DATABASE IF EXISTS "unmigrated"')
        await admin.execute('CREATE DATABASE "unmigrated"')
    finally:
        await admin.close()
    url = postgres_url.rsplit("/", 1)[0] + "/unmigrated"

    app = create_app(app_settings.model_copy(update={"database_url": url}))
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="https://app.example.com") as c:
            response = await c.get("/api/readyz")
    assert response.status_code == 503
    assert response.json()["checks"] == {"postgres": True, "redis": True, "migrations": False}


async def test_lifespan_disposes_the_engine(app_settings: Settings) -> None:
    app = create_app(app_settings)
    async with LifespanManager(app):
        async with app.state.engine.connect() as connection:
            assert (await connection.execute(text("SELECT 1"))).scalar_one() == 1
        pool = app.state.engine.pool
    assert pool.checkedout() == 0


async def test_unknown_api_route_is_a_problem(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"] == "https://app.example.com/api/problems/not_found"
```

- [x] **Step 3: Run to verify failure**

Run: `uv run pytest tests/api/test_health.py tests/config/test_sentry.py --no-cov -q`
Expected: FAIL, modules not found.

- [x] **Step 4: Implement**

`backend/src/idraft/config/sentry.py`:

```python
"""Error and performance reporting (ADR-022: Sentry, 10% performance sampling)."""

from __future__ import annotations

import sentry_sdk

from idraft.config.settings import Settings

TRACES_SAMPLE_RATE = 0.1


def init_sentry(settings: Settings) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it was started."""
    if settings.sentry_dsn is None:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.release_sha,
        traces_sample_rate=TRACES_SAMPLE_RATE,
        send_default_pii=False,
    )
    return True
```

`backend/src/idraft/api/health.py`:

```python
"""Liveness and readiness (docs/19-api-specification.md section 3.12).

Both reveal no versions, hostnames or error messages. Readiness reports booleans only.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from idraft.db.migrate import current_revision

CHECK_TIMEOUT_SECONDS = 1.0
router = APIRouter(prefix="/api", tags=["health"])


class Health(BaseModel):
    status: Literal["ok"]


class ReadinessChecks(BaseModel):
    postgres: bool
    redis: bool
    migrations: bool


class Readiness(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks


async def _check_database(engine: AsyncEngine, head: str) -> tuple[bool, bool]:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS), engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            return True, await current_revision(connection) == head
    except (SQLAlchemyError, OSError, TimeoutError):
        return False, False


async def _check_redis(redis: Redis) -> bool:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            await redis.ping()
        return True
    except (RedisError, OSError, TimeoutError):
        return False


@router.get("/healthz", summary="Liveness")
async def healthz() -> Health:
    return Health(status="ok")


@router.get("/readyz", summary="Readiness", responses={503: {"model": Readiness}})
async def readyz(request: Request, response: Response) -> Readiness:
    state = request.app.state
    (postgres, migrations), redis = await asyncio.gather(
        _check_database(state.engine, state.migration_head), _check_redis(state.redis)
    )
    checks = ReadinessChecks(postgres=postgres, redis=redis, migrations=migrations)
    ready = postgres and redis and migrations
    if not ready:
        response.status_code = 503
    return Readiness(status="ready" if ready else "not_ready", checks=checks)
```

`backend/src/idraft/api/main.py`:

```python
"""Application factory. Run with `uvicorn idraft.api.main:create_app --factory`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from idraft import __version__
from idraft.api.health import router as health_router
from idraft.api.problems import register_problem_handlers
from idraft.api.request_id import RequestIdMiddleware
from idraft.config.logging import configure_logging
from idraft.config.sentry import init_sentry
from idraft.config.settings import Settings, load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.db.migrate import head_revision

OPENAPI_URL = "/api/v1/openapi.json"


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    engine = create_engine(settings)
    redis = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
    app.state.engine = engine
    app.state.sessions = create_session_factory(engine)
    app.state.redis = redis
    try:
        yield
    finally:
        await redis.aclose()
        await engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    init_sentry(settings)

    app = FastAPI(
        title="idraft.ai API",
        version=__version__,
        openapi_url=OPENAPI_URL,
        docs_url=None,
        redoc_url=None,
        lifespan=_lifespan,
    )
    app.state.settings = settings
    app.state.migration_head = head_revision()
    app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=settings.app_origin)
    app.include_router(health_router)
    return app
```

- [x] **Step 5: Run the whole suite with coverage**

```bash
uv run pytest -q
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports
```

Expected: all tests pass, coverage at or above 90%, every check clean.

- [x] **Step 6: Commit**

```bash
git add backend && git commit -m "Add the app factory with liveness and readiness endpoints"
```

---

### Task 9: Committed OpenAPI document

**Files:**
- Create: `backend/src/idraft/api/openapi.py`, `backend/openapi/v1.json`
- Test: `backend/tests/api/test_openapi.py`

- [x] **Step 1: Write the failing test**

```python
import json
from pathlib import Path

from idraft.api.openapi import build_openapi, render_openapi

COMMITTED = Path(__file__).parents[2] / "openapi" / "v1.json"


def test_openapi_is_version_3_1_and_lists_the_health_routes() -> None:
    document = build_openapi()
    assert str(document["openapi"]).startswith("3.1")
    assert {"/api/healthz", "/api/readyz"} <= set(document["paths"])


def test_committed_document_matches_the_code() -> None:
    assert COMMITTED.read_text() == render_openapi(), (
        "backend/openapi/v1.json is stale. Regenerate it with: "
        "uv run python -m idraft.api.openapi > openapi/v1.json"
    )


def test_rendered_document_is_stable_json() -> None:
    assert json.loads(render_openapi()) == build_openapi()
    assert render_openapi().endswith("\n")
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/api/test_openapi.py --no-cov -q`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

`backend/src/idraft/api/openapi.py`:

```python
"""The OpenAPI document that apps/web generates its client from.

`python -m idraft.api.openapi > openapi/v1.json` regenerates the committed copy. Building the
document opens no connection, so the settings here are placeholders.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from idraft.api.main import create_app
from idraft.config.settings import Settings

_PLACEHOLDER = Settings(
    app_origin="https://app.example.com",
    database_url="postgresql://unused@localhost/unused",
    redis_url="redis://localhost:6379/0",
    log_level="critical",
)


def build_openapi() -> dict[str, Any]:
    return create_app(_PLACEHOLDER).openapi()


def render_openapi() -> str:
    return json.dumps(build_openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    sys.stdout.write(render_openapi())
```

- [x] **Step 4: Generate the document and run the tests**

```bash
mkdir -p openapi && uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest tests/api/test_openapi.py --no-cov -q
```

Expected: 3 pass.

- [x] **Step 5: Commit**

```bash
git add backend && git commit -m "Commit the OpenAPI document and fail tests when it drifts"
```

---

### Task 10: Local development stack and the API image

**Files:**
- Create: `infra/compose/docker-compose.dev.yml`, `backend/.env.example`, `backend/Dockerfile`, `backend/.dockerignore`, `backend/README.md`

- [x] **Step 1: Write the files**

`infra/compose/docker-compose.dev.yml`:

```yaml
# Local development only: PostgreSQL 18 and Redis 8 on loopback ports that do not collide with
# a Homebrew PostgreSQL or Redis. Production is infra/compose/docker-compose.yml (plan 6).
name: sightline-dev

services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: sightline
      POSTGRES_PASSWORD: sightline
      POSTGRES_DB: sightline
    ports:
      - "127.0.0.1:54329:5432"
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sightline -d sightline"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:8
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]
    ports:
      - "127.0.0.1:63799:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
  redis-data:
```

`backend/.env.example`:

```dotenv
# Local development values. Copy to .env; nothing here is a secret.
APP_ENV=local
APP_ORIGIN=http://localhost:3000
LOG_LEVEL=debug
DATABASE_URL=postgresql://sightline:sightline@127.0.0.1:54329/sightline
REDIS_URL=redis://127.0.0.1:63799/0
```

`backend/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM python:3.13-slim AS runtime
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
USER 10001:10001

FROM runtime AS api
ENV PROCESS_ROLE=api
EXPOSE 8000
CMD ["uvicorn", "idraft.api.main:create_app", "--factory", "--host=0.0.0.0", "--port=8000", "--proxy-headers", "--timeout-graceful-shutdown=25"]
```

`backend/.dockerignore`:

```
.venv
.mypy_cache
.ruff_cache
.pytest_cache
.coverage
tests
__pycache__
.env
.env.*
```

`backend/README.md`:

````markdown
# idraft.ai backend

FastAPI API and Taskiq worker. Architecture: `docs/adr/ADR-022-python-backend-simplified-platform.md`.

## Requirements

Python 3.13, [uv](https://docs.astral.sh/uv/), and Docker (the tests start PostgreSQL 18 and Redis 8 containers).

## Run locally

```bash
docker compose -f ../infra/compose/docker-compose.dev.yml up -d
```

```bash
cp .env.example .env
```

```bash
uv run --env-file .env python -m idraft.db.migrate
```

```bash
uv run --env-file .env uvicorn idraft.api.main:create_app --factory --reload --port 8000
```

`http://127.0.0.1:8000/api/readyz` returns `200` when PostgreSQL, Redis and the schema are in place.

## Checks

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports && uv run pytest
```

## Migrations

Revisions live in `src/idraft/db/migrations/versions/` and are written as SQL in `op.execute(...)`. Create one with:

```bash
uv run --env-file .env alembic revision -m "describe the change"
```

## API contract

`openapi/v1.json` is generated from the code and committed; a test fails when it drifts. Regenerate with:

```bash
uv run python -m idraft.api.openapi > openapi/v1.json
```
````

- [x] **Step 2: Verify the development stack and the image**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
cd "/Users/a12345/Desktop/AI/SEO Tool"
docker compose -f infra/compose/docker-compose.dev.yml up -d --wait
cd backend && cp .env.example .env
uv run --env-file .env python -m idraft.db.migrate
docker build --target api -t idraft-api:dev .
docker run --rm -d --name idraft-api-smoke --network sightline-dev_default \
  -e APP_ORIGIN=http://localhost:3000 \
  -e DATABASE_URL=postgresql://sightline:sightline@postgres:5432/sightline \
  -e REDIS_URL=redis://redis:6379/0 -p 127.0.0.1:18000:8000 idraft-api:dev
sleep 3 && curl -sS -i http://127.0.0.1:18000/api/readyz
docker rm -f idraft-api-smoke
```

Expected: `HTTP/1.1 200 OK` and `{"status":"ready","checks":{"postgres":true,"redis":true,"migrations":true}}`.

- [x] **Step 3: Commit**

```bash
git add infra backend && git commit -m "Add the local development stack and the API image"
```

---

### Task 11: Continuous integration

**Files:**
- Create: `.github/workflows/backend.yml`

- [x] **Step 1: Write the workflow**

```yaml
name: backend

on:
  push:
    branches: [main]
    paths: ["backend/**", ".github/workflows/backend.yml"]
  pull_request:
    paths: ["backend/**", ".github/workflows/backend.yml"]

concurrency:
  group: backend-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
          cache-dependency-glob: backend/uv.lock
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run mypy
      - run: uv run lint-imports
      - run: uv run pytest
      - name: Build the API image
        run: docker build --target api -t idraft-api:ci .
```

- [x] **Step 2: Commit**

```bash
git add .github && git commit -m "Add the backend CI workflow"
```

---

### Task 12: Write the decisions back into the docs

**Files:**
- Modify: `docs/22-infrastructure-devops.md` (health route text, uvicorn command), `docs/25-observability.md` (request id format), `docs/26-testing-quality.md` (type checker), `docs/04-data-model.md` section 13 (policy expression), `docs/review-log.md` (close L5, record this plan)

- [x] **Step 1:** Doc 22: `/api/healthz` is liveness only and matches doc 19 section 3.12; the `api` command is `uvicorn idraft.api.main:create_app --factory`.
- [x] **Step 2:** Doc 25 section 3.1: `request_id` is `req_` plus the base32 form of a UUIDv7.
- [x] **Step 3:** Doc 26 section 2.2: types are checked by mypy in strict mode.
- [x] **Step 4:** Doc 04 section 13: the policy compares with `NULLIF(current_setting('app.workspace_id', true), '')::uuid`, with the reason.
- [x] **Step 5:** Review log: L5 closed for the type checker; one row per change above.
- [x] **Step 6: Commit**

```bash
git add docs/04-data-model.md docs/22-infrastructure-devops.md docs/25-observability.md docs/26-testing-quality.md docs/review-log.md docs/superpowers
git commit -m "Record the backend foundation decisions in the docs"
```

---

## Self-review

| Spec requirement | Task |
|---|---|
| ADR-022 layout and purity rules | 1 |
| Settings validated at start, process exits on invalid config (doc 31) | 2 |
| JSON logs, fixed fields, redaction list with a test (doc 25 section 3) | 3 |
| Request ids on logs and responses | 4 |
| problem+json for ProblemError, validation, HTTP errors and the catch-all; no leaks in 5xx (doc 19 section 2.7) | 5 |
| Async SQLAlchemy engine, statement timeout, tenant `set_config` per transaction (doc 04 section 13) | 6 |
| Alembic, SQL-first, one head, `ops.alembic_version` (doc 04 section 14, doc 23) | 7 |
| `/api/healthz`, `/api/readyz` with postgres, redis and migrations checks (doc 19 section 3.12) | 8 |
| Sentry with 10% sampling (ADR-022) | 8 |
| OpenAPI generated and committed; drift fails tests (doc 26 section 2.2) | 9 |
| Images built from `backend/`, non-root uid 10001 (doc 22) | 10 |
| CI: ruff, types, import contracts, tests (doc 31) | 11 |

Not covered here, by design: tables, RLS policies and roles (plan 2); auth (plan 3); worker, queue and ledger (plan 4); provider client (plan 5); the `worker` image target arrives with plan 4.

---

## Execution notes (2026-09-30)

All twelve tasks are complete on branch `backend/foundation`. Final state: 83 tests, 99% branch coverage, ruff, mypy strict and 4 import contracts clean, image built and smoke-tested against the development stack.

What differs from the task text above (the code in the repository is authoritative):

| Task | Difference | Why |
|---|---|---|
| 1 | `filterwarnings = ["error"]` in the pytest config; `asyncpg-stubs` added; `backend/check.sh` runs every gate | Warnings must not accumulate; mypy needs the stubs; one command for local runs and CI |
| 2 | `environment` accepts both the field name and `APP_ENV` (`AliasChoices`) | Tests and code pass `environment=...`; the process reads `APP_ENV` |
| 5 | Handlers re-raise on a type mismatch instead of `assert`; the 500 log line carries `route` as the template and the request id explicitly | The catch-all runs outside the middleware stack |
| 6 | Testcontainers imports come from `testcontainers.community.*`; the engine tests go through a typed `_scalar` helper | Deprecation warnings; mypy |
| 8 | `AccessLogMiddleware` (`api/access_log.py`), `route_template` (`api/routing.py`), standard-library log routing and quiet `httpx` loggers in `config/logging.py` | Found when the image was run: uvicorn's lines were plain text with raw URLs |
| 10 | The image command has `--no-access-log` | Same |
| 11 | The workflow calls `./check.sh` | One definition of the gates |

Next plans, in order: 2 schema, roles and RLS for the Phase 1 tables; 3 auth module; 4 Taskiq worker, ledger and dispatcher (with the L1 smoke test); 5 DataForSEO client and the Phase 0 spikes; 6 droplet, Compose and deploy.

### After the code review (same day)

The review's findings and fixes are listed in `docs/review-log.md` ("Code review of the backend foundation"). Final state: 220 tests, 99% branch coverage, every gate clean, image smoke-tested with `backend/smoke.sh`.

Files added after the tasks above: `config/redaction.py`, `db/probe.py`, `api/resources.py`, `api/schema.py`, `api/routing.py`, `api/access_log.py`, `backend/smoke.sh`, `backend/check.sh`. `db.migrate.current_revision` and `head_revision` were replaced by `migration_state()` and `db.probe.probe_database`. The settings field `environment` is `app_env`. `openapi_url` is `None`.

