"""Where a prompt's linked keyword is measured (WP-44, `core.keyword_prompt_links`).

A link names a keyword and no place. The keyword's metrics are read, and collected, at the
prompt's own place: the country of its `country_iso`, else the project's default location. The
planner and the Prompts page both use `prompt_location_id`, so the volume a page shows is the
one that was asked for.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, func, select

from idraft.db.tables import ai_prompts, locations, projects


def prompt_location_id() -> ColumnElement[int | None]:
    """The location of `ai.prompts` (joined to `core.projects` by the caller), as a SQL value."""
    country = (
        select(func.min(locations.c.id))
        .where(
            locations.c.country_iso == ai_prompts.c.country_iso,
            locations.c.location_type == "Country",
        )
        .scalar_subquery()
    )
    return func.coalesce(country, projects.c.default_location_id)
