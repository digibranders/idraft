"""What an HTTP status means for a crawled page (plan 08, decisions D1 and D3).

A page that refuses the crawler (401, 403, 429) says nothing about the page: it is unknown, like
a URL that was linked but never fetched. It is not broken. Every other status of 400 or more is
an error of the page itself (404 and 410 are dead pages, 5xx a server fault)."""

from __future__ import annotations

from typing import Final

BLOCKED_STATUSES: Final = frozenset({401, 403, 429})
ERROR_FROM: Final = 400


def is_blocked(status: int | None) -> bool:
    return status in BLOCKED_STATUSES


def is_error(status: int | None) -> bool:
    return status is not None and status >= ERROR_FROM and status not in BLOCKED_STATUSES
