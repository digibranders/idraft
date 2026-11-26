"""Declared dates of a page (spec 4.1): JSON-LD, meta tags, the sitemap, and what is ignored."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

from idraft.crawl.declared_dates import Declared, declared_of

SITEMAP = datetime(2026, 1, 5, 12, 0, tzinfo=UTC)


def _ld(body: str) -> str:
    return f'<html><head><script type="application/ld+json">{body}</script></head></html>'


def _meta(prop: str, value: str) -> str:
    return f'<html><head><meta property="{prop}" content="{value}"></head></html>'


def test_json_ld_top_level() -> None:
    got = declared_of(_ld('{"@type":"Article","dateModified":"2026-03-04T10:20:30+02:00"}'), None)
    assert got == Declared(datetime(2026, 3, 4, 8, 20, 30, tzinfo=UTC), "json_ld")


def test_json_ld_in_graph_and_arrays() -> None:
    graph = '{"@graph":[{"@type":"WebSite"},{"@type":"Article","dateModified":"2026-02-01"}]}'
    assert declared_of(_ld(graph), None) == Declared(datetime(2026, 2, 1, tzinfo=UTC), "json_ld")
    array = '[{"@type":"Org"},{"@type":"Article","dateModified":"2026-02-02T00:00:00Z"}]'
    assert declared_of(_ld(array), None) == Declared(datetime(2026, 2, 2, tzinfo=UTC), "json_ld")


def test_no_zone_is_utc() -> None:
    got = declared_of(_ld('{"dateModified":"2026-03-04T10:20:30"}'), None)
    assert got is not None
    assert got.at == datetime(2026, 3, 4, 10, 20, 30, tzinfo=UTC)


def test_meta_fallbacks_in_order() -> None:
    assert declared_of(_meta("article:modified_time", "2026-04-01T00:00:00Z"), SITEMAP) == Declared(
        datetime(2026, 4, 1, tzinfo=UTC), "meta_modified"
    )
    assert declared_of(_meta("og:updated_time", "2026-04-02T00:00:00Z"), SITEMAP) == Declared(
        datetime(2026, 4, 2, tzinfo=UTC), "og_updated"
    )
    assert declared_of("<html></html>", SITEMAP) == Declared(SITEMAP, "sitemap")


def test_priority_json_ld_over_meta_over_og_over_sitemap() -> None:
    html = (
        '<html><head><meta property="og:updated_time" content="2026-04-02">'
        '<meta property="article:modified_time" content="2026-04-01">'
        '<script type="application/ld+json">{"dateModified":"2026-04-03"}</script></head></html>'
    )
    assert declared_of(html, SITEMAP) is not None
    assert declared_of(html, SITEMAP).source == "json_ld"  # type: ignore[union-attr]
    no_ld = html.replace("application/ld+json", "text/plain")
    assert declared_of(no_ld, SITEMAP).source == "meta_modified"  # type: ignore[union-attr]


def test_future_and_ancient_dates_are_ignored() -> None:
    now = datetime.now(UTC)
    far = (now + timedelta(days=3)).isoformat()
    soon = (now + timedelta(hours=12)).isoformat()
    assert declared_of(_ld(f'{{"dateModified":"{far}"}}'), None) is None
    got = declared_of(_ld(f'{{"dateModified":"{soon}"}}'), None)
    assert got is not None
    assert got.source == "json_ld"
    assert declared_of(_ld('{"dateModified":"1994-12-31"}'), None) is None
    # an ignored value falls through to the next source
    assert declared_of(_ld('{"dateModified":"1990-01-01"}'), SITEMAP) == Declared(
        SITEMAP, "sitemap"
    )


def test_malformed_is_ignored() -> None:
    assert declared_of(_ld("{not json"), None) is None
    assert declared_of(_ld('{"dateModified":"yesterday"}'), None) is None
    assert declared_of(_ld('{"dateModified":12345}'), None) is None
    assert declared_of(_meta("article:modified_time", "soon"), None) is None
    assert declared_of("<<<>>><script", None) is None
    assert declared_of("", None) is None


def test_naive_sitemap_value_is_read_as_utc() -> None:
    naive = datetime(2026, 1, 5, 12, 0)
    got = declared_of("", naive)
    assert got is not None
    assert got.at == SITEMAP


def test_extreme_dates_never_raise() -> None:
    for value in ("0001-01-01T00:00:00+05:00", "9999-12-31T23:59:59-05:00"):
        assert declared_of(_meta("article:modified_time", value), None) is None
        assert declared_of(_ld(f'{{"dateModified":"{value}"}}'), None) is None
    low = datetime(1, 1, 1, tzinfo=timezone(timedelta(hours=5)))
    assert declared_of("", low) is None


def test_json_ld_type_with_parameters() -> None:
    html = (
        '<script type="application/ld+json; charset=utf-8">{"dateModified":"2026-03-04"}</script>'
    )
    got = declared_of(html, None)
    assert got is not None
    assert got.source == "json_ld"
