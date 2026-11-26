/**
 * Internal links, Link map: the part with no DOM. `buildGraph` turns the crawl's pages and links into the nodes and
 * edges of the whole-site map, `summarise` counts what the map shows, `layoutGraph` gives every node a place.
 * `il-map-layout.check.mjs` runs all three on the real crawl in Node.
 *
 * Rules of the map:
 * - A node is a live page under its canonical address. A redirect folds into the page it points to and a variant
 *   (a page whose canonical is another crawled page) into that page, so a link to either lands on the real page.
 * - An edge is one page linking to another in the body (or by an auto-generated block when asked), however many
 *   times. Menu and footer links are never edges: nearly every page has the same ones, so they are a property of
 *   the page they point to (`sitewide`).
 * - The layout is the same every time for the same crawl: no random start.
 */

const BODY = new Set(['content']);
const BODY_AND_AUTO = new Set(['content', 'auto_generated']);
// A page linked from the menu or footer of at least this share of pages counts as linked sitewide
const SITEWIDE_SHARE = 0.5;
const MAX_HOPS = 5;

/**
 * @param {{ pages: Array<object>, links: Array<{from: string, to: string, placement: string}>, host: string, withAuto?: boolean }} input
 * @returns {{ nodes: Array<{id: string, in: number, out: number, sitewide: number}>, edges: Array<{from: string, to: string, count: number}> }}
 */
export function buildGraph({ pages, links, host, withAuto = false }) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  // Two crawled addresses can share a path (the www form of the home page): the live one owns the address
  const idByUrl = new Map();
  pages.forEach((page) => {
    const url = `https://${host}${page.path}`;
    if (page.status === 200 && !idByUrl.has(url)) idByUrl.set(url, page.id);
  });
  const resolved = new Map();
  const resolve = (id) => {
    if (resolved.has(id)) return resolved.get(id);
    let page = byId.get(id);
    for (let hop = 0; hop < MAX_HOPS && page?.redirect; hop += 1) page = byId.get(page.redirect);
    const canonical = page?.canonical ? idByUrl.get(page.canonical) : undefined;
    if (canonical && canonical !== page.id) page = byId.get(canonical);
    const result = page && page.status === 200 && !page.redirect ? page.id : null;
    resolved.set(id, result);
    return result;
  };

  const nodes = new Map();
  pages.forEach((page) => {
    if (resolve(page.id) === page.id) nodes.set(page.id, { id: page.id, in: 0, out: 0, sitewide: 0 });
  });

  const drawn = withAuto ? BODY_AND_AUTO : BODY;
  const edges = new Map();
  const templateSources = new Map();
  links.forEach((link) => {
    const from = resolve(link.from);
    const to = resolve(link.to);
    if (!from || !to || from === to) return;
    if (drawn.has(link.placement)) {
      const key = `${from}>${to}`;
      const edge = edges.get(key);
      if (edge) edge.count += 1;
      else edges.set(key, { from, to, count: 1 });
    } else if (!BODY_AND_AUTO.has(link.placement)) {
      if (!templateSources.has(to)) templateSources.set(to, new Set());
      templateSources.get(to).add(from);
    }
  });
  edges.forEach((edge) => {
    nodes.get(edge.from).out += 1;
    nodes.get(edge.to).in += 1;
  });
  templateSources.forEach((sources, id) => {
    if (sources.size >= SITEWIDE_SHARE * nodes.size) nodes.get(id).sitewide = sources.size;
  });
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** How the pages hang together: the largest connected group and the pages with no drawn link in or out. */
export function summarise(graph) {
  const next = new Map(graph.nodes.map((node) => [node.id, []]));
  graph.edges.forEach((edge) => {
    next.get(edge.from).push(edge.to);
    next.get(edge.to).push(edge.from);
  });
  const seen = new Set();
  let largest = 0;
  let groups = 0;
  graph.nodes.forEach((node) => {
    if (seen.has(node.id) || next.get(node.id).length === 0) return;
    groups += 1;
    let size = 0;
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length > 0) {
      const id = stack.pop();
      size += 1;
      next.get(id).forEach((other) => {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      });
    }
    largest = Math.max(largest, size);
  });
  return {
    pages: graph.nodes.length,
    links: graph.edges.length,
    largest,
    groups,
    unlinked: graph.nodes.filter((node) => node.in === 0 && node.out === 0).length,
    noLinksIn: graph.nodes.filter((node) => node.in === 0).length,
    deadEnds: graph.nodes.filter((node) => node.in > 0 && node.out === 0).length,
  };
}

const SPRING = 46;
const ITERATIONS = 320;
// Strong enough to keep groups that do not link to each other in one picture, not far apart
const GRAVITY = 2;
const CELL = 22;
const COLUMNS = 22;
const GROUP_GAP = 56;
const BLOCK_GAP = 110;

/**
 * Linked pages are placed by their links (a force layout: linked pages pull together, all pages push apart).
 * Pages with no drawn link sit in a block of their own to the right, one grid per group in `groupOf` order.
 *
 * @param {{ nodes: Array<{id: string, in: number, out: number}>, edges: Array<{from: string, to: string}> }} graph
 * @param {(id: string) => number} groupOf the order of the group a page belongs to (its tier position)
 * @returns {{ positions: Map<string, [number, number]>, groups: Array<{ key: number, count: number, x: number, y: number }> }}
 */
export function layoutGraph(graph, groupOf) {
  const linked = graph.nodes.filter((node) => node.in + node.out > 0).sort((a, b) => a.id.localeCompare(b.id));
  const index = new Map(linked.map((node, i) => [node.id, i]));
  // A sunflower spiral: every page starts apart from the others, in the same place on every run
  const x = linked.map((_, i) => 14 * Math.sqrt(i + 1) * Math.cos(i * 2.399963));
  const y = linked.map((_, i) => 14 * Math.sqrt(i + 1) * Math.sin(i * 2.399963));
  const pairs = graph.edges.map((edge) => [index.get(edge.from), index.get(edge.to)]);

  for (let step = 0; step < ITERATIONS; step += 1) {
    const dx = new Float64Array(linked.length);
    const dy = new Float64Array(linked.length);
    for (let a = 0; a < linked.length; a += 1) {
      for (let b = a + 1; b < linked.length; b += 1) {
        const ox = x[a] - x[b];
        const oy = y[a] - y[b];
        const distance = Math.max(0.01, Math.hypot(ox, oy));
        const push = (SPRING * SPRING) / distance / distance;
        dx[a] += ox * push;
        dy[a] += oy * push;
        dx[b] -= ox * push;
        dy[b] -= oy * push;
      }
      dx[a] -= x[a] * GRAVITY;
      dy[a] -= y[a] * GRAVITY;
    }
    pairs.forEach(([a, b]) => {
      const ox = x[a] - x[b];
      const oy = y[a] - y[b];
      const pull = Math.hypot(ox, oy) / SPRING;
      dx[a] -= ox * pull;
      dy[a] -= oy * pull;
      dx[b] += ox * pull;
      dy[b] += oy * pull;
    });
    // The step a page may move shrinks every round, so the picture settles
    const limit = 60 * (1 - step / ITERATIONS) + 0.5;
    for (let a = 0; a < linked.length; a += 1) {
      const length = Math.max(0.01, Math.hypot(dx[a], dy[a]));
      const move = Math.min(limit, length);
      x[a] += (dx[a] / length) * move;
      y[a] += (dy[a] / length) * move;
    }
  }

  const positions = new Map(linked.map((node, i) => [node.id, [x[i], y[i]]]));
  const right = linked.length > 0 ? Math.max(...x) : 0;
  const top = linked.length > 0 ? Math.min(...y) : 0;
  const byGroup = new Map();
  graph.nodes
    .filter((node) => node.in + node.out === 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((node) => {
      const key = groupOf(node.id);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(node.id);
    });
  const groups = [];
  let rowTop = top;
  [...byGroup.entries()].sort((a, b) => a[0] - b[0]).forEach(([key, ids]) => {
    groups.push({ key, count: ids.length, x: right + BLOCK_GAP, y: rowTop });
    ids.forEach((id, i) => positions.set(id, [right + BLOCK_GAP + (i % COLUMNS) * CELL, rowTop + CELL * 1.5 + Math.floor(i / COLUMNS) * CELL]));
    rowTop += CELL * 1.5 + Math.ceil(ids.length / COLUMNS) * CELL + GROUP_GAP;
  });
  return { positions, groups };
}
