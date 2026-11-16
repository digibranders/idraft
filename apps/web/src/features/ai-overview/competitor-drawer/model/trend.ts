import type { TrackedSet, WeeklyMention, WeeklyMentionPoint } from '../../cards/competitors/model/types';
import { weeklyMention } from '../../cards/competitors/model/weekly-series';
import type { PromptsSummary } from '@/lib/api/types';

/**
 * The weekly mention rate of you and one competitor over the platforms of the page scope (OV-DRW-11). Each platform
 * gives its own weekly points (pooled by the API when a week holds few prompts); All platforms is the equal-weight
 * average, week by week, of the platforms that have a rate that week (R3). A week with no rate is a gap, and a
 * competitor the weekly read carries no cells for is "not collected", never a flat or invented line (OV-NOPORT-02).
 */

export interface TrendPoint {
  /** 0 to 1; `null` for a week with under 4 valid answers on every platform. */
  value: number | null;
  /** One platform only: the answers that mention the brand and the valid answers behind the point. */
  successes: number | null;
  answers: number | null;
}

export interface TrendWeek {
  /** The Monday the week starts on. */
  weekStart: string;
  own: TrendPoint;
  rival: TrendPoint;
}

export type TrendRead =
  | { status: 'unread' }
  /** The weekly read has no cell for the competitor at all: the backend has not built it. */
  | { status: 'not_collected' }
  | { status: 'read'; weeks: TrendWeek[] };

const GAP: TrendPoint = { value: null, successes: null, answers: null };

function pointOf(here: readonly WeeklyMention[], single: boolean): TrendPoint {
  const rated = here.filter((point) => point.state === 'ok' && point.value !== null);
  if (rated.length === 0) return GAP;
  const value = rated.reduce((total, point) => total + (point.value ?? 0), 0) / rated.length;
  const only = single ? rated[0] : undefined;
  return { value, successes: only?.k ?? null, answers: only?.n ?? null };
}

export function weeklyMentionTrend(
  summary: PromptsSummary,
  codes: readonly string[],
  set: TrackedSet,
  rivalId: string,
  average: boolean,
): TrendRead {
  const reads = codes.flatMap((code) => {
    const read = weeklyMention(summary, code, set);
    return read.status === 'read' ? [read.points] : [];
  });
  if (reads.length === 0) return { status: 'unread' };
  const ownId = set.entities.find((entity) => entity.role === 'own')?.entityId;
  const entry = (points: readonly WeeklyMentionPoint[], id: string): WeeklyMention[] =>
    points.flatMap((point) => point.entities.filter((cell) => cell.entityId === id));
  const weekStarts = [...new Set(reads.flatMap((points) => points.map((point) => point.weekStart)))].sort();
  const single = !average && reads.length === 1;
  const weeks = weekStarts.map((weekStart): TrendWeek => {
    const here = reads.flatMap((points) => points.filter((point) => point.weekStart === weekStart));
    return {
      weekStart,
      own: ownId === undefined ? GAP : pointOf(entry(here, ownId), single),
      rival: pointOf(entry(here, rivalId), single),
    };
  });
  // A competitor with no valid answer in any week has no cell in the weekly read
  const collected = reads.some((points) => points.some((point) => entry([point], rivalId).some((cell) => cell.n > 0)));
  if (!collected) return { status: 'not_collected' };
  // The idle weeks at both ends are not drawn
  const first = weeks.findIndex((week) => week.own.value !== null || week.rival.value !== null);
  const last = weeks.findLastIndex((week) => week.own.value !== null || week.rival.value !== null);
  return { status: 'read', weeks: first === -1 ? [] : weeks.slice(first, last + 1) };
}

/**
 * The weeks of the window before, then those of the current window, as the page's own trend draws them. A week in both
 * (one that straddles the two windows) is the current window's. The current window decides what the trend is: the
 * previous one only adds weeks to a trend that has some, and is ignored when it could not be read.
 */
export function joinTrends(previous: TrendRead | null, current: TrendRead): TrendRead {
  if (previous === null || previous.status !== 'read' || current.status !== 'read') return current;
  const kept = new Map<string, TrendWeek>();
  for (const week of [...previous.weeks, ...current.weeks]) kept.set(week.weekStart, week);
  return { status: 'read', weeks: [...kept.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)) };
}
