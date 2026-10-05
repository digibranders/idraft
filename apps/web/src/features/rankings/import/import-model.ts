import type { components } from '@/lib/api/schema';

export type KeywordImport = components['schemas']['KeywordImport'];
export type ImportStatus = KeywordImport['status'];
export type ImportSource = 'upload' | 'paste';
export type Counts = components['schemas']['ImportCounts'];
export type Quota = components['schemas']['ImportQuota'];
export type ImportField = components['schemas']['ImportField'];
export type Outcome = components['schemas']['ImportRow']['outcome'];
export type StepId = 'upload' | 'map' | 'review' | 'confirm';

/** Every field a column can map to, in the order the Map step lists them. */
export const IMPORT_FIELDS: readonly ImportField[] = [
  'keyword',
  'location',
  'country',
  'language',
  'device',
  'tags',
  'topic',
  'group',
  'intent',
  'funnel_stage',
  'priority',
  'target_url',
  'depth_profile',
];

export const OUTCOMES: readonly Outcome[] = ['new', 'duplicate', 'variant', 'conflict', 'invalid'];

/** The steps of a source: a paste has no columns to map. */
export const stepsOf = (source: ImportSource): StepId[] =>
  source === 'upload' ? ['upload', 'map', 'review', 'confirm'] : ['upload', 'review', 'confirm'];

export type ImportPhase = 'reading' | 'needs_mapping' | 'ready' | 'writing' | 'done' | 'expired' | 'failed' | 'gone';

/** What a status means to the dialog. `parsing` is never seen (the API commits `uploaded`), but reads the same. */
export function importPhase(status: ImportStatus): ImportPhase {
  switch (status) {
    case 'uploaded':
    case 'parsing':
      return 'reading';
    case 'needs_mapping':
      return 'needs_mapping';
    case 'preview_ready':
      return 'ready';
    case 'writing':
      return 'writing';
    case 'completed':
    case 'completed_with_errors':
      return 'done';
    case 'expired':
      return 'expired';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'gone';
  }
}

/** The API's automatic mapping: a header that names a field, without case and spaces around it. */
export function autoMapping(headers: readonly string[]): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  for (const header of headers) {
    const field = IMPORT_FIELDS.find((candidate) => candidate === header.trim().toLowerCase());
    if (field !== undefined) mapping[header] = field;
  }
  return mapping;
}

export type MappingRowProblem = 'mapped_twice' | 'vocabulary_missing';

/** What stops a mapping: no keyword column (the form), a field mapped twice or a vocabulary missing (a row). */
export function mappingProblems(
  mapping: Readonly<Record<string, ImportField>>,
  vocabularies: { tagsVocabulary: string | null; topicVocabulary: string | null },
): { form: 'keyword_missing' | null; rows: Record<string, MappingRowProblem> } {
  const entries = Object.entries(mapping);
  const rows: Record<string, MappingRowProblem> = {};
  for (const [header, field] of entries) {
    if (entries.filter(([, other]) => other === field).length > 1) rows[header] = 'mapped_twice';
    else if (field === 'tags' && vocabularies.tagsVocabulary === null) rows[header] = 'vocabulary_missing';
    else if (field === 'topic' && vocabularies.topicVocabulary === null) rows[header] = 'vocabulary_missing';
  }
  return { form: entries.some(([, field]) => field === 'keyword') ? null : 'keyword_missing', rows };
}

export interface OutcomeSummary {
  new: number;
  duplicate: number;
  variant: number;
  conflict: number;
  invalid: number;
  /** Keywords past the plan's limit if the import went ahead as previewed; 0 when it fits. */
  overQuota: number;
}

export function outcomeSummary(counts: Counts, quota: Quota | null): OutcomeSummary {
  return {
    new: counts.new,
    duplicate: counts.duplicate,
    variant: counts.variant,
    conflict: counts.conflict,
    invalid: counts.invalid,
    overQuota: quota === null ? 0 : Math.max(0, quota.would_use - quota.limit),
  };
}

export interface ReviewChoices {
  duplicates: 'skip' | 'merge';
  conflicts: 'skip' | 'unarchive';
}

export const DEFAULT_CHOICES: ReviewChoices = { duplicates: 'skip', conflicts: 'skip' };

export interface ConfirmPlan {
  create: number;
  merge: number;
  unarchive: number;
  skip: number;
  duplicateAction: 'skip' | 'merge_terms';
  /** The row action sent for every conflict row before confirming; `skip` sends none (it is the default). */
  conflictAction: 'skip' | 'merge';
}

/**
 * What Confirm will do, by parts. Duplicates that repeat a row of the file are skipped whatever the choice
 * (the API allows them nothing else), and the counts do not tell them from tracked duplicates, so `merge` is
 * the most that can be merged: the Review step says so.
 */
export function confirmPlan(counts: Counts, choices: ReviewChoices): ConfirmPlan {
  const merge = choices.duplicates === 'merge' ? counts.duplicate : 0;
  const unarchive = choices.conflicts === 'unarchive' ? counts.conflict : 0;
  return {
    create: counts.new + counts.variant,
    merge,
    unarchive,
    skip: counts.invalid + (counts.duplicate - merge) + (counts.conflict - unarchive),
    duplicateAction: choices.duplicates === 'merge' ? 'merge_terms' : 'skip',
    conflictAction: choices.conflicts === 'unarchive' ? 'merge' : 'skip',
  };
}

/**
 * The catalog key of a field under `rankings.import.fields`: keys are camelCase, the API's codes are not.
 * `t(`fields.${FIELD_KEYS[field]}`)`.
 */
export const FIELD_KEYS = {
  keyword: 'keyword',
  country: 'country',
  location: 'location',
  language: 'language',
  device: 'device',
  tags: 'tags',
  topic: 'topic',
  group: 'group',
  intent: 'intent',
  funnel_stage: 'funnelStage',
  priority: 'priority',
  target_url: 'targetUrl',
  depth_profile: 'depthProfile',
} as const satisfies Record<ImportField, string>;

/** The reason codes of a row the dialog has words for; the API's own `reason` text is the fallback for others. */
export const REASON_CODES = [
  'keyword_missing',
  'keyword_invalid',
  'keyword_too_long',
  'search_operator_not_allowed',
  'location_unknown',
  'language_invalid',
  'device_invalid',
  'priority_invalid',
  'depth_profile_invalid',
  'target_url_invalid',
  'group_path_invalid',
  'repeated_row',
  'already_tracked',
  'variant',
  'conflict',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** The catalog key of a reason under `rankings.import.reasons`: `t(`reasons.${REASON_KEYS[code]}`)`. */
export const REASON_KEYS = {
  keyword_missing: 'keywordMissing',
  keyword_invalid: 'keywordInvalid',
  keyword_too_long: 'keywordTooLong',
  search_operator_not_allowed: 'searchOperatorNotAllowed',
  location_unknown: 'locationUnknown',
  language_invalid: 'languageInvalid',
  device_invalid: 'deviceInvalid',
  priority_invalid: 'priorityInvalid',
  depth_profile_invalid: 'depthProfileInvalid',
  target_url_invalid: 'targetUrlInvalid',
  group_path_invalid: 'groupPathInvalid',
  repeated_row: 'repeatedRow',
  already_tracked: 'alreadyTracked',
  variant: 'variant',
  conflict: 'conflict',
} as const satisfies Record<ReasonCode, string>;
export const isReasonCode = (code: string | null): code is ReasonCode =>
  code !== null && (REASON_CODES as readonly string[]).includes(code);
