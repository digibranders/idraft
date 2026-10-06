import { rowWithIdentity, workspaceKeyword, type KeywordProjectCaller } from './keyword-rules';
import { canonicalUrl } from '../factories/keyword';
import { MOCK_LOCATIONS } from '../entity-fixtures';
import { cleanKeyword, keywordTextProblem, normalizeKeyword } from '@/lib/keywords/keyword-text';
import {
  DEPTH_PROFILES,
  FUNNEL_STAGES,
  INTENTS,
  type DepthProfile,
  type FunnelStage,
  type Intent,
} from '../keywords-state';
import type { components } from '@/lib/api/schema';

/**
 * An import's rows read and judged (backend plan D12 and D13, doc 08 sections 3.2 and 3.3): each source row
 * read through the column mapping and the defaults, `device: both` made two rows that share the `row_no`
 * (part 1 desktop, part 2 mobile), and each row given its outcome and the action it takes unless the user
 * changes it.
 */

export type ImportField = components['schemas']['ImportField'];
export type Outcome = components['schemas']['ImportRow']['outcome'];
export type RowAction = components['schemas']['ImportRow']['action'];

export const IMPORT_FIELDS: readonly ImportField[] = [
  'keyword',
  'country',
  'location',
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

/** Values for rows that leave a field out (`ImportDefaults`); the project's defaults otherwise. */
export interface ImportDefaults {
  location_id: number | null;
  language_code: string | null;
  device: 'desktop' | 'mobile' | 'both' | null;
  depth_profile: DepthProfile | null;
  priority: number | null;
  group_path: string | null;
  tags_vocabulary_id: string | null;
  topic_vocabulary_id: string | null;
}

export const NO_DEFAULTS: ImportDefaults = {
  location_id: null,
  language_code: null,
  device: null,
  depth_profile: null,
  priority: null,
  group_path: null,
  tags_vocabulary_id: null,
  topic_vocabulary_id: null,
};

/** One row of an import, as the preview lists it and the writer reads it. */
export interface AnalyzedRow {
  row_no: number;
  part: number;
  raw: Record<string, string>;
  keyword: string | null;
  normalized_text: string | null;
  location_id: number | null;
  language_code: string | null;
  device: 'desktop' | 'mobile' | null;
  outcome: Outcome;
  reason_code: string | null;
  reason: string | null;
  existing_tracked_keyword_id: string | null;
  /** The action of the outcome, before the user changes it. */
  default_action: RowAction;
  /** The actions the user may choose for this row: its outcome's, but a row that repeats another takes `skip` only. */
  allowed_actions: readonly RowAction[];
  /** The earlier row of the file this one repeats. */
  repeats: { row_no: number; part: number } | null;
  priority: number;
  depth_profile: DepthProfile | null;
  target_url: string | null;
  intent: Intent | null;
  funnel_stage: FunnelStage;
  group_path: string[];
  tags: string[];
  topic: string[];
}

/** The actions each outcome may take; `force_separate` waits for case-sensitive keywords (doc 08). */
export const ACTIONS_OF: Readonly<Record<Outcome, readonly RowAction[]>> = {
  new: ['create', 'skip'],
  variant: ['create', 'skip'],
  duplicate: ['skip', 'merge'],
  conflict: ['skip', 'merge'],
  invalid: ['skip'],
};

const DEFAULT_ACTION: Readonly<Record<Outcome, RowAction>> = {
  new: 'create',
  variant: 'create',
  duplicate: 'skip',
  conflict: 'skip',
  invalid: 'skip',
};

/** The limits of a row's cells (backend `keywords/import_rows.py`). */
const CELL_MAX = 2000;
const TAGS_MAX = 50;
const NAME_MAX = 100;
const PATH_DEPTH_MAX = 10;

/** The reasons of an invalid row, as the backend words them. */
const REASONS: Readonly<Record<string, string>> = {
  cell_too_long: `A cell has at most ${String(CELL_MAX)} characters.`,
  keyword_missing: 'A keyword has at least one character.',
  keyword_invalid: 'A keyword has no control characters.',
  keyword_too_long: 'A keyword has at most 700 characters.',
  search_operator_not_allowed:
    'Search operators (site:, intitle:, a quoted phrase, a word excluded with a minus) are not tracked.',
  cell_invalid: 'A cell has a character that cannot be kept.',
  location_unknown: 'No active location has this name, id or country.',
  language_invalid: 'A language is two letters, such as en.',
  device_invalid: 'A device is desktop, mobile or both.',
  priority_invalid: 'A priority is a whole number from 1 to 5.',
  depth_profile_invalid: 'This depth profile does not exist.',
  intent_invalid: 'This intent does not exist.',
  funnel_stage_invalid: 'This funnel stage does not exist.',
  target_url_invalid: 'A target URL is a full http or https address.',
  group_path_invalid: `A group is a path of names (Product/Pricing), at most ${String(PATH_DEPTH_MAX)} levels of ${String(NAME_MAX)} characters.`,
  tags_invalid: `A row has at most ${String(TAGS_MAX)} tags, of at most ${String(NAME_MAX)} characters each.`,
  topic_invalid: `A topic is a path of names (CRM/Startups), at most ${String(PATH_DEPTH_MAX)} levels of ${String(NAME_MAX)} characters.`,
};

/** A path such as `Services/SEO audits`, as names; `null` when a name is empty or too long. */
export function pathNames(path: string): string[] | null {
  const names = path.split('/').map((name) => name.trim());
  return names.every((name) => name.length >= 1 && name.length <= NAME_MAX) ? names : null;
}

/** A path of at most `PATH_DEPTH_MAX` names, or `null`. */
const boundedPath = (path: string): string[] | null => {
  const names = pathNames(path);
  return names !== null && names.length <= PATH_DEPTH_MAX ? names : null;
};

/** A cell the database cannot keep: a NUL or a lone surrogate. */
const unstorable = (cell: string): boolean => cell.includes('\u0000') || /\p{Surrogate}/u.test(cell);

/** A location of the file: an id or a name in `location`, else a country code in `country`. */
function locationOf(location: string, country: string): number | null | 'unknown' {
  if (location !== '') {
    const found = /^\d+$/.test(location)
      ? MOCK_LOCATIONS.find((candidate) => candidate.location_id === Number(location))
      : MOCK_LOCATIONS.find((candidate) => candidate.name.toLowerCase() === location.toLowerCase());
    return found?.location_id ?? 'unknown';
  }
  if (country !== '') {
    const found = MOCK_LOCATIONS.find(
      (candidate) => candidate.location_type === 'Country' && candidate.country_iso === country.toUpperCase(),
    );
    return found?.location_id ?? 'unknown';
  }
  return null;
}

const list = (value: string): string[] =>
  value
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item !== '');

/**
 * The rows of `records` read through `mapping` (header to field) and judged against the project's tracked
 * keywords as they are now.
 */
export function analyzeRows(
  caller: KeywordProjectCaller,
  records: readonly Record<string, string>[],
  mapping: Readonly<Record<string, ImportField>>,
  defaults: ImportDefaults,
): AnalyzedRow[] {
  const project = caller.project;
  const settings = caller.keywords.settings[project.project_id] ?? {};
  const columnOf = new Map(Object.entries(mapping).map(([header, field]) => [field, header]));
  const seen = new Map<string, { row_no: number; part: number }>();
  const rows: AnalyzedRow[] = [];
  records.forEach((record, index) => {
    const rowNo = index + 1;
    const value = (field: ImportField): string => {
      const header = columnOf.get(field);
      return header === undefined ? '' : (record[header] ?? '').trim();
    };
    const text = value('keyword');
    // The first problem of the row, in the order the backend checks: a cell over its limit (any cell of the
    // source row), the keyword, a cell the database cannot keep, then the columns
    const cells = Object.values(record);
    let problem: string | null = cells.some((cell) => cell.length > CELL_MAX)
      ? 'cell_too_long'
      : keywordTextProblem(text);
    if (problem === null && cells.some(unstorable)) problem = 'cell_invalid';
    const location = locationOf(value('location'), value('country'));
    const locationId =
      location === 'unknown' ? null : (location ?? defaults.location_id ?? project.default_location_id);
    if (problem === null && (location === 'unknown' || locationId === null)) problem = 'location_unknown';
    const languageText = value('language').toLowerCase();
    const language = languageText !== '' ? languageText : (defaults.language_code ?? project.default_language_code);
    if (problem === null && (language === null || !/^[a-z]{2}$/.test(language))) problem = 'language_invalid';
    const deviceText = value('device').toLowerCase();
    const device =
      deviceText === ''
        ? (defaults.device ?? settings.default_device ?? 'desktop')
        : deviceText === 'desktop' || deviceText === 'mobile' || deviceText === 'both'
          ? deviceText
          : null;
    if (problem === null && device === null) problem = 'device_invalid';
    const priorityText = value('priority');
    const priority = priorityText === '' ? (defaults.priority ?? 3) : Number(priorityText);
    if (problem === null && !(Number.isInteger(priority) && priority >= 1 && priority <= 5)) {
      problem = 'priority_invalid';
    }
    const depthText = value('depth_profile');
    const depth = DEPTH_PROFILES.find((profile) => profile === depthText) ?? null;
    if (problem === null && depthText !== '' && depth === null) problem = 'depth_profile_invalid';
    // An intent and a funnel stage that a row names must be ones the API has; a blank cell is `unknown`
    const intentText = value('intent').toLowerCase();
    const intent = intentText === '' ? 'unknown' : (INTENTS.find((candidate) => candidate === intentText) ?? null);
    if (problem === null && intent === null) problem = 'intent_invalid';
    const stageText = value('funnel_stage').toLowerCase();
    const stage = stageText === '' ? 'unknown' : (FUNNEL_STAGES.find((candidate) => candidate === stageText) ?? null);
    if (problem === null && stage === null) problem = 'funnel_stage_invalid';
    const target = value('target_url');
    if (problem === null && target !== '' && canonicalUrl(target) === null) problem = 'target_url_invalid';
    const groupText = value('group') !== '' ? value('group') : (defaults.group_path ?? '');
    const group = groupText === '' ? [] : boundedPath(groupText);
    if (problem === null && group === null) problem = 'group_path_invalid';
    // Distinct tags without regard to case; a row names at most 50, of at most 100 characters
    const tags = [...new Map(list(value('tags')).map((tag) => [tag.toLowerCase(), tag])).values()];
    if (problem === null && (tags.length > TAGS_MAX || tags.some((tag) => tag.length > NAME_MAX))) {
      problem = 'tags_invalid';
    }
    const topic = value('topic') === '' ? [] : boundedPath(value('topic'));
    if (problem === null && topic === null) problem = 'topic_invalid';
    const common = {
      row_no: rowNo,
      raw: { ...record },
      priority: Number.isInteger(priority) ? priority : 3,
      depth_profile: depth ?? defaults.depth_profile,
      target_url: target === '' ? null : target,
      // A row that names no intent leaves it to the provider
      intent: intentText === '' ? null : intent,
      funnel_stage: stage ?? 'unknown',
      group_path: group ?? [],
      tags,
      topic: topic ?? [],
      repeats: null,
    };
    if (problem !== null || locationId === null || language === null || device === null) {
      const code = problem ?? 'keyword_invalid';
      rows.push({
        ...common,
        part: 1,
        keyword: text === '' ? null : text,
        normalized_text: text === '' ? null : normalizeKeyword(text),
        location_id: locationId,
        language_code: language,
        device: device === 'desktop' || device === 'mobile' ? device : null,
        outcome: 'invalid',
        reason_code: code,
        reason: REASONS[code] ?? null,
        existing_tracked_keyword_id: null,
        default_action: DEFAULT_ACTION.invalid,
        allowed_actions: ACTIONS_OF.invalid,
      });
      return;
    }
    const cleaned = cleanKeyword(text);
    const normalized = normalizeKeyword(text);
    const keyword = workspaceKeyword(caller.keywords, caller.access.workspace.workspace_id, normalized, language);
    const devices = device === 'both' ? (['desktop', 'mobile'] as const) : [device];
    devices.forEach((one, partIndex) => {
      const part = partIndex + 1;
      const key = `${normalized}|${language}|${String(locationId)}|${one}`;
      const first = seen.get(key);
      const base = {
        ...common,
        part,
        keyword: cleaned,
        normalized_text: normalized,
        location_id: locationId,
        language_code: language,
        device: one,
      };
      if (first !== undefined) {
        rows.push({
          ...base,
          outcome: 'duplicate',
          reason_code: 'repeated_in_file',
          reason: `Same as row ${String(first.row_no)}`,
          existing_tracked_keyword_id: null,
          default_action: DEFAULT_ACTION.duplicate,
          allowed_actions: ['skip'],
          repeats: first,
        });
        return;
      }
      seen.set(key, { row_no: rowNo, part });
      const existing =
        keyword === undefined
          ? undefined
          : rowWithIdentity(caller.keywords, project.project_id, keyword.keyword_id, locationId, language, one);
      const live = existing !== undefined && existing.deleted_at === null ? existing : undefined;
      const outcome: Outcome =
        live === undefined
          ? keyword !== undefined && keyword.text !== cleaned
            ? 'variant'
            : 'new'
          : live.is_active
            ? 'duplicate'
            : 'conflict';
      // The codes and words of the backend: tracked, archived and casing_differs
      const reason =
        outcome === 'variant'
          ? `Tracked as "${keyword?.text ?? ''}"`
          : outcome === 'duplicate'
            ? 'Already tracked.'
            : outcome === 'conflict'
              ? 'Tracked, and archived.'
              : null;
      rows.push({
        ...base,
        outcome,
        reason_code:
          outcome === 'new'
            ? null
            : outcome === 'duplicate'
              ? 'tracked'
              : outcome === 'conflict'
                ? 'archived'
                : 'casing_differs',
        reason,
        existing_tracked_keyword_id: live?.tracked_keyword_id ?? null,
        default_action: DEFAULT_ACTION[outcome],
        allowed_actions: ACTIONS_OF[outcome],
      });
    });
  });
  return rows;
}
