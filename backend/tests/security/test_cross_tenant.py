"""The cross-tenant suite (docs/26-testing-quality.md section 6.1, cases XT-01 to XT-05).

Workspaces A and B are built alike. Every route with a workspace in its path is taken from the
application itself and called as A's owner with B's ids, so a new route is covered without being
added here. A route whose path has a parameter this suite has no id for fails, and so does a
route that is neither workspace-scoped nor listed in cross_tenant_exceptions.py.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import httpx
import pytest
from fastapi.routing import iter_route_contexts

from idraft.api.auth.tokens import hash_token, new_token
from idraft.api.main import create_app
from idraft.api.openapi import placeholder_settings
from idraft.api.resources import Resources
from idraft.api.stubs import is_not_built
from idraft.storage.raw import compress, digest
from idraft.vault.envelope import EnvelopeCipher
from idraft.vault.store import REFRESH_TOKEN
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
from tests.collectors.ai_support import add_prompt, seed_extraction, seed_observation
from tests.collectors.support import Project
from tests.conftest import PostgresServer
from tests.db.support import insert_prompt, seed_rank
from tests.providers.google.fake_google import FakeGoogle
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


def _not_built() -> set[tuple[str, str]]:
    """Routes whose contract is published and whose body is not built (idraft.api.stubs): they
    answer 501 once every access check has passed."""
    found: set[tuple[str, str]] = set()
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        if is_not_built(getattr(route.original_route, "endpoint", None)):
            found.update((method, route.path) for method in route.methods)
    return found


NOT_BUILT = _not_built()


def _names(path: str) -> list[str]:
    """The path's parameters, written `{name}` or `{name:converter}`."""
    return PATH_PARAMETER.findall(path)


# A path parameter that is a word, not an id of the tenant: it must not count as one of its
# secrets, since every response would then seem to hold it.
WORDS = {
    "kind": "gsc",
    "engine_code": "chatgpt_web",
    "screen": "ai_overview",
    "registrable_domain": "example.com",
}

WORKSPACE_ROUTES = [(method, path) for method, path in ALL_ROUTES if "workspace_id" in _names(path)]
# Routes that also name something inside the workspace: a project, a member, an invitation. A
# word (`WORDS`) names nothing, so a path whose only other parameter is a word is no child.
CHILD_ROUTES = [
    (method, path)
    for method, path in WORKSPACE_ROUTES
    if set(_names(path)) - {"workspace_id", *WORDS}
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
    ("POST", _W + "/projects/{project_id}/seo/check-now"): {
        "tracked_keyword_ids": ["{tracked_keyword_id}"],
    },
    ("POST", _W + "/projects/{project_id}/prompts/{prompt_id}/run-now"): {
        "engine_codes": ["chatgpt_web"],
    },
    ("POST", _W + "/projects/{project_id}/ai/runs"): {
        "prompt_ids": ["{prompt_id}"],
        "engine_codes": ["chatgpt_web"],
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
    ("POST", _W + "/projects/{project_id}/keyword-imports"): {
        "source": "paste",
        "paste": "planted",
    },
    # The file goes as a multipart part (see UPLOADS); the body here only marks the route.
    ("POST", _W + "/projects/{project_id}/keyword-imports/upload"): {},
    ("PATCH", _W + "/projects/{project_id}/keyword-imports/{import_id}"): {
        "row_actions": [{"row_no": 1, "action": "skip"}],
    },
    ("POST", _W + "/projects/{project_id}/integrations"): {
        "connection_id": "{connection_id}",
        "kind": "gsc",
        "external_property": "sc-domain:acme.example",
    },
    ("POST", _W + "/projects/{project_id}/integrations/google/authorize"): {},
    ("POST", _W + "/projects/{project_id}/keyword-imports/{import_id}/cancel"): {},
    ("POST", _W + "/projects/{project_id}/keyword-imports/{import_id}/confirm"): {
        "duplicate_action": "merge_terms",
    },
    ("PUT", _W + "/projects/{project_id}/engines/{engine_code}"): {"location_ids": [LOCATION]},
    ("POST", _W + "/projects/{project_id}/prompts"): {
        "text": "Planted prompt?",
        "language_code": "en",
        "country_iso": "US",
    },
    ("POST", _W + "/projects/{project_id}/prompts/bulk-create"): {
        "items": [{"text": "Planted prompt?", "language_code": "en", "country_iso": "US"}],
    },
    ("POST", _W + "/projects/{project_id}/prompts/bulk-archive"): {
        "ids": ["{prompt_id}"],
        "archive": True,
    },
    ("POST", _W + "/projects/{project_id}/prompts/lint"): {"texts": ["Is Acme good?"]},
    ("PATCH", _W + "/projects/{project_id}/prompts/{prompt_id}"): {"importance": 1},
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    ("POST", _W + "/projects/{project_id}/prompts/bulk-update"): {
        "ids": ["{prompt_id}"],
        "set": {"importance": 1},
    },
    ("POST", _W + "/projects/{project_id}/notes"): {
        "on": "2026-11-03",
        "text": "Planted note",
        "scope": {"kind": "project"},
    },
    ("PUT", _W + "/me/layouts/{screen}"): {
        "schema": 1,
        "cards": [{"id": "c1", "type": "ai.by_engine"}],
    },
    ("PUT", _W + "/layouts/{screen}/default"): {
        "schema": 1,
        "cards": [{"id": "c1", "type": "ai.by_engine"}],
    },
    # WP-11 layouts-api
    # WP-12 summary-lane
    # WP-13 prompts-lane
    # WP-14 sources-lane
    # WP-26 evidence-viewer
    # WP-30 runs-costs-health
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    # WP-38 notes-annotations
    # WP-41 versions
    # WP-42 panels-api
    # WP-44 links-generate
    # WP-45 candidates-api
    # WP-47 alerts-api
    # WP-49 saved-views
    # WP-50 exports
    # WP-51 reports
    # WP-54 extract-recommend
    # WP-56 rederive-candidates
    # WP-57 retrieval-fanout
    # WP-58 stats-api
    # WP-60 source-intel-api
    # WP-62 performance
    # WP-63 ssrf-webhooks
    # WP-64 aio-xch-api
    # WP-66 discovery-sources
    # WP-67 engine-expansion
    # WP-68 llm-advanced
    # WP-69 first-party-signals
    # WP-70 geo-readiness
}
# Routes that a member limited to some projects is refused even inside their own project: they
# change the workspace's credentials, which belong to no one project (docs/24 section 3.2).
EVERY_PROJECT_ONLY = {
    ("POST", _W + "/projects/{project_id}/integrations"),
    ("POST", _W + "/projects/{project_id}/integrations/google/authorize"),
    ("DELETE", _W + "/projects/{project_id}/integrations/{integration_id}"),
}
# Routes that take a file instead of JSON.
UPLOADS = {("POST", _W + "/projects/{project_id}/keyword-imports/upload")}
# Query parameters a route requires, so that it answers for its path and not for a missing
# parameter.
QUERIES: dict[tuple[str, str], dict[str, str]] = {
    ("GET", _W + "/keywords/{keyword_id}/metrics-history"): {
        "location_id": str(LOCATION),
        "language_code": "en",
    },
    ("GET", _W + "/costs"): {"from": "2026-01-01", "to": "2026-12-31", "group_by": "project"},
    # Every option, so the opt-in reads are scanned too.
    ("GET", _W + "/projects/{project_id}/ai/prompts-summary"): {"include": "entities"},
    # A tenant's answer issued one query; the default needs two answers.
    ("GET", _W + "/projects/{project_id}/ai/fanout-queries"): {"min_support": "1"},
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    # WP-11 layouts-api
    # WP-12 summary-lane
    # WP-13 prompts-lane
    # WP-14 sources-lane
    ("GET", _W + "/projects/{project_id}/ai/sources/diversity"): {"filter[country_iso]": "US"},
    ("GET", _W + "/projects/{project_id}/ai/sources/domains/{registrable_domain}"): {
        "filter[country_iso]": "US"
    },
    ("GET", _W + "/projects/{project_id}/ai/sources/prompts"): {"filter[country_iso]": "US"},
    # WP-26 evidence-viewer
    # WP-30 runs-costs-health
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    # WP-38 notes-annotations
    # WP-41 versions
    # WP-42 panels-api
    # WP-44 links-generate
    # WP-45 candidates-api
    # WP-47 alerts-api
    # WP-49 saved-views
    # WP-50 exports
    # WP-51 reports
    # WP-54 extract-recommend
    # WP-56 rederive-candidates
    # WP-57 retrieval-fanout
    # WP-58 stats-api
    # WP-60 source-intel-api
    # WP-62 performance
    # WP-63 ssrf-webhooks
    # WP-64 aio-xch-api
    # WP-66 discovery-sources
    # WP-67 engine-expansion
    # WP-68 llm-advanced
    # WP-69 first-party-signals
    # WP-70 geo-readiness
}
# Lists under a workspace's path that hold the platform's data, the same for every workspace:
# they have no tenant data of their own to show.
PLATFORM_LISTS = {_W + "/price-book"}
# Reads that answer the workspace's own numbers and no ids, so they show nothing of A to find.
COUNT_ROUTES = {_W + "/tracked-keyword-quota"}


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
    # A keyword import whose preview is ready, so changing or cancelling it would succeed.
    import_id: uuid.UUID
    # A SERP snapshot of the tracked keyword, with its raw answer registered.
    serp_snapshot_id: int
    # An AI answer of a prompt of the project, with its raw answer registered.
    observation_id: int
    # A Google account connected to the workspace, and a property of it once linked to the
    # project and switched off (so that linking it again succeeds).
    connection_id: uuid.UUID
    integration_id: uuid.UUID
    # A prompt of the project with the term, so changing or archiving it succeeds.
    prompt_id: uuid.UUID
    # What the AI visibility packages seed in `_tenant`, by path parameter name.
    more_ids: dict[str, str] = field(default_factory=dict)

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
            "import_id": str(self.import_id),
            "serp_snapshot_id": str(self.serp_snapshot_id),
            "observation_id": str(self.observation_id),
            "connection_id": str(self.connection_id),
            "integration_id": str(self.integration_id),
            "prompt_id": str(self.prompt_id),
            **self.more_ids,
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


async def _tenant(resources: Resources, pg: PostgresServer, label: str, fake: FakeGoogle) -> Tenant:
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
    # The same engine in both, on in the tracked keyword's country, so removing it succeeds.
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code) VALUES ($1, 'chatgpt_web', $2, ARRAY[$3::integer], 'dataforseo')",
        project_id,
        workspace.id,
        LOCATION,
    )
    # The same prompt in both, under the term.
    prompt_db = await asyncpg.connect(pg.url())
    try:
        prompt_id, _ = await insert_prompt(
            prompt_db,
            workspace.id,
            project_id,
            "Which CRM software suits a startup?",
            created_by=owner.id,
        )
    finally:
        await prompt_db.close()
    await execute(
        pg,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        prompt_id,
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
    # The same import in both, with one row of its preview.
    keyword_import = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_imports (workspace_id, project_id, source, original_filename, "
        "upload_object_key, status, counts, created_by, expires_at) VALUES ($1, $2, 'upload', "
        "'keywords.csv', 'imports/v1/planted/source', 'preview_ready', "
        "'{\"rows_total\": 1, \"new\": 1}', $3, now() + interval '7 days') RETURNING id",
        workspace.id,
        project_id,
        owner.id,
    )
    await execute(
        pg,
        "INSERT INTO seo.keyword_import_rows (import_id, row_no, workspace_id, raw, keyword_text, "
        "normalized_text, language_code, device, location_id, outcome, action) VALUES ($1, 1, "
        "$2, '{\"keyword\": \"crm software\"}', 'crm software', 'crm software', 'en', 'desktop', "
        "$3, 'new', 'create')",
        keyword_import["id"],
        workspace.id,
        LOCATION,
    )
    rank_db = await asyncpg.connect(pg.url())
    try:
        snapshot_id = await seed_rank(
            rank_db, workspace.id, project_id, tracked["id"], entity["id"]
        )
    finally:
        await rank_db.close()
    # The snapshot's raw answer is really in the store, so reading it would succeed.
    if resources.import_store is not None:
        answer = f'{{"tasks": [], "planted": "{label}-{uuid.uuid4().hex}"}}'.encode()
        key = f"raw/v1/serp_raw/dataforseo/planted/{label}-{uuid.uuid4().hex}.json.zst"
        await resources.import_store.put(key, compress(answer))
        await execute(
            pg,
            "UPDATE ops.raw_payloads SET object_key = $1, sha256 = $2 "
            "WHERE id = (SELECT raw_payload_id FROM seo.serp_snapshots WHERE id = $3)",
            key,
            digest(answer),
            snapshot_id,
        )
    # An AI answer, its raw answer really in the store, so reading it would succeed.
    seeded = await add_prompt(
        pg, Project(workspace.id, project_id), f"Seeded AI prompt of tenant {label}?"
    )
    ai_answer = f'{{"tasks": [], "planted": "{label}-ai-{uuid.uuid4().hex}"}}'.encode()
    ai_key = f"raw/v1/ai_raw/dataforseo/planted/{label}-{uuid.uuid4().hex}.json.zst"
    if resources.import_store is not None:
        await resources.import_store.put(ai_key, compress(ai_answer))
    observation_id = await seed_observation(
        pg,
        Project(workspace.id, project_id),
        seeded,
        object_key=ai_key,
        sha256=digest(ai_answer),
    )
    # Its extraction: a citation, a mention of the entity and the facts, read through the routes.
    await seed_extraction(pg, Project(workspace.id, project_id), observation_id, entity["id"])
    # The queries ChatGPT issued while answering, as ingest stores them.
    await execute(
        pg,
        "UPDATE ai.observations SET provider_extras = $2::jsonb, fanout_count = 1 WHERE id = $1",
        observation_id,
        json.dumps({"fan_out_queries": [f"best crm software {label}"]}),
    )
    # A real connection of the same Google account in both: its refresh token is sealed as the
    # application seals one, and the fake Google accepts it.
    account = fake.account(f"{label}@client.example", [("sc-domain:acme.example", "siteOwner")])
    cipher = EnvelopeCipher({1: resources.settings.secrets_key})
    secret_id = uuid.uuid4()
    sealed = cipher.seal(
        account.refresh_token, secret_id=secret_id, workspace_id=workspace.id, kind=REFRESH_TOKEN
    )
    await execute(
        pg,
        "INSERT INTO ops.secrets (id, workspace_id, kind, ciphertext, dek_wrapped, kek_version, "
        "fingerprint) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        secret_id,
        workspace.id,
        REFRESH_TOKEN,
        sealed.ciphertext,
        sealed.dek_wrapped,
        sealed.kek_version,
        sealed.fingerprint,
    )
    connection = await fetchrow(
        pg,
        "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
        "subject_label, credential_ref, scopes, connected_by) "
        "VALUES ($1, 'google', 'oauth', $2, $3, $4, '{openid}', $5) RETURNING id",
        workspace.id,
        account.sub,
        account.email,
        secret_id,
        owner.id,
    )
    integration = await fetchrow(
        pg,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_account, "
        "external_property, connection_id, scopes, status) VALUES ($1, $2, 'gsc', $3, "
        "'sc-domain:acme.example', $4, '{openid}', 'disabled') RETURNING id",
        workspace.id,
        project_id,
        account.email,
        connection["id"],
    )
    # Ids of what the AI visibility packages seed, by path parameter name; each package adds its
    # rows under its own line (docs/ai-visibility/MASTER-PLAN.md section 3.6).
    more_ids: dict[str, str] = {}
    # WP-03 contract-pack
    # No notes table yet: a note id that names nothing. WP-38 seeds a real note under its own
    # line and removes this one.
    more_ids["note_id"] = str(uuid.uuid4())

    # WP-11 layouts-api
    # The owner's own layout and the team default of the screen the suite fills in (`WORDS`).
    await execute(
        pg,
        "INSERT INTO core.layouts (workspace_id, owner_user_id, screen, document, "
        "schema_version, updated_by) VALUES ($1, $2, 'ai_overview', '{\"schema\": 1}', 1, $2), "
        "($1, NULL, 'ai_overview', '{\"schema\": 1}', 1, $2)",
        workspace.id,
        owner.id,
    )

    # WP-12 summary-lane

    # WP-13 prompts-lane

    # WP-14 sources-lane

    # WP-26 evidence-viewer

    # WP-30 runs-costs-health

    # WP-31 settings-engines

    # WP-32 overview-aggregates

    # WP-38 notes-annotations

    # WP-41 versions

    # WP-42 panels-api

    # WP-44 links-generate

    # WP-45 candidates-api

    # WP-47 alerts-api

    # WP-49 saved-views

    # WP-50 exports

    # WP-51 reports

    # WP-54 extract-recommend

    # WP-56 rederive-candidates

    # WP-57 retrieval-fanout

    # WP-58 stats-api

    # WP-60 source-intel-api

    # WP-62 performance

    # WP-63 ssrf-webhooks

    # WP-64 aio-xch-api

    # WP-66 discovery-sources

    # WP-67 engine-expansion

    # WP-68 llm-advanced

    # WP-69 first-party-signals

    # WP-70 geo-readiness

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
        import_id=keyword_import["id"],
        serp_snapshot_id=snapshot_id,
        observation_id=observation_id,
        connection_id=connection["id"],
        integration_id=integration["id"],
        prompt_id=prompt_id,
        more_ids=more_ids,
    )


@pytest.fixture
async def tenants(
    resources: Resources, migrated: PostgresServer, fake_google: FakeGoogle
) -> tuple[Tenant, Tenant]:
    return (
        await _tenant(resources, migrated, "a", fake_google),
        await _tenant(resources, migrated, "b", fake_google),
    )


def _nowhere(ids: dict[str, str]) -> dict[str, str]:
    """Ids that name nothing, of the kind each path parameter takes: a UUID, or for a SERP
    snapshot or an AI observation a number no sequence has reached."""
    return {
        name: "9223372036854775000"
        if name in ("serp_snapshot_id", "observation_id")
        else str(uuid.uuid4())
        for name in ids
    }


def _fill(path: str, ids: dict[str, str]) -> str:
    def value(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in WORDS:
            return WORDS[name]
        assert name in ids, f"the cross-tenant suite has no id for the path parameter {name!r}"
        return ids[name]

    filled = PATH_PARAMETER.sub(value, path)
    assert "{" not in filled, f"a path parameter of {path} was not understood"
    return filled


async def _call(
    api: httpx.AsyncClient, method: str, path: str, ids: dict[str, str], headers: dict[str, str]
) -> httpx.Response:
    if (method, path) in UPLOADS:
        return await api.request(
            method,
            _fill(path, ids),
            files={"file": ("keywords.csv", b"keyword\nplanted\n", "text/csv")},
            data={"options": "{}"},
            headers=headers,
        )
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


def _json_parts(node: object) -> list[object]:
    """Every key and scalar value of a JSON document."""
    if isinstance(node, dict):
        return [part for key, item in node.items() for part in (key, *_json_parts(item))]
    if isinstance(node, list):
        return [part for item in node for part in _json_parts(item)]
    return [node]


def _shows(body: object, text: str, secret: str) -> bool:
    """Whether a response shows `secret`. Ids, slugs and addresses are found anywhere in the text. A
    numeric id only as a whole number: a JSON number equal to it, or in a string or key a run of
    digits not part of a longer number, word or decimal (`kw-232`, `id:232` and `/k/232` count;
    `9232`, `0.232` and `22:32.232Z` do not). As a substring, `232` is inside the other tenant's own
    UUIDs, times and decimals, and the ids stay that short on a fresh test database."""
    if not secret.isdigit():
        return secret in text
    whole = re.compile(rf"(?<![0-9A-Za-z.]){secret}(?![0-9A-Za-z]|\.\d)")
    for part in _json_parts(body):
        if isinstance(part, bool):
            continue
        if isinstance(part, int) and str(part) == secret:
            return True
        if isinstance(part, str) and whole.search(part):
            return True
    return False


def _leaks(body: object, secret: str) -> bool:
    """Whether a list response shows `secret`. The counts of its `page` (`total`, `limit`,
    `offset`) are left out: they are small integers, and another tenant's small numeric id
    equals one by chance (a price book of 12 rows against an id of 12)."""
    scanned = body
    if isinstance(body, dict) and isinstance(body.get("page"), dict):
        page = {key: value for key, value in body["page"].items() if not isinstance(value, int)}
        scanned = {**body, "page": page}
    return _shows(scanned, json.dumps(scanned, ensure_ascii=False), secret)


def test_a_page_count_is_not_an_id_of_another_tenant() -> None:
    body = {"data": [{"id": "a"}], "page": {"offset": 0, "limit": 50, "total": 12}}
    assert _shows(body, str(body), "12")
    assert not _leaks(body, "12")
    assert _leaks({**body, "data": [{"keyword_id": 12}]}, "12")
    assert _leaks({"page": {"next_cursor": "tenant-b-cursor"}}, "tenant-b-cursor")


def test_a_numeric_id_counts_as_shown_only_as_a_whole_value() -> None:
    hidden_inside = {
        "id": "5f0c2322-7a1b-4c22-9232-0d1e2f3a4b5c",
        "at": "2026-11-05T10:22:32.232Z",
        "cost": "0.232000",
        "count": 2320,
    }
    assert not _shows(hidden_inside, str(hidden_inside), "232")
    for shown in (
        {"keyword_id": 232},
        {"ref": "232"},
        {"232": True},
        {"url": "/k/232/x"},
        {"url": "/k?id=232&x=1"},
        {"detail": "keyword 232 deleted"},
        {"ref": "kw-232"},
        {"ref": "id:232"},
        {"ref": "snap_232"},
        {"ref": "(232)"},
    ):
        assert _shows(shown, str(shown), "232"), shown
    assert not _shows({"ok": True}, '{"ok": true}', "1")  # a boolean is not the number 1
    assert _shows({}, "acme-crm@client.example", "acme-crm")


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
    "seo.keyword_imports": "workspace_id",
    "seo.keyword_import_rows": "workspace_id",
    "ops.schedules": "workspace_id",
    "ops.budgets": "workspace_id",
    "ops.cost_daily": "workspace_id",
    "ops.collection_runs": "workspace_id",
    "ops.audit_logs": "workspace_id",
    "ops.secrets": "workspace_id",
    "fp.connections": "workspace_id",
    "fp.integrations": "workspace_id",
    "ai.project_engines": "workspace_id",
    "ai.prompts": "workspace_id",
    "ai.prompt_versions": "workspace_id",
    "ai.prompt_terms": "workspace_id",
    "ai.derivations": "workspace_id",
    "ai.observations": "workspace_id",
    "ai.citations": "workspace_id",
    "ai.entity_mentions": "workspace_id",
    "ai.observation_facts": "workspace_id",
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    # WP-11 layouts-api
    "core.layouts": "workspace_id",
    # WP-12 summary-lane
    # WP-13 prompts-lane
    # WP-14 sources-lane
    # WP-26 evidence-viewer
    # WP-30 runs-costs-health
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    # WP-38 notes-annotations
    # WP-41 versions
    # WP-42 panels-api
    # WP-44 links-generate
    # WP-45 candidates-api
    # WP-47 alerts-api
    # WP-49 saved-views
    # WP-50 exports
    # WP-51 reports
    # WP-54 extract-recommend
    # WP-56 rederive-candidates
    # WP-57 retrieval-fanout
    # WP-58 stats-api
    # WP-60 source-intel-api
    # WP-62 performance
    # WP-63 ssrf-webhooks
    # WP-64 aio-xch-api
    # WP-66 discovery-sources
    # WP-67 engine-expansion
    # WP-68 llm-advanced
    # WP-69 first-party-signals
    # WP-70 geo-readiness
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


def test_the_published_contracts_are_the_not_built_routes() -> None:
    """A route whose contract is published and whose body is not built is a workspace route; a
    package that builds a body drops its route from this set by removing the mark."""
    assert NOT_BUILT.issubset(WORKSPACE_ROUTES)


def test_a_word_in_a_path_is_never_a_child_and_always_resolves() -> None:
    """A path whose only parameters besides the workspace are words names nothing inside the
    workspace, so it is no child route. A parameter is an id (`*_id`, which `_fill` takes from
    the tenant) or a word (`WORDS`, which `_fill` writes itself): a word left out of `WORDS`
    would be asked for as an id, and one in it needs no id."""
    children = set(CHILD_ROUTES)
    for method, path in ALL_ROUTES:
        for name in _names(path):
            assert name.endswith("_id") or name in WORDS, f"{name} of {path} is neither"
        if "workspace_id" in _names(path) and set(_names(path)) - {"workspace_id"} <= set(WORDS):
            assert (method, path) not in children, (method, path)
    for name, word in WORDS.items():
        assert _fill(f"/{{{name}}}", {}) == f"/{word}", name


@pytest.mark.parametrize(("method", "path"), WORKSPACE_ROUTES)
async def test_another_workspaces_path_is_not_found(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-01, XT-02 and XT-03: B's ids in the path, as A's owner. Always 404, never 403, and
    the same answer as for a workspace that does not exist."""
    a, b = tenants
    missing = _nowhere(b.ids())

    foreign = await _call(api, method, path, b.ids(), a.headers)
    nowhere = await _call(api, method, path, missing, a.headers)

    assert _problem(foreign) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(foreign) == _without_request_details(nowhere)


def _answer_for_a_foreign_child(method: str, path: str) -> tuple[int, str]:
    """What a route answers for a child id (a project, a member) that is not in the workspace.

    A stub reads nothing and holds no project row, so a project outside this workspace gets the
    same 501 as the caller's own project; the callers below still require the foreign id and an
    id that names nothing to answer identically. The strict 404 applies the moment a package
    drops `@not_built` (idraft.api.stubs), which also fails the stub branch: the route then
    answers 404 or 200 instead of 501. WP-11 and later packages move a route out of NOT_BUILT
    by dropping the mark, nowhere else."""
    return (501, "not_implemented") if (method, path) in NOT_BUILT else (404, "not_found")


@pytest.mark.parametrize(("method", "path"), CHILD_ROUTES)
async def test_another_workspaces_child_in_the_callers_own_path_is_not_found(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-01 and XT-02 for child ids: A's workspace in the path, B's project, member or
    invitation after it."""
    a, b = tenants
    ids = {**b.ids(), "workspace_id": str(a.workspace.id)}
    missing = {**_nowhere(b.ids()), "workspace_id": str(a.workspace.id)}

    foreign = await _call(api, method, path, ids, a.headers)
    nowhere = await _call(api, method, path, missing, a.headers)

    assert _problem(foreign) == _problem(nowhere) == _answer_for_a_foreign_child(method, path)
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
    await add_member(migrated, a.workspace, limited, "admin", [a.project_id])
    token, _ = await open_session(resources, limited, fresh=True)

    outside = await _call(api, method, path, {**a.ids(), "project_id": str(hidden)}, cookie(token))
    nowhere = await _call(
        api, method, path, {**a.ids(), "project_id": str(uuid.uuid4())}, cookie(token)
    )
    inside = await _call(api, method, path, a.ids(), cookie(token))

    assert _problem(outside) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(outside) == _without_request_details(nowhere)
    if (method, path) in EVERY_PROJECT_ONLY:
        assert _problem(inside) == (403, "forbidden")
    elif (method, path) in NOT_BUILT:
        # Inside the member's scope a published contract answers that its body is not built.
        assert _problem(inside) == (501, "not_implemented")
    else:
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

    if (method, path) in NOT_BUILT:
        # A stub answers 501 and still must not carry anything of another workspace.
        assert _problem(response) == (501, "not_implemented")
    else:
        assert response.status_code == 200, response.text
    body = response.json()
    for secret in b.secrets():
        assert not _leaks(body, secret), f"{path} shows {secret} of another workspace"
    # The list is not empty for a trivial reason: it shows A's own data (a stub shows none).
    if (method, path) not in NOT_BUILT and path not in PLATFORM_LISTS | COUNT_ROUTES:
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
        missing = {**_nowhere(b.ids()), "workspace_id": str(a.workspace.id)}
        response = await _call(api, method, path, ids, cookie(token))
        nowhere = await _call(api, method, path, missing, cookie(token))
        assert _problem(response) == _answer_for_a_foreign_child(method, path), (method, path)
        assert _without_request_details(response) == _without_request_details(nowhere), (
            method,
            path,
        )
    rows = await fetch(migrated, "SELECT name FROM core.projects WHERE id = $1", b.project_id)
    assert [row["name"] for row in rows] == ["crm software"]
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", both.id)
