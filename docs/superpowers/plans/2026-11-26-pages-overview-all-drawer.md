# Pages (Overview, All pages and the page drawer): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task by task. One subagent at a time, never two in parallel. Each task runs in a fresh context: the subagent
> reads "Rules for every task" and "Contracts" below, then its own task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Website audit page Pages of the real app: Overview at `/{workspace}/{project}/seo/pages`, All pages
at `/seo/pages/all`, and the page drawer with the tabs Overview, Search, Outline, Issues, AI, Links and Notes.

**Architecture:** One new backend module (`api/internal_links/inventory.py`) holds the words of spec section 4
as SQL, once. The Overview read counts with them and the pages list filters with them (`filter[view]`), so a
mark's number and its list's total come from the same predicate. On the web the existing Pages table and page
inspector of Internal links are not rewritten: they get narrow contexts, move under a new screen
(`features/internal-links/pages-page/`), and gain the View menu, the column groups and the drawer tabs. Pure
logic is in `src/lib/pages/`. What other sessions own (issues per page, tracking, the Search Console detail)
is a typed seam in `src/lib/pages/` that answers `unavailable` on this branch. The drawer's Outline tab (owner
addition of 2026-11-26, spec 9.6) is one read on demand: a pure parser in `backend/src/idraft/crawl/outline.py`
reads the page's stored HTML of the latest crawl, and nothing is stored. The drawer's Notes tab (owner addition
of 2026-11-26, spec 9.7) is full stack: a table `core.page_notes` keyed by project and URL, five routes with
audit entries, and the tab. The Notes box gets three helpers (owner addition of 2026-11-27, spec 9.8): at-sign
mentions and slash commands (a `mentions` column checked by type on the server, a combobox and chips on the
web, the issue source a seam) and file attachments (a judge of a file's type by its bytes, a table, a
quota, an upload route and an API-served download, the files in the existing raw bucket under `notes/`).

**Tech stack:** Python 3.13, FastAPI, SQLAlchemy Core (async), pytest with testcontainers Postgres, `uv`.
Next.js (App Router), React, TypeScript, TanStack Query, nuqs, next-intl, Tailwind v4 tokens, vitest with Testing
Library and MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-26-pages-overview-all-drawer-design.md`. Read the sections a task
names before starting it. The spec wins over this plan on what the product does; this plan wins on file names
and order.

---

## Rules for every task

- Work only in `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7`
  (branch `claude/pages-overview-all-drawer-f3d1f7`), called `$WT` below. Absolute paths in shell commands. Never
  touch the main checkout, `main`, `develop`, another worktree, or `apps/web/design-preview/`. No push, no merge.
- Read `AGENTS.md` at `$WT` first.
- Other sessions own these files. Do not edit them:
  - `apps/web/src/components/app/inspector/inspector.tsx`, `inspector-layout.tsx`, `use-inspector.ts` and
    everything in `apps/web/src/lib/inspector/` (the shared drawer session, `claude/shared-drawer-121ede`). The
    drawer always lies over the page. Add no width, no docking and no breakpoint for the page drawer.
  - Anything of the Issues session (`backend/src/idraft/api/issues/`, `apps/web/src/lib/issues/`,
    `apps/web/src/features/internal-links/issues/`) and of the Search Console and Monitoring session. In shared
    files (`registry.ts`, `messages/en.json`, `openapi/v1.json`, `terms.md`, `test_route_access.py`) add or
    change only the Pages entries.
- Write and change files with the Write and Edit tools, not shell heredocs.
- Follow the code around you. Check an existing helper before writing one. No `any`, explicit return types,
  specific errors. Comments say why, in one line.
- Machine load: run only the commands a task lists, one at a time, one worker. No full `pnpm test`, no
  `pnpm lint` of the whole app, no `./check.sh`, no e2e, no `pnpm build` (Task 27 runs it once), no dev server
  (Task 27 only). Leave no process running. Never start, stop or restart Colima or Docker: if
  `colima status` says it is not running, stop and tell the lead.
- Words: no em dash and no en dash anywhere (code comments, strings, tests, commit messages). Ranges are
  written "0 to 6". No exclamation marks. Before writing or changing a visible string read
  `docs/glossary/final-list.md`. Every visible string goes in `apps/web/messages/en.json`. Banned in visible
  text: "Monitored" (say "Tracked"), "GSC" (say "Search Console"), "Rankings" and "Ranking" as a noun, "Source"
  as a label, "No data", "N/A", "window" (say "the last 28 days").
- UI tasks (any task that changes a `.tsx` that renders): first read `AI_DEVELOPMENT_UI_RULES.md` and
  `DESIGN_SYSTEM.md` at `$WT`, then invoke the `design-taste-frontend` skill. The project's design system
  outranks the skill: keep the project's fonts, tokens, radii and spacing. No hex colours, no arbitrary
  Tailwind values, type utilities only, numbers through `@/lib/format`.
- Commit at the end of each task on this branch, with the message the task gives. No attribution lines.
  Stage only the files of the task (`git add <paths>`, never `git add -A`).

**Backend commands** (in every shell that runs pytest):

```bash
colima status
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/backend
uv run ruff check <the files you changed>
uv run ruff format --check <the files you changed>
uv run mypy src/idraft/api/internal_links src/idraft/api/schemas <the test files you changed>
# Tasks 5b to 5e name their own extra paths (src/idraft/crawl, src/idraft/storage, src/idraft/db, src/idraft/api/main.py).
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
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm exec eslint --max-warnings 0 <the files you changed>
pnpm typecheck
pnpm exec vitest run --maxWorkers=1 <the test files you changed or that cover your change>
pnpm exec prettier --check <the files you changed>
```

`pnpm typecheck` is `next typegen && tsc --noEmit`. Use it, not the bare `tsc`: the route pages use
`PageProps<'…'>`, which exists only after `next typegen`.

**The review steps.** Every task ends with the same two steps. The lead (the session that dispatches the
tasks) runs them, not the implementer:

1. *Independent senior review (Sonnet subagent).* A fresh Sonnet subagent is given: the task's text, the spec
   sections the task names, the output of `git show --stat HEAD` and `git show HEAD`, and this list. It checks
   that the diff does what the task and those spec sections say and nothing else; that every file touched is
   one the task names (and none of the forbidden files above); the repository rules (`AGENTS.md`, the house
   style of the files around); types and error handling; for UI: `AI_DEVELOPMENT_UI_RULES.md`,
   `DESIGN_SYSTEM.md`, keyboard reach, accessible names, focus after an action, colour never the only sign;
   visible words against `docs/glossary/final-list.md` and the banned list above; no em dash or en dash in a
   line the commit adds (`git show HEAD | grep -nP '^\+.*[\x{2012}-\x{2015}]'` prints nothing; lines that were
   already there are not this task's); the tests test behaviour and would fail
   without the change; the listed commands were run and passed. Each task adds what else its reviewer must
   look at. The reviewer reports findings with file and line, most serious first, and changes nothing.
2. *Fix what the review found.* A fresh Sonnet subagent (Haiku for a task marked Haiku) fixes every finding
   that is right, reruns the task's commands, and commits as `<the task's commit message> (review fixes)`. A
   finding that is wrong is answered in one line to the lead. The next task starts only after this.

## Contracts

These names are used by more than one task. A task that defines one says so; every other task uses it as
written here.

### C1. The words as SQL (spec section 4), `backend/src/idraft/api/internal_links/inventory.py`

`cp` is `crawl_pages`, `u` is `urls`, `BLOCKED` is `idraft.crawl.status.BLOCKED_STATUSES`.

| Word | Condition |
|---|---|
| counted | `cp.variant_of_url_id IS NULL` |
| variant | `cp.variant_of_url_id IS NOT NULL` |
| live | counted AND `cp.status_code = 200` AND `cp.resource_type = 'html'` |
| redirected | counted AND `cp.status_code BETWEEN 300 AND 399` |
| blocked | counted AND `cp.status_code IN BLOCKED` |
| client error | counted AND `cp.status_code BETWEEN 400 AND 499` AND NOT IN BLOCKED |
| server error | counted AND `cp.status_code BETWEEN 500 AND 599` |
| other | counted AND NOT (live OR redirected OR blocked OR client error OR server error), with a null status counted as other (`coalesce` the whole test to true) |
| indexable | live AND `cp.is_indexable` |
| reachable | live AND `cp.click_depth IS NOT NULL` |

### C2. `PageView` (defined in `backend/src/idraft/api/schemas/internal_links.py` beside `PageWorklist`)

| View id | Condition | Overview field with the same number |
|---|---|---|
| `live` | live | `status.live` |
| `indexable` | indexable | `indexable` |
| `not_indexable` | live AND NOT `is_indexable` | `not_indexable` |
| `redirects` | redirected | `status.redirected` |
| `errors` | client error OR server error | `status.client_error + status.server_error` |
| `client_errors` | client error | `status.client_error` |
| `server_errors` | server error | `status.server_error` |
| `blocked` | blocked | `status.blocked` |
| `other` | other | `status.other` |
| `variants` | variant (the filter then includes variants) | `status.variant` |
| `in_sitemap_indexable` | indexable AND `in_sitemap` | `sitemap.indexable_in_sitemap` |
| `not_in_sitemap` | indexable AND NOT `in_sitemap` | `sitemap.indexable_missing` |
| `sitemap_not_live` | counted AND `in_sitemap` AND NOT live | `sitemap.listed_not_live` |
| `sitemap_not_indexable` | live AND `in_sitemap` AND NOT `is_indexable` | `sitemap.listed_not_indexable` |
| `reachable` | reachable | `reachable` |
| `unreachable` | live AND `click_depth IS NULL` | `unreachable` |

`with_issues` and `tracked` are not in the literal on this branch: their sessions add them.

### C3. The section of a path (API definition)

`'/' || split_part(u.path, '/', 2) || '/'` when `split_part(u.path, '/', 3) <> ''`, else `'/'`. In words: a
page with one segment or none is in `/`, and a folder's own index (`/blog/`) is in `/` too.

| Path | Section |
|---|---|
| `/` | `/` |
| `/pricing` | `/` |
| `/blog/` | `/` |
| `/blog/post` | `/blog/` |
| `/blog/2026/post` | `/blog/` |

The web's `sectionOf` in `lib/internal-links/map-graph.ts` is another thing (the Link map's colour key, with
`home` and `top`). Do not use it for Pages.

### C4. API additions

- `GET …/internal-links/pages`: `filter[view]` (C2), `filter[folder]` (a section of C3, 1 to 200 characters),
  `filter[depth]` (0 to 6: reachable AND `least(click_depth, 6) = n`), sort keys `impressions` and
  `-impressions`. `PageFilter` gains `view`, `folder`, `depth` (all optional, default `None`).
- `GET …/internal-links/overview?run=latest` answering `PagesOverviewResponse` (spec 6.1).
- `GET …/internal-links/pages/{url_id}/search?run=latest` answering `PageSearchDailyResponse` (spec 9.5).
- `GET …/internal-links/pages/{url_id}/outline` answering `PageOutlineResponse` (spec 9.6.1, contract C6). It
  takes no `run`.
- The five note routes under `…/internal-links/pages/{url_id}/notes` and `PageDetail.notes_count` (spec 9.7.2,
  contract C7).

### C5. Web names

| Name | File | Shape |
|---|---|---|
| `PageView`, `PagesOverview`, `PageSearchDaily`, `PageOutline`, `PageOutlineBody` | `src/lib/internal-links/types.ts` | from the generated client |
| `PAGE_SORTS` | `src/lib/internal-links/page-sorts.ts` | moved from `features/internal-links/url-state.ts`, which re-exports it |
| `PageQuery` additions | `src/lib/internal-links/queries.ts` | `view: PageView \| null; folder: string \| null; depth: number \| null; includeVariants: boolean` |
| `overviewQuery(scope, run)`, `pageSearchQuery(scope, urlId, run)`, `pageOutlineQuery(scope, urlId)` | `src/lib/internal-links/queries.ts` | `apiQuery` options, as `worklistsQuery` |
| `pagesTabPath(workspace, project, tab?)` | `src/lib/routes/paths.ts` | `tab` is `'overview' \| 'all'`; default `'overview'` |
| `PAGES_TABS`, `PagesTabId` | `src/lib/pages/tabs.ts` | `overview`, `all`, `monitoring` |
| `PagesState`, `parsePagesSearch`, `PAGES_DEFAULT_SORT`, `PAGES_REDIRECT_KEYS` | `src/lib/pages/url-state.ts` | below |
| `Seam<T>`, `useIssueTotals`, `usePageIssues`, `ISSUE_COLUMNS_AVAILABLE`, `issueCountsOf` | `src/lib/pages/issue-source.ts` | spec 10.1 |
| `TRACKING_AVAILABLE`, `useTrackedPages`, `useTrackPages`, `TrackOutcome` | `src/lib/pages/tracking.ts` | spec 10.2 |
| `PageSearchDetailSlot` | `src/lib/pages/search-detail-slot.tsx` | spec 10.3 |
| `usePageSearchDaily(scope, run, urlId)` | `src/lib/pages/search-daily.ts` | `Seam<PageSearchDaily>`, never `unavailable` on this branch |
| `usePageOutline(scope, urlId, enabled)`, `OutlineRead` | `src/lib/pages/outline.ts` | `loading`, `error` (with `notFound: boolean` and `retry`) or `ready` with the `PageOutline` (Task 9) |
| `PAGE_DRAWER_TABS`, `PageDrawerTab`, `pageDrawerTab` | `src/lib/pages/drawer-tabs.ts` | `overview`, `search`, `outline`, `issues`, `ai`, `links`, `notes` (Task 23) |
| `PageNote`, `pageNotesQuery(scope, urlId)`, `NOTE_MAX` | `src/lib/internal-links/types.ts`, `queries.ts`, `src/lib/pages/notes.ts` | Task 25d |
| `usePageNotes`, `usePageNoteWrites`, `noteDraft`, `setNoteDraft`, `clearNoteDraft` | `src/lib/pages/notes.ts`, `note-drafts.ts` | Task 25d |
| `outlineModel`, `OutlineModel`, `OutlineFinding`, `OUTLINE_BLOCKS`, `HEADINGS_FOLDED` | `src/lib/pages/outline-model.ts` | Task 25b |
| `PAGE_VIEW_MENU`, `viewCounts` | `src/lib/pages/views.ts` | Task 10 |
| `overviewModel` | `src/lib/pages/overview-model.ts` | Task 10 |
| `PagesContext` | `src/features/internal-links/pages/pages-context.ts` | Task 11 |
| `PageDrawerContext` | `src/features/internal-links/inspector/page-drawer-context.ts` | spec 9.2 |
| `PagesScreen` | `src/features/internal-links/pages-page/pages-screen.tsx` | `{ workspaceId, workspaceSlug, project, tab: 'overview' \| 'all' }` |
| `pagesAs(role, tab, project?)` | `src/test/pages-harness.tsx` | as `internalLinksAs` |

```ts
// src/lib/pages/url-state.ts
export interface PagesState {
  /** The crawl the address chooses, or null for the latest; a malformed id is in `invalidRun`. */
  run: string | null;
  invalidRun: string | null;
  scope: LinkScope;
  /** `view` of the address as a server view, or as one of the six page worklists. Never both. */
  view: PageView | null;
  worklist: PageWorklist | null;
  sort: PageSort;
  q: string | null;
  depth: number | null;
  variants: boolean;
}
export type PagesKey = 'run' | 'scope' | 'view' | 'sort' | 'q' | 'depth' | 'variants' | 'inspect' | 'itab';
export const PAGES_DEFAULT_SORT: PageSort = 'path';
/** The keys only the old Pages tab of Internal links wrote (spec 5.3). */
export const PAGES_REDIRECT_KEYS: readonly string[] =
  ['view', 'sort', 'q', 'tier', 'tag', 'status', 'idx', 'flag', 'cols', 'density'];
export function parsePagesSearch(search: Readonly<Partial<Record<PagesKey, string | null | undefined>>>): PagesState;
```

The folder is not in `PagesState`: `folder` is a key of the filter bar (`useUrlFilters`), as `tier` and `status`
are, so an Overview link that writes `folder=/blog/` sets the Folder filter (Task 20).

### C6. The outline of one page (spec 9.6)

Backend names, defined in Task 5b (`backend/src/idraft/crawl/outline.py`) and used by Task 5c:

```python
LengthState = Literal["ok", "short", "long", "missing"]
TITLE_MIN: Final = 30
TITLE_MAX: Final = 60
DESCRIPTION_MIN: Final = 70
DESCRIPTION_MAX: Final = 160
THIN_WORDS: Final = 200
WORDS_PER_MINUTE: Final = 230
HTML_BYTES_MAX: Final = 2_000_000
HEADINGS_MAX: Final = 200
HEADING_TEXT_MAX: Final = 200
META_TEXT_MAX: Final = 1_000
HREF_MAX: Final = 2_048
HREFLANG_MAX: Final = 100
JSONLD_BLOCKS_MAX: Final = 20
JSONLD_BLOCK_CHARS_MAX: Final = 200_000
JSONLD_TYPES_MAX: Final = 10


@dataclass(frozen=True, slots=True)
class Heading:
    level: int
    text: str


@dataclass(frozen=True, slots=True)
class HreflangPair:
    code: str
    href: str
    is_self: bool
    valid: bool
    suggestion: str | None


@dataclass(frozen=True, slots=True)
class JsonLdBlock:
    types: tuple[str, ...]
    parses: bool


@dataclass(frozen=True, slots=True)
class ParsedOutline:
    description: str | None
    description_chars: int
    robots_meta: str | None
    html_lang: str | None
    headings: tuple[Heading, ...]
    headings_total: int
    level_counts: tuple[int, int, int, int, int, int]
    skipped_at: int | None
    hreflang: tuple[HreflangPair, ...]
    x_default: bool
    og_title: str | None
    og_description: str | None
    og_image: str | None
    og_type: str | None
    twitter_card: str | None
    jsonld: tuple[JsonLdBlock, ...]
    words: int
    images: int
    images_without_alt: int


EMPTY_OUTLINE: Final[ParsedOutline]  # what a page with nothing readable gives

def length_state(chars: int, low: int, high: int) -> LengthState: ...
def read_minutes(words: int) -> int: ...
def hreflang_valid(code: str) -> tuple[bool, str | None]: ...
def parse_outline(html: str, page_url: str) -> ParsedOutline: ...
```

API schemas, defined in Task 5c (`backend/src/idraft/api/schemas/internal_links_extra.py`), field for field
the table of spec 9.6.1:

```python
class OutlineText(BaseModel):
    text: str | None
    chars: int
    state: Literal["ok", "short", "long", "missing"]


class OutlineCanonical(BaseModel):
    state: Literal["self", "elsewhere", "none"]
    href: str | None


class OutlineRobots(BaseModel):
    meta: str | None
    noindex: bool


class OutlineHeading(BaseModel):
    level: int = Field(ge=1, le=6)
    text: str


class OutlineLanguagePair(BaseModel):
    code: str
    href: str
    is_self: bool
    valid: bool
    suggestion: str | None


class OutlineLanguages(BaseModel):
    x_default: bool
    pairs: list[OutlineLanguagePair]


class OutlineSocial(BaseModel):
    og_title: str | None
    og_description: str | None
    og_image: str | None
    og_type: str | None
    twitter_card: str | None


class OutlineStructuredBlock(BaseModel):
    types: list[str]
    parses: bool


class OutlineContent(BaseModel):
    words: int
    read_minutes: int
    thin: bool
    images: int
    images_without_alt: int


class PageOutlineBody(BaseModel):
    url: str
    truncated: bool
    title: OutlineText
    description: OutlineText
    canonical: OutlineCanonical
    robots: OutlineRobots
    html_lang: str | None
    headings: list[OutlineHeading]
    headings_total: int
    level_counts: list[int] = Field(min_length=6, max_length=6)
    skipped_at: int | None
    languages: OutlineLanguages
    social: OutlineSocial
    structured_data: list[OutlineStructuredBlock]
    content: OutlineContent


class PageOutline(BaseModel):
    state: Literal["ok", "redirect", "error", "not_html", "no_html"]
    run_id: UUID
    status_code: int | None
    outline: PageOutlineBody | None


class PageOutlineResponse(BaseModel):
    data: PageOutline
```

The check id of each finding (web, Task 25b) is the table "Findings" of spec 9.6.3. The ids are the Issues
session's and are written with hyphens (`title-short`).

### C7. Notes on a page (spec 9.7)

The table is `core.page_notes` exactly as spec 9.7.1 writes it (Task 5d); in `db/tables.py` it is `page_notes`.

API schemas, defined in Task 5e in a new file `backend/src/idraft/api/schemas/page_notes.py`:

```python
NOTE_MAX: Final = 2000


class PageNoteAuthor(BaseModel):
    id: UUID
    name: str


class PageNote(BaseModel):
    id: UUID
    author: PageNoteAuthor
    body: str
    created_at: datetime
    edited_at: datetime | None
    can_edit: bool
    can_delete: bool


class PageNoteWrite(BaseModel):
    """The body of a create and of a change. Trimmed, 1 to 2,000 characters, no null character."""
    body: str


class PageNoteResponse(BaseModel):
    data: PageNote


class PageNoteList(BaseModel):
    data: list[PageNote]
    meta: CursorPageInfo
```

`PageDetail` gains `notes_count: int = 0`. The default is on purpose: the generated web type is then
`notes_count?: number`, so the mocks and fixtures written before Task 25d still typecheck after Task 6. The
API always sends it; the web reads `detail.notes_count ?? 0`.

Routes (Task 5e), prefix `/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/notes`:
`GET ""` (`data:read`), `POST ""` (`notes:write`, 201), `PATCH "/{note_id}"` (`notes:write`),
`DELETE "/{note_id}"` (`notes:write`, 204), `POST "/{note_id}/restore"` (`notes:write`). Audit actions:
`page_note.created`, `page_note.updated`, `page_note.deleted`, `page_note.restored`.

### C7b. Mentions and files on a note (spec 9.8)

Defined by Tasks 5f, 5h and 5i in `backend/src/idraft/api/schemas/page_notes.py` (the C7 classes stay as
written; these are added):

```python
MENTIONS_MAX: Final = 20
FILES_MAX: Final = 5
MentionType = Literal["page", "user", "issue", "keyword"]


class PageNoteMentionIn(BaseModel):
    type: MentionType
    label: str   # 2 to 200 characters, starts with "@", no line break
    target: str  # 1 to 200 characters: url id, user id, check id or keyword text, by type


class PageNoteMention(PageNoteMentionIn):
    path: str | None = None   # the page's current path, set for type "page" only


class PageNoteFile(BaseModel):
    id: UUID
    name: str
    size: int
    content_type: str
    is_image: bool
    url: str                  # an API path, `file_path(workspace_id, project_id, url_id, id)`
```

`PageNote` gains `mentions: list[PageNoteMention] = []` and `attachments: list[PageNoteFile] = []`.
`PageNoteWrite` gains `mentions: list[PageNoteMentionIn] | None = None` (omitted on a change: the stored ones
whose label is still in the text stay) and `attachment_ids: list[UUID] | None = Field(default=None,
max_length=FILES_MAX)` (omitted on a change: the files are unchanged; given: the exact list of live files
afterwards). `PageNoteWrite.body` may be empty (Task 5i); the service refuses an empty body with no live file.
Error codes: `mention_target_unknown`, `mention_type_unavailable` (field errors at `mentions[i]`),
`too_many_attachments`, `quota_exceeded` (with `limit`, `used`, `requested`), `payload_too_large`,
`unsupported_media_type`, `storage_unavailable`. New audit action: `page_note.file_uploaded`.

Routes (Tasks 5h, 5i), prefix `/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}`:
`POST "/note-attachments"` (`notes:write`, multipart, one part `file`, `201`) and
`GET "/note-attachments/{attachment_id}"` (`data:read`, the bytes).

The table is `core.page_note_attachments` exactly as spec 9.8.5 writes it (Task 5h); in `db/tables.py` it is
`page_note_attachments`. The seam of the issue catalogue is `IssueChecks` and `NoIssueChecks` in
`backend/src/idraft/api/internal_links/mention_sources.py` (Task 5f). The judge is `sniff(data, name)` and
`FileRefused` in `backend/src/idraft/storage/file_sniff.py`, and the keys are `note_file_key` in
`storage/note_files.py` (Task 5g); limits come from `NOTE_FILE_MAX_BYTES` there and nowhere else.

### C7c. The box's web names (spec 9.8)

Defined by Task 25f in `apps/web/src/lib/pages/note-mentions.ts` and `note-files.ts` (pure), used by 25g to 25k.

```ts
export const MAX_SUGGESTIONS = 8;
export const MAX_MENTIONS = 20;
export type MentionType = 'page' | 'user' | 'issue' | 'keyword';
export interface NoteMention { type: MentionType; label: string; target: string; path?: string | null }
export type TriggerKind = 'at' | 'command' | 'page' | 'issue' | 'keyword';
export interface Trigger { start: number; kind: TriggerKind; query: string }
export type CommandName = 'page' | 'issue' | 'keyword' | 'date';
export type Suggestion =
  | { kind: 'mention'; mention: NoteMention; hint: string; detail: string | null }
  | { kind: 'command'; name: CommandName };
export interface SuggestionSources {
  teammates: readonly { id: string; name: string }[];
  pages: readonly { id: string; path: string; title: string | null }[];
  issues: readonly { checkId: string; name: string }[];
  keywords: readonly string[];
}
/** The trigger the caret is in, or null: `@` or `/` that starts a word. */
export function triggerAt(text: string, caret: number): Trigger | null;
export function suggestionsFor(trigger: Trigger, sources: SuggestionSources): readonly Suggestion[];
/** Replaces the trigger and its typed word with `insert` and one space; returns the new text and caret. */
export function applySuggestion(text: string, trigger: Trigger, insert: string): { text: string; caret: number };
/** The entries whose label is still in `text`, first of each label, in order. */
export function keptMentions(text: string, mentions: readonly NoteMention[]): NoteMention[];
export type NoteSegment = { kind: 'text'; text: string } | { kind: 'mention'; mention: NoteMention };
export function splitNoteText(body: string, mentions: readonly NoteMention[]): NoteSegment[];

// note-files.ts
export const NOTE_FILES_MAX = 5;
export const NOTE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export type FileRefusal = { kind: 'count' } | { kind: 'type'; name: string } | { kind: 'size'; name: string };
export function checkNewFiles(have: number, incoming: readonly File[]): { accepted: File[]; refused: FileRefusal[] };
```

The sources come from `useNoteSources(scope, urlId, query, enabled)` in `lib/pages/note-sources.ts` (25g); the
upload from `useNoteFileUpload(scope, urlId)` in `lib/pages/note-uploads.ts` (25j), which rejects with a
`NoteFileRefusal` (`size`, `type`, `quota`, `storage` or `failed`).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/idraft/api/internal_links/inventory.py` | C1, C2, C3 as SQL; the overview aggregate | 1, 2, 3 |
| `backend/src/idraft/api/schemas/internal_links.py` | `PageView`, `PageFilter.view/folder/depth`, `PageSort` | 1, 2, 4 |
| `backend/src/idraft/api/internal_links/page_filter.py` | applies view, folder, depth | 1, 2 |
| `backend/src/idraft/api/internal_links/read_routes.py` | the three parameters and the three routes | 1, 2, 3, 5, 5c |
| `backend/src/idraft/api/schemas/internal_links_extra.py` | overview and search schemas | 3, 5 |
| `backend/src/idraft/api/internal_links/reads.py` | `LinkReadService.overview`, `.page_search`, `.page_outline`, `_sorter` | 3, 4, 5, 5c |
| `backend/src/idraft/api/internal_links/page_sort.py` | the sort `impressions` | 4 |
| `backend/src/idraft/api/internal_links/extras.py` | `page_search_daily` | 5 |
| `backend/tests/api/internal_links/support_inventory.py`, `test_inventory.py`, `test_page_search.py` | tests | 1 to 5 |
| `backend/src/idraft/crawl/outline.py`, `lang_codes.py`, `backend/tests/crawl/test_outline.py` | the pure reader of a page's HTML (C6), shared with the Issues session | 5b |
| `backend/src/idraft/storage/raw.py` | `inflate_head`: the first bytes of a stored object | 5c |
| `backend/src/idraft/api/internal_links/outline.py`, `reads.py`, `read_routes.py`, `backend/src/idraft/api/main.py` | the outline read; the read service takes the object store | 5c |
| `backend/tests/api/internal_links/test_page_outline.py` | its tests | 5c |
| `backend/src/idraft/db/migrations/versions/0042_page_notes.py`, `db/tables.py`, `backend/tests/db/*`, `docs/04-data-model.md` | the table `core.page_notes` (C7) | 5d |
| `backend/src/idraft/api/schemas/page_notes.py`, `api/internal_links/page_notes.py`, `page_note_routes.py`, `api/audit.py`, `api/main.py` | the note reads and writes, audited | 5e |
| `backend/src/idraft/api/schemas/internal_links.py`, `reads.py` | `PageDetail.notes_count` | 5e |
| `backend/tests/api/internal_links/test_page_notes.py`, `docs/19-api-specification.md`, `docs/24-security.md` | tests; the two docs that name `notes:write` | 5e |
| `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json` | eight rows; regenerated | 1 to 5e |
| `apps/web/src/lib/api/schema.ts` | regenerated client, own commit | 6 |
| `apps/web/src/lib/internal-links/{types,queries,page-sorts}.ts` | types, reads, sorts | 7 |
| `apps/web/src/mocks/internal-links-inventory.ts`, `internal-links-outline.ts`, `mocks/handlers/internal-links.ts` | the mocked API | 8 |
| `apps/web/src/lib/pages/*.ts(x)`, `lib/routes/paths.ts` | tabs, address, seams, views, overview model | 9, 10 |
| `apps/web/src/features/internal-links/pages/pages-context.ts`, `inspector/page-drawer-context.ts` | narrow contexts | 11 |
| `apps/web/src/features/internal-links/crawl-shell.tsx`, `crawl-header.tsx` | the crawl shell both screens use; the one-line header | 12 |
| `apps/web/src/features/internal-links/pages-page/*` | the screen and the Overview | 13, 21, 22 |
| `apps/web/src/app/[workspace]/[project]/seo/pages/**` | the two routes | 14 |
| `apps/web/src/lib/navigation/registry.ts` | `pages` is `live` | 14 |
| `apps/web/src/test/pages-harness.tsx` | test harness | 13 |
| `apps/web/src/features/internal-links/{tabs.ts,url-state.ts,internal-links-screen.tsx}`, `seo/internal-links/page.tsx` | the tab leaves, the redirect | 16 |
| `apps/web/src/components/app/data-table/{types.ts,toolbar.tsx,data-table.tsx,column-chooser.tsx}` | `toolbarStart`, chooser groups | 17 |
| `apps/web/src/features/internal-links/pages/*` | the table's changes | 11, 18 to 20 |
| `apps/web/src/features/internal-links/inspector/*` | the tabbed drawer | 11, 23 to 25e |
| `apps/web/src/lib/pages/outline.ts`, `outline-model.ts` | the Outline's read and its pure model | 9, 25b |
| `apps/web/src/features/internal-links/inspector/drawer-outline-tab.tsx`, `outline-block.tsx`, `outline-blocks.tsx`, `outline-more-blocks.tsx` | the Outline tab | 25b, 25c |
| `docs/design-system/16-drawers-dialogs-popovers.md` | one sentence: the Outline's cards fold | 25b |
| `docs/glossary/terms.md`, `final-list.md` | the rows Outline, Notes and Add note, in their own commit | 23 |
| `apps/web/src/lib/pages/notes.ts`, `note-drafts.ts`, `apps/web/src/mocks/internal-links-notes.ts` | the notes' reads, writes, drafts and mocks | 25d |
| `apps/web/src/features/internal-links/inspector/drawer-notes-tab.tsx`, `note-editor.tsx`, `note-item.tsx` | the Notes tab | 25e |
| `backend/src/idraft/db/migrations/versions/0043_page_note_mentions.py`, `api/internal_links/mention_sources.py`, `page_note_mentions.py`, `schemas/page_notes.py`, `page_notes.py` | mentions: the column, the issue seam, the checks by type | 5f |
| `backend/src/idraft/storage/file_sniff.py`, `storage/note_files.py`, `backend/tests/storage/test_file_sniff.py`, `test_note_files.py` | the judge of a file's type by its bytes; the keys and storage of note files | 5g |
| `backend/src/idraft/db/migrations/versions/0044_page_note_attachments.py`, `db/tables.py`, `api/body_limit.py`, `api/internal_links/page_note_files.py`, `page_note_file_routes.py`, `backend/tests/db/test_page_note_attachments_schema.py`, `tests/api/internal_links/test_page_note_files.py` | the table of note files, the quota, the upload | 5h |
| `backend/src/idraft/api/internal_links/page_notes.py`, `page_note_files.py`, `page_note_file_routes.py`; `docs/19`, `docs/23`, `docs/24`, `docs/27` | attach, answer with files, serve | 5i |
| `apps/web/src/lib/api/schema.ts` | regenerated client, second own commit | 6b |
| `apps/web/src/lib/pages/note-mentions.ts`, `note-files.ts` | the box's pure logic (C7c) | 25f |
| `apps/web/src/lib/pages/note-sources.ts`, `notes.ts`, `note-drafts.ts`, `apps/web/src/mocks/internal-links-notes.ts` | mention sources, writes, drafts, mocked rules | 25g |
| `apps/web/src/features/internal-links/inspector/note-suggest-list.tsx`, `note-editor.tsx` | the combobox | 25h |
| `apps/web/src/features/internal-links/inspector/note-text.tsx`, `note-chip.tsx`, `note-item.tsx` | chips in a saved note | 25i |
| `apps/web/src/lib/pages/note-uploads.ts`, mocks and handlers of the file routes | files: upload, refusals, mocked routes | 25j |
| `apps/web/src/features/internal-links/inspector/note-files-bar.tsx`, `note-file-list.tsx`, `drawer-notes-tab.tsx` | the file controls and the files under a note | 25k |
| `apps/web/messages/en.json`, `docs/design-system/11-navigation.md` | words (added by each UI task; audited in 26) | 13 to 26 |

---

## Part A. Backend

### Task 1: The words as SQL and `filter[view]` on the pages list

Spec sections 4, 6.2 (first three bullets), 7.3 (the paragraph "Server"), 12. Contracts C1, C2.

**Files:**
- Create: `backend/src/idraft/api/internal_links/inventory.py`
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`PageView`, `PageFilter`)
- Modify: `backend/src/idraft/api/internal_links/page_filter.py` (`page_conditions`)
- Modify: `backend/src/idraft/api/internal_links/read_routes.py` (`list_pages`)
- Create: `backend/tests/api/internal_links/support_inventory.py`, `backend/tests/api/internal_links/test_inventory.py`
- Modify: `backend/openapi/v1.json` (regenerated)

- [ ] **Step 1: Read first.** `page_filter.py` whole, `status_filter.py`, `backend/src/idraft/crawl/status.py`,
  `read_routes.py` (`list_pages`), `tests/api/internal_links/support.py` (`seed_crawl`, `set_counts`,
  `read_site`), `tests/api/internal_links/test_variants.py` (how a test sets `variant_of_url_id` and
  `is_indexable` with an `UPDATE`), `tests/api/internal_links/test_page_sort_extra.py` (`_site`, `_walk`, the
  `member` helper).

- [ ] **Step 2: The seeded crawl.** `support_inventory.py` exports

```python
async def inventory_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, *, sitemap: bool = True
) -> tuple[uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A finished crawl with one known case of each word of spec section 4. Returns the run id, the url ids
    by path and the tier ids."""
```

  It calls `seed_tiers` and `seed_crawl`, then sets the columns `seed_crawl` leaves at their defaults with
  `UPDATE seo.crawl_pages … WHERE run_id = $1 AND url_id = $2`, and `seo.crawl_runs.sitemap_pages` (a number
  when `sitemap`, null when not). The pages, exactly:

| Path | status | resource_type | is_indexable | in_sitemap | click_depth | is_orphan | other |
|---|---|---|---|---|---|---|---|
| `/` | 200 | html | true | true | 0 | false | |
| `/pricing` | 200 | html | true | true | 1 | false | tier 1 (manual) |
| `/blog/` | 200 | html | true | false | 1 | false | |
| `/blog/a` | 200 | html | true | true | 2 | false | tier 3 (manual) |
| `/blog/b` | 200 | html | false | true | 2 | false | `non_indexable_reason = 'noindex'` |
| `/blog/deep` | 200 | html | true | false | 9 | false | |
| `/docs/lost` | 200 | html | true | false | null | true | |
| `/blog/a-variant` | 200 | html | false | true | 2 | false | `variant_of_url_id` and `canonical_url_id` = `/blog/a` |
| `/old` | 301 | redirect | false | true | 3 | false | `redirect_url_id` = `/pricing` |
| `/gone` | 404 | broken | false | true | 3 | false | |
| `/down` | 500 | broken | false | false | null | true | |
| `/private` | 403 | broken | false | false | null | false | |
| `/file.pdf` | 200 | other | false | false | 2 | false | |
| `/unknown` | null | other | false | false | null | false | |

  `seed_crawl` takes `(path, status)` pairs with an `int` status: give `/unknown` 200 there and set its
  `status_code` to null in the update. The expected numbers, as a module constant the tests import:

```python
EXPECTED: Final = {
    "addresses": 14,
    "live": 7, "variant": 1, "redirected": 1, "client_error": 1, "server_error": 1, "blocked": 1, "other": 2,
    "indexable": 6, "not_indexable": 1, "reachable": 6, "unreachable": 1, "orphans": 2,
    "indexable_in_sitemap": 3, "indexable_missing": 3, "listed_not_live": 2, "listed_not_indexable": 1,
}
```

  Work each number out by hand from the table before trusting it, and correct the constant if the table says
  otherwise (the table is the truth).

- [ ] **Step 3: Write the failing tests** in `test_inventory.py`. One test per line:
  - for each view of `PageView` (parametrized), `GET …/internal-links/pages?filter[view]=<view>&scope=all`
    as a viewer answers 200 and `meta.total` equals the number C2 maps it to in `EXPECTED`;
  - `filter[view]=variants` lists `/blog/a-variant` without `filter[include_variants]`;
  - `filter[view]=live` with `filter[worklist]=orphans` is `422`;
  - an unknown view is `422`;
  - `format=csv` with `filter[view]=redirects` has the header and exactly the row of `/old`;
  - `filter[view]=errors&q=/go` lists only `/gone` (a view narrows, the search applies on top);
  - a member of another workspace gets `404` for the project.

- [ ] **Step 4: Run them, expect failures.**
  `uv run pytest -n 0 --no-cov tests/api/internal_links/test_inventory.py` fails on the unknown parameter.

- [ ] **Step 5: Implement.**
  - `schemas/internal_links.py`: `PageView = Literal[…the 16 ids of C2, in that order…]` beside `PageWorklist`.
    `PageFilter` gains `view: PageView | None = None` and a `model_validator(mode="after")` that raises
    `ValueError("give one of `view` and `worklist`, not both")` when both are set (this is the `422` of a bulk
    body).
  - `inventory.py`, with a module docstring that names the spec section:

```python
def view_condition(view: PageView) -> ColumnElement[bool]: ...
```

    The words of C1 are private functions of this module (`_counted()`, `_live()`, `_redirected()`,
    `_blocked()`, `_client_error()`, `_server_error()`, `_other()`, `_indexable()`, `_reachable()`), one
    definition each, and `view_condition` is a lookup over them. Reuse `BLOCKED_STATUSES`; do not write the
    three codes again.
  - `page_filter.py` `page_conditions`: after the flags, `if found.view is not None:
    conditions.append(view_condition(found.view))`; the variants line becomes "leave variants out unless
    `include_variants`, the `variant` flag, or `view == "variants"`".
  - `read_routes.py` `list_pages`: parameter
    `view: Annotated[PageView | None, Query(alias="filter[view]")] = None`. Before `PageFilter(...)` is built:
    when `view` and `worklist` are both given, raise
    `RequestValidationError([{"loc": ("query", "filter[view]"), "type": "view_with_worklist", "msg": "Give `filter[view]` or `filter[worklist]`, not both."}])`
    (the pattern of `_query_error` in `tier_levels.py`; a `ValueError` from the model here would be a 500).
    Pass `view=view` into `PageFilter`.

- [ ] **Step 6: Run the tests, expect pass.** Then the pages tests that share the filter, to prove nothing
  moved: `uv run pytest -n 0 --no-cov tests/api/internal_links/test_inventory.py tests/api/internal_links/test_reads_pages.py tests/api/internal_links/test_variants.py tests/api/internal_links/test_blocked_pages.py`.

- [ ] **Step 7: Regenerate the OpenAPI document and run the backend commands** of "Rules for every task" on
  the files of this task.

- [ ] **Step 8: Commit.**
  `git add backend/src/idraft/api/internal_links/inventory.py backend/src/idraft/api/internal_links/page_filter.py backend/src/idraft/api/internal_links/read_routes.py backend/src/idraft/api/schemas/internal_links.py backend/tests/api/internal_links/support_inventory.py backend/tests/api/internal_links/test_inventory.py backend/openapi/v1.json`
  then `git commit -m "Pages API: the page views as one predicate, filter[view] on the pages list"`.

- [ ] **Step 9: Independent senior review (Sonnet subagent).** Besides the common list: each condition of
  `inventory.py` against the table of spec section 4, word by word (blocked is not a client error; a null
  status is `other`; live needs `resource_type = 'html'`); every address of the seeded crawl falls in exactly
  one of the seven status groups; `EXPECTED` recomputed by hand from the table; the bulk bodies
  (`page_tiers.py`) still build their `PageFilter` unchanged.

- [ ] **Step 10: Fix what the review found**, rerun the commands, commit.

### Task 2: `filter[folder]` and `filter[depth]`

Spec 7.4. Contracts C3, C4.

**Files:**
- Modify: `backend/src/idraft/api/internal_links/inventory.py` (`section_of`, `depth_bucket`)
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`PageFilter.folder`, `.depth`)
- Modify: `backend/src/idraft/api/internal_links/page_filter.py`, `read_routes.py`
- Modify: `backend/tests/api/internal_links/test_inventory.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Write the failing tests** (the crawl of `inventory_site`, viewer, `scope=all`):
  - `filter[folder]=/blog/` lists exactly `/blog/a`, `/blog/b`, `/blog/deep` (the variant is left out as
    everywhere; `/blog/` itself is in `/`);
  - `filter[folder]=/` lists the pages C3 puts in `/` (`/`, `/pricing`, `/blog/`, `/old`, `/gone`, `/down`,
    `/private`, `/file.pdf`, `/unknown`);
  - `filter[view]=live&filter[folder]=/blog/` has `meta.total` 3;
  - `filter[depth]=2` lists `/blog/a`, `/blog/b` (live and at depth 2; `/file.pdf` is not live);
  - `filter[depth]=6` lists `/blog/deep` (depth 9 lands in "6 and more");
  - `filter[depth]=7` and `filter[depth]=-1` are `422`; a folder of 201 characters is `422`.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**

```python
def section_of() -> ColumnElement[str]:
    """The first folder of the path (C3 of the plan, spec section 4): `/blog/` for `/blog/post`, `/` for a
    page with one segment or none."""

def depth_bucket() -> ColumnElement[int]:
    """`least(click_depth, 6)`: the row 6 is 6 clicks and more."""
```

  `section_of` must give every row of the C3 table; write it with `func.split_part(urls.c.path, "/", 2)` and
  `func.split_part(urls.c.path, "/", 3)` in a `case`. `PageFilter` gains
  `folder: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None` and
  `depth: Annotated[int, Field(ge=0, le=6)] | None = None`. `page_conditions` appends
  `section_of() == found.folder` and, for depth, the reachable condition of C1 and
  `depth_bucket() == found.depth`. `list_pages` gains
  `folder: Annotated[str | None, Query(alias="filter[folder]", min_length=1, max_length=200)] = None` and
  `depth: Annotated[int | None, Query(alias="filter[depth]", ge=0, le=6)] = None`, passed into `PageFilter`.
  Add a unit test of `section_of` over the five rows of C3 through one `SELECT` on seeded `core.urls` rows
  (the helper `url_id` of `support.py` makes them).

- [ ] **Step 4: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands.**

- [ ] **Step 5: Commit.** `git commit -m "Pages API: filter[folder] and filter[depth] on the pages list"` with
  the five files staged by path.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: `section_of` against
  each row of C3; depth counts only reachable (live) pages, as the Overview's depth card will; the cursor of
  the list still carries the filter (`cursor_scope` uses `found.model_dump`, so a new field is in it without
  a change: confirm by reading `reads.py` `pages`).

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 3: The Overview read

Spec 6.1, 6.2, decisions D7 and D8, section 12. Contracts C1 to C4.

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py` (schemas)
- Modify: `backend/src/idraft/api/internal_links/inventory.py` (`overview_statement`)
- Modify: `backend/src/idraft/api/internal_links/reads.py` (`LinkReadService.overview`)
- Modify: `backend/src/idraft/api/internal_links/read_routes.py` (`@router.get("/overview")`)
- Modify: `backend/tests/api/test_route_access.py` (one row), `backend/tests/api/internal_links/test_inventory.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Read first.** `reads.py` (`LinkReadService._transaction`, `worklists`, `read_scope`,
  `load_tiers`, `Tiers.ref`), `page_filter.py` (`page_rows`), `schemas/internal_links.py` (`TierCount`,
  `TierRef`), `tests/api/test_route_access.py` (the rows of `internal-links`).

- [ ] **Step 2: Write the failing tests.**
  - `GET …/internal-links/overview` as a viewer on `inventory_site` answers 200; every number of `EXPECTED`
    equals its field (the mapping of C2, plus `addresses` and `orphans`);
  - the invariants of spec section 12: the seven status groups add up to `addresses`; `indexable +
    not_indexable == status.live`; `reachable + unreachable == status.live`; the seven depth rows add up to
    `reachable`, there are always 7, and row 6 holds `/blog/deep`; the tiers add up to `status.live` and the
    Untiered entry has `tier: null`; a tier with no live page is absent; the sections add up to `status.live`,
    are sorted largest first then by name in byte order, and `sections_total` is their count;
    `sitemap.indexable_in_sitemap + sitemap.indexable_missing == indexable`;
  - D8: for every view of `PageView` (parametrized) the overview's number equals `meta.total` of
    `GET …/pages?filter[view]=<view>&scope=all` on the same crawl;
  - `orphans` equals `meta.total` of `filter[worklist]=orphans`;
  - with `inventory_site(…, sitemap=False)`: `sitemap.state` is `no_sitemap`, the four counts are null;
  - `crawled_at` is the crawl's `finished_at`; `run_id` is the crawl's id; `run=<id of an older crawl>`
    answers that crawl's numbers (seed a second crawl with `seed_crawl`);
  - before any finished crawl: `404` with code `no_crawl`; a project of another workspace: `404 not_found`;
    a role without `data:read` is refused (copy how `test_reads_isolation.py` asserts both).

- [ ] **Step 3: Run, expect failures (404 on the route).**

- [ ] **Step 4: Schemas**, in `internal_links_extra.py` after `ChangesSummaryResponse`:

```python
class OverviewStatus(BaseModel):
    live: int
    variant: int
    redirected: int
    client_error: int
    server_error: int
    blocked: int
    other: int


class OverviewSitemap(BaseModel):
    state: Literal["read", "no_sitemap"]
    indexable_in_sitemap: int | None
    indexable_missing: int | None
    listed_not_live: int | None
    listed_not_indexable: int | None


class OverviewDepth(BaseModel):
    clicks: int = Field(description="0 to 6; 6 is 6 clicks and more.")
    pages: int


class OverviewSection(BaseModel):
    section: str = Field(description="The first folder of the path, `/` for a top-level page.")
    pages: int


class PagesOverview(BaseModel):
    run_id: UUID
    crawled_at: datetime | None
    addresses: int
    status: OverviewStatus
    indexable: int
    not_indexable: int
    reachable: int
    unreachable: int
    orphans: int
    sitemap: OverviewSitemap
    depth: list[OverviewDepth]
    tiers: list[TierCount]
    sections: list[OverviewSection]
    sections_total: int


class PagesOverviewResponse(BaseModel):
    data: PagesOverview
```

  Import `TierCount` from `schemas/internal_links.py`.

- [ ] **Step 5: The aggregate**, in `inventory.py`:

```python
SECTIONS_MAX: Final = 50

def overview_statement(scope: PageScope) -> Select[Any]:
    """One row: `addresses`, one `count(*) FILTER (WHERE view_condition(view))` per view of PageView
    (labelled with the view id), `orphans`, and `depth_0` to `depth_6`."""
```

  It selects from `crawl_pages JOIN urls` of the run (`workspace_id` and `run_id` both named, as every
  statement here). `orphans` is `_counted() AND crawl_pages.c.is_orphan`. Each depth column is the reachable
  condition AND `depth_bucket() == n`.

- [ ] **Step 6: The service**, `LinkReadService.overview(self, access, project_id, *, run: UUID | None) -> PagesOverview`,
  inside `self._transaction(access)`: `read_scope`; `load_tiers`; the aggregate row; a grouped count of live
  pages by `project_pages.c.tier_id` over `page_rows(scope)`; a grouped count of live pages by `section_of()`
  ordered by count descending then `collate(section, "C")`, limit `SECTIONS_MAX`; a count of distinct
  sections of live pages; the `crawl_runs` row (`sitemap_pages`, `finished_at`). `sitemap.state` is
  `no_sitemap` when `sitemap_pages` is null or 0, and the four counts are then `None`. Order the tiers by
  position with Untiered last (`Tiers.positions`).

- [ ] **Step 7: The route** in `read_routes.py`, after `worklists`:

```python
@router.get("/overview", summary="Counts of a crawl's pages for the Pages overview")
async def overview(
    project_id: UUID, access: ReadData, reads: Reads, run: Run = "latest"
) -> PagesOverviewResponse:
    return PagesOverviewResponse(data=await reads.overview(access, project_id, run=_run(run)))
```

  and the row in `tests/api/test_route_access.py` beside `internal-links/worklists`:
  `("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/overview"): ("data:read"),`.

- [ ] **Step 8: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands.**

- [ ] **Step 9: Commit.** `git commit -m "Pages API: the overview read of a crawl's pages"` with the seven
  files staged by path.

- [ ] **Step 10: Independent senior review (Sonnet subagent).** Besides the common list: the number of
  statements (at most five after `read_scope` and `load_tiers`) and that all run in the one transaction;
  no count is computed by a second definition of a word (everything goes through `view_condition` or the
  private words of `inventory.py`); the D8 test really compares the two routes for all 16 views; the
  route-access row exists; nothing computes an issue total (spec 6.3).

- [ ] **Step 11: Fix what the review found**, rerun, commit.

### Task 4: The sort `impressions`

Spec 7.2 (the paragraph "Backend change for this section").

**Files:**
- Modify: `backend/src/idraft/api/internal_links/page_sort.py`, `reads.py` (`_sorter`),
  `backend/src/idraft/api/schemas/internal_links.py` (`PageSort`)
- Modify: `backend/tests/api/internal_links/test_page_sort_extra.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Write the failing test**, a copy of
  `test_clicks_sort_by_google_clicks_and_are_all_equal_without_a_property` named
  `test_impressions_sort_by_google_impressions_and_are_all_equal_without_a_property`: without a property
  `-impressions` orders by page id only; with `gsc_property` and two `fp.gsc_page_daily` rows (`/c` 900
  impressions and 1 click, `/e` 400 impressions and 5 clicks, so the order differs from the clicks order)
  `-impressions` starts `/c`, `/e`, `impressions` ends `/e`, `/c`; `_walk` with `limit=2` returns every page
  once (paging over the tie of the four pages with 0).

- [ ] **Step 2: Run, expect `422` (unknown sort).**

- [ ] **Step 3: Implement.** `page_sort.py`: `_clicks(scope, gsc)` becomes
  `_gsc_total(scope, gsc, column: Literal["clicks", "impressions"])` summing `gsc_page_daily.c[column]`;
  `EXTRA_SORTS` gains `"impressions"`; `extra_sort` dispatches `clicks` and `impressions` to it.
  `reads.py` `_sorter`: `if sort.lstrip("-") in ("clicks", "impressions"):` reads the window (today only
  `clicks` does, so without this line the new sort is all zeros). `PageSort` gains `"impressions"` and
  `"-impressions"` after `"-clicks"`. `_cursor_value` needs no change (an integer is its default branch).

- [ ] **Step 4: Run** `uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_sort_extra.py`, expect
  pass. Regenerate the OpenAPI document. Run the backend commands.

- [ ] **Step 5: Commit.** `git commit -m "Pages API: sort the pages list by impressions"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: the clicks sort is
  unchanged in behaviour (its test still passes untouched); `_sorter` reads the window for both keys.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 5: The daily Search Console read of one page

Spec 9.5 and 15 point 3.

**Before dispatching (the lead, not the subagent):** ask the Search Console session whether it has shipped,
or is about to ship, a series route for one page. If it has, skip this task; Task 9 then points
`usePageSearchDaily` at that route. If not, tell that session this route is being built and go on.

**Files:**
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py`, `backend/src/idraft/api/internal_links/extras.py`,
  `reads.py`, `read_routes.py`
- Modify: `backend/tests/api/test_route_access.py`
- Create: `backend/tests/api/internal_links/test_page_search.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Read first.** `extras.py` (`gsc_window`, `gsc_of`), `api/keywords/gsc_repository.py`
  (`GscScope`), `tests/api/internal_links/support_changes.py` (`gsc_property`: its window ends
  `date.today() - timedelta(days=3)`), `test_page_extras.py` near line 346 (how a page day is inserted and
  which state follows).

- [ ] **Step 2: Write the failing tests** in `test_page_search.py` (the crawl of `read_site`):
  - no property: `state` is `not_connected`, `clicks`, `impressions`, `window_start`, `window_end` are null,
    `days` is `[]`;
  - a property with a window and no stored page day: `state` is `pending`, the same nulls;
  - a property and two stored days for `/pricing` (clicks 4 and 6, impressions 90 and 110): `state` is `ok`,
    `clicks` 10, `impressions` 200, `days` has one row for every day from `window_start` to `window_end`
    inclusive in date order, the two stored days carry their numbers and every other day is 0 and 0;
  - a page of the crawl with no stored row, while another page has one: `state` is `ok`, totals 0, every
    day 0;
  - a `url_id` the crawl in view does not hold: `404 not_found`; a `url_id` that is not digits: `422`;
  - another workspace's member: `404`; before any crawl: `404 no_crawl`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** Schemas:

```python
class PageSearchDay(BaseModel):
    date: date
    clicks: int
    impressions: int


class PageSearchDaily(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    window_start: date | None
    window_end: date | None
    clicks: int | None
    impressions: int | None
    days: list[PageSearchDay]


class PageSearchDailyResponse(BaseModel):
    data: PageSearchDaily
```

  `extras.py`: `async def page_search_daily(db: AsyncSession, scope: PageScope, url_id: int) -> PageSearchDaily`:
  `gsc_window`; without an integration or a window the empty answer with that state; else one
  `SELECT metric_date, clicks, impressions FROM fp.gsc_page_daily` for the workspace, the project, the
  integration, the URL and the window, and the days filled in Python from `window[0]` to `window[1]`.
  `reads.py`: `LinkReadService.page_search(self, access, project_id, *, run, url_id) -> PageSearchDaily`:
  `read_scope`, then `NotFoundError` unless `crawl_pages` has the row of `(workspace, run, url_id)` (the
  check `page_detail` makes through its select), then `page_search_daily`. Route:

```python
@router.get("/pages/{url_id}/search", summary="One page: Search Console clicks and impressions by day")
async def page_search(
    project_id: UUID, url_id: UrlIdPath, access: ReadData, reads: Reads, run: Run = "latest"
) -> PageSearchDailyResponse:
```

  The row in `test_route_access.py`:
  `("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/search"): "data:read",`.

- [ ] **Step 5: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands.**

- [ ] **Step 6: Commit.** `git commit -m "Pages API: Search Console clicks and impressions of one page by day"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the states mean what
  `gsc_window` says; the day fill is inclusive at both ends and never invents a day outside the window;
  every statement names the workspace; the 404 is for the crawl in view, not for any crawl.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 5b: The outline parser, pure

Spec 9.6.1 (the fields and where each verdict comes from), 9.6.2, decision D14. Contract C6. No database, no
API, no storage: one pure module and its tests.

**Before dispatching (the lead, not the subagent):** look at the Issues branch with git only, never a checkout:
`git diff develop..claude/issues-page-8b4da8 --stat -- backend/src/idraft/crawl` and
`git show claude/issues-page-8b4da8:backend/src/idraft/crawl/head.py | head -20`. On 2026-11-26 that branch has
no HTML reader for descriptions, headings, hreflang, Open Graph, alt text or words (its plan
`2026-11-26-issues-01-backend.md` only names "an extractor beside `crawl/head.py`" for its slice 2). If it has
one by now, stop: tell the owner, and build Task 5c on that module instead of writing a second parser.

**Files:**
- Create: `backend/src/idraft/crawl/outline.py`, `backend/src/idraft/crawl/lang_codes.py`
- Create: `backend/tests/crawl/test_outline.py`

- [ ] **Step 1: Read first.** `backend/src/idraft/crawl/head.py` whole (the house style of a pure reader:
  `HTMLParser` with `convert_charrefs=True`, the `_hidden` counter for `template` and `noscript`, feeding in
  chunks, the `try` around the feed, `urljoin` and the http(s) test), `crawl/placement.py` lines 25 to 40
  (`without_empty_comments`), `crawl/mentions.py` lines 80 to 160 (`visible_blocks`, which has no guard of
  its own), `tests/crawl/test_head.py` (how the cases are written), and the contract "crawl is pure" in
  `backend/pyproject.toml` (no `idraft.api`, `idraft.db`, `idraft.storage`, `sqlalchemy`, `httpx`).

- [ ] **Step 2: Write the failing tests** in `tests/crawl/test_outline.py`. One small page used by most cases:

```python
PAGE = """<!doctype html><html lang="en-GB"><head>
<title>Ignored here: the title comes from the crawl row</title>
<meta name="description" content="  A description of the managed SOC service that is long enough to pass the lower limit.  ">
<meta name="robots" content="index, follow">
<link rel="alternate" hreflang="en" href="/soc">
<link rel="alternate" hreflang="en-UK" href="https://example.com/uk/soc">
<link rel="alternate" hreflang="x-default" href="https://example.com/soc">
<meta property="og:title" content="Managed SOC"><meta property="og:image" content="/og/soc.png">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service"}</script>
<script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList"},{"@type":["FAQPage","WebPage"]}]}</script>
<script type="application/ld+json">{"@type": "Broken",</script>
</head><body><header><h2>Menu heading</h2></header><main>
<h1>Managed  SOC
 service</h1><h3>Skipped a level</h3><h2>How it works</h2>
<p>One two three four five.</p>
<img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="A chart">
</main></body></html>"""
URL = "https://example.com/soc"
```

  The cases, each one test function:
  - `parse_outline(PAGE, URL)`: `description` is the trimmed text and `description_chars` its length;
    `robots_meta == "index, follow"`; `html_lang == "en-GB"`; `headings` are, in order, (2, "Menu heading"),
    (1, "Managed SOC service"), (3, "Skipped a level"), (2, "How it works") with whitespace as one space;
    `headings_total == 4`; `level_counts == (1, 2, 1, 0, 0, 0)`; `skipped_at == 2`;
  - hreflang: three pairs in order; `en` has `href == "https://example.com/soc"`, `is_self` true, `valid` true;
    `en-UK` is not valid with `suggestion == "en-GB"`; `x-default` is valid; `x_default` is true;
  - social: `og_title == "Managed SOC"`, `og_description is None`, `og_image == "https://example.com/og/soc.png"`,
    `og_type == "website"`, `twitter_card == "summary_large_image"`;
  - JSON-LD: three blocks: `(("Service",), True)`, `(("BreadcrumbList", "FAQPage", "WebPage"), True)`,
    `((), False)`;
  - content: `words == 5` (the paragraph in `main`; headings count too if `visible_blocks` returns them: read
    what it returns for this page and assert that exact number, with a one-line comment saying which blocks
    count); `images == 3`; `images_without_alt == 1` (an empty `alt` is described);
  - `length_state`: `(0, 30, 60)` is `missing`; 29 `short`; 30 and 60 `ok`; 61 `long`; and `(69, 70, 160)`
    `short`, 70 and 160 `ok`, 161 `long`;
  - `read_minutes`: 0 gives 1, 230 gives 1, 345 gives 2 (round half to even is not wanted: write
    `max(1, (words + WORDS_PER_MINUTE // 2) // WORDS_PER_MINUTE)` and assert 344 gives 1, 345 gives 2);
  - `hreflang_valid`: `en`, `EN-gb`, `zh-Hant-TW`, `pt-BR`, `x-default` are `(True, None)`; `en-UK` is
    `(False, "en-GB")`; `xx`, `english`, `en_GB`, `en-`, `` are `(False, None)`;
  - `lang_codes`: `"en" in LANGUAGES`, `"zh" in LANGUAGES`, `"xx" not in LANGUAGES`, `"gb" in REGIONS`,
    `"in" in REGIONS`, `"uk" not in REGIONS`, every member of both is two lower-case ASCII letters;
  - no H1: a page with only `<h2>` has `level_counts[0] == 0` and `skipped_at is None` (a first heading
    skips nothing); two `<h1>` give 2; an `<h1>` inside `<template>` or `<noscript>` is not a heading;
  - no description: `description is None`, `description_chars == 0`; an empty `content` is the same; only the
    first `<meta name="description">` counts; `NAME="Description"` is found (names compare without case);
  - a hreflang href of `javascript:alert(1)` or `data:text/html,x` is dropped; a relative one is resolved;
  - caps: 201 `<h2>` give `len(headings) == 200` and `headings_total == 201`; a heading of 500 characters is
    cut to `HEADING_TEXT_MAX`; a description of 3,000 characters has `len(description) == META_TEXT_MAX` and
    `description_chars == 3000`; 101 hreflang links give 100 pairs; 25 JSON-LD blocks give 20; a JSON-LD
    block longer than `JSONLD_BLOCK_CHARS_MAX` is `((), False)` and is not given to `json.loads`; a block
    with 30 types gives 10;
  - hostile input, one parametrized test, each value passed to `parse_outline(value, URL)` inside nothing
    but the call (the test fails if it raises) and each result is a `ParsedOutline`: `""`, `"<"`,
    `"<" * 1_000_000`, `"<h1" * 10_000`, `"<div>" * 10_000 + "<h1>deep</h1>"`,
    `'<script type="application/ld+json">' + "[" * 100_000 + "</script>"`, `"<h1>\x00null</h1>"`,
    `"<!--" + "x" * 100_000`, `'<html lang="' + "a" * 100_000 + '">'`,
    `b"\xff\xfe<h1>bytes</h1>".decode("utf-8", errors="replace")`, and `PAGE[:137]` (cut inside a tag);
  - `parse_outline("", URL) == EMPTY_OUTLINE`.

- [ ] **Step 3: Run, expect failures** (the module does not exist).
  `uv run pytest -n 0 --no-cov tests/crawl/test_outline.py`

- [ ] **Step 4: Implement `lang_codes.py`.** Two constants and nothing else, with a module docstring that
  names the standards:

```python
LANGUAGES: Final[frozenset[str]]  # every two-letter language code of ISO 639-1, lower case
REGIONS: Final[frozenset[str]]    # every officially assigned ISO 3166-1 alpha-2 code, lower case
```

  Write both lists out in full, sorted, ten codes a line. `uk` is not in `REGIONS` (it is reserved, not
  assigned; the United Kingdom is `gb`). Do not add a dependency for this.

- [ ] **Step 5: Implement `outline.py`** with the names of C6, in this shape:
  - a module docstring in the style of `head.py`: what it reads, that the title, the canonical and the
    noindex verdict are not read here but taken from the crawl row by the caller (spec 9.6.1), that pages are
    untrusted so it never raises, and that the Issues checks of slice 2 use these functions and constants;
  - `class _Outline(HTMLParser)` (`convert_charrefs=True`) with the `_hidden` counter of `head.py` extended to
    `template`, `noscript`, `style`; it collects in one pass: the `lang` of the first `<html>`; in the head
    the first `meta[name=description]`, the first `meta[name=robots]`, `meta[property|name]` for `og:title`,
    `og:description`, `og:image`, `og:type`, `twitter:card` (first of each), `link[rel~=alternate][hreflang]`;
    everywhere the `script[type="application/ld+json"]` texts; in the body the `h1` to `h6` texts and the
    `img` elements. Every text it keeps is cut as it grows (never build a string past its cap and cut after);
    every list stops growing at its cap while its counter keeps counting;
  - `parse_outline`: `html = without_empty_comments(html)`; feed in chunks of 65,536 inside
    `try: ... except Exception:` (keep what was read so far; the comment says why, as in `head.py`); then the
    words in their own `try` (`visible_blocks` may raise on garbage: then 0 words); then the JSON-LD blocks,
    each `json.loads` in its own `try: ... except Exception:` (`RecursionError` is one) giving
    `JsonLdBlock((), False)`; the hreflang hrefs resolved with the page's URL and kept only as http or https
    and at most `HREF_MAX` long, as `canonical_of` does; `og_image` resolved the same way and `None` when it
    is not http or https;
  - `skipped_at`: the first index `i > 0` with `headings[i].level - headings[i - 1].level > 1`, else `None`;
  - `hreflang_valid(code)`: lower-case the code; `x-default` is valid; else split on `-`: one to three parts,
    the first in `LANGUAGES`, an optional part of four letters (the script), an optional last part of two
    letters in `REGIONS`; anything else is not valid. The suggestion is only for a known slip:
    `_REGION_FIXES: Final = {"uk": "GB"}` gives `f"{language}-{fix}"` when the language is valid and the
    region is a key; otherwise `None`;
  - words: `sum(len(_WORD.findall(block)) for block in visible_blocks(html))` with
    `_WORD: Final = re.compile(r"[^\W_]+")`.
  No `# type: ignore`, explicit return types, constants as `Final`.

- [ ] **Step 6: Run the tests, expect pass. Then:**

```bash
uv run ruff check src/idraft/crawl/outline.py src/idraft/crawl/lang_codes.py tests/crawl/test_outline.py
uv run ruff format --check src/idraft/crawl/outline.py src/idraft/crawl/lang_codes.py tests/crawl/test_outline.py
uv run mypy src/idraft/crawl/outline.py src/idraft/crawl/lang_codes.py tests/crawl/test_outline.py
uv run lint-imports
uv run pytest -n 0 --no-cov tests/crawl/test_outline.py tests/crawl/test_head.py tests/crawl/test_mentions.py
```

  Expected: all pass. `lint-imports` proves the module stayed pure. These tests need no Docker.

- [ ] **Step 7: Commit.**
  `git add backend/src/idraft/crawl/outline.py backend/src/idraft/crawl/lang_codes.py backend/tests/crawl/test_outline.py`
  `git commit -m "Pages: a pure reader of a page's outline from its HTML"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the parser never
  raises on hostile input (the reviewer adds two inputs of its own in a scratch run, not in the commit, and
  reports what happened); every list and every text has its cap and no string is built past it; the byte
  cap is not this module's job but `HTML_BYTES_MAX` is defined here for Task 5c; the module imports only the
  standard library and `idraft.crawl.*`; no href that is not http or https leaves the module; the limits
  (30, 60, 70, 160, 200) are constants used by name, never literals; the title, canonical and noindex are
  not parsed here; the two code lists are whole (spot-check ten codes of each against the standard).

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 5c: The outline read

Spec 9.6.1, 9.6.2 (the last paragraph), decision D13. Contracts C4, C6.

**Files:**
- Modify: `backend/src/idraft/storage/raw.py`, `backend/tests/storage/test_raw.py` (create it if the folder
  has no test of `decompress`; find the right file with `grep -rln "decompress" backend/tests/storage`)
- Create: `backend/src/idraft/api/internal_links/outline.py`
- Modify: `backend/src/idraft/api/schemas/internal_links_extra.py`, `backend/src/idraft/api/internal_links/reads.py`,
  `read_routes.py`, `backend/src/idraft/api/main.py`
- Modify: `backend/tests/api/test_route_access.py`
- Create: `backend/tests/api/internal_links/test_page_outline.py`
- Modify: `backend/openapi/v1.json`

- [ ] **Step 1: Read first.** `storage/raw.py` (`compress`, `decompress`, `RawStorageError`, `ObjectStore`,
  `UNPACKED_MAX`); `collectors/crawl_store.py` (`html_key`, `latest_run`); `collectors/crawl_relink.py`
  lines 100 to 125 (how the stored HTML is read and decoded, and which errors mean "not stored");
  `api/main.py` lines 244 to 330 (`link_reads = LinkReadService(sessions=sessions)`, `import_store`,
  `sources`); `api/ranks/service.py` `read_stored_answer` (how a service treats a `None` store);
  `reads.py` `page_detail` and `read_scope`; `db/tables.py` `crawl_pages` and `urls` (`url`, `url_hash`);
  `crawl/status.py` and `grep -rn "non_indexable_reason" backend/src/idraft` (the values a noindex page
  has); how an API test gets an app with an object store (`grep -rn "raw_store\|import_store" backend/tests/api | head`)
  and the in-memory stores the tests already have (`grep -rn "class MemoryStore\|class FakeStore" backend/tests`).

- [ ] **Step 2: Write the failing tests.**
  `tests/storage`: `inflate_head(compress(b"a" * 100), 10) == (b"a" * 10, True)`;
  `inflate_head(compress(b"abc"), 10) == (b"abc", False)`; `inflate_head(b"not zstd", 10)` raises
  `RawStorageError`; a limit equal to the size is not truncated.
  `test_page_outline.py` (the crawl of `read_site`, an in-memory store that counts its `get` calls, the HTML of
  a page stored with `compress(html.encode())` under `html_key(project_id, url_hash)`):
  - a live page with a stored page: `state` is `ok`, `run_id` is the latest crawl's, `status_code` 200, and
    `outline` has every field of C6; `outline.url` is the page's address; `headings`, `languages`, `social`,
    `structured_data` and `content` equal what `parse_outline` gives for that HTML; `content.thin` is true
    under 200 words and `read_minutes` follows `read_minutes`;
  - the verdicts of the crawl row win: the stored HTML has `<title>Other</title>`,
    `<link rel="canonical" href="https://example.com/else">` and `<meta name="robots" content="noindex">`,
    while the crawl row has a title of 40 characters, `canonical_url_id` null and `is_indexable` true: the
    answer has that title with `state` `ok` and `chars` 40, `canonical.state` `none`, `robots.noindex` false
    and `robots.meta == "noindex"` (the text is shown as read);
  - title states from the row: null or blank is `missing` with `text` null and `chars` 0; 29 characters
    `short`; 61 `long`; the length is of the trimmed title;
  - canonical: the page's own id is `self` with its address; another crawled page is `elsewhere` with that
    page's address;
  - noindex: a row whose `non_indexable_reason` is `meta_tag` or `http_header` gives `robots.noindex` true;
    any other reason and null give false;
  - a redirect (301) is `redirect`, a 404 and a page with no status are `error`, a 200 with
    `resource_type = 'other'` is `not_html`; each has `outline` null and the store's `get` was never called;
  - `no_html`: no object under the key; an object that is not a zstd frame; and the app built with no store.
    All three answer 200;
  - `truncated`: an HTML of `HTML_BYTES_MAX + 10` bytes whose last element is an `<h2>` past the cap: `ok`,
    `outline.truncated` true and that heading is absent;
  - a variant page (`variant_of_url_id` set, 200, HTML) is `ok`;
  - a page that only an older crawl holds: `404 not_found`; a `url_id` that is not digits: `422`; before any
    crawl: `404 no_crawl`; a member of another workspace: `404`; a role without `data:read`: `403`;
  - the request takes no `run`: `?run=latest` is `422` (the app rejects unknown query names; assert what
    `reject_unknown_query` answers for another unknown name on the page detail and expect the same).

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  `storage/raw.py`, beside `decompress`:

```python
def inflate_head(data: bytes, limit: int) -> tuple[bytes, bool]:
    """The first `limit` bytes of a stored payload, and whether it holds more. Unlike
    `decompress` it never inflates the whole frame: a page of any size costs `limit` bytes."""
    try:
        with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data)) as reader:
            body = reader.read(limit + 1)
    except zstandard.ZstdError:
        raise RawStorageError("not a compressed payload") from None
    return body[:limit], len(body) > limit
```

  Schemas: the classes of C6, in `internal_links_extra.py`.
  `api/internal_links/outline.py` (new, so `reads.py` does not grow by a screen):

```python
@dataclass(frozen=True, slots=True)
class OutlineRow:
    url: str
    url_hash: bytes
    url_id: int
    status_code: int | None
    resource_type: str | None
    title: str | None
    canonical_url_id: int | None
    canonical_url: str | None
    non_indexable_reason: str | None

def row_state(row: OutlineRow) -> Literal["ok", "redirect", "error", "not_html"]: ...
async def stored_html(store: ObjectStore | None, key: str) -> tuple[str, bool] | None: ...
def outline_body(row: OutlineRow, parsed: ParsedOutline, truncated: bool) -> PageOutlineBody: ...
```

  - `row_state`: 300 to 399 is `redirect`; 200 with `resource_type == "html"` is `ok`; 200 otherwise is
    `not_html`; everything else, a null status included, is `error`.
  - `stored_html`: `None` for a `None` store; `data = await store.get(key)` and
    `await asyncio.to_thread(inflate_head, data, HTML_BYTES_MAX)`, both inside
    `try: ... except (RawStorageError, KeyError): return None` (the same pair `crawl_relink` catches); the
    bytes decoded with `decode("utf-8", errors="replace")`. One line of comment: the compressed object is
    read whole (`shortcut: the store has no ranged read, a page's HTML packs to well under a megabyte; add a
    range to ObjectStore.get when a stored page is ever larger`).
  - `outline_body`: the title from `row.title` trimmed (`text` null when empty, `chars`, `length_state` with
    `TITLE_MIN` and `TITLE_MAX`); the description from `parsed` with `DESCRIPTION_MIN` and `DESCRIPTION_MAX`;
    the canonical from `canonical_url_id` (null `none`, equal to `row.url_id` `self` with `row.url`, else
    `elsewhere` with `row.canonical_url`); `robots.noindex` is `non_indexable_reason in NOINDEX_REASONS`, with
    `NOINDEX_REASONS: Final = ("meta_tag", "http_header")` in this module (the two values the Issues check
    `noindex` tests on its branch, `api/issues/rules.py`; Step 1 confirms the crawl writes exactly these); `thin` is `parsed.words < THIN_WORDS`;
    `read_minutes(parsed.words)`.
  `reads.py`: `LinkReadService.__init__(self, *, sessions, raw_store: ObjectStore | None = None)`, and

```python
async def page_outline(self, access: WorkspaceAccess, project_id: UUID, *, url_id: int) -> PageOutline:
```

  Inside `self._transaction(access)`: `scope = await read_scope(db, access, project_id, None)` (the latest
  crawl), one select of `crawl_pages` joined to `urls` and outer-joined to `urls` again for the canonical,
  for `(workspace, run, url_id)`; `NotFoundError` without a row. After the transaction is left: `row_state`;
  when not `ok`, the answer with `outline=None`; else `stored_html(self._raw_store, html_key(project_id, row.url_hash))`;
  `None` gives `no_html`; else `parsed = await asyncio.to_thread(parse_outline, html, row.url)` and the
  answer. No storage call and no parse happen while the transaction is open.
  `main.py`: `link_reads = LinkReadService(sessions=sessions, raw_store=import_store)` (move the line under
  the place `import_store` is bound if it is bound later; change nothing else there).
  Route, after `page_search`:

```python
@router.get(
    "/pages/{url_id}/outline",
    summary="One page: its outline, read from the stored HTML of the latest crawl",
    description="Title, description, canonical, robots, headings, language versions, sharing tags, "
    "structured data and content size. Read on demand; nothing is stored. Always the latest crawl.",
)
async def page_outline(
    project_id: UUID, url_id: UrlIdPath, access: ReadData, reads: Reads
) -> PageOutlineResponse:
```

  The row in `test_route_access.py`:
  `("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/outline"): "data:read",`.

- [ ] **Step 5: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands**, with
  these paths added to ruff and mypy: `src/idraft/storage/raw.py src/idraft/api/main.py`, and

```bash
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_outline.py tests/api/internal_links/test_reads_pages.py tests/api/test_openapi.py tests/api/test_route_access.py
uv run pytest -n 0 --no-cov <the storage test file of step 2>
```

- [ ] **Step 6: Commit.** `git commit -m "Pages API: the outline of one page, read from its stored HTML"`
  (it holds `openapi/v1.json`; the web client is Task 6, alone in its commit).

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: hostile and broken
  input can never be a `5xx` (a damaged object, a missing object, no store, HTML that is all garbage: each
  is a `200` with a state); the byte cap is applied while inflating, not after (`decompress` is not called
  on this path); the heading and text caps of Task 5b reach the answer; no storage read for a redirect, an
  error or a page that is not HTML; the read and the parse happen outside the database transaction and the
  parse runs in a thread; the title, canonical and noindex verdicts come from the crawl row with the Issues
  rules (trimmed title, 30 and 60); every statement names the workspace; the 404 is for the latest crawl;
  the route takes no `run`; nothing is written anywhere (no new table, no column, no cache); the object key
  is built only by `html_key`, never from request text.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 5d: The table of page notes

Spec 9.7.1, decision D15. Contract C7. A migration, the table object, the schema tests and the data model
document. No route.

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0042_page_notes.py`
- Modify: `backend/src/idraft/db/tables.py`
- Modify: `backend/tests/db/test_tables.py`, `backend/tests/db/support.py`, `backend/tests/db/test_grants.py`,
  `backend/tests/security/test_cross_tenant.py`
- Create: `backend/tests/db/test_page_notes_schema.py`
- Modify: `docs/04-data-model.md`

- [ ] **Step 1: Read first.** `db/migrations/versions/0038_keyword_prompt_links.py` whole (the pattern: a
  docstring that says what and who writes, `Revision ID` and `Revises`, the table as one SQL string,
  `statements`, `tenant_isolation`, `grants`, `column_grant`, a `downgrade` that drops), `db/ddl.py` (those
  four helpers), `ls backend/src/idraft/db/migrations/versions | tail -3` (the latest revision: this
  migration revises it; if it is not `0041`, take the next free number and name the file after it),
  `db/tables.py` `keyword_prompt_links` (how a table with a composite project key is written),
  `tests/db/test_tables.py` near `"core.keyword_prompt_links"`, `tests/db/support.py` near lines 89 and 858
  (the tenant column map and the seed row every tenant table needs for `test_rls.py`),
  `tests/db/test_grants.py` near line 544, `tests/db/test_keywords_schema.py` or
  `test_internal_links_schema.py` (how a schema test inserts and expects a check to refuse), and
  `docs/04-data-model.md` sections 5.1 and 5.3 (how a table is documented).

- [ ] **Step 2: Write the failing tests.**
  - `test_tables.py`: `"core.page_notes"` in the list, in its alphabetical place.
  - `support.py`: `"core.page_notes": "workspace_id"` in the tenant column map, and one seeded row (a note by
    the seeded user on a seeded URL of the seeded project) where the other seed inserts are, so the
    row-level security test covers the table.
  - `tests/security/test_cross_tenant.py`: it keeps its own map of tenant tables (near line 1599) and its own
    seed (near line 1044): add `"core.page_notes": "workspace_id"` and one seeded note there too. Find any
    other list of every table with `grep -rln "keyword_prompt_links" backend/tests` and add the table
    wherever that one is listed as a table (not where it is only queried).
  - `test_grants.py`: the API role has `SELECT` and `INSERT` on the table and `UPDATE` on exactly `body`,
    `edited_at`, `deleted_at`, `deleted_by`; it has no `DELETE`; the worker role has nothing.
  - `test_page_notes_schema.py`: a body of 1 and of 2,000 characters is stored; an empty body, a body of
    2,001 characters, `" x"` and `"x "` are each refused by the check; `deleted_at` without `deleted_by`
    (and the reverse) is refused; a note for a URL id that does not exist is refused; deleting the project
    removes its notes; as the API role, `DELETE FROM core.page_notes` and
    `UPDATE core.page_notes SET author_id = …` are refused with a permission error; a second workspace's
    session sees no row of the first (row-level security).

- [ ] **Step 3: Run, expect failures.**
  `uv run pytest -n 0 --no-cov tests/db/test_page_notes_schema.py tests/db/test_tables.py tests/db/test_grants.py tests/security/test_cross_tenant.py`

- [ ] **Step 4: Implement.** The migration:

```python
"""Notes on a page (Pages spec 9.7, decision D15).

A note belongs to a project and an address (`core.urls`), not to a crawl's page row, so it stays
when the site is crawled again and exists for an address that redirects or errors. The API adds
a note, changes its body and marks it deleted (`deleted_at`, `deleted_by`); no role may delete a
row, so Undo is one update and the audit log can always name the note. The worker does not read it.

Revision ID: 0042
Revises: 0041
"""
```

  with the table and the index of spec 9.7.1 as one string, then

```python
def upgrade() -> None:
    for statement in statements(_TABLE):
        op.execute(statement)
    for statement in tenant_isolation("core.page_notes"):
        op.execute(statement)
    for statement in (
        *grants("core.page_notes", api="SELECT, INSERT"),
        column_grant(
            "core.page_notes",
            role="app_api",
            privilege="UPDATE",
            columns=("body", "edited_at", "deleted_at", "deleted_by"),
        ),
    ):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the notes are lost.
    op.execute("DROP TABLE core.page_notes")
```

  `tables.py`: `page_notes = Table("page_notes", metadata, …, schema="core")` with the ten columns, the
  foreign keys and `server_default=FetchedValue()` where the database sets the value, placed after
  `page_terms`. `docs/04-data-model.md`: a new "### 5.4 Page notes" after section 5.3 with the `CREATE TABLE`
  of the migration and four sentences: what a note is, why the key is the address and not a crawl row, that
  a delete is soft and nobody may delete a row, and who reads and writes (API only).

- [ ] **Step 5: Run the tests of step 3 and** `uv run pytest -n 0 --no-cov tests/db/test_migrations.py tests/db/test_rls.py tests/db/test_ddl.py`.
  Expect pass. Then:

```bash
uv run ruff check src/idraft/db/migrations/versions/0042_page_notes.py src/idraft/db/tables.py tests/db/test_page_notes_schema.py tests/db/support.py tests/db/test_tables.py tests/db/test_grants.py
uv run ruff format --check src/idraft/db/migrations/versions/0042_page_notes.py src/idraft/db/tables.py tests/db/test_page_notes_schema.py tests/db/support.py tests/db/test_tables.py tests/db/test_grants.py
uv run mypy src/idraft/db tests/db/test_page_notes_schema.py
uv run lint-imports
```

- [ ] **Step 6: Commit.** `git commit -m "Pages: the table of notes on a page"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the migration
  follows `0038` (raw SQL, the helpers, a `downgrade`), revises the latest revision and changes no other
  table; the key is `core.urls.id`, never a crawl page; row-level security is on and tested from a second
  workspace; the API role cannot delete a row or change `author_id`, `url_id`, `project_id`, `workspace_id`
  or `created_at`; the body check is in the database, not only in the API; the index serves "the notes of
  one page, newest first, not deleted"; `tables.py` and the SQL agree column by column; the data model
  document has the table; no dash in the SQL comments or the docstring.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 5e: The note reads and writes, audited, and the count on the page detail

Spec 9.7.2, decision D16. Contracts C4, C7.

**Files:**
- Create: `backend/src/idraft/api/schemas/page_notes.py`, `backend/src/idraft/api/internal_links/page_notes.py`,
  `page_note_routes.py`
- Modify: `backend/src/idraft/api/audit.py` (four actions), `backend/src/idraft/api/main.py` and
  `backend/src/idraft/api/resources.py` (the service and its router)
- Modify: `backend/src/idraft/api/schemas/internal_links.py` (`PageDetail.notes_count`),
  `backend/src/idraft/api/internal_links/reads.py` (`page_detail`)
- Modify: `backend/tests/api/test_route_access.py`
- Create: `backend/tests/api/internal_links/test_page_notes.py`
- Modify: `backend/openapi/v1.json`, `docs/19-api-specification.md`, `docs/24-security.md`

- [ ] **Step 1: Read first.** `api/internal_links/page_tiers.py` (a project write service: the constructor,
  `workspace_transaction`, `audit.record` inside the transaction, `RequestInfo`), `page_tier_routes.py` (the
  router, the `Annotated` dependencies, how `RequestInfo` reaches a write, a `204`), `api/audit.py`
  (`AuditAction`, `record`, `Snapshot`), `api/pagination.py` (`Cursor`, `encode_cursor`, `decode_cursor`,
  `cursor_instant`, `CursorPageInfo`) and one service that pages by `(created_at, id)` with them
  (`grep -rln "encode_cursor" backend/src/idraft/api`), `api/workspaces/access.py` (`WorkspaceAccess.role`,
  `user_id`), `api/permissions.py` (`Role`, `NOTES_WRITE`), how another service returns a user's name
  (`grep -rn "users.c.name" backend/src/idraft/api | head`), the errors the API raises for 403 and 404
  (`grep -n "class .*Error" backend/src/idraft/api/errors.py`), `tests/api/internal_links/test_page_tags.py`
  (a write test with roles and `audit_rows`), and `grep -rn "page_tags.changed" backend` (every place that
  lists audit actions: each needs the four new ones).

- [ ] **Step 2: Write the failing tests** in `test_page_notes.py` (the crawl of `read_site`; an owner, an
  admin, two editors and a viewer of the workspace; a member of a second workspace):
  - an editor adds a note to `/pricing`: `201`, the note has their id and name, the body, `created_at`,
    `edited_at` null, `can_edit` and `can_delete` true; the list returns it; the page detail has
    `notes_count` 1;
  - three notes are listed newest first; with `limit=2` the first page has two and a `next_cursor`, the
    second page the third; two notes with the same `created_at` (set by an update in the test) are each
    listed once across pages; `meta.total` is 3; `limit=0` and `limit=101` are `422`;
  - the body: `"  a\r\nb  "` is stored as `"a\nb"`; 2,000 characters pass and 2,001 are `422`; `""`, `"   "`
    and a body with `"\x00"` are `422`; `"<b>x</b> & <script>"` comes back character for character;
  - change: the author changes the body, `edited_at` is set and `created_at` is not touched; sending the
    same body again leaves `edited_at` as it was; the other editor, the admin and the owner each get `403`;
    the viewer gets `403`;
  - delete: the author gets `204`; the note is gone from the list and from `notes_count` and its row has
    `deleted_at` and `deleted_by`; a second delete is `404`; the other editor gets `403`; the admin and the
    owner each delete another person's note; the viewer gets `403`;
  - restore: the one who deleted restores, `200`, the note is back with its first `created_at` and
    `edited_at`; restoring a note that is not deleted is `404`; another editor restoring is `403`; an admin
    who deleted an editor's note restores it;
  - reading: the viewer lists notes with `can_edit` and `can_delete` false; an editor sees `can_edit` false
    and `can_delete` false on another editor's note; an admin sees `can_edit` false and `can_delete` true
    on it;
  - the address: a `url_id` no crawl of the project holds is `404` for the list and for a create; a
    `url_id` that is not digits is `422`; a note id that belongs to another page is `404` on change, delete
    and restore; the member of the second workspace gets `404` on all five routes;
  - across crawls: a note written under the first crawl is listed, and counted on the page detail, after a
    second crawl is seeded and for `run=<the first crawl>` alike; a note on a page whose status the test
    then sets to 301 is still listed;
  - audit: one row each for `page_note.created`, `page_note.updated`, `page_note.deleted` and
    `page_note.restored`, with `target_type` `page_note`, the note id, the actor, and the bodies in `before`
    and `after` as spec 9.7.2 says; a refused write (`403`, `422`) leaves no audit row and no change;
  - the page detail of a page without notes has `notes_count` 0.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  `schemas/page_notes.py`: the classes of C7. `PageNoteWrite.body` has a `field_validator` that replaces
  `"\r\n"` with `"\n"`, strips, and raises `ValueError` with a plain sentence when the result is empty,
  longer than `NOTE_MAX` or holds `"\x00"`.
  `audit.py`: the four actions in `AuditAction`, after `page_tags.changed`.
  `internal_links/page_notes.py`:

```python
class PageNoteService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None: ...

    async def list(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, *, cursor: str | None, limit: int
    ) -> PageNoteList: ...
    async def create(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, body: PageNoteWrite, info: RequestInfo
    ) -> PageNote: ...
    async def update(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, note_id: UUID, body: PageNoteWrite,
        info: RequestInfo,
    ) -> PageNote: ...
    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, note_id: UUID, info: RequestInfo
    ) -> None: ...
    async def restore(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, note_id: UUID, info: RequestInfo
    ) -> PageNote: ...


async def notes_count(db: AsyncSession, workspace_id: UUID, project_id: UUID, url_id: int) -> int: ...
```

  - Every method runs in one `workspace_transaction` and every statement names the workspace and the
    project. A project the caller may not see (`access.sees(project_id)` false) is `404`, as the
    other project services answer it (follow `page_tiers.py`). First `_require_page`: `NotFoundError` unless a crawl page of this project has the `url_id`
    (`crawl_pages` joined to `crawl_runs` on the run, the run's `project_id`, `LIMIT 1`).
  - `list`: `page_notes` joined to `users` for the name, `deleted_at IS NULL`, ordered
    `created_at DESC, id DESC`, `limit + 1` rows, the cursor over `(created_at, id)` with `encode_cursor` and
    `decode_cursor` (scope: the project and the page), `total` from a count.
  - `_may_delete(access, author_id)`: the author, or `access.role in (Role.OWNER, Role.ADMIN)`.
    `can_edit` is `access.holds(Permission.NOTES_WRITE)` and the caller is
    the author; `can_delete` is the permission and `_may_delete`.
  - `update`: select the note `FOR UPDATE` (404 when absent, deleted, or of another page); the specific
    forbidden error unless the caller is the author; when the body differs, update `body` and
    `edited_at = now()` and record `page_note.updated` with both bodies; when it is the same, change and
    record nothing.
  - `delete`: 404 when absent or already deleted; forbidden unless `_may_delete`; set `deleted_at = now()`
    and `deleted_by`; record `page_note.deleted`.
  - `restore`: 404 unless the note is deleted; forbidden unless `deleted_by` is the caller; clear both
    columns; record `page_note.restored`.
  `page_note_routes.py`: a router with the prefix of C7 and `tags=["internal-links"]`; `ReadData` for the
  list, `WriteNotes = Annotated[WorkspaceAccess, Depends(require_permission(Permission.NOTES_WRITE))]` for
  the four writes; `UrlIdPath` for the page; `Cursor` for the list and `limit` as
  `Annotated[int, Query(ge=1, le=100)] = 50`; summaries in plain words ("One page: its notes, newest first",
  "Add a note to a page", "Change your note", "Delete a note", "Bring a deleted note back").
  `resources.py` and `main.py`: `page_notes: PageNoteService`, built and its router included beside
  `page_tier_routes_router`.
  `schemas/internal_links.py`: `notes_count: int = 0` on `PageDetail`, with a `Field` description "Notes on
  this address that are not deleted (they stay across crawls)". `reads.py` `page_detail`: one more
  statement, `notes_count(db, scope.workspace_id, project_id, url_id)`.
  `test_route_access.py`: the five rows (`GET` `data:read`, the four writes `notes:write`).
  `docs/19-api-specification.md`: in the paragraph that lists `GET` and `POST {P}/notes`, one sentence that
  the same permission guards the notes of a page and where they are. `docs/24-security.md`: the
  `notes:write` row reads "add and delete notes on a project's charts, and write notes on a page".

- [ ] **Step 5: Run the tests, expect pass. Regenerate the OpenAPI document. Run the backend commands**, with
  `src/idraft/api/audit.py src/idraft/api/main.py src/idraft/api/resources.py` added to ruff and mypy, and

```bash
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_notes.py tests/api/internal_links/test_reads_pages.py tests/api/test_audit.py tests/api/test_openapi.py tests/api/test_route_access.py
```

- [ ] **Step 6: Commit.** `git commit -m "Pages API: notes on a page, with audit entries and the count on the page detail"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: author-only
  enforcement is on the server and tested for every other role (editor, admin, owner, viewer) on change,
  and the delete rule (author, owner, admin) likewise; `can_edit` and `can_delete` say exactly what the
  writes allow; a delete is soft and no statement deletes a row; restore is only for the one who deleted
  and only for a deleted note; the body is stored as written (trimmed, line breaks kept) and nothing
  escapes, renders or strips markup on the server; the page check stops notes on addresses of other
  projects; every statement names the workspace and the project; each write and its audit entry are in one
  transaction, and a refused write records nothing; the audit snapshots hold what spec 9.7.2 lists; the
  cursor is stable over equal instants; `notes_count` does not count deleted notes and does not depend on
  the crawl in view; the chart notes routes (`api/notes/`) are untouched.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 6 (Haiku): Regenerate the web client, alone in its commit

- [ ] **Step 1:**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm gen:api
pnpm typecheck
git add src/lib/api/schema.ts
git commit -m "Regenerate the API client for the Pages routes"
```

  Run it after Task 5e, so one regeneration covers Tasks 1 to 5e.
  Expected: `schema.ts` gains the paths `…/internal-links/overview`, `…/internal-links/pages/{url_id}/search`
  and `…/internal-links/pages/{url_id}/outline`, the schemas `PagesOverview`, `PageSearchDaily`, `PageOutline`
  and `PageOutlineBody`, `PageNote`, `PageNoteList` and `PageNoteWrite`, the five note paths under
  `…/internal-links/pages/{url_id}/notes`, `notes_count?: number` on `PageDetail` (optional, as every defaulted field of
  `openapi/v1.json` is today; if it comes out required and `pnpm typecheck` fails on a mock, stop and tell the
  lead: the fix is `notes_count` in the mocked page detail in a commit of its own, not an edit of `schema.ts`),
  and `filter[view]`, `filter[folder]`, `filter[depth]` on the pages list. `pnpm typecheck` passes. If it fails, stop and report: do not edit `schema.ts` by hand.

- [ ] **Step 2: Independent senior review (Sonnet subagent).** The commit holds `schema.ts` only, and its
  diff is only additions that the backend commits of Tasks 1 to 5e explain.

- [ ] **Step 3: Fix what the review found** (regenerate again, never hand-edit), commit.

---

## Part B. Web: data, mocks and pure modules

### Task 7: Types, reads and sorts for the new API

Contracts C4, C5. Spec 7.2 (last paragraph), 7.3 (Server), 7.4.

**Files:**
- Modify: `apps/web/src/lib/internal-links/types.ts`, `queries.ts`, `queries.test.ts`
- Create: `apps/web/src/lib/internal-links/page-sorts.ts`, `search-text.ts`
- Modify: `apps/web/src/features/internal-links/url-state.ts` (re-exports only)
- Modify: `apps/web/src/features/internal-links/pages/page-filters.ts`, `page-columns.tsx`, `page-columns.test.tsx`

- [ ] **Step 1: Read first.** `lib/internal-links/queries.ts` lines 1 to 260 (`PageQuery`, `DEFAULT_PAGE_QUERY`,
  `pageParams`, `pageFilterOf`, `pagesQuery`, `pageDetailQuery`, `worklistsQuery`), `types.ts`,
  `features/internal-links/url-state.ts` (`PAGE_SORTS`, `searchText`), `pages/page-filters.ts` (`pageQueryOf`).

- [ ] **Step 2: Write the failing tests** in `queries.test.ts` (follow its existing cases for `pageParams`):
  - `pageParams` sends `filter[view]`, `filter[folder]`, `filter[depth]` and `filter[include_variants]` only
    when set, and never `filter[view]` together with `filter[worklist]` (a query with both throws
    `Error('A pages query has a view or a worklist, not both')`);
  - `pageFilterOf` carries `view`, `folder`, `depth`, and `include_variants` is the query's `includeVariants`;
  - `overviewQuery(scope, null)` and `overviewQuery(scope, 'RUN')` have different keys, both starting with
    the project key and `'internal-links'` (so `internalLinksKeys` reaches them);
  - `pageSearchQuery(scope, 'abc', null)` throws `UrlIdError` (as `pageDetailQuery` does);
  - `pageOutlineQuery(scope, '108')` has a key starting with the project key and `'internal-links'`, sends
    no `run`, and `pageOutlineQuery(scope, 'abc')` throws `UrlIdError`.
  In `page-columns.test.tsx`: `sortOfKeys([{ id: 'impressions', desc: true }])` is `'-impressions'`.

- [ ] **Step 3: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/lib/internal-links/queries.test.ts src/features/internal-links/pages/page-columns.test.tsx`

- [ ] **Step 4: Implement.**
  - `types.ts`: `export type PageView = NonNullable<PageFilter['view']>;`,
    `export type PagesOverview = Schemas['PagesOverview'];`,
    `export type PageSearchDaily = Schemas['PageSearchDaily'];`,
    `export type PageOutline = Schemas['PageOutline'];`,
    `export type PageOutlineBody = Schemas['PageOutlineBody'];`; `PageSort` gains `'impressions' | '-impressions'`.
  - `page-sorts.ts`: `export const PAGE_SORTS: readonly PageSort[]` moved here from the feature's
    `url-state.ts`, with the two new keys after `'-clicks'`. `search-text.ts`: `searchText` and its
    `MAX_SEARCH_LENGTH` moved here. The feature's `url-state.ts` re-exports both
    (`export { PAGE_SORTS } from '@/lib/internal-links/page-sorts';`), so no other import changes.
  - `queries.ts`: `const OVERVIEW = \`${P}/internal-links/overview\` as const;` and
    `const PAGE_SEARCH = \`${P}/internal-links/pages/{url_id}/search\` as const;` and
    `const PAGE_OUTLINE = \`${P}/internal-links/pages/{url_id}/outline\` as const;`;

```ts
export const overviewQuery = (scope: LinksScope, run: string | null): ApiQueryOptions<typeof OVERVIEW>;
export const pageSearchQuery = (scope: LinksScope, urlId: string, run: string | null): ApiQueryOptions<typeof PAGE_SEARCH>;
export const pageOutlineQuery = (scope: LinksScope, urlId: string): ApiQueryOptions<typeof PAGE_OUTLINE>;
```

    written as `worklistsQuery` and `pageDetailQuery` are. `PageQuery` gains the four fields of C5;
    `DEFAULT_PAGE_QUERY` sets them to `null`, `null`, `null`, `false`; `pageParams` and `pageFilterOf` send
    them.
  - `page-filters.ts` `pageQueryOf`: sets the four new fields to `null`, `null`, `null`, `false` for now
    (Task 11 gives them values). `page-columns.tsx` `SORT_FIELD`: `impressions: 'impressions'`.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** on the files of this task, and also
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/url-state.test.ts src/features/internal-links/pages/page-filters.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: types, reads and sorts for the overview, the views, the page search and the outline"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: no hand-written copy
  of a response type; the query keys; nothing else in the app imports `PAGE_SORTS` or `searchText` from a
  path that no longer exports it (`grep -rn "PAGE_SORTS\|searchText" apps/web/src`).

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 8: The mocked API

Spec section 12 ("Mock handlers for the three new routes"), 9.6.1. Contracts C2, C3, C4, C6.

**Files:**
- Create: `apps/web/src/mocks/internal-links-inventory.ts`, `internal-links-inventory.test.ts`,
  `internal-links-outline.ts`, `internal-links-outline.test.ts`
- Modify: `apps/web/src/mocks/handlers/internal-links.ts`, `apps/web/src/mocks/handlers/internal-links.test.ts`

- [ ] **Step 1: Read first.** `mocks/handlers/internal-links.ts` lines 55 to 275 (`PAGE_QUERY`, `Criteria`,
  `criteriaOfUrl`, `criteriaOfFilter`, `pageMatches`, `SORTS`, `sortRows`) and the handlers of
  `internal-links/pages`, `pages/{url_id}` and `worklists`; `mocks/internal-links-world.ts` (`crawledPages`,
  `pageRow`, `pageExtras`); how the handlers test calls a handler (`mockBrowser` of `src/test/mock-api.ts`).
  Note how a variant row is treated by the list today and keep that for a request without a view.

- [ ] **Step 2: Write the failing tests.** `internal-links-inventory.test.ts`: `sectionOfPath` over the five
  rows of C3; `viewMatches` for one row of each of the seven status groups; `overviewOf(rows)` keeps the
  invariants of spec 12 (status groups add up to `addresses`; indexable plus not indexable is live; depth
  rows add up to reachable). `handlers/internal-links.test.ts`: for every `PageView`, the overview's number
  (mapping of C2) equals `meta.total` of the list with `filter[view]`; `filter[folder]` and `filter[depth]`
  narrow the list; `filter[view]` with `filter[worklist]` is 422; `sort=-impressions` orders by impressions;
  `GET …/pages/{url_id}/search` answers `ok` with 28 days whose clicks add up to `clicks`; a viewer of
  another workspace gets 404 for the three new routes.
  `internal-links-outline.test.ts`: `outlineOf(row, runId)` for a live row is `ok` with every field of C6, its title
  text is the row's title and its `state` follows 30 and 60, `level_counts[0]` equals the H1 entries of
  `headings`, `headings_total` is at least `headings.length`; a redirect row is `redirect`, a 404 row
  `error`, both with `outline: null`; the same row always gives the same outline; `OUTLINE_LONG_PAGE` has
  more than 12 headings, `OUTLINE_NO_HTML_PAGE` answers `no_html`, `OUTLINE_PROBLEM_PAGE` has no H1, a
  description of 0 characters, one hreflang pair that is not valid, no `og_title`, one structured block that
  does not parse, `thin: true` and one image without alt text. `handlers/internal-links.test.ts`:
  `GET …/pages/{url_id}/outline` answers the outline of a page of the latest crawl whatever crawl the
  screen shows, and 404 for an id the latest crawl does not hold.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `internal-links-inventory.ts`:

```ts
export const PAGE_VIEWS: readonly PageView[];            // the 16 ids of C2, in order
export function sectionOfPath(path: string): string;      // C3
export function viewMatches(row: PageRow, view: PageView): boolean;
export function overviewOf(rows: readonly PageRow[], run: { run_id: string; finished_at: string | null; sitemap: boolean }): PagesOverview;
```

  A `PageRow` has no `resource_type`: the mock's live is counted and `status_code === 200` (say so in a
  one-line comment). `overviewOf` counts with `viewMatches` only, so the mock keeps D8 the way the API does.
  Handlers: `PAGE_QUERY` gains `'filter[view]'`, `'filter[folder]'`, `'filter[depth]'`,
  `'filter[include_variants]'`; `Criteria`, `criteriaOfUrl`, `criteriaOfFilter` and `pageMatches` gain `view`,
  `folder`, `depth`, `includeVariants`; the 422; `impressions` in the extra sorts beside `clicks`; the two new
  `mock('get', …)` handlers with `projectCaller(…, { permission: 'data:read', query: ['run'] })` and `readRun`,
  as the `worklists` handler. The search handler spreads the page's 28 day totals of `pageExtras(run, page,
  ['gsc'])` over 28 days by a fixed rule (the whole part of total over 28 on each day, the rest on the first
  days), and answers `pending` or `not_connected` when the world's `gsc` state says so.
  `internal-links-outline.ts`:

```ts
/** Three pages of the fixture crawl with a fixed outline, so each state of the tab can be opened. */
export const OUTLINE_LONG_PAGE: string;     // url id of a live page: 14 headings
export const OUTLINE_PROBLEM_PAGE: string;  // url id of a live page: one finding of every kind
export const OUTLINE_NO_HTML_PAGE: string;  // url id of a live page whose HTML was not kept
export function outlineOf(row: PageRow, runId: string): PageOutline;
```

  Choose the three ids from live pages of `crawledPages` that no existing test opens (say which in a
  comment). Every other live page gets a plain, healthy outline built from its row: the row's title, a
  description of 120 characters made from the title, one H1 (the title), four H2, `html_lang` `en`, no
  language pairs, the five sharing tags, one `WebPage` block that parses, 640 words, 4 images, none without
  alt text. No randomness. The handler is `mock('get', \`${P}/internal-links/pages/{url_id}/outline\`, …)`
  with `projectCaller(…, { permission: 'data:read', query: [] })`, reading the latest crawl of the world
  (not `readRun`), 404 for an id that crawl does not hold.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** on the four files, and
  `pnpm exec vitest run --maxWorkers=1 src/mocks/internal-links-world.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: the mocked overview, page views, page search and outline"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the mock's conditions
  against C2 line by line; the answers validate against the generated types (no cast to `unknown`); the
  existing list behaviour without the new parameters is unchanged.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 9: Tabs, the address, the path and the seams

Spec 5.1, 5.2, 7.3 (last paragraph), 9.5 (last paragraph), 9.6.3 (the first paragraph), 10. Contract C5.

**Files:**
- Create: `apps/web/src/lib/pages/tabs.ts`, `tabs.test.ts`, `url-state.ts`, `url-state.test.ts`,
  `issue-source.ts`, `tracking.ts`, `search-detail-slot.tsx`, `search-daily.ts`, `outline.ts`, `seams.test.tsx`
- Modify: `apps/web/src/lib/routes/paths.ts`, `paths.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `tabs.test.ts`: `PAGES_TABS` is `overview`, `all`, `monitoring` in that order; `livePagesTabs()` is
    `overview`, `all` (a planned tab is not listed).
  - `paths.test.ts`: `pagesTabPath('acme', 'site')` is `/acme/site/seo/pages`; with `'all'` it ends `/seo/pages/all`.
  - `url-state.test.ts`: an empty address gives `view: null`, `worklist: null`, `sort: 'path'`, `q: null`,
    `depth: null`, `variants: false`, `scope: 'editorial'`, `run: null`; `view=live` is a
    view; `view=orphans` is a worklist and `view` stays null; an unknown `view` gives both null;
    `sort=-impressions` is kept and `sort=nope` falls back to `path`; `depth=0` and `depth=6` are kept, `depth=7`,
    `depth=-1`, `depth=2.5` and `depth=x` are null; `variants=1` is true and anything else false; `q` is
    trimmed and cut at 200; `run` in upper case is lower-cased, a malformed `run` is `run: null` with
    `invalidRun` its text.
  - `seams.test.tsx` (with `renderHook` inside the providers of `src/test/render.tsx`): `useIssueTotals`,
    `usePageIssues` and `useTrackedPages` answer `{ state: 'unavailable' }`; `ISSUE_COLUMNS_AVAILABLE` and
    `TRACKING_AVAILABLE` are `false`; `issueCountsOf(row)` is `null`; `PageSearchDetailSlot` renders nothing; `usePageSearchDaily` answers
    `loading`, then `ready` with 28 days against the mocked API (page 108 of the fixture crawl), and `error`
    with a working `retry` when the route answers 500; `usePageOutline(scope, '108', true)` answers
    `loading`, then `ready` with `state: 'ok'`; with `enabled` false it stays `loading` and sends no request
    (assert with the request log of the mocked API); a 500 gives `error` with `notFound: false` and a working
    `retry`; a 404 gives `error` with `notFound: true`.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**

```ts
// tabs.ts
export type PagesTabId = 'overview' | 'all' | 'monitoring';
export interface PagesTab { id: PagesTabId; path: '' | '/all' | '/performance'; status: 'live' | 'planned' }
export const PAGES_TABS: readonly PagesTab[];   // monitoring is 'planned'
export const livePagesTabs = (): readonly PagesTab[] => PAGES_TABS.filter((tab) => tab.status === 'live');
```

  `paths.ts`: `pagesTabPath` beside `rankingsPath`, built with `projectPath`. `url-state.ts` as in C5, pure,
  with no `'use client'` (the route's redirect imports it on the server); it uses `PAGE_SORTS`, `searchText`,
  `parseLinkScope` and `isUuid`. The three seam modules exactly as spec 10.1 to 10.3 writes them, each body
  answering `unavailable` (or `false`, or `null`), each with a file comment that names its owner session and
  says "replace the body, keep the signatures". `useTrackPages` answers
  `{ track: () => Promise.reject(new Error('Tracking is not available')), pending: false }`.
  `search-daily.ts`:

```ts
/** The days of one page in Search Console (spec 9.5). The hook is the contract, not the route. */
export function usePageSearchDaily(scope: LinksScope, run: string | null, urlId: string): Seam<PageSearchDaily>;
```

  from `useQuery(pageSearchQuery(scope, urlId, run))`. If Task 5 was skipped, the lead gives the other
  session's route here instead. `outline.ts`:

```ts
export type OutlineRead =
  | { state: 'loading' }
  | { state: 'error'; notFound: boolean; retry: () => void }
  | { state: 'ready'; data: PageOutline };
/** The outline of one page, of the latest crawl (spec 9.6). Asked only while `enabled` (the tab is open). */
export function usePageOutline(scope: LinksScope, urlId: string, enabled: boolean): OutlineRead;
```

  from `useQuery({ ...pageOutlineQuery(scope, urlId), enabled })`; `notFound` is true for a 404 (use the
  error type `apiQuery` throws; find it in `lib/api`, do not test a message text).

- [ ] **Step 4: Run the tests, expect pass. Run the web commands.**

- [ ] **Step 5: Commit.** `git commit -m "Pages: tabs, address state, path and the seams of the other sessions"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: the seam signatures
  against spec 10 character by character; `lib/pages` imports nothing from `features/` or `components/`;
  `url-state.ts` has no client-only import.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 10: The view definitions and the Overview model

Spec 6.4 (strip and cards 1 to 6), 7.3 (the table), 12 (`overview-model.ts`).

**Files:**
- Create: `apps/web/src/lib/pages/views.ts`, `views.test.ts`, `overview-model.ts`, `overview-model.test.ts`

- [ ] **Step 1: Write the failing tests.**
  `views.test.ts`: the menu order is the table of spec 7.3 (Pages: all, live, indexable, not_indexable,
  redirects, errors, variants, untiered; Sitemap: the four; Reach: reachable, unreachable; Link problems: the
  six page worklists then the two edge worklists); `viewCounts` gives `all` as `addresses - status.variant`
  and every other count from the field of C2 or from the worklists read; `visibleViews` hides a view whose
  count is 0 unless it is the active one, hides the sitemap section when `sitemap.state` is `no_sitemap`,
  lists `client_errors`, `server_errors`, `blocked`, `other` only while active, and always lists `all`.
  `overview-model.test.ts`, on a fixed `PagesOverview` (the JSON of spec 6.1 made consistent):
  - the strip has five rows with their hrefs: addresses (`variants=1`), live (`view=live`), indexable,
    orphans (`view=orphans`), errors (`view=errors`, count `client_error + server_error`);
  - status rows: seven, shares of `addresses`, each href `view=<the view of C2>`; a group of 0 keeps its row
    with `count: 0`;
  - funnel: four rows, three when `no_sitemap`;
  - sections: the 8 largest, then one folded row whose count is `status.live` less the 8 and whose `href` is
    null and `folded` is `sections_total - 8`; no folded row with 8 sections or fewer; a section's href is
    `view=live&folder=<section>`; shares of live;
  - tiers: href `view=live&tier=<tier_id>`, Untiered `view=live&tier=none`;
  - depth: seven rows `depth=<n>` then `unreachable` with `tone: 'warning'` and `view=unreachable`;
  - sitemap: four rows with the four sitemap views, or `null` with `no_sitemap`;
  - every href carries `run=<id>` when a run is given and no `run` when it is null;
  - for every row with a view, the count equals the field C2 names (the web half of D8).

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**

```ts
// views.ts
export type ViewId = 'all' | 'untiered' | PageView | PageWorklist | EdgeWorklist;
export type ViewSection = 'pages' | 'sitemap' | 'reach' | 'linkProblems';
export interface ViewEntry { id: ViewId; section: ViewSection; onlyWhenActive: boolean }
export const PAGE_VIEW_MENU: readonly ViewEntry[];
export function viewCounts(overview: PagesOverview, worklists: Worklists, untiered: number | null): Partial<Record<ViewId, number>>;
export function visibleViews(counts: Partial<Record<ViewId, number>>, active: ViewId, hasSitemap: boolean): ViewEntry[];

// overview-model.ts
export interface OverviewRow {
  id: string;
  count: number;
  /** 0 to 1, of `base`; null when the base is 0. */
  share: number | null;
  base: 'addresses' | 'live';
  href: Route | null;
  tone?: 'warning';
  /** The folded sections row: how many sections it holds. */
  folded?: number;
  tier?: TierRef | null;
}
export interface OverviewModel {
  strip: OverviewRow[]; status: OverviewRow[]; funnel: OverviewRow[]; sections: OverviewRow[];
  tiers: OverviewRow[]; depth: OverviewRow[]; sitemap: OverviewRow[] | null;
}
/** `allPages` builds the address of All pages for a query (the screen passes `pagesTabPath` and the run). */
export function overviewModel(data: PagesOverview, allPages: (query: Record<string, string>) => Route): OverviewModel;
export const SECTIONS_SHOWN = 8;
```

  Row ids are the message keys Task 21 uses (`live`, `variant`, `redirected`, `client_error`, `server_error`,
  `blocked`, `other`, `addresses`, `indexable`, `in_sitemap_indexable`, …): no visible text in this module.

- [ ] **Step 4: Run the tests, expect pass. Run the web commands.**

- [ ] **Step 5: Commit.** `git commit -m "Pages: the view menu's definitions and the overview model"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: each href against
  the "Opens" column of spec 6.4, and each one names a view or filter whose list total is the row's count
  (compare with C2 and C4: a depth row filters `depth`, which already means reachable); share bases
  (status of every address, everything else of live pages).

- [ ] **Step 7: Fix what the review found**, rerun, commit.

---

## Part C. Web: the screen, the routes and the move

### Task 11: Narrow contexts for the table and the drawer

Spec 7.1 change 1, 9.2, decision D4. Contract C5. No visible change: a refactor that every existing test
must survive.

**Files:**
- Create: `apps/web/src/features/internal-links/pages/pages-context.ts`,
  `apps/web/src/features/internal-links/inspector/page-drawer-context.ts`
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `page-filters.ts`, `page-filters.test.ts`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `neighbor-section.tsx`,
  `page-inspector.test.tsx`
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `internal-links-screen.tsx`

- [ ] **Step 1: Read first.** `pages-tab.tsx`, `page-inspector.tsx`, `neighbor-section.tsx`, `tabs.ts`
  (`LinksTabContext`), `internal-links-screen.tsx` (where `context` and the `PageInspector` are built),
  `components/ui/link-button.tsx`.

- [ ] **Step 2: The types.**

```ts
// pages/pages-context.ts
export interface PagesContext {
  scope: LinksScope;
  host: string;
  timeZone: string;
  crawl: CrawlInView;
  tiers: readonly PageTier[];
  state: PagesState;
  /** The sort the address leaves out. */
  defaultSort: PageSort;
  setSearch: (values: Partial<Record<PagesKey, string | null>>, options?: { history?: 'push' | 'replace' }) => void;
  inspect: { open: (urlId: string) => void; urlId: string | null; invalid: string | null; setOrder: (urlIds: readonly string[]) => void };
  openJourney: (urlId: string) => void;
  /** Opens Internal links > Links on a link worklist, on All links. */
  openEdgeWorklist: (worklist: EdgeWorklist) => void;
  registerExport: (run: (() => Promise<void>) | null) => void;
  taxonomyHref: Route;
}
/** Until the Pages tab leaves Internal links (Task 16): the table's context from a tab's. */
export function pagesContextOf(context: LinksTabContext): PagesContext;
```

  `page-drawer-context.ts` holds `PageDrawerContext` exactly as spec 9.2 writes it, and
  `drawerContextOf(context: LinksTabContext, can: { write: boolean; note: boolean }): PageDrawerContext`
  (`canWrite` and `canNote` of spec 9.2), whose `hrefs` are built
  with `withQuery(context.hrefOf('/seo/internal-links'), …)`: `journey` is `tab=journey&focus=<id>`,
  `linksFrom` is `tab=links&src=<id>`, `linksTo` is `tab=links&tgt=<id>`; each also carries `run=<id>` when
  the crawl in view is not the latest and `scope=<scope>` when the link scope is not editorial (today's
  `setSearch` keeps both, a link must too); `issueCheck` answers `null`; `taxonomy` is
  `context.hrefOf('/settings/taxonomy')`.

- [ ] **Step 3: Change the tests first.** `page-inspector.test.tsx`: the cases that pressed "View all in
  Links" or "Open in journey" and read the written query now assert the control is a link with that `href`
  (`screen.getByRole('link', { name: … })` and `toHaveAttribute('href', …)`), for a latest crawl and for an
  older one (`run` in the href). `page-filters.test.ts`: `pageQueryOf` takes the state of C5 and passes
  `view`, `depth` and `variants` through (`includeVariants`); `folder` stays null until Task 20. Run, expect failures.

- [ ] **Step 4: Implement.**
  - `pages-tab.tsx`: `PagesTab({ context }: { context: PagesContext })`. Every use of `LinksTabContext` goes:
    `context.hrefOf(TAXONOMY_PATH)` becomes `context.taxonomyHref`; `openEdgeWorklist` is the context's;
    `DEFAULT_SORT` becomes `context.defaultSort`; `setSearch({ q })` and `setSearch({ view })` keep their
    keys. The row's "open in a new tab" keeps building its address from `window.location`.
  - `page-filters.ts`: `pageQueryOf(state: Pick<PagesState, 'scope' | 'view' | 'worklist' | 'sort' | 'q' | 'depth' | 'variants'>, values, cursor, limit, host)`.
  - `page-inspector.tsx`: `context: PageDrawerContext`; the prop `canWrite` goes (it is in the context);
    `state.scope` becomes `context.linkScope`; `context.inspect.open` becomes `context.openPage`; the two
    `viewAll` calls become hrefs; "Open in journey" becomes a `LinkButton` to `context.hrefs.journey(urlId)`;
    `taxonomyHref` is `context.hrefs.taxonomy`. `neighbor-section.tsx`: `onViewAll: () => void` becomes
    `viewAllHref: Route` and its button a link.
  - `tabs.ts`: the `pages` entry renders `createElement(PagesTab, { context: pagesContextOf(context) })`.
    `internal-links-screen.tsx`: passes `drawerContextOf(context, { write: canWrite, note: useCan('notes:write') })`
    to `PageInspector` (call the hook at the top of the component, beside `canWrite`).
  - Every other caller of `PageInspector` or `NeighborSection` (`grep -rn "PageInspector\|NeighborSection" apps/web/src`)
    is updated the same way.

- [ ] **Step 5: Run** the tests of the feature that touch these files, one file at a time:
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector src/features/internal-links/pages`
  then `src/features/internal-links/internal-links-screen.test.tsx`. Expect pass. Run the web commands.

- [ ] **Step 6: Commit.** `git commit -m "Pages: the table and the page drawer take narrow contexts, exits become links"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: nothing a person sees
  changed except that three exits are links (they open in a new tab, carry the crawl and the scope, and are
  announced as links); `PagesTab` and `PageInspector` import nothing of `LinksTabContext`; no shared drawer
  file was edited.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 12: The crawl shell both screens use, and a one-line header

Spec 6.4 (states), 8 (the toolbar row). A refactor of Internal links with one addition: every existing test
passes unchanged, and Internal links looks the same. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/crawl-shell.tsx`, `crawl-shell.test.tsx`
- Modify: `apps/web/src/features/internal-links/internal-links-screen.tsx`
- Modify: `apps/web/src/features/internal-links/crawl-header.tsx`, `crawl-header.test.tsx`

- [ ] **Step 1: Read first.** `internal-links-screen.tsx` whole, `crawl-reads.ts`, `crawl-states.tsx`,
  `crawl-header.tsx`, `lib/internal-links/crawl-choice.ts`.

- [ ] **Step 2: Write the failing tests.**
  - `crawl-header.test.tsx`: with `layout="one-line"` the context (the picker and the context line) is in the
    same row as the tabs and the actions, between them, and scrolls sideways inside its own room instead of
    wrapping; without the prop the header is exactly as today (the existing cases stay untouched).
  - `crawl-shell.test.tsx` (a small component that calls the hook, rendered with the providers and the
    fixture projects of `src/test/internal-links-harness.tsx`): `stateBody` is null for a crawl that can be
    read and `view.kind` is `ready`; it is the no website, never crawled, first crawl and failed first crawl
    state for those scenarios (`setLinksScenario`); `inView` follows the `run` given; the end of a crawl is
    announced once.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**

```ts
// crawl-shell.tsx
export interface CrawlShellInput {
  workspaceId: string;
  workspaceSlug: string;
  project: InternalLinksProject;
  /** The crawl the address chooses, or null for the latest. */
  run: string | null;
  /** Buttons of the first crawl state (tier rules, import); the screen decides. */
  firstCrawlActions?: ReactNode;
}
export interface CrawlShell {
  scope: LinksScope;
  host: string;
  view: CrawlView;
  /** The crawl every read is made against. */
  inView: CrawlInView;
  runs: readonly CrawlRun[];
  tiers: readonly PageTier[];
  crawl: ReturnType<typeof useCrawlNow>;
  canCrawl: boolean;
  canEditTiers: boolean;
  /** The "crawls are not switched on" notice, or null. */
  notice: ReactElement | null;
  /** The body of every state but `ready`; null when the crawl can be read. */
  stateBody: ReactNode | null;
  /** The banners over a crawl that can be read (a newer crawl running or failed). */
  banners: ReactNode;
  hrefs: { settings: Route; tiers: Route; domains: Route };
}
export function useCrawlShell(input: CrawlShellInput): CrawlShell;
/** The page's Export: a tab registers its download, the header runs it once at a time. */
export function usePageExport(): {
  registerExport: (run: (() => Promise<void>) | null) => void;
  onExport: (() => void) | null;
  exporting: boolean;
};
```

  Both are the code of `InternalLinksContent`, moved, not rewritten: `useCrawls` with its announcement,
  `useWorkspaceTiers`, `crawlView`, `useCrawlNow`, `crawlInView`, the notice, the `switch` over `view.kind`
  for every case but `ready`, `CrawlBanners`, and the export block with its toast. `InternalLinksContent`
  then calls them. `crawl-header.tsx`: `layout?: 'two-line' | 'one-line'` (default `two-line`); with
  `one-line` the context is drawn inside the first row, after the tabs, in a
  `min-w-0 flex-1 overflow-x-auto scrollbar-none` container, and no second row exists.

- [ ] **Step 5: Run**, one command each: `src/features/internal-links/crawl-shell.test.tsx`,
  `crawl-header.test.tsx`, `internal-links-screen.test.tsx`, `states.test.tsx`, `crawl-in-view.test.tsx`,
  `crawl-context.test.tsx`, `blocked-pages.test.tsx`. Expect pass with no change to the last five files.
  Run the web commands.

- [ ] **Step 6: Commit.** `git commit -m "Internal links: the crawl shell as one hook, and a one-line crawl header"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the moved code is
  the same code (compare with `git show HEAD -M --stat` and the removed lines of `internal-links-screen.tsx`);
  no test of Internal links was edited; the default header is byte for byte the old markup; the one-line
  context can be reached and scrolled with the keyboard.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 13: The Pages screen

Spec 5.1, 5.2, 6.4 (strip and states), 8, 9.1. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/pages-page/pages-screen.tsx`, `use-pages-state.ts`,
  `overview-tab.tsx`, `pages-screen.test.tsx`
- Create: `apps/web/src/test/pages-harness.tsx`
- Not touched: `internal-links-screen.tsx`, `crawl-shell.tsx`, `crawl-header.tsx` (Task 12 made what this
  task needs; if something is missing there, stop and tell the lead)
- Modify: `apps/web/src/features/internal-links/index.ts` (export `PagesScreen`)
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `crawl-shell.tsx` (`useCrawlShell`, `usePageExport`, from Task 12) and
  `internal-links-screen.tsx` whole (how it uses them, and its inspector host, which this screen repeats with
  its own context), `crawl-header.tsx` (`layout="one-line"`), `components/app/shell/tab-nav.tsx`,
  `features/citations/board-screen.tsx` lines 220 to 360 (segmented route tabs in a fixed-height page),
  `components/app/metric/metric-strip.tsx`, `src/test/internal-links-harness.tsx`.

- [ ] **Step 2: Words.** Add the namespace `pages` to `messages/en.json`:

| Key | Text |
|---|---|
| `pages.title` | Pages |
| `pages.tabs.label` | Pages views |
| `pages.tabs.overview` | Overview |
| `pages.tabs.all` | All pages |
| `pages.strip.label` | Page counts of this crawl |
| `pages.strip.addresses` | Addresses crawled |
| `pages.strip.live` | Live pages |
| `pages.strip.indexable` | Indexable |
| `pages.strip.orphans` | Orphan pages |
| `pages.strip.errors` | Error pages |
| `pages.strip.withIssue` | Pages with an issue |
| `pages.strip.addressesTip` | Every address the crawl read, parameter variants included |
| `pages.strip.liveTip` | Pages that answered 200 with HTML, of every address |
| `pages.strip.liveBaseTip` | Of live pages |
| `pages.overview.loadFailed` | The page counts could not be loaded |
| `pages.overview.loadFailedReason` | Try again. If it keeps failing, the crawl may still be saving. |

  The crawl states keep their keys under `internalLinks.states`, `internalLinks.header` and
  `internalLinks.noAccess*`.

- [ ] **Step 3: Write the failing tests** in `pages-screen.test.tsx` with `pagesAs`:
  - a viewer on the Eventus fixture, tab `overview`: the navigation "Pages views" lists Overview (current)
    and All pages as links, and no Monitoring; the strip shows five numbers that equal the mocked overview
    read, each a link to All pages with the query of Task 10; there is no sixth number;
  - the All pages link carries `run` when the address has one, and nothing else;
  - tab `all` renders the grid named "Pages" with rows;
  - no `data:read`: the no access state; no website, never crawled, first crawl running, first crawl failed:
    the same states as Internal links (reuse the scenarios `states.test.tsx` sets with `setLinksScenario`);
  - the overview read failing shows the inline error with a retry that works;
  - `?inspect=page:108` opens the page drawer on both tabs; `?run=<unknown id>` shows the crawl not found
    state and no drawer;
  - `axe` finds nothing on each tab.

- [ ] **Step 4: Implement.**
  - `use-pages-state.ts` (`'use client'`): `usePagesState(): { state: PagesState; setSearch }` with nuqs
    `useQueryStates` over the keys of `PagesKey`, as `useLinksState`.
  - `pages-harness.tsx`: `pagesAs(role, tab, current = EVENTUS_LINKS)`, a copy of `internalLinksAs` that
    renders `PagesScreen`.
  - `pages-screen.tsx`: `PagesScreen` with the props of C5. The access check is the one of
    `InternalLinksScreen` (`useCan('data:read')`, the same empty state). The crawl reads, the states and the
    notice come from `useCrawlShell`, the export wiring from `usePageExport`; nothing of them is written
    again here. The page is
    `flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5` inside
    `InspectorLayout`, with no visible title (`PageToolbar` as Internal links uses it; the heading stays for
    assistive technology). The toolbar row is `CrawlHeader` with `layout="one-line"` (one 36 px row: spec
    section 8 counts on it) and `tabs` a
    `<TabNav variant="segmented" label={t('tabs.label')} items={…livePagesTabs()…} />` whose hrefs are
    `pagesTabPath` plus `run` when chosen, the `CrawlPicker`, `ContextLine` (its `untieredHref` is All pages
    with `tier=none`, its `changesHref` Internal links with `tab=changes`), Crawl now, Export and the menu
    (settings and tiers links; no summary, no share: pass `null`). The body is `OverviewTab` or
    `PagesTab` with a `PagesContext` built here: `defaultSort` is `PAGES_DEFAULT_SORT`; `openJourney` and
    `openEdgeWorklist` navigate with `useRouter().push` to Internal links (`tab=journey&focus=<id>`,
    `tab=links&lview=<worklist>&scope=all`), carrying `run`. The drawer host is the block of
    `InternalLinksScreen` with a `PageDrawerContext` whose hrefs point at Internal links.
  - `overview-tab.tsx`: `OverviewTab({ scope, run, allPages })` reads `overviewQuery`, builds
    `overviewModel`, and draws the strip (`MetricStrip size="md"`, one group, each item with `href` and
    `tip`) inside the scroll container `min-h-0 flex-1 overflow-y-auto`. The sixth number is added only when
    `useIssueTotals` answers `ready` (its href is `projectPath(…, '/seo/issues')`). Loading: the strip's own
    loading state. The cards come in Tasks 21 and 22.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands**, and
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/internal-links-screen.test.tsx src/features/internal-links/states.test.tsx src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: the screen with its tabs, the crawl states and the overview strip"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the crawl shell is
  shared with Internal links, not copied; the fixed-height layout classes are exactly those of spec 8; the
  toolbar is one row at `md` and wider, so that the sum of spec 8 (52, 12, 36, 12, 48, 64) puts the first
  row at 224 px; a
  planned tab is absent, not disabled; each strip number is a link with a name that says where it goes;
  nothing but `run` travels between the two tabs; no shared drawer file edited.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 14: The two routes and the sidebar entry

Spec 5.1, 5.4, 14 (the `registry.ts` row), 16 (routes and sidebar).

**Files:**
- Create: `apps/web/src/app/[workspace]/[project]/seo/pages/page.tsx`, `page.test.tsx`,
  `apps/web/src/app/[workspace]/[project]/seo/pages/all/page.tsx`, `all/page.test.tsx`
- Modify: `apps/web/src/lib/navigation/registry.ts`, `registry.test.ts`,
  `apps/web/src/features/shell/project-shell.test.tsx`
- Modify: `docs/design-system/11-navigation.md`

- [ ] **Step 1: Write the failing tests.** The two `page.test.tsx` are copies of
  `seo/internal-links/page.test.tsx` that expect `PagesScreen` with `tab: 'overview'` and `tab: 'all'`, the
  metadata title `pages.title`, and `notFound` for a project the member cannot open. `registry.test.ts`:
  `pages` is in `LIVE_NAVIGATION`, between `keywords` and `internalLinks` in the group `seo`;
  `destinationOf(LIVE_NAVIGATION, '/digibranders/fynix/seo/pages', …)` and the same with `/seo/pages/all`
  answer the `pages` entry (the test at line 223 expected `null`). `project-shell.test.tsx`: the sidebar
  lists "Pages /digibranders/fynix/seo/pages" before Internal links, and the case at line 350 follows.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.** `page.tsx` files copy `seo/internal-links/page.tsx` (membership, project lookup,
  `notFound`), typed `PageProps<'/[workspace]/[project]/seo/pages'>` and `…/seo/pages/all'>`, rendering
  `PagesScreen`. No `performance` folder. `registry.ts`: the `pages` entry gets `status: 'live'`; nothing else
  in that file changes (the Issues branch regroups it; see spec 14). `11-navigation.md`: in the table row
  "SEO > Pages" the tabs become "Overview, All pages, Monitoring (Monitoring is listed once it exists)", and
  in the row "SEO > Internal links" the word "Pages," stays until Task 16.

- [ ] **Step 4: Run the tests, expect pass. Run the web commands** (`pnpm typecheck` generates the route
  types first).

- [ ] **Step 5: Commit.** `git commit -m "Pages: the routes /seo/pages and /seo/pages/all, live in the sidebar"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: the diff of
  `registry.ts` is the one word; no route for Monitoring; the pages read no search parameter.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 15: Point the table's tests at All pages

The Pages table is now reachable two ways. Before it leaves Internal links, its tests move to the new host,
with no change to what they assert.

**Files (tests only):**
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.test.tsx`, `bulk.test.tsx`,
  `pages-extras.test.tsx`, `pages-tab-loop.test.tsx`, `tier-suggestions.test.tsx`,
  `apps/web/src/features/internal-links/inspector/page-inspector.test.tsx`
- Find the rest with `grep -rln "internalLinksAs" apps/web/src --include='*.test.tsx'`: a file of that list
  that reaches the Pages grid or the page inspector with no `tab` in its address belongs here too. The files
  about the Internal links screen itself (`internal-links-screen.test.tsx`, `states.test.tsx`,
  `crawl-header.test.tsx`, `crawl-in-view.test.tsx`, `crawl-context.test.tsx`, `rules/dialogs.test.tsx`,
  `export/client-summary-menu.test.tsx`) are Task 16's.

- [ ] **Step 1:** In each file that renders `internalLinksAs(…)` to reach the Pages table or the page
  inspector on the default tab, render `pagesAs(role, 'all', project)` instead, and change the mocked
  `usePathname` to `/digibranders/eventus-security/seo/pages/all`. A case that sets `tab=links`,
  `tab=journey` or another tab of Internal links stays on `internalLinksAs`. Two differences are expected
  and are the only assertions that may change: the default sort is `path` (a case that relied on
  `-linking_pages` as the default now passes `sort=-linking_pages` in its `searchParams`, or asserts the
  path order), and "Open in journey" and the link worklists navigate (assert `router.push` was called with
  the Internal links address) instead of writing `tab`.

- [ ] **Step 2: Run each file alone**, for example
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages/pages-tab.test.tsx`. Expect pass. A
  case that fails for another reason is a bug of Task 11 or 13: fix it there (in the component), not by
  weakening the test, and say so in the commit body.

- [ ] **Step 3: Run the web commands** on the changed files.

- [ ] **Step 4: Commit.** `git commit -m "Pages: the table's tests run on All pages"`.

- [ ] **Step 5: Independent senior review (Sonnet subagent).** Besides the common list: no assertion was
  removed or loosened except the two expected differences; every case of the listed files still exists
  (compare the `it(` counts before and after with `git show HEAD --stat` and a grep).

- [ ] **Step 6: Fix what the review found**, rerun, commit.

### Task 16: The Pages tab leaves Internal links, with the redirect

Spec 5.3, decision D2, 15 point 4, 16 (the redirect line).

**Files:**
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `tabs.test.ts`, `url-state.ts`, `url-state.test.ts`,
  `internal-links-screen.tsx`, `internal-links-screen.test.tsx`, `pages/pages-context.ts`
- Modify: `apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx`, `page.test.tsx`
- Modify: `apps/web/messages/en.json` (remove `internalLinks.tabs.pages`), `docs/design-system/11-navigation.md`
- Modify (not run here): `apps/web/e2e/support/internal-links.ts`, `apps/web/e2e/flows/internal-links.spec.ts`,
  `apps/web/e2e/visual/pages.spec.ts`

- [ ] **Step 1: Check the redirect rule again** (spec 5.3 asks the plan to repeat it):
  `grep -rn "setSearch(" apps/web/src/features/internal-links/journey apps/web/src/features/internal-links/map apps/web/src/features/internal-links/flow apps/web/src/features/internal-links/changes apps/web/src/features/internal-links/opportunities apps/web/src/features/internal-links/links`
  and `grep -rn "useUrlFilters\|useQueryStates" apps/web/src/features/internal-links --include='*.tsx' -l`.
  Journey, which becomes the default tab and so has no `tab` key, must write none of `PAGES_REDIRECT_KEYS`.
  If it writes one, stop and tell the lead: the rule of spec 5.3 would then redirect a Journey address.

- [ ] **Step 2: Write the failing tests.**
  - `seo/internal-links/page.test.tsx`, a table of addresses: `tab=pages` goes to `/seo/pages/all` with `tab`
    dropped; `tab=pages&view=orphans&tier=none` goes to `/seo/pages/all?view=orphans&tier=none`; each of
    `view`, `sort`, `q`, `tier`, `tag`, `status`, `idx`, `flag`, `cols`, `density` alone (no `tab`) redirects
    with the key kept; `inspect=page:108&itab=links&q=x` keeps all three; a repeated key (`tier=a&tier=b`)
    stays repeated; a bare address renders the screen; `focus=103&jv=tree&open=o%3A108` renders the screen;
    `tab=links&q=x&cols=a&density=default` renders the screen. Mock `redirect` of `next/navigation` to throw
    an error that carries its argument, as the file mocks `notFound`.
  - `tabs.test.ts` and `url-state.test.ts`: no `pages` id; the order is Journey, Link map, Links, Tier flow,
    Changes, Opportunities; an absent or unknown `tab` is `journey`.
  - `internal-links-screen.test.tsx`: a bare address opens Journey; no tab named Pages; choosing Journey
    writes no `tab` key; the context line's Untiered link goes to `/seo/pages/all?tier=none`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  - `page.tsx`: reads `searchParams` and, before anything else,

```ts
const query = await searchParams;
const moved = query.tab === 'pages' || (query.tab === undefined && PAGES_REDIRECT_KEYS.some((key) => query[key] !== undefined));
if (moved) redirect(withQuery(pagesTabPath(workspace, project, 'all'), queryOf(query, ['tab'])));
```

    and its file comment no longer says the page reads no search parameter.
  - `tabs.ts`: the `pages` entry, its import and its place in `ORDER` go; `ORDER` is journey 0, map 1,
    links 2, flow 3, changes 4, opportunities 5. `url-state.ts`: `LinksTabId` and `TABS` lose `pages`; the
    default is `journey`; `worklist`, `sort` and `q` leave `LinksState`, and `view`, `sort`, `q` leave
    `LinksKey` and `PARSERS` (only the old tab used them: confirm with a grep before removing each).
    `internal-links-screen.tsx`: the three `'pages'` fallbacks become `'journey'`; a tab change writes
    `tab: next === 'journey' ? null : next`; `untieredHref` is
    `withQuery(pagesTabPath(workspaceSlug, project.slug, 'all'), UNTIERED_QUERY)`. `pages-context.ts`:
    `pagesContextOf` is deleted (nothing uses it now).
  - `messages/en.json`: remove `internalLinks.tabs.pages`. `11-navigation.md`: the tabs of
    "SEO > Internal links" become Journey, Link map, Links, Tier flow, Changes, Opportunities, and the
    "As built" paragraph gets one sentence: the Pages tab moved to SEO > Pages > All pages on 2026-11-26,
    and old addresses redirect.
  - The e2e files: every step that opens Internal links to reach the Pages grid opens
    `/digibranders/eventus-security/seo/pages/all` instead (`pagesGrid`, `expectPagesLoaded`,
    `waitForState('pages')`, the visual page of the Pages tab). Do not run them. Tell the lead in the commit
    body that the visual snapshots of that page need regenerating in the main checkout.

- [ ] **Step 5: Run the tests of the feature folder by folder**, one command each:
  `src/features/internal-links/tabs.test.ts src/features/internal-links/url-state.test.ts`, then
  `internal-links-screen.test.tsx`, `states.test.tsx`, `crawl-header.test.tsx`, `crawl-in-view.test.tsx`,
  `crawl-context.test.tsx`, then the route test, then `src/i18n/messages.test.ts`. A test that relied on the
  default tab being Pages is updated to name the tab it means. Run the web commands (eslint also on the
  three e2e files).

- [ ] **Step 6: Commit.** `git commit -m "Internal links: the Pages tab moves to Pages > All pages, old addresses redirect"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the redirect table
  of spec 5.3 row by row; a Journey, Links or Opportunities address never redirects; every key but `tab`
  survives the redirect, `inspect` and `itab` included; `grep -rn "'pages'" apps/web/src/features/internal-links`
  finds no leftover of the tab id; no link in the app still points at the old tab
  (`grep -rn "seo/internal-links" apps/web/src --include='*.tsx' --include='*.ts'`).

- [ ] **Step 8: Fix what the review found**, rerun, commit.

---

## Part D. Web: All pages

### Task 17: `DataTable` gets a start slot and grouped columns in the chooser

Spec 7.1 changes 3 and 6. These are shared components: add only what is listed, change no existing
behaviour, and keep every existing test of the folder passing untouched. UI task.

**Files:**
- Modify: `apps/web/src/components/app/data-table/types.ts`, `toolbar.tsx`, `toolbar.test.tsx`,
  `data-table.tsx`, `data-table.test.tsx`, `column-chooser.tsx`, `column-chooser.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - `toolbar.test.tsx`: a `start` node is drawn before the search box (in DOM order) and the bar without one
    is unchanged.
  - `data-table.test.tsx`: `toolbarStart` reaches the toolbar; with `columnGroups` and grouped columns the
    column chooser shows each group's label as a heading over its columns.
  - `column-chooser.test.tsx`: columns with `group` labels `A, A, B` draw two headings, in order; a column
    without a group draws none; with no `group` anywhere the list is exactly as before; the headings are not
    tab stops and each checkbox keeps its own accessible name; moving a column still announces its place.

- [ ] **Step 2: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/components/app/data-table/toolbar.test.tsx src/components/app/data-table/column-chooser.test.tsx`

- [ ] **Step 3: Implement.**
  - `types.ts`: `/** A slot at the start of the toolbar, before the search box: the view menu. */ toolbarStart?: ReactNode;`
    beside `toolbarEnd`.
  - `toolbar.tsx`: `start?: ReactNode` in `DataTableToolbarProps`, drawn first in the bar.
    `data-table.tsx`: passes `start={toolbarStart}`.
  - `column-chooser.tsx`: `ColumnChooserColumn` gains `group?: string | undefined` (the translated label).
    Before the first column of each run that shares a group, one `<li role="presentation">` with the label in
    `type-label text-foreground-tertiary` and the list's own padding. `data-table.tsx` sets `group` on the
    chooser columns from `column.group?.label` only when `columnGroups` is on.

- [ ] **Step 4: Run** the three test files, then
  `pnpm exec vitest run --maxWorkers=1 src/components/app/data-table`. Expect pass. Run the web commands.

- [ ] **Step 5: Commit.** `git commit -m "DataTable: a toolbar start slot, and the column chooser shows column groups"`.

- [ ] **Step 6: Independent senior review (Sonnet subagent).** Besides the common list: both additions are
  opt in and a table that passes neither renders the same markup as before; the chooser's list is still one
  list for assistive technology; no token or spacing invented.

- [ ] **Step 7: Fix what the review found**, rerun, commit.

### Task 18: All pages, the toolbar and the columns

Spec 7.1 changes 3, 5 and 6, 7.2, 8. UI task.

**Files:**
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `page-columns.tsx`,
  `page-extras-cells.tsx`, `page-columns.test.tsx`, `pages-tab.test.tsx`, `pages-extras.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words.**

| Key | Text |
|---|---|
| `pages.groups.page` | Page |
| `pages.groups.indexing` | Indexing |
| `pages.groups.issues` | Issues |
| `pages.groups.search` | Search |
| `pages.groups.ai` | AI |
| `pages.groups.links` | Links |
| `internalLinks.columns.reason` (changed) | Indexable |
| `internalLinks.columns.canonical` | Canonical |
| `internalLinks.columns.canonicalSelf` | This page |
| `internalLinks.columns.clicksTip` | Google Search clicks on this page in the last 28 days, from Search Console |
| `internalLinks.columns.impressionsTip` | Times this page was shown in Google Search in the last 28 days, from Search Console |

- [ ] **Step 2: Write the failing tests.**
  - `page-columns.test.tsx`: the columns come in the order and with the group of the table of spec 7.2; the
    default visible set is `page`, `tier`, `status`, `reason`, `flags`, `clicks`; `canonical` shows the
    canonical address, "This page" when it equals the row's `url`, and the "none" text when null, and does
    not sort; `clicks` and `impressions` carry the new tooltips; `impressions` sorts.
  - `pages-tab.test.tsx`: the header has the group cells Page, Indexing, Search (a group with one shown
    column draws no group cell: with the default set that is Issues, and AI and Links are not shown); the
    filter bar's "+ Filter" and the Columns button are inside the table's toolbar and no filter row exists
    outside the table; the link scope menu is absent with the default columns and present after `cols` shows
    `linking`; choosing a filter draws its chip in the toolbar; the Columns menu lists the group headings;
    with no `sort` in the address the request asks for `sort=path`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  - `page-columns.tsx`: `pageColumns` takes one more translator, `groups: (id: 'page' | 'indexing' | 'issues' | 'search' | 'ai' | 'links') => string`
    (the screen passes `useTranslations('pages.groups')`), sets `group: { id, label }` on every column, and
    returns them in the order of spec 7.2: Page (`page`, `tier`, `status`, `tags`), Indexing (`reason`,
    `canonical`, `sitemap`), Issues (`flags`), Search (`clicks`, `impressions`, `keywords`, `rank`), AI
    (`citations`), Links (`depth`, `linking`, `fromTiers`, `outlinks`, `change`, `toT1`, `broken`,
    `redirects`, `nonIndexable`, `topAnchor`, `anchors`, `matches`). `defaultVisible` is true only for
    `tier`, `status`, `reason`, `flags`, `clicks` (and the identity column). The new `canonical` column is a
    `col.text`.
  - `pages-tab.tsx`: `columnGroups`, `compactToolbar` and `toolbarParts={{ sortNote: false }}` on the table;
    the `div` with `FilterBar` and `ScopeMenu` goes, and `toolbarEnd` is
    `<><FilterBar compact fields={fields} values={values} onChange={setValues} />{scopeShown ? <ScopeMenu … /> : null}</>`
    where `scopeShown` is true while `visible` holds `linking`, `fromTiers` or `outlinks`. The root stays a
    column that fills the height the screen gives it (`flex min-h-0 flex-1 flex-col gap-3`), so the table
    scrolls inside its panel.
  - `FilterBar` is not changed. If the bar does not sit in the end slot without breaking the toolbar at
    1280 px wide, stop and report to the lead with a screenshot description; do not edit `filter-bar.tsx`.

- [ ] **Step 5: Run the tests of `src/features/internal-links/pages` one file at a time, expect pass. Run the
  web commands**, and `src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`.

- [ ] **Step 6: Commit.** `git commit -m "All pages: column groups, the filter bar in the table toolbar, sorted by address"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the column table of
  spec 7.2 row by row (group, id, default); nothing sits between the page toolbar and the table panel except
  the worklist chips, which Task 19 removes; an old address with `cols=` still shows the columns it names;
  the tooltips say "last 28 days" and "Search Console".

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 19: The View menu replaces the worklist chips

Spec 7.1 change 2, 7.3, 11 (the announcement). UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/pages/view-menu.tsx`, `view-menu.test.tsx`
- Delete: `apps/web/src/features/internal-links/pages/worklist-chips.tsx`
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `pages-tab.test.tsx`,
  `variants-chip.test.tsx`, `tier-suggestions.test.tsx`, `page-filters.ts`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `worklist-chips.tsx` (everything it draws: the six page lists with counts, the
  two link lists, the important tiers name, the variants count, the coverage note, the "no issues" text,
  `TierSuggestions` with `onEmptied`), `components/ui/menu.tsx` (`MenuItemDef`: `kind: 'radio'`, `group`,
  `detail`, `closeOnClick`), `lib/pages/views.ts`, `context-line.tsx` and `lib/internal-links/context-stats.ts`
  (where the tiered and untiered counts come from).

- [ ] **Step 2: Words.**

| Key | Text |
|---|---|
| `pages.view.trigger` | View: {view} |
| `pages.view.label` | View |
| `pages.view.sections.pages` | Pages |
| `pages.view.sections.sitemap` | Sitemap |
| `pages.view.sections.reach` | Reach |
| `pages.view.sections.linkProblems` | Link problems |
| `pages.view.all` | All pages |
| `pages.view.live` | Live pages |
| `pages.view.indexable` | Indexable |
| `pages.view.not_indexable` | Not indexable |
| `pages.view.redirects` | Redirects |
| `pages.view.errors` | Error pages |
| `pages.view.client_errors` | Client errors |
| `pages.view.server_errors` | Server errors |
| `pages.view.blocked` | Blocked |
| `pages.view.other` | Other addresses |
| `pages.view.variants` | Parameter variants |
| `pages.view.untiered` | Untiered |
| `pages.view.in_sitemap_indexable` | Indexable and in the sitemap |
| `pages.view.not_in_sitemap` | Missing from the sitemap |
| `pages.view.sitemap_not_live` | In the sitemap, not live |
| `pages.view.sitemap_not_indexable` | In the sitemap, not indexable |
| `pages.view.reachable` | Reachable by links |
| `pages.view.unreachable` | Not reachable by links |
| `pages.view.opensLinks` | Opens Internal links, Links |
| `pages.view.announce` | {view}: {count, plural, one {# page} other {# pages}} |

  The six page worklists and the two link worklists keep their names under `internalLinks.worklists.*`. The
  coverage line is `internalLinks.coverage.incomplete` and the empty Link problems line is
  `internalLinks.pages.noIssues`, both unchanged.

- [ ] **Step 3: Write the failing tests.**
  - `view-menu.test.tsx`: the trigger reads "View: All pages" with no `view`; the menu lists the sections
    and views of spec 7.3 in order, each with its count as the item's detail; a view with 0 is absent unless
    active; with `no_sitemap` there is no Sitemap section; `client_errors` is listed only when the address
    has `view=client_errors`; Parameter variants is listed while its count is above 0; choosing Live pages
    writes `view=live` with a history entry and announces "Live pages: 389 pages"; choosing All pages clears
    `view`; choosing Untiered writes the filter `tier=none` and clears `view`; choosing a page worklist writes
    `view=<worklist>`; choosing a link worklist calls `openEdgeWorklist`; while the counts load the items show
    no count and are still choosable; the coverage line shows when `may_be_incomplete`; the menu is one tab
    stop and works with arrow keys and Enter.
  - `pages-tab.test.tsx`: no group named by `internalLinks.pages.worklistsLabel` exists; `view=live` in the
    address sends `filter[view]=live`; `view=orphans` sends `filter[worklist]=orphans`; the "Suggested tiers"
    chip sits in the table toolbar and, when its last row leaves, focus goes to the View button.
  - `variants-chip.test.tsx` and `tier-suggestions.test.tsx`: updated to reach the same things through the
    menu and the toolbar.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `view-menu.tsx`:

```ts
export interface ViewMenuProps {
  scope: LinksScope;
  run: string | null;
  linksAvailable: boolean;
  state: Pick<PagesState, 'view' | 'worklist'>;
  untieredActive: boolean;
  onView: (view: PageView | PageWorklist | null) => void;
  onUntiered: () => void;
  onEdgeWorklist: (worklist: EdgeWorklist) => void;
  /** The trigger, so the caller can send focus to it. */
  triggerRef?: Ref<HTMLButtonElement>;
}
export function ViewMenu(props: ViewMenuProps): ReactElement;
```

  It reads `overviewQuery`, `worklistsQuery` and the tier read `ContextLine` uses (shared through the query
  cache), builds the items with `PAGE_VIEW_MENU`, `viewCounts` and `visibleViews`, and draws a `Menu` whose
  trigger is a secondary `sm` button. Items are `kind: 'radio'` with `closeOnClick`, `group` the section
  name, `detail` the formatted count; the two link worklists are `kind: 'action'` with `description` from
  `pages.view.opensLinks`. `weak_outlinks` is left out when `linksAvailable` is false and `lost_links_top`
  takes its name from `useImportantTiers`, as the chips did. `pages-tab.tsx`: `WorklistChips` goes;
  `toolbarStart` is the `ViewMenu`; `toolbarEnd` starts with `<TierSuggestions scope={scope} onEmptied={focusView} />`;
  `pageQueryOf` already sends `view` or `worklist` (Task 11); a change of view calls
  `announce(t('view.announce', …))` once the new total is known (`lib/a11y/announcer`). `filtered`, `clear`
  and the filtered-empty state treat a server view as they treat a worklist ("Show all pages" clears it).
  Delete `worklist-chips.tsx` and the message keys only it used (`internalLinks.pages.worklistsLabel`,
  `allPages`, `variantsLink`, `linkCount`), after a grep shows no other user.

- [ ] **Step 6: Run the tests of the folder one file at a time, expect pass. Run the web commands** and the
  two message tests.

- [ ] **Step 7: Commit.** `git commit -m "All pages: one View menu with counts replaces the worklist chips"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the menu against the
  table of spec 7.3 (sections, ids, where each count comes from); every count shown is the total the list
  then shows; nothing the chip row held was lost (the spec's list in 7.1 change 2); the web never sends
  `filter[view]` and `filter[worklist]` together; the announcement fires once per change; no chip row is
  left above the table.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 20: Folder, depth and variants on All pages, and the two seams

Spec 7.2 (Issues and Tracked rows), 7.4, 7.5, 10.1, 10.2, decision D10. UI task.

**Files:**
- Modify: `apps/web/src/features/internal-links/pages/page-filters.ts`, `page-filters.test.ts`,
  `pages-tab.tsx`, `pages-tab.test.tsx`, `page-columns.tsx`, `page-columns.test.tsx`, `bulk.test.tsx`
- Create: `apps/web/src/features/internal-links/pages/seam-columns.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words.**

| Key | Text |
|---|---|
| `pages.filters.folder` | Folder |
| `pages.filters.depthChip` | {depth, plural, =0 {Home page} =6 {6 clicks and more from the home page} one {# click from the home page} other {# clicks from the home page}} |
| `pages.filters.variantsChip` | With parameter variants |
| `pages.filters.remove` | Remove the filter {filter} |
| `pages.columns.issues` | Issues |
| `pages.columns.issuesTip` | Issues found on this page, from the Issues page |
| `pages.columns.tracked` | Tracked |
| `pages.columns.trackedYes` | Tracked |
| `pages.columns.trackedNo` | Not tracked |
| `pages.track.action` | Track in Monitoring |
| `pages.track.onlySelection` | Choose the pages one by one to track them |
| `pages.track.done` | {added, plural, one {# page added} other {# pages added}} |
| `pages.track.already` | {count} already tracked |
| `pages.track.notLive` | {count} not added: not a live page |
| `pages.track.overLimit` | {count} not added: the limit is {limit} pages |
| `pages.track.failed` | The pages could not be tracked |

- [ ] **Step 2: Write the failing tests.**
  - `page-filters.test.ts`: `pageFilterFields` gets the sections and returns a `folder` field (single
    choice) with one option per section, largest first, labelled with the section itself; `pageQueryOf`
    sends `folder` from the filter value (only a value that starts with `/` and has at most 200 characters),
    and `depth` and `variants` from the state.
  - `pages-tab.test.tsx`: choosing a folder sends `filter[folder]`; `?depth=3` sends `filter[depth]=3` and
    draws a removable chip "3 clicks from the home page" whose button clears `depth`; `?variants=1` sends
    `filter[include_variants]=true` with its chip; the CSV export carries `filter[view]`, `filter[folder]`
    and `filter[depth]`; with the seams as they are (unavailable) there is no Issues column, no Tracked
    column and no "Track in Monitoring" action, in the table and in the Columns menu.
  - `page-columns.test.tsx`: with `issues: true` the `issues` column exists in the group Issues, is shown by
    default, and `flags` is hidden by default; with `tracked: true` the `tracked` column exists in Search,
    shown by default.
  - `bulk.test.tsx`: "select all matching" with `view=live&folder=/blog/` sends a bulk body whose `filter`
    has `view` and `folder`.
  - One test mocks `@/lib/pages/tracking` as available (`vi.mock`): the action appears for an explicit
    selection, is disabled with `pages.track.onlySelection` for "all matching", and its toast repeats the
    outcome's numbers and the limit the outcome reports.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  - `page-filters.ts`: `pageFilterFields(t, tiers, tags, tagsLoading, folders: { sections: readonly string[]; loading: boolean; label: string })`
    adds the `folder` field after `status`; `pageQueryOf` reads it into `folder` with `enumValuesOf`, as it
    reads `idx`. The key `folder` belongs to the filter bar alone, so the Overview's section links set this
    filter and its chip shows.
  - `pages-tab.tsx`: the sections come from `overviewQuery` (the read the Overview and the View menu share).
    The field's `optionsLoading` is true until that read has answered: `useUrlFilters` keeps an enum value
    from the address while its options load and drops one that is not an option once they are known (with the
    existing dropped-filter toast), so a section link of the Overview keeps its `folder` on arrival. Its
    value in the address is the section as it is (`folder=/blog/`); add a case to `pages-tab.test.tsx` that
    opens `?view=live&folder=/blog/` cold and sees the chip and the request.
    The depth and variants chips are drawn after the filter bar in `toolbarEnd`, each a `Tag` with a remove
    button named by `pages.filters.remove`.
  - `seam-columns.tsx`: `issuesColumn(…)` and `trackedColumn(…)`, each returning a column definition for the
    groups Issues and Search. `pageColumns` takes `{ issues: boolean; tracked: ReadonlySet<string> | null }`
    and adds them only when present. `pages-tab.tsx` passes `ISSUE_COLUMNS_AVAILABLE` and the `ready` data of
    `useTrackedPages`, and adds the bulk action only when `TRACKING_AVAILABLE`; the action calls
    `useTrackPages(scope).track(ids)` and builds the toast from the `TrackOutcome`. No limit is a constant of
    the web.
  - The Issues column's cell reads its numbers only through `issueCountsOf(row)` of
    `lib/pages/issue-source.ts` (null on this branch: the cell then shows the "none" text). No cast of
    `row.extras` anywhere: the generated type has no `issues` field until the Issues session adds it. The
    test of step 2 mocks `@/lib/pages/issue-source` to cover a row with counts.

- [ ] **Step 5: Run the tests of the folder one file at a time, expect pass. Run the web commands** and the
  two message tests.

- [ ] **Step 6: Commit.** `git commit -m "All pages: the folder filter, depth and variant chips, and the seams for issues and tracking"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: with the seams
  unavailable nothing of them is rendered, not even an empty column or a disabled button (spec D10); no
  number 200 or other limit in the web code; the bulk filter carries the view, the folder and the depth, so
  "all matching" changes what the list shows and nothing more; the chips are removable with the keyboard.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

---

## Part E. Web: the Overview cards

### Task 21: Cards 1 to 6

Spec 6.4 (cards 1 to 6, the percent bases, the states), 8 (the grid), 11 (charts). UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/pages-page/overview-cards.tsx`, `card-rows.tsx`,
  `overview-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/pages-page/overview-tab.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `components/app/chart/chart-frame.tsx` (the `kind: 'html'` props: `title`,
  `variant`, `height`, `summary`, `info`, `body`, `table`, `empty`, `status`), `bar-list.tsx` (the row shape
  with `href`, `accessibleText`, `tip`; the distribution mode and its colours), `rings-chart.tsx` and
  `lib/charts/rich-rings.ts` (one row is one ring; `segments` carry a colour token), `stacked-share-bar.tsx`
  (`StackedShareBar`, `StackedShareTable`: a row has an `href`, a segment has none), one existing card that
  uses `ChartFrame` with `BarList` (for example a card under `features/ai-overview/cards/`), and
  `lib/pages/overview-model.ts`.

- [ ] **Step 2: Words** (namespace `pages.cards`):

| Key | Text |
|---|---|
| `status.title` | Addresses by status |
| `status.info` | Every address the crawl read, by what it answered. Shares are of every address. |
| `status.center` | {count} live |
| `status.rows.live` | Live pages |
| `status.rows.variant` | Parameter variants |
| `status.rows.redirected` | Redirects |
| `status.rows.client_error` | Client errors |
| `status.rows.server_error` | Server errors |
| `status.rows.blocked` | Blocked |
| `status.rows.other` | Other |
| `funnel.title` | From crawled to indexable |
| `funnel.info` | How many addresses are live pages, how many of those Google may index, and how many of those the sitemap lists. |
| `funnel.rows.addresses` | Addresses crawled |
| `funnel.rows.live` | Live pages |
| `funnel.rows.indexable` | Indexable |
| `funnel.rows.in_sitemap_indexable` | Indexable and in the sitemap |
| `sections.title` | Pages by section |
| `sections.info` | Live pages by the first folder of their address. Shares are of live pages. |
| `sections.other` | {count, plural, one {Other sections (#)} other {Other sections (#)}} |
| `tiers.title` | Pages by tier |
| `tiers.info` | Live pages by their tier today. Shares are of live pages. |
| `depth.title` | Click depth |
| `depth.info` | How many clicks from the home page each live page is. Shares are of live pages. |
| `depth.row` | {depth, plural, =0 {Home page} =6 {6 clicks and more} one {# click} other {# clicks}} |
| `depth.unreachable` | Not reachable by links |
| `sitemap.title` | Sitemap coverage |
| `sitemap.info` | Indexable pages the sitemap lists and misses, and addresses it lists that are not live or not indexable. |
| `sitemap.rows.in_sitemap_indexable` | In the sitemap and indexable |
| `sitemap.rows.not_in_sitemap` | Indexable, missing from the sitemap |
| `sitemap.rows.sitemap_not_live` | In the sitemap, not live |
| `sitemap.rows.sitemap_not_indexable` | In the sitemap, not indexable |
| `sitemap.emptyTitle` | The crawl found no sitemap |
| `sitemap.emptyReason` | Add a sitemap to the website, then crawl again. |
| `table.row` | Group |
| `table.pages` | Pages |
| `table.share` | Share |
| `shareOfAddresses` | {share} of every address |
| `shareOfLive` | {share} of live pages |
| `opens` | {label}, {count}. Opens All pages |
| `summary` | {title}: {rows} |

- [ ] **Step 3: Write the failing tests** in `overview-tab.test.tsx` (with `pagesAs('viewer', 'overview')`
  on the Eventus fixture, numbers read from the mocked overview handler, not typed in):
  - six cards are drawn with their titles, in the order of spec 6.4;
  - every row of every card that names pages is a link whose accessible name follows `pages.cards.opens`
    and whose `href` is the model's; the folded sections row is not a link;
  - card 1: the centre reads the live count; a status group of 0 is absent from the legend list and present
    in the table; the legend rows are links;
  - each card's Chart and Table switch shows the same rows with counts and shares, works with the keyboard,
    and focus stays on the switch;
  - a status row's tooltip names "of every address"; a section row's names "of live pages";
  - with a crawl that found no sitemap (override the handler): card 6 shows its empty state and card 2 has
    three rows;
  - while the read loads: skeleton cards; when it fails: the inline error of Task 13 and no card;
  - choosing an older crawl in the picker changes the numbers (two handlers by `run`);
  - `axe` finds nothing.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.**
  - `card-rows.tsx`: `CardRowsTable({ caption, rows })`, the table of a card (row, pages, share; each row
    with an `href` a link), and `CardLegend({ rows })`, the same rows as a list of links for cards 1 and 6,
    whose marks are not focusable. Both take rows already translated:
    `{ id, label, countText, shareText, tip, href, accessibleText }`.
  - `overview-cards.tsx`: one component per card (`StatusCard`, `FunnelCard`, `SectionsCard`, `TiersCard`,
    `DepthCard`, `SitemapCard`), each a `ChartFrame` with `variant="panel"`, `kind="html"`, `summary` built
    from `pages.cards.summary`, `info`, and `table` a `CardRowsTable`. Card 1's body is `RingsChart` with one
    row (`names={false}`, `emphasis`), seven segments in the order of C2's status groups, a segment of 0
    left out, plus `CardLegend`. Cards 2 to 5 are `BarList` rows with `href` (card 4 with `TierBadge` as the
    row's `icon`; card 5's last row in the warning tone the model marks). Card 6 is `StackedShareBar` with
    one row and four segments, plus `CardLegend`; with `model.sitemap === null` the frame's empty state.
    Colours are existing tokens only: read `lib/design/read-tokens.ts` and the `ShareColor` and
    `BarScaleColor` unions and choose from them; invent none.
  - `overview-tab.tsx`: under the strip, the grid `grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4`
    inside the same scroll container. Loading draws six `ChartFrame`s in their loading state.

- [ ] **Step 6: Run the test file, expect pass. Run the web commands** and the two message tests.

- [ ] **Step 7: Commit.** `git commit -m "Pages overview: the status, funnel, section, tier, depth and sitemap cards"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: each card against
  its row of the table in spec 6.4 (chart, rows, what each opens); there is no "indexed by Google" row and
  no page types card (D11, D12); no sample or typed-in number in the component; a mark is never the only way
  in (legend and table rows carry the links); each chart has a text summary; the percent base is named.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 22: The Issues card, "Since the last crawl", and the Overview's export

Spec 6.3, 6.4 (cards 7 and 8, the Export paragraph), 10.1. UI task.

**Files:**
- Modify: `apps/web/src/features/internal-links/pages-page/overview-cards.tsx`, `overview-tab.tsx`,
  `overview-tab.test.tsx`, `pages-screen.tsx`
- Create: `apps/web/src/lib/pages/overview-csv.ts`, `overview-csv.test.ts`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words** (namespace `pages.cards`):

| Key | Text |
|---|---|
| `issues.title` | Issues |
| `issues.errors` | Pages with an error |
| `issues.warnings` | Pages with a warning |
| `issues.notices` | Pages with a notice |
| `issues.opens` | {label}, {count}. Opens Issues |
| `changes.title` | Since the last crawl |
| `changes.pagesAdded` | Pages added |
| `changes.pagesRemoved` | Pages removed |
| `changes.editorial` | Editorial links added and lost |
| `changes.editorialValue` | {added} added, {lost} lost |
| `changes.lostToTop` | Links lost to important tiers |
| `changes.opens` | {label}, {value}. Opens Internal links, Changes |
| `changes.firstCrawl` | This is the first crawl. Changes appear after the next one. |
| `changes.pending` | Comparing with the crawl before |
| `export.card` | Card |
| `export.row` | Row |
| `export.count` | Count |

  The `unavailable` state of card 8 uses the words the Changes tab already has: find its key under
  `internalLinks.changes` and use that key, do not write the sentence again.

- [ ] **Step 2: Write the failing tests.**
  - `overview-csv.test.ts`: `overviewCsv(model, labels)` returns a `CsvTable` with the header Card, Row,
    Count and one line per row of every card in card order, the folded sections row included, and no
    sitemap lines when `model.sitemap` is null.
  - `overview-tab.test.tsx`: card 8 shows four lines whose values come from the mocked changes summary, each
    a link to Internal links with `tab=changes` (and `run` when chosen); with `state: 'first_crawl'` the one
    sentence; with `pending` its sentence; there is no Issues card and the strip has five numbers while
    `useIssueTotals` is unavailable; with `@/lib/pages/issue-source` mocked `ready`, card 7 shows three rows
    that link to `/seo/issues?severity=error` (and `warning`, `notice`) and the strip has six numbers, the
    sixth equal to `withIssue`; the page's Export downloads `pages-overview.csv` (assert `downloadBlob` was
    called with a blob whose text has the header and the live count).

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `overview-csv.ts`:
  `export function overviewCsv(model: OverviewModel, labelOf: (card: keyof OverviewModel, row: OverviewRow) => string, header: readonly [string, string, string]): CsvTable`
  with `lib/csv/csv-write.ts`. `IssuesCard` and `ChangesCard` in `overview-cards.tsx`: card 7 is rendered
  only for `ready`; card 8 is a panel with four lines (label left, value right, the whole line a link), no
  chart, reading `changesSummaryQuery(scope, run)`. `overview-tab.tsx` registers the export
  (`registerExport(() => { downloadBlob(csvBlob(overviewCsv(…)), 'pages-overview.csv'); return Promise.resolve(); })`)
  while the read is ready and unregisters on unmount; `pages-screen.tsx` hands it `registerExport` as it does
  to All pages. The Overview computes no issue total (spec 6.3).

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** and the two message tests.

- [ ] **Step 6: Commit.** `git commit -m "Pages overview: the issues and changes cards, and the CSV export"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: nothing of the
  Issues card is rendered while the seam is unavailable; the issue numbers are only ever the seam's; cards 7
  and 8 follow `run`; the four states of card 8 against spec 6.4; the CSV holds every card's rows.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

---

## Part F. Web: the page drawer

The drawer is `PageInspector` on top of the shared `Inspector`. In Tasks 23 to 25e do not edit
`components/app/inspector/inspector.tsx`, `inspector-layout.tsx`, `use-inspector.ts` or `lib/inspector/*`;
call them as they are. The drawer always lies over the table: write nothing about docking or width.

### Task 23: Seven tabs

Spec 9.1, 9.4 (the first paragraph, and the tabs AI and Links), 11. UI task. (The task was "Five tabs" until
the owner added Outline and Notes on 2026-11-26; its number stays.)

**Files:**
- Modify: `docs/glossary/terms.md`, `docs/glossary/final-list.md` (their own commit, first)
- Create: `apps/web/src/lib/pages/drawer-tabs.ts`, `drawer-tabs.test.ts`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `extras-sections.tsx`,
  `page-inspector.test.tsx`, `extras-sections.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 0: The glossary first.** Read rows A5, A12 and A15 of `docs/glossary/terms.md` and the change
  log at its end, and how `final-list.md` lists a tab name. Add one row after A15, in the same columns:
  id `A16`; term "Outline (a tab of the page drawer)"; definition "The tab that shows what one page says to
  a search engine, read from the stored HTML of the latest crawl: its search listing, headings, language
  versions, sharing tags, structured data and content size."; not to be confused with "Not Issues (the
  checks a page fails, across the site). Not the page's Overview tab."; avoid "Structure, On-page, SEO
  audit, Content outline (as the tab name)"; where "Page drawer tabs"; "Safe"; "Owner decision 2026-11-26".
  Two more rows, the same way: `A17`, "Notes (a tab of the page drawer)": "What the team wrote about one
  page, newest first, each note with its author and the time it was written. Notes belong to the page's
  address and stay across crawls."; not to be confused with "Not the notes on a chart (a day marked on a
  chart). Not Issues."; avoid "Comments, Annotations, Remarks, Log (as the tab name)"; where "Page drawer
  tabs". And in the section of `terms.md` that holds button and action words (find the row of another
  button, for example "Add keywords"), "Add note": "Saves the text in the note box as a new note on the
  page."; avoid "Post, Comment, Submit, Save note (for a new note)".
  Add the matching lines to `final-list.md` and one line per row to the change log of `terms.md`. If an id
  is taken, use the next free one. Commit only these two files:
  `git commit -m "Glossary: Outline and Notes, tabs of the page drawer, and Add note"`.

- [ ] **Step 1: Read first.** `components/app/inspector/inspector-tabs.tsx` (`InspectorTabs`,
  `InspectorPanel`), `use-inspector.ts` (`tab`, `setTab`, `DEFAULT_INSPECTOR_TAB`), one tabbed inspector that
  exists (`grep -rln "InspectorTabs" apps/web/src/features`), `page-inspector.tsx`, `extras-sections.tsx`.

- [ ] **Step 2: Words** (namespace `pages.drawer`): `tabsLabel` "Page sections"; `tabs.overview` "Overview";
  `tabs.search` "Search"; `tabs.outline` "Outline"; `tabs.issues` "Issues"; `tabs.ai` "AI"; `tabs.links` "Links";
  `tabs.notes` "Notes"; `tabsMore` "More sections"; `notes.pending` "The notes of this page appear here" (the
  interim body of this task, removed by Task 25e); `ai.none` "No AI answer cited this page in the last 28 days"; `outline.pending` "The outline of this page
  appears here" (the interim body of this task, removed by Task 25b).

- [ ] **Step 3: Write the failing tests.**
  - `drawer-tabs.test.ts`: `PAGE_DRAWER_TABS` is `overview`, `search`, `outline`, `issues`, `ai`, `links`,
    `notes`; `pageDrawerTab('notes')` is `notes`;
    `pageDrawerTab('links')` is `links`; `pageDrawerTab('nope')` and `pageDrawerTab('overview')` are
    `overview`.
  - `extras-sections.test.tsx`: `parts={['keywords']}` draws only the tracked keywords card; without `parts`
    every card is drawn as today.
  - `page-inspector.test.tsx`: the drawer has a tab list "Page sections" with the seven tabs in order
    (Overview, Search, Outline, Issues, AI, Links, Notes); with no `itab` Overview is selected; `itab=links`
    selects Links, `itab=outline` selects Outline and `itab=notes` selects Notes; the tab row is given the
    More button's name "More sections" (`overflowLabel`), and a tab chosen from the More menu is selected and
    written to `itab` like any other (read `components/ui/tabs.tsx` and its test for how the overflow is
    measured and how a test makes tabs overflow); choosing a tab writes `itab` (and removes it
    for Overview) without a history entry; an unknown `itab` shows Overview; the Links tab holds the strip
    (depth, links in, links out), linking pages by tier and by placement, the anchors card, the changes
    card, linking pages and outlinks with "View all in Links" as links; the AI tab holds the citations card,
    or the "none" sentence when the total is 0; stepping with J and K keeps the tab; the header keeps the
    path, the title line, the position and Previous and Next; the footer keeps Copy address, Visit and Open
    in journey; there is no Track control anywhere in the drawer; `axe` finds nothing on each tab.
  - Until Task 24 the Overview tab holds the tier and tags section and the flags section, and until Task 25
    the Search tab holds the tracked keywords card and the Google card and the Issues tab holds the flags
    section: the tests of this task assert only that each existing section is in exactly one tab or in the
    tabs this list names. Until Task 25b the Outline tab holds one line, `outline.pending`, and no section
    of the old inspector; this task asserts only that the tab exists, is third and can be selected. Until
    Task 25e the Notes tab holds one line, `notes.pending`; this task asserts only that it exists, is last
    and can be selected.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `drawer-tabs.ts`:

```ts
export const PAGE_DRAWER_TABS = ['overview', 'search', 'outline', 'issues', 'ai', 'links', 'notes'] as const;
export type PageDrawerTab = (typeof PAGE_DRAWER_TABS)[number];
export const pageDrawerTab = (value: string): PageDrawerTab;
```

  `extras-sections.tsx`: `parts?: readonly ('changes' | 'keywords' | 'citations' | 'anchors' | 'google')[]`
  (absent: all). `page-inspector.tsx`: it calls `useInspector()` itself for `tab` and `setTab` (hosts pass
  nothing new); the body is `InspectorTabs` with one `InspectorPanel` per tab; the sections move into the
  panels as the tests say; the error and not found bodies stay outside the tabs. Each tab's parts become
  small components in the same folder only where the file would pass 400 lines: `drawer-links-tab.tsx` for
  the Links tab.

- [ ] **Step 6: Run** `src/lib/pages/drawer-tabs.test.ts`, `src/features/internal-links/inspector`, then
  `src/features/internal-links/journey/journey-tab.test.tsx` and `internal-links-screen.test.tsx` (they open
  the drawer). Expect pass. Run the web commands and the two message tests.

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the tabs Overview, Search, Outline, Issues, AI, Links and Notes"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: nothing of the old
  inspector was dropped (list its sections from `git show HEAD~1:apps/web/src/features/internal-links/inspector/page-inspector.tsx`
  and find each in a tab); the tab order is the owner's (Overview, Search, Outline, Issues, AI, Links, Notes);
  seven tabs pass the six the tab row is written for, so `overflowLabel` is set and the reviewer reads in
  `components/ui/tabs.tsx` that the last tabs, not the first, move into More, and that every tab stays
  reachable with the keyboard at the drawer's least width; the glossary commit came first and holds only
  the two glossary files; the tab is in the address; the drawer still opens
  from every tab of Internal links; no shared drawer file in the diff; no width or docking code.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 24: The drawer's Overview tab

Spec 9.4 (Overview), 10.1, 11 (tiles are buttons with full labels). UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/drawer-overview-tab.tsx`,
  `apps/web/src/lib/pages/drawer-tiles.ts`, `drawer-tiles.test.ts`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Words** (namespace `pages.drawer.overview`):

| Key | Text |
|---|---|
| `chips.label` | Page facts |
| `chips.indexable` | Indexable |
| `chips.inSitemap` | In sitemap |
| `chips.notInSitemap` | Not in sitemap |
| `chips.variant` | Parameter variant |
| `tiles.label` | Page numbers |
| `tiles.clicks` | Clicks |
| `tiles.impressions` | Impressions |
| `tiles.keywords` | Tracked keywords |
| `tiles.citations` | AI citations |
| `tiles.linksIn` | Links in |
| `tiles.linksOut` | Links out |
| `tiles.depth` | Depth |
| `tiles.issues` | Issues |
| `tiles.last28` | last 28 days |
| `tiles.bestRank` | best rank {rank} |
| `tiles.noRank` | none rank yet |
| `tiles.linksNote` | {scope}, {count} in all |
| `tiles.depthNote` | clicks from the home page |
| `tiles.notReachable` | Not reachable by links |
| `tiles.notConnected` | Not connected |
| `tiles.notCollected` | Not collected yet |
| `tiles.issuesNone` | None found |
| `tiles.issuesNote` | {count, plural, one {# error} other {# errors}} |
| `tiles.opens` | {label}: {value}, {note}. Opens the {tab} tab. |
| `tiles.opensNoNote` | {label}: {value}. Opens the {tab} tab. |
| `attention.title` | Needs attention |
| `attention.none` | Nothing needs attention on this page |
| `attention.seeAll` | See all issues |
| `about.title` | About |
| `about.pageTitle` | Title |
| `about.address` | Address |
| `about.canonical` | Canonical |
| `about.redirectsTo` | Redirects to |
| `about.lastCrawled` | Last crawled |
| `about.noTitle` | No title |

  The issues note names the most severe kind present: add `tiles.issuesWarnings` and `tiles.issuesNotices`
  in the same plural form with "warning" and "notice".

- [ ] **Step 2: Write the failing tests.**
  - `drawer-tiles.test.ts`: `drawerTiles(detail, issues)` returns eight tiles in the order of spec 9.4 with
    `id`, `value` (a number or null), `state` (`ok`, `not_connected`, `pending`, `unreachable`), `note` parts
    and `tab`; clicks and impressions are `not_connected` or `pending` from `extras.gsc.state` and never 0
    in those states; the keywords note is the best rank or "none"; depth with a null `click_depth` is
    `unreachable`; with issues `unavailable` there are seven tiles; with `ready` the eighth carries the count
    of the most severe kind present.
  - `page-inspector.test.tsx`, Overview tab: the chips (status code, Indexable or the reason, In sitemap or
    Not in sitemap, the tier badge, "Parameter variant" for a variant) come from the page row; seven tiles
    are buttons in one group, each with the accessible name of `tiles.opens`; pressing Clicks selects the
    Search tab, AI citations the AI tab, Links in the Links tab, and `itab` follows; a Search Console tile
    reads "Not connected" for a project without a property; "Needs attention" lists the page's flags with
    their texts, or the "nothing" sentence; About shows the title, the address with a working copy button,
    the canonical, the redirect target for a redirect, and the crawl date; tier and tags work as before
    (reuse the existing cases: set a tier, reset to rule, add and remove a tag); with
    `@/lib/pages/issue-source` mocked `ready`: eight tiles, and "Needs attention" lists at most five issues,
    most severe first, with "See all issues" selecting the Issues tab.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `drawer-tiles.ts` is pure (no text, no React). `drawer-overview-tab.tsx`
  draws: the chips (`Badge`, `StatusBadge`, `TierBadge`); the tiles as one joined panel, `grid grid-cols-4`
  with `grid-cols-2` under the container width the design system names for the inspector, each a `button`
  (value in the metric type, label and note in `type-meta`), closing up to seven; "Needs attention"
  (`InspectorSection`): the flags list that exists today, or the issues from `usePageIssues` when `ready`;
  About (`KeyValues` of `components/app/inspector/key-values.tsx`); then the existing tier and tags section,
  moved here unchanged. `page-inspector.tsx` renders it in the Overview panel and passes `onTab` (the
  `setTab` of Task 23).

- [ ] **Step 5: Run** the two test files, expect pass. Run the web commands and the two message tests.

- [ ] **Step 6: Commit.** `git commit -m "Page drawer: the Overview tab with chips, tiles, needs attention and about"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the tile table of
  spec 9.4 row by row (value, note, tab, where the number comes from); a tile never shows 0 for "not
  connected" or "not collected"; no Track control; each tile is a button with a full name; the grid closes
  up with seven; no "No data" or "N/A"; colour is not the only sign on chips.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 25: The drawer's Search and Issues tabs

Spec 9.4 (Search, Issues), 9.5, 10.1, 10.3. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/drawer-search-tab.tsx`, `drawer-issues-tab.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** `chart-frame.tsx` (the `kind: 'line'` props: `categories`, `categoryHeader`,
  `series`, `formatValue`, `height`, `summary`, `variant="inspector"`), one inspector that draws a line chart
  with it, `lib/pages/search-daily.ts`, `lib/pages/search-detail-slot.tsx`, `lib/pages/issue-source.ts`,
  `lib/routes/paths.ts` (`integrationsPath`), how `extras-sections.tsx` `GoogleBody` words the three states.

- [ ] **Step 2: Words** (namespace `pages.drawer`):

| Key | Text |
|---|---|
| `search.title` | Search Console, last 28 days |
| `search.clicks` | Clicks |
| `search.impressions` | Impressions |
| `search.day` | Day |
| `search.summary` | {clicks} clicks and {impressions} impressions from {start} to {end} |
| `search.notConnectedTitle` | Search Console is not connected |
| `search.notConnectedReason` | Connect Search Console to see this page's clicks and impressions. |
| `search.connect` | Open Integrations |
| `search.pendingTitle` | Not collected yet |
| `search.pendingReason` | The page numbers arrive after the next Search Console update. |
| `search.none` | Google reported no clicks or impressions for this page in these 28 days |
| `search.loadFailed` | The Search Console numbers could not be loaded |
| `issues.pending` | Checks from the Issues page appear here once they are available |
| `issues.none` | No issues found on this page |
| `issues.seeAll` | See all pages with this issue |
| `issues.loadFailed` | The issues of this page could not be loaded |
| `issues.severity.error` | Error |
| `issues.severity.warning` | Warning |
| `issues.severity.notice` | Notice |

- [ ] **Step 3: Write the failing tests** in `page-inspector.test.tsx`:
  - Search tab, in this order in the DOM: the Search Console section, then nothing of the slot, then the
    tracked keywords card;
  - `ok`: the two totals, and a chart "Search Console, last 28 days" with two series and a table of 28 rows
    reached with the Chart and Table switch;
  - `ok` with every day 0: the totals read 0 and the "no clicks or impressions" sentence replaces the chart;
  - `not_connected`: its title and reason, and the link "Open Integrations" only for a role that may connect
    (use the permission the Integrations screen checks; find it with a grep, do not guess);
  - `pending`: its title and reason;
  - the read failing: the inline error with a retry that works;
  - a mocked `PageSearchDetailSlot` that renders a marker appears between the chart and the keywords;
  - Issues tab while the seam is unavailable: the line of `issues.pending`, then the page's flags with their
    texts; never empty;
  - Issues tab with `usePageIssues` mocked `ready`: each issue with its severity badge (a word, not only a
    colour), its name and its detail, and "See all pages with this issue" as a link when
    `hrefs.issueCheck` gives one and absent when it gives `null`; `ready` with none: `issues.none`; `error`:
    the inline error with retry;
  - the Google card of the old inspector is gone from every tab (its numbers are the Search tab's);
  - the Outline and Notes tabs are untouched by this task: Outline still sits between Search and Issues and
    Notes is last.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `drawer-search-tab.tsx`: `usePageSearchDaily(scope, run, urlId)`; a
  `MetricStrip size="sm"` with the two totals; `ChartFrame variant="inspector" kind="line"` with the days as
  categories (`formatIsoDate` in the project's time zone) and the two series, `height={180}`; then
  `<PageSearchDetailSlot scope urlId url timeZone />`; then `ExtrasSections parts={['keywords']}`.
  `drawer-issues-tab.tsx`: `usePageIssues`; the four states above. The name of an issue comes from the
  Issues session's messages when they exist: on this branch the tab takes a `nameOf: (checkId: string) => string`
  prop that `page-inspector.tsx` fills with the check id itself, marked with one comment that the Issues
  session replaces it. `page-inspector.tsx` renders both tabs and no longer passes `'google'` in any
  `parts`.

- [ ] **Step 6: Run** `src/features/internal-links/inspector`, expect pass. Run the web commands and the two
  message tests.

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the Search tab with 28 days of Search Console, and the Issues tab"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the Search tab's
  order and its three Search Console states against spec 9.4; no period other than the stored 28 days is
  offered; the slot is rendered with the props of spec 10.3 and draws nothing; the Issues tab is never empty
  and never invents an issue; "Search Console" is never abbreviated; the chart has its table and its
  summary.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 25b: The drawer's Outline tab: the model, the strip, the states and the first two blocks

Spec 9.6.3, 10.1 (the last paragraph), 11. Contracts C5, C6. UI task. Tasks 25b and 25c are one tab in two
contexts: this one builds everything a block needs and the two blocks that start open; 25c adds the other
four.

**Files:**
- Create: `apps/web/src/lib/pages/outline-model.ts`, `outline-model.test.ts`
- Create: `apps/web/src/features/internal-links/inspector/drawer-outline-tab.tsx`, `outline-block.tsx`,
  `outline-blocks.tsx`, `drawer-outline-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `docs/design-system/16-drawers-dialogs-popovers.md` (one sentence in section 2.4)

- [ ] **Step 1: Read first.** Spec 9.6.3 whole. `lib/pages/outline.ts` (`usePageOutline`),
  `mocks/internal-links-outline.ts` (the three fixed pages), `inspector/page-drawer-context.ts`
  (`hrefs.issueCheck`, `crawl.older`), `components/app/inspector/inspector-section.tsx` (the card's look:
  border, radius, header height; its comment says cards never collapse, which is why the Outline has its own
  block), `components/ui/badge.tsx`, `components/ui/text-link.tsx`, `components/ui/skeleton.tsx`, the inline
  error with Retry the Search tab of Task 25 uses, and `docs/design-system/16-drawers-dialogs-popovers.md`
  section 2.4.

- [ ] **Step 2: Words** (namespace `pages.drawer.outline`). `tabs.outline` exists (Task 23); remove
  `outline.pending`.

| Key | Text |
|---|---|
| `fine` | Fine |
| `toFix` | To fix |
| `seeInIssues` | See in Issues |
| `footer` | Read from the stored HTML of the latest crawl, so it shows the page as the crawler saw it. |
| `olderCrawl` | This is the outline from the latest crawl, not from the crawl you are viewing. |
| `truncated` | This page is very long. The outline covers its first part. |
| `loadFailed` | The outline of this page could not be loaded |
| `state.redirect` | This address redirects to {path}, so it has no content of its own. Open the page it leads to for its outline. |
| `state.redirectUnknown` | This address redirects to another page, so it has no content of its own. Open the page it leads to for its outline. |
| `state.error` | This address answers with {status}, so there is no page to read. |
| `state.errorNoStatus` | This address did not answer, so there is no page to read. |
| `state.notHtml` | This address is not an HTML page, so it has no outline. |
| `state.noHtml` | The HTML of this page was not kept in the latest crawl, so its outline cannot be shown. It appears after the next crawl. |
| `state.notInCrawl` | This page is not in the latest crawl. |
| `strip.label` | Outline numbers |
| `strip.h1` | H1 |
| `strip.h1None` | None |
| `strip.h1One` | as it should be |
| `strip.h1Missing` | missing |
| `strip.h1Many` | more than one |
| `strip.headings` | Headings |
| `strip.headingsNote` | H2 {h2}, H3 {h3} |
| `strip.words` | Words |
| `strip.readTime` | {minutes} min read |
| `strip.thin` | very little text |
| `strip.images` | Images |
| `strip.imagesFine` | all described |
| `strip.imagesNoAlt` | {count} without alt text |
| `listing.title` | Search listing |
| `listing.summaryFine` | Title and description are the right length |
| `listing.summaryToFix` | {count, plural, one {# thing to fix} other {# things to fix}} |
| `listing.previewLabel` | How the page can look in search results |
| `listing.noDescription` | No description. Google picks a sentence from the page. |
| `listing.noTitle` | No title |
| `listing.factTitle` | Title |
| `listing.factDescription` | Description |
| `listing.factCanonical` | Canonical |
| `listing.factRobots` | Robots |
| `listing.factLanguage` | Language |
| `listing.lengthOk` | {chars, plural, one {# character} other {# characters}} |
| `listing.lengthShort` | {chars, plural, one {# character} other {# characters}}, short of {min} |
| `listing.lengthLong` | {chars, plural, one {# character} other {# characters}}, over {max} |
| `listing.lengthMissing` | Missing |
| `listing.canonicalSelf` | This page |
| `listing.canonicalSelfChip` | Self |
| `listing.canonicalElsewhereChip` | Elsewhere |
| `listing.canonicalNone` | None named |
| `listing.robotsNone` | No robots tag |
| `listing.indexable` | Indexable |
| `listing.notIndexed` | Not indexed |
| `listing.languageNone` | Not set |
| `headings.title` | Headings |
| `headings.summary` | {count, plural, one {# heading} other {# headings}} |
| `headings.summaryWithH1` | {count, plural, one {# heading} other {# headings}}, H1: {h1} |
| `headings.none` | No headings |
| `headings.listLabel` | Headings in page order |
| `headings.level` | H{level} |
| `headings.emptyText` | No text |
| `headings.showAll` | Show all {count} headings |
| `headings.showFewer` | Show fewer headings |
| `headings.capped` | The first {shown} of {total} headings |
| `finding.titleMissing` | The page has no title, so Google writes one from the page. |
| `finding.titleShort` | The title is short. Add the words people search for. |
| `finding.titleLong` | The title is long and Google will cut it off. |
| `finding.descriptionMissing` | There is no meta description, so Google writes its own text under the title. |
| `finding.descriptionShort` | The meta description is short. Use the room to say what the visitor gets. |
| `finding.descriptionLong` | The meta description is long and Google will cut it off. |
| `finding.descriptionDuplicate` | Other pages use this same description. |
| `finding.noindex` | The page tells search engines not to index it. |
| `finding.canonicalElsewhere` | The canonical points to another address, so this page is not the one Google keeps. |
| `finding.h1Missing` | The page has no H1, so nothing names its topic. |
| `finding.h1Multiple` | The page has {count} H1 headings. Keep one and make the others H2. |
| `finding.skippedLevel` | "{text}" is an H{level} straight after an H{before}. Do not skip a level. |

- [ ] **Step 3: Write the failing tests.**
  `outline-model.test.ts`, on outlines written in the test (a healthy one and one with every problem):
  - `strip`: four cells `h1`, `headings`, `words`, `images` with `value`, `note` (an id and its values) and
    `warn`; H1 count 1 gives `note.id === 'h1One'` and `warn: false`; 0 gives value `null` (the tab writes
    "None"), `h1Missing`, `warn: true`; 2 gives `h1Many`, `warn: true`; the headings note carries
    `level_counts[1]` and `level_counts[2]`; words `thin` gives `thin` and `warn: true`, else `readTime` with
    the minutes; images with `images_without_alt` 2 gives `imagesNoAlt` with 2 and `warn: true`;
  - `listing`: `tone` `ok` and no findings for the healthy one; for the other, the findings in the
    order title, description, duplicate, noindex, canonical, each with the `checkId` of spec 9.6.3
    (`title-short`, `description-missing`, `noindex`, `canonical-elsewhere`) and `null` for a short or long
    description; `tone` `warning` (the tab's summary count is `findings.length`); `description-duplicate` is a finding
    only when the second argument (the page's issues) lists that check;
  - `headings`: `first` is the first `HEADINGS_FOLDED` (12) headings and `rest` the others; the
    findings `h1-missing`, `h1-multiple` (with the count) and a skipped level (with the text, the level and
    the level before, `checkId: null`); `h1Text` is the text of the first H1 or `null`; `capped` is
    `{ shown: 200, total: 1240 }` when `headings_total` is over the list, else `null`;
  - the model holds no visible text: every string in it is an id or comes from the page.
  `drawer-outline-tab.test.tsx` (render the tab inside the providers with the mocked API; pages from
  `mocks/internal-links-outline.ts`):
  - a healthy page: the strip is a group "Outline numbers" with the four labels and values; the blocks
    Search listing and Headings are present with `aria-expanded="true"`, each button controls a region named
    by the block's title; the chip reads "Fine";
  - pressing Enter on the Headings button hides its region and sets `aria-expanded="false"`; Space opens it
    again; the focus is still on the button; the choice is kept after `rerender` with another `urlId`;
  - `OUTLINE_LONG_PAGE`: 12 list items, a button "Show all 14 headings"; pressing it shows 14 and the button
    reads "Show fewer headings" and has the focus; after `rerender` with another page and back, 12 again;
  - the headings are an `ol` named "Headings in page order"; an item's accessible text starts with its
    level ("H2");
  - `OUTLINE_PROBLEM_PAGE`: the chip of Search listing reads "To fix", its summary "2 things to fix" (or the
    count the fixture gives), the finding sentences are in the block; with `hrefs.issueCheck` returning
    `null` there is no element named "See in Issues" anywhere; with it returning a route, the finding for
    the missing description has a link "See in Issues" to that route and the finding for a skipped level has
    none;
  - the meter: the text "29 characters, short of 30" is in the document and the bar has `aria-hidden="true"`;
  - with an older crawl in view (`crawl.older`), a row that redirects in that crawl but is live in the
    latest shows the outline, not the redirect sentence;
  - the states: a redirect row shows `state.redirect` with the path of the row's redirect target and sends
    no outline request that the tab waits on (the hook is still called; assert only the sentence); a 404
    row shows `state.error` with 404; `OUTLINE_NO_HTML_PAGE` shows `state.noHtml`; the read answering 404
    shows `state.notInCrawl`; the read answering 500 shows `loadFailed` with a Retry that works; while
    loading there is a skeleton and no block;
  - `crawl.older` true: the line `olderCrawl` is above the strip; the footer line is always last;
  - text is text: with the outline's title `<img src=x onerror=alert(1)>` and a heading `<b>bold</b>` the
    document holds those characters as text, `container.querySelector('img')` is null inside the preview and
    `container.querySelector('b')` is null;
  - `axe` finds nothing on the healthy page and on the problem page.
  `page-inspector.test.tsx`: the Outline tab renders the tab of this task (the pending line is gone), and the
  outline is not requested until the tab is selected.

- [ ] **Step 4: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/lib/pages/outline-model.test.ts src/features/internal-links/inspector/drawer-outline-tab.test.tsx`

- [ ] **Step 5: Implement.** `outline-model.ts`, pure (no React, no text):

```ts
export const HEADINGS_FOLDED = 12;
export const OUTLINE_BLOCKS = ['listing', 'headings', 'languages', 'sharing', 'structured', 'content'] as const;
export type OutlineBlockId = (typeof OUTLINE_BLOCKS)[number];
export const OUTLINE_OPEN_AT_START: readonly OutlineBlockId[] = ['listing', 'headings'];
export type OutlineTone = 'ok' | 'warning' | 'neutral';
export interface OutlineFinding {
  /** The message key under `pages.drawer.outline.finding`. */
  id: string;
  values: Record<string, string | number>;
  /** The Issues check this finding belongs to (spec 9.6.3), or null when no check covers it. */
  checkId: string | null;
}
export interface OutlineStripCell {
  id: 'h1' | 'headings' | 'words' | 'images';
  value: number | null;
  note: { id: string; values: Record<string, number> };
  warn: boolean;
}
export interface OutlineModel {
  strip: OutlineStripCell[];
  listing: { tone: OutlineTone; findings: OutlineFinding[] };
  headings: {
    tone: OutlineTone; findings: OutlineFinding[]; first: PageOutlineBody['headings']; rest: PageOutlineBody['headings'];
    h1Text: string | null; capped: { shown: number; total: number } | null;
  };
}
/** `issues` are the page's issues when the Issues seam is ready, else null (spec 9.6.1: no invented duplicate). */
export function outlineModel(outline: PageOutlineBody, issues: readonly PageIssue[] | null): OutlineModel;
```

  `outline-block.tsx`: `OutlineBlock({ id, title, summary, tone, open, onToggle, children })`: a `section`
  with the card's border and radius; an `h3` holding one `button` (`aria-expanded`, `aria-controls`, the
  caret icon turned when closed, the title in the strong body type, the summary in the meta type truncated
  to one line, then the chip "Fine" or "To fix" through `Badge` with its positive or warning tone, no chip
  for `neutral`); the body a `div` with `role="region"`, `aria-labelledby` the button's id and `hidden` when
  closed. Also here: `OutlineFindingRow({ finding, href })` (the warning icon `aria-hidden`, the sentence,
  and `TextLink` "See in Issues" only when `href` is not null), `OutlineFact({ label, children })` (a `dt`
  and `dd` pair in a `dl` grid) and `LengthMeter({ chars, max, state, label })` (the bar `aria-hidden`, its
  width `min(100, chars / max)` as a style width in percent, which is a computed size and not a design
  token; the label beside it).
  `outline-blocks.tsx`: `ListingBlock` and `HeadingsBlock`, each taking the outline, its part of the model,
  `open`, `onToggle` and `issueHref: (checkId: string | null) => Route | null`. The preview is a `div` named
  by `listing.previewLabel` with three text nodes: the host and path (from `new URL(outline.url)` inside a
  `try`, falling back to the raw text), the title cut at 60 characters with three dots, the description
  clamped to two lines. The headings list is an `ol`; each `li` has the level badge and the text, with a
  left padding of one spacing step per level through a class lookup of six fixed classes (no inline
  padding); the "Show all" button keeps its place in the DOM so the focus stays on it.
  `drawer-outline-tab.tsx`: `usePageOutline(context.scope, urlId, active)` (the panel passes whether the tab
  is selected); `usePageIssues` for the duplicate description; the open blocks in a `useState` set started
  from `OUTLINE_OPEN_AT_START`, held by `page-inspector.tsx` so it survives stepping (pass `openBlocks` and
  `onToggleBlock`); "show all headings" in a `useState` keyed by `urlId`; the states of spec 9.6.3 as one
  sentence each; the strip as a `dl` in one joined panel, two columns that become four at the container
  width the tiles of Task 24 use; then the two blocks; then the footer line. While the crawl in view is the
  latest (`!context.crawl.older`), a page that is not live is decided from the page row first (redirect,
  error), so its sentence shows without waiting for the read; with an older crawl in view the row is not the
  latest crawl's, so the tab waits for the read and uses its `state`.
  Every string from the page is a text child (`{value}`); never `dangerouslySetInnerHTML`, never an `href`,
  `src` or `style` built from page text.
  `page-inspector.tsx`: the Outline panel renders the tab.
  `docs/design-system/16-drawers-dialogs-popovers.md` section 2.4, after "Cards are not collapsible.": add
  "One exception: the blocks of the page drawer's Outline tab fold, because the tab is six long lists of
  facts and two of them are what most people open it for (Pages spec 9.6.3)."

- [ ] **Step 6: Run** `src/lib/pages/outline-model.test.ts` and `src/features/internal-links/inspector`,
  expect pass. Run the web commands and the two message tests
  (`src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`).

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the Outline tab with its numbers, search listing and headings"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: no HTML injection
  (search the diff for `dangerouslySetInnerHTML`, `innerHTML`, and any `href`, `src` or `style` fed from the
  outline: the title, description and headings are rendered as text only, and the injection test would fail
  without that); the folding blocks (a real `button` in a heading, `aria-expanded`, `aria-controls`, a named
  region, Enter and Space, focus kept, the closed body not reachable by Tab); the headings are an ordered
  list and say their level in text; chips and meters carry words, colour is not the only sign; "See in
  Issues" is absent, not disabled, when `hrefs.issueCheck` gives `null`, and no new seam was added; the
  check ids against the table of spec 9.6.3; the duplicate description appears only from `usePageIssues`;
  the outline is requested only while the tab is open; the six states each show one sentence; glossary
  words ("Outline", "Alt text", "Canonical", "the latest crawl"); no shared drawer file in the diff.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 25c: The Outline tab's other four blocks

Spec 9.6.3 (Languages, Social sharing, Structured data, Content), 9.6.1 (what is not in the answer). UI task.

**Files:**
- Modify: `apps/web/src/lib/pages/outline-model.ts`, `outline-model.test.ts`
- Create: `apps/web/src/features/internal-links/inspector/outline-more-blocks.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/drawer-outline-tab.tsx`, `drawer-outline-tab.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** Task 25b's `outline-model.ts`, `outline-block.tsx` and `outline-blocks.tsx`
  (reuse `OutlineBlock`, `OutlineFindingRow`, `OutlineFact`; write no second version of any of them).

- [ ] **Step 2: Words** (namespace `pages.drawer.outline`):

| Key | Text |
|---|---|
| `languages.title` | Languages |
| `languages.summary` | {count, plural, one {# version} other {# versions}}, with x-default |
| `languages.summaryNoDefault` | {count, plural, one {# version} other {# versions}}, no x-default |
| `languages.summaryOne` | One language ({lang}), no versions |
| `languages.summaryOneUnknown` | No language versions |
| `languages.none` | The page names no other language versions. That is fine for a site in one language. |
| `languages.thisPage` | This page |
| `languages.wrongCode` | Wrong code |
| `languages.listLabel` | Language versions |
| `sharing.title` | Social sharing |
| `sharing.summaryFine` | Open Graph and X card set |
| `sharing.summaryPartly` | Open Graph set, no X card |
| `sharing.summaryNone` | No Open Graph tags |
| `sharing.factTitle` | Title |
| `sharing.factDescription` | Description |
| `sharing.factImage` | Image |
| `sharing.factType` | Type |
| `sharing.factCard` | X card |
| `sharing.missing` | Missing |
| `structured.title` | Structured data |
| `structured.summary` | {count, plural, one {# block} other {# blocks}}: {types} |
| `structured.summaryNone` | No structured data |
| `structured.none` | The page has no structured data blocks. |
| `structured.unnamed` | Unnamed block |
| `structured.valid` | Valid JSON |
| `structured.unreadable` | Cannot be read |
| `structured.listLabel` | Structured data blocks |
| `content.title` | Content |
| `content.summary` | {words} words, {images, plural, one {# image} other {# images}} |
| `content.factWords` | Words |
| `content.factImages` | Images |
| `content.factLinksOut` | Links out |
| `content.readTime` | {minutes} min read |
| `content.allAlt` | All have alt text |
| `content.noAlt` | {count} without alt text |
| `content.noImages` | No images |
| `content.linksOut` | {count, plural, one {# internal link} other {# internal links}} |
| `content.linksOutNote` | to other pages of the site |
| `finding.hreflang` | "{code}" is not a language code Google reads. |
| `finding.hreflangSuggest` | "{code}" is not a language code Google reads: use {suggestion}. |
| `finding.socialTags` | The page has no Open Graph tags, so a shared link has no title or image. |
| `finding.schemaErrors` | A structured data block cannot be read, so search engines skip it. |
| `finding.thinContent` | The page has very little text. Add what a visitor needs to know, or merge it into a fuller page. |
| `finding.imageAlt` | {count, plural, one {# image has} other {# images have}} no alt text, so screen readers and Google cannot tell what they show. |

- [ ] **Step 3: Write the failing tests.**
  `outline-model.test.ts` (added cases): `OutlineModel` gains `languages`, `sharing`, `structured`, `content`,
  each `{ tone, findings, summary: { id, values } }`:
  - languages: no pairs gives `tone: 'neutral'` and `summaryOne` with `html_lang` (or `summaryOneUnknown`
    when it is null); pairs with `x_default` give `summary` whose count leaves the `x-default` pair out; a
    pair that is not valid gives a finding `hreflangSuggest` (or `hreflang` without a suggestion) with
    `checkId: 'hreflang'` and `tone: 'warning'`;
  - sharing: `og_title` null gives `summaryNone`, one finding `social-tags`, `warning`; `og_title` set and
    `twitter_card` null gives `summaryPartly` and `ok`; both set `summaryFine`;
  - structured: no blocks gives `summaryNone` and `neutral`; blocks give `summary` with the count and the
    types joined by ", " (a block without types counts and adds no name); one finding `schema-errors` per
    block that does not parse;
  - content: findings `thin-content` when `thin`, `image-alt` with the count when any image has no alt
    text; `ok` with neither.
  `drawer-outline-tab.test.tsx` (added cases):
  - the four blocks follow Headings in the order Languages, Social sharing, Structured data, Content, each
    closed at the start (`aria-expanded="false"`) with its summary visible;
  - opening Languages on `OUTLINE_PROBLEM_PAGE` shows one row per pair (code, path, "Wrong code" for the bad
    one, "This page" for the own one) and the finding with its suggestion;
  - opening Social sharing on a page without tags shows "Missing" five times and the finding; the image of
    a healthy page is shown as its address in text and the document has no `img` element in the block;
  - Structured data: a row per block with its types or "Unnamed block" and "Valid JSON" or "Cannot be
    read"; nothing in the tab claims to know what is wrong inside a block;
  - Content: words with the read time, images with "All have alt text" or the count, "Links out" with the
    `outlinks` of the page detail (not a field of the outline);
  - Languages with no pairs has no chip; a block with a finding reads "To fix";
  - "See in Issues": with `hrefs.issueCheck` returning a route, the findings for hreflang, Open Graph,
    structured data, thin content and alt text each link to their check; with `null`, none is rendered;
  - text is text: an `og_title` of `<script>alert(1)</script>` and a JSON-LD type of `<i>x</i>` are shown as
    characters;
  - `axe` finds nothing with all six blocks open.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** The four model parts in `outline-model.ts`. `outline-more-blocks.tsx`:
  `LanguagesBlock`, `SharingBlock`, `StructuredBlock`, `ContentBlock`, built from the parts of Task 25b.
  The pairs and the structured blocks are lists (`ul` with the labels above); the facts are `OutlineFact`
  rows; the path of a pair's address is read with `new URL` inside a `try`, falling back to the raw text.
  `ContentBlock` takes `outlinks: number` from the page detail the drawer already holds.
  `drawer-outline-tab.tsx` renders the four after Headings and passes each its `open` and `onToggle`.

- [ ] **Step 6: Run** `src/lib/pages/outline-model.test.ts` and `src/features/internal-links/inspector`,
  expect pass. Run the web commands and the two message tests.

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the Outline tab's languages, sharing, structured data and content"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the same checks as
  Task 25b for the four new blocks (text only, no element from page text, the sharing image never drawn or
  linked; folding and names; words on every chip); nothing the API does not return is shown (no image
  size, no note on what is wrong inside a block, no "duplicate" without the Issues data); the block order
  and which start open against spec 9.6.3; no component of Task 25b was copied; `messages/en.json` has no
  key of this tab that nothing uses.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 25d: Notes on the web: types, reads, writes, drafts and the mocked API

Spec 9.7.2, 9.7.3 (the first paragraph and the draft rule). Contracts C5, C7. No visible change.

**Files:**
- Modify: `apps/web/src/lib/internal-links/types.ts`, `queries.ts`, `queries.test.ts`
- Create: `apps/web/src/lib/pages/notes.ts`, `notes.test.tsx`, `note-drafts.ts`, `note-drafts.test.ts`
- Create: `apps/web/src/mocks/internal-links-notes.ts`, `internal-links-notes.test.ts`
- Modify: `apps/web/src/mocks/handlers/internal-links.ts`, `handlers/internal-links.test.ts`,
  `apps/web/src/mocks/internal-links-world.ts` (the page detail's `notes_count`)

- [ ] **Step 1: Read first.** `lib/internal-links/queries.ts` (`pageDetailQuery`, `internalLinksKeys`, how a
  cursor read is written: `grep -n "cursor" src/lib/internal-links/queries.ts`), one write hook of the
  feature with its invalidation (`grep -rn "useMutation" src/features/internal-links src/lib/internal-links | head`),
  the API client's call for `POST`, `PATCH` and `DELETE` (`src/lib/api`), the mock world's users and roles
  (`mocks/internal-links-world.ts`, and how a handler knows the caller: `projectCaller`), the handler of
  `pages/{url_id}` (line 791 of `mocks/handlers/internal-links.ts`).

- [ ] **Step 2: Write the failing tests.**
  - `queries.test.ts`: `pageNotesQuery(scope, '108')` has a key that starts with the project key and
    `'internal-links'` and holds `'notes'` and the page; `pageNotesQuery(scope, 'abc')` throws `UrlIdError`.
  - `note-drafts.test.ts`: `noteDraft(scope, '108')` is `''` at first; after `setNoteDraft(scope, '108', 'x')`
    it is `'x'` for that project and page and `''` for another page and for another project; setting `''`
    and `clearNoteDraft` both remove it; nothing is written to `localStorage` or `sessionStorage`.
  - `internal-links-notes.test.ts` (the mock store): seeded notes for two pages, newest first; `add` puts a
    note first with the caller as author; `change` by the author sets `edited_at`, by another user answers
    forbidden; `remove` by the author or an admin hides it and `restore` by the one who removed it brings it
    back in its place; `countOf(page)` leaves removed notes out; a body is trimmed and one over 2,000
    characters or empty is refused.
  - `handlers/internal-links.test.ts`: the five routes answer as spec 9.7.2 (201, 200, 204, 200; `403` for a
    viewer's write and for another editor's change; `404` for an unknown page or note; `422` for an empty
    body); the list is cursor paged with `limit`; the page detail's `notes_count` follows the writes;
    `can_edit` and `can_delete` follow the caller.
  - `notes.test.tsx` (`renderHook` in the providers, the mocked API): `usePageNotes(scope, '108', true)`
    answers `loading`, then `ready` with the notes, `total`, `hasMore` and `loadMore`; with `enabled` false
    it sends nothing; a 500 gives `error` with a working `retry`. `usePageNoteWrites(scope, '108')`:
    `add('x')` resolves with the note, and afterwards the list holds it and the page detail query of that
    page was invalidated (its `notes_count` is one more); `change`, `remove` and `restore` likewise; a
    refused write rejects with the API's error and the list is unchanged; `pending` is true while a write
    runs.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.**
  `types.ts`: `export type PageNote = Schemas['PageNote'];`. `queries.ts`: the path constants
  `PAGE_NOTES` and `PAGE_NOTE` (`…/pages/{url_id}/notes` and `…/notes/{note_id}`), `pageNotesQuery(scope,
  urlId)` written as the feature's other cursor read (an infinite query when that is how the feature pages
  a "show more" list; otherwise the first page and a `cursor` argument), its key under the project's
  `'internal-links'` key so `internalLinksKeys` reaches it.
  `note-drafts.ts`:

```ts
/** Text typed into a page's note box and not saved yet. In memory only: it lives as long as the browser tab. */
export function noteDraft(scope: LinksScope, urlId: string): string;
export function setNoteDraft(scope: LinksScope, urlId: string, text: string): void;
export function clearNoteDraft(scope: LinksScope, urlId: string): void;
```

  one module-level `Map` keyed by workspace, project and page.
  `notes.ts`:

```ts
export const NOTE_MAX = 2000;
/** From this length on the box shows its count. */
export const NOTE_COUNT_FROM = 1800;
export type NotesRead =
  | { state: 'loading' }
  | { state: 'error'; retry: () => void }
  | { state: 'ready'; notes: readonly PageNote[]; total: number; hasMore: boolean; loadMore: () => void; loadingMore: boolean };
export function usePageNotes(scope: LinksScope, urlId: string, enabled: boolean): NotesRead;
export interface PageNoteWrites {
  add: (body: string) => Promise<PageNote>;
  change: (noteId: string, body: string) => Promise<PageNote>;
  remove: (noteId: string) => Promise<void>;
  restore: (noteId: string) => Promise<PageNote>;
  pending: boolean;
}
export function usePageNoteWrites(scope: LinksScope, urlId: string): PageNoteWrites;
```

  Each write invalidates the notes of the page and the page detail of that page (every crawl: match the
  detail key by its page, not by its run), and nothing else.
  `mocks/internal-links-notes.ts`: an in-memory store per project (`notesOf`, `add`, `change`, `remove`,
  `restore`, `countOf`, `resetNotes` for the tests), seeded with three notes on one live page and one on the
  home page, by two users of the mock world, one of them edited; dates fixed, not `Date.now()`, for the
  seed. The handlers: five `mock(…)` entries with `projectCaller` (`data:read` for the list, `notes:write`
  for the writes) and the rules of the store. The mocked page detail sets `notes_count` from `countOf`.

- [ ] **Step 5: Run the tests, expect pass. Run the web commands** on the files of this task, and
  `pnpm exec vitest run --maxWorkers=1 src/mocks/internal-links-world.test.ts src/features/internal-links/inspector`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: notes on a page, their reads, writes, drafts and mocked API"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: no hand-written
  copy of a response type; the query keys and what each write invalidates (the notes and the page detail,
  not the whole feature); the draft store is memory only and keyed by project and page; the mock enforces
  the same rules as the API (author only, soft delete, restore by the one who deleted, the body limits), so
  a UI test cannot pass against rules the server does not have; no user id is compared on the web
  (`can_edit` and `can_delete` are the API's).

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 25e: The drawer's Notes tab

Spec 9.7.3, 9.4 (the count on the tab), 11. Contracts C5, C7. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/drawer-notes-tab.tsx`, `note-editor.tsx`,
  `note-item.tsx`, `drawer-notes-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** Spec 9.7.3 whole. `lib/pages/notes.ts`, `note-drafts.ts`,
  `components/ui/textarea.tsx`, `field.tsx` (how a field ties its hint with `aria-describedby`),
  `icon-button.tsx`, `tooltip.tsx`, `avatar.tsx`, `toast.tsx` (`toast({ type, title, action })`),
  `lib/a11y/announcer.ts` (`announce`), `lib/format/date.ts` (`formatDetailDateTime`, `browserTimeZone`),
  `components/ui/tabs.tsx` (`TabItem.count`), and `components/app/inspector/inspector.tsx` lines 110 to 140:
  the drawer closes on Escape through a native `keydown` listener on its card and skips an event that is
  `defaultPrevented`. A React `onKeyDown` runs after that listener, so it cannot stop it; the edit box needs
  a native listener on the `textarea` itself. Do not edit that file.

- [ ] **Step 2: Words** (namespace `pages.drawer.notes`). `tabs.notes` exists (Task 23); remove
  `notes.pending`.

| Key | Text |
|---|---|
| `tabCount` | {count, plural, one {# note} other {# notes}} |
| `addLabel` | Add a note to {path} |
| `placeholder` | What changed on this page, what is planned, what to check later |
| `add` | Add note |
| `save` | Save |
| `cancel` | Cancel |
| `hint` | Cmd or Ctrl + Enter saves |
| `count` | {count} of {max} |
| `listLabel` | Notes, newest first |
| `edited` | edited |
| `editedAt` | Edited {when} |
| `edit` | Edit note |
| `editLabel` | Edit your note |
| `delete` | Delete note |
| `showOlder` | Show older notes |
| `empty` | No notes on this page yet. |
| `emptyWhy` | Write down what you changed and when, so the next drop or rise in its numbers has a reason beside it. |
| `footer` | Everyone in this workspace can read these notes. They stay with this address when the site is crawled again. |
| `loadFailed` | The notes of this page could not be loaded |
| `added` | Note added |
| `saved` | Note saved |
| `deleted` | Note deleted |
| `restored` | Note restored |
| `undo` | Undo |
| `addFailed` | The note could not be added. Your text is still in the box. |
| `saveFailed` | The note could not be saved. Your text is still in the box. |
| `deleteFailed` | The note could not be deleted |
| `restoreFailed` | The note could not be restored |

- [ ] **Step 3: Write the failing tests** in `drawer-notes-tab.test.tsx` (the tab inside the real `Inspector`
  and the providers, the mocked API of Task 25d, an editor unless the case says otherwise):
  - the box is a `textarea` with the accessible name "Add a note to /pricing", `maxLength` 2000, described
    by the hint; "Add note" is disabled while the text is empty or only spaces;
  - typing a note and pressing "Add note" sends it trimmed; the note is first in the list; the box is empty
    and has the focus; "Note added" is announced (spy on `announce`); the same with Ctrl + Enter and with
    Meta + Enter; Enter alone adds a line and sends nothing;
  - the count appears from 1,800 characters ("1,800 of 2,000") and not below;
  - the draft: type "half a thought", select another tab and come back (unmount and mount the tab): the
    text is in the box; step to another page: its box is empty; step back: the text is there; after a save
    the draft is gone;
  - the list is an `ol` named "Notes, newest first"; each item shows the author's name, a `time` element
    whose `dateTime` is the note's instant and whose text is `formatDetailDateTime` of it in the browser's
    time zone, and the body; a body of two lines keeps its line break (the element has the pre-wrap class
    and its text content holds the `\n`); an edited note shows "edited", whose accessible description is
    "Edited" and that time;
  - a body `<img src=x onerror=alert(1)>` and a body `<a href="https://x.test">x</a>` are in the document
    as those characters; the list holds no `img` and no link;
  - "Edit note" and "Delete note" are on the caller's own notes only; a viewer (no `notes:write`) sees the
    list, no box, no button, and of the empty state only its first sentence; an admin sees "Delete note"
    and no "Edit note" on another person's note;
  - edit: pressing "Edit note" turns the body into a box named "Edit your note" holding the text, with
    Save and Cancel; changing it and pressing Save shows the new text and "edited", announces "Note saved"
    and returns the focus to that note's Edit button; Ctrl + Enter saves too; Save is disabled for an empty
    text; saving the unchanged text sends no request; only one note is in edit at a time;
  - Escape in the edit box cancels the edit, the first text is back, the focus is on the Edit button and the
    drawer is still open (the `onClose` of the `Inspector` was not called); Escape in the add box closes the
    drawer and the draft is kept; typing "j" and "k" in either box types the letters and does not step to
    another page;
  - delete: the note leaves the list, the tab's count goes down, a toast "Note deleted" with "Undo" shows
    and "Note deleted" is announced; pressing Undo brings the note back in its place with its first time
    and announces "Note restored"; the focus after a delete is in the add box;
  - a failed add (the mock answers 500) keeps the text in the box, shows the error toast `addFailed` and
    announces nothing as done; a failed save keeps the edit box open with the text;
  - empty: both sentences for an editor; the footer line is always last;
  - loading shows a skeleton; a failed list shows `loadFailed` with a Retry that works; "Show older notes"
    appears with more than one page (seed 51 notes) and adds the next page, the focus staying on the button
    or, when it goes, on the first new note;
  - `axe` finds nothing with notes, in edit, and empty.
  `page-inspector.test.tsx`: the Notes tab reads "Notes" with the count 3 for the seeded page (the count's
  accessible text is "3 notes") and has no count for a page without notes; the count comes from the page
  detail, with no notes request before the tab is selected; the tab is there for a redirect and for a 404
  row.

- [ ] **Step 4: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector/drawer-notes-tab.test.tsx`

- [ ] **Step 5: Implement.**
  `note-editor.tsx`: `NoteEditor({ label, value, onChange, onSave, onCancel, saveLabel, pending, autoFocus })`:
  the `Textarea` with `aria-label`, `maxLength={NOTE_MAX}`, `aria-describedby` the hint and the count; the
  row under it: the primary small button (disabled while `value.trim() === ''` or `pending`), Cancel when
  `onCancel` is given, the hint, and the count from `NOTE_COUNT_FROM`. Keys through one native `keydown`
  listener on the `textarea` (a ref and an effect): Enter with `metaKey` or `ctrlKey` saves and is
  prevented; Escape, only when `onCancel` is given, calls `preventDefault()` and `stopPropagation()` and
  then `onCancel` (one comment says why it is native: the drawer's own Escape listener sits on its card
  and runs before React's). Nothing else is stopped, so letters are typed as letters.
  `note-item.tsx`: one `li`: `Avatar` from the author's name with `aria-hidden`, the name, the `time`, the
  word "edited" inside a `Tooltip` and with `aria-description` or a visually hidden text carrying the same
  sentence, the two `IconButton`s where `can_edit` and `can_delete` say so, and the body as
  `<p className="whitespace-pre-wrap break-words">{note.body}</p>`; in edit, a `NoteEditor` in place of the
  body. The body is a text child only: no `dangerouslySetInnerHTML`, no linkifying.
  `drawer-notes-tab.tsx`: `usePageNotes(scope, urlId, active)`, `usePageNoteWrites(scope, urlId)`; the add
  box (only with `context.canNote`) whose value is `noteDraft` in a `useState` started from the store and
  written back on every change, cleared after a save; `editing: string | null`; the handlers call the
  writes, then `announce` and, for a delete, `toast({ type: 'success', title: t('deleted'), action: { label:
  t('undo'), onAction: restore } })`; a failed write shows `toast({ type: 'error', … })` and keeps the text;
  focus is moved with refs after each write as the tests say; the list, "Show older notes", the empty
  state, the footer.
  `page-inspector.tsx`: the Notes panel renders the tab; the Notes item of the tab row gets
  `count: formatNumber(detail.notes_count)` (the number formatter of `@/lib/format`) when
  `(detail.notes_count ?? 0) > 0`, and the tab's accessible name carries `tabCount` if `TabItem.count` does
  not already read as a number of notes (read `tabs.tsx`; do not change it).

- [ ] **Step 6: Run** `src/features/internal-links/inspector`, expect pass. Run the web commands and the two
  message tests (`src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`).

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the Notes tab, with add, edit, delete and undo"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the body is rendered
  as text (search the diff for `dangerouslySetInnerHTML`, `innerHTML` and any link built from a note; the
  injection test would fail without that); author-only controls follow `can_edit` and `can_delete` and the
  server still refuses when they are forced (Task 5e's tests); delete is followed by a working Undo and no
  confirm dialog; the draft survives a tab switch and a step and is cleared only by a save; Escape in the
  edit box cancels the edit and leaves the drawer open, proven against the real `Inspector`, with no shared
  drawer file in the diff; J and K type letters in the boxes; the `textarea` has a name, its hint and count
  are its description, the icon buttons have names; every write is announced once and a failed write is
  not announced as done; "edited" gives its time to assistive technology, not only in a tooltip; times are
  in a `time` element, in the viewer's time zone, through the app's formatter (no `Intl` or `toLocale` call
  in the feature); focus after add, save, cancel, delete and undo; the tab's count comes from the page
  detail; glossary words ("Notes", "Add note", never "comment").

- [ ] **Step 9: Fix what the review found**, rerun, commit.

---

## Part F2. Notes: mentions, slash commands and attachments

Owner addition of 2026-11-27, spec 9.8 and decisions D17 to D28. Task numbers are not shifted: the new tasks
carry letters after the Notes tasks they extend (5f to 5i after 5e, Task 6b after Task 6, 25f to 25k after 25e).

**Placement, and what may run when.** Tasks 1 to 18 are built, and Notes already has its table (5d), its API
(5e) and its client (6). This block is written after Task 25e because its web tasks change the files Task 25e
creates (`drawer-notes-tab.tsx`, `note-editor.tsx`, `note-item.tsx`) and the modules Task 25d creates
(`notes.ts`, `note-drafts.ts`, the notes mock); they run after 25e and in the order 25f to 25k. The backend tasks
5f to 5i and Task 6b depend only on 5e and Task 6, and no task from 19 to 25e reads them, so the lead may run
them next, before Task 19, while the backend session and Colima are warm; they must all be done before 25f.
Task 6b is the second regeneration of the client: Task 6 is done and its commit is not touched, so the new
routes and fields come in a commit of their own, right after the last new backend task (5i). The new schema
fields have defaults (`mentions`, `attachments`), so the generated types make them optional and the mocks and
fixtures written before Task 25f still typecheck, as for `notes_count`.

Where a test written in 25d or 25e no longer holds after these tasks (the placeholder text; "Add note" is
disabled for an empty text, which now means no text and no file; the mock refusing an empty body), the later
task changes that test in its own commit and says so.

Backend order: 5f (mentions: the column and the checks), 5g (the judge of a file's type and the storage of
note files, pure and storage only), 5h (the table, the quota, the upload route), 5i (attach, answer, serve),
then 6b. Web order: 25f (pure modules), 25g (data for mentions), 25h (the combobox), 25i (chips), 25j (data for
files), 25k (the file controls). Each is one Sonnet context.

### Task 5f: Mentions on notes: the column, the checks, the answers

Spec 9.8.1, 9.8.6 (mentions), decisions D17, D18, D19. Contract C7b. Backend only. The note routes and the
audit entries exist (5e); this task adds one column and what the writes do with it.

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0043_page_note_mentions.py`
- Modify: `backend/src/idraft/db/tables.py` (`page_notes.mentions`)
- Modify: `backend/tests/db/test_grants.py`, `backend/tests/db/test_page_notes_schema.py`
- Create: `backend/src/idraft/api/internal_links/mention_sources.py`, `page_note_mentions.py`
- Modify: `backend/src/idraft/api/schemas/page_notes.py`, `api/internal_links/page_notes.py`,
  `page_note_routes.py`, `api/resources.py`, `api/main.py` (the issue seam is passed in)
- Create: `backend/tests/api/internal_links/test_page_note_mentions.py`
- Modify: `backend/tests/api/internal_links/test_page_notes.py` (only where a shape changed),
  `backend/openapi/v1.json`, `docs/04-data-model.md` (section 5.4), `docs/19-api-specification.md`

- [ ] **Step 1: Read first.** Spec 9.8.1 whole. `0042_page_notes.py` and `0038_keyword_prompt_links.py`
  (how a column is added and its grant widened: `column_grant`), `api/internal_links/page_notes.py` and
  `schemas/page_notes.py` (Task 5e: `PageNoteWrite`, `_note_view`, the audit calls), `api/problems.py`
  (`invalid_fields`, `invalid_field`, the 422 helpers; how a field error carries a code and a location,
  `grep -rn "invalid_fields" backend/src/idraft/api | head`), `api/workspaces/repository.py` (how a membership
  is read), `api/internal_links/extras.py` `_KEYWORDS` (the tracked keyword rules: `is_active`, `deleted_at`),
  `tables.py` `memberships`, `tracked_keywords`, `keywords`, `urls`, `crawl_pages`.

- [ ] **Step 2: Write the failing tests.**
  - `tests/db`: `mentions` is an array of at most 20 (a non-array and 21 entries are refused by the check);
    default `[]`; the API role may update `mentions` and the grants test lists it with `body`, `edited_at`,
    `deleted_at`, `deleted_by`; migration up and down.
  - `test_page_note_mentions.py`, as spec 9.8.8 lists for it (a seeded crawl, an owner, two editors, a
    viewer, a member of a second workspace, a user who is in no workspace, tracked keywords active, inactive
    and deleted, a fake `IssueChecks`).

- [ ] **Step 3: Run, expect failures.**
  `uv run pytest -n 0 --no-cov tests/db/test_page_notes_schema.py tests/db/test_grants.py tests/api/internal_links/test_page_note_mentions.py`

- [ ] **Step 4: Implement.** The migration (`Revision ID: 0043`, `Revises: 0042`, a docstring that says what and
  that the API writes it):

```python
def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.page_notes
            ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'
            CHECK (jsonb_typeof(mentions) = 'array' AND jsonb_array_length(mentions) <= 20)
        """
    )
    op.execute(column_grant("core.page_notes", role="app_api", privilege="UPDATE", columns=("mentions",)))


def downgrade() -> None:
    op.execute("ALTER TABLE core.page_notes DROP COLUMN mentions")
```

  `tables.py`: `Column("mentions", JSONB, nullable=False, server_default=FetchedValue())` on `page_notes`.
  `schemas/page_notes.py`: the classes of C7b (`PageNoteMentionIn`, `PageNoteMention`), `mentions` on
  `PageNote` (default empty) and `PageNoteWrite.mentions: list[PageNoteMentionIn] | None = None` with
  `max_length=MENTIONS_MAX`; `label` validated 2 to 200 characters, starts with `@`, no `\n` or `\r`;
  `target` 1 to 200 characters.
  `mention_sources.py`: `IssueChecks` and `NoIssueChecks` exactly as spec 9.8.1 writes them.
  `page_note_mentions.py`:

```python
async def check_mentions(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    body: str,
    mentions: Sequence[PageNoteMentionIn],
    issues: IssueChecks,
) -> list[StoredMention]: ...
async def paths_of(db: AsyncSession, mentions: Sequence[StoredMention]) -> dict[str, str]: ...
```

  `check_mentions` first drops entries whose label is not in `body` and repeated labels (first kept), then
  validates the rest by type with one statement each (all targets of a type in one query): page (a crawl page
  of this project holds the `url_id`; a target that is not digits is a field error), user (`memberships` of
  `access.workspace_id`; a target that is not a UUID is a field error), keyword (an active, not deleted
  `tracked_keywords` row of the project whose `keywords.text` equals the target), issue (`issues.known`;
  `None` is `mention_type_unavailable`, a missing id is `mention_target_unknown`). Every failure is one `422`
  that lists each failing entry at `mentions[i].target` (or `.type`) with its code (follow
  `invalid_fields`). It returns the entries to store, as plain dicts `{type, label, target}`.
  `page_notes.py`: `create` calls `check_mentions` with the new body; `update` with the new body and the
  `mentions` sent, or, when omitted, the stored ones (so entries whose label left the text are dropped);
  `mentions` is written in the same statement as `body`; `edited_at = now()` when the body or the stored list
  changed; `_note_view` fills `mentions` (page entries get `path` from `core.urls` through `paths_of`, one
  query for the whole list, so a list of notes costs one more statement); the audit snapshots of
  `page_note.created` and `page_note.updated` hold `mentions`. The service takes `issues: IssueChecks`
  (default `NoIssueChecks()`), passed from `main.py` and `resources.py` as the other collaborators are.
  `docs/04-data-model.md` section 5.4: the column and its rule in two sentences. `docs/19-api-specification.md`:
  the changed bodies and the new error codes.

- [ ] **Step 5: Run the tests of step 3, then** `uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_notes.py tests/api/test_openapi.py tests/api/test_route_access.py tests/db/test_migrations.py tests/db/test_rls.py`.
  Regenerate the OpenAPI document (Backend commands). Then ruff, ruff format, mypy and `lint-imports` on the
  files this task changed, as the Backend commands say.

- [ ] **Step 6: Commit.** `git commit -m "Pages API: mentions on a page note, checked by type"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: every `target` is
  checked against the database for its type, scoped to the workspace and the project (a page of another
  project, a user of another workspace, a tracked keyword of another project are each refused); an `issue`
  entry cannot be stored on this branch; a label not in the text never reaches the column; the list is capped
  at 20 in the schema and in the database; the checks run in the note's transaction; `path` is derived on
  read and never stored; a refused write records no audit row and changes nothing; the migration revises
  `0042`, touches no other table and the grant adds only `mentions`; no mention can make the server read
  anything but ids and text (no HTML, no URL fetch); labels are stored as text and never interpreted.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 5g: The judge of a file's type and the storage of note files

Spec 9.8.5 (type, name, storage key), decisions D22, D23. Pure code and one storage module; no table, no route.

**Files:**
- Create: `backend/src/idraft/storage/file_sniff.py`, `backend/src/idraft/storage/note_files.py`
- Create: `backend/tests/storage/test_file_sniff.py`, `backend/tests/storage/test_note_files.py`

- [ ] **Step 1: Read first.** Spec 9.8.5 whole. `storage/screenshots.py` (the pattern: key function, `put`,
  `get` through `ObjectStore` with `compress` and `decompress`), `storage/raw.py` (`ObjectStore`, `compress`,
  `decompress`, `UNPACKED_MAX`), `tests/storage/test_raw.py` and `support.py` (the fake store and how tests
  count its reads and writes), `api/imports/service.py` `_is_csv` and `_filename` (the house way to treat a
  name).

- [ ] **Step 2: Write the failing tests.**
  - `test_file_sniff.py`: exactly the pure list of spec 9.8.8 (`tests/storage/test_file_sniff.py` item). Build
    the byte strings in the test (a 1 by 1 PNG, a minimal JPEG, `GIF89a`, `RIFF....WEBP`, `%PDF-1.4`); every
    hostile case is a named test so a failure says which.
  - `test_note_files.py`: `note_file_key(workspace, project, attachment)` is
    `notes/v1/<workspace>/<project>/<attachment>.zst`; it refuses an argument that is not a UUID; `put_note_file`
    then `get_note_file` give the bytes back through the fake store; `get_note_file` of a missing key raises the
    store's error; the stored object is the compressed one.

- [ ] **Step 3: Run, expect failures.**
  `uv run pytest -n 0 --no-cov tests/storage/test_file_sniff.py tests/storage/test_note_files.py`

- [ ] **Step 4: Implement.**

```python
# storage/file_sniff.py
NOTE_FILE_MAX_BYTES: Final = 10 * 1024 * 1024
IMAGE_TYPES: Final = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
ACCEPTED_TYPES: Final = IMAGE_TYPES | {"application/pdf", "text/plain", "text/csv"}


class FileRefused(Exception):
    """The file is not one a note may hold. `reason` is a short code: `empty`, `type`, `markup`, `name`."""
    def __init__(self, reason: str) -> None: ...


def sniff(data: bytes, name: str) -> str:
    """The content type of `data`, decided by its bytes; the name only chooses text/csv over text/plain."""

def display_name(name: str | None) -> str:
    """The name to show: path parts and control characters removed, 255 characters at most, never empty."""
```

  The rules are the table of spec 9.8.5, in one function per family (`_image`, `_pdf`, `_text`) and one tuple of
  blocked extensions and one of markup markers as module constants with a one-line comment each. `sniff`
  raises `FileRefused`, never anything else, whatever the input (a test feeds random bytes). Keep it free of
  imports from the rest of the app.
  `note_files.py`: `note_file_key`, `put_note_file(store, workspace_id, project_id, attachment_id, data)` and
  `get_note_file(store, key)` written like `screenshots.py` (compress in a thread, store; read, decompress).

- [ ] **Step 5: Run the tests of step 3. Then**

```bash
uv run ruff check src/idraft/storage/file_sniff.py src/idraft/storage/note_files.py tests/storage/test_file_sniff.py tests/storage/test_note_files.py
uv run ruff format --check src/idraft/storage/file_sniff.py src/idraft/storage/note_files.py tests/storage/test_file_sniff.py tests/storage/test_note_files.py
uv run mypy src/idraft/storage tests/storage/test_file_sniff.py tests/storage/test_note_files.py
uv run lint-imports
```

- [ ] **Step 6: Commit.** `git commit -m "Storage: a judge of a note file's type by its content, and the keys of note files"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the type comes only
  from the bytes (the name's one use is csv versus plain text, and the blocked extensions); SVG, HTML, XML,
  scripts, archives, executables and Office files are each refused, under every file name, with test cases
  that name them; the PDF magic is at byte 0; the WebP check needs `RIFF` and `WEBP` together; text is
  validated whole (UTF-8, no NUL, only the allowed control characters) and the markup markers are looked for
  in the first 1,024 bytes after lower-casing; a PNG with HTML after its data is accepted as PNG on purpose
  and a comment says why it is harmless (the serving headers of 5i); no function reads more than the bytes it
  is given; the module imports nothing from `idraft.api`; the storage key is built from UUIDs only, never from
  a name.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 5h: The table of note files, the quota and the upload route

Spec 9.8.5 (size, the table, the cap and costs), 9.8.6 (the upload), decisions D21, D25, D26. Contract C7b.

**Files:**
- Create: `backend/src/idraft/db/migrations/versions/0044_page_note_attachments.py`
- Modify: `backend/src/idraft/db/tables.py` (`page_note_attachments`, `workspace_quotas.max_note_file_bytes`)
- Modify: `backend/tests/db/test_tables.py`, `support.py`, `test_grants.py`, `backend/tests/security/test_cross_tenant.py`,
  `backend/tests/db/test_page_notes_schema.py`, and every test that lists the columns of `workspace_quotas`
  (`grep -rln "max_serp_checks_per_month" backend/tests`)
- Create: `backend/tests/db/test_page_note_attachments_schema.py`
- Create: `backend/src/idraft/api/internal_links/page_note_files.py`, `page_note_file_routes.py`
- Modify: `backend/src/idraft/api/body_limit.py`, `api/audit.py` (`page_note.file_uploaded`),
  `api/resources.py`, `api/main.py`, `api/schemas/page_notes.py` (`PageNoteFile`)
- Create: `backend/tests/api/internal_links/test_page_note_files.py` (the upload half; 5i adds the rest)
- Modify: `backend/tests/api/test_route_access.py`, `backend/tests/api/test_body_limit.py`,
  `backend/openapi/v1.json`, `docs/04-data-model.md` (sections 4.1 and 5.5)

- [ ] **Step 1: Read first.** Spec 9.8.5 whole. `0042` and `0043`, `db/ddl.py`, `api/body_limit.py`
  (`LargerLimit`, `UPLOADS`, how `main.py` passes them), `api/imports/routes.py` and `service.py` `upload`
  (a multipart route: `UploadFile`, the 413 and 415 errors), `api/ai/screenshots.py` (how a service gets the
  store from `Resources`, `StorageUnavailableError` when it is `None`), `api/quotas/service.py` (how the
  quota rows are read and `quota_exceeded` is raised with `limit`, `used`, `requested`), `tests/api/test_body_limit.py`,
  `tests/api/ai/test_screenshots.py` (the fake store in an API test), `tests/db/test_page_notes_schema.py`.

- [ ] **Step 2: Write the failing tests.**
  - `tests/db`: the migration up and down; the table in `test_tables.py`; tenant column and seed row in
    `support.py` and `test_cross_tenant.py`; `test_grants.py` (the API role has `SELECT`, `INSERT` and `UPDATE`
    on exactly `note_id` and `removed_at`, no `DELETE`; the worker role nothing); the checks of spec 9.8.8
    (size 0 and 10,485,761, an unknown content type, `removed_at` without `note_id`, a name of 0 and 256
    characters); the body check now allows an empty body, and refuses 2,001 characters and an untrimmed one;
    `max_note_file_bytes` defaults to 1,073,741,824 and refuses a negative value; deleting a project removes
    its file rows.
  - `test_body_limit.py`: a `POST` to `…/note-attachments` has the 11 MB limit and any other method and
    path keeps 1 MB.
  - `test_page_note_files.py` (the upload half of spec 9.8.8's list): each accepted type; the hostile files
    through the route with the fake store counting its writes (none); the size cases; empty; missing part; the
    quota cases including concurrency at the edge (two uploads through `asyncio.gather` with room for one);
    no storage is `503`; a failing store records no row; a viewer is `403`; a member of another workspace is
    `404`; a `url_id` no crawl holds is `404`; one audit row per upload.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** The migration as spec 9.8.5 writes it (table, two indexes, the body check, the
  quota column), then `tenant_isolation("core.page_note_attachments")` and the grants. `tables.py` and the
  data model sections to match. `body_limit.py`: a second `LargerLimit`
  (`NOTE_FILE_PATH = re.compile(r"/api/v1/workspaces/[^/]+/projects/[^/]+/internal-links/pages/[0-9]+/note-attachments")`,
  `Limit(NOTE_FILE_MAX_BYTES + 1 MiB framing, "A note file is at most 10 MB.")`) in `UPLOADS`; the constant
  for the file size comes from `storage/file_sniff.py`, not a copy.
  `page_note_files.py`:

```python
class PageNoteFileService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None
    ) -> None: ...

    async def upload(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, *,
        filename: str | None, data: bytes, info: RequestInfo,
    ) -> PageNoteFile: ...
```

  `upload`: no store is `StorageUnavailableError`; more than `NOTE_FILE_MAX_BYTES` bytes is `PayloadTooLargeError`;
  `sniff` (a `FileRefused` is `UnsupportedMediaTypeError` for `type`, `markup` and `name`, and a field `422`
  for `empty`); then one transaction: the page check of 5e (`_require_page`, import it, do not copy it), the
  advisory lock `pg_advisory_xact_lock(hashtextextended(<workspace id>::text, 0))`, the quota (the sum of
  `size_bytes` of every row of the workspace plus this file against `max_note_file_bytes` of the workspace's
  quota row; over is `QuotaExceededError` with `limit`, `used`, `requested`, as the quota service raises it),
  a new attachment id, `put_note_file` (a `RawStorageError` is `StorageUnavailableError`, and the transaction
  rolls back so no row exists), the insert with `note_id` null, `uploaded_by` the caller and the sniffed type,
  `audit.record` `page_note.file_uploaded`. It returns `PageNoteFile` with `url` built by one function
  (`file_path(workspace_id, project_id, url_id, attachment_id)`, beside the service) that the answers of 5i
  reuse. The route reads the part with `await file.read(NOTE_FILE_MAX_BYTES + 1)`.
  The route file: the router with the prefix of the notes routes, `WriteNotes` dependency, summary "Upload a
  file for a note", a description that lists the status codes of spec 9.8.6. `resources.py` and `main.py`:
  `page_note_files: PageNoteFileService` built with the store `main.py` already opens (`sources`), the router
  included.

- [ ] **Step 5: Run the tests of step 2, regenerate the OpenAPI document, run the route access and OpenAPI
  tests, and the Backend commands on every file this task changed** (add `src/idraft/api/body_limit.py
  src/idraft/api/audit.py src/idraft/api/main.py src/idraft/api/resources.py src/idraft/db`).

- [ ] **Step 6: Commit.** `git commit -m "Pages API: the table of note files, the workspace quota and the upload route"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the size is enforced
  before the bytes are read (the middleware limit, then a read of at most the limit plus one byte), with a
  test that proves it; the type is the judge's, nothing else; the object is written before the row and a
  failure leaves no row; the quota counts every row of the workspace and is checked under a lock; no
  statement deletes a row or an object; the key holds only UUIDs; the grants allow updating `note_id` and
  `removed_at` only; the body check change is in the migration and the old rule (non-empty) is kept in the
  service until 5i; the quota column default and check; no dash in SQL comments; `PageNoteFile.url` is an API
  path with no host; nothing is logged that holds a file name or bytes.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 5i: Attach files to a note, answer with them, serve them

Spec 9.8.5 (attaching, serving, soft delete), 9.8.6, decisions D24, D26, D27. Contract C7b.

**Files:**
- Modify: `backend/src/idraft/api/schemas/page_notes.py`, `api/internal_links/page_notes.py`,
  `page_note_files.py`, `page_note_file_routes.py`, `page_note_routes.py`
- Modify: `backend/tests/api/internal_links/test_page_note_files.py` (the attach and serve half),
  `test_page_notes.py` (shapes), `backend/tests/api/test_route_access.py`, `backend/openapi/v1.json`
- Modify: `docs/19-api-specification.md`, `docs/24-security.md`, `docs/27-cost-model.md` (section 7),
  `docs/23-backup-disaster-recovery.md` (section 9.1)

- [ ] **Step 1: Read first.** Spec 9.8.5 and 9.8.6 whole, `page_notes.py` as 5f left it,
  `api/ai/screenshot_routes.py` `screenshot` (the response and its headers), `api/ai/screenshots.py` `image`
  (reading the object), how a `Content-Disposition` with a non-ASCII name is written
  (`grep -rn "filename\*" backend/src | head`; reuse a helper if one exists, else write one function and test
  it).

- [ ] **Step 2: Write the failing tests** in `test_page_note_files.py` (the attach and serve half of spec
  9.8.8's list) and in `test_page_notes.py` (every note answer now has `mentions` and `attachments`; a note
  with an empty body and no file is `422`; with an empty body and one file is `201`; the sixth file is `422`
  `too_many_attachments`; each way an id can be wrong (another uploader, another page, another project, already
  attached, removed, unknown) is `422` at `attachment_ids[i]`; a change with a shorter list marks the dropped
  file removed and frees a slot, and `edited_at` follows; a change without `attachment_ids` leaves the files; a
  change that leaves an empty body and no live file is `422`; the download cases: bytes equal, the headers of
  the table in spec 9.8.5 for a PNG, a PDF, a text file and a name holding a quote, a CRLF and non-ASCII
  characters, `404` for a pending file, a removed file, a deleted note's file, another page and another
  workspace, `200` again after restore, a viewer reads it, a note's delete and restore do not touch the file
  rows; the list of notes costs a fixed number of statements however many notes and files it has).

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `schemas/page_notes.py`: `attachments: list[PageNoteFile]` on `PageNote` (default
  empty), `PageNoteWrite.attachment_ids: list[UUID] | None = Field(default=None, max_length=FILES_MAX)`; the
  body validator now allows an empty string (the rest of its rules stay) and the service refuses an empty
  body with no live file (`422` at `body`, the message "A note has text or at least one file."). `page_notes.py`:
  `create` and `update` call one function in `page_note_files.py`,
  `attach(db, access, project_id, url_id, note_id, ids, *, replace: bool)`, that locks the rows, checks each
  id as spec 9.8.5 lists, sets `note_id` (and, for `replace`, `removed_at` on the files not in the list),
  enforces 5 live files, and returns the change for the audit snapshot; `_note_view` fills `attachments` for
  every note of a page in one statement (`note_id = ANY(...) AND removed_at IS NULL`, oldest first) and builds
  `url` with `file_path`. The `edited_at` rule: the body, the kept mentions or the set of live files changed.
  The download: `GET …/note-attachments/{attachment_id}` in the files router, `data:read`, one statement that
  joins the file to its note (`deleted_at IS NULL`), checks the page, project and workspace and
  `removed_at IS NULL AND note_id IS NOT NULL`, then `get_note_file` and a `Response` with the headers of the
  table in spec 9.8.5; an object that is missing or damaged is `404` with a log line that names the file id
  and nothing else. The audit snapshots hold `attachment_ids` with names and sizes. The docs: spec 9.8.6's list.

- [ ] **Step 5: Run the tests, regenerate the OpenAPI document, then**
  `uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_notes.py tests/api/internal_links/test_page_note_mentions.py tests/api/internal_links/test_page_note_files.py tests/storage tests/api/test_openapi.py tests/api/test_route_access.py tests/api/test_body_limit.py tests/db/test_page_note_attachments_schema.py`
  and the Backend commands on every file this task changed.

- [ ] **Step 6: Commit.** `git commit -m "Pages API: files on a note, attached by id, answered and served with safe headers"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list, with hostile files
  tried by hand through the route: an SVG named `.png`, an HTML page named `.txt` and `.png`, a PNG with a
  script after its data, a PDF with a script, a file named `x.html` with text inside, a name holding quotes,
  newlines and `../`; each is refused or served with `nosniff`, the sandboxing policy and the right
  disposition (images inline, everything else attachment); the download checks the permission, the workspace,
  the project, the page, the note's `deleted_at` and the file's `removed_at` in one statement; a pending file
  is never served; the content type served is the stored one; `attachment_ids` can only name the caller's own
  pending files of this page; the fifth-and-sixth file rule holds under a concurrent change (the note row is
  locked); soft delete and restore need no change to the file rows; `can_edit` still governs who may change
  files; the list's statement count does not grow with the notes; no endpoint returns a storage key.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 6b (Haiku): Regenerate the web client again, alone in its commit

Run it right after Task 5i. Task 6 is done and stays as it is.

- [ ] **Step 1:**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm gen:api
pnpm typecheck
git add src/lib/api/schema.ts
git commit -m "Regenerate the API client for note mentions and files"
```

  Expected: `schema.ts` gains the paths `…/internal-links/pages/{url_id}/note-attachments` and
  `…/note-attachments/{attachment_id}`, the schemas `PageNoteMention`, `PageNoteMentionIn`, `PageNoteFile`
  and, on `PageNote` and `PageNoteWrite`, `mentions`, `attachments` and `attachment_ids` (all optional because
  they have defaults). `pnpm typecheck` passes. If a mock fails to typecheck, stop and tell the lead: the fix
  is in the mock, in a commit of its own, not an edit of `schema.ts`. If it fails otherwise, stop and report.

- [ ] **Step 2: Independent senior review (Sonnet subagent).** The commit holds `schema.ts` only, and its diff
  is only additions that Tasks 5f to 5i explain.

- [ ] **Step 3: Fix what the review found** (regenerate again, never hand-edit), commit.

### Task 25f: The box's pure modules: triggers, suggestions, mentions, chips' text and file checks

Spec 9.8.2 (the at sign, slash commands, what a note keeps), 9.8.3 (splitting a body), 9.8.4 (the checks).
Contract C7c. Pure TypeScript, no component, no request, no visible change.

**Files:**
- Create: `apps/web/src/lib/pages/note-mentions.ts`, `note-mentions.test.ts`, `note-files.ts`, `note-files.test.ts`

- [ ] **Step 1: Read first.** Spec 9.8.2 to 9.8.4. `apps/web/design-preview/il-notes.js` (read only: `triggerAt`,
  `choicesFor`, `renderText`, `addFiles`; the behaviour to match, not the code to copy), `lib/pages/notes.ts`
  and `note-drafts.ts` (Task 25d), `lib/format/date.ts` (the date formatter `/date` will use is passed in),
  `lib/format/number.ts` `formatBytes`.

- [ ] **Step 2: Write the failing tests.** The pure lists of spec 9.8.8 for `note-mentions.test.ts` and
  `note-files.test.ts`; in addition: `suggestionsFor` returns teammates, then pages, then issues, then
  keywords, at most 8 in all, each narrowed by a case-insensitive "contains" on the name, the path and title,
  the issue name or the keyword, and nothing for an empty source; the `/page`, `/issue` and `/keyword` kinds
  return one kind each; `commandsFor('pa')` is `/page`; `/date` carries no mention; `applySuggestion` replaces
  from the trigger's start to the caret, adds one space, and returns the new caret; with the caret in the
  middle of the text the tail is kept; `keptMentions` drops an entry whose label is gone and keeps the order;
  `splitNoteText` never produces a part that is not a plain string or a mention object (a body with `<b>` and
  `&` comes back character for character when its parts are joined); a label made of regular-expression
  characters (`@"c++ (best)"`) is matched literally.

- [ ] **Step 3: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/lib/pages/note-mentions.test.ts src/lib/pages/note-files.test.ts`

- [ ] **Step 4: Implement** the exports of C7c. No regular expression is built from a label (use `indexOf`).
  `checkNewFiles(have, incoming)` accepts a file when `file.type` is one of the seven types, or when the type
  is empty or `application/octet-stream` or `application/vnd.ms-excel` and the extension is `.csv`, `.txt`,
  `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` or `.pdf`; it is a courtesy check, a comment says the server decides.
  It stops accepting at 5 (counting `have`), and returns the refusals in the order the files came.

- [ ] **Step 5: Run the tests of step 3, then the web commands on the four files** (`pnpm exec eslint
  --max-warnings 0`, `pnpm typecheck`, `pnpm exec prettier --check`).

- [ ] **Step 6: Commit.** `git commit -m "Pages: the note box's trigger, suggestion, mention and file-check logic"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: the modules are pure
  (no React, no `fetch`, no `Date.now()` hidden: the clock and the date formatter come in as arguments); the
  trigger rules match spec 9.8.2 at the edges (an e-mail address, `and/or`, a path mid-sentence, the caret
  in the middle of a word, a newline before the trigger); `splitNoteText` cannot inject: every part is a
  string or a mention whose label is shown as text later; nothing builds a `RegExp` from user text; the
  limits are the spec's (8, 20, 5, 10 MB) and defined once.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 25g: Mentions on the web: types, sources, writes, drafts and the mocked rules

Spec 9.8.1 (the rules the mock must keep), 9.8.2 (the four sources), 9.8.6. Contracts C5, C7, C7b, C7c. No
visible change: the box does not use them yet.

**Files:**
- Modify: `apps/web/src/lib/internal-links/types.ts`, `queries.ts`
- Create: `apps/web/src/lib/pages/note-sources.ts`, `note-sources.test.tsx`
- Modify: `apps/web/src/lib/pages/notes.ts`, `notes.test.tsx`, `note-drafts.ts`, `note-drafts.test.ts`
- Modify: `apps/web/src/mocks/internal-links-notes.ts`, `internal-links-notes.test.ts`,
  `apps/web/src/mocks/handlers/internal-links.ts`, `handlers/internal-links.test.ts`

- [ ] **Step 1: Read first.** Spec 9.8.1 and 9.8.2 (the list of sources). `lib/pages/notes.ts`, `note-drafts.ts`,
  `lib/pages/issue-source.ts` (`usePageIssues`, the seam), the workspace members read the web already has
  (`features/workspace-settings/members-screen.tsx` and its query: `grep -rn "members" src/lib src/features/workspace-settings | head`;
  reuse it, do not write a second), the pages list query with `q` and `filter[view]`
  (`lib/internal-links/queries.ts`), the page detail's `extras.keywords` (`pageDetailQuery`, `types.ts`
  `PageInclude`), the mock world's users (`mocks/internal-links-world.ts`), `mocks/handlers/internal-links.ts`
  (the note handlers of Task 25d).

- [ ] **Step 2: Write the failing tests.**
  - `note-sources.test.tsx` (`renderHook`, the mocked API): `useNoteSources(scope, urlId, query, enabled)`
    returns the workspace's teammates, the live pages matching the query (the pages request carries
    `filter[view]=live`, `q` and `limit=8`, and is sent once after the pause, not on every key), the page's
    tracked keywords from its detail, and the issues from the seam (empty while it is `unavailable`); nothing
    is requested while `enabled` is false; an error in one source leaves the others.
  - `notes.test.tsx`: `add(body, { mentions, attachmentIds })` sends `mentions` and `attachment_ids` and omits
    them when empty; `change` likewise; a note read has `mentions`.
  - `note-drafts.test.ts`: the draft also holds mentions and files (`noteDraftMentions`, `setNoteDraftMentions`,
    `noteDraftFiles`, `setNoteDraftFiles`), per project and page, in memory only; `clearNoteDraft` clears all
    three; the text functions behave as before.
  - mock and handler tests: the mock enforces spec 9.8.1 (at most 20; a label not in the body is dropped; the
    first of two equal labels is kept; a page of an unknown address, a user who is not a member and a keyword
    that is not tracked are each refused with the API's `422` shape; an `issue` mention is refused with
    `mention_type_unavailable`); notes come back with `mentions` and, for a page, its `path`.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `types.ts`: `PageNoteMention = Schemas['PageNoteMention']` (no copy of the
  shape); `note-sources.ts` as the contract C7c says, built on the existing reads; `notes.ts` and
  `note-drafts.ts` extended as the tests say and nothing else; the mock store and its handlers enforce the
  rules above with the same codes as the backend.

- [ ] **Step 5: Run the tests, then the web commands on the files of this task and**
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector src/lib/pages`.

- [ ] **Step 6: Commit.** `git commit -m "Pages: note mentions on the web, their sources, writes and mocked rules"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: no copy of a response
  type; the teammates come from the existing members read; the page search is paused and cancelled with the
  box and costs no request while the list is closed; the issues come only through the seam (`usePageIssues`)
  and are empty on this branch; the keywords come from the page detail the drawer already has (no new
  request); the mock enforces what the API enforces, so a UI test cannot pass against a rule the server lacks;
  the draft store is memory only.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 25h: The combobox in the note box

Spec 9.8.2 (the box, the keys table), 9.8.7, 11. Contracts C7c. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/note-suggest-list.tsx`, `note-suggest-list.test.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/note-editor.tsx`, `drawer-notes-tab.tsx`,
  `note-item.tsx` (the edit box passes the note's mentions), `drawer-notes-tab.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** Spec 9.8.2 and 9.8.7 whole. `note-editor.tsx` and `drawer-notes-tab.tsx`
  (Task 25e: the native `keydown` listener and why it is native), `lib/pages/note-mentions.ts` (25f),
  `note-sources.ts` (25g), `components/ui/` for a listbox or popover you can reuse
  (`ls src/components/ui | grep -i "list\|popover\|combo"`; if there is none, the list is a small component of
  this task, positioned under the box, with the project's popover tokens and z-index), `lib/a11y/announcer.ts`,
  `lib/format` (the date formatter for `/date`).

- [ ] **Step 2: Words** (namespace `pages.drawer.notes`). Change `placeholder` to "What changed on this page,
  what is planned, what to check later. Type @ to mention, / for commands." and add:

| Key | Text |
|---|---|
| `suggestions.label` | Suggestions |
| `suggestions.count` | {count, plural, one {# suggestion} other {# suggestions}}, use the arrow keys |
| `suggestions.teammate` | Teammate |
| `suggestions.page` | Page |
| `suggestions.issue` | Issue on this page |
| `suggestions.keyword` | Tracked keyword |
| `commands.page` | Link a page of the site |
| `commands.issue` | Link an issue found on this page |
| `commands.keyword` | Mention a tracked keyword of this page |
| `commands.date` | Put in today's date |

- [ ] **Step 3: Write the failing tests** (the box inside the real `Inspector`, the mocked API):
  - the `textarea` has role `combobox`, `aria-autocomplete="list"`, `aria-expanded` false; typing `@` opens a
    `listbox` named "Suggestions" with options, `aria-expanded` true, `aria-controls` the list and
    `aria-activedescendant` the first option; the count is announced once;
  - typing after the `@` narrows the rows; at most 8; each option's text holds its label and its hint
    ("Teammate", "Page", "Tracked keyword"); no rows closes the list;
  - Down and Up move the active row and wrap; Enter and Tab pick it and put the label and a space into the
    text, keep the caret after it and keep the focus in the box; the entry is added once; Enter on a closed
    list adds a line;
  - a pick with the mouse (`mousedown`) works and the box keeps its caret;
  - Escape with the list open closes only the list: the text is unchanged, the drawer's `onClose` was not
    called and, in an edit box, the edit is not cancelled; a second Escape in the edit box cancels the edit,
    and in the add box closes the drawer (the draft kept);
  - Ctrl + Enter and Meta + Enter save with the list open or closed; the saved request carries the entries
    whose label is still in the text and none whose label was deleted;
  - `/` opens the four commands; `/pa` narrows to `/page`; picking `/page` puts `/page ` and opens the page
    list; `/date` inserts the date and no entry; `/xyz` closes the list; `and/or` and `a@b.com` open nothing;
  - the list closes on blur and when the caret leaves the word; typing J and K types the letters;
  - while the list is open the Add note button and the hint stay reachable; `axe` finds nothing with the list
    open.

- [ ] **Step 4: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector/note-suggest-list.test.tsx src/features/internal-links/inspector/drawer-notes-tab.test.tsx`

- [ ] **Step 5: Implement.** UI rules first (Rules for every task). `note-suggest-list.tsx`:
  `NoteSuggestList({ id, suggestions, activeIndex, onPick, label })`, a `ul` with `role="listbox"`, one `li`
  per row with `role="option"`, `aria-selected`, an icon hidden from assistive technology, the label, the hint
  and, for a page, its title; rows are picked on `mousedown` (prevent default). `note-editor.tsx`: the
  `Textarea` gets the combobox attributes; one state `{ trigger, active }` from `triggerAt` on every change
  and caret move (`selectionStart`, on `input`, `click` and `keyup` for arrows); `suggestionsFor(trigger,
  sources)` with the sources of 25g (enabled only while a trigger is open); the native keydown listener of
  Task 25e grows: while the list is open, Down, Up, Enter (no Cmd or Ctrl) and Tab are handled and prevented,
  Escape calls `preventDefault`, `stopPropagation` and closes the list; when it is closed the listener is as
  25e left it. A pick calls `applySuggestion`, sets the value and the caret, adds the entry to the box's
  mentions (`onMentionsChange`) and announces nothing more. `drawer-notes-tab.tsx` keeps the box's mentions
  in state started from `noteDraftMentions`, written back on change, cleared on save, passed to `add`
  (through `keptMentions`); an edit box starts from the note's mentions.

- [ ] **Step 6: Run the tests, then the web commands, the inspector tests and the two message tests
  (`src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`).**

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: the note box suggests mentions and slash commands"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: the combobox pattern
  is complete (role, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete`, options
  with `aria-selected`) and a screen reader hears the count; Escape never closes the drawer while the list is
  open (proven against the real `Inspector`, no shared drawer file in the diff) and the add box's Escape with
  the list closed still closes it; focus never leaves the box on a pick or a mouse pick; the trigger rules
  are those of 25f (no list for an e-mail address or `and/or`); no request is made while the list is closed;
  a label that is no longer in the text is never sent; `/date` goes through the app's date formatter; every
  visible string is in `en.json` and in the glossary's words ("mention", "teammate"); no hex colour or
  arbitrary Tailwind value; the list is not clipped by the drawer.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 25i: Chips in a saved note, and what the page and issue chips open

Spec 9.8.3, 9.8.7 (chips). Contracts C7c. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/note-text.tsx`, `note-chip.tsx`, `note-text.test.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/note-item.tsx`, `drawer-notes-tab.test.tsx`,
  `apps/web/src/features/internal-links/inspector/page-drawer-context.ts` (only if the drawer needs a way to
  open another page that it lacks), `page-inspector.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** Spec 9.8.3 whole. `note-item.tsx` (Task 25e: the body is a text child),
  `lib/pages/note-mentions.ts` `splitNoteText`, `page-drawer-context.ts` (`hrefs.issueCheck`, how the drawer
  steps to another row), `components/app/inspector/use-inspector.ts` (read only: how `?inspect=page:<id>` is
  opened and whether any page id can be opened, not only one in the table), `components/ui/text-link.tsx`,
  `icon` components.

- [ ] **Step 2: Words.**

| Key | Text |
|---|---|
| `chips.openPage` | Open {path} |
| `chips.openIssue` | Open this check on the Issues page |
| `chips.user` | Teammate {name} |
| `chips.keyword` | Tracked keyword {keyword} |

- [ ] **Step 3: Write the failing tests** (`note-text.test.tsx`, then the tab):
  - a body with two mentions renders text, chip, text, chip, text in order; a label that appears twice is two
    chips; a label that is not in the text is not drawn; text that looks like a label but has no entry is
    plain text;
  - a page chip is a `button` named "Open /pricing" (the current `path`, not the label) and pressing it opens
    that page in the drawer (`?inspect=page:<target>`, the same tab, through the shared hook) with no request
    for notes of the old page left hanging; Enter and Space work;
  - an issue chip is a link to `hrefs.issueCheck(target)` when that returns a route, and plain text with its
    icon when it returns `null` (no `a`, no disabled button);
  - user and keyword chips are `span`s, not focusable, with the icon hidden from assistive technology and the
    full words available as text;
  - a body `<img src=x onerror=alert(1)> @/pricing` adds exactly one extra element, the chip (no `img`);
  - a chip never breaks the line height of the note; long labels truncate with the full text in the accessible
    name; `axe` finds nothing.

- [ ] **Step 4: Run, expect failures.**

- [ ] **Step 5: Implement.** `note-text.tsx`: `NoteText({ body, mentions, onOpenPage, issueHref })` renders
  `splitNoteText` as a `p` with `whitespace-pre-wrap break-words`, each text part a text child, each mention a
  `NoteChip`. `note-chip.tsx`: the four kinds as the table of spec 9.8.3 says, with the project's primary-subtle
  tokens (read `DESIGN_SYSTEM.md`; no hex), the icon per kind hidden from assistive technology, focus ring on
  the buttons. `note-item.tsx` uses `NoteText` where it rendered the body, and passes `onOpenPage` (the
  shared inspector hook) and `issueHref`. Add to the drawer context only what is missing to open another
  page; if `use-inspector.ts` already offers it, add nothing there and say so in the commit message.

- [ ] **Step 6: Run the tests, then the web commands on the files of this task, the inspector tests and the
  message tests.**

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: mentions in saved notes show as chips"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: search the diff for
  `dangerouslySetInnerHTML`, `innerHTML`, a `RegExp` built from a label and any link built from note text
  (none may be there); the page chip opens the page named by `target` and its name shows the current `path`;
  the issue chip is never a dead link; chips that are not actions are not tab stops; the author-only rules
  of 25e are untouched; a stored mention for a user who left or a page that is gone still draws; no shared
  drawer file is in the diff.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

### Task 25j: Files on the web: types, upload, refusals and the mocked routes

Spec 9.8.4 (limits, refusal wording), 9.8.5 (two steps), 9.8.6. Contracts C7, C7b, C7c. No visible change.

**Files:**
- Modify: `apps/web/src/lib/internal-links/types.ts`, `queries.ts`
- Create: `apps/web/src/lib/pages/note-uploads.ts`, `note-uploads.test.tsx`
- Modify: `apps/web/src/lib/pages/notes.ts`, `notes.test.tsx`, `note-drafts.ts`, `note-drafts.test.ts`
- Modify: `apps/web/src/mocks/internal-links-notes.ts`, `internal-links-notes.test.ts`,
  `apps/web/src/mocks/handlers/internal-links.ts`, `handlers/internal-links.test.ts`

- [ ] **Step 1: Read first.** Spec 9.8.4 and 9.8.5. The API client's call for a `multipart/form-data` request
  (`src/lib/api`; how the keyword import upload is sent: `grep -rn "keyword-imports/upload" src | head`), how an
  `ApiError` carries `status` and the problem `code`, `lib/pages/note-files.ts` (25f), the notes mock and its
  handlers (25d, 25g), how a mock handler returns bytes (`HttpResponse`).

- [ ] **Step 2: Write the failing tests.**
  - `note-uploads.test.tsx`: `useNoteFileUpload(scope, urlId)` has `upload(file)` that sends one multipart
    request and resolves with the file (`id`, `name`, `size`, `content_type`, `is_image`, `url`); `pending`
    while it runs; a `413` rejects with `{ kind: 'size' }`, a `415` with `{ kind: 'type' }`, a `422
    quota_exceeded` with `{ kind: 'quota' }`, a `503` with `{ kind: 'storage' }`, anything else with `{ kind:
    'failed' }`; the request carries no `Content-Type` header of its own (the browser sets the boundary).
  - `notes.test.tsx`: a note read has `attachments`; `add` and `change` send `attachment_ids`.
  - `note-drafts.test.ts`: the draft's files (File objects) survive as in 25g.
  - mock and handler tests: upload stores the bytes in memory, answers `201` with an `id` and a `url`; the
    mock refuses a file over 10 MB (`413`), a type that is not one of the seven or whose name is `.html`,
    `.svg`, `.xml` or `.js`, or whose first bytes start with `<` after blanks (`415`), an empty file (`422`),
    and a seventh megabyte over the workspace cap set by a test hook (`422 quota_exceeded`); attaching
    follows the backend's rules (only the uploader's pending files of this page, at most 5 live, a file
    attaches once, a dropped id is removed); a note with an empty body and one file is accepted and with
    neither is `422`; the download handler returns the bytes with the stored type; `404` for a pending,
    removed or deleted-note file; a deleted note's files come back on restore.

- [ ] **Step 3: Run, expect failures.**

- [ ] **Step 4: Implement.** `types.ts`: `PageNoteFile = Schemas['PageNoteFile']`. `queries.ts`: the path
  constants for the two file routes. `note-uploads.ts`: `NoteFileRefusal` as a union and `useNoteFileUpload`;
  `notes.ts` writes take `attachmentIds`; the mock store and handlers per the tests. The mock states in one
  comment that its type check is by declared type, name and the first byte, and that the server sniffs
  properly (the unit of truth is `storage/file_sniff.py`).

- [ ] **Step 5: Run the tests, then the web commands on the files of this task and the inspector and
  `src/lib/pages` tests.**

- [ ] **Step 6: Commit.** `git commit -m "Pages: note files on the web, their upload, refusals and mocked routes"`.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** Besides the common list: no copy of a response
  type; the upload sends one file per request with no hand-set content type; every server refusal maps to a
  refusal kind the box can word; the mock enforces what the API enforces; no file bytes or names are logged;
  a draft's files are memory only.

- [ ] **Step 8: Fix what the review found**, rerun, commit.

### Task 25k: The file controls in the note box and the files under a note

Spec 9.8.4, 9.8.7, 11. Contracts C7c. UI task.

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/note-files-bar.tsx`, `note-file-list.tsx`,
  `note-files-bar.test.tsx`
- Modify: `apps/web/src/features/internal-links/inspector/note-editor.tsx`, `note-item.tsx`,
  `drawer-notes-tab.tsx`, `drawer-notes-tab.test.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Read first.** Spec 9.8.4, 9.8.5 (two steps), 9.8.7. `note-editor.tsx`, `drawer-notes-tab.tsx`,
  `note-item.tsx`, `lib/pages/note-files.ts`, `note-uploads.ts`, `note-drafts.ts`,
  `components/ui/icon-button.tsx`, `lib/format/number.ts` `formatBytes`, `lib/a11y/announcer.ts`,
  `design-preview/il-notes.js` `composer` and `renderFiles` (read only: the layout and the wording).

- [ ] **Step 2: Words.**

| Key | Text |
|---|---|
| `files.attach` | Attach files |
| `files.remove` | Remove {name} |
| `files.drop` | Drop files to attach |
| `files.tooMany` | At most {max} files per note. |
| `files.wrongType` | {name}: only images (PNG, JPEG, GIF, WebP), PDF, text and CSV files. |
| `files.tooBig` | {name}: over {max}. |
| `files.quota` | Your workspace has no room left for files. |
| `files.storage` | Files cannot be stored right now. Try again later. |
| `files.failed` | {name} could not be uploaded. |
| `files.uploading` | Uploading {done} of {total} files |
| `files.open` | {name}, {size}. Opens in a new tab. |
| `files.thumb` | {name} |
| `saveNoText` | A note needs text or a file. |

  (`tooBig` takes `max` as "10 MB" from the formatter. Several refusals are joined with a space in code into
  the one line.)

- [ ] **Step 3: Write the failing tests:**
  - the paperclip is an icon button named "Attach files" that opens the file chooser (a hidden `input` with
    `multiple` and an `accept` list of the seven types, not a tab stop); choosing files adds chips above the
    row: a thumbnail for an image (an object URL, `alt` empty), a file icon for others, the name, the size and
    a "Remove {name}" button; removing one updates the list and `URL.revokeObjectURL` is called;
  - drop: dragging files over the box shows "Drop files to attach" (text) and dropping adds them; a drop of
    something that is not a file does nothing; paste of an image from the clipboard adds the file and no text;
  - refusals show in one `role="alert"` line under the box: a sixth file, a `.zip`, an 11 MB file, and three
    problems at once in one line; the line clears with the next accepted file; accepted files stay;
  - Add note is enabled with text, or with files and no text; with neither it is disabled; saving uploads the
    files one by one (the button busy and "Uploading 2 of 3 files" announced once), then adds the note with
    the ids; the box and the chips are empty after and keep the focus; a failed upload keeps the text, the
    mentions and every file in the box, shows its refusal line or an error toast, and the retry sends only
    what was not uploaded (the ids already got are kept); a server refusal (`415`, `413`, quota) is worded
    like the client's;
  - the draft keeps the files across a tab switch and a step to another page and back, and loses them after
    a save;
  - a saved note shows its images as thumbnails (a link, `target="_blank"`, `rel="noopener noreferrer"`,
    `alt` the name) and other files as rows with icon, name and size; each link's name is "{name}, {size}.
    Opens in a new tab."; a note with files and no text shows no empty paragraph;
  - edit: the edit box lists the note's files with Remove buttons and the paperclip; saving sends the exact
    list of ids that remain plus the new ones; removing every file and the text is refused with "A note needs
    text or a file."; Escape handling and focus return are as before;
  - `axe` finds nothing with files in the box, with the drop state, and with files under a note.

- [ ] **Step 4: Run, expect failures.**
  `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector/note-files-bar.test.tsx src/features/internal-links/inspector/drawer-notes-tab.test.tsx`

- [ ] **Step 5: Implement.** UI rules first. `note-files-bar.tsx`: the chips, the hidden input, the drop and
  paste handlers (on the box's wrapper and the `textarea`), the refusal line; the state is `File[]` kept in
  the draft store and the refusal text in a `useState`. `note-file-list.tsx`: thumbnails and rows for a
  saved note (`attachments`), links to `file.url`. `note-editor.tsx`: the paperclip in its row and the bar
  under the text; the Add note button's disabled rule is `text.trim() === '' && files.length === 0`.
  `drawer-notes-tab.tsx`: the save path uploads, then writes; it holds `uploaded: Map<File, id>` for the
  retry; announces progress through `announce`; counts of files and the 10 MB cap come from `note-files.ts`.
  `note-item.tsx`: renders `NoteFileList` after the text; the edit state carries the note's files.

- [ ] **Step 6: Run the tests, then the web commands, the inspector tests and the message tests.**

- [ ] **Step 7: Commit.** `git commit -m "Page drawer: attach files to a note, with refusals, thumbnails and file rows"`.

- [ ] **Step 8: Independent senior review (Sonnet subagent).** Besides the common list: file names are text
  nodes and attributes only (never HTML); links carry `rel="noopener noreferrer"`; object URLs are revoked;
  the client's checks are a courtesy and every server refusal is shown the same way; the order is upload,
  then note, and a failure leaves nothing lost; a note with files and no text works end to end; the drop
  target does not swallow drops of text; the refusal line is announced; focus after add, after a failed save
  and after removing a chip; no layout shift of the Add note button when five chips are present (check at
  the drawer's least width); no shared drawer file is in the diff; no `any`, no `as` on a `File` or on an
  API type.

- [ ] **Step 9: Fix what the review found**, rerun, commit.

---

## Part G. Words and the final checks

### Task 26 (Haiku): Audit the words

Spec 11. The UI tasks added their own keys; this task only checks them.

**Files:** `apps/web/messages/en.json`, `docs/glossary/final-list.md` (read; change only on a finding)

- [ ] **Step 1: Run the checks.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm exec vitest run --maxWorkers=1 src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts
grep -nP "[\x{2012}-\x{2015}]" messages/en.json
node -e "const m=require('./messages/en.json');const w=(o,p=[])=>Object.entries(o).flatMap(([k,v])=>typeof v==='string'?[[p.concat(k).join('.'),v]]:w(v,p.concat(k)));for(const [k,v] of w(m.pages)) if(/Monitored|GSC|Rankings?\b|No data|N\/A|\bSource\b|window|!/.test(v)) console.log(k,'|',v)"
```

  Expected: the tests pass, the grep prints nothing, the script prints nothing.

- [ ] **Step 2: Find keys nothing uses.** For every key under `pages` and every key this plan added under
  `internalLinks.columns`, run `grep -rn "<last two segments of the key>" src` and list the keys with no user.
  Remove a key only when no code builds it from a template (`t(\`view.${id}\`)` uses every `pages.view.*`).

- [ ] **Step 3: Read `docs/glossary/terms.md` rows A5, A12 and A15 and `final-list.md`.** They were written
  in commit afc686bf. Confirm the visible strings use "Pages", "All pages", "Overview", "Tracked",
  "Parameter variant", "Orphan page", "Untiered", "Linking pages", "Outlinks", "Best rank", "Outline", "Notes",
  "Add note" as those files write them, that no string under `pages.drawer.notes` says "comment", "post",
  "annotation", "tag" (say "mention") or "attachment" (say "file"), that the box's strings use "teammate",
  "tracked keyword" and "issue" as spec 11 says, that every refusal line says what is allowed, and that the Outline's strings say "the latest crawl", "alt text", "Open Graph" and
  "X card" the same way everywhere. Report a mismatch; fix the string, not the glossary.

- [ ] **Step 4: Commit** only if something changed:
  `git commit -m "Pages: message audit"`.

- [ ] **Step 5: Independent senior review (Sonnet subagent).** Reads every string under `pages` in
  `messages/en.json` once, as a person would: plain sentences, the glossary's words, no dash, no
  exclamation mark, plural forms right, a state says what is true.

- [ ] **Step 6: Fix what the review found** (Haiku), rerun step 1, commit.

### Task 27: Final integration checks

Spec 12 ("On the running app"), 16 (the whole checklist). Run by the lead or a Sonnet subagent, alone, with
nothing else running.

- [ ] **Step 1: Backend, targeted.**

```bash
colima status
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/backend
uv run ruff check src/idraft/api/internal_links src/idraft/api/schemas src/idraft/crawl/outline.py src/idraft/crawl/lang_codes.py src/idraft/storage/raw.py src/idraft/api/main.py tests/api/internal_links tests/crawl/test_outline.py
uv run ruff format --check src/idraft/api/internal_links src/idraft/api/schemas src/idraft/crawl/outline.py src/idraft/crawl/lang_codes.py src/idraft/storage/raw.py src/idraft/api/main.py tests/api/internal_links tests/crawl/test_outline.py
uv run mypy src/idraft/api/internal_links src/idraft/api/schemas src/idraft/crawl/outline.py src/idraft/crawl/lang_codes.py src/idraft/storage/raw.py src/idraft/api/main.py tests/api/internal_links tests/crawl/test_outline.py
uv run lint-imports
uv run pytest -n 0 --no-cov tests/crawl/test_outline.py
uv run ruff check src/idraft/db/tables.py src/idraft/db/migrations/versions/0042_page_notes.py src/idraft/api/audit.py src/idraft/api/resources.py tests/db/test_page_notes_schema.py
uv run mypy src/idraft/db src/idraft/api/audit.py src/idraft/api/resources.py
uv run pytest -n 0 --no-cov tests/db/test_page_notes_schema.py tests/db/test_tables.py tests/db/test_grants.py tests/db/test_rls.py tests/db/test_migrations.py
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_notes.py tests/api/test_audit.py
uv run ruff check src/idraft/storage/file_sniff.py src/idraft/storage/note_files.py src/idraft/api/body_limit.py src/idraft/db/migrations/versions/0043_page_note_mentions.py src/idraft/db/migrations/versions/0044_page_note_attachments.py tests/storage tests/db/test_page_note_attachments_schema.py
uv run mypy src/idraft/storage src/idraft/api/body_limit.py tests/storage
uv run pytest -n 0 --no-cov tests/storage/test_file_sniff.py tests/storage/test_note_files.py tests/db/test_page_note_attachments_schema.py tests/api/test_body_limit.py
uv run pytest -n 0 --no-cov tests/api/internal_links/test_page_note_mentions.py tests/api/internal_links/test_page_note_files.py
uv run pytest -n 0 --no-cov tests/api/internal_links/test_inventory.py tests/api/internal_links/test_page_search.py tests/api/internal_links/test_page_outline.py tests/api/internal_links/test_page_sort_extra.py tests/api/internal_links/test_reads_pages.py tests/api/internal_links/test_variants.py tests/api/test_openapi.py tests/api/test_route_access.py
uv run python -m idraft.api.openapi | diff - openapi/v1.json
```

  Expected: all pass, and the `diff` prints nothing.

- [ ] **Step 2: Web, targeted.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7/apps/web
pnpm gen:api && git diff --exit-code src/lib/api/schema.ts   # one regeneration covers Tasks 6 and 6b
pnpm typecheck
pnpm exec eslint --max-warnings 0 src/lib/pages src/lib/internal-links src/lib/routes src/lib/navigation src/features/internal-links src/components/app/data-table src/mocks/handlers/internal-links.ts src/mocks/internal-links-inventory.ts src/mocks/internal-links-outline.ts src/mocks/internal-links-notes.ts src/test/pages-harness.tsx "src/app/[workspace]/[project]/seo"
pnpm exec prettier --check src/lib/pages src/features/internal-links src/components/app/data-table messages/en.json
pnpm exec vitest run --maxWorkers=1 src/lib/pages
pnpm exec vitest run --maxWorkers=1 src/lib/internal-links/queries.test.ts src/lib/routes src/lib/navigation
pnpm exec vitest run --maxWorkers=1 src/mocks/internal-links-inventory.test.ts src/mocks/internal-links-outline.test.ts src/mocks/internal-links-notes.test.ts src/mocks/handlers/internal-links.test.ts
pnpm exec vitest run --maxWorkers=1 src/components/app/data-table
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages-page
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/pages
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/inspector
pnpm exec vitest run --maxWorkers=1 src/lib/pages/note-mentions.test.ts src/lib/pages/note-files.test.ts src/lib/pages/note-sources.test.tsx src/lib/pages/note-uploads.test.tsx
pnpm exec vitest run --maxWorkers=1 src/features/internal-links/tabs.test.ts src/features/internal-links/url-state.test.ts src/features/internal-links/internal-links-screen.test.tsx src/features/internal-links/states.test.tsx
pnpm exec vitest run --maxWorkers=1 "src/app/[workspace]/[project]/seo" src/features/shell/project-shell.test.tsx src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts
```

  One command at a time. Expected: every one passes and `git diff --exit-code` prints nothing.

- [ ] **Step 3: The build, once** (the routes changed):

```bash
pnpm build
```

  Expected: it succeeds and lists `/[workspace]/[project]/seo/pages` and `/[workspace]/[project]/seo/pages/all`.
  Afterwards delete what it made: `rm -rf .next` from `apps/web` (it can be rebuilt).

- [ ] **Step 4: No shared drawer file changed, and no dash anywhere.**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/pages-overview-all-drawer-f3d1f7
git diff --stat a8167b06..HEAD -- apps/web/src/components/app/inspector apps/web/src/lib/inspector apps/web/design-preview
git diff a8167b06..HEAD | grep -nP '^\+.*[\x{2012}-\x{2015}]'
```

  Expected: both print nothing.

- [ ] **Step 5 (optional, heavy; the lead decides): look at the running app at 1280 by 720.** Only with
  nothing else heavy running. Follow the Dev Server Policy:
  1. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'` and check whether a listener's working directory is
     this worktree's `apps/web`. If one is, reuse it.
  2. If none is, start one in the background on a free port, never killing anything:
     `NEXT_PUBLIC_API_MOCKING=all pnpm dev -- --port 3111` (take the next free port if 3111 is taken) and read
     the URL from its output.
  3. In the built-in browser at 1280 by 720, signed in to the mocked app, on the Eventus project:
     - All pages, no filter and no banner: measure the top of the first row
       (`document.querySelector('[role="grid"] [role="row"]:not(:has([role="columnheader"]))').getBoundingClientRect().top`).
       It must be at or above 224 (spec section 8). The page does not scroll; the table scrolls inside its panel under a
       pinned header. Repeat at 1920 by 1080.
     - Open a row: the drawer lies over the table and the table keeps its width.
     - The drawer's Outline tab on a live page: four numbers, six blocks, Search listing and Headings open;
       fold and unfold one with the keyboard; "Show all N headings" on the page with 14; a redirect row
       shows its one sentence; no "See in Issues" link is drawn.
     - The drawer's Notes tab: add a note with Ctrl + Enter, switch tabs with a draft typed and come back,
       edit a note and press Escape (the drawer stays open), delete it and press Undo; the tab's count
       follows; at the drawer's least width every tab is reachable (the last ones through More).
     - The note box at 1280 by 720 (spec 9.8, the owner's check): type `@` and see the list open under the
       box with at most 8 rows, not clipped by the drawer's edge and with Add note still visible; pick a
       teammate with Enter and a page with the mouse; press Escape (the list closes, the drawer stays open);
       type `/date`; attach five files (the sixth shows its refusal line) and check that the five chips, the
       refusal line, the row and the list of notes under it fit the drawer without the button leaving the
       screen; save, and see the chips and the thumbnails; open a page chip (the drawer goes to that page)
       and a thumbnail (a new tab). Repeat the box at the drawer's least width and at 1920 by 1080.
     - Overview: every strip number and every card row opens All pages, and the list's total equals the
       number on the mark. Check at least one row of each card.
     - `/seo/internal-links?tab=pages&view=orphans&tier=none` lands on
       `/seo/pages/all?view=orphans&tier=none`; a bare `/seo/internal-links` opens Journey;
       `/seo/pages/performance` is the 404 page.
  4. Stop the server you started (only that one), and `rm -rf .next`.
  If the first row is below 224, report the measured parts (toolbar row, table toolbar, header rows) to the
  lead; do not hide a control to pass.

- [ ] **Step 6: Walk the acceptance checklist of spec section 16** line by line and write, for each line,
  the test or the observation that proves it. Lines that wait for another session ("after the Issues merge",
  "when tracking exists") are marked as waiting, with the seam that holds them.

- [ ] **Step 7: Independent senior review (Sonnet subagent).** It is given the whole range
  `git log --oneline a8167b06..HEAD` and `git diff --stat a8167b06..HEAD`, spec sections 13, 14 and 16, and
  the checklist of step 6. It checks: nothing of spec 13 ("Not in this build") was built (for the Outline: no
  new table, column or cache, and no HTML reader other than `crawl/outline.py`; for Notes: no Notes column
  in All pages, no change to the chart notes routes, and the tables are `core.page_notes` and
  `core.page_note_attachments` only; of spec 9.8.9: no notification, no virus scan, no server-side thumbnail,
  no deletion from storage, no new bucket and no server file); the only changes
  to shared files are the Pages entries of spec 14; every acceptance line has its proof; the commits are in
  the order backend, client, web; no attribution line in any commit message
  (`git log a8167b06..HEAD --format=%B | grep -i "co-authored\|generated with"` prints nothing).

- [ ] **Step 8: Fix what the review found**, rerun the commands of the steps the fix touches, commit. Then
  report to the lead: what passed, what was not run (the full suites, e2e), and that the visual snapshots of
  the old Pages tab need regenerating in the main checkout. Do not merge and do not push.

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| 3 decisions D1 to D28 | D17 to D19 5f, 25g; D20 25f, 25h; D21 5h, 5i, 25j, 25k; D22 5g, 5h; D23 5g; D24 5i; D25 5h; D26 5h, 5i; D27 (nothing built: the key shape in 5g, the statement in 5i); D28 (nothing built); D13 5c; D14 5b; D15 5d; D16 5e; D1 14; D2 16; D3 13, 23; D4 11, 23; D5 23 to 25 (no shared drawer file); D6 18 (pager untouched); D7 3; D8 1, 3, 8, 10; D9 19; D10 20, 22; D11, D12 21 |
| 4 words | 1 |
| 5 routes, tabs, redirects, sidebar | 9, 13, 14, 16 |
| 6 Overview | 3, 8, 10, 13, 21, 22 |
| 7 All pages | 1, 2, 4, 7, 11, 17 to 20 |
| 8 layout and the budget | 13, 18, 19, 27 |
| 9 drawer | 5, 9, 11, 23 to 25 |
| 9.6 the Outline tab | 5b (parser), 5c (read), 6 (client), 7 (types, query), 8 (mock), 9 (hook), 23 (tab), 25b, 25c (the tab's body) |
| 9.7 the Notes tab | 5d (table), 5e (API, audit, count), 6 (client), 11 (`canNote`), 23 (tab, glossary), 25d (reads, writes, drafts, mock), 25e (the tab's body) |
| 9.8 the Notes box: mentions, slash commands, attachments | mentions 5f (column, checks), 25f (pure), 25g (sources, writes, mock), 25h (combobox, slash), 25i (chips); files 5g (type judge, storage), 5h (table, quota, upload), 5i (attach, serve), 25j (upload, mock), 25k (controls, thumbnails); client 6b; D17 to D28 across them; words 25h to 25k, 26; checks 27 |
| 10 seams | 9, 20, 22, 24, 25, 25b, 25c ("See in Issues" through `hrefs.issueCheck`) |
| 11 words | every UI task, 26 |
| 12 tests | every task, 27 |
| 14 merge points | Rules, 5f, 5h, 14, 27 |
| 15 blocks | 5 (before dispatching), 5b (before dispatching), 5c (`no_html`), 5f (the issue seam), 5h (migration numbers), 9, 20 |
| 16 acceptance | 27 |
