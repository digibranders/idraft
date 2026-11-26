"""The only judge of what a note file is (spec 9.8.5, decision D23).

The content type comes from the bytes alone. The name has two small uses: it picks `text/csv` over
`text/plain`, and a few extensions are refused whatever the content. Pure code: no I/O, imports
nothing from the app, and `sniff` raises `FileRefused` and nothing else.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final
from urllib.parse import quote

NOTE_FILE_MAX_BYTES: Final = 10 * 1024 * 1024
IMAGE_TYPES: Final = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
ACCEPTED_TYPES: Final = IMAGE_TYPES | {"application/pdf", "text/plain", "text/csv"}
DISPLAY_NAME_MAX: Final = 255

# Markup is looked for in this many leading bytes only: bounded work, and where a browser sniffs.
_MARKUP_WINDOW: Final = 1024
# What an HTML, SVG or XML document starts with, lower-cased.
_MARKUP_MARKERS: Final = (b"<html", b"<!doctype", b"<svg", b"<script", b"<iframe", b"<?xml")
# Refused whatever the content, for whoever opens the download on their own computer.
_BLOCKED_EXTENSIONS: Final = (".html", ".htm", ".xhtml", ".svg", ".xml", ".js", ".mjs", ".hta")
# Text may hold tab, line feed, form feed and carriage return and no other control character.
_FORBIDDEN_TEXT: Final = re.compile("[\x00-\x08\x0b\x0e-\x1f\x7f-\x9f]")
_PDF_HEADER: Final = re.compile(rb"%PDF-\d\.\d")
_PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
# A file that starts like an image or a PDF but fails its structure is a damaged one, not text.
_BINARY_MAGICS: Final = (b"\x89PNG", b"\xff\xd8\xff", b"GIF87a", b"GIF89a", b"RIFF", b"%PDF")
_WEBP_CHUNKS: Final = (b"VP8 ", b"VP8L", b"VP8X")
# Bidirectional controls that can make a name read differently from what it is.
_BIDI: Final = frozenset("؜‎‏‪‫‬‭‮⁦⁧⁨⁩")
_FALLBACK_NAME: Final = "file"


class FileRefused(Exception):  # noqa: N818 (named by the plan; reads as "the file was refused")
    """Not a file a note may hold. `reason` is a short code: `empty`, `type`, `markup`, `name`."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _image(data: bytes) -> str | None:
    # Each check wants the signature and the structure that follows it, so a bare signature fails.
    if data.startswith(_PNG_SIGNATURE):
        return "image/png" if data[8:16] == b"\x00\x00\x00\rIHDR" else None
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg" if len(data) >= 4 and data[3] >= 0xC0 else None
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif" if len(data) >= 13 else None  # header and logical screen descriptor
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp" if data[12:16] in _WEBP_CHUNKS else None
    return None


def _pdf(data: bytes) -> str | None:
    return "application/pdf" if _PDF_HEADER.match(data) else None


def _text(data: bytes, name: str) -> str | None:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if _FORBIDDEN_TEXT.search(text):
        return None
    head = data[:_MARKUP_WINDOW].lower()
    if any(marker in head for marker in _MARKUP_MARKERS):
        raise FileRefused("markup")
    return "text/csv" if name.lower().endswith(".csv") else "text/plain"


def sniff(data: bytes, name: str) -> str:
    """The content type of `data`, from its bytes; the name only picks text/csv over text/plain."""
    if not data:
        raise FileRefused("empty")
    # Judge the normalised name: a trailing newline, tab or zero-width character hides nothing.
    if display_name(name).lower().rstrip(". ").endswith(_BLOCKED_EXTENSIONS):
        raise FileRefused("name")
    # A PNG with markup after its image data passes as a PNG on purpose: its first bytes decide, and
    # it is harmless where it is served (nosniff, an inert content type and a sandbox policy, 5i).
    found = _image(data) or _pdf(data)
    if found is None and not data.startswith(_BINARY_MAGICS):
        found = _text(data, name)
    if found is None:
        raise FileRefused("type")
    return found


def display_name(name: str | None) -> str:
    """The name to show: no path parts or control characters, 255 characters at most."""
    last = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    # Cf covers zero-width characters, the byte order mark, the soft hyphen and the bidi controls;
    # Cs is a lone surrogate, which neither the database nor a UTF-8 header can hold.
    kept = "".join(
        c
        for c in last
        if c not in _BIDI and unicodedata.category(c) not in {"Cc", "Cf", "Cs", "Zl", "Zp"}
    )
    cleaned = kept.strip()[:DISPLAY_NAME_MAX].strip()
    return cleaned if cleaned.strip(".") else _FALLBACK_NAME


def content_disposition(name: str | None) -> str:
    """A safe `Content-Disposition` value for a download (RFC 6266, RFC 5987).

    The ASCII `filename` is a fallback with every character that could end the quoted string or
    start a parameter replaced; `filename*` carries the real name, percent-encoded as UTF-8.
    """
    shown = display_name(name)
    fallback = "".join(c if " " <= c <= "~" and c not in '"\\;%' else "_" for c in shown)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(shown, safe='')}"
