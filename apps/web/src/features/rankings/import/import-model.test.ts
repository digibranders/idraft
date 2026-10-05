import { describe, expect, it } from 'vitest';

import {
  autoMapping,
  confirmPlan,
  FAILURE_CODES,
  FAILURE_KEYS,
  FIELD_KEYS,
  IMPORT_FIELDS,
  importPhase,
  isFailureCode,
  isReasonCode,
  mappingProblems,
  outcomeSummary,
  REASON_CODES,
  REASON_KEYS,
  reportLinkOf,
  selectableVocabularies,
  stepsOf,
  type Counts,
} from './import-model';
import { importFieldValues } from '@/lib/api/schema';
import messages from '../../../../messages/en.json';

const counts = (over: Partial<Counts> = {}): Counts => ({
  rows_total: 0,
  new: 0,
  duplicate: 0,
  variant: 0,
  conflict: 0,
  invalid: 0,
  created: 0,
  skipped: 0,
  merged: 0,
  ...over,
});

describe('import model', () => {
  it('has a Map step for files only', () => {
    expect(stepsOf('upload')).toEqual(['upload', 'map', 'review', 'confirm']);
    expect(stepsOf('paste')).toEqual(['upload', 'review', 'confirm']);
  });

  it('names the phase of each status', () => {
    expect(importPhase('uploaded')).toBe('reading');
    expect(importPhase('parsing')).toBe('reading');
    expect(importPhase('needs_mapping')).toBe('needs_mapping');
    expect(importPhase('preview_ready')).toBe('ready');
    expect(importPhase('writing')).toBe('writing');
    expect(importPhase('completed')).toBe('done');
    expect(importPhase('completed_with_errors')).toBe('done');
    expect(importPhase('expired')).toBe('expired');
    expect(importPhase('cancelled')).toBe('gone');
    expect(importPhase('failed')).toBe('failed');
  });

  it('lists every field a column can map to, once', () => {
    expect(new Set(IMPORT_FIELDS)).toEqual(new Set(importFieldValues));
    expect(IMPORT_FIELDS).toHaveLength(importFieldValues.length);
  });

  it('maps headers to fields by name without case, as the API does', () => {
    expect(autoMapping([' Keyword ', 'TAGS', 'Volume'])).toEqual({ ' Keyword ': 'keyword', TAGS: 'tags' });
  });

  it('finds a missing keyword column and fields mapped twice', () => {
    expect(mappingProblems({ A: 'tags' }, { tagsVocabulary: 'v1', topicVocabulary: null })).toEqual({
      form: 'keyword_missing',
      rows: {},
    });
    expect(
      mappingProblems({ A: 'keyword', B: 'tags', C: 'tags' }, { tagsVocabulary: 'v1', topicVocabulary: null }),
    ).toEqual({ form: null, rows: { B: 'mapped_twice', C: 'mapped_twice' } });
    expect(mappingProblems({ A: 'keyword', B: 'topic' }, { tagsVocabulary: null, topicVocabulary: null })).toEqual({
      form: null,
      rows: { B: 'vocabulary_missing' },
    });
  });

  it('adds up the outcomes and what goes over the quota', () => {
    const summary = outcomeSummary(counts({ rows_total: 10, new: 6, duplicate: 2, invalid: 2 }), {
      limit: 100,
      used: 97,
      would_use: 103,
    });
    expect(summary).toEqual({ new: 6, duplicate: 2, variant: 0, conflict: 0, invalid: 2, overQuota: 3 });
    expect(outcomeSummary(counts({ new: 1 }), null).overQuota).toBe(0);
  });

  it('says what Confirm will do with the choices made', () => {
    expect(
      confirmPlan(counts({ new: 5, variant: 1, duplicate: 2, conflict: 3, invalid: 1 }), {
        duplicates: 'merge',
        conflicts: 'unarchive',
      }),
    ).toEqual({ create: 6, merge: 2, unarchive: 3, skip: 1, duplicateAction: 'merge_terms', conflictAction: 'merge' });
    expect(
      confirmPlan(counts({ new: 1, duplicate: 1, conflict: 1 }), { duplicates: 'skip', conflicts: 'skip' }),
    ).toEqual({ create: 1, merge: 0, unarchive: 0, skip: 2, duplicateAction: 'skip', conflictAction: 'skip' });
  });

  it('names a message for every field and every reason code, in camelCase as the catalog keys are', () => {
    const { fields, reasons } = messages.rankings.import;
    expect(Object.keys(FIELD_KEYS).sort()).toEqual([...importFieldValues].sort());
    expect(Object.values(FIELD_KEYS).sort()).toEqual(Object.keys(fields).sort());
    expect(Object.keys(REASON_KEYS).sort()).toEqual([...REASON_CODES].sort());
    expect(Object.values(REASON_KEYS).sort()).toEqual(Object.keys(reasons).sort());
  });

  it('knows the reason codes it has words for', () => {
    expect(isReasonCode('repeated_row')).toBe(true);
    expect(isReasonCode('something_new')).toBe(false);
    expect(isReasonCode(null)).toBe(false);
  });

  it('names a message for every failure code of an import, in camelCase', () => {
    const { failures } = messages.rankings.import;
    expect(Object.keys(FAILURE_KEYS).sort()).toEqual([...FAILURE_CODES].sort());
    expect(Object.values(FAILURE_KEYS).sort()).toEqual(Object.keys(failures).sort());
    expect(FAILURE_CODES).toEqual(
      expect.arrayContaining([
        'not_utf8',
        'not_csv',
        'no_header',
        'no_rows',
        'duplicate_headers',
        'too_many_rows',
        'too_many_columns',
        'parse_failed',
        'write_failed',
        'source_corrupt',
        'source_unreadable',
        'project_gone',
        'expired',
      ]),
    );
  });

  it('knows the failure codes it has words for', () => {
    expect(isFailureCode('too_many_rows')).toBe(true);
    expect(isFailureCode('provider_down')).toBe(false);
    expect(isFailureCode(null)).toBe(false);
    expect(isFailureCode(undefined)).toBe(false);
  });

  it('offers a member limited to some projects only the vocabularies of a project', () => {
    const shared = { vocabulary_id: 'a', project_id: null };
    const own = { vocabulary_id: 'b', project_id: 'p1' };
    expect(selectableVocabularies([shared, own], false)).toEqual([shared, own]);
    expect(selectableVocabularies([shared, own], true)).toEqual([own]);
  });

  it('takes the report from the link of a finished import, and only from a path of this app', () => {
    const origin = 'https://app.example';
    const fallback = '/api/v1/known/report';
    expect(reportLinkOf({ self: '/api/v1/i', result: '/api/v1/i/report?x=1' }, fallback, origin)).toBe(
      '/api/v1/i/report?x=1',
    );
    expect(reportLinkOf({ self: '/api/v1/i', result: `${origin}/api/v1/i/report` }, fallback, origin)).toBe(
      '/api/v1/i/report',
    );
    // A link that leaves the app, or the API, is not followed: the known path is used instead
    expect(reportLinkOf({ self: '/api/v1/i', result: 'https://evil.example/api/v1/i/report' }, fallback, origin)).toBe(
      fallback,
    );
    expect(reportLinkOf({ self: '/api/v1/i', result: '//evil.example/api/v1/x' }, fallback, origin)).toBe(fallback);
    expect(reportLinkOf({ self: '/api/v1/i', result: '/logout' }, fallback, origin)).toBe(fallback);
    expect(reportLinkOf({ self: '/api/v1/i', result: '/api/v1/../logout' }, fallback, origin)).toBe(fallback);
    // No link, no report to offer
    expect(reportLinkOf({ self: '/api/v1/i' }, fallback, origin)).toBeNull();
    expect(reportLinkOf({ self: '/api/v1/i', result: null }, fallback, origin)).toBeNull();
    expect(reportLinkOf({ self: '/api/v1/i', result: '' }, fallback, origin)).toBeNull();
  });
});
