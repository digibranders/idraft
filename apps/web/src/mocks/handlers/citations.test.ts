import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { deliveredOf } from './prompt-answers';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { promptsOf } from '../prompts-state';
import type { Schemas } from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

/**
 * The answers are read through strict shapes declared against the generated types: a change to the schema breaks
 * this file at compile time, and a member the mock leaves out or adds that the schema does not have fails the
 * parse (`strictObject`). The optional blocks are `exactOptional`: they may be left out and nothing else may be
 * missing.
 */
const ENGINE = z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
const ROLE = z.enum(['own', 'competitor', 'third_party']);
const WINDOW: z.ZodType<Schemas['MetricWindow']> = z.strictObject({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
});
const CELL: z.ZodType<Schemas['MetricCell']> = z.strictObject({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
  pooled: z.null().exactOptional(),
});
const ENGINE_UNITS: z.ZodType<Schemas['EngineUnits']> = z.strictObject({
  engine_code: ENGINE,
  citation_units: z.number(),
});
const PREVIOUS: z.ZodType<Schemas['PreviousUnits']> = z.strictObject({
  citation_units: z.number(),
  observations: z.number(),
});
const WEEK_UNITS: z.ZodType<Schemas['SourceWeekUnits']> = z.strictObject({
  week_start: z.string(),
  citation_units: z.number(),
  observations: z.number(),
});
const CITED_WITH: z.ZodType<Schemas['CitedWith']> = z.strictObject({
  entity_id: z.string(),
  observations: z.number(),
});
const ROLE_ANSWERS: z.ZodType<Schemas['RoleAnswers']> = z.strictObject({
  citation_units: z.number(),
  answers_citing: z.number(),
});
const ENGINE_ROLE_UNITS: z.ZodType<Schemas['EngineRoleUnits']> = z.strictObject({
  engine_code: ENGINE,
  own: ROLE_ANSWERS,
  competitor: ROLE_ANSWERS,
  third_party: ROLE_ANSWERS,
});
const SOURCES_META: z.ZodType<Schemas['SourcesMeta']> = z.strictObject({
  window: WINDOW,
  include_branded: z.boolean(),
  engine_codes: z.array(ENGINE),
  answers: z.number(),
  answers_citing: z.number(),
  citation_units: z.number(),
  by_role: z.array(z.strictObject({ domain_role: ROLE, citation_units: z.number(), observations: z.number() })),
  by_role_by_engine: z.array(ENGINE_ROLE_UNITS).nullable().exactOptional(),
  series: z
    .array(
      z.strictObject({
        week_start: z.string(),
        answers: z.number(),
        citation_units: z.number(),
        distinct_domains: z.number(),
      }),
    )
    .nullable()
    .exactOptional(),
  compare_window: WINDOW.nullable().exactOptional(),
  previous_answers: z.number().nullable().exactOptional(),
});
const OFFSET_PAGE: z.ZodType<Schemas['OffsetPageInfo']> = z.strictObject({
  offset: z.number(),
  limit: z.number(),
  total: z.number(),
});
const CURSOR_PAGE: z.ZodType<Schemas['CursorPageInfo']> = z.strictObject({
  has_more: z.boolean(),
  limit: z.number(),
  next_cursor: z.string().nullable(),
});
// `category` and `category_source` are in no response until WP-60, so a row that carries one fails the parse
const DOMAIN_ROW: z.ZodType<Schemas['SourceDomainRow']> = z.strictObject({
  registrable_domain: z.string(),
  domain_role: ROLE,
  role_entity_id: z.string().nullable(),
  citation_units: z.number(),
  observations: z.number(),
  prompts: z.number(),
  engines: z.array(ENGINE_UNITS),
  source_share: CELL,
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  previous: PREVIOUS.nullable().exactOptional(),
  series: z.array(WEEK_UNITS).nullable().exactOptional(),
  cited_with: CITED_WITH.nullable().exactOptional(),
});
const PAGE_ROW: z.ZodType<Schemas['SourcePageRow']> = z.strictObject({
  url_id: z.number(),
  url: z.string(),
  host: z.string(),
  title: z.string().nullable(),
  registrable_domain: z.string(),
  domain_role: ROLE,
  role_entity_id: z.string().nullable(),
  citation_units: z.number(),
  observations: z.number(),
  prompts: z.number(),
  engines: z.array(ENGINE_UNITS),
  source_share: CELL,
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  previous: PREVIOUS.nullable().exactOptional(),
  series: z.array(WEEK_UNITS).nullable().exactOptional(),
});
const DOMAIN_PAGE: z.ZodType<Schemas['SourceDomainPage']> = z.strictObject({
  data: z.array(DOMAIN_ROW),
  meta: SOURCES_META,
  page: OFFSET_PAGE,
});
const PAGE_PAGE: z.ZodType<Schemas['SourcePagePage']> = z.strictObject({
  data: z.array(PAGE_ROW),
  meta: SOURCES_META,
  page: OFFSET_PAGE,
});
const CITATION_ROW: z.ZodType<Schemas['CitationRow']> = z.strictObject({
  observation_id: z.string(),
  observed_at: z.string(),
  prompt_id: z.string(),
  engine_code: ENGINE,
  citation_index: z.number(),
  url_id: z.number(),
  url: z.string(),
  raw_url: z.string(),
  host: z.string(),
  registrable_domain: z.string(),
  title: z.string().nullable(),
  citation_kind: z.string(),
  domain_role: ROLE,
  role_entity_id: z.string().nullable(),
  occurrences: z.number(),
});
const CITATION_PAGE: z.ZodType<Schemas['CitationPage']> = z.strictObject({
  data: z.array(CITATION_ROW),
  page: CURSOR_PAGE,
});
const CHANGE_PAGE: z.ZodType<Schemas['SourceChangePage']> = z.strictObject({
  data: z.array(
    z.strictObject({
      registrable_domain: z.string(),
      domain_role: ROLE,
      role_entity_id: z.string().nullable(),
      current_units: z.number(),
      previous_units: z.number(),
      first_seen_at: z.string().nullable(),
      last_seen_at: z.string().nullable(),
    }),
  ),
  meta: z.strictObject({
    window: WINDOW,
    compare_window: WINDOW,
    include_branded: z.boolean(),
    engine_codes: z.array(ENGINE),
    kind: z.enum(['new', 'lost']),
    min_support: z.number(),
  }),
  page: OFFSET_PAGE,
});
const DIVERSITY: z.ZodType<Schemas['SourceDiversity']> = z.strictObject({
  data: z.array(
    z.strictObject({
      engine_code: ENGINE,
      answers: z.number(),
      answers_citing: z.number(),
      citation_units: z.number(),
      distinct_domains: z.number(),
      effective_sources: CELL,
      series: z
        .array(
          z.strictObject({
            week_start: z.string(),
            citation_units: z.number(),
            distinct_domains: z.number(),
            effective_sources: z.number().nullable(),
          }),
        )
        .nullable()
        .exactOptional(),
    }),
  ),
  meta: z.strictObject({
    window: WINDOW,
    include_branded: z.boolean(),
    engine_codes: z.array(ENGINE),
    distinct_domains: z.number(),
    effective_sources_engine_average: z.number().nullable(),
  }),
});
const PROMPTS_PAGE: z.ZodType<Schemas['PromptOwnPagesPage']> = z.strictObject({
  data: z.array(
    z.strictObject({
      prompt_id: z.string(),
      engine_code: ENGINE,
      answers: z.number(),
      answers_citing_own: z.number(),
      own_citation_units: z.number(),
      own_pages: z.number(),
      top_own_page: z.strictObject({ url_id: z.number(), url: z.string() }).nullable(),
    }),
  ),
  meta: z.strictObject({ window: WINDOW, include_branded: z.boolean(), engine_codes: z.array(ENGINE) }),
  page: CURSOR_PAGE,
});

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}/ai`;
const EVENTUS = `${W}/projects/${eventus.project_id}/ai`;
const ROUTES = [
  'sources/domains',
  'sources/pages',
  'citations',
  'sources/changes',
  'sources/diversity',
  'sources/prompts',
] as const;

const get = (path: string, role: 'owner' | 'viewer' | 'analyst' | 'billing' = 'owner'): Promise<Answer> =>
  mockBrowser(role).call('GET', path);

/** A `200` answer, parsed with `shape`. */
async function read<T>(path: string, shape: z.ZodType<T>): Promise<T> {
  const answer = await get(path);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return shape.parse(answer.body);
}

const PROMPT = z.object({ code: z.string(), limit_days: z.number().optional() });

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('citation reads answer what the generated schema says', () => {
  it('domains answers the generated SourceDomainPage shape', async () => {
    const page = await read(`${FYNIX}/sources/domains`, DOMAIN_PAGE);
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.page).toEqual({ offset: 0, limit: 50, total: page.data.length });
    expect(page.meta.engine_codes).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(page.meta.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' });
    expect(page.data.some((row) => row.registrable_domain === 'fynix.digital' && row.domain_role === 'own')).toBe(true);
    // The rows add up to every unit in scope, each share is of the scope's units
    expect(page.data.reduce((sum, row) => sum + row.citation_units, 0)).toBe(page.meta.citation_units);
    expect(page.data.every((row) => row.source_share.denominator === page.meta.citation_units)).toBe(true);
    expect(page.meta.by_role.map((entry) => entry.domain_role)).toEqual(['own', 'competitor', 'third_party']);
  });

  it('pages answers SourcePagePage with host, title and previous', async () => {
    const page = await read(`${FYNIX}/sources/pages?compare=previous_period&include=series`, PAGE_PAGE);
    expect(page.data.length).toBeGreaterThan(0);
    // Without include=series no row carries one, as on the domains route
    const plain = await read(`${FYNIX}/sources/pages`, PAGE_PAGE);
    expect(plain.data.length).toBeGreaterThan(0);
    expect(plain.meta).not.toHaveProperty('series');
    expect(plain.data.some((row) => 'series' in row)).toBe(false);
    for (const row of page.data) {
      expect(row.host).not.toBe('');
      expect(row.title).not.toBeNull();
      expect(row.previous).toBeDefined();
      expect(row.series).toHaveLength(page.meta.series?.length ?? -1);
    }
    expect(page.meta.compare_window).toEqual({ from: '2026-09-18', to: '2026-10-15', timezone: 'Europe/Berlin' });
    const own = await read(`${FYNIX}/sources/pages?filter[registrable_domain]=fynix.digital`, PAGE_PAGE);
    expect(own.data.every((row) => row.registrable_domain === 'fynix.digital')).toBe(true);
    const domain = await read(`${FYNIX}/sources/domains`, DOMAIN_PAGE);
    expect(own.data.reduce((sum, row) => sum + row.citation_units, 0)).toBe(
      domain.data.find((row) => row.registrable_domain === 'fynix.digital')?.citation_units,
    );
  });

  it('citations answers CitationPage in keyset order, newest answer first, and a URL listed twice is two rows', async () => {
    // An answer that lists its first source twice: two rows, one unit
    const state = promptsOf(fynix.project_id);
    const [prompt] = state.prompts;
    const [engine] = state.engines;
    if (prompt === undefined || engine === undefined) throw new Error('Fynix has no prompt or engine');
    const delivered = deliveredOf(prompt, 0, engine, NOW - 3_600_000, '99999999999', 'run-1');
    const [first] = delivered.citations;
    if (first === undefined) throw new Error('The delivered answer cites nothing');
    state.observations.push({
      ...delivered,
      citations: [...delivered.citations, { ...first, citation_index: delivered.citations.length + 1 }],
    });

    const rows: Schemas['CitationRow'][] = [];
    let cursor: string | null = null;
    do {
      const path: string = `${FYNIX}/citations?limit=40${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = await read(path, CITATION_PAGE);
      rows.push(...page.data);
      cursor = page.page.next_cursor;
    } while (cursor !== null);
    expect(rows.length).toBeGreaterThan(80);
    // Newest answer first, an answer's sources in their order
    for (const [place, row] of rows.slice(1).entries()) {
      const before = rows[place];
      if (before === undefined) throw new Error('A row is missing');
      const older = Date.parse(row.observed_at) - Date.parse(before.observed_at);
      const smaller = BigInt(row.observation_id) - BigInt(before.observation_id);
      if (older !== 0) expect(older).toBeLessThan(0);
      else if (smaller !== 0n) expect(smaller).toBeLessThan(0n);
      else expect(row.citation_index).toBeGreaterThan(before.citation_index);
    }
    const ours = rows.filter((row) => row.observation_id === '99999999999');
    expect(rows[0]?.observation_id).toBe('99999999999');
    expect(ours).toHaveLength(delivered.citations.length + 1);
    expect(new Set(ours.map((row) => row.url_id)).size).toBe(delivered.citations.length);
    // The rows behind one page: both listings of the address come back
    const urlId = ours.find((row) => row.citation_index === 1)?.url_id;
    expect(urlId).toBeDefined();
    const behind = await read(`${FYNIX}/citations?filter[url_id]=${String(urlId)}&limit=200`, CITATION_PAGE);
    expect(behind.data.filter((row) => row.observation_id === '99999999999')).toHaveLength(2);
  });

  it('changes answers SourceChangePage for new and lost with the windows the contract names', async () => {
    const added = await read(`${FYNIX}/sources/changes?min_support=1`, CHANGE_PAGE);
    expect(added.meta).toMatchObject({ kind: 'new', min_support: 1 });
    expect(added.meta.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' });
    expect(added.meta.compare_window).toEqual({ from: '2026-09-18', to: '2026-10-15', timezone: 'Europe/Berlin' });
    expect(added.data.every((row) => row.previous_units === 0 && row.current_units >= 1)).toBe(true);
    expect(added.page.total).toBe(added.data.length);
    expect((await read(`${FYNIX}/sources/changes`, CHANGE_PAGE)).meta.min_support).toBe(2);

    // The asked window and the one before it are the 2 empty windows; the support window is before those
    const lost = await read(`${FYNIX}/sources/changes?kind=lost&min_support=1`, CHANGE_PAGE);
    expect(lost.meta.window).toEqual({ from: '2026-09-18', to: '2026-11-12', timezone: 'Europe/Berlin' });
    expect(lost.meta.compare_window).toEqual({ from: '2026-08-21', to: '2026-09-17', timezone: 'Europe/Berlin' });
    expect(lost.data.every((row) => row.current_units === 0 && row.first_seen_at === null)).toBe(true);
  });

  it('diversity answers SourceDiversity with the engines in scope and an average that never pools', async () => {
    const all = await read(`${FYNIX}/sources/diversity?include=series`, DIVERSITY);
    expect(all.data.map((engine) => engine.engine_code)).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    const values = all.data.flatMap((engine) =>
      engine.effective_sources.value === null ? [] : [engine.effective_sources.value],
    );
    expect(values).toHaveLength(2);
    expect(all.meta.effective_sources_engine_average).toBeCloseTo((values[0] ?? 0) / 2 + (values[1] ?? 0) / 2, 10);
    // AI Mode is off in Fynix: no answer, so no value (never 0)
    expect(all.data[2]?.effective_sources).toMatchObject({ value: null, numerator: 0, denominator: 0 });
    expect(all.meta.distinct_domains).toBeLessThanOrEqual(
      all.data.reduce((sum, engine) => sum + engine.distinct_domains, 0),
    );
    expect(all.data.every((engine) => engine.series?.length === 5)).toBe(true);
    const one = await read(`${FYNIX}/sources/diversity?filter[engine_code_in]=gemini_web`, DIVERSITY);
    expect(one.data.map((engine) => engine.engine_code)).toEqual(['gemini_web']);
    expect(one.data[0]).not.toHaveProperty('series');
  });

  it('prompts answers PromptOwnPagesPage and filter[own_cited] keeps cited or uncited pairs', async () => {
    const all = await read(`${FYNIX}/sources/prompts?limit=200`, PROMPTS_PAGE);
    const cited = await read(`${FYNIX}/sources/prompts?limit=200&filter[own_cited]=true`, PROMPTS_PAGE);
    const uncited = await read(`${FYNIX}/sources/prompts?limit=200&filter[own_cited]=false`, PROMPTS_PAGE);
    expect(all.data.length).toBeGreaterThan(20);
    expect(cited.data.length + uncited.data.length).toBe(all.data.length);
    expect(cited.data.every((row) => row.answers_citing_own > 0 && row.top_own_page !== null)).toBe(true);
    expect(uncited.data.every((row) => row.answers_citing_own === 0 && row.top_own_page === null)).toBe(true);
    expect(all.data.every((row) => row.answers > 0)).toBe(true);
    // Keyset pages in (prompt, engine) order
    const keys = all.data.map((row) => `${row.prompt_id} ${row.engine_code}`);
    expect(keys).toEqual([...keys].sort());
    const small = await read(`${FYNIX}/sources/prompts?limit=5`, PROMPTS_PAGE);
    expect(small.data).toEqual(all.data.slice(0, 5));
    expect(small.page.has_more).toBe(true);
  });

  it('filter[prompt_id] reads one prompt whatever its state', async () => {
    const state = promptsOf(fynix.project_id);
    const branded = state.prompts.find((prompt) => prompt.is_branded);
    const [archived] = state.prompts;
    if (branded === undefined || archived === undefined) throw new Error('Fynix has no branded prompt');
    const before = await read(`${FYNIX}/sources/domains`, DOMAIN_PAGE);
    expect(
      (await read(`${FYNIX}/sources/domains?filter[prompt_id]=${branded.prompt_id}`, DOMAIN_PAGE)).meta.answers,
    ).toBeGreaterThan(0);
    archived.is_active = false;
    const after = await read(`${FYNIX}/sources/domains`, DOMAIN_PAGE);
    expect(after.meta.answers).toBeLessThan(before.meta.answers);
    const own = await read(`${FYNIX}/sources/domains?filter[prompt_id]=${archived.prompt_id}`, DOMAIN_PAGE);
    expect(own.meta.answers).toBeGreaterThan(0);
    expect(own.meta.include_branded).toBe(false);
  });

  it('include=series,cited_with,by_role_by_engine adds the blocks and leaves them out otherwise', async () => {
    const plain = await read(`${FYNIX}/sources/domains`, DOMAIN_PAGE);
    expect(plain.meta).not.toHaveProperty('series');
    expect(plain.meta).not.toHaveProperty('by_role_by_engine');
    expect(plain.meta).not.toHaveProperty('compare_window');
    expect(plain.data.some((row) => 'series' in row || 'cited_with' in row || 'previous' in row)).toBe(false);

    const full = await read(
      `${FYNIX}/sources/domains?include=series,cited_with,by_role_by_engine&compare=previous_period`,
      DOMAIN_PAGE,
    );
    // The Mondays of the weeks 16 October to 12 November touch
    expect(full.meta.series?.map((week) => week.week_start)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
    ]);
    expect(full.meta.by_role_by_engine).toHaveLength(3);
    expect(full.meta.previous_answers).toBeGreaterThan(0);
    for (const row of full.data) expect(row.series).toHaveLength(full.meta.series?.length ?? -1);
    expect(full.data.some((row) => row.cited_with !== undefined)).toBe(true);
    // The weekly points of the rows add up to the units of the scope's weeks
    const perWeek = (full.meta.series ?? []).map((_, place) =>
      full.data.reduce((sum, row) => sum + (row.series?.[place]?.citation_units ?? 0), 0),
    );
    expect(perWeek).toEqual((full.meta.series ?? []).map((week) => week.citation_units));
  });

  it('include_unresolved_redirects adds the flagged units to the aggregates and never to the citation list', async () => {
    const byDefault = await read(`${FYNIX}/sources/domains`, DOMAIN_PAGE);
    const asked = await read(`${FYNIX}/sources/domains?include_unresolved_redirects=true`, DOMAIN_PAGE);
    expect(byDefault.meta.citation_units).toBe(569);
    expect(asked.meta.citation_units).toBe(581);
    // The list keeps every flagged citation: it has one row per listed source, whatever the aggregates leave out
    const rows: Schemas['CitationRow'][] = [];
    let cursor: string | null = null;
    do {
      const path: string = `${FYNIX}/citations?limit=200${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = await read(path, CITATION_PAGE);
      rows.push(...page.data);
      cursor = page.page.next_cursor;
    } while (cursor !== null);
    expect(rows).toHaveLength(581);
  });

  it('the mock lists no more than 3 engines and keeps their order', async () => {
    const asked = await read(`${FYNIX}/sources/domains?filter[engine_code_in]=google_ai_mode,chatgpt_web`, DOMAIN_PAGE);
    expect(asked.meta.engine_codes).toEqual(['chatgpt_web', 'google_ai_mode']);
    expect(asked.data[0]?.engines.map((engine) => engine.engine_code)).toEqual(['chatgpt_web', 'google_ai_mode']);
    const four = await get(
      `${FYNIX}/sources/domains?filter[engine_code_in]=chatgpt_web,gemini_web,google_ai_mode,chatgpt_web`,
    );
    expect(four.status).toBe(422);
    expect(fieldCodes(four)).toContain('filter[engine_code_in]:too_long');
  });
});

describe('cursors, validation and access', () => {
  it('a cursor of another scope is 400 invalid_cursor', async () => {
    for (const route of ['citations', 'sources/prompts']) {
      const first = await read(`${FYNIX}/${route}?limit=2`, z.object({ page: CURSOR_PAGE }));
      expect(first.page.next_cursor).not.toBeNull();
      const same = await get(`${FYNIX}/${route}?limit=2&cursor=${first.page.next_cursor ?? ''}`);
      expect(same.status).toBe(200);
      const other = await get(
        `${FYNIX}/${route}?limit=2&filter[engine_code_in]=gemini_web&cursor=${first.page.next_cursor ?? ''}`,
      );
      expect(other.status).toBe(400);
      expect(other.code).toBe('invalid_cursor');
    }
  });

  it.each(ROUTES)('an unknown query name on %s is 422', async (route) => {
    const answer = await get(`${FYNIX}/${route}?bogus=1`);
    expect(answer.status).toBe(422);
    expect(fieldCodes(answer)).toEqual(['bogus:extra_forbidden']);
  });

  it('a parameter another route has is 422 on the route that has not', async () => {
    expect((await get(`${FYNIX}/sources/diversity?filter[domain_role_in]=own`)).status).toBe(422);
    expect((await get(`${FYNIX}/sources/prompts?filter[domain_role_in]=own`)).status).toBe(422);
    expect((await get(`${FYNIX}/citations?include_unresolved_redirects=true`)).status).toBe(422);
    expect((await get(`${FYNIX}/sources/changes?compare=previous_period`)).status).toBe(422);
  });

  it('min_support=0 is 422', async () => {
    for (const route of ['sources/domains', 'sources/pages', 'sources/changes']) {
      const answer = await get(`${FYNIX}/${route}?min_support=0`);
      expect(answer.status).toBe(422);
      expect(fieldCodes(answer)).toEqual(['min_support:greater_than_equal']);
    }
    expect(fieldCodes(await get(`${FYNIX}/sources/domains?min_support=1001`))).toEqual(['min_support:less_than_equal']);
    expect((await get(`${FYNIX}/sources/domains?min_support=1000`)).status).toBe(200);
  });

  it('filter[country_iso]=us is 422', async () => {
    for (const route of ROUTES) {
      const answer = await get(`${FYNIX}/${route}?filter[country_iso]=us`);
      expect(answer.status, route).toBe(422);
      expect(fieldCodes(answer)).toEqual(['filter[country_iso]:string_pattern_mismatch']);
    }
    // A market narrows the prompts: the German ones answer, no Indian prompt is branded or has an answer on Gemini alone
    const german = await read(`${FYNIX}/sources/domains?filter[country_iso]=DE`, DOMAIN_PAGE);
    const indian = await read(`${FYNIX}/sources/domains?filter[country_iso]=IN`, DOMAIN_PAGE);
    expect(indian.meta.answers).toBeLessThan(german.meta.answers);
    expect((await read(`${FYNIX}/sources/domains?filter[country_iso]=FR`, DOMAIN_PAGE)).meta).toMatchObject({
      answers: 0,
      citation_units: 0,
    });
  });

  it('include=cited_with on pages is 422', async () => {
    const answer = await get(`${FYNIX}/sources/pages?include=cited_with`);
    expect(answer.status).toBe(422);
    expect(fieldCodes(answer)).toEqual(['include.0:enum']);
    expect((await get(`${FYNIX}/sources/domains?include=series,cited_with,by_role_by_engine,series`)).status).toBe(422);
    expect(fieldCodes(await get(`${FYNIX}/sources/changes?kind=gone`))).toEqual(['kind.0:enum']);
    expect(fieldCodes(await get(`${FYNIX}/sources/domains?sort=name`))).toEqual(['sort.0:enum']);
  });

  it('a window over 92 days is window_too_large', async () => {
    const answer = await get(`${FYNIX}/sources/domains?from=2026-08-01&to=2026-11-12`);
    expect(answer.status).toBe(422);
    expect(PROMPT.parse(answer.body)).toEqual({ code: 'window_too_large', limit_days: 92 });
    expect((await get(`${FYNIX}/sources/changes?kind=lost&from=2026-08-13&to=2026-11-12`)).status).toBe(200);
    const inverted = await get(`${FYNIX}/citations?from=2026-11-12&to=2026-11-01`);
    expect(fieldCodes(inverted)).toEqual(['from:range_invalid']);
  });

  it('a project outside the member scope is 404 and a role without data:read is 403', async () => {
    for (const route of ROUTES) {
      // Jonas (analyst) is limited to Fynix and Cleanstart
      expect((await get(`${EVENTUS}/${route}`, 'analyst')).status, route).toBe(404);
      expect((await get(`${FYNIX}/${route}`, 'billing')).status, route).toBe(403);
      expect((await get(`${FYNIX}/${route}`, 'viewer')).status, route).toBe(200);
      // The order is 401, 404, 403, then 422: a bad parameter does not hide them
      expect((await get(`${EVENTUS}/${route}?bogus=1`, 'analyst')).status, route).toBe(404);
      expect((await get(`${FYNIX}/${route}?bogus=1`, 'billing')).status, route).toBe(403);
      const anonymous = await fetch(`${TEST_API_ORIGIN}${FYNIX}/${route}?bogus=1`);
      expect(anonymous.status, route).toBe(401);
    }
  });
});

describe('the Eventus Security data set', () => {
  it('every row of every route follows the generated field names', async () => {
    setAiSeeded(true);
    const domains = await read(
      `${EVENTUS}/sources/domains?include=series,cited_with,by_role_by_engine&compare=previous_period&limit=200`,
      DOMAIN_PAGE,
    );
    expect(domains.data.length).toBeGreaterThanOrEqual(10);
    expect(new Set(domains.data.map((row) => row.domain_role))).toEqual(new Set(['own', 'competitor', 'third_party']));
    expect(domains.data.some((row) => row.cited_with !== undefined)).toBe(true);
    expect(domains.meta.by_role.find((entry) => entry.domain_role === 'own')?.citation_units).toBeGreaterThan(0);
    const pages = await read(`${EVENTUS}/sources/pages?include=series&compare=previous_period&limit=200`, PAGE_PAGE);
    expect(pages.data.length).toBeGreaterThan(domains.data.length);
    const citations = await read(`${EVENTUS}/citations?limit=200`, CITATION_PAGE);
    expect(citations.data).toHaveLength(200);
    // No domain is new or lost in this data set (its sources follow fixed profiles), so the rows are empty but valid
    await read(`${EVENTUS}/sources/changes?min_support=1`, CHANGE_PAGE);
    await read(`${EVENTUS}/sources/changes?kind=lost&min_support=1`, CHANGE_PAGE);
    const diversity = await read(`${EVENTUS}/sources/diversity?include=series,ads`, DIVERSITY);
    // Google AI Mode is not asked in this project: its engine has no answer, so no value
    expect(diversity.data.filter((engine) => engine.effective_sources.value !== null)).toHaveLength(2);
    expect(diversity.data[2]?.effective_sources.value).toBeNull();
    const instead = await read(`${EVENTUS}/sources/prompts?limit=200&filter[own_cited]=false`, PROMPTS_PAGE);
    expect(instead.data.length).toBeGreaterThan(10);
    await read(`${EVENTUS}/sources/prompts?limit=200`, PROMPTS_PAGE);
    // The own domain and its competitors take a share, the third parties the most; no source takes a third
    const own = domains.meta.by_role.find((entry) => entry.domain_role === 'own');
    expect(own?.citation_units).toBeGreaterThan(100);
    expect(domains.data[0]?.source_share.value).toBeLessThan(0.3);
    // `rbi.org.in` and `cert-in.org.in` are two sources, not one `org.in`
    expect(domains.data.some((row) => row.registrable_domain === 'org.in')).toBe(false);
    // A topic narrows to the prompts given it
    const topic = promptsOf(eventus.project_id).prompts.find((prompt) => prompt.term_ids.length > 0)?.term_ids[0];
    expect(topic).toBeDefined();
    const narrowed = await read(`${EVENTUS}/sources/domains?filter[term]=${topic ?? ''}`, DOMAIN_PAGE);
    expect(narrowed.meta.answers).toBeLessThan(domains.meta.answers);
  });
});
