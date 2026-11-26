import { describe, expect, it } from 'vitest';

import { focusOf, parseLens } from './map-focus';
import { toMapGraph } from './map-graph';
import type { LinkGraph } from './types';

const node = (url_id: string, path: string, links_in: number, links_out: number, sitewide_from = 0, title = '') => ({
  url_id,
  path,
  title,
  tier_id: null,
  links_in,
  links_out,
  sitewide_from,
});
const graph = toMapGraph(
  {
    run_id: 'r',
    include_auto: false,
    pages_total: 5,
    truncated: false,
    home_url_id: '1',
    nodes: [
      node('1', '/', 0, 2, 4, 'Managed SOC provider'),
      node('2', '/blog', 1, 1),
      node('3', '/blog/soc-post', 2, 0),
      node('4', '/about', 0, 0),
      node('5', '/contact', 0, 0, 4),
    ],
    edges: [
      { source: '1', target: '2', links: 1 },
      { source: '1', target: '3', links: 1 },
      { source: '2', target: '3', links: 1 },
    ],
  } as LinkGraph,
  [],
);
const none = { selected: null, query: '', lens: 'none' as const };

describe('focusOf', () => {
  it('lights everything when nothing narrows the map', () => {
    expect(focusOf(graph, none)).toMatchObject({ selected: null, lit: null, searching: false });
  });

  it('lights the selected page with the pages that link to it and the pages it links to', () => {
    const focus = focusOf(graph, { ...none, selected: '2', query: 'ignored while a page is selected' });

    expect(focus.selected).toBe('2');
    expect([...focus.sources]).toEqual(['1']);
    expect([...focus.targets]).toEqual(['3']);
    expect([...(focus.lit ?? [])].sort()).toEqual(['1', '2', '3']);
    expect(focus.searching).toBe(false);
  });

  it('ignores a selected page that is not on the map', () => {
    expect(focusOf(graph, { ...none, selected: '99' }).lit).toBeNull();
  });

  it('lights the pages whose address or title contains the search, whatever the case', () => {
    const focus = focusOf(graph, { ...none, query: ' SOC ' });

    expect([...(focus.lit ?? [])].sort()).toEqual(['1', '3']);
    expect(focus.searching).toBe(true);
  });

  it('lights the pages of a highlight, and both rules together', () => {
    expect([...(focusOf(graph, { ...none, lens: 'noIn' }).lit ?? [])].sort()).toEqual(['1', '4', '5']);
    expect([...(focusOf(graph, { ...none, lens: 'deadEnd' }).lit ?? [])]).toEqual(['3']);
    expect([...(focusOf(graph, { ...none, lens: 'sitewide' }).lit ?? [])].sort()).toEqual(['1', '5']);
    expect([...(focusOf(graph, { ...none, lens: 'sitewide', query: 'contact' }).lit ?? [])]).toEqual(['5']);
  });
});

describe('parseLens', () => {
  it('reads a known highlight and nothing else', () => {
    expect(parseLens('deadEnd')).toBe('deadEnd');
    expect(parseLens('other')).toBe('none');
    expect(parseLens(null)).toBe('none');
  });
});
