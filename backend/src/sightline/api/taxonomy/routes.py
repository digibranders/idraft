"""Vocabulary and term routes (docs/19-api-specification.md section 3.5).

Reading needs `data:read`, changing needs `taxonomy:write`. A member limited to some projects
sees the workspace-wide vocabularies and those of its projects, and changes only the latter.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from sightline.api.pagination import Offset, OffsetPageInfo
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import QueryText
from sightline.api.schemas.taxonomy import (
    Term,
    TermBatch,
    TermBody,
    TermList,
    TermNode,
    TermResponse,
    TermTree,
    TermUpdate,
    Vocabulary,
    VocabularyCreate,
    VocabularyKind,
    VocabularyPage,
    VocabularyResponse,
    VocabularyUpdate,
)
from sightline.api.taxonomy.repository import TermRecord, VocabularyRecord
from sightline.api.taxonomy.service import Branch, TaxonomyService
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["taxonomy"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteTaxonomy = Annotated[WorkspaceAccess, Depends(require_permission(Permission.TAXONOMY_WRITE))]


def get_taxonomy_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> TaxonomyService:
    return resources.taxonomy


Taxonomy = Annotated[TaxonomyService, Depends(get_taxonomy_service)]


def _vocabulary(record: VocabularyRecord) -> Vocabulary:
    return Vocabulary.model_validate(
        {
            "vocabulary_id": record.id,
            "project_id": record.project_id,
            "kind": record.kind,
            "name": record.name,
            "is_hierarchical": record.is_hierarchical,
            "is_single_valued": record.is_single_valued,
            "term_count": record.term_count,
        }
    )


def _term_fields(record: TermRecord) -> dict[str, object]:
    return {
        "term_id": record.id,
        "vocabulary_id": record.vocabulary_id,
        "parent_id": record.parent_id,
        "name": record.name,
        "slug": record.slug,
        "path": record.path,
        "source": record.source,
        "description": record.description,
        "created_at": record.created_at,
    }


def _term(record: TermRecord) -> Term:
    return Term.model_validate(_term_fields(record))


def _node(branch: Branch, counts: Mapping[UUID, int]) -> TermNode:
    return TermNode.model_validate(
        {
            **_term_fields(branch.term),
            "keyword_count": counts.get(branch.term.id, 0),
            "children": [_node(child, counts) for child in branch.children],
        }
    )


@router.get("/vocabularies", summary="Vocabularies, by name")
async def list_vocabularies(
    access: ReadData,
    page: Offset,
    taxonomy: Taxonomy,
    project_id: Annotated[
        UUID | None,
        Query(
            alias="filter[project_id]",
            description="That project's vocabularies and the workspace-wide ones.",
        ),
    ] = None,
    kind: Annotated[VocabularyKind | None, Query(alias="filter[kind]")] = None,
) -> VocabularyPage:
    found, total = await taxonomy.list_vocabularies(
        access, project_id=project_id, kind=kind, page=page
    )
    return VocabularyPage(
        data=[_vocabulary(record) for record in found],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
    )


@router.post(
    "/vocabularies",
    status_code=201,
    summary="Create a vocabulary",
    description="Workspace-wide without `project_id`, which a member limited to some projects "
    "cannot create. `409 duplicate` when the scope has a vocabulary of this kind with this "
    "name, in any case.",
)
async def create_vocabulary(
    body: VocabularyCreate, access: WriteTaxonomy, taxonomy: Taxonomy, info: Info
) -> VocabularyResponse:
    created = await taxonomy.create_vocabulary(
        access,
        kind=body.kind,
        name=body.name,
        project_id=body.project_id,
        is_hierarchical=body.is_hierarchical,
        is_single_valued=body.is_single_valued,
        info=info,
    )
    return VocabularyResponse(data=_vocabulary(created))


@router.patch("/vocabularies/{vocabulary_id}", summary="Change a vocabulary")
async def update_vocabulary(
    vocabulary_id: UUID,
    body: VocabularyUpdate,
    access: WriteTaxonomy,
    taxonomy: Taxonomy,
    info: Info,
) -> VocabularyResponse:
    updated = await taxonomy.update_vocabulary(
        access, vocabulary_id, body.model_dump(include=body.model_fields_set), info
    )
    return VocabularyResponse(data=_vocabulary(updated))


@router.delete(
    "/vocabularies/{vocabulary_id}", status_code=204, summary="Delete a vocabulary and its terms"
)
async def delete_vocabulary(
    vocabulary_id: UUID, access: WriteTaxonomy, taxonomy: Taxonomy, info: Info
) -> Response:
    await taxonomy.delete_vocabulary(access, vocabulary_id, info)
    return Response(status_code=204)


@router.get(
    "/vocabularies/{vocabulary_id}/terms",
    summary="A vocabulary's terms, as a tree or flat",
    description="In path order. `flat` lists every term with empty `children`.",
)
async def list_terms(
    vocabulary_id: UUID,
    access: ReadData,
    taxonomy: Taxonomy,
    format: Annotated[Literal["tree", "flat"], Query()] = "tree",
    q: Annotated[
        QueryText | None,
        Query(
            alias="filter[q]",
            description="Terms whose name holds the text; the tree keeps their ancestors.",
        ),
    ] = None,
) -> TermTree:
    branches, counts = await taxonomy.terms(access, vocabulary_id, q=q, tree=format == "tree")
    return TermTree(data=[_node(branch, counts) for branch in branches])


@router.post(
    "/vocabularies/{vocabulary_id}/terms",
    status_code=201,
    summary="Add one term or a batch",
    description="Items are added in order. A `path` reuses the terms it names that exist, "
    "matched by name in any case, and creates the others; a path that exists adds nothing. "
    "The response lists the terms created. `409 duplicate` when a `name` item, or a given "
    "`slug`, is taken under its parent; `422 not_hierarchical` for a parent in a flat "
    "vocabulary.",
)
async def add_terms(
    vocabulary_id: UUID,
    body: TermBody,
    access: WriteTaxonomy,
    taxonomy: Taxonomy,
    info: Info,
) -> TermList:
    items = body.items if isinstance(body, TermBatch) else [body]
    created = await taxonomy.add_terms(
        access, vocabulary_id, items, batch=isinstance(body, TermBatch), info=info
    )
    return TermList(data=[_term(term) for term in created])


@router.patch(
    "/terms/{term_id}",
    summary="Change or move a term",
    description="A new `slug` or `parent_id` rewrites the paths of the whole subtree. The name "
    "keeps its slug unless a slug is given. `422 cycle_detected` for a parent under the term.",
)
async def update_term(
    term_id: UUID, body: TermUpdate, access: WriteTaxonomy, taxonomy: Taxonomy, info: Info
) -> TermResponse:
    updated = await taxonomy.update_term(
        access, term_id, body.model_dump(include=body.model_fields_set), info
    )
    return TermResponse(data=_term(updated))


@router.delete(
    "/terms/{term_id}",
    status_code=204,
    summary="Delete a term",
    description="`409 has_children` for a term with children, unless `cascade=true`.",
)
async def delete_term(
    term_id: UUID,
    access: WriteTaxonomy,
    taxonomy: Taxonomy,
    info: Info,
    cascade: Annotated[bool, Query(description="Delete its subtree too.")] = False,
) -> Response:
    await taxonomy.delete_term(access, term_id, cascade=cascade, info=info)
    return Response(status_code=204)
