import { describe, expect, it } from 'vitest';

import { bucketCounts, bucketOf, keywordTable } from './seo-model';

const rank = (value: number | null): { rank: number | null } => ({ rank: value });
const kw = (id: string, own: number | null, others: Record<string, number | null>): never =>
  ({
    tracked_keyword_id: id,
    keyword: { normalized_text: `kw ${id}` },
    state: { current: rank(own) },
    competitor_ranks: Object.entries(others).map(([name, value]) => ({
      entity: { entity_id: name, canonical_name: name },
      current: rank(value),
    })),
  }) as never;

const page = (data: never[], has_more = false): never => ({ data, page: { total: 250, has_more } }) as never;

describe('bucketOf', () => {
  it('places a rank in its band and an unranked keyword apart', () => {
    expect([1, 3, 4, 10, 11, 20, 21, 80].map(bucketOf)).toEqual([
      'top3',
      'top3',
      'top10',
      'top10',
      'top20',
      'top20',
      'beyond',
      'beyond',
    ]);
    expect(bucketOf(null)).toBe('none');
  });
});

describe('keywordTable', () => {
  const table = keywordTable(
    page([kw('1', 5, { a: 2, b: null }), kw('2', null, { a: 9, b: 30 }), kw('3', 1, { a: 4, b: 3 })], true),
  );
  it('lists the competitors by name and counts those ranked above the own brand', () => {
    expect(table.competitors.map((c) => c.id)).toEqual(['a', 'b']);
    expect(table.rows.map((r) => r.competitorsAhead)).toEqual([1, 2, 0]);
  });
  it('counts a keyword the own brand does not rank for as behind every ranked competitor', () => {
    expect(table.rows[1]?.ranks.get('own')).toBeNull();
  });
  it('names the competitor with most keywords in the top 10 and reports a truncated page', () => {
    expect(table.leader).toEqual({ name: 'a', topTen: 3 });
    expect(table.truncated).toBe(true);
    expect(table.total).toBe(250);
  });
  it('counts a distribution per entity', () => {
    expect(bucketCounts(table.rows, 'b')).toEqual({ top3: 1, top10: 0, top20: 0, beyond: 1, none: 1 });
  });
  it('averages the own rank over the keywords it ranks for only', () => {
    expect(table.ownAverage).toBeCloseTo(3);
    expect(keywordTable(page([kw('1', null, { a: 3 })])).ownAverage).toBeNull();
  });
  it('has no leader when no competitor is in the top 10', () => {
    expect(keywordTable(page([kw('1', 1, { a: 40 })])).leader).toBeUndefined();
  });
});
