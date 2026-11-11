"""One Google connection for Search Console and GA4.

A connection is one Google login, and the owner decided (2026-11-05) that access and connection
are made together: one consent asks for both read-only product scopes, so the connection's
`product` is `google` and what it can reach is read from its `scopes`. The properties of each
product stay in `fp.integrations`, whose `kind` (`gsc` or `ga4`) is unchanged.

- `fp.connections.product` accepts `google`, `bing_wmt` and `cloudflare`; `gsc` and `ga4` are
  no longer connection products. Existing `gsc` rows become `google`, with their scopes as they
  are (a connection made before this change has Search Console access only; the person adds
  Analytics by connecting again). No `ga4` connection can exist: nothing created one.
- The unique key `(workspace_id, product, subject_id)` is kept, so one Google account is one
  connection per workspace.
- `integrations_one_live_per_project` (0015) is already per `(project_id, kind)`, so a project
  keeps one live Search Console property and one live GA4 property. Nothing to change there.
- ALTER TABLE leaves the grants and the row-level security policies as they are.

The downgrade turns `google` rows back into `gsc` (a connection that only had Analytics access
becomes a `gsc` row; local development only, as for 0015).

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_CHECK = "connections_product_check"


def upgrade() -> None:
    op.execute(f"ALTER TABLE fp.connections DROP CONSTRAINT {_CHECK}")
    op.execute("UPDATE fp.connections SET product = 'google' WHERE product IN ('gsc', 'ga4')")
    op.execute(
        f"ALTER TABLE fp.connections ADD CONSTRAINT {_CHECK} "
        "CHECK (product IN ('google', 'bing_wmt', 'cloudflare'))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE fp.connections DROP CONSTRAINT {_CHECK}")
    op.execute("UPDATE fp.connections SET product = 'gsc' WHERE product = 'google'")
    op.execute(
        f"ALTER TABLE fp.connections ADD CONSTRAINT {_CHECK} "
        "CHECK (product IN ('gsc', 'ga4', 'bing_wmt', 'cloudflare'))"
    )
