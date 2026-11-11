"""Prompt text as it is stored, hashed and compared (docs/04 section 8.2)."""

import hashlib

from idraft.ai.text import normalize, text_hash


def test_text_is_trimmed_and_composed() -> None:
    assert normalize("  Café near me?  ") == "Café near me?"


def test_case_and_inner_spacing_are_what_the_engine_receives() -> None:
    assert normalize("Best  CRM?") == "Best  CRM?"


def test_the_hash_is_the_sha256_of_the_normalized_text() -> None:
    assert text_hash(" Café? ") == hashlib.sha256("Café?".encode()).digest()
    assert text_hash("Café?") == text_hash("Café?")
    assert text_hash("Best CRM?") != text_hash("best crm?")
    assert len(text_hash("x")) == 32
