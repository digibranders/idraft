"""Where a mention's target is judged when the database cannot (spec 9.8.1). The Issues catalogue
is the source for `issue` mentions; a service built without one refuses them."""

from __future__ import annotations

from collections.abc import Collection
from typing import Protocol

from idraft.api.issues.catalogue import BY_ID


class IssueChecks(Protocol):
    async def known(self, check_ids: Collection[str]) -> frozenset[str] | None:
        """The ids among `check_ids` that are real checks, or None without an Issues catalogue."""


class NoIssueChecks:
    async def known(self, check_ids: Collection[str]) -> frozenset[str] | None:
        return None


class CatalogueIssueChecks:
    """The checks of the Issues catalogue: a note may mention any check the Issues page lists."""

    async def known(self, check_ids: Collection[str]) -> frozenset[str] | None:
        return frozenset(check_ids) & BY_ID.keys()
