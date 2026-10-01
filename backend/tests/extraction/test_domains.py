"""Domain role resolution, stage 2 (docs/13-ai-extraction-engine.md section 4)."""

from __future__ import annotations

import uuid

import pytest

from sightline.extraction.domains import DomainConflict, DomainResolver, DomainRule
from sightline.extraction.urls import canonicalize, normalize_host, normalize_path_prefix

OWN = uuid.UUID(int=1)
RIVAL = uuid.UUID(int=2)
WATCHED = uuid.UUID(int=3)
OTHER_RIVAL = uuid.UUID(int=4)


def _rule(
    entity_id: uuid.UUID,
    role: str,
    host: str,
    scope: str = "registrable",
    prefix: str | None = None,
) -> DomainRule:
    return DomainRule(
        entity_id=entity_id,
        role=role,  # type: ignore[arg-type]
        match_scope=scope,  # type: ignore[arg-type]
        host=normalize_host(host),
        path_prefix=None if prefix is None else normalize_path_prefix(prefix),
    )


def _resolve(resolver: DomainResolver, url: str) -> tuple[str, uuid.UUID | None, str | None]:
    found = resolver.resolve_url(canonicalize(url))
    return found.domain_role, found.entity_id, found.match_scope


def test_a_registrable_rule_covers_every_host_of_the_domain() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "acme.com")])
    assert _resolve(resolver, "https://blog.acme.com/a") == ("own", OWN, "registrable")
    assert _resolve(resolver, "https://acme.com/") == ("own", OWN, "registrable")


def test_a_registrable_rule_given_with_www_still_covers_the_domain() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "https://www.acme.com/")])
    assert _resolve(resolver, "https://docs.acme.com/") == ("own", OWN, "registrable")


def test_nothing_matching_is_third_party() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "acme.com")])
    assert _resolve(resolver, "https://example.com/") == ("third_party", None, None)
    assert _resolve(resolver, "https://acme.com.evil.io/") == ("third_party", None, None)


def test_a_host_rule_beats_a_registrable_rule() -> None:
    resolver = DomainResolver(
        [_rule(OWN, "own", "acme.com"), _rule(RIVAL, "competitor", "docs.acme.com", "host")]
    )
    assert _resolve(resolver, "https://docs.acme.com/a") == ("competitor", RIVAL, "host")
    assert _resolve(resolver, "https://www.acme.com/a") == ("own", OWN, "registrable")


def test_a_host_rule_is_exact() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "acme.com", "host")])
    assert _resolve(resolver, "https://acme.com/") == ("own", OWN, "host")
    assert _resolve(resolver, "https://www.acme.com/") == ("third_party", None, None)


def test_a_path_prefix_rule_beats_a_host_rule() -> None:
    resolver = DomainResolver(
        [
            _rule(RIVAL, "competitor", "medium.com", "host"),
            _rule(OWN, "own", "medium.com", "path_prefix", "/@acme"),
        ]
    )
    assert _resolve(resolver, "https://medium.com/@acme/launch") == ("own", OWN, "path_prefix")
    assert _resolve(resolver, "https://medium.com/@acme") == ("own", OWN, "path_prefix")
    assert _resolve(resolver, "https://medium.com/@other") == ("competitor", RIVAL, "host")


def test_a_path_prefix_matches_whole_segments_only() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "github.com", "path_prefix", "/acme")])
    assert _resolve(resolver, "https://github.com/acme/sdk") == ("own", OWN, "path_prefix")
    assert _resolve(resolver, "https://github.com/acmecorp") == ("third_party", None, None)
    assert _resolve(resolver, "https://www.github.com/acme") == ("third_party", None, None)


def test_the_longest_path_prefix_wins() -> None:
    resolver = DomainResolver(
        [
            _rule(RIVAL, "competitor", "github.com", "path_prefix", "/acme"),
            _rule(OWN, "own", "github.com", "path_prefix", "/acme/sdk"),
        ]
    )
    assert _resolve(resolver, "https://github.com/acme/sdk/issues") == ("own", OWN, "path_prefix")
    assert _resolve(resolver, "https://github.com/acme/web") == (
        "competitor",
        RIVAL,
        "path_prefix",
    )


def test_a_root_path_prefix_covers_the_host() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "acme.com", "path_prefix", "/")])
    assert _resolve(resolver, "https://acme.com/anything") == ("own", OWN, "path_prefix")


def test_a_watched_entity_is_named_but_counts_as_third_party() -> None:
    resolver = DomainResolver([_rule(WATCHED, "watch", "g2.com")])
    assert _resolve(resolver, "https://www.g2.com/products/acme") == (
        "third_party",
        WATCHED,
        "registrable",
    )


def test_own_wins_a_tie_and_the_tie_is_reported() -> None:
    resolver = DomainResolver(
        [_rule(RIVAL, "competitor", "acme.com"), _rule(OWN, "own", "www.acme.com")]
    )
    found = resolver.resolve_url(canonicalize("https://acme.com/"))
    assert (found.domain_role, found.entity_id) == ("own", OWN)
    assert found.conflicting_entity_ids == (RIVAL,)


def test_a_competitor_beats_a_watched_entity_in_a_tie() -> None:
    resolver = DomainResolver(
        [_rule(WATCHED, "watch", "acme.com"), _rule(RIVAL, "competitor", "acme.com")]
    )
    found = resolver.resolve_url(canonicalize("https://acme.com/"))
    assert (found.domain_role, found.entity_id) == ("competitor", RIVAL)
    assert found.conflicting_entity_ids == (WATCHED,)


def test_a_tie_between_two_competitors_is_decided_the_same_way_every_time() -> None:
    rules = [_rule(OTHER_RIVAL, "competitor", "acme.com"), _rule(RIVAL, "competitor", "acme.com")]
    first = DomainResolver(rules).resolve_url(canonicalize("https://acme.com/"))
    second = DomainResolver(list(reversed(rules))).resolve_url(canonicalize("https://acme.com/"))
    assert first == second
    assert first.entity_id == RIVAL
    assert first.conflicting_entity_ids == (OTHER_RIVAL,)


def test_one_entity_claiming_a_domain_twice_is_not_a_conflict() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "acme.com"), _rule(OWN, "own", "www.acme.com")])
    found = resolver.resolve_url(canonicalize("https://acme.com/"))
    assert found.entity_id == OWN
    assert found.conflicting_entity_ids == ()
    assert resolver.conflicts() == ()


def test_conflicts_lists_every_misconfiguration_with_its_winner() -> None:
    resolver = DomainResolver(
        [
            _rule(RIVAL, "competitor", "acme.com"),
            _rule(OWN, "own", "acme.com"),
            _rule(RIVAL, "competitor", "github.com", "path_prefix", "/acme"),
            _rule(WATCHED, "watch", "github.com", "path_prefix", "/acme/"),
            _rule(OWN, "own", "github.com", "path_prefix", "/acme/sdk"),
        ]
    )
    assert resolver.conflicts() == (
        DomainConflict(
            match_scope="path_prefix",
            key="github.com/acme",
            winner=RIVAL,
            losers=(WATCHED,),
        ),
        DomainConflict(match_scope="registrable", key="acme.com", winner=OWN, losers=(RIVAL,)),
    )


def test_the_resolver_accepts_parts_as_well_as_a_canonical_url() -> None:
    resolver = DomainResolver([_rule(OWN, "own", "acme.com")])
    host = normalize_host("blog.acme.com")
    assert resolver.resolve(host, "/a").entity_id == OWN


@pytest.mark.parametrize("scope", ["host", "registrable"])
def test_a_prefix_on_a_rule_that_is_not_a_path_prefix_is_refused(scope: str) -> None:
    with pytest.raises(ValueError, match="path_prefix"):
        _rule(OWN, "own", "acme.com", scope, "/a")


def test_a_path_prefix_rule_without_a_prefix_is_refused() -> None:
    with pytest.raises(ValueError, match="path_prefix"):
        _rule(OWN, "own", "acme.com", "path_prefix")
