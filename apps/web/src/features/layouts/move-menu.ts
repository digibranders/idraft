/**
 * The Move menu of a card (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 2.7): the same
 * reorder as dragging, for a person who cannot drag (WCAG 2.5.7). Pure: where each command sends a card.
 */
export type MoveCommand = 'earlier' | 'later' | 'start' | 'end';

/** The order of the menu. */
export const MOVE_COMMANDS: readonly MoveCommand[] = ['earlier', 'later', 'start', 'end'];

/**
 * The 0 based place `command` sends the card at `index` of `total` cards to, or null when it is already there
 * (or `index` is not a place in the list): the menu lists that command and disables it.
 */
export function moveTargetIndex(command: MoveCommand, index: number, total: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= total) return null;
  const last = total - 1;
  switch (command) {
    case 'earlier':
      return index > 0 ? index - 1 : null;
    case 'later':
      return index < last ? index + 1 : null;
    case 'start':
      return index > 0 ? 0 : null;
    case 'end':
      return index < last ? last : null;
  }
}
