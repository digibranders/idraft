"""Prompt text as it is stored, hashed and compared (docs/04 section 8.2).

Decomposed text ("e" followed by U+0301) is written as escapes so that no editor can compose it.
"""

import hashlib

from idraft.ai.text import normalize, text_hash

DECOMPOSED = "Café"
COMPOSED = "Café"


def test_the_two_spellings_are_different_strings() -> None:
    assert DECOMPOSED != COMPOSED


def test_text_is_trimmed_and_composed() -> None:
    assert normalize(f"  {DECOMPOSED} near me?  ") == f"{COMPOSED} near me?"


def test_case_and_inner_spacing_are_what_the_engine_receives() -> None:
    assert normalize("Best  CRM?") == "Best  CRM?"


def test_the_hash_is_the_sha256_of_the_normalized_text() -> None:
    assert text_hash(f" {DECOMPOSED}? ") == hashlib.sha256(f"{COMPOSED}?".encode()).digest()
    assert text_hash(f"{DECOMPOSED}?") == text_hash(f"{COMPOSED}?")
    assert text_hash("Best CRM?") != text_hash("best crm?")
    assert len(text_hash("x")) == 32
