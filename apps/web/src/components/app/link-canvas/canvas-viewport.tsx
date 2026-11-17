'use client';

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the one element of this file is a pan and zoom surface: a named group that takes focus so the arrow, plus, minus and zero keys work on the empty canvas (spec 7.5 "Keyboard") */
import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { panBy, stepZoom, zoomAt, type Size, type View } from '@/lib/internal-links/canvas-view';
import { cn } from '@/lib/utils';

export interface CanvasViewportProps {
  /** The accessible name of the region. */
  label: string;
  view: View;
  /** Called at most once a frame while a gesture runs, and once more when it ends, so the last view is always reported. */
  onViewChange: (view: View) => void;
  /** The size of the region in pixels (the canvas measures it and passes it back). */
  size: Size;
  /** Called for a key the viewport does not own (0, Home, Escape): the canvas decides. */
  onKey?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** A press of the empty background (not on a card or a control): answer `true` to take it, and the view does not pan. */
  onBackgroundPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => boolean) | undefined;
  children: ReactNode;
  className?: string;
}

const KEY_STEP = 40;
const KEY_STEP_BIG = 160;
const WHEEL_ZOOM = 0.0015;
/** A wheel in lines (Firefox) counts this many pixels a line. */
const LINE_PIXELS = 16;
/** The dot grid spacing at 100 percent. */
const GRID = 24;
/** A fast drag glides to a stop (spec 7.5 "Pan"); not under reduced motion. */
const GLIDE_FRICTION = 0.92;
const GLIDE_MIN = 0.4;
/** Pixels a frame (16 ms) must move at release for the glide to start. */
const GLIDE_START = 4;

/** The operating system's setting and the app's own (`data-motion` on the root, 21-motion.md). */
export const reducedMotion = (): boolean =>
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

interface Drag {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

/**
 * The pannable, zoomable viewport of the canvas (spec 7.5 "Viewport", mock `il-canvas.js`): drag the empty background,
 * wheel or two finger scroll to pan, Ctrl or Cmd with the wheel or a pinch to zoom toward the cursor, Space and drag, and
 * the keys when the empty canvas has focus. The children are the world; they move by one transform and nothing scrolls.
 *
 * Every gesture builds on the view it last produced (not on the prop, which only catches up after a render), and the
 * host hears of it at most once a frame.
 */
export function CanvasViewport({
  label,
  view,
  onViewChange,
  size,
  onKey,
  onBackgroundPointerDown,
  children,
  className,
}: CanvasViewportProps): ReactElement {
  const region = useRef<HTMLDivElement>(null);
  // The view a gesture continues from: the last one made here, or the one the host set
  const latest = useRef(view);
  // A view made here that the host has not heard of yet, the frame that will tell it, and the views already told
  const pending = useRef<View | null>(null);
  const frame = useRef<number | null>(null);
  const told = useRef(new WeakSet<View>());
  const emit = useRef(onViewChange);
  const room = useRef(size);
  useEffect(() => {
    emit.current = onViewChange;
    room.current = size;
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const space = useRef(false);
  const glide = useRef<number | null>(null);

  const stopGlide = (): void => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  };
  const flush = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    told.current.add(next);
    emit.current(next);
  };
  /** The view is `next` from now on; the host hears of it now, or with the next frame. */
  const commit = (next: View, now = false): void => {
    latest.current = next;
    pending.current = next;
    if (now) flush();
    else
      frame.current ??= requestAnimationFrame(() => {
        frame.current = null;
        flush();
      });
  };

  useEffect(
    () => () => {
      if (glide.current !== null) cancelAnimationFrame(glide.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      glide.current = null;
      frame.current = null;
      pending.current = null;
    },
    [],
  );

  // A view the host sets (a button, a fit) replaces the one a gesture was building, and stops a glide
  useEffect(() => {
    if (told.current.has(view) || latest.current === view) return;
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    latest.current = view;
  }, [view]);

  const local = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = region.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // React attaches wheel listeners as passive, and the page must not scroll or zoom under the canvas: a native listener
  useEffect(() => {
    const element = region.current;
    if (element === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (glide.current !== null) cancelAnimationFrame(glide.current);
      glide.current = null;
      const unit = event.deltaMode === 2 ? room.current.height : event.deltaMode === 1 ? LINE_PIXELS : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * unit * WHEEL_ZOOM);
        commit(
          zoomAt(latest.current, latest.current.scale * factor, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }),
        );
        return;
      }
      commit(panBy(latest.current, -event.deltaX * unit, -event.deltaY * unit));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // commit only reads refs, so one listener serves for the life of the element
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A press, a tap on a card or a second finger takes hold of a glide
    stopGlide();
    const onCard =
      (event.target as HTMLElement).closest('[data-node], button, a, input, [data-canvas-control]') !== null;
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a !== undefined && b !== undefined) {
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: latest.current.scale };
        drag.current = null;
        for (const id of pointers.current.keys()) region.current?.setPointerCapture?.(id);
      }
      return;
    }
    if (onCard && !space.current) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // The canvas may take a press of the empty background for itself (Shift and drag draws a selection box)
    if (!space.current && onBackgroundPointerDown?.(event) === true) return;
    const point = local(event.clientX, event.clientY);
    drag.current = { x: point.x, y: point.y, vx: 0, vy: 0, t: performance.now() };
    region.current?.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    if (pinch.current !== null && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      commit(zoomAt(latest.current, pinch.current.scale * (distance / Math.max(pinch.current.distance, 1)), centre));
      return;
    }
    const start = drag.current;
    if (start === null) return;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const now = performance.now();
    const dt = Math.max(now - start.t, 1);
    drag.current = { x: point.x, y: point.y, vx: (dx / dt) * 16, vy: (dy / dt) * 16, t: now };
    commit(panBy(latest.current, dx, dy));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // The last view of the gesture is always reported
    flush();
    const [remaining] = pointers.current.values();
    if (remaining !== undefined) {
      // One finger of a pinch lifted: the other carries on as a pan from where it is, so the view does not jump
      drag.current = { x: remaining.x, y: remaining.y, vx: 0, vy: 0, t: performance.now() };
      return;
    }
    const last = drag.current;
    drag.current = null;
    // A gesture the system cancelled (a call, a palm) carries nothing on
    if (last === null || event.type === 'pointercancel' || reducedMotion()) return;
    let { vx, vy } = last;
    if (Math.hypot(vx, vy) < GLIDE_START) return;
    const tick = (): void => {
      vx *= GLIDE_FRICTION;
      vy *= GLIDE_FRICTION;
      if (Math.hypot(vx, vy) < GLIDE_MIN) {
        glide.current = null;
        return;
      }
      commit(panBy(latest.current, vx, vy), true);
      glide.current = requestAnimationFrame(tick);
    };
    glide.current = requestAnimationFrame(tick);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Cards keep their own arrows (20-accessibility.md 7.1) and a field keeps its own keys: these act on the empty canvas
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === ' ') {
      space.current = true;
      event.preventDefault();
      return;
    }
    const big = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const current = latest.current;
    const middle = { x: size.width / 2, y: size.height / 2 };
    let next: View | null = null;
    if (event.key === 'ArrowLeft') next = panBy(current, big, 0);
    else if (event.key === 'ArrowRight') next = panBy(current, -big, 0);
    else if (event.key === 'ArrowUp') next = panBy(current, 0, big);
    else if (event.key === 'ArrowDown') next = panBy(current, 0, -big);
    else if (event.key === '+' || event.key === '=') next = stepZoom(current, 1, size);
    else if (event.key === '-') next = stepZoom(current, -1, size);
    else if (event.key === '1') next = zoomAt(current, 1, middle);
    if (next === null) {
      onKey?.(event);
      return;
    }
    event.preventDefault();
    stopGlide();
    commit(next, true);
  };

  const cell = GRID * view.scale;
  return (
    <div
      ref={region}
      role="group"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'relative touch-none overflow-hidden bg-surface-subtle outline-none focus-visible:focus-ring',
        className,
      )}
      style={{
        backgroundImage: 'radial-gradient(var(--color-border-subtle) 1px, transparent 1px)',
        backgroundSize: `${String(cell)}px ${String(cell)}px`,
        backgroundPosition: `${String(view.x)}px ${String(view.y)}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') space.current = false;
      }}
      onBlur={() => {
        space.current = false;
      }}
      // Focus on a card can scroll the hidden overflow; the view is the only position there is
      onScroll={(event) => {
        event.currentTarget.scrollTo?.(0, 0);
        event.currentTarget.scrollLeft = 0;
        event.currentTarget.scrollTop = 0;
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform"
        style={{ transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})` }}
      >
        {children}
      </div>
    </div>
  );
}
