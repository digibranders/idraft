"""DataForSEO's location list (docs/06 section 4; plan decision D8)."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.locations import (
    LOCATIONS_PATH,
    LocationListError,
    ProviderLocation,
    fetch_locations,
    read_locations,
)
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    envelope,
    fixture,
    fixture_bytes,
    task_answer,
)


def _body(result: list[Any]) -> bytes:
    return json.dumps(envelope([task_answer(result=result)])).encode()


def _entry(**fields: Any) -> dict[str, Any]:
    return {
        "location_code": 2840,
        "location_name": "United States",
        "location_code_parent": None,
        "country_iso_code": "US",
        "location_type": "Country",
        **fields,
    }


def test_the_fixture_reads_as_nine_locations() -> None:
    found = read_locations(fixture_bytes("locations"))
    assert found.skipped == 0
    assert len(found.locations) == 9
    assert found.locations[2] == ProviderLocation(
        code=1014221,
        name="San Francisco,California,United States",
        parent_code=21137,
        country_iso="US",
        location_type="City",
    )


def test_entries_that_cannot_be_read_are_skipped_and_counted() -> None:
    found = read_locations(
        _body(
            [
                _entry(),
                _entry(location_code=2826, country_iso_code="gb", location_name="United Kingdom"),
                _entry(location_code=None),
                _entry(location_code=1, country_iso_code="USA"),
                _entry(location_code=2, country_iso_code=None),
                _entry(location_code=3, location_type=""),
                _entry(location_code=True),
                # What the database would refuse: past `integer`, NUL, blank.
                _entry(location_code=2**31),
                _entry(location_code=4, location_code_parent=2**31),
                _entry(location_code=5, location_name="Nul\x00here"),
                _entry(location_code=6, location_name="   "),
                _entry(location_code=7, location_type="City\n"),
                _entry(location_code=8, location_name="\ud800"),
                "not an entry",
                # The same code again keeps the first.
                _entry(location_name="Duplicate"),
            ]
        )
    )
    assert [(location.code, location.country_iso) for location in found.locations] == [
        (2840, "US"),
        (2826, "GB"),
    ]
    assert found.skipped == 13


@pytest.mark.parametrize(
    "content",
    [
        b"not json",
        json.dumps({"status_code": 20000}).encode(),
        json.dumps(envelope([])).encode(),
        json.dumps(envelope(["not a task"])).encode(),
        json.dumps(envelope([task_answer(status_code=40501, message="Invalid Field.")])).encode(),
        json.dumps(envelope([task_answer(result=None)])).encode(),
        json.dumps(envelope([task_answer(result=[])], status_code=40000)).encode(),
        json.dumps([1, 2]).encode(),
        # A changed format, where nothing can be read, is not an empty list.
        _body([{"code": 1}, {"code": 2}]),
        # Nested past what the parser follows.
        b"[" * 100_000 + b"]" * 100_000,
    ],
)
def test_an_answer_that_is_not_a_location_list_is_refused(content: bytes) -> None:
    with pytest.raises(LocationListError):
        read_locations(content)


async def test_the_list_is_asked_for_with_a_get() -> None:
    events: list[str] = []
    api = Api(events)
    api.answer("GET", LOCATIONS_PATH, fixture("locations"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        found = await fetch_locations(client)
    assert len(found.locations) == 9
    assert [request.method for request in api.requests] == ["GET"]


async def test_a_refused_call_is_a_provider_error() -> None:
    events: list[str] = []
    api = Api(events)
    api.answer(
        "GET",
        LOCATIONS_PATH,
        envelope([], status_code=40100, message="You are not authorized."),
        status=401,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        with pytest.raises(ProviderCallError):
            await fetch_locations(client)
