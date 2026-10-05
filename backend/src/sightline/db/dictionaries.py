"""Rows of the global dictionaries, `core.domains` and `core.urls` (docs/04-data-model.md
section 5.1), added when no workspace has named them before.

Both runtime roles may insert a host or a URL but never change one, so an existing row is read,
never updated: `ON CONFLICT DO NOTHING`, then a SELECT.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import domains, urls
from sightline.extraction.urls import CANONICALIZER_VERSION, CanonicalUrl, Host


@dataclass(frozen=True, slots=True)
class UrlRow:
    id: int
    domain_id: int
    canonical_url: str
    host: str
    registrable_domain: str
    path: str


async def domain_id_for(db: AsyncSession, host: Host) -> int:
    """The `core.domains` row of a host."""
    await db.execute(
        upsert(domains)
        .values(
            host=host.name,
            registrable_domain=host.registrable_domain,
            public_suffix=host.public_suffix,
            is_ip=host.is_ip,
        )
        .on_conflict_do_nothing(index_elements=[domains.c.host])
    )
    domain_id: int = (
        await db.execute(select(domains.c.id).where(domains.c.host == host.name))
    ).scalar_one()
    return domain_id


async def urls_for(db: AsyncSession, given: Iterable[CanonicalUrl]) -> dict[bytes, UrlRow]:
    """The rows of many URLs by their hash, in four statements. New hosts and URLs are added in
    (host, hash) order, the order every writer uses, so two writers adding the same new ones
    cannot wait on each other."""
    distinct = {url.url_hash: url for url in given}
    if not distinct:
        return {}
    ordered = sorted(distinct.values(), key=lambda url: (url.host.name, url.url_hash))
    hosts = sorted({url.host.name: url.host for url in ordered}.values(), key=lambda h: h.name)
    await db.execute(
        upsert(domains)
        .values(
            [
                {
                    "host": host.name,
                    "registrable_domain": host.registrable_domain,
                    "public_suffix": host.public_suffix,
                    "is_ip": host.is_ip,
                }
                for host in hosts
            ]
        )
        .on_conflict_do_nothing(index_elements=[domains.c.host])
    )
    domain_ids = {
        row.host: row.id
        for row in await db.execute(
            select(domains.c.id, domains.c.host).where(domains.c.host.in_([h.name for h in hosts]))
        )
    }
    await db.execute(
        upsert(urls)
        .values(
            [
                {
                    "url_hash": url.url_hash,
                    "canonical_url": url.url,
                    "domain_id": domain_ids[url.host.name],
                    "path": url.path,
                    "canonicalizer_version": CANONICALIZER_VERSION,
                }
                for url in ordered
            ]
        )
        .on_conflict_do_nothing(index_elements=[urls.c.url_hash])
    )
    rows = await db.execute(
        select(
            urls.c.id,
            urls.c.url_hash,
            urls.c.canonical_url,
            urls.c.path,
            urls.c.domain_id,
            domains.c.host,
            domains.c.registrable_domain,
        )
        .join(domains, domains.c.id == urls.c.domain_id)
        .where(urls.c.url_hash.in_(list(distinct)))
    )
    return {
        row.url_hash: UrlRow(
            id=row.id,
            domain_id=row.domain_id,
            canonical_url=row.canonical_url,
            host=row.host,
            registrable_domain=row.registrable_domain,
            path=row.path,
        )
        for row in rows
    }


async def url_for(db: AsyncSession, url: CanonicalUrl) -> UrlRow:
    """The `core.urls` row of a canonical URL, with its host's domain."""
    domain_id = await domain_id_for(db, url.host)
    await db.execute(
        upsert(urls)
        .values(
            url_hash=url.url_hash,
            canonical_url=url.url,
            domain_id=domain_id,
            path=url.path,
            canonicalizer_version=CANONICALIZER_VERSION,
        )
        .on_conflict_do_nothing(index_elements=[urls.c.url_hash])
    )
    row = (
        await db.execute(
            select(
                urls.c.id,
                urls.c.canonical_url,
                urls.c.path,
                urls.c.domain_id,
                domains.c.host,
                domains.c.registrable_domain,
            )
            .join(domains, domains.c.id == urls.c.domain_id)
            .where(urls.c.url_hash == url.url_hash)
        )
    ).one()
    return UrlRow(
        id=row.id,
        domain_id=row.domain_id,
        canonical_url=row.canonical_url,
        host=row.host,
        registrable_domain=row.registrable_domain,
        path=row.path,
    )
