"""Reading fetched AI answers into observations and their facts (spec sections 4.3 and 4.4).

One stored answer is one task is one `ai.observations` row, with its citations, the project's
entity mentions and the fact row under the project's current derivation, all written in one
transaction and once: the observation is unique per task, so ingesting a task twice writes
nothing the second time. An answer that cannot be read is stored as an `error` observation with
its code, so it counts in coverage and in no rate. Every read and write names the workspace,
because the worker bypasses row-level security.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

import structlog
from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ai_context import AiContext, AiContextCache
from idraft.collectors.ingest_waits import IngestReport, not_now
from idraft.collectors.ledger import FetchedTask
from idraft.collectors.raw_payloads import load_raw_payload
from idraft.collectors.seo_rank_ingest import (
    INGEST_GIVE_UP,
    INGEST_RETRY,
    NOT_READ,
    NOT_STORABLE,
    NOT_WRITTEN,
    repeats,
)
from idraft.collectors.seo_rank_rows import snapshot_time
from idraft.db import dictionaries
from idraft.db.tables import (
    ai_citations,
    ai_derivations,
    ai_engines,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observations,
    ai_prompt_versions,
    ai_prompts,
    collection_tasks,
)
from idraft.domain.workloads import TaskWorkload
from idraft.extraction.ai_facts import (
    EXTRACTOR_VERSION,
    AnswerFacts,
    SourceIn,
    extract_answer_facts,
)
from idraft.extraction.aliases import TooManyMatchesError
from idraft.extraction.urls import CANONICALIZER_VERSION
from idraft.providers.dataforseo.ai import ADAPTER_VERSION
from idraft.providers.dataforseo.ai_parse import (
    PARSER_VERSION,
    AiSchemaMismatchError,
    CitedSource,
    NormalizedAnswer,
    parse_ai_answer,
    unreadable,
)
from idraft.storage.raw import ObjectStore, RawStorageError

WORKLOAD: Final = TaskWorkload.AI_PROMPT
SUBJECT_TYPE: Final = "prompt_version"
# Fetched tasks one pass reads.
INGEST_LIMIT: Final = 2000
SCHEMA_MISMATCH: Final = "schema_mismatch"
# Slice 1 classifies neither recommendation nor sentiment: version 0 is "no classifier".
RECOMMENDATION_VERSION: Final = 0
SENTIMENT_VERSION: Final = 0
# What a smallint column holds.
_SMALLINT_MAX: Final = 32_767
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class _Subject:
    run_id: uuid.UUID
    engine_code: str
    replicate_index: int
    attempts: int
    prompt_id: uuid.UUID
    version_id: uuid.UUID
    text: str
    language_code: str
    observation_class: str


async def ingest(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = INGEST_LIMIT
) -> IngestReport:
    """Read fetched AI tasks into observations, one task at a time, each in its own transaction.
    Safe to run twice. An answer that cannot be read from storage or written now waits, so it
    holds up neither the other answers nor its run."""
    async with sessions() as db:
        now = await ledger.transaction_time(db)
        fetched = await ledger.fetched_tasks(db, workload=WORKLOAD, limit=limit, now=now)
    contexts = AiContextCache()
    ingested = failed = waiting = 0
    # The tasks come ordered by payload, so only the last body needs to be held.
    last_id: int | None = None
    last_body: bytes | None = None
    for task in fetched:
        if task.raw_payload_id != last_id:
            last_id = task.raw_payload_id
            try:
                last_body = await load_raw_payload(sessions, store, last_id)
            except RawStorageError as error:
                _log.warning("stored answer not read", payload=last_id, error=str(error))
                last_body = None
        if last_body is None:
            later, gave_up = await _wait(
                sessions, task, NOT_READ, "The stored answer could not be read."
            )
            waiting, failed = waiting + later, failed + gave_up
            continue
        try:
            async with sessions() as db, db.begin():
                now = await ledger.transaction_time(db)
                await _keep(db, task, last_body, contexts)
                ingested += await ledger.mark_ingested(db, task.ref, now=now)
        except Exception as error:
            if repeats(error):
                _log.exception("stored answer cannot be stored", task=task.ref.id)
                failed += await _fail(sessions, task, NOT_STORABLE, type(error).__name__)
                continue
            # Rolled back as a whole: nothing of this answer is kept, and the next answers are
            # still ingested.
            _log.exception("stored answer not ingested", task=task.ref.id)
            later, gave_up = await _wait(
                sessions, task, NOT_WRITTEN, "The answer could not be written."
            )
            waiting, failed = waiting + later, failed + gave_up
    return IngestReport(ingested=ingested, failed=failed, waiting=waiting)


async def _wait(
    sessions: async_sessionmaker[AsyncSession], task: FetchedTask, code: str, message: str
) -> tuple[int, int]:
    return await not_now(
        sessions, [task], code=code, message=message, retry=INGEST_RETRY, give_up=INGEST_GIVE_UP
    )


async def _fail(
    sessions: async_sessionmaker[AsyncSession], task: FetchedTask, code: str, message: str
) -> int:
    _log.error("stored answer not ingested for good", task=task.ref.id, code=code, error=message)
    async with sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        return int(await ledger.ingest_failed(db, task.ref, code=code, message=message, now=now))


async def _keep(db: AsyncSession, task: FetchedTask, body: bytes, contexts: AiContextCache) -> None:
    """One task's rows. A task whose prompt version is gone, or of a project that is gone,
    gets nothing."""
    subject = await _subject(db, task)
    if subject is None:
        return
    context = await contexts.get(db, task.workspace_id, task.project_id)
    if context is None:
        return
    try:
        answer = parse_ai_answer(subject.engine_code, body)
    except AiSchemaMismatchError as error:
        _log.warning("AI answer of another shape", task=task.ref.id, path=error.path)
        answer = unreadable(SCHEMA_MISMATCH)
    # The answer's own time when it is believable (inside the window the SERP ingest uses, so
    # inside the partitions), else the task's ready time: neither changes between reads, so a
    # second ingest meets `observations_one_per_task`. Never the wall clock.
    observed_at = snapshot_time(answer.observed_at, task.fetched_at)
    kept = [source for source in answer.sources if source.url is not None]
    facts = _facts(answer, kept, context, task)
    observation_id = await _insert_observation(db, task, subject, answer, observed_at, facts)
    if observation_id is None:
        return  # this task has its observation already
    await _insert_citations(db, task, subject, observation_id, observed_at, kept, facts)
    derivation_id = await current_derivation(
        db, task.workspace_id, task.project_id, context.entity_config_version
    )
    await _insert_mentions(db, task, subject, observation_id, observed_at, derivation_id, facts)
    await _insert_fact(db, task, subject, observation_id, observed_at, derivation_id, facts)


def _facts(
    answer: NormalizedAnswer, kept: Sequence[CitedSource], context: AiContext, task: FetchedTask
) -> AnswerFacts:
    sources = [
        SourceIn(
            url=source.url, raw_url=source.raw_url, kind=source.kind, occurrences=source.occurrences
        )
        for source in kept
        if source.url is not None
    ]
    try:
        return extract_answer_facts(
            answer.answer_text,
            sources,
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=answer.is_valid,
        )
    except TooManyMatchesError:
        # The same text matches as often on every try: its citations are kept and the answer
        # counts in no rate.
        _log.warning("AI answer matches too often", task=task.ref.id)
        return extract_answer_facts(
            None,
            sources,
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=False,
        )


async def _subject(db: AsyncSession, task: FetchedTask) -> _Subject | None:
    t = collection_tasks.c
    row = (
        await db.execute(
            select(t.run_id, t.engine_code, t.replicate_index, t.attempts, t.subject_type).where(
                t.id == task.ref.id,
                t.created_at == task.ref.created_at,
                t.workspace_id == task.workspace_id,
            )
        )
    ).one_or_none()
    if row is None or row.subject_type != SUBJECT_TYPE or row.engine_code is None:
        return None
    try:
        version_id = uuid.UUID(task.subject_id)
    except ValueError:
        return None
    v, p, g = ai_prompt_versions.c, ai_prompts.c, ai_engines.c
    found = (
        await db.execute(
            select(v.prompt_id, v.text, p.language_code)
            .select_from(ai_prompt_versions.join(ai_prompts, p.id == v.prompt_id))
            .where(
                v.id == version_id,
                v.workspace_id == task.workspace_id,
                p.workspace_id == task.workspace_id,
                p.project_id == task.project_id,
            )
        )
    ).one_or_none()
    observation_class: str | None = (
        await db.execute(select(g.observation_class).where(g.code == row.engine_code))
    ).scalar_one_or_none()
    if found is None or observation_class is None:
        return None
    return _Subject(
        run_id=row.run_id,
        engine_code=row.engine_code,
        replicate_index=row.replicate_index,
        attempts=row.attempts,
        prompt_id=found.prompt_id,
        version_id=version_id,
        text=found.text,
        language_code=found.language_code,
        observation_class=observation_class,
    )


async def _insert_observation(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
    answer: NormalizedAnswer,
    observed_at: datetime,
    facts: AnswerFacts,
) -> int | None:
    text = answer.answer_text
    values: dict[str, Any] = {
        "observed_at": observed_at,
        "observed_date": observed_at.astimezone(UTC).date(),
        "workspace_id": task.workspace_id,
        "project_id": task.project_id,
        "engine_code": subject.engine_code,
        "observation_class": subject.observation_class,
        "prompt_id": subject.prompt_id,
        "prompt_version_id": subject.version_id,
        "query_text": subject.text,
        "collection_run_id": subject.run_id,
        "collection_task_id": task.ref.id,
        "replicate_index": subject.replicate_index,
        "location_id": task.location_id,
        "language_code": answer.language_code or subject.language_code,
        "device": answer.device,
        "provider_code": task.provider_code,
        "provider_endpoint": task.provider_endpoint,
        "provider_task_id": task.provider_task_id,
        "model_reported": answer.model_reported,
        "status": answer.status,
        "answer_text": text,
        "answer_markdown": text,
        "answer_char_count": None if text is None else len(text),
        "answer_hash": None if text is None else hashlib.sha256(text.encode()).digest(),
        "has_citations": bool(facts.citations),
        "citation_count": min(len(facts.citations), _SMALLINT_MAX),
        "fanout_count": min(answer.fan_out_count, _SMALLINT_MAX),
        "raw_payload_id": task.raw_payload_id,
        "adapter_version": ADAPTER_VERSION,
        "normalizer_version": PARSER_VERSION,
        "canonicalizer_version": CANONICALIZER_VERSION,
        "cost_usd": task.cost_usd,
        "retry_count": max(0, subject.attempts - 1),
        "error_code": answer.error_code,
        "provider_extras": None if answer.provider_extras is None else dict(answer.provider_extras),
    }
    inserted = await db.execute(
        upsert(ai_observations)
        .values(values)
        .on_conflict_do_nothing(index_elements=["collection_task_id", "observed_at"])
        .returning(ai_observations.c.id)
    )
    observation_id: int | None = inserted.scalar_one_or_none()
    return observation_id


async def _insert_citations(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
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
                "workspace_id": task.workspace_id,
                "project_id": task.project_id,
                "engine_code": subject.engine_code,
                "url_id": rows[citation.url.url_hash].id,
                "domain_id": rows[citation.url.url_hash].domain_id,
                "raw_url": citation.raw_url,
                "title": source.title,
                "source_name": source.source_name,
                "citation_kind": citation.kind,
                "first_char_offset": citation.first_char_offset,
                "answer_block_index": source.answer_block_index,
                "occurrences": min(citation.occurrences, _SMALLINT_MAX),
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


async def _insert_mentions(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
    facts: AnswerFacts,
) -> None:
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
                "workspace_id": task.workspace_id,
                "project_id": task.project_id,
                "engine_code": subject.engine_code,
                "role": mention.role,
                "mention_count": min(mention.mention_count, _SMALLINT_MAX),
                "first_char_offset": mention.first_char_offset,
                # Uncertain mentions, watch entities and products have no place in the order
                # (migration 0019); they are stored as evidence all the same.
                "mention_order": None
                if mention.mention_order is None
                else min(mention.mention_order, _SMALLINT_MAX),
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


async def _insert_fact(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
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
            workspace_id=task.workspace_id,
            project_id=task.project_id,
            observed_date=observed_at.astimezone(UTC).date(),
            engine_code=subject.engine_code,
            observation_class=subject.observation_class,
            prompt_id=subject.prompt_id,
            prompt_version_id=subject.version_id,
            tracked_keyword_id=None,
            replicate_index=subject.replicate_index,
            location_id=task.location_id,
            is_valid=fact.is_valid,
            own_mentioned=fact.own_mentioned,
            own_domain_cited=fact.own_domain_cited,
            own_recommended=None,
            own_structured_rank=None,
            own_prominence=None
            if fact.own_prominence is None
            else Decimal(str(fact.own_prominence)),
            own_mention_order=fact.own_mention_order,
            own_sentiment=None,
            own_citation_count=min(fact.own_citation_count, _SMALLINT_MAX),
            total_citation_count=min(fact.total_citation_count, _SMALLINT_MAX),
            tracked_entities_mentioned=min(fact.tracked_entities_mentioned, _SMALLINT_MAX),
            competitor_mentions=list(fact.competitor_mentions),
            competitor_cited=list(fact.competitor_cited),
            had_structured_list=fact.had_structured_list,
            is_current=True,
        )
    )
