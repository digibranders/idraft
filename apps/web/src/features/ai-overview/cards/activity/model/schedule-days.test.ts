import { describe, expect, it } from 'vitest';

import { schedule } from './activity-fixtures';
import { daysAsked } from './schedule-days';

describe('daysAsked', () => {
  it('lists the weekdays of weekly schedules in week order, Monday first and Sunday last', () => {
    const days = daysAsked([
      schedule({ n: 1, weekday: 0 }),
      schedule({ n: 2, weekday: 4 }),
      schedule({ n: 3, weekday: 1 }),
    ]);
    expect(days).toEqual({ kind: 'weekdays', days: ['monday', 'thursday', 'sunday'] });
  });

  it('names a weekday once when two schedules share it', () => {
    expect(daysAsked([schedule({ n: 1, weekday: 1 }), schedule({ n: 2, weekday: 1 })])).toEqual({
      kind: 'weekdays',
      days: ['monday'],
    });
  });

  it('is daily when a daily schedule is active', () => {
    expect(daysAsked([schedule({ n: 1, cadence: 'daily', weekday: null }), schedule({ n: 2, weekday: 4 })])).toEqual({
      kind: 'daily',
    });
  });

  it('is custom for a cron schedule, a monthly one, and a weekly one that names no weekday', () => {
    expect(daysAsked([schedule({ n: 1, cadence: 'cron', weekday: null })])).toEqual({ kind: 'custom' });
    expect(daysAsked([schedule({ n: 1, cadence: 'monthly', weekday: null })])).toEqual({ kind: 'custom' });
    expect(daysAsked([schedule({ n: 1, weekday: null })])).toEqual({ kind: 'custom' });
    // A custom schedule cannot be listed, so it is not hidden behind the weekdays of another one
    expect(daysAsked([schedule({ n: 1, weekday: 1 }), schedule({ n: 2, cadence: 'cron', weekday: null })])).toEqual({
      kind: 'custom',
    });
  });

  it('is none for no schedule, and paused (not none) when every schedule is paused', () => {
    expect(daysAsked([])).toEqual({ kind: 'none' });
    expect(daysAsked([schedule({ n: 1, active: false }), schedule({ n: 2, weekday: 4, active: false })])).toEqual({
      kind: 'paused',
    });
  });

  it('leaves out a paused schedule when another one is active, and a schedule of another workload', () => {
    expect(
      daysAsked([
        schedule({ n: 1, weekday: 1 }),
        schedule({ n: 2, weekday: 4, active: false }),
        schedule({ n: 3, weekday: 5, workload: 'seo_rank' }),
      ]),
    ).toEqual({ kind: 'weekdays', days: ['monday'] });
  });
});
