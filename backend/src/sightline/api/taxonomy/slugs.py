"""Term slugs made from names: lower-case ASCII letters and digits joined by hyphens.

Letters with diacritics lose them (`Café` is `cafe`); a name with no ASCII letter or digit left,
such as one written only in Japanese, gets `term`, and the sibling numbering keeps it unique.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Collection

from sightline.api.schemas.taxonomy import SLUG_MAX

FALLBACK_SLUG = "term"

_WORD = re.compile(r"[a-z0-9]+")


def slugify(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    bare = "".join(char for char in decomposed if not unicodedata.combining(char))
    slug = "-".join(_WORD.findall(bare))[:SLUG_MAX].rstrip("-")
    return slug or FALLBACK_SLUG


def free_slug(base: str, taken: Collection[str]) -> str:
    """`base`, or `base-2`, `base-3` and so on: the first one no sibling has."""
    if base not in taken:
        return base
    number = 2
    while True:
        suffix = f"-{number}"
        candidate = base[: SLUG_MAX - len(suffix)].rstrip("-") + suffix
        if candidate not in taken:
            return candidate
        number += 1
