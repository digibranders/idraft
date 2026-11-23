import { describe, expect, it } from 'vitest';

import {
  changeLinks,
  changeLinksCsv,
  changesSummary,
  hasGenericAnchors,
  lostLinksTopIds,
  movedPages,
  pageChangeOf,
  pageDelta,
  pageDetailExtras,
  pageExtras,
  worklistCounts,
} from './internal-links-changes-world';
import {
  alertSettingsOf,
  changeSettings,
  crawledPages,
  EVENTUS,
  HISTORY_RUN_IDS,
  runViewOf,
  setLinksScenario,
  worklists,
  type RunView,
} from './internal-links-world';

const T0 = Date.parse('2026-11-18T09:00:00Z');
const P = EVENTUS.project_id;
const viewAt = (rank: number): RunView => {
  const view = runViewOf(P, rank === 0 ? null : (HISTORY_RUN_IDS[rank] ?? null), T0);
  if (view === null) throw new Error(`no crawl at rank ${String(rank)}`);
  return view;
};
const page = (path: string) => {
  const found = crawledPages().find((candidate) => candidate.path === path);
  if (found === undefined) throw new Error(`no page ${path}`);
  return found;
};
const BASE = { change: 'lost', linkScope: 'editorial', only: 'all', offset: 0, limit: 50 } as const;

describe('the crawl history of the mock', () => {
  it('has five weekly crawls, the newest four with their links', () => {
    expect(viewAt(0).run.run_id).toBe(HISTORY_RUN_IDS[0]);
    expect([0, 1, 2, 3, 4].map((rank) => viewAt(rank).run.links_available)).toEqual([true, true, true, true, false]);
    expect(viewAt(1).run.previous_run_id).toBe(HISTORY_RUN_IDS[2]);
    expect(viewAt(4).run.previous_run_id).toBeNull();
  });

  it('knows no crawl that is not in the history', () => {
    expect(runViewOf(P, '0192e4a0-1000-7000-8000-0000000000ff', T0)).toBeNull();
  });
});

describe('what the latest crawl changed', () => {
  it('is ready, with links lost to important pages and the alert for them', () => {
    const summary = changesSummary(P, viewAt(0), T0);
    expect(summary).toMatchObject({ state: 'ready', previous_run_id: HISTORY_RUN_IDS[1], important_max_position: 2 });
    expect(summary).toMatchObject({ editorial_lost: 6, all_lost: 5, editorial_added: 2, all_added: 2, lost_to_top: 5 });
    expect(summary.alert).toEqual({
      lost_links: 5,
      max_position: 2,
      threshold: 1,
      channel: 'app',
      delivery_state: 'shown_in_app',
    });
    expect(summary.previous_finished_at).toBe('2026-11-07T03:12:00.000Z');
  });

  it('follows the alert rules: a higher threshold, a narrower tier set, and off', () => {
    changeSettings(P, { alerts: { threshold: 6 } });
    expect(changesSummary(P, viewAt(0), T0).alert).toBeNull();
    changeSettings(P, { alerts: { threshold: 1, max_position: 1 } });
    expect(changesSummary(P, viewAt(0), T0)).toMatchObject({ lost_to_top: 4, important_max_position: 1 });
    changeSettings(P, { alerts: { enabled: false } });
    expect(changesSummary(P, viewAt(0), T0).alert).toBeNull();
    expect(alertSettingsOf(P)).toEqual({ enabled: false, max_position: 1, threshold: 1, channel: 'app' });
  });

  it('says pending while enrichment runs, unavailable when it failed, and first_crawl without a previous crawl', () => {
    setLinksScenario({ enrich: 'running' });
    expect(changesSummary(P, viewAt(0), T0)).toMatchObject({ state: 'pending', editorial_lost: 0, alert: null });
    setLinksScenario({ enrich: 'failed' });
    expect(changesSummary(P, viewAt(0), T0).state).toBe('unavailable');
    setLinksScenario({ enrich: 'done', firstCrawl: true });
    expect(changesSummary(P, viewAt(0), T0)).toMatchObject({
      state: 'first_crawl',
      previous_run_id: null,
      previous_finished_at: null,
      editorial_lost: 0,
      alert: null,
    });
    expect(changesSummary(P, viewAt(4), T0).state).toBe('first_crawl');
  });

  it('says the links were not compared when the previous crawl, or this one, lost its links', () => {
    expect([0, 1, 2, 3, 4].map((rank) => changesSummary(P, viewAt(rank), T0).links_compared)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    setLinksScenario({ latestLinksDropped: true });
    expect(changesSummary(P, viewAt(0), T0).links_compared).toBe(false);
  });

  it('has fewer changes on the crawl before, and none when the switch says so', () => {
    expect(changesSummary(P, viewAt(1), T0)).toMatchObject({ state: 'ready', editorial_lost: 2, editorial_added: 1 });
    expect(changesSummary(P, viewAt(2), T0)).toMatchObject({ state: 'ready', editorial_lost: 0, alert: null });
    setLinksScenario({ noChanges: true });
    expect(changesSummary(P, viewAt(0), T0)).toMatchObject({ state: 'ready', editorial_lost: 0, pages_added: 0 });
  });
});

describe('lost and added links', () => {
  it('lists the lost ones with the most important targets first, and the priority from the tiers of today', () => {
    const { data, meta } = changeLinks(P, viewAt(0), BASE);
    expect(data.map((row) => row.target.tier?.code)).toEqual(['T1', 'T1', 'T1', 'T1', 'T2', 'T3']);
    expect(data.map((row) => row.priority)).toEqual([
      'lost_to_t1',
      'lost_to_t1',
      'lost_to_t1',
      'lost_to_t1',
      'lost_to_t2',
      'lower',
    ]);
    expect(meta).toMatchObject({ change: 'lost', link_scope: 'editorial', only: 'all', total: 6, truncated: false });
    expect(meta.run_id).toBe(HISTORY_RUN_IDS[0]);
  });

  it('keeps only links lost to the important tiers with only=top, and follows the alert tier set', () => {
    expect(changeLinks(P, viewAt(0), { ...BASE, only: 'top' }).meta.total).toBe(5);
    changeSettings(P, { alerts: { max_position: 1 } });
    const top = changeLinks(P, viewAt(0), { ...BASE, only: 'top' });
    expect(top.data.every((row) => row.target.tier?.code === 'T1')).toBe(true);
    expect(top.meta.total).toBe(4);
  });

  it('shows the placement still linking the pair, and drops those from the all-links scope', () => {
    const editorial = changeLinks(P, viewAt(0), BASE).data;
    expect(editorial.flatMap((row) => (row.still_linked_by === null ? [] : [row.still_linked_by]))).toEqual([
      'navigation',
    ]);
    const all = changeLinks(P, viewAt(0), { ...BASE, linkScope: 'all' });
    expect(all.data.every((row) => row.still_linked_by === null)).toBe(true);
    expect(all.meta.total).toBe(5);
  });

  it('lists the added links with no priority, and pages the list by offset and limit', () => {
    const added = changeLinks(P, viewAt(0), { ...BASE, change: 'added' });
    expect(added.data).toHaveLength(2);
    expect(new Set(added.data.map((row) => row.priority))).toEqual(new Set(['none']));
    const second = changeLinks(P, viewAt(0), { ...BASE, offset: 2, limit: 2 });
    expect(second.data).toHaveLength(2);
    expect(second.meta.total).toBe(6);
  });

  it('writes the CSV the server writes', () => {
    const rows = changeLinksCsv(P, viewAt(0), BASE);
    expect(rows[0]).toEqual(['Change', 'Source', 'Target', 'Anchor', 'Link type', 'Target tier', 'Still linked from']);
    expect(rows.map((row) => row[5])).toEqual(['Target tier', 'T1', 'T1', 'T1', 'T1', 'T2', 'T3']);
    expect(rows.slice(1).map((row) => row[0])).toEqual(Array<string>(6).fill('Lost'));
    expect(rows.map((row) => row[6])).toContain('Navigation');
  });

  it('has nothing to list for a crawl without a previous one', () => {
    expect(changeLinks(P, viewAt(4), BASE).data).toEqual([]);
  });
});

describe('moved pages and the change of one page', () => {
  it('lists the pages whose editorial links in or depth moved most, capped', () => {
    const moved = movedPages(viewAt(0), 3);
    expect(moved.data).toHaveLength(3);
    expect(moved.meta).toEqual({ run_id: HISTORY_RUN_IDS[0], previous_run_id: HISTORY_RUN_IDS[1] });
    const all = movedPages(viewAt(0), 50).data;
    expect(all).toHaveLength(8);
    expect(all[0]?.page.path).toBe('/services/vapt');
    expect(all.some((row) => row.depth_state === 'lost')).toBe(true);
    // The change of equity is not computed in the mock: never an invented figure
    expect(all.every((row) => row.equity_points === null)).toBe(true);
  });

  it('gives each page its change: the delta of links in, a new page, and zeros for a page that did not move', () => {
    expect(pageChangeOf(viewAt(0), page('/pricing'))).toMatchObject({ is_new: false, editorial_in_delta: -1 });
    expect(pageChangeOf(viewAt(0), page('/compare/eventus-vs-in-house-soc'))).toMatchObject({ is_new: true });
    expect(pageChangeOf(viewAt(0), page('/about'))).toEqual({
      is_new: false,
      editorial_in_delta: 0,
      equity_points: null,
      depth_state: null,
      depth_delta: 0,
    });
    expect(pageDelta(viewAt(0), page('/services/vapt'))).toBe(1);
  });

  it('knows nothing of a page change before the crawl was compared', () => {
    setLinksScenario({ firstCrawl: true });
    expect(pageChangeOf(viewAt(0), page('/pricing'))).toBeNull();
    setLinksScenario({ firstCrawl: false, enrich: 'running' });
    expect(pageChangeOf(viewAt(0), page('/pricing'))).toBeNull();
  });
});

describe('page extras', () => {
  it('adds only the parts asked for', () => {
    const extras = pageExtras(viewAt(0), page('/services/soc-as-a-service'), ['keywords', 'citations']);
    expect(Object.keys(extras).sort()).toEqual(['citations', 'keywords']);
    expect(extras.keywords).toEqual({ tracked: 3, ranking: 2, average_rank: 6.5, best_volume: 1900 });
    expect(extras.citations).toEqual({ chatgpt: 5, gemini: 3, ai_mode: 2, total: 10 });
  });

  it('counts a page with no keyword or citation as zeros, never nothing', () => {
    const extras = pageExtras(viewAt(0), page('/about'), ['keywords', 'citations']);
    expect(extras.keywords).toEqual({ tracked: 0, ranking: 0, average_rank: null, best_volume: null });
    expect(extras.citations).toEqual({ chatgpt: 0, gemini: 0, ai_mode: 0, total: 0 });
  });

  it('counts anchors from the editorial links in, with the generic ones and the keyword match', () => {
    const contact = pageExtras(viewAt(0), page('/contact'), ['anchors']).anchors;
    expect(contact).toMatchObject({ total: 3, distinct: 3, generic: 2, matches_keyword: null });
    expect(contact?.generic_share).toBeCloseTo(2 / 3);
    expect(pageExtras(viewAt(0), page('/services/soc-as-a-service'), ['anchors']).anchors?.matches_keyword).toBe(true);
    expect(pageExtras(viewAt(0), page('/partners'), ['anchors']).anchors).toEqual({
      total: 0,
      distinct: 0,
      generic: 0,
      generic_share: 0,
      matches_keyword: null,
    });
  });

  it('flags a page whose editorial anchors are mostly generic', () => {
    expect(hasGenericAnchors(page('/contact'))).toBe(true);
    expect(hasGenericAnchors(page('/services/soc-as-a-service'))).toBe(false);
    expect(hasGenericAnchors(page('/partners'))).toBe(false);
  });

  it('has Search Console clicks when it is ok, none yet when pending, and none when not connected', () => {
    expect(pageExtras(viewAt(0), page('/'), ['gsc']).gsc).toMatchObject({
      state: 'ok',
      clicks: 3100,
      window_end: '2026-11-14',
    });
    expect(pageExtras(viewAt(0), page('/about'), ['gsc']).gsc).toMatchObject({
      state: 'ok',
      clicks: 0,
      impressions: 0,
    });
    setLinksScenario({ gsc: 'pending' });
    expect(pageExtras(viewAt(0), page('/'), ['gsc']).gsc).toEqual({
      state: 'pending',
      clicks: null,
      impressions: null,
      window_start: null,
      window_end: null,
    });
    setLinksScenario({ gsc: 'not_connected' });
    expect(pageExtras(viewAt(0), page('/'), ['gsc']).gsc?.state).toBe('not_connected');
  });

  it('keeps no anchor list for a crawl whose links were dropped', () => {
    expect(pageExtras(viewAt(4), page('/contact'), ['anchors']).anchors).toBeNull();
    expect(pageDetailExtras(viewAt(4), page('/contact')).anchors).toEqual({
      total: 3,
      distinct: null,
      generic: 2,
      generic_share: 2 / 3,
      matches_keyword: null,
      top: null,
    });
  });

  it('answers the detail with every part, keywords sorted by rank', () => {
    const detail = pageDetailExtras(viewAt(0), page('/services/soc-as-a-service'));
    expect(detail.keywords.map((row) => row.keyword)).toEqual([
      'soc as a service',
      'managed soc',
      'soc service provider',
    ]);
    expect(detail.anchors.top?.[0]).toEqual({ text: 'SOC as a service', count: 5, generic: false });
    expect(detail.gsc.state).toBe('ok');
    expect(detail.change).not.toBeNull();
  });
});

describe('the worklists that need the history', () => {
  it('counts the pages that lost a link while in an important tier, and the weak linkers', () => {
    expect(worklistCounts(P, viewAt(0), worklists())).toMatchObject({ lost_links_top: 5, weak_outlinks: 1 });
    expect([...lostLinksTopIds(P, viewAt(0))].sort()).toEqual(['102', '103', '104', '108', '109']);
  });

  it('counts none of the counts that come from the links on a crawl without links', () => {
    const latest = worklistCounts(P, viewAt(0), worklists());
    expect(latest.broken_and_redirected).toBeGreaterThan(0);
    expect(latest.links_to_non_indexable).toBeGreaterThan(0);
    const dropped = worklistCounts(P, viewAt(4), worklists());
    expect(dropped).toMatchObject({ weak_outlinks: 0, broken_and_redirected: 0, links_to_non_indexable: 0 });
    // The counts of the pages stay
    expect(dropped.orphans).toBe(latest.orphans);
    expect(dropped.run_id).toBe(HISTORY_RUN_IDS[4]);
  });
});
