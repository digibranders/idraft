"""Internal links: recount the crawls finished before blocked pages were told apart (plan 08).

Runs the two statements of `idraft.db.blocked_recount` once: each crawl that has pages that
answered 401, 403 or 429 gets its `pages_blocked`, and its pages stop counting those targets as
broken outlinks. A crawl whose links were dropped by retention keeps the counters it had.

Revision ID: 0031
Revises: 0030
"""

from __future__ import annotations

from alembic import op

from idraft.db.blocked_recount import BROKEN_OUTLINKS, RUN_COUNT

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(RUN_COUNT)
    op.execute(BROKEN_OUTLINKS)


def downgrade() -> None:
    # A recount has nothing to undo: the counters are derived from the pages and links.
    pass
