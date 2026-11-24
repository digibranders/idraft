"""Cutting an answer into the units stages 9 and 10 read (docs/13-ai-extraction-engine.md).

A unit is the smallest stretch of the answer that says one thing about a brand: a list item (one
markdown line with a bullet or a number), a heading, or a clause of prose (a sentence cut again at
`;`, a dash, `but`, `however`, `whereas`, `while`, `although`). A list item also knows its place in
a numbered list and the line that introduces its list, which is what makes "the best providers:"
followed by a list a suggestion. Pure, no I/O. Offsets are code points of the text given.

Known limits: a sentence ends at `. `, `! ` or `? ` followed by a capital letter, a digit, a quote
or a bracket, so an abbreviation such as `Inc. Rival` is cut in two; a table row is prose; an item
that runs over several lines is cut at its first line, the other lines are prose units.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, Literal

UnitKind = Literal["prose", "item", "heading"]

_LINE: Final = re.compile(r"[^\n]*")
_ITEM: Final = re.compile(
    r"^(?P<lead>[ \t]*(?:#{1,6}[ \t]+)?\**)(?:(?P<num>\d{1,3})[.)]|[-*+•])[ \t]+(?=\S)"
)
_HEADING: Final = re.compile(r"^[ \t]*#{1,6}[ \t]+(?=\S)")
_SENTENCE_END: Final = re.compile(r"(?<=[.!?])[ \t]+(?=[\"\u201c(\[*A-Z0-9])")
_CLAUSE_BREAK: Final = re.compile(
    r";\s+|\s[\u2014\u2013-]{1,2}\s|,?\s+(?:but|however|whereas|while|although|though)\b,?\s+",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class Unit:
    start: int
    end: int
    text: str
    kind: UnitKind
    # The number of a numbered list item, else None.
    place: int | None = None
    # For an item: the nearest line above its list that is neither blank, an item nor indented.
    intro: str | None = None
    # Where the item's own words begin (after the bullet or number), as an offset into the text.
    content_start: int = 0


def split_units(text: str) -> list[Unit]:
    """The units of `text` in order. Together they cover every character that is not a break."""
    lines = [(found.start(), found.group()) for found in _LINE.finditer(text) if found.group()]
    units: list[Unit] = []
    for index, (start, line) in enumerate(lines):
        item = _ITEM.match(line)
        if item is not None:
            number = item.group("num")
            body = item.end()
            units.append(
                Unit(
                    start=start,
                    end=start + len(line),
                    text=line,
                    kind="item",
                    place=None if number is None else int(number),
                    intro=_intro(lines, index),
                    content_start=start + body,
                )
            )
        elif _HEADING.match(line):
            units.append(Unit(start, start + len(line), line, "heading"))
        else:
            units.extend(_clauses(start, line))
    return units


def _intro(lines: list[tuple[int, str]], index: int) -> str | None:
    """The line that introduces the list the item at `index` belongs to."""
    for _, line in reversed(lines[:index]):
        if not line.strip() or _ITEM.match(line) or line[:1] in " \t":
            continue
        return line
    return None


def _clauses(start: int, line: str) -> list[Unit]:
    cuts = [0]
    for sentence in _SENTENCE_END.finditer(line):
        cuts.append(sentence.end())
    parts: list[tuple[int, int]] = []
    ends = [*cuts[1:], len(line)]
    for begin, stop in zip(cuts, ends, strict=True):
        piece = line[begin:stop]
        offset = begin
        for brk in _CLAUSE_BREAK.finditer(piece):
            parts.append((offset, begin + brk.start()))
            offset = begin + brk.end()
        parts.append((offset, stop))
    return [Unit(start + a, start + b, line[a:b], "prose") for a, b in parts if line[a:b].strip()]


def unit_of(units: list[Unit], offset: int) -> Unit | None:
    """The unit that holds the character at `offset`; None when it lies in a break."""
    for unit in units:
        if unit.start <= offset < unit.end:
            return unit
    return None


def sentence_at(text: str, offset: int) -> tuple[int, int]:
    """The sentence that holds the character at `offset`: from the last sentence end or line start
    before it to the next one. A list item or heading is one sentence."""
    begin = text.rfind("\n", 0, offset) + 1
    stop = text.find("\n", offset)
    stop = len(text) if stop < 0 else stop
    line = text[begin:stop]
    if _ITEM.match(line) or _HEADING.match(line):
        return begin, stop
    start, end = begin, stop
    for sentence in _SENTENCE_END.finditer(line):
        if begin + sentence.end() <= offset:
            start = begin + sentence.end()
        elif begin + sentence.start() >= offset:
            end = begin + sentence.start()
            break
    return start, end
