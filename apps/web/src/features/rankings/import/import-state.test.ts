import { describe, expect, it } from 'vitest';

import {
  importReducer,
  initialState,
  initialValues,
  type ImportAction,
  type ImportState,
  type Submitted,
} from './import-state';

const SUBMITTED: Submitted = { source: 'upload', file: null, paste: '', options: '[]' };

const reduce = (state: ImportState, ...actions: ImportAction[]): ImportState =>
  actions.reduce((current, action) => importReducer(current, action), state);

/** A dialog that went through Upload, Map and Review, and stands on Confirm. */
const confirmed = (): ImportState =>
  reduce(
    initialState(initialValues(null, 'en')),
    { type: 'imported', importId: 'i1', submitted: SUBMITTED },
    { type: 'passed', step: 'upload' },
    { type: 'passed', step: 'map' },
    { type: 'passed', step: 'review' },
    { type: 'step', step: 'confirm' },
  );

describe('import state', () => {
  it('drops Review and Confirm from the completed steps when the API reads the import again', () => {
    const state = confirmed();
    expect([...state.completed]).toEqual(['upload', 'map', 'review']);
    expect([...reduce(state, { type: 'reparsed' }).completed]).toEqual(['upload', 'map']);
  });

  it('does the same, and remembers the new options, when only the defaults changed', () => {
    const next: Submitted = { ...SUBMITTED, options: '[1]' };
    const state = reduce(confirmed(), { type: 'resubmitted', submitted: next });
    expect([...state.completed]).toEqual(['upload', 'map']);
    expect(state.submitted).toBe(next);
    // The import and the mapping held are the same ones
    expect(state.importId).toBe('i1');
  });

  it('keeps the mapping through a new reading', () => {
    const state = reduce(confirmed(), { type: 'mapping-set', mapping: { keyword: 'keyword' } }, { type: 'reparsed' });
    expect(state.mapping).toEqual({ keyword: 'keyword' });
  });

  it('forgets what the API said of a vocabulary once another is chosen', () => {
    const refused = reduce(initialState(initialValues(null, 'en')), {
      type: 'map-problems',
      problems: { checked: true, server: {}, vocabulary: { tags: 'not_allowed', topic: 'unknown' } },
    });
    const chosen = reduce(refused, { type: 'values', patch: { tagsVocabulary: 'v2' } });
    expect(chosen.mapProblems.vocabulary).toEqual({ tags: null, topic: 'unknown' });
    expect(reduce(chosen, { type: 'values', patch: { device: 'mobile' } }).mapProblems.vocabulary.topic).toBe(
      'unknown',
    );
  });

  it('keeps the code of a failure with the end', () => {
    const state = reduce(initialState(initialValues(null, 'en')), { type: 'ended', reason: 'failed', code: 'no_rows' });
    expect(state).toMatchObject({ ended: 'failed', endedCode: 'no_rows' });
    expect(reduce(state, { type: 'reset', values: initialValues(null, 'en') })).toMatchObject({
      ended: null,
      endedCode: null,
    });
  });
});
