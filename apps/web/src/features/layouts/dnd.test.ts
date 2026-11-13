// @vitest-environment jsdom
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type Active,
  type ClientRect,
  type CollisionDetection,
  type DroppableContainer,
  type Over,
  type SensorContext,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  GAP_PREFIX,
  POINTER_DISTANCE,
  SILENT_ANNOUNCEMENTS,
  TOUCH_DELAY_MS,
  TOUCH_TOLERANCE,
  cardZone,
  documentIndex,
  dropAnimationFor,
  dropPlaceOf,
  gapId,
  layoutCollisions,
  noShift,
  placeOfEvent,
  rowCoordinateGetter,
  useLayoutSensors,
} from './dnd';
import { SCREENS, type Breakpoint, type CardItem } from '@/lib/layouts';

const CARDS: readonly CardItem[] = SCREENS.overview.builtin.cards ?? [];
const IDS = CARDS.map((card) => card.id);
const TREND = 'trend';
const RANK = 'rank-distribution';
const UNCLASSIFIED = 'unclassified';
const KEY_CHANGES = 'key-changes';
const OPPORTUNITIES = 'opportunities';
const COMPETITORS = 'competitors';

/** Card `index` is a 90 by 40 box at 100 px per step; the geometry is not the layout, only a place to point at. */
function rectOf(index: number): ClientRect {
  const left = index * 100;
  const top = index * 50;
  return { left, top, width: 90, height: 40, right: left + 90, bottom: top + 40 };
}

/** The only members of a DroppableContainers map the getter could touch; the real class is not exported. */
class Containers extends Map<UniqueIdentifier, DroppableContainer> {
  override get(id: UniqueIdentifier | null | undefined): DroppableContainer | undefined {
    return id === null || id === undefined ? undefined : super.get(id);
  }
  toArray(): DroppableContainer[] {
    return [...this.values()];
  }
  getEnabled(): DroppableContainer[] {
    return this.toArray();
  }
  getNodeFor(): HTMLElement | undefined {
    return undefined;
  }
}

function contextOf(overId: string | null): SensorContext {
  const over: Over | null =
    overId === null ? null : { id: overId, rect: rectOf(IDS.indexOf(overId)), disabled: false, data: { current: {} } };
  return {
    activatorEvent: null,
    active: null,
    activeNode: null,
    collisionRect: null,
    collisions: null,
    draggableNodes: new Map(),
    draggingNode: null,
    draggingNodeRect: null,
    droppableRects: new Map(IDS.map((id, index) => [id, rectOf(index)])),
    droppableContainers: new Containers(),
    over,
    scrollableAncestors: [],
    scrollAdjustedTranslate: null,
  };
}

interface Edge {
  id: string;
  edge: 'first' | 'last';
}

interface Pressed {
  to: ReturnType<ReturnType<typeof rowCoordinateGetter>>;
  prevented: boolean;
}

function setup(breakpoint: () => Breakpoint = () => 'wide'): {
  press: (code: string, active: string, over?: string | null) => Pressed;
  edges: Edge[];
} {
  const edges: Edge[] = [];
  const getter = rowCoordinateGetter({
    ids: () => IDS,
    cards: () => CARDS,
    breakpoint,
    onEdge: (id, edge) => edges.push({ id, edge }),
  });
  return {
    edges,
    press: (code, active, over = active) => {
      const event = new KeyboardEvent('keydown', { code, cancelable: true });
      const to = getter(event, { active, currentCoordinates: { x: 0, y: 0 }, context: contextOf(over) });
      return { to, prevented: event.defaultPrevented };
    },
  };
}

/** Where the dragged card's top left must go so that its centre sits on the centre of card `target`. */
function landing(active: number, target: number): { x: number; y: number } {
  const own = rectOf(active);
  const place = rectOf(target);
  return { x: place.left + place.width / 2 - own.width / 2, y: place.top + place.height / 2 - own.height / 2 };
}

describe('the fixture', () => {
  it('is the built-in overview cards', () => {
    expect(IDS).toEqual([TREND, RANK, 'matrix', UNCLASSIFIED, KEY_CHANGES, OPPORTUNITIES, 'ai-by-engine', COMPETITORS]);
  });
});

describe('useLayoutSensors', () => {
  const getter = (): undefined => undefined;

  it('is a mouse sensor with a 4 px distance, a touch sensor with a 200 ms hold and 5 px tolerance, and the keyboard sensor with the getter', () => {
    const { result } = renderHook(() => useLayoutSensors(getter));
    const [mouse, touch, keyboard] = result.current;
    expect(result.current).toHaveLength(3);
    expect(mouse?.sensor).toBe(MouseSensor);
    expect(mouse?.options).toEqual({ activationConstraint: { distance: 4 } });
    expect(touch?.sensor).toBe(TouchSensor);
    expect(touch?.options).toEqual({ activationConstraint: { delay: 200, tolerance: 5 } });
    expect(keyboard?.sensor).toBe(KeyboardSensor);
    expect(keyboard?.options).toEqual({ coordinateGetter: getter });
    expect([POINTER_DISTANCE, TOUCH_DELAY_MS, TOUCH_TOLERANCE]).toEqual([4, 200, 5]);
  });
});

describe('rowCoordinateGetter', () => {
  it('puts the dragged card on the centre of the card the arrow points at: down goes to the nearest start column of the next row', () => {
    // rank starts at column 9 in row 1; row 2 is matrix (column 1) and unclassified (column 7): unclassified is nearer
    expect(setup().press('ArrowDown', RANK).to).toEqual(landing(1, 3));
    expect(setup().press('ArrowRight', RANK).to).toEqual(landing(1, 2));
    expect(setup().press('ArrowLeft', RANK).to).toEqual(landing(1, 0));
  });

  it('answers with the breakpoint it is given: at medium and at narrow the same key goes to another card', () => {
    // medium rows: [trend] [rank matrix] [unclassified key-changes]: down from rank (column 1) is unclassified (column 1)
    expect(setup(() => 'medium').press('ArrowDown', RANK).to).toEqual(landing(1, 3));
    // narrow: one card per row, down is the next card
    expect(setup(() => 'narrow').press('ArrowDown', RANK).to).toEqual(landing(1, 2));
  });

  it('reads the breakpoint when the key is pressed, not when the getter was made', () => {
    let breakpoint: Breakpoint = 'wide';
    const { press } = setup(() => breakpoint);
    expect(press('ArrowDown', RANK).to).toEqual(landing(1, 3));
    breakpoint = 'narrow';
    expect(press('ArrowDown', RANK).to).toEqual(landing(1, 2));
  });

  it('moves on from the card it is over, not from the one picked up', () => {
    const { press } = setup();
    // picked up rank, now over unclassified (row 2, column 7): down is opportunities (row 3, column 7)
    expect(press('ArrowDown', RANK, UNCLASSIFIED).to).toEqual(landing(1, IDS.indexOf(OPPORTUNITIES)));
    // over the card it started on, over a row gap or over nothing, it starts from the card picked up
    expect(press('ArrowRight', RANK, RANK).to).toEqual(landing(1, 2));
    expect(press('ArrowRight', RANK, `${GAP_PREFIX}0`).to).toEqual(landing(1, 2));
    expect(press('ArrowLeft', RANK, null).to).toEqual(landing(1, 0));
  });

  it('sends Home to the first card and End to the last', () => {
    const { press } = setup();
    const from = IDS.indexOf(KEY_CHANGES);
    expect(press('Home', KEY_CHANGES).to).toEqual(landing(from, 0));
    expect(press('End', KEY_CHANGES).to).toEqual(landing(from, IDS.length - 1));
  });

  it('at an end calls onEdge and returns nothing, so the card does not move', () => {
    const { press, edges } = setup();
    for (const [code, id] of [
      ['ArrowDown', COMPETITORS],
      ['ArrowRight', COMPETITORS],
      ['End', COMPETITORS],
      ['ArrowLeft', TREND],
      ['ArrowUp', TREND],
      ['Home', TREND],
    ] as const) {
      expect(press(code, id).to, code).toBeUndefined();
    }
    expect(edges).toEqual([
      { id: COMPETITORS, edge: 'last' },
      { id: COMPETITORS, edge: 'last' },
      { id: COMPETITORS, edge: 'last' },
      { id: TREND, edge: 'first' },
      { id: TREND, edge: 'first' },
      { id: TREND, edge: 'first' },
    ]);
  });

  it('handles the keys it moves by (so the page does not scroll) and leaves every other key alone', () => {
    const { press, edges } = setup();
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(press(code, 'matrix').prevented, code).toBe(true);
    }
    expect(press('KeyA', 'matrix')).toEqual({ to: undefined, prevented: false });
    expect(edges).toEqual([]);
  });
});

describe('dropPlaceOf', () => {
  const lastInRow = (row: number): string | undefined => [RANK, UNCLASSIFIED, OPPORTUNITIES, COMPETITORS][row];

  it('is where a card lands once it has left its place', () => {
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: RANK, over: UNCLASSIFIED, after: true })).toEqual({
      over: 3,
      after: true,
      gapRow: null,
      index: 3,
    });
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: UNCLASSIFIED, over: RANK, after: false })).toEqual({
      over: 1,
      after: false,
      gapRow: null,
      index: 1,
    });
    // between rank and matrix
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: UNCLASSIFIED, over: RANK, after: true })?.index).toBe(2);
  });

  it('has no index over its own place or where it would stay', () => {
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: RANK, over: RANK, after: true })?.index).toBeNull();
    // the right half of the card before it is its own place
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: RANK, over: TREND, after: true })?.index).toBeNull();
  });

  it('takes a row gap as the place after the last card of its row', () => {
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: TREND, over: gapId(1), after: false })).toEqual({
      over: 3,
      after: true,
      gapRow: 1,
      index: 3,
    });
    expect(gapId(1)).toBe(`${GAP_PREFIX}1`);
  });

  it('is nothing over nothing, over a card that is not in the list, or for a card that is not', () => {
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: RANK, over: null, after: true })).toBeNull();
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: RANK, over: 'unknown', after: true })).toBeNull();
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: 'unknown', over: RANK, after: true })).toBeNull();
    expect(dropPlaceOf({ ids: IDS, lastInRow, active: RANK, over: gapId(9), after: false })).toBeNull();
  });
});

describe('layoutCollisions', () => {
  type Args = Parameters<CollisionDetection>[0];
  const containers: DroppableContainer[] = IDS.map((id, index) => ({
    id,
    key: id,
    data: { current: undefined },
    disabled: false,
    node: { current: null },
    rect: { current: rectOf(index) },
  }));
  const active: Active = {
    id: RANK,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  };
  /** `rect` is where the dragged card's copy is, `pointer` where the pointer is (null for the keyboard). */
  const argsOf = (rect: ClientRect, pointer: { x: number; y: number } | null): Args => ({
    active,
    collisionRect: rect,
    droppableRects: new Map(IDS.map((id, index) => [id, rectOf(index)])),
    droppableContainers: containers,
    pointerCoordinates: pointer,
  });

  it('judges a keyboard drag by the copy of the card: the nearest centre', () => {
    expect(layoutCollisions(argsOf(rectOf(3), null))[0]?.id).toBe(IDS[3]);
  });

  it('judges a pointer drag by the pointer, not by the copy that trails it', () => {
    // the copy sits on card 7; the pointer is inside card 5
    const collisions = layoutCollisions(argsOf(rectOf(7), { x: 520, y: 270 }));
    expect(collisions[0]?.id).toBe(IDS[5]);
    expect(collisions[0]?.data).toMatchObject({ pointer: { x: 520, y: 270 } });
  });

  it('takes the card nearest the pointer when the pointer is between cards', () => {
    // 95 px right, 20 down is the gap between card 0 and card 1, nearer the centre of card 0
    expect(layoutCollisions(argsOf(rectOf(7), { x: 95, y: 20 }))[0]?.id).toBe(IDS[0]);
  });
});

describe('placeOfEvent for a pointer drag', () => {
  const active: Active = {
    id: RANK,
    data: { current: undefined },
    rect: { current: { initial: null, translated: rectOf(7) } },
  };
  const over: Over = { id: UNCLASSIFIED, rect: rectOf(3), disabled: false, data: { current: undefined } };
  const zone = cardZone(CARDS, 'wide');
  /** The pointer is where the collision detection saw it; the copy of the card (`translated`) is far away. */
  const at = (x: number): ReturnType<typeof placeOfEvent> =>
    placeOfEvent(
      {
        activatorEvent: new MouseEvent('mousedown'),
        active,
        over,
        collisions: [{ id: UNCLASSIFIED, data: { pointer: { x, y: 170 } } }],
      },
      zone,
    );

  it('goes after the card when the pointer is right of its middle, before it when left', () => {
    // the card is 300 to 390 wide: its middle is 345
    expect(at(350)).toMatchObject({ after: true, index: 3 });
    expect(at(340)).toMatchObject({ after: false, index: 2 });
  });

  it('is before the card when the collision did not say where the pointer was', () => {
    expect(
      placeOfEvent({ activatorEvent: new MouseEvent('mousedown'), active, over, collisions: null }, zone),
    ).toMatchObject({ after: false });
  });
});

describe('documentIndex', () => {
  const card = (id: string): CardItem => ({ id, type: 'seo.rank_distribution' });
  const all = ['a', 'b', 'x', 'c', 'y'].map(card);
  const shown = ['a', 'b', 'c'].map(card);

  it('is the index itself when every card of the document is shown', () => {
    expect(documentIndex(shown, shown, 'a', 2)).toBe(2);
    expect(documentIndex(shown, shown, 'c', 0)).toBe(0);
  });

  it('puts the card before the shown card that follows it, past the cards the person may not see', () => {
    // a to index 1: the shown order is b a c, so before c, which is after the card x nobody sees
    expect(documentIndex(all, shown, 'a', 1)).toBe(2);
    // c to index 0: before a
    expect(documentIndex(all, shown, 'c', 0)).toBe(0);
    // a to the end: after every other card of the document
    expect(documentIndex(all, shown, 'a', 2)).toBe(4);
  });
});

describe('the drag settings', () => {
  it('does not shift anything while dragging (the drop line shows the place)', () => {
    expect(noShift({ activeIndex: 0, activeNodeRect: null, index: 1, rects: [], overIndex: 2 })).toBeNull();
  });

  it('has a drop animation only when motion is allowed', () => {
    expect(dropAnimationFor(true)).toBeNull();
    expect(dropAnimationFor(false)).toEqual({ duration: 150 });
  });

  it("keeps dnd-kit's own live region silent for every event", () => {
    const active: Active = {
      id: 'a',
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    };
    const over: Over = { id: 'b', rect: rectOf(1), disabled: false, data: { current: undefined } };
    expect(SILENT_ANNOUNCEMENTS.onDragStart({ active })).toBeUndefined();
    expect(SILENT_ANNOUNCEMENTS.onDragOver({ active, over })).toBeUndefined();
    expect(SILENT_ANNOUNCEMENTS.onDragEnd({ active, over })).toBeUndefined();
    expect(SILENT_ANNOUNCEMENTS.onDragEnd({ active, over: null })).toBeUndefined();
    expect(SILENT_ANNOUNCEMENTS.onDragCancel({ active, over })).toBeUndefined();
  });
});
