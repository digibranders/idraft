"""The shape hash of the AI answers, and the guards around the fixtures that record it
(docs/26-testing-quality.md section 3.3).

`test_ai_parse.py` already holds the three gold tests: each fixture's hash matches its record
(`test_each_fixtures_schema_hash_matches_its_record`), every path the parser reads exists in the
fixtures, and each fixture parses to its recorded status. This file adds what they do not say:
no AI fixture escapes the registry, each engine has a captured answer with its own recorded hash,
and the hash bites when a payload changes shape (and only then).
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Mapping
from typing import Any

import pytest

from idraft.collectors.ai_prompt_ingest import SCHEMA_MISMATCH
from idraft.domain.ai_engines import ENGINES
from idraft.providers.dataforseo.ai_parse import (
    AiSchemaMismatchError,
    parse_ai_answer,
    unreadable,
)
from idraft.providers.dataforseo.schema_hash import schema_hash
from tests.providers.dataforseo.support import FIXTURES

AI = FIXTURES / "ai"
CAPTURED = FIXTURES / "captured"
# The captured folder is shared with the SERP spike: these are the AI engines' answers in it.
AI_CAPTURES = ("chatgpt", "gemini", "ai_mode")


def _registry() -> Mapping[str, Any]:
    loaded: Mapping[str, Any] = json.loads((AI / "registry.json").read_text())
    return loaded


def _records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = list(_registry()["fixtures"])
    return records


def _load(file: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / file).read_text())
    return loaded


def _captured(engine_code: str) -> dict[str, Any]:
    (record,) = [
        r for r in _records() if r["engine_code"] == engine_code and r["source"] == "captured"
    ]
    return _load(record["file"])


def _result(document: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = document["tasks"][0]["result"][0]
    return result


# The registry names every fixture.


def _on_disk() -> set[str]:
    files = {path for path in AI.glob("*.json") if path.name != "registry.json"}
    files |= {
        path
        for path in CAPTURED.glob("*.json")
        if any(path.name.startswith(prefix) for prefix in AI_CAPTURES)
    }
    return {path.relative_to(FIXTURES).as_posix() for path in files}


def test_every_ai_fixture_file_is_in_the_registry() -> None:
    registered = {record["file"] for record in _records()}

    assert _on_disk() - registered == set()
    # The other way: a record whose file is gone is the existing hash test's failure, but a
    # walk that found nothing would pass the line above, so it is checked to have found them.
    assert registered <= _on_disk()
    assert len(registered) == len(_records())


def test_each_engine_has_a_captured_fixture_with_a_recorded_hash() -> None:
    captured = [record for record in _records() if record["source"] == "captured"]

    assert sorted(record["engine_code"] for record in captured) == sorted(
        code.value for code in ENGINES
    )
    hashes = [record["schema_hash"] for record in captured]
    assert all(re.fullmatch(r"[0-9a-f]{64}", recorded) for recorded in hashes)
    assert len(set(hashes)) == 3


# The hash bites.


@pytest.mark.parametrize("engine_code", [code.value for code in ENGINES])
def test_a_new_field_changes_the_shape_hash(engine_code: str) -> None:
    document = _captured(engine_code)
    changed = copy.deepcopy(document)
    _result(changed)["a_field_the_provider_added"] = "x"

    assert schema_hash(changed) != schema_hash(document)


@pytest.mark.parametrize("engine_code", [code.value for code in ENGINES])
def test_a_removed_field_changes_it(engine_code: str) -> None:
    document = _captured(engine_code)
    changed = copy.deepcopy(document)
    # In the result of every captured answer, and of no other place in it.
    del _result(changed)["se_results_count"]

    assert schema_hash(changed) != schema_hash(document)


@pytest.mark.parametrize("engine_code", [code.value for code in ENGINES])
def test_a_retyped_field_changes_it(engine_code: str) -> None:
    document = _captured(engine_code)
    assert isinstance(_result(document)["datetime"], str)
    changed = copy.deepcopy(document)
    _result(changed)["datetime"] = 1762843268

    assert schema_hash(changed) != schema_hash(document)


@pytest.mark.parametrize("engine_code", [code.value for code in ENGINES])
def test_a_longer_list_and_other_values_keep_the_hash(engine_code: str) -> None:
    document = _captured(engine_code)
    changed = copy.deepcopy(document)
    result = _result(changed)
    # One more item of a shape already there, and other values in every string it holds.
    result["items"].append(copy.deepcopy(result["items"][0]))
    result["items"][0]["markdown"] = "Other words entirely."
    result["datetime"] = "2030-01-01 00:00:00 +00:00"
    result["items"] = result["items"] * 3

    assert schema_hash(changed) == schema_hash(document)


# A payload of another shape is refused where it differs.


def test_a_payload_of_an_unknown_shape_is_refused_with_its_path() -> None:
    known = {record["schema_hash"] for record in _records()}
    document = _captured("chatgpt_web")
    changed = copy.deepcopy(document)
    # The parser reads `items` as a list or null; an object is a shape it does not know.
    _result(changed)["items"] = {"type": "chat_gpt_text"}

    assert schema_hash(changed) not in known
    with pytest.raises(AiSchemaMismatchError) as raised:
        parse_ai_answer("chatgpt_web", changed)
    assert raised.value.path == "tasks[].result[].items"
    # What the ingest keeps of it (an error answer with this code) is tested in
    # tests/collectors/test_ai_prompt_ingest.py; here the code is pinned.
    answer = unreadable(SCHEMA_MISMATCH)
    assert (answer.status, answer.error_code) == ("error", "schema_mismatch")
