import { cn } from '@/lib/utils';

/** The surface every anchored popup shares: menus, popovers, select and combobox lists (16 section 5). */
export const POPUP_SURFACE = cn('rounded-lg border border-border bg-surface-elevated shadow-popover outline-none');

/**
 * How an anchored popup appears and leaves (16 section 9): opacity and a 4 px move from the side it opens
 * on, 150 ms in and 100 ms out, no scale. The duration tokens are 0 under reduced motion.
 */
export const POPUP_MOTION = cn(
  'origin-(--transform-origin) transition-[opacity,translate] duration-(--duration-base) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-fast) data-ending-style:ease-exit data-instant:duration-(--duration-instant) data-starting-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 data-[side=top]:data-starting-style:translate-y-1',
);

/**
 * One row of a list in a popup: 32 px, the height menus, selects and comboboxes share. The highlighted row
 * takes the hover step of the elevated surface, which `surface-hover` is not (in the dark theme it is
 * almost the color of the popup itself). A row that has keyboard focus also shows the inset ring.
 */
export const POPUP_ITEM = cn(
  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 type-body text-foreground outline-none select-none focus-visible:focus-ring-inset data-disabled:text-foreground-disabled data-highlighted:bg-surface-elevated-hover',
);

/** The name of a group of rows: 28 px, not focusable. */
export const POPUP_GROUP_LABEL = cn('flex h-7 items-center px-2 type-meta');

/**
 * What an anchored popup does when it does not fit (16 section 5.1): it flips to the opposite side, then
 * shifts along the edge. It never moves to the side of its trigger, where it would cover what is next to it;
 * a popup that still does not fit is limited to the available height and scrolls.
 */
export const POPUP_COLLISION = { side: 'flip', align: 'shift', fallbackAxisSide: 'none' } as const;
