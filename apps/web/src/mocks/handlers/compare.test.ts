import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { attachPrevious, compareWindowOf, previousEngineOf, withDetectableChange } from './compare';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { COMPARE_DETECTABLE_COOKIE, MOCK_COOKIES } from '../session';
import type { EngineSummary, MetricCell, Schemas } from '@/lib/api/types';
import { averageChangeOf } from '@/lib/compare/change-model';
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

  it('refuses a value outside the contract even when compare_from and compare_to are given, and ignores their dates', () => {
    const decade = 'compare=previous_decade';
    for (const dates of ['compare_from=2026-09-01&compare_to=2026-09-10', 'compare_from=soon&compare_to=2026-09-10']) {
      const answer = plan(`${decade}&${dates}`);
      expect(answer).toMatchObject({ kind: 'invalid', errors: [{ path: 'compare', code: 'literal_error' }] });
      expect(answer.kind === 'invalid' ? answer.errors : []).toHaveLength(1);
    }
    // Custom dates win over a valid compare value only
    expect(plan('compare=previous_year&compare_from=2026-09-01&compare_to=2026-09-10')).toMatchObject({
      kind: 'window',
      window: { from: '2026-09-01', to: '2026-09-10' },
    });
  });
});

describe('previousEngineOf', () => {
  const engine: EngineSummary = {
    engine_code: 'a',
    mentioned: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
    cited: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
    outcomes: {
      cited_only: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
      mentioned_and_cited: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
      mentioned_only: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
      neither: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
    },
    share_of_voice: { value: null, numerator: 0, denominator: 0, n_observations: 2 },
  };
  // Of the prompts p1, p2 and p3 only p2 has an answer of the engine in the compared window
  const answered = (id: string): boolean => id === 'p2';

  it('builds the previous engine for a row of which some prompt answered, and only then', () => {
    const build = vi.fn(() => engine);
    expect(previousEngineOf(['p2'], answered, build)).toBe(engine);
    expect(previousEngineOf(['p1', 'p2', 'p3'], answered, build)).toBe(engine);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('is null for a row of which no prompt answered, without building anything', () => {
    const build = vi.fn(() => engine);
    expect(previousEngineOf(['p1'], answered, build)).toBeNull();
    expect(previousEngineOf(['p1', 'p3'], answered, build)).toBeNull();
    expect(previousEngineOf([], answered, build)).toBeNull();
    expect(build).not.toHaveBeenCalled();
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

  it('compare=previous_decade is 422 even with compare_from and compare_to, whatever their dates', async () => {
    for (const dates of [
      'compare_from=2026-09-18&compare_to=2026-10-15',
      'compare_from=2026-05-01&compare_to=2026-09-01',
    ]) {
      const answer = await get(`${FYNIX}?compare=previous_decade&${dates}`);
      expect(answer.status).toBe(422);
      expect(fieldCodes(answer)).toEqual(['compare:literal_error']);
    }
  });

  it('a one day compare window reads null exactly where the row has no answer of any status that day, and cells otherwise', async () => {
    // Thursday 15 October holds a run: every prompt answered on every engine, but some answers are not valid
    for (const path of [FYNIX, EVENTUS]) {
      setAiSeeded(path === EVENTUS);
      for (const [day, answeredThatDay] of [
        ['2026-10-15', true],
        ['2026-10-16', false],
      ] as const) {
        const compared = await summaryOf(`${path}?compare_from=${day}&compare_to=${day}&include=entities`);
        const direct = await summaryOf(`${path}?from=${day}&to=${day}&include=entities`);
        const rows = [
          ...compared.prompts.map(
            (row) => [row.engines, direct.prompts.find((r) => r.prompt_id === row.prompt_id)] as const,
          ),
          ...compared.topics.map((row) => [row.engines, direct.topics.find((r) => r.term_id === row.term_id)] as const),
        ];
        let notValid = 0;
        for (const [engines, earlier] of rows) {
          for (const engine of engines) {
            const then = earlier?.engines.find((candidate) => candidate.engine_code === engine.engine_code);
            // A fact row of any status is counted in n_observations; valid ones alone in the denominator
            const hasFactRow = then !== undefined && then.mentioned.n_observations > 0;
            expect(hasFactRow).toBe(answeredThatDay);
            expect(engine.previous).toEqual(hasFactRow && then !== undefined ? cellsOf(then) : null);
            if (hasFactRow && then?.mentioned.denominator === 0) notValid += 1;
          }
        }
        // The rows with answers and none valid keep cells with a denominator of 0: they are not null
        if (answeredThatDay) expect(notValid).toBeGreaterThan(0);
      }
    }
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

describe('withDetectableChange', () => {
  interface Answer {
    facts: { is_valid: boolean; own_mentioned: boolean };
  }
  type Answers = Map<string, Map<string, Answer[]>>;
  const answer = (mentioned: boolean, valid = true): Answer => ({
    facts: { is_valid: valid, own_mentioned: mentioned },
  });
  const answers = (entries: Record<string, Record<string, Answer[]>>): Answers =>
    new Map(Object.entries(entries).map(([prompt, engines]) => [prompt, new Map(Object.entries(engines))]));
  const mentions = (source: Answers, prompt: string): boolean[] =>
    [...(source.get(prompt)?.values() ?? [])].flat().map((one) => one.facts.own_mentioned);
  // The smallest topic is `small`, which holds the prompts d and e
  const held = new Map([
    ['big', new Set(['a', 'b', 'c'])],
    ['small', new Set(['d', 'e'])],
  ]);
  const now = answers({
    a: { x: [answer(true)] },
    d: { x: [answer(true), answer(true), answer(false)], y: [answer(true)] },
    e: { x: [answer(true)] },
  });
  const before = answers({
    a: { x: [answer(true)] },
    d: { x: [answer(true), answer(false), answer(false)], y: [answer(false)] },
    e: { x: [answer(false)] },
  });

  it('is the very same answers when nothing asks for it', () => {
    expect(withDetectableChange(before, now, held, false)).toBe(before);
  });

  it('turns each prompt of the smallest topic from mostly mentioned to never mentioned, keeping every answer', () => {
    const moved = withDetectableChange(before, now, held, true);
    expect(mentions(moved, 'd')).toEqual([false, false, false, false]);
    expect(mentions(moved, 'e')).toEqual([false]);
    expect(moved.get('d')?.get('x')).toHaveLength(3);
    expect(moved.get('d')?.get('y')).toHaveLength(1);
  });

  it('turns a prompt that was mostly not mentioned into always mentioned, and leaves validity as it was', () => {
    const quiet = new Map(now).set('d', new Map([['x', [answer(false), answer(false), answer(true, false)]]]));
    const moved = withDetectableChange(before, quiet, held, true);
    expect(mentions(moved, 'd')).toEqual([true, true, true, true]);
    expect(
      moved
        .get('d')
        ?.get('x')
        ?.map((one) => one.facts.is_valid),
    ).toEqual(
      before
        .get('d')
        ?.get('x')
        ?.map((one) => one.facts.is_valid),
    );
  });

  it('leaves every prompt outside the smallest topic as it was', () => {
    const moved = withDetectableChange(before, now, held, true);
    expect(moved.get('a')).toBe(before.get('a'));
  });

  it('leaves a prompt with no valid answer now as it was, and changes nothing when no topic is held', () => {
    const invalid = new Map([['x', [answer(true, false)]]]);
    const silent = new Map(now).set('d', invalid).set('e', invalid);
    expect(withDetectableChange(before, silent, held, true)).toEqual(before);
    expect(withDetectableChange(before, now, new Map(), true)).toBe(before);
  });
});

describe('the prompts summary with the mock-compare-detectable cookie', () => {
  const PAID_SEARCH_PROMPT = 'What is the best way to manage paid search on a small budget?';
  /** The prompts of the smallest topic of the Fynix fixtures, oldest first. */
  const PAID_SEARCH_PROMPTS = [PAID_SEARCH_PROMPT, 'How do I lower the cost per click of search ads?'];
  const COMPARED = `${FYNIX}?compare=previous_period&include=entities`;
  const withCookie = (value: string): ReturnType<typeof mockBrowser> =>
    mockBrowser('viewer', new Map([[COMPARE_DETECTABLE_COOKIE, value]]));

  async function cookieSummary(path: string, value = 'on'): Promise<Schemas['PromptsSummary']> {
    const answer = await withCookie(value).call('GET', path);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return dataOf(answer, SUMMARY);
  }

  /** The prompts and topics whose Mention change, over the engines shown, is larger than normal variation. */
  function detectableRows(summary: Schemas['PromptsSummary']): { prompts: string[]; topics: (string | null)[] } {
    const detectable = (row: { engines: EngineSummary[] }): boolean =>
      averageChangeOf(row.engines, summary.engine_codes, 'mentioned')?.detectable === true;
    return {
      prompts: summary.prompts.filter(detectable).map((row) => row.text),
      topics: summary.topics.filter(detectable).map((row) => row.name),
    };
  }

  it('is a cookie of the mocks, so a test starts without it', () => {
    expect(MOCK_COOKIES).toContain(COMPARE_DETECTABLE_COOKIE);
    expect(COMPARE_DETECTABLE_COOKIE).toBe('mock-compare-detectable');
  });

  it('is not needed for the default Fynix data: no row has a detectable change at 28 days', async () => {
    expect(detectableRows(await summaryOf(COMPARED))).toEqual({ prompts: [], topics: [] });
  });

  it('with the cookie exactly the two prompts of Paid Search and that one topic have a detectable change', async () => {
    const summary = await cookieSummary(COMPARED);
    expect(detectableRows(summary)).toEqual({ prompts: PAID_SEARCH_PROMPTS, topics: ['Paid Search'] });
  });

  it('draws the change as the same number of answers with a very different number of mentions', async () => {
    const plain = await summaryOf(COMPARED);
    const moved = await cookieSummary(COMPARED);
    const rowOf = (summary: Schemas['PromptsSummary']) =>
      summary.prompts.find((row) => row.text === PAID_SEARCH_PROMPT);
    for (const engine of rowOf(moved)?.engines ?? []) {
      const was = rowOf(plain)?.engines.find((candidate) => candidate.engine_code === engine.engine_code);
      expect(engine.previous?.mentioned.denominator).toBe(was?.previous?.mentioned.denominator);
      expect(engine.previous?.mentioned.numerator).not.toBe(was?.previous?.mentioned.numerator);
      expect(engine.mentioned).toEqual(was?.mentioned);
    }
    expect(moved.previous_answers).toBe(plain.previous_answers);
  });

  it('changes nothing but the compared window of those prompts, and of the topics that hold them', async () => {
    const plain = await summaryOf(COMPARED);
    const moved = await cookieSummary(COMPARED);
    const bare = (summary: Schemas['PromptsSummary']): Schemas['PromptsSummary'] => {
      const copy = structuredClone(summary);
      for (const row of [...copy.prompts, ...copy.topics]) {
        for (const engine of row.engines) delete engine.previous;
      }
      return copy;
    };
    expect(bare(moved)).toEqual(bare(plain));
    const changed = (summary: Schemas['PromptsSummary']): string[] =>
      summary.prompts
        .filter((row, index) => JSON.stringify(row) !== JSON.stringify(plain.prompts[index]))
        .map((row) => row.text);
    expect(changed(moved)).toEqual(PAID_SEARCH_PROMPTS);
  });

  it('leaves the answer byte for byte as it was without the cookie, whatever else is asked', async () => {
    for (const path of [`${FYNIX}?include=series,entities`, `${FYNIX}?${BEFORE_WINDOW}`]) {
      const plain = await get(path);
      expect((await withCookie('on').call('GET', path)).body).toEqual(plain.body);
    }
    // A value other than on is no request for the change
    const plain = await get(COMPARED);
    expect((await withCookie('off').call('GET', COMPARED)).body).toEqual(plain.body);
  });
});
