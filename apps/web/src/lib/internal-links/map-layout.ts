/**
 * Where every page of the Link map goes (plan 11, W2 and W10). Pure, and the same on every run for the same
 * input: no random start. Linked pages are placed by their links (linked pages pull together, all pages push
 * apart, more so around a page with many links), then moved apart until no two overlap. Pages with no drawn link
 * stand in a block of their own, one grid per group: to the right, or below on a canvas taller than wide.
 *
 * It runs in a Web Worker (`map-layout.worker.ts`), so its input and output are plain data.
 */
export interface LayoutNode {
  id: string;
  /** Links in plus links out among the pages on the map. */
  links: number;
  /** The order of the group the page belongs to (its tier position, 99 for untiered). */
  group: number;
}

export interface LayoutInput {
  nodes: readonly LayoutNode[];
  edges: readonly { from: string; to: string }[];
  /** The block of unlinked pages goes under the map. */
  below: boolean;
}

export interface MapLayout {
  /** `[id, x, y]` for every node. */
  positions: [string, number, number][];
  /** The grids of the block: where each group's line of text goes and how many pages it holds. */
  groups: { key: number; count: number; x: number; y: number }[];
}

// A page pushes others away in proportion to its links, so a hub keeps room for the pages around it
const REPULSION = 6.5;
const ATTRACTION = 0.05;
// A dense map (hubs of 100 links and more) is laid out with these instead, in the share `dense()` gives. A link to a
// hub pulls less than a link between two small pages, so the hubs stand out at the edge of their pages and the groups
// show; the pages keep farther apart. The small map the mock was tuned on keeps the numbers above.
const DENSE_REPULSION = 3.5;
const DENSE_ATTRACTION = 0.1;
const DENSE_HUB_EXPONENT = 1.3;
const DENSE_SPACE = 32;
/** The links of a page at which a link to it counts as a normal one: below it the link pulls harder, above it less. */
const TYPICAL_WEIGHT = 12;
// Strong enough to keep groups that do not link to each other in one picture, not far apart
const GRAVITY = 0.03;
// No two pages closer than this, plus room for the bigger dot of a page with many links
const SPACE = 26;
// A wide canvas gets a wide map: names read left to right, so the room is worth more sideways
const STRETCH = 1.45;
const CELL = 18;
const COLUMNS = 12;
const GROUP_GAP = 44;
// Beside the map the block stands clear of the dots (the names keep clear of its text, see `map-labels.ts`); below it needs less
const BLOCK_GAP_SIDE = 130;
const BLOCK_GAP_BELOW = 90;

/**
 * Rounds by size. Measured at 400 force rounds: 160 linked pages 0.3 s, 500 pages 1.7 s, 1,000 pages 3.5 s,
 * 2,000 pages 11 s. A big map is already spread by its hubs after fewer rounds, and the reader waits less.
 */
export function roundsFor(linked: number): { force: number; separation: number } {
  if (linked <= 300) return { force: 400, separation: 80 };
  // The moves apart are the costlier part (every pair, every round), so a bigger map gets fewer
  return {
    force: Math.max(120, Math.round(120_000 / linked)),
    separation: Math.min(120, Math.max(30, Math.round(30_000_000 / (linked * linked)))),
  };
}

/** How dense a map of this many linked pages is laid out, from 0 (the small map) to 1 (a site of 300 pages and more). */
export const dense = (linked: number): number => Math.min(1, Math.max(0, (linked - 150) / 150));
const blend = (small: number, big: number, share: number): number => small + (big - small) * share;

/** Ids in code unit order: the same on every browser and locale, unlike `localeCompare`. */
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A read that `noUncheckedIndexedAccess` accepts without a non-null assertion; every index here is in range. */
const at = (list: ArrayLike<number>, i: number): number => list[i] ?? 0;

export function layoutMap({ nodes, edges, below }: LayoutInput): MapLayout {
  const linked = nodes.filter((node) => node.links > 0).sort(byId);
  const count = linked.length;
  const index = new Map(linked.map((node, i) => [node.id, i]));
  const weight = linked.map((node) => node.links + 1);
  // A sunflower spiral: every page starts apart from the others, in the same place on every run
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = 30 * Math.sqrt(i + 1) * Math.cos(i * 2.399963);
    y[i] = 30 * Math.sqrt(i + 1) * Math.sin(i * 2.399963);
  }
  const pairs: [number, number][] = [];
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
  }
  const rounds = roundsFor(count);
  const share = dense(count);
  const repulsion = blend(REPULSION, DENSE_REPULSION, share);
  const attraction = blend(ATTRACTION, DENSE_ATTRACTION, share);
  const hubs = DENSE_HUB_EXPONENT * share;
  const space = blend(SPACE, DENSE_SPACE, share);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);

  for (let step = 0; step < rounds.force; step += 1) {
    dx.fill(0);
    dy.fill(0);
    for (let a = 0; a < count; a += 1) {
      const xa = at(x, a);
      const ya = at(y, a);
      const wa = at(weight, a);
      let fx = at(dx, a);
      let fy = at(dy, a);
      for (let b = a + 1; b < count; b += 1) {
        const ox = xa - at(x, b);
        const oy = ya - at(y, b);
        const length = Math.max(0.01, Math.hypot(ox, oy));
        const push = (repulsion * wa * at(weight, b)) / length / length;
        fx += ox * push;
        fy += oy * push;
        dx[b] = at(dx, b) - ox * push;
        dy[b] = at(dy, b) - oy * push;
      }
      dx[a] = fx - xa * GRAVITY * wa;
      dy[a] = fy - ya * GRAVITY * wa;
    }
    for (const [a, b] of pairs) {
      const pull =
        hubs === 0 ? attraction : attraction * (TYPICAL_WEIGHT / Math.sqrt(at(weight, a) * at(weight, b))) ** hubs;
      const ox = (at(x, a) - at(x, b)) * pull;
      const oy = (at(y, a) - at(y, b)) * pull;
      dx[a] = at(dx, a) - ox;
      dy[a] = at(dy, a) - oy;
      dx[b] = at(dx, b) + ox;
      dy[b] = at(dy, b) + oy;
    }
    // The step a page may move shrinks every round, so the picture settles
    const limit = 40 * (1 - step / rounds.force) + 0.3;
    for (let a = 0; a < count; a += 1) {
      const length = Math.max(0.01, Math.hypot(at(dx, a), at(dy, a)));
      const move = Math.min(limit, length);
      x[a] = at(x, a) + (at(dx, a) / length) * move;
      y[a] = at(y, a) + (at(dy, a) / length) * move;
    }
  }
  if (!below) for (let i = 0; i < count; i += 1) x[i] = at(x, i) * STRETCH;
  for (let round = 0; round < rounds.separation; round += 1) {
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        const need = space + 1.6 * (Math.sqrt(at(weight, a)) + Math.sqrt(at(weight, b)));
        let ox = at(x, a) - at(x, b);
        let oy = at(y, a) - at(y, b);
        let length = Math.hypot(ox, oy);
        if (length >= need) continue;
        if (length < 0.01) {
          // Two pages on one spot part in a direction their order gives, never a random one
          ox = Math.cos(a + b);
          oy = Math.sin(a + b);
          length = 1;
        }
        const shift = (need - length) / 2 / length;
        x[a] = at(x, a) + ox * shift;
        y[a] = at(y, a) + oy * shift;
        x[b] = at(x, b) - ox * shift;
        y[b] = at(y, b) - oy * shift;
      }
    }
  }

  const positions: [string, number, number][] = linked.map((node, i) => [node.id, at(x, i), at(y, i)]);
  // `reduce` hands its callback four arguments, so `Math.max` is called through a two argument arrow
  const extreme = (list: Float64Array, pick: (a: number, b: number) => number): number =>
    count > 0 ? list.reduce((a, b) => pick(a, b)) : 0;
  const right = extreme(x, Math.max);
  const leftMost = extreme(x, Math.min);
  const left = below ? leftMost : right + BLOCK_GAP_SIDE;
  const top = below ? extreme(y, Math.max) + BLOCK_GAP_BELOW : extreme(y, Math.min);
  const columns = below ? Math.max(COLUMNS, Math.floor((right - leftMost) / CELL)) : COLUMNS;
  const byGroup = new Map<number, string[]>();
  for (const node of nodes.filter((candidate) => !(candidate.links > 0)).sort(byId)) {
    const list = byGroup.get(node.group) ?? [];
    list.push(node.id);
    byGroup.set(node.group, list);
  }
  const groups: MapLayout['groups'] = [];
  let rowTop = top;
  for (const [key, ids] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
    groups.push({ key, count: ids.length, x: left, y: rowTop });
    ids.forEach((id, i) => {
      positions.push([id, left + (i % columns) * CELL, rowTop + CELL * 1.5 + Math.floor(i / columns) * CELL]);
    });
    rowTop += CELL * 1.5 + Math.ceil(ids.length / columns) * CELL + GROUP_GAP;
  }
  return { positions, groups };
}
