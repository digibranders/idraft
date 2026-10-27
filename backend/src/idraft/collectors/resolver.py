"""Resolving submissions of unknown outcome by asking the provider (docs/21-scheduler-workers.md
section 6, plan decision D7, review log F36).

A task is `submit_unknown` when its submission may have reached the provider and the answer was
lost. Sending it again could pay twice; never sending it again loses the check. So the provider
is asked which tasks it holds from around the submission, and the task's tag decides: found, it
becomes `submitted` with the provider's id and the cost it reports; not found once the whole
period the provider could have taken it in has been listed, the retry policy for a call that
timed out decides (sent again after a wait, and ended once its attempts are used up).

Not finding a tag is proof of absence only when every task listed in the period carries a tag:
a listing without one may be ours, and then nothing in that look is sent again.

Submissions made within a minute of each other are looked for together. A look is made only
once the latest of them is `UNKNOWN_GRACE` old: the listing then covers every moment their calls
could have reached the provider (a handler stops within 8 minutes), and one look decides every
task in it.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ledger import Cost, UnknownSubmission
from idraft.collectors.registry import Registry, answers_live
from idraft.domain.retries import ProviderErrorKind, decide
from idraft.providers.contract import SubmittedTask

# How long after a submission began its tasks are looked for (docs/21 section 6).
UNKNOWN_GRACE: Final = timedelta(minutes=15)
# How far before the submission the listing starts: the provider's clock may run behind ours.
LOOK_BEFORE: Final = timedelta(minutes=1)
# Submissions this close together are looked for in one listing.
TOGETHER_WITHIN: Final = timedelta(minutes=1)
# Looks in one pass, and the time a pass may spend on them. Each look is a call under the
# provider's own limit (DataForSEO `id_list`: 10 a minute); the rest wait for the next pass.
LOOKS_PER_PASS: Final = 10
RESOLVE_FOR: Final = timedelta(minutes=2)
_TASKS_PER_PASS: Final = 2_000
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ResolveReport:
    resolved: int = 0
    resubmitted: int = 0
    # Looks whose provider could not be asked, or whose listing could not decide.
    failed: int = 0
    undecided: int = 0


@dataclass(frozen=True, slots=True)
class _Look:
    provider_code: str
    provider_endpoint: str
    tasks: tuple[UnknownSubmission, ...]

    @property
    def since(self) -> datetime:
        return min(task.submitted_at for task in self.tasks) - LOOK_BEFORE

    @property
    def until(self) -> datetime:
        return max(task.submitted_at for task in self.tasks) + UNKNOWN_GRACE


def _looks(unknown: Sequence[UnknownSubmission]) -> list[_Look]:
    """The submissions grouped by provider and endpoint, and by time: each group is one
    listing."""
    ordered = sorted(
        unknown, key=lambda task: (task.provider_code, task.provider_endpoint, task.submitted_at)
    )
    looks: list[_Look] = []
    group: list[UnknownSubmission] = []
    for task in ordered:
        if group and (
            (task.provider_code, task.provider_endpoint)
            != (group[0].provider_code, group[0].provider_endpoint)
            or task.submitted_at - group[0].submitted_at > TOGETHER_WITHIN
        ):
            looks.append(_Look(group[0].provider_code, group[0].provider_endpoint, tuple(group)))
            group = []
        group.append(task)
    if group:
        looks.append(_Look(group[0].provider_code, group[0].provider_endpoint, tuple(group)))
    return looks


async def resolve_unknown(
    sessions: async_sessionmaker[AsyncSession],
    registry: Registry,
    *,
    now: datetime,
    jitter: Callable[[], float] = random.random,
    ask_provider: bool = True,
) -> ResolveReport:
    """One pass over the oldest unresolved submissions. Live calls are settled without asking
    the provider; task submissions are looked for only with `ask_provider`."""
    async with sessions() as db:
        unknown = await ledger.unknown_submissions(
            db, submitted_before=now - UNKNOWN_GRACE, limit=_TASKS_PER_PASS
        )
    resolved = resubmitted = failed = undecided = looked = 0
    deadline = time.monotonic() + RESOLVE_FOR.total_seconds()
    for look in _looks(unknown):
        if looked == LOOKS_PER_PASS or time.monotonic() >= deadline:
            break
        code, endpoint = look.provider_code, look.provider_endpoint
        if code in registry.providers and answers_live(registry.provider(code), endpoint):
            # A live call that lost its answer left nothing to find later (plan decision D6):
            # its tasks are sent again, under the policy for a call that timed out.
            resubmitted += await _send_again(sessions, look.tasks, now=now, jitter=jitter)
            continue
        if (
            not ask_provider
            or code not in registry.providers
            or not registry.provider(code).lists_submissions
        ):
            # Such a task keeps the path it had: ended once the provider's results would have
            # expired, and charged its estimate.
            continue
        looked += 1
        try:
            listed = await registry.provider(code).find_submitted(endpoint, look.since, look.until)
        except Exception as error:
            _log.warning("submissions not listed", provider=code, endpoint=endpoint, exc_info=error)
            failed += 1
            continue
        found, lost, decided = await _settle(sessions, look.tasks, listed, now=now, jitter=jitter)
        resolved += found
        resubmitted += lost
        if not decided:
            undecided += 1
    return ResolveReport(
        resolved=resolved, resubmitted=resubmitted, failed=failed, undecided=undecided
    )


async def _send_again(
    sessions: async_sessionmaker[AsyncSession],
    tasks: Sequence[UnknownSubmission],
    *,
    now: datetime,
    jitter: Callable[[], float],
) -> int:
    sent = 0
    for task in tasks:
        async with sessions() as db, db.begin():
            decision = decide(
                ProviderErrorKind.TIMEOUT,
                attempts=max(task.attempts, 1),
                jitter=jitter(),
                window_open=now < task.window_end,
            )
            sent += await ledger.submit_again(
                db, task.ref, attempt=task.attempts, decision=decision, now=now
            )
    return sent


async def _settle(
    sessions: async_sessionmaker[AsyncSession],
    tasks: Sequence[UnknownSubmission],
    listed: Sequence[SubmittedTask],
    *,
    now: datetime,
    jitter: Callable[[], float],
) -> tuple[int, int, bool]:
    """Record what the listing says. Returns the tasks found, those sent again, and whether
    the listing could say what is absent."""
    by_tag: dict[tuple[int, UUID, int], SubmittedTask] = {}
    untagged = 0
    for listing in listed:
        echo = listing.echo
        if not listing.tagged:
            untagged += 1
        if echo.task_id is not None and echo.run_id is not None and echo.attempt is not None:
            by_tag[(int(echo.task_id), echo.run_id, echo.attempt)] = listing
    decides_absence = untagged == 0
    if not decides_absence:
        _log.error(
            "tasks listed without a tag: unknown submissions are not sent again",
            untagged=untagged,
            tasks=len(tasks),
        )
    found = lost = 0
    for task in tasks:
        match = by_tag.get((task.ref.id, task.run_id, task.attempts))
        if match is None and not decides_absence:
            continue
        async with sessions() as db, db.begin():
            if match is None:
                decision = decide(
                    ProviderErrorKind.TIMEOUT,
                    attempts=max(task.attempts, 1),
                    jitter=jitter(),
                    window_open=now < task.window_end,
                )
                lost += await ledger.submit_again(
                    db, task.ref, attempt=task.attempts, decision=decision, now=now
                )
                continue
            cost = (
                None
                if match.cost_usd is None
                else Cost(usd=match.cost_usd, source="provider_reported")
            )
            # Charged to when it was sent, not to when it was found: a month's budget ends at
            # midnight.
            recorded = await ledger.mark_submitted(
                db,
                task.ref,
                provider_task_id=match.provider_task_id,
                cost=cost,
                now=task.submitted_at,
                attempt=task.attempts,
            )
        if recorded:
            found += 1
            posted_after = (
                None
                if match.posted_at is None
                else (match.posted_at - task.submitted_at).total_seconds()
            )
            # How long after we began the provider says it took the task: the margin the
            # listing's window relies on.
            _log.info(
                "unknown submission found",
                task_id=task.ref.id,
                provider_task_id=match.provider_task_id,
                posted_after_seconds=posted_after,
            )
    return found, lost, decides_absence
