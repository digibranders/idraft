"""The SQL side of variants (plan 09): which pages are variants, and the links of a crawl once
they are folded away. See `idraft.crawl.variants` for the rule.

`apply_variants` runs inside the metrics step of a crawl, before anything is counted. It undoes
an earlier answer first, so it can be run again on a finished crawl:

1. Links come back to their first target and none is ignored.
2. A page is a variant when its canonical is another page of the same crawl that is not itself
   a variant: a canonical that points on, or back (a cycle), leaves both ends counting as pages.
   A variant has no depth, no share of equity and no counts.
3. A link to a variant is re-pointed at its canonical page; the first target stays in
   `folded_from_url_id`.
4. A link from a variant is ignored, and so is one that the fold turned into a link from a page
   to itself (a link that was a self-link all along is left to its readers, as before).

Every reader of links asks for `NOT ignored`; `EFFECTIVE_LINKS` is that, for the counting
statements."""

from __future__ import annotations

from typing import Final
from uuid import UUID

from sqlalchemy import TextClause, text
from sqlalchemy.ext.asyncio import AsyncSession

_UNFOLD_LINKS: Final[TextClause] = text(
    """
    UPDATE seo.crawl_links SET target_url_id = coalesce(folded_from_url_id, target_url_id),
        folded_from_url_id = NULL, ignored = false
    WHERE run_id = CAST(:run_id AS uuid) AND (folded_from_url_id IS NOT NULL OR ignored)
    """
)
_CLEAR_PAGES: Final[TextClause] = text(
    """
    UPDATE seo.crawl_pages SET variant_of_url_id = NULL,
        linking_pages_editorial = 0, linking_pages_auto = 0, linking_pages_template = 0,
        linking_pages_all = 0, outlinks_editorial = 0, outlinks_auto = 0, outlinks_template = 0,
        outlinks_all = 0, broken_outlinks = 0, redirect_outlinks = 0, non_indexable_outlinks = 0,
        top_anchor = NULL
    WHERE run_id = CAST(:run_id AS uuid)
    """
)
_SET_VARIANTS: Final[TextClause] = text(
    """
    UPDATE seo.crawl_pages v SET variant_of_url_id = c.url_id,
        click_depth = NULL, depth_without_auto = NULL, equity_share = NULL,
        deep_only_through_auto = false
    FROM seo.crawl_pages c
    WHERE v.run_id = CAST(:run_id AS uuid) AND c.run_id = v.run_id
      AND c.url_id = v.canonical_url_id AND v.canonical_url_id <> v.url_id
      AND (c.canonical_url_id IS NULL OR c.canonical_url_id = c.url_id)
    """
)
_FOLD_LINKS: Final[TextClause] = text(
    """
    UPDATE seo.crawl_links l SET folded_from_url_id = l.target_url_id,
        target_url_id = t.variant_of_url_id
    FROM seo.crawl_pages t
    WHERE l.run_id = CAST(:run_id AS uuid) AND t.run_id = l.run_id
      AND t.url_id = l.target_url_id AND t.variant_of_url_id IS NOT NULL
    """
)
_IGNORE_LINKS: Final[TextClause] = text(
    """
    UPDATE seo.crawl_links l SET ignored = true
    WHERE l.run_id = CAST(:run_id AS uuid)
      AND ((l.folded_from_url_id IS NOT NULL AND l.target_url_id = l.source_url_id)
           OR EXISTS (SELECT 1 FROM seo.crawl_pages s
                      WHERE s.run_id = l.run_id AND s.url_id = l.source_url_id
                        AND s.variant_of_url_id IS NOT NULL))
    """
)
EFFECTIVE_LINKS: Final = """
    SELECT source_url_id, target_url_id, scope, anchor, occurrences
    FROM seo.crawl_links WHERE run_id = CAST(:run_id AS uuid) AND NOT ignored
"""


async def apply_variants(db: AsyncSession, run_id: UUID) -> None:
    """Decide the variants of one crawl and fold its links (see the module text)."""
    keys = {"run_id": run_id}
    for statement in (
        _UNFOLD_LINKS,
        _CLEAR_PAGES,
        _SET_VARIANTS,
        _FOLD_LINKS,
        _IGNORE_LINKS,
    ):
        await db.execute(statement, keys)
