"""The seeded crawl of the Issues tests: one known case per check (spec section 4)."""

from __future__ import annotations

import uuid
from typing import Final

from tests.api.auth.support import Workspace, execute
from tests.api.internal_links.support import SeedLink, seed_crawl, url_id
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
    # Three pages with one title: byte order is /Zulu-dup, /alpha-dup, /mike-dup; a locale
    # order puts /Zulu-dup last.
    ("/Zulu-dup", 200),
    ("/alpha-dup", 200),
    ("/mike-dup", 200),
    # Redirects without a target row, and a canonical whose target has no status.
    ("/redir-null", 301),
    ("/redir-away", 301),
    ("/canon-nostatus", 200),
]
# An address that is in core.urls but is not a page of the crawl.
OFF_CRAWL: Final = "/off-crawl"
LINKS: Final = [
    SeedLink("/", "/services", "content"),
    SeedLink("/", "/pricing", "navigation"),
    SeedLink("/Plans_Old", "/services", "content", followed=False),
    SeedLink("/Plans_Old", "/pricing", "content", followed=False),
    # A page that links to itself with nofollow: it does not count.
    SeedLink("/Plans_Old", "/Plans_Old", "content", followed=False),
]
DUPLICATE_TITLE: Final = "Title that three pages share here"
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
    "/Zulu-dup": {"title": DUPLICATE_TITLE},
    "/alpha-dup": {"title": DUPLICATE_TITLE},
    "/mike-dup": {"title": DUPLICATE_TITLE},
    "/redir-null": {"in_sitemap": False},
    "/redir-away": {"in_sitemap": False},
    "/canon-nostatus": {
        "is_indexable": False,
        "non_indexable_reason": "canonical",
        "in_sitemap": False,
    },
}
SHARED_DESCRIPTION: Final = "Same description for three pages here"
PAIR_DESCRIPTION: Final = "Shared description of two pages"
# Hashes of the text of a page: three pages that share the first, two that share the second
# with 50 words, and two that share the third with 49 words.
SAME_TEXT: Final = 111
PAIR_TEXT: Final = 222
SHORT_TEXT: Final = 333
# What a page has when its HTML was never read, and what a page that is not a check's to find
# has (a 404, a variant, a page read from no HTML) that would fire every check if it counted.
_NO_FACTS: Final[dict[str, object]] = {
    "facts_read": False,
    "meta_description": None,
    "h1_count": None,
    "word_count": None,
    "text_hash": None,
    "images_without_alt": None,
    "og_complete": None,
    "jsonld_errors": None,
    "hreflang_errors": None,
    "http_resources": None,
}
_BAD_FACTS: Final[dict[str, object]] = {
    "meta_description": "",
    "h1_count": 0,
    "word_count": 5,
    "text_hash": SAME_TEXT,
    "images_without_alt": 2,
    "og_complete": False,
    "jsonld_errors": 1,
    "hreflang_errors": 2,
    "http_resources": 3,
    "response_ms": 5000,
}
# The facts columns that differ from the default of a page: facts read, a description no other
# page has, one H1, 300 words, a text no other page has, no image without alt, Open Graph
# complete, no error, 200 ms.
_FACTS: Final[dict[str, dict[str, object]]] = {
    "/": {"http_resources": 2},
    "/services": {"jsonld_errors": 1, "hreflang_errors": 1, "text_hash": SAME_TEXT},
    "/pricing": {"http_resources": 1, "text_hash": SAME_TEXT},
    "/Plans_Old": {"images_without_alt": 3},
    # Not live: every check must pass over it.
    "/gone": {**_BAD_FACTS, "meta_description": SHARED_DESCRIPTION, "http_resources": 5},
    "/old": {"jsonld_errors": 2, "hreflang_errors": 2},
    # Live but not indexable: not a member of the shared sets.
    "/hidden": {
        "meta_description": SHARED_DESCRIPTION,
        "text_hash": SAME_TEXT,
        "hreflang_errors": 3,
        "images_without_alt": 1,
    },
    # A variant: not counted.
    "/services-copy": {**_BAD_FACTS, "http_resources": 3, "response_ms": 6000},
    # HTML never read: the facts are not read, so bad values mean nothing.
    "/lost": {
        **_NO_FACTS,
        "h1_count": 0,
        "word_count": 10,
        "http_resources": 4,
        "images_without_alt": 6,
        "og_complete": False,
        "jsonld_errors": 1,
        "hreflang_errors": 1,
        "meta_description": "",
    },
    "/no-depth": _NO_FACTS,
    # 199 and 200 words, 3001 and 3000 ms.
    "/a/b/c/d": {"word_count": 199, "jsonld_errors": 4, "response_ms": 3001},
    "/depth-3": {"word_count": 200, "og_complete": False, "response_ms": 3000},
    # Two pages of 50 words with one text (a description that differs by case and spaces),
    # two of 49 words with one text, and a page with no text at all.
    "/About": {
        "word_count": 50,
        "text_hash": PAIR_TEXT,
        "meta_description": PAIR_DESCRIPTION,
        "response_ms": 9000,
    },
    "/caf%C3%A9-menu": {
        "word_count": 50,
        "text_hash": PAIR_TEXT,
        "meta_description": "  " + PAIR_DESCRIPTION.upper() + "\t",
    },
    "/old_page": {"word_count": 49, "text_hash": SHORT_TEXT, "h1_count": 2},
    "/canon-redirect": {"word_count": 49, "text_hash": SHORT_TEXT, "h1_count": 5},
    PATH_115: {"word_count": 0, "text_hash": None},
    "/Zed_page": {"h1_count": 0},
    "/aa_x": {"h1_count": 0},
    # No description: empty, and only blanks. Neither is a description that can be shared.
    "/long-title": {"meta_description": ""},
    "/title-60": {"meta_description": ""},
    "/title-30": {"meta_description": " \t ", "og_complete": False},
    "/Zulu-dup": {"meta_description": SHARED_DESCRIPTION},
    "/alpha-dup": {"meta_description": SHARED_DESCRIPTION},
    "/mike-dup": {"meta_description": SHARED_DESCRIPTION},
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
    "/redir-away": {"redirect_url_id": OFF_CRAWL},
    "/canon-nostatus": {"canonical_url_id": "/no-status"},
}

EXPECTED: Final[dict[str, list[str]]] = {
    "status-4xx": ["/blocked-noindex", "/gone"],
    "status-5xx": ["/error"],
    "redirect-broken": ["/dead-end"],
    "redirect-chain": ["/old"],
    "links-to-redirect": ["/services"],
    "redirect-pages": ["/dead-end", "/old", "/older", "/redir-away", "/redir-null", "/to-blocked"],
    "canonical-broken": ["/canon-dead", "/canon-redirect"],
    "noindex": ["/hidden"],
    "canonical-elsewhere": [
        "/canon-blocked",
        "/canon-dead",
        "/canon-nostatus",
        "/canon-redirect",
        "/services-copy",
    ],
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
    "title-duplicate": ["/Plans_Old", "/Zulu-dup", "/alpha-dup", "/mike-dup", "/pricing"],
    "title-long": ["/long-title"],
    "title-short": ["/services"],
    "url-format": ["/About", "/Plans_Old", "/Zed_page", "/Zulu-dup", "/aa_x", "/old_page"],
    "url-long": [LONG_PATH],
    "mixed-content": ["/", "/pricing"],
    "hreflang": ["/hidden", "/services"],
    "slow-pages": ["/About", "/a/b/c/d"],
    "description-missing": ["/long-title", "/title-30", "/title-60"],
    "description-duplicate": [
        "/About",
        "/Zulu-dup",
        "/alpha-dup",
        "/caf%C3%A9-menu",
        "/mike-dup",
    ],
    "h1-missing": ["/Zed_page", "/aa_x"],
    "h1-multiple": ["/canon-redirect", "/old_page"],
    "thin-content": [
        PATH_115,
        "/About",
        "/a/b/c/d",
        "/caf%C3%A9-menu",
        "/canon-redirect",
        "/old_page",
    ],
    "duplicate-content": ["/About", "/caf%C3%A9-menu", "/pricing", "/services"],
    "image-alt": ["/Plans_Old", "/hidden"],
    "social-tags": ["/depth-3", "/title-30"],
    "schema-errors": ["/a/b/c/d", "/services"],
}

_UPDATE: Final = "UPDATE seo.crawl_pages SET {sets} WHERE run_id = $1 AND url_id = $2"


async def audit_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, dict[str, int]]:
    """A finished crawl of `PAGES` with the columns each check reads set as the table of the
    spec says. The paths are the ids of the pages, as `seed_crawl` returns them."""
    run_id, ids = await seed_crawl(pg, workspace, project_id, PAGES, LINKS)
    targets = {**ids, OFF_CRAWL: await url_id(pg, f"https://example.com{OFF_CRAWL}")}
    for number, path in enumerate(ids):
        values: dict[str, object] = {
            "title": f"A unique page title number {number:03d} of the site",
            "in_sitemap": True,
            "is_indexable": True,
            "click_depth": 1,
            "facts_read": True,
            "meta_description": f"A unique description number {number:03d} of the page",
            "h1_count": 1,
            "word_count": 300,
            "text_hash": 10_000 + number,
            "images_without_alt": 0,
            "og_complete": True,
            "jsonld_errors": 0,
            "hreflang_errors": 0,
            "http_resources": 0,
            "response_ms": 200,
        }
        values.update(_COLUMNS.get(path, {}))
        values.update(_FACTS.get(path, {}))
        values.update({column: targets[found] for column, found in _TARGETS.get(path, {}).items()})
        sets = ", ".join(f"{column} = ${position}" for position, column in enumerate(values, 3))
        await execute(pg, _UPDATE.format(sets=sets), run_id, ids[path], *values.values())
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET sitemap_pages = 12, start_url_id = $2 WHERE id = $1",
        run_id,
        ids["/"],
    )
    return run_id, ids
