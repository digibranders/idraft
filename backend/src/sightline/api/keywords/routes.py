"""Tracked keyword and workspace keyword routes (docs/19-api-specification.md section 3.6.1).

Reading needs `data:read`; tracking, changing and deleting need `keywords:write`. The membership
dependency has already refused a project outside the caller's scope: it reads the `project_id`
of the path. A member limited to some projects sees the workspace keywords those projects
track, and only their tracked variants.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from sightline.api.keywords import filters, metric_values, rank_views
from sightline.api.keywords.repository import (
    CompetitorRecord,
    ConfigRecord,
    GroupRecord,
    KeywordRecord,
    OverrideRecord,
    TermRecord,
    TrackedRecord,
    UrlRecord,
    UserRecord,
)
from sightline.api.keywords.service import KeywordService
from sightline.api.pagination import Commas, Cursor, CursorPageInfo
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import LanguageCode, LocationRef, QueryText, UserRef
from sightline.api.schemas.entities import EntityRef
from sightline.api.schemas.keywords import (
    AioState,
    BulkArchiveResponse,
    BulkArchiveResult,
    BulkCreateResponse,
    BulkCreateResult,
    BulkDeleteResponse,
    BulkDeleteResult,
    BulkRejected,
    BulkSkipped,
    BulkUpdateResponse,
    BulkUpdateResult,
    CompetitorOverride,
    CompetitorOverrides,
    CompetitorSet,
    CompetitorSetResponse,
    ConfigHistory,
    ConfigVersion,
    DepthProfile,
    Device,
    FunnelStage,
    GroupRef,
    Intent,
    Keyword,
    KeywordDetail,
    KeywordDetailResponse,
    KeywordMetricsHistoryResponse,
    KeywordPage,
    KeywordSource,
    MetricsSource,
    RankChangeLabel,
    ScheduleRef,
    TermRef,
    TrackedInclude,
    TrackedKeyword,
    TrackedKeywordBulkArchive,
    TrackedKeywordBulkCreate,
    TrackedKeywordBulkDelete,
    TrackedKeywordBulkUpdate,
    TrackedKeywordCreate,
    TrackedKeywordDetail,
    TrackedKeywordDetailResponse,
    TrackedKeywordFilter,
    TrackedKeywordList,
    TrackedKeywordPage,
    TrackedKeywordPageInfo,
    TrackedKeywordPatch,
    TrackedKeywordResponse,
    TrackedKeywordRow,
    TrackedVariant,
    UrlRef,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords",
    tags=["keywords"],
)
keywords_router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/keywords", tags=["keywords"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteKeywords = Annotated[WorkspaceAccess, Depends(require_permission(Permission.KEYWORDS_WRITE))]


def get_keyword_service(resources: Annotated[Resources, Depends(get_resources)]) -> KeywordService:
    return resources.keywords


Keywords = Annotated[KeywordService, Depends(get_keyword_service)]


def _user(record: UserRecord | None) -> UserRef | None:
    if record is None:
        return None
    return UserRef(user_id=record.user_id, name=record.name, email=record.email)


def _url(record: UrlRecord | None) -> UrlRef | None:
    if record is None:
        return None
    return UrlRef(
        url_id=str(record.url_id),
        canonical_url=record.canonical_url,
        host=record.host,
        registrable_domain=record.registrable_domain,
        path=record.path,
    )


def _keyword(record: KeywordRecord) -> Keyword:
    return Keyword(
        keyword_id=record.id,
        text=record.text,
        normalized_text=record.normalized_text,
        language_code=record.language_code,
        created_at=record.created_at,
    )


def _entity(record: CompetitorRecord) -> EntityRef:
    return EntityRef.model_validate(
        {
            "entity_id": record.entity_id,
            "canonical_name": record.canonical_name,
            "entity_type": record.entity_type,
            "role": record.role,
            "color_index": record.color_index,
        }
    )


def _override(record: OverrideRecord) -> CompetitorOverride:
    return CompetitorOverride.model_validate(
        {"entity": _entity(record.entity), "mode": record.mode}
    )


def _group(record: GroupRecord) -> GroupRef:
    return GroupRef(group_id=record.group_id, name=record.name, path=record.path)


def _term(record: TermRecord) -> TermRef:
    return TermRef(
        term_id=record.term_id,
        vocabulary_id=record.vocabulary_id,
        vocabulary_kind=record.vocabulary_kind,
        name=record.name,
        path=record.path,
    )


def _tracked_fields(record: TrackedRecord) -> dict[str, object]:
    return {
        "tracked_keyword_id": record.id,
        "project_id": record.project_id,
        "keyword": _keyword(record.keyword),
        "search_engine": record.search_engine,
        "location_id": record.location_id,
        "location": LocationRef(
            location_id=record.location_id,
            name=record.location_name,
            country_iso=record.location_country,
            location_type=record.location_type,
        ),
        "language_code": record.language_code,
        "device": record.device,
        "os": record.os,
        "config_version": record.config_version,
        "depth_profile": record.depth_profile,
        "target_url": _url(record.target_url),
        "intent": record.intent,
        "intent_source": record.intent_source,
        "funnel_stage": record.funnel_stage,
        "priority": record.priority,
        "business_value": record.business_value,
        "frequency": record.frequency,
        "schedule_id": record.schedule_id,
        "source": record.source,
        "is_active": record.is_active,
        "created_by": _user(record.created_by),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def tracked_keyword(record: TrackedRecord) -> TrackedKeyword:
    return TrackedKeyword.model_validate(_tracked_fields(record))


def _config_version(record: ConfigRecord) -> ConfigVersion:
    return ConfigVersion.model_validate(
        {
            "config_version": record.config_version,
            "depth_profile": record.depth_profile,
            "target_url": _url(record.target_url),
            "valid_from": record.valid_from,
            "valid_to": record.valid_to,
            "changed_by": _user(record.changed_by),
            "change_reason": record.change_reason,
        }
    )


# Tracked keywords.


def _query_filter(values: dict[str, object]) -> TrackedKeywordFilter:
    """The list's query parameters as the filter the bulk routes take in a body. What the
    filter refuses (too many values in a list) is a `422` on that parameter."""
    try:
        return TrackedKeywordFilter.model_validate(values)
    except ValidationError as error:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", f"filter[{item['loc'][0]}]"),
                    "type": item["type"],
                    "msg": item["msg"],
                }
                for item in error.errors()
            ]
        ) from None


Include = Annotated[
    list[TrackedInclude] | None,
    Commas,
    Query(description="Blocks to fill: a comma list, or the parameter repeated."),
]


@router.get(
    "",
    summary="The project's tracked keywords",
    description="Sorted by `sort`, a comma list of `keyword`, `search_volume`, "
    "`keyword_difficulty`, `cpc_usd`, `priority`, `created_at`, `current_rank`, `rank_change`, "
    "`best_rank` and `last_observed_at`, each at most once and with `-` for descending; "
    "`keyword` when left out, and the id always last. A metric or a rank sorts keywords without "
    "one (beyond the depth, or never checked) last in both directions. Every row carries its "
    "rank `state`; `include` adds `sparkline`, `competitor_ranks`, `features` and `aio`. "
    "`page.total` counts every match. A cursor is bound to its filters and sort "
    "(`400 invalid_cursor` otherwise).",
)
async def list_tracked_keywords(
    project_id: UUID,
    access: ReadData,
    page: Cursor,
    keywords: Keywords,
    sort: Annotated[str | None, Query(max_length=200)] = None,
    include: Include = None,
    q: Annotated[QueryText | None, Query(alias="filter[q]")] = None,
    group: Annotated[
        UUID | None, Query(alias="filter[group]", description="The group or one under it.")
    ] = None,
    term: Annotated[
        list[UUID] | None,
        Commas,
        Query(
            alias="filter[term]",
            description="Each given term or one under it; terms of one vocabulary: either, of "
            "two: both.",
        ),
    ] = None,
    term_in: Annotated[
        list[UUID] | None,
        Commas,
        Query(alias="filter[term_in]", description="Any of these terms or one under them."),
    ] = None,
    device: Annotated[Device | None, Query(alias="filter[device]")] = None,
    location_id: Annotated[int | None, Query(alias="filter[location_id]")] = None,
    language_code: Annotated[LanguageCode | None, Query(alias="filter[language_code]")] = None,
    search_engine: Annotated[
        Literal["google", "bing"] | None, Query(alias="filter[search_engine]")
    ] = None,
    intent_in: Annotated[list[Intent] | None, Commas, Query(alias="filter[intent_in]")] = None,
    funnel_stage_in: Annotated[
        list[FunnelStage] | None, Commas, Query(alias="filter[funnel_stage_in]")
    ] = None,
    priority_lte: Annotated[int | None, Query(alias="filter[priority_lte]", ge=1, le=5)] = None,
    is_active: Annotated[bool, Query(alias="filter[is_active]")] = True,
    source_in: Annotated[
        list[KeywordSource] | None, Commas, Query(alias="filter[source_in]")
    ] = None,
    depth_profile_in: Annotated[
        list[DepthProfile] | None, Commas, Query(alias="filter[depth_profile_in]")
    ] = None,
    search_volume_gte: Annotated[int | None, Query(alias="filter[search_volume_gte]", ge=0)] = None,
    keyword_difficulty_lte: Annotated[
        int | None, Query(alias="filter[keyword_difficulty_lte]", ge=0, le=100)
    ] = None,
    rank_lte: Annotated[int | None, Query(alias="filter[rank_lte]", ge=1, le=700)] = None,
    rank_gte: Annotated[int | None, Query(alias="filter[rank_gte]", ge=1, le=700)] = None,
    rank_is_null: Annotated[
        bool | None,
        Query(
            alias="filter[rank_is_null]",
            description="True: beyond the depth at the latest check. False: ranked.",
        ),
    ] = None,
    rank_change_label_in: Annotated[
        list[RankChangeLabel] | None, Commas, Query(alias="filter[rank_change_label_in]")
    ] = None,
    improved: Annotated[bool | None, Query(alias="filter[improved]")] = None,
    declined: Annotated[bool | None, Query(alias="filter[declined]")] = None,
    feature_present: Annotated[
        str | None, Query(alias="filter[feature_present]", min_length=1, max_length=100)
    ] = None,
    feature_owned: Annotated[
        str | None, Query(alias="filter[feature_owned]", min_length=1, max_length=100)
    ] = None,
    aio_state: Annotated[list[AioState] | None, Commas, Query(alias="filter[aio_state]")] = None,
    ranking_url_id: Annotated[int | None, Query(alias="filter[ranking_url_id]", ge=1)] = None,
    target_url_match: Annotated[bool | None, Query(alias="filter[target_url_match]")] = None,
    is_stale: Annotated[bool | None, Query(alias="filter[is_stale]")] = None,
) -> TrackedKeywordPage:
    given = _query_filter(
        {
            "q": q,
            "group": group,
            "term": term,
            "term_in": term_in,
            "device": device,
            "location_id": location_id,
            "language_code": language_code,
            "search_engine": search_engine,
            "intent_in": intent_in,
            "funnel_stage_in": funnel_stage_in,
            "priority_lte": priority_lte,
            "is_active": is_active,
            "source_in": source_in,
            "depth_profile_in": depth_profile_in,
            "search_volume_gte": search_volume_gte,
            "keyword_difficulty_lte": keyword_difficulty_lte,
            "rank_lte": rank_lte,
            "rank_gte": rank_gte,
            "rank_is_null": rank_is_null,
            "rank_change_label_in": rank_change_label_in,
            "improved": improved,
            "declined": declined,
            "feature_present": feature_present,
            "feature_owned": feature_owned,
            "aio_state": aio_state,
            "ranking_url_id": ranking_url_id,
            "target_url_match": target_url_match,
            "is_stale": is_stale,
        }
    )
    result = await keywords.page(
        access, project_id, given, filters.parse_sort(sort), frozenset(include or ()), page
    )
    return TrackedKeywordPage(
        data=[
            TrackedKeywordRow.model_validate(
                {
                    **_tracked_fields(row.record),
                    "metrics": None
                    if row.metrics is None
                    else metric_values.keyword_metrics(row.metrics),
                    "groups": None if row.groups is None else [_group(g) for g in row.groups],
                    "terms": None if row.terms is None else [_term(t) for t in row.terms],
                    "competitors": None
                    if row.overrides is None
                    else [_override(o) for o in row.overrides],
                    "state": rank_views.state_view(row.state),
                    "sparkline": None
                    if row.sparkline is None
                    else rank_views.sparkline_view(row.sparkline),
                    "competitor_ranks": None
                    if row.competitor_ranks is None
                    else [rank_views.competitor_view(c) for c in row.competitor_ranks],
                    "features": None
                    if row.features is None
                    else rank_views.features_view(row.features),
                    "aio": None if row.cited is None else rank_views.aio_view(row.state, row.cited),
                }
            )
            for row in result.rows
        ],
        page=TrackedKeywordPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
            total=result.total,
        ),
    )


@router.post(
    "/bulk-update",
    summary="Change tracked keywords by ids or by filter",
    description="Exactly one of `ids` (up to 5,000) and `filter` (`422 too_many_subjects` over "
    "20,000 matches, with `limit`). `set` takes the fields of a single change; a new "
    "`depth_profile` or `target_url` makes a configuration version for each row it changes "
    "(`config_versions_created`). `add_term_ids` with a term of a single-valued vocabulary "
    "replaces the keyword's other term of that vocabulary.",
)
async def bulk_update_tracked_keywords(
    project_id: UUID,
    body: TrackedKeywordBulkUpdate,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> BulkUpdateResponse:
    outcome = await keywords.bulk_update(access, project_id, body, info)
    return BulkUpdateResponse(
        data=BulkUpdateResult(
            matched=outcome.matched,
            updated=outcome.updated,
            config_versions_created=outcome.versions,
        )
    )


@router.post(
    "/bulk-archive",
    summary="Archive or unarchive tracked keywords",
    description="Exactly one of `ids` and `filter`. Archived keywords are not collected and do "
    "not count against the quota; unarchiving is `422 quota_exceeded` when they would not fit.",
)
async def bulk_archive_tracked_keywords(
    project_id: UUID,
    body: TrackedKeywordBulkArchive,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> BulkArchiveResponse:
    matched, updated = await keywords.bulk_archive(access, project_id, body, info)
    return BulkArchiveResponse(data=BulkArchiveResult(matched=matched, updated=updated))


@router.post(
    "/bulk-delete",
    summary="Delete tracked keywords",
    description="Exactly one of `ids` (up to 5,000) and `filter` (`422 too_many_subjects` over "
    "20,000 matches). As the single delete: history stays, and tracking the same keyword again "
    "brings the row back with its settings.",
)
async def bulk_delete_tracked_keywords(
    project_id: UUID,
    body: TrackedKeywordBulkDelete,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> BulkDeleteResponse:
    matched, deleted = await keywords.bulk_delete(access, project_id, body, info)
    return BulkDeleteResponse(data=BulkDeleteResult(matched=matched, deleted=deleted))


@router.post(
    "",
    status_code=201,
    summary="Track a keyword (two rows for device both)",
    description="Defaults come from the project: its location and language, and "
    "`settings.seo`. `409 duplicate` with `existing_id` when the project tracks the keyword "
    "already, archived included; a deleted one comes back with its stored settings. "
    "`422 quota_exceeded` carries `limit`, `used` and `requested`.",
)
async def create_tracked_keyword(
    project_id: UUID,
    body: TrackedKeywordCreate,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> TrackedKeywordList:
    records = await keywords.create(access, project_id, body, info)
    return TrackedKeywordList(data=[tracked_keyword(record) for record in records])


@router.post(
    "/bulk-create",
    summary="Track up to 1,000 keywords",
    description="Items that cannot be tracked are in `rejected` with their code; duplicates "
    "are in `skipped`. Over the quota, nothing is written (`422 quota_exceeded`).",
)
async def bulk_create_tracked_keywords(
    project_id: UUID,
    body: TrackedKeywordBulkCreate,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> BulkCreateResponse:
    outcome = await keywords.bulk_create(access, project_id, body, info)
    return BulkCreateResponse(
        data=BulkCreateResult(
            created=outcome.created,
            restored=outcome.restored,
            skipped=[
                BulkSkipped(index=index, existing_id=existing_id)
                for index, existing_id in outcome.skipped
            ],
            rejected=[
                BulkRejected(index=index, code=code, message=message)
                for index, code, message in outcome.rejected
            ],
        )
    )


@router.get(
    "/{tracked_keyword_id}",
    summary="One tracked keyword",
    description="With its current metrics, groups, terms, competitor overrides and schedule.",
)
async def get_tracked_keyword(
    project_id: UUID, tracked_keyword_id: UUID, access: ReadData, keywords: Keywords
) -> TrackedKeywordDetailResponse:
    detail = await keywords.get(access, project_id, tracked_keyword_id)
    schedule = detail.schedule
    return TrackedKeywordDetailResponse(
        data=TrackedKeywordDetail.model_validate(
            {
                **_tracked_fields(detail.record),
                "metrics": None
                if detail.metrics is None
                else metric_values.keyword_metrics(detail.metrics),
                "groups": [_group(group) for group in detail.groups],
                "terms": [_term(term) for term in detail.terms],
                "competitor_overrides": [_override(o) for o in detail.overrides],
                "state": rank_views.state_view(detail.state),
                "config_history_count": detail.config_versions,
                "schedule": None
                if schedule is None
                else ScheduleRef(
                    schedule_id=schedule.schedule_id,
                    name=schedule.name,
                    next_run_at=schedule.next_run_at,
                ),
            }
        )
    )


@router.patch(
    "/{tracked_keyword_id}",
    summary="Change a tracked keyword",
    description="A new `depth_profile` or `target_url` makes a new `config_version` with a "
    "history row. The identity (`keyword`, `search_engine`, `location_id`, `language_code`, "
    "`device`, `os`) cannot change: `422 validation_failed` with `immutable_field`. "
    "Unarchiving (`is_active: true`) counts against the quota.",
)
async def update_tracked_keyword(
    project_id: UUID,
    tracked_keyword_id: UUID,
    body: TrackedKeywordPatch,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> TrackedKeywordResponse:
    record = await keywords.update(
        access,
        project_id,
        tracked_keyword_id,
        body.model_dump(include=body.model_fields_set),
        info,
    )
    return TrackedKeywordResponse(data=tracked_keyword(record))


@router.delete(
    "/{tracked_keyword_id}",
    status_code=204,
    summary="Delete a tracked keyword (history kept)",
    description="Tracking the same keyword again brings the row back with its settings.",
)
async def delete_tracked_keyword(
    project_id: UUID,
    tracked_keyword_id: UUID,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> Response:
    await keywords.delete(access, project_id, tracked_keyword_id, info)
    return Response(status_code=204)


@router.get("/{tracked_keyword_id}/config-history", summary="Configuration versions")
async def get_config_history(
    project_id: UUID, tracked_keyword_id: UUID, access: ReadData, keywords: Keywords
) -> ConfigHistory:
    versions = await keywords.config_history(access, project_id, tracked_keyword_id)
    return ConfigHistory(data=[_config_version(version) for version in versions])


@router.put(
    "/{tracked_keyword_id}/competitors",
    summary="Set the keyword's competitor overrides",
    description="Replaces the overrides. The effective set is the project's SEO competitors, "
    "with `include` added and `exclude` taken away. An entity without a live role in the "
    "project is `422 validation_failed` with `entity_not_in_project`.",
)
async def set_competitors(
    project_id: UUID,
    tracked_keyword_id: UUID,
    body: CompetitorOverrides,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> CompetitorSetResponse:
    result = await keywords.set_competitors(access, project_id, tracked_keyword_id, body, info)
    return CompetitorSetResponse(
        data=CompetitorSet(
            effective_competitors=[_entity(entity) for entity in result.effective],
            overrides=[_override(o) for o in result.overrides],
        )
    )


# Workspace keywords.


@keywords_router.get(
    "",
    summary="The workspace's keywords",
    description="By normalized text. `filter[q]` matches part of the normalized text.",
)
async def list_keywords(
    access: ReadData,
    page: Cursor,
    keywords: Keywords,
    q: Annotated[QueryText | None, Query(alias="filter[q]")] = None,
    language_code: Annotated[LanguageCode | None, Query(alias="filter[language_code]")] = None,
) -> KeywordPage:
    result = await keywords.keyword_page(access, q=q, language_code=language_code, page=page)
    return KeywordPage(
        data=[_keyword(record) for record in result.rows],
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )


@keywords_router.get(
    "/{keyword_id}", summary="A keyword with its current metrics and tracked variants"
)
async def get_keyword(
    keyword_id: UUID, access: ReadData, keywords: Keywords
) -> KeywordDetailResponse:
    detail = await keywords.keyword(access, keyword_id)
    return KeywordDetailResponse(
        data=KeywordDetail(
            **_keyword(detail.keyword).model_dump(),
            metrics=[metric_values.keyword_metrics(record) for record in detail.metrics],
            tracked=[
                TrackedVariant.model_validate(
                    {
                        "tracked_keyword_id": variant.tracked_keyword_id,
                        "project_id": variant.project_id,
                        "location_id": variant.location_id,
                        "language_code": variant.language_code,
                        "device": variant.device,
                        "is_active": variant.is_active,
                    }
                )
                for variant in detail.variants
            ],
        )
    )


@keywords_router.get(
    "/{keyword_id}/metrics-history",
    summary="A keyword's metric snapshots, trend and seasonality",
    description="Snapshots oldest first; `from` and `to` are UTC dates of `fetched_at`. The "
    "trend and seasonality are those of the latest snapshot in the range.",
)
async def get_metrics_history(
    keyword_id: UUID,
    access: ReadData,
    keywords: Keywords,
    location_id: int,
    language_code: LanguageCode,
    source: MetricsSource = "dataforseo_labs",
    since: Annotated[date | None, Query(alias="from")] = None,
    until: Annotated[date | None, Query(alias="to")] = None,
) -> KeywordMetricsHistoryResponse:
    snapshots = await keywords.metrics_history(
        access,
        keyword_id,
        location_id=location_id,
        language_code=language_code,
        source=source,
        since=since,
        until=until,
    )
    return KeywordMetricsHistoryResponse(
        data=metric_values.history(
            snapshots,
            location_id=location_id,
            language_code=language_code,
            source=source,
            today=datetime.now(UTC).date(),
        )
    )
