# Page drawer, AI tab: prompts, trend and pages cited alongside: design

Status: written 2026-11-28. The owner's settled decisions are in section 1. Technical decisions taken here are
numbered D1 to D22 in section 3, each with its reason. What narrows the build is in section 13.

Base: `origin/develop` at `da677bd7`, branch `claude/page-ai-tab`, worktree
`/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/page-ai-tab`. Spec of the drawer it extends:
`docs/superpowers/specs/2026-11-26-pages-overview-all-drawer-design.md` (section 9, tab AI). Data design of the
answers it reads: `docs/16` (counted answers, citation units) and `docs/glossary/terms.md`.

## 1. What the owner decided

The AI tab of the page drawer shows counts only today (ChatGPT, Gemini, AI Mode, "Cited in N answers", last 28
days). It gets three more cards, read from tables the app already holds, with no new provider spend:

1. **Prompts that cited this page.** One row per prompt: the prompt text, the platforms that cited the page, how
   many answers cited it. A row opens the prompt inspector (the shared overlay `Inspector`).
2. **Citations over time.** How often the page was cited, day by day, with the change against the compared
   period, drawn in the app's chart frame (`ChartFrame`, with its Chart and Table switch, as the Search tab does,
   `docs/design-system/15-data-visualization.md`).
3. **Cited with this page.** The other addresses cited in the same answers, with how many answers each shared with
   this page. A page of the project's own site opens its page drawer. An address on another domain shows the
   address and its domain.

Decisions the owner delegated, taken in this spec: the count strip above the cards stays as it is, and the new
cards print their dates and their basis so the two numbers can differ without confusing anyone (D6); after a row
opens, the page drawer is replaced by the prompt inspector, with a back path only if the shared `Inspector`
offers one without a change (D13, and it does not: section 13); the strip label "AI Mode" breaks glossary P4 and
is fixed in this build (D20).

## 2. What is true in the code today

Read from the worktree on 2026-11-28. Items marked (changed) differ from the first draft of this spec.

**The AI tab.** `apps/web/src/features/internal-links/inspector/page-inspector.tsx` builds the `ai` panel from the
page read: a loading section while `detail` is null; one sentence (`pages.drawer.ai.none`) when
`extras.citations.total === 0`; else `ExtrasSections parts=['citations']`. `CitationsBody` in `extras-sections.tsx`
draws three cells (ChatGPT, Gemini, `t('aiMode')`), "Cited in N answers" and the line "last 28 days (today's
numbers)". The drawer has eight tabs (Overview, Search, Outline, Issues, AI, Links, History, Notes) (changed:
History is there now).

**What the strip counts.** `citations_of` and the statement `_CITATIONS` in
`backend/src/idraft/api/internal_links/extras.py` (it runs per list row with `include=citations`): distinct
`observation_id` per platform from `ai.citations` joined to `ai.observations`, `domain_role = 'own'`,
`url_id = ANY(ids)`, `observed_at >= now() - interval '28 days'` (a rolling 28 x 24 hours, not project days),
`superseded_by IS NULL`. It does not look at `ai.observation_facts` (validity, currency), does not join prompts
(so paused and archived prompts count), does not drop flagged citations, and includes Google AI Overview in
`total`. `url_id` is the `core.urls` id, which is the id the crawl uses: no address normalisation join.

**Why the existing cited-page read does not fit.** `GET .../ai/cited-pages/{url_id}`
(`CitationBoardService.page_detail`, `api/ai/citation_board.py`) counts in run slots (`runs` is 1, 2 or 4, each
prompt and platform's last runs), drops runs past `TREND_SLOTS = 8`, groups "alongside" by registrable domain,
loads the units of every answer over 183 days, and answers 404 for a page nothing cites. The drawer needs days,
addresses and an answer for a page that is not cited. The web `PromptsCard` of that drawer is private to
`features/citations/drawers/page-drawer.tsx`, as are `DrawerCard` and `DrawerTable` (`drawer-parts.tsx`), and the
import rules (`eslint.config.mjs`, rule 3) forbid a feature from importing another feature (changed: the AI tab
cannot reuse them; it builds on the shared `InspectorSection`).

**Shared reads that do fit.** `source_repository.scope_prompts`, `SourceScope`, `EXCLUDED_FLAGS`,
`citation_bounds`, `counted_answers`; `citation_board_repository.lookback_answers`, `units_of`, `prompt_texts`;
`sources.shown_engines`, `sources.local_instants`; `ranks.repository.project_zone`;
`summary.summary_dates`, `summary.previous_dates`; `citation_board_model.Answer` and `Unit`;
`domain.ai_engines.ENGINES` (labels) and `PROMPT_ENGINES` (the platforms a prompt is asked on: ChatGPT, Gemini,
Google AI Mode, without Google AI Overview). `lookback_answers` already returns each counted answer with its
`prompt_id`, `engine_code` and `observed_at`.

**Table and index.** `ai.citations` is partitioned by `observed_at` and has `url_id bigint`, `domain_role`,
`engine_code`, `flags text[]`. Migration 0018 created `citations_url_observed ON ai.citations (url_id,
observed_at)`. The newest migration is 0048, so the next free number is 0049.

**The prompt inspector.** `useInspector().open({ type: 'prompt', id }, { tab: DEFAULT_INSPECTOR_TAB })` opens it
(`openPrompt` in `features/citations/board-screen.tsx`). `PromptDrawerHost` (`features/prompts`) shows it for
`inspect=prompt:<id>`, reads the platforms and the prompt's summary row itself, and takes the order for J and K
from `PromptOrderContext` (`lib/inspector/prompt-order.ts`). Only the Citations screen mounts them today.
`PromptDrawerHost` reads the date range of the address (`from`, `to`) and asks the prompt summary with
`include_branded=false` (changed: a branded prompt has no summary row there, section 13).

**The hosts of the page drawer.** Three screens mount `PageInspector`: `features/internal-links/pages-page/
pages-screen.tsx`, `internal-links-screen.tsx` and `issues/issues-screen.tsx` (changed: Issues is merged). Their
route pages are `seo/pages/page.tsx`, `seo/pages/all/page.tsx`, `seo/internal-links/page.tsx` and
`seo/issues/page.tsx`. The Citations route composes `PromptDrawerHost` and passes it as a `promptDrawer` element
because a feature may not import another (`citations-route.tsx`).

**The shared Inspector's back control.** `Inspector` takes `backLabel` and `onClose`. The header draws "back"
only in sheet mode (below 900 px) and it calls `onClose`; wide, there is a close button that calls `onClose`.
`useInspector().close()` goes back in history when the drawer pushed its entry, else replaces. `open` replaces
the entry while a drawer is open. So there is no "return to the previous drawer" target in the API (changed:
decision 2 of the brief resolves to the known limit of section 13).

**Chart and cells.** `ChartFrame` takes `kind 'line' | 'bar'`, `variant 'inspector'`, `categories`, `series`,
`formatValue`, `cellText`, `summary`, `height`, and has the Chart and Table switch built in. The Search tab uses
`variant="inspector"`, `height={180}` inside `rounded-lg border border-border bg-surface px-4 pt-3 pb-4`.
`EngineLogo` (`nameDisplay="visually-hidden"` for a column of marks), `byEngineOrder` (`ENGINE_ORDER`),
`DomainChip` (a chip capped at `max-w-48`) and `displayUrl` exist.

**Words.** `messages/en.json` holds `internalLinks.inspectorExtras.aiMode: "AI Mode"` and two more strings with
"AI Mode" alone (`citationsTip`, `citationsBreakdown`). Glossary P4 bans "AI Mode (alone)"; the banned list
`docs/glossary/banned-words.json` has no entry for it yet. "Window", "Source", "own pages", "engine",
"Inactive" and "No data" are banned in visible text.

## 3. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | One new route `GET .../internal-links/pages/{url_id}/ai` answers the three cards in one body. The extras read stays cheap and unchanged. | The three cards share one set of answers and one set of citing units; one transaction gives one snapshot, so the cards agree. The extras read runs per list row; it must not grow. Same family as `/search`, `/outline` and `/history`. |
| D2 | `GET .../ai/cited-pages/{url_id}` is not called and none of its SQL is copied. Its shared functions are called. | It counts in run slots, drops runs past 8, groups by domain and answers 404 for an uncited page (section 2). |
| D3 | One new shared function, `citing_observations(db, scope, url_id)` in `citation_board_repository.py`, returns the ids of the answers that cite one address. | Everything else (counted answers, units, texts) exists. Starting from the address keeps the unit read to the answers that matter (a few dozen), not every answer of the period. |
| D4 | Params: `run` (crawl, as every page route), `from`, `to` (project-local days, default the last 28 days to today, at most 92), `compare` (`none` or `previous_period`, default `none`). The drawer sends no dates and `compare=previous_period`. | Same names and rules as the AI reads (`summary_dates`, `previous_dates`), so a later date picker needs no new route. The drawer has no picker in this build. |
| D5 | Days are the project's local days (`project_zone`), converted to instants by `sources.local_instants`. A point of the trend is one local day. | Matches the AI pages and the Search tab. UTC days would split a project's evening. |
| D6 | The strip is left alone (rolling 28 x 24 hours, Google AI Overview included, paused and archived prompts included). The new cards print their dates and basis (section 9.3). The cards count: answers that are counted (current, valid, not superseded) of the project's prompts that are not paused or archived (branded included), on ChatGPT, Gemini and Google AI Mode, citations without the flags `engine_internal` and `unresolved_redirect`. | Changing the strip would move a number other screens show. A printed basis explains the difference. The counted-answer rules are those of every other AI number (`counted_answers`), so the cards agree with Citations. |
| D7 | The counted unit is one distinct address per answer. "Cited in N answers" means N distinct answers. A page cited twice in one answer counts once. | Glossary E2 and docs/16 C2. |
| D8 | One REPEATABLE READ transaction with `SET LOCAL enable_nestloop = off`, as `CitationBoardService._transaction`. | Same snapshot rule; without statistics on a new partition the planner can pick a nested loop. |
| D9 | The trend is daily bars: one point per local day, each with `answers` (counted answers that day) and `answers_citing`. The compared period is not a second series; it comes as totals, and the web draws the change. | A second series would need aligned days and doubles the chart's ink in a 440 px card. The totals carry the comparison the owner asked for (the change). |
| D10 | `ChartFrame kind="bar"`, one series, `variant="inspector"`, `height={180}`, `cellText` "3 of 12 answers". | Bars read as counts per day; the table gives the exact numbers. |
| D11 | Prompts: the top 25 by `answers_citing`, then `last_cited_at` newest, then `prompt_id`. The body carries `prompts_total`. | The product limit is 150 prompts; 25 rows keep the card short and a line says how many more. No paging in a drawer. |
| D12 | A row shows the platform marks of the platforms that cited the page (in engine order, `EngineLogo` mark with its name hidden visually, tooltip "ChatGPT: 2 of 3 answers"). The platform name comes from the API (`ENGINES[code].label`). | The mark column stays narrow at 480 px and the names stay in the accessible name. The label is the API's, so a renamed platform changes in one place. |
| D13 | A row opens `?inspect=prompt:<id>`, starting on the prompt's first tab. The three hosts mount `PromptDrawerHost` and `PromptOrderContext` (the screens receive the host as a `promptDrawer` element, composed by the route). The prompt replaces the page drawer. | `inspect` is one key. `useInspector` replaces the entry. The shared `Inspector` has no "return to" target and its API is not changed here (section 13). |
| D14 | "Cited with this page": distinct addresses (`url_id`) of the citing answers, the page itself left out, with `answers_shared`, ordered by `answers_shared` desc, address asc, `url_id`; top 10 plus `alongside_total`. | Addresses, not domains: the owner asked for pages. |
| D15 | An address is "of your site" when its stored `domain_role` is `own`. It opens the page drawer only when it is also in the crawl in view (`in_crawl`, a row in `seo.crawl_pages` for the run). Others show the address and a `DomainChip`; a competitor also carries the badge "Competitor". | `domain_role` is set when the answer is ingested from the project's own domains; the crawl membership is what the drawer needs to open (a page outside the crawl would answer "not in this crawl"). |
| D16 | Scoping: `read_scope` (project belongs to the workspace, crawl chosen), the page must have a row in the crawl (else 404), workspace and project in every statement, permission `data:read`. | Same as `/search` and `/outline`. |
| D17 | `state` is `ready`, `no_prompts` (no prompt in scope) or `no_answers` (prompts but no counted answer in the period). A page nothing cites is `ready` with zeros. | The empty states differ in what the user can do: add prompts, or wait for the first run. Not cited is a result, not an error, so it is not a 404. |
| D18 | No migration is expected. Task 4 of the plan proves with `EXPLAIN` (sequential scans switched off in the test session) that the statement can use `citations_url_observed`. Only if it cannot, migration 0049 adds the index and the lead is told. | The index exists since 0018 and the statement is `WHERE url_id = $1 AND observed_at >= $2 AND observed_at < $3` plus the project and workspace. |
| D19 | The change against the compared period is computed on the web from the two totals (`changeOf`). It is hidden when there is no compared period or the compared period had no answers. | One rule in one place, and the API stays plain counts. |
| D20 | The strip label is "Google AI Mode" (cell, tooltip and breakdown strings), and `banned-words.json` gets the entry `ai-mode-bare` so the glossary test guards it. | Glossary P4. The three strings are the only bare "AI Mode" in `en.json`. |
| D21 | `resources.py` and `main.py` are not touched. The read is a method of `LinkReadService` (`reads.page_ai`) that calls a module `page_ai.py`. | `LinkReadService` already has the sessions, the transaction and the scope reads; a new service would add a field to `Resources` and every test that builds one. |
| D22 | The card order in the tab is: the existing strip, Prompts, Citations over time, Cited with this page. One empty state replaces the three cards for `no_prompts` and `no_answers`. | The owner listed the cards in that order; the strip is the summary above them. |

## 4. API

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/ai`

Query: `run` (`latest` or a crawl id, default `latest`), `from`, `to` (dates), `compare` (`none` or
`previous_period`, default `none`). Permission `data:read`. Response `PageAiResponse { data: PageAi }`. Schemas in
`backend/src/idraft/api/schemas/internal_links_ai.py`; every field is required (no defaulted field), so the
generated client types them as required.

**Errors.** `404 not_found` (unknown project, or the page has no row in the crawl), `404 no_crawl` (the project
has no crawl yet; the existing `crawl_scope` error), `422` (`from` after `to`, a period over 92 days
`window_too_large`, a date out of range, one of `from` and `to` missing is allowed: the other defaults), `403` (no
`data:read`).

**`PageAi`**

| Field | Type | Meaning |
|---|---|---|
| `state` | `ready` or `no_prompts` or `no_answers` | D17. |
| `window` | `MetricWindow`-shaped: `from`, `to` (ISO dates, both included), `timezone` | The days counted, in the project's zone. |
| `days` | integer | `to - from + 1`. |
| `compare_window` | `{ from, to }` or null | The days compared with; null when `compare=none`. |
| `answers` | integer | Counted answers in the period (every platform shown, every prompt in scope), the denominator. |
| `answers_citing` | integer | Counted answers in the period that cite this page. |
| `previous_answers` | integer or null | As `answers` for the compared period; null when not compared. |
| `previous_answers_citing` | integer or null | As `answers_citing` for the compared period. |
| `platforms` | list of 3 | One entry per platform shown, always all three in engine order. |
| `platforms[].engine_code` | `chatgpt_web`, `gemini_web`, `google_ai_mode` | |
| `platforms[].label` | string | `ENGINES[code].label`: "ChatGPT", "Gemini", "Google AI Mode". |
| `platforms[].answers` | integer | Counted answers of the platform in the period. |
| `platforms[].answers_citing` | integer | Of those, the answers citing this page. |
| `platforms[].previous_answers_citing` | integer or null | As above, compared period. |
| `prompts` | list, at most 25 | Prompts with at least one citing answer in the period, D11 order. |
| `prompts[].prompt_id` | uuid | The prompt inspector's id. |
| `prompts[].text` | string | The prompt's current text. |
| `prompts[].answers` | integer | Counted answers of this prompt in the period. |
| `prompts[].answers_citing` | integer | Of those, citing this page: the row's "cited" count. |
| `prompts[].platforms` | list | One entry per platform in engine order: `engine_code`, `label`, `answers`, `answers_citing`. |
| `prompts[].last_cited_at` | datetime | Newest citing answer of the prompt in the period. |
| `prompts_total` | integer | Prompts with a citing answer, before the limit. |
| `trend` | list | One entry per local day of the period, oldest first: `date` (ISO), `answers`, `answers_citing`. At most 92. |
| `alongside` | list, at most 10 | D14. |
| `alongside[].url_id` | integer | `core.urls` id. |
| `alongside[].url` | string | The canonical address. |
| `alongside[].path` | string | Its path. |
| `alongside[].title` | string or null | The title the answers showed for it (the longest of the group is not guaranteed; the one `units_of` returns). |
| `alongside[].host` | string | The host. |
| `alongside[].registrable_domain` | string | For the chip. |
| `alongside[].domain_role` | `own`, `competitor`, `third_party` | The stored role. |
| `alongside[].in_crawl` | boolean | Row in `seo.crawl_pages` for this run. Always false for a role other than `own`. |
| `alongside[].answers_shared` | integer | Distinct answers that cite both this page and that address. |
| `alongside_total` | integer | Distinct addresses cited with this page, before the limit. |

Invariants the tests assert: `answers_citing <= answers`; the sum of `trend[].answers_citing` equals
`answers_citing`; the sum of `trend[].answers` equals `answers`; the sum of `platforms[].answers_citing` equals
`answers_citing`; `len(trend) == days`; no prompt row has `answers_citing = 0`; `prompts[].platforms` sums equal
the row's `answers` and `answers_citing`; `answers_shared <= answers_citing`; the page itself is never in
`alongside`.

## 5. Window and compare math

1. `zone = ZoneInfo(project_zone.timezone)`; `today = datetime.now(zone).date()`.
2. `first, last = summary_dates(from, to, today)`: default the 28 days ending today, at most 92 days, both days
   included, `422` when `first > last`.
3. With `compare=previous_period`: `previous = summary.previous_dates(first, last)`: as many days, ending the day
   before `first`. With `none`: no compared period.
4. One scope: `since` is the start instant of `previous.first` (or of `first`), `until` the end instant of `last`,
   both from `sources.local_instants`, so a single `lookback_answers` read covers both periods (they are
   adjacent). Citing answers are filtered from it.
5. An answer belongs to the period of its local date, `observed_at.astimezone(zone).date()`. An answer outside
   both periods cannot occur (the scope bounds it).
6. A period has at most 92 days and the compared one the same: at most 184 days of answers, about 24,000 counted
   answers for a project at the limits (150 prompts, 3 platforms, daily). The model holds them in memory as the
   Citations board does; no statement is per answer.

Example: today 28 Nov, `from` and `to` absent, `compare=previous_period`: `window` 1 Nov to 28 Nov (28 days),
`compare_window` 4 Oct to 31 Oct.

## 6. Counting, platforms and ordering

- **Counted answers** are those of `counted_answers`: current and valid fact rows, not superseded, of the prompts
  in scope, on the platforms shown.
- **Prompts in scope:** `scope_prompts(include_branded=True, prompt_id=None, term_id=None, country_iso=None)`:
  prompts neither paused (`is_active`) nor archived (`deleted_at`).
- **Platforms shown:** `shown_engines(None)`, the platforms a prompt is asked on. Google AI Overview is not one:
  it is keyword level, its answers are not prompt answers, and it cannot be listed by prompt. It stays in the
  strip's total only.
- **Platform meaning on a row:** the platforms with at least one answer of that prompt citing the page in the
  period. The tooltip gives each platform's `answers_citing` of `answers`.
- **Engine order:** `ChatGPT, Gemini, Google AI Mode` (`EngineCode` order on the server, `byEngineOrder` on the
  web). The server returns them in that order; the web sorts again as every list does.
- **Flags:** `EXCLUDED_FLAGS` (`engine_internal`, `unresolved_redirect`) are left out of the citing read and the
  units, as on every default read.
- **Ordering:** prompts D11; alongside D14; trend by date. All three break ties by an id, so a repeated read
  gives the same body.
- **Limits:** 25 prompts, 10 alongside, 92 days. Totals say how many more.

## 7. Own pages

An address in `alongside` is "of your site" when its citation unit's `domain_role` is `own`, and opens the page
drawer (`context.openPage(String(url_id))`, keeping the tab) only when `in_crawl` is true. `in_crawl` is one read:
`SELECT url_id FROM seo.crawl_pages WHERE workspace_id AND run_id AND url_id = ANY(ids)` for the own addresses
shown. An own address outside the crawl (cited, never crawled) shows as text with its address and domain chip and
no link. A competitor shows its address, its domain chip and the badge "Competitor" (glossary B4); a third party
shows the address and the chip. The page itself is excluded by `url_id`.

## 8. Reads on the server

In order, inside the one transaction (no statement is per row, prompt or answer; `units_of` chunks at 4,000
answers as it does for Citations):

1. `read_scope(db, access, project_id, run)`: the project is the workspace's, the crawl is chosen.
2. The page's row in `seo.crawl_pages` for the run, else `NotFoundError`.
3. `project_zone`, else `NotFoundError`.
4. `scope_prompts(...)`. No prompt: `state = no_prompts`, return the zero body (the trend still has one zero point
   per day).
5. `lookback_answers(db, scope)` over both periods.
6. `citing_observations(db, scope, url_id)`: distinct `observation_id` of `ai.citations` where
   `citation_bounds(scope)` and `url_id = :url_id`.
7. `units_of(db, scope, citing answers of the current period)`.
8. `prompt_texts(db, workspace_id, ids of the prompts shown)`.
9. The crawl membership of the own addresses shown (section 7).

The pure model `page_ai_model.build_page_ai` does the counting from these inputs; it has no SQL. The service
module `page_ai.py` does the reads and calls the model. The method `LinkReadService.page_ai` owns the
transaction.

## 9. The web

### 9.1 Files

- `apps/web/src/lib/internal-links/types.ts` (`PageAi`), `queries.ts` (`pageAiQuery(scope, urlId, run, period)`),
  `src/lib/pages/page-ai.ts` (`usePageAi`, a `Seam` like `usePageSearchDaily`), `src/lib/pages/ai-model.ts`
  (pure helpers).
- `src/features/internal-links/inspector/`: `drawer-ai-tab.tsx` (states and the card order),
  `ai-prompts-card.tsx`, `ai-trend-card.tsx`, `ai-alongside-card.tsx`, `ai-basis.tsx` (the printed dates and
  basis); `page-inspector.tsx` renders `DrawerAiTab` in the `ai` panel; `extras-sections.tsx` keeps the strip.
- The three screens and four routes (D13), `page-drawer-context.ts` (`openPrompt`).
- `src/mocks/internal-links-page-ai.ts` and its handler; `messages/en.json` under `pages.drawer.ai`.

### 9.2 What each card shows

**The strip** (existing `CitationsBody`) stays first. When `extras.citations.total === 0` the tab still shows
the strip's one sentence `pages.drawer.ai.none` and then the three cards, because an uncited page is a result
(for example "not cited in the last 28 days" with the trend at zero). The strip and the cards are each their own
`InspectorSection`.

**Prompts that cited this page.** An `InspectorSection` titled "Prompts that cited this page" with the meta
"{count} of {total} prompts" (and "Showing 25 of {total} prompts" when cut). A real `<table>` with a visually
hidden caption, three columns: Prompt (a button with the text truncated to one line, tooltip with the full text;
the cell is `w-full max-w-0`), Platforms (the marks, not wrapped, `whitespace-nowrap`), Cited (`answers_citing`,
a number, `whitespace-nowrap`; tooltip "Cited in 2 of 3 answers"). Row height `h-row-compact`. A row button calls
`context.openPrompt(promptId, ids)` with the ids of all rows shown, in order, so J and K step through them. No
row means the section's empty state "No prompt cited this page in this period".

**Citations over time.** A box as the Search tab's, a `ChartFrame` titled "Citations over time" (kind bar, one
series "Answers that cited this page", `categories` the local days, `categoryHeader` "Day", `cellText` "{k} of {n}
answers" or "No answers" when `n = 0`, `summary` a sentence: "Cited in {k} of {n} answers, {start} to {end}"). Above
the chart, one line: "Cited in {k} answers" and, when the change shows (D19), "{signed delta} against the
{days} days before ({previous})". The Chart and Table switch is the frame's. Bars use the one-series token
colour; no dashes, no second axis.

**Cited with this page.** An `InspectorSection` "Cited with this page", meta "Other addresses cited in the same
answers". A table with the caption, columns Address (see below) and Answers (`answers_shared`, tooltip "Cited
with this page in 3 of 5 answers"). A page that opens the drawer is a button showing its path (and title under
it in the secondary style); another address shows `displayUrl(url).display` truncated and a `DomainChip` under or
beside it as the width allows (`flex-wrap`), with the Competitor badge when it applies. When `alongside_total` is
more than shown: "Showing 10 of {total} addresses". Empty: "No other address was cited in the same answers".

### 9.3 What the cards print: dates and basis

`ai-basis.tsx` renders under the section titles' meta, as `type-meta text-foreground-tertiary`:
"{start} to {end}, project days" (the compared dates too when compared: "against {start} to {end}") and one footnote
paragraph at the foot of the tab: "These cards count answers of the prompts you track now (not paused or
archived) on ChatGPT, Gemini and Google AI Mode. The number above counts every answer of the last 28 days,
including Google AI Overview and paused or archived prompts, so it can be higher." Dates through
`formatBusinessDate`; numbers through `formatInteger`. No word from the banned list ("window", "source").

### 9.4 States

| State | What shows |
|---|---|
| Loading | The strip as today. Each card is an `InspectorSection status="loading"` with its skeleton; the chart frame is not mounted. |
| Error (any status other than 404) | One `InlineError` in place of the three cards, with Retry (`usePageAi` seam `retry`). The strip stays. |
| 404 | The page drawer already says the page is not in the crawl; the tab shows nothing extra. |
| `no_prompts` | One `EmptyState variant="card"`: "No prompts are tracked yet" with the reason "Add prompts and run them to see which of your pages the answers cite" and a link to Prompts if the host gives one (no link in this build: text only). |
| `no_answers` | One `EmptyState variant="card"`: "No answers in this period" with the reason "Your prompts have not been answered in the last 28 days." |
| `ready`, page not cited | Prompts card empty state, trend at zero, alongside empty state. The trend line says "Not cited in this period". |
| `ready`, no compare data | The change part of the line is absent. |

### 9.5 Accessibility, widths, focus

- Tables have captions and real column headers; every row action is a button with a name that includes the prompt
  or the address; the chart has `summary` and the Table switch; colour is never the only sign (the change line
  carries a word and a sign).
- Widths: no pixel width. The prompt and address cells truncate (`min-w-0`, `w-full max-w-0`), number cells are
  `whitespace-nowrap`, the platform marks do not wrap, the badge and chip wrap under the address with
  `flex-wrap`. The drawer is 480 to 960 px; `expectNoPixelWidth` (`src/test/drawer-width-scan.ts`) runs on the
  tab at the widths of `page-drawer-width.test.tsx`, and the e2e spec looks at 480, 640 and 960.
- Focus: opening a prompt hands the drawer to the prompt inspector (shared behaviour). Stepping with J and K goes
  through the prompt ids shown.
- Keyboard: Tab reaches each row button; Enter opens.

### 9.6 The three hosts

Each of `PagesScreen`, `InternalLinksScreen` and `IssuesScreen` gains a required prop
`promptDrawer: ReactNode` (as `CitationsScreenProps`), holds `const [promptOrder, setPromptOrder] =
useState<readonly string[]>([])`, wraps its layout in `PromptOrderContext.Provider`, shows `promptDrawer` when
`inspector.target?.type === 'prompt'`, and puts `openPrompt` in the page drawer context. The four route pages
compose `<PromptDrawerHost workspaceId workspaceSlug projectId projectSlug timeZone />` exactly as
`citations-route.tsx` does. A shared hook (`inspector/use-prompt-opener.ts`) holds the state and `openPrompt`, so
the three screens do not copy it.

## 10. Words and messages

All strings are in `apps/web/messages/en.json` under `pages.drawer.ai.*` with camelCase keys, sentence case, no
dash, no exclamation mark, plural forms by ICU. New terms go into `docs/glossary/terms.md` first.

| Visible words | Rule |
|---|---|
| Prompts that cited this page, Citations over time, Cited with this page | Card titles. "Citations" is glossary E2 (one page in one answer). |
| Platform, Platforms (ChatGPT, Gemini, Google AI Mode) | P1, P4. Never "engine", never bare "AI Mode". |
| answers, "Cited in N answers" | U5, E2. |
| Competitor | B4. |
| your pages, your site | Never "own pages" (banned). |
| paused or archived prompts | B8, B9. Never "inactive". |
| the last 28 days, "{start} to {end}" | Never "window". |

New glossary row (section "Evidence", after E12): **E13 Cited with this page**: "The other addresses cited in the
same answers as one page, with how many answers they shared with it." Is not: "Not a related or similar page. Not
a link between the pages." Banned: "Co-cited, Also cited, Related pages, Source". Where used: "Page drawer, AI
tab". Translation: "Safe". Status: "Firm, owner 2026-11-28". The same row goes into `final-list.md` if that file
lists card titles (the task checks).

Keys (the implementer may add more, never reword these): `ai.prompts.title`, `ai.prompts.meta`,
`ai.prompts.metaCut`, `ai.prompts.caption`, `ai.prompts.columnPrompt`, `ai.prompts.columnPlatforms`,
`ai.prompts.columnCited`, `ai.prompts.rowTip`, `ai.prompts.platformTip`, `ai.prompts.citedTip`,
`ai.prompts.emptyTitle`, `ai.prompts.emptyReason`; `ai.trend.title`, `ai.trend.series`, `ai.trend.day`,
`ai.trend.summary`, `ai.trend.cellText`, `ai.trend.noAnswers`, `ai.trend.line`, `ai.trend.change`,
`ai.trend.notCited`; `ai.alongside.title`, `ai.alongside.meta`, `ai.alongside.caption`,
`ai.alongside.columnAddress`, `ai.alongside.columnAnswers`, `ai.alongside.answersTip`,
`ai.alongside.competitor`, `ai.alongside.openPage`, `ai.alongside.showing`, `ai.alongside.emptyTitle`,
`ai.alongside.emptyReason`; `ai.basis.period`, `ai.basis.compared`, `ai.basis.note`; `ai.state.noPromptsTitle`,
`ai.state.noPromptsReason`, `ai.state.noAnswersTitle`, `ai.state.noAnswersReason`, `ai.state.loadFailed`,
`ai.state.loadFailedReason`. Existing `ai.none` stays.

The strip: `internalLinks.inspectorExtras.aiMode` becomes "Google AI Mode"; `internalLinks.columns.citationsTip`
("Answers from ChatGPT, Gemini and Google AI Mode that cited this page, last 28 days. Today's numbers, whichever
crawl is in view.") and `citationsBreakdown` ("ChatGPT {chatgpt}, Gemini {gemini}, Google AI Mode {aiMode}, last
28 days, today's numbers") follow. Their tests are updated in the same task.

## 11. Mocks

`src/mocks/internal-links-page-ai.ts` builds a deterministic `PageAi` from the page id and the query, using real
prompt ids and texts of `EVENTUS_WORLD` (`ai-prompt-world.ts`) so a row opens a real prompt in the mocked
inspector, and real own pages of the fixture crawl for `alongside` (`in_crawl` true) plus external addresses. It
exports one page per state: a cited page (three platforms, 28 daily points, a compared period with a change, 6
prompts, 5 alongside of which 2 own and in crawl, 1 own not in crawl, 1 competitor, 1 third party), a quiet page
(ready, zeros), a page of `no_answers`, a page of `no_prompts`, and a page that answers 500. The handler is
registered beside `outline` in `handlers/internal-links.ts`. A test pins the invariants of section 4 on every
exported page.

## 12. Tests

Targeted and serial only (machine rule): `pytest -n 0 --no-cov <path>`, `vitest run --maxWorkers=1 <path>`.

**Backend, pure** (`tests/api/internal_links/test_page_ai_model.py`, no database): the day buckets in a zone that
is not UTC (an answer at 23:30 local belongs to its local day); the invariants of section 4 on a built body;
prompt rows (grouping, order, tie-break, limit 25 and `prompts_total`); platforms always three in engine order,
zero-filled; alongside (shared counts, page excluded, order, limit 10, `alongside_total`); `state` for no prompts,
no answers, not cited; compare totals; a day with no answers is a zero point; a period of one day and of 92 days.

**Backend, database** (`tests/api/internal_links/test_page_ai.py`, `tests/api/ai/test_citing_observations.py`):
`citing_observations` bounds (project, period, flags, another page's citations not returned, partition edge);
the route end to end on a seeded crawl and answers: a cited page, an uncited one (`ready`, zeros), a branded
prompt included, a paused and an archived prompt excluded, a superseded answer excluded, a flagged citation
excluded, Google AI Overview citations excluded, two platforms, two periods; `from` after `to` is 422, 93 days
is 422, a page outside the crawl is 404, a viewer reads, a member of another workspace gets 404, no `data:read`
is 403; `run` of an older crawl changes `in_crawl`; the route is in `openapi/v1.json` and `test_route_access`.
`tests/db/test_citations_url_index.py`: `EXPLAIN` of the statement names `citations_url_observed` with
`enable_seqscan = off`.

**Web, pure** (`lib/pages/ai-model.test.ts`): `changeOf` (no compare, compared period without answers, up, down,
equal), the chart series and cell text, the platform tooltip text, the alongside row kind (opens, own not in crawl,
competitor, third party), the date line.

**Web, components** (Testing Library with MSW, as the neighbouring tab tests): each card with its states;
a prompt row calls `openPrompt` with all ids in order and the Citations-style tooltip text; a prompt opens the
prompt host in each of the three screens (a test per screen: the address gets `inspect=prompt:<id>` and
`itab` is absent); an own page in the crawl calls `openPage`; the Chart and Table switch shows the table with
the cell text; the error state retries; `expectNoPixelWidth` on the tab at 480, 640 and 960; axe on the ready
state; the P4 strings; `src/i18n/messages.test.ts` and `src/lib/glossary/glossary-words.test.ts` (with the new
banned entry).

**On the running app** (`e2e/flows/page-ai-tab.spec.ts`, once at the end, against the standalone build with the
test env): at 1280 by 720, open the cited page's drawer, the AI tab shows the strip and the three cards; the
prompts card, then the trend with the Table switch, then alongside; click a prompt: the prompt inspector opens
over the page; click an own address: the drawer moves to that page; the printed dates and basis are there; the
three states (quiet, no answers, no prompts) and the error with Retry; the tab at 480, 640 and 960 px has no
horizontal scroll; screenshots to the scratchpad for the lead.

## 13. Not in this build, known limits

- No date picker in the drawer: the tab always shows the last 28 days against the 28 before.
- No way back from the prompt inspector to the page drawer (decision 2). `Inspector` shows "back" only in sheet
  mode and it calls `onClose`; `useInspector.open` replaces the entry. A return needs a shared `Inspector` or
  `useInspector` change (a "return to" target), which belongs to the shared drawer session.
- A branded prompt opened from the tab: `PromptDrawerHost` asks the prompt summary with `include_branded=false`,
  so its counts strip may have no row for a branded prompt. The cards include branded prompts (they are the
  prompts that cite your own pages most). Task 9 looks at what the inspector shows and reports it; the fix
  (the host asking with branded included for that prompt) belongs to the prompts feature.
- The prompt inspector's own counts use the date range of the address, not the tab's period.
- Google AI Overview citations are in the strip only (section 6).
- No "tracking started" state and no first-answer date.
- No export, no per-answer view, no links to Citations or Prompts pages from the cards.
- No new setting, no new table, no new provider call, no change to the extras read or its cost.

## 14. Merge points and risks

- Shared files this build touches (only the AI entries): `messages/en.json` (`pages.drawer.ai`, three strip
  strings), `docs/glossary/terms.md` (E13), `docs/glossary/banned-words.json` (`ai-mode-bare`), `backend/openapi/v1.json`,
  `apps/web/src/lib/api/schema.ts` (regenerated in its own commit), `read_routes.py`, `reads.py`,
  `handlers/internal-links.ts`. Files of other sessions are not edited: the shared inspector files
  (`components/app/inspector/*`, `lib/inspector/*`) and the prompts feature.
- Risk: the three screens' tests build the screen with props; the new required `promptDrawer` changes each.
- Risk: the Citations count strip and the cards differ by design (D6); the printed basis is the mitigation.
- Risk: a dense project (24,000 counted answers in memory). The Citations board loads more (183 days of units);
  this read loads answers only and units of the citing ones.

## 15. Acceptance checklist

Backend

- [ ] `GET .../internal-links/pages/{url_id}/ai` answers the body of section 4 for a cited page, a page nothing
      cites (`ready`, zeros), and the states `no_prompts` and `no_answers`.
- [ ] The invariants of section 4 hold in tests on seeded data.
- [ ] Paused, archived, superseded, invalid and flagged-citation answers are not counted; branded prompts are.
- [ ] Days are project-local days; `from` after `to` and a period over 92 days are 422; an unknown page is 404.
- [ ] `citing_observations` is one new shared function; no SQL is copied from the cited-pages read; no table, no
      migration (or migration 0049 with the lead told), no provider call.
- [ ] `openapi/v1.json` is regenerated in the same commit as the route; the web client in its own commit.

Web

- [ ] The AI tab shows the strip, then Prompts that cited this page, Citations over time, Cited with this page.
- [ ] A prompt row opens the prompt inspector (`inspect=prompt:<id>`) from Pages, All pages, Internal links and
      Issues; J and K step through the rows shown.
- [ ] The trend has the Chart and Table switch, the change against the compared period when there is one, and
      the dates.
- [ ] An own page in the crawl opens its page drawer; other addresses show the address and domain; a competitor
      has its badge.
- [ ] The cards print their dates and basis; the strip is unchanged except its label.
- [ ] Loading, error with Retry, `no_prompts`, `no_answers` and not cited each look as section 9.4 says.
- [ ] No pixel width at 480, 640 and 960 px; keyboard and screen reader names as section 9.5.
- [ ] "AI Mode" alone appears nowhere in `en.json`; `ai-mode-bare` guards it; `pages.drawer.ai` follows the
      glossary; no em dash or en dash in any added line.

On the running app

- [ ] At 1280 by 720, on mock data, the whole tab works as section 12 says, and the screenshots were looked at.
- [ ] No other session's server was touched; no process or build folder is left.
