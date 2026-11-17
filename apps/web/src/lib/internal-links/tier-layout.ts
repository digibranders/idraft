import type { JourneyItem, JourneyLayout, JourneyNeighbor } from './journey-layout';
import { direction, laneOfTier, laneSet, placeOnce, type Lane, type LineDirection } from './tier-lanes';

export interface TierLine<N extends JourneyNeighbor> {
  from: string;
  to: string;
  direction: LineDirection;
  scope: JourneyNeighbor['scope'];
  /** The status of the page the line arrives at: a redirect or a broken page colours the line. */
  status: number | null;
  /** The link the line is, for its hover tip; `null` for the line to a group card, which stands for many links. */
  link: N | null;
}

export type TierCard<N extends JourneyNeighbor> = Extract<JourneyItem<N>, { kind: 'card' }>;

export interface TierLayout<N extends JourneyNeighbor> {
  lanes: Lane[];
  cardsByLane: Map<number, TierCard<N>[]>;
  /** Groups, "+N more", loading and failed rows go in the lane of the card they hang under. */
  extrasByLane: Map<number, JourneyItem<N>[]>;
  lines: TierLine<N>[];
  /** Card keys that are the same page as an earlier card: their lines go to that card. */
  alias: Map<string, string>;
}

export interface TierLayoutInput<N extends JourneyNeighbor> {
  layout: JourneyLayout<N>;
  focus: { urlId: string; position: number; statusCode: number | null };
  /** The positions of the workspace's tiers. */
  tiers: readonly number[];
  hidden: ReadonlySet<number>;
}

type Extra<N> = Extract<JourneyItem<N>, { kind: 'group' | 'more' | 'loading' | 'failed' }>;

const isExtra = <N>(item: JourneyItem<N>): item is Extra<N> =>
  item.kind === 'group' || item.kind === 'more' || item.kind === 'loading' || item.kind === 'failed';

/**
 * The By tier layout (spec 7.5 "Two layouts", mock `buildTierColumns`): one lane per tier, a page one card however many
 * links reach it, and every link between cards on the canvas a line (a page reached twice shows two lines, not two
 * cards). Pure.
 */
export function tierLayout<N extends JourneyNeighbor>({
  layout,
  focus,
  tiers,
  hidden,
}: TierLayoutInput<N>): TierLayout<N> {
  const order: JourneyItem<N>[] = [];
  const steps = Math.max(layout.out.length, layout.in.length);
  for (let step = 0; step < steps; step += 1) {
    order.push(...(layout.in[step]?.items ?? []), ...(layout.out[step]?.items ?? []));
  }
  const cards = order.filter((item): item is TierCard<N> => item.kind === 'card');
  const byKey = new Map(cards.map((item) => [item.key, item]));
  const placed = placeOnce(
    cards.map((item) => ({ key: item.key, urlId: item.urlId })),
    { key: 'f', urlId: focus.urlId },
  );
  const resolve = (key: string): string => placed.alias.get(key) ?? key;
  const groupParent = new Map<string, string>();
  for (const item of order) if (item.kind === 'group') groupParent.set(item.key, item.parentKey);

  /** The lane a key stands in: a card's tier, the focus page's lane, or the lane of what a group hangs under. */
  const laneOfKey = (key: string, depth = 0): number | null => {
    if (key === 'f') return focus.position;
    const item = byKey.get(resolve(key));
    if (item !== undefined) return laneOfTier(item.node.tier);
    const parent = groupParent.get(key);
    return parent === undefined || depth > 12 ? null : laneOfKey(parent, depth + 1);
  };
  const statusOfKey = (key: string): number | null => {
    if (key === 'f') return focus.statusCode;
    return byKey.get(resolve(key))?.node.status_code ?? null;
  };

  const counts = new Map<number, number>([[focus.position, 1]]);
  for (const placedCard of placed.cards) {
    const item = byKey.get(placedCard.key);
    if (item === undefined) continue;
    const pos = laneOfTier(item.node.tier);
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  const lanes = laneSet({
    tiers,
    inView: new Set(cards.map((item) => laneOfTier(item.node.tier))),
    focusLane: focus.position,
    hidden,
    counts,
  });
  const shown = new Set(lanes.map((lane) => lane.pos));

  const cardsByLane = new Map<number, TierCard<N>[]>(lanes.map((lane) => [lane.pos, []]));
  for (const placedCard of placed.cards) {
    const item = byKey.get(placedCard.key);
    if (item !== undefined) cardsByLane.get(laneOfTier(item.node.tier))?.push(item);
  }

  const extrasByLane = new Map<number, JourneyItem<N>[]>();
  const lines: TierLine<N>[] = [];
  const seen = new Set<string>();
  const add = (
    from: string,
    to: string,
    item: JourneyItem<N>,
    link: N | null,
    scope: JourneyNeighbor['scope'],
  ): void => {
    const fromLane = laneOfKey(from);
    const toLane = laneOfKey(to);
    if (fromLane === null || toLane === null || !shown.has(fromLane) || !shown.has(toLane)) return;
    const id = `${from}>${to}`;
    if (seen.has(id) || from === to) return;
    seen.add(id);
    lines.push({
      from,
      to,
      direction: direction(fromLane, toLane),
      scope,
      status: statusOfKey(to),
      link: item.kind === 'card' ? link : null,
    });
  };

  for (const item of order) {
    if (isExtra(item)) {
      const lane = laneOfKey(item.parentKey);
      if (lane !== null && shown.has(lane)) extrasByLane.set(lane, [...(extrasByLane.get(lane) ?? []), item]);
      if (item.kind === 'group') {
        const parent = resolve(item.parentKey);
        const scope = item.scope === 'both' ? null : item.scope;
        if (item.dir === 'in') add(item.key, parent, item, null, scope);
        else add(parent, item.key, item, null, scope);
      }
      continue;
    }
    if (item.kind !== 'card' && item.kind !== 'stub') continue;
    const parent = resolve(item.parentKey);
    // A stub is a page already on the canvas: its line goes to the card that is there
    const target = item.kind === 'stub' ? firstCardOf(cards, item.urlId, focus.urlId) : resolve(item.key);
    if (target === null) continue;
    if (item.dir === 'in') add(target, parent, item, item.node, item.node.scope);
    else add(parent, target, item, item.node, item.node.scope);
  }
  return { lanes, cardsByLane, extrasByLane, lines, alias: placed.alias };
}

/** The key of the card that stands for a page: the focus page, or the first card of it. */
function firstCardOf<N extends JourneyNeighbor>(
  cards: readonly TierCard<N>[],
  urlId: string,
  focusUrlId: string,
): string | null {
  if (urlId === focusUrlId) return 'f';
  return cards.find((candidate) => candidate.urlId === urlId)?.key ?? null;
}
