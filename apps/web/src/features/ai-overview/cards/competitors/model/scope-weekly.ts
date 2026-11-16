import { UNREAD, type TrackedSet, type WeeklyPoint, type WeeklyRead } from './types';
import { weeklyShares } from './weekly-series';
import type { PromptsSummary } from '@/lib/api/types';
import type { RateState } from '@/lib/stats';

/**
 * The weekly share of voice over the platforms the page scope asks for: one platform's own points, or for All
 * platforms the equal-weight average, week by week, of the platforms with a share that week (R3). A week that no
 * platform has a share for is a gap, never an average of nothing. The shares of every platform add up to 1, so their
 * average does too.
 */
export function weeklySharesAcross(
  summary: PromptsSummary,
  codes: readonly string[],
  set: TrackedSet,
): WeeklyRead<WeeklyPoint> {
  const reads = codes.map((code) => weeklyShares(summary, code, set));
  const points = reads.flatMap((read) => (read.status === 'read' ? [read.points] : []));
  if (points.length === 0) return UNREAD;
  if (points.length === 1) return { status: 'read', points: points[0] ?? [] };
  const weeks = [...new Set(points.flatMap((list) => list.map((point) => point.weekStart)))].sort();
  return {
    status: 'read',
    points: weeks.map((weekStart): WeeklyPoint => {
      const here = points.flatMap((list) => list.filter((point) => point.weekStart === weekStart));
      const rated = here.filter((point) => point.state === 'ok');
      const answers = Math.max(0, ...here.map((point) => point.answers));
      const state: RateState = rated.length > 0 ? 'ok' : answers > 0 ? 'insufficient' : 'none';
      const pooled = here.find((point) => point.pool !== null)?.pool ?? null;
      return {
        weekStart,
        answers,
        state,
        pool: pooled,
        entities: set.entities.map((entity) => {
          const values = rated.flatMap((point) => {
            const value = point.entities.find((entry) => entry.entityId === entity.entityId)?.value;
            return value === null || value === undefined ? [] : [value];
          });
          return {
            entityId: entity.entityId,
            // A numerator of an average is not a count: it is kept 0 so no one pools it
            numerator: 0,
            value: values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length,
          };
        }),
      };
    }),
  };
}
