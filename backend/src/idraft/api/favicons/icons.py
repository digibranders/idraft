"""Finding a site's icon in its page and turning image bytes into the PNG the web app draws."""

from __future__ import annotations

import asyncio
import io
import re
from html.parser import HTMLParser
from typing import Final
from urllib.parse import urljoin, urlsplit

from PIL import Image

MIN_WIDTH: Final = 32
MAX_WIDTH: Final = 128
# More pixels than this is a decompression bomb, not an icon.
_MAX_PIXELS: Final = 4096 * 4096
_SIZE: Final = re.compile(r"(\d+)x(\d+)", re.IGNORECASE)
_IMAGE_ERRORS: Final = (OSError, ValueError, SyntaxError, Image.DecompressionBombError)


class _IconLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.found: list[tuple[int, int, str]] = []  # (declared width, order, href)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "link":
            return
        values = {name: value or "" for name, value in attrs}
        relations = values.get("rel", "").lower().split()
        href = values.get("href", "").strip()
        if ("icon" not in relations and "apple-touch-icon" not in relations) or not href:
            return
        if "svg" in values.get("type", "").lower() or urlsplit(href).path.lower().endswith(".svg"):
            return  # decoding vector images is out of scope; the next candidate is tried
        match = _SIZE.search(values.get("sizes", ""))
        self.found.append((int(match[1]) if match else 0, len(self.found), href))


def icon_links(page: bytes, base_url: str) -> list[str]:
    """The icon addresses a page declares, the one declared largest first, in page order among
    equals. Relative addresses are resolved against `base_url`."""
    parser = _IconLinks()
    parser.feed(page.decode("utf-8", errors="replace"))
    ordered = sorted(parser.found, key=lambda item: (-item[0], item[1]))
    return [urljoin(base_url, href) for _, _, href in ordered]


def _to_png(body: bytes) -> bytes | None:
    try:
        with Image.open(io.BytesIO(body)) as image:
            width, height = image.size
            if width < MIN_WIDTH or width * height > _MAX_PIXELS:
                return None
            icon = image.convert("RGBA")
        icon.thumbnail((MAX_WIDTH, MAX_WIDTH), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        icon.save(out, "PNG", optimize=True)
    except _IMAGE_ERRORS:
        return None
    return out.getvalue()


async def to_png(body: bytes) -> bytes | None:
    """The image as a PNG at most `MAX_WIDTH` wide, or None when it is not an image Pillow reads
    or is under `MIN_WIDTH` wide (an ICO file is read at its largest size)."""
    return await asyncio.to_thread(_to_png, body)
