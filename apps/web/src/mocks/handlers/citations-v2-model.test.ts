import { describe, expect, it } from 'vitest';

import {
  boardOf,
  citedPageOf,
  citedPagesOf,
  gapOf,
  gapsOf,
  overviewOf,
  windowOf,
  type BoardScope,
  type BoardWorld,
} from './citations-v2-model';
import { CITATIONS_FIXTURE, type FixtureExpected } from '../citations-v2-fixture';
import { equalWeightAverage } from '@/lib/stats';

/** A world with the preview's own names: five competitors, the thirteen topics, the own domain. */
const WORLD: BoardWorld = {
  ownHost: CITATIONS_FIXTURE.ownDomain,
  timezone: 'Europe/Berlin',
  competitors: CITATIONS_FIXTURE.competitors.map((competitor, index) => ({
    entityId: `0192d1a8-c0de-7000-8000-00000000000${String(index + 1)}`,
    name: competitor.name,
    colorIndex: index + 2,
    domain: competitor.domain,
  })),
  topics: CITATIONS_FIXTURE.topics.map((name, index) => ({
    termId: `0192d1a8-7e57-7000-8000-${String(index + 1).padStart(12, '0')}`,
    name,
  })),
};
const BOARD = boardOf(CITATIONS_FIXTURE, WORLD);
const DEFAULT = WORLD.competitors.slice(0, 3).map((competitor) => competitor.entityId);
const scopeOf = (engines: BoardScope['engines'], runs: BoardScope['runs'] = 4): BoardScope => ({
  runs,
  engines,
  termIds: null,
});

/** What the strip shows for `expected`, from the overview the route answers. */
function stripOf(expected: FixtureExpected): void {
  const overview = overviewOf(BOARD, scopeOf(expected.engines));
  const rate = (field: 'answers' | 'prompts') =>
    equalWeightAverage(
      overview.engines.map((engine) =>
        engine[field] === 0 ? null : engine[field === 'answers' ? 'answers_citing' : 'prompts_citing'] / engine[field],
      ),
    );
  expect(overview.citations).toBe(expected.strip.citations);
  expect(overview.previous_citations).toBe(expected.strip.previousCitations);
  expect(overview.own_urls).toBe(expected.strip.urls);
  expect(overview.previous_own_urls).toBe(expected.strip.previousUrls);
  expect(overview.domains).toBe(expected.strip.domains);
  expect(overview.previous_domains).toBe(expected.strip.previousDomains);
  expect(overview.window.answers).toBe(expected.strip.answers);
  expect(overview.window.prompts).toBe(expected.strip.prompts);
  expect(rate('answers').value).toBeCloseTo(expected.strip.frequency ?? Number.NaN, 12);
  expect(rate('prompts').value).toBeCloseTo(expected.strip.coverage ?? Number.NaN, 12);
}

describe('the Citations v2 mock model', () => {
  it.each([
    ['ChatGPT', CITATIONS_FIXTURE.expected.chatgpt],
    ['ChatGPT and Gemini', CITATIONS_FIXTURE.expected.enabled],
    ['all three engines', CITATIONS_FIXTURE.expected.three],
  ])('answers the preview strip for %s', (_, expected) => {
    stripOf(expected);
  });

  it.each([
    ['ChatGPT', CITATIONS_FIXTURE.expected.chatgpt],
    ['all three engines', CITATIONS_FIXTURE.expected.three],
  ])('counts the cited pages of each owner and the top own page for %s', (_, expected) => {
    const scope = scopeOf(expected.engines);
    const all = citedPagesOf(BOARD, scope, { role: null, q: '', sort: '-citations', offset: 0, limit: 200 });
    expect(all.meta.owners).toEqual({
      own: expected.pages.own,
      competitor: expected.pages.competitor,
      third_party: expected.pages.third_party,
      all: expected.pages.all,
    });
    const own = citedPagesOf(BOARD, scope, { role: 'own', q: '', sort: '-citations', offset: 0, limit: 200 });
    expect(own.page.total).toBe(expected.pages.own);
    expect(own.meta.citations).toBe(expected.strip.citations);
    expect(own.data[0]).toMatchObject({
      path: expected.pages.topOwn.path,
      citations: expected.pages.topOwn.citations,
      prompts: expected.pages.topOwn.prompts,
    });
  });

  it.each([
    ['ChatGPT', CITATIONS_FIXTURE.expected.chatgpt],
    ['ChatGPT and Gemini', CITATIONS_FIXTURE.expected.enabled],
    ['all three engines', CITATIONS_FIXTURE.expected.three],
  ])('finds the preview gaps for %s at the default competitors', (_, expected) => {
    const list = gapsOf(BOARD, scopeOf(expected.engines), DEFAULT);
    expect(list.meta.prompts).toBe(expected.gaps.prompts);
    expect(list.meta.gaps).toBe(expected.gaps.gaps);
    expect(list.data[0]?.text).toBe(expected.gaps.first);
    expect(list.meta.competitors.map((competitor) => competitor.name)).toEqual(['HubSpot', 'Pipedrive', 'Salesforce']);
  });

  it('numbers the slots: four current, four previous, eight in the trend, oldest first', () => {
    const window = windowOf(BOARD, scopeOf(['chatgpt_web']));
    expect(window.current.map((slot) => slot.slot)).toEqual([1, 2, 3, 4]);
    expect(window.previous.map((slot) => slot.slot)).toEqual([5, 6, 7, 8]);
    expect(window.trend.map((slot) => slot.slot)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(window.latest_answer_at).toBe('2026-09-28T00:10:00.000Z');
    expect(window.latest_run_number).toBe(48);
    expect(windowOf(BOARD, scopeOf(['chatgpt_web'], 1)).previous.map((slot) => slot.slot)).toEqual([2]);
  });

  it('pages, filters by role and by text, and sorts with the address as the last tie', () => {
    const scope = scopeOf(['chatgpt_web']);
    const first = citedPagesOf(BOARD, scope, { role: null, q: '', sort: '-citations', offset: 0, limit: 50 });
    const second = citedPagesOf(BOARD, scope, { role: null, q: '', sort: '-citations', offset: 50, limit: 50 });
    expect(first.data).toHaveLength(50);
    expect(first.page).toEqual({ offset: 0, limit: 50, total: CITATIONS_FIXTURE.expected.chatgpt.pages.all });
    expect(new Set([...first.data, ...second.data].map((row) => row.url_id)).size).toBe(100);
    const g2 = citedPagesOf(BOARD, scope, { role: 'third_party', q: 'G2.COM', sort: 'page', offset: 0, limit: 200 });
    expect(g2.data.every((row) => row.host === 'g2.com')).toBe(true);
    expect(g2.meta.owners.all).toBe(CITATIONS_FIXTURE.expected.chatgpt.pages.all);
    const urls = g2.data.map((row) => row.url);
    expect(urls).toEqual([...urls].sort((a, b) => a.localeCompare(b)));
  });

  it('opens a cited page with its prompts and the domains cited beside it, once per answer', () => {
    const scope = scopeOf(['chatgpt_web']);
    const top = citedPagesOf(BOARD, scope, { role: 'own', q: '', sort: '-citations', offset: 0, limit: 1 }).data[0];
    if (top === undefined) throw new Error('No own page is cited');
    const detail = citedPageOf(BOARD, scope, top.url_id);
    expect(detail?.prompts).toHaveLength(top.prompts);
    expect(detail?.prompts.reduce((sum, prompt) => sum + prompt.cited, 0)).toBe(top.citations);
    for (const domain of detail?.alongside ?? []) expect(domain.answers).toBeLessThanOrEqual(top.citations);
    expect(citedPageOf(BOARD, scope, 999_999)).toBeNull();
  });

  it('opens a gap prompt with competitor pages, and returns nothing for a prompt it does not have', () => {
    const scope = scopeOf(['chatgpt_web']);
    const gap = gapsOf(BOARD, scope, DEFAULT).data.find((row) => row.gap > 0);
    if (gap === undefined) throw new Error('No gap');
    const detail = gapOf(BOARD, scope, DEFAULT, gap.prompt_id);
    expect(detail?.competitor_pages.length).toBeGreaterThan(0);
    expect(detail?.third_party_pages.length).toBeLessThanOrEqual(5);
    expect(gapOf(BOARD, scope, DEFAULT, '0192d1a8-c177-7000-8000-999999999999')).toBeNull();
  });

  it('gives a prompt no topic in a project without topic terms (D-10)', () => {
    const bare = boardOf(CITATIONS_FIXTURE, { ...WORLD, topics: [] });
    expect(gapsOf(bare, scopeOf(['chatgpt_web']), DEFAULT).data.every((row) => row.topic === null)).toBe(true);
  });
});
