import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { EVENTUS_WORLD } from '../ai-prompt-world';
import { setAiSeeded } from '../ai-seed';
import { MOCK_TERMS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { dataOf, fieldCodes, mockBrowser, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const EVENTUS = `${W}/projects/${eventus.project_id}`;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
let clock = NOW;
const PROJECTS = [
  { name: 'Fynix', base: FYNIX },
  { name: 'Eventus Security', base: EVENTUS },
] as const;

const CELL = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
  pooled: z.object({ successes: z.number(), trials: z.number() }).nullable(),
});
type Cell = z.infer<typeof CELL>;
const POOL = z.object({
  weeks: z.number(),
  window: z.object({ from: z.string(), to: z.string(), timezone: z.string() }),
  reason: z.enum(['prompt_point', 'few_prompts']),
  below_prompts: z.number(),
});
const ENTITY = z.object({ entity_id: z.string(), mentioned: CELL, share_of_voice: CELL });
const WEEK = z.object({
  week_start: z.string(),
  prompts: z.number(),
  is_pooled: z.boolean(),
  pool: POOL.nullable().optional(),
  mentioned: CELL,
  cited: CELL,
  share_of_voice: CELL,
  entities: z.array(ENTITY).nullable().optional(),
});
const ENGINE = z.object({
  engine_code: z.string(),
  mentioned: CELL,
  cited: CELL,
  share_of_voice: CELL,
  series: z.array(WEEK).optional(),
  entities: z.array(ENTITY).optional(),
});
type Engine = z.infer<typeof ENGINE>;
const SUMMARY = z.object({
  window: z.object({ from: z.string(), to: z.string(), timezone: z.string() }),
  engine_codes: z.array(z.string()),
  prompts: z.array(z.object({ prompt_id: z.string(), topic_term_ids: z.array(z.string()), engines: z.array(ENGINE) })),
  topics: z.array(
    z.object({
      term_id: z.string().nullable(),
      name: z.string().nullable(),
      prompt_count: z.number(),
      engines: z.array(ENGINE),
    }),
  ),
});
type Summary = z.infer<typeof SUMMARY>;
const RUN = z.object({ run_id: z.string() });

beforeEach(() => {
  clock = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const summaryOf = async (who: MockBrowser, base: string, query = ''): Promise<Summary> =>
  dataOf(await who.call('GET', `${base}/ai/prompts-summary${query}`), SUMMARY);
const seriesOf = (engine: Engine): NonNullable<Engine['series']> => {
  if (engine.series === undefined) throw new Error(`No series on ${engine.engine_code}`);
  return engine.series;
};
const engineRows = (summary: Summary): Engine[] => [
  ...summary.prompts.flatMap((row) => row.engines),
  ...summary.topics.flatMap((row) => row.engines),
];
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const mondayOf = (isoDate: string): boolean => new Date(`${isoDate}T00:00:00Z`).getUTCDay() === 1;
const CELLS = ['mentioned', 'cited', 'share_of_voice'] as const;
const cellsOf = (point: z.infer<typeof WEEK>, name: (typeof CELLS)[number]): Cell => point[name];

describe('the weekly series of the prompts summary', () => {
  it('is left out of every engine unless it is asked for', async () => {
    for (const { base } of PROJECTS) {
      for (const query of ['', '?include=', '?include=entities']) {
        for (const engine of engineRows(await summaryOf(mockBrowser('viewer'), base, query))) {
          expect(engine).not.toHaveProperty('series');
        }
      }
    }
  });

  it('has a point for each Monday the window touches, oldest first, on every engine of every prompt and topic', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series');
      expect(summary.window.from, name).toBe('2026-10-16');
      const weeks = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
      expect(engineRows(summary).length, name).toBeGreaterThan(0);
      for (const engine of engineRows(summary)) {
        expect(
          seriesOf(engine).map((point) => point.week_start),
          name,
        ).toEqual(weeks);
        expect(weeks.every(mondayOf)).toBe(true);
      }
    }
  });

  it('counts the runs of each week inside the window: none before the first Monday run, then Monday and Thursday', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series');
      for (const row of summary.prompts) {
        for (const engine of row.engines) {
          // The window starts on Friday 16 October: the week of the 12th holds no run of its own days. A prompt point
          // pools the week and the weeks before it, so the counts of the weeks 0, 2, 2, 2, 2 build up to four weeks
          expect(
            seriesOf(engine).map((point) => point.mentioned.n_observations),
            name,
          ).toEqual([0, 2, 4, 6, 8]);
        }
      }
    }
  });

  it('fills a week without answers with zero counts and no value', async () => {
    const summary = await summaryOf(mockBrowser('viewer'), FYNIX, '?include=series');
    const engine = summary.prompts[0]?.engines[0];
    if (engine === undefined) throw new Error('The summary has no prompt');
    const [first] = seriesOf(engine);
    if (first === undefined) throw new Error('The series has no point');
    for (const name of CELLS) {
      expect(cellsOf(first, name)).toEqual({
        value: null,
        numerator: 0,
        denominator: 0,
        n_observations: 0,
        pooled: null,
      });
    }
  });

  it('pools every point of a prompt row over the week and the three before it, cut at the window start', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series&include_branded=true');
      for (const row of summary.prompts) {
        for (const engine of row.engines) {
          const points = seriesOf(engine);
          expect(
            points.map((point) => [point.is_pooled, point.pool?.weeks, point.pool?.reason, point.pool?.below_prompts]),
            name,
          ).toEqual([1, 2, 3, 4, 4].map((weeks) => [true, weeks, 'prompt_point', 10]));
          // The week of the 12th opens before the window: its pool starts on the window's first day
          expect(points[0]?.pool?.window, name).toEqual({
            from: '2026-10-16',
            to: '2026-10-18',
            timezone: summary.window.timezone,
          });
          expect(points[4]?.pool?.window.to, name).toBe(summary.window.to);
          // The last point holds the four weeks that carry every answer of the window, so it is the window cell
          const last = points.at(-1);
          if (last === undefined) throw new Error('The series has no point');
          for (const metric of CELLS) {
            const cell = cellsOf(last, metric);
            expect(cell.numerator, name).toBeCloseTo(engine[metric].numerator, 9);
            expect(cell.denominator, name).toBe(engine[metric].denominator);
            expect(cell.n_observations, name).toBe(engine[metric].n_observations);
          }
          for (const point of points) {
            for (const metric of CELLS) {
              const cell = cellsOf(point, metric);
              expect(cell.pooled).toBeNull();
              expect(cell.value).toBe(cell.denominator === 0 ? null : cell.numerator / cell.denominator);
            }
          }
        }
      }
    }
  });

  it('weighs a topic by prompt over the weeks its point pools, and leaves a point of 10 prompts to its own week', async () => {
    const parents = new Map(
      [...MOCK_TERMS, ...EVENTUS_WORLD.terms].map((term) => [term.term_id, term.parent_id ?? null]),
    );
    const withAncestors = (termId: string): string[] => {
      const chain: string[] = [];
      for (let at: string | null | undefined = termId; at !== null && at !== undefined; at = parents.get(at))
        chain.push(at);
      return chain;
    };
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series');
      let fractional = false;
      for (const topic of summary.topics) {
        const members = summary.prompts.filter((prompt) =>
          topic.term_id === null
            ? prompt.topic_term_ids.length === 0
            : prompt.topic_term_ids.some((term) => withAncestors(term).includes(topic.term_id ?? '')),
        );
        expect(members, name).toHaveLength(topic.prompt_count);
        for (const engine of topic.engines) {
          const mine = members.map((prompt) => {
            const found = prompt.engines.find((candidate) => candidate.engine_code === engine.engine_code);
            if (found === undefined) throw new Error('No engine cells');
            return seriesOf(found);
          });
          seriesOf(engine).forEach((point, week) => {
            // A topic point pools only when fewer than 10 of its prompts answered that week alone
            expect(point.is_pooled, name).toBe(point.prompts < 10);
            expect(point.pool?.reason, name).toBe(point.is_pooled ? 'few_prompts' : undefined);
            if (!point.is_pooled) return;
            // The prompt rows pool the same weeks, so each prompt's pooled point is the prompt's part of this one
            for (const metric of ['mentioned', 'cited'] as const) {
              const rated = mine.flatMap((points) => {
                const cell = points[week] === undefined ? null : cellsOf(points[week], metric);
                return cell !== null && cell.denominator > 0 ? [cell] : [];
              });
              const cell = cellsOf(point, metric);
              expect(cell.numerator, name).toBeCloseTo(sum(rated.map((one) => one.numerator / one.denominator)), 9);
              expect(cell.denominator, name).toBe(rated.length);
              expect(cell.pooled, name).toEqual({
                successes: sum(rated.map((one) => one.numerator)),
                trials: sum(rated.map((one) => one.denominator)),
              });
              if (!Number.isInteger(cell.numerator)) fractional = true;
            }
            const sov = cellsOf(point, 'share_of_voice');
            const parts = mine.map((points) => points[week]).flatMap((one) => (one === undefined ? [] : [one]));
            expect(sov.numerator, name).toBeCloseTo(sum(parts.map((one) => one.share_of_voice.numerator)), 9);
            expect(sov.denominator, name).toBe(sum(parts.map((one) => one.share_of_voice.denominator)));
            expect(sov.pooled).toBeNull();
          });
          // The last point pools the four weeks that carry every answer of the window, so it is the window cell
          const last = seriesOf(engine).at(-1);
          if (last?.is_pooled === true) {
            for (const metric of ['mentioned', 'cited'] as const) {
              const cell = cellsOf(last, metric);
              expect(cell.numerator, name).toBeCloseTo(engine[metric].numerator, 9);
              expect(cell.denominator, name).toBe(engine[metric].denominator);
              expect(cell.pooled, name).toEqual(engine[metric].pooled);
              expect(cell.n_observations, name).toBe(engine[metric].n_observations);
            }
          }
        }
      }
      // A sum of weekly rates is not a count of answers, and not the window's numerator
      expect(fractional, name).toBe(true);
    }
  });

  it('cuts the first and last weeks at the window bounds, and the first week_start may precede the window', async () => {
    for (const { name, base } of PROJECTS) {
      const thursday = await summaryOf(mockBrowser('viewer'), base, '?include=series&from=2026-11-12&to=2026-11-12');
      for (const row of thursday.prompts) {
        for (const engine of row.engines) {
          // The Monday run of the same week is outside the window
          expect(seriesOf(engine), name).toHaveLength(1);
          expect(seriesOf(engine)[0]).toMatchObject({ week_start: '2026-11-09', mentioned: { n_observations: 1 } });
          expect(engine.mentioned.n_observations).toBe(1);
        }
      }
      const between = await summaryOf(mockBrowser('viewer'), base, '?include=series&from=2026-11-10&to=2026-11-11');
      for (const engine of between.prompts.flatMap((row) => row.engines)) {
        expect(
          seriesOf(engine).map((point) => [point.week_start, point.mentioned.n_observations]),
          name,
        ).toEqual([['2026-11-09', 0]]);
      }
      // Monday to Sunday: the same week, both runs
      const week = await summaryOf(mockBrowser('viewer'), base, '?include=series&from=2026-11-09&to=2026-11-15');
      for (const engine of week.prompts.flatMap((row) => row.engines)) {
        expect(
          seriesOf(engine).map((point) => point.mentioned.n_observations),
          name,
        ).toEqual([2]);
      }
    }
  });

  it('has at most 14 points, the weeks of the longest window of 92 days', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series&from=2026-08-13&to=2026-11-12');
      expect(summary.window.from).toBe('2026-08-13');
      for (const row of summary.prompts) {
        for (const engine of row.engines) {
          const points = seriesOf(engine);
          expect(points, name).toHaveLength(14);
          expect(points[0]?.week_start).toBe('2026-08-10');
          expect(points.at(-1)?.week_start).toBe('2026-11-09');
          // 92 days of Monday and Thursday runs: the Thursday of the first week, then two a week, each point
          // pooling the week and the three before it (the first three pool fewer, the window opening in the first)
          expect(
            points.map((point) => point.mentioned.n_observations),
            name,
          ).toEqual([1, 3, 5, 7, ...Array<number>(10).fill(8)]);
        }
      }
    }
  });

  it('follows the request window and the engine filter', async () => {
    const summary = await summaryOf(
      mockBrowser('viewer'),
      FYNIX,
      '?include=series&filter[engine_code_in]=gemini_web&from=2026-11-02&to=2026-11-08',
    );
    expect(summary.engine_codes).toEqual(['gemini_web']);
    for (const engine of summary.prompts.flatMap((row) => row.engines)) {
      expect(engine.engine_code).toBe('gemini_web');
      expect(seriesOf(engine).map((point) => [point.week_start, point.mentioned.n_observations])).toEqual([
        ['2026-11-02', 2],
      ]);
    }
  });

  it('is asked with the entity cells in either order, and neither block changes the other', async () => {
    const viewer = mockBrowser('viewer');
    for (const { name, base } of PROJECTS) {
      const series = await summaryOf(viewer, base, '?include=series');
      const entities = await summaryOf(viewer, base, '?include=entities');
      for (const query of [
        '?include=series,entities',
        '?include=entities,series',
        '?include=series&include=entities',
      ]) {
        const both = await summaryOf(viewer, base, query);
        const rows = engineRows(both);
        expect(rows.length, name).toBeGreaterThan(0);
        // The weekly points keep their own cells; asking for the entities adds theirs to each point
        expect(
          rows.map((engine) => engine.series?.map((point) => ({ ...point, entities: undefined }))),
          name,
        ).toEqual(engineRows(series).map((engine) => engine.series));
        expect(
          rows.map((engine) => engine.entities),
          name,
        ).toEqual(engineRows(entities).map((engine) => engine.entities));
        expect(rows.every((engine) => (engine.entities?.length ?? 0) > 0)).toBe(true);
      }
    }
  });

  it('leaves the entity cells out of a weekly point unless series and entities are both asked', async () => {
    const viewer = mockBrowser('viewer');
    for (const { name, base } of PROJECTS) {
      for (const query of ['?include=series', '?include=entities', '']) {
        for (const engine of engineRows(await summaryOf(viewer, base, query))) {
          for (const point of engine.series ?? []) expect(point, `${name} ${query}`).not.toHaveProperty('entities');
        }
      }
    }
  });

  it('gives a weekly point the entity cells of the engine, the same entities in the same order', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series,entities&include_branded=true');
      const rows = engineRows(summary);
      expect(rows.length, name).toBeGreaterThan(0);
      for (const engine of rows) {
        const ids = (engine.entities ?? []).map((cells) => cells.entity_id);
        expect(ids.length, name).toBeGreaterThan(0);
        for (const point of seriesOf(engine)) {
          expect(
            (point.entities ?? []).map((cells) => cells.entity_id),
            name,
          ).toEqual(ids);
        }
      }
    }
  });

  it('gives a pooled point the entity cells of the weeks it pools, over the answers of its own cells', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series,entities&include_branded=true');
      for (const row of summary.prompts) {
        for (const engine of row.engines) {
          const points = seriesOf(engine);
          points.forEach((point) => {
            for (const cells of point.entities ?? []) {
              // A prompt's entity is counted over the same valid answers as the prompt's own cells of the point
              expect(cells.mentioned.denominator, name).toBe(point.mentioned.denominator);
              expect(cells.mentioned.n_observations, name).toBe(point.mentioned.n_observations);
              expect(cells.share_of_voice.denominator, name).toBe(point.share_of_voice.denominator);
              expect(cells.mentioned.numerator, name).toBeLessThanOrEqual(cells.mentioned.denominator);
            }
          });
          // The last point pools the four weeks that carry every answer of the window: it is the window's entity cells
          const last = points.at(-1);
          for (const window of engine.entities ?? []) {
            const found = last?.entities?.find((cells) => cells.entity_id === window.entity_id);
            expect(found?.mentioned.numerator, name).toBeCloseTo(window.mentioned.numerator, 9);
            expect(found?.mentioned.denominator, name).toBe(window.mentioned.denominator);
            expect(found?.share_of_voice.numerator, name).toBeCloseTo(window.share_of_voice.numerator, 9);
          }
        }
      }
    }
  });

  it('weighs a topic point Mentioned by prompt and share of voice by answer, as the point own cells are', async () => {
    for (const { name, base } of PROJECTS) {
      const summary = await summaryOf(mockBrowser('viewer'), base, '?include=series,entities&include_branded=true');
      let fractional = false;
      for (const topic of summary.topics) {
        for (const engine of topic.engines) {
          const entities = new Map((engine.entities ?? []).map((cells) => [cells.entity_id, cells]));
          for (const point of seriesOf(engine)) {
            for (const cells of point.entities ?? []) {
              // The prompts that count are those with a valid answer in the weeks the point holds, as for the own cell
              expect(cells.mentioned.denominator, name).toBe(point.mentioned.denominator);
              expect(cells.mentioned.pooled?.trials, name).toBe(point.mentioned.pooled?.trials);
              expect(cells.mentioned.pooled?.successes ?? 0, name).toBeLessThanOrEqual(
                cells.mentioned.pooled?.trials ?? 0,
              );
              // Share of voice is one answer one weight: it carries no count of prompts
              expect(cells.share_of_voice.pooled, name).toBeNull();
              expect(cells.share_of_voice.denominator, name).toBe(point.share_of_voice.denominator);
              if (!Number.isInteger(cells.mentioned.numerator)) fractional = true;
            }
          }
          // When the last point pools the four weeks that carry the window, it holds the window's cells of each entity
          const last = seriesOf(engine).at(-1);
          if (last?.is_pooled === true) {
            for (const cells of last.entities ?? []) {
              const window = entities.get(cells.entity_id);
              expect(cells.mentioned.numerator, name).toBeCloseTo(window?.mentioned.numerator ?? NaN, 9);
              expect(cells.mentioned.denominator, name).toBe(window?.mentioned.denominator);
            }
          }
        }
      }
      // A sum of prompt rates is not a count of answers
      expect(fractional, name).toBe(true);
    }
  });

  it('keeps the entity cells of one topic under filter[term]', async () => {
    const all = await summaryOf(mockBrowser('viewer'), FYNIX, '?rows=topics&include=series,entities');
    const [first] = all.topics;
    if (first?.term_id == null) throw new Error('The summary has no topic');
    const one = await summaryOf(
      mockBrowser('viewer'),
      FYNIX,
      `?rows=topics&include=series,entities&filter[term]=${first.term_id}`,
    );
    const mine = one.topics.find((topic) => topic.term_id === first.term_id);
    expect(mine?.engines.every((engine) => seriesOf(engine).every((point) => (point.entities?.length ?? 0) > 0))).toBe(
      true,
    );
  });

  it('refuses a value it does not build, one error for each at its place in the list', async () => {
    const viewer = mockBrowser('viewer');
    const codes = async (value: string): Promise<string[]> =>
      fieldCodes(await viewer.call('GET', `${FYNIX}/ai/prompts-summary?include=${value}`));
    expect(await codes('bogus')).toEqual(['include.0:literal_error']);
    expect(await codes('series,bogus')).toEqual(['include.1:literal_error']);
    expect(await codes('bogus,entities,week')).toEqual(['include.0:literal_error', 'include.2:literal_error']);
    const answer = await viewer.call('GET', `${FYNIX}/ai/prompts-summary?include=bogus`);
    expect(answer.status).toBe(422);
    expect(answer.body.errors).toEqual([
      {
        location: 'query',
        path: 'include.0',
        code: 'literal_error',
        message: "Input should be 'series' or 'entities'",
      },
    ]);
  });
});

describe('the weeks of the series in the project time zone', () => {
  /** Run now as a browser signed in at the clock's time: a session lasts ten minutes by the clock. */
  async function runNow(base: string, promptId: string, engine: string): Promise<void> {
    const answer = await mockBrowser('editor').call('POST', `${base}/prompts/${promptId}/run-now`, {
      engine_codes: [engine],
    });
    expect(answer.status).toBe(202);
    dataOf(answer, RUN);
  }
  const week = (summary: Summary, promptId: string, code: string, start: string): number | undefined => {
    const row = summary.prompts.find((prompt) => prompt.prompt_id === promptId);
    const engine = row?.engines.find((candidate) => candidate.engine_code === code);
    return engine === undefined
      ? undefined
      : seriesOf(engine).find((point) => point.week_start === start)?.mentioned.n_observations;
  };

  it('puts an answer in the week of its project day, not of its UTC day: Berlin one hour ahead', async () => {
    const before = await summaryOf(mockBrowser('viewer'), FYNIX, '?include=series');
    const promptId = before.prompts[2]?.prompt_id ?? '';
    // Sunday 22:30 UTC is Sunday 23:30 in Berlin: still the week of 9 November
    clock = Date.parse('2026-11-15T22:30:00Z');
    await runNow(FYNIX, promptId, 'chatgpt_web');
    // Sunday 23:30 UTC is Monday 00:30 in Berlin: the week of 16 November
    clock = Date.parse('2026-11-15T23:30:00Z');
    await runNow(FYNIX, promptId, 'gemini_web');
    clock = Date.parse('2026-11-16T12:00:00Z');
    const summary = await summaryOf(mockBrowser('viewer'), FYNIX, '?include=series&from=2026-11-15&to=2026-11-16');
    expect(summary.window).toEqual({ from: '2026-11-15', to: '2026-11-16', timezone: 'Europe/Berlin' });
    // The Monday run of the 16th is in the week of the 16th on both engines
    // A prompt point pools the week and the weeks before it: the week of the 16th holds the one of the 9th too
    expect(week(summary, promptId, 'chatgpt_web', '2026-11-09')).toBe(1);
    expect(week(summary, promptId, 'chatgpt_web', '2026-11-16')).toBe(2);
    expect(week(summary, promptId, 'gemini_web', '2026-11-09')).toBe(0);
    expect(week(summary, promptId, 'gemini_web', '2026-11-16')).toBe(2);
  });

  it('puts an answer in the week of its project day: Kolkata five and a half hours ahead', async () => {
    const before = await summaryOf(mockBrowser('viewer'), EVENTUS, '?include=series');
    const promptId = before.prompts[0]?.prompt_id ?? '';
    // Sunday 18:29 UTC is Sunday 23:59 in Kolkata, 18:30 UTC is Monday 00:00
    clock = Date.parse('2026-11-15T18:29:00Z');
    await runNow(EVENTUS, promptId, 'chatgpt_web');
    clock = Date.parse('2026-11-15T18:30:00Z');
    await runNow(EVENTUS, promptId, 'gemini_web');
    clock = Date.parse('2026-11-16T12:00:00Z');
    const summary = await summaryOf(mockBrowser('viewer'), EVENTUS, '?include=series&from=2026-11-15&to=2026-11-16');
    expect(summary.window).toEqual({ from: '2026-11-15', to: '2026-11-16', timezone: 'Asia/Kolkata' });
    expect(week(summary, promptId, 'chatgpt_web', '2026-11-09')).toBe(1);
    expect(week(summary, promptId, 'chatgpt_web', '2026-11-16')).toBe(2);
    expect(week(summary, promptId, 'gemini_web', '2026-11-09')).toBe(0);
    expect(week(summary, promptId, 'gemini_web', '2026-11-16')).toBe(2);
  });
});
