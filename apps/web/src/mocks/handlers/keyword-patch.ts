import { at, bodyError, booleanError, enumError, isOneOf, isRecord, textError, uuidError } from './rules';
import { businessValue, integerError, now, type ScheduleCheck } from './keyword-rules';
import { canonicalUrl } from '../factories/keyword';
import {
  currentVersion,
  DEPTH_PROFILES,
  FREQUENCIES,
  FUNNEL_STAGES,
  INTENTS,
  type StoredTracked,
} from '../keywords-state';
import type { ValidationItem } from '@/lib/api/types';

/**
 * A change to a tracked keyword's settings (TrackedKeywordPatch), as PATCH and bulk update read it (backend
 * `service.py`): identity fields cannot change, only `target_url`, `business_value` and `schedule_id` may
 * be cleared, and a new depth profile or target URL makes a new configuration version.
 */

const PATCH_FIELDS = [
  'business_value',
  'change_reason',
  'depth_profile',
  'frequency',
  'funnel_stage',
  'intent',
  'is_active',
  'priority',
  'schedule_id',
  'target_url',
] as const;
const IDENTITY_FIELDS = ['keyword', 'search_engine', 'location_id', 'language_code', 'device', 'os'] as const;
const NULLABLE = new Set(['target_url', 'business_value', 'schedule_id']);

/** The schema errors of a patch at `prefix`. */
export function patchShapeErrors(body: unknown, prefix: string): ValidationItem[] {
  if (!isRecord(body)) return [bodyError(prefix, 'model_attributes_type', 'Input should be an object')];
  const path = (name: string): string => at(prefix, name);
  const errors: ValidationItem[] = [];
  for (const name of Object.keys(body)) {
    if (isOneOf(name, IDENTITY_FIELDS)) {
      errors.push(
        bodyError(path(name), 'immutable_field', 'This field makes the identity; track a new keyword instead.'),
      );
    } else if (!isOneOf(name, PATCH_FIELDS)) {
      errors.push(bodyError(path(name), 'extra_forbidden', 'Extra inputs are not permitted'));
    } else if (body[name] === null && !NULLABLE.has(name)) {
      errors.push(bodyError(path(name), 'null_not_allowed', 'Cannot be null.'));
    }
  }
  const nonNull = (name: string): unknown => (body[name] === null ? undefined : body[name]);
  errors.push(
    ...enumError(nonNull('depth_profile'), path('depth_profile'), DEPTH_PROFILES),
    ...enumError(nonNull('frequency'), path('frequency'), FREQUENCIES),
    ...enumError(nonNull('funnel_stage'), path('funnel_stage'), FUNNEL_STAGES),
    ...enumError(nonNull('intent'), path('intent'), INTENTS),
    ...booleanError(nonNull('is_active'), path('is_active')),
    ...integerError(nonNull('priority'), path('priority'), { min: 1, max: 5 }),
    ...uuidError(body.schedule_id, path('schedule_id'), { nullable: true }),
    ...(body.target_url === undefined || body.target_url === null
      ? []
      : textError(body.target_url, path('target_url'), { max: 2048 })),
    ...textError(body.change_reason, path('change_reason'), { min: 0, max: 500 }),
  );
  if (body.business_value !== undefined) {
    const parsed = businessValue(body.business_value, path('business_value'));
    if (!('value' in parsed)) errors.push(parsed);
  }
  if (errors.length === 0 && Object.keys(body).filter((name) => name !== 'change_reason').length === 0) {
    errors.push(bodyError(prefix, 'value_error', 'Change at least one field.'));
  }
  return errors;
}

/** The service's errors of a patch whose shape passed. */
export function patchServiceErrors(
  body: Readonly<Record<string, unknown>>,
  prefix: string,
  projectId: string,
  scheduleIsKnown: ScheduleCheck,
): ValidationItem[] {
  const errors: ValidationItem[] = [];
  if (typeof body.target_url === 'string' && canonicalUrl(body.target_url) === null) {
    errors.push(bodyError(at(prefix, 'target_url'), 'invalid_url', 'Not an http(s) URL.'));
  }
  if (typeof body.schedule_id === 'string' && !scheduleIsKnown(projectId, body.schedule_id)) {
    errors.push(
      bodyError(at(prefix, 'schedule_id'), 'schedule_unknown', 'No rank schedule of this project has this id.'),
    );
  }
  return errors;
}

export interface Patched {
  row: StoredTracked;
  /** Something differed from the stored row. */
  changed: boolean;
  /** The depth profile or the target URL changed: a new configuration version. */
  versioned: boolean;
  /** An archived row became active again: it counts against the quota. */
  unarchived: boolean;
}

/** `row` with the patch applied; values equal to the stored ones change nothing. */
export function applyPatch(row: StoredTracked, body: Readonly<Record<string, unknown>>, userId: string): Patched {
  const version = currentVersion(row);
  const next: StoredTracked = { ...row };
  let changed = false;
  const set = <K extends keyof StoredTracked>(key: K, value: StoredTracked[K]): void => {
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  };
  if (typeof body.priority === 'number') set('priority', body.priority);
  if (isOneOf(body.frequency, FREQUENCIES)) set('frequency', body.frequency);
  if (isOneOf(body.funnel_stage, FUNNEL_STAGES)) set('funnel_stage', body.funnel_stage);
  if (typeof body.is_active === 'boolean') set('is_active', body.is_active);
  if ('schedule_id' in body) set('schedule_id', typeof body.schedule_id === 'string' ? body.schedule_id : null);
  if ('business_value' in body) {
    const parsed = businessValue(body.business_value, '');
    if ('value' in parsed) set('business_value', parsed.value);
  }
  if (isOneOf(body.intent, INTENTS) && (body.intent !== row.intent || row.intent_source !== 'manual')) {
    set('intent', body.intent);
    set('intent_source', 'manual');
  }
  const depth = isOneOf(body.depth_profile, DEPTH_PROFILES) ? body.depth_profile : version.depth_profile;
  const target =
    'target_url' in body
      ? typeof body.target_url === 'string'
        ? (canonicalUrl(body.target_url)?.toString() ?? version.target_url)
        : null
      : version.target_url;
  const versioned = depth !== version.depth_profile || target !== version.target_url;
  if (versioned) {
    next.versions = [
      ...row.versions,
      {
        depth_profile: depth,
        target_url: target,
        valid_from: now(),
        change_reason: typeof body.change_reason === 'string' ? body.change_reason : null,
        changed_by: userId,
      },
    ];
    changed = true;
  }
  if (changed) next.updated_at = now();
  return { row: next, changed, versioned, unarchived: !row.is_active && next.is_active };
}
