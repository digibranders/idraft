import { describe, expect, it } from 'vitest';

import { changePage, changeRow } from './change-fixtures';
import { changeRows, newSourcesCount } from './changes-model';
import { at } from './source-fixtures';

describe('newSourcesCount', () => {
  it('is page.total, not the number of rows the route sent', () => {
    const page = changePage('new', [changeRow({ domain: 'a.com', now: 5 }), changeRow({ domain: 'b.com', now: 3 })], {
      total: 37,
    });
    expect(newSourcesCount(page, 5000)).toBe(37);
  });

  it('is null, not 0, when the window before has no answers', () => {
    expect(newSourcesCount(changePage('new', []), 0)).toBeNull();
  });

  it('is null when the answers of the window before are not known (missing or not read)', () => {
    const page = changePage('new', [changeRow({ domain: 'a.com', now: 5 })]);
    expect(newSourcesCount(page, null)).toBeNull();
    expect(newSourcesCount(page, undefined)).toBeNull();
  });

  it('is null while the page is not read', () => {
    expect(newSourcesCount(undefined, 5000)).toBeNull();
  });

  it('is a real 0 when the window before has answers and no domain is new', () => {
    expect(newSourcesCount(changePage('new', []), 5000)).toBe(0);
  });
});

describe('changeRows', () => {
  it('keeps the rows the route sent, in its order, none dropped for a low support and none added', () => {
    const page = changePage(
      'new',
      [
        changeRow({ domain: 'a.com', now: 9 }),
        changeRow({ domain: 'b.com', now: 1 }),
        changeRow({ domain: 'c.com', now: 4 }),
      ],
      { minSupport: 2 },
    );
    expect(changeRows(page, 'new').map((row) => row.domain)).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('draws a new domain by its units now and a lost one by its units before', () => {
    const fresh = changeRows(changePage('new', [changeRow({ domain: 'a.com', now: 9 })]), 'new');
    expect(at(fresh, 0)).toMatchObject({ units: 9, unitsNow: 9, unitsBefore: 0 });
    const gone = changeRows(changePage('lost', [changeRow({ domain: 'z.com', before: 6 })]), 'lost');
    expect(at(gone, 0)).toMatchObject({ units: 6, unitsNow: 0, unitsBefore: 6 });
  });

  it('flags the project own domain and keeps two roles of one domain as two rows', () => {
    const page = changePage('new', [
      changeRow({ domain: 'fynix.com', role: 'own', now: 4 }),
      changeRow({ domain: 'g2.com', role: 'third_party', now: 3 }),
      changeRow({ domain: 'g2.com', role: 'competitor', now: 2, entityId: 'e-2' }),
    ]);
    const rows = changeRows(page, 'new');
    expect(rows.map((row) => row.own)).toEqual([true, false, false]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });
});
