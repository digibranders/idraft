/**
 * Rank checks of a tracked keyword as the mocks invent them. Nothing is stored: the checks are a function of
 * the keyword's id, its creation time and the mock clock, so the cookie does not grow and a reload shows the
 * same ranks. The first check of a new keyword runs `FIRST_CHECK_DELAY_MS` after it was created, as the
 * metrics' first reading does (the worker plans a new keyword within minutes).
 *
 * The walk starts at the keyword's first check and runs forward through every daily check up to `now`; only the
 * last `CHECKS_KEPT` are answered. A check therefore never changes when the clock moves on: the same day of the
 * same keyword has the same rank whatever time it is asked at.
 */

export const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKS_KEPT = 30;
/** Daily checks run at 02:00 UTC. */
const CHECK_HOUR_UTC = 2;
/** The depth a check looked at: mostly the standard 20, now and then a deeper weekly check. */
const DEPTHS = [20, 20, 20, 50, 100] as const;
const PATHS = [
  '/',
  '/services',
  '/pricing',
  '/blog/seo-audit',
  '/blog/local-seo',
  '/contact',
  // Longer than a mono cell of the URL column holds (about 20 characters), as real article URLs are
  '/blog/how-to-choose-an-seo-agency',
] as const;
/** The deepest rank the walk reaches; a rank that far down is beyond every depth anyway. */
const DEEPEST_RANK = 150;

export interface MockCheck {
  observedAt: string;
  /** The organic rank, or null when beyond `depth`. */
  rank: number | null;
  depth: number;
  /** Own URL path that ranked, null when beyond depth. */
  path: string | null;
  /** How many own URLs ranked. */
  urlCount: number;
}

/** A whole number from a text (FNV-1a), the same on every run. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return hash >>> 0;
}

/** A small deterministic generator (mulberry32) seeded from a text. */
function seeded(seed: string): () => number {
  let state = hashOf(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The moments of a keyword's checks up to `now`: the first one, then every 02:00 UTC after it. */
function checkTimes(firstCheckAt: number, now: number): number[] {
  const times = [firstCheckAt];
  const first = new Date(firstCheckAt);
  let daily = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate(), CHECK_HOUR_UTC);
  if (daily <= firstCheckAt) daily += DAY_MS;
  for (; daily <= now; daily += DAY_MS) times.push(daily);
  return times;
}

/** The checks of a keyword up to `now`, oldest first, at most the last 30. */
export function checksOf(trackedId: string, createdAt: string, now: number): MockCheck[] {
  const firstCheckAt = Date.parse(createdAt) + FIRST_CHECK_DELAY_MS;
  if (now < firstCheckAt) return [];
  const random = seeded(trackedId);
  // The keyword has a usual rank, mostly in the first pages, that the walk drifts around and is pulled back to
  const home = 1 + Math.floor(random() ** 2 * 70);
  const path = PATHS[Math.floor(random() * PATHS.length)] ?? '/';
  let rank = home;
  const checks = checkTimes(firstCheckAt, now).map((time): MockCheck => {
    // A step of up to 4 places a day, and now and then a jump of up to 25 that takes a keyword in or out of view
    const step = random() < 0.08 ? Math.round((random() - 0.5) * 50) : Math.round((random() - 0.5) * 8);
    rank = Math.min(DEEPEST_RANK, Math.max(1, rank + step + Math.round((home - rank) * 0.1)));
    const depth = DEPTHS[Math.floor(random() * DEPTHS.length)] ?? 20;
    const second = random() < 0.15;
    const ranked = rank <= depth;
    return {
      observedAt: new Date(time).toISOString(),
      rank: ranked ? rank : null,
      depth,
      path: ranked ? path : null,
      urlCount: ranked ? (second ? 2 : 1) : 0,
    };
  });
  return checks.slice(-CHECKS_KEPT);
}
