import { describe, expect, it } from 'vitest';

import {
  countChange,
  filterKeywords,
  filterSwitches,
  filterSwitchKeywords,
  pageToken,
  pagesColumnWidth,
  parseCann,
  shownPages,
  stripFacts,
  switchCounts,
  writeCann,
} from './cann-model';
import type { CannKeyword, CannPage, CannSwitchRow } from '@/lib/api/types';
import { cannKeyword, cannPage } from '@/mocks/cannibalization-fixture';

const page = cannPage;
const keyword = cannKeyword;

const ROWS = [
  keyword('alpha', 'likely'),
  keyword('beta', 'co_ranking'),
  keyword('gamma', 'unstable'),
  keyword('delta', 'none'),
  keyword('epsilon', 'unranked'),
  keyword('zeta', 'insufficient'),
];

const names = (rows: readonly CannKeyword[]): string[] => rows.map((row) => row.keyword);
const filters = { show: 'conflicts', search: '', pair: '' } as const;

describe('parseCann and writeCann', () => {
  it('reads the defaults from an empty address and writes nothing back', () => {
    const state = parseCann({}, 'cannibalization');
    expect(state).toMatchObject({
      device: 'desktop',
      days: 30,
      view: 'keywords',
      show: 'conflicts',
      switchedOnly: true,
    });
    expect(Object.values(writeCann(state, 'cannibalization')).every((value) => value === null)).toBe(true);
  });

  it('opens Switching on Changes and keeps By keyword as the only other view', () => {
    expect(parseCann({}, 'switching').view).toBe('changes');
    expect(parseCann({ view: 'keywords' }, 'switching').view).toBe('keywords');
    expect(parseCann({ view: 'pairs' }, 'switching').view).toBe('changes');
    expect(writeCann(parseCann({ view: 'keywords' }, 'switching'), 'switching').view).toBe('keywords');
  });

  it('drops values that do not read: an unknown period, a group that is no id, a half pair', () => {
    const state = parseCann({ days: '45', group: 'seo', pair: 'a|', device: 'tablet' }, 'cannibalization');
    expect(state).toMatchObject({ days: 30, group: 'all', pair: '', device: 'desktop' });
  });

  it('round trips a scope', () => {
    const group = '0a1b2c3d-0000-4000-8000-123456789abc';
    const state = parseCann(
      { device: 'mobile', days: '90', group, show: 'likely', pair: 'a|b', switched: 'all' },
      'cannibalization',
    );
    expect(writeCann(state, 'cannibalization')).toMatchObject({
      device: 'mobile',
      days: '90',
      group,
      show: 'likely',
      pair: 'a|b',
      switched: 'all',
    });
  });
});

describe('filterKeywords', () => {
  it('shows the conflicts: likely, co-ranking and unstable', () => {
    expect(names(filterKeywords(ROWS, filters))).toEqual(['alpha', 'beta', 'gamma']);
  });
  it('shows every ranked keyword for All keywords, and one verdict for its chip', () => {
    expect(names(filterKeywords(ROWS, { ...filters, show: 'all' }))).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'zeta',
    ]);
    expect(names(filterKeywords(ROWS, { ...filters, show: 'unstable' }))).toEqual(['gamma']);
  });
  it('searches the keyword text without case', () => {
    expect(names(filterKeywords(ROWS, { ...filters, search: 'ALP' }))).toEqual(['alpha']);
  });
  it('keeps the keywords where both pages of a pair ranked enough checks', () => {
    // page b ranked only twice on every row, so no keyword has both
    expect(filterKeywords(ROWS, { ...filters, pair: 'a|b' })).toEqual([]);
    const both = [keyword('both', 'likely', { pages: [page('a', 'A'), page('b', 'B', 5)] })];
    expect(names(filterKeywords(both, { ...filters, pair: 'a|b' }))).toEqual(['both']);
  });
});

describe('filterSwitchKeywords', () => {
  const event = {
    date: '2026-11-01',
    from_url_id: 'a',
    to_url_id: 'b',
    rank_before: 3,
    rank_after: 4,
    held_days: 5,
    is_flip_flop: false,
  };
  const rows = [keyword('moved', 'none', { switches: [event] }), keyword('still', 'none'), keyword('off', 'unranked')];
  it('keeps the keywords that switched, or every ranked one', () => {
    expect(names(filterSwitchKeywords(rows, { search: '', switchedOnly: true }))).toEqual(['moved']);
    expect(names(filterSwitchKeywords(rows, { search: '', switchedOnly: false }))).toEqual(['moved', 'still']);
  });
});

describe('the Changes filters', () => {
  const row = (name: string, patch: Partial<CannSwitchRow>, flip = false): CannSwitchRow => ({
    tracked_keyword_id: name,
    keyword: name,
    volume: 1,
    event: {
      date: '2026-11-01',
      from_url_id: 'a',
      to_url_id: 'b',
      rank_before: 5,
      rank_after: 4,
      held_days: 3,
      is_flip_flop: flip,
    },
    rank_change: 0,
    left_target: false,
    from_title: null,
    to_title: null,
    from_url: 'https://example.com/a',
    to_url: 'https://example.com/b',
    ...patch,
  });
  const rows = [
    row('up', { rank_change: 2 }),
    row('down', { rank_change: -3, left_target: true }),
    row('flop', {}, true),
  ];
  it('filters by what the new page did to the rank, flip-flops and the target', () => {
    const pick = (sw: Parameters<typeof filterSwitches>[1]['sw']): string[] =>
      filterSwitches(rows, { sw, search: '' }).map((entry) => entry.keyword);
    expect(pick('improved')).toEqual(['up']);
    expect(pick('dropped')).toEqual(['down']);
    expect(pick('flip_flop')).toEqual(['flop']);
    expect(pick('left_target')).toEqual(['down']);
    expect(pick('all')).toEqual(['up', 'down', 'flop']);
  });
  it('counts each chip over the rows the search leaves', () => {
    expect(switchCounts(rows, '')).toEqual({ all: 3, flip_flop: 1, improved: 1, dropped: 1, left_target: 1 });
    expect(switchCounts(rows, 'up')).toEqual({ all: 1, flip_flop: 0, improved: 1, dropped: 0, left_target: 0 });
  });
});

describe('countChange', () => {
  it('is a signed number against the period before', () => {
    expect(countChange({ value: 12, before: 9 }, true)).toEqual({ text: '+3', before: 9 });
    expect(countChange({ value: 4, before: 9 }, true)?.text).toBe('−5');
  });
  it('is nothing when unchanged, unknown, or the period before has no keyword with enough checks', () => {
    expect(countChange({ value: 4, before: 4 }, true)).toBeNull();
    expect(countChange({ value: 4, before: null }, true)).toBeNull();
    expect(countChange({ value: 4, before: 2 }, false)).toBeNull();
  });
});

describe('pages and strips', () => {
  it('colors the letters A to F and any other page with the shared color', () => {
    expect(pageToken('A')).toBe('chart-1');
    expect(pageToken('F')).toBe('chart-6');
    expect(pageToken('+')).toBe('chart-other');
    expect(pageToken('AB')).toBe('chart-other');
  });
  it('names the pages of a keyword that ranked on at least 3 checks', () => {
    expect(shownPages(keyword('k', 'likely')).map((entry) => entry.letter)).toEqual(['A']);
  });
  it('counts the checks per page and the switches for the text alternative', () => {
    const row = keyword('k', 'likely', {
      strip: [
        { date: '2026-11-01', kind: 'page', url_id: 'a', rank: 3, together: false },
        { date: '2026-11-02', kind: 'page', url_id: 'b', rank: 4, together: false },
        { date: '2026-11-03', kind: 'page', url_id: 'a', rank: 3, together: false },
        { date: '2026-11-04', kind: 'unreadable', url_id: null, rank: null, together: false },
      ],
    });
    expect(stripFacts(row)).toEqual({
      pages: [
        { letter: 'A', path: '/a', checks: 2 },
        { letter: 'B', path: '/b', checks: 1 },
      ],
      checks: 4,
      switches: 0,
    });
  });
});

describe('pagesColumnWidth', () => {
  const wide = (path: string): CannPage => ({ ...page('x', 'A'), path });
  it('is at least 176 and grows with the paths shown, up to 380', () => {
    expect(pagesColumnWidth([])).toBe(176);
    const some = keyword('k', 'likely', { pages: [wide('/a-longer-path-of-a-page'), page('b', 'B')] });
    expect(pagesColumnWidth([some])).toBeGreaterThan(176);
    const huge = keyword('k', 'likely', { pages: [wide('/'.padEnd(120, 'x')), wide('/'.padEnd(120, 'y'))] });
    expect(pagesColumnWidth([huge])).toBe(380);
  });
});
