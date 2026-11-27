import { describe, expect, it } from 'vitest';

import { drawerTiles } from './drawer-tiles';
import type { IssueSeverity, PageIssue, Seam } from './issue-source';
import type { PageDetail } from '@/lib/internal-links/types';

const UNAVAILABLE: Seam<readonly PageIssue[]> = { state: 'unavailable' };

const issue = (severity: IssueSeverity, checkId: string): PageIssue => ({ checkId, severity, detail: null });

/** The parts of a page detail the tiles read. */
function detail(
  overrides: {
    gsc?: Partial<PageDetail['extras']['gsc']>;
    ranks?: (number | null)[];
    citations?: number;
    clickDepth?: number | null;
  } = {},
): PageDetail {
  return {
    page: {
      click_depth: overrides.clickDepth === undefined ? 2 : overrides.clickDepth,
      linking_pages: 5,
      linking_pages_all: 9,
      outlinks: 7,
      outlinks_all: 11,
    },
    extras: {
      gsc: { state: 'ok', clicks: 1240, impressions: 30500, window_start: null, window_end: null, ...overrides.gsc },
      keywords: (overrides.ranks ?? [4, 12]).map((rank, index) => ({
        keyword: `keyword ${String(index)}`,
        rank,
        change: null,
        rank_as_of: null,
        volume: null,
      })),
      citations: { chatgpt: 1, gemini: 0, ai_mode: 0, total: overrides.citations ?? 1 },
    },
  } as unknown as PageDetail;
}

const byId = (tiles: ReturnType<typeof drawerTiles>, id: string): ReturnType<typeof drawerTiles>[number] => {
  const tile = tiles.find((candidate) => candidate.id === id);
  if (tile === undefined) throw new Error(`No tile ${id}`);
  return tile;
};

describe('drawerTiles (spec 9.4)', () => {
  it('returns seven tiles in the order of the spec while the Issues seam is unavailable', () => {
    const tiles = drawerTiles(detail(), UNAVAILABLE);
    expect(tiles.map((tile) => tile.id)).toEqual([
      'clicks',
      'impressions',
      'keywords',
      'citations',
      'linksIn',
      'linksOut',
      'depth',
    ]);
    expect(tiles.map((tile) => tile.tab)).toEqual(['search', 'search', 'search', 'ai', 'links', 'links', 'links']);
  });

  it('adds the Issues tile eighth when the seam is ready, with the count of the most severe kind present', () => {
    const tiles = drawerTiles(detail(), {
      state: 'ready',
      data: [issue('notice', 'a'), issue('warning', 'b'), issue('warning', 'c'), issue('notice', 'd')],
    });
    expect(tiles).toHaveLength(8);
    expect(byId(tiles, 'issues')).toMatchObject({
      value: 2,
      state: 'ok',
      note: { kind: 'issues', severity: 'warning', count: 2 },
      tab: 'issues',
    });
  });

  it('says None found for a page with no issue, never a bare zero', () => {
    const tiles = drawerTiles(detail(), { state: 'ready', data: [] });
    expect(byId(tiles, 'issues')).toMatchObject({ state: 'ok', note: { kind: 'issuesNone' } });
  });

  it('keeps the Issues tile pending, with no value, while the seam loads', () => {
    expect(byId(drawerTiles(detail(), { state: 'loading' }), 'issues')).toMatchObject({
      value: null,
      state: 'pending',
    });
  });

  it('gives the Issues tile its own error state, with no value, when the seam has failed', () => {
    const tiles = drawerTiles(detail(), { state: 'error', retry: () => undefined });
    expect(byId(tiles, 'issues')).toMatchObject({ value: null, state: 'error' });
  });

  it('reads clicks and impressions from the Search Console state and never as 0 when it is not known', () => {
    const connected = drawerTiles(detail(), UNAVAILABLE);
    expect(byId(connected, 'clicks')).toMatchObject({ value: 1240, state: 'ok', note: { kind: 'last28' } });
    expect(byId(connected, 'impressions')).toMatchObject({ value: 30500, state: 'ok' });
    for (const state of ['not_connected', 'pending'] as const) {
      const tiles = drawerTiles(detail({ gsc: { state, clicks: null, impressions: null } }), UNAVAILABLE);
      expect(byId(tiles, 'clicks')).toMatchObject({ value: null, state });
      expect(byId(tiles, 'impressions')).toMatchObject({ value: null, state });
    }
  });

  it('counts the tracked keywords and notes the best rank, or none', () => {
    expect(byId(drawerTiles(detail({ ranks: [12, 4, null] }), UNAVAILABLE), 'keywords')).toMatchObject({
      value: 3,
      note: { kind: 'bestRank', rank: 4 },
    });
    expect(byId(drawerTiles(detail({ ranks: [null] }), UNAVAILABLE), 'keywords')).toMatchObject({
      value: 1,
      note: { kind: 'noRank' },
    });
    expect(byId(drawerTiles(detail({ ranks: [] }), UNAVAILABLE), 'keywords')).toMatchObject({
      value: 0,
      note: { kind: 'noRank' },
    });
  });

  it('takes the links from the page row with the count in all, and the AI citations from the total', () => {
    const tiles = drawerTiles(detail({ citations: 3 }), UNAVAILABLE);
    expect(byId(tiles, 'linksIn')).toMatchObject({ value: 5, note: { kind: 'links', all: 9 } });
    expect(byId(tiles, 'linksOut')).toMatchObject({ value: 7, note: { kind: 'links', all: 11 } });
    expect(byId(tiles, 'citations')).toMatchObject({ value: 3, note: { kind: 'last28' } });
  });

  it('marks the depth of a page no link reaches as unreachable', () => {
    expect(byId(drawerTiles(detail({ clickDepth: null }), UNAVAILABLE), 'depth')).toMatchObject({
      value: null,
      state: 'unreachable',
    });
    expect(byId(drawerTiles(detail({ clickDepth: 2 }), UNAVAILABLE), 'depth')).toMatchObject({
      value: 2,
      state: 'ok',
      note: { kind: 'depth' },
    });
  });
});
