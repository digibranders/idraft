"""Term slugs made from names."""

from __future__ import annotations

import re

import pytest

from sightline.api.schemas.taxonomy import SLUG_MAX, SLUG_PATTERN
from sightline.api.taxonomy.slugs import FALLBACK_SLUG, free_slug, slugify


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("CRM for Startups", "crm-for-startups"),
        ("  Caf\N{LATIN SMALL LETTER E WITH ACUTE} & Bars!  ", "cafe-bars"),
        ("Stra\N{LATIN SMALL LETTER SHARP S}e", "strasse"),
        ("\N{LATIN CAPITAL LETTER I WITH DOT ABOVE}stanbul", "istanbul"),
        ("B2B -- SaaS", "b2b-saas"),
        ("***", FALLBACK_SLUG),
        ("\N{CJK UNIFIED IDEOGRAPH-65E5}\N{CJK UNIFIED IDEOGRAPH-672C}", FALLBACK_SLUG),
        ("\N{FULLWIDTH LATIN CAPITAL LETTER A}1", "a1"),
    ],
)
def test_a_name_becomes_a_lower_case_slug(name: str, slug: str) -> None:
    assert slugify(name) == slug
    assert re.fullmatch(SLUG_PATTERN, slug)


def test_a_long_name_is_cut_without_a_trailing_hyphen() -> None:
    slug = slugify("a" * 99 + " bcd")
    assert slug == "a" * 99
    assert len(slugify("word " * 50)) <= SLUG_MAX
    assert re.fullmatch(SLUG_PATTERN, slugify("word " * 50))


def test_a_taken_slug_gets_the_first_free_number() -> None:
    assert free_slug("crm", set()) == "crm"
    assert free_slug("crm", {"crm"}) == "crm-2"
    assert free_slug("crm", {"crm", "crm-2", "crm-3"}) == "crm-4"


def test_a_numbered_slug_still_fits() -> None:
    base = "a" * SLUG_MAX
    numbered = free_slug(base, {base})
    assert numbered == "a" * (SLUG_MAX - 2) + "-2"
    hyphen_at_cut = "a" * (SLUG_MAX - 3) + "-bc"
    assert free_slug(hyphen_at_cut, {hyphen_at_cut}) == "a" * (SLUG_MAX - 3) + "-2"
