# WP-77 Citations v2 web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the real `/ai/citations` screen with the design preview's Citations page (`apps/web/design-preview/cit.js`, `cit-inspector.js`, `cit-data.js`), an exact match of its layout, controls, columns, widths, copy, tooltips, states, drawers and keyboard, reading the five WP-76 routes. Where the preview and the brief disagree, the preview wins; where the design system and the preview disagree, the Open points at the end say what is proposed.

**Architecture:** the new screen is built beside the old one inside `apps/web/src/features/citations/` under new file names, behind no import, so every commit leaves the app working on the old screen. Task 11 switches the route and adds the `gaps` route segment; Task 12 deletes the old files. A preview-generated fixture (`scripts/citations-fixture.mjs`) feeds a pure mock model that answers the five routes, so the app under `NEXT_PUBLIC_API_MOCKING=all` shows the preview's numbers. Six house components are extended through documented variants (`Select`, `EntitySwatch`, `SparklineCell`, `MetricStrip`, `TabNav`, `InspectorSection`) and two are added (`BoardTable`, `TrendIcon`); each gets its design-system document line and a `/design-system` specimen.

**Tech stack:** Next.js App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), TanStack Query, nuqs, next-intl, Base UI through `components/ui`, MSW, vitest with testing-library and `vitest-axe` (`@/test/axe`), Playwright.

**Companion documents:** the brief `docs/ai-visibility/work-packages/WP-77-citations-v2-web.md` (section 2 decisions D-1 to D-10, section 3 parity spec, section 4 removals, section 5 exact-match checking, section 8 leases), the API brief `WP-76-citations-v2-api.md`, its plan `docs/superpowers/plans/2026-11-17-ai-wp-76-citations-v2-api.md` and the contract in `docs/19-api-specification.md` "As built (AI visibility WP-76, 2026-11-17)". Line references below are `C` for `design-preview/cit.js`, `I` for `cit-inspector.js` and `D` for `cit-data.js`.

---

## Decisions (fixed, from the brief section 2)

D-1 Group is a topic term (`filter[term]`, the term or one under it), labels "Group" and "All groups". D-2 a run is per prompt and engine (the API's slots). D-3 Citation growth over all answers (`citations`, `previous_citations`); `matched_*` is not shown. D-4 platforms are the project's enabled engines. D-5 the old tabs, controls and inspectors go. D-6 Cited pages is server sorted, searched and paged, 200 rows a page, the next page loads at the end of the scroll. D-7 default competitors are the first three tracked in Settings order. D-8 the `sources` navigation entry goes. D-9 "Cited alongside" is counted once per answer (the API does it). D-10 a prompt with no topic reads "No group", sorts last, has no badge, and its closest page card says "No page of yours is cited for this group".

## Conventions for every task

- What was run when this plan was written: the fixture script (Task 1) against the preview's data, and the counting of the mock model (Task 2) re-done in plain JavaScript over that fixture, both matching the preview's numbers. The TypeScript and the tests below were written against the generated types and the house components' source, but not compiled or linted (the worktree had no `node_modules`): treat a type error as a plan bug to fix in the task, not a reason to change the design.
- A fresh worktree has no `node_modules`: run `pnpm install --frozen-lockfile` at the worktree root once, before Task 1 (its script needs `typescript` for `design-preview/core-modules.mjs`).
- Tests first. Unit and component tests are vitest with testing-library (`renderWithProviders` from `@/test/render`), accessibility with `axe` from `@/test/axe` (`expect(await axe(container)).toHaveNoViolations()`), the mock server from `@/test/msw`. Run one file with `cd apps/web && pnpm vitest run <path>`.
- One commit per task, message `WP-77: <title>`, no attribution lines, only the task's files (`git add <paths>`, never `git add -A`).
- No em-dash (U+2014) or en-dash (U+2013) in any string, comment, test name or document. Before each commit: `git diff --cached | grep -nP '[\x{2013}\x{2014}]'` prints nothing. Straight double quotes are not allowed inside `messages/en.json` values (`src/i18n/messages.test.ts`): use “ and ”.
- Edit files with the editor's file tools, never with `sed`, heredocs or replace scripts.
- Every visible string comes from `messages/en.json` under `citations` (the tree is in Task 3). Numbers and dates go through `@/lib/format`; rates through `formatPercent`, changes through `formatMetricDelta` and `formatSignedInteger`.
- Types come from the generated client: `import type { Schemas } from '@/lib/api/types'` (`Schemas = components['schemas']`). No `any`, no casts other than the narrowing guards shown.
- Heavy suites run through the lock: `infra/dev/heavy --lane medium --label wp77-test -- bash -c 'cd apps/web && pnpm test'`, and `--lane heavy` for `pnpm build` and `pnpm e2e`. Single test files run directly.
- Checks before each commit, in `apps/web`: `pnpm lint` (three errors in `design-preview/il-journey.js`, `il-model.js` and `il-settings.js` are known and not ours; nothing else may fail), `pnpm typecheck`, the task's test files, `pnpm format:check`. The full `pnpm test` and `pnpm build` run at the end of Tasks 6, 11, 12 and 13.
- The old screen keeps working until Task 11: no task before it edits a file the old screen imports, except where the step says so and keeps the old callers compiling.

## How the old and the new screen live side by side

| Concern | Until Task 11 | Task 11 | Task 12 |
|---|---|---|---|
| Route `ai/citations/page.tsx` | renders the old `CitationsScreen` from `@/features/citations` | `features/citations/index.ts` exports the new `CitationsScreen` from `./board-screen`; the route passes two new props; `ai/citations/gaps/page.tsx` is added | unchanged |
| Old files in `features/citations` | untouched | untouched, unimported by the route | deleted (list in Task 12) |
| `messages/en.json` `citations` | old keys plus the new subtrees of Task 3 (no name is shared but `title`, `noAccessTitle`, `noAccessReason`, whose text stays) | same | old subtrees deleted |
| `lib/inspector/placement.ts` | old types | `cited-page`, `gap-prompt` added in Task 10 | `domain`, `source` stay (other features use them) |

## File map

Create (feature, `apps/web/src/features/citations/`):

| File | Responsibility | Task |
|---|---|---|
| `board-state.ts`, `board-state.test.ts` | URL keys, defaults, parsing, writing, old-key migration (pure) and `useBoardState` | 3 |
| `board-text.ts`, `board-text.test.ts` | Runs notes, previous window text, scope text, counted nouns (pure, take the translator) | 3 |
| `board-reads.ts`, `board-reads.test.tsx` | Query hooks of the five routes, engines, entities, topic terms | 3 |
| `scope-toolbar.tsx`, `competitor-picker.tsx`, `scope-toolbar.test.tsx` | Toolbar: three selects, competitors popover, reset, export | 4 |
| `measures-model.ts`, `measures-model.test.ts`, `measures-strip.tsx`, `measures-strip.test.tsx` | Metric strip values, deltas and tooltips | 5 |
| `board-panel.tsx`, `board-panel.test.tsx` | Tabs, search, controls slot, summary slot, table or empty state, footer | 6 |
| `cited-pages/page-rows.ts`, `cited-pages/page-rows.test.ts`, `cited-pages/page-columns.tsx`, `cited-pages/page-columns.test.tsx` | Cited pages columns and cells | 7 |
| `cited-pages/pages-tab.tsx`, `cited-pages/owner-filter.tsx`, `cited-pages/prompts-popover.tsx`, `cited-pages/pages-tab.test.tsx` | Owner filter, paging, prompts popover, empty states | 8 |
| `board-export.ts`, `board-export.test.ts` | CSV rows of both tabs | 8 |
| `gaps/gap-model.ts`, `gaps/gap-model.test.ts`, `gaps/gap-mark.tsx`, `gaps/gaps-tab.tsx`, `gaps/gaps-tab.test.tsx` | Gap rows, mark, sorts, Only gaps, summary | 9 |
| `drawers/drawer-parts.tsx`, `drawers/page-drawer.tsx`, `drawers/page-drawer.test.tsx` | Page drawer | 10 |
| `drawers/gap-drawer.tsx`, `drawers/gap-drawer.test.tsx` | Gap drawer | 11 |
| `board-screen.tsx`, `board-screen.test.tsx` | The screen: state, reads, layout, inspector host | 11 |

Create elsewhere:

| File | Task |
|---|---|
| `apps/web/scripts/citations-fixture.mjs`, `apps/web/src/mocks/fixtures/citations-v2.json`, `apps/web/src/mocks/fixtures/citations-v2.test.ts` | 1 |
| `apps/web/src/mocks/handlers/citations-v2-model.ts`, `citations-v2-model.test.ts`, `citations-v2.ts`, `citations-v2.test.ts` | 2 |
| `apps/web/src/lib/citations/board-queries.ts`, `board-queries.test.ts` | 3 |
| `apps/web/src/components/app/metric/trend-icon.tsx`, `trend-icon.test.tsx` | 5 |
| `apps/web/src/components/app/table/board-table.tsx`, `board-table.test.tsx` | 6 |
| `apps/web/src/lib/inspector/prompt-order.ts` | 11 |
| `apps/web/src/features/prompts/prompt-drawer-host.tsx`, `prompt-drawer-host.test.tsx` (lease, Open point 6) | 11 |
| `apps/web/src/app/[workspace]/[project]/ai/citations/gaps/page.tsx`, `page.test.tsx` | 11 |
| `apps/web/e2e/flows/ai-citations.spec.ts` (replaced), `apps/web/e2e/support/ai-citations.ts` (replaced) | 13 |

Modify (leases in brackets): `src/mocks/handlers/index.ts` [lease], `src/mocks/respond.ts` (one problem code, Task 2) [lease], `messages/en.json` `citations` [lease], `src/components/ui/select.tsx` (Task 4), `src/components/app/entity/entity-swatch.tsx` (Task 4), `src/components/app/sparkline/sparkline-cell.tsx` (Task 7), `src/components/app/metric/metric-strip.tsx` (Task 5), `src/components/app/shell/tab-nav.tsx` (Task 6), `src/components/app/inspector/inspector-section.tsx` (Task 10), `src/lib/inspector/placement.ts` [lease] (Task 10), `src/features/prompts/index.ts` [lease, Open point 6] (Task 11), `src/app/[workspace]/[project]/ai/citations/page.tsx` (Task 11), `src/features/ai-overview/cards/sources/parts/drill.ts` and `src/features/ai-overview/drilldown/drill-links.ts` with their tests [lease] (Task 12), `src/lib/navigation/registry.ts` [lease] (Task 12), design-system docs `docs/design-system/12-tables.md`, `14-badges-status.md`, `16-drawers-dialogs-popovers.md`, `23-application-patterns.md`, `25-component-inventory.md` and the specimens in `src/components/design-system/` (per task).

## The WP-76 contract the web uses (from `src/lib/api/schema.ts`)

Paths, all `GET`, under `P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}'`:

| Path | Response schema | Query parameters (exact names) |
|---|---|---|
| `${P}/ai/citation-overview` | `CitationOverview` | `runs?: number`, `filter[engine_code_in]?: EngineCode[] \| null`, `filter[term]?: string \| null`, `include_branded?`, `include_unresolved_redirects?`, `include_engine_internal?` |
| `${P}/ai/cited-pages` | `CitedPagePage` | the shared ones plus `filter[domain_role_in]?: 'own' \| 'competitor' \| 'third_party' \| null` (one role), `q?: string \| null`, `sort?: '-citations' \| 'citations' \| '-change' \| 'change' \| '-prompts' \| 'prompts' \| '-last_cited' \| 'last_cited' \| 'page' \| '-page'`, `offset?: number`, `limit?: number` (at most 200) |
| `${P}/ai/cited-pages/{url_id}` | `CitedPageDetail` | the shared ones; `url_id: number` in the path; `404` when no current answer cites the page |
| `${P}/ai/citation-gaps` | `CitationGapList` | the shared ones plus the required `filter[competitor_id_in]: string[]` (1 to 5 tracked ids; a repeated id is dropped, order kept; an untracked one is `422 competitor_not_tracked`) |
| `${P}/ai/citation-gaps/{prompt_id}` | `CitationGapDetail` | as the gap list; `404` for a prompt with no current answer |

Arrays are sent as one comma list (`lib/api/client.ts` `QUERY_SERIALIZER = { array: { style: 'form', explode: false } }`), so `filter[engine_code_in]=chatgpt_web,gemini_web`.

Schemas and the fields the screen reads:

- `RunWindow`: `runs: number` (1, 2 or 4, typed `number`), `timezone`, `current: RunSlot[]`, `previous: RunSlot[]`, `trend: RunSlot[]` (slots 1 to 8 that hold answers, oldest first, the same whatever `runs` is), `answers`, `prompts`, `latest_answer_at: string | null`, `latest_run_number: number | null`. `RunSlot`: `slot`, `first_at`, `last_at`, `answers`.
- `CitationOverview`: `citations`, `previous_citations`, `matched_citations`, `matched_previous_citations`, `matched_pairs`, `own_urls`, `previous_own_urls`, `domains`, `previous_domains`, `engines: EngineCitationCounts[]` (`engine_code`, `answers`, `answers_citing`, `prompts`, `prompts_citing`, `previous_answers`, `previous_answers_citing`, `previous_prompts`, `previous_prompts_citing`), `window`.
- `CitedPagePage`: `data: CitedPageRow[]`, `meta: CitedPagesMeta` (`citations`: units of the rows the filter and `q` keep; `owners: OwnerCounts` with `own`, `competitor`, `third_party`, `all`, whatever the filter and `q`; `window`), `page: OffsetPageInfo` (`offset`, `limit`, `total`).
- `CitedPageRow`: `url_id`, `url`, `host`, `path`, `registrable_domain`, `title: string | null`, `domain_role`, `entity_id: string | null`, `entity_name: string | null`, `color_index: number | null`, `citations`, `previous_citations`, `prompts`, `top_prompts: PromptCount[]` (`prompt_id`, `text`, `citations`; most citations first), `engines: EngineUnits[]` (`engine_code`, `citation_units`), `trend: number[]` (units per `window.trend` slot, oldest first), `last_cited_at`.
- `CitedPageDetail`: `page: CitedPageRow`, `prompts: CitedPagePrompt[]` (`prompt_id`, `text`, `answers`, `cited`, `engines: EngineAnswers[]` with `engine_code`, `answers`, `cited`, `last_cited_at`), `alongside: CitedAlongside[]` (`registrable_domain`, `domain_role`, `entity_id`, `entity_name`, `color_index`, `answers`), `window`.
- `CitationGapList`: `data: CitationGapRow[]`, `meta: CitationGapsMeta` (`competitors: GapCompetitor[]` with `entity_id`, `name`, `color_index`, `domain: string | null`; `gaps`; `prompts`; `window`).
- `CitationGapRow`: `prompt_id`, `text`, `topic: PromptTopic | null` (`term_id`, `name`), `you: BrandOnPrompt`, `competitors: CompetitorOnPrompt[]`, `gap`, `lost_on: EngineCode[]`, `lost_to: string[]` (entity ids), `competitor_answers`. `BrandOnPrompt`: `total: BrandCell`, `engines: EngineBrandCell[]`, `platforms`, `cited_on`; `CompetitorOnPrompt` adds `entity_id`. `BrandCell`: `answers`, `cited`, `mentioned`, `state: 'cited' | 'mentioned' | 'not' | 'none'`; `EngineBrandCell` adds `engine_code`.
- `CitationGapDetail`: `row: CitationGapRow`, `answers`, `own_pages`, `closest_pages`, `competitor_pages`, `third_party_pages` (all `GapPage[]`: `url_id`, `url`, `entity_id`, `citations`, `engines: EngineCode[]`), `window`.
- `EngineCode` is `'chatgpt_web' | 'gemini_web' | 'google_ai_mode'`.

The screen also reads `GET ${P}/engines` (`ProjectEngine[]`: `engine.engine_code`, `engine.label`, `is_enabled`), `GET ${P}/entities` (`ProjectEntityList`: `ProjectEntity` with `entity.entity_id`, `entity.canonical_name`, `role`, `is_primary`, `color_index`, `domains[].domain.registrable_domain`, `removed_at`) and the topic vocabularies through `useVocabularies` of `@/lib/keywords/taxonomy-reads` (`loaded[].vocabulary.kind === 'topic'`, `terms: NamedTerm[]` with `termId`, `name`, `parentId`, depth first). The own domain is `Project.primary_domain.registrable_domain`, which the route passes in (Task 11).

## URL state (Task 3)

| Key | Values | Default (never written) | Notes |
|---|---|---|---|
| `platform` | an enabled engine code, or `all` | `all` | unknown or disabled: default |
| `group` | a topic term id, or `all` | `all` | unknown once the terms have loaded: default; kept as given while they load |
| `runs` | `1`, `2`, `4` | `4` | |
| `comp` | comma list of tracked competitor entity ids | the first three tracked (D-7) | absent: default; present and empty: none (C 46); unknown ids dropped, repeats dropped, URL order kept, at most 5; the picker writes the tracked order (C 157) |
| `owner` | `own`, `competitor`, `third`, `all` | `own` | `third` maps to the API's `third_party` |
| `gaps` | `all` | absent, meaning only gaps | |
| `q` | text | empty | trimmed, cut to 200 characters; Cited pages sends it to the API after 250 ms (`useDebouncedValue`), Gap analysis filters in the browser |
| `inspect`, `itab` | `cited-page:<url_id>`, `gap-prompt:<prompt_id>`, `prompt:<id>` | absent | owned by `useInspector` |

Old keys, read once on load and dropped by one `replace` write: `tab`, `kind`, `engine`, `role`, `topic`, `branded`, `redirects`, `internal`, `cmp`, `min`, `sort`, `domain`, `density`, `cols`, `country`, `win`, `from`, `to`. `role=own|competitor|third_party` becomes `owner` (`third_party` becomes `third`), `topic` becomes `group`; every `tab` value opens Cited pages (the address is `/ai/citations`, which is Cited pages). Sort is kept in component state, not in the address, as the preview (C 32); see Open point 9.

There is no `lib/filters/parsers.ts` in the repository (the rule 15 file does not exist): the screen follows the existing pattern of `features/citations/citation-scope.ts`, one `parseAsString` per key through `useQueryStates` and a pure parser.

## Tasks

| # | Task | Brief step |
|---|---|---|
| 1 | Fixture script and fixture | 1 |
| 2 | Mock model and the five MSW routes | 1 |
| 3 | Query wrappers, URL state, words and the message tree | 2 |
| 4 | Toolbar: three selects, competitors popover, reset, export | 3 |
| 5 | Metric strip | 4 |
| 6 | Board table, tabs, table panel, search, footer, empty states | 5 |
| 7 | Cited pages columns and cells | 6 |
| 8 | Cited pages tab: owner filter, prompts popover, paging, export | 6 |
| 9 | Gap analysis | 7 |
| 10 | Page drawer | 8 |
| 11 | Gap drawer, prompt inspector in place, the screen and the route switch | 8 |
| 12 | Remove the old screen; repoint the Overview drills; remove Sources | 9 |
| 13 | e2e, screenshot parity, as-built note, full checks, push | 10 |

---

### Task 1: Fixture script and fixture

Brief step 1 (first half); section 5.1. Parity rows: none on screen; it makes every number row of 3.3, 3.5 and 3.6 checkable.

**Files:**
- Create: `apps/web/scripts/citations-fixture.mjs`
- Create (generated): `apps/web/src/mocks/fixtures/citations-v2.json`
- Create: `apps/web/src/mocks/citations-v2-shape.ts` (the fixture's zod shape and types) and `apps/web/src/mocks/citations-v2-fixture.ts` (the parsed value)
- Modify: `apps/web/.prettierignore` (the generated fixture)
- Test: `apps/web/src/mocks/citations-v2-fixture.test.ts`

Design:
- The script runs `design-preview/core-modules.mjs` first (it transpiles `src/lib/stats` and `src/lib/format` into the git-ignored `design-preview/vendor/`, which `cit-data.js` imports; a fresh worktree has none), then imports `design-preview/cit-data.js` and `aiov-data.js` by file URL.
- Scope of the data: every prompt of `promptsInScope({ group: 'all' })` (250 core, non-branded prompts, D 197), the answers of `answersIn(scope)` and `answersIn(scope, 'previous')` at `runs: 4` (D 203 to 216), without `google_ai_overview` (D-4).
- Slots (D-2): an answer of the current window from run `r` (0 to 3, D 22) is slot `4 - r`; an answer of the previous window from run `r` is slot `8 - r`. So slot 1 is Sep 28 and slot 8 is Aug 10. The slot instants are those days at the preview's per-platform run times (`LAST_RUN_BY_PLATFORM` of `aiov-data.js` line 26: ChatGPT 02:10, Gemini 02:12, Google AI Mode 02:15) in Europe/Berlin, the e2e project's zone (UTC+2 on those days). `latestRunNumber` is `RUNS.number` (48, `aiov-data.js` line 25).
- The fixture keeps the preview's names (own `northwind.com`, the five tracked competitors in their order, the 13 topics); the mock model maps them onto the requesting project's world (Task 2).
- `expected` is computed from the preview's own answers with the preview's rules (rates per engine, then the equal-weight average; distinct own URLs and domains; per-engine gap, a prompt lost on any engine is a gap), for three scopes at the default competitors and runs 4: `chatgpt` (`chatgpt_web`, the screenshot scope of section 5.3), `enabled` (`chatgpt_web` and `gemini_web`, the engines the Fynix mock project has on, `src/mocks/handlers/prompts.test.ts` line 111) and `three` (all three codes, the brief's "three engine numbers"). For `chatgpt` the script asserts that its numbers equal `headline`, `pageRows` and `gapRows` of the preview (D 253, 281, 371), so a drift between the two is caught where it starts.

- [ ] **Step 0: Install**

Run: `pnpm install --frozen-lockfile` (worktree root). Expected: `node_modules` in the root and in `apps/web`.

- [ ] **Step 1: Write the script**

```js
/**
 * Writes src/mocks/fixtures/citations-v2.json from the design preview's Citations data (design-preview/cit-data.js),
 * so the app under NEXT_PUBLIC_API_MOCKING=all shows the preview's numbers (WP-77 brief section 5). Run from apps/web:
 * `node scripts/citations-fixture.mjs`. The fixture is committed; run the script again only when cit-data.js changes.
 *
 * The preview's data imports the transpiled src/lib modules, so design-preview/core-modules.mjs runs first. The app has
 * three engine codes: the preview's Google AI Overview answers are left out (D-4). An answer is one row with its slot
 * (D-2): run r of the current window is slot 4 - r, run r of the window before is slot 8 - r.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execPath, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const preview = join(web, 'design-preview');
execFileSync(execPath, [join(preview, 'core-modules.mjs')], { stdio: 'inherit' });

const cit = await import(pathToFileURL(join(preview, 'cit-data.js')).href);
const aiov = await import(pathToFileURL(join(preview, 'aiov-data.js')).href);

const ENGINES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
/** The run time of each platform (aiov-data.js LAST_RUN_BY_PLATFORM), in Europe/Berlin, UTC+2 on these days. */
const RUN_TIME = { chatgpt_web: '02:10', gemini_web: '02:12', google_ai_mode: '02:15' };
const OFFSET = '+02:00';
/** Slot 1 to 8: the current window's runs Sep 28 back to Sep 7, then the previous window's Aug 31 back to Aug 10. */
const SLOT_DAYS = ['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24', '2026-08-17', '2026-08-10'];
const instant = (slot, code) => new Date(`${SLOT_DAYS[slot - 1]}T${RUN_TIME[code]}:00${OFFSET}`).toISOString();
const promptUuid = (index) => `0192d1a8-c177-7000-8000-${String(index + 1).padStart(12, '0')}`;

const base = { platform: 'all', group: 'all', runs: 4, competitors: cit.DEFAULT_COMPETITORS };
const prompts = cit.promptsInScope(base);
const promptIndex = new Map(prompts.map((prompt, index) => [prompt.id, index]));
const topics = aiov.GROUPS.filter((group) => group.kind === 'topic').map((group) => group.label);
const tracked = cit.TRACKED;

// Every URL any kept answer cites, in first-seen order, with its owner
const urls = [];
const urlIndex = new Map();
const urlOf = (url) => {
  if (!urlIndex.has(url)) {
    const page = cit.pageOf(url);
    urlIndex.set(url, urls.length);
    urls.push({
      domain: page.domain,
      path: page.path,
      title: page.title,
      role: page.owner === 'own' ? 'own' : page.owner === 'competitor' ? 'competitor' : 'third_party',
      competitor: page.owner === 'competitor' ? tracked.findIndex((entry) => entry.name === page.brand) : null,
    });
  }
  return urlIndex.get(url);
};

const kept = (answer) => ENGINES.includes(answer.code);
const rowOf = (answer, slot) => [
  promptIndex.get(answer.promptId),
  ENGINES.indexOf(answer.code),
  slot,
  answer.mentioned ? 1 : 0,
  answer.urls.map(urlOf),
  tracked.map((competitor) => {
    const rival = answer.rivals.find((entry) => entry.id === competitor.id);
    return rival?.cited ? 2 : rival?.mentioned ? 1 : 0;
  }),
];
const answers = [
  ...cit.answersIn(base).filter(kept).map((answer) => rowOf(answer, 4 - answer.run)),
  ...cit.answersIn(base, 'previous').filter(kept).map((answer) => rowOf(answer, 8 - answer.run)),
];

// -------------------------------------------------------------------------------------------------
// What the screen must show, over the preview's own answers and rules

const scopeOf = (code) => ({ ...base, platform: code });
const mean = (values) => {
  const known = values.filter((value) => value !== null);
  return { value: known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length, used: known.length };
};
/** D 222 to 233: per engine, answers citing you over answers and prompts citing you over prompts. */
function ratesOf(lists) {
  const per = lists.map((list) => {
    const prompts = new Set(list.map((answer) => answer.promptId));
    const covered = new Set(list.filter((answer) => answer.cited).map((answer) => answer.promptId));
    return { n: list.length, k: list.filter((answer) => answer.cited).length, prompts: prompts.size, covered: covered.size };
  });
  const sum = (field) => per.reduce((total, entry) => total + entry[field], 0);
  const frequency = mean(per.map((entry) => (entry.n > 0 ? entry.k / entry.n : null)));
  const coverage = mean(per.map((entry) => (entry.prompts > 0 ? entry.covered / entry.prompts : null)));
  return { frequency, coverage, answers: { k: sum('k'), n: sum('n') }, prompts: { k: sum('covered'), n: sum('prompts') } };
}
const distinct = (lists, pick) => new Set(lists.flat().flatMap(pick)).size;
const ownUnits = (lists) => lists.flat().reduce((sum, answer) => sum + answer.own.length, 0);

function expectedFor(codes) {
  const now = codes.map((code) => cit.answersIn(scopeOf(code)));
  const before = codes.map((code) => cit.answersIn(scopeOf(code), 'previous'));
  const a = ratesOf(now);
  const b = ratesOf(before);
  const strip = {
    answers: now.flat().length,
    prompts: distinct(now, (answer) => [answer.promptId]),
    citations: ownUnits(now),
    previousCitations: ownUnits(before),
    frequency: a.frequency.value,
    frequencyUsed: a.frequency.used,
    frequencyCounts: a.answers,
    previousFrequency: b.frequency.value,
    coverage: a.coverage.value,
    coverageUsed: a.coverage.used,
    coverageCounts: a.prompts,
    previousCoverage: b.coverage.value,
    urls: distinct(now, (answer) => answer.own),
    previousUrls: distinct(before, (answer) => answer.own),
    domains: distinct(now, (answer) => answer.urls.map((url) => url.split('/')[0])),
    previousDomains: distinct(before, (answer) => answer.urls.map((url) => url.split('/')[0])),
  };
  // Cited pages: one row per URL of the current answers; citations add up over the engines
  const rows = new Map();
  now.flat().forEach((answer) =>
    answer.urls.forEach((url) => {
      const row = rows.get(url) ?? { url, owner: cit.pageOf(url).owner, path: cit.pageOf(url).path, citations: 0, prompts: new Set() };
      row.citations += 1;
      row.prompts.add(answer.promptId);
      rows.set(url, row);
    }),
  );
  const all = [...rows.values()];
  const topOwn = all.filter((row) => row.owner === 'own').sort((x, y) => y.citations - x.citations || x.url.localeCompare(y.url))[0];
  // Gap analysis: per engine, then a prompt lost on any engine is a gap (D 371 to 392)
  const gapRows = new Map();
  codes.forEach((code) =>
    cit.gapRows(scopeOf(code)).forEach((row) => {
      const entry = gapRows.get(row.id) ?? { text: row.prompt.text, gap: 0, lostTo: new Set(), rivalAnswers: 0 };
      entry.gap += row.gap;
      row.lostTo.forEach((id) => entry.lostTo.add(id));
      entry.rivalAnswers += row.rivalAnswers;
      gapRows.set(row.id, entry);
    }),
  );
  const gaps = [...gapRows.values()];
  const first = [...gaps].sort((x, y) => y.gap - x.gap || y.lostTo.size - x.lostTo.size || y.rivalAnswers - x.rivalAnswers || x.text.localeCompare(y.text))[0];
  return {
    engines: codes,
    strip,
    pages: {
      own: all.filter((row) => row.owner === 'own').length,
      competitor: all.filter((row) => row.owner === 'competitor').length,
      third_party: all.filter((row) => row.owner === 'third').length,
      all: all.length,
      topOwn: { path: topOwn.path, citations: topOwn.citations, prompts: topOwn.prompts.size },
    },
    gaps: { prompts: gaps.length, gaps: gaps.filter((row) => row.gap > 0).length, first: first.text },
  };
}

const chatgpt = expectedFor(['chatgpt_web']);
// The single engine numbers are the preview's own functions' numbers
const head = cit.headline(scopeOf('chatgpt_web'));
assert.equal(chatgpt.strip.citations, head.citations.value);
assert.equal(chatgpt.strip.previousCitations, head.citations.previous);
assert.equal(chatgpt.strip.urls, head.urls.value);
assert.equal(chatgpt.strip.domains, head.domains.value);
assert.equal(chatgpt.strip.frequency, head.frequency.value);
assert.equal(chatgpt.strip.coverage, head.coverage.value);
assert.equal(chatgpt.pages.all, cit.pageRows(scopeOf('chatgpt_web')).length);
assert.equal(chatgpt.gaps.gaps, cit.gapRows(scopeOf('chatgpt_web')).filter((row) => row.gap > 0).length);

const fixture = {
  version: 1,
  source: 'apps/web/design-preview/cit-data.js through apps/web/scripts/citations-fixture.mjs',
  engines: ENGINES,
  ownDomain: cit.OWN_DOMAIN,
  ownName: cit.OWN_NAME,
  latestRunNumber: aiov.RUNS.number,
  slots: SLOT_DAYS.map((_, index) => Object.fromEntries(ENGINES.map((code) => [code, instant(index + 1, code)]))),
  competitors: tracked.map((competitor) => ({ name: competitor.name, domain: competitor.domain })),
  topics,
  prompts: prompts.map((prompt, index) => ({ id: promptUuid(index), text: prompt.text, topic: topics.indexOf(prompt.topic) })),
  urls,
  answers,
  expected: { chatgpt, enabled: expectedFor(['chatgpt_web', 'gemini_web']), three: expectedFor(ENGINES) },
};

const out = join(web, 'src', 'mocks', 'fixtures', 'citations-v2.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture)}\n`);
stdout.write(`Wrote ${answers.length} answers, ${urls.length} pages and ${prompts.length} prompts to src/mocks/fixtures/citations-v2.json\n`);
stdout.write(`ChatGPT: ${chatgpt.strip.citations} citations, ${chatgpt.strip.urls} own URLs, ${chatgpt.strip.domains} domains, ${chatgpt.gaps.gaps} gaps of ${chatgpt.gaps.prompts} prompts\n`);
```

`src/mocks/fixtures/` sits beside `src/mocks/fixtures.ts`; `@/mocks/fixtures` still resolves to the file (TypeScript `bundler` resolution and Vite both try `fixtures.ts` before a directory), so no importer changes.

- [ ] **Step 2: Run it**

Run: `cd apps/web && node scripts/citations-fixture.mjs`
Expected (run on 2026-11-17 against this data): `Transpiled core modules ...`, then `Wrote 8152 answers, 278 pages and 250 prompts to src/mocks/fixtures/citations-v2.json` and `ChatGPT: 405 citations, 13 own URLs, 26 domains, 61 gaps of 250 prompts`. The JSON is one line of about 390 KB. Its `expected` blocks read, for reference: ChatGPT 405 citations (350 before), rate 21.0% (378 of 1,800 answers), coverage 68.0% (170 of 250 prompts), 278 pages (13 own, 65 competitor, 200 third-party), top own page `/blog/best-crm-for-startups` with 76 citations; ChatGPT and Gemini 607 citations, 148 gaps; all three 959 citations, 160 gaps of 250 prompts.

- [ ] **Step 3: Write the failing test**

`apps/web/src/mocks/citations-v2-fixture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CITATIONS_FIXTURE } from './citations-v2-fixture';

describe('the Citations v2 fixture (scripts/citations-fixture.mjs)', () => {
  it('holds the three engines, eight slots, the five tracked competitors and the 250 prompts', () => {
    expect(CITATIONS_FIXTURE.engines).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(CITATIONS_FIXTURE.slots).toHaveLength(8);
    expect(CITATIONS_FIXTURE.competitors).toHaveLength(5);
    expect(CITATIONS_FIXTURE.prompts).toHaveLength(250);
  });

  it('points every answer at a prompt, an engine, a slot and pages it lists', () => {
    for (const [prompt, engine, slot, , urls, rivals] of CITATIONS_FIXTURE.answers) {
      expect(CITATIONS_FIXTURE.prompts[prompt]).toBeDefined();
      expect(CITATIONS_FIXTURE.engines[engine]).toBeDefined();
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(8);
      for (const url of urls) expect(CITATIONS_FIXTURE.urls[url]).toBeDefined();
      expect(rivals).toHaveLength(CITATIONS_FIXTURE.competitors.length);
    }
  });

  it('says a competitor page belongs to one of the tracked competitors', () => {
    for (const url of CITATIONS_FIXTURE.urls) {
      expect(url.competitor === null).toBe(url.role !== 'competitor');
    }
  });

  it('carries what the screen must show for ChatGPT, the enabled engines and all three', () => {
    expect(CITATIONS_FIXTURE.expected.chatgpt.engines).toEqual(['chatgpt_web']);
    expect(CITATIONS_FIXTURE.expected.chatgpt.strip.citations).toBeGreaterThan(0);
    expect(CITATIONS_FIXTURE.expected.three.gaps.gaps).toBeGreaterThanOrEqual(CITATIONS_FIXTURE.expected.chatgpt.gaps.gaps);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `cd apps/web && pnpm vitest run src/mocks/citations-v2-fixture.test.ts`
Expected: FAIL, `Failed to resolve import "./citations-v2-fixture"`.

- [ ] **Step 5: Write the shape**

The shape and the parsed value are two files, so the e2e can check the JSON it reads from disk with the same shape without importing JSON through Node's ESM loader (`apps/web/package.json` is `"type": "module"`, where a JSON import needs an import attribute).

`apps/web/src/mocks/citations-v2-fixture.ts`:

```ts
import raw from './fixtures/citations-v2.json';
import { CITATIONS_FIXTURE_SHAPE, type CitationsFixture } from './citations-v2-shape';

export type { CitationsFixture, FixtureEngine, FixtureExpected } from './citations-v2-shape';

/** Parsed once, when the mock layer loads: a fixture that no longer fits fails there and in its test. */
export const CITATIONS_FIXTURE: CitationsFixture = CITATIONS_FIXTURE_SHAPE.parse(raw);
```

`apps/web/src/mocks/citations-v2-shape.ts`:

```ts
import { z } from 'zod';

/**
 * The Citations v2 fixture (WP-77), generated by `scripts/citations-fixture.mjs` from the design preview's data. One
 * answer is `[prompt, engine, slot, mentioned, urls, rivals]`: indexes into `prompts`, `engines` and
 * `urls`, the slot 1 to 8 (D-2), whether the own brand is named (0 or 1), the pages it cites, and per tracked
 * competitor 0 (not named), 1 (named, not cited) or 2 (cited).
 */

const ENGINE = z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
const ROLE = z.enum(['own', 'competitor', 'third_party']);
const RIVAL = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const COUNTS = z.object({ k: z.number().int(), n: z.number().int() });
const RATE = z.number().nullable();

const EXPECTED = z.object({
  engines: z.array(ENGINE),
  strip: z.object({
    answers: z.number().int(),
    prompts: z.number().int(),
    citations: z.number().int(),
    previousCitations: z.number().int(),
    frequency: RATE,
    frequencyUsed: z.number().int(),
    frequencyCounts: COUNTS,
    previousFrequency: RATE,
    coverage: RATE,
    coverageUsed: z.number().int(),
    coverageCounts: COUNTS,
    previousCoverage: RATE,
    urls: z.number().int(),
    previousUrls: z.number().int(),
    domains: z.number().int(),
    previousDomains: z.number().int(),
  }),
  pages: z.object({
    own: z.number().int(),
    competitor: z.number().int(),
    third_party: z.number().int(),
    all: z.number().int(),
    topOwn: z.object({ path: z.string(), citations: z.number().int(), prompts: z.number().int() }),
  }),
  gaps: z.object({ prompts: z.number().int(), gaps: z.number().int(), first: z.string() }),
});

export const CITATIONS_FIXTURE_SHAPE = z.object({
  version: z.literal(1),
  source: z.string(),
  engines: z.tuple([z.literal('chatgpt_web'), z.literal('gemini_web'), z.literal('google_ai_mode')]),
  ownDomain: z.string(),
  ownName: z.string(),
  latestRunNumber: z.number().int(),
  slots: z.array(z.object({ chatgpt_web: z.string(), gemini_web: z.string(), google_ai_mode: z.string() })).length(8),
  competitors: z.array(z.object({ name: z.string(), domain: z.string() })),
  topics: z.array(z.string()),
  prompts: z.array(z.object({ id: z.uuid(), text: z.string(), topic: z.number().int() })),
  urls: z.array(
    z.object({
      domain: z.string(),
      path: z.string(),
      title: z.string(),
      role: ROLE,
      competitor: z.number().int().nullable(),
    }),
  ),
  answers: z.array(
    z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.array(z.number().int()), z.array(RIVAL)]),
  ),
  expected: z.object({ chatgpt: EXPECTED, enabled: EXPECTED, three: EXPECTED }),
});

export type CitationsFixture = z.infer<typeof CITATIONS_FIXTURE_SHAPE>;
export type FixtureExpected = z.infer<typeof EXPECTED>;
export type FixtureEngine = z.infer<typeof ENGINE>;
```

- [ ] **Step 6: Run the test**

Run: `cd apps/web && pnpm vitest run src/mocks/citations-v2-fixture.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Checks and commit**

The fixture is generated: add it to `apps/web/.prettierignore` under the first comment ("Build output, scratch and generated files"), as the line `src/mocks/fixtures`. Then run `cd apps/web && pnpm prettier --write scripts/citations-fixture.mjs src/mocks/citations-v2-shape.ts src/mocks/citations-v2-fixture.ts src/mocks/citations-v2-fixture.test.ts && pnpm lint && pnpm typecheck && pnpm format:check` (lint: only the three known `il-*.js` errors).

```bash
git add apps/web/.prettierignore apps/web/scripts/citations-fixture.mjs apps/web/src/mocks/fixtures/citations-v2.json apps/web/src/mocks/citations-v2-shape.ts apps/web/src/mocks/citations-v2-fixture.ts apps/web/src/mocks/citations-v2-fixture.test.ts
git commit -m "WP-77: fixture script and Citations v2 fixture"
```

---

### Task 2: Mock model and the five MSW routes

Brief step 1 (second half); section 4 "MSW"; section 5.1 and 5.2. Parity rows: every number the screen shows comes through here.

**Files:**
- Create: `apps/web/src/mocks/handlers/citations-v2-model.ts` (pure counting over the fixture, mapped onto the requesting project)
- Create: `apps/web/src/mocks/handlers/citations-v2.ts` (the five routes: request checks in the API's order, then the model)
- Modify: `apps/web/src/mocks/handlers/index.ts` (register `citationBoardHandlers` after `citationDetailHandlers`, with the comment `// WP-77 citations-v2`) [lease]
- Modify: `apps/web/src/mocks/respond.ts` (one entry in `PROBLEMS`: `competitor_not_tracked: [422, 'Competitor is not tracked'],` after `competitor_limit`) [lease]
- Test: `apps/web/src/mocks/handlers/citations-v2-model.test.ts`, `apps/web/src/mocks/handlers/citations-v2.test.ts`

Design:
- **Mapping onto the project.** The mock projects are not the preview's CRM world. The model keeps every count and maps names by position onto the project that asks (`ProjectCaller.world`): the own pages get the project's `primary_domain` host, competitor `i` of the fixture is the project's `i`-th tracked competitor in role order (its entity id, name, color index and first registrable domain; Fynix has five, with color indexes 2 to 6, the preview's `chart-2` to `chart-6`), and topic `i` of the fixture is the project's topic term `i mod T` (Fynix has six topic terms). A project with no topic term gets `topic: null` on every prompt, which is how D-10 is seen under mocks. None of this changes a count: a domain stays one domain, so `expected` holds for Fynix. Open point 4.
- **Windows.** `current` is slots 1 to `runs`, `previous` slots `runs + 1` to `2 * runs`, `trend` slots 8 to 1 that hold answers (WP-76 `RunWindow`).
- **Validation order** as `handlers/citations.ts`: `401`, `404` (workspace or project), `403` (`data:read`), then `422 validation_failed` for an unknown parameter or a bad value, then `422 competitor_not_tracked` with `entity_ids`, then `404` for a page that no current answer cites or a prompt with no current answer.
- **Lists.** `cited-pages`: one role at most, `q` at most 200 characters (case ignored, part of the address or the title), `sort` one of the generated `pathsApiV1WorkspacesWorkspace_idProjectsProject_idAiCitedPagesGetParametersQuerySortValues`, ties by most citations then the address, `offset` and `limit` through `offsetPaging` of `./rules` (default 50, at most 200). `meta.owners` counts every role whatever the role filter and `q`; `meta.citations` sums the kept rows. `top_prompts` holds the ten most cited prompts (the popover's list, C 428). `citation-gaps`: the rows of prompts with an answer, sorted by gap, then `lost_to`, then competitor answers, then text.

- [ ] **Step 1: Write the failing model test**

`apps/web/src/mocks/handlers/citations-v2-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  boardOf,
  citedPageOf,
  citedPagesOf,
  gapOf,
  gapsOf,
  overviewOf,
  windowOf,
  type BoardScope,
  type BoardWorld,
} from './citations-v2-model';
import { CITATIONS_FIXTURE, type FixtureExpected } from '../citations-v2-fixture';
import { equalWeightAverage } from '@/lib/stats';

/** A world with the preview's own names: five competitors, the thirteen topics, the own domain. */
const WORLD: BoardWorld = {
  ownHost: CITATIONS_FIXTURE.ownDomain,
  timezone: 'Europe/Berlin',
  competitors: CITATIONS_FIXTURE.competitors.map((competitor, index) => ({
    entityId: `0192d1a8-c0de-7000-8000-00000000000${String(index + 1)}`,
    name: competitor.name,
    colorIndex: index + 2,
    domain: competitor.domain,
  })),
  topics: CITATIONS_FIXTURE.topics.map((name, index) => ({
    termId: `0192d1a8-7e57-7000-8000-${String(index + 1).padStart(12, '0')}`,
    name,
  })),
};
const BOARD = boardOf(CITATIONS_FIXTURE, WORLD);
const DEFAULT = WORLD.competitors.slice(0, 3).map((competitor) => competitor.entityId);
const scopeOf = (engines: BoardScope['engines'], runs: BoardScope['runs'] = 4): BoardScope => ({
  runs,
  engines,
  termIds: null,
});

/** What the strip shows for `expected`, from the overview the route answers. */
function stripOf(expected: FixtureExpected): void {
  const overview = overviewOf(BOARD, scopeOf(expected.engines));
  const rate = (field: 'answers' | 'prompts') =>
    equalWeightAverage(
      overview.engines.map((engine) =>
        engine[field] === 0 ? null : engine[field === 'answers' ? 'answers_citing' : 'prompts_citing'] / engine[field],
      ),
    );
  expect(overview.citations).toBe(expected.strip.citations);
  expect(overview.previous_citations).toBe(expected.strip.previousCitations);
  expect(overview.own_urls).toBe(expected.strip.urls);
  expect(overview.previous_own_urls).toBe(expected.strip.previousUrls);
  expect(overview.domains).toBe(expected.strip.domains);
  expect(overview.previous_domains).toBe(expected.strip.previousDomains);
  expect(overview.window.answers).toBe(expected.strip.answers);
  expect(overview.window.prompts).toBe(expected.strip.prompts);
  expect(rate('answers').value).toBeCloseTo(expected.strip.frequency ?? Number.NaN, 12);
  expect(rate('prompts').value).toBeCloseTo(expected.strip.coverage ?? Number.NaN, 12);
}

describe('the Citations v2 mock model', () => {
  it.each([
    ['ChatGPT', CITATIONS_FIXTURE.expected.chatgpt],
    ['ChatGPT and Gemini', CITATIONS_FIXTURE.expected.enabled],
    ['all three engines', CITATIONS_FIXTURE.expected.three],
  ])('answers the preview strip for %s', (_, expected) => {
    stripOf(expected);
  });

  it.each([
    ['ChatGPT', CITATIONS_FIXTURE.expected.chatgpt],
    ['all three engines', CITATIONS_FIXTURE.expected.three],
  ])('counts the cited pages of each owner and the top own page for %s', (_, expected) => {
    const scope = scopeOf(expected.engines);
    const all = citedPagesOf(BOARD, scope, { role: null, q: '', sort: '-citations', offset: 0, limit: 200 });
    expect(all.meta.owners).toEqual({
      own: expected.pages.own,
      competitor: expected.pages.competitor,
      third_party: expected.pages.third_party,
      all: expected.pages.all,
    });
    const own = citedPagesOf(BOARD, scope, { role: 'own', q: '', sort: '-citations', offset: 0, limit: 200 });
    expect(own.page.total).toBe(expected.pages.own);
    expect(own.meta.citations).toBe(expected.strip.citations);
    expect(own.data[0]).toMatchObject({
      path: expected.pages.topOwn.path,
      citations: expected.pages.topOwn.citations,
      prompts: expected.pages.topOwn.prompts,
    });
  });

  it.each([
    ['ChatGPT', CITATIONS_FIXTURE.expected.chatgpt],
    ['ChatGPT and Gemini', CITATIONS_FIXTURE.expected.enabled],
    ['all three engines', CITATIONS_FIXTURE.expected.three],
  ])('finds the preview gaps for %s at the default competitors', (_, expected) => {
    const list = gapsOf(BOARD, scopeOf(expected.engines), DEFAULT);
    expect(list.meta.prompts).toBe(expected.gaps.prompts);
    expect(list.meta.gaps).toBe(expected.gaps.gaps);
    expect(list.data[0]?.text).toBe(expected.gaps.first);
    expect(list.meta.competitors.map((competitor) => competitor.name)).toEqual(['HubSpot', 'Pipedrive', 'Salesforce']);
  });

  it('numbers the slots: four current, four previous, eight in the trend, oldest first', () => {
    const window = windowOf(BOARD, scopeOf(['chatgpt_web']));
    expect(window.current.map((slot) => slot.slot)).toEqual([1, 2, 3, 4]);
    expect(window.previous.map((slot) => slot.slot)).toEqual([5, 6, 7, 8]);
    expect(window.trend.map((slot) => slot.slot)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(window.latest_answer_at).toBe('2026-09-28T00:10:00.000Z');
    expect(window.latest_run_number).toBe(48);
    expect(windowOf(BOARD, scopeOf(['chatgpt_web'], 1)).previous.map((slot) => slot.slot)).toEqual([2]);
  });

  it('pages, filters by role and by text, and sorts with the address as the last tie', () => {
    const scope = scopeOf(['chatgpt_web']);
    const first = citedPagesOf(BOARD, scope, { role: null, q: '', sort: '-citations', offset: 0, limit: 50 });
    const second = citedPagesOf(BOARD, scope, { role: null, q: '', sort: '-citations', offset: 50, limit: 50 });
    expect(first.data).toHaveLength(50);
    expect(first.page).toEqual({ offset: 0, limit: 50, total: CITATIONS_FIXTURE.expected.chatgpt.pages.all });
    expect(new Set([...first.data, ...second.data].map((row) => row.url_id)).size).toBe(100);
    const g2 = citedPagesOf(BOARD, scope, { role: 'third_party', q: 'G2.COM', sort: 'page', offset: 0, limit: 200 });
    expect(g2.data.every((row) => row.host === 'g2.com')).toBe(true);
    expect(g2.meta.owners.all).toBe(CITATIONS_FIXTURE.expected.chatgpt.pages.all);
    const urls = g2.data.map((row) => row.url);
    expect(urls).toEqual([...urls].sort((a, b) => a.localeCompare(b)));
  });

  it('opens a cited page with its prompts and the domains cited beside it, once per answer', () => {
    const scope = scopeOf(['chatgpt_web']);
    const top = citedPagesOf(BOARD, scope, { role: 'own', q: '', sort: '-citations', offset: 0, limit: 1 }).data[0];
    if (top === undefined) throw new Error('No own page is cited');
    const detail = citedPageOf(BOARD, scope, top.url_id);
    expect(detail?.prompts).toHaveLength(top.prompts);
    expect(detail?.prompts.reduce((sum, prompt) => sum + prompt.cited, 0)).toBe(top.citations);
    for (const domain of detail?.alongside ?? []) expect(domain.answers).toBeLessThanOrEqual(top.citations);
    expect(citedPageOf(BOARD, scope, 999_999)).toBeNull();
  });

  it('opens a gap prompt with competitor pages, and returns nothing for a prompt it does not have', () => {
    const scope = scopeOf(['chatgpt_web']);
    const gap = gapsOf(BOARD, scope, DEFAULT).data.find((row) => row.gap > 0);
    if (gap === undefined) throw new Error('No gap');
    const detail = gapOf(BOARD, scope, DEFAULT, gap.prompt_id);
    expect(detail?.competitor_pages.length).toBeGreaterThan(0);
    expect(detail?.third_party_pages.length).toBeLessThanOrEqual(5);
    expect(gapOf(BOARD, scope, DEFAULT, '0192d1a8-c177-7000-8000-999999999999')).toBeNull();
  });

  it('gives a prompt no topic in a project without topic terms (D-10)', () => {
    const bare = boardOf(CITATIONS_FIXTURE, { ...WORLD, topics: [] });
    expect(gapsOf(bare, scopeOf(['chatgpt_web']), DEFAULT).data.every((row) => row.topic === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/web && pnpm vitest run src/mocks/handlers/citations-v2-model.test.ts`
Expected: FAIL, `Failed to resolve import "./citations-v2-model"`.

- [ ] **Step 3: Write the model**

`apps/web/src/mocks/handlers/citations-v2-model.ts`:

```ts
import type { CitationsFixture } from '../citations-v2-fixture';
import type { paths } from '@/lib/api/schema';
import type { Schemas } from '@/lib/api/types';

/**
 * WP-77: the counting behind the five Citations routes (WP-76, docs/19 "As built (AI visibility WP-76 ...)") over the
 * preview's answers (./../citations-v2-fixture.ts), with the preview's names mapped onto the project that asks. Pure:
 * the handlers (./citations-v2.ts) check the request and call these.
 */

type EngineCode = Schemas['EngineCode'];
type DomainRole = Schemas['CitedPageRow']['domain_role'];
type BrandState = Schemas['BrandCell']['state'];
type CitedPageRow = Schemas['CitedPageRow'];
type RunSlot = Schemas['RunSlot'];
type GapPage = Schemas['GapPage'];

export type RunsChoice = 1 | 2 | 4;

export interface BoardCompetitor {
  entityId: string;
  name: string;
  colorIndex: number | null;
  domain: string | null;
}

export interface BoardTopic {
  termId: string;
  name: string;
}

/** What the model needs of the project that asks. */
export interface BoardWorld {
  ownHost: string;
  timezone: string;
  /** The tracked competitors in role order: fixture competitor `i` is the `i`-th. */
  competitors: readonly BoardCompetitor[];
  /** The project's topic terms: fixture topic `i` is term `i mod length`. */
  topics: readonly BoardTopic[];
}

interface BoardPage {
  urlId: number;
  url: string;
  host: string;
  path: string;
  title: string;
  role: DomainRole;
  /** The fixture competitor's position, for a competitor page. */
  position: number | null;
  competitor: BoardCompetitor | null;
}

interface BoardPrompt {
  index: number;
  id: string;
  text: string;
  topic: BoardTopic | null;
}

interface BoardAnswer {
  prompt: BoardPrompt;
  engine: EngineCode;
  slot: number;
  at: string;
  mentioned: boolean;
  pages: readonly BoardPage[];
  rivals: readonly number[];
}

export interface Board {
  world: BoardWorld;
  pages: readonly BoardPage[];
  answers: readonly BoardAnswer[];
  latestRunNumber: number;
}

export interface BoardScope {
  runs: RunsChoice;
  /** In code order. */
  engines: readonly EngineCode[];
  /** The term asked for and those under it; `null` for every prompt. */
  termIds: ReadonlySet<string> | null;
}

type CitedPagesQuery = NonNullable<
  paths['/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/cited-pages']['get']['parameters']['query']
>;
export type CitedPagesSort = NonNullable<CitedPagesQuery['sort']>;

export interface PageListQuery {
  role: DomainRole | null;
  q: string;
  sort: CitedPagesSort;
  offset: number;
  limit: number;
}

/** The most prompts a page row lists (the prompts popover shows ten, C 428). */
const TOP_PROMPTS = 10;
/** The third-party pages of the gap drawer (D 445) and the closest own pages (D 447). */
const THIRD_PAGES = 5;
const CLOSEST_PAGES = 3;
/** The domains of "Cited alongside" (D 336). */
const ALONGSIDE = 8;

export function boardOf(fixture: CitationsFixture, world: BoardWorld): Board {
  const pages = fixture.urls.map((url, index): BoardPage => {
    const competitor = url.competitor === null ? null : (world.competitors[url.competitor] ?? null);
    const host =
      url.role === 'own' ? world.ownHost : url.role === 'competitor' ? (competitor?.domain ?? url.domain) : url.domain;
    return {
      urlId: index + 1,
      url: `https://${host}${url.path}`,
      host,
      path: url.path,
      title: url.title,
      role: url.role,
      position: url.competitor,
      competitor,
    };
  });
  const prompts = fixture.prompts.map(
    (prompt, index): BoardPrompt => ({
      index,
      id: prompt.id,
      text: prompt.text,
      topic: world.topics.length === 0 ? null : (world.topics[prompt.topic % world.topics.length] ?? null),
    }),
  );
  const answers = fixture.answers.flatMap(([promptIndex, engineIndex, slot, mentioned, urls, rivals]): BoardAnswer[] => {
    const prompt = prompts[promptIndex];
    const engine = fixture.engines[engineIndex];
    const at = fixture.slots[slot - 1];
    if (prompt === undefined || engine === undefined || at === undefined) return [];
    return [
      {
        prompt,
        engine,
        slot,
        at: at[engine],
        mentioned: mentioned === 1,
        pages: urls.flatMap((url) => pages[url] ?? []),
        rivals,
      },
    ];
  });
  return { world, pages, answers, latestRunNumber: fixture.latestRunNumber };
}

// -------------------------------------------------------------------------------------------------
// Windows

type Period = 'current' | 'previous' | 'trend';

function answersOf(board: Board, scope: BoardScope, period: Period): BoardAnswer[] {
  return board.answers.filter(
    (answer) =>
      scope.engines.includes(answer.engine) &&
      (scope.termIds === null || (answer.prompt.topic !== null && scope.termIds.has(answer.prompt.topic.termId))) &&
      (period === 'trend' ||
        (period === 'current' ? answer.slot <= scope.runs : answer.slot > scope.runs && answer.slot <= 2 * scope.runs)),
  );
}

const between = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function slotOf(answers: readonly BoardAnswer[], slot: number): RunSlot | null {
  const times = answers
    .filter((answer) => answer.slot === slot)
    .map((answer) => answer.at)
    .sort();
  const first = times[0];
  const last = times[times.length - 1];
  return first === undefined || last === undefined ? null : { slot, first_at: first, last_at: last, answers: times.length };
}

export function windowOf(board: Board, scope: BoardScope): Schemas['RunWindow'] {
  const all = answersOf(board, scope, 'trend');
  const slots = (numbers: readonly number[]): RunSlot[] => numbers.flatMap((slot) => slotOf(all, slot) ?? []);
  const now = answersOf(board, scope, 'current');
  const latest = now.map((answer) => answer.at).sort()[now.length - 1] ?? null;
  return {
    runs: scope.runs,
    timezone: board.world.timezone,
    current: slots(between(1, scope.runs)),
    previous: slots(between(scope.runs + 1, 2 * scope.runs)),
    trend: slots(between(1, 8).reverse()),
    answers: now.length,
    prompts: new Set(now.map((answer) => answer.prompt.index)).size,
    latest_answer_at: latest,
    latest_run_number: latest === null ? null : board.latestRunNumber,
  };
}

// -------------------------------------------------------------------------------------------------
// Overview

const isOwn = (page: BoardPage): boolean => page.role === 'own';
const citesOwn = (answer: BoardAnswer): boolean => answer.pages.some(isOwn);
const ownUnits = (answers: readonly BoardAnswer[]): number =>
  answers.reduce((sum, answer) => sum + answer.pages.filter(isOwn).length, 0);
const distinct = (values: readonly (string | number)[]): number => new Set(values).size;
const pairOf = (answer: BoardAnswer): string => `${String(answer.prompt.index)}|${answer.engine}`;

export function overviewOf(board: Board, scope: BoardScope): Schemas['CitationOverview'] {
  const now = answersOf(board, scope, 'current');
  const before = answersOf(board, scope, 'previous');
  const beforePairs = new Set(before.map(pairOf));
  const both = new Set(now.map(pairOf).filter((pair) => beforePairs.has(pair)));
  const matched = (answers: readonly BoardAnswer[]): BoardAnswer[] => answers.filter((answer) => both.has(pairOf(answer)));
  const ownUrls = (answers: readonly BoardAnswer[]): number =>
    distinct(answers.flatMap((answer) => answer.pages.filter(isOwn).map((page) => page.urlId)));
  const domains = (answers: readonly BoardAnswer[]): number =>
    distinct(answers.flatMap((answer) => answer.pages.map((page) => page.host)));
  const promptsOf = (answers: readonly BoardAnswer[]): number => distinct(answers.map((answer) => answer.prompt.index));
  return {
    citations: ownUnits(now),
    previous_citations: ownUnits(before),
    matched_citations: ownUnits(matched(now)),
    matched_previous_citations: ownUnits(matched(before)),
    matched_pairs: both.size,
    own_urls: ownUrls(now),
    previous_own_urls: ownUrls(before),
    domains: domains(now),
    previous_domains: domains(before),
    engines: scope.engines.map((code) => {
      const current = now.filter((answer) => answer.engine === code);
      const previous = before.filter((answer) => answer.engine === code);
      return {
        engine_code: code,
        answers: current.length,
        answers_citing: current.filter(citesOwn).length,
        prompts: promptsOf(current),
        prompts_citing: promptsOf(current.filter(citesOwn)),
        previous_answers: previous.length,
        previous_answers_citing: previous.filter(citesOwn).length,
        previous_prompts: promptsOf(previous),
        previous_prompts_citing: promptsOf(previous.filter(citesOwn)),
      };
    }),
    window: windowOf(board, scope),
  };
}

// -------------------------------------------------------------------------------------------------
// Cited pages

interface PageTally {
  page: BoardPage;
  citations: number;
  previous: number;
  prompts: Map<number, { prompt: BoardPrompt; citations: number }>;
  engines: Map<EngineCode, number>;
  last: string;
  trend: Map<number, number>;
}

function pageRowsOf(board: Board, scope: BoardScope): CitedPageRow[] {
  const tallies = new Map<number, PageTally>();
  for (const answer of answersOf(board, scope, 'current')) {
    for (const page of answer.pages) {
      const tally = tallies.get(page.urlId) ?? {
        page,
        citations: 0,
        previous: 0,
        prompts: new Map(),
        engines: new Map(),
        last: '',
        trend: new Map(),
      };
      tally.citations += 1;
      const prompt = tally.prompts.get(answer.prompt.index) ?? { prompt: answer.prompt, citations: 0 };
      prompt.citations += 1;
      tally.prompts.set(answer.prompt.index, prompt);
      tally.engines.set(answer.engine, (tally.engines.get(answer.engine) ?? 0) + 1);
      if (answer.at > tally.last) tally.last = answer.at;
      tallies.set(page.urlId, tally);
    }
  }
  for (const answer of answersOf(board, scope, 'previous')) {
    for (const page of answer.pages) {
      const tally = tallies.get(page.urlId);
      if (tally !== undefined) tally.previous += 1;
    }
  }
  for (const answer of answersOf(board, scope, 'trend')) {
    for (const page of answer.pages) {
      const tally = tallies.get(page.urlId);
      if (tally !== undefined) tally.trend.set(answer.slot, (tally.trend.get(answer.slot) ?? 0) + 1);
    }
  }
  const slots = windowOf(board, scope).trend.map((slot) => slot.slot);
  return [...tallies.values()].map(
    (tally): CitedPageRow => ({
      url_id: tally.page.urlId,
      url: tally.page.url,
      host: tally.page.host,
      path: tally.page.path,
      registrable_domain: tally.page.host,
      title: tally.page.title,
      domain_role: tally.page.role,
      entity_id: tally.page.competitor?.entityId ?? null,
      entity_name: tally.page.competitor?.name ?? null,
      color_index: tally.page.competitor?.colorIndex ?? null,
      citations: tally.citations,
      previous_citations: tally.previous,
      prompts: tally.prompts.size,
      top_prompts: [...tally.prompts.values()]
        .sort((a, b) => b.citations - a.citations || a.prompt.text.localeCompare(b.prompt.text))
        .slice(0, TOP_PROMPTS)
        .map((entry) => ({ prompt_id: entry.prompt.id, text: entry.prompt.text, citations: entry.citations })),
      engines: scope.engines.map((code) => ({ engine_code: code, citation_units: tally.engines.get(code) ?? 0 })),
      trend: slots.map((slot) => tally.trend.get(slot) ?? 0),
      last_cited_at: tally.last,
    }),
  );
}

function sortValue(key: string, row: CitedPageRow): number | string {
  switch (key) {
    case 'change':
      return row.citations - row.previous_citations;
    case 'prompts':
      return row.prompts;
    case 'last_cited':
      return row.last_cited_at;
    case 'page':
      return row.url;
    default:
      return row.citations;
  }
}

const compareValues = (x: number | string, y: number | string): number =>
  typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));

export function citedPagesOf(board: Board, scope: BoardScope, query: PageListQuery): Schemas['CitedPagePage'] {
  const rows = pageRowsOf(board, scope);
  const needle = query.q.toLowerCase();
  const kept = rows.filter(
    (row) =>
      (query.role === null || row.domain_role === query.role) &&
      (needle === '' || row.url.toLowerCase().includes(needle) || (row.title ?? '').toLowerCase().includes(needle)),
  );
  const desc = query.sort.startsWith('-');
  const key = desc ? query.sort.slice(1) : query.sort;
  kept.sort((a, b) => {
    const order = compareValues(sortValue(key, a), sortValue(key, b));
    return (desc ? -order : order) || b.citations - a.citations || a.url.localeCompare(b.url);
  });
  const count = (role: DomainRole): number => rows.filter((row) => row.domain_role === role).length;
  return {
    data: kept.slice(query.offset, query.offset + query.limit),
    meta: {
      citations: kept.reduce((sum, row) => sum + row.citations, 0),
      owners: { own: count('own'), competitor: count('competitor'), third_party: count('third_party'), all: rows.length },
      window: windowOf(board, scope),
    },
    page: { offset: query.offset, limit: query.limit, total: kept.length },
  };
}

export function citedPageOf(board: Board, scope: BoardScope, urlId: number): Schemas['CitedPageDetail'] | null {
  const page = pageRowsOf(board, scope).find((row) => row.url_id === urlId);
  if (page === undefined) return null;
  interface PromptEntry {
    prompt: BoardPrompt;
    answers: number;
    cited: number;
    last: string;
    engines: Map<EngineCode, { answers: number; cited: number }>;
  }
  const byPrompt = new Map<number, PromptEntry>();
  const alongside = new Map<string, { page: BoardPage; answers: number }>();
  for (const answer of answersOf(board, scope, 'current')) {
    const entry = byPrompt.get(answer.prompt.index) ?? {
      prompt: answer.prompt,
      answers: 0,
      cited: 0,
      last: '',
      engines: new Map(),
    };
    const cell = entry.engines.get(answer.engine) ?? { answers: 0, cited: 0 };
    cell.answers += 1;
    entry.answers += 1;
    if (answer.pages.some((candidate) => candidate.urlId === urlId)) {
      cell.cited += 1;
      entry.cited += 1;
      if (answer.at > entry.last) entry.last = answer.at;
      // Once per answer (D-9): a domain with two URLs in one answer is one answer
      const domains = new Map<string, BoardPage>();
      for (const other of answer.pages) {
        if (other.urlId !== urlId && !domains.has(other.host)) domains.set(other.host, other);
      }
      for (const [host, other] of domains) {
        const item = alongside.get(host) ?? { page: other, answers: 0 };
        item.answers += 1;
        alongside.set(host, item);
      }
    }
    entry.engines.set(answer.engine, cell);
    byPrompt.set(answer.prompt.index, entry);
  }
  return {
    page,
    prompts: [...byPrompt.values()]
      .filter((entry) => entry.cited > 0)
      .sort((a, b) => b.cited - a.cited || a.prompt.text.localeCompare(b.prompt.text))
      .map((entry) => ({
        prompt_id: entry.prompt.id,
        text: entry.prompt.text,
        answers: entry.answers,
        cited: entry.cited,
        last_cited_at: entry.last,
        engines: scope.engines.map((code) => ({
          engine_code: code,
          answers: entry.engines.get(code)?.answers ?? 0,
          cited: entry.engines.get(code)?.cited ?? 0,
        })),
      })),
    alongside: [...alongside.entries()]
      .sort(([hostA, a], [hostB, b]) => b.answers - a.answers || hostA.localeCompare(hostB))
      .slice(0, ALONGSIDE)
      .map(([host, item]) => ({
        registrable_domain: host,
        domain_role: item.page.role,
        entity_id: item.page.competitor?.entityId ?? null,
        entity_name: item.page.competitor?.name ?? null,
        color_index: item.page.competitor?.colorIndex ?? null,
        answers: item.answers,
      })),
    window: windowOf(board, scope),
  };
}

// -------------------------------------------------------------------------------------------------
// Gap analysis

interface Cell {
  answers: number;
  cited: number;
  mentioned: number;
}

const blank = (): Cell => ({ answers: 0, cited: 0, mentioned: 0 });
const stateOf = (cell: Cell): BrandState =>
  cell.answers === 0 ? 'none' : cell.cited > 0 ? 'cited' : cell.mentioned > 0 ? 'mentioned' : 'not';

function tallyInto(cells: Map<EngineCode, Cell>, engine: EngineCode, cited: boolean, mentioned: boolean): void {
  const cell = cells.get(engine) ?? blank();
  cell.answers += 1;
  if (cited) cell.cited += 1;
  if (mentioned) cell.mentioned += 1;
  cells.set(engine, cell);
}

function brandOf(engines: readonly EngineCode[], cells: ReadonlyMap<EngineCode, Cell>): Schemas['BrandOnPrompt'] {
  const list = engines.map((code) => {
    const cell = cells.get(code) ?? blank();
    return { engine_code: code, ...cell, state: stateOf(cell) };
  });
  const total = list.reduce(
    (sum, cell) => ({
      answers: sum.answers + cell.answers,
      cited: sum.cited + cell.cited,
      mentioned: sum.mentioned + cell.mentioned,
    }),
    blank(),
  );
  return {
    total: { ...total, state: stateOf(total) },
    engines: list,
    platforms: list.filter((cell) => cell.answers > 0).length,
    cited_on: list.filter((cell) => cell.cited > 0).length,
  };
}

const positionsOf = (board: Board, ids: readonly string[]): number[] =>
  ids.map((id) => board.world.competitors.findIndex((competitor) => competitor.entityId === id));

export function gapRowsOf(board: Board, scope: BoardScope, ids: readonly string[]): Schemas['CitationGapRow'][] {
  const positions = positionsOf(board, ids);
  const tallies = new Map<number, { prompt: BoardPrompt; you: Map<EngineCode, Cell>; rivals: Map<EngineCode, Cell>[] }>();
  for (const answer of answersOf(board, scope, 'current')) {
    const tally = tallies.get(answer.prompt.index) ?? {
      prompt: answer.prompt,
      you: new Map<EngineCode, Cell>(),
      rivals: ids.map(() => new Map<EngineCode, Cell>()),
    };
    tallyInto(tally.you, answer.engine, citesOwn(answer), answer.mentioned);
    positions.forEach((position, index) => {
      const flag = answer.rivals[position] ?? 0;
      const target = tally.rivals[index];
      if (target !== undefined) tallyInto(target, answer.engine, flag === 2, flag >= 1);
    });
    tallies.set(answer.prompt.index, tally);
  }
  const rows = [...tallies.values()].map((tally): Schemas['CitationGapRow'] => {
    const you = brandOf(scope.engines, tally.you);
    const competitors = ids.map((id, index) => ({ entity_id: id, ...brandOf(scope.engines, tally.rivals[index] ?? new Map()) }));
    // Decided per engine: answers there, none cites you, a selected competitor is cited there (D 386)
    const lostOn = scope.engines.filter((code) => {
      const mine = tally.you.get(code);
      return (
        mine !== undefined &&
        mine.answers > 0 &&
        mine.cited === 0 &&
        tally.rivals.some((cells) => (cells.get(code)?.cited ?? 0) > 0)
      );
    });
    return {
      prompt_id: tally.prompt.id,
      text: tally.prompt.text,
      topic: tally.prompt.topic === null ? null : { term_id: tally.prompt.topic.termId, name: tally.prompt.topic.name },
      you,
      competitors,
      gap: lostOn.length,
      lost_on: lostOn,
      lost_to: ids.filter((_, index) => lostOn.some((code) => (tally.rivals[index]?.get(code)?.cited ?? 0) > 0)),
      competitor_answers: competitors.reduce((sum, competitor) => sum + competitor.total.cited, 0),
    };
  });
  return rows
    .filter((row) => row.you.total.answers > 0)
    .sort(
      (a, b) =>
        b.gap - a.gap ||
        b.lost_to.length - a.lost_to.length ||
        b.competitor_answers - a.competitor_answers ||
        a.text.localeCompare(b.text),
    );
}

export function gapsOf(board: Board, scope: BoardScope, ids: readonly string[]): Schemas['CitationGapList'] {
  const rows = gapRowsOf(board, scope, ids);
  return {
    data: rows,
    meta: {
      competitors: ids.flatMap((id) => {
        const competitor = board.world.competitors.find((candidate) => candidate.entityId === id);
        return competitor === undefined
          ? []
          : [{ entity_id: id, name: competitor.name, color_index: competitor.colorIndex, domain: competitor.domain }];
      }),
      gaps: rows.filter((row) => row.gap > 0).length,
      prompts: rows.length,
      window: windowOf(board, scope),
    },
  };
}

function pagesOf(
  answers: readonly BoardAnswer[],
  engines: readonly EngineCode[],
  keep: (page: BoardPage, answer: BoardAnswer) => boolean,
): GapPage[] {
  const tallies = new Map<number, { page: BoardPage; citations: number; engines: Set<EngineCode> }>();
  for (const answer of answers) {
    for (const page of answer.pages) {
      if (!keep(page, answer)) continue;
      const tally = tallies.get(page.urlId) ?? { page, citations: 0, engines: new Set<EngineCode>() };
      tally.citations += 1;
      tally.engines.add(answer.engine);
      tallies.set(page.urlId, tally);
    }
  }
  return [...tallies.values()]
    .sort((a, b) => b.citations - a.citations || a.page.url.localeCompare(b.page.url))
    .map((tally) => ({
      url_id: tally.page.urlId,
      url: tally.page.url,
      entity_id: tally.page.competitor?.entityId ?? null,
      citations: tally.citations,
      engines: engines.filter((code) => tally.engines.has(code)),
    }));
}

export function gapOf(
  board: Board,
  scope: BoardScope,
  ids: readonly string[],
  promptId: string,
): Schemas['CitationGapDetail'] | null {
  const row = gapRowsOf(board, scope, ids).find((candidate) => candidate.prompt_id === promptId);
  if (row === undefined) return null;
  const now = answersOf(board, scope, 'current');
  const mine = now.filter((answer) => answer.prompt.id === promptId);
  const selected = new Set(positionsOf(board, ids));
  const topic = row.topic;
  return {
    row,
    answers: mine.length,
    competitor_pages: pagesOf(
      mine,
      scope.engines,
      (page, answer) =>
        page.role === 'competitor' &&
        page.position !== null &&
        selected.has(page.position) &&
        answer.rivals[page.position] === 2,
    ),
    own_pages: pagesOf(mine, scope.engines, isOwn),
    third_party_pages: pagesOf(mine, scope.engines, (page) => page.role === 'third_party').slice(0, THIRD_PAGES),
    // The own pages cited for the other prompts that share its topic term, the ones to improve first (D 434)
    closest_pages:
      topic === null
        ? []
        : pagesOf(
            now.filter((answer) => answer.prompt.id !== promptId && answer.prompt.topic?.termId === topic.term_id),
            scope.engines,
            isOwn,
          ).slice(0, CLOSEST_PAGES),
    window: windowOf(board, scope),
  };
}
```

- [ ] **Step 4: Run the model test**

Run: `cd apps/web && pnpm vitest run src/mocks/handlers/citations-v2-model.test.ts`
Expected: PASS, 13 tests. A failing strip or gap number means the model and the preview count differently: fix the model, never `expected`.

- [ ] **Step 5: Write the failing route test**

`apps/web/src/mocks/handlers/citations-v2.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CITATIONS_FIXTURE } from '../citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { mockBrowser } from '@/test/mock-api';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const ENTITY = z.object({ entity: z.object({ entity_id: z.string() }) });

async function competitorIds(): Promise<string[]> {
  const answer = await mockBrowser('viewer').call('GET', `${P}/entities?filter[role]=competitor`);
  return z.array(ENTITY).parse(answer.body.data).map((row) => row.entity.entity_id);
}

describe('the Citations v2 routes', () => {
  it('answers the overview of ChatGPT with the preview numbers, on the project own domain', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${P}/ai/citation-overview?filter[engine_code_in]=chatgpt_web`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      citations: CITATIONS_FIXTURE.expected.chatgpt.strip.citations,
      own_urls: CITATIONS_FIXTURE.expected.chatgpt.strip.urls,
      domains: CITATIONS_FIXTURE.expected.chatgpt.strip.domains,
      window: { runs: 4, latest_run_number: 48 },
    });
  });

  it('pages the cited pages, own pages on the project host, with the owner counts of every role', async () => {
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${P}/ai/cited-pages?filter[engine_code_in]=chatgpt_web&filter[domain_role_in]=own&limit=200`,
    );
    expect(answer.status).toBe(200);
    const rows = z.array(z.object({ host: z.string() })).parse(answer.body.data);
    expect(rows.every((row) => row.host === fynix.host)).toBe(true);
    expect(answer.body.meta).toMatchObject({ owners: { all: CITATIONS_FIXTURE.expected.chatgpt.pages.all } });
  });

  it('refuses runs other than 1, 2 or 4, a long q and an unknown sort', async () => {
    const browser = mockBrowser('viewer');
    expect((await browser.call('GET', `${P}/ai/citation-overview?runs=3`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/ai/cited-pages?q=${'a'.repeat(201)}`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/ai/cited-pages?sort=-volume`)).status).toBe(422);
  });

  it('needs one to five tracked competitors for the gap routes', async () => {
    const browser = mockBrowser('viewer');
    const ids = await competitorIds();
    expect((await browser.call('GET', `${P}/ai/citation-gaps`)).status).toBe(422);
    const untracked = await browser.call(
      'GET',
      `${P}/ai/citation-gaps?filter[competitor_id_in]=0192d1a8-dead-7000-8000-000000000001`,
    );
    expect(untracked).toMatchObject({ status: 422, code: 'competitor_not_tracked' });
    const list = await browser.call(
      'GET',
      `${P}/ai/citation-gaps?filter[engine_code_in]=chatgpt_web&filter[competitor_id_in]=${ids.slice(0, 3).join(',')},${ids[0] ?? ''}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({
      gaps: CITATIONS_FIXTURE.expected.chatgpt.gaps.gaps,
      prompts: CITATIONS_FIXTURE.expected.chatgpt.gaps.prompts,
    });
    expect(z.object({ competitors: z.array(z.unknown()) }).parse(list.body.meta).competitors).toHaveLength(3);
  });

  it('answers 404 for a page no answer cites and for a prompt with no answer', async () => {
    const browser = mockBrowser('viewer');
    const ids = await competitorIds();
    expect((await browser.call('GET', `${P}/ai/cited-pages/999999`)).status).toBe(404);
    const gap = await browser.call(
      'GET',
      `${P}/ai/citation-gaps/0192d1a8-c177-7000-8000-999999999999?filter[competitor_id_in]=${ids[0] ?? ''}`,
    );
    expect(gap.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `cd apps/web && pnpm vitest run src/mocks/handlers/citations-v2.test.ts`
Expected: FAIL, the routes answer 404 (no handler; `pendingHandlers` or the catch-all answers).

- [ ] **Step 7: Write the handlers, the problem code and the registration**

`apps/web/src/mocks/handlers/citations-v2.ts`:

```ts
import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { termSubtree } from './citations-model';
import {
  boardOf,
  citedPageOf,
  citedPagesOf,
  gapOf,
  gapsOf,
  overviewOf,
  type Board,
  type BoardScope,
  type BoardWorld,
  type PageListQuery,
  type RunsChoice,
} from './citations-v2-model';
import { booleanQuery, offsetPaging, queryError, unknownQuery, uuidError } from './rules';
import { CITATIONS_FIXTURE } from '../citations-v2-fixture';
import { MOCK_WORKSPACE } from '../fixtures';
import { ENGINE_CODES } from '../prompt-fixtures';
import { invalid, mock, problem } from '../respond';
import {
  citedPageRowDomain_roleValues,
  pathsApiV1WorkspacesWorkspace_idProjectsProject_idAiCitedPagesGetParametersQuerySortValues as CITED_SORTS,
} from '@/lib/api/schema';
import type { EngineCode, Problem, ValidationItem } from '@/lib/api/types';

/**
 * WP-77: the five routes of the Citations page (WP-76; docs/19 "As built (AI visibility WP-76 ...)"), answered from the
 * design preview's answers (./citations-v2-model.ts). The request is checked in the API's order: 401, 404, 403, 422,
 * `competitor_not_tracked`, then the 404 of a page or prompt the window does not have.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const SHARED = [
  'runs',
  'filter[engine_code_in]',
  'filter[term]',
  'include_branded',
  'include_unresolved_redirects',
  'include_engine_internal',
];
const COMPETITORS = 'filter[competitor_id_in]';
const PAGE_LIST = ['filter[domain_role_in]', 'q', 'sort', 'offset', 'limit'];
const MAX_COMPETITORS = 5;
const MAX_QUERY = 200;
const RUNS: readonly RunsChoice[] = [1, 2, 4];

type PathValue = string | readonly string[] | undefined;
type PathParams = Readonly<Partial<Record<'workspace_id' | 'project_id' | 'url_id' | 'prompt_id', PathValue>>>;

const single = (value: PathValue): string => (typeof value === 'string' ? value : '');
const listParam = (url: URL, name: string): string[] =>
  url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');

/** A topic vocabulary the project sees: the workspace's, or the project's own. */
const isProjectTopic = (
  vocabulary: { kind: string; workspace_id?: string | undefined; project_id?: string | null | undefined },
  project: { workspace_id: string; project_id: string },
): boolean =>
  vocabulary.kind === 'topic' &&
  (vocabulary.workspace_id ?? MOCK_WORKSPACE.workspace_id) === project.workspace_id &&
  (vocabulary.project_id === null || vocabulary.project_id === undefined || vocabulary.project_id === project.project_id);

/** The project's world as the model reads it: own host, tracked competitors in role order, topic terms. */
function worldOf(caller: ProjectCaller): BoardWorld {
  const { world, project } = caller;
  const roles = world.roles.filter(
    (role) => role.project_id === project.project_id && (role.removed_at ?? null) === null,
  );
  const competitors = roles
    .filter((role) => role.role === 'competitor')
    .map((role) => ({
      entityId: role.entity_id,
      name: world.entities.find((entity) => entity.entity_id === role.entity_id)?.canonical_name ?? role.entity_id,
      colorIndex: role.color_index ?? null,
      domain:
        world.domains.find((domain) => domain.entity_id === role.entity_id && domain.match_scope !== 'path_prefix')
          ?.host ?? null,
    }));
  const vocabularies = new Set(
    world.vocabularies
      .filter((vocabulary) => isProjectTopic(vocabulary, project))
      .map((vocabulary) => vocabulary.vocabulary_id),
  );
  return {
    ownHost: project.primary_domain?.registrable_domain ?? CITATIONS_FIXTURE.ownDomain,
    timezone: project.timezone,
    competitors,
    topics: world.terms
      .filter((term) => vocabularies.has(term.vocabulary_id))
      .map((term) => ({ termId: term.term_id, name: term.name })),
  };
}

interface Read<T> {
  caller: ProjectCaller;
  board: Board;
  scope: BoardScope;
  own: T;
}

/** The checks every route shares, then the route's own (`own`), which adds its errors to `errors`. */
function readOf<T>(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  params: PathParams,
  allowed: readonly string[],
  own: (url: URL, errors: ValidationItem[], board: Board) => T,
): Read<T> | HttpResponse<Problem> {
  const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
    permission: 'data:read',
    query: [...new Set(new URL(request.url).searchParams.keys())],
  });
  if (caller instanceof Response) return caller;
  const { url } = caller;
  const errors = unknownQuery(url, allowed);
  const rawRuns = url.searchParams.get('runs');
  const runs = rawRuns === null ? 4 : RUNS.find((choice) => String(choice) === rawRuns);
  if (runs === undefined) errors.push(queryError('runs', 'value_error', 'runs is 1, 2 or 4.'));
  const asked = listParam(url, 'filter[engine_code_in]');
  asked.forEach((value, place) => {
    if (!ENGINE_CODES.some((code) => code === value)) {
      errors.push(queryError(`filter[engine_code_in].${String(place)}`, 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`));
    }
  });
  const engines: EngineCode[] = ENGINE_CODES.filter((code) => asked.length === 0 || asked.includes(code));
  const term = url.searchParams.get('filter[term]');
  if (term !== null) {
    errors.push(...uuidError(term, 'filter[term]').map((item) => queryError(item.path, item.code, item.message)));
  }
  for (const flag of ['include_branded', 'include_unresolved_redirects', 'include_engine_internal']) {
    const value = booleanQuery(url, flag, false);
    if (typeof value !== 'boolean') errors.push(value);
  }
  const world = worldOf(caller);
  const board = boardOf(CITATIONS_FIXTURE, world);
  const parsed = own(url, errors, board);
  if (errors.length > 0) return invalid(request, errors);
  const terms = caller.world.terms.filter((candidate) =>
    world.topics.some((topic) => topic.termId === candidate.term_id),
  );
  return {
    caller,
    board,
    scope: { runs: runs ?? 4, engines, termIds: term === null ? null : termSubtree(terms, term) },
    own: parsed,
  };
}

/** `filter[competitor_id_in]`: 1 to 5 ids, repeats dropped and the order kept; each must be tracked. */
function competitorsOf(url: URL, errors: ValidationItem[]): string[] {
  const ids = [...new Set(listParam(url, COMPETITORS))];
  if (ids.length === 0) errors.push(queryError(COMPETITORS, 'missing', 'Field required'));
  if (ids.length > MAX_COMPETITORS) {
    errors.push(queryError(COMPETITORS, 'too_long', `List should have at most ${String(MAX_COMPETITORS)} items.`));
  }
  ids.forEach((id, place) =>
    errors.push(
      ...uuidError(id, `${COMPETITORS}.${String(place)}`).map((item) => queryError(item.path, item.code, item.message)),
    ),
  );
  return ids;
}

function untracked(request: Request, board: Board, ids: readonly string[]): HttpResponse<Problem> | null {
  const unknown = ids.filter((id) => !board.world.competitors.some((competitor) => competitor.entityId === id));
  return unknown.length === 0
    ? null
    : problem(request, 'competitor_not_tracked', {
        detail: 'Every competitor must be one the project tracks.',
        entity_ids: unknown,
      });
}

function pageListOf(url: URL, errors: ValidationItem[]): PageListQuery {
  const role = url.searchParams.get('filter[domain_role_in]');
  const knownRole = citedPageRowDomain_roleValues.find((value) => value === role) ?? null;
  if (role !== null && knownRole === null) {
    errors.push(queryError('filter[domain_role_in]', 'enum', `Allowed: ${citedPageRowDomain_roleValues.join(', ')}.`));
  }
  const q = url.searchParams.get('q') ?? '';
  if (q.length > MAX_QUERY) {
    errors.push(queryError('q', 'string_too_long', `String should have at most ${String(MAX_QUERY)} characters`));
  }
  const rawSort = url.searchParams.get('sort');
  const sort = CITED_SORTS.find((value) => value === rawSort) ?? '-citations';
  if (rawSort !== null && !CITED_SORTS.some((value) => value === rawSort)) {
    errors.push(queryError('sort', 'enum', `Allowed: ${CITED_SORTS.join(', ')}.`));
  }
  const paging = offsetPaging(url);
  if (Array.isArray(paging)) errors.push(...paging);
  return {
    role: knownRole,
    q: q.trim(),
    sort,
    ...(Array.isArray(paging) ? { offset: 0, limit: 50 } : paging),
  };
}

export const citationBoardHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/citation-overview`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, SHARED, () => null);
    if (read instanceof Response) return read;
    return HttpResponse.json(overviewOf(read.board, read.scope));
  }),

  mock('get', `${P}/ai/cited-pages`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, [...SHARED, ...PAGE_LIST], pageListOf);
    if (read instanceof Response) return read;
    return HttpResponse.json(citedPagesOf(read.board, read.scope, read.own));
  }),

  mock('get', `${P}/ai/cited-pages/{url_id}`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, SHARED, (_, errors) => {
      const raw = single(params.url_id);
      const id = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id)) {
        errors.push(queryError('url_id', 'int_parsing', 'Input should be a valid integer'));
      }
      return id;
    });
    if (read instanceof Response) return read;
    const detail = citedPageOf(read.board, read.scope, read.own);
    return detail === null
      ? problem(request, 'not_found', { detail: 'No answer of the window cites this page.' })
      : HttpResponse.json(detail);
  }),

  mock('get', `${P}/ai/citation-gaps`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, [...SHARED, COMPETITORS], competitorsOf);
    if (read instanceof Response) return read;
    return untracked(request, read.board, read.own) ?? HttpResponse.json(gapsOf(read.board, read.scope, read.own));
  }),

  mock('get', `${P}/ai/citation-gaps/{prompt_id}`, ({ request, cookies, params }) => {
    const promptId = single(params.prompt_id);
    const read = readOf(request, cookies, params, [...SHARED, COMPETITORS], (url, errors) => {
      errors.push(...uuidError(promptId, 'prompt_id').map((item) => queryError(item.path, item.code, item.message)));
      return competitorsOf(url, errors);
    });
    if (read instanceof Response) return read;
    const refused = untracked(request, read.board, read.own);
    if (refused !== null) return refused;
    const detail = gapOf(read.board, read.scope, read.own, promptId);
    return detail === null
      ? problem(request, 'not_found', { detail: 'The prompt has no answer in the window.' })
      : HttpResponse.json(detail);
  }),
];
```

`MockBody` types the resolvers against the generated responses, so a field the model leaves out fails `pnpm typecheck`. `Project.workspace_id` exists on the generated `Project` (the mock's `caller.project`).

In `apps/web/src/mocks/respond.ts`, add to `PROBLEMS` after `competitor_limit`:

```ts
  competitor_not_tracked: [422, 'Competitor is not tracked'],
```

In `apps/web/src/mocks/handlers/index.ts`, import `citationBoardHandlers` from `./citations-v2` after the `citationDetailHandlers` import (comment `// WP-77 citations-v2`), and spread it after `...citationDetailHandlers,` with the same comment.

- [ ] **Step 8: Run both tests and the handler suite**

Run: `cd apps/web && pnpm vitest run src/mocks`
Expected: PASS: the two new files and every existing mock test (the new handlers sit before `pendingHandlers`, which stays last in `handlers/index.ts`).

- [ ] **Step 9: Checks and commit**

Run: `cd apps/web && pnpm prettier --write src/mocks/handlers/citations-v2*.ts src/mocks/respond.ts src/mocks/handlers/index.ts && pnpm lint && pnpm typecheck && pnpm format:check`

```bash
git add apps/web/src/mocks/handlers/citations-v2-model.ts apps/web/src/mocks/handlers/citations-v2-model.test.ts apps/web/src/mocks/handlers/citations-v2.ts apps/web/src/mocks/handlers/citations-v2.test.ts apps/web/src/mocks/handlers/index.ts apps/web/src/mocks/respond.ts
git commit -m "WP-77: mock the five Citations v2 routes from the preview fixture"
```

---

### Task 3: Query wrappers, URL state, words and the message tree

Brief step 2. Parity rows: 3.1 "Query keys" (C 40 to 66), "Leaving the page" (C 720 to 724: Next.js drops the query on navigation; nothing to build, the e2e checks it), 3.2 "Runs select" notes (C 116), 3.3 `<previous text>` (C 99 to 104) and `<scope text>` (C 106 to 108), 3.4 "Counted nouns" (`plural()`, `prompts-parts.js` line 16).

**Files:**
- Create: `apps/web/src/lib/citations/board-queries.ts`, `apps/web/src/lib/citations/board-queries.test.ts`
- Create: `apps/web/src/features/citations/board-state.ts`, `board-state.test.ts`
- Create: `apps/web/src/features/citations/board-text.ts`, `board-text.test.ts`
- Create: `apps/web/src/features/citations/board-reads.ts`, `board-reads.test.tsx`
- Modify: `apps/web/messages/en.json` (add the subtrees below inside `citations`, after `inspectors`; keep every old key) [lease]

- [ ] **Step 1: Add the message tree**

Add these members to the `citations` object of `apps/web/messages/en.json`. `title`, `noAccessTitle` and `noAccessReason` already exist with the texts the new screen uses ("Citations", "You cannot open citations", "Your role cannot read AI data in this project.") and stay. Every text is the preview's, word for word, except where a comment in the step says otherwise; quotes are typographic (the catalog test refuses straight ones).

```json
"toolbar": {
  "label": "Scope and actions",
  "scope": "Scope",
  "prefix": "{name}:",
  "trigger": "{name}: {value}",
  "platform": "Platform",
  "allPlatforms": "All platforms",
  "group": "Group",
  "allGroups": "All groups",
  "noGroup": "No group",
  "groupSearch": "Search groups",
  "groupEmpty": "No group matches “{query}”",
  "groupClear": "Clear the search",
  "groupOpen": "Show the groups",
  "runs": "Runs",
  "runs4": "Last 4 runs",
  "runs2": "Last 2 runs",
  "runs1": "Last run",
  "noteDays": "{count, plural, one {# day} other {# days}}",
  "noteRange": "{from} to {to}",
  "competitors": "Competitors:",
  "competitorsNone": "None",
  "competitorsMore": "{names} +{count}",
  "competitorsLabel": "Competitors: {names}",
  "competitorsLabelNone": "Competitors: none",
  "reset": "Reset scope",
  "export": "Export"
},
"competitorPicker": {
  "label": "Competitors to compare",
  "head": "Compare with",
  "count": "{count} of {max}",
  "foot": "Up to {max} tracked competitors. Manage the list in Settings."
},
"measures": {
  "label": "Citation measures",
  "aria": "{label}: {value}. {hint}",
  "citations": {
    "label": "Total citations",
    "what": "How many times AI answers cite a page of your site.",
    "how": "One URL in one answer’s list of citations counts once. An answer that cites two of your pages counts twice.",
    "context": "in {answers, plural, one {# answer} other {# answers}}",
    "tip": "Citations of {domain} pages in {answers, plural, one {# answer} other {# answers}} to {prompts, plural, one {# prompt} other {# prompts}}."
  },
  "frequency": {
    "label": "Citation rate",
    "what": "The share of answers that cite your site at least once.",
    "how": "Answers that cite you, divided by all valid answers. Over All platforms it is the equal-weight average of the platforms, never pooled.",
    "contextOne": "{k} of {n} answers",
    "tipAll": "{k} of {n} answers cite you, summed over the platforms. The rate is their equal-weight average. Change against {previous}.",
    "tipOne": "{k} of {n} answers cite you. Change against {previous}."
  },
  "coverage": {
    "label": "Prompt coverage",
    "what": "The share of tracked prompts that cite your site at least once in these runs.",
    "how": "Prompts with at least one answer citing you, divided by prompts with an answer. Over All platforms it is the equal-weight average of the platforms.",
    "contextOne": "{k} of {n} prompts",
    "tipAll": "{k} of {n} prompts cite you, summed over the platforms. The rate is their equal-weight average. Change against {previous}.",
    "tipOne": "{k} of {n} prompts cite you. Change against {previous}."
  },
  "urls": {
    "label": "Unique cited URLs",
    "what": "How many different pages of your site AI answers cite.",
    "how": "Distinct URLs on {domain} in the citation lists of the answers in scope.",
    "context": "pages of {domain}"
  },
  "domains": {
    "label": "Unique cited domains",
    "what": "How many different domains AI answers cite for your prompts: the field you compete in for citations.",
    "how": "Distinct domains in the citation lists of the answers in scope, your site included.",
    "context": "in answers to your prompts"
  },
  "growth": {
    "label": "Citation growth",
    "what": "How total citations changed against the same number of runs before.",
    "how": "Total citations now minus before, divided by before. Not tested for detectability.",
    "context": "{change} vs {previous}",
    "tip": "{now} citations now, {before} in {previous}."
  },
  "average": "average of {count} platforms",
  "noAnswers": "no answers",
  "countBefore": "{count} before. Counts are not tested for detectability",
  "up": "Up {points}",
  "down": "Down {points}",
  "flat": "No change",
  "trendTip": "{words} against the previous period, from {from} to {to}. {verdict}",
  "detectable": "Detectable: its 95% interval excludes zero.",
  "notDetectable": "Within normal variation.",
  "spokenDetectable": "{words}, detectable change",
  "spokenNot": "{words}, within normal variation",
  "previous4": "the previous 4 runs ({from} to {to})",
  "previous2": "the 2 runs before ({from} to {to})",
  "previous1": "the run before ({date})",
  "previousShort4": "the previous 4 runs",
  "previousShort2": "the 2 runs before",
  "previousShort1": "the run before",
  "loadFailed": "Could not load the citation measures"
},
"board": {
  "tabsLabel": "Citations views",
  "pagesTab": "Cited pages",
  "gapsTab": "Gap analysis",
  "gapsCount": ", {count, plural, one {# gap} other {# gaps}}",
  "search": "Search in table",
  "searchPages": "Search pages",
  "searchPrompts": "Search prompts and groups",
  "updated": "Updated {time} · run {run}",
  "updatedNoRun": "Updated {time}",
  "scopeText": "{platform}, {group}, {runs}",
  "loadFailedTitle": "Could not load citations",
  "loadFailedReason": "The server returned an error. Your scope is unchanged.",
  "retry": "Try again",
  "noEngineTitle": "No platform is on",
  "noEngineReason": "Turn on a platform in AI engines settings to collect answers.",
  "loadingMore": "Loading more pages"
},
"pages": {
  "caption": "Cited pages",
  "ownerLabel": "Domain type",
  "owners": { "own": "Your site", "competitor": "Competitors", "third": "Third-party", "all": "All" },
  "columns": {
    "page": "Page",
    "domainType": "Domain type",
    "citations": "Citations",
    "citationsTip": "Answers whose citation list includes this URL",
    "change": "Change",
    "changeTip": "Against {previous}. Counts are not tested for detectability",
    "prompts": "Prompts",
    "promptsTip": "How many tracked prompts cite this page, and the one that cites it most",
    "platforms": "Platforms",
    "platformsTip": "Citations on each platform",
    "trend": "Trend",
    "trendTip": "Citations in each of the last 8 weekly runs",
    "trendTipShort": "Citations in each of the last {count} runs",
    "lastCited": "Last cited"
  },
  "open": "Open {url}",
  "pageTip": "{title} ({url})",
  "new": "New",
  "newTip": "Not cited in {previous}",
  "noChange": "No change",
  "yourSite": "Your site",
  "thirdParty": "Third-party",
  "topPromptTip": "Cited most for: {text} ({count}×)",
  "more": "+{count}",
  "details": "Details",
  "moreLabel": "Prompts that cite {path}, {count, plural, one {# prompt} other {# prompts}}",
  "platformTip": "{engine}: {count, plural, one {# citation} other {# citations}}",
  "trendLabel": "Citations per run, oldest first: {values}",
  "footer": "{pages, plural, one {# page} other {# pages}} · {citations} citations",
  "emptyTitle": "No citations in this scope",
  "emptyReason": "No answer in {scope} cites a page. Choose more runs or another group.",
  "resetScope": "Reset scope",
  "noMatchTitle": "No pages match",
  "noMatchSearchOwn": "No page of your site contains “{query}”.",
  "noMatchSearch": "No {noun} page contains “{query}”.",
  "noMatchSearchAll": "No page contains “{query}”.",
  "noMatchOwnerOwn": "No pages of your site are cited in {scope}.",
  "noMatchOwner": "No {noun} pages are cited in {scope}.",
  "nouns": { "competitor": "competitor", "third": "third-party" },
  "clearSearch": "Clear search",
  "showAll": "Show all pages"
},
"promptsPopover": {
  "label": "Prompts that cite {path}",
  "head": "Cited for",
  "meta": "{prompts, plural, one {# prompt} other {# prompts}} · {citations, plural, one {# citation} other {# citations}}",
  "count": "{count}×",
  "showAll": "Show all {count} prompts",
  "details": "Open the page details"
},
"gaps": {
  "caption": "Gap analysis",
  "onlyGaps": "Only gaps",
  "summary": "<strong>{gaps}</strong> of {prompts, plural, one {# prompt} other {# prompts}} lost to a competitor on at least one platform",
  "columns": {
    "prompt": "Prompt",
    "group": "Group",
    "youTip": "Whether answers to the prompt cite your site, with how many answers do",
    "competitorTip": "Whether answers cite {domain}",
    "lostOn": "Lost on",
    "lostOnTip": "Platforms where a selected competitor is cited and you are not"
  },
  "open": "Open {prompt}",
  "lostTo": "to {count, plural, one {# competitor} other {# competitors}}",
  "lostTip": "Lost on {engines} to {names}",
  "none": "None",
  "footer": "{count, plural, one {# prompt} other {# prompts}}",
  "footerGaps": "{count, plural, one {# prompt} other {# prompts}} with a gap",
  "chooseTitle": "Choose competitors to compare",
  "chooseReason": "The gap analysis compares you with up to 5 tracked competitors.",
  "chooseAction": "Choose competitors",
  "noAnswersTitle": "No answers in this scope",
  "noAnswersReason": "No prompt in {scope} has an answer yet.",
  "resetScope": "Reset scope",
  "noMatchTitle": "No prompts match",
  "noMatchReason": "No prompt or group contains “{query}”.",
  "clearSearch": "Clear search",
  "noGapsTitle": "No gaps in this scope",
  "noGapsReason": "On every platform, the prompts that cite a selected competitor also cite you.",
  "showAll": "Show all prompts"
},
"marks": {
  "cited": "Cited",
  "notCited": "Not cited",
  "lineCited": "{engine}: cited in {k} of {n, plural, one {# answer} other {# answers}}",
  "lineMentioned": "{engine}: mentioned in {m} of {n, plural, one {# answer} other {# answers}}, never cited",
  "lineNot": "{engine}: not cited in {n, plural, one {# answer} other {# answers}}",
  "lineNone": "{engine}: no answers"
},
"pageDrawer": {
  "type": "Cited page",
  "noun": "page",
  "back": "Back to Citations",
  "tabsLabel": "Cited page sections",
  "yourPage": "Your page",
  "thirdParty": "Third-party",
  "citations": "{count, plural, one {# citation} other {# citations}}",
  "promptsTab": "Prompts",
  "overviewTab": "Overview",
  "promptsTitle": "Prompts that cite this page",
  "promptsMeta": "{prompts, plural, one {# prompt} other {# prompts}} · cited in {answers, plural, one {# answer} other {# answers}}",
  "columnPrompt": "Prompt",
  "columnPlatforms": "Platforms",
  "columnCited": "Cited",
  "promptTip": "{text}. Open its answers",
  "engineAnswers": "{engine}: {k} of {n} answers",
  "engineNone": "{engine}: no answers",
  "citedTip": "Cited in {k} of the prompt’s {n, plural, one {# answer} other {# answers}}",
  "noPromptsTitle": "No prompt cites this page",
  "noPromptsReason": "Nothing in this scope. Choose more runs or another group.",
  "summaryTitle": "Summary",
  "summaryMeta": "change against the runs before",
  "summaryCitations": "Citations",
  "summaryPrompts": "Prompts",
  "summaryLastCited": "Last cited",
  "copy": "Copy address",
  "copied": "Address copied",
  "copyFailed": "Could not copy the address",
  "copyFailedHint": "Copy it from the field instead.",
  "openTip": "Open the page",
  "openLabel": "Open the page in a new tab",
  "trendTitle": "Citations per run",
  "trendMeta": "last 8 weekly runs",
  "trendMetaShort": "last {count} runs",
  "trendLabel": "Citations per weekly run, oldest first: {values}",
  "platformsTitle": "By platform",
  "platformsMeta": "citations · share",
  "columnPlatform": "Platform",
  "columnCitations": "Citations",
  "columnShare": "Share",
  "alongsideTitle": "Cited alongside",
  "alongsideMeta": "domains in the same answers",
  "columnDomain": "Domain",
  "columnAnswers": "Answers",
  "yourSite": "Your site",
  "competitor": "Competitor",
  "alongsideCount": "{k} of {n}",
  "alongsideTip": "Cited in {k} of the {n, plural, one {# answer} other {# answers}} that cite this page",
  "aloneTitle": "Cited alone",
  "aloneReason": "No other domain is cited in the answers that cite this page.",
  "notCitedTitle": "Not cited in this scope",
  "notCitedReason": "No answer in {scope} cites this page. Choose more runs or another group.",
  "loadFailed": "Could not load this page"
},
"gapDrawer": {
  "type": "Prompt",
  "noun": "prompt",
  "back": "Back to Citations",
  "tabsLabel": "Prompt gap sections",
  "gapTab": "Gap",
  "platformsTab": "By platform",
  "lostOn": "lost on {engines}",
  "notLost": "not lost on any platform",
  "whoTitle": "Who is cited",
  "whoMeta": "{count, plural, one {# answer} other {# answers}}",
  "openAnswers": "Open answers",
  "columnBrand": "Brand",
  "columnState": "State",
  "columnAnswers": "Answers",
  "columnPlatform": "Platform",
  "answersCount": "{k} of {n}",
  "answersTip": "Cited in {k} of {n, plural, one {# answer} other {# answers}}",
  "rivalsTitle": "Pages competitors win with",
  "rivalsMeta": "what to answer better",
  "noRivalsTitle": "No competitor page is cited",
  "noRivalsReason": "None of the selected competitors is cited for this prompt in this scope.",
  "closestTitle": "Your closest page",
  "closestMeta": "update it before writing a new one",
  "ownHere": "Cited in some answers to this prompt",
  "closestNote": "Cited for other {group} prompts",
  "noClosestTitle": "No page of yours is cited for {group}",
  "noClosestNoGroup": "No page of yours is cited for this group",
  "noClosestReason": "This prompt needs a page of its own. Start from the competitor pages above.",
  "thirdTitle": "Third-party pages in these answers",
  "thirdMeta": "where to be listed",
  "noThirdTitle": "No third-party page",
  "noThirdReason": "The answers cite no third-party page.",
  "citedOn": "Cited on {engines}",
  "times": "{count}×",
  "platformsTitle": "By platform",
  "platformsMeta": "answers that cite each brand",
  "notFoundTitle": "No answer in this scope",
  "notFoundReason": "This prompt has no answer in {scope}.",
  "loadFailed": "Could not load this prompt"
},
"download": {
  "pagesFile": "cited-pages",
  "gapsFile": "gap-analysis",
  "done": "Exported {count, plural, one {# row} other {# rows}}",
  "failed": "Could not export",
  "failedReason": "The server returned an error. Try again.",
  "url": "URL",
  "title": "Title",
  "domainType": "Domain type",
  "brand": "Brand",
  "citations": "Citations",
  "previous": "Citations before",
  "prompts": "Prompts",
  "topPrompt": "Top prompt",
  "lastCited": "Last cited",
  "engineCitations": "{engine} citations",
  "prompt": "Prompt",
  "group": "Group",
  "lostOn": "Lost on",
  "lostTo": "Lost to",
  "brandState": "{brand} state",
  "brandCited": "{brand} citing answers"
}
```

App-only strings (no preview text exists; Open point 12): `toolbar.groupEmpty`, `groupClear`, `groupOpen` (the house `Combobox` needs them), `board.loadFailed*`, `board.retry`, `board.noEngine*`, `board.loadingMore`, `board.updatedNoRun`, `measures.loadFailed`, `pageDrawer.back`, `tabsLabel`, `notCited*`, `loadFailed`, `gapDrawer.back`, `tabsLabel`, `notFound*`, `loadFailed`, and the whole `download` subtree.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/citations/board-queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { citedPagesQueryParams, gapsQuery, nextOffset, overviewQuery, sharedParams } from './board-queries';

const PROJECT = { workspaceId: 'w1', projectId: 'p1' };
const SCOPE = { runs: 2 as const, engines: ['chatgpt_web' as const], term: 't1' };

describe('the Citations v2 query wrappers', () => {
  it('sends runs, the engines and the term, and leaves the term out for every group', () => {
    expect(sharedParams(SCOPE)).toEqual({ runs: 2, 'filter[engine_code_in]': ['chatgpt_web'], 'filter[term]': 't1' });
    expect(sharedParams({ ...SCOPE, term: null })).not.toHaveProperty('filter[term]');
  });

  it('keys two scopes apart', () => {
    expect(overviewQuery(PROJECT, SCOPE).queryKey).not.toEqual(overviewQuery(PROJECT, { ...SCOPE, runs: 4 }).queryKey);
  });

  it('asks the gap list for the competitors in the order given', () => {
    expect(gapsQuery(PROJECT, SCOPE, ['c2', 'c1']).queryKey).toContainEqual(
      expect.objectContaining({ 'filter[competitor_id_in]': ['c2', 'c1'] }),
    );
  });

  it('pages Cited pages by 200 with the role, the search and the sort', () => {
    expect(citedPagesQueryParams(SCOPE, { role: 'third_party', q: 'g2', sort: '-change' }, 400)).toMatchObject({
      'filter[domain_role_in]': 'third_party',
      q: 'g2',
      sort: '-change',
      offset: 400,
      limit: 200,
    });
    expect(citedPagesQueryParams(SCOPE, { role: null, q: '', sort: '-citations' }, 0)).not.toHaveProperty('q');
  });

  it('reads the next page until the total is reached', () => {
    expect(nextOffset({ offset: 0, limit: 200, total: 450 }, 200)).toBe(200);
    expect(nextOffset({ offset: 400, limit: 200, total: 450 }, 50)).toBeUndefined();
  });
});
```

`queryKey` (`lib/api/keys.ts` line 52) ends with the normalized query object, so `toContainEqual(expect.objectContaining(...))` finds it.

`apps/web/src/features/citations/board-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { migrationOf, parseBoard, writeBoard, type BoardOptions, type BoardSearch } from './board-state';

const OPTIONS: BoardOptions = {
  engines: ['chatgpt_web', 'gemini_web'],
  terms: new Set(['t1', 't2']),
  tracked: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
};
const parse = (search: BoardSearch, options: BoardOptions = OPTIONS) => parseBoard(search, options);

describe('the Citations address', () => {
  it('reads nothing as the defaults: all platforms and groups, 4 runs, the first three competitors, your site, only gaps', () => {
    expect(parse({})).toEqual({
      platform: 'all',
      group: 'all',
      runs: 4,
      competitors: ['c1', 'c2', 'c3'],
      owner: 'own',
      gapsOnly: true,
      search: '',
    });
  });

  it.each([
    [{ platform: 'gemini_web' }, { platform: 'gemini_web' }],
    [{ platform: 'google_ai_mode' }, { platform: 'all' }],
    [{ platform: 'bing' }, { platform: 'all' }],
    [{ group: 't2' }, { group: 't2' }],
    [{ group: 'gone' }, { group: 'all' }],
    [{ runs: '2' }, { runs: 2 }],
    [{ runs: '3' }, { runs: 4 }],
    [{ owner: 'third' }, { owner: 'third' }],
    [{ owner: 'third_party' }, { owner: 'own' }],
    [{ gaps: 'all' }, { gapsOnly: false }],
    [{ gaps: 'some' }, { gapsOnly: true }],
    [{ q: `  ${'a'.repeat(250)}` }, { search: 'a'.repeat(200) }],
  ])('reads %o', (search, expected) => {
    expect(parse(search)).toMatchObject(expected);
  });

  it('reads comp: none when empty, unknown and repeated ids dropped, at most five, in the order given', () => {
    expect(parse({ comp: '' }).competitors).toEqual([]);
    expect(parse({ comp: 'c3,x,c1,c3' }).competitors).toEqual(['c3', 'c1']);
    expect(parse({ comp: 'c1,c2,c3,c4,c5,c6' }).competitors).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('keeps a group and the competitors as given while the terms and the tracked list load', () => {
    const loading: BoardOptions = { engines: null, terms: null, tracked: null };
    expect(parse({ group: 't9', comp: 'c9', platform: 'gemini_web' }, loading)).toMatchObject({
      group: 't9',
      competitors: ['c9'],
      platform: 'gemini_web',
    });
    expect(parse({}, loading).competitors).toEqual([]);
  });

  it('writes the defaults as nothing and every other value under its key', () => {
    expect(writeBoard(parse({}), OPTIONS.tracked)).toEqual({
      platform: null,
      group: null,
      runs: null,
      comp: null,
      owner: null,
      gaps: null,
      q: null,
    });
    expect(
      writeBoard(
        { platform: 'gemini_web', group: 't1', runs: 1, competitors: [], owner: 'all', gapsOnly: false, search: 'crm' },
        OPTIONS.tracked,
      ),
    ).toEqual({ platform: 'gemini_web', group: 't1', runs: '1', comp: '', owner: 'all', gaps: 'all', q: 'crm' });
  });

  it('moves the old keys once: role to owner, topic to group, the rest dropped', () => {
    expect(migrationOf({ tab: 'domains', role: 'third_party', topic: 't1', win: '7d', engine: 'chatgpt_web' })).toEqual({
      tab: null,
      role: null,
      topic: null,
      win: null,
      engine: null,
      owner: 'third',
      group: 't1',
    });
    expect(migrationOf({ tab: 'new-lost', role: 'own,competitor' })).toEqual({ tab: null, role: null });
    expect(migrationOf({ platform: 'chatgpt_web' })).toBeNull();
  });
});
```

`apps/web/src/features/citations/board-text.test.ts`:

```ts
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { previousText, runsNote, scopeText } from './board-text';
import messages from '../../../messages/en.json';
import type { Schemas } from '@/lib/api/types';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const ZONE = 'Europe/Berlin';
const LATEST = '2026-09-28T00:15:00.000Z';
/** Weekly slots, slot 1 on Sep 28 back to slot 8 on Aug 10, at 02:10 Berlin time. */
const DAYS = ['09-28', '09-21', '09-14', '09-07', '08-31', '08-24', '08-17', '08-10'];
const slot = (n: number): Schemas['RunSlot'] => ({
  slot: n,
  first_at: `2026-${DAYS[n - 1] ?? ''}T00:10:00.000Z`,
  last_at: `2026-${DAYS[n - 1] ?? ''}T00:15:00.000Z`,
  answers: 10,
});
const TREND = [8, 7, 6, 5, 4, 3, 2, 1].map(slot);

describe('the words of the Citations scope', () => {
  it('notes each Runs choice from the trend slots (C 116)', () => {
    expect(runsNote(4, TREND, ZONE, LATEST, t)).toBe('28 days');
    expect(runsNote(2, TREND, ZONE, LATEST, t)).toBe('Sep 21 to Sep 28');
    expect(runsNote(1, TREND, ZONE, LATEST, t)).toBe('Sep 28');
  });

  it('names the slots that exist when there are fewer than the choice', () => {
    expect(runsNote(2, [slot(1)], ZONE, LATEST, t)).toBe('Sep 28');
    expect(runsNote(4, [slot(2), slot(1)], ZONE, LATEST, t)).toBe('14 days');
    expect(runsNote(4, [], ZONE, LATEST, t)).toBeNull();
  });

  it('says what every change compares with (C 99 to 104)', () => {
    expect(previousText(4, [5, 6, 7, 8].map(slot), ZONE, LATEST, t)).toEqual({
      full: 'the previous 4 runs (Aug 10 to Aug 31)',
      short: 'the previous 4 runs',
    });
    expect(previousText(2, [3, 4].map(slot), ZONE, LATEST, t).full).toBe('the 2 runs before (Sep 7 to Sep 14)');
    expect(previousText(1, [slot(2)], ZONE, LATEST, t).full).toBe('the run before (Sep 21)');
    expect(previousText(4, [], ZONE, LATEST, t)).toEqual({ full: 'the previous 4 runs', short: 'the previous 4 runs' });
  });

  it('writes the scope of the empty states (C 106 to 108)', () => {
    expect(scopeText({ platform: 'ChatGPT', group: 'Pricing', runs: 2 }, t)).toBe('ChatGPT, Pricing, Last 2 runs');
  });
});
```

The `runsNote(4, [slot(2), slot(1)])` case: one week between the two slots plus the median gap of one week, so 14 days; the case pins the rule of the brief (section 3.2) for a project with two runs.

`apps/web/src/features/citations/board-reads.test.tsx`:

```tsx
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useBoardEngines, useCitedPages, useTracked } from './board-reads';
import messages from '../../../messages/en.json';
import { makeQueryClient } from '@/lib/api/query-client';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const PROJECT = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };

// The wrapper of `features/citations/citation-reads.test.tsx`: the catalog and a query cache of the test's own
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </NextIntlClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the Citations reads', () => {
  it('lists the enabled engines in code order with their labels', async () => {
    const { result } = renderHook(() => useBoardEngines(PROJECT), { wrapper });
    await waitFor(() => expect(result.current.engines).not.toBeNull());
    expect(result.current.engines?.map((engine) => engine.code)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('lists the tracked competitors in Settings order and the own brand', async () => {
    const { result } = renderHook(() => useTracked(PROJECT), { wrapper });
    await waitFor(() => expect(result.current.tracked).not.toBeNull());
    expect(result.current.tracked).toHaveLength(5);
    expect(result.current.ownName).toBe('Fynix');
  });

  it('reads Cited pages 200 at a time and the next page on demand', async () => {
    const { result } = renderHook(
      () =>
        useCitedPages(
          PROJECT,
          { runs: 4, engines: ['chatgpt_web'], term: null },
          { role: null, q: '', sort: '-citations' },
          true,
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    expect(result.current.total).toBe(CITATIONS_FIXTURE.expected.chatgpt.pages.all);
    result.current.loadMore();
    await waitFor(() => expect(result.current.rows).toHaveLength(CITATIONS_FIXTURE.expected.chatgpt.pages.all));
  });
});
```

The mock server of `@/test/msw` answers with every registered handler (the vitest setup starts it), so these reads reach the Task 2 routes and the entities, engines and taxonomy mocks.

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/web && pnpm vitest run src/lib/citations/board-queries.test.ts src/features/citations/board-state.test.ts src/features/citations/board-text.test.ts src/features/citations/board-reads.test.tsx`
Expected: FAIL, the four modules do not exist.

- [ ] **Step 4: Write the query wrappers**

`apps/web/src/lib/citations/board-queries.ts`:

```ts
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiAllPagesQuery, apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { EngineCode, Schemas } from '@/lib/api/types';
import type { SourceScope } from './types';

/**
 * The five reads of the Citations page (WP-76; docs/19 "As built (AI visibility WP-76 ...)"). Every read takes the
 * same scope: each prompt and engine's last `runs` runs (D-2), the engines of the Platform choice (D-4) and the
 * Group's topic term (D-1). Cited pages is paged by offset, 200 rows a page (D-6).
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}' as const;
export const OVERVIEW = `${P}/ai/citation-overview` as const;
export const CITED_PAGES = `${P}/ai/cited-pages` as const;
export const CITED_PAGE = `${P}/ai/cited-pages/{url_id}` as const;
export const GAPS = `${P}/ai/citation-gaps` as const;
export const GAP = `${P}/ai/citation-gaps/{prompt_id}` as const;

export type CitationOverview = Schemas['CitationOverview'];
export type CitedPagePage = Schemas['CitedPagePage'];
export type CitedPagesMeta = Schemas['CitedPagesMeta'];
export type CitedPageRow = Schemas['CitedPageRow'];
export type CitedPageDetail = Schemas['CitedPageDetail'];
export type CitationGapList = Schemas['CitationGapList'];
export type CitationGapRow = Schemas['CitationGapRow'];
export type CitationGapDetail = Schemas['CitationGapDetail'];
export type RunWindow = Schemas['RunWindow'];
export type RunSlot = Schemas['RunSlot'];
export type DomainRole = CitedPageRow['domain_role'];
export type CitedPagesSort = NonNullable<
  NonNullable<paths[typeof CITED_PAGES]['get']['parameters']['query']>['sort']
>;

/** 1, 2 or 4: the API checks it at runtime and types it as a number. */
export type RunsChoice = 1 | 2 | 4;

/** The scope every read takes. `engines` is never empty: All platforms sends the enabled engines. */
export interface BoardScopeParams {
  runs: RunsChoice;
  engines: readonly EngineCode[];
  /** A topic term id, or `null` for every group. */
  term: string | null;
}

/** What Cited pages adds: one role or none, the search, the sort. */
export interface PageListParams {
  role: DomainRole | null;
  q: string;
  sort: CitedPagesSort;
}

/** Rows a Cited pages read asks for (D-6; the API's limit is at most 200). */
export const PAGE_SIZE = 200;

const pathOf = (project: SourceScope): { workspace_id: string; project_id: string } => ({
  workspace_id: project.workspaceId,
  project_id: project.projectId,
});

export function sharedParams(scope: BoardScopeParams): {
  runs: number;
  'filter[engine_code_in]': EngineCode[];
  'filter[term]'?: string;
} {
  return {
    runs: scope.runs,
    'filter[engine_code_in]': [...scope.engines],
    ...(scope.term === null ? {} : { 'filter[term]': scope.term }),
  };
}

export const overviewQuery = (project: SourceScope, scope: BoardScopeParams): ApiQueryOptions<typeof OVERVIEW> =>
  apiQuery(OVERVIEW, { params: { path: pathOf(project), query: sharedParams(scope) } });

export const citedPageQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  urlId: number,
): ApiQueryOptions<typeof CITED_PAGE> =>
  apiQuery(CITED_PAGE, { params: { path: { ...pathOf(project), url_id: urlId }, query: sharedParams(scope) } });

export const gapsQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
): ApiQueryOptions<typeof GAPS> =>
  apiQuery(GAPS, {
    params: {
      path: pathOf(project),
      query: { ...sharedParams(scope), 'filter[competitor_id_in]': [...competitors] },
    },
  });

export const gapQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
  promptId: string,
): ApiQueryOptions<typeof GAP> =>
  apiQuery(GAP, {
    params: {
      path: { ...pathOf(project), prompt_id: promptId },
      query: { ...sharedParams(scope), 'filter[competitor_id_in]': [...competitors] },
    },
  });

/** The query of one page of Cited pages. */
export function citedPagesQueryParams(
  scope: BoardScopeParams,
  list: PageListParams,
  offset: number,
): NonNullable<paths[typeof CITED_PAGES]['get']['parameters']['query']> {
  return {
    ...sharedParams(scope),
    ...(list.role === null ? {} : { 'filter[domain_role_in]': list.role }),
    ...(list.q === '' ? {} : { q: list.q }),
    sort: list.sort,
    offset,
    limit: PAGE_SIZE,
  };
}

/** The cache key of the Cited pages list of a scope, under the project's key. */
export const citedPagesKey = (project: SourceScope, scope: BoardScopeParams, list: PageListParams): QueryKey => [
  ...projectKey(project.workspaceId, project.projectId),
  'cited-pages',
  sharedParams(scope),
  list,
];

/** One page of Cited pages from `offset`. */
export function readCitedPages(
  project: SourceScope,
  scope: BoardScopeParams,
  list: PageListParams,
  offset: number,
  signal: AbortSignal,
): Promise<CitedPagePage> {
  return unwrap(
    api.GET(CITED_PAGES, {
      params: { path: pathOf(project), query: citedPagesQueryParams(scope, list, offset) },
      signal,
    }),
  );
}

/** The offset of the page after `page`, or `undefined` when `page` holds the last row. */
export const nextOffset = (page: Schemas['OffsetPageInfo'], rows: number): number | undefined =>
  page.offset + rows < page.total ? page.offset + rows : undefined;

/** Every row of Cited pages for the scope, for Export (read page after page). */
export const allCitedPagesQuery = (
  project: SourceScope,
  scope: BoardScopeParams,
  list: PageListParams,
): ApiQueryOptions<typeof CITED_PAGES> =>
  apiAllPagesQuery(CITED_PAGES, (row) => String(row.url_id), {
    params: { path: pathOf(project), query: citedPagesQueryParams(scope, list, 0) },
  });
```

- [ ] **Step 5: Write the URL state**

`apps/web/src/features/citations/board-state.ts`:

```ts
'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { engineCodeValues } from '@/lib/api/schema';
import type { EngineCode } from '@/lib/api/types';
import type { RunsChoice } from '@/lib/citations/board-queries';

/**
 * What the Citations page keeps in its address (brief section 3.1, C 40 to 66): the scope (`platform`, `group`, `runs`,
 * `comp`), the Cited pages owner, the gap filter and the search. Defaults are never written. The keys of the page this
 * one replaces are read once and dropped. `parseBoard`, `writeBoard` and `migrationOf` are pure.
 */

export type Platform = EngineCode | 'all';
/** The owner of a cited page as the address writes it (C 26 to 31); `third` is the API's `third_party`. */
export type Owner = 'own' | 'competitor' | 'third' | 'all';
export const OWNERS: readonly Owner[] = ['own', 'competitor', 'third', 'all'];
/** The Runs menu, in its order (D 24 to 28). */
export const RUN_CHOICES: readonly RunsChoice[] = [4, 2, 1];
export const MAX_COMPETITORS = 5;
export const MAX_SEARCH = 200;
/** D-7: the first three tracked competitors. */
const DEFAULT_COMPETITORS = 3;

export const BOARD_KEYS = ['platform', 'group', 'runs', 'comp', 'owner', 'gaps', 'q'] as const;
export type BoardKey = (typeof BOARD_KEYS)[number];
/** The keys of the old page (`features/citations/citation-scope.ts` and the date range picker). */
export const OLD_KEYS = [
  'tab',
  'kind',
  'engine',
  'role',
  'topic',
  'branded',
  'redirects',
  'internal',
  'cmp',
  'min',
  'sort',
  'domain',
  'density',
  'cols',
  'country',
  'win',
  'from',
  'to',
] as const;
type OldKey = (typeof OLD_KEYS)[number];
type AnyKey = BoardKey | OldKey;

export type BoardSearch = Readonly<Partial<Record<AnyKey, string | null>>>;
export type BoardPatch = Partial<Record<AnyKey, string | null>>;

export interface BoardState {
  platform: Platform;
  /** A topic term id, or `all`. */
  group: string;
  runs: RunsChoice;
  /** Tracked competitor ids, at most five. */
  competitors: readonly string[];
  owner: Owner;
  gapsOnly: boolean;
  search: string;
}

/** What values are checked against; `null` while it is not known, when a value is kept as given. */
export interface BoardOptions {
  engines: readonly EngineCode[] | null;
  terms: ReadonlySet<string> | null;
  tracked: readonly string[] | null;
}

const isEngineCode = (value: string): value is EngineCode => engineCodeValues.some((code) => code === value);

export const defaultCompetitors = (tracked: readonly string[]): readonly string[] =>
  tracked.slice(0, DEFAULT_COMPETITORS);

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function platformOf(raw: string | null | undefined, engines: readonly EngineCode[] | null): Platform {
  if (raw === null || raw === undefined || !isEngineCode(raw)) return 'all';
  return engines === null || engines.includes(raw) ? raw : 'all';
}

function groupOf(raw: string | null | undefined, terms: ReadonlySet<string> | null): string {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'all') return 'all';
  return terms === null || terms.has(value) ? value : 'all';
}

function competitorsOf(raw: string | null | undefined, tracked: readonly string[] | null): readonly string[] {
  if (raw === null || raw === undefined) return tracked === null ? [] : defaultCompetitors(tracked);
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ];
  return (tracked === null ? ids : ids.filter((id) => tracked.includes(id))).slice(0, MAX_COMPETITORS);
}

/** The state the address names. A value that does not read falls back to its default; nothing throws. */
export function parseBoard(search: BoardSearch, options: BoardOptions): BoardState {
  return {
    platform: platformOf(search.platform, options.engines),
    group: groupOf(search.group, options.terms),
    runs: RUN_CHOICES.find((choice) => String(choice) === search.runs) ?? 4,
    competitors: competitorsOf(search.comp, options.tracked),
    owner: OWNERS.find((owner) => owner === search.owner) ?? 'own',
    gapsOnly: search.gaps !== 'all',
    search: (search.q ?? '').trim().slice(0, MAX_SEARCH),
  };
}

/** The address of `state`: each default as `null`, which removes its key. */
export function writeBoard(state: BoardState, tracked: readonly string[] | null): Record<BoardKey, string | null> {
  const defaults = tracked === null ? null : defaultCompetitors(tracked);
  return {
    platform: state.platform === 'all' ? null : state.platform,
    group: state.group === 'all' ? null : state.group,
    runs: state.runs === 4 ? null : String(state.runs),
    comp: defaults !== null && sameList(state.competitors, defaults) ? null : state.competitors.join(','),
    owner: state.owner === 'own' ? null : state.owner,
    gaps: state.gapsOnly ? null : 'all',
    q: state.search === '' ? null : state.search,
  };
}

/**
 * The write that moves an old link onto this page's keys, or `null` when it has none: `role` becomes `owner`, `topic`
 * becomes `group` (D-1), and every old key is removed. Any `tab` opens Cited pages, which `/ai/citations` is.
 */
export function migrationOf(search: BoardSearch): BoardPatch | null {
  const present = OLD_KEYS.filter((key) => search[key] !== null && search[key] !== undefined);
  if (present.length === 0) return null;
  const patch: BoardPatch = {};
  for (const key of present) patch[key] = null;
  const role = search.role?.trim();
  const owner = role === 'own' || role === 'competitor' ? role : role === 'third_party' ? 'third' : null;
  if (owner !== null && (search.owner ?? null) === null) patch.owner = owner;
  const topic = search.topic?.trim() ?? '';
  if (topic !== '' && (search.group ?? null) === null) patch.group = topic;
  return patch;
}

// One string parser per key, as `citation-scope.ts` builds them
const PARSERS = Object.fromEntries([...BOARD_KEYS, ...OLD_KEYS].map((key) => [key, parseAsString])) as Record<
  AnyKey,
  typeof parseAsString
>;

export interface BoardStateResult {
  state: BoardState;
  /** Writes a change with history replace, as the preview does (C 65). */
  set: (patch: Partial<BoardState>) => void;
  /** Platform, Group, Runs and Competitors back to their defaults (C 180). */
  resetScope: () => void;
  isDefaultScope: boolean;
}

export function useBoardState(options: BoardOptions): BoardStateResult {
  const [search, setSearch] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parseBoard(search, options), [search, options]);
  // An old link is moved once, on the first render that has its keys
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    const patch = migrationOf(search);
    if (patch !== null) void setSearch(patch, { history: 'replace' });
  }, [search, setSearch]);
  const { tracked } = options;
  const set = useCallback(
    (patch: Partial<BoardState>): void => {
      void setSearch(writeBoard({ ...state, ...patch }, tracked), { history: 'replace' });
    },
    [state, tracked, setSearch],
  );
  const defaults = useMemo(() => (tracked === null ? [] : defaultCompetitors(tracked)), [tracked]);
  const resetScope = useCallback(
    (): void => set({ platform: 'all', group: 'all', runs: 4, competitors: defaults }),
    [set, defaults],
  );
  const isDefaultScope =
    state.platform === 'all' && state.group === 'all' && state.runs === 4 && sameList(state.competitors, defaults);
  return { state, set, resetScope, isDefaultScope };
}
```

The caller passes `options` memoized on the loaded lists (Task 11), so `state` keeps its identity between renders.

- [ ] **Step 6: Write the words**

`apps/web/src/features/citations/board-text.ts`:

```ts
import type { useTranslations } from 'next-intl';

import { formatTableDate } from '@/lib/format';
import type { RunSlot, RunsChoice } from '@/lib/citations/board-queries';

/** The translator of `citations`, as `useTranslations('citations')` and `createTranslator` give it. */
export type CitationsTranslate = ReturnType<typeof useTranslations<'citations'>>;

const DAY_MS = 86_400_000;

/**
 * "Sep 28": a slot's day in the project's zone. The year is left out when it is the year of the latest answer, so a
 * screen of last year's data still reads in its own year.
 */
export const slotDay = (instant: string, timeZone: string, latest: string | null): string =>
  formatTableDate(instant, timeZone, new Date(latest ?? instant));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/**
 * The note of a Runs choice (brief 3.2, C 116), from `window.trend` (slots 1 to 8, oldest first): 4 runs are "N days",
 * the whole days from the oldest of slots 1 to 4 to the newest plus one run's length (the median days between
 * consecutive slots), so four weekly runs read 28 days; 2 runs are "<slot 2> to <slot 1>"; 1 run is "<slot 1>". With
 * fewer slots than the choice it names those there are; `null` with none.
 */
export function runsNote(
  choice: RunsChoice,
  trend: readonly RunSlot[],
  timeZone: string,
  latest: string | null,
  t: CitationsTranslate,
): string | null {
  const bySlot = new Map(trend.map((slot) => [slot.slot, slot]));
  const held = [4, 3, 2, 1]
    .filter((slot) => slot <= choice)
    .flatMap((slot) => bySlot.get(slot) ?? []);
  const oldest = held[0];
  const newest = held[held.length - 1];
  if (oldest === undefined || newest === undefined) return null;
  const day = (instant: string): string => slotDay(instant, timeZone, latest);
  if (held.length === 1) return day(newest.last_at);
  if (choice === 2) return t('toolbar.noteRange', { from: day(oldest.last_at), to: day(newest.last_at) });
  const span = Math.floor((Date.parse(newest.last_at) - Date.parse(oldest.first_at)) / DAY_MS);
  const ordered = [...trend].sort((a, b) => b.slot - a.slot);
  const steps = ordered.slice(1).map((slot, index) => {
    const before = ordered[index];
    return before === undefined ? 0 : Math.round((Date.parse(slot.first_at) - Date.parse(before.first_at)) / DAY_MS);
  });
  return t('toolbar.noteDays', { count: span + median(steps) });
}

export interface PreviousText {
  /** "the previous 4 runs (Aug 10 to Aug 31)" */
  full: string;
  /** "the previous 4 runs" (C 255) */
  short: string;
}

/** What every change on the page compares with (C 99 to 104), from `window.previous`. */
export function previousText(
  runs: RunsChoice,
  previous: readonly RunSlot[],
  timeZone: string,
  latest: string | null,
  t: CitationsTranslate,
): PreviousText {
  const short =
    runs === 1
      ? t('measures.previousShort1')
      : runs === 2
        ? t('measures.previousShort2')
        : t('measures.previousShort4');
  const ordered = [...previous].sort((a, b) => b.slot - a.slot);
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];
  if (oldest === undefined || newest === undefined) return { full: short, short };
  const from = slotDay(oldest.first_at, timeZone, latest);
  const to = slotDay(newest.last_at, timeZone, latest);
  const full =
    runs === 1
      ? t('measures.previous1', { date: to })
      : runs === 2
        ? t('measures.previous2', { from, to })
        : t('measures.previous4', { from, to });
  return { full, short };
}

/** "<platform>, <group>, <runs label>" of the empty states (C 106 to 108). */
export const scopeText = (
  parts: { platform: string; group: string; runs: RunsChoice },
  t: CitationsTranslate,
): string =>
  t('board.scopeText', {
    platform: parts.platform,
    group: parts.group,
    runs: runsLabel(parts.runs, t),
  });

export const runsLabel = (runs: RunsChoice, t: CitationsTranslate): string =>
  runs === 1 ? t('toolbar.runs1') : runs === 2 ? t('toolbar.runs2') : t('toolbar.runs4');
```

- [ ] **Step 7: Write the reads**

`apps/web/src/features/citations/board-reads.ts`:

```ts
'use client';

import { keepPreviousData, useInfiniteQuery, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ENGINE_ORDER } from '@/components/app/engine/order';
import { isApiProblem } from '@/lib/api/problem';
import { apiQuery } from '@/lib/api/query';
import type { EngineCode } from '@/lib/api/types';
import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';
import {
  citedPageQuery,
  citedPagesKey,
  gapQuery,
  gapsQuery,
  nextOffset,
  overviewQuery,
  readCitedPages,
  type BoardScopeParams,
  type CitationGapDetail,
  type CitationGapList,
  type CitationOverview,
  type CitedPageDetail,
  type CitedPageRow,
  type CitedPagesMeta,
  type PageListParams,
} from '@/lib/citations/board-queries';
import { entitiesQuery } from '@/lib/citations/entities-query';
import type { SourceScope } from '@/lib/citations/types';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';

/**
 * The reads of the Citations page. Each loads and fails on its own, keeps its last answer while a new scope is read
 * (`keepPreviousData`; 17 section 3, Loading: no dimming, the 2 px refetch bar), and says so in `refetching`.
 */

export interface BoardRead<T> {
  status: 'loading' | 'error' | 'ready';
  data: T | undefined;
  /** A new scope is being read while the last answer stays on screen. */
  refetching: boolean;
  /** The API answered 404: a drawer's page or prompt has nothing in this scope (WP-76), which is an answer. */
  notFound: boolean;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

function useRead<T>(query: UseQueryResult<T>): BoardRead<T> {
  const errorId = useErrorId(query.error);
  return {
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    data: query.data,
    refetching: query.isFetching && query.data !== undefined,
    notFound: isApiProblem(query.error) && query.error.status === 404,
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}

export interface BoardEngine {
  code: EngineCode;
  label: string;
}

const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines';

/** The enabled engines in code order (D-4); `null` while unknown, so no read asks "every engine" by mistake. */
export function useBoardEngines(project: SourceScope): { engines: readonly BoardEngine[] | null; read: BoardRead<unknown> } {
  const query = useQuery(
    apiQuery(ENGINES, { params: { path: { workspace_id: project.workspaceId, project_id: project.projectId } } }),
  );
  const read = useRead(query);
  const engines = useMemo(
    () =>
      query.data === undefined
        ? null
        : query.data.data
            .filter((engine) => engine.is_enabled)
            .map((engine) => ({ code: engine.engine.engine_code, label: engine.engine.label }))
            .sort((a, b) => ENGINE_ORDER.indexOf(a.code) - ENGINE_ORDER.indexOf(b.code)),
    [query.data],
  );
  return { engines, read };
}

export interface TrackedCompetitor {
  id: string;
  name: string;
  colorIndex: number | null;
  /** The registrable domain the popover and the gap header name; `null` when the entity has none. */
  domain: string | null;
}

/** The tracked competitors in Settings order (D-7) and the own brand's name; `null` while unknown. */
export function useTracked(project: SourceScope): {
  tracked: readonly TrackedCompetitor[] | null;
  ownName: string | null;
  read: BoardRead<unknown>;
} {
  const query = useQuery(entitiesQuery(project));
  const read = useRead(query);
  // Memoized on the answer alone, so `tracked` keeps its identity between renders (the URL state depends on it)
  const lists = useMemo(() => {
    if (query.data === undefined) return { tracked: null, ownName: null };
    const live = query.data.data.filter((row) => row.removed_at === null);
    const own = live.find((row) => row.role === 'own' && row.is_primary) ?? live.find((row) => row.role === 'own');
    return {
      tracked: live
        .filter((row) => row.role === 'competitor')
        .map((row) => ({
          id: row.entity.entity_id,
          name: row.entity.canonical_name,
          colorIndex: row.color_index,
          domain: row.domains.find((domain) => domain.match_scope !== 'path_prefix')?.domain.registrable_domain ?? null,
        })),
      ownName: own?.entity.canonical_name ?? null,
    };
  }, [query.data]);
  return { ...lists, read };
}

export interface TopicTerm {
  id: string;
  name: string;
}

/** The topic terms of the project (D-1), depth first; `null` while the vocabularies load. */
export function useTopicTerms(project: SourceScope): { terms: readonly TopicTerm[] | null; ids: ReadonlySet<string> | null } {
  const vocabularies = useVocabularies(project);
  return useMemo(() => {
    if (vocabularies.pending && vocabularies.loaded.length === 0) return { terms: null, ids: null };
    const terms = vocabularies.loaded
      .filter((entry) => entry.vocabulary.kind === 'topic')
      .flatMap((entry) => entry.terms.map((term) => ({ id: term.termId, name: term.name })));
    return { terms, ids: new Set(terms.map((term) => term.id)) };
  }, [vocabularies.loaded, vocabularies.pending]);
}

export function useOverview(
  project: SourceScope,
  scope: BoardScopeParams,
  enabled: boolean,
): BoardRead<CitationOverview> {
  return useRead(useQuery({ ...overviewQuery(project, scope), placeholderData: keepPreviousData, enabled }));
}

export function useGaps(
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
  enabled: boolean,
): BoardRead<CitationGapList> {
  // Never asked with no competitor: the empty state shows instead (brief section 4)
  return useRead(
    useQuery({
      ...gapsQuery(project, scope, competitors),
      placeholderData: keepPreviousData,
      enabled: enabled && competitors.length > 0,
    }),
  );
}

export function useCitedPage(project: SourceScope, scope: BoardScopeParams, urlId: number | null): BoardRead<CitedPageDetail> {
  return useRead(
    useQuery({
      ...citedPageQuery(project, scope, urlId ?? 0),
      placeholderData: keepPreviousData,
      enabled: urlId !== null,
      // A 404 is an answer (the page is not cited in this scope), not a failure to retry
      retry: false,
    }),
  );
}

export function useGap(
  project: SourceScope,
  scope: BoardScopeParams,
  competitors: readonly string[],
  promptId: string | null,
): BoardRead<CitationGapDetail> {
  return useRead(
    useQuery({
      ...gapQuery(project, scope, competitors, promptId ?? ''),
      placeholderData: keepPreviousData,
      enabled: promptId !== null && competitors.length > 0,
      retry: false,
    }),
  );
}

export interface CitedPagesRead {
  status: 'loading' | 'error' | 'ready';
  rows: readonly CitedPageRow[];
  meta: CitedPagesMeta | undefined;
  /** Rows the role and the search keep, every page. */
  total: number | null;
  refetching: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

/** Cited pages: server sorted, searched and paged, the next page on demand (D-6). */
export function useCitedPages(
  project: SourceScope,
  scope: BoardScopeParams,
  list: PageListParams,
  enabled: boolean,
): CitedPagesRead {
  const query = useInfiniteQuery({
    queryKey: citedPagesKey(project, scope, list),
    queryFn: ({ pageParam, signal }) => readCitedPages(project, scope, list, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => nextOffset(last.page, last.data.length),
    placeholderData: keepPreviousData,
    enabled,
  });
  const errorId = useErrorId(query.error);
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const first = query.data?.pages[0];
  return {
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    rows,
    meta: first?.meta,
    total: first?.page.total ?? null,
    refetching: query.isFetching && !query.isFetchingNextPage && query.data !== undefined,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}
```

`entitiesQuery` and `SourceScope` are the existing `lib/citations/entities-query.ts` and `lib/citations/types.ts`, which Task 12 keeps.

- [ ] **Step 8: Run the tests**

Run: `cd apps/web && pnpm vitest run src/lib/citations/board-queries.test.ts src/features/citations/board-state.test.ts src/features/citations/board-text.test.ts src/features/citations/board-reads.test.tsx src/i18n/messages.test.ts`
Expected: PASS. `messages.test.ts` passing means no dash, no straight quote, no `!` in the new tree.

- [ ] **Step 9: Checks and commit**

Run: `cd apps/web && pnpm prettier --write src/lib/citations/board-queries*.ts src/features/citations/board-*.ts* messages/en.json && pnpm lint && pnpm typecheck && pnpm format:check`

```bash
git add apps/web/messages/en.json apps/web/src/lib/citations/board-queries.ts apps/web/src/lib/citations/board-queries.test.ts apps/web/src/features/citations/board-state.ts apps/web/src/features/citations/board-state.test.ts apps/web/src/features/citations/board-text.ts apps/web/src/features/citations/board-text.test.ts apps/web/src/features/citations/board-reads.ts apps/web/src/features/citations/board-reads.test.tsx
git commit -m "WP-77: Citations v2 query wrappers, URL state and words"
```

---

### Task 4: Toolbar: three selects, competitors popover, reset, export

Brief step 3. Parity rows: 3.1 "Layout" (the `h1`), 3.2 every row (C 110 to 198; `createSelect` of `aiov-controls.js` lines 52 to 125 for the select look).

**Files:**
- Modify: `apps/web/src/components/ui/select.tsx` (three options of a documented variant: a prefix in the trigger, an option's own display and note, the popup width), `select.test.tsx`
- Modify: `apps/web/src/components/ui/popover.tsx` (two widths and a menu padding), `popover.test.tsx`
- Modify: `apps/web/src/components/app/entity/entity-swatch.tsx` (a `dot` shape), and its test if one exists (`entity-swatch.test.tsx`, else add one)
- Modify: `docs/design-system/25-component-inventory.md` (Select, Popover and EntitySwatch "As built (WP-77)" notes), `apps/web/src/components/design-system/controls-section.tsx` (a "Scope select" specimen: Platform with logos, Runs with notes)
- Create: `apps/web/src/features/citations/scope-toolbar.tsx`, `competitor-picker.tsx`, `scope-toolbar.test.tsx`

- [ ] **Step 1: Write the failing primitive tests**

Append to `apps/web/src/components/ui/select.test.tsx` (it imports `screen`, `Select` and `renderWithProviders`, which returns `user`):

```tsx
describe('Select as a scope control (WP-77)', () => {
  it('names the choice after a prefix and draws an option with its own content and a note', async () => {
    const { user } = renderWithProviders(
      <Select<string>
        aria-label="Runs: Last 4 runs"
        prefix="Runs:"
        value="4"
        onValueChange={() => undefined}
        placeholder="Runs"
        popupClassName="min-w-56"
        options={[
          { value: '4', label: 'Last 4 runs', note: '28 days' },
          { value: '1', label: 'Last run', display: <strong>Last run</strong>, note: 'Sep 28' },
        ]}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Runs: Last 4 runs' });
    expect(trigger).toHaveTextContent('Runs:Last 4 runs');
    await user.click(trigger);
    expect(screen.getByRole('option', { name: /Last run/ })).toHaveTextContent('Sep 28');
  });
});
```

Append to `apps/web/src/components/ui/popover.test.tsx` (it imports `screen`, `Popover` and `renderWithProviders`):

```tsx
it('draws the narrow and wide widths and the menu padding (WP-77)', async () => {
  const { user } = renderWithProviders(
    <Popover trigger={<button type="button">Open</button>} aria-label="Competitors to compare" width="narrow" padding="menu">
      <p>Body</p>
    </Popover>,
  );
  await user.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = screen.getByRole('dialog', { name: 'Competitors to compare' });
  expect(dialog.className).toContain('w-64');
});
```

`apps/web/src/components/app/entity/entity-swatch.test.tsx` (new; the component has no test file yet):

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntitySwatch } from './entity-swatch';

describe('EntitySwatch', () => {
  it('draws a round dot, the third-party dot in the other color (WP-77, C 128 to 133)', () => {
    const { container } = render(
      <>
        <EntitySwatch colorIndex={3} own={false} shape="dot" />
        <EntitySwatch colorIndex={null} own={false} shape="dot" />
      </>,
    );
    const [competitor, other] = [...container.querySelectorAll('span')];
    expect(competitor?.className).toContain('rounded-full');
    expect(competitor?.className).toContain('bg-chart-3');
    expect(other?.className).toContain('bg-chart-other');
  });
});
```

Run: `cd apps/web && pnpm vitest run src/components/ui/select.test.tsx src/components/ui/popover.test.tsx src/components/app/entity/entity-swatch.test.tsx`
Expected: FAIL on the new cases (unknown props).

- [ ] **Step 2: Extend the primitives**

`select.tsx`, the new members of `SelectOption<TValue>`:

```ts
  /** What the list and the trigger show in place of the label, such as an engine's logo and name. The label stays the option's text for typeahead. */
  display?: ReactNode | undefined;
  /** A short fact at the end of the row, in meta type: "28 days" (C 116). */
  note?: string | undefined;
```

and of `SelectProps<TValue>`:

```ts
  /** Text before the value in the trigger, in secondary type: "Platform:" (aiov-controls.js line 66). */
  prefix?: string | undefined;
  /** Layout of the popup only, its width: `min-w-52` (C 114). */
  popupClassName?: string | undefined;
```

`Option` draws `option.display ?? option.label` inside `SelectPrimitive.ItemText`, then, when `option.note` is set, `<span className="ml-auto shrink-0 pl-4 type-meta">{option.note}</span>` after the label column (the label column gets `flex-1`). The trigger loses `justify-between`, gains `gap-2`, and holds, in order: `prefix` as `<span className="shrink-0 text-foreground-secondary">{prefix}</span>`; `SelectPrimitive.Value` with the child function `(current: TValue | null) => { const option = options.find((candidate) => candidate.value === current); return option === undefined ? placeholder : (option.display ?? option.label); }` (Base UI's `SelectValueProps.children` takes a function, `node_modules/@base-ui/react/select/value/SelectValue.d.ts` line 32); the icon with `ml-auto`. `popupClassName` joins the popup's `cn(...)`. `ReactNode` joins the `react` type import. Existing callers pass none of these and render as before.

`popover.tsx`: `PopoverWidth` gains `'narrow'` and `'wide'`, `padding` gains `'menu'` and `'none'`:

```ts
  narrow: cn('w-64 max-w-[min(16rem,var(--available-width))]'),
  wide: cn('w-96 max-w-[min(24rem,var(--available-width))]'),
```

in `WIDTH_CLASS`, and `menu: cn('p-1')` and `none: ''` in `PADDING_CLASS` (`menu`: the menu's own 4 px, C 123; `none`: a popup whose sections pad themselves, C 416 to 441). The doc comment of `width` says: "`narrow` (256 px) and `wide` (384 px) are the Citations pickers' fixed widths".

`entity-swatch.tsx`:

```tsx
export function EntitySwatch({
  colorIndex,
  own,
  shape = 'square',
}: {
  colorIndex: number | null;
  own: boolean;
  /** `dot`: the round mark of the Citations page (C 128 to 133); a third party there is a solid `chart-other` dot. */
  shape?: 'square' | 'dot' | undefined;
}): ReactNode {
  const fill = own ? FILL[1] : colorIndex === null ? undefined : FILL[colorIndex];
  const dot = shape === 'dot';
  return (
    <span
      aria-hidden="true"
      data-color-index={own ? 1 : (colorIndex ?? undefined)}
      className={cn(
        'size-2 shrink-0',
        dot ? 'rounded-full' : 'rounded-xs',
        fill ?? (dot ? 'bg-chart-other' : 'border border-dashed border-chart-other'),
      )}
    />
  );
}
```

Run the three test files again: PASS.

- [ ] **Step 3: Write the failing toolbar test**

`apps/web/src/features/citations/scope-toolbar.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseBoard } from './board-state';
import { ScopeToolbar, type ScopeToolbarProps } from './scope-toolbar';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const TRACKED = ['HubSpot', 'Pipedrive', 'Salesforce', 'Zoho', 'Freshsales', 'Close'].map((name, index) => ({
  id: `c${String(index + 1)}`,
  name,
  colorIndex: index + 2,
  domain: `${name.toLowerCase()}.com`,
}));
const DAYS = ['09-28', '09-21', '09-14', '09-07', '08-31', '08-24', '08-17', '08-10'];
const TREND = [8, 7, 6, 5, 4, 3, 2, 1].map((slot) => ({
  slot,
  first_at: `2026-${DAYS[slot - 1] ?? ''}T00:10:00.000Z`,
  last_at: `2026-${DAYS[slot - 1] ?? ''}T00:15:00.000Z`,
  answers: 10,
}));

function setup(overrides: Partial<ScopeToolbarProps> = {}) {
  const onChange = vi.fn();
  const props: ScopeToolbarProps = {
    state: parseBoard({}, { engines: ['chatgpt_web', 'gemini_web'], terms: new Set(['t1']), tracked: TRACKED.map((c) => c.id) }),
    engines: [
      { code: 'chatgpt_web', label: 'ChatGPT' },
      { code: 'gemini_web', label: 'Gemini' },
    ],
    terms: [{ id: 't1', name: 'Pricing' }],
    tracked: TRACKED,
    trend: TREND,
    timeZone: 'Europe/Berlin',
    latest: '2026-09-28T00:15:00.000Z',
    isDefaultScope: true,
    onChange,
    onReset: vi.fn(),
    onExport: vi.fn(),
    exporting: false,
    pickerOpen: false,
    onPickerOpenChange: vi.fn(),
    ...overrides,
  };
  return { onChange, props, ...renderWithProviders(<ScopeToolbar {...props} />) };
}

describe('the Citations toolbar', () => {
  it('names the page and its three selects after their choice', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Citations' })).toHaveClass('sr-only');
    const scope = screen.getByRole('group', { name: 'Scope' });
    expect(within(scope).getByRole('combobox', { name: 'Platform: All platforms' })).toBeVisible();
    expect(within(scope).getByRole('button', { name: 'Group: All groups' })).toBeVisible();
    expect(within(scope).getByRole('combobox', { name: 'Runs: Last 4 runs' })).toBeVisible();
  });

  it('notes the runs choices with their dates (C 116)', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Runs: Last 4 runs' }));
    expect(screen.getByRole('option', { name: /Last 4 runs/ })).toHaveTextContent('28 days');
    expect(screen.getByRole('option', { name: /Last 2 runs/ })).toHaveTextContent('Sep 21 to Sep 28');
    expect(screen.getByRole('option', { name: /Last run/ })).toHaveTextContent('Sep 28');
  });

  it('chooses a platform', async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Platform: All platforms' }));
    await user.click(screen.getByRole('option', { name: /Gemini/ }));
    expect(onChange).toHaveBeenCalledWith({ platform: 'gemini_web' });
  });

  it('says the first two competitors and how many more (C 135 to 140)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Competitors: HubSpot, Pipedrive, Salesforce' })).toHaveTextContent(
      'Competitors:HubSpot, Pipedrive +1',
    );
  });

  it('keeps the tracked order, counts the choice and disables the rest at five (C 142 to 167)', async () => {
    const onPickerOpenChange = vi.fn();
    const { user, onChange } = setup({
      pickerOpen: true,
      onPickerOpenChange,
      state: { ...parseBoard({}, { engines: null, terms: null, tracked: null }), competitors: ['c3', 'c1'] },
    });
    const dialog = screen.getByRole('dialog', { name: 'Competitors to compare' });
    expect(within(dialog).getByText('2 of 5')).toBeVisible();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Pipedrive' }));
    expect(onChange).toHaveBeenCalledWith({ competitors: ['c1', 'c2', 'c3'] });
    expect(within(dialog).getByText('Up to 5 tracked competitors. Manage the list in Settings.')).toBeVisible();
  });

  it('disables the competitors past five', () => {
    setup({
      pickerOpen: true,
      state: { ...parseBoard({}, { engines: null, terms: null, tracked: null }), competitors: ['c1', 'c2', 'c3', 'c4', 'c5'] },
    });
    expect(screen.getByRole('checkbox', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'HubSpot' })).toBeEnabled();
  });

  it('hides Reset at the default scope and shows it otherwise (C 696 to 698)', () => {
    const { unmount } = setup();
    expect(screen.queryByRole('button', { name: 'Reset scope' })).not.toBeInTheDocument();
    unmount();
    setup({ isDefaultScope: false });
    expect(screen.getByRole('button', { name: 'Reset scope' })).toBeVisible();
  });

  it('is accessible', async () => {
    const { container } = setup({ isDefaultScope: false });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

At the default scope the toolbar keeps Reset's empty slot and renders no button (Step 5), so `queryByRole` finds nothing; jsdom applies no stylesheet, so the test does not rely on `invisible`.

Run: `cd apps/web && pnpm vitest run src/features/citations/scope-toolbar.test.tsx`
Expected: FAIL, `./scope-toolbar` does not exist.

- [ ] **Step 4: Write the competitors picker**

`apps/web/src/features/citations/competitor-picker.tsx`:

```tsx
'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { TrackedCompetitor } from './board-reads';
import { MAX_COMPETITORS } from './board-state';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { inputVariants } from '@/components/ui/input-variants';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface CompetitorPickerProps {
  tracked: readonly TrackedCompetitor[];
  chosen: readonly string[];
  onChange: (ids: readonly string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Competitors (C 118 to 173): a multi-select of the tracked competitors, at most five, the columns of the gap analysis.
 * The popover stays open after a change; its count and the disabled rows follow the choice, which keeps the tracked
 * order so the columns never jump (C 156 to 157).
 */
export function CompetitorPicker({ tracked, chosen, onChange, open, onOpenChange }: CompetitorPickerProps): ReactElement {
  const t = useTranslations('citations');
  const names = chosen.flatMap((id) => tracked.find((competitor) => competitor.id === id)?.name ?? []);
  const shown =
    names.length === 0
      ? t('toolbar.competitorsNone')
      : names.length <= 2
        ? names.join(', ')
        : t('toolbar.competitorsMore', { names: names.slice(0, 2).join(', '), count: names.length - 2 });
  const full = chosen.length >= MAX_COMPETITORS;
  const toggle = (id: string, on: boolean): void => {
    const next = on ? [...chosen, id] : chosen.filter((value) => value !== id);
    onChange(tracked.map((competitor) => competitor.id).filter((value) => next.includes(value)));
  };
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      aria-label={t('competitorPicker.label')}
      width="narrow"
      padding="menu"
      align="start"
      trigger={
        <button
          type="button"
          aria-label={
            names.length === 0
              ? t('toolbar.competitorsLabelNone')
              : t('toolbar.competitorsLabel', { names: names.join(', ') })
          }
          className={cn(
            inputVariants({ variant: 'outline', size: 'md' }),
            'flex w-full max-w-full min-w-0 items-center gap-2 text-left whitespace-nowrap hover:bg-surface-hover aria-expanded:bg-surface-hover sm:w-60',
          )}
        >
          <span className="text-foreground-secondary">{t('toolbar.competitors')}</span>
          <span className="truncate">{shown}</span>
          <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary" />
        </button>
      }
    >
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-2">
        <span className="type-label text-foreground-secondary">{t('competitorPicker.head')}</span>
        <span className="ml-auto num type-meta">
          {t('competitorPicker.count', { count: chosen.length, max: MAX_COMPETITORS })}
        </span>
      </div>
      <div className="flex flex-col">
        {tracked.map((competitor) => {
          const on = chosen.includes(competitor.id);
          const disabled = !on && full;
          return (
            <div
              key={competitor.id}
              className={cn(
                'flex h-control-sm items-center gap-2 rounded-md px-2 type-body text-foreground',
                disabled ? 'opacity-50' : 'hover:bg-surface-hover',
              )}
            >
              <Checkbox
                checked={on}
                disabled={disabled}
                label={competitor.name}
                labelDisplay="visually-hidden"
                onCheckedChange={(next) => toggle(competitor.id, next)}
              />
              <EntitySwatch colorIndex={competitor.colorIndex} own={false} shape="dot" />
              <span aria-hidden="true" className="truncate">
                {competitor.name}
              </span>
              {competitor.domain === null ? null : <span className="ml-auto type-meta">{competitor.domain}</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-1 border-t border-border-subtle px-2 pt-2 pb-1.5 type-meta">
        {t('competitorPicker.foot', { max: MAX_COMPETITORS })}
      </p>
    </Popover>
  );
}
```

`Checkbox` spreads its other props onto `CheckboxPrimitive.Root` (`checkbox.tsx` line 54), so Base UI's `onCheckedChange(checked, details)` is the change callback.

- [ ] **Step 5: Write the toolbar**

`apps/web/src/features/citations/scope-toolbar.tsx`:

```tsx
'use client';

import { ChevronDown, Download, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { BoardEngine, TopicTerm, TrackedCompetitor } from './board-reads';
import { RUN_CHOICES, type BoardState, type Platform } from './board-state';
import { runsLabel, runsNote } from './board-text';
import { CompetitorPicker } from './competitor-picker';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { inputVariants } from '@/components/ui/input-variants';
import { Select, type SelectOption } from '@/components/ui/select';
import type { RunSlot, RunsChoice } from '@/lib/citations/board-queries';
import { cn } from '@/lib/utils';

export interface ScopeToolbarProps {
  state: BoardState;
  engines: readonly BoardEngine[];
  /** The topic terms; `null` while they load. */
  terms: readonly TopicTerm[] | null;
  tracked: readonly TrackedCompetitor[] | null;
  /** `window.trend` of the overview read, for the Runs notes. */
  trend: readonly RunSlot[];
  timeZone: string;
  latest: string | null;
  isDefaultScope: boolean;
  onChange: (patch: Partial<BoardState>) => void;
  onReset: () => void;
  onExport: () => void;
  exporting: boolean;
  /** The competitors popover, which the gap tab's empty state opens too (C 681). */
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}

interface GroupChoice {
  id: string;
  name: string;
}

const TRIGGER = cn(
  inputVariants({ variant: 'outline', size: 'md' }),
  'flex w-full max-w-full min-w-0 items-center gap-2 text-left whitespace-nowrap hover:bg-surface-hover aria-expanded:bg-surface-hover',
);

/**
 * The toolbar (C 110 to 198): the scope on the left, as a two column grid below 1024 px and a wrapping row from it,
 * Export at the right. Freshness is the table footer's (C 188). The page title is for screen readers only (3.1).
 */
export function ScopeToolbar(props: ScopeToolbarProps): ReactElement {
  const t = useTranslations('citations');
  const { state, engines, terms, tracked, trend, timeZone, latest, onChange } = props;

  const platformOptions = useMemo(
    (): readonly SelectOption<Platform>[] => [
      { value: 'all', label: t('toolbar.allPlatforms') },
      ...engines.map((engine) => ({
        value: engine.code,
        label: engine.label,
        display: <EngineLogo engine={engine.code} name={engine.label} truncate />,
      })),
    ],
    [engines, t],
  );
  const platformLabel = platformOptions.find((option) => option.value === state.platform)?.label ?? '';

  const runOptions = useMemo(
    (): readonly SelectOption<string>[] =>
      RUN_CHOICES.map((choice: RunsChoice) => ({
        value: String(choice),
        label: runsLabel(choice, t),
        note: runsNote(choice, trend, timeZone, latest, t) ?? undefined,
      })),
    [trend, timeZone, latest, t],
  );

  const everyGroup = useMemo((): GroupChoice => ({ id: 'all', name: t('toolbar.allGroups') }), [t]);
  const groupChoices = useMemo(
    (): readonly GroupChoice[] => [everyGroup, ...(terms ?? []).map((term) => ({ id: term.id, name: term.name }))],
    [everyGroup, terms],
  );
  const group = groupChoices.find((choice) => choice.id === state.group) ?? everyGroup;

  return (
    <section aria-label={t('toolbar.label')} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="sr-only">{t('title')}</h1>
      <div
        role="group"
        aria-label={t('toolbar.scope')}
        className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center"
      >
        <Select<Platform>
          aria-label={t('toolbar.trigger', { name: t('toolbar.platform'), value: platformLabel })}
          prefix={t('toolbar.prefix', { name: t('toolbar.platform') })}
          placeholder={t('toolbar.allPlatforms')}
          value={state.platform}
          onValueChange={(platform) => onChange({ platform })}
          options={platformOptions}
          popupClassName="min-w-52"
          className="w-full min-w-0 sm:w-56"
        />
        <Combobox<GroupChoice>
          value={group}
          onValueChange={(next) => {
            if (next !== null && next.id !== state.group) onChange({ group: next.id });
          }}
          items={groupChoices}
          itemToString={(choice) => choice.name}
          itemKey={(choice) => choice.id}
          emptyText={(query) => t('toolbar.groupEmpty', { query })}
          placeholder={t('toolbar.groupSearch')}
          clearLabel={t('toolbar.groupClear')}
          openLabel={t('toolbar.groupOpen')}
          trigger={
            <button type="button" className={cn(TRIGGER, 'sm:w-52')}>
              <span className="text-foreground-secondary">{t('toolbar.prefix', { name: t('toolbar.group') })}</span>
              <span className="truncate">{group.name}</span>
              <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary" />
            </button>
          }
          triggerLabel={t('toolbar.trigger', { name: t('toolbar.group'), value: group.name })}
        />
        <Select<string>
          aria-label={t('toolbar.trigger', { name: t('toolbar.runs'), value: runsLabel(state.runs, t) })}
          prefix={t('toolbar.prefix', { name: t('toolbar.runs') })}
          placeholder={t('toolbar.runs')}
          value={String(state.runs)}
          onValueChange={(value) => {
            const runs = RUN_CHOICES.find((choice) => String(choice) === value);
            if (runs !== undefined) onChange({ runs });
          }}
          options={runOptions}
          popupClassName="min-w-56"
          className="w-full min-w-0 sm:w-44"
        />
        <CompetitorPicker
          tracked={tracked ?? []}
          chosen={state.competitors}
          onChange={(competitors) => onChange({ competitors })}
          open={props.pickerOpen}
          onOpenChange={props.onPickerOpenChange}
        />
        {/* Invisible keeps its place in the desktop row; in the two column phone grid it would leave an empty row (C 696 to 698) */}
        <span className={cn('flex size-control shrink-0', props.isDefaultScope && 'invisible max-lg:hidden')}>
          {props.isDefaultScope ? null : (
            <IconButton icon={Undo2} variant="ghost" size="icon" label={t('toolbar.reset')} onClick={props.onReset} />
          )}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-x-4 xl:ml-auto">
        <Button variant="secondary" icon={Download} loading={props.exporting} onClick={props.onExport}>
          {t('toolbar.export')}
        </Button>
      </div>
    </section>
  );
}
```

The Reset slot keeps its 36 px box at the default scope on desktop (`invisible`), is gone from the phone grid (`max-lg:hidden`), and holds the button only when the scope is changed, so neither a pointer nor the keyboard reaches an invisible control.

Combobox's popup is the house one (its own width, `min-w-(--anchor-width)`), not the preview's `min-w-60`: Open point 10.

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && pnpm vitest run src/features/citations/scope-toolbar.test.tsx src/components/ui/select.test.tsx src/components/ui/popover.test.tsx src/components/app/entity/entity-swatch.test.tsx`
Expected: PASS.

- [ ] **Step 7: Document the variants**

- `docs/design-system/25-component-inventory.md`, under the Select entry (section 3, "Select"): "> As built (WP-77): `prefix` (text before the value, secondary), `SelectOption.display` (a node in place of the label, such as `EngineLogo`), `SelectOption.note` (a meta fact at the row's end) and `popupClassName` (the popup's width). The Citations page's Platform and Runs selects use them (preview `aiov-controls.js` `createSelect`)."
- Same file, Popover entry: "> As built (WP-77): widths `narrow` (256 px) and `wide` (384 px), both capped by the available width, and paddings `menu` (4 px) and `none` (the sections pad themselves), for the Citations competitors and prompts pickers."
- Same file, EntitySwatch entry: "> As built (WP-77): `shape="dot"` draws a round 8 px mark; with no color index it is a solid `chart-other` dot, the third-party mark of the Citations page."
- `apps/web/src/components/design-system/controls-section.tsx`: a `SpecimenGroup` titled "Scope select" with a Platform select (All platforms, ChatGPT and Gemini with `EngineLogo`) and a Runs select with the three notes; note "WP-77. A prefix names the control; a note gives each choice its dates."

- [ ] **Step 8: Checks and commit**

Run: `cd apps/web && pnpm prettier --write src/components/ui/select*.tsx src/components/ui/popover*.tsx src/components/app/entity src/components/design-system/controls-section.tsx src/features/citations/scope-toolbar*.tsx src/features/citations/competitor-picker.tsx && pnpm lint && pnpm typecheck && pnpm vitest run src/components && pnpm format:check`
Expected: green; the `src/components` run catches a primitive change that breaks another caller.

```bash
git add apps/web/src/components/ui/select.tsx apps/web/src/components/ui/select.test.tsx apps/web/src/components/ui/popover.tsx apps/web/src/components/ui/popover.test.tsx apps/web/src/components/app/entity apps/web/src/components/design-system/controls-section.tsx docs/design-system/25-component-inventory.md apps/web/src/features/citations/scope-toolbar.tsx apps/web/src/features/citations/competitor-picker.tsx apps/web/src/features/citations/scope-toolbar.test.tsx
git commit -m "WP-77: Citations toolbar with scope selects and competitors picker"
```

---

### Task 5: Metric strip

Brief step 4. Parity rows: 3.3, every row (C 200 to 257; `trendIcon` of `prompts-parts.js` lines 28 to 45 for the rate deltas).

**Files:**
- Modify: `apps/web/src/components/app/metric/metric-strip.tsx` (the `line` size; `detail` and `spoken` on an item), `metric-strip.test.tsx`
- Create: `apps/web/src/components/app/metric/trend-icon.tsx`, `trend-icon.test.tsx`
- Create: `apps/web/src/features/citations/measures-model.ts`, `measures-model.test.ts`, `measures-strip.tsx`, `measures-strip.test.tsx`
- Modify: `docs/design-system/25-component-inventory.md` (9.1 MetricStrip, a new TrendIcon entry after 9.x Delta), `docs/design-system/23-application-patterns.md` (a new 2.9 "Line size", after 2.8 "Inline size"), `apps/web/src/components/design-system/data-display-section.tsx` (a `line` specimen), `metric-parts-section.tsx` (TrendIcon up, down, flat; detectable and not)

Design:
- `MetricStrip size="line"` is the preview's strip: one `dl`, `grid-cols-2`, `@xl:grid-cols-3`, `@5xl:grid-cols-6` by the strip's own width (a container query on its group), `gap-px` on `bg-border-subtle`, rounded border; each slot one 36 px line (`h-control`), the label at the left (`type-meta`, truncates), the figure at the right (`type-body-strong num`), the delta after it. No info buttons. The figure is the tab stop; its `aria-label` is the item's `spoken` text ("Total citations: 405. How many times ..."); both the label and the figure show the tooltip (C 223 to 242). A delta's own figures (the trend sentence, "N before ...") are the tooltip's second line (`detail`), since a tooltip inside the figure's tooltip cannot open on its own (Open point 11).
- `TrendIcon` is the preview's `trendIcon` as a house component: trending-up, trending-down or a minus at 14 px, the tone from `formatMetricDelta` (house rule 6: a colour only when the change is detectable; Open point 3), and the spoken words in a visually hidden span.
- The pure model computes every value, context, tooltip and delta from `CitationOverview`, the scope's platform count and the `previousText` of Task 3; the component only draws.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/citations/measures-model.test.ts`:

```ts
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { measureSlots, type MeasureInput } from './measures-model';
import messages from '../../../messages/en.json';
import type { CitationOverview } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const PREVIOUS = { full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' };

const engine = (
  code: 'chatgpt_web' | 'gemini_web',
  [answers, citing, prompts, promptsCiting]: readonly [number, number, number, number],
  [pAnswers, pCiting, pPrompts, pPromptsCiting]: readonly [number, number, number, number],
): CitationOverview['engines'][number] => ({
  engine_code: code,
  answers,
  answers_citing: citing,
  prompts,
  prompts_citing: promptsCiting,
  previous_answers: pAnswers,
  previous_answers_citing: pCiting,
  previous_prompts: pPrompts,
  previous_prompts_citing: pPromptsCiting,
});

const OVERVIEW: CitationOverview = {
  citations: 60,
  previous_citations: 50,
  matched_citations: 58,
  matched_previous_citations: 49,
  matched_pairs: 60,
  own_urls: 8,
  previous_own_urls: 6,
  domains: 20,
  previous_domains: 20,
  engines: [engine('chatgpt_web', [100, 25, 40, 20], [100, 20, 40, 16]), engine('gemini_web', [50, 5, 30, 6], [50, 5, 30, 6])],
  window: {
    runs: 4,
    timezone: 'Europe/Berlin',
    current: [],
    previous: [],
    trend: [],
    answers: 150,
    prompts: 45,
    latest_answer_at: '2026-09-28T00:15:00.000Z',
    latest_run_number: 48,
  },
};
const ALL: MeasureInput = { overview: OVERVIEW, allPlatforms: true, ownDomain: 'fynix.digital', previous: PREVIOUS };
const slot = (input: MeasureInput, id: string) => {
  const found = measureSlots(input, t).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No slot ${id}`);
  return found;
};

describe('the six Citations measures (C 244 to 257)', () => {
  it('names the six slots in order', () => {
    expect(measureSlots(ALL, t).map((item) => item.label)).toEqual([
      'Total citations',
      'Citation rate',
      'Prompt coverage',
      'Unique cited URLs',
      'Unique cited domains',
      'Citation growth',
    ]);
  });

  it.each([
    [
      'citations',
      '60',
      'How many times AI answers cite a page of your site. In 150 answers. Citations of fynix.digital pages in 150 answers to 45 prompts. One URL in one answer’s list of citations counts once. An answer that cites two of your pages counts twice.',
    ],
    [
      'frequency',
      '17.5%',
      'The share of answers that cite your site at least once. Average of 2 platforms. 30 of 150 answers cite you, summed over the platforms. The rate is their equal-weight average. Change against the previous 4 runs (Aug 10 to Aug 31). Answers that cite you, divided by all valid answers. Over All platforms it is the equal-weight average of the platforms, never pooled.',
    ],
    [
      'coverage',
      '35.0%',
      'The share of tracked prompts that cite your site at least once in these runs. Average of 2 platforms. 26 of 70 prompts cite you, summed over the platforms. The rate is their equal-weight average. Change against the previous 4 runs (Aug 10 to Aug 31). Prompts with at least one answer citing you, divided by prompts with an answer. Over All platforms it is the equal-weight average of the platforms.',
    ],
    [
      'urls',
      '8',
      'How many different pages of your site AI answers cite. Pages of fynix.digital. Distinct URLs on fynix.digital in the citation lists of the answers in scope.',
    ],
    [
      'domains',
      '20',
      'How many different domains AI answers cite for your prompts: the field you compete in for citations. In answers to your prompts. Distinct domains in the citation lists of the answers in scope, your site included.',
    ],
    [
      'growth',
      '+20.0%',
      'How total citations changed against the same number of runs before. +10 vs the previous 4 runs. 60 citations now, 50 in the previous 4 runs (Aug 10 to Aug 31). Total citations now minus before, divided by before. Not tested for detectability.',
    ],
  ])('derives the %s slot over All platforms', (id, value, hint) => {
    const item = slot(ALL, id);
    expect(item.value).toBe(value);
    expect(item.hint).toBe(hint);
    expect(item.spoken).toBe(`${item.label}: ${value}. ${hint}`);
  });

  it('gives the rates a trend delta, neutral while it is not detectable (rule 6)', () => {
    expect(slot(ALL, 'frequency').delta).toEqual({
      kind: 'points',
      input: { value: expect.closeTo(0.025, 10), unit: 'points', polarity: 'higher_is_better', isDetectable: false },
      tip: 'Up 2.5 pts against the previous period, from 15% to 18%. Within normal variation.',
      spoken: 'Up 2.5 pts, within normal variation',
    });
  });

  it('gives a changed count a neutral signed delta, and nothing when it is equal', () => {
    expect(slot(ALL, 'urls').delta).toEqual({
      kind: 'count',
      text: '+2',
      tip: '6 before. Counts are not tested for detectability',
    });
    expect(slot(ALL, 'domains').delta).toBeNull();
    expect(slot(ALL, 'citations').delta).toBeNull();
    expect(slot(ALL, 'growth').delta).toBeNull();
  });

  it('counts one platform as k of n (C 246 to 247)', () => {
    const one: MeasureInput = { ...ALL, allPlatforms: false, overview: { ...OVERVIEW, engines: OVERVIEW.engines.slice(0, 1) } };
    expect(slot(one, 'frequency').value).toBe('25.0%');
    expect(slot(one, 'frequency').hint).toContain(' 25 of 100 answers. 25 of 100 answers cite you. Change against');
    expect(slot(one, 'coverage').hint).toContain(' 20 of 40 prompts. 20 of 40 prompts cite you. Change against');
    expect(slot(one, 'frequency').delta).toMatchObject({ tip: 'Up 5.0 pts against the previous period, from 20% to 25%. Within normal variation.' });
  });

  it('reads n/a with no answers and no previous citations', () => {
    const none: MeasureInput = {
      ...ALL,
      overview: {
        ...OVERVIEW,
        citations: 0,
        previous_citations: 0,
        engines: [engine('chatgpt_web', [0, 0, 0, 0], [0, 0, 0, 0])],
      },
    };
    expect(slot(none, 'frequency')).toMatchObject({ value: 'n/a', unknown: true, delta: null });
    expect(slot(none, 'frequency').hint).toBe(
      'The share of answers that cite your site at least once. No answers. Answers that cite you, divided by all valid answers. Over All platforms it is the equal-weight average of the platforms, never pooled.',
    );
    expect(slot(none, 'growth')).toMatchObject({ value: 'n/a', unknown: true });
  });

  it('colors a detectable change through formatMetricDelta', () => {
    const big: MeasureInput = {
      ...ALL,
      allPlatforms: false,
      overview: { ...OVERVIEW, engines: [engine('chatgpt_web', [1000, 400, 100, 60], [1000, 200, 100, 40])] },
    };
    expect(slot(big, 'frequency').delta).toMatchObject({
      input: { isDetectable: true },
      spoken: 'Up 20.0 pts, detectable change',
    });
  });
});
```

`apps/web/src/components/app/metric/trend-icon.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrendIcon } from './trend-icon';

describe('TrendIcon', () => {
  it('draws up in green only when the change is detectable, and says it in words', () => {
    const { container, rerender } = render(
      <TrendIcon input={{ value: 0.2, unit: 'points', polarity: 'higher_is_better', isDetectable: true }} spoken="Up 20.0 pts, detectable change" />,
    );
    expect(container.firstElementChild?.className).toContain('text-positive-text');
    expect(screen.getByText('Up 20.0 pts, detectable change')).toHaveClass('sr-only');
    rerender(
      <TrendIcon input={{ value: 0.02, unit: 'points', polarity: 'higher_is_better', isDetectable: false }} spoken="Up 2.0 pts, within normal variation" />,
    );
    expect(container.firstElementChild?.className).toContain('text-foreground-secondary');
  });

  it('draws a flat change as a minus', () => {
    const { container } = render(
      <TrendIcon input={{ value: 0.0001, unit: 'points', polarity: 'higher_is_better', isDetectable: false }} spoken="No change" />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.firstElementChild?.getAttribute('data-direction')).toBe('flat');
  });
});
```

Append to `apps/web/src/components/app/metric/metric-strip.test.tsx` (it imports `screen`, `MetricStrip` and `renderWithProviders`):

```tsx
describe('the line strip (WP-77)', () => {
  it('draws each slot on one line with its figure as the tab stop that speaks the whole hint', () => {
    renderWithProviders(
      <MetricStrip
        size="line"
        label="Citation measures"
        status="ready"
        groups={[
          {
            id: 'ai',
            items: [
              { id: 'citations', label: 'Total citations', value: '405', tip: 'How many times ...', spoken: 'Total citations: 405. How many times ...' },
              { id: 'growth', label: 'Citation growth', value: 'n/a', unknown: { kind: 'not-applicable' }, tip: 'How total ...', spoken: 'Citation growth: n/a. How total ...' },
            ],
          },
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Citation measures' });
    expect(group).toHaveClass('@container');
    expect(screen.getByLabelText('Total citations: 405. How many times ...')).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('n/a')).toHaveClass('text-foreground-tertiary');
  });
});
```

`apps/web/src/features/citations/measures-strip.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MeasuresStrip } from './measures-strip';
import type { CitationOverview } from '@/lib/citations/board-queries';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const OVERVIEW: CitationOverview = {
  citations: 60,
  previous_citations: 50,
  matched_citations: 58,
  matched_previous_citations: 49,
  matched_pairs: 60,
  own_urls: 8,
  previous_own_urls: 6,
  domains: 20,
  previous_domains: 20,
  engines: [
    {
      engine_code: 'chatgpt_web',
      answers: 100,
      answers_citing: 25,
      prompts: 40,
      prompts_citing: 20,
      previous_answers: 100,
      previous_answers_citing: 20,
      previous_prompts: 40,
      previous_prompts_citing: 16,
    },
  ],
  window: {
    runs: 4,
    timezone: 'Europe/Berlin',
    current: [],
    previous: [],
    trend: [],
    answers: 100,
    prompts: 40,
    latest_answer_at: null,
    latest_run_number: null,
  },
};

describe('the Citations strip', () => {
  it('draws the six measures with their deltas, and is accessible', async () => {
    const { container } = renderWithProviders(
      <MeasuresStrip
        overview={OVERVIEW}
        status="ready"
        allPlatforms={false}
        ownDomain="fynix.digital"
        previous={{ full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Citation measures' })).toBeVisible();
    expect(screen.getByLabelText(/^Total citations: 60\. /)).toBeVisible();
    expect(screen.getByText('Up 5.0 pts, within normal variation')).toHaveClass('sr-only');
    expect(screen.getByText('+2')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps the labels and draws skeletons while loading', () => {
    renderWithProviders(
      <MeasuresStrip overview={undefined} status="loading" allPlatforms ownDomain="fynix.digital" previous={{ full: '', short: '' }} />,
    );
    expect(screen.getByText('Total citations')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Citation measures' })).toHaveAttribute('aria-busy', 'true');
  });
});
```

Run: `cd apps/web && pnpm vitest run src/features/citations/measures-model.test.ts src/features/citations/measures-strip.test.tsx src/components/app/metric/trend-icon.test.tsx src/components/app/metric/metric-strip.test.tsx`
Expected: FAIL, the modules and the `line` size do not exist.

- [ ] **Step 2: Write `TrendIcon`**

`apps/web/src/components/app/metric/trend-icon.tsx`:

```tsx
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { formatMetricDelta, type MetricDeltaInput } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  neutral: 'text-foreground-secondary',
} as const;

/** A change of a rate that rounds to nothing (C 29 of prompts-parts.js: under half a hundredth of a point). */
const FLAT = 0.0005;

export interface TrendIconProps {
  /** A change in points; the tone comes from `formatMetricDelta`, so it is coloured only when detectable. */
  input: MetricDeltaInput;
  /** What a screen reader says in its place: "Up 2.5 pts, within normal variation". */
  spoken: string;
}

/**
 * The change of a rate as a trend icon, as price tables show it (preview `trendIcon`): up, down, or a minus when it
 * rounds to nothing. The figures are the tooltip of what holds it; shape and colour are said in words too.
 */
export function TrendIcon({ input, spoken }: TrendIconProps): ReactElement {
  const value = input.value ?? 0;
  const direction = Math.abs(value) < FLAT ? 'flat' : value > 0 ? 'up' : 'down';
  const { tone } = formatMetricDelta(direction === 'flat' ? { ...input, value: 0 } : input);
  return (
    <span data-direction={direction} className={cn('inline-flex shrink-0 self-center', TONE[tone])}>
      <Icon icon={direction === 'flat' ? Minus : direction === 'up' ? TrendingUp : TrendingDown} size="sm" />
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
```

`ChangeTone` of `@/lib/format` is `'positive' | 'negative' | 'neutral'`; if it has more members, add them to `TONE` with the same classes `Delta` uses.

- [ ] **Step 3: Add the `line` size to `MetricStrip`**

In `metric-strip.tsx`:
- `MetricStripItem` gains `detail?: string | undefined` ("A second, lighter line of the tooltip: the figures of the delta. `line` strips only.") and `spoken?: string | undefined` ("The figure's accessible name in a `line` strip: the label, the value and the whole tooltip, since the figure is the tab stop.").
- `MetricStripProps['size']` gains `'line'` ("`line`: one 36 px line per slot, label left and figure right, 2, 3 or 6 columns by the strip's own width, for an analysis board such as Citations (23 section 2.9)").
- A branch before the `inline` branch:

```tsx
  if (size === 'line') {
    return (
      <div role="group" aria-label={label} aria-busy={status === 'ready' ? undefined : true} className="@container">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border-subtle @xl:grid-cols-3 @5xl:grid-cols-6">
          {items.map(({ item }) => {
            const tipped = item.tip !== undefined && status !== 'loading';
            const unknown = item.unknown !== null && item.unknown !== undefined;
            return (
              <div key={item.id} className="flex h-control min-w-0 items-center gap-2 bg-surface px-3">
                {/* The whole slot shows the tooltip, so the name is a way in too (C 238 to 239) */}
                <Tooltip content={item.tip ?? ''} detail={item.detail} purpose="label" disabled={!tipped}>
                  <dt className="min-w-0 flex-1 truncate type-meta text-foreground-secondary">{item.label}</dt>
                </Tooltip>
                <Tooltip content={item.tip ?? ''} detail={item.detail} purpose="label" disabled={!tipped}>
                  <dd
                    {...(tipped ? { tabIndex: 0, 'aria-label': item.spoken } : {})}
                    className="flex shrink-0 items-center gap-1.5 rounded-sm outline-none focus-visible:focus-ring-inset"
                  >
                    {status === 'loading' ? (
                      <span className="flex w-10 items-center">
                        <Skeleton shape="text-14" widthPct={100} />
                      </span>
                    ) : (
                      <span className={cn('num type-body-strong', unknown ? 'text-foreground-tertiary' : 'text-foreground')}>
                        {item.value}
                      </span>
                    )}
                    {status === 'loading' || item.delta === undefined || item.delta === null ? null : (
                      <span className="shrink-0 type-body-strong">{item.delta}</span>
                    )}
                  </dd>
                </Tooltip>
              </div>
            );
          })}
        </dl>
      </div>
    );
  }
```

`columnsFor` is not used by this branch (the container query decides). The `md`, `sm` and `inline` branches are unchanged.

- [ ] **Step 4: Write the model**

`apps/web/src/features/citations/measures-model.ts`:

```ts
import type { CitationsTranslate, PreviousText } from './board-text';
import type { CitationOverview } from '@/lib/citations/board-queries';
import {
  EMPTY_VALUE,
  formatInteger,
  formatPercent,
  formatPointsDelta,
  formatRelativeChange,
  formatSignedInteger,
  type MetricDeltaInput,
} from '@/lib/format';
import { equalWeightAverage, isDetectableChange, type Counts } from '@/lib/stats';

/** The six measures of the strip (brief 3.3, C 200 to 257). Pure: the overview read and the words in, slots out. */

export type MeasureId = 'citations' | 'frequency' | 'coverage' | 'urls' | 'domains' | 'growth';

export type MeasureDelta =
  /** A rate's change in points, drawn as a `TrendIcon` (C 87 to 89). */
  | { kind: 'points'; input: MetricDeltaInput; tip: string; spoken: string }
  /** A count's signed change, always neutral (C 91 to 97). */
  | { kind: 'count'; text: string; tip: string };

export interface MeasureSlot {
  id: MeasureId;
  label: string;
  value: string;
  unknown: boolean;
  delta: MeasureDelta | null;
  /** What, then the context (capitalised, full stop), then the tip, then how (C 234). */
  hint: string;
  /** The figure's accessible name: "<label>: <value>. <hint>" (C 237). */
  spoken: string;
}

export interface MeasureInput {
  overview: CitationOverview;
  /** All platforms: rates are the equal-weight average of the engines, and the context says so. */
  allPlatforms: boolean;
  /** The project's own registrable domain, which three texts name. */
  ownDomain: string;
  previous: PreviousText;
}

/** A change of a rate that rounds to nothing. */
const FLAT = 0.0005;

interface RateCell {
  value: number | null;
  used: number;
  pooled: Counts;
}

type Engines = CitationOverview['engines'];

/** Per engine, then the equal-weight average of those with answers (D 222 to 233). */
function rateOf(engines: Engines, pick: (engine: Engines[number]) => Counts): RateCell {
  const counts = engines.map(pick);
  const average = equalWeightAverage(counts.map((count) => (count.n > 0 ? count.k / count.n : null)));
  return {
    value: average.value,
    used: average.used,
    pooled: counts.reduce((sum, count) => ({ k: sum.k + count.k, n: sum.n + count.n }), { k: 0, n: 0 }),
  };
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function trendDelta(current: RateCell, previous: RateCell, t: CitationsTranslate): MeasureDelta | null {
  if (current.value === null || previous.value === null) return null;
  const change = current.value - previous.value;
  const detectable = isDetectableChange(current.pooled, previous.pooled) === true;
  const flat = Math.abs(change) < FLAT;
  // "Up 2.5 pts", not "Up +2.5 pts": the word already says the sign (prompts-parts.js line 32)
  const points = formatPointsDelta(Math.abs(change), { decimals: 1 }).replace(/^\+/, '');
  const words = flat ? t('measures.flat') : change > 0 ? t('measures.up', { points }) : t('measures.down', { points });
  // A small change can round to the same whole percent on both sides: then one decimal tells them apart
  const decimals = formatPercent(previous.value, { decimals: 0 }) === formatPercent(current.value, { decimals: 0 }) ? 1 : 0;
  return {
    kind: 'points',
    input: { value: change, unit: 'points', polarity: 'higher_is_better', isDetectable: detectable },
    tip: t('measures.trendTip', {
      words,
      from: formatPercent(previous.value, { decimals }),
      to: formatPercent(current.value, { decimals }),
      verdict: detectable ? t('measures.detectable') : t('measures.notDetectable'),
    }),
    spoken: detectable ? t('measures.spokenDetectable', { words }) : t('measures.spokenNot', { words }),
  };
}

function countDelta(now: number, before: number, t: CitationsTranslate): MeasureDelta | null {
  if (now === before) return null;
  return { kind: 'count', text: formatSignedInteger(now - before), tip: t('measures.countBefore', { count: formatInteger(before) }) };
}

function slotOf(
  parts: { id: MeasureId; label: string; value: string; delta: MeasureDelta | null; what: string; context: string | null; tip: string | null; how: string },
  t: CitationsTranslate,
): MeasureSlot {
  const hint = [parts.what, parts.context === null ? null : `${capitalised(parts.context)}.`, parts.tip, parts.how]
    .filter((part): part is string => part !== null && part !== '')
    .join(' ');
  return {
    id: parts.id,
    label: parts.label,
    value: parts.value,
    unknown: parts.value === EMPTY_VALUE,
    delta: parts.delta,
    hint,
    spoken: t('measures.aria', { label: parts.label, value: parts.value, hint }),
  };
}

export function measureSlots(input: MeasureInput, t: CitationsTranslate): MeasureSlot[] {
  const { overview, allPlatforms, ownDomain, previous } = input;
  const { engines, window } = overview;
  const answersNow = rateOf(engines, (engine) => ({ k: engine.answers_citing, n: engine.answers }));
  const answersBefore = rateOf(engines, (engine) => ({ k: engine.previous_answers_citing, n: engine.previous_answers }));
  const promptsNow = rateOf(engines, (engine) => ({ k: engine.prompts_citing, n: engine.prompts }));
  const promptsBefore = rateOf(engines, (engine) => ({ k: engine.previous_prompts_citing, n: engine.previous_prompts }));

  const rate = (
    id: 'frequency' | 'coverage',
    current: RateCell,
    before: RateCell,
  ): MeasureSlot => {
    const k = formatInteger(current.pooled.k);
    const n = formatInteger(current.pooled.n);
    const known = current.value !== null;
    const words =
      id === 'frequency'
        ? {
            label: t('measures.frequency.label'),
            what: t('measures.frequency.what'),
            how: t('measures.frequency.how'),
            one: t('measures.frequency.contextOne', { k, n }),
            tip: allPlatforms
              ? t('measures.frequency.tipAll', { k, n, previous: previous.full })
              : t('measures.frequency.tipOne', { k, n, previous: previous.full }),
          }
        : {
            label: t('measures.coverage.label'),
            what: t('measures.coverage.what'),
            how: t('measures.coverage.how'),
            one: t('measures.coverage.contextOne', { k, n }),
            tip: allPlatforms
              ? t('measures.coverage.tipAll', { k, n, previous: previous.full })
              : t('measures.coverage.tipOne', { k, n, previous: previous.full }),
          };
    return slotOf(
      {
        id,
        label: words.label,
        value: known ? formatPercent(current.value, { decimals: 1 }) : EMPTY_VALUE,
        delta: known ? trendDelta(current, before, t) : null,
        what: words.what,
        context: !known ? t('measures.noAnswers') : allPlatforms ? t('measures.average', { count: current.used }) : words.one,
        tip: known ? words.tip : null,
        how: words.how,
      },
      t,
    );
  };

  const growth =
    overview.previous_citations > 0
      ? formatRelativeChange((overview.citations - overview.previous_citations) / overview.previous_citations)
      : EMPTY_VALUE;

  return [
    slotOf(
      {
        id: 'citations',
        label: t('measures.citations.label'),
        value: formatInteger(overview.citations),
        delta: null,
        what: t('measures.citations.what'),
        context: t('measures.citations.context', { answers: window.answers }),
        tip: t('measures.citations.tip', { domain: ownDomain, answers: window.answers, prompts: window.prompts }),
        how: t('measures.citations.how'),
      },
      t,
    ),
    rate('frequency', answersNow, answersBefore),
    rate('coverage', promptsNow, promptsBefore),
    slotOf(
      {
        id: 'urls',
        label: t('measures.urls.label'),
        value: formatInteger(overview.own_urls),
        delta: countDelta(overview.own_urls, overview.previous_own_urls, t),
        what: t('measures.urls.what'),
        context: t('measures.urls.context', { domain: ownDomain }),
        tip: null,
        how: t('measures.urls.how', { domain: ownDomain }),
      },
      t,
    ),
    slotOf(
      {
        id: 'domains',
        label: t('measures.domains.label'),
        value: formatInteger(overview.domains),
        delta: countDelta(overview.domains, overview.previous_domains, t),
        what: t('measures.domains.what'),
        context: t('measures.domains.context'),
        tip: null,
        how: t('measures.domains.how'),
      },
      t,
    ),
    slotOf(
      {
        id: 'growth',
        label: t('measures.growth.label'),
        value: growth,
        delta: null,
        what: t('measures.growth.what'),
        context: t('measures.growth.context', {
          change: formatSignedInteger(overview.citations - overview.previous_citations),
          previous: previous.short,
        }),
        tip: t('measures.growth.tip', {
          now: formatInteger(overview.citations),
          before: formatInteger(overview.previous_citations),
          previous: previous.full,
        }),
        how: t('measures.growth.how'),
      },
      t,
    ),
  ];
}
```

`measures.average` reads "average of {count} platforms" as the preview does (C 246), also for one platform with answers under All platforms.

- [ ] **Step 5: Write the strip**

`apps/web/src/features/citations/measures-strip.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { PreviousText } from './board-text';
import { measureSlots, type MeasureSlot } from './measures-model';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { TrendIcon } from '@/components/app/metric/trend-icon';
import type { CitationOverview } from '@/lib/citations/board-queries';

export interface MeasuresStripProps {
  /** `undefined` while the first read loads. */
  overview: CitationOverview | undefined;
  status: 'loading' | 'ready' | 'refetching';
  allPlatforms: boolean;
  ownDomain: string;
  previous: PreviousText;
}

const LABELS = ['citations', 'frequency', 'coverage', 'urls', 'domains', 'growth'] as const;

function itemOf(slot: MeasureSlot): MetricStripItem {
  return {
    id: slot.id,
    label: slot.label,
    value: slot.value,
    unknown: slot.unknown ? { kind: 'not-applicable' } : null,
    tip: slot.hint,
    spoken: slot.spoken,
    detail: slot.delta?.tip,
    delta:
      slot.delta === null ? undefined : slot.delta.kind === 'points' ? (
        <TrendIcon input={slot.delta.input} spoken={slot.delta.spoken} />
      ) : (
        <span className="num text-foreground-secondary">{slot.delta.text}</span>
      ),
  };
}

/** The strip of the six measures (C 200 to 257): one line per slot, 2, 3 or 6 columns by its own width. */
export function MeasuresStrip({ overview, status, allPlatforms, ownDomain, previous }: MeasuresStripProps): ReactElement {
  const t = useTranslations('citations');
  const items = useMemo((): readonly MetricStripItem[] => {
    if (overview === undefined) {
      return LABELS.map((id) => ({ id, label: t(`measures.${id}.label`), value: '' }));
    }
    return measureSlots({ overview, allPlatforms, ownDomain, previous }, t).map(itemOf);
  }, [overview, allPlatforms, ownDomain, previous, t]);
  return (
    <MetricStrip
      size="line"
      label={t('measures.label')}
      groups={[{ id: 'citations', items }]}
      status={overview === undefined ? 'loading' : status}
    />
  );
}
```

`t(\`measures.${id}.label\`)` is a template key over a literal union, as `prompts-screen.tsx` line 726 writes `t(\`tabs.${value}\`)`. The load error of the overview read is the screen's (Task 11: an `InlineError` in the strip's place).

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && pnpm vitest run src/features/citations/measures-model.test.ts src/features/citations/measures-strip.test.tsx src/components/app/metric`
Expected: PASS.

- [ ] **Step 7: Document**

- `25-component-inventory.md` 9.1: "> As built (WP-77): `size="line"`, the strip of analysis boards (Citations): one 36 px line per slot, label left, figure right, 2 columns, 3 from a 576 px strip, 6 from a 1024 px strip (container queries on the strip), 1 px `border-subtle` gaps. The figure is the tab stop and carries `spoken` as its name; the label and the figure show `tip` with `detail` as its second line."
- `25-component-inventory.md`, a new "TrendIcon" entry after Delta: path, props (`input: MetricDeltaInput`, `spoken`), "up, down or a minus at 14 px; tone from `formatMetricDelta`; the words in a visually hidden span; the figures go in the tooltip of what holds it".
- `23-application-patterns.md`, new "### 2.9 Line size (`size="line"`)": "The line strip (`MetricStrip size="line"`) is for boards whose table must start high on the page (Citations): the same metrics and denominators, the context in the tooltip."
- Specimens: a `line` strip of six slots in `data-display-section.tsx`, `TrendIcon` cases in `metric-parts-section.tsx`.

- [ ] **Step 8: Checks and commit**

Run: `cd apps/web && pnpm prettier --write src/components/app/metric src/components/design-system src/features/citations/measures-* && pnpm lint && pnpm typecheck && pnpm vitest run src/components src/features/citations/measures-model.test.ts src/features/citations/measures-strip.test.tsx && pnpm format:check`

```bash
git add apps/web/src/components/app/metric/metric-strip.tsx apps/web/src/components/app/metric/metric-strip.test.tsx apps/web/src/components/app/metric/trend-icon.tsx apps/web/src/components/app/metric/trend-icon.test.tsx apps/web/src/components/design-system/data-display-section.tsx apps/web/src/components/design-system/metric-parts-section.tsx apps/web/src/features/citations/measures-model.ts apps/web/src/features/citations/measures-model.test.ts apps/web/src/features/citations/measures-strip.tsx apps/web/src/features/citations/measures-strip.test.tsx docs/design-system/25-component-inventory.md docs/design-system/23-application-patterns.md
git commit -m "WP-77: Citations metric strip on a line strip with trend icons"
```

---

### Task 6: Board table, tabs, table panel, search, footer, empty states

Brief step 5. Parity rows: 3.4, every row (C 259 to 408); 3.9 "The row's first cell is a button", "a row click opens the drawer except on a cell action", "`/` focuses search", "The pinned corner header sits above the other headers and pinned cells" (C 334 to 338).

**Why a new house table** (Open point 1): the preview's table is not the house `DataTable`. `DataTable` always draws its count, density and column chooser (D-5 removes them), has no slot before its search for the tabs, cycles its sort through each column type's own first direction (`COLUMN_TYPES[...].defaultDesc`; the preview sorts every column descending first, C 351), resolves widths with the identity column as the only flexible one (the preview pins Page at 280 px and lets Prompts flex, C 460), pages with previous and next (D-6 loads at the end of the scroll), and is an ARIA grid with cell focus, where the preview's rows are reached by a button in the first cell (C 396 to 408). `BoardTable` is the preview's table as a house component in `components/app/table/`, documented in `12-tables.md` as the table of analysis boards; record lists with selection and bulk actions stay on `DataTable`.

**Files:**
- Create: `apps/web/src/components/app/table/board-table.tsx`, `board-table.test.tsx`
- Modify: `apps/web/src/components/app/shell/tab-nav.tsx` (a `segmented` variant and an item badge), `tab-nav.test.tsx`
- Modify: `apps/web/src/components/app/status/empty-state.tsx` (a `table` variant), `status.test.tsx` (where its tests are)
- Create: `apps/web/src/features/citations/board-panel.tsx`, `board-panel.test.tsx`
- Modify: `docs/design-system/12-tables.md` (a section "Board table"), `25-component-inventory.md` (BoardTable entry; TabNav and EmptyState "As built (WP-77)" notes), `17-empty-loading-error-states.md` (the table empty state), `apps/web/src/components/design-system/tables-section.tsx` (a BoardTable specimen: four rows, a sorted header, a pinned first column, a flexible column)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/app/table/board-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BoardTable, type BoardColumn } from './board-table';
import { axe } from '@/test/axe';

interface Row {
  id: string;
  name: string;
  count: number;
}
const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', count: 3 },
  { id: 'b', name: 'Beta', count: 9 },
];
const COLUMNS: readonly BoardColumn<Row>[] = [
  { id: 'name', header: 'Page', width: 280, sortKey: 'page', cell: (row) => row.name },
  {
    id: 'count',
    header: 'Citations',
    width: 104,
    sortKey: 'citations',
    tip: 'Answers whose list includes this URL',
    cell: (row) => String(row.count),
    cellClassName: 'num',
  },
  {
    id: 'more',
    header: 'Prompts',
    width: null,
    cell: (row) => (
      <button type="button" data-cell-action="">
        {`More of ${row.name}`}
      </button>
    ),
  },
];

function setup(onSortChange = vi.fn(), onOpen = vi.fn()) {
  const user = userEvent.setup();
  const view = render(
    <BoardTable<Row>
      caption="Cited pages"
      columns={COLUMNS}
      rows={ROWS}
      rowId={(row) => row.id}
      rowLabel={(row) => `Open ${row.name}`}
      onOpen={onOpen}
      activeId="b"
      sort={{ key: 'citations', dir: 'desc' }}
      onSortChange={onSortChange}
    />,
  );
  return { user, onSortChange, onOpen, ...view };
}

describe('BoardTable', () => {
  it('fixes the column widths, one flexible down to 280 px, and sizes the table to their sum', () => {
    const { container } = setup();
    const widths = [...container.querySelectorAll('col')].map((col) => col.style.width);
    expect(widths).toEqual(['280px', '104px', '']);
    expect(container.querySelector('table')?.style.minWidth).toBe('664px');
  });

  it('marks the sorted header and sorts descending first, then ascending (C 341 to 354)', async () => {
    const { user, onSortChange } = setup();
    expect(screen.getByRole('columnheader', { name: /Citations/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Page/ })).toHaveAttribute('aria-sort', 'none');
    await user.click(screen.getByRole('button', { name: 'Citations' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'citations', dir: 'asc' });
    await user.click(screen.getByRole('button', { name: 'Page' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'page', dir: 'desc' });
  });

  it('opens a row from its first cell button or a click, but not from a cell action (C 396 to 408)', async () => {
    const { user, onOpen } = setup();
    await user.click(screen.getByRole('button', { name: 'Open Alpha' }));
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], expect.any(HTMLElement));
    await user.click(screen.getByText('9'));
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1], expect.any(HTMLElement));
    onOpen.mockClear();
    await user.click(screen.getByRole('button', { name: 'More of Beta' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks the open row and layers the pinned corner above the other headers (C 334 to 338)', () => {
    setup();
    const rows = screen.getAllByRole('row');
    expect(rows[2]).toHaveAttribute('data-active');
    const [corner, other] = within(rows[0] ?? document.body).getAllByRole('columnheader');
    expect(corner?.className).toContain('z-(--z-sticky)');
    expect(other?.className).toContain('z-(--z-table-header)');
  });

  it('is accessible', async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

Append to `apps/web/src/components/app/shell/tab-nav.test.tsx` (it imports `screen`, `TabNav`, the `Route` type and `renderWithProviders`; `href` is a `Route`, as in the file's own cases):

```tsx
it('draws route tabs as a segmented pair with a count badge (WP-77, C 263 to 285)', () => {
  renderWithProviders(
    <TabNav
      variant="segmented"
      label="Citations views"
      items={[
        { href: '/digibranders/fynix/ai/citations' as Route, label: 'Cited pages', current: true },
        {
          href: '/digibranders/fynix/ai/citations/gaps' as Route,
          label: 'Gap analysis',
          current: false,
          badge: { text: '61', spoken: ', 61 gaps' },
        },
      ]}
    />,
  );
  const current = screen.getByRole('link', { name: 'Cited pages' });
  expect(current).toHaveAttribute('aria-current', 'page');
  expect(current.className).toContain('bg-primary-subtle');
  expect(screen.getByRole('link', { name: 'Gap analysis 61, 61 gaps' })).toBeVisible();
});
```

The link's name joins the visible label, the badge (whose text is `aria-hidden`, so it is not read) and the hidden words: assert `toHaveAccessibleName('Gap analysis, 61 gaps')` if testing-library reads the hidden badge out of the name.

Append to the `EmptyState` block of `apps/web/src/components/app/status/status.test.tsx` (the component's tests live there, with `screen` and `renderWithProviders`):

```tsx
it('draws the table empty state: a title, one reason in meta type at reading width, one button (WP-77)', () => {
  renderWithProviders(
    <EmptyState variant="table" headingLevel={2} title="No pages match" reason="No page contains “x”." primaryAction={<button type="button">Clear search</button>} />,
  );
  expect(screen.getByRole('heading', { level: 2, name: 'No pages match' })).toBeVisible();
  expect(screen.getByText('No page contains “x”.')).toHaveClass('max-w-reading', 'type-meta');
});
```

`apps/web/src/features/citations/board-panel.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoardPanel } from './board-panel';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('the Citations table panel', () => {
  it('lays out the tabs, the search, the controls, the summary, the body and the footer (C 291 to 330)', async () => {
    const onSearchChange = vi.fn();
    const { user, container } = renderWithProviders(
      <BoardPanel
        tabs={<nav aria-label="Citations views">tabs</nav>}
        search=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Search pages"
        controls={<button type="button">Your site</button>}
        summary={<p>summary</p>}
        refetching={false}
        footerText="278 pages · 405 citations"
        updated="Updated Sep 28, 02:15 · run 48"
      >
        <p>body</p>
      </BoardPanel>,
    );
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search pages');
    expect(search).toHaveAttribute('maxlength', '200');
    expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    expect(screen.getByText('278 pages · 405 citations')).toBeVisible();
    expect(screen.getByText('Updated Sep 28, 02:15 · run 48')).toBeVisible();
    await user.keyboard('/');
    expect(search).toHaveFocus();
    await user.keyboard('crm');
    expect(onSearchChange).toHaveBeenLastCalledWith('crm');
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

Run: `cd apps/web && pnpm vitest run src/components/app/table/board-table.test.tsx src/components/app/shell/tab-nav.test.tsx src/components/app/status/status.test.tsx src/features/citations/board-panel.test.tsx`
Expected: FAIL (new module, unknown props).

- [ ] **Step 2: Write `BoardTable`**

`apps/web/src/components/app/table/board-table.tsx`:

```tsx
'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface BoardSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface BoardColumn<TRow> {
  id: string;
  header: string;
  /** Before the header text, such as a competitor's colour dot (C 632). */
  headerLead?: ReactNode;
  /** The header's definition, its tooltip (C 346). */
  tip?: string | undefined;
  /** Pixels; `null` for the one flexible column, which takes the rest of the panel down to `flexMin` (C 367 to 379). */
  width: number | null;
  /** The key the table's sort names; a column without one does not sort. */
  sortKey?: string | undefined;
  cell: (row: TRow) => ReactNode;
  /** Type and layout classes of the cell: `num`, `truncate text-foreground-secondary`. */
  cellClassName?: string | undefined;
  /** The cell's tooltip, such as "Lost on Gemini to HubSpot" (C 661). */
  cellTip?: ((row: TRow) => string | undefined) | undefined;
}

export interface BoardTableProps<TRow> {
  /** Names the table for assistive technology. */
  caption: string;
  /** The first column is the identity: pinned left, its content is the row's button. */
  columns: readonly BoardColumn<TRow>[];
  rows: readonly TRow[];
  rowId: (row: TRow) => string;
  /** The row button's name: "Open northwind.com/pricing" (C 406). */
  rowLabel: (row: TRow) => string;
  /** The row button's tooltip: "<title> (<url>)" (C 483), with a lighter second line when given. */
  identityTip?: ((row: TRow) => { content: string; detail?: string | undefined } | undefined) | undefined;
  /** Opens the row; `opener` is where focus returns when the drawer closes. */
  onOpen: (row: TRow, opener: HTMLElement) => void;
  /** The row open in the inspector. */
  activeId: string | null;
  sort: BoardSort;
  onSortChange: (next: BoardSort) => void;
  /** The narrowest the flexible column gets: 280 px (C 368). */
  flexMin?: number | undefined;
  /** Called when the scroll reaches the last row, to read the next page (D-6). */
  onEndReached?: (() => void) | undefined;
  /** A read of new rows is under way while these stay (17 section 4). */
  busy?: boolean | undefined;
}

const HEADER =
  'sticky top-0 h-row-header border-b border-border bg-surface-subtle px-3 text-left align-middle font-normal not-last:border-r not-last:border-r-border-subtle';
const CELL = 'border-b border-border-subtle px-3';
// The pinned first column keeps the row's ground when the row is hovered or open in the drawer (C 83 to 84)
const PIN =
  'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover group-data-active:bg-surface-selected';
const DEFAULT_FLEX_MIN = 280;

function HeaderCell<TRow>({
  column,
  pinned,
  sort,
  onSortChange,
}: {
  column: BoardColumn<TRow>;
  pinned: boolean;
  sort: BoardSort;
  onSortChange: (next: BoardSort) => void;
}): ReactElement {
  const active = column.sortKey !== undefined && sort.key === column.sortKey;
  // The pinned corner sits above the other headers and the pinned cells (C 334 to 338)
  const layer = pinned ? 'left-0 z-(--z-sticky)' : 'z-(--z-table-header)';
  const label = (
    <>
      {column.headerLead}
      <span className={cn('truncate type-table-header', active && 'text-foreground')}>{column.header}</span>
    </>
  );
  const sortKey = column.sortKey;
  const content =
    sortKey === undefined ? (
      <span className="flex min-w-0 items-center gap-1.5">{label}</span>
    ) : (
      <button
        type="button"
        className="flex min-w-0 items-center gap-1 rounded-sm outline-none focus-visible:focus-ring"
        onClick={() => onSortChange({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      >
        {label}
        {active ? (
          <Icon
            icon={sort.dir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow}
            size="sm"
            className="shrink-0 text-foreground"
          />
        ) : null}
      </button>
    );
  return (
    <th
      scope="col"
      aria-sort={sortKey === undefined ? undefined : active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(HEADER, layer)}
    >
      {column.tip === undefined ? (
        content
      ) : (
        <Tooltip content={column.tip} side="bottom">
          {content}
        </Tooltip>
      )}
    </th>
  );
}

/**
 * The table of an analysis board (12-tables.md section 20, the preview's Citations table, C 318 to 408): fixed column
 * widths with one flexible column, a sticky header, a pinned first column whose content is the row's button, headers
 * that sort descending first and ascending on a second click, a row click that opens the drawer except on a cell action
 * (`data-cell-action`), and a callback at the end of the scroll for the next page. It scrolls inside its panel.
 */
export function BoardTable<TRow>({
  caption,
  columns,
  rows,
  rowId,
  rowLabel,
  identityTip,
  onOpen,
  activeId,
  sort,
  onSortChange,
  flexMin = DEFAULT_FLEX_MIN,
  onEndReached,
  busy = false,
}: BoardTableProps<TRow>): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const reached = useRef(onEndReached);
  useEffect(() => {
    reached.current = onEndReached;
  }, [onEndReached]);
  useEffect(() => {
    const root = scroller.current;
    const target = end.current;
    if (root === null || target === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) reached.current?.();
      },
      { root, rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const minWidth = columns.reduce((sum, column) => sum + (column.width ?? flexMin), 0);
  const [identity, ...rest] = columns;
  return (
    <div ref={scroller} className="relative isolate min-h-0 flex-1 overflow-auto">
      <table
        aria-busy={busy ? true : undefined}
        className="table-fixed border-separate border-spacing-0 type-table"
        style={{ width: '100%', minWidth: `${String(minWidth)}px` }}
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={column.width === null ? undefined : { width: `${String(column.width)}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <HeaderCell key={column.id} column={column} pinned={index === 0} sort={sort} onSortChange={onSortChange} />
            ))}
          </tr>
        </thead>
        <tbody>
          {identity === undefined
            ? null
            : rows.map((row) => {
                const id = rowId(row);
                const tip = identityTip?.(row);
                const button = (
                  <button
                    type="button"
                    aria-label={rowLabel(row)}
                    className="flex max-w-full min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:focus-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(row, event.currentTarget);
                    }}
                  >
                    {identity.cell(row)}
                  </button>
                );
                return (
                  <tr
                    key={id}
                    data-id={id}
                    data-active={activeId === id ? '' : undefined}
                    className="group h-row cursor-pointer bg-surface hover:bg-surface-hover data-active:bg-surface-selected"
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('[data-cell-action]') !== null) return;
                      onOpen(row, event.currentTarget);
                    }}
                  >
                    <td className={cn(CELL, PIN, identity.cellClassName)}>
                      {tip === undefined ? (
                        button
                      ) : (
                        <Tooltip content={tip.content} detail={tip.detail}>
                          {button}
                        </Tooltip>
                      )}
                    </td>
                    {rest.map((column) => {
                      const cellTip = column.cellTip?.(row);
                      const content = column.cell(row);
                      return (
                        <td key={column.id} className={cn(CELL, column.cellClassName)}>
                          {cellTip === undefined ? (
                            content
                          ) : (
                            <Tooltip content={cellTip} purpose="label">
                              <span className="block min-w-0">{content}</span>
                            </Tooltip>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
        </tbody>
      </table>
      <div ref={end} aria-hidden="true" className="h-px" />
    </div>
  );
}
```

The row's `onClick` handler on a `tr` is a mouse convenience: the keyboard opens the row through its button, so `jsx-a11y/click-events-have-key-events` and `no-noninteractive-element-interactions` apply; add the repository's usual comment form from `data-table.tsx` (`{/* eslint-disable-next-line jsx-a11y/... -- The row's button is the keyboard way in (C 396) */}`) for exactly those two rules on that line. The two inline `style` values are computed pixel widths, which no utility class can express; `DataTable` sets its widths the same way.

- [ ] **Step 3: Extend `TabNav` and `EmptyState`**

`tab-nav.tsx`: `TabNavItem` gains `badge?: { text: string; spoken: string } | undefined` ("A count after the label in the segmented variant; `spoken` is what a screen reader hears in its place: ', 61 gaps'."); `TabNavProps` gains `variant?: 'underline' | 'segmented' | undefined` ("`segmented`: two to four route tabs as a joined pair, at the start of a table's toolbar (Citations, C 263 to 285)"). The segmented branch:

```tsx
const SEGMENT = cn(
  'inline-flex h-control-sm shrink-0 items-center justify-center gap-1.5 border px-2 outline-none select-none not-first:-ml-px first:rounded-l-md last:rounded-r-md focus-visible:relative focus-visible:focus-ring-inset',
);

if (variant === 'segmented') {
  return (
    <nav data-slot="tab-nav" aria-label={label} className="inline-flex shrink-0">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
          className={cn(
            SEGMENT,
            item.current
              ? 'relative border-primary-border bg-primary-subtle type-body-strong text-primary-text'
              : 'border-border bg-surface type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
          )}
        >
          <span>{item.label}</span>
          {item.badge === undefined ? null : (
            <>
              <span
                aria-hidden="true"
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-neutral-subtle px-1 num type-label text-neutral-text"
              >
                {item.badge.text}
              </span>
              <span className="sr-only">{item.badge.spoken}</span>
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}
```

The preview pads a segment 10 px (`px-2.5`, C 275), which is off the spacing scale (`eslint.config.mjs` line 96: 0.5, 1, 1.5, 2, 3 ...); the segment takes `SegmentedControl`'s small padding, `px-2` (`segmented-control.tsx` line 51), 2 px narrower each side (Open point 19). The segmented variant does not offer `unavailable`. It is a `nav` of links with `aria-current`, the house route tabs' semantics, where the preview draws `role="tablist"` links (Open point 2).

`empty-state.tsx`: `variant` gains `'table'` ("the body of a table panel with nothing to show (C 381 to 394): centred, 48 px above and below, the reason in meta type at reading width, one button 8 px under it"). In the component:

```tsx
const table = variant === 'table';
// container
className={cn(
  'flex flex-col',
  inline ? 'items-start p-4 text-left' : table ? 'items-center gap-2 px-4 py-12 text-center' : 'mx-auto max-w-dialog-sm items-center p-8 text-center',
)}
// reason
<p className={table ? 'max-w-reading type-meta' : 'mt-1 type-body text-foreground-secondary'}>{reason}</p>
// actions
<div className={cn('flex flex-wrap items-center justify-center gap-3', table ? 'mt-2' : 'mt-4')}>
```

and no icon for `table`, as for `inline`.

- [ ] **Step 4: Write the panel**

`apps/web/src/features/citations/board-panel.tsx`:

```tsx
'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ReactElement, type ReactNode } from 'react';

import { MAX_SEARCH } from './board-state';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { useShortcut } from '@/lib/a11y/use-shortcut';

export interface BoardPanelProps {
  /** The view tabs, a segmented `TabNav` (C 263 to 285). */
  tabs: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder: string;
  /** The tab's own controls: the owner filter, or Only gaps. */
  controls: ReactNode;
  /** The tab's summary at the right (C 675 to 677). */
  summary?: ReactNode;
  refetching: boolean;
  /** "278 pages · 405 citations"; `null` while the first rows load. */
  footerText: string | null;
  /** "Updated Sep 28, 02:15 · run 48" (C 189); `null` before any answer. */
  updated: string | null;
  /** The table, its empty state, its error or its skeleton. */
  children: ReactNode;
}

/**
 * The table panel (C 287 to 330): at least 384 px tall, so a phone, where the strip takes the screen, still shows rows
 * and the page scrolls. Its toolbar holds the views, a hairline, the search (`/` focuses it), the tab's controls and
 * its summary; its footer the count and the freshness.
 */
export function BoardPanel({
  tabs,
  search,
  onSearchChange,
  searchPlaceholder,
  controls,
  summary,
  refetching,
  footerText,
  updated,
  children,
}: BoardPanelProps): ReactElement {
  const t = useTranslations('citations.board');
  const input = useRef<HTMLInputElement>(null);
  useShortcut(
    '/',
    (event) => {
      event.preventDefault();
      input.current?.focus();
    },
    { kind: 'single-key' },
  );
  return (
    <section className="relative flex min-h-96 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2">
        {tabs}
        {/* A hairline keeps the views (what the table is) apart from the filters (what it shows) (C 313) */}
        <span aria-hidden="true" className="hidden h-5 border-l border-border md:block" />
        <InputGroup leadingIcon={Search} size="sm" className="w-64 max-w-full min-w-0">
          <Input
            ref={input}
            size="sm"
            variant="bare"
            type="search"
            value={search}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder}
            maxLength={MAX_SEARCH}
            aria-label={t('search')}
            aria-keyshortcuts="/"
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-3">{controls}</div>
        <div className="ml-auto flex items-center gap-3">{summary}</div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <RefetchBar active={refetching} position="under-table-header" />
        {children}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle px-3">
        <span className="num type-meta">{footerText}</span>
        {updated === null ? null : <span className="ml-auto type-meta whitespace-nowrap">{updated}</span>}
      </div>
    </section>
  );
}
```

`onValueChange` is the house `Input`'s change callback, as `DataTableToolbar` uses it (`components/app/data-table/toolbar.tsx` line 76). The search writes the address on every keystroke (history replace, C 300); Cited pages debounces the read (Task 8).

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && pnpm vitest run src/components/app/table src/components/app/shell/tab-nav.test.tsx src/components/app/status/status.test.tsx src/features/citations/board-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Document**

- `12-tables.md`, new section "## 20. Board table" (after "19. Component API sketch"): what it is (the table of an analysis board such as Citations: compare and open, no selection, no column chooser, no density), anatomy (sticky 40 px header, 40 px rows, a pinned first column whose content is the row's button, fixed widths with one flexible column at least 280 px, the table at least the sum of its widths and scrolling sideways in its panel, the pinned corner header at `--z-sticky`), sorting (descending first, ascending on a second click, the screen's own tie rules), opening (the row's button, or a click anywhere on the row but a `data-cell-action`), paging (`onEndReached` 240 px before the end), and when to use `DataTable` instead (record lists users select and act on in bulk).
- `25-component-inventory.md`: the BoardTable entry (path, the props above, states: loading is the screen's skeleton rows, refetching is `busy` with `RefetchBar`, empty is `EmptyState variant="table"`), the TabNav note (`variant="segmented"`, `badge`), the EmptyState note (`variant="table"`).
- `17-empty-loading-error-states.md` section 2.1 (EmptyState component): one line for the `table` variant (Task 10 adds `card` there too).
- Specimen in `tables-section.tsx`.

- [ ] **Step 7: Checks and commit**

Run, from the worktree root:

```bash
(cd apps/web && pnpm prettier --write src/components/app/table src/components/app/shell/tab-nav*.tsx src/components/app/status/empty-state*.tsx src/components/design-system/tables-section.tsx src/features/citations/board-panel*.tsx && pnpm lint && pnpm typecheck && pnpm format:check)
infra/dev/heavy --lane medium --label wp77-t6 -- bash -c 'cd apps/web && pnpm test'
```

Expected: green (the full suite, since `TabNav` and `EmptyState` have callers across the app).

```bash
git add apps/web/src/components/app/table/board-table.tsx apps/web/src/components/app/table/board-table.test.tsx apps/web/src/components/app/shell/tab-nav.tsx apps/web/src/components/app/shell/tab-nav.test.tsx apps/web/src/components/app/status/empty-state.tsx apps/web/src/components/app/status/status.test.tsx apps/web/src/components/design-system/tables-section.tsx apps/web/src/features/citations/board-panel.tsx apps/web/src/features/citations/board-panel.test.tsx docs/design-system/12-tables.md docs/design-system/17-empty-loading-error-states.md docs/design-system/25-component-inventory.md
git commit -m "WP-77: board table, segmented route tabs and the Citations table panel"
```

---

### Task 7: Cited pages columns and cells

Brief step 6 (first half). Parity rows: 3.5, the column table (Page, Domain type, Citations, Change, Prompts, Platforms, Trend, Last cited), "Default sort" and its ties (C 446 to 543).

**Files:**
- Modify: `apps/web/src/components/app/sparkline/sparkline-cell.tsx` (`width`, `height`, `entity` colour, `endDot`), `sparkline-cell.test.tsx`
- Modify: `apps/web/src/components/app/engine/engine-logo.tsx` (`nameDisplay="visually-hidden"`), `engine-logo.test.tsx` (Open point 5)
- Modify: `apps/web/src/components/ui/badge.tsx` (export `badgeVariants`, so a button can take a badge's look)
- Create: `apps/web/src/features/citations/cited-pages/page-rows.ts`, `page-rows.test.ts`, `page-columns.tsx`, `page-columns.test.tsx`
- Modify: `docs/design-system/25-component-inventory.md` (SparklineCell, EngineLogo, Badge notes), `docs/design-system/07-icons.md` section 5 (one line on the mark with a hidden name, Open point 5)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/citations/cited-pages/page-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { apiSort, ownerRole, PAGE_SORT_DEFAULT, pageText } from './page-rows';
import type { CitedPageRow } from '@/lib/citations/board-queries';

const ROW: CitedPageRow = {
  url_id: 7,
  url: 'https://g2.com/categories/crm/pricing',
  host: 'g2.com',
  path: '/categories/crm/pricing',
  registrable_domain: 'g2.com',
  title: null,
  domain_role: 'third_party',
  entity_id: null,
  entity_name: null,
  color_index: null,
  citations: 12,
  previous_citations: 0,
  prompts: 3,
  top_prompts: [{ prompt_id: 'p1', text: 'Best CRM?', citations: 6 }],
  engines: [{ engine_code: 'chatgpt_web', citation_units: 12 }],
  trend: [0, 0, 1, 2, 3, 2, 2, 2],
  last_cited_at: '2026-09-28T00:10:00.000Z',
};

describe('the Cited pages rows', () => {
  it('sends the sort to the API: descending first by citations (C 32, C 451)', () => {
    expect(PAGE_SORT_DEFAULT).toEqual({ key: 'citations', dir: 'desc' });
    expect(apiSort(PAGE_SORT_DEFAULT)).toBe('-citations');
    expect(apiSort({ key: 'last', dir: 'asc' })).toBe('last_cited');
    expect(apiSort({ key: 'page', dir: 'desc' })).toBe('-page');
    expect(apiSort({ key: 'unknown', dir: 'desc' })).toBe('-citations');
  });

  it('maps the owner filter onto the API role', () => {
    expect(ownerRole('own')).toBe('own');
    expect(ownerRole('third')).toBe('third_party');
    expect(ownerRole('all')).toBeNull();
  });

  it('writes the address as the preview does: host then path, the address without its scheme', () => {
    expect(pageText(ROW)).toEqual({ host: 'g2.com', path: '/categories/crm/pricing', display: 'g2.com/categories/crm/pricing' });
  });
});
```

`apps/web/src/features/citations/cited-pages/page-columns.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pageColumns, type PageColumnsContext } from './page-columns';
import messages from '../../../../messages/en.json';
import { BoardTable } from '@/components/app/table/board-table';
import type { CitedPageRow } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const OWN: CitedPageRow = {
  url_id: 1,
  url: 'https://fynix.digital/pricing',
  host: 'fynix.digital',
  path: '/pricing',
  registrable_domain: 'fynix.digital',
  title: 'Pricing and plans',
  domain_role: 'own',
  entity_id: null,
  entity_name: null,
  color_index: null,
  citations: 76,
  previous_citations: 70,
  prompts: 31,
  top_prompts: [{ prompt_id: 'p1', text: 'What is the best CRM for a 20-person startup?', citations: 9 }],
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 50 },
    { engine_code: 'gemini_web', citation_units: 0 },
  ],
  trend: [5, 6, 7, 8, 9, 9, 10, 11],
  last_cited_at: '2026-09-28T00:10:00.000Z',
};
const COMPETITOR: CitedPageRow = {
  ...OWN,
  url_id: 2,
  url: 'https://brightwave.co.uk/pricing',
  host: 'brightwave.co.uk',
  domain_role: 'competitor',
  entity_name: 'Brightwave Digital',
  color_index: 2,
  previous_citations: 0,
  prompts: 1,
};

function draw(context: Partial<PageColumnsContext> = {}, rows: readonly CitedPageRow[] = [OWN, COMPETITOR]) {
  const promptsPopover = vi.fn((_: CitedPageRow, chip: ReactElement) => chip);
  const full: PageColumnsContext = {
    t,
    owner: 'all',
    engines: [
      { code: 'chatgpt_web', label: 'ChatGPT' },
      { code: 'gemini_web', label: 'Gemini' },
    ],
    previous: { full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' },
    trendSlots: 8,
    timeZone: 'Europe/Berlin',
    latest: '2026-09-28T00:15:00.000Z',
    promptsPopover,
    ...context,
  };
  const columns = pageColumns(full);
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <BoardTable<CitedPageRow>
        caption="Cited pages"
        columns={columns}
        rows={rows}
        rowId={(row) => String(row.url_id)}
        rowLabel={(row) => row.url}
        onOpen={() => undefined}
        activeId={null}
        sort={{ key: 'citations', dir: 'desc' }}
        onSortChange={() => undefined}
      />
    </NextIntlClientProvider>,
  );
  return { columns, promptsPopover };
}

describe('the Cited pages columns (C 459 to 543)', () => {
  it('has the preview widths with Domain type only when the owner is not Your site', () => {
    expect(draw().columns.map((column) => [column.header, column.width])).toEqual([
      ['Page', 280],
      ['Domain type', 140],
      ['Citations', 104],
      ['Change', 88],
      ['Prompts', null],
      ['Platforms', 196],
      ['Trend', 104],
      ['Last cited', 104],
    ]);
  });

  it('drops Domain type for Your site and narrows Platforms for one platform', () => {
    const { columns } = draw({ owner: 'own', engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }] }, [OWN]);
    expect(columns.map((column) => column.header)).not.toContain('Domain type');
    expect(columns.find((column) => column.header === 'Platforms')?.width).toBe(112);
  });

  it('draws the cells: the own path, a competitor host and path, New, the change, the top prompt, the chip', () => {
    draw();
    expect(screen.getByText('/pricing', { selector: 'span' })).toBeVisible();
    expect(screen.getByText('brightwave.co.uk')).toHaveClass('text-foreground-tertiary');
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getByText('+6')).toBeVisible();
    expect(screen.getByText('Brightwave Digital')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prompts that cite /pricing, 31 prompts' })).toHaveTextContent('+30');
    expect(screen.getAllByRole('button', { name: /^Prompts that cite/ })[1]).toHaveTextContent('Details');
    expect(screen.getAllByText('Sep 28')).toHaveLength(2);
  });

  it('says the last N runs in the Trend tip when there are fewer than 8', () => {
    expect(draw({ trendSlots: 3 }).columns.find((column) => column.header === 'Trend')?.tip).toBe(
      'Citations in each of the last 3 runs',
    );
  });
});
```

Append to `sparkline-cell.test.tsx`:

```tsx
it('draws at a given size in an entity colour and without the end dot (WP-77)', () => {
  const { container } = render(
    <SparklineCell values={[1, 3, 2]} label="Citations per run, oldest first: 1, 3, 2" width={96} height={20} entity={{ own: false, colorIndex: 3 }} endDot={false} />,
  );
  const canvas = container.querySelector('canvas');
  expect(canvas).toHaveAttribute('width');
  expect(canvas?.style.width).toBe('96px');
});
```

Append to `engine-logo.test.tsx`:

```tsx
it('can keep the name for screen readers only, beside a mark that is read as the name (WP-77)', () => {
  renderWithProviders(<EngineLogo engine="chatgpt_web" name="ChatGPT" nameDisplay="visually-hidden" />);
  expect(screen.getByText('ChatGPT')).toHaveClass('sr-only');
});
```

Run: `cd apps/web && pnpm vitest run src/features/citations/cited-pages src/components/app/sparkline src/components/app/engine`
Expected: FAIL.

- [ ] **Step 2: Extend the house components**

`sparkline-cell.tsx`, new props:

```ts
  /** Pixels; 64 unless a board column asks for more (the Citations Trend column: 96, C 536). */
  width?: number | undefined;
  /** Pixels; overrides `density` (the page drawer's 56 px trend, I 166). */
  height?: number | undefined;
  /** Draws in the entity's colour, as `EntitySwatch` does: `chart-1` for the own brand, `chart-N` for its color index, `chart-other` past six or without one. Overrides `tone`. */
  entity?: { own: boolean; colorIndex: number | null } | undefined;
  /** The dot on the last point; the preview's sparklines have none. Default true. */
  endDot?: boolean | undefined;
```

In the body: `const boxWidth = width ?? SPARK_WIDTH; const boxHeight = height ?? (density === 'compact' ? SPARK_HEIGHT_COMPACT : SPARK_HEIGHT);`, both used in `sparklineGeometry(...)` and on the canvas (`width`/`height` attributes times `devicePixelRatio`, `style={{ width: boxWidth, height: boxHeight }}`, as the file does with the constants today); the colour token is

```ts
const ENTITY_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const;
const entityToken = (entity: { own: boolean; colorIndex: number | null }): string =>
  entity.own ? '--chart-1' : (ENTITY_TOKENS[(entity.colorIndex ?? 0) - 1] ?? '--chart-other');
```

and `readColorToken(entity === undefined ? TONE_TOKEN[tone] : entityToken(entity))`; the last point's dot is drawn only when `endDot`. Add `entity`, `endDot`, `boxWidth` and `boxHeight` to the effect's dependency list.

`engine-logo.tsx`: `nameDisplay?: 'visible' | 'visually-hidden' | undefined` ("`visually-hidden`: the mark alone on screen, the name for screen readers, where a column of marks would repeat the names (Citations Platforms and Lost on, C 528 and 658); the name is still in the cell's tooltip"). With a mark and `visually-hidden`, the label renders as `<span className="sr-only">{name}</span>`; with no mark the name stays visible (a mark is never replaced by nothing).

`badge.tsx`: `export const badgeVariants = cva(...)` (the existing constant, now exported) with the comment "Exported for a control that takes a badge's look, such as the Prompts chip of Cited pages (C 511)".

- [ ] **Step 3: Write the rows helpers**

`apps/web/src/features/citations/cited-pages/page-rows.ts`:

```ts
import type { Owner } from '../board-state';
import type { BoardSort } from '@/components/app/table/board-table';
import type { CitedPageRow, CitedPagesSort, DomainRole } from '@/lib/citations/board-queries';
import { displayDomain, displayUrl } from '@/lib/format';

/** Citations descending; a header click sorts descending, a second click ascending (C 32, C 351). */
export const PAGE_SORT_DEFAULT: BoardSort = { key: 'citations', dir: 'desc' };

const API_KEYS: Readonly<Record<string, 'citations' | 'change' | 'prompts' | 'last_cited' | 'page'>> = {
  citations: 'citations',
  change: 'change',
  prompts: 'prompts',
  last: 'last_cited',
  page: 'page',
};

/** The API's `sort` for a header sort; ties are the API's: most citations, then the address (C 455). */
export function apiSort(sort: BoardSort): CitedPagesSort {
  const key = API_KEYS[sort.key] ?? 'citations';
  if (sort.dir === 'asc') return key;
  return `-${key}`;
}

/** The API's role for the owner filter; `null` for All. */
export const ownerRole = (owner: Owner): DomainRole | null =>
  owner === 'all' ? null : owner === 'third' ? 'third_party' : owner;

/** The address as the table writes it (C 479 to 481): the host, the path, and both without the scheme. */
export function pageText(row: CitedPageRow): { host: string; path: string; display: string } {
  return { host: displayDomain(row.host), path: row.path, display: displayUrl(row.url).display };
}
```

`key` has the five literal keys' union type (the record's value type), so `` `-${key}` `` is the union of the five descending literals, which `CitedPagesSort` holds.

- [ ] **Step 4: Write the columns**

`apps/web/src/features/citations/cited-pages/page-columns.tsx`:

```tsx
'use client';

import type { ReactElement, ReactNode } from 'react';

import type { BoardEngine } from '../board-reads';
import type { Owner } from '../board-state';
import { slotDay, type CitationsTranslate, type PreviousText } from '../board-text';
import { pageText } from './page-rows';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import type { BoardColumn } from '@/components/app/table/board-table';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { CitedPageRow } from '@/lib/citations/board-queries';
import { formatInteger, formatSignedInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PageColumnsContext {
  t: CitationsTranslate;
  owner: Owner;
  /** The engines in scope, in code order: every enabled one for All platforms, else the one. */
  engines: readonly BoardEngine[];
  previous: PreviousText;
  /** How many slots `window.trend` holds (8 for a project with eight runs). */
  trendSlots: number;
  timeZone: string;
  latest: string | null;
  /** Wraps a row's "+N" chip in its prompts popover (Task 8); the popover sets the chip's `aria-haspopup` and `aria-expanded`. */
  promptsPopover: (row: CitedPageRow, chip: ReactElement) => ReactNode;
}

const isOwn = (row: CitedPageRow): boolean => row.domain_role === 'own';
const displayHost = (row: CitedPageRow): string => pageText(row).host;

function Identity({ row, t }: { row: CitedPageRow; t: CitationsTranslate }): ReactElement {
  const text = pageText(row);
  return (
    <>
      <span className="min-w-0 truncate text-foreground">
        {isOwn(row) ? (
          text.path
        ) : (
          <>
            <span className="text-foreground-tertiary">{text.host}</span>
            {text.path}
          </>
        )}
      </span>
      {row.previous_citations === 0 ? <Badge className="ml-2 align-middle">{t('pages.new')}</Badge> : null}
    </>
  );
}

function OwnerCell({ row, t }: { row: CitedPageRow; t: CitationsTranslate }): ReactElement {
  const label =
    row.domain_role === 'own'
      ? t('pages.yourSite')
      : row.domain_role === 'competitor'
        ? (row.entity_name ?? displayHost(row))
        : t('pages.thirdParty');
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <EntitySwatch
        shape="dot"
        own={row.domain_role === 'own'}
        colorIndex={row.domain_role === 'competitor' ? row.color_index : null}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function PromptsCell({ row, context }: { row: CitedPageRow; context: PageColumnsContext }): ReactElement {
  const { t } = context;
  const top = row.top_prompts[0];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-8 shrink-0 num text-foreground">{formatInteger(row.prompts)}</span>
      {top === undefined ? null : (
        <Tooltip content={t('pages.topPromptTip', { text: top.text, count: top.citations })} purpose="label">
          <span className="min-w-0 truncate text-foreground-secondary">{top.text}</span>
        </Tooltip>
      )}
      {context.promptsPopover(
        row,
        <button
          type="button"
          data-cell-action=""
          aria-label={t('pages.moreLabel', { path: row.path, count: row.prompts })}
          className={cn(
            badgeVariants({ variant: 'outline', tone: 'neutral' }),
            'shrink-0 num outline-none hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring',
          )}
        >
          {row.prompts > 1 ? t('pages.more', { count: row.prompts - 1 }) : t('pages.details')}
        </button>,
      )}
    </span>
  );
}

function PlatformsCell({ row, context }: { row: CitedPageRow; context: PageColumnsContext }): ReactElement {
  return (
    <span className="flex items-center gap-3">
      {context.engines.map((engine) => {
        const count = row.engines.find((cell) => cell.engine_code === engine.code)?.citation_units ?? 0;
        return (
          <Tooltip key={engine.code} content={context.t('pages.platformTip', { engine: engine.label, count })} purpose="label">
            <span className={cn('inline-flex items-center gap-1', count === 0 && 'opacity-40')}>
              <EngineLogo engine={engine.code} name={engine.label} nameDisplay="visually-hidden" />
              <span className="num text-foreground-secondary">{formatInteger(count)}</span>
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** The columns of Cited pages (C 459 to 472), as the owner and the platforms in scope choose them. */
export function pageColumns(context: PageColumnsContext): BoardColumn<CitedPageRow>[] {
  const { t, owner, engines, previous } = context;
  const columns: BoardColumn<CitedPageRow>[] = [
    { id: 'page', header: t('pages.columns.page'), width: 280, sortKey: 'page', cell: (row) => <Identity row={row} t={t} /> },
  ];
  if (owner !== 'own') {
    columns.push({ id: 'owner', header: t('pages.columns.domainType'), width: 140, cell: (row) => <OwnerCell row={row} t={t} /> });
  }
  columns.push(
    {
      id: 'citations',
      header: t('pages.columns.citations'),
      tip: t('pages.columns.citationsTip'),
      width: 104,
      sortKey: 'citations',
      cellClassName: 'num text-foreground',
      cell: (row) => formatInteger(row.citations),
    },
    {
      id: 'change',
      header: t('pages.columns.change'),
      tip: t('pages.columns.changeTip', { previous: previous.full }),
      width: 88,
      sortKey: 'change',
      cellTip: (row) =>
        row.citations === row.previous_citations
          ? undefined
          : t('measures.countBefore', { count: formatInteger(row.previous_citations) }),
      cell: (row) =>
        row.citations === row.previous_citations ? (
          <span className="text-foreground-tertiary">{t('pages.noChange')}</span>
        ) : (
          <span className="num text-foreground-secondary">{formatSignedInteger(row.citations - row.previous_citations)}</span>
        ),
    },
    {
      id: 'prompts',
      header: t('pages.columns.prompts'),
      tip: t('pages.columns.promptsTip'),
      width: null,
      sortKey: 'prompts',
      cell: (row) => <PromptsCell row={row} context={context} />,
    },
    {
      id: 'platforms',
      header: t('pages.columns.platforms'),
      tip: t('pages.columns.platformsTip'),
      width: engines.length > 1 ? 196 : 112,
      cell: (row) => <PlatformsCell row={row} context={context} />,
    },
    {
      id: 'trend',
      header: t('pages.columns.trend'),
      tip: context.trendSlots >= 8 ? t('pages.columns.trendTip') : t('pages.columns.trendTipShort', { count: context.trendSlots }),
      width: 104,
      cell: (row) => (
        <span className="block w-24">
          <SparklineCell
            values={row.trend}
            label={t('pages.trendLabel', { values: row.trend.map((value) => formatInteger(value)).join(', ') })}
            width={96}
            height={20}
            entity={{ own: isOwn(row), colorIndex: row.domain_role === 'competitor' ? row.color_index : null }}
            endDot={false}
          />
        </span>
      ),
    },
    {
      id: 'last',
      header: t('pages.columns.lastCited'),
      width: 104,
      sortKey: 'last',
      cellClassName: 'whitespace-nowrap text-foreground-secondary',
      cell: (row) => slotDay(row.last_cited_at, context.timeZone, context.latest),
    },
  );
  return columns;
}

/** The row button's name and tooltip (C 406 and 483): "Open <url>", "<title> (<url>)", and "Not cited in ..." for New. */
export function pageIdentity(row: CitedPageRow, t: CitationsTranslate, previous: PreviousText): {
  label: string;
  tip: { content: string; detail?: string | undefined };
} {
  const url = pageText(row).display;
  return {
    label: t('pages.open', { url }),
    tip: {
      content: t('pages.pageTip', { title: row.title ?? url, url }),
      ...(row.previous_citations === 0 ? { detail: t('pages.newTip', { previous: previous.full }) } : {}),
    },
  };
}
```

The New badge has no tooltip of its own (it sits inside the row button's tooltip trigger); its "Not cited in ..." is the second line of the row's tooltip (Open point 11). `formatInteger` of a whole count has no rounding effect; the change column uses `formatSignedInteger` (typographic minus, as the preview).

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && pnpm vitest run src/features/citations/cited-pages src/components/app/sparkline src/components/app/engine src/components/ui/badge.test.tsx`
Expected: PASS.

- [ ] **Step 6: Document, check and commit**

Notes in `25-component-inventory.md` (SparklineCell: `width`, `height`, `entity`, `endDot`; EngineLogo: `nameDisplay`; Badge: `badgeVariants` exported) and `07-icons.md` section 5 ("A column that repeats the engine on every row may show the mark with the name hidden for screen readers; the cell's tooltip names it (WP-77)").

Run: `cd apps/web && pnpm prettier --write src/components/app/sparkline src/components/app/engine src/components/ui/badge.tsx src/features/citations/cited-pages && pnpm lint && pnpm typecheck && pnpm vitest run src/components && pnpm format:check`

```bash
git add apps/web/src/components/app/sparkline apps/web/src/components/app/engine apps/web/src/components/ui/badge.tsx apps/web/src/features/citations/cited-pages docs/design-system/25-component-inventory.md docs/design-system/07-icons.md
git commit -m "WP-77: Cited pages columns, with sparkline, engine mark and badge variants"
```

---

### Task 8: Cited pages tab: owner filter, prompts popover, paging, export

Brief step 6 (second half). Parity rows: 3.5 "Owner filter", "Footer", "Prompts popover", "Owner nouns", "Empty states"; 3.2 "Export"; 3.4 footer and freshness (C 189, 327 to 329); D-6.

**Files:**
- Create: `apps/web/src/components/app/filters/pressed-group.tsx`, `pressed-group.test.tsx` (the preview's pressed-button group, C 546 to 557)
- Modify: `apps/web/src/components/app/table/board-table.tsx` (add `BoardTableSkeleton`), `board-table.test.tsx`
- Modify: `apps/web/src/features/citations/board-text.ts` (add `updatedText`), `board-text.test.ts`
- Create: `apps/web/src/features/citations/cited-pages/prompts-popover.tsx`, `pages-tab.tsx`, `pages-tab.test.tsx`
- Create: `apps/web/src/features/citations/board-export.ts`, `board-export.test.ts`
- Modify: `docs/design-system/13-filters-search.md` (PressedGroup: a filter of one table's rows by a few kinds, with counts), `25-component-inventory.md` (PressedGroup entry, BoardTableSkeleton line), `apps/web/src/components/design-system/filters-section.tsx` (specimen)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/app/filters/pressed-group.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PressedGroup } from './pressed-group';
import { axe } from '@/test/axe';

describe('PressedGroup', () => {
  it('presses one item, shows each count, and reports a change', async () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <PressedGroup
        label="Domain type"
        value="own"
        onValueChange={onValueChange}
        items={[
          { value: 'own', label: 'Your site', count: '13' },
          { value: 'all', label: 'All', count: '278' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Domain type' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Your site 13' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'All 278' }));
    expect(onValueChange).toHaveBeenCalledWith('all');
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

Append to `board-text.test.ts`:

```ts
it('writes the footer freshness (C 189)', () => {
  expect(updatedText({ latest_answer_at: LATEST, latest_run_number: 48 }, ZONE, t)).toBe('Updated Sep 28, 02:15 · run 48');
  expect(updatedText({ latest_answer_at: LATEST, latest_run_number: null }, ZONE, t)).toBe('Updated Sep 28, 02:15');
  expect(updatedText({ latest_answer_at: null, latest_run_number: null }, ZONE, t)).toBeNull();
});
```

(import `updatedText` with the others.)

`apps/web/src/features/citations/board-export.test.ts`:

```ts
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { gapsCsv, pagesCsv } from './board-export';
import messages from '../../../messages/en.json';
import type { CitationGapRow, CitedPageRow } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const ENGINES = [{ code: 'chatgpt_web' as const, label: 'ChatGPT' }];

describe('the Citations CSV', () => {
  it('writes one line per page with its engines, and a formula-looking title as text', () => {
    const row: CitedPageRow = {
      url_id: 1,
      url: 'https://fynix.digital/pricing',
      host: 'fynix.digital',
      path: '/pricing',
      registrable_domain: 'fynix.digital',
      title: '=Pricing',
      domain_role: 'own',
      entity_id: null,
      entity_name: null,
      color_index: null,
      citations: 76,
      previous_citations: 70,
      prompts: 31,
      top_prompts: [{ prompt_id: 'p1', text: 'Best CRM?', citations: 9 }],
      engines: [{ engine_code: 'chatgpt_web', citation_units: 76 }],
      trend: [],
      last_cited_at: '2026-09-28T00:10:00.000Z',
    };
    const table = pagesCsv([row], ENGINES, 'Europe/Berlin', t);
    expect(table.header).toEqual([
      'URL',
      'Title',
      'Domain type',
      'Brand',
      'Citations',
      'Citations before',
      'Prompts',
      'Top prompt',
      'Last cited',
      'ChatGPT citations',
    ]);
    expect(table.rows[0]).toEqual([
      'https://fynix.digital/pricing',
      "'=Pricing",
      'Your site',
      null,
      76,
      70,
      31,
      'Best CRM?',
      '2026-09-28',
      76,
    ]);
  });

  it('writes one line per prompt with you, each competitor and where it is lost', () => {
    const cell = { answers: 4, cited: 0, mentioned: 1, state: 'mentioned' as const };
    const brand = { total: cell, engines: [{ ...cell, engine_code: 'chatgpt_web' as const }], platforms: 1, cited_on: 0 };
    const row: CitationGapRow = {
      prompt_id: 'p1',
      text: 'Best CRM?',
      topic: null,
      you: brand,
      competitors: [{ ...brand, entity_id: 'c1', total: { ...cell, cited: 2, state: 'cited' }, cited_on: 1 }],
      gap: 1,
      lost_on: ['chatgpt_web'],
      lost_to: ['c1'],
      competitor_answers: 2,
    };
    const table = gapsCsv([row], [{ id: 'c1', name: 'HubSpot', colorIndex: 2, domain: 'hubspot.com' }], 'Fynix', ENGINES, t);
    expect(table.header).toEqual([
      'Prompt',
      'Group',
      'Fynix state',
      'Fynix citing answers',
      'HubSpot state',
      'HubSpot citing answers',
      'Lost on',
      'Lost to',
    ]);
    expect(table.rows[0]).toEqual(['Best CRM?', 'No group', 'Not cited', 0, 'Cited', 2, 'ChatGPT', 'HubSpot']);
  });
});
```

`apps/web/src/features/citations/cited-pages/pages-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PagesTab, type PagesTabProps } from './pages-tab';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const EXPECTED = CITATIONS_FIXTURE.expected.chatgpt;

function setup(overrides: Partial<PagesTabProps> = {}) {
  const props: PagesTabProps = {
    project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
    scope: { runs: 4, engines: ['chatgpt_web'], term: null },
    ready: true,
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    owner: 'own',
    search: '',
    onOwnerChange: vi.fn(),
    onSearchChange: vi.fn(),
    onResetScope: vi.fn(),
    tabs: <nav aria-label="Citations views" />,
    previous: { full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' },
    scopeText: 'ChatGPT, All groups, Last 4 runs',
    timeZone: 'Europe/Berlin',
    activeId: null,
    onOpen: vi.fn(),
    onOrderChange: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<PagesTab {...props} />) };
}

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the Cited pages tab', () => {
  it('lists the own pages with the owner counts, the footer and the freshness (C 545 to 561)', async () => {
    const { container } = setup();
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    expect(within(table).getAllByRole('row')).toHaveLength(EXPECTED.pages.own + 1);
    const owners = screen.getByRole('group', { name: 'Domain type' });
    expect(within(owners).getByRole('button', { pressed: true })).toHaveTextContent(`Your site${String(EXPECTED.pages.own)}`);
    expect(within(owners).getByRole('button', { name: /^All/ })).toHaveTextContent(String(EXPECTED.pages.all));
    expect(screen.getByText(`${String(EXPECTED.pages.own)} pages · ${String(EXPECTED.strip.citations)} citations`)).toBeVisible();
    expect(screen.getByText('Updated Sep 28, 02:10 · run 48')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens the prompts popover from the chip and the page details from its foot (C 416 to 444)', async () => {
    const { user, props } = setup();
    await screen.findByRole('table', { name: 'Cited pages' });
    const chip = screen.getAllByRole('button', { name: /^Prompts that cite / })[0];
    if (chip === undefined) throw new Error('No chip');
    await user.click(chip);
    const dialog = screen.getByRole('dialog', { name: /^Prompts that cite / });
    expect(within(dialog).getByText('Cited for')).toBeVisible();
    expect(within(dialog).getAllByRole('listitem').length).toBeLessThanOrEqual(10);
    await user.click(within(dialog).getByRole('button', { name: /^(Show all \d+ prompts|Open the page details)$/ }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ domain_role: 'own' }), expect.any(HTMLElement));
  });

  it('says no page matches a search, with a way out', async () => {
    const { user, props } = setup({ search: 'zzzz' });
    expect(await screen.findByRole('heading', { name: 'No pages match' })).toBeVisible();
    expect(screen.getByText('No page of your site contains “zzzz”.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(props.onSearchChange).toHaveBeenCalledWith('');
  });

  it('says no answer cites a page in this scope, and resets the scope', async () => {
    server.use(
      http.get(mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/cited-pages'), () =>
        HttpResponse.json({
          data: [],
          meta: {
            citations: 0,
            owners: { own: 0, competitor: 0, third_party: 0, all: 0 },
            window: { runs: 4, timezone: 'Europe/Berlin', current: [], previous: [], trend: [], answers: 0, prompts: 0, latest_answer_at: null, latest_run_number: null },
          },
          page: { offset: 0, limit: 200, total: 0 },
        }),
      ),
    );
    const { user, props } = setup();
    expect(await screen.findByRole('heading', { name: 'No citations in this scope' })).toBeVisible();
    expect(screen.getByText('No answer in ChatGPT, All groups, Last 4 runs cites a page. Choose more runs or another group.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset scope' }));
    expect(props.onResetScope).toHaveBeenCalled();
  });

  it('resets the sort when the owner changes (C 555)', async () => {
    const { user, props } = setup();
    await screen.findByRole('table', { name: 'Cited pages' });
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(within(screen.getByRole('group', { name: 'Domain type' })).getByRole('button', { name: /^All/ }));
    expect(props.onOwnerChange).toHaveBeenCalledWith('all');
    expect(screen.getByRole('columnheader', { name: /Citations/ })).toHaveAttribute('aria-sort', 'descending');
  });
});
```

Run: `cd apps/web && pnpm vitest run src/components/app/filters/pressed-group.test.tsx src/features/citations/board-text.test.ts src/features/citations/board-export.test.ts src/features/citations/cited-pages/pages-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Write `PressedGroup` and `BoardTableSkeleton`**

`apps/web/src/components/app/filters/pressed-group.tsx`:

```tsx
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface PressedGroupItem<TValue extends string> {
  value: TValue;
  label: string;
  /** Preformatted: "13". */
  count?: string | undefined;
}

export interface PressedGroupProps<TValue extends string> {
  /** Names the group: "Domain type". */
  label: string;
  value: TValue;
  items: readonly PressedGroupItem<TValue>[];
  onValueChange: (value: TValue) => void;
}

/**
 * A filter of one table's rows by kind, with the rows of each kind (13 section 10, the Cited pages owner filter,
 * C 545 to 557): toggle buttons in one rounded group, one pressed. It scrolls sideways on a narrow screen.
 */
export function PressedGroup<TValue extends string>({
  label,
  value,
  items,
  onValueChange,
}: PressedGroupProps<TValue>): ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface p-0.5"
    >
      {items.map((item) => {
        const pressed = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 whitespace-nowrap outline-none focus-visible:focus-ring-inset',
              pressed
                ? 'bg-primary-subtle type-body-strong text-primary-text'
                : 'type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <span>{item.label}</span>
            {item.count === undefined ? null : <span className="num type-meta">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

Append to `board-table.tsx`:

```tsx
const SKELETON_WIDTHS = [72, 56, 80, 64, 48, 72, 56, 64] as const;

/** The table while its first rows load (17 section 3): the real headers, eight rows of pulsing bars. */
export function BoardTableSkeleton({
  columns,
  rows = 8,
  flexMin = DEFAULT_FLEX_MIN,
}: {
  columns: readonly Pick<BoardColumn<unknown>, 'id' | 'header' | 'width'>[];
  rows?: number | undefined;
  flexMin?: number | undefined;
}): ReactElement {
  const minWidth = columns.reduce((sum, column) => sum + (column.width ?? flexMin), 0);
  return (
    <div className="relative isolate min-h-0 flex-1 overflow-hidden" aria-hidden="true">
      <table
        className="table-fixed border-separate border-spacing-0 type-table"
        style={{ width: '100%', minWidth: `${String(minWidth)}px` }}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={column.width === null ? undefined : { width: `${String(column.width)}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={cn(HEADER, 'z-(--z-table-header)')}>
                <span className="truncate type-table-header">{column.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} className="h-row">
              {columns.map((column, index) => (
                <td key={column.id} className={CELL}>
                  <Skeleton shape="text-13" widthPct={SKELETON_WIDTHS[(row + index) % SKELETON_WIDTHS.length] ?? 64} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(`Skeleton` from `@/components/ui/skeleton` joins the imports.) Add a `board-table.test.tsx` case: `render(<BoardTableSkeleton columns={[{ id: 'a', header: 'Page', width: 280 }]} />)` draws one header and eight rows.

- [ ] **Step 3: Add `updatedText`**

In `board-text.ts`:

```ts
import { formatInteger, formatTableDate, formatTableDateTime } from '@/lib/format';
import type { RunSlot, RunWindow, RunsChoice } from '@/lib/citations/board-queries';

/** "Updated Sep 28, 02:15 · run 48" (C 189): the latest answer in scope and the project's run number. */
export function updatedText(
  window: Pick<RunWindow, 'latest_answer_at' | 'latest_run_number'>,
  timeZone: string,
  t: CitationsTranslate,
): string | null {
  const latest = window.latest_answer_at;
  if (latest === null) return null;
  const time = formatTableDateTime(latest, timeZone, new Date(latest));
  return window.latest_run_number === null
    ? t('board.updatedNoRun', { time })
    : t('board.updated', { time, run: formatInteger(window.latest_run_number) });
}
```

- [ ] **Step 4: Write the prompts popover**

`apps/web/src/features/citations/cited-pages/prompts-popover.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { Truncate } from '@/components/ui/truncate';
import type { CitedPageRow } from '@/lib/citations/board-queries';

/** The prompts a popover lists (C 428). */
export const POPOVER_PROMPTS = 10;

export interface PromptsPopoverProps {
  row: CitedPageRow;
  /** The row's "+N" or "Details" chip. */
  chip: ReactElement;
  /** Opens the page drawer on its Prompts tab (C 437 to 440). */
  onDetails: () => void;
}

/** The prompts a page is cited for, top ten (C 416 to 444): head, ordered list, and the way to the page drawer. */
export function PromptsPopover({ row, chip, onDetails }: PromptsPopoverProps): ReactElement {
  const t = useTranslations('citations.promptsPopover');
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={chip}
      aria-label={t('label', { path: row.path })}
      width="wide"
      padding="none"
      align="start"
      footer={
        <div className="px-3 py-2">
          <Button
            variant="link"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            {row.prompts > POPOVER_PROMPTS ? t('showAll', { count: row.prompts }) : t('details')}
          </Button>
        </div>
      }
    >
      <div className="flex items-baseline gap-2 border-b border-border-subtle px-3 pt-3 pb-2">
        <span className="type-subsection-title">{t('head')}</span>
        <span className="num type-meta">{t('meta', { prompts: row.prompts, citations: row.citations })}</span>
      </div>
      <ol className="max-h-80 overflow-y-auto py-1">
        {row.top_prompts.slice(0, POPOVER_PROMPTS).map((prompt) => (
          <li key={prompt.prompt_id} className="flex min-h-8 items-center gap-3 px-3 py-1">
            <Truncate text={prompt.text} className="min-w-0 flex-1 type-body text-foreground" />
            <span className="shrink-0 num type-meta">{t('count', { count: prompt.citations })}</span>
          </li>
        ))}
      </ol>
    </Popover>
  );
}
```

`max-h-80` is the preview's 320 px list height (C 427); the lint's spacing rules (`OFF_SCALE_SPACING`, `SIZE_AS_SPACING`, `eslint.config.mjs` lines 96 to 124) read padding, margin and gap only, so a max height passes.

- [ ] **Step 5: Write the tab**

`apps/web/src/features/citations/cited-pages/pages-tab.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import type { BoardEngine } from '../board-reads';
import { useCitedPages } from '../board-reads';
import { BoardPanel } from '../board-panel';
import { OWNERS, type Owner } from '../board-state';
import { updatedText, type PreviousText } from '../board-text';
import { pageColumns, pageIdentity } from './page-columns';
import { apiSort, ownerRole, PAGE_SORT_DEFAULT } from './page-rows';
import { PromptsPopover } from './prompts-popover';
import { PressedGroup } from '@/components/app/filters/pressed-group';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { BoardTable, BoardTableSkeleton, type BoardSort } from '@/components/app/table/board-table';
import { Button } from '@/components/ui/button';
import type { BoardScopeParams, CitedPageRow } from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatInteger } from '@/lib/format';

/** How long the search waits for the next keystroke before it asks the API. */
const SEARCH_DELAY_MS = 250;

export interface PagesTabProps {
  project: SourceScope;
  scope: BoardScopeParams;
  /** The engines are known and at least one is in scope; the read waits until then. */
  ready: boolean;
  /** The engines in scope, in code order. */
  engines: readonly BoardEngine[];
  owner: Owner;
  search: string;
  onOwnerChange: (owner: Owner) => void;
  onSearchChange: (search: string) => void;
  onResetScope: () => void;
  tabs: ReactNode;
  previous: PreviousText;
  /** "<platform>, <group>, <runs label>" (C 106). */
  scopeText: string;
  timeZone: string;
  activeId: string | null;
  /** Opens the page drawer; from the popover's foot, on its Prompts tab (C 439). */
  onOpen: (row: CitedPageRow, opener: HTMLElement | null) => void;
  /** The rows in the table's order, for the drawer's J and K and "i of n". */
  onOrderChange: (ids: readonly string[]) => void;
}

/**
 * Cited pages (C 410 to 571, D-6): the API sorts, searches and pages (200 rows a page, the next at the end of the
 * scroll); the owner filter's counts are the API's, whatever the filter and the search. Changing the owner resets
 * the sort (C 555).
 */
export function PagesTab(props: PagesTabProps): ReactElement {
  const t = useTranslations('citations');
  const { owner, search, engines, previous, timeZone } = props;
  const [sort, setSort] = useState<BoardSort>(PAGE_SORT_DEFAULT);
  const q = useDebouncedValue(search, SEARCH_DELAY_MS);
  const list = useMemo(() => ({ role: ownerRole(owner), q, sort: apiSort(sort) }), [owner, q, sort]);
  // Not before the engines are known: an empty engine list would mean every engine (D-4)
  const read = useCitedPages(props.project, props.scope, list, props.ready);
  const window = read.meta?.window;
  const latest = window?.latest_answer_at ?? null;

  const { onOrderChange, onOpen } = props;
  useEffect(() => {
    onOrderChange(read.rows.map((row) => String(row.url_id)));
  }, [read.rows, onOrderChange]);

  const trendSlots = window?.trend.length ?? 8;
  const columns = useMemo(
    () =>
      pageColumns({
        t,
        owner,
        engines,
        previous,
        trendSlots,
        timeZone,
        latest,
        promptsPopover: (row, chip) => <PromptsPopover row={row} chip={chip} onDetails={() => onOpen(row, null)} />,
      }),
    [t, owner, engines, previous, trendSlots, timeZone, latest, onOpen],
  );

  const counts = read.meta?.owners;
  const controls = (
    <PressedGroup<Owner>
      label={t('pages.ownerLabel')}
      value={owner}
      onValueChange={(next) => {
        setSort(PAGE_SORT_DEFAULT);
        props.onOwnerChange(next);
      }}
      items={OWNERS.map((value) => ({
        value,
        label: t(`pages.owners.${value}`),
        count:
          counts === undefined
            ? undefined
            : formatInteger(value === 'third' ? counts.third_party : value === 'all' ? counts.all : counts[value]),
      }))}
    />
  );

  const noun = owner === 'competitor' || owner === 'third' ? t(`pages.nouns.${owner}`) : null;
  let body: ReactNode;
  if (read.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} />;
  } else if (read.status === 'error') {
    body = (
      <InlineError
        title={t('board.loadFailedTitle')}
        reason={t('board.loadFailedReason')}
        errorId={read.errorId}
        onRetry={read.retry}
        retrying={read.retrying}
        retryLabel={t('board.retry')}
      />
    );
  } else if ((counts?.all ?? 0) === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('pages.emptyTitle')}
        reason={t('pages.emptyReason', { scope: props.scopeText })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={props.onResetScope}>
            {t('pages.resetScope')}
          </Button>
        }
      />
    );
  } else if (read.total === 0) {
    const searching = search !== '';
    const reason = searching
      ? owner === 'own'
        ? t('pages.noMatchSearchOwn', { query: search })
        : noun === null
          ? t('pages.noMatchSearchAll', { query: search })
          : t('pages.noMatchSearch', { noun, query: search })
      : owner === 'own'
        ? t('pages.noMatchOwnerOwn', { scope: props.scopeText })
        : t('pages.noMatchOwner', { noun: noun ?? '', scope: props.scopeText });
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('pages.noMatchTitle')}
        reason={reason}
        primaryAction={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (searching ? props.onSearchChange('') : props.onOwnerChange('all'))}
          >
            {searching ? t('pages.clearSearch') : t('pages.showAll')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <BoardTable<CitedPageRow>
        caption={t('pages.caption')}
        columns={columns}
        rows={read.rows}
        rowId={(row) => String(row.url_id)}
        rowLabel={(row) => pageIdentity(row, t, previous).label}
        identityTip={(row) => pageIdentity(row, t, previous).tip}
        onOpen={onOpen}
        activeId={props.activeId}
        sort={sort}
        onSortChange={setSort}
        onEndReached={read.hasMore ? read.loadMore : undefined}
        busy={read.refetching || read.loadingMore}
      />
    );
  }

  return (
    <BoardPanel
      tabs={props.tabs}
      search={search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('board.searchPages')}
      controls={controls}
      refetching={read.refetching}
      footerText={
        read.total === null || read.meta === undefined
          ? null
          : t('pages.footer', { pages: read.total, citations: formatInteger(read.meta.citations) })
      }
      updated={window === undefined ? null : updatedText(window, timeZone, t)}
    >
      {body}
    </BoardPanel>
  );
}
```

The screen passes `onOpen` and `onOrderChange` as `useCallback`s, so the columns are built once per scope. `t(\`pages.owners.${value}\`)` and `t(\`pages.nouns.${owner}\`)` are template keys over literal unions, as the Prompts screen writes its tab labels.

The "No pages match" text uses the preview's words with D-10's accepted change for Your site ("No page of your site contains ..." and "No pages of your site are cited in ...", brief 3.5).

- [ ] **Step 6: Write the export**

`apps/web/src/features/citations/board-export.ts`:

```ts
import type { BoardEngine, TrackedCompetitor } from './board-reads';
import type { CitationsTranslate } from './board-text';
import type { CitationGapRow, CitedPageRow } from '@/lib/citations/board-queries';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { formatIsoDate } from '@/lib/format';

/**
 * The CSV of the tab on screen (brief 3.2: the preview's Export only shows a note; the app writes a file with
 * `@/lib/csv/csv-write`). Text cells go through `safeText`, so a cell a spreadsheet would read as a formula is text.
 */

const text = (value: string | null): CsvCell => (value === null ? null : safeText(value));

export function pagesCsv(
  rows: readonly CitedPageRow[],
  engines: readonly BoardEngine[],
  timeZone: string,
  t: CitationsTranslate,
): CsvTable {
  const role = (row: CitedPageRow): string =>
    row.domain_role === 'own'
      ? t('pages.yourSite')
      : row.domain_role === 'competitor'
        ? t('pageDrawer.competitor')
        : t('pages.thirdParty');
  return {
    header: [
      t('download.url'),
      t('download.title'),
      t('download.domainType'),
      t('download.brand'),
      t('download.citations'),
      t('download.previous'),
      t('download.prompts'),
      t('download.topPrompt'),
      t('download.lastCited'),
      ...engines.map((engine) => t('download.engineCitations', { engine: engine.label })),
    ],
    rows: rows.map((row) => [
      text(row.url),
      text(row.title),
      role(row),
      text(row.entity_name),
      row.citations,
      row.previous_citations,
      row.prompts,
      text(row.top_prompts[0]?.text ?? null),
      formatIsoDate(row.last_cited_at, timeZone),
      ...engines.map((engine) => row.engines.find((cell) => cell.engine_code === engine.code)?.citation_units ?? 0),
    ]),
  };
}

export function gapsCsv(
  rows: readonly CitationGapRow[],
  competitors: readonly TrackedCompetitor[],
  ownName: string,
  engines: readonly BoardEngine[],
  t: CitationsTranslate,
): CsvTable {
  const state = (cited: number): string => (cited > 0 ? t('marks.cited') : t('marks.notCited'));
  const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const nameOf = (id: string): string => competitors.find((competitor) => competitor.id === id)?.name ?? id;
  return {
    header: [
      t('download.prompt'),
      t('download.group'),
      t('download.brandState', { brand: ownName }),
      t('download.brandCited', { brand: ownName }),
      ...competitors.flatMap((competitor) => [
        t('download.brandState', { brand: competitor.name }),
        t('download.brandCited', { brand: competitor.name }),
      ]),
      t('download.lostOn'),
      t('download.lostTo'),
    ],
    rows: rows.map((row) => [
      text(row.text),
      text(row.topic?.name ?? t('toolbar.noGroup')),
      state(row.you.total.cited),
      row.you.total.cited,
      ...competitors.flatMap((competitor) => {
        const cell = row.competitors.find((candidate) => candidate.entity_id === competitor.id)?.total;
        return [cell === undefined ? null : state(cell.cited), cell?.cited ?? null];
      }),
      row.lost_on.map(labelOf).join(', '),
      row.lost_to.map(nameOf).join(', '),
    ]),
  };
}
```

`gapsCsv` takes the selected competitors (the gap columns), in their order.

- [ ] **Step 7: Run the tests**

Run: `cd apps/web && pnpm vitest run src/components/app/filters/pressed-group.test.tsx src/components/app/table src/features/citations/board-text.test.ts src/features/citations/board-export.test.ts src/features/citations/cited-pages`
Expected: PASS.

- [ ] **Step 8: Document, check and commit**

`13-filters-search.md`, new "## 10. Pressed group" (after "9. Saved views and filters"): "PressedGroup (WP-77): a few kinds of one table's rows, each with its count, one pressed; it changes the rows, not the scope, so it sits in the table's toolbar, not the filter bar." Inventory entries for PressedGroup and BoardTableSkeleton; specimen in `filters-section.tsx`.

Run: `cd apps/web && pnpm prettier --write src/components/app/filters/pressed-group*.tsx src/components/app/table src/components/design-system/filters-section.tsx src/features/citations && pnpm lint && pnpm typecheck && pnpm format:check`

```bash
git add apps/web/src/components/app/filters/pressed-group.tsx apps/web/src/components/app/filters/pressed-group.test.tsx apps/web/src/components/app/table apps/web/src/components/design-system/filters-section.tsx apps/web/src/features/citations/board-text.ts apps/web/src/features/citations/board-text.test.ts apps/web/src/features/citations/board-export.ts apps/web/src/features/citations/board-export.test.ts apps/web/src/features/citations/cited-pages docs/design-system/13-filters-search.md docs/design-system/25-component-inventory.md
git commit -m "WP-77: Cited pages tab with owner filter, prompts popover, paging and CSV"
```

---

### Task 9: Gap analysis

Brief step 7. Parity rows: 3.6, every row (C 573 to 686): controls, summary, footer, the column table, the mark (C 589 to 606), the sorts (C 613 to 620), the empty states; D-10 (No group, sorted last).

**Files:**
- Create: `apps/web/src/features/citations/gaps/gap-model.ts`, `gap-model.test.ts`
- Create: `apps/web/src/features/citations/gaps/gap-mark.tsx`, `gaps-tab.tsx`, `gaps-tab.test.tsx`

The gap rows are read by the screen (the tab's count badge shows on both tabs, C 704) and handed to the tab; the search, Only gaps and the sort run in the browser over `data`, at most the project's prompt limit (brief 3.6).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/citations/gaps/gap-model.test.ts`:

```ts
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { GAP_SORT_DEFAULT, lostTip, markLines, markTone, sortGapRows, visibleGapRows } from './gap-model';
import messages from '../../../../messages/en.json';
import type { CitationGapRow } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
type Brand = CitationGapRow['you'];
const brand = (cells: readonly [number, number, number][]): Brand => {
  const codes = ['chatgpt_web', 'gemini_web'] as const;
  const engines = cells.map(([answers, cited, mentioned], index) => ({
    engine_code: codes[index] ?? 'chatgpt_web',
    answers,
    cited,
    mentioned,
    state: answers === 0 ? ('none' as const) : cited > 0 ? ('cited' as const) : mentioned > 0 ? ('mentioned' as const) : ('not' as const),
  }));
  const total = engines.reduce((sum, cell) => ({ answers: sum.answers + cell.answers, cited: sum.cited + cell.cited, mentioned: sum.mentioned + cell.mentioned }), { answers: 0, cited: 0, mentioned: 0 });
  return {
    engines,
    total: { ...total, state: total.answers === 0 ? 'none' : total.cited > 0 ? 'cited' : total.mentioned > 0 ? 'mentioned' : 'not' },
    platforms: engines.filter((cell) => cell.answers > 0).length,
    cited_on: engines.filter((cell) => cell.cited > 0).length,
  };
};
const row = (text: string, topic: string | null, gap: number, you: Brand, extra: Partial<CitationGapRow> = {}): CitationGapRow => ({
  prompt_id: text,
  text,
  topic: topic === null ? null : { term_id: topic, name: topic },
  you,
  competitors: [{ ...brand([[4, 2, 2]]), entity_id: 'c1' }],
  gap,
  lost_on: gap > 0 ? ['chatgpt_web'] : [],
  lost_to: gap > 0 ? ['c1'] : [],
  competitor_answers: 2,
  ...extra,
});
const ROWS = [
  row('Best CRM?', 'Pricing', 1, brand([[4, 0, 1], [3, 1, 1]])),
  row('CRM for startups', null, 0, brand([[4, 2, 2]])),
  row('Cheap CRM', 'Pricing', 2, brand([[4, 0, 0], [2, 0, 0]]), { lost_to: ['c1', 'c2'] }),
];

describe('the gap analysis rows', () => {
  it('keeps only gaps by default and searches prompts and groups (C 612)', () => {
    expect(visibleGapRows(ROWS, { gapsOnly: true, search: '' }).map((r) => r.text)).toEqual(['Best CRM?', 'Cheap CRM']);
    expect(visibleGapRows(ROWS, { gapsOnly: false, search: 'PRICING' })).toHaveLength(2);
    expect(visibleGapRows(ROWS, { gapsOnly: false, search: 'startups' })).toHaveLength(1);
  });

  it('sorts Lost on by gap, then lost to, then competitor answers, ties by text (C 615)', () => {
    expect(GAP_SORT_DEFAULT).toEqual({ key: 'gap', dir: 'desc' });
    expect(sortGapRows(ROWS, GAP_SORT_DEFAULT).map((r) => r.text)).toEqual(['Cheap CRM', 'Best CRM?', 'CRM for startups']);
  });

  it('sorts you by state, then engines cited on, then citing answers', () => {
    expect(sortGapRows(ROWS, { key: 'you', dir: 'desc' }).map((r) => r.text)).toEqual(['CRM for startups', 'Best CRM?', 'Cheap CRM']);
  });

  it('sorts a group by name and keeps No group last both ways (D-10)', () => {
    expect(sortGapRows(ROWS, { key: 'topic', dir: 'asc' }).map((r) => r.text).at(-1)).toBe('CRM for startups');
    expect(sortGapRows(ROWS, { key: 'topic', dir: 'desc' }).map((r) => r.text).at(-1)).toBe('CRM for startups');
  });

  it('writes the mark tooltip one sentence per engine (C 582 to 587)', () => {
    const labelOf = (code: string): string => (code === 'chatgpt_web' ? 'ChatGPT' : 'Gemini');
    expect(markLines(brand([[4, 0, 1], [3, 1, 1]]), labelOf, t)).toBe(
      'ChatGPT: mentioned in 1 of 4 answers, never cited. Gemini: cited in 1 of 3 answers',
    );
    expect(markLines(brand([[0, 0, 0], [1, 0, 0]]), labelOf, t)).toBe('ChatGPT: no answers. Gemini: not cited in 1 answer');
  });

  it('tones only your mark (C 596 to 598)', () => {
    expect(markTone('cited', { own: true, lost: false })).toBe('text-positive-text');
    expect(markTone('cited', { own: true, lost: true })).toBe('text-warning-text');
    expect(markTone('not', { own: true, lost: true })).toBe('text-negative-text');
    expect(markTone('mentioned', { own: true, lost: false })).toBe('text-foreground-tertiary');
    expect(markTone('cited', { own: false, lost: false })).toBe('text-foreground');
    expect(markTone('not', { own: false, lost: false })).toBe('text-foreground-tertiary');
  });

  it('says where and to whom a prompt is lost (C 661)', () => {
    const third = ROWS[2];
    if (third === undefined) throw new Error('No row');
    expect(lostTip(third, () => 'ChatGPT', (id) => (id === 'c1' ? 'HubSpot' : 'Pipedrive'), t)).toBe(
      'Lost on ChatGPT to HubSpot, Pipedrive',
    );
  });
});
```

`apps/web/src/features/citations/gaps/gaps-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GapsTab, type GapsTabProps } from './gaps-tab';
import type { CitationGapList } from '@/lib/citations/board-queries';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const cell = (answers: number, cited: number) => ({
  answers,
  cited,
  mentioned: cited,
  state: answers === 0 ? ('none' as const) : cited > 0 ? ('cited' as const) : ('not' as const),
});
const brand = (answers: number, cited: number) => ({
  total: cell(answers, cited),
  engines: [{ ...cell(answers, cited), engine_code: 'chatgpt_web' as const }],
  platforms: 1,
  cited_on: cited > 0 ? 1 : 0,
});
const WINDOW = {
  runs: 4,
  timezone: 'Europe/Berlin',
  current: [],
  previous: [],
  trend: [],
  answers: 8,
  prompts: 2,
  latest_answer_at: '2026-09-28T00:10:00.000Z',
  latest_run_number: 48,
};
const LIST: CitationGapList = {
  data: [
    {
      prompt_id: 'p1',
      text: 'Best CRM?',
      topic: { term_id: 't1', name: 'Pricing' },
      you: brand(4, 0),
      competitors: [{ ...brand(4, 2), entity_id: 'c1' }],
      gap: 1,
      lost_on: ['chatgpt_web'],
      lost_to: ['c1'],
      competitor_answers: 2,
    },
    {
      prompt_id: 'p2',
      text: 'CRM for startups',
      topic: null,
      you: brand(4, 3),
      competitors: [{ ...brand(4, 0), entity_id: 'c1' }],
      gap: 0,
      lost_on: [],
      lost_to: [],
      competitor_answers: 0,
    },
  ],
  meta: { competitors: [{ entity_id: 'c1', name: 'HubSpot', color_index: 2, domain: 'hubspot.com' }], gaps: 1, prompts: 2, window: WINDOW },
};

function setup(overrides: Partial<GapsTabProps> = {}) {
  const props: GapsTabProps = {
    read: { status: 'ready', data: LIST, refetching: false, notFound: false, errorId: null, retry: vi.fn(), retrying: false },
    competitors: [{ id: 'c1', name: 'HubSpot', colorIndex: 2, domain: 'hubspot.com' }],
    ownName: 'Fynix',
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    gapsOnly: true,
    search: '',
    onGapsOnlyChange: vi.fn(),
    onSearchChange: vi.fn(),
    onResetScope: vi.fn(),
    onChooseCompetitors: vi.fn(),
    tabs: <nav aria-label="Citations views" />,
    scopeText: 'All platforms, All groups, Last 4 runs',
    timeZone: 'Europe/Berlin',
    activeId: null,
    onOpen: vi.fn(),
    onOrderChange: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<GapsTab {...props} />) };
}

describe('the gap analysis tab', () => {
  it('shows only gaps, the summary, the footer and the columns (C 623 to 679)', async () => {
    const { container } = setup();
    const table = screen.getByRole('table', { name: 'Gap analysis' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Prompt',
      'Group',
      'Fynix',
      'HubSpot',
      'Lost on',
    ]);
    expect(screen.getByRole('checkbox', { name: 'Only gaps' })).toBeChecked();
    expect(screen.getByText('of 2 prompts lost to a competitor on at least one platform', { exact: false })).toBeVisible();
    expect(screen.getByText('1 prompt with a gap')).toBeVisible();
    expect(within(table).getByText('to 1 competitor')).toBeVisible();
    expect(within(table).getByText('Not cited')).toHaveClass('sr-only');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows every prompt with Only gaps off, No group in tertiary and None where nothing is lost', () => {
    setup({ gapsOnly: false });
    expect(screen.getByText('No group')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('None')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('2 prompts')).toBeVisible();
  });

  it('asks for competitors when none is chosen, and opens the picker (C 681)', async () => {
    const { user, props } = setup({
      competitors: [],
      read: { status: 'ready', data: undefined, refetching: false, notFound: false, errorId: null, retry: vi.fn(), retrying: false },
    });
    expect(screen.getByRole('heading', { name: 'Choose competitors to compare' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choose competitors' }));
    expect(props.onChooseCompetitors).toHaveBeenCalled();
  });

  it('says no prompt matches a search, and no gap with Only gaps on', async () => {
    const { unmount } = setup({ search: 'zzz' });
    expect(screen.getByText('No prompt or group contains “zzz”.')).toBeVisible();
    unmount();
    const { user, props } = setup({
      read: {
        status: 'ready',
        data: { ...LIST, data: LIST.data.slice(1) },
        refetching: false,
        notFound: false,
        errorId: null,
        retry: vi.fn(),
        retrying: false,
      },
    });
    expect(screen.getByRole('heading', { name: 'No gaps in this scope' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show all prompts' }));
    expect(props.onGapsOnlyChange).toHaveBeenCalledWith(false);
  });
});
```

Run: `cd apps/web && pnpm vitest run src/features/citations/gaps`
Expected: FAIL.

- [ ] **Step 2: Write the model**

`apps/web/src/features/citations/gaps/gap-model.ts`:

```ts
import type { CitationsTranslate } from '../board-text';
import type { BoardSort } from '@/components/app/table/board-table';
import type { CitationGapRow } from '@/lib/citations/board-queries';

type Brand = CitationGapRow['you'];
type BrandState = Brand['total']['state'];

/** Lost on, descending (C 32). */
export const GAP_SORT_DEFAULT: BoardSort = { key: 'gap', dir: 'desc' };
const RANK: Readonly<Record<BrandState, number>> = { cited: 3, mentioned: 2, not: 1, none: 0 };

/** Only gaps and the search (C 612): the prompt's text or its group's name, case ignored. */
export function visibleGapRows(
  rows: readonly CitationGapRow[],
  { gapsOnly, search }: { gapsOnly: boolean; search: string },
): CitationGapRow[] {
  const needle = search.toLowerCase();
  return rows.filter(
    (row) =>
      (!gapsOnly || row.gap > 0) &&
      (needle === '' ||
        row.text.toLowerCase().includes(needle) ||
        (row.topic?.name.toLowerCase().includes(needle) ?? false)),
  );
}

function sortValue(row: CitationGapRow, key: string): number | string | null {
  if (key === 'prompt') return row.text;
  if (key === 'topic') return row.topic?.name ?? null;
  if (key === 'you') return RANK[row.you.total.state] * 100_000 + row.you.cited_on * 1000 + row.you.total.cited;
  if (key.startsWith('c:')) {
    const id = key.slice(2);
    return row.competitors.find((competitor) => competitor.entity_id === id)?.total.cited ?? 0;
  }
  return row.gap * 100_000 + row.lost_to.length * 1000 + row.competitor_answers;
}

/** The sorts of C 613 to 620; ties by prompt text; a prompt with no group is last both ways (D-10). */
export function sortGapRows(rows: readonly CitationGapRow[], sort: BoardSort): CitationGapRow[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x === null || y === null) return x === y ? a.text.localeCompare(b.text) : x === null ? 1 : -1;
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return (sort.dir === 'asc' ? order : -order) || a.text.localeCompare(b.text);
  });
}

/** One brand on one engine as a sentence (C 582 to 587). */
function line(cell: Brand['engines'][number], label: string, t: CitationsTranslate): string {
  if (cell.answers === 0) return t('marks.lineNone', { engine: label });
  if (cell.cited > 0) return t('marks.lineCited', { engine: label, k: cell.cited, n: cell.answers });
  if (cell.mentioned > 0) return t('marks.lineMentioned', { engine: label, m: cell.mentioned, n: cell.answers });
  return t('marks.lineNot', { engine: label, n: cell.answers });
}

/** The mark's tooltip: one sentence per engine, joined by ". " (C 602 to 604). */
export const markLines = (
  brand: Pick<Brand, 'engines'>,
  labelOf: (code: string) => string,
  t: CitationsTranslate,
): string => brand.engines.map((cell) => line(cell, labelOf(cell.engine_code), t)).join('. ');

/** Only your mark has a tone; a competitor's is the text colour when cited (C 596 to 598). */
export function markTone(state: BrandState, { own, lost }: { own: boolean; lost: boolean }): string {
  const cited = state === 'cited';
  if (!own) return cited ? 'text-foreground' : 'text-foreground-tertiary';
  if (cited) return lost ? 'text-warning-text' : 'text-positive-text';
  return lost ? 'text-negative-text' : 'text-foreground-tertiary';
}

/** "Lost on ChatGPT, Gemini to HubSpot, Pipedrive" (C 661). */
export const lostTip = (
  row: CitationGapRow,
  labelOf: (code: string) => string,
  nameOf: (id: string) => string,
  t: CitationsTranslate,
): string =>
  t('gaps.lostTip', { engines: row.lost_on.map(labelOf).join(', '), names: row.lost_to.map(nameOf).join(', ') });
```

`markTone` returns a token class; it is the one place the mark's colour is decided, so the rule "never choose green or red yourself" (rule 6) is met by the preview's documented tone rule (brief 3.6), which this function encodes and the test pins.

- [ ] **Step 3: Write the mark and the tab**

`apps/web/src/features/citations/gaps/gap-mark.tsx`:

```tsx
'use client';

import { Check, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { markTone } from './gap-model';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import type { CitationGapRow } from '@/lib/citations/board-queries';
import { EMPTY_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface GapMarkProps {
  state: CitationGapRow['you']['total']['state'];
  own: boolean;
  /** Your mark on a prompt (or an engine) a selected competitor wins. */
  lost: boolean;
  /** One sentence per engine (`markLines`). */
  tip: string;
}

/**
 * Whether a brand is cited for a prompt (C 589 to 606): a check when an answer in scope cites it, a minus when none
 * does (a mention without a link is a minus), n/a with no answers. Screen readers hear "Cited" or "Not cited".
 */
export function GapMark({ state, own, lost, tip }: GapMarkProps): ReactElement {
  const t = useTranslations('citations.marks');
  const cited = state === 'cited';
  return (
    <Tooltip content={tip}>
      <span className={cn('inline-flex size-6 items-center justify-center', markTone(state, { own, lost }))}>
        {state === 'none' ? (
          <span className="type-table">{EMPTY_VALUE}</span>
        ) : (
          <>
            <Icon icon={cited ? Check : Minus} />
            <span className="sr-only">{cited ? t('cited') : t('notCited')}</span>
          </>
        )}
      </span>
    </Tooltip>
  );
}
```

`apps/web/src/features/citations/gaps/gaps-tab.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import type { BoardEngine, BoardRead, TrackedCompetitor } from '../board-reads';
import { BoardPanel } from '../board-panel';
import { updatedText } from '../board-text';
import { GapMark } from './gap-mark';
import { GAP_SORT_DEFAULT, lostTip, markLines, sortGapRows, visibleGapRows } from './gap-model';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { BoardTable, BoardTableSkeleton, type BoardColumn, type BoardSort } from '@/components/app/table/board-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { CitationGapList, CitationGapRow } from '@/lib/citations/board-queries';

export interface GapsTabProps {
  read: BoardRead<CitationGapList>;
  /** The selected competitors, in the tracked order: one column each. */
  competitors: readonly TrackedCompetitor[];
  ownName: string;
  engines: readonly BoardEngine[];
  gapsOnly: boolean;
  search: string;
  onGapsOnlyChange: (gapsOnly: boolean) => void;
  onSearchChange: (search: string) => void;
  onResetScope: () => void;
  /** Opens the competitors popover (C 681). */
  onChooseCompetitors: () => void;
  tabs: ReactNode;
  scopeText: string;
  timeZone: string;
  activeId: string | null;
  onOpen: (row: CitationGapRow, opener: HTMLElement | null) => void;
  onOrderChange: (ids: readonly string[]) => void;
}

/** Gap analysis (C 573 to 686): you against up to five tracked competitors, per prompt; the gap is per engine. */
export function GapsTab(props: GapsTabProps): ReactElement {
  const t = useTranslations('citations');
  const { read, competitors, engines, gapsOnly, search, onOrderChange } = props;
  const [sort, setSort] = useState<BoardSort>(GAP_SORT_DEFAULT);
  const rows = useMemo(() => read.data?.data ?? [], [read.data]);
  const visible = useMemo(
    () => sortGapRows(visibleGapRows(rows, { gapsOnly, search }), sort),
    [rows, gapsOnly, search, sort],
  );
  useEffect(() => {
    onOrderChange(visible.map((row) => row.prompt_id));
  }, [visible, onOrderChange]);

  const labelOf = useMemo(() => {
    const labels = new Map(engines.map((engine) => [engine.code, engine.label]));
    return (code: string): string => labels.get(code) ?? code;
  }, [engines]);
  const nameOf = useMemo(() => {
    const names = new Map(competitors.map((competitor) => [competitor.id, competitor.name]));
    return (id: string): string => names.get(id) ?? id;
  }, [competitors]);

  const columns = useMemo((): BoardColumn<CitationGapRow>[] => {
    return [
      {
        id: 'prompt',
        header: t('gaps.columns.prompt'),
        width: null,
        sortKey: 'prompt',
        cell: (row) => <span className="truncate text-foreground">{row.text}</span>,
      },
      {
        id: 'group',
        header: t('gaps.columns.group'),
        width: 136,
        sortKey: 'topic',
        cellClassName: 'truncate text-foreground-secondary',
        cell: (row) =>
          row.topic === null ? (
            <span className="text-foreground-tertiary">{t('toolbar.noGroup')}</span>
          ) : (
            row.topic.name
          ),
      },
      {
        id: 'you',
        header: props.ownName,
        width: 120,
        sortKey: 'you',
        tip: t('gaps.columns.youTip'),
        cell: (row) => (
          <GapMark state={row.you.total.state} own lost={row.gap > 0} tip={markLines(row.you, labelOf, t)} />
        ),
      },
      ...competitors.map(
        (competitor): BoardColumn<CitationGapRow> => ({
          id: `c:${competitor.id}`,
          header: competitor.name,
          headerLead: <EntitySwatch shape="dot" own={false} colorIndex={competitor.colorIndex} />,
          width: 120,
          sortKey: `c:${competitor.id}`,
          tip: t('gaps.columns.competitorTip', { domain: competitor.domain ?? competitor.name }),
          cell: (row) => {
            const cell = row.competitors.find((candidate) => candidate.entity_id === competitor.id);
            return cell === undefined ? (
              <GapMark state="none" own={false} lost={false} tip="" />
            ) : (
              <GapMark state={cell.total.state} own={false} lost={false} tip={markLines(cell, labelOf, t)} />
            );
          },
        }),
      ),
      {
        id: 'lost',
        header: t('gaps.columns.lostOn'),
        width: 184,
        sortKey: 'gap',
        tip: t('gaps.columns.lostOnTip'),
        cellTip: (row) => (row.gap > 0 ? lostTip(row, labelOf, nameOf, t) : undefined),
        cell: (row) =>
          row.gap > 0 ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex shrink-0 items-center gap-1">
                {row.lost_on.map((code) => (
                  <EngineLogo key={code} engine={code} name={labelOf(code)} nameDisplay="visually-hidden" />
                ))}
              </span>
              <span className="truncate num text-foreground-secondary">
                {t('gaps.lostTo', { count: row.lost_to.length })}
              </span>
            </span>
          ) : (
            <span className="text-foreground-tertiary">{t('gaps.none')}</span>
          ),
      },
    ];
  }, [t, props.ownName, competitors, labelOf, nameOf]);

  const controls = (
    <Checkbox checked={gapsOnly} label={t('gaps.onlyGaps')} onCheckedChange={(next) => props.onGapsOnlyChange(next)} />
  );
  const gaps = rows.filter((row) => row.gap > 0).length;
  const summary =
    read.data === undefined ? null : (
      <p className="num type-meta md:whitespace-nowrap">
        {t.rich('gaps.summary', {
          gaps,
          prompts: rows.length,
          strong: (chunks) => <span className="type-body-strong text-foreground">{chunks}</span>,
        })}
      </p>
    );

  let body: ReactNode;
  if (competitors.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.chooseTitle')}
        reason={t('gaps.chooseReason')}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={props.onChooseCompetitors}>
            {t('gaps.chooseAction')}
          </Button>
        }
      />
    );
  } else if (read.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} />;
  } else if (read.status === 'error') {
    body = (
      <InlineError
        title={t('board.loadFailedTitle')}
        reason={t('board.loadFailedReason')}
        errorId={read.errorId}
        onRetry={read.retry}
        retrying={read.retrying}
        retryLabel={t('board.retry')}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.noAnswersTitle')}
        reason={t('gaps.noAnswersReason', { scope: props.scopeText })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={props.onResetScope}>
            {t('gaps.resetScope')}
          </Button>
        }
      />
    );
  } else if (visible.length === 0 && search !== '') {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.noMatchTitle')}
        reason={t('gaps.noMatchReason', { query: search })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => props.onSearchChange('')}>
            {t('gaps.clearSearch')}
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.noGapsTitle')}
        reason={t('gaps.noGapsReason')}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => props.onGapsOnlyChange(false)}>
            {t('gaps.showAll')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <BoardTable<CitationGapRow>
        caption={t('gaps.caption')}
        columns={columns}
        rows={visible}
        rowId={(row) => row.prompt_id}
        rowLabel={(row) => t('gaps.open', { prompt: row.text })}
        identityTip={(row) => ({ content: row.text })}
        onOpen={props.onOpen}
        activeId={props.activeId}
        sort={sort}
        onSortChange={setSort}
        busy={read.refetching}
      />
    );
  }

  const window = read.data?.meta.window;
  return (
    <BoardPanel
      tabs={props.tabs}
      search={search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('board.searchPrompts')}
      controls={controls}
      summary={summary}
      refetching={read.refetching}
      footerText={
        read.data === undefined
          ? null
          : gapsOnly
            ? t('gaps.footerGaps', { count: visible.length })
            : t('gaps.footer', { count: visible.length })
      }
      updated={window === undefined ? null : updatedText(window, props.timeZone, t)}
    >
      {body}
    </BoardPanel>
  );
}
```

`t.rich` with a `strong` tag is next-intl's rich text (`<strong>...</strong>` in the message, C 676). The "Only gaps" checkbox keeps its visible label at the right of the box, as the preview's (C 669 to 673).

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && pnpm vitest run src/features/citations/gaps`
Expected: PASS.

- [ ] **Step 5: Checks and commit**

Run: `cd apps/web && pnpm prettier --write src/features/citations/gaps && pnpm lint && pnpm typecheck && pnpm format:check`

```bash
git add apps/web/src/features/citations/gaps
git commit -m "WP-77: gap analysis tab with marks, sorts and Only gaps"
```

---

### Task 10: Page drawer

Brief step 8 (first half). Parity rows: 3.1 "Inspector targets" (`cited-page`), 3.7, every row (I 71 to 207, 336 to 340, 355 to 365).

**Files:**
- Modify: `apps/web/src/lib/inspector/placement.ts` (two types, both 440 px), `placement.test.ts` [lease]
- Modify: `apps/web/src/components/app/inspector/inspector-section.tsx` (`meta`, `flush`, optional `icon`), `inspector.test.tsx` (where `InspectorSection` is tested)
- Modify: `apps/web/src/components/app/status/empty-state.tsx` (a `card` variant), `status.test.tsx`
- Modify: `apps/web/src/components/app/sparkline/sparkline-cell.tsx` (`width="fill"`), `sparkline-cell.test.tsx`
- Create: `apps/web/src/features/citations/drawers/drawer-parts.tsx`, `page-drawer.tsx`, `page-drawer.test.tsx`
- Modify: `docs/design-system/16-drawers-dialogs-popovers.md` section 2.7 (the two inspector types), `25-component-inventory.md` (InspectorSection, EmptyState, SparklineCell notes)

Design:
- Tabs: Prompts (the default, so no `itab`) and Overview. Overview's value is `page-overview`, because `overview` is `useInspector`'s value for "no tab in the address" (`DEFAULT_INSPECTOR_TAB`); the drawer reads `tab === DEFAULT_INSPECTOR_TAB ? 'prompts' : tab`, as the prompt inspector maps Latest (`prompts-screen.tsx` line 1146).
- Header (I 41 to 45, 81 to 83): the title is the page's title (its address when it has none); badges: the owner badge (dot and "Your page", the competitor's name or "Third-party") then the scope parts (platform, group, runs label); the context line is `InspectorHeader`'s "Cited page · 3 of 26" with "48 citations" in its freshness slot (one more " · ").
- A `404` (no answer of the window cites the page, WP-76) is an answer: the body says "Not cited in this scope" (Open point 7).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/inspector/placement.test.ts`:

```ts
it('opens the two Citations drawers at 440 px (WP-77)', () => {
  expect(parseInspectTarget('cited-page:12')).toEqual({ type: 'cited-page', id: '12' });
  expect(parseInspectTarget('gap-prompt:0192d1a8-c177-7000-8000-000000000001')).toMatchObject({ type: 'gap-prompt' });
  expect(defaultInspectorWidth('cited-page')).toBe(440);
  expect(defaultInspectorWidth('gap-prompt')).toBe(440);
});
```

Append to `apps/web/src/components/app/inspector/inspector.test.tsx` (it imports `InspectorSection`, `screen` and `renderWithProviders`):

```tsx
it('draws a meta after the title and a flush body for a table (WP-77)', () => {
  renderWithProviders(
    <InspectorSection title="Prompts that cite this page" meta="31 prompts · cited in 76 answers" status="ready" flush>
      <table aria-label="t" />
    </InspectorSection>,
  );
  expect(screen.getByText('31 prompts · cited in 76 answers')).toHaveClass('type-meta');
  expect(screen.getByRole('table', { name: 't' }).parentElement?.className ?? '').not.toContain('px-4');
});
```

Append to the `EmptyState` block of `apps/web/src/components/app/status/status.test.tsx`:

```tsx
it('draws the card empty state centred, title in body strong (WP-77, aiov-parts.js emptyBody)', () => {
  renderWithProviders(<EmptyState variant="card" headingLevel={3} title="Cited alone" reason="No other domain is cited in the answers that cite this page." />);
  expect(screen.getByRole('heading', { level: 3, name: 'Cited alone' })).toHaveClass('type-body-strong');
});
```

`apps/web/src/features/citations/drawers/page-drawer.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageDrawer, type PageDrawerProps } from './page-drawer';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const TOP = CITATIONS_FIXTURE.expected.chatgpt.pages.topOwn;
const TOP_ID = CITATIONS_FIXTURE.urls.findIndex((url) => url.role === 'own' && url.path === TOP.path) + 1;

function setup(overrides: Partial<PageDrawerProps> = {}) {
  const props: PageDrawerProps = {
    project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
    scope: { runs: 4, engines: ['chatgpt_web'], term: null },
    urlId: TOP_ID,
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    scopeParts: ['ChatGPT', 'All groups', 'Last 4 runs'],
    scopeText: 'ChatGPT, All groups, Last 4 runs',
    stepping: { positionText: '1 of 13', navigation: null, onStep: undefined },
    tab: 'overview',
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    onOpenPrompt: vi.fn(),
    timeZone: 'Europe/Berlin',
    ...overrides,
  };
  return { props, ...renderWithProviders(<InspectorLayout inspector={<PageDrawer {...props} />}><main /></InspectorLayout>) };
}

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the page drawer (I 71 to 207)', () => {
  it('heads the page with its owner, the scope and its citations, on the Prompts tab', async () => {
    const { container } = setup();
    const drawer = await screen.findByRole('complementary');
    expect(within(drawer).getByText('Your page')).toBeVisible();
    for (const part of ['ChatGPT', 'All groups', 'Last 4 runs']) expect(within(drawer).getAllByText(part).length).toBeGreaterThan(0);
    expect(within(drawer).getByText(`${String(TOP.citations)} citations`)).toBeVisible();
    expect(within(drawer).getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(drawer).findByText('Prompts that cite this page')).toBeVisible();
    expect(within(drawer).getByText(`${String(TOP.prompts)} prompts · cited in ${String(TOP.citations)} answers`)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens a prompt with the list of the drawer for J and K', async () => {
    const { user, props } = setup();
    const drawer = await screen.findByRole('complementary');
    const first = (await within(drawer).findAllByRole('button', { name: /\. Open its answers$/ }))[0];
    if (first === undefined) throw new Error('No prompt');
    await user.click(first);
    expect(props.onOpenPrompt).toHaveBeenCalledWith(expect.any(String), expect.any(Array));
  });

  it('shows the summary, the address, the trend, the platforms and what is cited alongside on Overview', async () => {
    setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Summary')).toBeVisible();
    expect(within(drawer).getByRole('button', { name: 'Copy address' })).toBeVisible();
    expect(within(drawer).getByRole('button', { name: 'Open the page in a new tab' })).toBeVisible();
    expect(within(drawer).getByText('Citations per run')).toBeVisible();
    expect(within(drawer).getByText('last 8 weekly runs')).toBeVisible();
    expect(within(drawer).getByText('citations · share')).toBeVisible();
    expect(within(drawer).getByText('Cited alongside')).toBeVisible();
  });

  it('says the page is not cited in this scope on a 404', async () => {
    setup({ urlId: 999_999 });
    expect(await screen.findByText('Not cited in this scope')).toBeVisible();
  });
});
```

Run: `cd apps/web && pnpm vitest run src/lib/inspector/placement.test.ts src/components/app/inspector/inspector.test.tsx src/components/app/status/status.test.tsx src/features/citations/drawers/page-drawer.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Extend the house pieces**

`placement.ts`: add `'cited-page'` and `'gap-prompt'` to `INSPECTOR_TYPES` after `'source'`, with the comment `// The Citations page's drawers (WP-77): a cited page by its url_id, a prompt of the gap analysis`, and to `WIDE_TYPES` (`new Set(['prompt', 'topic', 'citation', 'answer', 'cited-page', 'gap-prompt'])`). `16-drawers-dialogs-popovers.md` section 2.7 lists both, 440 px.

`inspector-section.tsx`: `icon?: LucideIcon | undefined` (drawn when given), `meta?: string | undefined` ("A short fact after the title, in meta type: '31 prompts · cited in 76 answers' (aiov-parts.js cardFrame)"), `flush?: boolean | undefined` ("The body has no padding, for a table or a list whose rows draw their own 16 px edges"). The header becomes:

```tsx
<div className="flex h-12 items-center gap-2 px-4">
  {icon === undefined ? null : <Icon icon={icon} size="default" className="shrink-0 text-foreground-tertiary" />}
  <div className="flex min-w-0 flex-1 items-baseline gap-2">
    <h3 className="min-w-0 truncate type-subsection-title">{title}</h3>
    {meta === undefined ? null : <span className="min-w-0 truncate num type-meta">{meta}</span>}
  </div>
  {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
</div>
<div className={flush ? undefined : 'px-4 pb-4'}>
```

Existing callers pass an icon and no meta or flush, and render as before.

`empty-state.tsx`: `variant` gains `'card'` ("an empty card body (aiov-parts.js `emptyBody`): centred, at least 96 px, title in body strong, reason in meta type"): container `'flex min-h-24 flex-col items-center justify-center gap-1 py-6 text-center'`, heading class `type-body-strong text-foreground` for `card` (the others keep `type-subsection-title text-foreground`), reason `max-w-reading type-meta`, no icon.

`sparkline-cell.tsx`: `width` takes `'fill'` too ("the width of its parent, measured, for a sparkline that spans a card", I 166). The change, on top of Task 7's:

```tsx
  width?: number | 'fill' | undefined;

  // in the body, before the geometry
  const box = useRef<HTMLSpanElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (width !== 'fill') return undefined;
    const element = box.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    // As MetricStrip measures its panel: the canvas is drawn again at each new width
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setMeasured(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const boxWidth = width === 'fill' ? (measured ?? 0) : (width ?? SPARK_WIDTH);
```

`boxWidth` feeds `sparklineGeometry` and the canvas as in Task 7. With `'fill'` the component returns `<span ref={box} className="block w-full" style={{ height: boxHeight }}>{boxWidth > 0 ? canvas : null}</span>`, so the box has its height before the first measure and the canvas appears once the width is known (jsdom has no `ResizeObserver`: a test sees the empty box with its `role="img"` label on the span, which the component sets on the wrapper for `'fill'`). The sparkline test adds: `width="fill"` renders a `role="img"` element named by `label`. `useRef` and `useState` join the `react` import.

- [ ] **Step 3: Write the drawer parts**

`apps/web/src/features/citations/drawers/drawer-parts.tsx`:

```tsx
'use client';

import type { ReactElement, ReactNode } from 'react';

import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineCode } from '@/lib/api/types';
import { displayUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The small tables and lists of the two Citations drawers (I 47 to 64, 218 to 238): compact 32 px rows inside a flush
 * card, 16 px at the outer edges, 8 px between columns. Feature-local, as the earlier source inspector's engine table
 * was (`domain-inspector/engine-table.tsx`): they are not record lists users sort or act on.
 */

export interface DrawerColumn {
  id: string;
  label: ReactNode;
  /** Width and alignment classes: `w-20 text-right`. */
  className?: string | undefined;
}

export function DrawerTable({
  caption,
  columns,
  children,
  wide = false,
}: {
  caption: string;
  columns: readonly DrawerColumn[];
  children: ReactNode;
  /** The By platform grid: as wide as its columns, scrolling sideways in its card (I 325 to 329). */
  wide?: boolean;
}): ReactElement {
  const table = (
    <table className={cn('table-fixed type-table', wide ? 'min-w-full' : 'w-full')}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="h-row-compact border-t border-border-subtle bg-surface-subtle">
          {columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              className={cn('px-2 text-left font-normal whitespace-nowrap type-label first:pl-4 last:pr-4', column.className)}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
  return wide ? <div className="overflow-x-auto">{table}</div> : table;
}

export const DRAWER_ROW = 'h-row-compact border-t border-border-subtle';

export interface DrawerPage {
  urlId: number;
  url: string;
  citations: number;
  /** The mark's colour. */
  swatch: { own: boolean; colorIndex: number | null };
  /** A second line: the competitor's name, or why the page is listed. */
  note?: string | undefined;
  /** The engines that cite it, drawn as marks with a tooltip; left out for the closest page list (I 228). */
  engines?: readonly { code: EngineCode; label: string }[] | undefined;
  enginesTip?: string | undefined;
  countText: string;
}

/** A list of pages (I 219 to 238): dot, address, optional note, engine marks, "N×". */
export function PageList({ pages }: { pages: readonly DrawerPage[] }): ReactElement {
  return (
    <ul className="flex flex-col">
      {pages.map((page) => (
        <li key={page.urlId} className="flex min-h-9 items-center gap-2 border-t border-border-subtle px-4 py-1.5">
          <EntitySwatch shape="dot" own={page.swatch.own} colorIndex={page.swatch.colorIndex} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-body text-foreground">{displayUrl(page.url).display}</span>
            {page.note === undefined ? null : <span className="truncate type-meta">{page.note}</span>}
          </span>
          {page.engines === undefined ? null : (
            <Tooltip content={page.enginesTip ?? ''} purpose="label" disabled={page.enginesTip === undefined}>
              <span className="flex shrink-0 items-center gap-1">
                {page.engines.map((engine) => (
                  <EngineLogo key={engine.code} engine={engine.code} name={engine.label} nameDisplay="visually-hidden" />
                ))}
              </span>
            </Tooltip>
          )}
          <span className="w-10 shrink-0 text-right num type-meta">{page.countText}</span>
        </li>
      ))}
    </ul>
  );
}

/** The owner mark and name of a badge (I 81 to 82, 186 to 187). */
export function BrandLabel({ name, swatch }: { name: string; swatch: { own: boolean; colorIndex: number | null } }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <EntitySwatch shape="dot" own={swatch.own} colorIndex={swatch.colorIndex} />
      <span className="truncate">{name}</span>
    </span>
  );
}
```

- [ ] **Step 4: Write the page drawer**

`apps/web/src/features/citations/drawers/page-drawer.tsx`:

```tsx
'use client';

import { Copy, ExternalLink, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { BoardEngine } from '../board-reads';
import { useCitedPage } from '../board-reads';
import { slotDay } from '../board-text';
import { BrandLabel, DRAWER_ROW, DrawerTable } from './drawer-parts';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { DEFAULT_INSPECTOR_TAB } from '@/components/app/inspector/use-inspector';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import type { BoardScopeParams, CitedPageDetail, CitedPageRow } from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';
import { copyText } from '@/lib/dom/clipboard';
import { displayUrl, EMPTY_VALUE, formatInteger, formatPercent, formatSignedInteger, webHref } from '@/lib/format';
import { cn } from '@/lib/utils';

export type PageDrawerTab = 'prompts' | 'page-overview';

export interface PageDrawerProps {
  project: SourceScope;
  scope: BoardScopeParams;
  urlId: number;
  engines: readonly BoardEngine[];
  /** The scope's platform, group and runs label, the header's badges (I 36 to 39). */
  scopeParts: readonly string[];
  scopeText: string;
  /** `useInspectorStepping` over the table's order. */
  stepping: {
    positionText: string | null;
    navigation: InspectorNavigation | null;
    onStep: ((direction: 'next' | 'previous') => void) | undefined;
  };
  /** The address's `itab`; `overview` (no tab given) is Prompts. */
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  /** Opens the prompt inspector in place, with the drawer's prompts for J and K (I 66 to 69). */
  onOpenPrompt: (promptId: string, ids: readonly string[]) => void;
  timeZone: string;
}

const ownerTextOf = (page: CitedPageRow, t: ReturnType<typeof useTranslations<'citations'>>): string =>
  page.domain_role === 'own'
    ? t('pageDrawer.yourPage')
    : page.domain_role === 'competitor'
      ? (page.entity_name ?? page.host)
      : t('pageDrawer.thirdParty');

const swatchOf = (row: { domain_role: CitedPageRow['domain_role']; color_index: number | null }) => ({
  own: row.domain_role === 'own',
  colorIndex: row.domain_role === 'competitor' ? row.color_index : null,
});

/** The drawer of one cited page (I 71 to 207): which prompts cite it (Prompts), and its trend, platforms and the domains cited beside it (Overview). */
export function PageDrawer(props: PageDrawerProps): ReactElement {
  const t = useTranslations('citations');
  const read = useCitedPage(props.project, props.scope, props.urlId);
  const notCited = read.notFound;
  const detail = read.data;
  const page = detail?.page;
  const tab: PageDrawerTab = props.tab === 'page-overview' ? 'page-overview' : 'prompts';
  const title = page === undefined ? '' : (page.title ?? displayUrl(page.url).display);
  const badges =
    page === undefined ? null : (
      <>
        <span className={cn(badgeVariants({ variant: 'subtle', tone: 'neutral' }), 'gap-1.5')}>
          <EntitySwatch shape="dot" {...swatchOf(page)} />
          {ownerTextOf(page, t)}
        </span>
        {props.scopeParts.map((part) => (
          <Badge key={part}>{part}</Badge>
        ))}
      </>
    );
  return (
    <Inspector
      type="cited-page"
      header={{
        title,
        typeLabel: t('pageDrawer.type'),
        typeNoun: t('pageDrawer.noun'),
        positionText: props.stepping.positionText,
        navigation: props.stepping.navigation,
        badges,
        freshness: page === undefined ? null : <span>{t('pageDrawer.citations', { count: page.citations })}</span>,
      }}
      backLabel={t('pageDrawer.back')}
      onClose={props.onClose}
      onStep={props.stepping.onStep}
    >
      <InspectorTabs<PageDrawerTab>
        label={t('pageDrawer.tabsLabel')}
        value={tab}
        onValueChange={(next) => props.onTabChange(next === 'prompts' ? DEFAULT_INSPECTOR_TAB : next)}
        items={[
          { value: 'prompts', label: t('pageDrawer.promptsTab') },
          { value: 'page-overview', label: t('pageDrawer.overviewTab') },
        ]}
      >
        <InspectorPanel value="prompts">
          <PromptsCard {...props} read={read} notCited={notCited} />
        </InspectorPanel>
        <InspectorPanel value="page-overview">
          <OverviewCards {...props} detail={detail} status={read.status} notCited={notCited} />
        </InspectorPanel>
      </InspectorTabs>
    </Inspector>
  );
}
```

`read.notFound` is the `BoardRead` field of Task 3 (`ApiProblem.status === 404`, `lib/api/problem.ts` line 27).

The two card groups:

```tsx
function PromptsCard({
  read,
  notCited,
  engines,
  scopeText,
  onOpenPrompt,
}: PageDrawerProps & { read: ReturnType<typeof useCitedPage>; notCited: boolean }): ReactElement {
  const t = useTranslations('citations');
  const detail = read.data;
  const prompts = detail?.prompts ?? [];
  const ids = prompts.map((prompt) => prompt.prompt_id);
  const status = notCited ? 'empty' : read.status === 'loading' ? 'loading' : read.status === 'error' ? 'error' : prompts.length === 0 ? 'empty' : 'ready';
  return (
    <InspectorSection
      title={t('pageDrawer.promptsTitle')}
      meta={
        detail === undefined
          ? undefined
          : t('pageDrawer.promptsMeta', { prompts: prompts.length, answers: detail.page.citations })
      }
      status={status}
      flush
      error={
        <InlineError
          title={t('pageDrawer.loadFailed')}
          reason={t('board.loadFailedReason')}
          errorId={read.errorId}
          onRetry={read.retry}
          retrying={read.retrying}
          retryLabel={t('board.retry')}
        />
      }
      empty={
        notCited ? (
          <EmptyState variant="card" headingLevel={3} title={t('pageDrawer.notCitedTitle')} reason={t('pageDrawer.notCitedReason', { scope: scopeText })} />
        ) : (
          <EmptyState variant="card" headingLevel={3} title={t('pageDrawer.noPromptsTitle')} reason={t('pageDrawer.noPromptsReason')} />
        )
      }
    >
      <DrawerTable
        caption={t('pageDrawer.promptsTitle')}
        columns={[
          { id: 'prompt', label: t('pageDrawer.columnPrompt') },
          { id: 'platforms', label: t('pageDrawer.columnPlatforms'), className: engines.length > 1 ? 'w-24' : 'w-20' },
          { id: 'cited', label: t('pageDrawer.columnCited'), className: 'w-20 text-right' },
        ]}
      >
        {prompts.map((prompt) => (
          <tr key={prompt.prompt_id} className={cn(DRAWER_ROW, 'hover:bg-surface-hover')}>
            <td className="min-w-0 pr-2 pl-4">
              <Tooltip content={t('pageDrawer.promptTip', { text: prompt.text })}>
                <button
                  type="button"
                  className="w-full min-w-0 truncate rounded-sm text-left text-foreground outline-none hover:underline focus-visible:focus-ring"
                  onClick={() => onOpenPrompt(prompt.prompt_id, ids)}
                >
                  {prompt.text}
                </button>
              </Tooltip>
            </td>
            <td className="px-2">
              <Tooltip
                content={engines
                  .map((engine) => {
                    const cell = prompt.engines.find((entry) => entry.engine_code === engine.code);
                    return cell === undefined || cell.answers === 0
                      ? t('pageDrawer.engineNone', { engine: engine.label })
                      : t('pageDrawer.engineAnswers', { engine: engine.label, k: cell.cited, n: cell.answers });
                  })
                  .join('. ')}
                purpose="label"
              >
                <span className="flex items-center gap-1">
                  {engines.map((engine) => {
                    const cited = prompt.engines.find((entry) => entry.engine_code === engine.code)?.cited ?? 0;
                    return (
                      <span key={engine.code} className={cn('inline-flex', cited === 0 && 'opacity-25')}>
                        <EngineLogo engine={engine.code} name={engine.label} nameDisplay="visually-hidden" />
                      </span>
                    );
                  })}
                </span>
              </Tooltip>
            </td>
            <td className="px-2 pr-4 text-right whitespace-nowrap num">
              <Tooltip content={t('pageDrawer.citedTip', { k: prompt.cited, n: prompt.answers })} purpose="label">
                <span>
                  <span className="text-foreground">{formatInteger(prompt.cited)}</span>
                  <span className="text-foreground-tertiary">{`/${formatInteger(prompt.answers)}`}</span>
                </span>
              </Tooltip>
            </td>
          </tr>
        ))}
      </DrawerTable>
    </InspectorSection>
  );
}

function OverviewCards({
  detail,
  status,
  notCited,
  engines,
  scopeText,
  timeZone,
}: PageDrawerProps & { detail: CitedPageDetail | undefined; status: 'loading' | 'error' | 'ready'; notCited: boolean }): ReactElement {
  const t = useTranslations('citations');
  if (notCited) {
    return <EmptyState variant="card" headingLevel={3} title={t('pageDrawer.notCitedTitle')} reason={t('pageDrawer.notCitedReason', { scope: scopeText })} />;
  }
  const sectionStatus: InspectorSectionStatus = status;
  const page = detail?.page;
  const trend = detail?.window.trend ?? [];
  const firstSlot = trend[0];
  const lastSlot = trend[trend.length - 1];
  const latest = detail?.window.latest_answer_at ?? null;
  const copy = (): void => {
    if (page === undefined) return;
    void copyText(page.url).then((copied) =>
      toast(
        copied
          ? { type: 'success', title: t('pageDrawer.copied') }
          : { type: 'error', title: t('pageDrawer.copyFailed'), description: t('pageDrawer.copyFailedHint') },
      ),
    );
  };
  const open = (): void => {
    const href = page === undefined ? null : webHref(page.url);
    if (href !== null) window.open(href, '_blank', 'noopener');
  };
  return (
    <>
      <InspectorSection title={t('pageDrawer.summaryTitle')} meta={t('pageDrawer.summaryMeta')} status={sectionStatus}>
        {page === undefined ? null : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <div className="flex min-w-0 flex-col">
                <dt className="type-label text-foreground-tertiary">{t('pageDrawer.summaryCitations')}</dt>
                <dd className="flex items-baseline gap-1.5 num type-body-strong text-foreground">
                  {formatInteger(page.citations)}
                  <span className="type-meta">{formatSignedInteger(page.citations - page.previous_citations)}</span>
                </dd>
              </div>
              <div className="flex min-w-0 flex-col">
                <dt className="type-label text-foreground-tertiary">{t('pageDrawer.summaryPrompts')}</dt>
                <dd className="num type-body-strong text-foreground">{formatInteger(page.prompts)}</dd>
              </div>
              <div className="flex min-w-0 flex-col">
                <dt className="type-label text-foreground-tertiary">{t('pageDrawer.summaryLastCited')}</dt>
                <dd className="num type-body-strong text-foreground">{slotDay(page.last_cited_at, timeZone, latest)}</dd>
              </div>
            </dl>
            <div className="mt-3 flex h-control-sm min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-2">
              <Icon icon={Link2} size="sm" className="shrink-0 text-foreground-tertiary" />
              <span className="min-w-0 flex-1 truncate type-body text-foreground">{displayUrl(page.url).display}</span>
              <IconButton icon={Copy} variant="ghost" size="icon-xs" label={t('pageDrawer.copy')} onClick={copy} />
              <IconButton icon={ExternalLink} variant="ghost" size="icon-xs" label={t('pageDrawer.openLabel')} onClick={open} />
            </div>
          </>
        )}
      </InspectorSection>
      <InspectorSection
        title={t('pageDrawer.trendTitle')}
        meta={trend.length >= 8 ? t('pageDrawer.trendMeta') : t('pageDrawer.trendMetaShort', { count: trend.length })}
        status={sectionStatus}
      >
        {page === undefined ? null : (
          <div className="flex flex-col gap-1">
            <SparklineCell
              values={page.trend}
              label={t('pageDrawer.trendLabel', { values: page.trend.map((value) => formatInteger(value)).join(', ') })}
              width="fill"
              height={56}
              entity={swatchOf(page)}
              endDot={false}
            />
            <div className="flex justify-between num type-meta">
              <span>{firstSlot === undefined ? EMPTY_VALUE : slotDay(firstSlot.first_at, timeZone, latest)}</span>
              <span>{lastSlot === undefined ? EMPTY_VALUE : slotDay(lastSlot.last_at, timeZone, latest)}</span>
            </div>
          </div>
        )}
      </InspectorSection>
      <InspectorSection title={t('pageDrawer.platformsTitle')} meta={t('pageDrawer.platformsMeta')} status={sectionStatus} flush>
        {page === undefined ? null : (
          <DrawerTable
            caption={t('pageDrawer.platformsTitle')}
            columns={[
              { id: 'platform', label: t('pageDrawer.columnPlatform') },
              { id: 'citations', label: t('pageDrawer.columnCitations'), className: 'w-24 text-right' },
              { id: 'share', label: t('pageDrawer.columnShare'), className: 'w-20 text-right' },
            ]}
          >
            {engines.map((engine) => {
              const count = page.engines.find((cell) => cell.engine_code === engine.code)?.citation_units ?? 0;
              return (
                <tr key={engine.code} className={DRAWER_ROW}>
                  <td className="pr-2 pl-4">
                    <EngineLogo engine={engine.code} name={engine.label} truncate />
                  </td>
                  <td className="px-2 text-right num">{formatInteger(count)}</td>
                  <td className="px-2 pr-4 text-right num text-foreground-secondary">
                    {page.citations > 0 ? formatPercent(count / page.citations, { decimals: 0 }) : EMPTY_VALUE}
                  </td>
                </tr>
              );
            })}
          </DrawerTable>
        )}
      </InspectorSection>
      <InspectorSection
        title={t('pageDrawer.alongsideTitle')}
        meta={t('pageDrawer.alongsideMeta')}
        status={page === undefined ? sectionStatus : (detail?.alongside.length ?? 0) === 0 ? 'empty' : 'ready'}
        flush
        empty={<EmptyState variant="card" headingLevel={3} title={t('pageDrawer.aloneTitle')} reason={t('pageDrawer.aloneReason')} />}
      >
        {page === undefined ? null : (
          <DrawerTable
            caption={t('pageDrawer.alongsideTitle')}
            columns={[
              { id: 'domain', label: t('pageDrawer.columnDomain') },
              { id: 'answers', label: t('pageDrawer.columnAnswers'), className: 'w-24 text-right' },
            ]}
          >
            {(detail?.alongside ?? []).map((entry) => (
              <tr key={entry.registrable_domain} className={DRAWER_ROW}>
                <td className="min-w-0 pr-2 pl-4">
                  <span className="flex min-w-0 items-center gap-2">
                    <BrandLabel name={entry.registrable_domain} swatch={swatchOf(entry)} />
                    {entry.domain_role === 'third_party' ? null : (
                      <Badge className="shrink-0">
                        {entry.domain_role === 'own' ? t('pageDrawer.yourSite') : t('pageDrawer.competitor')}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="px-2 pr-4 text-right num text-foreground-secondary">
                  <Tooltip content={t('pageDrawer.alongsideTip', { k: entry.answers, n: page.citations })} purpose="label">
                    <span>{t('pageDrawer.alongsideCount', { k: formatInteger(entry.answers), n: formatInteger(page.citations) })}</span>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </DrawerTable>
        )}
      </InspectorSection>
    </>
  );
}
```

The "Open the page" tooltip of the preview is the button's name here ("Open the page in a new tab"): `IconButton` uses one text for both (Open point 14).

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && pnpm vitest run src/lib/inspector src/components/app/inspector src/components/app/status src/components/app/sparkline src/features/citations/drawers src/features/citations/board-reads.test.tsx`
Expected: PASS.

- [ ] **Step 6: Document, check and commit**

Inventory notes for InspectorSection (`meta`, `flush`, optional `icon`), EmptyState (`card`), SparklineCell (`width="fill"`); `16-drawers-dialogs-popovers.md` 2.7 lists `cited-page` and `gap-prompt`.

Run: `cd apps/web && pnpm prettier --write src/lib/inspector src/components/app/inspector src/components/app/status src/components/app/sparkline src/features/citations && pnpm lint && pnpm typecheck && pnpm vitest run src/components src/lib/inspector && pnpm format:check`

```bash
git add apps/web/src/lib/inspector/placement.ts apps/web/src/lib/inspector/placement.test.ts apps/web/src/components/app/inspector/inspector-section.tsx apps/web/src/components/app/inspector/inspector.test.tsx apps/web/src/components/app/status/empty-state.tsx apps/web/src/components/app/status/status.test.tsx apps/web/src/components/app/sparkline apps/web/src/features/citations/board-reads.ts apps/web/src/features/citations/drawers docs/design-system/16-drawers-dialogs-popovers.md docs/design-system/25-component-inventory.md
git commit -m "WP-77: Citations page drawer"
```

---

### Task 11: Gap drawer, prompt inspector in place, the screen and the route switch

Brief step 8 (second half). Parity rows: 3.1 "Layout", "Tabs in the route", "Inspector targets" (`gap-prompt`, `prompt` in place, C 730 to 733), 3.4 tabs and badge, 3.8 every row (I 209 to 331, 342 to 344, 366 to 373), 3.9 responsive and keyboard (the page as a whole).

**Files:**
- Create: `apps/web/src/features/citations/drawers/gap-drawer.tsx`, `gap-drawer.test.tsx`
- Create: `apps/web/src/lib/inspector/prompt-order.ts`
- Create: `apps/web/src/features/prompts/prompt-drawer-host.tsx`, `prompt-drawer-host.test.tsx`; Modify: `apps/web/src/features/prompts/index.ts` (export it) [lease needed, Open point 6]
- Create: `apps/web/src/features/citations/board-screen.tsx`, `board-screen.test.tsx`
- Modify: `apps/web/src/features/citations/index.ts` (export the new screen)
- Create: `apps/web/src/app/[workspace]/[project]/ai/citations/citations-route.tsx` (the shared server part of both pages)
- Modify: `apps/web/src/app/[workspace]/[project]/ai/citations/page.tsx`, `page.test.tsx`
- Create: `apps/web/src/app/[workspace]/[project]/ai/citations/gaps/page.tsx`, `page.test.tsx`

After this task the route renders the new screen; the old screen's files are unimported and still compile and test green until Task 12 deletes them.

- [ ] **Step 1: Write the failing gap drawer test**

`apps/web/src/features/citations/drawers/gap-drawer.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { z } from 'zod';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GapDrawer, type GapDrawerProps } from './gap-drawer';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { mockBrowser } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const FIRST = CITATIONS_FIXTURE.expected.chatgpt.gaps.first;
const PROMPT_ID = CITATIONS_FIXTURE.prompts.find((prompt) => prompt.text === FIRST)?.id ?? '';
let tracked: { id: string; name: string; colorIndex: number | null; domain: string | null }[] = [];

beforeAll(async () => {
  const answer = await mockBrowser('viewer').call('GET', `${P}/entities?filter[role]=competitor`);
  tracked = z
    .array(z.object({ entity: z.object({ entity_id: z.string(), canonical_name: z.string() }), color_index: z.number().nullable() }))
    .parse(answer.body.data)
    .map((row) => ({ id: row.entity.entity_id, name: row.entity.canonical_name, colorIndex: row.color_index, domain: null }));
});

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

function setup(overrides: Partial<GapDrawerProps> = {}) {
  const competitors = tracked.slice(0, 3);
  const props: GapDrawerProps = {
    project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
    scope: { runs: 4, engines: ['chatgpt_web'], term: null },
    competitors,
    ownName: 'Fynix',
    promptId: PROMPT_ID,
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    scopeParts: ['ChatGPT', 'All groups', 'Last 4 runs'],
    scopeText: 'ChatGPT, All groups, Last 4 runs',
    stepping: { positionText: '1 of 61', navigation: null, onStep: undefined },
    tab: 'overview',
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    onOpenAnswers: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<InspectorLayout inspector={<GapDrawer {...props} />}><main /></InspectorLayout>) };
}

describe('the gap drawer (I 209 to 331)', () => {
  it('heads the prompt with its group and where it is lost, on the Gap tab', async () => {
    const { container } = setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('lost on ChatGPT')).toBeVisible();
    expect(within(drawer).getByRole('tab', { name: 'Gap' })).toHaveAttribute('aria-selected', 'true');
    expect(within(drawer).getByText('Who is cited')).toBeVisible();
    expect(within(drawer).getByText('Pages competitors win with')).toBeVisible();
    expect(within(drawer).getByText('Your closest page')).toBeVisible();
    expect(within(drawer).getByText('Third-party pages in these answers')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens the answers in the prompt inspector', async () => {
    const { user, props } = setup();
    const drawer = await screen.findByRole('complementary');
    await user.click(await within(drawer).findByRole('button', { name: 'Open answers' }));
    expect(props.onOpenAnswers).toHaveBeenCalledWith(PROMPT_ID);
  });

  it('shows one row per platform on By platform', async () => {
    setup({ tab: 'platforms' });
    const drawer = await screen.findByRole('complementary');
    const table = await within(drawer).findByRole('table', { name: 'By platform' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });
});
```

Run: `cd apps/web && pnpm vitest run src/features/citations/drawers/gap-drawer.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Write the gap drawer**

`apps/web/src/features/citations/drawers/gap-drawer.tsx`:

```tsx
'use client';

import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { BoardEngine, TrackedCompetitor } from '../board-reads';
import { useGap } from '../board-reads';
import { GapMark } from '../gaps/gap-mark';
import { markLines } from '../gaps/gap-model';
import { BrandLabel, DRAWER_ROW, DrawerTable, PageList, type DrawerPage } from './drawer-parts';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { DEFAULT_INSPECTOR_TAB } from '@/components/app/inspector/use-inspector';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineCode } from '@/lib/api/types';
import type { BoardScopeParams, CitationGapDetail, CitationGapRow } from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';

export type GapDrawerTab = 'gap' | 'platforms';

export interface GapDrawerProps {
  project: SourceScope;
  scope: BoardScopeParams;
  /** The selected competitors, in the tracked order. */
  competitors: readonly TrackedCompetitor[];
  ownName: string;
  promptId: string;
  engines: readonly BoardEngine[];
  scopeParts: readonly string[];
  scopeText: string;
  stepping: {
    positionText: string | null;
    navigation: InspectorNavigation | null;
    onStep: ((direction: 'next' | 'previous') => void) | undefined;
  };
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  /** Opens the prompt inspector with the gap table's order for J and K (I 269). */
  onOpenAnswers: (promptId: string) => void;
}

/** The drawer of one gap prompt (I 209 to 331): who is cited, the pages that win, your closest page, the third parties; then the same per platform. */
export function GapDrawer(props: GapDrawerProps): ReactElement {
  const t = useTranslations('citations');
  const ids = useMemo(() => props.competitors.map((competitor) => competitor.id), [props.competitors]);
  const read = useGap(props.project, props.scope, ids, props.promptId);
  const detail = read.data;
  const row = detail?.row;
  const labelOf = (code: string): string => props.engines.find((engine) => engine.code === code)?.label ?? code;
  const tab: GapDrawerTab = props.tab === 'platforms' ? 'platforms' : 'gap';
  const lost =
    row === undefined
      ? null
      : row.gap > 0
        ? t('gapDrawer.lostOn', { engines: row.lost_on.map(labelOf).join(', ') })
        : t('gapDrawer.notLost');
  return (
    <Inspector
      type="gap-prompt"
      header={{
        title: row?.text ?? '',
        typeLabel: t('gapDrawer.type'),
        typeNoun: t('gapDrawer.noun'),
        positionText: props.stepping.positionText,
        navigation: props.stepping.navigation,
        badges:
          row === undefined ? null : (
            <>
              {row.topic === null ? null : <Badge>{row.topic.name}</Badge>}
              {props.scopeParts.map((part) => (
                <Badge key={part}>{part}</Badge>
              ))}
            </>
          ),
        freshness: lost === null ? null : <span>{lost}</span>,
      }}
      backLabel={t('gapDrawer.back')}
      onClose={props.onClose}
      onStep={props.stepping.onStep}
    >
      <InspectorTabs<GapDrawerTab>
        label={t('gapDrawer.tabsLabel')}
        value={tab}
        onValueChange={(next) => props.onTabChange(next === 'gap' ? DEFAULT_INSPECTOR_TAB : next)}
        items={[
          { value: 'gap', label: t('gapDrawer.gapTab') },
          { value: 'platforms', label: t('gapDrawer.platformsTab') },
        ]}
      >
        <InspectorPanel value="gap">
          {read.notFound ? (
            <EmptyState
              variant="card"
              headingLevel={3}
              title={t('gapDrawer.notFoundTitle')}
              reason={t('gapDrawer.notFoundReason', { scope: props.scopeText })}
            />
          ) : read.status === 'error' ? (
            <InlineError
              title={t('gapDrawer.loadFailed')}
              reason={t('board.loadFailedReason')}
              errorId={read.errorId}
              onRetry={read.retry}
              retrying={read.retrying}
              retryLabel={t('board.retry')}
            />
          ) : (
            <GapCards {...props} detail={detail} status={read.status === 'loading' ? 'loading' : 'ready'} labelOf={labelOf} />
          )}
        </InspectorPanel>
        <InspectorPanel value="platforms">
          <InspectorSection
            title={t('gapDrawer.platformsTitle')}
            meta={t('gapDrawer.platformsMeta')}
            status={read.status === 'loading' ? 'loading' : read.notFound || row === undefined ? 'empty' : 'ready'}
            flush
            empty={
              <EmptyState
                variant="card"
                headingLevel={3}
                title={t('gapDrawer.notFoundTitle')}
                reason={t('gapDrawer.notFoundReason', { scope: props.scopeText })}
              />
            }
          >
            {row === undefined ? null : <PlatformGrid row={row} {...props} labelOf={labelOf} />}
          </InspectorSection>
        </InspectorPanel>
      </InspectorTabs>
    </Inspector>
  );
}

function GapCards({
  detail,
  status,
  competitors,
  ownName,
  promptId,
  onOpenAnswers,
  labelOf,
}: GapDrawerProps & {
  detail: CitationGapDetail | undefined;
  status: InspectorSectionStatus;
  labelOf: (code: string) => string;
}): ReactElement {
  const t = useTranslations('citations');
  const row = detail?.row;
  const colorOf = (id: string | null): number | null =>
    competitors.find((competitor) => competitor.id === id)?.colorIndex ?? null;
  const nameOf = (id: string | null): string => competitors.find((competitor) => competitor.id === id)?.name ?? '';
  const engineList = (codes: readonly EngineCode[]): { code: EngineCode; label: string }[] =>
    codes.map((code) => ({ code, label: labelOf(code) }));
  const pagesOf = (
    pages: CitationGapDetail['competitor_pages'],
    swatch: (page: CitationGapDetail['competitor_pages'][number]) => DrawerPage['swatch'],
    note: ((page: CitationGapDetail['competitor_pages'][number]) => string) | null,
    withEngines: boolean,
  ): DrawerPage[] =>
    pages.map((page) => ({
      urlId: page.url_id,
      url: page.url,
      citations: page.citations,
      swatch: swatch(page),
      ...(note === null ? {} : { note: note(page) }),
      ...(withEngines
        ? {
            engines: engineList(page.engines),
            enginesTip: t('gapDrawer.citedOn', { engines: page.engines.map(labelOf).join(', ') }),
          }
        : {}),
      countText: t('gapDrawer.times', { count: page.citations }),
    }));
  const group = row?.topic?.name ?? null;
  const ownHere = (detail?.own_pages.length ?? 0) > 0;
  const closest = ownHere ? (detail?.own_pages ?? []) : (detail?.closest_pages ?? []);
  interface WhoRow {
    id: string;
    name: string;
    own: boolean;
    colorIndex: number | null;
    cell: CitationGapRow['you'];
  }
  const you: WhoRow[] = row === undefined ? [] : [{ id: 'you', name: ownName, own: true, colorIndex: null, cell: row.you }];
  const rivals: WhoRow[] =
    row === undefined
      ? []
      : competitors.flatMap((competitor) => {
          const cell = row.competitors.find((candidate) => candidate.entity_id === competitor.id);
          return cell === undefined
            ? []
            : [{ id: competitor.id, name: competitor.name, own: false, colorIndex: competitor.colorIndex, cell }];
        });
  const who = [...you, ...rivals];
  return (
    <>
      <InspectorSection
        title={t('gapDrawer.whoTitle')}
        meta={detail === undefined ? undefined : t('gapDrawer.whoMeta', { count: detail.answers })}
        action={
          <Button variant="secondary" size="sm" icon={MessageSquare} onClick={() => onOpenAnswers(promptId)}>
            {t('gapDrawer.openAnswers')}
          </Button>
        }
        status={status}
        flush
      >
        <DrawerTable
          caption={t('gapDrawer.whoTitle')}
          columns={[
            { id: 'brand', label: t('gapDrawer.columnBrand') },
            { id: 'state', label: t('gapDrawer.columnState'), className: 'w-36' },
            { id: 'answers', label: t('gapDrawer.columnAnswers'), className: 'w-20 text-right' },
          ]}
        >
          {who.map((entry) => (
            <tr key={entry.id} className={DRAWER_ROW}>
              <td className="min-w-0 pr-2 pl-4">
                <BrandLabel name={entry.name} swatch={{ own: entry.own, colorIndex: entry.colorIndex }} />
              </td>
              <td className="px-2">
                <GapMark
                  state={entry.cell.total.state}
                  own={entry.own}
                  lost={entry.own && (row?.gap ?? 0) > 0}
                  tip={markLines(entry.cell, labelOf, t)}
                />
              </td>
              <td className="px-2 pr-4 text-right num text-foreground-secondary">
                <Tooltip content={t('gapDrawer.answersTip', { k: entry.cell.total.cited, n: entry.cell.total.answers })} purpose="label">
                  <span>{t('gapDrawer.answersCount', { k: entry.cell.total.cited, n: entry.cell.total.answers })}</span>
                </Tooltip>
              </td>
            </tr>
          ))}
        </DrawerTable>
      </InspectorSection>
      <InspectorSection
        title={t('gapDrawer.rivalsTitle')}
        meta={t('gapDrawer.rivalsMeta')}
        status={status === 'loading' ? 'loading' : (detail?.competitor_pages.length ?? 0) === 0 ? 'empty' : 'ready'}
        flush
        empty={<EmptyState variant="card" headingLevel={3} title={t('gapDrawer.noRivalsTitle')} reason={t('gapDrawer.noRivalsReason')} />}
      >
        <PageList
          pages={pagesOf(
            detail?.competitor_pages ?? [],
            (page) => ({ own: false, colorIndex: colorOf(page.entity_id) }),
            (page) => nameOf(page.entity_id),
            true,
          )}
        />
      </InspectorSection>
      <InspectorSection
        title={t('gapDrawer.closestTitle')}
        meta={t('gapDrawer.closestMeta')}
        status={status === 'loading' ? 'loading' : closest.length === 0 ? 'empty' : 'ready'}
        flush
        empty={
          <EmptyState
            variant="card"
            headingLevel={3}
            title={group === null ? t('gapDrawer.noClosestNoGroup') : t('gapDrawer.noClosestTitle', { group })}
            reason={t('gapDrawer.noClosestReason')}
          />
        }
      >
        <PageList
          pages={pagesOf(
            closest,
            () => ({ own: true, colorIndex: null }),
            () => (ownHere ? t('gapDrawer.ownHere') : t('gapDrawer.closestNote', { group: group ?? '' })),
            false,
          )}
        />
      </InspectorSection>
      <InspectorSection
        title={t('gapDrawer.thirdTitle')}
        meta={t('gapDrawer.thirdMeta')}
        status={status === 'loading' ? 'loading' : (detail?.third_party_pages.length ?? 0) === 0 ? 'empty' : 'ready'}
        flush
        empty={<EmptyState variant="card" headingLevel={3} title={t('gapDrawer.noThirdTitle')} reason={t('gapDrawer.noThirdReason')} />}
      >
        <PageList
          pages={pagesOf(detail?.third_party_pages ?? [], () => ({ own: false, colorIndex: null }), null, true)}
        />
      </InspectorSection>
    </>
  );
}

function PlatformGrid({
  row,
  competitors,
  ownName,
  labelOf,
}: GapDrawerProps & { row: CitationGapRow; labelOf: (code: string) => string }): ReactElement {
  const t = useTranslations('citations');
  return (
    <DrawerTable
      caption={t('gapDrawer.platformsTitle')}
      wide
      columns={[
        { id: 'platform', label: t('gapDrawer.columnPlatform'), className: 'w-32' },
        { id: 'you', label: ownName, className: 'w-28' },
        ...competitors.map((competitor) => ({ id: competitor.id, label: competitor.name, className: 'w-28' })),
      ]}
    >
      {row.you.engines.map((cell) => (
        <tr key={cell.engine_code} className={DRAWER_ROW}>
          <td className="pr-2 pl-4">
            <EngineLogo engine={cell.engine_code} name={labelOf(cell.engine_code)} truncate />
          </td>
          <td className="px-2">
            <GapMark
              state={cell.state}
              own
              lost={row.lost_on.includes(cell.engine_code)}
              tip={markLines({ engines: [cell] }, labelOf, t)}
            />
          </td>
          {competitors.map((competitor) => {
            const theirs = row.competitors
              .find((candidate) => candidate.entity_id === competitor.id)
              ?.engines.find((candidate) => candidate.engine_code === cell.engine_code);
            return (
              <td key={competitor.id} className="px-2">
                {theirs === undefined ? null : (
                  <GapMark state={theirs.state} own={false} lost={false} tip={markLines({ engines: [theirs] }, labelOf, t)} />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </DrawerTable>
  );
}
```

`CompetitorOnPrompt` has `BrandOnPrompt`'s members plus `entity_id`, so a competitor's cell fits `WhoRow['cell']`.

- [ ] **Step 3: The prompt inspector in place**

`apps/web/src/lib/inspector/prompt-order.ts`:

```ts
'use client';

import { createContext } from 'react';

/**
 * The prompt ids a page opens the prompt inspector from, in that page's order, for J and K and "3 of 12" (WP-77: the
 * Citations drawers open a prompt in place, I 66 to 69). A page provides it; `PromptDrawerHost` of the prompts feature
 * reads it. Empty: the inspector has no position.
 */
export const PromptOrderContext = createContext<readonly string[]>([]);
```

`apps/web/src/features/prompts/prompt-drawer-host.tsx`:

```tsx
'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useContext, useMemo, type ReactElement } from 'react';

import { PromptInspector, type PromptCounts } from './prompt-inspector';
import { enginesQuery, summaryQuery, type PromptScope } from './prompt-queries';
import { useDateRangeParams } from '@/components/app/date-range/use-date-range-params';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';
import type { ProjectEngine } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { formatInteger } from '@/lib/format';
import { PromptOrderContext } from '@/lib/inspector/prompt-order';

const NO_ENGINES: readonly ProjectEngine[] = [];
const NO_ENTITIES: PromptCounts['entities'] = [];

export interface PromptDrawerHostProps {
  workspaceId: string;
  projectId: string;
  timeZone: string;
}

/**
 * The prompt inspector on a page other than Topics & Prompts (WP-77, the Citations drawers' "Open its answers"): it
 * reads what `PromptInspector` needs itself (the engines and the prompt's summary row over the default 28 day window,
 * non-branded) and shows when the address names a prompt (`inspect=prompt:<id>`). The page passes it as an element
 * and provides the order for J and K (`PromptOrderContext`).
 */
export function PromptDrawerHost({ workspaceId, projectId, timeZone }: PromptDrawerHostProps): ReactElement | null {
  const t = useTranslations('prompts');
  const inspector = useInspector();
  const order = useContext(PromptOrderContext);
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId }), [workspaceId, projectId]);
  const today = useZoneDay(timeZone);
  const picked = useDateRangeParams({ today });
  const range = useMemo(() => ({ from: picked.range.from, to: picked.range.to }), [picked.range]);
  const engines = useQuery(enginesQuery(scope));
  const all = engines.data?.data ?? NO_ENGINES;
  const enabled = useMemo(() => all.filter((engine) => engine.is_enabled), [all]);
  const summary = useQuery({
    ...summaryQuery(scope, range, false),
    enabled: enabled.length > 0,
    placeholderData: keepPreviousData,
  });
  const errorId = useErrorId(summary.error);
  const target = inspector.target;
  if (target === null || target.type !== 'prompt') return null;
  const at = inspector.position(order);
  const counts: PromptCounts = {
    status:
      summary.isError && summary.data === undefined
        ? 'failed'
        : engines.isPending || (enabled.length > 0 && (summary.isPending || summary.isPlaceholderData))
          ? 'loading'
          : 'ready',
    brandedIncluded: false,
    entities: summary.data?.data.entities ?? NO_ENTITIES,
    row: summary.data?.data.prompts.find((row) => row.prompt_id === target.id),
    errorId,
    retry: () => void summary.refetch(),
    retrying: summary.isFetching,
  };
  const step = (direction: 'next' | 'previous'): void => inspector.step(direction, order);
  return (
    <PromptInspector
      key={projectId}
      scope={scope}
      promptId={target.id}
      timeZone={timeZone}
      range={range}
      engines={enabled}
      allEngines={all}
      counts={counts}
      positionText={
        at === null ? null : t('inspector.position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) })
      }
      navigation={
        at === null
          ? null
          : {
              onPrevious: () => step('previous'),
              onNext: () => step('next'),
              atFirst: at.index === 0,
              atLast: at.index === at.count - 1,
            }
      }
      onStep={at === null ? undefined : step}
      tab={inspector.tab}
      onTabChange={(next) => inspector.setTab(next === 'latest' ? DEFAULT_INSPECTOR_TAB : next)}
      onClose={() => inspector.close()}
    />
  );
}
```

`apps/web/src/features/prompts/index.ts` adds `export { PromptDrawerHost, type PromptDrawerHostProps } from './prompt-drawer-host';`. The answer viewer (`onOpenAnswer`) is not wired in place: the dates of the answers are plain text there (Open point 6). `prompt-drawer-host.test.tsx` renders the host with `searchParams: 'inspect=prompt:<a Fynix fixture prompt id>'` (from `src/mocks/prompt-fixtures.ts`), wrapped in `InspectorLayout` and `PromptOrderContext.Provider value={[id]}`, and expects the prompt inspector (`complementary` named by the prompt's text) with "1 of 1"; and nothing for `inspect=cited-page:1`.

- [ ] **Step 4: Write the failing screen test**

`apps/web/src/features/citations/board-screen.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import type { OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CitationsScreen, type CitationsScreenProps } from './board-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(),
}));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const PROPS: CitationsScreenProps = {
  workspaceId: MOCK_WORKSPACE.workspace_id,
  workspaceSlug: 'digibranders',
  project: { id: fynix.project_id, slug: 'fynix', name: 'Fynix', timeZone: fynix.timezone, ownDomain: fynix.host },
  tab: 'pages',
  promptDrawer: null,
};

function render(role: Role = 'editor', options: ProvidedRenderOptions = {}, props: Partial<CitationsScreenProps> = {}) {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <CitationsScreen {...PROPS} {...props} />
    </PermissionProvider>,
    options,
  );
}

beforeEach(() => {
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => restoreWideScreen());

describe('the Citations screen', () => {
  it('shows the strip of the enabled engines, the Cited pages tab and the gap count badge', async () => {
    const { container } = render();
    const expected = CITATIONS_FIXTURE.expected.enabled;
    expect(await screen.findByLabelText(new RegExp(`^Total citations: ${String(expected.strip.citations)}\\. `))).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Citations views' });
    expect(within(tabs).getByRole('link', { name: 'Cited pages' })).toHaveAttribute('aria-current', 'page');
    expect(await within(tabs).findByText(String(expected.gaps.gaps))).toBeVisible();
    expect(await screen.findByRole('table', { name: 'Cited pages' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reads ChatGPT from the address', async () => {
    render('editor', { searchParams: 'platform=chatgpt_web' });
    const strip = CITATIONS_FIXTURE.expected.chatgpt.strip;
    expect(await screen.findByLabelText(new RegExp(`^Total citations: ${String(strip.citations)}\\. `))).toBeVisible();
  });

  it('moves an old link onto the new keys', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render('editor', { searchParams: 'tab=domains&role=third_party&win=7d', onUrlUpdate });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].queryString).toBe('?owner=third');
  });

  it('opens a cited page in the drawer', async () => {
    const { user } = render();
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    const first = within(table).getAllByRole('button', { name: /^Open / })[0];
    if (first === undefined) throw new Error('No row');
    await user.click(first);
    expect(await screen.findByRole('complementary')).toHaveTextContent('Cited page');
  });

  it('draws the gap analysis on its route', async () => {
    render('editor', {}, { tab: 'gaps' });
    expect(await screen.findByRole('table', { name: 'Gap analysis' })).toBeVisible();
  });

  it('says a role without data:read cannot open it (the old screen test uses billing)', () => {
    render('billing');
    expect(screen.getByRole('heading', { name: 'You cannot open citations' })).toBeVisible();
  });
});
```

`OnUrlUpdateFunction` is what `src/test/render.tsx` takes; its event has `queryString` (nuqs testing adapter). The migration writes once, with history replace.

Run: `cd apps/web && pnpm vitest run src/features/citations/board-screen.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Write the screen**

`apps/web/src/features/citations/board-screen.tsx`:

```tsx
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { gapsCsv, pagesCsv } from './board-export';
import { useBoardEngines, useGaps, useOverview, useTopicTerms, useTracked } from './board-reads';
import { useBoardState } from './board-state';
import { previousText, runsLabel, scopeText } from './board-text';
import { ownerRole } from './cited-pages/page-rows';
import { PagesTab } from './cited-pages/pages-tab';
import { GapDrawer } from './drawers/gap-drawer';
import { PageDrawer } from './drawers/page-drawer';
import { GAP_SORT_DEFAULT, sortGapRows, visibleGapRows } from './gaps/gap-model';
import { GapsTab } from './gaps/gaps-tab';
import { MeasuresStrip } from './measures-strip';
import { ScopeToolbar } from './scope-toolbar';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { TabNav } from '@/components/app/shell/tab-nav';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { toast } from '@/components/ui/toast';
import { allCitedPagesQuery, type BoardScopeParams } from '@/lib/citations/board-queries';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { formatInteger } from '@/lib/format';
import { PromptOrderContext } from '@/lib/inspector/prompt-order';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import { useCan } from '@/lib/permissions';
import { projectPath, withQuery } from '@/lib/routes/paths';

export interface CitationsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: run days and times are its. */
  timeZone: string;
  /** `Project.primary_domain.registrable_domain`: three strip texts name it (C 214, 250, 253). */
  ownDomain: string | null;
}

export interface CitationsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: CitationsProject;
  /** The route segment: `/ai/citations` or `/ai/citations/gaps` (brief 3.1). */
  tab: 'pages' | 'gaps';
  /** The prompt inspector the route composes (`PromptDrawerHost` of the prompts feature), shown for `inspect=prompt:<id>`. */
  promptDrawer: ReactNode;
}

/** AI > Citations (WP-77, the design preview's #/citations): toolbar, measures, and the Cited pages or Gap analysis table. */
export function CitationsScreen(props: CitationsScreenProps): ReactNode {
  const t = useTranslations('citations');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className="flex flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <h1 className="sr-only">{t('title')}</h1>
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <BoardContent {...props} />;
}

function BoardContent({ workspaceId, workspaceSlug, project, tab, promptDrawer }: CitationsScreenProps): ReactElement {
  const t = useTranslations('citations');
  const source = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const { engines } = useBoardEngines(source);
  const { tracked, ownName } = useTracked(source);
  const { terms, ids: termIds } = useTopicTerms(source);
  const options = useMemo(
    () => ({
      engines: engines === null ? null : engines.map((engine) => engine.code),
      terms: termIds,
      tracked: tracked === null ? null : tracked.map((competitor) => competitor.id),
    }),
    [engines, termIds, tracked],
  );
  const { state, set, resetScope, isDefaultScope } = useBoardState(options);

  const scopeEngines = useMemo(
    () =>
      engines === null ? [] : state.platform === 'all' ? engines : engines.filter((engine) => engine.code === state.platform),
    [engines, state.platform],
  );
  const scope = useMemo(
    (): BoardScopeParams => ({
      runs: state.runs,
      engines: scopeEngines.map((engine) => engine.code),
      term: state.group === 'all' ? null : state.group,
    }),
    [state.runs, scopeEngines, state.group],
  );
  // Nothing is asked before the engines are known: an empty list would mean every engine (D-4)
  const ready = scopeEngines.length > 0;
  const overview = useOverview(source, scope, ready);
  const gaps = useGaps(source, scope, state.competitors, ready);
  const window = overview.data?.window;
  const latest = window?.latest_answer_at ?? null;
  const previous = useMemo(
    () => previousText(state.runs, window?.previous ?? [], project.timeZone, latest, t),
    [state.runs, window?.previous, project.timeZone, latest, t],
  );
  const platformName = state.platform === 'all' ? t('toolbar.allPlatforms') : (scopeEngines[0]?.label ?? '');
  const groupName =
    state.group === 'all' ? t('toolbar.allGroups') : (terms?.find((term) => term.id === state.group)?.name ?? '');
  const scopeParts = [platformName, groupName, runsLabel(state.runs, t)];
  const scopeLine = scopeText({ platform: platformName, group: groupName, runs: state.runs }, t);
  const selected = useMemo(
    () => state.competitors.flatMap((id) => tracked?.find((competitor) => competitor.id === id) ?? []),
    [state.competitors, tracked],
  );

  // The drawers: `inspect=cited-page:<url_id>`, `inspect=gap-prompt:<prompt_id>`, `inspect=prompt:<id>` in place
  const inspector = useInspector();
  const [pageOrder, setPageOrder] = useState<readonly string[]>([]);
  const [gapOrder, setGapOrder] = useState<readonly string[]>([]);
  const [promptOrder, setPromptOrder] = useState<readonly string[]>([]);
  const pageStepping = useInspectorStepping({
    inspector,
    type: 'cited-page',
    order: pageOrder,
    typeLabel: t('pageDrawer.type'),
    typeNoun: t('pageDrawer.noun'),
  });
  const gapStepping = useInspectorStepping({
    inspector,
    type: 'gap-prompt',
    order: gapOrder,
    typeLabel: t('gapDrawer.type'),
    typeNoun: t('gapDrawer.noun'),
  });
  const { open } = inspector;
  const openPage = useCallback((row: { url_id: number }) => open({ type: 'cited-page', id: String(row.url_id) }), [open]);
  const openGap = useCallback((row: { prompt_id: string }) => open({ type: 'gap-prompt', id: row.prompt_id }), [open]);
  const openPrompt = (promptId: string, ids: readonly string[]): void => {
    setPromptOrder(ids);
    open({ type: 'prompt', id: promptId });
  };

  const target = inspector.target;
  let drawer: ReactNode = null;
  if (target?.type === 'cited-page' && ready && /^\d+$/.test(target.id)) {
    drawer = (
      <PageDrawer
        key={project.id}
        project={source}
        scope={scope}
        urlId={Number(target.id)}
        engines={scopeEngines}
        scopeParts={scopeParts}
        scopeText={scopeLine}
        stepping={pageStepping}
        tab={inspector.tab}
        onTabChange={inspector.setTab}
        onClose={inspector.close}
        onOpenPrompt={openPrompt}
        timeZone={project.timeZone}
      />
    );
  } else if (target?.type === 'gap-prompt' && ready) {
    drawer = (
      <GapDrawer
        key={project.id}
        project={source}
        scope={scope}
        competitors={selected}
        ownName={ownName ?? project.name}
        promptId={target.id}
        engines={scopeEngines}
        scopeParts={scopeParts}
        scopeText={scopeLine}
        stepping={gapStepping}
        tab={inspector.tab}
        onTabChange={inspector.setTab}
        onClose={inspector.close}
        onOpenAnswers={(promptId) => openPrompt(promptId, gapOrder)}
      />
    );
  } else if (target?.type === 'prompt') {
    drawer = promptDrawer;
  }

  // The tabs are routes; the scope and the search go with them, the drawer does not (C 266 to 269)
  const address = useSearchParams().toString();
  const hrefOf = (path: '/ai/citations' | '/ai/citations/gaps') => {
    const query = new URLSearchParams(address);
    query.delete('inspect');
    query.delete('itab');
    return withQuery(projectPath(workspaceSlug, project.slug, path), query.toString());
  };
  const gapCount = state.competitors.length > 0 ? gaps.data?.meta.gaps : undefined;
  const tabs = (
    <TabNav
      variant="segmented"
      label={t('board.tabsLabel')}
      items={[
        { href: hrefOf('/ai/citations'), label: t('board.pagesTab'), current: tab === 'pages' },
        {
          href: hrefOf('/ai/citations/gaps'),
          label: t('board.gapsTab'),
          current: tab === 'gaps',
          badge:
            gapCount === undefined
              ? undefined
              : { text: formatInteger(gapCount), spoken: t('board.gapsCount', { count: gapCount }) },
        },
      ]}
    />
  );

  // Export: the tab on screen, every row the API has for Cited pages (D-6), the rows shown for Gap analysis
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const exportTab = async (): Promise<void> => {
    setExporting(true);
    try {
      if (tab === 'pages') {
        const all = await queryClient.fetchQuery(
          allCitedPagesQuery(source, scope, { role: ownerRole(state.owner), q: state.search, sort: '-citations' }),
        );
        downloadBlob(csvBlob(pagesCsv(all.data, scopeEngines, project.timeZone, t)), `${t('download.pagesFile')}.csv`);
        toast({ type: 'success', title: t('download.done', { count: all.data.length }) });
      } else {
        const rows = sortGapRows(
          visibleGapRows(gaps.data?.data ?? [], { gapsOnly: state.gapsOnly, search: state.search }),
          GAP_SORT_DEFAULT,
        );
        downloadBlob(
          csvBlob(gapsCsv(rows, selected, ownName ?? project.name, scopeEngines, t)),
          `${t('download.gapsFile')}.csv`,
        );
        toast({ type: 'success', title: t('download.done', { count: rows.length }) });
      }
    } catch {
      toast({ type: 'error', title: t('download.failed'), description: t('download.failedReason') });
    } finally {
      setExporting(false);
    }
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  const setSearch = useCallback((search: string) => set({ search: search.trim() }), [set]);

  let main: ReactNode;
  if (engines !== null && engines.length === 0) {
    main = <EmptyState variant="table" headingLevel={2} title={t('board.noEngineTitle')} reason={t('board.noEngineReason')} />;
  } else if (tab === 'pages') {
    main = (
      <PagesTab
        project={source}
        scope={scope}
        ready={ready}
        engines={scopeEngines}
        owner={state.owner}
        search={state.search}
        onOwnerChange={(owner) => set({ owner })}
        onSearchChange={setSearch}
        onResetScope={resetScope}
        tabs={tabs}
        previous={previous}
        scopeText={scopeLine}
        timeZone={project.timeZone}
        activeId={target?.type === 'cited-page' ? target.id : null}
        onOpen={openPage}
        onOrderChange={setPageOrder}
      />
    );
  } else {
    main = (
      <GapsTab
        read={gaps}
        competitors={selected}
        ownName={ownName ?? project.name}
        engines={scopeEngines}
        gapsOnly={state.gapsOnly}
        search={state.search}
        onGapsOnlyChange={(gapsOnly) => set({ gapsOnly })}
        onSearchChange={setSearch}
        onResetScope={resetScope}
        onChooseCompetitors={() => setPickerOpen(true)}
        tabs={tabs}
        scopeText={scopeLine}
        timeZone={project.timeZone}
        activeId={target?.type === 'gap-prompt' ? target.id : null}
        onOpen={openGap}
        onOrderChange={setGapOrder}
      />
    );
  }

  return (
    <PromptOrderContext.Provider value={promptOrder}>
      <InspectorLayout inspector={drawer}>
        {/* The preview's page body (index.html line 278): the table panel fills what the toolbar and the strip leave */}
        <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
          <ScopeToolbar
            state={state}
            engines={engines ?? []}
            terms={terms}
            tracked={tracked}
            trend={window?.trend ?? []}
            timeZone={project.timeZone}
            latest={latest}
            isDefaultScope={isDefaultScope}
            onChange={set}
            onReset={resetScope}
            onExport={() => void exportTab()}
            exporting={exporting}
            pickerOpen={pickerOpen}
            onPickerOpenChange={setPickerOpen}
          />
          {overview.status === 'error' ? (
            <InlineError
              title={t('measures.loadFailed')}
              reason={t('board.loadFailedReason')}
              errorId={overview.errorId}
              onRetry={overview.retry}
              retrying={overview.retrying}
              retryLabel={t('board.retry')}
            />
          ) : (
            <MeasuresStrip
              overview={overview.data}
              status={overview.refetching ? 'refetching' : overview.status === 'loading' ? 'loading' : 'ready'}
              allPlatforms={state.platform === 'all'}
              ownDomain={project.ownDomain ?? project.name}
              previous={previous}
            />
          )}
          {main}
        </div>
      </InspectorLayout>
    </PromptOrderContext.Provider>
  );
}
```

`apps/web/src/features/citations/index.ts`:

```ts
// What other code imports of the Citations feature
export { CitationsScreen, type CitationsProject, type CitationsScreenProps } from './board-screen';
```

The old `citations-screen.tsx` and its test stay until Task 12; nothing imports it now. `onTabChange` passes `inspector.setTab` straight through: the drawers already map their default tab to `DEFAULT_INSPECTOR_TAB`.

- [ ] **Step 6: Switch the routes**

`apps/web/src/app/[workspace]/[project]/ai/citations/citations-route.tsx`:

```tsx
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { CitationsScreen } from '@/features/citations';
import { PromptDrawerHost } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

/**
 * AI > Citations, both tabs (WP-77): the project shell serves loading and error; the page finds the project among
 * those the member can open, and composes the prompt inspector, which another feature owns, for the drawers to open
 * in place.
 */
export async function CitationsRoute({
  params,
  tab,
}: {
  params: Promise<{ workspace: string; project: string }>;
  tab: 'pages' | 'gaps';
}): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <CitationsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        ownDomain: current.primary_domain?.registrable_domain ?? null,
      }}
      tab={tab}
      promptDrawer={
        <PromptDrawerHost
          workspaceId={membership.workspace.workspace_id}
          projectId={current.project_id}
          timeZone={current.timezone}
        />
      }
    />
  );
}
```

`page.tsx` becomes:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CitationsRoute } from './citations-route';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('citations');
  return { title: t('title') };
}

/** AI > Citations, Cited pages (brief 3.1: `/ai/citations`). */
export default function CitationsPage({ params }: PageProps<'/[workspace]/[project]/ai/citations'>): Promise<ReactNode> {
  return CitationsRoute({ params, tab: 'pages' });
}
```

`gaps/page.tsx` is the same with `PageProps<'/[workspace]/[project]/ai/citations/gaps'>` and `tab: 'gaps'`, its `generateMetadata` reading `citations.title` as well. `page.test.tsx` keeps its three cases and expects `props.tab: 'pages'`, `props.project.ownDomain` (the factory's `primary_domain.registrable_domain`) and a `promptDrawer` element of type `PromptDrawerHost`; mock `@/features/prompts` as `{ PromptDrawerHost: () => null }` so the test does not load the prompts feature. `gaps/page.test.tsx` checks `tab: 'gaps'` and the 404.

- [ ] **Step 7: Run the tests and the full suite**

Run: `cd apps/web && pnpm vitest run src/features/citations src/features/prompts/prompt-drawer-host.test.tsx "src/app/[workspace]/[project]/ai/citations"`
Expected: PASS. The old screen's tests still pass (they render `./citations-screen` directly).

Then, from the worktree root:

```bash
(cd apps/web && pnpm prettier --write src/features/citations src/features/prompts/prompt-drawer-host*.tsx src/features/prompts/index.ts src/lib/inspector/prompt-order.ts "src/app/[workspace]/[project]/ai/citations" && pnpm lint && pnpm typecheck && pnpm format:check)
infra/dev/heavy --lane medium --label wp77-t11 -- bash -c 'cd apps/web && pnpm test'
infra/dev/heavy --lane heavy --label wp77-t11-build -- bash -c 'cd apps/web && pnpm build'
```

Expected: green; the build lists `/[workspace]/[project]/ai/citations/gaps`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/citations/drawers/gap-drawer.tsx apps/web/src/features/citations/drawers/gap-drawer.test.tsx apps/web/src/lib/inspector/prompt-order.ts apps/web/src/features/prompts/prompt-drawer-host.tsx apps/web/src/features/prompts/prompt-drawer-host.test.tsx apps/web/src/features/prompts/index.ts apps/web/src/features/citations/board-screen.tsx apps/web/src/features/citations/board-screen.test.tsx apps/web/src/features/citations/index.ts "apps/web/src/app/[workspace]/[project]/ai/citations"
git commit -m "WP-77: gap drawer, prompt inspector in place and the new Citations route"
```

---

### Task 12: Remove the old screen; repoint the Overview drills; remove Sources

Brief step 9; section 4 (every bullet but e2e and MSW); D-5, D-8. Parity rows: none on screen; 3.1 "Query keys" (the old links now arrive with the new keys from the Overview).

**Files:**
- Delete (feature, old screen; every one is imported only by other files of this list, checked in Step 1): `apps/web/src/features/citations/` `citation-country.ts`, `citation-country.test.tsx`, `citation-reads.ts`, `citation-reads.test.tsx`, `citation-scope.ts`, `citation-scope.test.ts`, `citation-table-states.tsx`, `citation-table-states.test.tsx`, `citation-tabs.ts`, `citation-tabs.test.ts`, `citation-views.ts`, `citation-views.test.ts`, `citations-export.ts`, `citations-export.test.ts`, `citations-filters.ts`, `citations-filters.test.ts`, `citations-screen.tsx`, `citations-screen.test.tsx`, `citations-states.tsx`, `citations-states.test.tsx`, `citations-strip.tsx`, `citations-strip.test.tsx`, `cited-with-join.ts`, `cited-with-join.test.ts`, `compare-select.tsx`, `compare-select.test.tsx`, `domain-columns.tsx`, `domain-columns.test.tsx`, `domain-rows.ts`, `domain-rows.test.ts`, `domains-tab.tsx`, `domains-tab.test.tsx`, `engine-share.ts`, `engine-share.test.ts`, `export-button.tsx`, `export-button.test.tsx`, `min-support-select.tsx`, `min-support-select.test.tsx`, `no-own-page.tsx`, `no-own-page.test.tsx`, `page-columns.tsx`, `page-columns.test.tsx` (the root ones, not `cited-pages/`), `pages-tab.tsx`, `pages-tab.test.tsx` (root), `sort-select.tsx`, `strip-model.ts`, `strip-model.test.ts`, `use-cited-instead.ts`, `use-expanded-pages.ts`, `use-expanded-pages.test.tsx`, and the folders `domain-inspector/`, `mobile-rows/`, `new-lost/`, `source-inspector/`
- Delete: `apps/web/src/test/citations-lists-harness.tsx` (only the old `mobile-rows` tests import it)
- Delete: `apps/web/src/lib/citations/prompt-texts-query.ts`, `prompt-texts-query.test.ts` (only `citation-country` used it)
- Keep in `lib/citations`: `types.ts`, `source-queries.ts`, `share-model.ts`, `group-answers.ts`, `methodology.ts` (the Overview cards, the prompt inspector's Citations tab and `lib/fanout` import them), `entities-query.ts` (the new reads), `board-queries.ts`
- Delete: `apps/web/src/app/[workspace]/[project]/ai/sources/page.tsx` (the 404 stand-in of WP-61; the catch-all `[...rest]` serves the same 404)
- Modify: `apps/web/src/features/ai-overview/cards/sources/parts/drill.ts`, `drill.test.ts`, `drill-source.test.ts`; the four callers `own-pages-card.tsx`, `top-domains-card.tsx`, `new-lost-card.tsx`, `activity/key-changes-card.tsx` and their tests where they assert the link [lease]
- Modify: `apps/web/src/features/ai-overview/drilldown/drill-links.ts`, `drill-links.test.ts` [lease]
- Modify: `apps/web/e2e/flows/ai-overview-sources.spec.ts` (its two Citations link cases, lines 218 to 240 and 322 to 352) [lease needed: it is not in the brief's list]
- Modify: `apps/web/src/lib/navigation/registry.ts`, `registry.test.ts` [lease]
- Modify: `apps/web/messages/en.json` (the old `citations` subtrees and `navigation.items.sources`) [lease]

- [ ] **Step 1: Prove nothing else imports the old files**

Run, from `apps/web`:

```bash
grep -rn "features/citations/\(citation-\|citations-\|cited-with\|compare-select\|domain-\|domains-tab\|engine-share\|export-button\|min-support\|mobile-rows\|new-lost\|no-own-page\|page-columns\|pages-tab\|sort-select\|source-inspector\|strip-model\|use-cited\|use-expanded\)" src e2e
grep -rn "prompt-texts-query\|citations-lists-harness" src e2e
```

Expected: only the three Overview drill tests (`drill.test.ts`, `drill-source.test.ts`, `drill-links.test.ts`, which import `parseScope` of `citation-scope`) and files inside the delete list. Anything else: stop and keep that file (and say so in the commit message).

- [ ] **Step 2: Write the failing drill tests**

`drill.test.ts`, replacing the cases that read `parseCitationScope`:

```ts
import { describe, expect, it } from 'vitest';

import { citationsLink } from './drill';
import { parseBoard, type BoardSearch } from '@/features/citations/board-state';

// ...the file's existing `base` and `queryOf` helpers stay

const searchOf = (query: URLSearchParams): BoardSearch => Object.fromEntries(query.entries());
const OPTIONS = { engines: null, terms: null, tracked: null } as const;

describe('citationsLink (WP-77)', () => {
  it('opens Cited pages with the owner of the card, and the page drawer of a page', () => {
    const href = citationsLink(base(), { tab: 'pages', owner: 'third_party', page: 42 });
    const query = queryOf(href);
    expect(new URL(href ?? '', 'http://localhost').pathname).toMatch(/\/ai\/citations$/);
    expect(parseBoard(searchOf(query), OPTIONS).owner).toBe('third');
    expect(query.get('inspect')).toBe('cited-page:42');
  });

  it('writes nothing for the own owner, the default', () => {
    expect(queryOf(citationsLink(base(), { tab: 'pages', owner: 'own' })).has('owner')).toBe(false);
  });

  it('opens the gap analysis on its own route', () => {
    expect(new URL(citationsLink(base(), { tab: 'gaps' }) ?? '', 'http://localhost').pathname).toMatch(/\/ai\/citations\/gaps$/);
  });

  it('stays null where the scope cannot be shown', () => {
    expect(citationsLink(null, { tab: 'pages' })).toBeNull();
  });
});
```

A test may import another feature: `eslint.config.mjs` leaves `src/**/*.test.{ts,tsx}` out of the boundary rule (line 338, "Tests may import anything"), which is how the old tests imported `citation-scope`. Product code in `features/ai-overview` never imports `board-state`; it writes the keys out, as it does for the Prompts page.

`drill-source.test.ts`: the same change for its source-page case (`{ tab: 'pages', owner: 'own', page: <urlId> }`, `inspect=cited-page:<urlId>`).

`drill-links.test.ts`:
- the "carries the scope" table drops the `citations` row, and a new case says: `drillHref('citations', scopeOf({ ...NARROWED, country: null, branded: 'excluded' }), {}, PROJECT)` has path `/acme/eventus/ai/citations`, no `from`, `to`, `win`, `cmp`, `engine`, `topic` or `branded`, has `group=<TOPIC>`, and `platform` only for one engine (`scopeOf({ engines: ['gemini_web'] })` gives `platform=gemini_web`; two engines give none);
- a branded-included scope gives `null` for `citations` (the page counts non-branded prompts only);
- the "read by the Citations page own parser" case reads the link with `parseBoard` and expects `group` and `platform`;
- the liveness loop is `for (const kind of ['competitors'] as const)`;
- the `citations` cases of "branded only" and "country" keep their `null`.

Run: `cd apps/web && pnpm vitest run src/features/ai-overview/cards/sources/parts src/features/ai-overview/drilldown`
Expected: FAIL.

- [ ] **Step 3: Repoint the drills**

`drill.ts`:

```ts
'use client';

import type { Route } from 'next';
import { useCallback } from 'react';

import { useCardDrill } from '../../engines/use-card-seams';
import { formatInspectTarget } from '@/lib/inspector/placement';
import type { DomainRole } from '@/lib/citations/types';
import { withQuery } from '@/lib/routes/paths';

/**
 * The links of the sources cards into the Citations page (WP-77). `drillHref('citations', ...)` carries the scope the
 * page reads (one platform, the group) and is `null` where the page cannot show it (a country, branded prompts); this
 * adds what is the page's own: the tab (a route), the Cited pages owner and the page drawer (`inspect=cited-page:<url_id>`).
 */

export interface CitationsTarget {
  tab: 'pages' | 'gaps';
  /** The card's role, as the Cited pages owner filter. */
  owner?: DomainRole | undefined;
  /** Opens this cited page (its `url_id`) in the page drawer. */
  page?: number | undefined;
}

/** The address value of each role (`owner` of `features/citations/board-state.ts`); own is the default and is not written. */
const OWNER: Readonly<Record<DomainRole, string | null>> = { own: null, competitor: 'competitor', third_party: 'third' };

/** `base` (the Citations link of the scope) with `target` added; `null` stays `null`, so the number is plain text. */
export function citationsLink(base: Route | null, target: CitationsTarget): Route | null {
  if (base === null) return null;
  const [path = '', current = ''] = base.split('?');
  const query = new URLSearchParams(current);
  const owner = target.owner === undefined ? null : OWNER[target.owner];
  if (owner !== null) query.set('owner', owner);
  if (target.page !== undefined) query.set('inspect', formatInspectTarget({ type: 'cited-page', id: String(target.page) }));
  return withQuery((target.tab === 'gaps' ? `${path}/gaps` : path) as Route, query.toString());
}

/** The link of a target of the Citations page for the scope of the card, or `null` where it cannot be shown. */
export function useCitationsDrill(): (target: CitationsTarget) => Route | null {
  const drill = useCardDrill();
  return useCallback((target) => citationsLink(drill('citations'), target), [drill]);
}
```

The callers:
- `own-pages-card.tsx`: `citations({ tab: 'pages', owner: 'own', page: figure.urlId })`
- `top-domains-card.tsx` `rowOf`: `citations({ tab: 'pages', owner: figure.role })`: the row's own role, so a third-party domain opens the third-party pages (the domain inspector is gone, D-5; Open point 8 proposes adding the domain as `q`)
- `new-lost-card.tsx` and `key-changes-card.tsx`: `citations({ tab: 'pages' })` (the New and lost tab is gone, D-5)

`drill-links.ts`:
- `DrillKind` loses `'sources'`; `DRILL_SUPPORT` and `DESTINATIONS` lose their `sources` entries (D-8);
- `DESTINATIONS.citations` becomes `{ nav: 'citations', scoped: true, country: false, branded: { excluded: null } }`: the page counts non-branded prompts only, so an included scope has no link;
- in `drillHref`, right after the branded and country check and before the window check, the Citations branch:

```ts
  if (kind === 'citations') {
    // The Citations page reads runs, not dates, one platform or all, and a group (WP-77 brief 3.1): the window and the
    // comparison of the Overview are not carried
    const engines = extra.engine === undefined ? scope.engines : [extra.engine];
    const query = new URLSearchParams();
    const one = engines !== null && engines.length === 1 ? engines[0] : undefined;
    if (one !== undefined) query.set('platform', one);
    const group = extra.term ?? scope.topic;
    if (group !== null && group !== undefined && group !== '') query.set('group', group);
    return withQuery(path, query.toString());
  }
```

Place it before `if (scope.range.days > MAX_RANGE_DAYS) return null;` so a long Overview window still links (the page does not read it). The file header's list of the Prompts page keys stays; add one line: "The Citations page's keys (`platform`, `group`, `owner`) are `features/citations/board-state.ts`'s; `drill-links.test.ts` reads every link back with its parser."

- [ ] **Step 4: Remove the Sources entry**

`registry.ts`: delete the `sources` object and `| 'sources'` from `NavKey`. `registry.test.ts`: remove `'sources'` from the planned list (line 182) and the `at('/digibranders/fynix/ai/sources')` expectation (line 192). Delete `app/[workspace]/[project]/ai/sources/page.tsx`. `messages/en.json`: delete `navigation.items.sources`. The layouts catalog's `sources` screen (`lib/layouts/catalog.ts` line 922) is an API screen key (`ResolvedLayout['screen']`), not a navigation key: it stays (Open point 16).

- [ ] **Step 5: Delete the old screen and its messages**

```bash
cd apps/web
git rm -r src/features/citations/domain-inspector src/features/citations/mobile-rows src/features/citations/new-lost src/features/citations/source-inspector
git rm src/features/citations/citation-country.ts src/features/citations/citation-country.test.tsx src/features/citations/citation-reads.ts src/features/citations/citation-reads.test.tsx src/features/citations/citation-scope.ts src/features/citations/citation-scope.test.ts src/features/citations/citation-table-states.tsx src/features/citations/citation-table-states.test.tsx src/features/citations/citation-tabs.ts src/features/citations/citation-tabs.test.ts src/features/citations/citation-views.ts src/features/citations/citation-views.test.ts src/features/citations/citations-export.ts src/features/citations/citations-export.test.ts src/features/citations/citations-filters.ts src/features/citations/citations-filters.test.ts src/features/citations/citations-screen.tsx src/features/citations/citations-screen.test.tsx src/features/citations/citations-states.tsx src/features/citations/citations-states.test.tsx src/features/citations/citations-strip.tsx src/features/citations/citations-strip.test.tsx src/features/citations/cited-with-join.ts src/features/citations/cited-with-join.test.ts src/features/citations/compare-select.tsx src/features/citations/compare-select.test.tsx src/features/citations/domain-columns.tsx src/features/citations/domain-columns.test.tsx src/features/citations/domain-rows.ts src/features/citations/domain-rows.test.ts src/features/citations/domains-tab.tsx src/features/citations/domains-tab.test.tsx src/features/citations/engine-share.ts src/features/citations/engine-share.test.ts src/features/citations/export-button.tsx src/features/citations/export-button.test.tsx src/features/citations/min-support-select.tsx src/features/citations/min-support-select.test.tsx src/features/citations/no-own-page.tsx src/features/citations/no-own-page.test.tsx src/features/citations/page-columns.tsx src/features/citations/page-columns.test.tsx src/features/citations/pages-tab.tsx src/features/citations/pages-tab.test.tsx src/features/citations/sort-select.tsx src/features/citations/strip-model.ts src/features/citations/strip-model.test.ts src/features/citations/use-cited-instead.ts src/features/citations/use-expanded-pages.ts src/features/citations/use-expanded-pages.test.tsx
git rm src/test/citations-lists-harness.tsx src/lib/citations/prompt-texts-query.ts src/lib/citations/prompt-texts-query.test.ts "src/app/[workspace]/[project]/ai/sources/page.tsx"
```

In `messages/en.json`, delete these members of `citations` (none is read by the new screen; `pnpm typecheck` proves it, since next-intl's keys are typed from the catalog): `meta`, `metaCounts`, `metaStale`, `metaNone`, `copyLink`, `linkCopied`, `moreActions`, `export`, `exported`, `exportNone`, `exportFailed`, `exportLoading`, `exportNamesLoading`, `tabs`, `filters`, `compare`, `minSupport`, `sort`, `views`, `strip`, `table`, `empty`, `noOwn`, `exportColumns`, `newLost`, `flagFilters`, `scope`, `mobile`, `inspectors`. What remains of `citations` is `title`, `noAccessTitle`, `noAccessReason` and the Task 3 subtrees.

In `e2e/flows/ai-overview-sources.spec.ts`:
- "a domain row opens the Citations page with the domain inspector": rename to "a domain row opens Cited pages of its domain type, and Back returns to the scope"; the row's `href` matches `/\/ai\/citations\?owner=third$/`; after the click the heading is "Citations", the URL has `owner=third` and no `cmp`, `tab` or `inspect`, and the "Domain type" group has "Third-party" pressed; Back keeps its expectations.
- the New and lost row and the key changes feed link: `href` matches `/\/ai\/citations$/` (or with `platform`/`group` when the scope has them); after the click the heading is "Citations" and the "Cited pages" link is `aria-current="page"`.

- [ ] **Step 6: Run the checks**

Run, from the worktree root:

```bash
(cd apps/web && pnpm prettier --write src/features/ai-overview src/lib/navigation messages/en.json e2e/flows/ai-overview-sources.spec.ts && pnpm lint && pnpm typecheck && pnpm format:check)
infra/dev/heavy --lane medium --label wp77-t12 -- bash -c 'cd apps/web && pnpm test'
infra/dev/heavy --lane heavy --label wp77-t12-build -- bash -c 'cd apps/web && pnpm build'
grep -rn "features/citations/citation-\|domain-inspector\|source-inspector" apps/web/src apps/web/e2e
```

Expected: green; the last grep prints only the old e2e files (`e2e/flows/ai-citations-inspectors.spec.ts`, `e2e/support/ai-citations-inspectors.ts`), which Task 13 replaces. `pnpm typecheck` is the proof that no deleted file had another importer and no deleted message key is read.

- [ ] **Step 7: Commit**

```bash
git add -u apps/web/src apps/web/messages/en.json
git add apps/web/src/features/ai-overview apps/web/src/lib/navigation apps/web/e2e/flows/ai-overview-sources.spec.ts
git commit -m "WP-77: remove the old Citations screen, repoint the Overview drills, drop Sources"
```

`git add -u` stages the deletions and the modified tracked files under the two paths only; check `git status` shows nothing of another session.

---

### Task 13: e2e, screenshot parity, as-built note, full checks, push

Brief step 10; section 5.2 and 5.3; section 7 (acceptance). Parity rows: 3.9 checked in a browser (375, 768, 1024, 1440 px; light and dark; drawer docked and closed), and every row of 3.1 to 3.8 seen side by side.

**Files:**
- Replace: `apps/web/e2e/support/ai-citations.ts`, `apps/web/e2e/flows/ai-citations.spec.ts`
- Delete: `apps/web/e2e/flows/ai-citations-inspectors.spec.ts`, `apps/web/e2e/support/ai-citations-inspectors.ts`
- Modify: `docs/ai-visibility/work-packages/WP-77-citations-v2-web.md` (a section "9. As built")

- [ ] **Step 1: Write the support file**

`apps/web/e2e/support/ai-citations.ts`:

```ts
import { expect, type Locator, type Page } from '@playwright/test';

import { signIn } from '../support';

/**
 * What the Citations e2e of WP-77 shares (apps/web/e2e/flows/ai-citations.spec.ts). The mock answers come from the
 * design preview's data (src/mocks/fixtures/citations-v2.json), so the numbers on screen are the fixture's `expected`.
 * `E2E_CITATIONS_REAL=1` runs the same walk against the dev API, where only the structure is checked.
 */

export const EDITOR = 'priya@digibranders.test';
export const THEME_KEY = 'idraft.theme';
export const FYNIX_CITATIONS = '/digibranders/fynix/ai/citations';
export const REAL = process.env.E2E_CITATIONS_REAL === '1';

export const stripOf = (page: Page): Locator => page.getByRole('group', { name: 'Citation measures' });
/** A strip slot's figure, the tab stop named "<label>: <value>. <hint>". */
export const figureOf = (page: Page, label: string): Locator =>
  stripOf(page).getByLabel(new RegExp(`^${label}: `));
export const pagesTable = (page: Page): Locator => page.getByRole('table', { name: 'Cited pages' });
export const gapsTable = (page: Page): Locator => page.getByRole('table', { name: 'Gap analysis' });
export const viewsOf = (page: Page): Locator => page.getByRole('navigation', { name: 'Citations views' });
export const drawerOf = (page: Page): Locator => page.getByRole('complementary').or(page.getByRole('dialog', { name: /./ })).last();

/** Opens the Citations page at `width` as the editor, with `query`, and waits for the strip and the first row. */
export async function openCitations(page: Page, width: number, query = '', path = FYNIX_CITATIONS): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await page.goto(query === '' ? path : `${path}?${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeAttached();
  await expect(figureOf(page, 'Total citations')).toBeVisible();
}

/** The value part of a figure's name: "Total citations: 607. How many ..." gives "607". */
export async function figureValue(page: Page, label: string): Promise<string> {
  const name = (await figureOf(page, label).getAttribute('aria-label')) ?? '';
  return name.slice(label.length + 2, name.indexOf('. '));
}
```

- [ ] **Step 2: Write the spec**

`apps/web/e2e/flows/ai-citations.spec.ts`:

```ts
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { formatInteger, formatPercent, formatRelativeChange } from '../../src/lib/format';
import { CITATIONS_FIXTURE_SHAPE } from '../../src/mocks/citations-v2-shape';
import { expectAccessible } from '../support';
import {
  drawerOf,
  figureValue,
  FYNIX_CITATIONS,
  gapsTable,
  openCitations,
  pagesTable,
  REAL,
  stripOf,
  THEME_KEY,
  viewsOf,
} from '../support/ai-citations';

// Read from disk and checked with the mock layer's own shape (`package.json` is an ES module: no bare JSON import)
const FIXTURE = CITATIONS_FIXTURE_SHAPE.parse(
  JSON.parse(readFileSync(new URL('../../src/mocks/fixtures/citations-v2.json', import.meta.url), 'utf8')),
);
const { enabled, chatgpt } = FIXTURE.expected;
type Expected = typeof enabled;

/** The six figures the strip must show for `expected` (brief 5.2). */
async function expectStrip(page: import('@playwright/test').Page, expected: Expected): Promise<void> {
  if (REAL) return;
  const { strip } = expected;
  expect(await figureValue(page, 'Total citations')).toBe(formatInteger(strip.citations));
  expect(await figureValue(page, 'Citation rate')).toBe(formatPercent(strip.frequency, { decimals: 1 }));
  expect(await figureValue(page, 'Prompt coverage')).toBe(formatPercent(strip.coverage, { decimals: 1 }));
  expect(await figureValue(page, 'Unique cited URLs')).toBe(formatInteger(strip.urls));
  expect(await figureValue(page, 'Unique cited domains')).toBe(formatInteger(strip.domains));
  expect(await figureValue(page, 'Citation growth')).toBe(
    formatRelativeChange((strip.citations - strip.previousCitations) / strip.previousCitations),
  );
}

test.describe('The Citations page (WP-77)', () => {
  test('Cited pages: the strip, the owner filter, the footer and the gap badge of the enabled engines', async ({ page }) => {
    await openCitations(page, 1440);
    await expectStrip(page, enabled);
    await expect(viewsOf(page).getByRole('link', { name: 'Cited pages' })).toHaveAttribute('aria-current', 'page');
    const owners = page.getByRole('group', { name: 'Domain type' });
    await expect(owners.getByRole('button', { pressed: true })).toContainText('Your site');
    if (!REAL) {
      await expect(owners.getByRole('button', { name: /^All/ })).toContainText(formatInteger(enabled.pages.all));
      await expect(page.getByText(`${formatInteger(enabled.pages.own)} pages · ${formatInteger(enabled.strip.citations)} citations`)).toBeVisible();
      await expect(viewsOf(page).getByRole('link', { name: /^Gap analysis/ })).toContainText(formatInteger(enabled.gaps.gaps));
      await expect(page.getByText(/^Updated Sep 28, 02:1\d · run 48$/)).toBeVisible();
    }
    await expect(pagesTable(page).getByRole('row')).not.toHaveCount(0);
    await expectAccessible(page);
  });

  test('ChatGPT reads the preview numbers, and All widens the table to every owner', async ({ page }) => {
    await openCitations(page, 1440);
    await page.getByRole('combobox', { name: 'Platform: All platforms' }).click();
    await page.getByRole('option', { name: /ChatGPT/ }).click();
    await expect(page).toHaveURL(/[?&]platform=chatgpt_web(&|$)/);
    await expectStrip(page, chatgpt);
    await page.getByRole('group', { name: 'Domain type' }).getByRole('button', { name: /^All/ }).click();
    await expect(pagesTable(page).getByRole('columnheader', { name: 'Domain type' })).toBeVisible();
    if (!REAL) await expect(page.getByText(new RegExp(`^${formatInteger(chatgpt.pages.all)} pages · `))).toBeVisible();
  });

  test('the prompts popover opens the page drawer, which steps with J and K and has two tabs', async ({ page }) => {
    await openCitations(page, 1440, 'platform=chatgpt_web');
    const chip = pagesTable(page).getByRole('button', { name: /^Prompts that cite / }).first();
    await chip.click();
    const popover = page.getByRole('dialog', { name: /^Prompts that cite / });
    await expect(popover.getByText('Cited for')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(chip).toBeFocused();
    await chip.click();
    await popover.getByRole('button', { name: /^(Show all \d+ prompts|Open the page details)$/ }).click();
    const drawer = drawerOf(page);
    await expect(drawer).toContainText('Cited page');
    await expect(drawer).toContainText('1 of ');
    if (!REAL) await expect(drawer).toContainText(`${formatInteger(chatgpt.pages.topOwn.citations)} citations`);
    await expect(page).toHaveURL(/[?&]inspect=cited-page%3A\d+(&|$)/);
    await page.keyboard.press('j');
    await expect(drawer).toContainText('2 of ');
    await drawer.getByRole('tab', { name: 'Overview' }).click();
    await expect(drawer.getByText('Cited alongside')).toBeVisible();
    await expectAccessible(page);
  });

  test('Gap analysis: the competitors popover, Only gaps and the gap drawer', async ({ page }) => {
    await openCitations(page, 1440);
    await viewsOf(page).getByRole('link', { name: /^Gap analysis/ }).click();
    await expect(page).toHaveURL(/\/ai\/citations\/gaps/);
    await expect(gapsTable(page)).toBeVisible();
    if (!REAL) {
      await expect(page.getByText(`${formatInteger(enabled.gaps.gaps)} prompts with a gap`)).toBeVisible();
      await expect(gapsTable(page).getByRole('row').nth(1)).toContainText(enabled.gaps.first);
    }
    await page.getByRole('button', { name: /^Competitors: / }).click();
    const picker = page.getByRole('dialog', { name: 'Competitors to compare' });
    await expect(picker.getByText('3 of 5')).toBeVisible();
    await picker.getByRole('checkbox').nth(3).check();
    await expect(picker.getByText('4 of 5')).toBeVisible();
    await expect(page).toHaveURL(/[?&]comp=/);
    await page.keyboard.press('Escape');
    await expect(gapsTable(page).getByRole('columnheader')).toHaveCount(4 + 3);
    await page.getByRole('checkbox', { name: 'Only gaps' }).uncheck();
    await expect(page).toHaveURL(/[?&]gaps=all(&|$)/);
    await gapsTable(page).getByRole('button', { name: /^Open / }).first().click();
    const drawer = drawerOf(page);
    await expect(drawer).toContainText('Who is cited');
    await drawer.getByRole('tab', { name: 'By platform' }).click();
    await expect(drawer.getByRole('table', { name: 'By platform' })).toBeVisible();
    await expectAccessible(page);
  });

  test('an old link moves onto the new keys, and the query does not follow to another page', async ({ page }) => {
    await openCitations(page, 1440, 'tab=domains&role=third_party&win=7d&cmp=off');
    await expect(page).toHaveURL(new RegExp(`${FYNIX_CITATIONS}\\?owner=third$`));
    await page.getByRole('link', { name: 'Topics & Prompts' }).click();
    await expect(page).not.toHaveURL(/owner=third/);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`at 375 px in the ${theme} theme the scope is two columns and the panel keeps 384 px`, async ({ page }) => {
      await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const);
      await openCitations(page, 375);
      await expect(page.getByRole('button', { name: 'Reset scope' })).toHaveCount(0);
      const panel = pagesTable(page).locator('xpath=ancestor::section[1]');
      expect((await panel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(384);
      await expect(stripOf(page)).toBeVisible();
      await expectAccessible(page);
    });
  }

  for (const width of [768, 1024] as const) {
    test(`is accessible at ${String(width)} px with the drawer open`, async ({ page }) => {
      await openCitations(page, width, 'platform=chatgpt_web');
      await pagesTable(page).getByRole('button', { name: /^Open / }).first().click();
      await expect(drawerOf(page)).toContainText('Cited page');
      await expectAccessible(page);
    });
  }
});
```

`expectAccessible` (`e2e/support.ts`) runs axe on the page as it is. The theme key and the init script are the old spec's (`THEME_KEY = 'idraft.theme'`). The `Topics & Prompts` link is the sidebar's (`navigation.items.prompts`).

- [ ] **Step 3: Delete the old inspector e2e and run the spec**

```bash
cd apps/web && git rm e2e/flows/ai-citations-inspectors.spec.ts e2e/support/ai-citations-inspectors.ts
```

From the worktree root: `infra/dev/heavy --lane heavy --label wp77-e2e -- bash -c 'cd apps/web && pnpm e2e -- flows/ai-citations.spec.ts flows/ai-overview-sources.spec.ts flows/shell.spec.ts'`
Expected: PASS (the Playwright web server builds the app with `NEXT_PUBLIC_API_MOCKING=all`, `playwright.config.ts` lines 52 to 69).

Against the dev API (the WP-76 backend with real data, the owner's local stack): start the API (`.claude/launch.json` `api-real`, port 8000) only if it is not running (`lsof -nP -iTCP:8000 -sTCP:LISTEN`), start the app on a free port without mocking (see Step 4 for the port rule), sign the e2e editor in through a seed that has the account (if the dev database has no `priya@digibranders.test`, skip this run and say so in the as-built note), then `E2E_BASE_URL=http://localhost:<port> E2E_CITATIONS_REAL=1 pnpm e2e -- flows/ai-citations.spec.ts`.

- [ ] **Step 4: Side by side screenshots (brief 5.3)**

The preview already runs on port 4190 from the main checkout: do not start another preview server. Check it: `lsof -nP -iTCP:4190 -sTCP:LISTEN` shows a listener whose working directory is `/Users/a12345/Desktop/AI/idraft/platform/apps/web/design-preview` (or the main checkout). Its Citations page is `http://localhost:4190/?platform=chatgpt_web#/citations` (the query sits before the hash, C 41).

The app: follow the Dev Server Policy. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'`; reuse a listener only if its command runs from this worktree with `NEXT_PUBLIC_API_MOCKING=all`; otherwise pick a free port (`for p in 3107 3108 3109; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null || { echo $p; break; }; done`) and start, in the background, from the worktree: `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev --port <port>`. Never kill a process on a port. Use the URL the server prints (`http://localhost:<port>`): the mock worker and the session cookie need a localhost origin. Sign in as `priya@digibranders.test` with the fixture password (`MOCK_PASSWORD` of `src/mocks/fixtures.ts`).

Capture both at 1440 and 375 px, light theme, Platform ChatGPT in both (the preview's All platforms has a fourth platform), these states: Cited pages default; owner All; the prompts popover of the first row; Gap analysis; the competitors popover; the page drawer on Prompts and on Overview; the gap drawer on Gap and on By platform. Use the Browser pane (`mcp__Claude_Browser__*`) or a throwaway Playwright script in the scratchpad; keep the images out of the repository. A fresh reviewer (not the implementer) compares each pair and lists every visible difference in the as-built note: each is fixed, or is a section 2 decision, or is one of the Open points below with the owner's answer. The names differ by design under mocks (Open point 4: Fynix's competitors, topics and domain carry the preview's counts).

- [ ] **Step 5: As-built note**

Append to `docs/ai-visibility/work-packages/WP-77-citations-v2-web.md`:

```markdown
## 9. As built (2026-11-xx)

- Screen: `apps/web/src/features/citations/board-screen.tsx` and its modules; routes `/ai/citations` and `/ai/citations/gaps` (`citations-route.tsx`).
- House components added: `BoardTable` (12 section 20), `TrendIcon`, `PressedGroup`; extended: `Select` (prefix, option display and note, popup width), `Popover` (narrow and wide widths, menu and none paddings), `EntitySwatch` (dot), `SparklineCell` (size, entity colour, end dot, fill), `EngineLogo` (hidden name), `MetricStrip` (line), `TabNav` (segmented), `EmptyState` (table and card), `InspectorSection` (meta, flush), `Badge` (`badgeVariants` exported).
- Mocks: `src/mocks/handlers/citations-v2.ts` over `src/mocks/fixtures/citations-v2.json` (`scripts/citations-fixture.mjs`), names mapped onto the requesting project.
- Prompt inspector in place: `PromptDrawerHost` of `features/prompts`, composed by the route.
- Removed: the Domains and New and lost tabs, the domain and source inspectors, the `sources` navigation entry.
- Parity review (date, reviewer): the difference list, each with its resolution.
- Checks: lint, typecheck, test, format:check, build, e2e (mocks; dev API: ran or why not).
```

ASCII only, no dashes; fill the date and the lists from what was built.

- [ ] **Step 6: Full checks through the lock**

From the worktree root:

```bash
(cd apps/web && pnpm install --frozen-lockfile && pnpm lint; pnpm typecheck && pnpm format:check)
infra/dev/heavy --lane medium --label wp77-test -- bash -c 'cd apps/web && pnpm test'
infra/dev/heavy --lane heavy --label wp77-build -- bash -c 'cd apps/web && pnpm build'
infra/dev/heavy --lane heavy --label wp77-e2e -- bash -c 'cd apps/web && pnpm e2e'
git grep -nP '[\x{2013}\x{2014}]' -- apps/web/src apps/web/messages apps/web/scripts apps/web/e2e docs/superpowers/plans/2026-11-17-ai-wp-77-citations-v2-web.md docs/ai-visibility/work-packages/WP-77-citations-v2-web.md docs/design-system
```

Expected: `pnpm lint` reports only the three known errors in `design-preview/il-journey.js`, `il-model.js` and `il-settings.js` (internal links preview, not ours); everything else green; the last grep prints nothing.

- [ ] **Step 7: Commit, rebase, push**

```bash
git add apps/web/e2e/support/ai-citations.ts apps/web/e2e/flows/ai-citations.spec.ts docs/ai-visibility/work-packages/WP-77-citations-v2-web.md
git commit -m "WP-77: Citations e2e, parity review and as-built note"
git fetch origin
git merge-base --is-ancestor b3be40c8 origin/develop || echo "WP-76 is not on develop yet: stop and tell the coordinator"
git rebase origin/develop
```

After the rebase, re-run Step 6's `pnpm typecheck`, `pnpm test` and the Citations e2e (a rebase can bring a new `schema.ts`; regenerate nothing yourself: if `schema.ts` changed under WP-76, the WP-76 session owns `pnpm gen:api`). Then `git push origin HEAD:develop`. Never push, merge or open a pull request into `main` (AGENTS.md, Branches and releases).

---

## Parity row coverage

Every row of brief sections 3.1 to 3.9, and the task that builds it (tests named in that task check it; Task 13's e2e and side by side review check all of them on screen).

| Brief row | Preview lines | Task |
|---|---|---|
| 3.1 Layout (toolbar, strip, one table panel; no header row; sr-only `h1`) | C 183 to 332; index.html 278 | 4 (`h1`), 6 (panel), 11 (page body) |
| 3.1 Tabs in the route | C 263 to 285, 714 to 719 | 6 (segmented `TabNav`), 11 (routes `/ai/citations`, `/ai/citations/gaps`) |
| 3.1 Query keys, defaults, old-key migration | C 40 to 66 | 3 |
| 3.1 Leaving the page | C 720 to 724 | 3 (Next.js drops the query), 13 (e2e) |
| 3.1 Inspector targets (`cited-page`, `gap-prompt`, `prompt` in place, shared link) | C 730 to 733; I 336 to 375 | 10 (types, page drawer), 11 (gap drawer, prompt in place) |
| 3.2 Platform select | C 114; aiov-controls.js 52 to 127 | 4 |
| 3.2 Group select (searchable) | C 115 | 4 (Open point 10) |
| 3.2 Runs select and notes | C 116 | 3 (notes), 4 |
| 3.2 Competitors trigger | C 119 to 140 | 4 |
| 3.2 Competitors popover | C 142 to 173 | 4 |
| 3.2 Reset | C 175 to 181, 696 to 698 | 4 |
| 3.2 Layout (grid below lg, row from lg) | C 183 to 186 | 4 |
| 3.2 Export | C 190 to 195 | 4 (button), 8 (CSV), 11 (wiring) |
| 3.3 Strip container (dl, container query columns, 1 px gaps, one 36 px line, focusable figure, tooltip order) | C 203 to 242 | 5 |
| 3.3 Total citations | C 250 | 5 |
| 3.3 Citation rate | C 246 to 247, 251 | 5 |
| 3.3 Prompt coverage | C 252 | 5 |
| 3.3 Unique cited URLs | C 253 | 5 |
| 3.3 Unique cited domains | C 254 | 5 |
| 3.3 Citation growth | C 248, 255 | 5 |
| 3.3 INFO texts and `<previous text>` | C 99 to 104, 210 to 217 | 3 (messages, `previousText`), 5 |
| 3.4 Segmented tabs and the gap count badge | C 263 to 285, 704 | 6, 11 |
| 3.4 Divider, search, controls, summary | C 291 to 316 | 6 |
| 3.4 Counted nouns (`plural()`) | prompts-parts.js 16 | 3 (ICU plurals) |
| 3.4 Panel at least 384 px; 48 px footer with count and Updated | C 291, 327 to 329, 189 | 6, 8 (`updatedText`) |
| 3.4 Empty states replace the table | C 381 to 394 | 6 (`EmptyState variant="table"`) |
| 3.5 Owner filter with counts; owner change resets the sort | C 545 to 558 | 8 |
| 3.5 Footer "N pages · M citations" | C 561 | 8 |
| 3.5 Column Page (path, host, tooltip, New) | C 464, 478 to 490 | 7 |
| 3.5 Column Domain type | C 465, 491 to 497 | 7 |
| 3.5 Column Citations | C 466, 498 | 7 |
| 3.5 Column Change | C 467, 499 to 501 | 7 |
| 3.5 Column Prompts (count, top prompt, chip) | C 468, 503 to 520 | 7, 8 (popover) |
| 3.5 Column Platforms | C 469, 522 to 533 | 7 (Open point 5) |
| 3.5 Column Trend | C 470, 535 to 538 | 7 |
| 3.5 Column Last cited | C 471, 539 | 7 |
| 3.5 Default sort and ties | C 32, 451 to 456 | 7 (API sort), 2 (mock ties) |
| 3.5 Prompts popover | C 416 to 444 | 8 |
| 3.5 Owner nouns and the accepted copy change | C 26 to 31, 567 | 3, 8 |
| 3.5 Empty states | C 563 to 569 | 8 |
| 3.6 Only gaps, summary, footer | C 668 to 679 | 9 |
| 3.6 Columns Prompt, Group, you, competitors, Lost on | C 623 to 663 | 9 |
| 3.6 The mark (statePill) and its tooltip | C 578 to 606 | 9 |
| 3.6 Sorts | C 613 to 620 | 9 |
| 3.6 Empty states | C 681 to 684 | 9 |
| 3.7 Page drawer header | I 74 to 83 | 10 |
| 3.7 Prompts tab | I 85 to 127 | 10 |
| 3.7 Overview: Summary, address, copy, open | I 129 to 163 | 10 |
| 3.7 Overview: Citations per run | I 165 to 169 | 10 |
| 3.7 Overview: By platform | I 171 to 180 | 10 |
| 3.7 Overview: Cited alongside | I 182 to 205 | 10 |
| 3.8 Gap drawer header | I 240 to 247 | 11 |
| 3.8 Gap tab: Who is cited, Open answers | I 250 to 276 | 11 |
| 3.8 Gap tab: competitor pages, closest page, third-party pages | I 218 to 238, 277 to 304 | 11 |
| 3.8 By platform | I 306 to 330 | 11 |
| 3.9 Widths 375, 768, 1024, 1440; light and dark; drawer docked and closed | | 13 |
| 3.9 Phone: two column scope, reset hidden, panel keeps 384 px, page scrolls, summary wraps | C 183, 291, 675, 696 to 698 | 4, 6, 9, 13 |
| 3.9 Row button "Open ..."; row click except on a cell action | C 396 to 408 | 6 |
| 3.9 `/` focuses search | C 305 to 310 | 6 |
| 3.9 Escape closes popovers and returns focus | aiov-controls.js 117 to 123 | 4, 8 (house `Popover`), 13 (e2e) |
| 3.9 Pinned corner header above the other headers and pinned cells | C 334 to 338 | 6 |

## Open points

Each one is where the brief and the preview disagree, where the generated API or the house rules cannot give what the preview shows, or where the brief's leases fall short. The section 2 decisions are not reopened. A proposed resolution is what the plan builds unless the owner says otherwise.

1. **A new house table, not `DataTable`.** House rule 7 says records are a `DataTable`. The preview's table differs from it in six ways (Task 6, "Why a new house table"). Proposed: `BoardTable` in `components/app/table/`, documented in `12-tables.md` section 20 as the table of analysis boards (compare and open, no selection), with its own specimen; `DataTable` stays the table for record lists. Needs the owner's or the design system owner's yes, since it adds a table pattern.
2. **Route tabs semantics.** The preview draws the two tabs as `role="tablist"` links with `aria-selected` (C 264 to 278); the brief calls it "a segmented tablist". Each tab is a route, which the house draws as `TabNav` (a `nav` of links with `aria-current="page"`, inventory 3.39), because a tablist promises arrow keys between panels of one page. Proposed: the house semantics with the preview's look and name ("Citations views"); the count badge keeps its hidden ", N gaps".
3. **Colour of the rate deltas.** The preview's `trendIcon` colours every change that does not round to zero (prompts-parts.js lines 29 to 30); the brief (3.3) and house rule 6 colour only a detectable change. The preview wins over the brief, but not over rule 6. Proposed: tone only when `isDetectableChange` (the icon's shape still shows up or down, and its words say "within normal variation"); the owner confirms.
4. **Names under mocks.** The fixture is the preview's CRM world (Northwind, HubSpot and four more, 13 topics); the mock projects are SEO agencies (Fynix: five competitors, six topic terms). Proposed: the mock model maps by position onto the requesting project (own host, competitor `i`, topic `i mod T`), so every count, and the `expected` block, holds, and the side by side review lists the names, domains and group labels as expected differences. A project with no topic terms shows D-10's "No group" under mocks. The fixture's 250 prompts have synthetic ids (`0192d1a8-c177-7000-8000-...`) the mock prompt world does not have, so under mocks "Open its answers" and "Open answers" open a prompt inspector that finds no prompt (its own not-found state); the e2e does not walk into it, and against the dev API the ids are real. The alternative, a sixth mock project seeded with the preview world, touches `MOCK_PROJECTS` and the entity and prompt fixtures that many tests pin; not proposed.
5. **Engine marks without visible names.** The preview's Platforms column, Lost on column, prompt rows and page lists show engine logos alone with the names in tooltips (C 528, 658; I 101, 230). The house `EngineLogo` never shows a mark without its name (07-icons section 5). Proposed: `EngineLogo nameDisplay="visually-hidden"` (the name stays for screen readers, the tooltip shows it), documented in 07 section 5 for columns that repeat the engine on every row. Needs the design system owner's yes.
6. **The prompt inspector in place needs a lease on `features/prompts`.** The brief's leases do not include it, and a feature may not import another. Proposed: `features/prompts/prompt-drawer-host.tsx` (a self-contained host of the existing `PromptInspector`) exported from `features/prompts/index.ts`, composed by the Citations route and handed to the screen as an element, with the J and K order through `lib/inspector/prompt-order.ts`. Its counts are the Prompts page's default 28 day window, not the runs window (the prompt inspector reads dates; the Citations page has none), and the answer viewer is not wired in place (the answer dates are plain text there). The prompts session or the owner grants the lease.
7. **A page drawer for a page the scope does not cite.** The preview closes the drawer when the page leaves the scope (I 352). A shared link or an Overview drill (`own-pages-card`, Task 12) can name a page the current runs do not cite (WP-76 answers 404). Proposed: the drawer stays and says "Not cited in this scope" with the scope text; the gap drawer does the same for a prompt with no answer.
8. **Two Overview drills lose their target, and Export's order.** The domain inspector and the New and lost tab are gone (D-5): a top domain row now opens Cited pages of its domain type, and the New and lost links open Cited pages. Proposed addition (one line in `CitationsTarget` and `citationsLink`): `q=<domain>` on the domain row, so the list shows that domain's pages. Separately, Export writes the rows in the default sort (citations, then Lost on), not a header sort the person chose, because the sort is the tab's own state (Open point 9); lifting the sort into the screen is two props if the owner wants the file in the table's order.
9. **Sort is not in the address.** The preview keeps the sort in memory (C 32, `pageSort` and `gapSort` are not written by `writeUrl`); house rule 15 keeps sort in the URL. Proposed: the preview's behaviour (a link reopens the default sort); the owner confirms, or the plan adds `sort` with the API's values and `gsort` for the gap table.
10. **The Group control.** The preview's searchable select is a listbox with a search field (aiov-controls.js 72 to 79) at `min-w-60`, with no empty text; topics are one flat level. The house `Combobox` (the pattern of the Prompts page's country control) has its own popup width, needs an empty text, a clear and an open label (app-only strings), and the project's topic terms can be nested. Proposed: `Combobox` with the terms depth first by name, no indentation; the owner says whether nested terms need their path.
11. **Tooltips inside a tooltip.** The preview gives the rate delta, the count delta and the New badge their own tooltips inside an element that has one (C 95, 233, 487). Two Base UI tooltips on nested triggers both open. Proposed: one tooltip with the inner text as its second line (`detail`), the same words in one hover; the e2e and the review check the words.
12. **App-only strings.** States the preview does not have need words: the load errors, the no-engine state, the Group combobox's empty, clear and open labels, the drawers' back labels, tab list names, not-found states, the CSV headers and toasts (Task 3 Step 1 lists the keys). Proposed as written there; the owner reviews them with the plan.
13. **Freshness time.** The preview prints a fixed "Updated Sep 28, 02:10 · run 48" (`RUNS.last`); the app prints the latest answer of the scope, which is 02:15 when Google AI Mode or Gemini answered last. Data, not layout; listed so the review does not count it.
14. **One text for an icon button's name and tooltip.** The preview's open button has the tooltip "Open the page" and the name "Open the page in a new tab" (I 159 to 161); `IconButton` uses one `label` for both. Proposed: the name for both; a `tooltip` override on `IconButton` is a one-prop change if the owner wants the preview's shorter tooltip.
15. **Inspector card titles.** The preview's drawer cards use the Overview's `cardFrame` (title in `type-section-title`, I 119 to 127); the house inspector card (`InspectorSection`, 16 section 2.4) titles in `type-subsection-title`. Proposed: the house type, with the preview's meta beside the title and its flush body (both added to `InspectorSection`).
16. **The layouts catalog keeps a `sources` screen.** `lib/layouts/catalog.ts` line 922 keys its screens by the API's `ResolvedLayout['screen']`, not the navigation registry; D-8 removes only the navigation entry. Proposed: leave it until WP-61 is re-scoped and the API drops the screen key.
17. **Leases the brief does not list.** Besides Open point 6: `src/mocks/respond.ts` (one problem code), `apps/web/.prettierignore` (the generated fixture), `e2e/flows/ai-overview-sources.spec.ts` (its Citations link cases change with Task 12), the four Overview cards that call `useCitationsDrill` (the brief says three; `activity/key-changes-card.tsx` is the fourth), and the house components and design-system documents of Tasks 4 to 10. The coordinator grants them before the tasks that need them.
18. **Fixture times.** The fixture's instants are the preview's run times in Europe/Berlin (Fynix's zone, the e2e project). A project in another zone shows other clock times under mocks; the counts do not change.
19. **Off-scale padding.** The preview's view tabs pad 10 px (`px-2.5`, C 275), which the spacing lint refuses (allowed steps 0, 0.5, 1, 1.5, 2, 3 ...). Proposed: `px-2`, the house segmented control's small padding; each tab is 4 px narrower than the preview's.

