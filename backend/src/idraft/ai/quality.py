"""AI quality counters (docs/25-observability.md section 9, BE-OPS-14): is what the engines send
back still what we expect? Computed from `ai.observations`, nothing is stored, nothing is
raised and no answer is marked invalid: a heuristic only flags (docs/26 section 9.1).

Five check families, one grouped statement each, so the number of statements is the same for one
project and for a thousand. A window is one UTC day; the baseline is the 7 UTC days before it.
Every ratio keeps its numerator and denominator, and a check below its minimum sample, or without
a baseline to compare with, is `insufficient_data`: unknown is never `ok`.

Superseded answers are counted: they are real provider answers, and this is about the provider,
not about the metrics (which exclude them).

The reads run as the owner role (the CLI refuses any other) and so see every workspace, grouped by
`workspace_id` and `project_id`. A caller can bind one workspace and project; the statements then
filter on both as bound values, and row-level security is a second guard, not the only one.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from fractions import Fraction

import asyncpg

RULE_VERSION = 1
BASELINE_DAYS = 7

STATUS_MIX = "ai_status_mix"
REFUSED_SHARE = "ai_status_mix_refused"
CITATION_PRESENCE = "ai_citation_presence"
FANOUT_PRESENCE = "ai_fanout_presence"
MODEL_CHANGE = "ai_model_change"
DUPLICATE_ANSWERS = "ai_duplicate_answers"


class State(StrEnum):
    OK = "ok"
    FLAGGED = "flagged"
    INSUFFICIENT_DATA = "insufficient_data"


@dataclass(frozen=True)
class Check:
    """A check's rule: it flags above (`error + empty` share, refused against its baseline,
    duplicates) or below (presence against its baseline) `threshold`, and says nothing under
    `minimum_n` units. For the baseline checks the threshold is a factor of the baseline share."""

    name: str
    minimum_n: int
    threshold: Fraction
    reference: str


CHECKS: dict[str, Check] = {
    check.name: check
    for check in (
        Check(STATUS_MIX, 100, Fraction(1, 10), "docs/25 section 9, AI status mix"),
        Check(REFUSED_SHARE, 100, Fraction(2), "docs/25 section 9, AI status mix"),
        Check(CITATION_PRESENCE, 200, Fraction(7, 10), "docs/25 section 9, citation presence"),
        Check(FANOUT_PRESENCE, 100, Fraction(1, 2), "docs/25 section 9, fan-out presence"),
        Check(MODEL_CHANGE, 1, Fraction(0), "docs/25 section 9, model change"),
        Check(DUPLICATE_ANSWERS, 50, Fraction(1, 2), "docs/25 section 9, duplicate answers"),
    )
}


@dataclass(frozen=True)
class QualityResult:
    """One check for one engine of one project. `value` is `numerator / n`; the baseline carries
    its own numerator and denominator. `n` is the count the minimum sample is held against."""

    check: str
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    engine_code: str
    numerator: int
    n: int
    value: float | None
    baseline_numerator: int | None
    baseline_n: int | None
    baseline: float | None
    threshold: float
    state: State
    detail: str = ""


def _share(numerator: int, n: int) -> float | None:
    return numerator / n if n else None


def _result(
    check: str,
    row: asyncpg.Record,
    numerator: int,
    n: int,
    state: State,
    *,
    baseline: tuple[int, int] | None = None,
    detail: str = "",
) -> QualityResult:
    return QualityResult(
        check=check,
        workspace_id=row["workspace_id"],
        project_id=row["project_id"],
        engine_code=row["engine_code"],
        numerator=numerator,
        n=n,
        value=_share(numerator, n),
        baseline_numerator=baseline[0] if baseline else None,
        baseline_n=baseline[1] if baseline else None,
        baseline=_share(*baseline) if baseline else None,
        threshold=float(CHECKS[check].threshold),
        state=state,
        detail=detail,
    )


# The statements are literals (no SQL is built from strings). Each ends its WHERE with the tenant
# filter: two bound values, workspace then project, and null reads everything (owner role only).
# $1 day start, $2 baseline start, $3 day end, $4 workspace, $5 project. A group with no answer
# on the day has nothing to report and is left out.
_STATUS_MIX = """
SELECT workspace_id, project_id, engine_code,
       count(*) FILTER (WHERE observed_at >= $1) AS n,
       count(*) FILTER (WHERE observed_at >= $1 AND status IN ('error', 'empty')) AS failed,
       count(*) FILTER (WHERE observed_at >= $1 AND status = 'refused') AS refused,
       count(*) FILTER (WHERE observed_at < $1) AS base_n,
       count(*) FILTER (WHERE observed_at < $1 AND status = 'refused') AS base_refused
FROM ai.observations
WHERE observed_at >= $2 AND observed_at < $3
  AND ($4::uuid IS NULL OR true) AND ($5::uuid IS NULL OR true)
GROUP BY workspace_id, project_id, engine_code
HAVING count(*) FILTER (WHERE observed_at >= $1) > 0
"""

# Valid answers are `complete` and `partial`; the share is of those.
_CITATIONS = """
SELECT workspace_id, project_id, engine_code,
       count(*) FILTER (WHERE observed_at >= $1) AS n,
       count(*) FILTER (WHERE observed_at >= $1 AND status IN ('complete', 'partial')
                        AND has_citations) AS present,
       count(*) FILTER (WHERE observed_at < $1 AND status IN ('complete', 'partial')) AS base_n,
       count(*) FILTER (WHERE observed_at < $1 AND status IN ('complete', 'partial')
                        AND has_citations) AS base_present
FROM ai.observations
WHERE observed_at >= $2 AND observed_at < $3
  AND ($4::uuid IS NULL OR workspace_id = $4) AND ($5::uuid IS NULL OR project_id = $5)
GROUP BY workspace_id, project_id, engine_code
HAVING count(*) FILTER (WHERE observed_at >= $1) > 0
"""

# Only `chatgpt_web` exposes fan-out (docs/07 section 2).
_FANOUT = """
SELECT workspace_id, project_id, engine_code,
       count(*) FILTER (WHERE observed_at >= $1 AND status IN ('complete', 'partial')) AS n,
       count(*) FILTER (WHERE observed_at >= $1 AND status IN ('complete', 'partial')
                        AND fanout_count > 0) AS present,
       count(*) FILTER (WHERE observed_at < $1 AND status IN ('complete', 'partial')) AS base_n,
       count(*) FILTER (WHERE observed_at < $1 AND status IN ('complete', 'partial')
                        AND fanout_count > 0) AS base_present
FROM ai.observations
WHERE observed_at >= $2 AND observed_at < $3
  AND ($4::uuid IS NULL OR workspace_id = $4) AND ($5::uuid IS NULL OR project_id = $5)
GROUP BY workspace_id, project_id, engine_code
HAVING count(*) FILTER (WHERE observed_at >= $1) > 0
"""

# $1 day start, $2 day end, $3 workspace, $4 project. A model is new when its first answer of the
# project and engine is on the day. shortcut: reads the whole history of the scope, upgrade to a
# table of models seen when the observation table is large (BE-OPS-14 persisted half).
_MODEL_CHANGE = """
WITH seen AS (
    SELECT workspace_id, project_id, engine_code, model_reported,
           min(observed_at) AS first_seen,
           count(*) FILTER (WHERE observed_at >= $1) AS answers
    FROM ai.observations
    WHERE observed_at < $2 AND model_reported IS NOT NULL
      AND ($3::uuid IS NULL OR workspace_id = $3) AND ($4::uuid IS NULL OR project_id = $4)
    GROUP BY workspace_id, project_id, engine_code, model_reported
)
SELECT workspace_id, project_id, engine_code,
       count(*) FILTER (WHERE answers > 0) AS n,
       count(*) FILTER (WHERE answers > 0 AND first_seen >= $1) AS new_models,
       count(*) FILTER (WHERE first_seen < $1) AS known_models,
       array_agg(model_reported ORDER BY model_reported)
           FILTER (WHERE answers > 0 AND first_seen >= $1) AS new_names
FROM seen
GROUP BY workspace_id, project_id, engine_code
HAVING count(*) FILTER (WHERE answers > 0) > 0
"""

# $1 day start, $2 day end, $3 workspace, $4 project. A replicate group is the answers of one run
# to one prompt version on one engine; a group of one cannot repeat itself. Answers without a
# hash cannot be compared and are left out.
_DUPLICATES = """
WITH g AS (
    SELECT workspace_id, project_id, engine_code, collection_run_id, prompt_version_id,
           count(*) AS reps, count(DISTINCT answer_hash) AS distinct_answers
    FROM ai.observations
    WHERE observed_at >= $1 AND observed_at < $2 AND status = 'complete'
      AND prompt_version_id IS NOT NULL AND collection_run_id IS NOT NULL
      AND answer_hash IS NOT NULL
      AND ($3::uuid IS NULL OR workspace_id = $3) AND ($4::uuid IS NULL OR project_id = $4)
    GROUP BY workspace_id, project_id, engine_code, collection_run_id, prompt_version_id
    HAVING count(*) > 1
)
SELECT workspace_id, project_id, engine_code, count(*) AS n,
       count(*) FILTER (WHERE distinct_answers < reps) AS duplicated
FROM g
GROUP BY workspace_id, project_id, engine_code
"""


def _status_mix(rows: list[asyncpg.Record]) -> list[QualityResult]:
    mix, refused_check = CHECKS[STATUS_MIX], CHECKS[REFUSED_SHARE]
    results: list[QualityResult] = []
    for row in rows:
        n, failed, refused = row["n"], row["failed"], row["refused"]
        base_n, base_refused = row["base_n"], row["base_refused"]
        if n < 50:  # MUTATION M1
            state = State.INSUFFICIENT_DATA
        else:
            state = State.FLAGGED if Fraction(failed, n) >= mix.threshold else State.OK
        results.append(_result(STATUS_MIX, row, failed, n, state))
        if n < refused_check.minimum_n or base_n == 0:
            refused_state = State.INSUFFICIENT_DATA
        elif Fraction(refused, n) > refused_check.threshold * Fraction(base_refused, base_n):
            refused_state = State.FLAGGED
        else:
            refused_state = State.OK
        results.append(
            _result(REFUSED_SHARE, row, refused, n, refused_state, baseline=(base_refused, base_n))
        )
    return results


def _presence(check_name: str, rows: list[asyncpg.Record]) -> list[QualityResult]:
    check = CHECKS[check_name]
    results: list[QualityResult] = []
    for row in rows:
        n, present, base_n, base_present = (
            row["n"],
            row["present"],
            row["base_n"],
            row["base_present"],
        )
        if n < check.minimum_n:
            state = State.INSUFFICIENT_DATA
        elif Fraction(present, n) < check.threshold * Fraction(base_present, base_n):
            state = State.FLAGGED
        else:
            state = State.OK
        results.append(_result(check_name, row, present, n, state, baseline=(base_present, base_n)))
    return results


def _model_change(rows: list[asyncpg.Record]) -> list[QualityResult]:
    results: list[QualityResult] = []
    for row in rows:
        new_models, known = row["new_models"], row["known_models"]
        if new_models == 0:
            state = State.OK
        elif known == 0:
            # The first models of an engine are not a change: there is nothing to change from.
            state = State.INSUFFICIENT_DATA
        else:
            state = State.FLAGGED
        results.append(
            _result(
                MODEL_CHANGE,
                row,
                new_models,
                row["n"],
                state,
                detail=", ".join(row["new_names"] or ()),
            )
        )
    return results


def _duplicates(rows: list[asyncpg.Record]) -> list[QualityResult]:
    check = CHECKS[DUPLICATE_ANSWERS]
    results: list[QualityResult] = []
    for row in rows:
        n, duplicated = row["n"], row["duplicated"]
        if n < check.minimum_n:
            state = State.INSUFFICIENT_DATA
        else:
            state = State.FLAGGED if Fraction(duplicated, n) >= check.threshold else State.OK
        results.append(_result(DUPLICATE_ANSWERS, row, duplicated, n, state))
    return results


async def ai_quality_checks(
    connection: asyncpg.Connection[asyncpg.Record],
    day: date,
    *,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> list[QualityResult]:
    """The checks for the UTC `day`, per workspace, project and engine, in one read only
    transaction (five statements, whatever the number of projects). Bind `workspace_id` and
    `project_id` to read one project; leave both out to read every project (owner role)."""
    day_start = datetime.combine(day, time.min)
    day_end = day_start + timedelta(days=1)
    baseline_start = day_start - timedelta(days=BASELINE_DAYS)
    window = (day_start, baseline_start, day_end, workspace_id, project_id)
    own = (day_start, day_end, workspace_id, project_id)
    async with connection.transaction(isolation="repeatable_read", readonly=True):
        mix = await connection.fetch(_STATUS_MIX, *window)
        citations = await connection.fetch(_CITATIONS, *window)
        fanout = await connection.fetch(_FANOUT, *window)
        models = await connection.fetch(_MODEL_CHANGE, *own)
        duplicates = await connection.fetch(_DUPLICATES, *own)
    results = [
        *_status_mix(mix),
        *_presence(CITATION_PRESENCE, citations),
        *_presence(FANOUT_PRESENCE, fanout),
        *_model_change(models),
        *_duplicates(duplicates),
    ]
    return sorted(
        results, key=lambda r: (str(r.workspace_id), str(r.project_id), r.engine_code, r.check)
    )


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def render_table(results: list[QualityResult], day: date) -> str:
    """A plain table: project, window, engine, check, value, n, state (and the detail)."""
    window = f"{day.isoformat()} (baseline {BASELINE_DAYS} days)"
    header = ("project", "window", "engine", "check", "value", "n", "state")
    rows = [
        (
            f"{r.workspace_id}/{r.project_id}",
            window,
            r.engine_code,
            r.check,
            f"{r.numerator}/{r.n} = {_percent(r.value)}",
            str(r.n),
            f"{r.state.value} {r.detail}".strip(),
        )
        for r in results
    ]
    widths = [max(len(line[i]) for line in (header, *rows)) for i in range(len(header))]
    lines = [header, *rows]
    return "\n".join(
        "  ".join(cell.ljust(width) for cell, width in zip(line, widths, strict=True)).rstrip()
        for line in lines
    )
