const DRAWER_FRAME = 'aside[aria-labelledby], [data-slot="sheet"][aria-labelledby]';

/**
 * The title of the drawer that is open, or null when none is. The drawer is an `aside` from 900 px and a Base UI
 * sheet below it, and both name themselves with `aria-labelledby`, so callers that move focus to the title do not
 * need to know which one is showing.
 */
export function findDrawerTitle(): HTMLElement | null {
  const frame = document.querySelector(DRAWER_FRAME);
  const titleId = frame?.getAttribute('aria-labelledby');
  return titleId === null || titleId === undefined ? null : document.getElementById(titleId);
}

/** Whether `node` is inside an inspector drawer (card or sheet), as a button of its own body is. */
export function isInsideDrawer(node: Element): boolean {
  return node.closest(DRAWER_FRAME) !== null;
}
