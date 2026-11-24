"""S-20: the pure parts of the DataForSEO against cloro test (picking, reading, measuring)."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from spikes import s20_provider_ab as s20

CAPTURED = Path(__file__).resolve().parents[1] / "fixtures" / "dataforseo" / "captured"


def test_fifty_prompts_and_fifty_keywords() -> None:
    prompts = s20.pick_prompts()
    assert len(prompts) == 50
    assert len({text for _, text in prompts}) == 50
    assert Counter(country for country, _ in prompts) == s20.PROMPT_QUOTA
    assert len(s20.read_keywords()) == 50


def test_items_repeat_every_fifth_and_stage_one_fits_the_free_balance() -> None:
    items = s20.all_items()
    assert len(items) == 240  # 150 + 30 AI answers, 50 + 10 searches
    assert len({item.key for item in items}) == 240
    ordered = s20.priority_order(items)
    stage_one = [item for item in ordered if item.stage == 1]
    assert ordered[: len(stage_one)] == stage_one
    assert sum(s20.CLORO_CREDITS[item.engine] for item in stage_one) <= 470


def test_dataforseo_series_per_item() -> None:
    items = s20.all_items()
    first = next(i for i in items if i.key == "chatgpt|p000|r1")
    second = next(i for i in items if i.key == "chatgpt|p000|r2")
    assert s20.dfs_series(first) == ["chatgpt_forced", "chatgpt"]
    assert s20.dfs_series(second) == ["chatgpt_forced"]
    assert len(s20.dfs_jobs(items)) == 240 + 50  # the natural ChatGPT run for 50 prompts


def test_measures() -> None:
    assert s20.jaccard(["a", "b"], ["b", "c"]) == 1 / 3
    assert s20.jaccard([], []) is None
    assert s20.page("https://www.Example.com/a/b/?q=1#x") == "example.com/a/b"
    assert s20.host("https://www.example.co.in/x") == "example.co.in"
    assert s20.brands("Tata Communications and EY, but not eye or Eventual") == {
        "tata communications",
        "ey",
    }
    assert (
        s20.top_overlap(["https://a.com/1", "https://b.com/"], ["https://b.com", "https://c.com"])
        == 0.5
    )


def _cloro_record(
    engine: str, response: dict[str, Any], status: str = "COMPLETED"
) -> dict[str, Any]:
    item = s20.Item(f"{engine}|p001|r1", engine, 1, 1, "prompt", "IN")  # type: ignore[arg-type]
    return {
        "provider": "cloro",
        "series": engine,
        "item": s20._item_dict(item),
        "status": status,
        "submitted_at": "2026-11-23T10:00:00+00:00",
        "done_at": "2026-11-23T10:00:40+00:00",
        "latency_ms": 31000,
        "credits_charged": 7,
        "response": response,
    }


def test_reads_a_dataforseo_chatgpt_answer() -> None:
    body = json.loads((CAPTURED / "chatgpt_scraper_answer.json").read_text())
    item = s20.Item("chatgpt|p000|r1", "chatgpt", 0, 1, "prompt", "IN")
    record = {
        "provider": "dfs",
        "series": "chatgpt_forced",
        "item": s20._item_dict(item),
        "posted_at": "2026-11-23T10:00:00+00:00",
        "ready_at": "2026-11-23T10:01:30+00:00",
        "cost": "0.0012",
        "notes": [],
        "body": body,
    }
    answer = s20.read_dfs(record)
    assert answer.ok
    assert answer.seconds == 90
    assert answer.cost == 0.0012
    assert answer.urls
    assert answer.fan_out


def test_reads_cloro_answers_and_failures() -> None:
    chat = s20.read_cloro(
        _cloro_record(
            "chatgpt",
            {
                "success": True,
                "result": {
                    "text": "Eventus is one",
                    "sources": [{"url": "https://a.in/x"}],
                    "searchQueries": ["q"],
                    "entities": [{"name": "x"}],
                },
            },
        )
    )
    assert (chat.ok, chat.urls, chat.fan_out, chat.entities) == (True, ["https://a.in/x"], ["q"], 1)
    assert chat.seconds == 40
    assert chat.provider_seconds == 31
    assert chat.cost == 7
    google = s20.read_cloro(
        _cloro_record(
            "google",
            {
                "result": {
                    "organicResults": [{"position": 1, "link": "https://b.com/"}],
                    "aioverview": {"text": "t", "sources": [{"url": "https://c.com/"}]},
                }
            },
        )
    )
    assert google.ok
    assert google.aio
    assert google.aio_urls == ["https://c.com/"]
    failed = s20.read_cloro(_cloro_record("gemini", {"error": "x"}, status="FAILED"))
    assert not failed.ok
    assert failed.note.startswith("FAILED")


def test_sections_build_from_a_few_answers() -> None:
    answers = [
        s20.read_cloro(
            _cloro_record(
                "chatgpt", {"result": {"text": "t", "sources": [{"url": "https://a.in/"}]}}
            )
        ),
    ]
    for build in (
        s20.delivery_section,
        s20.content_section,
        s20.agreement_section,
        s20.geo_section,
        s20.serp_section,
        s20.cost_section,
    ):
        assert build(answers)


def test_fresh_run_is_two_groups_of_ten_prompts_and_ten_keywords() -> None:
    items = s20.all_items(fresh=True)
    first = [i for i in items if i.repeat == 1]
    for engine, size in (("chatgpt", 20), ("gemini", 20), ("ai_mode", 20), ("google", 20)):
        group = [i for i in first if i.engine == engine]
        assert len(group) == size
        assert Counter(i.group for i in group) == {
            "A India": 10,
            "B abroad (AE, SA, SG, US)": 10,
        }
    assert len(items) == 96  # plus the second runs at positions 20, 25, 40 and 45
    assert sum(s20.CLORO_CREDITS[i.engine] for i in items) == 480
