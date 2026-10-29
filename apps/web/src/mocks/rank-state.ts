import { MOCK_TRACKED_KEYWORDS, PENDING_TRACKED_IDS } from './keyword-fixtures';
import { checksOf, hashOf, type MockCheck } from './rank-history';
import { registrableDomain } from './factories/domain';
import type { FeatureType } from '@/lib/keywords/serp-features';
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
/** The latest check of a stale fixture keyword is at least this old. */
const STALE_FIXTURE_AGE_MS = 40 * HOUR_MS;
/** How many checks in a row the failed fixture keyword has lost. */
const FAILED_RUN = 3;

/** The fixture keywords the rank world gives a state of its own, chosen by their place among the checked ones. */
const CHECKED_FIXTURES = MOCK_TRACKED_KEYWORDS.filter(
  (row) => row.is_active && !PENDING_TRACKED_IDS.has(row.tracked_keyword_id),
).map((row) => row.tracked_keyword_id);

/** Every 17th fixture keyword: its latest check is 40 hours old or more, so it is stale. */
export const STALE_IDS: ReadonlySet<string> = new Set(CHECKED_FIXTURES.filter((_, index) => index % 17 === 16));
/** The first stale fixture keyword is stale because its checks fail, the others because none ran (a paused collector). */
export const FAILING_IDS: ReadonlySet<string> = new Set([...STALE_IDS].slice(0, 1));
/** How many checks in a row the failing fixture keyword has lost since its last good one. */
const FAILING_RUN = 2;
/** One fixture keyword whose checks all failed. */
export const FAILED_IDS: ReadonlySet<string> = new Set(CHECKED_FIXTURES.filter((_, index) => index === 6));

const FEATURES = [
  'featured_snippet',
  'people_also_ask',
  'video',
  'images',
  'local_pack',
  'top_stories',
] as const satisfies readonly FeatureType[];

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

/** The features on the first page of the keyword's results, from its id: about one in four of each, or none. */
function featuresOf(trackedId: string): string[] {
  const bits = hashOf(`${trackedId}:features`);
  return FEATURES.filter((_, index) => ((bits >>> (index * 2)) & 3) === 0);
}

/** The AI Overview of the last check, from the keyword's id. */
function aioOf(trackedId: string): AioStateInfo {
  const roll = hashOf(`${trackedId}:aio`) % 10;
  if (roll < 4) return { state: 'absent', citation_position: null, observation_id: null };
  if (roll === 9) return { state: 'unknown', citation_position: null, observation_id: null };
  const observation = String((hashOf(`${trackedId}:aio:observation`) % 1_000_000_000) + 1);
  if (roll < 7) return { state: 'present_not_cited', citation_position: null, observation_id: observation };
  return {
    state: 'present_cited',
    citation_position: (hashOf(`${trackedId}:aio:position`) % 5) + 1,
    observation_id: observation,
  };
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
  // A stale fixture keyword shows the history of 40 hours ago: its checks since then did not happen
  const staleAsOf = STALE_IDS.has(trackedId) ? now - STALE_FIXTURE_AGE_MS : now;
  const asOf = collected ? staleAsOf : Math.min(staleAsOf, Date.parse(stoppedAt));
  const checks = checksOf(trackedId, createdAt, asOf).map((check) =>
    domain === null ? { ...check, rank: null, path: null, urlCount: 0 } : check,
  );
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
  const aio = aioOf(trackedId);
  const showed = aio.state === 'present_cited' || aio.state === 'present_not_cited';
  const features = [...(showed ? ['ai_overview'] : []), ...featuresOf(trackedId)];
  const url = domain !== null && latest.path !== null ? urlRefOf(domain, latest.path) : null;
  return {
    current: {
      state: latest.rank === null ? 'beyond_depth' : 'ranked',
      rank: latest.rank,
      // The place counting what stands above the organic results
      absolute_rank: latest.rank === null ? null : latest.rank + Math.min(features.length, 2),
      depth_requested: latest.depth,
      url,
      observed_at: latest.observedAt,
      serp_snapshot_id: String(hashOf(`${trackedId}:${latest.observedAt}`) + 1),
    },
    change: changeOf(checks.at(-2) ?? null, latest),
    best_rank: best?.rank ?? null,
    best_rank_at: best?.observedAt ?? null,
    worst_rank: worst,
    first_ranked_at: ranked[0]?.observedAt ?? null,
    feature_types_present: features,
    owned_feature_types:
      latest.rank === null
        ? []
        : [
            ...(aio.state === 'present_cited' ? ['ai_overview'] : []),
            ...featuresOf(trackedId).filter((feature) => hashOf(`${trackedId}:owned:${feature}`) % 4 === 0),
          ],
    aio,
    target_url_match: url === null || targetUrl === null ? null : url.canonical_url === targetUrl,
    url_changed_at: null,
    consecutive_failures: FAILING_IDS.has(trackedId) ? FAILING_RUN : 0,
    is_stale: collected && now - Date.parse(latest.observedAt) > STALE_AFTER_MS,
    last_observed_at: latest.observedAt,
    ranking_url_count: latest.urlCount,
  };
}
