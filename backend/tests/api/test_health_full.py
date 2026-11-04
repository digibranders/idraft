"""The full health report: `GET /api/internal/health` (docs/19 section 3.12)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from asgi_lifespan import LifespanManager
from pydantic import SecretStr
from redis.asyncio import Redis

from idraft.api.main import create_app
from idraft.config.settings import MIN_HEALTH_TOKEN_LENGTH, Settings
from tests.conftest import BASE_URL

TOKEN = "t" * 32
PATH = "/api/internal/health"


def _bearer(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _get(settings: Settings, headers: dict[str, str] | None = None) -> httpx.Response:
    application = create_app(settings)
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as client:
            return await client.get(PATH, headers=headers or {})


def _with_token(settings: Settings, **more: Any) -> Settings:
    return settings.model_copy(update={"health_token": SecretStr(TOKEN), **more})


@pytest.fixture
async def redis(redis_url: str) -> AsyncIterator[Redis]:
    connection = Redis.from_url(redis_url)
    for key in await connection.keys("health:worker:*"):
        await connection.delete(key)
    await connection.delete("provider:balance:dataforseo", "rl:paused:dataforseo")
    yield connection
    for key in await connection.keys("health:worker:*"):
        await connection.delete(key)
    await connection.delete("provider:balance:dataforseo", "rl:paused:dataforseo")
    await connection.aclose()


async def _worker(
    redis: Redis,
    *,
    age: timedelta = timedelta(seconds=5),
    pid: int = 4242,
    **more: Any,
) -> None:
    report = {
        "instance": "prod",
        "pid": pid,
        "started_at": (datetime.now(UTC) - timedelta(hours=3)).isoformat(),
        "reported_at": (datetime.now(UTC) - age).isoformat(),
        "open_tasks": 12,
        "oldest_due_age_s": 40,
        "failed_24h": 1,
        "last_ingested_at": datetime.now(UTC).isoformat(),
        "provider_registered": True,
        **more,
    }
    await redis.set(f"health:worker:prod:{pid}", json.dumps(report), ex=120)


def test_a_token_that_is_too_short_is_refused_when_the_settings_are_read(
    app_settings: Settings,
) -> None:
    with pytest.raises(ValueError, match=str(MIN_HEALTH_TOKEN_LENGTH)):
        Settings.model_validate({**app_settings.model_dump(), "health_token": SecretStr("short")})


async def test_without_a_token_configured_the_report_does_not_exist(
    app_settings: Settings,
) -> None:
    response = await _get(app_settings, _bearer())

    assert response.status_code == 404


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer "}, {"Authorization": "Basic abc"}, _bearer("x" * 32)],
)
async def test_a_missing_or_wrong_token_is_refused(
    app_settings: Settings, headers: dict[str, str]
) -> None:
    response = await _get(_with_token(app_settings), headers)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert "checks" not in response.text


async def test_with_no_worker_the_api_serves_but_the_report_is_degraded(
    app_settings: Settings, redis: Redis
) -> None:
    response = await _get(_with_token(app_settings, release_sha="abc1234"), _bearer())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    checks = body["checks"]
    assert (checks["postgres"]["ok"], checks["redis"]["ok"], checks["migrations"]["ok"]) == (
        True,
        True,
        True,
    )
    assert checks["migrations"]["current"] == checks["migrations"]["expected"]
    assert checks["worker"] == {"ok": False, "processes": []}
    assert checks["collection"]["ok"] is None
    assert body["versions"]["release"] == "abc1234"
    assert body["versions"]["parser_version"] >= 4
    # What it says about itself holds no secret, host or error text
    for secret in (TOKEN, "postgresql", "redis://"):
        assert secret not in response.text


async def test_a_worker_that_reports_makes_the_report_ok_and_shows_collection(
    app_settings: Settings, redis: Redis
) -> None:
    await _worker(redis)

    body = (await _get(_with_token(app_settings), _bearer())).json()

    assert body["status"] == "ok"
    (process,) = body["checks"]["worker"]["processes"]
    assert (process["instance"], process["pid"]) == ("prod", 4242)
    assert body["checks"]["collection"] == {
        "ok": True,
        "open_tasks": 12,
        "oldest_due_age_s": 40,
        "failed_24h": 1,
        "last_ingested_at": body["checks"]["collection"]["last_ingested_at"],
    }
    assert body["checks"]["provider"]["registered"] is True
    assert body["checks"]["provider"]["ok"] is True


async def test_a_report_that_has_gone_quiet_is_not_a_worker(
    app_settings: Settings, redis: Redis
) -> None:
    await _worker(redis, age=timedelta(minutes=5))

    body = (await _get(_with_token(app_settings), _bearer())).json()

    assert body["status"] == "degraded"
    assert body["checks"]["worker"]["ok"] is False


async def test_collection_that_is_falling_behind_is_degraded(
    app_settings: Settings, redis: Redis
) -> None:
    await _worker(redis, oldest_due_age_s=4 * 3600)

    body = (await _get(_with_token(app_settings), _bearer())).json()

    assert body["status"] == "degraded"
    assert body["checks"]["collection"]["ok"] is False
    assert body["checks"]["worker"]["ok"] is True


async def test_a_paused_provider_and_its_balance_are_shown_and_degrade_the_report(
    app_settings: Settings, redis: Redis
) -> None:
    await _worker(redis)
    await redis.set("rl:paused:dataforseo", "no_balance", px=60_000)
    await redis.set(
        "provider:balance:dataforseo",
        json.dumps(
            {
                "balance_usd": "4.20",
                "days_remaining": "6.5",
                "severity": "warning",
                "checked_at": datetime.now(UTC).isoformat(),
            }
        ),
    )

    body = (await _get(_with_token(app_settings), _bearer())).json()

    provider = body["checks"]["provider"]
    assert body["status"] == "degraded"
    assert (provider["ok"], provider["paused"], provider["balance_usd"]) == (False, True, "4.20")
    assert provider["severity"] == "warning"


async def test_a_balance_that_is_critical_degrades_the_report(
    app_settings: Settings, redis: Redis
) -> None:
    await _worker(redis)
    await redis.set(
        "provider:balance:dataforseo", json.dumps({"balance_usd": "0.3", "severity": "critical"})
    )

    body = (await _get(_with_token(app_settings), _bearer())).json()

    assert (body["status"], body["checks"]["provider"]["ok"]) == ("degraded", False)


async def test_a_provider_no_worker_has_registered_cannot_be_unhealthy(
    app_settings: Settings, redis: Redis
) -> None:
    await _worker(redis, provider_registered=False)
    await redis.set("rl:paused:dataforseo", "no_balance", px=60_000)

    body = (await _get(_with_token(app_settings), _bearer())).json()

    assert body["status"] == "ok"
    assert body["checks"]["provider"]["registered"] is False


async def test_without_redis_the_api_is_down_and_says_503(app_settings: Settings) -> None:
    settings = _with_token(app_settings, redis_url=SecretStr("redis://127.0.0.1:1/0"))

    response = await _get(settings, _bearer())

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "down"
    assert body["checks"]["redis"] == {"ok": False, "latency_ms": None}


async def test_without_the_database_the_api_is_down_and_says_503(app_settings: Settings) -> None:
    settings = _with_token(
        app_settings, database_url=SecretStr("postgresql://nobody:x@127.0.0.1:1/none")
    )

    response = await _get(settings, _bearer())

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "down"
    assert body["checks"]["postgres"] == {"ok": False, "latency_ms": None}
    assert body["checks"]["migrations"]["ok"] is False
