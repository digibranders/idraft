"""A weekly schedule names its weekday and a monthly schedule its day of the month.

`ops.schedules` had a weekday and no day of the month. The day a monthly schedule runs on would
have had to be read back from its `next_run_at`, which moves when a clock change carries a
window past midnight, so the schedule would have drifted to the next day and stayed there. The
day is now a column, 1 to 28: every month has those days, so the schedule has a window every
month.

Both days are required for their cadence. A weekly schedule with no weekday has no rule to plan
from. Rows that exist take the day their next window falls on in their own zone.

Revision ID: 0007
Revises: 0006
"""

from __future__ import annotations

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_UPGRADE = (
    "ALTER TABLE ops.schedules ADD COLUMN month_day smallint CHECK (month_day BETWEEN 1 AND 28)",
    "UPDATE ops.schedules "
    "SET month_day = LEAST(28, extract(day FROM next_run_at AT TIME ZONE timezone)::int) "
    "WHERE cadence = 'monthly'",
    "UPDATE ops.schedules "
    "SET weekday = extract(dow FROM next_run_at AT TIME ZONE timezone)::int "
    "WHERE cadence = 'weekly' AND weekday IS NULL",
    "ALTER TABLE ops.schedules ADD CONSTRAINT schedules_weekly_names_its_weekday "
    "CHECK (cadence <> 'weekly' OR weekday IS NOT NULL)",
    "ALTER TABLE ops.schedules ADD CONSTRAINT schedules_monthly_names_its_day "
    "CHECK (cadence <> 'monthly' OR month_day IS NOT NULL)",
)


def upgrade() -> None:
    for statement in _UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute("ALTER TABLE ops.schedules DROP CONSTRAINT schedules_monthly_names_its_day")
    op.execute("ALTER TABLE ops.schedules DROP CONSTRAINT schedules_weekly_names_its_weekday")
    op.execute("ALTER TABLE ops.schedules DROP COLUMN month_day")
