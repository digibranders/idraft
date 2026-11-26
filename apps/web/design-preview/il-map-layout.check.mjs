/* global console */
/**
 * Self-check of the Link map's graph and layout on the real crawl. Run: node design-preview/il-map-layout.check.mjs
 */
import assert from 'node:assert/strict';
import { REAL } from './il-data-real.js';
import { buildGraph, layoutGraph, summarise } from './il-map-layout.js';

const links = REAL.links.map(([from, to, , placement]) => ({ from, to, placement }));
const input = { pages: REAL.pages, links, host: REAL.host };
const graph = buildGraph(input);
const ids = new Set(graph.nodes.map((node) => node.id));
const byId = new Map(REAL.pages.map((page) => [page.id, page]));

// Only live pages are nodes, and the home page is one node although two crawled addresses have the path "/"
assert.ok(graph.nodes.every((node) => byId.get(node.id).status === 200 && !byId.get(node.id).redirect));
assert.equal(graph.nodes.filter((node) => byId.get(node.id).path === '/').length, 1);
// Every edge joins two different nodes, once per direction
assert.ok(graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to));
assert.equal(new Set(graph.edges.map((edge) => `${edge.from}>${edge.to}`)).size, graph.edges.length);
// Menu and footer links are a property, never an edge: far fewer edges than pages squared, and some sitewide pages
assert.ok(graph.edges.length < graph.nodes.length * 3);
assert.ok(graph.nodes.some((node) => node.sitewide > 0));
// Auto-generated links only add edges
assert.ok(buildGraph({ ...input, withAuto: true }).edges.length >= graph.edges.length);

const summary = summarise(graph);
assert.equal(summary.pages, graph.nodes.length);
assert.equal(summary.unlinked, graph.nodes.filter((node) => node.in + node.out === 0).length);
assert.ok(summary.largest + summary.unlinked <= summary.pages);

// The layout places every node once, at a finite spot of its own, and is the same on every run
const groupOf = (id) => id.length % 3;
const first = layoutGraph(graph, groupOf);
const second = layoutGraph(graph, groupOf);
assert.equal(first.positions.size, graph.nodes.length);
assert.ok([...first.positions.values()].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
assert.equal(new Set([...first.positions.values()].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)).size, graph.nodes.length);
assert.deepEqual([...first.positions], [...second.positions]);
assert.equal(first.groups.reduce((sum, group) => sum + group.count, 0), summary.unlinked);

console.log('Link map check passed:', summary);
