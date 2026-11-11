import type { HttpResponse } from 'msw';
import { TZDate } from '@date-fns/tz';
import { formatIsoDate } from '@/lib/format';
import type { Problem, Schemas, ValidationItem } from '@/lib/api/types';
import { OWNABLE_FEATURE_TYPES } from '@/lib/keywords/serp-features';
import { registrableDomain } from './factories/domain';
import { entityRefView } from './factories/entity';
import { effectiveCompetitors } from './factories/keyword';
import type { KeywordProjectCaller } from './handlers/keyword-rules';
import type { StoredTracked } from './keywords-state';
import { hashOf } from './rank-history';
import { stoppedAtOf } from './rank-state';
import { invalid, problem } from './respond';
import {
  absoluteRankOf,
  OWN_ENTITY_REF,
  worldChecks,
  type FeatureAt,
  type WorldCheck,
  type WorldChecksInput,
} from './serp-world';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const isUuid = (id: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);

export const pathError = (path: string, code: string, message: string): ValidationItem => ({
  location: 'path',
  path,
  code,
  message,
});

export function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(firstDate: string, lastDate: string): number {
  return Math.round((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / DAY_MS) + 1;
}

export function ownEntityOf(caller: KeywordProjectCaller): Schemas['EntityRef'] {
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
  const ownRecord = ownRole ? caller.world.entities.find((e) => e.entity_id === ownRole.entity_id) : undefined;
  return ownRecord ? entityRefView(ownRecord, ownRole) : OWN_ENTITY_REF;
}

export function projectHostOf(caller: KeywordProjectCaller): string | null {
  return caller.project.primary_domain?.host ?? null;
}

/** The one place the world input of a tracked keyword is built, so every route gives the world the same domain. */
export function worldInputFor(
  caller: KeywordProjectCaller,
  tracked: StoredTracked,
  now: number,
  own: Schemas['EntityRef'] = ownEntityOf(caller),
): WorldChecksInput {
  return {
    trackedId: tracked.tracked_keyword_id,
    createdAt: tracked.created_at,
    now,
    domain: projectHostOf(caller),
    stoppedAt: stoppedAtOf(tracked),
    own,
    competitors: effectiveCompetitors(caller.keywords, caller.world, tracked),
  };
}

export function worldChecksFor(caller: KeywordProjectCaller, tracked: StoredTracked, now: number): WorldCheck[] {
  return worldChecks(worldInputFor(caller, tracked, now));
}

export function findTrackedRowOrError(
  request: Request,
  caller: KeywordProjectCaller,
  rawId: unknown,
): { row: StoredTracked } | { error: HttpResponse<Problem> } {
  if (typeof rawId !== 'string' || !isUuid(rawId)) {
    return {
      error: invalid(request, [pathError('tracked_keyword_id', 'uuid_parsing', 'Input should be a valid UUID')]),
    };
  }
  const row = caller.keywords.tracked.find(
    (k) => k.tracked_keyword_id === rawId && k.project_id === caller.project.project_id && k.deleted_at === null,
  );
  if (row === undefined) {
    return { error: problem(request, 'not_found') };
  }
  return { row };
}

export function serpDomainOf(host: string): Schemas['SerpDomain'] {
  return {
    domain_id: (hashOf(host) % 1_000_000) + 1,
    host,
    registrable_domain: registrableDomain(host),
  };
}

export function urlRefOf(host: string, path: string): Schemas['UrlRef'] {
  const canonical = `https://${host}${path}`;
  const urlId = String((hashOf(canonical) % 2_000_000_000) + 1);
  return {
    url_id: urlId,
    canonical_url: canonical,
    host,
    path,
    registrable_domain: registrableDomain(host),
  };
}

export function rankCellOf(check: WorldCheck | undefined, host: string | null): Schemas['RankCell'] {
  if (!check || check.failed || check.observedAt === null) {
    return {
      state: 'not_checked',
      rank: null,
      absolute_rank: null,
      depth_requested: null,
      url: null,
      observed_at: null,
      serp_snapshot_id: null,
    };
  }

  const isRanked = check.rank !== null;
  const url = isRanked && check.path !== null && host !== null ? urlRefOf(host, check.path) : null;

  return {
    state: isRanked ? 'ranked' : 'beyond_depth',
    rank: check.rank,
    absolute_rank: absoluteRankOf(check.rank, check.features.length),
    depth_requested: check.depth,
    url,
    observed_at: check.observedAt,
    serp_snapshot_id: check.snapshotId,
  };
}

export function featureOut(
  f: FeatureAt,
  check: WorldCheck,
  effectiveComps: readonly Schemas['EntityRef'][] = [],
): Schemas['SerpFeatureOut'] {
  const isAio = f.type === 'ai_overview';
  const aioSources = isAio ? (check.aio?.sources ?? 0) : 0;
  const sourceUrls: Schemas['UrlRef'][] = [];
  if (isAio && aioSources > 0) {
    for (let s = 1; s <= aioSources; s += 1) {
      const srcHost = `source-${String(s)}.com`;
      sourceUrls.push(urlRefOf(srcHost, '/article'));
    }
  }

  const competitorEntityIds: string[] = [];
  for (const comp of effectiveComps) {
    const compRank = check.competitorRanks.get(comp.entity_id);
    if (compRank !== null && compRank !== undefined && compRank <= 10) {
      const isOwnable = (OWNABLE_FEATURE_TYPES as readonly string[]).includes(f.type);
      if (isOwnable && hashOf(`${comp.entity_id}:${check.observedAt ?? ''}:${f.type}`) % 4 === 0) {
        competitorEntityIds.push(comp.entity_id);
      }
    }
  }

  return {
    feature_type: f.type,
    ordinal: f.ordinal,
    rank_absolute: f.positionAbsolute,
    owned_by_project: f.owned && f.type !== 'ai_overview',
    owned_position: f.owned && f.type !== 'ai_overview' ? f.positionAbsolute : null,
    competitor_entity_ids: competitorEntityIds.sort(),
    source_urls: sourceUrls,
    payload: {},
  };
}

export function aioStateOut(state: string | undefined): Schemas['SerpSnapshotSummary']['ai_overview_state'] {
  if (!state || state === 'unknown') return null;
  if (state === 'not_loaded') return 'present_not_loaded';
  if (state === 'present_cited' || state === 'present_not_cited') return 'present';
  if (state === 'absent') return 'absent';
  return null;
}

export interface ParsedDateParam {
  isInstant: boolean;
  instantMs?: number | undefined;
  localDate?: string | undefined;
}

export function parseDateOrInstant(val: string, timezone: string): ParsedDateParam | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const parsed = Date.parse(`${val}T00:00:00Z`);
    if (Number.isNaN(parsed)) return null;
    return { isInstant: false, localDate: val };
  }
  const instantMs = Date.parse(val);
  if (Number.isNaN(instantMs)) return null;
  return { isInstant: true, instantMs, localDate: formatIsoDate(val, timezone) };
}

export interface NumericTimeBounds {
  minMs: number | null;
  maxMs: number | null;
}

/** The instant a local calendar day (`YYYY-MM-DD`) starts in `timezone`, whatever the zone of the machine. */
function startOfLocalDayMs(isoDate: string, timezone: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new TZDate(year, month - 1, day, timezone).getTime();
}

/**
 * The instants a request window covers, computed once per request so each event is compared as a number.
 * A date is a project local day (`from` its first instant, `to` its last); a timestamp is an instant.
 */
export function toTimeBounds(
  since: ParsedDateParam | null,
  until: ParsedDateParam | null,
  timezone: string,
): NumericTimeBounds {
  let minMs: number | null = null;
  if (since !== null) {
    if (since.isInstant && since.instantMs !== undefined) {
      minMs = since.instantMs;
    } else if (since.localDate !== undefined) {
      minMs = startOfLocalDayMs(since.localDate, timezone);
    }
  }

  let maxMs: number | null = null;
  if (until !== null) {
    if (until.isInstant && until.instantMs !== undefined) {
      maxMs = until.instantMs;
    } else if (until.localDate !== undefined) {
      maxMs = startOfLocalDayMs(shiftIsoDate(until.localDate, 1), timezone) - 1;
    }
  }

  return { minMs, maxMs };
}

export function isWithinBounds(tsMs: number, bounds: NumericTimeBounds): boolean {
  if (bounds.minMs !== null && tsMs < bounds.minMs) return false;
  if (bounds.maxMs !== null && tsMs > bounds.maxMs) return false;
  return true;
}

export function isWithinDateRange(
  isoTimestamp: string,
  timezone: string,
  since: ParsedDateParam | null,
  until: ParsedDateParam | null,
): boolean {
  const tsMs = Date.parse(isoTimestamp);
  const bounds = toTimeBounds(since, until, timezone);
  return isWithinBounds(tsMs, bounds);
}

export interface WindowDateRange {
  firstDate: string;
  lastDate: string;
}

export function validateDateWindow(
  fromParam: string | null,
  toParam: string | null,
  clock: number,
  timezone: string,
  maxDays = 400,
): { range: WindowDateRange } | { error: ValidationItem } | { problem: 'window_too_large'; limit_days: number } {
  const today = formatIsoDate(new Date(clock).toISOString(), timezone);
  if (fromParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
    return {
      error: {
        location: 'query',
        path: 'from',
        code: 'date_parsing',
        message: 'Input should be a valid date',
      },
    };
  }
  if (toParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    return {
      error: {
        location: 'query',
        path: 'to',
        code: 'date_parsing',
        message: 'Input should be a valid date',
      },
    };
  }
  const lastDate = toParam ?? today;
  const firstDate = fromParam ?? shiftIsoDate(lastDate, -89);
  if (firstDate > lastDate) {
    return {
      error: {
        location: 'query',
        path: 'from',
        code: 'range_invalid',
        message: '`from` is after `to`.',
      },
    };
  }
  const days = daysBetween(firstDate, lastDate);
  if (days > maxDays) {
    return { problem: 'window_too_large', limit_days: maxDays };
  }
  return { range: { firstDate, lastDate } };
}
