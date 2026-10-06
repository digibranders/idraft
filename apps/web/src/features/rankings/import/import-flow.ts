import {
  IMPORT_FIELDS,
  autoMapping,
  type Counts,
  type ImportField,
  type KeywordImport,
  type MappingRowProblem,
} from './import-model';
import {
  NO_UPLOAD_ERRORS,
  type Submitted,
  type UploadErrors,
  type UploadValues,
  type VocabularyProblem,
  type VocabularyProblems,
} from './import-state';
import type { ImportDefaults, ValidationItem } from '@/lib/api/types';
import { headerKey } from '@/lib/csv/csv-head';

/** The counts of an import that has none yet. */
export const NO_COUNTS: Counts = {
  rows_total: 0,
  new: 0,
  duplicate: 0,
  variant: 0,
  conflict: 0,
  invalid: 0,
  created: 0,
  skipped: 0,
  merged: 0,
};

/** How far the API has read a file, or `null` while it has not said how many rows there are. */
export function readingProgress(
  progress: { done: number; total: number | null } | undefined,
): { done: number; total: number; percent: number } | null {
  if (progress === undefined || progress.total === null || progress.total <= 0) return null;
  const done = Math.min(progress.done, progress.total);
  return { done, total: progress.total, percent: Math.round((done / progress.total) * 100) };
}

/** The defaults the API applies to rows that leave something out, from what the dialog holds. */
export function importDefaults(values: UploadValues): ImportDefaults {
  return {
    ...(values.location === null ? {} : { location_id: values.location.location_id }),
    ...(values.languageCode === null ? {} : { language_code: values.languageCode }),
    ...(values.device === null ? {} : { device: values.device }),
    ...(values.tagsVocabulary === null ? {} : { tags_vocabulary_id: values.tagsVocabulary }),
    ...(values.topicVocabulary === null ? {} : { topic_vocabulary_id: values.topicVocabulary }),
  };
}

/** The most characters the API takes in a paste (`PASTE_MAX`, 19 section 3.6.3). */
export const PASTE_MAX_CHARACTERS = 1_000_000;
/** The most bytes the API takes in a JSON request body (`JSON_BODY_MAX_BYTES`, 1 MiB): the paste goes in one. */
export const JSON_BODY_MAX_BYTES = 1024 * 1024;

/**
 * Whether the paste is more than the API takes: over a million characters, or a request body over 1 MiB, which
 * a paste under a million characters can still be (a line break is two bytes in JSON, an accent two in UTF-8).
 */
export function pasteTooLarge(values: UploadValues): boolean {
  if ([...values.paste].length > PASTE_MAX_CHARACTERS) return true;
  const body = JSON.stringify({ source: 'paste', paste: values.paste, defaults: importDefaults(values) });
  return new TextEncoder().encode(body).length > JSON_BODY_MAX_BYTES;
}

/** What stops the Upload step from sending anything, or `null` when it can go on. */
export function uploadErrorsOf(values: UploadValues): UploadErrors | null {
  if (values.source === 'upload') {
    return values.file === null || values.head === null ? { ...NO_UPLOAD_ERRORS, file: 'required' } : null;
  }
  if (values.paste.trim() === '') return { ...NO_UPLOAD_ERRORS, paste: 'required' };
  if (pasteTooLarge(values)) return { ...NO_UPLOAD_ERRORS, paste: 'too_long' };
  if (values.paste.includes('\t') && values.tagsVocabulary === null) {
    return { ...NO_UPLOAD_ERRORS, tagsVocabulary: true };
  }
  return null;
}

/**
 * What the Upload step sends, for telling a Continue that changes nothing (the import it made is still the
 * one) from one that needs a new import. The vocabularies of a file are the Map step's, so they are not part
 * of it; a paste has its tags vocabulary here.
 */
export function submissionOf(values: UploadValues): Submitted {
  const paste = values.source === 'paste';
  return {
    source: values.source,
    file: paste ? null : values.file,
    paste: paste ? values.paste : '',
    options: JSON.stringify([
      values.location?.location_id ?? null,
      values.languageCode,
      values.device,
      paste ? values.tagsVocabulary : null,
    ]),
  };
}

/** The same file or paste as the import was made from, whatever the options: only its defaults may differ. */
export const sameSource = (first: Submitted | null, second: Submitted): boolean =>
  first !== null && first.source === second.source && first.file === second.file && first.paste === second.paste;

export const sameSubmission = (first: Submitted | null, second: Submitted): boolean =>
  first !== null && sameSource(first, second) && first.options === second.options;

/**
 * The mapping the Map step starts from: the API's own, or the one the file's headers name. The API's keys are
 * put onto the headers the browser read, matched trimmed and without case as the API matches them, so the
 * mapping holds one entry per column of the file and never a key the Map step does not show.
 */
export function startingMapping(
  imported: Pick<KeywordImport, 'column_mapping'>,
  headers: readonly string[],
): Record<string, ImportField> {
  const headerOf = new Map(headers.map((header) => [headerKey(header), header]));
  const known: Record<string, ImportField> = {};
  for (const [key, name] of Object.entries(imported.column_mapping)) {
    const field = IMPORT_FIELDS.find((candidate) => candidate === name);
    const header = headerOf.get(headerKey(key));
    if (field !== undefined && header !== undefined) known[header] = field;
  }
  return Object.keys(known).length > 0 ? known : autoMapping(headers);
}

/** The id of a vocabulary among an import's defaults. */
export function vocabularyOf(
  imported: Pick<KeywordImport, 'defaults'>,
  name: 'tags_vocabulary_id' | 'topic_vocabulary_id',
): string | null {
  const id = imported.defaults[name];
  return typeof id === 'string' ? id : null;
}

/** Whether the import has this mapping and these vocabularies already, so reading it again would change nothing. */
export function isMappingCurrent(
  imported: Pick<KeywordImport, 'column_mapping' | 'defaults'>,
  mapping: Readonly<Record<string, ImportField>>,
  vocabularies: { tagsVocabulary: string | null; topicVocabulary: string | null },
): boolean {
  // The API's keys are the file's own header text; the mapping's are the trimmed ones the browser sends
  const sent = new Map(Object.entries(imported.column_mapping).map(([key, field]) => [headerKey(key), field]));
  const entries = Object.entries(mapping);
  return (
    entries.length === sent.size &&
    entries.every(([header, field]) => sent.get(headerKey(header)) === field) &&
    vocabularyOf(imported, 'tags_vocabulary_id') === vocabularies.tagsVocabulary &&
    vocabularyOf(imported, 'topic_vocabulary_id') === vocabularies.topicVocabulary
  );
}

/**
 * Every column that maps to a field the API refused to see mapped twice (`field_mapped_twice` names one of
 * them), so each of those rows shows the error.
 */
export function mappedTwiceRows(
  errors: readonly ValidationItem[],
  mapping: Readonly<Record<string, ImportField>>,
): Record<string, MappingRowProblem> {
  const rows: Record<string, MappingRowProblem> = {};
  for (const item of errors) {
    if (item.code !== 'field_mapped_twice') continue;
    const named = headerKey(item.path.replace(/^column_mapping\./, ''));
    const field = Object.entries(mapping).find(([header]) => headerKey(header) === named)?.[1];
    if (field === undefined) continue;
    for (const [header, other] of Object.entries(mapping)) {
      if (other === field) rows[header] = 'mapped_twice';
    }
  }
  return rows;
}

/**
 * Every column whose header reads as another's once trimmed and without case, when the API refused the mapping
 * with `header_repeated`. The file's headers are checked for this before they are shown, so a column is
 * marked only if a mapping held two of them; an empty answer means the refusal names none.
 */
export function repeatedHeaderRows(
  errors: readonly ValidationItem[],
  mapping: Readonly<Record<string, ImportField>>,
): Record<string, MappingRowProblem> {
  if (!errors.some((item) => item.code === 'header_repeated')) return {};
  const headers = Object.keys(mapping);
  const rows: Record<string, MappingRowProblem> = {};
  for (const header of headers) {
    if (headers.filter((other) => headerKey(other) === headerKey(header)).length > 1) rows[header] = 'header_repeated';
  }
  return rows;
}

/**
 * The vocabulary a refusal of the defaults is about: `vocabulary_not_allowed` for a workspace-wide one that a
 * member limited to some projects may not name, any other `vocabulary_*` code for one the project cannot see.
 */
export function vocabularyProblemsOf(errors: readonly ValidationItem[]): VocabularyProblems {
  const problems: Record<'tags' | 'topic', VocabularyProblem | null> = { tags: null, topic: null };
  for (const item of errors) {
    if (!item.code.startsWith('vocabulary_')) continue;
    const problem: VocabularyProblem = item.code === 'vocabulary_not_allowed' ? 'not_allowed' : 'unknown';
    if (item.path === 'defaults.tags_vocabulary_id') problems.tags = problem;
    else if (item.path === 'defaults.topic_vocabulary_id') problems.topic = problem;
  }
  return problems;
}
