/**
 * The state machine behind customize mode (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section
 * 2.3). Pure: no React, no clock, no ids. The provider feeds it documents made by the draft.ts functions, so a
 * refused edit arrives as the draft itself and changes nothing here.
 */
import type { LayoutDocument } from '@/lib/layouts';

export type LayoutMode = 'view' | 'customize';

/** Edits that undo can walk back through; past this, the oldest is forgotten. */
export const HISTORY_LIMIT = 50;

export type CardPart = 'handle' | 'width' | 'options' | 'more';

/** What should hold focus after the next render; id null means the Add card slot. */
export interface FocusRequest {
  id: string | null;
  part: CardPart;
}

export interface LayoutState {
  mode: LayoutMode;
  /** What the change count compares with: where customize started (or was rebased). */
  baseline: LayoutDocument | null;
  draft: LayoutDocument | null;
  past: readonly LayoutDocument[];
  future: readonly LayoutDocument[];
  focus: FocusRequest | null;
}

export type LayoutAction =
  | { type: 'enter'; document: LayoutDocument }
  | { type: 'exit' }
  | { type: 'edit'; next: LayoutDocument; focus?: FocusRequest | undefined }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'rebase'; baseline: LayoutDocument }
  | { type: 'reload'; document: LayoutDocument }
  | { type: 'focused' };

export const INITIAL_LAYOUT_STATE: LayoutState = {
  mode: 'view',
  baseline: null,
  draft: null,
  past: [],
  future: [],
  focus: null,
};

/** Back one edit: the last past draft returns and the current one waits in the future. */
function undo(state: LayoutState, draft: LayoutDocument): LayoutState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return { ...state, draft: previous, past: state.past.slice(0, -1), future: [...state.future, draft] };
}

/** Forward again: the reverse of undo. The past stays within the limit by construction (one in, one out). */
function redo(state: LayoutState, draft: LayoutDocument): LayoutState {
  const next = state.future.at(-1);
  if (!next) return state;
  return {
    ...state,
    draft: next,
    past: [...state.past, draft].slice(-HISTORY_LIMIT),
    future: state.future.slice(0, -1),
  };
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'enter':
      if (state.mode === 'customize') return state;
      return {
        ...INITIAL_LAYOUT_STATE,
        mode: 'customize',
        baseline: structuredClone(action.document),
        draft: structuredClone(action.document),
      };
    case 'exit':
      return INITIAL_LAYOUT_STATE;
    case 'focused':
      return state.focus === null ? state : { ...state, focus: null };
    default:
      break;
  }
  // Everything below edits a draft, and there is none outside customize mode
  if (state.mode !== 'customize' || !state.draft) return state;
  switch (action.type) {
    case 'edit':
      if (action.next === state.draft) return state;
      return {
        ...state,
        past: [...state.past, state.draft].slice(-HISTORY_LIMIT),
        future: [],
        draft: action.next,
        focus: action.focus ?? null,
      };
    case 'undo':
      return undo(state, state.draft);
    case 'redo':
      return redo(state, state.draft);
    case 'rebase':
      return { ...state, baseline: action.baseline };
    case 'reload':
      return {
        ...state,
        baseline: structuredClone(action.document),
        draft: structuredClone(action.document),
        past: [],
        future: [],
      };
    default:
      return state;
  }
}
