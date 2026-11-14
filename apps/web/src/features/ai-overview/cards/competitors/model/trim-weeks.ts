import type { WeeklyMentionPoint, WeeklyPoint } from './types';

/**
 * The weeks a weekly card draws. The API's series can start with a week before the window (no answers) and can end
 * on a week that has none yet; either one is an empty slot on the axis that says nothing, so the idle weeks at the
 * two ends are left out. An idle week between two others stays, because there the gap is a fact. A week with thin
 * answers is not idle: it is drawn and says it is thin.
 */
export function trimIdleWeeks<T>(weeks: readonly T[], isIdle: (week: T) => boolean): T[] {
  const first = weeks.findIndex((week) => !isIdle(week));
  if (first === -1) return [];
  const last = weeks.findLastIndex((week) => !isIdle(week));
  return weeks.slice(first, last + 1);
}

/** Share of voice weeks: idle when no answer names a tracked brand (`state` none). */
export const trimIdleShares = (points: readonly WeeklyPoint[]): WeeklyPoint[] =>
  trimIdleWeeks(points, (point) => point.answers === 0 && point.state === 'none');

/** Mention weeks: idle when no brand has an answer in the week. */
export const trimIdleMentions = (points: readonly WeeklyMentionPoint[]): WeeklyMentionPoint[] =>
  trimIdleWeeks(points, (point) => point.entities.every((entry) => entry.n === 0 && entry.state === 'none'));
