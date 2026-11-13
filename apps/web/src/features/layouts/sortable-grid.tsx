'use client';

/**
 * The cells of the customize grid, arranged by dragging (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md,
 * section 2.8): by mouse, by finger after a hold and by keyboard, all from the handle. Nothing shifts while a card is
 * dragged; a line shows where it would land, and a copy of its header follows the pointer. Who says what: dnd-kit's
 * own live region is silent; `useDragAnnouncements` says the pick up, the places and the drop or the put back; the
 * Move menu is `moveCard`'s own `moved`. A drop calls `moveCard` first, whose `moved` the drop's `dropped` replaces
 * in the same task, so a screen reader hears the drop once.
 */
import {
  DndContext,
  DragOverlay,
  useDroppable,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { useLayoutAnnouncer } from './announcements';
import { CardFrame } from './card-frame';
import { CardTools } from './card-toolbar';
import {
  SILENT_ANNOUNCEMENTS,
  cardZone,
  documentIndex,
  dropAnimationFor,
  gapId,
  layoutCollisions,
  noShift,
  placeOfEvent,
  rowCoordinateGetter,
  useDragAnnouncements,
  useDragBreakpoint,
  useLayoutSensors,
  type DropPlace,
} from './dnd';
import { DragHandle } from './drag-handle';
import { DropLine, columnGapOf, lineRect, sameLine, type LineRect } from './drop-line';
import { useLayoutScreen } from './layout-provider';
import { ResizeGrip } from './resize-grip';
import { Icon } from '@/components/ui/icon';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { cardName, packRows, type CardItem } from '@/lib/layouts';
import { cn } from '@/lib/utils';

export interface SortableGridProps {
  /** The cards to arrange, in order. */
  cards: readonly CardItem[];
  /** One card's body (the registered component, its skeleton or its reason): the frame wraps it. */
  renderBody: (item: CardItem) => ReactNode;
  /** Why a card cannot show, or undefined: the frame's `notice`, outside the inert body. */
  renderNotice: (item: CardItem) => ReactNode;
  /** The grid span of one card's cell. */
  cellClass: (item: CardItem) => string;
  /** `one`: one column (drawers): no row gaps, and the arrow keys go to the previous and the next card. */
  columns?: 'grid' | 'one' | undefined;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const COLUMNS = 12;
/** The CSS value that turns dnd-kit's glide off. */
const NO_TRANSITION = 'none';

/** Every span a row gap can have (full class names, so the stylesheet has them). */
const GAP_SPAN: Readonly<Record<number, string>> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
  5: 'col-span-5',
  6: 'col-span-6',
  7: 'col-span-7',
  8: 'col-span-8',
  9: 'col-span-9',
  10: 'col-span-10',
  11: 'col-span-11',
};

interface ActiveDrag {
  id: string;
  /** How it was picked up: a keyboard pick up shows a ring, a pointer drag dims the card. */
  by: 'keyboard' | 'pointer';
}

interface SortableCardProps {
  item: CardItem;
  className: string;
  notice: ReactNode;
  dragState: 'idle' | 'dragging' | 'picked';
  /** Tells the grid which element is the card, for the drop line. */
  register: (id: string, node: HTMLElement | null) => void;
  children: ReactNode;
}

function SortableCard({ item, className, notice, dragState, register, children }: SortableCardProps): ReactElement {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useSortable({ id: item.id });
  // transform and transition are not used: nothing shifts, so there is nothing to animate
  const ref = useCallback(
    (node: HTMLDivElement | null): void => {
      setNodeRef(node);
      register(item.id, node);
    },
    [setNodeRef, register, item.id],
  );
  return (
    <CardFrame
      ref={ref}
      item={item}
      className={className}
      notice={notice}
      dragState={dragState}
      handle={
        <DragHandle
          item={item}
          attributes={attributes}
          listeners={listeners}
          setActivatorNodeRef={setActivatorNodeRef}
          dragState={dragState}
        />
      }
      tools={<CardTools item={item} />}
      edge={<ResizeGrip item={item} />}
    >
      {children}
    </CardFrame>
  );
}

/** The free columns of a row that is not the last: a place a pointer can drop a card, the line shows where it goes. */
function RowGap({ row, span }: { row: number; span: number }): ReactElement {
  const { setNodeRef } = useDroppable({ id: gapId(row) });
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-layout-gap={row}
      className={cn('rounded-lg border border-dashed border-border-strong', GAP_SPAN[span])}
    />
  );
}

/**
 * What follows the pointer: the card's header, not its content (so nothing re-renders or queries). dnd-kit measures
 * the first element in the overlay and takes that for the dragged card when it looks for what it is over, so that
 * element is as big as the card (the wrapper has its size) and only the header in it is drawn.
 */
function OverlayCopy({ item }: { item: CardItem }): ReactElement {
  return (
    <div data-slot="layout-drag-overlay" aria-hidden="true" className="h-full">
      <div
        data-slot="layout-drag-copy"
        className="flex h-control-sm items-center gap-2 rounded-lg bg-surface px-2 type-body-strong text-foreground shadow-drag"
      >
        <Icon icon={GripVertical} size="sm" />
        <span className="truncate">{cardName(item)}</span>
      </div>
    </div>
  );
}

/** The cells of the customize grid; the grid's own element is the parent. */
export function SortableGrid({ cards, renderBody, renderNotice, cellClass, columns }: SortableGridProps): ReactElement {
  const t = useTranslations('layouts.core');
  const { actions, document } = useLayoutScreen();
  const breakpoint = useDragBreakpoint(columns);
  const reduced = useMediaQuery(REDUCED_MOTION);
  const say = useLayoutAnnouncer();
  const announcements = useDragAnnouncements('cards', { columns });
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [line, setLine] = useState<LineRect | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  // Escape while a card is held is the drag's: dnd-kit's own listener comes after the page's shortcuts (it is added
  // when the card is picked up), so the key is marked as handled first and a shortcut that leaves the mode skips it
  const holding = active !== null;
  useEffect(() => {
    if (!holding) return undefined;
    const claim = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') event.preventDefault();
    };
    // capture, and no stopPropagation: dnd-kit still has to see the key to put the card back
    window.addEventListener('keydown', claim, true);
    return () => {
      window.removeEventListener('keydown', claim, true);
    };
  }, [holding]);

  const ids = useMemo(() => cards.map((card) => card.id), [cards]);
  const zone = useMemo(() => cardZone(cards, breakpoint), [cards, breakpoint]);
  const rows = useMemo(() => packRows(cards, breakpoint), [cards, breakpoint]);

  // Nothing in the grid changes while a card is held (a resize cancels the drag), so what the getter was made with is
  // what is current when a key is pressed
  const getter = useMemo(
    () =>
      rowCoordinateGetter({
        ids: () => ids,
        cards: () => cards,
        breakpoint: () => breakpoint,
        onEdge: (id, edge) => {
          const card = cards.find((candidate) => candidate.id === id);
          const name = card === undefined ? id : cardName(card);
          if (edge === 'first') say.first(name);
          else say.last(name);
        },
      }),
    [ids, cards, breakpoint, say],
  );
  const sensors = useLayoutSensors(getter);
  const accessibility = useMemo(
    () => ({ announcements: SILENT_ANNOUNCEMENTS, screenReaderInstructions: { draggable: t('reorderHelp') } }),
    [t],
  );

  const register = useCallback((id: string, node: HTMLElement | null): void => {
    if (node === null) nodes.current.delete(id);
    else nodes.current.set(id, node);
  }, []);

  /** The line for a place: next to the card it is over, in the grid's own pixels. */
  const lineFor = (place: DropPlace | null): LineRect | null => {
    const target = place === null || place.index === null ? undefined : cards[place.over];
    const node = target === undefined ? undefined : nodes.current.get(target.id);
    const grid = node?.parentElement;
    if (place === null || node === undefined || grid === null || grid === undefined) return null;
    return lineRect({
      target: node.getBoundingClientRect(),
      grid: grid.getBoundingClientRect(),
      gap: columnGapOf(grid),
      after: place.after,
    });
  };

  const handleStart = (event: DragStartEvent): void => {
    setActive({
      id: String(event.active.id),
      by: event.activatorEvent instanceof KeyboardEvent ? 'keyboard' : 'pointer',
    });
    announcements.onDragStart(event);
  };
  /** Draws the line for the place the drag is at; nothing is set when it is where it was. */
  const showLine = (event: DragMoveEvent): void => {
    const next = lineFor(placeOfEvent(event, zone));
    setLine((previous) => (sameLine(previous, next) ? previous : next));
  };
  const handleOver = (event: DragOverEvent): void => {
    announcements.onDragOver(event);
    showLine(event);
  };
  // dnd-kit says "over" only when the card under the drag changes: the side of a card it is over changes on a move
  const handleMove = (event: DragMoveEvent): void => {
    showLine(event);
  };
  const handleEnd = (event: DragEndEvent): void => {
    const place = placeOfEvent(event, zone);
    const id = String(event.active.id);
    if (place !== null && place.index !== null) {
      actions.moveCard(id, documentIndex(document.cards ?? [], cards, id, place.index));
    }
    announcements.onDragEnd(event);
    setActive(null);
    setLine(null);
  };
  const handleCancel = (event: DragCancelEvent): void => {
    announcements.onDragCancel(event);
    setActive(null);
    setLine(null);
  };

  const dragged = active === null ? undefined : cards.find((card) => card.id === active.id);
  const cells = rows.flatMap((row, index) => {
    const free = COLUMNS - row.reduce((sum, placed) => sum + placed.span, 0);
    const cellsOfRow = row.flatMap((placed) => {
      const item = cards.find((card) => card.id === placed.id);
      if (item === undefined) return [];
      const dragState = active?.id !== item.id ? 'idle' : active.by === 'keyboard' ? 'picked' : 'dragging';
      return [
        <SortableCard
          key={item.id}
          item={item}
          className={cellClass(item)}
          notice={renderNotice(item)}
          dragState={dragState}
          register={register}
        >
          {renderBody(item)}
        </SortableCard>,
      ];
    });
    // The last row's free space is the Add card slot; one column has no free space
    return columns !== 'one' && index < rows.length - 1 && free > 0
      ? [...cellsOfRow, <RowGap key={gapId(index)} row={index} span={free} />]
      : cellsOfRow;
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={layoutCollisions}
      accessibility={accessibility}
      autoScroll
      onDragStart={handleStart}
      onDragMove={handleMove}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={handleCancel}
    >
      <SortableContext items={ids} strategy={noShift}>
        {cells}
      </SortableContext>
      <DropLine line={line} />
      {/* dnd-kit glides a keyboard drag by default (transform 250ms): under reduced motion the copy jumps */}
      <DragOverlay dropAnimation={dropAnimationFor(reduced)} {...(reduced ? { transition: NO_TRANSITION } : {})}>
        {dragged === undefined ? null : <OverlayCopy item={dragged} />}
      </DragOverlay>
    </DndContext>
  );
}
