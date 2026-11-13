import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { attachPrevious, compareWindowOf } from './compare';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type { EngineSummary, MetricCell, Schemas } from '@/lib/api/types';
import { dataOf, fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

/**
 * The summary is read through a strict shape declared against the generated types: a change to the schema breaks
 * this file at compile time, and a member the mock adds that the schema does not have fails the parse
 * (`strictObject`). The optional blocks are `exactOptional`: they may be left out and nothing else may be missing.
 */
const POOLED: z.ZodType<Schemas['Pooled']> = z.strictObject({ successes: z.number(), trials: z.number() });
const CELL: z.ZodType<Schemas['MetricCell']> = z.strictObject({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
  pooled: POOLED.nullable().exactOptional(),
});
const OUTCOMES: z.ZodType<Schemas['OutcomeCells']> = z.strictObject({
  cited_only: CELL,
  mentioned_and_cited: CELL,
  mentioned_only: CELL,
  neither: CELL,
});
const ENGINE_CELLS: z.ZodType<Schemas['EngineCells']> = z.strictObject({
  cited: CELL,
  mentioned: CELL,
  outcomes: OUTCOMES,
  share_of_voice: CELL,
});
const ENTITY_PREVIOUS: z.ZodType<Schemas['EntityPreviousCells']> = z.strictObject({
  mentioned: CELL,
  share_of_voice: CELL,
});
const ENTITY_CELLS: z.ZodType<Schemas['EntityCells']> = z.strictObject({
  entity_id: z.string(),
  mentioned: CELL,
  share_of_voice: CELL,
  previous: ENTITY_PREVIOUS.nullable().exactOptional(),
});
const WINDOW: z.ZodType<Schemas['MetricWindow']> = z.strictObject({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
});
const WEEK: z.ZodType<Schemas['WeekCells']> = z.strictObject({
  cited: CELL,
  entities: z
    .array(z.strictObject({ entity_id: z.string(), mentioned: CELL, share_of_voice: CELL }))
    .nullable()
    .exactOptional(),
  is_pooled: z.boolean(),
  mentioned: CELL,
  pool: z
    .strictObject({
      below_prompts: z.number(),
      reason: z.enum(['prompt_point', 'few_prompts']),
      weeks: z.number(),
      window: WINDOW,
    })
    .nullable()
    .exactOptional(),
  prompts: z.number(),
  share_of_voice: CELL,
  week_start: z.string(),
});
const ENGINE: z.ZodType<Schemas['EngineSummary']> = z.strictObject({
  cited: CELL,
  engine_code: z.string(),
  entities: z.array(ENTITY_CELLS).nullable().exactOptional(),
  mentioned: CELL,
  outcomes: OUTCOMES,
  previous: ENGINE_CELLS.nullable().exactOptional(),
  series: z.array(WEEK).nullable().exactOptional(),
  share_of_voice: CELL,
});
const METRIC_CONTEXT: z.ZodType<Schemas['MetricContext']> = z.strictObject({
  method: z.string(),
  metric: z.string(),
  prompt_rows: z.enum(['observation_weighted', 'prompt_weighted']),
  topic_rows: z.enum(['observation_weighted', 'prompt_weighted']),
});
const PROMPT_ROW: z.ZodType<Schemas['PromptSummaryRow']> = z.strictObject({
  engines: z.array(ENGINE),
  is_branded: z.boolean(),
  last_observed_at: z.string().nullable(),
  last_valid_at: z.string().nullable(),
  prompt_id: z.string(),
  text: z.string(),
  topic_term_ids: z.array(z.string()),
});
const TOPIC_ROW: z.ZodType<Schemas['TopicSummaryRow']> = z.strictObject({
  engines: z.array(ENGINE),
  last_observed_at: z.string().nullable(),
  last_valid_at: z.string().nullable(),
  name: z.string().nullable(),
  prompt_count: z.number(),
  term_id: z.string().nullable(),
});
const SUMMARY: z.ZodType<Schemas['PromptsSummary']> = z.strictObject({
  branded_only: z.boolean(),
  compare_window: WINDOW.nullable().exactOptional(),
  engine_codes: z.array(z.string()),
  entities: z.array(z.strictObject({ entity_id: z.string(), name: z.string(), role: z.enum(['own', 'competitor']) })),
  entity_config_versions: z.array(z.number()),
  include_branded: z.boolean(),
  metric_context: z.strictObject({
    cited: METRIC_CONTEXT,
    mentioned: METRIC_CONTEXT,
    outcomes: METRIC_CONTEXT,
    share_of_voice: METRIC_CONTEXT,
  }),
  previous_answers: z.number().nullable().exactOptional(),
  prompts: z.array(PROMPT_ROW),
  topics: z.array(TOPIC_ROW),
  window: WINDOW,
});

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects`;
const FYNIX = `${W}/${fynix.project_id}/ai/prompts-summary`;
const EVENTUS = `${W}/${eventus.project_id}/ai/prompts-summary`;
/** The 28 days just before the 28 days ending 12 November. */
const BEFORE_WINDOW = 'from=2026-09-18&to=2026-10-15';

const get = (path: string): Promise<Answer> => mockBrowser('viewer').call('GET', path);

/** A `200` summary, parsed with the strict shape. */
async function summaryOf(path: string): Promise<Schemas['PromptsSummary']> {
  const answer = await get(path);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return dataOf(answer, SUMMARY);
}

/** The cells an engine row holds of its own window (what `previous` repeats for the compared one). */
const cellsOf = (engine: EngineSummary): Schemas['EngineCells'] => ({
  mentioned: engine.mentioned,
  cited: engine.cited,
  outcomes: engine.outcomes,
  share_of_voice: engine.share_of_voice,
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

const RANGE = { firstDate: '2026-10-16', lastDate: '2026-11-12' };
const TZ = 'Europe/Berlin';
const plan = (query: string, range = RANGE) => compareWindowOf(new URL(`https://x.test/?${query}`), range, TZ, 92);

describe('compareWindowOf', () => {
  it('asks nothing without compare and for compare=none', () => {
    expect(plan('')).toEqual({ kind: 'none' });
    expect(plan('compare=none')).toEqual({ kind: 'none' });
  });

  it('previous_period is as many days just before the window', () => {
    expect(plan('compare=previous_period')).toEqual({
      kind: 'window',
      window: { from: '2026-09-18', to: '2026-10-15', timezone: TZ },
    });
    expect(plan('compare=previous_period', { firstDate: '2026-11-12', lastDate: '2026-11-12' })).toEqual({
      kind: 'window',
      window: { from: '2026-11-11', to: '2026-11-11', timezone: TZ },
    });
  });

  it('previous_year is the same dates a year earlier, and 29 February becomes the 28th', () => {
    expect(plan('compare=previous_year')).toEqual({
      kind: 'window',
      window: { from: '2025-10-16', to: '2025-11-12', timezone: TZ },
    });
    expect(plan('compare=previous_year', { firstDate: '2028-02-29', lastDate: '2028-03-02' })).toEqual({
      kind: 'window',
      window: { from: '2027-02-28', to: '2027-03-02', timezone: TZ },
    });
  });

  it('compare_from and compare_to win over compare, in any position and length', () => {
    const window = { kind: 'window', window: { from: '2026-12-01', to: '2026-12-03', timezone: TZ } };
    expect(plan('compare=none&compare_from=2026-12-01&compare_to=2026-12-03')).toEqual(window);
    expect(plan('compare=previous_year&compare_from=2026-12-01&compare_to=2026-12-03')).toEqual(window);
  });

  it('refuses one of compare_from and compare_to alone, at the missing one', () => {
    expect(plan('compare_from=2026-09-01')).toEqual({
      kind: 'invalid',
      errors: [{ location: 'query', path: 'compare_to', code: 'missing', message: 'Field required' }],
    });
    expect(plan('compare_to=2026-09-01')).toMatchObject({
      kind: 'invalid',
      errors: [{ path: 'compare_from', code: 'missing' }],
    });
  });

  it('refuses compare_from after compare_to as range_invalid at compare_from', () => {
    expect(plan('compare_from=2026-09-10&compare_to=2026-09-01')).toMatchObject({
      kind: 'invalid',
      errors: [{ path: 'compare_from', code: 'range_invalid' }],
    });
  });

  it('refuses a date that is not a date and one outside the calendar', () => {
    expect(plan('compare_from=soon&compare_to=2026-09-01')).toMatchObject({
      kind: 'invalid',
      errors: [{ path: 'compare_from', code: 'date_parsing' }],
    });
    expect(plan('compare_from=2026-02-30&compare_to=2026-09-01')).toMatchObject({
      kind: 'invalid',
      errors: [{ path: 'compare_from', code: 'out_of_range' }],
    });
  });

  it('refuses a compare window of more than 92 days and allows exactly 92', () => {
    expect(plan('compare_from=2026-05-01&compare_to=2026-08-01')).toEqual({ kind: 'too_large', limit_days: 92 });
    expect(plan('compare_from=2026-05-01&compare_to=2026-07-31')).toMatchObject({ kind: 'window' });
  });

  it('refuses a value outside the contract', () => {
    expect(plan('compare=previous_decade')).toEqual({
      kind: 'invalid',
      errors: [
        {
          location: 'query',
          path: 'compare',
          code: 'literal_error',
          message: "Input should be 'none', 'previous_period' or 'previous_year'",
        },
      ],
    });
  });
});

describe('attachPrevious', () => {
  const cell = (k: number, n: number): MetricCell => ({
    value: n === 0 ? null : k / n,
    numerator: k,
    denominator: n,
    n_observations: n,
  });
  const engine = (code: string, k: number, entities?: Schemas['EntityCells'][]): EngineSummary => ({
    engine_code: code,
    mentioned: cell(k, 10),
    cited: cell(k, 10),
    outcomes: {
      cited_only: cell(0, 10),
      mentioned_and_cited: cell(k, 10),
      mentioned_only: cell(0, 10),
      neither: cell(10 - k, 10),
    },
    share_of_voice: cell(k, 10),
    ...(entities === undefined ? {} : { entities }),
  });
  const entity = (id: string, k: number): Schemas['EntityCells'] => ({
    entity_id: id,
    mentioned: cell(k, 10),
    share_of_voice: cell(k, 10),
  });

  it("puts the previous engine's four cells beside the current ones, and nothing else of it", () => {
    const current = engine('a', 6);
    const result = attachPrevious(current, engine('a', 2));
    expect(result).toEqual({ ...current, previous: cellsOf(engine('a', 2)) });
    expect(Object.keys(result.previous ?? {}).sort()).toEqual(['cited', 'mentioned', 'outcomes', 'share_of_voice']);
  });

  it('is null when the engine has no answer of the row in the compared window, with its entities', () => {
    const result = attachPrevious(engine('a', 6, [entity('e1', 3), entity('e2', 1)]), null);
    expect(result.previous).toBeNull();
    expect(result.entities?.map((cells) => cells.previous)).toEqual([null, null]);
  });

  it("gives each entity its own previous cells by entity id, and null exactly when the engine's is null", () => {
    const current = engine('a', 6, [entity('e1', 3), entity('e2', 1)]);
    const result = attachPrevious(current, engine('a', 2, [entity('e2', 7), entity('e1', 5)]));
    expect(result.entities).toEqual([
      { ...entity('e1', 3), previous: { mentioned: cell(5, 10), share_of_voice: cell(5, 10) } },
      { ...entity('e2', 1), previous: { mentioned: cell(7, 10), share_of_voice: cell(7, 10) } },
    ]);
  });

  it('leaves the series and every other member of the current engine as they were', () => {
    const series = [
      {
        week_start: '2026-10-12',
        is_pooled: false,
        prompts: 1,
        mentioned: cell(1, 2),
        cited: cell(1, 2),
        share_of_voice: cell(1, 2),
      },
    ];
    const current: EngineSummary = { ...engine('a', 6), series };
    const result = attachPrevious(current, engine('a', 2));
    expect(result.series).toBe(series);
    expect(result.engine_code).toBe('a');
    expect(result.mentioned).toBe(current.mentioned);
  });
});

describe('the prompts summary with compare', () => {
  it('compare=previous_period echoes compare_window as many days just before and previous_answers', async () => {
    const summary = await summaryOf(`${FYNIX}?compare=previous_period`);
    expect(summary.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' });
    expect(summary.compare_window).toEqual({ from: '2026-09-18', to: '2026-10-15', timezone: 'Europe/Berlin' });
    // The valid answers in scope there, on the engines shown: what a request for that window counts per prompt
    const direct = await summaryOf(`${FYNIX}?${BEFORE_WINDOW}`);
    const valid = direct.prompts
      .flatMap((row) => row.engines)
      .reduce((sum, engine) => sum + engine.mentioned.denominator, 0);
    expect(valid).toBeGreaterThan(0);
    expect(summary.previous_answers).toBe(valid);
  });

  it('previous of every engine of a prompt row and a topic row equals the cells of a request for exactly that window', async () => {
    for (const path of [FYNIX, EVENTUS]) {
      setAiSeeded(path === EVENTUS);
      const compared = await summaryOf(`${path}?compare=previous_period&include=entities`);
      const direct = await summaryOf(`${path}?${BEFORE_WINDOW}&include=entities`);
      const directRows = new Map(direct.prompts.map((row) => [row.prompt_id, row.engines]));
      const directTopics = new Map(direct.topics.map((row) => [row.term_id, row.engines]));
      expect(compared.prompts.length).toBeGreaterThan(0);
      expect(compared.topics.length).toBeGreaterThan(0);
      const pairs = [
        ...compared.prompts.map((row) => [row.engines, directRows.get(row.prompt_id)] as const),
        ...compared.topics.map((row) => [row.engines, directTopics.get(row.term_id)] as const),
      ];
      for (const [engines, before] of pairs) {
        expect(before).toBeDefined();
        for (const engine of engines) {
          const earlier = before?.find((candidate) => candidate.engine_code === engine.engine_code);
          expect(earlier).toBeDefined();
          expect(engine.previous).toEqual(earlier === undefined ? undefined : cellsOf(earlier));
          expect(engine.entities?.length).toBeGreaterThan(0);
          for (const cells of engine.entities ?? []) {
            const then = earlier?.entities?.find((candidate) => candidate.entity_id === cells.entity_id);
            expect(cells.previous).toEqual({ mentioned: then?.mentioned, share_of_voice: then?.share_of_voice });
          }
        }
      }
    }
  });

  it('the current cells and the window are those of the request without compare', async () => {
    const plain = await summaryOf(`${FYNIX}?include=series`);
    const compared = await summaryOf(`${FYNIX}?include=series&compare=previous_period`);
    const stripped = structuredClone(compared);
    delete stripped.compare_window;
    delete stripped.previous_answers;
    for (const row of [...stripped.prompts, ...stripped.topics]) {
      for (const engine of row.engines) delete engine.previous;
    }
    expect(stripped).toEqual(plain);
  });

  it('an answer without compare carries no previous, compare_window or previous_answers, and compare=none is the same', async () => {
    const plain = await get(`${FYNIX}?include=series,entities`);
    expect(plain.status).toBe(200);
    const text = JSON.stringify(plain.body);
    for (const key of ['"previous"', '"compare_window"', '"previous_answers"']) expect(text).not.toContain(key);
    const none = await get(`${FYNIX}?include=series,entities&compare=none`);
    expect(none.body).toEqual(plain.body);
  });

  it('previous is null on every engine, and previous_answers 0, where the compared days hold no answer', async () => {
    const summary = await summaryOf(`${FYNIX}?compare_from=2026-06-01&compare_to=2026-06-28&include=entities`);
    expect(summary.compare_window).toEqual({ from: '2026-06-01', to: '2026-06-28', timezone: 'Europe/Berlin' });
    expect(summary.previous_answers).toBe(0);
    const engines = [...summary.prompts, ...summary.topics].flatMap((row) => row.engines);
    expect(engines.length).toBeGreaterThan(0);
    for (const engine of engines) {
      expect(engine.previous).toBeNull();
      for (const cells of engine.entities ?? []) expect(cells.previous).toBeNull();
    }
  });

  it('a 92 day window has previous null and previous_answers 0', async () => {
    const summary = await summaryOf(`${FYNIX}?from=2026-08-13&to=2026-11-12&compare=previous_period`);
    expect(summary.compare_window).toEqual({ from: '2026-05-13', to: '2026-08-12', timezone: 'Europe/Berlin' });
    expect(summary.previous_answers).toBe(0);
    const engines = [...summary.prompts, ...summary.topics].flatMap((row) => row.engines);
    expect(engines.length).toBeGreaterThan(0);
    expect(engines.every((engine) => engine.previous === null)).toBe(true);
  });

  it('compare=previous_year is the same dates a year earlier, which hold no answer', async () => {
    const year = await summaryOf(`${FYNIX}?compare=previous_year`);
    expect(year.compare_window).toEqual({ from: '2025-10-16', to: '2025-11-12', timezone: 'Europe/Berlin' });
    expect(year.previous_answers).toBe(0);
  });

  it('compare_from and compare_to win over compare, and compare_from alone is 422 at compare_to', async () => {
    const custom = await summaryOf(`${FYNIX}?compare=none&compare_from=2026-09-18&compare_to=2026-10-15`);
    const period = await summaryOf(`${FYNIX}?compare=previous_period`);
    expect(custom).toEqual(period);
    const alone = await get(`${FYNIX}?compare_from=2026-09-18`);
    expect(alone.status).toBe(422);
    expect(fieldCodes(alone)).toEqual(['compare_to:missing']);
  });

  it('compare_from after compare_to is 422 range_invalid and compare=previous_decade is 422', async () => {
    const inverted = await get(`${FYNIX}?compare_from=2026-10-15&compare_to=2026-09-18`);
    expect(inverted.status).toBe(422);
    expect(fieldCodes(inverted)).toEqual(['compare_from:range_invalid']);
    const decade = await get(`${FYNIX}?compare=previous_decade`);
    expect(decade.status).toBe(422);
    expect(fieldCodes(decade)).toEqual(['compare:literal_error']);
  });

  it('a compare window over 92 days is 422 window_too_large', async () => {
    const answer = await get(`${FYNIX}?compare_from=2026-05-01&compare_to=2026-08-01`);
    expect(answer.status).toBe(422);
    expect(answer.code).toBe('window_too_large');
    expect(answer.body.limit_days).toBe(92);
  });

  it('a window over 46 days has a partial previous period that still carries cells, and engines asked for are the engines shown', async () => {
    const summary = await summaryOf(
      `${FYNIX}?from=2026-09-18&to=2026-11-12&compare=previous_period&filter[engine_code_in]=gemini_web`,
    );
    expect(summary.engine_codes).toEqual(['gemini_web']);
    const engines = summary.prompts.flatMap((row) => row.engines);
    expect(engines.every((engine) => engine.engine_code === 'gemini_web' && engine.previous != null)).toBe(true);
    expect(summary.previous_answers).toBeGreaterThan(0);
  });

  it('rows=none keeps compare_window and previous_answers and leaves the row lists empty', async () => {
    const summary = await summaryOf(`${FYNIX}?rows=none&compare=previous_period`);
    expect(summary.prompts).toEqual([]);
    expect(summary.topics).toEqual([]);
    expect(summary.compare_window).not.toBeNull();
    expect(summary.previous_answers).toBeGreaterThan(0);
  });
});
