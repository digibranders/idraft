"""The judge of a note file's type: by the bytes, never by the name or the browser."""

from __future__ import annotations

import contextlib
import random

import pytest

from idraft.storage.file_sniff import ACCEPTED_TYPES, FileRefused, display_name, sniff

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
GIF87 = b"GIF87a\x01\x00\x01\x00\x00\x00\x00;"
GIF89 = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"
WEBP = b"RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00" + b"\x00" * 14
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML = b"<!DOCTYPE html><html><body>hi</body></html>"
XML = b'<?xml version="1.0"?><a/>'
SCRIPT = b"<script>alert(1)</script>"
NAMES = ["a.png", "a.jpg", "a.pdf", "a.txt", ""]


def refusal(data: bytes, name: str) -> str:
    with pytest.raises(FileRefused) as caught:
        sniff(data, name)
    return caught.value.reason


@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (GIF87, "image/gif"),
        (GIF89, "image/gif"),
        (WEBP, "image/webp"),
        (PDF, "application/pdf"),
    ],
)
@pytest.mark.parametrize("name", ["whatever.bin", "", "x.csv", "x.txt"])
def test_the_type_comes_from_the_bytes_not_the_name(
    data: bytes, content_type: str, name: str
) -> None:
    assert sniff(data, name) == content_type


@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize("data", [SVG, HTML, XML, SCRIPT], ids=["svg", "html", "xml", "script"])
def test_markup_is_refused_under_every_name(data: bytes, name: str) -> None:
    assert refusal(data, name) == "markup"


def test_an_svg_with_png_magic_and_a_png_name_is_refused() -> None:
    # The magic is not followed by a PNG structure, so it is no image, and it is not read as text.
    assert refusal(b"\x89PNG\r\n\x1a\n" + SVG, "a.png") == "type"


def test_a_png_with_html_after_its_data_is_a_png_on_purpose() -> None:
    assert sniff(PNG + b"<html><script>alert(1)</script></html>", "a.html.png") == "image/png"


def test_pdf_magic_must_be_at_byte_zero() -> None:
    assert refusal(b"0123456789\x00" + PDF, "a.pdf") == "type"
    # Readable text after junk is only text, never a PDF.
    assert sniff(b"0123456789" + PDF, "a.pdf") == "text/plain"
    assert refusal(b"%PDF-", "a.pdf") == "type"


def test_riff_without_webp_is_refused() -> None:
    assert refusal(b"RIFF\x1a\x00\x00\x00WAVEfmt " + b"\x00" * 16, "a.webp") == "type"
    assert refusal(b"RIFF\x1a\x00\x00\x00WEBP", "a.webp") == "type"


@pytest.mark.parametrize(
    "data",
    [
        b"PK\x03\x04" + b"\x00" * 30,
        b"MZ\x90\x00" + b"\x00" * 30,
        b"\x7fELF\x02\x01\x01" + b"\x00" * 30,
        b"\xcf\xfa\xed\xfe\x07\x00\x00\x01" + b"\x00" * 30,
        b"\xca\xfe\xba\xbe\x00\x00\x00\x02",
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 30,
    ],
    ids=["zip", "exe", "elf", "mach-o", "fat-binary-or-class", "office"],
)
def test_archives_executables_and_office_files_are_refused(data: bytes) -> None:
    assert refusal(data, "a.png") == "type"


def test_an_empty_file_is_refused() -> None:
    assert refusal(b"", "a.txt") == "empty"


@pytest.mark.parametrize(
    "data",
    [
        b"\x89PNG",
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8",
        b"\xff\xd8\xff",
        b"GIF89a",
        b"RIFF",
        b"%PDF",
    ],
    ids=["png4", "png-signature-only", "jpeg2", "jpeg3", "gif-signature-only", "riff", "pdf4"],
)
def test_a_truncated_signature_is_refused(data: bytes) -> None:
    assert refusal(data, "a.png") == "type"


def test_text_is_plain_or_csv_by_its_name_only() -> None:
    assert sniff(b"a,b\n1,2\n", "data.csv") == "text/csv"
    assert sniff(b"a,b\n1,2\n", "DATA.CSV") == "text/csv"
    assert sniff(b"a,b\n1,2\n", "data.txt") == "text/plain"
    assert sniff(b"a,b\n1,2\n", "") == "text/plain"
    assert sniff(b"\xef\xbb\xbfhello \xc3\xa9\t\r\n\x0c", "a.txt") == "text/plain"


@pytest.mark.parametrize(
    "data",
    [b"a\x00b", b"ab\xffcd", b"bell\x07", b"del\x7f", b"c1\xc2\x85", b"\xff\xfeh\x00i\x00"],
    ids=["nul", "invalid-utf8", "bel", "del", "c1-control", "utf16"],
)
def test_text_with_a_bad_byte_is_refused(data: bytes) -> None:
    assert refusal(data, "a.txt") == "type"


def test_markup_at_the_start_of_text_is_refused_in_any_case() -> None:
    assert refusal(b"  <HTML>hello", "a.txt") == "markup"
    assert refusal(b"x" * 1000 + b"<ScRiPt>", "a.txt") == "markup"
    assert refusal(b"x" * 100 + b"<iframe src=a>", "a.csv") == "markup"


def test_markup_beyond_the_first_kilobyte_is_accepted() -> None:
    assert sniff(b"x" * 2000 + b"<script>", "a.txt") == "text/plain"


@pytest.mark.parametrize(
    "name", ["x.html", "x.SVG", "x.js", "x.htm", "x.xhtml", "x.xml", "x.mjs", "x.hta", "x.html "]
)
def test_a_blocked_extension_is_refused_even_for_plain_text(name: str) -> None:
    assert refusal(b"just text", name) == "name"


def test_hostile_input_never_raises_anything_but_file_refused() -> None:
    rng = random.Random(7)
    heads = [
        b"",
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"GIF89a",
        b"RIFF",
        b"%PDF-",
        b"\xef\xbb\xbf",
        b"<",
    ]
    for _ in range(500):
        data = rng.choice(heads) + rng.randbytes(rng.randrange(0, 64))
        with contextlib.suppress(FileRefused):
            assert sniff(data, rng.choice(NAMES)) in ACCEPTED_TYPES


def test_display_name_drops_path_parts_and_control_characters() -> None:
    assert display_name("../../etc/passwd") == "passwd"
    assert display_name("C:\\Users\\me\\report.pdf") == "report.pdf"
    assert display_name("a\r\nb\x00c\x07.txt") == "abc.txt"
    assert display_name("evil\u202egnp.exe") == "evilgnp.exe"
    assert display_name("a\u2028b.txt") == "ab.txt"
    assert display_name("  spaced name.txt  ") == "spaced name.txt"
    assert display_name("caf\u00e9 \u2014 \u65e5\u672c.txt") == "caf\u00e9 \u2014 \u65e5\u672c.txt"


def test_display_name_is_cut_at_255_and_never_empty() -> None:
    assert len(display_name("a" * 400 + ".txt")) == 255
    for blank in (None, "", "   ", "/", "..", ".", "\x00\x01", "dir/"):
        assert display_name(blank) == "file"
