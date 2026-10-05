"""Keyword import routes (docs/19-api-specification.md section 3.6.3; the imports sub-plan, rule
I1). Reading needs `data:read` and changing `imports:write`. The membership dependency has
already refused a project outside the caller's scope.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Annotated, Final
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from sightline.api.imports.service import ImportDetail, ImportService, has_report
from sightline.api.pagination import Commas, Cursor, CursorPageInfo
from sightline.api.permissions import Permission
from sightline.api.problems import invalid_field
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import UserRef
from sightline.api.schemas.imports import (
    ImportCounts,
    ImportOptions,
    ImportQuota,
    ImportRow,
    ImportRowPage,
    ImportStatus,
    KeywordImport,
    KeywordImportConfirm,
    KeywordImportCreate,
    KeywordImportPage,
    KeywordImportResponse,
    KeywordImportUpdate,
    Outcome,
    RowAction,
)
from sightline.api.schemas.operations import (
    Operation,
    OperationError,
    OperationLinks,
    OperationStatus,
    Progress,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports",
    tags=["imports"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteImports = Annotated[WorkspaceAccess, Depends(require_permission(Permission.IMPORTS_WRITE))]

# An import's status as an operation's (docs/19 section 2.11).
_OPERATION_STATUS: Final[Mapping[str, OperationStatus]] = {
    "uploaded": "queued",
    "parsing": "queued",
    "needs_mapping": "waiting_for_input",
    "preview_ready": "waiting_for_input",
    "writing": "running",
    "completed": "succeeded",
    "completed_with_errors": "succeeded_with_errors",
    "failed": "failed",
    "expired": "failed",
    "cancelled": "cancelled",
}
_FAILURES: Final[Mapping[str, str]] = {
    "not_utf8": "The file is not UTF-8 text.",
    "not_csv": "The file is not readable as CSV.",
    "no_header": "The file has no header row.",
    "duplicate_headers": "Two columns have the same header, without regard to case.",
    "too_many_rows": "An import has at most 10,000 rows.",
    "too_many_columns": "An import has at most 100 columns.",
    "parse_failed": "The source could not be read. Upload it again.",
    "write_failed": "The write stopped on an error. The report shows what was written.",
    "source_corrupt": "The stored source could not be read. Upload the file again.",
    "source_unreadable": "The stored source could not be fetched. Upload the file again.",
    "project_gone": "The project was deleted.",
    "expired": "The preview expired before it was confirmed.",
}
_COUNTS: Final = ("rows_total", "new", "duplicate", "variant", "conflict", "invalid")
_RESULTS: Final = ("created", "skipped", "merged")
_OPEN: Final = frozenset({"uploaded", "needs_mapping", "preview_ready"})
_WAITING_FOR_ROWS: Final = frozenset({"uploaded", "parsing", "needs_mapping"})


def get_import_service(resources: Annotated[Resources, Depends(get_resources)]) -> ImportService:
    return resources.imports


Imports = Annotated[ImportService, Depends(get_import_service)]


def import_view(detail: ImportDetail, workspace_id: UUID) -> KeywordImport:
    record = detail.record
    base = (
        f"/api/v1/workspaces/{workspace_id}/projects/{record.project_id}"
        f"/keyword-imports/{record.id}"
    )
    counts = {name: record.counts.get(name, 0) for name in (*_COUNTS, *_RESULTS)}
    error_code = record.error_code if record.status == "failed" else None
    if record.status == "expired":
        error_code = "expired"
    error = (
        None
        if error_code is None
        else OperationError(
            code=error_code, detail=_FAILURES.get(error_code, "The import could not be read.")
        )
    )
    return KeywordImport.model_validate(
        {
            "import_id": record.id,
            "source": record.source,
            "original_filename": record.original_filename,
            "status": record.status,
            "column_mapping": record.column_mapping,
            "defaults": record.defaults,
            "counts": ImportCounts.model_validate(counts),
            "quota": None
            if detail.quota is None
            else ImportQuota(
                limit=detail.quota.limit, used=detail.quota.used, would_use=detail.quota.would_use
            ),
            "error_code": record.error_code,
            "created_by": UserRef(
                user_id=record.created_by,
                name=record.created_by_name,
                email=record.created_by_email,
            ),
            "created_at": record.created_at,
            "expires_at": record.expires_at,
            "finished_at": record.finished_at,
            "operation": Operation(
                kind="keyword_import",
                status=_OPERATION_STATUS[record.status],
                progress=Progress(
                    done=record.rows_done,
                    total=None
                    if record.status in _WAITING_FOR_ROWS
                    else record.counts.get("rows_total"),
                    unit="rows",
                ),
                started_at=record.created_at,
                finished_at=record.finished_at,
                error=error,
                links=OperationLinks(
                    self=base,
                    result=f"{base}/report" if has_report(record) else None,
                    cancel=f"{base}/cancel" if record.status in _OPEN else None,
                ),
            ),
        }
    )


def _options(text: str | None) -> ImportOptions:
    """The `options` part of an upload: the JSON of `ImportOptions`, or nothing."""
    if text is None or not text.strip():
        return ImportOptions()
    try:
        given = json.loads(text)
    except ValueError:
        raise invalid_field(
            "options", code="not_json", message="The options part is not JSON."
        ) from None
    try:
        return ImportOptions.model_validate(given)
    except ValidationError as error:
        raise RequestValidationError(
            [
                {"loc": ("body", "options", *item["loc"]), "type": item["type"], "msg": item["msg"]}
                for item in error.errors()
            ]
        ) from None


@router.post(
    "",
    status_code=202,
    summary="Import keywords from paste text or rows",
    description="`source: 'paste'` takes `paste` (one keyword per line, tags after a TAB); "
    "`source: 'api'` takes `rows`. The worker reads the source into a preview within seconds: "
    "poll the import until it is `preview_ready` (or `needs_mapping`). A vocabulary named for "
    "tags or topics needs `taxonomy:write`.",
)
async def create_import(
    project_id: UUID,
    body: KeywordImportCreate,
    access: WriteImports,
    imports: Imports,
    info: Info,
) -> KeywordImportResponse:
    detail = await imports.create(access, project_id, body, info)
    return KeywordImportResponse(data=import_view(detail, access.workspace_id))


@router.post(
    "/upload",
    status_code=202,
    summary="Import keywords from a CSV file (multipart, up to 50 MB)",
    description="Parts: `file` (CSV, UTF-8; a byte order mark is fine) and `options` (the JSON "
    "of `ImportOptions`). `415 unsupported_media_type` for another kind of file, `413` over "
    "50 MB. The delimiter is the comma, semicolon or tab the header line uses most.",
)
async def upload_import(
    project_id: UUID,
    access: WriteImports,
    imports: Imports,
    info: Info,
    file: Annotated[UploadFile, File(description="CSV, UTF-8 (a BOM is fine).")],
    options: Annotated[str | None, Form(description="The JSON of `ImportOptions`.")] = None,
) -> KeywordImportResponse:
    parsed = _options(options)
    detail = await imports.upload(
        access,
        project_id,
        filename=file.filename,
        content_type=file.content_type,
        data=await file.read(),
        options=parsed,
        info=info,
    )
    return KeywordImportResponse(data=import_view(detail, access.workspace_id))


@router.get("", summary="The project's imports, newest first")
async def list_imports(
    project_id: UUID,
    access: ReadData,
    page: Cursor,
    imports: Imports,
    status: Annotated[ImportStatus | None, Query(alias="filter[status]")] = None,
) -> KeywordImportPage:
    found = await imports.page(
        access, project_id, status=status, cursor=page.cursor, limit=page.limit
    )
    return KeywordImportPage(
        data=[import_view(detail, access.workspace_id) for detail in found.imports],
        page=CursorPageInfo(
            limit=page.limit, next_cursor=found.next_cursor, has_more=found.next_cursor is not None
        ),
    )


@router.get("/{import_id}", summary="One import")
async def get_import(
    project_id: UUID, import_id: UUID, access: ReadData, imports: Imports
) -> KeywordImportResponse:
    detail = await imports.get(access, project_id, import_id)
    return KeywordImportResponse(data=import_view(detail, access.workspace_id))


@router.get(
    "/{import_id}/rows",
    summary="The preview rows, in file order",
    description="`409 invalid_state_transition` until the worker has read the source. A row "
    "with `device: 'both'` is two rows (`part` 1 and 2). `keyword` is the cleaned text, or "
    "what was typed for an invalid row.",
)
async def import_rows(
    project_id: UUID,
    import_id: UUID,
    access: ReadData,
    page: Cursor,
    imports: Imports,
    outcomes: Annotated[
        list[Outcome] | None, Commas, Query(alias="filter[outcome_in]", max_length=5)
    ] = None,
    action: Annotated[RowAction | None, Query(alias="filter[action]")] = None,
) -> ImportRowPage:
    found = await imports.rows(
        access,
        project_id,
        import_id,
        outcomes=frozenset(outcomes or ()),
        action=action,
        cursor=page.cursor,
        limit=page.limit,
    )
    return ImportRowPage(
        data=[
            ImportRow.model_validate(
                {
                    "row_no": row.row_no,
                    "part": row.part,
                    "raw": row.raw,
                    "keyword": row.keyword_text,
                    "normalized_text": row.normalized_text,
                    "language_code": row.language_code,
                    "device": row.device,
                    "location_id": row.location_id,
                    "outcome": row.outcome,
                    "reason_code": row.reason_code,
                    "reason": row.reason,
                    "existing_tracked_keyword_id": row.existing_tracked_keyword_id,
                    "action": row.action,
                }
            )
            for row in found.rows
        ],
        page=CursorPageInfo(
            limit=page.limit, next_cursor=found.next_cursor, has_more=found.next_cursor is not None
        ),
    )


@router.patch(
    "/{import_id}",
    status_code=202,
    summary="Change the mapping, defaults or row actions",
    description="`column_mapping` (file header to field) and `defaults` make the worker read "
    "the source again: the import is `uploaded` until its new preview is ready. `row_actions` "
    "choose what happens to rows of the ready preview, and cannot be sent together with the "
    "others. Allowed actions: `create` or `skip` for a new row or a casing variant; `skip` or "
    "`merge` for a tracked duplicate or an archived keyword; `skip` for the rest. "
    "`409 invalid_state_transition` once the import is writing or has ended.",
)
async def update_import(
    project_id: UUID,
    import_id: UUID,
    body: KeywordImportUpdate,
    access: WriteImports,
    imports: Imports,
    info: Info,
) -> KeywordImportResponse:
    detail = await imports.update(access, project_id, import_id, body, info)
    return KeywordImportResponse(data=import_view(detail, access.workspace_id))


@router.post(
    "/{import_id}/confirm",
    status_code=202,
    summary="Confirm a ready preview and have it written",
    description="The worker writes the rows in batches of 1,000 (`status: 'writing'`); poll the "
    "import until it is `completed` or `completed_with_errors`, then read the report. "
    "`duplicate_action: 'merge_terms'` merges the groups and terms of rows left at `skip` into "
    "the keywords they duplicate. `409 invalid_state_transition` unless the preview is ready "
    "and has not expired; `422 quota_exceeded` (with `limit`, `used`, `requested`) when the "
    "rows to create and the archived keywords to bring back do not fit, and nothing changes.",
)
async def confirm_import(
    project_id: UUID,
    import_id: UUID,
    body: KeywordImportConfirm,
    access: WriteImports,
    imports: Imports,
    info: Info,
) -> KeywordImportResponse:
    detail = await imports.confirm(access, project_id, import_id, body, info)
    return KeywordImportResponse(data=import_view(detail, access.workspace_id))


@router.post(
    "/{import_id}/cancel",
    summary="Cancel an import before it writes",
    description="`409 invalid_state_transition` once it is writing or has ended.",
)
async def cancel_import(
    project_id: UUID, import_id: UUID, access: WriteImports, imports: Imports, info: Info
) -> KeywordImportResponse:
    detail = await imports.cancel(access, project_id, import_id, info)
    return KeywordImportResponse(data=import_view(detail, access.workspace_id))


@router.get(
    "/{import_id}/report",
    summary="The import report as CSV",
    description="One line per row (`row_no`, `part`, `keyword`, `location_id`, "
    "`language_code`, `device`, `outcome`, `reason_code`, `reason`, `action`, `result`, "
    "`tracked_keyword_id`, `write_error_code`). A cell a spreadsheet could run as a formula "
    "starts with `'`. `409 invalid_state_transition` while there is nothing to report on.",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}, "description": "The report."}},
)
async def import_report(
    project_id: UUID, import_id: UUID, access: ReadData, imports: Imports
) -> Response:
    text = await imports.report(access, project_id, import_id)
    return Response(
        content=text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="import-{import_id}.csv"'},
    )
