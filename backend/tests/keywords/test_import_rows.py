"""Reading an import's source and its rows (plan decisions D12 and D13; the imports sub-plan,
rules I3 to I5). Pure functions: no database."""

from __future__ import annotations

from typing import get_args

import pytest

from sightline.api.schemas.keywords import DepthProfile, FunnelStage, Intent
from sightline.keywords import import_rows
from sightline.keywords.import_rows import (
    CELL_MAX,
    IMPORT_ROWS_MAX,
    Defaults,
    Locations,
    ParsedRow,
    RowError,
    SourceError,
    parse_row,
    read_api_rows,
    read_csv,
    read_paste,
    resolve_mapping,
)

LOCATIONS = Locations(
    active_ids=frozenset({2840, 2826, 1023191}),
    by_country={"US": 2840, "GB": 2826},
    by_name={
        "united states": 2840,
        "united kingdom": 2826,
        "new york,new york,united states": 1023191,
        # Two locations share this name.
        "springfield": None,
    },
)
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


# Sources.


def test_a_csv_with_a_bom_quoted_fields_and_semicolons_is_read() -> None:
    data = '﻿Keyword;Device;Group\n"crm; software";mobile;Product/Pricing\n;;\nerp;;\n'.encode()

    headers, rows = read_csv(data)

    assert headers == ["Keyword", "Device", "Group"]
    # The blank row keeps its number and makes no row.
    assert [(row.row_no, row.cells["Keyword"]) for row in rows] == [
        (1, "crm; software"),
        (3, "erp"),
    ]
    assert rows[0].cells == {
        "Keyword": "crm; software",
        "Device": "mobile",
        "Group": "Product/Pricing",
    }


def test_a_csv_with_tabs_or_commas_is_read_by_its_header_line() -> None:
    tabbed = read_csv(b"keyword\tdevice\ncrm\tmobile\n")
    commas = read_csv(b"keyword,device\ncrm,mobile\n")

    assert tabbed[1][0].cells == commas[1][0].cells == {"keyword": "crm", "device": "mobile"}


def test_short_rows_are_padded_and_extra_cells_ignored() -> None:
    _, rows = read_csv(b"keyword,device\ncrm\nerp,mobile,surplus\n")

    assert [row.cells for row in rows] == [
        {"keyword": "crm", "device": ""},
        {"keyword": "erp", "device": "mobile"},
    ]


def test_a_column_without_a_header_is_left_out() -> None:
    headers, rows = read_csv(b"keyword,,device\ncrm,x,mobile\n")

    assert headers == ["keyword", "device"]
    assert rows[0].cells == {"keyword": "crm", "device": "mobile"}


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"\xff\xfekeyword", "not_utf8"),
        (b"", "no_header"),
        (b"  , ,\n", "no_header"),
        (b"keyword,KEYWORD\ncrm,erp\n", "duplicate_headers"),
        (b"keyword,  Keyword \ncrm,erp\n", "duplicate_headers"),
    ],
)
def test_an_unreadable_csv_says_why(data: bytes, code: str) -> None:
    with pytest.raises(SourceError) as raised:
        read_csv(data)

    assert raised.value.code == code


def test_more_rows_than_allowed_are_refused() -> None:
    data = ("keyword\n" + "kw\n" * (IMPORT_ROWS_MAX + 1)).encode()

    with pytest.raises(SourceError, match=str(IMPORT_ROWS_MAX)) as raised:
        read_csv(data)

    assert raised.value.code == "too_many_rows"


def test_exactly_the_most_rows_are_read() -> None:
    _, rows = read_csv(("keyword\n" + "kw\n" * IMPORT_ROWS_MAX).encode())

    assert len(rows) == IMPORT_ROWS_MAX


def test_a_cell_is_cut_just_past_the_limit_so_a_huge_one_costs_nothing_to_keep() -> None:
    _, rows = read_csv(f"keyword,note\ncrm,{'y' * 100_000}\n".encode())

    assert len(rows[0].cells["note"]) == CELL_MAX + 1


def test_paste_takes_tags_after_a_tab_and_keeps_line_numbers() -> None:
    rows = read_paste("crm\tpricing|b2b\n\n  erp  \r\nhr\t\n")

    assert [(row.row_no, row.cells) for row in rows] == [
        (1, {"keyword": "crm", "tags": "pricing|b2b"}),
        (3, {"keyword": "  erp  "}),
        (4, {"keyword": "hr"}),
    ]


def test_too_long_a_paste_is_refused() -> None:
    with pytest.raises(SourceError) as raised:
        read_paste("kw\n" * (IMPORT_ROWS_MAX + 1))

    assert raised.value.code == "too_many_rows"


def test_api_rows_have_the_union_of_their_keys_as_headers() -> None:
    headers, rows = read_api_rows(
        [{"keyword": "crm"}, {"keyword": " ", "device": "x"}, {"keyword": "erp", "device": "both"}]
    )

    assert headers == ["keyword", "device"]
    # The row with no keyword text but a device is a row; one with every cell blank is not.
    assert [(row.row_no, row.cells["keyword"]) for row in rows] == [
        (1, "crm"),
        (2, " "),
        (3, "erp"),
    ]
    only_blank, kept = read_api_rows([{"keyword": " "}, {"keyword": "crm"}])
    assert only_blank == ["keyword"]
    assert [row.row_no for row in kept] == [2]


# The mapping.


def test_headers_map_by_name_without_case_and_a_mapping_overrides() -> None:
    assert resolve_mapping(["Keyword", "Land", "competitors"], {}) == {"Keyword": "keyword"}
    assert resolve_mapping(["Term", "Land"], {"term": "keyword", "LAND": "country"}) == {
        "Term": "keyword",
        "Land": "country",
    }


def test_headers_match_as_written_after_trimming() -> None:
    assert resolve_mapping(["  Keyword "], {}) == {"  Keyword ": "keyword"}
    assert resolve_mapping(["Search Term"], {" search term ": "keyword"}) == {
        "Search Term": "keyword"
    }


def test_an_explicit_mapping_wins_over_a_header_that_matches_by_name() -> None:
    # "keyword" matches by name, but the user said the keyword is in "Term".
    assert resolve_mapping(["keyword", "Term"], {"Term": "keyword"}) == {"Term": "keyword"}


def test_two_headers_for_one_field_leave_the_first() -> None:
    assert resolve_mapping(["Keyword", "KEYWORD2", "keyword"], {}) == {"Keyword": "keyword"}


# One row.


def test_a_row_takes_its_defaults_and_both_devices() -> None:
    parsed = parse_row({"keyword": " CRM  Software ", "device": "Both"}, DEFAULTS, LOCATIONS)

    assert isinstance(parsed, ParsedRow)
    assert (parsed.text, parsed.normalized) == ("CRM Software", "crm software")
    assert parsed.devices == ("desktop", "mobile")
    assert (parsed.location_id, parsed.language_code, parsed.priority) == (2840, "en", 3)
    assert (parsed.depth_profile, parsed.intent, parsed.funnel_stage) == (
        "standard",
        "unknown",
        "unknown",
    )
    assert (parsed.target, parsed.group_path, parsed.tags, parsed.topic) == (None, (), (), ())


def test_a_row_reads_every_field() -> None:
    parsed = parse_row(
        {
            "keyword": "crm",
            "country": "gb",
            "language": "DE",
            "device": "mobile",
            "priority": " 2 ",
            "depth_profile": "Deep",
            "intent": "Commercial",
            "funnel_stage": "BOFU",
            "target_url": "https://example.com/pricing?utm_source=x",
            "group": " Product / Pricing ",
            "tags": "B2B| b2b |SaaS||",
            "topic": "CRM/CRM for Startups",
        },
        DEFAULTS,
        LOCATIONS,
    )

    assert isinstance(parsed, ParsedRow)
    assert (parsed.location_id, parsed.language_code, parsed.devices) == (2826, "de", ("mobile",))
    assert (parsed.priority, parsed.depth_profile) == (2, "deep")
    assert (parsed.intent, parsed.funnel_stage) == ("commercial", "bofu")
    assert parsed.target is not None
    # Canonical: the utm_source tracking parameter is gone.
    assert parsed.target.url == "https://example.com/pricing"
    assert parsed.group_path == ("Product", "Pricing")
    # Duplicates without case go, the first spelling stays.
    assert parsed.tags == ("B2B", "SaaS")
    assert parsed.topic == ("CRM", "CRM for Startups")


def test_a_default_group_applies_to_a_row_without_one() -> None:
    defaults = Defaults(
        location_id=2840,
        language_code="en",
        device="mobile",
        priority=1,
        depth_profile="deep",
        group_path=("Imported", "2026"),
        tags_vocabulary_id=None,
        topic_vocabulary_id=None,
    )

    parsed = parse_row({"keyword": "crm"}, defaults, LOCATIONS)

    assert isinstance(parsed, ParsedRow)
    assert parsed.group_path == ("Imported", "2026")
    assert (parsed.devices, parsed.priority, parsed.depth_profile) == (("mobile",), 1, "deep")


@pytest.mark.parametrize(
    ("cells", "code"),
    [
        ({"keyword": ""}, "keyword_missing"),
        ({"keyword": "   "}, "keyword_missing"),
        ({"keyword": "bad\x00word"}, "keyword_invalid"),
        ({"keyword": "site:example.com"}, "search_operator_not_allowed"),
        ({"keyword": "x" * 701}, "keyword_too_long"),
        ({"keyword": "crm", "location": "Atlantis"}, "location_unknown"),
        ({"keyword": "crm", "location": "Springfield"}, "location_unknown"),
        ({"keyword": "crm", "location": "99999"}, "location_unknown"),
        ({"keyword": "crm", "country": "XX"}, "location_unknown"),
        ({"keyword": "crm", "country": "USA"}, "location_unknown"),
        ({"keyword": "crm", "language": "english"}, "language_invalid"),
        ({"keyword": "crm", "language": "e1"}, "language_invalid"),
        ({"keyword": "crm", "device": "tablet"}, "device_invalid"),
        ({"keyword": "crm", "priority": "9"}, "priority_invalid"),
        ({"keyword": "crm", "priority": "0"}, "priority_invalid"),
        ({"keyword": "crm", "priority": "high"}, "priority_invalid"),
        ({"keyword": "crm", "priority": "²"}, "priority_invalid"),
        ({"keyword": "crm", "depth_profile": "huge"}, "depth_profile_invalid"),
        ({"keyword": "crm", "intent": "buy"}, "intent_invalid"),
        ({"keyword": "crm", "funnel_stage": "top"}, "funnel_stage_invalid"),
        ({"keyword": "crm", "target_url": "not a url"}, "target_url_invalid"),
        ({"keyword": "crm", "target_url": "ftp://example.com/x"}, "target_url_invalid"),
        ({"keyword": "crm", "group": "a//b"}, "group_path_invalid"),
        ({"keyword": "crm", "group": "x" * 101}, "group_path_invalid"),
        ({"keyword": "crm", "group": "/".join(["g"] * 11)}, "group_path_invalid"),
        ({"keyword": "crm", "tags": "x" * 101}, "tags_invalid"),
        ({"keyword": "crm", "topic": "/"}, "topic_invalid"),
        ({"keyword": "crm", "topic": "/".join(["t"] * 11)}, "topic_invalid"),
    ],
)
def test_the_first_failing_field_names_the_reason(cells: dict[str, str], code: str) -> None:
    parsed = parse_row(cells, DEFAULTS, LOCATIONS)

    assert isinstance(parsed, RowError)
    assert parsed.code == code
    assert parsed.message
    # Messages reach people: no en or em dashes (U+2013, U+2014).
    assert not {chr(0x2013), chr(0x2014)} & set(parsed.message)


def test_a_cell_over_the_limit_anywhere_in_the_row_is_the_first_failure() -> None:
    raw = {"keyword": "crm", "note": "y" * (CELL_MAX + 1)}

    parsed = parse_row({"keyword": "crm"}, DEFAULTS, LOCATIONS, raw=raw)

    assert isinstance(parsed, RowError)
    assert parsed.code == "cell_too_long"
    # Without the raw row, the mapped cells are the ones looked at.
    long_keyword = parse_row({"keyword": "k" * (CELL_MAX + 1)}, DEFAULTS, LOCATIONS)
    assert isinstance(long_keyword, RowError)
    assert long_keyword.code == "cell_too_long"


def test_the_first_failing_field_in_order_decides() -> None:
    parsed = parse_row(
        {"keyword": "site:x.com", "location": "Atlantis", "device": "tablet"}, DEFAULTS, LOCATIONS
    )

    assert isinstance(parsed, RowError)
    assert parsed.code == "search_operator_not_allowed"
    later = parse_row({"keyword": "crm", "device": "tablet", "priority": "9"}, DEFAULTS, LOCATIONS)
    assert isinstance(later, RowError)
    assert later.code == "device_invalid"


def test_location_beats_country_beats_the_default() -> None:
    by_location = parse_row(
        {"keyword": "crm", "location": "1023191", "country": "GB"}, DEFAULTS, LOCATIONS
    )
    by_name = parse_row(
        {"keyword": "crm", "location": "New York,New York,United States"}, DEFAULTS, LOCATIONS
    )
    by_country = parse_row({"keyword": "crm", "country": "gb"}, DEFAULTS, LOCATIONS)

    assert isinstance(by_location, ParsedRow)
    assert by_location.location_id == 1023191
    assert isinstance(by_name, ParsedRow)
    assert by_name.location_id == 1023191
    assert isinstance(by_country, ParsedRow)
    assert by_country.location_id == 2826


def test_without_any_location_a_row_has_none() -> None:
    defaults = Defaults(
        location_id=None,
        language_code="en",
        device="desktop",
        priority=3,
        depth_profile="standard",
        group_path=(),
        tags_vocabulary_id=None,
        topic_vocabulary_id=None,
    )

    parsed = parse_row({"keyword": "crm"}, defaults, LOCATIONS)

    assert isinstance(parsed, RowError)
    assert parsed.code == "location_unknown"


def test_a_default_location_that_is_no_longer_active_is_not_used() -> None:
    defaults = Defaults(
        location_id=99999,
        language_code="en",
        device="desktop",
        priority=3,
        depth_profile="standard",
        group_path=(),
        tags_vocabulary_id=None,
        topic_vocabulary_id=None,
    )

    parsed = parse_row({"keyword": "crm"}, defaults, LOCATIONS)

    assert isinstance(parsed, RowError)
    assert parsed.code == "location_unknown"


def test_without_any_language_a_row_has_none() -> None:
    defaults = Defaults(
        location_id=2840,
        language_code=None,
        device="desktop",
        priority=3,
        depth_profile="standard",
        group_path=(),
        tags_vocabulary_id=None,
        topic_vocabulary_id=None,
    )

    parsed = parse_row({"keyword": "crm"}, defaults, LOCATIONS)

    assert isinstance(parsed, RowError)
    assert parsed.code == "language_invalid"


def test_the_value_sets_match_the_api_schemas() -> None:
    assert frozenset(get_args(DepthProfile)) == import_rows.DEPTH_PROFILES
    assert frozenset(get_args(Intent)) == import_rows.INTENTS
    assert frozenset(get_args(FunnelStage)) == import_rows.FUNNEL_STAGES
