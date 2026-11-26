"""Locations: an index for the lookup of a country by its code (WP-44).

The Prompts page and the metrics planner read a prompt's place as the smallest location id of
its country (`idraft.keywords.prompt_links.prompt_location_id`), once per joined row. With
270,000 locations and no index on the code, 86 prompts cost 4 seconds. The index is not
partial: the type arrives as a bound parameter, which a partial index cannot serve in a generic
plan. The table is reference data the worker rewrites rarely, so the build blocks nobody.

Revision ID: 0040
Revises: 0039
"""

from __future__ import annotations

from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX locations_country_type ON core.locations (country_iso, location_type, id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX core.locations_country_type")
