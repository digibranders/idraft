from __future__ import annotations

from idraft.crawl.suggest import KeywordHit, SuggestPage, suggest_tiers


def page(
    url_id: int,
    *,
    position: int | None = None,
    manual: bool = False,
    clicks: int = 0,
    hits: tuple[KeywordHit, ...] = (),
) -> SuggestPage:
    return SuggestPage(url_id, position, manual, clicks, hits)


def test_the_top_fifth_by_clicks_that_is_t3_or_lower_is_suggested_for_t2() -> None:
    pages = [page(i, position=3, clicks=c) for i, c in enumerate([500, 400, 10, 5, 1], start=1)]
    found = suggest_tiers(pages, tiers=4, dismissed=set())
    assert [(row.url_id, row.to_position) for row in found] == [(1, 2)]
    assert found[0].reasons[0].kind == "clicks"
    assert found[0].reasons[0].clicks == 500


def test_a_page_ranking_one_to_five_for_a_big_keyword_is_suggested_with_the_best_rank() -> None:
    hits = (KeywordHit("soc", 4, 2900), KeywordHit("managed soc", 2, 2500), KeywordHit("x", 3, 100))
    found = suggest_tiers([page(1, position=4, hits=hits)], tiers=4, dismissed=set())
    assert len(found) == 1
    assert found[0].to_position == 2
    reason = found[0].reasons[0]
    assert (reason.kind, reason.rank, reason.keyword, reason.volume) == (
        "rank",
        2,
        "managed soc",
        2500,
    )


def test_an_untiered_page_with_fifty_clicks_goes_to_t3_when_nothing_else_applies() -> None:
    pages = [page(1, clicks=60)] + [page(i, clicks=1000, position=1) for i in range(2, 12)]
    found = {row.url_id: row for row in suggest_tiers(pages, tiers=4, dismissed=set())}
    assert found[1].to_position == 3
    assert found[1].reasons[0].clicks == 60


def test_manual_dismissed_and_already_high_pages_are_never_suggested() -> None:
    pages = [
        page(1, position=3, clicks=900, manual=True),
        page(2, position=3, clicks=800),
        page(3, position=2, clicks=700),
        page(4, position=1, clicks=600),
    ]
    assert suggest_tiers(pages, tiers=4, dismissed={2}) == []


def test_a_workspace_with_one_tier_suggests_nothing() -> None:
    assert suggest_tiers([page(1, position=3, clicks=999)], tiers=1, dismissed=set()) == []


def test_without_search_console_numbers_only_rank_suggests() -> None:
    hits = (KeywordHit("soc", 1, 5000),)
    pages = [page(1, position=3, hits=hits), page(2, position=3)]
    assert [row.url_id for row in suggest_tiers(pages, tiers=4, dismissed=set())] == [1]
