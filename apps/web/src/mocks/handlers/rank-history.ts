import { HttpResponse, type HttpHandler } from 'msw';

import { keywordProjectCaller, rankContext } from './keyword-rules';
import { queryError } from './rules';
import { entityRefView } from '../factories/entity';
import { registrableDomain } from '../factories/domain';
import { configHistoryView, effectiveCompetitors } from '../factories/keyword';
import { stoppedAtOf } from '../rank-state';
import { absoluteRankOf, OWN_ENTITY_REF, snapshotIdOf, worldChecks } from '../serp-world';
import { invalid, mock, problem } from '../respond';
import type { HistoryColumns, Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';
import { hashOf } from '../rank-history';

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const QUERY_PARAMS = ['from', 'to', 'window', 'entity_ids', 'include', 'format'] as const;

const VALID_WINDOWS: Record<string, number> = {
  last_7d: 7,
  last_30d: 30,
  last_90d: 90,
  last_180d: 180,
  last_365d: 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ENTITIES_MAX = 11;

/**
 * Rank history route for tracked keywords.
 * Answers series, bands, and summary across the deterministic worldChecks.
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
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const windowParam = url.searchParams.get('window');

    const clock = Date.now();
    const toDate = (iso: string): string => formatIsoDate(iso, caller.project.timezone);

    let firstDate: string;
    let lastDate: string;

    if (fromParam !== null || toParam !== null) {
      lastDate = toParam ?? formatIsoDate(new Date(clock).toISOString(), caller.project.timezone);
      firstDate = fromParam ?? shiftIsoDate(lastDate, -89);
      if (firstDate > lastDate) {
        return invalid(request, [queryError('from', 'range_invalid', '`from` is after `to`.')]);
      }
      const daysDiff =
        Math.round((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / DAY_MS) + 1;
      if (daysDiff > 400) {
        return problem(request, 'window_too_large', {
          detail: 'A window is at most 400 days.',
          limit_days: 400,
        });
      }
    } else {
      const win = windowParam ?? 'last_90d';
      const days = VALID_WINDOWS[win];
      if (days === undefined) {
        return invalid(request, [
          queryError('window', 'invalid_window', `Use one of: ${Object.keys(VALID_WINDOWS).join(', ')}.`),
        ]);
      }
      lastDate = formatIsoDate(new Date(clock).toISOString(), caller.project.timezone);
      firstDate = shiftIsoDate(lastDate, -(days - 1));
    }

    const includeParam = url.searchParams.get('include');
    const include = new Set<string>();
    if (includeParam) {
      const tokens = includeParam.split(',').filter(Boolean);
      for (const token of tokens) {
        if (token !== 'absolute' && token !== 'url' && token !== 'events') {
          return invalid(request, [queryError('include', 'value_error', `Invalid include: ${token}`)]);
        }
        include.add(token);
      }
    }

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
    const ownEntity: Schemas['EntityRef'] = ownEntityRecord ? entityRefView(ownEntityRecord, ownRole) : OWN_ENTITY_REF;

    const effectiveComps = effectiveCompetitors(caller.keywords, caller.world, row);

    const format = url.searchParams.get('format') ?? 'points';
    if (format !== 'points' && format !== 'columns') {
      return invalid(request, [queryError('format', 'value_error', `Invalid format: ${format}`)]);
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Entity resolution
    const entityIdsParam = url.searchParams.get('entity_ids');
    let wantedEntities: Schemas['EntityRef'][];
    if (entityIdsParam !== null) {
      const tokens = entityIdsParam.split(',').filter(Boolean);
      for (const token of tokens) {
        if (token.toLowerCase() !== 'own' && !UUID_REGEX.test(token)) {
          return invalid(request, [queryError('entity_ids', 'invalid_uuid', `Invalid entity id: ${token}`)]);
        }
      }
      const tokenMap = new Map<string, string>();
      for (const rawToken of tokens) {
        const token = rawToken.toLowerCase();
        const resolvedId = token;
        if (!tokenMap.has(resolvedId)) {
          tokenMap.set(resolvedId, token);
        }
      }
      if (tokenMap.size > ENTITIES_MAX) {
        return invalid(request, [
          queryError('entity_ids', 'too_many_entities', `At most ${String(ENTITIES_MAX)} entities.`),
        ]);
      }
      const resolved = new Map<string, Schemas['EntityRef']>();
      for (const [resolvedId, token] of tokenMap) {
        if (token === 'own' || resolvedId === ownEntity.entity_id.toLowerCase()) {
          resolved.set(ownEntity.entity_id, ownEntity);
          continue;
        }
        const comp = effectiveComps.find((c) => c.entity_id.toLowerCase() === resolvedId);
        if (comp !== undefined) {
          resolved.set(comp.entity_id, comp);
          continue;
        }
        const entityRec = caller.world.entities.find((e) => e.entity_id.toLowerCase() === resolvedId);
        const roleRec = caller.world.roles.find(
          (r) =>
            r.project_id === caller.project.project_id &&
            r.entity_id.toLowerCase() === resolvedId &&
            (r.removed_at ?? null) === null,
        );
        if (entityRec && roleRec) {
          resolved.set(entityRec.entity_id, entityRefView(entityRec, roleRec));
        }
      }
      wantedEntities = Array.from(resolved.values());
    } else {
      wantedEntities = [ownEntity, ...effectiveComps].slice(0, ENTITIES_MAX);
    }

    // Scenarios for inspector testing
    const scenario = cookies['mock_rank_history'];
    if (scenario === 'one-check') {
      const date = '2026-10-01';
      const obsAt = `${date}T02:00:00Z`;
      const snapId = snapshotIdOf(row.tracked_keyword_id, obsAt);
      const p: Schemas['HistoryPoint'] = {
        date,
        rank: null,
        depth_requested: 20,
        state: 'beyond_depth',
        observed_at: obsAt,
        serp_snapshot_id: snapId,
        url_id: null,
        absolute_rank: null,
      };
      return HttpResponse.json({
        data: {
          tracked_keyword_id: row.tracked_keyword_id,
          bands: [
            {
              entity_id: ownEntity.entity_id,
              from: date,
              to: date,
              depth_requested: 20,
              kind: 'beyond_depth',
              label: 'not in top 20',
            },
          ],
          columns: null,
          config_history: [],
          deep_check_weekday: 1,
          events: include.has('events') ? [] : null,
          series: [{ entity: ownEntity, points: [p] }],
          summary: {
            checks: 1,
            ranked_checks: 0,
            beyond_depth_checks: 1,
            failed_checks: 0,
            average_rank: null,
          },
          urls: {},
          version_boundaries: [],
          window: { from: date, to: date, timezone: caller.project.timezone },
        },
      });
    }

    if (scenario === 'run-at-start' || scenario === 'run-at-end' || scenario === 'middle-run') {
      const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
      const ranks =
        scenario === 'run-at-start'
          ? [null, null, 12, 10, 8]
          : scenario === 'run-at-end'
            ? [8, 10, 14, null, null]
            : [5, null, null, 7, 6];
      const bandFrom =
        scenario === 'run-at-start' ? '2026-10-01' : scenario === 'run-at-end' ? '2026-10-04' : '2026-10-02';
      const bandTo =
        scenario === 'run-at-start' ? '2026-10-02' : scenario === 'run-at-end' ? '2026-10-05' : '2026-10-03';
      const points: Schemas['HistoryPoint'][] = dates.map((date, i) => {
        const obsAt = `${date}T02:00:00Z`;
        const snapId = snapshotIdOf(row.tracked_keyword_id, obsAt);
        const r = ranks[i] ?? null;
        return {
          date,
          rank: r,
          depth_requested: 50,
          state: r === null ? 'beyond_depth' : 'ranked',
          observed_at: obsAt,
          serp_snapshot_id: snapId,
          url_id: null,
          absolute_rank: r,
        };
      });
      const rankedVals = ranks.filter((r): r is number => r !== null);
      const sum = rankedVals.reduce((a, b) => a + b, 0);
      const avg: Schemas['MetricValue'] = {
        metric: 'seo.average_rank',
        value: sum / rankedVals.length,
        numerator: sum,
        denominator: rankedVals.length,
        unit: 'rank',
        n_observations: 5,
        n_keywords: 1,
        window: { from: '2026-10-01', to: '2026-10-05', timezone: caller.project.timezone },
        filters: { entity: 'own' },
        is_estimate: false,
        method: 'Mean organic rank over ranked checks only; beyond-depth checks excluded and counted',
        method_version: 1,
      };
      return HttpResponse.json({
        data: {
          tracked_keyword_id: row.tracked_keyword_id,
          bands: [
            {
              entity_id: ownEntity.entity_id,
              from: bandFrom,
              to: bandTo,
              depth_requested: 50,
              kind: 'beyond_depth',
              label: 'not in top 50',
            },
          ],
          columns: null,
          config_history: [],
          deep_check_weekday: 1,
          events: include.has('events') ? [] : null,
          series: [{ entity: ownEntity, points }],
          summary: {
            checks: 5,
            ranked_checks: rankedVals.length,
            beyond_depth_checks: 5 - rankedVals.length,
            failed_checks: 0,
            average_rank: avg,
          },
          urls: {},
          version_boundaries: [],
          window: { from: '2026-10-01', to: '2026-10-05', timezone: caller.project.timezone },
        },
      });
    }

    if (scenario === 'depth-20' || scenario === 'depth-100') {
      const depth = scenario === 'depth-20' ? 20 : 100;
      const initialRank = scenario === 'depth-20' ? 15 : 65;
      const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
      const ranks = [initialRank, null, null];
      const points: Schemas['HistoryPoint'][] = dates.map((date, i) => {
        const obsAt = `${date}T02:00:00Z`;
        const snapId = snapshotIdOf(row.tracked_keyword_id, obsAt);
        const r = ranks[i] ?? null;
        return {
          date,
          rank: r,
          depth_requested: depth,
          state: r === null ? 'beyond_depth' : 'ranked',
          observed_at: obsAt,
          serp_snapshot_id: snapId,
          url_id: null,
          absolute_rank: r,
        };
      });
      const avg: Schemas['MetricValue'] = {
        metric: 'seo.average_rank',
        value: initialRank,
        numerator: initialRank,
        denominator: 1,
        unit: 'rank',
        n_observations: 3,
        n_keywords: 1,
        window: { from: '2026-10-01', to: '2026-10-03', timezone: caller.project.timezone },
        filters: { entity: 'own' },
        is_estimate: false,
        method: 'Mean organic rank over ranked checks only; beyond-depth checks excluded and counted',
        method_version: 1,
      };
      return HttpResponse.json({
        data: {
          tracked_keyword_id: row.tracked_keyword_id,
          bands: [
            {
              entity_id: ownEntity.entity_id,
              from: '2026-10-02',
              to: '2026-10-03',
              depth_requested: depth,
              kind: 'beyond_depth',
              label: `not in top ${String(depth)}`,
            },
          ],
          columns: null,
          config_history: [],
          deep_check_weekday: 1,
          events: include.has('events') ? [] : null,
          series: [{ entity: ownEntity, points }],
          summary: {
            checks: 3,
            ranked_checks: 1,
            beyond_depth_checks: 2,
            failed_checks: 0,
            average_rank: avg,
          },
          urls: {},
          version_boundaries: [],
          window: { from: '2026-10-01', to: '2026-10-03', timezone: caller.project.timezone },
        },
      });
    }

    const rank = rankContext(caller, clock);

    // Call worldChecks with all effective competitors
    const allChecks = worldChecks({
      trackedId: row.tracked_keyword_id,
      createdAt: row.created_at,
      now: clock,
      domain: rank.domain,
      stoppedAt: stoppedAtOf(row),
      own: ownEntity,
      competitors: effectiveComps,
    });

    // Filter by window
    const windowChecks = allChecks.filter((c) => {
      const d = toDate(c.observedAt ?? c.attemptAt);
      return d >= firstDate && d <= lastDate;
    });

    // Competitor host resolution
    const entityHostMap = new Map<string, string>();
    for (const comp of effectiveComps) {
      const domainRec = caller.world.domains.find((d) => d.entity_id === comp.entity_id);
      const host = domainRec ? domainRec.host : `${comp.canonical_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
      entityHostMap.set(comp.entity_id, host);
    }
    const projectHost =
      caller.project.primary_domain?.host ??
      caller.world.domains.find((d) => d.entity_id === ownEntity.entity_id)?.host ??
      '';
    const ownHost = (rank.domain ?? projectHost).toLowerCase();

    const urls: Record<string, Schemas['UrlRef']> = {};

    const series: Schemas['HistorySeries'][] = wantedEntities.map((entity) => {
      const isOwn = entity.entity_id === ownEntity.entity_id || entity.role === 'own';
      const host = isOwn ? ownHost : (entityHostMap.get(entity.entity_id) ?? 'competitor.com');

      const points: Schemas['HistoryPoint'][] = windowChecks.map((c) => {
        const date = toDate(c.observedAt ?? c.attemptAt);
        if (c.failed) {
          return {
            date,
            observed_at: null,
            state: 'failed',
            rank: null,
            absolute_rank: null,
            depth_requested: null,
            url_id: null,
            serp_snapshot_id: null,
          };
        }

        const rankVal = isOwn ? c.rank : (c.competitorRanks.get(entity.entity_id) ?? null);
        const ranked = rankVal !== null;

        let urlId: string | null = null;
        if (include.has('url') && ranked) {
          const path = isOwn
            ? (c.path ?? '/')
            : `/${(hashOf(`${entity.entity_id}:${c.observedAt ?? ''}:${String(rankVal)}`) >>> 0).toString(36)}`;
          const canonical = `https://${host}${path}`;
          urlId = String((hashOf(canonical) % 2_000_000_000) + 1);
          if (!(urlId in urls)) {
            urls[urlId] = {
              url_id: urlId,
              canonical_url: canonical,
              host,
              path,
              registrable_domain: registrableDomain(host),
            };
          }
        }

        // Derived from organic rank plus the count of features placed above organic results (at most 2).
        const absRank = include.has('absolute') && ranked ? absoluteRankOf(rankVal, c.features.length) : null;

        return {
          date,
          observed_at: c.observedAt,
          state: ranked ? 'ranked' : 'beyond_depth',
          rank: rankVal,
          absolute_rank: absRank,
          depth_requested: c.depth,
          url_id: urlId,
          serp_snapshot_id: c.snapshotId,
        };
      });

      return {
        entity,
        points,
      };
    });

    // Compute bands for every returned entity
    const bands: Schemas['HistoryBand'][] = [];
    for (const s of series) {
      let run: Array<{ date: string; depth: number }> = [];
      const closeRun = () => {
        if (run.length > 0 && run[0] !== undefined) {
          const depth = run[0].depth;
          bands.push({
            entity_id: s.entity.entity_id,
            from: run[0].date,
            to: run[run.length - 1]?.date ?? run[0].date,
            depth_requested: depth,
            kind: 'beyond_depth',
            label: `not in top ${String(depth)}`,
          });
        }
        run = [];
      };

      for (const point of s.points) {
        if (point.state === 'beyond_depth') {
          const depth = point.depth_requested ?? 20;
          if (run.length === 0 || run[0]?.depth === depth) {
            run.push({ date: point.date, depth });
            continue;
          }
          closeRun();
          run.push({ date: point.date, depth });
        } else {
          closeRun();
        }
      }
      closeRun();
    }

    // Summary computed from own series with no fallback
    const ownSeries = series.find((s) => s.entity.entity_id === ownEntity.entity_id || s.entity.role === 'own');
    const ownPoints = ownSeries?.points ?? [];
    const rankedPoints = ownPoints.filter((p) => p.state === 'ranked');
    const beyondChecks = ownPoints.filter((p) => p.state === 'beyond_depth').length;
    const failedChecks = ownPoints.filter((p) => p.state === 'failed').length;
    const rankedCount = rankedPoints.length;
    const checksCount = rankedCount + beyondChecks;

    let averageRank: Schemas['MetricValue'] | null = null;
    if (rankedCount > 0) {
      const sum = rankedPoints.reduce((acc, p) => acc + (p.rank ?? 0), 0);
      averageRank = {
        metric: 'seo.average_rank',
        value: sum / rankedCount,
        numerator: sum,
        denominator: rankedCount,
        unit: 'rank',
        n_observations: checksCount,
        n_keywords: 1,
        window: {
          from: firstDate,
          to: lastDate,
          timezone: caller.project.timezone,
        },
        filters: { entity: 'own' },
        is_estimate: false,
        method: 'Mean organic rank over ranked checks only; beyond-depth checks excluded and counted',
        method_version: 1,
      };
    }

    const summary: Schemas['HistorySummary'] = {
      checks: checksCount,
      ranked_checks: rankedCount,
      beyond_depth_checks: beyondChecks,
      failed_checks: failedChecks,
      average_rank: averageRank,
    };

    const windowShape: Schemas['HistoryWindow'] = {
      from: firstDate,
      to: lastDate,
      timezone: caller.project.timezone,
    };

    const columnsData: HistoryColumns[] | null =
      format === 'columns'
        ? series.map((s) => ({
            entity: s.entity,
            t: s.points.map((p) => p.observed_at),
            state: s.points.map((p) => p.state),
            rank: s.points.map((p) => p.rank),
            absolute_rank: s.points.map((p) => p.absolute_rank),
            depth_requested: s.points.map((p) => p.depth_requested),
            url_id: s.points.map((p) => p.url_id),
            serp_snapshot_id: s.points.map((p) => p.serp_snapshot_id),
          }))
        : null;

    const data: Schemas['RankHistory'] = {
      tracked_keyword_id: row.tracked_keyword_id,
      window: windowShape,
      summary,
      series: format === 'columns' ? null : series,
      bands,
      columns: columnsData,
      events: include.has('events') ? [] : null,
      deep_check_weekday: 1,
      urls,
      version_boundaries: [],
      config_history: configHistoryView(row),
    };

    return HttpResponse.json({ data });
  }),
];
