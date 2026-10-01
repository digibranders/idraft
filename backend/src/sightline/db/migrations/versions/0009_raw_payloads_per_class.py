"""A raw payload is registered once per retention class, not once overall.

A payload's object key starts with its retention class, because the bucket's lifecycle rules
expire each class by prefix (doc 23 section 9). With one row per hash, the same bytes kept
under a second class were answered with the first class's row, and so with its object and its
expiry: bytes that must be kept for ever could be pointed at an object deleted after 30 days.
One row per class and hash keeps each class's object, and each class's lifetime.

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ops.raw_payloads DROP CONSTRAINT raw_payloads_sha256_key, "
        "ADD CONSTRAINT raw_payloads_retention_class_sha256_key UNIQUE (retention_class, sha256)"
    )


def downgrade() -> None:
    # Local development only. Fails if a hash is registered under two classes.
    op.execute(
        "ALTER TABLE ops.raw_payloads DROP CONSTRAINT raw_payloads_retention_class_sha256_key, "
        "ADD CONSTRAINT raw_payloads_sha256_key UNIQUE (sha256)"
    )
