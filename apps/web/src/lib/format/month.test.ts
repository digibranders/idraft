import { describe, expect, it } from 'vitest';

import { monthDays, monthInstants, monthLabel, parseMonth, recentMonths } from './month';

const now = new Date('2026-10-05T12:00:00Z');

describe('months', () => {
  it('lists this month and the 11 before it, newest first', () => {
    const months = recentMonths(now);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-10');
    expect(months[11]).toBe('2025-11');
  });

  it('counts the months in UTC when the local day is already the next month', () => {
    expect(recentMonths(new Date('2026-10-31T23:59:59Z'), 2)).toEqual(['2026-10', '2026-09']);
    expect(recentMonths(new Date('2027-01-01T00:00:00Z'), 2)).toEqual(['2027-01', '2026-12']);
  });

  it('reads a month key, or null', () => {
    expect(parseMonth('2026-09')).toBe('2026-09');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('1999-01')).toBeNull();
    expect(parseMonth('2026-9')).toBeNull();
    expect(parseMonth('2026-09-01')).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });

  it('labels a month', () => {
    expect(monthLabel('2026-09', 'en')).toBe('September 2026');
  });

  it('gives the UTC days a cost query takes, stopping at today', () => {
    expect(monthDays('2026-09', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthDays('2026-10', now)).toEqual({ from: '2026-10-01', to: '2026-10-05' });
  });

  it('ends on the last day of a short or a leap month, and on today when today is the first', () => {
    const later = new Date('2030-01-01T00:00:00Z');
    expect(monthDays('2028-02', later)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthDays('2026-02', later)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthDays('2026-10', new Date('2026-10-01T00:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(monthDays('2026-10', new Date('2026-10-31T23:59:59Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('gives the instants a run query takes, the end exclusive', () => {
    expect(monthInstants('2026-12')).toEqual({ from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z' });
    expect(monthInstants('2026-02')).toEqual({ from: '2026-02-01T00:00:00Z', to: '2026-03-01T00:00:00Z' });
  });
});
