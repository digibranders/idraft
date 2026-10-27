"""The shape of a provider answer, as a hash (docs/26-testing-quality.md section 3.3).

An answer is walked into a set of `path:type` strings with array indexes collapsed
(`tasks[].result[].items[].rank_group:number`), and the sorted set is hashed. Two answers of one
shape have one hash whatever their values and lengths; a field added, removed or retyped changes
it. Fixtures record their hash in `registry.json`, so a fixture changed without its record
fails a test, and a sample of production payloads can be compared with the known shapes.
"""

from __future__ import annotations

import hashlib
from typing import Any


def _kind(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def schema_paths(document: Any) -> frozenset[str]:
    """The `path:type` strings of an answer."""
    found: set[str] = set()

    def walk(value: object, path: str) -> None:
        found.add(f"{path}:{_kind(value)}")
        if isinstance(value, dict):
            for name, child in value.items():
                walk(child, f"{path}.{name}" if path else str(name))
        elif isinstance(value, list):
            for child in value:
                walk(child, f"{path}[]")

    if isinstance(document, dict):
        for name, child in document.items():
            walk(child, str(name))
    else:
        walk(document, "$")
    return frozenset(found)


def schema_hash(document: Any) -> str:
    """The hash of the shape of an answer, as hex."""
    return hashlib.sha256("\n".join(sorted(schema_paths(document))).encode()).hexdigest()


def reads(paths: frozenset[str], expected: str) -> bool:
    """Whether a path the parser reads (`tasks[].result[].items[].type`) is in the answers'
    paths, whatever its type."""
    return any(path.rpartition(":")[0] == expected for path in paths)
