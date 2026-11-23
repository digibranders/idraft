"""Trimming a tall capture of an AI answer page and spotting one that was cut off."""

from __future__ import annotations

import io

import pytest
from PIL import Image, ImageDraw

from idraft.screenshots.trim import CaptureError, Trimmed, trim_capture

WIDTH = 400
BACKGROUND = (250, 250, 250)


def _png(height: int, *, text_rows: tuple[int, int] | None, bar_at_bottom: bool) -> bytes:
    """A page of `height` pixels: dark text rows in the main column, and (like the platform's
    fixed prompt box) a bar drawn at the very bottom."""
    image = Image.new("RGB", (WIDTH, height), BACKGROUND)
    draw = ImageDraw.Draw(image)
    if text_rows is not None:
        draw.rectangle((100, text_rows[0], 300, text_rows[1]), fill=(20, 20, 20))
    if bar_at_bottom:
        draw.rectangle((100, height - 60, 300, height - 20), fill=(200, 200, 200))
        draw.rectangle((110, height - 50, 290, height - 30), fill=(30, 30, 30))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_blank_space_between_the_answer_and_the_bottom_bar_is_removed() -> None:
    result = trim_capture(
        _png(3000, text_rows=(100, 900), bar_at_bottom=True), requested_height=3000
    )
    assert isinstance(result, Trimmed)
    assert result.truncated is False
    assert 900 < result.height < 1100
    assert result.width == WIDTH
    assert Image.open(io.BytesIO(result.png)).height == result.height


def test_an_answer_that_runs_into_the_bottom_bar_is_a_truncated_capture() -> None:
    # The answer reaches the platform's fixed prompt box: it is longer than the capture.
    result = trim_capture(
        _png(1000, text_rows=(100, 900), bar_at_bottom=True), requested_height=1000
    )
    assert result.truncated is True
    assert result.height == 1000


def test_a_gap_inside_the_answer_is_not_its_end() -> None:
    # A map placeholder or a large image leaves a blank band of about 400 px inside an answer.
    image = Image.new("RGB", (WIDTH, 3000), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.rectangle((100, 100, 300, 800), fill=(20, 20, 20))
    draw.rectangle((100, 1200, 300, 1900), fill=(20, 20, 20))  # after a 400 px band
    out = io.BytesIO()
    image.save(out, format="PNG")
    result = trim_capture(out.getvalue(), requested_height=3000)
    assert result.truncated is False
    assert result.height > 1900


def test_a_page_shorter_than_asked_for_is_kept_whole() -> None:
    # Google AI Mode answers with the whole page (2,062 px) however tall the request was.
    result = trim_capture(
        _png(2000, text_rows=(100, 1800), bar_at_bottom=False), requested_height=9999
    )
    assert result.truncated is False
    assert result.height == 2000


def test_a_capture_with_no_content_is_an_error() -> None:
    with pytest.raises(CaptureError, match="blank"):
        trim_capture(_png(500, text_rows=None, bar_at_bottom=False), requested_height=500)


def test_bytes_that_are_not_an_image_are_an_error() -> None:
    with pytest.raises(CaptureError, match="image"):
        trim_capture(b"not a png", requested_height=500)
