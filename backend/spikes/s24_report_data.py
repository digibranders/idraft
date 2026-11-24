"""S-24: every figure of the DataForSEO against cloro report, as JSON files for its page.

Reads the raw answers of S-20 (free key), S-21 (paid key, two groups), S-22 (page one against
Search Console) and S-23 (20 app keywords, depth 75), and the real-browser readings kept in
`real_browser.json`. Spends nothing.

    uv run python -m spikes.s24_report_data --s20 /tmp/s20 --s21 /tmp/s20b --s22 /tmp/s22 \
        --s23 /tmp/s23 --out /tmp/s24
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from spikes import s22_search_console_check as s22
from spikes import s23_app_keywords_depth75 as s23
from spikes.common import first_result, median, percentile, say
from spikes.s20_provider_ab import (
    CREDIT_PRICES,
    Answer,
    brands,
    host,
    jaccard,
    load,
    page,
    top_overlap,
)

AI_SERIES = (("dfs", "chatgpt_forced"), ("dfs", "chatgpt"), ("cloro", "chatgpt"))


def r(value: float | None, digits: int = 2) -> float | None:
    return None if value is None or value != value else round(value, digits)


def mean(values: Iterable[float | None]) -> float | None:
    kept = [v for v in values if v is not None]
    return statistics.fmean(kept) if kept else None


def pct(count: int, total: int) -> float | None:
    return round(100 * count / total, 1) if total else None


def delivery(run: str, answers: Sequence[Answer]) -> list[dict[str, Any]]:
    rows = []
    for provider, series in sorted({(a.provider, a.series) for a in answers}):
        group = [a for a in answers if (a.provider, a.series) == (provider, series)]
        waits = [a.seconds for a in group if a.seconds is not None]
        own = [a.provider_seconds for a in group if a.provider_seconds is not None]
        costs = [a.cost for a in group if a.cost is not None]
        rows.append(
            {
                "run": run,
                "provider": provider,
                "series": series,
                "tasks": len(group),
                "answered": sum(1 for a in group if a.ok),
                "median_wait_s": r(median(waits), 0) if waits else None,
                "p95_wait_s": r(percentile(waits, 0.95), 0) if waits else None,
                "slowest_wait_s": r(max(waits), 0) if waits else None,
                "provider_task_s": r(median(own), 0) if own else None,
                "mean_charge": r(mean(costs), 4),
                "unit": "USD" if provider == "dfs" else "credits",
            }
        )
    return rows


def content(answers: Sequence[Answer]) -> list[dict[str, Any]]:
    rows = []
    for provider, series in sorted({(a.provider, a.series) for a in answers}):
        ok = [
            a
            for a in answers
            if (a.provider, a.series) == (provider, series) and a.ok and a.item.engine != "google"
        ]
        if not ok:
            continue
        sourced = [a for a in ok if a.urls]
        rows.append(
            {
                "provider": provider,
                "series": series,
                "answers": len(ok),
                "median_chars": r(median([float(len(a.text)) for a in ok]), 0),
                "with_sources_pct": pct(len(sourced), len(ok)),
                "median_sources": r(median([float(len(a.urls)) for a in sourced]), 0)
                if sourced
                else None,
                "with_fanout_pct": pct(sum(1 for a in ok if a.fan_out), len(ok)),
                "with_entities_pct": pct(sum(1 for a in ok if a.entities), len(ok)),
                "names_eventus_pct": pct(
                    sum(1 for a in ok if "eventus" in brands(a.text)), len(ok)
                ),
            }
        )
    return rows


def _pairs(
    answers: Sequence[Answer], left: tuple[str, str], right: tuple[str, str], engine: str
) -> list[tuple[Answer, Answer]]:
    a = {x.item.key: x for x in answers if (x.provider, x.series) == left and x.ok}
    b = {x.item.key: x for x in answers if (x.provider, x.series) == right and x.ok}
    return [(a[k], b[k]) for k in a if k in b and a[k].item.engine == engine]


def _floor(
    answers: Sequence[Answer], side: tuple[str, str], engine: str
) -> list[tuple[Answer, Answer]]:
    runs = {x.item.key: x for x in answers if (x.provider, x.series) == side and x.ok}
    return [
        (first, runs[key.replace("|r1", "|r2")])
        for key, first in runs.items()
        if first.item.engine == engine
        and first.item.repeat == 1
        and key.replace("|r1", "|r2") in runs
    ]


def agreement(answers: Sequence[Answer]) -> list[dict[str, Any]]:
    def domains(a: Answer) -> set[str]:
        return {host(u) for u in a.urls}

    def score(pairs: list[tuple[Answer, Answer]]) -> dict[str, Any]:
        return {
            "pairs": len(pairs),
            "cited_domains": r(mean(jaccard(domains(a), domains(b)) for a, b in pairs)),
            "brands_named": r(mean(jaccard(brands(a.text), brands(b.text)) for a, b in pairs)),
        }

    specs: list[tuple[str, str, str, tuple[str, str], tuple[str, str] | None]] = [
        (
            "ChatGPT",
            "DataForSEO (search forced) against cloro",
            "chatgpt",
            ("dfs", "chatgpt_forced"),
            ("cloro", "chatgpt"),
        ),
        (
            "ChatGPT",
            "DataForSEO (natural) against cloro",
            "chatgpt",
            ("dfs", "chatgpt"),
            ("cloro", "chatgpt"),
        ),
        ("Gemini", "DataForSEO against cloro", "gemini", ("dfs", "gemini"), ("cloro", "gemini")),
        (
            "AI Mode",
            "DataForSEO against cloro",
            "ai_mode",
            ("dfs", "ai_mode"),
            ("cloro", "ai_mode"),
        ),
    ]
    floors: list[tuple[str, str, str, tuple[str, str]]] = [
        ("ChatGPT", "DataForSEO against itself", "chatgpt", ("dfs", "chatgpt_forced")),
        ("ChatGPT", "cloro against itself", "chatgpt", ("cloro", "chatgpt")),
        ("Gemini", "DataForSEO against itself", "gemini", ("dfs", "gemini")),
        ("Gemini", "cloro against itself", "gemini", ("cloro", "gemini")),
        ("AI Mode", "DataForSEO against itself", "ai_mode", ("dfs", "ai_mode")),
        ("AI Mode", "cloro against itself", "ai_mode", ("cloro", "ai_mode")),
    ]
    rows = [
        {
            "engine": e,
            "comparison": c,
            "kind": "providers",
            **score(_pairs(answers, left, right, key)),
        }
        for e, c, key, left, right in specs
        if right is not None
    ]
    rows += [
        {"engine": e, "comparison": c, "kind": "floor", **score(_floor(answers, side, key))}
        for e, c, key, side in floors
    ]
    return rows


def geo(answers: Sequence[Answer]) -> list[dict[str, Any]]:
    rows = []
    for provider, series in (
        ("dfs", "chatgpt_forced"),
        ("cloro", "chatgpt"),
        ("dfs", "gemini"),
        ("cloro", "gemini"),
        ("dfs", "ai_mode"),
        ("cloro", "ai_mode"),
    ):
        for country, suffix in (("IN", ".in"), ("AE", ".ae"), ("SA", ".sa")):
            group = [
                a
                for a in answers
                if (a.provider, a.series) == (provider, series)
                and a.ok
                and a.item.country == country
                and a.item.repeat == 1
                and a.urls
            ]
            shares = [
                sum(1 for d in {host(u) for u in a.urls} if d.endswith(suffix))
                / len({host(u) for u in a.urls})
                for a in group
            ]
            rows.append(
                {
                    "provider": provider,
                    "series": series,
                    "country": country,
                    "answers": len(group),
                    "local_domain_share": r(mean(shares)),
                }
            )
    return rows


def serp_pooled(answers: Sequence[Answer]) -> list[dict[str, Any]]:
    dfs = {a.item.key: a for a in answers if (a.provider, a.series) == ("dfs", "serp") and a.ok}
    clo = {
        a.item.key: a
        for a in answers
        if a.provider == "cloro" and a.item.engine == "google" and a.ok
    }
    both = [(dfs[k], clo[k]) for k in dfs if k in clo]
    floors = {
        "DataForSEO against itself": _floor(answers, ("dfs", "serp"), "google"),
        "cloro against itself": _floor(answers, ("cloro", "google"), "google"),
    }
    rows: list[dict[str, Any]] = [
        {"measure": "Keywords answered by both", "value": len(both)},
        {
            "measure": "Top 10 pages in common between providers",
            "value": r(mean(top_overlap(a.organic, b.organic) for a, b in both)),
        },
        {
            "measure": "Same first result",
            "value": pct(
                sum(
                    1
                    for a, b in both
                    if a.organic and b.organic and page(a.organic[0]) == page(b.organic[0])
                ),
                len(both),
            ),
        },
        {
            "measure": "AI Overview on both",
            "value": pct(sum(1 for a, b in both if a.aio and b.aio), len(both)),
        },
        {
            "measure": "AI Overview sources in common",
            "value": r(
                mean(
                    jaccard({host(u) for u in a.aio_urls}, {host(u) for u in b.aio_urls})
                    for a, b in both
                    if a.aio and b.aio
                )
            ),
        },
    ]
    rows += [
        {
            "measure": f"Top 10 pages in common, {label} ({len(pairs)} keywords)",
            "value": r(mean(top_overlap(a.organic, b.organic) for a, b in pairs)),
        }
        for label, pairs in floors.items()
    ]
    return rows


def depth75(answers: Sequence[Answer], browser: dict[str, Any]) -> dict[str, Any]:
    by = {(a.provider, a.item.text, a.item.repeat): a for a in answers if a.ok}
    keyword_rows = []
    for group, texts in s23.GROUPS.items():
        for text in texts:
            row: dict[str, Any] = {
                "group": group,
                "keyword": text,
                "search_console": s23.SEARCH_CONSOLE[text],
                "real_browser": (browser.get(text) or {}).get("pos"),
            }
            for provider in ("dfs", "cloro"):
                for repeat in (1, 2):
                    a = by.get((provider, text, repeat))
                    row[f"{provider}_{repeat}"] = s23.place(a) if a else None
            keyword_rows.append(row)
    stats: list[dict[str, Any]] = []
    for provider in ("dfs", "cloro"):
        errors, missed, runs = [], 0, 0
        for text, truth in s23.SEARCH_CONSOLE.items():
            for repeat in (1, 2):
                a = by.get((provider, text, repeat))
                if not a:
                    continue
                runs += 1
                if truth <= s23.DEPTH:
                    found = s23.place(a)
                    if found:
                        errors.append(abs(found - truth))
                    else:
                        missed += 1
        sizes = [len(s23.organic(a)) for a in answers if a.provider == provider and a.ok]
        stats.append(
            {
                "provider": provider,
                "runs": runs,
                "found_with_truth": len(errors),
                "missed": missed,
                "median_distance": r(median([float(e) for e in errors]), 1) if errors else None,
                "within_5": sum(1 for e in errors if e <= 5),
                "within_10": sum(1 for e in errors if e <= 10),
                "runs_with_truth": len(errors) + missed,
                "found_pct": pct(len(errors), len(errors) + missed),
                "within_10_pct": pct(sum(1 for e in errors if e <= 10), len(errors) + missed),
                "median_results_returned": r(median([float(s) for s in sizes]), 0)
                if sizes
                else None,
            }
        )
    overlap = []
    texts = [t for ts in s23.GROUPS.values() for t in ts]
    for label, size in (("top 10", 10), ("top 75", s23.DEPTH)):
        cross_p: list[float] = []
        cross_h: list[float] = []
        d_self: list[float] = []
        c_self: list[float] = []
        for text in texts:
            for repeat in (1, 2):
                d, c = by.get(("dfs", text, repeat)), by.get(("cloro", text, repeat))
                if d and c:
                    cross_p.append(
                        jaccard(
                            {page(u) for u in d.organic[:size]}, {page(u) for u in c.organic[:size]}
                        )
                        or 0.0
                    )
                    cross_h.append(
                        jaccard(
                            {host(u) for u in d.organic[:size]}, {host(u) for u in c.organic[:size]}
                        )
                        or 0.0
                    )
            for provider, bucket in (("dfs", d_self), ("cloro", c_self)):
                a, b = by.get((provider, text, 1)), by.get((provider, text, 2))
                if a and b:
                    bucket.append(
                        jaccard(
                            {page(u) for u in a.organic[:size]}, {page(u) for u in b.organic[:size]}
                        )
                        or 0.0
                    )
        overlap.append(
            {
                "depth": label,
                "providers_pages": r(mean(cross_p)),
                "providers_domains": r(mean(cross_h)),
                "dfs_self": r(mean(d_self)),
                "cloro_self": r(mean(c_self)),
            }
        )
    # the real browser against each provider, on the keywords it read in full
    real = []
    for text, data in browser.items():
        hosts = [h for h in data["hosts"].split(",") if h]
        row = {"keyword": text, "real_position": data["pos"], "real_results": len(hosts)}
        for provider in ("dfs", "cloro"):
            sets = []
            for repeat in (1, 2):
                a = by.get((provider, text, repeat))
                if a:
                    sets.append(jaccard({host(u) for u in a.organic[:75]}, set(hosts)))
            row[f"{provider}_domains_in_common"] = r(mean(sets))
            for k in (1, 2):
                row[f"{provider}_{k}"] = (
                    s23.place(by[(provider, text, k)]) if (provider, text, k) in by else None
                )
        real.append(row)
    return {"keywords": keyword_rows, "stats": stats, "overlap": overlap, "real": real}


def page_one(answers: Sequence[Answer]) -> dict[str, Any]:
    by = {(a.provider, a.item.text, a.item.repeat): a for a in answers if a.ok}
    rows: list[dict[str, Any]] = []
    stat: dict[str, dict[str, Any]] = {
        p: {
            "found": 0,
            "runs": 0,
            "err": [],
            "within2": 0,
            "browser": 0,
            "stable": 0,
            "queries": 0,
        }
        for p in ("dfs", "cloro")
    }
    for query, truth in s22.SEARCH_CONSOLE.items():
        row: dict[str, Any] = {
            "query": query,
            "search_console": truth,
            "real_browser": s22.BROWSER[query],
        }
        for provider in ("dfs", "cloro"):
            places = []
            for repeat in (1, 2):
                a = by.get((provider, query, repeat))
                place = s22.position(a) if a else None
                places.append(place)
                row[f"{provider}_{repeat}"] = place
                st = stat[provider]
                st["runs"] += 1
                if place:
                    st["found"] += 1
                    st["err"].append(abs(place - truth))
                    st["within2"] += 1 if abs(place - truth) <= 2 else 0
                st["browser"] += 1 if place == s22.BROWSER[query] else 0
            stat[provider]["queries"] += 1
            stat[provider]["stable"] += 1 if places[0] == places[1] else 0
        rows.append(row)
    stats = [
        {
            "provider": p,
            "runs": s["runs"],
            "found_in_top_10": s["found"],
            "found_pct": pct(s["found"], s["runs"]),
            "mean_distance": r(mean(float(e) for e in s["err"]), 1),
            "within_2": s["within2"],
            "within_2_pct": pct(s["within2"], s["runs"]),
            "same_as_real_browser": s["browser"],
            "same_both_runs": s["stable"],
            "queries": s["queries"],
        }
        for p, s in stat.items()
    ]
    return {"queries": rows, "stats": stats}


PLANS = {"Lite": (30, 37_500), "Hobby": (100, 250_000), "Starter": (250, 650_000)}
STANDARD_UNIT = 0.0006  # DataForSEO standard queue, one SERP of 10 results


def cost(answers: Sequence[Answer], resolved: Sequence[Answer]) -> dict[str, Any]:
    measured = [a.cost for a in answers if (a.provider, a.series) == ("dfs", "serp") and a.cost]
    dfs75 = mean(measured) or STANDARD_UNIT * 8
    on = [a.cost for a in resolved if (a.provider, a.series) == ("dfs", "serp") and a.cost]
    dfs75_resolved = mean(on) or dfs75 + STANDARD_UNIT
    calls = [
        ("ChatGPT answer with fan-out", 0.0012, 7),
        ("Gemini answer", 0.0012, 4),
        ("AI Mode answer", 0.0012, 4),
        ("Google top 10 with AI Overview", 0.0012, 5),
        ("Google depth 75 (8 pages), measured", dfs75, 19),
        ("Google depth 75 with resolve_poisoned_results, measured", dfs75_resolved, 19),
    ]
    call_rows = [
        {
            "call": name,
            "dataforseo_usd": r(dfs, 4),
            "cloro_credits": credits,
            "cloro_lite_usd": r(credits * CREDIT_PRICES["Lite"], 4),
            "cloro_hobby_usd": r(credits * CREDIT_PRICES["Hobby"], 4),
            "cloro_vs_dataforseo_lite": r(credits * CREDIT_PRICES["Lite"] / dfs, 1),
            "cloro_vs_dataforseo_hobby": r(credits * CREDIT_PRICES["Hobby"] / dfs, 1),
        }
        for name, dfs, credits in calls
    ]
    windows = 150 * 52 * 2 / 12
    ai_credits = windows * (7 + 4 + 4)
    scenarios = [
        {
            "scenario": "AI answers: 150 prompts, twice a week, ChatGPT + Gemini + AI Mode",
            "dataforseo_usd_month": r(windows * 3 * 0.0012, 2),
            "cloro_plan": "Lite $30 (uses " + f"{ai_credits:,.0f} of 37,500 credits)",
            "cloro_usd_month": 30,
        },
        {
            "scenario": "Rank tracking: 1,000 keywords daily at depth 75 (AI Overview shown)",
            "dataforseo_usd_month": r(1000 * 30 * dfs75, 0),
            "cloro_plan": "Starter $250 (uses 570,000 of 650,000 credits)",
            "cloro_usd_month": 250,
        },
        {
            "scenario": "Rank tracking: same, DataForSEO with resolve_poisoned_results on",
            "dataforseo_usd_month": r(1000 * 30 * dfs75_resolved, 0),
            "cloro_plan": "Starter $250 (uses 570,000 of 650,000 credits)",
            "cloro_usd_month": 250,
        },
    ]
    return {"calls": call_rows, "scenarios": scenarios}


def by(rows: list[dict[str, Any]], provider: str) -> dict[str, Any]:
    return next(x for x in rows if x["provider"] == provider)


def fired(raw_dir: Path) -> tuple[int, int, int]:
    """Tasks, tasks where resolve_poisoned_results replaced listings, listings replaced."""
    tasks = hits = replaced = 0
    for path in sorted((raw_dir / "dfs").glob("serp__*.json")):
        record = json.loads(path.read_text())
        items = first_result(record["body"]).get("items") or []
        restored = [
            i
            for i in items
            if isinstance(i, dict)
            and i.get("type") == "organic"
            and "from_web" in json.dumps(i.get("checks"))
        ]
        tasks += 1
        hits += 1 if restored else 0
        replaced += len(restored)
    return tasks, hits, replaced


def resolved_positions(rows: list[dict[str, Any]], answers: Sequence[Answer], key: str) -> None:
    """Add the DataForSEO run with resolve_poisoned_results to rows of positions."""
    by = {(a.item.text, a.item.repeat): a for a in answers if a.provider == "dfs" and a.ok}
    for row in rows:
        for repeat in (1, 2):
            a = by.get((row[key], repeat))
            row[f"dfsr_{repeat}"] = (
                (s23.place(a) if key == "keyword" else s22.position(a)) if a else None
            )


def poison_blocks(
    p1: dict[str, Any],
    d75: dict[str, Any],
    p1r: dict[str, Any],
    d75r: dict[str, Any],
    dirs: tuple[Path, Path, Path, Path],
    answers: tuple[Sequence[Answer], ...],
) -> dict[str, Any]:
    _, _, s22_new, s23_new = dirs
    a, b = p1["stats"], d75["stats"]
    ar, br = p1r["stats"], d75r["stats"]
    scores = []
    for metric, runs, vals in (
        (
            "Site found on page one",
            30,
            (
                by(a, "dfs")["found_in_top_10"],
                by(ar, "dfs")["found_in_top_10"],
                by(a, "cloro")["found_in_top_10"],
            ),
        ),
        (
            "Within 2 places of Search Console, page one",
            30,
            (by(a, "dfs")["within_2"], by(ar, "dfs")["within_2"], by(a, "cloro")["within_2"]),
        ),
        (
            "Site found within 75 (depth 75)",
            38,
            (
                by(b, "dfs")["found_with_truth"],
                by(br, "dfs")["found_with_truth"],
                by(b, "cloro")["found_with_truth"],
            ),
        ),
        (
            "Within 10 places of Search Console (depth 75)",
            38,
            (by(b, "dfs")["within_10"], by(br, "dfs")["within_10"], by(b, "cloro")["within_10"]),
        ),
    ):
        scores.append(
            {
                "metric": metric,
                "runs": runs,
                "dfs": vals[0],
                "dfs_resolved": vals[1],
                "cloro": vals[2],
                "dfs_pct": pct(vals[0], runs),
                "dfs_resolved_pct": pct(vals[1], runs),
                "cloro_pct": pct(vals[2], runs),
            }
        )
    t22, h22, n22 = fired(s22_new)
    t23, h23, n23 = fired(s23_new)
    cost22 = [x.cost for x in answers[0] if x.provider == "dfs" and x.series == "serp" and x.cost]
    cost22r = [x.cost for x in answers[2] if x.provider == "dfs" and x.series == "serp" and x.cost]
    cost23 = [x.cost for x in answers[1] if x.provider == "dfs" and x.series == "serp" and x.cost]
    cost23r = [x.cost for x in answers[3] if x.provider == "dfs" and x.series == "serp" and x.cost]
    wait23 = [x.seconds for x in answers[1] if x.provider == "dfs" and x.seconds is not None]
    wait23r = [x.seconds for x in answers[3] if x.provider == "dfs" and x.seconds is not None]
    wait23c = [x.seconds for x in answers[1] if x.provider == "cloro" and x.seconds is not None]
    o, orr = d75["overlap"], d75r["overlap"]
    extra = [
        {
            "metric": "Top 10 pages two runs of the same provider share",
            "dataforseo": f"{o[0]['dfs_self']:.2f}",
            "dataforseo_resolved": f"{orr[0]['dfs_self']:.2f}",
            "cloro": f"{o[0]['cloro_self']:.2f}",
        },
        {
            "metric": "Top 75 pages two runs of the same provider share",
            "dataforseo": f"{o[1]['dfs_self']:.2f}",
            "dataforseo_resolved": f"{orr[1]['dfs_self']:.2f}",
            "cloro": f"{o[1]['cloro_self']:.2f}",
        },
        {
            "metric": "Top 10 pages shared with the other provider",
            "dataforseo": f"{o[0]['providers_pages']:.2f} (against cloro)",
            "dataforseo_resolved": f"{orr[0]['providers_pages']:.2f} (against cloro)",
            "cloro": "n/a",
        },
        {
            "metric": "Top 75 pages shared with the other provider",
            "dataforseo": f"{o[1]['providers_pages']:.2f} (against cloro)",
            "dataforseo_resolved": f"{orr[1]['providers_pages']:.2f} (against cloro)",
            "cloro": "n/a",
        },
        {
            "metric": "Median distance from Search Console, depth 75, places",
            "dataforseo": f"{by(b, 'dfs')['median_distance']}",
            "dataforseo_resolved": f"{by(br, 'dfs')['median_distance']}",
            "cloro": f"{by(b, 'cloro')['median_distance']}",
        },
        {
            "metric": "Tasks where poisoned results were found and replaced",
            "dataforseo": "n/a",
            "dataforseo_resolved": f"{h22} of {t22} on page one, {h23} of {t23} at depth 75",
            "cloro": "n/a",
        },
        {
            "metric": "Listings replaced from Google's Web mode",
            "dataforseo": "n/a",
            "dataforseo_resolved": f"{n22} on page one, {n23} at depth 75",
            "cloro": "n/a",
        },
        {
            "metric": "Mean cost of one page-one task",
            "dataforseo": f"${mean(cost22):.5f}",
            "dataforseo_resolved": f"${mean(cost22r):.5f}",
            "cloro": "5 credits",
        },
        {
            "metric": "Mean cost of one depth-75 task",
            "dataforseo": f"${mean(cost23):.4f}",
            "dataforseo_resolved": f"${mean(cost23r):.4f}",
            "cloro": "19 credits",
        },
        {
            "metric": "Median wait for one depth-75 task, seconds",
            "dataforseo": f"{median([float(w) for w in wait23]):.0f}",
            "dataforseo_resolved": f"{median([float(w) for w in wait23r]):.0f}",
            "cloro": f"{median([float(w) for w in wait23c]):.0f}",
        },
    ]
    return {"scores": scores, "extra": extra}


def _secs(answers: Sequence[Answer], provider: str, series: Sequence[str]) -> list[float]:
    return [
        a.seconds
        for a in answers
        if a.provider == provider and a.series in series and a.seconds is not None
    ]


def _med(values: Sequence[float]) -> str:
    return f"{median([float(v) for v in values]):.0f}" if values else "n/a"


def _slowest(answers: Sequence[Answer], provider: str, series: str) -> str:
    values = _secs(answers, provider, [series])
    return f"{max(values):.0f}" if values else "n/a"


def _mean_cost(answers: Sequence[Answer], series: str) -> float:
    return (
        mean(a.cost for a in answers if a.provider == "dfs" and a.series == series and a.cost)
        or 0.0
    )


def queue_compare(
    sets: dict[str, Sequence[Answer]], p1: dict[str, Any], d75: dict[str, Any]
) -> list[dict[str, str]]:
    """Standard against priority queue (both with the fix) and cloro."""
    std22, pri22, std23, pri23 = sets["std22"], sets["pri22"], sets["std23"], sets["pri23"]
    cl22, cl23, ai_s, ai_p, cl_ai = (
        sets["cl22"],
        sets["cl23"],
        sets["ai_s"],
        sets["ai_p"],
        sets["cl_ai"],
    )
    ai = ("chatgpt", "gemini", "ai_mode")

    def trio(answers: Sequence[Answer], provider: str) -> str:
        return " / ".join(_med(_secs(answers, provider, [n])) for n in ai)

    def row(metric: str, standard: str, priority: str, cloro: str) -> dict[str, str]:
        return {"metric": metric, "standard": standard, "priority": priority, "cloro": cloro}

    return [
        row(
            "Page one: median wait, seconds",
            _med(_secs(std22, "dfs", ["serp"])),
            _med(_secs(pri22, "dfs", ["serp"])),
            _med(_secs(cl22, "cloro", ["google"])),
        ),
        row(
            "Page one: slowest wait, seconds",
            _slowest(std22, "dfs", "serp"),
            _slowest(pri22, "dfs", "serp"),
            _slowest(cl22, "cloro", "google"),
        ),
        row(
            "Depth 75: median wait, seconds",
            _med(_secs(std23, "dfs", ["serp"])),
            _med(_secs(pri23, "dfs", ["serp"])),
            _med(_secs(cl23, "cloro", ["google"])),
        ),
        row(
            "Depth 75: slowest wait, seconds",
            _slowest(std23, "dfs", "serp"),
            _slowest(pri23, "dfs", "serp"),
            _slowest(cl23, "cloro", "google"),
        ),
        row(
            "AI answers: median wait, seconds (ChatGPT / Gemini / AI Mode)",
            trio(ai_s, "dfs"),
            trio(ai_p, "dfs"),
            "task time "
            + " / ".join(
                _med(
                    [
                        a.provider_seconds
                        for a in cl_ai
                        if a.provider == "cloro"
                        and a.series == n
                        and a.provider_seconds is not None
                    ]
                )
                for n in ai
            ),
        ),
        row(
            "Page-one task, mean cost",
            f"${_mean_cost(std22, 'serp'):.5f}",
            f"${_mean_cost(pri22, 'serp'):.4f}",
            "5 credits",
        ),
        row(
            "Depth-75 task, mean cost",
            f"${_mean_cost(std23, 'serp'):.4f}",
            f"${_mean_cost(pri23, 'serp'):.4f}",
            "19 credits",
        ),
        row("One AI answer, price", "$0.0012", "$0.0024", "4 to 7 credits"),
        row(
            "Site found on page one (of 30 runs)",
            f"{by(p1['std'], 'dfs')['found_in_top_10']}",
            f"{by(p1['pri'], 'dfs')['found_in_top_10']}",
            f"{by(p1['std'], 'cloro')['found_in_top_10']}",
        ),
        row(
            "Site found within 75 (of 38 runs)",
            f"{by(d75['std'], 'dfs')['found_with_truth']}",
            f"{by(d75['pri'], 'dfs')['found_with_truth']}",
            f"{by(d75['std'], 'cloro')['found_with_truth']}",
        ),
        row(
            "Result links",
            "Real page addresses",
            "Google redirect links (google.com/goto); only the visible site address remains",
            "Real page addresses",
        ),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("s20", "s21", "s22", "s23", "s22r", "s23r", "s22p", "s23p", "ai2", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    options = parser.parse_args()
    a20, a21 = load(options.s20), load(options.s21)
    pooled = [*a20, *a21]
    browser = json.loads((options.s23 / "real_browser.json").read_text())
    a22, a23 = load(options.s22), load(options.s23)
    a22r, a23r = load(options.s22r), load(options.s23r)
    p1, d75 = page_one(a22), depth75(a23, browser)
    p1r, d75r = page_one(a22r), depth75(a23r, browser)
    a22p, a23p = load(options.s22p), load(options.s23p)
    ai_s, ai_p = load(options.ai2 / "standard"), load(options.ai2 / "priority")
    p1p, d75p = page_one(a22p), depth75(a23p, browser)
    resolved_positions(p1["queries"], a22r, "query")
    resolved_positions(d75["keywords"], a23r, "keyword")
    resolved_positions(d75["real"], a23r, "keyword")
    for row, fixed in zip(d75["overlap"], d75r["overlap"], strict=True):
        row["dfs_resolved_self"] = fixed["dfs_self"]
        row["providers_resolved_pages"] = fixed["providers_pages"]
    out: dict[str, Any] = {
        "delivery": [
            *delivery("S-20 free key, 1 task at a time", a20),
            *delivery("S-21 paid key, 10 at a time", a21),
            *delivery("S-22 page one against Search Console", a22),
            *delivery("S-23 depth 75, 20 app keywords", a23),
            *delivery(
                "S-22 again, with resolve_poisoned_results",
                [a for a in a22r if a.provider == "dfs"],
            ),
            *delivery(
                "S-23 again, with resolve_poisoned_results",
                [a for a in a23r if a.provider == "dfs"],
            ),
            *delivery(
                "S-22 again, priority queue with the fix", [a for a in a22p if a.provider == "dfs"]
            ),
            *delivery(
                "S-23 again, priority queue with the fix", [a for a in a23p if a.provider == "dfs"]
            ),
            *delivery("Clean AI timing, standard queue", ai_s),
            *delivery("Clean AI timing, priority queue", ai_p),
        ],
        "content": content(pooled),
        "agreement": agreement(pooled),
        "geo": geo(pooled),
        "serp_pooled": serp_pooled(pooled),
        "page_one": p1,
        "depth75": d75,
        "cost": cost(a23, a23r),
        "queue": queue_compare(
            {
                "std22": a22r,
                "pri22": a22p,
                "std23": a23r,
                "pri23": a23p,
                "cl22": a22,
                "cl23": a23,
                "ai_s": ai_s,
                "ai_p": ai_p,
                "cl_ai": pooled,
            },
            {"std": p1r["stats"], "pri": p1p["stats"]},
            {"std": d75r["stats"], "pri": d75p["stats"]},
        ),
        "poison": poison_blocks(
            p1,
            d75,
            p1r,
            d75r,
            (options.s22, options.s23, options.s22r, options.s23r),
            (a22, a23, a22r, a23r),
        ),
    }
    options.out.mkdir(parents=True, exist_ok=True)
    for key, value in out.items():
        # one file per list of rows: a dataset is one table
        parts = value.items() if isinstance(value, dict) else [("", value)]
        for sub, rows in parts:
            name = f"{key}_{sub}" if sub else key
            (options.out / f"{name}.json").write_text(
                json.dumps(rows, indent=1, ensure_ascii=False)
            )
    say(f"wrote {len(out)} files to {options.out}")


if __name__ == "__main__":
    main()
