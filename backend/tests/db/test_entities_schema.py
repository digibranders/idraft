"""The rules the entity, domain, location and taxonomy tables keep by themselves
(docs/04-data-model.md sections 5 and 6)."""

from __future__ import annotations

import uuid
from typing import Any

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, scoped, seed_tenant

type Db = asyncpg.Connection[asyncpg.Record]


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


def _suffix() -> str:
    return uuid.uuid4().hex[:8]


async def _entity(db: Db, tenant: Tenant, name: str | None = None) -> uuid.UUID:
    entity_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', $2) RETURNING id",
        tenant.workspace_id,
        name or f"brand {_suffix()}",
    )
    return entity_id


async def _domain(db: Db) -> int:
    host = f"host-{_suffix()}.com"
    domain_id: int = await db.fetchval(
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ($1, $1, 'com') RETURNING id",
        host,
    )
    return domain_id


async def _vocabulary(db: Db, tenant: Tenant) -> uuid.UUID:
    vocabulary_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
        "VALUES ($1, 'tag', $2) RETURNING id",
        tenant.workspace_id,
        f"Tags {_suffix()}",
    )
    return vocabulary_id


async def _term(db: Db, tenant: Tenant, vocabulary_id: uuid.UUID, slug: str) -> uuid.UUID:
    term_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        tenant.workspace_id,
        vocabulary_id,
        slug.title(),
        slug,
        slug,
    )
    return term_id


async def test_the_domain_categories_of_doc_14_are_seeded(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        codes = {row["code"] for row in await db.fetch("SELECT code FROM core.domain_categories")}

    assert codes == {
        "news",
        "review_aggregator",
        "ugc_forum",
        "social",
        "video",
        "wiki_reference",
        "vendor_site",
        "marketplace",
        "directory",
        "government",
        "education",
        "blog_independent",
        "affiliate",
        "docs",
        "other",
    }


async def test_a_project_has_one_primary_own_entity_at_a_time(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        second = await _entity(db, alpha)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
                "is_primary) VALUES ($1, $2, $3, 'own', true)",
                alpha.project_id,
                second,
                alpha.workspace_id,
            )
        # A removed one does not count.
        await db.execute(
            "UPDATE core.project_entities SET removed_at = now() WHERE project_id = $1",
            alpha.project_id,
        )
        await db.execute(
            "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
            "is_primary) VALUES ($1, $2, $3, 'own', true)",
            alpha.project_id,
            second,
            alpha.workspace_id,
        )


async def test_only_an_own_entity_is_primary(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        rival = await _entity(db, alpha)
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
                "is_primary) VALUES ($1, $2, $3, 'competitor', true)",
                alpha.project_id,
                rival,
                alpha.workspace_id,
            )


async def test_no_row_can_point_into_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Even for a role that bypasses row-level security: every key includes the workspace."""
    alpha, beta = tenants
    async with connection(migrated) as db:
        theirs = await _entity(db, beta)
        their_vocabulary = await _vocabulary(db, beta)
        domain_id = await _domain(db)
        attempts: list[tuple[str, tuple[Any, ...]]] = [
            (
                "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role) "
                "VALUES ($1, $2, $3, 'competitor')",
                (alpha.project_id, theirs, alpha.workspace_id),
            ),
            (
                "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role) "
                "VALUES ($1, $2, $3, 'competitor')",
                (beta.project_id, await _entity(db, alpha), alpha.workspace_id),
            ),
            (
                "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) "
                "VALUES ($1, $2, 'x')",
                (alpha.workspace_id, theirs),
            ),
            (
                "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id) "
                "VALUES ($1, $2, $3)",
                (theirs, alpha.workspace_id, domain_id),
            ),
            (
                "INSERT INTO core.entities (workspace_id, entity_type, canonical_name, "
                "parent_entity_id) VALUES ($1, 'product', 'p', $2)",
                (alpha.workspace_id, theirs),
            ),
            (
                "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
                "VALUES ($1, $2, 'tag', 'Theirs')",
                (alpha.workspace_id, beta.project_id),
            ),
            (
                "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
                "VALUES ($1, $2, 'X', 'x', 'x')",
                (alpha.workspace_id, their_vocabulary),
            ),
        ]
        for statement, args in attempts:
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                await db.execute(statement, *args)


async def test_a_term_and_its_parent_share_a_vocabulary(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Otherwise deleting one vocabulary would cascade into another."""
    alpha, _ = tenants
    async with connection(migrated) as db:
        first = await _vocabulary(db, alpha)
        second = await _vocabulary(db, alpha)
        parent = await _term(db, alpha, first, "crm")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, parent_id, name, "
                "slug, path) VALUES ($1, $2, $3, 'Child', 'child', 'crm/child')",
                alpha.workspace_id,
                second,
                parent,
            )


async def test_deleting_an_entity_a_project_has_named_is_refused(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """A removed role still names the entity: its history is read."""
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha)
        await db.execute(
            "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
            "removed_at) VALUES ($1, $2, $3, 'competitor', now())",
            alpha.project_id,
            entity_id,
            alpha.workspace_id,
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute("DELETE FROM core.entities WHERE id = $1", entity_id)

        unattached = await _entity(db, alpha)
        await db.execute(
            "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, 'u')",
            alpha.workspace_id,
            unattached,
        )
        await db.execute("DELETE FROM core.entities WHERE id = $1", unattached)
        assert (
            await db.fetchval(
                "SELECT count(*) FROM core.entity_aliases WHERE entity_id = $1", unattached
            )
            == 0
        )


async def test_a_path_prefix_is_given_exactly_when_the_scope_is_a_path_prefix(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha)
        domain_id = await _domain(db)
        for scope, prefix in (
            ("path_prefix", None),
            ("host", "/@acme"),
            ("path_prefix", "@acme"),
            ("path_prefix", "/@acme/"),
            ("path_prefix", "/a?b=1"),
        ):
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(
                    "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id, "
                    "match_scope, path_prefix) VALUES ($1, $2, $3, $4, $5)",
                    entity_id,
                    alpha.workspace_id,
                    domain_id,
                    scope,
                    prefix,
                )


async def test_an_entity_claims_several_prefixes_on_a_host_but_each_once(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha)
        domain_id = await _domain(db)
        insert = (
            "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id, match_scope, "
            "path_prefix) VALUES ($1, $2, $3, $4, $5)"
        )
        for scope, prefix in (
            ("path_prefix", "/acme"),
            ("path_prefix", "/acme-labs"),
            ("host", None),
        ):
            await db.execute(insert, entity_id, alpha.workspace_id, domain_id, scope, prefix)
        for scope, prefix in (("path_prefix", "/acme"), ("host", None)):
            with pytest.raises(asyncpg.UniqueViolationError):
                await db.execute(insert, entity_id, alpha.workspace_id, domain_id, scope, prefix)


async def test_an_entity_name_is_unique_whatever_its_case(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        await _entity(db, alpha, "HubSpot")
        with pytest.raises(asyncpg.UniqueViolationError):
            await _entity(db, alpha, "hubspot")
        # Another workspace has its own namespace.
        await _entity(db, beta, "hubspot")


async def test_an_alias_that_ignores_case_is_unique_whatever_its_case(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha)
        insert = (
            "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias, match_mode, "
            "case_sensitive) VALUES ($1, $2, $3, $4, $5)"
        )
        await db.execute(insert, alpha.workspace_id, entity_id, "HubSpot", "word_boundary", False)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                insert, alpha.workspace_id, entity_id, "hubspot", "word_boundary", False
            )
        # Case matters to these, so both spellings may stand.
        await db.execute(insert, alpha.workspace_id, entity_id, "hubspot", "word_boundary", True)
        await db.execute(insert, alpha.workspace_id, entity_id, "HUBSPOT", "exact_case", False)
        await db.execute(insert, alpha.workspace_id, entity_id, "hubspot", "exact_case", False)


async def test_root_terms_are_unique_by_slug_too(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """A NULL parent would let duplicates in under a plain unique constraint."""
    alpha, _ = tenants
    async with connection(migrated) as db:
        vocabulary_id = await db.fetchval(
            "SELECT id FROM core.taxonomy_vocabularies WHERE workspace_id = $1", alpha.workspace_id
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await _term(db, alpha, vocabulary_id, "crm")


async def test_a_workspace_wide_vocabulary_name_is_unique_whatever_its_case(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
                "VALUES ($1, 'topic', 'TOPICS')",
                alpha.workspace_id,
            )
        # The same name on a project is another vocabulary.
        await db.execute(
            "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
            "VALUES ($1, $2, 'topic', 'Topics')",
            alpha.workspace_id,
            alpha.project_id,
        )


async def test_slugs_and_paths_are_lower_case_and_paths_end_in_the_slug(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        vocabulary_id = await _vocabulary(db, alpha)
        parent = await _term(db, alpha, vocabulary_id, "crm")
        insert = (
            "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, parent_id, name, slug, "
            "path) VALUES ($1, $2, $3, 'Term', $4, $5)"
        )
        refused: list[tuple[uuid.UUID | None, str, str]] = [
            (None, "Upper-Case", "upper-case"),
            (None, "not a slug", "not a slug"),
            (None, "root", "other"),
            (None, "root", "crm/root"),
            (parent, "child", "child"),
            (parent, "child", "crm/other"),
            (parent, "child", "../crm/child"),
            (parent, "child", "CRM/child"),
        ]
        for parent_id, slug, path in refused:
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(insert, alpha.workspace_id, vocabulary_id, parent_id, slug, path)
        await db.execute(insert, alpha.workspace_id, vocabulary_id, parent, "child", "crm/child")


async def test_names_have_no_surrounding_space(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha)
        vocabulary_id = await _vocabulary(db, alpha)
        attempts: list[tuple[str, tuple[Any, ...]]] = [
            (
                "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
                "VALUES ($1, 'brand', $2)",
                (alpha.workspace_id, value),
            )
            for value in ("", "   ", " Acme", "x" * 201)
        ]
        attempts += [
            (
                "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) "
                "VALUES ($1, $2, $3)",
                (alpha.workspace_id, entity_id, value),
            )
            for value in ("", "acme ", "x" * 201)
        ]
        attempts += [
            (
                "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
                "VALUES ($1, 'tag', $2)",
                (alpha.workspace_id, value),
            )
            for value in ("", " Tags", "x" * 101)
        ]
        attempts.append(
            (
                "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
                "VALUES ($1, $2, ' CRM', 'crm', 'crm')",
                (alpha.workspace_id, vocabulary_id),
            )
        )
        for statement, args in attempts:
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(statement, *args)
        # A pattern may start or end with a space.
        await db.execute(
            "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias, match_mode) "
            "VALUES ($1, $2, ' acme ', 'regex')",
            alpha.workspace_id,
            entity_id,
        )


async def test_entity_parents_colors_and_locations_are_checked(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha)
        attempts: list[tuple[str, tuple[Any, ...]]] = [
            (
                "UPDATE core.entities SET parent_entity_id = id WHERE id = $1",
                (entity_id,),
            ),
            (
                "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
                "color) VALUES ($1, $2, $3, 'competitor', '#FF0000')",
                (alpha.project_id, entity_id, alpha.workspace_id),
            ),
            (
                "INSERT INTO core.locations (id, name, country_iso, location_type) "
                "VALUES (2147483001, 'Somewhere', 'us', 'Country')",
                (),
            ),
            (
                "INSERT INTO core.locations (id, name, country_iso, location_type) "
                "VALUES (2147483002, 'Somewhere', 'U', 'Country')",
                (),
            ),
        ]
        for statement, args in attempts:
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(statement, *args)


@pytest.mark.parametrize(
    ("host", "registrable", "suffix", "is_ip"),
    [
        ("Acme.com", "acme.com", "com", False),
        ("blog.acme.com", "evil.org", "org", False),
        ("blog.acme.com", "cme.com", "com", False),
        ("blog.acme.com", "acme.com", "org", False),
        ("blog.acme.com", "acme.com", "", False),
        ("192.168.0.1", "192.168.0.1", "1", True),
        ("192.168.0.1", "0.1", "", True),
    ],
)
async def test_a_domain_row_is_consistent_with_its_host(
    migrated: PostgresServer, host: str, registrable: str, suffix: str, is_ip: bool
) -> None:
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.domains (host, registrable_domain, public_suffix, is_ip) "
                "VALUES ($1, $2, $3, $4)",
                host,
                registrable,
                suffix,
                is_ip,
            )


async def test_the_api_adds_a_host_but_never_its_classification(
    migrated: PostgresServer,
) -> None:
    host = f"api-{_suffix()}.co.uk"
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(
                "INSERT INTO core.domains (host, registrable_domain, public_suffix, "
                "default_category) VALUES ($1, $1, 'co.uk', 'government')",
                host,
            )
    async with scoped(migrated, "app_api") as db:
        added = await db.fetchval(
            "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
            "VALUES ($1, $1, 'co.uk') ON CONFLICT (host) DO NOTHING RETURNING id",
            host,
        )
        assert added is not None


async def test_a_project_names_only_domains_and_locations_that_exist(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        for column in ("primary_domain_id", "default_location_id"):
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                await db.execute(
                    f"UPDATE core.projects SET {column} = 2147483000 WHERE id = $1",
                    alpha.project_id,
                )


async def test_the_project_domain_roles_view_shows_a_workspace_only_its_own(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        rows = await db.fetch("SELECT workspace_id, role FROM core.project_domain_roles")
    assert [(row["workspace_id"], row["role"]) for row in rows] == [(alpha.workspace_id, "own")]

    async with scoped(migrated, "app_api") as db:
        assert await db.fetch("SELECT 1 FROM core.project_domain_roles") == []
