import { describe, expect, it } from 'vitest';

import { apiWindow, daysBetween, DEFAULT_WINDOW, windowDates, WINDOW_KEYS, WINDOWS } from './detail-window';

describe('detail window', () => {
  it('names the API window of each choice', () => {
    expect(apiWindow('7d')).toBe('last_7d');
    expect(apiWindow('30d')).toBe('last_30d');
    expect(apiWindow('90d')).toBe('last_90d');
    expect(apiWindow('180d')).toBe('last_180d');
    expect(apiWindow('365d')).toBe('last_365d');
  });

  it('defaults to 90 days and offers exactly the five windows the API takes', () => {
    expect(DEFAULT_WINDOW).toBe('90d');
    expect(Object.keys(WINDOWS)).toEqual(['7d', '30d', '90d', '180d', '365d']);
  });

  it('counts both ends: 7 days ending 2026-11-02 start on 2026-10-27', () => {
    expect(windowDates('7d', '2026-11-02')).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(windowDates('90d', '2026-11-02')).toEqual({ from: '2026-08-05', to: '2026-11-02' });
  });

  it('crosses a month and a year end', () => {
    expect(windowDates('30d', '2026-01-10')).toEqual({ from: '2025-12-12', to: '2026-01-10' });
  });

  it('crosses a leap day', () => {
    expect(windowDates('7d', '2028-03-02')).toEqual({ from: '2028-02-25', to: '2028-03-02' });
  });

  it('counts the days of a window from its two ends, both included', () => {
    expect(daysBetween('2026-10-27', '2026-11-02')).toBe(7);
    expect(daysBetween('2026-11-02', '2026-11-02')).toBe(1);
    expect(daysBetween('2025-12-12', '2026-01-10')).toBe(30);
  });

  it('agrees with windowDates for every window', () => {
    const counted = WINDOW_KEYS.map((win) => {
      const { from, to } = windowDates(win, '2026-11-02');
      return daysBetween(from, to);
    });
    expect(counted).toEqual([7, 30, 90, 180, 365]);
  });
});
