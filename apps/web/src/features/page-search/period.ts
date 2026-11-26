import { addDays, daysInclusive, type BusinessDate } from '@/components/app/date-range/business-date';
import { resolveRange, type DateRangeValue } from '@/components/app/date-range/range-model';

import type { CompareParam, PeriodParams } from './types';

/** A period of days, both ends included. Not `Window`: that name is the browser's own type. */
export interface PeriodWindow {
  from: BusinessDate;
  to: BusinessDate;
}

const pad = (value: number): string => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number): BusinessDate => `${String(year)}-${pad(month)}-${pad(day)}`;
const parts = (day: string): [number, number, number] => {
  const [year, month, date] = day.split('-').map(Number);
  return [year ?? 0, month ?? 1, date ?? 1];
};
/** The number of days of a month; `month` is 1 to 12. */
const monthLength = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The last calendar month that ends on or before the last final day. */
export function lastFullMonth(finalThrough: string): PeriodWindow {
  const [year, month, day] = parts(finalThrough);
  if (day === monthLength(year, month)) return { from: iso(year, month, 1), to: iso(year, month, day) };
  const before = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return {
    from: iso(before.year, before.month, 1),
    to: iso(before.year, before.month, monthLength(before.year, before.month)),
  };
}

/** What the picker shows: the address's period, or the last full month when the address has none. */
export function periodValue(fromAddress: DateRangeValue | null, finalThrough: string): DateRangeValue {
  return fromAddress ?? { kind: 'custom', ...lastFullMonth(finalThrough) };
}

/** The query of a read. The default sends no dates, so the server and the browser cannot disagree on the month. */
export function periodParams(
  fromAddress: DateRangeValue | null,
  compare: CompareParam,
  finalThrough: string,
): PeriodParams {
  if (fromAddress === null) return { compare };
  const range = resolveRange(fromAddress, finalThrough);
  return { from: range.from, to: range.to, compare };
}

const isCalendarMonth = (from: string, to: string): boolean => {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  return fromDay === 1 && fromYear === toYear && fromMonth === toMonth && toDay === monthLength(toYear, toMonth);
};

const yearBefore = (day: string): BusinessDate => {
  const [year, month, date] = parts(day);
  return iso(year - 1, month, Math.min(date, monthLength(year - 1, month)));
};

/** The days compared with, as the API computes them (the response's `compare_window` is the truth; this labels the control). */
export function compareWindow(from: string, to: string, compare: CompareParam): PeriodWindow | null {
  if (compare === 'none') return null;
  if (compare === 'previous_year') return { from: yearBefore(from), to: yearBefore(to) };
  if (isCalendarMonth(from, to)) return lastFullMonth(addDays(from, -1));
  const days = daysInclusive(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}
