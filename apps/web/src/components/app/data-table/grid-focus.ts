import type { RefObject } from 'react';

/** The grid's one tab stop: the cell the arrow keys start from (20-accessibility.md section 4.3). */
export function gridTabStop(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]');
}

/**
 * A ref for a dialog's `finalFocus` that resolves to the grid's tab stop when the dialog closes. For a
 * dialog opened from a row's menu, whose item is gone when it closes and whose row may be too, so focus goes
 * to the table instead of falling to the page (16-drawers-dialogs-popovers.md section 6). A screen whose
 * dialog only sometimes should land there builds its own ref over `gridTabStop`.
 */
export const gridFocus: RefObject<HTMLElement | null> = {
  get current(): HTMLElement | null {
    return gridTabStop();
  },
};
