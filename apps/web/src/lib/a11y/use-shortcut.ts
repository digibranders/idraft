'use client';

import { createContext, use, useEffect, useRef } from 'react';

/**
 * Whether the person keeps single-key shortcuts on (Settings > Preferences). The workspace provides it from
 * their preferences; elsewhere they are on. `ApplyPreferences` sets `SingleKeyShortcutsContext` of
 * components/ui/kbd.tsx from the same preference, so the key hints hide when the keys do nothing.
 */
export const SingleKeysContext = createContext(true);

export interface ShortcutOptions {
  /**
   * `single-key`: a key without a modifier, such as `[` or `?` (WCAG 2.1.4), never while typing.
   * `dismiss`: Escape closing something that is not a dialog (the rail's overlay), from anywhere.
   */
  kind: 'single-key' | 'dismiss';
  /** Off when there is nothing to dismiss. On by default; a single-key shortcut also follows `SingleKeysContext`. */
  enabled?: boolean | undefined;
}

/** A field, a combobox, or editable content: there a key is typed, not a command. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [role="combobox"], [role="textbox"], [contenteditable="true"]') !== null
  );
}

/** Popups that own the keyboard while open. Base UI marks them with `data-open`, not with `aria-modal`. */
const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** A dialog, menu or list is open, or the key came from inside one: it is theirs. */
const popupHasKeys = (target: EventTarget | null): boolean =>
  (target instanceof Element && target.closest(POPUPS) !== null) ||
  document.querySelector(`:is(${POPUPS})[data-open], [aria-modal="true"]`) !== null;

/**
 * One keyboard shortcut of 25-component-inventory.md section 19.5, the only place the app listens to keys
 * on the document. A single-key shortcut fires outside text fields and comboboxes, with no modifier but
 * Shift, with no dialog, menu or list open, never while an input method is composing, and never when the
 * person turned single-key shortcuts off (20-accessibility.md section 14). A dismiss key fires from
 * anywhere but an open popup, which closes itself.
 */
export function useShortcut(key: string, handler: (event: KeyboardEvent) => void, options: ShortcutOptions): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  const singleKeys = use(SingleKeysContext);
  const { kind } = options;
  const enabled = (options.enabled ?? true) && (kind !== 'single-key' || singleKeys);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== key || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (popupHasKeys(event.target)) return;
      if (kind === 'single-key' && typingIn(event.target)) return;
      event.preventDefault();
      latest.current(event);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, enabled, kind]);
}
