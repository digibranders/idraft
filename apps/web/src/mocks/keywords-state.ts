import { jsonCookie, readJsonCookie } from './cookie-json';
import { COMPACT_KEYWORD_CHANGES, decodeKeywordChanges, encodeKeywordChanges } from './keywords-codec';
import {
  MOCK_GROUP_MEMBERS,
  MOCK_KEYWORD_GROUPS,
  MOCK_KEYWORDS,
  MOCK_OVERRIDES,
  MOCK_TERM_LINKS,
  MOCK_TRACKED_KEYWORDS,
} from './keyword-fixtures';
import { FIRST_MINTED, mockId, type IdKind } from './mock-ids';
import { KEYWORDS_COOKIE } from './session';

/**
 * What one browser changed in the keywords of its workspace through the mocks (backend plan step 5, part 1):
 * keywords and tracked keywords added, tracked keywords edited (settings, archive, delete), groups and their
 * members, term links, competitor overrides and project settings. Only the changes
 * are kept, in their own cookie, against the fixtures (./keyword-fixtures.ts); ./keywords-codec.ts writes
 * them compactly. In memory every row is whole.
 */
export { KEYWORDS_COOKIE };

export const DEPTH_PROFILES = [
  'standard',
  'light',
  'deep',
  'full',
  'weekly',
  'weekly_light',
  'until_own_match_100',
] as const;
export const FREQUENCIES = ['daily', 'weekly', 'custom'] as const;
export const INTENTS = ['unknown', 'informational', 'navigational', 'commercial', 'transactional', 'local'] as const;
export const INTENT_SOURCES = ['provider', 'manual', 'rule'] as const;
export const FUNNEL_STAGES = ['unknown', 'tofu', 'mofu', 'bofu', 'retention'] as const;
export const SOURCES = ['manual', 'csv_import', 'api', 'gsc_import', 'discovery', 'bulk_paste'] as const;
export const DEVICES = ['desktop', 'mobile'] as const;
export const OS_VALUES = ['windows', 'macos', 'android', 'ios'] as const;

export type DepthProfile = (typeof DEPTH_PROFILES)[number];
export type Frequency = (typeof FREQUENCIES)[number];
export type Intent = (typeof INTENTS)[number];
export type IntentSource = (typeof INTENT_SOURCES)[number];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type KeywordSource = (typeof SOURCES)[number];
export type Device = (typeof DEVICES)[number];
export type Os = (typeof OS_VALUES)[number];

/** A keyword of the workspace: one per normalized text and language, keeping the first text entered. */
export interface StoredKeyword {
  keyword_id: string;
  /** Left out for the fixture workspace. */
  workspace_id?: string | undefined;
  text: string;
  language_code: string;
  created_at: string;
}

/** One configuration version of a tracked keyword; the next version's start ends it. */
export interface StoredVersion {
  depth_profile: DepthProfile;
  target_url: string | null;
  valid_from: string;
  change_reason: string | null;
  changed_by: string | null;
}

export interface StoredTracked {
  tracked_keyword_id: string;
  project_id: string;
  keyword_id: string;
  location_id: number;
  language_code: string;
  device: Device;
  priority: number;
  intent: Intent;
  intent_source: IntentSource | null;
  funnel_stage: FunnelStage;
  frequency: Frequency;
  source: KeywordSource;
  business_value: string | null;
  schedule_id: string | null;
  os: Os | null;
  is_active: boolean;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Oldest first; the last is the current configuration, and its number is the list's length. */
  versions: StoredVersion[];
}

export interface StoredGroup {
  group_id: string;
  project_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

/** A tracked keyword in a group. */
export interface StoredMember {
  group_id: string;
  tracked_keyword_id: string;
}

/** A term given to a tracked keyword. */
export interface StoredTermLink {
  term_id: string;
  tracked_keyword_id: string;
}

export interface StoredOverride {
  tracked_keyword_id: string;
  entity_id: string;
  mode: 'include' | 'exclude';
}

/** The keyword defaults of a project's settings (`settings.seo`); a member left out takes the API default. */
export interface StoredSeoSettings {
  default_device?: 'desktop' | 'mobile' | 'both' | undefined;
  default_depth_profile?: DepthProfile | undefined;
  default_frequency?: 'daily' | 'weekly' | undefined;
  visibility_weight_scheme?: 'uniform' | 'priority' | 'business_value' | undefined;
  visibility_volume_mode?: 'annual_average' | 'seasonal' | undefined;
}

/** The changes; members left out changed nothing. */
export interface KeywordChanges {
  /** The last id number given to a row created here. */
  minted?: number | undefined;
  keywords?: StoredKeyword[] | undefined;
  /** Tracked keywords created here (whole, as they are now) and fixture rows as changed here (whole). */
  tracked?: { created?: StoredTracked[] | undefined; edited?: StoredTracked[] | undefined } | undefined;
  groups?:
    | { created?: StoredGroup[] | undefined; edited?: StoredGroup[] | undefined; deleted?: string[] | undefined }
    | undefined;
  members?: { added?: StoredMember[] | undefined; removed?: StoredMember[] | undefined } | undefined;
  terms?: { added?: StoredTermLink[] | undefined; removed?: StoredTermLink[] | undefined } | undefined;
  /** Per tracked keyword whose overrides were set here, the whole list. */
  overrides?: Record<string, StoredOverride[]> | undefined;
  /** Per project whose keyword defaults were set here. */
  settings?: Record<string, StoredSeoSettings> | undefined;
}

/** Every row as this browser sees it. */
export interface KeywordWorld {
  keywords: StoredKeyword[];
  tracked: StoredTracked[];
  groups: StoredGroup[];
  members: StoredMember[];
  termLinks: StoredTermLink[];
  overrides: StoredOverride[];
  settings: Readonly<Record<string, StoredSeoSettings>>;
}

const memberKey = (row: StoredMember): string => `${row.group_id}:${row.tracked_keyword_id}`;
const termKey = (row: StoredTermLink): string => `${row.term_id}:${row.tracked_keyword_id}`;

/** Rows of the base and created here, less the deleted ones, as changed here. */
function merged<R>(
  base: readonly R[],
  key: (row: R) => string,
  change: { created?: R[] | undefined; edited?: R[] | undefined; deleted?: string[] | undefined } | undefined,
): R[] {
  const deleted = new Set(change?.deleted ?? []);
  const edited = new Map((change?.edited ?? []).map((row) => [key(row), row]));
  return [...base, ...(change?.created ?? [])]
    .filter((row) => !deleted.has(key(row)))
    .map((row) => edited.get(key(row)) ?? row);
}

/** Links of the base and added here, less the removed ones. */
function linked<R>(
  base: readonly R[],
  key: (row: R) => string,
  change: { added?: R[] | undefined; removed?: R[] | undefined } | undefined,
): R[] {
  const removed = new Set((change?.removed ?? []).map(key));
  const rows = new Map<string, R>();
  for (const row of [...base, ...(change?.added ?? [])]) if (!removed.has(key(row))) rows.set(key(row), row);
  return [...rows.values()];
}

export function keywordWorld(changes: KeywordChanges): KeywordWorld {
  const overrides = changes.overrides ?? {};
  return {
    keywords: [...MOCK_KEYWORDS, ...(changes.keywords ?? [])],
    tracked: merged(MOCK_TRACKED_KEYWORDS, (row) => row.tracked_keyword_id, changes.tracked),
    groups: merged(MOCK_KEYWORD_GROUPS, (row) => row.group_id, changes.groups),
    members: linked(MOCK_GROUP_MEMBERS, memberKey, changes.members),
    termLinks: linked(MOCK_TERM_LINKS, termKey, changes.terms),
    overrides: [
      ...MOCK_OVERRIDES.filter((row) => !(row.tracked_keyword_id in overrides)),
      ...Object.values(overrides).flat(),
    ],
    settings: changes.settings ?? {},
  };
}

/** What the cookie holds; a cookie that does not decode is ignored. */
export function readKeywordChanges(cookies: Readonly<Record<string, string>>): KeywordChanges {
  const compact = readJsonCookie(cookies, KEYWORDS_COOKIE, COMPACT_KEYWORD_CHANGES, null);
  return compact === null ? {} : (decodeKeywordChanges(compact) ?? {});
}

/** The `Set-Cookie` that keeps `changes`, or `null` when they no longer fit in a cookie. */
export const keywordsCookie = (changes: KeywordChanges): string | null =>
  jsonCookie(KEYWORDS_COOKIE, encodeKeywordChanges(changes));

const isFixtureTracked = (id: string): boolean => MOCK_TRACKED_KEYWORDS.some((row) => row.tracked_keyword_id === id);
const isFixtureGroup = (id: string): boolean => MOCK_KEYWORD_GROUPS.some((row) => row.group_id === id);

/** `changes` with a keyword created here. */
export const withKeyword = (changes: KeywordChanges, keyword: StoredKeyword): KeywordChanges => ({
  ...changes,
  keywords: [...(changes.keywords ?? []), keyword],
});

/** `changes` with a tracked keyword saved as `row`: created, or replaced where it was created or edited. */
export function withTracked(changes: KeywordChanges, row: StoredTracked): KeywordChanges {
  const id = row.tracked_keyword_id;
  const created = changes.tracked?.created ?? [];
  const edited = changes.tracked?.edited ?? [];
  if (isFixtureTracked(id)) {
    return { ...changes, tracked: { created, edited: [...edited.filter((r) => r.tracked_keyword_id !== id), row] } };
  }
  const exists = created.some((r) => r.tracked_keyword_id === id);
  return {
    ...changes,
    tracked: {
      edited,
      created: exists ? created.map((r) => (r.tracked_keyword_id === id ? row : r)) : [...created, row],
    },
  };
}

/** `changes` with a group saved as `row`. */
export function withGroup(changes: KeywordChanges, row: StoredGroup): KeywordChanges {
  const id = row.group_id;
  const current = changes.groups ?? {};
  const created = current.created ?? [];
  if (isFixtureGroup(id)) {
    return {
      ...changes,
      groups: { ...current, edited: [...(current.edited ?? []).filter((r) => r.group_id !== id), row] },
    };
  }
  const exists = created.some((r) => r.group_id === id);
  return {
    ...changes,
    groups: { ...current, created: exists ? created.map((r) => (r.group_id === id ? row : r)) : [...created, row] },
  };
}

/** `changes` without these groups (a group and its subgroups: the API deletes them for good, plan D2). */
export function withoutGroups(changes: KeywordChanges, ids: ReadonlySet<string>): KeywordChanges {
  const current = changes.groups ?? {};
  return {
    ...changes,
    groups: {
      created: (current.created ?? []).filter((row) => !ids.has(row.group_id)),
      edited: (current.edited ?? []).filter((row) => !ids.has(row.group_id)),
      deleted: [...(current.deleted ?? []), ...[...ids].filter(isFixtureGroup)],
    },
  };
}

/** `changes` with links added and removed, each recorded only where it differs from the base. */
function withLinks<R>(
  current: { added?: R[] | undefined; removed?: R[] | undefined } | undefined,
  base: readonly R[],
  key: (row: R) => string,
  add: readonly R[],
  remove: readonly R[],
): { added: R[]; removed: R[] } {
  const inBase = new Set(base.map(key));
  const removing = new Set(remove.map(key));
  const adding = new Set(add.map(key));
  const added = [
    ...(current?.added ?? []).filter((row) => !removing.has(key(row))),
    ...add.filter((row) => !inBase.has(key(row))),
  ];
  const removed = [
    ...(current?.removed ?? []).filter((row) => !adding.has(key(row))),
    ...remove.filter((row) => inBase.has(key(row))),
  ];
  const unique = <T>(rows: T[], keyOf: (row: T) => string): T[] => [
    ...new Map(rows.map((row) => [keyOf(row), row])).values(),
  ];
  return { added: unique(added, key), removed: unique(removed, key) };
}

export const withMembers = (
  changes: KeywordChanges,
  add: readonly StoredMember[],
  remove: readonly StoredMember[],
): KeywordChanges => ({
  ...changes,
  members: withLinks(changes.members, MOCK_GROUP_MEMBERS, memberKey, add, remove),
});

export const withTermLinks = (
  changes: KeywordChanges,
  add: readonly StoredTermLink[],
  remove: readonly StoredTermLink[],
): KeywordChanges => ({
  ...changes,
  terms: withLinks(changes.terms, MOCK_TERM_LINKS, termKey, add, remove),
});

export const withOverrides = (
  changes: KeywordChanges,
  trackedKeywordId: string,
  rows: readonly StoredOverride[],
): KeywordChanges => ({ ...changes, overrides: { ...changes.overrides, [trackedKeywordId]: [...rows] } });

export const withSettings = (
  changes: KeywordChanges,
  projectId: string,
  settings: StoredSeoSettings,
): KeywordChanges => ({ ...changes, settings: { ...changes.settings, [projectId]: settings } });

/**
 * Ids for the rows a request creates, counted on from the last one this browser made. `commit` writes the
 * count into the changes that hold the new rows.
 */
export function keywordIdMinter(changes: KeywordChanges): {
  next: (kind: IdKind) => string;
  commit: (next: KeywordChanges) => KeywordChanges;
} {
  let last = changes.minted ?? FIRST_MINTED - 1;
  return {
    next: (kind) => {
      last += 1;
      return mockId(kind, last);
    },
    commit: (next) => ({ ...next, minted: last }),
  };
}

/** A row that was not deleted. */
export const isLive = (row: StoredTracked): boolean => row.deleted_at === null;

/** The current configuration version of a tracked keyword. */
export function currentVersion(row: StoredTracked): StoredVersion {
  const version = row.versions.at(-1);
  if (version === undefined) throw new Error(`Tracked keyword ${row.tracked_keyword_id} has no configuration`);
  return version;
}
