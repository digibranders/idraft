"""The outline of one page, read from its stored HTML for the page drawer's Outline tab
(Pages spec 9.6.1)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.crawl_store import html_key
from idraft.crawl.outline import (
    HTML_BYTES_MAX,
    THIN_WORDS,
    ParsedOutline,
    parse_outline,
    read_minutes,
)
from idraft.storage.raw import compress
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.conftest import AppFactory
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

PAGE_HTML = """<!doctype html>
<html lang="en"><head>
<title>Other</title>
<meta name="description" content="A short description of the page.">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://example.com/else">
<link rel="alternate" hreflang="en-UK" href="https://example.com/uk/">
<link rel="alternate" hreflang="x-default" href="https://example.com/">
<meta property="og:title" content="Shared title">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@type": "Service"}</script>
<script type="application/ld+json">{broken</script>
</head><body><main>
<h1>Managed service</h1><h2>How it works</h2><h4>Deep</h4>
<p>One two three four five six seven eight nine ten.</p>
<img src="/a.png" alt="A"><img src="/b.png">
</main></body></html>"""


class CountingStore(MemoryStore):
    """A store that remembers which keys were read."""

    def __init__(self) -> None:
        super().__init__()
        self.gets: list[str] = []

    async def get(self, key: str) -> bytes:
        self.gets.append(key)
        return await super().get(key)


@pytest.fixture
def import_store() -> CountingStore:
    return CountingStore()


async def _site(
    pg: PostgresServer, pages: Sequence[tuple[str, int]] = (("/page", 200),)
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    run_id, ids = await seed_crawl(pg, workspace, project, pages)
    return workspace, project, run_id, ids


async def _set(pg: PostgresServer, run_id: uuid.UUID, url: int, **columns: object) -> None:
    assignments = ", ".join(f"{name} = ${number}" for number, name in enumerate(columns, start=3))
    await execute(
        pg,
        f"UPDATE seo.crawl_pages SET {assignments} WHERE run_id = $1 AND url_id = $2",
        run_id,
        url,
        *columns.values(),
    )


async def _store(
    pg: PostgresServer, store: CountingStore, project: uuid.UUID, url: int, packed: bytes
) -> None:
    row = await fetchrow(pg, "SELECT url_hash FROM core.urls WHERE id = $1", url)
    store.objects[html_key(project, row["url_hash"])] = packed


async def _read(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    url: object,
    headers: dict[str, str],
    **query: str,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project, "internal-links", "pages", url, "outline"),
        params=query,
        headers=headers,
    )


async def _outline(
    api: httpx.AsyncClient,
    resources: Resources,
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    url: int,
) -> dict[str, Any]:
    viewer = await member(resources, pg, workspace, "viewer")
    response = await _read(api, workspace, project, url, viewer.headers)
    assert response.status_code == 200
    data: dict[str, Any] = response.json()["data"]
    return data


def _of(parsed: ParsedOutline) -> dict[str, Any]:
    """What the answer holds that comes from the HTML alone."""
    return {
        "headings": [{"level": h.level, "text": h.text} for h in parsed.headings],
        "languages": {
            "x_default": parsed.x_default,
            "pairs": [
                {
                    "code": p.code,
                    "href": p.href,
                    "is_self": p.is_self,
                    "valid": p.valid,
                    "suggestion": p.suggestion,
                }
                for p in parsed.hreflang
            ],
        },
        "social": {
            "og_title": parsed.og_title,
            "og_description": parsed.og_description,
            "og_image": parsed.og_image,
            "og_type": parsed.og_type,
            "twitter_card": parsed.twitter_card,
        },
        "structured_data": [{"types": list(b.types), "parses": b.parses} for b in parsed.jsonld],
    }


async def test_a_live_page_with_stored_html_has_every_field_of_the_outline(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, run_id, ids = await _site(migrated)
    await _store(migrated, import_store, project, ids["/page"], compress(PAGE_HTML.encode()))

    data = await _outline(api, resources, migrated, workspace, project, ids["/page"])

    parsed = parse_outline(PAGE_HTML, "https://example.com/page")
    expected = _of(parsed)
    assert (data["state"], data["run_id"], data["status_code"]) == ("ok", str(run_id), 200)
    outline = data["outline"]
    assert outline["url"] == "https://example.com/page"
    assert outline["truncated"] is False
    for name, value in expected.items():
        assert outline[name] == value
    # The checks above are not empty ones.
    assert len(outline["headings"]) == 3
    assert [pair["code"] for pair in outline["languages"]["pairs"]] == ["en-UK", "x-default"]
    assert outline["structured_data"] == [
        {"types": ["Service"], "parses": True},
        {"types": [], "parses": False},
    ]
    assert outline["html_lang"] == "en"
    assert outline["headings_total"] == 3
    assert outline["level_counts"] == [1, 1, 0, 1, 0, 0]
    assert outline["skipped_at"] == 2
    assert outline["description"] == {
        "text": "A short description of the page.",
        "chars": 32,
        "state": "short",
    }
    assert outline["content"] == {
        "words": parsed.words,
        "read_minutes": read_minutes(parsed.words),
        "thin": True,
        "images": 2,
        "images_without_alt": 1,
    }
    assert 0 < parsed.words < THIN_WORDS


async def test_a_page_of_enough_words_is_not_thin_and_has_its_reading_time(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, _, ids = await _site(migrated)
    html = "<html><body><main><h1>Long</h1><p>" + "word " * 400 + "</p></main></body></html>"
    await _store(migrated, import_store, project, ids["/page"], compress(html.encode()))

    data = await _outline(api, resources, migrated, workspace, project, ids["/page"])

    content = data["outline"]["content"]
    assert (content["thin"], content["read_minutes"]) == (False, 2)
    assert content["words"] >= THIN_WORDS


async def test_the_title_the_canonical_and_the_noindex_come_from_the_crawl_row(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, run_id, ids = await _site(migrated)
    await _store(migrated, import_store, project, ids["/page"], compress(PAGE_HTML.encode()))
    title = "T" * 40
    await _set(
        migrated,
        run_id,
        ids["/page"],
        title=title,
        canonical_url_id=None,
        is_indexable=True,
        non_indexable_reason=None,
    )

    data = await _outline(api, resources, migrated, workspace, project, ids["/page"])

    outline = data["outline"]
    assert outline["title"] == {"text": title, "chars": 40, "state": "ok"}
    assert outline["canonical"] == {"state": "none", "href": None}
    # The text is shown as read, the verdict is the row's.
    assert outline["robots"] == {"meta": "noindex", "noindex": False}


@pytest.mark.parametrize(
    ("stored", "text", "chars", "state"),
    [
        (None, None, 0, "missing"),
        ("", None, 0, "missing"),
        ("   ", None, 0, "missing"),
        ("a" * 29, "a" * 29, 29, "short"),
        ("a" * 30, "a" * 30, 30, "ok"),
        ("a" * 60, "a" * 60, 60, "ok"),
        ("a" * 61, "a" * 61, 61, "long"),
        (f"  {'a' * 30}  ", "a" * 30, 30, "ok"),
        (f"  {'a' * 29}  ", "a" * 29, 29, "short"),
    ],
)
async def test_the_title_state_follows_the_trimmed_title_of_the_row(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
    stored: str | None,
    text: str | None,
    chars: int,
    state: str,
) -> None:
    workspace, project, run_id, ids = await _site(migrated)
    await _store(migrated, import_store, project, ids["/page"], compress(PAGE_HTML.encode()))
    await _set(migrated, run_id, ids["/page"], title=stored)

    data = await _outline(api, resources, migrated, workspace, project, ids["/page"])

    assert data["outline"]["title"] == {"text": text, "chars": chars, "state": state}


async def test_a_canonical_is_self_or_elsewhere_by_the_page_it_names(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, run_id, ids = await _site(
        migrated, [("/page", 200), ("/other", 200), ("/third", 200)]
    )
    for path in ("/page", "/other", "/third"):
        await _store(migrated, import_store, project, ids[path], compress(PAGE_HTML.encode()))
    await _set(migrated, run_id, ids["/page"], canonical_url_id=ids["/page"])
    await _set(migrated, run_id, ids["/other"], canonical_url_id=ids["/third"])

    own = await _outline(api, resources, migrated, workspace, project, ids["/page"])
    moved = await _outline(api, resources, migrated, workspace, project, ids["/other"])
    none = await _outline(api, resources, migrated, workspace, project, ids["/third"])

    assert own["outline"]["canonical"] == {"state": "self", "href": "https://example.com/page"}
    assert moved["outline"]["canonical"] == {
        "state": "elsewhere",
        "href": "https://example.com/third",
    }
    assert none["outline"]["canonical"] == {"state": "none", "href": None}


@pytest.mark.parametrize(
    ("reason", "noindex"),
    [
        ("meta_tag", True),
        ("http_header", True),
        ("robots_txt", False),
        ("attribute", False),
        ("canonical", False),
        ("too_many_redirects", False),
        (None, False),
    ],
)
async def test_noindex_is_the_row_s_reason_being_a_meta_tag_or_a_header(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
    reason: str | None,
    noindex: bool,
) -> None:
    workspace, project, run_id, ids = await _site(migrated)
    await _store(migrated, import_store, project, ids["/page"], compress(PAGE_HTML.encode()))
    await _set(
        migrated,
        run_id,
        ids["/page"],
        is_indexable=reason is None,
        non_indexable_reason=reason,
    )

    data = await _outline(api, resources, migrated, workspace, project, ids["/page"])

    assert data["outline"]["robots"]["noindex"] is noindex


async def test_a_page_that_is_not_live_html_is_decided_from_the_row_and_storage_is_not_read(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, run_id, ids = await _site(
        migrated,
        [("/moved", 301), ("/gone", 404), ("/nostatus", 200), ("/file", 200), ("/down", 503)],
    )
    for url in ids.values():
        await _store(migrated, import_store, project, url, compress(PAGE_HTML.encode()))
    await _set(migrated, run_id, ids["/nostatus"], status_code=None)
    await _set(migrated, run_id, ids["/file"], resource_type="other")

    answers = {
        path: await _outline(api, resources, migrated, workspace, project, url)
        for path, url in ids.items()
    }

    assert {path: (a["state"], a["status_code"], a["outline"]) for path, a in answers.items()} == {
        "/moved": ("redirect", 301, None),
        "/gone": ("error", 404, None),
        "/nostatus": ("error", None, None),
        "/file": ("not_html", 200, None),
        "/down": ("error", 503, None),
    }
    assert import_store.gets == []


async def test_html_that_cannot_be_read_is_no_html_and_not_an_error(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, _, ids = await _site(migrated, [("/missing", 200), ("/damaged", 200)])
    await _store(migrated, import_store, project, ids["/damaged"], b"not zstd")

    missing = await _outline(api, resources, migrated, workspace, project, ids["/missing"])
    damaged = await _outline(api, resources, migrated, workspace, project, ids["/damaged"])

    assert [(a["state"], a["status_code"], a["outline"]) for a in (missing, damaged)] == [
        ("no_html", 200, None),
        ("no_html", 200, None),
    ]


async def test_an_application_without_object_storage_answers_no_html(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    workspace, project, _, ids = await _site(migrated)
    async with client_for() as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        viewer = await member(resources, migrated, workspace, "viewer")

        response = await _read(api, workspace, project, ids["/page"], viewer.headers)

    assert response.status_code == 200
    assert response.json()["data"]["state"] == "no_html"
    assert response.json()["data"]["outline"] is None


async def test_html_past_the_byte_cap_is_read_up_to_it_and_says_so(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, _, ids = await _site(migrated)
    html = (
        "<html><body><h1>First</h1><p>"
        + "x" * HTML_BYTES_MAX
        + "</p><h2>Past the cap</h2></body></html>"
    )
    assert len(html) > HTML_BYTES_MAX + 10
    await _store(migrated, import_store, project, ids["/page"], compress(html.encode()))

    data = await _outline(api, resources, migrated, workspace, project, ids["/page"])

    assert data["state"] == "ok"
    assert data["outline"]["truncated"] is True
    assert [h["text"] for h in data["outline"]["headings"]] == ["First"]


async def test_a_variant_page_has_an_outline(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: CountingStore,
) -> None:
    workspace, project, run_id, ids = await _site(migrated, [("/page", 200), ("/page-v", 200)])
    await _store(migrated, import_store, project, ids["/page-v"], compress(PAGE_HTML.encode()))
    await _set(migrated, run_id, ids["/page-v"], variant_of_url_id=ids["/page"])

    data = await _outline(api, resources, migrated, workspace, project, ids["/page-v"])

    assert data["state"] == "ok"
    assert data["outline"]["url"] == "https://example.com/page-v"


async def test_a_page_only_an_older_crawl_holds_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, old = await _site(migrated, [("/old-only", 200)])
    _, latest = await seed_crawl(migrated, workspace, project, [("/page", 200)])
    viewer = await member(resources, migrated, workspace, "viewer")

    older = await _read(api, workspace, project, old["/old-only"], viewer.headers)
    current = await _read(api, workspace, project, latest["/page"], viewer.headers)

    assert problem(older) == (404, "not_found")
    assert current.status_code == 200


async def test_an_id_that_is_not_digits_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, _ = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _read(api, workspace, project, "abc", viewer.headers)

    assert response.status_code == 422


async def test_a_project_without_a_finished_crawl_has_no_outline(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await _read(api, workspace, project, 1, viewer.headers)

    assert problem(response) == (404, "no_crawl")


async def test_another_workspace_cannot_read_the_outline_of_a_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, ids = await _site(migrated)
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await _read(api, workspace, project, ids["/page"], stranger.headers)

    assert response.status_code == 404


async def test_a_role_without_data_read_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, ids = await _site(migrated)
    billing = await member(resources, migrated, workspace, "billing")

    response = await _read(api, workspace, project, ids["/page"], billing.headers)

    assert response.status_code == 403


async def test_the_outline_takes_no_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    with_run = await _read(api, workspace, project, ids["/page"], viewer.headers, run="latest")
    unknown_name = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/page"]),
        params={"nonsense": "1"},
        headers=viewer.headers,
    )

    assert with_run.status_code == 422
    assert problem(with_run) == problem(unknown_name)
