"""The saved three country list the runbook loads reads as India, the UAE and Saudi Arabia."""

from __future__ import annotations

from pathlib import Path

from idraft.providers.dataforseo.locations import read_locations
from tests.devseed.support import COUNTRY_IDS

FILE = Path(__file__).parents[1] / "fixtures" / "dataforseo" / "locations-india-gulf.json"


def test_the_saved_list_has_the_three_countries() -> None:
    listed = read_locations(FILE.read_bytes())

    assert listed.skipped == 0
    assert {
        (location.country_iso, location.code, location.location_type)
        for location in listed.locations
    } == {(country, code, "Country") for country, code in COUNTRY_IDS.items()}
