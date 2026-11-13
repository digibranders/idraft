'use client';

/**
 * The headline numbers of a screen (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, T3, spec 5.3).
 * View mode is the page's `MetricStrip`, one group for each run of the same channel, with each number a link. Customize
 * mode is the same cells in a grid of their own, each under its controls, arranged by dragging, by keyboard and by
 * the Move menu. The page gives the values; this part gives the layout.
 */
import { DndContext, DragOverlay, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { useLayoutAnnouncer } from '../announcements';
import {
  SILENT_ANNOUNCEMENTS,
  dropAnimationFor,
  layoutCollisions,
  noShift,
  placeOfEvent,
  useLayoutSensors,
  type DragZone,
  type DropPlace,
} from '../dnd';
import { DropLine, columnGapOf, lineRect, sameLine, type LineRect } from '../drop-line';
import { useLayoutScreen } from '../layout-provider';
import { numberCoordinateGetter, useNumberAnnouncements } from './number-dnd';
import {
  NumberCell,
  NumberOverlayCopy,
  engineOf,
  metricLabelOf,
  type NumberDragState,
  type NumberValue,
} from './number-cell';
import {
  MetricStrip,
  type MetricStripGroup,
  type MetricStripItem,
  type MetricStripProps,
} from '@/components/app/metric/metric-strip';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { LIMITS, numberName, numberType, type NumberItem } from '@/lib/layouts';
import { cn } from '@/lib/utils';

export type { NumberValue } from './number-cell';

export interface NumberStripProps {
  /** Names the strip: "Overview numbers". */
  label: string;
  /** What the page shows for each number of the layout; called for every number on every render. */
  valueOf: (item: NumberItem) => NumberValue;
  status: MetricStripProps['status'];
  /** Customize mode: the Add number slot, a whole cell, drawn after the last number while there is room for one. */
  renderAddSlot?: (() => ReactNode) | undefined;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** The CSS value that turns dnd-kit's glide off. */
const NO_TRANSITION = 'none';
// Columns of the customize grid by what the strip's own width allows (the preview's rule): two, then three from 576 px,
// then one row of up to six from 1024 px. Whole class names, so the stylesheet has them; COLUMNS_WIDE has one entry
// for each of the `LIMITS.numbers` (6) cells a strip can have, the Add number slot included.
const COLUMNS_MID = ['', '@xl:grid-cols-1', '@xl:grid-cols-2', '@xl:grid-cols-3'] as const;
const COLUMNS_WIDE = [
  '',
  '@5xl:grid-cols-1',
  '@5xl:grid-cols-2',
  '@5xl:grid-cols-3',
  '@5xl:grid-cols-4',
  '@5xl:grid-cols-5',
  '@5xl:grid-cols-6',
] as const;

const channelOf = (item: NumberItem): string => numberType(item.metric)?.channel ?? 'seo';

/** One group for each run of the same channel, so the stronger divider falls wherever SEO and AI numbers meet. */
function groupsOf(numbers: readonly NumberItem[], valueOf: NumberStripProps['valueOf']): MetricStripGroup[] {
  const runs: Array<{ id: string; channel: string; items: MetricStripItem[] }> = [];
  for (const item of numbers) {
    const entry: MetricStripItem = {
      ...valueOf(item),
      id: item.id,
      label: metricLabelOf(item),
      labelAddon: engineOf(item),
    };
    const channel = channelOf(item);
    const last = runs.at(-1);
    if (last?.channel === channel) last.items.push(entry);
    else runs.push({ id: `${channel}:${item.id}`, channel, items: [entry] });
  }
  return runs;
}

/** Moves focus where the provider asked (after a remove, a move, an add), then says it was done. */
function useNumberFocusRequests(root: RefObject<HTMLElement | null>): void {
  const { focus, actions } = useLayoutScreen();
  const reduced = useMediaQuery(REDUCED_MOTION);
  useEffect(() => {
    // A request without a zone is the card grid's
    if (focus?.zone !== 'numbers' || root.current === null) return;
    const scope = root.current;
    const cell = [...scope.querySelectorAll<HTMLElement>('[data-layout-number]')].find(
      (candidate) => candidate.dataset.layoutNumber === focus.id,
    );
    const target =
      focus.id === null
        ? scope.querySelector<HTMLElement>('[data-add-number-slot]')
        : (cell?.querySelector<HTMLElement>(`[data-part="${focus.part}"]`) ??
          cell?.querySelector<HTMLElement>('[data-part="handle"]'));
    // focus() would scroll too; scrolling once, as the person's motion setting says, is the point
    target?.focus({ preventScroll: true });
    // Not every environment has it (jsdom): focus has happened either way
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    actions.focused();
  }, [focus, reduced, actions, root]);
}

interface ActiveDrag {
  id: string;
  /** How it was picked up: a keyboard pick up shows a ring, a pointer drag dims the cell. */
  by: 'keyboard' | 'pointer';
}

function CustomizeStrip({ label, valueOf, status, renderAddSlot }: NumberStripProps): ReactElement | null {
  const { actions, document } = useLayoutScreen();
  const say = useLayoutAnnouncer();
  const tCore = useTranslations('layouts.core');
  const reduced = useMediaQuery(REDUCED_MOTION);
  const numbers = useMemo(() => document.numbers ?? [], [document.numbers]);
  const announcements = useNumberAnnouncements(numbers);
  const root = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [line, setLine] = useState<LineRect | null>(null);
  useNumberFocusRequests(root);

  // Escape while a number is held is the drag's: dnd-kit's own listener comes after the page's shortcuts (it is added
  // when the number is picked up), so the key is marked as handled first and a shortcut that leaves the mode skips it
  const holding = active !== null;
  useEffect(() => {
    if (!holding) return undefined;
    const claim = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') event.preventDefault();
    };
    // capture, and no stopPropagation: dnd-kit still has to see the key to put the number back
    window.addEventListener('keydown', claim, true);
    return () => {
      window.removeEventListener('keydown', claim, true);
    };
  }, [holding]);

  const ids = useMemo(() => numbers.map((item) => item.id), [numbers]);
  const zone = useMemo<DragZone>(() => ({ ids, lastInRow: () => undefined }), [ids]);
  // Nothing in the strip changes while a number is held, so what the getter was made with is what is current
  const getter = useMemo(
    () =>
      numberCoordinateGetter({
        ids: () => ids,
        onEdge: (id, edge) => {
          const item = numbers.find((candidate) => candidate.id === id);
          const name = item === undefined ? id : numberName(item);
          if (edge === 'first') say.first(name);
          else say.last(name);
        },
      }),
    [ids, numbers, say],
  );
  const sensors = useLayoutSensors(getter);
  const accessibility = useMemo(
    () => ({ announcements: SILENT_ANNOUNCEMENTS, screenReaderInstructions: { draggable: tCore('reorderHelp') } }),
    [tCore],
  );

  const register = useCallback((id: string, node: HTMLElement | null): void => {
    if (node === null) nodes.current.delete(id);
    else nodes.current.set(id, node);
  }, []);

  /** The line for a place: next to the cell it is over, in the grid's own pixels. */
  const lineFor = (place: DropPlace | null): LineRect | null => {
    const target = place === null || place.index === null ? undefined : numbers[place.over];
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
  const showLine = (event: DragMoveEvent): void => {
    const next = lineFor(placeOfEvent(event, zone));
    setLine((previous) => (sameLine(previous, next) ? previous : next));
  };
  const handleStart = (event: DragStartEvent): void => {
    setActive({
      id: String(event.active.id),
      by: event.activatorEvent instanceof KeyboardEvent ? 'keyboard' : 'pointer',
    });
    announcements.onDragStart(event);
  };
  const handleEnd = (event: DragEndEvent): void => {
    const place = placeOfEvent(event, zone);
    if (place !== null && place.index !== null) actions.moveNumber(String(event.active.id), place.index);
    announcements.onDragEnd(event);
    setActive(null);
    setLine(null);
  };

  const showSlot = renderAddSlot !== undefined && numbers.length < LIMITS.numbers;
  const count = numbers.length + (showSlot ? 1 : 0);
  if (count === 0) return null;
  const dragged = active === null ? undefined : numbers.find((item) => item.id === active.id);
  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      aria-busy={status === 'ready' ? undefined : true}
      // The strip's own width, not the window's, decides the columns
      className="@container"
    >
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {/* `relative`: the drop line is placed in the grid. The cells' right and bottom borders overflow the panel by one pixel */}
        <div
          className={cn(
            'relative -mr-px -mb-px grid',
            count === 1 ? 'grid-cols-1' : 'grid-cols-2',
            COLUMNS_MID[Math.min(count, 3)],
            COLUMNS_WIDE[count],
          )}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={layoutCollisions}
            accessibility={accessibility}
            autoScroll
            onDragStart={handleStart}
            onDragMove={showLine}
            onDragOver={(event) => {
              announcements.onDragOver(event);
              showLine(event);
            }}
            onDragEnd={handleEnd}
            onDragCancel={(event) => {
              announcements.onDragCancel(event);
              setActive(null);
              setLine(null);
            }}
          >
            <SortableContext items={ids} strategy={noShift}>
              {numbers.map((item, index) => {
                const dragState: NumberDragState =
                  active?.id !== item.id ? 'idle' : active.by === 'keyboard' ? 'picked' : 'dragging';
                return (
                  <NumberCell
                    key={item.id}
                    item={item}
                    previous={numbers[index - 1]}
                    value={valueOf(item)}
                    status={status}
                    dragState={dragState}
                    register={register}
                  />
                );
              })}
            </SortableContext>
            <DropLine line={line} />
            {/* dnd-kit glides a keyboard drag by default (transform 250ms): under reduced motion the copy jumps */}
            <DragOverlay dropAnimation={dropAnimationFor(reduced)} {...(reduced ? { transition: NO_TRANSITION } : {})}>
              {dragged === undefined ? null : <NumberOverlayCopy item={dragged} />}
            </DragOverlay>
          </DndContext>
          {showSlot ? renderAddSlot() : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The headline numbers of the screen's layout. A strip with no numbers is not drawn in view mode (spec 5.3); in
 * customize mode the Add number slot keeps it.
 */
export function NumberStrip(props: NumberStripProps): ReactElement | null {
  const { mode, document, status } = useLayoutScreen();
  if (mode === 'customize') return <CustomizeStrip {...props} />;
  const numbers = document.numbers ?? [];
  if (numbers.length === 0) return null;
  // Until the layout is read the numbers are the built-in ones, so their values are drawn as loading, as the cards are
  return (
    <MetricStrip
      size="md"
      label={props.label}
      groups={groupsOf(numbers, props.valueOf)}
      status={status === 'loading' ? 'loading' : props.status}
    />
  );
}
