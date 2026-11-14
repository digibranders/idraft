# WP-01 backend scaffolding: detailed task plan

Brief: [docs/ai-visibility/work-packages/WP-01-backend-scaffold.md](../../ai-visibility/work-packages/WP-01-backend-scaffold.md).
Master plan: [docs/ai-visibility/MASTER-PLAN.md](../../ai-visibility/MASTER-PLAN.md) sections 3.3, 3.6, 3.7, 4, 5.

Worktree (every path below is under it): `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-wp-01-backend-scaffold-0d8e58`, written `$WT` below.
Branch: `claude/ai-wp-01-backend-scaffold-0d8e58` (the worktree's branch; `infra/dev/wp-start` and `infra/dev/wp-status` do not exist on develop yet, WP-00 builds them, so status lines go to the coordinator as a message only).

## Goal

Touch every backend hot spot once, so later packages add only their own files and their own lines:

- 22 empty router modules of MASTER-PLAN 3.3, each included in `api/main.py` in the table's order;
- 13 empty schema modules `api/schemas/ai_*.py`;
- permission keys `layouts:manage` (owner, admin) and `notes:write` (owner, admin, editor);
- problem classes `precondition_failed` (412), `panel_locked`, `reason_required`, `core_panel_exists`, `template_language_unsupported` (422 each) and `not_implemented` (501);
- one anchor line per package in the tables of `tests/api/test_route_access.py` and `tests/security/test_cross_tenant.py`.

## Architecture notes (what the code does today, checked on this worktree)

- FastAPI is 0.142.1. `app.include_router(router)` appends one `_IncludedRouter` to `app.routes`; an empty router yields no route context from `fastapi.routing.iter_route_contexts`, so `test_route_access.py`, `test_cross_tenant.py` and the OpenAPI document see nothing new. Checked: including two empty routers (one with a prefix and tags) leaves `build_schema(app)` byte-identical and the route context count at 153.
- `Permission` is not emitted in OpenAPI. `grep -c 'views:write' backend/openapi/v1.json apps/web/src/lib/api/schema.ts` prints 0 for both: a membership's `permissions` is `list[str]` (`schemas/workspaces.py`, filled by `permissions_for`). The docstring of `permissions.py`, doc 19 section 2.13 and the doc 24 section 3.2 heading say otherwise; they are stale.
- Problem codes are not emitted either: `Problem.code` is `str`. New `ProblemError` subclasses change nothing in OpenAPI.
- The web keeps its own copy of the keys: `apps/web/src/lib/permissions/permissions.ts` (`PERMISSIONS`) and `apps/web/src/mocks/factories/permissions.ts` (`PERMISSION_HOLDERS`). `apps/web/src/mocks/factories/permissions.test.ts` reads `backend/src/idraft/api/permissions.py` as text and compares the role tables. It parses `_HOLDERS` with the regex `Permission\.([A-Z_]+): (.+),$`, so a `_HOLDERS` line must end with the comma: no comment after it.
- A request goes to the first route whose path matches, across included routers in registration order, and a path parameter matches any segment. Checked: router A `GET /x/{item_id}` (UUID) included before router B `GET /x/limits` answers `GET /x/limits` with 422 `uuid_parsing`. Today no route of the app is hidden by an earlier one (checked over all 153 contexts).
- `ruff format` removes every blank line inside a dict or set literal (checked with `ruff format -` on stdin), but keeps blank lines in a function body. Insertions under two adjacent comment lines merge without conflict (checked with `git merge-file`: one side inserts under `# WP-11`, the other under `# WP-12`, clean result).
- `Resources` (`api/resources.py`) is a frozen dataclass built once in the lifespan in `main.py`. Route modules read their service through a small dependency (`get_cost_service(resources) -> resources.costs`). Every service is a thin object over `sessions` (some also take `redis`, `http`, `import_store` or `settings`), all of which `Resources` holds.

## Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | OpenAPI does not change. `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` stay byte-identical; no `pnpm gen:api` in this package. | Empty routers add no path, and neither the permission enum nor problem codes are in the document (checked, see notes). T5 verifies it. |
| D2 | No new slots on `Resources`, no change to `resources.py` or the lifespan. Each later route module builds its service in its own dependency from `Resources` (template in T1). | Services are stateless wrappers over `sessions` and the other shared clients already on `Resources`, so one object per request costs nothing measurable. A placeholder slot would need a type the owning package must change anyway, which is the hot-file edit this package exists to remove. Exception: a service that must live across requests (a cache, a semaphore) takes a lease on `resources.py` and `main.py`. |
| D3 | The new routers are included right after `auth_router` and before `workspaces_router`, in MASTER-PLAN 3.3 order. A new test fails when any route is hidden by an earlier one. | A new static segment (for example `.../prompts/limits`) must not be taken by an older parameter route (`.../prompts/{prompt_id}`): the packages can no longer reorder `main.py`. The test catches the opposite case too. |
| D4 | Empty routers are `APIRouter()` with no prefix and no tags. | The owning package (or WP-03 for signatures) sets prefix and tags in its own file; guessing them here could be wrong and changes nothing now. |
| D5 | Anchor lines are consecutive comments (`# WP-11 layouts-api`), no blank line between them inside the literals; blank lines between them in the `_tenant` function body. | `ruff format` deletes blank lines inside literals (the brief's blank line cannot survive `ruff format --check`); adjacent anchors still merge cleanly. |
| D6 | Anchors for every package of kind backend or both except WP-01: 31 packages (list in T4). | One rule, no guessing which package adds a route or a table; one line each. |
| D7 | Anchored tables: `EXPECTED` and `PATH_PARAMETERS` (route access); `BODIES`, `QUERIES`, `_TENANT_ROWS` and the seeding block of `_tenant` (cross-tenant). The one to three line sets `WORDS`, `EVERY_PROJECT_ONLY`, `UPLOADS`, `PLATFORM_LISTS`, `COUNT_ROUTES` get no anchors. | A new route needs an `EXPECTED` line, often a new path parameter, a body and a seeded id; those are the tables every package touches. The small sets change rarely; a clash there is two one-line additions at the end, resolved by keeping both. 31 more lines in each of five tiny sets would bury them. |
| D8 | `Tenant` gains `more_ids: dict[str, str]` (default empty), merged into `ids()`; `_tenant` gets one seeding block with one anchor per package. | Without it, a package with a new path parameter edits four places of `Tenant` (field, `ids()`, seeding, constructor call). With it, one block. `secrets()` already includes every `ids()` value, so seeded ids are checked for leaks automatically. |
| D9 | Statuses: `panel_locked` 422, `reason_required` 422, `core_panel_exists` 422 (doc 19 section 2.7 table and section 3.7.2); `template_language_unsupported` 422 (no spec names a status; 422 like `engine_not_enabled`: a valid request the server cannot serve for this input). | Follow doc 19 where it speaks. |
| D10 | Class `NotImplementedProblemError`, not `NotImplementedError`. | Avoid shadowing the builtin; the house already uses the `ProblemError` suffix for clashes (`EntityInUseProblemError`, `WeakPasswordProblemError`). |
| D11 | The web keeps parity in the same commit as the backend keys (T2 edits `apps/web/src/lib/permissions/permissions.ts` and `apps/web/src/mocks/factories/permissions.ts`). | Otherwise `permissions.test.ts` fails on develop. No package owns these two files; tell the coordinator in the T2 report. |
| D12 | `notes:write` gets a row in the doc 24 section 3.2 matrix (after `layouts:manage`), same commit as T2. | The matrix is canonical and the code follows its row order; `layouts:manage` has its row already. |
| D13 | A test asserts each problem code belongs to one class across every module the app loads. | Later packages add codes in their own modules; two classes with one code and two statuses would reach the client as one code. Today 51 codes, 51 classes, no clash (checked). |

## Risks

| Risk | Mitigation |
|---|---|
| A later route is shadowed by an earlier router's parameter (silent 422) | D3 placement plus `test_no_route_is_hidden_by_an_earlier_one` |
| Web parity test red after T2 | T2 edits both web files in the same commit and runs `permissions.test.ts` |
| A trailing comment on a `_HOLDERS` line breaks the web parser | No trailing comments; the D-11 and D-18 note goes on its own line above |
| Another session edits `main.py`, `permissions.py`, `problems.py` or the two security tests before WP-01 merges | Rebase right before each push; on a conflict keep both sides, then re-run the T1 to T4 tests |
| `infra/dev/heavy` is not on develop yet | Targeted pytest only (`--no-cov -n 2`); the full `./check.sh` through the lock once WP-00 lands, or with the coordinator's go-ahead (T5) |
| `test_cross_tenant.py` needs Docker (PostgreSQL); the other touched tests do not | Run it with the Colima variables; never restart Colima or stop `idraft-dev-*` containers |

## Common commands

Light checks (no lock), from `$WT/backend`:

```bash
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run lint-imports
```

Targeted tests (medium lane), from `$WT/backend` (Colima must be running: `colima status`; start it only if it is stopped, never restart it):

```bash
cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest <path> --no-cov -n 2 -q
```

`backend/check.sh` runs, in order: `ruff check .`, `ruff format --check .`, `mypy`, `lint-imports`, `pytest -n 4`. Never run it without a path before T5.

House rules for every task: tests first; edit files with the file tools only (no heredocs, `sed`, replace scripts, no `ruff --fix`); ASCII only; no em or en dashes in code comments, docs or commit messages; one commit per task, message `WP-01: <task title>`, no attribution lines; `git add` names this task's files only.

---

## T1: Empty routers and schema modules, registered in order

Brief step 1. Rows: BE-OPS-01 (confirmed: no route added, the suites still cover every route), BE-OPS-02 (confirmed: no aggregate added; nothing to count).

### Files

Create (each a package `__init__.py` with a one-line docstring):

| Full path | Docstring |
|---|---|
| `$WT/backend/src/idraft/api/layouts/__init__.py` | `"""Team default and personal page layouts."""` |
| `$WT/backend/src/idraft/api/notes/__init__.py` | `"""Notes members write on a project's charts."""` |
| `$WT/backend/src/idraft/api/uploads/__init__.py` | `"""File uploads for prompt candidates."""` |
| `$WT/backend/src/idraft/api/alerts/__init__.py` | `"""Alert rules, alert events and digests."""` |
| `$WT/backend/src/idraft/api/views/__init__.py` | `"""Saved views."""` |
| `$WT/backend/src/idraft/api/exports/__init__.py` | `"""Exports and their downloads."""` |
| `$WT/backend/src/idraft/api/reports/__init__.py` | `"""Reports."""` |
| `$WT/backend/src/idraft/api/webhooks/__init__.py` | `"""Outbound webhook endpoints and their deliveries."""` |

Create the 22 router modules, in MASTER-PLAN 3.3 order (module, owner, first docstring line):

| # | Full path | Owner | First docstring line |
|---|---|---|---|
| 1 | `$WT/backend/src/idraft/api/layouts/routes.py` | WP-11 (layouts-api) | Team default and personal page layouts. |
| 2 | `$WT/backend/src/idraft/api/ai/limits_routes.py` | WP-13 (prompts-lane) | The quota and limits read before a prompt is added or run. |
| 3 | `$WT/backend/src/idraft/api/operations/collection_routes.py` | WP-30 (runs-costs-health) | Daily AI collection and the AI coverage of a run. |
| 4 | `$WT/backend/src/idraft/api/ai/metrics_routes.py` | WP-32 (overview-aggregates) | Overview metrics, their series and breakdowns. |
| 5 | `$WT/backend/src/idraft/api/ai/competitor_routes.py` | WP-32 (overview-aggregates) | Competitor visibility across the project's AI answers. |
| 6 | `$WT/backend/src/idraft/api/ai/annotation_routes.py` | WP-38 (notes-annotations) | Chart annotations: model, entity set, extractor and prompt set changes. |
| 7 | `$WT/backend/src/idraft/api/notes/routes.py` | WP-38 (notes-annotations) | Notes on a project's charts, written with `notes:write`. |
| 8 | `$WT/backend/src/idraft/api/ai/version_routes.py` | WP-41 (versions) | Prompt versions: history, new wording and restore. |
| 9 | `$WT/backend/src/idraft/api/ai/panel_routes.py` | WP-42 (panels-api) | Prompt panels and their memberships, the locked core panel among them. |
| 10 | `$WT/backend/src/idraft/api/ai/link_routes.py` | WP-44 (links-generate) | Links between tracked keywords and prompts, and prompts generated from keywords. |
| 11 | `$WT/backend/src/idraft/api/ai/candidate_routes.py` | WP-45 (candidates-api) | Prompt candidates: generate, list and decide. |
| 12 | `$WT/backend/src/idraft/api/uploads/routes.py` | WP-45 (candidates-api) | File uploads for prompt candidates. |
| 13 | `$WT/backend/src/idraft/api/alerts/routes.py` | WP-47 (alerts-api) | Alert rules, alert events and digests. |
| 14 | `$WT/backend/src/idraft/api/views/routes.py` | WP-49 (saved-views) | Saved views. |
| 15 | `$WT/backend/src/idraft/api/exports/routes.py` | WP-50 (exports) | Exports and their downloads. |
| 16 | `$WT/backend/src/idraft/api/reports/routes.py` | WP-51 (reports) | Reports. |
| 17 | `$WT/backend/src/idraft/api/ai/derivation_routes.py` | WP-56 (rederive-candidates) | Derivations of AI answers and re-derivation. |
| 18 | `$WT/backend/src/idraft/api/entities/candidate_routes.py` | WP-56 (rederive-candidates) | Entity candidates found in AI answers. |
| 19 | `$WT/backend/src/idraft/api/ai/retrieval_routes.py` | WP-57 (retrieval-fanout) | Pages the engines retrieved while answering. |
| 20 | `$WT/backend/src/idraft/api/ai/stats_routes.py` | WP-58 (stats-api) | Statistics: intervals, comparisons and volatility. |
| 21 | `$WT/backend/src/idraft/api/ai/source_intel_routes.py` | WP-60 (source-intel-api) | Source intelligence: source changes and influential pages. |
| 22 | `$WT/backend/src/idraft/api/webhooks/routes.py` | WP-63 (ssrf-webhooks) | Outbound webhook endpoints and their deliveries. |

Template, shown for row 1 (the others change only the first line and the owner):

```python
"""Team default and personal page layouts.

WP-11 (layouts-api) fills this router; api/main.py includes it already (docs/ai-visibility/
MASTER-PLAN.md section 3.3). Its service comes from a dependency in this file, built from
`Resources`, so resources.py and main.py stay as they are.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
```

Keep each docstring line within 100 characters (ruff E501). For the owner's later service dependency (D2), the shape to follow (do not add it now; it is for the owning package):

```python
def get_layout_service(resources: Annotated[Resources, Depends(get_resources)]) -> LayoutService:
    return LayoutService(sessions=resources.sessions)


Layouts = Annotated[LayoutService, Depends(get_layout_service)]
```

Create the 13 schema modules, each one docstring line and nothing else:

| Full path | Content |
|---|---|
| `$WT/backend/src/idraft/api/schemas/ai_layouts.py` | `"""Request and response models of layouts (WP-11 layouts-api)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_limits.py` | `"""Request and response models of the quota and limits read (WP-13 prompts-lane)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_metrics.py` | `"""Request and response models of the overview metrics (WP-32 overview-aggregates)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_versions.py` | `"""Request and response models of prompt versions (WP-41 versions)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_panels.py` | `"""Request and response models of prompt panels (WP-42 panels-api)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_links.py` | `"""Request and response models of keyword and prompt links (WP-44 links-generate)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_candidates.py` | `"""Request and response models of prompt candidates (WP-45 candidates-api)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_alerts.py` | `"""Request and response models of alerts (WP-47 alerts-api)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_views.py` | `"""Request and response models of saved views (WP-49 saved-views)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_exports.py` | `"""Request and response models of exports (WP-50 exports)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_notes.py` | `"""Request and response models of notes and annotations (WP-38 notes-annotations)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_stats.py` | `"""Request and response models of the statistics reads (WP-58 stats-api)."""` |
| `$WT/backend/src/idraft/api/schemas/ai_collection.py` | `"""Request and response models of daily AI collection (WP-30 runs-costs-health)."""` |

Edit: `$WT/backend/src/idraft/api/main.py` (imports and registration lines only), `$WT/backend/tests/api/test_route_access.py` (two tests, one helper).

### Tests first (in `$WT/backend/tests/api/test_route_access.py`)

Add `import importlib` to the imports and `from idraft.api.workspaces.routes import router as workspaces_router` (keep isort order: `importlib` and `re` in the stdlib block; the new `idraft` import after `idraft.api.permissions`). Add after `test_no_router_adds_a_query_parameter_to_the_routes_it_includes`:

```python
# The routers of docs/ai-visibility/MASTER-PLAN.md section 3.3, in that table's order. Each work
# package fills its own; api/main.py includes them all already.
SCAFFOLDED = (
    "idraft.api.layouts.routes",
    "idraft.api.ai.limits_routes",
    "idraft.api.operations.collection_routes",
    "idraft.api.ai.metrics_routes",
    "idraft.api.ai.competitor_routes",
    "idraft.api.ai.annotation_routes",
    "idraft.api.notes.routes",
    "idraft.api.ai.version_routes",
    "idraft.api.ai.panel_routes",
    "idraft.api.ai.link_routes",
    "idraft.api.ai.candidate_routes",
    "idraft.api.uploads.routes",
    "idraft.api.alerts.routes",
    "idraft.api.views.routes",
    "idraft.api.exports.routes",
    "idraft.api.reports.routes",
    "idraft.api.ai.derivation_routes",
    "idraft.api.entities.candidate_routes",
    "idraft.api.ai.retrieval_routes",
    "idraft.api.ai.stats_routes",
    "idraft.api.ai.source_intel_routes",
    "idraft.api.webhooks.routes",
)


def test_the_scaffolded_routers_are_included_once_in_order_before_the_older_ones() -> None:
    included = [
        getattr(route, "original_router", None)
        for route in create_app(placeholder_settings()).routes
    ]
    positions: list[int] = []
    for name in SCAFFOLDED:
        router = importlib.import_module(name).router
        found = [index for index, candidate in enumerate(included) if candidate is router]
        assert len(found) == 1, name
        positions.append(found[0])
    assert positions == sorted(positions)
    older = [index for index, candidate in enumerate(included) if candidate is workspaces_router]
    assert positions[-1] < older[0]


# `{name}` or `{name:converter}` once the path is escaped for a regular expression.
_ESCAPED_PARAMETER = re.compile(r"\\\{\w+(?::\w+)?\\\}")


def _matcher(path: str) -> re.Pattern[str]:
    """What the router matches for a route's path: any one segment where it has a parameter."""
    return re.compile(_ESCAPED_PARAMETER.sub("[^/]+", re.escape(path)))


def test_a_parameter_matches_any_one_segment() -> None:
    matcher = _matcher("/projects/{project_id}/prompts/{prompt_id:uuid}")
    assert matcher.fullmatch("/projects/{project_id}/prompts/limits")
    assert matcher.fullmatch("/projects/p-1/prompts/{other_id}")
    assert not matcher.fullmatch("/projects/{project_id}/prompts")
    assert not matcher.fullmatch("/projects/{project_id}/prompts/a/b")


def test_no_route_is_hidden_by_an_earlier_one() -> None:
    """A request goes to the first route whose path matches, and a parameter matches any word:
    `GET .../prompts/limits` after `GET .../prompts/{prompt_id}` would answer 422. The routers
    of the AI visibility packages are included before the older ones, so a new word is safe and
    a new parameter where an older route has a word is not."""
    earlier: list[tuple[str, str, re.Pattern[str]]] = []
    hidden: list[tuple[str, str, str]] = []
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        for method in sorted(route.methods):
            hidden += [
                (method, path, route.path)
                for seen, path, matcher in earlier
                if seen == method and matcher.fullmatch(route.path)
            ]
        earlier += [(method, route.path, _matcher(route.path)) for method in sorted(route.methods)]
    assert hidden == []
```

If a line is over 100 characters after `ruff format`, let the formatter's wrapping stand (run `uv run ruff format tests/api/test_route_access.py`; formatting is not a replace script). Expected before the code: `test_the_scaffolded_routers_are_included_once_in_order_before_the_older_ones` fails with `ModuleNotFoundError: No module named 'idraft.api.layouts'`; the two shadow tests pass already (they guard; T1's bite list proves they fail when weakened).

### Code

`$WT/backend/src/idraft/api/main.py`, imports: add these 22 lines, each at its isort position (the result was produced with `ruff check --select I` on stdin; `uv run ruff check src/idraft/api/main.py` must report nothing):

| New import line | Goes right after |
|---|---|
| `from idraft.api.ai.annotation_routes import router as ai_annotations_router` | `from idraft.api.access_log import AccessLogMiddleware` |
| `from idraft.api.ai.candidate_routes import router as ai_candidates_router` | the line above |
| `from idraft.api.ai.competitor_routes import router as ai_competitors_router` | the line above |
| `from idraft.api.ai.derivation_routes import router as ai_derivations_router` | the line above (then the existing `engine_routes` line) |
| `from idraft.api.ai.limits_routes import router as ai_limits_router` | `from idraft.api.ai.engine_service import EngineService` |
| `from idraft.api.ai.link_routes import router as ai_links_router` | the line above |
| `from idraft.api.ai.metrics_routes import router as ai_metrics_router` | the line above (then `observation_routes`) |
| `from idraft.api.ai.panel_routes import router as ai_panels_router` | `from idraft.api.ai.observations import ObservationService` |
| `from idraft.api.ai.retrieval_routes import router as ai_retrieval_router` | `from idraft.api.ai.prompt_service import PromptService` |
| `from idraft.api.ai.source_intel_routes import router as ai_source_intel_router` | the line above (then `source_routes`) |
| `from idraft.api.ai.stats_routes import router as ai_stats_router` | `from idraft.api.ai.sources import SourceService` |
| `from idraft.api.ai.version_routes import router as ai_versions_router` | `from idraft.api.ai.summary_routes import router as ai_summary_router` |
| `from idraft.api.alerts.routes import router as alerts_router` | the line above (then `auth.passwords`) |
| `from idraft.api.entities.candidate_routes import router as entity_candidates_router` | `from idraft.api.document import router as document_router` |
| `from idraft.api.exports.routes import router as exports_router` | `from idraft.api.entities.service import EntityService` |
| `from idraft.api.layouts.routes import router as layouts_router` | `from idraft.api.keywords.service import KeywordService` |
| `from idraft.api.notes.routes import router as notes_router` | the line above |
| `from idraft.api.operations.collection_routes import router as collection_routes_router` | the line above (then `operations.cost_routes`) |
| `from idraft.api.reports.routes import router as reports_router` | `from idraft.api.registries import router as registries_router` |
| `from idraft.api.uploads.routes import router as uploads_router` | `from idraft.api.taxonomy.service import TaxonomyService` |
| `from idraft.api.views.routes import router as views_router` | the line above |
| `from idraft.api.webhooks.routes import router as webhooks_router` | the line above (then `workspaces.invitations`) |

`$WT/backend/src/idraft/api/main.py`, registration: between `app.include_router(auth_router)` and `app.include_router(workspaces_router)` insert exactly:

```python
    # The routers of the AI visibility packages (docs/ai-visibility/MASTER-PLAN.md section 3.3),
    # in that table's order and before the older routers: a request goes to the first route that
    # matches, so a new word in a path is never taken by an older route's parameter.
    app.include_router(layouts_router)
    app.include_router(ai_limits_router)
    app.include_router(collection_routes_router)
    app.include_router(ai_metrics_router)
    app.include_router(ai_competitors_router)
    app.include_router(ai_annotations_router)
    app.include_router(notes_router)
    app.include_router(ai_versions_router)
    app.include_router(ai_panels_router)
    app.include_router(ai_links_router)
    app.include_router(ai_candidates_router)
    app.include_router(uploads_router)
    app.include_router(alerts_router)
    app.include_router(views_router)
    app.include_router(exports_router)
    app.include_router(reports_router)
    app.include_router(ai_derivations_router)
    app.include_router(entity_candidates_router)
    app.include_router(ai_retrieval_router)
    app.include_router(ai_stats_router)
    app.include_router(ai_source_intel_router)
    app.include_router(webhooks_router)
```

Nothing else in `main.py` changes (no lifespan, no `Resources(...)` argument). `resources.py` does not change (D2).

### Run

```bash
cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py --no-cov -n 2 -q
```

Then the light checks. `uv run python -m idraft.api.openapi | diff -u openapi/v1.json -` prints nothing.

### Commit

`WP-01: empty routers and schema modules registered in order`, adding the 8 package `__init__.py`, the 22 router modules, the 13 schema modules, `src/idraft/api/main.py`, `tests/api/test_route_access.py`.

### Prove it bites (reviewer, scratch commit, never pushed)

| Weakening | Test expected to fail |
|---|---|
| Delete `app.include_router(ai_stats_router)` (and its import) | `test_the_scaffolded_routers_are_included_once_in_order_before_the_older_ones` (`len(found) == 1`, name `idraft.api.ai.stats_routes`) |
| Swap the `notes_router` and `ai_versions_router` lines | same test (`positions == sorted(positions)`) |
| Move the whole block after `app.include_router(workspaces_router)` | same test (`positions[-1] < older[0]`) |
| In `layouts/routes.py` add `@router.get("/api/v1/workspaces/{workspace_id}/projects/{project_id}")` with a body `async def scratch() -> None: return None` | `test_no_route_is_hidden_by_an_earlier_one` (the existing `GET {W}/projects/{project_id}` is hidden) |
| Change `_matcher` to return `re.compile(re.escape(path))` | `test_a_parameter_matches_any_one_segment` |

---

## T2: Permission keys `layouts:manage` and `notes:write`

Brief step 2. Rows: BE-OPS-09 (the five keys of doc 19 2.13 and LD 9.3 are all in the matrix), BE-LAYOUTS-05.

### Files

- `$WT/backend/tests/auth/test_permissions.py` (tests first)
- `$WT/backend/src/idraft/api/permissions.py`
- `$WT/apps/web/src/lib/permissions/permissions.ts`
- `$WT/apps/web/src/mocks/factories/permissions.ts`
- `$WT/docs/24-security.md` (one row in section 3.2)

### Tests first

In `DOC_24_MATRIX` of `$WT/backend/tests/auth/test_permissions.py`, between `"views:write": ...` and `"imports:write": ...`:

```python
    "layouts:manage": "owner admin",
    "notes:write": "owner admin editor",
```

Append:

```python
def test_only_owner_and_admin_manage_the_team_default_layout() -> None:
    """Owner decision D-11: stricter than workspace saved views."""
    holders = {role for role in Role if Permission.LAYOUTS_MANAGE in ROLE_PERMISSIONS[role]}
    assert holders == {Role.OWNER, Role.ADMIN}


def test_notes_are_written_by_editors_and_above() -> None:
    """Owner decision D-18."""
    holders = {role for role in Role if Permission.NOTES_WRITE in ROLE_PERMISSIONS[role]}
    assert holders == {Role.OWNER, Role.ADMIN, Role.EDITOR}
```

Expected before the code: `test_the_permission_keys_are_exactly_the_documented_ones` and `test_each_role_holds_exactly_its_documented_permissions` fail (`'layouts:manage' is not a valid Permission`), the two new tests fail with `AttributeError`. The existing `test_only_the_log_agent_scope_is_granted_to_no_role` keeps passing after the code (both new keys have holders).

Web, in `$WT/apps/web/src/mocks/factories/permissions.ts` `PERMISSION_HOLDERS`, after `'views:write': ANALYSTS,`:

```ts
  'layouts:manage': MANAGERS,
  'notes:write': WRITERS,
```

This fails to compile until `PERMISSIONS` has the keys, and `permissions.test.ts` (`is the table of the API`) fails until the backend has them.

### Code

`$WT/backend/src/idraft/api/permissions.py`:

Module docstring, replace the second paragraph (`The enum is emitted in OpenAPI, so the web client gets the same keys. Roles are fixed in V1.`) with:

```text
OpenAPI types a membership's permissions as plain strings, so apps/web keeps the same keys in
src/lib/permissions/permissions.ts, and src/mocks/factories/permissions.test.ts reads `_HOLDERS`
below line by line: one `Permission.X: holders,` line per key, with nothing after the comma.
Roles are fixed in V1.
```

In `Permission`, between `VIEWS_WRITE = "views:write"` and `IMPORTS_WRITE = "imports:write"`:

```python
    LAYOUTS_MANAGE = "layouts:manage"
    NOTES_WRITE = "notes:write"
```

In `_HOLDERS`, between `Permission.VIEWS_WRITE: _ANALYSTS,` and `Permission.IMPORTS_WRITE: _WRITERS,`:

```python
    # Owner decisions D-11 and D-18 (docs/ai-visibility/MASTER-PLAN.md section 2).
    Permission.LAYOUTS_MANAGE: _MANAGERS,
    Permission.NOTES_WRITE: _WRITERS,
```

`$WT/apps/web/src/lib/permissions/permissions.ts`, in `PERMISSIONS` after `'views:write',`:

```ts
  'layouts:manage',
  'notes:write',
```

`$WT/docs/24-security.md` section 3.2, after the `layouts:manage` row:

```text
| `notes:write` (add and delete notes on a project's charts) | yes | yes | yes | | | |
```

### Run

```bash
cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/auth/test_permissions.py tests/api/test_route_access.py --no-cov -n 2 -q
```

Web (from `$WT`; the worktree has no `apps/web/node_modules` yet):

```bash
pnpm install --frozen-lockfile
cd apps/web && pnpm exec vitest run src/mocks/factories/permissions.test.ts src/lib/permissions src/lib/navigation/registry.test.ts
pnpm exec eslint --max-warnings 0 src/lib/permissions/permissions.ts src/mocks/factories/permissions.ts
pnpm exec prettier --check src/lib/permissions/permissions.ts src/mocks/factories/permissions.ts
pnpm typecheck
```

`pnpm typecheck` is a medium lane job. Then the backend light checks. `git diff -- backend/openapi/v1.json apps/web/src/lib/api/schema.ts` is empty.

### Commit

`WP-01: permission keys layouts manage and notes write`, adding `backend/tests/auth/test_permissions.py`, `backend/src/idraft/api/permissions.py`, `apps/web/src/lib/permissions/permissions.ts`, `apps/web/src/mocks/factories/permissions.ts`, `docs/24-security.md`. Tell the coordinator the two web files were touched (no package owns them; D11).

### Prove it bites

| Weakening (in `_HOLDERS`) | Tests expected to fail |
|---|---|
| `Permission.LAYOUTS_MANAGE: _WRITERS,` (editor gains it) | `test_only_owner_and_admin_manage_the_team_default_layout`, `test_each_role_holds_exactly_its_documented_permissions`, web `is the table of the API` |
| `Permission.LAYOUTS_MANAGE: _ANALYSTS,` (analyst) | the same three |
| `Permission.LAYOUTS_MANAGE: (*_MANAGERS, _VIEWER),` and then `(*_MANAGERS, _BILLING),` | the same three, each time |
| `Permission.NOTES_WRITE: _ANALYSTS,` (analyst) | `test_notes_are_written_by_editors_and_above`, `test_each_role_holds_exactly_its_documented_permissions`, web `is the table of the API` |
| `Permission.NOTES_WRITE: (*_WRITERS, _VIEWER),` and then `(*_WRITERS, _BILLING),` | the same three, each time |
| `Permission.NOTES_WRITE: _MANAGERS,` (editor loses it) | the same three |
| Add a trailing comment `  # D-18` after `Permission.NOTES_WRITE: _WRITERS,` | web `is the table of the API` (the parser misses the line) |

---

## T3: Problem classes and codes

Brief step 3. Rows: none (process; the codes are used by WP-11, WP-13, WP-41, WP-42, WP-44 and every contract stub).

### Files

- `$WT/backend/tests/api/test_problems.py` (tests first)
- `$WT/backend/src/idraft/api/problems.py`

### Tests first

In `$WT/backend/tests/api/test_problems.py`, extend the `from idraft.api.problems import (...)` list with `CorePanelExistsError`, `NotImplementedProblemError`, `PanelLockedError`, `PreconditionFailedError`, `ReasonRequiredError`, `TemplateLanguageUnsupportedError` (alphabetical inside the parentheses), and add `from idraft.api.main import create_app` and `from idraft.api.openapi import placeholder_settings`. Append:

```python
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (PreconditionFailedError, 412, "precondition_failed"),
        (PanelLockedError, 422, "panel_locked"),
        (ReasonRequiredError, 422, "reason_required"),
        (CorePanelExistsError, 422, "core_panel_exists"),
        (TemplateLanguageUnsupportedError, 422, "template_language_unsupported"),
        (NotImplementedProblemError, 501, "not_implemented"),
    ],
)
async def test_the_ai_visibility_codes_answer_with_their_status_and_code(
    error: type[ProblemError], status: int, code: str
) -> None:
    app = FastAPI()
    register_problem_handlers(app, app_origin=ORIGIN)

    @app.get("/raise")
    async def raise_it() -> None:
        raise error()

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        body = _assert_problem(await test_client.get("/raise"), status, code)
    assert body["title"] == error.title
    assert "detail" not in body


def _problem_classes(base: type[ProblemError]) -> list[type[ProblemError]]:
    found: list[type[ProblemError]] = []
    for subclass in base.__subclasses__():
        found += [subclass, *_problem_classes(subclass)]
    return found


def test_a_code_belongs_to_one_problem_class() -> None:
    """Packages add codes in their own modules; the app loads every one of them."""
    create_app(placeholder_settings())
    classes = _problem_classes(ProblemError)
    codes = [cls.code for cls in classes]
    assert sorted(code for code in set(codes) if codes.count(code) > 1) == []
```

Expected before the code: an `ImportError` for the six names (the whole module fails to collect), which is the red state.

### Code

`$WT/backend/src/idraft/api/problems.py`, after `class QueryTimeoutError` and before the `_LOCK_NOT_AVAILABLE` comment:

```python
# Codes the AI visibility specifications name, added once (docs/ai-visibility/MASTER-PLAN.md
# section 3.6). A package's own new code is a ProblemError subclass in its own module.


class PreconditionFailedError(ProblemError):
    """The `If-Match` sent is not the resource's current ETag: it changed since it was read."""

    status, code, title = 412, "precondition_failed", "The resource has changed"


class PanelLockedError(ProblemError):
    """A change to the locked core panel, or to one of its prompts, without
    `panels:core:modify`."""

    status, code, title = 422, "panel_locked", "The core panel is locked"


class ReasonRequiredError(ProblemError):
    """A change to the locked core panel without a reason."""

    status, code, title = 422, "reason_required", "Say why the core panel changes"


class CorePanelExistsError(ProblemError):
    """A project has one core panel, made with the project."""

    status, code, title = 422, "core_panel_exists", "The project has a core panel"


class TemplateLanguageUnsupportedError(ProblemError):
    """Carries `language_code`: no prompt templates are written in that language."""

    status, code, title = 422, "template_language_unsupported", "No templates in this language"


class NotImplementedProblemError(ProblemError):
    """A route whose contract is published and whose body is not built yet (MASTER-PLAN section
    3.8). It answers after the permission check."""

    status, code, title = 501, "not_implemented", "Not built yet"
```

### Run

```bash
cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/test_problems.py tests/api/test_openapi.py --no-cov -n 2 -q
```

Then the light checks; `uv run python -m idraft.api.openapi | diff -u openapi/v1.json -` prints nothing.

### Commit

`WP-01: problem classes for the AI visibility codes`, adding `backend/tests/api/test_problems.py`, `backend/src/idraft/api/problems.py`.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| `PreconditionFailedError` status 409 | `test_the_ai_visibility_codes_answer_with_their_status_and_code[PreconditionFailedError-412-precondition_failed]` |
| `PanelLockedError` status 403 | the `panel_locked` case |
| `ReasonRequiredError` code `"reason_missing"` | the `reason_required` case |
| `CorePanelExistsError` status 409 | the `core_panel_exists` case |
| `TemplateLanguageUnsupportedError` code `"language_unsupported"` | the `template_language_unsupported` case |
| `NotImplementedProblemError` status 500 | the `not_implemented` case |
| Add `class _Twin(ProblemError): status, code, title = 409, "panel_locked", "Twin"` at the end of the classes | `test_a_code_belongs_to_one_problem_class` |

---

## T4: Anchor lines in the two security test files

Brief step 4. Rows: BE-OPS-01 (every later route lands inside its package's block and is scanned).

### Packages and order

Every package of kind backend or both except WP-01, in number order (slugs are the brief file names):

```text
WP-03 contract-pack
WP-11 layouts-api
WP-12 summary-lane
WP-13 prompts-lane
WP-14 sources-lane
WP-26 evidence-viewer
WP-30 runs-costs-health
WP-31 settings-engines
WP-32 overview-aggregates
WP-38 notes-annotations
WP-41 versions
WP-42 panels-api
WP-44 links-generate
WP-45 candidates-api
WP-47 alerts-api
WP-49 saved-views
WP-50 exports
WP-51 reports
WP-54 extract-recommend
WP-56 rederive-candidates
WP-57 retrieval-fanout
WP-58 stats-api
WP-60 source-intel-api
WP-62 performance
WP-63 ssrf-webhooks
WP-64 aio-xch-api
WP-66 discovery-sources
WP-67 engine-expansion
WP-68 llm-advanced
WP-69 first-party-signals
WP-70 geo-readiness
```

### Files

- `$WT/backend/tests/api/test_route_access.py` (the order test, `PACKAGES`, anchors in `EXPECTED` and `PATH_PARAMETERS`)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchors in `BODIES`, `QUERIES`, the `_tenant` seeding block and `_TENANT_ROWS`; `Tenant.more_ids`)

### Tests first

In `$WT/backend/tests/api/test_route_access.py`, add `from pathlib import Path` (stdlib block) and, after the T1 tests:

```python
# The AI visibility packages that add routes or tenant tables, in number order
# (docs/ai-visibility/MASTER-PLAN.md section 3.6). Each has one anchor line in each table of this
# file and of tests/security/test_cross_tenant.py, and adds its entries under that line only.
PACKAGES = (
    "WP-03 contract-pack",
    "WP-11 layouts-api",
    # ... the 31 lines of the list above, in that order ...
    "WP-70 geo-readiness",
)
ANCHOR = re.compile(r"^ *# (WP-\d{2} [a-z0-9-]+)$", re.MULTILINE)
SECURITY_SUITE = Path(__file__).parents[1] / "security" / "test_cross_tenant.py"


@pytest.mark.parametrize(("path", "tables"), [(Path(__file__), 2), (SECURITY_SUITE, 4)])
def test_each_table_has_one_anchor_line_per_package_in_order(path: Path, tables: int) -> None:
    assert ANCHOR.findall(path.read_text()) == list(PACKAGES) * tables
```

Write `PACKAGES` with all 31 strings (no ellipsis comment in the real code). Expected before the anchors: both cases fail (`[] != [...]`).

### Code

The same anchor block goes at the end of each anchored table, just before its closing brace (for `_tenant`, see below). The block, with 4 spaces of indent, is a two-line note and the 31 anchor lines:

```python
    # AI visibility packages, one line each (docs/ai-visibility/MASTER-PLAN.md section 3.6): add
    # your entries under your own line, nowhere else in this table.
    # WP-03 contract-pack
    # WP-11 layouts-api
    # ... the 31 lines, in order ...
    # WP-70 geo-readiness
```

Write all 31 anchor lines literally. Places:

1. `test_route_access.py`, `EXPECTED`: after the last entry (`("DELETE", ".../prompts/{prompt_id}"): "prompts:write",`), before `}`.
2. `test_route_access.py`, `PATH_PARAMETERS`: after `"prompt_id",`, before `}`.
3. `test_cross_tenant.py`, `BODIES`: after the `PATCH .../prompts/{prompt_id}` entry, before `}`.
4. `test_cross_tenant.py`, `QUERIES`: after the `fanout-queries` entry, before `}`.
5. `test_cross_tenant.py`, `_TENANT_ROWS`: after `"ai.observation_facts": "workspace_id",`, before `}`.
6. `test_cross_tenant.py`, `_tenant`: the seeding block below.

`ruff format` removes blank lines inside literals; do not add any (D5).

`Tenant` in `test_cross_tenant.py` (add `field` to `from dataclasses import dataclass`):

```python
    # A prompt of the project with the term, so changing or archiving it succeeds.
    prompt_id: uuid.UUID
    # What the AI visibility packages seed in `_tenant`, by path parameter name.
    more_ids: dict[str, str] = field(default_factory=dict)
```

In `ids()`, after `"prompt_id": str(self.prompt_id),` add `**self.more_ids,`.

In `_tenant`, just before `# Fresh, so that a route wanting a recent credential is not refused for that instead.`:

```python
    # Ids of what the AI visibility packages seed, by path parameter name; each package adds its
    # rows under its own line (docs/ai-visibility/MASTER-PLAN.md section 3.6).
    more_ids: dict[str, str] = {}
    # WP-03 contract-pack

    # WP-11 layouts-api

    # ... one line per package, a blank line after each ...

    # WP-70 geo-readiness

```

and pass `more_ids=more_ids,` as the last argument of the `Tenant(...)` call. This block keeps its blank lines (function body). It is anchor table 4 of the order test. Numeric ids (as `serp_snapshot_id`) still need the owning package to extend `_nowhere`; none of the planned packages has one.

### Run

```bash
cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/test_route_access.py tests/security/test_cross_tenant.py --no-cov -n 2 -q
```

Then the light checks (`ruff format --check` proves the blocks survive the formatter).

### Commit

`WP-01: anchor lines for the AI visibility packages in the security tests`, adding `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Delete `# WP-38 notes-annotations` from `BODIES` | `test_each_table_has_one_anchor_line_per_package_in_order[...test_cross_tenant.py-4]` |
| Swap `# WP-41 versions` and `# WP-42 panels-api` in `EXPECTED` | the `test_route_access.py-2` case |
| Under `# WP-11 layouts-api` in `EXPECTED` add `("GET", "/api/v1/workspaces/{workspace_id}/layouts/{screen}"): "data:read",` | `test_the_declared_access_is_the_documented_access` (the table is compared exactly, so an entry without a route fails) |

`more_ids` is plumbing, not a guard: with no package seeding yet there is nothing for it to bite on. The first package that seeds an id proves it (its route is scanned only if the id reaches `ids()`; `_fill` asserts on a missing one).

---

## T5: As built notes, rebase, final checks, push

Brief step 5. Rows: closes the package (BE-OPS-01, BE-OPS-02 confirmed; BE-OPS-09, BE-LAYOUTS-05 built).

### OpenAPI

Expected unchanged (D1). Verify, from `$WT/backend`:

```bash
uv run python -m idraft.api.openapi | diff -u openapi/v1.json -
git diff origin/develop -- openapi/v1.json ../apps/web/src/lib/api/schema.ts
```

Both print nothing. Only if one prints something (it must not, so first find out why): `uv run python -m idraft.api.openapi > openapi/v1.json`, then in `$WT/apps/web` `pnpm gen:api` and `pnpm typecheck`, both files in the same push.

### As built notes (append only, one section each)

`$WT/docs/19-api-specification.md`, section 2.7, after the paragraph that starts `A run blocked by budget is not an error` (before `### 2.8 Idempotency`):

```text
**As built (AI visibility WP-01, 2026-11-13): problem codes.** `precondition_failed` (412),
`panel_locked`, `reason_required`, `core_panel_exists`, `template_language_unsupported` (422) and
`not_implemented` (501: a route whose contract is published and whose body is not built yet, answered
after the permission check) are `ProblemError` subclasses in `backend/src/idraft/api/problems.py`.
`code` is a string in OpenAPI, so the document did not change. A later package's code is a subclass
in its own module; `tests/api/test_problems.py` fails when two classes share a code.
```

`$WT/docs/19-api-specification.md`, section 2.13, after the paragraph that starts `Suffix **fresh** means` (before `## 3. Endpoint catalog`):

```text
**As built (AI visibility WP-01, 2026-11-13): permissions and routers.** `layouts:manage` (owner,
admin; owner decision D-11) and `notes:write` (owner, admin, editor; D-18) are in `Permission` and
in the doc 24 section 3.2 matrix. The enum is not emitted in OpenAPI: a membership's `permissions`
is a list of strings, so the web app keeps the keys in `apps/web/src/lib/permissions/permissions.ts`
and `src/mocks/factories/permissions.test.ts` compares its role table with `permissions.py`. Every
router of docs/ai-visibility/MASTER-PLAN.md section 3.3 is included in `api/main.py`, empty, after
the auth routes and before the older ones; `tests/api/test_route_access.py` fails when a route is
hidden by an earlier one (a parameter matches any word).
```

`$WT/docs/29-phase-roadmap.md`, at the end of `### Phase 9: AI analytics` (after its table, before `### Phase 10: SEO and AI integration`):

```text
**As built (AI visibility WP-01, 2026-11-13): backend scaffolding.** The 22 routers and 13 schema
modules of docs/ai-visibility/MASTER-PLAN.md section 3.3 exist empty and are registered; permission
keys `layouts:manage` and `notes:write`; problem codes `precondition_failed`, `panel_locked`,
`reason_required`, `core_panel_exists`, `template_language_unsupported`, `not_implemented`; one anchor
line per package in the route access and cross-tenant tests. No route, table or OpenAPI change
(plan `docs/superpowers/plans/2026-11-13-ai-wp-01-backend-scaffold.md`).
```

Commit: `WP-01: as built notes`, adding `docs/19-api-specification.md`, `docs/29-phase-roadmap.md`.

### Rebase and final checks

```bash
cd $WT
git fetch origin && git rebase origin/develop
```

On a conflict in a hot file keep both sides (anchors and registrations are additive), never take one side of `openapi/v1.json` by hand (regenerate). After the rebase, from `$WT/backend`:

```bash
uv sync --frozen
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/test_route_access.py tests/api/test_openapi.py tests/api/test_problems.py tests/auth/test_permissions.py tests/security/test_cross_tenant.py --no-cov -n 2 -q
```

and the T2 web commands. The full suite (acceptance: `infra/dev/heavy -- ./check.sh` green): if `infra/dev/heavy` is on develop after the rebase, run in the background from `$WT/backend`:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
../infra/dev/heavy --label "WP-01 check" -- ./check.sh
```

If it is not there yet, report `blocked` with "full check waits for the heavy lock" and push only with the coordinator's go-ahead (who may let it run `./check.sh` directly when no other heavy job runs).

### Push and report

```bash
git push origin HEAD:develop
```

Fast-forward only; if rejected, fetch, rebase and re-run the targeted checks. Never push `main`, never run `infra/ship.sh`. Then send the coordinator:

```text
WP-01 merged | branch claude/ai-wp-01-backend-scaffold-0d8e58 @ <short sha> | rows done 4/4 | steps 6/6 | blockers: none | next: WP-03 contract-pack can start
```

with the prove-it-bites list (guards and the failing test names from T1 to T4) and the note that the two web permission files changed (D11).

### Final review (second fresh Sonnet reviewer)

Reads the whole diff (`git diff origin/develop...HEAD`) against the brief's acceptance criteria and this plan. Check in particular: `git diff origin/develop -- backend/openapi/v1.json apps/web/src/lib/api/schema.ts` empty; `resources.py` untouched; the 22 modules and 13 schema modules exist; the bite list was run and recorded. No page changed, so there is no browser check.
