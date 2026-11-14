import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { competitorHandlers } from './competitors';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { SESSION_COOKIE } from '../session';
import type { Schemas } from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { fieldCodes, mockBrowser, type Answer, type MockBrowser } from '@/test/mock-api';

/**
 * Every body is read through a strict shape declared against the generated type: a member the mock leaves out or
 * adds fails the parse (`strictObject`), and a change to the schema breaks this file at compile time.
 */
const ENGINE = z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
const ROLE = z.enum(['own', 'competitor']);
const WINDOW: z.ZodType<Schemas['MetricWindow']> = z.strictObject({
  from: z.string(),
  timezone: z.string(),
  to: z.string(),
});
const POOLED = z.strictObject({ successes: z.number(), trials: z.number() });
const CELL: z.ZodType<Schemas['MetricCell']> = z.strictObject({
  denominator: z.number(),
  n_observations: z.number(),
  numerator: z.number(),
  pooled: POOLED.nullable().exactOptional(),
  value: z.number().nullable(),
});
const FILTERS: z.ZodType<Schemas['AiFilters']> = z.strictObject({
  branded_only: z.boolean(),
  country_iso: z.string().nullable(),
  include_branded: z.boolean(),
  term_id: z.string().nullable(),
});
const VALUE: z.ZodType<Schemas['AiMetricValue']> = z.strictObject({
  aggregation: z.enum(['observation_weighted', 'prompt_weighted']).nullable().exactOptional(),
  denominator: z.number().nullable(),
  engine_code: ENGINE.nullable().exactOptional(),
  entity_id: z.string().nullable().exactOptional(),
  filters: FILTERS,
  is_estimate: z.boolean(),
  method: z.string(),
  method_version: z.number(),
  metric: z.string(),
  n_observations: z.number(),
  n_prompts: z.number().nullable().exactOptional(),
  numerator: z.number().nullable(),
  observation_class: z.enum(['consumer_ui', 'official_api', 'serp_ai']).nullable().exactOptional(),
  pooled: POOLED.nullable().exactOptional(),
  previous: CELL.nullable().exactOptional(),
  suppressed_reason: z
    .enum(['insufficient_data', 'no_surface', 'not_classified', 'below_min_impressions'])
    .nullable()
    .exactOptional(),
  unit: z.enum(['ratio', 'count']),
  value: z.number().nullable(),
  window: WINDOW,
});
const REF: z.ZodType<Schemas['EntityRef']> = z.strictObject({
  canonical_name: z.string(),
  color_index: z.number().nullable(),
  entity_id: z.string(),
  entity_type: z.enum(['brand', 'product', 'organization', 'person', 'other']),
  role: z.enum(['own', 'competitor', 'watch']).nullable(),
});
const LOST: z.ZodType<Schemas['LostPrompt']> = z.strictObject({
  importance: z.number(),
  lost: CELL,
  prompt_id: z.string(),
  text: z.string(),
});
const SOURCE: z.ZodType<Schemas['CompetitorSource']> = z.strictObject({
  answers: z.number(),
  citation_units: z.number(),
  registrable_domain: z.string(),
});
const BY_ENGINE: z.ZodType<Schemas['AiCompetitorEngine']> = z.strictObject({
  citation_share: VALUE,
  engine_code: ENGINE,
  is_top_competitor: z.boolean(),
  lost_prompts: z.array(LOST).nullable().exactOptional(),
  lost_prompts_clear_total: z.number().nullable().exactOptional(),
  lost_prompts_total: z.number().nullable().exactOptional(),
  lost_prompts_with_min_answers: z.number().nullable().exactOptional(),
  mention_rate: VALUE,
  recommendation_rate: VALUE,
  share_of_voice: VALUE,
});
const META: z.ZodType<Schemas['AiMetricMeta']> = z.strictObject({
  branded_only: z.boolean(),
  compare_window: WINDOW.nullable().exactOptional(),
  engine_codes: z.array(ENGINE),
  entities: z.array(z.strictObject({ entity_id: z.string(), name: z.string(), role: ROLE })),
  entity_config_changes: z
    .array(z.strictObject({ from: z.string(), version: z.number() }))
    .nullable()
    .exactOptional(),
  entity_config_versions: z.array(z.number()),
  include_branded: z.boolean(),
  notes: z.array(z.string()),
  previous_answers: z.number().nullable().exactOptional(),
  window: WINDOW,
});
const COMPETITORS: z.ZodType<Schemas['AiCompetitorsResponse']> = z.strictObject({
  data: z.array(
    z.strictObject({
      by_engine: z.array(BY_ENGINE),
      entity: REF,
      top_sources: z.array(SOURCE).nullable().exactOptional(),
    }),
  ),
  meta: META,
});
const OVERVIEW: z.ZodType<Schemas['OverviewCompetitorsResponse']> = z.strictObject({
  data: z.strictObject({
    rows: z.array(
      z.strictObject({
        ai: z.array(z.strictObject({ engine_code: ENGINE, mention_rate: VALUE, share_of_voice: VALUE })),
        entity: REF,
      }),
    ),
  }),
  meta: META,
});
const POOL: z.ZodType<Schemas['PointPool']> = z.strictObject({
  below_prompts: z.number(),
  reason: z.enum(['prompt_point', 'few_prompts']),
  weeks: z.number(),
  window: WINDOW,
});
const POINT: z.ZodType<Schemas['AiMetricPoint']> = z.strictObject({
  denominator: z.number().nullable(),
  is_partial: z.boolean(),
  is_pooled: z.boolean(),
  n_observations: z.number(),
  n_prompts: z.number(),
  numerator: z.number().nullable(),
  pool: POOL.nullable().exactOptional(),
  pooled: POOLED.nullable().exactOptional(),
  t: z.string(),
  value: z.number().nullable(),
});
const SERIES: z.ZodType<Schemas['AiSeriesResponse']> = z.strictObject({
  data: z.array(
    z.strictObject({
      aggregation: z.enum(['observation_weighted', 'prompt_weighted']),
      engine_code: ENGINE,
      entity_id: z.string().nullable().exactOptional(),
      filters: FILTERS,
      granularity: z.literal('week'),
      is_estimate: z.boolean(),
      method: z.string(),
      method_version: z.number(),
      metric: z.string(),
      points: z.array(POINT),
      unit: z.enum(['ratio', 'count']),
      window: WINDOW,
    }),
  ),
  meta: META,
});
/** The summary's total row, as far as the figures here are compared with it. */
const SUMMARY = z.object({
  data: z.object({
    prompts: z.array(
      z.object({
        prompt_id: z.string(),
        engines: z.array(z.object({ engine_code: z.string(), mentioned: z.object({ denominator: z.number() }) })),
      }),
    ),
    total: z.object({
      engines: z.array(
        z.object({
          engine_code: z.string(),
          entities: z.array(z.object({ entity_id: z.string(), mentioned: CELL, share_of_voice: CELL })),
        }),
      ),
    }),
  }),
});

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
const cleanstart = MOCK_PROJECTS.find((project) => project.slug === 'cleanstart');
if (fynix === undefined || eventus === undefined || cleanstart === undefined) {
  throw new Error('The fixture projects are missing');
}
const FYNIX = `${W}/projects/${fynix.project_id}`;
const EVENTUS = `${W}/projects/${eventus.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
const PROJECTS = [
  { name: 'Fynix', base: FYNIX },
  { name: 'Eventus Security', base: EVENTUS },
] as const;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
/** The default window of 28 days ending on that day. */
const WINDOW_FROM = '2026-10-16';
const WINDOW_TO = '2026-11-12';
/** The day the seeded project's entity set changed (21 days before the project's today). */
const SEEDED_BOUNDARY = '2026-10-22';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const get = (path: string, role: 'owner' | 'viewer' | 'analyst' | 'billing' = 'viewer'): Promise<Answer> =>
  mockBrowser(role).call('GET', path);
async function competitors(base: string, query = '', who: MockBrowser = mockBrowser('viewer')) {
  const answer = await who.call('GET', `${base}/ai/competitors${query}`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return COMPETITORS.parse(answer.body);
}
async function summary(base: string, query = '') {
  const answer = await get(`${base}/ai/prompts-summary?include=total,entities${query}`);
  expect(answer.status).toBe(200);
  return SUMMARY.parse(answer.body).data;
}
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe('ai/competitors rows', () => {
  it('lists the own entities first, then the competitors by name, at most 20, with the engines sorted by code', async () => {
    for (const { name, base } of PROJECTS) {
      const body = await competitors(base);
      const roles = body.data.map((row) => row.entity.role);
      expect(roles[0], name).toBe('own');
      const firstCompetitor = roles.indexOf('competitor');
      expect(
        roles.slice(0, firstCompetitor).every((role) => role === 'own'),
        name,
      ).toBe(true);
      expect(
        roles.slice(firstCompetitor).every((role) => role === 'competitor'),
        name,
      ).toBe(true);
      const names = body.data.slice(firstCompetitor).map((row) => row.entity.canonical_name);
      expect(names, name).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(body.data.length, name).toBeLessThanOrEqual(20);
      expect(body.data.length, name).toBe(body.meta.entities.length);
      expect(new Set(body.data.map((row) => row.entity.entity_id)), name).toEqual(
        new Set(body.meta.entities.map((entity) => entity.entity_id)),
      );
      for (const row of body.data) {
        const codes = row.by_engine.map((engine) => engine.engine_code);
        expect(codes, name).toEqual([...codes].sort());
        expect(codes, name).toEqual(body.meta.engine_codes);
      }
    }
  });

  it('gives Fynix its own brand and five competitors with a colour each, the own brand being colour 1', async () => {
    const body = await competitors(FYNIX);
    expect(body.data.map((row) => [row.entity.canonical_name, row.entity.role, row.entity.color_index])).toEqual([
      ['Fynix', 'own', 1],
      ['Brightwave Digital', 'competitor', 2],
      ['Clickvantage', 'competitor', 5],
      ['Meridian Growth', 'competitor', 6],
      ['Northlight SEO', 'competitor', 4],
      ['Rankforge', 'competitor', 3],
    ]);
  });

  it('is an empty tracked set with no answers for a project with every engine off, never an error', async () => {
    const body = await competitors(CLEANSTART);
    expect(body.meta.engine_codes).toEqual([]);
    expect(body.meta.entity_config_versions).toEqual([]);
    for (const row of body.data) expect(row.by_engine).toEqual([]);
  });

  it('equals the summary total cells value for value, in several scopes', async () => {
    const scopes = [
      '',
      '?filter[engine_code_in]=chatgpt_web',
      '?include_branded=true&from=2026-10-01&to=2026-11-05',
      '?branded_only=true',
    ];
    for (const { name, base } of PROJECTS) {
      for (const query of scopes) {
        const total = (await summary(base, query.replace('?', '&'))).total;
        const body = await competitors(base, query);
        expect(body.data.length, `${name} ${query}`).toBeGreaterThan(0);
        for (const row of body.data) {
          for (const engine of row.by_engine) {
            const cells = total.engines
              .find((candidate) => candidate.engine_code === engine.engine_code)
              ?.entities.find((candidate) => candidate.entity_id === row.entity.entity_id);
            expect(cells, `${name} ${query} ${engine.engine_code}`).toBeDefined();
            if (cells === undefined) continue;
            expect(engine.mention_rate).toMatchObject({
              value: cells.mentioned.value,
              numerator: cells.mentioned.numerator,
              denominator: cells.mentioned.denominator,
              n_observations: cells.mentioned.n_observations,
              n_prompts: cells.mentioned.denominator,
              pooled: cells.mentioned.pooled,
              entity_id: row.entity.entity_id,
              engine_code: engine.engine_code,
            });
            expect(engine.share_of_voice).toMatchObject({
              value: cells.share_of_voice.value,
              numerator: cells.share_of_voice.numerator,
              denominator: cells.share_of_voice.denominator,
              n_observations: cells.share_of_voice.n_observations,
            });
            expect(engine.share_of_voice).not.toHaveProperty('pooled');
          }
        }
      }
    }
  });

  it('adds the share of voice numerators of the tracked set up to the denominator of an engine with answers', async () => {
    for (const { name, base } of PROJECTS) {
      const body = await competitors(base);
      for (const code of body.meta.engine_codes) {
        const cells = body.data.map((row) => row.by_engine.find((engine) => engine.engine_code === code));
        const denominator = cells[0]?.share_of_voice.denominator ?? 0;
        expect(denominator, `${name} ${code}`).toBeGreaterThan(0);
        expect(sum(cells.map((cell) => cell?.share_of_voice.numerator ?? 0)), `${name} ${code}`).toBeCloseTo(
          denominator,
          6,
        );
        for (const cell of cells) expect(cell?.share_of_voice.denominator).toBe(denominator);
      }
    }
  });

  it('suppresses the recommendation rate as not_classified for every entity, with no value or counts', async () => {
    const body = await competitors(FYNIX);
    for (const row of body.data) {
      for (const engine of row.by_engine) {
        expect(engine.recommendation_rate).toMatchObject({
          metric: 'ai.recommendation_rate',
          value: null,
          numerator: null,
          denominator: null,
          suppressed_reason: 'not_classified',
        });
      }
    }
  });

  it('has a citation share of the entity units over the engine units, and the own brand citing most of its own domain', async () => {
    for (const { name, base } of PROJECTS) {
      const body = await competitors(base);
      for (const code of body.meta.engine_codes) {
        const shares = body.data.flatMap((row) => row.by_engine.filter((engine) => engine.engine_code === code));
        const denominators = new Set(shares.map((engine) => engine.citation_share.denominator));
        expect(denominators.size, `${name} ${code}`).toBe(1);
        const units = [...denominators][0] ?? 0;
        for (const engine of shares) {
          const share = engine.citation_share;
          expect(share.numerator ?? 0, name).toBeLessThanOrEqual(units);
          expect(share.value, name).toBe(units === 0 ? null : (share.numerator ?? 0) / units);
        }
        expect(
          sum(shares.map((engine) => engine.citation_share.numerator ?? 0)),
          `${name} ${code}`,
        ).toBeLessThanOrEqual(units);
      }
    }
  });
});

describe('ai/competitors top competitor', () => {
  it('is true for at most one competitor per engine, the one with the most share of voice, and never for the own brand', async () => {
    for (const { name, base } of PROJECTS) {
      const body = await competitors(base);
      for (const code of body.meta.engine_codes) {
        const flagged = body.data.filter(
          (row) => row.by_engine.find((engine) => engine.engine_code === code)?.is_top_competitor,
        );
        expect(flagged.length, `${name} ${code}`).toBeLessThanOrEqual(1);
        const [top] = flagged;
        if (top === undefined) continue;
        expect(top.entity.role).toBe('competitor');
        const mine = top.by_engine.find((engine) => engine.engine_code === code)?.share_of_voice.numerator ?? 0;
        expect(mine).toBeGreaterThan(0);
        for (const row of body.data.filter((candidate) => candidate.entity.role === 'competitor')) {
          const theirs = row.by_engine.find((engine) => engine.engine_code === code)?.share_of_voice.numerator ?? 0;
          expect(theirs, `${name} ${code}`).toBeLessThanOrEqual(mine);
        }
      }
    }
  });

  it('is on a row of every engine of Fynix, where competitors are named', async () => {
    const body = await competitors(FYNIX);
    expect(body.meta.engine_codes.length).toBeGreaterThan(0);
    for (const code of body.meta.engine_codes) {
      expect(
        body.data.filter((row) => row.by_engine.find((engine) => engine.engine_code === code)?.is_top_competitor),
      ).toHaveLength(1);
    }
  });

  it('is on no row when nobody was named', async () => {
    // No prompt of that market: every count is 0
    const body = await competitors(FYNIX, '?filter[country_iso]=ZZ');
    expect(body.meta.engine_codes.length).toBeGreaterThan(0);
    for (const row of body.data) {
      for (const engine of row.by_engine) {
        expect(engine.is_top_competitor).toBe(false);
        expect(engine.share_of_voice).toMatchObject({ value: null, numerator: 0, denominator: 0 });
        expect(engine.mention_rate.value).toBeNull();
      }
    }
  });
});

describe('ai/competitors entity_ids', () => {
  it('narrows the rows, leaves out an id that is not tracked with 200, and reads the top flag before narrowing', async () => {
    const full = await competitors(FYNIX);
    const competitorRows = full.data.filter((row) => row.entity.role === 'competitor');
    const flagged = (code: string) =>
      full.data.find((row) => row.by_engine.find((engine) => engine.engine_code === code)?.is_top_competitor);
    const [code] = full.meta.engine_codes;
    const top = code === undefined ? undefined : flagged(code);
    expect(top).toBeDefined();
    const other = competitorRows.find((row) => row.entity.entity_id !== top?.entity.entity_id);
    if (other === undefined || top === undefined || code === undefined) throw new Error('Fynix has no two competitors');
    const topOnly = await competitors(FYNIX, `?entity_ids=${top.entity.entity_id}`);
    expect(topOnly.data.map((row) => row.entity.entity_id)).toEqual([top.entity.entity_id]);
    expect(topOnly.data[0]?.by_engine.find((engine) => engine.engine_code === code)?.is_top_competitor).toBe(true);
    // The top competitor is narrowed away: no row carries the flag
    const otherOnly = await competitors(
      FYNIX,
      `?entity_ids=${other.entity.entity_id},00000000-0000-4000-8000-000000000000`,
    );
    expect(otherOnly.data.map((row) => row.entity.entity_id)).toEqual([other.entity.entity_id]);
    expect(otherOnly.data[0]?.by_engine.every((engine) => !engine.is_top_competitor)).toBe(true);
    // Narrowing leaves the meta whole
    expect(otherOnly.meta.entities).toEqual(full.meta.entities);
    // Nothing tracked listed: no rows; an empty list is no narrowing
    expect((await competitors(FYNIX, '?entity_ids=00000000-0000-4000-8000-000000000000')).data).toEqual([]);
    expect((await competitors(FYNIX, '?entity_ids=')).data).toHaveLength(full.data.length);
  });

  it('is 422 over 20 ids and for a value that is not a UUID', async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?entity_ids=${ids.join(',')}`))).toEqual([
      'entity_ids:too_long',
    ]);
    expect((await get(`${FYNIX}/ai/competitors?entity_ids=${ids.slice(0, 20).join(',')}`)).status).toBe(200);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?entity_ids=nope`))).toEqual(['entity_ids.0:uuid_parsing']);
  });
});

describe('ai/competitors compare', () => {
  it('adds previous to mention_rate and share_of_voice and compare_window and previous_answers to meta', async () => {
    for (const { name, base } of PROJECTS) {
      const body = await competitors(base, '?compare=previous_period');
      expect(body.meta.compare_window, name).toEqual({
        from: '2026-09-18',
        timezone: expect.any(String),
        to: '2026-10-15',
      });
      expect(body.meta.previous_answers, name).toBeGreaterThan(0);
      for (const row of body.data) {
        for (const engine of row.by_engine) {
          expect(engine.mention_rate.previous, name).toBeDefined();
          expect(engine.share_of_voice.previous, name).toBeDefined();
          expect(engine.citation_share).not.toHaveProperty('previous');
          expect(engine.recommendation_rate).not.toHaveProperty('previous');
        }
      }
    }
  });

  it('carries previous from the summary entity cells, and none without compare', async () => {
    const before = (await summary(FYNIX, '&compare=previous_period')).total;
    const body = await competitors(FYNIX, '?compare=previous_period');
    const row = body.data[0];
    const engine = row?.by_engine[0];
    const cells = before.engines
      .find((candidate) => candidate.engine_code === engine?.engine_code)
      ?.entities.find((candidate) => candidate.entity_id === row?.entity.entity_id);
    expect(cells).toBeDefined();
    expect(engine?.mention_rate.previous).not.toBeUndefined();
    const plain = await competitors(FYNIX);
    expect(plain.meta).not.toHaveProperty('compare_window');
    expect(plain.meta).not.toHaveProperty('previous_answers');
    for (const each of plain.data.flatMap((entry) => entry.by_engine)) {
      expect(each.mention_rate).not.toHaveProperty('previous');
      expect(each.share_of_voice).not.toHaveProperty('previous');
    }
  });
});

describe('ai/competitors lost prompts', () => {
  it('is absent unless asked for, and gives competitor rows only the four members', async () => {
    const plain = await competitors(FYNIX);
    for (const engine of plain.data.flatMap((row) => row.by_engine)) {
      expect(engine).not.toHaveProperty('lost_prompts');
      expect(engine).not.toHaveProperty('lost_prompts_total');
    }
    const body = await competitors(FYNIX, '?include=lost_prompts');
    for (const row of body.data) {
      for (const engine of row.by_engine) {
        if (row.entity.role === 'own') {
          expect(engine).not.toHaveProperty('lost_prompts');
          expect(engine).not.toHaveProperty('lost_prompts_clear_total');
        } else {
          expect(engine.lost_prompts).toBeDefined();
          expect(engine.lost_prompts_total).toBeDefined();
          expect(engine.lost_prompts_with_min_answers).toBeDefined();
          expect(engine.lost_prompts_clear_total).toBeDefined();
        }
      }
    }
  });

  it('keeps clear within the judged prompts and the total at or above clear, sorts the rows and cuts them at lost_limit', async () => {
    for (const { name, base } of PROJECTS) {
      const body = await competitors(base, '?include=lost_prompts&lost_limit=3');
      let listed = 0;
      for (const row of body.data.filter((entry) => entry.entity.role === 'competitor')) {
        for (const engine of row.by_engine) {
          const rows = engine.lost_prompts ?? [];
          expect(rows.length, name).toBeLessThanOrEqual(3);
          expect(engine.lost_prompts_clear_total ?? 0, name).toBeLessThanOrEqual(
            engine.lost_prompts_with_min_answers ?? 0,
          );
          expect(engine.lost_prompts_clear_total ?? 0, name).toBeLessThanOrEqual(engine.lost_prompts_total ?? 0);
          expect(engine.lost_prompts_total ?? 0, name).toBeGreaterThanOrEqual(rows.length);
          listed += rows.length;
          // Importance, then lost answers, most first; then the text and the id
          const order = (lost: Schemas['LostPrompt']): string =>
            [9 - lost.importance, 999 - lost.lost.numerator, lost.text, lost.prompt_id].join('|');
          expect(rows.map(order), name).toEqual(rows.map(order).sort());
          for (const lost of rows) {
            expect(lost.importance).toBeGreaterThanOrEqual(1);
            expect(lost.importance).toBeLessThanOrEqual(5);
            expect(lost.lost.numerator).toBeGreaterThan(0);
            expect(lost.lost.numerator).toBeLessThanOrEqual(lost.lost.denominator);
            expect(lost.lost.n_observations).toBeGreaterThanOrEqual(lost.lost.denominator);
            expect(lost.lost.value).toBe(lost.lost.numerator / lost.lost.denominator);
          }
        }
      }
      expect(listed, name).toBeGreaterThan(0);
    }
  });

  it('has a denominator that equals the valid answers the summary counts for the prompt on the engine', async () => {
    const valid = new Map<string, number>();
    const rows = (await summary(FYNIX)).prompts;
    for (const prompt of rows) {
      for (const engine of prompt.engines)
        valid.set(`${prompt.prompt_id} ${engine.engine_code}`, engine.mentioned.denominator);
    }
    const body = await competitors(FYNIX, '?include=lost_prompts');
    let checked = 0;
    for (const engine of body.data.flatMap((row) => row.by_engine)) {
      for (const lost of engine.lost_prompts ?? []) {
        expect(lost.lost.denominator).toBe(valid.get(`${lost.prompt_id} ${engine.engine_code}`));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('ai/competitors top sources', () => {
  it('is absent unless asked for, and gives every row at most sources_limit domains by citation units', async () => {
    for (const { name, base } of PROJECTS) {
      for (const row of (await competitors(base)).data) expect(row).not.toHaveProperty('top_sources');
      const body = await competitors(base, '?include=top_sources&sources_limit=2');
      expect(
        body.data.every((row) => row.top_sources !== undefined && row.top_sources !== null),
        name,
      ).toBe(true);
      for (const row of body.data) {
        const sources = row.top_sources ?? [];
        expect(sources.length, name).toBeLessThanOrEqual(2);
        for (let place = 1; place < sources.length; place += 1) {
          expect(sources[place - 1]?.citation_units ?? 0, name).toBeGreaterThanOrEqual(
            sources[place]?.citation_units ?? 0,
          );
        }
      }
      expect(
        body.data.some((row) => (row.top_sources ?? []).length > 0),
        name,
      ).toBe(true);
      const own = body.data.find((row) => row.entity.role === 'own');
      expect(own?.top_sources, name).toBeDefined();
    }
  });
});

describe('ai/competitors validation', () => {
  it('is 422 for lost_limit 0 and 11, sources_limit 0 and 6, include=bogus, an engine outside the three, and an unknown parameter', async () => {
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?lost_limit=0`))).toEqual(['lost_limit:greater_than_equal']);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?lost_limit=11`))).toEqual(['lost_limit:less_than_equal']);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?lost_limit=x`))).toEqual(['lost_limit:int_parsing']);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?sources_limit=0`))).toEqual([
      'sources_limit:greater_than_equal',
    ]);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?sources_limit=6`))).toEqual(['sources_limit:less_than_equal']);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?include=bogus`))).toEqual(['include.0:literal_error']);
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?filter[engine_code_in]=bing`))).toEqual([
      'filter[engine_code_in].0:enum',
    ]);
    const unknown = await get(`${FYNIX}/ai/competitors?bogus=1`);
    expect(unknown.status).toBe(422);
    expect(fieldCodes(unknown)).toEqual(['bogus:extra_forbidden']);
    expect((await get(`${FYNIX}/ai/competitors?lost_limit=10&sources_limit=5`)).status).toBe(200);
  });

  it('is 422 for from after to and for a window over 92 days, as the summary is', async () => {
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?from=2026-11-12&to=2026-11-01`))).toEqual([
      'from:range_invalid',
    ]);
    const wide = await get(`${FYNIX}/ai/competitors?from=2026-08-01&to=2026-11-12`);
    expect(wide.status).toBe(422);
    expect(wide.code).toBe('window_too_large');
  });

  it('is 422 for more than three engines', async () => {
    const four = 'chatgpt_web,gemini_web,google_ai_mode,chatgpt_web';
    expect(fieldCodes(await get(`${FYNIX}/ai/competitors?filter[engine_code_in]=${four}`))).toEqual([
      'filter[engine_code_in]:too_long',
    ]);
  });

  it('is 401 without a session, 404 for a project outside the member scope and 403 without data:read, ahead of a bad value', async () => {
    // Jonas (analyst) is limited to Fynix and Cleanstart
    expect((await get(`${EVENTUS}/ai/competitors`, 'analyst')).status).toBe(404);
    expect((await get(`${FYNIX}/ai/competitors`, 'billing')).status).toBe(403);
    expect((await get(`${EVENTUS}/ai/competitors?lost_limit=0`, 'analyst')).status).toBe(404);
    expect((await get(`${FYNIX}/ai/competitors?lost_limit=0`, 'billing')).status).toBe(403);
    expect((await fetch(`${TEST_API_ORIGIN}${FYNIX}/ai/competitors`)).status).toBe(401);
    expect((await get(`${W}/projects/0192d1a8-0000-7000-8000-000000000000/ai/competitors`)).status).toBe(404);
    for (const route of ['overview/competitors', 'ai/metrics/ai.share_of_voice/series']) {
      expect((await get(`${EVENTUS}/${route}`, 'analyst')).status, route).toBe(404);
      expect((await get(`${FYNIX}/${route}`, 'billing')).status, route).toBe(403);
      expect((await fetch(`${TEST_API_ORIGIN}${FYNIX}/${route}`)).status, route).toBe(401);
    }
  });
});

describe('the entity configuration of ai/competitors', () => {
  it('lists the seeded boundary with its project day, and version 1 starting before the window', async () => {
    for (const { name, base } of PROJECTS) {
      const { meta } = await competitors(base);
      expect(meta.entity_config_versions, name).toEqual([1, 2]);
      expect(meta.entity_config_changes, name).toEqual([
        { version: 1, from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
        { version: 2, from: SEEDED_BOUNDARY },
      ]);
      expect((meta.entity_config_changes?.[0]?.from ?? WINDOW_TO) < WINDOW_FROM, name).toBe(true);
    }
  });

  it('is one version, and no changes member, when the window holds no boundary', async () => {
    // Before the boundary: version 1 alone. After it: version 1 ended before the window, so version 2 alone
    for (const [query, versions] of [
      ['?from=2026-10-01&to=2026-10-20', [1]],
      ['?from=2026-10-23&to=2026-11-12', [2]],
    ] as const) {
      const { meta } = await competitors(FYNIX, query);
      expect(meta.entity_config_versions, query).toEqual(versions);
      expect(meta, query).not.toHaveProperty('entity_config_changes');
    }
  });

  it('marks the day a competitor was added in this browser', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: 'Zoho' });
    expect(created.status).toBe(201);
    const entityId = z.object({ data: z.object({ entity_id: z.string() }) }).parse(created.body).data.entity_id;
    expect((await editor.call('POST', `${FYNIX}/entities`, { entity_id: entityId, role: 'competitor' })).status).toBe(
      201,
    );
    const { data, meta } = await competitors(FYNIX, '', editor);
    expect(data.map((row) => row.entity.canonical_name)).toContain('Zoho');
    expect(meta.entity_config_changes?.map((change) => change.from)).toEqual([
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      SEEDED_BOUNDARY,
      WINDOW_TO,
    ]);
    expect(meta.entity_config_versions).toEqual([1, 2, 3]);
  });
});

describe('overview/competitors', () => {
  it('has the rows of ai/competitors with the same values, and no seo member', async () => {
    for (const { name, base } of PROJECTS) {
      for (const query of ['', '?compare=previous_period&filter[engine_code_in]=chatgpt_web']) {
        const full = await competitors(base, query);
        const answer = await get(`${base}/overview/competitors${query}`);
        expect(answer.status, name).toBe(200);
        const overview = OVERVIEW.parse(answer.body);
        expect(overview.data).not.toHaveProperty('seo_other_domains');
        expect(overview.meta, name).toEqual(full.meta);
        expect(
          overview.data.rows.map((row) => row.entity),
          name,
        ).toEqual(full.data.map((row) => row.entity));
        for (const [place, row] of overview.data.rows.entries()) {
          expect(row).not.toHaveProperty('seo');
          const expected = full.data[place]?.by_engine ?? [];
          expect(row.ai.map((engine) => engine.engine_code)).toEqual(expected.map((engine) => engine.engine_code));
          for (const [index, engine] of row.ai.entries()) {
            expect(engine.mention_rate, name).toEqual(expected[index]?.mention_rate);
            expect(engine.share_of_voice, name).toEqual(expected[index]?.share_of_voice);
          }
        }
      }
    }
  });

  it('is 422 for a parameter only ai/competitors takes', async () => {
    for (const query of ['entity_ids=', 'include=lost_prompts', 'lost_limit=3', 'sources_limit=3']) {
      expect(fieldCodes(await get(`${FYNIX}/overview/competitors?${query}`)).map((code) => code.split(':')[1])).toEqual(
        ['extra_forbidden'],
      );
    }
  });
});

describe('the series route', () => {
  const ids = async (base: string, count = 3): Promise<string[]> =>
    (await competitors(base)).data.slice(0, count).map((row) => row.entity.entity_id);
  const series = async (base: string, metric: string, query: string) => {
    const answer = await get(`${base}/ai/metrics/${metric}/series${query}`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return SERIES.parse(answer.body);
  };

  it('has one series per engine and listed entity, weekly points oldest first on Mondays, own entity first', async () => {
    for (const { name, base } of PROJECTS) {
      const listed = await ids(base);
      const body = await series(base, 'ai.share_of_voice', `?entity_ids=${[...listed].reverse().join(',')}`);
      expect(body.data.length, name).toBe(body.meta.engine_codes.length * listed.length);
      const order = body.data.map((entry) => `${entry.engine_code} ${entry.entity_id ?? ''}`);
      expect(order, name).toEqual(body.meta.engine_codes.flatMap((code) => listed.map((id) => `${code} ${id}`)));
      for (const entry of body.data) {
        expect(entry).toMatchObject({
          metric: 'ai.share_of_voice',
          unit: 'ratio',
          aggregation: 'observation_weighted',
        });
        const weeks = entry.points.map((point) => point.t);
        expect(weeks, name).toEqual([...weeks].sort());
        expect(
          weeks.every((week) => new Date(`${week}T00:00:00Z`).getUTCDay() === 1),
          name,
        ).toBe(true);
        expect(weeks[0], name).toBe('2026-10-12');
        expect(weeks.at(-1), name).toBe('2026-11-09');
      }
    }
  });

  it('gives share of voice points no pooled and a denominator of the answers naming a tracked brand', async () => {
    const { data, meta } = await series(FYNIX, 'ai.share_of_voice', `?entity_ids=${(await ids(FYNIX)).join(',')}`);
    const rows = (await summary(FYNIX)).total.engines;
    for (const entry of data) {
      for (const point of entry.points) {
        expect(point).not.toHaveProperty('pooled');
        expect(point.denominator).not.toBeNull();
      }
      // The last point pools the weeks of the window's tail: its cells are the summary's own
      const last = entry.points.at(-1);
      const cells = rows
        .find((engine) => engine.engine_code === entry.engine_code)
        ?.entities.find((candidate) => candidate.entity_id === entry.entity_id);
      expect(last?.denominator).toBeGreaterThan(0);
      expect(cells?.share_of_voice.denominator).toBeGreaterThan(0);
    }
    expect(meta.entity_config_versions).toEqual([1, 2]);
  });

  it('gives mention rate points their pooled answers', async () => {
    const { data } = await series(FYNIX, 'ai.mention_rate', `?entity_ids=${(await ids(FYNIX, 1)).join(',')}`);
    expect(data.length).toBeGreaterThan(0);
    for (const entry of data) {
      expect(entry.aggregation).toBe('prompt_weighted');
      expect(entry.points.some((point) => point.pooled !== undefined && point.pooled !== null)).toBe(true);
    }
  });

  it('marks a pooled point with is_pooled and a pool of weeks, window, reason and below_prompts, and the cut weeks as partial', async () => {
    const listed = `entity_ids=${(await ids(FYNIX, 1)).join(',')}`;
    // Fynix has 23 prompts out of branded ones: the weeks that 10 prompts answered are plain, the first week (no run
    // in the window yet) pools, and it has no value, never 0
    const wide = await series(FYNIX, 'ai.share_of_voice', `?${listed}`);
    for (const entry of wide.data) {
      const [first, ...rest] = entry.points;
      expect(first).toMatchObject({ t: '2026-10-12', is_partial: true, is_pooled: true, value: null, denominator: 0 });
      expect(first?.pool).toEqual({
        weeks: 1,
        reason: 'few_prompts',
        below_prompts: 10,
        window: { from: WINDOW_FROM, to: '2026-10-18', timezone: 'Europe/Berlin' },
      });
      expect(rest.every((point) => !point.is_pooled && point.pool === undefined)).toBe(true);
      // The last week holds today (Thursday 12 November) and is cut by the window's end
      expect(rest.at(-1)?.is_partial).toBe(true);
      expect(rest.slice(0, -1).every((point) => !point.is_partial)).toBe(true);
    }
    // One prompt in India: every point pools, the trailing weeks together and never outside the window
    const narrow = await series(FYNIX, 'ai.share_of_voice', `?${listed}&filter[country_iso]=IN`);
    for (const entry of narrow.data) {
      expect(entry.points.every((point) => point.is_pooled && point.pool !== undefined && point.pool !== null)).toBe(
        true,
      );
      expect(entry.points.map((point) => point.pool?.weeks)).toEqual([1, 2, 3, 4, 4]);
      for (const point of entry.points) {
        expect(point.pool).toMatchObject({ reason: 'few_prompts', below_prompts: 10 });
        expect((point.pool?.window.from ?? '') >= WINDOW_FROM).toBe(true);
        expect((point.pool?.window.to ?? '9') <= WINDOW_TO).toBe(true);
      }
    }
  });

  it('narrows the engines and the scope as the summary does', async () => {
    const body = await series(
      FYNIX,
      'ai.share_of_voice',
      `?entity_ids=${(await ids(FYNIX, 1)).join(',')}&filter[engine_code_in]=gemini_web`,
    );
    expect(body.data.map((entry) => entry.engine_code)).toEqual(['gemini_web']);
    expect(body.meta.engine_codes).toEqual(['gemini_web']);
  });

  it('answers nothing without entity_ids, or for another metric, so the next handler answers', async () => {
    const next = http.get('*', () => HttpResponse.json({ next: true }));
    const cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(NOW + 600_000)}`;
    const ask = async (path: string): Promise<unknown> => {
      const response = await getResponse(
        [...competitorHandlers, next],
        new Request(`${TEST_API_ORIGIN}${path}`, { headers: { cookie } }),
      );
      return response?.json();
    };
    expect(await ask(`${FYNIX}/ai/metrics/ai.share_of_voice/series`)).toEqual({ next: true });
    expect(await ask(`${FYNIX}/ai/metrics/ai.share_of_voice/series?entity_ids=`)).toEqual({ next: true });
    expect(await ask(`${FYNIX}/ai/metrics/ai.citation_rate/series`)).toEqual({ next: true });
    expect(await ask(`${FYNIX}/ai/metrics/ai.mention_rate/series?from=2026-10-01`)).toEqual({ next: true });
  });

  it('is 422 for entity_ids on a key that does not take them, over 20 ids, and a granularity that is not built', async () => {
    const id = (await ids(FYNIX, 1)).join(',');
    expect(fieldCodes(await get(`${FYNIX}/ai/metrics/ai.citation_rate/series?entity_ids=${id}`))).toEqual([
      'entity_ids:not_supported',
    ]);
    const many = Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    expect(fieldCodes(await get(`${FYNIX}/ai/metrics/ai.share_of_voice/series?entity_ids=${many.join(',')}`))).toEqual([
      'entity_ids:too_long',
    ]);
    expect(
      fieldCodes(await get(`${FYNIX}/ai/metrics/ai.share_of_voice/series?entity_ids=${id}&granularity=day`)),
    ).toEqual(['granularity:not_built']);
    expect(fieldCodes(await get(`${FYNIX}/ai/metrics/ai.share_of_voice/series?entity_ids=${id}&bogus=1`))).toEqual([
      'bogus:extra_forbidden',
    ]);
  });

  it('leaves out an id that is not tracked with 200', async () => {
    const body = await series(FYNIX, 'ai.share_of_voice', '?entity_ids=00000000-0000-4000-8000-000000000000');
    expect(body.data).toEqual([]);
  });
});
