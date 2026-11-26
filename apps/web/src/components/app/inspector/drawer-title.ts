/**
 * The title of the drawer that is open, or null when none is. The drawer is an `aside` from 900 px and a Base UI
 * sheet below it, and both name themselves with `aria-labelledby`, so callers that move focus to the title do not
 * need to know which one is showing.
 */
export function findDrawerTitle(): HTMLElement | null {
  const frame = document.querySelector('aside[aria-labelledby], [data-slot="sheet"][aria-labelledby]');
  const titleId = frame?.getAttribute('aria-labelledby');
  return titleId === null || titleId === undefined ? null : document.getElementById(titleId);
}
