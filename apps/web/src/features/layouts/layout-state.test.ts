/** The layout state machine (plan WP-15, section 2.3): one case per row of its table. */
import { describe, expect, it } from 'vitest';

import {
  HISTORY_LIMIT,
  INITIAL_LAYOUT_STATE,
  layoutReducer,
  type FocusRequest,
  type LayoutAction,
  type LayoutState,
} from './layout-state';
import { SCREENS, changeCount, hideCard, moveCard, setCardWidth, type LayoutDocument } from '@/lib/layouts';

const builtin = (): LayoutDocument => structuredClone(SCREENS.overview.builtin);

const run = (state: LayoutState, ...actions: LayoutAction[]): LayoutState => actions.reduce(layoutReducer, state);

const customizing = (document: LayoutDocument = builtin()): LayoutState =>
  layoutReducer(INITIAL_LAYOUT_STATE, { type: 'enter', document });

/** The same document, seen through a state that must be in customize mode. */
function draftOf(state: LayoutState): LayoutDocument {
  if (!state.draft) throw new Error('expected a draft');
  return state.draft;
}

describe('layoutReducer', () => {
  it('starts in view mode with nothing held', () => {
    expect(INITIAL_LAYOUT_STATE).toEqual({
      mode: 'view',
      baseline: null,
      draft: null,
      past: [],
      future: [],
      focus: null,
    });
  });

  describe('enter', () => {
    it('goes from view to customize with the baseline and the draft as copies and no history', () => {
      const document = builtin();
      const state = layoutReducer(INITIAL_LAYOUT_STATE, { type: 'enter', document });
      expect(state.mode).toBe('customize');
      expect(state.baseline).toEqual(document);
      expect(state.draft).toEqual(document);
      expect(state.baseline).not.toBe(document);
      expect(state.draft).not.toBe(document);
      expect(state.baseline).not.toBe(state.draft);
      expect(state.past).toEqual([]);
      expect(state.future).toEqual([]);
    });

    it('does nothing while already customizing', () => {
      const state = customizing();
      expect(layoutReducer(state, { type: 'enter', document: hideCard(builtin(), 'matrix') })).toBe(state);
    });
  });

  describe('exit', () => {
    it('returns the initial state itself from customize, with the draft, baseline and history gone', () => {
      const state = run(
        customizing(),
        { type: 'edit', next: hideCard(builtin(), 'matrix') },
        { type: 'edit', next: hideCard(builtin(), 'trend'), focus: { id: null, part: 'handle' } },
        { type: 'undo' },
      );
      expect(state.past.length + state.future.length).toBeGreaterThan(0);
      expect(layoutReducer(state, { type: 'exit' })).toBe(INITIAL_LAYOUT_STATE);
    });

    it('returns the initial state itself from view', () => {
      expect(layoutReducer(INITIAL_LAYOUT_STATE, { type: 'exit' })).toBe(INITIAL_LAYOUT_STATE);
    });
  });

  describe('edit', () => {
    it('keeps the old draft in the past, clears the future, takes the new draft and sets the focus', () => {
      const first = customizing();
      const before = draftOf(first);
      const next = hideCard(before, 'matrix');
      const focus: FocusRequest = { id: 'unclassified', part: 'handle' };
      const state = layoutReducer(first, { type: 'edit', next, focus });
      expect(state.past).toEqual([before]);
      expect(state.past[0]).toBe(before);
      expect(state.future).toEqual([]);
      expect(state.draft).toBe(next);
      expect(state.focus).toEqual(focus);
      expect(state.baseline).toBe(first.baseline);
    });

    it('sets no focus when the edit names none', () => {
      const state = run(customizing(), { type: 'edit', next: hideCard(builtin(), 'matrix') });
      expect(state.focus).toBeNull();
    });

    it('is unchanged (the same object) when the edit is the draft itself, a refused draft.ts edit', () => {
      const state = customizing();
      const refused = hideCard(draftOf(state), 'no-such-card');
      expect(refused).toBe(draftOf(state));
      expect(layoutReducer(state, { type: 'edit', next: refused, focus: { id: 'trend', part: 'handle' } })).toBe(state);
    });

    it('keeps the 50 latest drafts after 51 edits', () => {
      const documents: LayoutDocument[] = [builtin()];
      let state = customizing(documents[0]);
      for (let edit = 1; edit <= HISTORY_LIMIT + 1; edit += 1) {
        const previous = documents[edit - 1];
        if (!previous) throw new Error('missing document');
        const next = setCardWidth(previous, 'trend', edit % 2 === 1 ? 'full' : 'two_thirds');
        expect(next).not.toBe(previous);
        documents.push(next);
        state = layoutReducer(state, { type: 'edit', next });
      }
      expect(HISTORY_LIMIT).toBe(50);
      expect(state.past).toHaveLength(HISTORY_LIMIT);
      // The oldest (the one the person started from) is the one dropped
      expect(state.past[0]).toBe(documents[1]);
      expect(state.past.at(-1)).toBe(documents[HISTORY_LIMIT]);
      expect(state.draft).toBe(documents[HISTORY_LIMIT + 1]);
    });
  });

  describe('undo and redo', () => {
    it('undo puts the last draft back and gives the current one to the future; redo reverses it', () => {
      const start = customizing();
      const original = draftOf(start);
      const hidden = hideCard(original, 'matrix');
      const edited = run(start, { type: 'edit', next: hidden });

      const undone = layoutReducer(edited, { type: 'undo' });
      expect(undone.draft).toBe(original);
      expect(undone.past).toEqual([]);
      expect(undone.future).toEqual([hidden]);

      const redone = layoutReducer(undone, { type: 'redo' });
      expect(redone.draft).toBe(hidden);
      expect(redone.past).toEqual([original]);
      expect(redone.future).toEqual([]);
    });

    it('does nothing on an empty stack', () => {
      const state = customizing();
      expect(layoutReducer(state, { type: 'undo' })).toBe(state);
      expect(layoutReducer(state, { type: 'redo' })).toBe(state);
    });

    it('a new edit after an undo clears the future', () => {
      const start = customizing();
      const original = draftOf(start);
      const undone = run(start, { type: 'edit', next: hideCard(original, 'matrix') }, { type: 'undo' });
      expect(undone.future).toHaveLength(1);

      const next = moveCard(original, 'trend', 3);
      const state = layoutReducer(undone, { type: 'edit', next });
      expect(state.future).toEqual([]);
      expect(state.past).toEqual([original]);
      expect(state.draft).toBe(next);
    });

    it('walks several steps back and forward in order', () => {
      const start = customizing();
      const a = hideCard(draftOf(start), 'matrix');
      const b = hideCard(a, 'trend');
      const state = run(
        start,
        { type: 'edit', next: a },
        { type: 'edit', next: b },
        { type: 'undo' },
        { type: 'undo' },
      );
      expect(state.draft).toBe(start.draft);
      expect(state.future).toEqual([b, a]);
      expect(run(state, { type: 'redo' }).draft).toBe(a);
      expect(run(state, { type: 'redo' }, { type: 'redo' }).draft).toBe(b);
    });
  });

  describe('rebase', () => {
    it('replaces the baseline and keeps the draft and the history', () => {
      const start = customizing();
      const hidden = hideCard(draftOf(start), 'matrix');
      const edited = run(start, { type: 'edit', next: hidden });
      expect(changeCount(edited.baseline ?? hidden, draftOf(edited))).toBeGreaterThan(0);

      const newBaseline = hideCard(builtin(), 'matrix');
      const state = layoutReducer(edited, { type: 'rebase', baseline: newBaseline });
      expect(state.baseline).toBe(newBaseline);
      expect(state.draft).toBe(hidden);
      expect(state.past).toBe(edited.past);
      expect(state.future).toBe(edited.future);
      // The draft now matches the baseline, so the change count follows the new one
      expect(changeCount(newBaseline, draftOf(state))).toBe(0);
    });
  });

  describe('reload', () => {
    it('makes the baseline and the draft the fresh document and clears the history', () => {
      const edited = run(customizing(), { type: 'edit', next: hideCard(builtin(), 'matrix') });
      const fresh = hideCard(builtin(), 'trend');
      const state = layoutReducer(edited, { type: 'reload', document: fresh });
      expect(state.mode).toBe('customize');
      expect(state.baseline).toEqual(fresh);
      expect(state.draft).toEqual(fresh);
      expect(state.baseline).not.toBe(state.draft);
      expect(state.past).toEqual([]);
      expect(state.future).toEqual([]);
    });
  });

  describe('view mode', () => {
    it.each<[string, LayoutAction]>([
      ['edit', { type: 'edit', next: hideCard(builtin(), 'matrix') }],
      ['undo', { type: 'undo' }],
      ['redo', { type: 'redo' }],
      ['rebase', { type: 'rebase', baseline: builtin() }],
      ['reload', { type: 'reload', document: builtin() }],
    ])('leaves the state alone on %s', (_name, action) => {
      expect(layoutReducer(INITIAL_LAYOUT_STATE, action)).toBe(INITIAL_LAYOUT_STATE);
    });
  });

  describe('focused', () => {
    it('clears the focus request', () => {
      const state = run(customizing(), {
        type: 'edit',
        next: hideCard(builtin(), 'matrix'),
        focus: { id: 'trend', part: 'handle' },
      });
      expect(state.focus).not.toBeNull();
      const cleared = layoutReducer(state, { type: 'focused' });
      expect(cleared.focus).toBeNull();
      expect(cleared.draft).toBe(state.draft);
    });

    it('is the same state when nothing was requested', () => {
      const state = customizing();
      expect(layoutReducer(state, { type: 'focused' })).toBe(state);
    });
  });
});
