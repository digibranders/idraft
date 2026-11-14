import { describe, expect, it } from 'vitest';

import { domainDetailOf } from './citation-detail-model';
import { scopeOf, type CitedAnswer, type DomainRole, type ScopeInput } from './citations-model';
import type { CitationOut } from '@/lib/api/types';

/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const OTHER_ENTITY = '00000000-0000-4000-8000-0000000000e2';

const prompt = (id: string): ScopeInput['prompts'][number] => ({
  prompt_id: id,
  is_active: true,
  is_branded: false,
  country_iso: 'DE',
  term_ids: [],
});

/** 26 October to 15 November: three Monday weeks (26 Oct, 2 Nov, 9 Nov). */
const scopeFor = (overrides: Partial<ScopeInput> = {}): ReturnType<typeof scopeOf> =>
  scopeOf({
    now: NOW,
    timezone: 'UTC',
    from: '2026-10-26',
    to: '2026-11-15',
    engines: [],
    prompts: [prompt('p1'), prompt('p2')],
    promptId: null,
    termIds: null,
    country: null,
    roles: [],
    includeBranded: false,
    includeUnresolvedRedirects: false,
    includeEngineInternal: false,
    ...overrides,
  });

function cite(url: string, role: DomainRole = 'third_party', entity: string | null = null): CitationOut {
  return {
    citation_index: 0,
    url,
    raw_url: url,
    host: new URL(url).host,
    title: null,
    source_name: null,
    citation_kind: 'source_list',
    domain_role: role,
    role_entity_id: entity,
    occurrences: 1,
    first_char_offset: null,
    answer_block_index: null,
    referral_tag: null,
    flags: [],
  };
}

let nextId = 5000;
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

const WORLD: CitedAnswer[] = [
  answer('2026-11-03', [cite(OWN, 'own', ENTITY), cite(G2_X), cite(G2_Y)], { named: [ENTITY] }),
  answer('2026-11-10', [cite(G2_X), cite(RIVAL, 'competitor', OTHER_ENTITY)], {
    engine: 'gemini_web',
    promptId: 'p2',
    named: [ENTITY, OTHER_ENTITY],
  }),
  answer('2026-10-28', [cite(G2_X)], { promptId: 'p2', named: [OTHER_ENTITY] }),
  answer('2026-11-04', [cite(G2_X)], { valid: false }),
];

describe('domainDetailOf', () => {
  it('has one row for a domain cited in one role, with its units and the answers and prompts behind them', () => {
    const detail = domainDetailOf(WORLD, scopeFor(), 'g2.com');
    expect(detail.registrable_domain).toBe('g2.com');
    expect(detail.rows).toHaveLength(1);
    expect(detail.rows[0]).toMatchObject({
      registrable_domain: 'g2.com',
      domain_role: 'third_party',
      role_entity_id: null,
      citation_units: 4,
      observations: 3,
      prompts: 2,
    });
  });

  it('has a row for each role and entity that cites the domain, most units first', () => {
    const many = answer('2026-11-03', [
      cite('https://g2.com/a', 'competitor', OTHER_ENTITY),
      cite('https://g2.com/b', 'competitor', OTHER_ENTITY),
    ]);
    const plain = answer('2026-11-04', [cite('https://g2.com/c')]);
    const detail = domainDetailOf([many, plain], scopeFor(), 'g2.com');
    expect(detail.rows.map((row) => [row.domain_role, row.role_entity_id, row.citation_units])).toEqual([
      ['competitor', OTHER_ENTITY, 2],
      ['third_party', null, 1],
    ]);
  });

  it('lists at most 10 rows, 10 pages, 20 prompts and 5 entities', () => {
    const entities = Array.from(
      { length: 12 },
      (_, place) => `00000000-0000-4000-8000-00000000f${String(place).padStart(3, '0')}`,
    );
    const prompts = Array.from({ length: 22 }, (_, place) => `q${String(place)}`);
    const big = answer(
      '2026-11-03',
      entities.map((entity, place) => cite(`https://g2.com/page-${String(place)}`, 'competitor', entity)),
      { named: entities.slice(0, 7) },
    );
    const asked = prompts.map((promptId) => answer('2026-11-04', [cite('https://g2.com/shared')], { promptId }));
    const detail = domainDetailOf([big, ...asked], scopeFor({ prompts: [...prompts, 'p1'].map(prompt) }), 'g2.com');
    expect(detail.rows).toHaveLength(10);
    expect(detail.top_pages).toHaveLength(10);
    expect(detail.prompts).toHaveLength(20);
    expect(detail.cited_with).toHaveLength(5);
  });

  it('lists the pages of the domain, most units first', () => {
    const detail = domainDetailOf(WORLD, scopeFor(), 'g2.com');
    expect(detail.top_pages.map((page) => [page.url, page.citation_units])).toEqual([
      [G2_X, 3],
      [G2_Y, 1],
    ]);
  });

  it('lists the prompts most units first, then most answers', () => {
    const detail = domainDetailOf(WORLD, scopeFor(), 'g2.com');
    expect(detail.prompts).toEqual([
      { prompt_id: 'p2', citation_units: 2, observations: 2 },
      { prompt_id: 'p1', citation_units: 2, observations: 1 },
    ]);
  });

  it('lists the entities named most in the answers that cite the domain, ties by id', () => {
    const detail = domainDetailOf(WORLD, scopeFor(), 'g2.com');
    expect(detail.cited_with).toEqual([
      { entity_id: ENTITY, observations: 2 },
      { entity_id: OTHER_ENTITY, observations: 2 },
    ]);
  });

  it('has a weekly series for each engine in scope, with the engine totals of the week as the denominator', () => {
    const detail = domainDetailOf(WORLD, scopeFor(), 'g2.com');
    expect(detail.engines.map((engine) => engine.engine_code)).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    const weeks = (code: string): unknown[][] =>
      (detail.engines.find((engine) => engine.engine_code === code)?.series ?? []).map((week) => [
        week.week_start,
        week.citation_units,
        week.observations,
        week.all_citation_units,
        week.answers,
      ]);
    expect(weeks('chatgpt_web')).toEqual([
      ['2026-10-26', 1, 1, 1, 1],
      ['2026-11-02', 2, 1, 3, 1],
      ['2026-11-09', 0, 0, 0, 0],
    ]);
    expect(weeks('gemini_web')).toEqual([
      ['2026-10-26', 0, 0, 0, 0],
      ['2026-11-02', 0, 0, 0, 0],
      ['2026-11-09', 1, 1, 2, 1],
    ]);
    expect(weeks('google_ai_mode').every((week) => week.slice(1).every((value) => value === 0))).toBe(true);
  });

  it('keeps only the engines asked for', () => {
    const detail = domainDetailOf(WORLD, scopeFor({ engines: ['gemini_web'] }), 'g2.com');
    expect(detail.engines.map((engine) => engine.engine_code)).toEqual(['gemini_web']);
    expect(detail.rows[0]?.citation_units).toBe(1);
  });

  it('has empty lists, engines included, for a domain that is not cited', () => {
    const detail = domainDetailOf(WORLD, scopeFor(), 'nobody.example');
    expect(detail).toEqual({
      registrable_domain: 'nobody.example',
      rows: [],
      engines: [],
      top_pages: [],
      prompts: [],
      cited_with: [],
    });
  });

  it('leaves out a flagged citation unless the scope asks for it', () => {
    const flagged = answer('2026-11-03', [{ ...cite('https://example.org/go'), flags: ['unresolved_redirect'] }]);
    expect(domainDetailOf([flagged], scopeFor(), 'example.org').rows).toEqual([]);
    const asked = domainDetailOf([flagged], scopeFor({ includeUnresolvedRedirects: true }), 'example.org');
    expect(asked.rows[0]?.citation_units).toBe(1);
  });

  it('ignores the role filter of the scope: a detail is of the whole domain', () => {
    const detail = domainDetailOf(WORLD, scopeFor({ roles: ['own'] }), 'g2.com');
    expect(detail.rows).toHaveLength(1);
  });
});
