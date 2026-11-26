import { describe, expect, it } from 'vitest';

import { colourGroups, nameOf, sectionOf, summarise, toMapGraph } from './map-graph';
import type { LinkGraph, PageTier } from './types';

const tiers = [
  { tier_id: 't1', position: 1, code: 'T1', name: 'Money pages' },
  { tier_id: 't2', position: 2, code: 'T2', name: 'Supporting pages' },
] as unknown as PageTier[];

const api = {
  run_id: 'r',
  include_auto: false,
  pages_total: 5,
  truncated: false,
  home_url_id: '1',
  nodes: [
    { url_id: '1', path: '/', title: 'Home', tier_id: 't1', links_in: 0, links_out: 2, sitewide_from: 4 },
    { url_id: '2', path: '/blog', title: 'Blog', tier_id: 't2', links_in: 1, links_out: 1, sitewide_from: 0 },
    { url_id: '3', path: '/blog/post-a', title: null, tier_id: null, links_in: 2, links_out: 0, sitewide_from: 0 },
    { url_id: '4', path: '/about', title: 'About', tier_id: 'gone', links_in: 0, links_out: 0, sitewide_from: 0 },
    { url_id: '5', path: '/blog/post-b/', title: 'B', tier_id: null, links_in: 0, links_out: 0, sitewide_from: 0 },
  ],
  edges: [
    { source: '1', target: '2', links: 1 },
    { source: '1', target: '3', links: 2 },
    { source: '2', target: '3', links: 1 },
    { source: '2', target: '99', links: 1 },
  ],
} as LinkGraph;

describe('nameOf and sectionOf', () => {
  it('names a page by the last part of its address', () => {
    expect(nameOf('/')).toBe('');
    expect(nameOf('/blog/post-a')).toBe('post-a');
    expect(nameOf('/blog/post-b/')).toBe('post-b');
    expect(nameOf(`/x/${'a'.repeat(40)}`)).toBe(`${'a'.repeat(29)}...`);
  });

  it('puts a page in its first folder', () => {
    expect(sectionOf('/')).toBe('home');
    expect(sectionOf('/about')).toBe('top');
    expect(sectionOf('/blog/post-a')).toBe('/blog');
  });
});

describe('toMapGraph', () => {
  it('keeps the pages, drops an edge with an end that is not on the map, and resolves tiers', () => {
    const graph = toMapGraph(api, tiers);

    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['1>2', '1>3', '2>3']);
    expect(graph.byId.get('1')?.tierPosition).toBe(1);
    // A tier the workspace no longer has reads as untiered
    expect(graph.byId.get('4')?.tierPosition).toBeNull();
    expect(graph.byId.get('3')?.title).toBe('');
    expect(graph.homeId).toBe('1');
  });
});

describe('summarise', () => {
  it('counts the pages, the links, the largest group and the pages with no link', () => {
    expect(summarise(toMapGraph(api, tiers))).toEqual({ pages: 5, links: 3, largest: 3, unlinked: 2 });
  });
});

describe('colourGroups', () => {
  it('groups by tier in tier order, untiered last, and leaves out empty groups', () => {
    const graph = toMapGraph(api, tiers);
    const groups = colourGroups(graph, 'tier', tiers);

    expect(groups.list.map((group) => [group.key, group.count])).toEqual([
      ['t1', 1],
      ['t2', 1],
      ['', 3],
    ]);
    // Page 4 has a tier the workspace no longer has
    expect(graph.nodes.filter((node) => node.id === '4').map(groups.keyOf)).toEqual(['']);
  });

  it('groups by section, the largest first, and folds the rest into other after six', () => {
    const groups = colourGroups(toMapGraph(api, tiers), 'section', tiers);

    // `/blog` and `/about` have no folder (top); the two posts are in `/blog`. Most pages first, then by key.
    expect(groups.list.map((group) => [group.key, group.count])).toEqual([
      ['/blog', 2],
      ['top', 2],
      ['home', 1],
    ]);
  });

  it('keeps six sections and folds every other page into other', () => {
    const many = {
      ...api,
      nodes: Array.from({ length: 9 }, (_, i) => ({
        url_id: String(i + 1),
        path: `/s${i + 1}/page`,
        title: null,
        tier_id: null,
        links_in: 0,
        links_out: 0,
        sitewide_from: 0,
      })),
      edges: [],
    } as LinkGraph;
    const graph = toMapGraph(many, tiers);
    const groups = colourGroups(graph, 'section', tiers);

    expect(groups.list.map((group) => [group.key, group.count])).toEqual([
      ['/s1', 1],
      ['/s2', 1],
      ['/s3', 1],
      ['/s4', 1],
      ['/s5', 1],
      ['/s6', 1],
      ['other', 3],
    ]);
    expect(graph.nodes.filter((node) => node.id === '9').map(groups.keyOf)).toEqual(['other']);
  });

  it('reads a tier beyond the eighth as the other grey', () => {
    const deep = [...tiers, { tier_id: 't9', position: 9, code: 'T9', name: 'Ninth' }] as unknown as PageTier[];
    const graph = toMapGraph(
      { ...api, nodes: api.nodes.slice(0, 1).map((node) => ({ ...node, tier_id: 't9' })), edges: [] } as LinkGraph,
      deep,
    );

    expect(colourGroups(graph, 'tier', deep).list.map((group) => group.colour)).toEqual([{ kind: 'other' }]);
  });
});
