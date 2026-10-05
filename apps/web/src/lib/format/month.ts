/**
 * Months as the cost and run pages scope them: `YYYY-MM` keys in UTC, as the API counts cost days and
 * budget months (19 section 3.11.2), between 2000 and 2100.
 */

export type MonthKey = `${number}-${number}`;

const MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

function isMonthKey(value: string): value is MonthKey {
  return MONTH.test(value);
}

/** The key of a UTC year and a zero-based month; the year must lie in 2000 to 2100. */
function keyOf(year: number, monthIndex: number): MonthKey {
  const text = `${String(year)}-${String(monthIndex + 1).padStart(2, '0')}`;
  if (!isMonthKey(text)) throw new RangeError(`${text} is not a month between 2000 and 2100`);
  return text;
}

function partsOf(key: MonthKey): { year: number; monthIndex: number } {
  const [year = '2000', month = '01'] = key.split('-');
  return { year: Number(year), monthIndex: Number(month) - 1 };
}

/** A month key from the URL, or `null` when it is not one. */
export const parseMonth = (value: string | null): MonthKey | null =>
  value !== null && isMonthKey(value) ? value : null;

/** This month (UTC) and the ones before it, newest first; 12 by default. */
export function recentMonths(now: Date, count = 12): MonthKey[] {
  return Array.from({ length: count }, (_, back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return keyOf(date.getUTCFullYear(), date.getUTCMonth());
  });
}

/** "September 2026". */
export function monthLabel(key: MonthKey, locale: string): string {
  const { year, monthIndex } = partsOf(key);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthIndex, 1)),
  );
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

/** The month's first and last UTC day, the last no later than today. */
export function monthDays(key: MonthKey, now: Date): { from: string; to: string } {
  const { year, monthIndex } = partsOf(key);
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { from: day(new Date(Date.UTC(year, monthIndex, 1))), to: day(last < now ? last : now) };
}

/** The month's first instant and the next month's, for a `created_at` range with `to` exclusive. */
export function monthInstants(key: MonthKey): { from: string; to: string } {
  const { year, monthIndex } = partsOf(key);
  const iso = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;
  return { from: iso(new Date(Date.UTC(year, monthIndex, 1))), to: iso(new Date(Date.UTC(year, monthIndex + 1, 1))) };
}
