import { describe, expect, it } from 'vitest';

import messages from '../../../../messages/en.json';
import {
  CEILING_RANGE_DAYS,
  checkRange,
  DEFAULT_PRESET,
  droppedMessageKey,
  firstDay,
  lastEnd,
  limitDaysOf,
  MAX_RANGE_DAYS,
  PRESET_DAYS,
  RANGE_PRESETS,
  readRangeParams,
  resolveRange,
  writeRangeParams,
  type DroppedMessageKey,
  type DroppedReason,
  type RangeLimits,
  type RangeProblem,
} from './range-model';

const TODAY = '2026-11-13';
const LIMITS: RangeLimits = { today: TODAY };
const NONE = { win: null, from: null, to: null };

describe('MAX_RANGE_DAYS', () => {
  it('is the longest range every route accepts: 91 project days', () => {
    // The answers route measures elapsed time and refuses 92 project days across a fall-back clock change
    expect(MAX_RANGE_DAYS).toBe(91);
    // The widest preset fits, so a preset is never refused
    expect(Math.max(...Object.values(PRESET_DAYS))).toBeLessThanOrEqual(MAX_RANGE_DAYS);
  });
});

describe('limitDaysOf', () => {
  it('is MAX_RANGE_DAYS by default, and the page number when it is smaller', () => {
    expect(limitDaysOf(LIMITS)).toBe(MAX_RANGE_DAYS);
    expect(limitDaysOf({ ...LIMITS, maxDays: 60 })).toBe(60);
  });

  it('clamps a page number above the 92 day ceiling of the routes, in every check', () => {
    expect(CEILING_RANGE_DAYS).toBe(92);
    const loose = { ...LIMITS, maxDays: 365 };
    expect(limitDaysOf(loose)).toBe(92);
    expect(checkRange('2026-08-14', TODAY, loose)).toBeNull();
    expect(checkRange('2026-08-13', TODAY, loose)).toEqual({ code: 'too_long', days: 93, max: 92 });
    expect(lastEnd('2026-05-01', loose)).toBe('2026-07-31');
    expect(readRangeParams({ win: '90d', from: null, to: null }, loose).dropped).toBeNull();
  });
});

describe('firstDay', () => {
  it('is 2000-01-01, the first business date, unless the data starts later', () => {
    expect(firstDay(LIMITS)).toBe('2000-01-01');
    expect(firstDay({ ...LIMITS, earliest: null })).toBe('2000-01-01');
    expect(firstDay({ ...LIMITS, earliest: '1990-05-05' })).toBe('2000-01-01');
    expect(firstDay({ ...LIMITS, earliest: '2026-03-02' })).toBe('2026-03-02');
  });
});

describe('droppedMessageKey', () => {
  // A Record over the type: a reason added to RangeProblem is a type error here until it has its words
  const PROBLEMS: Record<DroppedReason, { problem: RangeProblem; key: DroppedMessageKey }> = {
    invalid: { problem: { code: 'invalid', field: 'from' }, key: 'droppedInvalid' },
    order: { problem: { code: 'order' }, key: 'droppedOrder' },
    future: { problem: { code: 'future', today: TODAY }, key: 'droppedFuture' },
    before_start: {
      problem: { code: 'before_start', earliest: '2026-03-02', known: true },
      key: 'droppedBeforeStart',
    },
    too_long: { problem: { code: 'too_long', days: 100, max: 91 }, key: 'droppedTooLong' },
  };
  const REASONS = Object.keys(PROBLEMS) as DroppedReason[];

  it('is tested for every reason there is', () => {
    expect([...REASONS].sort()).toEqual(['future', 'invalid', 'order', 'before_start', 'too_long'].sort());
  });

  it.each(REASONS)('maps %s to a message that exists and says what is shown instead', (reason) => {
    const { problem, key } = PROBLEMS[reason];
    expect(droppedMessageKey(problem)).toBe(key);
    expect(messages.common.dateRange[key]).toMatch(/last 28 days are shown\.$/);
  });

  it('gives each reason its own message, and the problem of a link past maxDays the too long one', () => {
    expect(new Set(Object.values(PROBLEMS).map(({ key }) => key)).size).toBe(REASONS.length);
    const past = readRangeParams({ win: '90d', from: null, to: null }, { ...LIMITS, maxDays: 60 }).dropped;
    expect(past?.code).toBe('too_long');
    if (past !== null) expect(droppedMessageKey(past)).toBe('droppedTooLong');
  });

  it('says dates before a first day nobody knows without claiming that data starts there', () => {
    expect(droppedMessageKey({ code: 'before_start', earliest: '2000-01-01', known: false })).toBe(
      'droppedBeforeFirst',
    );
    expect(messages.common.dateRange.droppedBeforeFirst).not.toMatch(/data starts/i);
    expect(messages.common.dateRange.beforeFirst).not.toMatch(/data starts/i);
  });
});

describe('presets', () => {
  it('are 7, 28 and 90 days, with 28 the default', () => {
    expect(RANGE_PRESETS).toEqual(['7d', '28d', '90d']);
    expect(PRESET_DAYS).toEqual({ '7d': 7, '28d': 28, '90d': 90 });
    expect(DEFAULT_PRESET).toBe('28d');
  });

  it('resolve to a range that ends on today, both ends included', () => {
    expect(resolveRange({ kind: 'preset', preset: '7d' }, TODAY)).toEqual({
      from: '2026-11-07',
      to: TODAY,
      days: 7,
    });
    expect(resolveRange({ kind: 'preset', preset: '28d' }, TODAY)).toEqual({
      from: '2026-10-17',
      to: TODAY,
      days: 28,
    });
    expect(resolveRange({ kind: 'preset', preset: '90d' }, TODAY)).toEqual({
      from: '2026-08-16',
      to: TODAY,
      days: 90,
    });
  });

  it('are project days: a preset across the October clock change still has its number of days', () => {
    expect(resolveRange({ kind: 'preset', preset: '28d' }, '2026-10-30')).toEqual({
      from: '2026-10-03',
      to: '2026-10-30',
      days: 28,
    });
  });

  it('give a custom range as it is', () => {
    expect(resolveRange({ kind: 'custom', from: '2026-09-01', to: '2026-10-31' }, TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-10-31',
      days: 61,
    });
  });
});

describe('checkRange', () => {
  it('reports the first problem in this order: invalid, order, future, before start, too long', () => {
    expect(checkRange('2026-13-01', '2026-11-13', LIMITS)).toEqual({ code: 'invalid', field: 'from' });
    expect(checkRange('2026-11-01', 'abc', LIMITS)).toEqual({ code: 'invalid', field: 'to' });
    expect(checkRange('', '', LIMITS)).toEqual({ code: 'invalid', field: 'from' });
    expect(checkRange('2026-11-13', '2026-11-01', LIMITS)).toEqual({ code: 'order' });
    expect(checkRange('2026-11-01', '2026-11-14', LIMITS)).toEqual({ code: 'future', today: TODAY });
    // order before future, future before before_start, before_start before too_long
    expect(checkRange('2026-11-20', '2026-11-14', LIMITS)).toEqual({ code: 'order' });
    expect(checkRange('2026-01-01', '2026-11-14', { ...LIMITS, earliest: '2026-03-02' })).toEqual({
      code: 'future',
      today: TODAY,
    });
    expect(checkRange('2026-01-01', '2026-11-13', { ...LIMITS, earliest: '2026-03-02' })).toEqual({
      code: 'before_start',
      earliest: '2026-03-02',
      known: true,
    });
  });

  it('says a real day before 2000 is before the first day, not that its format is wrong', () => {
    expect(checkRange('1999-12-31', TODAY, LIMITS)).toEqual({
      code: 'before_start',
      earliest: '2000-01-01',
      known: false,
    });
    expect(checkRange('0050-01-01', TODAY, LIMITS)).toEqual({
      code: 'before_start',
      earliest: '2000-01-01',
      known: false,
    });
    // The data starting later than 2000 is the nearer reason
    expect(checkRange('1999-12-31', TODAY, { ...LIMITS, earliest: '2026-03-02' })).toEqual({
      code: 'before_start',
      earliest: '2026-03-02',
      known: true,
    });
    // An earliest day at or before 2000 is no knowledge of where the data starts: the floor is a limit of the app
    expect(checkRange('1999-12-31', TODAY, { ...LIMITS, earliest: '1990-05-05' })).toEqual({
      code: 'before_start',
      earliest: '2000-01-01',
      known: false,
    });
    // The order of the checks holds: a start after the end, or an end in the future, is reported first
    expect(checkRange('1999-12-31', '1999-01-01', LIMITS)).toEqual({ code: 'order' });
    expect(checkRange('1999-12-31', '2026-11-14', LIMITS)).toEqual({ code: 'future', today: TODAY });
    // An impossible day, or a text that is not a date, is still a format problem
    expect(checkRange('1999-02-30', TODAY, LIMITS)).toEqual({ code: 'invalid', field: 'from' });
    expect(checkRange('2026-11-01', '1999-13-01', LIMITS)).toEqual({ code: 'invalid', field: 'to' });
    // A first day of 2000 is data
    expect(checkRange('2000-01-01', '2000-01-31', { today: TODAY })).toBeNull();
  });

  it('allows a range of 91 days and refuses 92, the boundary both ways', () => {
    expect(checkRange('2026-08-15', TODAY, LIMITS)).toBeNull();
    expect(checkRange('2026-08-14', TODAY, LIMITS)).toEqual({ code: 'too_long', days: 92, max: 91 });
    expect(checkRange('2026-08-01', TODAY, LIMITS)).toEqual({ code: 'too_long', days: 105, max: 91 });
  });

  it('allows a range of 91 days that crosses a clock change', () => {
    // Oct 1 to Dec 30 is 91 days and holds the fall back of Berlin and New York
    expect(checkRange('2026-10-01', '2026-12-30', { today: '2027-01-05' })).toBeNull();
    expect(checkRange('2026-10-01', '2026-12-31', { today: '2027-01-05' })).toEqual({
      code: 'too_long',
      days: 92,
      max: 91,
    });
  });

  it('takes a narrower maxDays from the caller', () => {
    expect(checkRange('2026-08-15', TODAY, { ...LIMITS, maxDays: 90 })).toEqual({
      code: 'too_long',
      days: 91,
      max: 90,
    });
    expect(checkRange('2026-08-16', TODAY, { ...LIMITS, maxDays: 90 })).toBeNull();
  });

  it('accepts today alone, and a start on the first day with data', () => {
    expect(checkRange(TODAY, TODAY, LIMITS)).toBeNull();
    expect(checkRange('2026-03-02', '2026-04-01', { ...LIMITS, earliest: '2026-03-02' })).toBeNull();
    expect(checkRange('2026-03-01', '2026-04-01', { ...LIMITS, earliest: '2026-03-02' })).toEqual({
      code: 'before_start',
      earliest: '2026-03-02',
      known: true,
    });
    expect(checkRange('2026-03-01', '2026-04-01', { ...LIMITS, earliest: null })).toBeNull();
  });
});

describe('lastEnd', () => {
  it('is the earlier of today and the start plus the cap', () => {
    expect(lastEnd('2026-09-01', LIMITS)).toBe(TODAY);
    expect(lastEnd('2026-05-01', LIMITS)).toBe('2026-07-30');
    expect(lastEnd('2026-08-15', LIMITS)).toBe(TODAY);
    expect(lastEnd('2026-08-14', LIMITS)).toBe('2026-11-12');
  });

  it('follows maxDays', () => {
    expect(lastEnd('2026-05-01', { ...LIMITS, maxDays: 30 })).toBe('2026-05-30');
  });

  it('makes a range of exactly the cap: the end it gives is accepted, the next day is not', () => {
    const end = lastEnd('2026-05-01', LIMITS);
    expect(checkRange('2026-05-01', end, LIMITS)).toBeNull();
    expect(checkRange('2026-05-01', '2026-07-31', LIMITS)).toMatchObject({ code: 'too_long' });
  });
});

describe('writeRangeParams', () => {
  it('writes nothing for the default preset', () => {
    expect(writeRangeParams({ kind: 'preset', preset: '28d' })).toEqual(NONE);
  });

  it('writes win for another preset', () => {
    expect(writeRangeParams({ kind: 'preset', preset: '7d' })).toEqual({ ...NONE, win: '7d' });
    expect(writeRangeParams({ kind: 'preset', preset: '90d' })).toEqual({ ...NONE, win: '90d' });
  });

  it('writes from and to for a custom range, and no win', () => {
    expect(writeRangeParams({ kind: 'custom', from: '2026-09-01', to: '2026-10-31' })).toEqual({
      win: null,
      from: '2026-09-01',
      to: '2026-10-31',
    });
  });
});

describe('readRangeParams', () => {
  const DEFAULT = { kind: 'preset', preset: '28d' } as const;

  it('reads nothing as the default, with no reason', () => {
    expect(readRangeParams(NONE, LIMITS)).toEqual({ value: DEFAULT, dropped: null });
  });

  it('reads what writeRangeParams wrote', () => {
    for (const value of [
      { kind: 'preset', preset: '7d' },
      { kind: 'preset', preset: '28d' },
      { kind: 'preset', preset: '90d' },
      { kind: 'custom', from: '2026-09-01', to: '2026-10-31' },
    ] as const) {
      expect(readRangeParams(writeRangeParams(value), LIMITS)).toEqual({ value, dropped: null });
    }
  });

  it('falls back to 28 days with too_long for a 120 day link', () => {
    expect(readRangeParams({ win: null, from: '2026-07-16', to: '2026-11-12' }, LIMITS)).toEqual({
      value: DEFAULT,
      dropped: { code: 'too_long', days: 120, max: 91 },
    });
  });

  it('falls back to 28 days with invalid for dates that are not dates', () => {
    expect(readRangeParams({ win: null, from: 'abc', to: '2026-11-12' }, LIMITS)).toEqual({
      value: DEFAULT,
      dropped: { code: 'invalid', field: 'from' },
    });
    expect(readRangeParams({ win: null, from: '2026-11-01', to: '2026-02-30' }, LIMITS)).toEqual({
      value: DEFAULT,
      dropped: { code: 'invalid', field: 'to' },
    });
  });

  it('falls back with invalid when only one of from and to is there', () => {
    expect(readRangeParams({ win: null, from: '2026-11-01', to: null }, LIMITS)).toEqual({
      value: DEFAULT,
      dropped: { code: 'invalid', field: 'to' },
    });
    expect(readRangeParams({ win: null, from: null, to: '2026-11-01' }, LIMITS)).toEqual({
      value: DEFAULT,
      dropped: { code: 'invalid', field: 'from' },
    });
  });

  it('falls back for a link in the future, in reverse order, or before the data', () => {
    expect(readRangeParams({ win: null, from: '2026-11-01', to: '2026-11-20' }, LIMITS).dropped).toEqual({
      code: 'future',
      today: TODAY,
    });
    expect(readRangeParams({ win: null, from: '2026-11-10', to: '2026-11-01' }, LIMITS).dropped).toEqual({
      code: 'order',
    });
    expect(
      readRangeParams({ win: null, from: '2026-01-01', to: '2026-02-01' }, { ...LIMITS, earliest: '2026-03-02' })
        .dropped,
    ).toEqual({ code: 'before_start', earliest: '2026-03-02', known: true });
  });

  it('falls back with before_start for a link that starts before 2000', () => {
    expect(readRangeParams({ win: null, from: '1999-12-31', to: '2026-11-01' }, LIMITS).dropped).toEqual({
      code: 'before_start',
      earliest: '2000-01-01',
      known: false,
    });
  });

  it('ignores an unknown preset, with invalid', () => {
    expect(readRangeParams({ win: '12w', from: null, to: null }, LIMITS)).toEqual({
      value: DEFAULT,
      dropped: { code: 'invalid', field: 'from' },
    });
    expect(readRangeParams({ win: '', from: null, to: null }, LIMITS).dropped).toMatchObject({ code: 'invalid' });
  });

  it('reads a preset the caller caps below its length as too long', () => {
    expect(readRangeParams({ win: '90d', from: null, to: null }, { ...LIMITS, maxDays: 60 })).toEqual({
      value: DEFAULT,
      dropped: { code: 'too_long', days: 90, max: 60 },
    });
  });

  it('prefers from and to to win when a link carries both', () => {
    expect(readRangeParams({ win: '7d', from: '2026-09-01', to: '2026-10-31' }, LIMITS)).toEqual({
      value: { kind: 'custom', from: '2026-09-01', to: '2026-10-31' },
      dropped: null,
    });
  });

  it('never throws on hostile values', () => {
    const hostile = ['\u{0000}', '<img src=x>', '9'.repeat(5000), '../..', '2026-11-13\u{0000}', "'; DROP TABLE"];
    for (const text of hostile) {
      expect(() => readRangeParams({ win: text, from: text, to: text }, LIMITS)).not.toThrow();
      expect(readRangeParams({ win: text, from: null, to: null }, LIMITS).value).toEqual(DEFAULT);
    }
  });
});
