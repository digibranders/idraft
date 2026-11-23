"""The status filters of the Pages and Links lists (plan 08 task 3).

A status class is a range of codes, except that the pages that refused the crawler (401, 403,
429) are their own class, `blocked`, and no longer part of `4xx`: they are unknown, not broken."""

from __future__ import annotations

from typing import Final

from sqlalchemy import ColumnElement, and_, or_

from idraft.crawl.status import BLOCKED_STATUSES

_RANGES: Final = {"2xx": (200, 299), "3xx": (300, 399), "4xx": (400, 499), "5xx": (500, 599)}


def status_condition(status: ColumnElement[int], name: str) -> ColumnElement[bool]:
    if name == "blocked":
        return status.in_(BLOCKED_STATUSES)
    low, high = _RANGES[name]
    return and_(status.between(low, high), status.not_in(BLOCKED_STATUSES))


def status_classes(status: ColumnElement[int], names: tuple[str, ...]) -> ColumnElement[bool]:
    return or_(*(status_condition(status, name) for name in names))
