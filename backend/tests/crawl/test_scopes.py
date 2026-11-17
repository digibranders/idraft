"""Placements and the link scopes the screens filter by (spec section 4)."""

import pytest

from idraft.crawl.scopes import EDGE_SCOPES, PLACEMENTS, LinkScope, in_scope, scope_of


@pytest.mark.parametrize(
    ("placement", "scope"),
    [
        ("content", LinkScope.EDITORIAL),
        ("auto_generated", LinkScope.AUTO_GENERATED),
        ("navigation", LinkScope.TEMPLATE),
        ("header", LinkScope.TEMPLATE),
        ("footer", LinkScope.TEMPLATE),
        ("sidebar", LinkScope.TEMPLATE),
        ("breadcrumb", LinkScope.TEMPLATE),
    ],
)
def test_every_placement_has_one_scope(placement: str, scope: LinkScope) -> None:
    assert scope_of(placement) is scope


def test_the_placements_are_the_seven_of_the_spec() -> None:
    assert len(PLACEMENTS) == 7
    assert {scope_of(placement) for placement in PLACEMENTS} == set(EDGE_SCOPES)


def test_an_unknown_placement_is_refused() -> None:
    with pytest.raises(ValueError, match="placement"):
        scope_of("menu")


def test_all_takes_every_scope_and_the_others_only_themselves() -> None:
    for edge in EDGE_SCOPES:
        assert in_scope(edge, LinkScope.ALL)
        assert in_scope(edge, edge)
    assert not in_scope(LinkScope.TEMPLATE, LinkScope.EDITORIAL)
