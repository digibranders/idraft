import { describe, expect, it } from 'vitest';

import { changeOf, nameOf, sortRows } from './breakdown';
import type { BreakdownRow, PageNumbers } from './types';

const numbers = (
  clicks: number,
  impressions: number,
  position: number | null = 5,
  ctr?: number | null,
): PageNumbers => ({
  clicks,
  impressions,
  ctr: ctr === undefined ? (impressions > 0 ? clicks / impressions : null) : ctr,
  position,
});

const row = (key: string, current: PageNumbers | null, previous: PageNumbers | null): BreakdownRow => ({
  key,
  current,
  previous,
});

describe('changeOf', () => {
  it('is current minus previous for the counts', () => {
    const one = row('a', numbers(120, 4000), numbers(100, 5000));
    expect(changeOf(one, 'clicks')).toBe(20);
    expect(changeOf(one, 'impressions')).toBe(-1000);
  });

  it('is the difference of the rates for CTR, as a ratio the points formatter reads', () => {
    const one = row('a', numbers(30, 1000), numbers(10, 1000));
    expect(changeOf(one, 'ctr')).toBeCloseTo(0.02, 10);
  });

  it('is previous minus current for the position, so a positive number is an improvement', () => {
    expect(changeOf(row('a', numbers(1, 1, 3.5), numbers(1, 1, 5)), 'position')).toBe(1.5);
    expect(changeOf(row('a', numbers(1, 1, 6), numbers(1, 1, 5)), 'position')).toBe(-1);
  });

  it('is null when either side is missing', () => {
    expect(changeOf(row('a', numbers(1, 1), null), 'clicks')).toBeNull();
    expect(changeOf(row('a', null, numbers(1, 1)), 'impressions')).toBeNull();
    expect(changeOf(row('a', numbers(1, 1, null), numbers(1, 1, 4)), 'position')).toBeNull();
    expect(changeOf(row('a', numbers(0, 0, null, null), numbers(1, 10)), 'ctr')).toBeNull();
  });
});

describe('sortRows', () => {
  it('orders by the size of the change, biggest first, whatever its sign', () => {
    const rows = [
      row('small', numbers(105, 1), numbers(100, 1)),
      row('fell', numbers(10, 1), numbers(90, 1)),
      row('grew', numbers(150, 1), numbers(100, 1)),
    ];
    expect(sortRows(rows, 'clicks').map((one) => one.key)).toEqual(['fell', 'grew', 'small']);
  });

  it('puts rows without a change last, and breaks ties by current clicks', () => {
    const rows = [
      row('new', numbers(40, 1), null),
      row('tie-low', numbers(20, 1), numbers(10, 1)),
      row('gone', null, numbers(9, 1)),
      row('tie-high', numbers(60, 1), numbers(50, 1)),
    ];
    expect(sortRows(rows, 'clicks').map((one) => one.key)).toEqual(['tie-high', 'tie-low', 'new', 'gone']);
  });

  it('does not change the list it is given', () => {
    const rows = [row('b', numbers(1, 1), numbers(5, 1)), row('a', numbers(9, 1), numbers(1, 1))];
    sortRows(rows, 'clicks');
    expect(rows.map((one) => one.key)).toEqual(['b', 'a']);
  });
});

describe('nameOf', () => {
  it('shows a query as it is', () => {
    expect(nameOf('query', 'seo audit', 'en')).toEqual({ kind: 'text', text: 'seo audit' });
    expect(nameOf('query', 'IND', 'en')).toEqual({ kind: 'text', text: 'IND' });
  });

  it('names a country from the three-letter code the API sends, in any case', () => {
    expect(nameOf('country', 'IND', 'en')).toEqual({ kind: 'text', text: 'India' });
    expect(nameOf('country', 'gbr', 'en')).toEqual({ kind: 'text', text: 'United Kingdom' });
    expect(nameOf('country', 'XKK', 'en')).toEqual({ kind: 'text', text: 'Kosovo' });
    expect(nameOf('country', 'DEU', 'de')).toEqual({ kind: 'text', text: 'Deutschland' });
  });

  it('points the unknown region and a code that is no country at the unknown location message', () => {
    expect(nameOf('country', 'ZZZ', 'en')).toEqual({ kind: 'message', key: 'unknownLocation' });
    expect(nameOf('country', 'QQQ', 'en')).toEqual({ kind: 'message', key: 'unknownLocation' });
  });

  it('points a device at its message key', () => {
    expect(nameOf('device', 'MOBILE', 'en')).toEqual({ kind: 'message', key: 'devices.mobile' });
    expect(nameOf('device', 'DESKTOP', 'en')).toEqual({ kind: 'message', key: 'devices.desktop' });
    expect(nameOf('device', 'tablet', 'en')).toEqual({ kind: 'message', key: 'devices.tablet' });
  });

  it('shows a device the catalog does not know as it came', () => {
    expect(nameOf('device', 'WATCH', 'en')).toEqual({ kind: 'text', text: 'WATCH' });
  });
});
