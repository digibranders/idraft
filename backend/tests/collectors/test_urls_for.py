"""The batch of URL and host rows (`db.dictionaries.urls_for`), as `app_worker`."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.db import dictionaries
from idraft.extraction.urls import canonicalize
from tests.api.auth.support import fetchrow
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


async def test_new_urls_and_hosts_are_added_once_and_returned_by_hash(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    given = [
        canonicalize("https://batch.example/a"),
        canonicalize("https://batch.example/b?utm_source=x"),
        canonicalize("https://other-batch.example/"),
        canonicalize("https://batch.example/a/"),  # the same page as the first
    ]

    async with worker_db() as db, db.begin():
        first = await dictionaries.urls_for(db, given)
    async with worker_db() as db, db.begin():
        again = await dictionaries.urls_for(db, given)

    assert len(first) == 3
    assert {row.id for row in first.values()} == {row.id for row in again.values()}
    for url in given:
        assert first[url.url_hash].canonical_url == url.url
        assert first[url.url_hash].host == url.host.name
    count = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM core.domains "
        "WHERE host IN ('batch.example', 'other-batch.example')",
    )
    assert count["n"] == 2


async def test_nothing_in_gives_nothing_out(worker_db: Ledger) -> None:
    async with worker_db() as db, db.begin():
        assert await dictionaries.urls_for(db, []) == {}


async def test_a_row_that_exists_already_is_read_not_changed(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    url = canonicalize("https://existing-batch.example/x")
    async with worker_db() as db, db.begin():
        one = await dictionaries.url_for(db, url)
        batch = await dictionaries.urls_for(db, [url])

    assert batch[url.url_hash].id == one.id
