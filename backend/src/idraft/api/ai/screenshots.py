"""The screenshot of an AI answer as the API serves it: the lookups under the caller's
row-level-security session, the ledger that records a capture, and the bounds of what a failed
capture means for the caller. The capture itself is `idraft.screenshots.service`."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import observation_repository as repository
from idraft.api.problems import (
    NoScreenshotError,
    NotFoundError,
    ScreenshotExpiredError,
    ScreenshotFailedError,
    ScreenshotsUnavailableError,
    ScreenshotUnsupportedError,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import ai_observation_screenshots, provider_cost_events
from idraft.providers.contract import ProviderCallError
from idraft.screenshots.service import (
    CaptureOutcome,
    Download,
    ExpiredError,
    ObservationRef,
    Provider,
    UnsupportedEngineError,
    capture_screenshot,
)
from idraft.storage.raw import ObjectStore, RawStorageError
from idraft.storage.screenshots import get_screenshot

_S = ai_observation_screenshots.c
_log = structlog.get_logger(__name__)


def screenshot_path(workspace_id: UUID, project_id: UUID, observation_id: int) -> str:
    """The API path of an answer's image, as the summary and the capture answer give it."""
    return (
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}"
        f"/ai/observations/{observation_id}/screenshot"
    )


class SqlLedger:
    """The `Ledger` of one caller: the screenshot row and its cost event, in one transaction."""

    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], access: WorkspaceAccess, project_id: UUID
    ) -> None:
        self._sessions = sessions
        self._access = access
        self._project_id = project_id

    def _transaction(self) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions, self._access.workspace_id, user_id=self._access.user_id
        )

    async def existing_key(self, observation_id: int) -> str | None:
        async with self._transaction() as db:
            return await stored_key(db, self._access.workspace_id, self._project_id, observation_id)

    async def record(self, row: dict[str, object], cost: dict[str, object]) -> None:
        async with self._transaction() as db:
            # A second capture that raced this one has been paid for too: its cost stays, and
            # the first screenshot row stays the one served.
            await db.execute(
                insert(ai_observation_screenshots).values(**row).on_conflict_do_nothing()
            )
            await db.execute(insert(provider_cost_events).values(**cost))


async def stored_key(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, observation_id: int
) -> str | None:
    found: str | None = await db.scalar(
        select(_S.storage_key).where(
            _S.workspace_id == workspace_id,
            _S.project_id == project_id,
            _S.observation_id == observation_id,
        )
    )
    return found


class ScreenshotService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        store: ObjectStore | None,
        provider: Provider | None,
        download: Download,
    ) -> None:
        self._sessions = sessions
        self._store = store
        self._provider = provider
        self._download = download

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def _observation(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> Any:
        row = await repository.get_observation(
            db, access.workspace_id, project_id, observation_id, observed_at
        )
        if row is None:
            raise NotFoundError
        return row

    async def capture(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> CaptureOutcome:
        if self._provider is None or self._store is None:
            raise ScreenshotsUnavailableError("This installation cannot capture screenshots.")
        async with self._transaction(access) as db:
            row = await self._observation(db, access, project_id, observation_id, observed_at)
        if row.provider_task_id is None:
            raise ScreenshotUnsupportedError("This answer has no provider task to photograph.")
        ref = ObservationRef(
            observation_id=row.id,
            observed_at=row.observed_at,
            workspace_id=access.workspace_id,
            project_id=project_id,
            engine_code=row.engine_code,
            provider_task_id=row.provider_task_id,
        )
        try:
            return await capture_screenshot(
                ref,
                provider=self._provider,
                download=self._download,
                store=self._store,
                ledger=SqlLedger(self._sessions, access, project_id),
                now=datetime.now(UTC),
                captured_by=access.user_id,
            )
        except ExpiredError:
            raise ScreenshotExpiredError(
                "The answer is older than the provider's 7 days."
            ) from None
        except UnsupportedEngineError:
            raise ScreenshotUnsupportedError(
                "This engine has no platform page to photograph."
            ) from None
        except (ProviderCallError, httpx.HTTPError, RawStorageError, ValueError) as error:
            # ValueError covers an unreadable provider answer, a download that is not an image or
            # too large, and a blank or unreadable capture.
            _log.warning("screenshot capture failed", error_kind=type(error).__name__)
            raise ScreenshotFailedError(
                "The screenshot could not be captured. Try again."
            ) from None

    async def image(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> bytes:
        async with self._transaction(access) as db:
            await self._observation(db, access, project_id, observation_id, observed_at)
            key = await stored_key(db, access.workspace_id, project_id, observation_id)
        if key is None:
            raise NoScreenshotError("No screenshot was captured for this answer.")
        if self._store is None:
            raise ScreenshotsUnavailableError("This installation cannot read screenshots.")
        try:
            return await get_screenshot(self._store, key)
        except (RawStorageError, KeyError):
            raise ScreenshotFailedError("The screenshot could not be read. Try again.") from None
