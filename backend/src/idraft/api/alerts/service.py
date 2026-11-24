"""Alert rules and the alerts they raised, for the people of a project.

Every statement names the workspace and the project; a rule or alert of another project or
workspace is a 404. Alerts are raised by the worker (`idraft.alerts.evaluate`); here they are
only listed and acknowledged.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import and_, delete, func, insert, or_, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.alerts.catalog import (
    RULE_TYPES,
    RuleScope,
    RuleType,
    normalized_params,
    params_problem,
    params_schema,
)
from idraft.api.ai.engine_service import live_project
from idraft.api.alerts.problems import InvalidParamsError
from idraft.api.alerts.schemas import (
    Acknowledged,
    AcknowledgedResponse,
    AlertEvent,
    AlertEventPage,
    AlertRule,
    AlertRuleInput,
    AlertRulePage,
    AlertRuleType,
    AlertRuleTypeList,
    AlertRuleUpdate,
)
from idraft.api.pagination import (
    CursorPageInfo,
    CursorParams,
    OffsetPageInfo,
    OffsetParams,
    cursor_instant,
    decode_cursor,
    encode_cursor,
    invalid_cursor,
)
from idraft.api.problems import NotFoundError, invalid_field
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    alert_events,
    alert_rules,
    keyword_groups,
    taxonomy_terms,
    taxonomy_vocabularies,
)
from idraft.domain.ai_engines import EngineCode

INT64_MAX = 2**63 - 1


def rule_types() -> AlertRuleTypeList:
    return AlertRuleTypeList(
        data=[
            AlertRuleType(
                rule_type=info.rule_type,
                channel=info.channel,
                default_severity=info.default_severity,
                params_schema=params_schema(info.rule_type),
            )
            for info in RULE_TYPES.values()
        ]
    )


def _params(rule_type: RuleType, params: dict[str, Any]) -> dict[str, Any]:
    try:
        return normalized_params(rule_type, params)
    except ValidationError as error:
        raise InvalidParamsError(params_problem(error), rule_type=rule_type) from None


def _event(row: Any) -> AlertEvent:
    return AlertEvent(
        id=str(row.id),
        rule_id=row.rule_id,
        subject_type=row.subject_type,
        subject_id=row.subject_id,
        subject_label=row.subject_label,
        event_kind=row.event_kind,
        severity=row.severity,
        evidence=row.evidence,
        occurred_at=row.occurred_at,
        acknowledged_by=row.acknowledged_by,
        acknowledged_at=row.acknowledged_at,
    )


_RULE_COLUMNS = (
    alert_rules.c.id,
    alert_rules.c.name,
    alert_rules.c.rule_type,
    alert_rules.c.scope,
    alert_rules.c.params,
    alert_rules.c.channels,
    alert_rules.c.digest_mode,
    alert_rules.c.is_active,
    alert_rules.c.created_at,
    alert_rules.c.updated_at,
)


class AlertService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> Any:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list_rules(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        page: OffsetParams,
        *,
        is_active: bool | None,
        rule_type_in: list[RuleType] | None,
    ) -> AlertRulePage:
        where = [
            alert_rules.c.workspace_id == access.workspace_id,
            alert_rules.c.project_id == project_id,
        ]
        if is_active is not None:
            where.append(alert_rules.c.is_active == is_active)
        if rule_type_in:
            where.append(alert_rules.c.rule_type.in_(rule_type_in))
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            total = (
                await db.execute(select(func.count()).select_from(alert_rules).where(*where))
            ).scalar_one()
            rows = await db.execute(
                select(*_RULE_COLUMNS)
                .where(*where)
                .order_by(alert_rules.c.created_at, alert_rules.c.id)
                .offset(page.offset)
                .limit(page.limit)
            )
        return AlertRulePage(
            data=[AlertRule.model_validate(row, from_attributes=True) for row in rows],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
        )

    async def get_rule(self, access: WorkspaceAccess, project_id: UUID, rule_id: UUID) -> AlertRule:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            row = await self._row(db, access, project_id, rule_id)
        return AlertRule.model_validate(row, from_attributes=True)

    async def create_rule(
        self, access: WorkspaceAccess, project_id: UUID, body: AlertRuleInput
    ) -> AlertRule:
        params = _params(body.rule_type, body.params)
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            await self._check_scope(db, access, project_id, body.rule_type, body.scope)
            row = (
                await db.execute(
                    insert(alert_rules)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        name=body.name,
                        rule_type=body.rule_type,
                        scope=body.scope.model_dump(mode="json"),
                        params=params,
                        is_active=body.is_active,
                    )
                    .returning(*_RULE_COLUMNS)
                )
            ).one()
        return AlertRule.model_validate(row, from_attributes=True)

    async def update_rule(
        self, access: WorkspaceAccess, project_id: UUID, rule_id: UUID, body: AlertRuleUpdate
    ) -> AlertRule:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            current = await self._row(db, access, project_id, rule_id, lock=True)
            rule_type: RuleType = current.rule_type
            values: dict[str, Any] = {"updated_at": datetime.now(UTC)}
            if body.name is not None:
                values["name"] = body.name
            if body.is_active is not None:
                values["is_active"] = body.is_active
            if body.params is not None:
                values["params"] = _params(rule_type, body.params)
            if body.scope is not None:
                await self._check_scope(db, access, project_id, rule_type, body.scope)
                values["scope"] = body.scope.model_dump(mode="json")
            row = (
                await db.execute(
                    update(alert_rules)
                    .where(
                        alert_rules.c.workspace_id == access.workspace_id,
                        alert_rules.c.id == rule_id,
                    )
                    .values(**values)
                    .returning(*_RULE_COLUMNS)
                )
            ).one()
        return AlertRule.model_validate(row, from_attributes=True)

    async def delete_rule(self, access: WorkspaceAccess, project_id: UUID, rule_id: UUID) -> None:
        """Its alerts go with it (the foreign key cascades)."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            deleted = await db.execute(
                delete(alert_rules)
                .where(
                    alert_rules.c.workspace_id == access.workspace_id,
                    alert_rules.c.project_id == project_id,
                    alert_rules.c.id == rule_id,
                )
                .returning(alert_rules.c.id)
            )
            if deleted.first() is None:
                raise NotFoundError

    async def list_events(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        page: CursorParams,
        *,
        acknowledged: bool | None,
        rule_id: UUID | None,
    ) -> AlertEventPage:
        scope: dict[str, object] = {
            "project": str(project_id),
            "acknowledged": acknowledged,
            "rule": None if rule_id is None else str(rule_id),
        }
        where = [
            alert_events.c.workspace_id == access.workspace_id,
            alert_events.c.project_id == project_id,
        ]
        if acknowledged is not None:
            where.append(
                alert_events.c.acknowledged_at.is_not(None)
                if acknowledged
                else alert_events.c.acknowledged_at.is_(None)
            )
        if rule_id is not None:
            where.append(alert_events.c.rule_id == rule_id)
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=scope)
            if len(key) != 2 or not isinstance(key[1], int):
                raise invalid_cursor()
            where.append(
                tuple_(alert_events.c.occurred_at, alert_events.c.id)
                < tuple_(cursor_instant(key[0]), key[1])
            )
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            rows = (
                await db.execute(
                    select(alert_events)
                    .where(*where)
                    .order_by(alert_events.c.occurred_at.desc(), alert_events.c.id.desc())
                    .limit(page.limit + 1)
                )
            ).all()
        shown = rows[: page.limit]
        has_more = len(rows) > page.limit
        next_cursor = (
            encode_cursor([shown[-1].occurred_at.isoformat(), shown[-1].id], scope=scope)
            if has_more
            else None
        )
        return AlertEventPage(
            data=[_event(row) for row in shown],
            page=CursorPageInfo(limit=page.limit, next_cursor=next_cursor, has_more=has_more),
        )

    async def acknowledge(
        self, access: WorkspaceAccess, project_id: UUID, ids: list[str]
    ) -> AcknowledgedResponse:
        """Marks the open alerts among `ids` as seen by the caller. An id of another project, an
        unknown id or an alert already acknowledged counts for nothing, and is no error."""
        numbers = sorted({int(value) for value in ids if int(value) <= INT64_MAX})
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            done = await db.execute(
                update(alert_events)
                .where(
                    alert_events.c.workspace_id == access.workspace_id,
                    alert_events.c.project_id == project_id,
                    alert_events.c.id.in_(numbers),
                    alert_events.c.acknowledged_at.is_(None),
                )
                .values(acknowledged_by=access.user_id, acknowledged_at=func.now())
                .returning(alert_events.c.id)
            )
            count = len(done.all())
        return AcknowledgedResponse(data=Acknowledged(acknowledged=count))

    async def _row(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        rule_id: UUID,
        *,
        lock: bool = False,
    ) -> Any:
        statement = select(*_RULE_COLUMNS).where(
            alert_rules.c.workspace_id == access.workspace_id,
            alert_rules.c.project_id == project_id,
            alert_rules.c.id == rule_id,
        )
        row = (await db.execute(statement.with_for_update() if lock else statement)).one_or_none()
        if row is None:
            raise NotFoundError
        return row

    async def _check_scope(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        rule_type: RuleType,
        scope: RuleScope,
    ) -> None:
        """Groups must exist in the workspace (the keyword groups of this project for a rank
        drop); platforms narrow only the AI rule types."""
        if rule_type == "rank_drop" and scope.engine_codes:
            raise invalid_field(
                "scope.engine_codes",
                code="not_for_rule_type",
                message="Platforms apply to the AI rule types only.",
            )
        unknown = sorted(set(scope.engine_codes) - {code.value for code in EngineCode})
        if unknown:
            raise InvalidParamsError(
                f"scope.engine_codes: unknown platform {unknown[0]!r}.", rule_type=rule_type
            )
        if not scope.group_ids:
            return
        wanted = set(scope.group_ids)
        if rule_type == "rank_drop":
            found_query = select(keyword_groups.c.id).where(
                keyword_groups.c.workspace_id == access.workspace_id,
                keyword_groups.c.project_id == project_id,
                keyword_groups.c.id.in_(wanted),
            )
        else:
            # A term of this project's vocabularies or of a workspace-wide one.
            found_query = (
                select(taxonomy_terms.c.id)
                .join(
                    taxonomy_vocabularies,
                    and_(
                        taxonomy_vocabularies.c.id == taxonomy_terms.c.vocabulary_id,
                        taxonomy_vocabularies.c.workspace_id == taxonomy_terms.c.workspace_id,
                    ),
                )
                .where(
                    taxonomy_terms.c.workspace_id == access.workspace_id,
                    taxonomy_terms.c.id.in_(wanted),
                    or_(
                        taxonomy_vocabularies.c.project_id.is_(None),
                        taxonomy_vocabularies.c.project_id == project_id,
                    ),
                )
            )
        found = {row.id for row in await db.execute(found_query)}
        if found != wanted:
            raise invalid_field(
                "scope.group_ids",
                code="group_not_found",
                message="A group of the scope does not exist in this workspace.",
            )
