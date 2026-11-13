"""Reads of AI observations (docs/19 section 3.7.6). Row-level security keeps every read in the
caller's workspace; each query names the workspace and the project as well."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import and_, or_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_citations,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observations,
    ai_prompt_versions,
    domains,
    entities,
    projects,
    urls,
)

_O, _F, _V = ai_observations.c, ai_observation_facts.c, ai_prompt_versions.c
# An `observed_at` hint finds the month: the row is looked for this far either side of it.
HINT_SLACK: Final = timedelta(days=1)
# An outcome belongs to a valid answer: a refusal has both own flags false too, and must not
# count as "neither" (the metrics count valid answers only).
OUTCOMES: Final = {
    "mentioned_and_cited": and_(_F.is_valid, _F.own_mentioned, _F.own_domain_cited),
    "mentioned_only": and_(_F.is_valid, _F.own_mentioned, ~_F.own_domain_cited),
    "cited_only": and_(_F.is_valid, ~_F.own_mentioned, _F.own_domain_cited),
    "neither": and_(_F.is_valid, ~_F.own_mentioned, ~_F.own_domain_cited),
}
_SUMMARY: Final = (
    _O.id,
    _O.observed_at,
    _O.observed_date,
    _O.engine_code,
    _O.observation_class,
    _O.prompt_id,
    _O.prompt_version_id,
    _V.version_no,
    _O.query_text,
    _O.collection_run_id,
    _O.replicate_index,
    _O.location_id,
    _O.language_code,
    _O.device,
    _O.status,
    _O.model_reported,
    _O.answer_char_count,
    _O.citation_count,
    _O.fanout_count,
    _O.served_from_cache,
    _F.derivation_id,
    _F.is_valid,
    _F.own_mentioned,
    _F.own_domain_cited,
    _F.own_mention_order,
    _F.own_prominence,
    _F.own_citation_count,
    _F.total_citation_count,
    _F.tracked_entities_mentioned,
    _F.competitor_mentions,
    _F.competitor_cited,
    _F.had_structured_list,
)


@dataclass(frozen=True, slots=True)
class ObservationFilter:
    engine_codes: Sequence[str] | None = None
    prompt_id: UUID | None = None
    statuses: Sequence[str] | None = None
    is_valid: bool | None = None
    outcomes: Sequence[str] | None = None


def _source() -> Any:
    """Observations with their current facts and their prompt version, when they have them."""
    return ai_observations.outerjoin(
        ai_observation_facts,
        and_(
            _F.observation_id == _O.id,
            _F.observed_at == _O.observed_at,
            _F.workspace_id == _O.workspace_id,
            _F.is_current,
        ),
    ).outerjoin(
        ai_prompt_versions,
        and_(_V.id == _O.prompt_version_id, _V.workspace_id == _O.workspace_id),
    )


async def list_observations(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    given: ObservationFilter,
    *,
    since: datetime,
    until: datetime,
    after: tuple[datetime, int] | None,
    limit: int,
) -> list[Any]:
    statement = (
        select(*_SUMMARY)
        .select_from(_source())
        .where(
            _O.workspace_id == workspace_id,
            _O.project_id == project_id,
            _O.observed_at >= since,
            _O.observed_at < until,
            _O.superseded_by.is_(None),
        )
    )
    if given.engine_codes:
        statement = statement.where(_O.engine_code.in_(list(given.engine_codes)))
    if given.prompt_id is not None:
        statement = statement.where(_O.prompt_id == given.prompt_id)
    if given.statuses:
        statement = statement.where(_O.status.in_(list(given.statuses)))
    if given.is_valid is not None:
        statement = statement.where(_F.is_valid.is_(given.is_valid))
    if given.outcomes:
        statement = statement.where(or_(*(OUTCOMES[outcome] for outcome in given.outcomes)))
    if after is not None:
        statement = statement.where(tuple_(_O.observed_at, _O.id) < tuple_(*after))
    statement = statement.order_by(_O.observed_at.desc(), _O.id.desc()).limit(limit)
    return list(await db.execute(statement))


async def get_observation(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    observation_id: int,
    observed_at: datetime | None,
) -> Any | None:
    """An observation of a live project. `observed_at` is a hint; one so far from any answer that
    the slack leaves the calendar finds nothing."""
    statement = (
        select(*_SUMMARY, _O.answer_text, _O.answer_hash, _O.error_code, _O.provider_extras)
        .select_from(
            _source().join(
                projects,
                and_(projects.c.id == _O.project_id, projects.c.workspace_id == _O.workspace_id),
            )
        )
        .where(
            _O.workspace_id == workspace_id,
            _O.project_id == project_id,
            _O.id == observation_id,
            projects.c.deleted_at.is_(None),
        )
    )
    if observed_at is not None:
        try:
            earliest, latest = observed_at - HINT_SLACK, observed_at + HINT_SLACK
        except OverflowError:
            return None
        statement = statement.where(_O.observed_at >= earliest, _O.observed_at <= latest)
    return (await db.execute(statement)).one_or_none()


async def citations_of(
    db: AsyncSession, workspace_id: UUID, observation_id: int, observed_at: datetime
) -> list[Any]:
    c = ai_citations.c
    return list(
        await db.execute(
            select(
                c.citation_index,
                urls.c.canonical_url,
                c.raw_url,
                domains.c.host,
                c.title,
                c.source_name,
                c.quote,
                c.citation_kind,
                c.domain_role,
                c.role_entity_id,
                c.occurrences,
                c.first_char_offset,
                c.answer_block_index,
                c.referral_tag,
                c.flags,
            )
            .join(urls, urls.c.id == c.url_id)
            .join(domains, domains.c.id == c.domain_id)
            .where(
                c.workspace_id == workspace_id,
                c.observation_id == observation_id,
                c.observed_at == observed_at,
            )
            .order_by(c.citation_index)
        )
    )


async def mentions_of(
    db: AsyncSession,
    workspace_id: UUID,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
) -> list[Any]:
    m, e = ai_entity_mentions.c, entities.c
    return list(
        await db.execute(
            select(
                m.entity_id,
                e.canonical_name,
                m.role,
                m.mention_count,
                m.first_char_offset,
                m.mention_order,
                m.match_method,
                m.mention_status,
                m.confidence,
                m.evidence_spans,
            )
            .join(entities, and_(e.id == m.entity_id, e.workspace_id == m.workspace_id))
            .where(
                m.workspace_id == workspace_id,
                m.observation_id == observation_id,
                m.observed_at == observed_at,
                m.derivation_id == derivation_id,
                m.is_current,
            )
            .order_by(m.mention_order)
        )
    )


async def raw_payload(db: AsyncSession, observation_id: int) -> Any:
    """The registry row of an observation's payload, through the function that checks the
    workspace (migration 0018). It does not check the project: the caller must."""
    return (
        await db.execute(
            text("SELECT * FROM ai.observation_raw(:observation_id)"),
            {"observation_id": observation_id},
        )
    ).first()
