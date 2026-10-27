"""Rules for tracked keywords and workspace keywords (docs/19-api-specification.md section
3.6.1; plan decisions D3 to D5).

References a body names (location, schedule, groups, terms, competitor overrides) are checked
against the project before anything is written; a single create reports every wrong field
together, a bulk create rejects the item. Every write is audited in its transaction.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Collection, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.keywords import filters, rank_repository, repository
from idraft.api.keywords.rank_repository import (
    CompetitorRank as CompetitorRankRecord,
)
from idraft.api.keywords.rank_repository import FeatureRecord, SparkPoint, StateRecord
from idraft.api.keywords.repository import (
    CompetitorRecord,
    ConfigRecord,
    GroupRecord,
    KeywordRecord,
    MetricsRecord,
    OverrideRecord,
    ScheduleRecord,
    SnapshotRecord,
    TermRecord,
    TrackedRecord,
    UrlRecord,
    VariantRecord,
)
from idraft.api.pagination import CursorParams, decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import (
    DuplicateError,
    FieldError,
    NotFoundError,
    QuotaExceededError,
    TooManySubjectsError,
    invalid_field,
    invalid_fields,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.keywords import (
    CompetitorOverrides,
    TermAssignment,
    TrackedKeywordBulkArchive,
    TrackedKeywordBulkCreate,
    TrackedKeywordBulkDelete,
    TrackedKeywordBulkUpdate,
    TrackedKeywordCreate,
    TrackedKeywordFilter,
)
from idraft.api.schemas.operations import SeoSettings
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db import dictionaries
from idraft.db.engine import workspace_transaction
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize
from idraft.keywords import writer
from idraft.keywords.links import one_per_single_valued_vocabulary, terms_to_add
from idraft.keywords.text import KeywordRefusedError, check_keyword, normalize

# Fields a change compares with the stored row; `target_url` is compared by its URL id.
_COMPARED: Final = (
    "depth_profile",
    "intent",
    "funnel_stage",
    "priority",
    "business_value",
    "frequency",
    "schedule_id",
    "is_active",
)
# The rows one bulk change may touch by filter (docs/19 section 3.6.1); id lists stop at 5,000.
SUBJECTS_MAX = 20_000
# Groups and terms gained or lost in one bulk change or assignment: rows times links.
LINK_CHANGES_MAX = 200_000


@dataclass(frozen=True, slots=True)
class _Defaults:
    location_id: int | None
    language_code: str | None
    seo: SeoSettings


@dataclass(frozen=True, slots=True)
class _References:
    """What the items of one request name, as far as the project may use it."""

    locations: frozenset[int]
    schedules: frozenset[UUID]
    groups: frozenset[UUID]
    terms: Mapping[UUID, TermRecord]
    entities: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class _Plan:
    """An item that passed every check, ready to write."""

    item: TrackedKeywordCreate
    text: str
    location_id: int
    language_code: str
    devices: tuple[writer.Device, ...]
    depth_profile: str
    frequency: str
    target: CanonicalUrl | None
    overrides: Mapping[UUID, str] | None

    def rows(self, target_url_id: int | None) -> list[writer.NewTrackedKeyword]:
        item = self.item
        return [
            writer.NewTrackedKeyword(
                text=self.text,
                location_id=self.location_id,
                language_code=self.language_code,
                device=device,
                search_engine=item.search_engine,
                os=item.os,
                depth_profile=self.depth_profile,
                target_url_id=target_url_id,
                intent=item.intent or "unknown",
                intent_source=None if item.intent is None else "manual",
                funnel_stage=item.funnel_stage,
                priority=item.priority,
                business_value=item.business_value,
                frequency=self.frequency,
                schedule_id=item.schedule_id,
            )
            for device in self.devices
        ]


@dataclass(frozen=True, slots=True)
class BulkOutcome:
    created: list[UUID]
    # Those of `created` that were deleted and came back with their settings (plan decision D3).
    restored: list[UUID]
    skipped: list[tuple[int, UUID]]  # (item index, the tracked keyword it duplicates)
    rejected: list[tuple[int, str, str]]  # (item index, code, message)


@dataclass(frozen=True, slots=True)
class TrackedDetail:
    record: TrackedRecord
    metrics: MetricsRecord | None
    groups: list[GroupRecord]
    terms: list[TermRecord]
    overrides: list[OverrideRecord]
    config_versions: int
    schedule: ScheduleRecord | None
    state: StateRecord | None


@dataclass(frozen=True, slots=True)
class TrackedRow:
    """A list row; a block the request did not `include` is None. The state is always read."""

    record: TrackedRecord
    metrics: MetricsRecord | None
    groups: list[GroupRecord] | None
    terms: list[TermRecord] | None
    overrides: list[OverrideRecord] | None
    state: StateRecord | None = None
    sparkline: list[SparkPoint] | None = None
    competitor_ranks: list[CompetitorRankRecord] | None = None
    features: list[FeatureRecord] | None = None
    cited: list[UrlRecord] | None = None


@dataclass(frozen=True, slots=True)
class TrackedPageResult:
    rows: list[TrackedRow]
    next_cursor: str | None
    total: int


@dataclass(frozen=True, slots=True)
class BulkUpdateOutcome:
    matched: int
    updated: int
    versions: int


@dataclass(frozen=True, slots=True)
class AssignmentOutcome:
    matched: int
    added: int
    removed: int


@dataclass(frozen=True, slots=True)
class CompetitorSetResult:
    effective: list[CompetitorRecord]
    overrides: list[OverrideRecord]


@dataclass(frozen=True, slots=True)
class KeywordPageResult:
    rows: list[KeywordRecord]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class KeywordDetailResult:
    keyword: KeywordRecord
    metrics: list[MetricsRecord]
    variants: list[VariantRecord]


def _quota(limit: int, used: int, requested: int) -> QuotaExceededError:
    return QuotaExceededError(
        f"The workspace tracks {used} of {limit} keywords; {requested} more do not fit.",
        limit=limit,
        used=used,
        requested=requested,
    )


def _snapshot(record: TrackedRecord) -> dict[str, str | int | bool | None]:
    return {
        "project_id": str(record.project_id),
        "keyword": record.keyword.text,
        "search_engine": record.search_engine,
        "location_id": record.location_id,
        "language_code": record.language_code,
        "device": record.device,
        "os": record.os,
        "config_version": record.config_version,
        "depth_profile": record.depth_profile,
        "target_url": None if record.target_url is None else record.target_url.canonical_url,
        "intent": record.intent,
        "intent_source": record.intent_source,
        "funnel_stage": record.funnel_stage,
        "priority": record.priority,
        "business_value": None if record.business_value is None else str(record.business_value),
        "frequency": record.frequency,
        "schedule_id": None if record.schedule_id is None else str(record.schedule_id),
        "is_active": record.is_active,
    }


def _audit_value(value: object) -> str | int | bool | None:
    if value is None or isinstance(value, str | int | bool):
        return value
    return str(value)


def _target_id(record: TrackedRecord) -> int | None:
    return None if record.target_url is None else record.target_url.url_id


def _overrides(given: CompetitorOverrides) -> dict[UUID, str]:
    return {**dict.fromkeys(given.include, "include"), **dict.fromkeys(given.exclude, "exclude")}


def _check(
    item: TrackedKeywordCreate, defaults: _Defaults, refs: _References
) -> _Plan | list[FieldError]:
    """The item's plan, or every field found wrong, in the order of the body."""
    found: list[FieldError] = []
    text = ""
    try:
        text = check_keyword(item.keyword)
    except KeywordRefusedError as error:
        found.append(FieldError("keyword", error.code, str(error)))
    location_id = item.location_id if item.location_id is not None else defaults.location_id
    if location_id is None:
        found.append(
            FieldError("location_id", "location_required", "The project has no default location.")
        )
    elif location_id not in refs.locations:
        found.append(FieldError("location_id", "location_unknown", "No such active location."))
    language_code = item.language_code or defaults.language_code
    if language_code is None:
        found.append(
            FieldError("language_code", "language_required", "The project has no default language.")
        )
    target: CanonicalUrl | None = None
    if item.target_url is not None:
        try:
            target = canonicalize(item.target_url)
        except UrlRejectedError:
            found.append(FieldError("target_url", "invalid_url", "Not an http(s) URL."))
    if item.schedule_id is not None and item.schedule_id not in refs.schedules:
        found.append(
            FieldError("schedule_id", "schedule_unknown", "No such rank schedule in the project.")
        )
    if any(group_id not in refs.groups for group_id in item.group_ids):
        found.append(FieldError("group_ids", "group_unknown", "No such group in the project."))
    if any(term_id not in refs.terms for term_id in item.term_ids):
        found.append(FieldError("term_ids", "term_unknown", "No such term the project may use."))
    elif _two_in_a_single_valued_vocabulary(item.term_ids, refs.terms):
        found.append(
            FieldError(
                "term_ids",
                "single_valued_vocabulary",
                "A keyword has at most one term of a single-valued vocabulary.",
            )
        )
    overrides = None
    if item.competitor_overrides is not None:
        overrides = _overrides(item.competitor_overrides)
        if any(entity_id not in refs.entities for entity_id in overrides):
            found.append(
                FieldError(
                    "competitor_overrides",
                    "entity_not_in_project",
                    "An entity the project has not given a role.",
                )
            )
    if found or location_id is None or language_code is None:
        return found
    return _Plan(
        item=item,
        text=text,
        location_id=location_id,
        language_code=language_code,
        devices=writer.devices(item.device or defaults.seo.default_device),
        depth_profile=item.depth_profile or defaults.seo.default_depth_profile,
        frequency=item.frequency or defaults.seo.default_frequency,
        target=target,
        overrides=overrides,
    )


def _terms_to_add(
    have: Sequence[TermRecord], wanted: Sequence[UUID], refs: _References
) -> list[TermRecord]:
    """The wanted terms a keyword holding `have` can take (the rule is shared with imports)."""
    return terms_to_add(have, [refs.terms[term_id] for term_id in wanted])


def _two_in_a_single_valued_vocabulary(
    term_ids: Collection[UUID], terms: Mapping[UUID, TermRecord]
) -> bool:
    per_vocabulary = Counter(
        terms[term_id].vocabulary_id for term_id in set(term_ids) if terms[term_id].is_single_valued
    )
    return any(count > 1 for count in per_vocabulary.values())


class KeywordService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    # Tracked keywords.

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        item: TrackedKeywordCreate,
        info: RequestInfo,
    ) -> list[TrackedRecord]:
        """One row per device. `409 duplicate` when the project tracks the keyword already,
        archived included; a deleted one comes back with its stored settings (plan decision
        D3)."""
        now = datetime.now(UTC)
        async with self._transaction(access) as db:
            defaults = await self._defaults(db, access, project_id)
            refs = await self._references(db, access, project_id, defaults, [item])
            checked = _check(item, defaults, refs)
            if isinstance(checked, list):
                raise invalid_fields(checked)
            targets = await self._targets(db, [checked.target])
            try:
                result = await writer.write_tracked_keywords(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    items=checked.rows(self._target_of(checked, targets)),
                    source="manual",
                    created_by=access.user_id,
                    now=now,
                    refuse_existing=True,
                )
            except writer.IdentityTakenError as error:
                raise DuplicateError(
                    "The project tracks this keyword already.",
                    existing_id=error.existing.tracked_keyword_id,
                ) from None
            except writer.QuotaExceededError as error:
                raise _quota(error.limit, error.used, error.requested) from None
            except writer.ProjectGoneError:
                raise NotFoundError from None
            await self._link(
                db, access, project_id, [(entry, checked) for entry in result.created], refs
            )
            records = await repository.tracked_by_ids(
                db, access.workspace_id, [entry.tracked_keyword_id for entry in result.created]
            )
            await self._audit_created(db, access, records, result.created, info)
        return records

    async def bulk_create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: TrackedKeywordBulkCreate,
        info: RequestInfo,
    ) -> BulkOutcome:
        """Items that cannot be tracked are rejected one by one; the others are written in one
        transaction, all or none: over the quota, nothing is written."""
        now = datetime.now(UTC)
        async with self._transaction(access) as db:
            defaults = await self._defaults(db, access, project_id)
            refs = await self._references(db, access, project_id, defaults, body.items)
            plans: dict[int, _Plan] = {}
            rejected: list[tuple[int, str, str]] = []
            for index, item in enumerate(body.items):
                checked = _check(item, defaults, refs)
                if isinstance(checked, list):
                    rejected.append((index, checked[0].code, checked[0].message))
                else:
                    plans[index] = checked
            targets = await self._targets(db, [plan.target for plan in plans.values()])
            rows = [
                (index, row)
                for index, plan in plans.items()
                for row in plan.rows(self._target_of(plan, targets))
            ]
            created: list[tuple[int, writer.Created]] = []
            existing: list[tuple[int, writer.Existing]] = []
            for start in range(0, len(rows), writer.WRITE_MAX):
                chunk = rows[start : start + writer.WRITE_MAX]
                try:
                    result = await writer.write_tracked_keywords(
                        db,
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        items=[row for _, row in chunk],
                        source="manual",
                        created_by=access.user_id,
                        now=now,
                    )
                except writer.QuotaExceededError as error:
                    # The quota counts what earlier chunks of this request wrote as used.
                    raise _quota(
                        error.limit, error.used - len(created), error.requested + len(created)
                    ) from None
                except writer.ProjectGoneError:
                    raise NotFoundError from None
                created.extend((chunk[entry.index][0], entry) for entry in result.created)
                existing.extend((chunk[entry.index][0], entry) for entry in result.existing)
            await self._link(
                db, access, project_id, [(entry, plans[index]) for index, entry in created], refs
            )
            if body.on_duplicate == "merge_terms":
                await self._merge(db, access, project_id, existing, plans, refs, info)
            records = await repository.tracked_by_ids(
                db, access.workspace_id, [entry.tracked_keyword_id for _, entry in created]
            )
            await self._audit_created(db, access, records, [entry for _, entry in created], info)
        return BulkOutcome(
            created=[entry.tracked_keyword_id for _, entry in created],
            restored=[entry.tracked_keyword_id for _, entry in created if entry.restored],
            skipped=[(index, entry.tracked_keyword_id) for index, entry in existing],
            rejected=rejected,
        )

    async def get(
        self, access: WorkspaceAccess, project_id: UUID, tracked_keyword_id: UUID
    ) -> TrackedDetail:
        async with self._transaction(access) as db:
            record = await self._tracked(db, access, project_id, tracked_keyword_id)
            ids = [record.id]
            key = (record.keyword.id, record.location_id, record.language_code)
            metrics = await repository.current_metrics(db, access.workspace_id, [key])
            return TrackedDetail(
                record=record,
                metrics=metrics.get(key),
                groups=(await repository.groups_of(db, access.workspace_id, ids)).get(
                    record.id, []
                ),
                terms=(await repository.terms_of(db, access.workspace_id, ids)).get(record.id, []),
                overrides=(
                    await repository.overrides_of(db, access.workspace_id, project_id, ids)
                ).get(record.id, []),
                config_versions=await repository.config_counts(db, access.workspace_id, record.id),
                state=(await rank_repository.states_of(db, access.workspace_id, ids)).get(
                    record.id
                ),
                schedule=None
                if record.schedule_id is None
                else await repository.schedule_ref(db, access.workspace_id, record.schedule_id),
            )

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> TrackedRecord:
        """Changes the given fields. A new `depth_profile` or `target_url` is a new
        configuration version with a history row; nothing is written when nothing differs."""
        now = datetime.now(UTC)
        given = dict(changes)
        reason = given.pop("change_reason", None)
        async with self._transaction(access) as db:
            found: list[FieldError] = []
            target: CanonicalUrl | None = None
            raw_target = given.get("target_url")
            if isinstance(raw_target, str):
                try:
                    target = canonicalize(raw_target)
                except UrlRejectedError:
                    found.append(FieldError("target_url", "invalid_url", "Not an http(s) URL."))
            schedule_id = given.get("schedule_id")
            if isinstance(schedule_id, UUID) and not await repository.rank_schedules(
                db, access.workspace_id, project_id, [schedule_id]
            ):
                found.append(
                    FieldError(
                        "schedule_id", "schedule_unknown", "No such rank schedule in the project."
                    )
                )
            if found:
                raise invalid_fields(found)
            # In the order every writer takes them: the URL, the quota, then the row.
            new_target_id = None if target is None else (await dictionaries.url_for(db, target)).id
            quota: tuple[int, int] | None = None
            if given.get("is_active") is True:
                quota = await writer.lock_quota(db, access.workspace_id)
            current = await self._tracked(db, access, project_id, tracked_keyword_id, lock=True)
            values: dict[str, object] = {
                field: given[field]
                for field in _COMPARED
                if field in given and getattr(current, field) != given[field]
            }
            target_url_id = _target_id(current)
            if "target_url" in given and new_target_id != target_url_id:
                target_url_id = new_target_id
                values["target_url_id"] = new_target_id
            if "intent" in given and ("intent" in values or current.intent_source != "manual"):
                values["intent_source"] = "manual"
            if values.get("is_active") is True and quota is not None:
                try:
                    writer.check_quota(*quota, 1)
                except writer.QuotaExceededError as error:
                    raise _quota(error.limit, error.used, error.requested) from None
            if "depth_profile" in values or "target_url_id" in values:
                values["config_version"] = current.config_version + 1
                await repository.new_config_version(
                    db,
                    workspace_id=access.workspace_id,
                    tracked_keyword_id=current.id,
                    version=current.config_version + 1,
                    depth_profile=str(values.get("depth_profile", current.depth_profile)),
                    target_url_id=target_url_id,
                    changed_by=access.user_id,
                    change_reason=None if reason is None else str(reason),
                    now=now,
                )
            if not values:
                return current
            await repository.update_tracked(
                db, access.workspace_id, current.id, {**values, "updated_at": now}
            )
            updated = await self._tracked(db, access, project_id, tracked_keyword_id)
            before, after = _snapshot(current), _snapshot(updated)
            differing = [field for field in after if after[field] != before[field]]
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tracked_keyword.updated",
                target_type="tracked_keyword",
                target_id=current.id,
                info=info,
                before={field: before[field] for field in differing},
                after={
                    **{field: after[field] for field in differing},
                    **({} if reason is None else {"change_reason": str(reason)}),
                },
            )
        return updated

    async def delete(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        info: RequestInfo,
    ) -> None:
        """A soft delete: rank and metric history stay, and tracking the same keyword again
        brings the row back (plan decisions D2 and D3)."""
        now = datetime.now(UTC)
        async with self._transaction(access) as db:
            current = await self._tracked(db, access, project_id, tracked_keyword_id, lock=True)
            await repository.update_tracked(
                db, access.workspace_id, current.id, {"deleted_at": now, "updated_at": now}
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tracked_keyword.deleted",
                target_type="tracked_keyword",
                target_id=current.id,
                info=info,
                before=_snapshot(current),
            )

    async def config_history(
        self, access: WorkspaceAccess, project_id: UUID, tracked_keyword_id: UUID
    ) -> list[ConfigRecord]:
        async with self._transaction(access) as db:
            record = await self._tracked(db, access, project_id, tracked_keyword_id)
            return await repository.config_history(db, access.workspace_id, record.id)

    async def set_competitors(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        given: CompetitorOverrides,
        info: RequestInfo,
    ) -> CompetitorSetResult:
        """Replaces the keyword's overrides. Only entities with a live role in the project may
        be named."""
        modes = _overrides(given)
        async with self._transaction(access) as db:
            current = await self._tracked(db, access, project_id, tracked_keyword_id, lock=True)
            with_role = await repository.entities_with_role(
                db, access.workspace_id, project_id, modes
            )
            found = [
                FieldError(
                    path, "entity_not_in_project", "An entity the project has not given a role."
                )
                for path, ids in (("include", given.include), ("exclude", given.exclude))
                if any(entity_id not in with_role for entity_id in ids)
            ]
            if found:
                raise invalid_fields(found)
            before = (
                await repository.overrides_of(db, access.workspace_id, project_id, [current.id])
            ).get(current.id, [])
            await repository.replace_overrides(
                db, workspace_id=access.workspace_id, tracked_keyword_id=current.id, modes=modes
            )
            overrides = (
                await repository.overrides_of(db, access.workspace_id, project_id, [current.id])
            ).get(current.id, [])
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tracked_keyword.competitors_changed",
                target_type="tracked_keyword",
                target_id=current.id,
                info=info,
                before=_override_snapshot(before),
                after=_override_snapshot(overrides),
            )
            defaults = await repository.project_competitors(db, access.workspace_id, project_id)
        return CompetitorSetResult(
            effective=effective_set(defaults, overrides), overrides=overrides
        )

    # The list and bulk changes.

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: TrackedKeywordFilter,
        sort: Sequence[filters.SortKey],
        include: Collection[str],
        page: CursorParams,
    ) -> TrackedPageResult:
        """A page of the project's tracked keywords, with `page.total` for the filter."""
        parts = filters.components(sort)
        bound = {"sort": [key.label() for key in sort], **filters.scope(given, project_id)}
        after = None
        if page.cursor is not None:
            values = filters.decode_key(parts, decode_cursor(page.cursor, scope=bound))
            after = filters.after(parts, values)
        async with self._transaction(access) as db:
            await self._defaults(db, access, project_id)
            where = filters.conditions(
                given,
                workspace_id=access.workspace_id,
                project_id=project_id,
                terms=await self._term_groups(db, access, given.term or []),
            )
            found = await repository.list_tracked(
                db,
                access.workspace_id,
                conditions=where,
                order=filters.order_by(parts),
                key=[part.expression for part in parts],
                after=after,
                limit=page.limit + 1,
            )
            shown = found[: page.limit]
            total = await repository.count_tracked(db, access.workspace_id, where)
            rows = await self._blocks(db, access, project_id, [row for row, _ in shown], include)
        next_cursor = None
        if len(found) > page.limit:
            next_cursor = encode_cursor(filters.encode_key(parts, shown[-1][1]), scope=bound)
        return TrackedPageResult(rows=rows, next_cursor=next_cursor, total=total)

    async def bulk_update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: TrackedKeywordBulkUpdate,
        info: RequestInfo,
    ) -> BulkUpdateOutcome:
        """`set`, then groups and terms, on the chosen rows, in one transaction. A new depth
        profile or target URL is a new configuration version for each row it changes."""
        now = datetime.now(UTC)
        given = {} if body.set is None else body.set.model_dump(include=body.set.model_fields_set)
        reason = given.pop("change_reason", None)
        async with self._transaction(access) as db:
            await self._defaults(db, access, project_id)
            found: list[FieldError] = []
            target: CanonicalUrl | None = None
            raw_target = given.get("target_url")
            if isinstance(raw_target, str):
                try:
                    target = canonicalize(raw_target)
                except UrlRejectedError:
                    found.append(FieldError("set.target_url", "invalid_url", "Not an http(s) URL."))
            schedule_id = given.get("schedule_id")
            if isinstance(schedule_id, UUID) and not await repository.rank_schedules(
                db, access.workspace_id, project_id, [schedule_id]
            ):
                found.append(
                    FieldError(
                        "set.schedule_id",
                        "schedule_unknown",
                        "No such rank schedule in the project.",
                    )
                )
            groups = await repository.project_groups(
                db, access.workspace_id, project_id, body.add_group_ids
            )
            if any(group_id not in groups for group_id in body.add_group_ids):
                found.append(
                    FieldError("add_group_ids", "group_unknown", "No such group in the project.")
                )
            terms = {
                term.term_id: term
                for term in await repository.project_terms(
                    db, access.workspace_id, project_id, body.add_term_ids
                )
            }
            if any(term_id not in terms for term_id in body.add_term_ids):
                found.append(
                    FieldError("add_term_ids", "term_unknown", "No such term the project may use.")
                )
            elif _two_in_a_single_valued_vocabulary(body.add_term_ids, terms):
                found.append(
                    FieldError(
                        "add_term_ids",
                        "single_valued_vocabulary",
                        "At most one term of a single-valued vocabulary.",
                    )
                )
            if found:
                raise invalid_fields(found)
            # In the order every writer takes them: vocabularies and groups (held above), the
            # URL, the quota, then the rows.
            target_url_id = None if target is None else (await dictionaries.url_for(db, target)).id
            quota = (
                await writer.lock_quota(db, access.workspace_id)
                if given.get("is_active") is True
                else None
            )
            links = (
                body.add_group_ids,
                body.remove_group_ids,
                body.add_term_ids,
                body.remove_term_ids,
            )
            ids = await self._subjects(
                db, access, project_id, body.ids, body.filter, links=sum(map(len, links))
            )
            if quota is not None:
                await self._fits(db, access, ids, quota)
            plain: dict[str, object] = {
                field: given[field]
                for field in _COMPARED
                if field in given and field != "depth_profile"
            }
            if "intent" in given:
                plain["intent_source"] = "manual"
            workspace_id = access.workspace_id
            changed = await repository.set_fields(db, workspace_id, ids, plain, now)
            versioned = await repository.new_config_versions(
                db,
                workspace_id,
                ids,
                depth_profile=None
                if given.get("depth_profile") is None
                else str(given["depth_profile"]),
                target_url_id=target_url_id,
                set_target="target_url" in given,
                changed_by=access.user_id,
                change_reason=None if reason is None else str(reason),
                now=now,
            )
            changed |= versioned
            for per_keyword in (
                await repository.remove_members(db, workspace_id, ids, body.remove_group_ids),
                await repository.add_members_to(db, workspace_id, ids, body.add_group_ids),
                await repository.remove_terms(db, workspace_id, ids, body.remove_term_ids),
                await repository.drop_other_terms(
                    db, workspace_id, ids, body.add_term_ids, single_valued_only=True
                ),
                await repository.add_terms_to(
                    db, workspace_id, ids, body.add_term_ids, assigned_by="manual"
                ),
            ):
                changed.update(per_keyword)
            fields: dict[str, str | int | bool | list[str] | None] = {
                field: _audit_value(value) for field, value in given.items()
            }
            if reason is not None:
                fields["change_reason"] = str(reason)
            summary = dict(fields)
            for name, linked in zip(
                ("add_group_ids", "remove_group_ids", "add_term_ids", "remove_term_ids"),
                links,
                strict=True,
            ):
                if linked:
                    summary[name] = sorted(map(str, linked))
            await self._audit_bulk(db, access, project_id, ids, changed, fields, summary, info)
        return BulkUpdateOutcome(matched=len(ids), updated=len(changed), versions=len(versioned))

    async def bulk_archive(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: TrackedKeywordBulkArchive,
        info: RequestInfo,
    ) -> tuple[int, int]:
        """Archives or unarchives the chosen rows; unarchiving counts against the quota. How
        many matched and how many changed."""
        now = datetime.now(UTC)
        async with self._transaction(access) as db:
            await self._defaults(db, access, project_id)
            quota = None if body.archive else await writer.lock_quota(db, access.workspace_id)
            ids = await self._subjects(db, access, project_id, body.ids, body.filter)
            if quota is not None:
                await self._fits(db, access, ids, quota)
            changed = await repository.set_fields(
                db, access.workspace_id, ids, {"is_active": not body.archive}, now
            )
            change = {"is_active": not body.archive}
            await self._audit_bulk(db, access, project_id, ids, changed, change, change, info)
        return len(ids), len(changed)

    async def bulk_delete(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: TrackedKeywordBulkDelete,
        info: RequestInfo,
    ) -> tuple[int, int]:
        """Deletes the chosen rows as `delete` does one: soft, history kept. How many matched
        and how many were deleted."""
        now = datetime.now(UTC)
        async with self._transaction(access) as db:
            await self._defaults(db, access, project_id)
            ids = await self._subjects(db, access, project_id, body.ids, body.filter)
            deleted = await repository.set_fields(
                db, access.workspace_id, ids, {"deleted_at": now}, now
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tracked_keyword.bulk_changed",
                target_type="project",
                target_id=project_id,
                info=info,
                after={"deleted": True, "matched": len(ids), "changed": len(deleted)},
            )
            await audit.record_each(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tracked_keyword.deleted",
                target_type="tracked_keyword",
                info=info,
                entries=[
                    audit.Entry(target_id=tracked_id, after={"bulk": True})
                    for tracked_id in sorted(deleted)
                ],
            )
        return len(ids), len(deleted)

    async def assign_terms(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: TermAssignment,
        info: RequestInfo,
    ) -> AssignmentOutcome:
        """`add` gives the terms (a term of a single-valued vocabulary replaces the keyword's
        other one of it), `remove` takes them, and `replace` makes them the keyword's only
        terms within their vocabularies."""
        async with self._transaction(access) as db:
            await self._defaults(db, access, project_id)
            if body.subject_type != "tracked_keyword":
                raise invalid_field(
                    "subject_type",
                    code="subject_type_not_supported",
                    message="Terms are assigned to tracked keywords; prompts arrive later.",
                )
            workspace_id = access.workspace_id
            # Taking terms away cannot break a vocabulary's rule, so only additions hold the
            # vocabularies against a change to `is_single_valued`.
            terms = {
                term.term_id: term
                for term in await repository.project_terms(
                    db, workspace_id, project_id, body.term_ids, hold=body.op != "remove"
                )
            }
            if any(term_id not in terms for term_id in body.term_ids):
                raise invalid_field(
                    "term_ids", code="term_unknown", message="No such term the project may use."
                )
            if body.op != "remove" and _two_in_a_single_valued_vocabulary(body.term_ids, terms):
                raise invalid_field(
                    "term_ids",
                    code="single_valued_vocabulary",
                    message="At most one term of a single-valued vocabulary.",
                )
            ids = await self._subjects(
                db,
                access,
                project_id,
                body.subject_ids,
                body.subject_filter,
                links=len(body.term_ids),
            )
            removed: repository.PerKeyword = {}
            added: repository.PerKeyword = {}
            if body.op == "remove":
                removed = await repository.remove_terms(db, workspace_id, ids, body.term_ids)
            else:
                removed = await repository.drop_other_terms(
                    db, workspace_id, ids, body.term_ids, single_valued_only=body.op == "add"
                )
                added = await repository.add_terms_to(
                    db, workspace_id, ids, body.term_ids, assigned_by="manual"
                )
            await self._audit_bulk(
                db,
                access,
                project_id,
                ids,
                {*removed, *added},
                {"term_assignment": body.op},
                {"term_assignment": body.op, "term_ids": sorted(map(str, body.term_ids))},
                info,
            )
        return AssignmentOutcome(
            matched=len(ids), added=sum(added.values()), removed=sum(removed.values())
        )

    async def _term_groups(
        self, db: AsyncSession, access: WorkspaceAccess, term_ids: Sequence[UUID]
    ) -> filters.TermGroups:
        if not term_ids:
            return filters.TermGroups(())
        vocabularies = await repository.vocabularies_of(db, access.workspace_id, term_ids)
        return filters.term_groups(term_ids, vocabularies)

    async def _subjects(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        ids: Sequence[UUID] | None,
        given: TrackedKeywordFilter | None,
        *,
        links: int = 0,
    ) -> list[UUID]:
        """The chosen rows, locked: the given ids of the project's live tracked keywords, or
        the rows the filter matches. At most `SUBJECTS_MAX`, and when each row gains or loses
        `links` groups and terms, at most `LINK_CHANGES_MAX` link changes in all."""
        limit = SUBJECTS_MAX if links == 0 else min(SUBJECTS_MAX, LINK_CHANGES_MAX // links)
        if ids is not None:
            where = filters.chosen(workspace_id=access.workspace_id, project_id=project_id, ids=ids)
        else:
            chosen_by = given or TrackedKeywordFilter()
            where = filters.conditions(
                chosen_by,
                workspace_id=access.workspace_id,
                project_id=project_id,
                terms=await self._term_groups(db, access, chosen_by.term or []),
            )
        found = await repository.lock_subjects(db, access.workspace_id, where, limit + 1)
        if len(found) > limit:
            raise TooManySubjectsError(
                f"This change takes at most {limit} tracked keywords; choose fewer.",
                limit=limit,
            )
        return found

    @staticmethod
    async def _fits(
        db: AsyncSession, access: WorkspaceAccess, ids: Collection[UUID], quota: tuple[int, int]
    ) -> None:
        """The archived rows among `ids` can become active within the quota."""
        try:
            writer.check_quota(
                *quota, await repository.count_inactive(db, access.workspace_id, ids)
            )
        except writer.QuotaExceededError as error:
            raise _quota(error.limit, error.used, error.requested) from None

    @staticmethod
    async def _audit_bulk(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        matched: Collection[UUID],
        changed: Collection[UUID],
        row_change: audit.Snapshot,
        summary: audit.Snapshot,
        info: RequestInfo,
    ) -> None:
        """One entry for the request on the project, with the whole change, and one small
        entry per changed row, without the id lists the request named."""
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action="tracked_keyword.bulk_changed",
            target_type="project",
            target_id=project_id,
            info=info,
            after={**summary, "matched": len(matched), "changed": len(changed)},
        )
        await audit.record_each(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action="tracked_keyword.updated",
            target_type="tracked_keyword",
            info=info,
            entries=[
                audit.Entry(target_id=tracked_id, after={**row_change, "bulk": True})
                for tracked_id in sorted(changed)
            ],
        )

    async def _blocks(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        records: Sequence[TrackedRecord],
        include: Collection[str],
    ) -> list[TrackedRow]:
        """The rows with the blocks `include` names; the others stay None."""
        ids = [record.id for record in records]
        workspace_id = access.workspace_id
        metrics = (
            await repository.current_metrics(
                db,
                workspace_id,
                {(r.keyword.id, r.location_id, r.language_code) for r in records},
            )
            if "metrics" in include
            else None
        )
        groups = await repository.groups_of(db, workspace_id, ids) if "groups" in include else None
        terms = await repository.terms_of(db, workspace_id, ids) if "terms" in include else None
        overrides = (
            await repository.overrides_of(db, workspace_id, project_id, ids)
            if "competitors" in include
            else None
        )
        states = await rank_repository.states_of(db, workspace_id, ids)
        sparklines = (
            await rank_repository.sparklines_of(db, workspace_id, ids)
            if "sparkline" in include
            else None
        )
        competitor_ranks = (
            await rank_repository.competitor_ranks_of(db, workspace_id, project_id, ids)
            if "competitor_ranks" in include
            else None
        )
        features, cited = (
            await rank_repository.features_of(db, workspace_id, ids)
            if "features" in include or "aio" in include
            else (None, None)
        )
        return [
            TrackedRow(
                record=record,
                metrics=None
                if metrics is None
                else metrics.get((record.keyword.id, record.location_id, record.language_code)),
                groups=None if groups is None else groups.get(record.id, []),
                terms=None if terms is None else terms.get(record.id, []),
                overrides=None if overrides is None else overrides.get(record.id, []),
                state=states.get(record.id),
                sparkline=None if sparklines is None else sparklines.get(record.id, []),
                competitor_ranks=None
                if competitor_ranks is None
                else competitor_ranks.get(record.id, []),
                features=None
                if features is None or "features" not in include
                else features.get(record.id, []),
                cited=None if cited is None or "aio" not in include else cited.get(record.id, []),
            )
            for record in records
        ]

    # Workspace keywords.

    async def keyword_page(
        self,
        access: WorkspaceAccess,
        *,
        q: str | None,
        language_code: str | None,
        page: CursorParams,
    ) -> KeywordPageResult:
        scope: dict[str, object] = {"sort": "text", "q": q, "language_code": language_code}
        after: tuple[str, UUID] | None = None
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=scope)
            if len(key) != 2 or not all(isinstance(value, str) for value in key):
                raise invalid_cursor()
            try:
                after = (str(key[0]), UUID(str(key[1])))
            except ValueError:
                raise invalid_cursor() from None
        async with self._transaction(access) as db:
            found = await repository.list_keywords(
                db,
                access.workspace_id,
                visible=access.project_ids,
                q=None if q is None else normalize(q),
                language_code=language_code,
                after=after,
                limit=page.limit + 1,
            )
        shown = found[: page.limit]
        next_cursor = None
        if len(found) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.normalized_text, str(last.id)], scope=scope)
        return KeywordPageResult(rows=shown, next_cursor=next_cursor)

    async def keyword(self, access: WorkspaceAccess, keyword_id: UUID) -> KeywordDetailResult:
        """A member limited to some projects sees the metrics of the locations and languages
        those projects track the keyword in."""
        async with self._transaction(access) as db:
            keyword = await self._keyword(db, access, keyword_id)
            variants = await repository.variants(
                db, access.workspace_id, keyword_id, visible=access.project_ids
            )
            metrics = await repository.keyword_metrics(db, access.workspace_id, keyword_id)
        if access.project_ids is not None:
            tracked = {(variant.location_id, variant.language_code) for variant in variants}
            metrics = [m for m in metrics if (m.location_id, m.language_code) in tracked]
        return KeywordDetailResult(keyword=keyword, metrics=metrics, variants=variants)

    async def metrics_history(
        self,
        access: WorkspaceAccess,
        keyword_id: UUID,
        *,
        location_id: int,
        language_code: str,
        source: str,
        since: date | None,
        until: date | None,
    ) -> list[SnapshotRecord]:
        """Oldest first. Empty for a member limited to some projects when none of them tracks
        the keyword at this location and language."""
        async with self._transaction(access) as db:
            await self._keyword(db, access, keyword_id)
            if access.project_ids is not None:
                variants = await repository.variants(
                    db, access.workspace_id, keyword_id, visible=access.project_ids
                )
                if all(
                    (variant.location_id, variant.language_code) != (location_id, language_code)
                    for variant in variants
                ):
                    return []
            return await repository.snapshots(
                db,
                access.workspace_id,
                keyword_id,
                location_id=location_id,
                language_code=language_code,
                source=source,
                since=since,
                until=until,
            )

    # Shared steps.

    @staticmethod
    async def _defaults(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> _Defaults:
        found = await repository.project_defaults(db, access.workspace_id, project_id)
        if found is None:
            raise NotFoundError
        return _Defaults(
            location_id=found.location_id,
            language_code=found.language_code,
            seo=SeoSettings.model_validate(found.settings.get("seo", {})),
        )

    @staticmethod
    async def _references(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        defaults: _Defaults,
        items: Sequence[TrackedKeywordCreate],
    ) -> _References:
        workspace_id = access.workspace_id
        location_ids = {
            item.location_id if item.location_id is not None else defaults.location_id
            for item in items
        }
        schedule_ids = {item.schedule_id for item in items if item.schedule_id is not None}
        group_ids = {group_id for item in items for group_id in item.group_ids}
        term_ids = {term_id for item in items for term_id in item.term_ids}
        entity_ids = {
            entity_id
            for item in items
            if item.competitor_overrides is not None
            for entity_id in _overrides(item.competitor_overrides)
        }
        terms = await repository.project_terms(db, workspace_id, project_id, term_ids)
        return _References(
            locations=frozenset(
                await repository.active_locations(
                    db, {location for location in location_ids if location is not None}
                )
            ),
            schedules=frozenset(
                await repository.rank_schedules(db, workspace_id, project_id, schedule_ids)
            ),
            groups=frozenset(
                await repository.project_groups(db, workspace_id, project_id, group_ids)
            ),
            terms={term.term_id: term for term in terms},
            entities=frozenset(
                await repository.entities_with_role(db, workspace_id, project_id, entity_ids)
            ),
        )

    @staticmethod
    async def _targets(db: AsyncSession, given: Sequence[CanonicalUrl | None]) -> dict[bytes, int]:
        """The `core.urls` id of each target URL, by its hash. Hosts and URLs are added in one
        order (host, then URL), so two requests adding the same new ones cannot each wait on
        one the other added first."""
        distinct = {url.url_hash: url for url in given if url is not None}
        ordered = sorted(distinct.values(), key=lambda url: (url.host.name, url.url_hash))
        return {url.url_hash: (await dictionaries.url_for(db, url)).id for url in ordered}

    @staticmethod
    def _target_of(plan: _Plan, targets: Mapping[bytes, int]) -> int | None:
        return None if plan.target is None else targets[plan.target.url_hash]

    @staticmethod
    async def _link(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        written: Sequence[tuple[writer.Created, _Plan]],
        refs: _References,
    ) -> None:
        """Groups, terms and competitor overrides of new tracked keywords. A restored one keeps
        its stored links and overrides (plan decision D3): the item's groups are added, and its
        terms where they fit, so a single-valued vocabulary keeps the stored term. A vocabulary
        that became single-valued while the keyword was deleted keeps its first stored term
        in path order; the others are taken away."""
        restored = [entry.tracked_keyword_id for entry, _ in written if entry.restored]
        stored = await repository.terms_of(db, access.workspace_id, restored) if restored else {}
        for tracked_id, terms in stored.items():
            kept, surplus = one_per_single_valued_vocabulary(terms)
            if surplus:
                await repository.remove_terms(db, access.workspace_id, [tracked_id], surplus)
                stored[tracked_id] = kept
        await repository.add_members(
            db,
            workspace_id=access.workspace_id,
            project_id=project_id,
            pairs={
                (group_id, entry.tracked_keyword_id)
                for entry, plan in written
                for group_id in plan.item.group_ids
            },
        )
        await repository.add_terms(
            db,
            workspace_id=access.workspace_id,
            pairs={
                (entry.tracked_keyword_id, term.term_id)
                for entry, plan in written
                for term in _terms_to_add(
                    stored.get(entry.tracked_keyword_id, []), plan.item.term_ids, refs
                )
            },
            assigned_by="manual",
        )
        for entry, plan in written:
            if plan.overrides is not None and not entry.restored:
                await repository.replace_overrides(
                    db,
                    workspace_id=access.workspace_id,
                    tracked_keyword_id=entry.tracked_keyword_id,
                    modes=plan.overrides,
                )

    @staticmethod
    async def _merge(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        existing: Sequence[tuple[int, writer.Existing]],
        plans: Mapping[int, _Plan],
        refs: _References,
        info: RequestInfo,
    ) -> None:
        """`on_duplicate: merge_terms`: a duplicate item's groups and terms are added to the
        tracked keyword it duplicates, in the order of the items. A term of a single-valued
        vocabulary is not added when the keyword has, or has just been given, another term of
        that vocabulary."""
        workspace_id = access.workspace_id
        tracked_ids = {entry.tracked_keyword_id for _, entry in existing}
        # Locked before their terms are read, so an assignment to the same keywords cannot
        # slip a term in between the check and the write.
        await repository.lock_rows(db, workspace_id, tracked_ids)
        groups = await repository.groups_of(db, workspace_id, tracked_ids)
        held = await repository.terms_of(db, workspace_id, tracked_ids)
        added_groups: dict[UUID, set[UUID]] = {}
        added_terms: dict[UUID, set[UUID]] = {}
        for index, entry in existing:
            tracked_id = entry.tracked_keyword_id
            item = plans[index].item
            have_groups = {group.group_id for group in groups.get(tracked_id, [])}
            for group_id in item.group_ids:
                if group_id not in have_groups:
                    added_groups.setdefault(tracked_id, set()).add(group_id)
            have_terms = held.setdefault(tracked_id, [])
            for term in _terms_to_add(have_terms, item.term_ids, refs):
                added_terms.setdefault(tracked_id, set()).add(term.term_id)
                have_terms.append(term)
        await repository.add_members(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            pairs={(g, t) for t, ids in added_groups.items() for g in ids},
        )
        await repository.add_terms(
            db,
            workspace_id=workspace_id,
            pairs={(t, term_id) for t, ids in added_terms.items() for term_id in ids},
            assigned_by="manual",
        )
        changed = sorted(set(added_groups) | set(added_terms))
        await audit.record_each(
            db,
            workspace_id=workspace_id,
            actor_id=access.user_id,
            action="tracked_keyword.updated",
            target_type="tracked_keyword",
            info=info,
            entries=[
                audit.Entry(
                    target_id=tracked_id,
                    after={
                        "group_ids_added": sorted(map(str, added_groups.get(tracked_id, ()))),
                        "term_ids_added": sorted(map(str, added_terms.get(tracked_id, ()))),
                    },
                )
                for tracked_id in changed
            ],
        )

    @staticmethod
    async def _audit_created(
        db: AsyncSession,
        access: WorkspaceAccess,
        records: Sequence[TrackedRecord],
        created: Sequence[writer.Created],
        info: RequestInfo,
    ) -> None:
        restored = {entry.tracked_keyword_id for entry in created if entry.restored}
        await audit.record_each(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action="tracked_keyword.created",
            target_type="tracked_keyword",
            info=info,
            entries=[
                audit.Entry(
                    target_id=record.id,
                    after={**_snapshot(record), "restored": record.id in restored},
                )
                for record in records
            ],
        )

    @staticmethod
    async def _tracked(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        *,
        lock: bool = False,
    ) -> TrackedRecord:
        """A live tracked keyword of the project; with `lock`, changes to it wait for this
        one."""
        found = await repository.get_tracked(
            db, access.workspace_id, project_id, tracked_keyword_id, for_update=lock
        )
        if found is None:
            raise NotFoundError
        return found

    @staticmethod
    async def _keyword(
        db: AsyncSession, access: WorkspaceAccess, keyword_id: UUID
    ) -> KeywordRecord:
        found = await repository.get_keyword(
            db, access.workspace_id, keyword_id, visible=access.project_ids
        )
        if found is None:
            raise NotFoundError
        return found


def effective_set(
    defaults: Sequence[CompetitorRecord], overrides: Sequence[OverrideRecord]
) -> list[CompetitorRecord]:
    """The project's SEO competitors, with the keyword's includes added and excludes taken
    away (docs/08-seo-keyword-system.md section 4), by name."""
    excluded = {o.entity.entity_id for o in overrides if o.mode == "exclude"}
    chosen = {entity.entity_id: entity for entity in defaults if entity.entity_id not in excluded}
    for override in overrides:
        if override.mode == "include":
            chosen.setdefault(override.entity.entity_id, override.entity)
    return sorted(
        chosen.values(), key=lambda entity: (entity.canonical_name.lower(), entity.entity_id)
    )


def _override_snapshot(overrides: Sequence[OverrideRecord]) -> dict[str, list[str]]:
    return {
        mode: sorted(str(o.entity.entity_id) for o in overrides if o.mode == mode)
        for mode in ("include", "exclude")
    }
