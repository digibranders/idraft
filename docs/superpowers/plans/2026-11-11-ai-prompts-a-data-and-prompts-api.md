# AI prompts, plan A: data, contract and the prompts and engines API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `ai.*` tables of slice 1 (migration 0018), the engine and base plan constants, the AI answer schedules, and the prompt and engine routes of doc 19 sections 3.7.1 and 3.7.4 cut to slice 1, with the OpenAPI contract and the web client regenerated.

**Architecture:** One raw SQL migration creates the ten tables of doc 04 sections 8.1 to 8.5 with row-level security, grants per role, monthly partitions, the engine seed, the AI prices and the base plan quota. Pure constants live in `idraft.domain.ai_engines`; shared prompt rules (text, schedule, prices) in a new package `idraft.ai` below the entrypoints. The API follows the `idraft.api.entities` layout: repository, service and routes per area under `idraft.api.ai`, models in `idraft.api.schemas.ai`, services in `Resources`.

**Tech Stack:** Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2 Core (async), PostgreSQL 18 (asyncpg), Alembic with raw SQL, pytest with Testcontainers, import-linter, openapi-typescript for the web client.

Spec: `docs/superpowers/specs/2026-11-11-ai-prompt-tracking-slice-1-design.md` (section 7 steps 2 to 4 and the prompt and engine rows of section 4.5). Plan B (adapters, workload, ingest, extraction, read routes) and plan C (web screens) build on the names below.

Work in the worktree `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-prompts` on branch `ai/prompts-slice1`. Paths below are relative to it. Every backend command runs in `backend/` with the Colima variables set:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend
```

The gate at the end of every task (each must print what is shown). Fix and format first: `ruff check --fix` settles the import order and `ruff format` the wrapping of long expressions; what is left must be fixed by hand.

```bash
uv run ruff check --fix . && uv run ruff format .
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # N files already formatted
uv run mypy                    # Success: no issues found in N source files
uv run lint-imports            # Contracts: 5 kept, 0 broken.
```

Two other sessions' files are uncommitted in this worktree (`docs/superpowers/specs/...design.md` and `docs/ops/eventus-ai-prompts.csv`). Never stage them: every commit below names its files.

---

## Names

Other plans import these. Signatures are exact.

**Database (migration `backend/src/idraft/db/migrations/versions/0018_ai_prompts.py`, `revision = "0018"`, `down_revision = "0017"`)**

- Tables `ai.engines`, `ai.project_engines`, `ai.prompts`, `ai.prompt_versions`, `ai.prompt_terms`, `ai.observations`, `ai.citations`, `ai.derivations`, `ai.entity_mentions`, `ai.observation_facts`. Columns as doc 04 sections 8.1 to 8.5, plus `workspace_id` on `ai.derivations` and `ai.prompt_terms` (decision A1).
- Partitioned by month on `observed_at` and registered in `ops.partitioned_tables`: `ai.observations`, `ai.citations`, `ai.entity_mentions`, `ai.observation_facts`.
- Unique keys plan B writes against: `ai.observations` `observations_id_observed_at_workspace_id_key (id, observed_at, workspace_id)` and `observations_one_per_task (collection_task_id, observed_at)`; `ai.derivations` `derivations_identity (project_id, extractor_version, entity_config_version, recommendation_version, sentiment_version)` and `derivations_id_workspace_id_key (id, workspace_id)`.
- Function `ai.observation_raw(p_observation_id bigint)`: the raw payload row of an answer of the transaction's workspace, `EXECUTE` for `app_api` only (same columns as `seo.serp_snapshot_raw`).
- Grants: the worker has `SELECT` on `ai.engines`, `ai.project_engines`, `ai.prompts`, `ai.prompt_versions`, and `SELECT, INSERT` on `ai.derivations`, `ai.observations`, `ai.citations`, `ai.entity_mentions`, `ai.observation_facts`, and now `SELECT` on `core.entity_aliases`.
- Price book rows, provider `dataforseo`, `price_unit = 'task'`: endpoints `ai_optimization/chat_gpt/llm_scraper`, `ai_optimization/gemini/llm_scraper`, `serp/google/ai_mode`, each `0.0012` with `{"queue": "standard"}` and `0.0024` with `{"queue": "priority"}`.
- `core.workspace_quotas.max_active_prompts` defaults to 150.

**`idraft.db.tables`**: `ai_engines`, `ai_project_engines`, `ai_prompts`, `ai_prompt_versions`, `ai_prompt_terms`, `ai_observations`, `ai_citations`, `ai_derivations`, `ai_entity_mentions`, `ai_observation_facts`.

**`idraft.domain.ai_engines`** (pure)

- `PROVIDER_CODE: Final = "dataforseo"`
- `COUNTRY: Final = "Country"`
- `class EngineCode(StrEnum)`: `CHATGPT_WEB = "chatgpt_web"`, `GEMINI_WEB = "gemini_web"`, `GOOGLE_AI_MODE = "google_ai_mode"`
- `class ObservationClass(StrEnum)`: `CONSUMER_UI`, `OFFICIAL_API`, `SERP_AI`
- `@dataclass(frozen=True, slots=True) class Engine(code: EngineCode, label: str, observation_class: ObservationClass, vendor: str, exposes_citations: bool, exposes_fanout: bool, endpoint: str, max_prompt_chars: int, location_types: frozenset[str])` with `fits(self, text: str) -> bool` and `runs_at(self, location_type: str) -> bool`
- `ENGINES: Final[Mapping[EngineCode, Engine]]`
- `PROMPT_TEXT_MAX: Final` (2000)
- `type Queue = Literal["standard", "priority"]`
- `@dataclass(frozen=True, slots=True) class BasePlan(max_prompts: int, runs_per_week: int, queue: Queue, answers_per_engine: int)` with property `provider_mode -> str`
- `BASE_PLAN: Final = BasePlan(max_prompts=150, runs_per_week=2, queue="standard", answers_per_engine=1)`
- `monthly_cost(prompts: int, unit_price: Decimal, plan: BasePlan = BASE_PLAN) -> Decimal`

**`idraft.ai`** (shared, below the entrypoints)

- `idraft.ai.text.normalize(text: str) -> str`
- `idraft.ai.text.text_hash(text: str) -> bytes`
- `idraft.ai.schedule.AiRun(weekday: int, name: str)`, `idraft.ai.schedule.AiScheduleRule(window_start_local: time, window_hours: int, runs: tuple[AiRun, ...])`, `idraft.ai.schedule.AI_SCHEDULE: Final[AiScheduleRule]`
- `async idraft.ai.schedule.ensure_ai_schedule(db: AsyncSession, *, workspace_id: UUID, project_id: UUID, now: datetime) -> None`
- `async idraft.ai.pricing.task_prices(db: AsyncSession, *, queue: Queue, on: date) -> dict[str, Decimal]` (by endpoint)

**API**

- `idraft.api.schemas.ai`: `PromptType`, `ChangeKind`, `CreationMethod`, `CountryIso`, `PromptText`, `LintRule`, `LintSeverity`, `BULK_CREATE_MAX`, `LINT_MAX`, `TERMS_MAX`, `LOCATIONS_MAX`, `PromptCreate`, `PromptBulkCreate`, `PromptPatch`, `PromptVersion`, `PromptTerm`, `Prompt`, `PromptResponse`, `PromptPage`, `PromptSkipped`, `PromptRejected`, `PromptBulkResult`, `PromptBulkResponse`, `PromptLintRequest`, `LintSpan`, `LintWarning`, `MatchedAlias`, `PromptLint`, `PromptQuota`, `PromptLintResponse`, `Engine`, `ProjectEngine`, `ProjectEngineList`, `ProjectEngineResponse`, `EngineUpdate`. Plan B adds its answer and summary models to this module.
- `idraft.api.ai.prompt_routes.router` (prefix `/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts`, tag `ai`; plan B adds `POST /{prompt_id}/run-now` here), `idraft.api.ai.prompt_routes.prompt_view(record: PromptRecord) -> Prompt`
- `idraft.api.ai.engine_routes.router` (prefix `.../projects/{project_id}/engines`, tag `ai`)
- `idraft.api.ai.prompt_service.PromptService(*, sessions)`; `idraft.api.ai.engine_service.EngineService(*, sessions)`; `async idraft.api.ai.engine_service.live_project(db: AsyncSession, access: WorkspaceAccess, project_id: UUID, *, lock: bool = False) -> None`
- `idraft.api.ai.prompt_repository`: `PromptRecord`, `VersionRecord`, `PromptFilter`, `NewPrompt`, `get_prompt(db, workspace_id, project_id, prompt_id, *, lock=False) -> PromptRecord | None`, `quota_usage(db, workspace_id) -> tuple[int, int]`
- `idraft.api.ai.engine_repository`: `ProjectEngineRecord`, `project_engines(db, workspace_id, project_id) -> dict[EngineCode, ProjectEngineRecord]`, `enabled_countries(db, workspace_id, project_id) -> dict[EngineCode, set[str]]`
- `Resources.prompts: PromptService`, `Resources.ai_engines: EngineService`
- `idraft.api.entities.project_service.MatcherRules(entities: list[MatcherEntity], rules: list[EntityRule], aliases: list[AliasRule])` and `async matcher_rules(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> MatcherRules`
- Audit actions: `prompt.created`, `prompt.updated`, `prompt.archived`, `project_engine.updated`, `project_engine.deleted`
- Schedule rules: `WORKLOADS["ai_prompt"]` in `idraft.api.operations.schedules`

**Test helpers**: `tests.db.support.insert_prompt(db, workspace_id, project_id, text, *, language_code="en", country_iso="US", is_active=True, created_by=None) -> tuple[uuid.UUID, uuid.UUID]`, `tests.db.support.seed_ai(...)`; `tests.api.ai.support`: `ai_project`, `prompt_body`, `add_prompt`, `added`, `enable_engine`, `seed_prompts`, `set_prompt_quota`.

---

## Decisions this plan makes

- **A1. Tenant keys.** Doc 04 gives `ai.derivations` and `ai.prompt_terms` no `workspace_id`. Every tenant table must carry it with the `tenant_isolation` policy (`tests/db/test_rls.py` reads the catalog), and every key between tenant tables must include it (the same test), so both gain the column and every foreign key between tenant tables carries the workspace, as migrations 0011 and 0013 did. No doc 04 column is renamed or dropped. Answer rows name entities and URLs without keys (historical facts, as in 0013). `ai.observations` gains a key to `ops.raw_payloads` and the two unique keys of the Names section.
- **A2. Duplicate prompts.** `409 duplicate` is "same text hash, language and country in the project", archived prompts included (they keep their answers; bring one back with `PATCH is_active: true`). A unique index cannot express it: the hash lives on `ai.prompt_versions` and the language and country on `ai.prompts`, and copying the hash onto `ai.prompts` would add a column doc 04 does not have and that slice 4 text edits would have to keep in step. Prompt writers of a workspace already take an advisory lock for the quota count (as `keywords.writer.lock_quota` does), so the duplicate check runs under the same lock and cannot be overtaken. An index on `ai.prompt_versions (workspace_id, text_hash)` keeps the check cheap. "Normalized" is composed (NFC) and trimmed, nothing more: case and inner spacing are what the engine receives.
- **A3. Base plan.** Owner, 2026-11-11: 150 prompts, twice a week, standard queue, one answer per engine. Billing does not exist, so `BASE_PLAN` is configuration and is enforced where the code already enforces such things: the quota row (`max_active_prompts`, default 150, with rows still at the old default of 1,000 moved to 150), the schedules, and `ai.project_engines.replicates`. A later plan changes the quota row only.
- **A4. Twice a week is two weekly schedules.** `ops.schedules` reserves a `cron` cadence, but `idraft.domain.schedules.Cadence` has no cron rule and the planner skips cron rows (`collectors/planner.py`, `_next_due`). So `ensure_ai_schedule` writes two weekly schedules, Monday (weekday 1) and Thursday (weekday 4), 01:00 project time, 8 hours (doc 21 section 2, doc 07 section 4.3), `standard_queue`, selector `{"all": true}`.
- **A5. Supported location.** `core.provider_location_map.supports` holds only `serp` today: the location sync reads the SERP list, and no AI location list is synced. So an engine's `location_ids` must be active `Country` locations (`Engine.runs_at`), and a prompt's country must be the country of one of each enabled engine's locations. A country outside the ChatGPT scraper's own 192 is not caught at save; its tasks fail at collection and are stored as `error`. Syncing the AI location lists is left for later.
- **A6. Prompt length.** `PROMPT_TEXT_MAX` (2,000, the longest any engine takes) is a hard limit (`prompt_too_long`). A prompt between 701 and 2,000 characters is saved and skipped by AI Mode (spec section 5); the lint warns, and the engine list counts only prompts that fit each engine.
- **A7. Archive.** `DELETE {P}/prompts/{prompt_id}` sets `is_active = false` and keeps everything (spec 4.5). `deleted_at` stays unused in slice 1.

## Deviations from doc 19

Slice 1 does not do these; task 9 writes them into doc 19 as "As built" notes.

- No `Idempotency-Key` on `bulk-create` (the API has no idempotency handling): a repeated request is safe because every prompt it would add again is a duplicate (`skipped`, or `rejected` with `duplicate`).
- No panels: no `panel_ids`, `panel_reason`, `filter[panel]`, `include=panels`, `422 panel_locked`.
- No keyword links: no `keyword_ids`, `generated_from`, `filter[has_keyword_links]`, `include=links`, `from-keywords/preview`.
- No persona and no context preamble: `persona_term_id` and `context_preamble` are not taken or shown.
- No versions, restore, timeline, `bulk-update` or `bulk-archive` routes; `PATCH` takes no `If-Match`.
- `country_iso` is required. `PATCH` refuses `text`, `language_code` and `country_iso` (`immutable_field`): archive the prompt and add a new one.
- `expected_frequency` is not taken: the base plan runs every prompt twice a week. `is_branded` is computed from the project's own aliases when a prompt is saved; `PATCH` may set it; there is no `is_branded_source`.
- `POST {P}/prompts` returns no `meta.lint`. `POST {P}/prompts/lint` takes `texts` (up to 1,000, so a pasted list is checked in one call) and `engine_codes`, returns one result per text and the workspace's prompt quota, and has two rules: `contains_brand_alias` and `engine_limit`.
- The list sorts newest first and takes no `sort`; filters are `q`, `term`, `intent_in`, `country_iso`, `language_code` and `is_active`.
- `PUT {P}/engines/{engine_code}` takes `location_ids` and `is_enabled` only: `provider_code` is `dataforseo` and `replicates` 1. `GET {P}/engines` lists all three engines, configured or not, each with `estimated_monthly_cost_usd` as if it were on. `location_not_supported` means "not an active country" (decision A5); `engine_inactive` is not raised.
- **For the owner:** the active prompt quota defaults to 150 for now (the base plan), not the 1,000 of doc 04 section 2.

## File map

| File | Task | What it holds |
|---|---|---|
| `backend/src/idraft/domain/ai_engines.py` | 1 | Engine codes, engine facts, base plan, monthly cost |
| `backend/src/idraft/ai/__init__.py`, `ai/text.py` | 1 | Shared prompt rules package; text normalization and hash |
| `backend/pyproject.toml` | 1 | `idraft.ai` joins the "lower layers" contract |
| `backend/src/idraft/db/migrations/versions/0018_ai_prompts.py` | 2 | The migration |
| `backend/src/idraft/db/tables.py` | 2 | Ten `Table` objects |
| `backend/tests/db/support.py`, `test_tables.py`, `test_grants.py`, `test_domain_values.py`, `test_ai_schema.py` | 2 | Schema tests |
| `backend/src/idraft/ai/schedule.py`, `ai/pricing.py` | 3 | Schedules and prices |
| `backend/src/idraft/api/operations/schedules.py` | 3 | `ai_prompt` schedule rules |
| `backend/src/idraft/api/entities/project_service.py` | 4 | `matcher_rules` |
| `backend/src/idraft/api/schemas/ai.py` | 5 | Request and response models |
| `backend/src/idraft/api/ai/engine_repository.py`, `engine_service.py`, `engine_routes.py` | 6 | Engines |
| `backend/src/idraft/api/ai/prompt_repository.py`, `prompt_service.py`, `prompt_routes.py` | 7, 8 | Prompts |
| `backend/src/idraft/api/audit.py`, `resources.py`, `main.py` | 6, 7 | Wiring |
| `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` | 6, 7, 8 | Regenerated contract |
| `docs/19-api-specification.md`, `docs/04-data-model.md`, `docs/29-phase-roadmap.md` | 9 | As built notes |

---

### Task 1: Engine constants, base plan and prompt text

**Files:**
- Create: `backend/src/idraft/domain/ai_engines.py`
- Create: `backend/src/idraft/ai/__init__.py`
- Create: `backend/src/idraft/ai/text.py`
- Modify: `backend/pyproject.toml` (the "lower layers never import the entrypoints" contract)
- Test: `backend/tests/domain/test_ai_engines.py`, `backend/tests/ai/__init__.py`, `backend/tests/ai/test_text.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/domain/test_ai_engines.py`:

```python
"""The AI engines and the base plan (docs/07 sections 1, 3 and 7; owner, 2026-11-11)."""

from decimal import Decimal

import pytest

from idraft.domain.ai_engines import (
    BASE_PLAN,
    ENGINES,
    PROMPT_TEXT_MAX,
    BasePlan,
    EngineCode,
    ObservationClass,
    monthly_cost,
)


def test_slice_one_collects_three_engines_through_their_own_endpoints() -> None:
    assert {code: engine.endpoint for code, engine in ENGINES.items()} == {
        EngineCode.CHATGPT_WEB: "ai_optimization/chat_gpt/llm_scraper",
        EngineCode.GEMINI_WEB: "ai_optimization/gemini/llm_scraper",
        EngineCode.GOOGLE_AI_MODE: "serp/google/ai_mode",
    }
    assert all(engine.code is code for code, engine in ENGINES.items())
    assert {code: engine.observation_class for code, engine in ENGINES.items()} == {
        EngineCode.CHATGPT_WEB: ObservationClass.CONSUMER_UI,
        EngineCode.GEMINI_WEB: ObservationClass.CONSUMER_UI,
        EngineCode.GOOGLE_AI_MODE: ObservationClass.SERP_AI,
    }


@pytest.mark.parametrize(
    ("code", "limit"),
    [
        (EngineCode.CHATGPT_WEB, 2000),
        (EngineCode.GEMINI_WEB, 2000),
        (EngineCode.GOOGLE_AI_MODE, 700),
    ],
)
def test_a_prompt_fits_an_engine_up_to_its_limit(code: EngineCode, limit: int) -> None:
    engine = ENGINES[code]
    assert engine.fits("x" * limit)
    assert not engine.fits("x" * (limit + 1))


def test_the_longest_prompt_any_engine_takes_is_the_text_limit() -> None:
    assert PROMPT_TEXT_MAX == 2000


def test_every_engine_runs_in_countries_only() -> None:
    for engine in ENGINES.values():
        assert engine.runs_at("Country")
        assert not engine.runs_at("City")


def test_the_base_plan_is_150_prompts_twice_a_week_on_the_standard_queue() -> None:
    assert BASE_PLAN == BasePlan(
        max_prompts=150, runs_per_week=2, queue="standard", answers_per_engine=1
    )
    assert BASE_PLAN.provider_mode == "standard_queue"


def test_a_full_base_plan_costs_about_4_68_a_month_on_three_engines() -> None:
    per_engine = monthly_cost(BASE_PLAN.max_prompts, Decimal("0.0012"))
    # 150 prompts x 2 runs a week x 52 / 12 weeks x $0.0012 a task.
    assert per_engine == Decimal("1.56")
    assert per_engine * len(ENGINES) == Decimal("4.68")


def test_the_cost_grows_with_runs_and_answers() -> None:
    plan = BasePlan(max_prompts=10, runs_per_week=1, queue="priority", answers_per_engine=3)
    # 10 x 1 x 3 x 52 / 12 x $0.0024 = $0.312.
    assert monthly_cost(10, Decimal("0.0024"), plan) == Decimal("0.31")
    assert monthly_cost(0, Decimal("0.0012")) == Decimal("0.00")
```

`backend/tests/ai/__init__.py`: an empty file.

`backend/tests/ai/test_text.py`:

```python
"""Prompt text as it is stored, hashed and compared (docs/04 section 8.2)."""

import hashlib

from idraft.ai.text import normalize, text_hash


def test_text_is_trimmed_and_composed() -> None:
    assert normalize("  Cafe\u0301 near me?  ") == "Caf\u00e9 near me?"


def test_case_and_inner_spacing_are_what_the_engine_receives() -> None:
    assert normalize("Best  CRM?") == "Best  CRM?"


def test_the_hash_is_the_sha256_of_the_normalized_text() -> None:
    assert text_hash(" Cafe\u0301? ") == hashlib.sha256("Caf\u00e9?".encode()).digest()
    assert text_hash("Cafe\u0301?") == text_hash("Caf\u00e9?")
    assert text_hash("Best CRM?") != text_hash("best crm?")
    assert len(text_hash("x")) == 32
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/domain/test_ai_engines.py tests/ai/test_text.py -q`
Expected: collection errors, `ModuleNotFoundError: No module named 'idraft.domain.ai_engines'` and `No module named 'idraft.ai'`.

- [ ] **Step 3: Write the constants module**

`backend/src/idraft/domain/ai_engines.py`:

```python
"""The AI engines of prompt tracking, slice 1, and the base plan (docs/07-dataforseo-ai-
integration.md sections 1, 3 and 7; spec 2026-11-11 sections 2 to 5).

Pure values. The API checks prompts against them, migration 0018 seeded `ai.engines` and the
price book with the same values (tests/db/test_ai_schema.py keeps the two equal), and the AI
workload reads the endpoints, the length limits and the plan.

Billing does not exist yet, so the base plan is configuration (owner, 2026-11-11). It is enforced
where such limits already live: the prompt limit through
`core.workspace_quotas.max_active_prompts` (default 150 since migration 0018), the runs per week
through the project's schedules (`idraft.ai.schedule`), and the answers per engine through
`ai.project_engines.replicates`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType
from typing import Final, Literal

# Every slice 1 engine is collected through DataForSEO.
PROVIDER_CODE: Final = "dataforseo"
# `core.locations.location_type` of a country.
COUNTRY: Final = "Country"


class EngineCode(StrEnum):
    CHATGPT_WEB = "chatgpt_web"
    GEMINI_WEB = "gemini_web"
    GOOGLE_AI_MODE = "google_ai_mode"


class ObservationClass(StrEnum):
    """`ai.engines.observation_class` and `ai.observations.observation_class` (doc 04 8.1)."""

    CONSUMER_UI = "consumer_ui"
    OFFICIAL_API = "official_api"
    SERP_AI = "serp_ai"


@dataclass(frozen=True, slots=True)
class Engine:
    code: EngineCode
    label: str
    observation_class: ObservationClass
    vendor: str
    exposes_citations: bool
    exposes_fanout: bool
    # The `provider_endpoint` of a task in the ledger and the `endpoint` of its price.
    endpoint: str
    # The longest prompt the endpoint takes (doc 07 sections 3.1 to 3.3). A longer prompt is
    # saved and skipped for this engine.
    max_prompt_chars: int
    # Where the engine runs. Countries only in slice 1: the ChatGPT scraper takes no city (doc 07
    # section 3.1), and the other two follow so that a prompt stands for one market everywhere.
    location_types: frozenset[str]

    def fits(self, text: str) -> bool:
        return len(text) <= self.max_prompt_chars

    def runs_at(self, location_type: str) -> bool:
        return location_type in self.location_types


_COUNTRIES_ONLY: Final = frozenset({COUNTRY})

ENGINES: Final[Mapping[EngineCode, Engine]] = MappingProxyType(
    {
        EngineCode.CHATGPT_WEB: Engine(
            code=EngineCode.CHATGPT_WEB,
            label="ChatGPT",
            observation_class=ObservationClass.CONSUMER_UI,
            vendor="openai",
            exposes_citations=True,
            exposes_fanout=True,
            endpoint="ai_optimization/chat_gpt/llm_scraper",
            max_prompt_chars=2000,
            location_types=_COUNTRIES_ONLY,
        ),
        EngineCode.GEMINI_WEB: Engine(
            code=EngineCode.GEMINI_WEB,
            label="Gemini",
            observation_class=ObservationClass.CONSUMER_UI,
            vendor="google",
            exposes_citations=True,
            exposes_fanout=False,
            endpoint="ai_optimization/gemini/llm_scraper",
            # Doc 07 section 3.2: the same request shape as the ChatGPT scraper.
            max_prompt_chars=2000,
            location_types=_COUNTRIES_ONLY,
        ),
        EngineCode.GOOGLE_AI_MODE: Engine(
            code=EngineCode.GOOGLE_AI_MODE,
            label="Google AI Mode",
            observation_class=ObservationClass.SERP_AI,
            vendor="google",
            exposes_citations=True,
            exposes_fanout=False,
            endpoint="serp/google/ai_mode",
            max_prompt_chars=700,
            location_types=_COUNTRIES_ONLY,
        ),
    }
)

# The longest prompt that can be saved: the longest any engine takes.
PROMPT_TEXT_MAX: Final = max(engine.max_prompt_chars for engine in ENGINES.values())

type Queue = Literal["standard", "priority"]


@dataclass(frozen=True, slots=True)
class BasePlan:
    """What a workspace gets until billing exists."""

    max_prompts: int
    runs_per_week: int
    queue: Queue
    answers_per_engine: int

    @property
    def provider_mode(self) -> str:
        """The plan's queue as `ops.schedules.provider_mode` names it."""
        return f"{self.queue}_queue"


BASE_PLAN: Final = BasePlan(
    max_prompts=150, runs_per_week=2, queue="standard", answers_per_engine=1
)

_WEEKS_PER_YEAR: Final = 52
_CENT: Final = Decimal("0.01")


def monthly_cost(prompts: int, unit_price: Decimal, plan: BasePlan = BASE_PLAN) -> Decimal:
    """What one engine costs for this many prompts in an average month (52 weeks over 12), to
    the cent: doc 07 section 7.2 with the plan's runs and answers."""
    weekly = Decimal(prompts * plan.runs_per_week * plan.answers_per_engine) * unit_price
    return (weekly * _WEEKS_PER_YEAR / 12).quantize(_CENT)
```

- [ ] **Step 4: Write the shared package and the text rules**

`backend/src/idraft/ai/__init__.py`:

```python
"""AI prompt rules shared by the API and the worker: prompt text, schedules and prices. Below the
entrypoints: it never imports the API or the worker."""
```

`backend/src/idraft/ai/text.py`:

```python
"""Prompt text as it is stored, sent and compared (docs/04-data-model.md section 8.2:
`text_hash = sha256(NFC(text))`).

A composed and a decomposed "é" are different bytes but one prompt, so text is composed (NFC)
and trimmed before it is stored, hashed or compared. Nothing else changes: case and inner
spacing are what the engine receives, so "Best CRM?" and "best crm?" are two prompts.
"""

from __future__ import annotations

import hashlib
import unicodedata


def normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text.strip())


def text_hash(text: str) -> bytes:
    """The sha256 of the normalized text's UTF-8 bytes: 32 bytes, half of a prompt's identity
    (with its language and country)."""
    return hashlib.sha256(normalize(text).encode("utf-8")).digest()
```

- [ ] **Step 5: Keep `idraft.ai` below the entrypoints**

In `backend/pyproject.toml`, the contract named `"lower layers never import the entrypoints"` becomes:

```toml
[[tool.importlinter.contracts]]
name = "lower layers never import the entrypoints"
type = "forbidden"
source_modules = [
  "idraft.ai",
  "idraft.collectors",
  "idraft.db",
  "idraft.keywords",
  "idraft.storage",
  "idraft.config",
]
forbidden_modules = ["idraft.api", "idraft.worker"]
```

`idraft.ai` reads the database (schedules, prices), so it is not pure and needs no contract of its own.

- [ ] **Step 6: Run the tests and the gate**

Run: `uv run pytest --no-cov tests/domain/test_ai_engines.py tests/ai/test_text.py -q`
Expected: `12 passed`.
Run the gate commands. Expected as in the header.

- [ ] **Step 7: Commit**

```bash
git add backend/src/idraft/domain/ai_engines.py backend/src/idraft/ai/__init__.py \
  backend/src/idraft/ai/text.py backend/pyproject.toml backend/tests/domain/test_ai_engines.py \
  backend/tests/ai/__init__.py backend/tests/ai/test_text.py
git commit -m "AI engines, base plan and prompt text rules"
```

---

### Task 2: Migration 0018, the AI tables, seeds, grants and quota

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0018_ai_prompts.py`
- Modify: `backend/src/idraft/db/tables.py` (imports; ten tables at the end of the file)
- Modify: `backend/tests/db/support.py` (`TENANT_TABLES`, `insert_prompt`, `seed_ai`, `seed_tenant`)
- Modify: `backend/tests/db/test_tables.py` (`DECLARED`)
- Modify: `backend/tests/db/test_grants.py` (`MATRIX`, `FUNCTIONS`)
- Modify: `backend/tests/db/test_domain_values.py` (two rows)
- Test: `backend/tests/db/test_ai_schema.py`

The brief asked for `test_cross_tenant.py` `_TENANT_ROWS` here; it is changed with the routes (tasks 6 and 7), because its checksum asserts that the API test tenant has a row in every listed table, and that tenant only gets AI rows with the routes. A search found no test asserting the old prompt quota of 1,000 (`grep -rn "1000" tests | grep -i prompt` prints nothing), so none changes for decision A3.

- [ ] **Step 1: Write the failing schema test**

`backend/tests/db/test_ai_schema.py`:

```python
"""The rules the AI tables keep by themselves (docs/04-data-model.md section 8; migration 0018)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import asyncpg
import pytest
from alembic import command

from idraft.db.migrate import alembic_config
from idraft.domain.ai_engines import BASE_PLAN, ENGINES
from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, insert_prompt, scoped, seed_tenant
from tests.db.test_rank_schema import refused

type Db = asyncpg.Connection[asyncpg.Record]

PARTITIONED = ("ai.observations", "ai.citations", "ai.entity_mentions", "ai.observation_facts")


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


async def _answer(
    db: Db, tenant: Tenant, *, observed_at: datetime | None = None, task_id: int | None = None
) -> int:
    """Another answer to the tenant's seeded prompt, on its seeded raw payload."""
    answer_id: int = await db.fetchval(
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, collection_task_id, "
        "query_text, provider_code, provider_endpoint, status, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT COALESCE($1::timestamptz, now()), current_date, p.workspace_id, p.project_id, "
        "'chatgpt_web', 'consumer_ui', p.id, p.current_version_id, $2::bigint, 'best crm', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', 'complete', false, "
        "(SELECT raw_payload_id FROM ai.observations WHERE workspace_id = $3 LIMIT 1), 1, 1, 1 "
        "FROM ai.prompts p WHERE p.workspace_id = $3 LIMIT 1 RETURNING id",
        observed_at,
        task_id,
        tenant.workspace_id,
    )
    return answer_id


async def test_the_answer_tables_are_partitioned_by_month_and_registered(
    migrated: PostgresServer,
) -> None:
    month = datetime.now(UTC).strftime("%Y%m")
    async with connection(migrated) as db:
        for table in PARTITIONED:
            current = await db.fetchval("SELECT to_regclass($1)", f"{table}_p{month}")
            registered = await db.fetchval(
                "SELECT count(*) FROM ops.partitioned_tables WHERE parent = $1::regclass", table
            )
            assert current is not None, table
            assert registered == 1, table


async def test_the_engines_are_seeded_as_the_code_knows_them(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT code, label, observation_class, vendor, exposes_citations, exposes_fanout, "
            "is_active FROM ai.engines"
        )
    assert {row["code"]: tuple(row)[1:] for row in rows} == {
        engine.code.value: (
            engine.label,
            engine.observation_class.value,
            engine.vendor,
            engine.exposes_citations,
            engine.exposes_fanout,
            True,
        )
        for engine in ENGINES.values()
    }


async def test_each_engine_has_a_task_price_on_both_queues(migrated: PostgresServer) -> None:
    endpoints = [engine.endpoint for engine in ENGINES.values()]
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT endpoint, price_unit, unit_price_usd, conditions->>'queue' AS queue "
            "FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
            "AND endpoint = ANY($1)",
            endpoints,
        )
    assert {(row["endpoint"], row["queue"]): (row["price_unit"], row["unit_price_usd"]) for row in rows} == {
        (endpoint, queue): ("task", price)
        for endpoint in endpoints
        for queue, price in (("standard", Decimal("0.0012")), ("priority", Decimal("0.0024")))
    }


async def test_a_new_workspace_gets_the_base_plans_prompt_limit(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        workspace = await db.fetchval(
            "INSERT INTO auth.workspaces (name, slug) VALUES ('q', $1) RETURNING id",
            f"q-{uuid.uuid4().hex[:8]}",
        )
        await db.execute("INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", workspace)
        limit = await db.fetchval(
            "SELECT max_active_prompts FROM core.workspace_quotas WHERE workspace_id = $1",
            workspace,
        )
    assert limit == BASE_PLAN.max_prompts == 150


def test_quotas_at_the_old_default_move_to_the_base_plan(pg: PostgresServer) -> None:
    """A quota still at the old default of 1,000 becomes 150; one a person set stays."""
    name = f"ai_{uuid.uuid4().hex[:8]}"
    asyncio.run(pg.create_database(name))
    url = pg.url("migrator", name)
    config = alembic_config(url)
    command.upgrade(config, "0017")

    async def seed() -> dict[uuid.UUID, int]:
        db = await asyncpg.connect(url)
        try:
            limits: dict[uuid.UUID, int] = {}
            for label, limit in (("old", 1000), ("set", 500)):
                workspace: uuid.UUID = await db.fetchval(
                    "INSERT INTO auth.workspaces (name, slug) VALUES ($1, $1) RETURNING id",
                    label,
                )
                await db.execute(
                    "INSERT INTO core.workspace_quotas (workspace_id, max_active_prompts) "
                    "VALUES ($1, $2)",
                    workspace,
                    limit,
                )
                limits[workspace] = limit
            return limits
        finally:
            await db.close()

    before = asyncio.run(seed())
    command.upgrade(config, "0018")

    async def read() -> dict[uuid.UUID, int]:
        db = await asyncpg.connect(url)
        try:
            rows = await db.fetch("SELECT workspace_id, max_active_prompts FROM core.workspace_quotas")
            return {row["workspace_id"]: row["max_active_prompts"] for row in rows}
        finally:
            await db.close()

    old, kept = before
    assert asyncio.run(read()) == {old: 150, kept: 500}


async def test_a_prompts_current_version_is_one_of_its_own(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        prompt_id, _ = await insert_prompt(db, alpha.workspace_id, alpha.project_id, "first?")
        _, other_version = await insert_prompt(db, alpha.workspace_id, alpha.project_id, "second?")
        # The key is checked at commit; this transaction never commits, so check it now.
        await db.execute("SET CONSTRAINTS ALL IMMEDIATE")

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "UPDATE ai.prompts SET current_version_id = $1 WHERE id = $2",
                other_version,
                prompt_id,
            )


async def test_a_prompt_names_a_term_of_its_own_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        prompt_id = await db.fetchval(
            "SELECT id FROM ai.prompts WHERE workspace_id = $1 LIMIT 1", alpha.workspace_id
        )
        foreign_term = await db.fetchval(
            "SELECT id FROM core.taxonomy_terms WHERE workspace_id = $1 LIMIT 1",
            beta.workspace_id,
        )

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) "
                "VALUES ($1, $2, $3)",
                prompt_id,
                foreign_term,
                alpha.workspace_id,
            )


async def test_what_was_found_in_an_answer_stays_in_its_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        answer = await db.fetchrow(
            "SELECT id, observed_at FROM ai.observations WHERE workspace_id = $1",
            alpha.workspace_id,
        )
        assert answer is not None
        foreign_derivation = await db.fetchval(
            "SELECT id FROM ai.derivations WHERE workspace_id = $1", beta.workspace_id
        )
        url = await db.fetchrow("SELECT id, domain_id FROM core.urls ORDER BY id LIMIT 1")
        assert url is not None

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ai.citations (observation_id, observed_at, citation_index, "
                "workspace_id, project_id, engine_code, url_id, domain_id, raw_url, "
                "citation_kind, domain_role) VALUES ($1, $2, 9, $3, $4, 'chatgpt_web', $5, $6, "
                "'https://example.com/', 'source_list', 'third_party')",
                answer["id"],
                answer["observed_at"],
                beta.workspace_id,
                beta.project_id,
                url["id"],
                url["domain_id"],
            )
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, "
                "derivation_id, workspace_id, project_id, engine_code, role, mention_count, "
                "first_char_offset, mention_order, prominence, match_method, confidence, "
                "evidence_spans) VALUES ($1, $2, $3, $4, $5, $6, 'chatgpt_web', 'competitor', 1, "
                "0, 2, 1, 'alias_word', 1, ARRAY['[0,4)'::int4range])",
                answer["id"],
                answer["observed_at"],
                uuid.uuid4(),
                foreign_derivation,
                alpha.workspace_id,
                alpha.project_id,
            )


async def test_a_task_has_one_answer_however_often_it_is_ingested(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    observed = datetime.now(UTC)
    async with scoped(migrated, "superuser") as db:
        await _answer(db, alpha, observed_at=observed, task_id=4242)

        async with refused(db, asyncpg.UniqueViolationError):
            await _answer(db, alpha, observed_at=observed, task_id=4242)


async def test_an_answer_outside_the_partitions_is_refused(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        async with refused(db, asyncpg.CheckViolationError, match="partition"):
            await _answer(db, alpha, observed_at=datetime.now(UTC) - timedelta(days=900))


async def test_the_raw_payload_of_an_answer_is_read_through_its_own_workspace_only(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        own = await db.fetchval(
            "SELECT id FROM ai.observations WHERE workspace_id = $1", alpha.workspace_id
        )
        key = await db.fetchval(
            "SELECT r.object_key FROM ai.observations o "
            "JOIN ops.raw_payloads r ON r.id = o.raw_payload_id WHERE o.id = $1",
            own,
        )
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        found = await db.fetch(
            "SELECT object_key, retention_class FROM ai.observation_raw($1)", own
        )
    async with scoped(migrated, "app_api", workspace_id=beta.workspace_id) as db:
        other = await db.fetch("SELECT * FROM ai.observation_raw($1)", own)

    assert [(row["object_key"], row["retention_class"]) for row in found] == [(key, "ai_raw")]
    assert other == []
```

Note on `test_quotas_at_the_old_default_move_to_the_base_plan`: `before` is a dict in insertion order, so `old, kept = before` unpacks its two keys.

- [ ] **Step 2: Run it to see it fail**

Run: `uv run pytest --no-cov tests/db/test_ai_schema.py -q`
Expected: errors such as `ImportError: cannot import name 'insert_prompt' from 'tests.db.support'`.

- [ ] **Step 3: Write the migration**

`backend/src/idraft/db/migrations/versions/0018_ai_prompts.py`:

```python
"""AI prompt tracking, slice 1: engines, project engines, prompts with versions and terms,
answers with their citations, and what extraction finds in them.

Table definitions follow docs/04-data-model.md sections 8.1 to 8.5 (panels, fan-out, retrieval
results and claims wait for their slices), with these choices (plan
`docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md`):

- Every tenant table carries `workspace_id`, `ai.derivations` and `ai.prompt_terms` included
  (doc 04 has none on them), and keys between tenant tables include it (decision A1). A
  prompt's current version is one of its own versions, checked at commit, so a prompt and its
  first version are written in one transaction in either order.
- The answer tables are partitioned by month on `observed_at`, which is part of every key that
  names an answer. One answer per task: `(collection_task_id, observed_at)` is unique, so ingest
  can run twice. Answers keep their raw payload by key. Entities and URLs carry no key: they
  are historical facts.
- The API keeps prompts and engines; the worker writes answers and what it found in them,
  append-only. The worker reads entity aliases from now on: extraction matches them.
- The raw payload of an answer is read through a definer function, because `ops.raw_payloads`
  has no workspace (review log F8), as for SERP snapshots.
- The engines and their task prices are seeded (docs/07 sections 1 and 7.1; billed at these
  prices in spike S-04 on 2026-11-11).
- The base plan (owner, 2026-11-11) allows 150 active prompts: the quota default becomes 150,
  and quotas still at the old default of 1,000 move to it (decision A3).

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from alembic import op
from sqlalchemy import text

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE ai.engines (
    code                text PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 100),
    label               text NOT NULL,
    observation_class   text NOT NULL
                        CHECK (observation_class IN ('consumer_ui','official_api','serp_ai')),
    vendor              text NOT NULL,
    exposes_citations   boolean NOT NULL,
    exposes_fanout      boolean NOT NULL,
    is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE ai.project_engines (
    project_id      uuid NOT NULL,
    engine_code     text NOT NULL REFERENCES ai.engines(code),
    workspace_id    uuid NOT NULL,
    location_ids    integer[] NOT NULL CHECK (cardinality(location_ids) BETWEEN 1 AND 50),
    replicates      smallint NOT NULL DEFAULT 1 CHECK (replicates BETWEEN 1 AND 20),
    provider_code   text NOT NULL REFERENCES ops.providers(code),
    provider_params jsonb NOT NULL DEFAULT '{}',
    is_enabled      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (project_id, engine_code),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE ai.prompts (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id       uuid NOT NULL,
    project_id         uuid NOT NULL,
    current_version_id uuid,
    language_code      text NOT NULL CHECK (language_code ~ '^[a-z]{2}$'),
    country_iso        char(2) CHECK (country_iso ~ '^[A-Z]{2}$'),
    intent             text NOT NULL DEFAULT 'unknown'
                       CHECK (intent IN ('informational','navigational','commercial',
                                         'transactional','local','unknown')),
    funnel_stage       text NOT NULL DEFAULT 'unknown'
                       CHECK (funnel_stage IN ('tofu','mofu','bofu','retention','unknown')),
    is_branded         boolean NOT NULL DEFAULT false,
    prompt_type        text NOT NULL DEFAULT 'question'
                       CHECK (prompt_type IN ('question','comparison','recommendation','how_to',
                                              'definition','local','transactional','other')),
    importance         smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    expected_frequency text NOT NULL DEFAULT 'weekly'
                       CHECK (expected_frequency IN ('daily','weekly','monthly')),
    source             text NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','csv_import','api','seo_keyword','gsc_query',
                                         'bing_query','paa','autocomplete','related_search',
                                         'competitor_keyword','site_crawl','faq',
                                         'support_ticket','fanout','llm_variant','llm_mentions',
                                         'ai_demand_estimate')),
    creation_method    text NOT NULL DEFAULT 'human'
                       CHECK (creation_method IN ('human','template','llm_generated','imported')),
    persona_term_id    uuid,
    is_active          boolean NOT NULL DEFAULT true,
    created_by         uuid REFERENCES auth.users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT prompts_id_workspace_id_key UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (persona_term_id, workspace_id)
        REFERENCES core.taxonomy_terms(id, workspace_id)
);

CREATE INDEX prompts_live_project ON ai.prompts (project_id) WHERE deleted_at IS NULL;

-- The workspace's active prompts: what the quota counts.
CREATE INDEX prompts_active_workspace ON ai.prompts (workspace_id)
    WHERE is_active AND deleted_at IS NULL;

-- At most 2,000 characters: the longest prompt any engine takes (doc 07 section 3.1).
CREATE TABLE ai.prompt_versions (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id     uuid NOT NULL,
    prompt_id        uuid NOT NULL,
    version_no       integer NOT NULL CHECK (version_no >= 1),
    text             text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    text_hash        bytea NOT NULL CHECK (length(text_hash) = 32),
    context_preamble text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid REFERENCES auth.users(id),
    change_kind      text NOT NULL CHECK (change_kind IN ('initial','wording','typo','context')),
    change_reason    text,
    CONSTRAINT prompt_versions_prompt_id_version_no_key UNIQUE (prompt_id, version_no),
    CONSTRAINT prompt_versions_prompt_id_text_hash_key UNIQUE (prompt_id, text_hash),
    CONSTRAINT prompt_versions_id_workspace_id_key UNIQUE (id, workspace_id),
    CONSTRAINT prompt_versions_id_prompt_id_workspace_id_key UNIQUE (id, prompt_id, workspace_id),
    FOREIGN KEY (prompt_id, workspace_id) REFERENCES ai.prompts(id, workspace_id)
        ON DELETE CASCADE
);

ALTER TABLE ai.prompts ADD CONSTRAINT prompts_current_version_fk
    FOREIGN KEY (current_version_id, id, workspace_id)
    REFERENCES ai.prompt_versions(id, prompt_id, workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX prompt_versions_text_trgm ON ai.prompt_versions USING gin (text gin_trgm_ops);

-- A prompt's duplicate check: the same text in the workspace (plan decision A2).
CREATE INDEX prompt_versions_workspace_hash ON ai.prompt_versions (workspace_id, text_hash);

CREATE TABLE ai.prompt_terms (
    prompt_id    uuid NOT NULL,
    term_id      uuid NOT NULL,
    workspace_id uuid NOT NULL,
    assigned_by  text NOT NULL DEFAULT 'manual'
                 CHECK (assigned_by IN ('manual','import','rule','ai_suggestion')),
    PRIMARY KEY (prompt_id, term_id),
    FOREIGN KEY (prompt_id, workspace_id) REFERENCES ai.prompts(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (term_id, workspace_id) REFERENCES core.taxonomy_terms(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX prompt_terms_term_id ON ai.prompt_terms (term_id);

CREATE TABLE ai.observations (
    id                    bigint GENERATED ALWAYS AS IDENTITY,
    observed_at           timestamptz NOT NULL,
    observed_date         date NOT NULL,
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    engine_code           text NOT NULL REFERENCES ai.engines(code),
    observation_class     text NOT NULL
                          CHECK (observation_class IN ('consumer_ui','official_api','serp_ai')),
    prompt_id             uuid,
    prompt_version_id     uuid,
    serp_snapshot_id      bigint,
    serp_observed_at      timestamptz,
    tracked_keyword_id    uuid,
    query_text            text NOT NULL,
    collection_run_id     uuid,
    collection_task_id    bigint,
    replicate_index       smallint NOT NULL DEFAULT 1 CHECK (replicate_index BETWEEN 1 AND 20),
    location_id           integer,
    language_code         text,
    device                text,
    provider_code         text NOT NULL,
    provider_endpoint     text NOT NULL,
    provider_task_id      text,
    model_reported        text,
    model_requested       text,
    status                text NOT NULL
                          CHECK (status IN ('complete','partial','empty','refused','error')),
    answer_text           text,
    answer_markdown       text,
    answer_html_available boolean NOT NULL DEFAULT false,
    answer_char_count     integer,
    answer_hash           bytea,
    has_citations         boolean NOT NULL,
    citation_count        smallint NOT NULL DEFAULT 0,
    fanout_count          smallint NOT NULL DEFAULT 0,
    raw_payload_id        bigint NOT NULL REFERENCES ops.raw_payloads(id),
    adapter_version       smallint NOT NULL,
    normalizer_version    smallint NOT NULL,
    canonicalizer_version smallint NOT NULL,
    latency_ms            integer,
    cost_usd              numeric(14,6),
    retry_count           smallint NOT NULL DEFAULT 0,
    error_code            text,
    served_from_cache     boolean NOT NULL DEFAULT false,
    provider_extras       jsonb CHECK (provider_extras IS NULL
                                       OR octet_length(provider_extras::text) <= 16384),
    superseded_by         bigint,
    PRIMARY KEY (id, observed_at),
    CONSTRAINT observations_id_observed_at_workspace_id_key UNIQUE (id, observed_at, workspace_id),
    CONSTRAINT observations_one_per_task UNIQUE (collection_task_id, observed_at),
    CONSTRAINT subject_exactly_one CHECK (
        (prompt_version_id IS NOT NULL AND serp_snapshot_id IS NULL)
     OR (prompt_version_id IS NULL AND serp_snapshot_id IS NOT NULL)
     OR (prompt_version_id IS NULL AND serp_snapshot_id IS NULL AND tracked_keyword_id IS NOT NULL)
    )
) PARTITION BY RANGE (observed_at);

CREATE INDEX observations_project_engine_date
    ON ai.observations (project_id, engine_code, observed_date);

CREATE INDEX observations_prompt_engine_observed
    ON ai.observations (prompt_id, engine_code, observed_at DESC) WHERE prompt_id IS NOT NULL;

CREATE INDEX observations_keyword_engine_observed
    ON ai.observations (tracked_keyword_id, engine_code, observed_at DESC)
    WHERE tracked_keyword_id IS NOT NULL;

CREATE INDEX observations_serp_snapshot
    ON ai.observations (serp_snapshot_id) WHERE serp_snapshot_id IS NOT NULL;

CREATE INDEX observations_observed_brin ON ai.observations USING brin (observed_at);

CREATE TABLE ai.citations (
    observation_id      bigint NOT NULL,
    observed_at         timestamptz NOT NULL,
    citation_index      smallint NOT NULL CHECK (citation_index >= 1),
    workspace_id        uuid NOT NULL,
    project_id          uuid NOT NULL,
    engine_code         text NOT NULL,
    url_id              bigint NOT NULL,
    domain_id           integer NOT NULL,
    raw_url             text NOT NULL,
    title               text,
    source_name         text,
    citation_kind       text NOT NULL
                        CHECK (citation_kind IN ('inline','source_list','search_result',
                                                 'reference_card','product_card','footnote')),
    first_char_offset   integer,
    answer_block_index  smallint,
    occurrences         smallint NOT NULL DEFAULT 1,
    domain_role         text NOT NULL CHECK (domain_role IN ('own','competitor','third_party')),
    role_entity_id      uuid,
    referral_tag        text,
    flags               text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (observation_id, observed_at, citation_index),
    FOREIGN KEY (observation_id, observed_at, workspace_id)
        REFERENCES ai.observations (id, observed_at, workspace_id) ON DELETE CASCADE
) PARTITION BY RANGE (observed_at);

CREATE INDEX citations_project_domain_observed ON ai.citations (project_id, domain_id, observed_at);

CREATE INDEX citations_url_observed ON ai.citations (url_id, observed_at);

CREATE TABLE ai.derivations (
    id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id           uuid NOT NULL,
    project_id             uuid NOT NULL,
    extractor_version      smallint NOT NULL,
    entity_config_version  integer NOT NULL,
    recommendation_version smallint NOT NULL,
    sentiment_version      smallint NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT derivations_identity UNIQUE (project_id, extractor_version, entity_config_version,
                                            recommendation_version, sentiment_version),
    CONSTRAINT derivations_id_workspace_id_key UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE ai.entity_mentions (
    observation_id        bigint NOT NULL,
    observed_at           timestamptz NOT NULL,
    entity_id             uuid NOT NULL,
    derivation_id         integer NOT NULL,
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    engine_code           text NOT NULL,
    role                  text NOT NULL CHECK (role IN ('own','competitor','watch','untracked')),
    mention_count         smallint NOT NULL,
    first_char_offset     integer NOT NULL,
    mention_order         smallint NOT NULL,
    prominence            numeric(5,4) NOT NULL,
    structured_rank       smallint,
    structured_list_size  smallint,
    is_recommended        boolean,
    recommendation_method text,
    sentiment             text CHECK (sentiment IN ('positive','neutral','negative','mixed')),
    sentiment_method      text,
    match_method          text NOT NULL,
    mention_status        text NOT NULL DEFAULT 'accepted'
                          CHECK (mention_status IN ('accepted','uncertain')),
    structured_list_index smallint,
    confidence            numeric(4,3) NOT NULL,
    evidence_spans        int4range[] NOT NULL,
    is_current            boolean NOT NULL DEFAULT true,
    PRIMARY KEY (observation_id, observed_at, entity_id, derivation_id),
    FOREIGN KEY (observation_id, observed_at, workspace_id)
        REFERENCES ai.observations (id, observed_at, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (derivation_id, workspace_id) REFERENCES ai.derivations (id, workspace_id)
) PARTITION BY RANGE (observed_at);

CREATE INDEX entity_mentions_project_entity_observed
    ON ai.entity_mentions (project_id, entity_id, observed_at) WHERE is_current;

CREATE TABLE ai.observation_facts (
    observation_id             bigint NOT NULL,
    observed_at                timestamptz NOT NULL,
    derivation_id              integer NOT NULL,
    workspace_id               uuid NOT NULL,
    project_id                 uuid NOT NULL,
    observed_date              date NOT NULL,
    engine_code                text NOT NULL,
    observation_class          text NOT NULL,
    prompt_id                  uuid,
    prompt_version_id          uuid,
    tracked_keyword_id         uuid,
    replicate_index            smallint NOT NULL,
    location_id                integer,
    is_valid                   boolean NOT NULL,
    own_mentioned              boolean NOT NULL,
    own_domain_cited           boolean NOT NULL,
    own_recommended            boolean,
    own_structured_rank        smallint,
    own_prominence             numeric(5,4),
    own_mention_order          smallint,
    own_sentiment              text,
    own_citation_count         smallint NOT NULL,
    total_citation_count       smallint NOT NULL,
    tracked_entities_mentioned smallint NOT NULL,
    competitor_mentions        uuid[] NOT NULL DEFAULT '{}',
    competitor_cited           uuid[] NOT NULL DEFAULT '{}',
    had_structured_list        boolean NOT NULL,
    is_current                 boolean NOT NULL DEFAULT true,
    computed_at                timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (observation_id, observed_at, derivation_id),
    FOREIGN KEY (observation_id, observed_at, workspace_id)
        REFERENCES ai.observations (id, observed_at, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (derivation_id, workspace_id) REFERENCES ai.derivations (id, workspace_id)
) PARTITION BY RANGE (observed_at);

CREATE INDEX observation_facts_project_date_engine
    ON ai.observation_facts (project_id, observed_date, engine_code) WHERE is_current;

CREATE INDEX observation_facts_prompt_engine_observed
    ON ai.observation_facts (prompt_id, engine_code, observed_at) WHERE is_current;

INSERT INTO ops.partitioned_tables (parent)
VALUES ('ai.observations'), ('ai.citations'), ('ai.entity_mentions'), ('ai.observation_facts');

SELECT ops.maintain_partitions();
"""

# The raw payload of an answer of the current workspace, and nothing else of the table.
_RAW_LOOKUP = """
CREATE FUNCTION ai.observation_raw(p_observation_id bigint)
RETURNS TABLE (
    storage text, object_key text, inline_body bytea, sha256 bytea, bytes_raw integer,
    bytes_stored integer, compression text, content_type text, fetched_at timestamptz,
    retention_class text, expires_at timestamptz)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        SELECT r.storage, r.object_key, r.inline_body, r.sha256, r.bytes_raw, r.bytes_stored,
               r.compression, r.content_type, r.fetched_at, r.retention_class, r.expires_at
        FROM ai.observations o
        JOIN ops.raw_payloads r ON r.id = o.raw_payload_id
        WHERE o.id = p_observation_id AND o.workspace_id = auth.current_workspace_id();
    END;

REVOKE ALL ON FUNCTION ai.observation_raw(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ai.observation_raw(bigint) TO app_api;
"""

_TENANT_TABLES = (
    "ai.project_engines",
    "ai.prompts",
    "ai.prompt_versions",
    "ai.prompt_terms",
    "ai.derivations",
    "ai.observations",
    "ai.citations",
    "ai.entity_mentions",
    "ai.observation_facts",
)
# Written by the worker only, and never changed.
_ANSWER_TABLES = (
    "ai.derivations",
    "ai.observations",
    "ai.citations",
    "ai.entity_mentions",
    "ai.observation_facts",
)
_PARTITIONED = ("ai.observations", "ai.citations", "ai.entity_mentions", "ai.observation_facts")
# What a prompt change may touch; its text, language, country and project never change.
_PROMPT_API_UPDATE = (
    "intent",
    "funnel_stage",
    "is_branded",
    "prompt_type",
    "importance",
    "is_active",
    "updated_at",
)

# code, label, observation class, vendor, exposes citations, exposes fan-out (docs/07 sections
# 1 and 2). The domain module `idraft.domain.ai_engines` holds the same values.
_ENGINES = (
    ("chatgpt_web", "ChatGPT", "consumer_ui", "openai", True, True),
    ("gemini_web", "Gemini", "consumer_ui", "google", True, False),
    ("google_ai_mode", "Google AI Mode", "serp_ai", "google", True, False),
)
_AI_ENDPOINTS = (
    "ai_optimization/chat_gpt/llm_scraper",
    "ai_optimization/gemini/llm_scraper",
    "serp/google/ai_mode",
)
# docs/07 section 7.1: per task, the same on the three endpoints.
_AI_PRICES = (
    (Decimal("0.0012"), '{"queue": "standard"}'),
    (Decimal("0.0024"), '{"queue": "priority"}'),
)
_AI_PRICING_URL = "https://dataforseo.com/pricing"
# The base plan's active prompt limit (`idraft.domain.ai_engines.BASE_PLAN`), and the default
# it replaces. A revision is frozen history, so it states the number rather than importing it.
_PROMPT_LIMIT = 150
_OLD_PROMPT_LIMIT = 1000


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    bind = op.get_bind()
    for code, label, observation_class, vendor, citations, fanout in _ENGINES:
        bind.execute(
            text(
                "INSERT INTO ai.engines (code, label, observation_class, vendor, "
                "exposes_citations, exposes_fanout) VALUES (:code, :label, :observation_class, "
                ":vendor, :citations, :fanout)"
            ),
            {
                "code": code,
                "label": label,
                "observation_class": observation_class,
                "vendor": vendor,
                "citations": citations,
                "fanout": fanout,
            },
        )
    seed = text(
        "INSERT INTO ops.provider_price_book (provider_code, endpoint, price_unit, "
        "unit_price_usd, conditions, valid_from, source_url, verified_at) "
        "VALUES ('dataforseo', :endpoint, 'task', :price, CAST(:conditions AS jsonb), "
        ":valid_from, :url, :verified)"
    )
    for endpoint in _AI_ENDPOINTS:
        for price, conditions in _AI_PRICES:
            bind.execute(
                seed,
                {
                    "endpoint": endpoint,
                    "price": price,
                    "conditions": conditions,
                    "valid_from": date(2026, 7, 1),
                    "url": _AI_PRICING_URL,
                    "verified": date(2026, 11, 11),
                },
            )
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("ai.engines", api="SELECT", worker="SELECT"),
        *grants("ai.project_engines", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "ai.project_engines",
            role="app_api",
            privilege="UPDATE",
            columns=("location_ids", "is_enabled"),
        ),
        *grants("ai.prompts", api="SELECT, INSERT", worker="SELECT"),
        column_grant("ai.prompts", role="app_api", privilege="UPDATE", columns=_PROMPT_API_UPDATE),
        *grants("ai.prompt_versions", api="SELECT, INSERT", worker="SELECT"),
        *grants("ai.prompt_terms", api="SELECT, INSERT, DELETE"),
        *(
            statement
            for table in _ANSWER_TABLES
            for statement in grants(table, api="SELECT", worker="SELECT, INSERT")
        ),
        # Extraction at ingest matches the project's aliases (spec section 4.4).
        *grants("core.entity_aliases", worker="SELECT"),
    ]
    for statement in script:
        op.execute(statement)
    for statement in statements(_RAW_LOOKUP):
        op.execute(statement)
    op.execute(
        "ALTER TABLE core.workspace_quotas "
        f"ALTER COLUMN max_active_prompts SET DEFAULT {_PROMPT_LIMIT}"
    )
    op.execute(
        f"UPDATE core.workspace_quotas SET max_active_prompts = {_PROMPT_LIMIT}, "
        f"updated_at = now() WHERE max_active_prompts = {_OLD_PROMPT_LIMIT}"
    )


def downgrade() -> None:
    # Local development only.
    op.execute(
        f"UPDATE core.workspace_quotas SET max_active_prompts = {_OLD_PROMPT_LIMIT} "
        f"WHERE max_active_prompts = {_PROMPT_LIMIT}"
    )
    op.execute(
        "ALTER TABLE core.workspace_quotas "
        f"ALTER COLUMN max_active_prompts SET DEFAULT {_OLD_PROMPT_LIMIT}"
    )
    op.execute("DROP FUNCTION ai.observation_raw(bigint)")
    op.execute("REVOKE SELECT ON core.entity_aliases FROM app_worker")
    parents = ", ".join(f"'{table}'::regclass" for table in _PARTITIONED)
    op.execute(f"DELETE FROM ops.partitioned_tables WHERE parent IN ({parents})")
    op.execute(
        "DROP TABLE ai.observation_facts, ai.entity_mentions, ai.citations, ai.observations, "
        "ai.derivations, ai.prompt_terms, ai.prompt_versions, ai.prompts, ai.project_engines, "
        "ai.engines"
    )
    endpoints = ", ".join(f"'{endpoint}'" for endpoint in _AI_ENDPOINTS)
    op.execute(
        "DELETE FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
        f"AND endpoint IN ({endpoints})"
    )
```

`statements()` splits at blank lines, so no statement above contains an empty line; comment-only chunks are dropped by it.

- [ ] **Step 4: Declare the tables**

In `backend/src/idraft/db/tables.py`, change the dialect import to:

```python
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT, INET, INT4RANGE, JSONB
```

and add at the end of the file:

```python
# AI prompt tracking (migration 0018; docs/04-data-model.md section 8). The answer tables are
# partitioned by month on `observed_at`, which is part of every key that names an answer.
ai_engines = Table(
    "engines",
    metadata,
    Column("code", Text, primary_key=True),
    Column("label", Text, nullable=False),
    Column("observation_class", Text, nullable=False),
    Column("vendor", Text, nullable=False),
    Column("exposes_citations", Boolean, nullable=False),
    Column("exposes_fanout", Boolean, nullable=False),
    Column("is_active", Boolean, nullable=False, server_default=FetchedValue()),
    schema="ai",
)

ai_project_engines = Table(
    "project_engines",
    metadata,
    Column("project_id", Uuid, primary_key=True),
    Column("engine_code", Text, ForeignKey(ai_engines.c.code), primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("location_ids", ARRAY(Integer), nullable=False),
    Column("replicates", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("provider_code", Text, ForeignKey(providers.c.code), nullable=False),
    Column("provider_params", JSONB, nullable=False, server_default=FetchedValue()),
    Column("is_enabled", Boolean, nullable=False, server_default=FetchedValue()),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="ai",
)

ai_prompts = Table(
    "prompts",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("current_version_id", Uuid),
    Column("language_code", Text, nullable=False),
    Column("country_iso", CHAR(2)),
    Column("intent", Text, nullable=False, server_default=FetchedValue()),
    Column("funnel_stage", Text, nullable=False, server_default=FetchedValue()),
    Column("is_branded", Boolean, nullable=False, server_default=FetchedValue()),
    Column("prompt_type", Text, nullable=False, server_default=FetchedValue()),
    Column("importance", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("expected_frequency", Text, nullable=False, server_default=FetchedValue()),
    Column("source", Text, nullable=False, server_default=FetchedValue()),
    Column("creation_method", Text, nullable=False, server_default=FetchedValue()),
    Column("persona_term_id", Uuid),
    Column("is_active", Boolean, nullable=False, server_default=FetchedValue()),
    Column("created_by", Uuid, ForeignKey(users.c.id)),
    _created_at(),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    Column("deleted_at", DateTime(timezone=True)),
    UniqueConstraint("id", "workspace_id", name="prompts_id_workspace_id_key"),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["persona_term_id", "workspace_id"], [taxonomy_terms.c.id, taxonomy_terms.c.workspace_id]
    ),
    # Checked at commit: a prompt and its first version are written in one transaction.
    ForeignKeyConstraint(
        ["current_version_id", "id", "workspace_id"],
        [
            "ai.prompt_versions.id",
            "ai.prompt_versions.prompt_id",
            "ai.prompt_versions.workspace_id",
        ],
        name="prompts_current_version_fk",
        use_alter=True,
        deferrable=True,
        initially="DEFERRED",
    ),
    schema="ai",
)

ai_prompt_versions = Table(
    "prompt_versions",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("prompt_id", Uuid, nullable=False),
    Column("version_no", Integer, nullable=False),
    Column("text", Text, nullable=False),
    Column("text_hash", LargeBinary, nullable=False),
    Column("context_preamble", Text),
    _created_at(),
    Column("created_by", Uuid, ForeignKey(users.c.id)),
    Column("change_kind", Text, nullable=False),
    Column("change_reason", Text),
    UniqueConstraint("prompt_id", "version_no", name="prompt_versions_prompt_id_version_no_key"),
    UniqueConstraint("prompt_id", "text_hash", name="prompt_versions_prompt_id_text_hash_key"),
    UniqueConstraint("id", "workspace_id", name="prompt_versions_id_workspace_id_key"),
    UniqueConstraint(
        "id", "prompt_id", "workspace_id", name="prompt_versions_id_prompt_id_workspace_id_key"
    ),
    ForeignKeyConstraint(
        ["prompt_id", "workspace_id"],
        [ai_prompts.c.id, ai_prompts.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="ai",
)

ai_prompt_terms = Table(
    "prompt_terms",
    metadata,
    Column("prompt_id", Uuid, primary_key=True),
    Column("term_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("assigned_by", Text, nullable=False, server_default=FetchedValue()),
    ForeignKeyConstraint(
        ["prompt_id", "workspace_id"],
        [ai_prompts.c.id, ai_prompts.c.workspace_id],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["term_id", "workspace_id"],
        [taxonomy_terms.c.id, taxonomy_terms.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="ai",
)

ai_observations = Table(
    "observations",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("observed_date", Date, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("engine_code", Text, ForeignKey(ai_engines.c.code), nullable=False),
    Column("observation_class", Text, nullable=False),
    Column("prompt_id", Uuid),
    Column("prompt_version_id", Uuid),
    Column("serp_snapshot_id", BigInteger),
    Column("serp_observed_at", DateTime(timezone=True)),
    Column("tracked_keyword_id", Uuid),
    Column("query_text", Text, nullable=False),
    Column("collection_run_id", Uuid),
    Column("collection_task_id", BigInteger),
    Column("replicate_index", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("location_id", Integer),
    Column("language_code", Text),
    Column("device", Text),
    Column("provider_code", Text, nullable=False),
    Column("provider_endpoint", Text, nullable=False),
    Column("provider_task_id", Text),
    Column("model_reported", Text),
    Column("model_requested", Text),
    Column("status", Text, nullable=False),
    Column("answer_text", Text),
    Column("answer_markdown", Text),
    Column("answer_html_available", Boolean, nullable=False, server_default=FetchedValue()),
    Column("answer_char_count", Integer),
    Column("answer_hash", LargeBinary),
    Column("has_citations", Boolean, nullable=False),
    Column("citation_count", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("fanout_count", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("raw_payload_id", BigInteger, ForeignKey(raw_payloads.c.id), nullable=False),
    Column("adapter_version", SmallInteger, nullable=False),
    Column("normalizer_version", SmallInteger, nullable=False),
    Column("canonicalizer_version", SmallInteger, nullable=False),
    Column("latency_ms", Integer),
    Column("cost_usd", Numeric(14, 6)),
    Column("retry_count", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("error_code", Text),
    Column("served_from_cache", Boolean, nullable=False, server_default=FetchedValue()),
    Column("provider_extras", JSONB),
    Column("superseded_by", BigInteger),
    UniqueConstraint(
        "id", "observed_at", "workspace_id", name="observations_id_observed_at_workspace_id_key"
    ),
    UniqueConstraint("collection_task_id", "observed_at", name="observations_one_per_task"),
    schema="ai",
)


def _answer_key() -> ForeignKeyConstraint:
    """The answer a row of a child table belongs to, in the row's own workspace."""
    return ForeignKeyConstraint(
        ["observation_id", "observed_at", "workspace_id"],
        [ai_observations.c.id, ai_observations.c.observed_at, ai_observations.c.workspace_id],
        ondelete="CASCADE",
    )


ai_citations = Table(
    "citations",
    metadata,
    Column("observation_id", BigInteger, primary_key=True),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("citation_index", SmallInteger, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("engine_code", Text, nullable=False),
    Column("url_id", BigInteger, nullable=False),
    Column("domain_id", Integer, nullable=False),
    Column("raw_url", Text, nullable=False),
    Column("title", Text),
    Column("source_name", Text),
    Column("citation_kind", Text, nullable=False),
    Column("first_char_offset", Integer),
    Column("answer_block_index", SmallInteger),
    Column("occurrences", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("domain_role", Text, nullable=False),
    Column("role_entity_id", Uuid),
    Column("referral_tag", Text),
    Column("flags", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    _answer_key(),
    schema="ai",
)

ai_derivations = Table(
    "derivations",
    metadata,
    Column("id", Integer, primary_key=True, server_default=FetchedValue()),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("extractor_version", SmallInteger, nullable=False),
    Column("entity_config_version", Integer, nullable=False),
    Column("recommendation_version", SmallInteger, nullable=False),
    Column("sentiment_version", SmallInteger, nullable=False),
    _created_at(),
    UniqueConstraint(
        "project_id",
        "extractor_version",
        "entity_config_version",
        "recommendation_version",
        "sentiment_version",
        name="derivations_identity",
    ),
    UniqueConstraint("id", "workspace_id", name="derivations_id_workspace_id_key"),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="ai",
)

ai_entity_mentions = Table(
    "entity_mentions",
    metadata,
    Column("observation_id", BigInteger, primary_key=True),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("entity_id", Uuid, primary_key=True),
    Column("derivation_id", Integer, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("engine_code", Text, nullable=False),
    Column("role", Text, nullable=False),
    Column("mention_count", SmallInteger, nullable=False),
    Column("first_char_offset", Integer, nullable=False),
    Column("mention_order", SmallInteger, nullable=False),
    Column("prominence", Numeric(5, 4), nullable=False),
    Column("structured_rank", SmallInteger),
    Column("structured_list_size", SmallInteger),
    Column("is_recommended", Boolean),
    Column("recommendation_method", Text),
    Column("sentiment", Text),
    Column("sentiment_method", Text),
    Column("match_method", Text, nullable=False),
    Column("mention_status", Text, nullable=False, server_default=FetchedValue()),
    Column("structured_list_index", SmallInteger),
    Column("confidence", Numeric(4, 3), nullable=False),
    Column("evidence_spans", ARRAY(INT4RANGE), nullable=False),
    Column("is_current", Boolean, nullable=False, server_default=FetchedValue()),
    _answer_key(),
    ForeignKeyConstraint(
        ["derivation_id", "workspace_id"], [ai_derivations.c.id, ai_derivations.c.workspace_id]
    ),
    schema="ai",
)

ai_observation_facts = Table(
    "observation_facts",
    metadata,
    Column("observation_id", BigInteger, primary_key=True),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("derivation_id", Integer, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("observed_date", Date, nullable=False),
    Column("engine_code", Text, nullable=False),
    Column("observation_class", Text, nullable=False),
    Column("prompt_id", Uuid),
    Column("prompt_version_id", Uuid),
    Column("tracked_keyword_id", Uuid),
    Column("replicate_index", SmallInteger, nullable=False),
    Column("location_id", Integer),
    Column("is_valid", Boolean, nullable=False),
    Column("own_mentioned", Boolean, nullable=False),
    Column("own_domain_cited", Boolean, nullable=False),
    Column("own_recommended", Boolean),
    Column("own_structured_rank", SmallInteger),
    Column("own_prominence", Numeric(5, 4)),
    Column("own_mention_order", SmallInteger),
    Column("own_sentiment", Text),
    Column("own_citation_count", SmallInteger, nullable=False),
    Column("total_citation_count", SmallInteger, nullable=False),
    Column("tracked_entities_mentioned", SmallInteger, nullable=False),
    Column("competitor_mentions", ARRAY(Uuid), nullable=False, server_default=FetchedValue()),
    Column("competitor_cited", ARRAY(Uuid), nullable=False, server_default=FetchedValue()),
    Column("had_structured_list", Boolean, nullable=False),
    Column("is_current", Boolean, nullable=False, server_default=FetchedValue()),
    Column("computed_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    _answer_key(),
    ForeignKeyConstraint(
        ["derivation_id", "workspace_id"], [ai_derivations.c.id, ai_derivations.c.workspace_id]
    ),
    schema="ai",
)
```

If `test_the_metadata_matches_the_migrated_schema` reports a difference, fix the declaration to match the migration, never the other way round: the migration follows doc 04.

- [ ] **Step 5: Teach the test support the AI tables**

In `backend/tests/db/support.py`, add to `TENANT_TABLES` after `"fp.gsc_search_analytics": "workspace_id",`:

```python
    "ai.project_engines": "workspace_id",
    "ai.prompts": "workspace_id",
    "ai.prompt_versions": "workspace_id",
    "ai.prompt_terms": "workspace_id",
    "ai.derivations": "workspace_id",
    "ai.observations": "workspace_id",
    "ai.citations": "workspace_id",
    "ai.entity_mentions": "workspace_id",
    "ai.observation_facts": "workspace_id",
```

In `seed_tenant`, after `await seed_search_console(db, workspace_id, project_id, owner_id)`, add:

```python
        await seed_ai(db, workspace_id, project_id, owner_id, entity_id, term_id)
```

and add these two functions at the end of the module:

```python
async def insert_prompt(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    text: str,
    *,
    language_code: str = "en",
    country_iso: str = "US",
    is_active: bool = True,
    created_by: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A prompt with its first version, as the API writes one: the version's key is checked
    at commit, so both rows go in one transaction (a savepoint inside an open one). `text`
    must already be trimmed and composed: its hash is taken as given. Returns the prompt's id
    and its version's."""
    ids = await db.fetchrow("SELECT uuidv7() AS prompt_id, uuidv7() AS version_id")
    assert ids is not None
    async with db.transaction():
        await db.execute(
            "INSERT INTO ai.prompts (id, workspace_id, project_id, current_version_id, "
            "language_code, country_iso, is_active, created_by) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            ids["prompt_id"],
            workspace_id,
            project_id,
            ids["version_id"],
            language_code,
            country_iso,
            is_active,
            created_by,
        )
        await db.execute(
            "INSERT INTO ai.prompt_versions (id, workspace_id, prompt_id, version_no, text, "
            "text_hash, created_by, change_kind) "
            "VALUES ($1, $2, $3, 1, $4::text, sha256(convert_to($4::text, 'UTF8')), $5, "
            "'initial')",
            ids["version_id"],
            workspace_id,
            ids["prompt_id"],
            text,
            created_by,
        )
    prompt_id: uuid.UUID = ids["prompt_id"]
    version_id: uuid.UUID = ids["version_id"]
    return prompt_id, version_id


async def seed_ai(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    entity_id: uuid.UUID,
    term_id: uuid.UUID,
) -> None:
    """One row in every AI table: ChatGPT on in the seeded country, a prompt with its first
    version and a term, and one answer with a citation, a mention of the own brand and its
    facts under a derivation."""
    await db.execute(
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code) VALUES ($1, 'chatgpt_web', $2, ARRAY[$3::integer], 'dataforseo')",
        project_id,
        workspace_id,
        SEED_LOCATION,
    )
    prompt_id, version_id = await insert_prompt(
        db, workspace_id, project_id, "Which CRM suits a startup?", created_by=owner_id
    )
    await db.execute(
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        prompt_id,
        term_id,
        workspace_id,
    )
    derivation_id: int = await db.fetchval(
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) RETURNING id",
        workspace_id,
        project_id,
    )
    raw_payload_id: int = await db.fetchval(
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class) VALUES ('r2', $1, $2, 10, 10, 'zstd', 'application/json', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper/task_get/advanced', now(), "
        "'ai_raw') RETURNING id",
        f"ai_raw/{uuid.uuid4().hex}",
        uuid.uuid4().bytes + uuid.uuid4().bytes,
    )
    observed_at = await db.fetchval("SELECT now()")
    observation_id: int = await db.fetchval(
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, location_id, "
        "language_code, provider_code, provider_endpoint, status, answer_text, "
        "answer_char_count, has_citations, citation_count, raw_payload_id, adapter_version, "
        "normalizer_version, canonicalizer_version) VALUES ($1, current_date, $2, $3, "
        "'chatgpt_web', 'consumer_ui', $4, $5, 'Which CRM suits a startup?', $6, 'en', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', 'complete', 'Acme suits one.', "
        "15, true, 1, $7, 1, 1, 1) RETURNING id",
        observed_at,
        workspace_id,
        project_id,
        prompt_id,
        version_id,
        SEED_LOCATION,
        raw_payload_id,
    )
    url = await db.fetchrow("SELECT id, domain_id FROM core.urls ORDER BY id LIMIT 1")
    assert url is not None
    await db.execute(
        "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
        "project_id, engine_code, url_id, domain_id, raw_url, citation_kind, domain_role, "
        "role_entity_id) VALUES ($1, $2, 1, $3, $4, 'chatgpt_web', $5, $6, "
        "'https://example.com/crm', 'source_list', 'own', $7)",
        observation_id,
        observed_at,
        workspace_id,
        project_id,
        url["id"],
        url["domain_id"],
        entity_id,
    )
    await db.execute(
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, confidence, evidence_spans) "
        "VALUES ($1, $2, $3, $4, $5, $6, 'chatgpt_web', 'own', 1, 0, 1, 1, 'alias_word', 1, "
        "ARRAY['[0,4)'::int4range])",
        observation_id,
        observed_at,
        entity_id,
        derivation_id,
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, location_id, is_valid, own_mentioned, "
        "own_domain_cited, own_citation_count, total_citation_count, "
        "tracked_entities_mentioned, had_structured_list) VALUES ($1, $2, $3, $4, $5, "
        "current_date, 'chatgpt_web', 'consumer_ui', $6, $7, 1, $8, true, true, true, 1, 1, 1, "
        "false)",
        observation_id,
        observed_at,
        derivation_id,
        workspace_id,
        project_id,
        prompt_id,
        version_id,
        SEED_LOCATION,
    )
```

`insert_prompt` runs inside the caller's open transaction in `test_ai_schema.py` (`scoped`), where `db.transaction()` is a savepoint; in `seed_tenant` it opens a real transaction.

- [ ] **Step 6: Update the catalog tests**

In `backend/tests/db/test_tables.py`, add to `DECLARED` after `"seo.rank_events",`:

```python
    "ai.engines",
    "ai.project_engines",
    "ai.prompts",
    "ai.prompt_versions",
    "ai.prompt_terms",
    "ai.observations",
    "ai.citations",
    "ai.derivations",
    "ai.entity_mentions",
    "ai.observation_facts",
```

In `backend/tests/db/test_grants.py`, replace the `core.entity_aliases` line and its comment with:

```python
    # Rank ingest resolves a SERP against the entities of the project (migration 0013); AI
    # extraction matches their aliases (migration 0018).
    "core.entities": (CRUD, READ),
    "core.entity_aliases": (CRUD, READ),
```

(the `core.entities` line moves under the new comment), and add after the `"fp.gsc_search_analytics"` entry, before the closing brace of `MATRIX`:

```python
    # AI prompt tracking (migration 0018): the API keeps prompts and engines, the worker writes
    # answers and what extraction found in them and never changes them; each reads the other's.
    "ai.engines": (READ, READ),
    "ai.project_engines": (
        access("SELECT, INSERT, DELETE", UPDATE=("location_ids", "is_enabled")),
        READ,
    ),
    "ai.prompts": (
        access(
            "SELECT, INSERT",
            UPDATE=(
                "intent",
                "funnel_stage",
                "is_branded",
                "prompt_type",
                "importance",
                "is_active",
                "updated_at",
            ),
        ),
        READ,
    ),
    "ai.prompt_versions": (access("SELECT, INSERT"), READ),
    "ai.prompt_terms": (access("SELECT, INSERT, DELETE"), NONE),
    "ai.derivations": (READ, access("SELECT, INSERT")),
    "ai.observations": (READ, access("SELECT, INSERT")),
    "ai.citations": (READ, access("SELECT, INSERT")),
    "ai.entity_mentions": (READ, access("SELECT, INSERT")),
    "ai.observation_facts": (READ, access("SELECT, INSERT")),
```

and in `FUNCTIONS`, after the `seo.serp_snapshot_raw(bigint)` line:

```python
    # The raw payload of an answer of the current workspace (migration 0018).
    "ai.observation_raw(bigint)": frozenset({"app_api"}),
```

In `backend/tests/db/test_domain_values.py`, add the import `from idraft.domain.ai_engines import ObservationClass` and two rows to the parametrize list after the `("ops.collection_runs", "trigger", ...)` row:

```python
        ("ai.engines", "observation_class", set(ObservationClass)),
        ("ai.observations", "observation_class", set(ObservationClass)),
```

`tests/db/test_rls.py` needs no edit: every new key between tenant tables carries the workspace, so `SINGLE_WORKSPACE_KEYS` is unchanged, and `seed_ai` gives every new tenant table a row.

- [ ] **Step 7: Run the database tests and the gate**

Run: `uv run pytest -n 4 --no-cov tests/db -q`
Expected: all pass (the new file shows `11 passed` when run alone; `test_migrations.py::test_the_history_can_be_walked_down_and_up_again` exercises the downgrade).
Run the gate commands.

- [ ] **Step 8: Commit**

```bash
git add backend/src/idraft/db/migrations/versions/0018_ai_prompts.py backend/src/idraft/db/tables.py \
  backend/tests/db/support.py backend/tests/db/test_tables.py backend/tests/db/test_grants.py \
  backend/tests/db/test_domain_values.py backend/tests/db/test_ai_schema.py
git commit -m "Migration 0018: AI prompt tables, engines, prices and the base plan quota"
```

---

### Task 3: AI schedules, task prices and the `ai_prompt` schedule rules

**Files:**
- Create: `backend/src/idraft/ai/schedule.py`, `backend/src/idraft/ai/pricing.py`
- Modify: `backend/src/idraft/api/operations/schedules.py` (`WORKLOADS`)
- Modify: `backend/tests/api/operations/test_schedules.py` (one case changes, one test added)
- Test: `backend/tests/ai/conftest.py`, `backend/tests/ai/test_schedule.py`, `backend/tests/ai/test_pricing.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/ai/conftest.py`:

```python
from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from tests.conftest import BASE_URL, PostgresServer


@pytest.fixture
async def sessions(
    migrated: PostgresServer, redis_url: str
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Sessions as the API, which turns engines on and so makes the AI schedules."""
    settings = Settings(
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url("app_api")),
        redis_url=SecretStr(redis_url),
        db_pool_size=2,
        log_level="critical",
        app_env="test",
    )
    engine = create_engine(settings)
    yield create_session_factory(engine)
    await engine.dispose()
```

`backend/tests/ai/test_schedule.py`:

```python
"""The project's AI answer schedules (spec 2026-11-11 section 4.3; plan decision A4)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.schedule import AI_SCHEDULE, ensure_ai_schedule
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

# A Wednesday.
NOW = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)

type Sessions = async_sessionmaker[AsyncSession]


def test_the_schedules_run_as_often_as_the_base_plan_says() -> None:
    assert len(AI_SCHEDULE.runs) == BASE_PLAN.runs_per_week
    assert len({run.weekday for run in AI_SCHEDULE.runs}) == BASE_PLAN.runs_per_week


async def test_a_project_gets_two_weekly_answer_schedules(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await execute(
        migrated, "UPDATE core.projects SET timezone = 'Europe/Berlin' WHERE id = $1", project
    )

    async with workspace_transaction(sessions, workspace.id) as db:
        await ensure_ai_schedule(db, workspace_id=workspace.id, project_id=project, now=NOW)

    rows = await fetch(
        migrated,
        "SELECT name, workload, cadence, weekday, timezone, window_start_local, window_hours, "
        "provider_mode, selector, is_active, next_run_at FROM ops.schedules "
        "WHERE project_id = $1 ORDER BY weekday",
        project,
    )
    assert [tuple(row)[:10] for row in rows] == [
        (name, "ai_prompt", "weekly", weekday, "Europe/Berlin", AI_SCHEDULE.window_start_local,
         8, "standard_queue", '{"all": true}', True)
        for weekday, name in ((1, "AI answers, Monday"), (4, "AI answers, Thursday"))
    ]
    # 01:00 in Berlin in November is 00:00 UTC: Monday 16 and Thursday 12 November.
    assert [row["next_run_at"] for row in rows] == [
        datetime(2026, 11, 16, 0, 0, tzinfo=UTC),
        datetime(2026, 11, 12, 0, 0, tzinfo=UTC),
    ]


async def test_a_project_with_an_answer_schedule_gets_no_more(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)

    for _ in range(2):
        async with workspace_transaction(sessions, workspace.id) as db:
            await ensure_ai_schedule(db, workspace_id=workspace.id, project_id=project, now=NOW)
    # A person deleted both: they are not made again.
    await execute(
        migrated, "UPDATE ops.schedules SET deleted_at = now() WHERE project_id = $1", project
    )
    async with workspace_transaction(sessions, workspace.id) as db:
        await ensure_ai_schedule(db, workspace_id=workspace.id, project_id=project, now=NOW)

    rows = await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", project)
    assert len(rows) == 2
```

`backend/tests/ai/test_pricing.py`:

```python
"""AI task prices by the price book (docs/07 section 7.1; migration 0018)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.pricing import task_prices
from idraft.domain.ai_engines import ENGINES


async def test_each_engine_has_a_task_price_on_each_queue(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with sessions() as db:
        standard = await task_prices(db, queue="standard", on=date(2026, 11, 11))
        priority = await task_prices(db, queue="priority", on=date(2026, 11, 11))
        live = await task_prices(db, queue="live", on=date(2026, 11, 11))
        before = await task_prices(db, queue="standard", on=date(2026, 6, 30))

    endpoints = [engine.endpoint for engine in ENGINES.values()]
    assert standard == dict.fromkeys(endpoints, Decimal("0.0012"))
    assert priority == dict.fromkeys(endpoints, Decimal("0.0024"))
    # No live price is in the book, and none before the prices were valid: no guess of zero.
    assert live == before == {}
```

In `backend/tests/api/operations/test_schedules.py`, in the parametrize list of `test_a_schedule_the_planner_cannot_run_is_refused`, the case

```python
        ({"workload": "ai_prompt"}, "workload", "workload_not_available"),
```

becomes

```python
        ({"workload": "ai_mode_keyword"}, "workload", "workload_not_available"),
```

because `ai_prompt` schedules are now offered, and this test is added after `test_a_rank_schedule_takes_the_task_queues_and_not_the_live_call`:

```python
async def test_an_ai_answer_schedule_takes_every_prompt_on_a_task_queue(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    body = _body(workload="ai_prompt", cadence="weekly", weekday=1, selector={"all": True})
    del body["provider_mode"]

    created = await _create(api, workspace, project, owner, body)
    live = await _create(api, workspace, project, owner, {**body, "provider_mode": "live"})
    by_term = await _create(
        api, workspace, project, owner, {**body, "selector": {"terms": [str(uuid.uuid4())]}}
    )

    assert created.status_code == 201, created.text
    assert created.json()["data"]["provider_mode"] == "standard_queue"
    assert errors(live) == [("provider_mode", "provider_mode_not_supported")]
    assert errors(by_term) == [("selector.terms", "selector_not_supported")]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/ai tests/api/operations/test_schedules.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.ai.schedule'` and `idraft.ai.pricing`; the schedules test fails with `workload_not_available` for `ai_prompt`.

- [ ] **Step 3: Write the schedule helper**

`backend/src/idraft/ai/schedule.py`:

```python
"""The project's AI answer schedules (spec 2026-11-11 section 4.3; docs/21-scheduler-workers.md
section 2; plan decision A4).

The base plan asks every active prompt `BASE_PLAN.runs_per_week` times a week. A schedule has one
rule, and `ops.schedules` reserves a `cron` cadence that no rule computes yet
(`idraft.domain.schedules`): the planner passes a cron schedule over. So twice a week is two
weekly schedules, Monday and Thursday, three and four days apart. Each opens at 01:00 project
time for eight hours (doc 21 section 2; doc 07 section 4.3 keeps eight hours after the spike), on
the plan's queue, for every active prompt of the project.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from typing import Final
from uuid import UUID

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import projects, schedules
from idraft.domain.ai_engines import BASE_PLAN
from idraft.domain.schedules import Cadence, ScheduleRule, next_occurrence
from idraft.domain.workloads import TaskWorkload


@dataclass(frozen=True, slots=True)
class AiRun:
    # 0 is Sunday, as in `ops.schedules.weekday`.
    weekday: int
    name: str


@dataclass(frozen=True, slots=True)
class AiScheduleRule:
    window_start_local: time
    window_hours: int
    runs: tuple[AiRun, ...]


AI_SCHEDULE: Final = AiScheduleRule(
    window_start_local=time(1, 0),
    window_hours=8,
    runs=(AiRun(1, "AI answers, Monday"), AiRun(4, "AI answers, Thursday")),
)


async def ensure_ai_schedule(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, now: datetime
) -> None:
    """The project's AI answer schedules, made when an engine is turned on, so answers start by
    themselves. A project with any `ai_prompt` schedule, one a person paused, changed or deleted
    included, is left as it is. The caller holds the project row, so two of these never run at
    once for one project."""
    found = await db.execute(
        select(schedules.c.id)
        .where(
            schedules.c.workspace_id == workspace_id,
            schedules.c.project_id == project_id,
            schedules.c.workload == TaskWorkload.AI_PROMPT.value,
        )
        .limit(1)
    )
    if found.first() is not None:
        return
    timezone: str = (
        await db.execute(
            select(projects.c.timezone).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one()
    for run in AI_SCHEDULE.runs:
        rule = ScheduleRule(
            cadence=Cadence.WEEKLY,
            timezone=timezone,
            window_start_local=AI_SCHEDULE.window_start_local,
            weekday=run.weekday,
        )
        await db.execute(
            insert(schedules).values(
                workspace_id=workspace_id,
                project_id=project_id,
                workload=TaskWorkload.AI_PROMPT.value,
                name=run.name,
                cadence=rule.cadence.value,
                weekday=run.weekday,
                timezone=timezone,
                window_start_local=AI_SCHEDULE.window_start_local,
                window_hours=AI_SCHEDULE.window_hours,
                provider_mode=BASE_PLAN.provider_mode,
                selector={"all": True},
                next_run_at=next_occurrence(rule, now),
            )
        )
```

- [ ] **Step 4: Write the price lookup**

`backend/src/idraft/ai/pricing.py`:

```python
"""What an AI task costs by the price book (docs/27-cost-model.md section 1; docs/07 section
7.1). Prices are global, read in any transaction."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import provider_price_book
from idraft.domain.ai_engines import ENGINES, PROVIDER_CODE


async def task_prices(db: AsyncSession, *, queue: str, on: date) -> dict[str, Decimal]:
    """The price of one task on each engine's endpoint and this queue (`standard` or
    `priority`), valid on `on`, by endpoint. An endpoint the book has no price for is left out:
    an estimate is never made from a guess of zero."""
    p = provider_price_book.c
    rows = await db.execute(
        select(p.endpoint, p.unit_price_usd, p.conditions)
        .where(
            p.provider_code == PROVIDER_CODE,
            p.endpoint.in_(sorted(engine.endpoint for engine in ENGINES.values())),
            p.price_unit == "task",
            p.valid_from <= on,
            (p.valid_to.is_(None)) | (p.valid_to > on),
        )
        # The newest row for a price wins, whatever order the database returns them in.
        .order_by(p.valid_from, p.unit_price_usd)
    )
    found: dict[str, Decimal] = {}
    for row in rows:
        if (row.conditions or {}).get("queue") == queue:
            found[row.endpoint] = Decimal(row.unit_price_usd)
    return found
```

- [ ] **Step 5: Offer `ai_prompt` schedules**

In `backend/src/idraft/api/operations/schedules.py`, add the import

```python
from idraft.domain.ai_engines import BASE_PLAN
```

and add to `WORKLOADS`, after the `seo_rank` entry:

```python
    # AI answers (spec 2026-11-11 section 4.3): every active prompt of the project, on the task
    # queues. `idraft.ai.schedule` makes the two default schedules when an engine is turned on.
    "ai_prompt": WorkloadRules(
        selectors=frozenset({"all"}),
        provider_modes=frozenset({"standard_queue", "priority_queue"}),
        default_mode=BASE_PLAN.provider_mode,
        needs_selector=True,
    ),
```

`needs_selector=True` is why `ensure_ai_schedule` writes `{"all": true}` and not the `{}` the brief proposed: a person editing that schedule later would otherwise be refused with `selector_empty`. The planner runs nothing for `ai_prompt` until plan B registers the workload (`_next_due` filters on `registry.workloads`).

- [ ] **Step 6: Run the tests and the gate**

Run: `uv run pytest -n 4 --no-cov tests/ai tests/api/operations/test_schedules.py -q`
Expected: all pass.
Run the gate commands.

- [ ] **Step 7: Commit**

```bash
git add backend/src/idraft/ai/schedule.py backend/src/idraft/ai/pricing.py \
  backend/src/idraft/api/operations/schedules.py backend/tests/ai/conftest.py \
  backend/tests/ai/test_schedule.py backend/tests/ai/test_pricing.py \
  backend/tests/api/operations/test_schedules.py
git commit -m "AI answer schedules twice a week, AI task prices, ai_prompt schedule rules"
```

---

### Task 4: One loader for a project's alias matcher

The alias test assembles the matcher's input inline (`project_service.py`, `alias_test`). Prompts need the same input for `is_branded` and the lint, and plan B's worker loader follows its shape. Move it into one function; the alias test keeps its behaviour.

**Files:**
- Modify: `backend/src/idraft/api/entities/project_service.py`
- Test: `backend/tests/api/entities/test_project_entities.py` (existing alias test cases, unchanged)

- [ ] **Step 1: Run the existing alias tests as the baseline**

Run: `uv run pytest -n 4 --no-cov tests/api/entities/test_project_entities.py -q`
Expected: all pass.

- [ ] **Step 2: Add `MatcherRules` and `matcher_rules`**

In `backend/src/idraft/api/entities/project_service.py`, add after the `AliasTestOutcome` dataclass:

```python
@dataclass(frozen=True, slots=True)
class MatcherRules:
    """A project's entities with a live role and their aliases, as the alias matcher reads
    them. Building the matcher from them is CPU work: do it off the event loop."""

    entities: list[MatcherEntity]
    rules: list[EntityRule]
    aliases: list[AliasRule]


async def matcher_rules(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> MatcherRules:
    """What the alias matcher needs for the project, read in the caller's transaction."""
    named = await roles.matcher_entities(db, workspace_id, project_id)
    ids = [entity.id for entity in named]
    hosts = await roles.matcher_hosts(db, workspace_id, ids)
    stored = await entities.aliases_of(db, workspace_id, ids)
    return MatcherRules(
        entities=named,
        rules=[
            EntityRule(
                id=entity.id,
                canonical_name=entity.canonical_name,
                parent_entity_id=entity.parent_entity_id,
                is_ambiguous=entity.is_ambiguous,
                hints=entity.hints,
                domains=tuple(hosts[entity.id]),
            )
            for entity in named
        ],
        aliases=[
            AliasRule(
                id=alias.id,
                entity_id=alias.entity_id,
                alias=alias.alias,
                match_mode=cast(MatchMode, alias.match_mode),
                case_sensitive=alias.case_sensitive,
                is_negative=alias.is_negative,
                requires_context=alias.requires_context,
            )
            for alias in stored
        ],
    )
```

- [ ] **Step 3: Make the alias test use it**

Replace the body of `ProjectEntityService.alias_test` with:

```python
        """What extraction would count in `text` with the project's current entities."""
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            if len(text.encode("utf-8", "surrogatepass")) > ALIAS_TEST_MAX_BYTES:
                raise PayloadTooLargeError(
                    "The alias test takes up to 100 KB of text.",
                    limit_bytes=ALIAS_TEST_MAX_BYTES,
                )
            loaded = await matcher_rules(db, access.workspace_id, project_id)

        def run() -> tuple[MatchResult, tuple[UUID, ...]]:
            matcher = AliasMatcher(loaded.rules, loaded.aliases)
            return matcher.match(text), matcher.skipped_alias_ids

        try:
            # Compiling the patterns and matching up to 100 KB is CPU work: off the event loop.
            result, skipped = await asyncio.to_thread(run)
        except TooManyHitsError:
            raise TooManyMatchesError(
                "The aliases match this text too many times. Narrow a substring alias."
            ) from None
        return AliasTestOutcome(
            result=to_utf16(result, text),
            entities={entity.id: entity for entity in loaded.entities},
            skipped_alias_ids=skipped,
        )
```

- [ ] **Step 4: Run the tests and the gate**

Run: `uv run pytest -n 4 --no-cov tests/api/entities -q`
Expected: the same count passes as in step 1, plus the rest of the folder.
Run the gate commands.

- [ ] **Step 5: Commit**

```bash
git add backend/src/idraft/api/entities/project_service.py
git commit -m "One loader for a project's alias matcher rules"
```

---

### Task 5: Request and response models of the prompt and engine routes

**Files:**
- Create: `backend/src/idraft/api/schemas/ai.py`
- Test: `backend/tests/api/ai/__init__.py`, `backend/tests/api/ai/test_ai_bodies.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/ai/__init__.py`: an empty file.

`backend/tests/api/ai/test_ai_bodies.py`:

```python
"""The request rules of the prompt and engine bodies (docs/19 sections 3.7.1 and 3.7.4), which
hold before any route reads them."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from idraft.api.schemas.ai import (
    EngineUpdate,
    PromptBulkCreate,
    PromptCreate,
    PromptLintRequest,
    PromptPatch,
)
from idraft.domain.ai_engines import PROMPT_TEXT_MAX

ONE = {"text": "Which CRM suits a startup?", "language_code": "en", "country_iso": "US"}


def _codes(model: type[BaseModel], body: dict[str, Any]) -> list[str]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(body)
    return [error["type"] for error in caught.value.errors()]


@pytest.mark.parametrize(
    ("model", "body", "code"),
    [
        (PromptCreate, {**ONE, "text": "x" * (PROMPT_TEXT_MAX + 1)}, "prompt_too_long"),
        (PromptCreate, {**ONE, "text": "x" * (4 * PROMPT_TEXT_MAX + 1)}, "prompt_too_long"),
        (PromptCreate, {**ONE, "text": "   "}, "string_too_short"),
        (PromptCreate, {**ONE, "text": "one\ntwo"}, "value_error"),
        (PromptCreate, {**ONE, "language_code": "eng"}, "string_pattern_mismatch"),
        (PromptCreate, {**ONE, "country_iso": "us"}, "string_pattern_mismatch"),
        (PromptCreate, {"text": "x?", "language_code": "en"}, "missing"),
        (PromptCreate, {**ONE, "importance": 6}, "less_than_equal"),
        (PromptCreate, {**ONE, "panel_ids": []}, "extra_forbidden"),
        (PromptCreate, {**ONE, "term_ids": ["not-a-uuid"]}, "uuid_parsing"),
        (PromptBulkCreate, {"items": []}, "too_short"),
        (PromptBulkCreate, {"items": [ONE], "on_duplicate": "merge"}, "literal_error"),
        (PromptPatch, {"text": "Another?"}, "immutable_field"),
        (PromptPatch, {"country_iso": "DE"}, "immutable_field"),
        (PromptPatch, {"language_code": "de"}, "immutable_field"),
        (PromptPatch, {"importance": None}, "null_not_allowed"),
        (PromptPatch, {}, "value_error"),
        (PromptLintRequest, {"texts": []}, "too_short"),
        (PromptLintRequest, {"texts": ["x?"], "engine_codes": ["perplexity_web"]}, "enum"),
        (EngineUpdate, {"location_ids": []}, "too_short"),
        (EngineUpdate, {"location_ids": [0]}, "greater_than_equal"),
        (EngineUpdate, {"location_ids": [2840], "replicates": 3}, "extra_forbidden"),
        (EngineUpdate, {"location_ids": [2840], "provider_code": "x"}, "extra_forbidden"),
    ],
)
def test_a_body_breaking_a_rule_is_refused_with_its_code(
    model: type[BaseModel], body: dict[str, Any], code: str
) -> None:
    assert code in _codes(model, body)


def test_a_prompt_is_stored_trimmed_and_composed() -> None:
    # Written as escapes: an editor would otherwise compose the decomposed input again
    body = PromptCreate.model_validate({**ONE, "text": "  Cafe\u0301 near me?  "})
    assert body.text == "Caf\u00e9 near me?"
    assert (body.intent, body.funnel_stage, body.prompt_type, body.importance) == (
        "unknown",
        "unknown",
        "question",
        3,
    )


def test_a_text_that_composes_under_the_limit_fits() -> None:
    body = PromptCreate.model_validate({**ONE, "text": "é" * PROMPT_TEXT_MAX})
    assert len(body.text) == PROMPT_TEXT_MAX


def test_the_lint_takes_a_text_too_long_to_save() -> None:
    body = PromptLintRequest.model_validate({"texts": ["x" * 2500]})
    assert body.texts == ["x" * 2500]
    assert body.engine_codes is None


def test_an_engine_is_turned_on_unless_the_body_says_off() -> None:
    assert EngineUpdate.model_validate({"location_ids": [2840]}).is_enabled
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/ai/test_ai_bodies.py -q`
Expected: `ModuleNotFoundError: No module named 'idraft.api.schemas.ai'`.

- [ ] **Step 3: Write the models**

`backend/src/idraft/api/schemas/ai.py`:

```python
"""Bodies of the AI routes (docs/19-api-specification.md section 3.7, cut to slice 1 as spec
2026-11-11 section 4.5 says). This plan defines the prompt and engine models; plan B adds the
answer and summary models.

Slice 1 leaves out what it does not build: panels, keyword links, personas, context preambles,
versions after the first, and the Idempotency-Key header (the "As built" notes of doc 19
sections 3.7.1 and 3.7.4).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError

from idraft.ai.text import normalize
from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import Body, LanguageCode, Patch, UserRef, printable, refuse_null
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.keywords import FunnelStage, Intent, LocationId
from idraft.api.schemas.metrics import Usd
from idraft.domain.ai_engines import PROMPT_TEXT_MAX, EngineCode, ObservationClass

PromptType = Literal[
    "question",
    "comparison",
    "recommendation",
    "how_to",
    "definition",
    "local",
    "transactional",
    "other",
]
ChangeKind = Literal["initial", "wording", "typo", "context"]
CreationMethod = Literal["human", "template", "llm_generated", "imported"]
LintRule = Literal["contains_brand_alias", "engine_limit"]
LintSeverity = Literal["info", "warning", "error"]

BULK_CREATE_MAX: Final = 1000
LINT_MAX: Final = 1000
TERMS_MAX: Final = 20
LOCATIONS_MAX: Final = 50
IMMUTABLE_FIELDS: Final = ("text", "language_code", "country_iso")
# A character decomposes into at most four, so a text up to four times the limit may still
# compose under it; anything longer cannot, and is not composed at all.
_RAW_TEXT_MAX: Final = 4 * PROMPT_TEXT_MAX


def _prompt_text(value: object) -> object:
    """Trimmed and composed before the limits are checked (`idraft.ai.text`), so "é" counts
    once however it was typed. Longer than any engine takes is `prompt_too_long` (docs/19
    section 3.7.1)."""
    if not isinstance(value, str):
        return value
    if len(value) > _RAW_TEXT_MAX or len(composed := normalize(value)) > PROMPT_TEXT_MAX:
        raise PydanticCustomError(
            "prompt_too_long",
            "A prompt has at most {max_length} characters.",
            {"max_length": PROMPT_TEXT_MAX},
        )
    return composed


def _lint_text(value: object) -> object:
    """As a prompt, but a text too long to save is linted (and told so), not refused."""
    if not isinstance(value, str):
        return value
    if len(value) > _RAW_TEXT_MAX:
        raise PydanticCustomError(
            "string_too_long",
            "String should have at most {max_length} characters",
            {"max_length": _RAW_TEXT_MAX},
        )
    return normalize(value)


# The constraints first, so they are the string's own and report as such; the validator below
# them still runs before they are checked (as `Email` in idraft.api.schemas.common).
PromptText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=PROMPT_TEXT_MAX),
    BeforeValidator(_prompt_text),
    AfterValidator(printable),
]
LintText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=_RAW_TEXT_MAX),
    BeforeValidator(_lint_text),
    AfterValidator(printable),
]
# ISO 3166-1 alpha-2, as `core.locations.country_iso` holds it.
CountryIso = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
Importance = Annotated[int, Field(ge=1, le=5)]
TermIds = Annotated[list[UUID], Field(max_length=TERMS_MAX)]


class PromptCreate(Body):
    """One prompt. Its text is fixed once saved: to change it, archive the prompt and add a new
    one."""

    text: PromptText = Field(description="Trimmed and composed (NFC); one line.")
    language_code: LanguageCode
    country_iso: CountryIso = Field(
        description="The market the prompt stands for. Every enabled engine needs a location "
        "in it (`location_not_supported` otherwise)."
    )
    intent: Intent = "unknown"
    funnel_stage: FunnelStage = "unknown"
    prompt_type: PromptType = "question"
    importance: Importance = 3
    term_ids: TermIds = Field(
        default_factory=list, description="Topics and other terms the project may use."
    )


class PromptBulkCreate(Body):
    items: Annotated[list[PromptCreate], Field(min_length=1, max_length=BULK_CREATE_MAX)]
    on_duplicate: Literal["skip", "error"] = Field(
        default="skip",
        description="A prompt the project has already: `skip` lists it in `skipped`, `error` "
        "in `rejected` with `duplicate`.",
    )


class PromptPatch(Patch):
    """At least one member. The text, language and country are fixed (`immutable_field`)."""

    intent: Intent | None = None
    funnel_stage: FunnelStage | None = None
    prompt_type: PromptType | None = None
    importance: Importance | None = None
    is_branded: bool | None = None
    is_active: bool | None = Field(
        default=None,
        description="`true` brings an archived prompt back; it counts against the quota.",
    )
    term_ids: TermIds | None = Field(default=None, description="Replaces the prompt's terms.")

    # Accepted only to be refused by name, so a client learns which field it was. Not in the
    # API document.
    text: SkipJsonSchema[object] = None
    language_code: SkipJsonSchema[object] = None
    country_iso: SkipJsonSchema[object] = None

    _not_null = field_validator(
        "intent", "funnel_stage", "prompt_type", "importance", "is_branded", "is_active", "term_ids"
    )(refuse_null)

    @field_validator(*IMMUTABLE_FIELDS, mode="before")
    @classmethod
    def _immutable(cls, value: object) -> object:
        raise PydanticCustomError(
            "immutable_field", "Fixed once saved: archive the prompt and add a new one."
        )

    @model_validator(mode="after")
    def _says_something(self) -> PromptPatch:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class PromptVersion(BaseModel):
    prompt_version_id: UUID
    version_no: int
    text: str = Field(description="Exactly what the engines receive.")
    text_hash: str = Field(description="sha256 of the text, hex.")
    change_kind: ChangeKind
    created_at: datetime


class PromptTerm(BaseModel):
    term_id: UUID
    vocabulary_kind: str
    name: str
    path: str


class Prompt(BaseModel):
    prompt_id: UUID
    current_version: PromptVersion
    language_code: str
    country_iso: str | None
    intent: Intent
    funnel_stage: FunnelStage
    prompt_type: PromptType
    importance: int
    is_branded: bool = Field(
        description="Names an own brand: computed from the project's own aliases when the "
        "prompt is saved; a change may set it."
    )
    source: str
    creation_method: CreationMethod
    is_active: bool
    terms: list[PromptTerm]
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class PromptResponse(BaseModel):
    data: Prompt


class PromptPage(BaseModel):
    data: list[Prompt]
    page: CursorPageInfo


class PromptSkipped(BaseModel):
    index: int
    existing_id: UUID


class PromptRejected(BaseModel):
    index: int
    code: str
    message: str


class PromptBulkResult(BaseModel):
    created: list[UUID]
    skipped: list[PromptSkipped]
    rejected: list[PromptRejected]


class PromptBulkResponse(BaseModel):
    data: PromptBulkResult


class PromptLintRequest(Body):
    texts: Annotated[list[LintText], Field(min_length=1, max_length=LINT_MAX)]
    engine_codes: Annotated[list[EngineCode], Field(min_length=1)] | None = Field(
        default=None, description="The engines whose length limits apply. Left out: every one."
    )


class LintSpan(BaseModel):
    start: int
    end: int


class LintWarning(BaseModel):
    rule: LintRule
    severity: LintSeverity
    message: str
    engine_code: EngineCode | None = Field(description="For `engine_limit`: the engine.")
    span: LintSpan | None = Field(
        description="UTF-16 code units, as a JavaScript string indexes the text."
    )


class MatchedAlias(BaseModel):
    entity: EntityRef
    alias: str = Field(description="The text that matched.")


class PromptLint(BaseModel):
    text: str = Field(description="As it would be saved.")
    is_branded: bool
    matched_aliases: list[MatchedAlias] = Field(description="Own brand names found, each once.")
    warnings: list[LintWarning]


class PromptQuota(BaseModel):
    limit: int
    used: int = Field(description="Active prompts in the whole workspace.")


class PromptLintResponse(BaseModel):
    data: list[PromptLint]
    quota: PromptQuota


class Engine(BaseModel):
    engine_code: EngineCode
    label: str
    observation_class: ObservationClass
    vendor: str
    exposes_citations: bool
    exposes_fanout: bool
    max_prompt_chars: int


class ProjectEngine(BaseModel):
    engine: Engine
    is_configured: bool = Field(description="The project has settings for the engine.")
    is_enabled: bool
    location_ids: list[int]
    replicates: int
    provider_code: str
    active_prompts: int = Field(
        description="Active prompts that fit the engine's length limit: what one run asks it."
    )
    estimated_monthly_cost_usd: Usd | None = Field(
        description="Active prompts x runs a week x 52 / 12 x the task price, as if the engine "
        "were on. Null when the price book has no price."
    )


class ProjectEngineList(BaseModel):
    data: list[ProjectEngine]


class ProjectEngineResponse(BaseModel):
    data: ProjectEngine


class EngineUpdate(Body):
    location_ids: Annotated[list[LocationId], Field(min_length=1, max_length=LOCATIONS_MAX)] = (
        Field(description="Active countries the engine runs the prompts in.")
    )
    is_enabled: bool = Field(
        default=True, description="On starts weekly spend; off keeps the settings."
    )
```

- [ ] **Step 4: Run the tests and the gate**

Run: `uv run pytest --no-cov tests/api/ai/test_ai_bodies.py -q`
Expected: `27 passed`.
Run the gate commands.

- [ ] **Step 5: Commit**

```bash
git add backend/src/idraft/api/schemas/ai.py backend/tests/api/ai/__init__.py \
  backend/tests/api/ai/test_ai_bodies.py
git commit -m "Prompt and engine request and response models"
```

---

### Task 6: Engine routes

`GET {P}/engines`, `PUT {P}/engines/{engine_code}`, `DELETE {P}/engines/{engine_code}`.

**Files:**
- Create: `backend/src/idraft/api/ai/__init__.py`, `engine_repository.py`, `engine_service.py`, `engine_routes.py`
- Modify: `backend/src/idraft/api/audit.py`, `resources.py`, `main.py`
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Regenerate: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`
- Test: `backend/tests/api/ai/support.py`, `backend/tests/api/ai/test_engines.py`

- [ ] **Step 1: Write the test helpers**

`backend/tests/api/ai/support.py`:

```python
"""Helpers for the AI prompt and engine route tests."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

import httpx

from tests.api.auth.support import Workspace, execute
from tests.api.entities.support import Caller
from tests.api.keywords.support import LOCATION, keyword_project, project_url
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt


async def ai_project(pg: PostgresServer, workspace: Workspace) -> uuid.UUID:
    """A project in the United States in English, with no engine on."""
    return await keyword_project(pg, workspace)


def prompt_body(text: str, **changes: Any) -> dict[str, Any]:
    return {"text": text, "language_code": "en", "country_iso": "US", **changes}


async def add_prompt(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    text: str,
    **changes: Any,
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project_id, "prompts"),
        json=prompt_body(text, **changes),
        headers=caller.headers,
    )


async def added(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    text: str,
    **changes: Any,
) -> str:
    response = await add_prompt(api, workspace, project_id, caller, text, **changes)
    assert response.status_code == 201, response.text
    prompt_id: str = response.json()["data"]["prompt_id"]
    return prompt_id


async def enable_engine(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    engine_code: str = "chatgpt_web",
    location_ids: Sequence[int] = (LOCATION,),
) -> None:
    """An engine turned on, written directly: no schedule is made."""
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code) VALUES ($1, $2, $3, $4, 'dataforseo') ON CONFLICT (project_id, "
        "engine_code) DO UPDATE SET location_ids = excluded.location_ids, is_enabled = true",
        project_id,
        engine_code,
        workspace.id,
        list(location_ids),
    )


async def seed_prompts(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    count: int,
    *,
    text_length: int | None = None,
) -> list[uuid.UUID]:
    """`count` active prompts written directly: `prompt 1` and on, or `00000xxx...` of
    `text_length` characters each."""
    ids: list[uuid.UUID] = []
    async with connection(pg) as db:
        for index in range(count):
            text = (
                f"prompt {index + 1}"
                if text_length is None
                else f"{index:05d}".ljust(text_length, "x")
            )
            prompt_id, _ = await insert_prompt(db, workspace.id, project_id, text)
            ids.append(prompt_id)
    return ids


async def set_prompt_quota(pg: PostgresServer, workspace: Workspace, limit: int) -> None:
    await execute(
        pg,
        "INSERT INTO core.workspace_quotas (workspace_id, max_active_prompts) VALUES ($1, $2) "
        "ON CONFLICT (workspace_id) DO UPDATE SET max_active_prompts = excluded.max_active_prompts",
        workspace.id,
        limit,
    )
```

- [ ] **Step 2: Write the failing route tests**

`backend/tests/api/ai/test_engines.py`:

```python
"""A project's AI engines (docs/19 section 3.7.4; spec 2026-11-11 section 4.5)."""

from __future__ import annotations

import json
from datetime import time
from decimal import Decimal

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.ai.support import ai_project, seed_prompts
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import LOCATION, OTHER_LOCATION, errors, project_url
from tests.conftest import PostgresServer

CITY = 1023191


def _row(data: dict[str, object]) -> tuple[object, ...]:
    engine = data["engine"]
    assert isinstance(engine, dict)
    return (
        engine["engine_code"],
        data["is_configured"],
        data["is_enabled"],
        data["location_ids"],
        data["replicates"],
        data["active_prompts"],
        data["estimated_monthly_cost_usd"],
    )


async def test_every_engine_is_listed_off_with_its_cost_at_full_capacity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, BASE_PLAN.max_prompts)

    response = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)

    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [_row(row) for row in rows] == [
        ("chatgpt_web", False, False, [], 1, 150, "1.56"),
        ("gemini_web", False, False, [], 1, 150, "1.56"),
        ("google_ai_mode", False, False, [], 1, 150, "1.56"),
    ]
    # 150 prompts x 3 engines x 2 runs a week x 52 / 12 weeks x $0.0012 a task.
    assert sum(Decimal(row["estimated_monthly_cost_usd"]) for row in rows) == Decimal("4.68")
    assert rows[2]["engine"]["max_prompt_chars"] == 700


async def test_a_prompt_longer_than_an_engine_takes_is_not_counted_for_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, 2)
    await seed_prompts(migrated, workspace, project, 1, text_length=701)

    response = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)

    counts = {row["engine"]["engine_code"]: row["active_prompts"] for row in response.json()["data"]}
    assert counts == {"chatgpt_web": 3, "gemini_web": 3, "google_ai_mode": 2}


async def test_turning_the_first_engine_on_starts_two_runs_a_week(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    first = await api.put(
        project_url(workspace, project, "engines", "chatgpt_web"),
        json={"location_ids": [LOCATION, OTHER_LOCATION, LOCATION]},
        headers=editor.headers,
    )
    second = await api.put(
        project_url(workspace, project, "engines", "google_ai_mode"),
        json={"location_ids": [LOCATION]},
        headers=editor.headers,
    )

    assert first.status_code == second.status_code == 200, first.text
    data = first.json()["data"]
    assert (
        data["is_configured"],
        data["is_enabled"],
        data["location_ids"],
        data["replicates"],
        data["provider_code"],
    ) == (True, True, [OTHER_LOCATION, LOCATION], 1, "dataforseo")
    rows = await fetch(
        migrated,
        "SELECT name, workload, cadence, weekday, window_start_local, window_hours, "
        "provider_mode, selector FROM ops.schedules WHERE project_id = $1 ORDER BY weekday",
        project,
    )
    assert [tuple(row) for row in rows] == [
        (name, "ai_prompt", "weekly", weekday, time(1, 0), 8, "standard_queue", '{"all": true}')
        for weekday, name in ((1, "AI answers, Monday"), (4, "AI answers, Thursday"))
    ]
    entries = await fetch(
        migrated,
        "SELECT action, target_id, before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "ORDER BY occurred_at",
        workspace.id,
    )
    assert [(entry["action"], entry["target_id"]) for entry in entries] == [
        ("project_engine.updated", str(project))
    ] * 2
    assert entries[0]["before"] is None
    assert json.loads(entries[0]["after"]) == {
        "engine_code": "chatgpt_web",
        "location_ids": [str(OTHER_LOCATION), str(LOCATION)],
        "is_enabled": True,
    }


async def test_turning_an_engine_off_keeps_its_settings_and_the_schedules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    never_on = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "gemini_web")

    await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    off = await api.put(
        url, json={"location_ids": [LOCATION], "is_enabled": False}, headers=editor.headers
    )
    await api.put(
        project_url(workspace, never_on, "engines", "gemini_web"),
        json={"location_ids": [LOCATION], "is_enabled": False},
        headers=editor.headers,
    )

    assert off.status_code == 200, off.text
    assert (off.json()["data"]["is_configured"], off.json()["data"]["is_enabled"]) == (True, False)
    kept = await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", project)
    none = await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", never_on)
    assert (len(kept), len(none)) == (2, 0)


@pytest.mark.parametrize("location_ids", [[CITY], [LOCATION, 999_999_999]])
async def test_an_engine_runs_in_active_countries_only(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    location_ids: list[int],
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type, parent_id) "
        "VALUES ($1, 'New York', 'US', 'City', $2) ON CONFLICT (id) DO NOTHING",
        CITY,
        LOCATION,
    )

    response = await api.put(
        project_url(workspace, project, "engines", "chatgpt_web"),
        json={"location_ids": location_ids},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("location_ids", "location_not_supported")]
    assert await fetch(
        migrated, "SELECT engine_code FROM ai.project_engines WHERE project_id = $1", project
    ) == []


async def test_removing_an_engine_removes_its_settings_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "chatgpt_web")
    await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)

    removed = await api.delete(url, headers=editor.headers)
    again = await api.delete(url, headers=editor.headers)
    listed = await api.get(project_url(workspace, project, "engines"), headers=editor.headers)

    assert removed.status_code == 204
    assert problem(again) == (404, "not_found")
    assert listed.json()["data"][0]["is_configured"] is False
    actions = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY occurred_at",
        workspace.id,
    )
    assert [row["action"] for row in actions] == ["project_engine.updated", "project_engine.deleted"]


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_only_a_project_writer_changes_engines(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "chatgpt_web")

    put = await api.put(url, json={"location_ids": [LOCATION]}, headers=caller.headers)
    delete = await api.delete(url, headers=caller.headers)

    assert problem(put) == problem(delete) == (403, "forbidden")


async def test_an_engine_the_platform_does_not_offer_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.put(
        project_url(workspace, project, "engines", "perplexity_web"),
        json={"location_ids": [LOCATION]},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
```

- [ ] **Step 3: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/ai/test_engines.py -q`
Expected: failures with `404` for every request (no route yet), for example `assert 404 == 200`.

- [ ] **Step 4: Write the repository**

`backend/src/idraft/api/ai/__init__.py`:

```python
"""AI prompt tracking routes (docs/19-api-specification.md section 3.7)."""
```

`backend/src/idraft/api/ai/engine_repository.py`:

```python
"""Reads and writes of a project's AI engines (docs/04-data-model.md section 8.1).

Runs in the caller's transaction as the API role; every statement names the workspace.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import Integer, Row, and_, any_, delete, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import ai_project_engines, ai_prompt_versions, ai_prompts, locations
from idraft.domain.ai_engines import BASE_PLAN, PROVIDER_CODE, Engine, EngineCode


@dataclass(frozen=True, slots=True)
class ProjectEngineRecord:
    engine_code: EngineCode
    location_ids: list[int]
    replicates: int
    provider_code: str
    is_enabled: bool


def _record(row: Row[Any]) -> ProjectEngineRecord:
    return ProjectEngineRecord(
        engine_code=EngineCode(row.engine_code),
        location_ids=list(row.location_ids),
        replicates=row.replicates,
        provider_code=row.provider_code,
        is_enabled=row.is_enabled,
    )


def _of_project(workspace_id: UUID, project_id: UUID) -> Any:
    return and_(
        ai_project_engines.c.workspace_id == workspace_id,
        ai_project_engines.c.project_id == project_id,
    )


async def project_engines(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> dict[EngineCode, ProjectEngineRecord]:
    rows = await db.execute(select(ai_project_engines).where(_of_project(workspace_id, project_id)))
    return {record.engine_code: record for record in (_record(row) for row in rows)}


async def get_project_engine(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, engine_code: EngineCode
) -> ProjectEngineRecord | None:
    row = (
        await db.execute(
            select(ai_project_engines).where(
                _of_project(workspace_id, project_id),
                ai_project_engines.c.engine_code == engine_code.value,
            )
        )
    ).one_or_none()
    return None if row is None else _record(row)


async def save_project_engine(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    engine_code: EngineCode,
    location_ids: Sequence[int],
    is_enabled: bool,
) -> None:
    """The engine's settings, made or changed. The provider and the answers per engine are the
    base plan's (spec section 8: one answer per prompt and engine)."""
    statement = upsert(ai_project_engines).values(
        project_id=project_id,
        engine_code=engine_code.value,
        workspace_id=workspace_id,
        location_ids=list(location_ids),
        replicates=BASE_PLAN.answers_per_engine,
        provider_code=PROVIDER_CODE,
        is_enabled=is_enabled,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[ai_project_engines.c.project_id, ai_project_engines.c.engine_code],
            set_={
                "location_ids": statement.excluded.location_ids,
                "is_enabled": statement.excluded.is_enabled,
            },
        )
    )


async def delete_project_engine(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, engine_code: EngineCode
) -> None:
    await db.execute(
        delete(ai_project_engines).where(
            _of_project(workspace_id, project_id),
            ai_project_engines.c.engine_code == engine_code.value,
        )
    )


async def runnable_locations(
    db: AsyncSession, engine: Engine, location_ids: Collection[int]
) -> set[int]:
    """The active locations among these that the engine runs at (`Engine.runs_at`)."""
    rows = await db.execute(
        select(locations.c.id, locations.c.location_type).where(
            locations.c.id == any_(literal(list(location_ids), ARRAY(Integer))),
            locations.c.is_active,
        )
    )
    return {row.id for row in rows if engine.runs_at(row.location_type)}


async def enabled_countries(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> dict[EngineCode, set[str]]:
    """The countries each enabled engine of the project runs in."""
    rows = await db.execute(
        select(ai_project_engines.c.engine_code, locations.c.country_iso)
        .select_from(
            ai_project_engines.outerjoin(
                locations, locations.c.id == any_(ai_project_engines.c.location_ids)
            )
        )
        .where(_of_project(workspace_id, project_id), ai_project_engines.c.is_enabled)
    )
    found: defaultdict[EngineCode, set[str]] = defaultdict(set)
    for row in rows:
        countries = found[EngineCode(row.engine_code)]
        if row.country_iso is not None:
            countries.add(row.country_iso)
    return dict(found)


async def prompt_lengths(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[int]:
    """The length of each active prompt of the project."""
    # shortcut: reads one number per prompt; fine at the quota sizes, count in SQL past 10,000.
    rows = await db.execute(
        select(func.char_length(ai_prompt_versions.c.text))
        .select_from(
            ai_prompts.join(
                ai_prompt_versions,
                and_(
                    ai_prompt_versions.c.id == ai_prompts.c.current_version_id,
                    ai_prompt_versions.c.workspace_id == ai_prompts.c.workspace_id,
                ),
            )
        )
        .where(
            ai_prompts.c.workspace_id == workspace_id,
            ai_prompts.c.project_id == project_id,
            ai_prompts.c.is_active,
            ai_prompts.c.deleted_at.is_(None),
        )
    )
    return [int(length) for length in rows.scalars()]
```

- [ ] **Step 5: Write the service**

`backend/src/idraft/api/ai/engine_service.py`:

```python
"""Rules for a project's AI engines (docs/19-api-specification.md section 3.7.4; spec
2026-11-11 section 4.5).

An engine is off until a person turns it on, since that starts weekly spend; the list shows each
engine's monthly estimate first, as if it were on. Turning one on makes the project's AI answer
schedules (`idraft.ai.schedule`) when it has none, in the same transaction. Engine writes lock
the project row, so two at once cannot both make schedules. Every change is audited.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.pricing import task_prices
from idraft.ai.schedule import ensure_ai_schedule
from idraft.api import audit
from idraft.api.ai import engine_repository as repository
from idraft.api.ai.engine_repository import ProjectEngineRecord
from idraft.api.problems import NotFoundError, invalid_field
from idraft.api.projects import repository as projects
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import BASE_PLAN, ENGINES, Engine, EngineCode, monthly_cost


@dataclass(frozen=True, slots=True)
class EngineView:
    engine: Engine
    configured: ProjectEngineRecord | None
    active_prompts: int
    estimated_monthly_cost_usd: Decimal | None


async def live_project(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, *, lock: bool = False
) -> None:
    """The project exists and is not deleted; with `lock`, writers to it wait for this one."""
    if await projects.get_project(db, access.workspace_id, project_id, for_update=lock) is None:
        raise NotFoundError


def _snapshot(record: ProjectEngineRecord | None) -> audit.Snapshot | None:
    if record is None:
        return None
    return {
        "engine_code": record.engine_code.value,
        "location_ids": [str(location_id) for location_id in record.location_ids],
        "is_enabled": record.is_enabled,
    }


async def _views(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, codes: Sequence[EngineCode]
) -> list[EngineView]:
    configured = await repository.project_engines(db, workspace_id, project_id)
    lengths = await repository.prompt_lengths(db, workspace_id, project_id)
    prices = await task_prices(db, queue=BASE_PLAN.queue, on=datetime.now(UTC).date())
    views = []
    for code in codes:
        engine = ENGINES[code]
        prompts = sum(1 for length in lengths if length <= engine.max_prompt_chars)
        price = prices.get(engine.endpoint)
        views.append(
            EngineView(
                engine=engine,
                configured=configured.get(code),
                active_prompts=prompts,
                estimated_monthly_cost_usd=None if price is None else monthly_cost(prompts, price),
            )
        )
    return views


class EngineService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list_engines(self, access: WorkspaceAccess, project_id: UUID) -> list[EngineView]:
        """Every engine slice 1 offers, configured or not, in `EngineCode` order."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            return await _views(db, access.workspace_id, project_id, list(EngineCode))

    async def put(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        engine_code: EngineCode,
        body: EngineUpdate,
        info: RequestInfo,
    ) -> EngineView:
        engine = ENGINES[engine_code]
        location_ids = sorted(set(body.location_ids))
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            runnable = await repository.runnable_locations(db, engine, location_ids)
            if set(location_ids) - runnable:
                raise invalid_field(
                    "location_ids",
                    code="location_not_supported",
                    message=f"{engine.label} runs in active countries only.",
                )
            before = await repository.get_project_engine(
                db, access.workspace_id, project_id, engine_code
            )
            await repository.save_project_engine(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                engine_code=engine_code,
                location_ids=location_ids,
                is_enabled=body.is_enabled,
            )
            if body.is_enabled:
                await ensure_ai_schedule(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    now=datetime.now(UTC),
                )
            (view,) = await _views(db, access.workspace_id, project_id, [engine_code])
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="project_engine.updated",
                target_type="project",
                target_id=project_id,
                info=info,
                before=_snapshot(before),
                after=_snapshot(view.configured),
            )
        return view

    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, engine_code: EngineCode, info: RequestInfo
    ) -> None:
        """The engine's settings go; its answers stay. The schedules stay too: with no engine
        on, a run asks nothing."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            before = await repository.get_project_engine(
                db, access.workspace_id, project_id, engine_code
            )
            if before is None:
                raise NotFoundError
            await repository.delete_project_engine(db, access.workspace_id, project_id, engine_code)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="project_engine.deleted",
                target_type="project",
                target_id=project_id,
                info=info,
                before=_snapshot(before),
            )
```

- [ ] **Step 6: Write the routes**

`backend/src/idraft/api/ai/engine_routes.py`:

```python
"""A project's AI engines (docs/19-api-specification.md section 3.7.4, cut to slice 1).

Reading needs `data:read`; turning engines on or off needs `projects:write`. The membership
dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from idraft.api.ai.engine_service import EngineService, EngineView
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import (
    Engine,
    EngineUpdate,
    ProjectEngine,
    ProjectEngineList,
    ProjectEngineResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import BASE_PLAN, PROVIDER_CODE, EngineCode

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines", tags=["ai"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_engine_service(resources: Annotated[Resources, Depends(get_resources)]) -> EngineService:
    return resources.ai_engines


Engines = Annotated[EngineService, Depends(get_engine_service)]


def engine_view(view: EngineView) -> ProjectEngine:
    engine, configured = view.engine, view.configured
    return ProjectEngine(
        engine=Engine(
            engine_code=engine.code,
            label=engine.label,
            observation_class=engine.observation_class,
            vendor=engine.vendor,
            exposes_citations=engine.exposes_citations,
            exposes_fanout=engine.exposes_fanout,
            max_prompt_chars=engine.max_prompt_chars,
        ),
        is_configured=configured is not None,
        is_enabled=configured is not None and configured.is_enabled,
        location_ids=[] if configured is None else configured.location_ids,
        replicates=BASE_PLAN.answers_per_engine if configured is None else configured.replicates,
        provider_code=PROVIDER_CODE if configured is None else configured.provider_code,
        active_prompts=view.active_prompts,
        estimated_monthly_cost_usd=view.estimated_monthly_cost_usd,
    )


@router.get(
    "",
    summary="The AI engines and how the project runs them",
    description="Every engine offered, configured or not. `estimated_monthly_cost_usd` is what "
    "the engine costs a month with the project's active prompts on the base plan (runs a week, "
    "one answer, standard queue), as if it were on.",
)
async def list_engines(project_id: UUID, access: ReadData, engines: Engines) -> ProjectEngineList:
    views = await engines.list_engines(access, project_id)
    return ProjectEngineList(data=[engine_view(view) for view in views])


@router.put(
    "/{engine_code}",
    summary="Turn an engine on or off for the project",
    description="The first engine turned on makes the project's AI answer schedules (twice a "
    "week). `location_ids` must be active countries (`422 validation_failed` with "
    "`location_not_supported`). The provider is DataForSEO and the engine gives one answer "
    "per prompt and run.",
)
async def put_engine(
    project_id: UUID,
    engine_code: EngineCode,
    body: EngineUpdate,
    access: WriteProject,
    engines: Engines,
    info: Info,
) -> ProjectEngineResponse:
    view = await engines.put(access, project_id, engine_code, body, info)
    return ProjectEngineResponse(data=engine_view(view))


@router.delete(
    "/{engine_code}",
    status_code=204,
    summary="Remove the engine's settings; its answers stay",
)
async def delete_engine(
    project_id: UUID, engine_code: EngineCode, access: WriteProject, engines: Engines, info: Info
) -> Response:
    await engines.delete(access, project_id, engine_code, info)
    return Response(status_code=204)
```

- [ ] **Step 7: Wire it**

In `backend/src/idraft/api/audit.py`, add to `AuditAction` after `"integration.disabled",`:

```python
    "project_engine.updated",
    "project_engine.deleted",
```

In `backend/src/idraft/api/resources.py`, add the import `from idraft.api.ai.engine_service import EngineService` and the field after `integrations: IntegrationService`:

```python
    ai_engines: EngineService
```

In `backend/src/idraft/api/main.py`, add the imports

```python
from idraft.api.ai.engine_routes import router as engine_routes_router
from idraft.api.ai.engine_service import EngineService
```

in `Resources(...)` after the `integrations=IntegrationService(...)` argument:

```python
                ai_engines=EngineService(sessions=sessions),
```

and after `app.include_router(integrations_router)`:

```python
    app.include_router(engine_routes_router)
```

- [ ] **Step 8: Declare the access and the cross-tenant bodies**

In `backend/tests/api/test_route_access.py`, add to `EXPECTED` before the closing brace:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines"): "data:read",
    (
        "PUT",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines/{engine_code}",
    ): "projects:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines/{engine_code}",
    ): "projects:write",
```

and to `PATH_PARAMETERS` after `"kind",`:

```python
    # An AI engine (`chatgpt_web`), a word and not an id, after `{project_id}`.
    "engine_code",
```

In `backend/tests/security/test_cross_tenant.py`:

- add to `BODIES`:

```python
    ("PUT", _W + "/projects/{project_id}/engines/{engine_code}"): {"location_ids": [LOCATION]},
```

- `WORDS` becomes `WORDS = {"kind": "gsc", "engine_code": "chatgpt_web"}`
- in `_tenant`, after the `seo.tracked_keyword_terms` insert, add:

```python
    # The same engine in both, on in the tracked keyword's country, so removing it succeeds.
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code) VALUES ($1, 'chatgpt_web', $2, ARRAY[$3::integer], 'dataforseo')",
        project_id,
        workspace.id,
        LOCATION,
    )
```

- add to `_TENANT_ROWS` after `"fp.integrations": "workspace_id",`:

```python
    "ai.project_engines": "workspace_id",
```

- [ ] **Step 9: Regenerate the contract and the web client**

Run: `uv run python -m idraft.api.openapi > openapi/v1.json`
Expected: no output; `git diff --stat openapi/v1.json` shows the file changed.
Run: `cd ../apps/web && pnpm gen:api && pnpm typecheck && cd ../../backend`
Expected: `openapi-typescript` reports writing `src/lib/api/schema.ts`; `tsc` prints no errors. If the worktree has no `node_modules` yet, run `pnpm install --frozen-lockfile` at the worktree root first.

- [ ] **Step 10: Run the tests and the gate**

Run: `uv run pytest -n 4 --no-cov tests/api/ai tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py -q`
Expected: all pass.
Run the gate commands.

- [ ] **Step 11: Commit**

```bash
git add backend/src/idraft/api/ai/__init__.py backend/src/idraft/api/ai/engine_repository.py \
  backend/src/idraft/api/ai/engine_service.py backend/src/idraft/api/ai/engine_routes.py \
  backend/src/idraft/api/audit.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py \
  backend/tests/api/ai/support.py backend/tests/api/ai/test_engines.py \
  backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py \
  backend/openapi/v1.json apps/web/src/lib/api/schema.ts
git commit -m "Engine routes: list with monthly cost, turn on with schedules, turn off, remove"
```

---

### Task 7: Prompt routes: add, read, list, change, archive

`GET/POST {P}/prompts`, `GET/PATCH/DELETE {P}/prompts/{prompt_id}`.

**Files:**
- Create: `backend/src/idraft/api/ai/prompt_repository.py`, `prompt_service.py`, `prompt_routes.py`
- Modify: `backend/src/idraft/api/audit.py`, `resources.py`, `main.py`
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Regenerate: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`
- Test: `backend/tests/api/ai/test_prompts.py`

- [ ] **Step 1: Write the failing route tests**

`backend/tests/api/ai/test_prompts.py`:

```python
"""Prompts (docs/19 section 3.7.1; spec 2026-11-11 sections 4.2 and 4.5; plan decisions A2, A3
and A7)."""

from __future__ import annotations

import hashlib
import json
import uuid

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.support import (
    add_prompt,
    added,
    ai_project,
    enable_engine,
    seed_prompts,
    set_prompt_quota,
)
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import attach, member, problem
from tests.api.keywords.support import (
    LOCATION,
    OTHER_LOCATION,
    errors,
    project_url,
    term,
    vocabulary,
)
from tests.conftest import PostgresServer


async def test_an_editor_adds_a_prompt_with_its_first_version(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await add_prompt(
        api,
        workspace,
        project,
        editor,
        "  Best CRM for a 20-person startup?  ",
        intent="commercial",
        importance=5,
    )

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    version = data["current_version"]
    assert (version["version_no"], version["text"], version["change_kind"]) == (
        1,
        "Best CRM for a 20-person startup?",
        "initial",
    )
    assert version["text_hash"] == hashlib.sha256(b"Best CRM for a 20-person startup?").hexdigest()
    assert (
        data["language_code"],
        data["country_iso"],
        data["intent"],
        data["importance"],
        data["is_active"],
        data["is_branded"],
        data["source"],
        data["creation_method"],
        data["terms"],
    ) == ("en", "US", "commercial", 5, True, False, "manual", "human", [])
    assert data["created_by"]["user_id"] == str(editor.user_id)
    entries = await fetch(
        migrated,
        "SELECT action, target_id FROM ops.audit_logs WHERE workspace_id = $1",
        workspace.id,
    )
    assert [(entry["action"], entry["target_id"]) for entry in entries] == [
        ("prompt.created", data["prompt_id"])
    ]


async def test_a_prompt_naming_an_own_brand_is_branded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    for name, role in (("Acme", "own"), ("Rival", "competitor")):
        entity = await fetchrow(
            migrated,
            "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
            "VALUES ($1, 'brand', $2) RETURNING id",
            workspace.id,
            name,
        )
        await attach(migrated, workspace, project, entity["id"], role)

    own = await add_prompt(api, workspace, project, editor, "Is Acme good for startups?")
    rival = await add_prompt(api, workspace, project, editor, "Is Rival good for startups?")

    assert own.json()["data"]["is_branded"] is True
    assert rival.json()["data"]["is_branded"] is False


async def test_the_same_prompt_twice_is_a_duplicate_archived_or_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    first = await added(api, workspace, project, editor, "Which café suits a meeting?")

    again = await add_prompt(api, workspace, project, editor, "Which café suits a meeting?")
    await api.delete(project_url(workspace, project, "prompts", first), headers=editor.headers)
    archived = await add_prompt(api, workspace, project, editor, " Which café suits a meeting? ")
    elsewhere = await add_prompt(
        api, workspace, project, editor, "Which café suits a meeting?", country_iso="GB"
    )
    other_case = await add_prompt(api, workspace, project, editor, "which café suits a meeting?")

    assert problem(again) == problem(archived) == (409, "duplicate")
    assert again.json()["existing_id"] == archived.json()["existing_id"] == first
    assert elsewhere.status_code == other_case.status_code == 201


async def test_a_prompt_is_in_a_country_every_enabled_engine_runs_in(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web", [LOCATION])
    await enable_engine(migrated, workspace, project, "google_ai_mode", [LOCATION, OTHER_LOCATION])

    us = await add_prompt(api, workspace, project, editor, "Best CRM?")
    gb = await add_prompt(api, workspace, project, editor, "Best CRM?", country_iso="GB")
    await execute(
        migrated,
        "UPDATE ai.project_engines SET is_enabled = false WHERE project_id = $1 "
        "AND engine_code = 'chatgpt_web'",
        project,
    )
    gb_again = await add_prompt(api, workspace, project, editor, "Best CRM?", country_iso="GB")

    assert us.status_code == 201, us.text
    assert problem(gb) == (422, "validation_failed")
    assert errors(gb) == [("country_iso", "location_not_supported")]
    assert gb_again.status_code == 201, gb_again.text


async def test_a_prompt_takes_the_terms_the_project_may_use(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    crm = await term(migrated, workspace, topics, "crm")
    pricing = await term(migrated, workspace, topics, "pricing", parent=crm)
    single = await vocabulary(migrated, workspace, single=True)
    one, two = await term(migrated, workspace, single, "a"), await term(migrated, workspace, single, "b")

    tagged = await add_prompt(api, workspace, project, editor, "CRM pricing?", term_ids=[pricing])
    unknown = await add_prompt(
        api, workspace, project, editor, "Other?", term_ids=[str(uuid.uuid4())]
    )
    both = await add_prompt(api, workspace, project, editor, "Both?", term_ids=[one, two])
    under_crm = await api.get(
        project_url(workspace, project, "prompts"),
        params={"filter[term]": crm},
        headers=editor.headers,
    )

    assert tagged.status_code == 201, tagged.text
    assert [entry["path"] for entry in tagged.json()["data"]["terms"]] == ["crm/pricing"]
    assert errors(unknown) == [("term_ids", "term_unknown")]
    assert errors(both) == [("term_ids", "single_valued_vocabulary")]
    assert [row["prompt_id"] for row in under_crm.json()["data"]] == [
        tagged.json()["data"]["prompt_id"]
    ]


async def test_the_workspace_quota_stops_new_and_returning_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 1)

    first = await added(api, workspace, project, editor, "First?")
    over = await add_prompt(api, workspace, project, editor, "Second?")
    await api.delete(project_url(workspace, project, "prompts", first), headers=editor.headers)
    in_its_place = await add_prompt(api, workspace, project, editor, "Third?")
    back = await api.patch(
        project_url(workspace, project, "prompts", first),
        json={"is_active": True},
        headers=editor.headers,
    )

    assert problem(over) == (422, "quota_exceeded")
    assert (over.json()["limit"], over.json()["used"], over.json()["requested"]) == (1, 1, 1)
    assert in_its_place.status_code == 201, in_its_place.text
    assert problem(back) == (422, "quota_exceeded")


async def test_prompts_are_listed_newest_first_with_filters_and_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    analyst = await member(resources, migrated, workspace, "analyst")
    project = await ai_project(migrated, workspace)
    a = await added(api, workspace, project, editor, "Alpha?", intent="commercial")
    b = await added(api, workspace, project, editor, "Beta?", language_code="de")
    c = await added(api, workspace, project, editor, "Gamma?", country_iso="GB")
    url = project_url(workspace, project, "prompts")

    async def ids(**params: str) -> list[str]:
        response = await api.get(url, params=params, headers=analyst.headers)
        assert response.status_code == 200, response.text
        return [row["prompt_id"] for row in response.json()["data"]]

    first = await api.get(url, params={"limit": "2"}, headers=analyst.headers)
    page = first.json()["page"]
    rest = await api.get(
        url, params={"limit": "2", "cursor": page["next_cursor"]}, headers=analyst.headers
    )
    crossed = await api.get(
        url,
        params={"limit": "2", "cursor": page["next_cursor"], "filter[language_code]": "de"},
        headers=analyst.headers,
    )
    unknown = await api.get(url, params={"filter[panel]": "core"}, headers=analyst.headers)

    assert [row["prompt_id"] for row in first.json()["data"]] == [c, b]
    assert page["has_more"] is True
    assert [row["prompt_id"] for row in rest.json()["data"]] == [a]
    assert rest.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False}
    assert problem(crossed) == (400, "invalid_cursor")
    assert problem(unknown) == (422, "validation_failed")
    assert await ids(**{"filter[intent_in]": "commercial,local"}) == [a]
    assert await ids(**{"filter[language_code]": "de"}) == [b]
    assert await ids(**{"filter[country_iso]": "GB"}) == [c]
    assert await ids(**{"filter[q]": "BET"}) == [b]
    await api.delete(project_url(workspace, project, "prompts", a), headers=editor.headers)
    assert await ids() == [c, b]
    assert await ids(**{"filter[is_active]": "false"}) == [a]


async def test_a_prompt_is_read_within_its_project_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    other = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    own = await api.get(project_url(workspace, project, "prompts", prompt_id), headers=viewer.headers)
    elsewhere = await api.get(
        project_url(workspace, other, "prompts", prompt_id), headers=viewer.headers
    )

    assert own.status_code == 200, own.text
    assert own.json()["data"]["current_version"]["text"] == "prompt 1"
    assert problem(elsewhere) == (404, "not_found")


async def test_a_change_touches_the_metadata_and_never_the_text(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Best CRM?")
    url = project_url(workspace, project, "prompts", prompt_id)

    changed = await api.patch(
        url, json={"importance": 1, "intent": "commercial", "is_branded": True}, headers=editor.headers
    )
    text = await api.patch(url, json={"text": "Better CRM?"}, headers=editor.headers)

    assert changed.status_code == 200, changed.text
    data = changed.json()["data"]
    assert (data["importance"], data["intent"], data["is_branded"]) == (1, "commercial", True)
    assert data["updated_at"] > data["created_at"]
    assert errors(text) == [("text", "immutable_field")]
    (entry,) = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.updated'",
        workspace.id,
    )
    assert (json.loads(entry["before"])["importance"], json.loads(entry["after"])["importance"]) == (
        3,
        1,
    )


async def test_archiving_keeps_the_prompt_and_says_so_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Best CRM?")
    url = project_url(workspace, project, "prompts", prompt_id)

    first = await api.delete(url, headers=editor.headers)
    again = await api.delete(url, headers=editor.headers)
    kept = await api.get(url, headers=editor.headers)

    assert first.status_code == again.status_code == 204
    assert kept.json()["data"]["is_active"] is False
    archived = await fetch(
        migrated,
        "SELECT id FROM ops.audit_logs WHERE workspace_id = $1 AND action = 'prompt.archived'",
        workspace.id,
    )
    assert len(archived) == 1


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_only_a_prompt_writer_changes_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)

    create = await add_prompt(api, workspace, project, caller, "Best CRM?")
    change = await api.patch(url, json={"importance": 1}, headers=caller.headers)
    archive = await api.delete(url, headers=caller.headers)

    assert problem(create) == problem(change) == problem(archive) == (403, "forbidden")
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/ai/test_prompts.py -q`
Expected: failures with `404` responses (no route yet).

- [ ] **Step 3: Write the repository**

`backend/src/idraft/api/ai/prompt_repository.py`:

```python
"""Reads and writes of prompts, their versions and their terms (docs/04-data-model.md section
8.2).

Runs in the caller's transaction as the API role; every statement names the workspace. A prompt
is shown with its current version, in slice 1 the first and only one.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Row, Select, and_, delete, func, insert, literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.keywords.repository import UserRecord
from idraft.db.tables import (
    ai_prompt_terms,
    ai_prompt_versions,
    ai_prompts,
    projects,
    taxonomy_terms,
    users,
    workspace_quotas,
)
from idraft.domain.ai_engines import BASE_PLAN
from idraft.keywords.links import TermRecord, term_record, terms_query
from idraft.keywords.trees import among_ids, descendants

# Rows per insert: 14 values a prompt row stays far under the 32,767 parameters of a statement.
INSERT_MAX = 1000
# Term links per insert: three values each.
_TERM_ROWS_MAX = 5000


@dataclass(frozen=True, slots=True)
class VersionRecord:
    id: UUID
    version_no: int
    text: str
    text_hash: bytes
    change_kind: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PromptRecord:
    id: UUID
    current_version: VersionRecord
    language_code: str
    country_iso: str | None
    intent: str
    funnel_stage: str
    prompt_type: str
    importance: int
    is_branded: bool
    source: str
    creation_method: str
    is_active: bool
    created_by: UserRecord | None
    created_at: datetime
    updated_at: datetime
    terms: list[TermRecord]


@dataclass(frozen=True, slots=True)
class PromptFilter:
    q: str | None = None
    # The term or one under it.
    term: UUID | None = None
    intents: frozenset[str] = frozenset()
    country_iso: str | None = None
    language_code: str | None = None
    is_active: bool | None = True


@dataclass(frozen=True, slots=True)
class NewPrompt:
    """One prompt to write; the caller has checked it."""

    text: str
    text_hash: bytes
    language_code: str
    country_iso: str
    intent: str
    funnel_stage: str
    prompt_type: str
    importance: int
    is_branded: bool
    term_ids: tuple[UUID, ...]


# What makes two prompts of a project one (plan decision A2).
type PromptKey = tuple[bytes, str, str | None]  # text hash, language, country


def _contains(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _current_version() -> Any:
    return and_(
        ai_prompt_versions.c.id == ai_prompts.c.current_version_id,
        ai_prompt_versions.c.workspace_id == ai_prompts.c.workspace_id,
    )


def _prompts(workspace_id: UUID, project_id: UUID) -> Select[tuple[object, ...]]:
    p, v = ai_prompts.c, ai_prompt_versions.c
    return (
        select(
            p.id,
            p.language_code,
            p.country_iso,
            p.intent,
            p.funnel_stage,
            p.prompt_type,
            p.importance,
            p.is_branded,
            p.source,
            p.creation_method,
            p.is_active,
            p.created_at,
            p.updated_at,
            v.id.label("version_id"),
            v.version_no,
            v.text,
            v.text_hash,
            v.change_kind,
            v.created_at.label("version_created_at"),
            users.c.id.label("user_id"),
            users.c.name.label("user_name"),
            users.c.email.label("user_email"),
        )
        .select_from(
            ai_prompts.join(ai_prompt_versions, _current_version()).outerjoin(
                users, users.c.id == p.created_by
            )
        )
        .where(p.workspace_id == workspace_id, p.project_id == project_id, p.deleted_at.is_(None))
    )


def _record(row: Row[Any], terms: Mapping[UUID, list[TermRecord]]) -> PromptRecord:
    return PromptRecord(
        id=row.id,
        current_version=VersionRecord(
            id=row.version_id,
            version_no=row.version_no,
            text=row.text,
            text_hash=bytes(row.text_hash),
            change_kind=row.change_kind,
            created_at=row.version_created_at,
        ),
        language_code=row.language_code,
        country_iso=row.country_iso,
        intent=row.intent,
        funnel_stage=row.funnel_stage,
        prompt_type=row.prompt_type,
        importance=row.importance,
        is_branded=row.is_branded,
        source=row.source,
        creation_method=row.creation_method,
        is_active=row.is_active,
        created_by=None
        if row.user_id is None
        else UserRecord(user_id=row.user_id, name=row.user_name, email=row.user_email),
        created_at=row.created_at,
        updated_at=row.updated_at,
        terms=list(terms.get(row.id, [])),
    )


async def terms_of(
    db: AsyncSession, workspace_id: UUID, prompt_ids: Collection[UUID]
) -> dict[UUID, list[TermRecord]]:
    """Each prompt's terms, in path order."""
    if not prompt_ids:
        return {}
    rows = await db.execute(
        terms_query()
        .add_columns(ai_prompt_terms.c.prompt_id)
        .join(
            ai_prompt_terms,
            and_(
                ai_prompt_terms.c.term_id == taxonomy_terms.c.id,
                ai_prompt_terms.c.workspace_id == taxonomy_terms.c.workspace_id,
            ),
        )
        .where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            among_ids(ai_prompt_terms.c.prompt_id, prompt_ids),
        )
        .order_by(taxonomy_terms.c.path, taxonomy_terms.c.id)
    )
    found: defaultdict[UUID, list[TermRecord]] = defaultdict(list)
    for row in rows:
        found[row.prompt_id].append(term_record(row))
    return dict(found)


async def _with_terms(
    db: AsyncSession, workspace_id: UUID, rows: Sequence[Row[Any]]
) -> list[PromptRecord]:
    terms = await terms_of(db, workspace_id, [row.id for row in rows])
    return [_record(row, terms) for row in rows]


async def list_prompts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    given: PromptFilter,
    *,
    after: UUID | None,
    limit: int,
) -> list[PromptRecord]:
    """Newest first: prompt ids are time-ordered (`uuidv7()`)."""
    p, v = ai_prompts.c, ai_prompt_versions.c
    statement = _prompts(workspace_id, project_id)
    if given.q is not None:
        statement = statement.where(v.text.ilike(_contains(given.q), escape="\\"))
    if given.term is not None:
        tagged = select(ai_prompt_terms.c.prompt_id).where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            ai_prompt_terms.c.term_id.in_(
                descendants("term", [given.term], workspace_id, "term_tree")
            ),
        )
        statement = statement.where(p.id.in_(tagged))
    if given.intents:
        statement = statement.where(p.intent.in_(sorted(given.intents)))
    if given.country_iso is not None:
        statement = statement.where(p.country_iso == given.country_iso)
    if given.language_code is not None:
        statement = statement.where(p.language_code == given.language_code)
    if given.is_active is not None:
        statement = statement.where(p.is_active == given.is_active)
    if after is not None:
        statement = statement.where(p.id < after)
    rows = (await db.execute(statement.order_by(p.id.desc()).limit(limit))).all()
    return await _with_terms(db, workspace_id, rows)


async def prompts_by_ids(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, ids: Sequence[UUID]
) -> list[PromptRecord]:
    """The project's prompts with these ids, in the order of `ids`."""
    if not ids:
        return []
    statement = _prompts(workspace_id, project_id).where(among_ids(ai_prompts.c.id, ids))
    rows = (await db.execute(statement)).all()
    by_id = {record.id: record for record in await _with_terms(db, workspace_id, rows)}
    return [by_id[prompt_id] for prompt_id in ids if prompt_id in by_id]


async def get_prompt(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_id: UUID, *, lock: bool = False
) -> PromptRecord | None:
    """With `lock`, the prompt row is held (FOR NO KEY UPDATE) until the transaction ends."""
    statement = _prompts(workspace_id, project_id).where(ai_prompts.c.id == prompt_id)
    if lock:
        statement = statement.with_for_update(of=ai_prompts, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    if row is None:
        return None
    (record,) = await _with_terms(db, workspace_id, [row])
    return record


async def lock_prompt_writes(db: AsyncSession, workspace_id: UUID) -> None:
    """Prompt writers of one workspace take turns until the transaction ends, so the quota count
    and the duplicate check of one write are never overtaken by another (plan decision A2)."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(func.hashtextextended(literal(f"prompts:{workspace_id}"), 0))
        )
    )


async def quota_usage(db: AsyncSession, workspace_id: UUID) -> tuple[int, int]:
    """The workspace's active prompt limit and its active prompts. Without a quota row the limit
    is the base plan's. A deleted project's prompts do not count; an archived project's do, so
    bringing a project back never takes the workspace over its limit."""
    stored: int | None = (
        await db.execute(
            select(workspace_quotas.c.max_active_prompts).where(
                workspace_quotas.c.workspace_id == workspace_id
            )
        )
    ).scalar_one_or_none()
    limit = BASE_PLAN.max_prompts if stored is None else stored
    used: int = (
        await db.execute(
            select(func.count())
            .select_from(
                ai_prompts.join(
                    projects,
                    and_(
                        projects.c.id == ai_prompts.c.project_id,
                        projects.c.workspace_id == ai_prompts.c.workspace_id,
                    ),
                )
            )
            .where(
                ai_prompts.c.workspace_id == workspace_id,
                ai_prompts.c.is_active,
                ai_prompts.c.deleted_at.is_(None),
                projects.c.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    return limit, used


async def existing(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, keys: Collection[PromptKey]
) -> dict[PromptKey, UUID]:
    """The project's prompts, archived ones too, with one of these identities."""
    if not keys:
        return {}
    p, v = ai_prompts.c, ai_prompt_versions.c
    rows = await db.execute(
        select(p.id, v.text_hash, p.language_code, p.country_iso)
        .select_from(ai_prompts.join(ai_prompt_versions, _current_version()))
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.deleted_at.is_(None),
            v.workspace_id == workspace_id,
            v.text_hash.in_(sorted({key[0] for key in keys})),
        )
    )
    wanted = set(keys)
    found: dict[PromptKey, UUID] = {}
    for row in rows:
        key: PromptKey = (bytes(row.text_hash), row.language_code, row.country_iso)
        if key in wanted:
            found[key] = row.id
    return found


async def insert_prompts(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    items: Sequence[NewPrompt],
    created_by: UUID,
    now: datetime,
) -> list[UUID]:
    """Each prompt with its first version (`change_kind = 'initial'`) and its terms, in the
    order given. Ids are drawn from the database's `uuidv7()` first, so a prompt names its
    version before the version is written; the key between them is checked at commit."""
    if not items:
        return []
    drawn = await db.execute(
        select(func.uuidv7()).select_from(func.generate_series(1, 2 * len(items)))
    )
    ids: list[UUID] = list(drawn.scalars())
    prompt_ids, version_ids = ids[: len(items)], ids[len(items) :]
    for start in range(0, len(items), INSERT_MAX):
        chunk = range(start, min(start + INSERT_MAX, len(items)))
        await db.execute(
            insert(ai_prompts).values(
                [
                    {
                        "id": prompt_ids[index],
                        "workspace_id": workspace_id,
                        "project_id": project_id,
                        "current_version_id": version_ids[index],
                        "language_code": items[index].language_code,
                        "country_iso": items[index].country_iso,
                        "intent": items[index].intent,
                        "funnel_stage": items[index].funnel_stage,
                        "prompt_type": items[index].prompt_type,
                        "importance": items[index].importance,
                        "is_branded": items[index].is_branded,
                        "created_by": created_by,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for index in chunk
                ]
            )
        )
        await db.execute(
            insert(ai_prompt_versions).values(
                [
                    {
                        "id": version_ids[index],
                        "workspace_id": workspace_id,
                        "prompt_id": prompt_ids[index],
                        "version_no": 1,
                        "text": items[index].text,
                        "text_hash": items[index].text_hash,
                        "created_by": created_by,
                        "created_at": now,
                        "change_kind": "initial",
                    }
                    for index in chunk
                ]
            )
        )
    await add_terms(
        db,
        workspace_id,
        [
            (prompt_ids[index], term_id)
            for index, item in enumerate(items)
            for term_id in item.term_ids
        ],
    )
    return prompt_ids


async def add_terms(
    db: AsyncSession, workspace_id: UUID, pairs: Sequence[tuple[UUID, UUID]]
) -> None:
    """(prompt, term) links; the caller has checked the terms."""
    for start in range(0, len(pairs), _TERM_ROWS_MAX):
        await db.execute(
            insert(ai_prompt_terms).values(
                [
                    {"prompt_id": prompt_id, "term_id": term_id, "workspace_id": workspace_id}
                    for prompt_id, term_id in pairs[start : start + _TERM_ROWS_MAX]
                ]
            )
        )


async def replace_terms(
    db: AsyncSession, workspace_id: UUID, prompt_id: UUID, term_ids: Sequence[UUID]
) -> None:
    await db.execute(
        delete(ai_prompt_terms).where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            ai_prompt_terms.c.prompt_id == prompt_id,
        )
    )
    await add_terms(db, workspace_id, [(prompt_id, term_id) for term_id in term_ids])


async def update_prompt(
    db: AsyncSession, workspace_id: UUID, prompt_id: UUID, values: Mapping[str, object]
) -> None:
    await db.execute(
        update(ai_prompts)
        .where(ai_prompts.c.workspace_id == workspace_id, ai_prompts.c.id == prompt_id)
        .values(**values)
    )
```

- [ ] **Step 4: Write the service**

`backend/src/idraft/api/ai/prompt_service.py`:

```python
"""Rules for prompts (docs/19-api-specification.md section 3.7.1, cut to slice 1: spec
2026-11-11 sections 4.2 and 4.5).

A prompt's text is fixed once saved; to change one, archive it and add a new one. Its identity
is its composed text (`idraft.ai.text`) with its language and country: the same text twice in a
project is `409 duplicate`, archived prompts included, since they keep their answers (plan
decision A2). Writers of one workspace take a lock first, so the active prompt quota and the
duplicate check hold under concurrent writes. A prompt's country must be one every enabled
engine of the project runs in, so no prompt is saved to be skipped everywhere; a prompt brought
back from the archive is not checked again, and an engine without its country skips it.
`is_branded` is computed from the project's own aliases when a prompt is saved. Every change is
audited in its transaction.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.text import text_hash
from idraft.api import audit
from idraft.api.ai import engine_repository as engines
from idraft.api.ai import prompt_repository as prompts
from idraft.api.ai.engine_service import live_project
from idraft.api.ai.prompt_repository import NewPrompt, PromptFilter, PromptKey, PromptRecord
from idraft.api.entities.project_service import MatcherRules, matcher_rules
from idraft.api.keywords import repository as keywords
from idraft.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import (
    DuplicateError,
    FieldError,
    NotFoundError,
    QuotaExceededError,
    TooManyMatchesError,
    invalid_fields,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai import PromptCreate, PromptPatch
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import ENGINES, EngineCode
from idraft.extraction.aliases import AliasMatcher, MatchResult
from idraft.extraction.aliases import TooManyMatchesError as TooManyHitsError
from idraft.keywords.links import TermRecord

DUPLICATE: Final = "The project has this prompt already, in this language and country."
# What a change may set directly; terms are replaced through their own table.
_COLUMNS: Final = frozenset(
    {"intent", "funnel_stage", "prompt_type", "importance", "is_branded", "is_active"}
)


@dataclass(frozen=True, slots=True)
class PromptPageResult:
    prompts: list[PromptRecord]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class Rejected:
    index: int
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class BulkOutcome:
    created: list[UUID]
    skipped: list[tuple[int, UUID]]
    rejected: list[Rejected]


@dataclass(frozen=True, slots=True)
class Checks:
    """What items are checked against: the terms they name that the project may use, held
    until the transaction ends, and the countries of the project's enabled engines."""

    terms: Mapping[UUID, TermRecord]
    countries: Mapping[EngineCode, set[str]]

    def error(self, item: PromptCreate) -> FieldError | None:
        return term_error(item.term_ids, self.terms) or _country_error(
            item.country_iso, self.countries
        )


def term_error(term_ids: Sequence[UUID], usable: Mapping[UUID, TermRecord]) -> FieldError | None:
    if set(term_ids) - usable.keys():
        return FieldError("term_ids", "term_unknown", "A term the project cannot use.")
    per_vocabulary = Counter(
        usable[term_id].vocabulary_id
        for term_id in set(term_ids)
        if usable[term_id].is_single_valued
    )
    if any(count > 1 for count in per_vocabulary.values()):
        return FieldError(
            "term_ids", "single_valued_vocabulary", "Two terms of one single-valued vocabulary."
        )
    return None


def _country_error(
    country_iso: str, countries: Mapping[EngineCode, set[str]]
) -> FieldError | None:
    for code in sorted(countries):
        if country_iso not in countries[code]:
            return FieldError(
                "country_iso",
                "location_not_supported",
                f"{ENGINES[code].label} runs in no location of this country. Add one in the "
                "project's engine settings, or turn the engine off.",
            )
    return None


def key_of(item: PromptCreate) -> PromptKey:
    return (text_hash(item.text), item.language_code, item.country_iso)


def quota_error(limit: int, used: int, requested: int) -> QuotaExceededError:
    return QuotaExceededError(
        f"The workspace has {used} of {limit} active prompts; {requested} more do not fit.",
        limit=limit,
        used=used,
        requested=requested,
    )


def own_entities(rules: MatcherRules) -> set[UUID]:
    return {entity.id for entity in rules.entities if entity.role == "own"}


def names_own(result: MatchResult, own: set[UUID]) -> bool:
    return any(
        mention.entity_id in own and mention.status == "accepted" for mention in result.mentions
    )


async def matched(rules: MatcherRules, texts: Sequence[str]) -> list[MatchResult]:
    """Each text matched against the project's aliases. Compiling and matching is CPU work, so
    it runs off the event loop."""

    def run() -> list[MatchResult]:
        matcher = AliasMatcher(rules.rules, rules.aliases)
        return [matcher.match(text) for text in texts]

    try:
        return await asyncio.to_thread(run)
    except TooManyHitsError:
        raise TooManyMatchesError(
            "The aliases match a prompt too many times. Narrow a substring alias."
        ) from None


async def checks_for(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, items: Sequence[PromptCreate]
) -> Checks:
    wanted = {term_id for item in items for term_id in item.term_ids}
    usable = await keywords.project_terms(db, access.workspace_id, project_id, wanted)
    return Checks(
        terms={term.term_id: term for term in usable},
        countries=await engines.enabled_countries(db, access.workspace_id, project_id),
    )


def _snapshot(record: PromptRecord) -> audit.Snapshot:
    return {
        "text": record.current_version.text,
        "language_code": record.language_code,
        "country_iso": record.country_iso,
        "intent": record.intent,
        "funnel_stage": record.funnel_stage,
        "prompt_type": record.prompt_type,
        "importance": record.importance,
        "is_branded": record.is_branded,
        "is_active": record.is_active,
        "term_ids": sorted(str(term.term_id) for term in record.terms),
    }


async def write(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    items: Sequence[PromptCreate],
    info: RequestInfo,
) -> list[PromptRecord]:
    """Checked prompts written with `is_branded` from the project's own aliases, each audited."""
    if not items:
        return []
    rules = await matcher_rules(db, access.workspace_id, project_id)
    own = own_entities(rules)
    results = await matched(rules, [item.text for item in items])
    ids = await prompts.insert_prompts(
        db,
        workspace_id=access.workspace_id,
        project_id=project_id,
        items=[
            NewPrompt(
                text=item.text,
                text_hash=text_hash(item.text),
                language_code=item.language_code,
                country_iso=item.country_iso,
                intent=item.intent,
                funnel_stage=item.funnel_stage,
                prompt_type=item.prompt_type,
                importance=item.importance,
                is_branded=names_own(result, own),
                term_ids=tuple(sorted(set(item.term_ids))),
            )
            for item, result in zip(items, results, strict=True)
        ],
        created_by=access.user_id,
        now=datetime.now(UTC),
    )
    records = await prompts.prompts_by_ids(db, access.workspace_id, project_id, ids)
    await audit.record_each(
        db,
        workspace_id=access.workspace_id,
        actor_id=access.user_id,
        action="prompt.created",
        target_type="prompt",
        info=info,
        entries=[audit.Entry(target_id=record.id, after=_snapshot(record)) for record in records],
    )
    return records


def _scope(project_id: UUID, given: PromptFilter) -> dict[str, object]:
    """What a cursor is bound to: the project and the filters."""
    return {
        "project_id": str(project_id),
        "q": given.q,
        "term": None if given.term is None else str(given.term),
        "intents": sorted(given.intents),
        "country_iso": given.country_iso,
        "language_code": given.language_code,
        "is_active": given.is_active,
    }


def _after(cursor: str, scope: dict[str, object]) -> UUID:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 1 or not isinstance(key[0], str):
        raise invalid_cursor()
    try:
        return UUID(key[0])
    except ValueError:
        raise invalid_cursor() from None


class PromptService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: PromptFilter,
        *,
        cursor: str | None,
        limit: int,
    ) -> PromptPageResult:
        scope = _scope(project_id, given)
        after = None if cursor is None else _after(cursor, scope)
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            found = await prompts.list_prompts(
                db, access.workspace_id, project_id, given, after=after, limit=limit + 1
            )
        shown = found[:limit]
        next_cursor = (
            encode_cursor([str(shown[-1].id)], scope=scope) if len(found) > limit else None
        )
        return PromptPageResult(prompts=shown, next_cursor=next_cursor)

    async def get(self, access: WorkspaceAccess, project_id: UUID, prompt_id: UUID) -> PromptRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            found = await prompts.get_prompt(db, access.workspace_id, project_id, prompt_id)
        if found is None:
            raise NotFoundError
        return found

    async def create(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptCreate, info: RequestInfo
    ) -> PromptRecord:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            await prompts.lock_prompt_writes(db, access.workspace_id)
            checks = await checks_for(db, access, project_id, [body])
            error = checks.error(body)
            if error is not None:
                raise invalid_fields([error])
            key = key_of(body)
            found = await prompts.existing(db, access.workspace_id, project_id, [key])
            if key in found:
                raise DuplicateError(DUPLICATE, existing_id=found[key])
            limit, used = await prompts.quota_usage(db, access.workspace_id)
            if used + 1 > limit:
                raise quota_error(limit, used, 1)
            (created,) = await write(db, access, project_id, [body], info)
        return created

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        prompt_id: UUID,
        body: PromptPatch,
        info: RequestInfo,
    ) -> PromptRecord:
        given = body.model_fields_set
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            current = await prompts.get_prompt(
                db, access.workspace_id, project_id, prompt_id, lock=True
            )
            if current is None:
                raise NotFoundError
            if body.term_ids is not None:
                usable = await keywords.project_terms(
                    db, access.workspace_id, project_id, set(body.term_ids)
                )
                error = term_error(body.term_ids, {term.term_id: term for term in usable})
                if error is not None:
                    raise invalid_fields([error])
                await prompts.replace_terms(
                    db, access.workspace_id, prompt_id, sorted(set(body.term_ids))
                )
            values = {name: getattr(body, name) for name in given & _COLUMNS}
            if values.get("is_active") is True and not current.is_active:
                await prompts.lock_prompt_writes(db, access.workspace_id)
                limit, used = await prompts.quota_usage(db, access.workspace_id)
                if used + 1 > limit:
                    raise quota_error(limit, used, 1)
            if values:
                await prompts.update_prompt(
                    db, access.workspace_id, prompt_id, {**values, "updated_at": datetime.now(UTC)}
                )
            updated = await prompts.get_prompt(db, access.workspace_id, project_id, prompt_id)
            if updated is None:  # pragma: no cover - read in this transaction
                raise NotFoundError
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.updated",
                target_type="prompt",
                target_id=prompt_id,
                info=info,
                before=_snapshot(current),
                after=_snapshot(updated),
            )
        return updated

    async def archive(
        self, access: WorkspaceAccess, project_id: UUID, prompt_id: UUID, info: RequestInfo
    ) -> None:
        """The prompt stops being asked and keeps its answers (plan decision A7). Archiving an
        archived prompt changes nothing."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            current = await prompts.get_prompt(
                db, access.workspace_id, project_id, prompt_id, lock=True
            )
            if current is None:
                raise NotFoundError
            if not current.is_active:
                return
            await prompts.update_prompt(
                db,
                access.workspace_id,
                prompt_id,
                {"is_active": False, "updated_at": datetime.now(UTC)},
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.archived",
                target_type="prompt",
                target_id=prompt_id,
                info=info,
                before={"is_active": True},
                after={"is_active": False},
            )
```

`BulkOutcome`, `Rejected`, `Checks.error`, `key_of`, `quota_error`, `own_entities`, `names_own`, `matched` and `write` are public because task 8 adds `bulk_create` and `lint` to this class and uses them.

- [ ] **Step 5: Write the routes**

`backend/src/idraft/api/ai/prompt_routes.py`:

```python
"""Prompts (docs/19-api-specification.md section 3.7.1, cut to slice 1; the "As built" note
there lists what is left out).

Reading needs `data:read`; adding, changing and archiving need `prompts:write`. The membership
dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.ai.prompt_repository import PromptFilter, PromptRecord
from idraft.api.ai.prompt_service import PromptService
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import CountryIso, Prompt, PromptCreate, PromptPage, PromptPatch, PromptResponse
from idraft.api.schemas.common import LanguageCode, QueryText
from idraft.api.schemas.keywords import Intent
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts", tags=["ai"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WritePrompts = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROMPTS_WRITE))]


def get_prompt_service(resources: Annotated[Resources, Depends(get_resources)]) -> PromptService:
    return resources.prompts


Prompts = Annotated[PromptService, Depends(get_prompt_service)]


def prompt_view(record: PromptRecord) -> Prompt:
    version = record.current_version
    return Prompt.model_validate(
        {
            "prompt_id": record.id,
            "current_version": {
                "prompt_version_id": version.id,
                "version_no": version.version_no,
                "text": version.text,
                "text_hash": version.text_hash.hex(),
                "change_kind": version.change_kind,
                "created_at": version.created_at,
            },
            "language_code": record.language_code,
            "country_iso": record.country_iso,
            "intent": record.intent,
            "funnel_stage": record.funnel_stage,
            "prompt_type": record.prompt_type,
            "importance": record.importance,
            "is_branded": record.is_branded,
            "source": record.source,
            "creation_method": record.creation_method,
            "is_active": record.is_active,
            "terms": [
                {
                    "term_id": term.term_id,
                    "vocabulary_kind": term.vocabulary_kind,
                    "name": term.name,
                    "path": term.path,
                }
                for term in record.terms
            ],
            "created_by": None
            if record.created_by is None
            else {
                "user_id": record.created_by.user_id,
                "name": record.created_by.name,
                "email": record.created_by.email,
            },
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }
    )


@router.get(
    "",
    summary="The project's prompts",
    description="Newest first. `filter[is_active]` is true when left out; archived prompts are "
    "listed with false. `filter[term]` takes the term or one under it, `filter[q]` matches the "
    "text as a substring without case, and `filter[intent_in]` takes a comma list. A cursor is "
    "bound to its filters (`400 invalid_cursor` otherwise).",
)
async def list_prompts(
    project_id: UUID,
    access: ReadData,
    page: Cursor,
    prompts: Prompts,
    q: Annotated[QueryText | None, Query(alias="filter[q]")] = None,
    term: Annotated[UUID | None, Query(alias="filter[term]")] = None,
    intent_in: Annotated[list[Intent] | None, Commas, Query(alias="filter[intent_in]")] = None,
    country_iso: Annotated[CountryIso | None, Query(alias="filter[country_iso]")] = None,
    language_code: Annotated[LanguageCode | None, Query(alias="filter[language_code]")] = None,
    is_active: Annotated[bool, Query(alias="filter[is_active]")] = True,
) -> PromptPage:
    given = PromptFilter(
        q=q,
        term=term,
        intents=frozenset(intent_in or ()),
        country_iso=country_iso,
        language_code=language_code,
        is_active=is_active,
    )
    result = await prompts.page(access, project_id, given, cursor=page.cursor, limit=page.limit)
    return PromptPage(
        data=[prompt_view(record) for record in result.prompts],
        page=CursorPageInfo(
            limit=page.limit, next_cursor=result.next_cursor, has_more=result.next_cursor is not None
        ),
    )


@router.post(
    "",
    status_code=201,
    summary="Add a prompt",
    description="`409 duplicate` (with `existing_id`) when the project has the same text in the "
    "same language and country, archived prompts included; `422 quota_exceeded` (with `limit`, "
    "`used` and `requested`) past the workspace's active prompt limit. Field codes: "
    "`prompt_too_long` (over 2,000 characters, the most any engine takes), "
    "`location_not_supported` (`country_iso` has no location of an enabled engine), "
    "`term_unknown` and `single_valued_vocabulary`. `is_branded` is computed from the project's "
    "own aliases.",
)
async def create_prompt(
    project_id: UUID, body: PromptCreate, access: WritePrompts, prompts: Prompts, info: Info
) -> PromptResponse:
    return PromptResponse(data=prompt_view(await prompts.create(access, project_id, body, info)))


@router.get("/{prompt_id}", summary="A prompt")
async def get_prompt(
    project_id: UUID, prompt_id: UUID, access: ReadData, prompts: Prompts
) -> PromptResponse:
    return PromptResponse(data=prompt_view(await prompts.get(access, project_id, prompt_id)))


@router.patch(
    "/{prompt_id}",
    summary="Change a prompt's metadata",
    description="The text, language and country cannot change (`422 validation_failed` with "
    "`immutable_field`): archive the prompt and add a new one. `term_ids` replaces the terms. "
    "`is_active: true` brings an archived prompt back and counts against the quota.",
)
async def update_prompt(
    project_id: UUID,
    prompt_id: UUID,
    body: PromptPatch,
    access: WritePrompts,
    prompts: Prompts,
    info: Info,
) -> PromptResponse:
    record = await prompts.update(access, project_id, prompt_id, body, info)
    return PromptResponse(data=prompt_view(record))


@router.delete(
    "/{prompt_id}",
    status_code=204,
    summary="Archive a prompt; its answers stay",
    description="The prompt is no longer asked. It keeps its row, versions and answers, and "
    "`PATCH is_active: true` brings it back.",
)
async def archive_prompt(
    project_id: UUID, prompt_id: UUID, access: WritePrompts, prompts: Prompts, info: Info
) -> Response:
    await prompts.archive(access, project_id, prompt_id, info)
    return Response(status_code=204)
```

Run `uv run ruff format .` after writing: it wraps the long import line of `idraft.api.schemas.ai`.

- [ ] **Step 6: Wire it**

In `backend/src/idraft/api/audit.py`, add to `AuditAction` after `"project_engine.deleted",`:

```python
    "prompt.created",
    "prompt.updated",
    "prompt.archived",
```

In `backend/src/idraft/api/resources.py`, add the import `from idraft.api.ai.prompt_service import PromptService` and the field after `ai_engines: EngineService`:

```python
    prompts: PromptService
```

In `backend/src/idraft/api/main.py`, add the imports

```python
from idraft.api.ai.prompt_routes import router as prompt_routes_router
from idraft.api.ai.prompt_service import PromptService
```

in `Resources(...)` after `ai_engines=EngineService(sessions=sessions),`:

```python
                prompts=PromptService(sessions=sessions),
```

and after `app.include_router(engine_routes_router)`:

```python
    app.include_router(prompt_routes_router)
```

- [ ] **Step 7: Declare the access and the cross-tenant bodies**

In `backend/tests/api/test_route_access.py`, add to `EXPECTED`:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts"): "prompts:write",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}",
    ): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}",
    ): "prompts:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}",
    ): "prompts:write",
```

and to `PATH_PARAMETERS` after `"engine_code",`:

```python
    # Inside one project, after `{project_id}`: the service reads the prompt within it.
    "prompt_id",
```

In `backend/tests/security/test_cross_tenant.py`:

- import `insert_prompt`: the line `from tests.db.support import seed_rank` becomes `from tests.db.support import insert_prompt, seed_rank` (not `connection`: `_tenant` has a local variable of that name, the Google connection row)
- add to `BODIES`:

```python
    ("POST", _W + "/projects/{project_id}/prompts"): {
        "text": "Planted prompt?",
        "language_code": "en",
        "country_iso": "US",
    },
    ("PATCH", _W + "/projects/{project_id}/prompts/{prompt_id}"): {"importance": 1},
```

- add a field to `Tenant` after `integration_id: uuid.UUID`:

```python
    # A prompt of the project with the term, so changing or archiving it succeeds.
    prompt_id: uuid.UUID
```

- add to `ids()` after `"integration_id": str(self.integration_id),`:

```python
            "prompt_id": str(self.prompt_id),
```

- in `_tenant`, after the `ai.project_engines` insert of task 6, add:

```python
    # The same prompt in both, under the term.
    prompt_db = await asyncpg.connect(pg.url())
    try:
        prompt_id, _ = await insert_prompt(
            prompt_db,
            workspace.id,
            project_id,
            "Which CRM software suits a startup?",
            created_by=owner.id,
        )
    finally:
        await prompt_db.close()
    await execute(
        pg,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        prompt_id,
        term["id"],
        workspace.id,
    )
```

- in the `Tenant(...)` returned by `_tenant`, add `prompt_id=prompt_id,` after `integration_id=integration["id"],`
- add to `_TENANT_ROWS` after `"ai.project_engines": "workspace_id",`:

```python
    "ai.prompts": "workspace_id",
    "ai.prompt_versions": "workspace_id",
    "ai.prompt_terms": "workspace_id",
```

- [ ] **Step 8: Regenerate the contract and the web client**

Run: `uv run python -m idraft.api.openapi > openapi/v1.json`
Run: `cd ../apps/web && pnpm gen:api && pnpm typecheck && cd ../../backend`
Expected: as in task 6.

- [ ] **Step 9: Run the tests and the gate**

Run: `uv run pytest -n 4 --no-cov tests/api/ai tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py -q`
Expected: all pass.
Run the gate commands.

- [ ] **Step 10: Commit**

```bash
git add backend/src/idraft/api/ai/prompt_repository.py backend/src/idraft/api/ai/prompt_service.py \
  backend/src/idraft/api/ai/prompt_routes.py backend/src/idraft/api/audit.py \
  backend/src/idraft/api/resources.py backend/src/idraft/api/main.py \
  backend/tests/api/ai/test_prompts.py backend/tests/api/test_route_access.py \
  backend/tests/security/test_cross_tenant.py backend/openapi/v1.json apps/web/src/lib/api/schema.ts
git commit -m "Prompt routes: add, read, list, change metadata, archive"
```

---

### Task 8: Prompt routes: bulk create and lint

`POST {P}/prompts/bulk-create` and `POST {P}/prompts/lint`.

**Files:**
- Modify: `backend/src/idraft/api/ai/prompt_service.py` (two methods and the lint types)
- Modify: `backend/src/idraft/api/ai/prompt_routes.py` (two routes)
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/security/test_cross_tenant.py`
- Regenerate: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`
- Test: `backend/tests/api/ai/test_prompt_bulk.py`, `backend/tests/api/ai/test_prompt_lint.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/ai/test_prompt_bulk.py`:

```python
"""Adding a pasted list of prompts (docs/19 section 3.7.1; plan decision A3: the base plan)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.ai.support import added, ai_project, prompt_body
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url, term, vocabulary
from tests.conftest import PostgresServer


async def test_a_pasted_list_is_added_with_what_it_skipped_and_rejected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    crm = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    known = await added(api, workspace, project, editor, "Known?")

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={
            "items": [
                prompt_body("New one?", term_ids=[crm]),
                prompt_body("Known?"),
                prompt_body("New one?"),
                prompt_body("Bad term?", term_ids=[str(uuid.uuid4())]),
                prompt_body("Other?"),
            ]
        },
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["created"]) == 2
    assert data["skipped"] == [{"index": 1, "existing_id": known}]
    assert [(row["index"], row["code"]) for row in data["rejected"]] == [
        (2, "duplicate_in_request"),
        (3, "term_unknown"),
    ]
    rows = await fetch(
        migrated,
        "SELECT v.text FROM ai.prompts p JOIN ai.prompt_versions v ON v.id = p.current_version_id "
        "WHERE p.project_id = $1 ORDER BY p.id",
        project,
    )
    assert [row["text"] for row in rows] == ["Known?", "New one?", "Other?"]
    created = await fetch(
        migrated,
        "SELECT target_id FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.created'",
        workspace.id,
    )
    assert len(created) == 3


async def test_a_duplicate_is_an_error_when_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await added(api, workspace, project, editor, "Known?")

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body("Known?")], "on_duplicate": "error"},
        headers=editor.headers,
    )

    data = response.json()["data"]
    assert (data["created"], data["skipped"]) == ([], [])
    assert [(row["index"], row["code"]) for row in data["rejected"]] == [(0, "duplicate")]


async def test_the_base_plan_holds_150_active_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Full capacity: a workspace without a quota row and one with the default row both stop at
    the base plan's 150 active prompts."""
    without_row = await make_workspace(migrated)
    with_row = await make_workspace(migrated)
    await execute(
        migrated, "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", with_row.id
    )
    items = [prompt_body(f"Prompt {index}?") for index in range(BASE_PLAN.max_prompts)]
    results = []
    for workspace in (without_row, with_row):
        editor = await member(resources, migrated, workspace, "editor")
        project = await ai_project(migrated, workspace)
        url = project_url(workspace, project, "prompts")
        full = await api.post(f"{url}/bulk-create", json={"items": items}, headers=editor.headers)
        one_more = await api.post(url, json=prompt_body("One more?"), headers=editor.headers)
        results.append((full, one_more))

    for full, one_more in results:
        assert full.status_code == 200, full.text
        assert len(full.json()["data"]["created"]) == 150
        assert problem(one_more) == (422, "quota_exceeded")
        assert (one_more.json()["limit"], one_more.json()["used"]) == (150, 150)


async def test_a_list_over_the_quota_writes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    items = [prompt_body(f"Prompt {index}?") for index in range(BASE_PLAN.max_prompts + 1)]

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": items},
        headers=editor.headers,
    )

    assert problem(response) == (422, "quota_exceeded")
    assert (response.json()["used"], response.json()["requested"]) == (0, 151)
    assert await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project) == []


async def test_a_list_takes_up_to_1000_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body(f"P{index}?") for index in range(1001)]},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
```

`backend/tests/api/ai/test_prompt_lint.py`:

```python
"""The prompt lint: own brand names and engine limits, nothing stored (docs/19 section 3.7.1)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.ai.support import ai_project, set_prompt_quota
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import attach, member
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer


async def test_the_lint_finds_own_brand_names_and_counts_against_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 40)
    own = await fetchrow(
        migrated,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', 'Acme') RETURNING id",
        workspace.id,
    )
    await execute(
        migrated,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, 'Acme')",
        workspace.id,
        own["id"],
    )
    await attach(migrated, workspace, project, own["id"], "own")

    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"texts": ["\U0001f642 Is Acme good?", "  Is Rival good?  "]},
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    branded, plain = response.json()["data"]
    assert branded["is_branded"] is True
    assert [(m["entity"]["canonical_name"], m["alias"]) for m in branded["matched_aliases"]] == [
        ("Acme", "Acme")
    ]
    # The emoji is one character and two UTF-16 units: the name starts at unit 6.
    assert [(w["rule"], w["severity"], w["engine_code"], w["span"]) for w in branded["warnings"]] == [
        ("contains_brand_alias", "warning", None, {"start": 6, "end": 10})
    ]
    assert (plain["text"], plain["is_branded"], plain["warnings"]) == ("Is Rival good?", False, [])
    assert response.json()["quota"] == {"limit": 40, "used": 0}
    assert await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project) == []


async def test_the_lint_warns_of_each_engine_a_prompt_is_too_long_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", "lint")

    every = await api.post(url, json={"texts": ["x" * 701, "x" * 2001]}, headers=editor.headers)
    chatgpt = await api.post(
        url, json={"texts": ["x" * 701], "engine_codes": ["chatgpt_web"]}, headers=editor.headers
    )

    assert every.status_code == 200, every.text
    over_mode, over_all = every.json()["data"]
    assert [(w["rule"], w["severity"], w["engine_code"]) for w in over_mode["warnings"]] == [
        ("engine_limit", "warning", "google_ai_mode")
    ]
    assert [(w["severity"], w["engine_code"]) for w in over_all["warnings"]] == [
        ("error", "chatgpt_web"),
        ("error", "gemini_web"),
        ("error", "google_ai_mode"),
    ]
    assert chatgpt.json()["data"][0]["warnings"] == []
```

Note for the first lint test: with a stored alias of the name's own text, that alias stands for the name (`AliasMatcher`, "restated" names), so the text has one span, `Acme` at code points 5 to 9, which is units 6 to 10.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest --no-cov tests/api/ai/test_prompt_bulk.py tests/api/ai/test_prompt_lint.py -q`
Expected: failures with `405 Method Not Allowed` or `404` (no route yet).

- [ ] **Step 3: Add bulk create and the lint to the service**

In `backend/src/idraft/api/ai/prompt_service.py`, extend the imports:

- `from idraft.api.entities.project_repository import MatcherEntity`
- `from idraft.api.entities.project_service import MatcherRules, matcher_rules, to_utf16`
- `from idraft.api.schemas.ai import LintRule, LintSeverity, PromptBulkCreate, PromptCreate, PromptLintRequest, PromptPatch`
- `from idraft.domain.ai_engines import ENGINES, PROMPT_TEXT_MAX, EngineCode`

add these dataclasses after `BulkOutcome`:

```python
@dataclass(frozen=True, slots=True)
class LintedAlias:
    entity: MatcherEntity
    alias: str


@dataclass(frozen=True, slots=True)
class LintNote:
    rule: LintRule
    severity: LintSeverity
    message: str
    engine_code: EngineCode | None
    # UTF-16 code units.
    span: tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class LintedPrompt:
    text: str
    is_branded: bool
    aliases: list[LintedAlias]
    notes: list[LintNote]


@dataclass(frozen=True, slots=True)
class LintOutcome:
    prompts: list[LintedPrompt]
    limit: int
    used: int
```

this function after `matched`:

```python
def _lint(
    text: str,
    result: MatchResult,
    entities: Mapping[UUID, MatcherEntity],
    own: set[UUID],
    codes: Sequence[EngineCode],
) -> LintedPrompt:
    """Own brand names found (each once, with the first place it is named, in UTF-16 units) and
    the engines the text is too long for."""
    shown = to_utf16(result, text)
    aliases: list[LintedAlias] = []
    notes: list[LintNote] = []
    seen: set[tuple[UUID, str]] = set()
    for mention, units in zip(result.mentions, shown.mentions, strict=True):
        if mention.status != "accepted" or mention.entity_id not in own:
            continue
        entity = entities[mention.entity_id]
        for span in mention.spans:
            found = text[span.start : span.end]
            if span.status == "accepted" and (entity.id, found) not in seen:
                seen.add((entity.id, found))
                aliases.append(LintedAlias(entity=entity, alias=found))
        first = next((span for span in units.spans if span.status == "accepted"), units.spans[0])
        notes.append(
            LintNote(
                rule="contains_brand_alias",
                severity="warning",
                message=f"Names {entity.canonical_name}. Answers to a branded prompt are left "
                "out of the rates unless they are asked for.",
                engine_code=None,
                span=(first.start, first.end),
            )
        )
    for code in codes:
        engine = ENGINES[code]
        if engine.fits(text):
            continue
        unsavable = len(text) > PROMPT_TEXT_MAX
        notes.append(
            LintNote(
                rule="engine_limit",
                severity="error" if unsavable else "warning",
                message=f"{engine.label} takes up to {engine.max_prompt_chars} characters; "
                + ("the prompt cannot be saved." if unsavable else "it skips this prompt."),
                engine_code=code,
                span=None,
            )
        )
    return LintedPrompt(
        text=text, is_branded=names_own(result, own), aliases=aliases, notes=notes
    )
```

and these two methods to `PromptService`, after `create`:

```python
    async def bulk_create(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptBulkCreate, info: RequestInfo
    ) -> BulkOutcome:
        """Items that cannot be saved are rejected one by one; the rest are written together,
        all or none: past the quota, nothing is written."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            await prompts.lock_prompt_writes(db, access.workspace_id)
            checks = await checks_for(db, access, project_id, body.items)
            keys = [key_of(item) for item in body.items]
            found = await prompts.existing(db, access.workspace_id, project_id, keys)
            rejected: list[Rejected] = []
            skipped: list[tuple[int, UUID]] = []
            accepted: list[PromptCreate] = []
            first: dict[PromptKey, int] = {}
            for index, (item, key) in enumerate(zip(body.items, keys, strict=True)):
                error = checks.error(item)
                if error is not None:
                    rejected.append(Rejected(index, error.code, error.message))
                elif key in found:
                    if body.on_duplicate == "skip":
                        skipped.append((index, found[key]))
                    else:
                        rejected.append(Rejected(index, "duplicate", DUPLICATE))
                elif key in first:
                    rejected.append(
                        Rejected(
                            index, "duplicate_in_request", f"The same prompt as item {first[key]}."
                        )
                    )
                else:
                    first[key] = index
                    accepted.append(item)
            limit, used = await prompts.quota_usage(db, access.workspace_id)
            if accepted and used + len(accepted) > limit:
                raise quota_error(limit, used, len(accepted))
            created = await write(db, access, project_id, accepted, info)
        return BulkOutcome(
            created=[record.id for record in created], skipped=skipped, rejected=rejected
        )

    async def lint(
        self, access: WorkspaceAccess, project_id: UUID, body: PromptLintRequest
    ) -> LintOutcome:
        """What saving these texts would meet, with nothing stored: own brand names (the
        prompt would be branded) and engine limits, and the workspace's prompt quota."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            rules = await matcher_rules(db, access.workspace_id, project_id)
            limit, used = await prompts.quota_usage(db, access.workspace_id)
        own = own_entities(rules)
        entities = {entity.id: entity for entity in rules.entities}
        codes = body.engine_codes or list(EngineCode)
        results = await matched(rules, body.texts)
        return LintOutcome(
            prompts=[
                _lint(text, result, entities, own, codes)
                for text, result in zip(body.texts, results, strict=True)
            ],
            limit=limit,
            used=used,
        )
```

- [ ] **Step 4: Add the two routes**

In `backend/src/idraft/api/ai/prompt_routes.py`, extend the imports:

- `from idraft.api.ai.prompt_service import LintedPrompt, PromptService`
- `from idraft.api.schemas.ai import (CountryIso, LintSpan, LintWarning, MatchedAlias, Prompt, PromptBulkCreate, PromptBulkResponse, PromptBulkResult, PromptCreate, PromptLint, PromptLintRequest, PromptLintResponse, PromptPage, PromptPatch, PromptQuota, PromptRejected, PromptResponse, PromptSkipped)`
- `from idraft.api.schemas.entities import EntityRef`

and add after `create_prompt` (both routes before `/{prompt_id}`, so the paths read in order):

```python
def _lint_view(item: LintedPrompt) -> PromptLint:
    return PromptLint(
        text=item.text,
        is_branded=item.is_branded,
        matched_aliases=[
            MatchedAlias(
                entity=EntityRef.model_validate(
                    {
                        "entity_id": found.entity.id,
                        "canonical_name": found.entity.canonical_name,
                        "entity_type": found.entity.entity_type,
                        "role": found.entity.role,
                        "color_index": found.entity.color_index,
                    }
                ),
                alias=found.alias,
            )
            for found in item.aliases
        ],
        warnings=[
            LintWarning(
                rule=note.rule,
                severity=note.severity,
                message=note.message,
                engine_code=note.engine_code,
                span=None if note.span is None else LintSpan(start=note.span[0], end=note.span[1]),
            )
            for note in item.notes
        ],
    )


@router.post(
    "/bulk-create",
    summary="Add a list of prompts",
    description="Up to 1,000 items. An item that cannot be saved is rejected with its code "
    "(`location_not_supported`, `term_unknown`, `single_valued_vocabulary`, "
    "`duplicate_in_request` for the same prompt twice in the list, and `duplicate` with "
    "`on_duplicate: error`); with `skip`, a prompt the project has is listed in `skipped`. The "
    "rest are written together: `422 quota_exceeded` past the workspace's active prompt limit, "
    "and nothing is written. No Idempotency-Key: sending the list again skips what it added.",
)
async def bulk_create_prompts(
    project_id: UUID, body: PromptBulkCreate, access: WritePrompts, prompts: Prompts, info: Info
) -> PromptBulkResponse:
    outcome = await prompts.bulk_create(access, project_id, body, info)
    return PromptBulkResponse(
        data=PromptBulkResult(
            created=outcome.created,
            skipped=[
                PromptSkipped(index=index, existing_id=existing_id)
                for index, existing_id in outcome.skipped
            ],
            rejected=[
                PromptRejected(index=entry.index, code=entry.code, message=entry.message)
                for entry in outcome.rejected
            ],
        )
    )


@router.post(
    "/lint",
    summary="Check prompts before saving them",
    description="Nothing is stored. For each text, as it would be saved: whether it names an own "
    "brand (`contains_brand_alias`, with the name's place in UTF-16 code units) and each engine "
    "it is too long for (`engine_limit`: a warning when the engine skips it, an error when it "
    "is too long to save). `quota` is the workspace's active prompt limit and use.",
)
async def lint_prompts(
    project_id: UUID, body: PromptLintRequest, access: ReadData, prompts: Prompts
) -> PromptLintResponse:
    outcome = await prompts.lint(access, project_id, body)
    return PromptLintResponse(
        data=[_lint_view(item) for item in outcome.prompts],
        quota=PromptQuota(limit=outcome.limit, used=outcome.used),
    )
```

- [ ] **Step 5: Declare the access and the cross-tenant bodies**

In `backend/tests/api/test_route_access.py`, add to `EXPECTED`:

```python
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/bulk-create",
    ): "prompts:write",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/lint",
    ): "data:read",
```

In `backend/tests/security/test_cross_tenant.py`, add to `BODIES`:

```python
    ("POST", _W + "/projects/{project_id}/prompts/bulk-create"): {
        "items": [{"text": "Planted prompt?", "language_code": "en", "country_iso": "US"}],
    },
    ("POST", _W + "/projects/{project_id}/prompts/lint"): {"texts": ["Is Acme good?"]},
```

- [ ] **Step 6: Regenerate the contract and the web client**

Run: `uv run python -m idraft.api.openapi > openapi/v1.json`
Run: `cd ../apps/web && pnpm gen:api && pnpm typecheck && cd ../../backend`
Expected: as in task 6.

- [ ] **Step 7: Run the tests and the gate**

Run: `uv run pytest -n 4 --no-cov tests/api/ai tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py -q`
Expected: all pass.
Run the gate commands, then the whole suite once, since three tasks touched shared files: `./check.sh`. Expected: every gate passes and pytest reports coverage at or above 90.

- [ ] **Step 8: Commit**

```bash
git add backend/src/idraft/api/ai/prompt_service.py backend/src/idraft/api/ai/prompt_routes.py \
  backend/tests/api/ai/test_prompt_bulk.py backend/tests/api/ai/test_prompt_lint.py \
  backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py \
  backend/openapi/v1.json apps/web/src/lib/api/schema.ts
git commit -m "Prompt routes: bulk create with rejects and quota, lint for brand names and limits"
```

---

### Task 9: As built notes in docs 19, 04 and 29

**Files:**
- Modify: `docs/19-api-specification.md` (after the code block of section 3.7.1 and after the code block of section 3.7.4)
- Modify: `docs/04-data-model.md` (end of section 8.5, before `### 8.6`)
- Modify: `docs/29-phase-roadmap.md` (under `### Phase 6: AI prompt system`)

- [ ] **Step 1: Doc 19, section 3.7.1**

Insert after the closing fence of the `PromptCreate` code block (before `#### 3.7.2`):

```markdown
**As built (step 8, slice 1, plan A).** Built: `GET/POST {P}/prompts`, `POST {P}/prompts/bulk-create`, `POST {P}/prompts/lint`, `GET/PATCH/DELETE {P}/prompts/{prompt_id}` (plan `docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md`). A prompt's text is trimmed and composed (NFC); its identity is that text's sha256 with its language and country, so the same text twice in a project is `409 duplicate` with `existing_id`, archived prompts included (bring one back with `PATCH is_active: true`). Case and inner spacing count: "Best CRM?" and "best crm?" are two prompts. `country_iso` is required and must be the country of a location of every enabled engine of the project (`422 validation_failed` with `location_not_supported`). Text over 2,000 characters is `prompt_too_long`; a prompt between 701 and 2,000 characters is saved and AI Mode skips it. `is_branded` is computed from the project's own aliases when a prompt is saved; `PATCH` may set it; there is no `is_branded_source`. `DELETE` archives (`is_active = false`, `204`); history stays. The active prompt quota is `core.workspace_quotas.max_active_prompts`, 150 by default for now (the base plan of 2026-11-11), counted across the workspace; `422 quota_exceeded` carries `limit`, `used` and `requested`. `bulk-create` takes up to 1,000 items, rejects items one by one (`location_not_supported`, `term_unknown`, `single_valued_vocabulary`, `duplicate_in_request`, and `duplicate` with `on_duplicate: error`), lists `skipped` duplicates with `existing_id`, and writes the rest together or not at all. `lint` takes `{ texts: string[] (up to 1,000), engine_codes? }` and returns `{ data: PromptLint[], quota: { limit, used } }` with two rules, `contains_brand_alias` (span in UTF-16 code units) and `engine_limit`; `language_code` is not taken. The list sorts newest first and filters by `q`, `term` (the term or one under it), `intent_in`, `country_iso`, `language_code` and `is_active`. Not built in slice 1: the `Idempotency-Key` header (a repeated `bulk-create` skips what it added), panels (`panel_ids`, `panel_reason`, `filter[panel]`, `panel_locked`), keyword links (`keyword_ids`, `generated_from`, `filter[has_keyword_links]`, `from-keywords/preview`), personas and context preambles, `expected_frequency` (the base plan runs every prompt twice a week), `sort` and `include`, `meta.lint` on create, `bulk-update`, `bulk-archive`, versions, restore and timeline. `PATCH` refuses `text`, `language_code` and `country_iso` (`immutable_field`) and takes no `If-Match`. Audit actions: `prompt.created`, `prompt.updated`, `prompt.archived`.
```

- [ ] **Step 2: Doc 19, section 3.7.4**

Insert after the closing fence of the `ProjectEngine` code block (before `#### 3.7.5`):

```markdown
**As built (step 8, slice 1, plan A).** `GET {P}/engines` lists the three slice 1 engines (`chatgpt_web`, `gemini_web`, `google_ai_mode`), configured or not, each with `is_configured`, `active_prompts` (active prompts within the engine's length limit) and `estimated_monthly_cost_usd`: active prompts x runs a week x 52 / 12 x the price book's standard task price, as if the engine were on, null when the book has no price (150 prompts on all three engines is about $4.68 a month). `PUT {P}/engines/{engine_code}` takes `{ location_ids, is_enabled }` only: the provider is `dataforseo`, `replicates` is 1 and `provider_params` is not taken. `location_ids` must be active countries (`422 validation_failed` with `location_not_supported`); the AI providers' own location lists are not synced yet, so a country one of them does not serve fails at collection. Turning an engine on makes the project's two weekly `ai_prompt` schedules (Monday and Thursday, 01:00 project time, 8 hours, standard queue, every active prompt) when it has none; the cron cadence has no rule yet, so twice a week is two schedules. Turning one off keeps its settings and the schedules. `DELETE` removes the settings (`404` when there are none); answers and schedules stay. `engine_inactive` is not raised. Audit actions: `project_engine.updated` and `project_engine.deleted`, on the project.
```

- [ ] **Step 3: Doc 04, section 8**

Insert before `### 8.6 Claims (post-MVP, schema reserved)`:

```markdown
**As built (step 8, slice 1, migration 0018).** The ten tables of sections 8.1 to 8.5 exist without the panels, fan-out and retrieval tables. Every tenant table carries `workspace_id` with the `tenant_isolation` policy, `ai.derivations` and `ai.prompt_terms` included, and keys between tenant tables include it: a prompt's current version is one of its own versions (`(current_version_id, id, workspace_id)`, checked at commit), and answer rows refer to their answer through `(observation_id, observed_at, workspace_id)`. `ai.observations` keeps its raw payload by key and has one answer per task (`observations_one_per_task`). Partitions are monthly on `observed_at` for observations, citations, entity mentions and observation facts. The raw payload of an answer is read through `ai.observation_raw(bigint)`. `core.workspace_quotas.max_active_prompts` defaults to 150 (the base plan of 2026-11-11), not 1,000.
```

- [ ] **Step 4: Doc 29**

Insert directly under the `### Phase 6: AI prompt system` heading:

```markdown
**As built (step 8, slice 1, plan A, 2026-11-11).** The `ai.*` tables of slice 1 (migration 0018), the engine registry and the base plan (150 prompts, twice a week, standard queue, one answer per engine; enforced through the quota row and the schedules until billing exists), the AI answer schedules, and the prompt and engine routes with their OpenAPI contract are built (plan `docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md`). Collection, extraction, the answer and summary routes (plan B) and the screens (plan C) follow. Doc 04 section 8 and doc 19 sections 3.7.1 and 3.7.4 have "As built (step 8, slice 1)" notes.
```

- [ ] **Step 5: Check the prose rule**

Run: `grep -nP '\x{2014}|\x{2013}' docs/19-api-specification.md docs/04-data-model.md docs/29-phase-roadmap.md docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md | grep -i 'as built (step 8' || echo clean`
Expected: `clean` (no em or en dash in the new paragraphs).

- [ ] **Step 6: Commit**

```bash
git add docs/19-api-specification.md docs/04-data-model.md docs/29-phase-roadmap.md
git commit -m "As built notes for AI prompts slice 1, plan A"
```

---

## Notes for plan B

- The planner skips `ai_prompt` schedules until `AiPromptWorkload` is registered (`_next_due` filters on `registry.workloads`). By then a project's schedules may have windows in the past; the planner records the missed ones as cancelled runs (at most 60). Decide in plan B whether to move their `next_run_at` to now when the workload ships, as migration 0013 did for `seo_rank` (review log F72).
- `observations_one_per_task` only makes ingest safe to repeat if `observed_at` is the same on every ingest of a task: take it from the provider's answer (`datetime` of the result), not from the clock.
- Select the planner's prompts with `ai_prompts.is_active`, `deleted_at IS NULL`, the current version's text within `Engine.fits`, and the engine's `location_ids` whose `country_iso` equals the prompt's; record the reason when one is skipped.
- Price estimates: `idraft.ai.pricing.task_prices(db, queue=BASE_PLAN.queue, on=...)`. No live price is in the book: run now uses the standard queue (spec 4.3).
- `ai.observation_raw(bigint)` serves `GET {P}/ai/observations/{id}/raw`.

## Self-review

- **Spec coverage.** Section 7 step 2: task 2 (tables, row-level security, grants, first partitions and their upkeep through `ops.partitioned_tables`, engine seed, prices). Step 3: tasks 5 to 8 write the contract and regenerate `backend/openapi/v1.json` and the web client; the MSW handlers are plan C. Step 4: tasks 6 to 8. Section 4.5 prompt rows: list, create, bulk-create, get, patch (metadata only), delete (archive), lint (brand alias and length per engine). Engine rows: list with `estimated_monthly_cost_usd`, put, delete. Section 5: length limits (A6), quota through `max_active_prompts` (A3), country rejected at save (A5). Section 2: engines off until turned on, weekly spend starts with the first engine (now twice a week per the owner). Section 6, route tests: cross-tenant (tasks 6 to 8), permissions, quota, duplicate, bulk with rejects. The owner's base plan change: `BASE_PLAN` (task 1), quota default and move (task 2), two schedules (task 3), cost formula and the full capacity tests (tasks 6 and 8), the doc 19 line (task 9).
- **Placeholders.** None: every code step holds its code, and every run step its command and expected result.
- **Type consistency.** `EngineCode`, `ENGINES`, `BASE_PLAN.provider_mode`, `monthly_cost`, `ensure_ai_schedule(db, *, workspace_id, project_id, now)`, `task_prices(db, *, queue, on)`, `matcher_rules(db, workspace_id, project_id)`, `live_project(db, access, project_id, *, lock)`, `PromptRecord`, `NewPrompt`, `PromptKey`, `Checks.error`, `quota_error`, `write`, `names_own`, `own_entities`, `matched` are used with the signatures they are defined with. Response field names match the tests (`is_configured`, `active_prompts`, `estimated_monthly_cost_usd`, `existing_id`, `skipped`, `rejected`, `quota`).
