'use client';

/**
 * What drag and drop on the layout screens is made of (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md,
 * section 2.8): the sensors, the keyboard's way through the packed rows, the place a drop would take, and every word
 * said about it. The cards' own grid is `sortable-grid.tsx`; WP-16's number strip builds on the same pieces.
 */
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type KeyboardSensorOptions,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import type { SortingStrategy } from '@dnd-kit/sortable';
import { useMemo, useRef } from 'react';

import { useLayoutAnnouncer } from './announcements';
import { useLayoutScreen } from './layout-provider';
import { useBreakpoint } from './use-breakpoint';
import {
  cardName,
  dropIndex,
  engineLabel,
  keyboardTarget,
  numberType,
  packRows,
  rowOf,
  type Breakpoint,
  type CardItem,
  type MoveKey,
} from '@/lib/layouts';

/** A pointer must move this far before a mouse press is a drag, so a click on the handle stays a click. */
export const POINTER_DISTANCE = 4;
/** A finger must rest this long on the handle before the card is picked up: moving sooner is a scroll. */
export const TOUCH_DELAY_MS = 200;
/** ... and may drift this far while it waits. */
export const TOUCH_TOLERANCE = 5;

const MOUSE_OPTIONS: SensorOptions = { activationConstraint: { distance: POINTER_DISTANCE } };
const TOUCH_OPTIONS: SensorOptions = { activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE } };

/**
 * Mouse, touch and keyboard sensors; the keyboard follows `coordinateGetter`. Not one PointerSensor, which would take
 * touch too and ignore the hold (plan decision D6).
 */
export function useLayoutSensors(coordinateGetter: KeyboardCoordinateGetter): SensorDescriptor<SensorOptions>[] {
  const keyboard = useMemo<KeyboardSensorOptions>(() => ({ coordinateGetter }), [coordinateGetter]);
  return useSensors(
    useSensor(MouseSensor, MOUSE_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor, keyboard),
  );
}

function moveKeyOf(code: string): MoveKey | null {
  switch (code) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End':
      return code;
    default:
      return null;
  }
}

const edgeOf = (key: MoveKey): 'first' | 'last' =>
  key === 'ArrowLeft' || key === 'ArrowUp' || key === 'Home' ? 'first' : 'last';

export interface RowCoordinateGetterArgs {
  /** The ids of the cards in order. */
  ids: () => readonly string[];
  cards: () => readonly CardItem[];
  breakpoint: () => Breakpoint;
  /** A key that has nowhere to go: the card is already first or last. */
  onEdge: (id: string, edge: 'first' | 'last') => void;
}

/**
 * Keyboard moves by the packed rows: `keyboardTarget` picks the card, the getter hands dnd-kit the place that puts the
 * dragged card's centre on that card's centre (dnd-kit reads the coordinates as the card's top left). It goes on from
 * the card the dragged one is over, so every key press is one step more. The arguments are read when a key is
 * pressed, so the getter outlives renders and breakpoints.
 */
export function rowCoordinateGetter({
  ids,
  cards,
  breakpoint,
  onEdge,
}: RowCoordinateGetterArgs): KeyboardCoordinateGetter {
  return (event, { active, context }) => {
    const key = moveKeyOf(event.code);
    if (key === null) return undefined;
    // Home and End would scroll the page, the arrows the grid: all of them belong to the card now
    event.preventDefault();
    const activeId = String(active);
    const order = ids();
    const over = context.over === null ? null : String(context.over.id);
    const from = order.indexOf(over !== null && order.includes(over) ? over : activeId);
    const to = keyboardTarget(cards(), breakpoint(), from, key);
    if (to === null) {
      onEdge(activeId, edgeOf(key));
      return undefined;
    }
    const target = context.droppableRects.get(order[to] ?? '');
    const own = context.droppableRects.get(activeId);
    if (target === undefined || own === undefined) return undefined;
    return {
      x: target.left + target.width / 2 - own.width / 2,
      y: target.top + target.height / 2 - own.height / 2,
    };
  };
}

/** Nothing shifts while dragging (preview parity): the drop line shows the place, and the card jumps on the drop. */
export const noShift: SortingStrategy = () => null;

/** Under reduced motion the card jumps; otherwise it settles in 150 ms. */
export function dropAnimationFor(reducedMotion: boolean): DropAnimation | null {
  return reducedMotion ? null : { duration: 150 };
}

/** dnd-kit's own live region stays silent; every word goes through the layout announcer (one polite region). */
export const SILENT_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

/** The id of a row gap, the drop target for the empty columns at the end of row `row` (0 based). */
export const GAP_PREFIX = 'gap:';
export const gapId = (row: number): string => `${GAP_PREFIX}${String(row)}`;

export interface DropPlace {
  /** The card (index in the list) the drop is over; for a row gap, the last card of that row. */
  over: number;
  /** Past that card rather than before it. */
  after: boolean;
  /** 0 based row of the gap, or null over a card. */
  gapRow: number | null;
  /** The index the dragged card takes, as `moveCard` reads it; null when it would not move. */
  index: number | null;
}

export interface DropPlaceArgs {
  ids: readonly string[];
  /** The id of the last card of row `row` (0 based), if there is such a row. */
  lastInRow: (row: number) => string | undefined;
  active: string;
  /** The id of what the drag is over: a card or a row gap. */
  over: string | null;
  after: boolean;
}

/** Where a drop would put the dragged card, or null when it is over nothing that takes a drop. */
export function dropPlaceOf({ ids, lastInRow, active, over, after }: DropPlaceArgs): DropPlace | null {
  const from = ids.indexOf(active);
  if (from === -1 || over === null) return null;
  const gapRow = over.startsWith(GAP_PREFIX) ? Number(over.slice(GAP_PREFIX.length)) : null;
  const lastId = gapRow === null ? undefined : lastInRow(gapRow);
  const overIndex = ids.indexOf(gapRow === null ? over : (lastId ?? ''));
  if (overIndex === -1) return null;
  // Over a gap the card goes after the last card of its row, whatever side the pointer is on
  const past = gapRow === null ? after : true;
  return { over: overIndex, after: past, gapRow, index: dropIndex(from, overIndex, past) };
}

/**
 * The index in the whole document for a place in the shown cards: the shown cards leave out the ones the person may
 * not see (no permission), but `moveCard` counts them. The card goes before the shown card that follows it.
 */
export function documentIndex(all: readonly CardItem[], shown: readonly CardItem[], id: string, index: number): number {
  const next = shown.filter((card) => card.id !== id)[index];
  const others = all.filter((card) => card.id !== id);
  return next === undefined ? others.length : others.findIndex((card) => card.id === next.id);
}

/** What a drop is made of: the order of the items, and where the rows end. */
export interface DragZone {
  ids: readonly string[];
  lastInRow: (row: number) => string | undefined;
}

export function cardZone(cards: readonly CardItem[], breakpoint: Breakpoint): DragZone {
  const rows = packRows(cards, breakpoint);
  return { ids: cards.map((card) => card.id), lastInRow: (row) => rows[row]?.at(-1)?.id };
}

interface Point {
  x: number;
  y: number;
}

const pointRect = ({ x, y }: Point): ClientRect => ({ top: y, left: x, width: 0, height: 0, right: x, bottom: y });

/**
 * What a drag is over. A keyboard drag is judged by the copy of the card, which the keyboard moves card by card. A
 * pointer drag is judged by the pointer: the card is taken by its handle at the top left, so its copy trails the
 * pointer by about half a card. The card the pointer is in; between cards, the one whose centre is nearest it. The
 * pointer goes along in the collision, for the side of the card it is on.
 */
export const layoutCollisions: CollisionDetection = (args) => {
  const { pointerCoordinates: pointer } = args;
  if (pointer === null) return closestCenter(args);
  const within = pointerWithin(args);
  const found = within.length > 0 ? within : closestCenter({ ...args, collisionRect: pointRect(pointer) });
  return found.map((collision) => ({ ...collision, data: { ...collision.data, pointer } }));
};

/** The pointer as `layoutCollisions` saw it, or null (a keyboard drag, or nothing was over). */
function pointerOf(collisions: DragOverEvent['collisions']): Point | null {
  const pointer: unknown = collisions?.[0]?.data?.pointer;
  if (typeof pointer !== 'object' || pointer === null || !('x' in pointer) || !('y' in pointer)) return null;
  const { x, y } = pointer;
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

type MoveEvent = Pick<DragOverEvent, 'activatorEvent' | 'active' | 'over' | 'collisions'>;

const byKeyboard = (event: Pick<MoveEvent, 'activatorEvent'>): boolean => event.activatorEvent instanceof KeyboardEvent;

/**
 * The place the drag is at. A keyboard drag goes past the card it is over when that card is later in the list; a
 * pointer drag when the pointer is right of the middle of the card it is over.
 */
export function placeOfEvent(event: MoveEvent, zone: DragZone): DropPlace | null {
  const active = String(event.active.id);
  const over = event.over === null ? null : String(event.over.id);
  let after: boolean;
  if (byKeyboard(event)) {
    after = over !== null && zone.ids.indexOf(over) > zone.ids.indexOf(active);
  } else {
    const pointer = pointerOf(event.collisions);
    after = pointer !== null && event.over !== null && pointer.x > event.over.rect.left + event.over.rect.width / 2;
  }
  return dropPlaceOf({ ids: zone.ids, lastInRow: zone.lastInRow, active, over, after });
}

/** The breakpoint the cards are packed for: a one column grid (drawers) is always the narrow one. */
export function useDragBreakpoint(columns: 'grid' | 'one' | undefined): Breakpoint {
  const measured = useBreakpoint();
  return columns === 'one' ? 'narrow' : measured;
}

export interface DragAnnouncements {
  onDragStart(event: DragStartEvent): void;
  onDragOver(event: DragOverEvent): void;
  onDragEnd(event: DragEndEvent): void;
  onDragCancel(event: DragCancelEvent): void;
}

/**
 * Every word of a drag, through the layout announcer. A keyboard drag says that the item is picked up and where each
 * key puts it; every drag says whether it was dropped, and where, or put back. A pointer drag says nothing on the
 * way: the person is looking at the line. `zone` names what is dragged: the cards of the page or its numbers (which
 * have no rows). A keyboard drag is never over a row gap (it goes card by card), so there is no word for one.
 */
export function useDragAnnouncements(
  zone: 'cards' | 'numbers',
  { columns }: { columns?: 'grid' | 'one' | undefined } = {},
): DragAnnouncements {
  const say = useLayoutAnnouncer();
  const { shownCards, document } = useLayoutScreen();
  const breakpoint = useDragBreakpoint(columns);
  const overSeen = useRef<string | null>(null);

  const view = useMemo(() => {
    if (zone === 'cards') {
      return {
        drag: cardZone(shownCards, breakpoint),
        nameOf: (id: string): string => {
          const card = shownCards.find((candidate) => candidate.id === id);
          return card === undefined ? id : cardName(card);
        },
        rowOfIndex: (index: number): number | null => rowOf(shownCards, breakpoint, index),
      };
    }
    const numbers = document.numbers ?? [];
    return {
      drag: { ids: numbers.map((item) => item.id), lastInRow: () => undefined },
      nameOf: (id: string): string => {
        const item = numbers.find((candidate) => candidate.id === id);
        if (item === undefined) return id;
        const label = numberType(item.metric)?.label ?? item.metric;
        return item.engine === undefined ? label : `${label}: ${engineLabel(item.engine)}`;
      },
      rowOfIndex: (): number | null => null,
    };
  }, [zone, shownCards, document.numbers, breakpoint]);

  return {
    onDragStart: (event) => {
      overSeen.current = null;
      if (byKeyboard(event)) say.pickedUp(view.nameOf(String(event.active.id)));
    },
    onDragOver: (event) => {
      const active = String(event.active.id);
      const over = event.over === null ? null : String(event.over.id);
      const previous = overSeen.current;
      overSeen.current = over;
      // The first answer is the card over itself, right after the pick up: that must stay the last word
      if (!byKeyboard(event) || (previous === null && over === active)) return;
      const place = placeOfEvent(event, view.drag);
      if (place === null) return;
      const card = view.nameOf(active);
      const position = (place.index ?? view.drag.ids.indexOf(active)) + 1;
      const total = view.drag.ids.length;
      const row = view.rowOfIndex(place.over);
      if (row === null) say.moved({ card, position, total });
      else say.over({ card, position, total, row });
    },
    onDragEnd: (event) => {
      overSeen.current = null;
      const card = view.nameOf(String(event.active.id));
      const place = placeOfEvent(event, view.drag);
      if (place === null || place.index === null) say.putBack(card);
      else say.dropped({ card, position: place.index + 1, total: view.drag.ids.length });
    },
    onDragCancel: (event) => {
      overSeen.current = null;
      say.putBack(view.nameOf(String(event.active.id)));
    },
  };
}
