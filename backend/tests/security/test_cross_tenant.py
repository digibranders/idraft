"""The cross-tenant suite (docs/26-testing-quality.md section 6.1, cases XT-01 to XT-05).

Workspaces A and B are built alike. Every route with a workspace in its path is taken from the
application itself and called as A's owner with B's ids, so a new route is covered without being
added here. A route whose path has a parameter this suite has no id for fails, and so does a
route that is neither workspace-scoped nor listed in cross_tenant_exceptions.py.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi.routing import iter_route_contexts

from sightline.api.auth.tokens import hash_token, new_token
from sightline.api.main import create_app
from sightline.api.openapi import placeholder_settings
from sightline.api.resources import Resources
from tests.api.auth.support import (
    User,
    Workspace,
    add_member,
    cookie,
    execute,
    fetch,
    fetchrow,
    make_user,
    make_workspace,
    open_session,
)
from tests.api.keywords.support import LOCATION, ensure_locations
from tests.api.test_route_access import PATH_PARAMETER
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer
from tests.security.cross_tenant_exceptions import NOT_PATH_SCOPED

_W = "/api/v1/workspaces/{workspace_id}"
_READ = ("GET", "HEAD")


def _routes() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        found.extend((method, route.path) for method in sorted(route.methods))
    return found


ALL_ROUTES = _routes()


def _names(path: str) -> list[str]:
    """The path's parameters, written `{name}` or `{name:converter}`."""
    return PATH_PARAMETER.findall(path)


WORKSPACE_ROUTES = [(method, path) for method, path in ALL_ROUTES if "workspace_id" in _names(path)]
# Routes that also name something inside the workspace: a project, a member, an invitation.
CHILD_ROUTES = [
    (method, path) for method, path in WORKSPACE_ROUTES if set(_names(path)) - {"workspace_id"}
]
# Every GET that returns tenant data without naming a child: the lists, and the two routes
# that list the caller's workspaces.
LIST_ROUTES = [
    (method, path)
    for method, path in WORKSPACE_ROUTES
    if method == "GET" and (method, path) not in CHILD_ROUTES
] + [("GET", "/api/v1/me"), ("GET", "/api/v1/workspaces")]

# A body each mutating route accepts, so a request that is let through would change something.
BODIES: dict[tuple[str, str], dict[str, Any]] = {
    ("PATCH", _W): {"name": "Taken over"},
    ("PATCH", _W + "/members/{user_id}"): {"role": "viewer"},
    ("POST", _W + "/invitations"): {"email": "intruder@evil.example", "role": "admin"},
    ("POST", _W + "/projects"): {"name": "Planted", "slug": "planted"},
    ("PATCH", _W + "/projects/{project_id}"): {"name": "Taken over"},
    ("POST", _W + "/entities"): {"entity_type": "brand", "canonical_name": "Planted"},
    ("PATCH", _W + "/entities/{entity_id}"): {"canonical_name": "Taken over"},
    ("POST", _W + "/entities/{entity_id}/aliases"): {"alias": "planted"},
    ("PATCH", _W + "/entities/{entity_id}/aliases/{alias_id}"): {"alias": "taken over"},
    ("POST", _W + "/entities/{entity_id}/domains"): {"domain": "planted.example"},
    # `{name}` in a body is the id the call is made with, like the path's.
    ("POST", _W + "/projects/{project_id}/entities"): {
        "entity_id": "{spare_entity_id}",
        "role": "competitor",
    },
    ("PATCH", _W + "/projects/{project_id}/entities/{entity_id}"): {"track_ai": False},
    ("POST", _W + "/projects/{project_id}/alias-test"): {"text": "Acme"},
    ("POST", _W + "/vocabularies"): {"kind": "topic", "name": "Planted"},
    ("PATCH", _W + "/vocabularies/{vocabulary_id}"): {"name": "Taken over"},
    ("POST", _W + "/vocabularies/{vocabulary_id}/terms"): {"name": "Planted"},
    ("PATCH", _W + "/terms/{term_id}"): {"name": "Taken over"},
    ("POST", _W + "/projects/{project_id}/tracked-keywords"): {
        "keyword": "planted",
        "location_id": LOCATION,
        "language_code": "en",
    },
    ("POST", _W + "/projects/{project_id}/tracked-keywords/bulk-create"): {
        "items": [{"keyword": "planted", "location_id": LOCATION, "language_code": "en"}],
    },
    ("POST", _W + "/projects/{project_id}/keyword-groups"): {"name": "Planted"},
    ("PATCH", _W + "/projects/{project_id}/keyword-groups/{group_id}"): {"name": "Taken over"},
    ("POST", _W + "/projects/{project_id}/keyword-groups/{group_id}/members"): {
        "tracked_keyword_ids": ["{tracked_keyword_id}"],
    },
    ("POST", _W + "/projects/{project_id}/keyword-groups/{group_id}/members/remove"): {
        "tracked_keyword_ids": ["{tracked_keyword_id}"],
    },
    ("POST", _W + "/projects/{project_id}/term-assignments"): {
        "op": "remove",
        "subject_type": "tracked_keyword",
        "subject_ids": ["{tracked_keyword_id}"],
        "term_ids": ["{term_id}"],
    },
    ("POST", _W + "/projects/{project_id}/keyword-metrics/refresh"): {
        "keyword_ids": ["{keyword_id}"],
    },
    ("POST", _W + "/projects/{project_id}/tracked-keywords/bulk-update"): {
        "ids": ["{tracked_keyword_id}"],
        "set": {"priority": 1},
    },
    ("POST", _W + "/projects/{project_id}/tracked-keywords/bulk-archive"): {
        "ids": ["{tracked_keyword_id}"],
        "archive": True,
    },
    ("POST", _W + "/projects/{project_id}/tracked-keywords/bulk-delete"): {
        "ids": ["{tracked_keyword_id}"],
    },
    ("PATCH", _W + "/projects/{project_id}/tracked-keywords/{tracked_keyword_id}"): {
        "priority": 1,
    },
    ("PUT", _W + "/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/competitors"): {
        "exclude": ["{entity_id}"],
    },
    ("POST", _W + "/projects/{project_id}/schedules"): {
        "workload": "keyword_metrics",
        "name": "Planted",
        "cadence": "daily",
        "timezone": "UTC",
        "window_start_local": "03:00",
        "provider_mode": "live",
        "selector": {"groups": ["{group_id}"]},
    },
    ("PATCH", _W + "/projects/{project_id}/schedules/{schedule_id}"): {"name": "Taken over"},
    ("POST", _W + "/projects/{project_id}/schedules/{schedule_id}/pause"): {"reason": "taken"},
    ("POST", _W + "/projects/{project_id}/schedules/{schedule_id}/resume"): {},
    ("POST", _W + "/projects/{project_id}/runs/{run_id}/cancel"): {"reason": "taken"},
    ("PATCH", _W + "/projects/{project_id}/settings"): {"seo": {"default_device": "mobile"}},
}
# Query parameters a route requires, so that it answers for its path and not for a missing
# parameter.
QUERIES: dict[tuple[str, str], dict[str, str]] = {
    ("GET", _W + "/keywords/{keyword_id}/metrics-history"): {
        "location_id": str(LOCATION),
        "language_code": "en",
    },
    ("GET", _W + "/costs"): {"from": "2026-01-01", "to": "2026-12-31", "group_by": "project"},
}
# Lists under a workspace's path that hold the platform's data, the same for every workspace:
# they have no tenant data of their own to show.
PLATFORM_LISTS = {_W + "/price-book"}


@dataclass(frozen=True)
class Tenant:
    workspace: Workspace
    owner: User
    headers: dict[str, str]
    member: User
    project_id: uuid.UUID
    invitation_id: uuid.UUID
    invitee: str
    entity_id: uuid.UUID
    alias_id: uuid.UUID
    entity_domain_id: uuid.UUID
    # An entity whose role in the project was removed: giving it a role again succeeds.
    spare_entity_id: uuid.UUID
    vocabulary_id: uuid.UUID
    term_id: uuid.UUID
    keyword_id: uuid.UUID
    tracked_keyword_id: uuid.UUID
    group_id: uuid.UUID
    schedule_id: uuid.UUID
    # A running run, so cancelling it would succeed.
    run_id: uuid.UUID
    # The project's budget; the project has costs too.
    budget_id: uuid.UUID

    def ids(self) -> dict[str, str]:
        return {
            "workspace_id": str(self.workspace.id),
            "project_id": str(self.project_id),
            "user_id": str(self.member.id),
            "invitation_id": str(self.invitation_id),
            "entity_id": str(self.entity_id),
            "alias_id": str(self.alias_id),
            "entity_domain_id": str(self.entity_domain_id),
            "spare_entity_id": str(self.spare_entity_id),
            "vocabulary_id": str(self.vocabulary_id),
            "term_id": str(self.term_id),
            "keyword_id": str(self.keyword_id),
            "tracked_keyword_id": str(self.tracked_keyword_id),
            "group_id": str(self.group_id),
            "schedule_id": str(self.schedule_id),
            "run_id": str(self.run_id),
            "budget_id": str(self.budget_id),
        }

    def secrets(self) -> list[str]:
        """Everything that identifies this tenant and must never reach another."""
        return [
            *self.ids().values(),
            str(self.owner.id),
            self.workspace.slug,
            self.owner.email,
            self.member.email,
            self.invitee,
        ]


async def _tenant(resources: Resources, pg: PostgresServer, label: str) -> Tenant:
    """One workspace with an owner, a second member, a project and a pending invitation. The two
    tenants collide where they can: same names, same project slug."""
    workspace = await make_workspace(pg, name="Acme")
    owner, member = await make_user(pg, name="Owner"), await make_user(pg, name="Member")
    await add_member(pg, workspace, owner, "owner")
    await add_member(pg, workspace, member, "editor")
    project_id = await make_project(pg, workspace.id, name="crm software", slug="crm-software")
    await execute(pg, "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", workspace.id)
    invitee = f"{label}-invitee-{uuid.uuid4().hex[:8]}@client.example"
    invitation = await fetchrow(
        pg,
        "INSERT INTO auth.invitations (workspace_id, email, role, token_hash, invited_by, "
        "expires_at) VALUES ($1, $2, 'viewer', $3, $4, now() + interval '7 days') RETURNING id",
        workspace.id,
        invitee,
        hash_token(new_token()),
        owner.id,
    )
    # The same brand in both, with an alias and a domain, named by the project.
    entity = await fetchrow(
        pg,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', 'Acme') RETURNING id",
        workspace.id,
    )
    alias = await fetchrow(
        pg,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) "
        "VALUES ($1, $2, 'Acme') RETURNING id",
        workspace.id,
        entity["id"],
    )
    domain = await fetchrow(
        pg,
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ('acme.example', 'acme.example', 'example') "
        "ON CONFLICT (host) DO UPDATE SET host = excluded.host RETURNING id",
    )
    entity_domain = await fetchrow(
        pg,
        "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id) "
        "VALUES ($1, $2, $3) RETURNING id",
        entity["id"],
        workspace.id,
        domain["id"],
    )
    # Not primary, so that removing the role is allowed.
    await execute(
        pg,
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role) "
        "VALUES ($1, $2, $3, 'own')",
        project_id,
        entity["id"],
        workspace.id,
    )
    spare = await fetchrow(
        pg,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', 'Rival') RETURNING id",
        workspace.id,
    )
    await execute(
        pg,
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
        "removed_at) VALUES ($1, $2, $3, 'watch', now())",
        project_id,
        spare["id"],
        workspace.id,
    )
    # The same workspace-wide vocabulary and term in both.
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical) "
        "VALUES ($1, 'topic', 'Topics', true) RETURNING id",
        workspace.id,
    )
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'CRM', 'crm', 'crm') RETURNING id",
        workspace.id,
        vocabulary["id"],
    )
    # The same keyword in both, tracked by the project with one configuration version and a
    # competitor override.
    await ensure_locations(pg)
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, 'crm software', 'crm software', 'en') RETURNING id",
        workspace.id,
    )
    tracked = await fetchrow(
        pg,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device) VALUES ($1, $2, $3, $4, 'en', 'desktop') RETURNING id",
        workspace.id,
        project_id,
        keyword["id"],
        LOCATION,
    )
    await execute(
        pg,
        "INSERT INTO seo.tracked_keyword_config_history (tracked_keyword_id, workspace_id, "
        "config_version, depth_profile, valid_from) VALUES ($1, $2, 1, 'standard', now())",
        tracked["id"],
        workspace.id,
    )
    await execute(
        pg,
        "INSERT INTO seo.tracked_keyword_competitors (tracked_keyword_id, entity_id, "
        "workspace_id, mode) VALUES ($1, $2, $3, 'include')",
        tracked["id"],
        entity["id"],
        workspace.id,
    )
    # The same group in both, holding the keyword, which also has the term.
    group = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, 'Pricing', 'Pricing') RETURNING id",
        workspace.id,
        project_id,
    )
    await execute(
        pg,
        "INSERT INTO seo.keyword_group_members (group_id, tracked_keyword_id, project_id, "
        "workspace_id) VALUES ($1, $2, $3, $4)",
        group["id"],
        tracked["id"],
        project_id,
        workspace.id,
    )
    await execute(
        pg,
        "INSERT INTO seo.tracked_keyword_terms (tracked_keyword_id, term_id, workspace_id) "
        "VALUES ($1, $2, $3)",
        tracked["id"],
        term["id"],
        workspace.id,
    )
    # The same schedule in both, and a run of it under way.
    schedule = await fetchrow(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at, provider_mode, selector) VALUES ($1, $2, 'keyword_metrics', 'Metrics', "
        "'daily', 'UTC', now() + interval '1 day', 'live', '{\"stale_days\": 25}') RETURNING id",
        workspace.id,
        project_id,
    )
    run = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot) VALUES ($1, $2, $3, "
        "'keyword_metrics', now(), now() + interval '2 hours', 'schedule', 'running', '{}') "
        "RETURNING id",
        workspace.id,
        project_id,
        schedule["id"],
    )
    # The same budget and the same costs in both.
    budget = await fetchrow(
        pg,
        "INSERT INTO ops.budgets (workspace_id, project_id, workload, limit_usd) "
        "VALUES ($1, $2, 'keyword_research', 10) RETURNING id",
        workspace.id,
        project_id,
    )
    await execute(
        pg,
        "INSERT INTO ops.cost_daily (cost_date, workspace_id, project_id, provider_code, "
        "endpoint, workload, request_count, cost_usd, subjects) VALUES ('2026-09-30', $1, $2, "
        "'dataforseo', 'dataforseo_labs/google/keyword_overview', 'keyword_metrics', 1, 0.012, 1)",
        workspace.id,
        project_id,
    )
    # Fresh, so that a route wanting a recent credential is not refused for that instead.
    token, _ = await open_session(resources, owner, fresh=True)
    return Tenant(
        workspace=workspace,
        owner=owner,
        headers=cookie(token),
        member=member,
        project_id=project_id,
        invitation_id=invitation["id"],
        invitee=invitee,
        entity_id=entity["id"],
        alias_id=alias["id"],
        entity_domain_id=entity_domain["id"],
        spare_entity_id=spare["id"],
        vocabulary_id=vocabulary["id"],
        term_id=term["id"],
        keyword_id=keyword["id"],
        tracked_keyword_id=tracked["id"],
        group_id=group["id"],
        schedule_id=schedule["id"],
        run_id=run["id"],
        budget_id=budget["id"],
    )


@pytest.fixture
async def tenants(resources: Resources, migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await _tenant(resources, migrated, "a"), await _tenant(resources, migrated, "b")


def _fill(path: str, ids: dict[str, str]) -> str:
    def value(match: re.Match[str]) -> str:
        name = match.group(1)
        assert name in ids, f"the cross-tenant suite has no id for the path parameter {name!r}"
        return ids[name]

    filled = PATH_PARAMETER.sub(value, path)
    assert "{" not in filled, f"a path parameter of {path} was not understood"
    return filled


async def _call(
    api: httpx.AsyncClient, method: str, path: str, ids: dict[str, str], headers: dict[str, str]
) -> httpx.Response:
    body = None if method in _READ else BODIES.get((method, path), {})
    if body is not None:
        body = {key: _fill_value(value, ids) for key, value in body.items()}
    return await api.request(
        method,
        _fill(path, ids),
        params=QUERIES.get((method, path)),
        json=body,
        headers=headers,
    )


def _fill_value(value: object, ids: dict[str, str]) -> object:
    """A body member with the ids of the call: a string, or each string of a list or object."""
    if isinstance(value, str):
        return _fill(value, ids)
    if isinstance(value, list):
        return [_fill_value(item, ids) for item in value]
    if isinstance(value, dict):
        return {key: _fill_value(item, ids) for key, item in value.items()}
    return value


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def _without_request_details(response: httpx.Response) -> dict[str, Any]:
    body: dict[str, Any] = response.json()
    return {key: value for key, value in body.items() if key not in ("instance", "request_id")}


_TENANT_ROWS = {
    "auth.workspaces": "id",
    "auth.memberships": "workspace_id",
    "auth.invitations": "workspace_id",
    "core.projects": "workspace_id",
    "core.workspace_quotas": "workspace_id",
    "core.entities": "workspace_id",
    "core.entity_aliases": "workspace_id",
    "core.entity_domains": "workspace_id",
    "core.project_entities": "workspace_id",
    "core.taxonomy_vocabularies": "workspace_id",
    "core.taxonomy_terms": "workspace_id",
    "seo.keywords": "workspace_id",
    "seo.tracked_keywords": "workspace_id",
    "seo.tracked_keyword_config_history": "workspace_id",
    "seo.tracked_keyword_competitors": "workspace_id",
    "seo.keyword_groups": "workspace_id",
    "seo.keyword_group_members": "workspace_id",
    "seo.tracked_keyword_terms": "workspace_id",
    "ops.schedules": "workspace_id",
    "ops.budgets": "workspace_id",
    "ops.cost_daily": "workspace_id",
    "ops.collection_runs": "workspace_id",
    "ops.audit_logs": "workspace_id",
}


async def _checksum(pg: PostgresServer, *workspaces: Workspace) -> dict[str, str | None]:
    """A digest of every row the two tenants have, table by table."""
    ids = [workspace.id for workspace in workspaces]
    digests = {}
    for table, column in _TENANT_ROWS.items():
        row = await fetchrow(
            pg,
            f"SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS digest FROM {table} t "
            f"WHERE t.{column} = ANY($1::uuid[])",
            ids,
        )
        digests[table] = row["digest"]
    return digests


def test_every_route_is_scoped_by_a_workspace_or_accounted_for() -> None:
    unscoped = {route for route in ALL_ROUTES if "workspace_id" not in _names(route[1])}
    assert unscoped == set(NOT_PATH_SCOPED)
    assert all(path.startswith("/api/v1/workspaces/{workspace_id}") for _, path in WORKSPACE_ROUTES)
    # Each mutating route has a body that would do something if it were let through.
    mutating_with_body = {
        (method, path) for method, path in WORKSPACE_ROUTES if method in ("POST", "PATCH", "PUT")
    }
    assert mutating_with_body == set(BODIES)


@pytest.mark.parametrize(("method", "path"), WORKSPACE_ROUTES)
async def test_another_workspaces_path_is_not_found(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-01, XT-02 and XT-03: B's ids in the path, as A's owner. Always 404, never 403, and
    the same answer as for a workspace that does not exist."""
    a, b = tenants
    missing = {name: str(uuid.uuid4()) for name in b.ids()}

    foreign = await _call(api, method, path, b.ids(), a.headers)
    nowhere = await _call(api, method, path, missing, a.headers)

    assert _problem(foreign) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(foreign) == _without_request_details(nowhere)


@pytest.mark.parametrize(("method", "path"), CHILD_ROUTES)
async def test_another_workspaces_child_in_the_callers_own_path_is_not_found(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-01 and XT-02 for child ids: A's workspace in the path, B's project, member or
    invitation after it."""
    a, b = tenants
    ids = {**b.ids(), "workspace_id": str(a.workspace.id)}
    missing = {**{name: str(uuid.uuid4()) for name in b.ids()}, "workspace_id": str(a.workspace.id)}

    foreign = await _call(api, method, path, ids, a.headers)
    nowhere = await _call(api, method, path, missing, a.headers)

    assert _problem(foreign) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(foreign) == _without_request_details(nowhere)


PROJECT_ROUTES = [
    (method, path) for method, path in WORKSPACE_ROUTES if "project_id" in _names(path)
]


@pytest.mark.parametrize(("method", "path"), PROJECT_ROUTES)
async def test_a_project_outside_the_members_scope_is_not_found(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    tenants: tuple[Tenant, Tenant],
    method: str,
    path: str,
) -> None:
    """The same isolation inside one workspace: a member limited to one project gets 404 for
    another project of their own workspace, on every route that names a project, whatever
    their role would otherwise allow."""
    a, _ = tenants
    hidden = await make_project(migrated, a.workspace.id, name="Hidden", slug="hidden")
    limited = await make_user(migrated, name="Limited")
    await add_member(migrated, a.workspace, limited, "editor", [a.project_id])
    token, _ = await open_session(resources, limited, fresh=True)

    outside = await _call(api, method, path, {**a.ids(), "project_id": str(hidden)}, cookie(token))
    nowhere = await _call(
        api, method, path, {**a.ids(), "project_id": str(uuid.uuid4())}, cookie(token)
    )
    inside = await _call(api, method, path, a.ids(), cookie(token))

    assert _problem(outside) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(outside) == _without_request_details(nowhere)
    assert inside.status_code < 300, inside.text
    row = await fetchrow(migrated, "SELECT name FROM core.projects WHERE id = $1", hidden)
    assert row["name"] == "Hidden"


async def test_no_request_with_another_workspaces_ids_changes_anything(
    api: httpx.AsyncClient, migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """XT-02: every mutating route, both ways, leaves every tenant row as it was."""
    a, b = tenants
    before = await _checksum(migrated, a.workspace, b.workspace)
    assert all(digest is not None for table, digest in before.items() if table != "ops.audit_logs")

    for method, path in WORKSPACE_ROUTES:
        if method in _READ:
            continue
        await _call(api, method, path, b.ids(), a.headers)
        if (method, path) in CHILD_ROUTES:
            await _call(
                api, method, path, {**b.ids(), "workspace_id": str(a.workspace.id)}, a.headers
            )

    assert await _checksum(migrated, a.workspace, b.workspace) == before


@pytest.mark.parametrize(("method", "path"), LIST_ROUTES)
async def test_a_list_holds_nothing_of_another_workspace(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-04: every list for A is scanned for every id, slug and address of B."""
    a, b = tenants

    response = await api.get(
        _fill(path, a.ids()), params=QUERIES.get((method, path)), headers=a.headers
    )

    assert response.status_code == 200, response.text
    for secret in b.secrets():
        assert secret not in response.text, f"{path} shows {secret} of another workspace"
    # The list is not empty for a trivial reason: it shows A's own data.
    if path not in PLATFORM_LISTS:
        assert any(own in response.text for own in [*a.ids().values(), str(a.owner.id)])


async def test_the_same_holds_once_the_session_is_cached_and_for_a_member_of_both(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    tenants: tuple[Tenant, Tenant],
) -> None:
    """XT-05, and the case row-level security alone would not stop: someone who belongs to both
    workspaces sees, in each, only that workspace."""
    a, b = tenants
    # The session is in the Redis cache after the first request.
    assert (await api.get(_fill(_W, a.ids()), headers=a.headers)).status_code == 200
    assert _problem(await api.get(_fill(_W, b.ids()), headers=a.headers)) == (404, "not_found")

    both = await make_user(migrated, name="Both")
    await add_member(migrated, a.workspace, both, "owner")
    await add_member(migrated, b.workspace, both, "owner")
    token, _ = await open_session(resources, both, fresh=True)
    for path in (
        _W + "/members",
        _W + "/projects",
        _W + "/invitations",
        _W + "/entities",
        _W + "/vocabularies",
        _W + "/vocabularies/{vocabulary_id}/terms",
        _W + "/keywords",
    ):
        response = await api.get(_fill(path, a.ids()), headers=cookie(token))
        assert response.status_code == 200
        for secret in (
            str(b.project_id),
            str(b.member.id),
            str(b.invitation_id),
            b.invitee,
            str(b.entity_id),
            str(b.vocabulary_id),
            str(b.term_id),
            str(b.keyword_id),
        ):
            assert secret not in response.text, path
    # B's children are not reachable through A's path even for a member of both.
    for method, path in CHILD_ROUTES:
        ids = {**b.ids(), "workspace_id": str(a.workspace.id)}
        response = await _call(api, method, path, ids, cookie(token))
        assert _problem(response) == (404, "not_found"), (method, path)
    rows = await fetch(migrated, "SELECT name FROM core.projects WHERE id = $1", b.project_id)
    assert [row["name"] for row in rows] == ["crm software"]
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", both.id)
