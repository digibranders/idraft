'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { reducedMotion } from './canvas-viewport';
import { panBy, revealMinimum, unionOf, type Size, type View } from '@/lib/internal-links/canvas-view';
import type { Box } from '@/lib/internal-links/journey-geometry';
import { FADE_IN_MS, GHOST_MS, GLIDE_EASING, GLIDE_MS, planGrowth } from '@/lib/internal-links/journey-growth';

/** The margin the new links are kept inside the view with. */
const REVEAL_MARGIN = 24;
/** How long the lines are drawn every frame after a growth: the glide, and a little more. */
const FOLLOW_MS = GLIDE_MS + 60;
/** A growth that waits for lists this long gives up waiting, and is finished with what it has. */
const GIVE_UP_MS = 2000;

export interface GrowthHost {
  /** The element that holds the cards (the world). Cards are `[data-node][data-key]`, a page card inside a `[data-card]`. */
  root: RefObject<HTMLElement | null>;
  /** Changes when the layout is rebuilt. */
  layout: unknown;
  /** No list is still loading: a growth that is not settled is played again when the next lists arrive. */
  settled: boolean;
  /** Every card's box in world pixels, by key, with the place the person moved it to. */
  measure: () => Map<string, Box>;
  getView: () => View;
  size: Size;
  onViewChange: (view: View) => void;
  /** Draws the lines again: called on every frame while cards glide. */
  onFrame: () => void;
}

export interface GrowthHandle {
  /** Call just before a card opens or closes: remembers where every card stands. */
  begin: (pressedKey: string) => void;
  /** How far a card is from its place now, while it glides (world pixels; nothing when it does not). */
  shiftOf: (key: string) => { dx: number; dy: number } | null;
}

interface Pending {
  key: string;
  /** The layout the press happened on: the growth plays when it is replaced. */
  layout: unknown;
  boxes: Map<string, Box>;
  clones: Map<string, HTMLElement>;
  entered: Set<string>;
  expires: number;
}

/** The part of a card that moves: the wrapper of a page card, the button itself for a group or a stub. */
const movable = (element: HTMLElement): HTMLElement => element.closest<HTMLElement>('[data-card]') ?? element;

/** `translate` as the browser reports it while an animation of it runs: "12px 5px", or `none`. */
function translateOf(element: HTMLElement): { dx: number; dy: number } | null {
  const text = getComputedStyle(element).translate;
  if (text === '' || text === 'none') return null;
  const [x, y] = text.split(' ').map((part) => Number.parseFloat(part));
  return x === undefined || Number.isNaN(x) ? null : { dx: x, dy: y === undefined || Number.isNaN(y) ? 0 : y };
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Growing never loses the place (spec 7.5): after a card opens or closes, the pressed card stays where it was on the
 * screen (the view pans by what it moved), every other card glides from its old place to its new one (300 ms, ease in
 * and out), new cards fade in, closed cards fade out where they stood (180 ms), the lines are drawn every frame, and the
 * view pans the least it takes to show the card and its new links. Under reduced motion the layout changes at once and
 * only the pan is made. Nothing here renders: a press reads the page, a layout change plays the plan.
 */
export function useGrowth(host: GrowthHost): GrowthHandle {
  const latest = useRef(host);
  const pending = useRef<Pending | null>(null);
  const gliding = useRef(new Map<string, HTMLElement>());
  const frame = useRef<number | null>(null);
  const cancelView = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = host;
  });

  const stop = useCallback((): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    cancelView.current?.();
    cancelView.current = null;
    gliding.current.clear();
  }, []);
  useEffect(() => stop, [stop]);

  const begin = useCallback(
    (pressedKey: string): void => {
      const root = latest.current.root.current;
      if (root === null) return;
      // A growth still playing is finished first, so the places measured now are the settled ones
      stop();
      for (const ghost of root.querySelectorAll('[data-ghost]')) ghost.remove();
      if (typeof root.getAnimations === 'function') {
        for (const animation of root.getAnimations({ subtree: true })) animation.finish();
      }
      const clones = new Map<string, HTMLElement>();
      // Ghosts are only made where the browser can fade them
      if (!reducedMotion() && typeof root.animate === 'function') {
        for (const element of root.querySelectorAll<HTMLElement>('[data-node][data-key]')) {
          clones.set(element.dataset.key ?? '', movable(element).cloneNode(true) as HTMLElement);
        }
      }
      pending.current = {
        key: pressedKey,
        layout: latest.current.layout,
        boxes: latest.current.measure(),
        clones,
        entered: new Set(),
        expires: Date.now() + GIVE_UP_MS,
      };
    },
    [stop],
  );

  const shiftOf = useCallback((key: string): { dx: number; dy: number } | null => {
    const element = gliding.current.get(key);
    return element === undefined ? null : translateOf(element);
  }, []);

  /** Draws the lines on every frame until the glide is over, then once more with every card in its place. */
  const follow = useCallback((tween: { from: View; to: View } | null): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    cancelView.current?.();
    cancelView.current = null;
    const start = performance.now();
    let told: View | null = null;
    let tweening = tween;
    cancelView.current = () => {
      tweening = null;
    };
    const tick = (now: number): void => {
      const elapsed = now - start;
      if (tweening !== null) {
        // A view somebody else set (a wheel, a drag, a button) ends the glide of the view
        if (told !== null && latest.current.getView() !== told) tweening = null;
        else {
          const t = Math.min(1, elapsed / GLIDE_MS);
          const eased = ease(t);
          told = {
            x: tweening.from.x + (tweening.to.x - tweening.from.x) * eased,
            y: tweening.from.y + (tweening.to.y - tweening.from.y) * eased,
            scale: tweening.to.scale,
          };
          latest.current.onViewChange(t === 1 ? tweening.to : told);
          if (t === 1) tweening = null;
        }
      }
      latest.current.onFrame();
      if (elapsed < FOLLOW_MS || tweening !== null) {
        frame.current = requestAnimationFrame(tick);
        return;
      }
      frame.current = null;
      gliding.current.clear();
      latest.current.onFrame();
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  useLayoutEffect(() => {
    const before = pending.current;
    const current = latest.current;
    if (before === null || before.layout === current.layout) return;
    const root = current.root.current;
    if (root === null) {
      pending.current = null;
      return;
    }
    const view = current.getView();
    const after = current.measure();
    const plan = planGrowth(before.boxes, after, before.key, view.scale);
    for (const key of plan.enter) before.entered.add(key);
    const calm = reducedMotion();
    let next = plan.pan.dx === 0 && plan.pan.dy === 0 ? view : panBy(view, plan.pan.dx, plan.pan.dy);
    const done = current.settled || Date.now() > before.expires;
    // The card and its new links are brought into view by one pan, once every list has arrived
    let reveal: View | null = null;
    if (done) {
      const shown = [before.key, ...before.entered].flatMap((key) => {
        const box = after.get(key);
        return box === undefined ? [] : [box];
      });
      const wanted = revealMinimum(next, unionOf(shown), current.size, REVEAL_MARGIN);
      if (wanted !== next) reveal = wanted;
    }
    if (next !== view) current.onViewChange(next);
    if (reveal !== null && calm) {
      current.onViewChange(reveal);
      next = reveal;
      reveal = null;
    }

    if (!calm && typeof root.animate === 'function') {
      const elements = new Map<string, HTMLElement>();
      for (const element of root.querySelectorAll<HTMLElement>('[data-node][data-key]')) {
        elements.set(element.dataset.key ?? '', movable(element));
      }
      gliding.current.clear();
      for (const [key, shift] of plan.move) {
        const element = elements.get(key);
        if (element === undefined) continue;
        gliding.current.set(key, element);
        element.animate([{ translate: `${shift.dx}px ${shift.dy}px` }, { translate: '0px 0px' }], {
          duration: GLIDE_MS,
          easing: GLIDE_EASING,
        });
      }
      for (const key of plan.enter) {
        elements.get(key)?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_IN_MS,
          delay: 80,
          easing: 'ease-out',
          fill: 'backwards',
        });
      }
      for (const key of plan.leave) {
        const ghost = before.clones.get(key);
        const box = before.boxes.get(key);
        if (ghost === undefined || box === undefined) continue;
        // The old card is put back where it stood, as a picture only: nothing in it can be reached or announced
        ghost.removeAttribute('id');
        for (const inner of ghost.querySelectorAll('[id]')) inner.removeAttribute('id');
        for (const inner of ghost.querySelectorAll('[data-node]')) inner.removeAttribute('data-node');
        ghost.removeAttribute('data-node');
        ghost.removeAttribute('data-card');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.setAttribute('inert', '');
        ghost.setAttribute('data-ghost', '');
        // On the screen the old card stays where it was: in the new world that is its old place plus the pressed card's move
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${String(box.left - plan.pan.dx / view.scale)}px`,
          top: `${String(box.top - plan.pan.dy / view.scale)}px`,
          width: `${String(box.width)}px`,
          margin: '0',
          transform: '',
          pointerEvents: 'none',
        });
        root.append(ghost);
        const gone = (): void => ghost.remove();
        void ghost
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: GHOST_MS, easing: 'ease-in' })
          .finished.then(gone, gone);
      }
      if (gliding.current.size > 0 || reveal !== null) {
        current.onFrame();
        follow(reveal === null ? null : { from: next, to: reveal });
      }
    } else if (reveal !== null) {
      current.onViewChange(reveal);
    }
    before.boxes = after;
    before.clones = new Map();
    before.layout = current.layout;
    if (done) pending.current = null;
  }, [host.layout, follow]);

  return { begin, shiftOf };
}
