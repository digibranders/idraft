"""Keyset cursors (docs/19 section 2.4): opaque, and only valid for the filters and sort that made
them."""

from __future__ import annotations

import base64
import json

import pytest

from idraft.api.pagination import decode_cursor, encode_cursor
from idraft.api.problems import BadRequestError

SCOPE = {"sort": "name", "filter[entity_type]": "brand"}


def test_a_cursor_gives_back_its_key() -> None:
    cursor = encode_cursor(["hubspot", "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11", 3], scope=SCOPE)
    assert decode_cursor(cursor, scope=SCOPE) == [
        "hubspot",
        "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
        3,
    ]


def test_a_cursor_is_url_safe_and_has_no_padding() -> None:
    cursor = encode_cursor(["?&/+="], scope=SCOPE)
    assert "=" not in cursor
    assert set(cursor) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def test_a_cursor_does_not_follow_other_filters() -> None:
    cursor = encode_cursor(["hubspot"], scope=SCOPE)
    with pytest.raises(BadRequestError) as caught:
        decode_cursor(cursor, scope={**SCOPE, "filter[entity_type]": "product"})
    assert caught.value.problem_code == "invalid_cursor"


def _raw(payload: object) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "not base64 !",
        "e30",  # {}
        _raw([1, 2]),
        _raw({"k": "x", "s": "0" * 16}),
        _raw({"k": [{"a": 1}], "s": "0" * 16}),
        _raw({"k": ["x"]}),
        base64.urlsafe_b64encode(b"\xff\xfe").decode().rstrip("="),
    ],
)
def test_a_cursor_that_was_not_made_here_is_refused(cursor: str) -> None:
    with pytest.raises(BadRequestError) as caught:
        decode_cursor(cursor, scope=SCOPE)
    assert (caught.value.status, caught.value.problem_code) == (400, "invalid_cursor")
