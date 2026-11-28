# Page drawer, AI tab (prompts, trend, pages cited with this page): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task by task. One subagent at a time, never two in parallel. Each task runs in a fresh context: the subagent
> reads "Rules for every task" and "Contracts" below, then its own task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The AI tab of the page drawer lists the prompts that cited the page (each opening the prompt inspector),
the trend of citations by day with the change against the compared period, and the pages cited in the same
answers (your own pages open their drawer). Data comes only from stored tables: no provider call, no migration
expected.

**Architecture:** One new route, `GET .../internal-links/pages/{url_id}/ai`. A pure model
(`api/internal_links/page_ai_model.py`) counts; a module (`page_ai.py`) reads with the shared AI functions
(`scope_prompts`, `lookback_answers`, `units_of`, `prompt_texts`, `project_zone`, `summary_dates`,
`previous_dates`) and one new function, `citing_observations`; `LinkReadService.page_ai` owns the transaction.
On the web a Seam hook reads it, pure helpers (`lib/pages/ai-model.ts`) shape it, and three cards sit in the AI
tab under the existing count strip. The three screens that host the page drawer get the prompt inspector.

**Tech stack:** Python 3.13, FastAPI, SQLAlchemy Core (async), pytest with testcontainers Postgres, `uv`.
Next.js (App Router), React, TypeScript, TanStack Query, nuqs, next-intl, Tailwind v4 tokens, vitest with Testing
Library and MSW, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-28-page-ai-tab-design.md`. Read the sections a task names before
starting it. The spec wins over this plan on what the product does; this plan wins on file names and order.

---

## Rules for every task

- Work only in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab` (branch
  `claude/page-ai-tab`), called `$WT` below. Absolute paths in shell commands. Never touch the main checkout,
  `main`, `develop` or another worktree. No push, no merge.
- Read `AGENTS.md` at `$WT` first.
- Do not edit files other sessions own: `apps/web/src/components/app/inspector/*` and `apps/web/src/lib/inspector/*`
  (the shared drawer: its API stays as it is), the prompts feature (`apps/web/src/features/prompts/*`), the
  Citations feature. In shared files (`messages/en.json`, `openapi/v1.json`, `terms.md`, `banned-words.json`,
  `read_routes.py`, `reads.py`, `handlers/internal-links.ts`) add or change only the entries of this build.
- First use in a new worktree: `pnpm install --frozen-lockfile` at `$WT` (before a web task) and
  `cd $WT/backend && uv sync --frozen` (before a backend task), each once. Task 12 deletes what they made.
- Write and change files with the Write and Edit tools, not shell heredocs.
- Follow the code around you. Check an existing helper before writing one. No `any`, explicit return types,
  specific errors. Comments say why, in one line.
- Machine load (`~/.claude/CLAUDE.md`, "Machine Load and Disk Hygiene"): run only the commands a task lists, one
  at a time, one worker. No full `pnpm test`, no `pnpm lint` of the whole app, no `./check.sh`, no `pnpm build`
  (Task 12 builds once), no dev server, no full e2e. Leave no process running. Never start, stop or restart
  Colima or Docker: if `colima status` says it is not running, stop and tell the lead. Never use ports 3000,
  3002, 3020, 3030 or 3100.
- Words: no em dash and no en dash anywhere (code comments, strings, tests, docs, commit messages). Ranges are
  written "5 to 10". No exclamation marks. Before writing or changing a visible string read
  `docs/glossary/final-list.md`. Every visible string goes in `apps/web/messages/en.json` with a camelCase key.
  Banned in visible text: "window", "source" (as a label), "engine", "own pages" (say "your pages"), "inactive"
  (say "paused" or "archived"), "No data", "N/A", and "AI Mode" without "Google" in front.
- UI tasks (any task that changes a `.tsx` that renders): first read `AI_DEVELOPMENT_UI_RULES.md` and
  `DESIGN_SYSTEM.md` at `$WT`, then invoke the `design-taste-frontend` skill. The project's design system
  outranks the skill. No hex colours, no arbitrary Tailwind values, type utilities only, numbers through
  `@/lib/format`, no pixel width on anything in the drawer (spec 9.5).
- Commit at the end of each task on this branch with the message the task gives. No attribution lines. Stage
  only the files of the task (`git add <paths>`, never `git add -A`).

**Backend commands** (in every shell that runs pytest):

```bash
colima status
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab/backend
uv run ruff check <the files you changed>
uv run ruff format --check <the files you changed>
uv run mypy src/idraft/api/internal_links src/idraft/api/ai src/idraft/api/schemas <the test files you changed>
uv run lint-imports
uv run pytest -n 0 --no-cov <the test files of the task>
```

When a route, a query parameter or a schema changes, regenerate the committed document in the same commit:

```bash
uv run python -m idraft.api.openapi > openapi/v1.json
uv run pytest -n 0 --no-cov tests/api/test_openapi.py tests/api/test_route_access.py
```

**Web commands:**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab/apps/web
pnpm exec eslint --max-warnings 0 <the files you changed>
pnpm typecheck
pnpm exec vitest run --maxWorkers=1 <the test files you changed or that cover your change>
pnpm exec prettier --check <the files you changed>
```

`pnpm typecheck` is `next typegen && tsc --noEmit`; use it, not the bare `tsc`.

**The review steps.** Every task ends with the same two steps. The lead (the session that dispatches the tasks)
runs them, not the implementer:

1. *Independent senior review (Sonnet subagent).* A fresh Sonnet subagent is given: the task's text, the spec
   sections the task names, the output of `git show --stat HEAD` and `git show HEAD`, and this list. It checks
   that the diff does what the task and those spec sections say and nothing else; that every file touched is one
   the task names (and none of the forbidden files above); the repository rules (`AGENTS.md`, the house style of
   the files around); types and error handling; for UI: `AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`,
   keyboard reach, accessible names, focus after an action, colour never the only sign, no pixel width; visible
   words against `docs/glossary/final-list.md` and the banned list above; no em dash or en dash in a line the
   commit adds (`git show HEAD | grep -nP '^\+.*[\x{2012}-\x{2015}]'` prints nothing); the tests test behaviour
   and would fail without the change; the listed commands were run and passed. Each task adds what else its
   reviewer must look at. The reviewer reports findings with file and line, most serious first, and changes
   nothing.
2. *Fix what the review found.* A fresh Sonnet subagent (Haiku for a task marked Haiku) fixes every finding that
   is right, reruns the task's commands, and commits as `<the task's commit message> (review fixes)`. A finding
   that is wrong is answered in one line to the lead. The next task starts only after this.

## Contracts

These names are used by more than one task. A task that defines one says so; every other task uses it as written
here.

### C1. Constants and schema (`backend/src/idraft/api/schemas/internal_links_ai.py`, defined in Task 1)

```python
PROMPT_LIMIT: Final = 25
ALONGSIDE_LIMIT: Final = 10
PageAiState = Literal["ready", "no_prompts", "no_answers"]
PageAiPlatformCode = Literal["chatgpt_web", "gemini_web", "google_ai_mode"]
DomainRole = Literal["own", "competitor", "third_party"]   # reuse schemas.ai_sources.DomainRole instead if it fits

class PageAiWindow(BaseModel):          # from_ aliased "from" exactly as schemas/metrics.py MetricWindow
    from_: str; to: str; timezone: str
class PageAiCompared(BaseModel):
    from_: str; to: str
class PageAiPlatform(BaseModel):
    engine_code: PageAiPlatformCode; label: str; answers: int; answers_citing: int
    previous_answers_citing: int | None
class PageAiPromptPlatform(BaseModel):
    engine_code: PageAiPlatformCode; label: str; answers: int; answers_citing: int
class PageAiPrompt(BaseModel):
    prompt_id: UUID; text: str; answers: int; answers_citing: int
    platforms: list[PageAiPromptPlatform]; last_cited_at: datetime
class PageAiDay(BaseModel):
    date: str; answers: int; answers_citing: int
class PageAiAlongside(BaseModel):
    url_id: int; url: str; path: str; title: str | None; host: str; registrable_domain: str
    domain_role: DomainRole; in_crawl: bool; answers_shared: int
class PageAi(BaseModel):
    state: PageAiState; window: PageAiWindow; days: int; compare_window: PageAiCompared | None
    answers: int; answers_citing: int
    previous_answers: int | None; previous_answers_citing: int | None
    platforms: list[PageAiPlatform]; prompts: list[PageAiPrompt]; prompts_total: int
    trend: list[PageAiDay]; alongside: list[PageAiAlongside]; alongside_total: int
class PageAiResponse(BaseModel):
    data: PageAi
```

No field has a default, so the generated client types every field as required (spec 4 lists their meaning).

### C2. The shared query (`backend/src/idraft/api/ai/citation_board_repository.py`, defined in Task 2)

```python
async def citing_observations(db: AsyncSession, scope: SourceScope, url_id: int) -> frozenset[int]:
    """The ids of the answers in `scope` that cite this address, flagged citations left out."""
```

### C3. The model (`backend/src/idraft/api/internal_links/page_ai_model.py`, defined in Task 1)

```python
@dataclass(frozen=True, slots=True)
class PageAiInput:
    url_id: int
    zone: ZoneInfo
    first: date
    last: date
    previous: tuple[date, date] | None
    engines: Sequence[str]                    # platform codes in engine order
    labels: Mapping[str, str]                 # code -> label
    answers: Sequence[Answer]                 # counted answers of both periods
    citing: frozenset[int]                    # observation ids that cite the page
    units: Mapping[int, Sequence[Unit]]       # units by observation id, of the citing answers
    prompts_in_scope: int

@dataclass(frozen=True, slots=True)
class Counted:
    ...                                       # everything but the prompt texts and in_crawl
    prompt_ids: tuple[UUID, ...]              # the prompts shown, in row order
    own_urls: tuple[int, ...]                 # url ids of the alongside rows with role own
    def build(self, texts: Mapping[UUID, str], crawled: frozenset[int]) -> PageAi: ...

def count_page_ai(source: PageAiInput) -> Counted: ...
def citing_in_current(source: PageAiInput) -> list[Answer]: ...   # the citing answers the service reads units for
```

### C4. The route (defined in Task 3)

`GET .../internal-links/pages/{url_id}/ai` with `run` (`latest` or a crawl id), `from`, `to`, `compare`
(`none` or `previous_period`). `LinkReadService.page_ai(access, project_id, *, run, url_id, start, end, compare)
-> PageAi`.

### C5. Web names (defined in Task 6 and 7, used after)

| Name | File | Shape |
|---|---|---|
| `PageAi` | `src/lib/internal-links/types.ts` | `Schemas['PageAi']` |
| `pageAiQuery(scope, urlId, run)` | `src/lib/internal-links/queries.ts` | `apiQuery` options, asks `compare=previous_period` |
| `usePageAi(scope, run, urlId)` | `src/lib/pages/page-ai.ts` | `Seam<PageAi>` |
| `changeOf(ai)` | `src/lib/pages/ai-model.ts` | `{ delta: number; previous: number; days: number } \| null` |
| `trendOf(ai, text)` | `src/lib/pages/ai-model.ts` | `{ categories: string[]; series: CategorySeries[]; cellText: (id, index) => string \| null }` |
| `alongsideKind(row)` | `src/lib/pages/ai-model.ts` | `'page' \| 'own-outside' \| 'competitor' \| 'third-party'` |
| `promptIdsOf(ai)` | `src/lib/pages/ai-model.ts` | `string[]` in row order |
| `PageDrawerContext.openPrompt` | `.../inspector/page-drawer-context.ts` | `(promptId: string, ids: readonly string[]) => void` |
| `usePromptOpener()` | `.../inspector/use-prompt-opener.ts` | `{ order: readonly string[]; openPrompt: (promptId, ids) => void }` |

## File structure

```
backend/src/idraft/api/schemas/internal_links_ai.py          (new)   Task 1
backend/src/idraft/api/internal_links/page_ai_model.py       (new)   Task 1
backend/src/idraft/api/ai/citation_board_repository.py       (edit)  Task 2
backend/src/idraft/api/internal_links/page_ai.py             (new)   Task 3
backend/src/idraft/api/internal_links/reads.py               (edit)  Task 3
backend/src/idraft/api/internal_links/read_routes.py         (edit)  Task 3
backend/openapi/v1.json                                       (regen) Task 3
backend/tests/api/internal_links/test_page_ai_model.py       (new)   Task 1
backend/tests/api/internal_links/support_page_ai.py          (new)   Task 3
backend/tests/api/internal_links/test_page_ai.py             (new)   Task 3
backend/tests/api/ai/test_citing_observations.py             (new)   Task 2
backend/tests/db/test_citations_url_index.py                 (new)   Task 4
apps/web/src/lib/api/schema.ts                                (regen) Task 5
apps/web/src/lib/internal-links/{types,queries}.ts            (edit)  Task 6
apps/web/src/lib/pages/{page-ai,ai-model}.ts + tests          (new)   Tasks 6, 7
apps/web/src/mocks/internal-links-page-ai.ts + test           (new)   Task 6
apps/web/src/mocks/handlers/internal-links.ts                 (edit)  Task 6
apps/web/src/features/internal-links/inspector/
    use-prompt-opener.ts, page-drawer-context.ts              (new/edit) Task 8
    ai-prompts-card.tsx                                       (new)   Task 9
    ai-trend-card.tsx, ai-alongside-card.tsx                  (new)   Task 10
    ai-basis.tsx, drawer-ai-tab.tsx                           (new)   Task 11
    page-inspector.tsx, extras-sections.tsx                   (edit)  Task 11
apps/web/src/features/internal-links/{pages-page/pages-screen,internal-links-screen,issues/issues-screen}.tsx  (edit) Task 8
apps/web/src/app/[workspace]/[project]/seo/{pages,pages/all,internal-links,issues}/page.tsx                    (edit) Task 8
apps/web/messages/en.json                                     (edit)  Tasks 9, 10, 11
docs/glossary/{terms.md,banned-words.json}                    (edit)  Task 11
apps/web/e2e/flows/page-ai-tab.spec.ts                        (new)   Task 12
```

---

## Part A. Backend

### Task 1: The schema and the pure model

Spec sections 4, 5 (the day and period rules), 6, 7. Contracts C1, C3. Needs `uv sync --frozen` first.

**Files:**
- Create: `backend/src/idraft/api/schemas/internal_links_ai.py`
- Create: `backend/src/idraft/api/internal_links/page_ai_model.py`
- Create: `backend/tests/api/internal_links/test_page_ai_model.py`

- [ ] **Step 1: Read first.** `api/ai/citation_board_model.py` (`Answer`, `Unit`, `page_detail`, how it groups by
  prompt and engine), `api/schemas/metrics.py` (`MetricWindow` and its alias), `api/schemas/ai_sources.py`
  (`DomainRole`), `api/internal_links/page_history.py` or `schemas/internal_links_history.py` (the house style of
  a page tab's schema), `domain/ai_engines.py`.

- [ ] **Step 2: Write the failing tests** (`test_page_ai_model.py`, pure, no database; build `Answer` and `Unit`
  by hand). One test per line:
  - a citing answer at 23:30 local time in `America/Los_Angeles` lands on its local day, not its UTC day;
  - the invariants of spec 4 on a built body (`answers_citing <= answers`; trend sums equal the totals;
    platform sums equal `answers_citing`; `len(trend) == days`; no prompt row with zero citing answers;
    `answers_shared <= answers_citing`; the page itself is not in `alongside`);
  - `platforms` always has three entries in engine order, zero filled;
  - a prompt row groups its answers, counts per platform, and `last_cited_at` is the newest citing answer;
  - prompt order: more citing answers first, then newer `last_cited_at`, then `prompt_id`; 26 prompts give 25 rows
    and `prompts_total == 26`;
  - alongside: shared counts are distinct answers; a page cited twice in one answer counts once; order is
    `answers_shared` desc, `url` asc, `url_id`; 11 addresses give 10 rows and `alongside_total == 11`;
  - `Counted.own_urls` lists only the alongside rows with role `own`; `build(..., crawled)` sets `in_crawl` true
    only for a role `own` address in `crawled`, never for a competitor even when its id is in `crawled`;
  - state: no prompts in scope is `no_prompts`; prompts and no counted answer in the period is `no_answers`; a
    page nothing cites with answers in the period is `ready` with zeros;
  - compare: `previous_answers` and `previous_answers_citing` count the answers of the compared days only; with
    `previous=None` they are null and `compare_window` is null;
  - a day with no answers is a zero point; a one day period and a 92 day period give 1 and 92 points;
  - `citing_in_current` returns only citing answers dated inside the current period.

- [ ] **Step 3: Run them, expect failures.**
  `uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_ai_model.py` fails on the import.

- [ ] **Step 4: Implement.** The schema as C1 (docstring names the spec). `page_ai_model.py`: a module docstring
  that says it has no SQL; `PageAiInput`, `Counted`, `count_page_ai`, `citing_in_current` as C3. The local day of
  an answer is `answer.observed_at.astimezone(source.zone).date()`. Group once with `defaultdict`; no work per
  answer beyond one pass. Platform labels come from `source.labels`. The trend lists every local day from
  `first` to `last`. `window` is built from `first`, `last` and `zone.key`. Engine order is `source.engines`
  order. Use `Answer` and `Unit` from `citation_board_model`; do not copy them.

- [ ] **Step 5: Run the tests, expect pass.** Then the backend commands of the rules on these three files.

- [ ] **Step 6: Commit.**
  `git add backend/src/idraft/api/schemas/internal_links_ai.py backend/src/idraft/api/internal_links/page_ai_model.py backend/tests/api/internal_links/test_page_ai_model.py`
  then `git commit -m "Page AI API: the pure model and the schema"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Also: the model has no SQL and no I/O; every
  counted number follows docs/16 (distinct answers, distinct addresses per answer); the zone is applied to every
  date; the invariants of spec 4 are asserted by a test, not by hope; the schema has no defaulted field.

- [ ] **Step 8: Fix what the review found**, rerun the commands, commit.

### Task 2: `citing_observations`, the one new query

Spec sections 3 (D3, D18), 8 step 6. Contract C2.

**Files:**
- Modify: `backend/src/idraft/api/ai/citation_board_repository.py`
- Create: `backend/tests/api/ai/test_citing_observations.py`

- [ ] **Step 1: Read first.** `citation_board_repository.py` whole, `source_repository.citation_bounds`,
  `tests/api/ai/sources_support.py` (`make_world`, `answer`, `Cite`, `page_ids`) and
  `tests/api/ai/citation_board_support.py` (`run_answer`), and how `test_citation_board_routes.py` seeds answers.

- [ ] **Step 2: Write the failing tests** (database, through the support helpers):
  - returns the observation ids of the answers that cite the address inside `[since, until)` and no others;
  - an answer that cites a different address is not returned;
  - an answer of another project of the same workspace is not returned;
  - a citation outside the period (just before `since`, exactly at `until`) is not returned;
  - a citation carrying `engine_internal` or `unresolved_redirect` is not returned when the scope excludes
    flags, and is returned when `excluded_flags` is empty;
  - an address cited twice in one answer gives that id once; an address nobody cites gives an empty set.

- [ ] **Step 3: Run them, expect failures** (`ImportError`).

- [ ] **Step 4: Implement** `citing_observations` as C2: `select(_C.observation_id).where(*citation_bounds(scope),
  _C.url_id == url_id).distinct()`, returned as a `frozenset`. A docstring says why ids alone are enough (one
  sequence, `observed_at` already bounded), as the module note says for `units_of`.

- [ ] **Step 5: Run the tests, expect pass,** then the backend commands on these files and
  `uv run pytest -n 0 --no-cov tests/api/ai/test_citation_board_routes.py` (the neighbours still pass).

- [ ] **Step 6: Commit.**
  `git add backend/src/idraft/api/ai/citation_board_repository.py backend/tests/api/ai/test_citing_observations.py`
  then `git commit -m "Page AI API: the answers that cite one page"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Also: no SQL copied from the cited-pages read; the
  statement is bounded by workspace, project and instants (partitions); the function is the only addition.

- [ ] **Step 8: Fix what the review found**, rerun the commands, commit.

### Task 3: The service, the route and the OpenAPI document

Spec sections 3 (D1, D4, D5, D8, D16, D21), 4, 5, 8. Contracts C3, C4.

**Files:**
- Create: `backend/src/idraft/api/internal_links/page_ai.py`
- Modify: `backend/src/idraft/api/internal_links/reads.py` (`LinkReadService.page_ai`)
- Modify: `backend/src/idraft/api/internal_links/read_routes.py` (the route)
- Create: `backend/tests/api/internal_links/support_page_ai.py`, `backend/tests/api/internal_links/test_page_ai.py`
- Modify: `backend/openapi/v1.json` (regenerated)

- [ ] **Step 1: Read first.** `reads.py` (`read_scope`, `page_search`, `page_outline`, `_transaction`),
  `read_routes.py` (`page_search`, `Run`, `UrlIdPath`, `ReadData`, `Reads`), `api/ai/citation_board.py`
  (`_transaction` with `enable_nestloop`, `_load`), `api/ai/sources.py` (`local_instants`, `shown_engines`),
  `api/ai/summary.py` (`summary_dates`, `previous_dates`), `tests/api/internal_links/support.py` (`read_site`,
  `seed_crawl`), `tests/api/internal_links/test_page_search.py` (the house shape of a page tab's route test),
  `tests/api/ai/sources_support.py` (`make_world`, `answer`, `Cite`, `page_ids`).

- [ ] **Step 2: The seeded world.** `support_page_ai.py` exports
  `async def page_ai_site(pg, workspace, project_id) -> PageAiSite` (a frozen dataclass holding the run id, the
  url ids by path, the prompt ids by name and the world), which builds a crawl (`read_site`) and the AI world
  (`make_world`), then seeds answers with citations of the crawl's addresses and of outside addresses. The case
  table, exactly:

| Case | What is seeded |
|---|---|
| cited page `/blog/a` | 6 counted answers over the last 20 days across ChatGPT and Gemini, 2 more in the 28 days before, from 3 prompts (one branded) |
| alongside | in 4 of those answers also `/pricing` (own, in the crawl), `/old-never-crawled` (own, not in the crawl), a competitor page, a third party page |
| uncited page `/pricing` | answers exist in the period, none cites it |
| paused prompt | its answer cites `/blog/a`; must not count |
| archived prompt | the same |
| superseded answer | cites `/blog/a`; must not count |
| flagged citation | an answer whose only citation of `/blog/a` has the flag `engine_internal`; must not count |
| Google AI Overview | an answer citing `/blog/a`; must not count |
| other project | an answer in another project of the workspace citing `/blog/a`; must not count |

  Work every expected number out by hand from this table and export them as a module constant the tests import.

- [ ] **Step 3: Write the failing tests** (`test_page_ai.py`, through `GET .../internal-links/pages/{url_id}/ai`):
  - the cited page: every field of spec 4 against the constants (totals, platforms, prompt rows and their
    platform cells, trend sums, alongside rows with `answers_shared` and `in_crawl`), and the invariants of
    spec 4;
  - the uncited page: `state == ready`, zeros, 28 trend points, empty `prompts` and `alongside`;
  - the excluded cases of the table do not change any number (compare with a world that lacks them);
  - `compare=previous_period` returns `compare_window` and the previous totals; `compare=none` returns nulls;
  - `from` and `to` narrow the period; `from` after `to` is `422`; 93 days is `422`; one of the two given is
    accepted;
  - a project with no prompts: `no_prompts`; prompts with no answers in the period: `no_answers`;
  - a page with no row in the crawl: `404 not_found`; a project with no crawl: `404 no_crawl`; `run` of an
    older crawl changes `in_crawl` (an address crawled only then);
  - a viewer reads; a member of another workspace gets `404`; a caller without `data:read` gets `403`;
  - the route and its parameters are in `openapi/v1.json` (`test_openapi.py`) and in `test_route_access.py`.

- [ ] **Step 4: Run them, expect failures** (404 on the unknown route).

- [ ] **Step 5: Implement.**
  - `page_ai.py`, module docstring naming the spec: `async def load_page_ai(db, scope: PageScope, *,
    access, project_id, url_id, start, end, compare) -> PageAi`. In order (spec 8): the page's row in
    `crawl_pages` for `scope.run_id` (else `NotFoundError`), `project_zone` (else `NotFoundError`),
    `summary_dates`, `previous_dates` when compared, `local_instants` for the one scope (since the earliest
    start, until the end of `last`), `scope_prompts(include_branded=True, prompt_id=None, term_id=None,
    country_iso=None)`, `shown_engines(None)` (ordered by `EngineCode`), `SourceScope(... excluded_flags=
    EXCLUDED_FLAGS)`. No prompt: return `count_page_ai` of an empty input without further reads. Then
    `lookback_answers`, `citing_observations`, `citing_in_current`, `units_of`, `prompt_texts` for
    `counted.prompt_ids`, the crawl membership of `counted.own_urls`
    (`select crawl_pages.url_id where workspace_id, run_id, url_id in ...`), and `counted.build(...)`. Labels
    from `domain.ai_engines.ENGINES`.
  - `reads.py`: `LinkReadService.page_ai` opens `self._transaction(access)`, runs
    `await db.execute(text("SET LOCAL enable_nestloop = off"))` (why: as `CitationBoardService._transaction`),
    calls `read_scope(db, access, project_id, run)` and `load_page_ai`.
  - `read_routes.py`: the route after `/pages/{url_id}/outline`:
    `@router.get("/pages/{url_id}/ai", summary="One page: the prompts, the days and the pages of the answers that cite it", description=...)`
    with `run: Run = "latest"`, `start: Annotated[date | None, Query(alias="from")] = None`,
    `end: Annotated[date | None, Query(alias="to")] = None`,
    `compare: Literal["none", "previous_period"] = "none"`, returning `PageAiResponse`. The description states
    the basis of spec D6 in two sentences and that Google AI Overview is not listed.
  - `resources.py` and `main.py` are not touched (D21).

- [ ] **Step 6: Run the tests, expect pass.** Then the neighbours that share the files:
  `uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_ai.py tests/api/internal_links/test_page_ai_model.py tests/api/internal_links/test_page_search.py tests/api/internal_links/test_page_outline.py tests/api/internal_links/test_page_extras.py`.

- [ ] **Step 7: Regenerate the OpenAPI document** and run the backend commands of the rules on the files of this
  task (the regeneration commands of "Rules" belong here).

- [ ] **Step 8: Commit.**
  `git add backend/src/idraft/api/internal_links/page_ai.py backend/src/idraft/api/internal_links/reads.py backend/src/idraft/api/internal_links/read_routes.py backend/tests/api/internal_links/support_page_ai.py backend/tests/api/internal_links/test_page_ai.py backend/openapi/v1.json`
  then `git commit -m "Page AI API: the route and the read"`.

- [ ] **Step 9: Independent senior review (Sonnet subagent).** Also: every statement names the workspace and the
  project; no statement is per prompt, per answer or per row; the excluded cases of the table are asserted; the
  counted-answer rules are the shared ones (no re-implemented validity or supersession); `include_branded=True`
  and `EXCLUDED_FLAGS` are what spec D6 says; the route's `from` and `to` aliases match the other AI reads;
  `openapi/v1.json` differs from a fresh generation by nothing; `resources.py` and `main.py` are untouched.

- [ ] **Step 10: Fix what the review found**, rerun the commands, regenerate the document if a schema moved,
  commit.

### Task 4: Prove the url index can serve the read

Spec sections 3 (D18), 12. No migration is expected.

**Files:**
- Create: `backend/tests/db/test_citations_url_index.py`
- Only if the test proves the index cannot be used: Create `backend/src/idraft/db/migrations/versions/0049_citations_url_index.py`
  and tell the lead before committing it.

- [ ] **Step 1: Read first.** An existing `tests/db` test that runs `EXPLAIN` or inspects a plan, if any
  (`grep -rn "EXPLAIN" backend/tests/db`), `migrations/versions/0018_ai_prompts.py` lines around
  `citations_url_observed`, `tests/db/conftest.py`.

- [ ] **Step 2: Write the test.** In a migrated test database, in one transaction:
  `SET LOCAL enable_seqscan = off`, then `EXPLAIN (FORMAT JSON)` of the exact statement `citing_observations`
  produces (compile it from the function's SQLAlchemy statement with literal binds for a project and an
  address and a 28 day range) and assert the plan text contains `citations_url_observed`. With sequential scans
  off the planner takes the index only when the statement can use it, which is what is proved (a table of a few
  rows would choose a scan on its own: that is why the switch is needed).

- [ ] **Step 3: Run it.** `uv run pytest -n 0 --no-cov tests/db/test_citations_url_index.py`.
  Expected: pass. If it fails because the plan scans another index or none, do not write a migration yet:
  report the plan to the lead with the statement, and wait. A migration `0049` that creates
  `CREATE INDEX CONCURRENTLY`-free `citations_url_project_observed ON ai.citations (url_id, project_id, observed_at)`
  is the likely fix; the lead decides.

- [ ] **Step 4: Backend commands** on the test file, plus
  `uv run pytest -n 0 --no-cov tests/db/test_ai_schema.py` (nothing else moved).

- [ ] **Step 5: Commit.**
  `git add backend/tests/db/test_citations_url_index.py` then
  `git commit -m "Page AI API: the citing read can use the url index"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Also: the test fails if the index were dropped
  (the reviewer drops it in a scratch transaction or reasons from the plan text); the statement under test is
  the real one, not a copy; no migration was added when none was needed.

- [ ] **Step 7: Fix what the review found**, rerun the commands, commit.

### Task 5 (Haiku): Regenerate the web client, alone in its commit

- [ ] **Step 1:**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab/apps/web
pnpm gen:api
pnpm typecheck
git add src/lib/api/schema.ts
git commit -m "Regenerate the API client for the page AI read"
```

  Expected: `schema.ts` gains the path `.../internal-links/pages/{url_id}/ai`, the schemas `PageAi`, `PageAiResponse`,
  `PageAiWindow`, `PageAiCompared`, `PageAiPlatform`, `PageAiPromptPlatform`, `PageAiPrompt`, `PageAiDay` and
  `PageAiAlongside`, and the query parameters `from`, `to`, `compare`. Every field is required. `pnpm typecheck`
  passes. If it fails, stop and report: do not edit `schema.ts` by hand.

- [ ] **Step 2: Independent senior review (Sonnet subagent).** The commit holds `schema.ts` only, and its diff is
  only additions that Tasks 1 to 3 explain.

- [ ] **Step 3: Fix what the review found** (regenerate again, never hand-edit), commit.

---

## Part B. Web: data, mocks and pure helpers

### Task 6: Types, query, hook and the mocked API

Spec sections 9.1, 11, 12. Contract C5. Needs `pnpm install --frozen-lockfile` first.

**Files:**
- Modify: `apps/web/src/lib/internal-links/types.ts`, `apps/web/src/lib/internal-links/queries.ts`
- Create: `apps/web/src/lib/pages/page-ai.ts`, `apps/web/src/lib/pages/page-ai.test.tsx`
- Create: `apps/web/src/mocks/internal-links-page-ai.ts`, `apps/web/src/mocks/internal-links-page-ai.test.ts`
- Modify: `apps/web/src/mocks/handlers/internal-links.ts`

- [ ] **Step 1: Read first.** `lib/pages/search-daily.ts` and its test, `lib/pages/issue-source.ts` (`Seam`),
  `queries.ts` around `pageSearchQuery` and `pageOutlineQuery`, `mocks/internal-links-outline.ts` and its test,
  the `outline` handler in `handlers/internal-links.ts`, `mocks/ai-prompt-world.ts` (`EVENTUS_WORLD`: the prompt
  ids and texts), `mocks/internal-links-world.ts` (`FixturePage`, the fixture pages' ids and paths).

- [ ] **Step 2: Write the failing tests.**
  - `page-ai.test.tsx`: `usePageAi` is `loading`, then `ready` with the body; a 500 gives `error` and `retry`
    refetches; a bad url id throws `UrlIdError` as the other page queries do.
  - `internal-links-page-ai.test.ts`: for every exported page the invariants of spec 4 hold (the same list as
    the backend test); the cited page has three platforms, 28 trend points, 6 prompts whose ids and texts are
    real prompts of `EVENTUS_WORLD`, and 5 alongside rows (2 own in crawl, 1 own not in crawl, 1 competitor, 1
    third party) whose own ids are fixture pages; the quiet page is `ready` with zeros; the `no_answers` and
    `no_prompts` pages have those states; the error page makes the handler answer 500; a page outside the
    fixture crawl answers 404; `compare=none` returns nulls for the compared fields.

- [ ] **Step 3: Run them, expect failures.**

- [ ] **Step 4: Implement.** `types.ts`: `export type PageAi = Schemas['PageAi'];`. `queries.ts`:
  `PAGE_AI` path constant and `pageAiQuery(scope, urlId, run)` with `params: { path: {...pathOf(scope), url_id:
  checkUrlId(urlId)}, query: withRun({ compare: 'previous_period' }, run) }`. `page-ai.ts`: `usePageAi` exactly
  like `usePageSearchDaily`. The mock exports `AI_CITED_PAGE`, `AI_QUIET_PAGE`, `AI_NO_ANSWERS_PAGE`,
  `AI_NO_PROMPTS_PAGE`, `AI_ERROR_PAGE` (fixture page ids no other mock or test opens: check the outline
  mock's three and the others) and `pageAiOf(urlId, query)`; deterministic, no randomness; the days are the 28
  days ending on the mock world's today. The handler goes beside `outline`.

- [ ] **Step 5: Run the tests, expect pass,** then the web commands on the files of this task and
  `pnpm exec vitest run --maxWorkers=1 src/mocks/handlers src/lib/internal-links/queries.test.ts`.

- [ ] **Step 6: Commit.**
  `git add apps/web/src/lib/internal-links/types.ts apps/web/src/lib/internal-links/queries.ts apps/web/src/lib/pages/page-ai.ts apps/web/src/lib/pages/page-ai.test.tsx apps/web/src/mocks/internal-links-page-ai.ts apps/web/src/mocks/internal-links-page-ai.test.ts apps/web/src/mocks/handlers/internal-links.ts`
  then `git commit -m "Page AI tab: types, query, hook and mocked API"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Also: the mock is deterministic; its ids are real
  (a prompt id opens a real prompt in the mocked prompt inspector); the hook is the contract, not the route;
  no existing mock test changed.

- [ ] **Step 8: Fix what the review found**, rerun the commands, commit.

### Task 7: The pure helpers

Spec sections 9.2, 9.3, 12 (web, pure). Contract C5.

**Files:**
- Create: `apps/web/src/lib/pages/ai-model.ts`, `apps/web/src/lib/pages/ai-model.test.ts`

- [ ] **Step 1: Read first.** `lib/pages/outline-model.ts` and its test (the house shape of a pure model),
  `lib/format` (`formatInteger`, `formatSignedInteger`, `formatChartDate`, `formatBusinessDate`),
  `components/app/chart/chart-frame.tsx` (`CategorySeries`), `drawer-search-tab.tsx` (how it builds `series`).

- [ ] **Step 2: Write the failing tests** (`ai-model.test.ts`, no React):
  - `changeOf`: null when there is no compared period (`previous_answers === null`); null when the compared
    period had no answers; positive, negative and zero delta; `days` is the period length; `previous` is
    `previous_answers_citing`;
  - `trendOf`: one category per day in order; one series with the `answers_citing` values; `cellText` is
    "3 of 12 answers" (the text callback) for a day with answers and the "no answers" text for a day with none;
    the series id is stable;
  - `alongsideKind`: own and in crawl is `page`; own not in crawl is `own-outside`; competitor; third party;
  - `promptIdsOf` keeps the row order;
  - a date line helper `periodLine(ai)` returns the start and end `Date`s of the period and of the compared
    period (null when none) from the ISO strings, with no time zone drift (a date string is not parsed as UTC).

- [ ] **Step 3: Run them, expect failures.** **Step 4: Implement** the five functions, all pure, explicit return
  types, `text` callbacks for words (the module holds no message keys). **Step 5: Run the tests, expect pass,**
  then eslint, `pnpm typecheck` and prettier on the two files.

- [ ] **Step 6: Commit.** `git add apps/web/src/lib/pages/ai-model.ts apps/web/src/lib/pages/ai-model.test.ts`
  then `git commit -m "Page AI tab: the pure helpers"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Also: no rule lives in a component that belongs
  here (the change rule is `changeOf`, D19); no date is parsed with `new Date('2026-11-01')` (time zone drift).

- [ ] **Step 8: Fix what the review found**, rerun the commands, commit.

---

## Part C. Web: the screen

### Task 8: The prompt inspector opens from the three hosts

Spec sections 3 (D13), 9.6, 13. Contract C5 (`usePromptOpener`, `openPrompt`).

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/use-prompt-opener.ts`, `use-prompt-opener.test.tsx`
- Modify: `.../inspector/page-drawer-context.ts` (`openPrompt` in `PageDrawerContext` and in `drawerContextOf`)
- Modify: `apps/web/src/features/internal-links/pages-page/pages-screen.tsx`,
  `apps/web/src/features/internal-links/internal-links-screen.tsx`,
  `apps/web/src/features/internal-links/issues/issues-screen.tsx`
- Modify: `apps/web/src/app/[workspace]/[project]/seo/pages/page.tsx`, `.../pages/all/page.tsx`,
  `.../internal-links/page.tsx`, `.../issues/page.tsx`
- Modify: the tests of these files and the harnesses that build a `PageDrawerContext` or a screen's props
  (`src/test/pages-harness.tsx`, `src/test/internal-links-harness.tsx`, `src/test/issues-harness.tsx`,
  `page-drawer-context.test.ts`)

- [ ] **Step 1: Read first.** `features/citations/board-screen.tsx` (`promptDrawer`, `promptOrder`,
  `openPrompt`, the drawer choice around line 212, the `PromptOrderContext.Provider`),
  `app/[workspace]/[project]/ai/citations/citations-route.tsx`, `features/prompts/prompt-drawer-host.tsx`,
  `lib/inspector/prompt-order.ts`, `use-inspector.ts` (`open`, the `tab` option), the three screens where
  `PageInspector` is mounted and `InspectorLayout` is used, and the four route files.

- [ ] **Step 2: Write the failing tests.**
  - `use-prompt-opener.test.tsx`: `openPrompt('p1', ['p1','p2'])` sets `order` and the address to
    `inspect=prompt:p1` with `itab` absent, even when the page drawer was on its AI tab (`itab=ai`);
  - for each of the three screens: with the address `?inspect=prompt:p1` the screen renders the `promptDrawer`
    element and not the page drawer; with `?inspect=page:<id>` the page drawer shows as before; the page
    drawer's context offers `openPrompt`;
  - each of the four route tests renders the screen with a `promptDrawer` element (the test of the route checks
    the element is a `PromptDrawerHost` with the project's ids).

- [ ] **Step 3: Run them, expect failures.**

- [ ] **Step 4: Implement.** `usePromptOpener()` holds `useState<readonly string[]>([])` and returns `order` and
  `openPrompt = (promptId, ids) => { setOrder(ids); open({ type: 'prompt', id: promptId }, { tab:
  DEFAULT_INSPECTOR_TAB }); }` with `open` from `useInspector()` (a comment says why the first tab: the prompt
  inspector starts on its own first tab). Each screen takes the required prop `promptDrawer: ReactNode`, calls
  the hook, wraps its layout in `PromptOrderContext.Provider value={order}`, and where it chooses the drawer adds
  `inspector.target?.type === 'prompt' ? promptDrawer : <the page drawer as before>`. `PageDrawerContext` gets
  `openPrompt` (all three builders of the context set it). Each route builds `<PromptDrawerHost
  workspaceId={membership.workspace.workspace_id} workspaceSlug={membership.workspace.slug}
  projectId={current.project_id} projectSlug={current.slug} timeZone={current.timezone} />` and passes it, as
  `citations-route.tsx` does. Do not edit `features/prompts`, `components/app/inspector` or `lib/inspector`.

- [ ] **Step 5: Run the tests, expect pass,** then the web commands on every file of the task, and
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages-page src/features/internal-links/issues src/features/internal-links/internal-links-screen.test.tsx "src/app/[workspace]/[project]/seo"`
  one command at a time.

- [ ] **Step 6: Commit** the files of the task (list them with `git status`, stage by path) with
  `git commit -m "Page drawer: the prompt inspector opens from every host"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Also: no feature imports another feature (the
  route composes the host); the three screens do not copy the opener (one hook); the shared inspector files and
  `features/prompts` are untouched (`git show --stat HEAD`); a prompt replaces the page drawer and a page
  drawer's tab does not leak into the prompt (`itab` dropped); existing tests of the screens still test what
  they tested.

- [ ] **Step 8: Fix what the review found**, rerun the commands, commit.

### Task 9: The prompts card

Spec sections 9.2 (Prompts), 9.5, 10. Contract C5.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/ai-prompts-card.tsx`, `ai-prompts-card.test.tsx`
- Modify: `apps/web/messages/en.json` (`pages.drawer.ai.prompts.*`)

- [ ] **Step 1: Read first.** `AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`; invoke `design-taste-frontend`.
  `extras-sections.tsx` (`AnchorsBody`: the table classes `HEAD`, `ROW_HEAD`, `CELL`),
  `features/citations/drawers/page-drawer.tsx` (`PromptsCard`: the row button, the tooltip, the marks),
  `components/app/engine/engine-logo.tsx` (`nameDisplay="visually-hidden"`), `components/app/inspector/inspector-section.tsx`,
  `src/test/drawer-width-scan.ts` and `page-drawer-width.test.tsx`, `docs/glossary/final-list.md`.

- [ ] **Step 2: Write the failing tests** (Testing Library, no network: the card takes the `PageAi` as props).
  - renders a table with a caption, three column headers, one row per prompt, each prompt a button named by its
    text; the cited cell is `answers_citing` as a number;
  - the platforms cell shows one mark per platform that cited (zero citing platforms are not drawn), in engine
    order, each with its name for screen readers, and the tooltip text names each platform with "k of n";
  - clicking a row (and pressing Enter) calls `onOpenPrompt(promptId, ids)` with the ids of all rows in order;
  - the meta reads "3 of 3 prompts" and, when `prompts_total` exceeds the rows, "Showing 25 of 31 prompts";
  - no prompt: the section's empty text (`ai.prompts.emptyTitle` and `emptyReason`);
  - `expectNoPixelWidth` on the card at the three widths; axe finds nothing.

- [ ] **Step 3: Run them, expect failures.**

- [ ] **Step 4: Implement** `AiPromptsCard({ ai, onOpenPrompt })` on `InspectorSection` (title "Prompts that cited
  this page", `status` `empty` when no row). The first cell is `w-full max-w-0` and truncates; the number and
  mark cells are `whitespace-nowrap`; row height `h-row-compact`. Add `pages.drawer.ai.prompts.*` strings to
  `en.json` (keys of spec 10). Sentence case, ICU plurals, no dash.

- [ ] **Step 5: Look at a branded prompt.** With the mocked inspector open a prompt row of the mock's branded
  prompt from a rendered `PromptDrawerHost` (a test, or a quick render in the card test with the host mocked at
  the network layer) and note what the inspector's counts strip shows (`counts.row` is undefined for a branded
  prompt, spec 13). Do not change `features/prompts`. Put the observation in the commit body (one line).

- [ ] **Step 6: Run the tests, expect pass,** then the web commands on the files and
  `pnpm exec vitest run --maxWorkers=1 src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`.

- [ ] **Step 7: Commit.**
  `git add apps/web/src/features/internal-links/inspector/ai-prompts-card.tsx apps/web/src/features/internal-links/inspector/ai-prompts-card.test.tsx apps/web/messages/en.json`
  then `git commit -m "Page AI tab: the prompts card"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Also: row buttons have names that say what they
  open; the platform mark is never the only sign (name for screen readers, tooltip); nothing is a pixel width;
  the strings use "Platforms", "answers", "Cited" as the glossary writes them.

- [ ] **Step 9: Fix what the review found**, rerun the commands, commit.

### Task 10: The trend card and the cited with this page card

Spec sections 9.2, 9.5, 10. Contract C5.

**Files:**
- Create: `ai-trend-card.tsx`, `ai-trend-card.test.tsx`, `ai-alongside-card.tsx`, `ai-alongside-card.test.tsx`
  (all in `apps/web/src/features/internal-links/inspector/`)
- Modify: `apps/web/messages/en.json` (`pages.drawer.ai.trend.*`, `pages.drawer.ai.alongside.*`)

- [ ] **Step 1: Read first.** The rules documents and the skill as in Task 9. `drawer-search-tab.tsx` (the
  `ChartFrame` call, the box around it, `summary`, `formatChartDate`), `chart-frame.tsx` (`cellText`,
  `legendMarkers`), `docs/design-system/15-data-visualization.md` (bars, one series, the Table switch),
  `components/app/cells/domain-chip.tsx`, `lib/format` (`displayUrl`), `lib/pages/ai-model.ts` (Task 7).

- [ ] **Step 2: Write the failing tests.**
  - trend: renders the chart title and the line "Cited in 14 answers"; with a compared period the line adds
    "up 3 against the 28 days before (11)" (and "down" for a fall); with no compared period or none to compare
    the change is absent; a page cited in no answer says "Not cited in this period"; the Table switch shows a
    table whose cells read "3 of 12 answers" and "No answers" for an empty day; the chart's `summary` is a
    sentence with the totals and the dates;
  - alongside: an own page in the crawl is a button showing its path that calls `onOpenPage(String(url_id))`;
    an own page outside the crawl is text with its address and a domain chip and no button; a competitor shows
    the "Competitor" badge; a third party shows the address and the chip; the Answers cell has the tooltip "in 3
    of 5 answers"; "Showing 10 of 14 addresses" appears only when cut; the empty text;
  - `expectNoPixelWidth` on both cards at 480, 640 and 960; axe finds nothing in either.

- [ ] **Step 3: Run them, expect failures.**

- [ ] **Step 4: Implement** `AiTrendCard({ ai })` (a `ChartFrame kind="bar" variant="inspector" height={180}` in
  the Search tab's box; series and text from `trendOf`; the change line from `changeOf`; the dates from
  `periodLine`) and `AiAlongsideCard({ ai, onOpenPage })` on `InspectorSection` with a captioned table
  (`alongsideKind` decides the cell). Add the strings. Dates through `formatBusinessDate`, numbers through
  `formatInteger` and `formatSignedInteger`.

- [ ] **Step 5: Run the tests, expect pass,** then the web commands on the files and the two glossary and
  message tests as in Task 9.

- [ ] **Step 6: Commit.** Stage the four component files and `messages/en.json`, then
  `git commit -m "Page AI tab: the trend and the pages cited with this page"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Also: the chart follows doc 15 (one series,
  token colours, a Table with the same numbers, a `summary`); the change is a word and a sign, not colour alone;
  a domain chip and a badge wrap under the address at 480 px; no untrusted address is rendered as markup (text
  only, `displayUrl` and `DomainChip` do the escaping).

- [ ] **Step 8: Fix what the review found**, rerun the commands, commit.

### Task 11: The tab, its states, the printed basis, the words and the Google AI Mode label

Spec sections 3 (D6, D17, D20, D22), 9.1, 9.3, 9.4, 10. Contract C5.

**Files:**
- Create: `ai-basis.tsx`, `drawer-ai-tab.tsx`, `drawer-ai-tab.test.tsx` (in `.../inspector/`)
- Modify: `.../inspector/page-inspector.tsx` (the `ai` panel), `extras-sections.tsx` (no change of structure:
  only if a prop is needed), `apps/web/messages/en.json`
- Modify: the tests that quote the old strip strings: `extras-sections.test.tsx` and any test that finds
  "AI Mode" (`grep -rn "AI Mode" apps/web/src --include=*.test.tsx`)
- Modify: `docs/glossary/terms.md` (row E13, first), `docs/glossary/banned-words.json` (`ai-mode-bare`)
- Modify: `apps/web/src/features/internal-links/inspector/page-drawer-width.test.tsx` (the AI tab at the three
  widths)

- [ ] **Step 1: Read first.** The rules documents and the skill. `page-inspector.tsx` (the `panels.ai` entry),
  `drawer-search-tab.tsx` (how a tab handles loading, error, states with `Seam`), `components/app/status/empty-state.tsx`
  and `inline-error.tsx`, `docs/glossary/terms.md` (the E rows and their columns), `docs/glossary/final-list.md`,
  `docs/glossary/README.md` (the edit order: terms first, then the machine copy).

- [ ] **Step 2: Glossary first.** Add the row E13 "Cited with this page" to `terms.md` after E12 with the columns
  of spec 10. Check whether `final-list.md` lists card titles of the AI area and add the same words there if it
  does. Then add to `banned-words.json`:
  `{ "id": "ai-mode-bare", "pattern": "(?<!Google )\\bAI Mode", "flags": "", "use": "Google AI Mode" }`.

- [ ] **Step 3: Write the failing tests.**
  - `drawer-ai-tab.test.tsx` (MSW with the mocked handler, the pages of Task 6): the cited page shows the strip
    and the three cards in that order, with the printed period line "1 Nov to 28 Nov" style dates and the basis
    note; a click on a prompt row calls the context's `openPrompt` with the row ids; a click on an own page calls
    `openPage`; the quiet page shows the strip's sentence, the empty text of each card and "Not cited in this
    period"; `no_answers` and `no_prompts` show their one empty state and no cards; the error page shows one
    inline error and Retry refetches; while loading each card is a skeleton and no chart mounted;
  - the strip: the third cell label is "Google AI Mode"; `citationsTip` and `citationsBreakdown` say "Google AI
    Mode"; `extras-sections.test.tsx` and the other tests that read the old text are updated to it;
  - `page-drawer-width.test.tsx`: the AI tab holds no pixel width at 480, 640 and 960;
  - `src/i18n/messages.test.ts` and `src/lib/glossary/glossary-words.test.ts` pass with the new banned entry
    (before Step 5 the glossary test fails on the three old strings: that is the red).

- [ ] **Step 4: Run them, expect failures.**

- [ ] **Step 5: Implement.** `ai-basis.tsx`: `AiPeriod({ ai })` (the dates line and the compared dates) and
  `AiBasisNote()` (the footnote of spec 9.3). `drawer-ai-tab.tsx`: `DrawerAiTab({ context, urlId, detail,
  extras })`: renders the strip part (the `extras(['citations'], ...)` the page inspector builds, or its
  `ai.none` sentence for a total of zero, as today), then by `usePageAi(...)` state: loading, error, or the
  body; for `ready` the three cards then the basis note; for `no_prompts` and `no_answers` one `EmptyState`.
  `page-inspector.tsx`: the `ai` panel renders `DrawerAiTab`. Strings: `pages.drawer.ai.basis.*`,
  `pages.drawer.ai.state.*`; the three strip strings now say "Google AI Mode".

- [ ] **Step 6: Run the tests, expect pass,** then the web commands on the files, and one at a time:
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector`,
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages-page src/features/internal-links/issues`,
  `pnpm exec vitest run --maxWorkers=1 src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`.

- [ ] **Step 7: Commit.** Stage the files of the task (components, tests, `messages/en.json`, `terms.md`,
  `banned-words.json`, the changed existing tests) and
  `git commit -m "Page AI tab: the tab, its states, the words and the Google AI Mode label"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Also: every state of spec 9.4 is drawn and
  tested; the printed basis says what the code counts (D6) and the strip's own numbers are unchanged; the
  glossary row was added before the strings that use it; `ai-mode-bare` catches the old strings (the reviewer
  reverts one string in a scratch copy, or reasons from the pattern); the tab works with the page loading before
  the AI read answers; no word from the banned list.

- [ ] **Step 9: Fix what the review found**, rerun the commands, commit.

---

## Part D. Final checks

### Task 12: Final integration checks and the look at 1280 by 720

Spec sections 12 ("On the running app"), 15 (the whole checklist). Run by the lead or a Sonnet subagent, alone,
with nothing else running.

**Files:**
- Create: `apps/web/e2e/flows/page-ai-tab.spec.ts`

- [ ] **Step 1: Backend, targeted.**

```bash
colima status
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab/backend
uv run ruff check src/idraft/api/internal_links src/idraft/api/ai/citation_board_repository.py src/idraft/api/schemas/internal_links_ai.py tests/api/internal_links tests/api/ai/test_citing_observations.py tests/db/test_citations_url_index.py
uv run ruff format --check src/idraft/api/internal_links src/idraft/api/ai/citation_board_repository.py src/idraft/api/schemas/internal_links_ai.py tests/api/internal_links tests/api/ai/test_citing_observations.py tests/db/test_citations_url_index.py
uv run mypy src/idraft/api/internal_links src/idraft/api/ai src/idraft/api/schemas tests/api/internal_links tests/api/ai/test_citing_observations.py tests/db/test_citations_url_index.py
uv run lint-imports
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_ai_model.py
uv run pytest -n 0 --no-cov tests/api/ai/test_citing_observations.py tests/api/ai/test_citation_board_routes.py
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_ai.py
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_search.py tests/api/internal_links/test_page_outline.py tests/api/internal_links/test_page_extras.py tests/api/test_openapi.py tests/api/test_route_access.py
uv run pytest -n 0 --no-cov tests/db/test_citations_url_index.py
uv run python -m idraft.api.openapi | diff - openapi/v1.json
```

  Expected: all pass, and the `diff` prints nothing.

- [ ] **Step 2: Web, targeted.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab/apps/web
pnpm gen:api && git diff --exit-code src/lib/api/schema.ts
pnpm typecheck
pnpm exec eslint --max-warnings 0 src/lib/pages src/lib/internal-links src/features/internal-links src/mocks/internal-links-page-ai.ts src/mocks/handlers/internal-links.ts src/test "src/app/[workspace]/[project]/seo" e2e/flows/page-ai-tab.spec.ts
pnpm exec prettier --check src/lib/pages src/features/internal-links messages/en.json e2e/flows/page-ai-tab.spec.ts
pnpm exec vitest run --maxWorkers=1 src/lib/pages
pnpm exec vitest run --maxWorkers=1 src/lib/internal-links/queries.test.ts src/mocks/internal-links-page-ai.test.ts src/mocks/handlers
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages-page src/features/internal-links/issues
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/internal-links-screen.test.tsx src/features/internal-links/pages
pnpm exec vitest run --maxWorkers=1 "src/app/[workspace]/[project]/seo" src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts
```

  One command at a time. Expected: every one passes and `git diff --exit-code` prints nothing.

- [ ] **Step 3: Write the end-to-end spec** `e2e/flows/page-ai-tab.spec.ts` (house shape of
  `e2e/flows/internal-links.spec.ts`, `signIn` and the helpers of `e2e/support`). At a 1280 by 720 viewport on
  the mocked Eventus project: open All pages, open the cited page's drawer (`AI_CITED_PAGE`), go to the AI tab;
  expect the strip and the three card titles in order; the printed dates and the basis note; switch the trend to
  Table and read "3 of 12 answers" style cells; click a prompt row and expect `inspect=prompt:` in the address
  and the prompt inspector heading; go back to the page (browser Back or reopen) and click an own address and
  expect the drawer on that page; open the quiet page (zeros and "Not cited in this period"), the no answers
  page, the no prompts page, and the error page with Retry; at 480, 640 and 960 px drawer widths (use the
  drawer's keyboard resize or the saved width the other specs set) assert no horizontal scroll on the tab and
  `scrollWidth <= clientWidth`; take screenshots of the ready state at 1280 by 720 and at the three widths into
  `$SCRATCH/page-ai-tab/` (the session's scratchpad directory), not into the repository.

- [ ] **Step 4: The one build and the one e2e run.** Check first that nothing of another session holds the port:
  `lsof -nP -iTCP:3141 -sTCP:LISTEN` prints nothing (take the next free port above 3140 if it does). Then:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab/apps/web
E2E_PORT=3141 pnpm exec playwright test --project=e2e e2e/flows/page-ai-tab.spec.ts
```

  The configuration builds the app (`pnpm build`, the one build of this plan), prepares the standalone folder and
  serves it on the port with the test environment and the mocked API. Expected: the build succeeds, the spec
  passes. Look at the screenshots (Read them): the tab at 1280 by 720 and the three widths. Check by eye that
  nothing overlaps or clips, the chart and its bars read, the platform marks sit in a column, a long prompt
  truncates, and the badge and chip wrap under an address. If something is wrong, report the measured parts to
  the lead and fix in a follow-up commit; do not hide a control to pass. Afterwards `lsof -nP -iTCP:3141
  -sTCP:LISTEN` prints nothing (Playwright stops its own server; if one is left, stop only that one).

- [ ] **Step 5: No shared drawer file changed, no dash anywhere.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab
git diff --stat da677bd7..HEAD -- apps/web/src/components/app/inspector apps/web/src/lib/inspector apps/web/src/features/prompts apps/web/src/features/citations backend/src/idraft/api/resources.py backend/src/idraft/api/main.py
git diff da677bd7..HEAD | grep -nP '^\+.*[\x{2012}-\x{2015}]'
git log da677bd7..HEAD --format=%B | grep -i "co-authored\|generated with"
```

  Expected: all three print nothing. `ls backend/src/idraft/db/migrations/versions | tail -1` is still
  `0048_html_reader_version.py` unless Task 4 reported a needed migration and the lead agreed.

- [ ] **Step 6: Walk the acceptance checklist** of spec section 15 line by line and write, for each line, the
  test or the observation that proves it.

- [ ] **Step 7: Clean up.** From `$WT`: `rm -rf node_modules apps/web/node_modules backend/.venv apps/web/.next
  apps/web/test-results apps/web/playwright-report` (everything that was made by the installs, the build and
  the run; all can be rebuilt). `git status --short` shows only intended files. Remove scratch screenshots that
  are no longer needed. Never touch a worktree you did not create.

- [ ] **Step 8: Commit** the e2e spec:
  `git add apps/web/e2e/flows/page-ai-tab.spec.ts` then `git commit -m "Page AI tab: end-to-end check"`.

- [ ] **Step 9: Independent senior review (Sonnet subagent).** It is given the whole range
  `git log --oneline da677bd7..HEAD` and `git diff --stat da677bd7..HEAD`, spec sections 13 and 15, and the
  checklist of Step 6. It checks: nothing of spec 13 ("Not in this build") was built; the only changes to shared
  files are those of spec 14; every acceptance line has its proof; the commits are in the order backend, client,
  web; no attribution line in any commit message; no process, build folder or install is left.

- [ ] **Step 10: Fix what the review found**, rerun the steps the fix touches, commit. Then report to the lead:
  what passed, what was not run (the full suites, the visual snapshots, any other e2e spec), the known limits of
  spec 13 (no way back from the prompt inspector to the page drawer, branded prompt counts in the inspector, the
  inspector's own date range), and whether Task 4 needed migration `0049`. Do not merge and do not push.

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| 3 decisions D1, D2, D21 | 3 |
| D3 | 2 |
| D4, D5, D8 | 3 |
| D6 | 3 (count basis), 11 (printed basis) |
| D7 | 1, 2 |
| D9, D10 | 7, 10 |
| D11, D12 | 1, 9 |
| D13 | 8, 9 |
| D14, D15 | 1, 3, 10 |
| D16 | 3 |
| D17, D22 | 1, 11 |
| D18 | 4 (and 12, step 5) |
| D19 | 7, 10 |
| D20 | 11 |
| 4 API | 1, 3, 5 |
| 5 window and compare math | 1, 3 |
| 6 counting, platforms, ordering | 1, 3 |
| 7 own pages | 1, 3, 10 |
| 8 reads | 3 |
| 9 web | 6 to 11 |
| 10 words | 9, 10, 11 |
| 11 mocks | 6 |
| 12 tests | every task, 12 |
| 13 not in this build | 8, 9 (the branded look), 12 |
| 14 merge points | Rules, 5, 12 |
| 15 acceptance | 12 |
