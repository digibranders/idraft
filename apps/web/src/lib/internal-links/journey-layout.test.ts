import { describe, expect, it } from 'vitest';

import {
  buildJourney,
  buildTree,
  cardKey,
  FOCUS_KEY,
  groupKey,
  isFull,
  MAX_CARDS,
  moreKey,
  PER_CARD,
  pruneJourney,
  type JourneyItem,
  type JourneyNeighbor,
  type JourneyState,
  type ListLookup,
  type LoadedList,
} from './journey-layout';
import type { EdgeScope, LinkScope } from './scopes';

const tier = (code: string | null): JourneyNeighbor['tier'] => (code === null ? null : { code, name: `${code} pages` });

function node(id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor {
  return {
    url_id: id,
    path,
    title: null,
    status_code: 200,
    redirect_url_id: null,
    tier: tier(code),
    linking_pages: 1,
    linking_pages_all: 1,
    click_depth: 1,
    anchor: path,
    placement: 'content',
    scope: 'editorial',
    rel: [],
    is_followed: true,
    has_children: true,
    reciprocal: false,
    ...over,
  };
}

const HOME = node('1', '/', 'T2');
const PRICING = node('2', '/pricing', 'T1', { reciprocal: true });
const BLOG = node('3', '/blog', 'T3');
const POST = node('4', '/blog/post', 'T3');
const OLD = node('5', '/old', null);
const ARCHIVE = node('6', '/archive', null);

/** Lists by "url|direction|scope". The focus is /, url 1. */
const LISTS: Record<string, readonly JourneyNeighbor[]> = {
  '1|out|editorial': [BLOG, PRICING],
  '2|out|editorial': [POST, HOME],
  '3|out|editorial': [POST],
  '4|out|editorial': [HOME, PRICING],
  '1|in|editorial': [PRICING, OLD],
  '5|in|editorial': [ARCHIVE, POST],
  '1|out|template': [ARCHIVE],
};
const OTHER: Record<string, LoadedList<JourneyNeighbor>['otherScopes']> = {
  '1|out|editorial': [{ scope: 'template', pages: 1 }],
};

function lookupFrom(
  lists: Record<string, readonly JourneyNeighbor[]>,
  totals: Record<string, number> = {},
): ListLookup<JourneyNeighbor> {
  return ({ urlId, direction, scope }) => {
    const id = `${urlId}|${direction}|${scope}`;
    const items = lists[id] ?? [];
    return { status: 'ready', items, total: totals[id] ?? items.length, otherScopes: OTHER[id] ?? [] };
  };
}

const state = (over: Partial<JourneyState> = {}): JourneyState => ({
  focus: '1',
  scope: 'editorial' as LinkScope,
  open: new Set(),
  groups: new Set(),
  more: new Map(),
  ...over,
});

const ofKind = <K extends JourneyItem<JourneyNeighbor>['kind']>(
  items: readonly JourneyItem<JourneyNeighbor>[],
  kind: K,
) => items.filter((item): item is Extract<JourneyItem<JourneyNeighbor>, { kind: K }> => item.kind === kind);

describe('buildJourney (spec 7.5, mock il-journey-layout.js)', () => {
  it('shows the focus page outlinks in step 1 out, by tier, nothing opened by itself', () => {
    const layout = buildJourney(state(), lookupFrom(LISTS));
    const cards = ofKind(layout.out[0]?.items ?? [], 'card');
    expect(cards.map((card) => card.node.path)).toEqual(['/pricing', '/blog']);
    expect(cards.every((card) => !card.open)).toBe(true);
    expect(layout.out).toHaveLength(1);
  });

  it('collapses the other scopes of an opened card into group cards with their counts', () => {
    const groups = ofKind(buildJourney(state(), lookupFrom(LISTS)).out[0]?.items ?? [], 'group');
    expect(groups).toEqual([
      expect.objectContaining({
        scope: 'template',
        count: 1,
        open: false,
        key: groupKey('out', FOCUS_KEY, 'template'),
      }),
    ]);
  });

  it('opens a group card into cards of its scope', () => {
    const layout = buildJourney(
      state({ groups: new Set([groupKey('out', FOCUS_KEY, 'template')]) }),
      lookupFrom(LISTS),
    );
    expect(ofKind(layout.out[0]?.items ?? [], 'card').map((card) => card.node.path)).toContain('/archive');
  });

  it('makes a link to a page two steps back a back-link marker, never a card', () => {
    const pricing = cardKey('out', ['2']);
    const post = cardKey('out', ['2', '4']);
    const layout = buildJourney(state({ open: new Set([pricing, post]) }), lookupFrom(LISTS));
    const postCard = ofKind(layout.out[1]?.items ?? [], 'card').find((card) => card.key === post);
    expect(postCard?.backs.map((back) => [back.urlId, back.key])).toEqual([
      ['1', FOCUS_KEY],
      ['2', pricing],
    ]);
    // The post's links all lead back: no third column
    expect(layout.out).toHaveLength(2);
  });

  it('makes a link to a page in a sibling branch a stub that points at the original', () => {
    const layout = buildJourney(
      state({ open: new Set([cardKey('out', ['2']), cardKey('out', ['3'])]) }),
      lookupFrom(LISTS),
    );
    const second = layout.out[1]?.items ?? [];
    expect(ofKind(second, 'card').map((card) => card.node.path)).toEqual(['/blog/post']);
    expect(ofKind(second, 'stub')).toEqual([expect.objectContaining({ urlId: '4', at: { dir: 'out', step: 2 } })]);
  });

  it('puts pages that link both ways with the focus in a "Both ways" group on the first in column, as cards when open', () => {
    const closed = buildJourney(state(), lookupFrom(LISTS));
    const first = closed.in[0]?.items ?? [];
    expect(ofKind(first, 'group')).toEqual([expect.objectContaining({ scope: 'both', count: 1 })]);
    expect(ofKind(first, 'tierhead').map((head) => [head.tier?.code ?? null, head.count])).toEqual([[null, 1]]);
    const open = buildJourney(state({ groups: new Set([groupKey('in', FOCUS_KEY, 'both')]) }), lookupFrom(LISTS));
    const cards = ofKind(open.in[0]?.items ?? [], 'card');
    expect(cards.map((card) => card.node.path)).toEqual(['/pricing', '/old']);
    expect(cards[0]?.bothWays).toBe(true);
  });

  it('follows the same rules on the left: an in-link from a page already on the canvas is a stub', () => {
    const old = cardKey('in', ['5']);
    const layout = buildJourney(state({ open: new Set([old, cardKey('out', ['2'])]) }), lookupFrom(LISTS));
    const second = layout.in[1]?.items ?? [];
    expect(ofKind(second, 'card').map((card) => card.node.path)).toEqual(['/archive']);
    expect(ofKind(second, 'stub').map((stub) => [stub.node.path, stub.at])).toEqual([
      ['/blog/post', { dir: 'out', step: 2 }],
    ]);
  });

  it('shows 8 children a card, then "+N more", and 8 more for each press', () => {
    const many = Array.from({ length: 20 }, (_, index) => node(String(100 + index), `/p${String(index)}`, 'T3'));
    const lists = { '1|out|editorial': many };
    const first = buildJourney(state(), lookupFrom(lists)).out[0]?.items ?? [];
    expect(ofKind(first, 'card')).toHaveLength(PER_CARD);
    expect(ofKind(first, 'more')).toEqual([expect.objectContaining({ count: 12, key: moreKey('o|f') })]);
    const twice = buildJourney(state({ more: new Map([[moreKey('o|f'), 1]]) }), lookupFrom(lists)).out[0]?.items ?? [];
    expect(ofKind(twice, 'card')).toHaveLength(16);
  });

  it('counts the links it has not loaded yet in "+N more"', () => {
    const items = ofKind(
      buildJourney(state(), lookupFrom(LISTS, { '1|out|editorial': 60 })).out[0]?.items ?? [],
      'more',
    );
    expect(items).toEqual([expect.objectContaining({ count: 58 })]);
  });

  it('asks for every list it needs and draws a loading item until one arrives', () => {
    const loading: ListLookup<JourneyNeighbor> = () => ({ status: 'loading', items: [], total: 0, otherScopes: [] });
    const layout = buildJourney(state(), loading);
    expect(layout.pending).toBe(true);
    expect(layout.requests).toEqual([
      { urlId: '1', direction: 'out', scope: 'editorial', pages: 1 },
      { urlId: '1', direction: 'in', scope: 'editorial', pages: 1 },
    ]);
    expect(ofKind(layout.out[0]?.items ?? [], 'loading')).toHaveLength(1);
  });

  it('is full at 300 cards', () => {
    expect(MAX_CARDS).toBe(300);
    expect(isFull({ cardCount: 299 })).toBe(false);
    expect(isFull({ cardCount: 300 })).toBe(true);
  });

  it('drops opened keys that no longer exist once nothing is loading', () => {
    const stale = state({ open: new Set([cardKey('out', ['99'])]), more: new Map([[moreKey('o|o:99'), 1]]) });
    const layout = buildJourney(stale, lookupFrom(LISTS));
    expect(pruneJourney(stale, layout)).toEqual({ open: new Set(), groups: new Set(), more: new Map() });
    expect(pruneJourney(state(), buildJourney(state(), lookupFrom(LISTS)))).toBeNull();
  });
});

describe('buildTree (spec 7.5 tree list)', () => {
  it('shows a back link as a muted row and a page listed elsewhere as "listed above"', () => {
    const pricingKey = 't.2';
    const blogKey = 't.3';
    const { rows } = buildTree(
      { focus: '1', dir: 'out', scope: 'editorial' as EdgeScope, open: new Set([pricingKey, blogKey, 't.2.4']) },
      lookupFrom(LISTS),
    );
    expect(
      rows.map((row) => [row.kind, row.level, row.kind === 'page' && row.level === 0 ? 'focus' : row.key]),
    ).toEqual([
      ['page', 0, 'focus'],
      ['page', 1, 't.2'],
      ['back', 2, 't.2.1'],
      ['page', 2, 't.2.4'],
      ['back', 3, 't.2.4.2'],
      ['back', 3, 't.2.4.1'],
      ['page', 1, 't.3'],
      ['listed', 2, 't.3.4'],
    ]);
    const back = rows.find((row) => row.key === 't.2.4.1');
    expect(back).toEqual(expect.objectContaining({ kind: 'back', step: 0 }));
  });
});
