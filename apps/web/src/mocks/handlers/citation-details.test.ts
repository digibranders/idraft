import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { promptsOf } from '../prompts-state';
import type { Schemas } from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

/**
 * The answer is read through strict shapes declared against the generated types: a change to the schema breaks
 * this file at compile time, and a member the mock leaves out or adds fails the parse (`strictObject`).
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
});
const SOURCES_META: z.ZodType<Schemas['SourcesMeta']> = z.strictObject({
  window: WINDOW,
  include_branded: z.boolean(),
  engine_codes: z.array(ENGINE),
  answers: z.number(),
  answers_citing: z.number(),
  citation_units: z.number(),
  by_role: z.array(z.strictObject({ domain_role: ROLE, citation_units: z.number(), observations: z.number() })),
});
const DETAIL: z.ZodType<Schemas['SourceDomainDetail']> = z.strictObject({
  data: z.strictObject({
    registrable_domain: z.string(),
    rows: z.array(DOMAIN_ROW),
    engines: z.array(
      z.strictObject({
        engine_code: ENGINE,
        series: z.array(
          z.strictObject({
            week_start: z.string(),
            citation_units: z.number(),
            observations: z.number(),
            all_citation_units: z.number(),
            answers: z.number(),
          }),
        ),
      }),
    ),
    top_pages: z.array(PAGE_ROW),
    prompts: z.array(z.strictObject({ prompt_id: z.string(), citation_units: z.number(), observations: z.number() })),
    cited_with: z.array(z.strictObject({ entity_id: z.string(), observations: z.number() })),
  }),
  meta: SOURCES_META,
});
const DOMAIN_PAGE = z.object({ data: z.array(DOMAIN_ROW), meta: SOURCES_META });

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}/ai`;
const EVENTUS = `${W}/projects/${eventus.project_id}/ai`;
const OWN = 'fynix.digital';

const get = (path: string, role: 'owner' | 'viewer' | 'analyst' | 'billing' = 'owner'): Promise<Answer> =>
  mockBrowser(role).call('GET', path);

async function read<T>(path: string, shape: z.ZodType<T>): Promise<T> {
  const answer = await get(path);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return shape.parse(answer.body);
}
const detailOf = (domain: string, query = ''): Promise<Schemas['SourceDomainDetail']> =>
  read(`${FYNIX}/sources/domains/${domain}${query}`, DETAIL);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('the domain detail answers what the generated schema says', () => {
  it('answers SourceDomainDetail for a cited domain', async () => {
    const { data, meta } = await detailOf(OWN);
    expect(data.registrable_domain).toBe(OWN);
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows.every((row) => row.registrable_domain === OWN)).toBe(true);
    expect(data.engines.map((engine) => engine.engine_code)).toEqual(meta.engine_codes);
    expect(meta.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' });
  });

  it('has rows equal to the domain row of sources/domains in the same scope', async () => {
    const { data } = await detailOf(OWN);
    const list = await read(`${FYNIX}/sources/domains?limit=200`, DOMAIN_PAGE);
    expect(data.rows).toEqual(list.data.filter((row) => row.registrable_domain === OWN));
  });

  it('has weekly units that add up to the engine units of the rows', async () => {
    const { data } = await detailOf(OWN);
    for (const engine of data.engines) {
      const weekly = engine.series.reduce((sum, week) => sum + week.citation_units, 0);
      const rows = data.rows.reduce(
        (sum, row) => sum + (row.engines.find((cell) => cell.engine_code === engine.engine_code)?.citation_units ?? 0),
        0,
      );
      expect(weekly, engine.engine_code).toBe(rows);
      expect(engine.series.every((week) => week.citation_units <= week.all_citation_units)).toBe(true);
    }
    expect(data.engines.some((engine) => engine.series.some((week) => week.citation_units > 0))).toBe(true);
  });

  it('has at most 10 pages, most units first, that add up to the rows', async () => {
    const { data } = await detailOf(OWN);
    expect(data.top_pages.length).toBeGreaterThan(0);
    expect(data.top_pages.length).toBeLessThanOrEqual(10);
    const units = data.top_pages.map((page) => page.citation_units);
    expect(units).toEqual([...units].sort((a, b) => b - a));
    expect(data.top_pages.every((page) => page.registrable_domain === OWN)).toBe(true);
  });

  it('has at most 20 prompts, most units first, with ids of fixture prompts', async () => {
    const { data } = await detailOf(OWN);
    const known = new Set(promptsOf(fynix.project_id).prompts.map((prompt) => prompt.prompt_id));
    expect(data.prompts.length).toBeGreaterThan(0);
    expect(data.prompts.length).toBeLessThanOrEqual(20);
    expect(data.prompts.every((prompt) => known.has(prompt.prompt_id))).toBe(true);
    const units = data.prompts.map((prompt) => prompt.citation_units);
    expect(units).toEqual([...units].sort((a, b) => b - a));
  });

  it('has at most 5 entity ids, most named first', async () => {
    const { data } = await detailOf(OWN);
    expect(data.cited_with.length).toBeGreaterThan(0);
    expect(data.cited_with.length).toBeLessThanOrEqual(5);
    const named = data.cited_with.map((entry) => entry.observations);
    expect(named).toEqual([...named].sort((a, b) => b - a));
    expect(data.cited_with.every((entry) => entry.entity_id !== '' && entry.observations > 0)).toBe(true);
  });

  it('answers 200 with empty lists for a domain that is not cited', async () => {
    const { data, meta } = await detailOf('nobody.example');
    expect(data).toEqual({
      registrable_domain: 'nobody.example',
      rows: [],
      engines: [],
      top_pages: [],
      prompts: [],
      cited_with: [],
    });
    expect(meta.answers).toBeGreaterThan(0);
  });

  it('reads the name in lower case', async () => {
    const { data } = await detailOf('Fynix.Digital');
    expect(data.registrable_domain).toBe(OWN);
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it('is narrowed by the country and by both flags as the list is', async () => {
    const all = await detailOf(OWN);
    const german = await detailOf(OWN, '?filter[country_iso]=DE');
    const unitsOf = (detail: Schemas['SourceDomainDetail']): number =>
      detail.data.rows.reduce((sum, row) => sum + row.citation_units, 0);
    expect(unitsOf(german)).toBeLessThanOrEqual(unitsOf(all));
    expect(german.meta.answers).toBeLessThan(all.meta.answers);
    const french = await detailOf(OWN, '?filter[country_iso]=FR');
    expect(french.data.rows).toEqual([]);
    // The unresolved redirect fixture is cited as example.org: left out by default, counted when asked for
    expect((await detailOf('example.org')).data.rows).toEqual([]);
    const flagged = await detailOf('example.org', '?include_unresolved_redirects=true');
    expect(flagged.data.rows[0]?.citation_units).toBe(12);
    expect((await detailOf('example.org', '?include_engine_internal=true')).data.rows).toEqual([]);
  });

  it('is narrowed by an engine', async () => {
    const one = await detailOf(OWN, '?filter[engine_code_in]=gemini_web');
    expect(one.data.engines.map((engine) => engine.engine_code)).toEqual(['gemini_web']);
    expect(one.meta.engine_codes).toEqual(['gemini_web']);
  });
});

describe('the domain detail checks the request in the API order', () => {
  const route = (domain = OWN): string => `${FYNIX}/sources/domains/${domain}`;

  it('is 401 without a session, 404 for a project the caller cannot see and 403 without data:read', async () => {
    const anonymous = await fetch(`${TEST_API_ORIGIN}${route()}?bogus=1`);
    expect(anonymous.status).toBe(401);
    // Jonas (analyst) is limited to Fynix and Cleanstart
    expect((await get(`${EVENTUS}/sources/domains/${OWN}?bogus=1`, 'analyst')).status).toBe(404);
    expect((await get(`${route()}?bogus=1`, 'billing')).status).toBe(403);
    expect((await get(route(), 'viewer')).status).toBe(200);
  });

  it('is 422 for an unknown query name, a parameter the route has not and a bad value', async () => {
    expect(fieldCodes(await get(`${route()}?bogus=1`))).toEqual(['bogus:extra_forbidden']);
    expect((await get(`${route()}?filter[domain_role_in]=own`)).status).toBe(422);
    expect((await get(`${route()}?limit=5`)).status).toBe(422);
    expect(fieldCodes(await get(`${route()}?filter[country_iso]=de`))).toEqual([
      'filter[country_iso]:string_pattern_mismatch',
    ]);
    const long = await get(`${route()}?from=2026-08-01&to=2026-11-12`);
    expect(long.status).toBe(422);
    expect(long.code).toBe('window_too_large');
  });
});
