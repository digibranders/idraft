import { describe, expect, it } from 'vitest';

import {
  acceptSuggestions,
  decideOpportunities,
  dismissSuggestions,
  opportunities,
  opportunitiesCsv,
  plannedFixesCsv,
  routesTo,
  tierSuggestions,
} from './internal-links-opportunities-world';
import {
  assignedTier,
  crawledPages,
  EVENTUS,
  HISTORY_RUN_IDS,
  runViewOf,
  setLinksScenario,
  type RunView,
} from './internal-links-world';

const P = EVENTUS.project_id;
const T0 = Date.parse('2026-11-18T09:00:00Z');
const latest = (): RunView => {
  const view = runViewOf(P, null, T0);
  if (view === null) throw new Error('no latest crawl');
  return view;
};
const page = (path: string) => {
  const found = crawledPages().find((candidate) => candidate.path === path);
  if (found === undefined) throw new Error(`no page ${path}`);
  return found;
};
const ALL = { status: null, tier: null, q: null, offset: 0, limit: 50 } as const;

describe('opportunities', () => {
  it('lists pages that mention another page topic without linking to it, the most important targets first', () => {
    const { data, meta } = opportunities(latest(), ALL);
    expect(data).toHaveLength(8);
    expect(data.map((row) => row.target.tier?.code ?? 'none')).toEqual([
      'T1',
      'T1',
      'T1',
      'T1',
      'T1',
      'T2',
      'T2',
      'none',
    ]);
    expect(data[0]).toMatchObject({ source: { path: '/about' }, target: { path: '/contact' }, status: 'open' });
    expect(meta).toEqual({ run_id: HISTORY_RUN_IDS[0], total: 8, counts: { open: 8, accepted: 0, dismissed: 0 } });
    // The equity of the source page is never given
    expect(data.every((row) => row.source_equity_share === null)).toBe(true);
    expect(data.every((row) => row.key === `${row.source.url_id}>${row.target.url_id}`)).toBe(true);
  });

  it('filters by target tier, text and status, and pages by offset and limit', () => {
    expect(opportunities(latest(), { ...ALL, tier: '1' }).meta.total).toBe(5);
    expect(opportunities(latest(), { ...ALL, tier: 'none' }).data).toHaveLength(1);
    expect(opportunities(latest(), { ...ALL, q: '/pricing' }).data).toHaveLength(1);
    expect(opportunities(latest(), { ...ALL, status: 'accepted' }).data).toEqual([]);
    const second = opportunities(latest(), { ...ALL, offset: 6, limit: 5 });
    expect(second.data).toHaveLength(2);
    expect(second.meta.total).toBe(8);
  });

  it('moves a pair between the counts when it is decided, and back when it is reopened', () => {
    const [first, second] = opportunities(latest(), ALL).data;
    if (first === undefined || second === undefined) throw new Error('no opportunity');
    const pairs = [first, second].map((row) => ({
      source_url_id: row.source.url_id,
      target_url_id: row.target.url_id,
    }));
    expect(decideOpportunities(pairs, 'accepted')).toEqual({ matched: 2, changed: 2 });
    expect(decideOpportunities(pairs, 'accepted')).toEqual({ matched: 2, changed: 0 });
    expect(decideOpportunities(pairs.slice(0, 1), 'dismissed')).toEqual({ matched: 1, changed: 1 });
    expect(opportunities(latest(), ALL).meta.counts).toEqual({ open: 6, accepted: 1, dismissed: 1 });
    expect(opportunities(latest(), { ...ALL, status: 'dismissed' }).data.map((row) => row.key)).toEqual([first.key]);
    expect(decideOpportunities(pairs, 'open')).toEqual({ matched: 2, changed: 2 });
    expect(opportunities(latest(), ALL).meta.counts).toEqual({ open: 8, accepted: 0, dismissed: 0 });
  });

  it('matches nothing for a pair that is not listed, and reopens nothing that was never decided', () => {
    const stranger = [{ source_url_id: '101', target_url_id: '103' }];
    expect(decideOpportunities(stranger, 'accepted')).toEqual({ matched: 0, changed: 0 });
    const [first] = opportunities(latest(), ALL).data;
    if (first === undefined) throw new Error('no opportunity');
    const pair = [{ source_url_id: first.source.url_id, target_url_id: first.target.url_id }];
    expect(decideOpportunities(pair, 'open')).toEqual({ matched: 0, changed: 0 });
  });

  it('exports the planned fixes: the accepted rows, or every open row when none is accepted', () => {
    expect(plannedFixesCsv()).toHaveLength(9);
    const [first] = opportunities(latest(), ALL).data;
    if (first === undefined) throw new Error('no opportunity');
    decideOpportunities([{ source_url_id: first.source.url_id, target_url_id: first.target.url_id }], 'accepted');
    const planned = plannedFixesCsv();
    expect(planned[0]).toEqual(['Source URL', 'Target URL', 'Anchor', 'Context', 'Status']);
    expect(planned).toHaveLength(2);
    expect(planned[1]?.[4]).toBe('accepted');
    expect(opportunitiesCsv({ ...ALL, tier: '1' })).toHaveLength(6);
  });

  it('has none when the switch says so', () => {
    setLinksScenario({ noOpportunities: true });
    expect(opportunities(latest(), ALL)).toMatchObject({ data: [], meta: { total: 0, counts: { open: 0 } } });
  });
});

describe('tier suggestions', () => {
  it('suggests a higher tier for pages with clicks or ranks, never for a page with a manual tier', () => {
    const { data, meta } = tierSuggestions(latest());
    expect(meta).toEqual({ run_id: HISTORY_RUN_IDS[0], gsc_state: 'ok' });
    expect(data.map((row) => [row.path, row.from_tier?.code ?? null, row.to_tier.code])).toEqual([
      ['/blog', null, 'T3'],
      ['/blog/soc-vs-mdr', 'T3', 'T2'],
      ['/blog/what-is-a-soc', 'T3', 'T2'],
    ]);
    expect(data[2]?.reasons).toEqual([
      { kind: 'clicks', clicks: 1810, rank: null, keyword: null, volume: null },
      { kind: 'rank', clicks: null, rank: 5, keyword: 'what is a soc', volume: 14800 },
    ]);
    expect(data[0]?.reasons).toEqual([{ kind: 'clicks', clicks: 150, rank: null, keyword: null, volume: null }]);
  });

  it('uses the ranks alone while Search Console has no clicks', () => {
    setLinksScenario({ gsc: 'pending' });
    const { data, meta } = tierSuggestions(latest());
    expect(meta.gsc_state).toBe('pending');
    expect(data.map((row) => row.path)).toEqual(['/blog/soc-vs-mdr', '/blog/what-is-a-soc']);
    expect(data.every((row) => row.reasons.every((reason) => reason.kind === 'rank'))).toBe(true);
  });

  it('sets the suggested tier by hand when accepted, and stops suggesting the page', () => {
    const target = page('/blog/soc-vs-mdr');
    expect(acceptSuggestions({ url_ids: [target.id, '101'] })).toEqual({ matched: 1, changed: 1 });
    expect(assignedTier(target)).toMatchObject({ source: 'manual', tier: { code: 'T2' } });
    expect(tierSuggestions(latest()).data.map((row) => row.path)).toEqual(['/blog', '/blog/what-is-a-soc']);
  });

  it('hides dismissed suggestions, or all of them, and has none when the switch says so', () => {
    const target = page('/blog');
    expect(dismissSuggestions({ url_ids: [target.id] })).toEqual({ matched: 1, changed: 1 });
    expect(dismissSuggestions({ url_ids: [target.id] })).toEqual({ matched: 0, changed: 0 });
    expect(tierSuggestions(latest()).data).toHaveLength(2);
    expect(dismissSuggestions({ all: true })).toEqual({ matched: 2, changed: 2 });
    expect(tierSuggestions(latest()).data).toEqual([]);
  });

  it('has none when the switch says so', () => {
    setLinksScenario({ noSuggestions: true });
    expect(tierSuggestions(latest()).data).toEqual([]);
  });
});

describe('routes from the start page', () => {
  it('finds the route over every link and over editorial links only, each step naming its link', () => {
    const routes = routesTo(page('/services/soc-as-a-service').id);
    expect(routes?.target.path).toBe('/services/soc-as-a-service');
    expect(routes?.any?.clicks).toBe(1);
    expect(routes?.any?.steps.map((step) => step.page.path)).toEqual(['/', '/services/soc-as-a-service']);
    expect(routes?.any?.steps[0]).toMatchObject({ anchor: null, placement: null, scope: null, via_redirect: false });
    expect(routes?.any?.steps[1]).toMatchObject({
      anchor: 'SOC as a service',
      placement: 'content',
      scope: 'editorial',
    });
    expect(routes?.editorial?.clicks).toBe(1);
  });

  it('has no editorial route to a page only the menu reaches, and a longer one for deeper pages', () => {
    const blog = routesTo(page('/blog/vapt-checklist').id);
    expect(blog?.any?.steps.map((step) => step.page.path)).toEqual(['/', '/blog', '/blog/vapt-checklist']);
    expect(blog?.any?.steps[1]).toMatchObject({ anchor: 'Blog', placement: 'navigation', scope: 'template' });
    expect(blog?.editorial).toBeNull();
  });

  it('is zero clicks to the start page, and no route to a page nothing links to', () => {
    expect(routesTo(page('/').id)?.any).toMatchObject({ clicks: 0 });
    const partners = routesTo(page('/partners').id);
    expect(partners).toMatchObject({ any: null, editorial: null });
  });

  it('gives null routes for a crawl with no start page, and nothing for an id the crawl does not hold', () => {
    setLinksScenario({ noStartPage: true });
    expect(routesTo(page('/pricing').id)).toMatchObject({ any: null, editorial: null });
    expect(routesTo('999999')).toBeNull();
  });
});
