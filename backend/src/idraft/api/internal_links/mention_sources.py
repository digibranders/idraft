"""Where a mention's target is judged when the database cannot (spec 9.8.1). The Issues catalogue
belongs to the Issues session and is not on this branch, so it is a seam: when that session lands
it passes a class that reads its catalogue, and nothing else changes."""

from __future__ import annotations

from collections.abc import Collection
from typing import Protocol


class IssueChecks(Protocol):
    async def known(self, check_ids: Collection[str]) -> frozenset[str] | None:
        """The ids among `check_ids` that are real checks, or None without an Issues catalogue."""


class NoIssueChecks:
    async def known(self, check_ids: Collection[str]) -> frozenset[str] | None:
        return None
