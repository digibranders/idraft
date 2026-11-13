import type { Schedule } from '@/lib/api/types';

/** The days of the week in the order a week is read here: Monday first, Sunday last. */
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** `Schedule.weekday` counts from Sunday (0) to Saturday (6). */
const WEEKDAY_OF_NUMBER: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * On which days the AI schedules ask the prompts. Schedules belong to the project (their selector is every prompt),
 * so every engine that is on is asked on the same days.
 * - `weekdays`: weekly schedules, each weekday once, in week order.
 * - `daily`: a daily schedule is active.
 * - `custom`: a schedule that cannot be listed as weekdays (a cron expression, a monthly one, a weekly one with
 *   no weekday). It is not hidden behind the weekdays of another schedule.
 * - `paused`: schedules exist and every one is paused. It is not `none`: the days come back when it resumes.
 * - `none`: the project has no AI schedule.
 */
export type DaysAsked =
  | { kind: 'weekdays'; days: readonly Weekday[] }
  | { kind: 'daily' }
  | { kind: 'custom' }
  | { kind: 'paused' }
  | { kind: 'none' };

export function daysAsked(schedules: readonly Schedule[]): DaysAsked {
  const ai = schedules.filter((schedule) => schedule.workload === 'ai_prompt');
  if (ai.length === 0) return { kind: 'none' };
  const active = ai.filter((schedule) => schedule.is_active);
  if (active.length === 0) return { kind: 'paused' };
  if (active.some((schedule) => schedule.cadence === 'daily')) return { kind: 'daily' };
  const weekdays = new Set<Weekday>();
  for (const schedule of active) {
    const day =
      schedule.cadence === 'weekly' && schedule.weekday !== null ? WEEKDAY_OF_NUMBER[schedule.weekday] : undefined;
    if (day === undefined) return { kind: 'custom' };
    weekdays.add(day);
  }
  return { kind: 'weekdays', days: WEEKDAYS.filter((day) => weekdays.has(day)) };
}
