"""Time zone names as the API takes them.

A name is `UTC` or an IANA `Area/Location` name. Browsers still report some zones by the name
they had before a rename (`Intl` gives `Asia/Calcutta` for India), and PostgreSQL's time zone data
may not carry the old names, so those are replaced by the current name before anything is stored.
Whether the zone exists is then asked of PostgreSQL, which computes the business dates.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, StringConstraints

TIMEZONE_MAX = 64
# `UTC`, or an area and one or two further parts: no bare words such as `localtime`, which are
# files of the time zone database and not zones.
TIMEZONE_PATTERN = r"^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2})$"

# The names `Intl.supportedValuesOf("timeZone")` reports that were renamed since.
_RENAMED = {
    "Africa/Asmera": "Africa/Asmara",
    "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "America/Catamarca": "America/Argentina/Catamarca",
    "America/Cordoba": "America/Argentina/Cordoba",
    "America/Godthab": "America/Nuuk",
    "America/Indianapolis": "America/Indiana/Indianapolis",
    "America/Jujuy": "America/Argentina/Jujuy",
    "America/Louisville": "America/Kentucky/Louisville",
    "America/Mendoza": "America/Argentina/Mendoza",
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "Europe/Kiev": "Europe/Kyiv",
    "Pacific/Enderbury": "Pacific/Kanton",
    "Pacific/Ponape": "Pacific/Pohnpei",
    "Pacific/Truk": "Pacific/Chuuk",
}


def current_name(name: str) -> str:
    return _RENAMED.get(name, name)


Timezone = Annotated[
    str,
    StringConstraints(min_length=1, max_length=TIMEZONE_MAX, pattern=TIMEZONE_PATTERN),
    AfterValidator(current_name),
]
