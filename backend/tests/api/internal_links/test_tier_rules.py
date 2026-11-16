"""Tier rules: ordered, first match wins, applied to every page, with a preview (spec 5.2)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from idraft.crawl.tiers import MatchType, TierRule, first_match, rule_matches
from tests.api.auth.support import fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import audit_rows, seed_crawl, seed_tiers
from tests.api.keywords.support import errors, keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/services/seo", 200), ("/services/ppc", 200), ("/blog/a", 200), ("/", 200)]


async def test_rules_apply_in_order_and_a_new_first_rule_shifts_the_others(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, t3, _ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")

    first = await api.post(
        url,
        json={"match_type": "prefix", "value": "/services/", "tier_id": str(t1)},
        headers=editor.headers,
    )
    second = await api.post(
        url,
        json={"match_type": "exact", "value": "/services/ppc", "tier_id": str(t2), "position": 1},
        headers=editor.headers,
    )
    pattern = await api.post(
        url,
        json={"match_type": "pattern", "value": "/blog/*", "tier_id": str(t3)},
        headers=editor.headers,
    )
    listed = await api.get(url, headers=editor.headers)

    assert {first.status_code, second.status_code, pattern.status_code} == {201}
    assert [(rule["position"], rule["value"]) for rule in listed.json()["data"]] == [
        (1, "/services/ppc"),
        (2, "/services/"),
        (3, "/blog/*"),
    ]
    assert listed.json()["data"][0]["tier"]["code"] == "T2"
    rows = await fetch(
        migrated, "SELECT url_id, tier_id FROM core.project_pages WHERE project_id = $1", project
    )
    assert {row["url_id"]: row["tier_id"] for row in rows} == {
        ids["/services/seo"]: t1,
        ids["/services/ppc"]: t2,
        ids["/blog/a"]: t3,
    }
    assert len(await audit_rows(migrated, workspace, "tier_rule.created")) == 3


async def test_the_preview_counts_what_a_rule_would_decide(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")
    await api.post(
        url,
        json={"match_type": "exact", "value": "/services/seo", "tier_id": str(t1)},
        headers=editor.headers,
    )

    preview = await api.post(
        f"{url}/preview",
        json={"match_type": "prefix", "value": "/services/"},
        headers=editor.headers,
    )

    assert preview.json()["data"] == {"matching_pages": 2, "would_apply": 1}


async def test_the_preview_and_the_stored_tiers_agree_with_the_pure_rules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Multi-star patterns and a trailing slash on an exact rule: the preview counts and the
    tiers a created rule stores both come from `rule_matches`."""
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    paths = ["/a/x/b/y", "/a/b/", "/a/x/b", "/a/x/y/b/z", "/pricing", "/pricing/", "/pricing/x"]
    _, ids = await seed_crawl(migrated, workspace, project, [(path, 200) for path in paths])
    url = project_url(workspace, project, "tier-rules")
    specs = [("pattern", "/a/*/b/*", t1), ("exact", "/pricing/", t2), ("pattern", "/*b*", t2)]

    for match_type, value, tier in specs:
        candidate = TierRule(uuid.UUID(int=1), 1, MatchType(match_type), value, tier)
        matching = [path for path in paths if rule_matches(candidate, path)]
        preview = await api.post(
            f"{url}/preview",
            json={"match_type": match_type, "value": value},
            headers=editor.headers,
        )
        assert preview.json()["data"]["matching_pages"] == len(matching), (match_type, value)
        created = await api.post(
            url,
            json={"match_type": match_type, "value": value, "tier_id": str(tier)},
            headers=editor.headers,
        )
        assert created.status_code == 201, created.text

    listed = (await api.get(url, headers=editor.headers)).json()["data"]
    rules = [
        TierRule(
            uuid.UUID(rule["rule_id"]),
            rule["position"],
            MatchType(rule["match_type"]),
            rule["value"],
            uuid.UUID(rule["tier"]["tier_id"]),
        )
        for rule in listed
    ]
    rows = await fetch(
        migrated, "SELECT url_id, rule_id FROM core.project_pages WHERE project_id = $1", project
    )
    stored = {row["url_id"]: row["rule_id"] for row in rows}
    expected = {}
    for path in paths:
        match = first_match(rules, path)
        if match is not None:
            expected[ids[path]] = match.rule_id
    assert stored == expected
    # The exact rule `/pricing/` claims both spellings.
    assert {ids["/pricing"], ids["/pricing/"]} <= set(stored)


async def test_deleting_a_rule_takes_its_tiers_away_and_moving_one_reorders(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")
    a = (
        await api.post(
            url,
            json={"match_type": "prefix", "value": "/services/", "tier_id": str(t1)},
            headers=editor.headers,
        )
    ).json()["data"]
    b = (
        await api.post(
            url,
            json={"match_type": "prefix", "value": "/blog/", "tier_id": str(t2)},
            headers=editor.headers,
        )
    ).json()["data"]

    moved = await api.patch(f"{url}/{b['rule_id']}", json={"position": 1}, headers=editor.headers)
    deleted = await api.delete(f"{url}/{a['rule_id']}", headers=editor.headers)

    assert moved.json()["data"]["position"] == 1
    assert deleted.status_code == 204
    rows = await fetch(
        migrated, "SELECT tier_id FROM core.project_pages WHERE project_id = $1", project
    )
    assert [row["tier_id"] for row in rows] == [t2]
    left = await fetch(
        migrated, "SELECT position FROM core.tier_rules WHERE project_id = $1", project
    )
    assert [row["position"] for row in left] == [1]
    assert len(await audit_rows(migrated, workspace, "tier_rule.deleted")) == 1


async def test_rule_values_are_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "tier-rules"),
        json={"match_type": "exact", "value": "pricing", "tier_id": str(t1)},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("value", "starts_with_slash")]


async def test_a_rule_cannot_name_a_tier_of_another_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    foreign_tier, *_ = await seed_tiers(migrated, await make_workspace(migrated, name="Other"))
    url = project_url(workspace, project, "tier-rules")
    own = (
        await api.post(
            url,
            json={"match_type": "prefix", "value": "/a/", "tier_id": str(t1)},
            headers=editor.headers,
        )
    ).json()["data"]

    created = await api.post(
        url,
        json={"match_type": "prefix", "value": "/b/", "tier_id": str(foreign_tier)},
        headers=editor.headers,
    )
    patched = await api.patch(
        f"{url}/{own['rule_id']}", json={"tier_id": str(foreign_tier)}, headers=editor.headers
    )
    unknown = await api.post(
        url,
        json={"match_type": "prefix", "value": "/c/", "tier_id": str(uuid.uuid4())},
        headers=editor.headers,
    )

    assert problem(created) == (422, "validation_failed")
    assert problem(patched) == (422, "validation_failed")
    assert problem(unknown) == (422, "validation_failed")
    assert errors(created) == [("tier_id", "tier_unknown")]
    rows = await fetch(
        migrated, "SELECT tier_id FROM core.tier_rules WHERE project_id = $1", project
    )
    assert [row["tier_id"] for row in rows] == [t1]


async def test_a_rule_of_another_project_or_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    other_project = await keyword_project(migrated, workspace)
    other = await make_workspace(migrated, name="Other")
    foreign_project = await keyword_project(migrated, other)
    t1, *_ = await seed_tiers(migrated, workspace)
    foreign_tier, *_ = await seed_tiers(migrated, other)
    sibling = (
        await api.post(
            project_url(workspace, other_project, "tier-rules"),
            json={"match_type": "prefix", "value": "/a/", "tier_id": str(t1)},
            headers=editor.headers,
        )
    ).json()["data"]
    foreign_rule = (
        await fetch(
            migrated,
            "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
            "tier_id) VALUES ($1, $2, 1, 'prefix', '/x/', $3) RETURNING id",
            other.id,
            foreign_project,
            foreign_tier,
        )
    )[0]["id"]
    url = project_url(workspace, project, "tier-rules")

    for rule_id in (sibling["rule_id"], str(foreign_rule), str(uuid.uuid4())):
        patched = await api.patch(f"{url}/{rule_id}", json={"position": 1}, headers=editor.headers)
        deleted = await api.delete(f"{url}/{rule_id}", headers=editor.headers)
        assert (patched.status_code, deleted.status_code) == (404, 404), rule_id
    foreign_project_rules = await api.get(
        project_url(workspace, foreign_project, "tier-rules"), headers=editor.headers
    )

    assert foreign_project_rules.status_code == 404
    survivors = await fetch(
        migrated,
        "SELECT count(*) AS n FROM core.tier_rules WHERE workspace_id = ANY($1::uuid[])",
        [workspace.id, other.id],
    )
    assert survivors[0]["n"] == 2


async def test_a_preview_names_a_rule_being_edited_without_touching_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")
    rule = (
        await api.post(
            url,
            json={"match_type": "prefix", "value": "/services/", "tier_id": str(t1)},
            headers=editor.headers,
        )
    ).json()["data"]

    edited = await api.post(
        f"{url}/preview",
        json={"match_type": "prefix", "value": "/services/seo", "rule_id": rule["rule_id"]},
        headers=editor.headers,
    )
    strange = await api.post(
        f"{url}/preview",
        json={"match_type": "prefix", "value": "/blog/", "rule_id": str(uuid.uuid4())},
        headers=editor.headers,
    )

    assert edited.json()["data"] == {"matching_pages": 1, "would_apply": 1}
    assert strange.json()["data"] == {"matching_pages": 1, "would_apply": 1}
    stored = await fetch(
        migrated, "SELECT value FROM core.tier_rules WHERE project_id = $1", project
    )
    assert [row["value"] for row in stored] == ["/services/"]


async def test_a_viewer_previews_but_cannot_change_rules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "tier-rules")

    preview = await api.post(
        f"{url}/preview", json={"match_type": "prefix", "value": "/"}, headers=viewer.headers
    )
    created = await api.post(
        url,
        json={"match_type": "prefix", "value": "/", "tier_id": str(t1)},
        headers=viewer.headers,
    )

    assert preview.status_code == 200, preview.text
    assert created.status_code == 403
