import { CAPPED, UNREAD, unreadWhy, type TrackedSet, type WeeklyPoint, type WeeklyRead } from './types';
import { weeklyShares } from './weekly-series';
import type { PromptsSummary } from '@/lib/api/types';
import type { RateState } from '@/lib/stats';

/**
 * The weekly share of voice over the platforms the page scope asks for: one platform's own points, or for All
 * platforms the equal-weight average, week by week, of the platforms with a share that week (R3). A week that no
 * platform has a share for is a gap, never an average of nothing. The shares of every platform add up to 1, so their
 * average does too. Each averaged brand keeps the x of y brand mentions of every platform behind it (`counts`).
 */
export function weeklySharesAcross(
  summary: PromptsSummary,
  codes: readonly string[],
  set: TrackedSet,
): WeeklyRead<WeeklyPoint> {
  const reads = codes.map((code) => weeklyShares(summary, code, set));
  const byPlatform = reads.flatMap((read, index) =>
    read.status === 'read' ? [{ code: codes[index] ?? '', points: read.points }] : [],
  );
  if (byPlatform.length === 0) return unreadWhy(...reads) === 'capped' ? CAPPED : UNREAD;
  const [only] = byPlatform;
  if (byPlatform.length === 1 && only !== undefined) return { status: 'read', points: only.points };
  const weeks = [...new Set(byPlatform.flatMap(({ points }) => points.map((point) => point.weekStart)))].sort();
  return {
    status: 'read',
    points: weeks.map((weekStart): WeeklyPoint => {
      const here = byPlatform.flatMap(({ code, points }) =>
        points.filter((point) => point.weekStart === weekStart).map((point) => ({ code, point })),
      );
      const rated = here.filter(({ point }) => point.state === 'ok');
      const answers = Math.max(0, ...here.map(({ point }) => point.answers));
      const state: RateState = rated.length > 0 ? 'ok' : answers > 0 ? 'insufficient' : 'none';
      const pooled = here.find(({ point }) => point.pool !== null)?.point.pool ?? null;
      return {
        weekStart,
        answers,
        state,
        pool: pooled,
        entities: set.entities.map((entity) => {
          const parts = rated.flatMap(({ code, point }) => {
            const share = point.entities.find((entry) => entry.entityId === entity.entityId);
            return share === undefined || share.value === null
              ? []
              : [{ code, value: share.value, k: share.numerator, n: point.answers }];
          });
          return {
            entityId: entity.entityId,
            // A numerator of an average is not a count: it is kept 0 so no one pools it
            numerator: 0,
            value: parts.length === 0 ? null : parts.reduce((total, part) => total + part.value, 0) / parts.length,
            counts: parts.map(({ code, k, n }) => ({ code, k, n })),
          };
        }),
      };
    }),
  };
}
