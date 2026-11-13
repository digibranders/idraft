'use client';

/**
 * The snapping resize grip (owner decision D-14, docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md): a pointer
 * alternative to the Width select, on the right edge of a card. The card only ever takes a width it is allowed, so the
 * pointer picks the nearest one (`snapWidth`) and a dashed outline shows it before the pointer is lifted. It is for the
 * pointer alone, so it is hidden from assistive technology and has no tab stop: the Width select and the Move menu are
 * the keyboard ways (WCAG 2.5.7). The provider says the change, so nothing is announced here. Shortcut: left to right
 * text only (the grip is on the right edge).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';

import { columnGapOf } from './drop-line';
import { useLayoutScreen } from './layout-provider';
import { useBreakpoint } from './use-breakpoint';
import { Tooltip } from '@/components/ui/tooltip';
import { cardType, distinctSpans, snapWidth, spanOf, type Breakpoint, type CardItem, type Width } from '@/lib/layouts';

export interface ResizeGripProps {
  item: CardItem;
}

const COLUMNS = 12;

/** The `layouts.core.widths` key of each width. */
const WIDTH_KEY = { third: 'third', half: 'half', two_thirds: 'twoThirds', full: 'full' } as const satisfies Record<
  Width,
  string
>;

/** What one press measured: the grid is read once, when the pointer goes down. */
interface Session {
  pointerId: number;
  /** Where the pointer was, and how wide the card was, at the press. */
  startX: number;
  startWidth: number;
  /** One column and one gap of the page grid, in pixels. */
  column: number;
  gap: number;
  /** From the card's left edge to the grid's right edge: the outline never goes past it. */
  room: number;
}

/** What the outline shows: the width the pointer would give, and its size in the grid's pixels. */
interface Preview {
  width: Width;
  px: number;
}

interface GripProps extends ResizeGripProps {
  widths: readonly Width[];
  breakpoint: Breakpoint;
}

/** The outline's width for `columns`: as wide as they are, and no wider than the grid has room for. */
const pixelsOf = (columns: number, { column, gap, room }: Session): number =>
  Math.min(columns * column + (columns - 1) * gap, room);

function Grip({ item, widths, breakpoint }: GripProps): ReactElement {
  const t = useTranslations('layouts.core');
  const { actions } = useLayoutScreen();
  const grip = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hovered, setHovered] = useState(false);
  const current = item.width ?? 'full';
  const dragging = preview !== null;

  // The frame is the grip's parent. Its CSS cannot be asked "is the frame hovered" from here, so the grip listens.
  useEffect(() => {
    const frame = grip.current?.parentElement;
    if (frame === null || frame === undefined) return undefined;
    const enter = (): void => {
      setHovered(true);
    };
    // The pointer may already be over the card when the grip mounts (customize mode begins, the window changes size)
    setHovered(frame.matches(':hover'));
    const leave = (): void => {
      setHovered(false);
    };
    frame.addEventListener('pointerenter', enter);
    frame.addEventListener('pointerleave', leave);
    return () => {
      frame.removeEventListener('pointerenter', enter);
      frame.removeEventListener('pointerleave', leave);
    };
  }, []);

  /** Ends the press without a change (the release path reads what it needs before it calls this). */
  const stop = useCallback((): void => {
    const pressed = session.current;
    session.current = null;
    setPreview(null);
    const node = grip.current;
    if (pressed !== null && node?.hasPointerCapture(pressed.pointerId) === true) {
      node.releasePointerCapture(pressed.pointerId);
    }
  }, []);

  // Escape puts the card back; it is this gesture's, so nothing else (leaving customize mode) takes it as well
  useEffect(() => {
    if (!dragging) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [dragging, stop]);

  /** The width the pointer gives at `x`. The same columns as the card already has keep its own name (`full` is not `two_thirds`). */
  const widthAt = (pressed: Session, x: number): Width => {
    const columns = (pressed.startWidth + x - pressed.startX + pressed.gap) / (pressed.column + pressed.gap);
    const snapped = snapWidth(widths, breakpoint, columns);
    return spanOf(snapped, breakpoint) === spanOf(current, breakpoint) ? current : snapped;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    // Not a card drag: nothing above the grip (the handle's sensors, the frame) hears this press
    event.stopPropagation();
    event.preventDefault();
    const frame = event.currentTarget.parentElement;
    const grid = frame?.parentElement;
    if (frame === null || frame === undefined || grid === null || grid === undefined) return;
    const gap = columnGapOf(grid);
    const gridBox = grid.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const column = (gridBox.width - (COLUMNS - 1) * gap) / COLUMNS;
    if (!(column > 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pressed: Session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: frameBox.width,
      column,
      gap,
      room: gridBox.right - frameBox.left,
    };
    session.current = pressed;
    setPreview({ width: current, px: pixelsOf(spanOf(current, breakpoint), pressed) });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pressed = session.current;
    if (pressed === null || event.pointerId !== pressed.pointerId) return;
    const width = widthAt(pressed, event.clientX);
    setPreview({ width, px: pixelsOf(spanOf(width, breakpoint), pressed) });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const pressed = session.current;
    if (pressed === null || event.pointerId !== pressed.pointerId) return;
    const width = widthAt(pressed, event.clientX);
    stop();
    if (width !== current) actions.setCardWidth(item.id, width);
  };

  return (
    <>
      <Tooltip content={t('resizeTip')} purpose="label" disabled={dragging}>
        <div
          ref={grip}
          aria-hidden="true"
          data-part="resize"
          className="absolute inset-y-0 right-0 w-1 cursor-ew-resize touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
        >
          {hovered || dragging ? <span className="ml-auto block h-full w-0.5 rounded-full bg-primary" /> : null}
        </div>
      </Tooltip>
      {preview === null ? null : (
        // Pixels measured from the grid: the one style here that is measured and not chosen. No transition: it follows the pointer
        <div
          data-slot="layout-resize-preview"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 z-(--z-sticky) h-full rounded-lg border border-dashed border-primary"
          style={{ width: preview.px }}
        >
          <span
            data-slot="layout-resize-tip"
            className="absolute top-2 right-2 rounded-md border border-border bg-surface-elevated px-2 py-0.5 type-meta text-foreground shadow-popover"
          >
            {t(`widths.${WIDTH_KEY[preview.width]}`)}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Mounted in the frame's `edge` slot of every card. It exists only in customize mode, on a screen with widths, on a card
 * whose allowed widths have more than one span at this breakpoint (so from 768 px, only where they look different).
 */
export function ResizeGrip({ item }: ResizeGripProps): ReactElement | null {
  const { mode, definition } = useLayoutScreen();
  const breakpoint = useBreakpoint();
  const widths = cardType(item.type)?.widths ?? [];
  if (mode !== 'customize' || !definition.zones.widths || distinctSpans(widths, breakpoint).length < 2) return null;
  return <Grip item={item} widths={widths} breakpoint={breakpoint} />;
}
