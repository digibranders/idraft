'use client';

import type { ReactElement } from 'react';

/** The line's own width. */
const LINE_WIDTH = 2;

/** Pixels inside the grid: the one place a style is measured and not chosen. */
export interface LineRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LineRectArgs {
  /** The card the drop is next to, in the viewport. */
  target: Pick<DOMRect, 'left' | 'right' | 'top' | 'height'>;
  /** The grid the line is placed in, in the viewport. */
  grid: Pick<DOMRect, 'left' | 'top'>;
  /** The space between two cells of a row: the line goes in the middle of it. */
  gap: number;
  after: boolean;
}

/** A vertical line as tall as the card, on its right edge (`after`) or its left one, in the middle of the gap. */
export function lineRect({ target, grid, gap, after }: LineRectArgs): LineRect {
  const edge = after ? target.right + gap / 2 : target.left - gap / 2;
  return {
    left: edge - grid.left - LINE_WIDTH / 2,
    top: target.top - grid.top,
    width: LINE_WIDTH,
    height: target.height,
  };
}

export function sameLine(a: LineRect | null, b: LineRect | null): boolean {
  return (
    a === b ||
    (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
  );
}

/** The gap between the cells of a row, as the grid's own style says it (0 when it says none). */
export function columnGapOf(grid: Element): number {
  return Number.parseFloat(window.getComputedStyle(grid).columnGap) || 0;
}

/** Where a drop would land. It is placed in the grid, so it scrolls with it. */
export function DropLine({ line }: { line: LineRect | null }): ReactElement | null {
  if (line === null) return null;
  return (
    <div
      data-slot="layout-drop-line"
      aria-hidden="true"
      className="pointer-events-none absolute z-(--z-sticky) rounded-full bg-primary"
      style={line}
    />
  );
}
