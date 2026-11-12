# AI prompts D3: seed Eventus Security into the development database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One documented command, `uv run --env-file .env python -m idraft.cli seed-eventus`, that makes the Eventus Security AI prompt tracking project in a DEVELOPMENT database from `fixtures/ai-prompts/eventus-security.json` (project, brand, 8 competitors, 29 topics, 2 engines in IN, AE and SA with their schedules paused, 72 prompts), refuses to run anywhere else, and changes nothing when run again.

**Architecture:** A new package `idraft.devseed`, reached only from the existing operator CLI (`idraft/cli.py`, new subcommand `seed-eventus`). A strict Pydantic loader reads the fixture; a guard refuses unless `APP_ENV` is `local` and both the database and `APP_ORIGIN` are on this machine's loopback. The seed acts as an existing owner of the workspace and writes ONLY through the services the routes use (`ProjectService`, `EntityService`, `ProjectEntityService`, `TaxonomyService`, `EngineService`'s rules, `ScheduleService`'s pause, `PromptService.bulk_create` and `update`), so permissions, quotas, locks, normalization, `is_branded`, versions and audit entries are the API's own. Two service bodies are lifted into in-transaction functions (`put_engine`, `pause_schedule`) so turning the engines on and pausing the schedules that makes commit together.

**Tech Stack:** Python 3.13, Pydantic 2, SQLAlchemy 2 Core (async, asyncpg), PostgreSQL 18, pytest with Testcontainers, ruff, mypy strict, import-linter.

---

## Where this plan sits

- Worktree: `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-prompts`, branch `ai/prompts-slice1`, written at `origin/develop` 2af56b2c. Paths below are relative to the worktree. B = `backend/src/idraft`, BT = `backend/tests`.
- **Another agent is implementing plan D1 Task 4 in this worktree** (the summary files: `B/api/ai/summary*.py`, `B/api/schemas/ai.py`, `BT/api/ai/test_prompts_summary.py` and whatever that task names). This plan never edits those files. It imports `CountryIso`, `Importance`, `PromptType`, `PromptCreate`, `PromptBulkCreate`, `PromptPatch` and `EngineUpdate` from `B/api/schemas/ai.py` and never changes them. `apps/web/src/lib/api/schema.ts` shows as modified by another session: never stage it. Every commit below names its files; never `git add -A` or `git add .`.
- No migration, no route, no OpenAPI change: `backend/openapi/v1.json` is not touched, and the web client is not regenerated.
- Sources: `fixtures/ai-prompts/README.md` ("Seeding the backend"), `docs/ops/ai-first-run.md` (how engines and schedules are enabled on a real server), plan A (`docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md`: prompt identity, quota, versions, terms) and plan D2 (bulk run, `POST {P}/ai/runs`).
- What the current development database holds (read on 2026-11-12, read only, container `idraft-dev-postgres-1`): workspaces `connect-test` and `connect-test-2`, each with a project `eventus-security` made for keyword work; NO workspace `digibranders`; `core.locations` holds India (2356) only; the schema is not migrated to 0018 (no `ai` schema). The runbook in Task 10 covers each.

## Decisions

1. **One command, a subcommand of the existing operator CLI.** `python -m idraft.cli` already holds `create-operator` and uses argparse subcommands; `seed-eventus` joins it. Run from `backend/`: `uv run --env-file .env python -m idraft.cli seed-eventus`. Options: `--workspace SLUG` (default `digibranders`) and `--fixture PATH` (default the repository's `fixtures/ai-prompts/eventus-security.json`). It reads `backend/.env`, so it connects as `app_api`, under row-level security, exactly as the API does.
2. **The dev guard: three independent facts, each enough to refuse, checked before the fixture is read or a connection is opened** (`idraft.devseed.guard.check_development`):
   1. `APP_ENV` is `local`. The server's `api.env` and `worker.env` say `production` (`infra/vps/provision.sh`); the test suite says `test`. `Settings.app_env` is the only environment setting the backend has (`B/config/settings.py`: `local`, `test`, `production`).
   2. The host of `DATABASE_URL` is `localhost`, `127.0.0.1` or `::1`. The dev stack publishes PostgreSQL on `127.0.0.1:54329` (`infra/compose/docker-compose.dev.yml`, `backend/.env.example`). Unix sockets cannot reach the seed: `DATABASE_URL` must name a host and may not carry query parameters (`_validate_database_url`), so no `?host=/socket` form exists. The compose service name `postgres` is NOT accepted: it is what the production compose file (`infra/compose/docker-compose.yml`) would use.
   3. The host of `APP_ORIGIN` is `localhost`, `127.0.0.1` or `::1`. The server's is `https://app.idraft.ai`.
   **How the live server's Eventus Security project is never touched:** it lives in a different PostgreSQL on another machine (the VPS), whose only listener is that machine's own loopback. Run on the server, the seed is refused twice over: its env files say `APP_ENV=production` (fact 1) and `APP_ORIGIN=https://app.idraft.ai` (fact 3). Fact 2 alone would not be enough there, since the server's database is on ITS loopback; that is why all three are required. `APP_ENV` defaults to `local` when unset, so a server env file that lost its `APP_ENV` would still be refused by fact 3. The server's `migrator.env` has no `APP_ORIGIN` or `REDIS_URL`, so `load_settings()` stops before the guard (exit 2). The image does not contain `fixtures/`, so even a guard bypassed by hand on the server would stop at the fixture read (not relied on). The one thing the guard cannot see is an SSH tunnel that brings another database to a local port with a local env file: the runbook says never to do that (Open point 5).
3. **The actor.** The seed acts as the most recently created active user who is an owner of the named active workspace (`find_owner`). The API role sees a membership only as its own user (`auth.memberships` policy: `user_id = auth.current_user_id()`), and `auth.users` has no row policy, so the seed lists active users newest first and asks for each one's owner membership of the slug in a `user_transaction`, stopping at the first. A missing, suspended or deleting workspace, or one without an active owner, stops the seed with a message. It never creates a user or a workspace: no dev bootstrap does (`create-operator` makes a user only; a workspace comes from the app's onboarding). Audit entries carry that owner as the actor and the user agent `python -m idraft.cli seed-eventus` (`SEED_INFO`).
4. **Writes go through the route services, reads may use the repositories.** Every row the seed writes is written by the service method the matching route calls, so the same validation, locks, quotas and audit entries apply. Reads that only decide what to write (does the entity exist, which terms exist) use the repository functions inside a `workspace_transaction` as the owner.
5. **Idempotency keys** (the second run writes nothing and adds no audit entry; Task 9 asserts both by counting rows and audit entries):

   | What | Matched by | Written by |
   |---|---|---|
   | Project | slug in the workspace (`core.projects` unique key) | `ProjectService.create`, else `ProjectService.update` (writes nothing when equal) |
   | Brand, competitors | canonical name, case-insensitive, in the workspace | `EntityService.create`, `add_aliases`, `add_domain`, `update` |
   | Alias | case-folded text, per entity | `EntityService.add_aliases` (missing ones only) |
   | Domain | the stored host of a `host` rule (`stored_host`) | `EntityService.add_domain` (missing ones only) |
   | Role | (project, entity) | `ProjectEntityService.add` (only when no live role) |
   | Topic vocabulary | the project's own vocabulary of kind `topic` named `Security topics` | `TaxonomyService.create_vocabulary` |
   | Topic term | its path, `parent-slug` or `parent-slug/child-slug` | `TaxonomyService.add_terms` (missing ones only) |
   | Engine | engine code, on, with exactly the fixture's country locations | `put_engine` (only when it differs) |
   | AI schedule | every live, active `ai_prompt` schedule of the project | `pause_schedule` |
   | Prompt | **the API's own identity: composed text, language and country** (`prompt_service.key_of`, sha256 of the NFC text) | `PromptService.bulk_create` with `on_duplicate: skip`, then `PromptService.update` for a found prompt that differs |

   Prompts have no key column and get none: the fixture's `p01` to `p72` are never stored. The API already treats the same text, language and country as one prompt (`409 duplicate`, archived ones included), so a second run's `bulk_create` lists all 72 in `skipped` and makes nothing. A fixture text that changes is a new prompt; the old one stays (archive it in the app).
6. **Converge, never remove or rename.** The fields the fixture names are brought in line on every run: the project's name, time zone, language, primary domain and default location; an entity's ambiguity and hints; missing aliases and domains; missing roles; missing terms; each prompt's intent, funnel stage, type, importance and topics; a seeded prompt found archived is brought back (it counts against the quota). Nothing the fixture does not name is removed: extra aliases, domains, competitors, terms or prompts a developer added stay. Names are not rewritten: an entity found as `eventus security` keeps that spelling, a term found at the right path keeps its name. A role that contradicts the fixture (the brand as a competitor, a competitor as own) stops the seed with a message: changing a role is a person's decision.
7. **Entities.** All nine are `entity_type: brand` (as the web mocks have them). Aliases are word aliases that ignore case (`AliasInput` defaults); the alias equal to the canonical name is left out, because the matcher matches an entity's canonical name without an alias (`matcher_rules` passes `canonical_name` to `EntityRule`; `_create_own_entity` does the same for a project's brand). Domains are `host` rules (the site and its www form). Darkwatch SOC is `is_ambiguous` with the hints `soc`, `security`, `mdr`. The brand gets the primary own role with `track_seo` and `track_ai`; each competitor the `competitor` role with `track_ai` on and **`track_seo` off**, so the seed cannot run into the 10 SEO competitor limit (`COMPETITOR_LIMIT`) and leaves the keyword pages' competitor lists alone (Open point 6).
8. **Topics.** One project vocabulary, kind `topic`, named `Security topics` (the mocks' name), hierarchical, not single-valued (a prompt has one or two topics). Parents are added with their fixture slug first, then children under them, so every term's slug is the fixture's (a `path` input would slugify the parent's name: `managed-soc-and-mdr`, not `managed-soc-mdr`). A found vocabulary that is flat or single-valued stops the seed.
9. **Engines.** `chatgpt_web` and `gemini_web` are put on with the active `Country` locations of IN, AE and SA through `put_engine`, the body of `EngineService.put` (runnable location check, upsert, `ensure_ai_schedule`, audit). An engine already on with exactly those locations is not put again (a put always writes an audit entry). The fixture's `model` (`gpt-6`, `3.5 Flash-Lite`) is not stored: the provider reports the model with each answer. Engines the fixture does not name (`google_ai_mode`) are left as they are; if a developer has one on without AE or SA, the prompts step stops with the API's `location_not_supported` message naming it.
10. **The schedules are paused in the transaction that made them.** `ensure_engines` opens one `workspace_transaction`, calls `put_engine` for each engine and then `pause_schedule` for every live, active `ai_prompt` schedule of the project, with the reason `dev seed: paused so nothing spends by itself`, before the transaction commits. So the two schedules that turning the first engine on makes never exist active in a committed state. This needs the bodies of `EngineService.put` and `ScheduleService.pause` as functions that take the caller's session; Task 4 lifts them out unchanged (the service methods call them) and the existing engine and schedule tests prove behaviour did not move. Every run pauses every active AI schedule of the project, so a schedule a developer resumed is paused again by the next seed (Open point 4). A run in the dev database would otherwise spend real money where DataForSEO credentials are set.
11. **Locations are never created by the seed.** It reads the active `Country` locations of IN, AE and SA and stops, naming the missing countries and the command that loads them, when any is absent or inactive. Loading them uses the existing safe path: `python -m idraft.worker.sync_locations` (DataForSEO's free list, or `--from-file`). Task 10 adds a three entry saved list (`BT/fixtures/dataforseo/locations-india-gulf.json`) for a machine without DataForSEO credentials, with a test that it reads as three countries.
12. **Quota.** 72 prompts of the base plan's 150 (`BASE_PLAN.max_prompts`, or `core.workspace_quotas.max_active_prompts`). Before its first write, the seed counts the prompts it would make or bring back against the quota and stops with `The workspace has U of L active prompts and the fixture needs N more. Nothing was written. ...` when they do not fit. `bulk_create` checks again under the workspace's prompt lock, all or none, so a prompt added meanwhile still cannot take the workspace past its limit (that refusal is reported as `The API refused a step: Workspace limit reached (quota_exceeded). ...`).
13. **Order of the steps.** Owner, countries, project lookup, quota preflight (everything a person must fix is checked before the first write), then project, entities (the brand's aliases exist before any prompt, so `is_branded` is computed from them: the fixture's 7 branded prompts come out branded), topics (term ids for the prompts), engines and pause (the prompts' country rule needs every enabled engine to run in their country), prompts.
14. **Not one transaction overall.** Each service opens its own transaction, as each route does. A step that fails leaves the earlier steps written; running the seed again completes them, since every step is idempotent. The only cross-step transaction is engines plus pause (Decision 10).
15. **No answers.** The seed makes no observation, run or task. `profile`, `sources`, `competitor_pages`, `phrases` and `model_change` are accepted by the loader as JSON and never read. Answers in dev come from a real run (Open point 1).
16. **The seed is reachable only from the CLI.** A new import-linter contract forbids every other package of `idraft` from importing `idraft.devseed`, so neither the API nor the worker can ever call it.
17. **Strict fixture loading.** Every model forbids unknown keys and runs in Pydantic strict mode (`"3"` is not an importance). Cross checks: unique entity keys, names and domains, unique engines, unique topic slugs across the tree, unique prompt keys and composed texts, every prompt topic known, every prompt's country run by every engine, `ambiguous` exactly when there are hints. Any failure is a `FixtureError` naming the places, and the CLI exits 1 before connecting.

## Open points (recommended default in bold, applied by this plan)

1. **There is no fake AI provider for development.** The worker registers a provider only with DataForSEO credentials (`production_registry` in `B/worker/assembly.py`); the fakes in `BT/worker/` and `BT/collectors/support.py` are test doubles, not wired into a dev worker. So the dev database has no answers until a real run. **Default: when answers are wanted, run ONE real bulk run** (72 prompts x 2 engines = 144 answers, about 0.17 USD at 0.0012 USD each, standard queue) with DataForSEO credentials and the dev object store in `.env.worker`, as the runbook says. A dev fake provider that answers from the fixture's profiles is a separate plan if the owner wants one.
2. **The workspace `digibranders` does not exist in the current dev database**, and the database is not migrated to 0018. **Default: migrate, then create `digibranders` in the app** (runbook steps 1 to 3). `--workspace connect-test` seeds the existing workspace instead (its `eventus-security` project is then completed in place, its keyword data untouched).
3. **The dev database has India only.** **Default: load the three countries with the saved list** (`sync_locations --from-file tests/fixtures/dataforseo/locations-india-gulf.json`), or DataForSEO's full free list where credentials are set. The saved list deactivates nothing in today's dev database (one active location, India, which the list has); in a database with 4 to 6 active locations, other countries could be deactivated, which the command prints and the full sync restores.
4. **Every run re-pauses resumed AI schedules.** **Default: keep it**: in dev nothing should spend by itself. Alternative: pause only the schedules made in that run.
5. **A tunnel defeats the host check.** **Accepted:** the runbook says never to point a local env file at a tunnel; facts 1 and 3 still hold for the server's own env files.
6. **Competitors are not tracked for SEO.** **Default: `track_seo: false`**, so the seed never meets the 10 competitor limit or changes keyword pages. Turn it on per competitor in the app if keyword views should show them.

## Names

Signatures are exact; later tasks use them.

**`idraft.devseed.fixture`** (Task 1): `DEFAULT_FIXTURE: Final[Path]`, `FixtureError(Exception)`, `ProjectPart`, `EntityPart`, `CompetitorPart(EntityPart)` (`ambiguous`, `disambiguation_hints`), `EnginePart` (`engine_code: EngineCode`, `countries: list[str]`, `model`), `TopicChild`, `TopicParent` (`children`), `PromptPart` (`key`, `text`, `country`, `intent`, `funnel_stage`, `prompt_type`, `importance`, `branded`, `topics`, `profile`), `EventusFixture`, `topic_paths(topics) -> dict[str, str]`, `load_fixture(path: Path) -> EventusFixture`.

**`idraft.devseed.guard`** (Task 2): `LOOPBACK: Final[frozenset[str]]`, `NotDevelopmentError(Exception)`, `check_development(settings: Settings) -> None`.

**`idraft.devseed.context`** (Task 3): `Sessions = async_sessionmaker[AsyncSession]`, `SEED_INFO: Final[RequestInfo]`, `SeedError(Exception)`, `seed_access(user_id, workspace_id) -> WorkspaceAccess`, `find_owner(sessions, workspace_slug) -> WorkspaceAccess`, `country_locations(sessions, countries) -> dict[str, int]`.

**`idraft.api.ai.engine_service`** (Task 4): `put_engine(db, access, project_id, engine_code, body, info) -> EngineView`. **`idraft.api.operations.schedules`** (Task 4): `pause_schedule(db, access, project_id, schedule_id, body, info) -> ScheduleRecord`.

**`idraft.devseed.project`** (Task 5): `EntityChanges(created, aliases_added, domains_added, updated, roles_given)`, `find_project(sessions, access, slug) -> UUID | None`, `ensure_project(sessions, access, part, location_id) -> tuple[UUID, bool]`, `ensure_entities(sessions, access, project_id, brand, competitors) -> EntityChanges`.

**`idraft.devseed.topics`** (Task 6): `VOCABULARY_NAME: Final = "Security topics"`, `ensure_topics(sessions, access, project_id, topics) -> tuple[dict[str, UUID], int]`.

**`idraft.devseed.engines`** (Task 7): `PAUSE_REASON: Final`, `EngineChanges(turned_on: tuple[EngineCode, ...], paused: int)`, `ensure_engines(sessions, access, project_id, engines, location_ids) -> EngineChanges`.

**`idraft.devseed.prompts`** (Task 8): `PromptChanges(created, updated, unchanged)`, `prompt_items(language_code, parts, term_ids) -> list[PromptCreate]`, `check_prompt_quota(sessions, access, project_id, language_code, parts) -> None`, `prompt_quota(sessions, access) -> tuple[int, int]`, `ensure_prompts(sessions, access, project_id, language_code, parts, term_ids) -> PromptChanges`.

**`idraft.devseed.run`** (Task 9): `SeedReport` (with `lines() -> list[str]`), `seed_eventus(sessions, fixture, workspace_slug) -> SeedReport`, `run_seed(settings, fixture, workspace_slug) -> SeedReport`. **`idraft.cli`**: subcommand `seed-eventus`, handler `_seed_eventus(arguments) -> int`.

**Tests** `BT/devseed/`: `conftest.py` (`sessions` fixture), `support.py` (`FIXTURE`, `COUNTRY_IDS`, `owner_workspace`, `gulf_locations`, `audit_count` in Task 3; `seeded_project` in Task 5; `world_counts` in Task 9).

## File map

| File | Task | What |
|---|---|---|
| `B/devseed/__init__.py` | 1 | Package docstring |
| `B/devseed/fixture.py` | 1 | Strict fixture models and loader |
| `BT/devseed/__init__.py`, `BT/devseed/test_fixture.py` | 1 | Loader tests (no database) |
| `B/devseed/guard.py`, `BT/devseed/test_guard.py` | 2 | Dev guard and its tests (no database) |
| `B/devseed/context.py`, `BT/devseed/conftest.py`, `BT/devseed/support.py`, `BT/devseed/test_context.py` | 3 | Owner, countries, errors |
| `B/api/ai/engine_service.py`, `B/api/operations/schedules.py`, `BT/devseed/test_one_transaction.py` | 4 | In-transaction put and pause |
| `B/devseed/project.py`, `BT/devseed/test_project.py` | 5 | Project, brand, competitors, roles |
| `B/devseed/topics.py`, `BT/devseed/test_topics.py` | 6 | Topic vocabulary and terms |
| `B/devseed/engines.py`, `BT/devseed/test_engines.py` | 7 | Engines on, schedules paused |
| `B/devseed/prompts.py`, `BT/devseed/test_prompts.py` | 8 | Quota preflight, prompts |
| `B/devseed/run.py`, `B/cli.py`, `backend/pyproject.toml`, `BT/devseed/test_run.py`, `BT/devseed/test_cli_seed.py` | 9 | Orchestration, the command, import contract |
| `docs/ops/dev-eventus-seed.md`, `BT/fixtures/dataforseo/locations-india-gulf.json`, `BT/devseed/test_locations_file.py`, `fixtures/ai-prompts/README.md` | 10 | Runbook, saved location list, pointer |

## Gates every task ends on

Run from `backend/` with the Colima variables set (one shell, so the `export` holds):

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend
uv run ruff check --fix . && uv run ruff format .
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # N files already formatted
uv run mypy                    # Success: no issues found in N source files
uv run lint-imports            # Contracts: N kept, 0 broken.
```

Targeted tests always take `--no-cov` (a partial run fails the coverage gate):

```bash
cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest <path> --no-cov -n 4 -q
```

`colima status` must say running; if not, `colima start --cpu 10 --memory 16`. Never restart Colima or stop `idraft-dev-*` containers: other sessions use them. Never run the seed itself against the dev database while implementing: the tests use Testcontainers only.

## Traps (every one applies)

1. **Files are pure ASCII.** No em or en dashes, curly quotes, arrows or `x` signs in code, comments, docstrings, test names or commit messages. Check before committing: `grep -nP '[^\x00-\x7F]' <files>` prints nothing.
2. **Edit with the file tools (Read, Edit, Write) only.** No shell heredocs, `sed -i` or replace scripts.
3. **Lines are at most 100 characters** (ruff `E501`); `ruff format` does not split long strings. Split a long message with implicit string concatenation, as the code below does.
4. **No `print`** (ruff `T20`): the CLI writes with `sys.stdout.write` and `sys.stderr.write`.
5. **mypy strict on tests too** (`files = ["src", "tests", "spikes"]`): every test function and helper is annotated.
6. **`pytest.mark.parametrize` names are a tuple** (`("label", "change", "expected")`, ruff `PT006`).
7. **`cli.main` calls `asyncio.run`.** A test that runs the CLI is a plain `def` test and prepares its data with `asyncio.run(...)`; an `async def` test cannot call it (a loop is already running).
8. **Locations are global** in each worker's test database. `gulf_locations` upserts the three rows; a test that deactivates one restores it in `finally`.
9. **The audit table is `ops.audit_logs`**, schedules are `ops.schedules`, runs `ops.collection_runs`, answers `ai.observations`. Tests read them as the superuser through `tests.api.auth.support.fetch` and `fetchrow`.
10. **Never stage another session's files.** Every commit below names its files. Commit messages carry no attribution lines and no dashes.

## Task 1: The fixture, read strictly

**Files:**
- Create: `backend/src/idraft/devseed/__init__.py`
- Create: `backend/src/idraft/devseed/fixture.py`
- Create: `backend/tests/devseed/__init__.py`
- Test: `backend/tests/devseed/test_fixture.py`

**Read first:** `fixtures/ai-prompts/README.md` (every key), `fixtures/ai-prompts/eventus-security.json` (look at `project`, `brand`, `competitors`, `engines`, `topics`, one prompt), `B/api/schemas/ai.py` lines 1 to 110 (`CountryIso`, `Importance`, `PromptType`, `PROMPT_TEXT_MAX`), `B/api/schemas/keywords.py` (`Intent`, `FunnelStage`), `B/ai/text.py` (`normalize`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/devseed/__init__.py` empty, then `backend/tests/devseed/test_fixture.py`:

```python
"""The fixture loader: the real file loads with its counts, and every malformed variant fails
loudly, naming the place."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from idraft.devseed.fixture import DEFAULT_FIXTURE, FixtureError, load_fixture, topic_paths
from idraft.domain.ai_engines import EngineCode

Change = Callable[[dict[str, Any]], object]


def _variant(tmp_path: Path, change: Change) -> Path:
    data = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    change(data)
    path = tmp_path / "fixture.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _gemini_without_the_emirates(data: dict[str, Any]) -> None:
    data["engines"][1]["countries"] = ["IN", "SA"]


def test_the_real_fixture_loads_with_its_counts() -> None:
    fixture = load_fixture(DEFAULT_FIXTURE)

    assert fixture.project.slug == "eventus-security"
    assert (fixture.project.timezone, fixture.project.default_country) == ("Asia/Kolkata", "IN")
    assert fixture.project.host == "eventussecurity.com"
    assert fixture.brand.name == "Eventus Security"
    assert len(fixture.competitors) == 8
    assert [part.key for part in fixture.competitors if part.ambiguous] == ["darkwatch"]
    assert {part.engine_code for part in fixture.engines} == {
        EngineCode.CHATGPT_WEB,
        EngineCode.GEMINI_WEB,
    }
    assert all(part.countries == ["IN", "AE", "SA"] for part in fixture.engines)
    assert len(fixture.topics) == 7
    assert sum(len(parent.children) for parent in fixture.topics) == 22
    assert len(topic_paths(fixture.topics)) == 29
    assert topic_paths(fixture.topics)["soc-monitoring"] == "managed-soc-mdr/soc-monitoring"
    assert len(fixture.prompts) == 72
    assert sum(part.branded for part in fixture.prompts) == 7


CASES: list[tuple[str, Change, str]] = [
    ("unknown top level key", lambda d: d.update(extra=1), "extra: Extra inputs are not permitted"),
    ("unknown prompt key", lambda d: d["prompts"][0].update(answer="x"), "prompts.0.answer"),
    ("missing prompt text", lambda d: d["prompts"][0].pop("text"), "prompts.0.text: Field required"),
    ("schema version", lambda d: d.update(schema_version=2), "schema_version"),
    ("importance as text", lambda d: d["prompts"][0].update(importance="3"), "prompts.0.importance"),
    ("importance too high", lambda d: d["prompts"][0].update(importance=6), "prompts.0.importance"),
    ("unknown intent", lambda d: d["prompts"][0].update(intent="guess"), "prompts.0.intent"),
    (
        "unknown topic",
        lambda d: d["prompts"][0].update(topics=["no-such-topic"]),
        "prompt p01 names unknown topics no-such-topic",
    ),
    (
        "repeated text",
        lambda d: d["prompts"][1].update(text=d["prompts"][0]["text"]),
        "repeated prompt text",
    ),
    ("country an engine lacks", _gemini_without_the_emirates, "which gemini_web does not run in"),
    (
        "ambiguous without hints",
        lambda d: d["competitors"][6].update(disambiguation_hints=[]),
        "competitors.6",
    ),
    (
        "repeated topic slug",
        lambda d: d["topics"][1]["children"][0].update(slug="soc-monitoring"),
        "repeated topic slug soc-monitoring",
    ),
    (
        "repeated domain",
        lambda d: d["competitors"][0].update(domains=["eventussecurity.com"]),
        "repeated entity domain eventussecurity.com",
    ),
]


@pytest.mark.parametrize(("label", "change", "expected"), CASES, ids=[case[0] for case in CASES])
def test_a_malformed_fixture_fails_naming_the_place(
    tmp_path: Path, label: str, change: Change, expected: str
) -> None:
    with pytest.raises(FixtureError) as caught:
        load_fixture(_variant(tmp_path, change))

    assert expected in str(caught.value), label


def test_text_that_is_not_json_fails(tmp_path: Path) -> None:
    path = tmp_path / "broken.json"
    path.write_text("{", encoding="utf-8")

    with pytest.raises(FixtureError, match="is not valid"):
        load_fixture(path)


def test_a_missing_file_fails(tmp_path: Path) -> None:
    with pytest.raises(FixtureError, match="could not be read"):
        load_fixture(tmp_path / "absent.json")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/devseed/test_fixture.py --no-cov -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'idraft.devseed'`.

- [ ] **Step 3: Write the package and the loader**

`backend/src/idraft/devseed/__init__.py`:

```python
"""Development data seeds, run by hand: `python -m idraft.cli seed-eventus`
(docs/ops/dev-eventus-seed.md). Nothing in the API or the worker imports this package; an import
contract in pyproject.toml says so."""
```

`backend/src/idraft/devseed/fixture.py`:

```python
"""The Eventus Security fixture (`fixtures/ai-prompts/eventus-security.json`), read strictly.

The seed uses the static parts only: the project, the brand and its competitors, the engines, the
topics and the prompts. The prompts' `profile` and the top-level `model_change`, `sources`,
`competitor_pages` and `phrases` exist to generate the web mocks' answers; they are accepted as
JSON and never read. Any other key, a missing key or a value of the wrong type fails the load
(`FixtureError`), so a changed fixture never seeds half of itself.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Annotated, Final, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    ValidationError,
    model_validator,
)

from idraft.ai.text import normalize
from idraft.api.schemas.ai import CountryIso, Importance, PromptType
from idraft.api.schemas.keywords import FunnelStage, Intent
from idraft.domain.ai_engines import PROMPT_TEXT_MAX, EngineCode

# backend/src/idraft/devseed/fixture.py: parents[4] is the repository root.
DEFAULT_FIXTURE: Final = (
    Path(__file__).resolve().parents[4] / "fixtures" / "ai-prompts" / "eventus-security.json"
)

Name = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Key = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9]*$", max_length=50)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=100)]
Host = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", max_length=253)
]
PromptKey = Annotated[str, StringConstraints(pattern=r"^p[0-9]{2}$")]
PromptText = Annotated[str, StringConstraints(min_length=1, max_length=PROMPT_TEXT_MAX)]


class FixtureError(Exception):
    """The fixture could not be read, or is not the shape the seed expects. The message names the
    places that are wrong."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ProjectPart(_Strict):
    name: Name
    slug: Slug
    host: Host
    language_code: Literal["en"]
    default_country: CountryIso
    timezone: Name


class EntityPart(_Strict):
    key: Key
    name: Name
    aliases: list[Name] = Field(min_length=1)
    domains: list[Host] = Field(min_length=1)


class CompetitorPart(EntityPart):
    ambiguous: bool = False
    disambiguation_hints: list[Name] = Field(default_factory=list)

    @model_validator(mode="after")
    def _hinted(self) -> Self:
        if self.ambiguous != bool(self.disambiguation_hints):
            raise ValueError("disambiguation_hints are given exactly when ambiguous is true")
        return self


class EnginePart(_Strict):
    engine_code: EngineCode
    countries: list[CountryIso] = Field(min_length=1)
    # The model the mocks report. Not seeded: a provider reports the model with each answer.
    model: Name


class TopicChild(_Strict):
    slug: Slug
    name: Name


class TopicParent(_Strict):
    slug: Slug
    name: Name
    children: list[TopicChild] = Field(min_length=1)


class PromptPart(_Strict):
    key: PromptKey
    text: PromptText
    country: CountryIso
    intent: Intent
    funnel_stage: FunnelStage
    prompt_type: PromptType
    importance: Importance
    branded: bool
    topics: list[Slug] = Field(min_length=1, max_length=2)
    # Drives the mocks' answers only; never read by the seed.
    profile: dict[str, JsonValue]


def _repeats(what: str, values: Iterable[str]) -> list[str]:
    return [
        f"repeated {what} {value}"
        for value, count in sorted(Counter(values).items())
        if count > 1
    ]


def topic_paths(topics: Sequence[TopicParent]) -> dict[str, str]:
    """Each topic's slug and its path in the vocabulary: `parent` or `parent/child`."""
    paths = {parent.slug: parent.slug for parent in topics}
    paths.update(
        {
            child.slug: f"{parent.slug}/{child.slug}"
            for parent in topics
            for child in parent.children
        }
    )
    return paths


class EventusFixture(_Strict):
    schema_version: Literal[1]
    note: str
    project: ProjectPart
    brand: EntityPart
    competitors: list[CompetitorPart] = Field(min_length=1)
    engines: list[EnginePart] = Field(min_length=1)
    topics: list[TopicParent] = Field(min_length=1)
    prompts: list[PromptPart] = Field(min_length=1)
    # These make the mocks' answers and are never seeded.
    model_change: JsonValue = None
    sources: JsonValue = None
    competitor_pages: JsonValue = None
    phrases: JsonValue = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        entities = [self.brand, *self.competitors]
        slugs = [parent.slug for parent in self.topics] + [
            child.slug for parent in self.topics for child in parent.children
        ]
        problems = [
            *_repeats("entity key", (entity.key for entity in entities)),
            *_repeats("entity name", (entity.name.casefold() for entity in entities)),
            *_repeats("entity domain", (host for entity in entities for host in entity.domains)),
            *_repeats("engine", (engine.engine_code.value for engine in self.engines)),
            *_repeats("topic slug", slugs),
            *_repeats("prompt key", (prompt.key for prompt in self.prompts)),
            *_repeats("prompt text", (normalize(prompt.text) for prompt in self.prompts)),
        ]
        known = set(slugs)
        for prompt in self.prompts:
            unknown = sorted(set(prompt.topics) - known)
            if unknown:
                problems.append(f"prompt {prompt.key} names unknown topics {', '.join(unknown)}")
            for engine in self.engines:
                if prompt.country not in engine.countries:
                    problems.append(
                        f"prompt {prompt.key} is in {prompt.country}, which "
                        f"{engine.engine_code.value} does not run in"
                    )
        if problems:
            raise ValueError("; ".join(problems))
        return self


def load_fixture(path: Path) -> EventusFixture:
    """The fixture at `path`, validated. Raises `FixtureError`."""
    try:
        content = path.read_bytes()
    except OSError as error:
        reason = error.strerror or type(error).__name__
        raise FixtureError(f"The fixture {path} could not be read ({reason}).") from None
    try:
        return EventusFixture.model_validate_json(content)
    except ValidationError as error:
        places = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'fixture'}: {item['msg']}"
            for item in error.errors(include_input=False, include_url=False)
        )
        raise FixtureError(f"The fixture {path} is not valid: {places}") from None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/devseed/test_fixture.py --no-cov -q`
Expected: PASS, 16 passed.

- [ ] **Step 5: Prove it bites**

Delete the three lines starting `unknown = sorted(set(prompt.topics) - known)` up to the `problems.append(...)` for unknown topics. Run the same command: `test_a_malformed_fixture_fails_naming_the_place[unknown topic]` fails. Then change `strict=True` to `strict=False` in `_Strict`: `[importance as text]` fails. Restore both and rerun: 16 passed.

- [ ] **Step 6: Gates and commit**

Run the gates. Then:

```bash
git add backend/src/idraft/devseed/__init__.py backend/src/idraft/devseed/fixture.py backend/tests/devseed/__init__.py backend/tests/devseed/test_fixture.py
git commit -m "Dev seed: read the Eventus Security fixture strictly"
```

## Task 2: The dev guard

**Files:**
- Create: `backend/src/idraft/devseed/guard.py`
- Test: `backend/tests/devseed/test_guard.py`

**Read first:** `B/config/settings.py` (`Settings.app_env`, `sqlalchemy_url`, `_validate_database_url`, the model validators that need `https` in production), `infra/vps/provision.sh` lines 95 to 135 (the server's env files), `backend/.env.example`, `infra/compose/docker-compose.dev.yml` (`127.0.0.1:54329`).

- [ ] **Step 1: Write the failing test**

`backend/tests/devseed/test_guard.py`:

```python
"""The seed refuses every environment that is not a developer's machine: production, the test
suite, a database elsewhere, an origin elsewhere, and the server's own settings."""

from __future__ import annotations

from typing import Literal

import pytest
from pydantic import SecretStr

from idraft.config.settings import Settings
from idraft.devseed.guard import NotDevelopmentError, check_development

PASSWORD = "api-dev-password"


def _settings(
    *,
    app_env: Literal["local", "test", "production"] = "local",
    database_host: str = "127.0.0.1",
    app_origin: str = "http://localhost:3000",
) -> Settings:
    return Settings(
        process_role="cli",
        app_env=app_env,
        app_origin=app_origin,
        database_url=SecretStr(f"postgresql://app_api:{PASSWORD}@{database_host}:54329/idraft"),
        redis_url=SecretStr("redis://127.0.0.1:63799/0"),
    )


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
@pytest.mark.parametrize("origin", ["http://localhost:3000", "http://127.0.0.1:3000"])
def test_a_developer_machine_passes(host: str, origin: str) -> None:
    check_development(_settings(database_host=host, app_origin=origin))


def test_production_is_refused_even_on_this_machine() -> None:
    with pytest.raises(NotDevelopmentError, match="APP_ENV is production"):
        check_development(_settings(app_env="production", app_origin="https://localhost"))


def test_the_test_environment_is_refused() -> None:
    with pytest.raises(NotDevelopmentError, match="APP_ENV is test"):
        check_development(_settings(app_env="test"))


@pytest.mark.parametrize(
    "host",
    ["db.internal", "201.18.204.36", "postgres", "localhost.example.com", "10.0.0.5"],
)
def test_a_database_elsewhere_is_refused(host: str) -> None:
    with pytest.raises(NotDevelopmentError, match="DATABASE_URL") as caught:
        check_development(_settings(database_host=host))

    assert PASSWORD not in str(caught.value)


def test_an_origin_elsewhere_is_refused() -> None:
    with pytest.raises(NotDevelopmentError, match="APP_ORIGIN"):
        check_development(_settings(app_origin="https://app.idraft.ai"))


def test_the_servers_own_settings_are_refused() -> None:
    """What infra/vps/provision.sh writes: production, the public origin, and a database on the
    server's own loopback."""
    with pytest.raises(NotDevelopmentError):
        check_development(
            _settings(
                app_env="production", database_host="127.0.0.1", app_origin="https://app.idraft.ai"
            )
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/devseed/test_guard.py --no-cov -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'idraft.devseed.guard'`.

- [ ] **Step 3: Write the guard**

`backend/src/idraft/devseed/guard.py`:

```python
"""The seed writes into whatever database DATABASE_URL names, so it first proves it is on a
developer's machine. Three facts, each enough to refuse:

1. `APP_ENV` is `local`. The server's env files say `production` (infra/vps/provision.sh) and the
   test suite's settings say `test`.
2. The database host is this machine's loopback: `localhost`, `127.0.0.1` or `::1`. The dev stack
   publishes PostgreSQL on 127.0.0.1:54329 (infra/compose/docker-compose.dev.yml). A compose
   service name such as `postgres` is not accepted: production's compose file would use it.
3. `APP_ORIGIN` is on this machine too. The server's is https://app.idraft.ai.

The server's own database is on its own loopback, so (2) alone would not keep the seed off it when
run there; (1) and (3) do, and `APP_ENV` defaults to `local`, so (3) also covers an env file that
lost its `APP_ENV`. A tunnel that brings another database to a local port passes (2): the seed
cannot see through one, so never point a local env file at a tunnel.
"""

from __future__ import annotations

from typing import Final
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url

from idraft.config.settings import Settings

LOOPBACK: Final = frozenset({"localhost", "127.0.0.1", "::1"})


class NotDevelopmentError(Exception):
    """The settings do not describe a developer's machine. The message says which fact failed
    and never quotes the connection string."""


def _on_this_machine(host: str | None) -> bool:
    return (host or "").strip("[]").lower() in LOOPBACK


def check_development(settings: Settings) -> None:
    if settings.app_env != "local":
        raise NotDevelopmentError(
            f"APP_ENV is {settings.app_env}; the seed runs only where it is local."
        )
    if not _on_this_machine(make_url(settings.sqlalchemy_url).host):
        raise NotDevelopmentError(
            "DATABASE_URL names a database that is not on this machine "
            "(localhost, 127.0.0.1 or ::1)."
        )
    if not _on_this_machine(urlsplit(settings.app_origin).hostname):
        raise NotDevelopmentError(
            "APP_ORIGIN is not on this machine (localhost, 127.0.0.1 or ::1)."
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/devseed/test_guard.py --no-cov -q`
Expected: PASS, 15 passed.

- [ ] **Step 5: Prove it bites**

Replace the body of `check_development` with `return`: the five refusal tests fail. Restore it, then delete only the `APP_ENV` check: `test_production_is_refused_even_on_this_machine` and `test_the_test_environment_is_refused` fail. Restore it, then delete only the database check: `test_a_database_elsewhere_is_refused` fails for every host. Restore and rerun: 15 passed.

- [ ] **Step 6: Gates and commit**

```bash
git add backend/src/idraft/devseed/guard.py backend/tests/devseed/test_guard.py
git commit -m "Dev seed: refuse to run anywhere but a developer machine"
```

## Task 3: Who the seed acts as, and where prompts may run

**Files:**
- Create: `backend/src/idraft/devseed/context.py`
- Create: `backend/tests/devseed/conftest.py`
- Create: `backend/tests/devseed/support.py`
- Test: `backend/tests/devseed/test_context.py`

**Read first:** `B/api/workspaces/access.py` (`WorkspaceAccess`), `B/api/workspaces/dependencies.py` lines 60 to 120 (how a request's access is built), `B/api/auth/sessions.py` (`SessionContext`), `B/db/engine.py` (`workspace_transaction`, `user_transaction`), `B/db/migrations/versions/0003_identity_and_tenancy.py` lines 200 to 295 (the membership and workspace policies; `auth.users` has none), `B/db/tables.py` (`users`, `workspaces`, `memberships`, `locations`), `BT/api/auth/support.py` (`make_user`, `make_workspace`, `add_member`, `execute`, `fetchrow`), `BT/conftest.py` (`migrated`, `app_settings`).

- [ ] **Step 1: Write the test fixtures and helpers**

`backend/tests/devseed/conftest.py`:

```python
"""Sessions as the API's role on the migrated test database: the role the seed connects as."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.devseed.context import Sessions


@pytest.fixture
async def sessions(app_settings: Settings) -> AsyncIterator[Sessions]:
    engine = create_engine(app_settings)
    try:
        yield create_session_factory(engine)
    finally:
        await engine.dispose()
```

`backend/tests/devseed/support.py`:

```python
"""Helpers of the dev seed tests: an owner and their workspace, the fixture's three countries and
an audit count."""

from __future__ import annotations

from typing import Final

from idraft.devseed.fixture import DEFAULT_FIXTURE, load_fixture
from tests.api.auth.support import (
    User,
    Workspace,
    add_member,
    execute,
    fetchrow,
    make_user,
    make_workspace,
)
from tests.conftest import PostgresServer

FIXTURE: Final = load_fixture(DEFAULT_FIXTURE)
# Google Ads geo target ids, which are the location ids (docs/04 section 5.2).
COUNTRY_IDS: Final = {"IN": 2356, "AE": 2784, "SA": 2682}


async def owner_workspace(pg: PostgresServer) -> tuple[User, Workspace]:
    user = await make_user(pg)
    workspace = await make_workspace(pg, name="Digibranders")
    await add_member(pg, workspace, user, "owner")
    return user, workspace


async def gulf_locations(pg: PostgresServer) -> None:
    """India, the UAE and Saudi Arabia as active countries. Locations are global, so a row an
    earlier test changed is set back."""
    await execute(
        pg,
        "INSERT INTO core.locations (id, name, country_iso, location_type) VALUES "
        "(2356, 'India', 'IN', 'Country'), (2784, 'United Arab Emirates', 'AE', 'Country'), "
        "(2682, 'Saudi Arabia', 'SA', 'Country') ON CONFLICT (id) DO UPDATE SET "
        "is_active = true, country_iso = excluded.country_iso, "
        "location_type = excluded.location_type",
    )


async def audit_count(pg: PostgresServer, workspace: Workspace) -> int:
    row = await fetchrow(
        pg, "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    return int(row["n"])
```

- [ ] **Step 2: Write the failing test**

`backend/tests/devseed/test_context.py`:

```python
"""The seed's actor is an active owner of the named workspace, found as the API role finds
memberships; the three countries must be active locations."""

from __future__ import annotations

import pytest

from idraft.api.permissions import Role
from idraft.devseed.context import Sessions, SeedError, country_locations, find_owner
from tests.api.auth.support import add_member, execute, make_user
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, gulf_locations, owner_workspace


async def test_the_owner_is_found_by_the_workspace_slug(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    admin = await make_user(migrated)
    await add_member(migrated, workspace, admin, "admin")

    access = await find_owner(sessions, workspace.slug)

    assert (access.user_id, access.workspace_id) == (user.id, workspace.id)
    assert (access.role, access.project_ids) == (Role.OWNER, None)


async def test_a_disabled_owner_is_passed_over(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    disabled = await make_user(migrated, disabled=True)
    await add_member(migrated, workspace, disabled, "owner")

    assert (await find_owner(sessions, workspace.slug)).user_id == user.id


async def test_a_missing_or_suspended_workspace_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    with pytest.raises(SeedError, match="No active workspace 'no-such-workspace'"):
        await find_owner(sessions, "no-such-workspace")

    _, workspace = await owner_workspace(migrated)
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1", workspace.id
    )
    with pytest.raises(SeedError, match=workspace.slug):
        await find_owner(sessions, workspace.slug)


async def test_the_three_countries_are_found(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    await gulf_locations(migrated)

    assert await country_locations(sessions, ["SA", "IN", "AE"]) == COUNTRY_IDS


async def test_a_missing_or_inactive_country_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    await gulf_locations(migrated)
    await execute(migrated, "UPDATE core.locations SET is_active = false WHERE id = 2682")
    try:
        with pytest.raises(SeedError, match="SA") as caught:
            await country_locations(sessions, ["IN", "AE", "SA"])
        assert "sync_locations" in str(caught.value)
    finally:
        await gulf_locations(migrated)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_context.py --no-cov -n 4 -q`
Expected: FAIL (collection error) with `ModuleNotFoundError: No module named 'idraft.devseed.context'`.

- [ ] **Step 4: Write the context module**

`backend/src/idraft/devseed/context.py`:

```python
"""What every step of the seed needs: who it acts as, where prompts may run, and its error.

The seed acts as an existing owner of the workspace, through the services the routes use, so its
permissions are the owner's and every write is audited with that owner as the actor and
`SEED_INFO`'s user agent. It never creates a user or a workspace: a development database gets both
from the app (docs/ops/dev-eventus-seed.md).
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.auth.sessions import SessionContext
from idraft.api.permissions import Role
from idraft.api.request_info import RequestInfo
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import user_transaction
from idraft.db.tables import locations, memberships, users, workspaces
from idraft.domain.ai_engines import COUNTRY

Sessions = async_sessionmaker[AsyncSession]

SEED_INFO: Final = RequestInfo(
    ip=None, user_agent="python -m idraft.cli seed-eventus", request_id=None
)


class SeedError(Exception):
    """The seed stopped. The message says why and what to do; the CLI prints it as it is."""


def seed_access(user_id: UUID, workspace_id: UUID) -> WorkspaceAccess:
    """An owner's access to the whole workspace, as `workspace_member` builds one for a request.
    The session is not stored anywhere: the services read only the user and the workspace."""
    now = datetime.now(UTC)
    return WorkspaceAccess(
        session=SessionContext(
            session_id=uuid.uuid4(),
            user_id=user_id,
            state="active",
            fresh_until=None,
            idle_expires_at=now + timedelta(hours=1),
            absolute_expires_at=now + timedelta(hours=1),
            last_seen_at=now,
        ),
        workspace_id=workspace_id,
        role=Role.OWNER,
        project_ids=None,
    )


async def find_owner(sessions: Sessions, workspace_slug: str) -> WorkspaceAccess:
    """The most recently created active user who owns the active workspace with this slug.

    The API role sees a membership only as its own user (row-level security), and `auth.users`
    has no row policy, so each active user is asked in turn, newest first.
    shortcut: one query per user, fine for a development database; a seed for a large one would
    take the owner's email instead.
    """
    async with sessions() as db, db.begin():
        user_ids: list[UUID] = list(
            (
                await db.execute(
                    select(users.c.id)
                    .where(users.c.disabled_at.is_(None))
                    .order_by(users.c.created_at.desc(), users.c.id.desc())
                )
            ).scalars()
        )
    owned = (
        select(memberships.c.workspace_id)
        .join(workspaces, workspaces.c.id == memberships.c.workspace_id)
        .where(
            workspaces.c.slug == workspace_slug,
            workspaces.c.status == "active",
            memberships.c.role == Role.OWNER.value,
        )
    )
    for user_id in user_ids:
        async with user_transaction(sessions, user_id) as db:
            workspace_id = (
                await db.execute(owned.where(memberships.c.user_id == user_id))
            ).scalar_one_or_none()
        if workspace_id is not None:
            return seed_access(user_id, workspace_id)
    raise SeedError(
        f"No active workspace {workspace_slug!r} with an active owner was found. Sign in to the "
        "app at APP_ORIGIN and create it, or name another with --workspace."
    )


async def country_locations(sessions: Sessions, countries: Collection[str]) -> dict[str, int]:
    """The active country location of each of these countries, by ISO code."""
    wanted = sorted(set(countries))
    async with sessions() as db, db.begin():
        rows = await db.execute(
            select(locations.c.country_iso, func.min(locations.c.id))
            .where(
                locations.c.location_type == COUNTRY,
                locations.c.is_active,
                locations.c.country_iso.in_(wanted),
            )
            .group_by(locations.c.country_iso)
        )
        found = {str(row[0]): int(row[1]) for row in rows}
    missing = [country for country in wanted if country not in found]
    if missing:
        raise SeedError(
            f"core.locations has no active country location for {', '.join(missing)}. Load "
            "them first with python -m idraft.worker.sync_locations "
            "(docs/ops/dev-eventus-seed.md, step 4). Nothing was written."
        )
    return found
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_context.py --no-cov -n 4 -q`
Expected: PASS, 5 passed.

- [ ] **Step 6: Prove it bites**

Remove `memberships.c.role == Role.OWNER.value,` from `owned`: still passes for the owner test only if the admin is not newer; it is (made after the owner), so `test_the_owner_is_found_by_the_workspace_slug` fails with the admin's id. Remove `locations.c.is_active,`: `test_a_missing_or_inactive_country_stops_the_seed` fails. Restore both; 5 passed.

- [ ] **Step 7: Gates and commit**

```bash
git add backend/src/idraft/devseed/context.py backend/tests/devseed/conftest.py backend/tests/devseed/support.py backend/tests/devseed/test_context.py
git commit -m "Dev seed: act as the workspace owner and find the three countries"
```

## Task 4: Turning an engine on and pausing a schedule inside the caller's transaction

**Files:**
- Modify: `backend/src/idraft/api/ai/engine_service.py` (the `put` method, and a new module function above `class EngineService`)
- Modify: `backend/src/idraft/api/operations/schedules.py` (the `pause` method, and a new module function at the end of the file)
- Test: `backend/tests/devseed/test_one_transaction.py`

**Read first:** `B/api/ai/engine_service.py` (whole file), `B/api/operations/schedules.py` lines 240 to 270 (`_transaction`, `_project`, `_found`) and 500 to 535 (`pause`), `B/ai/schedule.py` (`ensure_ai_schedule`), `BT/api/ai/test_engines.py` (`test_turning_the_first_engine_on_starts_two_runs_a_week`), `BT/api/ai/support.py` (`ai_project`).

This is a pure move: the bodies are unchanged, the service methods call the new functions in their own transaction, and the existing engine and schedule tests are the proof.

- [ ] **Step 1: Write the failing test**

`backend/tests/devseed/test_one_transaction.py`:

```python
"""`put_engine` and `pause_schedule` run in the caller's transaction: what they write commits or
rolls back with it, so the schedules an engine makes can be paused before they ever commit."""

from __future__ import annotations

import pytest

from idraft.api.ai.engine_service import put_engine
from idraft.api.operations import schedules_repository
from idraft.api.operations.schedules import pause_schedule
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.schemas.operations import SchedulePause
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, Sessions, seed_access
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import ai_project
from tests.api.auth.support import fetch
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, gulf_locations, owner_workspace


class _Rollback(Exception):
    pass


async def test_what_they_write_rolls_back_with_the_callers_transaction(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)
    access = seed_access(user.id, workspace.id)

    with pytest.raises(_Rollback):
        async with workspace_transaction(sessions, workspace.id, user_id=user.id) as db:
            await put_engine(
                db,
                access,
                project_id,
                EngineCode.CHATGPT_WEB,
                EngineUpdate(location_ids=[COUNTRY_IDS["IN"]]),
                SEED_INFO,
            )
            made, _ = await schedules_repository.list_schedules(
                db, workspace.id, project_id, workload="ai_prompt", is_active=True, offset=0, limit=10
            )
            assert len(made) == 2
            for schedule in made:
                await pause_schedule(
                    db, access, project_id, schedule.id, SchedulePause(reason="test"), SEED_INFO
                )
            raise _Rollback

    assert await fetch(
        migrated, "SELECT 1 FROM ai.project_engines WHERE project_id = $1", project_id
    ) == []
    assert await fetch(migrated, "SELECT 1 FROM ops.schedules WHERE project_id = $1", project_id) == []


async def test_committed_together_the_schedules_are_never_active(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)
    access = seed_access(user.id, workspace.id)

    async with workspace_transaction(sessions, workspace.id, user_id=user.id) as db:
        await put_engine(
            db,
            access,
            project_id,
            EngineCode.CHATGPT_WEB,
            EngineUpdate(location_ids=[COUNTRY_IDS["IN"]]),
            SEED_INFO,
        )
        made, _ = await schedules_repository.list_schedules(
            db, workspace.id, project_id, workload="ai_prompt", is_active=True, offset=0, limit=10
        )
        for schedule in made:
            await pause_schedule(
                db, access, project_id, schedule.id, SchedulePause(reason="test"), SEED_INFO
            )

    rows = await fetch(
        migrated, "SELECT is_active FROM ops.schedules WHERE project_id = $1", project_id
    )
    assert [row["is_active"] for row in rows] == [False, False]
    actions = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in actions] == [
        "project_engine.updated",
        "schedule.paused",
        "schedule.paused",
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_one_transaction.py --no-cov -n 4 -q`
Expected: FAIL with `ImportError: cannot import name 'put_engine' from 'idraft.api.ai.engine_service'`.

- [ ] **Step 3: Lift the body of `EngineService.put` into `put_engine`**

In `backend/src/idraft/api/ai/engine_service.py`, insert this function right after `_views` and before `class EngineService:`:

```python
async def put_engine(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    engine_code: EngineCode,
    body: EngineUpdate,
    info: RequestInfo,
) -> EngineView:
    """`EngineService.put` in the caller's transaction, so the caller can do more in it before
    anything commits (the dev seed pauses the schedules this makes: idraft.devseed.engines)."""
    engine = ENGINES[engine_code]
    location_ids = sorted(set(body.location_ids))
    await live_project(db, access, project_id, lock=True)
    runnable = await repository.runnable_locations(db, engine, location_ids)
    if set(location_ids) - runnable:
        raise invalid_field(
            "location_ids",
            code="location_not_supported",
            message=f"{engine.label} runs in active countries only.",
        )
    before = await repository.get_project_engine(db, access.workspace_id, project_id, engine_code)
    await repository.save_project_engine(
        db,
        workspace_id=access.workspace_id,
        project_id=project_id,
        engine_code=engine_code,
        location_ids=location_ids,
        is_enabled=body.is_enabled,
    )
    # Only when the engine goes from off to on: saving the countries of an engine that is
    # already on must not bring back schedules a person deleted.
    if body.is_enabled and (before is None or not before.is_enabled):
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
```

Then replace the whole `put` method of `EngineService` (from `    async def put(` to its `        return view`) with:

```python
    async def put(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        engine_code: EngineCode,
        body: EngineUpdate,
        info: RequestInfo,
    ) -> EngineView:
        async with self._transaction(access) as db:
            return await put_engine(db, access, project_id, engine_code, body, info)
```

- [ ] **Step 4: Lift the body of `ScheduleService.pause` into `pause_schedule`**

In `backend/src/idraft/api/operations/schedules.py`, replace the whole `pause` method of `ScheduleService` (from `    async def pause(` to its `        return paused`) with:

```python
    async def pause(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        schedule_id: UUID,
        body: SchedulePause,
        info: RequestInfo,
    ) -> ScheduleRecord:
        """Not planned until resumed. Pausing a paused schedule changes nothing."""
        async with self._transaction(access) as db:
            return await pause_schedule(db, access, project_id, schedule_id, body, info)
```

and append at the end of the file (after the class):

```python
async def pause_schedule(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    schedule_id: UUID,
    body: SchedulePause,
    info: RequestInfo,
) -> ScheduleRecord:
    """`ScheduleService.pause` in the caller's transaction (the dev seed pauses the AI schedules
    in the transaction that made them). Pausing a paused schedule changes nothing."""
    current = await ScheduleService._found(db, access, project_id, schedule_id)
    if not current.is_active:
        return current
    paused = await repository.update_schedule(
        db, access.workspace_id, schedule_id, {"is_active": False}
    )
    await audit.record(
        db,
        workspace_id=access.workspace_id,
        actor_id=access.user_id,
        action="schedule.paused",
        target_type="schedule",
        target_id=schedule_id,
        info=info,
        before={"is_active": True},
        after={"is_active": False, "reason": body.reason},
    )
    return paused
```

- [ ] **Step 5: Run the new and the existing tests**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_one_transaction.py tests/api/ai/test_engines.py tests/api/operations/test_schedules.py --no-cov -n 4 -q`
Expected: PASS, every test.

- [ ] **Step 6: Prove it bites**

In `put_engine`, delete the `if body.is_enabled and ...: await ensure_ai_schedule(...)` block: `test_committed_together_the_schedules_are_never_active` fails (no schedules) and `tests/api/ai/test_engines.py::test_turning_the_first_engine_on_starts_two_runs_a_week` fails. Restore it. In `pause_schedule`, delete the `audit.record(...)` call: the committed test fails on the audit actions. Restore; all pass.

- [ ] **Step 7: Gates and commit**

```bash
git add backend/src/idraft/api/ai/engine_service.py backend/src/idraft/api/operations/schedules.py backend/tests/devseed/test_one_transaction.py
git commit -m "Engines and schedules: put an engine and pause a schedule in the caller's transaction"
```

## Task 5: The project, the brand and the competitors

**Files:**
- Create: `backend/src/idraft/devseed/project.py`
- Modify: `backend/tests/devseed/support.py` (add `seeded_project`)
- Test: `backend/tests/devseed/test_project.py`

**Read first:** `B/api/projects/service.py` (`create`, `update`: writes nothing when equal), `B/api/projects/routes.py` lines 170 to 225, `B/api/entities/service.py` (`create`, `update`, `add_aliases`, `add_domain`, `stored_host`, `EntityRow`), `B/api/entities/project_service.py` (`add`, `matcher_rules`), `B/api/entities/repository.py` (`get_entity`, `aliases_of`, `domains_of`), `B/api/entities/project_repository.py` (`get_role`, `RoleRow`), `B/api/schemas/entities.py` (`AliasInput`, `DomainInput`, `ProjectEntityCreate`), `B/extraction/domains.py` (`ProjectRole`).

- [ ] **Step 1: Add the project helper to the test support**

Append to `backend/tests/devseed/support.py` (and add the imports at the top: `import uuid`, `from idraft.api.workspaces.access import WorkspaceAccess`, `from idraft.devseed.context import Sessions, seed_access`, `from idraft.devseed.project import ensure_project`):

```python
async def seeded_project(
    pg: PostgresServer, sessions: Sessions
) -> tuple[WorkspaceAccess, Workspace, uuid.UUID]:
    """An owner, their workspace, the three countries and the fixture's project."""
    user, workspace = await owner_workspace(pg)
    await gulf_locations(pg)
    access = seed_access(user.id, workspace.id)
    project_id, _ = await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])
    return access, workspace, project_id
```

- [ ] **Step 2: Write the failing test**

`backend/tests/devseed/test_project.py`:

```python
"""The project is made once by slug and kept in line; the brand and the competitors are made or
completed by name, with their roles, and a second run writes nothing."""

from __future__ import annotations

import pytest

from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService
from idraft.api.schemas.entities import AliasInput
from idraft.devseed.context import SEED_INFO, Sessions, SeedError, seed_access
from idraft.devseed.project import EntityChanges, ensure_entities, ensure_project
from tests.api.auth.support import execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import (
    COUNTRY_IDS,
    FIXTURE,
    audit_count,
    gulf_locations,
    owner_workspace,
    seeded_project,
)

_PROJECT = (
    "SELECT p.name, p.slug, p.timezone, p.default_language_code, p.default_location_id, d.host "
    "FROM core.projects p JOIN core.domains d ON d.id = p.primary_domain_id WHERE p.id = $1"
)
_EXPECTED = ("Eventus Security", "eventus-security", "Asia/Kolkata", "en", 2356, "eventussecurity.com")


async def test_the_project_is_made_once_with_the_fixtures_settings(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    access = seed_access(user.id, workspace.id)

    project_id, created = await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])

    assert created
    assert tuple(await fetchrow(migrated, _PROJECT, project_id)) == _EXPECTED
    before = await audit_count(migrated, workspace)
    assert await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"]) == (
        project_id,
        False,
    )
    assert await audit_count(migrated, workspace) == before


async def test_a_project_that_drifted_is_brought_back_in_line(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await execute(
        migrated,
        "UPDATE core.projects SET name = 'Old name', timezone = 'UTC' WHERE id = $1",
        project_id,
    )
    before = await audit_count(migrated, workspace)

    await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])

    assert tuple(await fetchrow(migrated, _PROJECT, project_id)) == _EXPECTED
    assert await audit_count(migrated, workspace) == before + 1


async def test_an_archived_project_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    await execute(migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", project_id)

    with pytest.raises(SeedError, match="is archived"):
        await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])


async def test_the_brand_and_competitors_are_made_with_their_roles(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)

    changes = await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)

    assert changes == EntityChanges(
        created=9, aliases_added=0, domains_added=0, updated=0, roles_given=9
    )
    roles = await fetch(
        migrated,
        "SELECT e.canonical_name, pe.role, pe.is_primary, pe.track_seo, pe.track_ai "
        "FROM core.project_entities pe JOIN core.entities e ON e.id = pe.entity_id "
        "WHERE pe.project_id = $1 AND pe.removed_at IS NULL "
        "ORDER BY pe.role DESC, e.canonical_name",
        project_id,
    )
    assert tuple(roles[0]) == ("Eventus Security", "own", True, True, True)
    assert [tuple(row)[1:] for row in roles[1:]] == [("competitor", False, False, True)] * 8
    aliases = await fetch(
        migrated,
        "SELECT a.alias FROM core.entity_aliases a JOIN core.entities e ON e.id = a.entity_id "
        "WHERE e.workspace_id = $1 AND e.canonical_name = 'Eventus Security'",
        workspace.id,
    )
    assert {row["alias"] for row in aliases} == {"Eventus", "Eventus Security Solutions"}
    darkwatch = await fetchrow(
        migrated,
        "SELECT is_ambiguous, disambiguation_hints FROM core.entities "
        "WHERE workspace_id = $1 AND canonical_name = 'Darkwatch SOC'",
        workspace.id,
    )
    assert tuple(darkwatch) == (True, ["soc", "security", "mdr"])
    hosts = await fetch(
        migrated,
        "SELECT d.host FROM core.entity_domains ed JOIN core.domains d ON d.id = ed.domain_id "
        "WHERE ed.workspace_id = $1",
        workspace.id,
    )
    assert {row["host"] for row in hosts} == {
        host for part in [FIXTURE.brand, *FIXTURE.competitors] for host in part.domains
    }

    before = await audit_count(migrated, workspace)
    again = await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
    assert again == EntityChanges(created=0, aliases_added=0, domains_added=0, updated=0, roles_given=0)
    assert await audit_count(migrated, workspace) == before


async def test_an_entity_the_workspace_has_is_completed_not_duplicated(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await EntityService(sessions=sessions).create(
        access,
        entity_type="brand",
        canonical_name="eventus security",
        parent_entity_id=None,
        description=None,
        is_ambiguous=False,
        disambiguation_hints=[],
        aliases=[AliasInput(alias="Eventus")],
        domains=[],
        info=SEED_INFO,
    )

    changes = await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)

    assert (changes.created, changes.aliases_added, changes.domains_added) == (8, 1, 1)
    assert changes.roles_given == 9
    named = await fetch(
        migrated,
        "SELECT canonical_name FROM core.entities "
        "WHERE workspace_id = $1 AND lower(canonical_name) = 'eventus security'",
        workspace.id,
    )
    assert [row["canonical_name"] for row in named] == ["eventus security"]


async def test_a_brand_with_another_role_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    row = await EntityService(sessions=sessions).create(
        access,
        entity_type="brand",
        canonical_name="Eventus Security",
        parent_entity_id=None,
        description=None,
        is_ambiguous=False,
        disambiguation_hints=[],
        aliases=[],
        domains=[],
        info=SEED_INFO,
    )
    await ProjectEntityService(sessions=sessions).add(
        access,
        project_id,
        entity_id=row.entity.id,
        values={
            "role": "competitor",
            "is_primary": False,
            "track_seo": False,
            "track_ai": True,
            "color_index": None,
        },
        info=SEED_INFO,
    )

    with pytest.raises(SeedError, match="has the competitor role"):
        await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_project.py --no-cov -n 4 -q`
Expected: FAIL (collection error) with `ModuleNotFoundError: No module named 'idraft.devseed.project'`.

- [ ] **Step 4: Write the project module**

`backend/src/idraft/devseed/project.py`:

```python
"""The project, its brand and its competitors, made or brought in line with the fixture.

Every write goes through the service the matching route uses (`ProjectService`,
`EntityService`, `ProjectEntityService`), so the same rules, locks and audit entries apply.
Reads that only decide what to write use the repositories. Nothing the fixture does not name is
removed or renamed: an alias, domain or competitor a developer added stays.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import func, select

from idraft.api.entities import project_repository as roles
from idraft.api.entities import repository as entity_rows
from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService, stored_host
from idraft.api.projects.service import ProjectService
from idraft.api.schemas.entities import AliasInput, DomainInput, ProjectEntityCreate
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import entities, projects
from idraft.devseed.context import SEED_INFO, Sessions, SeedError
from idraft.devseed.fixture import CompetitorPart, EntityPart, ProjectPart
from idraft.extraction.domains import ProjectRole

ENTITY_TYPE: Final = "brand"
# The API's default (`ProjectCreate.deep_check_weekday`).
DEEP_CHECK_WEEKDAY: Final = 1


@dataclass(frozen=True, slots=True)
class EntityChanges:
    created: int
    aliases_added: int
    domains_added: int
    updated: int
    roles_given: int


@dataclass(frozen=True, slots=True)
class _Found:
    entity_id: UUID
    is_ambiguous: bool
    hints: list[str]
    # Case-folded.
    aliases: set[str]
    # The hosts of its `host` rules.
    hosts: set[str]


async def find_project(sessions: Sessions, access: WorkspaceAccess, slug: str) -> UUID | None:
    """The live project of the workspace with this slug, or None. One that is deleted, archived
    or paused stops the seed: bringing it back is a person's decision."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        row = (
            await db.execute(
                select(projects.c.id, projects.c.status, projects.c.deleted_at).where(
                    projects.c.workspace_id == access.workspace_id, projects.c.slug == slug
                )
            )
        ).one_or_none()
    if row is None:
        return None
    if row.deleted_at is not None or row.status != "active":
        state = "deleted" if row.deleted_at is not None else row.status
        raise SeedError(
            f"The project {slug!r} exists and is {state}. Bring it back in the app first; the "
            "seed does not change that. Nothing was written."
        )
    project_id: UUID = row.id
    return project_id


async def ensure_project(
    sessions: Sessions, access: WorkspaceAccess, part: ProjectPart, location_id: int
) -> tuple[UUID, bool]:
    """The project's id, and whether it was made now. A found one gets the fixture's name, time
    zone, language, domain and default location; `ProjectService.update` writes and audits
    nothing when they already match."""
    service = ProjectService(sessions=sessions)
    project_id = await find_project(sessions, access, part.slug)
    if project_id is None:
        created = await service.create(
            access=access,
            name=part.name,
            slug=part.slug,
            timezone=part.timezone,
            deep_check_weekday=DEEP_CHECK_WEEKDAY,
            default_language_code=part.language_code,
            primary_domain=part.host,
            default_location_id=location_id,
            info=SEED_INFO,
        )
        return created.id, True
    await service.update(
        access=access,
        project_id=project_id,
        changes={
            "name": part.name,
            "timezone": part.timezone,
            "default_language_code": part.language_code,
            "primary_domain": part.host,
            "default_location_id": location_id,
        },
        info=SEED_INFO,
    )
    return project_id, False


def _aliases(part: EntityPart) -> list[AliasInput]:
    """The fixture's aliases as word aliases that ignore case, each once, without the canonical
    name: the matcher matches an entity's own name without an alias."""
    seen = {part.name.casefold()}
    wanted: list[AliasInput] = []
    for alias in part.aliases:
        given = AliasInput(alias=alias)
        if given.alias.casefold() not in seen:
            seen.add(given.alias.casefold())
            wanted.append(given)
    return wanted


async def _found(sessions: Sessions, access: WorkspaceAccess, name: str) -> _Found | None:
    """The workspace's entity of this canonical name, case-insensitive."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        entity_id = (
            await db.execute(
                select(entities.c.id).where(
                    entities.c.workspace_id == access.workspace_id,
                    func.lower(entities.c.canonical_name) == name.lower(),
                )
            )
        ).scalar_one_or_none()
        if entity_id is None:
            return None
        record = await entity_rows.get_entity(db, access.workspace_id, entity_id, visible=None)
        aliases = await entity_rows.aliases_of(db, access.workspace_id, [entity_id])
        domains = await entity_rows.domains_of(db, access.workspace_id, [entity_id])
    if record is None:  # pragma: no cover - read in this transaction
        return None
    return _Found(
        entity_id=entity_id,
        is_ambiguous=record.is_ambiguous,
        hints=list(record.disambiguation_hints),
        aliases={alias.alias.casefold() for alias in aliases},
        hosts={domain.host for domain in domains if domain.match_scope == "host"},
    )


async def _ensure_entity(
    sessions: Sessions,
    access: WorkspaceAccess,
    part: EntityPart,
    *,
    is_ambiguous: bool,
    hints: Sequence[str],
    counts: Counter[str],
) -> UUID:
    service = EntityService(sessions=sessions)
    aliases = _aliases(part)
    domains = [DomainInput(domain=domain) for domain in part.domains]
    found = await _found(sessions, access, part.name)
    if found is None:
        row = await service.create(
            access,
            entity_type=ENTITY_TYPE,
            canonical_name=part.name,
            parent_entity_id=None,
            description=None,
            is_ambiguous=is_ambiguous,
            disambiguation_hints=list(hints),
            aliases=aliases,
            domains=domains,
            info=SEED_INFO,
        )
        counts["created"] += 1
        return row.entity.id
    missing_aliases = [alias for alias in aliases if alias.alias.casefold() not in found.aliases]
    if missing_aliases:
        await service.add_aliases(access, found.entity_id, missing_aliases, SEED_INFO)
        counts["aliases_added"] += len(missing_aliases)
    for domain in domains:
        if stored_host(domain).name not in found.hosts:
            await service.add_domain(access, found.entity_id, domain, SEED_INFO)
            counts["domains_added"] += 1
    changes: dict[str, object] = {}
    if found.is_ambiguous != is_ambiguous:
        changes["is_ambiguous"] = is_ambiguous
    if found.hints != list(hints):
        changes["disambiguation_hints"] = list(hints)
    if changes:
        await service.update(access, found.entity_id, changes, SEED_INFO)
        counts["updated"] += 1
    return found.entity_id


async def _give_role(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    entity_id: UUID,
    name: str,
    *,
    role: ProjectRole,
) -> bool:
    """Whether a role was given now. A live role that differs stops the seed."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
    if current is not None and current.removed_at is None:
        if current.role != role or (role == "own" and not current.is_primary):
            wanted = "the primary own role" if role == "own" else f"the {role} role"
            raise SeedError(
                f"{name} has the {current.role} role in the project; the fixture gives it "
                f"{wanted}. Change it in the app; the seed does not."
            )
        return False
    body = ProjectEntityCreate(
        entity_id=entity_id,
        role=role,
        is_primary=role == "own",
        track_seo=role == "own",
        track_ai=True,
    )
    await ProjectEntityService(sessions=sessions).add(
        access,
        project_id,
        entity_id=entity_id,
        values=body.model_dump(exclude={"entity_id"}),
        info=SEED_INFO,
    )
    return True


async def ensure_entities(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    brand: EntityPart,
    competitors: Sequence[CompetitorPart],
) -> EntityChanges:
    """The brand with the primary own role, and each competitor with the competitor role, AI
    tracking on and SEO tracking off."""
    counts: Counter[str] = Counter()
    brand_id = await _ensure_entity(
        sessions, access, brand, is_ambiguous=False, hints=(), counts=counts
    )
    if await _give_role(sessions, access, project_id, brand_id, brand.name, role="own"):
        counts["roles_given"] += 1
    for part in competitors:
        entity_id = await _ensure_entity(
            sessions,
            access,
            part,
            is_ambiguous=part.ambiguous,
            hints=part.disambiguation_hints,
            counts=counts,
        )
        if await _give_role(sessions, access, project_id, entity_id, part.name, role="competitor"):
            counts["roles_given"] += 1
    return EntityChanges(
        created=counts["created"],
        aliases_added=counts["aliases_added"],
        domains_added=counts["domains_added"],
        updated=counts["updated"],
        roles_given=counts["roles_given"],
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_project.py --no-cov -n 4 -q`
Expected: PASS, 6 passed. If `test_the_brand_and_competitors_are_made_with_their_roles` reports `updated=9` on the second run, the service stores hints in another form than the fixture gives them: compare `found.hints` with what `EntityService.update` stores (read `B/api/schemas/entities.py` `Hint`) and normalize the same way in `_ensure_entity`; do not loosen the test.

- [ ] **Step 6: Prove it bites**

In `_ensure_entity`, replace `if found is None:` with `if True:`: the second run raises a duplicate name error and `test_an_entity_the_workspace_has_is_completed_not_duplicated` fails. Restore. In `_give_role`, delete the `if current is not None and current.removed_at is None:` block: the second run of the roles test raises `DuplicateError`. Restore; 6 passed.

- [ ] **Step 7: Gates and commit**

```bash
git add backend/src/idraft/devseed/project.py backend/tests/devseed/support.py backend/tests/devseed/test_project.py
git commit -m "Dev seed: make or complete the Eventus project, brand and competitors"
```

## Task 6: The topics

**Files:**
- Create: `backend/src/idraft/devseed/topics.py`
- Test: `backend/tests/devseed/test_topics.py`

**Read first:** `B/api/taxonomy/service.py` (`create_vocabulary`, `add_terms`, `_TermAdder`), `B/api/taxonomy/repository.py` (`list_vocabularies`, `terms_of`, `TermRecord`, `VocabularyRecord`), `B/api/schemas/taxonomy.py` (`TermInput`), `apps/web/src/mocks/ai-prompt-world.ts` lines 100 to 125 (the mocks' vocabulary: kind `topic`, name `Security topics`).

- [ ] **Step 1: Write the failing test**

`backend/tests/devseed/test_topics.py`:

```python
"""The topics are one hierarchical project vocabulary with the fixture's slugs, matched by path:
a second run makes nothing, and a term deleted since is made again."""

from __future__ import annotations

import pytest

from idraft.devseed.context import Sessions, SeedError
from idraft.devseed.fixture import topic_paths
from idraft.devseed.topics import ensure_topics
from tests.api.auth.support import execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import FIXTURE, audit_count, seeded_project


async def test_the_topics_are_made_as_a_two_level_vocabulary(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)

    term_ids, made = await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    paths = topic_paths(FIXTURE.topics)
    assert made == 29
    assert set(term_ids) == set(paths)
    vocabulary = await fetchrow(
        migrated,
        "SELECT id, kind, name, is_hierarchical, is_single_valued "
        "FROM core.taxonomy_vocabularies WHERE project_id = $1",
        project_id,
    )
    assert tuple(vocabulary)[1:] == ("topic", "Security topics", True, False)
    terms = await fetch(
        migrated,
        "SELECT id, path, name FROM core.taxonomy_terms WHERE vocabulary_id = $1",
        vocabulary["id"],
    )
    by_path = {row["path"]: row["id"] for row in terms}
    assert set(by_path) == set(paths.values())
    assert by_path["managed-soc-mdr/soc-monitoring"] == term_ids["soc-monitoring"]
    assert {row["name"] for row in terms if row["path"] == "managed-soc-mdr"} == {
        "Managed SOC and MDR"
    }

    before = await audit_count(migrated, workspace)
    assert await ensure_topics(sessions, access, project_id, FIXTURE.topics) == (term_ids, 0)
    assert await audit_count(migrated, workspace) == before


async def test_a_term_deleted_since_is_made_again(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    term_ids, _ = await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    await execute(
        migrated, "DELETE FROM core.taxonomy_terms WHERE id = $1", term_ids["soc-monitoring"]
    )

    again, made = await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    assert made == 1
    assert again["soc-monitoring"] != term_ids["soc-monitoring"]


async def test_a_single_valued_topic_vocabulary_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    await execute(
        migrated,
        "UPDATE core.taxonomy_vocabularies SET is_single_valued = true WHERE project_id = $1",
        project_id,
    )

    with pytest.raises(SeedError, match="single-valued"):
        await ensure_topics(sessions, access, project_id, FIXTURE.topics)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_topics.py --no-cov -n 4 -q`
Expected: FAIL (collection error) with `ModuleNotFoundError: No module named 'idraft.devseed.topics'`.

- [ ] **Step 3: Write the topics module**

`backend/src/idraft/devseed/topics.py`:

```python
"""The fixture's topics as the project's topic vocabulary, through `TaxonomyService`.

Terms are matched by path (`parent-slug` or `parent-slug/child-slug`). Parents are added by name
with their fixture slug, then children under them, so every slug is the fixture's (a `path`
input would make the parent's slug from its name). A term the fixture does not name is left
alone, and so is the name of one it does.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final
from uuid import UUID

from idraft.api.schemas.taxonomy import TermInput
from idraft.api.taxonomy import repository as taxonomy_rows
from idraft.api.taxonomy.service import TaxonomyService
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, Sessions, SeedError
from idraft.devseed.fixture import TopicParent, topic_paths

VOCABULARY_KIND: Final = "topic"
VOCABULARY_NAME: Final = "Security topics"


async def _vocabulary(
    sessions: Sessions, service: TaxonomyService, access: WorkspaceAccess, project_id: UUID
) -> UUID:
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        found, _ = await taxonomy_rows.list_vocabularies(
            db,
            access.workspace_id,
            visible=None,
            project_id=project_id,
            kind=VOCABULARY_KIND,
            offset=0,
            limit=200,
        )
    for vocabulary in found:
        if (
            vocabulary.project_id == project_id
            and vocabulary.name.casefold() == VOCABULARY_NAME.casefold()
        ):
            if not vocabulary.is_hierarchical or vocabulary.is_single_valued:
                raise SeedError(
                    f"The project's vocabulary {VOCABULARY_NAME!r} is flat or single-valued; "
                    "the topics need a hierarchical one that takes two terms per prompt. "
                    "Change it in the app."
                )
            return vocabulary.id
    created = await service.create_vocabulary(
        access,
        kind=VOCABULARY_KIND,
        name=VOCABULARY_NAME,
        project_id=project_id,
        is_hierarchical=True,
        is_single_valued=False,
        info=SEED_INFO,
    )
    return created.id


async def _paths(
    sessions: Sessions, access: WorkspaceAccess, vocabulary_id: UUID
) -> dict[str, UUID]:
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        terms = await taxonomy_rows.terms_of(db, access.workspace_id, vocabulary_id)
    return {term.path: term.id for term in terms}


async def ensure_topics(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    topics: Sequence[TopicParent],
) -> tuple[dict[str, UUID], int]:
    """Each fixture topic's slug and term id, and how many terms were made now."""
    service = TaxonomyService(sessions=sessions)
    vocabulary_id = await _vocabulary(sessions, service, access, project_id)
    existing = await _paths(sessions, access, vocabulary_id)
    made = 0
    parents = [
        TermInput(name=parent.name, slug=parent.slug)
        for parent in topics
        if parent.slug not in existing
    ]
    if parents:
        made += len(
            await service.add_terms(access, vocabulary_id, parents, batch=True, info=SEED_INFO)
        )
        existing = await _paths(sessions, access, vocabulary_id)
    children = [
        TermInput(name=child.name, slug=child.slug, parent_id=existing[parent.slug])
        for parent in topics
        for child in parent.children
        if f"{parent.slug}/{child.slug}" not in existing
    ]
    if children:
        made += len(
            await service.add_terms(access, vocabulary_id, children, batch=True, info=SEED_INFO)
        )
        existing = await _paths(sessions, access, vocabulary_id)
    return {slug: existing[path] for slug, path in topic_paths(topics).items()}, made
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_topics.py --no-cov -n 4 -q`
Expected: PASS, 3 passed.

- [ ] **Step 5: Prove it bites**

Remove `if parent.slug not in existing` from the `parents` list: the second run fails with `409` sibling name (a `DuplicateError`). Restore. Change `TermInput(name=parent.name, slug=parent.slug)` to `TermInput(path=parent.name)`: the first test fails (paths `managed-soc-and-mdr`). Restore; 3 passed.

- [ ] **Step 6: Gates and commit**

```bash
git add backend/src/idraft/devseed/topics.py backend/tests/devseed/test_topics.py
git commit -m "Dev seed: make the Eventus topics as a two level vocabulary"
```

## Task 7: The engines on, their schedules paused in the same transaction

**Files:**
- Create: `backend/src/idraft/devseed/engines.py`
- Test: `backend/tests/devseed/test_engines.py`

**Read first:** the Task 4 functions `put_engine` and `pause_schedule`, `B/api/ai/engine_repository.py` (`project_engines`, `ProjectEngineRecord`), `B/api/operations/schedules_repository.py` (`list_schedules`), `B/domain/workloads.py` (`TaskWorkload.AI_PROMPT`), `docs/ops/ai-first-run.md` step B, `BT/api/ai/support.py` (`enable_engine`).

- [ ] **Step 1: Write the failing test**

`backend/tests/devseed/test_engines.py`:

```python
"""Both engines go on at India, the UAE and Saudi Arabia, the schedules that makes never commit
active, and a second run changes nothing."""

from __future__ import annotations

from idraft.devseed.context import Sessions
from idraft.devseed.engines import PAUSE_REASON, EngineChanges, ensure_engines
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import enable_engine
from tests.api.auth.support import execute, fetch
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, FIXTURE, audit_count, seeded_project

_ENGINES = (
    "SELECT engine_code, location_ids, is_enabled FROM ai.project_engines "
    "WHERE project_id = $1 ORDER BY engine_code"
)
_SCHEDULES = (
    "SELECT is_active FROM ops.schedules "
    "WHERE project_id = $1 AND workload = 'ai_prompt' AND deleted_at IS NULL"
)
_GULF = [2356, 2682, 2784]


async def test_the_engines_go_on_and_their_schedules_are_paused(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)

    changes = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert changes == EngineChanges(
        turned_on=(EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB), paused=2
    )
    assert [tuple(row) for row in await fetch(migrated, _ENGINES, project_id)] == [
        ("chatgpt_web", _GULF, True),
        ("gemini_web", _GULF, True),
    ]
    assert [row["is_active"] for row in await fetch(migrated, _SCHEDULES, project_id)] == [
        False,
        False,
    ]
    reasons = await fetch(
        migrated,
        "SELECT after->>'reason' AS reason FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'schedule.paused'",
        workspace.id,
    )
    assert [row["reason"] for row in reasons] == [PAUSE_REASON, PAUSE_REASON]

    before = await audit_count(migrated, workspace)
    again = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)
    assert again == EngineChanges(turned_on=(), paused=0)
    assert await audit_count(migrated, workspace) == before


async def test_a_schedule_resumed_since_is_paused_again(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)
    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = true WHERE project_id = $1 AND weekday = 1",
        project_id,
    )

    changes = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert changes == EngineChanges(turned_on=(), paused=1)
    assert [row["is_active"] for row in await fetch(migrated, _SCHEDULES, project_id)] == [
        False,
        False,
    ]


async def test_an_engine_on_in_fewer_countries_is_widened(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await enable_engine(migrated, workspace, project_id, "chatgpt_web", [COUNTRY_IDS["IN"]])

    changes = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert changes.turned_on == (EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB)
    assert [tuple(row) for row in await fetch(migrated, _ENGINES, project_id)] == [
        ("chatgpt_web", _GULF, True),
        ("gemini_web", _GULF, True),
    ]
    assert [row["is_active"] for row in await fetch(migrated, _SCHEDULES, project_id)] == [
        False,
        False,
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_engines.py --no-cov -n 4 -q`
Expected: FAIL (collection error) with `ModuleNotFoundError: No module named 'idraft.devseed.engines'`.

- [ ] **Step 3: Write the engines module**

`backend/src/idraft/devseed/engines.py`:

```python
"""The fixture's engines on, at exactly their countries, with every active AI schedule of the
project paused in the same transaction (plan D3 decision 10).

Turning the first engine on makes the project's two AI answer schedules (`ensure_ai_schedule`),
which would spend at their next window. Both are paused before the transaction commits, so they
never exist active. An engine already on at those countries is not put again: a put always
writes an audit entry, and the second run must write nothing.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from idraft.api.ai import engine_repository
from idraft.api.ai.engine_service import put_engine
from idraft.api.operations import schedules_repository
from idraft.api.operations.schedules import pause_schedule
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.schemas.operations import SchedulePause
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, Sessions
from idraft.devseed.fixture import EnginePart
from idraft.domain.ai_engines import EngineCode
from idraft.domain.workloads import TaskWorkload

PAUSE_REASON: Final = "dev seed: paused so nothing spends by itself"
# A project has at most `BASE_PLAN.runs_per_week` live AI schedules; this is far above it.
_SCHEDULES_MAX: Final = 100


@dataclass(frozen=True, slots=True)
class EngineChanges:
    turned_on: tuple[EngineCode, ...]
    paused: int


async def ensure_engines(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    engines: Sequence[EnginePart],
    location_ids: Mapping[str, int],
) -> EngineChanges:
    turned_on: list[EngineCode] = []
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        current = await engine_repository.project_engines(db, access.workspace_id, project_id)
        for part in engines:
            wanted = sorted({location_ids[country] for country in part.countries})
            have = current.get(part.engine_code)
            if have is not None and have.is_enabled and sorted(have.location_ids) == wanted:
                continue
            await put_engine(
                db,
                access,
                project_id,
                part.engine_code,
                EngineUpdate(location_ids=wanted, is_enabled=True),
                SEED_INFO,
            )
            turned_on.append(part.engine_code)
        active, _ = await schedules_repository.list_schedules(
            db,
            access.workspace_id,
            project_id,
            workload=TaskWorkload.AI_PROMPT.value,
            is_active=True,
            offset=0,
            limit=_SCHEDULES_MAX,
        )
        for schedule in active:
            await pause_schedule(
                db, access, project_id, schedule.id, SchedulePause(reason=PAUSE_REASON), SEED_INFO
            )
    return EngineChanges(turned_on=tuple(turned_on), paused=len(active))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_engines.py --no-cov -n 4 -q`
Expected: PASS, 3 passed.

- [ ] **Step 5: Prove it bites (the pause)**

Delete the `for schedule in active: await pause_schedule(...)` loop: `test_the_engines_go_on_and_their_schedules_are_paused` fails with `[True, True]`, and so does every test that reads `_SCHEDULES`. Restore. Delete the `if have is not None and ...: continue` lines: the second run reports both engines turned on and the audit count grows. Restore; 3 passed.

- [ ] **Step 6: Gates and commit**

```bash
git add backend/src/idraft/devseed/engines.py backend/tests/devseed/test_engines.py
git commit -m "Dev seed: turn the engines on in India, the UAE and Saudi Arabia with the schedules paused"
```

## Task 8: The prompts

**Files:**
- Create: `backend/src/idraft/devseed/prompts.py`
- Test: `backend/tests/devseed/test_prompts.py`

**Read first:** `B/api/ai/prompt_service.py` (`key_of`, `bulk_create`, `get`, `update`, `quota_error`), `B/api/ai/prompt_repository.py` (`PromptKey`, `quota_usage`, `existing`, `PromptRecord`), `B/api/schemas/ai.py` (`PromptCreate`, `PromptBulkCreate`, `PromptPatch`), `B/ai/text.py` (`text_hash`), `BT/api/ai/support.py` (`ai_project`, `seed_prompts`, `set_prompt_quota`).

- [ ] **Step 1: Write the failing test**

`backend/tests/devseed/test_prompts.py`:

```python
"""The 72 prompts go through bulk-create: identity by text, language and country, `is_branded`
from the brand's aliases, one version each. A second run makes nothing; a drifted prompt is put
back; prompts past the quota stop the seed before anything is written."""

from __future__ import annotations

import uuid
from collections import Counter

import pytest

from idraft.api.problems import QuotaExceededError
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.devseed.context import Sessions, SeedError, seed_access
from idraft.devseed.engines import ensure_engines
from idraft.devseed.project import ensure_entities
from idraft.devseed.prompts import PromptChanges, check_prompt_quota, ensure_prompts
from idraft.devseed.topics import ensure_topics
from tests.api.ai.support import ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import Workspace, execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, FIXTURE, audit_count, owner_workspace, seeded_project

_PROMPTS = (
    "SELECT p.country_iso, p.is_branded, p.importance, p.is_active, v.text "
    "FROM ai.prompts p JOIN ai.prompt_versions v ON v.id = p.current_version_id "
    "WHERE p.project_id = $1"
)


async def _ready(
    pg: PostgresServer, sessions: Sessions
) -> tuple[WorkspaceAccess, Workspace, uuid.UUID, dict[str, uuid.UUID]]:
    access, workspace, project_id = await seeded_project(pg, sessions)
    await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
    term_ids, _ = await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)
    return access, workspace, project_id, term_ids


async def test_the_prompts_are_made_through_bulk_create(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id, term_ids = await _ready(migrated, sessions)

    changes = await ensure_prompts(
        sessions, access, project_id, "en", FIXTURE.prompts, term_ids
    )

    assert changes == PromptChanges(created=72, updated=0, unchanged=0)
    rows = await fetch(migrated, _PROMPTS, project_id)
    assert len(rows) == 72
    assert all(row["is_active"] for row in rows)
    assert Counter(row["country_iso"] for row in rows) == {"IN": 55, "AE": 12, "SA": 5}
    assert {row["text"] for row in rows if row["is_branded"]} == {
        part.text for part in FIXTURE.prompts if part.branded
    }
    terms = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ai.prompt_terms pt JOIN ai.prompts p ON p.id = pt.prompt_id "
        "WHERE p.project_id = $1",
        project_id,
    )
    assert terms["n"] == sum(len(set(part.topics)) for part in FIXTURE.prompts)
    versions = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ai.prompt_versions v JOIN ai.prompts p ON p.id = v.prompt_id "
        "WHERE p.project_id = $1",
        project_id,
    )
    assert versions["n"] == 72
    created = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.created'",
        workspace.id,
    )
    assert created["n"] == 72

    before = await audit_count(migrated, workspace)
    again = await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)
    assert again == PromptChanges(created=0, updated=0, unchanged=72)
    assert await audit_count(migrated, workspace) == before


async def test_a_prompt_that_drifted_is_brought_back_in_line(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id, term_ids = await _ready(migrated, sessions)
    await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)
    first, second = FIXTURE.prompts[0], FIXTURE.prompts[1]
    await execute(
        migrated,
        "UPDATE ai.prompts p SET importance = 1 FROM ai.prompt_versions v "
        "WHERE v.id = p.current_version_id AND p.project_id = $1 AND v.text = $2",
        project_id,
        first.text,
    )
    await execute(
        migrated,
        "UPDATE ai.prompts p SET is_active = false FROM ai.prompt_versions v "
        "WHERE v.id = p.current_version_id AND p.project_id = $1 AND v.text = $2",
        project_id,
        second.text,
    )

    changes = await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)

    assert changes == PromptChanges(created=0, updated=2, unchanged=70)
    by_text = {row["text"]: row for row in await fetch(migrated, _PROMPTS, project_id)}
    assert by_text[first.text]["importance"] == first.importance
    assert by_text[second.text]["is_active"]


async def test_prompts_past_the_quota_stop_the_seed_before_anything_is_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    other = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, other, 40)
    await set_prompt_quota(migrated, workspace, 100)
    access = seed_access(user.id, workspace.id)

    with pytest.raises(SeedError, match="40 of 100 active prompts and the fixture needs 72 more"):
        await check_prompt_quota(sessions, access, None, "en", FIXTURE.prompts)

    await set_prompt_quota(migrated, workspace, 112)
    await check_prompt_quota(sessions, access, None, "en", FIXTURE.prompts)


async def test_bulk_create_still_refuses_past_the_quota_and_writes_nothing(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id, term_ids = await _ready(migrated, sessions)
    await set_prompt_quota(migrated, workspace, 50)

    with pytest.raises(QuotaExceededError):
        await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)

    assert await fetch(migrated, _PROMPTS, project_id) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_prompts.py --no-cov -n 4 -q`
Expected: FAIL (collection error) with `ModuleNotFoundError: No module named 'idraft.devseed.prompts'`.

- [ ] **Step 3: Write the prompts module**

`backend/src/idraft/devseed/prompts.py`:

```python
"""The fixture's prompts, through `PromptService.bulk_create` (the route's path: the workspace's
prompt lock, the quota, the duplicate rule, the engines' countries, `is_branded` from the
project's aliases, one version each, audited) and `PromptService.update` for one that drifted.

A prompt has no key column. Its identity is the API's own: the composed text with its language
and country (`prompt_service.key_of`), so the fixture's `p01` to `p72` are never stored, and a
second run finds every prompt as a duplicate (`on_duplicate: skip`) and makes nothing.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select

from idraft.ai.text import text_hash
from idraft.api.ai import prompt_repository as prompt_rows
from idraft.api.ai.prompt_repository import PromptKey, PromptRecord
from idraft.api.ai.prompt_service import PromptService
from idraft.api.schemas.ai import PromptBulkCreate, PromptCreate, PromptPatch
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import ai_prompts
from idraft.devseed.context import SEED_INFO, Sessions, SeedError
from idraft.devseed.fixture import PromptPart


@dataclass(frozen=True, slots=True)
class PromptChanges:
    created: int
    updated: int
    unchanged: int


def prompt_items(
    language_code: str, parts: Sequence[PromptPart], term_ids: Mapping[str, UUID]
) -> list[PromptCreate]:
    return [
        PromptCreate(
            text=part.text,
            language_code=language_code,
            country_iso=part.country,
            intent=part.intent,
            funnel_stage=part.funnel_stage,
            prompt_type=part.prompt_type,
            importance=part.importance,
            term_ids=sorted({term_ids[slug] for slug in part.topics}),
        )
        for part in parts
    ]


async def prompt_quota(sessions: Sessions, access: WorkspaceAccess) -> tuple[int, int]:
    """The workspace's active prompt limit and its active prompts."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        return await prompt_rows.quota_usage(db, access.workspace_id)


async def check_prompt_quota(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID | None,
    language_code: str,
    parts: Sequence[PromptPart],
) -> None:
    """Stops the seed before its first write when the prompts it would make, or bring back from
    the archive, do not fit the workspace's active prompt quota. `bulk_create` checks again under
    the workspace's prompt lock, so a prompt added meanwhile cannot take it past the quota."""
    keys: list[PromptKey] = [(text_hash(part.text), language_code, part.country) for part in parts]
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        limit, used = await prompt_rows.quota_usage(db, access.workspace_id)
        found = (
            {}
            if project_id is None
            else await prompt_rows.existing(db, access.workspace_id, project_id, keys)
        )
        archived = 0
        if found:
            archived = (
                await db.execute(
                    select(func.count())
                    .select_from(ai_prompts)
                    .where(
                        ai_prompts.c.workspace_id == access.workspace_id,
                        ai_prompts.c.id.in_(sorted(found.values())),
                        ai_prompts.c.is_active.is_(False),
                    )
                )
            ).scalar_one()
    needed = len(keys) - len(found) + archived
    if needed and used + needed > limit:
        raise SeedError(
            f"The workspace has {used} of {limit} active prompts and the fixture needs {needed} "
            "more. Nothing was written. Archive prompts in the app, or raise "
            "core.workspace_quotas.max_active_prompts for this workspace in the development "
            "database."
        )


def _differences(record: PromptRecord, item: PromptCreate) -> dict[str, object]:
    """What `PATCH` would set to bring a found prompt in line with the fixture."""
    wanted: dict[str, object] = {
        "intent": item.intent,
        "funnel_stage": item.funnel_stage,
        "prompt_type": item.prompt_type,
        "importance": item.importance,
    }
    changes = {name: value for name, value in wanted.items() if getattr(record, name) != value}
    if {term.term_id for term in record.terms} != set(item.term_ids):
        changes["term_ids"] = list(item.term_ids)
    if not record.is_active:
        changes["is_active"] = True
    return changes


async def ensure_prompts(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    language_code: str,
    parts: Sequence[PromptPart],
    term_ids: Mapping[str, UUID],
) -> PromptChanges:
    """The fixture's prompts made, and the found ones brought in line. A rejected item stops the
    seed naming it; the accepted ones are saved by then, so running again finishes the rest."""
    items = prompt_items(language_code, parts, term_ids)
    service = PromptService(sessions=sessions)
    outcome = await service.bulk_create(
        access, project_id, PromptBulkCreate(items=items, on_duplicate="skip"), SEED_INFO
    )
    if outcome.rejected:
        refused = "; ".join(
            f"{parts[rejected.index].key} {rejected.code}: {rejected.message}"
            for rejected in outcome.rejected
        )
        raise SeedError(
            f"Prompts were refused: {refused}. {len(outcome.created)} others were saved; fix the "
            "cause and run the seed again."
        )
    updated = 0
    for index, prompt_id in outcome.skipped:
        record = await service.get(access, project_id, prompt_id)
        changes = _differences(record, items[index])
        if changes:
            await service.update(
                access, project_id, prompt_id, PromptPatch.model_validate(changes), SEED_INFO
            )
            updated += 1
    return PromptChanges(
        created=len(outcome.created),
        updated=updated,
        unchanged=len(outcome.skipped) - updated,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_prompts.py --no-cov -n 4 -q`
Expected: PASS, 4 passed.

- [ ] **Step 5: Prove it bites**

In `check_prompt_quota`, delete the `if needed and used + needed > limit:` block: the quota test fails (`DID NOT RAISE`). Restore. In `_differences`, delete the `if not record.is_active:` lines: the drift test fails (`updated=1`, the archived prompt stays archived). Restore; 4 passed.

- [ ] **Step 6: Gates and commit**

```bash
git add backend/src/idraft/devseed/prompts.py backend/tests/devseed/test_prompts.py
git commit -m "Dev seed: add the 72 Eventus prompts through bulk create, within the quota"
```

## Task 9: The one command

**Files:**
- Create: `backend/src/idraft/devseed/run.py`
- Modify: `backend/src/idraft/cli.py` (module docstring, imports, a handler, the subcommand)
- Modify: `backend/pyproject.toml` (one import-linter contract)
- Modify: `backend/tests/devseed/support.py` (add `world_counts`)
- Test: `backend/tests/devseed/test_run.py`
- Test: `backend/tests/devseed/test_cli_seed.py`

**Read first:** `B/cli.py` (whole file: `_fail`, `main`, how `create-operator` is wired), `BT/test_cli.py` (how the CLI is tested: `cli.main([...])`, `capsys`, `monkeypatch.setenv`), `B/api/problems.py` lines 73 to 97 (`ProblemError`), `backend/pyproject.toml` `[tool.importlinter]`.

- [ ] **Step 1: Add the row counts to the test support**

Append to `backend/tests/devseed/support.py` (add `fetchrow` is already imported):

```python
_COUNTS: Final = {
    "projects": "SELECT count(*) AS n FROM core.projects WHERE workspace_id = $1",
    "entities": "SELECT count(*) AS n FROM core.entities WHERE workspace_id = $1",
    "aliases": "SELECT count(*) AS n FROM core.entity_aliases WHERE workspace_id = $1",
    "entity_domains": "SELECT count(*) AS n FROM core.entity_domains WHERE workspace_id = $1",
    "roles": "SELECT count(*) AS n FROM core.project_entities WHERE workspace_id = $1",
    "terms": "SELECT count(*) AS n FROM core.taxonomy_terms WHERE workspace_id = $1",
    "engines": (
        "SELECT count(*) AS n FROM ai.project_engines WHERE workspace_id = $1 AND is_enabled"
    ),
    "schedules": (
        "SELECT count(*) AS n FROM ops.schedules WHERE workspace_id = $1 "
        "AND workload = 'ai_prompt' AND deleted_at IS NULL"
    ),
    "active_schedules": (
        "SELECT count(*) AS n FROM ops.schedules WHERE workspace_id = $1 "
        "AND workload = 'ai_prompt' AND deleted_at IS NULL AND is_active"
    ),
    "prompts": "SELECT count(*) AS n FROM ai.prompts WHERE workspace_id = $1 AND is_active",
    "versions": "SELECT count(*) AS n FROM ai.prompt_versions WHERE workspace_id = $1",
    "observations": "SELECT count(*) AS n FROM ai.observations WHERE workspace_id = $1",
    "runs": "SELECT count(*) AS n FROM ops.collection_runs WHERE workspace_id = $1",
    "audit": "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1",
}


async def world_counts(pg: PostgresServer, workspace: Workspace) -> dict[str, int]:
    """How many rows of each kind the workspace has: equal before and after a second run."""
    return {
        name: int((await fetchrow(pg, statement, workspace.id))["n"])
        for name, statement in _COUNTS.items()
    }
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/devseed/test_run.py`:

```python
"""The whole seed: what it makes, that a second run changes nothing, and that what a person must
fix stops it before the first write."""

from __future__ import annotations

import pytest

from idraft.devseed.context import Sessions, SeedError
from idraft.devseed.engines import EngineChanges
from idraft.devseed.project import EntityChanges
from idraft.devseed.prompts import PromptChanges
from idraft.devseed.run import seed_eventus
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import execute
from tests.conftest import PostgresServer
from tests.devseed.support import FIXTURE, gulf_locations, owner_workspace, world_counts

_ALIASES = sum(
    len({alias.casefold() for alias in part.aliases} - {part.name.casefold()})
    for part in [FIXTURE.brand, *FIXTURE.competitors]
)


async def test_the_seed_makes_the_project_and_a_second_run_changes_nothing(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)

    report = await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert report.project_created
    assert report.entities == EntityChanges(
        created=9, aliases_added=0, domains_added=0, updated=0, roles_given=9
    )
    assert report.terms_created == 29
    assert report.engines == EngineChanges(
        turned_on=(EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB), paused=2
    )
    assert report.prompts == PromptChanges(created=72, updated=0, unchanged=0)
    assert (report.active_prompts, report.prompt_limit) == (72, 150)
    counts = await world_counts(migrated, workspace)
    assert {name: value for name, value in counts.items() if name != "audit"} == {
        "projects": 1,
        "entities": 9,
        "aliases": _ALIASES,
        "entity_domains": 9,
        "roles": 9,
        "terms": 29,
        "engines": 2,
        "schedules": 2,
        "active_schedules": 0,
        "prompts": 72,
        "versions": 72,
        "observations": 0,
        "runs": 0,
    }

    again = await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert not again.project_created
    assert again.entities == EntityChanges(
        created=0, aliases_added=0, domains_added=0, updated=0, roles_given=0
    )
    assert again.terms_created == 0
    assert again.engines == EngineChanges(turned_on=(), paused=0)
    assert again.prompts == PromptChanges(created=0, updated=0, unchanged=72)
    assert await world_counts(migrated, workspace) == counts


async def test_prompts_past_the_quota_stop_the_seed_with_nothing_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    other = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, other, 40)
    await set_prompt_quota(migrated, workspace, 100)
    before = await world_counts(migrated, workspace)

    with pytest.raises(SeedError, match="Nothing was written"):
        await seed_eventus(sessions, FIXTURE, workspace.slug)

    assert await world_counts(migrated, workspace) == before


async def test_a_missing_country_stops_the_seed_with_nothing_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    await execute(migrated, "UPDATE core.locations SET is_active = false WHERE id = 2784")
    try:
        with pytest.raises(SeedError, match="AE"):
            await seed_eventus(sessions, FIXTURE, workspace.slug)
        assert (await world_counts(migrated, workspace))["projects"] == 0
    finally:
        await gulf_locations(migrated)
```

`backend/tests/devseed/test_cli_seed.py`:

```python
"""`python -m idraft.cli seed-eventus`: one command seeds the project, a second run changes
nothing, and the server's settings, a database elsewhere and a broken fixture are refused before
anything is written."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from idraft import cli
from idraft.devseed.guard import LOOPBACK
from tests.api.auth.support import fetch
from tests.conftest import PostgresServer
from tests.devseed.support import gulf_locations, owner_workspace


def _environment(
    monkeypatch: pytest.MonkeyPatch,
    *,
    database_url: str,
    app_env: str = "local",
    app_origin: str = "http://localhost:3000",
) -> None:
    monkeypatch.setenv("PROCESS_ROLE", "cli")
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.setenv("APP_ORIGIN", app_origin)
    monkeypatch.setenv("DATABASE_URL", database_url)
    # Settings require one; the seed never connects to it.
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")


def _run(capsys: pytest.CaptureFixture[str], arguments: list[str]) -> tuple[int, str, str]:
    code = cli.main(arguments)
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_one_command_seeds_the_project_and_a_second_run_changes_nothing(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert migrated.host in LOOPBACK, "the test database must be on this machine for the guard"
    _, workspace = asyncio.run(owner_workspace(migrated))
    asyncio.run(gulf_locations(migrated))
    _environment(monkeypatch, database_url=migrated.url("app_api"))

    code, out, err = _run(capsys, ["seed-eventus", "--workspace", workspace.slug])

    assert (code, err) == (0, "")
    assert "Engines turned on: chatgpt_web, gemini_web. AI schedules paused: 2." in out
    assert "Prompts: 72 made, 0 updated, 0 unchanged." in out
    assert "Active prompts in the workspace: 72 of 150." in out

    code, out, err = _run(capsys, ["seed-eventus", "--workspace", workspace.slug])

    assert (code, err) == (0, "")
    assert "Engines turned on: none. AI schedules paused: 0." in out
    assert "Prompts: 0 made, 0 updated, 72 unchanged." in out


def test_the_servers_settings_are_refused_and_nothing_is_written(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _, workspace = asyncio.run(owner_workspace(migrated))
    _environment(
        monkeypatch,
        database_url=migrated.url("app_api"),
        app_env="production",
        app_origin="https://app.idraft.ai",
    )

    code, out, err = _run(capsys, ["seed-eventus", "--workspace", workspace.slug])

    assert (code, out) == (1, "")
    assert err.startswith("Refused: APP_ENV is production")
    projects = asyncio.run(
        fetch(migrated, "SELECT 1 FROM core.projects WHERE workspace_id = $1", workspace.id)
    )
    assert projects == []


def test_a_database_on_another_host_is_refused_before_connecting(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _environment(
        monkeypatch, database_url="postgresql://app_api:secret-pw@db.example.com:5432/idraft"
    )

    code, _, err = _run(capsys, ["seed-eventus"])

    assert code == 1
    assert "not on this machine" in err
    assert "secret-pw" not in err


def test_a_broken_fixture_is_refused_before_connecting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    # Nothing listens here: the fixture is read first, so this is never dialled.
    _environment(monkeypatch, database_url="postgresql://app_api:x@127.0.0.1:9/idraft")

    code, _, err = _run(capsys, ["seed-eventus", "--fixture", str(broken)])

    assert code == 1
    assert "is not valid" in err


def test_a_missing_workspace_is_named(
    migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _environment(monkeypatch, database_url=migrated.url("app_api"))

    code, _, err = _run(capsys, ["seed-eventus", "--workspace", "no-such-workspace"])

    assert code == 1
    assert "No active workspace 'no-such-workspace'" in err
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed/test_run.py tests/devseed/test_cli_seed.py --no-cov -n 4 -q`
Expected: FAIL: `ModuleNotFoundError: No module named 'idraft.devseed.run'` for `test_run.py`, and `argparse` exit 2 (`invalid choice: 'seed-eventus'`) for the CLI tests.

- [ ] **Step 4: Write the orchestration**

`backend/src/idraft/devseed/run.py`:

```python
"""`python -m idraft.cli seed-eventus`: the Eventus Security AI prompt tracking project in a
development database (docs/ops/dev-eventus-seed.md; plan D3).

Every step is idempotent. Everything a person must fix (the owner, the countries, a project that
is archived, the quota) is checked before the first write.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi.exceptions import RequestValidationError

from idraft.api.problems import ProblemError
from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.devseed.context import Sessions, SeedError, country_locations, find_owner
from idraft.devseed.engines import EngineChanges, ensure_engines
from idraft.devseed.fixture import EventusFixture
from idraft.devseed.project import EntityChanges, ensure_entities, ensure_project, find_project
from idraft.devseed.prompts import (
    PromptChanges,
    check_prompt_quota,
    ensure_prompts,
    prompt_quota,
)
from idraft.devseed.topics import ensure_topics


@dataclass(frozen=True, slots=True)
class SeedReport:
    workspace_slug: str
    workspace_id: UUID
    project_slug: str
    project_id: UUID
    project_created: bool
    entities: EntityChanges
    terms_created: int
    engines: EngineChanges
    prompts: PromptChanges
    active_prompts: int
    prompt_limit: int

    def lines(self) -> list[str]:
        entities, engines, prompts = self.entities, self.engines, self.prompts
        turned_on = ", ".join(code.value for code in engines.turned_on) or "none"
        state = "created" if self.project_created else "already there"
        return [
            f"Workspace {self.workspace_slug} ({self.workspace_id}), project "
            f"{self.project_slug} ({self.project_id}): {state}.",
            f"Entities: {entities.created} made, {entities.aliases_added} aliases and "
            f"{entities.domains_added} domains added, {entities.updated} changed, "
            f"{entities.roles_given} roles given.",
            f"Topics: {self.terms_created} terms made.",
            f"Engines turned on: {turned_on}. AI schedules paused: {engines.paused}.",
            f"Prompts: {prompts.created} made, {prompts.updated} updated, "
            f"{prompts.unchanged} unchanged. Active prompts in the workspace: "
            f"{self.active_prompts} of {self.prompt_limit}.",
            "No answers were made: they come from a run (docs/ops/dev-eventus-seed.md).",
        ]


async def seed_eventus(
    sessions: Sessions, fixture: EventusFixture, workspace_slug: str
) -> SeedReport:
    access = await find_owner(sessions, workspace_slug)
    countries = {fixture.project.default_country} | {
        country for engine in fixture.engines for country in engine.countries
    }
    location_ids = await country_locations(sessions, countries)
    language = fixture.project.language_code
    found = await find_project(sessions, access, fixture.project.slug)
    await check_prompt_quota(sessions, access, found, language, fixture.prompts)
    project_id, created = await ensure_project(
        sessions, access, fixture.project, location_ids[fixture.project.default_country]
    )
    entities = await ensure_entities(
        sessions, access, project_id, fixture.brand, fixture.competitors
    )
    term_ids, terms_created = await ensure_topics(sessions, access, project_id, fixture.topics)
    engines = await ensure_engines(sessions, access, project_id, fixture.engines, location_ids)
    prompts = await ensure_prompts(
        sessions, access, project_id, language, fixture.prompts, term_ids
    )
    limit, used = await prompt_quota(sessions, access)
    return SeedReport(
        workspace_slug=workspace_slug,
        workspace_id=access.workspace_id,
        project_slug=fixture.project.slug,
        project_id=project_id,
        project_created=created,
        entities=entities,
        terms_created=terms_created,
        engines=engines,
        prompts=prompts,
        active_prompts=used,
        prompt_limit=limit,
    )


async def run_seed(
    settings: Settings, fixture: EventusFixture, workspace_slug: str
) -> SeedReport:
    """`seed_eventus` on its own engine. A refusal a service raises (what the API would answer
    with a problem) becomes a `SeedError` that names it."""
    engine = create_engine(settings)
    try:
        return await seed_eventus(create_session_factory(engine), fixture, workspace_slug)
    except ProblemError as error:
        detail = f" {error.detail}" if error.detail else ""
        raise SeedError(
            f"The API refused a step: {error.title} ({error.problem_code}).{detail}"
        ) from None
    except RequestValidationError as error:
        found = "; ".join(
            f"{'.'.join(str(part) for part in item['loc'][1:])}: {item['msg']}"
            for item in error.errors()
        )
        raise SeedError(f"The API refused a step: {found}") from None
    finally:
        await engine.dispose()
```

- [ ] **Step 5: Wire the subcommand into the CLI**

In `backend/src/idraft/cli.py`:

1. Replace the module docstring with:

```python
"""Operator commands, run by hand on the host: `python -m idraft.cli <command>`.

`create-operator` makes the first account. Registration is by invitation, and an invitation needs
someone to send it, so the first person comes in this way. It connects as `migrator`: the API's
own database role cannot make anyone a platform operator (docs/04-data-model.md section 13.1).

`seed-eventus` makes the Eventus Security AI prompt tracking project in a development database
from `fixtures/ai-prompts/eventus-security.json`, as the API's role and a workspace owner. It
refuses to run anywhere but a developer's machine (docs/ops/dev-eventus-seed.md).
"""
```

2. Add to the imports (keep ruff's order; `ruff check --fix` sorts them):

```python
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from idraft.devseed.context import SeedError
from idraft.devseed.fixture import DEFAULT_FIXTURE, FixtureError, load_fixture
from idraft.devseed.guard import NotDevelopmentError, check_development
from idraft.devseed.run import run_seed
```

and change the existing line `from idraft.config.settings import load_migrator_settings` to `from idraft.config.settings import load_migrator_settings, load_settings`.

3. Add the handler after `_create_operator`:

```python
def _seed_eventus(arguments: argparse.Namespace) -> int:
    settings = load_settings()
    try:
        check_development(settings)
    except NotDevelopmentError as error:
        return _fail(f"Refused: {error} Nothing was written.")
    try:
        fixture = load_fixture(arguments.fixture)
    except FixtureError as error:
        return _fail(str(error))
    try:
        report = asyncio.run(run_seed(settings, fixture, arguments.workspace))
    except SeedError as error:
        return _fail(str(error))
    except (OSError, TimeoutError, SQLAlchemyError) as error:
        # The type only: a driver's message can quote the connection string.
        return _fail(f"The database could not be used ({type(error).__name__}).")
    sys.stdout.write("\n".join(report.lines()) + "\n")
    return 0
```

4. In `main`, after `operator.set_defaults(run=_create_operator)`, add:

```python
    seed = commands.add_parser(
        "seed-eventus",
        help="development only: seed the Eventus Security AI prompt tracking project",
    )
    seed.add_argument("--workspace", default="digibranders", help="the workspace slug")
    seed.add_argument(
        "--fixture", type=Path, default=DEFAULT_FIXTURE, help="the fixture JSON to read"
    )
    seed.set_defaults(run=_seed_eventus)
```

- [ ] **Step 6: Add the import contract**

In `backend/pyproject.toml`, after the contract named `"lower layers never import the entrypoints"`, add:

```toml
[[tool.importlinter.contracts]]
name = "the dev seed is reached only from the operator CLI"
type = "forbidden"
source_modules = [
  "idraft.ai", "idraft.api", "idraft.collectors", "idraft.config", "idraft.db",
  "idraft.domain", "idraft.extraction", "idraft.keywords", "idraft.providers",
  "idraft.ranks", "idraft.storage", "idraft.vault", "idraft.worker",
]
forbidden_modules = ["idraft.devseed"]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest tests/devseed tests/test_cli.py --no-cov -n 4 -q`
Expected: PASS, every test. Then `cd backend && uv run lint-imports`: `Contracts: N kept, 0 broken.` with the new contract listed.

- [ ] **Step 8: Prove it bites (the guard on the command)**

In `_seed_eventus`, delete the `try: check_development(settings) ... except NotDevelopmentError ...` lines: `test_the_servers_settings_are_refused_and_nothing_is_written` fails (code 0, a project written) and `test_a_database_on_another_host_is_refused_before_connecting` fails (a connection error instead). Restore. Add `from idraft.devseed.run import run_seed` to `B/api/main.py`: `uv run lint-imports` reports the new contract broken. Remove it; all pass.

- [ ] **Step 9: Gates and commit**

```bash
git add backend/src/idraft/devseed/run.py backend/src/idraft/cli.py backend/pyproject.toml backend/tests/devseed/support.py backend/tests/devseed/test_run.py backend/tests/devseed/test_cli_seed.py
git commit -m "Dev seed: one command, python -m idraft.cli seed-eventus"
```

## Task 10: The runbook, the three country list, and the full gate

**Files:**
- Create: `docs/ops/dev-eventus-seed.md`
- Create: `backend/tests/fixtures/dataforseo/locations-india-gulf.json`
- Test: `backend/tests/devseed/test_locations_file.py`
- Modify: `fixtures/ai-prompts/README.md` (one paragraph at the end of "Seeding the backend")

**Read first:** `backend/README.md` (dev stack, `.env.migrator`, `.env.worker`, `sync_locations`), `docs/ops/ai-first-run.md` ("Asking many prompts at once", "How to switch everything off"), `B/worker/sync_locations.py`, `B/collectors/locations.py` (`_deactivate_unlisted`: a list shorter than half the active mapped locations deactivates nothing), `B/providers/dataforseo/locations.py` (`read_locations`), `backend/tests/fixtures/dataforseo/locations.json` (the answer shape).

- [ ] **Step 1: Write the failing test**

`backend/tests/devseed/test_locations_file.py`:

```python
"""The saved three country list the runbook loads reads as India, the UAE and Saudi Arabia."""

from __future__ import annotations

from pathlib import Path

from idraft.providers.dataforseo.locations import read_locations
from tests.devseed.support import COUNTRY_IDS

FILE = Path(__file__).parents[1] / "fixtures" / "dataforseo" / "locations-india-gulf.json"


def test_the_saved_list_has_the_three_countries() -> None:
    listed = read_locations(FILE.read_bytes())

    assert listed.skipped == 0
    assert {
        (location.country_iso, location.code, location.location_type) for location in listed.locations
    } == {(country, code, "Country") for country, code in COUNTRY_IDS.items()}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/devseed/test_locations_file.py --no-cov -q`
Expected: FAIL with `FileNotFoundError`.

- [ ] **Step 3: Write the saved list**

`backend/tests/fixtures/dataforseo/locations-india-gulf.json`:

```json
{
  "version": "0.1.20260901",
  "status_code": 20000,
  "status_message": "Ok.",
  "time": "0.1000 sec.",
  "cost": 0,
  "tasks_count": 1,
  "tasks_error": 0,
  "tasks": [
    {
      "id": "11121200-0000-0000-0000-d3e5ee000001",
      "status_code": 20000,
      "status_message": "Ok.",
      "time": "0.0500 sec.",
      "cost": 0,
      "result_count": 3,
      "path": ["v3", "serp", "google", "locations"],
      "data": {"api": "serp", "function": "locations", "se": "google"},
      "result": [
        {
          "location_code": 2356,
          "location_name": "India",
          "location_code_parent": null,
          "country_iso_code": "IN",
          "location_type": "Country"
        },
        {
          "location_code": 2784,
          "location_name": "United Arab Emirates",
          "location_code_parent": null,
          "country_iso_code": "AE",
          "location_type": "Country"
        },
        {
          "location_code": 2682,
          "location_name": "Saudi Arabia",
          "location_code_parent": null,
          "country_iso_code": "SA",
          "location_type": "Country"
        }
      ]
    }
  ]
}
```

If `read_locations` refuses this shape, compare it field by field with `backend/tests/fixtures/dataforseo/locations.json` (the shape it reads) and match that file; do not change the parser.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/devseed/test_locations_file.py --no-cov -q`
Expected: PASS, 1 passed.

- [ ] **Step 5: Write the runbook**

`docs/ops/dev-eventus-seed.md`:

````markdown
# Seed Eventus Security AI prompt tracking (development database only)

One command makes the Eventus Security AI prompt tracking project in your development database from
`fixtures/ai-prompts/eventus-security.json`: the project, the brand and 8 competitors, 29 topics, the
ChatGPT and Gemini engines in India, the UAE and Saudi Arabia, and 72 prompts. It makes no answers.

## What it never does

- It never runs on the server. It refuses unless `APP_ENV` is `local`, the database in `DATABASE_URL` is
  on this machine (`localhost`, `127.0.0.1` or `::1`) and `APP_ORIGIN` is on this machine. The server's
  env files say `APP_ENV=production` and `APP_ORIGIN=https://app.idraft.ai`, so it is refused there
  twice over.
- Never point a local env file at an SSH tunnel to another database. A tunnel looks like `127.0.0.1` and
  the seed cannot tell.
- It never creates a user, a workspace or a location, and never removes or renames anything.
- It never leaves an AI schedule running: it pauses every active AI schedule of the project in the same
  transaction that turns the engines on. Nothing spends by itself.

## Before you run it (once)

All commands run from `backend/`.

1. The dev stack is up: `docker compose -f ../infra/compose/docker-compose.dev.yml up -d`.
2. The schema is current: `uv run --env-file .env.migrator python -m idraft.db.migrate`.
3. A workspace with the slug `digibranders` exists, with you as its owner. If you have no account yet,
   make one with `uv run --env-file .env.migrator python -m idraft.cli create-operator --email you@example.com --name "Your Name"`,
   start the API and the web app, sign in at `http://localhost:3000` and create the workspace named
   `Digibranders`. Check its slug on the workspace settings page; if it is not `digibranders`, pass
   `--workspace <slug>` below.
4. India, the UAE and Saudi Arabia are active locations. With DataForSEO credentials in `.env.worker`,
   load the full free list: `uv run --env-file .env.worker python -m idraft.worker.sync_locations`.
   Without credentials, load the saved three country list:
   `uv run --env-file .env.worker python -m idraft.worker.sync_locations --from-file tests/fixtures/dataforseo/locations-india-gulf.json`.
   It prints `3 locations, 0 skipped, N deactivated`. If N is not 0, the list deactivated other
   countries your database had: run the full sync from DataForSEO to bring them back.

## The command

```bash
cd backend
uv run --env-file .env python -m idraft.cli seed-eventus
```

Options: `--workspace SLUG` (default `digibranders`), `--fixture PATH` (default the repository's
`fixtures/ai-prompts/eventus-security.json`).

The first run prints:

```text
Workspace digibranders (<workspace id>), project eventus-security (<project id>): created.
Entities: 9 made, 0 aliases and 0 domains added, 0 changed, 9 roles given.
Topics: 29 terms made.
Engines turned on: chatgpt_web, gemini_web. AI schedules paused: 2.
Prompts: 72 made, 0 updated, 0 unchanged. Active prompts in the workspace: 72 of 150.
No answers were made: they come from a run (docs/ops/dev-eventus-seed.md).
```

## Running it again

Safe at any time. A second run prints `already there`, zeros everywhere and
`Prompts: 0 made, 0 updated, 72 unchanged.`, and writes nothing (no row, no audit entry). It puts back
what drifted: a prompt you archived comes back, a changed importance or topic is reset, a deleted topic
is made again, a missing alias or domain is added. It also pauses an AI schedule you resumed. What you
added stays: extra prompts, competitors, aliases and topics.

The prompts are matched by their text, language and country, as the API matches them. If the fixture's
text of a prompt changes, the next run adds it as a new prompt; archive the old one in the app.

## Getting answers in development

There is no fake AI provider for the dev worker: answers come from DataForSEO and cost real money.
One bulk run of the 72 prompts on the two engines is 144 answers, about 0.17 USD (0.0012 USD each,
standard queue).

1. Put your DataForSEO credentials and the dev object store (`R2_RAW_*`, see `backend/README.md`) in
   `.env.worker` and the `R2_RAW_*` ones in `.env`. Set a budget first (`docs/ops/ai-first-run.md`, step A).
2. Start the worker: `uv run --env-file .env.worker python -m idraft.worker`.
3. Signed in at `http://localhost:3000`, open the browser console on any app page and run, with the two
   ids the seed printed:

   ```js
   const P = '/api/v1/workspaces/<workspace id>/projects/<project id>';
   const list = await (await fetch(`${P}/prompts?limit=200`)).json();
   const run = await fetch(`${P}/ai/runs`, {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
     body: JSON.stringify({ prompt_ids: list.data.map((p) => p.prompt_id) }),
   });
   console.log(run.status, await run.json());
   ```

   `202` with `meta.answers: 144` and `meta.estimated_cost_usd` means it is queued. The other answers
   are listed in `docs/ops/ai-first-run.md`, "Asking many prompts at once". It is one of the project's
   20 manual runs of the day. Do not send it twice.
4. The answers arrive in minutes. The schedules stay paused; resume them in the app only if you want
   the dev database to spend twice a week by itself.

## If it stops

| Message starts with | What to do |
|---|---|
| `Refused: APP_ENV is ...`, `... not on this machine` | You are not on a development env file. Use `backend/.env`. |
| `No active workspace ...` | Step 3, or `--workspace <slug>`. |
| `core.locations has no active country location for ...` | Step 4. |
| `The project 'eventus-security' exists and is archived` | Bring it back in the app, then run again. |
| `The workspace has U of L active prompts and the fixture needs N more` | Archive prompts in the app, or raise `core.workspace_quotas.max_active_prompts` for the workspace in the dev database. Nothing was written. |
| `... has the competitor role in the project; the fixture gives it ...` | Fix the role in the project's entity settings, then run again. |
| `Prompts were refused: p.. location_not_supported ...` | Another engine (AI Mode) is on without that country. Turn it off or add the country, then run again. |
| `The fixture ... is not valid: ...` | The fixture changed shape. Fix the file, or update `idraft/devseed/fixture.py` with the web session. |
````

- [ ] **Step 6: Point the fixture README at the command**

In `fixtures/ai-prompts/README.md`, append at the end of the section "Seeding the backend":

```markdown

The backend's seed is `cd backend && uv run --env-file .env python -m idraft.cli seed-eventus`, for a
development database only; its runbook is `docs/ops/dev-eventus-seed.md`. It reads this file strictly
(`backend/src/idraft/devseed/fixture.py`): a key it does not know fails the seed, so a change of shape
here needs a change there.
```

- [ ] **Step 7: ASCII and dash check**

Run: `grep -nP '[^\x00-\x7F]' docs/ops/dev-eventus-seed.md fixtures/ai-prompts/README.md backend/src/idraft/devseed/*.py backend/tests/devseed/*.py backend/tests/fixtures/dataforseo/locations-india-gulf.json`
Expected: no output.

- [ ] **Step 8: The full backend gate**

Run:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend && uv sync --frozen && ./check.sh
```

Expected: ruff, ruff format, mypy and lint-imports clean, then every test passed with the coverage gate met. If coverage drops below the gate, the uncovered lines are in `idraft/devseed`: add the missing case to the matching test file of Tasks 1 to 9 (do not add `pragma: no cover` beyond the one already in `project.py`).

- [ ] **Step 9: Commit**

```bash
git add docs/ops/dev-eventus-seed.md backend/tests/fixtures/dataforseo/locations-india-gulf.json backend/tests/devseed/test_locations_file.py fixtures/ai-prompts/README.md
git commit -m "Dev seed: runbook, saved three country list, pointer from the fixture README"
```

## Self-review

- Spec coverage: DEV ONLY guard with APP_ENV and loopback database host, plus the origin (Task 2, Decision 2, and how the live server is never touched); idempotency by keys with the prompt identity stated (Decision 5, Tasks 5 to 9); entities, vocabulary terms, prompts through the bulk-create service path (Tasks 5, 6, 8); engines through `engine_service`'s put body with IN AE SA and a clear stop when a location is missing (Tasks 3, 7); the two schedules paused in the same transaction (Tasks 4, 7); no answers (Decision 15, Task 9 counts observations and runs); quota 72 of 150 with a clear stop (Tasks 8, 9); the actor (Task 3, Decision 3); Pydantic strict loader (Task 1); a guard test, a seed test with counts and idempotency, refusal of a non-dev environment and a remote host, a quota overflow test (Tasks 2, 8, 9); "Prove it bites" in every task, including removing the guard (Task 9 Step 8) and removing the pause (Task 7 Step 5); the runbook with the exact command, its output and one bulk run in dev (Task 10); full `./check.sh` (Task 10 Step 8).
- Types: `Sessions`, `SEED_INFO`, `SeedError`, `seed_access` (Task 3) are used with the same names in Tasks 4 to 9; `EntityChanges`, `EngineChanges`, `PromptChanges` fields match between their modules, `run.py` and the tests; `ensure_topics` returns `(dict[str, UUID], int)` everywhere.
