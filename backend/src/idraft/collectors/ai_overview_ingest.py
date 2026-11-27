"""A Google AI Overview seen by a rank check, kept as an AI observation (plan
docs/superpowers/plans/2026-11-25-ai-overview-engine.md, "Stage 2 build").

A check whose overview was shown and whose text loaded writes one `ai.observations` row of
engine `google_ai_overview` (class `serp_ai`, no prompt), with its citations, entity mentions and
fact row through the same functions the other platforms use. It costs nothing extra: the answer
is part of the rank check. The observation is unique per rank task, so writing it twice writes
nothing the second time. Only projects that turned the engine on get observations.

`backfill` does the same for snapshots stored before this existed, from their stored payloads:
no provider is called.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC
from typing import Any, Final

import structlog
from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.ai_answer_rows import (
    SMALLINT_MAX,
    answer_facts,
    current_derivation,
    insert_citations,
    insert_fact,
    insert_mentions,
)
from idraft.collectors.ai_context import AiContextCache
from idraft.collectors.raw_payloads import load_raw_payload
from idraft.db.tables import (
    ai_observations,
    ai_project_engines,
    keywords,
    serp_snapshots,
    tracked_keywords,
)
from idraft.extraction.urls import CANONICALIZER_VERSION
from idraft.providers.dataforseo.ai import ADAPTER_VERSION
from idraft.providers.dataforseo.ai_parse import CitedSource
from idraft.providers.dataforseo.serp import SERP_ORGANIC_LIVE
from idraft.providers.dataforseo.serp_parse import (
    PARSER_VERSION,
    AiOverview,
    SerpSchemaMismatchError,
    parse_serp,
)
from idraft.storage.raw import ObjectStore, RawStorageError

ENGINE: Final = "google_ai_overview"
OBSERVATION_CLASS: Final = "serp_ai"
# The overview states that carry an answer.
_SHOWN: Final = ("present", "present_async_loaded")
BATCH: Final = 200
_log = structlog.get_logger(__name__)


async def write_observation(
    db: AsyncSession,
    contexts: AiContextCache,
    *,
    snapshot: Mapping[str, Any],
    snapshot_id: int,
    overview: AiOverview,
) -> bool:
    """The observation of one stored snapshot's overview, in the caller's transaction. False when
    nothing was written: no answer, the engine is off for the project, the project or keyword is
    gone, or the task has its observation already."""
    text = overview.text
    if overview.state not in _SHOWN or text is None or snapshot["collection_task_id"] is None:
        return False
    workspace_id: uuid.UUID = snapshot["workspace_id"]
    project_id: uuid.UUID = snapshot["project_id"]
    enabled = await db.execute(
        select(ai_project_engines.c.project_id).where(
            ai_project_engines.c.workspace_id == workspace_id,
            ai_project_engines.c.project_id == project_id,
            ai_project_engines.c.engine_code == ENGINE,
            ai_project_engines.c.is_enabled,
        )
    )
    if enabled.first() is None:
        return False
    query_text: str | None = (
        await db.execute(
            select(keywords.c.text)
            .select_from(
                tracked_keywords.join(keywords, keywords.c.id == tracked_keywords.c.keyword_id)
            )
            .where(
                tracked_keywords.c.id == snapshot["tracked_keyword_id"],
                tracked_keywords.c.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    context = await contexts.get(db, workspace_id, project_id)
    if query_text is None or context is None:
        return False
    observed_at = snapshot["observed_at"]
    kept = [
        CitedSource(
            raw_url=citation.url.url,
            url=citation.url,
            title=citation.title,
            source_name=citation.source_name,
            kind=citation.kind,
            occurrences=1,
            answer_block_index=None,
        )
        for citation in overview.citations
    ]
    facts = answer_facts(text, kept, context, task_id=snapshot["collection_task_id"], is_valid=True)
    inserted = await db.execute(
        upsert(ai_observations)
        .values(
            observed_at=observed_at,
            observed_date=observed_at.astimezone(UTC).date(),
            workspace_id=workspace_id,
            project_id=project_id,
            engine_code=ENGINE,
            observation_class=OBSERVATION_CLASS,
            prompt_id=None,
            prompt_version_id=None,
            serp_snapshot_id=snapshot_id,
            serp_observed_at=observed_at,
            tracked_keyword_id=snapshot["tracked_keyword_id"],
            query_text=query_text,
            collection_task_id=snapshot["collection_task_id"],
            location_id=snapshot["location_id"],
            language_code=snapshot["language_code"],
            device=snapshot["device"],
            provider_code=snapshot["provider_code"],
            provider_endpoint=snapshot["provider_endpoint"],
            provider_task_id=snapshot["provider_task_id"],
            status="complete",
            answer_text=text,
            answer_markdown=text,
            answer_char_count=len(text),
            has_citations=bool(facts.citations),
            citation_count=min(len(facts.citations), SMALLINT_MAX),
            raw_payload_id=snapshot["raw_payload_id"],
            adapter_version=ADAPTER_VERSION,
            normalizer_version=PARSER_VERSION,
            canonicalizer_version=CANONICALIZER_VERSION,
            cost_usd=None,
        )
        .on_conflict_do_nothing(index_elements=["collection_task_id", "observed_at"])
        .returning(ai_observations.c.id)
    )
    observation_id: int | None = inserted.scalar_one_or_none()
    if observation_id is None:
        return False
    await insert_citations(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        engine_code=ENGINE,
        observation_id=observation_id,
        observed_at=observed_at,
        kept=kept,
        facts=facts,
    )
    derivation_id = await current_derivation(
        db, workspace_id, project_id, context.entity_config_version
    )
    await insert_mentions(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        engine_code=ENGINE,
        observation_id=observation_id,
        observed_at=observed_at,
        derivation_id=derivation_id,
        facts=facts,
    )
    await insert_fact(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        engine_code=ENGINE,
        observation_class=OBSERVATION_CLASS,
        prompt_id=None,
        prompt_version_id=None,
        tracked_keyword_id=snapshot["tracked_keyword_id"],
        replicate_index=1,
        location_id=snapshot["location_id"],
        observation_id=observation_id,
        observed_at=observed_at,
        derivation_id=derivation_id,
        facts=facts,
    )
    return True


@dataclass(slots=True)
class BackfillReport:
    candidates: int = 0
    written: int = 0
    # Snapshots whose stored payload could not be read or parsed, left as they were.
    skipped: int = 0


async def backfill(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, batch: int = BATCH
) -> BackfillReport:
    """Observations for the snapshots that show an overview and have none, from their stored
    payloads. Safe to run twice; calls no provider."""
    report = BackfillReport()
    contexts = AiContextCache()
    s = serp_snapshots.c
    last_id = 0
    while True:
        async with sessions() as db:
            rows = (
                await db.execute(
                    select(serp_snapshots)
                    .where(
                        s.id > last_id,
                        s.has_ai_overview,
                        s.ai_overview_state.in_(_SHOWN),
                        s.collection_task_id.is_not(None),
                        s.provider_endpoint != SERP_ORGANIC_LIVE,
                        ~exists().where(
                            ai_observations.c.serp_snapshot_id == s.id,
                            ai_observations.c.serp_observed_at == s.observed_at,
                            ai_observations.c.engine_code == ENGINE,
                        ),
                    )
                    .order_by(s.id)
                    .limit(batch)
                )
            ).all()
        if not rows:
            return report
        for row in rows:
            last_id = max(last_id, row.id)
            report.candidates += 1
            try:
                serp = parse_serp(await load_raw_payload(sessions, store, row.raw_payload_id))
            except (RawStorageError, SerpSchemaMismatchError) as error:
                _log.warning("overview not backfilled", snapshot=row.id, error=str(error))
                report.skipped += 1
                continue
            async with sessions() as db, db.begin():
                if await write_observation(
                    db,
                    contexts,
                    snapshot=dict(row._mapping),
                    snapshot_id=row.id,
                    overview=serp.ai_overview,
                ):
                    report.written += 1
