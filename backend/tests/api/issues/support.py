"""The seeded crawl of the Issues tests: one known case per check (spec section 4)."""

from __future__ import annotations

import uuid
from typing import Final

from tests.api.auth.support import Workspace, execute
from tests.api.internal_links.support import SeedLink, seed_crawl
from tests.conftest import PostgresServer

LONG_PATH: Final = "/" + "x" * 120
PATH_115: Final = "/" + "y" * 114

PAGES: Final[list[tuple[str, int]]] = [
    ("/", 200),
    ("/services", 200),
    ("/pricing", 200),
    ("/Plans_Old", 200),
    ("/gone", 404),
    ("/error", 500),
    ("/private", 403),
    ("/old", 301),
    ("/older", 301),
    ("/dead-end", 301),
    ("/services-copy", 200),
    ("/canon-dead", 200),
    ("/hidden", 200),
    ("/lost", 200),
    ("/a/b/c/d", 200),
    ("/long-title", 200),
    ("/caf%C3%A9-menu", 200),
    (LONG_PATH, 200),
    ("/file.pdf", 200),
    ("/About", 200),
    ("/old_page", 200),
    ("/variant-gone", 404),
    ("/variant-moved", 301),
    ("/blocked-noindex", 404),
    ("/canon-redirect", 200),
    ("/canon-blocked", 200),
    ("/to-blocked", 301),
    ("/title-60", 200),
    ("/title-30", 200),
    ("/depth-3", 200),
    (PATH_115, 200),
    # Byte order puts "Z" before "a"; a locale order puts "aa_x" first.
    ("/Zed_page", 200),
    ("/aa_x", 200),
    # Live HTML with no click depth, and a row the crawler got no status for.
    ("/no-depth", 200),
    ("/no-status", 200),
]
LINKS: Final = [
    SeedLink("/", "/services", "content"),
    SeedLink("/", "/pricing", "navigation"),
    SeedLink("/Plans_Old", "/services", "content", followed=False),
]
SHARED_TITLE: Final = "Shared title of two different pages here"
# Pages that differ from the default: a title of 30 to 60 characters that no other page has,
# in the sitemap, indexable, one click deep, no flags and no counters.
_COLUMNS: Final[dict[str, dict[str, object]]] = {
    "/": {"click_depth": 0},
    "/services": {
        "title": "Services",
        "broken_outlinks": 1,
        "redirect_outlinks": 1,
        "non_indexable_outlinks": 1,
    },
    "/pricing": {"title": SHARED_TITLE, "is_editorial_orphan": True, "linking_pages_all": 1},
    "/Plans_Old": {"title": SHARED_TITLE.upper() + " ", "in_sitemap": False},
    "/gone": {"linking_pages_all": 1},
    "/error": {"in_sitemap": False},
    "/old": {"in_sitemap": False},
    "/older": {"in_sitemap": False},
    "/dead-end": {"in_sitemap": False},
    "/services-copy": {
        "title": "Services",
        "is_indexable": False,
        "non_indexable_reason": "canonical",
        "click_depth": None,
    },
    "/canon-dead": {
        "is_indexable": False,
        "non_indexable_reason": "canonical",
        "in_sitemap": False,
        "click_depth": None,
    },
    "/hidden": {"is_indexable": False, "non_indexable_reason": "meta_tag"},
    "/lost": {"title": "", "is_orphan": True},
    "/a/b/c/d": {"click_depth": 4},
    "/long-title": {"title": "Long title " + "x" * 59},
    "/file.pdf": {"resource_type": "other", "title": None, "is_indexable": False},
    "/blocked-noindex": {"is_indexable": False, "non_indexable_reason": "meta_tag"},
    "/canon-redirect": {
        "is_indexable": False,
        "non_indexable_reason": "canonical",
        "in_sitemap": False,
    },
    "/canon-blocked": {
        "is_indexable": False,
        "non_indexable_reason": "canonical",
        "in_sitemap": False,
    },
    "/to-blocked": {"in_sitemap": False},
    "/title-60": {"title": "Title sixty " + "s" * 48},
    "/title-30": {"title": "Title thirty " + "t" * 17},
    "/depth-3": {"click_depth": 3},
    "/no-depth": {"click_depth": None, "non_indexable_reason": None},
    "/no-status": {"status_code": None, "resource_type": "other"},
}
# path -> column that holds a URL id -> path of the page it names
_TARGETS: Final[dict[str, dict[str, str]]] = {
    "/old": {"redirect_url_id": "/older"},
    "/older": {"redirect_url_id": "/services"},
    "/dead-end": {"redirect_url_id": "/gone"},
    "/services-copy": {"canonical_url_id": "/services", "variant_of_url_id": "/services"},
    "/canon-dead": {"canonical_url_id": "/gone", "variant_of_url_id": "/gone"},
    "/variant-gone": {"variant_of_url_id": "/services"},
    "/variant-moved": {"variant_of_url_id": "/services", "redirect_url_id": "/services"},
    "/canon-redirect": {"canonical_url_id": "/old"},
    "/canon-blocked": {"canonical_url_id": "/private", "variant_of_url_id": "/private"},
    "/to-blocked": {"redirect_url_id": "/private"},
}

EXPECTED: Final[dict[str, list[str]]] = {
    "status-4xx": ["/blocked-noindex", "/gone"],
    "status-5xx": ["/error"],
    "redirect-broken": ["/dead-end"],
    "redirect-chain": ["/old"],
    "links-to-redirect": ["/services"],
    "redirect-pages": ["/dead-end", "/old", "/older", "/to-blocked"],
    "canonical-broken": ["/canon-dead", "/canon-redirect"],
    "noindex": ["/hidden"],
    "canonical-elsewhere": ["/canon-blocked", "/canon-dead", "/canon-redirect", "/services-copy"],
    "sitemap-broken": ["/blocked-noindex", "/gone"],
    "sitemap-nonindexable": ["/hidden", "/services-copy"],
    "not-in-sitemap": ["/Plans_Old"],
    "broken-internal-links": ["/services"],
    "orphans": ["/lost"],
    "editorial-orphans": ["/pricing"],
    "links-to-nonindexable": ["/services"],
    "deep-pages": ["/a/b/c/d"],
    "nofollow-internal": ["/Plans_Old"],
    "title-missing": ["/lost"],
    "title-duplicate": ["/Plans_Old", "/pricing"],
    "title-long": ["/long-title"],
    "title-short": ["/services"],
    "url-format": ["/About", "/Plans_Old", "/Zed_page", "/aa_x", "/old_page"],
    "url-long": [LONG_PATH],
}

_UPDATE: Final = "UPDATE seo.crawl_pages SET {sets} WHERE run_id = $1 AND url_id = $2"


async def audit_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, dict[str, int]]:
    """A finished crawl of `PAGES` with the columns each check reads set as the table of the
    spec says. The paths are the ids of the pages, as `seed_crawl` returns them."""
    run_id, ids = await seed_crawl(pg, workspace, project_id, PAGES, LINKS)
    for number, path in enumerate(ids):
        values: dict[str, object] = {
            "title": f"A unique page title number {number:03d} of the site",
            "in_sitemap": True,
            "is_indexable": True,
            "click_depth": 1,
        }
        values.update(_COLUMNS.get(path, {}))
        values.update({column: ids[target] for column, target in _TARGETS.get(path, {}).items()})
        sets = ", ".join(f"{column} = ${position}" for position, column in enumerate(values, 3))
        await execute(pg, _UPDATE.format(sets=sets), run_id, ids[path], *values.values())
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET sitemap_pages = 12, start_url_id = $2 WHERE id = $1",
        run_id,
        ids["/"],
    )
    return run_id, ids
