import { describe, expect, it } from 'vitest';

import { compareWindow, lastFullMonth, periodParams, periodValue } from './period';

describe('period', () => {
  it('finds the last full month on or before the last final day', () => {
    expect(lastFullMonth('2026-11-22')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(lastFullMonth('2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(lastFullMonth('2026-01-03')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('opens on the last full month when the address says nothing', () => {
    expect(periodValue(null, '2026-11-22')).toEqual({ kind: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(periodValue({ kind: 'preset', preset: '7d' }, '2026-11-22')).toEqual({ kind: 'preset', preset: '7d' });
  });

  it('sends no dates for the default, so the server picks the same month', () => {
    expect(periodParams(null, 'previous_period', '2026-11-22')).toEqual({ compare: 'previous_period' });
    expect(periodParams({ kind: 'preset', preset: '7d' }, 'none', '2026-11-22')).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
      compare: 'none',
    });
  });

  it('compares a calendar month with the month before and another range with as many days', () => {
    expect(compareWindow('2026-10-01', '2026-10-31', 'previous_period')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(compareWindow('2026-10-05', '2026-10-11', 'previous_period')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(compareWindow('2028-02-01', '2028-02-29', 'previous_year')).toEqual({
      from: '2027-02-01',
      to: '2027-02-28',
    });
    expect(compareWindow('2026-10-01', '2026-10-31', 'none')).toBeNull();
  });

  it('compares January with the December before it', () => {
    expect(compareWindow('2026-01-01', '2026-01-31', 'previous_period')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });
});
