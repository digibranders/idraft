import {
  IMPORT_FIELDS,
  autoMapping,
  type Counts,
  type ImportField,
  type KeywordImport,
  type MappingRowProblem,
} from './import-model';
import { NO_UPLOAD_ERRORS, type Submitted, type UploadErrors, type UploadValues } from './import-state';
import type { ImportDefaults, ValidationItem } from '@/lib/api/types';

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

/** What stops the Upload step from sending anything, or `null` when it can go on. */
export function uploadErrorsOf(values: UploadValues): UploadErrors | null {
  if (values.source === 'upload') {
    return values.file === null || values.head === null ? { ...NO_UPLOAD_ERRORS, file: 'required' } : null;
  }
  if (values.paste.trim() === '') return { ...NO_UPLOAD_ERRORS, paste: 'required' };
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

export const sameSubmission = (first: Submitted | null, second: Submitted): boolean =>
  first !== null &&
  first.source === second.source &&
  first.file === second.file &&
  first.paste === second.paste &&
  first.options === second.options;

/** The mapping the Map step starts from: the API's own, or the one the file's headers name. */
export function startingMapping(
  imported: Pick<KeywordImport, 'column_mapping'>,
  headers: readonly string[],
): Record<string, ImportField> {
  const known = Object.fromEntries(
    Object.entries(imported.column_mapping).flatMap(([header, name]): [string, ImportField][] => {
      const field = IMPORT_FIELDS.find((candidate) => candidate === name);
      return field === undefined ? [] : [[header, field]];
    }),
  );
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
  const sent = imported.column_mapping;
  const entries = Object.entries(mapping);
  return (
    entries.length === Object.keys(sent).length &&
    entries.every(([header, field]) => sent[header] === field) &&
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
    const field = mapping[item.path.replace(/^column_mapping\./, '')];
    if (field === undefined) continue;
    for (const [header, other] of Object.entries(mapping)) {
      if (other === field) rows[header] = 'mapped_twice';
    }
  }
  return rows;
}
