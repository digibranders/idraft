"""Prompt text as it is stored, sent and compared (docs/04-data-model.md section 8.2:
`text_hash = sha256(NFC(text))`).

A composed and a decomposed "é" are different bytes but one prompt, so text is composed (NFC)
and trimmed before it is stored, hashed or compared. Nothing else changes: case and inner
spacing are what the engine receives, so "Best CRM?" and "best crm?" are two prompts.
"""

from __future__ import annotations

import hashlib
import unicodedata


def normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text.strip())


def text_hash(text: str) -> bytes:
    """The sha256 of the normalized text's UTF-8 bytes: 32 bytes, half of a prompt's identity
    (with its language and country)."""
    return hashlib.sha256(normalize(text).encode("utf-8")).digest()
