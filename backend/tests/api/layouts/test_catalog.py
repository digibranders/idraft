"""The layout catalog the API checks documents against (BE-LAYOUTS-06, 07, 08). No database."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.exceptions import RequestValidationError

from idraft.api.layouts import catalog
from idraft.api.layouts.catalog import CatalogFile
from idraft.api.schemas.ai_layouts import CARDS_MAX, NUMBERS_MAX, LayoutDocument

REPO = Path(__file__).resolve().parents[4]
DOCUMENT: dict[str, Any] = {
    "schema": 1,
    "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "chatgpt_web"}],
    "cards": [{"id": "c1", "type": "ai.by_engine", "width": "half"}],
}


def errors(screen: str, document: dict[str, Any]) -> list[tuple[str, str]]:
    found = catalog.document_errors(screen, LayoutDocument.model_validate(document))
    return [(error.path, error.code) for error in found]


def document_of_size(target: int) -> LayoutDocument:
    """A valid `overview` document whose stored text is exactly `target` bytes."""

    def build(keys: int, pad_a: int, pad_b: int) -> dict[str, Any]:
        options = {f"k{index:02d}": "x" * 256 for index in range(keys)}
        options["pad_a"] = "x" * pad_a
        options["pad_b"] = "x" * pad_b
        return {"schema": 1, "cards": [{"id": "c1", "type": "ai.by_engine", "options": options}]}

    empty = catalog.document_size(build(0, 0, 0))
    per_key = catalog.document_size(build(1, 0, 0)) - empty
    keys = (target - empty) // per_key
    spare = target - catalog.document_size(build(keys, 0, 0))
    document = build(keys, min(256, spare), max(0, spare - 256))
    assert catalog.document_size(document) == target
    return LayoutDocument.model_validate(document)


def test_the_catalog_file_has_the_shape_the_api_reads() -> None:
    assert catalog.FILE.limits.cards == CARDS_MAX
    assert catalog.FILE.limits.numbers == NUMBERS_MAX


def test_the_catalog_names_only_screens_of_the_api() -> None:
    listed = set(catalog.FILE.screens)
    assert listed <= catalog.SCREENS
    for card_type in catalog.FILE.card_types:
        assert set(card_type.screens) <= listed, card_type.key
    for number in catalog.FILE.numbers:
        assert set(number.screens) <= listed, number.metric


def test_the_catalog_was_generated_from_the_web_catalog_as_it_is() -> None:
    source = REPO / "apps/web/src/lib/layouts/catalog.ts"
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == catalog.FILE.source_sha256, "run `pnpm gen:layout-catalog` in apps/web"


def test_inspector_topic_and_ai_overview_are_screens() -> None:
    assert {"inspector.topic", "ai_overview"} <= catalog.SCREENS
    assert len(catalog.SCREENS) == 12


def test_a_valid_overview_document_has_no_errors() -> None:
    assert errors("overview", DOCUMENT) == []


def test_a_card_type_of_another_screen_is_refused() -> None:
    document = {"schema": 1, "cards": [{"id": "c1", "type": "ai.by_engine"}]}
    assert errors("inspector.keyword", document) == [("cards.0.type", "not_in_catalog")]


def test_a_width_the_type_does_not_allow_is_refused() -> None:
    document = {
        "schema": 1,
        "cards": [{"id": "c1", "type": "seo.rank_distribution", "width": "full"}],
    }
    assert errors("overview", document) == [("cards.0.width", "width_not_allowed")]


def test_a_width_on_a_screen_without_widths_is_refused() -> None:
    document = {
        "schema": 1,
        "cards": [{"id": "c1", "type": "inspector.rank_history", "width": "half"}],
    }
    assert errors("inspector.keyword", document) == [("cards.0.width", "width_not_allowed")]


def test_numbers_on_a_screen_without_numbers_are_refused() -> None:
    document = {"schema": 1, "numbers": [{"id": "n1", "metric": "seo.top10_count"}]}
    assert errors("inspector.keyword", document) == [("numbers", "not_on_screen")]


def test_an_ai_number_names_its_engine() -> None:
    document = {"schema": 1, "numbers": [{"id": "n1", "metric": "ai.mention_rate"}]}
    assert errors("overview", document) == [("numbers.0.engine", "required")]


def test_an_seo_number_names_no_engine() -> None:
    number = {"id": "n1", "metric": "seo.top10_count", "engine": "chatgpt_web"}
    assert errors("overview", {"schema": 1, "numbers": [number]}) == [
        ("numbers.0.engine", "not_applicable")
    ]


def test_an_unknown_metric_is_refused() -> None:
    document = {"schema": 1, "numbers": [{"id": "n1", "metric": "ai.mentions"}]}
    assert errors("overview", document) == [("numbers.0.metric", "not_in_catalog")]


def test_a_screen_the_catalog_does_not_list_takes_only_an_empty_document() -> None:
    assert errors("citations", {"schema": 1}) == []
    assert errors("citations", {"schema": 1, "cards": [], "numbers": []}) == []
    one_card = {"schema": 1, "cards": [{"id": "c1", "type": "ai.by_engine"}]}
    assert errors("citations", one_card) == [("cards", "not_on_screen")]


def test_every_error_is_reported_in_order() -> None:
    document = {
        "schema": 1,
        "numbers": [
            {"id": "n1", "metric": "ai.mention_rate"},
            {"id": "n2", "metric": "ai.mentions"},
        ],
        "cards": [
            {"id": "c1", "type": "ai.by_engine"},
            {"id": "c2", "type": "no.such_card"},
        ],
    }
    assert errors("overview", document) == [
        ("numbers.0.engine", "required"),
        ("numbers.1.metric", "not_in_catalog"),
        ("cards.1.type", "not_in_catalog"),
    ]


def test_a_retired_card_type_is_accepted() -> None:
    hand_built = catalog.build(
        CatalogFile.model_validate(
            {
                "generated_by": "test",
                "source_sha256": "0" * 64,
                "limits": {"cards": CARDS_MAX, "numbers": NUMBERS_MAX},
                "screens": {"overview": {"numbers": True, "cards": True, "widths": True}},
                "card_types": [
                    {
                        "key": "old.card",
                        "screens": ["overview"],
                        "widths": ["half"],
                        "status": "retired",
                    }
                ],
                "numbers": [],
            }
        )
    )
    document = LayoutDocument.model_validate(
        {"schema": 1, "cards": [{"id": "c1", "type": "old.card", "width": "half"}]}
    )
    assert catalog.document_errors("overview", document, catalog=hand_built) == []


def test_a_width_on_a_screen_whose_zones_have_no_widths_is_refused() -> None:
    # The card type itself lists "half": only the screen's `widths: false` can refuse it.
    hand_built = catalog.build(
        CatalogFile.model_validate(
            {
                "generated_by": "test",
                "source_sha256": "0" * 64,
                "limits": {"cards": CARDS_MAX, "numbers": NUMBERS_MAX},
                "screens": {"overview": {"numbers": True, "cards": True, "widths": False}},
                "card_types": [
                    {
                        "key": "some.card",
                        "screens": ["overview"],
                        "widths": ["half"],
                        "status": "active",
                    }
                ],
                "numbers": [],
            }
        )
    )
    document = LayoutDocument.model_validate(
        {"schema": 1, "cards": [{"id": "c1", "type": "some.card", "width": "half"}]}
    )
    found = catalog.document_errors("overview", document, catalog=hand_built)
    assert [(error.path, error.code) for error in found] == [("cards.0.width", "width_not_allowed")]


def test_the_size_is_the_stored_text() -> None:
    assert catalog.document_size({"schema": 1}) == len('{"schema": 1}') == 13
    document = {"note": chr(0xE9)}
    assert catalog.document_size(document) == len(json.dumps(document, ensure_ascii=False)) + 1


def test_a_document_over_16_kb_is_refused() -> None:
    stored = catalog.stored_document("overview", document_of_size(16384))
    assert catalog.document_size(stored) == 16384
    with pytest.raises(RequestValidationError) as raised:
        catalog.stored_document("overview", document_of_size(16385))
    [error] = raised.value.errors()
    assert error["loc"] == ("body", "")
    assert error["type"] == "too_large"
