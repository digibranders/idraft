from __future__ import annotations

import asyncio
import gc
import warnings
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from pydantic import SecretStr
from redis.asyncio import Redis

from idraft.config.settings import Settings
from tests.conftest import BASE_URL, PostgresServer


@pytest.fixture
async def redis(redis_url: str) -> AsyncIterator[Redis]:
    """A client on an empty database: no lock, message or dedupe key of an earlier test."""
    client = Redis.from_url(redis_url)
    await client.flushdb()
    yield client
    await client.aclose()


@pytest.fixture
async def abandoned_connections() -> AsyncIterator[None]:
    """For a test that kills a consumer or its connections on purpose. What they leave behind
    is collected here, inside the test, and not as a warning in whichever test runs next."""
    yield
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ResourceWarning)
        gc.collect()


@pytest.fixture
def worker_settings(migrated: PostgresServer, redis_url: str) -> Settings:
    return Settings(
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url("app_worker")),
        redis_url=SecretStr(redis_url),
        db_pool_size=4,
        log_level="critical",
        app_env="test",
    )


async def eventually(
    condition: Callable[[], bool | Awaitable[bool]], *, within: float = 5.0, every: float = 0.02
) -> None:
    """Wait until the condition holds, or fail after `within` seconds."""
    deadline = asyncio.get_running_loop().time() + within
    while True:
        result = condition()
        if isinstance(result, Awaitable):
            result = await result
        if result:
            return
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError(f"not true within {within} s")
        await asyncio.sleep(every)
