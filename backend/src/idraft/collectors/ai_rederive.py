"""Deriving the facts of stored AI answers again, for a project, with the current extractor.

An answer's text is kept in `ai.observations.answer_text`, so nothing is fetched and no provider is
called. Each current fact row whose derivation is not the one the extractor and the project's
entity configuration give today is replaced: its mentions and its fact row are made again from the
text under that derivation, and the old rows stay as history with `is_current` false. What comes
from the answer's citations (`own_domain_cited`, the citation counts, `competitor_cited`) is
carried over from the old fact row: the citations have no derivation, and this does not read them
again. Everything that comes from the text (mentions, order, prominence, recommendation,
sentiment) is made again under today's entity configuration, so `own_mentioned` can change when
aliases changed since the answer was ingested; `RederiveReport.mention_changes` counts those.

Safe to run twice: an answer that is current under the derivation is not a candidate, and rows
already written under the derivation for a candidate are replaced, not duplicated.
"""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Final

import structlog
from sqlalchemy import and_, delete, insert, literal, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.ai_context import AiContext, load_ai_context
from idraft.collectors.ai_prompt_ingest import current_derivation, insert_mentions
from idraft.db.tables import (
    ai_derivations,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observations,
    projects,
)
from idraft.extraction.ai_facts import EXTRACTOR_VERSION, AnswerFacts, extract_answer_facts
from idraft.extraction.aliases import TooManyMatchesError
from idraft.extraction.recommendation import RECOMMENDATION_VERSION
from idraft.extraction.sentiment import SENTIMENT_VERSION

BATCH: Final = 200
_SMALLINT_MAX: Final = 32_767
# The columns of the old fact row the new one starts from (`computed_at` is made by the database).
_CARRIED: Final = frozenset(ai_observation_facts.c.keys()) - {"computed_at"}
_log = structlog.get_logger(__name__)


class ProjectNotFoundError(LookupError):
    """The project is not there, or tracks nothing in AI answers."""


@dataclass(slots=True)
class RederiveReport:
    # Current facts under another derivation, and how many of them were made again (0 on a dry run).
    candidates: int = 0
    rederived: int = 0
    # Answers whose `own_mentioned` is not what it was.
    mention_changes: int = 0
    recommended: int = 0
    sentiment: Counter[str] = field(default_factory=Counter)


async def rederive_project(
    sessions: async_sessionmaker[AsyncSession], project_id: uuid.UUID, *, dry_run: bool
) -> RederiveReport:
    """Derive the facts of the project's stale answers again. With `dry_run` nothing is written
    and the report says what a real run would do."""
    async with sessions() as db:
        workspace_id: uuid.UUID | None = (
            await db.execute(select(projects.c.workspace_id).where(projects.c.id == project_id))
        ).scalar_one_or_none()
        if workspace_id is None:
            raise ProjectNotFoundError(str(project_id))
        context = await load_ai_context(db, workspace_id=workspace_id, project_id=project_id)
    if context is None:
        raise ProjectNotFoundError(str(project_id))
    report = RederiveReport()
    after: tuple[datetime, int] | None = None
    while True:
        async with sessions() as db, db.begin():
            batch = await _stale(db, workspace_id, project_id, context, after)
            if not batch:
                return report
            derivation_id = (
                0
                if dry_run
                else await current_derivation(
                    db, workspace_id, project_id, context.entity_config_version
                )
            )
            for row in batch:
                await _again(db, row, context, derivation_id, report, dry_run=dry_run)
            last = batch[-1]
            after = (last["observed_at"], last["observation_id"])


async def _stale(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    context: AiContext,
    after: tuple[datetime, int] | None,
) -> list[dict[str, Any]]:
    f, o, d = ai_observation_facts.c, ai_observations.c, ai_derivations.c
    target = (
        EXTRACTOR_VERSION,
        context.entity_config_version,
        RECOMMENDATION_VERSION,
        SENTIMENT_VERSION,
    )
    statement = (
        select(*ai_observation_facts.c, o.answer_text)
        .join(
            ai_observations,
            and_(o.id == f.observation_id, o.observed_at == f.observed_at),
        )
        .join(
            ai_derivations,
            and_(d.id == f.derivation_id, d.workspace_id == f.workspace_id),
        )
        .where(
            f.workspace_id == workspace_id,
            f.project_id == project_id,
            o.workspace_id == workspace_id,
            f.is_current,
            tuple_(
                d.extractor_version,
                d.entity_config_version,
                d.recommendation_version,
                d.sentiment_version,
            )
            != tuple_(*(literal(value) for value in target)),
        )
        .order_by(f.observed_at, f.observation_id)
        .limit(BATCH)
    )
    if after is not None:
        statement = statement.where(tuple_(f.observed_at, f.observation_id) > tuple_(*after))
    return [dict(row._mapping) for row in await db.execute(statement)]


def _facts_of(row: Mapping[str, Any], context: AiContext) -> AnswerFacts:
    # The citations are not read again: the sources are empty, and the citation columns of the
    # fact row are carried over from the old row.
    try:
        return extract_answer_facts(
            row["answer_text"],
            [],
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=row["is_valid"],
        )
    except TooManyMatchesError:
        _log.warning("AI answer matches too often", observation=row["observation_id"])
        return extract_answer_facts(
            None,
            [],
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=False,
        )


async def _again(
    db: AsyncSession,
    row: dict[str, Any],
    context: AiContext,
    derivation_id: int,
    report: RederiveReport,
    *,
    dry_run: bool,
) -> None:
    facts = _facts_of(row, context)
    fact = facts.fact
    report.candidates += 1
    report.mention_changes += int(fact.own_mentioned != row["own_mentioned"])
    report.recommended += int(fact.own_recommended and fact.is_valid)
    if fact.own_sentiment is not None and fact.is_valid:
        report.sentiment[fact.own_sentiment] += 1
    if dry_run:
        return
    key = {"observation_id": row["observation_id"], "observed_at": row["observed_at"]}
    f, m = ai_observation_facts.c, ai_entity_mentions.c
    # Anything already written under this derivation (a run that stopped half way) is replaced.
    await db.execute(
        delete(ai_observation_facts).where(
            f.observation_id == key["observation_id"],
            f.observed_at == key["observed_at"],
            f.derivation_id == derivation_id,
        )
    )
    await db.execute(
        delete(ai_entity_mentions).where(
            m.observation_id == key["observation_id"],
            m.observed_at == key["observed_at"],
            m.derivation_id == derivation_id,
        )
    )
    await db.execute(
        update(ai_observation_facts)
        .where(f.observation_id == key["observation_id"], f.observed_at == key["observed_at"])
        .values(is_current=False)
    )
    await db.execute(
        update(ai_entity_mentions)
        .where(m.observation_id == key["observation_id"], m.observed_at == key["observed_at"])
        .values(is_current=False)
    )
    await insert_mentions(
        db,
        workspace_id=row["workspace_id"],
        project_id=row["project_id"],
        engine_code=row["engine_code"],
        observation_id=row["observation_id"],
        observed_at=row["observed_at"],
        derivation_id=derivation_id,
        facts=facts,
    )
    values = {name: value for name, value in row.items() if name in _CARRIED}
    values.update(
        derivation_id=derivation_id,
        own_mentioned=fact.own_mentioned,
        own_mention_order=fact.own_mention_order,
        own_prominence=None if fact.own_prominence is None else Decimal(str(fact.own_prominence)),
        own_recommended=fact.own_recommended,
        own_sentiment=fact.own_sentiment,
        tracked_entities_mentioned=min(fact.tracked_entities_mentioned, _SMALLINT_MAX),
        competitor_mentions=list(fact.competitor_mentions),
        had_structured_list=fact.had_structured_list,
        is_current=True,
    )
    await db.execute(insert(ai_observation_facts).values(values))
    report.rederived += 1
