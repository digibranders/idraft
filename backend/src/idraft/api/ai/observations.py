"""AI answers as the API shows them (docs/19 section 3.7.6): a page of observations with their
facts, one observation with its citations and mentions, and its raw answer."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import observation_repository as repository
from idraft.api.ai.observation_repository import ObservationFilter
from idraft.api.pagination import CursorParams, decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import NotFoundError, WindowTooLargeError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import read_stored_answer, request_bounds
from idraft.api.schemas.ai import (
    CitationOut,
    MentionOut,
    ObservationDetail,
    ObservationFacts,
    ObservationSummary,
    Outcome,
    PromptSubject,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.storage.raw import ObjectStore

# Without `from`, a list covers the last 28 days; no request covers more than 92.
OBSERVATIONS_DAYS: Final = 28
OBSERVATIONS_MAX_DAYS: Final = 92


@dataclass(frozen=True, slots=True)
class ObservationPageResult:
    rows: list[ObservationSummary]
    next_cursor: str | None


def _outcome(mentioned: bool, cited: bool) -> Outcome:
    if mentioned:
        return "mentioned_and_cited" if cited else "mentioned_only"
    return "cited_only" if cited else "neither"


def _facts(row: Any) -> ObservationFacts | None:
    if row.derivation_id is None:
        return None
    return ObservationFacts(
        derivation_id=row.derivation_id,
        is_valid=row.is_valid,
        outcome=_outcome(row.own_mentioned, row.own_domain_cited),
        own_mentioned=row.own_mentioned,
        own_domain_cited=row.own_domain_cited,
        own_mention_order=row.own_mention_order,
        own_prominence=None if row.own_prominence is None else float(row.own_prominence),
        own_citation_count=row.own_citation_count,
        total_citation_count=row.total_citation_count,
        tracked_entities_mentioned=row.tracked_entities_mentioned,
        competitor_mentions=list(row.competitor_mentions),
        competitor_cited=list(row.competitor_cited),
        had_structured_list=row.had_structured_list,
    )


def _summary_fields(row: Any) -> dict[str, Any]:
    return {
        "observation_id": str(row.id),
        "observed_at": row.observed_at,
        "observed_date": row.observed_date,
        "engine_code": row.engine_code,
        "observation_class": row.observation_class,
        "subject": PromptSubject(
            type="prompt",
            prompt_id=row.prompt_id,
            prompt_version_id=row.prompt_version_id,
            version_no=row.version_no,
        ),
        "query_text": row.query_text,
        "run_id": row.collection_run_id,
        "replicate_index": row.replicate_index,
        "location_id": row.location_id,
        "language_code": row.language_code,
        "device": row.device,
        "status": row.status,
        "model_reported": row.model_reported,
        "answer_char_count": row.answer_char_count,
        "citation_count": row.citation_count,
        "fanout_count": row.fanout_count,
        "served_from_cache": row.served_from_cache,
        "facts": _facts(row),
    }


def _utf16(text: str | None) -> Callable[[int], int]:
    """Code point offsets of `text` as UTF-16 code units: each character past U+FFFF is two."""
    if text is None or all(ord(char) <= 0xFFFF for char in text):
        return lambda offset: offset
    units = [0]
    for char in text:
        units.append(units[-1] + (2 if ord(char) > 0xFFFF else 1))
    return lambda offset: units[min(offset, len(text))]


class ObservationService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], raw_store: ObjectStore | None
    ) -> None:
        self._sessions = sessions
        self._raw_store = raw_store

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: ObservationFilter,
        *,
        start: datetime | date | None,
        end: datetime | date | None,
        page: CursorParams,
    ) -> ObservationPageResult:
        async with self._transaction(access) as db:
            zone = await project_zone(db, access.workspace_id, project_id)
        if zone is None:
            raise NotFoundError
        since, until = request_bounds(start, end, ZoneInfo(zone.timezone))
        until = until or datetime.now(UTC)
        since = since or until - timedelta(days=OBSERVATIONS_DAYS)
        if until - since > timedelta(days=OBSERVATIONS_MAX_DAYS):
            raise WindowTooLargeError(
                f"A request covers at most {OBSERVATIONS_MAX_DAYS} days.",
                limit_days=OBSERVATIONS_MAX_DAYS,
            )
        scope: dict[str, object] = {
            "project_id": str(project_id),
            "from": start,
            "to": end,
            "engines": sorted(given.engine_codes or []),
            "prompt": given.prompt_id,
            "statuses": sorted(given.statuses or []),
            "is_valid": given.is_valid,
            "outcomes": sorted(given.outcomes or []),
        }
        after: tuple[datetime, int] | None = None
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=scope)
            try:
                after = (datetime.fromisoformat(str(key[0])), int(key[1]))
            except (ValueError, IndexError):
                raise invalid_cursor() from None
        async with self._transaction(access) as db:
            rows = await repository.list_observations(
                db,
                access.workspace_id,
                project_id,
                given,
                since=since,
                until=until,
                after=after,
                limit=page.limit + 1,
            )
        shown = rows[: page.limit]
        next_cursor = None
        if len(rows) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.observed_at.isoformat(), last.id], scope=scope)
        return ObservationPageResult(
            rows=[ObservationSummary(**_summary_fields(row)) for row in shown],
            next_cursor=next_cursor,
        )

    async def detail(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> ObservationDetail:
        async with self._transaction(access) as db:
            row = await repository.get_observation(
                db, access.workspace_id, project_id, observation_id, observed_at
            )
            if row is None:
                raise NotFoundError
            citations = await repository.citations_of(
                db, access.workspace_id, row.id, row.observed_at
            )
            mentions = (
                []
                if row.derivation_id is None
                else await repository.mentions_of(
                    db, access.workspace_id, row.id, row.observed_at, row.derivation_id
                )
            )
        units = _utf16(row.answer_text)
        extras = row.provider_extras or {}
        check_url = extras.get("check_url")
        return ObservationDetail(
            **_summary_fields(row),
            answer_text=row.answer_text,
            error_code=row.error_code,
            check_url=check_url if isinstance(check_url, str) else None,
            offsets_unit="utf16",
            citations=[
                CitationOut(
                    citation_index=c.citation_index,
                    url=c.canonical_url,
                    raw_url=c.raw_url,
                    host=c.host,
                    title=c.title,
                    source_name=c.source_name,
                    citation_kind=c.citation_kind,
                    domain_role=c.domain_role,
                    role_entity_id=c.role_entity_id,
                    occurrences=c.occurrences,
                    first_char_offset=None
                    if c.first_char_offset is None
                    else units(c.first_char_offset),
                    answer_block_index=c.answer_block_index,
                    referral_tag=c.referral_tag,
                    flags=list(c.flags),
                )
                for c in citations
            ],
            mentions=[
                MentionOut(
                    entity_id=m.entity_id,
                    name=m.canonical_name,
                    role=m.role,
                    mention_count=m.mention_count,
                    first_char_offset=units(m.first_char_offset),
                    mention_order=m.mention_order,
                    match_method=m.match_method,
                    mention_status=m.mention_status,
                    confidence=float(m.confidence),
                    evidence_spans=[
                        (units(span.lower), units(span.upper)) for span in m.evidence_spans
                    ],
                )
                for m in mentions
            ],
        )

    async def raw_answer(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> bytes:
        """The provider's answer as received. The observation must be one of the project in
        the path: the registry function checks the workspace only."""
        async with self._transaction(access) as db:
            found = await repository.get_observation(
                db, access.workspace_id, project_id, observation_id, observed_at
            )
            if found is None:
                raise NotFoundError
            row = await repository.raw_payload(db, observation_id)
        if row is None:
            raise NotFoundError
        return await read_stored_answer(row, self._raw_store, "observation")
