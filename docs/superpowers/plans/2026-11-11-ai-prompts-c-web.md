# AI prompts, plan C: web screens for AI prompt tracking, slice 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web side of AI prompt tracking slice 1: mock handlers for every new route, the Engines section of project settings, the Topics & Prompts page (Topics and Prompts tabs), the Add prompts dialog, the prompt inspector with Run now, the answer viewer, the `ai_prompt` schedules, and the end to end flow.

**Architecture:** One feature folder, `apps/web/src/features/prompts`, holds the queries, the model, the screens and the dialogs; the routes `.../ai/prompts` and `.../settings/engines` render its two screens. Data comes from the generated client (`pnpm gen:api` after plans A and B are merged) through `apiQuery`, `apiMutation` and `useInfiniteQuery`, as in `features/operations`. Mocks follow `src/mocks/handlers/*.ts` with typed `mock()` handlers and an in-memory state module reset by `onMockReset`, as the keyword import mock does.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, TanStack Query 5, nuqs, react-hook-form with zod, next-intl, Base UI primitives in `src/components/ui`, MSW 2, Vitest with Testing Library and vitest-axe, Playwright with axe.

Spec: `docs/superpowers/specs/2026-11-11-ai-prompt-tracking-slice-1-design.md` sections 4.5, 4.6, 4.7. Contracts: plan A `docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md` (prompts and engines) and plan B `docs/superpowers/plans/2026-11-11-ai-prompts-b-collection-and-extraction.md` (run now, answers, prompts summary).

Work in the worktree `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-prompts` on branch `ai/prompts-slice1`. Paths below are relative to it. Every web command runs in `apps/web`:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-prompts/apps/web
```

**The gate at the end of every task** (each must print what is shown; fix and run again until it does). Run `pnpm format` first so Prettier settles the wrapping.

```bash
pnpm format
pnpm lint            # no output after the command line, exit code 0
pnpm typecheck       # no output after "tsc --noEmit", exit code 0
pnpm test            # "Test Files  N passed (N)"
pnpm format:check    # "All matched files use Prettier code style!"
```

Tasks that add a route or change the navigation also run `pnpm build` (expected last line: the route table, with `ƒ /[workspace]/[project]/ai/prompts` once task 4 is done). Task 11 also runs `pnpm e2e`.

Other sessions' files may be uncommitted in this worktree. Never stage them: every commit below names its files.

---

## Rules every task follows

- **Read `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md` at the repository root** before the first UI task. Use only the components in `apps/web/src/components/ui` and `apps/web/src/components/app`, token classes (`bg-surface`, `text-foreground-secondary`, ...), the `type-*` utilities, the spacing scale, and `@/lib/format` for every number and date. No hex colors, no arbitrary values (`p-[13px]`), no `Intl.*`, no `toFixed` in components, no new fonts, no em-dashes or en-dashes anywhere.
- **Every visible string goes through `apps/web/messages/en.json`** with `useTranslations`. Keys are camelCase; a message has no dash used as punctuation, no `!`, no straight double quotes (use “ ”), no contraction of "not" ("cannot", "does not"), no double space. `src/i18n/messages.test.ts` enforces this. ICU treats a straight apostrophe `'` as an escape: write `’` where an apostrophe is needed.
- **Features never import each other** (eslint `boundaries`). Routes import features; features import `@/components/*` and `@/lib/*`.
- **State in the URL** with `nuqs` (`useQueryStates`, `history: 'replace'`), as `features/operations/runs-screen.tsx` does.
- The words below in the "Names" section are the contract between tasks: use them exactly.

## What this plan found that differs from the brief

- **Offsets.** Plan B's detail route converts the stored code point offsets to UTF-16 code units before it answers (`offsets_unit: 'utf16'`, B task 8 `_utf16`). The web therefore must not convert again. Task 9's unit-tested function cuts `answer_text` at the API's UTF-16 spans and refuses a span that falls outside the text, overlaps an earlier one, or would split a surrogate pair; its tests use emoji and Hindi text.
- **Lint has no duplicate rule.** Plan A's `POST {P}/prompts/lint` checks two rules only (`contains_brand_alias`, `engine_limit`) and returns the workspace quota. The Add prompts dialog finds repeated lines and prompts the project already tracks in the browser (same text after trim and NFC, same language and country, as plan A decision A2 defines a duplicate), and `bulk-create` with `on_duplicate: 'skip'` has the last word.
- **No separate route loading or error files.** The project shell's `app/[workspace]/[project]/loading.tsx` and `error.tsx` already serve every project page, `seo/keywords` included; the new page adds none.
- **Task order.** The navigation entry and the route page move into task 4, together with the screen they open, so no task leaves a link to a page that does not render. The Topics tab and the tab bar arrive in task 6 (the Topics tab is the default from then on). That makes 11 tasks instead of 12.
- **Mocks keep their state in memory**, like `src/mocks/handlers/keyword-imports.ts`, not in a cookie like `operations-state.ts`: 150 prompts and their answers do not fit a cookie, and no server component reads prompts. A page reload starts from the fixtures again; the e2e flow moves between pages by clicking links.
- **Countries.** The feature needs the list of countries that `features/rankings` already reads; features cannot import each other, so task 2 moves `readCountries` to `src/lib/locations/countries.ts` and the rankings feature re-exports it.
- **Engines screen location.** The Engines section's queries are the prompt feature's, so the screen lives in `features/prompts` and `app/[workspace]/[project]/settings/engines/page.tsx` imports it from `@/features/prompts` (not `@/features/project-settings`).

## Names

```text
apps/web/src/lib/api/types.ts (added)
  EngineCode, ProjectEngine, Prompt, PromptLint, PromptBulkResult, ObservationSummary, ObservationDetail,
  CitationOut, MentionOut, MetricCell, EngineSummary, PromptSummaryRow, TopicSummaryRow, PromptsSummary

apps/web/src/lib/locations/countries.ts
  type Country; readCountries(signal): Promise<Country[]>; COUNTRIES_KEY; useCountries(): CountryList

apps/web/src/mocks/prompt-fixtures.ts
  ENGINE_CODES, ENGINE_FACTS, PROMPT_QUOTA (150), PROMPT_TEXT_MAX (2000), monthlyCostUsd(prompts)
  StoredPrompt, StoredEngine, FIXTURE_PROMPTS, FIXTURE_ENGINES, runInstants(now), answerOf(...)
apps/web/src/mocks/prompts-state.ts
  promptsOf(projectId), activePromptCount(projectIds), mintPromptNumber(), PENDING_MS
apps/web/src/mocks/handlers/prompts.ts
  promptHandlers

apps/web/src/features/prompts/prompt-queries.ts
  PromptScope, promptsKey, aiKey, enginesKey, refreshPrompts, enginesQuery, PUT_ENGINE, summaryQuery,
  usePromptList, promptQuery, observationsQuery, observationQuery, rawAnswerPath, projectEntitiesQuery,
  usePromptLint, BULK_CREATE_PROMPTS, UPDATE_PROMPT, ARCHIVE_PROMPT, RUN_NOW
apps/web/src/features/prompts/prompt-model.ts
  WINDOW_DAYS, DEFAULT_WINDOW, WindowDays, parseWindow, DateRange, windowRange, PROMPTS_TABS, PromptsTab,
  parseTab, countText, topicTermsOf, hasAnswers, readPromptLines, PromptLine, promptKeyOf, fitsEngine,
  countriesForEngines, BULK_MAX
apps/web/src/features/prompts/answer-segments.ts
  AnswerSegment, answerSegments(text, mentions)
apps/web/src/features/prompts/*.tsx
  EnginesScreen, PromptsScreen, usePromptColumns, PromptRow, TopicsTable, AddPromptsDialog,
  PromptInspector, AnswerInspector
apps/web/messages/en.json
  aiEngines.*, prompts.*, settings.items.engines, projectSettings.schedules.selector.allPrompts
```

## File map

| File | Task | What it holds |
|---|---|---|
| `apps/web/src/lib/api/schema.ts`, `apps/web/src/lib/api/types.ts` | 1 | Regenerated client, type aliases |
| `apps/web/src/mocks/mock-ids.ts` | 1 | `prompt` id kind |
| `apps/web/src/mocks/prompt-fixtures.ts`, `prompts-state.ts` | 1 | Engines, prompts, answers, in-memory state |
| `apps/web/src/mocks/handlers/prompts.ts`, `prompts.test.ts`, `index.ts` | 1 | Handlers for all 11 routes and their tests |
| `apps/web/src/lib/locations/countries.ts`, `features/rankings/keyword-filters.ts` | 2 | Shared country list |
| `apps/web/src/features/prompts/prompt-queries.ts`, `prompt-model.ts`, `prompt-model.test.ts`, `index.ts` | 2 | Queries and pure model |
| `apps/web/src/features/prompts/engines-screen.tsx`, `engines.test.tsx`, `app/.../settings/engines/page.tsx`, `features/settings/settings-frame.tsx` (+ test) | 3 | Engines section |
| `apps/web/src/lib/navigation/registry.ts` (+ test), `app/.../ai/prompts/page.tsx` (+ test), `features/prompts/prompts-screen.tsx`, `prompt-columns.tsx`, `prompts.test.tsx` | 4, 5 | Page, shell and Prompts tab |
| `apps/web/src/features/prompts/topics-table.tsx` | 6 | Topics tab |
| `apps/web/src/features/prompts/add-prompts-dialog.tsx`, `add-prompts.test.tsx` | 7 | Add prompts |
| `apps/web/src/features/prompts/prompt-inspector.tsx`, `prompt-inspector.test.tsx` | 8 | Prompt inspector |
| `apps/web/src/features/prompts/answer-segments.ts` (+ test), `answer-inspector.tsx`, `answer.test.tsx` | 9 | Answer viewer |
| `apps/web/src/features/project-settings/schedules-screen.tsx`, `schedules.test.tsx` | 10 | `ai_prompt` schedules |
| `apps/web/e2e/flows/ai-prompts.spec.ts`, `docs/20-frontend-specification.md` | 11 | Flow, axe, As built |

---

### Task 1: Regenerate the client and mock every new route

**Read first:**
- `apps/web/src/mocks/respond.ts` (`mock`, `problem`, `invalid`, `noContent`, the `PROBLEMS` table)
- `apps/web/src/mocks/handlers/access.ts` (`projectCaller`, the order of checks)
- `apps/web/src/mocks/handlers/rules.ts` (`bodyError`, `queryError`, `extraMembers`, `pageRequest`, `cursorPage`, `isOneOf`)
- `apps/web/src/mocks/handlers/runs.ts` lines 1 to 100 (a handler module) and `apps/web/src/mocks/handlers/runs.test.ts` lines 1 to 60 (`mockBrowser`, `dataOf`, `fieldCodes`)
- `apps/web/src/mocks/handlers/keyword-imports.ts` lines 180 to 190 and 1290 to 1296 (state in memory, `onMockReset`)
- Plan A task 5 (`backend/src/idraft/api/schemas/ai.py`, prompt and engine models) and plan B tasks 7 to 9 (`RunNow`, `ObservationSummary`, `ObservationDetail`, `CitationOut`, `MentionOut`, `MetricCell`, `EngineSummary`, `PromptSummaryRow`, `TopicSummaryRow`, `PromptsSummary`, their routes and error codes)

**Files:**
- Modify: `apps/web/src/lib/api/schema.ts` (generated), `apps/web/src/lib/api/types.ts`
- Modify: `apps/web/src/mocks/mock-ids.ts`
- Create: `apps/web/src/mocks/prompt-fixtures.ts`, `apps/web/src/mocks/prompts-state.ts`, `apps/web/src/mocks/handlers/prompts.ts`
- Modify: `apps/web/src/mocks/handlers/index.ts`
- Test: `apps/web/src/mocks/handlers/prompts.test.ts`

- [ ] **Step 1: Check that plans A and B are in the branch, then regenerate the client**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-prompts
grep -c '"/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary"' backend/openapi/v1.json
grep -c '"/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}/run-now"' backend/openapi/v1.json
cd apps/web && pnpm gen:api
```

Expected: `1`, `1`, then openapi-typescript prints `✨ openapi-typescript` and the output path `src/lib/api/schema.ts`. If either count is `0`, plans A and B are not merged into this branch yet: stop and report it.

Then check that the component names this plan uses exist:

```bash
for name in EngineCode ProjectEngine ProjectEngineList Prompt PromptPage PromptLint PromptLintResponse PromptBulkResult ObservationSummary ObservationPage ObservationDetail CitationOut MentionOut MetricCell EngineSummary PromptSummaryRow TopicSummaryRow PromptsSummary RunNow; do
  printf '%s ' "$name"; grep -c "^        $name: {\|^        $name: \"" src/lib/api/schema.ts
done
```

Expected: every name followed by `1`. A `0` means Pydantic named the component differently (for example `Prompt-Output`): use the generated name in Step 2 and wherever this plan writes the alias, and say so in the commit message.

- [ ] **Step 2: Name the new schemas**

Append to `apps/web/src/lib/api/types.ts`, before the line `/** Runtime lists from the OpenAPI enums: ...`:

```ts
// AI prompt tracking, slice 1 (plans A and B of 2026-11-11): engines, prompts, answers and the summary
export type EngineCode = Schemas['EngineCode'];
export type ProjectEngine = Schemas['ProjectEngine'];
export type Prompt = Schemas['Prompt'];
export type PromptLint = Schemas['PromptLint'];
export type PromptBulkResult = Schemas['PromptBulkResult'];
export type ObservationSummary = Schemas['ObservationSummary'];
export type ObservationDetail = Schemas['ObservationDetail'];
export type CitationOut = Schemas['CitationOut'];
export type MentionOut = Schemas['MentionOut'];
export type MetricCell = Schemas['MetricCell'];
export type EngineSummary = Schemas['EngineSummary'];
export type PromptSummaryRow = Schemas['PromptSummaryRow'];
export type TopicSummaryRow = Schemas['TopicSummaryRow'];
export type PromptsSummary = Schemas['PromptsSummary'];
```

- [ ] **Step 3: Give prompts a mock id kind**

In `apps/web/src/mocks/mock-ids.ts`, add `| 'prompt'` as the last member of `IdKind` (after `| 'integration'`), and add to `KIND_DIGIT` after `integration: 'f',`:

```ts
  // The last hexadecimal digit left; a prompt's version takes the prompt's number plus 500,000
  prompt: '0',
```

- [ ] **Step 4: Write the failing handler tests**

Create `apps/web/src/mocks/handlers/prompts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '../prompt-fixtures';
import { dataOf, fieldCodes, mockBrowser, pageOf } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');

const ENGINE = z.object({
  engine: z.object({ engine_code: z.string(), label: z.string(), max_prompt_chars: z.number() }),
  is_configured: z.boolean(),
  is_enabled: z.boolean(),
  location_ids: z.array(z.number()),
  active_prompts: z.number(),
  estimated_monthly_cost_usd: z.string().nullable(),
});
const PROMPT = z.object({
  prompt_id: z.string(),
  current_version: z.object({ text: z.string(), version_no: z.number() }),
  country_iso: z.string().nullable(),
  is_branded: z.boolean(),
  is_active: z.boolean(),
  terms: z.array(z.object({ term_id: z.string(), name: z.string() })),
});
const PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });
const CELL = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
});
const ENGINE_SUMMARY = z.object({ engine_code: z.string(), mentioned: CELL, cited: CELL, share_of_voice: CELL });
const SUMMARY = z.object({
  window: z.object({ from: z.string(), to: z.string() }),
  include_branded: z.boolean(),
  engine_codes: z.array(z.string()),
  prompts: z.array(z.object({ prompt_id: z.string(), is_branded: z.boolean(), engines: z.array(ENGINE_SUMMARY) })),
  topics: z.array(z.object({ term_id: z.string().nullable(), prompt_count: z.number(), engines: z.array(ENGINE_SUMMARY) })),
});
const OBSERVATION = z.object({
  observation_id: z.string(),
  engine_code: z.string(),
  status: z.enum(['complete', 'partial', 'empty', 'refused', 'error']),
  subject: z.object({ prompt_id: z.string() }),
  facts: z.object({ is_valid: z.boolean(), outcome: z.string() }).nullable(),
});
const DETAIL = OBSERVATION.extend({
  answer_text: z.string().nullable(),
  offsets_unit: z.literal('utf16'),
  mentions: z.array(z.object({ name: z.string(), role: z.string(), evidence_spans: z.array(z.tuple([z.number(), z.number()])) })),
  citations: z.array(z.object({ url: z.string(), domain_role: z.enum(['own', 'competitor', 'third_party']) })),
});
const BULK = z.object({
  created: z.array(z.string()),
  skipped: z.array(z.object({ index: z.number(), existing_id: z.string() })),
  rejected: z.array(z.object({ index: z.number(), code: z.string() })),
});
const LINT = z.array(
  z.object({
    is_branded: z.boolean(),
    warnings: z.array(z.object({ rule: z.string(), severity: z.string(), engine_code: z.string().nullable() })),
  }),
);
const QUOTA = z.object({ limit: z.number(), used: z.number() });

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const item = (text: string, country = 'DE'): Record<string, string> => ({ text, language_code: 'en', country_iso: country });

describe('engines', () => {
  it('lists the three engines, Fynix with ChatGPT and Gemini on and a monthly cost for each', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${FYNIX}/engines`);
    const engines = dataOf(answer, z.array(ENGINE));
    expect(engines.map((engine) => [engine.engine.engine_code, engine.is_enabled])).toEqual([
      ['chatgpt_web', true],
      ['gemini_web', true],
      ['google_ai_mode', false],
    ]);
    // 24 prompts, twice a week, at $0.0012: 24 x 2 x 0.0012 x 52 / 12 = $0.25
    expect(engines[0]).toMatchObject({ active_prompts: 24, estimated_monthly_cost_usd: '0.250000' });
  });

  it('turns an engine on with its countries for an editor, and refuses a viewer and an unknown country', async () => {
    const editor = mockBrowser('editor');
    const on = await editor.call('PUT', `${CLEANSTART}/engines/chatgpt_web`, { location_ids: [2840] });
    expect(on.status).toBe(200);
    expect(dataOf(on, ENGINE)).toMatchObject({ is_configured: true, is_enabled: true, location_ids: [2840] });
    expect((await editor.as('viewer').call('PUT', `${CLEANSTART}/engines/gemini_web`, { location_ids: [2840] })).code).toBe(
      'forbidden',
    );
    const unknown = await editor.call('PUT', `${CLEANSTART}/engines/gemini_web`, { location_ids: [1023191] });
    expect(fieldCodes(unknown)).toEqual(['location_ids.0:location_not_supported']);
    expect(fieldCodes(await editor.call('PUT', `${CLEANSTART}/engines/gemini_web`, { location_ids: [] }))).toEqual([
      'location_ids:too_short',
    ]);
  });
});

describe('prompts', () => {
  it('lists the active prompts newest first in cursor pages', async () => {
    const viewer = mockBrowser('viewer');
    const first = await viewer.call('GET', `${FYNIX}/prompts?limit=10`);
    expect(dataOf(first, z.array(PROMPT))).toHaveLength(10);
    const page = pageOf(first, PAGE);
    expect(page.has_more).toBe(true);
    const second = await viewer.call('GET', `${FYNIX}/prompts?limit=10&cursor=${page.next_cursor ?? ''}`);
    expect(dataOf(second, z.array(PROMPT))).toHaveLength(10);
    // A cursor is bound to its filters
    const other = await viewer.call('GET', `${FYNIX}/prompts?limit=10&filter[q]=seo&cursor=${page.next_cursor ?? ''}`);
    expect(other.status).toBe(400);
    expect(other.code).toBe('invalid_cursor');
    const all = await viewer.call('GET', `${FYNIX}/prompts?limit=200`);
    const prompts = dataOf(all, z.array(PROMPT));
    expect(prompts).toHaveLength(24);
    expect(prompts.filter((prompt) => prompt.is_branded).map((prompt) => prompt.current_version.text)).toEqual([
      'Is Fynix a good SEO agency for software companies?',
    ]);
  });

  it('adds one prompt, refuses a duplicate with its id and a country no enabled engine runs in', async () => {
    const editor = mockBrowser('editor');
    const added = await editor.call('POST', `${FYNIX}/prompts`, item('Which agency audits shop sites in Munich?'));
    expect(added.status).toBe(201);
    const prompt = dataOf(added, PROMPT);
    const again = await editor.call('POST', `${FYNIX}/prompts`, item('  Which agency audits shop sites in Munich?  '));
    expect(again.status).toBe(409);
    expect(again.body.existing_id).toBe(prompt.prompt_id);
    expect(fieldCodes(await editor.call('POST', `${FYNIX}/prompts`, item('Which agency works in Paris?', 'FR')))).toEqual([
      'country_iso:location_not_supported',
    ]);
    expect(fieldCodes(await editor.call('POST', `${FYNIX}/prompts`, item('x'.repeat(2001))))).toEqual([
      'text:prompt_too_long',
    ]);
    expect((await editor.as('viewer').call('POST', `${FYNIX}/prompts`, item('Who audits?'))).code).toBe('forbidden');
  });

  it('bulk-creates to the 150 prompt limit, skips what is tracked, rejects what cannot be saved', async () => {
    const editor = mockBrowser('editor');
    const tracked = FIXTURE_PROMPTS.get(fynix.project_id)?.[0]?.text ?? '';
    const room = PROMPT_QUOTA - 24;
    const items = [
      item(tracked),
      item('Which agency works in Paris?', 'FR'),
      item('Same line twice?'),
      item('Same line twice?'),
      ...Array.from({ length: room - 1 }, (_, n) => item(`Which SEO agency suits a team of ${String(n + 2)} people?`)),
    ];
    const answer = await editor.call('POST', `${FYNIX}/prompts/bulk-create`, { items });
    const result = dataOf(answer, BULK);
    expect(result.created).toHaveLength(room);
    expect(result.skipped.map((entry) => entry.index)).toEqual([0]);
    expect(result.rejected.map((entry) => [entry.index, entry.code])).toEqual([
      [1, 'location_not_supported'],
      [3, 'duplicate_in_request'],
    ]);
    const over = await editor.call('POST', `${FYNIX}/prompts/bulk-create`, { items: [item('One more question?')] });
    expect(over.status).toBe(422);
    expect(over.code).toBe('quota_exceeded');
    expect(over.body).toMatchObject({ limit: PROMPT_QUOTA, used: PROMPT_QUOTA, requested: 1 });
  });

  it('lints each text for an own brand and for each engine’s length, and gives the quota', async () => {
    const answer = await mockBrowser('viewer').call('POST', `${FYNIX}/prompts/lint`, {
      texts: ['Is Fynix any good?', 'x'.repeat(800)],
    });
    const lints = dataOf(answer, LINT);
    expect(lints[0]).toMatchObject({ is_branded: true, warnings: [{ rule: 'contains_brand_alias', severity: 'info' }] });
    expect(lints[1]?.warnings).toEqual([
      expect.objectContaining({ rule: 'engine_limit', severity: 'warning', engine_code: 'google_ai_mode' }),
    ]);
    expect(QUOTA.parse(answer.body.quota)).toEqual({ limit: PROMPT_QUOTA, used: 24 });
  });

  it('archives a prompt and brings it back', async () => {
    const editor = mockBrowser('editor');
    const id = FIXTURE_PROMPTS.get(fynix.project_id)?.[1]?.prompt_id ?? '';
    expect((await editor.call('DELETE', `${FYNIX}/prompts/${id}`)).status).toBe(204);
    expect(dataOf(await editor.call('GET', `${FYNIX}/prompts/${id}`), PROMPT).is_active).toBe(false);
    const back = await editor.call('PATCH', `${FYNIX}/prompts/${id}`, { is_active: true });
    expect(dataOf(back, PROMPT).is_active).toBe(true);
    expect(fieldCodes(await editor.call('PATCH', `${FYNIX}/prompts/${id}`, { text: 'New?' }))).toEqual([
      'text:immutable_field',
    ]);
  });
});

describe('run now', () => {
  it('queues a manual run, then says the answer is on its way, and refuses an engine that is off', async () => {
    const analyst = mockBrowser('analyst');
    const id = FIXTURE_PROMPTS.get(fynix.project_id)?.[2]?.prompt_id ?? '';
    const run = await analyst.call('POST', `${FYNIX}/prompts/${id}/run-now`, { engine_codes: ['chatgpt_web'] });
    expect(run.status).toBe(202);
    expect(run.body.data).toMatchObject({ workload: 'ai_prompt', trigger: 'manual', status: 'planned' });
    const again = await analyst.call('POST', `${FYNIX}/prompts/${id}/run-now`, { engine_codes: ['chatgpt_web'] });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'check_pending', engine_codes: ['chatgpt_web'] });
    const off = await analyst.call('POST', `${FYNIX}/prompts/${id}/run-now`, { engine_codes: ['google_ai_mode'] });
    expect(fieldCodes(off)).toEqual(['engine_codes:engine_not_enabled']);
    expect((await analyst.as('viewer').call('POST', `${FYNIX}/prompts/${id}/run-now`, { engine_codes: ['gemini_web'] })).code).toBe(
      'forbidden',
    );
  });
});

describe('answers', () => {
  it('lists a prompt’s answers newest first, with refused, empty and failed ones among them', async () => {
    const viewer = mockBrowser('viewer');
    const statuses = new Set<string>();
    for (const prompt of FIXTURE_PROMPTS.get(fynix.project_id) ?? []) {
      const answer = await viewer.call(
        'GET',
        `${FYNIX}/ai/observations?filter[prompt_id]=${prompt.prompt_id}&from=2026-08-14&to=2026-11-12&limit=200`,
      );
      for (const observation of dataOf(answer, z.array(OBSERVATION))) {
        statuses.add(observation.status);
        expect(observation.subject.prompt_id).toBe(prompt.prompt_id);
      }
    }
    expect([...statuses].sort()).toEqual(['complete', 'empty', 'error', 'partial', 'refused']);
    const first = await viewer.call('GET', `${FYNIX}/ai/observations?limit=5`);
    const rows = dataOf(first, z.array(OBSERVATION));
    expect(rows).toHaveLength(5);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations?from=2026-01-01&to=2026-11-12`))).toEqual([
      'from:window_too_large',
    ]);
  });

  it('reads one answer with its mentions as UTF-16 spans into the text and its sources with their roles', async () => {
    const viewer = mockBrowser('viewer');
    const list = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations?limit=200`), z.array(OBSERVATION));
    const valid = list.find((row) => row.facts?.is_valid === true && row.facts.outcome === 'mentioned_and_cited');
    if (valid === undefined) throw new Error('No mentioned and cited answer in the fixtures');
    const detail = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${valid.observation_id}`), DETAIL);
    const own = detail.mentions.find((mention) => mention.role === 'own');
    const [start, end] = own?.evidence_spans[0] ?? [0, 0];
    expect(detail.answer_text?.slice(start, end)).toBe('Fynix');
    expect(detail.citations.map((citation) => citation.domain_role)).toContain('own');
    expect(detail.citations.map((citation) => citation.domain_role)).toContain('third_party');
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/${valid.observation_id}/raw`)).code).toBe('forbidden');
    expect((await viewer.as('analyst').call('GET', `${FYNIX}/ai/observations/${valid.observation_id}/raw`)).status).toBe(
      200,
    );
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/9`)).code).toBe('not_found');
  });
});

describe('prompts summary', () => {
  it('counts each prompt’s valid answers per enabled engine over 28 days, branded prompts left out', async () => {
    const viewer = mockBrowser('viewer');
    const summary = dataOf(await viewer.call('GET', `${FYNIX}/ai/prompts-summary`), SUMMARY);
    expect(summary).toMatchObject({ include_branded: false, engine_codes: ['chatgpt_web', 'gemini_web'] });
    expect(summary.window).toEqual({ from: '2026-10-16', to: '2026-11-12' });
    expect(summary.prompts).toHaveLength(23);
    for (const row of summary.prompts) {
      for (const cell of row.engines) {
        // Eight runs in 28 days (four Mondays, four Thursdays); invalid answers leave the denominator
        expect(cell.mentioned.n_observations).toBe(8);
        expect(cell.mentioned.denominator).toBeLessThanOrEqual(8);
        expect(cell.mentioned.numerator).toBeLessThanOrEqual(cell.mentioned.denominator);
      }
    }
    expect(summary.topics.map((topic) => topic.term_id === null)).toContain(true);
    const branded = dataOf(await viewer.call('GET', `${FYNIX}/ai/prompts-summary?include_branded=true`), SUMMARY);
    expect(branded.prompts).toHaveLength(24);
  });

  it('answers with zero answers for a project whose prompts were never asked', async () => {
    const editor = mockBrowser('editor');
    await editor.call('PUT', `${CLEANSTART}/engines/chatgpt_web`, { location_ids: [2840] });
    await editor.call('POST', `${CLEANSTART}/prompts`, item('Which cleaning service is best in Boston?', 'US'));
    const summary = dataOf(await editor.call('GET', `${CLEANSTART}/ai/prompts-summary`), SUMMARY);
    expect(summary.prompts[0]?.engines[0]?.mentioned).toEqual({ value: null, numerator: 0, denominator: 0, n_observations: 0 });
  });
});
```

- [ ] **Step 5: Run them to see them fail**

Run: `pnpm vitest run src/mocks/handlers/prompts.test.ts`
Expected: FAIL with `Failed to resolve import "../prompt-fixtures"`.

- [ ] **Step 6: Write the fixtures**

Create `apps/web/src/mocks/prompt-fixtures.ts`:

```ts
import { MOCK_ENTITY_IDS, MOCK_TERM_IDS } from './entity-fixtures';
import { usdOfMicros } from './factories/operations';
import { MOCK_CREATED_AT, MOCK_PROJECTS, mockUser } from './fixtures';
import { mockId } from './mock-ids';
import type { CitationOut, EngineCode, MentionOut, ObservationDetail, ProjectEngine } from '@/lib/api/types';

/**
 * The AI prompt tracking fixtures (spec 2026-11-11, plans A and B): the three engines, Fynix's engines and
 * 24 prompts, and the answers each fixture prompt got. Answers are made from the clock, on Monday and
 * Thursday at 02:00 UTC as the base plan runs them, so every window has some. A prompt added through the
 * mocks has none: in the app its answers come from the next run.
 */

export const ENGINE_CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const satisfies readonly EngineCode[];

/** The engine facts of plan A's `idraft.domain.ai_engines.ENGINES`. */
export const ENGINE_FACTS: Readonly<Record<EngineCode, ProjectEngine['engine']>> = {
  chatgpt_web: {
    engine_code: 'chatgpt_web',
    label: 'ChatGPT',
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: true,
    max_prompt_chars: 2000,
  },
  gemini_web: {
    engine_code: 'gemini_web',
    label: 'Gemini',
    observation_class: 'consumer_ui',
    vendor: 'google',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 2000,
  },
  google_ai_mode: {
    engine_code: 'google_ai_mode',
    label: 'Google AI Mode',
    observation_class: 'serp_ai',
    vendor: 'google',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 700,
  },
};

/** The base plan (spec section 4.7): 150 active prompts a workspace, asked twice a week. */
export const PROMPT_QUOTA = 150;
/** The longest prompt any engine takes (plan A `PROMPT_TEXT_MAX`). */
export const PROMPT_TEXT_MAX = 2000;
/** One answer on the standard queue: $0.0012, in micro dollars. */
const TASK_PRICE_MICROS = 1200;
const RUNS_PER_WEEK = 2;
const MICROS_PER_CENT = 10_000;

/** Plan A's `monthly_cost`: prompts x runs a week x 52 / 12 x the price, to the cent, as the API writes money. */
export const monthlyCostUsd = (prompts: number): string =>
  usdOfMicros(Math.round((prompts * RUNS_PER_WEEK * TASK_PRICE_MICROS * 52) / 12 / MICROS_PER_CENT) * MICROS_PER_CENT);

export interface StoredPrompt {
  prompt_id: string;
  version_id: string;
  project_id: string;
  /** Its place among the project's fixture prompts, which its answers are made from; `null` for one added here. */
  index: number | null;
  text: string;
  language_code: string;
  country_iso: string;
  term_ids: string[];
  importance: number;
  is_branded: boolean;
  is_active: boolean;
  created_at: string;
  created_by: { user_id: string; name: string; email: string } | null;
}

export interface StoredEngine {
  engine_code: EngineCode;
  is_enabled: boolean;
  location_ids: number[];
}

const VERSION_OFFSET = 500_000;
export const promptId = (n: number): string => mockId('prompt', n);
export const versionId = (n: number): string => mockId('prompt', VERSION_OFFSET + n);

const T = MOCK_TERM_IDS;
/** Text, topic, language and country. Line 5 is Hindi and line 7 names the own brand. */
const FYNIX_PROMPTS: readonly (readonly [string, string | null, string, string])[] = [
  ['Which SEO agency is best for a SaaS startup in Germany?', T.seo, 'en', 'DE'],
  ['How do I run a technical SEO audit on a large site?', T.technicalSeo, 'en', 'DE'],
  ['What does a local SEO agency do for a shop in Berlin?', T.localSeo, 'en', 'DE'],
  ['Which agencies write content strategies for B2B software?', T.contentMarketing, 'en', 'DE'],
  ['How often should a company blog publish new posts?', T.blogStrategy, 'en', 'DE'],
  ['भारत में सबसे अच्छी SEO एजेंसी कौन सी है?', T.seo, 'hi', 'IN'],
  ['What is the best way to manage paid search on a small budget?', T.paidSearch, 'en', 'DE'],
  ['Is Fynix a good SEO agency for software companies?', T.seo, 'en', 'DE'],
  ['How do I fix crawl errors that Google reports?', T.technicalSeo, 'en', 'DE'],
  ['Which tools track local rankings by city?', T.localSeo, 'en', 'DE'],
  ['How do I plan a content calendar for a year?', T.contentMarketing, 'en', 'DE'],
  ['What makes a blog post appear in AI answers?', T.blogStrategy, 'en', 'DE'],
  ['Should a startup hire an SEO agency or a freelancer?', T.seo, 'en', 'DE'],
  ['How long does a technical SEO migration take?', T.technicalSeo, 'en', 'DE'],
  ['How do reviews affect local search results?', T.localSeo, 'en', 'DE'],
  ['Which agencies measure content marketing results well?', T.contentMarketing, 'en', 'DE'],
  ['What is a good length for a B2B blog post?', T.blogStrategy, 'en', 'DE'],
  ['How do I lower the cost per click of search ads?', T.paidSearch, 'en', 'DE'],
  ['Which SEO agencies work with fintech companies?', T.seo, 'en', 'DE'],
  ['What is the difference between SEO and paid search?', null, 'en', 'DE'],
  ['How do I find the questions buyers ask AI assistants?', null, 'en', 'DE'],
  ['Which agency can audit Core Web Vitals?', T.technicalSeo, 'en', 'DE'],
  ['How do I get cited by ChatGPT for my product category?', T.contentMarketing, 'en', 'DE'],
  ['Which SEO agency in Europe has the best case studies?', T.seo, 'en', 'DE'],
];

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const owner = mockUser('owner');

export const FIXTURE_PROMPTS: ReadonlyMap<string, readonly StoredPrompt[]> = new Map([
  [
    fynix.project_id,
    FYNIX_PROMPTS.map(
      ([text, term, language, country], index): StoredPrompt => ({
        prompt_id: promptId(index + 1),
        version_id: versionId(index + 1),
        project_id: fynix.project_id,
        index,
        text,
        language_code: language,
        country_iso: country,
        term_ids: term === null ? [] : [term],
        importance: 3,
        is_branded: text.includes('Fynix'),
        is_active: true,
        created_at: MOCK_CREATED_AT,
        created_by: { user_id: owner.user_id, name: owner.name, email: owner.email },
      }),
    ),
  ],
]);

/** Fynix asks ChatGPT and Gemini in Germany and India; AI Mode is off. The other projects have no engine yet. */
export const FIXTURE_ENGINES: ReadonlyMap<string, readonly StoredEngine[]> = new Map([
  [
    fynix.project_id,
    [
      { engine_code: 'chatgpt_web', is_enabled: true, location_ids: [2276, 2356] },
      { engine_code: 'gemini_web', is_enabled: true, location_ids: [2276, 2356] },
    ],
  ],
]);

export const DAY_MS = 86_400_000;
/** Answers reach back as far as one request may ask (92 days, plan B). */
const HISTORY_DAYS = 92;
const RUN_OFFSET_MS = 2 * 3_600_000;
const RUN_WEEKDAYS: readonly number[] = [1, 4];

/** The run times of the last 92 days, newest first: Monday and Thursday at 02:00 UTC. */
export function runInstants(now: number): number[] {
  const today = Math.floor(now / DAY_MS);
  const runs: number[] = [];
  for (let day = today; day > today - HISTORY_DAYS; day -= 1) {
    const at = day * DAY_MS + RUN_OFFSET_MS;
    if (RUN_WEEKDAYS.includes(new Date(at).getUTCDay()) && at <= now) runs.push(at);
  }
  return runs;
}

/** An answer's id: its day, the prompt's place and the engine's, so the detail can be made again from it. */
export const observationIdOf = (day: number, index: number, engine: number): string =>
  String(day * 10_000 + index * 10 + engine);

export function parseObservationId(id: string): { day: number; index: number; engine: number } | null {
  if (!/^\d{6,15}$/.test(id)) return null;
  const value = Number(id);
  return { day: Math.floor(value / 10_000), index: Math.floor((value % 10_000) / 10), engine: value % 10 };
}

interface Named {
  entity_id: string;
  name: string;
  role: 'own' | 'competitor';
  sentence: string;
  url: string;
  host: string;
  title: string;
}

const OWN: Named = {
  entity_id: MOCK_ENTITY_IDS.fynix,
  name: 'Fynix',
  role: 'own',
  sentence: 'Fynix publishes its audit method and its case studies.',
  url: 'https://fynix.digital/seo-audit',
  host: 'fynix.digital',
  title: 'SEO audits | Fynix',
};
const BRIGHTWAVE: Named = {
  entity_id: MOCK_ENTITY_IDS.brightwave,
  name: 'Brightwave Digital',
  role: 'competitor',
  sentence: 'Brightwave Digital is often named for content work.',
  url: 'https://brightwave.digital/blog',
  host: 'brightwave.digital',
  title: 'Content strategy | Brightwave Digital',
};
const RANKFORGE: Named = {
  entity_id: MOCK_ENTITY_IDS.rankforge,
  name: 'Rankforge',
  role: 'competitor',
  sentence: 'Rankforge focuses on B2B software companies.',
  url: 'https://rankforge.io/b2b',
  host: 'rankforge.io',
  title: 'B2B SEO | Rankforge',
};
const INTRO = 'Here is how the options compare for this question.';
const OUTRO = 'Compare their case studies before you decide.';
const HINDI_INTRO = '🚀 इस सवाल के लिए कुछ विकल्प हैं।';
const HINDI_OUTRO = 'फ़ैसला करने से पहले उनके उदाहरण देखें।';
const MODELS: Readonly<Record<EngineCode, string | null>> = {
  chatgpt_web: 'gpt-6',
  gemini_web: '3.5 Flash-Lite',
  google_ai_mode: null,
};

export interface Answer {
  status: ObservationDetail['status'];
  answer_text: string | null;
  error_code: string | null;
  model_reported: string | null;
  mentions: MentionOut[];
  citations: CitationOut[];
  facts: NonNullable<ObservationDetail['facts']>;
}

const INVALID_FACTS: NonNullable<ObservationDetail['facts']> = {
  derivation_id: 1,
  is_valid: false,
  outcome: 'neither',
  own_mentioned: false,
  own_domain_cited: false,
  own_mention_order: null,
  own_prominence: null,
  own_citation_count: 0,
  total_citation_count: 0,
  tracked_entities_mentioned: 0,
  competitor_mentions: [],
  competitor_cited: [],
  had_structured_list: false,
};

/**
 * The answer of fixture prompt `index` on `engine` on day `day` (days since 1970, UTC). One in 29 failed,
 * one in 29 was refused, one in 29 was empty and one in 29 was cut off (partial, still valid). The own brand
 * is named in about two answers of three, and each name's span is in UTF-16 code units of `answer_text`.
 */
export function answerOf(index: number, languageCode: string, engine: EngineCode, day: number): Answer {
  const e = ENGINE_CODES.indexOf(engine);
  const turn = (index * 7 + day * 3 + e * 5) % 29;
  const model = MODELS[engine];
  if (turn === 0) {
    const failed: Answer = {
      status: 'error',
      answer_text: null,
      error_code: 'provider_error',
      model_reported: null,
      mentions: [],
      citations: [],
      facts: INVALID_FACTS,
    };
    return failed;
  }
  if (turn === 1) {
    const refused: Answer = {
      status: 'refused',
      answer_text: 'I cannot help with that request.',
      error_code: null,
      model_reported: model,
      mentions: [],
      citations: [],
      facts: INVALID_FACTS,
    };
    return refused;
  }
  if (turn === 2) {
    const empty: Answer = {
      status: 'empty',
      answer_text: null,
      error_code: null,
      model_reported: model,
      mentions: [],
      citations: [],
      facts: INVALID_FACTS,
    };
    return empty;
  }
  const named = [
    ...((index + day + e) % 3 !== 0 ? [OWN] : []),
    ...((index + day) % 2 === 0 ? [BRIGHTWAVE] : []),
    ...((index + e) % 4 === 1 ? [RANKFORGE] : []),
  ];
  const hindi = languageCode === 'hi';
  // An emoji before the names moves every span on by two UTF-16 units: the viewer must not count characters
  let text = hindi ? HINDI_INTRO : index % 5 === 0 ? `🔎 ${INTRO}` : INTRO;
  const mentions: MentionOut[] = named.map((entity, order) => {
    text += ' ';
    const start = text.length;
    text += entity.sentence;
    return {
      entity_id: entity.entity_id,
      name: entity.name,
      role: entity.role,
      mention_count: 1,
      first_char_offset: start,
      mention_order: order + 1,
      match_method: 'alias_word',
      mention_status: 'accepted',
      confidence: 0.95,
      evidence_spans: [[start, start + entity.name.length]],
    };
  });
  text += ` ${hindi ? HINDI_OUTRO : OUTRO}`;
  const ownMentioned = named.includes(OWN);
  const ownCited = (index + 2 * day + e) % 4 === 0;
  const cited = [...(ownCited ? [OWN] : []), ...(named.includes(BRIGHTWAVE) && day % 2 === 0 ? [BRIGHTWAVE] : [])];
  const sources = [
    ...cited.map((entity) => ({
      url: entity.url,
      host: entity.host,
      title: entity.title,
      source_name: entity.name,
      domain_role: entity.role,
      role_entity_id: entity.entity_id,
    })),
    {
      url: 'https://www.searchenginejournal.com/seo-guide/',
      host: 'www.searchenginejournal.com',
      title: 'The SEO guide',
      source_name: 'Search Engine Journal',
      domain_role: 'third_party' as const,
      role_entity_id: null,
    },
  ];
  const citations: CitationOut[] = sources.map((source, position) => ({
    citation_index: position + 1,
    url: source.url,
    raw_url: engine === 'chatgpt_web' ? `${source.url}?utm_source=chatgpt.com` : source.url,
    host: source.host,
    title: source.title,
    source_name: source.source_name,
    citation_kind: 'source_list',
    domain_role: source.domain_role,
    role_entity_id: source.role_entity_id,
    occurrences: 1,
    first_char_offset: null,
    answer_block_index: null,
    referral_tag: engine === 'chatgpt_web' ? 'chatgpt.com' : null,
    flags: [],
  }));
  const outcome = ownMentioned
    ? ownCited
      ? 'mentioned_and_cited'
      : 'mentioned_only'
    : ownCited
      ? 'cited_only'
      : 'neither';
  return {
    status: turn === 3 ? 'partial' : 'complete',
    answer_text: text,
    error_code: null,
    model_reported: model,
    mentions,
    citations,
    facts: {
      derivation_id: 1,
      is_valid: true,
      outcome,
      own_mentioned: ownMentioned,
      own_domain_cited: ownCited,
      own_mention_order: ownMentioned ? 1 : null,
      own_prominence: null,
      own_citation_count: ownCited ? 1 : 0,
      total_citation_count: citations.length,
      tracked_entities_mentioned: named.length,
      competitor_mentions: named.filter((entity) => entity.role === 'competitor').map((entity) => entity.entity_id),
      competitor_cited: cited.filter((entity) => entity.role === 'competitor').map((entity) => entity.entity_id),
      had_structured_list: false,
    },
  };
}
```

- [ ] **Step 7: Write the state**

Create `apps/web/src/mocks/prompts-state.ts`:

```ts
import { FIRST_MINTED } from './mock-ids';
import { FIXTURE_ENGINES, FIXTURE_PROMPTS, type StoredEngine, type StoredPrompt } from './prompt-fixtures';
import { onMockReset } from './state';

/**
 * What the AI prompt mocks changed, per project, in the memory of the page (or of the test process). Like the
 * keyword import mock, and unlike ./operations-state.ts, it is not kept in a cookie: 150 prompts do not fit
 * in one, and no server component reads prompts.
 * shortcut: a page reload starts again from the fixtures; move it to a cookie if a server page ever reads prompts.
 */
export interface ProjectPrompts {
  engines: StoredEngine[];
  prompts: StoredPrompt[];
  /** When Run now last asked each prompt on each engine, by `prompt_id engine_code`: epoch milliseconds. */
  asked: Map<string, number>;
  /** Run now's manual runs, by UTC day number. */
  manualRuns: Map<number, number>;
}

/** A Run now answer counts as on its way this long: the standard queue answers within minutes. */
export const PENDING_MS = 10 * 60_000;

const STATE = new Map<string, ProjectPrompts>();
let minted = FIRST_MINTED - 1;

/** The project's AI prompt state, made from the fixtures on first use. */
export function promptsOf(projectId: string): ProjectPrompts {
  const found = STATE.get(projectId);
  if (found !== undefined) return found;
  const fresh: ProjectPrompts = {
    engines: (FIXTURE_ENGINES.get(projectId) ?? []).map((engine) => ({
      ...engine,
      location_ids: [...engine.location_ids],
    })),
    prompts: (FIXTURE_PROMPTS.get(projectId) ?? []).map((prompt) => ({ ...prompt, term_ids: [...prompt.term_ids] })),
    asked: new Map(),
    manualRuns: new Map(),
  };
  STATE.set(projectId, fresh);
  return fresh;
}

/** Active prompts of these projects together: the workspace's use of its prompt quota. */
export const activePromptCount = (projectIds: readonly string[]): number =>
  projectIds.reduce((sum, id) => sum + promptsOf(id).prompts.filter((prompt) => prompt.is_active).length, 0);

/** The number of the next prompt made here; the fixtures stay below it. */
export function mintPromptNumber(): number {
  minted += 1;
  return minted;
}

onMockReset(() => {
  STATE.clear();
  minted = FIRST_MINTED - 1;
});
```

- [ ] **Step 8: Write the handlers**

Create `apps/web/src/mocks/handlers/prompts.ts`:

```ts
import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { bodyError, cursorPage, extraMembers, isOneOf, isRecord, notAnObject, pageRequest, queryError } from './rules';
import { MOCK_ENTITIES, MOCK_LOCATIONS, MOCK_ROLES, MOCK_TERMS, MOCK_VOCABULARIES } from '../entity-fixtures';
import { mockId } from '../mock-ids';
import {
  answerOf,
  DAY_MS,
  ENGINE_CODES,
  ENGINE_FACTS,
  monthlyCostUsd,
  observationIdOf,
  parseObservationId,
  PROMPT_QUOTA,
  PROMPT_TEXT_MAX,
  promptId,
  runInstants,
  versionId,
  type StoredEngine,
  type StoredPrompt,
} from '../prompt-fixtures';
import { activePromptCount, mintPromptNumber, PENDING_MS, promptsOf } from '../prompts-state';
import { invalid, mock, noContent, problem } from '../respond';
import type {
  EngineCode,
  EngineSummary,
  MetricCell,
  ObservationDetail,
  ObservationSummary,
  ProjectEngine,
  Prompt,
  PromptLint,
  PromptSummaryRow,
  Run,
  TopicSummaryRow,
  ValidationItem,
} from '@/lib/api/types';

/**
 * AI prompt tracking, slice 1 (plans A and B of 2026-11-11): the project's engines with their monthly cost,
 * prompts (list, add one, add many, lint, read, change, archive), Run now, the answers with their mentions
 * and sources, the raw answer, and the prompts summary. The rules are the API's, cut to what the screens
 * meet: the 150 prompt quota, duplicates by text, language and country, a country every enabled engine runs
 * in, and the length of a prompt per engine.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const PROMPTS = `${P}/prompts` as const;
const OBSERVATIONS = `${P}/ai/observations` as const;
const BULK_MAX = 1000;
const LINT_MAX = 1000;
const LOCATIONS_MAX = 50;
const SUMMARY_DAYS = 28;
const WINDOW_MAX_DAYS = 92;
const MANUAL_RUN_LIMIT = 20;
const RUN_WINDOW_MS = 3_600_000;
const PROMPT_FIELDS = [
  'text',
  'language_code',
  'country_iso',
  'intent',
  'funnel_stage',
  'prompt_type',
  'importance',
  'term_ids',
] as const;
const PATCH_FIELDS = ['is_active', 'importance'] as const;
const IMMUTABLE = ['text', 'language_code', 'country_iso'] as const;
const ANSWER_STATUSES = ['complete', 'partial', 'empty', 'refused', 'error'] as const;
const OUTCOMES = ['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither'] as const;
const LANGUAGE = /^[a-z]{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const normalized = (text: string): string => text.normalize('NFC').trim();
const keyOf = (text: string, language: string, country: string): string =>
  `${normalized(text)}\u0000${language}\u0000${country}`;
const isoOf = (instant: number): string => new Date(instant).toISOString();
const dateOf = (instant: number): string => isoOf(instant).slice(0, 10);
const dayOfDate = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** The country of an active country location, or `null` for any other location. */
const countryOf = (locationId: number): string | null =>
  MOCK_LOCATIONS.find((location) => location.location_id === locationId && location.location_type === 'Country')
    ?.country_iso ?? null;

const countriesOf = (engine: StoredEngine): Set<string> =>
  new Set(
    engine.location_ids.flatMap((id) => {
      const country = countryOf(id);
      return country === null ? [] : [country];
    }),
  );

const enabledEngines = (projectId: string): StoredEngine[] =>
  promptsOf(projectId).engines.filter((engine) => engine.is_enabled);

/** A sha256-shaped hex text, the same for the same text: the mocks never compare it with the API's. */
function hashOf(text: string): string {
  let hash = 2166136261;
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    for (const char of `${String(round)}${text}`) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619) >>> 0;
    out += hash.toString(16).padStart(8, '0');
  }
  return out;
}

const VOCABULARY_KINDS = new Map(MOCK_VOCABULARIES.map((vocabulary) => [vocabulary.vocabulary_id, vocabulary.kind]));

function termOf(termId: string): Prompt['terms'][number] | null {
  const term = MOCK_TERMS.find((candidate) => candidate.term_id === termId);
  if (term === undefined) return null;
  return {
    term_id: term.term_id,
    vocabulary_kind: VOCABULARY_KINDS.get(term.vocabulary_id) ?? 'custom',
    name: term.name,
    path: term.slug,
  };
}

/** The own brands of a project, by canonical name: what makes a prompt branded. */
const ownEntities = (projectId: string): { entity_id: string; canonical_name: string; entity_type: string }[] =>
  MOCK_ROLES.filter((role) => role.project_id === projectId && role.role === 'own').flatMap((role) =>
    MOCK_ENTITIES.filter((entity) => entity.entity_id === role.entity_id),
  );

const namesOwn = (projectId: string, text: string): boolean =>
  ownEntities(projectId).some((entity) => text.toLowerCase().includes(entity.canonical_name.toLowerCase()));

function promptView(stored: StoredPrompt): Prompt {
  return {
    prompt_id: stored.prompt_id,
    current_version: {
      prompt_version_id: stored.version_id,
      version_no: 1,
      text: stored.text,
      text_hash: hashOf(stored.text),
      change_kind: 'initial',
      created_at: stored.created_at,
    },
    language_code: stored.language_code,
    country_iso: stored.country_iso,
    intent: 'unknown',
    funnel_stage: 'unknown',
    prompt_type: 'question',
    importance: stored.importance,
    is_branded: stored.is_branded,
    source: 'manual',
    creation_method: 'human',
    is_active: stored.is_active,
    terms: stored.term_ids.flatMap((id) => termOf(id) ?? []),
    created_by: stored.created_by,
    created_at: stored.created_at,
    updated_at: stored.created_at,
  };
}

function engineView(projectId: string, code: EngineCode): ProjectEngine {
  const configured = promptsOf(projectId).engines.find((engine) => engine.engine_code === code);
  const fits = promptsOf(projectId).prompts.filter(
    (prompt) => prompt.is_active && prompt.text.length <= ENGINE_FACTS[code].max_prompt_chars,
  ).length;
  return {
    engine: ENGINE_FACTS[code],
    is_configured: configured !== undefined,
    is_enabled: configured?.is_enabled ?? false,
    location_ids: configured?.location_ids ?? [],
    replicates: 1,
    provider_code: 'dataforseo',
    active_prompts: fits,
    estimated_monthly_cost_usd: monthlyCostUsd(fits),
  };
}

interface PromptItem {
  text: string;
  language_code: string;
  country_iso: string;
  importance: number;
  term_ids: string[];
}

/** One prompt of a body as the API's `PromptCreate` reads it, or its field errors under `prefix`. */
function itemOf(value: unknown, prefix: string): PromptItem | ValidationItem[] {
  const path = (name: string): string => (prefix === '' ? name : `${prefix}.${name}`);
  if (!isRecord(value)) return [notAnObject(prefix)];
  const errors: ValidationItem[] = [...extraMembers(value, PROMPT_FIELDS, prefix)];
  const { text, language_code: language, country_iso: country, importance, term_ids: terms } = value;
  if (typeof text !== 'string') errors.push(bodyError(path('text'), text === undefined ? 'missing' : 'string_type', 'Give the prompt.'));
  else if (normalized(text) === '') errors.push(bodyError(path('text'), 'string_too_short', 'At least 1 character.'));
  else if (normalized(text).length > PROMPT_TEXT_MAX)
    errors.push(bodyError(path('text'), 'prompt_too_long', `A prompt has at most ${String(PROMPT_TEXT_MAX)} characters.`));
  else if (/[\r\n]/.test(normalized(text))) errors.push(bodyError(path('text'), 'value_error', 'One line only.'));
  if (typeof language !== 'string' || !LANGUAGE.test(language))
    errors.push(bodyError(path('language_code'), language === undefined ? 'missing' : 'string_pattern_mismatch', 'Two letters.'));
  if (typeof country !== 'string' || !COUNTRY.test(country))
    errors.push(bodyError(path('country_iso'), country === undefined ? 'missing' : 'string_pattern_mismatch', 'Two capital letters.'));
  if (importance !== undefined && (typeof importance !== 'number' || !Number.isInteger(importance) || importance < 1 || importance > 5))
    errors.push(bodyError(path('importance'), 'less_than_equal', 'From 1 to 5.'));
  if (terms !== undefined && (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string')))
    errors.push(bodyError(path('term_ids'), 'list_type', 'A list of term ids.'));
  if (errors.length > 0 || typeof text !== 'string' || typeof language !== 'string' || typeof country !== 'string') {
    return errors;
  }
  return {
    text: normalized(text),
    language_code: language,
    country_iso: country,
    importance: typeof importance === 'number' ? importance : 3,
    term_ids: Array.isArray(terms) ? terms.filter((term): term is string => typeof term === 'string') : [],
  };
}

/** Why the project cannot save this prompt: a term it cannot use, or a country an enabled engine does not run in. */
function saveError(projectId: string, item: PromptItem): { code: string; path: string; message: string } | null {
  if (item.term_ids.some((term) => termOf(term) === null)) {
    return { code: 'term_unknown', path: 'term_ids', message: 'A term the project cannot use.' };
  }
  const missing = enabledEngines(projectId).find((engine) => !countriesOf(engine).has(item.country_iso));
  return missing === undefined
    ? null
    : {
        code: 'location_not_supported',
        path: 'country_iso',
        message: `${ENGINE_FACTS[missing.engine_code].label} runs in no location of this country.`,
      };
}

function newPrompt(caller: ProjectCaller, item: PromptItem, now: number): StoredPrompt {
  const n = mintPromptNumber();
  const user = caller.session.user;
  return {
    prompt_id: promptId(n),
    version_id: versionId(n),
    project_id: caller.project.project_id,
    index: null,
    text: item.text,
    language_code: item.language_code,
    country_iso: item.country_iso,
    term_ids: item.term_ids,
    importance: item.importance,
    is_branded: namesOwn(caller.project.project_id, item.text),
    is_active: true,
    created_at: isoOf(now),
    created_by: { user_id: user.user_id, name: user.name, email: user.email },
  };
}

const quotaProblem = (request: Request, used: number, requested: number): ReturnType<typeof problem> =>
  problem(request, 'quota_exceeded', {
    detail: `The workspace has ${String(used)} of ${String(PROMPT_QUOTA)} active prompts; ${String(requested)} more do not fit.`,
    limit: PROMPT_QUOTA,
    used,
    requested,
  });

const workspaceProjects = (caller: ProjectCaller): string[] => caller.projects.map((project) => project.project_id);

/** A list filter of the query, as a comma list or repeated parameters. */
function listOf<T extends string>(url: URL, name: string, allowed: readonly T[]): T[] | ValidationItem {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
  const known = values.filter((value): value is T => isOneOf(value, allowed));
  return known.length === values.length ? known : queryError(name, 'enum', `Allowed: ${allowed.join(', ')}.`);
}

/** `from` and `to` as project dates, `to` included: the last 28 days by default, at most 92. */
function windowOf(url: URL, now: number): { from: string; to: string } | ValidationItem {
  const to = url.searchParams.get('to') ?? dateOf(now);
  const from = url.searchParams.get('from') ?? dateOf(dayOfDate(to) * DAY_MS - (SUMMARY_DAYS - 1) * DAY_MS);
  if (!ISO_DATE.test(from)) return queryError('from', 'date_parsing', 'A date, YYYY-MM-DD.');
  if (!ISO_DATE.test(to)) return queryError('to', 'date_parsing', 'A date, YYYY-MM-DD.');
  if (dayOfDate(to) - dayOfDate(from) + 1 > WINDOW_MAX_DAYS) {
    return queryError('from', 'window_too_large', `A request covers at most ${String(WINDOW_MAX_DAYS)} days.`);
  }
  return { from, to };
}

/** Every answer of the project's fixture prompts, newest first, on the engines it had on. */
function answersOf(projectId: string, now: number): ObservationDetail[] {
  const state = promptsOf(projectId);
  const runs = runInstants(now);
  return runs.flatMap((at) =>
    state.prompts.flatMap((prompt) =>
      state.engines.flatMap((engine) =>
        prompt.index === null ? [] : [detailOf(prompt, prompt.index, engine, at)],
      ),
    ),
  );
}

function detailOf(prompt: StoredPrompt, index: number, engine: StoredEngine, at: number): ObservationDetail {
  const day = Math.floor(at / DAY_MS);
  const code = engine.engine_code;
  const answer = answerOf(index, prompt.language_code, code, day);
  const location = engine.location_ids.find((id) => countryOf(id) === prompt.country_iso) ?? null;
  return {
    observation_id: observationIdOf(day, index, ENGINE_CODES.indexOf(code)),
    observed_at: isoOf(at),
    observed_date: dateOf(at),
    engine_code: code,
    observation_class: ENGINE_FACTS[code].observation_class,
    subject: { type: 'prompt', prompt_id: prompt.prompt_id, prompt_version_id: prompt.version_id, version_no: 1 },
    query_text: prompt.text,
    run_id: null,
    replicate_index: 1,
    location_id: location,
    language_code: prompt.language_code,
    device: 'desktop',
    status: answer.status,
    model_reported: answer.model_reported,
    answer_char_count: answer.answer_text === null ? null : [...answer.answer_text].length,
    citation_count: answer.citations.length,
    fanout_count: 0,
    served_from_cache: false,
    facts: answer.facts,
    answer_text: answer.answer_text,
    error_code: answer.error_code,
    check_url: null,
    offsets_unit: 'utf16',
    citations: answer.citations,
    mentions: answer.mentions,
  };
}

function summaryOf(detail: ObservationDetail): ObservationSummary {
  return {
    observation_id: detail.observation_id,
    observed_at: detail.observed_at,
    observed_date: detail.observed_date,
    engine_code: detail.engine_code,
    observation_class: detail.observation_class,
    subject: detail.subject,
    query_text: detail.query_text,
    run_id: detail.run_id,
    replicate_index: detail.replicate_index,
    location_id: detail.location_id,
    language_code: detail.language_code,
    device: detail.device,
    status: detail.status,
    model_reported: detail.model_reported,
    answer_char_count: detail.answer_char_count,
    citation_count: detail.citation_count,
    fanout_count: detail.fanout_count,
    served_from_cache: detail.served_from_cache,
    facts: detail.facts,
  };
}

const cell = (numerator: number, denominator: number, observations: number): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: observations,
});

/** Mentioned, Cited, the four outcomes and share of voice of these answers (plan B task 9). */
function engineSummary(code: EngineCode, answers: readonly ObservationSummary[]): EngineSummary {
  const valid = answers.filter((answer) => answer.facts?.is_valid === true);
  const count = (test: (facts: NonNullable<ObservationSummary['facts']>) => boolean): number =>
    valid.filter((answer) => answer.facts !== null && test(answer.facts)).length;
  const naming = valid.filter((answer) => (answer.facts?.tracked_entities_mentioned ?? 0) > 0);
  const share = naming.reduce(
    (sum, answer) => sum + (answer.facts?.own_mentioned === true ? 1 / (answer.facts.tracked_entities_mentioned || 1) : 0),
    0,
  );
  const outcome = (name: (typeof OUTCOMES)[number]): MetricCell =>
    cell(count((facts) => facts.outcome === name), valid.length, answers.length);
  return {
    engine_code: code,
    mentioned: cell(count((facts) => facts.own_mentioned), valid.length, answers.length),
    cited: cell(count((facts) => facts.own_domain_cited), valid.length, answers.length),
    outcomes: {
      mentioned_and_cited: outcome('mentioned_and_cited'),
      mentioned_only: outcome('mentioned_only'),
      cited_only: outcome('cited_only'),
      neither: outcome('neither'),
    },
    share_of_voice: cell(share, naming.length, answers.length),
  };
}

function runOf(caller: ProjectCaller, now: number): Run {
  const runId = mockId('run', 900_000 + mintPromptNumber());
  const self = `/api/v1/workspaces/${caller.access.workspace.workspace_id}/projects/${caller.project.project_id}/runs/${runId}`;
  return {
    run_id: runId,
    project_id: caller.project.project_id,
    schedule_id: null,
    workload: 'ai_prompt',
    trigger: 'manual',
    status: 'planned',
    status_reason: null,
    window_start: isoOf(now),
    window_end: isoOf(now + RUN_WINDOW_MS),
    tasks_total: 0,
    tasks_succeeded: 0,
    tasks_failed: 0,
    estimated_cost_usd: null,
    actual_cost_usd: null,
    blocked_by_budget_id: null,
    created_by: { actor_id: caller.session.user.user_id, actor_type: 'user', label: caller.session.user.name },
    created_at: isoOf(now),
    completed_at: null,
    operation: {
      kind: 'collection_run',
      status: 'queued',
      progress: { done: 0, total: 0, unit: 'tasks' },
      started_at: null,
      finished_at: null,
      error: null,
      links: { self, cancel: `${self}/cancel` },
    },
  };
}

export const promptHandlers: HttpHandler[] = [
  mock('get', ENGINES, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: ENGINE_CODES.map((code) => engineView(caller.project.project_id, code)) });
  }),

  mock('put', `${ENGINES}/{engine_code}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const code = params.engine_code;
    if (!isOneOf(code, ENGINE_CODES)) return invalid(request, [{ location: 'path', path: 'engine_code', code: 'enum', message: 'Not an engine.' }]);
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['location_ids', 'is_enabled']);
    const ids = body.location_ids;
    if (!Array.isArray(ids)) errors.push(bodyError('location_ids', ids === undefined ? 'missing' : 'list_type', 'A list of location ids.'));
    else if (ids.length === 0) errors.push(bodyError('location_ids', 'too_short', 'At least one country.'));
    else if (ids.length > LOCATIONS_MAX) errors.push(bodyError('location_ids', 'too_long', `At most ${String(LOCATIONS_MAX)}.`));
    else
      ids.forEach((id: unknown, index) => {
        if (typeof id !== 'number' || countryOf(id) === null) {
          errors.push(bodyError(`location_ids.${String(index)}`, 'location_not_supported', 'Not an active country.'));
        }
      });
    if (body.is_enabled !== undefined && typeof body.is_enabled !== 'boolean') {
      errors.push(bodyError('is_enabled', 'bool_type', 'Input should be a valid boolean'));
    }
    if (errors.length > 0 || !Array.isArray(ids)) return invalid(request, errors);
    const state = promptsOf(caller.project.project_id);
    const next: StoredEngine = {
      engine_code: code,
      is_enabled: body.is_enabled !== false,
      location_ids: ids.filter((id): id is number => typeof id === 'number'),
    };
    state.engines = [...state.engines.filter((engine) => engine.engine_code !== code), next].sort(
      (a, b) => ENGINE_CODES.indexOf(a.engine_code) - ENGINE_CODES.indexOf(b.engine_code),
    );
    return HttpResponse.json({ data: engineView(caller.project.project_id, code) });
  }),

  mock('get', PROMPTS, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [
        'filter[q]',
        'filter[term]',
        'filter[intent_in]',
        'filter[country_iso]',
        'filter[language_code]',
        'filter[is_active]',
        'limit',
        'cursor',
      ],
    });
    if (caller instanceof Response) return caller;
    const paging = pageRequest(caller.url);
    if (Array.isArray(paging)) return invalid(request, paging);
    const search = caller.url.searchParams;
    const active = search.get('filter[is_active]') !== 'false';
    const q = search.get('filter[q]')?.toLowerCase() ?? null;
    const term = search.get('filter[term]');
    const country = search.get('filter[country_iso]');
    const language = search.get('filter[language_code]');
    const rows = promptsOf(caller.project.project_id)
      .prompts.filter(
        (prompt) =>
          prompt.is_active === active &&
          (q === null || prompt.text.toLowerCase().includes(q)) &&
          (term === null || prompt.term_ids.includes(term)) &&
          (country === null || prompt.country_iso === country) &&
          (language === null || prompt.language_code === language),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.prompt_id.localeCompare(a.prompt_id))
      .map(promptView);
    const page = cursorPage(rows, paging, JSON.stringify([active, q, term, country, language]));
    return page === null ? problem(request, 'invalid_cursor') : HttpResponse.json(page);
  }),

  mock('post', PROMPTS, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const item = itemOf(await request.json(), '');
    if (Array.isArray(item)) return invalid(request, item);
    const refused = saveError(caller.project.project_id, item);
    if (refused !== null) return invalid(request, [bodyError(refused.path, refused.code, refused.message)]);
    const state = promptsOf(caller.project.project_id);
    const key = keyOf(item.text, item.language_code, item.country_iso);
    const existing = state.prompts.find((prompt) => keyOf(prompt.text, prompt.language_code, prompt.country_iso) === key);
    if (existing !== undefined) return problem(request, 'duplicate', { existing_id: existing.prompt_id });
    const used = activePromptCount(workspaceProjects(caller));
    if (used + 1 > PROMPT_QUOTA) return quotaProblem(request, used, 1);
    const stored = newPrompt(caller, item, Date.now());
    state.prompts.push(stored);
    return HttpResponse.json({ data: promptView(stored) }, { status: 201 });
  }),

  mock('post', `${PROMPTS}/bulk-create`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['items', 'on_duplicate']);
    const items = body.items;
    if (!Array.isArray(items)) return invalid(request, [...errors, bodyError('items', 'missing', 'Field required')]);
    if (items.length === 0) errors.push(bodyError('items', 'too_short', 'At least one prompt.'));
    if (items.length > BULK_MAX) errors.push(bodyError('items', 'too_long', `At most ${String(BULK_MAX)}.`));
    const mode = body.on_duplicate ?? 'skip';
    if (mode !== 'skip' && mode !== 'error') errors.push(bodyError('on_duplicate', 'literal_error', 'skip or error'));
    const read = items.map((value: unknown, index) => itemOf(value, `items.${String(index)}`));
    const parsed = read.flatMap((entry) => (Array.isArray(entry) ? [] : [entry]));
    errors.push(...read.flatMap((entry) => (Array.isArray(entry) ? entry : [])));
    if (errors.length > 0 || parsed.length !== read.length) return invalid(request, errors);
    const state = promptsOf(caller.project.project_id);
    const tracked = new Map(state.prompts.map((prompt) => [keyOf(prompt.text, prompt.language_code, prompt.country_iso), prompt.prompt_id]));
    const seen = new Set<string>();
    const accepted: PromptItem[] = [];
    const skipped: { index: number; existing_id: string }[] = [];
    const rejected: { index: number; code: string; message: string }[] = [];
    parsed.forEach((item, index) => {
      const key = keyOf(item.text, item.language_code, item.country_iso);
      const refused = saveError(caller.project.project_id, item);
      const existing = tracked.get(key);
      if (refused !== null) rejected.push({ index, code: refused.code, message: refused.message });
      else if (seen.has(key)) rejected.push({ index, code: 'duplicate_in_request', message: 'The same prompt twice in the list.' });
      else if (existing !== undefined && mode === 'skip') skipped.push({ index, existing_id: existing });
      else if (existing !== undefined) rejected.push({ index, code: 'duplicate', message: 'The project has this prompt.' });
      else accepted.push(item);
      seen.add(key);
    });
    const used = activePromptCount(workspaceProjects(caller));
    if (used + accepted.length > PROMPT_QUOTA) return quotaProblem(request, used, accepted.length);
    const now = Date.now();
    const created = accepted.map((item) => newPrompt(caller, item, now));
    state.prompts.push(...created);
    return HttpResponse.json({ data: { created: created.map((prompt) => prompt.prompt_id), skipped, rejected } });
  }),

  mock('post', `${PROMPTS}/lint`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['texts', 'engine_codes']);
    const texts = body.texts;
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > LINT_MAX || texts.some((text) => typeof text !== 'string')) {
      errors.push(bodyError('texts', 'too_short', `From 1 to ${String(LINT_MAX)} texts.`));
    }
    const codes = body.engine_codes ?? ENGINE_CODES;
    if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => !isOneOf(code, ENGINE_CODES))) {
      errors.push(bodyError('engine_codes', 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`));
    }
    if (errors.length > 0 || !Array.isArray(texts) || !Array.isArray(codes)) return invalid(request, errors);
    const engines = codes.filter((code): code is EngineCode => isOneOf(code, ENGINE_CODES));
    const owners = ownEntities(caller.project.project_id);
    const data = texts.map((raw: unknown): PromptLint => {
      const text = normalized(typeof raw === 'string' ? raw : '');
      const lower = text.toLowerCase();
      const found = owners.flatMap((entity) => {
        const start = lower.indexOf(entity.canonical_name.toLowerCase());
        return start < 0 ? [] : [{ entity, start, end: start + entity.canonical_name.length }];
      });
      return {
        text,
        is_branded: found.length > 0,
        matched_aliases: found.map(({ entity, start, end }) => ({
          entity: {
            entity_id: entity.entity_id,
            canonical_name: entity.canonical_name,
            entity_type: entity.entity_type === 'brand' ? 'brand' : 'other',
            color_index: 1,
            role: 'own',
          },
          alias: text.slice(start, end),
        })),
        warnings: [
          ...found.map(({ entity, start, end }) => ({
            rule: 'contains_brand_alias' as const,
            severity: 'info' as const,
            message: `Names ${entity.canonical_name}: the prompt is branded.`,
            engine_code: null,
            span: { start, end },
          })),
          ...engines
            .filter((code) => text.length > ENGINE_FACTS[code].max_prompt_chars)
            .map((code) => ({
              rule: 'engine_limit' as const,
              severity: text.length > PROMPT_TEXT_MAX ? ('error' as const) : ('warning' as const),
              message: `${ENGINE_FACTS[code].label} takes at most ${String(ENGINE_FACTS[code].max_prompt_chars)} characters.`,
              engine_code: code,
              span: null,
            })),
        ],
      };
    });
    return HttpResponse.json({ data, quota: { limit: PROMPT_QUOTA, used: activePromptCount(workspaceProjects(caller)) } });
  }),

  mock('get', `${PROMPTS}/{prompt_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const found = promptsOf(caller.project.project_id).prompts.find((prompt) => prompt.prompt_id === params.prompt_id);
    return found === undefined ? problem(request, 'not_found') : HttpResponse.json({ data: promptView(found) });
  }),

  mock('patch', `${PROMPTS}/{prompt_id}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const found = promptsOf(caller.project.project_id).prompts.find((prompt) => prompt.prompt_id === params.prompt_id);
    if (found === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...IMMUTABLE.filter((name) => name in body).map((name) =>
        bodyError(name, 'immutable_field', 'Fixed once saved: archive the prompt and add a new one.'),
      ),
      ...extraMembers(body, [...PATCH_FIELDS, ...IMMUTABLE]),
    ];
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
      errors.push(bodyError('is_active', 'bool_type', 'Input should be a valid boolean'));
    }
    if (errors.length > 0) return invalid(request, errors);
    if (body.is_active === true && !found.is_active) {
      const used = activePromptCount(workspaceProjects(caller));
      if (used + 1 > PROMPT_QUOTA) return quotaProblem(request, used, 1);
    }
    if (typeof body.is_active === 'boolean') found.is_active = body.is_active;
    if (typeof body.importance === 'number') found.importance = body.importance;
    return HttpResponse.json({ data: promptView(found) });
  }),

  mock('delete', `${PROMPTS}/{prompt_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const found = promptsOf(caller.project.project_id).prompts.find((prompt) => prompt.prompt_id === params.prompt_id);
    if (found === undefined) return problem(request, 'not_found');
    found.is_active = false;
    return noContent();
  }),

  mock('post', `${PROMPTS}/{prompt_id}/run-now`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'runs:trigger',
    });
    if (caller instanceof Response) return caller;
    const state = promptsOf(caller.project.project_id);
    const found = state.prompts.find((prompt) => prompt.prompt_id === params.prompt_id && prompt.is_active);
    if (found === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['engine_codes']);
    const codes = body.engine_codes;
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > ENGINE_CODES.length || codes.some((code) => !isOneOf(code, ENGINE_CODES))) {
      errors.push(bodyError('engine_codes', 'enum', 'From one to three engine codes.'));
    }
    if (errors.length > 0 || !Array.isArray(codes)) return invalid(request, errors);
    const engines = codes.filter((code): code is EngineCode => isOneOf(code, ENGINE_CODES));
    const enabled = new Set(enabledEngines(caller.project.project_id).map((engine) => engine.engine_code));
    if (engines.some((code) => !enabled.has(code))) {
      return invalid(request, [bodyError('engine_codes', 'engine_not_enabled', 'The project has not turned this engine on.')]);
    }
    if (engines.some((code) => found.text.length > ENGINE_FACTS[code].max_prompt_chars)) {
      return invalid(request, [bodyError('engine_codes', 'prompt_too_long', 'The prompt is too long for an engine.')]);
    }
    const now = Date.now();
    const pending = engines.filter((code) => now - (state.asked.get(`${found.prompt_id} ${code}`) ?? -PENDING_MS) < PENDING_MS);
    if (pending.length > 0) return problem(request, 'check_pending', { engine_codes: pending });
    const today = Math.floor(now / DAY_MS);
    const runsToday = state.manualRuns.get(today) ?? 0;
    if (runsToday >= MANUAL_RUN_LIMIT) {
      return problem(request, 'manual_run_limit', { limit: MANUAL_RUN_LIMIT, used: runsToday });
    }
    state.manualRuns.set(today, runsToday + 1);
    for (const code of engines) state.asked.set(`${found.prompt_id} ${code}`, now);
    return HttpResponse.json({ data: runOf(caller, now) }, { status: 202 });
  }),

  mock('get', OBSERVATIONS, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [
        'from',
        'to',
        'filter[engine_code_in]',
        'filter[prompt_id]',
        'filter[status_in]',
        'filter[is_valid]',
        'filter[outcome_in]',
        'limit',
        'cursor',
      ],
    });
    if (caller instanceof Response) return caller;
    const now = Date.now();
    const window = windowOf(caller.url, now);
    const engines = listOf(caller.url, 'filter[engine_code_in]', ENGINE_CODES);
    const statuses = listOf(caller.url, 'filter[status_in]', ANSWER_STATUSES);
    const outcomes = listOf(caller.url, 'filter[outcome_in]', OUTCOMES);
    const paging = pageRequest(caller.url);
    const errors = [window, engines, statuses, outcomes].filter((value) => 'code' in value && 'location' in value);
    if (Array.isArray(paging)) return invalid(request, paging);
    if (errors.length > 0 || !Array.isArray(engines) || !Array.isArray(statuses) || !Array.isArray(outcomes) || 'code' in window) {
      return invalid(request, errors.filter((value): value is ValidationItem => 'code' in value));
    }
    const promptFilter = caller.url.searchParams.get('filter[prompt_id]');
    const valid = caller.url.searchParams.get('filter[is_valid]');
    const rows = answersOf(caller.project.project_id, now)
      .filter(
        (answer) =>
          answer.observed_date >= window.from &&
          answer.observed_date <= window.to &&
          (promptFilter === null || answer.subject.prompt_id === promptFilter) &&
          (engines.length === 0 || isOneOf(answer.engine_code, engines)) &&
          (statuses.length === 0 || isOneOf(answer.status, statuses)) &&
          (outcomes.length === 0 || (answer.facts !== null && isOneOf(answer.facts.outcome, outcomes))) &&
          (valid === null || String(answer.facts?.is_valid ?? false) === valid),
      )
      .map(summaryOf);
    const page = cursorPage(rows, paging, JSON.stringify([window, engines, statuses, outcomes, promptFilter, valid]));
    return page === null ? problem(request, 'invalid_cursor') : HttpResponse.json(page);
  }),

  mock('get', `${OBSERVATIONS}/{observation_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['observed_at'],
    });
    if (caller instanceof Response) return caller;
    const found = findAnswer(caller, String(params.observation_id));
    return found === null ? problem(request, 'not_found') : HttpResponse.json({ data: found });
  }),

  mock('get', `${OBSERVATIONS}/{observation_id}/raw`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'raw:read',
      query: ['observed_at'],
    });
    if (caller instanceof Response) return caller;
    const found = findAnswer(caller, String(params.observation_id));
    if (found === null) return problem(request, 'not_found');
    // The provider's task answer, cut to what the viewer link shows: the mocks keep no real payload
    return HttpResponse.json({
      status_code: 20000,
      tasks: [{ result: [{ model: found.model_reported, markdown: found.answer_text, sources: found.citations.map((citation) => ({ url: citation.raw_url, title: citation.title })) }] }],
    });
  }),

  mock('get', `${P}/ai/prompts-summary`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['from', 'to', 'filter[engine_code_in]', 'include_branded'],
    });
    if (caller instanceof Response) return caller;
    const now = Date.now();
    const window = windowOf(caller.url, now);
    const asked = listOf(caller.url, 'filter[engine_code_in]', ENGINE_CODES);
    if ('code' in window) return invalid(request, [window]);
    if (!Array.isArray(asked)) return invalid(request, [asked]);
    const includeBranded = caller.url.searchParams.get('include_branded') === 'true';
    const projectId = caller.project.project_id;
    const codes = enabledEngines(projectId)
      .map((engine) => engine.engine_code)
      .filter((code) => asked.length === 0 || asked.includes(code));
    const answers = answersOf(projectId, now).filter(
      (answer) => answer.observed_date >= window.from && answer.observed_date <= window.to,
    );
    const prompts = promptsOf(projectId).prompts.filter((prompt) => prompt.is_active && (includeBranded || !prompt.is_branded));
    const enginesOf = (ids: ReadonlySet<string>): EngineSummary[] =>
      codes.map((code) => engineSummary(code, answers.filter((answer) => answer.engine_code === code && ids.has(answer.subject.prompt_id)).map(summaryOf)));
    const rows: PromptSummaryRow[] = prompts.map((prompt) => ({
      prompt_id: prompt.prompt_id,
      text: prompt.text,
      is_branded: prompt.is_branded,
      topic_term_ids: prompt.term_ids,
      engines: enginesOf(new Set([prompt.prompt_id])),
    }));
    const termIds = [...new Set(prompts.flatMap((prompt) => prompt.term_ids))];
    const topics: TopicSummaryRow[] = [
      ...termIds.map((termId) => {
        const members = prompts.filter((prompt) => prompt.term_ids.includes(termId));
        return {
          term_id: termId,
          name: termOf(termId)?.name ?? null,
          prompt_count: members.length,
          engines: enginesOf(new Set(members.map((prompt) => prompt.prompt_id))),
        };
      }),
      ...(prompts.some((prompt) => prompt.term_ids.length === 0)
        ? [
            {
              term_id: null,
              name: null,
              prompt_count: prompts.filter((prompt) => prompt.term_ids.length === 0).length,
              engines: enginesOf(new Set(prompts.filter((prompt) => prompt.term_ids.length === 0).map((prompt) => prompt.prompt_id))),
            },
          ]
        : []),
    ];
    return HttpResponse.json({
      data: {
        window: { from: window.from, to: window.to, timezone: caller.project.timezone },
        include_branded: includeBranded,
        engine_codes: codes,
        prompts: rows,
        topics,
      },
    });
  }),
];

/** The answer an id names, when it is one of this project's fixture prompts on an engine it has. */
function findAnswer(caller: ProjectCaller, id: string): ObservationDetail | null {
  const parsed = parseObservationId(id);
  if (parsed === null) return null;
  const state = promptsOf(caller.project.project_id);
  const prompt = state.prompts.find((candidate) => candidate.index === parsed.index);
  const engine = state.engines.find((candidate) => candidate.engine_code === ENGINE_CODES[parsed.engine]);
  const at = parsed.day * DAY_MS + 2 * 3_600_000;
  if (prompt === undefined || prompt.index === null || engine === undefined || !runInstants(Date.now()).includes(at)) {
    return null;
  }
  return detailOf(prompt, prompt.index, engine, at);
}
```

If `pnpm typecheck` later says a `MockBody` literal does not match (for example `window` of `PromptsSummary` has no `timezone`, or `MetricWindow` names its members differently), copy the member names from `src/lib/api/schema.ts` for that component: the generated schema is the contract.

- [ ] **Step 9: Register the handlers**

In `apps/web/src/mocks/handlers/index.ts`, add the import after `import { projectHandlers } from './projects';`:

```ts
import { promptHandlers } from './prompts';
```

and in `handlers`, after `...costHandlers,`:

```ts
  ...promptHandlers,
```

- [ ] **Step 10: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/mocks/handlers/prompts.test.ts`
Expected: `Tests  12 passed (12)`.

Run the other handler tests too, since the new module joins `handlers`:

Run: `pnpm vitest run src/mocks`
Expected: every file passes. A type error on a `mock(...)` path in `pnpm typecheck` means the path string in `prompts.ts` differs from `schema.ts`: copy it from `schema.ts`.

Then the gate (Rules section).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/lib/api/schema.ts apps/web/src/lib/api/types.ts apps/web/src/mocks/mock-ids.ts \
  apps/web/src/mocks/prompt-fixtures.ts apps/web/src/mocks/prompts-state.ts \
  apps/web/src/mocks/handlers/prompts.ts apps/web/src/mocks/handlers/prompts.test.ts apps/web/src/mocks/handlers/index.ts
git commit -m "Web client for AI prompts, and mocks for engines, prompts, run now, answers and the summary"
```

---

### Task 2: Shared country list, the queries layer and the pure model

**Read first:**
- `apps/web/src/features/operations/runs-queries.ts` (scope, keys, `refreshRuns`, `useInfiniteQuery` that loads every page, `apiQuery`, `apiMutation`)
- `apps/web/src/lib/api/keys.ts` (`projectKey`, how a path becomes a key) and `apps/web/src/lib/api/query.ts` (`apiQuery`, `apiMutation`, `ApiResponse`)
- `apps/web/src/features/rankings/keyword-filters.ts` lines 1 to 57 (`readCountries`, which moves) and `apps/web/src/features/rankings/add-keywords/add-queries.ts` lines 1 to 38 (`useCountryList`, the cache key)
- `apps/web/src/lib/format/number.ts` (`formatSampleCount`) and `apps/web/src/lib/format/date.ts` (`formatIsoDate`)

**Files:**
- Create: `apps/web/src/lib/locations/countries.ts`
- Modify: `apps/web/src/features/rankings/keyword-filters.ts`
- Create: `apps/web/src/features/prompts/prompt-queries.ts`, `apps/web/src/features/prompts/prompt-model.ts`
- Test: `apps/web/src/features/prompts/prompt-model.test.ts`, `apps/web/src/features/prompts/prompt-queries.test.ts`

- [ ] **Step 1: Move the country list to lib**

Create `apps/web/src/lib/locations/countries.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import type { ApiResponse } from '@/lib/api/query';

/**
 * Every country the API lists (19 section 3.2.5), for the features that choose countries: Rankings (where a
 * keyword is tracked) and AI prompts (where an engine asks and which market a prompt stands for). Regions and
 * cities wait for a location search in the editor.
 */
const COUNTRIES = { 'filter[location_type]': 'Country', 'filter[supports]': 'serp', limit: 200 } as const;
/** About 250 countries exist; the reading stops here whatever the API says. */
const MAX_COUNTRY_PAGES = 5;

export type Country = ApiResponse<'get', '/api/v1/locations'>['data'][number];

/** Every country the API lists, page after page: a link's location must be among them to be kept. */
export async function readCountries(signal: AbortSignal): Promise<Country[]> {
  const found: Country[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_COUNTRY_PAGES; page += 1) {
    const answer: ApiResponse<'get', '/api/v1/locations'> = await unwrap(
      api.GET('/api/v1/locations', {
        params: { query: { ...COUNTRIES, ...(cursor === null ? {} : { cursor }) } },
        signal,
      }),
    );
    found.push(...answer.data);
    cursor = answer.page.has_more ? answer.page.next_cursor : null;
    if (cursor === null) break;
  }
  return found;
}

/** The cache entry Rankings reads the countries under too, so the list is read once a session. */
export const COUNTRIES_KEY = ['locations', 'countries', 'all'] as const;

/** One empty list while the countries load, so what depends on it does not change on every render. */
const NO_COUNTRIES: readonly Country[] = [];

export interface CountryList {
  countries: readonly Country[];
  /** The list could not be read; `retry` asks again. */
  isError: boolean;
  retry: () => void;
}

export function useCountries(): CountryList {
  const query = useQuery({
    queryKey: COUNTRIES_KEY,
    queryFn: ({ signal }) => readCountries(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { countries: query.data ?? NO_COUNTRIES, isError: query.isError, retry: () => void query.refetch() };
}
```

In `apps/web/src/features/rankings/keyword-filters.ts`:

1. Delete the two imports `import { api, unwrap } from '@/lib/api/client';` and `import type { ApiResponse } from '@/lib/api/query';`.
2. Delete the block that starts with the line `/** The countries a keyword is tracked in; regions and cities wait for a location search in the editor. */` and ends with the closing `}` of `readCountries` (the `const COUNTRIES`, `MAX_COUNTRY_PAGES`, `Country`, `Location` and `readCountries` declarations).
3. Add after the last import line (`import { useDepthLabel } from '@/lib/keywords/use-depth-label';`):

```ts

// The country list moved to lib, where the AI prompt screens read it too; Rankings keeps its names
export { readCountries, type Country } from '@/lib/locations/countries';
```

Run: `pnpm typecheck && pnpm vitest run src/features/rankings`
Expected: no type error; every Rankings test passes as before.

- [ ] **Step 2: Write the failing model and query tests**

Create `apps/web/src/features/prompts/prompt-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  countriesForEngines,
  countText,
  fitsEngine,
  hasAnswers,
  parseTab,
  parseWindow,
  promptKeyOf,
  readPromptLines,
  windowRange,
} from './prompt-model';
import type { ProjectEngine, PromptsSummary } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';

const country = (location_id: number, country_iso: string, name: string): Country => ({
  location_id,
  country_iso,
  name,
  location_type: 'Country',
  parent_id: null,
  supports: ['serp'],
});
const GERMANY = country(2276, 'DE', 'Germany');
const INDIA = country(2356, 'IN', 'India');
const US = country(2840, 'US', 'United States');

const engine = (code: ProjectEngine['engine']['engine_code'], max: number, locations: number[]): ProjectEngine => ({
  engine: {
    engine_code: code,
    label: code,
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: max,
  },
  is_configured: true,
  is_enabled: true,
  location_ids: locations,
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 0,
  estimated_monthly_cost_usd: '0.000000',
});

describe('the window', () => {
  it('reads 7, 28 and 90 days from the URL and falls back to 28', () => {
    expect([parseWindow('7'), parseWindow('90'), parseWindow('28'), parseWindow('5'), parseWindow(null)]).toEqual([
      7, 90, 28, 28, 28,
    ]);
  });

  it('is the last days in the project’s time zone, today included', () => {
    // 23:30 UTC on 1 November is already 2 November in Kolkata
    const late = new Date('2026-11-01T23:30:00Z');
    expect(windowRange(28, late, 'Asia/Kolkata')).toEqual({ from: '2026-10-06', to: '2026-11-02' });
    expect(windowRange(7, late, 'America/New_York')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
});

describe('the tabs', () => {
  it('opens on Topics unless the URL says Prompts', () => {
    expect([parseTab('prompts'), parseTab('topics'), parseTab('panels'), parseTab(null)]).toEqual([
      'prompts',
      'topics',
      'topics',
      'topics',
    ]);
  });
});

describe('a count cell', () => {
  it('reads as “4 of 8”, and as nothing when no answer counts', () => {
    expect(countText({ value: 0.5, numerator: 4, denominator: 8, n_observations: 9 })).toBe('4 of 8');
    expect(countText({ value: null, numerator: 0, denominator: 0, n_observations: 2 })).toBeNull();
    expect(countText(undefined)).toBeNull();
  });

  it('knows whether any prompt has an answer', () => {
    const summary = (n: number): PromptsSummary => ({
      window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
      include_branded: false,
      engine_codes: ['chatgpt_web'],
      topics: [],
      prompts: [
        {
          prompt_id: 'p1',
          text: 'Which agency?',
          is_branded: false,
          topic_term_ids: [],
          engines: [
            {
              engine_code: 'chatgpt_web',
              mentioned: { value: null, numerator: 0, denominator: 0, n_observations: n },
              cited: { value: null, numerator: 0, denominator: 0, n_observations: n },
              outcomes: {
                mentioned_and_cited: { value: null, numerator: 0, denominator: 0, n_observations: n },
                mentioned_only: { value: null, numerator: 0, denominator: 0, n_observations: n },
                cited_only: { value: null, numerator: 0, denominator: 0, n_observations: n },
                neither: { value: null, numerator: 0, denominator: 0, n_observations: n },
              },
              share_of_voice: { value: null, numerator: 0, denominator: 0, n_observations: n },
            },
          ],
        },
      ],
    });
    expect(hasAnswers(summary(0))).toBe(false);
    expect(hasAnswers(summary(1))).toBe(true);
  });
});

describe('a pasted list', () => {
  it('is one prompt per line, trimmed and composed, with blank lines left out and repeats named', () => {
    const text = '  Which agency?  \n\nWhich agency?\nCafé near me?\r\nCafé near me?\n';
    expect(readPromptLines(text)).toEqual({
      lines: [
        { text: 'Which agency?', line: 1 },
        { text: 'Café near me?', line: 4 },
      ],
      repeats: [
        { line: 3, first: 1 },
        { line: 5, first: 4 },
      ],
    });
  });

  it('keys a prompt as the API finds duplicates: text, language and country', () => {
    expect(promptKeyOf(' Which agency? ', 'en', 'DE')).toBe(promptKeyOf('Which agency?', 'en', 'DE'));
    expect(promptKeyOf('Which agency?', 'en', 'DE')).not.toBe(promptKeyOf('Which agency?', 'de', 'DE'));
  });
});

describe('engines', () => {
  it('counts a prompt’s length in characters, as the API does, against each engine’s limit', () => {
    const aiMode = engine('google_ai_mode', 700, [2276]);
    expect(fitsEngine('😀'.repeat(700), aiMode)).toBe(true);
    expect(fitsEngine('x'.repeat(701), aiMode)).toBe(false);
  });

  it('offers the countries every enabled engine runs in, or every country when none is on', () => {
    const all = [GERMANY, INDIA, US];
    expect(countriesForEngines([], all)).toEqual(all);
    expect(
      countriesForEngines([engine('chatgpt_web', 2000, [2276, 2356]), engine('gemini_web', 2000, [2356, 2840])], all),
    ).toEqual([INDIA]);
  });
});
```

Create `apps/web/src/features/prompts/prompt-queries.test.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  aiKey,
  enginesKey,
  enginesQuery,
  observationQuery,
  promptQuery,
  promptsKey,
  refreshPrompts,
  summaryQuery,
} from './prompt-queries';
import { projectKey } from '@/lib/api/keys';

const scope = { workspaceId: 'w1', projectId: 'p1' };

describe('the keys of the AI prompt queries', () => {
  it('put each read under the prefix its refresh invalidates', () => {
    expect(promptQuery(scope, 'x').queryKey.slice(0, 5)).toEqual(promptsKey(scope));
    expect(summaryQuery(scope, { from: '2026-10-16', to: '2026-11-12' }, false).queryKey.slice(0, 5)).toEqual(
      aiKey(scope),
    );
    expect(observationQuery(scope, '1234567').queryKey.slice(0, 5)).toEqual(aiKey(scope));
    expect(enginesQuery(scope).queryKey.slice(0, 5)).toEqual(enginesKey(scope));
  });

  it('marks the prompts, the answers and the engines of the project stale after a change, and nothing else', async () => {
    const client = new QueryClient();
    const own = projectKey('w1', 'p1');
    const other = projectKey('w1', 'p2');
    for (const key of [
      [...own, 'prompts', 'all'],
      [...own, 'ai', 'prompts-summary', {}],
      [...own, 'engines', {}],
      [...own, 'runs', 'list'],
      [...other, 'prompts', 'all'],
    ]) {
      client.setQueryData(key, 1);
    }
    await refreshPrompts(client, scope);
    const stale = (key: readonly unknown[]): boolean | undefined => client.getQueryState(key)?.isInvalidated;
    expect(stale([...own, 'prompts', 'all'])).toBe(true);
    expect(stale([...own, 'ai', 'prompts-summary', {}])).toBe(true);
    expect(stale([...own, 'engines', {}])).toBe(true);
    // Runs are read again by what started one (Run now), not by every prompt change
    expect(stale([...own, 'runs', 'list'])).toBe(false);
    expect(stale([...other, 'prompts', 'all'])).toBe(false);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts`
Expected: FAIL with `Failed to resolve import "./prompt-model"` and `"./prompt-queries"`.

- [ ] **Step 4: Write the model**

Create `apps/web/src/features/prompts/prompt-model.ts`:

```ts
import { formatIsoDate, formatSampleCount } from '@/lib/format';
import type { MetricCell, ProjectEngine, Prompt, PromptsSummary } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';

/**
 * Plain data and functions of Topics & Prompts (spec 2026-11-11 section 4.6): the window, the tabs, the count
 * cells, a pasted list of prompts and the countries a prompt may stand for. The screens put words to it.
 */

/** The windows offered; the API takes at most 92 days. */
export const WINDOW_DAYS = [7, 28, 90] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];
export const DEFAULT_WINDOW: WindowDays = 28;

export const parseWindow = (value: string | null): WindowDays =>
  WINDOW_DAYS.find((days) => String(days) === value) ?? DEFAULT_WINDOW;

/** Project dates, `to` included, as the API's `from` and `to` take them. */
export interface DateRange {
  from: string;
  to: string;
}

/** The last `days` days in the project's time zone, today included. */
export function windowRange(days: WindowDays, now: Date, timeZone: string): DateRange {
  const to = formatIsoDate(now, timeZone);
  const [year = 1970, month = 1, day = 1] = to.split('-').map(Number);
  // Calendar arithmetic in UTC, so a clock change in the project's zone moves no day
  const from = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return { from: from.toISOString().slice(0, 10), to };
}

/** The tabs of slice 1 (ADR-DS-022): Panels and Versions wait for slice 4. */
export const PROMPTS_TABS = ['topics', 'prompts'] as const;
export type PromptsTab = (typeof PROMPTS_TABS)[number];
export const parseTab = (value: string | null): PromptsTab => (value === 'prompts' ? 'prompts' : 'topics');

/** "4 of 8": the answers that count over the valid answers; `null` while no valid answer counts. */
export const countText = (cell: MetricCell | undefined): string | null =>
  cell === undefined || cell.denominator === 0 ? null : formatSampleCount(cell.numerator, cell.denominator);

/** The prompt's topics: its terms of a topic vocabulary. */
export const topicTermsOf = (prompt: Prompt): Prompt['terms'] =>
  prompt.terms.filter((term) => term.vocabulary_kind === 'topic');

/** Whether any prompt has an answer in the window: until one has, the page says when the first arrive. */
export const hasAnswers = (summary: PromptsSummary): boolean =>
  summary.prompts.some((row) => row.engines.some((engine) => engine.mentioned.n_observations > 0));

/** The most prompts one add takes (plan A `BULK_CREATE_MAX`). */
export const BULK_MAX = 1000;

export interface PromptLine {
  text: string;
  /** From 1, as the person sees the line in the field. */
  line: number;
}

export interface PromptLines {
  lines: PromptLine[];
  /** A line that repeats an earlier one, which is left out. */
  repeats: { line: number; first: number }[];
}

const tidy = (text: string): string => text.normalize('NFC').trim();

/** One prompt per line, trimmed and composed (NFC) as the API stores it; blank lines and repeats are left out. */
export function readPromptLines(text: string): PromptLines {
  const seen = new Map<string, number>();
  const lines: PromptLine[] = [];
  const repeats: { line: number; first: number }[] = [];
  text.split('\n').forEach((raw, index) => {
    const value = tidy(raw);
    if (value === '') return;
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, index + 1);
      lines.push({ text: value, line: index + 1 });
    } else {
      repeats.push({ line: index + 1, first });
    }
  });
  return { lines, repeats };
}

/** What makes two prompts the same one for the API (plan A decision A2): text, language and country. */
export const promptKeyOf = (text: string, languageCode: string, countryIso: string): string =>
  `${tidy(text)}\u0000${languageCode}\u0000${countryIso}`;

/** Whether the engine takes the prompt: its limit counts characters (code points), as Python does. */
export const fitsEngine = (text: string, engine: ProjectEngine): boolean =>
  [...text].length <= engine.engine.max_prompt_chars;

/**
 * The countries a prompt may stand for: those every enabled engine has a location in (plan A decision A5), or
 * every country while no engine is on.
 */
export function countriesForEngines(engines: readonly ProjectEngine[], countries: readonly Country[]): readonly Country[] {
  if (engines.length === 0) return countries;
  const isoOf = new Map(countries.map((country) => [country.location_id, country.country_iso]));
  const reach = engines.map(
    (engine) =>
      new Set(
        engine.location_ids.flatMap((id) => {
          const iso = isoOf.get(id);
          return iso === undefined ? [] : [iso];
        }),
      ),
  );
  return countries.filter((country) => reach.every((isos) => isos.has(country.country_iso)));
}
```

- [ ] **Step 5: Write the queries**

Create `apps/web/src/features/prompts/prompt-queries.ts`:

```ts
'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { DateRange } from './prompt-model';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiMutation, apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';
import type { EngineCode, Prompt } from '@/lib/api/types';

/**
 * A project's AI prompts, engines and answers (19 section 3.7, cut to slice 1 by plans A and B). Every key
 * starts with the project, then `prompts`, `ai` or `engines`, so `refreshPrompts` reaches all of them.
 */

export interface PromptScope {
  workspaceId: string;
  projectId: string;
}

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const ENGINE = `${ENGINES}/{engine_code}` as const;
const PROMPTS = `${P}/prompts` as const;
const PROMPT = `${PROMPTS}/{prompt_id}` as const;
const LINT = `${PROMPTS}/lint` as const;
const OBSERVATIONS = `${P}/ai/observations` as const;
const OBSERVATION = `${OBSERVATIONS}/{observation_id}` as const;
const SUMMARY = `${P}/ai/prompts-summary` as const;
const ENTITIES = `${P}/entities` as const;

type PromptPage = ApiResponse<'get', typeof PROMPTS>;
export type LintAnswer = ApiResponse<'post', typeof LINT>;

/** The prompts asked for in one page. */
const PAGE = 200;
/** The list stops here whatever the API says: the base plan allows 150 active prompts a workspace. */
export const MAX_PROMPTS = 1000;
/** A prompt's answers in one read: 90 days hold at most 78 (twice a week on three engines). */
const ANSWERS_PAGE = 100;
const FIRST_PAGE: string | null = null;

const pathOf = (scope: PromptScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

export const promptsKey = (scope: PromptScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'prompts'];
export const aiKey = (scope: PromptScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'ai'];
export const enginesKey = (scope: PromptScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'engines'];

/**
 * After a change to the prompts or the engines: the prompt lists, the answers and the summary, and the engines
 * (their active prompt counts and costs). Resolves once the queries on screen have read again.
 */
export function refreshPrompts(queryClient: QueryClient, scope: PromptScope): Promise<void> {
  return Promise.all(
    [promptsKey, aiKey, enginesKey].map((key) => queryClient.invalidateQueries({ queryKey: key(scope) })),
  ).then(() => undefined);
}

/** `GET {P}/engines`: all three engines, configured or not, with the monthly cost of each. */
export const enginesQuery = (scope: PromptScope): ApiQueryOptions<typeof ENGINES> =>
  apiQuery(ENGINES, { params: { path: pathOf(scope) } });

/** `PUT {P}/engines/{engine_code}`: on or off, with the countries it asks in. */
export const PUT_ENGINE = apiMutation('put', ENGINE);

/** `GET {P}/ai/prompts-summary`: Mentioned, Cited and the rest per prompt, topic and engine over the window. */
export const summaryQuery = (
  scope: PromptScope,
  range: DateRange,
  includeBranded: boolean,
): ApiQueryOptions<typeof SUMMARY> =>
  apiQuery(SUMMARY, {
    params: { path: pathOf(scope), query: { from: range.from, to: range.to, include_branded: includeBranded } },
  });

export interface PromptList {
  rows: readonly Prompt[];
  /** The first page has not arrived. */
  loading: boolean;
  error: unknown;
  fetching: boolean;
  refetch: () => void;
}

/** Every active prompt of the project, page after page up to `MAX_PROMPTS`, newest first. */
export function usePromptList(scope: PromptScope): PromptList {
  const query = useInfiniteQuery({
    queryKey: [...promptsKey(scope), 'all'],
    queryFn: ({ pageParam, signal }): Promise<PromptPage> =>
      unwrap(
        api.GET(PROMPTS, {
          params: { path: pathOf(scope), query: { limit: PAGE, ...(pageParam === null ? {} : { cursor: pageParam }) } },
          signal,
        }),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
  const { data, hasNextPage, isFetching, isError, fetchNextPage, refetch } = query;
  const rows = useMemo(() => (data?.pages ?? []).flatMap((page) => page.data), [data]);
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError && rows.length < MAX_PROMPTS) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, rows.length, fetchNextPage]);
  return {
    rows,
    loading: query.isPending,
    error: query.error,
    fetching: isFetching,
    refetch: () => void refetch(),
  };
}

/** `GET {P}/prompts/{prompt_id}`. */
export const promptQuery = (scope: PromptScope, promptId: string): ApiQueryOptions<typeof PROMPT> =>
  apiQuery(PROMPT, { params: { path: { ...pathOf(scope), prompt_id: promptId } } });

/** `GET {P}/ai/observations` for one prompt over the window, newest first. */
export const observationsQuery = (
  scope: PromptScope,
  promptId: string,
  range: DateRange,
): ApiQueryOptions<typeof OBSERVATIONS> =>
  apiQuery(OBSERVATIONS, {
    params: {
      path: pathOf(scope),
      query: { 'filter[prompt_id]': promptId, from: range.from, to: range.to, limit: ANSWERS_PAGE },
    },
  });

/**
 * `GET {P}/ai/observations/{observation_id}`. The id is a 64-bit integer the API sends as text; the path takes
 * it as a number, which holds every id below 2^53 exactly.
 */
export const observationQuery = (scope: PromptScope, observationId: string): ApiQueryOptions<typeof OBSERVATION> =>
  apiQuery(OBSERVATION, { params: { path: { ...pathOf(scope), observation_id: Number(observationId) } } });

/** Where the raw provider answer is read (`raw:read`); the browser opens it as it is. */
export const rawAnswerPath = (scope: PromptScope, observationId: string): string =>
  `/api/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/projects/${encodeURIComponent(scope.projectId)}/ai/observations/${encodeURIComponent(observationId)}/raw`;

/** The project's entities with their colors, for the marks of an answer. */
export const projectEntitiesQuery = (scope: PromptScope): ApiQueryOptions<typeof ENTITIES> =>
  apiQuery(ENTITIES, { params: { path: pathOf(scope) } });

/** `POST {P}/prompts/lint` for the texts of a list: nothing is stored. Without engines, every engine's limit applies. */
export function usePromptLint(
  scope: PromptScope,
  texts: readonly string[],
  engineCodes: readonly EngineCode[],
): UseQueryResult<LintAnswer> {
  return useQuery({
    queryKey: [...promptsKey(scope), 'lint', texts, engineCodes],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST(LINT, {
          params: { path: pathOf(scope) },
          body: { texts: [...texts], ...(engineCodes.length === 0 ? {} : { engine_codes: [...engineCodes] }) },
          signal,
        }),
      ),
    enabled: texts.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** `POST {P}/prompts/bulk-create`. */
export const BULK_CREATE_PROMPTS = apiMutation('post', `${PROMPTS}/bulk-create`);
/** `PATCH {P}/prompts/{prompt_id}`: here only to bring an archived prompt back. */
export const UPDATE_PROMPT = apiMutation('patch', PROMPT);
/** `DELETE {P}/prompts/{prompt_id}`: the archive; the prompt keeps its answers. */
export const ARCHIVE_PROMPT = apiMutation('delete', PROMPT);
/** `POST {P}/prompts/{prompt_id}/run-now`: a manual run on the standard queue. */
export const RUN_NOW = apiMutation('post', `${PROMPT}/run-now`);
```

- [ ] **Step 6: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/prompts`
Expected: `Tests  11 passed (11)` (9 model tests, 2 query tests).

Then the gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/locations/countries.ts apps/web/src/features/rankings/keyword-filters.ts \
  apps/web/src/features/prompts/prompt-model.ts apps/web/src/features/prompts/prompt-model.test.ts \
  apps/web/src/features/prompts/prompt-queries.ts apps/web/src/features/prompts/prompt-queries.test.ts
git commit -m "Queries and model of the AI prompt screens; the country list moves to lib"
```

---

### Task 3: Engines in project settings

**Read first:**
- `apps/web/src/features/project-settings/schedules-screen.tsx` lines 1 to 60 and 270 to 330 (a settings section: heading, description, read-only `Banner`, `InlineError`)
- `apps/web/src/components/ui/setting-row.tsx` and `apps/web/src/components/ui/switch.tsx` (a setting that saves at once)
- `apps/web/src/components/ui/alert-dialog.tsx` lines 125 to 160 (`ConfirmDialog`: rejects keep it open)
- `apps/web/src/features/rankings/add-keywords/add-keywords-dialog.tsx` lines 425 to 450 (`MultiSelect<Country>`)
- `apps/web/src/features/settings/settings-frame.tsx` and its test, `apps/web/src/app/[workspace]/[project]/settings/schedules/page.tsx`
- `apps/web/src/features/project-settings/schedules.test.tsx` lines 1 to 80 (rendering a settings screen in a test, recording request bodies)

**Files:**
- Create: `apps/web/src/features/prompts/engines-screen.tsx`, `apps/web/src/features/prompts/index.ts`
- Create: `apps/web/src/app/[workspace]/[project]/settings/engines/page.tsx`
- Modify: `apps/web/src/features/settings/settings-frame.tsx`, `apps/web/src/features/settings/settings-frame.test.tsx`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/engines.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/prompts/engines.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { EnginesScreen } from './engines-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');

afterEach(() => {
  server.events.removeAllListeners();
});

function enginesAs(role: Role, project: typeof fynix, country: string): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <EnginesScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        projectId={project.project_id}
        defaultCountryIso={country}
      />
    </PermissionProvider>
  );
}

/** The bodies the screen sends to the engine routes, as they arrive. */
function recordPuts(): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PUT' && new URL(request.url).pathname.includes('/engines/')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
}

describe('Project settings > Engines', () => {
  it('shows each engine with its switch, its monthly cost and its countries, and says it starts spend', async () => {
    const { container } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    expect(await screen.findByRole('switch', { name: 'ChatGPT' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Gemini' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toBeChecked();
    expect(screen.getAllByText('About $0.25 a month for 24 active prompts, twice a week')).toHaveLength(3);
    expect(screen.getByText(/Turning an engine on starts scheduled spend/)).toBeInTheDocument();
    const chatgptCountries = await screen.findByRole('group', { name: 'Countries of ChatGPT' });
    expect(await within(chatgptCountries).findByText('Germany')).toBeInTheDocument();
    expect(within(chatgptCountries).getByText('India')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks before an engine is turned on, with the cost, then saves it with the project’s country', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn on Gemini?' });
    expect(within(confirm).getByText(/starts scheduled spend from the next run/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Turn on Gemini' }));
    expect(await screen.findByText('Gemini is on')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gemini' })).toBeChecked());
    expect(puts).toEqual([{ location_ids: [2840], is_enabled: true }]);
  });

  it('sends nothing when the question is cancelled', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('switch', { name: 'ChatGPT' })).not.toBeChecked();
    expect(puts).toEqual([]);
  });

  it('turns an engine off at once, keeping its countries', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const chatgpt = await screen.findByRole('switch', { name: 'ChatGPT' });
    await screen.findAllByText('Germany');
    await user.click(chatgpt);
    expect(await screen.findByText('ChatGPT is off')).toBeInTheDocument();
    expect(puts).toEqual([{ location_ids: [2276, 2356], is_enabled: false }]);
  });

  it('is read-only without projects:write', async () => {
    renderWithProviders(enginesAs('viewer', fynix, 'DE'));
    expect(await screen.findByRole('switch', { name: 'ChatGPT' })).toBeDisabled();
    expect(screen.getByText('Owners, admins and editors can turn engines on and off.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/prompts/engines.test.tsx`
Expected: FAIL with `Failed to resolve import "./engines-screen"`.

- [ ] **Step 3: Add the words**

In `apps/web/messages/en.json`, in `settings.items`, add after `"taxonomy": "Taxonomy",`:

```json
      "engines": "Engines",
```

and add a top-level namespace after the `"integrations": { ... }` namespace (the last one; put a comma after its closing brace):

```json
  "aiEngines": {
    "title": "Engines",
    "description": "The AI engines this project asks its prompts on, twice a week, on Monday and Thursday. Each engine is off until you turn it on.",
    "spendNote": "Turning an engine on starts scheduled spend: every active prompt is asked on it twice a week, at the price shown.",
    "readOnlyLead": "Read only:",
    "readOnly": "Owners, admins and editors can turn engines on and off.",
    "loadFailed": "The engines could not be loaded.",
    "loadFailedReason": "The server did not answer. Try again in a moment.",
    "estimate": "About {cost} a month for {prompts} active prompts, twice a week",
    "noPrice": "No price is on record for this engine yet.",
    "countries": "Countries",
    "countriesHint": "The engine asks each prompt in the country the prompt stands for.",
    "countriesPlaceholder": "Add a country",
    "countriesEmpty": "No country matches “{query}”",
    "countriesRequired": "Choose at least one country.",
    "countriesFailed": "The list of countries could not be loaded.",
    "countriesRefused": "One of the countries cannot be used. Choose another.",
    "chips": "Countries of {engine}",
    "remove": "Remove {value}",
    "forbidden": "You do not have permission to change the engines of this project.",
    "saveFailed": "The change was not saved. Try again in a moment.",
    "confirmTitle": "Turn on {engine}?",
    "confirmDescription": "{engine} will ask your {prompts} active prompts twice a week, for about {cost} a month. This starts scheduled spend from the next run.",
    "confirmNoPrice": "{engine} will ask your active prompts twice a week. This starts scheduled spend from the next run.",
    "confirm": "Turn on {engine}",
    "turnedOn": "{engine} is on",
    "turnedOnHint": "The first answers arrive after the next Monday or Thursday run.",
    "turnedOff": "{engine} is off"
  }
```

- [ ] **Step 4: Write the screen**

Create `apps/web/src/features/prompts/engines-screen.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { enginesQuery, PUT_ENGINE, refreshPrompts, type PromptScope } from './prompt-queries';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { SettingRow } from '@/components/ui/setting-row';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { ProjectEngine } from '@/lib/api/types';
import { formatCurrency, formatInteger } from '@/lib/format';
import { money } from '@/lib/format/money';
import { useCountries, type Country } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';

export interface EnginesScreenProps {
  workspaceId: string;
  projectId: string;
  /** The country of the project's default location, which an engine never set up starts with. */
  defaultCountryIso: string | null;
}

const SKELETON_ROWS = [0, 1, 2] as const;

/**
 * Settings > Project settings > Engines (spec 2026-11-11 section 4.6): ChatGPT, Gemini and Google AI Mode,
 * each off until a member with `projects:write` turns it on. Turning one on asks first and names its monthly
 * cost, since it starts scheduled spend; turning one off saves at once and keeps its countries. The countries
 * of an engine that is on save as they change; those of one that is off wait for it to be turned on.
 */
export function EnginesScreen({ workspaceId, projectId, defaultCountryIso }: EnginesScreenProps): ReactNode {
  const t = useTranslations('aiEngines');
  const common = useTranslations('common');
  const scope: PromptScope = { workspaceId, projectId };
  const canWrite = useCan('projects:write');
  const engines = useQuery(enginesQuery(scope));
  const countries = useCountries();
  const errorId = useErrorId(engines.error);
  return (
    <section aria-labelledby="engines-title" className="flex flex-col gap-5">
      <div>
        <h2 id="engines-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <Banner tone="info" placement="region" message={t('spendNote')} />
      {canWrite ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      {countries.isError ? (
        <Banner
          tone="warning"
          placement="region"
          message={t('countriesFailed')}
          actions={
            <Button variant="secondary" size="sm" onClick={countries.retry}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      {engines.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={errorId}
          onRetry={() => void engines.refetch()}
          retrying={engines.isFetching}
          retryLabel={common('retry')}
        />
      ) : engines.data === undefined ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} shape="block" height="row" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-surface">
          {engines.data.data.map((engine) => (
            <li key={engine.engine.engine_code} className="px-4 pb-4">
              <EngineRow
                scope={scope}
                engine={engine}
                countries={countries.countries}
                canWrite={canWrite}
                defaultCountryIso={defaultCountryIso}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface EngineRowProps {
  scope: PromptScope;
  engine: ProjectEngine;
  countries: readonly Country[];
  canWrite: boolean;
  defaultCountryIso: string | null;
}

function EngineRow({ scope, engine, countries, canWrite, defaultCountryIso }: EngineRowProps): ReactElement {
  const t = useTranslations('aiEngines');
  const common = useTranslations('common');
  const hints = useMultiSelectHints();
  const queryClient = useQueryClient();
  const put = useMutation(PUT_ENGINE);
  const code = engine.engine.engine_code;
  const label = engine.engine.label;
  // The countries chosen here and not yet saved; `null` shows what the engine holds
  const [draft, setDraft] = useState<readonly Country[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(countries.map((country) => [country.location_id, country]));
  const saved = engine.location_ids.flatMap((id) => byId.get(id) ?? []);
  const projectCountry = countries.filter((country) => country.country_iso === defaultCountryIso).slice(0, 1);
  const chosen = draft ?? (engine.is_configured ? saved : projectCountry);
  // What a save sends: the engine's own countries until the person changes them, even while the list loads
  const ids = draft === null && engine.is_configured ? engine.location_ids : chosen.map((country) => country.location_id);
  const cost = engine.estimated_monthly_cost_usd === null ? null : money(engine.estimated_monthly_cost_usd);
  const prompts = formatInteger(engine.active_prompts);

  const fail = (message: string): void => {
    setError(message);
    announce(message, { politeness: 'assertive' });
  };
  const save = async (isEnabled: boolean, locationIds: readonly number[]): Promise<void> => {
    setError(null);
    try {
      await put.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, engine_code: code } },
        body: { location_ids: [...locationIds], is_enabled: isEnabled },
      });
    } catch (failure) {
      if (isApiProblem(failure, 'validation_failed')) fail(t('countriesRefused'));
      else if (isApiProblem(failure, 'forbidden')) fail(t('forbidden'));
      else fail(t('saveFailed'));
      throw failure;
    }
    setDraft(null);
    await refreshPrompts(queryClient, scope);
  };

  const turn = (on: boolean): void => {
    if (on) {
      setError(null);
      setAsking(true);
      return;
    }
    save(false, ids).then(
      () => toast({ type: 'success', title: t('turnedOff', { engine: label }) }),
      // The row says why; the switch stays where it was
      () => undefined,
    );
  };
  const changeCountries = (next: readonly Country[]): void => {
    setDraft(next);
    // An engine that is on saves its countries at once, like its switch; with none chosen nothing is sent
    if (engine.is_enabled && next.length > 0) {
      save(
        true,
        next.map((country) => country.location_id),
      ).catch(() => undefined);
    }
  };
  const turnOn = async (): Promise<void> => {
    if (ids.length === 0) {
      fail(t('countriesRequired'));
      throw new Error('An engine needs a country before it is turned on');
    }
    await save(true, ids);
    toast({ type: 'success', title: t('turnedOn', { engine: label }), description: t('turnedOnHint') });
  };

  return (
    <div className="flex flex-col gap-3">
      <SettingRow
        label={label}
        description={
          cost === null ? t('noPrice') : t('estimate', { cost: formatCurrency(cost), prompts })
        }
        error={error}
        control={
          <Switch checked={engine.is_enabled} busy={put.isPending} disabled={!canWrite} onCheckedChange={turn} />
        }
      />
      <Field invalid={chosen.length === 0 && countries.length > 0} disabled={!canWrite}>
        <FieldLabel>{t('countries')}</FieldLabel>
        <MultiSelect<Country>
          value={chosen}
          onValueChange={changeCountries}
          items={countries}
          itemToString={(country) => country.name}
          itemKey={(country) => String(country.location_id)}
          placeholder={t('countriesPlaceholder')}
          emptyText={(query) => t('countriesEmpty', { query })}
          chipsLabel={t('chips', { engine: label })}
          removeLabel={(value) => t('remove', { value })}
          disabled={!canWrite}
          {...hints}
        />
        {chosen.length === 0 && countries.length > 0 ? (
          <FieldError message={t('countriesRequired')} />
        ) : (
          <FieldDescription>{t('countriesHint')}</FieldDescription>
        )}
      </Field>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        tone="neutral"
        title={t('confirmTitle', { engine: label })}
        description={
          cost === null
            ? t('confirmNoPrice', { engine: label })
            : t('confirmDescription', { engine: label, cost: formatCurrency(cost), prompts })
        }
        confirmLabel={t('confirm', { engine: label })}
        cancelLabel={common('cancel')}
        error={error}
        onConfirm={turnOn}
      />
    </div>
  );
}
```

`chipsLabel` names the chip list; the test finds it as a group named "Countries of ChatGPT". If `MultiSelect` gives the chips another role, read its role in `src/components/ui/multi-select.tsx` (`ComboboxPrimitive.Chips` with `aria-label`) and use that role in the test.

Create `apps/web/src/features/prompts/index.ts`:

```ts
export { EnginesScreen, type EnginesScreenProps } from './engines-screen';
```

- [ ] **Step 5: Add the section to Settings**

In `apps/web/src/features/settings/settings-frame.tsx` change

```ts
const PROJECT = ['general', 'entities', 'domains', 'taxonomy', 'schedules'] as const;
```

to

```ts
const PROJECT = ['general', 'entities', 'domains', 'taxonomy', 'engines', 'schedules'] as const;
```

In `apps/web/src/features/settings/settings-frame.test.tsx`, in the first test's `hrefsOf(nav)` list, add after `'/digibranders/fynix/settings/taxonomy',`:

```ts
      '/digibranders/fynix/settings/engines',
```

Create `apps/web/src/app/[workspace]/[project]/settings/engines/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { EnginesScreen } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('engines') };
}

/** Project settings > Engines: which AI engines ask the project's prompts, and in which countries. */
export default async function EnginesPage({
  params,
}: PageProps<'/[workspace]/[project]/settings/engines'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <EnginesScreen
      workspaceId={membership.workspace.workspace_id}
      projectId={current.project_id}
      defaultCountryIso={current.default_location?.country_iso ?? null}
    />
  );
}
```

- [ ] **Step 6: Run the tests to see them pass, then the gate and the build**

Run: `pnpm vitest run src/features/prompts/engines.test.tsx src/features/settings`
Expected: `Tests  N passed (N)` with the 5 engine tests among them.

Then the gate, and `pnpm build`. Expected: the route table lists `ƒ /[workspace]/[project]/settings/engines`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/prompts/engines-screen.tsx apps/web/src/features/prompts/engines.test.tsx \
  apps/web/src/features/prompts/index.ts "apps/web/src/app/[workspace]/[project]/settings/engines/page.tsx" \
  apps/web/src/features/settings/settings-frame.tsx apps/web/src/features/settings/settings-frame.test.tsx \
  apps/web/messages/en.json
git commit -m "Engines section in project settings: three engines, countries, cost before turning on"
```

---

### Task 4: The Topics & Prompts page: navigation, route and screen shell

**Read first:**
- `apps/web/src/lib/navigation/registry.ts` (the `prompts` entry) and `apps/web/src/lib/navigation/registry.test.ts`
- `apps/web/src/features/shell/project-shell.test.tsx` lines 140 to 170 and 268 to 274, `apps/web/e2e/flows/shell.spec.ts` lines 70 to 77 (the sidebar links tests name)
- `apps/web/src/app/[workspace]/[project]/ops/runs/page.tsx` and `page.test.tsx` (a project page and its test)
- `apps/web/src/features/operations/runs-screen.tsx` (header, `TopBarPortal`-free toolbar, `DataTable` with sort, columns, density and search in the URL, empty and error states) and `apps/web/src/features/operations/run-columns.ts` (`col.*`)
- `apps/web/src/features/rankings/rankings-screen.tsx` lines 865 to 875 (`TopBarPortal` for a scope control in the top bar, UI rule 8)
- `apps/web/src/components/app/data-table/columns.tsx` (`col.keyword`, `col.text`, `UnknownValue`)

**Files:**
- Modify: `apps/web/src/lib/navigation/registry.ts`, `apps/web/src/lib/navigation/registry.test.ts`, `apps/web/src/features/shell/project-shell.test.tsx`, `apps/web/e2e/flows/shell.spec.ts`
- Create: `apps/web/src/app/[workspace]/[project]/ai/prompts/page.tsx`, `apps/web/src/app/[workspace]/[project]/ai/prompts/page.test.tsx`
- Create: `apps/web/src/features/prompts/prompts-screen.tsx`, `apps/web/src/features/prompts/prompt-columns.tsx`
- Modify: `apps/web/src/features/prompts/index.ts`, `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/prompts.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/navigation/registry.test.ts`:

- rename the test `'lists only what is live: Keywords, Integrations, Runs, Costs and Settings, for now'` to `'lists only what is live: Keywords, Topics & Prompts, Integrations, Runs, Costs and Settings, for now'` and change its expected list to `['keywords', 'prompts', 'integrations', 'runs', 'costs', 'settings']`;
- in `'shows Runs to a reader and Costs to those who may read costs, hiding the one the role cannot open'`, change the viewer list to `['keywords', 'prompts', 'integrations', 'runs', 'settings']` and the analyst list to `['keywords', 'prompts', 'integrations', 'runs', 'costs', 'settings']` (billing stays `['costs', 'settings']`).

In `apps/web/src/features/shell/project-shell.test.tsx`, in `'lists Integrations, Runs and Costs in the sidebar ...'`, add `'Topics & Prompts /digibranders/fynix/ai/prompts',` after `'Keywords /digibranders/fynix/seo/keywords',` in the editor and the viewer lists.

In `apps/web/e2e/flows/shell.spec.ts`, change `await expect(links).toHaveText(['Keywords', 'Runs', 'Settings']);` to `await expect(links).toHaveText(['Keywords', 'Topics & Prompts', 'Runs', 'Settings']);`.

Create `apps/web/src/app/[workspace]/[project]/ai/prompts/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PromptsPage from './page';
import { PromptsScreen } from '@/features/prompts';
import type { components } from '@/lib/api/schema';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS } from '@/mocks/fixtures';

type Project = components['schemas']['Project'];

/** What `notFound()` throws in the app: here a plain error. */
const missing = vi.hoisted(() => {
  class NotFound extends Error {}
  return { NotFound };
});
const state = vi.hoisted((): { open: Project[] } => ({ open: [] }));

vi.mock('next/navigation', () => ({
  notFound: (): never => {
    throw new missing.NotFound('not found');
  },
}));
vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock('@/lib/session/server', () => ({
  requireMembership: () =>
    Promise.resolve({
      membership: { workspace: { slug: 'digibranders', name: 'Digibranders', workspace_id: 'w1' } },
    }),
}));
vi.mock('@/lib/projects/server', () => ({ projectsOfMembership: () => Promise.resolve(state.open) }));

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const cleanstart = projectFactory(cleanstartSeed);

const page = (project: string): Promise<unknown> =>
  PromptsPage({ params: Promise.resolve({ workspace: 'digibranders', project }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  state.open = [fynix, cleanstart];
});

describe('Topics & Prompts of a project', () => {
  it('shows the prompts of the project in the route, with its time zone and its defaults', async () => {
    expect(await page('cleanstart')).toMatchObject({
      type: PromptsScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        project: {
          id: cleanstart.project_id,
          slug: 'cleanstart',
          name: 'Cleanstart',
          timeZone: cleanstart.timezone,
          defaultLanguage: cleanstart.default_language_code,
          defaultCountryIso: cleanstart.default_location?.country_iso ?? null,
        },
      },
    });
  });

  it('is the 404 page for a project the member cannot open', async () => {
    await expect(page('nowhere')).rejects.toBeInstanceOf(missing.NotFound);
    state.open = [cleanstart];
    await expect(page('fynix')).rejects.toBeInstanceOf(missing.NotFound);
  });
});
```

Create `apps/web/src/features/prompts/prompts.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen, type PromptsProject } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const asProject = (project: typeof fynix, country: string): PromptsProject => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
  defaultLanguage: 'en',
  defaultCountryIso: country,
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role, project: PromptsProject = asProject(fynix, 'DE')): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen workspaceId={MOCK_WORKSPACE.workspace_id} workspaceSlug={MOCK_WORKSPACE.slug} project={project} />
      </Suspense>
    </PermissionProvider>
  );
}

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });

describe('Topics & Prompts', () => {
  it('lists the active prompts with their topic and country, and the window in the top bar', async () => {
    const { container } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?')).toBeInTheDocument();
    expect(within(table).getAllByText('Technical SEO').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Germany').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeInTheDocument();
    expect(screen.getByText('Answers from Oct 16 to Nov 12, 2026')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says no engine is on, and where to turn one on, for a project without one', async () => {
    renderWithProviders(promptsAs('editor', asProject(cleanstart, 'US')));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Engines settings' })).toHaveAttribute(
      'href',
      '/digibranders/cleanstart/settings/engines',
    );
  });

  it('says when the first answers arrive while no prompt has one, so an empty table is not read as a failure', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/prompts-summary`), () =>
        HttpResponse.json({
          data: {
            window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
            include_branded: false,
            engine_codes: ['chatgpt_web'],
            prompts: [],
            topics: [],
          },
        }),
      ),
    );
    renderWithProviders(promptsAs('viewer'));
    expect(
      await screen.findByText(
        'No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.',
      ),
    ).toBeInTheDocument();
  });

  it('offers a retry when the prompts do not load', async () => {
    server.use(http.get(mswPath(`${P}/prompts`), () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    expect(await screen.findByText('The prompts could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so to a member who cannot read the data', async () => {
    renderWithProviders(promptsAs('billing'));
    expect(await screen.findByRole('heading', { name: 'You cannot see the prompts of this project' })).toBeInTheDocument();
  });
});
```

The URL a test starts on comes through `renderWithProviders`' `searchParams` (`?tab=prompts` does nothing until task 6 adds the tabs, and keeps these tests right after it). Later tasks add their tests to this file and reuse `promptsAs`, `asProject`, `grid`, `fynix`, `cleanstart` and `P`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts/prompts.test.tsx "src/app/[workspace]/[project]/ai/prompts" src/lib/navigation`
Expected: FAIL: `Failed to resolve import "./prompts-screen"`, `"./page"`, and the registry tests list no `prompts`.

- [ ] **Step 3: Put the page in the navigation**

In `apps/web/src/lib/navigation/registry.ts`, in the entry with `key: 'prompts'`, change `status: 'planned',` to `status: 'live',`.

- [ ] **Step 4: Add the words**

In `apps/web/messages/en.json`, add a top-level namespace after `"aiEngines": { ... }` (put a comma after its closing brace):

```json
  "prompts": {
    "title": "Topics & Prompts",
    "meta": "Answers from {from} to {to}",
    "window": "Window",
    "windowOption": "Last {days, number} days",
    "noAccessTitle": "You cannot see the prompts of this project",
    "noAccessReason": "Viewing prompts needs read access to the project’s data. Ask an admin of this workspace.",
    "enginesFailed": "The engines of this project could not be loaded.",
    "loadFailed": "The prompts could not be loaded.",
    "loadFailedReason": "The server did not answer. Try again in a moment.",
    "summaryFailed": "The answer counts could not be loaded. The prompts are listed without them.",
    "noEngineTitle": "No AI engine is on",
    "noEngineReason": "Turn on ChatGPT, Gemini or Google AI Mode in the project settings to start asking your prompts.",
    "toEngines": "Open the Engines settings",
    "noPromptsTitle": "No prompts yet",
    "noPromptsReason": "Add the questions your buyers ask AI assistants. Each prompt is asked twice a week.",
    "noAnswers": "No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.",
    "branded": "Branded",
    "caption": "Prompts",
    "noun": {
      "one": "prompt",
      "other": "prompts"
    },
    "search": "Search prompts",
    "emptyFiltered": "No prompts match",
    "emptyFilteredReason": "Change the search or the filters to see more prompts.",
    "clearFilters": "Clear filters",
    "columns": {
      "prompt": "Prompt",
      "topic": "Topic",
      "country": "Country",
      "noTopic": "No topic"
    }
  }
```

- [ ] **Step 5: Write the columns**

Create `apps/web/src/features/prompts/prompt-columns.tsx`:

```tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import type { Prompt, PromptSummaryRow } from '@/lib/api/types';
import type { SortKey } from '@/lib/tables/table-state';

/** A row of the Prompts tab: the prompt, its counts when the summary has them, and its facts in words. */
export interface PromptRow {
  prompt: Prompt;
  summary: PromptSummaryRow | undefined;
  /** The prompt's topics, joined; `null` without one. */
  topics: string | null;
  /** The country's name; `null` for a prompt without a country. */
  country: string | null;
}

/** A to Z by the prompt's text. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'prompt', desc: false }];

export interface PromptColumns {
  columns: readonly DataTableColumn<PromptRow>[];
  /** The ids `?sort=` may name. */
  sortFields: ReadonlySet<string>;
  searchText: (row: PromptRow) => string;
  rowName: (row: PromptRow) => string;
}

/** The columns of the Prompts tab (ADR-DS-022 decision 9): Prompt, Topic and Country. */
export function usePromptColumns(): PromptColumns {
  const t = useTranslations('prompts');
  const locale = useLocale();
  return useMemo(() => {
    const columns: DataTableColumn<PromptRow>[] = [
      col.keyword<PromptRow>('prompt', (row) => row.prompt.current_version.text, {
        header: t('columns.prompt'),
        trailing: (row) => (row.prompt.is_branded ? <Badge>{t('branded')}</Badge> : null),
      }),
      col.text<PromptRow>('topic', (row) => row.topics, {
        header: t('columns.topic'),
        priority: 2,
        unknown: () => ({ label: t('columns.noTopic') }),
      }),
      col.text<PromptRow>('country', (row) => row.country, { header: t('columns.country'), priority: 3, width: 136 }),
    ];
    return {
      columns,
      sortFields: new Set(columns.flatMap((column) => (column.sortValue === undefined ? [] : [column.id]))),
      searchText: (row) => `${row.prompt.current_version.text} ${row.topics ?? ''}`.toLocaleLowerCase(locale),
      rowName: (row) => row.prompt.current_version.text,
    };
  }, [t, locale]);
}
```

- [ ] **Step 6: Write the screen**

Create `apps/web/src/features/prompts/prompts-screen.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, MessageSquare, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useMemo, type ReactNode } from 'react';

import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';
import { DEFAULT_WINDOW, hasAnswers, parseWindow, topicTermsOf, WINDOW_DAYS, windowRange } from './prompt-model';
import { enginesQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { useErrorId } from '@/lib/api/use-error-id';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { formatBusinessDate, formatList } from '@/lib/format';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import {
  DEFAULT_DENSITY,
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

export interface PromptsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the window's days are its days. */
  timeZone: string;
  /** The project's defaults, which Add prompts starts on. */
  defaultLanguage: string | null;
  defaultCountryIso: string | null;
}

export interface PromptsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: PromptsProject;
}

/** The URL's keys besides the filters': the window and the table's state. */
const VIEW_STATE = {
  window: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
};

const promptRowId = (row: PromptRow): string => row.prompt.prompt_id;

/**
 * AI > Topics & Prompts (spec 2026-11-11 section 4.6, ADR-DS-022): the project's prompts over a window of
 * days (28 by default, in the top bar as a project-wide scope), with what each engine answered. A project
 * without an engine on is sent to Settings > Engines; until the first answers arrive the page says when they
 * come, so an empty table is not read as a failure.
 */
export function PromptsScreen(props: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <PromptsContent {...props} />;
}

function PromptsContent({ workspaceId, workspaceSlug, project }: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const common = useTranslations('common');
  const locale = useLocale();
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const windowDays = parseWindow(view.window);
  // The same date all UTC day; a new day is read at midnight UTC
  const now = useUtcDay();
  const range = useMemo(() => windowRange(windowDays, now, project.timeZone), [windowDays, now, project.timeZone]);

  const engines = useQuery(enginesQuery(scope));
  const enginesErrorId = useErrorId(engines.error);
  const enabled = useMemo(() => (engines.data?.data ?? []).filter((engine) => engine.is_enabled), [engines.data]);
  const { countries } = useCountries();
  const countryName = useMemo(
    () => new Map(countries.map((country) => [country.country_iso, country.name])),
    [countries],
  );
  const list = usePromptList(scope);
  const listErrorId = useErrorId(list.error);
  const summary = useQuery({ ...summaryQuery(scope, range, false), enabled: enabled.length > 0 });
  const summaryById = useMemo(
    () => new Map((summary.data?.data.prompts ?? []).map((row) => [row.prompt_id, row])),
    [summary.data],
  );
  // Branded prompts stay out, as the rates leave them out (16-metrics-methodology.md rule 4)
  const rows = useMemo(
    (): PromptRow[] =>
      list.rows
        .filter((prompt) => !prompt.is_branded)
        .map((prompt) => {
          const topics = topicTermsOf(prompt).map((term) => term.name);
          return {
            prompt,
            summary: summaryById.get(prompt.prompt_id),
            topics: topics.length === 0 ? null : formatList(topics, locale),
            country: prompt.country_iso === null ? null : (countryName.get(prompt.country_iso) ?? prompt.country_iso),
          };
        }),
    [list.rows, summaryById, countryName, locale],
  );

  const { columns, sortFields, searchText, rowName } = usePromptColumns();
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, sortFields);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort, sortFields]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['prompt']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  const waiting = list.loading || engines.isPending || (enabled.length > 0 && summary.isPending);
  const status = ((): TableStatus => {
    if (list.error !== null && list.rows.length === 0) return 'error';
    if (waiting) return 'loading';
    if (rows.length === 0) return 'filtered-empty';
    return summary.isFetching ? 'refetching' : 'ready';
  })();
  const noAnswers = summary.data !== undefined && list.rows.length > 0 && !hasAnswers(summary.data.data);

  const listError = (
    <InlineError
      title={t('loadFailed')}
      reason={t('loadFailedReason')}
      errorId={listErrorId}
      onRetry={list.refetch}
      retrying={list.fetching}
      retryLabel={common('retry')}
      live
    />
  );
  const filteredEmpty = <EmptyState title={t('emptyFiltered')} reason={t('emptyFilteredReason')} headingLevel={2} />;
  const noPrompts = (
    <EmptyState icon={MessageSquare} title={t('noPromptsTitle')} reason={t('noPromptsReason')} headingLevel={2} />
  );

  let content: ReactNode;
  if (engines.isError) {
    content = (
      <InlineError
        title={t('enginesFailed')}
        reason={t('loadFailedReason')}
        errorId={enginesErrorId}
        onRetry={() => void engines.refetch()}
        retrying={engines.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (engines.data !== undefined && enabled.length === 0) {
    content = (
      <EmptyState
        icon={Power}
        title={t('noEngineTitle')}
        reason={t('noEngineReason')}
        headingLevel={2}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
            {t('toEngines')}
          </TextLink>
        }
      />
    );
  } else if (!list.loading && list.error === null && list.rows.length === 0) {
    content = noPrompts;
  } else {
    content = (
      <>
        {noAnswers ? <Banner tone="info" placement="region" message={t('noAnswers')} /> : null}
        {summary.isError ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('summaryFailed')}
            actions={
              <Button variant="secondary" size="sm" onClick={() => void summary.refetch()} loading={summary.isFetching}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<PromptRow>
            caption={t('caption')}
            itemNoun={{ one: t('noun.one'), other: t('noun.other') }}
            columns={columns}
            getRowId={promptRowId}
            rows={rows}
            total={rows.length}
            sort={sort}
            onSortChange={(next) => void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) })}
            defaultSort={DEFAULT_SORT}
            density={density}
            onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
            columnState={{
              visible,
              onChange: (next) => void setView({ cols: next === null ? null : formatColumns(next) }),
            }}
            search={view.q}
            onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
            searchPlaceholder={t('search')}
            searchText={searchText}
            rowName={rowName}
            status={status}
            errorState={listError}
            emptyState={noPrompts}
            filteredEmptyState={filteredEmpty}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBarPortal>
        <div className="w-44">
          <Select<string>
            aria-label={t('window')}
            value={String(windowDays)}
            onValueChange={(next) => void setView({ window: next === String(DEFAULT_WINDOW) ? null : next })}
            placeholder={t('window')}
            options={WINDOW_DAYS.map((days) => ({ value: String(days), label: t('windowOption', { days }) }))}
          />
        </div>
      </TopBarPortal>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <PageHeader
          title={t('title')}
          meta={t('meta', {
            from: formatBusinessDate(range.from, { withYear: false }),
            to: formatBusinessDate(range.to),
          })}
        />
        {content}
      </div>
    </>
  );
}
```

`TopBarPortal` draws nothing without the shell's slot (as in the tests), so the tests read the window from the meta line. In the test file the first test finds the grid by the name `Prompts`: the `caption` is the grid's name.

Replace the contents of `apps/web/src/features/prompts/index.ts` with:

```ts
export { EnginesScreen, type EnginesScreenProps } from './engines-screen';
export { PromptsScreen, type PromptsProject, type PromptsScreenProps } from './prompts-screen';
```

- [ ] **Step 7: Write the route**

Create `apps/web/src/app/[workspace]/[project]/ai/prompts/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PromptsScreen } from '@/features/prompts';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('prompts');
  return { title: t('title') };
}

/**
 * AI > Topics & Prompts (11-navigation.md section 1.1, ADR-DS-022). The project shell above serves this page's
 * loading and error states; the page finds the project among those the member can open, as Runs does. A prompt
 * opens in the right inspector (`?inspect=prompt:{id}`), so slice 1 has no page of its own for one.
 */
export default async function PromptsPage({ params }: PageProps<'/[workspace]/[project]/ai/prompts'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <PromptsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        defaultLanguage: current.default_language_code,
        defaultCountryIso: current.default_location?.country_iso ?? null,
      }}
    />
  );
}
```

- [ ] **Step 8: Run the tests to see them pass, then the gate and the build**

Run: `pnpm vitest run src/features/prompts "src/app/[workspace]/[project]/ai/prompts" src/lib/navigation src/features/shell`
Expected: every file passes, the 5 screen tests and 2 page tests among them.

Then the gate, and `pnpm build`. Expected: the route table lists `ƒ /[workspace]/[project]/ai/prompts`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/navigation/registry.ts apps/web/src/lib/navigation/registry.test.ts \
  apps/web/src/features/shell/project-shell.test.tsx apps/web/e2e/flows/shell.spec.ts \
  "apps/web/src/app/[workspace]/[project]/ai/prompts/page.tsx" "apps/web/src/app/[workspace]/[project]/ai/prompts/page.test.tsx" \
  apps/web/src/features/prompts/prompts-screen.tsx apps/web/src/features/prompts/prompt-columns.tsx \
  apps/web/src/features/prompts/prompts.test.tsx apps/web/src/features/prompts/index.ts apps/web/messages/en.json
git commit -m "Topics & Prompts page: navigation entry, route, window, engine and empty states, prompt table"
```

---

### Task 5: Prompts tab: Mentioned and Cited per engine, filters, sort and URL state

**Read first:**
- `apps/web/src/features/prompts/prompts-screen.tsx` and `prompt-columns.tsx` as task 4 left them
- `apps/web/src/features/operations/runs-screen.tsx` lines 140 to 200 (`FilterField`s, `useUrlFilters`, `enumValuesOf`, `ReadOnlyFilterChips`, Clear filters)
- `apps/web/src/components/app/filters/types.ts` (`EnumFilterField`, `optionsLoading`)
- Spec section 4.5 (metric cells: `numerator`, `denominator`, `n_observations`, value null at denominator 0; branded prompts left out unless `include_branded`) and doc 16 rule 4

**Files:**
- Modify (rewrite): `apps/web/src/features/prompts/prompt-columns.tsx`, `apps/web/src/features/prompts/prompts-screen.tsx`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/prompts.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/features/prompts/prompts.test.tsx`, inside `describe('Topics & Prompts', ...)`, after the last test:

```tsx
  it('shows Mentioned and Cited per enabled engine as counts of valid answers, and only for enabled engines', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /^Gemini cited/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^Google AI Mode/ })).toBeNull();
    // Eight runs in the 28 days; an answer that failed, was refused or was empty leaves the denominator
    expect(within(table).getAllByText(/^\d of [5-8]$/).length).toBeGreaterThan(20);
  });

  it('leaves branded prompts out until the Branded filter includes them, and asks the summary the same', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url.searchParams.get('include_branded') ?? '');
    });
    const branded = 'Is Fynix a good SEO agency for software companies?';
    const first = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    await within(await grid()).findByText('Which SEO agency is best for a SaaS startup in Germany?');
    expect(within(await grid()).queryByText(branded)).toBeNull();
    first.unmount();
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&branded=include' });
    expect(await within(await grid()).findByText(branded)).toBeInTheDocument();
    expect(asked).toContain('false');
    expect(asked).toContain('true');
    server.events.removeAllListeners();
  });

  it('filters by topic and country from the URL, and sorts by an engine column', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: `?tab=prompts&topic=${encodeURIComponent('0192d1a8-e005-7a10-8e05-000000000002')}&country=DE`,
    });
    const table = await grid();
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).queryByText('Which tools track local rankings by city?')).toBeNull();
    await user.click(within(table).getByRole('button', { name: /^ChatGPT mentioned/ }));
    expect(within(table).getByRole('columnheader', { name: /^ChatGPT mentioned/ })).toHaveAttribute('aria-sort');
  });

  it('shows only the engines the Engine filter names', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&engine=gemini_web' });
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^Gemini mentioned/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeNull();
  });
```

The topic id in the third test is `MOCK_TERM_IDS.technicalSeo` (`mockId('term', 2)`); import `MOCK_TERM_IDS` from `@/mocks/entity-fixtures` and write `MOCK_TERM_IDS.technicalSeo` instead of the literal if you prefer. If the sort control of a header is named differently in `DataTable` (read `components/app/data-table/data-table.tsx` for the header button's name), use that name.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts/prompts.test.tsx`
Expected: the 4 new tests FAIL (no engine column headers, the branded prompt never shows).

- [ ] **Step 3: Add the words**

In `apps/web/messages/en.json`, in `prompts.columns`, add after `"noTopic": "No topic"` (put a comma after it):

```json
      "mentioned": "{engine} mentioned",
      "cited": "{engine} cited",
      "mentionedTip": "Answers that name your brand, of the valid answers in the window",
      "citedTip": "Answers that cite your domain, of the valid answers in the window",
      "noAnswers": "No answers",
      "noAnswersTip": "No answer in this window yet. Each prompt is asked twice a week.",
      "noValidTip": "{count, plural, one {# answer} other {# answers}} in this window, none of them valid"
```

and in `prompts`, after the `"columns": { ... }` object (put a comma after its closing brace):

```json
    "filters": {
      "topic": "Topic",
      "country": "Country",
      "engine": "Engine",
      "branded": "Branded prompts",
      "brandedInclude": "Included"
    }
```

- [ ] **Step 4: Rewrite the columns**

Replace the contents of `apps/web/src/features/prompts/prompt-columns.tsx` with:

```tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { countText } from './prompt-model';
import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import type { EngineSummary, MetricCell, ProjectEngine, Prompt, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE } from '@/lib/format';
import type { SortKey } from '@/lib/tables/table-state';

/** A row of the Prompts tab: the prompt, its counts when the summary has them, and its facts in words. */
export interface PromptRow {
  prompt: Prompt;
  summary: PromptSummaryRow | undefined;
  /** The prompt's topics, joined; `null` without one. */
  topics: string | null;
  /** The country's name; `null` for a prompt without a country. */
  country: string | null;
}

/** A to Z by the prompt's text. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'prompt', desc: false }];

const METRICS = ['mentioned', 'cited'] as const;
type EngineMetric = (typeof METRICS)[number];
/** "Google AI Mode mentioned" in capitals with its sort arrow needs about 176 px. */
const ENGINE_COLUMN_WIDTH = 176;

/**
 * Two columns per engine, Mentioned and Cited, each a count of valid answers ("4 of 8", spec section 4.5).
 * A prompt without an answer in the window says so; one whose answers all failed shows "n/a" with how many
 * there were. `cellsOf` must keep its identity between renders (a module-level function).
 */
export function useEngineColumns<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
  { sortable }: { sortable: boolean },
): DataTableColumn<TRow>[] {
  const t = useTranslations('prompts.columns');
  return useMemo(
    () =>
      engines.flatMap((engine) => {
        const code = engine.engine.engine_code;
        const label = engine.engine.label;
        const cellOf = (row: TRow, metric: EngineMetric): MetricCell | undefined =>
          cellsOf(row)?.find((cell) => cell.engine_code === code)?.[metric];
        const unknown = (row: TRow, metric: EngineMetric): UnknownValue => {
          const cell = cellOf(row, metric);
          return cell === undefined || cell.n_observations === 0
            ? { label: t('noAnswers'), tooltip: t('noAnswersTip') }
            : { label: EMPTY_VALUE, tooltip: t('noValidTip', { count: cell.n_observations }) };
        };
        return METRICS.map(
          (metric): DataTableColumn<TRow> => ({
            ...col.text<TRow>(`${code}_${metric}`, (row) => countText(cellOf(row, metric)), {
              header: t(metric, { engine: label }),
              headerTooltip: t(`${metric}Tip`),
              width: ENGINE_COLUMN_WIDTH,
              sortable,
              unknown: (row) => unknown(row, metric),
            }),
            // A count sorts by its ratio, not by its text; an empty cell sorts last both ways
            ...(sortable ? { sortValue: (row: TRow) => cellOf(row, metric)?.value ?? null } : {}),
          }),
        );
      }),
    [engines, cellsOf, sortable, t],
  );
}

export interface PromptColumns {
  columns: readonly DataTableColumn<PromptRow>[];
  /** The ids `?sort=` may name. */
  sortFields: ReadonlySet<string>;
  searchText: (row: PromptRow) => string;
  rowName: (row: PromptRow) => string;
}

const cellsOfPrompt = (row: PromptRow): readonly EngineSummary[] | undefined => row.summary?.engines;

/** The columns of the Prompts tab (ADR-DS-022 decision 9): Prompt, Topic, Country, then each engine shown. */
export function usePromptColumns(engines: readonly ProjectEngine[]): PromptColumns {
  const t = useTranslations('prompts');
  const locale = useLocale();
  const engineColumns = useEngineColumns(engines, cellsOfPrompt, { sortable: true });
  return useMemo(() => {
    const columns: DataTableColumn<PromptRow>[] = [
      col.keyword<PromptRow>('prompt', (row) => row.prompt.current_version.text, {
        header: t('columns.prompt'),
        trailing: (row) => (row.prompt.is_branded ? <Badge>{t('branded')}</Badge> : null),
      }),
      col.text<PromptRow>('topic', (row) => row.topics, {
        header: t('columns.topic'),
        priority: 2,
        unknown: () => ({ label: t('columns.noTopic') }),
      }),
      col.text<PromptRow>('country', (row) => row.country, { header: t('columns.country'), priority: 3, width: 136 }),
      ...engineColumns,
    ];
    return {
      columns,
      sortFields: new Set(columns.flatMap((column) => (column.sortValue === undefined ? [] : [column.id]))),
      searchText: (row) => `${row.prompt.current_version.text} ${row.topics ?? ''}`.toLocaleLowerCase(locale),
      rowName: (row) => row.prompt.current_version.text,
    };
  }, [t, locale, engineColumns]);
}
```

- [ ] **Step 5: Rewrite the screen**

Replace the contents of `apps/web/src/features/prompts/prompts-screen.tsx` with:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, MessageSquare, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo, type ReactNode } from 'react';

import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';
import { DEFAULT_WINDOW, hasAnswers, parseWindow, topicTermsOf, WINDOW_DAYS, windowRange } from './prompt-model';
import { enginesQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import type { FilterField } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { useErrorId } from '@/lib/api/use-error-id';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { formatBusinessDate, formatList } from '@/lib/format';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import {
  DEFAULT_DENSITY,
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

export interface PromptsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the window's days are its days. */
  timeZone: string;
  /** The project's defaults, which Add prompts starts on. */
  defaultLanguage: string | null;
  defaultCountryIso: string | null;
}

export interface PromptsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: PromptsProject;
}

/** The URL's keys besides the filters': the window and the table's state. */
const VIEW_STATE = {
  window: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
};

const promptRowId = (row: PromptRow): string => row.prompt.prompt_id;

/**
 * AI > Topics & Prompts (spec 2026-11-11 section 4.6, ADR-DS-022): the project's prompts over a window of
 * days (28 by default, in the top bar as a project-wide scope), with Mentioned and Cited per enabled engine.
 * The filter bar narrows by topic, country and engine; branded prompts are left out of the table and the
 * counts until the Branded filter includes them (16-metrics-methodology.md rule 4). A project without an
 * engine on is sent to Settings > Engines; until the first answers arrive the page says when they come.
 */
export function PromptsScreen(props: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <PromptsContent {...props} />;
}

function PromptsContent({ workspaceId, workspaceSlug, project }: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const common = useTranslations('common');
  const locale = useLocale();
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const windowDays = parseWindow(view.window);
  // The same date all UTC day; a new day is read at midnight UTC
  const now = useUtcDay();
  const range = useMemo(() => windowRange(windowDays, now, project.timeZone), [windowDays, now, project.timeZone]);

  const engines = useQuery(enginesQuery(scope));
  const enginesErrorId = useErrorId(engines.error);
  const enabled = useMemo(() => (engines.data?.data ?? []).filter((engine) => engine.is_enabled), [engines.data]);
  const { countries } = useCountries();
  const countryName = useMemo(
    () => new Map(countries.map((country) => [country.country_iso, country.name])),
    [countries],
  );
  const list = usePromptList(scope);
  const listErrorId = useErrorId(list.error);

  // The options come from the prompts and the engines; a value from a link waits for them
  const fields = useMemo((): FilterField[] => {
    const topicNames = new Map<string, string>();
    for (const prompt of list.rows) for (const term of topicTermsOf(prompt)) topicNames.set(term.term_id, term.name);
    const isos = [...new Set(list.rows.flatMap((prompt) => (prompt.country_iso === null ? [] : [prompt.country_iso])))];
    return [
      {
        id: 'topic',
        kind: 'enum',
        label: t('filters.topic'),
        multi: true,
        optionsLoading: list.loading,
        options: [...topicNames].map(([value, label]) => ({ value, label })),
      },
      {
        id: 'country',
        kind: 'enum',
        label: t('filters.country'),
        multi: true,
        optionsLoading: list.loading,
        options: isos.map((iso) => ({ value: iso, label: countryName.get(iso) ?? iso })),
      },
      {
        id: 'engine',
        kind: 'enum',
        label: t('filters.engine'),
        multi: true,
        optionsLoading: engines.isPending,
        options: enabled.map((engine) => ({ value: engine.engine.engine_code, label: engine.engine.label })),
      },
      {
        id: 'branded',
        kind: 'enum',
        label: t('filters.branded'),
        multi: false,
        options: [{ value: 'include', label: t('filters.brandedInclude') }],
      },
    ];
  }, [t, list.rows, list.loading, countryName, enabled, engines.isPending]);
  const [values, setValues] = useUrlFilters(fields);
  const filtered = Object.keys(values).length > 0;
  const clearFilters = useCallback(() => setValues({}), [setValues]);
  const includeBranded = enumValuesOf(values.branded).includes('include');
  const shown = useMemo(() => {
    const chosen = enumValuesOf(values.engine);
    return chosen.length === 0 ? enabled : enabled.filter((engine) => chosen.includes(engine.engine.engine_code));
  }, [enabled, values.engine]);

  const summary = useQuery({ ...summaryQuery(scope, range, includeBranded), enabled: enabled.length > 0 });
  const summaryById = useMemo(
    () => new Map((summary.data?.data.prompts ?? []).map((row) => [row.prompt_id, row])),
    [summary.data],
  );
  const rows = useMemo((): PromptRow[] => {
    const topics = enumValuesOf(values.topic);
    const chosenCountries = enumValuesOf(values.country);
    return list.rows
      .filter(
        (prompt) =>
          (includeBranded || !prompt.is_branded) &&
          (topics.length === 0 || topicTermsOf(prompt).some((term) => topics.includes(term.term_id))) &&
          (chosenCountries.length === 0 ||
            (prompt.country_iso !== null && chosenCountries.includes(prompt.country_iso))),
      )
      .map((prompt) => {
        const topicNames = topicTermsOf(prompt).map((term) => term.name);
        return {
          prompt,
          summary: summaryById.get(prompt.prompt_id),
          topics: topicNames.length === 0 ? null : formatList(topicNames, locale),
          country: prompt.country_iso === null ? null : (countryName.get(prompt.country_iso) ?? prompt.country_iso),
        };
      });
  }, [list.rows, includeBranded, values.topic, values.country, summaryById, countryName, locale]);

  const { columns, sortFields, searchText, rowName } = usePromptColumns(shown);
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, sortFields);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort, sortFields]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['prompt']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  const waiting = list.loading || engines.isPending || (enabled.length > 0 && summary.isPending);
  const status = ((): TableStatus => {
    if (list.error !== null && list.rows.length === 0) return 'error';
    if (waiting) return 'loading';
    if (rows.length === 0) return 'filtered-empty';
    return summary.isFetching ? 'refetching' : 'ready';
  })();
  const noAnswers = summary.data !== undefined && list.rows.length > 0 && !hasAnswers(summary.data.data);

  const listError = (
    <InlineError
      title={t('loadFailed')}
      reason={t('loadFailedReason')}
      errorId={listErrorId}
      onRetry={list.refetch}
      retrying={list.fetching}
      retryLabel={common('retry')}
      live
    />
  );
  const filteredEmpty = (
    <EmptyState
      title={t('emptyFiltered')}
      reason={t('emptyFilteredReason')}
      headingLevel={2}
      details={filtered ? <ReadOnlyFilterChips fields={fields} values={values} /> : undefined}
      primaryAction={
        filtered ? (
          <Button variant="secondary" onClick={clearFilters}>
            {t('clearFilters')}
          </Button>
        ) : undefined
      }
    />
  );
  const noPrompts = (
    <EmptyState icon={MessageSquare} title={t('noPromptsTitle')} reason={t('noPromptsReason')} headingLevel={2} />
  );
  const promptsTable = (
    <DataTable<PromptRow>
      caption={t('caption')}
      itemNoun={{ one: t('noun.one'), other: t('noun.other') }}
      columns={columns}
      getRowId={promptRowId}
      rows={rows}
      total={rows.length}
      sort={sort}
      onSortChange={(next) => void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) })}
      defaultSort={DEFAULT_SORT}
      density={density}
      onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
      columnState={{
        visible,
        onChange: (next) => void setView({ cols: next === null ? null : formatColumns(next) }),
      }}
      search={view.q}
      onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
      searchPlaceholder={t('search')}
      searchText={searchText}
      rowName={rowName}
      status={status}
      errorState={listError}
      emptyState={noPrompts}
      filteredEmptyState={filteredEmpty}
    />
  );

  let content: ReactNode;
  if (engines.isError) {
    content = (
      <InlineError
        title={t('enginesFailed')}
        reason={t('loadFailedReason')}
        errorId={enginesErrorId}
        onRetry={() => void engines.refetch()}
        retrying={engines.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (engines.data !== undefined && enabled.length === 0) {
    content = (
      <EmptyState
        icon={Power}
        title={t('noEngineTitle')}
        reason={t('noEngineReason')}
        headingLevel={2}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
            {t('toEngines')}
          </TextLink>
        }
      />
    );
  } else if (!list.loading && list.error === null && list.rows.length === 0) {
    content = noPrompts;
  } else {
    content = (
      <>
        {noAnswers ? <Banner tone="info" placement="region" message={t('noAnswers')} /> : null}
        {summary.isError ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('summaryFailed')}
            actions={
              <Button variant="secondary" size="sm" onClick={() => void summary.refetch()} loading={summary.isFetching}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">{promptsTable}</div>
      </>
    );
  }

  return (
    <>
      <TopBarPortal>
        <div className="w-44">
          <Select<string>
            aria-label={t('window')}
            value={String(windowDays)}
            onValueChange={(next) => void setView({ window: next === String(DEFAULT_WINDOW) ? null : next })}
            placeholder={t('window')}
            options={WINDOW_DAYS.map((days) => ({ value: String(days), label: t('windowOption', { days }) }))}
          />
        </div>
      </TopBarPortal>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <PageHeader
          title={t('title')}
          meta={t('meta', {
            from: formatBusinessDate(range.from, { withYear: false }),
            to: formatBusinessDate(range.to),
          })}
          toolbar={<FilterBar fields={fields} values={values} onChange={setValues} />}
        />
        {content}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/prompts`
Expected: every file passes; `prompts.test.tsx` has 9 tests.

Then the gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/prompts/prompt-columns.tsx apps/web/src/features/prompts/prompts-screen.tsx \
  apps/web/src/features/prompts/prompts.test.tsx apps/web/messages/en.json
git commit -m "Prompts tab: Mentioned and Cited per enabled engine, filters for topic, country, engine and branded"
```

---

### Task 6: Topics tab, and the two tabs with Topics first

**Read first:**
- `docs/design-system/adr/ADR-DS-022-topics-and-prompts.md` decisions 2, 3, 6 and 9
- `apps/web/src/components/app/data-table/types.ts` (`RowTree`, `rowTree`, `onToggleGroup`: a tree table shows rows in the order given and does not sort or search itself)
- `apps/web/src/features/rankings/grouped/use-grouped-table.ts` (a tree table in use)
- `apps/web/src/components/ui/tabs.tsx` (`Tabs`, `TabsPanel`)
- `apps/web/src/features/prompts/prompts-screen.tsx` and `prompt-columns.tsx` as task 5 left them

**Files:**
- Create: `apps/web/src/features/prompts/topics-table.tsx`
- Modify: `apps/web/src/features/prompts/prompts-screen.tsx`, `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/prompts.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/features/prompts/prompts.test.tsx`, inside `describe('Topics & Prompts', ...)`:

```tsx
  it('opens on Topics: one row per topic with its prompt count and engine counts, largest first', async () => {
    const { container, user } = renderWithProviders(promptsAs('viewer'));
    const tree = await screen.findByRole('treegrid', { name: 'Topics' });
    const rowheaders = await within(tree).findAllByRole('rowheader');
    expect(rowheaders.map((cell) => cell.textContent)).toEqual([
      'SEO',
      'Content Marketing',
      'Technical SEO',
      'Blog Strategy',
      'Local SEO',
      'No topic',
      'Paid Search',
    ]);
    expect(within(tree).getByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeInTheDocument();
    // A topic opens in place and lists its prompts under it; the branded one stays out
    await user.click(within(tree).getByRole('button', { name: 'Expand SEO, 5 prompts' }));
    expect(await within(tree).findByText('Which SEO agency is best for a SaaS startup in Germany?')).toBeInTheDocument();
    expect(within(tree).queryByText('Is Fynix a good SEO agency for software companies?')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('switches to the Prompts tab and back, keeping the filters', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: `?topic=${encodeURIComponent('0192d1a8-e005-7a10-8e05-000000000002')}`,
    });
    const tree = await screen.findByRole('treegrid', { name: 'Topics' });
    await waitFor(() => expect(within(tree).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Technical SEO']));
    await user.click(screen.getByRole('tab', { name: 'Prompts' }));
    const table = await grid();
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).queryByText('Which tools track local rankings by city?')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Topics' }));
    expect(await screen.findByRole('treegrid', { name: 'Topics' })).toBeInTheDocument();
  });
```

Add `waitFor` to the `@testing-library/react` import of the file.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts/prompts.test.tsx`
Expected: the 2 new tests FAIL (`Unable to find role="treegrid"`).

- [ ] **Step 3: Add the words**

In `apps/web/messages/en.json`, in `prompts`, add after `"summaryFailed": "...",`:

```json
    "summaryLoadFailed": "The topics could not be loaded.",
```

and after the `"filters": { ... }` object (put a comma after its closing brace):

```json
    "tabs": {
      "label": "Topics and prompts",
      "topics": "Topics",
      "prompts": "Prompts"
    },
    "topics": {
      "caption": "Topics",
      "noun": {
        "one": "topic",
        "other": "topics"
      },
      "search": "Search topics and prompts",
      "topic": "Topic",
      "prompts": "Prompts",
      "expand": "Expand {name}, {count, plural, one {# prompt} other {# prompts}}",
      "collapse": "Collapse {name}, {count, plural, one {# prompt} other {# prompts}}"
    }
```

- [ ] **Step 4: Write the Topics table**

Create `apps/web/src/features/prompts/topics-table.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useEngineColumns } from './prompt-columns';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn, RowTree, TableStatus } from '@/components/app/data-table/types';
import type { EngineSummary, ProjectEngine, PromptsSummary } from '@/lib/api/types';
import { EMPTY_VALUE } from '@/lib/format';
import type { Density, SortKey } from '@/lib/tables/table-state';

/** A topic, or one of its prompts while the topic is open. */
type TopicRow =
  | {
      kind: 'topic';
      id: string;
      /** The term id, or `__none` for the prompts without a topic. */
      key: string;
      name: string;
      promptCount: number;
      engines: readonly EngineSummary[];
      position: number;
    }
  | {
      kind: 'prompt';
      /** Topic and prompt: a prompt of two topics is a row under each. */
      id: string;
      promptId: string;
      name: string;
      engines: readonly EngineSummary[];
      position: number;
      siblings: number;
    };

const NO_TOPIC = '__none';
const NO_SORT: readonly SortKey[] = [];
const rowId = (row: TopicRow): string => row.id;
const rowName = (row: TopicRow): string => row.name;
const cellsOf = (row: TopicRow): readonly EngineSummary[] => row.engines;
/** The mention rate on the engine; a prompt without one comes last. */
const mentionedOn = (engines: readonly EngineSummary[], code: string | undefined): number =>
  engines.find((engine) => engine.engine_code === code)?.mentioned.value ?? -1;

export interface TopicsTableProps {
  /** The prompts summary of the window; `undefined` while it loads. */
  summary: PromptsSummary | undefined;
  /** The engines shown, in order. */
  engines: readonly ProjectEngine[];
  /** The topics the filter keeps; empty keeps every one. */
  topicFilter: readonly string[];
  status: TableStatus;
  errorState: ReactNode;
  filteredEmptyState: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
}

/**
 * The Topics tab (ADR-DS-022 decisions 2 and 3): one row per topic with its prompts in scope, the largest
 * first, and per engine its Mentioned and Cited counts, which the API computes from the topic's prompts. A
 * topic opens in place and lists its prompts, most mentioned first on the first engine shown. Prompts
 * without a topic share a row, "No topic". The search finds a topic by its name or by one of its prompts.
 */
export function TopicsTable({
  summary,
  engines,
  topicFilter,
  status,
  errorState,
  filteredEmptyState,
  search,
  onSearchChange,
  density,
  onDensityChange,
}: TopicsTableProps): ReactElement {
  const t = useTranslations('prompts');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const engineColumns = useEngineColumns(engines, cellsOf, { sortable: false });
  const columns = useMemo(
    (): DataTableColumn<TopicRow>[] => [
      col.keyword<TopicRow>('topic', rowName, { header: t('topics.topic'), sortable: false }),
      col.count<TopicRow>('prompts', (row) => (row.kind === 'topic' ? row.promptCount : null), {
        header: t('topics.prompts'),
        sortable: false,
        minWidth: 100,
        unknown: () => ({ label: EMPTY_VALUE }),
      }),
      ...engineColumns,
    ],
    [t, engineColumns],
  );
  const firstEngine = engines[0]?.engine.engine_code;
  const rows = useMemo((): TopicRow[] => {
    if (summary === undefined) return [];
    const query = search.trim().toLocaleLowerCase();
    const groups = summary.topics
      .filter((topic) => topicFilter.length === 0 || (topic.term_id !== null && topicFilter.includes(topic.term_id)))
      .map((topic) => ({
        topic,
        name: topic.name ?? t('columns.noTopic'),
        members: summary.prompts
          .filter((prompt) =>
            topic.term_id === null ? prompt.topic_term_ids.length === 0 : prompt.topic_term_ids.includes(topic.term_id),
          )
          .sort((a, b) => mentionedOn(b.engines, firstEngine) - mentionedOn(a.engines, firstEngine)),
      }))
      .filter(
        ({ name, members }) =>
          query === '' ||
          name.toLocaleLowerCase().includes(query) ||
          members.some((member) => member.text.toLocaleLowerCase().includes(query)),
      )
      .sort((a, b) => b.topic.prompt_count - a.topic.prompt_count || a.name.localeCompare(b.name));
    return groups.flatMap(({ topic, name, members }, index): TopicRow[] => {
      const key = topic.term_id ?? NO_TOPIC;
      const head: TopicRow = {
        kind: 'topic',
        id: `topic:${key}`,
        key,
        name,
        promptCount: topic.prompt_count,
        engines: topic.engines,
        position: index + 1,
      };
      if (!open.has(key)) return [head];
      return [
        head,
        ...members.map(
          (member, at): TopicRow => ({
            kind: 'prompt',
            id: `${key}:${member.prompt_id}`,
            promptId: member.prompt_id,
            name: member.text,
            engines: member.engines,
            position: at + 1,
            siblings: members.length,
          }),
        ),
      ];
    });
  }, [summary, topicFilter, search, open, t, firstEngine]);
  const topicCount = rows.filter((row) => row.kind === 'topic').length;
  const rowTree = (row: TopicRow): RowTree =>
    row.kind === 'topic'
      ? {
          level: 1,
          expanded: open.has(row.key),
          setSize: topicCount,
          posInSet: row.position,
          label: t(open.has(row.key) ? 'topics.collapse' : 'topics.expand', {
            name: row.name,
            count: row.promptCount,
          }),
        }
      : { level: 2, setSize: row.siblings, posInSet: row.position };
  const toggle = (row: TopicRow): void => {
    if (row.kind !== 'topic') return;
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };
  return (
    <DataTable<TopicRow>
      caption={t('topics.caption')}
      itemNoun={{ one: t('topics.noun.one'), other: t('topics.noun.other') }}
      columns={columns}
      getRowId={rowId}
      rows={rows}
      total={topicCount}
      sort={NO_SORT}
      onSortChange={() => undefined}
      defaultSort={NO_SORT}
      density={density}
      onDensityChange={onDensityChange}
      columnState={{ visible, onChange: setVisible }}
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t('topics.search')}
      rowName={rowName}
      rowTree={rowTree}
      onToggleGroup={toggle}
      status={status === 'ready' && rows.length === 0 ? 'filtered-empty' : status}
      errorState={errorState}
      emptyState={filteredEmptyState}
      filteredEmptyState={filteredEmptyState}
    />
  );
}
```

- [ ] **Step 5: Put the tabs on the screen**

Make these edits in `apps/web/src/features/prompts/prompts-screen.tsx`:

1. Replace the import line

```ts
import { DEFAULT_WINDOW, hasAnswers, parseWindow, topicTermsOf, WINDOW_DAYS, windowRange } from './prompt-model';
```

with

```ts
import {
  DEFAULT_WINDOW,
  hasAnswers,
  parseTab,
  parseWindow,
  PROMPTS_TABS,
  topicTermsOf,
  WINDOW_DAYS,
  windowRange,
  type PromptsTab,
} from './prompt-model';
```

2. After `import { enginesQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';` add

```ts
import { TopicsTable } from './topics-table';
```

3. After `import { Select } from '@/components/ui/select';` add

```ts
import { Tabs, TabsPanel } from '@/components/ui/tabs';
```

4. In `VIEW_STATE`, add `tab: parseAsString,` as the first member, and change its comment to `/** The URL's keys besides the filters': the tab, the window and the table's state. */`.

5. Replace `  const windowDays = parseWindow(view.window);` with

```ts
  const tab = parseTab(view.tab);
  const windowDays = parseWindow(view.window);
```

6. In `fields`, replace the `country` field

```ts
      {
        id: 'country',
        kind: 'enum',
        label: t('filters.country'),
        multi: true,
        optionsLoading: list.loading,
        options: isos.map((iso) => ({ value: iso, label: countryName.get(iso) ?? iso })),
      },
```

with

```ts
      // A topic's counts come from the API for all of its prompts, so the Topics tab takes no country filter
      ...(tab === 'prompts'
        ? [
            {
              id: 'country',
              kind: 'enum' as const,
              label: t('filters.country'),
              multi: true,
              optionsLoading: list.loading,
              options: isos.map((iso) => ({ value: iso, label: countryName.get(iso) ?? iso })),
            },
          ]
        : []),
```

and change the dependency list of `fields` from `[t, list.rows, list.loading, countryName, enabled, engines.isPending]` to `[t, tab, list.rows, list.loading, countryName, enabled, engines.isPending]`.

7. After the line `  const noAnswers = summary.data !== undefined && list.rows.length > 0 && !hasAnswers(summary.data.data);` add

```ts
  const topicFilter = useMemo(() => enumValuesOf(values.topic), [values.topic]);
  const summaryErrorId = useErrorId(summary.error);
  const topicStatus = ((): TableStatus => {
    if (summary.isError && summary.data === undefined) return 'error';
    if (waiting) return 'loading';
    return summary.isFetching ? 'refetching' : 'ready';
  })();
  const summaryError = (
    <InlineError
      title={t('summaryLoadFailed')}
      reason={t('loadFailedReason')}
      errorId={summaryErrorId}
      onRetry={() => void summary.refetch()}
      retrying={summary.isFetching}
      retryLabel={common('retry')}
      live
    />
  );
```

8. Replace the line `        <div className="flex min-h-0 flex-1 flex-col">{promptsTable}</div>` with

```tsx
        <Tabs
          variant="underline"
          label={t('tabs.label')}
          value={tab}
          onValueChange={(next: PromptsTab) => void setView({ tab: next === 'topics' ? null : next })}
          items={PROMPTS_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsPanel value="topics" className="flex min-h-0 flex-1 flex-col pt-3">
            <TopicsTable
              summary={summary.data?.data}
              engines={shown}
              topicFilter={topicFilter}
              status={topicStatus}
              errorState={summaryError}
              filteredEmptyState={filteredEmpty}
              search={view.q}
              onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
              density={density}
              onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
            />
          </TabsPanel>
          <TabsPanel value="prompts" className="flex min-h-0 flex-1 flex-col pt-3">
            {promptsTable}
          </TabsPanel>
        </Tabs>
```

9. In the component's doc comment, add the sentence: `The Topics tab comes first and lists topics with their prompts under them; the Prompts tab is the flat table (ADR-DS-022 decisions 1, 2 and 9). Both tabs share the filter bar and the window.`

- [ ] **Step 6: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/prompts`
Expected: every file passes; `prompts.test.tsx` has 11 tests.

Then the gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/prompts/topics-table.tsx apps/web/src/features/prompts/prompts-screen.tsx \
  apps/web/src/features/prompts/prompts.test.tsx apps/web/messages/en.json
git commit -m "Topics tab: one row per topic with its prompts under it, the default tab of Topics & Prompts"
```

---

### Task 7: Add prompts dialog

**Read first:**
- `apps/web/src/features/rankings/add-keywords/add-keywords-dialog.tsx` (one item per line in a `Textarea`, shared fields, `useSubmitOnce`, `Dialog` with `dirty` and `discard`, the result view after a partial add)
- `apps/web/src/components/app/forms/form-field.tsx` (`FormField`, `controlProps`)
- `apps/web/src/lib/keywords/taxonomy-reads.ts` (`useVocabularies`: the project's vocabularies with their terms)
- Plan A task 8 (`bulk-create` rejects with `index` and `code`; `lint` returns one result per text with `text` as it would be saved, and the workspace `quota`)
- The design preview's add dialog, `apps/web/design-preview/prompts.js` lines 960 to 1060 (one field for one prompt or a list, findings per line, the quota line)

**Files:**
- Create: `apps/web/src/features/prompts/add-prompts-dialog.tsx`
- Modify: `apps/web/src/features/prompts/prompts-screen.tsx`, `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/add-prompts.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/prompts/add-prompts.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const TRACKED = 'Which SEO agency is best for a SaaS startup in Germany?';

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

async function openDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
  // The header's button shows once the prompts have loaded
  await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
  return screen.findByRole('dialog', { name: 'Add prompts' });
}

describe('Add prompts', () => {
  it('reads a pasted list, leaves out repeats and tracked prompts, shows the quota, and adds the rest', async () => {
    const { user, container } = renderWithProviders(promptsAs('editor'), { searchParams: '?tab=prompts' });
    const dialog = await openDialog(user);
    const field = within(dialog).getByRole('textbox', { name: 'Prompts' });
    await user.click(field);
    await user.paste(`Which agency audits shop sites in Munich?\n${TRACKED}\nWhich agency audits shop sites in Munich?`);
    expect(await within(dialog).findByText('Line 2 is already tracked and is left out.')).toBeInTheDocument();
    expect(within(dialog).getByText('Line 3 repeats line 1 and is left out.')).toBeInTheDocument();
    expect(await within(dialog).findByText('Adds 1 prompt of your remaining 126.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 prompt' }));
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add prompts' })).toBeNull());
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    expect(await within(table).findByText('Which agency audits shop sites in Munich?')).toBeInTheDocument();
  });

  it('notes a branded line and refuses a line too long to save', async () => {
    const { user } = renderWithProviders(promptsAs('editor'));
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(`Is Fynix any good?\n${'x'.repeat(2100)}`);
    expect(
      await within(dialog).findByText(
        'Line 1 names Fynix, so it counts as branded and stays out of the rates unless branded prompts are included.',
      ),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText('Line 2 is longer than 2,000 characters and cannot be added.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 prompts' }));
    expect(await within(dialog).findByText('Some lines cannot be added. Fix or remove them first.')).toBeInTheDocument();
  });

  it('lists the lines the API refused, with their line numbers, after a partial add', async () => {
    server.use(
      http.post(mswPath(`${P}/prompts/bulk-create`), () =>
        HttpResponse.json({
          data: {
            created: ['0192d1a8-e000-7a10-8e00-000000000100'],
            skipped: [{ index: 1, existing_id: '0192d1a8-e000-7a10-8e00-000000000001' }],
            rejected: [{ index: 2, code: 'location_not_supported', message: 'ChatGPT runs in no location of this country.' }],
          },
        }),
      ),
    );
    const { user } = renderWithProviders(promptsAs('editor'));
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('First question?\nSecond question?\nThird question?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 3 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Prompts added' });
    expect(within(result).getByText('1 prompt was added.')).toBeInTheDocument();
    expect(within(result).getByText('1 was already tracked.')).toBeInTheDocument();
    expect(within(result).getByText('Line 3: an enabled engine does not ask in this country.')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says the workspace is out of room when the API refuses the add for the quota', async () => {
    server.use(
      http.post(mswPath(`${P}/prompts/bulk-create`), () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Workspace limit reached', status: 422, code: 'quota_exceeded', limit: 150, used: 150, requested: 1 },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(promptsAs('editor'));
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('One more question?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(
      await within(dialog).findByText(
        'The workspace has 150 of 150 active prompts, so these do not fit. Archive prompts you no longer need, then try again.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Add prompts only to a member with prompts:write', async () => {
    renderWithProviders(promptsAs('viewer'));
    await screen.findByRole('treegrid', { name: 'Topics' });
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts/add-prompts.test.tsx`
Expected: FAIL: no button named `Add prompts`.

- [ ] **Step 3: Add the words**

In `apps/web/messages/en.json`, in `prompts`, add after `"noAnswers": "...",`:

```json
    "addPrompts": "Add prompts",
```

and after the `"topics": { ... }` object (put a comma after its closing brace):

```json
    "add": {
      "title": "Add prompts",
      "description": "One prompt per line, written as a buyer would ask it. The prompts of one add share their topic, language and country.",
      "prompts": "Prompts",
      "promptsHint": "One prompt per line, up to {max} at once.",
      "counter": "{count, plural, one {# prompt} other {# prompts}}",
      "textRequired": "Enter at least one prompt.",
      "tooMany": "Add at most {max} prompts at once. This list has {count}.",
      "findingsLabel": "Checks of the list",
      "moreFindings": "And {count, number} more.",
      "findings": {
        "repeat": "Line {line} repeats line {first} and is left out.",
        "tracked": "Line {line} is already tracked and is left out.",
        "branded": "Line {line} names {brand}, so it counts as branded and stays out of the rates unless branded prompts are included.",
        "engineLimit": "Line {line} is too long for {engine}, which skips it.",
        "tooLong": "Line {line} is longer than {max} characters and cannot be added."
      },
      "topic": "Topic",
      "noTopic": "No topic",
      "language": "Language",
      "languageRequired": "Choose a language.",
      "country": "Country",
      "countryHint": "The market the prompts stand for. Only countries every enabled engine asks in are offered.",
      "countryRequired": "Choose a country.",
      "quota": "Adds {count, plural, one {# prompt} other {# prompts}} of your remaining {remaining, number}.",
      "quotaOver": "That is {count, plural, one {# prompt} other {# prompts}}, and the workspace has room for {remaining, number}. Remove lines or archive prompts you no longer need.",
      "fixLines": "Some lines cannot be added. Fix or remove them first.",
      "allTracked": "Every line is already tracked.",
      "submit": "{count, plural, =0 {Add prompts} one {Add # prompt} other {Add # prompts}}",
      "added": "{count, plural, one {# prompt added} other {# prompts added}}",
      "discardDescription": "The prompts you typed will be lost.",
      "quotaExceeded": "The workspace has {used} of {limit} active prompts, so these do not fit. Archive prompts you no longer need, then try again.",
      "invalid": "Some prompts could not be read. Check the lines and try again.",
      "forbidden": "You do not have permission to add prompts to this project.",
      "failed": "The prompts were not added. Try again in a moment.",
      "resultTitle": "Prompts added",
      "resultCreated": "{count, plural, =0 {No prompt was added.} one {# prompt was added.} other {# prompts were added.}}",
      "resultSkipped": "{count, plural, one {# was already tracked.} other {# were already tracked.}}",
      "rejectedTitle": "{count, plural, one {# line could not be added} other {# lines could not be added}}",
      "rejectedLine": "Line {line}: {reason}",
      "rejected": {
        "locationNotSupported": "an enabled engine does not ask in this country.",
        "termUnknown": "the topic cannot be used in this project.",
        "singleValuedVocabulary": "the topic belongs to a vocabulary that takes one term.",
        "duplicateInRequest": "the same prompt is in the list twice.",
        "duplicate": "the project already tracks this prompt."
      },
      "done": "Done"
    }
```

- [ ] **Step 4: Write the dialog**

Create `apps/web/src/features/prompts/add-prompts-dialog.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { BULK_MAX, countriesForEngines, promptKeyOf, readPromptLines } from './prompt-model';
import { BULK_CREATE_PROMPTS, refreshPrompts, usePromptLint, type PromptScope } from './prompt-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { ProjectEngine, Prompt, PromptBulkResult } from '@/lib/api/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatInteger } from '@/lib/format';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { useCountries } from '@/lib/locations/countries';
import { cn } from '@/lib/utils';

interface AddValues {
  text: string;
  /** A topic term, or `none`. */
  term_id: string;
  language_code: string;
  country_iso: string;
}

const NO_TOPIC = 'none';
/** The findings named under the field before the rest are counted. */
const SHOWN_FINDINGS = 5;
/** The lint asks this long after typing stops. */
const LINT_DELAY_MS = 300;
/** The longest prompt any engine takes (plan A `PROMPT_TEXT_MAX`). */
const PROMPT_MAX = 2000;

type FindingTone = 'error' | 'warning' | 'note';
interface Finding {
  line: number;
  tone: FindingTone;
  text: string;
}
const FINDING_ICON = { error: CircleAlert, warning: TriangleAlert, note: Info } as const;
const FINDING_CLASS: Readonly<Record<FindingTone, string>> = {
  error: cn('text-negative-text'),
  warning: cn('text-warning-text'),
  note: cn('text-foreground-secondary'),
};

/** The catalog key of each code `bulk-create` rejects an item with (plan A task 8). */
const REJECT_KEYS = {
  location_not_supported: 'locationNotSupported',
  term_unknown: 'termUnknown',
  single_valued_vocabulary: 'singleValuedVocabulary',
  duplicate_in_request: 'duplicateInRequest',
  duplicate: 'duplicate',
} as const;
const isRejectCode = (code: string): code is keyof typeof REJECT_KEYS => Object.hasOwn(REJECT_KEYS, code);

interface Outcome {
  created: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
}

export interface AddPromptsDialogProps {
  scope: PromptScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project's enabled engines: their countries and their length limits apply. */
  engines: readonly ProjectEngine[];
  /** The project's active prompts, to leave out what it already tracks. */
  existing: readonly Prompt[];
  defaults: { languageCode: string | null; countryIso: string | null };
}

/**
 * Add prompts (spec 2026-11-11 section 4.6): one field for one prompt or a pasted list, one per line, with a
 * shared topic, language and country. Before it saves, each line is checked: a repeat of an earlier line and a
 * prompt the project tracks are left out, the lint names a line that names the own brand (it counts as
 * branded) and one too long for an engine, and the quota line says how many of the workspace's remaining
 * prompts the add takes. The add goes through `bulk-create`; the lines it skipped or refused are listed after.
 */
export function AddPromptsDialog({
  scope,
  open,
  onOpenChange,
  engines,
  existing,
  defaults,
}: AddPromptsDialogProps): ReactElement {
  const t = useTranslations('prompts.add');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const create = useMutation(BULK_CREATE_PROMPTS);
  const { countries } = useCountries();
  const vocabularies = useVocabularies(scope);
  const [alert, setAlert] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const countryOptions = useMemo(
    () => countriesForEngines(engines, countries).map((country) => ({ value: country.country_iso, label: country.name })),
    [engines, countries],
  );
  const topicOptions = useMemo(
    () => [
      { value: NO_TOPIC, label: t('noTopic') },
      ...vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'topic')
        .flatMap((entry) => entry.terms.map((term) => ({ value: term.termId, label: term.path }))),
    ],
    [vocabularies.loaded, t],
  );
  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale) })),
    [locale],
  );

  const schema = z.object({
    text: z.string().superRefine((text, context) => {
      const { lines } = readPromptLines(text);
      if (lines.length === 0) context.addIssue({ code: 'custom', message: t('textRequired') });
      else if (lines.length > BULK_MAX) {
        context.addIssue({
          code: 'custom',
          message: t('tooMany', { max: formatInteger(BULK_MAX), count: formatInteger(lines.length) }),
        });
      }
    }),
    term_id: z.string(),
    language_code: z.string().min(1, { error: t('languageRequired') }),
    country_iso: z
      .string()
      .refine((value) => countryOptions.some((option) => option.value === value), { error: t('countryRequired') }),
  });
  const initialValues = (): AddValues => ({
    text: '',
    term_id: NO_TOPIC,
    language_code: defaults.languageCode ?? 'en',
    country_iso: defaults.countryIso ?? '',
  });
  const form = useForm<AddValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: initialValues(),
  });
  const text = useWatch({ control: form.control, name: 'text' });
  const language = useWatch({ control: form.control, name: 'language_code' });
  const country = useWatch({ control: form.control, name: 'country_iso' });

  const read = useMemo(() => readPromptLines(text), [text]);
  const tracked = useMemo(
    () => new Set(existing.map((prompt) => promptKeyOf(prompt.current_version.text, prompt.language_code, prompt.country_iso ?? ''))),
    [existing],
  );
  const isTracked = (line: string): boolean => tracked.has(promptKeyOf(line, language, country));
  const fresh = read.lines.filter((line) => !isTracked(line.text));
  const lineTexts = useMemo(() => read.lines.map((line) => line.text), [read]);
  const texts = useDebouncedValue(lineTexts, LINT_DELAY_MS);
  const lint = usePromptLint(
    scope,
    texts,
    engines.map((engine) => engine.engine.engine_code),
  );
  // The lint answers with each text as it would be saved, which is how the lines were read
  const lintOf = new Map((lint.data?.data ?? []).map((result) => [result.text, result]));
  const engineLabel = new Map(engines.map((engine) => [engine.engine.engine_code, engine.engine.label]));
  const findings: Finding[] = [
    ...read.repeats.map(({ line, first }): Finding => ({ line, tone: 'note', text: t('findings.repeat', { line, first }) })),
    ...read.lines.flatMap((line): Finding[] => {
      if (isTracked(line.text)) return [{ line: line.line, tone: 'note', text: t('findings.tracked', { line: line.line }) }];
      const result = lintOf.get(line.text);
      if (result === undefined) return [];
      return result.warnings.map((warning): Finding => {
        if (warning.rule === 'contains_brand_alias') {
          const brand = result.matched_aliases[0]?.entity.canonical_name ?? '';
          return { line: line.line, tone: 'note', text: t('findings.branded', { line: line.line, brand }) };
        }
        if (warning.severity === 'error') {
          return { line: line.line, tone: 'error', text: t('findings.tooLong', { line: line.line, max: formatInteger(PROMPT_MAX) }) };
        }
        const engine = warning.engine_code === null ? '' : (engineLabel.get(warning.engine_code) ?? warning.engine_code);
        return { line: line.line, tone: 'warning', text: t('findings.engineLimit', { line: line.line, engine }) };
      });
    }),
  ]
    // A line too long for every engine is one finding, not one per engine
    .filter((finding, index, all) => all.findIndex((other) => other.text === finding.text) === index)
    .sort((a, b) => a.line - b.line);
  const hasErrors = findings.some((finding) => finding.tone === 'error');
  const quota = lint.data?.quota ?? null;
  const remaining = quota === null ? null : Math.max(0, quota.limit - quota.used);
  const over = remaining !== null && fresh.length > remaining;

  const close = (): void => {
    form.reset(initialValues());
    setAlert(null);
    setOutcome(null);
    onOpenChange(false);
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      if (hasErrors) {
        setAlert(t('fixLines'));
        return;
      }
      if (over && remaining !== null) {
        setAlert(t('quotaOver', { count: fresh.length, remaining }));
        return;
      }
      const lines = readPromptLines(values.text).lines.filter(
        (line) => !tracked.has(promptKeyOf(line.text, values.language_code, values.country_iso)),
      );
      if (lines.length === 0) {
        setAlert(t('allTracked'));
        return;
      }
      setAlert(null);
      let result: PromptBulkResult;
      try {
        const answer = await create.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
          body: {
            items: lines.map((line) => ({
              text: line.text,
              language_code: values.language_code,
              country_iso: values.country_iso,
              term_ids: values.term_id === NO_TOPIC ? [] : [values.term_id],
            })),
            on_duplicate: 'skip',
          },
        });
        result = answer.data;
      } catch (error) {
        if (isApiProblem(error, 'quota_exceeded')) {
          setAlert(
            t('quotaExceeded', {
              used: formatInteger(error.number('used') ?? 0),
              limit: formatInteger(error.number('limit') ?? 0),
            }),
          );
        } else if (isApiProblem(error, 'validation_failed')) setAlert(t('invalid'));
        else if (isApiProblem(error, 'forbidden')) setAlert(t('forbidden'));
        else setAlert(t('failed'));
        return;
      }
      await refreshPrompts(queryClient, scope);
      const rejected = result.rejected.map((entry) => ({
        line: lines[entry.index]?.line ?? entry.index + 1,
        reason: isRejectCode(entry.code) ? t(`rejected.${REJECT_KEYS[entry.code]}`) : entry.message,
      }));
      if (rejected.length === 0 && result.skipped.length === 0) {
        toast({ type: 'success', title: t('added', { count: result.created.length }) });
        close();
        return;
      }
      setOutcome({ created: result.created.length, skipped: result.skipped.length, rejected });
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!create.isPending) close();
      }}
      size="md"
      dirty={outcome === null && form.formState.isDirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      {outcome === null ? (
        <form noValidate className="contents" onSubmit={submit}>
          <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
          <DialogBody>
            {alert === null ? null : <FormAlert message={alert} />}
            <FormField
              control={form.control}
              name="text"
              label={t('prompts')}
              description={t('promptsHint', { max: formatInteger(BULK_MAX) })}
              render={(field) => (
                <Textarea
                  {...field.controlProps}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  spellCheck={false}
                  submitOnModEnter
                  counter={read.lines.length === 0 ? null : t('counter', { count: read.lines.length })}
                  counterOver={read.lines.length > BULK_MAX}
                />
              )}
            />
            {findings.length === 0 ? null : (
              <ul aria-label={t('findingsLabel')} className="flex flex-col gap-1">
                {findings.slice(0, SHOWN_FINDINGS).map((finding) => (
                  <li
                    key={`${String(finding.line)} ${finding.text}`}
                    className={cn('flex items-start gap-1.5 type-meta', FINDING_CLASS[finding.tone])}
                  >
                    <Icon icon={FINDING_ICON[finding.tone]} size="sm" className="mt-0.5" />
                    {finding.text}
                  </li>
                ))}
                {findings.length > SHOWN_FINDINGS ? (
                  <li className="type-meta">{t('moreFindings', { count: findings.length - SHOWN_FINDINGS })}</li>
                ) : null}
              </ul>
            )}
            <FormField
              control={form.control}
              name="term_id"
              label={t('topic')}
              optional
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('topic')}
                  options={topicOptions}
                />
              )}
            />
            <FormField
              control={form.control}
              name="language_code"
              label={t('language')}
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('language')}
                  options={languageOptions}
                />
              )}
            />
            <FormField
              control={form.control}
              name="country_iso"
              label={t('country')}
              description={t('countryHint')}
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value === '' ? null : field.value}
                  onValueChange={field.onChange}
                  placeholder={t('country')}
                  options={countryOptions}
                />
              )}
            />
            {remaining === null ? null : (
              <p className={cn('type-meta', over && 'text-negative-text')}>
                {over
                  ? t('quotaOver', { count: fresh.length, remaining })
                  : t('quota', { count: fresh.length, remaining })}
              </p>
            )}
          </DialogBody>
          <DialogFooter
            primary={
              <Button type="submit" variant="primary" loading={create.isPending}>
                {t('submit', { count: fresh.length })}
              </Button>
            }
            secondary={
              <DialogClose>
                <Button variant="secondary">{common('cancel')}</Button>
              </DialogClose>
            }
          />
        </form>
      ) : (
        <>
          <DialogHeader title={t('resultTitle')} closeLabel={common('close')} />
          <DialogBody>
            <p className="type-body">{t('resultCreated', { count: outcome.created })}</p>
            {outcome.skipped === 0 ? null : <p className="type-body">{t('resultSkipped', { count: outcome.skipped })}</p>}
            {outcome.rejected.length === 0 ? null : (
              <>
                <p className="type-body-strong">{t('rejectedTitle', { count: outcome.rejected.length })}</p>
                <ul className="flex flex-col gap-1">
                  {outcome.rejected.map((entry) => (
                    <li key={entry.line} className="type-meta">
                      {t('rejectedLine', { line: entry.line, reason: entry.reason })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DialogBody>
          <DialogFooter
            primary={
              <Button variant="primary" onClick={close}>
                {t('done')}
              </Button>
            }
          />
        </>
      )}
    </Dialog>
  );
}
```

If `pnpm typecheck` reports that the vocabulary entry has no `kind`, read the `Vocabulary` schema in `src/lib/api/schema.ts` and use its member that holds the vocabulary kind (the list route filters by `filter[kind]`).

- [ ] **Step 5: Open it from the screen**

Make these edits in `apps/web/src/features/prompts/prompts-screen.tsx`:

1. Replace `import { Ban, MessageSquare, Power } from 'lucide-react';` with `import { Ban, MessageSquare, Plus, Power } from 'lucide-react';`.
2. Replace `import { useCallback, useMemo, type ReactNode } from 'react';` with `import { useCallback, useMemo, useState, type ReactNode } from 'react';`.
3. Before `import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';` add `import { AddPromptsDialog } from './add-prompts-dialog';`.
4. After the line `  const scope = useMemo((): PromptScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);` (inside `PromptsContent`) add:

```ts
  const canWrite = useCan('prompts:write');
  const [adding, setAdding] = useState(false);
```

5. Replace

```tsx
  const noPrompts = (
    <EmptyState icon={MessageSquare} title={t('noPromptsTitle')} reason={t('noPromptsReason')} headingLevel={2} />
  );
```

with

```tsx
  const addButton = canWrite ? (
    <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
      {t('addPrompts')}
    </Button>
  ) : undefined;
  const noPrompts = (
    <EmptyState
      icon={MessageSquare}
      title={t('noPromptsTitle')}
      reason={t('noPromptsReason')}
      headingLevel={2}
      primaryAction={addButton}
    />
  );
```

6. Replace

```tsx
          toolbar={<FilterBar fields={fields} values={values} onChange={setValues} />}
        />
        {content}
      </div>
    </>
```

with

```tsx
          actions={list.rows.length > 0 ? addButton : undefined}
          toolbar={<FilterBar fields={fields} values={values} onChange={setValues} />}
        />
        {content}
      </div>
      {canWrite ? (
        <AddPromptsDialog
          scope={scope}
          open={adding}
          onOpenChange={setAdding}
          engines={enabled}
          existing={list.rows}
          defaults={{ languageCode: project.defaultLanguage, countryIso: project.defaultCountryIso }}
        />
      ) : null}
    </>
```

While the project has no prompt the empty state carries the one Add button, so the header leaves it out.

- [ ] **Step 6: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/prompts`
Expected: every file passes; `add-prompts.test.tsx` has 5 tests.

Then the gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/prompts/add-prompts-dialog.tsx apps/web/src/features/prompts/add-prompts.test.tsx \
  apps/web/src/features/prompts/prompts-screen.tsx apps/web/messages/en.json
git commit -m "Add prompts: one prompt or a pasted list, checks per line, the quota line, bulk create with rejects"
```

---

### Task 8: Prompt inspector with its answers, Run now and Archive

**Read first:**
- `apps/web/src/features/operations/run-inspector.tsx` (an inspector: header with badges, `InspectorBody`, `InspectorSection` per card, `KeyValues`, the not-found and error states)
- `apps/web/src/features/operations/runs-screen.tsx` lines 230 to 260 and 330 to 365 (the inspector opened from a row, its position, Previous and Next, a new tab)
- `apps/web/src/components/app/inspector/use-inspector.ts`, `inspector.tsx`, `inspector-header.tsx`, `apps/web/src/components/app/table/plain-table.tsx`
- `apps/web/src/components/ui/toast.tsx` (an action, such as Undo)
- Plan B task 7 (Run now: `202` with the run; `409 check_pending` with `engine_codes`; `429 manual_run_limit`; `422 quota_exceeded`; `422 validation_failed` with `engine_not_enabled` or `prompt_too_long`; `503 provider_paused`; a used-up budget makes the run `budget_blocked`)

**Files:**
- Create: `apps/web/src/features/prompts/prompt-inspector.tsx`
- Modify: `apps/web/src/features/prompts/prompts-screen.tsx`, `apps/web/src/features/prompts/topics-table.tsx`, `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/prompt-inspector.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/prompts/prompt-inspector.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const [first] = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
if (first === undefined) throw new Error('The fixture prompts are missing');

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const opened = `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}`;
const panel = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: first.text });

describe('the prompt inspector', () => {
  it('shows the prompt’s facts, its counts per engine and its answers in the window', async () => {
    const { container } = renderWithProviders(promptsAs('viewer'), { searchParams: opened });
    const inspector = await panel();
    expect(await within(inspector).findByText('SEO')).toBeInTheDocument();
    expect(within(inspector).getByText('English')).toBeInTheDocument();
    expect(within(inspector).getByText('Germany')).toBeInTheDocument();
    expect(await within(inspector).findAllByText(/^Mentioned \d of [5-8], cited \d of [5-8]$/)).toHaveLength(2);
    const answers = await within(inspector).findByRole('table', { name: 'Answers to this prompt' });
    // Eight runs in 28 days on two engines
    await waitFor(() => expect(within(answers).getAllByRole('row')).toHaveLength(17));
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens from a row of the Prompts tab', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    await user.click(await within(table).findByText(first.text));
    expect(await panel()).toBeInTheDocument();
  });

  it('runs a prompt now on every enabled engine, and says an answer is on its way when asked again', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/run-now')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body));
      }
    });
    const { user } = renderWithProviders(promptsAs('analyst'), { searchParams: opened });
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Run queued')).toBeInTheDocument();
    expect(bodies).toEqual([{ engine_codes: ['chatgpt_web', 'gemini_web'] }]);
    await user.click(within(inspector).getByRole('button', { name: 'Run now' }));
    expect(
      await screen.findByText('An answer to this prompt is already on its way. Try again once it has arrived.'),
    ).toBeInTheDocument();
  });

  it('archives the prompt, closes the inspector, and brings it back with Undo', async () => {
    const { user } = renderWithProviders(promptsAs('editor'), { searchParams: opened });
    const inspector = await panel();
    await user.click(within(inspector).getByRole('button', { name: /^More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Prompt archived')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('complementary', { name: first.text })).toBeNull());
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    await waitFor(() => expect(within(table).queryByText(first.text)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await within(table).findByText(first.text)).toBeInTheDocument();
  });
});
```

If the inspector is not a `complementary` landmark named by its title in `src/components/app/inspector/inspector.tsx`, find it the way `src/features/operations/runs.test.tsx` does and use that.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts/prompt-inspector.test.tsx`
Expected: FAIL: no inspector opens.

- [ ] **Step 3: Add the words**

In `apps/web/messages/en.json`, in `prompts`, after the `"add": { ... }` object (put a comma after its closing brace):

```json
    "inspector": {
      "type": "Prompt",
      "noun": "prompt",
      "back": "Back to Topics & Prompts",
      "position": "{index} of {count}",
      "loadFailed": "The prompt could not be loaded.",
      "loadFailedReason": "The server did not answer. Try again in a moment.",
      "archivedBadge": "Archived",
      "facts": "Prompt",
      "topic": "Topic",
      "language": "Language",
      "country": "Country",
      "importance": "Importance",
      "added": "Added",
      "addedBy": "Added by",
      "system": "System",
      "byEngine": "By engine",
      "engineCounts": "Mentioned {mentioned}, cited {cited}",
      "noCounts": "No counts for this window",
      "noCountsReason": "Each prompt is asked twice a week; the counts follow its first answers.",
      "answers": "Answers",
      "answersCaption": "Answers to this prompt",
      "answersEmpty": "No answers in this window",
      "answersFailed": "The answers could not be loaded.",
      "columns": {
        "date": "Date",
        "engine": "Engine",
        "status": "Status",
        "outcome": "Outcome"
      },
      "statuses": {
        "complete": "Complete",
        "partial": "Partial",
        "empty": "Empty",
        "refused": "Refused",
        "error": "Failed"
      },
      "outcomes": {
        "mentionedAndCited": "Mentioned and cited",
        "mentionedOnly": "Mentioned only",
        "citedOnly": "Cited only",
        "neither": "Neither",
        "notCounted": "Not counted"
      },
      "openAnswer": "Open the {engine} answer of {date}",
      "runNow": "Run now",
      "runQueued": "Run queued",
      "runQueuedHint": "Answers arrive within minutes through the standard queue. A run the AI budget blocks waits in Runs.",
      "runFailedTitle": "Not queued",
      "runPending": "An answer to this prompt is already on its way. Try again once it has arrived.",
      "runLimit": "The project has used its manual runs for today (UTC). Try again tomorrow.",
      "runQuota": "The workspace has reached its AI answers for this month.",
      "runPaused": "Collection from the provider is paused. Try again later.",
      "runInvalid": "An engine of this project cannot ask this prompt. Check the Engines settings.",
      "runFailed": "The run was not queued. Try again in a moment.",
      "archive": "Archive",
      "archived": "Prompt archived",
      "archivedHint": "Its answers stay. It is no longer asked from the next run.",
      "archiveFailed": "The prompt was not archived. Try again in a moment.",
      "undo": "Undo",
      "restoreFailed": "The prompt was not brought back. Try again in a moment."
    }
```

- [ ] **Step 4: Write the inspector**

Create `apps/web/src/features/prompts/prompt-inspector.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ListChecks, MessageSquareText, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { countText, fitsEngine, topicTermsOf, type DateRange } from './prompt-model';
import {
  ARCHIVE_PROMPT,
  observationsQuery,
  promptQuery,
  refreshPrompts,
  RUN_NOW,
  UPDATE_PROMPT,
  type PromptScope,
} from './prompt-queries';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { KeyValues } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { MetricCell, ObservationSummary, ProjectEngine, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatDetailDateTime, formatInteger, formatList, formatTableDateTime } from '@/lib/format';
import { languageName } from '@/lib/format/language';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';

/** The catalog key of each outcome: the API's values are snake case, catalog keys camel case. */
const OUTCOME_KEYS = {
  mentioned_and_cited: 'mentionedAndCited',
  mentioned_only: 'mentionedOnly',
  cited_only: 'citedOnly',
  neither: 'neither',
} as const;

export interface PromptInspectorProps {
  scope: PromptScope;
  promptId: string;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** The window of the page: the answers listed are its answers. */
  range: DateRange;
  /** The project's enabled engines: the counts per engine and what Run now asks. */
  engines: readonly ProjectEngine[];
  /** The prompt's row of the summary; `undefined` while it loads or for a prompt it leaves out (branded). */
  summary: PromptSummaryRow | undefined;
  /** "12 of 23"; `null` when the prompt is not in the list on screen. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
  onOpenAnswer: (observationId: string) => void;
}

/**
 * The inspector of one prompt (spec 2026-11-11 section 4.6; 440 px, as every prompt inspector): its facts,
 * Mentioned and Cited per enabled engine over the window, and its answers (date, engine, status, outcome),
 * each opening the answer viewer. Run now (`runs:trigger`) asks it on every enabled engine that takes its
 * length, through the standard queue; Archive (`prompts:write`) stops asking it, keeps its answers and offers
 * Undo.
 */
export function PromptInspector({
  scope,
  promptId,
  timeZone,
  range,
  engines,
  summary,
  positionText,
  navigation,
  onStep,
  onClose,
  onOpenAnswer,
}: PromptInspectorProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const canTrigger = useCan('runs:trigger');
  const canWrite = useCan('prompts:write');
  const { countries } = useCountries();
  const detail = useQuery(promptQuery(scope, promptId));
  const answers = useQuery(observationsQuery(scope, promptId, range));
  const runNow = useMutation(RUN_NOW);
  const archive = useMutation(ARCHIVE_PROMPT);
  const restore = useMutation(UPDATE_PROMPT);
  const errorId = useErrorId(detail.error);
  const answersErrorId = useErrorId(answers.error);
  const prompt = detail.data?.data ?? null;
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId, prompt_id: promptId };
  const engineLabel = new Map(engines.map((engine) => [engine.engine.engine_code, engine.engine.label]));
  const runnable = prompt === null ? [] : engines.filter((engine) => fitsEngine(prompt.current_version.text, engine));

  const runProblem = (error: unknown): string => {
    if (isApiProblem(error, 'check_pending')) return t('runPending');
    if (isApiProblem(error, 'manual_run_limit')) return t('runLimit');
    if (isApiProblem(error, 'quota_exceeded')) return t('runQuota');
    if (isApiProblem(error, 'provider_paused')) return t('runPaused');
    if (isApiProblem(error, 'validation_failed')) return t('runInvalid');
    return t('runFailed');
  };
  const run = async (): Promise<void> => {
    try {
      await runNow.mutateAsync({
        params: { path },
        body: { engine_codes: runnable.map((engine) => engine.engine.engine_code) },
      });
    } catch (error) {
      toast({ type: 'error', title: t('runFailedTitle'), description: runProblem(error) });
      return;
    }
    toast({ type: 'success', title: t('runQueued'), description: t('runQueuedHint') });
    // The run is in Runs at once, planned
    void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
  };
  const bringBack = (): void => {
    restore.mutateAsync({ params: { path }, body: { is_active: true } }).then(
      () => refreshPrompts(queryClient, scope),
      () => toast({ type: 'error', title: t('restoreFailed') }),
    );
  };
  const doArchive = async (): Promise<void> => {
    try {
      await archive.mutateAsync({ params: { path } });
    } catch {
      toast({ type: 'error', title: t('archiveFailed') });
      return;
    }
    onClose();
    await refreshPrompts(queryClient, scope);
    toast({
      type: 'success',
      title: t('archived'),
      description: t('archivedHint'),
      action: { label: t('undo'), onAction: bringBack },
    });
  };

  const cellText = (cell: MetricCell | undefined): string => countText(cell) ?? words('columns.noAnswers');
  const countryName = (iso: string | null): string =>
    iso === null ? EMPTY_VALUE : (countries.find((country) => country.country_iso === iso)?.name ?? iso);
  const statusLabel = (row: ObservationSummary): string => t(`statuses.${row.status}`);
  const outcomeLabel = (row: ObservationSummary): string =>
    row.facts === null || !row.facts.is_valid ? t('outcomes.notCounted') : t(`outcomes.${OUTCOME_KEYS[row.facts.outcome]}`);
  const answerColumns: PlainColumn<ObservationSummary>[] = [
    {
      id: 'date',
      header: t('columns.date'),
      cell: (row) => {
        const engine = engineLabel.get(row.engine_code) ?? row.engine_code;
        const date = formatTableDateTime(row.observed_at, timeZone);
        return (
          <Button
            variant="link"
            aria-label={t('openAnswer', { engine, date })}
            onClick={() => onOpenAnswer(row.observation_id)}
          >
            <span className="num">{date}</span>
          </Button>
        );
      },
    },
    { id: 'engine', header: t('columns.engine'), cell: (row) => engineLabel.get(row.engine_code) ?? row.engine_code },
    { id: 'status', header: t('columns.status'), cell: statusLabel },
    { id: 'outcome', header: t('columns.outcome'), wrap: true, cell: outcomeLabel },
  ];
  const answerRows = answers.data?.data ?? [];

  return (
    <Inspector
      type="prompt"
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      header={{
        title: prompt?.current_version.text ?? '',
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText,
        navigation,
        badges:
          prompt === null ? null : (
            <span className="inline-flex items-center gap-1.5">
              {prompt.is_branded ? <Badge>{words('branded')}</Badge> : null}
              {prompt.is_active ? null : <Badge tone="warning">{t('archivedBadge')}</Badge>}
            </span>
          ),
        frequentAction:
          canTrigger && prompt?.is_active === true && runnable.length > 0 ? (
            <Button variant="secondary" size="sm" icon={Play} loading={runNow.isPending} onClick={() => void run()}>
              {t('runNow')}
            </Button>
          ) : null,
        moreActions:
          canWrite && prompt?.is_active === true
            ? [{ id: 'archive', label: t('archive'), onSelect: () => void doArchive() }]
            : [],
      }}
    >
      <InspectorBody>
        {detail.isError && prompt === null ? (
          isApiProblem(detail.error, 'not_found') ? (
            <EmptyState
              variant="inline"
              title={t('loadFailed')}
              reason={inspectorWords('notFound', { type: t('noun') })}
              headingLevel={3}
            />
          ) : (
            <InlineError
              title={t('loadFailed')}
              reason={t('loadFailedReason')}
              errorId={errorId}
              onRetry={() => void detail.refetch()}
              retrying={detail.isFetching}
              retryLabel={common('retry')}
            />
          )
        ) : (
          <>
            <InspectorSection title={t('facts')} icon={ClipboardList} status={prompt === null ? 'loading' : 'ready'}>
              {prompt === null ? null : (
                <KeyValues
                  items={[
                    {
                      id: 'topic',
                      label: t('topic'),
                      value:
                        topicTermsOf(prompt).length === 0
                          ? words('columns.noTopic')
                          : formatList(
                              topicTermsOf(prompt).map((term) => term.name),
                              locale,
                            ),
                    },
                    { id: 'language', label: t('language'), value: languageName(prompt.language_code, locale) },
                    { id: 'country', label: t('country'), value: countryName(prompt.country_iso) },
                    {
                      id: 'importance',
                      label: t('importance'),
                      value: <span className="num">{formatInteger(prompt.importance)}</span>,
                    },
                    { id: 'added', label: t('added'), value: formatDetailDateTime(prompt.created_at, timeZone) },
                    { id: 'addedBy', label: t('addedBy'), value: prompt.created_by?.name ?? t('system') },
                  ]}
                />
              )}
            </InspectorSection>
            <InspectorSection
              title={t('byEngine')}
              icon={ListChecks}
              status={summary === undefined ? 'empty' : 'ready'}
              empty={
                <EmptyState variant="inline" title={t('noCounts')} reason={t('noCountsReason')} headingLevel={3} />
              }
            >
              {summary === undefined ? null : (
                <KeyValues
                  items={engines.map((engine) => {
                    const cells = summary.engines.find((cell) => cell.engine_code === engine.engine.engine_code);
                    return {
                      id: engine.engine.engine_code,
                      label: engine.engine.label,
                      value: t('engineCounts', { mentioned: cellText(cells?.mentioned), cited: cellText(cells?.cited) }),
                    };
                  })}
                />
              )}
            </InspectorSection>
            <InspectorSection
              title={t('answers')}
              icon={MessageSquareText}
              status={answers.isError ? 'error' : answers.isPending ? 'loading' : answerRows.length === 0 ? 'empty' : 'ready'}
              error={
                <InlineError
                  title={t('answersFailed')}
                  reason={t('loadFailedReason')}
                  errorId={answersErrorId}
                  onRetry={() => void answers.refetch()}
                  retrying={answers.isFetching}
                  retryLabel={common('retry')}
                />
              }
              empty={
                <EmptyState variant="inline" title={t('answersEmpty')} reason={t('noCountsReason')} headingLevel={3} />
              }
            >
              <PlainTable<ObservationSummary>
                caption={t('answersCaption')}
                columns={answerColumns}
                rows={answerRows}
                rowKey={(row) => row.observation_id}
                status="ready"
                errorState={null}
                emptyText={t('answersEmpty')}
              />
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}
```

`Button` with `variant="link"` is the non-navigating link look (`components/ui/button-variants.ts`); if that variant has another name there, use the one the file defines for a text-like action.

- [ ] **Step 5: Open it from both tabs**

In `apps/web/src/features/prompts/topics-table.tsx`:

1. Add to `TopicsTableProps`, after `onDensityChange: (density: Density) => void;`:

```ts
  /** The prompt open in the inspector; its rows are marked. */
  activePromptId: string | null;
  onOpenPrompt: (promptId: string) => void;
```

2. Add `activePromptId,` and `onOpenPrompt,` to the destructured parameters after `onDensityChange,`.
3. In the returned `<DataTable<TopicRow>`, after `onToggleGroup={toggle}` add:

```tsx
      onRowOpen={(row) => {
        if (row.kind === 'prompt') onOpenPrompt(row.promptId);
      }}
      activeRowId={
        rows.find((row) => row.kind === 'prompt' && row.promptId === activePromptId)?.id ?? null
      }
```

In `apps/web/src/features/prompts/prompts-screen.tsx`:

1. After `import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';` add `import { PromptInspector } from './prompt-inspector';`.
2. After `import { useUrlFilters } from '@/components/app/filters/use-url-filters';` add:

```ts
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
```

3. Replace `import { formatBusinessDate, formatList } from '@/lib/format';` with `import { formatBusinessDate, formatInteger, formatList } from '@/lib/format';`, and after `import { useCan } from '@/lib/permissions';` add `import { formatInspectTarget } from '@/lib/inspector/placement';`.
4. After `  const density = parseDensity(view.density);` add:

```ts
  // The inspector: a prompt opened from either tab, stepping in the Prompts table's order
  const inspector = useInspector();
  const openPrompt = inspector.target?.type === 'prompt' ? inspector.target.id : null;
  const [order, setOrder] = useState<readonly string[]>([]);
  const at = tab === 'prompts' ? inspector.position(order) : null;
  const step = (direction: 'next' | 'previous'): void => {
    if (at === null || (direction === 'next' ? at.index === at.count - 1 : at.index === 0)) return;
    inspector.step(direction, order);
  };
  const openPromptRow = (promptId: string, intent: 'inspector' | 'new-tab' = 'inspector'): void => {
    const target = { type: 'prompt' as const, id: promptId };
    if (intent === 'new-tab') {
      const url = new URL(window.location.href);
      url.searchParams.set('inspect', formatInspectTarget(target));
      url.searchParams.delete('itab');
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (promptId !== openPrompt) inspector.open(target);
  };
```

5. In `promptsTable`, replace

```tsx
      emptyState={noPrompts}
      filteredEmptyState={filteredEmpty}
    />
```

with

```tsx
      emptyState={noPrompts}
      filteredEmptyState={filteredEmpty}
      onRowOpen={(row, intent) => openPromptRow(row.prompt.prompt_id, intent)}
      activeRowId={openPrompt}
      onRowOrderChange={setOrder}
    />
```

6. In the `<TopicsTable` element, replace

```tsx
              onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
            />
```

with

```tsx
              onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
              activePromptId={openPrompt}
              onOpenPrompt={openPromptRow}
            />
```

7. Replace

```tsx
  return (
    <>
      <TopBarPortal>
```

with

```tsx
  const promptInspector =
    openPrompt === null ? null : (
      <PromptInspector
        // Another prompt is another inspector, not the same one with new data
        key={openPrompt}
        scope={scope}
        promptId={openPrompt}
        timeZone={project.timeZone}
        range={range}
        engines={enabled}
        summary={summaryById.get(openPrompt)}
        positionText={
          at === null
            ? null
            : t('inspector.position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) })
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
        onClose={() => inspector.close()}
        onOpenAnswer={(id) => inspector.open({ type: 'answer', id })}
      />
    );

  return (
    <InspectorLayout inspector={promptInspector}>
      <TopBarPortal>
```

8. Replace the end of the component

```tsx
      ) : null}
    </>
  );
}
```

with

```tsx
      ) : null}
    </InspectorLayout>
  );
}
```

`onOpenPrompt={openPromptRow}` passes a function with an optional second parameter, which the topics table calls with one argument.

- [ ] **Step 6: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/prompts`
Expected: every file passes; `prompt-inspector.test.tsx` has 4 tests.

Then the gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/prompts/prompt-inspector.tsx apps/web/src/features/prompts/prompt-inspector.test.tsx \
  apps/web/src/features/prompts/prompts-screen.tsx apps/web/src/features/prompts/topics-table.tsx apps/web/messages/en.json
git commit -m "Prompt inspector: facts, counts per engine, answers, Run now and Archive with Undo"
```

---

### Task 9: Answer viewer

**Read first:**
- `apps/web/src/features/entities/alias-test-segments.ts` and `alias-test-section.tsx` lines 100 to 170 (text cut at spans, `EvidenceHighlight` per mention)
- `apps/web/src/components/app/evidence/evidence-highlight.tsx` (`HighlightEntity`, `EntityColorIndex`, own brand in the accent)
- `apps/web/src/features/prompts/prompt-inspector.tsx` as task 8 left it (the inspector frame)
- Plan B task 8 (`ObservationDetail`: `answer_text`, `error_code`, `offsets_unit: 'utf16'`, `mentions` with `evidence_spans` as `[start, end)` UTF-16 pairs, `citations` with `domain_role`; the raw route needs `raw:read`)
- `docs/19-api-specification.md` section 4.3 (the evidence spans are ranges into `answer_text`)

**Files:**
- Create: `apps/web/src/features/prompts/answer-segments.ts`, `apps/web/src/features/prompts/answer-inspector.tsx`
- Modify: `apps/web/src/features/prompts/prompts-screen.tsx`, `apps/web/messages/en.json`
- Test: `apps/web/src/features/prompts/answer-segments.test.ts`, `apps/web/src/features/prompts/answer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/prompts/answer-segments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { answerSegments } from './answer-segments';
import type { MentionOut } from '@/lib/api/types';

const mention = (name: string, spans: [number, number][]): MentionOut => ({
  entity_id: `id-${name}`,
  name,
  role: name === 'Fynix' ? 'own' : 'competitor',
  mention_count: spans.length,
  first_char_offset: spans[0]?.[0] ?? 0,
  mention_order: 1,
  match_method: 'alias_word',
  mention_status: 'accepted',
  confidence: 0.95,
  evidence_spans: spans,
});

const shape = (text: string, mentions: MentionOut[]): [string, number, string][] =>
  answerSegments(text, mentions).map((segment) => [segment.kind, segment.start, segment.text]);

describe('answerSegments', () => {
  it('cuts an English answer at its mentions, in order', () => {
    const text = 'Fynix and Rankforge are named.';
    expect(shape(text, [mention('Rankforge', [[10, 19]]), mention('Fynix', [[0, 5]])])).toEqual([
      ['mention', 0, 'Fynix'],
      ['text', 5, ' and '],
      ['mention', 10, 'Rankforge'],
      ['text', 19, ' are named.'],
    ]);
  });

  it('reads the spans as UTF-16 units, so an emoji before a name counts two', () => {
    // "🔎" is one character and two UTF-16 units: "Fynix" starts at unit 3, not at character 2
    const text = '🔎 Fynix leads.';
    expect(shape(text, [mention('Fynix', [[3, 8]])])).toEqual([
      ['text', 0, '🔎 '],
      ['mention', 3, 'Fynix'],
      ['text', 8, ' leads.'],
    ]);
  });

  it('marks a name inside Hindi text, whose letters and signs are one unit each', () => {
    const text = 'भारत में Fynix एक SEO एजेंसी है।';
    expect(shape(text, [mention('Fynix', [[9, 14]])])).toEqual([
      ['text', 0, 'भारत में '],
      ['mention', 9, 'Fynix'],
      ['text', 14, ' एक SEO एजेंसी है।'],
    ]);
  });

  it('leaves out a span that would cut a character in two, as code point offsets read as units would', () => {
    // Units 0 and 1 are the first emoji: a span from unit 1 starts inside it
    const text = '🔎🔎 Fynix';
    expect(shape(text, [mention('Fynix', [[1, 6]])])).toEqual([['text', 0, '🔎🔎 Fynix']]);
  });

  it('leaves out a span outside the text, an empty one and one that overlaps an earlier one', () => {
    const text = 'Fynix and Rankforge.';
    expect(
      shape(text, [
        mention('Fynix', [
          [0, 5],
          [3, 9],
        ]),
        mention('Rankforge', [
          [10, 40],
          [12, 12],
        ]),
      ]),
    ).toEqual([
      ['mention', 0, 'Fynix'],
      ['text', 5, ' and Rankforge.'],
    ]);
  });
});
```

Create `apps/web/src/features/prompts/answer.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { EngineCode, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { answerOf, DAY_MS, ENGINE_CODES, FIXTURE_PROMPTS, observationIdOf, runInstants } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const prompts = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];

/** The id of the first fixture answer of the last 28 days that `test` picks, newest first. */
function answerWhere(test: (answer: ReturnType<typeof answerOf>) => boolean): { id: string; promptId: string } {
  for (const at of runInstants(NOW.getTime()).slice(0, 8)) {
    const day = Math.floor(at / DAY_MS);
    for (const prompt of prompts) {
      for (const engine of ENABLED) {
        if (prompt.index !== null && test(answerOf(prompt.index, prompt.language_code, engine, day))) {
          return { id: observationIdOf(day, prompt.index, ENGINE_CODES.indexOf(engine)), promptId: prompt.prompt_id };
        }
      }
    }
  }
  throw new Error('No fixture answer matches');
}

const cited = answerWhere(
  (answer) =>
    answer.status === 'complete' &&
    answer.facts.own_mentioned &&
    answer.citations.some((citation) => citation.domain_role === 'own') &&
    answer.mentions.some((mention) => mention.role === 'competitor'),
);
const failed = answerWhere((answer) => answer.status === 'error');

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const opened = (id: string): string => `?tab=prompts&inspect=${encodeURIComponent(`answer:${id}`)}`;

describe('the answer viewer', () => {
  it('shows the answer with the own brand and competitors marked, and the sources with their roles', async () => {
    const { container } = renderWithProviders(promptsAs('viewer'), { searchParams: opened(cited.id) });
    expect(await screen.findByLabelText(/^Fynix mention, own brand/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/mention, tracked brand/).length).toBeGreaterThan(0);
    const sources = screen.getByRole('list', { name: 'Sources cited in this answer' });
    expect(within(sources).getByText('Own')).toBeInTheDocument();
    expect(within(sources).getByText('Third party')).toBeInTheDocument();
    expect(screen.getByText('Ads in the answer are left out of the mentions and the sources.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the raw answer' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('links to the raw answer for a member with raw:read', async () => {
    renderWithProviders(promptsAs('analyst'), { searchParams: opened(cited.id) });
    const link = await screen.findByRole('link', { name: 'Open the raw answer' });
    expect(link.getAttribute('href')).toBe(
      `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix?.project_id ?? ''}/ai/observations/${cited.id}/raw`,
    );
  });

  it('says an answer could not be read, and goes back to its prompt', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: opened(failed.id) });
    expect(await screen.findByText('The answer could not be read')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the prompt' }));
    const prompt = prompts.find((candidate) => candidate.prompt_id === failed.promptId);
    expect(await screen.findByRole('complementary', { name: prompt?.text ?? '' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/prompts/answer-segments.test.ts src/features/prompts/answer.test.tsx`
Expected: FAIL with `Failed to resolve import "./answer-segments"`, and no answer viewer.

- [ ] **Step 3: Write the segments**

Create `apps/web/src/features/prompts/answer-segments.ts`:

```ts
import type { MentionOut } from '@/lib/api/types';

/** A piece of an answer, with the UTF-16 offset it starts at: plain, or a span a mention claims. */
export type AnswerSegment =
  | { kind: 'text'; start: number; text: string }
  | { kind: 'mention'; start: number; text: string; mention: MentionOut };

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** Whether `at` falls between the two halves of one character past U+FFFF (an emoji, say). */
const splitsCharacter = (text: string, at: number): boolean =>
  at > 0 && at < text.length && isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));

/**
 * The answer cut at the evidence spans of its mentions, in order. The spans are `[start, end)` in UTF-16 code
 * units of `answer_text`, as a JavaScript string indexes it: the API converts the code points it stores before
 * it answers (`offsets_unit: 'utf16'`, plan B task 8), so they are used as they come and never converted here.
 * A span outside the text, an empty one, one that overlaps an earlier span, or one that would cut a character
 * in two is left out rather than trusted, and the text around it stays plain.
 */
export function answerSegments(text: string, mentions: readonly MentionOut[]): AnswerSegment[] {
  const spans = mentions
    .flatMap((mention) => mention.evidence_spans.map(([start, end]) => ({ mention, start, end })))
    .filter(
      ({ start, end }) =>
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end <= text.length &&
        start < end &&
        !splitsCharacter(text, start) &&
        !splitsCharacter(text, end),
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: AnswerSegment[] = [];
  let at = 0;
  for (const { mention, start, end } of spans) {
    if (start < at) continue;
    if (start > at) segments.push({ kind: 'text', start: at, text: text.slice(at, start) });
    segments.push({ kind: 'mention', start, text: text.slice(start, end), mention });
    at = end;
  }
  if (at < text.length) segments.push({ kind: 'text', start: at, text: text.slice(at) });
  return segments;
}
```

Run: `pnpm vitest run src/features/prompts/answer-segments.test.ts`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 4: Add the words**

In `apps/web/messages/en.json`, in `prompts`, after the `"inspector": { ... }` object (put a comma after its closing brace):

```json
    "answer": {
      "type": "Answer",
      "noun": "answer",
      "title": "{engine} answer, {date}",
      "back": "Back to Topics & Prompts",
      "backToPrompt": "Back to the prompt",
      "loadFailed": "The answer could not be loaded.",
      "loadFailedReason": "The server did not answer. Try again in a moment.",
      "text": "Answer",
      "failed": "The answer could not be read",
      "failedReason": "The provider’s reply could not be read ({code}). It is left out of every count.",
      "empty": "The engine gave no answer",
      "emptyReason": "An empty answer is left out of every count.",
      "refused": "The engine declined to answer. The answer is left out of every count.",
      "partial": "The answer was cut off. It counts with what it holds.",
      "adsNote": "Ads in the answer are left out of the mentions and the sources.",
      "ownMatch": "own brand",
      "competitorMatch": "tracked brand",
      "mentions": "Mentions",
      "noMentions": "No tracked brand is named",
      "noMentionsReason": "The answer names none of the project’s brands or competitors.",
      "mentionCount": "{count, plural, one {Named once} other {Named # times}}",
      "roles": {
        "own": "Own",
        "competitor": "Competitor",
        "watch": "Watched",
        "untracked": "Untracked"
      },
      "sources": "Sources",
      "noSources": "No source cited",
      "noSourcesReason": "The answer lists no source.",
      "sourcesCaption": "Sources cited in this answer",
      "sourceRoles": {
        "own": "Own",
        "competitor": "Competitor",
        "thirdParty": "Third party"
      },
      "details": "Details",
      "engine": "Engine",
      "observed": "Answered",
      "model": "Model",
      "status": "Status",
      "raw": "Open the raw answer",
      "rawLabel": "Raw answer"
    }
```

- [ ] **Step 5: Write the viewer**

Create `apps/web/src/features/prompts/answer-inspector.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Link2, MessageSquareText, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { answerSegments } from './answer-segments';
import { observationQuery, projectEntitiesQuery, rawAnswerPath, type PromptScope } from './prompt-queries';
import { EvidenceHighlight, type EntityColorIndex } from '@/components/app/evidence/evidence-highlight';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { KeyValues } from '@/components/app/inspector/key-values';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { CitationOut, ObservationDetail, ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatDetailDateTime, formatTableDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';

const COLOR_INDEXES: readonly EntityColorIndex[] = [1, 2, 3, 4, 5, 6];
const colorOf = (index: number | null | undefined): EntityColorIndex | null =>
  COLOR_INDEXES.find((candidate) => candidate === index) ?? null;
const SOURCE_ROLE_KEYS = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;
/** Only an http or https address becomes a link; anything else stays text. */
const isWebAddress = (url: string): boolean => /^https?:\/\//i.test(url);

export interface AnswerInspectorProps {
  scope: PromptScope;
  observationId: string;
  timeZone: string;
  /** Every engine of the project, for their names. */
  engines: readonly ProjectEngine[];
  /** Opens the prompt the answer belongs to. */
  onBack: (promptId: string) => void;
  onClose: () => void;
}

/**
 * One answer (spec 2026-11-11 section 4.6, 23-application-patterns.md section 5.3): the answer text with the
 * own brand and the tracked competitors marked at their evidence spans, the brands it names, the sources it
 * cites with their role (own, competitor, third party), its status, and for `raw:read` a link to the provider's
 * raw answer. Ads are left out of mentions and sources by the normalizer, which the viewer says. A failed,
 * empty or refused answer says so, since it counts in no rate.
 */
export function AnswerInspector({
  scope,
  observationId,
  timeZone,
  engines,
  onBack,
  onClose,
}: AnswerInspectorProps): ReactElement {
  const t = useTranslations('prompts.answer');
  const statuses = useTranslations('prompts.inspector.statuses');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const canReadRaw = useCan('raw:read');
  const detail = useQuery(observationQuery(scope, observationId));
  const entities = useQuery(projectEntitiesQuery(scope));
  const errorId = useErrorId(detail.error);
  const answer = detail.data?.data ?? null;
  const colors = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
  const engineName = (code: string): string =>
    engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;

  const answerText = (shown: ObservationDetail): ReactNode => {
    if (shown.status === 'error') {
      return (
        <EmptyState
          variant="inline"
          title={t('failed')}
          reason={t('failedReason', { code: shown.error_code ?? EMPTY_VALUE })}
          headingLevel={3}
        />
      );
    }
    if (shown.answer_text === null || shown.answer_text === '') {
      return <EmptyState variant="inline" title={t('empty')} reason={t('emptyReason')} headingLevel={3} />;
    }
    return (
      <div className="flex flex-col gap-3">
        {shown.status === 'refused' ? <Banner tone="info" placement="region" message={t('refused')} /> : null}
        {shown.status === 'partial' ? <Banner tone="warning" placement="region" message={t('partial')} /> : null}
        <p lang={shown.language_code ?? undefined} className="type-prose whitespace-pre-wrap">
          {answerSegments(shown.answer_text, shown.mentions).map((segment) =>
            segment.kind === 'text' ? (
              <span key={segment.start}>{segment.text}</span>
            ) : (
              <EvidenceHighlight
                key={segment.start}
                entity={{
                  name: segment.mention.name,
                  own: segment.mention.role === 'own',
                  colorIndex: colorOf(colors.get(segment.mention.entity_id)),
                }}
                matchLabel={segment.mention.role === 'own' ? t('ownMatch') : t('competitorMatch')}
                confidence={segment.mention.confidence}
                certainty={segment.mention.mention_status === 'accepted' ? 'certain' : 'uncertain'}
              >
                {segment.text}
              </EvidenceHighlight>
            ),
          )}
        </p>
        <p className="type-meta">{t('adsNote')}</p>
      </div>
    );
  };

  const sourceBadge = (citation: CitationOut): ReactNode => {
    const label = t(`sourceRoles.${SOURCE_ROLE_KEYS[citation.domain_role]}`);
    if (citation.domain_role === 'own') return <Badge tone="info">{label}</Badge>;
    if (citation.domain_role === 'competitor') return <Badge variant="outline">{label}</Badge>;
    return <Badge>{label}</Badge>;
  };

  return (
    <Inspector
      type="answer"
      backLabel={t('back')}
      onClose={onClose}
      header={{
        title:
          answer === null
            ? ''
            : t('title', { engine: engineName(answer.engine_code), date: formatTableDateTime(answer.observed_at, timeZone) }),
        typeLabel: t('type'),
        typeNoun: t('noun'),
        badges: answer === null ? null : <Badge>{statuses(answer.status)}</Badge>,
        frequentAction:
          answer === null ? null : (
            <Button variant="secondary" size="sm" icon={ArrowLeft} onClick={() => onBack(answer.subject.prompt_id)}>
              {t('backToPrompt')}
            </Button>
          ),
        moreActions: [],
      }}
    >
      <InspectorBody>
        {detail.isError && answer === null ? (
          isApiProblem(detail.error, 'not_found') ? (
            <EmptyState
              variant="inline"
              title={t('loadFailed')}
              reason={inspectorWords('notFound', { type: t('noun') })}
              headingLevel={3}
            />
          ) : (
            <InlineError
              title={t('loadFailed')}
              reason={t('loadFailedReason')}
              errorId={errorId}
              onRetry={() => void detail.refetch()}
              retrying={detail.isFetching}
              retryLabel={common('retry')}
            />
          )
        ) : (
          <>
            <InspectorSection title={t('text')} icon={MessageSquareText} status={answer === null ? 'loading' : 'ready'}>
              {answer === null ? null : answerText(answer)}
            </InspectorSection>
            <InspectorSection
              title={t('mentions')}
              icon={Users}
              status={answer === null ? 'loading' : answer.mentions.length === 0 ? 'empty' : 'ready'}
              empty={
                <EmptyState variant="inline" title={t('noMentions')} reason={t('noMentionsReason')} headingLevel={3} />
              }
            >
              {answer === null ? null : (
                <KeyValues
                  items={answer.mentions.map((mention) => ({
                    id: mention.entity_id,
                    label: mention.name,
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <Badge>{t(`roles.${mention.role}`)}</Badge>
                        {t('mentionCount', { count: mention.mention_count })}
                      </span>
                    ),
                  }))}
                />
              )}
            </InspectorSection>
            <InspectorSection
              title={t('sources')}
              icon={Link2}
              status={answer === null ? 'loading' : answer.citations.length === 0 ? 'empty' : 'ready'}
              empty={
                <EmptyState variant="inline" title={t('noSources')} reason={t('noSourcesReason')} headingLevel={3} />
              }
            >
              {answer === null ? null : (
                <ol aria-label={t('sourcesCaption')} className="flex flex-col gap-2">
                  {answer.citations.map((citation) => (
                    <li key={citation.citation_index} className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        {isWebAddress(citation.url) ? (
                          <TextLink href={citation.url} target="_blank" rel="noopener noreferrer nofollow">
                            {citation.title ?? citation.host}
                          </TextLink>
                        ) : (
                          <span className="type-body">{citation.title ?? citation.host}</span>
                        )}
                        <span className="truncate type-meta">{citation.host}</span>
                      </span>
                      {sourceBadge(citation)}
                    </li>
                  ))}
                </ol>
              )}
            </InspectorSection>
            <InspectorSection title={t('details')} icon={ClipboardList} status={answer === null ? 'loading' : 'ready'}>
              {answer === null ? null : (
                <KeyValues
                  items={[
                    { id: 'engine', label: t('engine'), value: engineName(answer.engine_code) },
                    { id: 'observed', label: t('observed'), value: formatDetailDateTime(answer.observed_at, timeZone) },
                    { id: 'model', label: t('model'), value: answer.model_reported ?? EMPTY_VALUE },
                    { id: 'status', label: t('status'), value: statuses(answer.status) },
                    ...(canReadRaw
                      ? [
                          {
                            id: 'raw',
                            label: t('rawLabel'),
                            value: (
                              <TextLink href={rawAnswerPath(scope, observationId)} target="_blank" rel="noopener">
                                {t('raw')}
                              </TextLink>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}
```

`answer_text` is the answer's markdown (plan B as built). The viewer shows it as text with its line breaks kept; rendering markdown through the sanitizer of doc 24 section 7.1 is left for later because a rendered answer moves the evidence spans away from the text they index.

- [ ] **Step 6: Open it from the prompt inspector**

In `apps/web/src/features/prompts/prompts-screen.tsx`:

1. After `import { PromptInspector } from './prompt-inspector';` add `import { AnswerInspector } from './answer-inspector';`.
2. After `  const openPrompt = inspector.target?.type === 'prompt' ? inspector.target.id : null;` add

```ts
  const openAnswer = inspector.target?.type === 'answer' ? inspector.target.id : null;
```

3. Replace

```tsx
  return (
    <InspectorLayout inspector={promptInspector}>
```

with

```tsx
  const answerInspector =
    openAnswer === null ? null : (
      <AnswerInspector
        key={openAnswer}
        scope={scope}
        observationId={openAnswer}
        timeZone={project.timeZone}
        engines={engines.data?.data ?? []}
        onBack={(promptId) => inspector.open({ type: 'prompt', id: promptId })}
        onClose={() => inspector.close()}
      />
    );

  return (
    <InspectorLayout inspector={promptInspector ?? answerInspector}>
```

- [ ] **Step 7: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/prompts`
Expected: every file passes; `answer.test.tsx` has 3 tests and `answer-segments.test.ts` 5.

Then the gate.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/prompts/answer-segments.ts apps/web/src/features/prompts/answer-segments.test.ts \
  apps/web/src/features/prompts/answer-inspector.tsx apps/web/src/features/prompts/answer.test.tsx \
  apps/web/src/features/prompts/prompts-screen.tsx apps/web/messages/en.json
git commit -m "Answer viewer: the answer with mentions marked at their UTF-16 spans, sources with roles, raw link"
```

---

### Task 10: The `ai_prompt` schedules in Project settings > Schedules

**Read first:**
- `apps/web/src/features/project-settings/schedules-screen.tsx` lines 160 to 215 (the menu per row, the Collects column)
- `apps/web/src/features/project-settings/schedule-model.ts` (`SCHEDULE_WORKLOADS`, `isEditableSchedule`: a schedule of another workload is paused, resumed and deleted but not edited)
- `apps/web/src/features/project-settings/schedules.test.tsx` lines 80 to 130 and 886 to 906 (`SCHEDULE`, `listing`, the other-workload test)
- Plan A task 3 (`ensure_ai_schedule` writes two weekly schedules, "AI answers, Monday" and "AI answers, Thursday", 01:00 project time, 8 hours, `standard_queue`, selector `{"all": true}`)

The two schedules are made by the API when the first engine is turned on. In slice 1 they are listed, paused, resumed and deleted here; their day, time and window are not edited in the dialog (it names keyword selectors only, and the base plan fixes the cadence). Only the Collects column and the section's words change. The mocks do not make these schedules when an engine is turned on (the schedules mock keeps its state in a cookie codec that names two workloads); the test below serves them itself.

**Files:**
- Modify: `apps/web/src/features/project-settings/schedules-screen.tsx`, `apps/web/messages/en.json`, `apps/web/src/app/[workspace]/[project]/settings/schedules/page.tsx`
- Test: `apps/web/src/features/project-settings/schedules.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/project-settings/schedules.test.tsx`, inside `describe('Project settings > Schedules', ...)`, after `'does not offer to edit a schedule of another workload or a cron schedule'`:

```tsx
  it('lists the AI answer schedules with what they collect, to pause but not to edit', async () => {
    server.use(
      listing(
        {
          ...SCHEDULE,
          name: 'AI answers, Monday',
          workload: 'ai_prompt',
          weekday: 1,
          window_start_local: '01:00:00',
          window_hours: 8,
          timezone: fynix?.timezone ?? 'UTC',
          priority: 'standard',
          provider_mode: 'standard_queue',
          selector: { all: true },
        },
        {
          ...SCHEDULE,
          schedule_id: MOCK_SCHEDULE_IDS.weeklyContent,
          name: 'AI answers, Thursday',
          workload: 'ai_prompt',
          weekday: 4,
          window_start_local: '01:00:00',
          window_hours: 8,
          timezone: fynix?.timezone ?? 'UTC',
          priority: 'standard',
          provider_mode: 'standard_queue',
          selector: { all: true },
        },
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    const monday = await rowOf('AI answers, Monday');
    expect(within(monday).getByText('AI prompts')).toBeInTheDocument();
    expect(within(monday).getByText('All active prompts')).toBeInTheDocument();
    expect(within(monday).getByText('Every Monday at 01:00, 8 hour window')).toBeInTheDocument();
    expect(within(await rowOf('AI answers, Thursday')).getByText('Every Thursday at 01:00, 8 hour window')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for AI answers, Monday' }));
    expect(await screen.findByRole('menuitem', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/project-settings/schedules.test.tsx -t "AI answer schedules"`
Expected: FAIL: `Unable to find an element with the text: All active prompts` (the column reads "All keywords").

- [ ] **Step 3: Put words to the AI schedules**

In `apps/web/messages/en.json`, in `projectSettings.schedules`:

- change `"description"` to `"When this project's keyword metrics, rankings and AI answers are collected. Each schedule keeps to its own time zone."` (keep the straight apostrophe the existing value has; the catalog test allows it, ICU reads `'s` as text);
- change `"emptyReason"` to `"A schedule collects keyword metrics, rankings or AI answers by itself, at the time you choose."`;
- in `selector`, add after `"all": "All keywords",`:

```json
        "allPrompts": "All active prompts",
```

In `apps/web/src/features/project-settings/schedules-screen.tsx`, replace

```tsx
      cell: (schedule) => words.collects(schedule.selector, names),
```

with

```tsx
      // An AI answer schedule asks every active prompt (plan A: selector `{"all": true}`), not keywords
      cell: (schedule) =>
        schedule.workload === 'ai_prompt' ? t('selector.allPrompts') : words.collects(schedule.selector, names),
```

In `apps/web/src/app/[workspace]/[project]/settings/schedules/page.tsx`, change the doc comment to `/** Project settings > Schedules: when the project's keyword metrics, rankings and AI answers are collected. */`.

- [ ] **Step 4: Run the tests to see them pass, then the gate**

Run: `pnpm vitest run src/features/project-settings`
Expected: every file passes, the new test among them.

Then the gate.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/project-settings/schedules-screen.tsx apps/web/src/features/project-settings/schedules.test.tsx \
  "apps/web/src/app/[workspace]/[project]/settings/schedules/page.tsx" apps/web/messages/en.json
git commit -m "Schedules: the AI answer schedules collect all active prompts"
```

---

### Task 11: End to end flow, accessibility at four widths in both themes, and the As built notes

**Read first:**
- `apps/web/e2e/support.ts` (`signIn`, `expectAccessible`, `waitForContent`)
- `apps/web/e2e/flows/schedules.spec.ts` (a settings flow) and `apps/web/e2e/flows/keyword-detail-events.spec.ts` lines 98 to 115 (the theme loop through `localStorage`, widths)
- `apps/web/e2e/flows/shell.spec.ts` lines 55 to 66 (no horizontal page scroll at 390 px)
- `docs/20-frontend-specification.md` section 5.6 (Prompt Explorer) and the As built notes of section 5.19

The mocks keep the AI prompt state in the page's memory (task 1), so a flow that changes it moves between pages by clicking links, never with `page.goto`, until it has checked what it changed.

**Files:**
- Create: `apps/web/e2e/flows/ai-prompts.spec.ts`
- Modify: `docs/20-frontend-specification.md`

- [ ] **Step 1: Write the flow**

Create `apps/web/e2e/flows/ai-prompts.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { expectAccessible, signIn, watchPolicy } from '../support';

/** An editor holds `projects:write` and `prompts:write`; a viewer reads; an analyst may run and read raw answers. */
const EDITOR = 'priya@digibranders.test';
const VIEWER = 'mei@digibranders.test';
const THEME_KEY = 'idraft.theme';
const CLEANSTART_ENGINES = '/digibranders/cleanstart/settings/engines';
const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`). */
const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000001';
const WIDTHS = [1440, 1280, 1024, 390] as const;

test.describe('AI prompt tracking', () => {
  test('an editor turns an engine on, adds prompts by pasting a list and finds them in the table', async ({ page }) => {
    const policy = watchPolicy(page);
    await signIn(page, EDITOR);
    await page.goto(CLEANSTART_ENGINES);
    const chatgpt = page.getByRole('switch', { name: 'ChatGPT' });
    await expect(chatgpt).not.toBeChecked();
    await chatgpt.click();
    const confirm = page.getByRole('alertdialog', { name: 'Turn on ChatGPT?' });
    await expect(confirm.getByText(/starts scheduled spend from the next run/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Turn on ChatGPT' }).click();
    await expect(page.getByText('ChatGPT is on')).toBeVisible();
    await expect(chatgpt).toBeChecked();
    await expectAccessible(page);

    // A link, not page.goto: the mocks' memory lives in the page
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Topics & Prompts' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No prompts yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Add prompts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add prompts' });
    await dialog
      .getByRole('textbox', { name: 'Prompts' })
      .fill(
        'Which cleaning service is best in Boston?\nHow often should an office be cleaned?\nWhich cleaning service is best in Boston?',
      );
    await expect(dialog.getByText('Line 3 repeats line 1 and is left out.')).toBeVisible();
    await expect(dialog.getByText(/^Adds 2 prompts of your remaining \d+\.$/)).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Add 2 prompts' }).click();
    await expect(page.getByText('2 prompts added')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByRole('tab', { name: 'Prompts' }).click();
    const table = page.getByRole('grid', { name: 'Prompts' });
    await expect(table.getByText('How often should an office be cleaned?')).toBeVisible();
    await expect(table.getByText('Which cleaning service is best in Boston?')).toBeVisible();
    // New prompts have no answer until the next run, and the page says so
    await expect(page.getByText(/^No data yet\. Each prompt is asked twice a week/)).toBeVisible();
    await expectAccessible(page);
    expect(policy.violations).toEqual([]);
  });

  test('a viewer opens a prompt and reads one of its answers with the brands marked and the sources listed', async ({
    page,
  }) => {
    await signIn(page, VIEWER);
    await page.goto(`${FYNIX_PROMPTS}?tab=prompts`);
    const table = page.getByRole('grid', { name: 'Prompts' });
    await table.getByText(FIRST_PROMPT).click();
    const inspector = page.getByRole('complementary', { name: FIRST_PROMPT });
    const answers = inspector.getByRole('table', { name: 'Answers to this prompt' });
    // Answers come from the clock in the mocks: open the newest one that names the own brand
    await answers
      .getByRole('row')
      .filter({ hasText: /Mentioned (and cited|only)/ })
      .first()
      .getByRole('button')
      .click();
    await expect(page.getByLabel(/^Fynix mention, own brand/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Sources cited in this answer' })).toBeVisible();
    await expect(page.getByText('Ads in the answer are left out of the mentions and the sources.')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Back to the prompt' }).click();
    await expect(page.getByRole('complementary', { name: FIRST_PROMPT })).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Topics & Prompts in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of WIDTHS) {
      test(`has no accessibility violation and no page scroll sideways at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, EDITOR);
        await page.goto(FYNIX_PROMPTS);
        await expect(page.getByRole('treegrid', { name: 'Topics' })).toBeVisible();
        await expectAccessible(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

        await page.goto(`${FYNIX_PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`prompt:${FIRST_PROMPT_ID}`)}`);
        await expect(page.getByRole('table', { name: 'Answers to this prompt' })).toBeVisible();
        await expectAccessible(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

        await page.goto('/digibranders/fynix/settings/engines');
        await expect(page.getByRole('switch', { name: 'Gemini' })).toBeChecked();
        await expectAccessible(page);
      });
    }
  });
}
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e -- e2e/flows/ai-prompts.spec.ts`
Expected: `10 passed` (2 flow tests, 8 theme and width tests). It builds the app first (about 2 minutes).

Then run the whole e2e suite, since the sidebar and shell tests changed in task 4:

Run: `pnpm e2e`
Expected: every test passes.

A failing axe rule names the element: fix it in the component (a missing accessible name, a contrast token), never by leaving the rule out.

- [ ] **Step 3: Write the As built notes**

In `docs/20-frontend-specification.md`, after the line that starts with ``Data: `GET .../prompts?filters&engines` `` (the last line of section 5.6 before its next heading), add a blank line and:

```markdown
> As built (AI prompt tracking slice 1, 2026-11-11, plan `docs/superpowers/plans/2026-11-11-ai-prompts-c-web.md`): the page is Topics & Prompts at `[workspace]/[project]/ai/prompts` (ADR-DS-022) with two tabs, Topics (the default) and Prompts; Panels and Versions wait for slice 4. The window is the last 7, 28 (the default) or 90 days in the project's time zone, chosen in the top bar. Each enabled engine has two columns, Mentioned and Cited, as counts of valid answers ("4 of 8") from `GET {P}/ai/prompts-summary`; rates, intervals, recommendation, share of voice, the metric strip, trends and the AI Overview column wait for later slices. The filter bar holds Topic, Country (the Prompts tab only, since a topic's counts come from the API for all its prompts), Engine and Branded prompts; branded prompts stay out of the table and the counts until that filter includes them (doc 16 rule 4). The Topics tab lists one row per topic, the largest first, and opens a topic in place with all its prompts under it, most mentioned first on the first engine shown; prompts without a topic share a "No topic" row; there is no topic drawer yet. A project without an engine on links to Settings > Engines, and until the first answers arrive the page says when they come. Add prompts takes one prompt or a pasted list (one per line, up to 1,000) with a shared topic, language and country: repeats and prompts the project tracks are found in the browser, the lint names branded lines and lines too long for an engine, and the dialog says how many of the workspace's remaining prompts the add takes before it saves through `bulk-create`, then lists the lines it skipped or refused. A prompt opens in the right inspector (440 px) with its facts, Mentioned and Cited per engine, its answers in the window, Run now (`runs:trigger`; every enabled engine that takes its length, through the standard queue) and Archive with Undo. An answer opens in the inspector too: its text with the own brand and the competitors marked at their evidence spans (UTF-16 units, as the API sends them), the brands it names, the sources with their role (own, competitor, third party), its status, the note that ads are left out, and a link to the raw answer for `raw:read`. The answer's markdown is shown as text, not rendered.
```

In the same file, before the line that starts with `> Keyword defaults is a section of General (5.19.5)`, add:

```markdown
> Engines (as built, AI prompt tracking slice 1, 2026-11-11): Project settings has an Engines section (`settings/engines`; `projects:write` to change, others read it under one `Banner`) with ChatGPT, Gemini and Google AI Mode. Each row has a switch, the engine's monthly cost for the project's active prompts on the base plan (`estimated_monthly_cost_usd`) and its countries. Turning an engine on asks first, names the cost and says it starts scheduled spend; turning one off saves at once and keeps its countries. The first engine turned on makes the two AI answer schedules (Monday and Thursday), which Schedules lists as collecting all active prompts, to pause, resume and delete but not to edit.

```

Check the two notes for dashes before you save: `grep -nP '[\x{2013}\x{2014}]' docs/20-frontend-specification.md` must print nothing new.

- [ ] **Step 4: The full gate and the build**

Run in `apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`
Expected: each passes; the build's route table lists `ƒ /[workspace]/[project]/ai/prompts` and `ƒ /[workspace]/[project]/settings/engines`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/flows/ai-prompts.spec.ts docs/20-frontend-specification.md
git commit -m "AI prompts end to end: enable an engine, add by paste, read an answer; axe at four widths in both themes"
```

---

## Self-review

- **Spec coverage (section 4.6 and the brief).** Topics & Prompts page with Topics (default) and Prompts tabs: tasks 4 to 6. Mentioned and Cited per enabled engine as counts: task 5; only enabled engines: tasks 4 and 5 (`enabled`, the Engine filter). Filters for topic, country and engine, the window (28 days by default), branded off by default as doc 16 rule 4 says: tasks 4 and 5. Empty state with the twice-a-week cadence and the no-engine state with its link: task 4. Add prompts with one prompt or a pasted list, shared topic, language and country, lint per line, the quota line from the lint response, bulk-create with rejects, `prompts:write`: task 7. Prompt inspector with facts, counts per engine, answers (date, engine, status, outcome), Run now with the pending, limit, quota, paused and budget words, Archive: task 8. Answer viewer with marks at the evidence spans (unit-tested with emoji and Hindi), sources with role badges, status, the ad note, the raw link for `raw:read`: task 9. Engines in project settings with three switches, countries, the cost from the API before turning on, the spend note, `projects:write`: task 3. Schedules with the `ai_prompt` workload: task 10. MSW handlers for all eleven routes with empty, partial, failed and refused answers and the 150 prompt scale: task 1. Queries, keys and invalidation: task 2. E2E with axe at 1440, 1280, 1024 and 390 px in both themes, and the As built notes: task 11. Section 4.5's "ci is null in slice 1" needs no web work: no interval is shown.
- **Placeholders.** None: each code step holds the code; the few "if the generated name differs" notes say which file to read and what to take from it, since the generated client does not exist until plans A and B are merged.
- **Type consistency.** `PromptScope`, `refreshPrompts`, `enginesQuery`, `summaryQuery(scope, range, includeBranded)`, `usePromptList`, `promptQuery`, `observationsQuery(scope, promptId, range)`, `observationQuery(scope, id)`, `rawAnswerPath`, `projectEntitiesQuery`, `usePromptLint(scope, texts, engineCodes)`, `PUT_ENGINE`, `BULK_CREATE_PROMPTS`, `UPDATE_PROMPT`, `ARCHIVE_PROMPT`, `RUN_NOW` (task 2) are used with these signatures in tasks 3 to 9. `windowRange`, `parseWindow`, `parseTab`, `PROMPTS_TABS`, `countText`, `topicTermsOf`, `hasAnswers`, `readPromptLines`, `promptKeyOf`, `fitsEngine`, `countriesForEngines`, `BULK_MAX` (task 2) match their uses. `usePromptColumns(engines)` and `useEngineColumns(engines, cellsOf, { sortable })` (task 5) are what tasks 5 and 6 call. `TopicsTableProps` gains `activePromptId` and `onOpenPrompt` in task 8 together with the screen that passes them. The mock names (`answerOf`, `observationIdOf`, `runInstants`, `DAY_MS`, `ENGINE_CODES`, `FIXTURE_PROMPTS`, `PROMPT_QUOTA`) are those task 1 exports and tasks 8, 9 and 11 import.


## Notes carried forward from the review of plan A task 8

- A pasted list from a spreadsheet can hold tab characters. The API refuses control characters in prompt text (a tab included) and then refuses the WHOLE bulk-create or lint request with `validation_failed`. The Add prompts dialog must trim each line and replace tabs and other runs of whitespace inside a line with one space before it calls lint or bulk-create (a unit test with a tab-separated line).
- The prompt text rule also refuses the zero width joiner and non-joiner (U+200D, U+200C), which emoji sequences and some Indic and Persian scripts need. Prompts in slice 1 are English; if Hindi or Arabic prompts are added, allow those two characters in `printable` (backend/src/idraft/api/schemas/common.py) first.
- `POST {P}/prompts/lint` with no `engine_codes` checks all three engines, not only the enabled ones: the dialog should pass the project's enabled engine codes so that AI Mode length warnings do not show for a project that has AI Mode off.
