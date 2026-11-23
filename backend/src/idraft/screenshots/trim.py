"""What a tall capture of an AI answer page needs before it is kept.

The provider renders the saved page at exactly the height asked for (up to 9,999 px) for ChatGPT
and Gemini, and at the page's own height for Google AI Mode. An answer is shorter than 9,999 px,
so the capture ends in blank space with the platform's fixed prompt box in the last 300 px. The
kept image stops where the answer stops.

Two traps, both seen in the 2026-11-23 captures: an answer can hold a blank band of about 400 px
(a map that did not render), so only a much larger gap ends the answer; and the prompt box sits
about 110 px above the bottom edge, so "content reaches the edge" would never fire. A capture is
cut off when the answer runs into the prompt box.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from itertools import pairwise
from typing import Final

from PIL import Image, UnidentifiedImageError

# The main column of the platform pages at the 1920 px desktop width, as a share of the width:
# the sidebar and the margins are left out.
MAIN_COLUMN: Final = (0.36, 0.78)
# A pixel this dark counts as content (text, an image edge); the pages are near white.
DARK: Final = 110
# Blank rows kept below the last content row.
PADDING: Final = 48
# The prompt box fixed at the bottom of a capture occupies about this many of the last rows.
BOTTOM_UI: Final = 300
# A blank gap larger than this ends the answer. Gaps inside answers measured up to about 400 px;
# the gap between a short answer and the prompt box of a 9,999 px capture is thousands.
GAP: Final = 1000


class CaptureError(ValueError):
    """The bytes are not a usable capture."""


@dataclass(frozen=True, slots=True)
class Trimmed:
    png: bytes
    width: int
    height: int
    truncated: bool


def _content_rows(image: Image.Image) -> list[int]:
    gray = image.convert("L")
    left = int(gray.width * MAIN_COLUMN[0])
    right = int(gray.width * MAIN_COLUMN[1])
    # Threshold once, then test each row as one byte slice: a 9,999 px capture is 8 million pixels.
    column = gray.crop((left, 0, right, gray.height)).point(
        lambda value: 255 if value < DARK else 0
    )
    width = column.width
    data = column.tobytes()
    return [y for y in range(column.height) if any(data[y * width : (y + 1) * width])]


def _encode(image: Image.Image, *, truncated: bool) -> Trimmed:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return Trimmed(png=out.getvalue(), width=image.width, height=image.height, truncated=truncated)


def trim_capture(data: bytes, *, requested_height: int) -> Trimmed:
    """The capture without the blank space after the answer. `requested_height`: the
    `browser_screen_height` the capture was asked for."""
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise CaptureError("the bytes are not an image") from error
    rows = _content_rows(image)
    if not rows:
        raise CaptureError("the capture is blank")
    if image.height < requested_height - 1:
        # The provider returned a page shorter than asked for (Google AI Mode): it is complete.
        return _encode(image, truncated=False)
    # The answer is the first run of content rows; a later run after a large gap is the
    # platform's own prompt box.
    end = rows[0]
    for previous, current in pairwise(rows):
        if current - previous > GAP:
            break
        end = current
    truncated = end >= image.height - BOTTOM_UI
    if truncated:
        return _encode(image, truncated=True)
    return _encode(
        image.crop((0, 0, image.width, min(image.height, end + PADDING))), truncated=False
    )
