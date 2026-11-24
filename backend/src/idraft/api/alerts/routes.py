"""Alert rules and alerts (docs/19 section 3.11.5, the version 1 subset: in the app only).

Reading needs `data:read`, writing `alerts:write` (owner, admin, editor). The `/test` and
`/preview` routes, digests and webhook endpoints wait for email and Slack. The service comes from
a dependency here, built from `Resources`.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.alerts.catalog import RuleType
from idraft.api.alerts.schemas import (
    AcknowledgeBody,
    AcknowledgedResponse,
    AlertEventPage,
    AlertRuleInput,
    AlertRulePage,
    AlertRuleResponse,
    AlertRuleTypeList,
    AlertRuleUpdate,
)
from idraft.api.alerts.service import AlertService, rule_types
from idraft.api.auth.dependencies import CurrentSession
from idraft.api.pagination import Commas, Cursor, Offset
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"

router = APIRouter(tags=["alerts"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteAlerts = Annotated[WorkspaceAccess, Depends(require_permission(Permission.ALERTS_WRITE))]


def get_alert_service(resources: Annotated[Resources, Depends(get_resources)]) -> AlertService:
    """Stateless: built per request from the session factory."""
    return AlertService(sessions=resources.sessions)


Alerts = Annotated[AlertService, Depends(get_alert_service)]


@router.get(
    "/api/v1/alert-rule-types",
    summary="The rule types a rule can have",
    description="Each with its area, default severity and the JSON Schema of its `params`.",
)
async def list_rule_types(session: CurrentSession) -> AlertRuleTypeList:
    return rule_types()


@router.get(
    PROJECT + "/alert-rules",
    summary="The project's alert rules, oldest first",
)
async def list_alert_rules(
    project_id: UUID,
    access: ReadData,
    alerts: Alerts,
    page: Offset,
    is_active: Annotated[bool | None, Query(alias="filter[is_active]")] = None,
    rule_type_in: Annotated[
        list[RuleType] | None, Query(alias="filter[rule_type_in]"), Commas
    ] = None,
) -> AlertRulePage:
    return await alerts.list_rules(
        access, project_id, page, is_active=is_active, rule_type_in=rule_type_in
    )


@router.post(
    PROJECT + "/alert-rules",
    status_code=201,
    summary="Make an alert rule",
    description="`422 invalid_params` when `params` do not fit the rule type: `rank_drop` takes "
    "`positions` (a whole number from 1 to 50, default 5), the AI types take none. `scope` may "
    "narrow the rule by `group_ids` and, for the AI types, `engine_codes` (platforms).",
)
async def create_alert_rule(
    project_id: UUID, body: AlertRuleInput, access: WriteAlerts, alerts: Alerts
) -> AlertRuleResponse:
    return AlertRuleResponse(data=await alerts.create_rule(access, project_id, body))


@router.get(PROJECT + "/alert-rules/{alert_rule_id}", summary="One alert rule")
async def get_alert_rule(
    project_id: UUID, alert_rule_id: UUID, access: ReadData, alerts: Alerts
) -> AlertRuleResponse:
    return AlertRuleResponse(data=await alerts.get_rule(access, project_id, alert_rule_id))


@router.patch(
    PROJECT + "/alert-rules/{alert_rule_id}",
    summary="Change an alert rule",
    description="Name, scope, parameters or whether it is active; the rule type cannot change. "
    "A rule raises alerts only for runs and checks that finish after it is made.",
)
async def update_alert_rule(
    project_id: UUID,
    alert_rule_id: UUID,
    body: AlertRuleUpdate,
    access: WriteAlerts,
    alerts: Alerts,
) -> AlertRuleResponse:
    return AlertRuleResponse(data=await alerts.update_rule(access, project_id, alert_rule_id, body))


@router.delete(
    PROJECT + "/alert-rules/{alert_rule_id}",
    status_code=204,
    summary="Delete an alert rule",
    description="The alerts it raised are deleted with it.",
)
async def delete_alert_rule(
    project_id: UUID, alert_rule_id: UUID, access: WriteAlerts, alerts: Alerts
) -> Response:
    await alerts.delete_rule(access, project_id, alert_rule_id)
    return Response(status_code=204)


@router.get(
    PROJECT + "/alert-events",
    summary="The alerts of the project, newest first",
)
async def list_alert_events(
    project_id: UUID,
    access: ReadData,
    alerts: Alerts,
    page: Cursor,
    acknowledged: Annotated[bool | None, Query(alias="filter[acknowledged]")] = None,
    rule_id: Annotated[UUID | None, Query(alias="filter[rule_id]")] = None,
) -> AlertEventPage:
    return await alerts.list_events(
        access, project_id, page, acknowledged=acknowledged, rule_id=rule_id
    )


@router.post(
    PROJECT + "/alert-events/acknowledge",
    summary="Mark alerts as seen",
    description="At most 500 ids. Ids that are not open alerts of this project count for "
    "nothing; `acknowledged` says how many were marked.",
)
async def acknowledge_alert_events(
    project_id: UUID, body: AcknowledgeBody, access: WriteAlerts, alerts: Alerts
) -> AcknowledgedResponse:
    return await alerts.acknowledge(access, project_id, body.ids)
