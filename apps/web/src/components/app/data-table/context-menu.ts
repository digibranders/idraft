/** A touch long press opens the row menu: Base UI's own delay, and how far a finger may drift before it is a scroll. */
export const LONG_PRESS = { delayMs: 500, slopPx: 10 } as const;

export interface ContextEventFacts {
  shiftKey: boolean;
  target: EventTarget | null;
  /** The browser raised the event for Shift+F10 or the Menu key, which the table's key handler already answers. */
  fromKeyboard: boolean;
}

/** Elements that have a browser menu of their own worth keeping: copy a link, paste into a field. */
const BROWSER_MENU = 'a[href], input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Whether the table, not the browser, handles this contextmenu event (16-drawers-dialogs-popovers.md section
 * 5.4). Shift plus right click is how a person asks for the browser's menu, and a link or a field keeps its own.
 * Ctrl plus click on a Mac raises `contextmenu` and counts as a right click.
 */
export function ownsContextMenu(facts: ContextEventFacts, hasActions: boolean): boolean {
  if (!hasActions || facts.shiftKey || facts.fromKeyboard) return false;
  return !(facts.target instanceof Element && facts.target.closest(BROWSER_MENU) !== null);
}
