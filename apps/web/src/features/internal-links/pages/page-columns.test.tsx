import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { keysOfSort, pageColumns, SORT_FIELD, sortOfKeys } from './page-columns';
import { PAGE_SORTS } from '../url-state';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'internalLinks' });
const columns = pageColumns(t, { tiers: [], scope: 'editorial', openJourney: () => undefined });

describe('the sort of the Pages table (decision W5)', () => {
  it('turns every sort the address takes into a column and back', () => {
    for (const sort of PAGE_SORTS) {
      expect(sortOfKeys(keysOfSort(sort))).toBe(sort);
    }
  });

  it('has no sort for a column the server cannot sort, nor for an empty choice', () => {
    expect(sortOfKeys([{ id: 'tier', desc: false }])).toBeNull();
    expect(sortOfKeys([])).toBeNull();
    expect(keysOfSort('-linking_pages')).toEqual([{ id: 'linking', desc: true }]);
  });

  it('sorts only the five columns the API sorts, and never by equity', () => {
    expect(Object.values(SORT_FIELD).sort()).toEqual([
      'click_depth',
      'linking_pages',
      'outlinks',
      'path',
      'status_code',
    ]);
    const sortable = columns.filter((column) => column.sortValue !== undefined).map((column) => column.id);
    expect(sortable.sort()).toEqual(Object.keys(SORT_FIELD).sort());
  });
});

describe('the Pages columns', () => {
  it('shows the slice 1 columns by default and keeps the rest in the chooser, with no equity column', () => {
    expect(columns.filter((column) => column.defaultVisible !== false).map((column) => column.id)).toEqual([
      'page',
      'tier',
      'status',
      'depth',
      'linking',
      'fromTiers',
      'outlinks',
      'flags',
    ]);
    expect(columns.some((column) => /equity/i.test(column.id) || /equity/i.test(column.header))).toBe(false);
  });
});
