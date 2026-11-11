"""S-04 and S-06: what the ChatGPT scraper, the Gemini scraper and Google AI Mode return
(docs/07-dataforseo-ai-integration.md sections 2 to 4 and 12).

A small run, not the 200 prompts of doc 01 section 12: 10 English prompts for India, 2 prompts in
other languages, on the four series the product would collect (ChatGPT as it answers, ChatGPT
with web search forced, Gemini, AI Mode), plus 3 ChatGPT prompts on the priority queue for the
turnaround. It records what each answer holds, what it cost and how long it took, and keeps the
raw answers so the analysis can be run again without spending anything.

    uv run python -m spikes.s04_ai_engines --cap 0.15 --raw-dir /tmp/s04
    uv run python -m spikes.s04_ai_engines --analyze /tmp/s04 --cap 0.15
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, Literal

from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo.endpoint import TaskEndpoint
from spikes.common import (
    Budget,
    Sent,
    capture,
    fetch_all,
    first_result,
    live,
    median,
    run,
    say,
    submit_all,
    wait_ready,
    write_report,
)

Series = Literal["chatgpt", "chatgpt_forced", "gemini", "ai_mode", "chatgpt_priority"]

INDIA: Final = 2356
GERMANY: Final = 2276
STANDARD_PRICE: Final = Decimal("0.0012")
PRIORITY_PRICE: Final = Decimal("0.0024")

# (number in the list, text). The branded prompt names the tracked site.
ENGLISH: Final = [
    "What are the best managed SOC providers in India?",
    "Which companies offer 24x7 security operations center services in India?",
    "Compare managed detection and response providers for a mid-size company",
    "How much does a managed SOC service cost per month?",
    "What is the difference between SOC as a service and MDR?",
    "Best penetration testing companies in India",
    "Who are the top cybersecurity service providers in Mumbai?",
    "How do I choose a managed security service provider?",
    "What is a vCISO service and when does a company need one?",
    "Is Eventus Security a good SOC provider?",
]
# Prompts that ask for a provider to pick: the ones doc 07 section 4.2 counts for the ChatGPT rule.
COMMERCIAL: Final = {0, 1, 2, 5, 6, 7}
OTHER_LANGUAGES: Final = [
    ("Was ist ein Managed SOC und welche Anbieter gibt es in Deutschland?", GERMANY, "de"),
    ("भारत में सबसे अच्छे साइबर सुरक्षा सेवा प्रदाता कौन से हैं?", INDIA, "hi"),
]
PRIORITY_PROMPTS: Final = 3

BASES: Final = {
    "chatgpt": "/v3/ai_optimization/chat_gpt/llm_scraper",
    "gemini": "/v3/ai_optimization/gemini/llm_scraper",
    "ai_mode": "/v3/serp/google/ai_mode",
}


class AiParams(Contract):
    series: Series
    prompt: str
    location_code: int
    language_code: str


def task_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    params = request.params
    if not isinstance(params, AiParams):
        raise TypeError(f"not an AI request: {type(params).__name__}")
    body: dict[str, object] = {
        "keyword": params.prompt,
        "location_code": params.location_code,
        "language_code": params.language_code,
        "priority": 2 if params.series == "chatgpt_priority" else 1,
        "tag": tag,
    }
    if params.series == "chatgpt_forced":
        body["force_web_search"] = True
    if params.series == "ai_mode":
        body["device"] = "desktop"
        body["os"] = "windows"
    return body


def _endpoint(base: str, id_list: str) -> TaskEndpoint:
    return TaskEndpoint(
        base=base,
        result="task_get/advanced",
        build=task_body,
        result_lifetime=timedelta(hours=72),
        payload_slug="spike",
        id_list=id_list,
    )


ENDPOINTS: Final = {
    series: _endpoint(
        BASES["chatgpt" if series.startswith("chatgpt") else series],
        "/v3/serp/id_list" if series == "ai_mode" else "/v3/ai_optimization/id_list",
    )
    for series in ("chatgpt", "chatgpt_forced", "chatgpt_priority", "gemini", "ai_mode")
}


def _price(task: Sent) -> Decimal:
    params = task.params
    return (
        PRIORITY_PRICE
        if isinstance(params, AiParams) and params.series == "chatgpt_priority"
        else STANDARD_PRICE
    )


def _tasks() -> list[Sent]:
    tasks: list[Sent] = []

    def add(series: Series, prompt: str, location: int, language: str, label: str) -> None:
        tasks.append(
            Sent(
                number=len(tasks) + 1,
                label=label,
                params=AiParams(
                    series=series, prompt=prompt, location_code=location, language_code=language
                ),
            )
        )

    english_series: tuple[Series, ...] = ("chatgpt", "chatgpt_forced", "gemini", "ai_mode")
    for series in english_series:
        for index, prompt in enumerate(ENGLISH):
            add(series, prompt, INDIA, "en", f"{series}:{index}")
    other_series: tuple[Series, ...] = ("chatgpt", "gemini", "ai_mode")
    for series in other_series:
        for index, (prompt, location, language) in enumerate(OTHER_LANGUAGES):
            add(series, prompt, location, language, f"{series}:x{index}")
    for index, prompt in enumerate(ENGLISH[:PRIORITY_PROMPTS]):
        add("chatgpt_priority", prompt, INDIA, "en", f"chatgpt_priority:{index}")
    return tasks


def _series_of(task: Sent) -> Series:
    params = task.params
    assert isinstance(params, AiParams)
    return params.series


def _keep(raw_dir: Path, tasks: list[Sent]) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    for task in tasks:
        params = task.params
        assert isinstance(params, AiParams)
        record = {
            "number": task.number,
            "label": task.label,
            "series": params.series,
            "prompt": params.prompt,
            "location_code": params.location_code,
            "language_code": params.language_code,
            "provider_task_id": task.provider_task_id,
            "submit_cost": None if task.submit_cost is None else str(task.submit_cost),
            "posted_at": None if task.posted_at is None else task.posted_at.isoformat(),
            "ready_at": None if task.ready_at is None else task.ready_at.isoformat(),
            "notes": task.notes,
            "body": task.body,
        }
        (raw_dir / f"{task.number:03d}-{task.label.replace(':', '-')}.json").write_text(
            json.dumps(record, indent=2, ensure_ascii=False)
        )


async def collect(raw_dir: Path, cap: Decimal) -> None:
    budget = Budget(cap=cap)
    tasks = _tasks()
    budget.allow(sum((_price(task) for task in tasks), Decimal(0)))
    by_series: dict[Series, list[Sent]] = {}
    for task in tasks:
        by_series.setdefault(_series_of(task), []).append(task)
    async with live(ENDPOINTS) as api:
        for series, group in by_series.items():
            say(f"sending {len(group)} tasks: {series}")
            await submit_all(api.provider, series, group, budget, _price)
        # The ChatGPT variants share one list of finished tasks: wait for them together.
        chatgpt = [task for task in tasks if _series_of(task).startswith("chatgpt")]
        for endpoint, group in (
            ("chatgpt", chatgpt),
            ("gemini", by_series["gemini"]),
            ("ai_mode", by_series["ai_mode"]),
        ):
            say(f"waiting for {len(group)} tasks: {endpoint}")
            await wait_ready(api.provider, endpoint, group)
        for series, group in by_series.items():
            await fetch_all(api.provider, series, group)
    _keep(raw_dir, tasks)
    say(f"kept {len(tasks)} answers in {raw_dir}; spent ${budget.spent} of ${cap}")


@dataclass
class Record:
    label: str
    series: str
    prompt: str
    language: str
    seconds: float | None
    cost: Decimal | None
    body: Mapping[str, Any] | None
    notes: list[str]

    @property
    def result(self) -> Mapping[str, Any]:
        return first_result(self.body)

    @property
    def items(self) -> list[Mapping[str, Any]]:
        return [i for i in (self.result.get("items") or []) if isinstance(i, dict)]


def _load(raw_dir: Path) -> list[Record]:
    from datetime import datetime

    records: list[Record] = []
    for path in sorted(raw_dir.glob("*.json")):
        data = json.loads(path.read_text())
        posted, ready = data["posted_at"], data["ready_at"]
        seconds = (
            None
            if posted is None or ready is None
            else (datetime.fromisoformat(ready) - datetime.fromisoformat(posted)).total_seconds()
        )
        body = data["body"]
        records.append(
            Record(
                label=data["label"],
                series=data["series"],
                prompt=data["prompt"],
                language=data["language_code"],
                seconds=seconds,
                cost=None if data["submit_cost"] is None else Decimal(data["submit_cost"]),
                body=body,
                notes=data["notes"],
            )
        )
    return records


def _walk(value: Any) -> list[Mapping[str, Any]]:
    """Every dict inside a payload, so a field is found wherever the surface puts it."""
    found: list[Mapping[str, Any]] = []
    stack = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            found.append(current)
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return found


def _list_lengths(record: Record, key: str) -> list[int]:
    return [len(d[key]) for d in _walk(record.body) if isinstance(d.get(key), list)]


def _markdown(record: Record) -> str:
    result = record.result
    text = result.get("markdown")
    if isinstance(text, str):
        return text
    parts = [d["markdown"] for d in _walk(result) if isinstance(d.get("markdown"), str)]
    return max(parts, key=len, default="")


def _rate(count: int, total: int) -> str:
    return f"{count} of {total}" if total else "n/a"


def _row(series: str, group: list[Record]) -> list[str]:
    answered = [r for r in group if r.body is not None and _markdown(r)]
    waits = [r.seconds for r in group if r.seconds is not None]
    costs = [float(r.cost) for r in group if r.cost is not None]

    def having(*keys: str) -> int:
        return sum(1 for r in answered if any(_list_lengths(r, key) for key in keys))

    named = sum(1 for r in answered if "eventus" in _markdown(r).lower())
    models = {" ".join(str(r.result["model"]).split()) for r in answered if r.result.get("model")}
    sizes = [len(json.dumps(r.body)) / 1024 for r in group if r.body is not None]
    return [
        series,
        str(len(group)),
        _rate(len(answered), len(group)),
        f"${median(costs):.4f}" if costs else "n/a",
        f"{median(waits):.0f} s" if waits else "n/a",
        f"{max(waits):.0f} s" if waits else "n/a",
        f"{median([float(len(_markdown(r))) for r in answered]):.0f} chars" if answered else "n/a",
        _rate(having("sources", "references"), len(answered)),
        _rate(having("search_results"), len(answered)),
        _rate(having("fan_out_queries"), len(answered)),
        _rate(having("brand_entities"), len(answered)),
        _rate(named, len(answered)),
        ", ".join(sorted(models)) or "n/a",
        f"{median(sizes):.0f} KB" if sizes else "n/a",
    ]


def analyze(raw_dir: Path, cap: Decimal) -> None:
    records = _load(raw_dir)
    budget = Budget(cap=cap)
    budget.spent = sum((r.cost for r in records if r.cost is not None), Decimal(0))
    sections: list[str] = []
    series_order = ["chatgpt", "chatgpt_forced", "chatgpt_priority", "gemini", "ai_mode"]
    heads = [
        "Series",
        "Tasks",
        "Answered",
        "Cost per task",
        "Median wait",
        "Slowest wait",
        "Answer text",
        "With sources",
        "With search results",
        "With fan-out",
        "With brand entities",
        "Names the brand",
        "Model",
        "Payload",
    ]
    lines = ["## Answers by series", "", f"| {' | '.join(heads)} |", f"|{'---|' * len(heads)}"]
    for series in series_order:
        group = [r for r in records if r.series == series]
        lines.append(f"| {' | '.join(_row(series, group))} |")
    sections += lines
    # The rule of doc 07 section 4.2: ChatGPT as it answers is the default when at least 60% of
    # the prompts that ask for a provider come back with sources.
    natural = [r for r in records if r.series == "chatgpt" and r.language == "en"]
    commercial = [r for r in natural if int(r.label.split(":")[1]) in COMMERCIAL]
    cited = [r for r in commercial if any(_list_lengths(r, "sources"))]
    sections += [
        "",
        "## ChatGPT variant (doc 07 section 4.2)",
        "",
        f"As it answers: {_rate(len(cited), len(commercial))} commercial prompts came back with "
        "sources (the rule needs at least 60%).",
    ]
    forced = [
        r
        for r in records
        if r.series == "chatgpt_forced" and int(r.label.split(":")[1]) in COMMERCIAL
    ]
    forced_cited = [r for r in forced if any(_list_lengths(r, "sources"))]
    sections.append(f"Web search forced: {_rate(len(forced_cited), len(forced))} with sources.")
    sections += ["", "## Item types seen", ""]
    for series in series_order:
        kinds: Counter[str] = Counter()
        for r in (x for x in records if x.series == series):
            kinds.update(str(i.get("type")) for i in r.items)
        sections.append(f"- {series}: {dict(kinds)}")
    sections += ["", "## Top-level result keys", ""]
    for series in ("chatgpt", "gemini", "ai_mode"):
        sample = next((r for r in records if r.series == series and r.body is not None), None)
        keys = sorted(sample.result.keys()) if sample is not None else []
        sections.append(f"- {series}: {keys}")
    problems = [(r.label, r.notes) for r in records if r.notes or r.body is None]
    sections += ["", "## Tasks with a problem", ""]
    sections += [f"- {label}: {notes or 'no answer'}" for label, notes in problems] or ["- none"]
    per_series_other = [
        r for r in records if r.language != "en" and r.series in ("chatgpt", "gemini", "ai_mode")
    ]
    sections += ["", "## Other languages", ""]
    for r in per_series_other:
        text = _markdown(r)
        sections.append(f"- {r.series} {r.language}: {len(text)} chars, starts {text[:80]!r}")
    path = write_report(
        "S-04", "AI engines: ChatGPT, Gemini and AI Mode answers (also S-06)", budget, sections
    )
    say(f"report: {path}")
    for series, name in (
        ("chatgpt", "chatgpt_scraper"),
        ("gemini", "gemini_scraper"),
        ("ai_mode", "ai_mode"),
    ):
        sample = next(
            (
                r
                for r in records
                if r.series == series and r.language == "en" and r.body is not None
            ),
            None,
        )
        if sample is not None:
            raw = next(raw_dir.glob(f"*-{sample.label.replace(':', '-')}.json"))
            body = json.loads(raw.read_text())["body"]
            capture(f"{name}_answer", json.dumps(body).encode())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cap", type=Decimal, help="most dollars the run may spend")
    parser.add_argument("--raw-dir", type=Path, help="where the raw answers are kept")
    parser.add_argument("--analyze", type=Path, help="read kept answers and write the report")
    options = parser.parse_args()
    if options.analyze is not None:
        analyze(options.analyze, options.cap or Decimal(0))
        return
    if options.cap is None or options.raw_dir is None:
        raise SystemExit("--cap and --raw-dir are needed to collect")
    run(lambda: collect(options.raw_dir, options.cap))


if __name__ == "__main__":
    main()
