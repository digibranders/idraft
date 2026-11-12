"""What the summary tests of WP-12 share: the seeded world of `test_prompts_summary` (six
prompts, two engines, answers over several weeks; the docstring of its fixture lists each
answer), its readers, and the helpers that seed more answers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from tests.api.ai import test_prompts_summary
from tests.api.ai.test_prompts_summary import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    OWN_PAGE,
    REFUSAL,
    Answer,
    Summary,
)
from tests.api.ai.test_prompts_summary import _by as by
from tests.api.ai.test_prompts_summary import _cell as cell
from tests.api.ai.test_prompts_summary import _entity_cell as entity_cell
from tests.api.ai.test_prompts_summary import _full_project as full_project
from tests.api.ai.test_prompts_summary import _ingested as ingested
from tests.api.ai.test_prompts_summary import _mention_every_answer as mention_every_answer
from tests.api.ai.test_prompts_summary import _pooled as pooled
from tests.api.ai.test_prompts_summary import _statements as statements
from tests.api.ai.test_prompts_summary import _summary as get_summary
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import add_prompt, chatgpt_answer, enable_engine, fetched_ai_task
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

__all__ = [
    "CHATGPT",
    "GEMINI",
    "OWN_ONLY",
    "OWN_PAGE",
    "REFUSAL",
    "Answer",
    "Summary",
    "answer_in_another_project",
    "by",
    "cell",
    "day",
    "entity_cell",
    "full_project",
    "get_summary",
    "ingested",
    "mention_every_answer",
    "pooled",
    "prompt_row",
    "seeded",
    "statements",
    "summary_data",
    "topic_row",
]

# The seeded world, as a fixture of any test module that imports this one: `seeded = ...`.
seeded = test_prompts_summary.summary


def day(days_ago: int) -> str:
    """The UTC day `days_ago` days before today, as the `from` and `to` parameters write it."""
    return (datetime.now(UTC).date() - timedelta(days=days_ago)).isoformat()


def prompt_row(data: dict[str, Any], world: Summary, name: str) -> dict[str, Any]:
    row: dict[str, Any] = by(data["prompts"], "prompt_id")[str(world.prompts[name].id)]
    return row


def topic_row(data: dict[str, Any], name: str | None) -> dict[str, Any]:
    row: dict[str, Any] = by(data["topics"], "name")[name]
    return row


async def answer_in_another_project(
    migrated: PostgresServer,
    worker_db: Ledger,
    store: MemoryStore,
    workspace_id: uuid.UUID,
    brand: str,
    days: int,
) -> None:
    """A new project of the workspace, with its own brand, prompt and one answer `days` days old
    that names the brand and cites a page; fetched when it was given, not yet ingested. A brand
    name is the workspace's, so each call of a workspace needs its own."""
    other = Project(workspace_id, await make_project(migrated, workspace_id))
    await _entity(migrated, other, brand, f"{brand.lower()}.example", "own", primary=True)
    await enable_engine(migrated, other, CHATGPT)
    prompt = await add_prompt(migrated, other, "Best managed SOC providers in India?")
    when = datetime.now(UTC).replace(microsecond=0) - timedelta(days=days)
    await fetched_ai_task(
        worker_db,
        migrated,
        other,
        prompt,
        chatgpt_answer(
            f"{brand} runs a managed SOC service in Mumbai with 24x7 monitoring.",
            [OWN_PAGE],
            when=when,
        ),
        store,
        fetched_at=when,
    )


async def summary_data(world: Summary, api: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    """The `data` of a summary that answered 200."""
    response = await get_summary(world, api, **params)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data
