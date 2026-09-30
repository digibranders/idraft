"""What S-01 keeps as fixtures: the shape of the answers, and nothing about the account or
anyone else's tasks. No network."""

from __future__ import annotations

from spikes.s01_billing_and_tags import _only_this_run, _scrub_account
from tests.providers.dataforseo.support import fixture


def test_the_account_is_kept_as_a_shape_with_no_login_and_no_money() -> None:
    body = _scrub_account(fixture("user_data"))

    (account,) = body["tasks"][0]["result"]
    assert account["login"] == "owner@example.com"
    assert account["money"]["balance"] == 1
    assert account["money"]["statistics"]["day"] == {"total": 1, "serp": 1}
    # Limits on calls are not money, and are kept.
    assert account["rates"]["limits"]["minute"]["total"] == 2000


def test_only_this_runs_ready_tasks_are_kept() -> None:
    body = fixture("tasks_ready")
    ours = dict(body["tasks"][0]["result"][0], tag="i:spike:t:z:a:1:r:" + "0" * 32)
    body["tasks"][0]["result"] = [ours, *body["tasks"][0]["result"]]

    kept = _only_this_run(body)

    assert [item["tag"] for item in kept["tasks"][0]["result"]] == [ours["tag"]]
    assert kept["tasks"][0]["result_count"] == 1
