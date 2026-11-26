"""The rows an answer leaves besides its observation: citations, entity mentions and the fact row
(spec sections 4.3 and 4.4). One answer of any engine, whether a prompt's or a rank check's
AI Overview, is written by these same functions, so its facts mean the same everywhere.

Every write names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final

import structlog
from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.ai_context import AiContext
from idraft.db import dictionaries
from idraft.db.tables import (
    ai_citations,
    ai_derivations,
    ai_entity_mentions,
    ai_observation_facts,
)
from idraft.extraction.ai_facts import (
    EXTRACTOR_VERSION,
    AnswerFacts,
    SourceIn,
    extract_answer_facts,
)
from idraft.extraction.aliases import TooManyMatchesError
from idraft.extraction.recommendation import RECOMMENDATION_VERSION
from idraft.extraction.sentiment import SENTIMENT_VERSION
from idraft.providers.dataforseo.ai_parse import CitedSource

# What a smallint column holds.
SMALLINT_MAX: Final = 32_767
_log = structlog.get_logger(__name__)


def answer_facts(
    text: str | None,
    kept: Sequence[CitedSource],
    context: AiContext,
    *,
    task_id: int,
    is_valid: bool,
) -> AnswerFacts:
    """The facts of one answer: `kept` are its sources that have an address, in order."""
    sources = [
        SourceIn(
            url=source.url, raw_url=source.raw_url, kind=source.kind, occurrences=source.occurrences
        )
        for source in kept
        if source.url is not None
    ]
    try:
        return extract_answer_facts(
            text,
            sources,
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=is_valid,
        )
    except TooManyMatchesError:
        # The same text matches as often on every try: its citations are kept and the answer
        # counts in no rate.
        _log.warning("AI answer matches too often", task=task_id)
        return extract_answer_facts(
            None,
            sources,
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=False,
        )


async def insert_citations(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    engine_code: str,
    observation_id: int,
    observed_at: datetime,
    kept: Sequence[CitedSource],
    facts: AnswerFacts,
) -> None:
    if not facts.citations:
        return
    rows = await dictionaries.urls_for(db, [citation.url for citation in facts.citations])
    await db.execute(
        insert(ai_citations),
        [
            {
                "observation_id": observation_id,
                "observed_at": observed_at,
                "citation_index": citation.index,
                "workspace_id": workspace_id,
                "project_id": project_id,
                "engine_code": engine_code,
                "url_id": rows[citation.url.url_hash].id,
                "domain_id": rows[citation.url.url_hash].domain_id,
                "raw_url": citation.raw_url,
                "title": source.title,
                "source_name": source.source_name,
                "quote": source.quote,
                "citation_kind": citation.kind,
                "first_char_offset": citation.first_char_offset,
                "answer_block_index": source.answer_block_index,
                "occurrences": min(citation.occurrences, SMALLINT_MAX),
                "domain_role": citation.domain_role,
                "role_entity_id": citation.role_entity_id,
                "referral_tag": citation.url.referral_tag,
                "flags": sorted(citation.url.flags),
            }
            for source, citation in zip(kept, facts.citations, strict=True)
        ],
    )


async def current_derivation(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID, entity_config_version: int
) -> int:
    """The project's derivation for this extractor and entity configuration, made on first use
    (doc 04 section 8.5; plan A's `derivations_identity`)."""
    key = {
        "project_id": project_id,
        "extractor_version": EXTRACTOR_VERSION,
        "entity_config_version": entity_config_version,
        "recommendation_version": RECOMMENDATION_VERSION,
        "sentiment_version": SENTIMENT_VERSION,
    }
    await db.execute(
        upsert(ai_derivations)
        .values(workspace_id=workspace_id, **key)
        .on_conflict_do_nothing(index_elements=list(key))
    )
    d = ai_derivations.c
    derivation_id: int = (
        await db.execute(
            select(d.id).where(
                d.workspace_id == workspace_id,
                d.project_id == project_id,
                d.extractor_version == EXTRACTOR_VERSION,
                d.entity_config_version == entity_config_version,
                d.recommendation_version == RECOMMENDATION_VERSION,
                d.sentiment_version == SENTIMENT_VERSION,
            )
        )
    ).scalar_one()
    return derivation_id


async def insert_mentions(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    engine_code: str,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
    facts: AnswerFacts,
) -> None:
    """The entity mentions of one answer under one derivation (also used to derive them again)."""
    if not facts.mentions:
        return
    await db.execute(
        insert(ai_entity_mentions),
        [
            {
                "observation_id": observation_id,
                "observed_at": observed_at,
                "entity_id": mention.entity_id,
                "derivation_id": derivation_id,
                "workspace_id": workspace_id,
                "project_id": project_id,
                "engine_code": engine_code,
                "role": mention.role,
                "mention_count": min(mention.mention_count, SMALLINT_MAX),
                "first_char_offset": mention.first_char_offset,
                # Uncertain mentions, watch entities and products have no place in the order
                # (migration 0019); they are stored as evidence all the same.
                "mention_order": None
                if mention.mention_order is None
                else min(mention.mention_order, SMALLINT_MAX),
                "prominence": Decimal(str(mention.prominence)),
                "match_method": mention.match_method,
                "mention_status": mention.status,
                "confidence": Decimal(str(mention.confidence)),
                "evidence_spans": [
                    Range(start, end, bounds="[)") for start, end in mention.evidence_spans
                ],
                "is_current": True,
            }
            for mention in facts.mentions
        ],
    )


async def insert_fact(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    engine_code: str,
    observation_class: str,
    prompt_id: uuid.UUID | None,
    prompt_version_id: uuid.UUID | None,
    tracked_keyword_id: uuid.UUID | None,
    replicate_index: int,
    location_id: int | None,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
    facts: AnswerFacts,
) -> None:
    fact = facts.fact
    await db.execute(
        insert(ai_observation_facts).values(
            observation_id=observation_id,
            observed_at=observed_at,
            derivation_id=derivation_id,
            workspace_id=workspace_id,
            project_id=project_id,
            observed_date=observed_at.astimezone(UTC).date(),
            engine_code=engine_code,
            observation_class=observation_class,
            prompt_id=prompt_id,
            prompt_version_id=prompt_version_id,
            tracked_keyword_id=tracked_keyword_id,
            replicate_index=replicate_index,
            location_id=location_id,
            is_valid=fact.is_valid,
            own_mentioned=fact.own_mentioned,
            own_domain_cited=fact.own_domain_cited,
            own_recommended=fact.own_recommended,
            own_structured_rank=None,
            own_prominence=None
            if fact.own_prominence is None
            else Decimal(str(fact.own_prominence)),
            own_mention_order=fact.own_mention_order,
            own_sentiment=fact.own_sentiment,
            own_citation_count=min(fact.own_citation_count, SMALLINT_MAX),
            total_citation_count=min(fact.total_citation_count, SMALLINT_MAX),
            tracked_entities_mentioned=min(fact.tracked_entities_mentioned, SMALLINT_MAX),
            competitor_mentions=list(fact.competitor_mentions),
            competitor_cited=list(fact.competitor_cited),
            had_structured_list=fact.had_structured_list,
            is_current=True,
        )
    )
