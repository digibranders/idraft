import { describe, expect, it } from 'vitest';

import type { JourneyItem, JourneyLayout, JourneyNeighbor } from './journey-layout';
import { tierLayout } from './tier-layout';

type N = JourneyNeighbor;
const node = (id: string, code: string | null, status = 200): N => ({
  url_id: id,
  path: `/${id}`,
  title: null,
  status_code: status,
  redirect_url_id: null,
  tier: code === null ? null : { code, name: code },
  linking_pages: 1,
  linking_pages_all: 1,
  click_depth: 1,
  anchor: null,
  placement: 'content',
  scope: 'editorial',
  rel: [],
  is_followed: true,
  has_children: false,
  reciprocal: false,
});
const card = (
  key: string,
  id: string,
  code: string | null,
  parentKey: string,
  dir: 'out' | 'in' = 'out',
  status = 200,
): JourneyItem<N> => ({
  kind: 'card',
  key,
  urlId: id,
  node: node(id, code, status),
  parentKey,
  dir,
  step: 1,
  canOpen: true,
  open: false,
  bothWays: false,
  backs: [],
});

const layout = (outItems: JourneyItem<N>[], inItems: JourneyItem<N>[] = []): JourneyLayout<N> => ({
  out: [{ step: 1, items: outItems }],
  in: inItems.length === 0 ? [] : [{ step: 1, items: inItems }],
  cardCount: outItems.length + inItems.length,
  requests: [],
  validKeys: new Set(),
  pending: false,
});

const FOCUS = { urlId: '1', position: 3, statusCode: 200 };
const tiers = [1, 2, 3, 4];
const none = new Set<number>();

describe('tierLayout', () => {
  it('puts each card in the lane of its tier and the focus page in its own', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T4', 'f')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lanes.map((lane) => lane.pos)).toEqual([4, 3, 2, 1]);
    expect(result.cardsByLane.get(1)?.map((item) => item.key)).toEqual(['o:2']);
    expect(result.cardsByLane.get(4)?.map((item) => item.key)).toEqual(['o:3']);
    expect(result.lanes.find((lane) => lane.pos === 3)?.isFocus).toBe(true);
  });

  it('draws one line per link between cards on the canvas, coloured by direction', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T4', 'f')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lines.find((line) => line.to === 'o:2')?.direction).toBe('up');
    expect(result.lines.find((line) => line.to === 'o:3')?.direction).toBe('down');
  });

  it('draws a link between pages of one tier sideways', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T3', 'f')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lines[0]?.direction).toBe('side');
  });

  it('shows a page reached twice as one card with two lines', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T2', 'f'), card('o:3.2', '2', 'T1', 'o:3')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.cardsByLane.get(1)).toHaveLength(1);
    expect(result.lines.filter((line) => line.to === 'o:2')).toHaveLength(2);
  });

  it('leaves out a lane a chip turned off, with its cards and lines', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:3', '3', 'T4', 'f')]),
      focus: FOCUS,
      tiers,
      hidden: new Set([4]),
    });
    expect(result.lanes.map((lane) => lane.pos)).not.toContain(4);
    expect(result.lines.every((line) => line.to !== 'o:3')).toBe(true);
  });

  it('never turns off the lane of the focus page', () => {
    const result = tierLayout({ layout: layout([]), focus: FOCUS, tiers, hidden: new Set([3]) });
    expect(result.lanes.map((lane) => lane.pos)).toContain(3);
  });

  it('draws a line from a stub to the card it points at', () => {
    const stub: JourneyItem<N> = {
      kind: 'stub',
      key: 'o:5.2',
      urlId: '2',
      node: node('2', 'T1'),
      parentKey: 'o:5',
      dir: 'out',
      at: { dir: 'out', step: 1 },
    };
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f'), card('o:5', '5', 'T2', 'f'), stub]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lines.some((line) => line.from === 'o:5' && line.to === 'o:2')).toBe(true);
    // A stub is no card in this layout
    expect(result.cardsByLane.get(1)?.map((item) => item.key)).toEqual(['o:2']);
  });

  it('runs a link in from the page that links to the card in view', () => {
    const result = tierLayout({
      layout: layout([], [card('i:9', '9', 'T4', 'f', 'in')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ from: 'i:9', to: 'f', direction: 'up' });
  });

  it('takes the status of the page the line arrives at', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f', 'out', 404)], [card('i:9', '9', 'T4', 'f', 'in', 500)]),
      focus: { ...FOCUS, statusCode: 301 },
      tiers,
      hidden: none,
    });
    expect(result.lines.find((line) => line.to === 'o:2')?.status).toBe(404);
    // The page that links in is not the target: the focus page is, and it redirects
    expect(result.lines.find((line) => line.to === 'f')?.status).toBe(301);
  });

  it('keeps the link of a card on its line, for the hover tip', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lines[0]?.link?.url_id).toBe('2');
  });

  it('counts an empty lane as zero pages, which is a finding', () => {
    const result = tierLayout({
      layout: layout([card('o:2', '2', 'T1', 'f')]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.lanes.find((lane) => lane.pos === 2)).toMatchObject({ count: 0, empty: true });
    expect(result.lanes.find((lane) => lane.pos === 3)).toMatchObject({ count: 1, empty: false });
    expect(result.lanes.find((lane) => lane.pos === 1)).toMatchObject({ count: 1 });
  });

  it('shows the Untiered lane only when an untiered page is in view', () => {
    const without = tierLayout({ layout: layout([card('o:2', '2', 'T1', 'f')]), focus: FOCUS, tiers, hidden: none });
    expect(without.lanes.map((lane) => lane.pos)).not.toContain(99);
    const withOne = tierLayout({ layout: layout([card('o:2', '2', null, 'f')]), focus: FOCUS, tiers, hidden: none });
    expect(withOne.lanes[0]?.pos).toBe(99);
    expect(withOne.cardsByLane.get(99)?.map((item) => item.key)).toEqual(['o:2']);
  });

  it('puts groups, "+N more", loading and failed rows in the lane of the card they hang under, and lines to the cards of a group', () => {
    const group: JourneyItem<N> = {
      kind: 'group',
      key: 'g:o:o:2:template',
      scope: 'template',
      count: 4,
      open: true,
      parentKey: 'o:2',
      dir: 'out',
    };
    const more: JourneyItem<N> = { kind: 'more', key: 'm:o:2', parentKey: 'o:2', count: 3 };
    const loading: JourneyItem<N> = { kind: 'loading', key: 'l:o:2', parentKey: 'o:2' };
    const result = tierLayout({
      layout: layout([
        card('o:2', '2', 'T1', 'f'),
        group,
        more,
        loading,
        card('g:o:o:2:template.7', '7', 'T4', 'g:o:o:2:template'),
      ]),
      focus: FOCUS,
      tiers,
      hidden: none,
    });
    expect(result.extrasByLane.get(1)?.flatMap((item) => ('key' in item ? [item.key] : []))).toEqual([
      'g:o:o:2:template',
      'm:o:2',
      'l:o:2',
    ]);
    expect(result.lines.some((line) => line.from === 'o:2' && line.to === 'g:o:o:2:template')).toBe(true);
    expect(result.lines.some((line) => line.from === 'g:o:o:2:template' && line.to === 'g:o:o:2:template.7')).toBe(
      true,
    );
  });
});
