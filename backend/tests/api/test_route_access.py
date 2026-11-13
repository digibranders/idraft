"""Every route says who may call it (docs/24-security.md section 3.2).

The table is the contract. A new route must be added here with its access, and a route whose
access changes must change here too, so both show up in review.
"""

import importlib
import re
from pathlib import Path
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.routing import APIRoute, iter_route_contexts

from idraft.api.access import AccessRule, declare, public, route_access
from idraft.api.main import create_app
from idraft.api.openapi import placeholder_settings
from idraft.api.pagination import _query_names
from idraft.api.permissions import Permission
from idraft.api.workspaces.routes import router as workspaces_router

EXPECTED: dict[tuple[str, str], str] = {
    ("GET", "/api/healthz"): "public",
    ("GET", "/api/readyz"): "public",
    # Behind its own bearer token, not a session.
    ("GET", "/api/internal/health"): "public",
    ("GET", "/api/v1/openapi.json"): "authenticated",
    ("POST", "/api/v1/auth/register"): "public",
    ("POST", "/api/v1/auth/verify-email/request"): "public",
    ("POST", "/api/v1/auth/verify-email"): "public",
    ("POST", "/api/v1/auth/sign-in"): "public",
    ("POST", "/api/v1/auth/sign-out"): "public",
    ("POST", "/api/v1/auth/password-reset/request"): "public",
    ("POST", "/api/v1/auth/password-reset/confirm"): "public",
    ("POST", "/api/v1/auth/password/change"): "authenticated fresh",
    ("POST", "/api/v1/auth/totp/setup"): "authenticated fresh",
    ("POST", "/api/v1/auth/totp/setup/confirm"): "authenticated",
    ("POST", "/api/v1/auth/totp/verify"): "authenticated",
    ("POST", "/api/v1/auth/totp/recovery-codes"): "authenticated fresh",
    ("POST", "/api/v1/auth/totp/disable"): "authenticated fresh",
    ("GET", "/api/v1/auth/sessions"): "authenticated",
    ("POST", "/api/v1/auth/sessions/revoke-others"): "authenticated",
    ("DELETE", "/api/v1/auth/sessions/{session_id}"): "authenticated",
    ("GET", "/api/v1/me"): "authenticated",
    ("PATCH", "/api/v1/me"): "authenticated",
    ("POST", "/api/v1/me/reauthenticate"): "authenticated",
    ("GET", "/api/v1/workspaces"): "authenticated",
    ("POST", "/api/v1/workspaces"): "authenticated",
    ("GET", "/api/v1/workspaces/{workspace_id}"): "member",
    ("PATCH", "/api/v1/workspaces/{workspace_id}"): "workspace:update",
    ("GET", "/api/v1/workspaces/{workspace_id}/tracked-keyword-quota"): "member",
    ("GET", "/api/v1/workspaces/{workspace_id}/members"): "member",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/members/{user_id}"): "members:manage fresh",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/members/{user_id}"): "members:manage fresh",
    ("GET", "/api/v1/workspaces/{workspace_id}/invitations"): "members:manage",
    ("POST", "/api/v1/workspaces/{workspace_id}/invitations"): "members:manage",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/invitations/{invitation_id}",
    ): "members:manage",
    ("POST", "/api/v1/invitations/accept"): "authenticated",
    ("GET", "/api/v1/locations"): "authenticated",
    ("GET", "/api/v1/domain-categories"): "authenticated",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects"): "member",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects"): "projects:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}"): "member",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/projects/{project_id}"): "projects:write",
    # A role belongs to one project, so a member limited to it may change it.
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities"): "entities:write",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities/{entity_id}",
    ): "entities:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities/{entity_id}",
    ): "entities:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/domains"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/alias-test"): "data:read",
    # Entities are shared by the workspace's projects, so changing one needs every project.
    ("GET", "/api/v1/workspaces/{workspace_id}/entities"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/entities"): "entities:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/entities/{entity_id}"): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}",
    ): "entities:write every-project",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}",
    ): "entities:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases",
    ): "entities:write every-project",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases/{alias_id}",
    ): "entities:write every-project",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases/{alias_id}",
    ): "entities:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains",
    ): "entities:write every-project",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains/{entity_domain_id}",
    ): "entities:write every-project",
    # A vocabulary may belong to one project, so a member limited to it may change it; the
    # service refuses that member the workspace-wide ones.
    ("GET", "/api/v1/workspaces/{workspace_id}/vocabularies"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/vocabularies"): "taxonomy:write",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}"): "taxonomy:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}",
    ): "taxonomy:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms",
    ): "taxonomy:write",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/terms/{term_id}"): "taxonomy:write",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/terms/{term_id}"): "taxonomy:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups",
    ): "keywords:write",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}",
    ): "keywords:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}/members",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}/"
        "members/remove",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/term-assignments",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-metrics/refresh",
    ): "runs:trigger",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/check-now"): (
        "runs:trigger"
    ),
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}/run-now",
    ): "runs:trigger",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/runs"): "runs:trigger",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs"): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}"): "data:read",
    # Who may cancel is decided by the service: schedules:write, or runs:trigger for a manual
    # run the caller asked for.
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}/cancel",
    ): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules",
    ): "schedules:write",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules/{schedule_id}",
    ): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules/{schedule_id}",
    ): "schedules:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules/{schedule_id}",
    ): "schedules:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules/{schedule_id}/pause",
    ): "schedules:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules/{schedule_id}/resume",
    ): "schedules:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports",
    ): "imports:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/upload",
    ): "imports:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports"): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/rows",
    ): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}",
    ): "imports:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/cancel",
    ): "imports:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/confirm",
    ): "imports:write",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/report",
    ): "data:read",
    # Workspace routes; the service limits a member scoped to some projects to theirs.
    ("GET", "/api/v1/workspaces/{workspace_id}/costs"): "costs:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/budgets/status"): "costs:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/price-book"): "costs:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings",
    ): "projects:write",
    # Keywords are read across the workspace, limited to the caller's projects by the service;
    # tracked keywords live inside one project.
    ("GET", "/api/v1/workspaces/{workspace_id}/keywords"): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/keywords/{keyword_id}"): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/keywords/{keyword_id}/metrics-history",
    ): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords",
    ): "keywords:write",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/countries",
    ): "data:read",
    # Google (Search Console and GA4). Connections are the workspace's credentials, so a manager
    # limited to some projects neither manages them nor links one to a project.
    ("GET", "/api/v1/workspaces/{workspace_id}/connections"): ("integrations:manage every-project"),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/connections/{connection_id}/properties/gsc",
    ): "integrations:manage every-project",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/connections/{connection_id}/properties/ga4",
    ): "integrations:manage every-project",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/connections/{connection_id}"): (
        "integrations:manage every-project fresh"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations",
    ): "integrations:manage every-project",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations/google/authorize",
    ): "integrations:manage every-project fresh",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations/{integration_id}",
    ): "integrations:manage every-project fresh",
    # Google sends the browser here: the single-use state, not a session rule, decides.
    ("GET", "/api/v1/oauth/google/callback"): "public",
    **{
        (
            "GET",
            "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/"
            f"{{tracked_keyword_id}}/{leaf}",
        ): "data:read"
        for leaf in (
            "rank-history",
            "serp-snapshots",
            "serp-current",
            "serp-features",
            "aio-history",
        )
    },
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/serp-snapshots/{serp_snapshot_id}",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/serp-snapshots/"
        "{serp_snapshot_id}/raw",
    ): "raw:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/{observation_id}",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/"
        "{observation_id}/raw",
    ): "raw:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/domains"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/pages"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/citations"): ("data:read"),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/fanout-queries"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/rank-events",
    ): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-create",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-update",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-archive",
    ): "keywords:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-delete",
    ): "keywords:write",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/"
        "{tracked_keyword_id}",
    ): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/"
        "{tracked_keyword_id}",
    ): "keywords:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/"
        "{tracked_keyword_id}",
    ): "keywords:write",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/"
        "{tracked_keyword_id}/config-history",
    ): "data:read",
    (
        "PUT",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/"
        "{tracked_keyword_id}/competitors",
    ): "keywords:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines"): "data:read",
    (
        "PUT",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines/{engine_code}",
    ): "projects:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines/{engine_code}",
    ): "projects:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts"): "prompts:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/bulk-create",
    ): "prompts:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/bulk-archive",
    ): "prompts:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/lint",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}",
    ): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}",
    ): "prompts:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}",
    ): "prompts:write",
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/bulk-update"): (
        "prompts:write"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/limits"): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}/ai-coverage"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/collection/daily"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/changes"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/annotations"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes"): "notes:write",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes/{note_id}"): (
        "notes:write"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/layouts/{screen}"): "member",
    ("PUT", "/api/v1/workspaces/{workspace_id}/me/layouts/{screen}"): "member",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/me/layouts/{screen}"): "member",
    ("PUT", "/api/v1/workspaces/{workspace_id}/layouts/{screen}/default"): "layouts:manage",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/layouts/{screen}/default"): "layouts:manage",
    # WP-11 layouts-api
    # WP-12 summary-lane
    # WP-13 prompts-lane
    # WP-14 sources-lane
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/diversity"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/domains/"
        "{registrable_domain}",
    ): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/prompts"): (
        "data:read"
    ),
    # WP-26 evidence-viewer
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/"
        "{observation_id}/compare",
    ): "data:read",
    # WP-30 runs-costs-health
    ("GET", "/api/v1/workspaces/{workspace_id}/budgets"): "costs:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/budgets"): "budgets:manage",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/budgets/{budget_id}"): "budgets:manage",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/budgets/{budget_id}"): "budgets:manage",
    ("GET", "/api/v1/workspaces/{workspace_id}/costs/forecast"): "costs:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/costs/unit-costs"): "costs:read",
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/metrics/overview"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/overview/ai"): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/metrics/{metric}"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/metrics/{metric}/series",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/metrics/{metric}/breakdown",
    ): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/competitors"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/overview/competitors"): (
        "data:read"
    ),
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


def _declared(app: FastAPI) -> dict[tuple[str, str], str | None]:
    found: dict[tuple[str, str], str | None] = {}
    for route in iter_route_contexts(app.routes):
        assert isinstance(route.original_route, APIRoute), f"{route} is not an API route"
        assert route.path is not None
        assert route.methods
        for method in sorted(route.methods):
            found[(method, route.path)] = route_access(route)
    return found


def test_every_route_declares_who_may_call_it() -> None:
    declared = _declared(create_app(placeholder_settings()))
    assert [route for route, label in declared.items() if label is None] == []


def test_the_declared_access_is_the_documented_access() -> None:
    app = create_app(placeholder_settings())
    assert _declared(app) == EXPECTED
    # An override would replace a check without changing what the route declares.
    assert app.dependency_overrides == {}


# The path parameters routes may use. The membership dependency checks the project scope for the
# one named `project_id`, so a project must never travel under another name: a new name is added
# here only after confirming it is not a project, or a thing inside one project, in disguise. A
# route for something inside a project carries `{project_id}` before it.
PATH_PARAMETERS = {
    "workspace_id",
    "project_id",
    "user_id",
    "invitation_id",
    "session_id",
    # Workspace-level: an entity is shared by projects, never inside one.
    "entity_id",
    "alias_id",
    "entity_domain_id",
    # A vocabulary may belong to a project, but its routes check that project's scope in the
    # service: a vocabulary id is not a project id, and a workspace-wide one has none.
    "vocabulary_id",
    "term_id",
    # A keyword is shared by the workspace's projects; the service shows a member limited to
    # some projects only the keywords those projects track.
    "keyword_id",
    # Inside one project: its routes carry `{project_id}` first, and the service reads the
    # tracked keyword within that project.
    "tracked_keyword_id",
    # Inside one project, after `{project_id}`, like a tracked keyword.
    "group_id",
    "schedule_id",
    "run_id",
    "import_id",
    # Inside one project, after `{project_id}`: the service finds the snapshot within that
    # project, so a snapshot of another project is a 404.
    "serp_snapshot_id",
    # Inside one project, after `{project_id}`: the service finds the observation within that
    # project, so an observation of another project is a 404.
    "observation_id",
    # A connection is a credential of the workspace, shared by its projects.
    "connection_id",
    # Inside one project, after `{project_id}`: the service finds it within that project.
    "integration_id",
    # The product of an integration (`gsc`), not an id.
    "kind",
    # An AI engine (`chatgpt_web`), a word and not an id, after `{project_id}`.
    "engine_code",
    # Inside one project, after `{project_id}`: the service reads the prompt within it.
    "prompt_id",
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    # A screen key of the layout spec (`ai_overview`), a word and not an id, after the workspace.
    "screen",
    # Inside one project, after `{project_id}`: the service reads the note within it.
    "note_id",
    # WP-11 layouts-api
    # WP-12 summary-lane
    # WP-13 prompts-lane
    # WP-14 sources-lane
    # A registrable domain (`g2.com`), a word and not an id, after `{project_id}`: the service
    # reads its citations within that project.
    "registrable_domain",
    # WP-26 evidence-viewer
    # WP-30 runs-costs-health
    # A budget of the workspace; the service finds it within the workspace, and within the
    # caller's projects for a member limited to some.
    "budget_id",
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    # A registry key (`ai.mention_rate`), a word and not an id, after `{project_id}`.
    "metric",
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
# `{name}` or `{name:converter}`.
PATH_PARAMETER = re.compile(r"\{(\w+)(?::\w+)?\}")


def test_a_path_parameter_is_recognised_with_or_without_a_converter() -> None:
    path = "/api/v1/workspaces/{workspace_id}/projects/{pid:uuid}/files/{name:path}"
    assert PATH_PARAMETER.findall(path) == ["workspace_id", "pid", "name"]
    assert re.findall(r"/projects/\{(\w+)", path) == ["pid"]


def test_path_parameters_come_from_a_known_set_and_a_project_is_called_project_id() -> None:
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        names = PATH_PARAMETER.findall(route.path)
        # Every brace was understood: a `{name:converter}` must not slip past as no parameter.
        assert len(names) == route.path.count("{"), route.path
        assert set(names) <= PATH_PARAMETERS, route.path
        after_projects = re.findall(r"/projects/\{(\w+)", route.path)
        assert after_projects in ([], ["project_id"]), route.path
        if "project_id" in names:
            assert names[:2] == ["workspace_id", "project_id"], route.path


def test_no_router_adds_a_query_parameter_to_the_routes_it_includes() -> None:
    """`reject_unknown_query` reads the parameters of the route itself. A dependency given to
    `include_router` would declare one it cannot see."""
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert isinstance(route.original_route, APIRoute)
        assert set(_query_names(route.dependant)) == set(
            _query_names(route.original_route.dependant)
        ), route.path


# The routers of docs/ai-visibility/MASTER-PLAN.md section 3.3, in that table's order. Each work
# package fills its own; api/main.py includes them all already.
SCAFFOLDED = (
    "idraft.api.layouts.routes",
    "idraft.api.ai.limits_routes",
    "idraft.api.operations.collection_routes",
    "idraft.api.ai.metrics_routes",
    "idraft.api.ai.competitor_routes",
    "idraft.api.ai.annotation_routes",
    "idraft.api.notes.routes",
    "idraft.api.ai.version_routes",
    "idraft.api.ai.panel_routes",
    "idraft.api.ai.link_routes",
    "idraft.api.ai.candidate_routes",
    "idraft.api.uploads.routes",
    "idraft.api.alerts.routes",
    "idraft.api.views.routes",
    "idraft.api.exports.routes",
    "idraft.api.reports.routes",
    "idraft.api.ai.derivation_routes",
    "idraft.api.entities.candidate_routes",
    "idraft.api.ai.retrieval_routes",
    "idraft.api.ai.stats_routes",
    "idraft.api.ai.source_intel_routes",
    "idraft.api.webhooks.routes",
)


def test_the_scaffolded_routers_are_included_once_in_order_before_the_older_ones() -> None:
    included = [
        getattr(route, "original_router", None)
        for route in create_app(placeholder_settings()).routes
    ]
    positions: list[int] = []
    for name in SCAFFOLDED:
        router = importlib.import_module(name).router
        found = [index for index, candidate in enumerate(included) if candidate is router]
        assert len(found) == 1, name
        positions.append(found[0])
    assert positions == sorted(positions)
    older = [index for index, candidate in enumerate(included) if candidate is workspaces_router]
    assert positions[-1] < older[0]


# `{name}` or `{name:converter}` once the path is escaped for a regular expression.
_ESCAPED_PARAMETER = re.compile(r"\\\{\w+(?::\w+)?\\\}")


def _matcher(path: str) -> re.Pattern[str]:
    """What the router matches for a route's path: any one segment where it has a parameter."""
    return re.compile(_ESCAPED_PARAMETER.sub("[^/]+", re.escape(path)))


def test_a_parameter_matches_any_one_segment() -> None:
    matcher = _matcher("/projects/{project_id}/prompts/{prompt_id:uuid}")
    assert matcher.fullmatch("/projects/{project_id}/prompts/limits")
    assert matcher.fullmatch("/projects/p-1/prompts/{other_id}")
    assert not matcher.fullmatch("/projects/{project_id}/prompts")
    assert not matcher.fullmatch("/projects/{project_id}/prompts/a/b")


def test_no_route_is_hidden_by_an_earlier_one() -> None:
    """A request goes to the first route whose path matches, and a parameter matches any word:
    `GET .../prompts/limits` after `GET .../prompts/{prompt_id}` would answer 422. The routers
    of the AI visibility packages are included before the older ones, so a new word is safe and
    a new parameter where an older route has a word is not."""
    earlier: list[tuple[str, str, re.Pattern[str]]] = []
    hidden: list[tuple[str, str, str]] = []
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        for method in sorted(route.methods):
            hidden += [
                (method, path, route.path)
                for seen, path, matcher in earlier
                if seen == method and matcher.fullmatch(route.path)
            ]
        earlier += [(method, route.path, _matcher(route.path)) for method in sorted(route.methods)]
    assert hidden == []


# The AI visibility packages that add routes or tenant tables, in number order
# (docs/ai-visibility/MASTER-PLAN.md section 3.6). Each has one anchor line in each table of this
# file and of tests/security/test_cross_tenant.py, and adds its entries under that line only.
PACKAGES = (
    "WP-03 contract-pack",
    "WP-11 layouts-api",
    "WP-12 summary-lane",
    "WP-13 prompts-lane",
    "WP-14 sources-lane",
    "WP-26 evidence-viewer",
    "WP-30 runs-costs-health",
    "WP-31 settings-engines",
    "WP-32 overview-aggregates",
    "WP-38 notes-annotations",
    "WP-41 versions",
    "WP-42 panels-api",
    "WP-44 links-generate",
    "WP-45 candidates-api",
    "WP-47 alerts-api",
    "WP-49 saved-views",
    "WP-50 exports",
    "WP-51 reports",
    "WP-54 extract-recommend",
    "WP-56 rederive-candidates",
    "WP-57 retrieval-fanout",
    "WP-58 stats-api",
    "WP-60 source-intel-api",
    "WP-62 performance",
    "WP-63 ssrf-webhooks",
    "WP-64 aio-xch-api",
    "WP-66 discovery-sources",
    "WP-67 engine-expansion",
    "WP-68 llm-advanced",
    "WP-69 first-party-signals",
    "WP-70 geo-readiness",
)
ANCHOR = re.compile(r"^ *# (WP-\d{2} [a-z0-9-]+)$", re.MULTILINE)
SECURITY_SUITE = Path(__file__).parents[1] / "security" / "test_cross_tenant.py"


@pytest.mark.parametrize(("path", "tables"), [(Path(__file__), 2), (SECURITY_SUITE, 4)])
def test_each_table_has_one_anchor_line_per_package_in_order(path: Path, tables: int) -> None:
    assert ANCHOR.findall(path.read_text()) == list(PACKAGES) * tables


def test_every_requirement_of_a_route_is_reported() -> None:
    @declare(AccessRule("authenticated"))
    def signed_in() -> None: ...

    @declare(AccessRule("authenticated", fresh=True))
    def recently(_: Annotated[None, Depends(signed_in)]) -> None: ...

    @declare(AccessRule("member"))
    def member(_: Annotated[None, Depends(signed_in)]) -> None: ...

    @declare(AccessRule("permission", Permission.MEMBERS_MANAGE, fresh=True))
    def manager(_: Annotated[None, Depends(member)]) -> None: ...

    @declare(AccessRule("permission", Permission.AUDIT_READ))
    def auditor(_: Annotated[None, Depends(member)]) -> None: ...

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.get("/open", dependencies=[Depends(public)])
    def open_route() -> None: ...

    @app.get("/managed", dependencies=[Depends(public)])
    def managed(_: Annotated[None, Depends(manager)]) -> None: ...

    @app.get("/member-fresh", dependencies=[Depends(recently)])
    def member_fresh(_: Annotated[None, Depends(member)]) -> None: ...

    @app.get("/audited-fresh", dependencies=[Depends(recently)])
    def audited_fresh(_: Annotated[None, Depends(auditor)]) -> None: ...

    @app.get("/both", dependencies=[Depends(manager), Depends(auditor)])
    def both() -> None: ...

    @app.get("/undeclared")
    def undeclared() -> None: ...

    # Not an API route, so it has no dependencies to declare anything with.
    app.add_route("/plain", lambda request: PlainTextResponse("ok"))

    labels = {route.path: route_access(route) for route in iter_route_contexts(app.routes)}
    assert labels == {
        "/open": "public",
        "/managed": "members:manage fresh",
        "/member-fresh": "member fresh",
        "/audited-fresh": "audit:read fresh",
        "/both": "audit:read + members:manage fresh",
        "/undeclared": None,
        "/plain": None,
    }


def test_a_rule_names_a_permission_exactly_when_it_is_a_permission_rule() -> None:
    with pytest.raises(ValueError, match="permission"):
        AccessRule("permission")
    with pytest.raises(ValueError, match="permission"):
        AccessRule("member", Permission.DATA_READ)
