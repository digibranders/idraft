# AI answer screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the real platform page of an AI answer (what a logged-out ChatGPT, Gemini or Google AI Mode user sees) as an image in the Screenshot column of the Prompts page, captured from DataForSEO, stored by the app, and served only to people who can read the project.

**Architecture:** DataForSEO's `POST /v3/serp/screenshot` renders the saved page of an LLM scraper or AI Mode task into a PNG for $0.004. The backend calls it for one observation (an AI answer) on request, downloads the image the same day, trims the blank space, stores it in the raw bucket, records the cost, and serves it through an authenticated route. The `ai/prompts-summary` read gets the `latest` field that the web already expects (`docs/ai-visibility/backend-requests-prompts-page.md`, the `latest` row and the "Screenshot spike"), and the web screenshot cell gets a Capture state.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy Core, Alembic (hand-written SQL), `uv`, pytest; Pillow (new); aiobotocore (existing raw store); Next.js, React, TypeScript, vitest, MSW.

---

## What the 2026-11-23 test established (the facts this plan rests on)

Test: real tasks, `scratchpad/shots`, about $0.03 spent. Reports: `docs/spikes/S-20-findings.md` to `S-21-findings.md`, artifact "DataForSEO vs cloro Test".

| Fact | Evidence |
|---|---|
| `POST /v3/serp/screenshot` with `{"task_id": <LLM scraper or AI Mode task id>}` returns a PNG link. It worked for ChatGPT, Gemini and AI Mode tasks. | Four live calls, status 20000 |
| Price: $0.004 a screenshot, charged per request, whatever the size. | `cost: 0.004` on every response |
| The default capture is 1920×1080 (desktop). `browser_screen_height` accepts up to 9,999. A taller capture holds the whole answer. | ChatGPT answer ended at about 4,600 px (a 4,500 px capture was cut off); Gemini at about 2,200 px; AI Mode came back full length (2,062 px) by default |
| A tall capture has blank space below the answer and the platform's fixed prompt box at the very bottom. Trim it. | `chatgpt_9999.png`, `gemini_6000.png` |
| The image link stays valid one day. The task can be screenshotted for 7 days after it was posted. | DataForSEO docs, `/v3/serp/screenshot` |
| The screenshot shows inline citation pills and link rows but not the full Sources panel (it is behind a button). The complete list stays in the API data (`ai.observations` citations). | ChatGPT: 5 of 6 API sources on the page; Gemini answer had none; AI Mode chips and cards visible |
| The page is the logged-out experience (Log in, Sign in buttons) for the task's location. | Screenshots |
| The image link needs no login to download. | `GET` of the link with no header returned 200, `image/png` |
| cloro returns no screenshots (only an HTML link that expires in 24 hours). | cloro docs, output-formats |

## Decisions

1. **On demand, not automatic, in this plan.** A person opens the Screenshot cell of an answer and presses Capture. It costs $0.004 once; the image is then stored for good and shown to everyone. Capturing every answer would cost about $15.59 a month at the base plan (150 prompts, three engines, twice a week) against $4.68 for the answers themselves. Automatic capture is a follow-up plan: it needs a per-engine switch and a budget check, which this plan does not build.
2. **7-day window.** A screenshot can only be made within 7 days of the answer's task. After that the cell says "Expired" and no spend is possible. A weekly schedule can run into this edge.
3. **Capture height 9,999, then trim.** One request, one price. The stored PNG is trimmed to the end of the answer. A capture whose content reaches the bottom edge before the 9,999 limit is marked `truncated` (a longer answer than the limit; very unlikely).
4. **One screenshot per observation, never replaced.** A second press returns the stored one and spends nothing.
5. **Served by our API, not by a signed bucket link.** The raw bucket has no signing support in `storage/raw.py`, and the image is private to the workspace. The route returns the PNG with `Cache-Control: private`. `screenshot_url` in the summary is the route's path.
6. **Stored like raw payloads.** The PNG is zstd-compressed through the existing `RawStore.put` and `compress` (no interface change) under `screenshots/v1/...`, outside the `raw/v1/<class>/` prefixes that the bucket lifecycle rules expire, so it is kept.
7. **Cost recorded as an `ai_prompt` cost event** (provider `dataforseo`, endpoint `/v3/serp/screenshot`, channel `ai`), so budgets and the Costs screen see it. No new workload value, so no constraint change.
8. **Citations come from the structured data.** The dialog shows the screenshot and, beside it, the citation list from the observation, because the image does not show the full Sources panel.

## File structure

| File | Responsibility |
|---|---|
| `backend/pyproject.toml` | add `pillow` |
| `backend/src/idraft/screenshots/__init__.py` | package marker |
| `backend/src/idraft/screenshots/trim.py` | pure image rules: trim blank rows, detect a truncated capture |
| `backend/src/idraft/providers/dataforseo/screenshot.py` | request body and answer reading for `/v3/serp/screenshot` |
| `backend/src/idraft/providers/dataforseo/client.py` | one new call-limit family, `screenshot` |
| `backend/src/idraft/db/migrations/versions/0030_ai_observation_screenshots.py` | table `ai.observation_screenshots` |
| `backend/src/idraft/db/tables.py` | its `Table` definition |
| `backend/src/idraft/storage/screenshots.py` | storage key, `put_screenshot`, `get_screenshot` |
| `backend/src/idraft/screenshots/service.py` | the capture flow: window check, provider call, download, trim, store, record |
| `backend/src/idraft/api/ai/screenshot_routes.py` | `POST` and `GET .../ai/observations/{id}/screenshot` |
| `backend/src/idraft/api/ai/summary_repository.py`, `api/schemas/ai.py` | the `latest` field of `ai/prompts-summary` |
| `backend/tests/screenshots/`, `backend/tests/providers/`, `backend/tests/api/ai/` | tests |
| `apps/web/src/features/prompts/lists/answer-dialog.tsx` | accept the API path, show truncation, show citations |
| `apps/web/src/features/prompts/lists/screenshot-cell.tsx` | Capture, Expired and image states |
| `apps/web/src/lib/api/prompt-facts.ts` | `screenshot_state` on `LatestAnswer` |
| `apps/web/src/mocks/handlers/prompt-answers.ts` | MSW handlers for the two routes |

Work in a worktree under `.claude/worktrees/ai-screenshots` on a branch cut from `develop` (`AGENTS.md`, "Working beside other sessions"). Land on `develop`. Never push `main`.

---

### Task 1: Image rules (trim and truncation)

These rules were checked on six real captures from the 2026-11-23 test (the code below, run outside the repo):

| Capture | Asked for | Result |
|---|---|---|
| ChatGPT, default | 1080 px | cut off (flagged) |
| ChatGPT, tall | 4,500 px | cut off (flagged) |
| ChatGPT, tallest | 9,999 px | kept 4,662 px, complete |
| Gemini, default | 1080 px | cut off (flagged) |
| Gemini, tall | 6,000 px | kept 2,205 px, complete |
| Google AI Mode | 9,999 px (provider returned 2,062) | kept whole, complete |

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/src/idraft/screenshots/__init__.py`
- Create: `backend/src/idraft/screenshots/trim.py`
- Test: `backend/tests/screenshots/__init__.py`, `backend/tests/screenshots/test_trim.py`

- [ ] **Step 1: Add the dependency**

Run: `cd backend && uv add "pillow>=12.0.0"`
Expected: `pyproject.toml` and `uv.lock` change; `uv run python -c "import PIL; print(PIL.__version__)"` prints a version.

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/screenshots/test_trim.py
"""Trimming a tall capture of an AI answer page and spotting one that was cut off."""

from __future__ import annotations

import io

import pytest
from PIL import Image, ImageDraw

from idraft.screenshots.trim import CaptureError, Trimmed, trim_capture

WIDTH = 400
BACKGROUND = (250, 250, 250)


def _png(height: int, *, text_rows: tuple[int, int] | None, bar_at_bottom: bool) -> bytes:
    """A page of `height` pixels: dark text rows in the main column, and (like the platform's
    fixed prompt box) a bar drawn at the very bottom."""
    image = Image.new("RGB", (WIDTH, height), BACKGROUND)
    draw = ImageDraw.Draw(image)
    if text_rows is not None:
        draw.rectangle((100, text_rows[0], 300, text_rows[1]), fill=(20, 20, 20))
    if bar_at_bottom:
        draw.rectangle((100, height - 60, 300, height - 20), fill=(200, 200, 200))
        draw.rectangle((110, height - 50, 290, height - 30), fill=(30, 30, 30))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_blank_space_between_the_answer_and_the_bottom_bar_is_removed() -> None:
    result = trim_capture(_png(3000, text_rows=(100, 900), bar_at_bottom=True), requested_height=3000)
    assert isinstance(result, Trimmed)
    assert result.truncated is False
    assert 900 < result.height < 1100
    assert result.width == WIDTH
    assert Image.open(io.BytesIO(result.png)).height == result.height


def test_an_answer_that_runs_into_the_bottom_bar_is_a_truncated_capture() -> None:
    # The answer reaches the platform's fixed prompt box: it is longer than the capture.
    result = trim_capture(_png(1000, text_rows=(100, 900), bar_at_bottom=True), requested_height=1000)
    assert result.truncated is True
    assert result.height == 1000


def test_a_gap_inside_the_answer_is_not_its_end() -> None:
    # A map placeholder or a large image leaves a blank band of about 400 px inside an answer.
    image = Image.new("RGB", (WIDTH, 3000), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.rectangle((100, 100, 300, 800), fill=(20, 20, 20))
    draw.rectangle((100, 1200, 300, 1900), fill=(20, 20, 20))  # after a 400 px band
    out = io.BytesIO()
    image.save(out, format="PNG")
    result = trim_capture(out.getvalue(), requested_height=3000)
    assert result.truncated is False
    assert result.height > 1900


def test_a_page_shorter_than_asked_for_is_kept_whole() -> None:
    # Google AI Mode answers with the whole page (2,062 px) however tall the request was.
    result = trim_capture(_png(2000, text_rows=(100, 1800), bar_at_bottom=False), requested_height=9999)
    assert result.truncated is False
    assert result.height == 2000


def test_a_capture_with_no_content_is_an_error() -> None:
    with pytest.raises(CaptureError, match="blank"):
        trim_capture(_png(500, text_rows=None, bar_at_bottom=False), requested_height=500)


def test_bytes_that_are_not_an_image_are_an_error() -> None:
    with pytest.raises(CaptureError, match="image"):
        trim_capture(b"not a png", requested_height=500)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/screenshots/test_trim.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'idraft.screenshots'`.

- [ ] **Step 4: Write the implementation**

```python
# backend/src/idraft/screenshots/__init__.py
"""Screenshots of AI answer pages (docs/superpowers/plans/2026-11-23-ai-answer-screenshots.md)."""
```

```python
# backend/src/idraft/screenshots/__init__.py
"""Screenshots of AI answer pages (docs/superpowers/plans/2026-11-23-ai-answer-screenshots.md)."""
```

```python
# backend/src/idraft/screenshots/trim.py
"""What a tall capture of an AI answer page needs before it is kept.

The provider renders the saved page at exactly the height asked for (up to 9,999 px) for ChatGPT
and Gemini, and at the page's own height for Google AI Mode. An answer is shorter than 9,999 px,
so the capture ends in blank space with the platform's fixed prompt box in the last 300 px. The
kept image stops where the answer stops.

Two traps, both seen in the 2026-11-23 captures: an answer can hold a blank band of about 400 px
(a map that did not render), so only a much larger gap ends the answer; and the prompt box sits
about 110 px above the bottom edge, so "content reaches the edge" would never fire. A capture is
cut off when the answer runs into the prompt box.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Final

from PIL import Image, UnidentifiedImageError

# The main column of the platform pages at the 1920 px desktop width, as a share of the width:
# the sidebar and the margins are left out.
MAIN_COLUMN: Final = (0.36, 0.78)
# A pixel this dark counts as content (text, an image edge); the pages are near white.
DARK: Final = 110
# Blank rows kept below the last content row.
PADDING: Final = 48
# The prompt box fixed at the bottom of a capture occupies about this many of the last rows.
BOTTOM_UI: Final = 300
# A blank gap larger than this ends the answer. Gaps inside answers measured up to about 400 px;
# the gap between a short answer and the prompt box of a 9,999 px capture is thousands.
GAP: Final = 1000


class CaptureError(ValueError):
    """The bytes are not a usable capture."""


@dataclass(frozen=True, slots=True)
class Trimmed:
    png: bytes
    width: int
    height: int
    truncated: bool


def _content_rows(image: Image.Image) -> list[int]:
    gray = image.convert("L")
    left = int(gray.width * MAIN_COLUMN[0])
    right = int(gray.width * MAIN_COLUMN[1])
    # Threshold once, then test each row as one byte slice: a 9,999 px capture is 8 million pixels.
    column = gray.crop((left, 0, right, gray.height)).point(lambda value: 255 if value < DARK else 0)
    width = column.width
    data = column.tobytes()
    return [y for y in range(column.height) if any(data[y * width : (y + 1) * width])]


def _encode(image: Image.Image, *, truncated: bool) -> Trimmed:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return Trimmed(png=out.getvalue(), width=image.width, height=image.height, truncated=truncated)


def trim_capture(data: bytes, *, requested_height: int) -> Trimmed:
    """The capture without the blank space after the answer. `requested_height`: the
    `browser_screen_height` the capture was asked for."""
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise CaptureError("the bytes are not an image") from error
    rows = _content_rows(image)
    if not rows:
        raise CaptureError("the capture is blank")
    if image.height < requested_height - 1:
        # The provider returned a page shorter than asked for (Google AI Mode): it is complete.
        return _encode(image, truncated=False)
    # The answer is the first run of content rows; a later run after a large gap is the
    # platform's own prompt box.
    end = rows[0]
    for previous, current in zip(rows, rows[1:], strict=False):
        if current - previous > GAP:
            break
        end = current
    truncated = end >= image.height - BOTTOM_UI
    if truncated:
        return _encode(image, truncated=True)
    return _encode(image.crop((0, 0, image.width, min(image.height, end + PADDING))), truncated=False)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/screenshots/test_trim.py -q`
Expected: 6 passed. If `test_blank_space...` fails on the height bounds, print `result.height` and adjust `PADDING`, not the test.

- [ ] **Step 6: Lint, types, commit**

Run: `cd backend && uv run ruff format src/idraft/screenshots tests/screenshots && uv run ruff check src/idraft/screenshots tests/screenshots && uv run mypy src/idraft/screenshots tests/screenshots`
Expected: all clean.

```bash
git add backend/pyproject.toml backend/uv.lock backend/src/idraft/screenshots backend/tests/screenshots
git commit -m "feat: trim tall AI answer captures and spot cut-off ones"
```

---

### Task 2: DataForSEO screenshot adapter

**Files:**
- Create: `backend/src/idraft/providers/dataforseo/screenshot.py`
- Modify: `backend/src/idraft/providers/dataforseo/client.py:49-62` (the `FAMILY_LIMITS` table)
- Test: `backend/tests/providers/dataforseo/test_screenshot.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/providers/dataforseo/test_screenshot.py
"""The body of a screenshot request and the reading of its answer. The answer's shape is the one
DataForSEO documents for POST /v3/serp/screenshot and returned on 2026-11-23 for ChatGPT,
Gemini and AI Mode tasks."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from idraft.providers.dataforseo.screenshot import (
    PATH,
    SCREENSHOT_HEIGHT,
    ScreenshotLink,
    UnreadableScreenshotError,
    read_screenshot,
    screenshot_body,
)

TASK_ID = "11231230-2666-0066-0000-4cb2621d82f1"

ANSWER = {
    "version": "0.1.20261117",
    "status_code": 20000,
    "status_message": "Ok.",
    "cost": 0.004,
    "tasks_count": 1,
    "tasks_error": 0,
    "tasks": [
        {
            "id": "11231815-2666-0139-0000-3a1f5b8c9d20",
            "status_code": 20000,
            "status_message": "Ok.",
            "cost": 0.004,
            "result_count": 1,
            "result": [
                {"items_count": 1, "items": [{"image": "https://api.dataforseo.com/v3/serp/screenshot/abc.png"}]}
            ],
        }
    ],
}


def test_the_body_names_the_task_a_desktop_and_the_tallest_page() -> None:
    assert screenshot_body(TASK_ID) == [
        {
            "task_id": TASK_ID,
            "browser_preset": "desktop",
            "browser_screen_height": SCREENSHOT_HEIGHT,
        }
    ]
    assert SCREENSHOT_HEIGHT == 9999


def test_the_path_is_the_screenshot_endpoint() -> None:
    assert PATH == "/v3/serp/screenshot"


def test_the_link_and_the_cost_are_read_from_the_answer() -> None:
    link = read_screenshot(json.dumps(ANSWER).encode())
    assert link == ScreenshotLink(
        url="https://api.dataforseo.com/v3/serp/screenshot/abc.png", cost_usd=Decimal("0.004")
    )


def test_an_answer_with_no_image_is_unreadable() -> None:
    empty = {**ANSWER, "tasks": [{**ANSWER["tasks"][0], "result": [{"items_count": 0, "items": []}]}]}
    with pytest.raises(UnreadableScreenshotError, match="image"):
        read_screenshot(json.dumps(empty).encode())


def test_a_link_that_is_not_https_is_refused() -> None:
    odd = json.loads(json.dumps(ANSWER))
    odd["tasks"][0]["result"][0]["items"][0]["image"] = "file:///etc/passwd"
    with pytest.raises(UnreadableScreenshotError, match="address"):
        read_screenshot(json.dumps(odd).encode())


def test_a_task_status_other_than_ok_is_unreadable() -> None:
    failed = json.loads(json.dumps(ANSWER))
    failed["tasks"][0]["status_code"] = 40501
    failed["tasks"][0]["status_message"] = "Invalid Field: 'task_id'."
    with pytest.raises(UnreadableScreenshotError, match="40501"):
        read_screenshot(json.dumps(failed).encode())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/providers/dataforseo/test_screenshot.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'idraft.providers.dataforseo.screenshot'`.

- [ ] **Step 3: Write the adapter**

```python
# backend/src/idraft/providers/dataforseo/screenshot.py
"""DataForSEO's page screenshot (`POST /v3/serp/screenshot`), used for the page an AI engine
showed (ChatGPT, Gemini, Google AI Mode).

The endpoint takes the id of an earlier task, within 7 days of posting it, renders its saved page
and answers with the address of a PNG that stays valid one day. It costs $0.004 a request, at any
height. Tested on 2026-11-23: it works for the ChatGPT scraper, the Gemini scraper and AI Mode.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Final
from urllib.parse import urlsplit

PATH: Final = "/v3/serp/screenshot"
# The call gate's family (client.FAMILY_LIMITS).
FAMILY: Final = "screenshot"
# The tallest page the endpoint takes. An answer is shorter, so the capture is trimmed after.
SCREENSHOT_HEIGHT: Final = 9999
# What one request costs, for estimates; the provider's reported cost is what is recorded.
PRICE_USD: Final = Decimal("0.004")
# DataForSEO keeps the task's page this long.
TASK_WINDOW_DAYS: Final = 7
_OK: Final = 20000


class UnreadableScreenshotError(ValueError):
    """The answer is not a screenshot answer."""


@dataclass(frozen=True, slots=True)
class ScreenshotLink:
    url: str
    cost_usd: Decimal


def screenshot_body(task_id: str) -> list[dict[str, object]]:
    """The request body for the page of one task."""
    return [
        {
            "task_id": task_id,
            "browser_preset": "desktop",
            "browser_screen_height": SCREENSHOT_HEIGHT,
        }
    ]


def read_screenshot(content: bytes) -> ScreenshotLink:
    """The image address and cost of an answer to `screenshot_body`."""
    try:
        envelope = json.loads(content)
        task = envelope["tasks"][0]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise UnreadableScreenshotError("the answer is not a screenshot answer") from error
    if task.get("status_code") != _OK:
        raise UnreadableScreenshotError(
            f"task status {task.get('status_code')}: {str(task.get('status_message'))[:120]}"
        )
    try:
        image = task["result"][0]["items"][0]["image"]
    except (KeyError, IndexError, TypeError) as error:
        raise UnreadableScreenshotError("the answer holds no image") from error
    parts = urlsplit(str(image))
    if parts.scheme != "https" or not parts.netloc:
        raise UnreadableScreenshotError("the image address is not an https address")
    return ScreenshotLink(url=str(image), cost_usd=Decimal(str(task.get("cost", 0))))
```

- [ ] **Step 4: Add the call-limit family**

Modify `backend/src/idraft/providers/dataforseo/client.py`, in `FAMILY_LIMITS`, after the `"serp_live"` entry:

```python
    # Page screenshots of AI answers: a person asks for one at a time ($0.004 each).
    "screenshot": Limit(per_minute=30, burst=5),
```

- [ ] **Step 5: Run the tests, lint, types**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/providers/dataforseo/test_screenshot.py -q && uv run ruff check src/idraft/providers/dataforseo tests/providers && uv run mypy src/idraft/providers/dataforseo/screenshot.py src/idraft/providers/dataforseo/client.py`
Expected: 6 passed, ruff and mypy clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/idraft/providers/dataforseo/screenshot.py backend/src/idraft/providers/dataforseo/client.py backend/tests/providers/dataforseo/test_screenshot.py
git commit -m "feat: DataForSEO page screenshot request and answer reading"
```

---

### Task 3: Table for stored screenshots

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0030_ai_observation_screenshots.py`
- Modify: `backend/src/idraft/db/tables.py` (after `ai_observation_facts`)
- Test: the existing migration tests (`backend/tests/db/test_migrations.py`) must still pass; add `backend/tests/db/test_observation_screenshots.py`

Needs Docker through Colima (`AGENTS.md`, "Checks before you hand work over"): `colima status || colima start --cpu 10 --memory 16` and the two `export` lines there.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/db/test_observation_screenshots.py
"""The table of stored screenshots: one per AI observation, private to its workspace."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def test_the_table_exists_with_its_columns(admin_session: AsyncSession) -> None:
    rows = await admin_session.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'ai' AND table_name = 'observation_screenshots' ORDER BY 1"
        )
    )
    columns = {row[0] for row in rows}
    assert {
        "observation_id", "observed_at", "workspace_id", "project_id", "storage_key",
        "width", "height", "byte_size", "truncated", "cost_usd", "captured_at", "provider_task_id",
    } <= columns


async def test_an_observation_has_one_screenshot(admin_session: AsyncSession, observation_ids: tuple[int, datetime, str, str]) -> None:
    observation_id, observed_at, workspace_id, project_id = observation_ids
    insert = text(
        "INSERT INTO ai.observation_screenshots (observation_id, observed_at, workspace_id, project_id, "
        "storage_key, width, height, byte_size, truncated, cost_usd, provider_task_id) "
        "VALUES (:o, :t, :w, :p, 'screenshots/v1/x.png.zst', 1920, 4700, 100, false, 0.004, 'task')"
    )
    values = {"o": observation_id, "t": observed_at, "w": workspace_id, "p": project_id}
    await admin_session.execute(insert, values)
    with pytest.raises(IntegrityError):
        await admin_session.execute(insert, values)


async def test_a_zero_sized_image_is_refused(admin_session: AsyncSession, observation_ids: tuple[int, datetime, str, str]) -> None:
    observation_id, observed_at, workspace_id, project_id = observation_ids
    with pytest.raises(IntegrityError):
        await admin_session.execute(
            text(
                "INSERT INTO ai.observation_screenshots (observation_id, observed_at, workspace_id, project_id, "
                "storage_key, width, height, byte_size, truncated, cost_usd, provider_task_id) "
                "VALUES (:o, :t, :w, :p, 'k', 0, 0, 0, false, 0, 'task')"
            ),
            {"o": observation_id, "t": observed_at, "w": workspace_id, "p": project_id},
        )


_ = datetime, UTC
```

Before writing, read `backend/tests/db/conftest.py` (or the nearest conftest) and `backend/tests/ai/` for the existing fixture that creates one `ai.observations` row, and use that fixture instead of `observation_ids`. If none returns the four values, add `observation_ids` to `backend/tests/db/conftest.py` by inserting the minimum a row needs, following how `backend/tests/collectors/test_ai_end_to_end.py` builds one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/db/test_observation_screenshots.py -q`
Expected: FAIL (the table does not exist).

- [ ] **Step 3: Write the migration** (pattern: `0029_client_summary_shares.py`)

```python
# backend/src/idraft/db/migrations/versions/0030_ai_observation_screenshots.py
"""AI answer screenshots: the image of the page an AI engine showed for one observation.

One row per observation. The image is in the raw bucket under `storage_key`; the row says
where it is, how big it is, whether the capture was cut off, and what it cost. DataForSEO
makes a screenshot for 7 days after a task, so a screenshot that was not captured then cannot
be made later: a missing row is "never captured", not "pending".

Revision ID: 0030
Revises: 0029
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import grants, statements, tenant_isolation

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE ai.observation_screenshots (
    observation_id   bigint NOT NULL,
    observed_at      timestamptz NOT NULL,
    workspace_id     uuid NOT NULL,
    project_id       uuid NOT NULL,
    storage_key      text NOT NULL CHECK (storage_key <> ''),
    width            integer NOT NULL CHECK (width > 0),
    height           integer NOT NULL CHECK (height > 0),
    byte_size        integer NOT NULL CHECK (byte_size > 0),
    truncated        boolean NOT NULL,
    cost_usd         numeric(14, 6) NOT NULL CHECK (cost_usd >= 0),
    provider_task_id text NOT NULL,
    captured_at      timestamptz NOT NULL DEFAULT now(),
    captured_by      uuid REFERENCES auth.users(id),
    PRIMARY KEY (observation_id, observed_at),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX observation_screenshots_project
    ON ai.observation_screenshots (project_id, observed_at DESC);
"""

_TABLE = "ai.observation_screenshots"


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for statement in tenant_isolation(_TABLE):
        op.execute(statement)
    for statement in grants(_TABLE, api="SELECT, INSERT"):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the rows are lost; the images stay in the bucket.
    op.execute("DROP TABLE ai.observation_screenshots")
```

Do not add a foreign key to `ai.observations`: that table is partitioned by `observed_at` and the existing `observation_facts` rows tie to it by the same two columns without one. Follow `ai.observation_facts` (`tables.py`, near line 1692).

- [ ] **Step 4: Add the `Table` definition** in `backend/src/idraft/db/tables.py`, after `ai_observation_facts`:

```python
ai_observation_screenshots = Table(
    "observation_screenshots",
    metadata,
    Column("observation_id", BigInteger, primary_key=True),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("storage_key", Text, nullable=False),
    Column("width", Integer, nullable=False),
    Column("height", Integer, nullable=False),
    Column("byte_size", Integer, nullable=False),
    Column("truncated", Boolean, nullable=False),
    Column("cost_usd", Numeric(14, 6), nullable=False),
    Column("provider_task_id", Text, nullable=False),
    Column("captured_at", DateTime(timezone=True), server_default=FetchedValue()),
    Column("captured_by", Uuid),
    schema="ai",
)
```

- [ ] **Step 5: Run the migration tests**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/db/test_observation_screenshots.py tests/db/test_migrations.py -q`
Expected: pass. (`test_migrations.py` is flaky under heavy load: run it alone if it fails once.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/idraft/db backend/tests/db
git commit -m "feat: table for stored AI answer screenshots"
```

---

### Task 4: Storage of the image

**Files:**
- Create: `backend/src/idraft/storage/screenshots.py`
- Test: `backend/tests/storage/test_screenshots.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/storage/test_screenshots.py
"""A screenshot is kept in the raw bucket, compressed like a payload, under its own prefix."""

from __future__ import annotations

from uuid import UUID

import pytest

from idraft.storage.screenshots import get_screenshot, put_screenshot, screenshot_key

WORKSPACE = UUID("11111111-1111-1111-1111-111111111111")
PROJECT = UUID("22222222-2222-2222-2222-222222222222")


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


def test_the_key_names_workspace_project_and_observation() -> None:
    key = screenshot_key(WORKSPACE, PROJECT, 4242)
    assert key == f"screenshots/v1/{WORKSPACE}/{PROJECT}/4242.png.zst"
    # Not under raw/v1/<class>/, which the bucket's lifecycle rules expire by prefix.
    assert not key.startswith("raw/")


@pytest.mark.asyncio
async def test_what_is_stored_comes_back_unchanged() -> None:
    store = MemoryStore()
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 5000
    key = await put_screenshot(store, WORKSPACE, PROJECT, 4242, png)
    assert key in store.objects
    assert store.objects[key] != png  # compressed
    assert await get_screenshot(store, key) == png
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/storage/test_screenshots.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'idraft.storage.screenshots'`.

- [ ] **Step 3: Implement**

```python
# backend/src/idraft/storage/screenshots.py
"""Screenshots of AI answer pages, in the raw bucket.

Kept through the same `ObjectStore` as raw payloads and compressed the same way (`raw.compress`),
so the store has one interface. The key is not under `raw/v1/<retention_class>/`: the bucket's
lifecycle rules expire by that prefix, and a screenshot is kept for good (it cannot be captured
again after DataForSEO's 7 days).
"""

from __future__ import annotations

from uuid import UUID

from idraft.storage.raw import ObjectStore, compress, decompress


def screenshot_key(workspace_id: UUID, project_id: UUID, observation_id: int) -> str:
    return f"screenshots/v1/{workspace_id}/{project_id}/{observation_id}.png.zst"


async def put_screenshot(
    store: ObjectStore, workspace_id: UUID, project_id: UUID, observation_id: int, png: bytes
) -> str:
    key = screenshot_key(workspace_id, project_id, observation_id)
    await store.put(key, compress(png))
    return key


async def get_screenshot(store: ObjectStore, key: str) -> bytes:
    return decompress(await store.get(key))
```

- [ ] **Step 4: Run, lint, types, commit**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/storage/test_screenshots.py -q && uv run ruff check src/idraft/storage tests/storage && uv run mypy src/idraft/storage/screenshots.py`
Expected: 2 passed, clean. If `decompress` has a different signature in `storage/raw.py` (it is at line 83), match it and keep the test.

```bash
git add backend/src/idraft/storage/screenshots.py backend/tests/storage/test_screenshots.py
git commit -m "feat: store AI answer screenshots in the raw bucket"
```

---

### Task 5: The capture service

**Files:**
- Create: `backend/src/idraft/screenshots/service.py`
- Test: `backend/tests/screenshots/test_service.py`

The service has no knowledge of HTTP routes. It takes what it needs as arguments so it is testable with fakes.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/screenshots/test_service.py
"""Capturing the screenshot of one AI observation."""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from PIL import Image, ImageDraw

from idraft.screenshots.service import (
    CaptureOutcome,
    ExpiredError,
    ObservationRef,
    UnsupportedEngineError,
    capture_screenshot,
)

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=UTC)
WORKSPACE = UUID("11111111-1111-1111-1111-111111111111")
PROJECT = UUID("22222222-2222-2222-2222-222222222222")


def _page(height: int = 3000) -> bytes:
    image = Image.new("RGB", (1920, height), (250, 250, 250))
    ImageDraw.Draw(image).rectangle((800, 100, 1400, 900), fill=(20, 20, 20))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


@dataclass
class FakeProvider:
    link: str = "https://api.dataforseo.com/v3/serp/screenshot/abc.png"
    cost: Decimal = Decimal("0.004")
    calls: int = 0

    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        self.calls += 1
        return self.link, self.cost


class FakeDownloader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.urls: list[str] = []

    async def __call__(self, url: str) -> bytes:
        self.urls.append(url)
        return self.data


class FakeStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


class FakeLedger:
    def __init__(self, existing: dict[int, str] | None = None) -> None:
        self.rows: list[dict[str, object]] = []
        self.costs: list[dict[str, object]] = []
        self.existing = existing or {}

    async def existing_key(self, observation_id: int) -> str | None:
        return self.existing.get(observation_id)

    async def record(self, row: dict[str, object], cost: dict[str, object]) -> None:
        self.rows.append(row)
        self.costs.append(cost)


def _ref(*, age_days: float = 1, engine: str = "chatgpt_web") -> ObservationRef:
    return ObservationRef(
        observation_id=77, observed_at=NOW - timedelta(days=age_days), workspace_id=WORKSPACE,
        project_id=PROJECT, engine_code=engine, provider_task_id="11231230-2666-0066-0000-4cb2621d82f1",
    )


@pytest.mark.asyncio
async def test_a_recent_answer_is_captured_trimmed_stored_and_costed() -> None:
    provider, store, ledger = FakeProvider(), FakeStore(), FakeLedger()
    outcome = await capture_screenshot(_ref(), provider=provider, download=FakeDownloader(_page()), store=store, ledger=ledger, now=NOW)
    assert isinstance(outcome, CaptureOutcome)
    assert outcome.created is True
    assert outcome.truncated is False
    assert provider.calls == 1
    assert len(store.objects) == 1
    assert ledger.rows[0]["height"] < 3000
    assert ledger.costs[0]["cost_usd"] == Decimal("0.004")
    assert ledger.costs[0]["endpoint"] == "/v3/serp/screenshot"


@pytest.mark.asyncio
async def test_a_second_press_returns_the_stored_screenshot_and_spends_nothing() -> None:
    provider, ledger = FakeProvider(), FakeLedger(existing={77: "screenshots/v1/x.png.zst"})
    outcome = await capture_screenshot(_ref(), provider=provider, download=FakeDownloader(_page()), store=FakeStore(), ledger=ledger, now=NOW)
    assert outcome.created is False
    assert provider.calls == 0


@pytest.mark.asyncio
async def test_an_answer_older_than_seven_days_cannot_be_captured() -> None:
    provider = FakeProvider()
    with pytest.raises(ExpiredError):
        await capture_screenshot(_ref(age_days=8), provider=provider, download=FakeDownloader(_page()), store=FakeStore(), ledger=FakeLedger(), now=NOW)
    assert provider.calls == 0


@pytest.mark.asyncio
async def test_an_engine_without_a_platform_page_is_refused_before_any_spend() -> None:
    provider = FakeProvider()
    with pytest.raises(UnsupportedEngineError):
        await capture_screenshot(_ref(engine="claude_api"), provider=provider, download=FakeDownloader(_page()), store=FakeStore(), ledger=FakeLedger(), now=NOW)
    assert provider.calls == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/screenshots/test_service.py -q`
Expected: FAIL, `ModuleNotFoundError` for `idraft.screenshots.service`.

- [ ] **Step 3: Implement**

The engine codes that have a platform page are the ones whose observations came from the DataForSEO scrapers. Before writing `PAGE_ENGINES`, run `cd backend && grep -n "chatgpt_web\|gemini_web\|google_ai_mode\|ai_mode" src/idraft/ai/*.py src/idraft/db/migrations/versions/0*.py | head` and use the exact engine codes it shows (the Eventus seed uses `chatgpt_web` and `gemini_web`).

```python
# backend/src/idraft/screenshots/service.py
"""Capture the screenshot of one AI answer: the page the engine showed.

Steps: the answer must be from a platform that has a page and not older than DataForSEO's
7 days; a screenshot already stored is returned as it is, with no spend; otherwise one
provider call ($0.004), a download of the PNG the same day (the link lives one day), trimming,
storage in the raw bucket, then the row and the cost event are recorded together.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Final, Protocol
from uuid import UUID

from idraft.providers.dataforseo.screenshot import PATH, TASK_WINDOW_DAYS
from idraft.screenshots.trim import trim_capture
from idraft.storage.raw import ObjectStore
from idraft.storage.screenshots import put_screenshot

# Engines whose answer has a platform page: the ChatGPT and Gemini scrapers and AI Mode.
PAGE_ENGINES: Final = frozenset({"chatgpt_web", "gemini_web", "google_ai_mode"})
CAPTURE_HEIGHT: Final = 9999


class ExpiredError(Exception):
    """The answer is past DataForSEO's 7 days: its page can no longer be screenshotted."""


class UnsupportedEngineError(Exception):
    """The engine's answer has no platform page to photograph."""


@dataclass(frozen=True, slots=True)
class ObservationRef:
    observation_id: int
    observed_at: datetime
    workspace_id: UUID
    project_id: UUID
    engine_code: str
    provider_task_id: str


@dataclass(frozen=True, slots=True)
class CaptureOutcome:
    storage_key: str
    created: bool
    truncated: bool
    width: int | None
    height: int | None


class Provider(Protocol):
    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        """The image address and the cost the provider reported."""


class Ledger(Protocol):
    async def existing_key(self, observation_id: int) -> str | None: ...

    async def record(self, row: dict[str, object], cost: dict[str, object]) -> None:
        """Insert the screenshot row and the cost event in one transaction."""


Download = Callable[[str], Awaitable[bytes]]


async def capture_screenshot(
    ref: ObservationRef,
    *,
    provider: Provider,
    download: Download,
    store: ObjectStore,
    ledger: Ledger,
    now: datetime,
    captured_by: UUID | None = None,
) -> CaptureOutcome:
    if ref.engine_code not in PAGE_ENGINES:
        raise UnsupportedEngineError(ref.engine_code)
    existing = await ledger.existing_key(ref.observation_id)
    if existing is not None:
        return CaptureOutcome(storage_key=existing, created=False, truncated=False, width=None, height=None)
    if now - ref.observed_at > timedelta(days=TASK_WINDOW_DAYS):
        raise ExpiredError(ref.observation_id)
    url, cost = await provider.screenshot(ref.provider_task_id)
    raw = await download(url)
    trimmed = trim_capture(raw, requested_height=CAPTURE_HEIGHT)
    key = await put_screenshot(store, ref.workspace_id, ref.project_id, ref.observation_id, trimmed.png)
    await ledger.record(
        {
            "observation_id": ref.observation_id,
            "observed_at": ref.observed_at,
            "workspace_id": ref.workspace_id,
            "project_id": ref.project_id,
            "storage_key": key,
            "width": trimmed.width,
            "height": trimmed.height,
            "byte_size": len(trimmed.png),
            "truncated": trimmed.truncated,
            "cost_usd": cost,
            "provider_task_id": ref.provider_task_id,
            "captured_by": captured_by,
        },
        {
            "occurred_at": now,
            "workspace_id": ref.workspace_id,
            "project_id": ref.project_id,
            "provider_code": "dataforseo",
            "endpoint": PATH,
            "workload": "ai_prompt",
            "channel": "ai",
            "subject_type": "ai_observation",
            "subject_id": str(ref.observation_id),
            "engine_code": ref.engine_code,
            "units": 1,
            "price_unit": "request",
            "cost_usd": cost,
            "cost_source": "provider_reported",
            "billing_period": now.date().replace(day=1),
        },
    )
    return CaptureOutcome(
        storage_key=key, created=True, truncated=trimmed.truncated, width=trimmed.width, height=trimmed.height
    )
```

Check before committing: `cost_source` must be a value `provider_cost_events` accepts. Run `cd backend && grep -n "cost_source" src/idraft/db/migrations/versions/0004_operations.py` and use one of its allowed values for a provider-reported cost.

- [ ] **Step 4: Run, lint, types**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/screenshots -q && uv run ruff check src/idraft/screenshots tests/screenshots && uv run mypy src/idraft/screenshots tests/screenshots`
Expected: 10 passed (6 trim, 4 service), clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/idraft/screenshots/service.py backend/tests/screenshots/test_service.py
git commit -m "feat: capture the screenshot of one AI answer"
```

---

### Task 6: The real adapters (provider call, download, ledger)

**Files:**
- Create: `backend/src/idraft/screenshots/adapters.py`
- Test: `backend/tests/screenshots/test_adapters.py`

These make the Protocols of Task 5 real. Read `backend/src/idraft/providers/dataforseo/client.py` `DataForSeoClient.call` (line 185) and how `collectors/live.py` builds the client first.

- [ ] **Step 1: Write the failing tests** (the HTTP is faked through the client's `httpx` transport the way `backend/tests/providers/dataforseo/` does it; copy that test's client fixture)

```python
# backend/tests/screenshots/test_adapters.py
"""The provider call and the image download behind the capture service."""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest

from idraft.screenshots.adapters import DataForSeoScreenshots, download_image

ANSWER = {
    "version": "0.1", "status_code": 20000, "status_message": "Ok.", "cost": 0.004,
    "tasks_count": 1, "tasks_error": 0,
    "tasks": [{"id": "t", "status_code": 20000, "status_message": "Ok.", "cost": 0.004, "result_count": 1,
               "result": [{"items_count": 1, "items": [{"image": "https://api.dataforseo.com/shot.png"}]}]}],
}


@pytest.mark.asyncio
async def test_the_provider_returns_the_link_and_the_cost(dataforseo_client_factory) -> None:  # type: ignore[no-untyped-def]
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=ANSWER)

    client = dataforseo_client_factory(handler)
    url, cost = await DataForSeoScreenshots(client).screenshot("task-1")
    assert url == "https://api.dataforseo.com/shot.png"
    assert cost == Decimal("0.004")
    assert seen[0].url.path == "/v3/serp/screenshot"
    assert json.loads(seen[0].content)[0]["task_id"] == "task-1"


@pytest.mark.asyncio
async def test_the_download_returns_the_bytes() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"}))
    async with httpx.AsyncClient(transport=transport) as http:
        assert await download_image(http, "https://api.dataforseo.com/shot.png") == b"\x89PNG"


@pytest.mark.asyncio
async def test_a_download_that_is_not_an_image_or_too_large_is_refused() -> None:
    page = httpx.MockTransport(lambda r: httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"}))
    async with httpx.AsyncClient(transport=page) as http:
        with pytest.raises(ValueError, match="image"):
            await download_image(http, "https://api.dataforseo.com/shot.png")
    big = httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * (9 * 1024 * 1024), headers={"content-type": "image/png"}))
    async with httpx.AsyncClient(transport=big) as http:
        with pytest.raises(ValueError, match="large"):
            await download_image(http, "https://api.dataforseo.com/shot.png")
```

If `dataforseo_client_factory` does not exist, look at how `backend/tests/providers/dataforseo/test_client.py` builds a `DataForSeoClient` with a mock transport and add the fixture to `backend/tests/screenshots/conftest.py` the same way.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/screenshots/test_adapters.py -q`
Expected: FAIL (`idraft.screenshots.adapters` missing).

- [ ] **Step 3: Implement**

```python
# backend/src/idraft/screenshots/adapters.py
"""The real parts behind `service.capture_screenshot`: DataForSEO's screenshot call and the
download of the image it points to."""

from __future__ import annotations

from decimal import Decimal
from typing import Final

import httpx

from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.screenshot import (
    FAMILY,
    PATH,
    read_screenshot,
    screenshot_body,
)

# A tall capture of a long answer is well under this; it bounds what a bad link can cost us.
IMAGE_MAX: Final = 8 * 1024 * 1024


class DataForSeoScreenshots:
    def __init__(self, client: DataForSeoClient) -> None:
        self._client = client

    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        answered = await self._client.call("POST", PATH, family=FAMILY, body=screenshot_body(task_id))
        link = read_screenshot(answered.content)
        return link.url, link.cost_usd


async def download_image(http: httpx.AsyncClient, url: str) -> bytes:
    """The PNG at `url` (it needs no login). Refuses anything that is not an image or is large."""
    response = await http.get(url, follow_redirects=False)
    response.raise_for_status()
    if not response.headers.get("content-type", "").startswith("image/"):
        raise ValueError("the link did not return an image")
    if len(response.content) > IMAGE_MAX:
        raise ValueError(f"the image is too large ({len(response.content)} bytes)")
    return response.content
```

The `Ledger` implementation (insert the row and the cost event in one transaction, and `existing_key`) is added in Task 7 next to the route, because it needs the request's database session.

- [ ] **Step 4: Run, lint, types, commit**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/screenshots -q && uv run ruff check src/idraft/screenshots tests/screenshots && uv run mypy src/idraft/screenshots tests/screenshots`
Expected: all pass, clean.

```bash
git add backend/src/idraft/screenshots/adapters.py backend/tests/screenshots
git commit -m "feat: DataForSEO screenshot call and image download"
```

---

### Task 7: The two routes

**Files:**
- Create: `backend/src/idraft/api/ai/screenshot_routes.py`
- Modify: `backend/src/idraft/api/main.py` (include the router next to `observation_routes`)
- Test: `backend/tests/api/ai/test_screenshot_routes.py`

Follow `backend/src/idraft/api/ai/observation_routes.py` exactly for the dependency style: `ReadData`, `ReadRaw`, the `Observations` service provider (`get_observation_service`, line 33), the `Hint` (`observed_at`) query parameter, and how the router is mounted under `/{observation_id}` in `main.py`. Add a permission alias beside them:

```python
RunTrigger = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]
```

- [ ] **Step 1: Write the failing tests** (copy the app and database fixtures from `backend/tests/api/ai/test_observation_routes.py`; replace the provider, downloader and store with the fakes of Task 5 through the app's dependency overrides)

```python
# backend/tests/api/ai/test_screenshot_routes.py
"""POST captures an answer's screenshot once; GET serves it to people who can read the project."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_capture_stores_one_screenshot_and_get_serves_it(client, project_with_observation, fake_capture) -> None:  # type: ignore[no-untyped-def]
    path = f"/api/v1/workspaces/{project_with_observation.workspace_id}/projects/{project_with_observation.project_id}/ai/observations/{project_with_observation.observation_id}/screenshot"
    created = await client.post(path, headers=project_with_observation.writer_headers)
    assert created.status_code == 201
    assert created.json()["data"]["created"] is True
    again = await client.post(path, headers=project_with_observation.writer_headers)
    assert again.status_code == 200
    assert again.json()["data"]["created"] is False
    assert fake_capture.provider_calls == 1
    image = await client.get(path, headers=project_with_observation.reader_headers)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["cache-control"] == "private, max-age=3600"
    assert image.content.startswith(b"\x89PNG")


async def test_a_reader_cannot_spend(client, project_with_observation, fake_capture) -> None:  # type: ignore[no-untyped-def]
    path = f"/api/v1/workspaces/{project_with_observation.workspace_id}/projects/{project_with_observation.project_id}/ai/observations/{project_with_observation.observation_id}/screenshot"
    response = await client.post(path, headers=project_with_observation.reader_headers)
    assert response.status_code == 403
    assert fake_capture.provider_calls == 0


async def test_an_old_answer_answers_410(client, project_with_old_observation, fake_capture) -> None:  # type: ignore[no-untyped-def]
    path = f"/api/v1/workspaces/{project_with_old_observation.workspace_id}/projects/{project_with_old_observation.project_id}/ai/observations/{project_with_old_observation.observation_id}/screenshot"
    response = await client.post(path, headers=project_with_old_observation.writer_headers)
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "screenshot_expired"


async def test_get_without_a_stored_screenshot_is_404(client, project_with_observation) -> None:  # type: ignore[no-untyped-def]
    path = f"/api/v1/workspaces/{project_with_observation.workspace_id}/projects/{project_with_observation.project_id}/ai/observations/{project_with_observation.observation_id}/screenshot"
    response = await client.get(path, headers=project_with_observation.reader_headers)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "no_screenshot"
```

The fixtures `project_with_observation`, `project_with_old_observation` and `fake_capture` do not exist yet. Add them to `backend/tests/api/ai/conftest.py`: build the project, user headers for a writer (a role with `runs:trigger`) and a reader, and one `ai.observations` row with a `provider_task_id` and `engine_code='chatgpt_web'` (the `old` one with `observed_at` eight days ago), copying the row-building helper used in `test_observation_routes.py`. `fake_capture` overrides the provider, downloader and store dependencies with the Task 5 fakes and counts provider calls.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/api/ai/test_screenshot_routes.py -q`
Expected: FAIL (404 on the path, no route).

- [ ] **Step 3: Implement the routes**

```python
# backend/src/idraft/api/ai/screenshot_routes.py
"""The screenshot of an AI answer: the page the engine showed.

POST captures it (one provider call, $0.004, once: a second POST returns the stored one) and
needs `runs:trigger`, because it spends. GET serves the stored image to anyone who can read the
project's data. The answer's own details stay under `observation_routes.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from idraft.api.permissions import Permission
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.screenshots.service import (
    ExpiredError,
    ObservationRef,
    UnsupportedEngineError,
    capture_screenshot,
)
from idraft.storage.screenshots import get_screenshot

router = APIRouter()

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
RunTrigger = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]


class ScreenshotData(BaseModel):
    created: bool
    truncated: bool
    width: int | None
    height: int | None
    url: str


class ScreenshotResponse(BaseModel):
    data: ScreenshotData
```

Then, in the same file, add the two handlers. Read `observation_routes.py` lines 26-60 first and use its exact `Observations`, `ObservationId`, `Hint` aliases, its problem-raising helper (`idraft.api.problems`) for the three errors, and its way of reaching the project's store and database session through `Resources` (`api/resources.py`):

```python
SCREENSHOT_PATH = (
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/{observation_id}/screenshot"
)


@router.post(
    "/{observation_id}/screenshot",
    response_model=ScreenshotResponse,
    summary="Capture the screenshot of an AI answer",
    description="`runs:trigger`. One DataForSEO call ($0.004) the first time; later calls return "
    "the stored image and cost nothing. `410 screenshot_expired` once the answer is past the "
    "provider's 7 days, `409 screenshot_unsupported` for an engine with no platform page.",
    status_code=status.HTTP_201_CREATED,
)
async def capture(
    workspace_id: UUID, project_id: UUID, observation_id: ObservationId, access: RunTrigger,
    service: ScreenshotService, response: Response, observed_at: Hint = None,
) -> ScreenshotResponse:
    ref: ObservationRef = await service.reference(access, project_id, observation_id, observed_at)
    try:
        outcome = await capture_screenshot(
            ref, provider=service.provider, download=service.download, store=service.store,
            ledger=service.ledger(access, project_id), now=datetime.now(UTC), captured_by=access.user_id,
        )
    except ExpiredError:
        raise problem(status.HTTP_410_GONE, "screenshot_expired", "The answer is older than the provider's 7 days.") from None
    except UnsupportedEngineError:
        raise problem(status.HTTP_409_CONFLICT, "screenshot_unsupported", "This engine has no platform page to photograph.") from None
    if not outcome.created:
        response.status_code = status.HTTP_200_OK
    return ScreenshotResponse(
        data=ScreenshotData(
            created=outcome.created, truncated=outcome.truncated, width=outcome.width, height=outcome.height,
            url=SCREENSHOT_PATH.format(workspace_id=workspace_id, project_id=project_id, observation_id=observation_id),
        )
    )


@router.get(
    "/{observation_id}/screenshot",
    summary="The stored screenshot of an AI answer",
    description="`data:read`. The PNG, or `404 no_screenshot` when none was captured.",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def screenshot(
    project_id: UUID, observation_id: ObservationId, access: ReadData, service: ScreenshotService,
    observed_at: Hint = None,
) -> Response:
    key = await service.stored_key(access, project_id, observation_id, observed_at)
    if key is None:
        raise problem(status.HTTP_404_NOT_FOUND, "no_screenshot", "No screenshot was captured for this answer.")
    body = await get_screenshot(service.store, key)
    return Response(
        content=body,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
                 "Content-Security-Policy": "sandbox"},
    )
```

`ScreenshotService` is a small class in the same file, built like `get_observation_service` (line 33 of `observation_routes.py`) from `Resources`: `reference(...)` loads the observation row (`id`, `observed_at`, `workspace_id`, `project_id`, `engine_code`, `provider_task_id`) under the caller's row-level-security session and raises the same 404 the observation routes raise for an unknown id; `stored_key(...)` reads `ai.observation_screenshots.storage_key`; `provider` is `DataForSeoScreenshots(resources.dataforseo_client)`; `download` binds `download_image(http, url)`; `store` is `resources.raw_store`; `ledger(access, project_id)` returns an object implementing the `Ledger` protocol of Task 5 that inserts into `ai_observation_screenshots` and `provider_cost_events` in one session transaction. Name the real attributes by reading `api/resources.py` (the plan author did not read their names).

- [ ] **Step 4: Mount the router** in `backend/src/idraft/api/main.py` next to where `observation_routes.router` is included, with the same prefix (`/ai/observations`).

- [ ] **Step 5: Regenerate the OpenAPI document**

Run: `cd backend && uv run python -m idraft.cli openapi > openapi/v1.json` (use the command `check.sh` uses; read `backend/check.sh` for the exact one).
Expected: `git diff backend/openapi/v1.json` shows only the two new operations.

- [ ] **Step 6: Run the tests, lint, types, commit**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/api/ai/test_screenshot_routes.py -q && uv run ruff check src/idraft/api tests/api && uv run mypy src/idraft/api/ai/screenshot_routes.py`
Expected: 4 passed, clean.

```bash
git add backend/src/idraft/api backend/tests/api backend/openapi/v1.json
git commit -m "feat: routes to capture and serve AI answer screenshots"
```

---

### Task 8: `latest` in the prompts summary

**Files:**
- Modify: `backend/src/idraft/api/schemas/ai.py` (`EngineSummary`, near `PromptSummaryRow` at line 893)
- Modify: `backend/src/idraft/api/ai/summary_repository.py`
- Test: `backend/tests/api/ai/test_summary_latest.py`

The web already reads `latest` (`apps/web/src/lib/api/prompt-facts.ts`, `LatestAnswer`) through `include=facts`. Read `summary_repository.py` and find where `EngineSummary` rows for a prompt are built, and where `include=facts` is handled (search for `include`). Add `latest` there.

- [ ] **Step 1: Write the failing test** (same fixtures as Task 7)

```python
# backend/tests/api/ai/test_summary_latest.py
"""`latest` on an engine of a prompt row: the newest valid answer and its screenshot state."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_latest_names_the_answer_and_says_a_screenshot_can_be_captured(client, project_with_observation) -> None:  # type: ignore[no-untyped-def]
    p = project_with_observation
    body = (await client.get(f"/api/v1/workspaces/{p.workspace_id}/projects/{p.project_id}/ai/prompts-summary?include=facts", headers=p.reader_headers)).json()
    engine = body["data"]["prompts"][0]["engines"][0]
    assert engine["latest"]["observation_id"] == str(p.observation_id)
    assert engine["latest"]["screenshot_url"] is None
    assert engine["latest"]["screenshot_state"] == "capturable"


async def test_after_a_capture_latest_carries_the_image_path(client, project_with_observation, fake_capture) -> None:  # type: ignore[no-untyped-def]
    p = project_with_observation
    base = f"/api/v1/workspaces/{p.workspace_id}/projects/{p.project_id}/ai"
    await client.post(f"{base}/observations/{p.observation_id}/screenshot", headers=p.writer_headers)
    engine = (await client.get(f"{base}/prompts-summary?include=facts", headers=p.reader_headers)).json()["data"]["prompts"][0]["engines"][0]
    assert engine["latest"]["screenshot_url"] == f"{base}/observations/{p.observation_id}/screenshot"
    assert engine["latest"]["screenshot_state"] == "available"


async def test_an_old_answer_without_a_screenshot_is_expired(client, project_with_old_observation) -> None:  # type: ignore[no-untyped-def]
    p = project_with_old_observation
    base = f"/api/v1/workspaces/{p.workspace_id}/projects/{p.project_id}/ai"
    engine = (await client.get(f"{base}/prompts-summary?include=facts", headers=p.reader_headers)).json()["data"]["prompts"][0]["engines"][0]
    assert engine["latest"]["screenshot_state"] == "expired"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/api/ai/test_summary_latest.py -q`
Expected: FAIL (`KeyError: 'latest'`).

- [ ] **Step 3: Add the schema**

In `api/schemas/ai.py`, before `EngineSummary`:

```python
ScreenshotState = Literal["available", "capturable", "expired", "unsupported"]


class LatestAnswer(BaseModel):
    """The newest valid answer of the engine for the row."""

    observation_id: str
    observed_at: datetime
    screenshot_url: str | None = Field(
        description="The API path of the stored image, null when none was captured."
    )
    screenshot_state: ScreenshotState = Field(
        description="`available`: a stored image. `capturable`: none yet and the provider can still "
        "make one (within 7 days). `expired`: none and too late. `unsupported`: the engine has no "
        "platform page."
    )
```

and add to `EngineSummary` the optional field `latest: LatestAnswer | None = None`. Make sure `Literal` is imported in that module.

- [ ] **Step 4: Fill it in `summary_repository.py`**

Where the repository builds each engine entry for `include=facts`, add one query per page of rows (not per row): for the page's `(prompt_id, engine_code)` pairs, select the newest valid observation (`ai.observation_facts.is_valid`, then `ai.observations.id`, `observed_at`, `engine_code`), left join `ai.observation_screenshots` on `(observation_id, observed_at)`, and build `LatestAnswer`:

```python
SCREENSHOT_WINDOW = timedelta(days=7)
PAGE_ENGINES = frozenset({"chatgpt_web", "gemini_web", "google_ai_mode"})


def screenshot_state(engine_code: str, observed_at: datetime, stored: bool, now: datetime) -> str:
    if stored:
        return "available"
    if engine_code not in PAGE_ENGINES:
        return "unsupported"
    return "capturable" if now - observed_at <= SCREENSHOT_WINDOW else "expired"
```

Import `PAGE_ENGINES` from `idraft.screenshots.service` instead of redefining it, and put `screenshot_state` in `idraft/screenshots/service.py` so the two routes and the summary share one rule. The URL is built as in Task 7.

- [ ] **Step 5: Run, regenerate OpenAPI, lint, types, commit**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/api/ai/test_summary_latest.py tests/api/ai -q && uv run ruff check src/idraft tests/api && uv run mypy src/idraft/api src/idraft/screenshots`
Expected: pass, clean. Regenerate `openapi/v1.json` as in Task 7.

```bash
git add backend/src/idraft backend/tests backend/openapi/v1.json
git commit -m "feat: latest answer and screenshot state in the prompts summary"
```

---

### Task 9: Full backend check

- [ ] **Step 1:** Start Docker if needed (`colima status || colima start --cpu 10 --memory 16`, then the two `export` lines in `AGENTS.md`).
- [ ] **Step 2:** Run `cd backend && ./check.sh` (ruff, format, mypy, import contracts, pytest on 4 workers). Per the machine-load rule, run it once, in the main flow, not in parallel with anything else.
Expected: all green. If `tests/worker/test_import_acceptance.py::test_five_thousand_keywords` or two tests in `tests/db/test_migrations.py` fail under load, rerun that file alone (known flaky, `memory/focus-ai-prompt-tracking.md`).
- [ ] **Step 3:** The import contracts (`pyproject.toml`, `[[tool.importlinter.contracts]]`) forbid some layers from importing `httpx`. `idraft/screenshots/adapters.py` imports it; if a contract fails, move `adapters.py` under `idraft/providers/dataforseo/` and update the imports of Tasks 6 and 7.
- [ ] **Step 4:** Commit any fixes: `git commit -am "fix: backend checks for AI answer screenshots"`.

---

### Task 10: Web: type, mock handlers and the image address

**Files:**
- Modify: `apps/web/src/lib/api/prompt-facts.ts` (`LatestAnswer`)
- Modify: `apps/web/src/features/prompts/lists/answer-dialog.tsx` (`imageSource`)
- Modify: `apps/web/src/mocks/handlers/prompt-answers.ts`
- Test: `apps/web/src/features/prompts/lists/answer-dialog.test.tsx` (create if absent; there is `answer.test.tsx` for the viewer, not for this dialog)

After the backend ships, run `pnpm gen:api` in `apps/web` and commit `schema.ts` in its own commit (`AGENTS.md`).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/features/prompts/lists/answer-dialog.test.tsx
import { describe, expect, it } from 'vitest';

import { imageSource } from './answer-dialog';

describe('imageSource', () => {
  it('accepts the API path of a stored screenshot', () => {
    const path = '/api/v1/workspaces/w/projects/p/ai/observations/77/screenshot';
    expect(imageSource(path)).toBe(path);
  });

  it('still accepts an https address and an inline image', () => {
    expect(imageSource('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(imageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('refuses a script, another scheme and a path outside the API', () => {
    expect(imageSource('javascript:alert(1)')).toBeNull();
    expect(imageSource('file:///etc/passwd')).toBeNull();
    expect(imageSource('/other/path.png')).toBeNull();
    expect(imageSource('//evil.example.com/a.png')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run src/features/prompts/lists/answer-dialog.test.tsx`
Expected: FAIL on the API path case.

- [ ] **Step 3: Implement**

In `answer-dialog.tsx`, replace `imageSource` with:

```tsx
/**
 * The address of a stored screenshot when it is one an image may load: a web address, an inline image, or the API's own
 * path of a stored screenshot (same origin, so the session cookie goes with it). Never a script or another scheme.
 */
export function imageSource(raw: string): string | null {
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(raw)) return raw;
  if (/^\/api\/v1\/[A-Za-z0-9\-_/]+\/screenshot$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}
```

In `prompt-facts.ts`, extend the type:

```ts
export type ScreenshotState = 'available' | 'capturable' | 'expired' | 'unsupported';

/** The newest answer of the engine for the row. `screenshot_url` is null when no screenshot was captured. */
export interface LatestAnswer {
  observation_id: string;
  observed_at: string;
  screenshot_url: string | null;
  /** Absent in older mocks: treated as `available` when the address is set, else `capturable`. */
  screenshot_state?: ScreenshotState;
}
```

- [ ] **Step 4: Run, lint, typecheck, commit**

Run: `cd apps/web && pnpm vitest run src/features/prompts/lists/answer-dialog.test.tsx && pnpm lint && pnpm typecheck`
Expected: pass, clean.

```bash
git add apps/web/src
git commit -m "feat(web): screenshot address and state types"
```

---

### Task 11: Web: the cell and the dialog

**Files:**
- Modify: `apps/web/src/features/prompts/lists/screenshot-cell.tsx`
- Modify: `apps/web/src/features/prompts/lists/answer-dialog.tsx`
- Modify: `apps/web/messages/en.json` (strings under `prompts.lists.shot`; words in `docs/glossary/terms.md` first, `AGENTS.md`)
- Test: `apps/web/src/features/prompts/lists/screenshot-cell.test.tsx`

Read `apps/web/src/features/prompts/seams/columns.ts` and the existing test of the cell (search `screenshot-cell` in tests) first. The cell today renders only for a row whose `latest.screenshot_url` is set; it must now render for the four states.

- [ ] **Step 1: Write the failing tests** (use the render helpers and MSW setup the neighbouring tests use)

```tsx
// apps/web/src/features/prompts/lists/screenshot-cell.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ScreenshotCell } from './screenshot-cell';
import { renderWithApp, server } from '@/test/render';

const base = { observation_id: '77', observed_at: '2026-11-23T10:00:00Z' };
const platform = { code: 'chatgpt_web', name: 'ChatGPT' };
const props = { platform, promptText: 'Best SOC providers in India', timeZone: 'Asia/Kolkata', workspaceId: 'w', projectId: 'p' };

describe('ScreenshotCell', () => {
  it('opens the stored screenshot when one is available', async () => {
    renderWithApp(<ScreenshotCell {...props} latest={{ ...base, screenshot_url: '/api/v1/workspaces/w/projects/p/ai/observations/77/screenshot', screenshot_state: 'available' }} />);
    await userEvent.click(screen.getByRole('button', { name: /ChatGPT/ }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', expect.stringContaining('/observations/77/screenshot'));
  });

  it('captures on a press, then shows the image', async () => {
    let captured = false;
    server.use(
      http.post('/api/v1/workspaces/w/projects/p/ai/observations/77/screenshot', () => {
        captured = true;
        return HttpResponse.json({ data: { created: true, truncated: false, width: 1920, height: 4700, url: '/api/v1/workspaces/w/projects/p/ai/observations/77/screenshot' } }, { status: 201 });
      }),
    );
    renderWithApp(<ScreenshotCell {...props} latest={{ ...base, screenshot_url: null, screenshot_state: 'capturable' }} />);
    await userEvent.click(screen.getByRole('button', { name: /capture/i }));
    await waitFor(() => expect(captured).toBe(true));
    expect(await screen.findByRole('img')).toBeInTheDocument();
  });

  it('says Expired for an answer past the provider window, with no button to press', () => {
    renderWithApp(<ScreenshotCell {...props} latest={{ ...base, screenshot_url: null, screenshot_state: 'expired' }} />);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /capture/i })).toBeNull();
  });

  it('shows nothing to press for an engine without a platform page', () => {
    renderWithApp(<ScreenshotCell {...props} latest={{ ...base, screenshot_url: null, screenshot_state: 'unsupported' }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

If `@/test/render` or `server` are named differently, use the names in `apps/web/src/features/prompts/prompts.test.tsx` (read its imports).

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run src/features/prompts/lists/screenshot-cell.test.tsx`
Expected: FAIL (the cell requires a set `screenshot_url`, has no Capture state, takes no `workspaceId`).

- [ ] **Step 3: Implement the cell**

Replace `ScreenshotCell` in `screenshot-cell.tsx` so that `latest` is `LatestAnswer` (not `& { screenshot_url: string }`), the props gain `workspaceId` and `projectId`, and:

```tsx
export function ScreenshotCell({ latest, platform, promptText, timeZone, workspaceId, projectId }: ScreenshotCellProps): ReactElement | null {
  const t = useTranslations('prompts.lists.shot');
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(latest.screenshot_url);
  const [truncated, setTruncated] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const state = latest.screenshot_state ?? (latest.screenshot_url === null ? 'capturable' : 'available');

  if (state === 'unsupported') return null;
  if (url === null && state === 'expired') {
    return <span className="type-caption text-foreground-subtle">{t('expired')}</span>;
  }
  const capture = async (): Promise<void> => {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/ai/observations/${latest.observation_id}/screenshot`,
        { method: 'POST', credentials: 'same-origin', headers: csrfHeaders() },
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { data: { url: string; truncated: boolean } };
      setUrl(body.data.url);
      setTruncated(body.data.truncated);
      setOpen(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  // ... render: with a url, the existing outlined button with the day opens the dialog; without one, a
  // `Capture` button (label t('capture', { price: '$0.004' })) that calls `capture`, disabled while `pending`,
  // and a role="alert" line t('captureFailed') when `failed`. Pass `screenshotUrl={url}` and `truncated` to AnswerDialog.
}
```

Write the render branches out in full when implementing, reusing the existing `Button`, `CELL_CONTROL` and `AnswerDialog` usage from the file. `csrfHeaders()` is the helper the other mutating calls use (search `x-csrf` in `apps/web/src/lib/api`); use the app's typed API client for the POST if one exists for observations instead of `fetch`.

- [ ] **Step 4: Dialog: scroll, truncation note, citations**

In `AnswerDialog` add the props `truncated?: boolean` and `citations?: { url: string; domain: string; title: string | null }[]`; render the `<img>` inside a `max-h-[70vh] overflow-y-auto` container (the image is tall), a `t('truncated')` caption when `truncated`, and under it a `t('citations')` list of the observation's cited links (title or domain, as external links with `rel="noopener noreferrer"`). The cell fetches the citations through the existing observation read (`inspector-reads.ts` already reads observations: reuse its query function for `GET .../ai/observations/{id}` and map `data.citations`).

Strings (add the words to `docs/glossary/terms.md` before `messages/en.json`): `capture` "Capture ({price})", `captureFailed` "The screenshot could not be captured. Try again.", `expired` "Expired", `truncated` "This answer is longer than the capture, so the end is missing.", `citations` "Cited sources".

- [ ] **Step 5: Run the web checks**

Run: `cd apps/web && pnpm vitest run src/features/prompts && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: pass. Do not run the full suite, or `pnpm build`, until the last task.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/glossary
git commit -m "feat(web): capture, expired and image states in the Screenshot cell"
```

---

### Task 12: Wire the column to the real data and verify in the browser

**Files:**
- Modify: `apps/web/src/features/prompts/prompt-columns.tsx` and `seams/columns.ts` (the Screenshot column already has an id, `screenshot`, in `prompt-model.ts`)
- Test: extend `apps/web/src/features/prompts/seams/columns.test.ts`

- [ ] **Step 1:** Read how the Screenshot column renders today (`prompt-columns.tsx`, search `screenshot`; `seams/columns.ts`). It shows a button only when `latest.screenshot_url` is a string. Change the cell builder to render `ScreenshotCell` for every engine of the row that has a `latest`, passing `workspaceId` and `projectId` (the column context already carries them: "The workspace and project, for the cells that write or read on their own", `prompt-columns.tsx` line 127).
- [ ] **Step 2:** Add a test in `columns.test.ts` that a row whose engine has `latest` with `screenshot_state: 'capturable'` produces a Capture control, and a row with no `latest` produces none.
- [ ] **Step 3:** Run `cd apps/web && pnpm vitest run src/features/prompts && pnpm lint && pnpm typecheck`.
Expected: pass.
- [ ] **Step 4: Verify in the browser** (`preview_start` with the web dev server named in `.claude/launch.json`; on this machine use the port the memory notes say is free, never kill a running server). With the backend running against the dev database that has the Eventus seed (`memory/focus-ai-prompt-tracking.md`: it has no answers yet; the first real run per `docs/ops/ai-first-run.md` creates some), open `/ai/prompts`, choose an answer collected today, press Capture, and check: the image loads, scrolls inside the dialog, ends at the answer (no wide blank area), the citation list shows beside it, a second press does not call the provider (cost event count unchanged), and an answer older than 7 days shows Expired.
- [ ] **Step 5:** Final checks, once: `cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Then commit.

```bash
git add apps/web
git commit -m "feat(web): Screenshot column shows capture, expired and image states"
```

---

### Task 13: Docs and handover

**Files:**
- Modify: `docs/ai-visibility/backend-requests-prompts-page.md` (the `latest` row and "Screenshot spike")
- Create: `docs/ops/ai-answer-screenshots.md`

- [ ] **Step 1:** In `backend-requests-prompts-page.md`, replace the "Screenshot spike" section with the decision: DataForSEO `POST /v3/serp/screenshot`, $0.004, on demand, 7-day window, height 9,999 trimmed; and change the `latest` row to note `screenshot_url` is the API path and `screenshot_state` exists.
- [ ] **Step 2:** Write `docs/ops/ai-answer-screenshots.md`: what it costs (the table in "Decisions" 1), the 7-day window, where images live (`screenshots/v1/...` in `seo-raw`, no lifecycle rule, kept), how to check a spend (`ops.provider_cost_events` where `endpoint = '/v3/serp/screenshot'`), what a `truncated` row means, and the follow-up list below.
- [ ] **Step 3:** Commit: `git add docs && git commit -m "docs: AI answer screenshots decision and runbook"`.

---

## Out of scope (separate plans)

1. **Automatic capture** of the latest answer per prompt and engine: needs a per-engine switch on `ai.project_engines` and a budget check before each $0.004. At the base plan capturing every answer is about $15.59 a month; ChatGPT only about $5.20.
2. **cloro as a source of page images.** cloro returns a 24-hour HTML link only; rendering it ourselves needs a headless browser. Only worth it if cloro is added as an AI provider.
3. **The full Sources panel.** The screenshot cannot show it. The structured citations already cover it.
4. **Screenshots for answers older than 7 days.** DataForSEO cannot make them. Automatic capture (item 1) is the only fix.

## Self-review

**Spec coverage.** Screenshot column in the Prompts page: Tasks 10 to 12. Real platform interface: Tasks 2, 5, 6. Whole answer, not only the first screen: Task 1 and Decision 3 (9,999 px then trim, truncation flag). Citations: Decision 8 and Task 11 step 4. Cost: Decisions 1 and 7, Task 5 (cost event), Task 13 (runbook). Privacy: Decision 5, Task 7 (`DATA_READ` for the image, `RUNS_TRIGGER` to spend). Gaps: the exact names of `Resources` attributes, the `ScreenshotService` fixtures, the `cost_source` value and the engine codes are to be read from the code at implementation time; each step that depends on one says what to read.

**Placeholder scan.** Tasks 3, 6, 7, 8 and 11 name fixtures or helpers that must be located in existing test or source files before use; each says which file to read and what to do if the name differs. No step says "later" or "appropriate".

**Type consistency.** `ObservationRef`, `CaptureOutcome`, `ExpiredError`, `UnsupportedEngineError`, `capture_screenshot` (Task 5) are the names Tasks 6 to 8 use. `ScreenshotState` and `screenshot_state` match in `api/schemas/ai.py` (Task 8), `prompt-facts.ts` and the cell (Tasks 10, 11). `PAGE_ENGINES` is defined once in `screenshots/service.py` and imported by the summary.
