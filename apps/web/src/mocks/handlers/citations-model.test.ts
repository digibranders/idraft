import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  aggregateDomains,
  aggregatePages,
  answersWithCitations,
  canonicalOf,
  changesOf,
  citationRowsOf,
  countedAnswers,
  diversityOf,
  effectiveSources,
  metaOf,
  NO_FLAGS,
  ownPagesOf,
  registrableOf,
  scopeOf,
  termSubtree,
  unitsOf,
  urlIdOf,
  windowBefore,
  windowOf,
  type CitedAnswer,
  type DomainRole,
  type ScopeInput,
} from './citations-model';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { DAY_MS } from '../prompt-fixtures';
import { promptsOf } from '../prompts-state';
import type { CitationOut } from '@/lib/api/types';
import { mockBrowser } from '@/test/mock-api';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const ZONE = 'UTC';
const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const OTHER_ENTITY = '00000000-0000-4000-8000-0000000000e2';

const prompt = (id: string, extra: Partial<ScopeInput['prompts'][number]> = {}): ScopeInput['prompts'][number] => ({
  prompt_id: id,
  is_active: true,
  is_branded: false,
  country_iso: 'DE',
  term_ids: [],
  ...extra,
});
const PROMPTS = [prompt('p1'), prompt('p2')];

/** 26 October to 15 November: three Monday weeks (26 Oct, 2 Nov, 9 Nov), the 21 days before it end on 25 October. */
const scopeFor = (overrides: Partial<ScopeInput> = {}): ReturnType<typeof scopeOf> =>
  scopeOf({
    now: NOW,
    timezone: ZONE,
    from: '2026-10-26',
    to: '2026-11-15',
    engines: [],
    prompts: PROMPTS,
    promptId: null,
    termIds: null,
    country: null,
    roles: [],
    includeBranded: false,
    includeUnresolvedRedirects: false,
    includeEngineInternal: false,
    ...overrides,
  });

function cite(
  url: string,
  role: DomainRole = 'third_party',
  extra: { flags?: string[]; entity?: string; title?: string } = {},
): CitationOut {
  return {
    citation_index: 0,
    url,
    raw_url: url,
    host: new URL(url).host,
    title: extra.title ?? null,
    source_name: null,
    citation_kind: 'source_list',
    domain_role: role,
    role_entity_id: extra.entity ?? null,
    occurrences: 1,
    first_char_offset: null,
    answer_block_index: null,
    referral_tag: null,
    flags: extra.flags ?? [],
  };
}

let nextId = 1000;
function answer(
  iso: string,
  citations: CitationOut[],
  {
    engine = 'chatgpt_web',
    promptId = 'p1',
    valid = true,
    named = [],
  }: Partial<Pick<CitedAnswer, 'engine' | 'promptId' | 'valid' | 'named'>> = {},
): CitedAnswer {
  nextId += 1;
  return {
    id: String(nextId),
    at: Date.parse(`${iso}T09:00:00Z`),
    promptId,
    engine,
    valid,
    citations: citations.map((citation, place) => ({ ...citation, citation_index: place + 1 })),
    named,
  };
}

const OWN = 'https://own.com/audit';
const G2_X = 'https://www.g2.com/x';
const G2_Y = 'https://www.g2.com/y';
const RIVAL = 'https://rival.com/z';

/** Five units in the window: g2 3 (two in one answer, one in another), own 1, rival 1. */
const WORLD: CitedAnswer[] = [
  answer('2026-11-03', [cite(OWN, 'own', { entity: ENTITY }), cite(G2_X), cite(G2_Y)], { engine: 'chatgpt_web' }),
  answer('2026-11-10', [cite(G2_X), cite(RIVAL, 'competitor', { entity: OTHER_ENTITY })], { engine: 'gemini_web' }),
];

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('hosts and addresses', () => {
  it('registrableOf keeps www out and three labels for co.uk', () => {
    expect(registrableOf('www.Example.com')).toBe('example.com');
    expect(registrableOf('news.example.com')).toBe('example.com');
    expect(registrableOf('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableOf('shop.example.com.au')).toBe('example.com.au');
    expect(registrableOf('a.b.co.in')).toBe('b.co.in');
    expect(registrableOf('x.y.com.br')).toBe('y.com.br');
  });

  it('canonicalOf drops fragment, utm parameters and a trailing slash', () => {
    expect(canonicalOf('https://Example.com/a/b/?utm_source=x&id=7&UTM_medium=y#frag')).toBe(
      'https://example.com/a/b?id=7',
    );
    expect(canonicalOf('https://example.com/seo/')).toBe('https://example.com/seo');
    expect(canonicalOf('javascript:void(0)')).toBe('javascript:void(0)');
  });

  it('urlIdOf is stable and positive', () => {
    const id = urlIdOf('https://example.com/seo');
    expect(id).toBe(urlIdOf('https://example.com/seo'));
    expect(Number.isInteger(id) && id > 0).toBe(true);
    expect(urlIdOf('https://example.com/other')).not.toBe(id);
  });
});

describe('citation units', () => {
  it('counts a URL once per answer however often it is listed', () => {
    const listed = answer('2026-11-03', [cite(G2_X), cite(`${G2_X}/?utm_source=chatgpt.com#top`), cite(G2_Y)]);
    expect(listed.citations).toHaveLength(3);
    expect(unitsOf(listed, NO_FLAGS).map((unit) => unit.url)).toEqual([G2_X, G2_Y]);
  });

  it('leaves out flagged citations unless asked and still counts the answer', () => {
    const flagged = answer('2026-11-03', [
      cite(OWN, 'own'),
      cite('https://example.org/go', 'third_party', { flags: ['unresolved_redirect'] }),
    ]);
    const scope = scopeFor();
    expect(unitsOf(flagged, NO_FLAGS)).toHaveLength(1);
    expect(unitsOf(flagged, { unresolvedRedirects: true, engineInternal: false })).toHaveLength(2);
    const meta = metaOf([flagged], scope);
    expect([meta.answers, meta.answers_citing, meta.citation_units]).toEqual([1, 1, 1]);
    expect(metaOf([flagged], scopeFor({ includeUnresolvedRedirects: true })).citation_units).toBe(2);
  });

  it('counts a citation with two flags only when both are asked', () => {
    const both = answer('2026-11-03', [
      cite('https://example.org/go', 'third_party', { flags: ['unresolved_redirect', 'engine_internal'] }),
    ]);
    expect(unitsOf(both, { unresolvedRedirects: true, engineInternal: false })).toHaveLength(0);
    expect(unitsOf(both, { unresolvedRedirects: false, engineInternal: true })).toHaveLength(0);
    expect(unitsOf(both, { unresolvedRedirects: true, engineInternal: true })).toHaveLength(1);
  });

  it('counts only the valid answers of the scope inside its window', () => {
    const inside = answer('2026-11-03', [cite(OWN, 'own')]);
    const failed = answer('2026-11-04', [cite(OWN, 'own')], { valid: false });
    const early = answer('2026-10-20', [cite(OWN, 'own')]);
    const otherPrompt = answer('2026-11-04', [cite(OWN, 'own')], { promptId: 'p9' });
    expect(countedAnswers([inside, failed, early, otherPrompt], scopeFor())).toEqual([inside]);
  });
});

describe('shares and rows', () => {
  it('source share is units over every unit in scope and the rows add up to 1 without a role filter', () => {
    const rows = aggregateDomains(WORLD, scopeFor());
    expect(rows.map((row) => [row.registrable_domain, row.citation_units])).toEqual([
      ['g2.com', 3],
      ['own.com', 1],
      ['rival.com', 1],
    ]);
    for (const row of rows) {
      expect(row.source_share).toEqual({
        value: row.citation_units / 5,
        numerator: row.citation_units,
        denominator: 5,
        n_observations: 2,
        pooled: null,
      });
    }
    expect(rows.reduce((sum, row) => sum + (row.source_share.value ?? 0), 0)).toBeCloseTo(1, 10);
    expect(rows.map((row) => [row.observations, row.prompts])).toEqual([
      [2, 1],
      [1, 1],
      [1, 1],
    ]);
    expect(rows[0]?.engines).toEqual([
      { engine_code: 'chatgpt_web', citation_units: 2 },
      { engine_code: 'gemini_web', citation_units: 1 },
      { engine_code: 'google_ai_mode', citation_units: 0 },
    ]);
  });

  it('a role filter narrows rows and not the denominator', () => {
    const scope = scopeFor({ roles: ['own'] });
    const rows = aggregateDomains(WORLD, scope);
    expect(rows.map((row) => row.registrable_domain)).toEqual(['own.com']);
    expect(rows[0]?.source_share.denominator).toBe(5);
    expect(metaOf(WORLD, scope).citation_units).toBe(5);
  });

  it('min support leaves rows out and never meta', () => {
    const scope = scopeFor();
    expect(aggregateDomains(WORLD, scope, { minSupport: 2 }).map((row) => row.registrable_domain)).toEqual(['g2.com']);
    expect(aggregatePages(WORLD, scope, { minSupport: 2 }).map((page) => page.url)).toEqual([G2_X]);
    expect(metaOf(WORLD, scope).citation_units).toBe(5);
  });

  it('lists the pages of one domain whose units add up to the domain row', () => {
    const scope = scopeFor();
    const pages = aggregatePages(WORLD, scope, { registrableDomain: 'g2.com' });
    expect(pages.map((page) => [page.url, page.citation_units])).toEqual([
      [G2_X, 2],
      [G2_Y, 1],
    ]);
    expect(pages.reduce((sum, page) => sum + page.citation_units, 0)).toBe(
      aggregateDomains(WORLD, scope)[0]?.citation_units,
    );
    expect(pages[0]?.host).toBe('www.g2.com');
  });

  it('orders by the sort asked, then by units, then by name', () => {
    const scope = scopeFor();
    expect(aggregateDomains(WORLD, scope, { sort: '-observations' })[0]?.registrable_domain).toBe('g2.com');
    expect(aggregateDomains(WORLD, scope, { sort: '-prompts' }).map((row) => row.registrable_domain)).toEqual([
      'g2.com',
      'own.com',
      'rival.com',
    ]);
  });

  it('names the entity cited with, the most answers first and then the entity id', () => {
    const together = [
      answer('2026-11-03', [cite(G2_X)], { named: [OTHER_ENTITY, ENTITY] }),
      answer('2026-11-04', [cite(G2_X)], { named: [ENTITY] }),
      answer('2026-11-05', [cite(RIVAL, 'competitor')]),
    ];
    const rows = aggregateDomains(together, scopeFor(), { citedWith: true });
    expect(rows[0]?.cited_with).toEqual({ entity_id: ENTITY, observations: 2 });
    expect(rows[1]).not.toHaveProperty('cited_with');
    expect(aggregateDomains(together, scopeFor())[0]).not.toHaveProperty('cited_with');
  });
});

describe('the window before', () => {
  const before = [answer('2026-10-10', [cite(G2_X)])];

  it('previous is 0 for a domain not cited before', () => {
    const scope = scopeFor();
    const rows = aggregateDomains([...WORLD, ...before], scope, { compare: true });
    const byName = Object.fromEntries(rows.map((row) => [row.registrable_domain, row.previous]));
    expect(byName['g2.com']).toEqual({ citation_units: 1, observations: 1 });
    expect(byName['own.com']).toEqual({ citation_units: 0, observations: 0 });
    expect(aggregateDomains(WORLD, scope)[0]).not.toHaveProperty('previous');
    const meta = metaOf([...WORLD, ...before], scope, { compare: true });
    expect(meta.compare_window).toEqual({ from: '2026-10-05', to: '2026-10-25', timezone: ZONE });
    expect(meta.previous_answers).toBe(1);
  });

  it('is as long as the window and ends the day before it', () => {
    const window = windowOf('2026-10-26', '2026-11-15', ZONE);
    expect(windowBefore(window)).toMatchObject({ first: '2026-10-05', last: '2026-10-25' });
  });
});

describe('weekly points', () => {
  it('series has at most 14 zero filled Monday weeks and its units add up to meta', () => {
    const scope = scopeFor();
    const meta = metaOf(WORLD, scope, { series: true });
    expect(meta.series?.map((week) => week.week_start)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(meta.series?.map((week) => week.citation_units)).toEqual([0, 3, 2]);
    expect(meta.series?.map((week) => week.answers)).toEqual([0, 1, 1]);
    expect(meta.series?.map((week) => week.distinct_domains)).toEqual([0, 2, 2]);
    const rows = aggregateDomains(WORLD, scope, { series: true });
    for (const row of rows)
      expect(row.series?.map((week) => week.week_start)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    const perWeek = [0, 1, 2].map((place) =>
      rows.reduce((sum, row) => sum + (row.series?.[place]?.citation_units ?? 0), 0),
    );
    expect(perWeek).toEqual(meta.series?.map((week) => week.citation_units));
    // The longest window, 92 days, touches 14 weeks
    const long = metaOf(WORLD, scopeFor({ from: '2026-08-13', to: '2026-11-12' }), { series: true });
    expect(long.series).toHaveLength(14);
  });

  it('by_role_by_engine adds up to by_role per role', () => {
    const meta = metaOf(WORLD, scopeFor(), { byRoleByEngine: true });
    expect(meta.by_role_by_engine?.map((engine) => engine.engine_code)).toEqual([
      'chatgpt_web',
      'gemini_web',
      'google_ai_mode',
    ]);
    for (const role of ['own', 'competitor', 'third_party'] as const) {
      const summed = (meta.by_role_by_engine ?? []).reduce((sum, engine) => sum + engine[role].citation_units, 0);
      expect(summed).toBe(meta.by_role.find((entry) => entry.domain_role === role)?.citation_units);
    }
    expect(metaOf(WORLD, scopeFor())).not.toHaveProperty('by_role_by_engine');
  });
});

describe('effective sources and diversity', () => {
  it('effective sources is the squared sum over the sum of squares, null without a unit', () => {
    expect(effectiveSources([3, 1, 1])).toBeCloseTo(25 / 11, 10);
    expect(effectiveSources([4])).toBe(1);
    expect(effectiveSources([])).toBeNull();
    expect(effectiveSources([0])).toBeNull();
  });

  it('is read per engine and never pooled', () => {
    const diversity = diversityOf(WORLD, scopeFor());
    const [chatgpt, gemini, aiMode] = diversity.data;
    // chatgpt_web: own 1, g2 2 (squares 5, units 3); gemini_web: g2 1, rival 1 (squares 2, units 2)
    expect(chatgpt?.effective_sources).toMatchObject({ numerator: 9, denominator: 5, n_observations: 1 });
    expect(chatgpt?.effective_sources.value).toBeCloseTo(9 / 5, 10);
    expect(gemini?.effective_sources.value).toBe(2);
    expect(aiMode).toMatchObject({ answers: 0, citation_units: 0 });
    expect(aiMode?.effective_sources).toMatchObject({ value: null, numerator: 0, denominator: 0 });
    expect(diversity.meta.effective_sources_engine_average).toBeCloseTo((9 / 5 + 2) / 2, 10);
    // Three domains over both engines, not the four pairs of engine and domain
    expect(diversity.meta.distinct_domains).toBe(3);
  });
});

describe('new and lost sources', () => {
  it('changes new needs min_support units now and none before', () => {
    const answers = [
      answer('2026-11-03', [cite('https://new-a.com/1'), cite('https://new-b.com/1'), cite('https://old.com/1')]),
      answer('2026-11-04', [cite('https://new-a.com/2'), cite('https://old.com/2'), cite('https://old.com/3')]),
      answer('2026-10-10', [cite('https://old.com/0')]),
    ];
    const found = changesOf('new', answers, scopeFor(), 2);
    expect(found.rows.map((row) => [row.registrable_domain, row.current_units, row.previous_units])).toEqual([
      ['new-a.com', 2, 0],
    ]);
    expect(found.rows[0]?.first_seen_at).toBe('2026-11-03T09:00:00.000Z');
    expect(found.rows[0]?.last_seen_at).toBe('2026-11-04T09:00:00.000Z');
    expect(found.window).toEqual({ from: '2026-10-26', to: '2026-11-15', timezone: ZONE });
    expect(found.compareWindow).toEqual({ from: '2026-10-05', to: '2026-10-25', timezone: ZONE });
  });

  it('changes lost needs units in the support window and none in the two windows after', () => {
    // The asked window is 2 to 15 November: the two empty windows are 19 October to 1 November and 2 to 15 November
    const scope = scopeFor({ from: '2026-11-02', to: '2026-11-15' });
    const answers = [
      answer('2026-10-06', [cite('https://lost.com/1'), cite('https://back.com/1'), cite('https://thin.com/1')]),
      answer('2026-10-07', [cite('https://lost.com/2'), cite('https://back.com/2')]),
      answer('2026-10-25', [cite('https://back.com/3')]),
    ];
    const found = changesOf('lost', answers, scope, 2);
    expect(
      found.rows.map((row) => [row.registrable_domain, row.current_units, row.previous_units, row.first_seen_at]),
    ).toEqual([['lost.com', 0, 2, null]]);
    expect(found.window).toEqual({ from: '2026-10-19', to: '2026-11-15', timezone: ZONE });
    expect(found.compareWindow).toEqual({ from: '2026-10-05', to: '2026-10-18', timezone: ZONE });
  });
});

describe('own pages and citation rows', () => {
  it('lists the pairs that cite an own page, or none, with the page with the most units', () => {
    const answers = [
      answer('2026-11-03', [cite(OWN, 'own'), cite('https://own.com/other', 'own')], { promptId: 'p1' }),
      answer('2026-11-04', [cite(OWN, 'own')], { promptId: 'p1' }),
      answer('2026-11-05', [cite(G2_X)], { promptId: 'p2' }),
    ];
    const scope = scopeFor();
    const all = ownPagesOf(answers, scope, null);
    expect(
      all.map((row) => [row.prompt_id, row.answers, row.answers_citing_own, row.own_citation_units, row.own_pages]),
    ).toEqual([
      ['p1', 2, 2, 3, 2],
      ['p2', 1, 0, 0, 0],
    ]);
    expect(all[0]?.top_own_page).toEqual({ url_id: urlIdOf(OWN), url: OWN });
    expect(all[1]?.top_own_page).toBeNull();
    expect(ownPagesOf(answers, scope, false).map((row) => row.prompt_id)).toEqual(['p2']);
    expect(ownPagesOf(answers, scope, true).map((row) => row.prompt_id)).toEqual(['p1']);
  });

  it('lists every citation, a URL listed twice as two rows, newest answer first', () => {
    const newer = answer('2026-11-06', [
      cite(G2_X),
      cite(`${G2_X}?utm_source=x`, 'third_party', { flags: ['unresolved_redirect'] }),
    ]);
    const older = answer('2026-11-03', [cite(OWN, 'own')]);
    const rows = citationRowsOf(
      [older, newer].sort((a, b) => b.at - a.at),
      scopeFor(),
    );
    expect(rows.map((row) => [row.observation_id, row.citation_index])).toEqual([
      [newer.id, 1],
      [newer.id, 2],
      [older.id, 1],
    ]);
    expect(rows[0]?.url_id).toBe(rows[1]?.url_id);
    expect(citationRowsOf([newer, older], scopeFor(), { registrableDomain: 'own.com' })).toHaveLength(1);
    expect(citationRowsOf([newer, older], scopeFor(), { urlId: urlIdOf(G2_X) })).toHaveLength(2);
  });
});

describe('scope', () => {
  const prompts = [
    prompt('active'),
    prompt('branded', { is_branded: true }),
    prompt('archived', { is_active: false }),
    prompt('tagged', { term_ids: ['t2'], country_iso: 'IN' }),
  ];

  it('leaves out branded and archived prompts unless one prompt is asked for', () => {
    expect([...scopeFor({ prompts }).promptIds]).toEqual(['active', 'tagged']);
    expect([...scopeFor({ prompts, includeBranded: true }).promptIds]).toEqual(['active', 'branded', 'tagged']);
    expect([...scopeFor({ prompts, promptId: 'archived' }).promptIds]).toEqual(['archived']);
  });

  it('keeps the prompts of a term and of a market', () => {
    const terms = [
      { term_id: 't1', parent_id: null },
      { term_id: 't2', parent_id: 't1' },
      { term_id: 't3', parent_id: null },
    ];
    expect([...termSubtree(terms, 't1')]).toEqual(['t1', 't2']);
    expect(termSubtree(terms, 'unknown').size).toBe(0);
    expect([...scopeFor({ prompts, termIds: termSubtree(terms, 't1') }).promptIds]).toEqual(['tagged']);
    expect([...scopeFor({ prompts, country: 'IN' }).promptIds]).toEqual(['tagged']);
    expect([...scopeFor({ prompts, termIds: termSubtree(terms, 'unknown') }).promptIds]).toEqual([]);
  });

  it('defaults to the 28 days ending today, and lists the three engines in code order', () => {
    const scope = scopeFor({ from: null, to: null, engines: ['google_ai_mode', 'chatgpt_web'] });
    expect([scope.window.first, scope.window.last]).toEqual(['2026-10-16', '2026-11-12']);
    expect(scope.engines).toEqual(['chatgpt_web', 'google_ai_mode']);
    expect(scopeFor().engines).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
  });
});

describe('the mock world', () => {
  const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
  const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
  const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
  if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
  const PAGE = z.object({
    data: z.array(z.object({ observation_id: z.string() })),
    page: z.object({ next_cursor: z.string().nullable() }),
  });

  it('answersWithCitations lists the observation ids of the observations mock', async () => {
    const browser = mockBrowser('owner');
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `${W}/projects/${fynix.project_id}/ai/observations?limit=200${cursor === null ? '' : `&cursor=${cursor}`}`;
      const reply = await browser.call('GET', path);
      expect(reply.status).toBe(200);
      const page = PAGE.parse(reply.body);
      ids.push(...page.data.map((row) => row.observation_id));
      cursor = page.page.next_cursor;
    } while (cursor !== null);
    const since = NOW - 28 * DAY_MS;
    const ours = answersWithCitations(fynix.project_id, NOW)
      .filter((one) => one.at >= since && one.at < NOW)
      .map((one) => one.id);
    expect(ours.length).toBeGreaterThan(300);
    expect(ours).toEqual(ids);
  });

  it('keeps one answer list per project and run, and one that follows Run now', () => {
    expect(answersWithCitations(fynix.project_id, NOW)).toBe(answersWithCitations(fynix.project_id, NOW));
    expect(answersWithCitations(fynix.project_id, NOW)).not.toBe(
      answersWithCitations(fynix.project_id, NOW + 4 * DAY_MS),
    );
  });

  /** The default scope of a project's reads: the 28 days ending today, every engine, branded prompts left out. */
  const defaultScope = (projectId: string, timezone: string): ReturnType<typeof scopeOf> =>
    scopeFor({ from: null, to: null, timezone, prompts: promptsOf(projectId).prompts });

  it('gives Fynix its own domain and a few others, and the Eventus data set many domains of every role', () => {
    const fynixRows = aggregateDomains(
      answersWithCitations(fynix.project_id, NOW),
      defaultScope(fynix.project_id, fynix.timezone),
    );
    expect(fynixRows.some((row) => row.registrable_domain === 'fynix.digital' && row.domain_role === 'own')).toBe(true);

    setAiSeeded(true);
    const scope = defaultScope(eventus.project_id, eventus.timezone);
    const rows = aggregateDomains(answersWithCitations(eventus.project_id, NOW), scope);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((row) => row.domain_role))).toEqual(new Set(['own', 'competitor', 'third_party']));
    expect(rows.reduce((sum, row) => sum + (row.source_share.value ?? 0), 0)).toBeCloseTo(1, 10);
  });
});
