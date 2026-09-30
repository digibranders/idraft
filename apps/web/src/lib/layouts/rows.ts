/**
 * Row packing on the 12-column page grid (spec section 6.2). Cards flow in order; a card that does not fit in
 * the rest of a row starts the next one; a row that is not full stays not full, so a card never shows at a
 * width the person did not choose.
 */
import type { Breakpoint, CardItem, Width } from './types';

const COLUMNS = 12;

const SPANS: Record<Breakpoint, Record<Width, number>> = {
  wide: { third: 4, half: 6, two_thirds: 8, full: 12 },
  medium: { third: 6, half: 6, two_thirds: 12, full: 12 },
  narrow: { third: 12, half: 12, two_thirds: 12, full: 12 },
};

export function spanOf(width: Width, breakpoint: Breakpoint): number {
  return SPANS[breakpoint][width];
}

export interface PlacedCard {
  id: string;
  span: number;
}

export function packRows(cards: ReadonlyArray<CardItem>, breakpoint: Breakpoint): PlacedCard[][] {
  const rows: PlacedCard[][] = [];
  let used = COLUMNS;
  for (const card of cards) {
    const span = spanOf(card.width ?? 'full', breakpoint);
    if (used + span > COLUMNS) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]?.push({ id: card.id, span });
    used += span;
  }
  return rows;
}

/** Free columns after the last card: the room the "Add card" slot can take. A full last row gives a whole new row. */
export function trailingSpace(cards: ReadonlyArray<CardItem>, breakpoint: Breakpoint): number {
  const last = packRows(cards, breakpoint).at(-1);
  if (!last) return COLUMNS;
  const free = COLUMNS - last.reduce((sum, card) => sum + card.span, 0);
  return free === 0 ? COLUMNS : free;
}
