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
  onViewChange: (view: View) => void;
  /** The size of the region in pixels (the canvas measures it and passes it back). */
  size: Size;
  /** Called for a key the viewport does not own (0, Home, Escape): the canvas decides. */
  onKey?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  children: ReactNode;
  className?: string;
}

const KEY_STEP = 40;
const KEY_STEP_BIG = 160;
const WHEEL_ZOOM = 0.0015;
/** The dot grid spacing at 100 percent. */
const GRID = 24;
/** A fast drag glides to a stop (spec 7.5 "Pan"); not under reduced motion. */
const GLIDE_FRICTION = 0.92;
const GLIDE_MIN = 0.4;
/** Pixels a frame (16 ms) must move at release for the glide to start. */
const GLIDE_START = 4;

/** The operating system's setting and the app's own (`data-motion` on the root, 21-motion.md). */
const reducedMotion = (): boolean =>
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
 */
export function CanvasViewport({
  label,
  view,
  onViewChange,
  size,
  onKey,
  children,
  className,
}: CanvasViewportProps): ReactElement {
  const region = useRef<HTMLDivElement>(null);
  const latest = useRef(view);
  const emit = useRef(onViewChange);
  useEffect(() => {
    latest.current = view;
    emit.current = onViewChange;
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
  useEffect(
    () => () => {
      if (glide.current !== null) cancelAnimationFrame(glide.current);
    },
    [],
  );

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
      const rect = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * unit * WHEEL_ZOOM);
        emit.current(
          zoomAt(latest.current, latest.current.scale * factor, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }),
        );
        return;
      }
      emit.current(panBy(latest.current, -event.deltaX * unit, -event.deltaY * unit));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const onCard =
      (event.target as HTMLElement).closest('[data-node], button, a, input, [data-canvas-control]') !== null;
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a !== undefined && b !== undefined) {
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: latest.current.scale };
        drag.current = null;
      }
      return;
    }
    if (onCard && !space.current) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    stopGlide();
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
      onViewChange(
        zoomAt(latest.current, pinch.current.scale * (distance / Math.max(pinch.current.distance, 1)), centre),
      );
      return;
    }
    const start = drag.current;
    if (start === null) return;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const now = performance.now();
    const dt = Math.max(now - start.t, 1);
    drag.current = { x: point.x, y: point.y, vx: (dx / dt) * 16, vy: (dy / dt) * 16, t: now };
    onViewChange(panBy(latest.current, dx, dy));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const last = drag.current;
    drag.current = null;
    if (last === null || reducedMotion()) return;
    let { vx, vy } = last;
    if (Math.hypot(vx, vy) < GLIDE_START) return;
    const tick = (): void => {
      vx *= GLIDE_FRICTION;
      vy *= GLIDE_FRICTION;
      if (Math.hypot(vx, vy) < GLIDE_MIN) {
        glide.current = null;
        return;
      }
      emit.current(panBy(latest.current, vx, vy));
      glide.current = requestAnimationFrame(tick);
    };
    glide.current = requestAnimationFrame(tick);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Cards keep their own arrows (20-accessibility.md 7.1); these keys act on the empty canvas
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === ' ') {
      space.current = true;
      event.preventDefault();
      return;
    }
    const big = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const current = latest.current;
    let next: View | null = null;
    if (event.key === 'ArrowLeft') next = panBy(current, big, 0);
    else if (event.key === 'ArrowRight') next = panBy(current, -big, 0);
    else if (event.key === 'ArrowUp') next = panBy(current, 0, big);
    else if (event.key === 'ArrowDown') next = panBy(current, 0, -big);
    else if (event.key === '+' || event.key === '=') next = stepZoom(current, 1, size);
    else if (event.key === '-') next = stepZoom(current, -1, size);
    else if (event.key === '1') next = zoomAt(current, 1, { x: size.width / 2, y: size.height / 2 });
    if (next === null) {
      onKey?.(event);
      return;
    }
    event.preventDefault();
    onViewChange(next);
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
