import { describe, expect, it } from 'vitest';

import {
  importDefaults,
  isMappingCurrent,
  mappedTwiceRows,
  readingProgress,
  repeatedHeaderRows,
  sameSource,
  sameSubmission,
  startingMapping,
  submissionOf,
  uploadErrorsOf,
  vocabularyProblemsOf,
} from './import-flow';
import type { KeywordImport } from './import-model';
import { initialValues, type CsvHeadOk, type UploadValues } from './import-state';
import type { ValidationItem } from '@/lib/api/types';

const HEAD: CsvHeadOk = { kind: 'ok', headers: ['Keyword', 'Tags'], samples: [] };
const LOCATION = { location_id: 2276, name: 'Germany', location_type: 'Country', country_iso: 'de' };
const file = (name = 'keywords.csv'): File => new File(['keyword'], name, { type: 'text/csv' });
const values = (patch: Partial<UploadValues> = {}): UploadValues => ({
  ...initialValues(LOCATION, 'en'),
  ...patch,
});

/** The parts of an import these helpers read. */
function importOf(
  columnMapping: Record<string, string>,
  defaults: Record<string, unknown> = {},
): Pick<KeywordImport, 'column_mapping' | 'defaults'> {
  return { column_mapping: columnMapping, defaults };
}

describe('import flow', () => {
  it('sends only the defaults that are set', () => {
    expect(importDefaults(values())).toEqual({ location_id: 2276, language_code: 'en' });
    expect(
      importDefaults(values({ location: null, languageCode: null, device: 'both', tagsVocabulary: 'v1' })),
    ).toEqual({
      device: 'both',
      tags_vocabulary_id: 'v1',
    });
  });

  it('finds what stops an upload or a paste', () => {
    expect(uploadErrorsOf(values())).toMatchObject({ file: 'required' });
    expect(uploadErrorsOf(values({ file: file(), head: HEAD }))).toBeNull();
    expect(uploadErrorsOf(values({ source: 'paste', paste: '  \n' }))).toMatchObject({ paste: 'required' });
    expect(uploadErrorsOf(values({ source: 'paste', paste: 'seo\tblog' }))).toMatchObject({ tagsVocabulary: true });
    expect(uploadErrorsOf(values({ source: 'paste', paste: 'seo\tblog', tagsVocabulary: 'v1' }))).toBeNull();
    expect(uploadErrorsOf(values({ source: 'paste', paste: 'seo' }))).toBeNull();
  });

  it('tells a changed upload from an unchanged one, and leaves a file import its vocabularies', () => {
    const chosen = file();
    const first = submissionOf(values({ file: chosen, head: HEAD }));
    expect(sameSubmission(first, submissionOf(values({ file: chosen, head: HEAD, tagsVocabulary: 'v1' })))).toBe(true);
    expect(sameSubmission(first, submissionOf(values({ file: file(), head: HEAD })))).toBe(false);
    expect(sameSubmission(first, submissionOf(values({ file: chosen, head: HEAD, device: 'mobile' })))).toBe(false);
    expect(sameSubmission(null, first)).toBe(false);
    const paste = submissionOf(values({ source: 'paste', paste: 'seo', tagsVocabulary: 'v1' }));
    expect(sameSubmission(paste, submissionOf(values({ source: 'paste', paste: 'seo', tagsVocabulary: 'v2' })))).toBe(
      false,
    );
  });

  it('tells a Continue that changes only the options from one with another file', () => {
    const chosen = file();
    const first = submissionOf(values({ file: chosen, head: HEAD }));
    expect(sameSource(first, submissionOf(values({ file: chosen, head: HEAD, device: 'mobile' })))).toBe(true);
    expect(sameSource(first, submissionOf(values({ file: file(), head: HEAD })))).toBe(false);
    expect(sameSource(first, submissionOf(values({ source: 'paste', paste: 'seo' })))).toBe(false);
    expect(sameSource(null, first)).toBe(false);
    const paste = submissionOf(values({ source: 'paste', paste: 'seo' }));
    expect(sameSource(paste, submissionOf(values({ source: 'paste', paste: 'seo', tagsVocabulary: 'v1' })))).toBe(true);
    expect(sameSource(paste, submissionOf(values({ source: 'paste', paste: 'seo again' })))).toBe(false);
  });

  it('starts the mapping from the API, or from the file headers when the API maps none', () => {
    expect(startingMapping(importOf({ Keyword: 'keyword', Other: 'unknown_field' }), HEAD.headers)).toEqual({
      Keyword: 'keyword',
    });
    expect(startingMapping(importOf({}), HEAD.headers)).toEqual({ Keyword: 'keyword', Tags: 'tags' });
  });

  it('puts the API keys onto the headers the browser read, trimmed and without case', () => {
    // The browser trims the headers it shows and sends; the API may echo the file's own text
    expect(startingMapping(importOf({ keyword: 'keyword', ' tags': 'tags' }), ['keyword', 'tags'])).toEqual({
      keyword: 'keyword',
      tags: 'tags',
    });
    expect(startingMapping(importOf({ KEYWORD: 'keyword' }), ['Keyword', 'Tags'])).toEqual({ Keyword: 'keyword' });
    // A key that names no header the browser has is not kept as a hidden entry
    expect(startingMapping(importOf({ keyword: 'keyword', Ghost: 'group' }), ['keyword', 'tags'])).toEqual({
      keyword: 'keyword',
    });
  });

  it('knows when reading the import again would change nothing', () => {
    const current = importOf({ Keyword: 'keyword' }, { tags_vocabulary_id: 'v1' });
    const same = { tagsVocabulary: 'v1', topicVocabulary: null };
    expect(isMappingCurrent(current, { Keyword: 'keyword' }, same)).toBe(true);
    expect(isMappingCurrent(current, { Keyword: 'keyword', Tags: 'tags' }, same)).toBe(false);
    expect(isMappingCurrent(current, { Keyword: 'topic' }, same)).toBe(false);
    expect(isMappingCurrent(current, { Keyword: 'keyword' }, { ...same, tagsVocabulary: 'v2' })).toBe(false);
    expect(isMappingCurrent(current, { Keyword: 'keyword' }, { ...same, topicVocabulary: 'v3' })).toBe(false);
  });

  it('compares the mapping of the API with the browser headers trimmed and without case', () => {
    const same = { tagsVocabulary: null, topicVocabulary: null };
    const echoed = importOf({ keyword: 'keyword', ' Tags ': 'tags' });
    expect(isMappingCurrent(echoed, { keyword: 'keyword', tags: 'tags' }, same)).toBe(true);
    expect(isMappingCurrent(echoed, { Keyword: 'keyword', TAGS: 'tags' }, same)).toBe(true);
    expect(isMappingCurrent(echoed, { keyword: 'keyword', tags: 'topic' }, same)).toBe(false);
    expect(isMappingCurrent(echoed, { keyword: 'keyword' }, same)).toBe(false);
  });

  it('marks the columns that read as one header when the API refuses the mapping for it', () => {
    const refusal: ValidationItem = {
      location: 'body',
      path: 'column_mapping',
      code: 'header_repeated',
      message: 'No',
    };
    expect(repeatedHeaderRows([refusal], { Keyword: 'keyword', ' keyword ': 'tags', Other: 'group' })).toEqual({
      Keyword: 'header_repeated',
      ' keyword ': 'header_repeated',
    });
    expect(repeatedHeaderRows([refusal], { Keyword: 'keyword', Other: 'group' })).toEqual({});
    expect(repeatedHeaderRows([{ ...refusal, code: 'other' }], { A: 'keyword', a: 'tags' })).toEqual({});
  });

  it('finds the vocabulary a refusal of the defaults is about', () => {
    const item = (path: string, code: string): ValidationItem => ({ location: 'body', path, code, message: 'No' });
    expect(
      vocabularyProblemsOf([
        item('defaults.tags_vocabulary_id', 'vocabulary_not_allowed'),
        item('defaults.topic_vocabulary_id', 'vocabulary_unknown'),
        item('defaults.device', 'enum'),
      ]),
    ).toEqual({ tags: 'not_allowed', topic: 'unknown' });
    expect(vocabularyProblemsOf([item('defaults.device', 'enum')])).toEqual({ tags: null, topic: null });
  });

  it('marks every column of a field the API saw mapped twice', () => {
    const error = { location: 'body', path: 'column_mapping.Device', code: 'field_mapped_twice', message: 'Twice' };
    expect(
      mappedTwiceRows([error, { ...error, code: 'column_unknown' }], { Device: 'device', Mobile: 'device', A: 'tags' }),
    ).toEqual({ Device: 'mapped_twice', Mobile: 'mapped_twice' });
    expect(mappedTwiceRows([{ ...error, path: 'column_mapping.Gone' }], { A: 'tags' })).toEqual({});
    // The key the API names may differ from the header in case and spaces
    expect(
      mappedTwiceRows([{ ...error, path: 'column_mapping. device ' }], { Device: 'device', Mobile: 'device' }),
    ).toEqual({ Device: 'mapped_twice', Mobile: 'mapped_twice' });
  });

  it('reads progress only once the API says how many rows there are', () => {
    expect(readingProgress(undefined)).toBeNull();
    expect(readingProgress({ done: 3, total: null })).toBeNull();
    expect(readingProgress({ done: 0, total: 0 })).toBeNull();
    expect(readingProgress({ done: 250, total: 1000 })).toEqual({ done: 250, total: 1000, percent: 25 });
    expect(readingProgress({ done: 1200, total: 1000 })).toEqual({ done: 1000, total: 1000, percent: 100 });
  });
});
