import { describe, expect, it } from 'vitest';

import { stripQueries } from './strip-queries';
import type { KeywordFilters } from '../rankings-queries';

const base: KeywordFilters = { 'filter[is_active]': true, 'filter[device]': 'mobile' };

describe('stripQueries', () => {
  it('counts ranked, beyond, top 3, top 10 and top 20 under the list filters', () => {
    expect(stripQueries(base)).toEqual({
      ranked: { ...base, 'filter[rank_is_null]': false },
      beyond: { ...base, 'filter[rank_is_null]': true },
      top3: { ...base, 'filter[rank_lte]': 3 },
      top10: { ...base, 'filter[rank_lte]': 10 },
      top20: { ...base, 'filter[rank_lte]': 20 },
    });
  });

  it('intersects a chosen rank bucket with each top count, and knows an empty one without asking', () => {
    const bucket: KeywordFilters = { ...base, 'filter[rank_gte]': 4, 'filter[rank_lte]': 10 };
    const queries = stripQueries(bucket);
    expect(queries.top3).toBeNull();
    expect(queries.top10).toEqual({ ...bucket, 'filter[rank_lte]': 10 });
    expect(queries.top20).toEqual({ ...bucket, 'filter[rank_lte]': 10 });
    // A ranked range excludes every keyword beyond the depth
    expect(queries.beyond).toBeNull();
  });

  it('has no ranked keywords to count under the beyond depth chip', () => {
    const queries = stripQueries({ ...base, 'filter[rank_is_null]': true });
    expect(queries.ranked).toBeNull();
    expect(queries.top3).toBeNull();
    expect(queries.top10).toBeNull();
    expect(queries.top20).toBeNull();
    expect(queries.beyond).toEqual({ ...base, 'filter[rank_is_null]': true });
  });
});
