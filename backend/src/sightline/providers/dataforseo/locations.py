"""DataForSEO's list of Google locations (`GET /v3/serp/google/locations`, free; docs/06
section 4, plan decision D8).

Each location's code is the Google Ads geo target id, which is also our location id (doc 04
section 5.2). The list is read entry by entry: one entry that cannot be read is skipped and
counted, never the reason the whole list is lost.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from sightline.providers.dataforseo.client import DataForSeoClient, Envelope, TaskAnswer

LOCATIONS_PATH: Final = "/v3/serp/google/locations"
_OK: Final = 20000


class LocationListError(ValueError):
    """The answer is not a location list."""


@dataclass(frozen=True, slots=True)
class ProviderLocation:
    code: int
    name: str  # `San Francisco,California,United States`
    parent_code: int | None
    country_iso: str  # upper case
    location_type: str  # verbatim: `Country`, `State`, `City`, `DMA Region`, ...


@dataclass(frozen=True, slots=True)
class LocationList:
    locations: tuple[ProviderLocation, ...]
    skipped: int  # entries that could not be read, or repeated a code


class _Entry(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    location_code: Annotated[int, Field(gt=0)]
    location_name: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    location_code_parent: Annotated[int, Field(gt=0)] | None = None
    country_iso_code: Annotated[str, StringConstraints(pattern=r"^[A-Za-z]{2}$")]
    location_type: Annotated[str, StringConstraints(min_length=1, max_length=64)]


async def fetch_locations(client: DataForSeoClient) -> LocationList:
    """Raises `ProviderCallError` when the call fails, `LocationListError` when the answer is
    not a list."""
    answered = await client.call("GET", LOCATIONS_PATH)
    return read_locations(answered.content)


def read_locations(content: bytes) -> LocationList:
    """The locations of an answer, as received or as saved to a file."""
    try:
        envelope = Envelope.model_validate(json.loads(content))
    except (ValueError, ValidationError) as error:
        raise LocationListError("not a DataForSEO answer") from error
    if envelope.status_code != _OK or not envelope.tasks:
        raise LocationListError(f"the answer holds no task: {envelope.status_message!r}")
    try:
        task = TaskAnswer.model_validate(envelope.tasks[0])
    except ValidationError as error:
        raise LocationListError("the answer's task cannot be read") from error
    if task.status_code != _OK or task.result is None:
        raise LocationListError(f"the task holds no result: {task.status_message!r}")

    locations: list[ProviderLocation] = []
    seen: set[int] = set()
    skipped = 0
    for raw in task.result:
        try:
            entry = _Entry.model_validate(raw)
        except ValidationError:
            skipped += 1
            continue
        if entry.location_code in seen:
            skipped += 1
            continue
        seen.add(entry.location_code)
        locations.append(
            ProviderLocation(
                code=entry.location_code,
                name=entry.location_name,
                parent_code=entry.location_code_parent,
                country_iso=entry.country_iso_code.upper(),
                location_type=entry.location_type,
            )
        )
    return LocationList(locations=tuple(locations), skipped=skipped)
