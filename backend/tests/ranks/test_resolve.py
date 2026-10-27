"""Who ranks where on a SERP (docs/26-testing-quality.md section 4.2: RANK-01 to 09)."""

from __future__ import annotations

from typing import Any

import pytest

from idraft.extraction.urls import canonicalize
from idraft.ranks.resolve import (
    EntityRank,
    RankedEntity,
    ResolvedSerp,
    own_side,
    resolve_serp,
    target_url_match,
)
from tests.ranks.support import (
    OTHER_RIVAL,
    OWN,
    OWN_BLOG,
    RIVAL,
    WATCHED,
    resolver,
    rule,
    serp_of,
)

ENTITIES = [RankedEntity(OWN, "own"), RankedEntity(RIVAL, "competitor")]


def entity(resolved: ResolvedSerp, entity_id: Any) -> EntityRank:
    (found,) = [e for e in resolved.entities if e.entity_id == entity_id]
    return found


def test_rank_01_several_urls_of_one_entity_rank_by_its_best() -> None:
    fillers = [f"https://other.example/{i}" for i in range(1, 12)]
    fillers[3] = "https://www.acme.com/pricing"
    fillers[10] = "https://www.acme.com/blog/guide"
    serp = serp_of(*fillers)
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20
    )

    own = entity(resolved, OWN)
    assert own.organic_rank == 4
    assert own.ranking_url is not None
    assert own.ranking_url.path == "/pricing"
    assert own.all_organic_ranks == (4, 11)
    assert own.result_count == 2
    assert [u.path for u in own.all_urls] == ["/pricing", "/blog/guide"]


def test_rank_02_a_subdomain_counts_for_the_registrable_domain_rule() -> None:
    resolved = resolve_serp(
        serp_of("https://blog.acme.com/post"),
        resolver(rule(OWN, "own", "acme.com")),
        ENTITIES,
        depth_requested=20,
    )

    assert entity(resolved, OWN).organic_rank == 1


def test_rank_03_a_host_rule_is_its_own_entity_and_www_stays_with_the_domain() -> None:
    rules = resolver(
        rule(OWN, "own", "acme.com"), rule(OWN_BLOG, "own", "docs.acme.com", scope="host")
    )
    resolved = resolve_serp(
        serp_of("https://docs.acme.com/start", "https://www.acme.com/"),
        rules,
        [RankedEntity(OWN, "own"), RankedEntity(OWN_BLOG, "own")],
        depth_requested=20,
    )

    assert entity(resolved, OWN_BLOG).organic_rank == 1
    assert entity(resolved, OWN).organic_rank == 2


def test_rank_04_a_path_prefix_matches_its_pages_only() -> None:
    rules = resolver(rule(OWN, "own", "medium.com", scope="path_prefix", path_prefix="/@acme"))
    resolved = resolve_serp(
        serp_of("https://medium.com/@other/post", "https://medium.com/@acme/post"),
        rules,
        ENTITIES,
        depth_requested=20,
    )

    assert entity(resolved, OWN).organic_rank == 2


def test_rank_05_equal_claims_go_to_own_with_one_configuration_warning() -> None:
    rules = resolver(rule(OWN, "own", "acme.com"), rule(RIVAL, "competitor", "acme.com"))
    resolved = resolve_serp(serp_of("https://acme.com/a"), rules, ENTITIES, depth_requested=20)

    assert entity(resolved, OWN).organic_rank == 1
    assert entity(resolved, RIVAL).organic_rank is None
    assert len(rules.conflicts()) == 1


def test_rank_06_the_more_specific_host_rule_wins_over_the_registrable_domain() -> None:
    rules = resolver(
        rule(OWN, "own", "acme.com"), rule(RIVAL, "competitor", "shop.acme.com", scope="host")
    )
    resolved = resolve_serp(
        serp_of("https://shop.acme.com/cart"), rules, ENTITIES, depth_requested=20
    )

    assert entity(resolved, RIVAL).organic_rank == 1
    assert entity(resolved, OWN).organic_rank is None


def test_rank_07_an_excluded_competitor_has_no_row() -> None:
    rules = resolver(rule(OWN, "own", "acme.com"), rule(RIVAL, "competitor", "rival.com"))
    serp = serp_of("https://rival.com/a", "https://acme.com/b")

    kept = resolve_serp(serp, rules, ENTITIES, depth_requested=20)
    excluded = resolve_serp(serp, rules, ENTITIES, depth_requested=20, excluded=[RIVAL])

    assert {e.entity_id for e in kept.entities} == {OWN, RIVAL}
    assert {e.entity_id for e in excluded.entities} == {OWN}
    assert entity(excluded, OWN).organic_rank == 2


def test_rank_08_a_ranking_url_that_is_not_the_target_does_not_match() -> None:
    rules = resolver(rule(OWN, "own", "acme.com"))
    side = own_side(
        resolved := resolve_serp(
            serp := serp_of("https://acme.com/blog"), rules, ENTITIES, depth_requested=20
        ),
        serp,
    )

    assert side.ranking_url is not None
    assert target_url_match(side, canonicalize("https://acme.com/pricing").url_hash) is False
    assert target_url_match(side, canonicalize("https://acme.com/blog/").url_hash) is True
    assert target_url_match(side, None) is None
    assert resolved.entities[0].organic_rank == 1


def test_rank_09_urls_differing_only_by_tracking_or_a_slash_are_the_same_url() -> None:
    rules = resolver(rule(OWN, "own", "acme.com"))
    one = resolve_serp(
        serp_of("https://acme.com/pricing/?utm_source=x"), rules, ENTITIES, depth_requested=20
    )
    two = resolve_serp(serp_of("https://acme.com/pricing"), rules, ENTITIES, depth_requested=20)

    first, second = entity(one, OWN).ranking_url, entity(two, OWN).ranking_url
    assert first is not None
    assert second is not None
    assert first.url_hash == second.url_hash


def test_a_rank_beyond_the_depth_requested_is_never_read() -> None:
    serp = serp_of("https://a.example/", "https://b.example/", "https://acme.com/c")
    rules = resolver(rule(OWN, "own", "acme.com"))

    shallow = resolve_serp(serp, rules, ENTITIES, depth_requested=2)
    deep = resolve_serp(serp, rules, ENTITIES, depth_requested=3)

    assert entity(shallow, OWN).organic_rank is None
    assert entity(shallow, OWN).all_organic_ranks == ()
    assert entity(deep, OWN).organic_rank == 3


def test_a_watched_entity_counts_for_nobody() -> None:
    rules = resolver(rule(OWN, "own", "acme.com"), rule(WATCHED, "watch", "press.example"))
    resolved = resolve_serp(
        serp_of("https://press.example/a", "https://acme.com/b"),
        rules,
        ENTITIES,
        depth_requested=20,
    )

    assert entity(resolved, OWN).organic_rank == 2
    assert {e.entity_id for e in resolved.entities} == {OWN, RIVAL}


def test_every_rank_of_an_entity_has_its_url_in_the_same_order() -> None:
    serp = serp_of(
        "https://acme.com/a", "https://x.example/", "https://acme.com/b", "https://acme.com/c"
    )
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20
    )

    own = entity(resolved, OWN)
    assert own.all_organic_ranks == (1, 3, 4)
    assert [u.path for u in own.all_urls] == ["/a", "/b", "/c"]


def test_the_own_side_is_the_best_rank_among_own_entities() -> None:
    rules = resolver(
        rule(OWN, "own", "acme.com"),
        rule(OWN_BLOG, "own", "acmeblog.com"),
        rule(RIVAL, "competitor", "rival.com"),
    )
    entities = [
        RankedEntity(OWN, "own"),
        RankedEntity(OWN_BLOG, "own"),
        RankedEntity(RIVAL, "competitor"),
    ]
    serp = serp_of("https://rival.com/", "https://acmeblog.com/p", "https://acme.com/q")

    side = own_side(resolve_serp(serp, rules, entities, depth_requested=20), serp)

    assert (side.entity_id, side.organic_rank, side.absolute_rank) == (OWN_BLOG, 2, 2)
    assert side.ranking_url is not None
    assert side.ranking_url.host.name == "acmeblog.com"


def test_an_own_side_that_does_not_rank_has_no_entity_or_url() -> None:
    serp = serp_of("https://rival.com/")
    side = own_side(
        resolve_serp(serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20),
        serp,
    )

    assert (side.entity_id, side.organic_rank, side.ranking_url) == (None, None, None)


# Features and the AI Overview.


def _feature(kind: str, *urls: str) -> dict[str, Any]:
    return {
        "type": kind,
        "rank_absolute": 2,
        "position": "left",
        "items": [{"url": url, "title": "x"} for url in urls],
    }


def test_a_feature_is_owned_when_one_of_its_sources_is_ours() -> None:
    serp = serp_of(
        "https://a.example/",
        extra=[
            _feature("video", "https://v.example/1", "https://rival.com/v", "https://acme.com/v")
        ],
    )
    rules = resolver(rule(OWN, "own", "acme.com"), rule(RIVAL, "competitor", "rival.com"))

    resolved = resolve_serp(serp, rules, ENTITIES, depth_requested=20)

    (ownership,) = resolved.features
    assert ownership.index == 0
    assert (ownership.owned_by_project, ownership.owned_position) == (True, 3)
    assert ownership.competitor_entity_ids == (RIVAL,)
    assert entity(resolved, OWN).owned_feature_types == ("video",)
    assert entity(resolved, RIVAL).owned_feature_types == ("video",)


def _aio(references: list[str], *, asynchronous: bool = False) -> dict[str, Any]:
    return {
        "type": "ai_overview",
        "rank_absolute": 1,
        "position": "left",
        "asynchronous_ai_overview": asynchronous,
        "references": [{"url": url} for url in references],
        "items": [{"type": "ai_overview_element", "text": "x"}] if references else None,
    }


@pytest.mark.parametrize(
    ("extra", "state", "cited", "position"),
    [
        ([], "absent", None, None),
        ([_aio(["https://x.example/", "https://acme.com/a"])], "present_cited", True, 2),
        ([_aio(["https://x.example/"])], "present_not_cited", False, None),
        ([_aio([], asynchronous=True)], "not_loaded", None, None),
        ([_aio(["https://acme.com/a"], asynchronous=True)], "present_cited", True, 1),
    ],
)
def test_the_ai_overview_verdict_for_the_own_side(
    extra: list[dict[str, Any]], state: str, cited: bool | None, position: int | None
) -> None:
    serp = serp_of("https://acme.com/", extra=extra)
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20
    )
    side = own_side(resolved, serp)

    assert resolved.aio_state == state
    assert (side.cited_in_ai_overview, side.aio_citation_position) == (cited, position)
    assert side.has_ai_overview == (state != "absent")
    assert entity(resolved, OWN).cited_in_ai_overview == cited


def test_entities_come_own_first_then_by_id() -> None:
    rules = resolver(rule(OWN, "own", "acme.com"))
    entities = [
        RankedEntity(OTHER_RIVAL, "competitor"),
        RankedEntity(RIVAL, "competitor"),
        RankedEntity(OWN, "own"),
    ]

    resolved = resolve_serp(serp_of("https://acme.com/"), rules, entities, depth_requested=20)

    assert [e.entity_id for e in resolved.entities] == [OWN, RIVAL, OTHER_RIVAL]


def test_a_depth_below_one_is_refused() -> None:
    with pytest.raises(ValueError, match="depth_requested"):
        resolve_serp(serp_of(), resolver(), ENTITIES, depth_requested=0)


# Review findings of Task 3.


def test_a_grouped_sub_result_is_another_url_at_its_parents_rank() -> None:
    serp = serp_of(
        "https://other.example/",
        "https://acme.com/a",
        more={
            2: {
                "related_result": [{"url": "https://acme.com/a/sub"}, {"url": "https://x.example/"}]
            }
        },
    )
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20
    )

    own = entity(resolved, OWN)
    assert own.all_organic_ranks == (2, 2)
    assert [u.path for u in own.all_urls] == ["/a", "/a/sub"]
    assert own.result_count == 1
    assert (own.organic_rank, own.ranking_url.path if own.ranking_url else None) == (2, "/a")


def test_features_past_the_first_page_do_not_count_for_the_state() -> None:
    urls = [f"https://other-{i}.example/" for i in range(1, 13)]
    urls[11] = "https://acme.com/deep"
    serp = serp_of(*urls, more={12: {"links": [{"url": "https://acme.com/deep/a"}]}})
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=100
    )
    side = own_side(resolved, serp)

    (ownership,) = resolved.features
    assert ownership.owned_by_project is True
    assert ownership.on_page_one is False
    assert entity(resolved, OWN).owned_feature_types == ("sitelinks",)
    assert side.owned_feature_types == ()
    assert side.feature_types_present == ()


def test_features_on_the_first_page_count_and_a_short_page_is_all_first_page() -> None:
    serp = serp_of("https://acme.com/a", more={1: {"links": [{"url": "https://acme.com/a/x"}]}})
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20
    )
    side = own_side(resolved, serp)

    assert side.owned_feature_types == ("sitelinks",)
    assert side.feature_types_present == ("sitelinks",)


def test_the_ai_overview_is_cited_not_owned() -> None:
    serp = serp_of("https://acme.com/", extra=[_aio(["https://acme.com/a"])])
    resolved = resolve_serp(
        serp, resolver(rule(OWN, "own", "acme.com")), ENTITIES, depth_requested=20
    )
    side = own_side(resolved, serp)

    assert entity(resolved, OWN).owned_feature_types == ()
    assert side.owned_feature_types == ()
    assert side.cited_in_ai_overview is True
    # The feature row still says whose sources it lists.
    (ownership,) = resolved.features
    assert ownership.owned_by_project is True
