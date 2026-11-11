import { MOCK_TRACKED_KEYWORDS, PENDING_TRACKED_IDS } from './keyword-fixtures';
import { hashOf, checksOf, type MockCheck } from './rank-history';
import type { AioStateInfo, EntityRef } from '@/lib/api/types';
import { OWNABLE_FEATURE_TYPES, type FeatureType } from '@/lib/keywords/serp-features';

/** The fixture keywords the rank world gives a state of its own, chosen by their place among the checked ones. */
export const CHECKED_FIXTURES = MOCK_TRACKED_KEYWORDS.filter(
  (row) => row.is_active && !PENDING_TRACKED_IDS.has(row.tracked_keyword_id),
).map((row) => row.tracked_keyword_id);

/** Every 17th fixture keyword: its latest check is 40 hours old or more, so it is stale. */
export const STALE_IDS: ReadonlySet<string> = new Set(CHECKED_FIXTURES.filter((_, index) => index % 17 === 16));
/** The first stale fixture keyword is stale because its checks fail, the others because none ran (a paused collector). */
export const FAILING_IDS: ReadonlySet<string> = new Set([...STALE_IDS].slice(0, 1));
/** One fixture keyword whose checks all failed. */
export const FAILED_IDS: ReadonlySet<string> = new Set(CHECKED_FIXTURES.filter((_, index) => index === 6));

export const FAILING_RUN = 2;
export const STALE_FIXTURE_AGE_MS = 40 * 60 * 60 * 1000;

export const OWN_ENTITY_REF: EntityRef = {
  entity_id: 'own',
  canonical_name: 'own',
  entity_type: 'organization',
  role: 'own',
  color_index: null,
};

export function absoluteRankOf(rank: number | null, featuresCount: number): number | null {
  return rank === null ? null : rank + Math.min(featuresCount, 2);
}

export function asOfClock(trackedId: string, now: number, stoppedAt: string | null = null): number {
  const collected = stoppedAt === null;
  const staleAsOf = STALE_IDS.has(trackedId) ? now - STALE_FIXTURE_AGE_MS : now;
  return collected ? staleAsOf : Math.min(staleAsOf, Date.parse(stoppedAt));
}

export const FEATURES = [
  'featured_snippet',
  'people_also_ask',
  'video',
  'images',
  'local_pack',
  'top_stories',
] as const satisfies readonly FeatureType[];

export interface FeatureAt {
  type: string;
  owned: boolean;
  ordinal: number;
  positionAbsolute: number;
}

export interface WorldCheck {
  snapshotId: string | null;
  observedAt: string | null;
  attemptAt: string;
  rank: number | null;
  depth: number;
  depthReturned: number;
  path: string | null;
  failed: boolean;
  features: FeatureAt[];
  aio: { state: AioStateInfo['state']; position: number | null; sources: number } | null;
  competitorRanks: Map<string, number | null>;
  trackedId: string;
}

export interface WorldChecksInput {
  trackedId: string;
  createdAt: string;
  now: number;
  domain: string | null;
  stoppedAt?: string | null;
  own: EntityRef;
  competitors: readonly EntityRef[];
}

export interface SerpItem {
  rank: number;
  host: string;
  path: string;
  entity: EntityRef | null;
}

export interface SerpContext {
  own: EntityRef;
  competitors: readonly EntityRef[];
  /** The project's primary domain; null when it has none, and then no result is the project's own. */
  ownHost: string | null;
  entityHosts?: ReadonlyMap<string, string>;
}

const THIRD_PARTY_HOSTS = [
  'wikipedia.org',
  'amazon.com',
  'reddit.com',
  'youtube.com',
  'nytimes.com',
  'forbes.com',
  'theverge.com',
  'medium.com',
  'github.com',
  'stackoverflow.com',
  'linkedin.com',
  'quora.com',
  'techcrunch.com',
  'wired.com',
  'bloomberg.com',
  'reuters.com',
  'cnn.com',
  'bbc.com',
  'theguardian.com',
  'wsj.com',
  'yelp.com',
  'tripadvisor.com',
  'hubspot.com',
  'searchenginejournal.com',
  'moz.com',
  'semrush.com',
  'ahrefs.com',
  'backlinko.com',
  'investopedia.com',
  'healthline.com',
  'webmd.com',
  'imdb.com',
  'pinterest.com',
  'ebay.com',
  'walmart.com',
  'target.com',
  'etsy.com',
  'businessinsider.com',
  'usatoday.com',
  'huffpost.com',
] as const;

/** A positive decimal text uniquely identifying a check snapshot. */
export function snapshotIdOf(trackedId: string, observedAt: string): string {
  return String(hashOf(`${trackedId}:${observedAt}`) + 1);
}

/** The keyword's usual feature set, from its id bits. */
export function featuresOf(trackedId: string): string[] {
  const bits = hashOf(`${trackedId}:features`);
  return FEATURES.filter((_, index) => ((bits >>> (index * 2)) & 3) === 0);
}

/** The keyword's usual AI Overview state roll. */
export function usualAioOf(trackedId: string): AioStateInfo['state'] {
  const roll = hashOf(`${trackedId}:aio`) % 10;
  if (roll < 4) return 'absent';
  if (roll === 9) return 'unknown';
  if (roll < 7) return 'present_not_cited';
  return 'present_cited';
}

/** The AI Overview state, citation position, and sources count at a check moment. */
export function aioAt(
  trackedId: string,
  observedAt: string,
): { state: AioStateInfo['state']; position: number | null; sources: number } {
  const usual = usualAioOf(trackedId);
  if (usual === 'unknown') {
    return { state: 'unknown', position: null, sources: 0 };
  }
  const flipHash = hashOf(`${trackedId}:aio:flip:${observedAt}`);
  let state: AioStateInfo['state'] = usual;
  if (flipHash % 5 === 0) {
    const others = (['absent', 'present_not_cited', 'present_cited'] as const).filter((s) => s !== usual);
    state = others[Math.floor(flipHash / 5) % others.length] ?? usual;
  }
  if (state === 'present_cited' || state === 'present_not_cited') {
    const notLoadedHash = hashOf(`${trackedId}:aio:not_loaded:${observedAt}`);
    if (notLoadedHash % 25 === 0) {
      state = 'not_loaded';
    }
  }
  const isPresent = state === 'present_cited' || state === 'present_not_cited' || state === 'not_loaded';
  const posHash = hashOf(`${trackedId}:aio:pos:${observedAt}`);
  const position = state === 'present_cited' ? (posHash % 5) + 1 : null;
  const srcHash = hashOf(`${trackedId}:aio:src:${observedAt}`);
  const sources = isPresent ? 3 + (srcHash % 8) : 0;
  return { state, position, sources };
}

/** The SERP features present and owned at a check moment. */
export function featuresAt(trackedId: string, observedAt: string, ownRanked: boolean): FeatureAt[] {
  const usualList = featuresOf(trackedId);
  const usualSet = new Set(usualList);
  const aio = aioAt(trackedId, observedAt);
  const aioPresent = aio.state === 'present_cited' || aio.state === 'present_not_cited' || aio.state === 'not_loaded';

  const present: Array<{ type: string; owned: boolean }> = [];
  if (aioPresent) {
    present.push({ type: 'ai_overview', owned: false });
  }

  const checkFlips = hashOf(`${trackedId}:fcheck:${observedAt}`) % 4 === 0;

  for (const type of FEATURES) {
    const isUsual = usualSet.has(type);
    const h = hashOf(`${trackedId}:flip:${type}:${observedAt}`);
    const isPresent = checkFlips ? (isUsual ? h % 6 !== 0 : h % 12 === 1) : isUsual;
    if (isPresent) {
      const isOwnable = (OWNABLE_FEATURE_TYPES as readonly string[]).includes(type);
      const owned =
        ownRanked &&
        isOwnable &&
        (hashOf(`${trackedId}:owned:${type}`) % 4 === 0) !==
          (hashOf(`${trackedId}:oflip:${type}:${observedAt}`) % 8 === 0);
      present.push({ type, owned });
    }
  }

  return present.map((item, index) => ({
    type: item.type,
    owned: item.owned,
    ordinal: index + 1,
    positionAbsolute: index + 1,
  }));
}

/**
 * Places competitor ranks alongside own rank so no two entities share a rank,
 * competitors do not pass own rank when conflicting, and ranks remain within depth.
 */
export function placeRanks(input: {
  own: number | null;
  depth: number;
  walks: readonly (readonly [string, number | null])[];
}): Map<string, number | null> {
  const { own, depth, walks } = input;
  const taken = new Set<number>();
  if (own !== null && own <= depth) {
    taken.add(own);
  }

  const result = new Map<string, number | null>();
  for (const [entityId, walkRank] of walks) {
    if (walkRank === null || walkRank > depth) {
      result.set(entityId, null);
      continue;
    }
    let candidate = walkRank;
    while (taken.has(candidate)) {
      candidate += 1;
    }
    if (candidate <= depth) {
      taken.add(candidate);
      result.set(entityId, candidate);
    } else {
      result.set(entityId, null);
    }
  }
  return result;
}

interface ManualCheckRecord {
  completedAt: number;
}

const manualChecks = new Map<string, ManualCheckRecord>();

export function recordManualCheck(trackedId: string, completedAt: number): void {
  manualChecks.set(trackedId, { completedAt });
}

export function clearManualChecks(): void {
  manualChecks.clear();
}

/**
 * Returns up to 30 latest checks for a tracked keyword at a given time.
 * Includes overlays and manual checks, strictly capped at 30 checks.
 */
export function checksAt(
  trackedId: string,
  createdAt: string,
  now: number,
  domain: string | null,
  stoppedAt: string | null = null,
): MockCheck[] {
  if (PENDING_TRACKED_IDS.has(trackedId) || FAILED_IDS.has(trackedId)) return [];
  const asOf = asOfClock(trackedId, now, stoppedAt);
  const checks = checksOf(trackedId, createdAt, asOf).map((check) =>
    domain === null ? { ...check, rank: null, path: null, urlCount: 0 } : check,
  );
  if (FAILING_IDS.has(trackedId) && checks.length >= FAILING_RUN) {
    checks.splice(-FAILING_RUN);
  }
  // Same-day overlay for CHECKED_FIXTURES[0] ("seo agency berlin" ending 0001):
  // +12h, rank minus 1, guarded by extraTime <= now and extraTime <= stoppedAt if stopped
  const stoppedTime = stoppedAt !== null ? Date.parse(stoppedAt) : Infinity;
  if (trackedId === CHECKED_FIXTURES[0] && checks.length >= 2) {
    const lastCheck = checks[checks.length - 1];
    if (lastCheck !== undefined) {
      const extraTime = Date.parse(lastCheck.observedAt) + 12 * 60 * 60 * 1000;
      if (extraTime <= now && extraTime <= stoppedTime) {
        checks.push({
          ...lastCheck,
          observedAt: new Date(extraTime).toISOString(),
          rank: lastCheck.rank === null ? null : Math.max(1, lastCheck.rank - 1),
        });
      }
    }
  }
  const manual = manualChecks.get(trackedId);
  if (manual !== undefined && now >= manual.completedAt && manual.completedAt <= stoppedTime) {
    const latest = checks.at(-1);
    const prevRank = latest?.rank ?? null;
    const newRank = prevRank === null ? 10 : prevRank > 1 ? prevRank - 1 : 2;
    checks.push({
      observedAt: new Date(manual.completedAt).toISOString(),
      rank: domain === null ? null : newRank,
      depth: latest?.depth ?? 20,
      path: latest?.path ?? '/',
      urlCount: latest?.urlCount ?? 1,
    });
  }
  return checks.slice(-30);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * All checks for a keyword across the world: snapshot ids, placed competitor ranks,
 * depth returned, features, and AIO. Includes failed check attempts for failing keywords.
 */
export function worldChecks(input: WorldChecksInput): WorldCheck[] {
  const { trackedId, createdAt, now, domain, stoppedAt = null, competitors } = input;
  if (PENDING_TRACKED_IDS.has(trackedId)) return [];

  const isFailedFixture = FAILED_IDS.has(trackedId);
  const asOf = asOfClock(trackedId, now, stoppedAt);
  if (isFailedFixture) {
    const failedTimes = [asOf - 2 * DAY_MS, asOf - DAY_MS, asOf];
    return failedTimes.map((t) => ({
      snapshotId: null,
      observedAt: null,
      attemptAt: new Date(t).toISOString(),
      rank: null,
      depth: 20,
      depthReturned: 20,
      path: null,
      failed: true,
      features: [],
      aio: null,
      competitorRanks: new Map(competitors.map((c) => [c.entity_id, null])),
      trackedId,
    }));
  }

  // Base good checks from checksAt (which already includes the same-day overlay)
  const goodChecks = [...checksAt(trackedId, createdAt, now, domain, stoppedAt)];

  // Pre-fetch competitor walk checks
  const compWalksByEntity = new Map<string, MockCheck[]>();
  for (const comp of competitors) {
    const compWalk = checksOf(`${trackedId}:${comp.entity_id}`, createdAt, asOf);
    compWalksByEntity.set(comp.entity_id, compWalk);
  }

  const sortedCompetitors = [...competitors].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  let previousPlaced = new Map<string, number | null>();

  const results: WorldCheck[] = [];

  for (const check of goodChecks) {
    const hDepth = hashOf(`${trackedId}:depth:${check.observedAt}`);
    const depthReturned = hDepth % 12 === 0 && check.depth > 1 ? check.depth - 1 : check.depth;

    const walks: Array<[string, number | null]> = [];
    for (const comp of sortedCompetitors) {
      const compWalk = compWalksByEntity.get(comp.entity_id) ?? [];
      const matching = compWalk.find((c) => c.observedAt === check.observedAt);
      if (matching !== undefined) {
        const r = matching.rank !== null && matching.rank <= check.depth ? matching.rank : null;
        walks.push([comp.entity_id, r]);
      } else {
        const prev = previousPlaced.get(comp.entity_id) ?? null;
        walks.push([comp.entity_id, prev]);
      }
    }

    const placed = placeRanks({
      own: check.rank,
      depth: check.depth,
      walks,
    });
    previousPlaced = new Map(placed);

    const checkFeatures = featuresAt(trackedId, check.observedAt, check.rank !== null);
    const checkAio = aioAt(trackedId, check.observedAt);

    results.push({
      snapshotId: snapshotIdOf(trackedId, check.observedAt),
      observedAt: check.observedAt,
      attemptAt: check.observedAt,
      rank: check.rank,
      depth: check.depth,
      depthReturned,
      path: check.path,
      failed: false,
      features: checkFeatures,
      aio: checkAio,
      competitorRanks: placed,
      trackedId,
    });
  }

  // If failing fixture, append failed attempts from raw walk
  if (FAILING_IDS.has(trackedId)) {
    const rawWalk = checksOf(trackedId, createdAt, asOf);
    const failedWalkChecks = rawWalk.slice(-FAILING_RUN);
    for (const check of failedWalkChecks) {
      results.push({
        snapshotId: null,
        observedAt: null,
        attemptAt: check.observedAt,
        rank: null,
        depth: check.depth,
        depthReturned: check.depth,
        path: null,
        failed: true,
        features: [],
        aio: null,
        competitorRanks: new Map(competitors.map((c) => [c.entity_id, null])),
        trackedId,
      });
    }
  }

  results.sort((a, b) => (a.observedAt ?? a.attemptAt).localeCompare(b.observedAt ?? b.attemptAt));
  return results;
}

/** Returns the SERP results for ranks 1 to depthReturned. */
export function serpOf(check: WorldCheck, context: SerpContext): SerpItem[] {
  if (check.failed || check.observedAt === null || check.depthReturned <= 0) return [];
  const { own, competitors, ownHost, entityHosts = new Map() } = context;

  const usedHosts = new Set<string>();
  const compHostMap = new Map<string, string>();
  for (const comp of competitors) {
    const host =
      entityHosts.get(comp.entity_id) ?? `${comp.canonical_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    compHostMap.set(comp.entity_id, host);
  }

  // Pre-reserve own and competitor hosts if they rank in this SERP
  if (ownHost !== null && check.rank !== null && check.rank <= check.depthReturned) {
    usedHosts.add(ownHost);
  }
  for (const comp of competitors) {
    const r = check.competitorRanks.get(comp.entity_id) ?? null;
    if (r !== null && r <= check.depthReturned) {
      const host = compHostMap.get(comp.entity_id);
      if (host) usedHosts.add(host);
    }
  }

  const items: SerpItem[] = [];
  for (let rank = 1; rank <= check.depthReturned; rank += 1) {
    if (ownHost !== null && check.rank !== null && check.rank === rank) {
      items.push({
        rank,
        host: ownHost,
        path: check.path ?? '/',
        entity: own,
      });
      continue;
    }

    const matchingComp = competitors.find((c) => check.competitorRanks.get(c.entity_id) === rank);
    if (matchingComp !== undefined) {
      const host = compHostMap.get(matchingComp.entity_id) ?? 'competitor.com';
      const pathHash = (hashOf(`${matchingComp.entity_id}:${check.observedAt}:${String(rank)}`) >>> 0).toString(36);
      items.push({
        rank,
        host,
        path: `/${pathHash}`,
        entity: matchingComp,
      });
      continue;
    }

    // Third-party result
    const startIdx =
      (hashOf(`${check.trackedId}:${check.observedAt}:${String(rank)}`) + rank) % THIRD_PARTY_HOSTS.length;
    let chosenHost: string | null = null;
    for (let i = 0; i < THIRD_PARTY_HOSTS.length; i += 1) {
      const candidate = THIRD_PARTY_HOSTS[(startIdx + i) % THIRD_PARTY_HOSTS.length];
      if (candidate && !usedHosts.has(candidate)) {
        chosenHost = candidate;
        usedHosts.add(candidate);
        break;
      }
    }
    const host = chosenHost ?? `result-${String(rank)}.org`;
    const pathHash = (hashOf(`${host}:${String(rank)}:${check.observedAt}`) >>> 0).toString(36);
    items.push({
      rank,
      host,
      path: `/${pathHash}`,
      entity: null,
    });
  }

  return items;
}

/** Provides synthetic title and snippet for a SERP item and keyword. */
export function titleOf(item: SerpItem, keyword: string): { title: string; snippet: string } {
  const brand = item.entity ? item.entity.canonical_name : item.host.replace(/\.[a-z]+$/, '');
  const capitalized = keyword.charAt(0).toUpperCase() + keyword.slice(1);
  const title = `${capitalized} - ${brand}`;
  const snippet = `Comprehensive overview and top rankings for ${keyword} on ${item.host}.`;
  return { title, snippet };
}
