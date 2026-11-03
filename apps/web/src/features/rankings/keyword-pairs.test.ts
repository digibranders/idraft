import { describe, expect, it } from 'vitest';

import { expandIds, memberIds, memberRows, pairRows } from './keyword-pairs';
import type { TrackedKeywordRow } from '@/lib/api/types';

/** Only what pairing reads of a row. */
const row = (
  id: string,
  keyword: string,
  device: 'desktop' | 'mobile',
  over: { location?: number; language?: string } = {},
): TrackedKeywordRow =>
  ({
    tracked_keyword_id: id,
    keyword: { keyword_id: `k-${keyword}`, text: keyword },
    device,
    location_id: over.location ?? 2356,
    language_code: over.language ?? 'en',
    search_engine: 'google',
  }) as unknown as TrackedKeywordRow;

const LIST = [
  row('a-d', 'seo agency', 'desktop'),
  row('b-m', 'seo audit', 'mobile'),
  row('a-m', 'seo agency', 'mobile'),
  row('c-d', 'seo services', 'desktop'),
  row('a-d-us', 'seo agency', 'desktop', { location: 2840 }),
];

describe('pairRows', () => {
  it('makes one row of the desktop and the mobile tracking of a keyword, in the order it first appears', () => {
    const paired = pairRows(LIST, 'both');

    expect(paired.map((r) => r.tracked_keyword_id)).toEqual(['a-d', 'b-m', 'c-d', 'a-d-us']);
    expect(paired[0]?.devices.desktop?.tracked_keyword_id).toBe('a-d');
    expect(paired[0]?.devices.mobile?.tracked_keyword_id).toBe('a-m');
    expect(paired[1]?.devices).toMatchObject({ desktop: null });
  });

  it('keeps one keyword in two places or two languages as two rows', () => {
    const paired = pairRows([...LIST, row('a-d-de', 'seo agency', 'desktop', { language: 'de' })], 'both');

    expect(paired.filter((r) => r.keyword.text === 'seo agency')).toHaveLength(3);
  });

  it('shows only the keywords tracked on the device chosen, with that device as the row', () => {
    expect(pairRows(LIST, 'desktop').map((r) => r.tracked_keyword_id)).toEqual(['a-d', 'c-d', 'a-d-us']);
    // The row of a pair on mobile is its mobile row, so volume, features and the state are the mobile ones
    expect(pairRows(LIST, 'mobile').map((r) => r.tracked_keyword_id)).toEqual(['a-m', 'b-m']);
  });

  it('shows a mobile-only keyword as its mobile row when both devices are chosen', () => {
    expect(pairRows(LIST, 'both')[1]).toMatchObject({ tracked_keyword_id: 'b-m', device: 'mobile' });
  });

  it('leaves out no row the API listed: a second row of one device is a row of its own', () => {
    const twice = [row('x1', 'crm', 'desktop'), row('x2', 'crm', 'desktop'), row('x3', 'crm', 'mobile')];

    const paired = pairRows(twice, 'both');

    expect(paired).toHaveLength(2);
    expect(
      memberRows(paired)
        .map((r) => r.tracked_keyword_id)
        .sort(),
    ).toEqual(['x1', 'x2', 'x3']);
  });
});

describe('expandIds', () => {
  it('adds the other device of every chosen keyword, and leaves a keyword on one device as it is', () => {
    const paired = pairRows(LIST, 'both');
    const members = memberIds(paired);

    expect([...expandIds(new Set(['a-d']), members)].sort()).toEqual(['a-d', 'a-m']);
    expect([...expandIds(new Set(['b-m', 'c-d']), members)].sort()).toEqual(['b-m', 'c-d']);
    // An id the table does not hold stays: it may be on a page not loaded
    expect([...expandIds(new Set(['far-away']), members)]).toEqual(['far-away']);
  });
});
