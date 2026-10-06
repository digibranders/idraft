import type { components } from '@/lib/api/schema';

/** The depth profiles the API names for a tracked keyword and a project default (`DepthProfile`, 19 section 3.6). */
export type DepthProfile = components['schemas']['TrackedKeywordRow']['depth_profile'];

/** The catalog key of a depth profile under `common.depths`: keys are camel case, the API's names are not. */
export const DEPTH_KEYS = {
  light: 'light',
  standard: 'standard',
  deep: 'deep',
  full: 'full',
  weekly: 'weekly',
  weekly_light: 'weeklyLight',
  until_own_match_100: 'untilOwnMatch100',
} as const satisfies Record<DepthProfile, string>;

/**
 * The depth profiles a person can choose today, in the order they are offered. `until_own_match_100` is the
 * API's name for a profile a later step of the backend builds (rank collection): it answers a keyword or a
 * default set to it `422 depth_profile_not_available`, so it is not offered, and a keyword that holds it
 * (it cannot yet) is still named. One list for every screen that offers a depth, so none offers what the
 * API refuses.
 */
export const OFFERED_DEPTH_PROFILES = [
  'light',
  'standard',
  'deep',
  'full',
  'weekly',
  'weekly_light',
] as const satisfies readonly DepthProfile[];
