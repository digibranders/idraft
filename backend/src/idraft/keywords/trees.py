"""Queries the API and the worker share over keyword groups and taxonomy terms: a list of ids as
one parameter, and the subtree under some groups or terms (docs/08-seo-keyword-system.md
section 4)."""

from __future__ import annotations

from collections.abc import Collection
from typing import Literal
from uuid import UUID

from sqlalchemy import ColumnElement, Select, Uuid, any_, literal, select
from sqlalchemy.dialects.postgresql import ARRAY

from idraft.db.tables import keyword_groups, taxonomy_terms


def among_ids(column: ColumnElement[UUID], ids: Collection[UUID]) -> ColumnElement[bool]:
    """`column = ANY($1)`: one array parameter however many ids, so a long list never reaches
    the driver's parameter limit."""
    return column == any_(literal(list(ids), type_=ARRAY(Uuid)))


def descendants(
    kind: Literal["group", "term"], roots: Collection[UUID], workspace_id: UUID, name: str
) -> Select[tuple[UUID]]:
    """The ids of the given groups or terms and of every one under them, through `parent_id`.
    `UNION` drops repeats, so even a cycle in the data could not make the query loop. `name`
    names the CTE, so one statement can hold several."""
    table = keyword_groups if kind == "group" else taxonomy_terms
    start = (
        select(table.c.id)
        .where(table.c.workspace_id == workspace_id, among_ids(table.c.id, roots))
        .cte(name=name, recursive=True)
    )
    child = table.alias(f"{name}_child")
    tree = start.union(
        select(child.c.id).where(
            child.c.parent_id == start.c.id, child.c.workspace_id == workspace_id
        )
    )
    return select(tree.c.id)
