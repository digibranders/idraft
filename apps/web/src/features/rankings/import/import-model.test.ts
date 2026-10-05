import { describe, expect, it } from 'vitest';

import {
  autoMapping,
  confirmPlan,
  IMPORT_FIELDS,
  importPhase,
  isReasonCode,
  mappingProblems,
  outcomeSummary,
  stepsOf,
  type Counts,
} from './import-model';
import { importFieldValues } from '@/lib/api/schema';

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

  it('knows the reason codes it has words for', () => {
    expect(isReasonCode('repeated_row')).toBe(true);
    expect(isReasonCode('something_new')).toBe(false);
    expect(isReasonCode(null)).toBe(false);
  });
});
