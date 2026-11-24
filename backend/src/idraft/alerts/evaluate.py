"""Raising alerts after runs and checks (version 1: in the app only; no provider call).

A worker tick. For each project with at least one rule it reads what is new since the project's
cursor in `ops.alert_cursors`: AI runs completed after `last_completed_at` (compared with the
latest earlier run that has valid answers) and rank events after `last_rank_event_id`. Each alert
carries a dedupe key, so evaluating the same run twice raises it once. The cursor moves even when
no rule is active, so a rule switched on later does not fire for what happened before. The
worker bypasses row-level security: every statement names the workspace.

shortcut: the previous run is the latest earlier AI run with a valid answer, as a whole. A run of
one prompt can therefore stand in as the previous run of the others (they are then not compared).
Upgrade by choosing the previous run per prompt and platform when partial runs become common.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

import structlog
from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.alerts.catalog import (
    CRITICAL_DROP,
    RULE_TYPES,
    RankDropParams,
    RuleScope,
    RuleType,
    Severity,
)
from idraft.alerts.detect import (
    MENTION_KINDS,
    AnswerFact,
    MentionChange,
    RankEvent,
    mention_changes,
    rank_drops,
)
from idraft.db.tables import (
    ai_observation_facts,
    ai_observations,
    ai_prompt_terms,
    ai_prompt_versions,
    ai_prompts,
    alert_cursors,
    alert_events,
    alert_rules,
    collection_runs,
    entities,
    keyword_group_members,
    keywords,
    rank_events,
    tracked_keywords,
)

_log = structlog.get_logger(__name__)

AI_WORKLOAD: Final = "ai_prompt"
FINISHED: Final = ("completed", "completed_with_errors")
# Earlier runs looked at to find one with valid answers.
PREVIOUS_RUNS_LOOKED_AT: Final = 10
# Rank events one pass reads; the rest wait for the next pass.
RANK_EVENTS_PER_PASS: Final = 5000


@dataclass(frozen=True, slots=True)
class AlertReport:
    projects: int
    raised: int

    @property
    def quiet(self) -> bool:
        return self.raised == 0


@dataclass(frozen=True, slots=True)
class _Rule:
    id: uuid.UUID
    rule_type: RuleType
    scope: RuleScope
    params: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True, slots=True)
class _Run:
    id: uuid.UUID
    created_at: datetime
    completed_at: datetime


async def evaluate_alerts(sessions: async_sessionmaker[AsyncSession]) -> AlertReport:
    """One pass over every project that has a rule. A project that fails is logged and left for
    the next pass; its cursor did not move."""
    async with sessions() as db:
        projects = (
            await db.execute(
                select(alert_rules.c.workspace_id, alert_rules.c.project_id)
                .distinct()
                .order_by(alert_rules.c.project_id)
            )
        ).all()
    raised = 0
    for workspace_id, project_id in projects:
        try:
            async with sessions() as db, db.begin():
                raised += await _evaluate_project(db, workspace_id, project_id)
        except Exception:
            _log.exception("alerts not evaluated", project=str(project_id))
    return AlertReport(projects=len(projects), raised=raised)


async def _evaluate_project(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> int:
    cursor = (
        await db.execute(
            select(alert_cursors.c.last_completed_at, alert_cursors.c.last_rank_event_id)
            .where(
                alert_cursors.c.project_id == project_id,
                alert_cursors.c.workspace_id == workspace_id,
            )
            .with_for_update()
        )
    ).one_or_none()
    if cursor is None:
        # Start from now: nothing that happened before the first pass is raised.
        newest: int = (
            await db.execute(
                select(func.coalesce(func.max(rank_events.c.id), 0)).where(
                    rank_events.c.project_id == project_id,
                    rank_events.c.workspace_id == workspace_id,
                )
            )
        ).scalar_one()
        await db.execute(
            insert(alert_cursors).values(
                project_id=project_id,
                workspace_id=workspace_id,
                last_completed_at=func.now(),
                last_rank_event_id=newest,
            )
        )
        return 0
    rules = await _active_rules(db, workspace_id, project_id)
    drafts: list[dict[str, Any]] = []
    runs = await _new_runs(db, workspace_id, project_id, cursor.last_completed_at)
    rank_rows = await _new_rank_events(db, workspace_id, project_id, cursor.last_rank_event_id)
    if rules:
        for run in runs:
            drafts += await _ai_alerts(db, workspace_id, project_id, run, rules)
        drafts += await _rank_alerts(db, workspace_id, project_id, rank_rows, rules)
    raised = 0
    if drafts:
        raised = len(
            (
                await db.execute(
                    upsert(alert_events)
                    .values(drafts)
                    .on_conflict_do_nothing(index_elements=[alert_events.c.dedupe_key])
                    .returning(alert_events.c.id)
                )
            ).all()
        )
    moved: dict[str, Any] = {"updated_at": func.now()}
    if runs:
        moved["last_completed_at"] = runs[-1].completed_at
    if rank_rows:
        moved["last_rank_event_id"] = rank_rows[-1].id
    await db.execute(
        update(alert_cursors)
        .where(
            alert_cursors.c.project_id == project_id, alert_cursors.c.workspace_id == workspace_id
        )
        .values(**moved)
    )
    return raised


async def _active_rules(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> list[_Rule]:
    rows = await db.execute(
        select(
            alert_rules.c.id,
            alert_rules.c.rule_type,
            alert_rules.c.scope,
            alert_rules.c.params,
            alert_rules.c.created_at,
        ).where(
            alert_rules.c.workspace_id == workspace_id,
            alert_rules.c.project_id == project_id,
            alert_rules.c.is_active,
            alert_rules.c.rule_type.in_(list(RULE_TYPES)),
        )
    )
    return [
        _Rule(
            row.id, row.rule_type, RuleScope.model_validate(row.scope), row.params, row.created_at
        )
        for row in rows
    ]


async def _new_runs(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID, after: datetime
) -> list[_Run]:
    rows = await db.execute(
        select(collection_runs.c.id, collection_runs.c.created_at, collection_runs.c.completed_at)
        .where(
            collection_runs.c.workspace_id == workspace_id,
            collection_runs.c.project_id == project_id,
            collection_runs.c.workload == AI_WORKLOAD,
            collection_runs.c.status.in_(FINISHED),
            collection_runs.c.completed_at > after,
        )
        .order_by(collection_runs.c.completed_at, collection_runs.c.id)
    )
    return [_Run(row.id, row.created_at, row.completed_at) for row in rows]


async def _facts(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID, run: _Run
) -> list[AnswerFact]:
    """The current facts of the run's answers to active prompts. The window on `observed_at`
    keeps the read to the partitions of the run."""
    facts, obs = ai_observation_facts.c, ai_observations.c
    rows = await db.execute(
        select(
            facts.prompt_id,
            facts.engine_code,
            facts.is_valid,
            facts.own_mentioned,
            facts.competitor_mentions,
        )
        .join(
            ai_observations,
            and_(obs.id == facts.observation_id, obs.observed_at == facts.observed_at),
        )
        .join(
            ai_prompts,
            and_(
                ai_prompts.c.id == facts.prompt_id, ai_prompts.c.workspace_id == facts.workspace_id
            ),
        )
        .where(
            facts.workspace_id == workspace_id,
            facts.project_id == project_id,
            facts.is_current,
            obs.workspace_id == workspace_id,
            obs.project_id == project_id,
            obs.collection_run_id == run.id,
            obs.observed_at >= run.created_at,
            obs.observed_at <= run.completed_at,
            ai_prompts.c.is_active,
            ai_prompts.c.deleted_at.is_(None),
        )
    )
    return [
        AnswerFact(
            row.prompt_id,
            row.engine_code,
            row.is_valid,
            row.own_mentioned,
            frozenset(row.competitor_mentions),
        )
        for row in rows
    ]


async def _previous(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID, run: _Run
) -> list[AnswerFact]:
    """The facts of the latest earlier run that has a valid answer; empty when there is none."""
    earlier = await db.execute(
        select(collection_runs.c.id, collection_runs.c.created_at, collection_runs.c.completed_at)
        .where(
            collection_runs.c.workspace_id == workspace_id,
            collection_runs.c.project_id == project_id,
            collection_runs.c.workload == AI_WORKLOAD,
            collection_runs.c.status.in_(FINISHED),
            collection_runs.c.completed_at < run.completed_at,
        )
        .order_by(collection_runs.c.completed_at.desc(), collection_runs.c.id.desc())
        .limit(PREVIOUS_RUNS_LOOKED_AT)
    )
    for row in earlier.all():
        facts = await _facts(
            db, workspace_id, project_id, _Run(row.id, row.created_at, row.completed_at)
        )
        if any(fact.is_valid for fact in facts):
            return facts
    return []


async def _prompts_in(
    db: AsyncSession, workspace_id: uuid.UUID, group_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    rows = await db.execute(
        select(ai_prompt_terms.c.prompt_id).where(
            ai_prompt_terms.c.workspace_id == workspace_id, ai_prompt_terms.c.term_id.in_(group_ids)
        )
    )
    return {row.prompt_id for row in rows}


def _narrowed(
    facts: Sequence[AnswerFact], scope: RuleScope, prompts: set[uuid.UUID] | None
) -> list[AnswerFact]:
    return [
        fact
        for fact in facts
        if (not scope.engine_codes or fact.engine_code in scope.engine_codes)
        and (prompts is None or fact.prompt_id in prompts)
    ]


async def _ai_alerts(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    run: _Run,
    rules: Sequence[_Rule],
) -> list[dict[str, Any]]:
    wanted = [
        rule
        for rule in rules
        if rule.rule_type in MENTION_KINDS and rule.created_at <= run.completed_at
    ]
    if not wanted:
        return []
    current = await _facts(db, workspace_id, project_id, run)
    previous = await _previous(db, workspace_id, project_id, run) if current else []
    if not previous:
        return []
    found: list[tuple[_Rule, MentionChange]] = []
    for rule in wanted:
        prompts = (
            await _prompts_in(db, workspace_id, rule.scope.group_ids)
            if rule.scope.group_ids
            else None
        )
        changes = mention_changes(
            _narrowed(previous, rule.scope, prompts), _narrowed(current, rule.scope, prompts)
        )
        found += [(rule, change) for change in changes if change.kind == rule.rule_type]
    if not found:
        return []
    labels = await _prompt_labels(db, workspace_id, {change.prompt_id for _, change in found})
    rivals = await _entity_names(
        db, workspace_id, {c.entity_id for _, c in found if c.entity_id is not None}
    )
    drafts: list[dict[str, Any]] = []
    for rule, change in found:
        subject = f"{change.prompt_id}:{change.engine_code}"
        evidence: dict[str, Any] = {
            "engine_code": change.engine_code,
            "run_id": str(run.id),
            "before": {"mentioning": change.before.mentioning, "valid": change.before.valid},
            "after": {"mentioning": change.after.mentioning, "valid": change.after.valid},
        }
        if change.entity_id is not None:
            subject += f":{change.entity_id}"
            evidence["competitor"] = {
                "id": str(change.entity_id),
                "name": rivals.get(change.entity_id, ""),
            }
        drafts.append(
            {
                "rule_id": rule.id,
                "workspace_id": workspace_id,
                "project_id": project_id,
                "subject_type": "prompt",
                "subject_id": str(change.prompt_id),
                "subject_label": labels.get(change.prompt_id, ""),
                "dedupe_key": f"{rule.id}|{subject}|{change.kind}|{run.id}",
                "event_kind": change.kind,
                "severity": RULE_TYPES[change.kind].default_severity,
                "evidence": evidence,
                "occurred_at": run.completed_at,
            }
        )
    return drafts


async def _prompt_labels(
    db: AsyncSession, workspace_id: uuid.UUID, prompt_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    rows = await db.execute(
        select(ai_prompts.c.id, ai_prompt_versions.c.text)
        .join(ai_prompt_versions, ai_prompt_versions.c.id == ai_prompts.c.current_version_id)
        .where(ai_prompts.c.workspace_id == workspace_id, ai_prompts.c.id.in_(prompt_ids))
    )
    return {row.id: row.text for row in rows}


async def _entity_names(
    db: AsyncSession, workspace_id: uuid.UUID, entity_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not entity_ids:
        return {}
    rows = await db.execute(
        select(entities.c.id, entities.c.canonical_name).where(
            entities.c.workspace_id == workspace_id, entities.c.id.in_(entity_ids)
        )
    )
    return {row.id: row.canonical_name for row in rows}


async def _new_rank_events(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID, after: int
) -> list[RankEvent]:
    rows = await db.execute(
        select(
            rank_events.c.id,
            rank_events.c.tracked_keyword_id,
            rank_events.c.occurred_at,
            rank_events.c.from_rank,
            rank_events.c.to_rank,
        )
        .where(
            rank_events.c.workspace_id == workspace_id,
            rank_events.c.project_id == project_id,
            rank_events.c.event_type == "rank_drop",
            rank_events.c.id > after,
        )
        .order_by(rank_events.c.id)
        .limit(RANK_EVENTS_PER_PASS)
    )
    return [
        RankEvent(r.id, r.tracked_keyword_id, r.occurred_at, r.from_rank, r.to_rank) for r in rows
    ]


async def _rank_alerts(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    events: Sequence[RankEvent],
    rules: Sequence[_Rule],
) -> list[dict[str, Any]]:
    wanted = [rule for rule in rules if rule.rule_type == "rank_drop"]
    if not wanted or not events:
        return []
    labels = await _keyword_labels(db, workspace_id, {e.tracked_keyword_id for e in events})
    drafts: list[dict[str, Any]] = []
    for rule in wanted:
        positions = RankDropParams.model_validate(rule.params).positions
        members = (
            await _keywords_in(db, workspace_id, rule.scope.group_ids)
            if rule.scope.group_ids
            else None
        )
        for drop in rank_drops(events, positions):
            event = drop.event
            if event.tracked_keyword_id not in labels or event.occurred_at < rule.created_at:
                continue
            if members is not None and event.tracked_keyword_id not in members:
                continue
            severity: Severity = "critical" if drop.positions_lost >= CRITICAL_DROP else "warning"
            drafts.append(
                {
                    "rule_id": rule.id,
                    "workspace_id": workspace_id,
                    "project_id": project_id,
                    "subject_type": "keyword",
                    "subject_id": str(event.tracked_keyword_id),
                    "subject_label": labels[event.tracked_keyword_id],
                    "dedupe_key": (
                        f"{rule.id}|{event.tracked_keyword_id}|rank_drop|event:{event.id}"
                    ),
                    "event_kind": "rank_drop",
                    "severity": severity,
                    "evidence": {
                        "rank_event_id": str(event.id),
                        "from_rank": event.from_rank,
                        "to_rank": event.to_rank,
                        "positions_lost": drop.positions_lost,
                        "positions": positions,
                    },
                    "occurred_at": event.occurred_at,
                }
            )
    return drafts


async def _keyword_labels(
    db: AsyncSession, workspace_id: uuid.UUID, tracked_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    rows = await db.execute(
        select(tracked_keywords.c.id, keywords.c.text)
        .join(
            keywords,
            and_(
                keywords.c.id == tracked_keywords.c.keyword_id,
                keywords.c.workspace_id == tracked_keywords.c.workspace_id,
            ),
        )
        .where(
            tracked_keywords.c.workspace_id == workspace_id,
            tracked_keywords.c.id.in_(tracked_ids),
            tracked_keywords.c.deleted_at.is_(None),
        )
    )
    return {row.id: row.text for row in rows}


async def _keywords_in(
    db: AsyncSession, workspace_id: uuid.UUID, group_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    rows = await db.execute(
        select(keyword_group_members.c.tracked_keyword_id).where(
            keyword_group_members.c.workspace_id == workspace_id,
            keyword_group_members.c.group_id.in_(group_ids),
        )
    )
    return {row.tracked_keyword_id for row in rows}
