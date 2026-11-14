'use client';

import { useCallback, type KeyboardEvent } from 'react';

import { useLayoutScreen } from '../layout-provider';

/** A field, a combobox or editable content: there Ctrl Z is the field's own undo, not the layout's. */
const TYPING = 'input, textarea, select, [role="combobox"], [role="textbox"], [contenteditable="true"]';
/** Popups that own the keyboard while they are open (the rule of `useShortcut`). */
const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function ownedByAnother(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest(TYPING) !== null || target.closest(POPUPS) !== null) return true;
  return document.querySelector(`:is(${POPUPS})[data-open], [aria-modal="true"]`) !== null;
}

/**
 * Ctrl or Cmd Z undoes the last edit of the draft, with Shift it redoes (D-06). It goes on the screen's root, so
 * it answers only keys pressed inside the screen. It leaves the key to a text field, a combobox and an open popup,
 * does nothing in view mode or while a save is under way, and takes the key from the browser only when it acted.
 */
export function useUndoKeys(): (event: KeyboardEvent<HTMLElement>) => void {
  const { mode, saving, actions } = useLayoutScreen();
  const customizing = mode === 'customize';
  return useCallback(
    (event) => {
      if (!customizing || saving || event.defaultPrevented || event.altKey) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      if (ownedByAnother(event.target)) return;
      const acted = event.shiftKey ? actions.redo() : actions.undo();
      if (acted) event.preventDefault();
    },
    [customizing, saving, actions],
  );
}
