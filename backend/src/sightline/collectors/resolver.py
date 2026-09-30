"""Resolving submissions of unknown outcome by asking the provider (docs/21-scheduler-workers.md
section 6, plan decision D7, review log F36).

A task is `submit_unknown` when its submission may have reached the provider and the answer was
lost. Sending it again could pay twice; never sending it again loses the check. So the provider
is asked which tasks it holds from around the submission, and the task's tag decides: found, it
becomes `submitted` with the provider's id and the cost it reports; not found once the whole
period the provider could have taken it in has been listed, it goes back to `pending`.

The tasks of one submission share its time, so one look covers a batch. A batch is looked for
only once it is `UNKNOWN_GRACE` old: the listing then covers every moment the call could have
reached the provider (a handler stops within 8 minutes), and one look decides every task in it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import groupby
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import Cost, UnknownSubmission
from sightline.collectors.registry import Registry
from sightline.providers.contract import SubmittedTask

# How long after a submission began its tasks are looked for (docs/21 section 6).
UNKNOWN_GRACE: Final = timedelta(minutes=15)
# How far before the submission the listing starts: the provider's clock may run behind ours.
LOOK_BEFORE: Final = timedelta(minutes=1)
# Batches looked for in one pass. Each look is a call under the provider's own limit
# (DataForSEO `id_list`: 10 a minute); the rest wait for the next pass.
BATCHES_PER_PASS: Final = 10
_TASKS_PER_PASS: Final = 2_000
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ResolveReport:
    resolved: int = 0
    resubmitted: int = 0
    # Batches whose provider could not be asked this time.
    failed: int = 0


def _key(task: UnknownSubmission) -> tuple[str, str, datetime]:
    return (task.provider_code, task.provider_endpoint, task.submitted_at)


async def resolve_unknown(
    sessions: async_sessionmaker[AsyncSession], registry: Registry, *, now: datetime
) -> ResolveReport:
    """One pass over the oldest unresolved submissions."""
    async with sessions() as db:
        unknown = await ledger.unknown_submissions(
            db, submitted_before=now - UNKNOWN_GRACE, limit=_TASKS_PER_PASS
        )
    resolved = resubmitted = failed = looked = 0
    for (code, endpoint, submitted_at), batch in groupby(sorted(unknown, key=_key), key=_key):
        if looked == BATCHES_PER_PASS:
            break
        if code not in registry.providers or not registry.provider(code).lists_submissions:
            # Such a task keeps the path it had: ended once the provider's results would have
            # expired, and charged its estimate.
            continue
        looked += 1
        tasks = list(batch)
        try:
            listed = await registry.provider(code).find_submitted(
                endpoint, submitted_at - LOOK_BEFORE, submitted_at + UNKNOWN_GRACE
            )
        except Exception as error:
            _log.warning("submissions not listed", provider=code, endpoint=endpoint, exc_info=error)
            failed += 1
            continue
        found, lost = await _settle(sessions, tasks, listed, now=now)
        resolved += found
        resubmitted += lost
    return ResolveReport(resolved=resolved, resubmitted=resubmitted, failed=failed)


async def _settle(
    sessions: async_sessionmaker[AsyncSession],
    tasks: Sequence[UnknownSubmission],
    listed: Sequence[SubmittedTask],
    *,
    now: datetime,
) -> tuple[int, int]:
    by_tag: dict[tuple[int, UUID, int], SubmittedTask] = {}
    for listing in listed:
        echo = listing.echo
        if echo.task_id is not None and echo.run_id is not None and echo.attempt is not None:
            by_tag[(int(echo.task_id), echo.run_id, echo.attempt)] = listing
    found = lost = 0
    for task in tasks:
        match = by_tag.get((task.ref.id, task.run_id, task.attempts))
        async with sessions() as db, db.begin():
            if match is None:
                lost += await ledger.submit_again(db, task.ref, attempt=task.attempts)
                continue
            cost = (
                None
                if match.cost_usd is None
                else Cost(usd=match.cost_usd, source="provider_reported")
            )
            found += await ledger.mark_submitted(
                db,
                task.ref,
                provider_task_id=match.provider_task_id,
                cost=cost,
                now=now,
                attempt=task.attempts,
            )
    return found, lost
