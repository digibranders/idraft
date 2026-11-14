/**
 * Business date arithmetic. A business date is a project day written "YYYY-MM-DD" (22-content-formatting.md
 * section 4). It is a label for a calendar day, not an instant: every move here counts calendar days in UTC, so
 * a clock change of the project's zone moves no day and adds no hour.
 *
 * Only the years 2000 to 2100 are business dates, as for the month keys of `@/lib/format/month`.
 */
export type BusinessDate = string;

/** The first business date: nothing a screen shows or accepts is earlier. */
export const FIRST_BUSINESS_DATE: BusinessDate = '2000-01-01';

const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const MONDAY_FIRST = 6;
const WEEK = 7;

interface Parts {
  year: number;
  month: number;
  day: number;
}

/** The shape and a real calendar day, of any year. */
function calendarParts(value: string): Parts | null {
  const match = SHAPE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // The year is set on its own: Date.UTC reads the years 0 to 99 as 1900 to 1999.
  // The date rolls an impossible day over (Feb 30 becomes Mar 2), so a day that does not come back is not real
  const rolled = new Date(0);
  rolled.setUTCFullYear(year, month - 1, day);
  const real = rolled.getUTCFullYear() === year && rolled.getUTCMonth() === month - 1 && rolled.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

function parts(value: string): Parts | null {
  const found = calendarParts(value);
  return found !== null && found.year >= FIRST_YEAR && found.year <= LAST_YEAR ? found : null;
}

/** The shape, and a real calendar day of 2000 to 2100. */
export function isBusinessDate(value: string): boolean {
  return parts(value) !== null;
}

/** A real calendar day before 2000: not a business date, but a date, so "too early" is what to say about it. */
export function isBeforeFirstDay(value: string): boolean {
  const found = calendarParts(value);
  return found !== null && found.year < FIRST_YEAR;
}

function read(value: string): Parts {
  const found = parts(value);
  if (found === null) throw new RangeError(`"${value.slice(0, 20)}" is not a business date (YYYY-MM-DD)`);
  return found;
}

const toDate = (value: string): Date => {
  const { year, month, day } = read(value);
  return new Date(Date.UTC(year, month - 1, day));
};

const toBusinessDate = (date: Date): BusinessDate => date.toISOString().slice(0, 10);

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const { year, month, day } = read(date);
  return toBusinessDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/** The same day in another month, clamped to the length of it: Jan 31 plus one month is Feb 28. */
export function addMonths(date: BusinessDate, months: number): BusinessDate {
  const { year, month, day } = read(date);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return toBusinessDate(new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))));
}

/** The days from `from` to `to`, both counted: the same day is 1. Negative or zero when `to` is before `from`. */
export function daysInclusive(from: BusinessDate, to: BusinessDate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY) + 1;
}

/** 0 for Monday to 6 for Sunday (ISO). */
export function weekdayIndex(date: BusinessDate): number {
  return (toDate(date).getUTCDay() + MONDAY_FIRST) % WEEK;
}

export function monthStart(date: BusinessDate): BusinessDate {
  return `${date.slice(0, 7)}-01`;
}

/** The days of the month in weeks of 7, Monday first; `null` before the 1st and after the last (outside days are hidden). */
export function monthWeeks(month: BusinessDate): readonly (readonly (BusinessDate | null)[])[] {
  const first = monthStart(month);
  const { year, month: number } = read(first);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const lead = weekdayIndex(first);
  const cells: (BusinessDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, index) => addDays(first, index)),
  ];
  while (cells.length % WEEK !== 0) cells.push(null);
  return Array.from({ length: cells.length / WEEK }, (_, week) => cells.slice(week * WEEK, week * WEEK + WEEK));
}
