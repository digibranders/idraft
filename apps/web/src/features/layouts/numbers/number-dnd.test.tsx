// @vitest-environment jsdom
import type {
  Active,
  ClientRect,
  DragEndEvent,
  DragOverEvent,
  DroppableContainer,
  Over,
  SensorContext,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { numberCoordinateGetter, useNumberAnnouncements } from './number-dnd';
import type { DragAnnouncements } from '../dnd';
import type { NumberItem } from '@/lib/layouts';
import { renderWithProviders } from '@/test/render';

const NUMBERS: readonly NumberItem[] = [
  { id: 'visibility', metric: 'seo.visibility_volume' },
  { id: 'top10', metric: 'seo.top10_count' },
  { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
  { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
];
const IDS = NUMBERS.map((number) => number.id);

/** Cell `index` is a 90 by 60 box at 100 px per step; the geometry is not the layout, only a place to point at. */
function rectOf(index: number): ClientRect {
  const left = index * 100;
  return { left, top: 0, width: 90, height: 60, right: left + 90, bottom: 60 };
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

function setup(): {
  press: (code: string, active: string, over?: string | null) => { to: unknown; prevented: boolean };
  edges: Edge[];
} {
  const edges: Edge[] = [];
  const getter = numberCoordinateGetter({ ids: () => IDS, onEdge: (id, edge) => edges.push({ id, edge }) });
  return {
    edges,
    press: (code, active, over = active) => {
      const event = new KeyboardEvent('keydown', { code, cancelable: true });
      const to = getter(event, { active, currentCoordinates: { x: 0, y: 0 }, context: contextOf(over) });
      return { to, prevented: event.defaultPrevented };
    },
  };
}

/** Where the dragged cell's top left must go so that its centre sits on the centre of cell `target`. */
function landing(active: number, target: number): { x: number; y: number } {
  const own = rectOf(active);
  const place = rectOf(target);
  return { x: place.left + place.width / 2 - own.width / 2, y: place.top + place.height / 2 - own.height / 2 };
}

describe('numberCoordinateGetter', () => {
  it('goes to the centre of the previous cell on Left and Up, and of the next cell on Right and Down', () => {
    const { press } = setup();
    expect(press('ArrowLeft', 'top10').to).toEqual(landing(1, 0));
    expect(press('ArrowUp', 'top10').to).toEqual(landing(1, 0));
    expect(press('ArrowRight', 'top10').to).toEqual(landing(1, 2));
    expect(press('ArrowDown', 'top10').to).toEqual(landing(1, 2));
  });

  it('goes on from the cell it is over, not from the one picked up', () => {
    expect(setup().press('ArrowRight', 'visibility', 'top10').to).toEqual(landing(0, 2));
  });

  it('goes to the ends on Home and End', () => {
    const { press } = setup();
    expect(press('Home', 'mention-gemini').to).toEqual(landing(2, 0));
    expect(press('End', 'top10').to).toEqual(landing(1, 3));
  });

  it('keeps the keys it uses from scrolling the page, and leaves every other key alone', () => {
    const { press } = setup();
    expect(press('ArrowRight', 'top10').prevented).toBe(true);
    expect(press('Home', 'top10').prevented).toBe(true);
    expect(press('Tab', 'top10')).toEqual({ to: undefined, prevented: false });
  });

  it('says a number is already first or last when the key has nowhere to go', () => {
    const { press, edges } = setup();
    expect(press('ArrowLeft', 'visibility').to).toBeUndefined();
    expect(press('Home', 'visibility').to).toBeUndefined();
    expect(press('ArrowRight', 'mention-chatgpt').to).toBeUndefined();
    expect(press('End', 'mention-chatgpt').to).toBeUndefined();
    expect(edges).toEqual([
      { id: 'visibility', edge: 'first' },
      { id: 'visibility', edge: 'first' },
      { id: 'mention-chatgpt', edge: 'last' },
      { id: 'mention-chatgpt', edge: 'last' },
    ]);
  });
});

describe('useNumberAnnouncements', () => {
  let handlers: DragAnnouncements | null = null;
  function Probe(): null {
    const value = useNumberAnnouncements(NUMBERS);
    useEffect(() => {
      handlers = value;
    }, [value]);
    return null;
  }
  const current = (): DragAnnouncements => {
    if (handlers === null) throw new Error('the probe has not rendered');
    return handlers;
  };
  const polite = (): string => document.getElementById('live-region-polite')?.textContent ?? '';
  const activeOf = (id: string): Active => ({
    id,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  });
  const overOf = (id: string): Over => ({
    id,
    rect: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 },
    disabled: false,
    data: { current: undefined },
  });
  const keyboard = new KeyboardEvent('keydown', { code: 'ArrowRight' });
  const moveOf = (active: string, over: string): DragOverEvent & DragEndEvent => ({
    activatorEvent: keyboard,
    active: activeOf(active),
    over: overOf(over),
    collisions: null,
    delta: { x: 0, y: 0 },
  });

  it('names a number as the page names it, gives its place without a row, and says dropped or put back', async () => {
    renderWithProviders(<Probe />);
    act(() => {
      current().onDragStart({ activatorEvent: keyboard, active: activeOf('top10') });
    });
    await waitFor(() => {
      expect(polite()).toBe('Top 10 picked up. Use the arrow keys to move, Space to drop, Escape to put it back.');
    });
    act(() => {
      current().onDragOver(moveOf('top10', 'mention-chatgpt'));
    });
    await waitFor(() => {
      expect(polite()).toBe('Top 10, position 4 of 4');
    });
    act(() => {
      current().onDragEnd(moveOf('top10', 'mention-chatgpt'));
    });
    await waitFor(() => {
      expect(polite()).toBe('Top 10 dropped at position 4 of 4');
    });
    // an AI number carries its engine without a colon, as the Move menu and a removal say it
    act(() => {
      current().onDragCancel({ ...moveOf('mention-gemini', 'top10'), over: null });
    });
    await waitFor(() => {
      expect(polite()).toBe('Mention rate Gemini put back');
    });
  });
});
