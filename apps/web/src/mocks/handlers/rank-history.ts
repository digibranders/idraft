import { HttpResponse, type HttpHandler } from 'msw';

import { keywordProjectCaller, rankContext } from './keyword-rules';
import { queryError } from './rules';
import { entityRefView } from '../factories/entity';
import { configHistoryView, effectiveCompetitors } from '../factories/keyword';
import { CHECKED_FIXTURES, FAILED_IDS, FAILING_IDS, checksAt, competitorChecksOf, stoppedAtOf } from '../rank-state';
import { invalid, mock, problem } from '../respond';
import type { Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const QUERY_PARAMS = ['from', 'to', 'window', 'entity_ids', 'include', 'format'] as const;

const VALID_WINDOWS: Record<string, number> = {
  last_7d: 7,
  last_14d: 14,
  last_30d: 30,
  last_90d: 90,
  last_180d: 180,
  last_365d: 365,
};

/**
 * Rank history route for tracked keywords.
 * The mock keeps 30 checks, so at most 30 points are returned.
 */
export const rankHistoryHandlers: readonly HttpHandler[] = [
  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}/rank-history`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: QUERY_PARAMS,
    });
    if (caller instanceof Response) return caller;

    const row = caller.keywords.tracked.find(
      (candidate) =>
        candidate.tracked_keyword_id === params.tracked_keyword_id &&
        candidate.project_id === caller.project.project_id &&
        candidate.deleted_at === null,
    );
    if (row === undefined) return problem(request, 'not_found');

    const url = new URL(request.url);
    const windowParam = url.searchParams.get('window') ?? 'last_90d';
    if (!(windowParam in VALID_WINDOWS)) {
      return invalid(request, [queryError('window', 'value_error', 'Invalid window parameter')]);
    }

    const clock = Date.now();
    const days = VALID_WINDOWS[windowParam] ?? 90;
    const windowStartMs = clock - days * 24 * 60 * 60 * 1000;
    const rank = rankContext(caller);

    const toDate = (iso: string): string => formatIsoDate(iso, caller.project.timezone);

    const ownRole =
      caller.world.roles.find(
        (r) =>
          r.project_id === caller.project.project_id &&
          r.role === 'own' &&
          (r.is_primary ?? true) &&
          (r.removed_at ?? null) === null,
      ) ??
      caller.world.roles.find(
        (r) => r.project_id === caller.project.project_id && r.role === 'own' && (r.removed_at ?? null) === null,
      );
    const ownEntityRecord = ownRole ? caller.world.entities.find((e) => e.entity_id === ownRole.entity_id) : undefined;
    const ownEntity: Schemas['EntityRef'] = ownEntityRecord
      ? entityRefView(ownEntityRecord, ownRole)
      : {
          entity_id: 'own',
          canonical_name: caller.project.name,
          entity_type: 'organization',
          role: 'own',
          color_index: null,
        };

    const isFailedFixture = FAILED_IDS.has(row.tracked_keyword_id);
    const isFailingFixture = FAILING_IDS.has(row.tracked_keyword_id);
    const isFirstCheckedFixture = row.tracked_keyword_id === CHECKED_FIXTURES[0];

    const competitors = effectiveCompetitors(caller.keywords, caller.world, row);

    let ownPoints: Schemas['HistoryPoint'][];
    let competitorSeries: Schemas['HistorySeries'][];

    if (isFailedFixture) {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const failedTimes = [clock - 2 * DAY_MS, clock - DAY_MS, clock];
      ownPoints = failedTimes.map((t) => ({
        absolute_rank: null,
        date: toDate(new Date(t).toISOString()),
        depth_requested: null,
        observed_at: new Date(t).toISOString(),
        rank: null,
        serp_snapshot_id: null,
        state: 'failed',
        url_id: null,
      }));

      competitorSeries = competitors.map((comp) => ({
        entity: comp,
        points: failedTimes.map((t) => ({
          absolute_rank: null,
          date: toDate(new Date(t).toISOString()),
          depth_requested: null,
          observed_at: new Date(t).toISOString(),
          rank: null,
          serp_snapshot_id: null,
          state: 'failed',
          url_id: null,
        })),
      }));
    } else {
      const ownChecksAll = checksAt(row.tracked_keyword_id, row.created_at, clock, rank.domain, stoppedAtOf(row));
      const ownChecks = ownChecksAll.filter((c) => Date.parse(c.observedAt) >= windowStartMs);

      if (isFirstCheckedFixture && ownChecks.length >= 2) {
        const lastCheck = ownChecks[ownChecks.length - 1];
        if (lastCheck !== undefined) {
          const extraObservedAt = new Date(Date.parse(lastCheck.observedAt) + 12 * 60 * 60 * 1000).toISOString();
          ownChecks.push({
            ...lastCheck,
            observedAt: extraObservedAt,
            rank: lastCheck.rank === null ? null : Math.max(1, lastCheck.rank - 1),
          });
          if (ownChecks.length > 30) {
            ownChecks.shift();
          }
        }
      }

      ownPoints = ownChecks.map((c, idx) => {
        const isFailedPoint = isFailingFixture && idx >= ownChecks.length - 2;
        return {
          absolute_rank: isFailedPoint ? null : c.rank,
          date: toDate(c.observedAt),
          depth_requested: isFailedPoint ? null : c.depth,
          observed_at: c.observedAt,
          rank: isFailedPoint ? null : c.rank,
          serp_snapshot_id: null,
          state: isFailedPoint ? 'failed' : c.rank === null ? 'beyond_depth' : 'ranked',
          url_id: null,
        };
      });

      competitorSeries = competitors.map((comp) => {
        const compChecks = competitorChecksOf(
          row.tracked_keyword_id,
          comp.entity_id,
          row.created_at,
          clock,
          stoppedAtOf(row),
        ).filter((c) => Date.parse(c.observedAt) >= windowStartMs);

        if (isFirstCheckedFixture && compChecks.length >= 2) {
          const lastCompCheck = compChecks[compChecks.length - 1];
          if (lastCompCheck !== undefined) {
            const extraObservedAt = new Date(Date.parse(lastCompCheck.observedAt) + 12 * 60 * 60 * 1000).toISOString();
            compChecks.push({
              ...lastCompCheck,
              observedAt: extraObservedAt,
              rank: lastCompCheck.rank === null ? null : Math.max(1, lastCompCheck.rank - 1),
            });
            if (compChecks.length > 30) {
              compChecks.shift();
            }
          }
        }

        return {
          entity: comp,
          points: compChecks.map((c, idx) => {
            const isFailedPoint = isFailingFixture && idx >= compChecks.length - 2;
            return {
              absolute_rank: isFailedPoint ? null : c.rank,
              date: toDate(c.observedAt),
              depth_requested: isFailedPoint ? null : c.depth,
              observed_at: c.observedAt,
              rank: isFailedPoint ? null : c.rank,
              serp_snapshot_id: null,
              state: isFailedPoint ? 'failed' : c.rank === null ? 'beyond_depth' : 'ranked',
              url_id: null,
            };
          }),
        };
      });
    }

    const series: Schemas['HistorySeries'][] = [
      {
        entity: ownEntity,
        points: ownPoints,
      },
      ...competitorSeries,
    ];

    const bands: Schemas['HistoryBand'][] = [];
    let currentRun: { from: string; to: string; minDepth: number } | null = null;
    for (const point of ownPoints) {
      if (point.state === 'beyond_depth') {
        const depth = point.depth_requested ?? 20;
        if (currentRun === null) {
          currentRun = { from: point.date, to: point.date, minDepth: depth };
        } else {
          currentRun.to = point.date;
          currentRun.minDepth = Math.min(currentRun.minDepth, depth);
        }
      } else {
        if (currentRun !== null) {
          bands.push({
            entity_id: ownEntity.entity_id,
            from: currentRun.from,
            to: currentRun.to,
            depth_requested: currentRun.minDepth,
            kind: 'beyond_depth',
            label: `Not in top ${String(currentRun.minDepth)}`,
          });
          currentRun = null;
        }
      }
    }
    if (currentRun !== null) {
      bands.push({
        entity_id: ownEntity.entity_id,
        from: currentRun.from,
        to: currentRun.to,
        depth_requested: currentRun.minDepth,
        kind: 'beyond_depth',
        label: `Not in top ${String(currentRun.minDepth)}`,
      });
    }

    const rankedChecks = ownPoints.filter((p) => p.state === 'ranked').length;
    const beyondChecks = ownPoints.filter((p) => p.state === 'beyond_depth').length;
    const failedChecks = ownPoints.filter((p) => p.state === 'failed').length;
    const summary: Schemas['HistorySummary'] = {
      checks: ownPoints.length,
      ranked_checks: rankedChecks,
      beyond_depth_checks: beyondChecks,
      failed_checks: failedChecks,
      average_rank: null,
    };

    const windowStartStr = toDate(new Date(windowStartMs).toISOString());
    const windowEndStr = toDate(new Date(clock).toISOString());
    const window: Schemas['HistoryWindow'] = {
      from: url.searchParams.get('from') ?? windowStartStr,
      to: url.searchParams.get('to') ?? windowEndStr,
      timezone: caller.project.timezone,
    };

    const data: Schemas['RankHistory'] = {
      tracked_keyword_id: row.tracked_keyword_id,
      window,
      summary,
      series,
      bands,
      columns: null,
      events: null,
      deep_check_weekday: 1,
      urls: {},
      version_boundaries: [],
      config_history: configHistoryView(row),
    };

    return HttpResponse.json({ data });
  }),
];
