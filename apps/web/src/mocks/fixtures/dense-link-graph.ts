import type { LinkGraph } from '@/lib/internal-links/types';

/**
 * A synthetic crawl with the shape of a real, well linked site and none of its content: a few hubs that most pages
 * link to or from (degree 100 to 200), a long tail at 1 to 12 links, and some pages nothing links. It has no random
 * input (a small generator of its own), so a test or a harness gets the same graph every run.
 */
export interface DenseGraphOptions {
  /** Live pages. */
  pages?: number;
  /** Pages with a degree of 100 or more. */
  hubs?: number;
  /** The share of pages with no link in or out, 0 to 1. */
  unlinked?: number;
  /** Add the links of auto-generated blocks (a third more). */
  auto?: boolean;
}

/** A 32 bit linear congruential generator: the same sequence for the same seed. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const SECTIONS = ['blog', 'services', 'industries', 'resources', 'company', 'guides', 'compliance'] as const;
const WORDS = ['managed', 'security', 'incident', 'response', 'platform', 'cloud', 'threat', 'detection', 'audit', 'risk'] as const;

export function denseLinkGraph({ pages = 387, hubs = 10, unlinked = 0.15, auto = false }: DenseGraphOptions = {}): LinkGraph {
  const next = sequence(auto ? 7 : 11);
  const linked = Math.max(2, Math.round(pages * (1 - unlinked)));
  const edges = new Map<string, { source: string; target: string; links: number }>();
  const add = (from: number, to: number): void => {
    if (from === to) return;
    const key = `${String(from)}>${String(to)}`;
    if (!edges.has(key)) edges.set(key, { source: String(from), target: String(to), links: 1 });
  };
  const pick = (): number => 1 + Math.floor(next() * linked);
  // The hubs are the first pages: page 1 is the home page and the biggest
  for (let hub = 1; hub <= hubs; hub += 1) {
    const degree = Math.round(200 - ((hub - 1) * 100) / Math.max(1, hubs - 1));
    for (let count = 0; count < degree; count += 1) {
      const other = pick();
      if (next() < 0.5) add(hub, other);
      else add(other, hub);
    }
  }
  // The tail: 1 to 12 links each, mostly to a hub, as pages of a real site link to its main pages
  for (let page = hubs + 1; page <= linked; page += 1) {
    const count = 1 + Math.floor(next() * next() * 12);
    for (let link = 0; link < count; link += 1) {
      const other = next() < 0.55 ? 1 + Math.floor(next() * hubs) : pick();
      if (next() < 0.6) add(page, other);
      else add(other, page);
    }
  }
  if (auto) {
    const extra = Math.round(edges.size / 3);
    for (let count = 0; count < extra; count += 1) add(pick(), pick());
  }
  const degree = new Map<string, { in: number; out: number }>();
  for (const edge of edges.values()) {
    const from = degree.get(edge.source) ?? { in: 0, out: 0 };
    const to = degree.get(edge.target) ?? { in: 0, out: 0 };
    from.out += 1;
    to.in += 1;
    degree.set(edge.source, from);
    degree.set(edge.target, to);
  }
  const tiers = ['t1', 't2', 't3', 't4', null] as const;
  const nodes = Array.from({ length: pages }, (_, index) => {
    const id = String(index + 1);
    const share = (index * 7) % 100;
    const tier = share < 7 ? tiers[0] : share < 24 ? tiers[1] : share < 89 ? tiers[2] : share < 98 ? tiers[3] : tiers[4];
    const section = SECTIONS[index % SECTIONS.length] ?? 'blog';
    const slug = `${WORDS[index % WORDS.length] ?? 'page'}-${WORDS[(index * 3 + 1) % WORDS.length] ?? 'page'}-${String(index + 1)}`;
    const counts = degree.get(id) ?? { in: 0, out: 0 };
    return {
      url_id: id,
      path: index === 0 ? '/' : `/${section}/${slug}`,
      title: index === 0 ? 'Home' : `Page ${String(index + 1)}`,
      tier_id: tier,
      links_in: counts.in,
      links_out: counts.out,
      sitewide_from: 0,
    };
  });
  return {
    run_id: '11111111-1111-4111-8111-111111111111',
    include_auto: auto,
    pages_total: pages,
    truncated: false,
    home_url_id: '1',
    nodes,
    edges: [...edges.values()],
  };
}
