import { WEEKDAYS, type Weekday } from './schedule-days';
import type { DayCounts } from './status-model';

/**
 * The answer collection calendar (CH-20): the days of one engine laid out with weekdays as rows and weeks as
 * columns, Monday first. Pure. A day is a project day written `YYYY-MM-DD`, so its weekday and its week come from the
 * date itself by calendar arithmetic and never from a time zone: the same date is the same cell on every machine.
 */

const MS_PER_DAY = 86_400_000;

const timeOf = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const dateOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** Monday is 0 and Sunday is 6, the order of `WEEKDAYS`. */
const placeOf = (date: string): number => (new Date(timeOf(date)).getUTCDay() + 6) % 7;

export function weekdayOf(date: string): Weekday {
  const weekday = WEEKDAYS[placeOf(date)];
  if (weekday === undefined) throw new RangeError(`Not a project day: ${date}`);
  return weekday;
}

/** The Monday of the week the day is in. */
const weekStartOf = (date: string): string => dateOf(timeOf(date) - placeOf(date) * MS_PER_DAY);

/**
 * What a cell stands for:
 * - `rate`: the schedule is known and planned something; `rate` is valid over scheduled, from 0 to 1.
 * - `unknown`: the route cannot name a schedule for the day (`scheduled` is `null`). Not a rate, and never 0.
 * - `nothing`: the schedules planned 0 answers that day. Not a rate either: 0 of 0 is nothing to measure.
 */
export type CellState = { kind: 'rate'; rate: number } | { kind: 'unknown' } | { kind: 'nothing' };

export interface CalendarCell {
  weekday: Weekday;
  counts: DayCounts;
  state: CellState;
}

export interface CalendarWeek {
  /** The Monday of the week, `YYYY-MM-DD`; the week may begin before the window does. */
  start: string;
  /** Seven entries, Monday first: `null` for a day outside the window. */
  cells: readonly (CalendarCell | null)[];
}

/**
 * Valid answers over scheduled answers, from 0 to 1; `null` where there is nothing to divide by (the schedule is
 * unknown or planned 0). Answers stored beyond the schedule (a day asked again) do not take it past 1, so the cell
 * stays on the scale of the heat-map; the counts in its words still say what was stored.
 */
export function validShare(counts: DayCounts): number | null {
  if (counts.scheduled === null || counts.scheduled === 0) return null;
  return Math.min(1, counts.valid / counts.scheduled);
}

export function stateOf(counts: DayCounts): CellState {
  if (counts.scheduled === null) return { kind: 'unknown' };
  const rate = validShare(counts);
  return rate === null ? { kind: 'nothing' } : { kind: 'rate', rate };
}

/** The weeks of the days of ONE engine (see `engineDays`): a calendar of several engines would add them together. */
export function calendarWeeks(days: readonly DayCounts[]): CalendarWeek[] {
  const byWeek = new Map<string, (CalendarCell | null)[]>();
  for (const counts of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const start = weekStartOf(counts.date);
    const cells = byWeek.get(start) ?? WEEKDAYS.map((): CalendarCell | null => null);
    cells[placeOf(counts.date)] = { weekday: weekdayOf(counts.date), counts, state: stateOf(counts) };
    byWeek.set(start, cells);
  }
  return [...byWeek.entries()].map(([start, cells]) => ({ start, cells }));
}
