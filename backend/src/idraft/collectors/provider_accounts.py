"""What the provider says about the account, and whether it agrees with our books
(docs/06-dataforseo-seo-integration.md section 6.1; docs/21-scheduler-workers.md section 10;
rank collection plan Task 10, decision R11).

`check_balance` runs every fifteen minutes. It reads the balance and the day's spend so far from
`appendix/user_data`, works out how many days the balance lasts at the trailing seven-day spend
(`ops.cost_daily`, as rule 24 of doc 25 does), and logs a warning under 14 days and an error
under 5. The reading is kept in Redis for the balance route and for the reconcile below.

`user_data` gives only the spend of the day it is asked on, so the day's total is the last
reading taken that day. `reconcile_costs` runs after midnight, takes the last reading of the
day before, and compares it with the cost events written up to the moment of that reading. The
difference is reported, not booked: refunds, add-ons and the asynchronous AI Overview surcharge
make the two differ, and a person looks at the day before any row is adjusted. Reading and
reconciling are safe to repeat: each writes over its own key.

The account's day is taken to be the UTC day (DataForSEO accounts default to UTC).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Final, Literal, Protocol

import structlog
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.db.tables import cost_daily, provider_cost_events
from idraft.providers.dataforseo.provider import AccountState

TRAILING_DAYS: Final = 7
WARNING_DAYS: Final = Decimal(14)
CRITICAL_DAYS: Final = Decimal(5)
# A difference under this is rounding and the provider's own timing, not a finding.
TOLERANCE_USD: Final = Decimal("0.10")
TOLERANCE_SHARE: Final = Decimal("0.05")
# How long a reading is kept: a balance is read again within the quarter hour; the day's spend
# and the report on it outlive the next midnight and the days after.
BALANCE_TTL: Final = timedelta(hours=2)
SPEND_TTL: Final = timedelta(days=3)
REPORT_TTL: Final = timedelta(days=35)

Severity = Literal["ok", "warning", "critical"]
_log = structlog.get_logger(__name__)


class AccountSource(Protocol):
    async def account_state(self) -> AccountState: ...


def _encode(value: object) -> str:
    """JSON for what is kept in Redis: dates and times in ISO form, money as text."""
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"{type(value).__name__} is not kept in Redis")


def balance_key(provider_code: str) -> str:
    return f"provider:balance:{provider_code}"


def spend_key(provider_code: str, day: date) -> str:
    return f"provider:spend:{provider_code}:{day.isoformat()}"


def reconciliation_key(provider_code: str, day: date) -> str:
    return f"provider:reconcile:{provider_code}:{day.isoformat()}"


@dataclass(frozen=True, slots=True)
class BalanceReport:
    balance_usd: Decimal
    trailing_spend_usd: Decimal
    # Spent a day on average over the trailing days; None when nothing was spent.
    daily_average_usd: Decimal | None
    # None when nothing was spent: the balance does not run down.
    days_remaining: Decimal | None
    severity: Severity
    checked_at: datetime


@dataclass(frozen=True, slots=True)
class CostReconciliation:
    day: date
    provider_spend_usd: Decimal
    our_cost_usd: Decimal
    # The provider's spend less ours: positive when we recorded less than was charged.
    difference_usd: Decimal
    read_at: datetime
    flagged: bool


def severity_for(days_remaining: Decimal | None) -> Severity:
    if days_remaining is None:
        return "ok"
    if days_remaining < CRITICAL_DAYS:
        return "critical"
    if days_remaining < WARNING_DAYS:
        return "warning"
    return "ok"


async def _trailing_spend(
    sessions: async_sessionmaker[AsyncSession], provider_code: str, *, today: date
) -> Decimal:
    """What the provider cost on the `TRAILING_DAYS` whole days before today."""
    c = cost_daily.c
    async with sessions() as db:
        total: Decimal = (
            await db.execute(
                select(func.coalesce(func.sum(c.cost_usd), 0)).where(
                    c.provider_code == provider_code,
                    c.cost_date >= today - timedelta(days=TRAILING_DAYS),
                    c.cost_date < today,
                )
            )
        ).scalar_one()
    return Decimal(total)


async def check_balance(
    sessions: async_sessionmaker[AsyncSession],
    redis: Redis,
    source: AccountSource,
    *,
    provider_code: str,
    now: datetime,
) -> BalanceReport:
    """Read the account, keep what it says, and say how long the balance lasts."""
    if now.tzinfo is None:
        raise ValueError("`now` must be an aware datetime")
    state = await source.account_state()
    today = now.astimezone(UTC).date()
    spent = await _trailing_spend(sessions, provider_code, today=today)
    average = spent / TRAILING_DAYS if spent > 0 else None
    days_remaining = None if average is None else state.balance_usd / average
    report = BalanceReport(
        balance_usd=state.balance_usd,
        trailing_spend_usd=spent,
        daily_average_usd=average,
        days_remaining=days_remaining,
        severity=severity_for(days_remaining),
        checked_at=now,
    )
    await redis.set(
        balance_key(provider_code),
        json.dumps(asdict(report), default=_encode),
        ex=int(BALANCE_TTL.total_seconds()),
    )
    if state.spent_today_usd is not None:
        reading = {"spent_usd": str(state.spent_today_usd), "read_at": now.isoformat()}
        await redis.set(
            spend_key(provider_code, today), json.dumps(reading), ex=int(SPEND_TTL.total_seconds())
        )
    if report.severity != "ok":
        log = _log.error if report.severity == "critical" else _log.warning
        log(
            "provider balance is running low",
            provider=provider_code,
            balance_usd=str(report.balance_usd),
            days_remaining=str(days_remaining),
            severity=report.severity,
        )
    return report


async def reconcile_costs(
    sessions: async_sessionmaker[AsyncSession],
    redis: Redis,
    *,
    provider_code: str,
    day: date,
) -> CostReconciliation | None:
    """Compare the provider's spend on `day` (the last reading taken that day) with the cost
    events up to that reading. None when no reading was taken that day."""
    raw = await redis.get(spend_key(provider_code, day))
    if raw is None:
        _log.warning("no spend reading to reconcile", provider=provider_code, day=day.isoformat())
        return None
    reading = json.loads(raw)
    provider_spend = Decimal(reading["spent_usd"])
    read_at = datetime.fromisoformat(reading["read_at"])
    start = datetime.combine(day, time(), tzinfo=UTC)
    e = provider_cost_events.c
    async with sessions() as db:
        ours = Decimal(
            (
                await db.execute(
                    select(func.coalesce(func.sum(e.cost_usd), 0)).where(
                        e.provider_code == provider_code,
                        e.occurred_at >= start,
                        e.occurred_at < min(read_at, start + timedelta(days=1)),
                    )
                )
            ).scalar_one()
        )
    difference = provider_spend - ours
    allowed = max(TOLERANCE_USD, TOLERANCE_SHARE * provider_spend)
    result = CostReconciliation(
        day=day,
        provider_spend_usd=provider_spend,
        our_cost_usd=ours,
        difference_usd=difference,
        read_at=read_at,
        flagged=abs(difference) > allowed,
    )
    await redis.set(
        reconciliation_key(provider_code, day),
        json.dumps(asdict(result), default=_encode),
        ex=int(REPORT_TTL.total_seconds()),
    )
    log = _log.warning if result.flagged else _log.info
    log(
        "provider costs reconciled",
        provider=provider_code,
        day=day.isoformat(),
        provider_spend_usd=str(provider_spend),
        our_cost_usd=str(ours),
        difference_usd=str(difference),
        flagged=result.flagged,
    )
    return result
