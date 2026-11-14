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

/** Row (0 based) and start column (1 based) of every card, in card order. */
function placements(cards: ReadonlyArray<CardItem>, breakpoint: Breakpoint): Array<{ row: number; start: number }> {
  return packRows(cards, breakpoint).flatMap((cardsInRow, row) => {
    let start = 1;
    return cardsInRow.map((placed) => {
      const place = { row, start };
      start += placed.span;
      return place;
    });
  });
}

/** Number of the row (1 based, for "row 3") the card at `index` is in, packed for `breakpoint`; 0 for no such card. */
export function rowOf(cards: ReadonlyArray<CardItem>, breakpoint: Breakpoint, index: number): number {
  const place = placements(cards, breakpoint)[index];
  return place ? place.row + 1 : 0;
}

export type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/**
 * Where a keyboard move goes (overview-and-charts 9.6): Left and Right one place, Up and Down to the card in the
 * row above or below whose start column is nearest the moving card's (ties: the earlier), Home and End to the
 * ends. Null when there is nowhere to go ("already first").
 */
export function keyboardTarget(
  cards: ReadonlyArray<CardItem>,
  breakpoint: Breakpoint,
  from: number,
  key: MoveKey,
): number | null {
  const last = cards.length - 1;
  if (!Number.isInteger(from) || from < 0 || from > last) return null;
  let target: number | null;
  switch (key) {
    case 'ArrowLeft':
      target = from - 1;
      break;
    case 'ArrowRight':
      target = from + 1;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = last;
      break;
    case 'ArrowUp':
    case 'ArrowDown':
      target = nearestInNextRow(placements(cards, breakpoint), from, key === 'ArrowUp' ? -1 : 1);
      break;
  }
  return target !== null && target >= 0 && target <= last && target !== from ? target : null;
}

function nearestInNextRow(
  places: ReadonlyArray<{ row: number; start: number }>,
  from: number,
  step: 1 | -1,
): number | null {
  const current = places[from];
  if (!current) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const [index, place] of places.entries()) {
    const distance = Math.abs(place.start - current.start);
    if (place.row === current.row + step && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The index a dropped item takes (as moveCard reads it: the place once the item has left its old one), `after`
 * meaning past the item it is over; null when it would not move.
 */
export function dropIndex(from: number, over: number, after: boolean): number | null {
  if (over === from) return null;
  const target = over + (after ? 1 : 0) - (from < over ? 1 : 0);
  return target === from ? null : target;
}

/** The allowed widths with different spans at `breakpoint`, first one of each span kept, in the order given. */
export function distinctSpans(widths: ReadonlyArray<Width>, breakpoint: Breakpoint): Width[] {
  const seen = new Set<number>();
  return widths.filter((width) => {
    const span = spanOf(width, breakpoint);
    if (seen.has(span)) return false;
    seen.add(span);
    return true;
  });
}

/** The allowed width whose span is nearest `columns` (ties: the narrower), for the resize grip. */
export function snapWidth(widths: ReadonlyArray<Width>, breakpoint: Breakpoint, columns: number): Width {
  const [first, ...rest] = distinctSpans(widths, breakpoint);
  if (first === undefined) throw new RangeError('snapWidth needs at least one allowed width');
  const miss = (width: Width): number => Math.abs(spanOf(width, breakpoint) - columns);
  return rest.reduce((best, width) => {
    const gap = miss(width) - miss(best);
    return gap < 0 || (gap === 0 && spanOf(width, breakpoint) < spanOf(best, breakpoint)) ? width : best;
  }, first);
}

/** Free columns after the last card: the room the "Add card" slot can take. A full last row gives a whole new row. */
export function trailingSpace(cards: ReadonlyArray<CardItem>, breakpoint: Breakpoint): number {
  const last = packRows(cards, breakpoint).at(-1);
  if (!last) return COLUMNS;
  const free = COLUMNS - last.reduce((sum, card) => sum + card.span, 0);
  return free === 0 ? COLUMNS : free;
}
