"""The rules the Search Console tables keep by themselves (docs/04-data-model.md section 10,
docs/18 section 12; migration 0015)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, scoped, seed_tenant

type Db = asyncpg.Connection[asyncpg.Record]


@asynccontextmanager
async def refused(
    db: Db, error: type[Exception], *, match: str | None = None
) -> AsyncIterator[None]:
    """The statements inside are refused with `error`, and the transaction goes on."""
    with pytest.raises(error, match=match):
        async with db.transaction():
            yield


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


async def _connection_of(db: Db, tenant: Tenant) -> uuid.UUID:
    found: uuid.UUID = await db.fetchval(
        "SELECT id FROM fp.connections WHERE workspace_id = $1", tenant.workspace_id
    )
    return found


async def _secret(db: Db, workspace_id: uuid.UUID | None) -> uuid.UUID:
    made: uuid.UUID = await db.fetchval(
        "INSERT INTO ops.secrets (workspace_id, kind, ciphertext, dek_wrapped, kek_version, "
        "fingerprint) VALUES ($1, 'oauth_refresh_token', '\\x00', '\\x00', 1, 'abcd') RETURNING id",
        workspace_id,
    )
    return made


async def test_the_gsc_numbers_are_partitioned_by_month_and_reach_back_for_a_backfill(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        months = await db.fetch(
            "SELECT pg_get_expr(c.relpartbound, c.oid) AS bound FROM pg_inherits i "
            "JOIN pg_class c ON c.oid = i.inhrelid "
            "WHERE i.inhparent = 'fp.gsc_search_analytics'::regclass ORDER BY c.relname"
        )
        registered = await db.fetchrow(
            "SELECT key_is_date, months_back FROM ops.partitioned_tables "
            "WHERE parent = 'fp.gsc_search_analytics'::regclass"
        )
    # 16 months of history, this month and three ahead; each month is a plain date range
    assert len(months) == 17 + 1 + 3
    assert all("00:00:00" not in row["bound"] for row in months)
    assert registered is not None
    assert (registered["key_is_date"], registered["months_back"]) == (True, 17)


async def test_a_day_sixteen_months_ago_has_a_partition(migrated: PostgresServer) -> None:
    now = datetime.now(UTC)
    index = now.year * 12 + (now.month - 1) - 16
    oldest = date(index // 12, index % 12 + 1, 15)
    tenant = await seed_tenant(migrated, "gamma")
    async with scoped(migrated, "superuser") as db:
        integration = await db.fetchval(
            "SELECT id FROM fp.integrations WHERE workspace_id = $1", tenant.workspace_id
        )
        placed = await db.fetchval(
            "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
            "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
            "impressions, position_sum, data_state) VALUES ($1, $2, 'web', '\\x01', 1, "
            "'USA', 'MOBILE', $3, $4, 0, 1, 2, 'final') RETURNING tableoid::regclass::text",
            integration,
            oldest,
            tenant.workspace_id,
            tenant.project_id,
        )
    assert placed == f"fp.gsc_search_analytics_p{oldest:%Y%m}"


async def test_a_connection_that_is_not_revoked_keeps_its_secret(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        connection_id = await _connection_of(db, alpha)
        async with refused(db, asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE fp.connections SET credential_ref = NULL WHERE id = $1", connection_id
            )
        await db.execute(
            "UPDATE fp.connections SET credential_ref = NULL, status = 'revoked' WHERE id = $1",
            connection_id,
        )


async def test_a_secret_cannot_be_deleted_while_a_connection_names_it(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        connection_id = await _connection_of(db, alpha)
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute("DELETE FROM ops.secrets WHERE workspace_id = $1", alpha.workspace_id)
        await db.execute(
            "UPDATE fp.connections SET credential_ref = NULL, status = 'revoked' WHERE id = $1",
            connection_id,
        )
        await db.execute("DELETE FROM ops.secrets WHERE workspace_id = $1", alpha.workspace_id)


async def test_a_connection_cannot_name_a_secret_of_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        foreign = await _secret(db, beta.workspace_id)
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "UPDATE fp.connections SET credential_ref = $1 WHERE workspace_id = $2",
                foreign,
                alpha.workspace_id,
            )


async def test_one_google_account_is_one_connection_per_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        subject = await db.fetchval(
            "SELECT subject_id FROM fp.connections WHERE workspace_id = $1", alpha.workspace_id
        )
        secret = await _secret(db, alpha.workspace_id)
        async with refused(db, asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
                "credential_ref, scopes) VALUES ($1, 'google', 'oauth', $2, $3, '{}')",
                alpha.workspace_id,
                subject,
                secret,
            )
        # The same Google account in another workspace is another grant
        other = await _secret(db, beta.workspace_id)
        await db.execute(
            "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
            "credential_ref, scopes) VALUES ($1, 'google', 'oauth', $2, $3, '{}')",
            beta.workspace_id,
            subject,
            other,
        )


async def test_an_integration_belongs_to_a_connection_and_a_project_of_its_own_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        beta_connection = await _connection_of(db, beta)
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO fp.integrations (workspace_id, project_id, kind, "
                "external_property, connection_id, scopes, status) "
                "VALUES ($1, $2, 'gsc', 'sc-domain:other.example', $3, '{}', 'disabled')",
                alpha.workspace_id,
                alpha.project_id,
                beta_connection,
            )
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO fp.integrations (workspace_id, project_id, kind, "
                "external_property, connection_id, scopes, status) "
                "VALUES ($1, $2, 'gsc', 'sc-domain:other.example', $3, '{}', 'disabled')",
                alpha.workspace_id,
                beta.project_id,
                await _connection_of(db, alpha),
            )


async def test_an_integration_other_than_server_logs_needs_a_connection(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with (
        scoped(migrated, "superuser") as db,
        refused(db, asyncpg.CheckViolationError, match="connection_required"),
    ):
        await db.execute(
            "INSERT INTO fp.integrations (workspace_id, project_id, kind, "
            "external_property, scopes) VALUES ($1, $2, 'gsc', 'sc-domain:x.example', '{}')",
            alpha.workspace_id,
            alpha.project_id,
        )


async def test_a_property_is_linked_once_per_workspace_and_a_project_has_one_live_property(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    insert = (
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
        "connection_id, scopes, status) VALUES ($1, $2, 'gsc', $3, $4, '{}', $5)"
    )
    async with scoped(migrated, "superuser") as db:
        connection_id = await _connection_of(db, alpha)
        # sc-domain:example.com is already linked to the project by the seed
        async with refused(db, asyncpg.UniqueViolationError, match="external_property_key"):
            await db.execute(
                insert,
                alpha.workspace_id,
                alpha.project_id,
                "sc-domain:example.com",
                connection_id,
                "disabled",
            )
        async with refused(db, asyncpg.UniqueViolationError, match="one_live_per_project"):
            await db.execute(
                insert,
                alpha.workspace_id,
                alpha.project_id,
                "https://example.com/",
                connection_id,
                "active",
            )
        # A disabled one is history, not a second property
        await db.execute(
            insert,
            alpha.workspace_id,
            alpha.project_id,
            "https://example.com/",
            connection_id,
            "disabled",
        )


async def test_deleting_a_project_removes_its_integrations_and_their_numbers(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        project_id = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'Second', 'second') "
            "RETURNING id",
            alpha.workspace_id,
        )
        integration = await db.fetchval(
            "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
            "connection_id, scopes) VALUES ($1, $2, 'gsc', 'sc-domain:second.example', $3, '{}') "
            "RETURNING id",
            alpha.workspace_id,
            project_id,
            await _connection_of(db, alpha),
        )
        await db.execute(
            "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
            "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
            "impressions, position_sum, data_state) VALUES ($1, current_date, 'web', '\\x03', 1, "
            "'USA', 'DESKTOP', $2, $3, 1, 1, 1, 'final')",
            integration,
            alpha.workspace_id,
            project_id,
        )
        await db.execute("DELETE FROM core.projects WHERE id = $1", project_id)
        left = await db.fetchval(
            "SELECT (SELECT count(*) FROM fp.integrations WHERE id = $1) "
            "+ (SELECT count(*) FROM fp.gsc_search_analytics WHERE integration_id = $1)",
            integration,
        )
    assert left == 0


async def test_numbers_cannot_be_negative_or_of_an_unknown_kind(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        integration = await db.fetchval(
            "SELECT id FROM fp.integrations WHERE workspace_id = $1", alpha.workspace_id
        )
        insert = (
            "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
            "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
            "impressions, position_sum, data_state) VALUES ($1, current_date, $2, '\\x02', 9, "
            "'USA', $3, $4, $5, $6, 1, 1, 'final')"
        )
        for search_type, device, clicks in (
            ("web", "DESKTOP", -1),
            ("maps", "DESKTOP", 1),
            ("web", "WATCH", 1),
        ):
            async with refused(db, asyncpg.CheckViolationError):
                await db.execute(
                    insert,
                    integration,
                    search_type,
                    device,
                    alpha.workspace_id,
                    alpha.project_id,
                    clicks,
                )


async def test_the_api_cannot_see_a_platform_secret_or_another_workspaces(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as admin:
        platform = await _secret(admin, None)
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        visible = {
            row["workspace_id"] for row in await db.fetch("SELECT workspace_id FROM ops.secrets")
        }
        assert visible == {alpha.workspace_id}
        assert await db.fetchval("SELECT count(*) FROM ops.secrets WHERE id = $1", platform) == 0
    async with connection(migrated) as admin:
        await admin.execute("DELETE FROM ops.secrets WHERE id = $1", platform)
    assert beta.workspace_id != alpha.workspace_id


async def test_the_api_cannot_write_a_secret_into_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with (
        scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db,
        refused(db, asyncpg.InsufficientPrivilegeError),
    ):
        await _secret(db, beta.workspace_id)


async def test_a_secret_is_replaced_by_a_new_row_never_changed(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with (
        scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db,
        refused(db, asyncpg.InsufficientPrivilegeError),
    ):
        await db.execute("UPDATE ops.secrets SET ciphertext = '\\x01'")
    async with (
        scoped(migrated, "app_worker") as db,
        refused(db, asyncpg.InsufficientPrivilegeError),
    ):
        await db.execute("DELETE FROM ops.secrets")


async def test_the_worker_cannot_connect_or_choose_a_property(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "app_worker") as db:
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute(
                "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
                "scopes) VALUES ($1, $2, 'server_logs', 'x', '{}')",
                alpha.workspace_id,
                alpha.project_id,
            )
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE fp.connections SET subject_id = 'other'")
        # What a failed refresh records
        await db.execute(
            "UPDATE fp.connections SET status = 'reauth_required', "
            "last_error_code = 'invalid_grant'"
        )


async def test_the_worker_replaces_a_day_of_numbers_but_cannot_edit_one_or_remove_a_query(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """What the pull does (docs/18 section 4.4) and nothing wider."""
    alpha, _ = tenants
    async with scoped(migrated, "app_worker") as db:
        removed = await db.execute(
            "DELETE FROM fp.gsc_search_analytics WHERE workspace_id = $1", alpha.workspace_id
        )
        assert removed.startswith("DELETE ")
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE fp.gsc_search_analytics SET clicks = clicks + 1")
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("DELETE FROM fp.gsc_queries")
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE fp.integrations SET external_property = 'sc-domain:x'")
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE fp.connections SET credential_ref = NULL")
        # The status columns the pull keeps, and nothing else of the integration
        await db.execute(
            "UPDATE fp.integrations SET last_error = 'quota_exceeded', "
            "backfill_state = '{\"gsc\": {}}', last_success_at = now()"
        )


async def test_the_api_reads_the_numbers_and_cannot_write_them(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        assert await db.fetchval("SELECT count(*) FROM fp.gsc_search_analytics") >= 1
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("DELETE FROM fp.gsc_search_analytics")
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE fp.gsc_search_analytics SET clicks = 0")


async def test_a_query_is_found_by_its_hash_and_date_in_every_month(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        parent = await db.fetchval(
            "SELECT count(*) FROM pg_indexes WHERE schemaname = 'fp' "
            "AND tablename = 'gsc_search_analytics' AND indexname = 'gsc_search_analytics_query'"
        )
        month_tables = await db.fetchval(
            "SELECT count(*) FROM pg_inherits WHERE inhparent = 'fp.gsc_search_analytics'::regclass"
        )
        month_indexes = await db.fetchval(
            "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
            "JOIN pg_inherits h ON h.inhrelid = i.indrelid "
            "WHERE h.inhparent = 'fp.gsc_search_analytics'::regclass "
            "AND pg_get_indexdef(i.indexrelid) LIKE '%(query_hash, metric_date)'"
        )
    assert parent == 1
    assert month_indexes == month_tables
