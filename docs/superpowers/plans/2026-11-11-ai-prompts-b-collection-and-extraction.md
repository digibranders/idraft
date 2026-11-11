# AI prompts B: collection, extraction and read routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask ChatGPT, Gemini and Google AI Mode each active prompt once per schedule window through DataForSEO, store every answer with its citations, mentions and fact row, and serve the answers and the per prompt, engine and topic summary to the web app.

**Architecture:** Three DataForSEO task endpoints and one pure normalizer turn a stored provider answer into a `NormalizedAnswer`; a pure extraction module turns that, the project's alias matcher and domain resolver into citation roles, entity mentions and an observation fact; a new `ai_prompt` workload plans and builds the tasks, and an ingest tick writes `ai.observations`, `ai.citations`, `ai.entity_mentions` and `ai.observation_facts` in one transaction per task. Run now, the observation routes and `GET {P}/ai/prompts-summary` sit on the existing run service, raw payload reader and metric conventions.

**Tech Stack:** Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2 (asyncio, asyncpg), PostgreSQL 18 with monthly partitions, Alembic, pytest with testcontainers, ruff, mypy strict, import-linter.

---

## Where this plan sits

- Worktree: `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-prompts`, branch `ai/prompts-slice1`. B = `backend/src/idraft`, BT = `backend/tests`.
- Spec: `docs/superpowers/specs/2026-11-11-ai-prompt-tracking-slice-1-design.md`, section 7 steps 5 to 8.
- Plan A (`docs/superpowers/plans/2026-11-11-ai-prompts-a-*.md`, written in parallel) is built first. Plan C (web) builds the screens from the OpenAPI contract.

### Requirement change from the owner (2026-11-11), applied throughout

The base plan is **150 prompts, run twice a week, standard queue, one answer per engine**. Billing and plans do not exist yet, so plan A keeps it as configuration (`BASE_PLAN`, the twice-a-week schedule on Monday and Thursday, `max_active_prompts` 150). For this plan that means:

- A planner window asks each active prompt once per enabled engine and location; a prompt is never asked twice in one window. The workload reads no cadence and never says "weekly": how often windows come is the schedule's business.
- The prompts summary defaults to a 28 day window, which holds at most about 8 answers per prompt and engine (two a week). Its counts are small whole numbers ("5 of 8").
- A full run at capacity costs 150 prompts x 3 engines x 0.0012 USD = 0.54 USD; twice a week that is about 4.68 USD a month.
- The acceptance runbook (Task 10) runs all 150 Eventus Security prompts in two steps, with the budget check shown before anything is spent.

### Depends on plan A

Plan A is `docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md`; where the two differ, plan A wins for migration 0018, `tables.py` and the prompt and engine schemas. Plan B imports exactly these names from it and nothing else:

| From | Name | What plan B relies on |
|---|---|---|
| `idraft.db.tables` | `ai_engines`, `ai_project_engines`, `ai_prompts`, `ai_prompt_versions`, `ai_prompt_terms`, `ai_observations`, `ai_citations`, `ai_derivations`, `ai_entity_mentions`, `ai_observation_facts` | Columns as doc 04 sections 8.1 to 8.5, plus `workspace_id` on `ai_derivations` and `ai_prompt_terms` (plan A decision A1); keys between AI tenant tables carry `workspace_id`. `ai_entity_mentions.c.evidence_spans` is `ARRAY(INT4RANGE)`; `ai_project_engines.c.location_ids` holds 1 to 50 active `Country` locations. |
| Migration `0018` | unique keys `observations_one_per_task (collection_task_id, observed_at)` and `derivations_identity (project_id, extractor_version, entity_config_version, recommendation_version, sentiment_version)` | Ingest inserts with `ON CONFLICT DO NOTHING` on them. |
| Migration `0018` | function `ai.observation_raw(p_observation_id bigint)`, `EXECUTE` for `app_api` | The raw route (Task 8). Plan B adds no migration. |
| Migration `0018` | grants: worker `SELECT` on the prompt and engine tables and `core.entity_aliases`, `SELECT, INSERT` on the five answer tables; `app_api` `SELECT` on every `ai.*` table; the `ai.engines` seed; the price book rows (`price_unit 'task'`, 0.0012 standard, 0.0024 priority) | Read as they are. |
| `idraft.domain.ai_engines` | `EngineCode`, `ENGINES` (`Engine.endpoint`, `Engine.max_prompt_chars`) | The adapter derives its engine to endpoint map and prompt limits from `ENGINES`, so the two can never disagree. |
| `idraft.ai.pricing` | `task_prices(db, *, queue, on) -> dict[str, Decimal]` | The workload's estimate. |
| `idraft.ai.schedule` | (not imported) `ensure_ai_schedule` writes two weekly schedules, Monday and Thursday, 01:00 project time, 8 hours, `standard_queue`, selector `{"all": true}` | Each schedule's window is one planner window. |
| `idraft.api.schemas.ai` | the module | Plan B appends its models to it. |
| `idraft.api.ai.prompt_routes` | `router` (prefix `/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts`, tag `ai`) | Plan B adds `POST /{prompt_id}/run-now`. |
| `tests.db.support` | `insert_prompt(db, workspace_id, project_id, text, *, language_code="en", country_iso="US", is_active=True, created_by=None) -> tuple[UUID, UUID]` | The collector test helper `add_prompt` wraps it. |
| BT/api/test_route_access.py, BT/security/test_cross_tenant.py | `prompt_id` in `PATH_PARAMETERS`; four `ai.*` tables in `_TENANT_ROWS` (`project_engines`, `prompts`, `prompt_versions`, `prompt_terms`; `ai.engines` is global) | Plan B adds `observation_id`. |

Plan A's archive is `is_active = false`; `deleted_at` stays unused in slice 1 (decision A7). Plan B reads both (`is_active AND deleted_at IS NULL`) so a later delete needs no change.

### Corrections to the brief (found in the code and in plan A)

1. **The entity configuration counter exists.** `core.projects.entity_config_version` (migration 0003, default 1) is bumped by `idraft.api.entities.repository.bump_entity_config` on every entity, alias, domain and role change. No new counter; `ai.derivations` copies it.
2. **No migration in plan B.** The brief's B tasks needed a unique key per task and a raw lookup function; plan A's 0018 has both (`observations_one_per_task`, `ai.observation_raw`).
3. **`observed_at` comes from the answer.** `observations_one_per_task` makes re-ingest idempotent only if `observed_at` is the same on every read: it is the result's `datetime`, and only when the answer has none (a provider error, an unreadable answer) the task's `ready_at`, which the ledger also never changes.
4. **`ledger.FetchedTask` has no run id, engine code, replicate or attempt count.** Ingest reads them from `ops.collection_tasks` by the task's key instead of widening the dataclass.
5. **Registering the workload moves to Task 6**, with the ingest tick: registered alone it would pay for answers nobody reads.
6. **Missed windows on first registration: nothing to move.** The planner skips `ai_prompt` schedules until the workload is registered (plan A, notes for plan B). Plan A and plan B ship in one release from `ai/prompts-slice1`, so no `ai_prompt` schedule exists in production before the workload does, and the runbook (Task 10) turns the first engine on only after the release. The `seo_rank` move of `next_run_at` (0013, review log F72) is not needed; if plan A were ever released alone, the planner records at most 60 missed windows as cancelled runs, which costs nothing.
7. **The worker cannot reuse plan A's `matcher_rules`.** It lives in `idraft.api.entities.project_service`, and the contract "lower layers never import the entrypoints" forbids `idraft.collectors` to import `idraft.api`; the API session also runs under row-level security, the worker's does not. `collectors/ai_context.py` is the worker's copy of the same reads, naming the workspace in every query. Moving the shared reads below the API is a refactor for later.
8. **Location rule is plan A's.** A prompt is asked on an engine at each of the engine's `location_ids` whose `country_iso` is the prompt's (plan A decision A5 and its notes for plan B); a prompt with none is skipped with `location_not_enabled`.
9. **Answer text is the markdown.** Doc 07 section 5.1 renders markdown to plain text "by our markdown pipeline", which does not exist (no markdown library in `pyproject.toml`). Slice 1 stores the markdown as `answer_text` and `answer_markdown` alike; link targets are blanked before alias matching so a cited URL is not a mention. A plain-text renderer later is an extractor version change.
10. **ChatGPT's top-level `markdown` is the items' markdown joined** (checked on the captured fixture), so rebuilding the text from the items that are not ads is exact.
11. **The captured Gemini answer reports `3.5 Flash-Lite` with an ordinary space**; the non-breaking space was in another answer of the spike. A synthetic fixture covers it.
12. **There is no `MetricCell` type.** `MetricValue` carries `window`, `filters`, `method` and more per value, about a megabyte per summary at capacity. Plan B adds a compact `MetricCell` (`value`, `numerator`, `denominator`, `n_observations`) and states the window once per response.
13. **`core.workspace_quotas.max_ai_observations_per_month` exists** (0003, default 20,000), so Run now checks it.
14. **Audit:** Run now records the existing `collection_run.requested` action, as Check now does.
15. **Three private helpers become public** so the AI code reuses them: `serp_parse._scrub` as `scrub_text`, `seo_rank_context._rules` as `domain_rules`, `seo_rank._location_codes` and `_queues` as `location_codes` and `run_queues`; and in the API `ranks.service._event_bounds` as `request_bounds`.
16. **Recorded answers carry a fixed date.** Captured fixtures hold 2026-11-11 and the synthetic ones 2026-11-12; tests move them to now (`at_now`), because only the months around today have partitions.

## Names

Every new module, class and function another plan or task imports. Signatures are exact.

```text
idraft.providers.dataforseo.ai
    CHATGPT_SCRAPER: Final = "ai_optimization/chat_gpt/llm_scraper"
    GEMINI_SCRAPER: Final = "ai_optimization/gemini/llm_scraper"
    AI_MODE: Final = "serp/google/ai_mode"
    ADAPTER_VERSION: Final = 1
    ENGINE_ENDPOINTS: Final[Mapping[str, str]]   # engine code -> ledger endpoint, from ENGINES
    PROMPT_MAX: Final[Mapping[str, int]]          # ledger endpoint -> characters, from ENGINES
    class AiAnswerParams(Contract): prompt: str; location_code: int; language_code: str;
        queue: Literal["standard", "priority"] = "standard"
    def scraper_body(request: CanonicalRequest, tag: str) -> dict[str, object]
    def ai_mode_body(request: CanonicalRequest, tag: str) -> dict[str, object]
    ENDPOINTS: Final[Mapping[str, TaskEndpoint]]

idraft.providers.dataforseo.serp_parse
    def scrub_text(value: Any) -> Any             # renamed from _scrub

idraft.providers.dataforseo.ai_parse
    PARSER_VERSION: Final = 1
    EXTRAS_MAX_BYTES: Final = 16384
    READS_PATHS: Final[tuple[str, ...]]
    AnswerStatus = Literal["complete", "partial", "empty", "refused", "error"]
    CitationKind = Literal["source_list", "inline", "reference_card"]
    class AiSchemaMismatchError(ValueError): def __init__(self, path: str, expected: str); path: str
    @dataclass class CitedSource: raw_url: str; url: CanonicalUrl | None; title: str | None;
        source_name: str | None; kind: CitationKind; occurrences: int; answer_block_index: int | None
    @dataclass class NormalizedAnswer: status; error_code; answer_text; model_reported; check_url;
        observed_at; device; language_code; sources: tuple[CitedSource, ...]; fan_out_count: int;
        provider_extras: Mapping[str, Any] | None; property is_valid -> bool
    def unreadable(code: str, *, observed_at: datetime | None = None) -> NormalizedAnswer
    def parse_ai_answer(engine_code: str, body: bytes | Mapping[str, Any]) -> NormalizedAnswer

idraft.extraction.ai_facts
    EXTRACTOR_VERSION: Final = 1
    @dataclass class SourceIn: url: CanonicalUrl; raw_url: str; kind: str; occurrences: int
    @dataclass class CitationFact: index; url; raw_url; kind; occurrences; domain_role;
        role_entity_id; first_char_offset
    @dataclass class MentionFact: entity_id; role; mention_count; first_char_offset; mention_order;
        prominence: float; evidence_spans: tuple[tuple[int, int], ...]; match_method; status; confidence
    @dataclass class ObservationFact: is_valid; own_mentioned; own_domain_cited; own_mention_order;
        own_prominence; own_citation_count; total_citation_count; tracked_entities_mentioned;
        competitor_mentions: tuple[UUID, ...]; competitor_cited: tuple[UUID, ...]; had_structured_list
    @dataclass class AnswerFacts: citations; mentions; fact
    def extract_answer_facts(text: str | None, sources: Sequence[SourceIn], *, matcher: AliasMatcher,
        resolver: DomainResolver, roles: Mapping[UUID, ProjectRole], is_valid: bool) -> AnswerFacts
    def blank_link_targets(text: str) -> str

idraft.collectors.seo_rank_context
    async def domain_rules(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[DomainRule]

idraft.collectors.ai_context
    @dataclass class AiContext: entity_config_version: int; matcher: AliasMatcher;
        resolver: DomainResolver; roles: Mapping[UUID, ProjectRole]
    async def load_ai_context(db: AsyncSession, *, workspace_id: UUID, project_id: UUID) -> AiContext | None
    class AiContextCache: async def get(self, db: AsyncSession, workspace_id: UUID, project_id: UUID) -> AiContext | None

idraft.collectors.seo_rank
    async def location_codes(db: AsyncSession, location_ids: Collection[int | None]) -> dict[int, int]
    async def run_queues(db: AsyncSession, run_ids: Collection[UUID]) -> dict[UUID, str]

idraft.collectors.ai_prompt
    WORKLOAD: Final = TaskWorkload.AI_PROMPT
    SUBJECT_TYPE: Final = "prompt_version"
    ADAPTER: Final = "dataforseo_ai_answers@1"
    MANUAL_PROMPTS_MAX: Final = 100
    UNSETTLED: Final = ("pending", "submit_unknown", "submitted", "ready", "fetched")
    @dataclass class Subject: prompt_id: UUID; version_id: UUID; engine_code: str; location_id: int
    @dataclass class Skipped: prompt_id: UUID; engine_code: str; reason: SkipReason
    async def select_subjects(db: AsyncSession, window: ScheduleWindow) -> tuple[list[Subject], list[Skipped]]
    def queue_of(provider_mode: str) -> Literal["standard", "priority"]
    async def estimate(db: AsyncSession, subjects: Sequence[Subject], *, queue: str, on: date) -> Decimal | None
    def new_tasks(subjects: Sequence[Subject], window: ScheduleWindow) -> list[NewTask]
    class AiPromptWorkload  (the Workload protocol)

idraft.collectors.ai_prompt_ingest
    WORKLOAD: Final = TaskWorkload.AI_PROMPT
    INGEST_LIMIT: Final = 2000
    SCHEMA_MISMATCH: Final = "schema_mismatch"
    async def ingest(sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = INGEST_LIMIT) -> IngestReport
    async def current_derivation(db: AsyncSession, workspace_id: UUID, project_id: UUID, entity_config_version: int) -> int

idraft.api.ai.run_repository
    @dataclass class RunnablePrompt: prompt_id: UUID; version_id: UUID; text_length: int
    async def runnable_prompt(db, workspace_id: UUID, project_id: UUID, prompt_id: UUID) -> RunnablePrompt | None
    async def enabled_engines(db, workspace_id: UUID, project_id: UUID) -> set[str]
    async def pending_engines(db, workspace_id: UUID, project_id: UUID, prompt: RunnablePrompt, engine_codes: Sequence[str]) -> list[str]
    async def lock_ai_observation_limit(db, workspace_id: UUID) -> int
    async def ai_tasks_since(db, workspace_id: UUID, since: datetime) -> int

idraft.api.operations.runs
    AI_PROMPT: Final = "ai_prompt"
    RunService.ai_run_now(self, access: WorkspaceAccess, project_id: UUID, prompt_id: UUID, body: RunNow, info: RequestInfo) -> RunRecord

idraft.api.ranks.service
    async def read_stored_answer(row: Any, store: ObjectStore | None, what: str) -> bytes
    def request_bounds(start: datetime | date | None, end: datetime | date | None, zone: ZoneInfo) -> tuple[datetime | None, datetime | None]   # renamed from _event_bounds

idraft.api.schemas.ai  (added)
    RunNow, AnswerStatus, Outcome, ObservationFacts, PromptSubject, ObservationSummary,
    ObservationPage, CitationOut, MentionOut, ObservationDetail, ObservationResponse,
    MetricCell, OutcomeCells, EngineSummary, PromptSummaryRow, TopicSummaryRow,
    PromptsSummary, PromptsSummaryResponse

idraft.api.ai.observation_repository
    @dataclass class ObservationFilter; async def list_observations(...); async def get_observation(...);
    async def citations_of(...); async def mentions_of(...); async def raw_payload(...)
idraft.api.ai.observations.ObservationService(*, sessions, raw_store)
    page(access, project_id, given: ObservationFilter, *, start, end, page: CursorParams) -> ObservationPageResult
    detail(access, project_id, observation_id: int, observed_at: datetime | None) -> ObservationDetail
    raw_answer(access, project_id, observation_id: int, observed_at: datetime | None) -> bytes
idraft.api.ai.observation_routes.router      prefix {P}/ai/observations
idraft.api.ai.summary_repository
    @dataclass class Counts; @dataclass class SummaryPrompt; summary_prompts; enabled_engine_codes;
    counts_by_prompt; counts_by_topic; counts_of_prompts; topic_names
idraft.api.ai.summary.SummaryService(*, sessions); SUMMARY_DAYS = 28; SUMMARY_MAX_DAYS = 92
    summary(access, project_id, *, start: date | None, end: date | None, engine_codes: Sequence[str] | None, include_branded: bool) -> PromptsSummary
idraft.api.ai.summary_routes.router          prefix {P}/ai
idraft.api.resources.Resources: ai_observations: ObservationService; ai_summary: SummaryService

tests.collectors.ai_support (test helper)
    @dataclass AiWorld(project, own, rival); @dataclass Prompt(id, version_id)
    make_ai_world(pg) -> AiWorld; add_prompt(pg, project, text, *, country="US", language="en",
        branded=False, active=True) -> Prompt; enable_engine(pg, project, engine_code,
        *, location_ids=(LOCATION,), enabled=True) -> None; at_now(path, when=None) -> bytes;
        chatgpt_answer(text, urls=(), *, when=None) -> bytes;
    fetched_ai_task(sessions, pg, project, prompt, body, store, *, engine_code="chatgpt_web",
        fetched_at=None, cost="0.0012") -> int;
    seed_observation(pg, project, prompt, *, object_key, sha256, engine_code="chatgpt_web") -> int
```

## File map

| File | Task | Responsibility |
|---|---|---|
| B/providers/dataforseo/ai.py | 1 | The three task endpoints, the request contract, the engine to endpoint map |
| B/providers/dataforseo/provider.py | 1 | Registers the three endpoints |
| B/providers/dataforseo/serp_parse.py | 2 | `_scrub` becomes `scrub_text` |
| B/providers/dataforseo/ai_parse.py | 2 | Pure normalizer, version 1 |
| BT/fixtures/dataforseo/ai/*.json, registry.json | 2 | Synthetic answers and the registry of all nine fixtures |
| B/extraction/ai_facts.py | 3 | Pure citation roles, mentions and fact row |
| B/collectors/seo_rank_context.py | 4 | `_rules` becomes `domain_rules` |
| B/collectors/ai_context.py | 4 | Worker-side matcher and resolver per project |
| B/collectors/seo_rank.py | 5 | `_location_codes`, `_queues` become public |
| B/collectors/ai_prompt.py | 5 | The `ai_prompt` workload |
| BT/collectors/ai_support.py | 4 to 9 | Test world, prompts, engines, fetched tasks, seeded observations |
| B/collectors/ai_prompt_ingest.py | 6 | Ingest: observation, citations, derivation, mentions, facts |
| B/worker/assembly.py | 6 | Workload registration and the ingest tick |
| B/api/ai/run_repository.py, B/api/operations/runs.py, B/api/ai/prompt_routes.py | 7 | Run now |
| B/api/ranks/service.py | 8 | `read_stored_answer` shared with the AI raw route |
| B/api/ai/observation_repository.py, observations.py, observation_routes.py | 8 | Observation list, detail, raw |
| B/api/ai/summary_repository.py, summary.py, summary_routes.py | 9 | Prompts summary |
| B/api/schemas/ai.py | 7 to 9 | Request and response models |
| B/api/resources.py, B/api/main.py | 8, 9 | Wiring |
| backend/openapi/v1.json, apps/web/src/lib/api/schema.ts | 7 to 9 | Regenerated contract |
| docs/19, 07, 13, 29, docs/ops/ai-first-run.md | 10 | As built notes and the acceptance runbook |

## Gates every task ends on

Run from `backend/` with the Colima environment set:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run lint-imports
```

Expected: `All checks passed!`, `N files already formatted`, `Success: no issues found in N source files`, `Contracts: 5 kept, 0 broken.` (the count of contracts is whatever `pyproject.toml` holds after plan A; none is broken). Each task names its own pytest command, always with `--no-cov`.

## Task 1: DataForSEO adapters for the three AI endpoints

**Files:**
- Create: `backend/src/idraft/providers/dataforseo/ai.py`
- Modify: `backend/src/idraft/providers/dataforseo/provider.py:38` (import) and `:49` (`ENDPOINTS`)
- Test: `backend/tests/providers/dataforseo/test_ai.py`

The engine to endpoint map and the prompt limits come from plan A's `idraft.domain.ai_engines.ENGINES` (`Engine.endpoint`, `Engine.max_prompt_chars`), so they cannot drift from the prompt lint. The worker passes no `endpoints=` to `DataForSeo`, so an endpoint is reachable only once it is in `provider.ENDPOINTS`. Paths are the ones spike S-04 called (`backend/spikes/s04_ai_engines.py`): `task_post`, `tasks_ready` and `task_get/advanced/{id}` under each base, `id_list` per API.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/providers/dataforseo/test_ai.py`:

```python
"""What an AI answer task asks DataForSEO for, and the adapter sending and fetching one
(docs/07-dataforseo-ai-integration.md sections 2 to 4; spike S-04)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo import ai
from idraft.providers.dataforseo.ai import (
    AI_MODE,
    CHATGPT_SCRAPER,
    ENDPOINTS,
    ENGINE_ENDPOINTS,
    GEMINI_SCRAPER,
    PROMPT_MAX,
    AiAnswerParams,
    ai_mode_body,
    scraper_body,
)
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.provider import ENDPOINTS as REGISTERED
from idraft.providers.dataforseo.provider import DataForSeo
from idraft.providers.dataforseo.serp import SerpOrganicParams
from idraft.providers.dataforseo.tags import make_tag
from tests.providers.dataforseo.support import (
    FIXTURES,
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    as_json,
    envelope,
    task_answer,
)

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")
TAG = "i:test:t:z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11"
PROMPT = "What are the best managed SOC providers in India?"


def _params(**changes: Any) -> AiAnswerParams:
    fields: dict[str, Any] = {"prompt": PROMPT, "location_code": 2356, "language_code": "en"}
    fields.update(changes)
    return AiAnswerParams(**fields)


def _request(params: Contract, task_id: int = 35) -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {
            "task_id": str(task_id),
            "run_id": RUN,
            "attempt": 1,
            "priority": "standard",
            "params": params,
        }
    )


def test_a_scraper_task_asks_for_the_prompt_as_saved() -> None:
    assert scraper_body(_request(_params()), TAG) == {
        "keyword": PROMPT,
        "location_code": 2356,
        "language_code": "en",
        "priority": 1,
        "tag": TAG,
    }


def test_chatgpt_is_asked_as_it_answers() -> None:
    assert "force_web_search" not in scraper_body(_request(_params()), TAG)


def test_an_ai_mode_task_is_a_windows_desktop_search() -> None:
    body = ai_mode_body(_request(_params()), TAG)

    assert (body["device"], body["os"], body["keyword"]) == ("desktop", "windows", PROMPT)


def test_the_priority_queue_is_the_schedules_choice() -> None:
    assert scraper_body(_request(_params(queue="priority")), TAG)["priority"] == 2


def test_a_prompt_too_long_for_ai_mode_is_not_built() -> None:
    long = "x" * (PROMPT_MAX[AI_MODE] + 1)

    assert scraper_body(_request(_params(prompt=long)), TAG)["keyword"] == long
    with pytest.raises(ValueError, match="700"):
        ai_mode_body(_request(_params(prompt=long)), TAG)


@pytest.mark.parametrize("prompt", ["", " padded ", "nul\x00inside", "x" * 2001])
def test_a_prompt_is_trimmed_text_of_at_most_2000_characters(prompt: str) -> None:
    with pytest.raises(ValidationError):
        _params(prompt=prompt)


def test_a_request_of_another_endpoint_is_refused() -> None:
    serp = SerpOrganicParams(keyword="crm", location_code=2840, language_code="en", depth=10)

    with pytest.raises(TypeError):
        scraper_body(_request(serp), TAG)


def test_every_engine_has_a_registered_endpoint_with_its_paths() -> None:
    # The engine facts of plan A name exactly the endpoints this adapter serves.
    assert ENGINE_ENDPOINTS == {
        "chatgpt_web": CHATGPT_SCRAPER,
        "gemini_web": GEMINI_SCRAPER,
        "google_ai_mode": AI_MODE,
    }
    assert PROMPT_MAX == {CHATGPT_SCRAPER: 2000, GEMINI_SCRAPER: 2000, AI_MODE: 700}
    assert {name: REGISTERED[name] for name in ENDPOINTS} == dict(ENDPOINTS)
    assert REGISTERED[CHATGPT_SCRAPER].base == "/v3/ai_optimization/chat_gpt/llm_scraper"
    assert REGISTERED[GEMINI_SCRAPER].id_list == "/v3/ai_optimization/id_list"
    assert REGISTERED[AI_MODE].base == "/v3/serp/google/ai_mode"
    assert REGISTERED[AI_MODE].id_list == "/v3/serp/id_list"
    assert all(endpoint.result == "task_get/advanced" for endpoint in ENDPOINTS.values())
    assert len({endpoint.payload_slug for endpoint in ENDPOINTS.values()}) == 3
    assert ai.ADAPTER_VERSION == 1


@pytest.fixture
async def dataforseo() -> AsyncIterator[tuple[DataForSeo, Api]]:
    events: list[str] = []
    api = Api(events)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield DataForSeo(client, installation="test"), api


@pytest.mark.parametrize(
    ("endpoint", "base"),
    [
        (CHATGPT_SCRAPER, "/v3/ai_optimization/chat_gpt/llm_scraper"),
        (GEMINI_SCRAPER, "/v3/ai_optimization/gemini/llm_scraper"),
        (AI_MODE, "/v3/serp/google/ai_mode"),
    ],
)
async def test_a_task_is_posted_to_its_endpoint_with_its_tag(
    dataforseo: tuple[DataForSeo, Api], endpoint: str, base: str
) -> None:
    provider, api = dataforseo

    def created(request: httpx.Request) -> httpx.Response:
        (task,) = api.posted()
        return as_json(
            envelope(
                [
                    task_answer(
                        status_code=20100,
                        message="Task Created.",
                        task_id="p-1",
                        cost=0.0012,
                        data=task,
                    )
                ]
            )
        )

    api.on("POST", f"{base}/task_post", created)

    result = await provider.submit(endpoint, [_request(_params())])

    assert api.posted()[0]["tag"] == make_tag("test", 35, 1, RUN)
    assert [(task.task_id, task.provider_task_id) for task in result.accepted] == [("35", "p-1")]


async def test_a_chatgpt_answer_is_fetched_as_the_exact_bytes(
    dataforseo: tuple[DataForSeo, Api],
) -> None:
    provider, api = dataforseo
    raw = (FIXTURES / "captured" / "chatgpt_scraper_answer.json").read_bytes()
    task_id = "11110640-2666-0626-0000-62929163309c"
    api.on(
        "GET",
        f"/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/{task_id}",
        lambda _request: httpx.Response(
            200, content=raw, headers={"content-type": "application/json"}
        ),
    )

    result = await provider.fetch(CHATGPT_SCRAPER, task_id)

    assert (result.status, result.body) == ("ready", raw)
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/providers/dataforseo/test_ai.py --no-cov -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'idraft.providers.dataforseo.ai'`.

- [ ] **Step 3: Write the adapter module**

Create `backend/src/idraft/providers/dataforseo/ai.py`:

```python
"""AI answer tasks: the ChatGPT scraper, the Gemini scraper and Google AI Mode
(docs/07-dataforseo-ai-integration.md sections 2 to 4; spike S-04, docs/spikes/S-04.md).

The workload says what to ask; this module turns that into a `task_post` task. The three are all
`task_post` then `task_get/advanced`, so they differ in their paths and in two fields AI Mode
takes: the device and its operating system, a Windows desktop as the spike sent them. ChatGPT is
asked as it answers: `force_web_search` is never sent (doc 07 section 4.2, settled by S-04).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import timedelta
from types import MappingProxyType
from typing import Final, Literal

from pydantic import Field, field_validator

from idraft.domain.ai_engines import ENGINES
from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo.endpoint import TaskBuilder, TaskEndpoint

# The ledger's names for the endpoints, and the price book's.
CHATGPT_SCRAPER: Final = "ai_optimization/chat_gpt/llm_scraper"
GEMINI_SCRAPER: Final = "ai_optimization/gemini/llm_scraper"
AI_MODE: Final = "serp/google/ai_mode"
# Kept on every observation (`adapter_version`): a change to what is asked is a new version.
ADAPTER_VERSION: Final = 1
# The endpoint each engine (`ai.engines.code`) is asked through, and the longest prompt each
# endpoint takes in characters (spec section 5): the engine facts of `domain.ai_engines`, so the
# prompt lint of the API and the planner read the same numbers.
ENGINE_ENDPOINTS: Final[Mapping[str, str]] = MappingProxyType(
    {code.value: engine.endpoint for code, engine in ENGINES.items()}
)
PROMPT_MAX: Final[Mapping[str, int]] = MappingProxyType(
    {engine.endpoint: engine.max_prompt_chars for engine in ENGINES.values()}
)


class AiAnswerParams(Contract):
    prompt: str = Field(min_length=1, max_length=2000)
    location_code: int = Field(ge=1)
    # ISO 639-1, with a region or script where DataForSEO has one, as for SERP tasks.
    language_code: str = Field(pattern=r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")
    # The priority queue costs twice as much; only a schedule that chose it uses it.
    queue: Literal["standard", "priority"] = "standard"

    @field_validator("prompt")
    @classmethod
    def _as_saved(cls, prompt: str) -> str:
        if prompt != prompt.strip() or "\x00" in prompt:
            raise ValueError("a prompt is trimmed text")
        return prompt


def _params(request: CanonicalRequest) -> AiAnswerParams:
    params = request.params
    if not isinstance(params, AiAnswerParams):
        raise TypeError(f"not an AI answer request: {type(params).__name__}")
    return params


def scraper_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    """A ChatGPT or Gemini scraper task: the prompt as saved, sent as `keyword`."""
    params = _params(request)
    return {
        "keyword": params.prompt,
        "location_code": params.location_code,
        "language_code": params.language_code,
        "priority": 2 if params.queue == "priority" else 1,
        "tag": tag,
    }


def ai_mode_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    """An AI Mode task: a scraper task on a Windows desktop, at most 700 characters."""
    prompt = _params(request).prompt
    if len(prompt) > PROMPT_MAX[AI_MODE]:
        raise ValueError(f"AI Mode takes at most {PROMPT_MAX[AI_MODE]} characters")
    return {**scraper_body(request, tag), "device": "desktop", "os": "windows"}


def _endpoint(base: str, build: TaskBuilder, slug: str, id_list: str) -> TaskEndpoint:
    return TaskEndpoint(
        base=base,
        result="task_get/advanced",
        build=build,
        # Standard tasks answered within minutes in S-04; one with no result after 72 hours is
        # given up, as for SERP tasks.
        result_lifetime=timedelta(hours=72),
        payload_slug=slug,
        id_list=id_list,
    )


ENDPOINTS: Final[Mapping[str, TaskEndpoint]] = MappingProxyType(
    {
        CHATGPT_SCRAPER: _endpoint(
            "/v3/ai_optimization/chat_gpt/llm_scraper",
            scraper_body,
            "ai_chat_gpt_llm_scraper_advanced",
            "/v3/ai_optimization/id_list",
        ),
        GEMINI_SCRAPER: _endpoint(
            "/v3/ai_optimization/gemini/llm_scraper",
            scraper_body,
            "ai_gemini_llm_scraper_advanced",
            "/v3/ai_optimization/id_list",
        ),
        AI_MODE: _endpoint(
            "/v3/serp/google/ai_mode",
            ai_mode_body,
            "serp_google_ai_mode_advanced",
            "/v3/serp/id_list",
        ),
    }
)
```

- [ ] **Step 4: Register the endpoints**

In `backend/src/idraft/providers/dataforseo/provider.py` change the import line

```python
from idraft.providers.dataforseo import labs, serp
```

to

```python
from idraft.providers.dataforseo import ai, labs, serp
```

and the registry line

```python
ENDPOINTS: Final[Mapping[str, TaskEndpoint]] = MappingProxyType({serp.SERP_ORGANIC: serp.ENDPOINT})
```

to

```python
ENDPOINTS: Final[Mapping[str, TaskEndpoint]] = MappingProxyType(
    {serp.SERP_ORGANIC: serp.ENDPOINT, **ai.ENDPOINTS}
)
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/providers/dataforseo/ --no-cov -q`
Expected: PASS, every test of the folder (the 15 new ones among them).

- [ ] **Step 6: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/idraft/providers/dataforseo/ai.py backend/src/idraft/providers/dataforseo/provider.py backend/tests/providers/dataforseo/test_ai.py
git commit -m "AI prompts: DataForSEO tasks for the ChatGPT and Gemini scrapers and AI Mode"
```

## Task 2: The AI answer normalizer and its fixtures

**Files:**
- Modify: `backend/src/idraft/providers/dataforseo/serp_parse.py:299-321` (`_scrub` becomes `scrub_text`)
- Create: `backend/src/idraft/providers/dataforseo/ai_parse.py`
- Create: `backend/tests/fixtures/dataforseo/ai/chatgpt_ad.json`, `chatgpt_refused.json`, `chatgpt_empty.json`, `chatgpt_partial.json`, `gemini_nbsp_model.json`, `task_error.json`, `registry.json`
- Test: `backend/tests/providers/dataforseo/test_ai_parse.py`

Rules (doc 07 section 5, applied to what S-04 saw): the text is the markdown of the items that are not ads (`chat_gpt_ad`, `ai_overview_paid`, `paid`); for AI Mode it is the `ai_overview` item's markdown, rebuilt from its elements only when a paid element is among them. Sources come in first-appearance order, one per canonical URL: ChatGPT and Gemini list `sources[]` then the sources the blocks cite (`inline`); AI Mode lists `references[]` (`reference_card`) then the element links (`inline`). `occurrences` counts the blocks that cite a source, at least 1. Status: `error` for a task status of 40000 or more (with the code), `empty` without text, `refused` under 40 characters or with a refusal phrase in the first 200, `partial` for markdown with no blocks behind it, else `complete`. `provider_extras` keeps the check URL, the provider's brand entities, the fan-out queries, the number of search results, the ads and the number of unreadable sources, cut to 16 KB.

The fixtures are one line of JSON each, ending with a newline; `registry.json` records their SHA-256 and schema hash. The registry test checks the schema hash, as `serp/registry.json` does, so a fixture changed in shape without its record fails.

- [ ] **Step 1: Make the scrubber public**

In `backend/src/idraft/providers/dataforseo/serp_parse.py` rename the function `_scrub` (line 299) to `scrub_text`, and its three uses (lines 307, 309 and 321) with it. The body and docstring stay as they are. It now reads:

```python
def scrub_text(value: Any) -> Any:
    """The document with the text the database cannot keep cleaned out: NUL is dropped and a lone
    surrogate becomes `?`, as a replacing UTF-8 encoder writes it."""
    if isinstance(value, str):
        if value.isascii() and "\x00" not in value:
            return value
        return value.replace("\x00", "").encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [scrub_text(element) for element in value]
    if isinstance(value, Mapping):
        return {scrub_text(name): scrub_text(element) for name, element in value.items()}
    return value
```

and in `_document`:

```python
    cleaned: Mapping[str, Any] = scrub_text(body)
```

Run: `cd backend && uv run pytest tests/providers/dataforseo/test_serp_parse.py --no-cov -q`
Expected: PASS (nothing else used the old name).

- [ ] **Step 2: Write the synthetic fixtures**

Create each file with exactly this content (one line, then a newline):

`backend/tests/fixtures/dataforseo/ai/chatgpt_ad.json`
```json
{"version": "0.1.20261103", "status_code": 20000, "status_message": "Ok.", "tasks": [{"id": "11110640-2666-0626-0000-000000000001", "status_code": 20000, "status_message": "Ok.", "cost": 0, "data": {"api": "ai_optimization", "se": "chat_gpt", "keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "device": "desktop", "os": "windows"}, "result": [{"keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "model": "gpt-6", "datetime": "2026-11-12 08:00:00 +00:00", "markdown": "Acme SOC runs a 24x7 security operations centre in Mumbai and Pune.\n\nSponsored: Rival Watch, the SOC that never sleeps.", "sources": [{"type": "chat_gpt_source", "title": "Acme SOC", "domain": "acme-soc.example", "url": "https://acme-soc.example/services?utm_source=chatgpt.com", "source_name": "Acme", "snippet": null, "publication_date": null}], "items": [{"type": "chat_gpt_text", "rank_group": 1, "rank_absolute": 1, "markdown": "Acme SOC runs a 24x7 security operations centre in Mumbai and Pune.\n\n", "sources": [{"type": "chat_gpt_source", "title": "Acme SOC", "domain": "acme-soc.example", "url": "https://acme-soc.example/services?utm_source=chatgpt.com", "source_name": "Acme"}]}, {"type": "chat_gpt_ad", "rank_group": 2, "rank_absolute": 2, "markdown": "Sponsored: Rival Watch, the SOC that never sleeps.", "title": "Rival Watch", "domain": "rival-watch.example", "url": "https://rival-watch.example/offer", "is_rendered": true}], "check_url": "https://chatgpt.com/?prompt=Which%20SOC", "fan_out_queries": ["soc providers india"], "brand_entities": [{"type": "chat_gpt_brand_entity", "title": "Acme SOC", "category": "company", "urls": null}]}]}]}
```

`backend/tests/fixtures/dataforseo/ai/chatgpt_refused.json`
```json
{"version": "0.1.20261103", "status_code": 20000, "status_message": "Ok.", "tasks": [{"id": "11110640-2666-0626-0000-000000000001", "status_code": 20000, "status_message": "Ok.", "cost": 0, "data": {"api": "ai_optimization", "se": "chat_gpt", "keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "device": "desktop", "os": "windows"}, "result": [{"keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "model": "gpt-6", "datetime": "2026-11-12 08:00:00 +00:00", "markdown": "I'm sorry, but I can't help with comparing security vendors for you. Please consult an expert.", "sources": [], "items": [{"type": "chat_gpt_text", "rank_group": 1, "rank_absolute": 1, "markdown": "I'm sorry, but I can't help with comparing security vendors for you. Please consult an expert.", "sources": null}]}]}]}
```

`backend/tests/fixtures/dataforseo/ai/chatgpt_empty.json`
```json
{"version": "0.1.20261103", "status_code": 20000, "status_message": "Ok.", "tasks": [{"id": "11110640-2666-0626-0000-000000000001", "status_code": 20000, "status_message": "Ok.", "cost": 0, "data": {"api": "ai_optimization", "se": "chat_gpt", "keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "device": "desktop", "os": "windows"}, "result": [{"keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "model": "gpt-6", "datetime": "2026-11-12 08:00:00 +00:00", "markdown": null, "sources": null, "items": []}]}]}
```

`backend/tests/fixtures/dataforseo/ai/chatgpt_partial.json`
```json
{"version": "0.1.20261103", "status_code": 20000, "status_message": "Ok.", "tasks": [{"id": "11110640-2666-0626-0000-000000000001", "status_code": 20000, "status_message": "Ok.", "cost": 0, "data": {"api": "ai_optimization", "se": "chat_gpt", "keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "device": "desktop", "os": "windows"}, "result": [{"keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "model": "gpt-6", "datetime": "2026-11-12 08:00:00 +00:00", "markdown": "Acme SOC and Rival Watch both run 24x7 security operations centres in India.", "sources": [], "items": null}]}]}
```

`backend/tests/fixtures/dataforseo/ai/gemini_nbsp_model.json` (the model is written with the JSON escape ` `, not the character)
```json
{"version": "0.1.20261103", "status_code": 20000, "status_message": "Ok.", "tasks": [{"id": "11110640-2666-0626-0000-000000000001", "status_code": 20000, "status_message": "Ok.", "cost": 0, "data": {"api": "ai_optimization", "se": "gemini", "keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "device": "desktop", "os": "windows"}, "result": [{"keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "model": "3.5\u00a0Flash-Lite", "datetime": "2026-11-12 08:00:00 +00:00", "markdown": "Acme SOC is a managed SOC provider in India with a 24x7 operations centre.", "sources": [{"type": "gemini_source", "title": "Acme", "domain": "acme-soc.example", "url": "https://acme-soc.example/", "source_name": "Acme"}], "items": [{"type": "gemini_text", "rank_group": 1, "rank_absolute": 1, "markdown": "Acme SOC is a managed SOC provider in India with a 24x7 operations centre.", "sources": [{"type": "gemini_source", "title": "Acme", "domain": "acme-soc.example", "url": "https://acme-soc.example/#:~:text=Acme", "source_name": "Acme"}, {"type": "gemini_source", "title": "Acme", "domain": "acme-soc.example", "url": "https://acme-soc.example/", "source_name": "Acme"}]}]}]}]}
```

`backend/tests/fixtures/dataforseo/ai/task_error.json`
```json
{"version": "0.1.20261103", "status_code": 20000, "status_message": "Ok.", "tasks": [{"id": "11110640-2666-0626-0000-000000000001", "status_code": 40501, "status_message": "Invalid Field: 'keyword'.", "cost": 0, "data": {"api": "ai_optimization", "se": "chat_gpt", "keyword": "Which SOC provider should I pick?", "location_code": 2356, "language_code": "en", "device": "desktop", "os": "windows"}, "result": null}]}
```

Then the registry, `backend/tests/fixtures/dataforseo/ai/registry.json`. Paths are relative to `backend/tests/fixtures/dataforseo/`; the three captured answers stay where spike S-04 put them.

```json
{
  "endpoint": "ai answers: ai_optimization/chat_gpt/llm_scraper, ai_optimization/gemini/llm_scraper, serp/google/ai_mode (task_get/advanced)",
  "fixtures": [
    {
      "id": "chatgpt_scraper_answer",
      "file": "captured/chatgpt_scraper_answer.json",
      "provider": "dataforseo",
      "captured_at": "2026-11-11",
      "source": "captured",
      "engine_code": "chatgpt_web",
      "status": "complete",
      "sha256": "6cbc0f93be3b7973f0bafaacbcc7220803a65b73162860885b834df7e40b3438",
      "schema_hash": "f6198fde8347361bdd0e65be361a267d9ddba72b37b9ed1fa790b4644efea1ae",
      "tags": ["sources", "search_results", "fan_out", "brand_entities", "tables", "images"]
    },
    {
      "id": "gemini_scraper_answer",
      "file": "captured/gemini_scraper_answer.json",
      "provider": "dataforseo",
      "captured_at": "2026-11-11",
      "source": "captured",
      "engine_code": "gemini_web",
      "status": "complete",
      "sha256": "1814a45bd464f920a3bb0013a75f66b064701a8482882d41bb89ec40c70a49ec",
      "schema_hash": "23103c9d3dd7101e27112ffa0adfe9ea448b3aec98484b8b3a4437ab25e5f35e",
      "tags": ["sources", "duplicate_sources", "text_fragments"]
    },
    {
      "id": "ai_mode_answer",
      "file": "captured/ai_mode_answer.json",
      "provider": "dataforseo",
      "captured_at": "2026-11-11",
      "source": "captured",
      "engine_code": "google_ai_mode",
      "status": "complete",
      "sha256": "f7dee5003a550726b696a59d4135512234126d2a8b2bacc92156395a055c6823",
      "schema_hash": "6205ea94cbf9310a1aa9be6f826481d4f97cbdbd359e29d2f4af0299f3d2dd99",
      "tags": ["references", "element_links"]
    },
    {
      "id": "chatgpt_ad",
      "file": "ai/chatgpt_ad.json",
      "provider": "dataforseo",
      "captured_at": null,
      "source": "synthetic",
      "engine_code": "chatgpt_web",
      "status": "complete",
      "sha256": "d3de87b58970fbe56c5b2846577eec1a54363de768f10898b2121ee9155d8425",
      "schema_hash": "8a82fdfd8799d25b8e62e3d9b1ae8694e1e195a3ef2b2bf036d73e0c64854ed9",
      "tags": ["ads"]
    },
    {
      "id": "chatgpt_refused",
      "file": "ai/chatgpt_refused.json",
      "provider": "dataforseo",
      "captured_at": null,
      "source": "synthetic",
      "engine_code": "chatgpt_web",
      "status": "refused",
      "sha256": "9cfb26092b95f49285ad029ec71ca88493f13d21a99ce6168c27594aa2aff3df",
      "schema_hash": "baa5399f34df688133505590a2e3501d79ef7d3f1c04eb693a8722e196013f48",
      "tags": ["refusal"]
    },
    {
      "id": "chatgpt_empty",
      "file": "ai/chatgpt_empty.json",
      "provider": "dataforseo",
      "captured_at": null,
      "source": "synthetic",
      "engine_code": "chatgpt_web",
      "status": "empty",
      "sha256": "40b972aa14c9cc8ab4796844a33b1bc135f45c0f04edd0cfbb3129bc2281d8e6",
      "schema_hash": "879b652be4094b7dc6dd7aa4ce1e1e2525bfeac8236c9e4b634c085c49a26812",
      "tags": ["empty"]
    },
    {
      "id": "chatgpt_partial",
      "file": "ai/chatgpt_partial.json",
      "provider": "dataforseo",
      "captured_at": null,
      "source": "synthetic",
      "engine_code": "chatgpt_web",
      "status": "partial",
      "sha256": "36843ed2b02803cc2d2f93889050af0c6166ffc6009b7fc99f714a1322bae572",
      "schema_hash": "554c985f2b261d29b11c7291b86d7477f5b2cef99689fc037ad1f76eef3a1557",
      "tags": ["partial"]
    },
    {
      "id": "gemini_nbsp_model",
      "file": "ai/gemini_nbsp_model.json",
      "provider": "dataforseo",
      "captured_at": null,
      "source": "synthetic",
      "engine_code": "gemini_web",
      "status": "complete",
      "sha256": "855d316113b4c0677d1f03d94d7b065d807e14ee660fc4f812ec450ca28cbac9",
      "schema_hash": "61f6e5bdf060ff5a678f4d986cbaa8411a4a4943c587d964b5ef3e02d4fff1bd",
      "tags": ["model_whitespace", "text_fragments"]
    },
    {
      "id": "task_error",
      "file": "ai/task_error.json",
      "provider": "dataforseo",
      "captured_at": null,
      "source": "synthetic",
      "engine_code": "chatgpt_web",
      "status": "error",
      "sha256": "7c70383f4f93fef756b66e431a29dd78daacdd824cefe819ae87844d079ed7ee",
      "schema_hash": "c4657a97a1f782991aa13a2cc681c53107240d93e2f3d111fa09b94a82ebad9f",
      "tags": ["task_error"]
    }
  ]
}
```

Check the hashes against the files you wrote:

Run:
```bash
cd backend && uv run python -c "
import hashlib, json, pathlib
from idraft.providers.dataforseo.schema_hash import schema_hash
root = pathlib.Path('tests/fixtures/dataforseo')
for record in json.loads((root / 'ai/registry.json').read_text())['fixtures']:
    body = (root / record['file']).read_bytes()
    print(record['id'], hashlib.sha256(body).hexdigest() == record['sha256'], schema_hash(json.loads(body)) == record['schema_hash'])
"
```
Expected: nine lines, each ending `True True`. A `False` in the first column means the file's bytes differ from the plan (a missing final newline, an editor reformatting): write it again exactly.

- [ ] **Step 3: Write the failing test**

Create `backend/tests/providers/dataforseo/test_ai_parse.py`:

```python
"""The AI answer normalizer, version 1 (docs/07-dataforseo-ai-integration.md section 5): the three
answers captured in spike S-04 and small synthetic answers for what the spike did not see."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from idraft.providers.dataforseo.ai_parse import (
    EXTRAS_MAX_BYTES,
    READS_PATHS,
    AiSchemaMismatchError,
    NormalizedAnswer,
    parse_ai_answer,
    unreadable,
)
from idraft.providers.dataforseo.schema_hash import reads, schema_hash, schema_paths
from tests.providers.dataforseo.support import FIXTURES

AI = FIXTURES / "ai"
CAPTURED = FIXTURES / "captured"


def _load(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(path.read_text())
    return loaded


def _parse(engine_code: str, path: Path) -> NormalizedAnswer:
    return parse_ai_answer(engine_code, path.read_bytes())


def _answer(result: Any, *, status_code: int = 20000) -> dict[str, Any]:
    return {"status_code": 20000, "tasks": [{"status_code": status_code, "result": result}]}


# The captured answers (S-04, 2026-11-11).


def test_a_chatgpt_answer_is_its_markdown_with_the_sources_in_order() -> None:
    answer = _parse("chatgpt_web", CAPTURED / "chatgpt_scraper_answer.json")
    result = _load(CAPTURED / "chatgpt_scraper_answer.json")["tasks"][0]["result"][0]

    assert answer.status == "complete"
    assert answer.is_valid
    assert answer.answer_text == result["markdown"]
    assert answer.model_reported == "gpt-6"
    assert answer.observed_at == datetime(2026, 11, 11, 6, 41, 8, tzinfo=UTC)
    assert (answer.device, answer.language_code) == ("desktop", "en")
    assert answer.fan_out_count == 1
    # Nine listed, one listed twice.
    assert len(answer.sources) == 8
    first = answer.sources[0]
    assert first.kind == "source_list"
    assert first.raw_url.endswith("utm_source=chatgpt.com")
    assert first.url is not None
    assert first.url.url == (
        "https://www.itechguides.com/"
        "top-12-managed-security-service-providers-mssp-in-india-2026-shortlist"
    )
    assert first.url.referral_tag == "chatgpt.com"
    assert first.source_name == "iTechGuides"
    # Cited by three blocks, the first of them the third item.
    assert (first.occurrences, first.answer_block_index) == (3, 2)
    extras = answer.provider_extras
    assert extras is not None
    assert str(extras["check_url"]).startswith("https://chatgpt.com/?prompt=")
    assert len(extras["brand_entities"]) == 12
    assert extras["search_results"] == 12
    assert extras["ads"] == []


def test_a_gemini_answer_merges_the_sources_it_lists_more_than_once() -> None:
    answer = _parse("gemini_web", CAPTURED / "gemini_scraper_answer.json")

    assert answer.status == "complete"
    assert answer.model_reported == "3.5 Flash-Lite"
    assert answer.fan_out_count == 0
    hosts = [source.url.host.name for source in answer.sources if source.url is not None]
    # Thirteen listed: text fragments and repeats fold into five pages.
    assert hosts == [
        "www.cybernx.com",
        "infilux.in",
        "netnxt.com",
        "eventussecurity.com",
        "factosecure.com",
    ]
    assert [source.occurrences for source in answer.sources] == [1, 2, 2, 1, 4]
    # Listed but cited by no block: no block to point at.
    assert answer.sources[3].answer_block_index is None


def test_an_ai_mode_answer_is_its_overview_with_references_then_links() -> None:
    answer = _parse("google_ai_mode", CAPTURED / "ai_mode_answer.json")
    item = _load(CAPTURED / "ai_mode_answer.json")["tasks"][0]["result"][0]["items"][0]

    assert answer.status == "complete"
    assert answer.answer_text == item["markdown"]
    assert answer.model_reported is None
    assert [source.kind for source in answer.sources[:3]] == [
        "reference_card",
        "reference_card",
        "inline",
    ]
    assert answer.sources[0].source_name == "Embee Software"
    # Two references and ten more links; the link to the first reference is the reference.
    assert len(answer.sources) == 12
    assert answer.check_url is not None
    assert answer.check_url.startswith("https://www.google.com/search?q=")


# What the spike did not see (doc 07 sections 5.4 and 5.5).


def test_an_ad_is_neither_answer_text_nor_a_citation() -> None:
    answer = _parse("chatgpt_web", AI / "chatgpt_ad.json")

    assert answer.answer_text == (
        "Acme SOC runs a 24x7 security operations centre in Mumbai and Pune.\n\n"
    )
    assert [source.raw_url for source in answer.sources] == [
        "https://acme-soc.example/services?utm_source=chatgpt.com"
    ]
    assert answer.provider_extras is not None
    assert answer.provider_extras["ads"] == [
        {
            "type": "chat_gpt_ad",
            "domain": "rival-watch.example",
            "url": "https://rival-watch.example/offer",
            "title": "Rival Watch",
            "is_rendered": True,
        }
    ]


@pytest.mark.parametrize(
    ("name", "status"),
    [
        ("chatgpt_refused", "refused"),
        ("chatgpt_empty", "empty"),
        ("chatgpt_partial", "partial"),
    ],
)
def test_refusals_empties_and_partials_are_told_apart(name: str, status: str) -> None:
    answer = _parse("chatgpt_web", AI / f"{name}.json")

    assert answer.status == status
    assert answer.is_valid is (status == "partial")


def test_a_short_answer_is_a_refusal() -> None:
    body = _answer([{"markdown": "No.", "items": [{"type": "chat_gpt_text", "markdown": "No."}]}])

    assert parse_ai_answer("chatgpt_web", body).status == "refused"


def test_a_refusal_with_a_curly_apostrophe_is_a_refusal() -> None:
    apostrophe = "\N{RIGHT SINGLE QUOTATION MARK}"
    text = f"I{apostrophe}m sorry, but I can{apostrophe}t compare vendors for you."
    body = _answer([{"markdown": text, "items": [{"type": "chat_gpt_text", "markdown": text}]}])

    assert parse_ai_answer("chatgpt_web", body).status == "refused"


def test_a_task_the_provider_refused_is_an_error_with_its_code() -> None:
    answer = _parse("chatgpt_web", AI / "task_error.json")

    assert (answer.status, answer.error_code) == ("error", "40501")
    assert answer.answer_text is None
    assert not answer.is_valid


def test_a_task_without_a_result_is_empty() -> None:
    assert parse_ai_answer("gemini_web", _answer(None)).status == "empty"


def test_the_model_is_read_with_its_whitespace_collapsed() -> None:
    answer = _parse("gemini_web", AI / "gemini_nbsp_model.json")

    assert answer.model_reported == "3.5 Flash-Lite"
    # The same page with and without a text fragment is one source.
    assert [(source.raw_url, source.occurrences) for source in answer.sources] == [
        ("https://acme-soc.example/", 2)
    ]


def test_an_unreadable_answer_is_an_error_kept_with_its_code() -> None:
    at = datetime(2026, 11, 12, tzinfo=UTC)

    answer = unreadable("schema_mismatch", observed_at=at)

    assert (answer.status, answer.error_code, answer.observed_at) == (
        "error",
        "schema_mismatch",
        at,
    )
    assert answer.sources == ()


@pytest.mark.parametrize(
    ("body", "path"),
    [
        (b"not json", "$"),
        (b"[1, 2]", "$"),
        (b'{"tasks": []}', "tasks[]"),
        (json.dumps(_answer([{"items": {"type": "x"}}])).encode(), "tasks[].result[].items"),
        (json.dumps(_answer([{"items": ["x"]}])).encode(), "tasks[].result[].items[0]"),
    ],
)
def test_an_answer_of_another_shape_is_refused_with_where(body: bytes, path: str) -> None:
    with pytest.raises(AiSchemaMismatchError) as raised:
        parse_ai_answer("chatgpt_web", body)

    assert raised.value.path == path


def test_text_the_database_cannot_keep_is_cleaned() -> None:
    body = _answer(
        [{"markdown": "Acme\x00 SOC runs a security operations centre in Mumbai.", "items": None}]
    )

    answer = parse_ai_answer("chatgpt_web", body)

    assert answer.answer_text == "Acme SOC runs a security operations centre in Mumbai."


def test_the_extras_are_cut_to_fit_their_column() -> None:
    brands = [{"title": f"Brand {n} " + "x" * 200, "category": "company"} for n in range(400)]
    body = _answer(
        [
            {
                "markdown": "Acme SOC runs a security operations centre in Mumbai.",
                "items": None,
                "brand_entities": brands,
            }
        ]
    )

    extras = parse_ai_answer("chatgpt_web", body).provider_extras

    assert extras is not None
    assert extras["truncated"] is True
    assert 0 < len(extras["brand_entities"]) < 400
    assert len(json.dumps(extras, ensure_ascii=False).encode()) <= EXTRAS_MAX_BYTES


# The fixtures and their registry (docs/26-testing-quality.md section 3.3).


def _registry() -> Mapping[str, Any]:
    loaded: Mapping[str, Any] = json.loads((AI / "registry.json").read_text())
    return loaded


@pytest.mark.gold
def test_each_fixtures_schema_hash_matches_its_record() -> None:
    for record in _registry()["fixtures"]:
        document = _load(FIXTURES / record["file"])
        assert schema_hash(document) == record["schema_hash"], record["id"]


@pytest.mark.gold
def test_every_path_the_parser_reads_exists_in_the_fixtures() -> None:
    union: set[str] = set()
    for record in _registry()["fixtures"]:
        union |= schema_paths(_load(FIXTURES / record["file"]))

    missing = [path for path in READS_PATHS if not reads(frozenset(union), path)]

    assert missing == []


@pytest.mark.gold
def test_every_fixture_parses_to_the_status_its_record_names() -> None:
    for record in _registry()["fixtures"]:
        answer = parse_ai_answer(record["engine_code"], (FIXTURES / record["file"]).read_bytes())
        assert answer.status == record["status"], record["id"]
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/providers/dataforseo/test_ai_parse.py --no-cov -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'idraft.providers.dataforseo.ai_parse'`.

- [ ] **Step 5: Write the normalizer**

Create `backend/src/idraft/providers/dataforseo/ai_parse.py`:

```python
"""The normalized AI answer, normalizer version 1 (docs/07-dataforseo-ai-integration.md section 5;
docs/12-normalized-observation-schemas.md section 4).

`parse_ai_answer` reads the `task_get/advanced` answer of the ChatGPT scraper, the Gemini scraper
or Google AI Mode and returns what ingest stores: the answer text, the cited sources in the
provider's order, the status, the model and a few small extras. It is pure: no I/O, no database.
Mentions and citation roles are `idraft.extraction.ai_facts`'s work.

Read strictly: the shape of the answer (`tasks[]`, `result[]`, `items[]`). Anything else is read
as far as it can be and left out when it cannot. Answer text is the markdown of the answer's
items, ad items left out (doc 07 section 5.4); for ChatGPT that is the top-level `markdown`
exactly when no ad is present (S-04: the top-level markdown is the items' markdown joined). The
text is kept as markdown: slice 1 has no markdown renderer, so `answer_text` equals
`answer_markdown` and a plain-text renderer later is an extractor version change.

Text the database cannot keep (NUL, a lone surrogate) is cleaned from the whole answer first.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize
from idraft.providers.dataforseo.serp_parse import scrub_text

PARSER_VERSION: Final = 1
# provider_extras is a small column (doc 04 section 8.3): at most this many bytes of JSON.
EXTRAS_MAX_BYTES: Final = 16 * 1024
# An answer this short is not an answer (doc 07 section 5.5).
REFUSAL_MAX_CHARS: Final = 40
# Where a refusal says so: the opening of the answer, without case.
REFUSAL_WINDOW: Final = 200
REFUSALS: Final = (
    "i can't help with",
    "i cannot help with",
    "i can't assist with",
    "i cannot assist with",
    "i'm sorry, but i can't",
    "i'm unable to help",
)
# Item types that are advertising, never answer text or citations (doc 07 section 5.4).
AD_TYPES: Final = frozenset({"chat_gpt_ad", "ai_overview_paid", "paid"})
AnswerStatus = Literal["complete", "partial", "empty", "refused", "error"]
CitationKind = Literal["source_list", "inline", "reference_card"]
# The paths of the answer the parser depends on (docs/26-testing-quality.md section 3.3). A test
# checks that every one exists in the registered fixtures.
READS_PATHS: Final = (
    "tasks[].status_code",
    "tasks[].data.device",
    "tasks[].data.language_code",
    "tasks[].result[].model",
    "tasks[].result[].check_url",
    "tasks[].result[].datetime",
    "tasks[].result[].markdown",
    "tasks[].result[].sources[].url",
    "tasks[].result[].sources[].title",
    "tasks[].result[].sources[].source_name",
    "tasks[].result[].fan_out_queries[]",
    "tasks[].result[].brand_entities[].title",
    "tasks[].result[].items[].type",
    "tasks[].result[].items[].markdown",
    "tasks[].result[].items[].sources[].url",
    "tasks[].result[].items[].references[].url",
    "tasks[].result[].items[].references[].source",
    "tasks[].result[].items[].items[].type",
    "tasks[].result[].items[].items[].links[].url",
)


class AiSchemaMismatchError(ValueError):
    """The answer is not shaped as the parser reads it: `path` says where."""

    def __init__(self, path: str, expected: str) -> None:
        super().__init__(f"{path}: expected {expected}")
        self.path = path


@dataclass(frozen=True, slots=True)
class CitedSource:
    raw_url: str
    # None when the address cannot be read as a web page: kept for the count, never stored.
    url: CanonicalUrl | None
    title: str | None
    source_name: str | None
    kind: CitationKind
    # Times the answer's blocks cite it; at least 1.
    occurrences: int
    # The answer block (item position, from 0) that first cites it; None for the source list.
    answer_block_index: int | None


@dataclass(frozen=True, slots=True)
class NormalizedAnswer:
    status: AnswerStatus
    error_code: str | None
    answer_text: str | None
    model_reported: str | None
    check_url: str | None
    observed_at: datetime | None
    device: str | None
    language_code: str | None
    sources: tuple[CitedSource, ...]
    fan_out_count: int
    provider_extras: Mapping[str, Any] | None

    @property
    def is_valid(self) -> bool:
        """Whether the answer counts in rates (doc 07 section 5.5)."""
        return self.status in ("complete", "partial")


def unreadable(code: str, *, observed_at: datetime | None = None) -> NormalizedAnswer:
    """What is stored for an answer that cannot be read: an `error` with its code."""
    return NormalizedAnswer(
        status="error",
        error_code=code,
        answer_text=None,
        model_reported=None,
        check_url=None,
        observed_at=observed_at,
        device=None,
        language_code=None,
        sources=(),
        fan_out_count=0,
        provider_extras=None,
    )


def parse_ai_answer(engine_code: str, body: bytes | Mapping[str, Any]) -> NormalizedAnswer:
    """The normalized answer of a `task_get/advanced` answer of one engine, given as the bytes
    the provider sent or as its parsed JSON."""
    try:
        document = _document(body)
    except RecursionError:
        raise AiSchemaMismatchError("$", "a document that is not nested without end") from None
    task = _first(document.get("tasks"), "tasks[]")
    status_code = task.get("status_code")
    echoed = task.get("data")
    data: Mapping[str, Any] = echoed if isinstance(echoed, Mapping) else {}
    device, language = _text(data.get("device")), _text(data.get("language_code"))
    if isinstance(status_code, int) and status_code >= 40000:
        return _with(unreadable(str(status_code)), device=device, language_code=language)
    results = task.get("result")
    if not results:
        return _empty(device, language)
    result = _first(results, "tasks[].result[]")
    items = result.get("items")
    if items is not None and not isinstance(items, list):
        raise AiSchemaMismatchError("tasks[].result[].items", "a list or null")
    for position, item in enumerate(items or []):
        if not isinstance(item, Mapping):
            raise AiSchemaMismatchError(f"tasks[].result[].items[{position}]", "an object")
    blocks: list[Mapping[str, Any]] = list(items or [])
    if engine_code == "google_ai_mode":
        text, sources, ads = _ai_mode(blocks)
    else:
        text, sources, ads = _scraper(result, blocks)
    fan_out = [query for query in result.get("fan_out_queries") or [] if isinstance(query, str)]
    extras = _bounded(
        {
            "check_url": _text(result.get("check_url")),
            "brand_entities": [
                {"title": _text(e.get("title")), "category": _text(e.get("category"))}
                for e in _mappings(result.get("brand_entities"))
            ],
            "fan_out_queries": fan_out,
            "search_results": len(_mappings(result.get("search_results"))),
            "ads": ads,
            "unreadable_sources": sum(source.url is None for source in sources),
        }
    )
    return NormalizedAnswer(
        status=_status(text, result, blocks),
        error_code=None,
        answer_text=text or None,
        model_reported=_model(result.get("model")),
        check_url=_text(result.get("check_url")),
        observed_at=_observed_at(result.get("datetime")),
        device=device,
        language_code=language or _text(result.get("language_code")),
        sources=tuple(sources),
        fan_out_count=len(fan_out),
        provider_extras=extras,
    )


def _status(
    text: str, result: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]
) -> AnswerStatus:
    if not text:
        return "empty"
    # A curly apostrophe reads as a straight one, so one list of phrases serves both.
    opening = text[:REFUSAL_WINDOW].casefold().replace("\N{RIGHT SINGLE QUOTATION MARK}", "'")
    if len(text.strip()) < REFUSAL_MAX_CHARS or any(phrase in opening for phrase in REFUSALS):
        return "refused"
    if not blocks and _text(result.get("markdown")):
        # Markdown with no blocks behind it: whether an ad is in it cannot be told.
        return "partial"
    return "complete"


def _scraper(
    result: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]
) -> tuple[str, list[CitedSource], list[dict[str, Any]]]:
    """ChatGPT and Gemini: the text of the blocks that are not ads, the source list then the
    sources the blocks cite."""
    ads = [_ad(block) for block in blocks if block.get("type") in AD_TYPES]
    answer = [block for block in blocks if block.get("type") not in AD_TYPES]
    if blocks:
        text = "".join(_text(block.get("markdown")) or "" for block in answer)
    else:
        text = _text(result.get("markdown")) or ""
    sources = _Sources()
    for source in _mappings(result.get("sources")):
        sources.add(source, "source_list", None, cited=False)
    for position, block in enumerate(blocks):
        if block.get("type") in AD_TYPES:
            continue
        for source in _mappings(block.get("sources")):
            sources.add(source, "inline", position, cited=True)
    return text, sources.found(), ads


def _ai_mode(
    blocks: Sequence[Mapping[str, Any]],
) -> tuple[str, list[CitedSource], list[dict[str, Any]]]:
    """AI Mode: the `ai_overview` item, its references as cards and its elements' links inline
    when not a reference already (doc 07 section 5.3)."""
    ads = [_ad(block) for block in blocks if block.get("type") in AD_TYPES]
    overview = next((block for block in blocks if block.get("type") == "ai_overview"), None)
    if overview is None:
        return "", [], ads
    elements = _mappings(overview.get("items"))
    paid = [element for element in elements if element.get("type") in AD_TYPES]
    ads.extend(_ad(element) for element in paid)
    if paid:
        text = "\n\n".join(
            _text(element.get("markdown")) or ""
            for element in elements
            if element.get("type") not in AD_TYPES
        )
    else:
        text = _text(overview.get("markdown")) or ""
    sources = _Sources()
    for reference in _mappings(overview.get("references")):
        sources.add(reference, "reference_card", None, cited=False, name_field="source")
    for position, element in enumerate(elements):
        if element.get("type") in AD_TYPES:
            continue
        for link in _mappings(element.get("links")):
            sources.add(link, "inline", position, cited=True)
    return text, sources.found(), ads


class _Sources:
    """Sources in first-appearance order, one per canonical URL (doc 14 section 9)."""

    def __init__(self) -> None:
        self._order: list[str] = []
        self._first: dict[str, CitedSource] = {}
        self._cited: dict[str, int] = {}
        self._block: dict[str, int] = {}

    def add(
        self,
        source: Mapping[str, Any],
        kind: CitationKind,
        block: int | None,
        *,
        cited: bool,
        name_field: str = "source_name",
    ) -> None:
        raw = _text(source.get("url"))
        if not raw:
            return
        try:
            url: CanonicalUrl | None = canonicalize(raw)
        except UrlRejectedError:
            url = None
        key = url.url_hash.hex() if url is not None else f"raw:{raw}"
        if key not in self._first:
            self._order.append(key)
            self._first[key] = CitedSource(
                raw_url=raw,
                url=url,
                title=_text(source.get("title")),
                source_name=_text(source.get(name_field)),
                kind=kind,
                occurrences=1,
                answer_block_index=block,
            )
        if cited:
            self._cited[key] = self._cited.get(key, 0) + 1
            self._block.setdefault(key, block if block is not None else 0)

    def found(self) -> list[CitedSource]:
        found = []
        for key in self._order:
            first = self._first[key]
            block = first.answer_block_index
            if block is None:
                block = self._block.get(key)
            found.append(
                CitedSource(
                    raw_url=first.raw_url,
                    url=first.url,
                    title=first.title,
                    source_name=first.source_name,
                    kind=first.kind,
                    occurrences=max(1, self._cited.get(key, 0)),
                    answer_block_index=block,
                )
            )
        return found


def _ad(block: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "type": _text(block.get("type")),
        "domain": _text(block.get("domain")),
        "url": _text(block.get("url")),
        "title": _text(block.get("title")),
        "is_rendered": block.get("is_rendered")
        if isinstance(block.get("is_rendered"), bool)
        else None,
    }


def _model(value: object) -> str | None:
    """The model as reported, whitespace collapsed: Gemini has sent `3.5\\xa0Flash-Lite` (S-04)."""
    text = _text(value)
    if text is None:
        return None
    return " ".join(text.split()) or None


def _empty(device: str | None, language: str | None) -> NormalizedAnswer:
    return NormalizedAnswer(
        status="empty",
        error_code=None,
        answer_text=None,
        model_reported=None,
        check_url=None,
        observed_at=None,
        device=device,
        language_code=language,
        sources=(),
        fan_out_count=0,
        provider_extras=None,
    )


def _with(
    answer: NormalizedAnswer, *, device: str | None, language_code: str | None
) -> NormalizedAnswer:
    return NormalizedAnswer(
        status=answer.status,
        error_code=answer.error_code,
        answer_text=answer.answer_text,
        model_reported=answer.model_reported,
        check_url=answer.check_url,
        observed_at=answer.observed_at,
        device=device,
        language_code=language_code,
        sources=answer.sources,
        fan_out_count=answer.fan_out_count,
        provider_extras=answer.provider_extras,
    )


def _document(body: bytes | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(body, bytes):
        try:
            body = json.loads(body)
        except ValueError:
            raise AiSchemaMismatchError("$", "JSON") from None
    if not isinstance(body, Mapping):
        raise AiSchemaMismatchError("$", "an object")
    cleaned: Mapping[str, Any] = scrub_text(body)
    return cleaned


def _first(value: object, path: str) -> Mapping[str, Any]:
    if not isinstance(value, list) or not value or not isinstance(value[0], Mapping):
        raise AiSchemaMismatchError(path, "a non-empty list of objects")
    first: Mapping[str, Any] = value[0]
    return first


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _mappings(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [element for element in value if isinstance(element, Mapping)]


def _observed_at(value: object) -> datetime | None:
    text = _text(value)
    if text is None:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        return None


def _fits(payload: Mapping[str, Any]) -> bool:
    return len(json.dumps(payload, ensure_ascii=False).encode()) <= EXTRAS_MAX_BYTES


def _bounded(payload: dict[str, Any]) -> dict[str, Any]:
    """The extras with their longest list halved until they fit; `{"truncated": true}` when
    that is not enough."""
    kept = {
        name: list(value) if isinstance(value, list) else value for name, value in payload.items()
    }
    lists = [name for name, value in kept.items() if isinstance(value, list)]
    while not _fits(kept):
        longest = max(lists, key=lambda name: len(kept[name]), default=None)
        if longest is None or not kept[longest]:
            return {"truncated": True}
        del kept[longest][len(kept[longest]) // 2 :]
        kept["truncated"] = True
    return kept
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/providers/dataforseo/ --no-cov -q`
Expected: PASS (23 new tests in `test_ai_parse.py`; `-m gold` selects the three registry tests).

- [ ] **Step 7: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/idraft/providers/dataforseo/serp_parse.py backend/src/idraft/providers/dataforseo/ai_parse.py backend/tests/fixtures/dataforseo/ai backend/tests/providers/dataforseo/test_ai_parse.py
git commit -m "AI prompts: normalizer version 1 for ChatGPT, Gemini and AI Mode answers"
```

## Task 3: Pure extraction of one answer

**Files:**
- Create: `backend/src/idraft/extraction/ai_facts.py`
- Test: `backend/tests/extraction/test_ai_facts.py`

`idraft.extraction` is already pure by contract (no `idraft.domain`, no database, no I/O), so this module needs no new import-linter entry. Inputs: the answer text, its sources (canonical URLs only: a source whose URL could not be read never reaches this module), the project's `AliasMatcher` and `DomainResolver`, and the role of each entity the project tracks in AI answers. Outputs, in code points:

- per citation: index (1-based, provider order), canonical URL, role and role entity, kind, occurrences, and the first offset of its URL in the text when it is written there;
- per mention of a tracked entity: count and evidence spans of the spans that are not discarded, first offset, order among the tracked entities the text names, prominence `1 - first / len(text)` (doc 16 section 6), match method of the best span, status `accepted` or `uncertain`, confidence;
- the fact row. Only accepted mentions count toward `own_mentioned`, `tracked_entities_mentioned` (own plus competitors, the share of voice denominator) and `competitor_mentions`; an uncertain one is stored and left out of every rate (doc 13 section 1, principle 4). A watched entity is stored and counts in no share. `competitor_cited` holds the tracked competitors whose domain rule a citation matched. `had_structured_list` is false: structured lists are slice 2.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/extraction/test_ai_facts.py`:

```python
"""Light extraction of AI answers (docs/13-ai-extraction-engine.md stages 1, 2, 4, 5 and 7):
mentions with their offsets and order, citation roles, and the fact row, on hand-written answers."""

from __future__ import annotations

import uuid
from collections.abc import Mapping

from idraft.extraction.ai_facts import (
    AnswerFacts,
    SourceIn,
    blank_link_targets,
    extract_answer_facts,
)
from idraft.extraction.aliases import AliasMatcher, AliasRule, EntityRule
from idraft.extraction.domains import DomainResolver, DomainRule, ProjectRole
from idraft.extraction.urls import canonicalize, normalize_host

OWN = uuid.UUID("00000000-0000-0000-0000-00000000000a")
RIVAL = uuid.UUID("00000000-0000-0000-0000-00000000000b")
WATCHED = uuid.UUID("00000000-0000-0000-0000-00000000000c")
AMBIGUOUS = uuid.UUID("00000000-0000-0000-0000-00000000000d")
UNTRACKED = uuid.UUID("00000000-0000-0000-0000-00000000000e")
ROLES: Mapping[uuid.UUID, ProjectRole] = {
    OWN: "own",
    RIVAL: "competitor",
    WATCHED: "watch",
    AMBIGUOUS: "competitor",
}
MATCHER = AliasMatcher(
    [
        EntityRule(OWN, "Acme SOC", domains=("acme-soc.example",)),
        EntityRule(RIVAL, "Rival Watch", domains=("rival-watch.example",)),
        EntityRule(WATCHED, "Gartner"),
        EntityRule(AMBIGUOUS, "Apex", is_ambiguous=True, hints=("security",)),
        EntityRule(UNTRACKED, "Elsewhere"),
    ],
    [AliasRule(uuid.UUID(int=1), OWN, "Acme")],
)
RESOLVER = DomainResolver(
    [
        DomainRule(OWN, "own", "registrable", normalize_host("acme-soc.example")),
        DomainRule(RIVAL, "competitor", "registrable", normalize_host("rival-watch.example")),
        DomainRule(WATCHED, "watch", "registrable", normalize_host("gartner.example")),
    ]
)


def _source(raw: str, kind: str = "source_list", occurrences: int = 1) -> SourceIn:
    return SourceIn(url=canonicalize(raw), raw_url=raw, kind=kind, occurrences=occurrences)


def _facts(text: str | None, *sources: SourceIn, is_valid: bool = True) -> AnswerFacts:
    return extract_answer_facts(
        text, sources, matcher=MATCHER, resolver=RESOLVER, roles=ROLES, is_valid=is_valid
    )


def test_mentions_carry_their_count_offsets_order_and_spans() -> None:
    text = "Rival Watch and Acme SOC both run a SOC. Acme is cheaper."

    facts = _facts(text)

    rival, own = facts.mentions
    assert (rival.entity_id, rival.role, rival.mention_order) == (RIVAL, "competitor", 1)
    assert (rival.first_char_offset, rival.evidence_spans) == (0, ((0, 11),))
    assert (own.entity_id, own.role, own.mention_order) == (OWN, "own", 2)
    assert own.mention_count == 2
    assert own.evidence_spans == ((16, 24), (41, 45))
    assert own.first_char_offset == 16
    assert own.prominence == round(1 - 16 / len(text), 4)
    assert own.status == "accepted"
    assert facts.fact.own_mentioned
    assert facts.fact.own_mention_order == 2
    assert facts.fact.tracked_entities_mentioned == 2
    assert facts.fact.competitor_mentions == (RIVAL,)


def test_a_watched_entity_is_kept_but_counts_in_no_share() -> None:
    facts = _facts("Gartner rates Acme SOC highly.")

    assert [(m.entity_id, m.role) for m in facts.mentions] == [(WATCHED, "watch"), (OWN, "own")]
    assert facts.fact.tracked_entities_mentioned == 1
    assert facts.fact.competitor_mentions == ()


def test_an_entity_the_project_does_not_track_is_not_kept() -> None:
    facts = _facts("Elsewhere is a vendor too.")

    assert facts.mentions == ()


def test_an_uncertain_mention_is_stored_and_left_out_of_every_rate() -> None:
    # An ambiguous name, capitalized, with no hint near it: 0.45, uncertain.
    facts = _facts("We compared it with Apex last year.")

    (mention,) = facts.mentions
    assert (mention.entity_id, mention.status) == (AMBIGUOUS, "uncertain")
    assert facts.fact.tracked_entities_mentioned == 0
    assert facts.fact.competitor_mentions == ()


def test_an_ambiguous_name_near_its_hint_is_accepted() -> None:
    facts = _facts("For managed security we compared it with Apex last year.")

    (mention,) = facts.mentions
    assert mention.status == "accepted"
    assert facts.fact.competitor_mentions == (AMBIGUOUS,)


def test_a_domain_inside_a_link_target_is_a_citation_not_a_mention() -> None:
    raw = "https://acme-soc.example/pricing?utm_source=chatgpt.com"
    text = f"Pricing starts low ([source]({raw}))."

    facts = _facts(text, _source(raw, "inline"))

    assert facts.mentions == ()
    assert not facts.fact.own_mentioned
    assert facts.fact.own_domain_cited
    (citation,) = facts.citations
    assert citation.first_char_offset == text.index(raw)
    assert (citation.domain_role, citation.role_entity_id) == ("own", OWN)


def test_a_domain_written_in_the_text_is_a_mention_not_a_citation() -> None:
    facts = _facts("See acme-soc.example for details.")

    (mention,) = facts.mentions
    assert (mention.entity_id, mention.match_method) == (OWN, "alias_domain")
    assert not facts.fact.own_domain_cited


def test_blanking_a_link_target_keeps_every_offset() -> None:
    text = "see [Acme](https://acme-soc.example/x) now"

    blanked = blank_link_targets(text)

    assert len(blanked) == len(text)
    assert blanked == "see [Acme](" + " " * len("https://acme-soc.example/x") + ") now"


def test_citations_are_numbered_in_order_with_their_roles() -> None:
    facts = _facts(
        "Acme SOC leads.",
        _source("https://rival-watch.example/blog"),
        _source("https://www.acme-soc.example/"),
        _source("https://news.example/soc", "inline", occurrences=3),
        _source("https://gartner.example/report"),
    )

    assert [(c.index, c.domain_role, c.role_entity_id) for c in facts.citations] == [
        (1, "competitor", RIVAL),
        (2, "own", OWN),
        (3, "third_party", None),
        (4, "third_party", WATCHED),
    ]
    assert facts.citations[2].occurrences == 3
    # Not written in the text: no offset.
    assert facts.citations[0].first_char_offset is None
    fact = facts.fact
    assert (fact.own_citation_count, fact.total_citation_count) == (1, 4)
    assert fact.competitor_cited == (RIVAL,)


def test_the_four_outcomes_are_the_cross_product_of_mentioned_and_cited() -> None:
    own_page = _source("https://acme-soc.example/")
    other = _source("https://news.example/")

    both = _facts("Acme SOC.", own_page).fact
    mentioned_only = _facts("Acme SOC.", other).fact
    cited_only = _facts("A SOC.", own_page).fact
    neither = _facts("A SOC.", other).fact

    assert [
        (f.own_mentioned, f.own_domain_cited) for f in (both, mentioned_only, cited_only, neither)
    ] == [
        (True, True),
        (True, False),
        (False, True),
        (False, False),
    ]


def test_an_answer_without_text_has_citations_and_no_mentions() -> None:
    facts = _facts(None, _source("https://acme-soc.example/"), is_valid=False)

    assert facts.mentions == ()
    assert not facts.fact.is_valid
    assert facts.fact.own_domain_cited
    assert not facts.fact.had_structured_list


def test_offsets_are_code_points() -> None:
    facts = _facts("\U0001f512 Acme SOC")

    (mention,) = facts.mentions
    assert mention.first_char_offset == 2
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/extraction/test_ai_facts.py --no-cov -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'idraft.extraction.ai_facts'`.

- [ ] **Step 3: Write the module**

Create `backend/src/idraft/extraction/ai_facts.py`:

```python
"""Light extraction of one AI answer (docs/13-ai-extraction-engine.md stages 1, 2, 4, 5 and 7, as
slice 1 of AI prompt tracking cuts them).

Given the answer text and its cited sources, the project's alias matcher, its domain resolver and
the role of each tracked entity, this says which sources are own, competitor or third party,
which tracked entities the text names and where, and the observation's fact row. Pure: no
database, no I/O. Offsets are into the text as given, in code points.

A mention the matcher is unsure of is kept as `uncertain` and left out of every rate (doc 13
section 1, principle 4). A domain written inside a markdown link target is the link, not a
mention (doc 13 principle 5): link targets are blanked before matching, offsets unchanged.
Recommendation, sentiment, prominence beyond the first offset and structured lists are later
slices: `had_structured_list` is always false.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal

from idraft.extraction.aliases import AliasMatcher, MatchMethod
from idraft.extraction.domains import DomainResolver, DomainRole, ProjectRole
from idraft.extraction.urls import CanonicalUrl

EXTRACTOR_VERSION: Final = 1
# `](https://...)`: the target of a markdown link or image.
_LINK_TARGET: Final = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
StoredStatus = Literal["accepted", "uncertain"]


@dataclass(frozen=True, slots=True)
class SourceIn:
    url: CanonicalUrl
    raw_url: str
    kind: str
    occurrences: int


@dataclass(frozen=True, slots=True)
class CitationFact:
    index: int  # 1-based, in the provider's order
    url: CanonicalUrl
    raw_url: str
    kind: str
    occurrences: int
    domain_role: DomainRole
    role_entity_id: uuid.UUID | None
    first_char_offset: int | None


@dataclass(frozen=True, slots=True)
class MentionFact:
    entity_id: uuid.UUID
    role: ProjectRole
    mention_count: int
    first_char_offset: int
    mention_order: int  # 1 = the first tracked entity the text names
    prominence: float  # 1 - first offset / text length (doc 16 section 6), four places
    evidence_spans: tuple[tuple[int, int], ...]  # half-open code point ranges
    match_method: MatchMethod
    status: StoredStatus
    confidence: float


@dataclass(frozen=True, slots=True)
class ObservationFact:
    is_valid: bool
    own_mentioned: bool
    own_domain_cited: bool
    own_mention_order: int | None
    own_prominence: float | None
    own_citation_count: int
    total_citation_count: int
    tracked_entities_mentioned: int
    competitor_mentions: tuple[uuid.UUID, ...]
    competitor_cited: tuple[uuid.UUID, ...]
    had_structured_list: bool


@dataclass(frozen=True, slots=True)
class AnswerFacts:
    citations: tuple[CitationFact, ...]
    mentions: tuple[MentionFact, ...]
    fact: ObservationFact


def extract_answer_facts(
    text: str | None,
    sources: Sequence[SourceIn],
    *,
    matcher: AliasMatcher,
    resolver: DomainResolver,
    roles: Mapping[uuid.UUID, ProjectRole],
    is_valid: bool,
) -> AnswerFacts:
    """The facts of one answer. `roles` holds the entities the project tracks in AI answers;
    a match of any other entity is not kept. Raises `TooManyMatchesError` from the matcher."""
    citations = tuple(_citation(i, source, text, resolver) for i, source in enumerate(sources, 1))
    mentions = _mentions(text, matcher, roles) if text else ()
    accepted = [mention for mention in mentions if mention.status == "accepted"]
    own = [mention for mention in accepted if mention.role == "own"]
    competitors = [mention for mention in accepted if mention.role == "competitor"]
    first_own = min(own, key=lambda mention: mention.first_char_offset, default=None)
    own_cited = [citation for citation in citations if citation.domain_role == "own"]
    cited_competitors = dict.fromkeys(
        citation.role_entity_id
        for citation in citations
        if citation.domain_role == "competitor"
        and citation.role_entity_id is not None
        and roles.get(citation.role_entity_id) == "competitor"
    )
    fact = ObservationFact(
        is_valid=is_valid,
        own_mentioned=bool(own),
        own_domain_cited=bool(own_cited),
        own_mention_order=None if first_own is None else first_own.mention_order,
        own_prominence=None if first_own is None else first_own.prominence,
        own_citation_count=len(own_cited),
        total_citation_count=len(citations),
        tracked_entities_mentioned=len(own) + len(competitors),
        competitor_mentions=tuple(mention.entity_id for mention in competitors),
        competitor_cited=tuple(cited_competitors),
        had_structured_list=False,
    )
    return AnswerFacts(citations=citations, mentions=mentions, fact=fact)


def blank_link_targets(text: str) -> str:
    """The text with each markdown link target replaced by spaces of its length."""
    return _LINK_TARGET.sub(lambda found: "](" + " " * (len(found.group(0)) - 3) + ")", text)


def _citation(
    index: int, source: SourceIn, text: str | None, resolver: DomainResolver
) -> CitationFact:
    resolution = resolver.resolve_url(source.url)
    offset = None
    if text:
        found = text.find(source.raw_url)
        if found < 0:
            found = text.find(source.url.url)
        offset = found if found >= 0 else None
    return CitationFact(
        index=index,
        url=source.url,
        raw_url=source.raw_url,
        kind=source.kind,
        occurrences=source.occurrences,
        domain_role=resolution.domain_role,
        role_entity_id=resolution.entity_id,
        first_char_offset=offset,
    )


def _mentions(
    text: str, matcher: AliasMatcher, roles: Mapping[uuid.UUID, ProjectRole]
) -> tuple[MentionFact, ...]:
    result = matcher.match(blank_link_targets(text))
    drafts = []
    for mention in result.mentions:
        role = roles.get(mention.entity_id)
        if role is None or mention.status == "discarded":
            continue
        spans = [span for span in mention.spans if span.status != "discarded"]
        if not spans:
            continue
        best = max(spans, key=lambda span: span.score)
        drafts.append((mention, role, spans, best))
    drafts.sort(key=lambda draft: (draft[2][0].start, str(draft[0].entity_id)))
    length = len(text)
    found = []
    for order, (mention, role, spans, best) in enumerate(drafts, 1):
        first = spans[0].start
        status: StoredStatus = "accepted" if mention.status == "accepted" else "uncertain"
        found.append(
            MentionFact(
                entity_id=mention.entity_id,
                role=role,
                mention_count=len(spans),
                first_char_offset=first,
                mention_order=order,
                prominence=round(1 - first / length, 4),
                evidence_spans=tuple((span.start, span.end) for span in spans),
                match_method=best.match_method,
                status=status,
                confidence=round(mention.confidence, 3),
            )
        )
    return tuple(found)
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/extraction/ --no-cov -q`
Expected: PASS (12 new tests).

- [ ] **Step 5: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean; `lint-imports` keeps "extraction is pure".

- [ ] **Step 6: Commit**

```bash
git add backend/src/idraft/extraction/ai_facts.py backend/tests/extraction/test_ai_facts.py
git commit -m "AI prompts: citation roles, entity mentions and the fact row of an answer"
```

## Task 4: The worker's view of a project's entities

**Files:**
- Modify: `backend/src/idraft/collectors/seo_rank_context.py:89` and `:95` (`_rules` becomes `domain_rules`)
- Create: `backend/src/idraft/collectors/ai_context.py`
- Create: `backend/tests/collectors/ai_support.py` (test helpers used by Tasks 4 to 9)
- Test: `backend/tests/collectors/test_ai_context.py`

The API builds the alias matcher for the alias test in `api/entities/project_service.py` (`alias_test`) from `project_repository.matcher_entities`, `matcher_hosts` and `repository.aliases_of`. The worker cannot import the API (contract "lower layers never import the entrypoints"), so this is the worker's copy of those three reads, with two differences: only entities the project tracks in AI answers (`track_ai`) are matched, and every query names the workspace, because `app_worker` bypasses row-level security. Domain rules are the rank context's, made public. A pass of the ingest builds each project's context once (`AiContextCache`): building the matcher compiles every alias.

- [ ] **Step 1: Make the rank context's domain rules public**

In `backend/src/idraft/collectors/seo_rank_context.py` rename `async def _rules(` (line 95) to `async def domain_rules(` and its one use (line 89) to:

```python
        resolver=DomainResolver(await domain_rules(db, workspace_id, project_id)),
```

Add a docstring line to it, directly under the signature:

```python
    """The domain rules of every entity the project has attached, kept or not."""
```

Run: `cd backend && uv run pytest tests/collectors/test_seo_rank_ingest.py --no-cov -q`
Expected: PASS.

- [ ] **Step 2: Write the test helpers**

Create `backend/tests/collectors/ai_support.py`:

```python
"""A world for the AI collection tests: a project that owns Eventus Security and competes with
CyberNX (the brands of the captured Gemini answer), prompts with their first version, engines
turned on, fetched AI tasks holding a stored answer, and an observation written directly."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from idraft.collectors import ledger
from idraft.collectors.fetching import RETENTION_CLASS
from idraft.collectors.ledger import NewTask
from idraft.collectors.raw_payloads import RawPayload, store_raw_payload
from idraft.domain.workloads import TaskWorkload
from idraft.providers.dataforseo import ai
from tests.api.auth.support import execute, fetchrow
from tests.api.keywords.support import LOCATION, ensure_locations
from tests.collectors.rank_support import Ledger, _entity
from tests.collectors.support import NOW, Project, make_tenant
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt

OWN_NAME = "Eventus Security"
OWN_HOST = "eventussecurity.com"
RIVAL_NAME = "CyberNX"
RIVAL_HOST = "cybernx.com"


@dataclass(frozen=True)
class AiWorld:
    project: Project
    own: uuid.UUID
    rival: uuid.UUID


@dataclass(frozen=True)
class Prompt:
    id: uuid.UUID
    version_id: uuid.UUID


async def make_ai_world(pg: PostgresServer) -> AiWorld:
    """A project of its own workspace that owns `OWN_HOST` and competes with `RIVAL_HOST`."""
    project = await make_tenant(pg)
    await ensure_locations(pg)
    own = await _entity(pg, project, OWN_NAME, OWN_HOST, "own", primary=True)
    rival = await _entity(pg, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    return AiWorld(project, own, rival)


async def add_prompt(
    pg: PostgresServer,
    project: Project,
    text: str,
    *,
    country: str = "US",
    language: str = "en",
    branded: bool = False,
    active: bool = True,
) -> Prompt:
    """A prompt with its first version, written as the prompt routes write one (plan A's
    `insert_prompt`). `active=False` is an archived prompt (plan A decision A7)."""
    async with connection(pg) as db:
        prompt_id, version_id = await insert_prompt(
            db,
            project.workspace_id,
            project.id,
            text,
            language_code=language,
            country_iso=country,
            is_active=active,
        )
        if branded:
            await db.execute("UPDATE ai.prompts SET is_branded = true WHERE id = $1", prompt_id)
    return Prompt(id=prompt_id, version_id=version_id)


async def enable_engine(
    pg: PostgresServer,
    project: Project,
    engine_code: str,
    *,
    location_ids: Sequence[int] = (LOCATION,),
    enabled: bool = True,
) -> None:
    """The engine turned on (or off) for the project at these locations (1 to 50 countries)."""
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code, is_enabled) VALUES ($1, $2, $3, $4, 'dataforseo', $5) "
        "ON CONFLICT (project_id, engine_code) DO UPDATE SET is_enabled = excluded.is_enabled, "
        "location_ids = excluded.location_ids",
        project.id,
        engine_code,
        project.workspace_id,
        list(location_ids),
        enabled,
    )


def chatgpt_answer(text: str, urls: Sequence[str] = (), *, when: datetime | None = None) -> bytes:
    """A ChatGPT scraper answer: one block of `text` citing `urls`, which the source list names
    too. A text under 40 characters reads as a refusal."""
    sources = [
        {"type": "chat_gpt_source", "url": url, "title": f"Page {number}", "source_name": None}
        for number, url in enumerate(urls, 1)
    ]
    result = {
        "model": "gpt-6",
        "datetime": (when or NOW).strftime("%Y-%m-%d %H:%M:%S +00:00"),
        "markdown": text,
        "sources": sources,
        "items": [{"type": "chat_gpt_text", "rank_group": 1, "markdown": text, "sources": sources}],
    }
    task = {
        "status_code": 20000,
        "data": {"device": "desktop", "language_code": "en"},
        "result": [result],
    }
    return json.dumps({"status_code": 20000, "tasks": [task]}).encode()


def at_now(path: Path, when: datetime | None = None) -> bytes:
    """A recorded answer with its time moved to `when` (NOW by default): the observation tables
    have partitions for the months around today only, and lists default to the last 28 days."""
    document = json.loads(path.read_text())
    for task in document["tasks"]:
        for result in task.get("result") or []:
            result["datetime"] = (when or NOW).strftime("%Y-%m-%d %H:%M:%S +00:00")
    return json.dumps(document).encode()


async def fetched_ai_task(
    sessions: Ledger,
    pg: PostgresServer,
    project: Project,
    prompt: Prompt,
    body: bytes,
    store: MemoryStore,
    *,
    engine_code: str = "chatgpt_web",
    fetched_at: datetime | None = None,
    cost: str = "0.0012",
) -> int:
    """A manual run of one task for the prompt on the engine, fetched, with `body` as its stored
    answer. Returns the task id."""
    endpoint = ai.ENGINE_ENDPOINTS[engine_code]
    run = ledger.NewRun(
        workspace_id=project.workspace_id,
        project_id=project.id,
        schedule_id=None,
        workload=TaskWorkload.AI_PROMPT,
        window_start=NOW,
        window_end=NOW + timedelta(hours=1),
        trigger="manual",
        config_snapshot={"selector": {"prompt_ids": [str(prompt.id)]}},
    )
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                NewTask(
                    subject_type="prompt_version",
                    subject_id=str(prompt.version_id),
                    engine_code=engine_code,
                    location_id=LOCATION,
                    replicate_index=1,
                    depth=None,
                    request_fingerprint=hashlib.sha256(uuid.uuid4().bytes).digest(),
                    provider_code="dataforseo",
                    provider_endpoint=endpoint,
                    scheduled_for=NOW,
                )
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=1, estimated_cost_usd=Decimal(0))
    payload_id = await store_raw_payload(
        sessions,
        store,
        RawPayload(
            body=body,
            content_type="application/json",
            provider_code="dataforseo",
            provider_endpoint=endpoint,
            endpoint_slug=ai.ENDPOINTS[endpoint].payload_slug,
            retention_class=RETENTION_CLASS[TaskWorkload.AI_PROMPT],
        ),
    )
    row = await fetchrow(
        pg,
        "UPDATE ops.collection_tasks SET status = 'fetched', raw_payload_id = $2, "
        "ready_source = 'poll', ready_at = $3, provider_task_id = 'p-' || id::text, "
        "cost_usd = $4 WHERE run_id = $1 RETURNING id",
        run_id,
        payload_id,
        fetched_at or NOW,
        Decimal(cost),
    )
    task_id: int = row["id"]
    return task_id


async def seed_observation(
    pg: PostgresServer,
    project: Project,
    prompt: Prompt,
    *,
    object_key: str,
    sha256: bytes,
    engine_code: str = "chatgpt_web",
) -> int:
    """An observation of the prompt written directly, with no task, no facts and a raw payload
    registered at `object_key`. Returns its id."""
    endpoint = ai.ENGINE_ENDPOINTS[engine_code]
    raw = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', $3, now(), 'ai_raw', now() + interval '400 days') "
        "RETURNING id",
        object_key,
        sha256,
        endpoint,
    )
    text = "Eventus Security runs a managed SOC in Mumbai and Pune."
    row = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, answer_text, answer_markdown, "
        "answer_char_count, has_citations, raw_payload_id, adapter_version, normalizer_version, "
        "canonicalizer_version) SELECT now(), current_date, $1, $2, $3, "
        "(SELECT observation_class FROM ai.engines WHERE code = $3), $4, v.id, v.text, "
        "'dataforseo', $5, 'complete', $6, $6, $7, false, $8, 1, 1, 1 "
        "FROM ai.prompt_versions v WHERE v.id = $9 RETURNING id",
        project.workspace_id,
        project.id,
        engine_code,
        prompt.id,
        endpoint,
        text,
        len(text),
        raw["id"],
        prompt.version_id,
    )
    observation_id: int = row["id"]
    return observation_id
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/collectors/test_ai_context.py`:

```python
"""What extraction is told about a project, read as the worker reads it (`app_worker`, without
row-level security): the tracked entities of that project, their aliases, sites and roles."""

from __future__ import annotations

import uuid

import pytest

from idraft.collectors.ai_context import AiContextCache, load_ai_context
from idraft.extraction.urls import canonicalize
from tests.api.auth.support import execute
from tests.collectors.ai_support import AiWorld, make_ai_world
from tests.collectors.rank_support import Ledger
from tests.conftest import PostgresServer


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


async def test_the_matcher_finds_the_projects_names_aliases_and_sites(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await execute(
        migrated,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, $3)",
        project.workspace_id,
        world.own,
        "Eventus",
    )

    async with worker_db() as db:
        context = await load_ai_context(
            db, workspace_id=project.workspace_id, project_id=project.id
        )

    assert context is not None
    found = context.matcher.match("Eventus beats CyberNX; see eventussecurity.com.")
    assert [(m.entity_id, [s.match_method for s in m.spans]) for m in found.mentions] == [
        (world.own, ["alias_word", "alias_domain"]),
        (world.rival, ["alias_name"]),
    ]
    assert context.roles == {world.own: "own", world.rival: "competitor"}
    own_page = context.resolver.resolve_url(canonicalize("https://www.eventussecurity.com/soc"))
    assert (own_page.domain_role, own_page.entity_id) == ("own", world.own)
    assert context.entity_config_version == 1


async def test_an_entity_not_tracked_in_ai_answers_and_other_workspaces_are_left_out(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    # The same brands in another workspace: never this project's.
    await make_ai_world(migrated)
    await execute(
        migrated,
        "UPDATE core.project_entities SET track_ai = false WHERE entity_id = $1",
        world.rival,
    )
    project = world.project

    async with worker_db() as db:
        context = await load_ai_context(
            db, workspace_id=project.workspace_id, project_id=project.id
        )

    assert context is not None
    found = context.matcher.match("CyberNX and Eventus Security run SOCs.")
    assert [mention.entity_id for mention in found.mentions] == [world.own]
    assert context.roles == {world.own: "own"}
    # Its site is still a rule, so it does not fall through to a broader one.
    rival_page = context.resolver.resolve_url(canonicalize("https://cybernx.com/"))
    assert (rival_page.domain_role, rival_page.entity_id) == ("competitor", world.rival)


async def test_a_pass_builds_each_projects_context_once(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    cache = AiContextCache()

    async with worker_db() as db:
        first = await cache.get(db, project.workspace_id, project.id)
        await execute(
            migrated,
            "UPDATE core.projects SET entity_config_version = 2 WHERE id = $1",
            project.id,
        )
        again = await cache.get(db, project.workspace_id, project.id)
    async with worker_db() as db:
        fresh = await load_ai_context(db, workspace_id=project.workspace_id, project_id=project.id)

    assert again is first
    assert fresh is not None
    assert fresh.entity_config_version == 2


async def test_a_project_that_is_gone_has_no_context(worker_db: Ledger, world: AiWorld) -> None:
    async with worker_db() as db:
        missing = await load_ai_context(
            db, workspace_id=world.project.workspace_id, project_id=uuid.uuid4()
        )

    assert missing is None
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/collectors/test_ai_context.py --no-cov -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'idraft.collectors.ai_context'`.

- [ ] **Step 5: Write the loader**

Create `backend/src/idraft/collectors/ai_context.py`:

```python
"""What extraction needs to know about a project, read by the worker (spec section 4.4): its
tracked entities with their aliases, sites and hints as an alias matcher, its domain rules as a
resolver, the role of each entity, and the entity configuration version all of it is.

The API builds the same matcher for the alias test (`api/entities/project_service.py`); this is
the worker's copy of those reads, which names the workspace in every query because the worker
bypasses row-level security. Only entities the project tracks in AI answers (`track_ai`) are
matched. Every attached entity's domains are rules, as for rank checks, so the site of an entity
that is not tracked does not fall through to a broader rule of another.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Final, cast

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.seo_rank_context import domain_rules
from idraft.db.tables import (
    domains,
    entities,
    entity_aliases,
    entity_domains,
    project_entities,
    projects,
)
from idraft.extraction.aliases import AliasMatcher, AliasRule, EntityRule, MatchMode
from idraft.extraction.domains import DomainResolver, ProjectRole

_ROLES: Final = frozenset({"own", "competitor", "watch"})
_MODES: Final = frozenset({"word_boundary", "exact_case", "substring", "regex"})


@dataclass(frozen=True, slots=True)
class AiContext:
    entity_config_version: int
    matcher: AliasMatcher
    resolver: DomainResolver
    # The entities the project tracks in AI answers, by role.
    roles: Mapping[uuid.UUID, ProjectRole]


async def load_ai_context(
    db: AsyncSession, *, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> AiContext | None:
    """The project's context; None for a project that is not there."""
    version: int | None = (
        await db.execute(
            select(projects.c.entity_config_version).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one_or_none()
    if version is None:
        return None
    e, pe = entities.c, project_entities.c
    rows = (
        await db.execute(
            select(
                e.id,
                e.canonical_name,
                e.parent_entity_id,
                e.is_ambiguous,
                e.disambiguation_hints,
                pe.role,
            )
            .join(
                project_entities,
                and_(pe.entity_id == e.id, pe.workspace_id == e.workspace_id),
            )
            .where(
                pe.workspace_id == workspace_id,
                pe.project_id == project_id,
                pe.removed_at.is_(None),
                pe.track_ai,
            )
        )
    ).all()
    tracked = [row for row in rows if row.role in _ROLES]
    ids = [row.id for row in tracked]
    hosts = await _hosts(db, workspace_id, ids)
    matcher = AliasMatcher(
        [
            EntityRule(
                id=row.id,
                canonical_name=row.canonical_name,
                parent_entity_id=row.parent_entity_id,
                is_ambiguous=row.is_ambiguous,
                hints=tuple(row.disambiguation_hints),
                domains=tuple(hosts.get(row.id, ())),
            )
            for row in tracked
        ],
        await _aliases(db, workspace_id, ids),
    )
    return AiContext(
        entity_config_version=version,
        matcher=matcher,
        resolver=DomainResolver(await domain_rules(db, workspace_id, project_id)),
        roles={row.id: cast(ProjectRole, row.role) for row in tracked},
    )


async def _hosts(
    db: AsyncSession, workspace_id: uuid.UUID, entity_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    """The hosts of each entity's host and registrable rules: its domain-shaped aliases. A path
    prefix names part of a site, not a name people write."""
    if not entity_ids:
        return {}
    rows = await db.execute(
        select(entity_domains.c.entity_id, domains.c.host)
        .join(domains, domains.c.id == entity_domains.c.domain_id)
        .where(
            entity_domains.c.workspace_id == workspace_id,
            entity_domains.c.entity_id.in_(list(entity_ids)),
            entity_domains.c.match_scope != "path_prefix",
        )
    )
    found: dict[uuid.UUID, list[str]] = {}
    for row in rows:
        found.setdefault(row.entity_id, []).append(row.host)
    return found


async def _aliases(
    db: AsyncSession, workspace_id: uuid.UUID, entity_ids: Collection[uuid.UUID]
) -> list[AliasRule]:
    if not entity_ids:
        return []
    a = entity_aliases.c
    rows = await db.execute(
        select(
            a.id,
            a.entity_id,
            a.alias,
            a.match_mode,
            a.case_sensitive,
            a.is_negative,
            a.requires_context,
        )
        .where(a.workspace_id == workspace_id, a.entity_id.in_(list(entity_ids)))
        .order_by(a.created_at, a.id)
    )
    return [
        AliasRule(
            id=row.id,
            entity_id=row.entity_id,
            alias=row.alias,
            match_mode=cast(MatchMode, row.match_mode),
            case_sensitive=row.case_sensitive,
            is_negative=row.is_negative,
            requires_context=row.requires_context,
        )
        for row in rows
        if row.match_mode in _MODES
    ]


class AiContextCache:
    """The contexts of one ingest pass, by project. A pass is short; an alias changed during it
    applies from the next pass, and the derivation records the version that was used."""

    def __init__(self) -> None:
        self._found: dict[tuple[uuid.UUID, uuid.UUID], AiContext | None] = {}

    async def get(
        self, db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID
    ) -> AiContext | None:
        key = (workspace_id, project_id)
        if key not in self._found:
            self._found[key] = await load_ai_context(
                db, workspace_id=workspace_id, project_id=project_id
            )
        return self._found[key]
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/collectors/test_ai_context.py tests/collectors/test_seo_rank_ingest.py --no-cov -q`
Expected: PASS (4 new tests). A failure `permission denied for table entity_aliases` means plan A's worker grant is missing: stop and fix plan A's migration, not this code.

- [ ] **Step 7: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/idraft/collectors/seo_rank_context.py backend/src/idraft/collectors/ai_context.py backend/tests/collectors/ai_support.py backend/tests/collectors/test_ai_context.py
git commit -m "AI prompts: the worker's alias matcher and domain resolver for a project"
```

## Task 5: The `ai_prompt` workload

**Files:**
- Modify: `backend/src/idraft/collectors/seo_rank.py` (`_location_codes` becomes `location_codes`, `_queues` becomes `run_queues`)
- Create: `backend/src/idraft/collectors/ai_prompt.py`
- Test: `backend/tests/collectors/test_ai_prompt.py`

A task is one prompt version on one engine at one location: `subject_type = 'prompt_version'`, `subject_id = <prompt_version_id>`, `engine_code = <engine>`, `replicate_index = 1`, `depth = None`. Selection:

- A schedule's window takes every active prompt of the project (`deleted_at IS NULL`, `is_active`, a current version) on every enabled engine whose `ai.engines` row is active and that `ENGINE_ENDPOINTS` knows; the schedule's own `selector` is not read (slice 1 has one AI schedule per project and no panels).
- A manual run (`schedule_id IS NULL`) takes the prompts `selector.prompt_ids` names (at most 100; a run naming more is refused, not priced) on the engines `selector.engine_codes` names, or every enabled engine when that is left out. A manual run without `prompt_ids` asks nothing.
- Location (plan A decision A5): each of the engine's `location_ids` whose `country_iso` is the prompt's. Skipped, with the reason kept in the run's `config_snapshot.skipped`: `prompt_too_long` (over `PROMPT_MAX` of the engine's endpoint) and `location_not_enabled` (none of the engine's locations is in the prompt's country).
- Once per window: a schedule's window leaves out a (version, engine) another schedule's run with an overlapping window has a task for, unless that task was cancelled, failed or dead. Within one run the ledger's idempotency key already makes it once.
- A schedule's tasks are spread over its window by `domain.tasks.scheduled_for`, keyed by version and engine, so a prompt is asked at about the same hour every window; a manual run's tasks are due at its start.
- The estimate is `idraft.ai.pricing.task_prices` (plan A) of each endpoint at the run's queue. No price for an endpoint plans nothing (logged), as for rank checks. The priority queue is used only when the schedule chose it; every other mode, live included, is the standard queue (spec section 4.3).

This task does not register the workload: Task 6 registers it together with the ingest that reads its answers.

- [ ] **Step 1: Make the rank workload's two lookups public**

In `backend/src/idraft/collectors/seo_rank.py` rename `async def _location_codes(` to `async def location_codes(` and `async def _queues(` to `async def run_queues(`, and their uses in `SeoRankWorkload.build_requests`:

```python
        codes = await location_codes(db, {task.location_id for task, _ in wanted.values()})
        queues = await run_queues(db, {task.run_id for task, _ in wanted.values()})
```

Run: `cd backend && uv run pytest tests/collectors/test_seo_rank.py --no-cov -q`
Expected: PASS.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/collectors/test_ai_prompt.py`:

```python
"""The AI prompt workload (spec section 4.3): what it plans for a window, what it asks the
provider and what that costs. As `app_worker`."""

from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest

from idraft.collectors import ledger
from idraft.collectors.ai_prompt import (
    MANUAL_PROMPTS_MAX,
    SUBJECT_TYPE,
    AiPromptWorkload,
    queue_of,
)
from idraft.collectors.ledger import LedgerTask, NewRun, NewTask, TaskRef
from idraft.collectors.registry import Plan, ScheduleWindow
from idraft.domain.workloads import TaskWorkload
from idraft.providers.dataforseo.ai import (
    AI_MODE,
    CHATGPT_SCRAPER,
    GEMINI_SCRAPER,
    AiAnswerParams,
)
from tests.api.auth.support import execute
from tests.api.keywords.support import LOCATION, OTHER_LOCATION
from tests.collectors.ai_support import AiWorld, Prompt, add_prompt, enable_engine, make_ai_world
from tests.collectors.rank_support import Ledger
from tests.collectors.support import NOW, Project, make_schedule
from tests.conftest import PostgresServer

WORKLOAD = AiPromptWorkload()
ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")
QUESTION = "Which managed SOC providers work with mid-size banks?"


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


def _window(
    project: Project,
    selector: dict[str, Any] | None = None,
    *,
    schedule_id: uuid.UUID | None = None,
    mode: str = "standard_queue",
    hours: int = 12,
) -> ScheduleWindow:
    return ScheduleWindow(
        schedule_id=schedule_id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.AI_PROMPT,
        provider_mode=mode,
        selector=selector or {},
        window_start=NOW,
        window_end=NOW + timedelta(hours=hours),
        window_hours=hours,
    )


async def _plan(sessions: Ledger, window: ScheduleWindow) -> Plan:
    async with sessions() as db:
        return await WORKLOAD.plan(db, window)


async def _all_engines(pg: PostgresServer, project: Project) -> None:
    for code in ENGINES:
        await enable_engine(pg, project, code)


def _asked(plan: Plan) -> set[tuple[str, str | None]]:
    return {(task.subject_id, task.engine_code) for task in plan.tasks}


async def test_a_window_asks_each_active_prompt_once_on_each_enabled_engine(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    first = await add_prompt(migrated, project, QUESTION)
    second = await add_prompt(migrated, project, "Who offers 24x7 SOC monitoring in India?")
    await _all_engines(migrated, project)

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert len(plan.tasks) == 6
    assert _asked(plan) == {
        (str(prompt.version_id), code) for prompt in (first, second) for code in ENGINES
    }
    assert {(task.engine_code, task.provider_endpoint) for task in plan.tasks} == {
        ("chatgpt_web", CHATGPT_SCRAPER),
        ("gemini_web", GEMINI_SCRAPER),
        ("google_ai_mode", AI_MODE),
    }
    assert {task.subject_type for task in plan.tasks} == {SUBJECT_TYPE}
    assert {(task.location_id, task.replicate_index, task.depth) for task in plan.tasks} == {
        (LOCATION, 1, None)
    }
    assert plan.estimated_cost_usd == Decimal("0.0072")
    snapshot = plan.config_snapshot
    assert (snapshot["queue"], snapshot["replicates"], snapshot["skipped_total"]) == (
        "standard",
        1,
        0,
    )


async def test_a_schedules_tasks_are_spread_over_its_window_the_same_way_every_run(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    for number in range(5):
        await add_prompt(migrated, project, f"{QUESTION} Case {number}.")
    await enable_engine(migrated, project, "chatgpt_web")
    window = _window(project, schedule_id=uuid.uuid4())

    once = await _plan(worker_db, window)
    twice = await _plan(worker_db, window)

    due = [task.scheduled_for for task in once.tasks]
    assert due == [task.scheduled_for for task in twice.tasks]
    assert all(NOW <= when < NOW + timedelta(hours=12) for when in due)
    assert len(set(due)) > 1


async def test_a_prompt_too_long_for_ai_mode_is_skipped_there_with_the_reason(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    long = await add_prompt(migrated, project, "Why " + "x" * 700)
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "google_ai_mode")

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert _asked(plan) == {(str(long.version_id), "chatgpt_web")}
    assert plan.config_snapshot["skipped"] == [
        {"prompt_id": str(long.id), "engine_code": "google_ai_mode", "reason": "prompt_too_long"}
    ]
    assert plan.config_snapshot["skipped_total"] == 1


async def test_archived_prompts_and_engines_turned_off_are_not_asked(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    live = await add_prompt(migrated, project, QUESTION)
    await add_prompt(migrated, project, "An archived prompt about SOC pricing?", active=False)
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "gemini_web", enabled=False)

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert _asked(plan) == {(str(live.version_id), "chatgpt_web")}


async def test_a_prompt_whose_country_no_engine_location_has_is_skipped(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    nowhere = await add_prompt(migrated, project, QUESTION, country="ZZ")
    british = await add_prompt(
        migrated, project, "Best SOC providers for UK retailers?", country="GB"
    )
    await enable_engine(migrated, project, "chatgpt_web", location_ids=[LOCATION])

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert plan.tasks == []
    assert sorted(
        (item["prompt_id"], item["reason"]) for item in plan.config_snapshot["skipped"]
    ) == sorted(
        [(str(nowhere.id), "location_not_enabled"), (str(british.id), "location_not_enabled")]
    )


async def test_an_engine_in_two_countries_asks_each_prompt_in_its_own(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    american = await add_prompt(migrated, project, QUESTION)
    british = await add_prompt(
        migrated, project, "Best SOC providers for UK retailers?", country="GB"
    )
    await enable_engine(migrated, project, "chatgpt_web", location_ids=[LOCATION, OTHER_LOCATION])

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert {(task.subject_id, task.location_id) for task in plan.tasks} == {
        (str(american.version_id), LOCATION),
        (str(british.version_id), OTHER_LOCATION),
    }


async def test_a_manual_run_asks_the_prompts_and_engines_it_names_at_once(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    named = await add_prompt(migrated, project, QUESTION)
    await add_prompt(migrated, project, "Who offers 24x7 SOC monitoring in India?")
    await _all_engines(migrated, project)
    selector = {"prompt_ids": [str(named.id)], "engine_codes": ["gemini_web"]}

    plan = await _plan(worker_db, _window(project, selector))

    assert _asked(plan) == {(str(named.version_id), "gemini_web")}
    assert [task.scheduled_for for task in plan.tasks] == [NOW]
    assert plan.estimated_cost_usd == Decimal("0.0012")
    assert plan.config_snapshot["selector"] == selector


async def test_a_manual_run_without_prompts_asks_nothing_and_one_of_too_many_is_refused(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await add_prompt(migrated, project, QUESTION)
    await _all_engines(migrated, project)
    too_many = {"prompt_ids": [str(uuid.uuid4()) for _ in range(MANUAL_PROMPTS_MAX + 1)]}

    nothing = await _plan(worker_db, _window(project, {}))

    assert nothing.tasks == []
    with pytest.raises(ValueError, match="at most 100"):
        await _plan(worker_db, _window(project, too_many))


async def _scheduled_run(
    sessions: Ledger, project: Project, schedule_id: uuid.UUID, prompt: Prompt, engine: str
) -> None:
    """A run of another schedule whose window overlaps NOW, with a task for the prompt."""
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=schedule_id,
                workload=TaskWorkload.AI_PROMPT,
                window_start=NOW - timedelta(hours=2),
                window_end=NOW + timedelta(hours=2),
                trigger="schedule",
                config_snapshot={},
            ),
            now=NOW,
        )
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                NewTask(
                    subject_type=SUBJECT_TYPE,
                    subject_id=str(prompt.version_id),
                    engine_code=engine,
                    location_id=LOCATION,
                    replicate_index=1,
                    depth=None,
                    request_fingerprint=hashlib.sha256(uuid.uuid4().bytes).digest(),
                    provider_code="dataforseo",
                    provider_endpoint=CHATGPT_SCRAPER,
                    scheduled_for=NOW,
                )
            ],
        )


async def test_a_prompt_another_schedule_asked_in_this_window_is_not_asked_twice(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    prompt = await add_prompt(migrated, project, QUESTION)
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "gemini_web")
    other = await make_schedule(migrated, project, workload="ai_prompt")
    await _scheduled_run(worker_db, project, other, prompt, "chatgpt_web")

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))
    manual = await _plan(worker_db, _window(project, {"prompt_ids": [str(prompt.id)]}))

    assert _asked(plan) == {(str(prompt.version_id), "gemini_web")}
    # A person who asks gets an answer, whatever the schedules did.
    assert len(manual.tasks) == 2


async def test_the_priority_queue_is_the_schedules_choice_and_costs_twice(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await add_prompt(migrated, project, QUESTION)
    await enable_engine(migrated, project, "chatgpt_web")

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4(), mode="priority_queue"))

    assert plan.config_snapshot["queue"] == "priority"
    assert plan.estimated_cost_usd == Decimal("0.0024")
    assert (queue_of("live"), queue_of("standard_queue")) == ("standard", "standard")


def _ledger_task(
    project: Project, run_id: uuid.UUID, prompt: Prompt, engine: str, number: int
) -> LedgerTask:
    return LedgerTask(
        ref=TaskRef(id=number, created_at=NOW),
        run_id=run_id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.AI_PROMPT,
        subject_type=SUBJECT_TYPE,
        subject_id=str(prompt.version_id),
        engine_code=engine,
        location_id=OTHER_LOCATION,
        replicate_index=1,
        provider_code="dataforseo",
        provider_endpoint=CHATGPT_SCRAPER,
        provider_task_id=None,
        status="pending",
        attempts=0,
        scheduled_for=NOW,
        priority="high",
        window_end=NOW + timedelta(hours=1),
    )


async def _manual_run(sessions: Ledger, project: Project, queue: str) -> uuid.UUID:
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=None,
                workload=TaskWorkload.AI_PROMPT,
                window_start=NOW,
                window_end=NOW + timedelta(hours=1),
                trigger="manual",
                config_snapshot={"queue": queue},
            ),
            now=NOW,
        )
    assert run_id is not None
    return run_id


async def test_a_request_asks_the_prompt_as_saved_at_its_location_and_queue(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) VALUES ('dataforseo', $1, '9002826', ARRAY['serp']) "
        "ON CONFLICT (provider_code, location_id) DO UPDATE SET provider_value = '9002826'",
        OTHER_LOCATION,
    )
    prompt = await add_prompt(migrated, project, QUESTION, country="GB", language="de")
    archived = await add_prompt(migrated, project, "Archived later, about SOC tools?")
    run_id = await _manual_run(worker_db, project, "priority")
    tasks = [
        _ledger_task(project, run_id, prompt, "chatgpt_web", 1),
        _ledger_task(project, run_id, archived, "chatgpt_web", 2),
    ]
    await execute(migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", archived.id)

    async with worker_db() as db:
        requests = await WORKLOAD.build_requests(db, tasks)

    assert set(requests) == {tasks[0].ref}
    request = requests[tasks[0].ref]
    assert request.params == AiAnswerParams(
        prompt=QUESTION, location_code=9002826, language_code="de", queue="priority"
    )
    assert (request.task_id, request.run_id, request.priority) == ("1", run_id, "high")
    assert WORKLOAD.batch_key(tasks[0]) == ""
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/collectors/test_ai_prompt.py --no-cov -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'idraft.collectors.ai_prompt'`.

- [ ] **Step 4: Write the workload**

Create `backend/src/idraft/collectors/ai_prompt.py`:

```python
"""AI answers from the ChatGPT scraper, the Gemini scraper and Google AI Mode (spec section 4.3;
docs/07-dataforseo-ai-integration.md; docs/21-scheduler-workers.md section 3): the workload that
plans a task for each active prompt, enabled engine and location of a window and builds its
`task_post` request.

A task is one prompt version on one engine at one location: subject type `prompt_version`,
subject id the version's id, the engine in `engine_code`, one replicate (spec section 8). A window
asks each of them once: the ledger's idempotency key makes a second planning of a run add nothing,
and a schedule's window leaves out what another schedule's run of an overlapping window has asked.
How often a window comes is the schedule's business; nothing here knows a cadence. Every read
names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal
from uuid import UUID

import structlog
from pydantic import ValidationError
from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.ai.pricing import task_prices
from idraft.collectors.ledger import LedgerTask, NewTask, TaskRef
from idraft.collectors.registry import Plan, ScheduleWindow
from idraft.collectors.seo_rank import location_codes, run_queues
from idraft.domain.ai_engines import Queue
from idraft.db.tables import (
    ai_engines,
    ai_project_engines,
    ai_prompt_versions,
    ai_prompts,
    collection_runs,
    collection_tasks,
    locations,
    projects,
)
from idraft.domain.tasks import scheduled_for
from idraft.domain.workloads import TaskWorkload
from idraft.extraction.ai_facts import EXTRACTOR_VERSION
from idraft.providers.contract import CanonicalRequest
from idraft.providers.dataforseo.ai import ENGINE_ENDPOINTS, PROMPT_MAX, AiAnswerParams
from idraft.providers.dataforseo.ai_parse import PARSER_VERSION
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO

WORKLOAD: Final = TaskWorkload.AI_PROMPT
SUBJECT_TYPE: Final = "prompt_version"
ADAPTER: Final = "dataforseo_ai_answers@1"
# What one manual run takes. Run now names one prompt; a run naming more than this is refused,
# not priced and sent.
MANUAL_PROMPTS_MAX: Final = 100
# How many skipped subjects a run's snapshot lists; `skipped_total` always counts them all.
SKIPPED_KEPT: Final = 200
# A task the provider has not answered, or that no one has read yet.
UNSETTLED: Final = ("pending", "submit_unknown", "submitted", "ready", "fetched")
# A task of another run that has not asked, and will not ask, its prompt.
_NOT_ASKED: Final = ("cancelled", "failed", "dead")
SkipReason = Literal["prompt_too_long", "location_not_enabled"]
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Subject:
    prompt_id: UUID
    version_id: UUID
    engine_code: str
    location_id: int


@dataclass(frozen=True, slots=True)
class Skipped:
    prompt_id: UUID
    engine_code: str
    reason: SkipReason


@dataclass(frozen=True, slots=True)
class _Prompt:
    id: UUID
    version_id: UUID
    length: int
    country_iso: str | None


def _uuids(values: Any) -> list[UUID]:
    return [UUID(str(value)) for value in values]


async def _prompts(
    db: AsyncSession, window: ScheduleWindow, chosen: Sequence[UUID] | None
) -> list[_Prompt]:
    """The project's active prompts with their current version (only those chosen, when a
    manual run names them)."""
    p, v, pr = ai_prompts.c, ai_prompt_versions.c, projects.c
    statement = (
        select(
            p.id,
            p.current_version_id,
            p.country_iso,
            func.char_length(v.text).label("length"),
        )
        .select_from(
            ai_prompts.join(
                ai_prompt_versions,
                and_(v.id == p.current_version_id, v.workspace_id == p.workspace_id),
            ).join(projects, and_(pr.id == p.project_id, pr.workspace_id == p.workspace_id))
        )
        .where(
            p.workspace_id == window.workspace_id,
            p.project_id == window.project_id,
            p.deleted_at.is_(None),
            p.is_active,
            pr.deleted_at.is_(None),
        )
    )
    if chosen is not None:
        statement = statement.where(p.id.in_(list(chosen)))
    return [
        _Prompt(
            id=row.id,
            version_id=row.current_version_id,
            length=row.length,
            country_iso=None if row.country_iso is None else str(row.country_iso).strip(),
        )
        for row in await db.execute(statement)
    ]


async def _engines(
    db: AsyncSession, window: ScheduleWindow, chosen: Sequence[str] | None
) -> dict[str, tuple[int, ...]]:
    """The project's enabled engines this workload can ask, with their locations."""
    e, g = ai_project_engines.c, ai_engines.c
    statement = (
        select(e.engine_code, e.location_ids)
        .join(ai_engines, g.code == e.engine_code)
        .where(
            e.workspace_id == window.workspace_id,
            e.project_id == window.project_id,
            e.is_enabled,
            g.is_active,
            e.engine_code.in_(sorted(ENGINE_ENDPOINTS)),
        )
    )
    if chosen is not None:
        statement = statement.where(e.engine_code.in_(list(chosen)))
    return {row.engine_code: tuple(row.location_ids or ()) for row in await db.execute(statement)}


async def _location_countries(db: AsyncSession, location_ids: Collection[int]) -> dict[int, str]:
    """The country of each active location."""
    if not location_ids:
        return {}
    loc = locations.c
    rows = await db.execute(
        select(loc.id, loc.country_iso).where(loc.id.in_(sorted(location_ids)), loc.is_active)
    )
    return {row.id: str(row.country_iso).strip() for row in rows}


async def _asked_elsewhere(db: AsyncSession, window: ScheduleWindow) -> set[tuple[str, str | None]]:
    """(version id, engine) pairs another schedule's run of an overlapping window has asked or
    will ask. A manual run is never held back by them: a person asked."""
    if window.schedule_id is None:
        return set()
    t, r = collection_tasks.c, collection_runs.c
    rows = await db.execute(
        select(t.subject_id, t.engine_code)
        .distinct()
        .select_from(
            collection_tasks.join(
                collection_runs, and_(r.id == t.run_id, r.workspace_id == t.workspace_id)
            )
        )
        .where(
            t.workspace_id == window.workspace_id,
            t.project_id == window.project_id,
            t.workload == WORKLOAD.value,
            t.subject_type == SUBJECT_TYPE,
            t.status.not_in(_NOT_ASKED),
            r.schedule_id.is_not(None),
            r.schedule_id != window.schedule_id,
            r.window_start < window.window_end,
            r.window_end > window.window_start,
        )
    )
    return {(row.subject_id, row.engine_code) for row in rows}


async def select_subjects(
    db: AsyncSession, window: ScheduleWindow
) -> tuple[list[Subject], list[Skipped]]:
    """What the window asks, once each, and what it leaves out and why."""
    chosen_prompts: list[UUID] | None = None
    chosen_engines: list[str] | None = None
    if window.schedule_id is None:
        named = window.selector.get("prompt_ids")
        if not named:
            return [], []
        if len(named) > MANUAL_PROMPTS_MAX:
            raise ValueError(f"a manual AI run takes at most {MANUAL_PROMPTS_MAX} prompts")
        chosen_prompts = _uuids(named)
        engines_named = window.selector.get("engine_codes")
        if engines_named is not None:
            chosen_engines = [str(code) for code in engines_named]
    prompts = await _prompts(db, window, chosen_prompts)
    engines = await _engines(db, window, chosen_engines)
    if not prompts or not engines:
        return [], []
    countries = await _location_countries(
        db, {location for allowed in engines.values() for location in allowed}
    )
    asked = await _asked_elsewhere(db, window)
    subjects: list[Subject] = []
    skipped: list[Skipped] = []
    for prompt in prompts:
        for engine_code, allowed in sorted(engines.items()):
            if prompt.length > PROMPT_MAX[ENGINE_ENDPOINTS[engine_code]]:
                skipped.append(Skipped(prompt.id, engine_code, "prompt_too_long"))
                continue
            here = [
                location
                for location in allowed
                if prompt.country_iso is not None and countries.get(location) == prompt.country_iso
            ]
            if not here:
                skipped.append(Skipped(prompt.id, engine_code, "location_not_enabled"))
                continue
            if (str(prompt.version_id), engine_code) in asked:
                continue
            subjects.extend(
                Subject(prompt.id, prompt.version_id, engine_code, location) for location in here
            )
    subjects.sort(key=lambda s: (s.location_id, s.engine_code, str(s.version_id)))
    return subjects, skipped


def queue_of(provider_mode: str) -> Literal["standard", "priority"]:
    """The priority queue only when the schedule chose it. AI answers are never asked live
    (spec section 4.3), so every other mode is the standard queue."""
    return "priority" if provider_mode == "priority_queue" else "standard"


async def estimate(
    db: AsyncSession, subjects: Sequence[Subject], *, queue: Queue, on: date
) -> Decimal | None:
    """What the subjects cost by the price book (plan A's `task_prices`): each endpoint's task
    price at the queue. None,
    and an error in the log, when an endpoint has no price: a run is never planned on a guess of
    zero."""
    if not subjects:
        return Decimal(0)
    wanted = {ENGINE_ENDPOINTS[subject.engine_code] for subject in subjects}
    prices = await task_prices(db, queue=queue, on=on)
    missing = wanted - prices.keys()
    if missing:
        _log.error("no price for AI answers", endpoints=sorted(missing), queue=queue)
        return None
    return sum((prices[ENGINE_ENDPOINTS[subject.engine_code]] for subject in subjects), Decimal(0))


def _due(window: ScheduleWindow, subject: Subject) -> datetime:
    """A schedule's tasks are spread over its window; a manual run has someone waiting."""
    if window.schedule_id is None:
        return window.window_start
    return scheduled_for(
        window_start=window.window_start,
        subject_id=f"{subject.version_id}:{subject.engine_code}",
        workload=WORKLOAD.value,
        window_hours=window.window_hours,
    )


def new_tasks(subjects: Sequence[Subject], window: ScheduleWindow) -> list[NewTask]:
    queue = queue_of(window.provider_mode)
    return [
        NewTask(
            subject_type=SUBJECT_TYPE,
            subject_id=str(subject.version_id),
            engine_code=subject.engine_code,
            location_id=subject.location_id,
            replicate_index=1,
            depth=None,
            request_fingerprint=hashlib.sha256(
                f"{subject.version_id}:{subject.engine_code}:{subject.location_id}:{queue}".encode()
            ).digest(),
            provider_code=DATAFORSEO,
            provider_endpoint=ENGINE_ENDPOINTS[subject.engine_code],
            scheduled_for=_due(window, subject),
        )
        for subject in subjects
    ]


def _skipped(skipped: Sequence[Skipped]) -> list[dict[str, str]]:
    return [
        {"prompt_id": str(item.prompt_id), "engine_code": item.engine_code, "reason": item.reason}
        for item in skipped[:SKIPPED_KEPT]
    ]


class AiPromptWorkload:
    """Plans AI answer tasks for a schedule's window or a manual run, and builds their
    requests."""

    name: Final = WORKLOAD

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        subjects, skipped = await select_subjects(db, window)
        queue = queue_of(window.provider_mode)
        cost = await estimate(db, subjects, queue=queue, on=window.window_start.date())
        snapshot: dict[str, Any] = {
            "adapter": ADAPTER,
            "normalizer_version": PARSER_VERSION,
            "extractor_version": EXTRACTOR_VERSION,
            "provider_mode": window.provider_mode,
            "queue": queue,
            "replicates": 1,
            "selector": dict(window.selector),
            "skipped": _skipped(skipped),
            "skipped_total": len(skipped),
        }
        if cost is None:
            # Nothing is planned without a price to check the budget against.
            return Plan(tasks=[], estimated_cost_usd=Decimal(0), config_snapshot=snapshot)
        return Plan(
            tasks=new_tasks(subjects, window), estimated_cost_usd=cost, config_snapshot=snapshot
        )

    def batch_key(self, task: LedgerTask) -> str:
        """Any tasks of one endpoint may go in one `task_post`; the dispatcher already splits
        by endpoint."""
        return ""

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        """Each task's prompt version as saved, at its location's DataForSEO code, in the
        prompt's language. A task whose prompt is gone or archived is left out."""
        wanted: dict[TaskRef, tuple[LedgerTask, UUID]] = {}
        for task in tasks:
            if task.subject_type != SUBJECT_TYPE or task.engine_code not in ENGINE_ENDPOINTS:
                continue
            try:
                wanted[task.ref] = (task, UUID(task.subject_id))
            except ValueError:
                continue
        versions = await _versions(
            db, {(version_id, task.workspace_id) for task, version_id in wanted.values()}
        )
        codes = await location_codes(db, {task.location_id for task, _ in wanted.values()})
        queues = await run_queues(db, {task.run_id for task, _ in wanted.values()})
        requests: dict[TaskRef, CanonicalRequest] = {}
        for ref, (task, version_id) in wanted.items():
            found = versions.get((version_id, task.workspace_id))
            if found is None or task.location_id is None:
                continue
            try:
                params = AiAnswerParams(
                    prompt=found.text,
                    location_code=codes.get(task.location_id, task.location_id),
                    language_code=found.language_code,
                    queue="priority" if queues.get(task.run_id) == "priority" else "standard",
                )
            except ValidationError as error:
                # One prompt the provider would refuse must not take the tasks it is batched
                # with down: it is left out and recorded as a request that could not be built.
                _log.warning("AI request not built", task=task.ref.id, error=str(error)[:200])
                continue
            requests[ref] = CanonicalRequest(
                task_id=str(task.ref.id),
                run_id=task.run_id,
                priority="high" if task.priority == "high" else "standard",
                params=params,
            )
        return requests


@dataclass(frozen=True, slots=True)
class _Version:
    text: str
    language_code: str


async def _versions(
    db: AsyncSession, keys: Collection[tuple[UUID, UUID]]
) -> dict[tuple[UUID, UUID], _Version]:
    """The text of each (version, workspace) whose prompt is live and active."""
    if not keys:
        return {}
    v, p = ai_prompt_versions.c, ai_prompts.c
    rows = await db.execute(
        select(v.id, v.workspace_id, v.text, p.language_code)
        .select_from(
            ai_prompt_versions.join(
                ai_prompts, and_(p.id == v.prompt_id, p.workspace_id == v.workspace_id)
            )
        )
        .where(
            tuple_(v.id, v.workspace_id).in_(list(keys)),
            p.deleted_at.is_(None),
            # Archived since it was planned: not sent, not paid for.
            p.is_active,
        )
    )
    return {(row.id, row.workspace_id): _Version(row.text, row.language_code) for row in rows}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/collectors/test_ai_prompt.py tests/collectors/test_seo_rank.py --no-cov -q`
Expected: PASS (11 new tests).

- [ ] **Step 6: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/idraft/collectors/seo_rank.py backend/src/idraft/collectors/ai_prompt.py backend/tests/collectors/test_ai_prompt.py
git commit -m "AI prompts: the ai_prompt workload plans each prompt once per window"
```

## Task 6: Ingest and its tick

**Files:**
- Create: `backend/src/idraft/collectors/ai_prompt_ingest.py`
- Modify: `backend/src/idraft/worker/assembly.py` (imports, `production_registry`, `assemble`)
- Modify: `backend/tests/worker/test_assembly.py` (`test_rank_checks_are_registered_only_where_their_answers_can_be_kept`)
- Test: `backend/tests/collectors/test_ai_prompt_ingest.py`

One stored answer is one task is one `ai.observations` row, written once with everything that follows from it in one transaction:

1. Read the task's run, engine, replicate and attempts from `ops.collection_tasks`, then the prompt version it asked (by id, in Python: a subject id that is not a UUID is not this workload's). A version that is gone (its prompt deleted) writes nothing and the task is marked ingested.
2. Parse. An answer of another shape (`AiSchemaMismatchError`) is stored as an `error` observation with `error_code = 'schema_mismatch'` (spec section 5; doc 12 section 8 keeps the raw bytes for a later re-ingest), never dropped. A provider error, a refusal and an empty answer are stored with their status.
3. Extract with the project's context (`AiContextCache`, one per pass). A text that matches too often (`TooManyMatchesError`) keeps its citations and is not valid.
4. Insert the observation with `ON CONFLICT (collection_task_id, observed_at) DO NOTHING` (plan A's `observations_one_per_task`): a second ingest of the task writes nothing more. `observed_at` is the answer's own `datetime`, and only for an answer without one the task's `ready_at`; neither changes between reads.
5. Insert the citations (URLs added to `core.urls` and `core.domains` through `db.dictionaries.urls_for`), the project's current `ai.derivations` row (created on first use for `(project, EXTRACTOR_VERSION, entity_config_version, 0, 0)` with the project's workspace, on plan A's `derivations_identity`: 0 is "no classifier", slice 1 has none), the mentions and the fact row; then mark the task ingested.

Failures follow the rank ingest: a payload that cannot be read now, or a write that fails for a reason that may pass, waits and is tried again (`ingest_waits.not_now`); a write the database refuses for its data fails the task with its payload kept.

- [ ] **Step 1: Write the failing ingest test**

Create `backend/tests/collectors/test_ai_prompt_ingest.py`:

```python
"""Reading fetched AI answers into observations, citations, mentions and facts (spec sections
4.3 and 4.4). As `app_worker`, on the answers captured in spike S-04."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import pytest

from idraft.collectors.ai_prompt_ingest import current_derivation, ingest
from idraft.collectors.ingest_waits import IngestReport
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.ai_support import (
    AiWorld,
    Prompt,
    add_prompt,
    at_now,
    chatgpt_answer,
    fetched_ai_task,
    make_ai_world,
)
from tests.collectors.rank_support import Ledger
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

CAPTURED = FIXTURES / "captured"
AI = FIXTURES / "ai"
QUESTION = "What are the best managed SOC providers in India?"


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


async def _observation(pg: PostgresServer, task_id: int) -> dict[str, Any]:
    row = await fetchrow(pg, "SELECT * FROM ai.observations WHERE collection_task_id = $1", task_id)
    return dict(row)


async def _facts(pg: PostgresServer, observation_id: int) -> dict[str, Any]:
    row = await fetchrow(
        pg, "SELECT * FROM ai.observation_facts WHERE observation_id = $1", observation_id
    )
    return dict(row)


async def _count(pg: PostgresServer, table: str, observation_id: int) -> int:
    row = await fetchrow(
        pg, f"SELECT count(*) AS n FROM {table} WHERE observation_id = $1", observation_id
    )
    count: int = row["n"]
    return count


async def _task_status(pg: PostgresServer, task_id: int) -> str:
    row = await fetchrow(pg, "SELECT status FROM ops.collection_tasks WHERE id = $1", task_id)
    status: str = row["status"]
    return status


async def _gemini(
    worker_db: Ledger, pg: PostgresServer, world: AiWorld, store: MemoryStore
) -> tuple[Prompt, int]:
    prompt = await add_prompt(pg, world.project, QUESTION)
    body = at_now(CAPTURED / "gemini_scraper_answer.json")
    task_id = await fetched_ai_task(
        worker_db, pg, world.project, prompt, body, store, engine_code="gemini_web"
    )
    return prompt, task_id


async def test_a_stored_answer_becomes_its_observation_citations_mentions_and_facts(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt, task_id = await _gemini(worker_db, migrated, world, store)

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    assert await _task_status(migrated, task_id) == "ingested"
    observation = await _observation(migrated, task_id)
    assert observation["status"] == "complete"
    assert (observation["engine_code"], observation["observation_class"]) == (
        "gemini_web",
        "consumer_ui",
    )
    assert (observation["prompt_id"], observation["prompt_version_id"]) == (
        prompt.id,
        prompt.version_id,
    )
    assert observation["query_text"] == QUESTION
    assert observation["model_reported"] == "3.5 Flash-Lite"
    assert observation["citation_count"] == 5
    assert observation["has_citations"]
    assert observation["cost_usd"] == Decimal("0.0012")
    assert observation["answer_char_count"] == len(observation["answer_text"])
    assert len(observation["answer_hash"]) == 32
    assert (
        observation["adapter_version"],
        observation["normalizer_version"],
        observation["canonicalizer_version"],
    ) == (1, 1, 1)
    citations = await fetch(
        migrated,
        "SELECT citation_index, domain_role, role_entity_id, citation_kind, occurrences "
        "FROM ai.citations WHERE observation_id = $1 ORDER BY citation_index",
        observation["id"],
    )
    assert [(row["citation_index"], row["domain_role"]) for row in citations] == [
        (1, "competitor"),
        (2, "third_party"),
        (3, "third_party"),
        (4, "own"),
        (5, "third_party"),
    ]
    assert (citations[0]["role_entity_id"], citations[3]["role_entity_id"]) == (
        world.rival,
        world.own,
    )
    mentions = await fetch(
        migrated,
        "SELECT entity_id, role, mention_count, first_char_offset, mention_order, "
        "mention_status, evidence_spans FROM ai.entity_mentions WHERE observation_id = $1 "
        "ORDER BY mention_order",
        observation["id"],
    )
    assert [(row["entity_id"], row["role"], row["mention_order"]) for row in mentions] == [
        (world.rival, "competitor", 1),
        (world.own, "own", 2),
    ]
    own = mentions[1]
    assert own["first_char_offset"] == observation["answer_text"].index("Eventus Security")
    assert own["mention_status"] == "accepted"
    assert len(own["evidence_spans"]) == own["mention_count"]
    facts = await _facts(migrated, observation["id"])
    assert facts["is_valid"]
    assert (facts["own_mentioned"], facts["own_domain_cited"]) == (True, True)
    assert (facts["own_citation_count"], facts["total_citation_count"]) == (1, 5)
    assert facts["tracked_entities_mentioned"] == 2
    assert (facts["competitor_mentions"], facts["competitor_cited"]) == (
        [world.rival],
        [world.rival],
    )
    assert facts["is_current"]
    derivation = await fetchrow(
        migrated, "SELECT * FROM ai.derivations WHERE id = $1", facts["derivation_id"]
    )
    assert (derivation["extractor_version"], derivation["entity_config_version"]) == (1, 1)


async def test_ingesting_twice_writes_one_observation(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    _, task_id = await _gemini(worker_db, migrated, world, store)
    await ingest(worker_db, store)
    # The task is fetched again, as if its first ingest had been rolled back after the commit.
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'fetched' WHERE id = $1", task_id
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    observation = await _observation(migrated, task_id)
    assert await _count(migrated, "ai.citations", observation["id"]) == 5
    assert await _count(migrated, "ai.entity_mentions", observation["id"]) == 2
    assert await _count(migrated, "ai.observation_facts", observation["id"]) == 1


@pytest.mark.parametrize(
    ("fixture", "status", "error_code"),
    [
        ("chatgpt_refused", "refused", None),
        ("chatgpt_empty", "empty", None),
        ("task_error", "error", "40501"),
    ],
)
async def test_an_answer_that_counts_in_no_rate_is_stored_with_its_status(
    worker_db: Ledger,
    migrated: PostgresServer,
    world: AiWorld,
    fixture: str,
    status: str,
    error_code: str | None,
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    body = at_now(AI / f"{fixture}.json")
    task_id = await fetched_ai_task(worker_db, migrated, world.project, prompt, body, store)

    await ingest(worker_db, store)

    observation = await _observation(migrated, task_id)
    assert (observation["status"], observation["error_code"]) == (status, error_code)
    assert not (await _facts(migrated, observation["id"]))["is_valid"]
    assert await _task_status(migrated, task_id) == "ingested"


async def test_an_answer_of_another_shape_is_an_error_observation_with_its_payload(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    task_id = await fetched_ai_task(
        worker_db, migrated, world.project, prompt, b'{"tasks": []}', store
    )

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    observation = await _observation(migrated, task_id)
    assert (observation["status"], observation["error_code"]) == ("error", "schema_mismatch")
    assert observation["answer_text"] is None
    assert observation["raw_payload_id"] is not None
    assert not (await _facts(migrated, observation["id"]))["is_valid"]


async def test_a_link_target_is_a_citation_and_never_a_mention(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt = await add_prompt(migrated, world.project, QUESTION)
    text = (
        "Several firms run managed SOCs in India; see "
        "[this list](https://eventussecurity.com/soc-list) for one view."
    )
    body = chatgpt_answer(text, ["https://eventussecurity.com/soc-list"])
    task_id = await fetched_ai_task(worker_db, migrated, world.project, prompt, body, store)

    await ingest(worker_db, store)

    observation = await _observation(migrated, task_id)
    facts = await _facts(migrated, observation["id"])
    assert (facts["own_mentioned"], facts["own_domain_cited"]) == (False, True)
    assert await _count(migrated, "ai.entity_mentions", observation["id"]) == 0


async def test_the_task_of_a_deleted_prompt_is_ingested_into_nothing(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    prompt, task_id = await _gemini(worker_db, migrated, world, store)
    await execute(migrated, "DELETE FROM ai.prompts WHERE id = $1", prompt.id)

    report = await ingest(worker_db, store)

    assert report == IngestReport(ingested=1)
    rows = await fetch(
        migrated, "SELECT id FROM ai.observations WHERE collection_task_id = $1", task_id
    )
    assert rows == []


async def test_a_new_entity_configuration_gets_its_own_derivation(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    async with worker_db() as db, db.begin():
        first = await current_derivation(db, project.workspace_id, project.id, 1)
        again = await current_derivation(db, project.workspace_id, project.id, 1)
        second = await current_derivation(db, project.workspace_id, project.id, 2)

    assert first == again
    assert second != first


async def test_answers_of_two_projects_are_read_with_their_own_entities(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    store = MemoryStore()
    other = await make_ai_world(migrated)
    await execute(
        migrated,
        "UPDATE core.project_entities SET track_ai = false WHERE project_id = $1",
        other.project.id,
    )
    _, mine = await _gemini(worker_db, migrated, world, store)
    theirs_prompt = await add_prompt(migrated, other.project, QUESTION)
    theirs = await fetched_ai_task(
        worker_db,
        migrated,
        other.project,
        theirs_prompt,
        at_now(CAPTURED / "gemini_scraper_answer.json"),
        store,
        engine_code="gemini_web",
    )

    await ingest(worker_db, store)

    assert (await _facts(migrated, (await _observation(migrated, mine))["id"]))["own_mentioned"]
    their_facts = await _facts(migrated, (await _observation(migrated, theirs))["id"])
    assert (their_facts["own_mentioned"], their_facts["tracked_entities_mentioned"]) == (False, 0)
    assert uuid.UUID(str(their_facts["project_id"])) == other.project.id
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/collectors/test_ai_prompt_ingest.py --no-cov -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'idraft.collectors.ai_prompt_ingest'`.

- [ ] **Step 3: Write the ingest**

Create `backend/src/idraft/collectors/ai_prompt_ingest.py`:

```python
"""Reading fetched AI answers into observations and their facts (spec sections 4.3 and 4.4).

One stored answer is one task is one `ai.observations` row, with its citations, the project's
entity mentions and the fact row under the project's current derivation, all written in one
transaction and once: the observation is unique per task, so ingesting a task twice writes
nothing the second time. An answer that cannot be read is stored as an `error` observation with
its code, so it counts in coverage and in no rate. Every read and write names the workspace,
because the worker bypasses row-level security.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

import structlog
from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ai_context import AiContext, AiContextCache
from idraft.collectors.ingest_waits import IngestReport, not_now
from idraft.collectors.ledger import FetchedTask
from idraft.collectors.raw_payloads import load_raw_payload
from idraft.collectors.seo_rank_ingest import (
    INGEST_GIVE_UP,
    INGEST_RETRY,
    NOT_READ,
    NOT_STORABLE,
    NOT_WRITTEN,
    repeats,
)
from idraft.db import dictionaries
from idraft.db.tables import (
    ai_citations,
    ai_derivations,
    ai_engines,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observations,
    ai_prompt_versions,
    ai_prompts,
    collection_tasks,
)
from idraft.domain.workloads import TaskWorkload
from idraft.extraction.ai_facts import (
    EXTRACTOR_VERSION,
    AnswerFacts,
    SourceIn,
    extract_answer_facts,
)
from idraft.extraction.aliases import TooManyMatchesError
from idraft.extraction.urls import CANONICALIZER_VERSION
from idraft.providers.dataforseo.ai import ADAPTER_VERSION
from idraft.providers.dataforseo.ai_parse import (
    PARSER_VERSION,
    AiSchemaMismatchError,
    CitedSource,
    NormalizedAnswer,
    parse_ai_answer,
    unreadable,
)
from idraft.storage.raw import ObjectStore, RawStorageError

WORKLOAD: Final = TaskWorkload.AI_PROMPT
SUBJECT_TYPE: Final = "prompt_version"
# Fetched tasks one pass reads.
INGEST_LIMIT: Final = 2000
SCHEMA_MISMATCH: Final = "schema_mismatch"
# Slice 1 classifies neither recommendation nor sentiment: version 0 is "no classifier".
RECOMMENDATION_VERSION: Final = 0
SENTIMENT_VERSION: Final = 0
# What a smallint column holds.
_SMALLINT_MAX: Final = 32_767
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class _Subject:
    run_id: uuid.UUID
    engine_code: str
    replicate_index: int
    attempts: int
    prompt_id: uuid.UUID
    version_id: uuid.UUID
    text: str
    language_code: str
    observation_class: str


async def ingest(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = INGEST_LIMIT
) -> IngestReport:
    """Read fetched AI tasks into observations, one task at a time, each in its own transaction.
    Safe to run twice. An answer that cannot be read from storage or written now waits, so it
    holds up neither the other answers nor its run."""
    async with sessions() as db:
        now = await ledger.transaction_time(db)
        fetched = await ledger.fetched_tasks(db, workload=WORKLOAD, limit=limit, now=now)
    contexts = AiContextCache()
    ingested = failed = waiting = 0
    # The tasks come ordered by payload, so only the last body needs to be held.
    last_id: int | None = None
    last_body: bytes | None = None
    for task in fetched:
        if task.raw_payload_id != last_id:
            last_id = task.raw_payload_id
            try:
                last_body = await load_raw_payload(sessions, store, last_id)
            except RawStorageError as error:
                _log.warning("stored answer not read", payload=last_id, error=str(error))
                last_body = None
        if last_body is None:
            later, gave_up = await _wait(
                sessions, task, NOT_READ, "The stored answer could not be read."
            )
            waiting, failed = waiting + later, failed + gave_up
            continue
        try:
            async with sessions() as db, db.begin():
                now = await ledger.transaction_time(db)
                await _keep(db, task, last_body, contexts)
                ingested += await ledger.mark_ingested(db, task.ref, now=now)
        except Exception as error:
            if repeats(error):
                _log.exception("stored answer cannot be stored", task=task.ref.id)
                failed += await _fail(sessions, task, NOT_STORABLE, type(error).__name__)
                continue
            # Rolled back as a whole: nothing of this answer is kept, and the next answers are
            # still ingested.
            _log.exception("stored answer not ingested", task=task.ref.id)
            later, gave_up = await _wait(
                sessions, task, NOT_WRITTEN, "The answer could not be written."
            )
            waiting, failed = waiting + later, failed + gave_up
    return IngestReport(ingested=ingested, failed=failed, waiting=waiting)


async def _wait(
    sessions: async_sessionmaker[AsyncSession], task: FetchedTask, code: str, message: str
) -> tuple[int, int]:
    return await not_now(
        sessions, [task], code=code, message=message, retry=INGEST_RETRY, give_up=INGEST_GIVE_UP
    )


async def _fail(
    sessions: async_sessionmaker[AsyncSession], task: FetchedTask, code: str, message: str
) -> int:
    _log.error("stored answer not ingested for good", task=task.ref.id, code=code, error=message)
    async with sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        return int(await ledger.ingest_failed(db, task.ref, code=code, message=message, now=now))


async def _keep(db: AsyncSession, task: FetchedTask, body: bytes, contexts: AiContextCache) -> None:
    """One task's rows. A task whose prompt version is gone, or of a project that is gone,
    gets nothing."""
    subject = await _subject(db, task)
    if subject is None:
        return
    context = await contexts.get(db, task.workspace_id, task.project_id)
    if context is None:
        return
    try:
        answer = parse_ai_answer(subject.engine_code, body)
    except AiSchemaMismatchError as error:
        _log.warning("AI answer of another shape", task=task.ref.id, path=error.path)
        answer = unreadable(SCHEMA_MISMATCH)
    observed_at = answer.observed_at or task.fetched_at
    kept = [source for source in answer.sources if source.url is not None]
    facts = _facts(answer, kept, context, task)
    observation_id = await _insert_observation(db, task, subject, answer, observed_at, facts)
    if observation_id is None:
        return  # this task has its observation already
    await _insert_citations(db, task, subject, observation_id, observed_at, kept, facts)
    derivation_id = await current_derivation(
        db, task.workspace_id, task.project_id, context.entity_config_version
    )
    await _insert_mentions(db, task, subject, observation_id, observed_at, derivation_id, facts)
    await _insert_fact(db, task, subject, observation_id, observed_at, derivation_id, facts)


def _facts(
    answer: NormalizedAnswer, kept: Sequence[CitedSource], context: AiContext, task: FetchedTask
) -> AnswerFacts:
    sources = [
        SourceIn(
            url=source.url, raw_url=source.raw_url, kind=source.kind, occurrences=source.occurrences
        )
        for source in kept
        if source.url is not None
    ]
    try:
        return extract_answer_facts(
            answer.answer_text,
            sources,
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=answer.is_valid,
        )
    except TooManyMatchesError:
        # The same text matches as often on every try: its citations are kept and the answer
        # counts in no rate.
        _log.warning("AI answer matches too often", task=task.ref.id)
        return extract_answer_facts(
            None,
            sources,
            matcher=context.matcher,
            resolver=context.resolver,
            roles=context.roles,
            is_valid=False,
        )


async def _subject(db: AsyncSession, task: FetchedTask) -> _Subject | None:
    t = collection_tasks.c
    row = (
        await db.execute(
            select(t.run_id, t.engine_code, t.replicate_index, t.attempts, t.subject_type).where(
                t.id == task.ref.id,
                t.created_at == task.ref.created_at,
                t.workspace_id == task.workspace_id,
            )
        )
    ).one_or_none()
    if row is None or row.subject_type != SUBJECT_TYPE or row.engine_code is None:
        return None
    try:
        version_id = uuid.UUID(task.subject_id)
    except ValueError:
        return None
    v, p, g = ai_prompt_versions.c, ai_prompts.c, ai_engines.c
    found = (
        await db.execute(
            select(v.prompt_id, v.text, p.language_code)
            .select_from(ai_prompt_versions.join(ai_prompts, p.id == v.prompt_id))
            .where(
                v.id == version_id,
                v.workspace_id == task.workspace_id,
                p.workspace_id == task.workspace_id,
                p.project_id == task.project_id,
            )
        )
    ).one_or_none()
    observation_class: str | None = (
        await db.execute(select(g.observation_class).where(g.code == row.engine_code))
    ).scalar_one_or_none()
    if found is None or observation_class is None:
        return None
    return _Subject(
        run_id=row.run_id,
        engine_code=row.engine_code,
        replicate_index=row.replicate_index,
        attempts=row.attempts,
        prompt_id=found.prompt_id,
        version_id=version_id,
        text=found.text,
        language_code=found.language_code,
        observation_class=observation_class,
    )


async def _insert_observation(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
    answer: NormalizedAnswer,
    observed_at: datetime,
    facts: AnswerFacts,
) -> int | None:
    text = answer.answer_text
    values: dict[str, Any] = {
        "observed_at": observed_at,
        "observed_date": observed_at.astimezone(UTC).date(),
        "workspace_id": task.workspace_id,
        "project_id": task.project_id,
        "engine_code": subject.engine_code,
        "observation_class": subject.observation_class,
        "prompt_id": subject.prompt_id,
        "prompt_version_id": subject.version_id,
        "query_text": subject.text,
        "collection_run_id": subject.run_id,
        "collection_task_id": task.ref.id,
        "replicate_index": subject.replicate_index,
        "location_id": task.location_id,
        "language_code": answer.language_code or subject.language_code,
        "device": answer.device,
        "provider_code": task.provider_code,
        "provider_endpoint": task.provider_endpoint,
        "provider_task_id": task.provider_task_id,
        "model_reported": answer.model_reported,
        "status": answer.status,
        "answer_text": text,
        "answer_markdown": text,
        "answer_char_count": None if text is None else len(text),
        "answer_hash": None if text is None else hashlib.sha256(text.encode()).digest(),
        "has_citations": bool(facts.citations),
        "citation_count": min(len(facts.citations), _SMALLINT_MAX),
        "fanout_count": min(answer.fan_out_count, _SMALLINT_MAX),
        "raw_payload_id": task.raw_payload_id,
        "adapter_version": ADAPTER_VERSION,
        "normalizer_version": PARSER_VERSION,
        "canonicalizer_version": CANONICALIZER_VERSION,
        "cost_usd": task.cost_usd,
        "retry_count": max(0, subject.attempts - 1),
        "error_code": answer.error_code,
        "provider_extras": None if answer.provider_extras is None else dict(answer.provider_extras),
    }
    inserted = await db.execute(
        upsert(ai_observations)
        .values(values)
        .on_conflict_do_nothing(index_elements=["collection_task_id", "observed_at"])
        .returning(ai_observations.c.id)
    )
    observation_id: int | None = inserted.scalar_one_or_none()
    return observation_id


async def _insert_citations(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
    observation_id: int,
    observed_at: datetime,
    kept: Sequence[CitedSource],
    facts: AnswerFacts,
) -> None:
    if not facts.citations:
        return
    rows = await dictionaries.urls_for(db, [citation.url for citation in facts.citations])
    await db.execute(
        insert(ai_citations),
        [
            {
                "observation_id": observation_id,
                "observed_at": observed_at,
                "citation_index": citation.index,
                "workspace_id": task.workspace_id,
                "project_id": task.project_id,
                "engine_code": subject.engine_code,
                "url_id": rows[citation.url.url_hash].id,
                "domain_id": rows[citation.url.url_hash].domain_id,
                "raw_url": citation.raw_url,
                "title": source.title,
                "source_name": source.source_name,
                "citation_kind": citation.kind,
                "first_char_offset": citation.first_char_offset,
                "answer_block_index": source.answer_block_index,
                "occurrences": min(citation.occurrences, _SMALLINT_MAX),
                "domain_role": citation.domain_role,
                "role_entity_id": citation.role_entity_id,
                "referral_tag": citation.url.referral_tag,
                "flags": sorted(citation.url.flags),
            }
            for source, citation in zip(kept, facts.citations, strict=True)
        ],
    )


async def current_derivation(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID, entity_config_version: int
) -> int:
    """The project's derivation for this extractor and entity configuration, made on first use
    (doc 04 section 8.5; plan A's `derivations_identity`)."""
    key = {
        "project_id": project_id,
        "extractor_version": EXTRACTOR_VERSION,
        "entity_config_version": entity_config_version,
        "recommendation_version": RECOMMENDATION_VERSION,
        "sentiment_version": SENTIMENT_VERSION,
    }
    await db.execute(
        upsert(ai_derivations)
        .values(workspace_id=workspace_id, **key)
        .on_conflict_do_nothing(index_elements=list(key))
    )
    d = ai_derivations.c
    derivation_id: int = (
        await db.execute(
            select(d.id).where(
                d.workspace_id == workspace_id,
                d.project_id == project_id,
                d.extractor_version == EXTRACTOR_VERSION,
                d.entity_config_version == entity_config_version,
                d.recommendation_version == RECOMMENDATION_VERSION,
                d.sentiment_version == SENTIMENT_VERSION,
            )
        )
    ).scalar_one()
    return derivation_id


async def _insert_mentions(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
    facts: AnswerFacts,
) -> None:
    if not facts.mentions:
        return
    await db.execute(
        insert(ai_entity_mentions),
        [
            {
                "observation_id": observation_id,
                "observed_at": observed_at,
                "entity_id": mention.entity_id,
                "derivation_id": derivation_id,
                "workspace_id": task.workspace_id,
                "project_id": task.project_id,
                "engine_code": subject.engine_code,
                "role": mention.role,
                "mention_count": min(mention.mention_count, _SMALLINT_MAX),
                "first_char_offset": mention.first_char_offset,
                "mention_order": min(mention.mention_order, _SMALLINT_MAX),
                "prominence": Decimal(str(mention.prominence)),
                "match_method": mention.match_method,
                "mention_status": mention.status,
                "confidence": Decimal(str(mention.confidence)),
                "evidence_spans": [
                    Range(start, end, bounds="[)") for start, end in mention.evidence_spans
                ],
                "is_current": True,
            }
            for mention in facts.mentions
        ],
    )


async def _insert_fact(
    db: AsyncSession,
    task: FetchedTask,
    subject: _Subject,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
    facts: AnswerFacts,
) -> None:
    fact = facts.fact
    await db.execute(
        insert(ai_observation_facts).values(
            observation_id=observation_id,
            observed_at=observed_at,
            derivation_id=derivation_id,
            workspace_id=task.workspace_id,
            project_id=task.project_id,
            observed_date=observed_at.astimezone(UTC).date(),
            engine_code=subject.engine_code,
            observation_class=subject.observation_class,
            prompt_id=subject.prompt_id,
            prompt_version_id=subject.version_id,
            tracked_keyword_id=None,
            replicate_index=subject.replicate_index,
            location_id=task.location_id,
            is_valid=fact.is_valid,
            own_mentioned=fact.own_mentioned,
            own_domain_cited=fact.own_domain_cited,
            own_recommended=None,
            own_structured_rank=None,
            own_prominence=None
            if fact.own_prominence is None
            else Decimal(str(fact.own_prominence)),
            own_mention_order=fact.own_mention_order,
            own_sentiment=None,
            own_citation_count=min(fact.own_citation_count, _SMALLINT_MAX),
            total_citation_count=min(fact.total_citation_count, _SMALLINT_MAX),
            tracked_entities_mentioned=min(fact.tracked_entities_mentioned, _SMALLINT_MAX),
            competitor_mentions=list(fact.competitor_mentions),
            competitor_cited=list(fact.competitor_cited),
            had_structured_list=fact.had_structured_list,
            is_current=True,
        )
    )
```

- [ ] **Step 4: Run the ingest tests to make sure they pass**

Run: `cd backend && uv run pytest tests/collectors/test_ai_prompt_ingest.py --no-cov -q`
Expected: PASS (10 tests). If the mention insert fails with `DataError` on `evidence_spans`, plan A declared the column as something other than `ARRAY(INT4RANGE)`: fix the `Table` in plan A's `tables.py`, not the value here.

- [ ] **Step 5: Register the workload and the tick**

In `backend/src/idraft/worker/assembly.py` add the imports next to the rank ones:

```python
from idraft.collectors.ai_prompt import AiPromptWorkload
from idraft.collectors.ai_prompt_ingest import ingest as ingest_ai_answers
```

In `production_registry`, replace the raw-storage branch:

```python
        if context.raw_store is not None:
            registry.add_workload(SeoRankWorkload())
```

with

```python
        if context.raw_store is not None:
            registry.add_workload(SeoRankWorkload())
            registry.add_workload(AiPromptWorkload())
```

and extend its docstring's last sentence to: `Rank checks and AI answers are registered only where their answers can be kept and read (raw storage), so a worker never pays for an answer it could not ingest.`

In `assemble`, after `ingest_rank_checks`, add:

```python
    async def ingest_ai_prompt_answers() -> None:
        if context.raw_store is None:
            return
        report = await ingest_ai_answers(context.sessions, context.raw_store)
        if not report.quiet:
            _log.info("AI answers ingested", **asdict(report))
```

and in the returned tuple, after the `rank_ingest` tick:

```python
        Tick(
            name="ai_prompt_ingest",
            interval=INGEST_EVERY,
            action=ingest_ai_prompt_answers,
            lock_ttl=INGEST_LOCK,
        ),
```

In `backend/tests/worker/test_assembly.py`, in `test_rank_checks_are_registered_only_where_their_answers_can_be_kept`, change

```python
        assert registry.workloads == frozenset(
            {TaskWorkload.KEYWORD_METRICS, TaskWorkload.SEO_RANK}
        )
```

to

```python
        assert registry.workloads == frozenset(
            {TaskWorkload.KEYWORD_METRICS, TaskWorkload.SEO_RANK, TaskWorkload.AI_PROMPT}
        )
```

and after the `rank_ingest` assertion add:

```python
    assert (ticks["ai_prompt_ingest"].interval, ticks["ai_prompt_ingest"].lock_ttl) == (
        ticks["keyword_metrics_ingest"].interval,
        ticks["keyword_metrics_ingest"].lock_ttl,
    )
```

- [ ] **Step 6: Run the worker tests**

Run: `cd backend && uv run pytest tests/worker/ tests/collectors/ --no-cov -q`
Expected: PASS. (No test lists the ticks by name; doc 21's tick table is updated in Task 10.)

- [ ] **Step 7: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/idraft/collectors/ai_prompt_ingest.py backend/src/idraft/worker/assembly.py backend/tests/collectors/test_ai_prompt_ingest.py backend/tests/worker/test_assembly.py
git commit -m "AI prompts: ingest answers into observations, citations, mentions and facts"
```

## Task 7: Run now

**Files:**
- Modify: `backend/src/idraft/api/schemas/ai.py` (add `RunNow`)
- Create: `backend/src/idraft/api/ai/run_repository.py`
- Modify: `backend/src/idraft/api/operations/runs.py` (`AI_PROMPT`, `RunService.ai_run_now`)
- Modify: `backend/src/idraft/api/ai/prompt_routes.py` (the route)
- Modify: `backend/tests/api/test_route_access.py` (`EXPECTED`), `backend/tests/security/test_cross_tenant.py` (`BODIES`)
- Modify: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` (regenerated)
- Test: `backend/tests/api/ai/test_run_now.py` (and `backend/tests/api/ai/__init__.py`, empty, if plan A has not created it)

`POST {P}/prompts/{prompt_id}/run-now` (on plan A's router, whose prefix ends in `/prompts`), `runs:trigger`, body `{ "engine_codes": [...] }` (one to three engine codes), `202` with the run. The same steps as Check now (`RunService.check_now`), in this order: the provider pause (`503 provider_paused`); the project; the prompt, live and active (`404` otherwise, also for another project's prompt); every engine enabled for the project (`422 validation_failed`, field `engine_codes`, code `engine_not_enabled`) and the prompt within each engine's limit (`prompt_too_long`); the project's manual run lock; an answer of this prompt version already queued or under way on one of the engines, or a planned run that names the prompt (`409 check_pending` with `engine_codes`); the day's manual runs (`429 manual_run_limit`); the month's AI answers against `max_ai_observations_per_month` (`422 quota_exceeded`, counting every `ai_prompt` task of the month that was not cancelled plus the answers planned runs still ask for). Then `runs.insert_manual_run` with workload `ai_prompt`, selector `{"prompt_ids": [<id>], "engine_codes": [...sorted]}` and the one hour manual window, and the audit action `collection_run.requested`. The planner plans it through the standard queue; its budget check applies as to every run (a budget used up makes it `budget_blocked`).

Doc 19 section 3.7.5 asks for an `Idempotency-Key` and live endpoints. Slice 1 has neither (spec section 4.3; the API has no idempotency handling): the lock and the pending check stop a second paid request for the same answer, and Task 10 records the difference.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/ai/test_run_now.py`:

```python
"""Asking a prompt now: a manual AI run the worker plans and sends through the provider's
standard queue (docs/19 section 3.7.5, cut by the slice 1 spec section 4.3)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx

from idraft.api.operations.runs import MANUAL_RUNS_PER_DAY
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt, enable_engine
from tests.collectors.support import Project
from tests.conftest import PostgresServer

QUESTION = "Which managed SOC providers work with mid-size banks?"


async def _setup(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, Project, Caller, Prompt]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = Project(workspace.id, await make_project(pg, workspace.id))
    prompt = await add_prompt(pg, project, QUESTION)
    for code in ("chatgpt_web", "gemini_web", "google_ai_mode"):
        await enable_engine(pg, project, code)
    return workspace, project, owner, prompt


async def _run_now(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: Project,
    caller: Caller,
    prompt_id: uuid.UUID,
    engines: list[str],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project.id, "prompts", prompt_id, "run-now"),
        json={"engine_codes": engines},
        headers=caller.headers,
    )


async def _runs(pg: PostgresServer, project: Project) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE project_id = $1 ORDER BY created_at",
        project.id,
    )
    return [dict(row) for row in rows]


async def test_run_now_records_a_planned_run_for_the_worker(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)

    response = await _run_now(
        api, workspace, project, owner, prompt.id, ["google_ai_mode", "chatgpt_web"]
    )

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert (data["workload"], data["trigger"], data["status"]) == ("ai_prompt", "manual", "planned")
    (run,) = await _runs(migrated, project)
    assert json.loads(run["config_snapshot"]) == {
        "selector": {
            "prompt_ids": [str(prompt.id)],
            "engine_codes": ["chatgpt_web", "google_ai_mode"],
        }
    }
    (entry,) = await fetch(
        migrated,
        "SELECT target_id, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'collection_run.requested'",
        workspace.id,
    )
    assert entry["target_id"] == str(run["id"])
    assert json.loads(entry["after"]) == {
        "project_id": str(project.id),
        "workload": "ai_prompt",
        "prompt_id": str(prompt.id),
        "engine_codes": ["chatgpt_web", "google_ai_mode"],
        "queue": "standard",
    }


async def test_an_engine_the_project_has_not_turned_on_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await enable_engine(migrated, project, "gemini_web", enabled=False)

    response = await _run_now(api, workspace, project, owner, prompt.id, ["gemini_web"])

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("engine_codes", "engine_not_enabled")]
    assert await _runs(migrated, project) == []


async def test_a_prompt_too_long_for_an_engine_is_refused_for_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, _ = await _setup(resources, migrated)
    long = await add_prompt(migrated, project, "Why " + "x" * 700)

    refused = await _run_now(api, workspace, project, owner, long.id, ["google_ai_mode"])
    taken = await _run_now(api, workspace, project, owner, long.id, ["chatgpt_web"])

    assert errors(refused) == [("engine_codes", "prompt_too_long")]
    assert taken.status_code == 202


async def test_a_prompt_of_another_project_or_archived_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, _ = await _setup(resources, migrated)
    elsewhere = Project(workspace.id, await make_project(migrated, workspace.id))
    theirs = await add_prompt(migrated, elsewhere, QUESTION)
    archived = await add_prompt(migrated, project, "Archived, about SOC tools?", active=False)

    for prompt_id in (theirs.id, archived.id, uuid.uuid4()):
        response = await _run_now(api, workspace, project, owner, prompt_id, ["chatgpt_web"])
        assert problem(response) == (404, "not_found")


async def test_an_answer_already_on_its_way_is_not_asked_for_twice(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    first = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])

    again = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web", "gemini_web"])
    other_engine = await _run_now(api, workspace, project, owner, prompt.id, ["gemini_web"])

    assert first.status_code == 202
    assert problem(again) == (409, "check_pending")
    assert again.json()["engine_codes"] == ["chatgpt_web"]
    # The planned run names its engines: another engine is not on its way.
    assert other_engine.status_code == 202


async def test_a_queued_task_of_the_prompt_is_on_its_way(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    run = await fetch(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
        "($1, $2, 'ai_prompt', now(), now() + interval '1 hour', 'schedule', 'running', "
        "'system', '{}') RETURNING id",
        workspace.id,
        project.id,
    )
    await execute(
        migrated,
        "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, engine_code, location_id, idempotency_key, "
        "request_fingerprint, provider_code, provider_endpoint, scheduled_for, status) VALUES "
        "($1, $2, $3, 'ai_prompt', 'prompt_version', $4, 'gemini_web', 2840, $5, $5, "
        "'dataforseo', 'ai_optimization/gemini/llm_scraper', now(), 'submitted')",
        run[0]["id"],
        workspace.id,
        project.id,
        str(prompt.version_id),
        uuid.uuid4().bytes,
    )

    response = await _run_now(api, workspace, project, owner, prompt.id, ["gemini_web"])

    assert problem(response) == (409, "check_pending")


async def test_the_days_manual_runs_and_the_months_answers_are_limited(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_ai_observations_per_month) "
        "VALUES ($1, 1) ON CONFLICT (workspace_id) DO UPDATE "
        "SET max_ai_observations_per_month = 1",
        workspace.id,
    )

    over_quota = await _run_now(
        api, workspace, project, owner, prompt.id, ["chatgpt_web", "gemini_web"]
    )
    for _ in range(MANUAL_RUNS_PER_DAY):
        await execute(
            migrated,
            "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
            "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
            "($1, $2, 'keyword_metrics', now(), now(), 'manual', 'completed', 'user', '{}')",
            workspace.id,
            project.id,
        )
    over_day = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])

    assert problem(over_quota) == (422, "quota_exceeded")
    assert over_quota.json()["quota"] == "max_ai_observations_per_month"
    assert (over_quota.json()["limit"], over_quota.json()["requested"]) == (1, 2)
    assert problem(over_day) == (429, "manual_run_limit")


async def test_a_viewer_cannot_ask_a_prompt_now(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, prompt = await _setup(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _run_now(api, workspace, project, viewer, prompt.id, ["chatgpt_web"])

    assert problem(response) == (403, "forbidden")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/api/ai/test_run_now.py --no-cov -q`
Expected: FAIL: every test gets `404` (or `405`) where it expects `202`, `409`, `422` or `429`: the route does not exist.

- [ ] **Step 3: Add the request body**

Append to `backend/src/idraft/api/schemas/ai.py` (plan A's file already imports most of these; add the lines it lacks to its import block rather than repeating them):

```python
from typing import Annotated

from pydantic import Field

from idraft.api.schemas.common import Body
from idraft.domain.ai_engines import EngineCode


class RunNow(Body):
    """The engines to ask the prompt on now, each once, through the standard queue."""

    engine_codes: Annotated[list[EngineCode], Field(min_length=1, max_length=3)]
```

- [ ] **Step 4: Write the repository**

Create `backend/src/idraft/api/ai/run_repository.py`:

```python
"""What Run now reads (docs/19 section 3.7.5): the prompt and its current version, the engines
the project has turned on, what of the prompt is already on its way, and the workspace's monthly
limit of AI answers."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.ai_prompt import SUBJECT_TYPE, UNSETTLED
from idraft.db.tables import (
    ai_project_engines,
    ai_prompt_versions,
    ai_prompts,
    collection_runs,
    collection_tasks,
    workspace_quotas,
)

AI_PROMPT = "ai_prompt"


@dataclass(frozen=True, slots=True)
class RunnablePrompt:
    prompt_id: UUID
    version_id: UUID
    text_length: int


async def runnable_prompt(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_id: UUID
) -> RunnablePrompt | None:
    """The prompt with its current version, when the project collects it: not deleted, active."""
    p, v = ai_prompts.c, ai_prompt_versions.c
    row = (
        await db.execute(
            select(p.id, v.id.label("version_id"), func.char_length(v.text).label("length"))
            .select_from(
                ai_prompts.join(
                    ai_prompt_versions,
                    and_(v.id == p.current_version_id, v.workspace_id == p.workspace_id),
                )
            )
            .where(
                p.workspace_id == workspace_id,
                p.project_id == project_id,
                p.id == prompt_id,
                p.deleted_at.is_(None),
                p.is_active,
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return RunnablePrompt(prompt_id=row.id, version_id=row.version_id, text_length=row.length)


async def enabled_engines(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> set[str]:
    e = ai_project_engines.c
    rows = await db.execute(
        select(e.engine_code).where(
            e.workspace_id == workspace_id, e.project_id == project_id, e.is_enabled
        )
    )
    return {row.engine_code for row in rows}


async def pending_engines(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt: RunnablePrompt,
    engine_codes: Sequence[str],
) -> list[str]:
    """The engines among these the prompt already has an answer on its way from: a task of its
    current version not yet read, or a planned run that names the prompt."""
    t, r = collection_tasks.c, collection_runs.c
    found = {
        row.engine_code
        for row in await db.execute(
            select(t.engine_code)
            .distinct()
            .where(
                t.workspace_id == workspace_id,
                t.project_id == project_id,
                t.workload == AI_PROMPT,
                t.subject_type == SUBJECT_TYPE,
                t.subject_id == str(prompt.version_id),
                t.engine_code.in_(list(engine_codes)),
                t.status.in_(UNSETTLED),
            )
        )
    }
    planned = await db.execute(
        select(r.config_snapshot).where(
            r.workspace_id == workspace_id,
            r.project_id == project_id,
            r.workload == AI_PROMPT,
            r.status == "planned",
            r.config_snapshot.contains({"selector": {"prompt_ids": [str(prompt.prompt_id)]}}),
        )
    )
    for row in planned:
        named = ((row.config_snapshot or {}).get("selector") or {}).get("engine_codes")
        found.update(code for code in engine_codes if named is None or code in named)
    return sorted(found.intersection(engine_codes))


async def lock_ai_observation_limit(db: AsyncSession, workspace_id: UUID) -> int:
    """The workspace's monthly limit of AI answers, its quota row locked until the transaction
    ends, so two requests count one after the other. A workspace without a row gets the
    defaults."""
    await db.execute(
        upsert(workspace_quotas).values(workspace_id=workspace_id).on_conflict_do_nothing()
    )
    limit: int = (
        await db.execute(
            select(workspace_quotas.c.max_ai_observations_per_month)
            .where(workspace_quotas.c.workspace_id == workspace_id)
            .with_for_update(key_share=True)
        )
    ).scalar_one()
    return limit


async def ai_tasks_since(db: AsyncSession, workspace_id: UUID, since: datetime) -> int:
    """AI answers the workspace has asked for since `since`, scheduled or by hand: the tasks
    that reached or will reach the provider, and the answers planned runs still ask for."""
    t, r = collection_tasks.c, collection_runs.c
    made = (
        select(func.count())
        .where(
            t.workspace_id == workspace_id,
            t.workload == AI_PROMPT,
            t.created_at >= since,
            t.status.not_in(("cancelled", "skipped_cached")),
        )
        .scalar_subquery()
    )
    selector = r.config_snapshot["selector"]
    asked = func.coalesce(func.jsonb_array_length(selector["prompt_ids"]), 0) * func.coalesce(
        func.jsonb_array_length(selector["engine_codes"]), 0
    )
    waiting = (
        select(func.coalesce(func.sum(asked), 0))
        .where(
            r.workspace_id == workspace_id,
            r.workload == AI_PROMPT,
            r.status == "planned",
            r.created_at >= since,
        )
        .scalar_subquery()
    )
    # One statement, so one snapshot: the planner turns a waiting run into tasks in one commit.
    total: int = (await db.execute(select(made + waiting))).scalar_one()
    return total
```

- [ ] **Step 5: Add the service method**

In `backend/src/idraft/api/operations/runs.py` add the imports:

```python
from idraft.api.ai import run_repository as ai_runs
from idraft.api.schemas.ai import RunNow
from idraft.providers.dataforseo.ai import ENGINE_ENDPOINTS, PROMPT_MAX
```

the constant next to `SEO_RANK`:

```python
AI_PROMPT: Final = "ai_prompt"
```

and this method on `RunService`, after `check_now`:

```python
    async def ai_run_now(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        prompt_id: UUID,
        body: RunNow,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual AI run of one prompt on the given engines, asked through the provider's
        standard queue, the path a schedule uses. `409 check_pending` when an answer of the
        prompt is already queued or under way on one of them, `422 quota_exceeded` when the
        month's AI answers would pass the workspace's limit, `503 provider_paused` while the
        provider is refusing every request."""
        if await self._provider_paused():
            raise ProviderPausedError(
                "The data provider is not being asked just now. Try again in a few minutes.",
                headers={"Retry-After": str(PAUSED_RETRY_SECONDS)},
            )
        engines = sorted({str(code) for code in body.engine_codes})
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            prompt = await ai_runs.runnable_prompt(
                db, access.workspace_id, project_id, prompt_id
            )
            if prompt is None:
                raise NotFoundError
            enabled = await ai_runs.enabled_engines(db, access.workspace_id, project_id)
            if any(code not in enabled for code in engines):
                raise invalid_field(
                    "engine_codes",
                    code="engine_not_enabled",
                    message="An engine the project has not turned on.",
                )
            if any(prompt.text_length > PROMPT_MAX[ENGINE_ENDPOINTS[code]] for code in engines):
                raise invalid_field(
                    "engine_codes",
                    code="prompt_too_long",
                    message="The prompt is longer than one of these engines takes.",
                )
            await runs.lock_manual_runs(db, project_id)
            # Under the lock, so two requests cannot both pass: an answer on its way is not
            # paid for twice.
            pending = await ai_runs.pending_engines(
                db, access.workspace_id, project_id, prompt, engines
            )
            if pending:
                raise CheckPendingError(
                    "This prompt already has an answer queued or under way on these engines. "
                    "Wait for it to end.",
                    engine_codes=pending,
                )
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            limit = await ai_runs.lock_ai_observation_limit(db, access.workspace_id)
            asked = await ai_runs.ai_tasks_since(db, access.workspace_id, await _month_start(db))
            if asked + len(engines) > limit:
                raise QuotaExceededError(
                    f"The workspace has asked for {asked} of its {limit} AI answers this month "
                    f"(UTC); {len(engines)} more do not fit.",
                    limit=limit,
                    used=asked,
                    requested=len(engines),
                    quota="max_ai_observations_per_month",
                )
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=AI_PROMPT,
                user_id=access.user_id,
                request_id=info.request_id,
                selector={"prompt_ids": [str(prompt_id)], "engine_codes": engines},
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": AI_PROMPT,
                    "prompt_id": str(prompt_id),
                    "engine_codes": engines,
                    "queue": "standard",
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created
```

- [ ] **Step 6: Add the route**

In `backend/src/idraft/api/ai/prompt_routes.py` add the imports it lacks among these (plan A's file has most of them):

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from idraft.api.operations.run_routes import Runs, run_view
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.schemas.ai import RunNow
from idraft.api.schemas.operations import RunResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
```

the dependency next to plan A's ones (if plan A already defines a `runs:trigger` dependency, use it instead):

```python
TriggerRuns = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]
```

and the route at the end of the file:

```python
@router.post(
    "/{prompt_id}/run-now",
    status_code=202,
    summary="Ask a prompt now (a manual run through the provider's standard queue)",
    description="The prompt, which the project collects (`404` otherwise), on each of "
    "`engine_codes` once, through the provider's standard queue, the path a schedule uses. The "
    "run is `planned` and the worker plans it within a minute; answers arrive within minutes. "
    "An engine the project has not turned on is `422 validation_failed` with "
    "`engine_not_enabled`, a prompt longer than an engine takes `prompt_too_long`. An answer "
    "already queued or under way is `409 check_pending` with its `engine_codes`. A budget used "
    "up blocks the run (`budget_blocked`). `429 manual_run_limit` after 20 manual runs in a day "
    "(UTC); `422 quota_exceeded` when the month's AI answers would pass the workspace's "
    "`max_ai_observations_per_month`; `503 provider_paused` while the provider is refusing "
    "every request.",
)
async def run_now(
    project_id: UUID,
    prompt_id: UUID,
    body: RunNow,
    access: TriggerRuns,
    runs: Runs,
    info: Info,
) -> RunResponse:
    record = await runs.ai_run_now(access, project_id, prompt_id, body, info)
    return RunResponse(data=run_view(record, access.workspace_id))
```

- [ ] **Step 7: Declare the route's access and cross-tenant body**

In `backend/tests/api/test_route_access.py` add to `EXPECTED`, after the Check now entry:

```python
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}/run-now",
    ): "runs:trigger",
```

In `backend/tests/security/test_cross_tenant.py` add to `BODIES`, after the Check now entry:

```python
    ("POST", _W + "/projects/{project_id}/prompts/{prompt_id}/run-now"): {
        "engine_codes": ["chatgpt_web"],
    },
```

- [ ] **Step 8: Regenerate the contract**

Run:
```bash
cd backend && uv run python -m idraft.api.openapi > openapi/v1.json
cd ../apps/web && pnpm gen:api && pnpm typecheck
```
Expected: `openapi/v1.json` gains the operation and the `RunNow` schema; `schema.ts` is rewritten; typecheck passes.

- [ ] **Step 9: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/api/ai/test_run_now.py tests/api/operations/test_check_now.py tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py --no-cov -q`
Expected: PASS (8 new tests).

- [ ] **Step 10: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 11: Commit**

```bash
git add backend/src/idraft/api/schemas/ai.py backend/src/idraft/api/ai/run_repository.py backend/src/idraft/api/operations/runs.py backend/src/idraft/api/ai/prompt_routes.py backend/tests/api/ai backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py backend/openapi/v1.json apps/web/src/lib/api/schema.ts
git commit -m "AI prompts: run a prompt now through the standard queue"
```

## Task 8: Observation routes: list, detail and raw answer

**Files:**
- Modify: `backend/src/idraft/api/ranks/service.py` (`_event_bounds` becomes `request_bounds`; `read_stored_answer` taken out of `RankService.raw_answer`)
- Modify: `backend/src/idraft/api/schemas/ai.py` (observation models)
- Create: `backend/src/idraft/api/ai/observation_repository.py`, `backend/src/idraft/api/ai/observations.py`, `backend/src/idraft/api/ai/observation_routes.py`
- Modify: `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/main.py`
- Modify: `backend/tests/api/test_route_access.py` (`EXPECTED`, `PATH_PARAMETERS`), `backend/tests/security/test_cross_tenant.py` (`Tenant.observation_id`, `_tenant`, `_nowhere`)
- Modify: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` (regenerated)
- Test: `backend/tests/api/ai/test_observation_routes.py`

Routes (docs/19 section 3.7.6, cut to slice 1):

- `GET {P}/ai/observations`, `data:read`: newest first, keyset `(observed_at DESC, id DESC)`, `cursor` and `limit`. `from` and `to` take timestamps or project-local dates (`to` included); without them the last 28 days; a window over 92 days is `422 window_too_large`. Filters: `filter[engine_code_in]`, `filter[prompt_id]`, `filter[status_in]`, `filter[is_valid]`, `filter[outcome_in]`. A superseded observation is never listed. `facts` is the current derivation's, or null.
- `GET {P}/ai/observations/{observation_id}`, `data:read`, `observed_at` as a hint to find the month: the summary plus `answer_text`, `error_code`, `check_url`, the citations with their roles and the mentions of the current derivation with their evidence spans. Offsets are UTF-16 code units, as a JavaScript string indexes the text (`offsets_unit: 'utf16'`); they are stored in code points.
- `GET {P}/ai/observations/{observation_id}/raw`, `raw:read`, `observed_at` hint: the provider's answer as received, with the headers of the SERP raw route; `410 raw_expired`, `503 raw_unavailable`.

An observation of another project, or of another workspace, is `404`.

- [ ] **Step 1: Share the raw reader and the bounds of a request**

In `backend/src/idraft/api/ranks/service.py`:

1. Rename `def _event_bounds(` (line 73) to `def request_bounds(` and its use in `event_page` (line 794) to `request_bounds(start, end, ZoneInfo(zone_row.timezone))`.
2. Add this function after `_unpack_inline`:

```python
async def read_stored_answer(row: Any, store: ObjectStore | None, what: str) -> bytes:
    """The provider's answer a raw payload registry row names, as received. `what` names the
    thing it belongs to in the errors (`snapshot`, `observation`)."""
    if row.expires_at is not None and row.expires_at <= datetime.now(UTC):
        raise RawExpiredError(f"The raw answer of this {what} is past its retention.")
    if row.object_key is None:
        if row.inline_body is None:
            raise RawExpiredError(f"The raw answer of this {what} is no longer kept.")
        try:
            body = await asyncio.to_thread(
                _unpack_inline, bytes(row.inline_body), str(row.compression)
            )
        except (RawStorageError, OSError, EOFError):
            raise RawUnavailableError("The stored answer could not be read.") from None
        if digest(body) != bytes(row.sha256):
            raise RawUnavailableError("The stored answer could not be read.")
        return body
    if store is None:
        raise RawUnavailableError("Raw answers need object storage, which is not set up.")
    try:
        return await read_payload(store, row.object_key, bytes(row.sha256))
    except (RawStorageError, KeyError):
        raise RawUnavailableError("The stored answer could not be read. Try again.") from None
```

3. Replace the body of `RankService.raw_answer` after `row = await repository.raw_payload(db, snapshot_id)` with:

```python
        if row is None:
            raise NotFoundError
        return RawAnswer(await read_stored_answer(row, self._raw_store, "snapshot"))
```

Add `from typing import Any` to the module's imports if it is not there.

Run: `cd backend && uv run pytest tests/api/ranks/ tests/api/keywords/test_tracked_keyword_ranks.py --no-cov -q`
Expected: PASS (the messages are the same as before).

- [ ] **Step 2: Write the failing test**

Create `backend/tests/api/ai/test_observation_routes.py`:

```python
"""Reading AI answers (docs/19 section 3.7.6): the project's observations newest first with
their facts, one answer with its citations and marked mentions, and the raw answer. The answers
are the S-04 captures, ingested by the worker's own ingest."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import ensure_locations, project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger, worker_db
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    RIVAL_HOST,
    RIVAL_NAME,
    AiWorld,
    Prompt,
    add_prompt,
    at_now,
    chatgpt_answer,
    fetched_ai_task,
)
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

__all__ = ["worker_db"]

CAPTURED = FIXTURES / "captured"
QUESTION = "What are the best managed SOC providers in India?"
Answers = tuple[Workspace, AiWorld, Caller, Prompt, dict[str, int], dict[str, bytes]]


async def _get(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: Project,
    caller: Caller,
    *parts: object,
    **params: Any,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project.id, "ai", "observations", *parts),
        params=params,
        headers=caller.headers,
    )


async def _task_observation(pg: PostgresServer, task_id: int) -> int:
    row = await fetchrow(
        pg, "SELECT id FROM ai.observations WHERE collection_task_id = $1", task_id
    )
    observation_id: int = row["id"]
    return observation_id


@pytest.fixture
async def answers(
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> Answers:
    """Three answers to one prompt, an hour apart, newest first: Gemini (own and rival named and
    cited), ChatGPT (neither) and a ChatGPT refusal."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    world = AiWorld(
        project,
        own=await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True),
        rival=await _entity(migrated, project, RIVAL_NAME, RIVAL_HOST, "competitor"),
    )
    prompt = await add_prompt(migrated, project, QUESTION)
    now = datetime.now(UTC).replace(microsecond=0)
    bodies = {
        "gemini": at_now(CAPTURED / "gemini_scraper_answer.json", now),
        "chatgpt": chatgpt_answer(
            "Several firms run managed SOCs in India, with 24x7 monitoring and response.",
            ["https://news.example/soc"],
            when=now - timedelta(hours=1),
        ),
        "refused": chatgpt_answer(
            "I'm sorry, but I can't help with comparing vendors.", when=now - timedelta(hours=2)
        ),
    }
    tasks = {
        name: await fetched_ai_task(
            worker_db,
            migrated,
            project,
            prompt,
            body,
            import_store,
            engine_code="gemini_web" if name == "gemini" else "chatgpt_web",
        )
        for name, body in bodies.items()
    }
    await ingest(worker_db, import_store)
    ids = {name: await _task_observation(migrated, task_id) for name, task_id in tasks.items()}
    return workspace, world, owner, prompt, ids, bodies


async def test_the_answers_are_listed_newest_first_with_their_facts(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, prompt, ids, _ = answers

    response = await _get(api, workspace, world.project, owner)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [row["observation_id"] for row in data] == [
        str(ids["gemini"]),
        str(ids["chatgpt"]),
        str(ids["refused"]),
    ]
    gemini = data[0]
    assert gemini["subject"] == {
        "type": "prompt",
        "prompt_id": str(prompt.id),
        "prompt_version_id": str(prompt.version_id),
        "version_no": 1,
    }
    assert (gemini["engine_code"], gemini["status"], gemini["citation_count"]) == (
        "gemini_web",
        "complete",
        5,
    )
    assert gemini["facts"]["outcome"] == "mentioned_and_cited"
    assert gemini["facts"]["competitor_mentions"] == [str(world.rival)]
    assert data[1]["facts"]["outcome"] == "neither"
    assert (data[2]["status"], data[2]["facts"]["is_valid"]) == ("refused", False)
    assert response.json()["page"] == {"limit": 50, "next_cursor": None, "has_more": False}


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"filter[engine_code_in]": "chatgpt_web"}, ["chatgpt", "refused"]),
        ({"filter[status_in]": "refused,empty"}, ["refused"]),
        ({"filter[is_valid]": "true"}, ["gemini", "chatgpt"]),
        ({"filter[outcome_in]": "mentioned_and_cited,cited_only"}, ["gemini"]),
    ],
)
async def test_the_list_filters_by_engine_status_validity_and_outcome(
    api: httpx.AsyncClient, answers: Answers, params: dict[str, str], expected: list[str]
) -> None:
    workspace, world, owner, _, ids, _ = answers

    response = await _get(api, workspace, world.project, owner, **params)

    assert response.status_code == 200, response.text
    assert [row["observation_id"] for row in response.json()["data"]] == [
        str(ids[name]) for name in expected
    ]


async def test_the_list_pages_with_a_cursor_bound_to_its_filters(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, _, ids, _ = answers

    first = await _get(api, workspace, world.project, owner, limit=2)
    cursor = first.json()["page"]["next_cursor"]
    second = await _get(api, workspace, world.project, owner, limit=2, cursor=cursor)
    other_filter = await _get(
        api, workspace, world.project, owner, limit=2, cursor=cursor, **{"filter[is_valid]": "true"}
    )

    assert [row["observation_id"] for row in second.json()["data"]] == [str(ids["refused"])]
    assert second.json()["page"]["has_more"] is False
    assert problem(other_filter) == (400, "invalid_cursor")


async def test_a_window_over_92_days_is_refused(api: httpx.AsyncClient, answers: Answers) -> None:
    workspace, world, owner, _, _, _ = answers

    response = await _get(
        api, workspace, world.project, owner, **{"from": "2026-01-01", "to": "2026-06-01"}
    )

    assert problem(response) == (422, "window_too_large")


async def test_an_answer_is_read_with_its_citations_and_marked_mentions(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, _, ids, _ = answers

    response = await _get(api, workspace, world.project, owner, ids["gemini"])

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    text = detail["answer_text"]
    assert detail["offsets_unit"] == "utf16"
    assert [c["domain_role"] for c in detail["citations"]] == [
        "competitor",
        "third_party",
        "third_party",
        "own",
        "third_party",
    ]
    assert detail["citations"][3]["host"] == "eventussecurity.com"
    assert detail["citations"][3]["role_entity_id"] == str(world.own)
    names = {mention["name"]: mention for mention in detail["mentions"]}
    own = names[OWN_NAME]
    assert (own["role"], own["mention_status"], own["mention_order"]) == ("own", "accepted", 2)
    start, end = own["evidence_spans"][0]
    assert text[start:end] == OWN_NAME
    assert names[RIVAL_NAME]["role"] == "competitor"


async def test_an_observation_of_another_project_is_not_found(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer
) -> None:
    workspace, _, owner, _, ids, _ = answers
    elsewhere = await fetchrow(
        migrated,
        "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'Other', $2) "
        "RETURNING id",
        workspace.id,
        f"p-{uuid.uuid4().hex[:12]}",
    )
    other = Project(workspace.id, elsewhere["id"])

    response = await _get(api, workspace, other, owner, ids["gemini"])

    assert problem(response) == (404, "not_found")


async def test_the_raw_answer_is_returned_as_received(
    api: httpx.AsyncClient, answers: Answers, import_store: MemoryStore, migrated: PostgresServer
) -> None:
    workspace, world, owner, _, ids, bodies = answers

    response = await _get(api, workspace, world.project, owner, ids["gemini"], "raw")
    stored = dict(import_store.objects)
    import_store.objects.clear()
    lost = await _get(api, workspace, world.project, owner, ids["chatgpt"], "raw")
    import_store.objects.update(stored)
    await execute(
        migrated,
        "UPDATE ops.raw_payloads SET expires_at = now() - interval '1 day' "
        "WHERE id = (SELECT raw_payload_id FROM ai.observations WHERE id = $1)",
        ids["refused"],
    )
    expired = await _get(api, workspace, world.project, owner, ids["refused"], "raw")

    assert response.status_code == 200, response.text
    assert response.content == bodies["gemini"]
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["content-security-policy"] == "sandbox"
    assert problem(lost) == (503, "raw_unavailable")
    assert problem(expired) == (410, "raw_expired")


async def test_a_viewer_reads_answers_but_not_the_raw_answer(
    api: httpx.AsyncClient, answers: Answers, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, world, _, _, ids, _ = answers
    viewer = await member(resources, migrated, workspace, "viewer")

    listed = await _get(api, workspace, world.project, viewer)
    raw = await _get(api, workspace, world.project, viewer, ids["gemini"], "raw")

    assert listed.status_code == 200
    assert problem(raw) == (403, "forbidden")
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/api/ai/test_observation_routes.py --no-cov -q`
Expected: FAIL: the routes answer `404`.

- [ ] **Step 4: Add the response models**

Append to `backend/src/idraft/api/schemas/ai.py` (add `date`, `datetime`, `UUID`, `BaseModel` and `CursorPageInfo` to its imports if the file lacks them):

```python
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from idraft.api.pagination import CursorPageInfo

AnswerStatus = Literal["complete", "partial", "empty", "refused", "error"]
# The cross product of own mentioned and own domain cited, never collapsed (doc 04 section 8.5).
Outcome = Literal["mentioned_and_cited", "mentioned_only", "cited_only", "neither"]


class ObservationFacts(BaseModel):
    """The fact row of the current derivation."""

    derivation_id: int
    is_valid: bool
    outcome: Outcome
    own_mentioned: bool
    own_domain_cited: bool
    own_mention_order: int | None
    own_prominence: float | None
    own_citation_count: int
    total_citation_count: int
    tracked_entities_mentioned: int
    competitor_mentions: list[UUID]
    competitor_cited: list[UUID]
    had_structured_list: bool


class PromptSubject(BaseModel):
    type: Literal["prompt"]
    prompt_id: UUID
    prompt_version_id: UUID
    version_no: int


class ObservationSummary(BaseModel):
    # A 64-bit id, as a string: JavaScript numbers lose precision past 2^53.
    observation_id: str
    observed_at: datetime
    observed_date: date
    engine_code: str
    observation_class: str
    subject: PromptSubject
    query_text: str
    run_id: UUID | None
    replicate_index: int
    location_id: int | None
    language_code: str | None
    device: str | None
    status: AnswerStatus
    model_reported: str | None
    answer_char_count: int | None
    citation_count: int
    fanout_count: int
    served_from_cache: bool
    # Null before extraction or without a current derivation.
    facts: ObservationFacts | None


class ObservationPage(BaseModel):
    data: list[ObservationSummary]
    page: CursorPageInfo


class CitationOut(BaseModel):
    citation_index: int
    url: str
    raw_url: str
    host: str
    title: str | None
    source_name: str | None
    citation_kind: str
    domain_role: Literal["own", "competitor", "third_party"]
    role_entity_id: UUID | None
    occurrences: int
    first_char_offset: int | None
    answer_block_index: int | None
    referral_tag: str | None
    flags: list[str]


class MentionOut(BaseModel):
    entity_id: UUID
    name: str
    role: Literal["own", "competitor", "watch", "untracked"]
    mention_count: int
    first_char_offset: int
    mention_order: int
    match_method: str
    mention_status: Literal["accepted", "uncertain"]
    confidence: float
    # Half-open [start, end) ranges in `answer_text`.
    evidence_spans: list[tuple[int, int]]


class ObservationDetail(ObservationSummary):
    answer_text: str | None
    error_code: str | None
    check_url: str | None
    offsets_unit: Literal["utf16"]
    citations: list[CitationOut]
    mentions: list[MentionOut]


class ObservationResponse(BaseModel):
    data: ObservationDetail
```

- [ ] **Step 5: Write the repository**

Create `backend/src/idraft/api/ai/observation_repository.py`:

```python
"""Reads of AI observations (docs/19 section 3.7.6). Row-level security keeps every read in the
caller's workspace; each query names the workspace and the project as well."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import and_, or_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_citations,
    ai_entity_mentions,
    ai_observation_facts,
    ai_observations,
    ai_prompt_versions,
    domains,
    entities,
    urls,
)

_O, _F, _V = ai_observations.c, ai_observation_facts.c, ai_prompt_versions.c
# An `observed_at` hint finds the month: the row is looked for this far either side of it.
HINT_SLACK: Final = timedelta(days=1)
OUTCOMES: Final = {
    "mentioned_and_cited": and_(_F.own_mentioned, _F.own_domain_cited),
    "mentioned_only": and_(_F.own_mentioned, ~_F.own_domain_cited),
    "cited_only": and_(~_F.own_mentioned, _F.own_domain_cited),
    "neither": and_(~_F.own_mentioned, ~_F.own_domain_cited),
}
_SUMMARY: Final = (
    _O.id,
    _O.observed_at,
    _O.observed_date,
    _O.engine_code,
    _O.observation_class,
    _O.prompt_id,
    _O.prompt_version_id,
    _V.version_no,
    _O.query_text,
    _O.collection_run_id,
    _O.replicate_index,
    _O.location_id,
    _O.language_code,
    _O.device,
    _O.status,
    _O.model_reported,
    _O.answer_char_count,
    _O.citation_count,
    _O.fanout_count,
    _O.served_from_cache,
    _F.derivation_id,
    _F.is_valid,
    _F.own_mentioned,
    _F.own_domain_cited,
    _F.own_mention_order,
    _F.own_prominence,
    _F.own_citation_count,
    _F.total_citation_count,
    _F.tracked_entities_mentioned,
    _F.competitor_mentions,
    _F.competitor_cited,
    _F.had_structured_list,
)


@dataclass(frozen=True, slots=True)
class ObservationFilter:
    engine_codes: Sequence[str] | None = None
    prompt_id: UUID | None = None
    statuses: Sequence[str] | None = None
    is_valid: bool | None = None
    outcomes: Sequence[str] | None = None


def _source() -> Any:
    """Observations with their current facts and their prompt version, when they have them."""
    return ai_observations.outerjoin(
        ai_observation_facts,
        and_(
            _F.observation_id == _O.id,
            _F.observed_at == _O.observed_at,
            _F.workspace_id == _O.workspace_id,
            _F.is_current,
        ),
    ).outerjoin(
        ai_prompt_versions,
        and_(_V.id == _O.prompt_version_id, _V.workspace_id == _O.workspace_id),
    )


async def list_observations(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    given: ObservationFilter,
    *,
    since: datetime,
    until: datetime,
    after: tuple[datetime, int] | None,
    limit: int,
) -> list[Any]:
    statement = (
        select(*_SUMMARY)
        .select_from(_source())
        .where(
            _O.workspace_id == workspace_id,
            _O.project_id == project_id,
            _O.observed_at >= since,
            _O.observed_at < until,
            _O.superseded_by.is_(None),
        )
    )
    if given.engine_codes:
        statement = statement.where(_O.engine_code.in_(list(given.engine_codes)))
    if given.prompt_id is not None:
        statement = statement.where(_O.prompt_id == given.prompt_id)
    if given.statuses:
        statement = statement.where(_O.status.in_(list(given.statuses)))
    if given.is_valid is not None:
        statement = statement.where(_F.is_valid.is_(given.is_valid))
    if given.outcomes:
        statement = statement.where(or_(*(OUTCOMES[outcome] for outcome in given.outcomes)))
    if after is not None:
        statement = statement.where(tuple_(_O.observed_at, _O.id) < tuple_(*after))
    statement = statement.order_by(_O.observed_at.desc(), _O.id.desc()).limit(limit)
    return list(await db.execute(statement))


async def get_observation(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    observation_id: int,
    observed_at: datetime | None,
) -> Any | None:
    statement = (
        select(*_SUMMARY, _O.answer_text, _O.error_code, _O.provider_extras)
        .select_from(_source())
        .where(
            _O.workspace_id == workspace_id,
            _O.project_id == project_id,
            _O.id == observation_id,
        )
    )
    if observed_at is not None:
        statement = statement.where(
            _O.observed_at >= observed_at - HINT_SLACK, _O.observed_at <= observed_at + HINT_SLACK
        )
    return (await db.execute(statement)).one_or_none()


async def citations_of(
    db: AsyncSession, workspace_id: UUID, observation_id: int, observed_at: datetime
) -> list[Any]:
    c = ai_citations.c
    return list(
        await db.execute(
            select(
                c.citation_index,
                urls.c.canonical_url,
                c.raw_url,
                domains.c.host,
                c.title,
                c.source_name,
                c.citation_kind,
                c.domain_role,
                c.role_entity_id,
                c.occurrences,
                c.first_char_offset,
                c.answer_block_index,
                c.referral_tag,
                c.flags,
            )
            .join(urls, urls.c.id == c.url_id)
            .join(domains, domains.c.id == c.domain_id)
            .where(
                c.workspace_id == workspace_id,
                c.observation_id == observation_id,
                c.observed_at == observed_at,
            )
            .order_by(c.citation_index)
        )
    )


async def mentions_of(
    db: AsyncSession,
    workspace_id: UUID,
    observation_id: int,
    observed_at: datetime,
    derivation_id: int,
) -> list[Any]:
    m, e = ai_entity_mentions.c, entities.c
    return list(
        await db.execute(
            select(
                m.entity_id,
                e.canonical_name,
                m.role,
                m.mention_count,
                m.first_char_offset,
                m.mention_order,
                m.match_method,
                m.mention_status,
                m.confidence,
                m.evidence_spans,
            )
            .join(entities, and_(e.id == m.entity_id, e.workspace_id == m.workspace_id))
            .where(
                m.workspace_id == workspace_id,
                m.observation_id == observation_id,
                m.observed_at == observed_at,
                m.derivation_id == derivation_id,
                m.is_current,
            )
            .order_by(m.mention_order)
        )
    )


async def raw_payload(db: AsyncSession, observation_id: int) -> Any:
    """The registry row of an observation's payload, through the function that checks the
    workspace (migration 0019)."""
    return (
        await db.execute(
            text("SELECT * FROM ai.observation_raw(:observation_id)"),
            {"observation_id": observation_id},
        )
    ).first()
```

- [ ] **Step 6: Write the service**

Create `backend/src/idraft/api/ai/observations.py`:

```python
"""AI answers as the API shows them (docs/19 section 3.7.6): a page of observations with their
facts, one observation with its citations and mentions, and its raw answer."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import observation_repository as repository
from idraft.api.ai.observation_repository import ObservationFilter
from idraft.api.pagination import CursorParams, decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import NotFoundError, WindowTooLargeError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import read_stored_answer, request_bounds
from idraft.api.schemas.ai import (
    CitationOut,
    MentionOut,
    ObservationDetail,
    ObservationFacts,
    ObservationSummary,
    Outcome,
    PromptSubject,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.storage.raw import ObjectStore

# Without `from`, a list covers the last 28 days; no request covers more than 92.
OBSERVATIONS_DAYS: Final = 28
OBSERVATIONS_MAX_DAYS: Final = 92


@dataclass(frozen=True, slots=True)
class ObservationPageResult:
    rows: list[ObservationSummary]
    next_cursor: str | None


def _outcome(mentioned: bool, cited: bool) -> Outcome:
    if mentioned:
        return "mentioned_and_cited" if cited else "mentioned_only"
    return "cited_only" if cited else "neither"


def _facts(row: Any) -> ObservationFacts | None:
    if row.derivation_id is None:
        return None
    return ObservationFacts(
        derivation_id=row.derivation_id,
        is_valid=row.is_valid,
        outcome=_outcome(row.own_mentioned, row.own_domain_cited),
        own_mentioned=row.own_mentioned,
        own_domain_cited=row.own_domain_cited,
        own_mention_order=row.own_mention_order,
        own_prominence=None if row.own_prominence is None else float(row.own_prominence),
        own_citation_count=row.own_citation_count,
        total_citation_count=row.total_citation_count,
        tracked_entities_mentioned=row.tracked_entities_mentioned,
        competitor_mentions=list(row.competitor_mentions),
        competitor_cited=list(row.competitor_cited),
        had_structured_list=row.had_structured_list,
    )


def _summary_fields(row: Any) -> dict[str, Any]:
    return {
        "observation_id": str(row.id),
        "observed_at": row.observed_at,
        "observed_date": row.observed_date,
        "engine_code": row.engine_code,
        "observation_class": row.observation_class,
        "subject": PromptSubject(
            type="prompt",
            prompt_id=row.prompt_id,
            prompt_version_id=row.prompt_version_id,
            version_no=row.version_no,
        ),
        "query_text": row.query_text,
        "run_id": row.collection_run_id,
        "replicate_index": row.replicate_index,
        "location_id": row.location_id,
        "language_code": row.language_code,
        "device": row.device,
        "status": row.status,
        "model_reported": row.model_reported,
        "answer_char_count": row.answer_char_count,
        "citation_count": row.citation_count,
        "fanout_count": row.fanout_count,
        "served_from_cache": row.served_from_cache,
        "facts": _facts(row),
    }


def _utf16(text: str | None) -> Callable[[int], int]:
    """Code point offsets of `text` as UTF-16 code units: each character past U+FFFF is two."""
    if text is None or all(ord(char) <= 0xFFFF for char in text):
        return lambda offset: offset
    units = [0]
    for char in text:
        units.append(units[-1] + (2 if ord(char) > 0xFFFF else 1))
    return lambda offset: units[min(offset, len(text))]


class ObservationService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], raw_store: ObjectStore | None
    ) -> None:
        self._sessions = sessions
        self._raw_store = raw_store

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: ObservationFilter,
        *,
        start: datetime | date | None,
        end: datetime | date | None,
        page: CursorParams,
    ) -> ObservationPageResult:
        async with self._transaction(access) as db:
            zone = await project_zone(db, access.workspace_id, project_id)
        if zone is None:
            raise NotFoundError
        since, until = request_bounds(start, end, ZoneInfo(zone.timezone))
        until = until or datetime.now(UTC)
        since = since or until - timedelta(days=OBSERVATIONS_DAYS)
        if until - since > timedelta(days=OBSERVATIONS_MAX_DAYS):
            raise WindowTooLargeError(
                f"A request covers at most {OBSERVATIONS_MAX_DAYS} days.",
                limit_days=OBSERVATIONS_MAX_DAYS,
            )
        scope: dict[str, object] = {
            "project_id": str(project_id),
            "from": start,
            "to": end,
            "engines": sorted(given.engine_codes or []),
            "prompt": given.prompt_id,
            "statuses": sorted(given.statuses or []),
            "is_valid": given.is_valid,
            "outcomes": sorted(given.outcomes or []),
        }
        after: tuple[datetime, int] | None = None
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=scope)
            try:
                after = (datetime.fromisoformat(str(key[0])), int(key[1]))
            except (ValueError, IndexError):
                raise invalid_cursor() from None
        async with self._transaction(access) as db:
            rows = await repository.list_observations(
                db,
                access.workspace_id,
                project_id,
                given,
                since=since,
                until=until,
                after=after,
                limit=page.limit + 1,
            )
        shown = rows[: page.limit]
        next_cursor = None
        if len(rows) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.observed_at.isoformat(), last.id], scope=scope)
        return ObservationPageResult(
            rows=[ObservationSummary(**_summary_fields(row)) for row in shown],
            next_cursor=next_cursor,
        )

    async def detail(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> ObservationDetail:
        async with self._transaction(access) as db:
            row = await repository.get_observation(
                db, access.workspace_id, project_id, observation_id, observed_at
            )
            if row is None:
                raise NotFoundError
            citations = await repository.citations_of(
                db, access.workspace_id, row.id, row.observed_at
            )
            mentions = (
                []
                if row.derivation_id is None
                else await repository.mentions_of(
                    db, access.workspace_id, row.id, row.observed_at, row.derivation_id
                )
            )
        units = _utf16(row.answer_text)
        extras = row.provider_extras or {}
        check_url = extras.get("check_url")
        return ObservationDetail(
            **_summary_fields(row),
            answer_text=row.answer_text,
            error_code=row.error_code,
            check_url=check_url if isinstance(check_url, str) else None,
            offsets_unit="utf16",
            citations=[
                CitationOut(
                    citation_index=c.citation_index,
                    url=c.canonical_url,
                    raw_url=c.raw_url,
                    host=c.host,
                    title=c.title,
                    source_name=c.source_name,
                    citation_kind=c.citation_kind,
                    domain_role=c.domain_role,
                    role_entity_id=c.role_entity_id,
                    occurrences=c.occurrences,
                    first_char_offset=None
                    if c.first_char_offset is None
                    else units(c.first_char_offset),
                    answer_block_index=c.answer_block_index,
                    referral_tag=c.referral_tag,
                    flags=list(c.flags),
                )
                for c in citations
            ],
            mentions=[
                MentionOut(
                    entity_id=m.entity_id,
                    name=m.canonical_name,
                    role=m.role,
                    mention_count=m.mention_count,
                    first_char_offset=units(m.first_char_offset),
                    mention_order=m.mention_order,
                    match_method=m.match_method,
                    mention_status=m.mention_status,
                    confidence=float(m.confidence),
                    evidence_spans=[
                        (units(span.lower), units(span.upper)) for span in m.evidence_spans
                    ],
                )
                for m in mentions
            ],
        )

    async def raw_answer(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        observation_id: int,
        observed_at: datetime | None,
    ) -> bytes:
        """The provider's answer as received. The observation must be one of the project in
        the path: the registry function checks the workspace only."""
        async with self._transaction(access) as db:
            found = await repository.get_observation(
                db, access.workspace_id, project_id, observation_id, observed_at
            )
            if found is None:
                raise NotFoundError
            row = await repository.raw_payload(db, observation_id)
        if row is None:
            raise NotFoundError
        return await read_stored_answer(row, self._raw_store, "observation")
```

- [ ] **Step 7: Write the routes**

Create `backend/src/idraft/api/ai/observation_routes.py`:

```python
"""AI answers (docs/19 section 3.7.6): the project's observations, one with its citations and
mentions, and the provider's raw answer."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import AwareDatetime

from idraft.api.ai.observation_repository import ObservationFilter
from idraft.api.ai.observations import ObservationService
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import AnswerStatus, ObservationPage, ObservationResponse, Outcome
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai/observations", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
ReadRaw = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RAW_READ))]
# An observation id is a 64-bit integer, and PostgreSQL refuses anything larger.
ObservationId = Annotated[int, Path(ge=1, le=2**63 - 1)]
Hint = Annotated[datetime | None, Query(description="A hint to find the month.")]


def get_observation_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> ObservationService:
    return resources.ai_observations


Observations = Annotated[ObservationService, Depends(get_observation_service)]


@router.get(
    "",
    summary="The project's AI answers",
    description="Newest first. `from` and `to` take timestamps or project-local dates (`to` "
    "included); without them the last 28 days. A request covers at most 92 days "
    "(`422 window_too_large`). `facts` is the current derivation's, null before extraction. "
    "A cursor is bound to its filters (`400 invalid_cursor` otherwise).",
)
async def list_observations(
    project_id: UUID,
    access: ReadData,
    observations: Observations,
    page: Cursor,
    start: Annotated[AwareDatetime | date | None, Query(alias="from")] = None,
    end: Annotated[AwareDatetime | date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[str] | None, Commas, Query(alias="filter[engine_code_in]", max_length=10)
    ] = None,
    prompt_id: Annotated[UUID | None, Query(alias="filter[prompt_id]")] = None,
    statuses: Annotated[
        list[AnswerStatus] | None, Commas, Query(alias="filter[status_in]", max_length=5)
    ] = None,
    is_valid: Annotated[bool | None, Query(alias="filter[is_valid]")] = None,
    outcomes: Annotated[
        list[Outcome] | None, Commas, Query(alias="filter[outcome_in]", max_length=4)
    ] = None,
) -> ObservationPage:
    result = await observations.page(
        access,
        project_id,
        ObservationFilter(
            engine_codes=engine_codes,
            prompt_id=prompt_id,
            statuses=statuses,
            is_valid=is_valid,
            outcomes=outcomes,
        ),
        start=start,
        end=end,
        page=page,
    )
    return ObservationPage(
        data=result.rows,
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )


@router.get(
    "/{observation_id}",
    summary="One AI answer with its citations and mentions",
    description="The answer text, the cited sources with their role (own, competitor, third "
    "party) and the tracked entities it names, with evidence spans. Offsets are UTF-16 code "
    "units into `answer_text`, as a JavaScript string indexes it.",
)
async def get_observation(
    project_id: UUID,
    observation_id: ObservationId,
    access: ReadData,
    observations: Observations,
    observed_at: Hint = None,
) -> ObservationResponse:
    return ObservationResponse(
        data=await observations.detail(access, project_id, observation_id, observed_at)
    )


@router.get(
    "/{observation_id}/raw",
    summary="The provider's answer for an AI observation, as received",
    description="`raw:read`. `410 raw_expired` once the answer is past its retention; "
    "`503 raw_unavailable` when it could not be read now.",
    response_class=Response,
    responses={200: {"content": {"application/json": {}}}},
)
async def observation_raw(
    project_id: UUID,
    observation_id: ObservationId,
    access: ReadRaw,
    observations: Observations,
    observed_at: Hint = None,
) -> Response:
    body = await observations.raw_answer(access, project_id, observation_id, observed_at)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="ai-observation-{observation_id}.json"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )
```

- [ ] **Step 8: Wire the service and the router**

In `backend/src/idraft/api/resources.py` add the import and the field (after `integrations`):

```python
from idraft.api.ai.observations import ObservationService
```

```python
    ai_observations: ObservationService
```

In `backend/src/idraft/api/main.py` add the imports:

```python
from idraft.api.ai.observation_routes import router as ai_observations_router
from idraft.api.ai.observations import ObservationService
```

in the `Resources(...)` call, after `integrations=...`:

```python
                ai_observations=ObservationService(sessions=sessions, raw_store=sources),
```

and after `app.include_router(rank_events_router)`:

```python
    app.include_router(ai_observations_router)
```

- [ ] **Step 9: Declare access, the path parameter and the cross-tenant observation**

In `backend/tests/api/test_route_access.py` add to `EXPECTED`:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/{observation_id}",
    ): "data:read",
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/"
        "{observation_id}/raw",
    ): "raw:read",
```

and to `PATH_PARAMETERS`, after `"serp_snapshot_id",`:

```python
    # Inside one project, after `{project_id}`: the service finds the observation within that
    # project, so an observation of another project is a 404.
    "observation_id",
```

In `backend/tests/security/test_cross_tenant.py`:

1. Add the import: `from tests.collectors.ai_support import add_prompt, seed_observation` and `from tests.collectors.support import Project` (if `Project` is not imported yet).
2. Add to `Tenant`, after `serp_snapshot_id: int`:

```python
    # An AI answer of a prompt of the project, with its raw answer registered.
    observation_id: int
```

3. Add to `Tenant.ids()`, after the `serp_snapshot_id` entry: `"observation_id": str(self.observation_id),`
4. In `_tenant`, after the block that plants the snapshot's raw answer:

```python
    # An AI answer, its raw answer really in the store, so reading it would succeed.
    seeded = await add_prompt(
        pg, Project(workspace.id, project_id), f"Seeded AI prompt of tenant {label}?"
    )
    ai_answer = f'{{"tasks": [], "planted": "{label}-ai-{uuid.uuid4().hex}"}}'.encode()
    ai_key = f"raw/v1/ai_raw/dataforseo/planted/{label}-{uuid.uuid4().hex}.json.zst"
    if resources.import_store is not None:
        await resources.import_store.put(ai_key, compress(ai_answer))
    observation_id = await seed_observation(
        pg,
        Project(workspace.id, project_id),
        seeded,
        object_key=ai_key,
        sha256=digest(ai_answer),
    )
```

and `observation_id=observation_id,` in the `Tenant(...)` it returns, after `serp_snapshot_id=snapshot_id,`.
5. In `_nowhere`, make the observation id numeric like the snapshot id:

```python
    return {
        name: "9223372036854775000"
        if name in ("serp_snapshot_id", "observation_id")
        else str(uuid.uuid4())
        for name in ids
    }
```

- [ ] **Step 10: Regenerate the contract**

Run:
```bash
cd backend && uv run python -m idraft.api.openapi > openapi/v1.json
cd ../apps/web && pnpm gen:api && pnpm typecheck
```
Expected: three operations and the observation schemas added; typecheck passes.

- [ ] **Step 11: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/api/ai/ tests/api/ranks/ tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py --no-cov -q`
Expected: PASS (11 new tests in `test_observation_routes.py`, and the cross-tenant suite over the three new routes).

- [ ] **Step 12: Run the gates**

Run the four commands of "Gates every task ends on". Expected: all clean.

- [ ] **Step 13: Commit**

```bash
git add backend/src/idraft/api/ranks/service.py backend/src/idraft/api/schemas/ai.py backend/src/idraft/api/ai/observation_repository.py backend/src/idraft/api/ai/observations.py backend/src/idraft/api/ai/observation_routes.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/ai/test_observation_routes.py backend/tests/api/test_route_access.py backend/tests/security/test_cross_tenant.py backend/openapi/v1.json apps/web/src/lib/api/schema.ts
git commit -m "AI prompts: read answers, their citations and mentions, and the raw answer"
```

## Task 9: The prompts summary

**Files:**
- Modify: `backend/src/idraft/api/schemas/ai.py` (summary models)
- Create: `backend/src/idraft/api/ai/summary_repository.py`, `backend/src/idraft/api/ai/summary.py`, `backend/src/idraft/api/ai/summary_routes.py`
- Modify: `backend/src/idraft/api/resources.py`, `backend/src/idraft/api/main.py`
- Modify: `backend/tests/api/test_route_access.py` (`EXPECTED`)
- Modify: `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` (regenerated)
- Test: `backend/tests/api/ai/test_prompts_summary.py`

`GET {P}/ai/prompts-summary`, `data:read`. Query: `from` and `to` (project-local dates, both included; default the 28 days ending today, at most 92, `to` not before `from`), `filter[engine_code_in]`, `include_branded` (default false: branded prompts are left out, doc 16 rule 4). It answers:

- `prompts`: one row per active prompt of the project (archived ones, `is_active = false`, are left out), with a cell set per engine. Engines are the project's enabled ones plus any engine with answers in the window, narrowed by the filter, in code order.
- `topics`: one row per term of a `topic` vocabulary assigned to a listed prompt (a prompt with two topics counts in both), plus a row with `term_id: null` for the prompts without a topic, when there are any.
- Per engine, from the current fact rows of the window: `mentioned` (valid answers that name the own brand, over valid answers), `cited` (valid answers that cite the own domain, over valid answers), `outcomes` (the four of doc 04 section 8.5, each over valid answers) and `share_of_voice` (doc 16 section 5 in its per-observation form: the sum over valid answers naming at least one tracked entity of `1 / tracked_entities_mentioned` when the own brand is among them, over the number of those answers). Each is a `MetricCell`: `numerator`, `denominator`, `n_observations` (every answer of the cell, valid or not) and `value`, null when the denominator is 0.

With the base plan (two windows a week, one answer per engine), a 28 day window holds at most about 8 answers per prompt and engine, so the cells are counts like "5 of 8". No rollup table is needed: at capacity, 150 prompts x 3 engines x 8 answers is 3,600 fact rows per window.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/ai/test_prompts_summary.py`:

```python
"""The prompts summary (spec section 4.5): per prompt, engine and topic over a window,
Mentioned, Cited, the four outcomes and Share of voice, each as counts of valid answers."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import ensure_locations, project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger, worker_db
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    RIVAL_HOST,
    RIVAL_NAME,
    Prompt,
    add_prompt,
    chatgpt_answer,
    enable_engine,
    fetched_ai_task,
)
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

__all__ = ["worker_db"]

OWN_PAGE = f"https://{OWN_HOST}/managed-soc"
RIVAL_PAGE = f"https://{RIVAL_HOST}/soc"
OTHER_PAGE = "https://news.example/soc-guide"
# Long enough not to read as refusals.
BOTH = f"{OWN_NAME} and {RIVAL_NAME} both run managed SOC services in India today."
OWN_ONLY = f"{OWN_NAME} runs a managed SOC service in Mumbai with 24x7 monitoring."
NEITHER = "Several firms run managed SOC services in India with 24x7 monitoring."
Summary = tuple[Workspace, Project, Caller, dict[str, Prompt]]


async def _topic(pg: PostgresServer, project: Project, name: str) -> uuid.UUID:
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, 'topic', $3) RETURNING id",
        project.workspace_id,
        project.id,
        f"Topics {uuid.uuid4().hex[:6]}",
    )
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3, $4, $4) RETURNING id",
        project.workspace_id,
        vocabulary["id"],
        name,
        name.lower().replace(" ", "-"),
    )
    term_id: uuid.UUID = term["id"]
    return term_id


@pytest.fixture
async def summary(
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> Summary:
    """Three prompts on ChatGPT: `providers` (topic Managed SOC) has four answers (own and
    rival named, own named and cited, neither, a refusal), `pricing` (topic Managed SOC) has one
    answer citing a rival page, `brand` is branded and has one answer naming the own brand."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True)
    await _entity(migrated, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "gemini_web")
    prompts = {
        "providers": await add_prompt(migrated, project, "Best managed SOC providers in India?"),
        "pricing": await add_prompt(migrated, project, "How much does a managed SOC cost?"),
        "brand": await add_prompt(
            migrated, project, "Is Eventus Security a good SOC provider?", branded=True
        ),
    }
    topic = await _topic(migrated, project, "Managed SOC")
    for name in ("providers", "pricing"):
        await execute(
            migrated,
            "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
            prompts[name].id,
            topic,
            project.workspace_id,
        )
    now = datetime.now(UTC).replace(microsecond=0)
    answers: list[tuple[str, bytes]] = [
        ("providers", chatgpt_answer(BOTH, [OTHER_PAGE], when=now - timedelta(days=1))),
        ("providers", chatgpt_answer(OWN_ONLY, [OWN_PAGE], when=now - timedelta(days=4))),
        ("providers", chatgpt_answer(NEITHER, [OTHER_PAGE], when=now - timedelta(days=8))),
        (
            "providers",
            chatgpt_answer(
                "I'm sorry, but I can't help with that one.", when=now - timedelta(days=11)
            ),
        ),
        ("pricing", chatgpt_answer(NEITHER, [RIVAL_PAGE], when=now - timedelta(days=2))),
        ("brand", chatgpt_answer(OWN_ONLY, [], when=now - timedelta(days=3))),
        # Just outside the default window (its first day is 27 days before today), and never
        # more than a month back: the partitions reach one month back only.
        ("providers", chatgpt_answer(OWN_ONLY, [OWN_PAGE], when=now - timedelta(days=28))),
    ]
    for name, body in answers:
        await fetched_ai_task(worker_db, migrated, project, prompts[name], body, import_store)
    await ingest(worker_db, import_store)
    return workspace, project, owner, prompts


async def _summary(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: Project,
    caller: Caller,
    **params: Any,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project.id, "ai", "prompts-summary"),
        params=params,
        headers=caller.headers,
    )


def _cell(cells: dict[str, Any]) -> tuple[Any, Any, Any]:
    return cells["numerator"], cells["denominator"], cells["n_observations"]


async def test_each_prompt_has_its_counts_per_engine(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    workspace, project, owner, prompts = summary

    response = await _summary(api, workspace, project, owner)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["engine_codes"] == ["chatgpt_web", "gemini_web"]
    assert data["include_branded"] is False
    rows = {row["prompt_id"]: row for row in data["prompts"]}
    # Branded prompts are left out unless asked for.
    assert set(rows) == {str(prompts["providers"].id), str(prompts["pricing"].id)}
    chatgpt, gemini = rows[str(prompts["providers"].id)]["engines"]
    assert chatgpt["engine_code"] == "chatgpt_web"
    # Four answers, three valid: two name the own brand, one cites the own site.
    assert _cell(chatgpt["mentioned"]) == (2, 3, 4)
    assert chatgpt["mentioned"]["value"] == pytest.approx(2 / 3)
    assert _cell(chatgpt["cited"]) == (1, 3, 4)
    outcomes = chatgpt["outcomes"]
    assert [
        outcomes[name]["numerator"]
        for name in ("mentioned_and_cited", "mentioned_only", "cited_only", "neither")
    ] == [1, 1, 0, 1]
    # Two answers name a tracked entity: 1/2 (own and rival) plus 1/1 (own alone), over 2.
    assert _cell(chatgpt["share_of_voice"]) == (1.5, 2, 4)
    assert chatgpt["share_of_voice"]["value"] == pytest.approx(0.75)
    # No answers: counts of zero and no value.
    assert _cell(gemini["mentioned"]) == (0, 0, 0)
    assert gemini["mentioned"]["value"] is None


async def test_topics_add_up_their_prompts(api: httpx.AsyncClient, summary: Summary) -> None:
    workspace, project, owner, _ = summary

    response = await _summary(
        api, workspace, project, owner, **{"filter[engine_code_in]": "chatgpt_web"}
    )

    topics = response.json()["data"]["topics"]
    assert [(topic["name"], topic["prompt_count"]) for topic in topics] == [("Managed SOC", 2)]
    (engine,) = topics[0]["engines"]
    assert _cell(engine["mentioned"]) == (2, 4, 5)
    assert _cell(engine["cited"]) == (1, 4, 5)


async def test_branded_prompts_count_when_asked_for(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    workspace, project, owner, prompts = summary

    response = await _summary(api, workspace, project, owner, include_branded="true")

    data = response.json()["data"]
    rows = {row["prompt_id"]: row for row in data["prompts"]}
    assert str(prompts["brand"].id) in rows
    brand_chatgpt = rows[str(prompts["brand"].id)]["engines"][0]
    assert _cell(brand_chatgpt["mentioned"]) == (1, 1, 1)
    # The branded prompt has no topic: the row without one holds it.
    assert [(topic["term_id"], topic["prompt_count"]) for topic in data["topics"]][-1] == (None, 1)


async def test_the_window_is_the_projects_days(api: httpx.AsyncClient, summary: Summary) -> None:
    workspace, project, owner, prompts = summary
    today = datetime.now(UTC).date()

    wide = await _summary(
        api,
        workspace,
        project,
        owner,
        **{"from": (today - timedelta(days=60)).isoformat(), "to": today.isoformat()},
    )
    too_wide = await _summary(
        api, workspace, project, owner, **{"from": "2026-01-01", "to": "2026-06-30"}
    )
    reversed_window = await _summary(
        api, workspace, project, owner, **{"from": today.isoformat(), "to": "2026-01-01"}
    )

    rows = {row["prompt_id"]: row for row in wide.json()["data"]["prompts"]}
    assert rows[str(prompts["providers"].id)]["engines"][0]["mentioned"]["n_observations"] == 5
    assert wide.json()["data"]["window"]["from"] == (today - timedelta(days=60)).isoformat()
    assert problem(too_wide) == (422, "window_too_large")
    assert problem(reversed_window) == (422, "validation_failed")


async def test_a_project_without_prompts_has_empty_rows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = Project(workspace.id, await make_project(migrated, workspace.id))

    response = await _summary(api, workspace, project, owner)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["prompts"], data["topics"], data["engine_codes"]) == ([], [], [])
    assert date.fromisoformat(data["window"]["to"]) - date.fromisoformat(
        data["window"]["from"]
    ) == timedelta(days=27)
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/api/ai/test_prompts_summary.py --no-cov -q`
Expected: FAIL: the route answers `404`.

- [ ] **Step 3: Add the response models**

Append to `backend/src/idraft/api/schemas/ai.py` (add `MetricWindow` to the imports: `from idraft.api.schemas.metrics import MetricWindow`):

```python
class MetricCell(BaseModel):
    """One count of answers over another, with every answer of the cell: "5 of 8". The
    compact form of `MetricValue` (docs/19 section 2.6); the window is the response's."""

    value: float | None = Field(description="numerator / denominator; null when it is 0.")
    numerator: float
    denominator: int
    n_observations: int = Field(description="Every answer of the cell, valid or not.")


class OutcomeCells(BaseModel):
    mentioned_and_cited: MetricCell
    mentioned_only: MetricCell
    cited_only: MetricCell
    neither: MetricCell


class EngineSummary(BaseModel):
    engine_code: str
    mentioned: MetricCell
    cited: MetricCell
    outcomes: OutcomeCells
    share_of_voice: MetricCell


class PromptSummaryRow(BaseModel):
    prompt_id: UUID
    text: str
    is_branded: bool
    topic_term_ids: list[UUID]
    engines: list[EngineSummary]


class TopicSummaryRow(BaseModel):
    # Null for the prompts without a topic.
    term_id: UUID | None
    name: str | None
    prompt_count: int
    engines: list[EngineSummary]


class PromptsSummary(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[str]
    prompts: list[PromptSummaryRow]
    topics: list[TopicSummaryRow]


class PromptsSummaryResponse(BaseModel):
    data: PromptsSummary
```

- [ ] **Step 4: Write the repository**

Create `backend/src/idraft/api/ai/summary_repository.py`:

```python
"""Reads of the prompts summary (spec section 4.5): the prompts and their topics, the engines,
and counts of current fact rows by prompt or topic and engine. Row-level security keeps every
read in the caller's workspace; each query names the workspace and the project as well."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Float, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_observation_facts,
    ai_project_engines,
    ai_prompt_terms,
    ai_prompt_versions,
    ai_prompts,
    taxonomy_terms,
    taxonomy_vocabularies,
)

_F = ai_observation_facts.c


@dataclass(frozen=True, slots=True)
class Counts:
    n_observations: int = 0
    n_valid: int = 0
    mentioned: int = 0
    cited: int = 0
    mentioned_and_cited: int = 0
    mentioned_only: int = 0
    cited_only: int = 0
    neither: int = 0
    # Valid answers that name at least one tracked entity, and the own brand's share of them.
    sov_answers: int = 0
    sov_share: float = 0.0


@dataclass(frozen=True, slots=True)
class SummaryPrompt:
    id: UUID
    text: str
    is_branded: bool
    topic_term_ids: tuple[UUID, ...]


def _counts_columns() -> list[Any]:
    valid = _F.is_valid

    def count(*conditions: Any) -> Any:
        return func.count().filter(and_(*conditions))

    return [
        func.count().label("n_observations"),
        count(valid).label("n_valid"),
        count(valid, _F.own_mentioned).label("mentioned"),
        count(valid, _F.own_domain_cited).label("cited"),
        count(valid, _F.own_mentioned, _F.own_domain_cited).label("mentioned_and_cited"),
        count(valid, _F.own_mentioned, ~_F.own_domain_cited).label("mentioned_only"),
        count(valid, ~_F.own_mentioned, _F.own_domain_cited).label("cited_only"),
        count(valid, ~_F.own_mentioned, ~_F.own_domain_cited).label("neither"),
        count(valid, _F.tracked_entities_mentioned >= 1).label("sov_answers"),
        func.coalesce(
            func.sum(1.0 / cast(_F.tracked_entities_mentioned, Float)).filter(
                and_(valid, _F.own_mentioned, _F.tracked_entities_mentioned >= 1)
            ),
            0.0,
        ).label("sov_share"),
    ]


def _counts(row: Any) -> Counts:
    return Counts(
        n_observations=row.n_observations,
        n_valid=row.n_valid,
        mentioned=row.mentioned,
        cited=row.cited,
        mentioned_and_cited=row.mentioned_and_cited,
        mentioned_only=row.mentioned_only,
        cited_only=row.cited_only,
        neither=row.neither,
        sov_answers=row.sov_answers,
        sov_share=float(row.sov_share),
    )


def _topic_terms() -> Any:
    """(prompt, term) for terms of a `topic` vocabulary."""
    pt, t, v = ai_prompt_terms.c, taxonomy_terms.c, taxonomy_vocabularies.c
    return (
        select(pt.prompt_id, pt.term_id)
        .join(taxonomy_terms, and_(t.id == pt.term_id, t.workspace_id == pt.workspace_id))
        .join(
            taxonomy_vocabularies,
            and_(v.id == t.vocabulary_id, v.workspace_id == t.workspace_id),
        )
        .where(v.kind == "topic")
    )


async def summary_prompts(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, include_branded: bool
) -> list[SummaryPrompt]:
    """The project's active prompts (not archived), oldest first, with their topics."""
    p, v = ai_prompts.c, ai_prompt_versions.c
    statement = (
        select(p.id, v.text, p.is_branded)
        .join(
            ai_prompt_versions,
            and_(v.id == p.current_version_id, v.workspace_id == p.workspace_id),
        )
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.deleted_at.is_(None),
            p.is_active,
        )
        .order_by(p.created_at, p.id)
    )
    if not include_branded:
        statement = statement.where(~p.is_branded)
    rows = list(await db.execute(statement))
    if not rows:
        return []
    topics = _topic_terms().subquery()
    assigned: dict[UUID, list[UUID]] = {}
    for row in await db.execute(
        select(topics.c.prompt_id, topics.c.term_id).where(
            topics.c.prompt_id.in_([row.id for row in rows])
        )
    ):
        assigned.setdefault(row.prompt_id, []).append(row.term_id)
    return [
        SummaryPrompt(
            id=row.id,
            text=row.text,
            is_branded=row.is_branded,
            topic_term_ids=tuple(sorted(assigned.get(row.id, []), key=str)),
        )
        for row in rows
    ]


async def enabled_engine_codes(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[str]:
    e = ai_project_engines.c
    rows = await db.execute(
        select(e.engine_code).where(
            e.workspace_id == workspace_id, e.project_id == project_id, e.is_enabled
        )
    )
    return sorted(row.engine_code for row in rows)


def _window(
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> list[Any]:
    conditions = [
        _F.workspace_id == workspace_id,
        _F.project_id == project_id,
        _F.is_current,
        _F.observed_at >= since,
        _F.observed_at < until,
        _F.prompt_id.in_(list(prompt_ids)),
    ]
    if engine_codes is not None:
        conditions.append(_F.engine_code.in_(list(engine_codes)))
    return conditions


async def counts_by_prompt(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> dict[tuple[UUID, str], Counts]:
    if not prompt_ids:
        return {}
    rows = await db.execute(
        select(_F.prompt_id, _F.engine_code, *_counts_columns())
        .where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
        .group_by(_F.prompt_id, _F.engine_code)
    )
    return {(row.prompt_id, row.engine_code): _counts(row) for row in rows}


async def counts_by_topic(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> dict[tuple[UUID, str], Counts]:
    """Counts by topic term: an answer to a prompt of two topics counts in both."""
    if not prompt_ids:
        return {}
    topics = _topic_terms().subquery()
    rows = await db.execute(
        select(topics.c.term_id, _F.engine_code, *_counts_columns())
        .select_from(ai_observation_facts.join(topics, topics.c.prompt_id == _F.prompt_id))
        .where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
        .group_by(topics.c.term_id, _F.engine_code)
    )
    return {(row.term_id, row.engine_code): _counts(row) for row in rows}


async def counts_of_prompts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
    engine_codes: Sequence[str] | None,
) -> dict[str, Counts]:
    """Counts of a set of prompts together, by engine: the row of prompts without a topic."""
    if not prompt_ids:
        return {}
    rows = await db.execute(
        select(_F.engine_code, *_counts_columns())
        .where(*_window(workspace_id, project_id, prompt_ids, since, until, engine_codes))
        .group_by(_F.engine_code)
    )
    return {row.engine_code: _counts(row) for row in rows}


async def topic_names(
    db: AsyncSession, workspace_id: UUID, term_ids: Collection[UUID]
) -> dict[UUID, str]:
    if not term_ids:
        return {}
    t = taxonomy_terms.c
    rows = await db.execute(
        select(t.id, t.name).where(t.workspace_id == workspace_id, t.id.in_(list(term_ids)))
    )
    return {row.id: row.name for row in rows}
```

- [ ] **Step 5: Write the service**

Create `backend/src/idraft/api/ai/summary.py`:

```python
"""The prompts summary (spec section 4.5; docs/16-metrics-methodology.md sections 3 to 5): per
prompt and engine, and per topic and engine, over a window of project-local days."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from datetime import date, datetime, timedelta
from typing import Final
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import summary_repository as repository
from idraft.api.ai.summary_repository import Counts
from idraft.api.problems import NotFoundError, WindowTooLargeError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import (
    EngineSummary,
    MetricCell,
    OutcomeCells,
    PromptsSummary,
    PromptSummaryRow,
    TopicSummaryRow,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

# The default window, and the longest one, in project-local days.
SUMMARY_DAYS: Final = 28
SUMMARY_MAX_DAYS: Final = 92
_NONE: Final = Counts()


def summary_dates(start: date | None, end: date | None, today: date) -> tuple[date, date]:
    """The local days a summary covers, both included."""
    last = end or today
    first = start or last - timedelta(days=SUMMARY_DAYS - 1)
    if first > last:
        raise RequestValidationError(
            [{"loc": ("query", "from"), "type": "range_invalid", "msg": "`from` is after `to`."}]
        )
    if (last - first).days + 1 > SUMMARY_MAX_DAYS:
        raise WindowTooLargeError(
            f"A window is at most {SUMMARY_MAX_DAYS} days.", limit_days=SUMMARY_MAX_DAYS
        )
    return first, last


def _cell(numerator: float, denominator: int, n_observations: int) -> MetricCell:
    return MetricCell(
        value=None if denominator == 0 else numerator / denominator,
        numerator=numerator,
        denominator=denominator,
        n_observations=n_observations,
    )


def _engine(engine_code: str, counts: Counts) -> EngineSummary:
    valid, total = counts.n_valid, counts.n_observations
    return EngineSummary(
        engine_code=engine_code,
        mentioned=_cell(counts.mentioned, valid, total),
        cited=_cell(counts.cited, valid, total),
        outcomes=OutcomeCells(
            mentioned_and_cited=_cell(counts.mentioned_and_cited, valid, total),
            mentioned_only=_cell(counts.mentioned_only, valid, total),
            cited_only=_cell(counts.cited_only, valid, total),
            neither=_cell(counts.neither, valid, total),
        ),
        share_of_voice=_cell(counts.sov_share, counts.sov_answers, total),
    )


def _engines(engine_codes: Sequence[str], counts: Mapping[str, Counts]) -> list[EngineSummary]:
    return [_engine(code, counts.get(code, _NONE)) for code in engine_codes]


class SummaryService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def summary(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        start: date | None,
        end: date | None,
        engine_codes: Sequence[str] | None,
        include_branded: bool,
    ) -> PromptsSummary:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            zone_row = await project_zone(db, ws, project_id)
            if zone_row is None:
                raise NotFoundError
            zone = ZoneInfo(zone_row.timezone)
            first, last = summary_dates(start, end, datetime.now(zone).date())
            since, until = instants(first, last, zone)
            prompts = await repository.summary_prompts(
                db, ws, project_id, include_branded=include_branded
            )
            ids = [prompt.id for prompt in prompts]
            window = {"since": since, "until": until, "engine_codes": engine_codes}
            by_prompt = await repository.counts_by_prompt(db, ws, project_id, ids, **window)
            by_topic = await repository.counts_by_topic(db, ws, project_id, ids, **window)
            untopiced = [prompt.id for prompt in prompts if not prompt.topic_term_ids]
            no_topic = await repository.counts_of_prompts(db, ws, project_id, untopiced, **window)
            enabled = await repository.enabled_engine_codes(db, ws, project_id)
            term_ids = {term for prompt in prompts for term in prompt.topic_term_ids}
            names = await repository.topic_names(db, ws, term_ids)
        seen = {engine for _, engine in by_prompt}
        shown = sorted(
            code for code in set(enabled) | seen if engine_codes is None or code in engine_codes
        )
        prompt_rows = [
            PromptSummaryRow(
                prompt_id=prompt.id,
                text=prompt.text,
                is_branded=prompt.is_branded,
                topic_term_ids=list(prompt.topic_term_ids),
                engines=_engines(
                    shown,
                    {
                        code: by_prompt[(prompt.id, code)]
                        for code in shown
                        if (prompt.id, code) in by_prompt
                    },
                ),
            )
            for prompt in prompts
        ]
        topic_rows = [
            TopicSummaryRow(
                term_id=term_id,
                name=names.get(term_id),
                prompt_count=sum(term_id in prompt.topic_term_ids for prompt in prompts),
                engines=_engines(
                    shown,
                    {
                        code: by_topic[(term_id, code)]
                        for code in shown
                        if (term_id, code) in by_topic
                    },
                ),
            )
            for term_id in sorted(term_ids, key=lambda term: (names.get(term, ""), str(term)))
        ]
        if untopiced:
            topic_rows.append(
                TopicSummaryRow(
                    term_id=None,
                    name=None,
                    prompt_count=len(untopiced),
                    engines=_engines(shown, no_topic),
                )
            )
        return PromptsSummary(
            window=MetricWindow(
                from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
            ),
            include_branded=include_branded,
            engine_codes=shown,
            prompts=prompt_rows,
            topics=topic_rows,
        )
```

- [ ] **Step 6: Write the route**

Create `backend/src/idraft/api/ai/summary_routes.py`:

```python
"""The prompts summary (spec section 4.5): what the Topics & Prompts page reads."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.ai.summary import SummaryService
from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import PromptsSummaryResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_summary_service(resources: Annotated[Resources, Depends(get_resources)]) -> SummaryService:
    return resources.ai_summary


Summaries = Annotated[SummaryService, Depends(get_summary_service)]


@router.get(
    "/prompts-summary",
    summary="Mentioned, Cited, outcomes and Share of voice per prompt, engine and topic",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`). Each cell counts valid answers: "
    "`numerator` of `denominator`, with `n_observations` every answer of the cell and `value` "
    "null when the denominator is 0. Share of voice is doc 16 section 5 per observation: the "
    "own brand's share of the tracked entities each answer names, over the answers that name "
    "one. Branded prompts are left out unless `include_branded` is true. A prompt of two "
    "topics counts in both; prompts without a topic share a row with `term_id` null.",
)
async def prompts_summary(
    project_id: UUID,
    access: ReadData,
    summaries: Summaries,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[str] | None, Commas, Query(alias="filter[engine_code_in]", max_length=10)
    ] = None,
    include_branded: bool = False,
) -> PromptsSummaryResponse:
    return PromptsSummaryResponse(
        data=await summaries.summary(
            access,
            project_id,
            start=start,
            end=end,
            engine_codes=engine_codes,
            include_branded=include_branded,
        )
    )
```

- [ ] **Step 7: Wire the service and the router**

In `backend/src/idraft/api/resources.py` add the import and the field after `ai_observations`:

```python
from idraft.api.ai.summary import SummaryService
```

```python
    ai_summary: SummaryService
```

In `backend/src/idraft/api/main.py` add the imports:

```python
from idraft.api.ai.summary import SummaryService
from idraft.api.ai.summary_routes import router as ai_summary_router
```

in the `Resources(...)` call, after `ai_observations=...`:

```python
                ai_summary=SummaryService(sessions=sessions),
```

and after `app.include_router(ai_observations_router)`:

```python
    app.include_router(ai_summary_router)
```

In `backend/tests/api/test_route_access.py` add to `EXPECTED`:

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary"): (
        "data:read"
    ),
```

- [ ] **Step 8: Regenerate the contract**

Run:
```bash
cd backend && uv run python -m idraft.api.openapi > openapi/v1.json
cd ../apps/web && pnpm gen:api && pnpm typecheck
```
Expected: the operation and the summary schemas added; typecheck passes.

- [ ] **Step 9: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/api/ai/ tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py --no-cov -q`
Expected: PASS (5 new tests in `test_prompts_summary.py`).

- [ ] **Step 10: Run the whole backend suite once**

Run: `cd backend && ./check.sh`
Expected: every gate passes and the coverage gate (90) holds. This is the first full run since Task 1; fix any test elsewhere that the new tables, routes or ticks broke before committing.

- [ ] **Step 11: Commit**

```bash
git add backend/src/idraft/api/schemas/ai.py backend/src/idraft/api/ai/summary_repository.py backend/src/idraft/api/ai/summary.py backend/src/idraft/api/ai/summary_routes.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/ai/test_prompts_summary.py backend/tests/api/test_route_access.py backend/openapi/v1.json apps/web/src/lib/api/schema.ts
git commit -m "AI prompts: the prompts summary per prompt, engine and topic"
```

## Task 10: As built notes, the roadmap line and the first real run

**Files:**
- Modify: `docs/19-api-specification.md` (after the tables of sections 3.7.5 and 3.7.6)
- Modify: `docs/07-dataforseo-ai-integration.md` (end of section 5.5)
- Modify: `docs/13-ai-extraction-engine.md` (end of section 5)
- Modify: `docs/21-scheduler-workers.md` (the tick table of "As built (step 5, keywords)")
- Modify: `docs/29-phase-roadmap.md` (under `### Phase 7: AI collection` and `### Phase 8: AI extraction`)
- Create: `docs/ops/ai-first-run.md`

No step of the runbook spends money by itself: every paid step is a request the owner sends, after the budget and the estimate are on screen. Prose follows the house style: no em or en dashes.

- [ ] **Step 1: Doc 19, section 3.7.5**

Insert after the table of `#### 3.7.5 AI collection triggers (Phase 7)` (before `#### 3.7.6`):

```markdown
**As built (step 8, slice 1, plan B).** `POST {P}/prompts/{prompt_id}/run-now` takes `{ engine_codes: EngineCode[] }` (one to three) and answers `202 One<Run>` with a `planned` run of workload `ai_prompt`, selector `{ prompt_ids: [id], engine_codes }`; the worker plans it within a minute through the provider's **standard queue**, not live endpoints (spec section 4.3: a third of the price, and no request held for up to 120 s), so answers arrive in minutes. A prompt that is archived or of another project is `404`. `422 validation_failed` with `engine_not_enabled` for an engine the project has not turned on, `prompt_too_long` for a prompt over an engine's limit (700 characters for AI Mode). An answer of the prompt already queued or under way on one of the engines, or a planned run that names the prompt, is `409 check_pending` with `engine_codes`. `429 manual_run_limit` after 20 manual runs in a day (UTC), shared with the other manual runs; `422 quota_exceeded` with `quota: 'max_ai_observations_per_month'` when the month's AI answers (every `ai_prompt` task of the month not cancelled, plus what planned runs still ask for) would pass the limit; `503 provider_paused`. A budget used up makes the run `budget_blocked`. Not built: the `Idempotency-Key` header (the manual run lock and the pending check stop a second paid request for the same answer), `location_ids` and `replicates` in the body (every engine location in the prompt's country, one replicate), and `GET {P}/runs/{run_id}/ai-coverage`. Audit action: `collection_run.requested` with `workload: 'ai_prompt'`.
```

- [ ] **Step 2: Doc 19, section 3.7.6**

Insert after the `ObservationSummary` code block of `#### 3.7.6` (before `#### 3.7.7`):

```markdown
**As built (step 8, slice 1, plan B).** `GET {P}/ai/observations` takes `from` and `to` (timestamps, or project-local dates with `to` included; default the last 28 days, at most 92, `422 window_too_large`), `filter[engine_code_in]`, `filter[prompt_id]`, `filter[status_in]`, `filter[is_valid]` and `filter[outcome_in]`; the other filters of the table wait for their data. `observation_id` is a string. A superseded observation is never listed. `GET {P}/ai/observations/{observation_id}` takes `observed_at` as a hint to find the month and no `derivation_id` (the current derivation is the only one in slice 1); the detail is the summary plus `answer_text`, `error_code`, `check_url`, `citations` (index, canonical `url`, `raw_url`, `host`, `title`, `source_name`, `citation_kind`, `domain_role`, `role_entity_id`, `occurrences`, `first_char_offset`, `answer_block_index`, `referral_tag`, `flags`) and `mentions` (entity id and `name`, `role`, `mention_count`, `first_char_offset`, `mention_order`, `match_method`, `mention_status`, `confidence`, `evidence_spans` as `[start, end)` pairs). Offsets are UTF-16 code units (`offsets_unit: 'utf16'`). `answer_text` is the answer's markdown, ads left out (doc 07 section 5 as built). `GET .../{observation_id}/raw` (`raw:read`) answers with the headers of the SERP raw route, `410 raw_expired`, `503 raw_unavailable`. `.../derivations` is not built.

**As built (step 8, slice 1, plan B): prompts summary.** `GET {P}/ai/prompts-summary` (`data:read`) replaces the Prompt Explorer reads of phase 9 for slice 1. Query: `from`, `to` (project-local dates, default the 28 days ending today, at most 92), `filter[engine_code_in]`, `include_branded` (default false, doc 16 rule 4). Answer `{ data: { window, include_branded, engine_codes, prompts: PromptSummaryRow[], topics: TopicSummaryRow[] } }`: a row per active prompt (`prompt_id`, `text`, `is_branded`, `topic_term_ids`) and a row per topic term (`term_id`, `name`, `prompt_count`; `term_id: null` for the prompts without a topic), each with one `EngineSummary` per engine (the enabled ones and any with answers in the window): `mentioned`, `cited`, `outcomes` (`mentioned_and_cited`, `mentioned_only`, `cited_only`, `neither`) and `share_of_voice`. Each is a `MetricCell` `{ value, numerator, denominator, n_observations }`, the compact form of `MetricValue` with the window stated once; `value` is null when the denominator is 0, and `ci` waits for slice 3. Mentioned, Cited and the outcomes count valid answers over valid answers; Share of voice is doc 16 section 5 per observation, over the valid answers that name a tracked entity. With the base plan a 28 day window holds at most about 8 answers per prompt and engine.
```

- [ ] **Step 3: Doc 07, section 5**

Insert at the end of `### 5.5 Refusals, empties, partials` (before `## 6. Raw storage`):

```markdown
**As built (step 8, slice 1, normalizer version 1).** `providers/dataforseo/ai_parse.py`, on the three answers captured in S-04 and six synthetic ones (`backend/tests/fixtures/dataforseo/ai/registry.json`). The answer text is the markdown of the items that are not ads, joined as the provider joins them (for ChatGPT that is the top-level `markdown`, checked on the capture), and for AI Mode the `ai_overview` item's markdown, rebuilt from its elements only when a paid element is among them. There is no markdown renderer yet, so `answer_text` is that markdown and equals `answer_markdown`; extraction blanks link targets before matching. Citations: ChatGPT and Gemini `sources[]` (`source_list`) then the sources the blocks cite (`inline`); AI Mode `references[]` (`reference_card`) then element links (`inline`); one per canonical URL in first-appearance order, `occurrences` the number of blocks citing it. `search_results[]` and `fan_out_queries[]` are counted and kept in `provider_extras` (with `check_url`, the provider's brand entities and the ads, cut to 16 KB); the retrieval and fan-out tables are slice 2. Status: `error` (with the task's status code) for a task status of 40000 or more, and `error` with `schema_mismatch` for an answer of another shape, stored with its payload; `empty` without text; `refused` under 40 characters or with an English refusal phrase in the first 200 (other languages later); `partial` for markdown with no items behind it; else `complete`. The model is kept with its whitespace collapsed (`3.5 Flash-Lite`). No ad has been seen yet; the rule is in place and a synthetic answer tests it.
```

- [ ] **Step 4: Doc 13, section 5**

Insert at the end of `## 5. Outputs` (before `## 6. Derivations`):

```markdown
**As built (step 8, slice 1).** Stages 1, 2, 4, 5 and 7 run at ingest (`extraction/ai_facts.py`, extractor version 1), on the answer's markdown with link targets blanked (offsets unchanged), so a cited URL is a citation and not a mention. Stage 3 (document structure), 6 (structured lists), 8 to 11 wait for slice 2: `had_structured_list` is false, `structured_rank`, `is_recommended` and `sentiment` are null, and `ai.derivations` rows carry `recommendation_version = 0` and `sentiment_version = 0` for "no classifier". Mentions are kept for the entities the project tracks in AI answers (`track_ai`); a watched entity is kept and counts in no share; an uncertain mention is kept and counts in no rate. The worker builds the project's matcher once per ingest pass (`collectors/ai_context.py`, the worker's copy of the API's `matcher_rules`, because collectors may not import the API) and the derivation records the entity configuration version it used. Re-deriving old answers after an alias change is the section 6 job, not built.
```

- [ ] **Step 5: Doc 21, the tick table**

In `**As built (step 5, keywords).**` change "and a seventh, `rank_ingest`, since rank collection" to "a seventh, `rank_ingest`, since rank collection, and an eighth, `ai_prompt_ingest`, since AI prompts (step 8)", and add after the `rank_ingest` row:

```markdown
| `ai_prompt_ingest` | 30 s | 28 s | (step 8) reads fetched `ai_prompt` tasks into observations, citations, entity mentions and fact rows, one transaction a task; an answer that cannot be read is stored as an `error` observation; needs the raw bucket: without one the tick does nothing |
```

- [ ] **Step 6: Doc 29, the roadmap**

Insert directly under the `### Phase 7: AI collection` heading:

```markdown
**As built (step 8, slice 1, plan B, 2026-11-11).** The ChatGPT scraper, the Gemini scraper and Google AI Mode through DataForSEO's standard queue (adapter and normalizer version 1), the `ai_prompt` workload (each active prompt once per schedule window on each enabled engine, at the engine's locations in the prompt's country; two windows a week with the base plan), Run now, the ingest tick and the answer routes are built (plan `docs/superpowers/plans/2026-11-11-ai-prompts-b-collection-and-extraction.md`). Not built: replicates, live answers, the AI Mode keyword workload, fan-out and retrieval tables, the coverage route. The first real run is `docs/ops/ai-first-run.md`.
```

and directly under `### Phase 8: AI extraction`:

```markdown
**As built (step 8, slice 1, plan B).** Light extraction at ingest: citation roles, own and competitor mentions with evidence spans, and the fact row per answer under the project's derivation; `GET {P}/ai/prompts-summary` reads Mentioned, Cited, the four outcomes and Share of voice from the fact rows. Recommendation, sentiment, structured lists, untracked entities and re-derivation are slice 2.
```

- [ ] **Step 7: The first real run**

Create `docs/ops/ai-first-run.md`:

````markdown
# First real run of AI prompt tracking (Eventus Security)

The acceptance run of spec section 6 for slice 1: all 150 prompts of `docs/ops/eventus-ai-prompts.csv` on the Eventus Security project, on ChatGPT, Gemini and Google AI Mode, in two steps. Nothing here spends money by itself: each paid step is a request you send, after the budget and the estimate are on screen.

Prices (DataForSEO standard queue, S-04): 0.0012 USD per answer. The base plan asks every active prompt on every enabled engine twice a week (Monday and Thursday, 01:00 project time).

| Step | Answers | Cost |
|---|---|---|
| Step 2 Run now, 5 prompts x 3 engines | 15 | 0.018 USD once |
| 5 prompts on the schedule | 30 a week | 0.036 USD a week |
| 150 prompts, one window | 450 | 0.54 USD |
| 150 prompts on the schedule | 900 a week | about 4.68 USD a month |

## Before you start

1. The release with AI prompts (plans A and B) is on the VPS: `GET https://app.idraft.ai/api/internal/health` answers `ok` for the database, Redis, the raw bucket and the worker.
2. The DataForSEO balance covers at least 10 USD.
3. Set a hard budget for AI answers on the project, so a mistake cannot spend more. On the VPS, as the migrator role:

   ```sql
   INSERT INTO ops.budgets (workspace_id, project_id, workload, period, limit_usd)
   SELECT p.workspace_id, p.id, 'ai_prompt', 'month', 10.00
   FROM core.projects p WHERE p.name = 'Eventus Security' AND p.deleted_at IS NULL
   ON CONFLICT (workspace_id, project_id, workload, period) DO UPDATE SET limit_usd = 10.00;
   ```

   Check it: `GET /api/v1/workspaces/{workspace_id}/budgets/status` lists the `ai_prompt` budget with `spent_usd` 0.

## Step 1: five prompts, engines on, nothing spent yet

1. Add the first 5 rows of `docs/ops/eventus-ai-prompts.csv` (country `IN`, language `en`) with the Add prompts dialog, or `POST {P}/prompts/bulk-create`. The prompt count against the quota (150) is shown before saving.
2. Turn on the three engines at India (location 2356) in project settings, Engines, or `PUT {P}/engines/{engine_code}` with `{"location_ids": [2356], "is_enabled": true}` for `chatgpt_web`, `gemini_web` and `google_ai_mode`. Read `estimated_monthly_cost_usd` first (`GET {P}/engines`): about 0.16 USD a month for 5 prompts on three engines.
   This makes the two weekly schedules. The first scheduled window (the next Monday or Thursday, 01:00 IST) asks the 5 prompts: 0.018 USD.

## Step 2: Run now and check the answers by hand

1. For each of the 5 prompts send `POST {P}/prompts/{prompt_id}/run-now` with `{"engine_codes": ["chatgpt_web", "gemini_web", "google_ai_mode"]}` (or the Run now button). Each answers `202` with a planned run.
2. Within a minute the run is `running`: `GET {P}/runs/{run_id}` shows `estimated_cost_usd` 0.0036 and its tasks; `budgets/status` shows the committed estimate.
3. Within a few minutes every task is `ingested`. List them: `GET {P}/ai/observations?filter[prompt_id]={prompt_id}`.
4. For each answer, open it (`GET {P}/ai/observations/{observation_id}` or the answer viewer) and ask the same prompt by hand in chatgpt.com, gemini.google.com and Google AI Mode, signed out, from India, in English. Record in a table: engine, prompt, "Eventus Security named" (ours / by hand), "eventussecurity.com cited" (ours / by hand), competitors named. Answers differ from one asking to the next; what matters is that our marks match our stored answer, and that the stored answer reads like the product's.
5. Check the database agrees with the screens:

   ```sql
   SELECT o.engine_code, o.status, count(*) AS answers,
          count(*) FILTER (WHERE f.own_mentioned) AS mentioned,
          count(*) FILTER (WHERE f.own_domain_cited) AS cited,
          sum(o.cost_usd) AS cost_usd
   FROM ai.observations o
   JOIN ai.observation_facts f
     ON f.observation_id = o.id AND f.observed_at = o.observed_at AND f.is_current
   JOIN core.projects p ON p.id = o.project_id
   WHERE p.name = 'Eventus Security' AND o.observed_at > now() - interval '1 day'
   GROUP BY 1, 2 ORDER BY 1, 2;
   ```

   Expected: 5 `complete` answers per engine (a `refused` or `empty` one is possible and is counted in no rate), cost 0.006 USD per engine.

Stop here if the marks do not match the answers: turn the engines off (`PUT {P}/engines/{engine_code}` with `"is_enabled": false`), which stops the schedules from asking anything more.

## Step 3: the other 145 prompts

1. Add rows 6 to 150 of the CSV the same way. `GET {P}/engines` now estimates about 4.68 USD a month for the three engines.
2. Nothing more to send: the next scheduled window asks all 150 prompts on the three engines, 450 answers, 0.54 USD. Before it sends anything the planner checks the run's estimate against the `ai_prompt` budget; a run over the budget is `budget_blocked` and spends nothing.
3. After that window, run the SQL of step 2 again with `interval '2 days'`: about 150 answers per engine, cost about 0.18 USD per engine. `GET {P}/ai/prompts-summary` shows each prompt's counts per engine ("1 of 1" after the first window, up to about 8 of 8 after four weeks).
````

- [ ] **Step 8: Check the prose**

Run: `grep -nP '\x{2014}|\x{2013}' docs/19-api-specification.md docs/07-dataforseo-ai-integration.md docs/13-ai-extraction-engine.md docs/21-scheduler-workers.md docs/29-phase-roadmap.md docs/ops/ai-first-run.md | grep -i 'step 8\|ai_prompt\|first real run' || echo clean`
Expected: `clean`.

- [ ] **Step 9: Commit**

```bash
git add docs/19-api-specification.md docs/07-dataforseo-ai-integration.md docs/13-ai-extraction-engine.md docs/21-scheduler-workers.md docs/29-phase-roadmap.md docs/ops/ai-first-run.md
git commit -m "As built notes and the first real run for AI prompts slice 1, plan B"
```

## Self-review

- **Spec coverage.** Section 7 step 5 (adapters and normalizers): Tasks 1 and 2, with the three captured answers and the synthetic refusal, empty, partial, ad, model whitespace and task error fixtures (spec section 6, first bullet). Step 6 (workload, schedule, run now): Task 5 (the workload; the schedule itself is plan A's `ensure_ai_schedule`), Task 6 (registration with the ingest), Task 7 (Run now on the standard queue, spec section 4.3). Step 7 (light extraction at ingest, spec section 4.4): Tasks 3, 4 and 6; uncertain mentions out of the rates, citation roles, the derivation per entity configuration version. Step 8 (read routes): Tasks 8 and 9, with route access, cross-tenant entries, OpenAPI and the web client regenerated. Spec section 5: a failed provider task follows the ledger rules; an unreadable answer is an `error` observation with its code (Task 6); a prompt over an engine's limit is skipped with the reason (Task 5) and refused by Run now (Task 7); the `ai_prompt` budget is the planner's check. Spec section 6, the real run: Task 10's runbook, 150 prompts in two steps. The owner's base plan change: once per window and no cadence in the workload (Task 5), the 28 day summary window sized to about 8 answers (Task 9), the 0.54 USD full run and 4.68 USD a month (Task 10).
- **Placeholders.** Every code step holds its code and every run step its command and expected result. Two steps adapt to plan A's file without knowing its exact lines (the imports of `prompt_routes.py` and `schemas/ai.py`): they name the lines to add and say to skip those already there.
- **Type consistency.** `ENGINE_ENDPOINTS`, `PROMPT_MAX`, `AiAnswerParams`, `parse_ai_answer`, `unreadable`, `NormalizedAnswer.is_valid`, `CitedSource`, `SourceIn`, `extract_answer_facts`, `AiContext`, `AiContextCache.get`, `domain_rules`, `location_codes`, `run_queues`, `select_subjects`, `estimate`, `UNSETTLED`, `SUBJECT_TYPE`, `current_derivation(db, workspace_id, project_id, entity_config_version)`, `RunnablePrompt`, `pending_engines`, `read_stored_answer`, `request_bounds`, `ObservationFilter`, `MetricCell`, `Counts`, `summary_dates` are used with the signatures they are defined with. Tasks 1 to 3 were run against the captured fixtures before this plan was written (35 tests passing, ruff and mypy clean); the database tasks were checked with ruff and mypy against the current code, with plan A's names the only unresolved ones.
- **Risks the reviewer should look at.** `evidence_spans` is bound as a list of `sqlalchemy.dialects.postgresql.Range` (asyncpg); the cross-tenant suite looks for numeric ids in other tenants' answers, and an observation id is a small integer as snapshot ids are; the refusal phrases are English only.

## Notes carried forward from the review of plan A task 2

- `ai.observation_raw(bigint)` filters by workspace only, not by project: `ObservationService.raw_answer(access, project_id, ...)` must first check that the observation belongs to `project_id` (404 otherwise) before it calls the function.
- The worker's grants on the answer tables are append only: the `is_current` flip and `superseded_by` need column UPDATE grants, and "a newer observation from raw" collides with `observations_one_per_task`. Slice 1 does neither; settle both in the plan that adds re-derivation (slice 2).
- `ai.entity_mentions` and `ai.observation_facts` reference `ai.derivations` with NO ACTION and carry no project FK, so a purge of a project that has extraction rows must delete the answer rows first (nothing hard-deletes projects today).
