import { describe, expect, it } from 'vitest';

import { effectiveSort } from './sort-fallback';
import type { SortKey } from '@/lib/tables/table-state';

const SORT: readonly SortKey[] = [{ id: 'mention', desc: true }];
const FALLBACK: readonly SortKey[] = [{ id: 'prompt', desc: false }];

describe('effectiveSort', () => {
  it('keeps the sort while its columns are shown', () => {
    expect(effectiveSort(SORT, FALLBACK, ['prompt', 'mention'])).toBe(SORT);
  });

  it('answers the fallback while a column of the sort is not shown', () => {
    expect(effectiveSort(SORT, FALLBACK, ['prompt'])).toBe(FALLBACK);
    expect(effectiveSort([...SORT, { id: 'prompt', desc: false }], FALLBACK, ['prompt'])).toBe(FALLBACK);
  });

  it('keeps the sort when there is no fallback', () => {
    expect(effectiveSort(SORT, undefined, ['prompt'])).toBe(SORT);
  });
});
