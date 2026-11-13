import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type { Schemas } from '@/lib/api/types';
import { dataOf, fieldCodes, mockBrowser } from '@/test/mock-api';

/**
 * The prompts summary with `include=total` and `include=co_mentions` (c2 C-4, C-8, C-15): the one-row total of every
 * prompt in scope, and the pair counts per engine. Read in the Fynix world and in the Eventus Security world.
 */

/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const WORLDS = [
  { name: 'Fynix', base: `${W}/projects/${fynix.project_id}/ai`, seeded: false },
  { name: 'Eventus Security', base: `${W}/projects/${eventus.project_id}/ai`, seeded: true },
] as const;

const CELL = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
  pooled: z.object({ successes: z.number(), trials: z.number() }).nullable(),
});
const ENGINE = z.object({
  engine_code: z.string(),
  mentioned: CELL,
  share_of_voice: CELL,
  series: z.array(z.object({ week_start: z.string() })).optional(),
  entities: z.array(z.object({ entity_id: z.string(), mentioned: CELL, share_of_voice: CELL })).optional(),
});
type Engine = z.infer<typeof ENGINE>;
const SUMMARY = z.object({
  engine_codes: z.array(z.string()),
  entities: z.array(z.object({ entity_id: z.string(), name: z.string(), role: z.string() })),
  prompts: z.array(z.object({ prompt_id: z.string(), engines: z.array(ENGINE) })),
  topics: z.array(z.object({ engines: z.array(ENGINE) })),
  total: z
    .object({
      prompt_count: z.number(),
      last_observed_at: z.string().nullable(),
      last_valid_at: z.string().nullable(),
      engines: z.array(ENGINE),
    })
    .optional(),
  co_mentions: z
    .array(
      z.object({
        engine_code: z.string(),
        answers: z.number(),
        pairs: z.array(z.object({ a: z.string(), b: z.string(), answers: z.number() })),
      }),
    )
    .optional(),
});
type Summary = z.infer<typeof SUMMARY>;

const summaryOf = async (base: string, query: string): Promise<Summary> => {
  const answer = await mockBrowser('viewer').call('GET', `${base}/prompts-summary?${WINDOW}${query}`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return dataOf(answer, SUMMARY);
};

const totalOf = (summary: Summary): NonNullable<Summary['total']> => {
  if (summary.total === undefined) throw new Error('The summary has no total');
  return summary.total;
};
const coMentionsOf = (summary: Summary): NonNullable<Summary['co_mentions']> => {
  if (summary.co_mentions === undefined) throw new Error('The summary has no co_mentions');
  return summary.co_mentions;
};
const engineOf = (engines: readonly Engine[], code: string): Engine => {
  const found = engines.find((engine) => engine.engine_code === code);
  if (found === undefined) throw new Error(`No engine ${code}`);
  return found;
};
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe.each(WORLDS)('prompts summary with include=total and include=co_mentions in $name', ({ base, seeded }) => {
  beforeEach(() => {
    setAiSeeded(seeded);
  });

  it('leaves total and co_mentions out unless they are asked for', async () => {
    const plain = await summaryOf(base, '');
    expect(plain).not.toHaveProperty('total');
    expect(plain).not.toHaveProperty('co_mentions');
    const entities = await summaryOf(base, '&include=entities');
    expect(entities).not.toHaveProperty('total');
    expect(entities).not.toHaveProperty('co_mentions');
  });

  it('the total of include=total equals a topic row over every prompt in scope for each engine', async () => {
    const summary = await summaryOf(base, '&include=total');
    const total = totalOf(summary);
    expect(total.prompt_count).toBe(summary.prompts.length);
    expect(total.engines.map((engine) => engine.engine_code)).toEqual(summary.engine_codes);
    for (const engine of total.engines) {
      const rows = summary.prompts.map((prompt) => engineOf(prompt.engines, engine.engine_code));
      const rated = rows.filter((row) => row.mentioned.denominator > 0);
      expect(engine.mentioned.denominator).toBe(rated.length);
      expect(engine.mentioned.numerator).toBeCloseTo(
        sum(rated.map((row) => row.mentioned.numerator / row.mentioned.denominator)),
        9,
      );
      expect(engine.mentioned.pooled).toEqual({
        successes: sum(rated.map((row) => row.mentioned.numerator)),
        trials: sum(rated.map((row) => row.mentioned.denominator)),
      });
      expect(engine.mentioned.n_observations).toBe(sum(rows.map((row) => row.mentioned.n_observations)));
      // Share of voice is one answer one weight
      expect(engine.share_of_voice.numerator).toBeCloseTo(sum(rows.map((row) => row.share_of_voice.numerator)), 9);
      expect(engine.share_of_voice.denominator).toBe(sum(rows.map((row) => row.share_of_voice.denominator)));
    }
    if (summary.prompts.length > 0) expect(total.last_observed_at).not.toBeNull();
  });

  it('total carries series and entities when they are asked with it', async () => {
    const asked = await summaryOf(base, '&include=total,series,entities&rows=none');
    const rows = await summaryOf(base, '&include=entities');
    const total = totalOf(asked);
    const expected = asked.entities.filter((entity) => entity.role === 'own').map((entity) => entity.entity_id);
    expected.push(...asked.entities.filter((entity) => entity.role !== 'own').map((entity) => entity.entity_id));
    for (const engine of total.engines) {
      expect(engine.series?.length ?? 0).toBeGreaterThan(0);
      expect(engine.entities?.map((cells) => cells.entity_id)).toEqual(expected);
      // A named answer of the total is a named answer of one of the prompts
      for (const cells of engine.entities ?? []) {
        const named = sum(
          rows.prompts.map(
            (prompt) =>
              engineOf(prompt.engines, engine.engine_code).entities?.find((own) => own.entity_id === cells.entity_id)
                ?.mentioned.numerator ?? 0,
          ),
        );
        expect(cells.mentioned.pooled?.successes).toBe(named);
      }
    }
    const bare = await summaryOf(base, '&include=total');
    for (const engine of totalOf(bare).engines) {
      expect(engine).not.toHaveProperty('series');
      expect(engine).not.toHaveProperty('entities');
    }
  });

  it('rows=none with include=total still answers the total and empty row lists', async () => {
    const all = await summaryOf(base, '&include=total');
    const none = await summaryOf(base, '&include=total&rows=none');
    expect(none.prompts).toEqual([]);
    expect(none.topics).toEqual([]);
    expect(totalOf(none)).toEqual(totalOf(all));
    expect(totalOf(none).engines.length).toBeGreaterThan(0);
    const topics = await summaryOf(base, '&include=total&rows=topics');
    expect(topics.prompts).toEqual([]);
    expect(totalOf(topics)).toEqual(totalOf(all));
  });

  it("co_mentions has one entry per engine shown with answers equal to the engine's valid answers", async () => {
    const summary = await summaryOf(base, '&include=co_mentions');
    const entries = coMentionsOf(summary);
    expect(entries.map((entry) => entry.engine_code)).toEqual(summary.engine_codes);
    for (const entry of entries) {
      const valid = sum(
        summary.prompts.map((prompt) => engineOf(prompt.engines, entry.engine_code).mentioned.denominator),
      );
      expect(entry.answers).toBe(valid);
    }
    const [first] = summary.engine_codes;
    if (first === undefined) throw new Error('The summary shows no engine');
    const only = await summaryOf(base, `&include=co_mentions&filter[engine_code_in]=${first}`);
    expect(coMentionsOf(only).map((entry) => entry.engine_code)).toEqual([first]);
    const none = await summaryOf(base, '&include=co_mentions&rows=none');
    expect(coMentionsOf(none)).toEqual(entries);
  });

  it('a pair is a below b by id, only pairs with one answer or more, sorted by answers then ids', async () => {
    const summary = await summaryOf(base, '&include=co_mentions');
    const tracked = new Set(summary.entities.map((entity) => entity.entity_id));
    let pairs = 0;
    for (const entry of coMentionsOf(summary)) {
      const keys = entry.pairs.map((pair) => `${pair.a} ${pair.b}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const pair of entry.pairs) {
        expect(pair.a < pair.b).toBe(true);
        expect(pair.answers).toBeGreaterThanOrEqual(1);
        expect(tracked.has(pair.a) && tracked.has(pair.b)).toBe(true);
      }
      const sorted = [...entry.pairs].sort(
        (x, y) => y.answers - x.answers || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || (x.b < y.b ? -1 : x.b > y.b ? 1 : 0),
      );
      expect(entry.pairs).toEqual(sorted);
      pairs += entry.pairs.length;
    }
    // The fixtures name several tracked brands in one answer, so the checks above are not empty
    expect(pairs).toBeGreaterThan(0);
  });

  it("a pair count never exceeds either entity's own answers", async () => {
    const summary = await summaryOf(base, '&include=co_mentions,entities,total&rows=none');
    const total = totalOf(summary);
    for (const entry of coMentionsOf(summary)) {
      const engine = engineOf(total.engines, entry.engine_code);
      const named = (id: string): number =>
        engine.entities?.find((cells) => cells.entity_id === id)?.mentioned.pooled?.successes ?? 0;
      for (const pair of entry.pairs) {
        expect(pair.answers).toBeLessThanOrEqual(Math.min(named(pair.a), named(pair.b)));
        expect(pair.answers).toBeLessThanOrEqual(entry.answers);
      }
    }
  });
});

describe('prompts summary with include=total: the generated shape and what is still refused', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cells and an unknown include value are still a literal_error', async () => {
    const viewer = mockBrowser('viewer');
    const base = `${W}/projects/${fynix.project_id}/ai`;
    const codes = async (value: string): Promise<string[]> =>
      fieldCodes(await viewer.call('GET', `${base}/prompts-summary?include=${value}`));
    expect(await codes('cells')).toEqual(['include.0:literal_error']);
    expect(await codes('total,cells')).toEqual(['include.1:literal_error']);
    expect(await codes('co_mentions,bogus,total')).toEqual(['include.1:literal_error']);
    expect(await codes('bogus,weeks')).toEqual(['include.0:literal_error', 'include.1:literal_error']);
    const answer = await viewer.call('GET', `${base}/prompts-summary?include=cells`);
    expect(answer.status).toBe(422);
    expect(answer.code).toBe('validation_failed');
  });

  it('the response keys equal the generated PromptsSummary keys', async () => {
    // Every key of the generated type, so that a key the schema adds or drops breaks this file at compile time
    const KEYS: Record<keyof Schemas['PromptsSummary'], 'always' | 'asked' | 'not built'> = {
      window: 'always',
      include_branded: 'always',
      branded_only: 'always',
      engine_codes: 'always',
      metric_context: 'always',
      entities: 'always',
      entity_config_versions: 'always',
      prompts: 'always',
      topics: 'always',
      total: 'asked',
      co_mentions: 'asked',
      by_country: 'not built',
      compare_window: 'not built',
      previous_answers: 'not built',
    };
    const named = (shape: 'always' | 'asked'): string[] =>
      Object.entries(KEYS)
        .filter(([, kind]) => kind === shape)
        .map(([key]) => key);
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${W}/projects/${fynix.project_id}/ai/prompts-summary?${WINDOW}&include=total,co_mentions`,
    );
    expect(Object.keys(z.record(z.string(), z.unknown()).parse(answer.body.data)).sort()).toEqual(
      [...named('always'), ...named('asked')].sort(),
    );
    const plain = await mockBrowser('viewer').call(
      'GET',
      `${W}/projects/${fynix.project_id}/ai/prompts-summary?${WINDOW}`,
    );
    expect(Object.keys(z.record(z.string(), z.unknown()).parse(plain.body.data)).sort()).toEqual(
      named('always').sort(),
    );
  });
});
