"""The rules the entity, domain, location and taxonomy tables keep by themselves
(docs/04-data-model.md sections 5 and 6)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, scoped, seed_tenant


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


async def _entity(db: asyncpg.Connection[asyncpg.Record], tenant: Tenant, name: str) -> uuid.UUID:
    entity_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', $2) RETURNING id",
        tenant.workspace_id,
        name,
    )
    return entity_id


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
        second = await _entity(db, alpha, f"second {uuid.uuid4().hex[:6]}")
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
        rival = await _entity(db, alpha, f"rival {uuid.uuid4().hex[:6]}")
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
    """Even for a role that bypasses row-level security: the keys include the workspace."""
    alpha, beta = tenants
    async with connection(migrated) as db:
        theirs = await _entity(db, beta, f"theirs {uuid.uuid4().hex[:6]}")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role) "
                "VALUES ($1, $2, $3, 'competitor')",
                alpha.project_id,
                theirs,
                alpha.workspace_id,
            )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) "
                "VALUES ($1, $2, 'x')",
                alpha.workspace_id,
                theirs,
            )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO core.entities (workspace_id, entity_type, canonical_name, "
                "parent_entity_id) VALUES ($1, 'product', 'p', $2)",
                alpha.workspace_id,
                theirs,
            )


async def test_a_path_prefix_is_given_exactly_when_the_scope_is_a_path_prefix(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        entity_id = await _entity(db, alpha, f"scoped {uuid.uuid4().hex[:6]}")
        domain_id = await db.fetchval(
            "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
            "VALUES ($1, 'medium.com', 'com') RETURNING id",
            f"medium-{uuid.uuid4().hex[:6]}.com",
        )
        for scope, prefix in (("path_prefix", None), ("host", "/@acme")):
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
            await db.execute(
                "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
                "VALUES ($1, $2, 'Crm', 'CRM', 'crm')",
                alpha.workspace_id,
                vocabulary_id,
            )
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
                "VALUES ($1, $2, 'Bad', 'not a slug', 'bad')",
                alpha.workspace_id,
                vocabulary_id,
            )


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


async def test_the_view_runs_with_the_readers_rights(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        options = await db.fetchval(
            "SELECT reloptions FROM pg_class WHERE oid = 'core.project_domain_roles'::regclass"
        )
        grantees = {
            row["grantee"]
            for row in await db.fetch(
                "SELECT grantee FROM information_schema.role_table_grants "
                "WHERE table_schema = 'core' AND table_name = 'project_domain_roles' "
                "AND grantee IN ('app_api', 'app_worker')"
            )
        }
    assert options == ["security_invoker=true"]
    assert grantees == {"app_api"}
