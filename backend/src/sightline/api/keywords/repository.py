"""Statements for keywords and tracked keywords. Every function runs inside
`workspace_transaction`, and every statement names the workspace as well: row-level security
is the second line, not the first.

`visible` is a member's project scope: None for every project, else the projects the member
may see. A keyword is visible to a member limited to some projects when one of them tracks it.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Integer,
    Row,
    Select,
    Text,
    Uuid,
    and_,
    any_,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import (
    domains,
    entities,
    keyword_group_members,
    keyword_groups,
    keyword_metric_snapshots,
    keyword_metrics_current,
    keywords,
    locations,
    project_entities,
    projects,
    schedules,
    taxonomy_terms,
    taxonomy_vocabularies,
    tracked_keyword_competitors,
    tracked_keyword_config_history,
    tracked_keyword_terms,
    tracked_keywords,
    urls,
    users,
)

LABS = "dataforseo_labs"
# The current Labs metrics of a tracked keyword's keyword, location and language: what the list
# filters and sorts by.
LABS_CURRENT = keyword_metrics_current.alias("labs_current")
# Rows per multi-row insert of links: 4 parameters a row stays well under the 32,767 a
# statement may carry.
LINKS_PER_STATEMENT: Final = 5000


def among_ids(column: ColumnElement[UUID], ids: Collection[UUID]) -> ColumnElement[bool]:
    """`column = ANY($1)`: one array parameter however many ids, so a long list never reaches
    the driver's parameter limit."""
    return column == any_(literal(list(ids), type_=ARRAY(Uuid)))


def _among_ints(column: ColumnElement[int], values: Collection[int]) -> ColumnElement[bool]:
    return column == any_(literal(list(values), type_=ARRAY(Integer)))


@dataclass(frozen=True, slots=True)
class UrlRecord:
    url_id: int
    canonical_url: str
    host: str
    registrable_domain: str
    path: str


@dataclass(frozen=True, slots=True)
class UserRecord:
    user_id: UUID
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class KeywordRecord:
    id: UUID
    text: str
    normalized_text: str
    language_code: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class TrackedRecord:
    id: UUID
    project_id: UUID
    keyword: KeywordRecord
    search_engine: str
    location_id: int
    location_name: str
    location_country: str
    location_type: str
    language_code: str
    device: str
    os: str | None
    config_version: int
    depth_profile: str
    target_url: UrlRecord | None
    intent: str
    intent_source: str | None
    funnel_stage: str
    priority: int
    business_value: Decimal | None
    frequency: str
    schedule_id: UUID | None
    source: str
    is_active: bool
    created_by: UserRecord | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class MetricsRecord:
    keyword_id: UUID
    location_id: int
    language_code: str
    source: str
    fetched_at: datetime
    data_month: date | None
    search_volume: int | None
    monthly_searches: list[dict[str, object]]
    cpc_usd: Decimal | None
    competition: Decimal | None
    competition_level: str | None
    keyword_difficulty: int | None
    intent_main: str | None


@dataclass(frozen=True, slots=True)
class SnapshotRecord:
    id: int
    fetched_at: datetime
    data_month: date | None
    search_volume: int | None
    monthly_searches: list[dict[str, object]]
    cpc_usd: Decimal | None
    keyword_difficulty: int | None
    is_material_change: bool


@dataclass(frozen=True, slots=True)
class GroupRecord:
    group_id: UUID
    name: str
    path: str


@dataclass(frozen=True, slots=True)
class TermRecord:
    term_id: UUID
    vocabulary_id: UUID
    vocabulary_kind: str
    name: str
    path: str
    is_single_valued: bool


@dataclass(frozen=True, slots=True)
class CompetitorRecord:
    entity_id: UUID
    canonical_name: str
    entity_type: str
    role: str | None
    color_index: int | None


@dataclass(frozen=True, slots=True)
class OverrideRecord:
    entity: CompetitorRecord
    mode: str


@dataclass(frozen=True, slots=True)
class ConfigRecord:
    config_version: int
    depth_profile: str
    target_url: UrlRecord | None
    valid_from: datetime
    valid_to: datetime | None
    changed_by: UserRecord | None
    change_reason: str | None


@dataclass(frozen=True, slots=True)
class ProjectDefaults:
    location_id: int | None
    language_code: str | None
    settings: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class ScheduleRecord:
    schedule_id: UUID
    name: str
    next_run_at: datetime


@dataclass(frozen=True, slots=True)
class VariantRecord:
    tracked_keyword_id: UUID
    project_id: UUID
    location_id: int
    language_code: str
    device: str
    is_active: bool


# Projects.


async def project_defaults(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> ProjectDefaults | None:
    row = (
        await db.execute(
            select(
                projects.c.default_location_id,
                projects.c.default_language_code,
                projects.c.settings,
            ).where(
                projects.c.workspace_id == workspace_id,
                projects.c.id == project_id,
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return ProjectDefaults(
        location_id=row.default_location_id,
        language_code=row.default_language_code,
        settings=row.settings or {},
    )


async def active_locations(db: AsyncSession, location_ids: Collection[int]) -> set[int]:
    rows = await db.execute(
        select(locations.c.id).where(
            _among_ints(locations.c.id, location_ids), locations.c.is_active
        )
    )
    return {row.id for row in rows}


async def rank_schedules(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, schedule_ids: Collection[UUID]
) -> set[UUID]:
    """The project's live rank schedules among these: what a tracked keyword may name."""
    rows = await db.execute(
        select(schedules.c.id).where(
            schedules.c.workspace_id == workspace_id,
            schedules.c.project_id == project_id,
            among_ids(schedules.c.id, schedule_ids),
            schedules.c.workload == "seo_rank",
            schedules.c.deleted_at.is_(None),
        )
    )
    return {row.id for row in rows}


async def project_groups(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, group_ids: Collection[UUID]
) -> set[UUID]:
    rows = await db.execute(
        select(keyword_groups.c.id).where(
            keyword_groups.c.workspace_id == workspace_id,
            keyword_groups.c.project_id == project_id,
            among_ids(keyword_groups.c.id, group_ids),
        )
    )
    return {row.id for row in rows}


def _project_vocabulary(project_id: UUID) -> ColumnElement[bool]:
    """A vocabulary the project may use: workspace-wide, or its own."""
    return or_(
        taxonomy_vocabularies.c.project_id.is_(None),
        taxonomy_vocabularies.c.project_id == project_id,
    )


async def project_terms(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, term_ids: Collection[UUID]
) -> list[TermRecord]:
    """The terms among these that the project may use. Their vocabularies are held (FOR
    SHARE) until the transaction ends, so a vocabulary cannot become single-valued between the
    check of an assignment and its write."""
    if not term_ids:
        return []
    rows = await db.execute(
        _terms()
        .where(
            taxonomy_terms.c.workspace_id == workspace_id,
            among_ids(taxonomy_terms.c.id, term_ids),
            _project_vocabulary(project_id),
        )
        .with_for_update(of=taxonomy_vocabularies, read=True)
    )
    return [_term(row) for row in rows]


def _terms() -> Select[tuple[object, ...]]:
    """Terms with what a reference to one shows and the rule of their vocabulary."""
    return select(
        taxonomy_terms.c.id.label("term_id"),
        taxonomy_terms.c.vocabulary_id,
        taxonomy_vocabularies.c.kind.label("vocabulary_kind"),
        taxonomy_terms.c.name.label("term_name"),
        taxonomy_terms.c.path.label("term_path"),
        taxonomy_vocabularies.c.is_single_valued,
    ).join(
        taxonomy_vocabularies,
        and_(
            taxonomy_vocabularies.c.id == taxonomy_terms.c.vocabulary_id,
            taxonomy_vocabularies.c.workspace_id == taxonomy_terms.c.workspace_id,
        ),
    )


def _term(row: Row[tuple[object, ...]]) -> TermRecord:
    return TermRecord(
        term_id=row.term_id,
        vocabulary_id=row.vocabulary_id,
        vocabulary_kind=row.vocabulary_kind,
        name=row.term_name,
        path=row.term_path,
        is_single_valued=row.is_single_valued,
    )


async def entities_with_role(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, entity_ids: Collection[UUID]
) -> set[UUID]:
    """The entities among these that the project gives a live role."""
    rows = await db.execute(
        select(project_entities.c.entity_id).where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.project_id == project_id,
            among_ids(project_entities.c.entity_id, entity_ids),
            project_entities.c.removed_at.is_(None),
        )
    )
    return {row.entity_id for row in rows}


# Tracked keywords.


def _tracked(workspace_id: UUID) -> Select[tuple[object, ...]]:
    t = tracked_keywords.c
    return (
        select(
            t.id,
            t.project_id,
            t.keyword_id,
            keywords.c.text.label("keyword_text"),
            keywords.c.normalized_text,
            keywords.c.created_at.label("keyword_created_at"),
            t.search_engine,
            t.location_id,
            locations.c.name.label("location_name"),
            locations.c.country_iso,
            locations.c.location_type,
            t.language_code,
            t.device,
            t.os,
            t.config_version,
            t.depth_profile,
            t.target_url_id,
            urls.c.canonical_url,
            urls.c.path.label("url_path"),
            domains.c.host.label("url_host"),
            domains.c.registrable_domain.label("url_registrable_domain"),
            t.intent,
            t.intent_source,
            t.funnel_stage,
            t.priority,
            t.business_value,
            t.frequency,
            t.schedule_id,
            t.source,
            t.is_active,
            t.created_by,
            users.c.name.label("created_by_name"),
            users.c.email.label("created_by_email"),
            t.created_at,
            t.updated_at,
        )
        .select_from(
            tracked_keywords.join(
                keywords,
                and_(keywords.c.id == t.keyword_id, keywords.c.workspace_id == t.workspace_id),
            )
            .join(
                projects,
                and_(projects.c.id == t.project_id, projects.c.workspace_id == t.workspace_id),
            )
            .join(locations, locations.c.id == t.location_id)
            .outerjoin(urls, urls.c.id == t.target_url_id)
            .outerjoin(domains, domains.c.id == urls.c.domain_id)
            .outerjoin(users, users.c.id == t.created_by)
        )
        # A deleted project's keywords are gone with it (plan decision D4).
        .where(
            t.workspace_id == workspace_id,
            t.deleted_at.is_(None),
            projects.c.deleted_at.is_(None),
        )
    )


def _url(row: Row[tuple[object, ...]], id_column: str, prefix: str) -> UrlRecord | None:
    fields = row._mapping
    url_id = fields[id_column]
    if url_id is None:
        return None
    return UrlRecord(
        url_id=url_id,
        canonical_url=fields[f"{prefix}canonical_url"],
        host=fields[f"{prefix}url_host"],
        registrable_domain=fields[f"{prefix}url_registrable_domain"],
        path=fields[f"{prefix}url_path"],
    )


def _user(row: Row[tuple[object, ...]], id_column: str, prefix: str) -> UserRecord | None:
    fields = row._mapping
    user_id = fields[id_column]
    if user_id is None or fields[f"{prefix}_name"] is None:
        return None
    return UserRecord(
        user_id=user_id, name=fields[f"{prefix}_name"], email=fields[f"{prefix}_email"]
    )


def tracked_record(row: Row[tuple[object, ...]]) -> TrackedRecord:
    fields = row._mapping
    return TrackedRecord(
        id=fields["id"],
        project_id=fields["project_id"],
        keyword=KeywordRecord(
            id=fields["keyword_id"],
            text=fields["keyword_text"],
            normalized_text=fields["normalized_text"],
            language_code=fields["language_code"],
            created_at=fields["keyword_created_at"],
        ),
        search_engine=fields["search_engine"],
        location_id=fields["location_id"],
        location_name=fields["location_name"],
        location_country=fields["country_iso"],
        location_type=fields["location_type"],
        language_code=fields["language_code"],
        device=fields["device"],
        os=fields["os"],
        config_version=fields["config_version"],
        depth_profile=fields["depth_profile"],
        target_url=_url(row, "target_url_id", ""),
        intent=fields["intent"],
        intent_source=fields["intent_source"],
        funnel_stage=fields["funnel_stage"],
        priority=fields["priority"],
        business_value=fields["business_value"],
        frequency=fields["frequency"],
        schedule_id=fields["schedule_id"],
        source=fields["source"],
        is_active=fields["is_active"],
        created_by=_user(row, "created_by", "created_by"),
        created_at=fields["created_at"],
        updated_at=fields["updated_at"],
    )


async def get_tracked(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    tracked_keyword_id: UUID,
    *,
    for_update: bool = False,
) -> TrackedRecord | None:
    statement = _tracked(workspace_id).where(
        tracked_keywords.c.project_id == project_id, tracked_keywords.c.id == tracked_keyword_id
    )
    if for_update:
        statement = statement.with_for_update(of=tracked_keywords, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else tracked_record(row)


async def tracked_by_ids(
    db: AsyncSession, workspace_id: UUID, ids: Sequence[UUID]
) -> list[TrackedRecord]:
    """In the order of `ids`."""
    rows = await db.execute(_tracked(workspace_id).where(among_ids(tracked_keywords.c.id, ids)))
    found = {record.id: record for record in map(tracked_record, rows)}
    return [found[tracked_id] for tracked_id in ids if tracked_id in found]


# The list and bulk changes.


def _listed(workspace_id: UUID) -> Select[tuple[object, ...]]:
    """`_tracked` with the keyword's current Labs metrics, which the list filters and sorts by."""
    t = tracked_keywords.c
    return _tracked(workspace_id).outerjoin(
        LABS_CURRENT,
        and_(
            LABS_CURRENT.c.keyword_id == t.keyword_id,
            LABS_CURRENT.c.location_id == t.location_id,
            LABS_CURRENT.c.language_code == t.language_code,
            LABS_CURRENT.c.workspace_id == t.workspace_id,
            LABS_CURRENT.c.source == LABS,
        ),
    )


async def list_tracked(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    conditions: Sequence[ColumnElement[bool]],
    order: Sequence[ColumnElement[Any]],
    key: Sequence[ColumnElement[Any]],
    after: ColumnElement[bool] | None,
    limit: int,
) -> list[tuple[TrackedRecord, list[object]]]:
    """A page of the list, each row with the values of its sort `key`."""
    statement = (
        _listed(workspace_id)
        .add_columns(*(column.label(f"sort_key_{n}") for n, column in enumerate(key)))
        .where(*conditions)
    )
    if after is not None:
        statement = statement.where(after)
    rows = await db.execute(statement.order_by(*order).limit(limit))
    return [
        (tracked_record(row), [row._mapping[f"sort_key_{n}"] for n in range(len(key))])
        for row in rows
    ]


async def count_tracked(
    db: AsyncSession, workspace_id: UUID, conditions: Sequence[ColumnElement[bool]]
) -> int:
    count: int = (
        await db.execute(
            _listed(workspace_id)
            .with_only_columns(func.count(), maintain_column_froms=False)
            .where(*conditions)
        )
    ).scalar_one()
    return count


async def lock_subjects(
    db: AsyncSession, workspace_id: UUID, conditions: Sequence[ColumnElement[bool]], limit: int
) -> list[UUID]:
    """The ids of the matching rows, at most `limit`, locked in id order so that two bulk
    changes over the same rows wait for each other instead of deadlocking."""
    rows = await db.execute(
        _listed(workspace_id)
        .with_only_columns(tracked_keywords.c.id, maintain_column_froms=False)
        .where(*conditions)
        .order_by(tracked_keywords.c.id)
        .limit(limit)
        .with_for_update(of=tracked_keywords, key_share=True)
    )
    return [row.id for row in rows]


async def vocabularies_of(
    db: AsyncSession, workspace_id: UUID, term_ids: Collection[UUID]
) -> dict[UUID, UUID]:
    """The vocabulary of each of these terms that exists in the workspace."""
    rows = await db.execute(
        select(taxonomy_terms.c.id, taxonomy_terms.c.vocabulary_id).where(
            taxonomy_terms.c.workspace_id == workspace_id, among_ids(taxonomy_terms.c.id, term_ids)
        )
    )
    return {row.id: row.vocabulary_id for row in rows}


async def count_inactive(db: AsyncSession, workspace_id: UUID, ids: Collection[UUID]) -> int:
    count: int = (
        await db.execute(
            select(func.count()).where(
                tracked_keywords.c.workspace_id == workspace_id,
                among_ids(tracked_keywords.c.id, ids),
                tracked_keywords.c.is_active.is_(False),
            )
        )
    ).scalar_one()
    return count


async def set_fields(
    db: AsyncSession,
    workspace_id: UUID,
    ids: Collection[UUID],
    values: Mapping[str, object],
    now: datetime,
) -> set[UUID]:
    """Sets `values` on the rows among `ids` where one of them differs; the ids changed."""
    if not ids or not values:
        return set()
    t = tracked_keywords.c
    rows = await db.execute(
        update(tracked_keywords)
        .where(
            t.workspace_id == workspace_id,
            among_ids(t.id, ids),
            or_(*(t[name].is_distinct_from(value) for name, value in values.items())),
        )
        .values(**values, updated_at=now)
        .returning(t.id)
    )
    return {row.id for row in rows}


async def new_config_versions(
    db: AsyncSession,
    workspace_id: UUID,
    ids: Collection[UUID],
    *,
    depth_profile: str | None,
    target_url_id: int | None,
    set_target: bool,
    changed_by: UUID,
    change_reason: str | None,
    now: datetime,
) -> set[UUID]:
    """A new configuration version, with its history row, for each row among `ids` whose depth
    profile or target URL differs from the given ones (the target only with `set_target`). The
    previous version ends when the new one begins, never before it began."""
    t = tracked_keywords.c
    values: dict[str, object] = {}
    differs: list[ColumnElement[bool]] = []
    if depth_profile is not None:
        values["depth_profile"] = depth_profile
        differs.append(t.depth_profile.is_distinct_from(depth_profile))
    if set_target:
        values["target_url_id"] = target_url_id
        differs.append(t.target_url_id.is_distinct_from(target_url_id))
    if not ids or not values:
        return set()
    changed = {
        row.id
        for row in await db.execute(
            update(tracked_keywords)
            .where(t.workspace_id == workspace_id, among_ids(t.id, ids), or_(*differs))
            .values(**values, config_version=t.config_version + 1, updated_at=now)
            .returning(t.id)
        )
    }
    if not changed:
        return changed
    history = tracked_keyword_config_history
    h = history.c
    await db.execute(
        update(history)
        .where(
            h.workspace_id == workspace_id,
            among_ids(h.tracked_keyword_id, changed),
            h.valid_to.is_(None),
        )
        .values(valid_to=func.greatest(literal(now), h.valid_from))
    )
    previous = history.alias("previous")
    ended = (
        select(previous.c.valid_to)
        .where(
            previous.c.tracked_keyword_id == t.id,
            previous.c.workspace_id == t.workspace_id,
            previous.c.config_version == t.config_version - 1,
        )
        .scalar_subquery()
    )
    await db.execute(
        insert(history).from_select(
            [
                "tracked_keyword_id",
                "workspace_id",
                "config_version",
                "depth_profile",
                "target_url_id",
                "valid_from",
                "changed_by",
                "change_reason",
            ],
            select(
                t.id,
                t.workspace_id,
                t.config_version,
                t.depth_profile,
                t.target_url_id,
                func.coalesce(ended, literal(now)),
                literal(changed_by, Uuid),
                literal(change_reason, Text),
            ).where(t.workspace_id == workspace_id, among_ids(t.id, changed)),
        )
    )
    return changed


async def remove_members(
    db: AsyncSession, workspace_id: UUID, ids: Collection[UUID], group_ids: Collection[UUID]
) -> set[UUID]:
    """Takes the rows among `ids` out of these groups; the ids changed."""
    if not ids or not group_ids:
        return set()
    m = keyword_group_members.c
    rows = await db.execute(
        delete(keyword_group_members)
        .where(
            m.workspace_id == workspace_id,
            among_ids(m.tracked_keyword_id, ids),
            among_ids(m.group_id, group_ids),
        )
        .returning(m.tracked_keyword_id)
    )
    return {row.tracked_keyword_id for row in rows}


async def add_members_to(
    db: AsyncSession, workspace_id: UUID, ids: Collection[UUID], group_ids: Collection[UUID]
) -> set[UUID]:
    """Puts the rows among `ids` in these groups of their project; the ids changed."""
    if not ids or not group_ids:
        return set()
    t, g, m = tracked_keywords.c, keyword_groups.c, keyword_group_members.c
    rows = await db.execute(
        upsert(keyword_group_members)
        .from_select(
            ["group_id", "tracked_keyword_id", "project_id", "workspace_id"],
            select(g.id, t.id, t.project_id, t.workspace_id)
            .select_from(
                tracked_keywords.join(
                    keyword_groups,
                    and_(g.project_id == t.project_id, g.workspace_id == t.workspace_id),
                )
            )
            .where(
                t.workspace_id == workspace_id,
                among_ids(t.id, ids),
                among_ids(g.id, group_ids),
            ),
        )
        .on_conflict_do_nothing()
        .returning(m.tracked_keyword_id)
    )
    return {row.tracked_keyword_id for row in rows}


async def remove_terms(
    db: AsyncSession, workspace_id: UUID, ids: Collection[UUID], term_ids: Collection[UUID]
) -> list[UUID]:
    """Takes these terms from the rows among `ids`: the row's id for each term taken."""
    if not ids or not term_ids:
        return []
    k = tracked_keyword_terms.c
    rows = await db.execute(
        delete(tracked_keyword_terms)
        .where(
            k.workspace_id == workspace_id,
            among_ids(k.tracked_keyword_id, ids),
            among_ids(k.term_id, term_ids),
        )
        .returning(k.tracked_keyword_id)
    )
    return [row.tracked_keyword_id for row in rows]


async def drop_other_terms(
    db: AsyncSession,
    workspace_id: UUID,
    ids: Collection[UUID],
    term_ids: Collection[UUID],
    *,
    single_valued_only: bool,
) -> list[UUID]:
    """Takes from the rows among `ids` their terms of the vocabularies of `term_ids` that are
    not among them (only of the single-valued ones with `single_valued_only`), so the given
    terms can take their place: the row's id for each term taken."""
    if not ids or not term_ids:
        return []
    k, terms, vocabularies = tracked_keyword_terms.c, taxonomy_terms.c, taxonomy_vocabularies.c
    touched = (
        select(terms.vocabulary_id)
        .join(
            taxonomy_vocabularies,
            and_(
                vocabularies.id == terms.vocabulary_id,
                vocabularies.workspace_id == terms.workspace_id,
            ),
        )
        .where(terms.workspace_id == workspace_id, among_ids(terms.id, term_ids))
    )
    if single_valued_only:
        touched = touched.where(vocabularies.is_single_valued)
    rows = await db.execute(
        delete(tracked_keyword_terms)
        .where(
            k.workspace_id == workspace_id,
            among_ids(k.tracked_keyword_id, ids),
            ~among_ids(k.term_id, term_ids),
            k.term_id.in_(
                select(terms.id).where(
                    terms.workspace_id == workspace_id, terms.vocabulary_id.in_(touched)
                )
            ),
        )
        .returning(k.tracked_keyword_id)
    )
    return [row.tracked_keyword_id for row in rows]


async def add_terms_to(
    db: AsyncSession,
    workspace_id: UUID,
    ids: Collection[UUID],
    term_ids: Collection[UUID],
    *,
    assigned_by: str,
) -> list[UUID]:
    """Gives the rows among `ids` these terms: the row's id for each term given."""
    if not ids or not term_ids:
        return []
    t, terms, k = tracked_keywords.c, taxonomy_terms.c, tracked_keyword_terms.c
    rows = await db.execute(
        upsert(tracked_keyword_terms)
        .from_select(
            ["tracked_keyword_id", "term_id", "workspace_id", "assigned_by"],
            select(t.id, terms.id, t.workspace_id, literal(assigned_by, Text))
            .select_from(
                tracked_keywords.join(taxonomy_terms, terms.workspace_id == t.workspace_id)
            )
            .where(
                t.workspace_id == workspace_id,
                among_ids(t.id, ids),
                among_ids(terms.id, term_ids),
            ),
        )
        .on_conflict_do_nothing()
        .returning(k.tracked_keyword_id)
    )
    return [row.tracked_keyword_id for row in rows]


async def update_tracked(
    db: AsyncSession, workspace_id: UUID, tracked_keyword_id: UUID, values: Mapping[str, object]
) -> None:
    await db.execute(
        update(tracked_keywords)
        .where(
            tracked_keywords.c.workspace_id == workspace_id,
            tracked_keywords.c.id == tracked_keyword_id,
        )
        .values(**values)
    )


async def new_config_version(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    tracked_keyword_id: UUID,
    version: int,
    depth_profile: str,
    target_url_id: int | None,
    changed_by: UUID,
    change_reason: str | None,
    now: datetime,
) -> None:
    """Ends the current version and starts the next, at `now` or at the current version's
    start if that is later: API instances' clocks may differ a little, and a version never ends
    before it began."""
    history = tracked_keyword_config_history.c
    ended = (
        await db.execute(
            update(tracked_keyword_config_history)
            .where(
                history.workspace_id == workspace_id,
                history.tracked_keyword_id == tracked_keyword_id,
                history.valid_to.is_(None),
            )
            .values(valid_to=func.greatest(literal(now), history.valid_from))
            .returning(history.valid_to)
        )
    ).scalar_one_or_none()
    await db.execute(
        insert(tracked_keyword_config_history).values(
            tracked_keyword_id=tracked_keyword_id,
            workspace_id=workspace_id,
            config_version=version,
            depth_profile=depth_profile,
            target_url_id=target_url_id,
            valid_from=now if ended is None else ended,
            changed_by=changed_by,
            change_reason=change_reason,
        )
    )


async def config_history(
    db: AsyncSession, workspace_id: UUID, tracked_keyword_id: UUID
) -> list[ConfigRecord]:
    history = tracked_keyword_config_history.c
    rows = await db.execute(
        select(
            history.config_version,
            history.depth_profile,
            history.target_url_id,
            urls.c.canonical_url,
            urls.c.path.label("url_path"),
            domains.c.host.label("url_host"),
            domains.c.registrable_domain.label("url_registrable_domain"),
            history.valid_from,
            history.valid_to,
            history.changed_by,
            users.c.name.label("changed_by_name"),
            users.c.email.label("changed_by_email"),
            history.change_reason,
        )
        .select_from(
            tracked_keyword_config_history.outerjoin(urls, urls.c.id == history.target_url_id)
            .outerjoin(domains, domains.c.id == urls.c.domain_id)
            .outerjoin(users, users.c.id == history.changed_by)
        )
        .where(
            history.workspace_id == workspace_id,
            history.tracked_keyword_id == tracked_keyword_id,
        )
        .order_by(history.config_version)
    )
    return [
        ConfigRecord(
            config_version=row.config_version,
            depth_profile=row.depth_profile,
            target_url=_url(row, "target_url_id", ""),
            valid_from=row.valid_from,
            valid_to=row.valid_to,
            changed_by=_user(row, "changed_by", "changed_by"),
            change_reason=row.change_reason,
        )
        for row in rows
    ]


async def schedule_ref(
    db: AsyncSession, workspace_id: UUID, schedule_id: UUID
) -> ScheduleRecord | None:
    row = (
        await db.execute(
            select(schedules.c.id, schedules.c.name, schedules.c.next_run_at).where(
                schedules.c.workspace_id == workspace_id, schedules.c.id == schedule_id
            )
        )
    ).one_or_none()
    return None if row is None else ScheduleRecord(row.id, row.name, row.next_run_at)


# Links.


async def add_members(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    pairs: Collection[tuple[UUID, UUID]],
) -> int:
    """(group, tracked keyword) pairs; those that exist are left. How many were added."""
    rows = [
        {
            "group_id": group_id,
            "tracked_keyword_id": tracked_id,
            "project_id": project_id,
            "workspace_id": workspace_id,
        }
        for group_id, tracked_id in sorted(pairs)
    ]
    added = 0
    for start in range(0, len(rows), LINKS_PER_STATEMENT):
        result = await db.execute(
            upsert(keyword_group_members)
            .values(rows[start : start + LINKS_PER_STATEMENT])
            .on_conflict_do_nothing()
            .returning(keyword_group_members.c.group_id)
        )
        added += len(result.all())
    return added


async def add_terms(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    pairs: Collection[tuple[UUID, UUID]],
    assigned_by: str,
) -> int:
    """(tracked keyword, term) pairs; those that exist are left. How many were added."""
    rows = [
        {
            "tracked_keyword_id": tracked_id,
            "term_id": term_id,
            "workspace_id": workspace_id,
            "assigned_by": assigned_by,
        }
        for tracked_id, term_id in sorted(pairs)
    ]
    added = 0
    for start in range(0, len(rows), LINKS_PER_STATEMENT):
        result = await db.execute(
            upsert(tracked_keyword_terms)
            .values(rows[start : start + LINKS_PER_STATEMENT])
            .on_conflict_do_nothing()
            .returning(tracked_keyword_terms.c.term_id)
        )
        added += len(result.all())
    return added


async def replace_overrides(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    tracked_keyword_id: UUID,
    modes: Mapping[UUID, str],
) -> None:
    await db.execute(
        delete(tracked_keyword_competitors).where(
            tracked_keyword_competitors.c.workspace_id == workspace_id,
            tracked_keyword_competitors.c.tracked_keyword_id == tracked_keyword_id,
        )
    )
    if modes:
        await db.execute(
            insert(tracked_keyword_competitors).values(
                [
                    {
                        "tracked_keyword_id": tracked_keyword_id,
                        "entity_id": entity_id,
                        "workspace_id": workspace_id,
                        "mode": mode,
                    }
                    for entity_id, mode in modes.items()
                ]
            )
        )


async def groups_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[GroupRecord]]:
    rows = await db.execute(
        select(
            keyword_group_members.c.tracked_keyword_id,
            keyword_groups.c.id,
            keyword_groups.c.name,
            keyword_groups.c.path,
        )
        .join(
            keyword_groups,
            and_(
                keyword_groups.c.id == keyword_group_members.c.group_id,
                keyword_groups.c.workspace_id == keyword_group_members.c.workspace_id,
            ),
        )
        .where(
            keyword_group_members.c.workspace_id == workspace_id,
            among_ids(keyword_group_members.c.tracked_keyword_id, tracked_ids),
        )
        .order_by(keyword_groups.c.path, keyword_groups.c.id)
    )
    found: dict[UUID, list[GroupRecord]] = {}
    for row in rows:
        found.setdefault(row.tracked_keyword_id, []).append(GroupRecord(row.id, row.name, row.path))
    return found


async def terms_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[TermRecord]]:
    rows = await db.execute(
        _terms()
        .add_columns(tracked_keyword_terms.c.tracked_keyword_id)
        .join(
            tracked_keyword_terms,
            and_(
                tracked_keyword_terms.c.term_id == taxonomy_terms.c.id,
                tracked_keyword_terms.c.workspace_id == taxonomy_terms.c.workspace_id,
            ),
        )
        .where(
            tracked_keyword_terms.c.workspace_id == workspace_id,
            among_ids(tracked_keyword_terms.c.tracked_keyword_id, tracked_ids),
        )
        .order_by(taxonomy_terms.c.vocabulary_id, taxonomy_terms.c.path, taxonomy_terms.c.id)
    )
    found: dict[UUID, list[TermRecord]] = {}
    for row in rows:
        found.setdefault(row.tracked_keyword_id, []).append(_term(row))
    return found


def _entity_ref(project_id: UUID) -> Select[tuple[object, ...]]:
    """Entities with their live role in the project, if any."""
    return select(
        entities.c.id,
        entities.c.canonical_name,
        entities.c.entity_type,
        project_entities.c.role,
        project_entities.c.color_index,
    ).outerjoin(
        project_entities,
        and_(
            project_entities.c.entity_id == entities.c.id,
            project_entities.c.workspace_id == entities.c.workspace_id,
            project_entities.c.project_id == project_id,
            project_entities.c.removed_at.is_(None),
        ),
    )


def _competitor(row: Row[tuple[object, ...]]) -> CompetitorRecord:
    return CompetitorRecord(row.id, row.canonical_name, row.entity_type, row.role, row.color_index)


async def overrides_of(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[OverrideRecord]]:
    statement = (
        _entity_ref(project_id)
        .add_columns(
            tracked_keyword_competitors.c.tracked_keyword_id, tracked_keyword_competitors.c.mode
        )
        .join(
            tracked_keyword_competitors,
            and_(
                tracked_keyword_competitors.c.entity_id == entities.c.id,
                tracked_keyword_competitors.c.workspace_id == entities.c.workspace_id,
            ),
        )
        .where(
            tracked_keyword_competitors.c.workspace_id == workspace_id,
            among_ids(tracked_keyword_competitors.c.tracked_keyword_id, tracked_ids),
        )
        .order_by(func.lower(entities.c.canonical_name), entities.c.id)
    )
    found: dict[UUID, list[OverrideRecord]] = {}
    for row in await db.execute(statement):
        found.setdefault(row.tracked_keyword_id, []).append(
            OverrideRecord(_competitor(row), row.mode)
        )
    return found


async def project_competitors(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> list[CompetitorRecord]:
    """The project's default competitor set: live `competitor` roles tracked in SEO."""
    statement = (
        _entity_ref(project_id)
        .where(
            entities.c.workspace_id == workspace_id,
            project_entities.c.role == "competitor",
            project_entities.c.track_seo,
        )
        .order_by(func.lower(entities.c.canonical_name), entities.c.id)
    )
    return [_competitor(row) for row in await db.execute(statement)]


async def config_counts(db: AsyncSession, workspace_id: UUID, tracked_keyword_id: UUID) -> int:
    count: int = (
        await db.execute(
            select(func.count()).where(
                tracked_keyword_config_history.c.workspace_id == workspace_id,
                tracked_keyword_config_history.c.tracked_keyword_id == tracked_keyword_id,
            )
        )
    ).scalar_one()
    return count


# Metrics.


def _metrics(row: Row[tuple[object, ...]]) -> MetricsRecord:
    return MetricsRecord(
        keyword_id=row.keyword_id,
        location_id=row.location_id,
        language_code=row.language_code,
        source=row.source,
        fetched_at=row.fetched_at,
        data_month=row.data_month,
        search_volume=row.search_volume,
        monthly_searches=list(row.monthly_searches),
        cpc_usd=row.cpc_usd,
        competition=row.competition,
        competition_level=row.competition_level,
        keyword_difficulty=row.keyword_difficulty,
        intent_main=row.intent_main,
    )


def _current() -> Select[tuple[object, ...]]:
    s = keyword_metric_snapshots.c
    return select(
        s.keyword_id,
        s.location_id,
        s.language_code,
        s.source,
        s.fetched_at,
        s.data_month,
        s.search_volume,
        s.monthly_searches,
        s.cpc_usd,
        s.competition,
        s.competition_level,
        s.keyword_difficulty,
        s.intent_main,
    ).join(
        keyword_metrics_current,
        and_(
            keyword_metrics_current.c.snapshot_id == s.id,
            keyword_metrics_current.c.workspace_id == s.workspace_id,
        ),
    )


async def current_metrics(
    db: AsyncSession,
    workspace_id: UUID,
    keys: Collection[tuple[UUID, int, str]],
    *,
    source: str = LABS,
) -> dict[tuple[UUID, int, str], MetricsRecord]:
    """The current metrics of (keyword, location, language) keys, from one source."""
    if not keys:
        return {}
    current = keyword_metrics_current.c
    rows = await db.execute(
        _current().where(
            current.workspace_id == workspace_id,
            current.source == source,
            tuple_(current.keyword_id, current.location_id, current.language_code).in_(list(keys)),
        )
    )
    return {(row.keyword_id, row.location_id, row.language_code): _metrics(row) for row in rows}


async def keyword_metrics(
    db: AsyncSession, workspace_id: UUID, keyword_id: UUID
) -> list[MetricsRecord]:
    """A keyword's current metrics at every location and source."""
    current = keyword_metrics_current.c
    rows = await db.execute(
        _current()
        .where(current.workspace_id == workspace_id, current.keyword_id == keyword_id)
        .order_by(current.location_id, current.language_code, current.source)
    )
    return [_metrics(row) for row in rows]


async def snapshots(
    db: AsyncSession,
    workspace_id: UUID,
    keyword_id: UUID,
    *,
    location_id: int,
    language_code: str,
    source: str,
    since: date | None,
    until: date | None,
) -> list[SnapshotRecord]:
    s = keyword_metric_snapshots.c
    statement = select(
        s.id,
        s.fetched_at,
        s.data_month,
        s.search_volume,
        s.monthly_searches,
        s.cpc_usd,
        s.keyword_difficulty,
        s.is_material_change,
    ).where(
        s.workspace_id == workspace_id,
        s.keyword_id == keyword_id,
        s.location_id == location_id,
        s.language_code == language_code,
        s.source == source,
    )
    if since is not None:
        statement = statement.where(func.date(func.timezone("UTC", s.fetched_at)) >= since)
    if until is not None:
        statement = statement.where(func.date(func.timezone("UTC", s.fetched_at)) <= until)
    rows = await db.execute(statement.order_by(s.fetched_at, s.id))
    return [
        SnapshotRecord(
            id=row.id,
            fetched_at=row.fetched_at,
            data_month=row.data_month,
            search_volume=row.search_volume,
            monthly_searches=list(row.monthly_searches),
            cpc_usd=row.cpc_usd,
            keyword_difficulty=row.keyword_difficulty,
            is_material_change=row.is_material_change,
        )
        for row in rows
    ]


# Keywords.


def _live_project(visible: Collection[UUID] | None) -> ColumnElement[bool]:
    """A tracked keyword of a project that is not deleted and that the member may see."""
    project_alive = exists().where(
        projects.c.id == tracked_keywords.c.project_id,
        projects.c.workspace_id == tracked_keywords.c.workspace_id,
        projects.c.deleted_at.is_(None),
    )
    if visible is None:
        return project_alive
    return and_(project_alive, tracked_keywords.c.project_id.in_(list(visible)))


def _keyword_visible(visible: Collection[UUID] | None) -> ColumnElement[bool]:
    if visible is None:
        return literal(True)
    return exists().where(
        tracked_keywords.c.keyword_id == keywords.c.id,
        tracked_keywords.c.workspace_id == keywords.c.workspace_id,
        tracked_keywords.c.deleted_at.is_(None),
        _live_project(visible),
    )


def _keyword(row: Row[tuple[object, ...]]) -> KeywordRecord:
    return KeywordRecord(
        id=row.id,
        text=row.text,
        normalized_text=row.normalized_text,
        language_code=row.language_code,
        created_at=row.created_at,
    )


async def list_keywords(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    visible: Collection[UUID] | None,
    q: str | None,
    language_code: str | None,
    after: tuple[str, UUID] | None,
    limit: int,
) -> list[KeywordRecord]:
    """By normalized text, after the `(normalized text, id)` key of the previous page."""
    k = keywords.c
    statement = select(k.id, k.text, k.normalized_text, k.language_code, k.created_at).where(
        k.workspace_id == workspace_id, _keyword_visible(visible)
    )
    if q is not None:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        statement = statement.where(k.normalized_text.like(f"%{escaped}%", escape="\\"))
    if language_code is not None:
        statement = statement.where(k.language_code == language_code)
    if after is not None:
        statement = statement.where(
            tuple_(k.normalized_text, k.id) > tuple_(literal(after[0]), literal(after[1]))
        )
    rows = await db.execute(statement.order_by(k.normalized_text, k.id).limit(limit))
    return [_keyword(row) for row in rows]


async def get_keyword(
    db: AsyncSession, workspace_id: UUID, keyword_id: UUID, *, visible: Collection[UUID] | None
) -> KeywordRecord | None:
    k = keywords.c
    row = (
        await db.execute(
            select(k.id, k.text, k.normalized_text, k.language_code, k.created_at).where(
                k.workspace_id == workspace_id, k.id == keyword_id, _keyword_visible(visible)
            )
        )
    ).one_or_none()
    return None if row is None else _keyword(row)


async def variants(
    db: AsyncSession, workspace_id: UUID, keyword_id: UUID, *, visible: Collection[UUID] | None
) -> list[VariantRecord]:
    t = tracked_keywords.c
    rows = await db.execute(
        select(t.id, t.project_id, t.location_id, t.language_code, t.device, t.is_active)
        .where(
            t.workspace_id == workspace_id,
            t.keyword_id == keyword_id,
            t.deleted_at.is_(None),
            _live_project(visible),
        )
        .order_by(t.project_id, t.location_id, t.device, t.id)
    )
    return [
        VariantRecord(
            row.id, row.project_id, row.location_id, row.language_code, row.device, row.is_active
        )
        for row in rows
    ]
