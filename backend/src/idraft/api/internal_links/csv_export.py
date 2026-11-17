"""CSV of the Pages and Links lists (decision D20)."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence
from typing import Final

EXPORT_ROWS_MAX: Final = 100_000
# What a spreadsheet takes for a formula when it opens a cell (as api/imports/service.py).
_FORMULA_START: Final = ("=", "+", "-", "@", "\t", "\r")


def neutral(cell: object) -> str:
    text = "" if cell is None else str(cell)
    return "'" + text if text.startswith(_FORMULA_START) else text


def csv_text(header: Sequence[str], rows: Iterable[Sequence[object]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow([neutral(cell) for cell in row])
    return out.getvalue()
