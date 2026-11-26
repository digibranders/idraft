import type { LinkGraph, PageTier } from './types';

/**
 * The Link map's view model (plan 11): the API's graph with what the screen needs worked out once. A node is a live
 * page under its canonical address; an edge is one page linking to another in the body. The API has already folded
 * redirects and variants and left menu and footer links out of the edges.
 */
export interface MapNode {
  id: string;
  path: string;
  /** The page's title, empty when it has none. */
  title: string;
  /** The page's tier, or null when untiered or when the workspace no longer has that tier. */
  tierId: string | null;
  tierPosition: number | null;
  linksIn: number;
  linksOut: number;
  /** Pages that link to it from a menu or footer; 0 unless that is at least half of the pages. */
  sitewideFrom: number;
  /** The last part of the address; empty for the home page (the screen says "Home page"). */
  name: string;
  /** `home`, `top` (a page with no folder) or the first folder with its slash. */
  section: string;
}

export interface MapEdge {
  from: string;
  to: string;
  links: number;
}

export interface MapGraph {
  nodes: readonly MapNode[];
  edges: readonly MapEdge[];
  byId: ReadonlyMap<string, MapNode>;
  pagesTotal: number;
  truncated: boolean;
  homeId: string | null;
}

const NAME_MAX = 30;

const parts = (path: string): string[] => path.split('/').filter(Boolean);

export function nameOf(path: string): string {
  const last = parts(path).at(-1) ?? '';
  return last.length > NAME_MAX ? `${last.slice(0, NAME_MAX - 1)}...` : last;
}

export function sectionOf(path: string): string {
  const list = parts(path);
  if (list.length === 0) return 'home';
  return list.length === 1 ? 'top' : `/${list[0]}`;
}

export function toMapGraph(api: LinkGraph, tiers: readonly PageTier[]): MapGraph {
  const positions = new Map(tiers.map((tier) => [tier.tier_id, tier.position]));
  const nodes = api.nodes.map((node): MapNode => {
    const tierPosition = node.tier_id === null ? null : (positions.get(node.tier_id) ?? null);
    return {
      id: node.url_id,
      path: node.path,
      title: node.title ?? '',
      tierId: tierPosition === null ? null : node.tier_id,
      tierPosition,
      linksIn: node.links_in,
      linksOut: node.links_out,
      sitewideFrom: node.sitewide_from,
      name: nameOf(node.path),
      section: sectionOf(node.path),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    nodes,
    byId,
    // An edge to a page the cap left out is not drawn
    edges: api.edges
      .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
      .map((edge) => ({ from: edge.source, to: edge.target, links: edge.links })),
    pagesTotal: api.pages_total,
    truncated: api.truncated,
    homeId: api.home_url_id !== null && byId.has(api.home_url_id) ? api.home_url_id : null,
  };
}

export interface MapSummary {
  pages: number;
  links: number;
  /** The most pages that hang together by the links drawn. */
  largest: number;
  /** Pages with no drawn link in or out among the pages on the map. */
  unlinked: number;
}

export function summarise(graph: MapGraph): MapSummary {
  const next = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    next.get(edge.from)?.push(edge.to);
    next.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>();
  let largest = 0;
  let unlinked = 0;
  for (const node of graph.nodes) {
    const around = next.get(node.id) ?? [];
    if (around.length === 0) {
      unlinked += 1;
      continue;
    }
    if (seen.has(node.id)) continue;
    let size = 0;
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      size += 1;
      for (const other of next.get(id) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return { pages: graph.nodes.length, links: graph.edges.length, largest, unlinked };
}

/** What a dot is filled with: a slot of the chart palette, the "other" grey, a named token, or hollow. */
export type MapColour =
  | { kind: 'palette'; index: number; outline?: false }
  | { kind: 'other' }
  | { kind: 'named'; name: string; outline: true }
  | { kind: 'hollow' };

export type MapColourMode = 'tier' | 'section';

export interface MapColourGroup {
  /** A tier id, `''` for untiered, a section, or `other`. */
  key: string;
  /** Tier mode: the tier, or null for untiered. Section mode: null. */
  tier: PageTier | null;
  /** Section mode: the section; tier mode: null. */
  section: string | null;
  colour: MapColour;
  count: number;
}

/** One hue per tier (W5): a dot is too small for the badge scale's shades of one blue. */
const TIER_COLOUR: readonly MapColour[] = [
  { kind: 'palette', index: 0 },
  { kind: 'palette', index: 1 },
  { kind: 'other' },
  { kind: 'named', name: 'chart-bar-neutral', outline: true },
  { kind: 'palette', index: 2 },
  { kind: 'palette', index: 3 },
  { kind: 'palette', index: 4 },
  { kind: 'palette', index: 5 },
];
const SECTION_SLOTS = 6;

export function colourGroups(
  graph: MapGraph,
  mode: MapColourMode,
  tiers: readonly PageTier[],
): { keyOf: (node: MapNode) => string; list: MapColourGroup[] } {
  if (mode === 'tier') {
    const keyOf = (node: MapNode): string => node.tierId ?? '';
    const list: MapColourGroup[] = [...tiers]
      .sort((a, b) => a.position - b.position)
      .map((tier) => ({
        key: tier.tier_id,
        tier,
        section: null,
        colour: TIER_COLOUR[tier.position - 1] ?? { kind: 'other' },
        count: 0,
      }));
    list.push({ key: '', tier: null, section: null, colour: { kind: 'hollow' }, count: 0 });
    const byKey = new Map(list.map((group) => [group.key, group]));
    for (const node of graph.nodes) {
      const group = byKey.get(keyOf(node));
      if (group !== undefined) group.count += 1;
    }
    return { keyOf, list: list.filter((group) => group.count > 0) };
  }
  const counts = new Map<string, number>();
  for (const node of graph.nodes) counts.set(node.section, (counts.get(node.section) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, SECTION_SLOTS);
  const named = new Set(top.map(([section]) => section));
  const keyOf = (node: MapNode): string => (named.has(node.section) ? node.section : 'other');
  const list: MapColourGroup[] = top.map(([section, count], index) => ({
    key: section,
    tier: null,
    section,
    colour: { kind: 'palette', index },
    count,
  }));
  const rest = graph.nodes.length - top.reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) list.push({ key: 'other', tier: null, section: null, colour: { kind: 'other' }, count: rest });
  return { keyOf, list };
}
