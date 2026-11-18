from __future__ import annotations

from idraft.crawl.paths import Hop, rebuild_route


def hop(source: int, target: int, anchor: str = "a") -> Hop:
    return Hop(source=source, target=target, anchor=anchor, placement="content", scope="editorial")


def test_a_route_is_the_start_then_every_hop_to_the_target() -> None:
    parents = {2: hop(1, 2, "services"), 3: hop(2, 3, "SOC")}
    route = rebuild_route(parents, 1, 3)
    assert route is not None
    assert [(step.url_id, step.hop.anchor if step.hop else None) for step in route] == [
        (1, None),
        (2, "services"),
        (3, "SOC"),
    ]


def test_the_start_page_is_a_route_of_one_step() -> None:
    route = rebuild_route({}, 1, 1)
    assert route is not None
    assert [step.url_id for step in route] == [1]


def test_a_target_the_search_never_reached_has_no_route() -> None:
    assert rebuild_route({2: hop(1, 2)}, 1, 9) is None


def test_a_loop_in_the_parents_is_refused_instead_of_followed_forever() -> None:
    parents = {2: hop(3, 2), 3: hop(2, 3)}
    assert rebuild_route(parents, 1, 3) is None
