/**
 * The values a tracked keyword's fields take in the API, in the order Rankings offers them, with the message
 * keys of the ones the API spells in snake case (the catalog names its keys in camel case).
 */

export const INTENTS = ['commercial', 'informational', 'navigational', 'transactional', 'local', 'unknown'] as const;
export const FUNNEL_STAGES = ['tofu', 'mofu', 'bofu', 'retention', 'unknown'] as const;
export const SOURCES = ['manual', 'csv_import', 'bulk_paste', 'api', 'gsc_import', 'discovery'] as const;
export const DEPTH_PROFILES = [
  'light',
  'standard',
  'deep',
  'full',
  'weekly',
  'weekly_light',
  'until_own_match_100',
] as const;
/** 1 is the highest priority and 5 the lowest. */
export const PRIORITIES = [1, 2, 3, 4, 5] as const;

export type Intent = (typeof INTENTS)[number];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type KeywordSource = (typeof SOURCES)[number];
export type DepthProfile = (typeof DEPTH_PROFILES)[number];

export const SOURCE_KEY = {
  manual: 'manual',
  csv_import: 'csvImport',
  bulk_paste: 'bulkPaste',
  api: 'api',
  gsc_import: 'gscImport',
  discovery: 'discovery',
} as const satisfies Record<KeywordSource, string>;

export const DEPTH_KEY = {
  light: 'light',
  standard: 'standard',
  deep: 'deep',
  full: 'full',
  weekly: 'weekly',
  weekly_light: 'weeklyLight',
  until_own_match_100: 'untilOwnMatch100',
} as const satisfies Record<DepthProfile, string>;

/** The one of `allowed` that `value` is, or `null`. */
export function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}
