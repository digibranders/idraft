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
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ai_answer_rows import (
    SMALLINT_MAX,
    answer_facts,
    current_derivation,
    insert_citations,
    insert_fact,
    insert_mentions,
)
from idraft.collectors.ai_context import AiContextCache
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
from idraft.db.tables import (
    ai_engines,
    ai_observations,
    ai_prompt_versions,
    ai_prompts,
    collection_tasks,
)
from idraft.domain.workloads import TaskWorkload
from idraft.extraction.ai_facts import (
    AnswerFacts,
)
from idraft.extraction.urls import CANONICALIZER_VERSION
from idraft.providers.dataforseo.ai import ADAPTER_VERSION
from idraft.providers.dataforseo.ai_parse import (
    PARSER_VERSION,
    AiSchemaMismatchError,
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
    facts = answer_facts(
        answer.answer_text, kept, context, task_id=task.ref.id, is_valid=answer.is_valid
    )
    observation_id = await _insert_observation(db, task, subject, answer, observed_at, facts)
    if observation_id is None:
        return  # this task has its observation already
    await insert_citations(
        db,
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        engine_code=subject.engine_code,
        observation_id=observation_id,
        observed_at=observed_at,
        kept=kept,
        facts=facts,
    )
    derivation_id = await current_derivation(
        db, task.workspace_id, task.project_id, context.entity_config_version
    )
    await insert_mentions(
        db,
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        engine_code=subject.engine_code,
        observation_id=observation_id,
        observed_at=observed_at,
        derivation_id=derivation_id,
        facts=facts,
    )
    await insert_fact(
        db,
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        engine_code=subject.engine_code,
        observation_class=subject.observation_class,
        prompt_id=subject.prompt_id,
        prompt_version_id=subject.version_id,
        tracked_keyword_id=None,
        replicate_index=subject.replicate_index,
        location_id=task.location_id,
        observation_id=observation_id,
        observed_at=observed_at,
        derivation_id=derivation_id,
        facts=facts,
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
        "citation_count": min(len(facts.citations), SMALLINT_MAX),
        "fanout_count": min(answer.fan_out_count, SMALLINT_MAX),
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
