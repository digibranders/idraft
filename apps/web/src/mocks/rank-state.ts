import { PENDING_TRACKED_IDS } from './keyword-fixtures';
import { hashOf, type MockCheck } from './rank-history';
import {
  FAILED_IDS,
  FAILING_IDS,
  FAILING_RUN,
  aioAt,
  featuresAt,
  snapshotIdOf,
  worldChecks,
  absoluteRankOf,
  OWN_ENTITY_REF,
  checksAt,
} from './serp-world';
import { registrableDomain } from './factories/domain';
import type { components } from '@/lib/api/schema';

/**
 * The rank state of a tracked keyword at a moment, as the API answers it (`TrackedKeywordState`), made from the
 * keyword's derived check history (./rank-history.ts) and the mock clock. Nothing is stored. The rules follow
 * the backend: the change is read within the smaller depth of the two latest checks (`ranks.state.classify_change`,
 * `api/keywords/filters.py change_label`), the best and worst ranks count ranked checks only, and a keyword with
 * no successful check has no rank at all (`api/keywords/rank_views.py state_view`).
 */

type Schemas = components['schemas'];
export type TrackedKeywordState = Schemas['TrackedKeywordState'];
type RankChange = Schemas['RankChange'];
type UrlRef = Schemas['UrlRef'];
type AioStateInfo = Schemas['AioStateInfo'];

const HOUR_MS = 60 * 60 * 1000;
/** No successful check for this long makes a keyword stale (a daily profile; the API computes it). */
const STALE_AFTER_MS = 36 * HOUR_MS;
/** How many checks in a row the failed fixture keyword has lost. */
const FAILED_RUN = 3;

/** An archived fixture keyword is collected this long after it was added; the mock stores no archive time for it. */
const ARCHIVED_FIXTURE_COLLECTED_MS = 5 * 24 * HOUR_MS;

/**
 * When a tracked keyword stopped being checked: never while it is active; when it was archived through the
 * API, which sets its `updated_at`; and for an archived fixture, which was never updated (its `updated_at` is
 * its creation, no archive time is stored), a few days after it was added.
 */
export function stoppedAtOf(row: { is_active: boolean; created_at: string; updated_at: string }): string | null {
  if (row.is_active) return null;
  return row.updated_at === row.created_at
    ? new Date(Date.parse(row.created_at) + ARCHIVED_FIXTURE_COLLECTED_MS).toISOString()
    : row.updated_at;
}

/** The side of a check that the change compares. */
export type ChangeSide = Pick<MockCheck, 'rank' | 'depth' | 'observedAt'>;

/**
 * How a check compares with the one before it, within the smaller depth of the two: numeric only when both ranks
 * lie within it, `new` or `lost` when only one does, and beyond that nothing is inferred (a rank deeper than the
 * compared depth counts as beyond it).
 */
export function changeOf(previous: ChangeSide | null, current: ChangeSide): RankChange {
  if (previous === null) return { label: 'first_check', value: null, previous_rank: null, previous_observed_at: null };
  const compared = Math.min(previous.depth, current.depth);
  const before = previous.rank !== null && previous.rank <= compared ? previous.rank : null;
  const now = current.rank !== null && current.rank <= compared ? current.rank : null;
  const label = ((): RankChange['label'] => {
    if (before !== null && now !== null) return 'numeric';
    if (now !== null) return 'new';
    if (before !== null) return 'lost';
    return previous.rank !== null || current.rank !== null ? 'consistent_beyond' : 'unchanged_beyond';
  })();
  return {
    label,
    value: before !== null && now !== null ? before - now : null,
    previous_rank: previous.rank,
    previous_observed_at: previous.observedAt,
  };
}

/**
 * The state of a keyword with no successful check; `failures` checks in a row failed (`failed`), or none ran yet.
 * `stale` is the backend's judgment for a keyword that has a state row: no good check for 36 hours, counted from
 * the keyword's creation when there is none (`seo_rank_health.py` coalesces `last_observed_at` and `created_at`).
 * A keyword never checked and never failed has no state row at all, so it is never stale.
 */
function notChecked(failures: number, stale: boolean): TrackedKeywordState {
  return {
    current: {
      state: failures > 0 ? 'failed' : 'not_checked',
      rank: null,
      absolute_rank: null,
      depth_requested: null,
      url: null,
      observed_at: null,
      serp_snapshot_id: null,
    },
    change: { label: 'first_check', value: null, previous_rank: null, previous_observed_at: null },
    best_rank: null,
    best_rank_at: null,
    worst_rank: null,
    first_ranked_at: null,
    feature_types_present: [],
    owned_feature_types: [],
    aio: { state: 'unknown', citation_position: null, observation_id: null },
    target_url_match: null,
    url_changed_at: null,
    consecutive_failures: failures,
    is_stale: stale,
    last_observed_at: null,
    ranking_url_count: 0,
    drop_unconfirmed: false,
  };
}

/** The own URL that ranked: the project's domain and a path. The id is a decimal integer text, as the API's. */
function urlRefOf(domain: string, path: string): UrlRef {
  const host = domain.toLowerCase();
  const canonical = `https://${host}${path}`;
  return {
    url_id: String((hashOf(canonical) % 2_000_000_000) + 1),
    canonical_url: canonical,
    host,
    path,
    registrable_domain: registrableDomain(host),
  };
}

const EXTRA_PAGES = [
  '/solutions/security-operations-center',
  '/managed-soc-service',
  '/blog/what-is-soc',
  '/pricing',
  '/solutions/mssp',
];

/**
 * The pages that ranked at the keyword's last check as `include=ranking_urls` answers it: the one the state names
 * and, when it counts more, the others a few places behind it. Every third keyword with three pages has a
 * sub-result at the rank of the first.
 */
export function rankingUrlsOf(
  trackedId: string,
  createdAt: string,
  now: number,
  domain: string | null,
  stoppedAt: string | null = null,
): Schemas['RankingUrl'][] {
  const latest = checksAt(trackedId, createdAt, now, domain, stoppedAt).at(-1);
  if (domain === null || latest === undefined || latest.rank === null || latest.path === null) return [];
  const pages = [{ url: urlRefOf(domain, latest.path), rank: latest.rank, shares_rank: false }];
  for (let index = 1; index < latest.urlCount; index += 1) {
    const path = EXTRA_PAGES[(hashOf(`${trackedId}:page:${index}`) + index) % EXTRA_PAGES.length] ?? '/';
    const shares = index === 2 && hashOf(`${trackedId}:sub`) % 3 === 0;
    const rank = shares
      ? latest.rank
      : Math.min(latest.depth, latest.rank + 3 * index + (hashOf(`${trackedId}:gap:${index}`) % 6));
    pages.push({ url: urlRefOf(domain, path), rank, shares_rank: shares });
  }
  return pages.sort((a, b) => a.rank - b.rank);
}

/** The keyword's sparkline as `include=sparkline` answers it: the last 30 checks, oldest first. */
export function sparklineOf(
  trackedId: string,
  createdAt: string,
  now: number,
  domain: string | null,
  stoppedAt: string | null = null,
): Schemas['Sparkline'] {
  return {
    depth_mode: 'daily_depth',
    points: checksAt(trackedId, createdAt, now, domain, stoppedAt).map((check) => ({
      t: check.observedAt,
      rank: check.rank,
      depth: check.depth,
      state: check.rank === null ? 'beyond_depth' : 'ranked',
    })),
  };
}

/**
 * Competitor ranks on the keyword as `include=competitor_ranks` answers it: the placed competitor ranks
 * from `worldChecks`, ending where the own checks end.
 */
export function competitorRanksOf(
  trackedId: string,
  createdAt: string,
  now: number,
  domain: string | null,
  competitors: readonly Schemas['EntityRef'][],
  stoppedAt: string | null = null,
): Schemas['CompetitorRank'][] {
  if (competitors.length === 0) return [];
  const all = worldChecks({
    trackedId,
    createdAt,
    now,
    domain,
    stoppedAt,
    own: OWN_ENTITY_REF,
    competitors: [...competitors],
  });
  const goodChecks = all.filter((c) => !c.failed);
  const latest = goodChecks.at(-1);
  if (latest === undefined) return [];
  const prev = goodChecks.at(-2);

  return competitors.map((entity) => {
    const rank = latest.competitorRanks.get(entity.entity_id) ?? null;
    const prevRank = prev ? (prev.competitorRanks.get(entity.entity_id) ?? null) : null;
    const prevSide: ChangeSide | null =
      prev && prev.observedAt ? { rank: prevRank, depth: prev.depth, observedAt: prev.observedAt } : null;
    const curSide: ChangeSide = {
      rank,
      depth: latest.depth,
      observedAt: latest.observedAt ?? new Date(now).toISOString(),
    };
    return {
      entity,
      current: {
        state: rank === null ? 'beyond_depth' : 'ranked',
        rank,
        absolute_rank: absoluteRankOf(rank, latest.features.length),
        depth_requested: latest.depth,
        url: null,
        observed_at: latest.observedAt,
        serp_snapshot_id: latest.snapshotId,
      },
      change: changeOf(prevSide, curSide),
    };
  });
}

/**
 * The rank state of a tracked keyword at `now` (the mock clock, read once by the caller).
 *
 * - `domain` is the project's primary domain, which the ranking URLs are under; a project without one has no
 *   own URL, so its keywords are always beyond the depth.
 * - `targetUrl` is the keyword's target URL in canonical form: the match is known only for a keyword that ranks.
 * - A fixture keyword still waiting for Labs has no check, and the failed fixture keyword never had a good one.
 * - `stoppedAt` is when the keyword stopped being collected (`stoppedAtOf`), `null` while it is. Its history ends
 *   there, and it is never stale: the backend clears the flag of a keyword nobody expects a check of.
 */
export function rankStateOf(
  trackedId: string,
  createdAt: string,
  now: number,
  domain: string | null,
  targetUrl: string | null = null,
  stoppedAt: string | null = null,
): TrackedKeywordState {
  const collected = stoppedAt === null;
  if (PENDING_TRACKED_IDS.has(trackedId)) return notChecked(0, false);
  if (FAILED_IDS.has(trackedId))
    return notChecked(FAILED_RUN, collected && now - Date.parse(createdAt) > STALE_AFTER_MS);
  const checks = checksAt(trackedId, createdAt, now, domain, stoppedAt);
  const latest = checks.at(-1);
  if (latest === undefined) return notChecked(0, false);
  const ranked = checks.filter((check): check is MockCheck & { rank: number } => check.rank !== null);
  const best = ranked.reduce<(MockCheck & { rank: number }) | null>(
    (found, check) => (found === null || check.rank < found.rank ? check : found),
    null,
  );
  const worst = ranked.reduce<number | null>(
    (found, check) => (found === null ? check.rank : Math.max(found, check.rank)),
    null,
  );
  const features = featuresAt(trackedId, latest.observedAt, latest.rank !== null);
  const aioInfo = aioAt(trackedId, latest.observedAt);
  const aio: AioStateInfo = {
    state: aioInfo.state,
    citation_position: aioInfo.position,
    observation_id:
      aioInfo.state === 'absent' || aioInfo.state === 'unknown'
        ? null
        : String((hashOf(`${trackedId}:aio:observation:${latest.observedAt}`) % 1_000_000_000) + 1),
  };
  const url = domain !== null && latest.path !== null ? urlRefOf(domain, latest.path) : null;

  let urlChangedAt: string | null = null;
  for (let i = 1; i < ranked.length; i += 1) {
    const cur = ranked[i];
    const prev = ranked[i - 1];
    if (cur !== undefined && prev !== undefined && cur.path !== prev.path) {
      urlChangedAt = cur.observedAt;
    }
  }

  return {
    current: {
      state: latest.rank === null ? 'beyond_depth' : 'ranked',
      rank: latest.rank,
      absolute_rank: absoluteRankOf(latest.rank, features.length),
      depth_requested: latest.depth,
      url,
      observed_at: latest.observedAt,
      serp_snapshot_id: snapshotIdOf(trackedId, latest.observedAt),
    },
    change: changeOf(checks.at(-2) ?? null, latest),
    best_rank: best?.rank ?? null,
    best_rank_at: best?.observedAt ?? null,
    worst_rank: worst,
    first_ranked_at: ranked[0]?.observedAt ?? null,
    feature_types_present: features.map((f) => f.type),
    owned_feature_types: features.filter((f) => f.owned && f.type !== 'ai_overview').map((f) => f.type),
    aio,
    target_url_match: url === null || targetUrl === null ? null : url.canonical_url === targetUrl,
    url_changed_at: urlChangedAt,
    consecutive_failures: FAILING_IDS.has(trackedId) ? FAILING_RUN : 0,
    is_stale: collected && now - Date.parse(latest.observedAt) > STALE_AFTER_MS,
    last_observed_at: latest.observedAt,
    ranking_url_count: latest.urlCount,
    drop_unconfirmed: false,
  };
}
