import { describe, expect, it } from 'vitest';

import { inspectedPage, parseLinksSearch } from './url-state';

describe('the page the inspector names', () => {
  it('hands over a url id, keeps the text of one the API would refuse, and ignores other records', () => {
    expect(inspectedPage(null)).toEqual({ urlId: null, invalid: null });
    expect(inspectedPage({ type: 'page', id: '12' })).toEqual({ urlId: '12', invalid: null });
    expect(inspectedPage({ type: 'page', id: '12x' })).toEqual({ urlId: null, invalid: '12x' });
    expect(inspectedPage({ type: 'page', id: '0' })).toEqual({ urlId: null, invalid: '0' });
    expect(inspectedPage({ type: 'keyword', id: 'abc' })).toEqual({ urlId: null, invalid: null });
  });
});

describe('the address of Internal links (URL state table)', () => {
  it('reads the defaults from an empty address', () => {
    expect(parseLinksSearch({})).toEqual({
      tab: 'pages',
      scope: 'editorial',
      worklist: null,
      edgeWorklist: null,
      sort: '-linking_pages',
      q: null,
      lq: null,
      source: null,
      target: null,
      focus: null,
      invalid: { src: null, tgt: null, focus: null },
      journeyView: 'canvas',
      treeDir: 'out',
      open: new Set(),
      groups: new Set(),
      more: new Map(),
      treeOpen: new Set(),
    });
  });

  it('reads every key, and drops values it does not know', () => {
    const state = parseLinksSearch({
      tab: 'journey',
      scope: 'all',
      view: 'orphans',
      lview: 'links_to_non_indexable',
      sort: 'click_depth',
      q: ' /blog ',
      focus: '101',
      jv: 'tree',
      dir: 'in',
      open: 'o:103,bad key',
      grp: 'g:o:f:template',
      more: 'm:o|f*2',
      topen: 't.103',
    });
    expect(state).toMatchObject({
      tab: 'journey',
      scope: 'all',
      worklist: 'orphans',
      edgeWorklist: 'links_to_non_indexable',
      sort: 'click_depth',
      q: '/blog',
      focus: '101',
      journeyView: 'tree',
      treeDir: 'in',
    });
    expect([...state.open]).toEqual(['o:103']);
    expect([...state.groups]).toEqual(['g:o:f:template']);
    expect([...state.more]).toEqual([['m:o|f', 2]]);
    expect([...state.treeOpen]).toEqual(['t.103']);
    expect(parseLinksSearch({ tab: 'changes', sort: '-equity_share', focus: '12x', view: 'lost' })).toMatchObject({
      tab: 'pages',
      sort: '-linking_pages',
      focus: null,
      worklist: null,
    });
  });

  it('keeps an id only when the API would take it as a url id, and remembers the text of one it refused', () => {
    expect(parseLinksSearch({ focus: '0', src: '007', tgt: '9223372036854775808' })).toMatchObject({
      focus: null,
      source: null,
      target: null,
      invalid: { focus: '0', src: '007', tgt: '9223372036854775808' },
    });
    expect(parseLinksSearch({ focus: '12', src: '3' }).invalid).toEqual({ focus: null, src: null, tgt: null });
    // A key that is not in the address is not an invalid id: the page shows not found only for what was named
    expect(parseLinksSearch({}).invalid).toEqual({ focus: null, src: null, tgt: null });
    expect(parseLinksSearch({ src: '  ' }).invalid.src).toBe('  ');
    expect(parseLinksSearch({ src: '9223372036854775807', tgt: '12' })).toMatchObject({
      source: '9223372036854775807',
      target: '12',
    });
  });
});
