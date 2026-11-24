"""The scheduled report emails.

`claim_due` (a definer function, because the worker has no workspace until it has a schedule)
moves each due schedule to its next slot as it hands it over, so a crash after the claim loses
one send and never repeats it. For each schedule the digest makes a 30-day guest link, emails it
to every recipient and records the outcome. The email holds a link and no numbers: the data is
read, as the guest, when someone opens it.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy import insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.auth.mail import plain_name
from idraft.api.reports.standing import MAKER_REASON, WORKSPACE_REASON, standing_of
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    ai_report_schedules,
    ai_report_shares,
    projects,
)
from idraft.providers.email import EmailMessage, EmailSender, EmailSendError

_log = structlog.get_logger(__name__)
CLAIM_LIMIT: Final = 50
GONE_PROJECT: Final = "the project no longer exists"
LINK_DAYS: Final = 30
ERROR_MAX: Final = 200
_CLAIM = text(
    "SELECT id, workspace_id, project_id, frequency, recipients, created_by "
    "FROM core.ai_report_schedules_claim_due(:now, :limit)"
)


@dataclass(frozen=True, slots=True)
class DigestReport:
    claimed: int
    sent: int
    failed: int


def report_email(*, origin: str, to: str, project_name: str, token: str, days: int) -> EmailMessage:
    name = plain_name(project_name) or "your project"
    return EmailMessage(
        to=to,
        subject=f"AI visibility report for {name}",
        text=(
            "Hello,\n\n"
            f'Your scheduled AI visibility report for "{name}" is ready. It covers the last '
            "28 days: how often the brand is mentioned and cited in AI answers, how it compares "
            "with its competitors and which sites AI answers cite.\n\n"
            f"{origin}/public/reports/{token}\n\n"
            f"The link works for {days} days and needs no sign-in. Anyone who has it can read "
            "the report, so share it with care.\n"
        ),
    )


async def send_due_reports(
    sessions: async_sessionmaker[AsyncSession],
    sender: EmailSender,
    *,
    origin: str,
    now: datetime,
) -> DigestReport:
    async with sessions() as db, db.begin():
        due = (await db.execute(_CLAIM, {"now": now, "limit": CLAIM_LIMIT})).all()
    sent = failed = 0
    for schedule in due:
        try:
            error = await _send_one(
                sessions,
                sender,
                origin=origin,
                now=now,
                workspace_id=schedule.workspace_id,
                project_id=schedule.project_id,
                schedule_id=schedule.id,
                created_by=schedule.created_by,
                recipients=schedule.recipients,
            )
        except Exception:
            # One failure never costs the others their send: the claim already moved them on
            _log.exception("report email failed", schedule_id=str(schedule.id))
            error = await _record_failure(sessions, schedule.workspace_id, schedule.id, now)
        if error is None:
            sent += 1
        else:
            failed += 1
            _log.warning("report email failed", schedule_id=str(schedule.id), reason=error)
    return DigestReport(claimed=len(due), sent=sent, failed=failed)


async def _send_one(
    sessions: async_sessionmaker[AsyncSession],
    sender: EmailSender,
    *,
    origin: str,
    now: datetime,
    workspace_id: UUID,
    project_id: UUID,
    schedule_id: UUID,
    created_by: UUID,
    recipients: list[str],
) -> str | None:
    """None when every recipient was sent to, else the reason (also written on the schedule)."""
    async with workspace_transaction(sessions, workspace_id) as db:
        project = (
            await db.execute(
                select(projects.c.name).where(
                    projects.c.workspace_id == workspace_id,
                    projects.c.id == project_id,
                    projects.c.deleted_at.is_(None),
                )
            )
        ).first()
        if project is None:
            # The project is gone; there is nothing to report on.
            return await _record(db, schedule_id, now, GONE_PROJECT)
        # Mail goes to outside addresses in the name of whoever made the schedule
        standing = await standing_of(db, workspace_id, created_by)
        if standing != "ok":
            return await _record(
                db, schedule_id, now, WORKSPACE_REASON if standing == "workspace" else MAKER_REASON
            )
        token = secrets.token_urlsafe(32)
        await db.execute(
            insert(ai_report_shares).values(
                workspace_id=workspace_id,
                project_id=project_id,
                token_hash=hashlib.sha256(token.encode("utf-8")).digest(),
                created_by=created_by,
                created_at=now,
                expires_at=now + timedelta(days=LINK_DAYS),
            )
        )
    failures = 0
    for address in recipients:
        try:
            await sender.send(
                report_email(
                    origin=origin,
                    to=address,
                    project_name=project.name,
                    token=token,
                    days=LINK_DAYS,
                )
            )
        except (EmailSendError, ValueError):
            failures += 1
    reason = None if failures == 0 else f"{failures} of {len(recipients)} emails were not sent"
    async with workspace_transaction(sessions, workspace_id) as db:
        return await _record(db, schedule_id, now, reason, delivered=failures < len(recipients))


async def _record_failure(
    sessions: async_sessionmaker[AsyncSession],
    workspace_id: UUID,
    schedule_id: UUID,
    now: datetime,
) -> str:
    """Says an unexpected error stopped the send; the reason never carries the error's text."""
    reason = "the report could not be sent"
    try:
        async with workspace_transaction(sessions, workspace_id) as db:
            await _record(db, schedule_id, now, reason)
    except Exception:
        _log.exception("report email failure not recorded", schedule_id=str(schedule_id))
    return reason


async def _record(
    db: AsyncSession,
    schedule_id: UUID,
    now: datetime,
    reason: str | None,
    *,
    delivered: bool = False,
) -> str | None:
    """Notes the outcome. `delivered`: someone got the email even though `reason` is set."""
    await db.execute(
        update(ai_report_schedules)
        .where(ai_report_schedules.c.id == schedule_id)
        .values(
            last_error=None if reason is None else reason[:ERROR_MAX],
            last_sent_at=now if reason is None or delivered else ai_report_schedules.c.last_sent_at,
        )
    )
    return reason
