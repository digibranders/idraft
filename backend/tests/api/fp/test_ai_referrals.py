"""`GET {P}/fp/ai-referrals` (WP-69 task 5; contract note
`docs/ai-visibility/contracts/fp-ai-referrals.md`): the AI referral sessions of a project's GA4
property, both classifiers side by side."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai.sources_support import statements
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import project_url
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

GA4 = "ga4_ai_assistant_channel"
OWN = "own_rules"
FROM, TO = "2026-11-01", "2026-11-10"
# The ten days just before FROM and TO.
PREVIOUS_FROM, PREVIOUS_TO = "2026-10-22", "2026-10-31"
# The first day a pull stored, long before every window of these tests.
SINCE = "2026-08-01"
NOTES = [
    "Google AI Mode and Google AI Overview are not counted: Google Analytics files their "
    "sessions under organic search.",
    "The figures are a lower bound: visits without a referrer, such as clicks from native apps, "
    "are filed under direct.",
    "The two classifiers are shown side by side and neither is labelled correct.",
]
# Statements one read sends when it reads the numbers, the session and membership checks
# included: the project's timezone, the integration, and the one grouped read.
READ_STATEMENTS = 7
# The same when the project has no live integration or nothing collected: no grouped read.
SHORT_STATEMENTS = READ_STATEMENTS - 1


async def _integration(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    *,
    through: str | None = TO,
    since: str | None = SINCE,
    status: str = "active",
    last_success_at: datetime | None = None,
    kind: str = "ga4",
) -> uuid.UUID:
    """`since` is the first pulled day; None leaves it out, as a state of before it was kept."""
    state: dict[str, Any] = {}
    if through is not None:
        state = {
            "ga4": {
                "version": 1,
                "through": through,
                "complete": True,
                "failures": 0,
                "retry_at": None,
                **({} if since is None else {"since": since}),
            }
        }
    # The route never reads the connection, so a revoked one (it needs no secret) will do.
    connection = await fetchrow(
        pg,
        "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, scopes, "
        "status) VALUES ($1, 'google', 'oauth', $2, '{openid}', 'revoked') RETURNING id",
        workspace.id,
        uuid.uuid4().hex,
    )
    row = await fetchrow(
        pg,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
        "connection_id, scopes, status, last_success_at, backfill_state) VALUES ($1, $2, $3, "
        "$4, $5, '{openid}', $6, $7, $8::jsonb) RETURNING id",
        workspace.id,
        project_id,
        kind,
        f"properties/{uuid.uuid4().int % 10**9}",
        connection["id"],
        status,
        last_success_at,
        json.dumps(state),
    )
    integration_id: uuid.UUID = row["id"]
    return integration_id


async def _row(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    integration_id: uuid.UUID,
    day: str,
    classifier: str,
    assistant: str,
    sessions: int | None,
    *,
    engaged: int | None = None,
    key_events: str | None = None,
    origin: str = "ga4",
    is_current: bool = True,
    rules_version: int | None = None,
) -> None:
    version = rules_version if rules_version is not None else (0 if classifier == GA4 else 1)
    await execute(
        pg,
        "INSERT INTO fp.ai_referral_daily (project_id, integration_id, metric_date, origin, "
        "classifier, rules_version, assistant_code, workspace_id, unit, sessions, "
        "engaged_sessions, key_events, is_current) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, "
        "'sessions', $9, $10, $11, $12)",
        project_id,
        integration_id,
        date.fromisoformat(day),
        origin,
        classifier,
        version,
        assistant,
        workspace.id,
        sessions,
        engaged,
        None if key_events is None else Decimal(key_events),
        is_current,
    )


async def _get(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    **params: str,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project_id, "fp", "ai-referrals"),
        params=params,
        headers=caller.headers,
    )


async def _ok(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    **params: str,
) -> dict[str, Any]:
    response = await _get(api, workspace, project_id, caller, **params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _world(
    resources: Resources, migrated: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    return workspace, await make_project(migrated, workspace.id), owner


def _by_key(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["key"]: row for row in body["data"]}


async def test_no_integration_is_connected_false_and_empty(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["data"] == []
    assert body["meta"] == {
        "connected": False,
        "collected_through": None,
        "collected_since": None,
        "window_collected": False,
        "last_success_at": None,
        "window": {"from": FROM, "to": TO, "timezone": "UTC"},
        "compare_window": None,
        "rules_version": None,
        "lower_bound": True,
        "notes": NOTES,
    }


async def test_a_property_that_is_not_ga4_does_not_connect(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _integration(migrated, workspace, project, kind="gsc")

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["meta"]["connected"] is False


async def test_connected_but_never_collected_is_empty_with_no_collected_through(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, through=None)
    # A row that a half finished run left: it is not read before a run has finished.
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 9)

    with statements(resources) as seen:
        body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["data"] == []
    assert body["meta"]["connected"] is True
    assert body["meta"]["collected_through"] is None
    assert body["meta"]["collected_since"] is None
    assert body["meta"]["window_collected"] is False
    assert body["meta"]["notes"] == [
        *NOTES,
        "Google Analytics has not been collected yet for this project.",
    ]
    assert len(seen) == SHORT_STATEMENTS, seen


async def test_both_classifiers_with_sessions_engaged_key_events_and_difference(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    success = datetime.fromisoformat("2026-11-11T06:00:00+00:00")
    integration = await _integration(migrated, workspace, project, last_success_at=success)
    for day, sessions, engaged, events in (
        ("2026-11-01", 10, 8, "1.50"),
        ("2026-11-02", 5, 3, "2"),
    ):
        await _row(
            migrated, workspace, project, integration, day, OWN, "chatgpt", sessions,
            engaged=engaged, key_events=events,
        )  # fmt: skip
    await _row(
        migrated, workspace, project, integration, "2026-11-02", GA4, "chatgpt", 12,
        engaged=9, key_events="3.50",
    )  # fmt: skip
    # Only the own rules see perplexity; only the GA4 channel sees claude.
    await _row(migrated, workspace, project, integration, TO, OWN, "perplexity", 2, engaged=2)
    await _row(migrated, workspace, project, integration, TO, GA4, "claude", 30, engaged=20)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    rows = _by_key(body)
    assert [row["key"] for row in body["data"]] == ["claude", "chatgpt", "perplexity"]
    assert rows["chatgpt"] == {
        "key": "chatgpt",
        GA4: {
            "sessions": 12,
            "engaged_sessions": 9,
            "key_events": "3.50",
            "previous": None,
        },
        OWN: {
            "sessions": 15,
            "engaged_sessions": 11,
            "key_events": "3.50",
            "previous": None,
        },
        "difference": 3,
    }
    assert rows["perplexity"][GA4] is None
    assert rows["perplexity"][OWN]["sessions"] == 2
    assert rows["perplexity"][OWN]["key_events"] is None
    assert rows["perplexity"]["difference"] is None
    assert rows["claude"][OWN] is None
    assert rows["claude"]["difference"] is None
    assert body["meta"]["connected"] is True
    assert body["meta"]["collected_through"] == TO
    assert body["meta"]["collected_since"] == SINCE
    assert body["meta"]["window_collected"] is True
    assert datetime.fromisoformat(body["meta"]["last_success_at"]) == success
    assert body["meta"]["rules_version"] == 1
    assert body["meta"]["notes"] == NOTES


async def test_group_by_origin_keys_the_rows_by_origin(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 4)
    await _row(migrated, workspace, project, integration, FROM, OWN, "claude", 6)
    await _row(migrated, workspace, project, integration, FROM, GA4, "chatgpt", 7)

    body = await _ok(
        api, workspace, project, owner, **{"from": FROM, "to": TO, "group_by": "origin"}
    )

    assert [row["key"] for row in body["data"]] == ["ga4"]
    assert body["data"][0][OWN]["sessions"] == 10
    assert body["data"][0][GA4]["sessions"] == 7
    assert body["data"][0]["difference"] == 3


async def test_the_previous_period_sits_beside_each_value(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10, engaged=6)
    await _row(
        migrated, workspace, project, integration, PREVIOUS_TO, OWN, "chatgpt", 4,
        engaged=3, key_events="1.00",
    )  # fmt: skip
    await _row(migrated, workspace, project, integration, PREVIOUS_FROM, OWN, "chatgpt", 1)
    # Present now and absent before: the first collected day is not known, so no previous.
    await _row(migrated, workspace, project, integration, FROM, OWN, "claude", 3)
    # Before the previous window: not counted in it.
    await _row(migrated, workspace, project, integration, "2026-10-21", OWN, "chatgpt", 100)

    body = await _ok(
        api, workspace, project, owner,
        **{"from": FROM, "to": TO, "compare": "previous_period"},
    )  # fmt: skip

    rows = _by_key(body)
    assert rows["chatgpt"][OWN]["previous"] == {
        "sessions": 5,
        "engaged_sessions": 3,
        "key_events": "1.00",
    }
    assert rows["claude"][OWN]["previous"] is None
    assert body["meta"]["compare_window"] == {
        "from": PREVIOUS_FROM,
        "to": PREVIOUS_TO,
        "timezone": "UTC",
    }
    assert body["meta"]["notes"] == NOTES


async def test_compare_from_and_compare_to_win_over_compare(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)
    await _row(migrated, workspace, project, integration, "2026-09-05", OWN, "chatgpt", 7)
    await _row(migrated, workspace, project, integration, PREVIOUS_TO, OWN, "chatgpt", 99)

    body = await _ok(
        api, workspace, project, owner,
        **{
            "from": FROM,
            "to": TO,
            "compare": "previous_period",
            "compare_from": "2026-09-01",
            "compare_to": "2026-09-10",
        },
    )  # fmt: skip

    assert body["data"][0][OWN]["previous"]["sessions"] == 7
    assert body["meta"]["compare_window"]["from"] == "2026-09-01"


async def test_previous_is_null_when_the_compared_window_is_not_collected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, through="2026-11-12")
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)
    await _row(migrated, workspace, project, integration, "2026-11-11", OWN, "chatgpt", 5)

    # The compared window runs to 2026-11-14, two days past what was collected.
    body = await _ok(
        api, workspace, project, owner,
        **{"from": FROM, "to": TO, "compare_from": "2026-11-11", "compare_to": "2026-11-14"},
    )  # fmt: skip

    assert body["data"][0][OWN]["sessions"] == 10
    assert body["data"][0][OWN]["previous"] is None
    assert body["meta"]["notes"] == [
        *NOTES,
        "The compared window is not fully collected, so no comparison is shown.",
    ]


async def test_a_window_collected_only_in_part_says_up_to_which_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, through="2026-11-05")
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["data"][0][OWN]["sessions"] == 10
    assert body["meta"]["window_collected"] is False
    assert body["meta"]["notes"] == [
        *NOTES,
        "Collected up to 2026-11-05: the days after it are not in these figures.",
    ]


async def test_a_window_that_starts_after_what_was_collected_is_empty_and_says_so(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, through="2026-10-30")
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)

    with statements(resources) as seen:
        body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["data"] == []
    assert body["meta"]["collected_through"] == "2026-10-30"
    assert body["meta"]["window_collected"] is False
    assert body["meta"]["notes"] == [
        *NOTES,
        "Collected up to 2026-10-30, before the start of this window, so nothing is shown for it.",
    ]
    assert len(seen) == SHORT_STATEMENTS, seen


async def test_classifier_own_rules_leaves_the_other_null(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)
    await _row(migrated, workspace, project, integration, FROM, GA4, "chatgpt", 8)
    await _row(migrated, workspace, project, integration, FROM, GA4, "claude", 3)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO, "classifier": OWN})
    other = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO, "classifier": GA4})

    assert [row["key"] for row in body["data"]] == ["chatgpt"]
    assert body["data"][0][GA4] is None
    assert body["data"][0][OWN]["sessions"] == 10
    assert body["data"][0]["difference"] is None
    assert [row["key"] for row in other["data"]] == ["chatgpt", "claude"]
    assert other["data"][0][OWN] is None
    assert other["data"][0][GA4]["sessions"] == 8


async def test_group_by_landing_page_is_not_available(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)

    response = await _get(api, workspace, project, owner, group_by="landing_page")

    assert problem(response) == (422, "not_available")
    assert "landing page" in response.json()["detail"]


async def test_group_by_landing_page_of_a_foreign_project_is_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, owner = await _world(resources, migrated)
    other = await make_workspace(migrated)
    foreign = await make_project(migrated, other.id)

    response = await _get(api, workspace, foreign, owner, group_by="landing_page")

    assert problem(response) == (404, "not_found")


async def test_a_disabled_integration_is_not_connected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, status="disabled")
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["data"] == []
    assert body["meta"]["connected"] is False
    assert body["meta"]["collected_through"] is None
    assert body["meta"]["last_success_at"] is None


async def test_an_integration_that_needs_reauthorising_is_still_connected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, status="reauth_required")
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["meta"]["connected"] is True
    assert body["data"][0][OWN]["sessions"] == 10


async def test_only_current_rows_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)
    await _row(
        migrated, workspace, project, integration, "2026-11-02", OWN, "chatgpt", 500,
        is_current=False,
    )  # fmt: skip
    await _row(
        migrated, workspace, project, integration, "2026-11-02", OWN, "claude", 500,
        is_current=False,
    )  # fmt: skip

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert [row["key"] for row in body["data"]] == ["chatgpt"]
    assert body["data"][0][OWN]["sessions"] == 10
    assert body["meta"]["rules_version"] == 1


async def test_the_default_window_is_the_28_days_ending_today(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)

    body = await _ok(api, workspace, project, owner)

    first = date.fromisoformat(body["meta"]["window"]["from"])
    last = date.fromisoformat(body["meta"]["window"]["to"])
    assert (last - first) == timedelta(days=27)
    assert body["meta"]["compare_window"] is None


async def test_bad_windows_and_values_are_422(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)

    reversed_window = await _get(api, workspace, project, owner, **{"from": TO, "to": FROM})
    too_large = await _get(
        api, workspace, project, owner, **{"from": "2026-01-01", "to": "2026-12-31"}
    )
    half_compare = await _get(api, workspace, project, owner, compare_from=PREVIOUS_FROM)
    bad_classifier = await _get(api, workspace, project, owner, classifier="neither")
    bad_group = await _get(api, workspace, project, owner, group_by="country")

    assert problem(reversed_window) == (422, "validation_failed")
    assert problem(too_large) == (422, "window_too_large")
    assert problem(half_compare) == (422, "validation_failed")
    assert problem(bad_classifier) == (422, "validation_failed")
    assert problem(bad_group) == (422, "validation_failed")


async def test_a_role_without_data_read_is_403_and_a_stranger_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    billing = await member(resources, migrated, workspace, "billing")
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")

    allowed = await _get(api, workspace, project, viewer)
    refused = await _get(api, workspace, project, billing)
    nobody = await _get(api, workspace, project, stranger)
    unauthenticated = await api.get(project_url(workspace, project, "fp", "ai-referrals"))

    assert allowed.status_code == 200, allowed.text
    assert problem(refused) == (403, "forbidden")
    assert problem(nobody) == (404, "not_found")
    assert problem(unauthenticated) == (401, "unauthenticated")
    assert owner.user_id != viewer.user_id


async def test_another_workspace_with_the_same_assistants_never_shows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    other_workspace, other_project, other_owner = await _world(resources, migrated)
    other_project_here = await make_project(migrated, workspace.id)
    integration = await _integration(migrated, workspace, project)
    other_integration = await _integration(migrated, other_workspace, other_project)
    sibling = await _integration(migrated, workspace, other_project_here)
    for code in ("chatgpt", "claude"):
        await _row(migrated, workspace, project, integration, FROM, OWN, code, 10)
        await _row(
            migrated, other_workspace, other_project, other_integration, FROM, OWN, code, 1000
        )
        # Another project of the same workspace.
        await _row(migrated, workspace, other_project_here, sibling, FROM, OWN, code, 5000)

    mine = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})
    theirs = await _ok(api, other_workspace, other_project, other_owner, **{"from": FROM, "to": TO})

    assert {row["key"]: row[OWN]["sessions"] for row in mine["data"]} == {
        "chatgpt": 10,
        "claude": 10,
    }
    assert {row["key"]: row[OWN]["sessions"] for row in theirs["data"]} == {
        "chatgpt": 1000,
        "claude": 1000,
    }


async def test_the_number_of_statements_does_not_depend_on_the_rows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    small_workspace, small, small_owner = await _world(resources, migrated)
    large_workspace, large, large_owner = await _world(resources, migrated)
    small_integration = await _integration(migrated, small_workspace, small)
    large_integration = await _integration(migrated, large_workspace, large)
    await _row(migrated, small_workspace, small, small_integration, FROM, OWN, "chatgpt", 1)
    for code in ("chatgpt", "claude", "gemini", "perplexity", "copilot"):
        for day in range(1, 11):
            for classifier in (OWN, GA4):
                await _row(
                    migrated, large_workspace, large, large_integration, f"2026-11-{day:02d}",
                    classifier, code, day,
                )  # fmt: skip
                await _row(
                    migrated, large_workspace, large, large_integration, f"2026-10-{20 + day:02d}",
                    classifier, code, day,
                )  # fmt: skip
    params = {"from": FROM, "to": TO, "compare": "previous_period"}

    with statements(resources) as one:
        first = await _get(api, small_workspace, small, small_owner, **params)
    with statements(resources) as many:
        second = await _get(api, large_workspace, large, large_owner, **params)

    assert first.status_code == second.status_code == 200, second.text
    assert len(second.json()["data"]) == 5
    assert len(one) == len(many) == READ_STATEMENTS, many
    reads = [s for s in many if "fp.integrations" in s or "fp.ai_referral_daily" in s]
    assert len(reads) == 2, many
    for statement in reads:
        assert "workspace_id" in statement, statement
        assert "project_id" in statement, statement


def _ago(days: int) -> str:
    """The UTC day `days` days before today: the project's day, its time zone being UTC."""
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


async def test_a_window_ending_today_is_collected_when_yesterday_is(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    # A pull ends yesterday, so no window that ends today could have its last day otherwise.
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, through=_ago(1))
    await _row(migrated, workspace, project, integration, _ago(3), OWN, "chatgpt", 4)
    window = {"from": _ago(9), "to": _ago(0)}

    body = await _ok(api, workspace, project, owner, **window)

    assert body["meta"]["window_collected"] is True
    assert body["meta"]["collected_through"] == _ago(1)
    assert body["meta"]["notes"] == NOTES
    assert body["data"][0][OWN]["sessions"] == 4

    # The default window ends today too, and a window with no AI session at all is a zero.
    empty_workspace, empty_project, empty_owner = await _world(resources, migrated)
    await _integration(migrated, empty_workspace, empty_project, through=_ago(1))
    default = await _ok(api, empty_workspace, empty_project, empty_owner)
    assert default["data"] == []
    assert default["meta"]["window_collected"] is True


async def test_a_window_ending_today_is_not_collected_when_yesterday_is_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _integration(migrated, workspace, project, through=_ago(2))

    body = await _ok(api, workspace, project, owner, **{"from": _ago(9), "to": _ago(0)})

    assert body["meta"]["window_collected"] is False
    assert body["meta"]["notes"] == [
        *NOTES,
        f"Collected up to {_ago(2)}: the days after it are not in these figures.",
    ]


async def test_a_window_that_ended_before_today_needs_its_own_last_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    window = {"from": _ago(12), "to": _ago(3)}
    # Through the window's last day (the Pacific date of GA4 can lag the project's by a day, so
    # a day short of it is not enough).
    for through, collected in ((_ago(3), True), (_ago(2), True), (_ago(4), False)):
        workspace, project, owner = await _world(resources, migrated)
        await _integration(migrated, workspace, project, through=through)

        body = await _ok(api, workspace, project, owner, **window)

        assert body["meta"]["window_collected"] is collected, through


async def test_a_window_that_starts_before_the_first_pulled_day_is_not_collected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, since="2026-11-05")
    await _row(migrated, workspace, project, integration, TO, OWN, "chatgpt", 10)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["data"][0][OWN]["sessions"] == 10
    assert body["meta"]["collected_since"] == "2026-11-05"
    assert body["meta"]["window_collected"] is False
    assert body["meta"]["notes"] == [
        *NOTES,
        "The figures start on 2026-11-05: the days of this window before it were not collected.",
    ]


async def test_a_window_that_starts_on_the_first_pulled_day_is_collected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _integration(migrated, workspace, project, since=FROM)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    assert body["meta"]["window_collected"] is True
    assert body["meta"]["notes"] == NOTES


async def test_previous_needs_the_compared_window_to_start_after_the_first_pulled_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    window = {"from": FROM, "to": TO, "compare": "previous_period"}
    # Pulled from the day after the compared window starts: its sums would be too low.
    partial_workspace, partial, partial_owner = await _world(resources, migrated)
    partial_integration = await _integration(
        migrated, partial_workspace, partial, since="2026-10-25"
    )
    await _row(migrated, partial_workspace, partial, partial_integration, FROM, OWN, "chatgpt", 10)
    await _row(
        migrated, partial_workspace, partial, partial_integration, PREVIOUS_TO, OWN, "chatgpt", 4
    )
    # Pulled from the first day of the compared window.
    whole_workspace, whole, whole_owner = await _world(resources, migrated)
    whole_integration = await _integration(migrated, whole_workspace, whole, since=PREVIOUS_FROM)
    await _row(migrated, whole_workspace, whole, whole_integration, FROM, OWN, "chatgpt", 10)
    await _row(migrated, whole_workspace, whole, whole_integration, PREVIOUS_TO, OWN, "chatgpt", 4)

    cut = await _ok(api, partial_workspace, partial, partial_owner, **window)
    full = await _ok(api, whole_workspace, whole, whole_owner, **window)

    assert cut["data"][0][OWN]["sessions"] == 10
    assert cut["data"][0][OWN]["previous"] is None
    assert cut["meta"]["window_collected"] is True
    assert cut["meta"]["notes"] == [
        *NOTES,
        "The compared window is not fully collected, so no comparison is shown.",
    ]
    assert full["data"][0][OWN]["previous"]["sessions"] == 4
    assert full["meta"]["notes"] == NOTES


async def test_a_state_without_a_first_day_cannot_call_a_window_collected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project, since=None)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)
    await _row(migrated, workspace, project, integration, PREVIOUS_TO, OWN, "chatgpt", 4)

    body = await _ok(
        api, workspace, project, owner, **{"from": FROM, "to": TO, "compare": "previous_period"}
    )

    assert body["data"][0][OWN]["sessions"] == 10
    assert body["data"][0][OWN]["previous"] is None
    assert body["meta"]["collected_through"] == TO
    assert body["meta"]["collected_since"] is None
    assert body["meta"]["window_collected"] is False
    assert body["meta"]["notes"] == [
        *NOTES,
        "The first collected day is not recorded for this project, so the window cannot be "
        "called fully collected.",
        "The compared window is not fully collected, so no comparison is shown.",
    ]


async def test_the_rules_version_is_the_one_of_the_window_and_not_of_the_compared_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", 10)
    await _row(
        migrated, workspace, project, integration, PREVIOUS_TO, OWN, "chatgpt", 4, rules_version=2
    )

    body = await _ok(
        api, workspace, project, owner, **{"from": FROM, "to": TO, "compare": "previous_period"}
    )

    assert body["meta"]["rules_version"] == 1
    assert body["data"][0][OWN]["previous"]["sessions"] == 4


async def test_sessions_that_are_all_null_are_null_and_not_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await _integration(migrated, workspace, project)
    # Claude: rows with no count at all. ChatGPT: one row without a count and one with.
    await _row(migrated, workspace, project, integration, FROM, OWN, "claude", None)
    await _row(migrated, workspace, project, integration, FROM, GA4, "claude", 3, engaged=2)
    await _row(migrated, workspace, project, integration, FROM, OWN, "chatgpt", None)
    await _row(migrated, workspace, project, integration, TO, OWN, "chatgpt", 5, engaged=4)

    body = await _ok(api, workspace, project, owner, **{"from": FROM, "to": TO})

    rows = _by_key(body)
    assert rows["claude"][OWN]["sessions"] is None
    assert rows["claude"][OWN]["engaged_sessions"] is None
    assert rows["claude"][GA4]["sessions"] == 3
    assert rows["claude"]["difference"] is None
    assert rows["chatgpt"][OWN]["sessions"] == 5
    assert rows["chatgpt"][OWN]["engaged_sessions"] == 4
