"""The SERP parser, version 1 (docs/26-testing-quality.md section 4.1: SERP-ORG, FEAT and AIO
cases; docs/06 section 5). Fixtures are synthetic until spike S-01 captures real answers."""

from __future__ import annotations

import importlib
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from sightline.providers.dataforseo import serp_parse
from sightline.providers.dataforseo.schema_hash import reads, schema_hash, schema_paths
from sightline.providers.dataforseo.serp_parse import (
    FEATURE_TYPES,
    PAYLOAD_MAX_BYTES,
    READS_PATHS,
    SerpSchemaMismatchError,
    parse_serp,
)
from tests.providers.dataforseo.support import FIXTURES

SERP = FIXTURES / "serp"


def _load(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(path.read_text())
    return loaded


def organic(rank: int, url: str, **more: Any) -> dict[str, Any]:
    return {
        "type": "organic",
        "rank_group": rank,
        "rank_absolute": rank,
        "position": "left",
        "title": f"Result {rank}",
        "description": "A snippet.",
        "url": url,
        **more,
    }


def serp(items: Any, **result: Any) -> dict[str, Any]:
    """An answer holding these items (any value, to build answers that are not well formed)."""
    return {
        "status_code": 20000,
        "tasks": [
            {
                "status_code": 20000,
                "result": [
                    {
                        "keyword": "crm",
                        "se_domain": "google.com",
                        "datetime": "2026-10-01 09:12:44 +00:00",
                        "items": items,
                        **result,
                    }
                ],
            }
        ],
    }


def rich() -> serp_parse.NormalizedSerp:
    return parse_serp(_load(SERP / "serp_rich.json"))


# SERP-ORG: organic list construction (doc 06 section 5.2).


def test_serp_org_01_ads_and_an_ai_overview_above_organic_rank_one() -> None:
    first = rich().organic[0]

    assert first.organic_rank == 1
    assert first.absolute_rank == 6
    assert first.url.url == "https://www.example-crm.com/startups"


@pytest.mark.parametrize(
    "ranks",
    [[1, 2, 4], [1, 2, 2, 3], [2, 3, 4], [None, 1, 2]],
)
def test_serp_org_02_a_gap_or_a_repeat_in_the_ranks_is_recomputed_from_response_order(
    ranks: list[int | None],
) -> None:
    items = [
        organic(0, f"https://example.com/{n}") | {"rank_group": rank}
        for n, rank in enumerate(ranks)
    ]

    parsed = parse_serp(serp(items))

    assert [result.organic_rank for result in parsed.organic] == list(range(1, len(ranks) + 1))
    assert parsed.warnings.count("rank_recomputed") == 1


def test_serp_org_02_ranks_the_provider_gave_without_a_gap_raise_no_warning() -> None:
    parsed = parse_serp(serp([organic(n, f"https://example.com/{n}") for n in (1, 2, 3)]))

    assert "rank_recomputed" not in parsed.warnings


def test_serp_org_03_related_results_are_not_ranks_of_their_own() -> None:
    parsed = rich()

    assert [result.organic_rank for result in parsed.organic] == [1, 2, 3]
    assert [url.url for url in parsed.organic[0].grouped_urls] == [
        "https://www.example-crm.com/startups/plan"
    ]
    assert parsed.organic[0].has_sitelinks is True
    assert parsed.organic[1].grouped_urls == ()


def test_serp_org_04_a_redirect_wrapper_is_unwrapped_or_kept_and_flagged() -> None:
    wrapped = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa&sa=U"
    undecodable = "https://www.google.com/goto?id=12345"
    parsed = parse_serp(serp([organic(1, wrapped), organic(2, undecodable)]))

    first, second = parsed.organic
    assert first.url.url == "https://example.com/a"
    assert "redirect_unwrapped" in first.url.flags
    assert "unresolved_redirect" in second.url.flags
    assert parsed.warnings == ("unresolved_redirect",)


def test_serp_org_05_a_duplicate_canonical_url_keeps_the_first() -> None:
    parsed = parse_serp(
        serp(
            [
                organic(1, "https://example.com/a"),
                organic(2, "https://example.com/a?utm_source=x&gclid=1"),
                organic(3, "https://example.com/b"),
            ]
        )
    )

    assert [result.url.url for result in parsed.organic] == [
        "https://example.com/a",
        "https://example.com/b",
    ]
    assert [result.organic_rank for result in parsed.organic] == [1, 2]
    assert parsed.depth_returned == 2
    assert "duplicate_url" in parsed.warnings


def test_serp_org_06_a_changed_query_is_flagged_and_a_suggestion_only_kept() -> None:
    changed = parse_serp(
        serp(
            [organic(1, "https://example.com/a")],
            spell={"type": "showing_results_for", "keyword": "crm"},
        )
    )
    suggested = parse_serp(
        serp(
            [organic(1, "https://example.com/a")], spell={"type": "did_you_mean", "keyword": "crm"}
        )
    )

    assert changed.spell is not None
    assert (changed.spell.type, changed.spell.keyword) == ("showing_results_for", "crm")
    assert "query_autocorrected" in changed.warnings
    assert suggested.spell is not None
    assert "query_autocorrected" not in suggested.warnings


def test_serp_org_07_more_results_than_asked_for_are_all_kept() -> None:
    items = [organic(n, f"https://example.com/{n}") for n in range(1, 24)]

    parsed = parse_serp(serp(items))

    assert parsed.depth_returned == 23


def test_serp_org_09_a_right_column_item_is_never_a_rank() -> None:
    parsed = rich()
    panel = next(
        feature for feature in parsed.features if feature.feature_type == "knowledge_graph"
    )
    right = parse_serp(serp([organic(1, "https://example.com/a", position="right")]))

    assert panel.absolute_rank is None
    assert right.organic[0].absolute_rank is None
    assert right.organic[0].organic_rank == 1


@pytest.mark.gold
@pytest.mark.parametrize("name", ["serp/serp_rich", "task_get_advanced"])
def test_serp_org_10_the_invariants_hold_on_every_fixture(name: str) -> None:
    parsed = parse_serp(_load(FIXTURES / f"{name}.json"))

    assert [result.organic_rank for result in parsed.organic] == list(
        range(1, parsed.depth_returned + 1)
    )
    hashes = [result.url.url_hash for result in parsed.organic]
    assert len(set(hashes)) == len(hashes)
    present = parsed.ai_overview.state != "absent"
    assert present == any(feature.feature_type == "ai_overview" for feature in parsed.features)


def test_an_organic_result_without_a_readable_url_is_left_out_and_reported() -> None:
    parsed = parse_serp(
        serp(
            [
                organic(1, "https://example.com/a"),
                organic(2, "javascript:void(0)"),
                organic(3, "https://example.com/c") | {"url": None},
            ]
        )
    )

    assert [result.url.url for result in parsed.organic] == ["https://example.com/a"]
    # One was refused as a URL, one had none.
    assert parsed.warnings.count("organic_without_url") == 2
    assert parsed.warnings.count("url_rejected") == 1


# Query facts.


def test_the_facts_about_the_query_are_read() -> None:
    parsed = rich()

    assert parsed.keyword == "best crm for startups"
    assert parsed.se_domain == "google.com"
    assert parsed.check_url is not None
    assert parsed.check_url.startswith("https://www.google.com/search?q=")
    assert parsed.se_results_count == 412000000
    assert parsed.observed_at == datetime(2026, 10, 1, 9, 12, 44, tzinfo=UTC)


def test_item_types_are_our_names_once_each() -> None:
    assert rich().item_types == (
        "ads",
        "ai_overview",
        "featured_snippet",
        "people_also_ask",
        "organic",
        "images",
        "related_searches",
        "knowledge_graph",
    )


def test_item_types_fall_back_to_the_types_of_the_items() -> None:
    body = serp([organic(1, "https://example.com/a"), {"type": "twitter", "rank_group": 1}])
    del body["tasks"][0]["result"][0]["datetime"]

    parsed = parse_serp(body)

    assert parsed.item_types == ("organic", "social_posts")
    assert parsed.observed_at is None


def test_an_unreadable_datetime_is_reported_and_left_out() -> None:
    parsed = parse_serp(serp([], datetime="yesterday"))

    assert parsed.observed_at is None
    assert parsed.warnings == ("datetime_unreadable",)


# FEAT: features (doc 06 section 5.4).


def _only(feature_type: str, item: dict[str, Any]) -> serp_parse.SerpFeature:
    parsed = parse_serp(serp([item]))
    (feature,) = [f for f in parsed.features if f.feature_type == feature_type]
    return feature


@pytest.mark.parametrize(
    ("item", "feature_type", "sources"),
    [
        (
            {"type": "ai_overview", "references": [{"url": "https://a.example/x"}]},
            "ai_overview",
            ["https://a.example/x"],
        ),
        (
            {"type": "featured_snippet", "url": "https://a.example/x"},
            "featured_snippet",
            ["https://a.example/x"],
        ),
        (
            {
                "type": "people_also_ask",
                "items": [{"title": "q", "expanded_element": [{"url": "https://a.example/x"}]}],
            },
            "people_also_ask",
            ["https://a.example/x"],
        ),
        (
            {"type": "local_pack", "items": [{"title": "Shop", "url": "https://a.example/x"}]},
            "local_pack",
            ["https://a.example/x"],
        ),
        (
            {"type": "knowledge_graph", "items": [{"url": "https://a.example/x"}]},
            "knowledge_graph",
            ["https://a.example/x"],
        ),
        (
            {"type": "top_stories", "items": [{"url": "https://a.example/x"}]},
            "top_stories",
            ["https://a.example/x"],
        ),
        (
            {"type": "video", "items": [{"url": "https://a.example/x", "domain": "a.example"}]},
            "video",
            ["https://a.example/x"],
        ),
        (
            {"type": "short_videos", "items": [{"url": "https://a.example/x"}]},
            "video",
            ["https://a.example/x"],
        ),
        (
            {"type": "images", "items": [{"url": "https://a.example/x"}]},
            "images",
            ["https://a.example/x"],
        ),
        (
            {"type": "discussions_and_forums", "items": [{"url": "https://a.example/x"}]},
            "discussions_and_forums",
            ["https://a.example/x"],
        ),
        (
            {"type": "perspectives", "items": [{"url": "https://a.example/x"}]},
            "perspectives",
            ["https://a.example/x"],
        ),
        (
            {"type": "shopping", "items": [{"url": "https://a.example/x"}]},
            "shopping",
            ["https://a.example/x"],
        ),
        (
            {"type": "popular_products", "items": [{"url": "https://a.example/x"}]},
            "shopping",
            ["https://a.example/x"],
        ),
        (
            {"type": "commercial_units", "items": [{"url": "https://a.example/x"}]},
            "shopping",
            ["https://a.example/x"],
        ),
        ({"type": "related_searches", "items": [{"title": "a query"}]}, "related_searches", []),
        ({"type": "people_also_search", "items": [{"title": "a query"}]}, "related_searches", []),
        (
            {"type": "twitter", "items": [{"url": "https://a.example/x"}]},
            "social_posts",
            ["https://a.example/x"],
        ),
        (
            {"type": "answer_box", "url": "https://a.example/x"},
            "answer_box",
            ["https://a.example/x"],
        ),
    ],
)
def test_feat_01_every_documented_type_maps_to_its_feature_and_sources(
    item: dict[str, Any], feature_type: str, sources: list[str]
) -> None:
    feature = _only(feature_type, item)

    assert [url.url for url in feature.source_urls] == sources
    assert feature.ordinal == 1


def test_feat_02_an_unknown_type_becomes_an_other_feature_and_ingest_goes_on() -> None:
    feature = _only("other:ai_quick_take", {"type": "ai_quick_take", "url": "https://a.example/x"})

    assert [url.url for url in feature.source_urls] == ["https://a.example/x"]


def test_feat_03_every_mapped_code_is_in_the_registry_the_migration_seeds() -> None:
    migration = importlib.import_module("sightline.db.migrations.versions.0013_rank_collection")
    seeded = {code for code, _label, _ownable in migration._FEATURE_TYPES}

    assert set(FEATURE_TYPES.values()) <= seeded
    assert seeded <= set(FEATURE_TYPES.values()) | {"sitelinks"}


def test_feat_04_ads_are_a_feature_with_counts_and_never_a_rank() -> None:
    parsed = rich()

    (ads,) = [feature for feature in parsed.features if feature.feature_type == "ads"]
    assert ads.payload == {"top": 2, "bottom": 0}
    assert [url.url for url in ads.source_urls] == [
        "https://ads.example-crm.com/trial",
        "https://www.acme.example/crm",
    ]
    assert all("ads.example-crm.com" not in result.url.url for result in parsed.organic)


def test_feat_04_ads_below_the_first_organic_result_are_counted_at_the_bottom() -> None:
    parsed = parse_serp(
        serp(
            [
                organic(1, "https://example.com/a") | {"rank_absolute": 2},
                {"type": "paid", "rank_absolute": 1, "url": "https://ad.example/1"},
                {"type": "paid", "rank_absolute": 9, "url": "https://ad.example/2"},
            ]
        )
    )

    (ads,) = [feature for feature in parsed.features if feature.feature_type == "ads"]
    assert ads.payload == {"top": 1, "bottom": 1}


def test_feat_04_an_organic_result_with_links_is_also_a_sitelinks_feature() -> None:
    parsed = rich()

    (sitelinks,) = [f for f in parsed.features if f.feature_type == "sitelinks"]
    assert sitelinks.payload == {"count": 2, "organic_rank": 1}
    assert [url.url for url in sitelinks.source_urls] == ["https://www.example-crm.com/startups"]


def test_feat_06_a_payload_is_cut_to_fit_and_two_blocks_have_two_ordinals() -> None:
    questions = [{"title": "q" * 300 + str(n), "expanded_element": None} for n in range(60)]
    parsed = parse_serp(
        serp(
            [
                {"type": "people_also_ask", "items": questions},
                {"type": "video", "items": [{"url": "https://a.example/1"}]},
                {"type": "short_videos", "items": [{"url": "https://a.example/2"}]},
            ]
        )
    )

    (paa,) = [f for f in parsed.features if f.feature_type == "people_also_ask"]
    assert paa.payload is not None
    assert len(json.dumps(paa.payload, separators=(",", ":")).encode()) <= PAYLOAD_MAX_BYTES
    assert paa.payload["truncated"] is True
    assert [f.ordinal for f in parsed.features if f.feature_type == "video"] == [1, 2]


def test_a_payload_that_cannot_be_cut_is_replaced() -> None:
    huge = {
        "type": "featured_snippet",
        "featured_title": "t" * 10_000,
        "url": "https://a.example/x",
    }

    feature = _only("featured_snippet", huge)

    assert feature.payload == {"truncated": True}


# AIO: the AI Overview slot (doc 06 section 5.5).


def test_aio_01_the_state_follows_the_asynchronous_flag_and_the_item() -> None:
    cached = parse_serp(
        serp(
            [
                {
                    "type": "ai_overview",
                    "asynchronous_ai_overview": False,
                    "references": [{"url": "https://a.example/x"}],
                }
            ]
        )
    )
    loaded = parse_serp(
        serp(
            [
                {
                    "type": "ai_overview",
                    "asynchronous_ai_overview": True,
                    "references": [{"url": "https://a.example/x"}],
                }
            ]
        )
    )
    not_loaded = parse_serp(serp([{"type": "ai_overview", "asynchronous_ai_overview": True}]))
    absent = parse_serp(serp([organic(1, "https://example.com/a")]))

    assert [s.ai_overview.state for s in (cached, loaded, not_loaded, absent)] == [
        "present",
        "present_async_loaded",
        "present_not_loaded",
        "absent",
    ]
    assert absent.ai_overview.citations == ()


def test_aio_02_references_come_first_then_inline_links_and_no_url_twice() -> None:
    urls = [url.url for url in rich().ai_overview.citations]

    assert urls == [
        "https://www.example-crm.com/startups",
        "https://reviews.example.org/crm",
        "https://blog.example.net/crm-guide",
    ]


def test_aio_07_the_feature_exists_exactly_when_the_overview_is_present() -> None:
    with_aio = rich()
    without = parse_serp(serp([organic(1, "https://example.com/a")]))
    not_loaded = parse_serp(serp([{"type": "ai_overview", "asynchronous_ai_overview": True}]))

    for parsed in (with_aio, without, not_loaded):
        present = parsed.ai_overview.state != "absent"
        assert present == any(f.feature_type == "ai_overview" for f in parsed.features)
    (feature,) = [f for f in with_aio.features if f.feature_type == "ai_overview"]
    assert feature.payload == {
        "asynchronous": False,
        "elements": 2,
        "has_table": True,
        "has_video": False,
    }


# The answer.


def test_an_answer_with_no_results_is_an_empty_serp() -> None:
    parsed = parse_serp(_load(SERP / "serp_no_results.json"))

    assert parsed.organic == ()
    assert parsed.features == ()
    assert parsed.ai_overview.state == "absent"
    assert parsed.warnings == ("no_results",)


def test_a_serp_with_items_null_is_empty_and_the_bytes_read_like_the_object() -> None:
    body = serp(None)

    assert parse_serp(body).organic == ()
    assert parse_serp(json.dumps(body).encode()) == parse_serp(body)


@pytest.mark.parametrize(
    ("body", "path"),
    [
        (b"not json", "$"),
        ([], "$"),
        ({"tasks": []}, "tasks[]"),
        ({"tasks": [{"status_code": 20000, "result": None}]}, "tasks[].result[]"),
        (serp("nope"), "tasks[].result[].items"),
        (serp(["not an object"]), "tasks[].result[].items[0]"),
        (serp([{"rank_group": 1}]), "tasks[].result[].items[].type"),
        (serp([organic(1, "https://example.com/a") | {"rank_group": "1"}]), "items[].rank_group"),
        (serp([], se_results_count="many"), "tasks[].result[].se_results_count"),
        (serp([], keyword=5), "tasks[].result[].keyword"),
    ],
)
def test_an_answer_not_shaped_as_read_is_a_schema_mismatch(body: Any, path: str) -> None:
    with pytest.raises(SerpSchemaMismatchError) as raised:
        parse_serp(body)

    assert raised.value.path == path


def test_a_spell_without_its_parts_is_not_read() -> None:
    assert parse_serp(serp([], spell={"type": "did_you_mean"})).spell is None
    assert parse_serp(serp([], spell="oops")).spell is None


def test_a_rating_is_read_when_it_has_a_value() -> None:
    parsed = rich()

    assert parsed.organic[0].rating is not None
    assert (parsed.organic[0].rating.value, parsed.organic[0].rating.votes) == (4.6, 812)
    assert parsed.organic[1].rating is None
    assert "is_video" in parsed.organic[1].checks


# The fixtures and their registry (docs/26-testing-quality.md section 3.3).


def _registry() -> Mapping[str, Any]:
    loaded: Mapping[str, Any] = json.loads((SERP / "registry.json").read_text())
    return loaded


@pytest.mark.gold
def test_each_fixtures_schema_hash_matches_its_record() -> None:
    for record in _registry()["fixtures"]:
        document = _load(FIXTURES / record["file"])
        assert schema_hash(document) == record["schema_hash"], record["id"]


@pytest.mark.gold
def test_every_path_the_parser_reads_exists_in_the_fixtures() -> None:
    union: set[str] = set()
    for record in _registry()["fixtures"]:
        union |= schema_paths(_load(FIXTURES / record["file"]))
    paths = frozenset(union)

    missing = [path for path in READS_PATHS if not reads(paths, path)]

    assert missing == []


@pytest.mark.gold
def test_every_fixture_parses() -> None:
    for record in _registry()["fixtures"]:
        parse_serp(_load(FIXTURES / record["file"]))


def test_the_schema_hash_ignores_values_and_lengths_but_not_shape() -> None:
    one = {"tasks": [{"result": [{"items": [{"rank_group": 1}]}]}]}
    longer = {"tasks": [{"result": [{"items": [{"rank_group": 7}, {"rank_group": 9}]}]}]}
    retyped = {"tasks": [{"result": [{"items": [{"rank_group": "1"}]}]}]}
    extra = {"tasks": [{"result": [{"items": [{"rank_group": 1, "xpath": "/html"}]}]}]}

    assert schema_hash(one) == schema_hash(longer)
    assert len({schema_hash(one), schema_hash(retyped), schema_hash(extra)}) == 3
    assert "tasks[].result[].items[].rank_group:number" in schema_paths(one)
    assert schema_paths([1, "a"]) == frozenset({"$:array", "$[]:number", "$[]:string"})
