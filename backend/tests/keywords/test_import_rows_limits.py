"""Limits of reading an import (the Part A review): what a source may hold so that one import
cannot stop the others, exhaust memory or fail on something the database cannot keep."""

from __future__ import annotations

import pytest

from sightline.keywords.import_rows import (
    CELL_MAX,
    COLUMNS_MAX,
    Defaults,
    Locations,
    RowError,
    SourceError,
    parse_row,
    read_api_rows,
    read_csv,
    read_paste,
    storable,
)

LOCATIONS = Locations(active_ids=frozenset({2840}), by_country={"US": 2840}, by_name={})
DEFAULTS = Defaults(
    location_id=2840,
    language_code="en",
    device="desktop",
    priority=3,
    depth_profile="standard",
    group_path=(),
    tags_vocabulary_id=None,
    topic_vocabulary_id=None,
)


@pytest.mark.parametrize("cell", ["foo\x00bar", "foo\ud800bar"])
def test_a_cell_the_database_cannot_keep_makes_an_invalid_row(cell: str) -> None:
    fields = {"keyword": "crm", "group": cell}

    other = parse_row(fields, DEFAULTS, LOCATIONS, raw=fields)
    keyword = parse_row({"keyword": cell}, DEFAULTS, LOCATIONS, raw={"keyword": cell})

    assert isinstance(other, RowError)
    assert other.code == "cell_invalid"
    # The keyword's own refusal comes first for a NUL; either way the row cannot be written.
    assert isinstance(keyword, RowError)


def test_text_is_made_storable_without_losing_the_rest() -> None:
    assert storable("a\x00b") == "ab"
    assert storable("a\ud800b") == "a?b"
    assert storable("crm software é") == "crm software é"


def test_nul_in_a_paste_or_a_file_is_read_and_left_for_the_row_to_refuse() -> None:
    (pasted,) = read_paste("foo\x00bar\n")
    _, rows = read_csv(b"keyword\nfoo\x00bar\n")

    assert pasted.cells["keyword"] == "foo\x00bar"
    assert rows[0].cells["keyword"] == "foo\x00bar"


def test_a_header_is_stored_without_nul() -> None:
    headers, rows = read_csv(b"key\x00word,Tags\ncrm,a\n")

    assert headers == ["keyword", "Tags"]
    assert rows[0].cells == {"keyword": "crm", "Tags": "a"}


def test_a_file_with_too_many_columns_is_refused_before_its_rows_are_read() -> None:
    header = ",".join(f"c{n}" for n in range(COLUMNS_MAX + 1))

    with pytest.raises(SourceError) as error:
        read_csv(f"{header}\n{'x,' * COLUMNS_MAX}x\n".encode())

    assert error.value.code == "too_many_columns"


def test_a_file_at_the_column_limit_is_read() -> None:
    header = ",".join(f"c{n}" for n in range(COLUMNS_MAX))

    headers, rows = read_csv(f"{header}\na\n".encode())

    assert len(headers) == COLUMNS_MAX
    assert len(rows[0].cells) == COLUMNS_MAX


def test_api_rows_with_too_many_different_keys_are_refused() -> None:
    rows = [{f"k{n}": "x"} for n in range(COLUMNS_MAX + 1)]

    with pytest.raises(SourceError) as error:
        read_api_rows(rows)

    assert error.value.code == "too_many_columns"


def test_api_rows_with_headers_that_differ_only_in_case_are_refused() -> None:
    with pytest.raises(SourceError) as error:
        read_api_rows([{"Keyword": "crm"}, {"keyword ": "erp"}])

    assert error.value.code == "duplicate_headers"


def test_one_long_cell_makes_one_row_invalid_not_the_whole_file() -> None:
    huge = "x" * (300 * 1024)
    headers, rows = read_csv(f"keyword,note\ncrm,{huge}\nerp,ok\n".encode())

    first = parse_row({"keyword": rows[0].cells["keyword"]}, DEFAULTS, LOCATIONS, raw=rows[0].cells)
    second = parse_row({"keyword": "erp"}, DEFAULTS, LOCATIONS, raw=rows[1].cells)

    assert headers == ["keyword", "note"]
    # The cell is cut just past the limit, which is enough to see it is too long.
    assert len(rows[0].cells["note"]) == CELL_MAX + 1
    assert isinstance(first, RowError)
    assert first.code == "cell_too_long"
    assert not isinstance(second, RowError)
