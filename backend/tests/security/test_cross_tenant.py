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
from datetime import date, timedelta
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
from idraft.collectors.crawl_store import recompute_tier_flow
from idraft.db.engine import workspace_transaction
from idraft.domain.gsc_pull import PullState
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
from tests.api.internal_links.support import (
    SeedLink,
    seed_crawl,
    seed_tiers,
    set_counts,
    set_website,
    url_id,
)
from tests.api.internal_links.support_changes import insert_citation, track_keyword
from tests.api.keywords.support import LOCATION, ensure_locations
from tests.api.test_route_access import PATH_PARAMETER
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt, seed_extraction, seed_observation
from tests.collectors.support import Project
from tests.conftest import PostgresServer
from tests.db.support import insert_prompt, seed_alerts, seed_rank
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
    "registrable_domain": "acme.example",
    "metric": "ai.mention_rate",
    # The public client summary route has no workspace in its path; its token is no tenant id
    "token": "a-link-token",
}

# Answers an image, not data of the tenant: the site's icon is the same for every workspace, and
# the access to it is tested in tests/api/favicons/test_service.py.
IMAGE_ROUTES = {"/api/v1/workspaces/{workspace_id}/favicons/{registrable_domain}"}

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
    if method == "GET" and (method, path) not in CHILD_ROUTES and path not in IMAGE_ROUTES
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
    # Takes no body: the observation in the path is what it would spend money on.
    ("POST", _W + "/projects/{project_id}/ai/observations/{observation_id}/screenshot"): {},
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
    ("PATCH", _W + "/projects/{project_id}/settings"): {
        "seo": {"default_device": "mobile"},
        "internal_links": {"schedule": "off", "allowed_subdomains": ["blog.example.com"]},
    },
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
    ("POST", _W + "/budgets"): {
        "project_id": "{project_id}",
        "workload": "seo_rank",
        "limit_usd": "10.00",
    },
    ("PATCH", _W + "/budgets/{budget_id}"): {"limit_usd": "9999.00"},
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    # WP-38 notes-annotations
    # Notes on a page (spec 9.7, 9.8): the page and its files.
    ("POST", _W + "/projects/{project_id}/internal-links/pages/{url_id}/notes"): {
        "body": "Planted note"
    },
    ("PATCH", _W + "/projects/{project_id}/internal-links/pages/{url_id}/notes/{note_id}"): {
        "body": "Taken over"
    },
    (
        "POST",
        _W + "/projects/{project_id}/internal-links/pages/{url_id}/notes/{note_id}/restore",
    ): {},
    ("POST", _W + "/projects/{project_id}/internal-links/pages/{url_id}/note-attachments"): {},
    # WP-41 versions
    # WP-42 panels-api
    # WP-44 links-generate
    ("POST", _W + "/projects/{project_id}/keyword-prompt-links"): {
        "keyword_id": "{unlinked_keyword_id}",
        "prompt_id": "{prompt_id}",
    },
    # WP-45 candidates-api
    # WP-47 alerts-api
    ("POST", _W + "/projects/{project_id}/alert-rules"): {
        "name": "Planted rule",
        "rule_type": "rank_drop",
        "params": {"positions": 5},
    },
    ("PATCH", _W + "/projects/{project_id}/alert-rules/{alert_rule_id}"): {"name": "Taken over"},
    ("POST", _W + "/projects/{project_id}/alert-events/acknowledge"): {"ids": ["{alert_event_id}"]},
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
    # WP-76 citations-v2-api
    # Internal links tracker (plan 02): tiers, rules, tiers and tags on pages. The tier is the
    # spare one nothing uses, so deleting it succeeds.
    ("POST", _W + "/page-tiers"): {"name": "Planted tier"},
    ("PATCH", _W + "/page-tiers/{tier_id}"): {"name": "Taken over"},
    ("PUT", _W + "/projects/{project_id}/pages/tiers"): {
        "url_ids": ["{url_id}"],
        "tier_id": "{tier_id}",
    },
    ("POST", _W + "/projects/{project_id}/pages/tiers/reset"): {"url_ids": ["{url_id}"]},
    ("POST", _W + "/projects/{project_id}/pages/tiers/import"): {
        "csv": "url,tier\n{page_url},T1\n",
    },
    ("PUT", _W + "/projects/{project_id}/pages/tags"): {
        "url_ids": ["{url_id}"],
        "add": ["{tag_term_id}"],
        "remove": [],
    },
    ("POST", _W + "/projects/{project_id}/tier-rules"): {
        "match_type": "prefix",
        "value": "/planted",
        "tier_id": "{tier_id}",
    },
    ("PATCH", _W + "/projects/{project_id}/tier-rules/{rule_id}"): {"value": "/taken-over"},
    ("POST", _W + "/projects/{project_id}/tier-rules/preview"): {
        "match_type": "prefix",
        "value": "/planted",
    },
    # The crawl is the tenant's queued one (`run_id` of a link-crawls path, see `_fill`): the
    # cancel would end it, and the project already has a crawl under way, so Crawl now is
    # refused for it (`CRAWL_UNDER_WAY`).
    ("POST", _W + "/projects/{project_id}/link-crawls"): {},
    ("POST", _W + "/projects/{project_id}/link-crawls/{run_id}/cancel"): {},
    # Internal links tracker (plan 04): a pair that is no mention of the tenant's crawl, which
    # changes nothing; `test_decisions_...` below uses the pair that is one.
    ("PUT", _W + "/projects/{project_id}/internal-links/opportunities/decisions"): {
        "items": [{"source_url_id": "{url_id}", "target_url_id": "{url_id}"}],
        "status": "dismissed",
    },
    # A client summary link, which would be made and show a report to anyone holding it
    ("POST", _W + "/projects/{project_id}/internal-links/shares"): {"expires_in_days": 7},
    ("POST", _W + "/projects/{project_id}/reports/shares"): {"expires_in_days": 7},
    ("POST", _W + "/projects/{project_id}/reports/schedules"): {
        "frequency": "weekly",
        "recipients": ["client@example.com"],
    },
    ("PATCH", _W + "/projects/{project_id}/reports/schedules/{report_schedule_id}"): {
        "paused": True
    },
    # A page that is no suggestion of the tenant's crawl changes nothing; the test below uses
    # a page that is one.
    ("POST", _W + "/projects/{project_id}/internal-links/tier-suggestions/accept"): {
        "url_ids": ["{url_id}"],
    },
    ("POST", _W + "/projects/{project_id}/internal-links/tier-suggestions/dismiss"): {
        "url_ids": ["{url_id}"],
    },
}
# Routes that a member limited to some projects is refused even inside their own project: they
# change the workspace's credentials, which belong to no one project (docs/24 section 3.2).
EVERY_PROJECT_ONLY = {
    ("POST", _W + "/projects/{project_id}/integrations"),
    ("POST", _W + "/projects/{project_id}/integrations/google/authorize"),
    ("DELETE", _W + "/projects/{project_id}/integrations/{integration_id}"),
}
# Routes a tenant's own project answers `409 crawl_in_progress` for, as the tenant has a queued
# crawl (it is what the cancel route is exercised on).
CRAWL_UNDER_WAY = {("POST", _W + "/projects/{project_id}/link-crawls")}
# What a member inside their own scope is answered for an observation of their own: the test
# installation has no DataForSEO account, so no screenshot is taken, and none is stored.
SCREENSHOT_ROUTES = {
    ("POST", _W + "/projects/{project_id}/ai/observations/{observation_id}/screenshot"): (
        503,
        "screenshots_unavailable",
    ),
    ("GET", _W + "/projects/{project_id}/ai/observations/{observation_id}/screenshot"): (
        404,
        "no_screenshot",
    ),
}
# What a member inside their own scope is answered for the seeded page note, which another user
# wrote and nobody deleted: only its author changes it, and only a deleted note is restored.
NOTE_ROUTES = {
    ("PATCH", _W + "/projects/{project_id}/internal-links/pages/{url_id}/notes/{note_id}"): (
        403,
        "forbidden",
    ),
    ("POST", _W + "/projects/{project_id}/internal-links/pages/{url_id}/notes/{note_id}/restore"): (
        404,
        "not_found",
    ),
}
# Routes that take a file instead of JSON.
UPLOADS = {
    ("POST", _W + "/projects/{project_id}/keyword-imports/upload"),
    ("POST", _W + "/projects/{project_id}/internal-links/pages/{url_id}/note-attachments"),
}
# Query parameters a route requires, so that it answers for its path and not for a missing
# parameter.
QUERIES: dict[tuple[str, str], dict[str, str]] = {
    ("GET", _W + "/keywords/{keyword_id}/metrics-history"): {
        "location_id": str(LOCATION),
        "language_code": "en",
    },
    ("GET", _W + "/costs"): {"from": "2026-01-01", "to": "2026-12-31", "group_by": "project"},
    # Every option, so the opt-in reads are scanned too.
    ("GET", _W + "/projects/{project_id}/ai/prompts-summary"): {
        "include": "series,entities,total,co_mentions,cells,facts,fact_counts,ai_overview",
        "compare": "previous_period",
        "group_by": "country",
    },
    # A tenant's answer issued one query; the default needs two answers.
    ("GET", _W + "/projects/{project_id}/ai/fanout-queries"): {
        "min_support": "1",
        "filter[country_iso]": "US",
        "include": "topics",
    },
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    # WP-11 layouts-api
    # WP-12 summary-lane
    # WP-13 prompts-lane
    ("GET", _W + "/vocabularies/{vocabulary_id}/terms"): {"include": "prompt_count"},
    # WP-14 sources-lane
    ("GET", _W + "/projects/{project_id}/ai/sources/domains"): {
        "include": "series,cited_with,by_role_by_engine",
        "compare": "previous_period",
        "min_support": "1",
        "filter[country_iso]": "US",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    ("GET", _W + "/projects/{project_id}/ai/sources/pages"): {
        "include": "series",
        "compare": "previous_period",
        "min_support": "1",
        "filter[country_iso]": "US",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    # The tenant's answer cites its own page once and is new in the default window.
    ("GET", _W + "/projects/{project_id}/ai/sources/changes"): {
        "kind": "new",
        "min_support": "1",
        "filter[country_iso]": "US",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    ("GET", _W + "/projects/{project_id}/ai/citations"): {"filter[country_iso]": "US"},
    # Every block of the diversity read; the tenant's answer cites its own page once.
    ("GET", _W + "/projects/{project_id}/ai/sources/diversity"): {
        "include": "series,ads",
        "filter[country_iso]": "US",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    # The domain of the tenant's seeded citation (`WORDS`), so the detail has rows to show.
    ("GET", _W + "/projects/{project_id}/ai/sources/domains/{registrable_domain}"): {
        "filter[country_iso]": "US",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    # The tenant's prompt cites its own page: the row names the page.
    ("GET", _W + "/projects/{project_id}/ai/sources/prompts"): {
        "filter[own_cited]": "true",
        "filter[country_iso]": "US",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    # WP-26 evidence-viewer
    # WP-30 runs-costs-health
    # WP-31 settings-engines
    # WP-32 overview-aggregates
    ("GET", _W + "/projects/{project_id}/ai/metrics/overview"): {"compare": "previous_period"},
    ("GET", _W + "/projects/{project_id}/overview/ai"): {"compare": "previous_period"},
    ("GET", _W + "/projects/{project_id}/ai/metrics/{metric}"): {"compare": "previous_period"},
    ("GET", _W + "/projects/{project_id}/ai/metrics/{metric}/series"): {
        "filter[country_iso]": "US"
    },
    ("GET", _W + "/projects/{project_id}/ai/metrics/{metric}/breakdown"): {"dimension": "topic"},
    ("GET", _W + "/projects/{project_id}/ai/competitors"): {
        "compare": "previous_period",
        "include": "lost_prompts,top_sources",
    },
    ("GET", _W + "/projects/{project_id}/overview/competitors"): {"compare": "previous_period"},
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
    # Both windows and `origin`, so the whole grouped read is scanned.
    ("GET", _W + "/projects/{project_id}/fp/ai-referrals"): {
        "compare": "previous_period",
        "group_by": "origin",
    },
    # WP-70 geo-readiness
    # WP-76 citations-v2-api
    # The gap reads take 1 to 5 competitors the project tracks (`competitor_id`).
    ("GET", _W + "/projects/{project_id}/ai/citation-gaps"): {
        "filter[competitor_id_in]": "{competitor_id}"
    },
    ("GET", _W + "/projects/{project_id}/ai/citation-gaps/{prompt_id}"): {
        "filter[competitor_id_in]": "{competitor_id}"
    },
    # Internal links tracker (plan 02): the journey step needs the focus page.
    ("GET", _W + "/projects/{project_id}/internal-links/neighbors"): {
        "url_id": "{url_id}",
        "direction": "out",
        "scope": "all",
    },
    # Plan 04: the change lists need the kind of change.
    ("GET", _W + "/projects/{project_id}/internal-links/changes/links"): {"change": "lost"},
    # The path finder needs the page to reach.
    ("GET", _W + "/projects/{project_id}/internal-links/paths"): {"url_id": "{url_id}"},
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
        # A `core.urls` id belongs to the dictionary every workspace shares and is a small number
        # that counts and depths equal by chance; the tenant's own page paths and URL (in the
        # ids) are what would show it.
        return [
            *(
                value
                for name, value in self.ids().items()
                if name not in ("url_id", "alert_event_id")
            ),
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
    # An earlier answer of the prompt that names the brand, written first so it is older: the
    # baseline the answer compare route reads.
    earlier = await seed_observation(
        pg,
        Project(workspace.id, project_id),
        seeded,
        object_key=f"{ai_key}.earlier",
        sha256=digest(ai_answer + b".earlier"),
    )
    observation_id = await seed_observation(
        pg,
        Project(workspace.id, project_id),
        seeded,
        object_key=ai_key,
        sha256=digest(ai_answer),
    )
    # Its extraction: a citation, a mention of the entity and the facts, read through the routes.
    await seed_extraction(pg, Project(workspace.id, project_id), observation_id, entity["id"])
    # The earlier answer's facts (a derivation is one per project): valid, and naming the brand.
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list) SELECT e.id, e.observed_at, f.derivation_id, f.workspace_id, "
        "f.project_id, e.observed_date, f.engine_code, f.observation_class, f.prompt_id, "
        "f.prompt_version_id, 1, true, true, false, 0, 0, 0, false FROM ai.observations e "
        "CROSS JOIN ai.observation_facts f WHERE e.id = $1 AND f.observation_id = $2",
        earlier,
        observation_id,
    )
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
    # An AI run under way takes the place of the rank run for the run routes: the coverage read
    # answers 422 for a rank run, and cancelling an AI run that is open succeeds as well. A second
    # AI run a budget blocked today shows in the daily collection, so that read is not empty.
    ai_run = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot) VALUES ($1, $2, 'ai_prompt', now(), "
        "now() + interval '2 hours', 'manual', 'running', '{}') RETURNING id",
        workspace.id,
        project_id,
    )
    blocked_run = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot, completed_at) VALUES ($1, $2, 'ai_prompt', "
        "now(), now() + interval '2 hours', 'manual', 'budget_blocked', '{}', now()) "
        "RETURNING id",
        workspace.id,
        project_id,
    )
    more_ids["run_id"] = str(ai_run["id"])
    more_ids["blocked_run_id"] = str(blocked_run["id"])
    # A live AI schedule, so the cost forecast has a row of the project's own to show.
    await execute(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at, selector) VALUES ($1, $2, 'ai_prompt', 'AI answers', 'daily', 'UTC', "
        "now() + interval '1 day', '{}')",
        workspace.id,
        project_id,
    )

    # WP-31 settings-engines

    # WP-32 overview-aggregates

    # WP-38 notes-annotations

    # WP-41 versions

    # WP-42 panels-api

    # WP-44 links-generate
    link = await fetchrow(
        pg,
        "INSERT INTO core.keyword_prompt_links (workspace_id, project_id, keyword_id, prompt_id, "
        "link_type, is_primary) SELECT $1, $2, k.id, p.id, 'generated', true "
        "FROM seo.keywords k, ai.prompts p "
        "WHERE k.workspace_id = $1 AND p.project_id = $2 LIMIT 1 RETURNING id",
        workspace.id,
        project_id,
    )
    more_ids["link_id"] = str(link["id"])
    # A keyword the prompt is not linked to yet, for the route that links one.
    unlinked = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, 'unlinked keyword', 'unlinked keyword', 'en') RETURNING id",
        workspace.id,
    )
    more_ids["unlinked_keyword_id"] = str(unlinked["id"])

    # WP-45 candidates-api

    # WP-47 alerts-api
    alert_rule_id, alert_event_id = await _seed_alerts(pg, workspace.id, project_id)
    more_ids["alert_rule_id"] = str(alert_rule_id)
    more_ids["alert_event_id"] = str(alert_event_id)

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
    # A live GA4 integration that finished a sync today, so the referral read has rows to read.
    ga4_integration = await fetchrow(
        pg,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_account, "
        "external_property, connection_id, scopes, backfill_state) VALUES ($1, $2, 'ga4', $3, "
        "'properties/123', $4, '{openid}', jsonb_build_object('ga4', jsonb_build_object("
        "'version', 1, 'through', current_date::text, 'complete', true, 'failures', 0))) "
        "RETURNING id",
        workspace.id,
        project_id,
        account.email,
        connection["id"],
    )
    await execute(
        pg,
        "INSERT INTO fp.ai_referral_daily (project_id, integration_id, metric_date, origin, "
        "classifier, rules_version, assistant_code, workspace_id, unit, sessions) "
        "VALUES ($1, $2, current_date, 'ga4', 'own_rules', 1, 'chatgpt', $3, 'sessions', 5)",
        project_id,
        ga4_integration["id"],
        workspace.id,
    )

    # WP-70 geo-readiness

    # WP-76 citations-v2-api
    # A competitor the project tracks, for the gap reads.
    rival = await fetchrow(
        pg,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', 'Citation rival') RETURNING id",
        workspace.id,
    )
    await execute(
        pg,
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role) "
        "VALUES ($1, $2, $3, 'competitor')",
        project_id,
        rival["id"],
        workspace.id,
    )
    more_ids["competitor_id"] = str(rival["id"])
    # The seeded answer also cites the project's pricing page (the `url_id` of the internal links
    # block below), so the cited page detail has a page of the tenant's own to show.
    await execute(
        pg,
        "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
        "project_id, engine_code, url_id, domain_id, raw_url, citation_kind, domain_role) "
        "SELECT $1, c.observed_at, 2, c.workspace_id, c.project_id, c.engine_code, u.id, "
        "u.domain_id, u.canonical_url, 'source_list', 'third_party' FROM ai.citations c, "
        "core.urls u WHERE c.observation_id = $1 AND c.citation_index = 1 AND u.id = $2",
        observation_id,
        await url_id(pg, f"https://example.com/{label}-pricing"),
    )
    # An answer of the prompt of the path routes, counted under the derivation of the one above,
    # so the gap drawer of `prompt_id` has an answer to show.
    version = await fetchrow(
        pg, "SELECT current_version_id FROM ai.prompts WHERE id = $1", prompt_id
    )
    gap_answer = await seed_observation(
        pg,
        Project(workspace.id, project_id),
        Prompt(prompt_id, version["current_version_id"]),
        object_key=f"{ai_key}.gap",
        sha256=digest(ai_answer + b".gap"),
    )
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list) SELECT e.id, e.observed_at, f.derivation_id, f.workspace_id, "
        "f.project_id, e.observed_date, e.engine_code, e.observation_class, e.prompt_id, "
        "e.prompt_version_id, 1, true, false, false, 0, 0, 0, false FROM ai.observations e "
        "CROSS JOIN ai.observation_facts f WHERE e.id = $1 AND f.observation_id = $2",
        gap_answer,
        observation_id,
    )

    # Internal links tracker (plan 02): the workspace's tiers and a spare one nothing uses, a
    # finished crawl of the project's site with two linked pages of the tenant's own (their
    # paths carry the label, so a response that shows them shows the tenant), a rule, a page with
    # a manual tier and a tag, and the tier flow of the crawl.
    tiers = await seed_tiers(pg, workspace)
    spare_tier = await fetchrow(
        pg,
        "INSERT INTO core.page_tier_levels (workspace_id, position, name, description) "
        "VALUES ($1, 5, 'Spare', '') RETURNING id",
        workspace.id,
    )
    await set_website(pg, project_id)
    home, pricing = f"/{label}-home", f"/{label}-pricing"
    crawl_run, crawl_ids = await seed_crawl(
        pg,
        workspace,
        project_id,
        [(home, 200), (pricing, 200)],
        [
            SeedLink(home, pricing, "content", f"{label} anchor"),
            SeedLink(home, pricing, "navigation", f"{label} menu"),
        ],
    )
    await set_counts(pg, crawl_run)
    # The path finder (plan 04 Task 14) searches from the crawl's start page: the home page.
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET start_url_id = $2 WHERE id = $1",
        crawl_run,
        crawl_ids[home],
    )
    # Opportunities (plan 04 Task 12): the pricing page mentions the home page's topic without
    # linking to it, and the owner accepted that fix.
    await execute(pg, "UPDATE seo.crawl_pages SET click_depth = 1 WHERE run_id = $1", crawl_run)
    await execute(
        pg,
        "INSERT INTO seo.crawl_mentions (run_id, workspace_id, source_url_id, target_url_id, "
        "phrase, context, origin) VALUES ($1, $2, $3, $4, $5, $6, 'keyword')",
        crawl_run,
        workspace.id,
        crawl_ids[pricing],
        crawl_ids[home],
        f"{label} home phrase",
        f"Teams read about the {label} home phrase first.",
    )
    await execute(
        pg,
        "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, source_url_id, "
        "target_url_id, status, decided_by) VALUES ($1, $2, $3, $4, 'accepted', $5)",
        project_id,
        workspace.id,
        crawl_ids[pricing],
        crawl_ids[home],
        owner.id,
    )
    await execute(
        pg,
        "INSERT INTO seo.crawl_link_changes (run_id, workspace_id, change, scope, source_url_id, "
        "target_url_id, placement, anchor) VALUES ($1, $2, 'lost', 'all', $3, $4, 'content', $5)",
        crawl_run,
        workspace.id,
        crawl_ids[home],
        crawl_ids[pricing],
        f"{label} anchor",
    )
    rule = await fetchrow(
        pg,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id, created_by) VALUES ($1, $2, 1, 'prefix', $3, $4, $5) RETURNING id",
        workspace.id,
        project_id,
        f"/{label}-pri",
        tiers[0],
        owner.id,
    )
    await execute(
        pg,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source, "
        "set_by) VALUES ($1, $2, $3, $4, 'manual', $5)",
        project_id,
        crawl_ids[pricing],
        workspace.id,
        tiers[1],
        owner.id,
    )
    tag_vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
        "VALUES ($1, 'tag', 'Page tags') RETURNING id",
        workspace.id,
    )
    tag_term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'Launch', 'launch', 'launch') RETURNING id",
        workspace.id,
        tag_vocabulary["id"],
    )
    await execute(
        pg,
        "INSERT INTO core.page_terms (project_id, url_id, term_id, workspace_id) "
        "VALUES ($1, $2, $3, $4)",
        project_id,
        crawl_ids[pricing],
        tag_term["id"],
        workspace.id,
    )
    page_note = await fetchrow(
        pg,
        "INSERT INTO core.page_notes (workspace_id, project_id, url_id, author_id, body) "
        "VALUES ($1, $2, $3, $4, 'Rewrite the intro before the launch.') RETURNING id",
        workspace.id,
        project_id,
        crawl_ids[pricing],
        owner.id,
    )
    more_ids["note_id"] = str(page_note["id"])
    attachment_id = uuid.uuid4()
    await execute(
        pg,
        "INSERT INTO core.page_note_attachments (id, workspace_id, project_id, url_id, "
        "uploaded_by, storage_key, original_name, size_bytes, content_type) "
        "VALUES ($1, $2, $3, $4, $5, $6, 'brief.pdf', 1024, 'application/pdf')",
        attachment_id,
        workspace.id,
        project_id,
        crawl_ids[pricing],
        owner.id,
        f"notes/v1/{workspace.id}/{project_id}/{attachment_id}.zst",
    )
    async with workspace_transaction(resources.sessions, workspace.id) as flow_db:
        await recompute_tier_flow(flow_db, workspace_id=workspace.id, run_id=crawl_run)
    # A crawl waiting for the worker (cancelling it would succeed; Crawl now is refused while it
    # waits), and settings that name the tenant's own subdomain.
    queued_crawl = await fetchrow(
        pg,
        "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
        "settings, ceiling) VALUES ($1, $2, 'manual', 'queued', 'example.com', '{}', 2000) "
        "RETURNING id",
        workspace.id,
        project_id,
    )
    await execute(
        pg,
        "UPDATE core.projects SET settings = $2::jsonb WHERE id = $1",
        project_id,
        json.dumps({"internal_links": {"allowed_subdomains": [f"{label}-blog.example.com"]}}),
    )
    # An active client summary link of the project, so revoking it would succeed
    share = await fetchrow(
        pg,
        "INSERT INTO core.client_summary_shares (workspace_id, project_id, token_hash, created_by, "
        "expires_at) VALUES ($1, $2, sha256(convert_to($3::text, 'UTF8')), $4, "
        "now() + interval '30 days') RETURNING id",
        workspace.id,
        project_id,
        f"summary-token-{project_id}",
        owner.id,
    )
    more_ids["share_id"] = str(share["id"])
    report_share = await fetchrow(
        pg,
        "INSERT INTO core.ai_report_shares (workspace_id, project_id, token_hash, created_by, "
        "expires_at) VALUES ($1, $2, sha256(convert_to($3::text, 'UTF8')), $4, "
        "now() + interval '30 days') RETURNING id",
        workspace.id,
        project_id,
        f"report-token-{project_id}",
        owner.id,
    )
    more_ids["report_share_id"] = str(report_share["id"])
    report_schedule = await fetchrow(
        pg,
        "INSERT INTO core.ai_report_schedules (workspace_id, project_id, frequency, recipients, "
        "next_run_at, created_by) VALUES ($1, $2, 'weekly', ARRAY['client@example.com'], "
        "now() + interval '1 day', $3) RETURNING id",
        workspace.id,
        project_id,
        owner.id,
    )
    more_ids["report_schedule_id"] = str(report_schedule["id"])
    more_ids["crawl_run_id"] = str(queued_crawl["id"])
    more_ids["finished_crawl_id"] = str(crawl_run)
    more_ids["tier_id"] = str(spare_tier["id"])
    more_ids["rule_id"] = str(rule["id"])
    more_ids["tag_term_id"] = str(tag_term["id"])
    more_ids["url_id"] = str(crawl_ids[pricing])
    more_ids["page_url"] = f"https://example.com{pricing}"
    more_ids["home_url"] = f"https://example.com{home}"

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
        if name in ("serp_snapshot_id", "observation_id", "url_id", "alert_event_id")
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

    if "/link-crawls" in path:
        # `{run_id}` is an operations run elsewhere, and a crawl here.
        ids = {**ids, "run_id": ids["crawl_run_id"]}
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
    query = QUERIES.get((method, path))
    return await api.request(
        method,
        _fill(path, ids),
        params=None if query is None else {key: _fill(value, ids) for key, value in query.items()},
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
    "core.ai_report_shares": "workspace_id",
    "core.ai_report_schedules": "workspace_id",
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
    # Internal links tracker (plan 02)
    "core.page_tier_levels": "workspace_id",
    "core.tier_rules": "workspace_id",
    "core.project_pages": "workspace_id",
    "core.page_terms": "workspace_id",
    "core.page_notes": "workspace_id",
    "core.page_note_attachments": "workspace_id",
    "seo.crawl_runs": "workspace_id",
    "seo.crawl_pages": "workspace_id",
    "seo.crawl_links": "workspace_id",
    "seo.crawl_tier_flow": "workspace_id",
    "seo.crawl_tier_stats": "workspace_id",
    # Internal links tracker (plan 04)
    "seo.crawl_mentions": "workspace_id",
    "core.link_opportunity_decisions": "workspace_id",
    "core.tier_suggestion_dismissals": "workspace_id",
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
    "core.keyword_prompt_links": "workspace_id",
    # WP-45 candidates-api
    # WP-47 alerts-api
    "ops.alert_rules": "workspace_id",
    "ops.alert_events": "workspace_id",
    "ops.alert_cursors": "workspace_id",
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
    "fp.ai_referral_daily": "workspace_id",
    # WP-70 geo-readiness
    # WP-76 citations-v2-api
}


async def _seed_alerts(
    pg: PostgresServer, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> tuple[uuid.UUID, int]:
    db = await asyncpg.connect(pg.url())
    try:
        return await seed_alerts(db, workspace_id, project_id)
    finally:
        await db.close()


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
    elif (method, path) in CRAWL_UNDER_WAY:
        # The scope let the member in; the project's queued crawl is why nothing is started.
        assert _problem(inside) == (409, "crawl_in_progress")
    elif (method, path) in SCREENSHOT_ROUTES:
        assert _problem(inside) == SCREENSHOT_ROUTES[(method, path)]
    elif (method, path) in NOTE_ROUTES:
        assert _problem(inside) == NOTE_ROUTES[(method, path)]
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
    # The dismissals are seeded by their own test, which counts them from zero
    unseeded = {"ops.audit_logs", "core.tier_suggestion_dismissals"}
    assert all(digest is not None for table, digest in before.items() if table not in unseeded)

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


# (path under a project, query, whether the answer names the tenant's own pages)
INTERNAL_LINK_READS = [
    ("/internal-links/pages", {}, True),
    ("/internal-links/pages/{url_id}", {}, True),
    ("/internal-links/edges", {"scope": "all"}, True),
    ("/internal-links/neighbors", {"direction": "in", "scope": "all", "url_id": "{url_id}"}, True),
    # The seeded page has no link out, so there is nothing of its own to name.
    (
        "/internal-links/neighbors",
        {"direction": "out", "scope": "all", "url_id": "{url_id}"},
        False,
    ),
    ("/internal-links/tier-flow", {"scope": "all"}, False),
    # The Link map's graph (plan 10): the seeded pages are its nodes.
    ("/internal-links/graph", {"include_auto": "true"}, True),
    ("/internal-links/worklists", {}, False),
    ("/internal-links/changes/summary", {}, False),
    # The seeded crawl holds one lost link, from the seeded home page to the seeded pricing page.
    ("/internal-links/changes/links", {"change": "lost", "link_scope": "all"}, True),
    ("/internal-links/changes/pages", {}, False),
    # The extras of the Pages tab (plan 04 Task 11) and the seeded mention, from the seeded
    # pricing page to the home page (the dedicated tests below give B's numbers to A's pages).
    ("/internal-links/pages", {"include": "changes,keywords,citations,anchors,gsc"}, True),
    ("/internal-links/opportunities", {}, True),
    ("/internal-links/tier-suggestions", {}, False),
    # The seeded home page is the crawl's start page, so the route to the pricing page is one
    # click and names both pages.
    ("/internal-links/paths", {"url_id": "{url_id}"}, True),
    # The crawls and the settings carry no page names; their own tests below name the tenant.
    ("/link-crawls", {}, False),
    ("/link-crawls/{crawl_run_id}", {}, False),
    ("/settings", {}, False),
]


@pytest.mark.parametrize(("suffix", "params", "names_pages"), INTERNAL_LINK_READS)
async def test_the_pages_and_links_of_a_project_hold_nothing_of_another_workspace(
    api: httpx.AsyncClient,
    tenants: tuple[Tenant, Tenant],
    suffix: str,
    params: dict[str, str],
    names_pages: bool,
) -> None:
    """The internal link reads sit under a project, so no list route covers them: A's own answer
    is scanned for B's page URL and path (`core.urls` is a dictionary both share, so B's url id
    is left out of `secrets()`)."""
    a, b = tenants

    response = await api.get(
        _fill(_W + "/projects/{project_id}" + suffix, a.ids()),
        params={name: _fill(value, a.ids()) for name, value in params.items()},
        headers=a.headers,
    )

    assert response.status_code == 200, response.text
    # A bare number (an id of a snapshot or an observation) equals a count or a url id of these
    # answers by chance; the identifying strings are what a leak would show.
    for secret in (secret for secret in b.secrets() if not secret.isdigit()):
        assert not _leaks(response.json(), secret), f"{suffix} shows {secret} of another workspace"
    if names_pages:
        own_site = a.ids()["page_url"].removeprefix("https://example.com").split("-")[0]
        assert f"{own_site}-" in response.text
        # Routes that show a path and no address (the graph) cannot leak B's full URL
        other_site = b.ids()["page_url"].removeprefix("https://example.com").split("-")[0]
        assert f"{other_site}-" not in response.text


async def test_the_crawls_and_settings_of_a_project_show_only_its_own_workspace(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant]
) -> None:
    """The crawl list names A's two crawls and the settings A's subdomain, and nothing of B's."""
    a, b = tenants
    base = _fill(_W + "/projects/{project_id}", a.ids())

    crawls = await api.get(f"{base}/link-crawls", headers=a.headers)
    settings = await api.get(f"{base}/settings", headers=a.headers)

    assert {row["run_id"] for row in crawls.json()["data"]} == {
        a.ids()["crawl_run_id"],
        a.ids()["finished_crawl_id"],
    }
    assert settings.json()["data"]["internal_links"]["allowed_subdomains"] == ["a-blog.example.com"]
    assert "b-blog" not in settings.text
    assert b.ids()["crawl_run_id"] not in crawls.text
    assert b.ids()["finished_crawl_id"] not in crawls.text


async def test_the_extras_of_a_page_hold_only_its_own_workspaces_numbers(
    api: httpx.AsyncClient, migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Plan 04 Task 11. `core.urls` is shared, so B can hold a tracked keyword, an AI citation,
    a link with its anchor and Search Console clicks on A's own pricing page. A reads the page
    through the Pages tab (`include=`) and the page detail, and sees none of it: not in a count,
    not in a name, not in a number."""
    a, b = tenants
    page = int(a.ids()["url_id"])
    path = a.ids()["page_url"].removeprefix("https://example.com")
    end = date.today() - timedelta(days=3)
    await execute(
        migrated,
        "UPDATE core.projects SET default_location_id = $1, default_language_code = 'en' "
        "WHERE id = ANY($2::uuid[])",
        LOCATION,
        [a.project_id, b.project_id],
    )
    await track_keyword(
        migrated, a.workspace, a.project_id, "a own keyword", page, rank=3, change=1, volume=1500
    )
    await insert_citation(migrated, a.workspace, a.project_id, page, "chatgpt_web", 1)
    await execute(
        migrated,
        "UPDATE fp.integrations SET status = 'active', backfill_state = $2::jsonb WHERE id = $1",
        a.integration_id,
        json.dumps(PullState(recent_done=True, window_end=end).write({})),
    )
    for tenant, clicks, impressions in ((a, 11, 22), (b, 777, 7777)):
        await execute(
            migrated,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
            "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            tenant.integration_id,
            end,
            page,
            tenant.workspace.id,
            tenant.project_id,
            clicks,
            impressions,
        )
    await track_keyword(
        migrated, b.workspace, b.project_id, "b secret keyword", page, rank=1, change=5, volume=999
    )
    await insert_citation(migrated, b.workspace, b.project_id, page, "gemini_web", 1)
    await seed_crawl(
        migrated,
        b.workspace,
        b.project_id,
        [(path, 200), ("/b-secret-source", 200)],
        [SeedLink("/b-secret-source", path, "content", "b secret anchor")],
    )

    base = _fill(_W + "/projects/{project_id}/internal-links", a.ids())
    listed = await api.get(
        f"{base}/pages",
        params={"include": "changes,keywords,citations,anchors,gsc", "limit": "200"},
        headers=a.headers,
    )
    detail = await api.get(f"{base}/pages/{page}", headers=a.headers)

    assert listed.status_code == 200, listed.text
    assert detail.status_code == 200, detail.text
    extras = {row["path"]: row for row in listed.json()["data"]}[path]["extras"]
    # The numbers; the as-of dates (`rank_as_of`, `citations_as_of`) say when, not how many
    assert {key: value for key, value in extras["keywords"].items() if key != "rank_as_of"} == {
        "tracked": 1,
        "ranking": 1,
        "average_rank": 3.0,
        "best_volume": 1500,
    }
    assert {
        key: value for key, value in extras["citations"].items() if key != "citations_as_of"
    } == {
        "chatgpt": 1,
        "gemini": 0,
        "ai_mode": 0,
        "total": 1,
    }
    assert (extras["gsc"]["state"], extras["gsc"]["clicks"], extras["gsc"]["impressions"]) == (
        "ok",
        11,
        22,
    )
    assert (extras["anchors"]["total"], extras["anchors"]["distinct"]) == (1, 1)
    whole = detail.json()["data"]["extras"]
    assert [row["keyword"] for row in whole["keywords"]] == ["a own keyword"]
    assert whole["citations"] == extras["citations"]
    assert [row["text"] for row in whole["anchors"]["top"]] == ["a anchor"]
    assert (whole["gsc"]["clicks"], whole["gsc"]["impressions"]) == (11, 22)
    for response in (listed, detail):
        assert "b secret" not in response.text
        for secret in (secret for secret in b.secrets() if not secret.isdigit()):
            assert not _leaks(response.json(), secret), f"shows {secret} of another workspace"


async def test_decisions_on_another_workspaces_pair_change_nothing(
    api: httpx.AsyncClient, migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Plan 04 Task 12. The pair of B's seeded mention is not a mention of A's crawl, so A's
    owner can neither dismiss nor reopen it, and B's accepted decision stays as it was."""
    a, b = tenants
    pair = {
        "source_url_id": b.ids()["url_id"],
        "target_url_id": str(await url_id(migrated, b.ids()["home_url"])),
    }
    base = _fill(_W + "/projects/{project_id}/internal-links/opportunities", a.ids())
    before = await _checksum(migrated, a.workspace, b.workspace)

    for status in ("dismissed", "open"):
        response = await api.put(
            f"{base}/decisions", json={"items": [pair], "status": status}, headers=a.headers
        )
        assert response.json()["data"] == {"matched": 0, "changed": 0}

    after = await _checksum(migrated, a.workspace, b.workspace)
    assert {table: digest for table, digest in after.items() if table != "ops.audit_logs"} == {
        table: digest for table, digest in before.items() if table != "ops.audit_logs"
    }
    kept = await fetchrow(
        migrated,
        "SELECT status FROM core.link_opportunity_decisions WHERE project_id = $1",
        b.project_id,
    )
    assert kept["status"] == "accepted"


async def test_tier_suggestions_hold_only_their_own_workspaces_keywords_and_dismissals(
    api: httpx.AsyncClient, migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Plan 04 Task 13. `core.urls` is shared, so B can track a keyword that ranks 1 on A's home
    page and have dismissed it. A's suggestion for that page comes from A's own keyword only, B's
    dismissal does not hide it, and neither workspace can accept or dismiss for the other."""
    a, b = tenants
    home = await url_id(migrated, a.ids()["home_url"])
    await execute(
        migrated,
        "UPDATE core.projects SET default_location_id = $1, default_language_code = 'en' "
        "WHERE id = ANY($2::uuid[])",
        LOCATION,
        [a.project_id, b.project_id],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET is_indexable = true WHERE workspace_id = ANY($1::uuid[])",
        [a.workspace.id, b.workspace.id],
    )
    await track_keyword(
        migrated, a.workspace, a.project_id, "a own keyword", home, rank=2, change=None, volume=9000
    )
    await track_keyword(
        migrated,
        b.workspace,
        b.project_id,
        "b secret keyword",
        home,
        rank=1,
        change=None,
        volume=9999,
    )
    await execute(
        migrated,
        "INSERT INTO core.tier_suggestion_dismissals (project_id, workspace_id, url_id) "
        "VALUES ($1, $2, $3)",
        b.project_id,
        b.workspace.id,
        home,
    )
    base = _fill(_W + "/projects/{project_id}/internal-links/tier-suggestions", a.ids())

    listed = await api.get(base, headers=a.headers)
    foreign = await api.post(
        f"{base}/accept", json={"url_ids": [b.ids()["url_id"]]}, headers=a.headers
    )
    dismissed = await api.post(
        f"{base}/dismiss", json={"url_ids": [b.ids()["url_id"]]}, headers=a.headers
    )

    rows = listed.json()["data"]
    assert [row["path"] for row in rows] == [f"/{a.ids()['home_url'].rsplit('/', 1)[-1]}"]
    assert [reason["keyword"] for reason in rows[0]["reasons"]] == ["a own keyword"]
    assert "b secret" not in listed.text
    assert foreign.json()["data"] == {"matched": 0, "changed": 0}
    assert dismissed.json()["data"] == {"matched": 0, "changed": 0}
    count = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM core.tier_suggestion_dismissals WHERE project_id = $1",
        a.project_id,
    )
    assert count["n"] == 0


async def test_a_route_holds_only_its_own_workspaces_links_and_refuses_a_foreign_page(
    api: httpx.AsyncClient, migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Plan 04 Task 14. `core.urls` is shared, so B can crawl a link between A's own home and
    pricing pages, with its own anchor. A's route between them names A's anchors only, and a
    page id that only B's crawl holds is `404 not_found` for A."""
    a, b = tenants
    home = a.ids()["home_url"].removeprefix("https://example.com")
    pricing = a.ids()["page_url"].removeprefix("https://example.com")
    run, ids = await seed_crawl(
        migrated,
        b.workspace,
        b.project_id,
        [(home, 200), (pricing, 200), ("/b-secret-only", 200)],
        [
            SeedLink(home, pricing, "content", "b secret anchor"),
            SeedLink(home, "/b-secret-only", "content", "b secret deep"),
        ],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET start_url_id = $2 WHERE id = $1",
        run,
        ids[home],
    )
    base = _fill(_W + "/projects/{project_id}/internal-links/paths", a.ids())

    own = await api.get(base, params={"url_id": a.ids()["url_id"]}, headers=a.headers)
    foreign = await api.get(base, params={"url_id": str(ids["/b-secret-only"])}, headers=a.headers)

    assert own.status_code == 200, own.text
    steps = own.json()["data"]["any"]["steps"]
    assert [step["anchor"] for step in steps] == [None, "a anchor"]
    assert "b secret" not in own.text
    assert _problem(foreign) == (404, "not_found")
    assert "b-secret" not in foreign.text


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
