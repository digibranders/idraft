import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  daysInclusive,
  FIRST_BUSINESS_DATE,
  isBeforeFirstDay,
  isBusinessDate,
  monthStart,
  monthWeeks,
  weekdayIndex,
} from './business-date';

// The clock tests need a zone with a clock change: in a UTC process they would pass for any implementation
const ZONE = 'America/New_York';
const HOUR = 3_600_000;
let originalZone: string | undefined;

beforeAll(() => {
  originalZone = process.env.TZ;
  process.env.TZ = ZONE;
});

afterAll(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

describe('isBusinessDate', () => {
  it('accepts a real calendar day', () => {
    expect(isBusinessDate('2026-11-13')).toBe(true);
    expect(isBusinessDate('2028-02-29')).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-1-01',
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '',
    ' 2026-11-13',
    '2026-11-13 ',
    '2026-11-13T00:00',
    '20261113',
    '0050-01-01',
    '1999-12-31',
    '2101-01-01',
    '\u{FF12}026-11-13',
    '2026-11-1\u{FF13}',
    '<script>',
  ])('refuses %j', (value) => {
    expect(isBusinessDate(value)).toBe(false);
  });
});

describe('isBeforeFirstDay', () => {
  it('is true for a real day before 2000, the ones isBusinessDate refuses for that reason only', () => {
    expect(FIRST_BUSINESS_DATE).toBe('2000-01-01');
    expect(isBeforeFirstDay('1999-12-31')).toBe(true);
    expect(isBeforeFirstDay('0050-01-01')).toBe(true);
    expect(isBeforeFirstDay('2000-01-01')).toBe(false);
    expect(isBeforeFirstDay('2026-11-13')).toBe(false);
  });

  it.each(['1999-02-29', '1999-13-01', '1999-1-01', '', 'abc', '1999-12-31 '])('is false for %j', (value) => {
    expect(isBeforeFirstDay(value)).toBe(false);
  });
});

describe('the pinned zone', () => {
  it('is America/New_York, where Nov 1, 2026 (the fall back) lasts 25 hours', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime()).toBe(25 * HOUR);
    // And Mar 8, 2026 (the spring forward) lasts 23
    expect(new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime()).toBe(23 * HOUR);
  });

  it('counts the day of the fall back, and the days around it, as whole days', () => {
    expect(daysInclusive('2026-11-01', '2026-11-01')).toBe(1);
    expect(daysInclusive('2026-10-31', '2026-11-02')).toBe(3);
    expect(daysInclusive('2026-11-01', '2026-11-02')).toBe(2);
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -1)).toBe('2026-11-01');
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-30');
    expect(weekdayIndex('2026-11-01')).toBe(6);
    expect(weekdayIndex('2026-11-02')).toBe(0);
  });

  it('counts the day of the spring forward as a whole day', () => {
    expect(daysInclusive('2026-03-08', '2026-03-08')).toBe(1);
    expect(daysInclusive('2026-03-07', '2026-03-09')).toBe(3);
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('lays out the month of the fall back with its 30 days, none doubled or lost', () => {
    const days = monthWeeks('2026-11-01')
      .flat()
      .filter((day) => day !== null);
    expect(days).toHaveLength(30);
    expect(new Set(days).size).toBe(30);
    expect(days.at(-1)).toBe('2026-11-30');
  });
});

describe('addDays', () => {
  it('moves across a month and a year', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-11-13', 0)).toBe('2026-11-13');
  });

  it('gives calendar days across the clock changes of Europe/Berlin and America/New_York', () => {
    // Berlin: Mar 29 and Oct 25, 2026. New York: Mar 8 and Nov 1, 2026. A day is a day.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-01', 92)).toBe('2026-06-01');
    expect(addDays('2026-08-14', 91)).toBe('2026-11-13');
  });

  it('refuses a value that is not a business date', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('addMonths', () => {
  it('clamps the day to the length of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('moves across a year in both directions, and by 12 months to the same day', () => {
    expect(addMonths('2026-11-13', 2)).toBe('2027-01-13');
    expect(addMonths('2026-01-13', -1)).toBe('2025-12-13');
    expect(addMonths('2026-11-13', -12)).toBe('2025-11-13');
    expect(addMonths('2026-11-13', 0)).toBe('2026-11-13');
  });
});

describe('daysInclusive', () => {
  it('counts both ends', () => {
    expect(daysInclusive('2026-11-01', '2026-11-01')).toBe(1);
    expect(daysInclusive('2026-11-07', '2026-11-13')).toBe(7);
    expect(daysInclusive('2026-08-14', '2026-11-13')).toBe(92);
    expect(daysInclusive('2026-08-15', '2026-11-13')).toBe(91);
    expect(daysInclusive('2026-08-01', '2026-11-13')).toBe(105);
  });

  it('counts calendar days across a clock change, never elapsed hours', () => {
    // Oct 1 to Dec 31, 2026 holds the fall back of Berlin (Oct 25) and New York (Nov 1): 92 days, not 92 and a bit
    expect(daysInclusive('2026-10-01', '2026-12-31')).toBe(92);
    expect(daysInclusive('2026-03-01', '2026-05-31')).toBe(92);
  });
});

describe('weekdayIndex', () => {
  it('is 0 for Monday and 6 for Sunday', () => {
    expect(weekdayIndex('2026-11-09')).toBe(0);
    expect(weekdayIndex('2026-11-12')).toBe(3);
    expect(weekdayIndex('2026-11-15')).toBe(6);
    expect(weekdayIndex('2026-11-01')).toBe(6);
  });
});

describe('monthStart', () => {
  it('is the first day of the month', () => {
    expect(monthStart('2026-11-13')).toBe('2026-11-01');
    expect(monthStart('2026-02-28')).toBe('2026-02-01');
  });
});

describe('monthWeeks', () => {
  it('lays the month out in weeks of 7, Monday first, with null outside the month', () => {
    const weeks = monthWeeks('2026-11-01');
    // Nov 1, 2026 is a Sunday: six empty cells, then the 1st
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    const days = weeks.flat().filter((day) => day !== null);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-11-01');
    expect(days.at(-1)).toBe('2026-11-30');
    // Nov 30 is a Monday: the last week holds it and six empty cells
    expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
  });

  it('starts on Monday when the month does', () => {
    expect(monthWeeks('2026-06-15')[0]?.[0]).toBe('2026-06-01');
  });

  it('is the same for any day of the month', () => {
    expect(monthWeeks('2026-11-20')).toEqual(monthWeeks('2026-11-01'));
  });
});
