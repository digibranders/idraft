import { HttpResponse, type HttpHandler } from 'msw';

import { can } from './access';
import {
  ACTIONS_OF,
  analyzeRows,
  IMPORT_FIELDS,
  NO_DEFAULTS,
  pathNames,
  type AnalyzedRow,
  type ImportDefaults,
  type ImportField,
  type Outcome,
  type RowAction,
} from './keyword-import-rows';
import {
  integerError,
  keywordProjectCaller,
  MAX_TRACKED_KEYWORDS,
  now,
  quotaProblem,
  savedKeywords,
  type CreateItem,
  type KeywordProjectCaller,
  type ScheduleCheck,
} from './keyword-rules';
import { mergeTerms, plan, written } from './keyword-writes';
import { scheduleCheckFor, systemMetricsRun } from './operations-rules';
import {
  at,
  bodyError,
  cursorPage,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  pageRequest,
  queryError,
  textError,
  uuidError,
} from './rules';
import { savedEntities } from './access';
import { entityWorld, idMinter, withCreated, type EntityChanges, type StoredTerm } from '../entities-state';
import { MOCK_LOCATIONS } from '../entity-fixtures';
import { userRef } from '../factories/keyword';
import { MOCK_CREATED_AT } from '../fixtures';
import {
  DEPTH_PROFILES,
  keywordIdMinter,
  keywordWorld,
  withGroup,
  withTracked,
  type KeywordChanges,
  type StoredGroup,
} from '../keywords-state';
import { mockId } from '../mock-ids';
import { onMockReset } from '../state';
import { projectList } from '../workspace-state';
import { termSlug } from '../term-slug';
import { invalid, mock, problem, setCookies } from '../respond';
import type { components } from '@/lib/api/schema';
import type { ValidationItem } from '@/lib/api/types';
import { parseCsv, toCsv } from '@/lib/csv/csv';
import { headerKey } from '@/lib/csv/csv-head';

/**
 * Keyword imports (19 section 3.5, backend plan D11 to D13): a paste, JSON rows or a CSV upload is parsed
 * into a preview (a second or two here), the user maps columns, sets defaults and changes row actions, and
 * confirming writes the rows. The mocks keep imports in the memory of whatever answers the request (the
 * browser's worker, or the test's server): their rows do not fit in a cookie, so a reload forgets them.
 * Confirming writes into the keyword and entity cookies at once; the import then shows `writing` for a
 * moment, as the API's batches would.
 *
 * Statuses as the backend commits them: a new import and every PATCH of the mapping or the defaults read
 * `uploaded` until the parse ends (`parsing` is in the contract but never produced), then `preview_ready`, or
 * `needs_mapping` with an `error_code` of what is missing: a keyword column, or a vocabulary for the tags or
 * the topic. `error_code` is otherwise the reason of a `failed` import.
 */

type KeywordImport = components['schemas']['KeywordImport'];
type ImportStatus = KeywordImport['status'];
type Source = KeywordImport['source'];

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PARSE_MS = 1_500;
const WRITE_MS_PER_1000 = 1_000;
const WRITE_MS_MIN = 2_000;
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Room in an upload's form for its options and part headers. */
const MAX_OPTIONS_BYTES = 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_PASTE = 1_000_000;
/** How long a client waits before it asks about an import again (19 section 2.10). */
const IMPORT_RETRY_SECONDS = '5';
const SOURCE_OF: Readonly<Record<Source, 'csv_import' | 'bulk_paste' | 'api'>> = {
  upload: 'csv_import',
  paste: 'bulk_paste',
  api: 'api',
};
const STATUSES: readonly ImportStatus[] = [
  'uploaded',
  'parsing',
  'needs_mapping',
  'preview_ready',
  'writing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'expired',
];

/** What became of a row the write reached: the report's `result` and `write_error_code`. */
interface RowResult {
  result: 'created' | 'skipped' | 'merged' | 'failed';
  error: string | null;
}

interface Written {
  at: number;
  until: number;
  created: number;
  skipped: number;
  merged: number;
  /** The tracked keyword each row ended as, for the report. */
  trackedIds: Map<string, string>;
  /** What became of each row the write reached, by `row_no:part`. */
  results: Map<string, RowResult>;
  /** Rows that ended `failed`: the import is `completed_with_errors` when any did. */
  failed: number;
  /** The write stopped on an error (`failed`, `write_failed`) after this many rows; `null` when it did not. */
  stoppedAfter: number | null;
}

/**
 * What the write of a confirmed import does wrong, for tests: the way to reach the states the backend
 * ends an import in when its write goes wrong. `forgetImports` (which every test's reset calls) puts it
 * back.
 */
export interface WriteTrouble {
  /** The write stops on an error after this many batches: `failed` with `write_failed`, the batches before it kept. */
  stopAfterBatches: number | null;
  /** Rows to a batch; the backend's is 1,000. */
  batchSize: number;
  /** Rows, by `row_no`, the write cannot keep: each ends `failed`, and the import `completed_with_errors`. */
  failedRows: readonly number[];
}

const NO_TROUBLE: WriteTrouble = { stopAfterBatches: null, batchSize: 1_000, failedRows: [] };
export const writeTrouble: WriteTrouble = { ...NO_TROUBLE };

/** The most imports the store keeps: past it the oldest finished ones go, as an old import would expire. */
const IMPORTS_KEPT = 20;

interface StoredImport {
  import_id: string;
  workspace_id: string;
  project_id: string;
  source: Source;
  original_filename: string | null;
  created_by: string;
  created_at: number;
  headers: string[];
  records: Record<string, string>[];
  /** A paste with a TAB in some line: those lines carry tags, which need a vocabulary. */
  tabbed: boolean;
  /** The mapping once the file is read: keyed by the file's header text, trimmed, in the file's case. */
  mapping: Record<string, ImportField>;
  /** The keys of the mapping as the client sent them, which the import echoes until it has been read. */
  sent_mapping: Record<string, string>;
  defaults: ImportDefaults;
  /** When the current parse ends; a new mapping or new defaults parse again. */
  parsed_at: number;
  rows: AnalyzedRow[];
  /** The user's actions, by `row_no:part`. */
  actions: Map<string, RowAction>;
  written: Written | null;
  cancelled_at: number | null;
  error_code: string | null;
}

/** The imports this worker or server has seen, by id. */
const IMPORTS = new Map<string, StoredImport>();
let lastImport = 0;

const rowKey = (row: { row_no: number; part: number }): string => `${String(row.row_no)}:${String(row.part)}`;
const actionOf = (entry: StoredImport, row: AnalyzedRow): RowAction =>
  entry.actions.get(rowKey(row)) ?? row.default_action;

type MappingProblem = 'keyword_column_missing' | 'tags_vocabulary_missing' | 'topic_vocabulary_missing';

/**
 * What stops the preview, in the order the backend checks: a keyword column, then a vocabulary for tags, then
 * one for the topic. Tags and topic count when a mapped column names them or, for a paste, when a line holds
 * a TAB.
 */
function mappingProblem(entry: StoredImport): MappingProblem | null {
  const fields = Object.values(entry.mapping);
  if (!fields.includes('keyword')) return 'keyword_column_missing';
  const hasTags = entry.source === 'paste' ? entry.tabbed : fields.includes('tags');
  if (hasTags && entry.defaults.tags_vocabulary_id === null) return 'tags_vocabulary_missing';
  if (fields.includes('topic') && entry.defaults.topic_vocabulary_id === null) return 'topic_vocabulary_missing';
  return null;
}

function statusOf(entry: StoredImport, at: number): ImportStatus {
  if (entry.cancelled_at !== null) return 'cancelled';
  if (entry.error_code !== null) return 'failed';
  if (entry.written !== null) {
    if (at < entry.written.until) return 'writing';
    // `completed_with_errors` is for rows the write could not keep; rows the preview skipped (invalid ones)
    // are a `completed` import
    if (entry.written.stoppedAfter !== null) return 'failed';
    return entry.written.failed > 0 ? 'completed_with_errors' : 'completed';
  }
  if (at >= entry.created_at + EXPIRY_MS) return 'expired';
  if (at < entry.parsed_at) return 'uploaded';
  return mappingProblem(entry) === null ? 'preview_ready' : 'needs_mapping';
}

/** An import's status as an operation's (19 section 2.11), as the backend maps it. */
const OPERATION_STATUS: Readonly<Record<ImportStatus, components['schemas']['Operation']['status']>> = {
  uploaded: 'queued',
  parsing: 'queued',
  needs_mapping: 'waiting_for_input',
  preview_ready: 'waiting_for_input',
  writing: 'running',
  completed: 'succeeded',
  completed_with_errors: 'succeeded_with_errors',
  failed: 'failed',
  cancelled: 'cancelled',
  expired: 'failed',
};

/** What each failure code says (`operation.error.detail`), as the backend words it. */
const FAILURES: Readonly<Record<string, string>> = {
  not_utf8: 'The file is not UTF-8 text.',
  not_csv: 'The file is not readable as CSV.',
  no_header: 'The file has no header row.',
  duplicate_headers: 'Two columns have the same header, without regard to case.',
  too_many_rows: 'An import has at most 10,000 rows.',
  too_many_columns: 'An import has at most 100 columns.',
  parse_failed: 'The source could not be read. Upload it again.',
  write_failed: 'The write stopped on an error. The report shows what was written.',
  source_corrupt: 'The stored source could not be read. Upload the file again.',
  source_unreadable: 'The stored source could not be fetched. Upload the file again.',
  project_gone: 'The project was deleted.',
  expired: 'The preview expired before it was confirmed.',
};

/** Statuses an import may still be cancelled in: before writing starts (not while its source is being read). */
const CANCELLABLE: readonly ImportStatus[] = ['uploaded', 'needs_mapping', 'preview_ready'];
/** Statuses an import has no rows in yet: its source is waiting to be read, or read again. */
const NO_ROWS_YET: readonly ImportStatus[] = ['uploaded', 'parsing', 'needs_mapping'];

/**
 * Whether the import has rows to list and report on: it was read into a preview, and the preview was not
 * dropped. An import that failed while being read, or was cancelled or expired before it had a preview, has
 * none; one that failed while writing keeps them.
 */
function hasRows(entry: StoredImport, status: ImportStatus): boolean {
  if (NO_ROWS_YET.includes(status)) return false;
  if (status === 'failed') return entry.written !== null;
  if (status === 'cancelled')
    return entry.cancelled_at !== null && entry.cancelled_at >= entry.parsed_at && mappingProblem(entry) === null;
  if (status === 'expired') return mappingProblem(entry) === null;
  return true;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function importView(caller: KeywordProjectCaller, entry: StoredImport, at: number): KeywordImport {
  const status = statusOf(entry, at);
  const parts = entry.rows;
  const count = (outcome: Outcome): number => parts.filter((row) => row.outcome === outcome).length;
  const ready = hasRows(entry, status);
  const finishedWriting = status === 'completed' || status === 'completed_with_errors';
  const used = activeRows(caller);
  const wouldUse = parts.filter((row) => {
    const action = actionOf(entry, row);
    return action === 'create' || (row.outcome === 'conflict' && action === 'merge');
  }).length;
  const self = `/api/v1/workspaces/${entry.workspace_id}/projects/${entry.project_id}/keyword-imports/${entry.import_id}`;
  const parsing = status === 'uploaded';
  // The rows the write has reached: all of them, or those before the error that stopped it
  const written = entry.written;
  const reach = written?.stoppedAfter ?? parts.length;
  const writingDone =
    written === null
      ? 0
      : Math.min(reach, Math.floor((reach * (at - written.at)) / Math.max(1, written.until - written.at)));
  const finished = entry.cancelled_at ?? (written !== null && at >= written.until ? written.until : null);
  // An import that failed while writing says `write_failed`; an expired one has no `error_code` of its own,
  // and its operation names `expired`
  const failedWriting = status === 'failed' && written !== null && written.stoppedAfter !== null;
  const errorCode = entry.error_code ?? (failedWriting ? 'write_failed' : null);
  const operationCode = errorCode ?? (status === 'expired' ? 'expired' : null);
  const report = ready;
  return {
    import_id: entry.import_id,
    source: entry.source,
    original_filename: entry.original_filename,
    status,
    // Before the worker has read the file the mapping is what was sent; after it, the one resolved
    column_mapping: status === 'uploaded' ? { ...entry.sent_mapping } : { ...entry.mapping },
    defaults: Object.fromEntries(Object.entries(entry.defaults).filter(([, value]) => value !== null)),
    counts: {
      // Rows of the import: a `device: both` row of the file counts once per part
      rows_total: ready ? parts.length : 0,
      new: ready ? count('new') : 0,
      duplicate: ready ? count('duplicate') : 0,
      variant: ready ? count('variant') : 0,
      conflict: ready ? count('conflict') : 0,
      invalid: ready ? count('invalid') : 0,
      // Counted when the write has ended with every row given a result, as the backend does: an import that
      // failed while writing keeps the counts of its preview, with none of these
      created: finishedWriting ? (written?.created ?? 0) : 0,
      skipped: finishedWriting ? (written?.skipped ?? 0) : 0,
      merged: finishedWriting ? (written?.merged ?? 0) : 0,
    },
    // The quota is judged against the preview, so only a ready preview has one
    quota: status === 'preview_ready' ? { limit: MAX_TRACKED_KEYWORDS, used, would_use: used + wouldUse } : null,
    error_code: errorCode ?? (status === 'needs_mapping' ? mappingProblem(entry) : null),
    created_by: userRef(entry.created_by) ?? { user_id: entry.created_by, name: 'Member', email: '' },
    created_at: iso(entry.created_at),
    expires_at: iso(entry.created_at + EXPIRY_MS),
    finished_at: finished === null ? null : iso(finished),
    operation: {
      kind: 'keyword_import',
      status: OPERATION_STATUS[status],
      progress: {
        done: parsing
          ? Math.floor((entry.records.length * Math.max(0, at - (entry.parsed_at - PARSE_MS))) / PARSE_MS)
          : status === 'writing'
            ? writingDone
            : reach,
        total: parsing ? entry.records.length : parts.length,
        unit: 'rows',
      },
      started_at: iso(entry.created_at),
      finished_at: finished === null ? null : iso(finished),
      error:
        operationCode === null
          ? null
          : { code: operationCode, detail: FAILURES[operationCode] ?? 'The import could not be read.' },
      links: {
        self,
        ...(CANCELLABLE.includes(status) ? { cancel: `${self}/cancel` } : {}),
        // The report, whenever there are rows to report on (`links.result` is set exactly then)
        ...(report ? { result: `${self}/report` } : {}),
      },
    },
  };
}

/** Active tracked keywords of the workspace's live projects (the quota's `used`, D4). */
function activeRows(caller: KeywordProjectCaller): number {
  const projects = new Set(projectList(caller.changes, caller.access.workspace.workspace_id).map((p) => p.project_id));
  return caller.keywords.tracked.filter(
    (row) => projects.has(row.project_id) && row.deleted_at === null && row.is_active,
  ).length;
}

/** An answer about an import, with `Retry-After` while it is not settled. */
function answerImport(
  caller: KeywordProjectCaller,
  entry: StoredImport,
  status = 200,
  headers: Headers = new Headers(),
): Response {
  const at = Date.now();
  const view = importView(caller, entry, at);
  if (view.operation.status === 'running') headers.set('retry-after', IMPORT_RETRY_SECONDS);
  return HttpResponse.json({ data: view }, { status, headers });
}

/** The import of the caller's project with this id. */
function importOf(caller: KeywordProjectCaller, id: string | readonly string[] | undefined): StoredImport | undefined {
  const entry = typeof id === 'string' ? IMPORTS.get(id) : undefined;
  return entry !== undefined &&
    entry.project_id === caller.project.project_id &&
    entry.workspace_id === caller.access.workspace.workspace_id
    ? entry
    : undefined;
}

// Reading a source

interface Source0 {
  headers: string[];
  records: Record<string, string>[];
  /** A paste with a TAB in some line; always `false` for the other sources. */
  tabbed: boolean;
}

/**
 * The mapping the backend resolves once it has read the file. A key sent is matched to a header trimmed and
 * without case; a key that matches no header, and a field name that is not an import field, are ignored. The
 * mapping is keyed by the header text of the file, trimmed, with the case the file wrote. A header that names
 * a field and is not mapped otherwise maps to it by name (the automatic mapping), unless the field is taken.
 */
function resolveMapping(
  headers: readonly string[],
  sent: Readonly<Record<string, unknown>> | null,
): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  const taken = new Set<ImportField>();
  const headerOf = new Map(headers.map((header) => [headerKey(header), header]));
  for (const [key, value] of Object.entries(sent ?? {})) {
    const field = IMPORT_FIELDS.find((candidate) => candidate === value);
    const header = headerOf.get(headerKey(key));
    if (field !== undefined && header !== undefined && !taken.has(field)) {
      mapping[header] = field;
      taken.add(field);
    }
  }
  for (const header of headers) {
    const field = IMPORT_FIELDS.find((candidate) => candidate === headerKey(header));
    if (field !== undefined && mapping[header] === undefined && !taken.has(field)) {
      mapping[header] = field;
      taken.add(field);
    }
  }
  return mapping;
}

/** The keys of a mapping as they were sent, which an import still being read echoes. */
const sentKeys = (sent: Readonly<Record<string, unknown>> | null): Record<string, string> =>
  Object.fromEntries(
    Object.entries(sent ?? {}).flatMap(([key, field]): [string, string][] =>
      typeof field === 'string' ? [[key, field]] : [],
    ),
  );

/** The headers of a CSV file as the backend reads them: trimmed. */
function fromCsv(text: string): Source0 {
  const [header = [], ...lines] = parseCsv(text);
  const headers = header.map((name) => name.trim());
  return {
    headers,
    records: lines.map((cells) => Object.fromEntries(headers.map((name, index) => [name, cells[index] ?? '']))),
    tabbed: false,
  };
}

/** Paste: one keyword per line, tags after a TAB, separated by `|`. */
function fromPaste(text: string): Source0 {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  return {
    headers: ['keyword', 'tags'],
    records: lines.map((line) => {
      const [keyword = '', ...rest] = line.split('\t');
      return { keyword, tags: rest.join('|') };
    }),
    tabbed: lines.some((line) => line.includes('\t')),
  };
}

/** Rows keyed by column name, as a client that has read a file itself sends them: names are trimmed here. */
function fromRows(rows: readonly Readonly<Record<string, unknown>>[]): Source0 {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row).map((name) => name.trim())))];
  return {
    headers,
    records: rows.map((row) =>
      Object.fromEntries(
        headers.map((name) => {
          const cell = Object.entries(row).find(([key]) => key.trim() === name)?.[1];
          return [name, typeof cell === 'string' ? cell : ''];
        }),
      ),
    ),
    tabbed: false,
  };
}

// Options: the column mapping and the defaults

/** A paste has no columns to map (backend rule 4). */
const NO_COLUMNS_ERROR: ValidationItem = bodyError('column_mapping', 'not_applicable', 'A paste has no columns.');

/**
 * What the backend refuses of a mapping: two keys that name the same header (trimmed, without case) and two
 * keys mapped to one field. A key that matches no header and a field that is no import field are ignored.
 */
function mappingErrors(value: unknown): ValidationItem[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return [bodyError('column_mapping', 'dict_type', 'Input should be an object')];
  const errors: ValidationItem[] = [];
  const keys = new Set<string>();
  const fields = new Set<ImportField>();
  for (const [key, mapped] of Object.entries(value)) {
    if (keys.has(headerKey(key)) && !errors.some((error) => error.code === 'header_repeated')) {
      errors.push(bodyError('column_mapping', 'header_repeated', 'Two keys name the same header.'));
    }
    keys.add(headerKey(key));
    const field = IMPORT_FIELDS.find((candidate) => candidate === mapped);
    if (field === undefined) continue;
    if (fields.has(field)) {
      errors.push(
        bodyError(at('column_mapping', key), 'field_mapped_twice', 'Another column already maps to this field.'),
      );
    }
    fields.add(field);
  }
  return errors;
}

const DEFAULT_FIELDS = [
  'location_id',
  'language_code',
  'device',
  'depth_profile',
  'priority',
  'group_path',
  'tags_vocabulary_id',
  'topic_vocabulary_id',
] as const;

function defaultsErrors(caller: KeywordProjectCaller, value: unknown): ValidationItem[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return [bodyError('defaults', 'model_attributes_type', 'Input should be an object')];
  const errors: ValidationItem[] = [
    ...extraMembers(value, DEFAULT_FIELDS, 'defaults'),
    ...integerError(value.location_id, 'defaults.location_id', { nullable: true }),
    ...(value.language_code === undefined || value.language_code === null
      ? []
      : typeof value.language_code === 'string' && /^[a-z]{2}$/.test(value.language_code)
        ? []
        : [bodyError('defaults.language_code', 'string_pattern_mismatch', 'Two lower-case letters.')]),
    ...(value.device === undefined || value.device === null
      ? []
      : enumError(value.device, 'defaults.device', ['desktop', 'mobile', 'both'])),
    ...(value.depth_profile === undefined || value.depth_profile === null
      ? []
      : enumError(value.depth_profile, 'defaults.depth_profile', DEPTH_PROFILES)),
    ...integerError(value.priority, 'defaults.priority', { min: 1, max: 5, nullable: true }),
    ...(value.group_path === undefined || value.group_path === null
      ? []
      : textError(value.group_path, 'defaults.group_path', { max: 1000 })),
    ...uuidError(value.tags_vocabulary_id, 'defaults.tags_vocabulary_id', { nullable: true }),
    ...uuidError(value.topic_vocabulary_id, 'defaults.topic_vocabulary_id', { nullable: true }),
  ];
  if (errors.length > 0) return errors;
  // The service's checks: a location that exists, a path of names, vocabularies the caller may write to
  if (
    typeof value.location_id === 'number' &&
    !MOCK_LOCATIONS.some((location) => location.location_id === value.location_id)
  ) {
    errors.push(bodyError('defaults.location_id', 'location_unknown', 'No active location has this id.'));
  }
  if (typeof value.group_path === 'string' && pathNames(value.group_path) === null) {
    errors.push(bodyError('defaults.group_path', 'group_path_invalid', 'Names of 1 to 100 characters joined by "/".'));
  }
  for (const name of ['tags_vocabulary_id', 'topic_vocabulary_id'] as const) {
    const id = value[name];
    if (typeof id !== 'string') continue;
    const vocabulary = caller.world.vocabularies.find((candidate) => candidate.vocabulary_id === id);
    const scope = vocabulary?.project_id ?? null;
    if (vocabulary === undefined || (scope !== null && scope !== caller.project.project_id)) {
      errors.push(bodyError(`defaults.${name}`, 'vocabulary_unknown', 'No vocabulary of this project has this id.'));
    } else if (scope === null && caller.access.membership.project_ids !== null) {
      // D13: a member limited to some projects names only their projects' vocabularies
      errors.push(bodyError(`defaults.${name}`, 'vocabulary_not_allowed', 'Choose a vocabulary of this project.'));
    }
  }
  return errors;
}

function defaultsOf(value: unknown, base: ImportDefaults): ImportDefaults {
  if (!isRecord(value)) return base;
  const text = (name: string): string | null => {
    const member = value[name];
    return typeof member === 'string' ? member : null;
  };
  const device = text('device');
  const depth = text('depth_profile');
  return {
    location_id: typeof value.location_id === 'number' ? value.location_id : null,
    language_code: text('language_code'),
    device: device === 'desktop' || device === 'mobile' || device === 'both' ? device : null,
    depth_profile: DEPTH_PROFILES.find((profile) => profile === depth) ?? null,
    priority: typeof value.priority === 'number' ? value.priority : null,
    group_path: text('group_path'),
    tags_vocabulary_id: text('tags_vocabulary_id'),
    topic_vocabulary_id: text('topic_vocabulary_id'),
  };
}

/** A new import of `source`, read now: it shows `uploaded` until `parsed_at`. */
function created(
  caller: KeywordProjectCaller,
  source: Source,
  filename: string | null,
  read: Source0,
  sent: Readonly<Record<string, unknown>> | null,
  defaults: ImportDefaults,
): StoredImport {
  lastImport += 1;
  const createdAt = Date.now();
  const columns = resolveMapping(read.headers, sent);
  const entry: StoredImport = {
    import_id: mockId('import', lastImport),
    workspace_id: caller.access.workspace.workspace_id,
    project_id: caller.project.project_id,
    source,
    original_filename: filename,
    created_by: caller.session.user.user_id,
    created_at: createdAt,
    headers: read.headers,
    records: read.records,
    tabbed: read.tabbed,
    mapping: columns,
    sent_mapping: sentKeys(sent),
    defaults,
    parsed_at: createdAt + PARSE_MS,
    rows: analyzeRows(caller, read.records, columns, defaults),
    actions: new Map(),
    written: null,
    cancelled_at: null,
    // A file with a header and no rows is a preview of no rows, not a failure
    error_code: null,
  };
  IMPORTS.set(entry.import_id, entry);
  trimImports(entry.import_id);
  return entry;
}

/** Keeps the store to `IMPORTS_KEPT`: the oldest finished imports go first, and never the one just made. */
function trimImports(keep: string): void {
  const at = Date.now();
  const finished = (entry: StoredImport): boolean => {
    const status = statusOf(entry, at);
    return !['uploaded', 'parsing', 'needs_mapping', 'preview_ready', 'writing'].includes(status);
  };
  for (const [id, entry] of [...IMPORTS]) {
    if (IMPORTS.size <= IMPORTS_KEPT) return;
    if (id !== keep && finished(entry)) IMPORTS.delete(id);
  }
}

const accepted = (caller: KeywordProjectCaller, entry: StoredImport): Response => {
  const path = `/api/v1/workspaces/${entry.workspace_id}/projects/${entry.project_id}/keyword-imports/${entry.import_id}`;
  return answerImport(caller, entry, 202, new Headers({ location: path }));
};

// Writing (D12, D13)

/**
 * The keyword and entity changes confirming writes, with the counts: groups and terms that are missing are
 * made, then each row is created, merged or skipped by its action. A repeated row's groups and tags join the
 * row it repeats. Only the first `reach` rows are written (all of them unless a test made the write stop on
 * an error), and the rows of `failedRows` end `failed`.
 */
function writeRows(
  caller: KeywordProjectCaller,
  entry: StoredImport,
  duplicateAction: 'skip' | 'merge_terms',
  scheduleIsLive: ScheduleCheck,
  reach: number,
  failedRows: ReadonlySet<number>,
): {
  keywords: KeywordChanges;
  entities: EntityChanges;
  /** Terms the import made, which takes `taxonomy:write` (D13). */
  termsCreated: number;
  written: Omit<Written, 'at' | 'until'>;
} {
  const projectId = caller.project.project_id;
  let keywords = caller.keywordChanges;
  let entities = caller.entityChanges;
  let termsCreated = 0;
  const keywordIds = keywordIdMinter(keywords);
  const entityIds = idMinter(entities);
  // Groups by path, made where missing
  const groupIdOf = (names: readonly string[]): string => {
    let parent: string | null = null;
    for (const name of names) {
      const world = keywordWorld(keywords);
      const found: StoredGroup | undefined = world.groups.find(
        (group) =>
          group.project_id === projectId &&
          group.parent_id === parent &&
          group.name.toLowerCase() === name.toLowerCase(),
      );
      if (found !== undefined) {
        parent = found.group_id;
        continue;
      }
      const group: StoredGroup = {
        group_id: keywordIds.next('group'),
        project_id: projectId,
        name,
        parent_id: parent,
        created_at: now(),
      };
      keywords = withGroup(keywords, group);
      parent = group.group_id;
    }
    return parent ?? '';
  };
  // Terms by path in a chosen vocabulary, made where missing (a flat vocabulary takes one level)
  const termIdOf = (vocabularyId: string | null, names: readonly string[]): string | null => {
    if (vocabularyId === null || names.length === 0) return null;
    const vocabulary = entityWorld(entities, caller.changes).vocabularies.find((v) => v.vocabulary_id === vocabularyId);
    if (vocabulary === undefined || (vocabulary.is_hierarchical !== true && names.length > 1)) return null;
    let parent: string | null = null;
    for (const name of names) {
      const terms = entityWorld(entities, caller.changes).terms.filter((term) => term.vocabulary_id === vocabularyId);
      const siblings = terms.filter((term) => (term.parent_id ?? null) === parent);
      const found = siblings.find((term) => term.name.trim().toLowerCase() === name.toLowerCase());
      if (found !== undefined) {
        parent = found.term_id;
        continue;
      }
      const taken = new Set(siblings.map((term) => term.slug));
      let slug = termSlug(name);
      for (let n = 2; taken.has(slug); n += 1) slug = `${termSlug(name)}-${String(n)}`;
      const term: StoredTerm = {
        term_id: entityIds.next('term'),
        vocabulary_id: vocabularyId,
        ...(parent === null ? {} : { parent_id: parent }),
        name,
        slug,
        source: 'import',
        created_at: MOCK_CREATED_AT,
      };
      entities = withCreated(entities, 'terms', term);
      termsCreated += 1;
      parent = term.term_id;
    }
    return parent;
  };
  const linksOf = (row: AnalyzedRow): Pick<CreateItem, 'groupIds' | 'termIds'> => ({
    groupIds: row.group_path.length === 0 ? [] : [groupIdOf(row.group_path)],
    termIds: [
      ...row.tags.map((tag) => termIdOf(entry.defaults.tags_vocabulary_id, [tag])),
      termIdOf(entry.defaults.topic_vocabulary_id, row.topic),
    ].filter((id): id is string => id !== null),
  });
  const links = new Map(entry.rows.map((row) => [rowKey(row), linksOf(row)]));
  // The writes below see the terms made above
  const writer: KeywordProjectCaller = {
    ...caller,
    entityChanges: entities,
    world: entityWorld(entities, caller.changes),
  };
  const trackedIds = new Map<string, string>();
  const results = new Map<string, RowResult>();
  let created = 0;
  let skipped = 0;
  let merged = 0;
  let failed = 0;
  const byKey = new Map(entry.rows.map((row) => [rowKey(row), row]));
  for (const row of entry.rows.slice(0, reach)) {
    // `merge_terms` applies to duplicates left at their default action, not to a skip the user chose
    const action =
      row.outcome === 'duplicate' && duplicateAction === 'merge_terms' && !entry.actions.has(rowKey(row))
        ? 'merge'
        : actionOf(entry, row);
    const link = links.get(rowKey(row)) ?? { groupIds: [], termIds: [] };
    const key = rowKey(row);
    if (failedRows.has(row.row_no) && action !== 'skip') {
      // A row the write could not keep: nothing of it is written
      results.set(key, { result: 'failed', error: 'tracked_keyword_gone' });
      failed += 1;
      continue;
    }
    if (row.repeats !== null) {
      // A repeated row is skipped, its groups and tags joining the row it repeats, whatever that row became
      const repeated = rowKey(row.repeats);
      const first = trackedIds.get(repeated) ?? byKey.get(repeated)?.existing_tracked_keyword_id ?? undefined;
      if (first !== undefined) keywords = mergeTerms(writer, keywords, first, link);
      results.set(key, { result: 'skipped', error: null });
      skipped += 1;
      continue;
    }
    if (action === 'skip' || row.outcome === 'invalid' || row.keyword === null || row.device === null) {
      results.set(key, { result: 'skipped', error: null });
      skipped += 1;
      continue;
    }
    if (action === 'merge' && row.existing_tracked_keyword_id !== null) {
      const id = row.existing_tracked_keyword_id;
      if (row.outcome === 'conflict') {
        const archived = keywordWorld(keywords).tracked.find((candidate) => candidate.tracked_keyword_id === id);
        if (archived !== undefined)
          keywords = withTracked(keywords, { ...archived, is_active: true, updated_at: now() });
      }
      keywords = mergeTerms(writer, keywords, id, link);
      trackedIds.set(rowKey(row), id);
      results.set(key, { result: 'merged', error: null });
      merged += 1;
      continue;
    }
    const item: CreateItem = {
      text: row.keyword,
      locationId: row.location_id,
      languageCode: row.language_code,
      device: row.device,
      os: null,
      depthProfile: row.depth_profile,
      frequency: null,
      priority: row.priority,
      intent: row.intent,
      funnelStage: row.funnel_stage,
      businessValue: null,
      targetUrl: row.target_url,
      scheduleId: null,
      groupIds: link.groupIds,
      termIds: link.termIds,
      include: [],
      exclude: [],
    };
    const planned = plan(writer, item, keywords, keywordIds.next, scheduleIsLive, SOURCE_OF[entry.source]);
    const fresh = planned.rows.filter((candidate) => candidate.kind !== 'duplicate');
    keywords = written(writer, planned.changes, fresh, item);
    const [made] = planned.rows;
    if (made !== undefined) trackedIds.set(rowKey(row), made.row.tracked_keyword_id);
    results.set(key, { result: fresh.length > 0 ? 'created' : 'skipped', error: null });
    if (fresh.length > 0) created += 1;
    else skipped += 1;
  }
  return {
    keywords: keywordIds.commit(keywords),
    entities: entityIds.commit(entities),
    termsCreated,
    written: {
      created,
      skipped,
      merged,
      trackedIds,
      results,
      failed,
      // Short of the rows: the write stopped on an error there
      stoppedAfter: reach < entry.rows.length ? reach : null,
    },
  };
}

// Routes

export const keywordImportHandlers: HttpHandler[] = [
  mock('get', `${P}/keyword-imports`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[status]', 'cursor', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const status = caller.url.searchParams.get('filter[status]');
    const paging = pageRequest(caller.url);
    const errors: ValidationItem[] = [
      ...(status === null || isOneOf(status, STATUSES)
        ? []
        : [queryError('filter[status]', 'enum', `Allowed: ${STATUSES.join(', ')}.`)]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const at = Date.now();
    const rows = [...IMPORTS.values()]
      .filter((entry) => importOf(caller, entry.import_id) !== undefined)
      .filter((entry) => status === null || statusOf(entry, at) === status)
      .sort((a, b) => b.created_at - a.created_at || b.import_id.localeCompare(a.import_id));
    const page = cursorPage(rows, paging, JSON.stringify({ status }));
    if (page === null) return problem(request, 'invalid_cursor');
    return HttpResponse.json({ data: page.data.map((entry) => importView(caller, entry, at)), page: page.page });
  }),

  mock('post', `${P}/keyword-imports`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'imports:write',
    });
    if (caller instanceof Response) return caller;
    if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
      return problem(request, 'unsupported_media_type', { detail: 'Send JSON here, or a file to the upload route.' });
    }
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const rows = body.rows;
    const errors: ValidationItem[] = [
      ...extraMembers(body, ['source', 'paste', 'rows', 'column_mapping', 'defaults']),
      ...(body.source === undefined ? [bodyError('source', 'missing', 'Field required')] : []),
      ...(body.source === undefined ? [] : enumError(body.source, 'source', ['paste', 'api'])),
      ...(body.paste === undefined || body.paste === null ? [] : textError(body.paste, 'paste', { max: MAX_PASTE })),
      ...(rows === undefined || rows === null
        ? []
        : !Array.isArray(rows)
          ? [bodyError('rows', 'list_type', 'Input should be a valid list')]
          : rows.length < 1 || rows.length > MAX_ROWS
            ? [bodyError('rows', rows.length < 1 ? 'too_short' : 'too_long', `From 1 to ${String(MAX_ROWS)} rows.`)]
            : rows.flatMap((row, index) =>
                isRecord(row)
                  ? Object.entries(row).flatMap(([name, value]) =>
                      textError(value, at(at('rows', index), name), { min: 0, max: 2000 }),
                    )
                  : [notAnObject(at('rows', index))],
              )),
      ...(body.source === 'paste' && typeof body.paste !== 'string'
        ? [bodyError('paste', 'missing', 'A paste import needs its text.')]
        : []),
      ...(body.source === 'api' && !Array.isArray(rows)
        ? [bodyError('rows', 'missing', 'An api import needs rows.')]
        : []),
      ...(body.source === 'paste' && body.column_mapping !== undefined ? [NO_COLUMNS_ERROR] : []),
      ...defaultsErrors(caller, body.defaults),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const read =
      body.source === 'paste' && typeof body.paste === 'string'
        ? fromPaste(body.paste)
        : fromRows(Array.isArray(rows) ? rows.filter(isRecord) : []);
    const mapping = mappingErrors(body.column_mapping);
    if (mapping.length > 0) return invalid(request, mapping);
    const entry = created(
      caller,
      body.source === 'paste' ? 'paste' : 'api',
      null,
      read,
      isRecord(body.column_mapping) ? body.column_mapping : null,
      defaultsOf(body.defaults, NO_DEFAULTS),
    );
    return accepted(caller, entry);
  }),

  mock(
    'post',
    `${P}/keyword-imports/upload`,
    async ({ request, cookies, params }) => {
      const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
        permission: 'imports:write',
      });
      if (caller instanceof Response) return caller;
      if (!(request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
        return problem(request, 'unsupported_media_type', { detail: 'Upload the file as multipart/form-data.' });
      }
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return invalid(request, [bodyError('file', 'missing', 'Field required')]);
      if (file.size > MAX_UPLOAD_BYTES) {
        return problem(request, 'payload_too_large', {
          detail: 'A file of at most 50 MB.',
          limit_bytes: MAX_UPLOAD_BYTES,
        });
      }
      if (file.type !== 'text/csv' && !file.name.toLowerCase().endsWith('.csv')) {
        return problem(request, 'unsupported_media_type', { detail: 'Upload a CSV file.' });
      }
      const optionsText = form.get('options');
      let options: unknown = {};
      if (typeof optionsText === 'string' && optionsText !== '') {
        try {
          options = JSON.parse(optionsText);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return invalid(request, [bodyError('options', 'json_invalid', 'Options are a JSON object.')]);
        }
      }
      if (!isRecord(options)) return invalid(request, [notAnObject('options')]);
      const read = fromCsv(await file.text());
      const errors = [
        ...extraMembers(options, ['column_mapping', 'defaults'], 'options'),
        ...mappingErrors(options.column_mapping),
        ...defaultsErrors(caller, options.defaults),
      ];
      if (errors.length > 0) return invalid(request, errors);
      const entry = created(
        caller,
        'upload',
        file.name,
        read,
        isRecord(options.column_mapping) ? options.column_mapping : null,
        defaultsOf(options.defaults, NO_DEFAULTS),
      );
      return accepted(caller, entry);
      // The one route above the 1 MB body limit (D11): the file is checked against 50 MB above, the form may
      // carry the options and its boundaries on top
    },
    { maxBodyBytes: MAX_UPLOAD_BYTES + MAX_OPTIONS_BYTES },
  ),

  mock('get', `${P}/keyword-imports/{import_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const entry = importOf(caller, params.import_id);
    if (entry === undefined) return problem(request, 'not_found');
    return answerImport(caller, entry);
  }),

  mock('patch', `${P}/keyword-imports/{import_id}`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'imports:write',
    });
    if (caller instanceof Response) return caller;
    const entry = importOf(caller, params.import_id);
    if (entry === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const actions = body.row_actions;
    const errors: ValidationItem[] = [
      ...extraMembers(body, ['column_mapping', 'defaults', 'row_actions']),
      ...(entry.source === 'paste'
        ? body.column_mapping === undefined
          ? []
          : [NO_COLUMNS_ERROR]
        : mappingErrors(body.column_mapping)),
      ...(actions !== undefined && (body.column_mapping !== undefined || body.defaults !== undefined)
        ? [bodyError('row_actions', 'not_with_mapping', 'Row actions apply to a preview; send them on their own.')]
        : []),
      ...defaultsErrors(caller, body.defaults),
      ...(actions === undefined || actions === null
        ? []
        : !Array.isArray(actions)
          ? [bodyError('row_actions', 'list_type', 'Input should be a valid list')]
          : actions.flatMap((item, index) => {
              const path = at('row_actions', index);
              if (!isRecord(item)) return [notAnObject(path)];
              return [
                ...extraMembers(item, ['row_no', 'part', 'action'], path),
                ...(item.row_no === undefined ? [bodyError(at(path, 'row_no'), 'missing', 'Field required')] : []),
                ...integerError(item.row_no, at(path, 'row_no'), { min: 1 }),
                ...integerError(item.part, at(path, 'part'), { min: 1, max: 2 }),
                ...(item.action === undefined
                  ? [bodyError(at(path, 'action'), 'missing', 'Field required')]
                  : enumError(item.action, at(path, 'action'), ['create', 'skip', 'merge', 'force_separate'])),
              ];
            })),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const status = statusOf(entry, Date.now());
    const reparse = body.column_mapping !== undefined || body.defaults !== undefined;
    if ((reparse && !['needs_mapping', 'preview_ready'].includes(status)) || (!reparse && status !== 'preview_ready')) {
      return problem(request, 'invalid_state_transition', { detail: `The import is ${status}.` });
    }
    // Row actions apply to the preview as it is now
    const changes: { key: string; action: RowAction }[] = [];
    const service: ValidationItem[] = [];
    (Array.isArray(actions) ? actions : []).forEach((item, index) => {
      if (
        !isRecord(item) ||
        typeof item.row_no !== 'number' ||
        !isOneOf(item.action, ['create', 'skip', 'merge', 'force_separate'])
      ) {
        return;
      }
      const path = at('row_actions', index);
      const part = typeof item.part === 'number' ? item.part : 1;
      const row = entry.rows.find((candidate) => candidate.row_no === item.row_no && candidate.part === part);
      if (item.action === 'force_separate') {
        service.push(
          bodyError(
            at(path, 'action'),
            'force_separate_not_available',
            'Case-sensitive keywords arrive in a later phase.',
          ),
        );
      } else if (row === undefined) {
        service.push(bodyError(at(path, 'row_no'), 'row_unknown', 'The import has no such row.'));
      } else if (!row.allowed_actions.includes(item.action)) {
        service.push(
          bodyError(at(path, 'action'), 'action_not_allowed', `This row takes ${row.allowed_actions.join(' or ')}.`),
        );
      } else {
        changes.push({ key: rowKey(row), action: item.action });
      }
    });
    if (service.length > 0) return invalid(request, service);
    if (reparse) {
      if (isRecord(body.column_mapping)) {
        entry.sent_mapping = sentKeys(body.column_mapping);
        entry.mapping = resolveMapping(entry.headers, body.column_mapping);
      }
      entry.defaults = body.defaults === undefined ? entry.defaults : defaultsOf(body.defaults, NO_DEFAULTS);
      entry.rows = analyzeRows(caller, entry.records, entry.mapping, entry.defaults);
      entry.actions = new Map();
      entry.parsed_at = Date.now() + PARSE_MS;
    }
    for (const change of changes) entry.actions.set(change.key, change.action);
    return answerImport(caller, entry, 202);
  }),

  mock('post', `${P}/keyword-imports/{import_id}/confirm`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'imports:write',
    });
    if (caller instanceof Response) return caller;
    const entry = importOf(caller, params.import_id);
    if (entry === undefined) return problem(request, 'not_found');
    const text = await request.text();
    const body: unknown = text === '' ? {} : JSON.parse(text);
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...extraMembers(body, ['duplicate_action']),
      ...(body.duplicate_action === undefined
        ? []
        : enumError(body.duplicate_action, 'duplicate_action', ['skip', 'merge_terms'])),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const status = statusOf(entry, Date.now());
    if (status !== 'preview_ready') {
      return problem(request, 'invalid_state_transition', { detail: `The import is ${status}.` });
    }
    // The preview was made against the keywords as they were; judge the rows again before writing
    entry.rows = analyzeRows(caller, entry.records, entry.mapping, entry.defaults);
    // An action the row's outcome no longer takes goes back to the outcome's default
    for (const row of entry.rows) {
      const chosen = entry.actions.get(rowKey(row));
      if (chosen !== undefined && !row.allowed_actions.includes(chosen)) entry.actions.delete(rowKey(row));
    }
    const duplicateAction = body.duplicate_action === 'merge_terms' ? 'merge_terms' : 'skip';
    const requested = entry.rows.filter((row) => {
      const action = actionOf(entry, row);
      return (action === 'create' && row.repeats === null) || (row.outcome === 'conflict' && action === 'merge');
    }).length;
    // Nothing is written when the import would pass the quota (D4)
    const over = quotaProblem(request, caller, requested);
    if (over) return over;
    // The batches the write gets through before it stops (every one unless a test made it fail)
    const reach =
      writeTrouble.stopAfterBatches === null
        ? entry.rows.length
        : Math.min(entry.rows.length, writeTrouble.stopAfterBatches * writeTrouble.batchSize);
    const result = writeRows(
      caller,
      entry,
      duplicateAction,
      scheduleCheckFor(cookies),
      reach,
      new Set(writeTrouble.failedRows),
    );
    // Nothing is saved yet: an import that would make terms needs the right to make them
    if (result.termsCreated > 0 && !can(caller.access, 'taxonomy:write')) {
      return problem(request, 'forbidden', { detail: 'Making the terms of this import needs taxonomy:write.' });
    }
    const keywordCookie = savedKeywords(request, result.keywords);
    if (typeof keywordCookie !== 'string') return keywordCookie;
    const entityCookie = savedEntities(request, result.entities);
    if (typeof entityCookie !== 'string') return entityCookie;
    const start = Date.now();
    entry.written = {
      ...result.written,
      at: start,
      until: start + WRITE_MS_MIN + Math.ceil(entry.rows.length / 1000) * WRITE_MS_PER_1000,
    };
    // The worker asks for the first metrics of the keywords the import made, in a run of the system's
    const metricsCookie = systemMetricsRun(request, cookies, caller.project.project_id, result.written.created);
    if (typeof metricsCookie !== 'string' && metricsCookie !== null) return metricsCookie;
    const headers = setCookies(keywordCookie, entityCookie, metricsCookie);
    const next = { ...caller, keywordChanges: result.keywords, keywords: keywordWorld(result.keywords) };
    return answerImport(next, entry, 202, headers);
  }),

  mock('post', `${P}/keyword-imports/{import_id}/cancel`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'imports:write',
    });
    if (caller instanceof Response) return caller;
    const entry = importOf(caller, params.import_id);
    if (entry === undefined) return problem(request, 'not_found');
    const status = statusOf(entry, Date.now());
    if (!CANCELLABLE.includes(status)) {
      return problem(request, 'invalid_state_transition', {
        detail: `The import is ${status}; it can no longer be cancelled.`,
      });
    }
    entry.cancelled_at = Date.now();
    return answerImport(caller, entry);
  }),

  mock('get', `${P}/keyword-imports/{import_id}/rows`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[outcome_in]', 'filter[action]', 'cursor', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const entry = importOf(caller, params.import_id);
    if (entry === undefined) return problem(request, 'not_found');
    const outcomes = caller.url.searchParams
      .getAll('filter[outcome_in]')
      .flatMap((value) => value.split(','))
      .filter((value) => value !== '');
    const action = caller.url.searchParams.get('filter[action]');
    const paging = pageRequest(caller.url);
    const outcomeValues = Object.keys(ACTIONS_OF);
    const errors: ValidationItem[] = [
      ...(outcomes.every((value) => outcomeValues.includes(value))
        ? []
        : [queryError('filter[outcome_in]', 'enum', `Allowed: ${outcomeValues.join(', ')}.`)]),
      ...(action === null || isOneOf(action, ['create', 'skip', 'merge', 'force_separate'])
        ? []
        : [queryError('filter[action]', 'enum', 'Allowed: create, skip, merge, force_separate.')]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const status = statusOf(entry, Date.now());
    if (!hasRows(entry, status)) {
      return problem(request, 'invalid_state_transition', {
        detail: `The import is ${status}; it has no preview yet.`,
      });
    }
    const rows = entry.rows
      .filter(
        (row) =>
          (outcomes.length === 0 || outcomes.includes(row.outcome)) &&
          (action === null || actionOf(entry, row) === action),
      )
      .map((row) => ({
        row_no: row.row_no,
        part: row.part,
        raw: row.raw,
        keyword: row.keyword,
        normalized_text: row.normalized_text,
        location_id: row.location_id,
        language_code: row.language_code,
        device: row.device,
        outcome: row.outcome,
        reason_code: row.reason_code,
        reason: row.reason,
        existing_tracked_keyword_id: row.existing_tracked_keyword_id,
        action: actionOf(entry, row),
      }));
    const page = cursorPage(rows, paging, JSON.stringify({ outcomes, action }));
    if (page === null) return problem(request, 'invalid_cursor');
    return HttpResponse.json({ data: page.data, page: page.page });
  }),

  mock('get', `${P}/keyword-imports/{import_id}/report`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const entry = importOf(caller, params.import_id);
    if (entry === undefined) return problem(request, 'not_found');
    const status = statusOf(entry, Date.now());
    // There is a report once the import has rows: from a ready preview on, and after a write that failed
    if (!hasRows(entry, status)) {
      return problem(request, 'invalid_state_transition', {
        detail: `The import is ${status}; there is nothing to report on yet.`,
      });
    }
    const ids = entry.written?.trackedIds ?? new Map<string, string>();
    const results = entry.written?.results ?? new Map<string, RowResult>();
    // A cell a spreadsheet could run as a formula starts with `'`
    const neutral = (cell: string): string => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell);
    const csv = toCsv([
      [
        'row_no',
        'part',
        'keyword',
        'location_id',
        'language_code',
        'device',
        'outcome',
        'reason_code',
        'reason',
        'action',
        'result',
        'tracked_keyword_id',
        'write_error_code',
      ],
      ...entry.rows.map((row) =>
        [
          String(row.row_no),
          String(row.part),
          row.keyword ?? '',
          row.location_id === null ? '' : String(row.location_id),
          row.language_code ?? '',
          row.device ?? '',
          row.outcome,
          row.reason_code ?? '',
          row.reason ?? '',
          actionOf(entry, row),
          results.get(rowKey(row))?.result ?? '',
          ids.get(rowKey(row)) ?? '',
          results.get(rowKey(row))?.error ?? '',
        ].map(neutral),
      ),
    ]);
    return new HttpResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="keyword-import-${entry.import_id}.csv"`,
      },
    });
  }),
];

/** Forgets every import and puts the write trouble back: every test's reset does it (`resetMockState`). */
export const forgetImports = (): void => {
  IMPORTS.clear();
  Object.assign(writeTrouble, NO_TROUBLE);
};
onMockReset(forgetImports);
