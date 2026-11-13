'use client';

/**
 * Drag and drop for the number strip: how the keyboard goes through the cells, and what is said about it. The
 * sensors, the collisions and the drop place are the cards' own (`../dnd`); a strip has no packed rows, so a key
 * goes one cell or to an end and every drop place is a cell.
 */
import type { KeyboardCoordinateGetter } from '@dnd-kit/core';
import { useRef } from 'react';

import { useLayoutAnnouncer } from '../announcements';
import { placeOfEvent, type DragAnnouncements, type DragZone } from '../dnd';
import { numberName, type NumberItem } from '@/lib/layouts';

interface Key {
  /** The index the key goes to from index `from` of `last + 1` cells. */
  to: (from: number, last: number) => number;
  /** The end a key that cannot go anywhere is stopped by. */
  edge: 'first' | 'last';
}

const PREVIOUS: Key = { to: (from) => from - 1, edge: 'first' };
const NEXT: Key = { to: (from) => from + 1, edge: 'last' };
const KEYS: Readonly<Record<string, Key>> = {
  ArrowLeft: PREVIOUS,
  ArrowUp: PREVIOUS,
  ArrowRight: NEXT,
  ArrowDown: NEXT,
  Home: { to: () => 0, edge: 'first' },
  End: { to: (_from, last) => last, edge: 'last' },
};

export interface NumberCoordinateGetterArgs {
  /** The ids of the numbers in order, read when a key is pressed. */
  ids: () => readonly string[];
  /** A key that has nowhere to go: the number is already first or last. */
  onEdge: (id: string, edge: 'first' | 'last') => void;
}

/**
 * Keyboard moves by cell: Left and Up go to the previous one, Right and Down to the next, Home and End to the ends.
 * dnd-kit reads the coordinates as the dragged cell's top left, so the answer puts its centre on the centre of the
 * cell the key points at. It goes on from the cell the dragged one is over, so every press is one step more.
 */
export function numberCoordinateGetter({ ids, onEdge }: NumberCoordinateGetterArgs): KeyboardCoordinateGetter {
  return (event, { active, context }) => {
    const key = Object.hasOwn(KEYS, event.code) ? KEYS[event.code] : undefined;
    if (key === undefined) return undefined;
    // Home and End would scroll the page, the arrows the strip: all of them belong to the number now
    event.preventDefault();
    const activeId = String(active);
    const order = ids();
    const over = context.over === null ? null : String(context.over.id);
    const from = order.indexOf(over !== null && order.includes(over) ? over : activeId);
    const to = key.to(from, order.length - 1);
    if (to < 0 || to >= order.length || to === from) {
      onEdge(activeId, key.edge);
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

/**
 * Every word of a number drag, through the layout announcer, with the names the page gives a number ("Mention rate
 * Gemini"): picked up and the place of each key press for a keyboard drag; dropped or put back for every drag.
 * A pointer drag says nothing on the way: the person is looking at the line.
 */
export function useNumberAnnouncements(numbers: readonly NumberItem[]): DragAnnouncements {
  const say = useLayoutAnnouncer();
  const overSeen = useRef<string | null>(null);
  const zone: DragZone = { ids: numbers.map((item) => item.id), lastInRow: () => undefined };
  const nameOf = (id: string): string => {
    const item = numbers.find((candidate) => candidate.id === id);
    return item === undefined ? id : numberName(item);
  };
  const byKeyboard = (event: { activatorEvent: Event | null }): boolean =>
    event.activatorEvent instanceof KeyboardEvent;

  return {
    onDragStart: (event) => {
      overSeen.current = null;
      if (byKeyboard(event)) say.pickedUp(nameOf(String(event.active.id)));
    },
    onDragOver: (event) => {
      const active = String(event.active.id);
      const over = event.over === null ? null : String(event.over.id);
      const previous = overSeen.current;
      overSeen.current = over;
      // The first answer is the number over itself, right after the pick up: that must stay the last word
      if (!byKeyboard(event) || (previous === null && over === active)) return;
      const place = placeOfEvent(event, zone);
      if (place === null) return;
      say.moved({
        card: nameOf(active),
        position: (place.index ?? zone.ids.indexOf(active)) + 1,
        total: zone.ids.length,
      });
    },
    onDragEnd: (event) => {
      overSeen.current = null;
      const card = nameOf(String(event.active.id));
      const place = placeOfEvent(event, zone);
      if (place === null || place.index === null) say.putBack(card);
      else say.dropped({ card, position: place.index + 1, total: zone.ids.length });
    },
    onDragCancel: (event) => {
      overSeen.current = null;
      say.putBack(nameOf(String(event.active.id)));
    },
  };
}
