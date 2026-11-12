"""The fixture loader: the real file loads with its counts, and every malformed variant fails
loudly, naming the place."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from idraft.devseed.fixture import DEFAULT_FIXTURE, FixtureError, load_fixture, topic_paths
from idraft.domain.ai_engines import EngineCode

Change = Callable[[dict[str, Any]], object]


def _variant(tmp_path: Path, change: Change) -> Path:
    data = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    change(data)
    path = tmp_path / "fixture.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _gemini_without_the_emirates(data: dict[str, Any]) -> None:
    data["engines"][1]["countries"] = ["IN", "SA"]


def test_the_real_fixture_loads_with_its_counts() -> None:
    fixture = load_fixture(DEFAULT_FIXTURE)

    assert fixture.project.slug == "eventus-security"
    assert (fixture.project.timezone, fixture.project.default_country) == ("Asia/Kolkata", "IN")
    assert fixture.project.host == "eventussecurity.com"
    assert fixture.brand.name == "Eventus Security"
    assert len(fixture.competitors) == 8
    assert [part.key for part in fixture.competitors if part.ambiguous] == ["darkwatch"]
    assert {part.engine_code for part in fixture.engines} == {
        EngineCode.CHATGPT_WEB,
        EngineCode.GEMINI_WEB,
    }
    assert all(part.countries == ["IN", "AE", "SA"] for part in fixture.engines)
    assert len(fixture.topics) == 7
    assert sum(len(parent.children) for parent in fixture.topics) == 22
    assert len(topic_paths(fixture.topics)) == 29
    assert topic_paths(fixture.topics)["soc-monitoring"] == "managed-soc-mdr/soc-monitoring"
    assert len(fixture.prompts) == 72
    assert sum(part.branded for part in fixture.prompts) == 7


def _first_prompt_repeats_its_topic(data: dict[str, Any]) -> None:
    topic = data["prompts"][0]["topics"][0]
    data["prompts"][0]["topics"] = [topic, topic]


def _first_prompt_has_three_topics(data: dict[str, Any]) -> None:
    parent = data["topics"][0]
    children = parent["children"]
    data["prompts"][0]["topics"] = [parent["slug"], children[0]["slug"], children[1]["slug"]]


CASES: list[tuple[str, Change, str]] = [
    ("unknown top level key", lambda d: d.update(extra=1), "extra: Extra inputs are not permitted"),
    ("unknown prompt key", lambda d: d["prompts"][0].update(answer="x"), "prompts.0.answer"),
    (
        "missing prompt text",
        lambda d: d["prompts"][0].pop("text"),
        "prompts.0.text: Field required",
    ),
    ("schema version", lambda d: d.update(schema_version=2), "schema_version"),
    (
        "importance as text",
        lambda d: d["prompts"][0].update(importance="3"),
        "prompts.0.importance",
    ),
    ("importance too high", lambda d: d["prompts"][0].update(importance=6), "prompts.0.importance"),
    ("unknown intent", lambda d: d["prompts"][0].update(intent="guess"), "prompts.0.intent"),
    (
        "unknown topic",
        lambda d: d["prompts"][0].update(topics=["no-such-topic"]),
        "prompt p01 names unknown topics no-such-topic",
    ),
    (
        "repeated text",
        lambda d: d["prompts"][1].update(text=d["prompts"][0]["text"]),
        "repeated prompt text",
    ),
    ("country an engine lacks", _gemini_without_the_emirates, "which gemini_web does not run in"),
    (
        "ambiguous without hints",
        lambda d: d["competitors"][6].update(disambiguation_hints=[]),
        "competitors.6",
    ),
    (
        "repeated topic slug",
        lambda d: d["topics"][1]["children"][0].update(slug="soc-monitoring"),
        "repeated topic slug soc-monitoring",
    ),
    (
        "repeated domain",
        lambda d: d["competitors"][0].update(domains=["eventussecurity.com"]),
        "repeated entity domain eventussecurity.com",
    ),
    (
        "repeated entity key",
        lambda d: d["competitors"][0].update(key=d["brand"]["key"]),
        "repeated entity key eventus",
    ),
    (
        "repeated entity name, ignoring case",
        lambda d: d["competitors"][0].update(name=d["brand"]["name"].upper()),
        "repeated entity name eventus security",
    ),
    (
        "repeated engine",
        lambda d: d["engines"][1].update(engine_code=d["engines"][0]["engine_code"]),
        "repeated engine chatgpt_web",
    ),
    (
        "repeated prompt key",
        lambda d: d["prompts"][1].update(key=d["prompts"][0]["key"]),
        "repeated prompt key p01",
    ),
    (
        "hints without ambiguous",
        lambda d: d["competitors"][0].update(disambiguation_hints=["a hint"]),
        "competitors.0: Value error, disambiguation_hints are given exactly when ambiguous",
    ),
    (
        "more than two topics",
        _first_prompt_has_three_topics,
        "prompts.0.topics: List should have at most 2 items",
    ),
    (
        "repeated topic in one prompt",
        _first_prompt_repeats_its_topic,
        "repeated topic in prompt p01",
    ),
]


@pytest.mark.parametrize(("label", "change", "expected"), CASES, ids=[case[0] for case in CASES])
def test_a_malformed_fixture_fails_naming_the_place(
    tmp_path: Path, label: str, change: Change, expected: str
) -> None:
    with pytest.raises(FixtureError) as caught:
        load_fixture(_variant(tmp_path, change))

    assert expected in str(caught.value), label


def test_text_that_is_not_json_fails(tmp_path: Path) -> None:
    path = tmp_path / "broken.json"
    path.write_text("{", encoding="utf-8")

    with pytest.raises(FixtureError, match="is not valid"):
        load_fixture(path)


def test_a_missing_file_fails(tmp_path: Path) -> None:
    with pytest.raises(FixtureError, match="could not be read"):
        load_fixture(tmp_path / "absent.json")
