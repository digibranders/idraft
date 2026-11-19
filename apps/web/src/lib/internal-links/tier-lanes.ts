/**
 * The By tier layout (spec 7.5 "Two layouts", mock `il-journey.js` `buildTierColumns`): one lane per tier, the lowest on
 * the left and T1 on the right, so a line that runs left to right goes up toward the money pages. A page is one card
 * however many links reach it. Pure.
 */
import { UNTIERED_POSITION, tierPosition, type TierCodeLike } from './tiers';

/** Untiered is the last position (99, `tiers.ts`), so it is the lowest lane. */
export const UNTIERED_LANE = UNTIERED_POSITION;

/** The lane of a tier position (1 is T1); Untiered is 99. */
export const laneOf = (position: number | null): number => position ?? UNTIERED_LANE;

/** The lane of a page's tier (`null` is Untiered). */
export const laneOfTier = (tier: TierCodeLike | null): number => tierPosition(tier);

export type LineDirection = 'up' | 'down' | 'side';

/** A link from lane `from` to lane `to`: up a tier, down a tier or inside one. */
export function direction(from: number, to: number): LineDirection {
  if (to < from) return 'up';
  if (to > from) return 'down';
  return 'side';
}

export interface Lane {
  pos: number;
  isFocus: boolean;
  count: number;
  empty: boolean;
}

export interface LaneInput {
  /** The positions of the workspace's tiers (1 to 8). */
  tiers: readonly number[];
  /** The lanes of the pages on the canvas now. */
  inView: ReadonlySet<number>;
  focusLane: number;
  /** Lanes the user turned off with a chip. */
  hidden: ReadonlySet<number>;
  counts?: ReadonlyMap<number, number>;
}

/**
 * The lanes shown, left to right: Untiered (only when an untiered page is in view), then the lowest tier up to T1. A
 * chip turns a lane off, except the focus page's own lane.
 */
export function laneSet({ tiers, inView, focusLane, hidden, counts = new Map() }: LaneInput): Lane[] {
  // One lane per position (a repeated one, or 99 among the tiers, is still one), and the focus lane is always among them
  const positions = new Set([...tiers, focusLane]);
  positions.delete(UNTIERED_LANE);
  const order = [UNTIERED_LANE, ...[...positions].sort((a, b) => b - a)];
  return order
    .filter((pos) => {
      if (pos === focusLane) return true;
      if (hidden.has(pos)) return false;
      return pos === UNTIERED_LANE ? inView.has(UNTIERED_LANE) : true;
    })
    .map((pos) => {
      const count = counts.get(pos) ?? 0;
      return { pos, isFocus: pos === focusLane, count, empty: count === 0 };
    });
}

export interface PlacedCard {
  key: string;
  urlId: string;
}

/**
 * The cards of the canvas in reading order, each page once. The focus page is placed first; a later card of the same page
 * is an alias of the first, so its lines go to the card that is there.
 */
export function placeOnce(
  order: readonly PlacedCard[],
  focus?: PlacedCard,
): { cards: PlacedCard[]; alias: Map<string, string> } {
  const first = new Map<string, string>();
  if (focus !== undefined) first.set(focus.urlId, focus.key);
  const cards: PlacedCard[] = [];
  const alias = new Map<string, string>();
  for (const card of order) {
    const existing = first.get(card.urlId);
    if (existing === undefined) {
      first.set(card.urlId, card.key);
      cards.push(card);
    } else {
      alias.set(card.key, existing);
    }
  }
  return { cards, alias };
}
