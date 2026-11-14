import { describe, expect, it } from 'vitest';

import { figuresOf, identityOf, pageRowOf, parseUrlId, trendOf } from './source-model';
import type { CitationRow, EngineCode, SourcePageRow, SourcesMeta, SourcesWeek } from '@/lib/citations/types';

const ENGINES: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: [...ENGINES],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
};

const TOTALS = new Map<EngineCode, number>([
  ['chatgpt_web', 7000],
  ['gemini_web', 6000],
  ['google_ai_mode', 5420],
]);

const pageOf = (overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: 7,
  url: 'https://g2.com/products/crm',
  title: 'Best CRM software',
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 200 },
    { engine_code: 'gemini_web', citation_units: 100 },
    { engine_code: 'google_ai_mode', citation_units: 0 },
  ],
  source_share: { value: 300 / 18420, numerator: 300, denominator: 18420, n_observations: 4812 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const citationOf = (overrides: Partial<CitationRow> = {}): CitationRow => ({
  citation_index: 2,
  citation_kind: 'link',
  domain_role: 'third_party',
  engine_code: 'chatgpt_web',
  host: 'g2.com',
  observation_id: '1001',
  observed_at: '2026-11-08T10:00:00Z',
  occurrences: 1,
  prompt_id: '0c1f4e7b-0000-4000-8000-000000000001',
  raw_url: 'https://g2.com/products/crm?utm=x',
  registrable_domain: 'g2.com',
  role_entity_id: null,
  title: 'Best CRM software',
  url: 'https://g2.com/products/crm',
  url_id: 7,
  ...overrides,
});

describe('parseUrlId', () => {
  it('reads a positive whole number and nothing else', () => {
    expect(parseUrlId('7')).toBe(7);
    expect(parseUrlId('0')).toBeNull();
    expect(parseUrlId('-3')).toBeNull();
    expect(parseUrlId('7.5')).toBeNull();
    expect(parseUrlId('07')).toBeNull();
    expect(parseUrlId('abc')).toBeNull();
    expect(parseUrlId('99999999999999999999')).toBeNull();
  });
});

describe('identityOf', () => {
  it('takes the title, host, address, role, domain and last time from the newest citation', () => {
    const rows = [
      citationOf({
        observation_id: '1',
        observed_at: '2026-11-01T10:00:00Z',
        title: 'Older title',
        host: 'old.g2.com',
      }),
      citationOf({ observation_id: '2', observed_at: '2026-11-09T10:00:00Z', title: 'Newest title', host: 'g2.com' }),
    ];
    expect(identityOf(rows)).toEqual({
      urlId: 7,
      url: 'https://g2.com/products/crm',
      host: 'g2.com',
      registrable: 'g2.com',
      role: 'third_party',
      roleEntityId: null,
      title: 'Newest title',
      lastCitedAt: '2026-11-09T10:00:00Z',
    });
  });

  it('takes the role entity from the newest citation too', () => {
    const rows = [
      citationOf({ observed_at: '2026-11-09T10:00:00Z', domain_role: 'competitor', role_entity_id: 'ent-rival' }),
    ];
    expect(identityOf(rows)).toMatchObject({ role: 'competitor', roleEntityId: 'ent-rival' });
  });

  it('keeps a missing title as null, never as text', () => {
    expect(identityOf([citationOf({ title: null })])?.title).toBeNull();
  });

  it('is null for no rows', () => {
    expect(identityOf([])).toBeNull();
  });
});

describe('pageRowOf', () => {
  const identity = { urlId: 7, role: 'third_party', roleEntityId: null } as const;

  it('finds the row by url_id', () => {
    const pages = [pageOf({ url_id: 3 }), pageOf({ url_id: 7, title: 'The one' }), pageOf({ url_id: 9 })];
    expect(pageRowOf(pages, identity)?.title).toBe('The one');
  });

  it('gives null for a page past the 200 listed', () => {
    expect(pageRowOf([pageOf({ url_id: 3 })], identity)).toBeNull();
    expect(pageRowOf([], identity)).toBeNull();
  });

  // The API returns a page once for each role and entity it was cited in; the header names the newest citation's
  it('prefers the row of the role and entity the newest citation names', () => {
    const pages = [
      pageOf({ title: 'As competitor', domain_role: 'competitor', role_entity_id: 'ent-rival', citation_units: 40 }),
      pageOf({ title: 'As third party', domain_role: 'third_party', role_entity_id: null, citation_units: 300 }),
      pageOf({ title: 'As other rival', domain_role: 'competitor', role_entity_id: 'ent-other', citation_units: 10 }),
    ];
    expect(pageRowOf(pages, identity)?.title).toBe('As third party');
    expect(pageRowOf(pages, { urlId: 7, role: 'competitor', roleEntityId: 'ent-other' })?.title).toBe('As other rival');
  });

  it('falls back to the first row of the page when none has the role of the newest citation', () => {
    const pages = [
      pageOf({ title: 'First', domain_role: 'competitor', role_entity_id: 'ent-rival' }),
      pageOf({ title: 'Second', domain_role: 'competitor', role_entity_id: 'ent-other' }),
    ];
    expect(pageRowOf(pages, identity)?.title).toBe('First');
  });
});

describe('figuresOf', () => {
  it("takes the units and the share from the row's cell, with the total it is of", () => {
    const figures = figuresOf(pageOf(), META, TOTALS);
    expect(figures.units).toBe(300);
    expect(figures.share).toEqual({ value: 300 / 18420, units: 300, total: 18420 });
    expect(figures.answersInScope).toBe(4812);
    expect(figures.answers).toBe(120);
    expect(figures.prompts).toBe(20);
  });

  it("lists the engines in order with each engine's own total", () => {
    const { engines } = figuresOf(
      pageOf(),
      { ...META, engine_codes: ['google_ai_mode', 'chatgpt_web', 'gemini_web'] },
      TOTALS,
    );
    expect(engines).toEqual([
      { code: 'chatgpt_web', units: 200, total: 7000, share: 200 / 7000 },
      { code: 'gemini_web', units: 100, total: 6000, share: 100 / 6000 },
      { code: 'google_ai_mode', units: 0, total: 5420, share: 0 },
    ]);
  });

  it('says an engine whose total is missing has no share (n/a), never 0', () => {
    const { engines } = figuresOf(pageOf(), META, new Map([['chatgpt_web', 7000]]));
    expect(engines[1]).toEqual({ code: 'gemini_web', units: 100, total: null, share: null });
    expect(engines[2]).toEqual({ code: 'google_ai_mode', units: 0, total: null, share: null });
  });

  it('says every share is unknown while the totals are not read', () => {
    const { engines } = figuresOf(pageOf(), META, null);
    expect(engines.every((engine) => engine.total === null && engine.share === null)).toBe(true);
    expect(engines.map((engine) => engine.units)).toEqual([200, 100, 0]);
  });

  it('gives an engine with no unit in scope no share: no citation on it is not 0%', () => {
    const { engines } = figuresOf(pageOf(), META, new Map([...TOTALS, ['google_ai_mode', 0]]));
    expect(engines[2]).toEqual({ code: 'google_ai_mode', units: 0, total: 0, share: null });
  });

  it('says the units of an engine the row does not list are unknown, not 0', () => {
    const { engines } = figuresOf(
      pageOf({ engines: [{ engine_code: 'chatgpt_web', citation_units: 200 }] }),
      META,
      TOTALS,
    );
    expect(engines[1]).toEqual({ code: 'gemini_web', units: null, total: 6000, share: null });
  });

  it('counts the engines that cite the page, and says n/a when one is not known', () => {
    expect(figuresOf(pageOf(), META, TOTALS).enginesCiting).toBe(2);
    expect(
      figuresOf(pageOf({ engines: [{ engine_code: 'chatgpt_web', citation_units: 200 }] }), META, TOTALS).enginesCiting,
    ).toBeNull();
  });

  it('has a null share when the scope has no unit', () => {
    const empty = pageOf({
      citation_units: 0,
      source_share: { value: null, numerator: 0, denominator: 0, n_observations: 0 },
    });
    expect(figuresOf(empty, { ...META, citation_units: 0 }, TOTALS).share).toEqual({ value: null, units: 0, total: 0 });
  });
});

const weekOf = (start: string, units: number): SourcesWeek => ({
  week_start: start,
  answers: 100,
  citation_units: units,
  distinct_domains: 10,
});

describe('trendOf', () => {
  it("is the weekly share over the scope's weeks, with the counts behind each point", () => {
    const trend = trendOf(
      [
        { week_start: '2026-10-19', citation_units: 5, observations: 3 },
        { week_start: '2026-10-26', citation_units: 0, observations: 0 },
      ],
      [weekOf('2026-10-19', 100), weekOf('2026-10-26', 200)],
    );
    expect(trend).toEqual({
      weeks: ['2026-10-19', '2026-10-26'],
      values: [0.05, 0],
      cells: [
        { units: 5, total: 100 },
        { units: 0, total: 200 },
      ],
    });
  });

  it('leaves a gap where the scope had no unit, and a real 0 where it had units and the page none', () => {
    const trend = trendOf(
      [
        { week_start: '2026-10-19', citation_units: 0, observations: 0 },
        { week_start: '2026-10-26', citation_units: 0, observations: 0 },
        { week_start: '2026-11-02', citation_units: 4, observations: 2 },
      ],
      [weekOf('2026-10-19', 0), weekOf('2026-10-26', 50), weekOf('2026-11-02', 80)],
    );
    expect(trend?.values).toEqual([null, 0, 0.05]);
    expect(trend?.cells[0]).toBeNull();
    expect(trend?.cells[1]).toEqual({ units: 0, total: 50 });
  });

  it('leaves a gap for a week the page has no point for, never a 0 it was not told', () => {
    const trend = trendOf(
      [{ week_start: '2026-11-02', citation_units: 4, observations: 2 }],
      [weekOf('2026-10-26', 50), weekOf('2026-11-02', 80)],
    );
    expect(trend?.values).toEqual([null, 0.05]);
  });

  it('is null when the read has no series, or the scope no unit in any week: there is nothing to draw', () => {
    expect(trendOf(undefined, [weekOf('2026-10-19', 100)])).toBeNull();
    expect(trendOf(null, [weekOf('2026-10-19', 100)])).toBeNull();
    expect(trendOf([{ week_start: '2026-10-19', citation_units: 1, observations: 1 }], undefined)).toBeNull();
    expect(
      trendOf([{ week_start: '2026-10-19', citation_units: 0, observations: 0 }], [weekOf('2026-10-19', 0)]),
    ).toBeNull();
  });
});
