import type { MapGraph, MapNode } from './map-graph';

/** A highlight of the Link map: pages nothing links to, pages that link nowhere on, pages in the menu or footer. */
export type MapLens = 'none' | 'noIn' | 'deadEnd' | 'sitewide';

export const MAP_LENSES: readonly MapLens[] = ['none', 'noIn', 'deadEnd', 'sitewide'];

const LENS_TEST: Readonly<Record<MapLens, (node: MapNode) => boolean>> = {
  none: () => true,
  noIn: (node) => node.linksIn === 0,
  deadEnd: (node) => node.linksIn > 0 && node.linksOut === 0,
  sitewide: (node) => node.sitewideFrom > 0,
};

export const parseLens = (value: string | null | undefined): MapLens =>
  MAP_LENSES.find((lens) => lens === value) ?? 'none';

export interface MapFocus {
  /** The page clicked, when it is on the map. */
  selected: string | null;
  /** Pages that link to the selected page, and pages it links to. Empty when no page is selected. */
  sources: ReadonlySet<string>;
  targets: ReadonlySet<string>;
  /** The pages in the light; null when nothing narrows the map. */
  lit: ReadonlySet<string> | null;
  /** The light is a search: the count of its pages is shown beside the box. */
  searching: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * What is lit (plan 11, W6 and W7). A selected page wins: it and the pages it links with. Otherwise the pages
 * that pass the highlight and contain the search text in their address or title.
 */
export function focusOf(
  graph: MapGraph,
  { selected, query, lens }: { selected: string | null; query: string; lens: MapLens },
): MapFocus {
  if (selected !== null && graph.byId.has(selected)) {
    const sources = new Set(graph.edges.filter((edge) => edge.to === selected).map((edge) => edge.from));
    const targets = new Set(graph.edges.filter((edge) => edge.from === selected).map((edge) => edge.to));
    return { selected, sources, targets, lit: new Set([selected, ...sources, ...targets]), searching: false };
  }
  const text = query.trim().toLowerCase();
  if (text === '' && lens === 'none') {
    return { selected: null, sources: EMPTY, targets: EMPTY, lit: null, searching: false };
  }
  const passes = LENS_TEST[lens];
  const lit = new Set(
    graph.nodes
      .filter(
        (node) =>
          passes(node) &&
          (text === '' || node.path.toLowerCase().includes(text) || node.title.toLowerCase().includes(text)),
      )
      .map((node) => node.id),
  );
  return { selected: null, sources: EMPTY, targets: EMPTY, lit, searching: text !== '' };
}
