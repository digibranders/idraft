"""Tiers, rules and tags of a project's pages (spec 5.2 and 5.3). Reading needs `data:read`;
changing needs `projects:write` (decision D15)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from idraft.api.internal_links.page_tiers import PageTierService, RuleRecord
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import (
    BulkResponse,
    BulkResult,
    PageSelection,
    PageTagChange,
    PageTierSet,
    TagChangeResponse,
    TagChangeResult,
    TierImportRequest,
    TierImportResponse,
    TierRef,
    TierRuleCreate,
    TierRuleList,
    TierRulePatch,
    TierRulePreviewRequest,
    TierRulePreviewResponse,
    TierRuleResponse,
    TierRuleView,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.crawl.tiers import tier_code

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["internal-links"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_page_tiers(resources: Annotated[Resources, Depends(get_resources)]) -> PageTierService:
    return resources.page_tiers


PageTiers = Annotated[PageTierService, Depends(get_page_tiers)]


def rule_view(rule: RuleRecord) -> TierRuleView:
    return TierRuleView(
        rule_id=rule.rule_id,
        position=rule.position,
        match_type=rule.match_type,
        value=rule.value,
        tier=TierRef(tier_id=rule.tier_id, code=tier_code(rule.tier_position), name=rule.tier_name),
        created_at=rule.created_at,
    )


@router.put(
    "/pages/tiers",
    summary="Set or clear a tier on pages of the latest crawl",
    description="`url_ids` (up to 5,000) or `filter` (the Pages filters; `422 "
    "too_many_subjects` over 20,000). `tier_id: null` sets Untiered by hand, which beats every "
    "rule; `POST .../pages/tiers/reset` gives the pages back to their rules. An id the crawl "
    "does not hold is left out of `matched`. `404 no_crawl` before the first finished crawl.",
)
async def set_page_tiers(
    project_id: UUID, body: PageTierSet, access: WriteProject, service: PageTiers, info: Info
) -> BulkResponse:
    matched, changed = await service.set_tiers(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))


@router.post("/pages/tiers/reset", summary="Give pages back to their rule tier")
async def reset_page_tiers(
    project_id: UUID, body: PageSelection, access: WriteProject, service: PageTiers, info: Info
) -> BulkResponse:
    matched, changed = await service.reset(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))


@router.post(
    "/pages/tiers/import",
    summary="Set tiers from a CSV of url and tier",
    description="`tier` is a code (T1), a name, `T1 Money pages`, or `none`. A URL the latest "
    "crawl did not find is stored and listed in `pending`; it applies when a crawl finds it. "
    "While any row has an error (`errors`, by line) nothing is changed and `applied` is false.",
)
async def import_page_tiers(
    project_id: UUID, body: TierImportRequest, access: WriteProject, service: PageTiers, info: Info
) -> TierImportResponse:
    return TierImportResponse(data=await service.import_tiers(access, project_id, body.csv, info))


@router.put(
    "/pages/tags",
    summary="Add and remove tags on pages of the latest crawl",
    description="Terms of the project's or the workspace's `tag` vocabularies; any other term "
    "is `422 validation_failed` with `not_a_tag`. Adding a tag a page has, or removing one it "
    "has not, changes nothing.",
)
async def change_page_tags(
    project_id: UUID, body: PageTagChange, access: WriteProject, service: PageTiers, info: Info
) -> TagChangeResponse:
    matched, added, removed = await service.change_tags(access, project_id, body, info)
    return TagChangeResponse(data=TagChangeResult(matched=matched, added=added, removed=removed))


@router.get("/tier-rules", summary="The project's tier rules, first rule first")
async def list_tier_rules(project_id: UUID, access: ReadData, service: PageTiers) -> TierRuleList:
    rules = await service.list_rules(access, project_id)
    return TierRuleList(data=[rule_view(rule) for rule in rules])


@router.post(
    "/tier-rules",
    status_code=201,
    summary="Add a tier rule",
    description="`exact` (the path, a trailing slash aside), `prefix` (the path starts with it) "
    "or `pattern` (`*` is any run of characters). Left without `position` it goes last; with "
    "one, the rules from there move down. The rules apply to every page at once.",
)
async def create_tier_rule(
    project_id: UUID, body: TierRuleCreate, access: WriteProject, service: PageTiers, info: Info
) -> TierRuleResponse:
    record = await service.create_rule(access, project_id, body, info)
    return TierRuleResponse(data=rule_view(record))


@router.patch("/tier-rules/{rule_id}", summary="Change or move a tier rule")
async def update_tier_rule(
    project_id: UUID,
    rule_id: UUID,
    body: TierRulePatch,
    access: WriteProject,
    service: PageTiers,
    info: Info,
) -> TierRuleResponse:
    record = await service.update_rule(access, project_id, rule_id, body, info)
    return TierRuleResponse(data=rule_view(record))


@router.delete("/tier-rules/{rule_id}", status_code=204, summary="Delete a tier rule")
async def delete_tier_rule(
    project_id: UUID, rule_id: UUID, access: WriteProject, service: PageTiers, info: Info
) -> Response:
    await service.delete_rule(access, project_id, rule_id, info)
    return Response(status_code=204)


@router.post(
    "/tier-rules/preview",
    summary="How many pages a rule would match and decide",
    description="Counts on the latest crawl, as if the rule stood at `position` (last when left "
    "out) among the others; `rule_id` is the rule being edited, left out of the others.",
)
async def preview_tier_rule(
    project_id: UUID, body: TierRulePreviewRequest, access: ReadData, service: PageTiers
) -> TierRulePreviewResponse:
    return TierRulePreviewResponse(data=await service.preview_rule(access, project_id, body))
