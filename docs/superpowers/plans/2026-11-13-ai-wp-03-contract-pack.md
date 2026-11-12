# WP-03 contract pack: detailed task plan

Brief: [docs/ai-visibility/work-packages/WP-03-contract-pack.md](../../ai-visibility/work-packages/WP-03-contract-pack.md).
Master plan: [docs/ai-visibility/MASTER-PLAN.md](../../ai-visibility/MASTER-PLAN.md) sections 2 to 6.
Built on: [WP-01 plan](2026-11-13-ai-wp-01-backend-scaffold.md) (empty routers, permission keys, `NotImplementedProblemError`, anchors).

Worktree (every path below is under it): `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-wp-01-backend-scaffold-0d8e58`, written `$WT`.
Branch: `ai/wp-03-contract-pack`. `infra/dev/heavy` exists; `infra/dev/wp-status` does not yet, so status lines go to the coordinator as a message.

## Goal

Publish, as Pydantic schemas and route signatures, every API shape a wave 1 or wave 2 web package consumes, so the web builds and mocks against generated types while the backend packages fill the bodies:

- 14 new routes that answer `501 not_implemented` after their access checks;
- optional additions to 11 built operations (parameters and body members that answer `501` when used; response fields absent from every response until their owner builds them);
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` regenerated once, in the same push;
- one contract note per group in `docs/ai-visibility/contracts/`, and As built notes in docs 19 and 29.

## What exists (checked on this worktree at `5f5b1a27`)

- FastAPI 0.142.1, Pydantic 2.13.5, pytest with `filterwarnings = error`, mypy strict with the pydantic plugin, ruff rules `E F I B UP SIM RUF ASYNC PT C4 T20 N S608` (no `ARG`: unused route arguments are fine).
- Access: a route states who may call it through a marked dependency (`idraft.api.access.declare`). `require_permission(Permission.X)` and `MemberAccess` (`workspace_member`) run in this order, each answering before the next: session 401, membership 404, project scope 404 (path parameter `project_id`), suspended workspace on a write 403, permission 403. FastAPI runs a dependency that raises before it reports body errors. So a route body that raises gives exactly the order the brief asks for: 401, 404, 403, then 422 for the body, then the raise.
- `NotImplementedProblemError` (501, `not_implemented`) is in `api/problems.py` (frozen). Problem codes are not in OpenAPI.
- Opt-in blocks are `Field(default=None, exclude_if=_absent)`: a key that was not asked for is absent from the JSON (`schemas/ai.py`, `schemas/ai_sources.py`). Alternative body shapes use a tagged union `Annotated[Annotated[A, Tag(ONE_TAG)] | Annotated[B, Tag(BATCH_TAG)], Discriminator(body_shape)]` (`schemas/taxonomy.py`, `schemas/entities.py`); the error mapper leaves the tags out of error paths. A field named after a Python word uses `from_: ... = Field(alias="from", serialization_alias="from")` with `populate_by_name` (`schemas/metrics.py`).
- `api/main.py` includes the 22 WP-01 routers before the older ones; `test_no_route_is_hidden_by_an_earlier_one` guards shadowing. No new path of this plan collides with an older one (checked over the 153 route contexts).
- `tests/security/test_cross_tenant.py` drives every workspace route. Two of its rules break on a 501 stub and must change (T4): `test_a_project_outside_the_members_scope_is_not_found` requires `inside.status_code < 300`, and `test_a_list_holds_nothing_of_another_workspace` requires 200. `CHILD_ROUTES` counts a path whose only other parameter is a word (`{screen}`) as a child, which would make the layouts routes fail the "other workspace's child" tests.
- No table is added by this package: `_TENANT_ROWS` gets nothing.

## Decisions (one line of reason each)

| # | Decision | Reason |
|---|---|---|
| D1 | A new module `backend/src/idraft/api/stubs.py` holds `not_built` (marks an endpoint), `is_not_built`, `not_built_yet()` and `refuse_unbuilt(sent)`. | One shared pattern, in a file no frozen package owns; the cross-tenant suite reads the mark, so a stub needs no hand-kept list and a filled body that forgets to drop the mark fails the suite. |
| D2 | A stub declares the same access dependency, path, query and body parameters its built route will have, and its body is only `raise not_built_yet()`. | The signature is the contract; checks run before the body, so 403 and 404 come before 501 by construction. |
| D3 | A built route that gains an addition answers `501` when the request uses it (`refuse_unbuilt`), and behaves exactly as before when it does not. New response fields are `exclude_if=_absent` and documented "Not returned yet". | Additive for every old client; honest for a new one (it never gets a silently ignored parameter). |
| D4 | Exception to MASTER-PLAN 3.6 ownership, stated once: WP-03 edits the summary models (WP-12), the prompt and lint models (WP-13) and the source models (WP-14) in `schemas/ai.py`, `schemas/ai_bulk.py`, `schemas/ai_sources.py`, and their routes, only additively and only as this plan writes. | The owners have not started (they depend on WP-03); a new field must live beside the model it extends to avoid a circular import. |
| D5 | Lint `items` (N01) and bulk archive `filter` (D-23) are a second body shape in a tagged union; the first shape (`PromptLintRequest`, `PromptBulkArchive`) is unchanged. | The service keeps its types (`body.texts`, `body.ids` stay required), no service file changes, the generated component names stay. |
| D6 | `GET {P}/ai/limits` (CF-11) is the one quota read; `PromptPage.meta.quota` and `GET {W}/quotas` are not added. | One place for the same numbers (prompts, monthly answers, manual runs); both others can be added later additively. |
| D7 | Every list of values is bounded; every new string has a length or pattern bound. | House rule (`schemas/common.py`): a lone surrogate or a control character must be a 422, not a 500. |
| D8 | No new problem class. Codes a later body raises (`not_an_ai_run`, `nothing_to_change` as a field code, `term_unknown`) are named in the contract notes; the owning package adds the class when it raises it. | Dead classes in a frozen-adjacent area help nobody; codes are not in OpenAPI. |
| D9 | `v1.json` is regenerated once, in T5. Between T1 and T5 `test_openapi.py`, `test_route_access.py` and `test_cross_tenant.py` are red by design; each task runs only its own tests. Nothing is pushed before T7. | The brief's step order; the full suite is green again at T5 and proven at T7. |
| D10 | Tests of the new 501 answers live in new files named `test_contract_<group>.py`; existing test files are not edited except the two anchored security tests (T4). | Disjoint files let two implementers run at once; the owner deletes the contract test when it writes the real one. |

## Open questions and choices

Every row: the sources that disagree or are silent, the choice, why. The owner package may tighten through the contract note's change log.

| # | Rows | Question | Choice | Why |
|---|---|---|---|---|
| Q1 | PD-LINT-03, PD-N03, C1, doc 19 `LintWarning.rule` | Length rule name: `word_count` or doc 19 `length` | `word_count` | Inventory C1, N03 and the dialog spec name it; doc 19 predates the 5 to 60 words rule |
| Q2 | BE-PROMPTS-12, C1, doc 19 3.7.1 | `filter[importance_in]` (C1) or `filter[importance_lte]` (doc 19) | `filter[importance_in]` only | The rows WP-13 closes name it; `_lte` can be added later additively |
| Q3 | PD-N09, C1, CF-12, doc 19 | Bulk update term changes: `term_ids`, or add, remove, replace | `add_term_ids`, `remove_term_ids` | The tracked keyword bulk update does exactly this (`TrackedKeywordBulkUpdate`); replace can come later |
| Q4 | PD-N09, C1, doc 19 | Bulk update selection: `ids` only (N09) or `ids` or `filter` (C1, doc 19) | exactly one of `ids`, `filter` | Two specs against one; the keyword house rule (`Selection`) |
| Q5 | PD-N06, CF-11, C1 | Quota read: `PromptPage.meta.quota`, `GET {W}/quotas` or `GET {P}/ai/limits` | `GET {P}/ai/limits` with N06's names | D6; CF-11 needs the manual runs too, which are per project |
| Q6 | PD-N07, doc 04 0018 CHECK | Which `source` values a caller may send | `manual`, `csv_import`, `seo_keyword`, `paa`, `gsc_query` (N07's list) | Widening a request enum later is additive, narrowing is not |
| Q7 | PD-N07, doc 19 `PromptCreate.generated_from` | `generated_from.template` type | the four template names of doc 19 `from-keywords/preview` | Doc 19 names them; string would be wider than any spec |
| Q8 | PD-N02, doc 19 | `prompt_type` default on create | unchanged (`question`); `prompt_type_source` added, not returned yet | The field is optional in the generated client either way; WP-13 swaps the default for the rule |
| Q9 | OV-N2, D1 Task 3, C2 | Where `compare_window` and `previous_answers` go (N2 says `meta`) | on `PromptsSummary`, as D1 wrote | The summary has no `meta`; C2 says "D1 Task 3 contract as written" |
| Q10 | CF-01, OV-N2, D1 decision 3 | `previous` on entity cells (CF-01, N2 yes; D1 no) | optional `EntityCells.previous` | Two sources; an absent optional field costs nothing |
| Q11 | OV-N1, OV-N15 | Name and default of the row selector | `rows` with `topics` or `none`; left out means all rows | N1 and N15 name only those two values |
| Q12 | OV-N14 | Where co-mention counts live | top level `PromptsSummary.co_mentions`, one entry per engine | "over the valid answers in scope" is scope wide; per row it would repeat |
| Q13 | OV-N10 | Meaning of `filter[outcome]` on prompt rows | single value of `Outcome`; WP-12 states the row rule in the C2 change log before it builds | N10 names the parameter, not the rule; it answers 501 until then |
| Q14 | OV-N4, doc 19 3.7.9 | Country breakdown: `group_by=country` or the breakdown route | `group_by=country` with `by_country` | N4 calls it the cheaper option; the breakdown route is WP-32 (wave 3) |
| Q15 | doc 19 3.7.5, BE-COLLECT-10 | `valid_rate` as `MetricValue` (doc 19) or `MetricCell` | `MetricCell`, numerator `valid`, denominator `planned` | Every AI read so far uses `MetricCell`; "valid of planned" is BE-COLLECT-10 |
| Q16 | OV-N5 | Unit of `budget_blocked` | runs of that day blocked by a budget | The row sits beside `runs`; answers of a blocked run are never asked |
| Q17 | CF-09, doc 16 C5 | What `min_support` counts on source rows | citation units in the window | doc 16 C5 counts units ("at least 2 units now") |
| Q18 | CF-09, BE-SOURCES-06, doc 19 3.7.7 | `sources/changes` row shape and paging | `registrable_domain` rows and offset pages, as the built source reads | Doc 19's `DomainRef` and cursor were replaced by the as built D2 reads |
| Q19 | CF-10, OV-N7, handoff rule 5 | `cited_with` and `by_role_by_engine` always or opt-in | opt-in through `include` on `sources/domains` | Rule 5: a new extra query is asked for |
| Q20 | doc 19 3.11.5c, LD 9.2 | `{screen}` as an enum (422) or a string (404 when unknown) | a bounded string; unknown is `404` (WP-11) | Doc 19 says `404 unknown screen` |
| Q21 | LD 6.1, 7, D-10 | Card type and metric keys as enums | bounded strings checked against the generated catalog JSON by WP-11 | The catalog grows per card (LD 7.4); an enum would change the contract each time |
| Q22 | LD 6.1, 9.2 | Bounds of `options` | keys `^[a-z0-9_]+$` up to 64, values up to 256 printable characters | D7; loosening later is additive |
| Q23 | LD 6.3 rule 6 | Item `id` pattern | `^[A-Za-z0-9_-]{1,64}$` | LD's own definition of a plain token |
| Q24 | OV-N9 | Annotations window, order, `from` and `to` types | `from`, `to` as every AI read (default 28 days, at most 92); oldest first; `from`/`to` number or string, nullable | doc 19 `VersionBoundary` types; the house window rule |
| Q25 | OV-N13 | Notes list paging and window; who deletes | no paging, the AI read window; any `notes:write` holder deletes (WP-38 may narrow) | N13 shows a plain list; notes are few |
| Q26 | PD-N11, D-46, doc 19 2.11 | `If-Match` on prompt `PATCH` required or optional | optional header, 501 while not built | doc 19 2.11: optional in V1 except versions and memberships |
| Q27 | PD-N13 | How `filter[is_active]` takes `any` | `boolean` or the string `any` | Keeps `true` and `false` exactly as today |
| Q28 | BE-PROMPTS-15, prompt-dialogs section 18 | `expected_frequency` on create and in `Prompt` | left out | Owner decision: no frequency per prompt ("Not asked of the backend") |

## Risks

| Risk | Mitigation |
|---|---|
| Suites red between T1 and T5 (D9) | No push before T7; T5 regenerates and runs all three suites; each task's commit names only its files |
| T4 edits lines of `tests/security/test_cross_tenant.py` outside the WP-03 anchor (`WORDS` moved up, `NOT_BUILT`, two test branches, `CHILD_ROUTES`) | Ask the coordinator for a lease on that file before T4; the change is additive and every later package benefits (WP-11 needs the word rule anyway) |
| WP-11's real `GET {W}/layouts/{screen}` becomes a list route of the cross-tenant suite | Contract note C12a tells WP-11 to add the path to `COUNT_ROUTES` when it fills the body (a resolved layout holds no tenant ids) |
| Widening `LintRule` or `SummaryInclude` breaks an exhaustive web switch | T5 runs `pnpm typecheck`; today only `add-prompts-dialog.tsx` reads `warning.rule` with `===` (checked) |
| Two implementers edit one file | Lane split below keeps files disjoint; `schemas/ai.py` and `prompt_routes.py` stay in lane A only |
| An owner package starts before WP-03 merges | All of WP-11, WP-12, WP-13, WP-14, WP-30, WP-38 depend on WP-03 in the tracker |
| Stub test written against a model that the implementer named differently | The model and route code below is exact; the reviewer compares names with this file |

## Lanes, order and parallelism

| Lane | Tasks in order | Files (disjoint from the other lane) |
|---|---|---|
| A | T0, T1a, T1b, T2 | `api/stubs.py`, `schemas/ai.py`, `schemas/ai_bulk.py`, `schemas/ai_limits.py`, `ai/prompt_routes.py`, `ai/limits_routes.py`, `ai/summary_routes.py`, their tests |
| B (starts after T0 is committed) | T3a, T3b | `schemas/ai_sources.py`, `ai/source_routes.py`, `schemas/ai_collection.py`, `operations/collection_routes.py`, `schemas/ai_notes.py`, `ai/annotation_routes.py`, `notes/routes.py`, `schemas/ai_layouts.py`, `layouts/routes.py`, their tests |
| then | T4, T5, T6 (T6 may run beside T4), T7 | the two security tests; `v1.json`, `schema.ts`; docs |

## Common commands

Light checks (no lock), from `$WT/backend`:

```bash
uv sync --frozen
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports
```

Targeted tests (medium lane; Colima running, never restart it):

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest <paths> --no-cov -n 2 -q
```

House rules for every task: tests first; edit files with the file tools only (no heredocs, `sed` or replace scripts; `uv run ruff format <file>` to fix wrapping is allowed); ASCII only; no em or en dashes in comments, docs or commit messages; lines up to 100 characters; one commit per task, message `WP-03: <task title>`, no attribution lines; `git add` names this task's files only; never `git add backend/openapi/v1.json` before T5.

Shared test vocabulary (each new test file imports these; all exist):

```python
from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.support import ai_project, prompt_body, seed_prompts
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
```

Roles: `viewer` holds `data:read`; `billing` holds none of the keys used here (403 on a read); `editor` holds `prompts:write` and `notes:write`; `admin` holds `layouts:manage`. An outsider is `member(resources, migrated, await make_workspace(migrated), "owner")` calling this workspace's URL (404).

---

## T0: Stub helpers

Brief step 1 (prerequisite of steps 1 to 3). Rows: none (process).

### Files

- Create `$WT/backend/src/idraft/api/stubs.py`
- Create `$WT/backend/tests/api/test_stubs.py`

### Tests first: `$WT/backend/tests/api/test_stubs.py`

```python
"""The helpers of routes whose contract is published before their body (idraft.api.stubs)."""

from __future__ import annotations

import pytest

from idraft.api.problems import NotImplementedProblemError
from idraft.api.stubs import is_not_built, not_built, not_built_yet, refuse_unbuilt


def test_a_marked_endpoint_is_the_same_function_and_says_so() -> None:
    async def endpoint() -> None: ...

    assert not is_not_built(endpoint)
    assert not_built(endpoint) is endpoint
    assert is_not_built(endpoint)


def test_nothing_new_sent_is_no_error() -> None:
    refuse_unbuilt({"compare": False, "rows": False})
    refuse_unbuilt({})


def test_what_was_sent_is_named_in_order() -> None:
    with pytest.raises(NotImplementedProblemError) as caught:
        refuse_unbuilt({"rows": True, "compare": False, "group_by": True})
    assert caught.value.detail == "Not built yet: rows, group_by."
    assert (caught.value.status, caught.value.problem_code) == (501, "not_implemented")


def test_a_stub_says_its_contract_is_published() -> None:
    assert not_built_yet().detail == (
        "This route's contract is published; its body is not built yet."
    )
```

Expected first: `ModuleNotFoundError: No module named 'idraft.api.stubs'`.

### Code: `$WT/backend/src/idraft/api/stubs.py`

```python
"""Routes whose contract is published before their body is built (docs/ai-visibility/MASTER-PLAN.md
section 3.8).

A stub declares the access, path, query and body of its built route, so the session, membership,
project scope and permission checks answer first (401, 404, 403), the body is validated next
(422), and only then does it answer `501 not_implemented`. `not_built` marks its endpoint:
tests/security/test_cross_tenant.py expects that 501 inside the caller's scope. The package that
builds the body removes the mark and the raise together.

A built route that gained a contract addition (a parameter or a body member) passes what the
request used to `refuse_unbuilt`: left out, the route behaves exactly as before.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Final

from idraft.api.problems import NotImplementedProblemError

_MARK: Final = "__idraft_not_built__"
_PUBLISHED: Final = "This route's contract is published; its body is not built yet."


def not_built[F: Callable[..., Any]](endpoint: F) -> F:
    """Mark the endpoint of a route whose body only raises `not_built_yet()`."""
    setattr(endpoint, _MARK, True)
    return endpoint


def is_not_built(endpoint: object) -> bool:
    return getattr(endpoint, _MARK, False) is True


def not_built_yet(detail: str = _PUBLISHED) -> NotImplementedProblemError:
    return NotImplementedProblemError(detail)


def refuse_unbuilt(sent: Mapping[str, bool]) -> None:
    """`501` naming, in order, every contract addition the request used; nothing when none."""
    used = [name for name, given in sent.items() if given]
    if used:
        raise not_built_yet(f"Not built yet: {', '.join(used)}.")
```

Decorator order on every stub, so the router registers the marked function:

```python
@router.get("/path", summary="...", description="...")
@not_built
async def name(...) -> Model:
    raise not_built_yet()
```

### Run

```bash
cd $WT/backend && uv run pytest tests/api/test_stubs.py --no-cov -q
```

Then the light checks.

### Commit

`WP-03: stub helpers`, adding `src/idraft/api/stubs.py`, `tests/api/test_stubs.py`.

---

## T1a: Prompt list, create and change additions (C1 part 1)

Brief step 1. Rows: BE-PROMPTS-10 (contract: `prompt_type_source`), BE-PROMPTS-11, BE-PROMPTS-12, BE-PROMPTS-15 (`source`, `creation_method`), CF-13, PD-N02, PD-N04, PD-N07, PD-N11, PD-N13.

### Files

- Edit `$WT/backend/src/idraft/api/schemas/ai.py` (prompt section only)
- Edit `$WT/backend/src/idraft/api/ai/prompt_routes.py` (list, create, bulk create, patch)
- Create `$WT/backend/tests/api/ai/test_contract_prompts.py`

### Tests first: `$WT/backend/tests/api/ai/test_contract_prompts.py`

Module docstring: `"""Contract C1, prompt list, create and change (docs/ai-visibility/contracts/c1-prompts.md): each addition answers 501 once the caller may use the route; left out, nothing changes."""`. Imports: the shared vocabulary plus `import uuid`, `import httpx`, `import pytest`.

| Test | Arrange and act | Assert |
|---|---|---|
| `test_a_list_filter_that_is_not_built_answers_501` (parametrized `params`: `{"filter[prompt_type_in]": "comparison"}`, `{"filter[funnel_stage_in]": "tofu,mofu"}`, `{"filter[importance_in]": "1,2"}`, `{"filter[is_branded]": "true"}`, `{"filter[is_active]": "any"}`, `{"sort": "-importance"}`) | viewer, `GET prompts` with `params` | `problem(response) == NOT_BUILT` |
| `test_the_list_checks_access_before_it_says_not_built` | billing and outsider, `GET prompts?sort=-importance` | billing `FORBIDDEN`, outsider `NOT_FOUND` |
| `test_a_list_value_out_of_bounds_is_refused_before_501` | viewer, `filter[importance_in]=6`, and `sort=volume` | both `(422, "validation_failed")` |
| `test_the_list_without_additions_answers_as_before` | `seed_prompts(migrated, workspace, project, 1)`; viewer `GET prompts`, and `filter[is_active]=false` | 200; one row; `"prompt_type_source"` and `"is_branded_source"` not in the row; the `false` list is empty |
| `test_a_create_member_that_is_not_built_answers_501_and_writes_nothing` (parametrized `extra`: `{"is_branded": True}`, `{"source": "csv_import"}`, `{"creation_method": "imported"}`, `{"generated_from": {"tracked_keyword_id": str(uuid.uuid4()), "template": "comparison"}}`) | editor `POST prompts` with `prompt_body("Which CRM suits a startup?", **extra)`; then `POST prompts/bulk-create` with `{"items": [that body]}` | both `NOT_BUILT`; viewer `GET prompts` lists `[]` |
| `test_a_viewer_is_refused_before_the_new_members_are_looked_at` | viewer `POST prompts` with `is_branded: true` | `FORBIDDEN` |
| `test_a_create_member_out_of_bounds_is_refused` | editor, `source: "llm_variant"`; `creation_method: "llm_generated"`; `generated_from.template: "listicle"` | each `(422, "validation_failed")` |
| `test_if_match_on_a_change_answers_501_and_changes_nothing` | one seeded prompt; editor `PATCH prompts/{id}` `{"importance": 1}` with header `If-Match: "x"`; then `GET prompts/{id}` | `NOT_BUILT`; `importance` is still 3 |
| `test_a_change_without_if_match_works_as_before` | same, no header | 200, `importance` 1 |
| `test_the_api_document_has_the_prompt_additions` (no database) | `build_openapi()` | `GET .../prompts` parameter names include the five new ones, and `filter[is_active]` takes a boolean or `any`; `PromptCreate` properties include `is_branded`, `source`, `creation_method`, `generated_from` and none of them is in `required`; `GeneratedFrom` is a component; `Prompt` properties include `prompt_type_source` and `is_branded_source`, neither required; `PATCH .../prompts/{prompt_id}` has a header parameter `If-Match` that is not required |

Existing tests that must stay green unchanged: `tests/api/ai/test_prompts.py`, `test_prompt_bulk.py`, `test_ai_bodies.py` (`panel_ids` is still `extra_forbidden`).

### Code: `$WT/backend/src/idraft/api/schemas/ai.py`

1. Move the existing `def _absent(value: object) -> bool:` (and its docstring), unchanged, from above `class OutcomeCells` to directly after the `_RAW_TEXT_MAX` line, so prompt models can use it.
2. After `LintSeverity = ...` add:

```python
PromptSort = Literal[
    "text", "-text", "importance", "-importance", "created_at", "-created_at", "updated_at",
    "-updated_at",
]
# What a caller may say a prompt came from when it adds one (prompt-dialogs N07). The column
# holds more values (migration 0018), which only the server sets.
PromptSource = Literal["manual", "csv_import", "seo_keyword", "paa", "gsc_query"]
CreateMethod = Literal["human", "template", "imported"]
# The templates of `POST {P}/prompts/from-keywords/preview` (docs/19 section 3.7.1).
GeneratedTemplate = Literal["recommendation", "comparison", "how_to", "procurement"]
_NOT_BUILT = "Not built yet: `501 not_implemented`."
_NOT_RETURNED = "Not returned yet: absent from every response until it is built."
```

(`ruff format` may reflow the `PromptSort` list; let it.)

3. Directly before `class PromptCreate`, add:

```python
class GeneratedFrom(Body):
    tracked_keyword_id: UUID
    template: GeneratedTemplate
```

4. At the end of `class PromptCreate` (after `term_ids`), add:

```python
    is_branded: bool | None = Field(
        default=None,
        description="Overrides the branded flag computed from the own aliases. " + _NOT_BUILT,
    )
    source: PromptSource | None = Field(
        default=None, description="Where the prompt came from; left out: `manual`. " + _NOT_BUILT
    )
    creation_method: CreateMethod | None = Field(
        default=None, description="How it was written; left out: `human`. " + _NOT_BUILT
    )
    generated_from: GeneratedFrom | None = Field(
        default=None,
        description="The tracked keyword and template it was generated from. " + _NOT_BUILT,
    )
```

5. In `class Prompt`, after `is_branded`, add:

```python
    is_branded_source: Literal["computed", "override"] | None = Field(
        default=None, exclude_if=_absent, description=_NOT_RETURNED
    )
```

and after `prompt_type`:

```python
    prompt_type_source: Literal["rule", "person"] | None = Field(
        default=None, exclude_if=_absent, description=_NOT_RETURNED
    )
```

### Code: `$WT/backend/src/idraft/api/ai/prompt_routes.py`

Imports: `from typing import Annotated, Literal`; `from fastapi import APIRouter, Depends, Header, Query, Response`; add `FunnelStage` to the `idraft.api.schemas.keywords` import; add `Importance`, `PromptSort`, `PromptType` to the `idraft.api.schemas.ai` import; `from idraft.api.stubs import not_built_yet, refuse_unbuilt`.

After `Prompts = ...` add:

```python
_NOT_BUILT = "Not built yet: `501 not_implemented`."

IfMatch = Annotated[
    str | None,
    Header(
        alias="If-Match",
        max_length=128,
        description="The `ETag` of the prompt as read; a changed prompt is `412 "
        "precondition_failed`. " + _NOT_BUILT,
    ),
]


def _unbuilt_members(item: PromptCreate) -> dict[str, bool]:
    """The members of a create whose behaviour is not built yet (contract C1)."""
    return {
        "is_branded": item.is_branded is not None,
        "source": item.source is not None,
        "creation_method": item.creation_method is not None,
        "generated_from": item.generated_from is not None,
    }
```

`list_prompts`: replace the `is_active` parameter and add five after it; first statements of the body:

```python
    is_active: Annotated[
        bool | Literal["any"],
        Query(
            alias="filter[is_active]",
            description="`true` (default) or `false`; `any` lists both. `any`: " + _NOT_BUILT,
        ),
    ] = True,
    prompt_type_in: Annotated[
        list[PromptType] | None,
        Commas,
        Query(alias="filter[prompt_type_in]", description=_NOT_BUILT),
    ] = None,
    funnel_stage_in: Annotated[
        list[FunnelStage] | None,
        Commas,
        Query(alias="filter[funnel_stage_in]", description=_NOT_BUILT),
    ] = None,
    importance_in: Annotated[
        list[Importance] | None,
        Commas,
        Query(alias="filter[importance_in]", description=_NOT_BUILT),
    ] = None,
    is_branded: Annotated[
        bool | None, Query(alias="filter[is_branded]", description=_NOT_BUILT)
    ] = None,
    sort: Annotated[
        PromptSort | None,
        Query(description="A field, `-` first for descending; left out: newest first. " + _NOT_BUILT),
    ] = None,
) -> PromptPage:
    if isinstance(is_active, str):
        raise not_built_yet("Not built yet: filter[is_active]=any.")
    refuse_unbuilt(
        {
            "filter[prompt_type_in]": bool(prompt_type_in),
            "filter[funnel_stage_in]": bool(funnel_stage_in),
            "filter[importance_in]": bool(importance_in),
            "filter[is_branded]": is_branded is not None,
            "sort": sort is not None,
        }
    )
```

The rest of `list_prompts` is unchanged (`is_active` is a `bool` past the `isinstance` check, so mypy accepts `PromptFilter(is_active=is_active)`). Append to its `description`: `" The type, funnel stage, importance and branded filters, \`sort\` and \`filter[is_active]=any\` are published and not built yet (\`501\`)."`.

`create_prompt`: first line of the body `refuse_unbuilt(_unbuilt_members(body))`. `bulk_create_prompts`: first lines

```python
    for item in body.items:
        refuse_unbuilt(_unbuilt_members(item))
```

`update_prompt`: add the parameter `if_match: IfMatch = None` last; first line of the body `refuse_unbuilt({"If-Match": if_match is not None})`.

### Run

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/ai/test_contract_prompts.py tests/api/ai/test_prompts.py tests/api/ai/test_prompt_bulk.py tests/api/ai/test_ai_bodies.py tests/api/test_stubs.py --no-cov -n 2 -q
```

Then the light checks.

### Commit

`WP-03: prompt list create and change contract`, adding `src/idraft/api/schemas/ai.py`, `src/idraft/api/ai/prompt_routes.py`, `tests/api/ai/test_contract_prompts.py`.

---

## T1b: Lint, bulk update, bulk archive by filter, limits (C1 part 2)

Brief step 1. Rows: BE-PROMPTS-06 (filter form), BE-PROMPTS-07, BE-PROMPTS-09, BE-PROMPTS-16, CF-11, CF-12, PD-N01, PD-N02 (`suggested_prompt_type`), PD-N03, PD-N05, PD-N06, PD-N09, PD-LINT-03 to PD-LINT-09.

### Files

- Edit `$WT/backend/src/idraft/api/schemas/ai.py` (lint section)
- Edit `$WT/backend/src/idraft/api/schemas/ai_bulk.py`
- Edit `$WT/backend/src/idraft/api/schemas/ai_limits.py`
- Edit `$WT/backend/src/idraft/api/ai/prompt_routes.py` (lint, bulk archive, new bulk update)
- Edit `$WT/backend/src/idraft/api/ai/limits_routes.py`
- Create `$WT/backend/tests/api/ai/test_contract_lint_bulk.py`

### Tests first: `$WT/backend/tests/api/ai/test_contract_lint_bulk.py`

Pure body tests (no database), in the `_codes` style of `test_ai_bodies.py` (`model.model_validate(body)` raises, the error `type` is listed):

| Test | Body | Code |
|---|---|---|
| `test_a_bulk_update_body_breaking_a_rule_is_refused_with_its_code` (parametrized) | `{"ids": [id]}` | `nothing_to_change` |
| | `{"ids": [id], "add_term_ids": [t], "remove_term_ids": [t]}` | `added_and_removed` |
| | `{"set": {"importance": 1}}` | `value_error` (neither `ids` nor `filter`) |
| | `{"ids": [id], "filter": {}, "set": {"importance": 1}}` | `value_error` (both) |
| | `{"ids": [], "set": {"importance": 1}}` | `too_short` |
| | `{"ids": [id], "set": {}}` | `value_error` (empty `set`) |
| | `{"ids": [id], "set": {"importance": None}}` | `null_not_allowed` |
| | `{"ids": [id], "set": {"expected_frequency": "daily"}}` | `extra_forbidden` |
| | `{"filter": {"importance_in": [6]}, "set": {"is_branded": True}}` | `less_than_equal` |
| `test_a_lint_items_body_is_refused_with_its_code` (parametrized, `TypeAdapter(PromptLintBody)`) | `{"items": []}` | `too_short` |
| | `{"items": [{"text": "x?", "language_code": "en"}]}` | `missing` |
| | `{"items": [...], "texts": ["x?"]}` | `extra_forbidden` |
| | `{"texts": []}` | `too_short` (the old shape, unchanged) |

Route tests (database):

| Test | Arrange and act | Assert |
|---|---|---|
| `test_lint_items_answers_501_for_a_reader` | viewer `POST prompts/lint` `{"items": [{"text": "Is Acme good?", "language_code": "en", "country_iso": "US"}]}` | `NOT_BUILT` |
| `test_lint_language_code_answers_501` | viewer `{"texts": ["Is Acme good?"], "language_code": "en"}` | `NOT_BUILT` |
| `test_lint_checks_access_before_it_says_not_built` | billing and outsider, the items body | `FORBIDDEN`, `NOT_FOUND` |
| `test_lint_without_additions_answers_as_before` | viewer `{"texts": ["Is Acme good?"]}` | 200; `"estimate"` not in the body; `"would_create"` not in `quota`; none of `tracked`, `near_duplicate_of`, `suggested_prompt_type` in `data[0]` |
| `test_bulk_update_answers_501_after_the_permission_and_the_body` | editor `POST prompts/bulk-update` `{"ids": [seeded], "set": {"importance": 1}}`; then the same with `{"ids": [seeded]}` | `NOT_BUILT`; then `(422, "validation_failed")` with error code `nothing_to_change`; importance still 3 |
| `test_bulk_update_is_refused_to_a_viewer_and_another_workspace` | viewer, outsider, valid body | `FORBIDDEN`, `NOT_FOUND` |
| `test_bulk_archive_by_filter_answers_501` | editor `POST prompts/bulk-archive` `{"filter": {"intent_in": ["commercial"]}, "archive": true}` | `NOT_BUILT`; the seeded prompt is still active |
| `test_bulk_archive_by_ids_works_as_before` | editor, `{"ids": [seeded], "archive": true}` | 200 `{"data": {"matched": 1, "updated": 1}}` |
| `test_the_limits_read_answers_501_for_a_reader` | viewer `GET ai/limits` | `NOT_BUILT` |
| `test_the_limits_read_checks_access_first` | billing, outsider | `FORBIDDEN`, `NOT_FOUND` |
| `test_the_api_document_has_the_lint_bulk_and_limits_additions` (no database) | `build_openapi()` | path `.../prompts/bulk-update` (post) and `.../ai/limits` (get); components `PromptLintItems`, `PromptLintItem`, `LintTracked`, `LintNearDuplicate`, `LintEstimate`, `EngineEstimate`, `PromptSelectionFilter`, `PromptBulkArchiveByFilter`, `PromptBulkSet`, `PromptBulkUpdate`, `PromptBulkUpdateResponse`, `AiLimits`, `QuotaUse`; `LintWarning.rule` enum is the seven rules; `PromptBulkArchive` still requires `ids` and `archive`; `PromptLintRequest` still requires `texts` |

Existing tests that must stay green unchanged: `tests/api/ai/test_prompt_lint.py`, `test_prompt_bulk_archive.py`, `test_ai_bodies.py`.

### Code: `$WT/backend/src/idraft/api/schemas/ai.py`

Imports: add `Discriminator`, `Tag` to the `pydantic` import; add `BATCH_TAG`, `ONE_TAG`, `body_shape` to the `idraft.api.schemas.common` import.

Replace `LintRule`:

```python
LintRule = Literal[
    "contains_brand_alias",
    "engine_limit",
    # Contract C1 (prompt-dialogs section 16): not returned yet.
    "word_count",
    "multiple_questions",
    "leading_wording",
    "language_mismatch",
    "contains_competitor_alias",
]
```

At the end of `class PromptLintRequest` add:

```python
    language_code: LanguageCode | None = Field(
        default=None,
        description="The language the texts should be in, for `language_mismatch`. " + _NOT_BUILT,
    )
```

After `class PromptLintRequest` add:

```python
class PromptLintItem(Body):
    text: LintText
    language_code: LanguageCode
    country_iso: CountryIso


class PromptLintItems(Body):
    """Texts with their language and country, so the lint can say which are tracked already."""

    items: Annotated[list[PromptLintItem], Field(min_length=1, max_length=LINT_MAX)]
    engine_codes: Annotated[list[EngineCode], Field(min_length=1)] | None = Field(
        default=None, description="The engines whose length limits apply. Left out: every one."
    )


# `texts` or `items`: the shape sent is the one validated. `items`: not built yet (`501`).
PromptLintBody = Annotated[
    Annotated[PromptLintRequest, Tag(ONE_TAG)] | Annotated[PromptLintItems, Tag(BATCH_TAG)],
    Discriminator(body_shape),
]
```

After `class MatchedAlias` add:

```python
class LintTracked(BaseModel):
    prompt_id: UUID
    is_active: bool


class LintNearDuplicate(BaseModel):
    prompt_id: UUID
    text: str
```

At the end of `class PromptLint` add:

```python
    tracked: LintTracked | None = Field(
        default=None,
        exclude_if=_absent,
        description="The project's prompt with this identity, archived ones too (with `items`). "
        + _NOT_RETURNED,
    )
    near_duplicate_of: LintNearDuplicate | None = Field(
        default=None,
        exclude_if=_absent,
        description="A prompt that differs only in case and spacing. " + _NOT_RETURNED,
    )
    suggested_prompt_type: PromptType | None = Field(
        default=None,
        exclude_if=_absent,
        description="The type the server rule gives the text. " + _NOT_RETURNED,
    )
```

At the end of `class PromptQuota` add:

```python
    would_create: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="Of the items, those neither tracked nor repeated. " + _NOT_RETURNED,
    )
```

Before `class PromptLintResponse` add, and in it add the field:

```python
class EngineEstimate(BaseModel):
    engine_code: EngineCode
    prompts_fit: int = Field(description="Prompts it would create that the engine takes.")
    answers_per_month: int
    monthly_cost_usd: Usd | None = Field(description="Null when the price book has no price.")
    run_now_answers: int
    run_now_cost_usd: Usd | None


class LintEstimate(BaseModel):
    """What the prompts that would be created cost on the standard queue (prompt-dialogs N05)."""

    engines: list[EngineEstimate]
    total_monthly_cost_usd: Usd | None
```

```python
    estimate: LintEstimate | None = Field(
        default=None, exclude_if=_absent, description=_NOT_RETURNED
    )
```

### Code: `$WT/backend/src/idraft/api/schemas/ai_bulk.py`

Imports to add:

```python
from pydantic import BaseModel, Discriminator, Field, Tag, field_validator, model_validator
from pydantic_core import PydanticCustomError

from idraft.api.schemas.ai import CountryIso, Importance, PromptType, TermIds
from idraft.api.schemas.common import (
    BATCH_TAG, ONE_TAG, Body, LanguageCode, Patch, QueryText, refuse_null,
)
from idraft.api.schemas.keywords import FilterList, FunnelStage, Intent
```

(`typing` keeps its import line; `ruff check --select I` orders the rest.) After `class PromptBulkArchive` add:

```python
class PromptSelectionFilter(Body):
    """The list's filters as a body: the names of `GET {P}/prompts` without the brackets. A list
    holds 1 to 100 values. `is_active` left out takes archived and active prompts alike."""

    q: QueryText | None = None
    term: UUID | None = Field(default=None, description="The term or one under it.")
    intent_in: FilterList[Intent] | None = None
    funnel_stage_in: FilterList[FunnelStage] | None = None
    prompt_type_in: FilterList[PromptType] | None = None
    importance_in: FilterList[Importance] | None = None
    is_branded: bool | None = None
    country_iso: CountryIso | None = None
    language_code: LanguageCode | None = None
    is_active: bool | None = None


class PromptBulkArchiveByFilter(Body):
    """Every prompt of the project the filter matches. Not built yet (`501`)."""

    filter: PromptSelectionFilter
    archive: bool = Field(
        description="false brings the prompts back, within the active prompt quota."
    )


def _selection_shape(value: object) -> str:
    """`ONE_TAG` names the `ids` shape and `BATCH_TAG` the `filter` one. The tags only pick the
    model; the error mapper leaves them out of a path."""
    return BATCH_TAG if isinstance(value, dict) and "filter" in value else ONE_TAG


PromptBulkArchiveBody = Annotated[
    Annotated[PromptBulkArchive, Tag(ONE_TAG)]
    | Annotated[PromptBulkArchiveByFilter, Tag(BATCH_TAG)],
    Discriminator(_selection_shape),
]


class PromptBulkSet(Patch):
    """At least one member; none may be null."""

    intent: Intent | None = None
    funnel_stage: FunnelStage | None = None
    prompt_type: PromptType | None = None
    importance: Importance | None = None
    is_branded: bool | None = None

    _not_null = field_validator(
        "intent", "funnel_stage", "prompt_type", "importance", "is_branded"
    )(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> PromptBulkSet:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class PromptBulkUpdate(Body):
    """Exactly one of `ids` and `filter`; at least one of `set`, `add_term_ids` and
    `remove_term_ids`."""

    ids: Annotated[list[UUID], Field(min_length=1, max_length=BULK_ARCHIVE_MAX)] | None = None
    filter: PromptSelectionFilter | None = None
    set: PromptBulkSet | None = None
    add_term_ids: TermIds = Field(default_factory=list)
    remove_term_ids: TermIds = Field(default_factory=list)

    @model_validator(mode="after")
    def _one_way_and_something(self) -> PromptBulkUpdate:
        if (self.ids is None) == (self.filter is None):
            raise ValueError("give exactly one of `ids` and `filter`")
        if self.set is None and not self.add_term_ids and not self.remove_term_ids:
            raise PydanticCustomError(
                "nothing_to_change", "Give `set`, or terms to add or remove."
            )
        if set(self.add_term_ids) & set(self.remove_term_ids):
            raise PydanticCustomError(
                "added_and_removed", "A term is either added or removed, not both."
            )
        return self


class PromptBulkUpdateResult(BaseModel):
    matched: int = Field(description="The project's prompts found.")
    updated: int = Field(description="Of those, the prompts that changed.")


class PromptBulkUpdateResponse(BaseModel):
    data: PromptBulkUpdateResult
```

Inside `_one_way_and_something`, `set(...)` is the builtin (the class attribute `set` is not in a method's scope), as in `TrackedKeywordBulkUpdate`. Check the import cycle: `schemas/ai.py` does not import `ai_bulk`, so `ai_bulk` may import from `ai`.

### Code: `$WT/backend/src/idraft/api/schemas/ai_limits.py`

Replace the one-line module with:

```python
"""Request and response models of the quota and limits read (WP-13 prompts-lane; contract C1)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from idraft.api.schemas.operations import ManualRuns


class QuotaUse(BaseModel):
    limit: int
    used: int


class AiLimits(BaseModel):
    """What the page header and the confirm dialogs show before a click (CF-11, prompt-dialogs
    N06): the same numbers the writes check."""

    prompts: QuotaUse = Field(
        description="Active prompts of the whole workspace against `max_active_prompts`."
    )
    ai_observations_month: QuotaUse = Field(
        description="AI answers of the whole workspace this UTC month, planned runs included, "
        "against `max_ai_observations_per_month`, counted as Run now counts them."
    )
    manual_runs_today: ManualRuns


class AiLimitsResponse(BaseModel):
    data: AiLimits
```

### Code: `$WT/backend/src/idraft/api/ai/limits_routes.py`

```python
"""The quota and limits read before a prompt is added or run (contract C1; WP-13 builds the body).

Reading needs `data:read`; the membership dependency has already refused a project outside the
caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.permissions import Permission
from idraft.api.schemas.ai_limits import AiLimitsResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/limits",
    summary="Active prompts, monthly AI answers and manual runs: used and limit",
    description="The workspace's active prompts and AI answers this UTC month, and the "
    "project's manual runs today (UTC), each with its limit, as the writes count them. Not "
    "built yet: `501 not_implemented`.",
)
@not_built
async def ai_limits(project_id: UUID, access: ReadData) -> AiLimitsResponse:
    raise not_built_yet()
```

### Code: `$WT/backend/src/idraft/api/ai/prompt_routes.py`

Imports: add `PromptLintBody`, `PromptLintItems` to the `schemas.ai` import; replace `from idraft.api.schemas.ai_bulk import PromptBulkArchive` with `from idraft.api.schemas.ai_bulk import PromptBulkArchiveBody, PromptBulkArchiveByFilter, PromptBulkUpdate, PromptBulkUpdateResponse`; `from idraft.api.stubs import not_built, not_built_yet, refuse_unbuilt`.

`lint_prompts`: `body: PromptLintBody`; first statements:

```python
    if isinstance(body, PromptLintItems):
        raise not_built_yet("Not built yet: items.")
    refuse_unbuilt({"language_code": body.language_code is not None})
```

Append to its description: `" \`items\` (with language and country, to say what is tracked) and \`language_code\` are published and not built yet (\`501\`)."`.

`bulk_archive_prompts`: `body: PromptBulkArchiveBody`; first statements:

```python
    if isinstance(body, PromptBulkArchiveByFilter):
        raise not_built_yet("Not built yet: filter.")
```

Append to its description: `" \`filter\` in place of \`ids\` is published and not built yet (\`501\`)."`.

New route, directly after `bulk_archive_prompts` and before `get_prompt`:

```python
@router.post(
    "/bulk-update",
    summary="Change the metadata of many prompts",
    description="Up to 1,000 `ids` of the project's prompts, or `filter` (the list's filters), "
    "exactly one. `set` changes intent, funnel stage, type, importance and the branded flag; "
    "`add_term_ids` and `remove_term_ids` add and remove terms. `matched` is the prompts found, "
    "`updated` those that changed. One transaction; one `prompt.bulk_changed` audit entry and "
    "one `prompt.updated` per prompt changed. Not built yet: `501 not_implemented`.",
)
@not_built
async def bulk_update_prompts(
    project_id: UUID, body: PromptBulkUpdate, access: WritePrompts
) -> PromptBulkUpdateResponse:
    raise not_built_yet()
```

### Run

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/ai/test_contract_lint_bulk.py tests/api/ai/test_contract_prompts.py tests/api/ai/test_prompt_lint.py tests/api/ai/test_prompt_bulk_archive.py tests/api/ai/test_ai_bodies.py --no-cov -n 2 -q
```

Then the light checks.

### Commit

`WP-03: lint bulk update and limits contract`, adding `src/idraft/api/schemas/ai.py`, `src/idraft/api/schemas/ai_bulk.py`, `src/idraft/api/schemas/ai_limits.py`, `src/idraft/api/ai/prompt_routes.py`, `src/idraft/api/ai/limits_routes.py`, `tests/api/ai/test_contract_lint_bulk.py`.

---

## T2: Summary additions (C2)

Brief step 2. Rows: BE-METRICS-05, BE-METRICS-22, CF-01, CF-06, OV-N1, OV-N2, OV-N3, OV-N4, OV-N10, OV-N14, OV-N15.

### Files

- Edit `$WT/backend/src/idraft/api/schemas/ai.py` (summary section only)
- Edit `$WT/backend/src/idraft/api/ai/summary_routes.py`
- Create `$WT/backend/tests/api/ai/test_contract_summary.py`

### Tests first: `$WT/backend/tests/api/ai/test_contract_summary.py`

A project with no engine and no prompt answers the summary with empty rows, which is all these tests need.

| Test | Arrange and act | Assert |
|---|---|---|
| `test_a_summary_option_that_is_not_built_answers_501` (parametrized `params`: `{"compare": "previous_period"}`, `{"include": "total"}`, `{"include": "series,co_mentions"}`, `{"rows": "topics"}`, `{"rows": "none"}`, `{"filter[outcome]": "neither"}`, `{"filter[opportunity]": "named_not_cited"}`, `{"filter[opportunity]": f"lost_to:{uuid.uuid4()}"}`, `{"group_by": "country"}`) | viewer `GET ai/prompts-summary` | `NOT_BUILT` |
| `test_the_summary_checks_access_before_it_says_not_built` | billing and outsider with `compare=previous_period` | `FORBIDDEN`, `NOT_FOUND` |
| `test_an_option_value_out_of_the_contract_is_refused` (parametrized: `compare=previous_year`, `rows=all`, `filter[opportunity]=lost_to:nope`, `group_by=language`, `filter[outcome]=lost`) | viewer | `(422, "validation_failed")` |
| `test_the_defaults_and_the_built_options_answer_as_before` | viewer, `{}`, `{"compare": "none"}`, `{"include": "series,entities"}` | 200 each; none of `compare_window`, `previous_answers`, `total`, `co_mentions`, `by_country` in `data` |
| `test_the_api_document_has_the_summary_additions` (no database) | `build_openapi()` | the summary operation has parameters `compare`, `rows`, `filter[outcome]`, `filter[opportunity]`, `group_by`; the `include` items enum is `series`, `entities`, `total`, `co_mentions`; components `EngineCells`, `EntityPreviousCells`, `SummaryTotal`, `CoMentionPair`, `EngineCoMentions`, `CountrySummary`; `EngineSummary.previous`, `EntityCells.previous`, `WeekCells.entities` and the five `PromptsSummary` additions exist and none is required |

Existing tests that must stay green unchanged: all 41 of `tests/api/ai/test_prompts_summary.py` (among them `test_an_include_that_is_not_built_is_refused` with `bogus`, the statement count tests and the `include=series,entities` tests) and `tests/api/ai/test_summary_windows.py`.

### Code: `$WT/backend/src/idraft/api/schemas/ai.py`

Replace `SummaryInclude = Literal["series", "entities"]` with:

```python
# `total` and `co_mentions`: contract C2, not built yet (`501`).
SummaryInclude = Literal["series", "entities", "total", "co_mentions"]
SummaryCompare = Literal["none", "previous_period"]
SummaryRows = Literal["topics", "none"]
SummaryGroupBy = Literal["country"]
OPPORTUNITY_PATTERN = (
    r"^(named_not_cited|cited_not_named|nobody_named"
    r"|lost_to:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
)
```

Directly after `class OutcomeCells` add:

```python
class EngineCells(BaseModel):
    """The cells of one engine over the comparison window, weighted as the current ones."""

    mentioned: MetricCell
    cited: MetricCell
    outcomes: OutcomeCells
    share_of_voice: MetricCell


class EntityPreviousCells(BaseModel):
    mentioned: MetricCell
    share_of_voice: MetricCell
```

At the end of `class EntityCells` add:

```python
    previous: EntityPreviousCells | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare=previous_period`: the cells over `compare_window`, null when "
        "the entity had no answer there; never set inside a week. " + _NOT_RETURNED,
    )
```

At the end of `class WeekCells` add:

```python
    entities: list[EntityCells] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=series,entities`: the week's cells per tracked entity, "
        "weighted as the week's own (at most 20). " + _NOT_RETURNED,
    )
```

In `class EngineSummary`, after `share_of_voice`, add:

```python
    previous: EngineCells | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare=previous_period`: the same cells over `compare_window`, null "
        "when the engine had no answer of the row's prompts there (no data is not a rate of 0). "
        + _NOT_RETURNED,
    )
```

After `class TopicSummaryRow` add:

```python
class SummaryTotal(BaseModel):
    """Every prompt in scope as one row, aggregated as a topic row is (OV-N1)."""

    prompt_count: int
    last_observed_at: datetime | None = Field(description=_LAST_OBSERVED)
    last_valid_at: datetime | None = Field(description=_LAST_VALID)
    engines: list[EngineSummary]


class CoMentionPair(BaseModel):
    a: UUID = Field(description="A tracked entity.")
    b: UUID = Field(description="Another tracked entity.")
    answers: int = Field(description="Valid answers in scope that name both.")


class EngineCoMentions(BaseModel):
    engine_code: str
    answers: int = Field(description="Valid answers in scope on the engine: the denominator.")
    pairs: list[CoMentionPair]


class CountrySummary(BaseModel):
    country_iso: str
    engines: list[EngineSummary]
```

In `class PromptsSummary`, after `window`, add:

```python
    compare_window: MetricWindow | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare=previous_period`: as many days just before `window`. "
        + _NOT_RETURNED,
    )
    previous_answers: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare`: the valid answers in scope in that window; 0 means it has "
        "no data. " + _NOT_RETURNED,
    )
```

and after `topics`:

```python
    total: SummaryTotal | None = Field(
        default=None, exclude_if=_absent, description="With `include=total`. " + _NOT_RETURNED
    )
    co_mentions: list[EngineCoMentions] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=co_mentions`: per engine, how often two tracked entities are "
        "named in one valid answer. " + _NOT_RETURNED,
    )
    by_country: list[CountrySummary] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `group_by=country`: the engine cells per prompt country. "
        + _NOT_RETURNED,
    )
```

### Code: `$WT/backend/src/idraft/api/ai/summary_routes.py`

Imports: add `OPPORTUNITY_PATTERN`, `Outcome`, `SummaryCompare`, `SummaryGroupBy`, `SummaryRows` to the `schemas.ai` import; `from idraft.api.stubs import refuse_unbuilt`. Change the `include` description to `"Blocks to add: \`series\`, \`entities\`; \`total\` and \`co_mentions\` are not built yet (\`501\`)."`. Add after `include`:

```python
    compare: Annotated[
        SummaryCompare,
        Query(description="`previous_period` adds `previous` cells. Not built yet: `501`."),
    ] = "none",
    rows: Annotated[
        SummaryRows | None,
        Query(
            description="`topics` leaves the prompt rows out, `none` both row lists (with "
            "`include=total`). Left out: every row. Not built yet: `501`."
        ),
    ] = None,
    outcome: Annotated[
        Outcome | None,
        Query(alias="filter[outcome]", description="Prompt rows by outcome. Not built yet: `501`."),
    ] = None,
    opportunity: Annotated[
        str | None,
        Query(
            alias="filter[opportunity]",
            pattern=OPPORTUNITY_PATTERN,
            description="`named_not_cited`, `cited_not_named`, `nobody_named` or "
            "`lost_to:<entity_id>`. Not built yet: `501`.",
        ),
    ] = None,
    group_by: Annotated[
        SummaryGroupBy | None,
        Query(description="`country` adds `by_country`. Not built yet: `501`."),
    ] = None,
) -> PromptsSummaryResponse:
    asked = frozenset(include or ())
    refuse_unbuilt(
        {
            "compare": compare != "none",
            "include=total": "total" in asked,
            "include=co_mentions": "co_mentions" in asked,
            "rows": rows is not None,
            "filter[outcome]": outcome is not None,
            "filter[opportunity]": opportunity is not None,
            "group_by": group_by is not None,
        }
    )
```

and pass `include=asked` to `SummaryQuery` (nothing else in the call changes). Append to the description: `" \`compare\`, \`include=total\`, \`include=co_mentions\`, \`rows\`, \`filter[outcome]\`, \`filter[opportunity]\` and \`group_by\` are published and not built yet (\`501\`)."`.

### Run

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/ai/test_contract_summary.py tests/api/ai/test_prompts_summary.py tests/api/ai/test_summary_windows.py --no-cov -n 2 -q
```

Then the light checks.

### Commit

`WP-03: summary additions contract`, adding `src/idraft/api/schemas/ai.py`, `src/idraft/api/ai/summary_routes.py`, `tests/api/ai/test_contract_summary.py`.

---

## T3a: Run coverage, daily collection, sources additions (C3, N5, sources)

Brief step 3. Rows: BE-COLLECT-10, OV-N5, CF-07, CF-08, CF-09, CF-10, OV-N6, OV-N7, BE-SOURCES-05, BE-SOURCES-06.

### Files

- Edit `$WT/backend/src/idraft/api/schemas/ai_collection.py`
- Edit `$WT/backend/src/idraft/api/operations/collection_routes.py`
- Edit `$WT/backend/src/idraft/api/schemas/ai_sources.py`
- Edit `$WT/backend/src/idraft/api/ai/source_routes.py`
- Create `$WT/backend/tests/api/operations/test_contract_collection.py`
- Create `$WT/backend/tests/api/ai/test_contract_sources.py`

### Tests first

`test_contract_collection.py`:

| Test | Act | Assert |
|---|---|---|
| `test_run_coverage_answers_501_for_a_reader` | viewer `GET runs/{uuid4}/ai-coverage` | `NOT_BUILT` |
| `test_daily_collection_answers_501_for_a_reader` | viewer `GET ai/collection/daily?from=2026-11-01&to=2026-11-07&filter[engine_code_in]=gemini_web` | `NOT_BUILT` |
| `test_both_check_access_first` (parametrized over the two paths) | billing; outsider | `FORBIDDEN`; `NOT_FOUND` |
| `test_a_bad_run_id_or_engine_is_refused` | viewer, run id `nope`; `filter[engine_code_in]=perplexity_web` | `(422, "validation_failed")` |
| `test_the_api_document_has_coverage_and_daily` (no database) | `build_openapi()` | both paths; components `AiCoverage`, `AiCoverageEngine`, `AiCoverageMissing`, `InvalidByStatus`, `CollectionDay`, `CollectionDailyMeta`, `AnswerStatusCounts`; `CollectionDay` has property `date` (not `date_`) |

`test_contract_sources.py`:

| Test | Act | Assert |
|---|---|---|
| `test_a_source_addition_answers_501` (parametrized `(path, params)`: `("sources/domains", {"include": "series"})`, `("sources/domains", {"include": "cited_with"})`, `("sources/domains", {"include": "by_role_by_engine"})`, `("sources/domains", {"min_support": "2"})`, `("sources/pages", {"include": "series"})`, `("sources/pages", {"min_support": "2"})`, and `{"filter[country_iso]": "US"}` on `sources/domains`, `sources/pages`, `citations`, `fanout-queries`) | viewer `GET ai/<path>` | `NOT_BUILT` |
| `test_source_changes_answers_501` | viewer `GET ai/sources/changes?kind=lost&min_support=3` | `NOT_BUILT` |
| `test_the_source_reads_check_access_first` | billing and outsider, `sources/changes` and `sources/domains?include=series` | `FORBIDDEN`, `NOT_FOUND` |
| `test_an_addition_out_of_bounds_is_refused` | `include=cited_with` on pages; `kind=gone`; `min_support=0`; `filter[country_iso]=us` | each `(422, "validation_failed")` |
| `test_the_source_reads_without_additions_answer_as_before` | viewer `GET ai/sources/domains` and `.../pages` | 200; `series` and `by_role_by_engine` not in `meta` |
| `test_the_api_document_has_the_source_additions` (no database) | `build_openapi()` | path `.../ai/sources/changes`; `filter[country_iso]` on the four reads; `include` and `min_support` on domains and pages; components `SourceWeekUnits`, `CitedWith`, `SourcesWeek`, `RoleAnswers`, `EngineRoleUnits`, `SourceChangeRow`, `SourceChangesMeta`, `SourceChangePage`; the new row and meta fields not required |

Existing tests that must stay green unchanged: `tests/api/ai/test_sources.py`, `test_sources_compare.py`, `test_fanout_queries.py`, `tests/api/operations/test_runs.py`.

### Code: `$WT/backend/src/idraft/api/schemas/ai_collection.py`

```python
"""Request and response models of the AI coverage of a run and daily AI collection (WP-30
runs-costs-health; contracts C3 and N5)."""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.metrics import MetricWindow
from idraft.domain.ai_engines import EngineCode

# `ops.collection_tasks.status` (migration 0004).
TaskStatus = Literal[
    "pending", "submit_unknown", "submitted", "ready", "fetched", "ingested", "failed", "dead",
    "cancelled", "skipped_cached",
]


class InvalidByStatus(BaseModel):
    partial: int
    empty: int
    refused: int
    error: int


class AiCoverageEngine(BaseModel):
    engine_code: EngineCode
    planned: int = Field(description="Tasks the run planned on the engine.")
    observed: int = Field(description="Answers stored, of any status.")
    valid: int
    invalid_by_status: InvalidByStatus
    valid_rate: MetricCell = Field(description="`valid` of `planned`.")


class AiCoverageMissing(BaseModel):
    prompt_id: UUID
    engine_code: EngineCode
    location_id: int | None
    replicate_index: int
    task_status: TaskStatus


class AiCoverage(BaseModel):
    by_engine: list[AiCoverageEngine]
    missing: list[AiCoverageMissing] = Field(
        description="Every planned task with no stored answer, at most the run's tasks."
    )


class AiCoverageResponse(BaseModel):
    data: AiCoverage


class AnswerStatusCounts(BaseModel):
    complete: int
    partial: int
    empty: int
    refused: int
    error: int


class CollectionDay(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date_: date = Field(alias="date", serialization_alias="date", description="A project day.")
    engine_code: EngineCode
    scheduled: int | None = Field(
        description="Answers the schedules active that day planned; null when unknown, never "
        "0 for unknown."
    )
    answers: int
    by_status: AnswerStatusCounts
    valid: int
    budget_blocked: int = Field(description="Runs of the day a budget blocked.")
    runs: list[UUID] = Field(description="The runs whose answers the day holds.")


class CollectionDailyMeta(BaseModel):
    window: MetricWindow
    engine_codes: list[EngineCode]


class CollectionDailyResponse(BaseModel):
    data: list[CollectionDay]
    meta: CollectionDailyMeta
```

### Code: `$WT/backend/src/idraft/api/operations/collection_routes.py`

```python
"""The AI coverage of a run and daily AI collection (contracts C3 and N5; WP-30 builds the
bodies). Reading needs `data:read`."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.schemas.ai_collection import AiCoverageResponse, CollectionDailyResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=PROJECT, tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/runs/{run_id}/ai-coverage",
    summary="Per engine, what an AI run planned, stored and found valid",
    description="A run of workload `ai_prompt` (`422 not_an_ai_run` otherwise): per engine the "
    "tasks planned, the answers stored, the valid ones and the others by status, with the valid "
    "rate; and every planned task with no stored answer. Not built yet: `501 not_implemented`.",
)
@not_built
async def ai_coverage(project_id: UUID, run_id: UUID, access: ReadData) -> AiCoverageResponse:
    raise not_built_yet()


@router.get(
    "/ai/collection/daily",
    summary="AI collection per project day and engine",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`): per day and engine the answers the "
    "schedules planned, the answers stored by status, the valid ones, the runs a budget blocked "
    "and the runs behind them. Not built yet: `501 not_implemented`.",
)
@not_built
async def collection_daily(
    project_id: UUID,
    access: ReadData,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
) -> CollectionDailyResponse:
    raise not_built_yet()
```

### Code: `$WT/backend/src/idraft/api/schemas/ai_sources.py`

Import `date` with `datetime` (`from datetime import date, datetime`). After `SourceCompare` add:

```python
SourceDomainInclude = Literal["series", "cited_with", "by_role_by_engine"]
SourcePageInclude = Literal["series"]
SourceChangeKind = Literal["new", "lost"]
_NOT_RETURNED = "Not returned yet: absent from every response until it is built."
```

Before `class SourceDomainRow` add:

```python
class SourceWeekUnits(BaseModel):
    week_start: date = Field(description="The Monday the week starts on, in the project's zone.")
    citation_units: int
    observations: int


class CitedWith(BaseModel):
    entity_id: UUID = Field(description="The tracked entity most named in answers citing it.")
    observations: int = Field(description="Answers citing it that name the entity.")
```

At the end of `class SourceDomainRow` add:

```python
    series: list[SourceWeekUnits] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=series`: a point per week of the window, oldest first, at "
        "most 14. " + _NOT_RETURNED,
    )
    cited_with: CitedWith | None = Field(
        default=None, exclude_if=_absent, description="With `include=cited_with`. " + _NOT_RETURNED
    )
    category: str | None = Field(
        default=None, exclude_if=_absent, description="The domain's category. " + _NOT_RETURNED
    )
    category_source: (
        Literal["seed_list", "rule", "llm", "manual", "tenant_override"] | None
    ) = Field(default=None, exclude_if=_absent, description=_NOT_RETURNED)
```

At the end of `class SourcePageRow` add the same `series` field. Before `class SourcesMeta` add:

```python
class SourcesWeek(BaseModel):
    week_start: date
    answers: int
    citation_units: int
    distinct_domains: int


class RoleAnswers(BaseModel):
    citation_units: int
    answers_citing: int


class EngineRoleUnits(BaseModel):
    engine_code: EngineCode
    own: RoleAnswers
    competitor: RoleAnswers
    third_party: RoleAnswers
```

At the end of `class SourcesMeta` add:

```python
    series: list[SourcesWeek] | None = Field(
        default=None, exclude_if=_absent, description="With `include=series`. " + _NOT_RETURNED
    )
    by_role_by_engine: list[EngineRoleUnits] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=by_role_by_engine` on domains. " + _NOT_RETURNED,
    )
```

After `class SourcePagePage` add:

```python
class SourceChangeRow(BaseModel):
    registrable_domain: str
    domain_role: DomainRole
    role_entity_id: UUID | None
    current_units: int = Field(description="Citation units in the window.")
    previous_units: int = Field(description="Citation units in the window compared with.")
    first_seen_at: datetime | None = Field(description="Its first citation in the window.")
    last_seen_at: datetime | None = Field(description="Its last citation in the window.")


class SourceChangesMeta(BaseModel):
    window: MetricWindow
    compare_window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode]
    kind: SourceChangeKind
    min_support: int


class SourceChangePage(BaseModel):
    data: list[SourceChangeRow]
    page: OffsetPageInfo
    meta: SourceChangesMeta
```

### Code: `$WT/backend/src/idraft/api/ai/source_routes.py`

Imports: add `SourceChangeKind`, `SourceChangePage`, `SourceDomainInclude`, `SourcePageInclude` to the `schemas.ai_sources` import; `from idraft.api.stubs import not_built, not_built_yet, refuse_unbuilt`. After `COMPARE = ...` add:

```python
_NOT_BUILT = "Not built yet: `501 not_implemented`."

CountryFilter = Annotated[
    str | None,
    Query(
        alias="filter[country_iso]",
        pattern=r"^[A-Z]{2}$",
        description="The answers of the prompts of one market, ISO 3166-1 alpha-2. " + _NOT_BUILT,
    ),
]
MinSupport = Annotated[
    int | None,
    Query(ge=1, le=1000, description="The fewest citation units a row is listed for. " + _NOT_BUILT),
]
```

`source_domains`: add parameters

```python
    include: Annotated[
        list[SourceDomainInclude] | None,
        Commas,
        Query(description="Blocks to add: `series`, `cited_with`, `by_role_by_engine`. " + _NOT_BUILT),
    ] = None,
    min_support: MinSupport = None,
    country_iso: CountryFilter = None,
```

and first statement

```python
    refuse_unbuilt(
        {
            "include": bool(include),
            "min_support": min_support is not None,
            "filter[country_iso]": country_iso is not None,
        }
    )
```

`source_pages`: the same three with `list[SourcePageInclude]` (description `"Blocks to add: \`series\`. "`) and the same statement. `citation_list` and `fanout_queries`: add `country_iso: CountryFilter = None` and first statement `refuse_unbuilt({"filter[country_iso]": country_iso is not None})`.

New route, after `source_pages`:

```python
@router.get(
    "/sources/changes",
    summary="New and lost sources against the window before",
    description=SCOPE
    + "`kind=new` (default): domains with at least `min_support` citation units in the window "
    "and none in as many days before. `kind=lost`: domains with at least `min_support` units "
    "before and none in the window. One row per registrable domain and role; offset pages. "
    + _NOT_BUILT,
)
@not_built
async def source_changes(
    project_id: UUID,
    access: ReadData,
    scope: Scope,
    page: Offset,
    kind: SourceChangeKind = "new",
    min_support: Annotated[int, Query(ge=1, le=1000)] = 2,
    country_iso: CountryFilter = None,
) -> SourceChangePage:
    raise not_built_yet()
```

(BE-SOURCES-05 asks "lost" over two full windows; WP-14 records the exact window rule in the sources note's change log before it builds, Q18.)

### Run

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/operations/test_contract_collection.py tests/api/ai/test_contract_sources.py tests/api/ai/test_sources.py tests/api/ai/test_sources_compare.py tests/api/ai/test_fanout_queries.py tests/api/operations/test_runs.py --no-cov -n 2 -q
```

Then the light checks.

### Commit

`WP-03: collection and sources contract`, adding the four source files and the two test files above.

---

## T3b: Annotations, notes, layouts (N9, N13, C12a)

Brief step 3. Rows: OV-N9, OV-N13, BE-REPORTS-09 (contract), BE-LAYOUTS-02, BE-LAYOUTS-03, BE-LAYOUTS-04, BE-LAYOUTS-06 (shape), BE-LAYOUTS-07, BE-LAYOUTS-10 (no route, D-01), BE-LAYOUTS-11 (no route, D-12), CF-29.

### Files

- Edit `$WT/backend/src/idraft/api/schemas/ai_notes.py`
- Edit `$WT/backend/src/idraft/api/ai/annotation_routes.py`
- Edit `$WT/backend/src/idraft/api/notes/routes.py`
- Edit `$WT/backend/src/idraft/api/schemas/ai_layouts.py`
- Edit `$WT/backend/src/idraft/api/layouts/routes.py`
- Create `$WT/backend/tests/api/ai/test_contract_notes.py`
- Create `$WT/backend/tests/api/layouts/__init__.py` (empty) and `$WT/backend/tests/api/layouts/test_contract_layouts.py`

### Tests first

`test_contract_notes.py`:

| Test | Act | Assert |
|---|---|---|
| `test_annotations_answer_501_for_a_reader` | viewer `GET ai/annotations?from=2026-11-01&to=2026-11-07` | `NOT_BUILT` |
| `test_notes_list_answers_501_for_a_reader` | viewer `GET notes` | `NOT_BUILT` |
| `test_writing_a_note_needs_notes_write` | viewer `POST notes` with a valid body; editor the same; editor `DELETE notes/{uuid4}`; viewer the same | viewer `FORBIDDEN` twice; editor `NOT_BUILT` twice |
| `test_a_note_body_out_of_bounds_is_refused_before_501` (parametrized: text of 141 characters; `"one\ntwo"`; `scope: {"kind": "topic"}`; `scope: {"kind": "term"}` without `term_id`; `on: "11/03/2026"`; an extra member) | editor `POST notes` | `(422, "validation_failed")` |
| `test_notes_and_annotations_refuse_another_workspace` (parametrized over the four routes) | outsider | `NOT_FOUND` |
| `test_the_api_document_has_annotations_and_notes` (no database) | `build_openapi()` | paths `.../ai/annotations` (get), `.../notes` (get, post), `.../notes/{note_id}` (delete); components `Annotation`, `AnnotationList`, `NoteCreate`, `Note`, `NoteList`, `NoteResponse`, `ProjectNoteScope`, `TermNoteScope`; `Annotation` has properties `from` and `to` |

Valid note body: `{"on": "2026-11-03", "text": "Published /pricing v2", "scope": {"kind": "project"}}`.

`test_contract_layouts.py` (URL `f"/api/v1/workspaces/{workspace.id}/..."`):

| Test | Act | Assert |
|---|---|---|
| `test_any_member_reaches_the_personal_routes` (parametrized role: `viewer`, `billing`, `editor`) | `GET layouts/ai_overview`, `PUT me/layouts/ai_overview` with `{"schema": 1}`, `DELETE me/layouts/ai_overview` | each `NOT_BUILT` |
| `test_the_team_default_needs_layouts_manage` | editor and admin, `PUT layouts/ai_overview/default` with `{"schema": 1, "cards": [{"id": "c1", "type": "ai.by_engine", "width": "half"}]}`, then `DELETE` | editor `FORBIDDEN` twice; admin `NOT_BUILT` twice |
| `test_layouts_refuse_another_workspace` (parametrized over the five routes) | outsider | `NOT_FOUND` |
| `test_a_document_out_of_bounds_is_refused_before_501` (parametrized: `{"schema": 2}`; `{}`; 13 cards; 7 numbers; `width: "wide"`; card `id` `"has space"`; `type` `"AI By Engine"`; `options: {"rows": 5}`; `options: {"Rows": "5"}`; `{"schema": 1, "extra": 1}`; number `engine: "perplexity_web"`) | viewer `PUT me/layouts/ai_overview` | `(422, "validation_failed")` |
| `test_a_screen_that_is_not_a_key_is_refused` | viewer `GET layouts/AI-Overview` | `(422, "validation_failed")` |
| `test_the_api_document_has_the_layout_routes` (no database) | `build_openapi()` | the three paths with their five methods; components `LayoutDocument` (property `schema`, required `schema`), `NumberItem`, `CardItem`, `ResolvedLayout`, `ResolvedLayoutResponse`, `LayoutEditor`; both `PUT` operations have a header parameter `If-Match` that is not required; `ResolvedLayout.screen` is the 11 screen keys |

### Code: `$WT/backend/src/idraft/api/schemas/ai_notes.py`

```python
"""Request and response models of notes and annotations (WP-38 notes-annotations; contracts N9
and N13)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from idraft.api.schemas.common import Body, printable
from idraft.domain.ai_engines import EngineCode

NOTE_TEXT_MAX: Final = 140

AnnotationKind = Literal[
    "model_changed", "entity_set_changed", "extractor_changed", "prompt_set_changed"
]


class Annotation(BaseModel):
    """A boundary drawn on every time chart (overview-and-charts N9)."""

    model_config = ConfigDict(populate_by_name=True)

    at: datetime
    kind: AnnotationKind
    engine_code: EngineCode | None = Field(description="Set for a model change.")
    from_: int | str | None = Field(
        alias="from", serialization_alias="from", description="The value before the change."
    )
    to: int | str | None = Field(description="The value after the change.")
    label: str


class AnnotationList(BaseModel):
    data: list[Annotation] = Field(description="Oldest first.")


# One line, shown escaped; a control character is refused.
NoteText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=NOTE_TEXT_MAX),
    AfterValidator(printable),
]


class ProjectNoteScope(Body):
    kind: Literal["project"]


class TermNoteScope(Body):
    kind: Literal["term"]
    term_id: UUID = Field(description="A term the project may use (`term_unknown` otherwise).")


NoteScope = Annotated[ProjectNoteScope | TermNoteScope, Field(discriminator="kind")]


class NoteCreate(Body):
    on: date = Field(description="The project day the note is drawn on.")
    text: NoteText
    scope: NoteScope


class NoteAuthor(BaseModel):
    user_id: UUID
    name: str


class Note(BaseModel):
    note_id: UUID
    on: date
    text: str = Field(description="Shown as text, never as markup.")
    scope: NoteScope
    created_by: NoteAuthor | None
    created_at: datetime


class NoteResponse(BaseModel):
    data: Note


class NoteList(BaseModel):
    data: list[Note] = Field(description="By `on`, then `created_at`, oldest first.")
```

### Code: `$WT/backend/src/idraft/api/ai/annotation_routes.py`

```python
"""Chart annotations: model, entity set, extractor and prompt set changes (contract N9; WP-38
builds the body). Reading needs `data:read`."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.schemas.ai_notes import AnnotationList
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/annotations",
    summary="The changes every AI time chart marks",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`), oldest first: a new `model_reported` "
    "per engine, entity set, extractor and prompt set changes. Not built yet: `501 "
    "not_implemented`.",
)
@not_built
async def annotations(
    project_id: UUID,
    access: ReadData,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
) -> AnnotationList:
    raise not_built_yet()
```

### Code: `$WT/backend/src/idraft/api/notes/routes.py`

```python
"""Notes on a project's charts (contract N13; WP-38 builds the bodies). Reading needs
`data:read`, writing `notes:write` (owner, admin, editor; owner decision D-18)."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.permissions import Permission
from idraft.api.schemas.ai_notes import NoteCreate, NoteList, NoteResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes", tags=["notes"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteNotes = Annotated[WorkspaceAccess, Depends(require_permission(Permission.NOTES_WRITE))]
_NOT_BUILT = " Not built yet: `501 not_implemented`."


@router.get(
    "",
    summary="The project's chart notes",
    description="Notes drawn on days from `from` to `to` (default the 28 days ending today; at "
    "most 92, `422 window_too_large`), project wide and per term." + _NOT_BUILT,
)
@not_built
async def list_notes(
    project_id: UUID,
    access: ReadData,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
) -> NoteList:
    raise not_built_yet()


@router.post(
    "",
    status_code=201,
    summary="Add a chart note",
    description="At most 140 characters on one line, for the project or one term "
    "(`term_unknown` for a term the project may not use)." + _NOT_BUILT,
)
@not_built
async def create_note(project_id: UUID, body: NoteCreate, access: WriteNotes) -> NoteResponse:
    raise not_built_yet()


@router.delete("/{note_id}", status_code=204, summary="Delete a chart note", description=_NOT_BUILT.strip())
@not_built
async def delete_note(project_id: UUID, note_id: UUID, access: WriteNotes) -> Response:
    raise not_built_yet()
```

(`ruff format` wraps the `delete` decorator.)

### Code: `$WT/backend/src/idraft/api/schemas/ai_layouts.py`

```python
"""Request and response models of layouts (WP-11 layouts-api; contract C12a, docs/19 section
3.11.5c and the layout spec sections 4, 6 and 9)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from idraft.api.schemas.common import Body, printable
from idraft.domain.ai_engines import EngineCode

NUMBERS_MAX: Final = 6
CARDS_MAX: Final = 12

LayoutScreen = Literal[
    "overview", "ai_overview", "rankings", "prompts", "citations", "sources", "pages",
    "inspector.keyword", "inspector.prompt", "inspector.page", "inspector.citation",
]
CardWidth = Literal["third", "half", "two_thirds", "full"]
# A plain token (layout spec section 6.3 rule 6).
ItemId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
# A card type or metric key of the catalog; WP-11 checks it against the generated catalog JSON
# for the screen (owner decision D-10).
CatalogKey = Annotated[
    str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
]
OptionKey = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")]
OptionValue = Annotated[str, StringConstraints(max_length=256), AfterValidator(printable)]


class NumberItem(Body):
    id: ItemId
    metric: CatalogKey = Field(description="A metric registry key (docs/16 section 2.1).")
    engine: EngineCode | None = Field(
        default=None, description="Required when `metric` is an AI metric."
    )


class CardItem(Body):
    id: ItemId
    type: CatalogKey
    width: CardWidth | None = Field(
        default=None, description="Dashboard screens only; left out: the type's default."
    )
    options: dict[OptionKey, OptionValue] | None = Field(
        default=None,
        description="A flat object of strings; each card type checks its own in the web app.",
    )


class LayoutDocument(Body):
    """The numbers and cards of one screen, in order: a full snapshot, at most 16 KB."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: Literal[1] = Field(
        alias="schema", serialization_alias="schema", description="The document format version."
    )
    numbers: Annotated[list[NumberItem], Field(max_length=NUMBERS_MAX)] | None = None
    cards: Annotated[list[CardItem], Field(max_length=CARDS_MAX)] | None = None


class LayoutEditor(BaseModel):
    user_id: UUID
    name: str


class ResolvedLayout(BaseModel):
    screen: LayoutScreen
    source: Literal["personal", "team", "builtin"]
    document: LayoutDocument | None = Field(
        description="Null when `source` is `builtin`: the web app holds the built-in default."
    )
    team_default_exists: bool
    updated_at: datetime | None
    updated_by: LayoutEditor | None


class ResolvedLayoutResponse(BaseModel):
    data: ResolvedLayout
```

(`ruff format` reflows the long `Annotated` lines.)

### Code: `$WT/backend/src/idraft/api/layouts/routes.py`

```python
"""Team default and personal page layouts (contract C12a, docs/19 section 3.11.5c; WP-11 builds
the bodies). A layout belongs to the workspace and is the same in every project. Personal
layouts need membership only; the team default needs `layouts:manage` (owner, admin; D-11).
Presets are code in the web app (D-01), so there is no preset route."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Response

from idraft.api.permissions import Permission
from idraft.api.schemas.ai_layouts import LayoutDocument, ResolvedLayoutResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import MemberAccess, require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["layouts"])

ManageLayouts = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.LAYOUTS_MANAGE))
]
Screen = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z_]+(\.[a-z_]+)?$",
        description="A screen key (layout spec section 4); an unknown one is `404`.",
    ),
]
IfMatch = Annotated[
    str | None,
    Header(
        alias="If-Match",
        max_length=128,
        description="The `ETag` of the layout as read; required when one exists, `412 "
        "precondition_failed` when it changed.",
    ),
]
_NOT_BUILT = " Not built yet: `501 not_implemented`."


@router.get(
    "/layouts/{screen}",
    summary="The layout a member sees on a screen",
    description="Their personal layout, else the team default, else `source: builtin` with a "
    "null document; with an `ETag`." + _NOT_BUILT,
)
@not_built
async def get_layout(screen: Screen, access: MemberAccess) -> ResolvedLayoutResponse:
    raise not_built_yet()


@router.put(
    "/me/layouts/{screen}",
    summary="Save the caller's own layout of a screen",
    description="Card types and metric keys of the catalog for the screen, allowed widths, at "
    "most 12 cards and 6 numbers, at most 16 KB (`422 validation_failed` with field paths)."
    + _NOT_BUILT,
)
@not_built
async def put_personal_layout(
    screen: Screen, body: LayoutDocument, access: MemberAccess, if_match: IfMatch = None
) -> ResolvedLayoutResponse:
    raise not_built_yet()


@router.delete(
    "/me/layouts/{screen}",
    status_code=204,
    summary="Go back to the team or built-in default",
    description=_NOT_BUILT.strip(),
)
@not_built
async def delete_personal_layout(screen: Screen, access: MemberAccess) -> Response:
    raise not_built_yet()


@router.put(
    "/layouts/{screen}/default",
    summary="Save the team default of a screen",
    description="As the personal layout; audited as `layout.default.set` with the documents "
    "before and after." + _NOT_BUILT,
)
@not_built
async def put_team_layout(
    screen: Screen, body: LayoutDocument, access: ManageLayouts, if_match: IfMatch = None
) -> ResolvedLayoutResponse:
    raise not_built_yet()


@router.delete(
    "/layouts/{screen}/default",
    status_code=204,
    summary="Remove the team default of a screen",
    description="Audited as `layout.default.remove`." + _NOT_BUILT,
)
@not_built
async def delete_team_layout(screen: Screen, access: ManageLayouts) -> Response:
    raise not_built_yet()
```

### Run

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/ai/test_contract_notes.py tests/api/layouts/test_contract_layouts.py --no-cov -n 2 -q
```

Then the light checks.

### Commit

`WP-03: annotations notes and layouts contract`, adding the five source files and the three test files above.

---

## T4: Route access and cross-tenant entries

Brief step 4. Rows: BE-OPS-01 (every new route scanned). Before starting: ask the coordinator for a lease on the non-anchor lines of `backend/tests/security/test_cross_tenant.py` (Risks).

### Files

- Edit `$WT/backend/tests/api/test_route_access.py` (under `# WP-03 contract-pack` only)
- Edit `$WT/backend/tests/security/test_cross_tenant.py` (the WP-03 anchors, plus the leased lines below)

### `test_route_access.py`, under `# WP-03 contract-pack` in `EXPECTED`

```python
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/bulk-update"): (
        "prompts:write"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/limits"): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}/ai-coverage"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/collection/daily"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/changes"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/annotations"): (
        "data:read"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes"): "notes:write",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes/{note_id}"): (
        "notes:write"
    ),
    ("GET", "/api/v1/workspaces/{workspace_id}/layouts/{screen}"): "member",
    ("PUT", "/api/v1/workspaces/{workspace_id}/me/layouts/{screen}"): "member",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/me/layouts/{screen}"): "member",
    ("PUT", "/api/v1/workspaces/{workspace_id}/layouts/{screen}/default"): "layouts:manage",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/layouts/{screen}/default"): "layouts:manage",
```

Under `# WP-03 contract-pack` in `PATH_PARAMETERS`:

```python
    # A screen key of the layout spec (`ai_overview`), a word and not an id, after the workspace.
    "screen",
    # Inside one project, after `{project_id}`: the service reads the note within it.
    "note_id",
```

Then `uv run ruff format tests/api/test_route_access.py` (the formatter decides the wrapping; no blank line may sit between anchors inside the literal, WP-01 D5).

### `test_cross_tenant.py`, WP-03 anchors

`BODIES`, under `# WP-03 contract-pack`:

```python
    ("POST", _W + "/projects/{project_id}/prompts/bulk-update"): {
        "ids": ["{prompt_id}"],
        "set": {"importance": 1},
    },
    ("POST", _W + "/projects/{project_id}/notes"): {
        "on": "2026-11-03",
        "text": "Planted note",
        "scope": {"kind": "project"},
    },
    ("PUT", _W + "/me/layouts/{screen}"): {
        "schema": 1,
        "cards": [{"id": "c1", "type": "ai.by_engine"}],
    },
    ("PUT", _W + "/layouts/{screen}/default"): {
        "schema": 1,
        "cards": [{"id": "c1", "type": "ai.by_engine"}],
    },
```

`QUERIES`: nothing (no new required parameter; the new options answer 501 and their owners add them here when built). `_TENANT_ROWS`: nothing (no table).

Seeding block of `_tenant`, the line right under `# WP-03 contract-pack`:

```python
    # No notes table yet: a note id that names nothing. WP-38 seeds a real note under its own
    # line and removes this one.
    more_ids["note_id"] = str(uuid.uuid4())
```

### `test_cross_tenant.py`, leased lines (outside the anchors)

1. Move the `WORDS` assignment and its two comment lines from below `BODIES` to directly after `def _names`, and add the screen:

```python
# A path parameter that is a word, not an id of the tenant: it must not count as one of its
# secrets, since every response would then seem to hold it.
WORDS = {"kind": "gsc", "engine_code": "chatgpt_web", "screen": "ai_overview"}
```

2. `CHILD_ROUTES`: a word names nothing inside the workspace.

```python
# Routes that also name something inside the workspace: a project, a member, an invitation. A
# word (`WORDS`) names nothing, so a path whose only other parameter is a word is no child.
CHILD_ROUTES = [
    (method, path)
    for method, path in WORKSPACE_ROUTES
    if set(_names(path)) - {"workspace_id", *WORDS}
]
```

3. After `ALL_ROUTES = _routes()`, add (import `from idraft.api.stubs import is_not_built`):

```python
def _not_built() -> set[tuple[str, str]]:
    """Routes whose contract is published and whose body is not built (idraft.api.stubs): they
    answer 501 once every access check has passed."""
    found: set[tuple[str, str]] = set()
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        if is_not_built(getattr(route.original_route, "endpoint", None)):
            found.update((method, route.path) for method in route.methods)
    return found


NOT_BUILT = _not_built()
```

4. In `test_a_project_outside_the_members_scope_is_not_found`, replace the `if ... else` on `inside` with:

```python
    if (method, path) in EVERY_PROJECT_ONLY:
        assert _problem(inside) == (403, "forbidden")
    elif (method, path) in NOT_BUILT:
        # Inside the member's scope a published contract answers that its body is not built.
        assert _problem(inside) == (501, "not_implemented")
    else:
        assert inside.status_code < 300, inside.text
```

5. In `test_a_list_holds_nothing_of_another_workspace`, directly after the `response = await api.get(...)` statement:

```python
    if (method, path) in NOT_BUILT:
        assert _problem(response) == (501, "not_implemented")
        return
```

6. Add one test after `test_every_route_is_scoped_by_a_workspace_or_accounted_for`:

```python
def test_the_published_contracts_are_the_not_built_routes() -> None:
    """The stubs of docs/superpowers/plans/2026-11-13-ai-wp-03-contract-pack.md; a package that
    builds a body drops its route from this set by removing the mark."""
    assert NOT_BUILT <= set(WORKSPACE_ROUTES)
    assert ("GET", _W + "/layouts/{screen}") in NOT_BUILT
    assert ("GET", _W + "/layouts/{screen}") not in CHILD_ROUTES
```

### Run (all three suites go green only after T5 regenerates the document; run these two now)

```bash
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/test_route_access.py tests/security/test_cross_tenant.py --no-cov -n 2 -q
```

Both must pass here (neither reads `v1.json`). Then the light checks.

### Commit

`WP-03: route access and cross tenant entries`, adding `tests/api/test_route_access.py`, `tests/security/test_cross_tenant.py`.

---

## T5: Regenerate the API document and the web client

Brief step 5. Rows: none (process).

```bash
cd $WT/backend && uv run python -m idraft.api.openapi > openapi/v1.json
cd $WT/apps/web && pnpm gen:api
```

Then, medium lane:

```bash
cd $WT && ./infra/dev/heavy --lane medium --label "WP-03 typecheck" -- bash -c 'cd apps/web && pnpm typecheck && pnpm test src/lib/api/schema.test.ts'
cd $WT/backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/api/test_openapi.py tests/api/test_route_access.py tests/security/test_cross_tenant.py tests/api/test_stubs.py tests/api/ai tests/api/operations tests/api/layouts --no-cov -n 2 -q
```

If `pnpm typecheck` fails, fix the web caller in the smallest way (for example an exhaustive map over `LintWarning['rule']`); the web file goes in this commit and the report names it.

### Review the diff route by route (`git diff -- backend/openapi/v1.json`)

| Path | Method | Expected change |
|---|---|---|
| `{P}/prompts` | get | 5 new query parameters; `filter[is_active]` is boolean or `any`; nothing removed |
| `{P}/prompts` | post | `PromptCreate` gains 4 optional members; `GeneratedFrom` |
| `{P}/prompts/bulk-create` | post | through `PromptCreate` only |
| `{P}/prompts/{prompt_id}` | patch | header `If-Match`, optional |
| `{P}/prompts/{prompt_id}`, list, create | responses | `Prompt` gains 2 optional fields |
| `{P}/prompts/lint` | post | body `oneOf` `PromptLintRequest` and `PromptLintItems`; `PromptLintRequest.language_code`; `LintWarning.rule` 7 values; optional `tracked`, `near_duplicate_of`, `suggested_prompt_type`, `would_create`, `estimate` |
| `{P}/prompts/bulk-archive` | post | body `oneOf` `PromptBulkArchive` (unchanged) and `PromptBulkArchiveByFilter` |
| `{P}/prompts/bulk-update` | post | new |
| `{P}/ai/limits` | get | new |
| `{P}/ai/prompts-summary` | get | 5 new parameters, `include` 4 values; optional fields on `EngineSummary`, `EntityCells`, `WeekCells`, `PromptsSummary`; 6 new components |
| `{P}/ai/sources/domains`, `pages` | get | `include`, `min_support`, `filter[country_iso]`; optional row and meta fields |
| `{P}/ai/citations`, `{P}/ai/fanout-queries` | get | `filter[country_iso]` |
| `{P}/ai/sources/changes` | get | new |
| `{P}/runs/{run_id}/ai-coverage`, `{P}/ai/collection/daily` | get | new |
| `{P}/ai/annotations`, `{P}/notes`, `{P}/notes/{note_id}` | get, get and post, delete | new |
| `{W}/layouts/{screen}`, `{W}/me/layouts/{screen}`, `{W}/layouts/{screen}/default` | get; put and delete; put and delete | new |

Anything else in the diff (a renamed component, a field that became required, a removed enum value) is a defect: find the cause before committing. Check `git diff --stat` names only `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` (plus a web caller if one had to change).

### Commit

`WP-03: regenerated api document and web client`, adding `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`.

---

## T6: Contract notes and As built notes

Brief step 6 (notes). Rows: none (process). May run beside T4 once T3b is committed.

### Contract notes (create, one per group)

| File | Group | Holds |
|---|---|---|
| `$WT/docs/ai-visibility/contracts/c1-prompts.md` | C1 | list filters and sort, create members, `Prompt` fields, `If-Match`, lint `items` and response fields, bulk update, bulk archive by filter, limits |
| `$WT/docs/ai-visibility/contracts/c2-summary.md` | C2 | the summary parameters and fields of T2 |
| `$WT/docs/ai-visibility/contracts/c3-n5-collection.md` | C3, N5 | run coverage, daily collection |
| `$WT/docs/ai-visibility/contracts/sources-additions.md` | CF-07 to CF-10, N6, N7 | source parameters, fields, `sources/changes` |
| `$WT/docs/ai-visibility/contracts/n9-annotations.md` | N9 | annotations |
| `$WT/docs/ai-visibility/contracts/n13-notes.md` | N13 | notes |
| `$WT/docs/ai-visibility/contracts/c12a-layouts.md` | C12a | the five layout routes |

Each note has, in this order: a status line (`Published by WP-03 on 2026-11-13; owner <WP-nn>; every item answers 501 until the owner builds it`); `## Routes` (method, path, permission, owner); `## Fields` (one table per model: field, type, bounds, optional or nullable, meaning, source row id); `## Errors` (code, status, when: the default 401, 403, 404, 422 and 501 plus the route codes of T1 to T3: `quota_exceeded`, `nothing_to_change`, `added_and_removed`, `term_unknown`, `window_too_large`, `range_invalid`, `not_an_ai_run`, `engine_has_no_fanout`, `precondition_failed`, `invalid_cursor`); `## Example` (one request and one response JSON per route, valid against the models); `## Decisions` (the rows of the Open questions table that touch the group); `## Change log` (a table `| Date | Change | Package |` with the first row `2026-11-13 | Published | WP-03`). C12a adds: WP-11 puts `GET {W}/layouts/{screen}` in `COUNT_ROUTES` of the cross-tenant suite when it builds it. C2 adds: WP-12 writes the `filter[outcome]` row rule in the change log before building it (Q13); D-04 (10 prompts) is WP-12's pooling threshold and adds no field.

Check every example before committing, from `$WT/backend`, for each response example saved to a scratch file: `uv run python -c "import json,sys; from idraft.api.schemas.<module> import <Model>; <Model>.model_validate(json.load(open(sys.argv[1])))" <file>`. Scratch files go in the session scratchpad, never in the repository.

### As built notes (append only)

`$WT/docs/19-api-specification.md`, at the end of section 3.7.10, directly before `### 3.8 Cross-channel`:

```text
**As built (AI visibility WP-03, 2026-11-13): contract pack.** Published, answering `501
not_implemented` after the access checks (`backend/src/idraft/api/stubs.py`): `POST
{P}/prompts/bulk-update`, `GET {P}/ai/limits`, `GET {P}/runs/{run_id}/ai-coverage`, `GET
{P}/ai/collection/daily`, `GET {P}/ai/sources/changes`, `GET {P}/ai/annotations`, `GET/POST
{P}/notes`, `DELETE {P}/notes/{note_id}`, `GET {W}/layouts/{screen}`, `PUT/DELETE
{W}/me/layouts/{screen}`, `PUT/DELETE {W}/layouts/{screen}/default`. Added to built routes, each
answering `501` when used and changing nothing when left out: prompt list filters
(`prompt_type_in`, `funnel_stage_in`, `importance_in`, `is_branded`, `is_active=any`) and `sort`;
create members `is_branded`, `source`, `creation_method`, `generated_from`; `If-Match` on `PATCH`;
lint `items` and `language_code`; bulk archive by `filter`; summary `compare`, `include=total`,
`include=co_mentions`, `rows`, `filter[outcome]`, `filter[opportunity]`, `group_by`; source
`include`, `min_support` and `filter[country_iso]`. New response fields are absent until built.
Shapes and choices: docs/ai-visibility/contracts/ and plan
`docs/superpowers/plans/2026-11-13-ai-wp-03-contract-pack.md`.
```

`$WT/docs/29-phase-roadmap.md`, in `### Phase 9: AI analytics`, directly after the WP-01 As built paragraph:

```text
**As built (AI visibility WP-03, 2026-11-13): contract pack.** The wave 1 and wave 2 API shapes
are in `backend/openapi/v1.json` and the web client: 14 routes answer `501 not_implemented` after
their access checks, and 11 built operations gained optional parameters, body members and
response fields that answer `501` when used. No table, no behaviour change for an existing caller
(contract notes in docs/ai-visibility/contracts/).
```

### Commit

`WP-03: contract notes and as built notes`, adding the seven notes, `docs/19-api-specification.md`, `docs/29-phase-roadmap.md`.

---

## T7: Rebase, final checks, push

Brief step 6 (rebase, checks, push).

```bash
cd $WT && git fetch origin && git rebase origin/develop
```

On a conflict: generated files by regeneration (T5 commands, both in the same commit), anchor blocks by keeping both sides. After the rebase, from `$WT/backend`: the light checks, then the T5 targeted pytest command. Then the full checks through the heavy lane, in the background:

```bash
cd $WT/backend && export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock && ../infra/dev/heavy --label "WP-03 check" -- ./check.sh
cd $WT && ./infra/dev/heavy --label "WP-03 web" -- bash -c 'pnpm install --frozen-lockfile && cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build'
```

Push: `git push origin HEAD:develop` (fast-forward only; if rejected, fetch, rebase, re-run the targeted checks). Never push `main`, never run `infra/ship.sh`. Report to the coordinator:

```text
WP-03 merged | branch ai/wp-03-contract-pack @ <short sha> | rows done 0/0 | steps 7/7 | blockers: none | next: WP-11, WP-12, WP-13, WP-14, WP-30, WP-38 can start; web packages run pnpm gen:api
```

with the prove-it-bites results and the lease used in T4.

Final review (a second fresh Sonnet reviewer): `git diff origin/develop...HEAD` against the brief's acceptance criteria and this file: every route of the row map is in `v1.json`; every stub is marked and raises only `not_built_yet()`; no existing test file changed except the two security tests; `main.py`, `resources.py`, `permissions.py`, `problems.py` untouched; no service or repository file changed; the T5 table matches the diff. No page changed, so there is no browser check. This package touches tenant tests, so the coordinator may add the Opus end review of D-52.

## Prove it bites (reviewer, scratch commit, never pushed)

| Guard | Weakening | Test expected to fail |
|---|---|---|
| Permission before 501 | `create_note` takes `access: ReadData` instead of `WriteNotes` | `test_writing_a_note_needs_notes_write` (viewer gets 501), `test_the_declared_access_is_the_documented_access` |
| Permission before 501 | `put_team_layout` takes `MemberAccess` | `test_the_team_default_needs_layouts_manage`, route access table |
| Tenant scoping before 501 | `bulk_update_prompts` drops its `access` parameter | `test_every_route_declares_who_may_call_it`, `test_bulk_update_is_refused_to_a_viewer_and_another_workspace` (outsider gets 501), `test_another_workspaces_path_is_not_found` |
| Tenant scoping before 501 | `get_layout` gets a first parameter `_: Annotated[None, Depends(_refuse)]` with `def _refuse() -> None: raise not_built_yet()` (raised before the membership check) | `test_layouts_refuse_another_workspace`, `test_another_workspaces_path_is_not_found` |
| Body checked before 501 | `create_note` takes `body: dict[str, object]` | `test_a_note_body_out_of_bounds_is_refused_before_501` |
| Mark matches body | remove `@not_built` from `ai_limits` | `test_a_project_outside_the_members_scope_is_not_found` (inside answers 501) |
| Mark matches body | keep `@not_built` on `list_notes` but return `NoteList(data=[])` | `test_a_project_outside_the_members_scope_is_not_found` (expects 501) |
| Additive only: built route unchanged when left out | in `prompts_summary`, call `refuse_unbuilt({"compare": True})` always | `test_the_defaults_and_the_built_options_answer_as_before`, the 41 summary tests |
| Additive only: new parameter refused | delete the `refuse_unbuilt` call of `source_domains` | `test_a_source_addition_answers_501` |
| Additive only: field absent | drop `exclude_if=_absent` from `PromptsSummary.total` | `test_the_defaults_and_the_built_options_answer_as_before` |
| Additive only: default kept | `filter[is_active]` default `"any"` | `test_the_list_without_additions_answers_as_before`, `tests/api/ai/test_prompts.py` |
| Word rule | remove `*WORDS` from `CHILD_ROUTES` | `test_another_workspaces_child_in_the_callers_own_path_is_not_found` for the layouts routes, `test_the_published_contracts_are_the_not_built_routes` |

The report lists each weakening and the failing test names.

## Row map

Every row of the brief's groups, the task and the route or model that covers it.

| Row | Task | Route or model |
|---|---|---|
| BE-PROMPTS-06 | T1b | `POST {P}/prompts/bulk-archive` `PromptBulkArchiveByFilter` |
| BE-PROMPTS-07, CF-12, PD-N09 | T1b | `POST {P}/prompts/bulk-update` |
| BE-PROMPTS-09, PD-N03, PD-LINT-03 to PD-LINT-07 | T1b | `LintRule`, `PromptLintRequest.language_code` |
| BE-PROMPTS-10, PD-N02, PD-LINT-08 | T1a, T1b | `Prompt.prompt_type_source`, `PromptLint.suggested_prompt_type` |
| BE-PROMPTS-11, CF-13 | T1a | `filter[prompt_type_in]` |
| BE-PROMPTS-12 | T1a | `filter[funnel_stage_in]`, `filter[importance_in]`, `filter[is_branded]`, `sort` |
| BE-PROMPTS-15, PD-N07 | T1a | `PromptCreate.source`, `creation_method`, `generated_from` |
| BE-PROMPTS-16, PD-N06, CF-11 | T1b | `GET {P}/ai/limits` |
| PD-N01, PD-LINT-09 | T1b | lint `items`, `PromptLint.tracked`, `near_duplicate_of`, `PromptQuota.would_create` |
| PD-N04 | T1a | `PromptCreate.is_branded`, `Prompt.is_branded_source` |
| PD-N05 | T1b | `PromptLintResponse.estimate` |
| PD-N11 | T1a | `If-Match` on `PATCH {P}/prompts/{prompt_id}` |
| PD-N13 | T1a | `filter[is_active]=any` |
| BE-METRICS-05, CF-01, OV-N2 | T2 | `compare`, `EngineSummary.previous`, `EntityCells.previous`, `compare_window`, `previous_answers` |
| CF-06, OV-N3 | T2 | `WeekCells.entities` |
| OV-N1 | T2 | `include=total`, `SummaryTotal` |
| OV-N15 | T2 | `rows` |
| BE-METRICS-22, OV-N4 | T2 | `group_by=country`, `by_country` |
| OV-N10 | T2 | `filter[outcome]`, `filter[opportunity]` |
| OV-N14 | T2 | `include=co_mentions`, `co_mentions` |
| BE-COLLECT-10 | T3a | `GET {P}/runs/{run_id}/ai-coverage` |
| OV-N5 | T3a | `GET {P}/ai/collection/daily` |
| CF-07, OV-N6 | T3a | `include=series` on domains and pages, row and meta `series` |
| CF-08 | T3a | `filter[country_iso]` on domains, pages, citations, fan-out |
| CF-09, BE-SOURCES-05, BE-SOURCES-06 | T3a | `min_support` on domains and pages; `GET {P}/ai/sources/changes` |
| CF-10 | T3a | `include=cited_with`, `cited_with`, `category`, `category_source` |
| OV-N7 | T3a | `include=by_role_by_engine`, `meta.by_role_by_engine` |
| OV-N9 | T3b | `GET {P}/ai/annotations` |
| OV-N13, BE-REPORTS-09 | T3b | `GET/POST {P}/notes`, `DELETE {P}/notes/{note_id}` |
| BE-LAYOUTS-02, 03, 04, 06, 07, CF-29 | T3b | the five layout routes, `LayoutDocument`, `ResolvedLayout` |
| BE-LAYOUTS-10 (D-01), BE-LAYOUTS-11 (D-12) | T3b | no route, by decision (stated in the router docstring and the C12a note) |
| BE-OPS-01 | T4 | route access and cross-tenant entries |

Rows left out of this package on purpose:

| Row | Reason |
|---|---|
| PD-N08, PD-B18 (keyword links, from-keywords preview) | Wave 4 (WP-44); its own first push publishes the contract |
| PD-N10 (candidates inbox) | Wave 4 (WP-45) |
| PD-N12, PD-B11, PD-B12 (restore events, versions, version feed) | Wave 4 (WP-41) |
| PD-N14, PD-B10, BE-PROMPTS-13 (panels, dry run, `filter[panel]`) | Wave 4 (WP-42) |
| PD-B13, PD-B14, PD-B15 (AI Overview cell, recommendation, statistics) | Waves 5 and 6 (WP-64, WP-54, WP-58) |
| BE-PROMPTS-15 `expected_frequency` | Owner decision: no frequency per prompt (Q28) |
| BE-TOPICS-02, BE-TOPICS-03 | Unverified whether already built (inventory section 28); WP-13 checks and publishes only if a field is missing |
| `PromptPage.meta.quota` (C1), `GET {W}/quotas` (N06 option) | D6: the limits read covers them |
| `filter[source_in]`, `filter[has_keyword_links]`, `include` on prompts (doc 19) | Not in C1 and no wave 1 or 2 consumer; additive later |
| BE-METRICS-06 (`previous_year`, `compare_from`, `compare_to`) | D1 keeps `previous_year` a 422; additive later |
| BE-METRICS-13, 14, 15, 21 (cells among answers with citations, citation share, first mention, fan-out per answer) | Not in the C2 list of the brief; WP-12 publishes them additively in its first push |
| C2 `MetricCell.ci` | Wave 4 statistics (WP-58) |
| BE-SOURCES-07, CF-05 (diversity) | D-41: the web computes effective sources in the interim; WP-14 publishes the route in its first push |
| BE-SOURCES-11, 20, 22, 25, BE-FANOUT-03, BE-TOPICS-12 | No wave 1 or 2 contract need named in the brief; WP-14 publishes any shape it adds |
| OV-N8, OV-N11, OV-N12 | Waves 3 to 5 (WP-60, WP-57, WP-58) |
| C12a overview aggregates (`ai/metrics/*`, `ai/stats/compare`) | Wave 3 consumers (WP-33); WP-32 publishes them |
```
