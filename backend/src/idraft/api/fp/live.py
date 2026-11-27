"""Search Console asked from a request, for one page (spec decision D5). The budget is this
process's own and is never waited on: with no token left the request is refused as busy.

The access token is made from the stored refresh token on the first call and kept on the object,
so it lives as long as one request does. Nothing here logs a token, a query text or a response
body.

shortcut: one budget per API process. With several processes each has its own; move the buckets
to Redis together with the worker's (`collectors/gsc_limits.py`) before the totals near Google's
1,200 calls a minute per property.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Final, Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.integrations.service import unavailable_problem
from idraft.api.problems import ProblemError
from idraft.api.resources import Resources
from idraft.collectors.gsc_limits import Budgets, GscLimiter
from idraft.collectors.gsc_store import IntegrationFacts
from idraft.db.engine import workspace_transaction
from idraft.providers.google.client import AnalyticsRow, Dimension, DimensionFilter, GoogleClient
from idraft.providers.google.errors import (
    GoogleError,
    GoogleInvalidGrantError,
    GooglePermissionError,
    GoogleQuotaError,
    GoogleUnauthorizedError,
)
from idraft.vault import store as vault
from idraft.vault.envelope import EnvelopeCipher, SecretUnreadableError

API_BUDGETS: Final = Budgets(
    project_per_minute=2_000.0, user_per_minute=120.0, site_per_minute=60.0
)
API_LIMITER: Final = GscLimiter(API_BUDGETS)
QUOTA_RETRY_SECONDS: Final = 60
# A query read asks for up to 25,000 rows, about 3.75 MB (spec D21 and R8): more than the 10
# seconds the application's HTTP client allows.
QUERY_TIMEOUT_SECONDS: Final = 30.0


class GscBusyError(ProblemError):
    """429 `gsc_busy`: this process's budget or Google's quota. Carries `retry_after_seconds`
    (the extension the other 429 problems carry) and the `Retry-After` header."""

    status, code, title = 429, "gsc_busy", "Search Console is busy"

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            "Search Console is busy. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
            retry_after_seconds=retry_after,
        )
        self.retry_after = retry_after


class LiveStateError(Exception):
    """Google refused the token or the property: the caller answers stored rows with this state."""

    def __init__(self, state: Literal["reauth_required", "no_access"]) -> None:
        super().__init__(state)
        self.state = state


@dataclass(slots=True)
class LiveGoogle:
    sessions: async_sessionmaker[AsyncSession]
    google: GoogleClient
    cipher: EnvelopeCipher
    facts: IntegrationFacts
    limiter: GscLimiter = API_LIMITER
    _access: str | None = field(default=None, init=False, repr=False)

    async def _new_access_token(self) -> str:
        facts = self.facts
        if facts.credential_ref is None:
            raise LiveStateError("reauth_required")
        async with workspace_transaction(self.sessions, facts.workspace_id) as db:
            refresh_token = await vault.read(
                db,
                self.cipher,
                workspace_id=facts.workspace_id,
                secret_id=facts.credential_ref,
                kind=vault.REFRESH_TOKEN,
            )
        return (await self.google.refresh(refresh_token)).access_token

    async def query(
        self,
        *,
        start: date,
        end: date,
        dimensions: Sequence[Dimension],
        filters: Sequence[DimensionFilter],
        row_limit: int,
    ) -> list[AnalyticsRow]:
        """One call for final data. A 401 gets one new access token and one more try."""
        facts = self.facts
        try:
            for renew in (False, True):
                wait = self.limiter.try_acquire(user=facts.account, site=facts.site_url)
                if wait > 0.0:
                    raise GscBusyError(max(1, math.ceil(wait)))
                if self._access is None or renew:
                    self._access = await self._new_access_token()
                try:
                    return await self.google.search_analytics(
                        self._access,
                        facts.site_url,
                        start_date=start,
                        end_date=end,
                        dimensions=dimensions,
                        data_state="final",
                        aggregation="auto",
                        filters=filters,
                        row_limit=row_limit,
                        timeout_seconds=QUERY_TIMEOUT_SECONDS,
                    )
                except GoogleUnauthorizedError:
                    if renew:
                        raise
            raise AssertionError("unreachable")  # pragma: no cover
        except GoogleQuotaError:
            self.limiter.quota_exceeded(site=facts.site_url)
            raise GscBusyError(QUOTA_RETRY_SECONDS) from None
        except (GoogleInvalidGrantError, SecretUnreadableError):
            raise LiveStateError("reauth_required") from None
        except GooglePermissionError:
            raise LiveStateError("no_access") from None
        except GoogleError as error:
            raise unavailable_problem(error) from None


def live_google(resources: Resources, facts: IntegrationFacts) -> LiveGoogle | None:
    """None where this installation has no Google client or encryption key."""
    settings = resources.settings
    if (
        settings.google_oauth_client_id is None
        or settings.google_oauth_client_secret is None
        or settings.secrets_encryption_key is None
    ):
        return None
    return LiveGoogle(
        sessions=resources.sessions,
        google=GoogleClient(
            resources.http,
            client_id=settings.google_oauth_client_id.get_secret_value(),
            client_secret=settings.google_oauth_client_secret.get_secret_value(),
            attempts=1,  # a retry would hold the request and spend uncounted budget
        ),
        cipher=EnvelopeCipher({1: settings.secrets_key}),
        facts=facts,
    )
