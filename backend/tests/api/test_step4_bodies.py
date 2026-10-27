"""The request rules of the entity, taxonomy and registry bodies (docs/19 sections 3.4, 3.5), which
hold before any route reads them."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from idraft.api.schemas.entities import (
    AliasInput,
    AliasTestRequest,
    AliasUpdate,
    DomainInput,
    EntityCreate,
    OwnEntityInput,
    ProjectEntityCreate,
    ProjectEntityUpdate,
)
from idraft.api.schemas.taxonomy import TermInput, TermUpdate, VocabularyCreate


def _codes(model: type[BaseModel], body: dict[str, Any]) -> list[str]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(body)
    return [error["type"] for error in caught.value.errors()]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"domain": "exa mple.com"}, "invalid_domain"),
        ({"domain": "ftp://acme.com"}, "invalid_domain"),
        ({"domain": "co.uk"}, "domain_is_public_suffix"),
        ({"domain": "https://github.io/"}, "domain_is_public_suffix"),
        ({"domain": "medium.com", "match_scope": "path_prefix"}, "path_prefix_mismatch"),
        ({"domain": "acme.com", "path_prefix": "/a"}, "path_prefix_mismatch"),
        (
            {"domain": "medium.com", "match_scope": "path_prefix", "path_prefix": "/a?b"},
            "invalid_path_prefix",
        ),
    ],
)
def test_a_domain_is_read_as_the_canonicalizer_reads_it(body: dict[str, Any], code: str) -> None:
    assert code in _codes(DomainInput, body)


def test_a_domain_and_prefix_are_kept_in_canonical_form() -> None:
    domain = DomainInput.model_validate(
        {"domain": " https://Medium.com/x ", "match_scope": "path_prefix", "path_prefix": "@acme/"}
    )
    assert (domain.domain, domain.path_prefix) == ("https://Medium.com/x", "/@acme")
    assert DomainInput.model_validate({"domain": "alice.github.io"}).match_scope == "registrable"
    # A host under a public suffix is fine as a host rule.
    assert DomainInput.model_validate({"domain": "co.uk", "match_scope": "host"})


def test_a_word_alias_is_trimmed_and_a_pattern_is_not() -> None:
    assert AliasInput.model_validate({"alias": "  HubSpot "}).alias == "HubSpot"
    assert AliasInput.model_validate({"alias": " hub ", "match_mode": "regex"}).alias == " hub "
    assert "string_too_short" in _codes(AliasInput, {"alias": "   "})


@pytest.mark.parametrize("pattern", ["(acme", r"(a)\1", "(?=a)"])
def test_a_pattern_re2_cannot_compile_is_refused(pattern: str) -> None:
    assert _codes(AliasInput, {"alias": pattern, "match_mode": "regex"}) == ["invalid_regex"]


@pytest.mark.parametrize(
    ("model", "body"),
    [
        (AliasUpdate, {}),
        (ProjectEntityUpdate, {}),
        (TermUpdate, {}),
        (AliasUpdate, {"alias": None}),
        (ProjectEntityUpdate, {"role": None}),
        (TermUpdate, {"name": None}),
    ],
)
def test_a_change_says_something_and_only_clears_what_may_be_cleared(
    model: type[BaseModel], body: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(body)


def test_fields_that_may_be_cleared() -> None:
    assert AliasUpdate.model_validate({"language_code": None}).language_code is None
    assert ProjectEntityUpdate.model_validate({"color_index": None}).color_index is None
    assert TermUpdate.model_validate({"parent_id": None}).parent_id is None


def test_a_color_is_one_of_the_six_chart_colours() -> None:
    entity_id = "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11"
    for index in (0, 7, "1"):
        with pytest.raises(ValidationError):
            ProjectEntityCreate.model_validate(
                {"entity_id": entity_id, "role": "competitor", "color_index": index}
            )
    created = ProjectEntityCreate.model_validate(
        {"entity_id": entity_id, "role": "competitor", "color_index": 6}
    )
    assert created.color_index == 6


def test_an_entity_is_created_with_its_aliases_and_domains_checked() -> None:
    body = {
        "entity_type": "brand",
        "canonical_name": " Acme ",
        "aliases": [{"alias": "Acme"}, {"alias": "acme[", "match_mode": "regex"}],
        "domains": [{"domain": "acme.com"}],
    }
    assert _codes(EntityCreate, body) == ["invalid_regex"]
    body["aliases"] = [{"alias": "Acme"}]
    assert EntityCreate.model_validate(body).canonical_name == "Acme"
    assert "invalid_domain" in _codes(OwnEntityInput, {"canonical_name": "A", "domains": ["a b"]})


def test_the_alias_test_takes_exactly_one_text() -> None:
    assert _codes(AliasTestRequest, {}) == ["one_of"]
    assert _codes(AliasTestRequest, {"text": "a", "markdown": "a"}) == ["one_of"]
    assert AliasTestRequest.model_validate({"markdown": "**Acme**"}).markdown == "**Acme**"


def test_a_term_is_named_or_given_a_path_from_the_root() -> None:
    assert _codes(TermInput, {}) == ["one_of"]
    assert _codes(TermInput, {"name": "CRM", "path": "CRM"}) == ["one_of"]
    parent = "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11"
    assert _codes(TermInput, {"path": "CRM/Startups", "parent_id": parent}) == ["one_of"]
    assert _codes(TermInput, {"path": "CRM//Startups"}) == ["invalid_term_path"]
    assert TermInput.model_validate({"path": " CRM / CRM for Startups "}).path == (
        "CRM/CRM for Startups"
    )
    assert "string_pattern_mismatch" in _codes(TermInput, {"name": "CRM", "slug": "Not A Slug"})


def test_a_vocabulary_kind_is_one_of_doc_04s() -> None:
    assert "literal_error" in _codes(VocabularyCreate, {"kind": "colour", "name": "Colours"})
