import { describe, expect, it } from 'vitest';

import {
  cannibalizationParts,
  cannibalizationSortValue,
  csvOf,
  healthCounts,
  queriesChange,
  queriesSortValue,
  showCannibalization,
  visibleRows,
  type CsvWords,
} from './monitoring-rows';
import type { PageCannibalization, PageHealth, PageNumbers, PageQueries, TrackedPageRow } from '../types';
import { MINUS } from '@/lib/format';

const numbers = (clicks: number, impressions: number, position: number | null = 5): PageNumbers => ({
  clicks,
  impressions,
  ctr: impressions === 0 ? null : clicks / impressions,
  position,
});

const health = (verdict: PageHealth['verdict']): PageHealth => ({
  verdict,
  basis: 'clicks',
  change: null,
  absolute: 0,
  small: false,
  flags: [],
});

function row(path: string, patch: Partial<TrackedPageRow> = {}): TrackedPageRow {
  return {
    url_id: path,
    url: `https://example.com${path}`,
    path,
    title: null,
    tier_id: null,
    added_at: '2026-11-01T00:00:00Z',
    history: 'ready',
    current: numbers(10, 100),
    previous: numbers(8, 100),
    health: health('stable'),
    queries: null,
    cannibalization: null,
    trend: [1, 2, 3],
    ...patch,
  };
}

const none = { tier: '', health: '', search: '' };

describe('visibleRows', () => {
  const rows = [
    row('/pricing', { title: 'Plans and Pricing', tier_id: 't1', health: health('declining') }),
    row('/blog/seo', { tier_id: 't2', health: health('growing') }),
    row('/about', { tier_id: null, health: health('declining') }),
    row('/loading', { tier_id: 't1', health: null, current: null, history: 'loading' }),
  ];
  const paths = (found: TrackedPageRow[]): string[] => found.map((one) => one.path);

  it('keeps every row when nothing is chosen', () => {
    expect(paths(visibleRows(rows, none))).toEqual(['/pricing', '/blog/seo', '/about', '/loading']);
  });

  it('matches a tier, and none for the pages without one', () => {
    expect(paths(visibleRows(rows, { ...none, tier: 't1' }))).toEqual(['/pricing', '/loading']);
    expect(paths(visibleRows(rows, { ...none, tier: 'none' }))).toEqual(['/about']);
  });

  it('matches a verdict, and lets a row without health pass only an empty filter', () => {
    expect(paths(visibleRows(rows, { ...none, health: 'declining' }))).toEqual(['/pricing', '/about']);
    expect(paths(visibleRows(rows, none))).toContain('/loading');
    expect(paths(visibleRows(rows, { ...none, health: 'growing' }))).not.toContain('/loading');
  });

  it('searches the path and the title, ignoring case', () => {
    expect(paths(visibleRows(rows, { ...none, search: 'PLANS' }))).toEqual(['/pricing']);
    expect(paths(visibleRows(rows, { ...none, search: 'blog' }))).toEqual(['/blog/seo']);
  });
});

describe('healthCounts', () => {
  const rows = [
    row('/a', { tier_id: 't1', health: health('declining') }),
    row('/b', { tier_id: 't1', health: health('lost') }),
    row('/c', { tier_id: 't2', health: health('declining') }),
    row('/d', { tier_id: 't1', health: null, history: 'loading' }),
    row('/e', { tier_id: 't1', title: 'special', health: health('growing') }),
  ];

  it('counts in the order of the filter and leaves out verdicts with none and rows without health', () => {
    expect(healthCounts(rows, { tier: '', search: '' })).toEqual([
      { verdict: 'lost', count: 1 },
      { verdict: 'declining', count: 2 },
      { verdict: 'growing', count: 1 },
    ]);
  });

  it('follows the tier and the search but never the health filter', () => {
    expect(healthCounts(rows, { tier: 't1', search: '' })).toEqual([
      { verdict: 'lost', count: 1 },
      { verdict: 'declining', count: 1 },
      { verdict: 'growing', count: 1 },
    ]);
    expect(healthCounts(rows, { tier: '', search: 'special' })).toEqual([{ verdict: 'growing', count: 1 }]);
  });
});

describe('queriesChange', () => {
  const queries = (value: number, previous: number | null, capped = false): PageQueries => ({
    value,
    previous,
    capped,
  });

  it.each<[string, PageQueries | null, { delta: number; text: string; tone: 'positive' | 'negative' } | null]>([
    ['grew', queries(1240, 1105), { delta: 135, text: '+135', tone: 'positive' }],
    ['fell', queries(12, 17), { delta: -5, text: `${MINUS}5`, tone: 'negative' }],
    ['equal', queries(12, 12), null],
    ['no previous', queries(12, null), null],
    ['capped', queries(25_000, 24_000, true), null],
    ['no count', null, null],
  ])('is right when it %s', (_name, input, expected) => {
    expect(queriesChange(input)).toEqual(expected);
  });

  it('sorts by the value, and rows without one last', () => {
    expect(queriesSortValue(row('/a', { queries: queries(7, null) }))).toBe(7);
    expect(queriesSortValue(row('/b', { queries: null }))).toBeNull();
  });
});

describe('cannibalization', () => {
  const filled = (keywords: number, likely: number, co_ranking: number, unstable: number): PageCannibalization => ({
    keywords,
    likely,
    co_ranking,
    unstable,
  });

  it('is drawn only when some row has it', () => {
    expect(showCannibalization([row('/a'), row('/b')])).toBe(false);
    expect(showCannibalization([row('/a'), row('/b', { cannibalization: filled(0, 0, 0, 0) })])).toBe(true);
  });

  it('sorts by likely first, then the keywords, and rows without it last', () => {
    expect(cannibalizationSortValue(row('/a', { cannibalization: filled(3, 1, 1, 1) }))).toBe(103);
    expect(cannibalizationSortValue(row('/b', { cannibalization: filled(4, 0, 4, 0) }))).toBe(4);
    expect(cannibalizationSortValue(row('/c'))).toBeNull();
  });

  it('lists the parts above zero in a fixed order', () => {
    expect(cannibalizationParts(filled(3, 1, 1, 1))).toEqual([
      [1, 'likely'],
      [1, 'coRanking'],
      [1, 'unstable'],
    ]);
    expect(cannibalizationParts(filled(1, 0, 1, 0))).toEqual([[1, 'coRanking']]);
    expect(cannibalizationParts(filled(0, 0, 0, 0))).toEqual([]);
  });
});

describe('csvOf', () => {
  const words: CsvWords = {
    headers: {
      page: 'Page',
      tier: 'Tier',
      health: 'Health',
      clicks: 'Clicks',
      clicksBefore: 'Clicks before',
      impressions: 'Impressions',
      impressionsBefore: 'Impressions before',
      ctr: 'CTR',
      ctrBefore: 'CTR before',
      position: 'Average position',
      positionBefore: 'Average position before',
      queries: 'Queries',
      queriesBefore: 'Queries before',
      cannibalizationKeywords: 'Cannibalization keywords',
      likely: 'Likely',
      coRanking: 'Co-ranking',
      unstable: 'Unstable',
    },
    tier: (tierId) => (tierId === null ? 'Untiered' : 'T1'),
    health: (verdict) => (verdict === 'declining' ? 'Declining' : verdict),
  };
  const full = row('/pricing', {
    tier_id: 't1',
    health: health('declining'),
    current: numbers(317, 41_200, 5.94),
    previous: numbers(412, 39_000, 3.8),
    queries: { value: 1240, previous: 1105, capped: false },
  });

  it('writes the header and one line of raw numbers per row', () => {
    const table = csvOf([full], words);
    expect(table.header).toEqual([
      'Page',
      'Tier',
      'Health',
      'Clicks',
      'Clicks before',
      'Impressions',
      'Impressions before',
      'CTR',
      'CTR before',
      'Average position',
      'Average position before',
      'Queries',
      'Queries before',
    ]);
    expect(table.rows).toEqual([
      ['/pricing', 'T1', 'Declining', 317, 412, 41_200, 39_000, 0.0077, 0.0106, 5.9, 3.8, 1240, 1105],
    ]);
  });

  it('leaves a cell empty when the number is missing', () => {
    const loading = row('/new', { current: null, previous: null, health: null, queries: null });
    expect(csvOf([loading], words).rows).toEqual([
      ['/new', 'Untiered', null, null, null, null, null, null, null, null, null, null, null],
    ]);
  });

  it('writes a capped count with a plus and the real count before', () => {
    const capped = row('/big', { queries: { value: 25_000, previous: 24_000, capped: true } });
    const [line] = csvOf([capped], words).rows;
    expect(line?.slice(-2)).toEqual(['25000+', 24_000]);
  });

  it('adds the Cannibalization columns only when some row has them', () => {
    const filled = row('/c', { cannibalization: { keywords: 3, likely: 1, co_ranking: 1, unstable: 1 } });
    const withIt = csvOf([full, filled], words);
    expect(withIt.header.slice(-4)).toEqual(['Cannibalization keywords', 'Likely', 'Co-ranking', 'Unstable']);
    expect(withIt.rows[0]?.slice(-4)).toEqual([null, null, null, null]);
    expect(withIt.rows[1]?.slice(-4)).toEqual([3, 1, 1, 1]);
    expect(csvOf([full], words).header).not.toContain('Likely');
  });
});
