'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';

import { fitInspectorWidth, INSPECTOR_WIDTH } from '@/lib/inspector/placement';
import { cn } from '@/lib/utils';

/** Arrow keys change the width by 16 px, or 64 px with Shift. */
const STEP = 16;
const LARGE_STEP = 64;

export interface InspectorResizeHandleProps {
  width: number;
  /** The effective maximum of 16 section 2.6. */
  max: number;
  /** The inspector it resizes. */
  controlsId: string;
  /** A new width, on 8 px steps: once per key press, and once when a drag ends. */
  onResize: (width: number) => void;
  /** Back to the type's default width: Enter or a double click. */
  onReset: () => void;
  /** The width while dragging, so the card follows the pointer while the page reflows only on release. */
  onPreview: (width: number | null) => void;
}

/**
 * The window splitter on the inspector's left edge (16-drawers-dialogs-popovers.md section 2.2): a 1 px
 * line with an 8 px hit area. Left widens and Right narrows by 16 px (64 px with Shift), Home and End go to
 * the limits, Enter and a double click reset. A drag previews the width and commits it on release.
 */
export function InspectorResizeHandle({
  width,
  max,
  controlsId,
  onResize,
  onReset,
  onPreview,
}: InspectorResizeHandleProps): ReactElement {
  const t = useTranslations('inspector');
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? LARGE_STEP : STEP;
    const next =
      event.key === 'ArrowLeft'
        ? width + step
        : event.key === 'ArrowRight'
          ? width - step
          : event.key === 'Home'
            ? INSPECTOR_WIDTH.min
            : event.key === 'End'
              ? max
              : null;
    if (event.key === 'Enter') {
      event.preventDefault();
      onReset();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onResize(fitInspectorWidth(next, max));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, last: width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null) return;
    // The handle is on the left edge: moving left widens
    current.last = fitInspectorWidth(current.startWidth + current.startX - event.clientX, max);
    onPreview(current.last);
  };
  const endDrag = (): void => {
    const current = drag.current;
    if (current === null) return;
    drag.current = null;
    setDragging(false);
    onPreview(null);
    if (current.last !== current.startWidth) onResize(current.last);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize')}
      aria-controls={controlsId}
      aria-valuenow={width}
      aria-valuemin={INSPECTOR_WIDTH.min}
      aria-valuemax={max}
      aria-valuetext={t('widthValue', { width })}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      className={cn(
        // 8 px hit area centered on the card's left border; the line itself is the card's border
        // Last in the card's markup, so it paints over the header without a z-index of its own
        'group/resize absolute inset-y-0 -left-1 w-2 cursor-col-resize touch-none outline-none',
        'focus-visible:focus-ring',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Over the card's 1 px border, which sits at the middle of the hit area
          'absolute inset-y-0 left-1 w-0.5 bg-border-strong opacity-0 group-hover/resize:opacity-100',
          dragging && 'opacity-100',
        )}
      />
    </div>
  );
}
