import { HttpResponse, type HttpHandler } from 'msw';

import { keywordProjectCaller, type KeywordProjectCaller } from './keyword-rules';
import { cursorPage, pageRequest, queryError } from './rules';
import { effectiveCompetitors } from '../factories/keyword';
import { absoluteRankOf, serpOf, titleOf, type WorldCheck } from '../serp-world';
import { invalid, mock, problem } from '../respond';
import type { StoredTracked } from '../keywords-state';
import type { Problem, Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';
import {
  aioStateOut,
  DAY_MS,
  featureOut,
  findTrackedRowOrError,
  ownEntityOf,
  pathError,
  projectHostOf,
  rankCellOf,
  serpDomainOf,
  urlRefOf,
  validateDateWindow,
  worldChecksFor,
} from '../serp-views';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
// 14-day raw retention is a mock choice: raw SERP payload expires after 14 days.
const RAW_RETENTION_MS = 14 * DAY_MS;

interface FoundSnapshot {
  kwRow: StoredTracked;
  kwText: string;
  check: WorldCheck;
  isLatest: boolean;
  ownEntity: Schemas['EntityRef'];
  effectiveComps: Schemas['EntityRef'][];
}

function findSnapshot(caller: KeywordProjectCaller, snapshotId: string, clock: number): FoundSnapshot | null {
  const ownEntity = ownEntityOf(caller);

  const liveKws = caller.keywords.tracked.filter(
    (k) => k.project_id === caller.project.project_id && k.deleted_at === null,
  );

  for (const kwRow of liveKws) {
    const effectiveComps = effectiveCompetitors(caller.keywords, caller.world, kwRow);
    const checks = worldChecksFor(caller, kwRow, clock);
    const goodChecks = checks.filter((c) => !c.failed && c.observedAt !== null);
    if (goodChecks.length === 0) continue;
    const latest = goodChecks[goodChecks.length - 1];
    const match = goodChecks.find((c) => c.snapshotId === snapshotId);
    if (match) {
      const kwRecord = caller.keywords.keywords.find((k) => k.keyword_id === kwRow.keyword_id);
      return {
        kwRow,
        kwText: kwRecord?.text ?? '',
        check: match,
        isLatest: match.snapshotId === latest?.snapshotId,
        ownEntity,
        effectiveComps,
      };
    }
  }
  return null;
}

function validateSnapshotId(request: Request, idRaw: unknown): { error?: HttpResponse<Problem>; id?: string } {
  if (typeof idRaw !== 'string' || !/^[1-9]\d*$/.test(idRaw)) {
    return {
      error: invalid(request, [
        pathError('serp_snapshot_id', 'value_error', 'Input should be greater than or equal to 1'),
      ]),
    };
  }
  try {
    const idBig = BigInt(idRaw);
    if (idBig <= 0n || idBig > 9223372036854775807n) {
      return {
        error: invalid(request, [
          pathError('serp_snapshot_id', 'value_error', 'Input should be less than or equal to 2^63 - 1'),
        ]),
      };
    }
  } catch {
    return {
      error: invalid(request, [pathError('serp_snapshot_id', 'value_error', 'Input should be a valid integer')]),
    };
  }
  return { id: idRaw };
}

export const serpHandlers: readonly HttpHandler[] = [
  // 1. serp-current
  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}/serp-current`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;

    const trackedCheck = findTrackedRowOrError(request, caller, params.tracked_keyword_id);
    if ('error' in trackedCheck) return trackedCheck.error;
    const row = trackedCheck.row;

    const clock = Date.now();
    const ownEntity = ownEntityOf(caller);
    const host = projectHostOf(caller);
    const effectiveComps = effectiveCompetitors(caller.keywords, caller.world, row);

    const checks = worldChecksFor(caller, row, clock);

    const goodChecks = checks.filter((c) => !c.failed && c.observedAt !== null);
    if (goodChecks.length === 0) {
      return HttpResponse.json({
        data: {
          serp_snapshot_id: null,
          observed_at: null,
          results: [],
        },
      });
    }

    const latest = goodChecks[goodChecks.length - 1];
    if (!latest) {
      return HttpResponse.json({
        data: {
          serp_snapshot_id: null,
          observed_at: null,
          results: [],
        },
      });
    }

    const kwRecord = caller.keywords.keywords.find((k) => k.keyword_id === row.keyword_id);
    const kwText = kwRecord?.text ?? '';

    const items = serpOf(latest, {
      own: ownEntity,
      competitors: effectiveComps,
      ownHost: host,
    });

    const top20 = items.slice(0, 20);
    const results: Schemas['SerpResult'][] = top20.map((item) => {
      const url = urlRefOf(item.host, item.path);
      const domain = serpDomainOf(item.host);
      const { title, snippet } = titleOf(item, kwText);

      return {
        organic_rank: item.rank,
        absolute_rank: absoluteRankOf(item.rank, latest.features.length),
        url,
        domain,
        title,
        snippet,
        entity: item.entity,
      };
    });

    return HttpResponse.json({
      data: {
        serp_snapshot_id: latest.snapshotId,
        observed_at: latest.observedAt,
        results,
      },
    });
  }),

  // 2. serp-snapshots
  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}/serp-snapshots`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['from', 'to', 'filter[depth_requested]', 'filter[has_ai_overview]', 'limit', 'cursor'],
    });
    if (caller instanceof Response) return caller;

    const trackedCheck = findTrackedRowOrError(request, caller, params.tracked_keyword_id);
    if ('error' in trackedCheck) return trackedCheck.error;
    const row = trackedCheck.row;

    const url = new URL(request.url);
    const pageReq = pageRequest(url);
    if (Array.isArray(pageReq)) return invalid(request, pageReq);

    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const depthParam = url.searchParams.get('filter[depth_requested]');
    const hasAioParam = url.searchParams.get('filter[has_ai_overview]');

    if (fromParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      return invalid(request, [queryError('from', 'date_parsing', 'Input should be a valid date')]);
    }
    if (toParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      return invalid(request, [queryError('to', 'date_parsing', 'Input should be a valid date')]);
    }
    if (fromParam !== null && toParam !== null && fromParam > toParam) {
      return invalid(request, [queryError('from', 'range_invalid', '`from` is after `to`.')]);
    }

    let depthFilter: number | null = null;
    if (depthParam !== null) {
      const depthNum = Number(depthParam);
      if (!Number.isInteger(depthNum) || depthNum < 1 || depthNum > 700) {
        return invalid(request, [
          queryError(
            'filter[depth_requested]',
            'value_error',
            'Input should be greater than or equal to 1 and less than or equal to 700',
          ),
        ]);
      }
      depthFilter = depthNum;
    }

    let aioFilter: boolean | null = null;
    if (hasAioParam !== null) {
      if (hasAioParam !== 'true' && hasAioParam !== 'false') {
        return invalid(request, [
          queryError('filter[has_ai_overview]', 'bool_parsing', 'Input should be a valid boolean'),
        ]);
      }
      aioFilter = hasAioParam === 'true';
    }

    const clock = Date.now();
    const host = projectHostOf(caller);

    const checks = worldChecksFor(caller, row, clock);

    const goodChecks = checks.filter((c) => !c.failed && c.observedAt !== null);

    const summaries: Schemas['SerpSnapshotSummary'][] = goodChecks.map((c) => {
      const aioState = c.aio?.state ?? 'absent';
      const aioOverviewState = aioStateOut(c.aio?.state);
      const ownCell = rankCellOf(c, host);

      return {
        serp_snapshot_id: c.snapshotId ?? '',
        observed_at: c.observedAt ?? '',
        observed_date: formatIsoDate(c.observedAt ?? '', caller.project.timezone),
        config_version: 1,
        provider_code: 'serpapi',
        provider_endpoint: 'google',
        se_domain: 'google.com',
        location_id: row.location_id,
        language_code: row.language_code,
        device: row.device,
        os: row.os,
        depth_requested: c.depth,
        depth_returned: c.depthReturned,
        se_results_count: c.depthReturned,
        item_types: ['organic', ...c.features.map((f) => f.type)],
        has_ai_overview: aioState !== 'absent' && aioState !== 'unknown',
        ai_overview_state: aioOverviewState,
        has_ai_mode_link: null,
        served_from_cache: false,
        cost_usd: '0.002',
        own: ownCell,
      };
    });

    let filtered = summaries;
    if (fromParam !== null) {
      filtered = filtered.filter((s) => s.observed_date >= fromParam);
    }
    if (toParam !== null) {
      filtered = filtered.filter((s) => s.observed_date <= toParam);
    }
    if (depthFilter !== null) {
      filtered = filtered.filter((s) => s.depth_requested === depthFilter);
    }
    if (aioFilter !== null) {
      filtered = filtered.filter((s) => s.has_ai_overview === aioFilter);
    }

    filtered.sort((a, b) => b.observed_at.localeCompare(a.observed_at));

    const filterBinding = JSON.stringify({
      from: fromParam,
      to: toParam,
      depth: depthParam,
      aio: hasAioParam,
    });

    const paged = cursorPage(filtered, pageReq, filterBinding);
    if (paged === null) {
      return problem(request, 'invalid_cursor');
    }

    return HttpResponse.json(paged);
  }),

  // 3. serp-snapshots/{serp_snapshot_id}/raw (Must register BEFORE {serp_snapshot_id} to avoid collision)
  mock('get', `${P}/serp-snapshots/{serp_snapshot_id}/raw`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'raw:read',
      query: ['observed_at'],
    });
    if (caller instanceof Response) return caller;

    const validated = validateSnapshotId(request, params.serp_snapshot_id);
    if (validated.error) return validated.error;
    const idRaw = validated.id ?? '';

    const url = new URL(request.url);
    const observedAtParam = url.searchParams.get('observed_at');
    if (observedAtParam !== null && Number.isNaN(Date.parse(observedAtParam))) {
      return invalid(request, [queryError('observed_at', 'datetime_parsing', 'Input should be a valid datetime')]);
    }

    const clock = Date.now();
    const found = findSnapshot(caller, idRaw, clock);
    if (found === null) return problem(request, 'not_found');

    if (cookies['mock_serp_raw'] === 'unavailable') {
      return problem(request, 'raw_unavailable');
    }

    const ageMs = clock - Date.parse(found.check.observedAt ?? '');
    if (ageMs > RAW_RETENTION_MS) {
      return problem(request, 'raw_expired');
    }

    const body = JSON.stringify({
      serp_snapshot_id: idRaw,
      observed_at: found.check.observedAt,
      depth_returned: found.check.depthReturned,
      engine: 'google',
    });

    return new HttpResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="serp-snapshot-${idRaw}.json"`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }),

  // 4. serp-snapshots/{serp_snapshot_id}
  mock('get', `${P}/serp-snapshots/{serp_snapshot_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['include', 'observed_at'],
    });
    if (caller instanceof Response) return caller;

    const validated = validateSnapshotId(request, params.serp_snapshot_id);
    if (validated.error) return validated.error;
    const idRaw = validated.id ?? '';

    const url = new URL(request.url);
    const observedAtParam = url.searchParams.get('observed_at');
    if (observedAtParam !== null && Number.isNaN(Date.parse(observedAtParam))) {
      return invalid(request, [queryError('observed_at', 'datetime_parsing', 'Input should be a valid datetime')]);
    }

    const includeParam = url.searchParams.get('include');
    let withTitles = false;
    if (includeParam !== null) {
      const tokens = includeParam.split(',').filter(Boolean);
      for (const token of tokens) {
        if (token !== 'titles') {
          return invalid(request, [queryError('include', 'value_error', `Invalid include: ${token}`)]);
        }
        withTitles = true;
      }
    }

    const clock = Date.now();
    const found = findSnapshot(caller, idRaw, clock);
    if (found === null) return problem(request, 'not_found');

    const { kwRow, kwText, check, isLatest, ownEntity, effectiveComps } = found;
    const host = projectHostOf(caller);

    const items = serpOf(check, {
      own: ownEntity,
      competitors: effectiveComps,
      ownHost: host,
    });

    const organic: Schemas['SerpOrganicItem'][] = items.map((item) => {
      const urlRef = urlRefOf(item.host, item.path);
      const domain = serpDomainOf(item.host);

      let title: string | null = null;
      let snippet: string | null = null;
      if (withTitles) {
        if (isLatest && item.rank <= 20) {
          const t = titleOf(item, kwText);
          title = t.title;
          snippet = t.snippet;
        } else if (item.entity !== null) {
          const t = titleOf(item, kwText);
          title = t.title;
          snippet = t.snippet;
        }
      }

      return {
        organic_rank: item.rank,
        absolute_rank: absoluteRankOf(item.rank, check.features.length),
        url: urlRef,
        domain,
        title,
        snippet,
        entity: item.entity,
      };
    });

    const titledCount = organic.filter((i) => i.title !== null).length;
    let titlesSource: Schemas['SerpSnapshotDetail']['titles_source'] = 'unavailable';
    if (withTitles && titledCount > 0) {
      titlesSource = isLatest ? 'serp_current_results' : 'domain_rank_observations';
    }

    const features: Schemas['SerpFeatureOut'][] = check.features.map((f) => featureOut(f, check, effectiveComps));

    const aioState = check.aio?.state ?? 'absent';
    const aioOverviewState = aioStateOut(check.aio?.state);
    const ownCell = rankCellOf(check, host);

    const detail: Schemas['SerpSnapshotDetail'] = {
      serp_snapshot_id: check.snapshotId ?? '',
      observed_at: check.observedAt ?? '',
      observed_date: formatIsoDate(check.observedAt ?? '', caller.project.timezone),
      config_version: 1,
      provider_code: 'serpapi',
      provider_endpoint: 'google',
      se_domain: 'google.com',
      location_id: kwRow.location_id,
      language_code: kwRow.language_code,
      device: kwRow.device,
      os: kwRow.os,
      depth_requested: check.depth,
      depth_returned: check.depthReturned,
      se_results_count: check.depthReturned,
      item_types: ['organic', ...check.features.map((f) => f.type)],
      has_ai_overview: aioState !== 'absent' && aioState !== 'unknown',
      ai_overview_state: aioOverviewState,
      has_ai_mode_link: null,
      served_from_cache: false,
      cost_usd: '0.002',
      own: ownCell,
      organic,
      features,
      provenance: {
        raw_payload_id: String(Number(idRaw) * 13 + 1),
        parser_version: 1,
        canonicalizer_version: 1,
        provider_task_id: `task_${idRaw}`,
        collection_task_id: null,
      },
      titles_source: titlesSource,
      ai_overview_observation_id: null,
    };

    return HttpResponse.json({ data: detail });
  }),

  // 5. serp-features
  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}/serp-features`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['limit_checks', 'from', 'to', 'filter[feature_type_in]'],
    });
    if (caller instanceof Response) return caller;

    const trackedCheck = findTrackedRowOrError(request, caller, params.tracked_keyword_id);
    if ('error' in trackedCheck) return trackedCheck.error;
    const row = trackedCheck.row;

    const url = new URL(request.url);
    const limitChecksRaw = url.searchParams.get('limit_checks');
    const limitChecks = limitChecksRaw === null ? 30 : Number(limitChecksRaw);
    if (!Number.isInteger(limitChecks) || limitChecks < 1 || limitChecks > 200) {
      return invalid(request, [queryError('limit_checks', 'value_error', 'Use a whole number from 1 to 200.')]);
    }

    const featureTypesParam = url.searchParams.get('filter[feature_type_in]');
    let featureTypesFilter: Set<string> | null = null;
    if (featureTypesParam !== null) {
      const types = featureTypesParam.split(',').filter(Boolean);
      if (types.length > 20) {
        return invalid(request, [
          queryError('filter[feature_type_in]', 'too_long', 'List should have at most 20 items.'),
        ]);
      }
      featureTypesFilter = new Set(types);
    }

    const clock = Date.now();
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const windowValidation = validateDateWindow(fromParam, toParam, clock, caller.project.timezone, 400);
    if ('error' in windowValidation) {
      return invalid(request, [windowValidation.error]);
    }
    if ('problem' in windowValidation) {
      return problem(request, 'window_too_large', {
        detail: 'A window is at most 400 days.',
        limit_days: windowValidation.limit_days,
      });
    }

    const { firstDate, lastDate } = windowValidation.range;

    const effectiveComps = effectiveCompetitors(caller.keywords, caller.world, row);

    const checks = worldChecksFor(caller, row, clock);

    const goodChecks = checks
      .filter((c) => {
        if (c.failed || c.observedAt === null) return false;
        const d = formatIsoDate(c.observedAt, caller.project.timezone);
        return d >= firstDate && d <= lastDate;
      })
      .slice(-limitChecks)
      .reverse(); // newest first

    const checkRows: Schemas['FeatureCheck'][] = goodChecks.map((c) => {
      const activeFeatures = c.features.filter((f) => featureTypesFilter === null || featureTypesFilter.has(f.type));
      return {
        observed_at: c.observedAt ?? '',
        serp_snapshot_id: c.snapshotId ?? '',
        depth_requested: c.depth,
        features: activeFeatures.map((f) => featureOut(f, c, effectiveComps)),
      };
    });

    const allTypesSet = new Set<string>();
    for (const c of checkRows) {
      for (const f of c.features) {
        allTypesSet.add(f.feature_type);
      }
    }
    const sortedTypes = [...allTypesSet].sort();

    const totalChecks = checkRows.length;
    const presence: Schemas['FeaturePresence'][] = sortedTypes.map((type) => {
      let presentCount = 0;
      let ownedCount = 0;
      for (const c of checkRows) {
        const found = c.features.find((f) => f.feature_type === type);
        if (found) {
          presentCount += 1;
          if (found.owned_by_project) ownedCount += 1;
        }
      }

      return {
        feature_type: type,
        presence_rate: {
          metric: 'seo.serp_feature_presence',
          value: totalChecks === 0 ? null : presentCount / totalChecks,
          numerator: presentCount,
          denominator: totalChecks,
          unit: 'ratio',
          n_observations: totalChecks,
          n_keywords: 1,
          window: { from: firstDate, to: lastDate, timezone: caller.project.timezone },
          filters: {},
          is_estimate: false,
          method: 'Share of the checks in the window',
          method_version: 1,
        },
        own_ownership_rate: {
          metric: 'seo.serp_feature_ownership',
          value: presentCount === 0 ? null : ownedCount / presentCount,
          numerator: ownedCount,
          denominator: presentCount,
          unit: 'ratio',
          n_observations: presentCount,
          n_keywords: 1,
          window: { from: firstDate, to: lastDate, timezone: caller.project.timezone },
          filters: {},
          is_estimate: false,
          method: 'Share of the checks in the window',
          method_version: 1,
        },
      };
    });

    return HttpResponse.json({
      data: {
        checks: checkRows,
        presence,
      },
    });
  }),

  // 6. aio-history
  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}/aio-history`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['from', 'to'],
    });
    if (caller instanceof Response) return caller;

    const trackedCheck = findTrackedRowOrError(request, caller, params.tracked_keyword_id);
    if ('error' in trackedCheck) return trackedCheck.error;
    const row = trackedCheck.row;

    const clock = Date.now();
    const url = new URL(request.url);
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const windowValidation = validateDateWindow(fromParam, toParam, clock, caller.project.timezone, 400);
    if ('error' in windowValidation) {
      return invalid(request, [windowValidation.error]);
    }
    if ('problem' in windowValidation) {
      return problem(request, 'window_too_large', {
        detail: 'A window is at most 400 days.',
        limit_days: windowValidation.limit_days,
      });
    }

    const { firstDate, lastDate } = windowValidation.range;

    const host = projectHostOf(caller);
    const effectiveComps = effectiveCompetitors(caller.keywords, caller.world, row);

    const checks = worldChecksFor(caller, row, clock);

    const goodChecks = checks
      .filter((c) => {
        if (c.failed || c.observedAt === null) return false;
        const d = formatIsoDate(c.observedAt, caller.project.timezone);
        return d >= firstDate && d <= lastDate;
      })
      .slice(-1000)
      .reverse(); // newest first

    const items: Schemas['AioHistoryItem'][] = goodChecks.map((c) => {
      const aioState = c.aio?.state ?? 'absent';
      const isPresent = aioState === 'present_cited' || aioState === 'present_not_cited';
      const isNotLoaded = aioState === 'not_loaded';
      const isUnknown = aioState === 'unknown';

      let ownCited: boolean | null = null;
      let ownCitationPos: number | null = null;
      if (!isUnknown && !isNotLoaded && aioState !== 'absent') {
        ownCited = aioState === 'present_cited';
        ownCitationPos = aioState === 'present_cited' ? (c.aio?.position ?? 1) : null;
      }

      // competitors_cited holds only effective competitors and only when a block is present
      const compsCited: Schemas['EntityRef'][] =
        isPresent && effectiveComps.length > 0
          ? effectiveComps.filter((comp) => {
              const compRank = c.competitorRanks.get(comp.entity_id);
              return compRank !== null && compRank !== undefined && compRank <= 10;
            })
          : [];

      const ownCell = rankCellOf(c, host);

      return {
        observed_at: c.observedAt ?? '',
        serp_snapshot_id: c.snapshotId ?? '',
        device: row.device,
        location_id: row.location_id,
        ai_overview_state: aioState,
        own_cited: ownCited,
        own_citation_position: ownCitationPos,
        competitors_cited: compsCited,
        source_count: c.aio?.sources ?? 0,
        organic_rank: ownCell,
        observation_id: null,
      };
    });

    return HttpResponse.json({ data: items });
  }),
];
