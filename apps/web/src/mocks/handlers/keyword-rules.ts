import type { HttpResponse } from 'msw';

import { projectCaller, workspaceCaller, type ProjectCaller, type WorkspaceCaller } from './access';
import { at, bodyError, enumError, extraMembers, isOneOf, isRecord, queryError, textError, uuidError } from './rules';
import { stateTime } from '../entities-codec';
import { MOCK_LOCATIONS } from '../entity-fixtures';
import { MOCK_WORKSPACE } from '../fixtures';
import { canonicalUrl, decimalOfCents, groupAndBelow, readingOf, type Include } from '../factories/keyword';
import {
  DEPTH_PROFILES,
  FREQUENCIES,
  FUNNEL_STAGES,
  INTENTS,
  KEYWORDS_COOKIE,
  keywordsCookie,
  keywordWorld,
  OS_VALUES,
  readKeywordChanges,
  SOURCES,
  type DepthProfile,
  type Frequency,
  type FunnelStage,
  type Intent,
  type KeywordChanges,
  type KeywordWorld,
  type Os,
  type StoredKeyword,
  type StoredTracked,
} from '../keywords-state';
import { invalid, problem } from '../respond';
import { projectList } from '../workspace-state';
import type { Permission } from '@/lib/permissions/permissions';
import type { Problem, ValidationItem } from '@/lib/api/types';
import {
  cleanKeyword,
  keywordTextProblem,
  MAX_KEYWORD_LENGTH,
  normalizeKeyword,
  type KeywordTextProblem,
} from '@/lib/keywords/keyword-text';

/** What the API says for each problem of a keyword's text. */
export const KEYWORD_TEXT_MESSAGES: Readonly<Record<KeywordTextProblem, string>> = {
  keyword_invalid: 'The keyword holds a control character.',
  keyword_missing: 'Enter a keyword.',
  keyword_too_long: `A keyword is at most ${String(MAX_KEYWORD_LENGTH)} characters.`,
  search_operator_not_allowed: 'Search operators such as site: or a minus before a word are not tracked.',
};

/**
 * The rules the keyword routes share (backend `api/keywords/service.py` on `backend/keywords`): who calls
 * with what keyword state, the create and patch checks in the API's order, the workspace quota, and the
 * tracked keyword filters and sorts of the list, the bulk routes and term assignments.
 */

export interface KeywordProjectCaller extends ProjectCaller {
  keywordChanges: KeywordChanges;
  keywords: KeywordWorld;
}

export interface KeywordWorkspaceCaller extends WorkspaceCaller {
  keywordChanges: KeywordChanges;
  keywords: KeywordWorld;
}

type PathParam = string | readonly string[] | undefined;

export function keywordProjectCaller(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  workspaceId: PathParam,
  projectId: PathParam,
  gate: { permission: Permission; query?: readonly string[] },
): KeywordProjectCaller | HttpResponse<Problem> {
  const caller = projectCaller(request, cookies, workspaceId, projectId, gate);
  if (caller instanceof Response) return caller;
  const keywordChanges = readKeywordChanges(cookies);
  return { ...caller, keywordChanges, keywords: keywordWorld(keywordChanges) };
}

export function keywordWorkspaceCaller(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  workspaceId: PathParam,
  gate: { permission: Permission; query?: readonly string[] },
): KeywordWorkspaceCaller | HttpResponse<Problem> {
  const caller = workspaceCaller(request, cookies, workspaceId, gate);
  if (caller instanceof Response) return caller;
  const keywordChanges = readKeywordChanges(cookies);
  return { ...caller, keywordChanges, keywords: keywordWorld(keywordChanges) };
}

/** The `Set-Cookie` that keeps `changes`, or the `422` to answer when they no longer fit in the cookie. */
export function savedKeywords(request: Request, changes: KeywordChanges): string | HttpResponse<Problem> {
  return (
    keywordsCookie(changes) ??
    problem(request, 'mock_state_full', {
      detail: `What this browser changed no longer fits in the mock state. Expire the ${KEYWORDS_COOKIE} cookie to start again from the fixtures.`,
    })
  );
}

// Workspace scope

const workspaceOfKeyword = (row: StoredKeyword): string => row.workspace_id ?? MOCK_WORKSPACE.workspace_id;

/** The keyword of a workspace with this normalized text and language, if there is one. */
export const workspaceKeyword = (
  world: KeywordWorld,
  workspaceId: string,
  normalized: string,
  languageCode: string,
): StoredKeyword | undefined =>
  world.keywords.find(
    (row) =>
      workspaceOfKeyword(row) === workspaceId &&
      row.language_code === languageCode &&
      normalizeKeyword(row.text) === normalized,
  );

export const keywordsOfWorkspace = (world: KeywordWorld, workspaceId: string): StoredKeyword[] =>
  world.keywords.filter((row) => workspaceOfKeyword(row) === workspaceId);

/** The tracked keywords of a project that were not deleted. */
export const liveTrackedOf = (world: KeywordWorld, projectId: string): StoredTracked[] =>
  world.tracked.filter((row) => row.project_id === projectId && row.deleted_at === null);

// Quota (backend plan D4)

/** Tracked keywords a workspace may keep active (`workspace_quotas.max_tracked_keywords`). */
export const MAX_TRACKED_KEYWORDS = 5000;

/** The `422 quota_exceeded` when `requested` more active rows would pass the limit, or `null`. */
export function quotaProblem(
  request: Request,
  caller: KeywordProjectCaller | KeywordWorkspaceCaller,
  requested: number,
): HttpResponse<Problem> | null {
  const projects = new Set(projectList(caller.changes, caller.access.workspace.workspace_id).map((p) => p.project_id));
  const used = caller.keywords.tracked.filter(
    (row) => projects.has(row.project_id) && row.deleted_at === null && row.is_active,
  ).length;
  return used + requested > MAX_TRACKED_KEYWORDS
    ? problem(request, 'quota_exceeded', {
        detail: `The workspace tracks ${String(used)} of ${String(MAX_TRACKED_KEYWORDS)} keywords.`,
        limit: MAX_TRACKED_KEYWORDS,
        used,
        requested,
      })
    : null;
}

// Field checks shaped like Pydantic's

export function integerError(
  value: unknown,
  path: string,
  { min, max, nullable = false }: { min?: number; max?: number; nullable?: boolean },
): ValidationItem[] {
  if (value === undefined || (nullable && value === null)) return [];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [bodyError(path, 'int_type', 'Input should be a valid integer')];
  }
  if (min !== undefined && value < min) {
    return [bodyError(path, 'greater_than_equal', `Input should be greater than or equal to ${String(min)}`)];
  }
  if (max !== undefined && value > max) {
    return [bodyError(path, 'less_than_equal', `Input should be less than or equal to ${String(max)}`)];
  }
  return [];
}

/** A list of UUIDs of at most `max`, or its errors. */
export function idListError(value: unknown, path: string, max: number, { min = 0 } = {}): ValidationItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [bodyError(path, 'list_type', 'Input should be a valid list')];
  if (value.length < min) return [bodyError(path, 'too_short', `At least ${String(min)} item.`)];
  if (value.length > max) return [bodyError(path, 'too_long', `At most ${String(max)} items.`)];
  return value.flatMap((item, index) => uuidError(item, at(path, index)));
}

const LANGUAGE = /^[a-z]{2}$/;

function languageError(value: unknown, path: string): ValidationItem[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string') return [bodyError(path, 'string_type', 'Input should be a valid string')];
  return LANGUAGE.test(value) ? [] : [bodyError(path, 'string_pattern_mismatch', 'Two lower-case letters.')];
}

const nullableEnum = (value: unknown, path: string, allowed: readonly string[]): ValidationItem[] =>
  value === null ? [] : enumError(value, path, allowed);

/** `business_value` as the API keeps it (two decimals, at least 0), or the error of what was sent. */
export function businessValue(value: unknown, path: string): { value: string | null } | ValidationItem {
  if (value === null) return { value: null };
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+(\.\d+)?$/.test(text.trim())) {
    return typeof text === 'string' && /^-\d/.test(text.trim())
      ? bodyError(path, 'greater_than_equal', 'Input should be greater than or equal to 0')
      : bodyError(path, 'decimal_parsing', 'Input should be a valid decimal');
  }
  const [whole = '0', fraction = ''] = text.trim().split('.');
  if (fraction.length > 2) return bodyError(path, 'decimal_max_places', 'At most 2 decimal places.');
  if (whole.replace(/^0+(?=\d)/, '').length > 10) return bodyError(path, 'decimal_max_digits', 'At most 12 digits.');
  return { value: decimalOfCents(Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) };
}

// Creating a tracked keyword (TrackedKeywordCreate)

const CREATE_FIELDS = [
  'keyword',
  'location_id',
  'language_code',
  'device',
  'search_engine',
  'os',
  'depth_profile',
  'frequency',
  'priority',
  'intent',
  'funnel_stage',
  'business_value',
  'target_url',
  'schedule_id',
  'group_ids',
  'term_ids',
  'competitor_overrides',
] as const;
const CREATE_DEVICES = ['desktop', 'mobile', 'both'] as const;
const MAX_LINKS = 100;

/** The schema checks of one item, at `prefix`: what Pydantic refuses before the service sees it. */
export function createShapeErrors(body: Readonly<Record<string, unknown>>, prefix: string): ValidationItem[] {
  const path = (name: string): string => at(prefix, name);
  const overrides = body.competitor_overrides;
  const overrideErrors: ValidationItem[] = [];
  if (overrides !== undefined && overrides !== null) {
    if (!isRecord(overrides)) {
      overrideErrors.push(
        bodyError(path('competitor_overrides'), 'model_attributes_type', 'Input should be an object'),
      );
    } else {
      overrideErrors.push(
        ...extraMembers(overrides, ['include', 'exclude'], path('competitor_overrides')),
        ...idListError(overrides.include, at(path('competitor_overrides'), 'include'), MAX_LINKS),
        ...idListError(overrides.exclude, at(path('competitor_overrides'), 'exclude'), MAX_LINKS),
      );
      const include = Array.isArray(overrides.include) ? overrides.include : [];
      const exclude = Array.isArray(overrides.exclude) ? overrides.exclude : [];
      if (overrideErrors.length === 0 && include.some((id) => exclude.includes(id))) {
        overrideErrors.push(
          bodyError(path('competitor_overrides'), 'value_error', 'An entity is either included or excluded.'),
        );
      }
    }
  }
  return [
    ...extraMembers(body, CREATE_FIELDS, prefix),
    ...(body.keyword === undefined ? [bodyError(path('keyword'), 'missing', 'Field required')] : []),
    ...textError(body.keyword, path('keyword'), { max: 2000 }),
    ...integerError(body.location_id, path('location_id'), { nullable: true }),
    ...languageError(body.language_code, path('language_code')),
    ...nullableEnum(body.device, path('device'), CREATE_DEVICES),
    ...(body.search_engine === undefined || body.search_engine === 'google'
      ? []
      : [bodyError(path('search_engine'), 'literal_error', "Input should be 'google'")]),
    ...nullableEnum(body.os, path('os'), OS_VALUES),
    ...nullableEnum(body.depth_profile, path('depth_profile'), DEPTH_PROFILES),
    ...nullableEnum(body.frequency, path('frequency'), FREQUENCIES),
    ...integerError(body.priority, path('priority'), { min: 1, max: 5 }),
    ...nullableEnum(body.intent, path('intent'), INTENTS),
    ...enumError(body.funnel_stage, path('funnel_stage'), FUNNEL_STAGES),
    ...(body.business_value === undefined
      ? []
      : ((): ValidationItem[] => {
          const parsed = businessValue(body.business_value, path('business_value'));
          return 'value' in parsed ? [] : [parsed];
        })()),
    ...(body.target_url === undefined || body.target_url === null
      ? []
      : textError(body.target_url, path('target_url'), { max: 2048 })),
    ...uuidError(body.schedule_id, path('schedule_id'), { nullable: true }),
    ...idListError(body.group_ids, path('group_ids'), MAX_LINKS),
    ...idListError(body.term_ids, path('term_ids'), MAX_LINKS),
    ...overrideErrors,
  ];
}

/** One item, its shape checked, as the service reads it. */
export interface CreateItem {
  text: string;
  locationId: number | null;
  languageCode: string | null;
  device: 'desktop' | 'mobile' | 'both' | null;
  os: Os | null;
  depthProfile: DepthProfile | null;
  frequency: Frequency | null;
  priority: number;
  intent: Intent | null;
  funnelStage: FunnelStage;
  businessValue: string | null;
  targetUrl: string | null;
  scheduleId: string | null;
  groupIds: string[];
  termIds: string[];
  include: string[];
  exclude: string[];
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** An item whose shape passed `createShapeErrors`, read. */
export function createItem(body: Readonly<Record<string, unknown>>): CreateItem {
  const overrides = isRecord(body.competitor_overrides) ? body.competitor_overrides : {};
  const parsedValue = body.business_value === undefined ? { value: null } : businessValue(body.business_value, '');
  return {
    text: typeof body.keyword === 'string' ? body.keyword : '',
    locationId: typeof body.location_id === 'number' ? body.location_id : null,
    languageCode: typeof body.language_code === 'string' ? body.language_code : null,
    device: isOneOf(body.device, CREATE_DEVICES) ? body.device : null,
    os: isOneOf(body.os, OS_VALUES) ? body.os : null,
    depthProfile: isOneOf(body.depth_profile, DEPTH_PROFILES) ? body.depth_profile : null,
    frequency: isOneOf(body.frequency, FREQUENCIES) ? body.frequency : null,
    priority: typeof body.priority === 'number' ? body.priority : 3,
    intent: isOneOf(body.intent, INTENTS) ? body.intent : null,
    funnelStage: isOneOf(body.funnel_stage, FUNNEL_STAGES) ? body.funnel_stage : 'unknown',
    businessValue: 'value' in parsedValue ? parsedValue.value : null,
    targetUrl: typeof body.target_url === 'string' ? body.target_url : null,
    scheduleId: typeof body.schedule_id === 'string' ? body.schedule_id : null,
    groupIds: stringList(body.group_ids),
    termIds: stringList(body.term_ids),
    include: stringList(overrides.include),
    exclude: stringList(overrides.exclude),
  };
}

/** Whether a schedule is a live `seo_rank` schedule of the project; schedules arrive with their routes. */
export type ScheduleCheck = (projectId: string, scheduleId: string) => boolean;
export const noSchedules: ScheduleCheck = () => false;

/** The service's errors of an item, all of them, in the API's order, at `prefix`. */
export function createServiceErrors(
  caller: KeywordProjectCaller,
  item: CreateItem,
  prefix: string,
  scheduleIsKnown: ScheduleCheck = noSchedules,
): ValidationItem[] {
  const path = (name: string): string => at(prefix, name);
  const project = caller.project;
  const errors: ValidationItem[] = [];
  const text = keywordTextProblem(item.text);
  if (text !== null) errors.push(bodyError(path('keyword'), text, KEYWORD_TEXT_MESSAGES[text]));
  const locationId = item.locationId ?? project.default_location_id;
  if (locationId === null) {
    errors.push(bodyError(path('location_id'), 'location_required', 'Choose a location; the project has no default.'));
  } else if (!MOCK_LOCATIONS.some((location) => location.location_id === locationId)) {
    errors.push(bodyError(path('location_id'), 'location_unknown', 'No active location has this id.'));
  }
  if ((item.languageCode ?? project.default_language_code) === null) {
    errors.push(
      bodyError(path('language_code'), 'language_required', 'Choose a language; the project has no default.'),
    );
  }
  if (item.targetUrl !== null && canonicalUrl(item.targetUrl) === null) {
    errors.push(bodyError(path('target_url'), 'invalid_url', 'Not an http(s) URL.'));
  }
  if (item.scheduleId !== null && !scheduleIsKnown(project.project_id, item.scheduleId)) {
    errors.push(bodyError(path('schedule_id'), 'schedule_unknown', 'No rank schedule of this project has this id.'));
  }
  errors.push(...groupErrors(caller, item.groupIds, path('group_ids')));
  errors.push(...termErrors(caller, item.termIds, path('term_ids')));
  errors.push(...entityErrors(caller, [...item.include, ...item.exclude], path('competitor_overrides')));
  return errors;
}

export function groupErrors(caller: KeywordProjectCaller, groupIds: readonly string[], path: string): ValidationItem[] {
  const known = new Set(
    caller.keywords.groups.filter((group) => group.project_id === caller.project.project_id).map((g) => g.group_id),
  );
  return groupIds.some((id) => !known.has(id))
    ? [bodyError(path, 'group_unknown', 'A group is not one of this project.')]
    : [];
}

/**
 * Terms of the workspace-wide vocabularies or of this project's and, for terms being given, no two of one
 * single-valued vocabulary. Terms being taken away may be several of one: that clears the vocabulary.
 */
export function termErrors(
  caller: KeywordProjectCaller,
  termIds: readonly string[],
  path: string,
  { removing = false }: { removing?: boolean } = {},
): ValidationItem[] {
  const workspaceId = caller.access.workspace.workspace_id;
  const vocabularies = caller.world.vocabularies.filter(
    (vocabulary) =>
      (vocabulary.workspace_id ?? MOCK_WORKSPACE.workspace_id) === workspaceId &&
      ((vocabulary.project_id ?? null) === null || vocabulary.project_id === caller.project.project_id),
  );
  const allowed = new Set(vocabularies.map((vocabulary) => vocabulary.vocabulary_id));
  const terms = termIds.map((id) => caller.world.terms.find((term) => term.term_id === id));
  if (terms.some((term) => term === undefined || !allowed.has(term.vocabulary_id))) {
    return [bodyError(path, 'term_unknown', 'A term is not of a vocabulary of this project.')];
  }
  if (removing) return [];
  const single = new Set(vocabularies.filter((v) => v.is_single_valued === true).map((v) => v.vocabulary_id));
  const seen = new Set<string>();
  for (const term of terms) {
    if (term === undefined || !single.has(term.vocabulary_id)) continue;
    if (seen.has(term.vocabulary_id)) {
      return [bodyError(path, 'single_valued_vocabulary', 'Two terms of a vocabulary that takes one.')];
    }
    seen.add(term.vocabulary_id);
  }
  return [];
}

/** Entities with a live role of any kind in the project. */
export function entityErrors(
  caller: KeywordProjectCaller,
  entityIds: readonly string[],
  path: string,
): ValidationItem[] {
  const inProject = new Set(
    caller.world.roles
      .filter((role) => role.project_id === caller.project.project_id && (role.removed_at ?? null) === null)
      .map((role) => role.entity_id),
  );
  return entityIds.some((id) => !inProject.has(id))
    ? [bodyError(path, 'entity_not_in_project', 'An entity has no role in this project.')]
    : [];
}

/** The identity values of an item for the project, with `both` as two devices, desktop first. */
export function identitiesOf(
  caller: KeywordProjectCaller,
  item: CreateItem,
): { locationId: number; languageCode: string; devices: ('desktop' | 'mobile')[] } {
  const settings = caller.keywords.settings[caller.project.project_id] ?? {};
  const device = item.device ?? settings.default_device ?? 'desktop';
  return {
    locationId: item.locationId ?? caller.project.default_location_id ?? 0,
    languageCode: item.languageCode ?? caller.project.default_language_code ?? 'en',
    devices: device === 'both' ? ['desktop', 'mobile'] : [device],
  };
}

/** The project's row with this identity, deleted ones included. */
export function rowWithIdentity(
  world: KeywordWorld,
  projectId: string,
  keywordId: string,
  locationId: number,
  languageCode: string,
  device: 'desktop' | 'mobile',
): StoredTracked | undefined {
  return world.tracked.find(
    (row) =>
      row.project_id === projectId &&
      row.keyword_id === keywordId &&
      row.location_id === locationId &&
      row.language_code === languageCode &&
      row.device === device,
  );
}

export const now = (): string => stateTime();

/** A new tracked keyword's row, the item's values over the project's keyword defaults. */
export function newTrackedRow(
  caller: KeywordProjectCaller,
  item: CreateItem,
  ids: { trackedKeywordId: string; keywordId: string },
  identity: { locationId: number; languageCode: string; device: 'desktop' | 'mobile' },
  source: StoredTracked['source'] = 'manual',
): StoredTracked {
  const settings = caller.keywords.settings[caller.project.project_id] ?? {};
  const created = now();
  const by = caller.session.user.user_id;
  return {
    tracked_keyword_id: ids.trackedKeywordId,
    project_id: caller.project.project_id,
    keyword_id: ids.keywordId,
    location_id: identity.locationId,
    language_code: identity.languageCode,
    device: identity.device,
    priority: item.priority,
    intent: item.intent ?? 'unknown',
    intent_source: item.intent === null ? null : 'manual',
    funnel_stage: item.funnelStage,
    frequency: item.frequency ?? settings.default_frequency ?? 'daily',
    source,
    business_value: item.businessValue,
    schedule_id: item.scheduleId,
    os: item.os,
    is_active: true,
    deleted_at: null,
    created_by: by,
    created_at: created,
    updated_at: created,
    versions: [
      {
        depth_profile: item.depthProfile ?? settings.default_depth_profile ?? 'standard',
        target_url: item.targetUrl === null ? null : (canonicalUrl(item.targetUrl)?.toString() ?? null),
        valid_from: created,
        change_reason: null,
        changed_by: by,
      },
    ],
  };
}

/** A new keyword of the workspace, with the cleaned text. */
export function newKeyword(
  caller: KeywordProjectCaller,
  keywordId: string,
  text: string,
  languageCode: string,
): StoredKeyword {
  const workspaceId = caller.access.workspace.workspace_id;
  return {
    keyword_id: keywordId,
    text: cleanKeyword(text),
    language_code: languageCode,
    created_at: now(),
    ...(workspaceId === MOCK_WORKSPACE.workspace_id ? {} : { workspace_id: workspaceId }),
  };
}

// Filters (TrackedKeywordFilter, the list's `filter[...]`)

export interface TrackedFilter {
  q: string | null;
  group: string | null;
  term: string[];
  termIn: string[];
  device: 'desktop' | 'mobile' | null;
  locationId: number | null;
  languageCode: string | null;
  searchEngine: 'google' | 'bing' | null;
  intentIn: Intent[];
  funnelStageIn: FunnelStage[];
  priorityLte: number | null;
  isActive: boolean | null;
  sourceIn: StoredTracked['source'][];
  depthProfileIn: DepthProfile[];
  searchVolumeGte: number | null;
  keywordDifficultyLte: number | null;
}

export const FILTER_NAMES = [
  'q',
  'group',
  'term',
  'term_in',
  'device',
  'location_id',
  'language_code',
  'search_engine',
  'intent_in',
  'funnel_stage_in',
  'priority_lte',
  'is_active',
  'source_in',
  'depth_profile_in',
  'search_volume_gte',
  'keyword_difficulty_lte',
] as const;

/**
 * A filter read from a source of named values (query or body) with an error reporter for each place. Lists
 * come as arrays (a body, or repeated query parameters) and also as comma lists in a query.
 */
interface FilterSource {
  text: (name: string) => unknown;
  list: (name: string) => unknown[] | undefined;
  error: (name: string, code: string, message: string) => ValidationItem;
  /** A query value is text; a body value has its JSON type. */
  fromQuery: boolean;
}

/** The most values a list filter takes (19 section 2.4). */
const MAX_FILTER_VALUES = 100;

function readFilter(source: FilterSource, defaultActive: boolean | null): TrackedFilter | ValidationItem[] {
  const errors: ValidationItem[] = [];
  /** A list's values, checked for count: a body list holds 1 to 100, a query list at most 100. */
  const listOf = (name: string): unknown[] => {
    const values = source.list(name);
    if (values === undefined) return [];
    if (values.length > MAX_FILTER_VALUES || (!source.fromQuery && values.length === 0)) {
      errors.push(
        source.error(
          name,
          values.length === 0 ? 'too_short' : 'too_long',
          `From 1 to ${String(MAX_FILTER_VALUES)} values.`,
        ),
      );
    }
    return values;
  };
  const text = (name: string, { min = 1, max = 200 } = {}): string | null => {
    const value = source.text(name);
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      errors.push(source.error(name, 'string_type', 'Input should be a valid string'));
      return null;
    }
    if (value.length < min || value.length > max) {
      errors.push(
        source.error(
          name,
          value.length < min ? 'string_too_short' : 'string_too_long',
          `From ${String(min)} to ${String(max)} characters.`,
        ),
      );
    }
    return value;
  };
  const integer = (name: string, min?: number, max?: number): number | null => {
    const raw = source.text(name);
    if (raw === undefined || raw === null) return null;
    const value = source.fromQuery && typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      errors.push(source.error(name, 'int_parsing', 'Input should be a valid integer'));
      return null;
    }
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      errors.push(
        source.error(
          name,
          min !== undefined && value < min ? 'greater_than_equal' : 'less_than_equal',
          'Out of range.',
        ),
      );
    }
    return value;
  };
  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T | null => {
    const value = source.text(name);
    if (value === undefined || value === null) return null;
    if (isOneOf(value, allowed)) return value;
    errors.push(source.error(name, 'enum', `Allowed: ${allowed.join(', ')}.`));
    return null;
  };
  const manyOf = <T extends string>(name: string, allowed: readonly T[]): T[] => {
    const values = listOf(name);
    const bad = values.filter((value) => !isOneOf(value, allowed));
    if (bad.length > 0) errors.push(source.error(name, 'enum', `Allowed: ${allowed.join(', ')}.`));
    return values.filter((value): value is T => isOneOf(value, allowed));
  };
  const ids = (name: string): string[] => {
    const values = listOf(name);
    if (values.some((value) => typeof value !== 'string' || uuidError(value, name).length > 0)) {
      errors.push(source.error(name, 'uuid_parsing', 'Input should be a valid UUID'));
      return [];
    }
    return values.filter((value): value is string => typeof value === 'string');
  };
  const group = text('group', { min: 1, max: 64 });
  if (group !== null && uuidError(group, 'group').length > 0) {
    errors.push(source.error('group', 'uuid_parsing', 'Input should be a valid UUID'));
  }
  const activeRaw = source.text('is_active');
  let isActive: boolean | null = defaultActive;
  if (activeRaw !== undefined && activeRaw !== null) {
    if (activeRaw === true || activeRaw === 'true') isActive = true;
    else if (activeRaw === false || activeRaw === 'false') isActive = false;
    else errors.push(source.error('is_active', 'bool_parsing', 'Input should be a valid boolean'));
  }
  const filter: TrackedFilter = {
    q: text('q'),
    group,
    term: ids('term'),
    termIn: ids('term_in'),
    device: oneOf('device', ['desktop', 'mobile'] as const),
    locationId: integer('location_id'),
    languageCode: text('language_code', { min: 2, max: 2 }),
    searchEngine: oneOf('search_engine', ['google', 'bing'] as const),
    intentIn: manyOf('intent_in', INTENTS),
    funnelStageIn: manyOf('funnel_stage_in', FUNNEL_STAGES),
    priorityLte: integer('priority_lte', 1, 5),
    isActive,
    sourceIn: manyOf('source_in', SOURCES),
    depthProfileIn: manyOf('depth_profile_in', DEPTH_PROFILES),
    searchVolumeGte: integer('search_volume_gte', 0),
    keywordDifficultyLte: integer('keyword_difficulty_lte', 0, 100),
  };
  return errors.length > 0 ? errors : filter;
}

/** The list's filter from its `filter[...]` query parameters; `is_active` defaults to true. */
export function queryFilter(url: URL): TrackedFilter | ValidationItem[] {
  const key = (name: string): string => `filter[${name}]`;
  return readFilter(
    {
      text: (name) => url.searchParams.get(key(name)) ?? undefined,
      list: (name) => {
        const values = url.searchParams.getAll(key(name)).flatMap((value) => value.split(','));
        return values.length === 0 ? undefined : values.filter((value) => value !== '');
      },
      error: (name, code, message) => queryError(key(name), code, message),
      fromQuery: true,
    },
    true,
  );
}

/**
 * A filter given in a body (bulk routes, term assignments), at `path`. `is_active` left out takes archived and
 * active keywords alike, unlike the list (backend as built).
 */
export function bodyFilter(value: unknown, path: string): TrackedFilter | ValidationItem[] {
  if (!isRecord(value)) return [bodyError(path, 'model_attributes_type', 'Input should be an object')];
  const extra = extraMembers(value, FILTER_NAMES, path);
  if (extra.length > 0) return extra;
  return readFilter(
    {
      text: (name) => value[name],
      list: (name) => {
        const list = value[name];
        return list === undefined || list === null ? undefined : Array.isArray(list) ? list : [list];
      },
      error: (name, code, message) => bodyError(at(path, name), code, message),
      fromQuery: false,
    },
    null,
  );
}

/** A term and every term under it. */
function termAndBelow(caller: KeywordProjectCaller | KeywordWorkspaceCaller, termId: string): Set<string> {
  const found = new Set([termId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const term of caller.world.terms) {
      const parent = term.parent_id ?? null;
      if (parent !== null && found.has(parent) && !found.has(term.term_id)) {
        found.add(term.term_id);
        grew = true;
      }
    }
  }
  return found;
}

/** The project's live tracked keywords the filter keeps. */
export function filteredRows(caller: KeywordProjectCaller, filter: TrackedFilter): StoredTracked[] {
  const world = caller.keywords;
  const keywordText = new Map(world.keywords.map((row) => [row.keyword_id, normalizeKeyword(row.text)]));
  const needle = filter.q === null ? null : normalizeKeyword(filter.q);
  const linksOf = (id: string): Set<string> =>
    new Set(world.termLinks.filter((link) => link.tracked_keyword_id === id).map((link) => link.term_id));
  const inGroup =
    filter.group === null
      ? null
      : ((): Set<string> => {
          const groups = groupAndBelow(world, filter.group);
          return new Set(world.members.filter((m) => groups.has(m.group_id)).map((m) => m.tracked_keyword_id));
        })();
  // `term`: per vocabulary any of its terms (or one under them), every vocabulary named
  const termGroups = new Map<string, Set<string>>();
  for (const termId of filter.term) {
    const vocabulary = caller.world.terms.find((term) => term.term_id === termId)?.vocabulary_id ?? termId;
    const set = termGroups.get(vocabulary) ?? new Set<string>();
    for (const id of termAndBelow(caller, termId)) set.add(id);
    termGroups.set(vocabulary, set);
  }
  const termAny = new Set(filter.termIn.flatMap((termId) => [...termAndBelow(caller, termId)]));
  return liveTrackedOf(world, caller.project.project_id).filter((row) => {
    if (filter.isActive !== null && row.is_active !== filter.isActive) return false;
    // A `q` that normalizes to nothing (spaces only) matches no keyword
    if (needle !== null && (needle === '' || !(keywordText.get(row.keyword_id) ?? '').includes(needle))) return false;
    if (inGroup !== null && !inGroup.has(row.tracked_keyword_id)) return false;
    if (termGroups.size > 0 || termAny.size > 0) {
      const links = linksOf(row.tracked_keyword_id);
      for (const set of termGroups.values()) if (![...links].some((id) => set.has(id))) return false;
      if (termAny.size > 0 && ![...links].some((id) => termAny.has(id))) return false;
    }
    if (filter.device !== null && row.device !== filter.device) return false;
    if (filter.locationId !== null && row.location_id !== filter.locationId) return false;
    if (filter.languageCode !== null && row.language_code !== filter.languageCode) return false;
    if (filter.searchEngine === 'bing') return false;
    if (filter.intentIn.length > 0 && !filter.intentIn.includes(row.intent)) return false;
    if (filter.funnelStageIn.length > 0 && !filter.funnelStageIn.includes(row.funnel_stage)) return false;
    if (filter.priorityLte !== null && row.priority > filter.priorityLte) return false;
    if (filter.sourceIn.length > 0 && !filter.sourceIn.includes(row.source)) return false;
    const depth = row.versions.at(-1)?.depth_profile ?? 'standard';
    if (filter.depthProfileIn.length > 0 && !filter.depthProfileIn.includes(depth)) return false;
    if (filter.searchVolumeGte !== null || filter.keywordDifficultyLte !== null) {
      const reading = readingOf(world, row.keyword_id, row.location_id, row.language_code)?.reading;
      if (reading === undefined) return false;
      if (filter.searchVolumeGte !== null && reading.volume < filter.searchVolumeGte) return false;
      if (filter.keywordDifficultyLte !== null && reading.difficulty > filter.keywordDifficultyLte) return false;
    }
    return true;
  });
}

// Sorting (19 section 2.4: `sort=-search_volume,keyword`, the row id last)

export const SORT_KEYS = [
  'keyword',
  'search_volume',
  'keyword_difficulty',
  'cpc_usd',
  'priority',
  'created_at',
] as const;
type SortKey = (typeof SORT_KEYS)[number];
/** The sort when none is asked for. */
export const DEFAULT_SORT = 'keyword';

export function parseSort(raw: string | null): { key: SortKey; desc: boolean }[] | ValidationItem {
  const text = raw ?? DEFAULT_SORT;
  if (text.length > 200) return queryError('sort', 'string_too_long', 'At most 200 characters.');
  const keys = text.split(',').map((part) => part.trim());
  const parsed = keys.map((part) => ({ key: part.replace(/^-/, ''), desc: part.startsWith('-') }));
  const unknown = parsed.find((part) => !isOneOf(part.key, SORT_KEYS));
  const repeated = new Set(parsed.map((part) => part.key)).size < parsed.length;
  if (unknown !== undefined || repeated) {
    return queryError('sort', 'invalid_sort', `Sort by ${SORT_KEYS.join(', ')}, each at most once.`);
  }
  return parsed.flatMap((part) => (isOneOf(part.key, SORT_KEYS) ? [{ key: part.key, desc: part.desc }] : []));
}

/** Rows in the asked order; a keyword without the metric sorts last both ways, the row id breaks ties. */
export function sortRows(
  world: KeywordWorld,
  rows: readonly StoredTracked[],
  sort: readonly { key: SortKey; desc: boolean }[],
): StoredTracked[] {
  const texts = new Map(world.keywords.map((row) => [row.keyword_id, normalizeKeyword(row.text)]));
  const value = (row: StoredTracked, key: SortKey): string | number | null => {
    if (key === 'keyword') return texts.get(row.keyword_id) ?? '';
    if (key === 'priority') return row.priority;
    if (key === 'created_at') return row.created_at;
    const reading = readingOf(world, row.keyword_id, row.location_id, row.language_code)?.reading;
    if (reading === undefined) return null;
    if (key === 'search_volume') return reading.volume;
    if (key === 'keyword_difficulty') return reading.difficulty;
    return Number(reading.cpc);
  };
  return [...rows].sort((a, b) => {
    for (const { key, desc } of sort) {
      const left = value(a, key);
      const right = value(b, key);
      if (left === right) continue;
      // Only a metric can be missing; it goes last whichever way the sort runs
      if (left === null || right === null) return left === null ? 1 : -1;
      const order = left < right ? -1 : 1;
      return desc ? -order : order;
    }
    return a.tracked_keyword_id.localeCompare(b.tracked_keyword_id);
  });
}

/** `include`: a comma list or repeated parameters. */
export function parseInclude(url: URL): Set<Include> | ValidationItem {
  const values = url.searchParams.getAll('include').flatMap((value) => value.split(','));
  const allowed = ['metrics', 'groups', 'terms', 'competitors'] as const;
  const bad = values.filter((value) => !isOneOf(value, allowed));
  if (bad.length > 0) return queryError('include', 'enum', `Allowed: ${allowed.join(', ')}.`);
  return new Set(values.filter((value): value is Include => isOneOf(value, allowed)));
}

/** A selection of tracked keywords: exactly one of `ids` (1 to 5,000) and `filter`. */
export function selectionErrors(
  body: Readonly<Record<string, unknown>>,
  idsName = 'ids',
  filterName = 'filter',
): ValidationItem[] {
  const hasIds = body[idsName] !== undefined && body[idsName] !== null;
  const hasFilter = body[filterName] !== undefined && body[filterName] !== null;
  if (hasIds === hasFilter) {
    return [bodyError('', 'value_error', `Give exactly one of ${idsName} and ${filterName}.`)];
  }
  return hasIds ? idListError(body[idsName], idsName, MAX_SELECTED_IDS, { min: 1 }) : [];
}

/** The most ids a selection names, and the most rows a filter may match (`422 too_many_subjects`). */
export const MAX_SELECTED_IDS = 5000;
export const MAX_FILTER_MATCHES = 20_000;
/** The groups and terms gained or lost in one bulk change, rows times links (backend `LINK_CHANGES_MAX`). */
export const LINK_CHANGES_MAX = 200_000;

/**
 * The most rows one change may touch when each gains or loses `links` groups and terms: 20,000, and fewer
 * as the links grow so that rows times links stay within 200,000. A link counts whether or not the row has
 * it (the backend counts the ids named, not the changes made); the limit applies to ids and filters alike.
 */
export const subjectLimit = (links: number): number =>
  links === 0 ? MAX_FILTER_MATCHES : Math.min(MAX_FILTER_MATCHES, Math.floor(LINK_CHANGES_MAX / links));

/** The live rows of the project a selection names, or the problem to answer. */
export function selectedRows(
  request: Request,
  caller: KeywordProjectCaller,
  body: Readonly<Record<string, unknown>>,
  idsName = 'ids',
  filterName = 'filter',
  /** Groups and terms each row gains or loses in this change, which lower the limit. */
  links = 0,
): StoredTracked[] | HttpResponse<Problem> {
  const limit = subjectLimit(links);
  const tooMany = (): HttpResponse<Problem> =>
    problem(request, 'too_many_subjects', {
      detail: `This change takes at most ${String(limit)} tracked keywords; choose fewer.`,
      limit,
    });
  const ids = body[idsName];
  if (Array.isArray(ids)) {
    const wanted = new Set(ids);
    const rows = liveTrackedOf(caller.keywords, caller.project.project_id).filter((row) =>
      wanted.has(row.tracked_keyword_id),
    );
    return rows.length > limit ? tooMany() : rows;
  }
  const filter = bodyFilter(body[filterName], filterName);
  if (Array.isArray(filter)) return invalid(request, filter);
  const rows = filteredRows(caller, filter);
  return rows.length > limit ? tooMany() : rows;
}
