/* global window, document, requestAnimationFrame, cancelAnimationFrame, performance */
/**
 * Internal links, Journey canvas: the viewport. A pannable, zoomable surface with the interactions people expect from a
 * graph canvas: drag the background or scroll to pan, pinch or Ctrl/Cmd + scroll to zoom toward the cursor, touch pan and
 * pinch, glide after a fast drag, animated moves, and a minimap. It knows nothing about cards: il-journey.js draws them
 * and asks the viewport where to look. World coordinates are unscaled pixels inside `content`.
 */
import { el } from './prompts-parts.js';

export const MIN_K = 0.25;
export const MAX_K = 2;
const TAP = 5;
const NS = 'http://www.w3.org/2000/svg';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const ease = (t) => 1 - (1 - t) ** 3;

/**
 * @param {{host: HTMLElement, content: HTMLElement, canPan: (event: PointerEvent) => boolean, onView?: (view: {x: number, y: number, k: number}) => void}} options
 * `host` is the clipping surface, `content` the element that is moved and scaled (transform-origin 0 0).
 */
export function createViewport({ host, content, canPan, onView }) {
  const v = { x: 0, y: 0, k: 1 };
  const pointers = new Map();
  let frame = 0;
  let gesture = null;
  let dragged = false;
  let space = false;

  const size = () => ({ w: host.clientWidth, h: host.clientHeight });

  function apply() {
    content.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    const step = 24 * v.k * (v.k < 0.5 ? 2 : 1);
    host.style.backgroundSize = `${step}px ${step}px`;
    host.style.backgroundPosition = `${v.x}px ${v.y}px`;
    onView?.(v);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function set(x, y, k = v.k) {
    stop();
    v.x = x;
    v.y = y;
    v.k = clamp(k, MIN_K, MAX_K);
    apply();
  }

  /** Moves to `target` over `ms` (instantly under reduced motion). */
  function animate(target, ms = 260) {
    stop();
    const to = { x: target.x, y: target.y, k: clamp(target.k ?? v.k, MIN_K, MAX_K) };
    if (ms === 0 || reduced()) {
      set(to.x, to.y, to.k);
      return;
    }
    const from = { x: v.x, y: v.y, k: v.k };
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = ease(t);
      v.x = from.x + (to.x - from.x) * e;
      v.y = from.y + (to.y - from.y) * e;
      v.k = from.k * (to.k / from.k) ** e;
      apply();
      frame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    frame = requestAnimationFrame(tick);
  }

  /** The view that keeps the world point under (px, py) in place while the scale becomes `k`. */
  function viewAt(px, py, k) {
    const next = clamp(k, MIN_K, MAX_K);
    return { x: px - ((px - v.x) / v.k) * next, y: py - ((py - v.y) / v.k) * next, k: next };
  }

  function fitTarget(box, { pad = 48, maxK = 1 } = {}) {
    const { w, h } = size();
    const bw = Math.max(1, box.r - box.l);
    const bh = Math.max(1, box.b - box.t);
    const k = clamp(Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, maxK), MIN_K, MAX_K);
    return { k, x: (w - bw * k) / 2 - box.l * k, y: (h - bh * k) / 2 - box.t * k };
  }

  function centreTarget(wx, wy, k = v.k) {
    const { w, h } = size();
    return { k, x: w / 2 - wx * k, y: h / 2 - wy * k };
  }

  /** The smallest pan that brings `box` (world pixels) into view, favouring its top-left corner; null when it already is. */
  function visibleTarget(box, margin = 32) {
    const { w, h } = size();
    const l = box.l * v.k + v.x;
    const r = box.r * v.k + v.x;
    const t = box.t * v.k + v.y;
    const b = box.b * v.k + v.y;
    let dx = 0;
    let dy = 0;
    if (r > w - margin) dx = w - margin - r;
    if (l + dx < margin) dx = margin - l;
    if (b > h - margin) dy = h - margin - b;
    if (t + dy < margin) dy = margin - t;
    return dx === 0 && dy === 0 ? null : { x: v.x + dx, y: v.y + dy, k: v.k };
  }

  /** Keeps moving after a fast drag, slowing down by friction. */
  function glide(vx, vy) {
    if (reduced() || Math.hypot(vx, vy) < 0.05) return;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(48, now - last);
      last = now;
      const friction = 0.996 ** dt;
      vx *= friction;
      vy *= friction;
      v.x += vx * dt;
      v.y += vy * dt;
      apply();
      frame = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(tick) : 0;
    };
    frame = requestAnimationFrame(tick);
  }

  host.addEventListener('wheel', (event) => {
    event.preventDefault();
    stop();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
    if (event.ctrlKey || event.metaKey) {
      // A pinch on a trackpad arrives as a Ctrl + wheel event with small deltas
      const rect = host.getBoundingClientRect();
      const delta = clamp(event.deltaY * unit, -60, 60);
      const next = viewAt(event.clientX - rect.left, event.clientY - rect.top, v.k * Math.exp(-delta * 0.01));
      set(next.x, next.y, next.k);
      return;
    }
    const sideways = event.shiftKey && event.deltaX === 0;
    set(v.x - (sideways ? event.deltaY : event.deltaX) * unit, v.y - (sideways ? 0 : event.deltaY) * unit);
  }, { passive: false });

  function pinchStart() {
    const [a, b] = [...pointers.values()];
    const rect = host.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - rect.left;
    const my = (a.y + b.y) / 2 - rect.top;
    gesture = { mode: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: v.k, wx: (mx - v.x) / v.k, wy: (my - v.y) / v.k };
    dragged = true;
    stop();
  }

  function panStart(point) {
    gesture = { mode: 'pan', startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, lastT: performance.now(), vx: 0, vy: 0, moving: false };
  }

  host.addEventListener('pointerdown', (event) => {
    // Every press starts clean: a pan that ended earlier must not swallow the click on a card this press may become
    dragged = false;
    const touch = event.pointerType === 'touch';
    if (event.button === 1) event.preventDefault();
    const allowed = touch || event.button === 1 || (space && event.button === 0) || canPan(event);
    if (!allowed) return;
    stop();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) pinchStart();
    else panStart({ x: event.clientX, y: event.clientY });
  });

  host.addEventListener('pointermove', (event) => {
    const point = pointers.get(event.pointerId);
    if (!point || !gesture) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (gesture.mode === 'pinch') {
      const [a, b] = [...pointers.values()];
      const rect = host.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      const k = clamp(gesture.k * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance), MIN_K, MAX_K);
      set(mx - gesture.wx * k, my - gesture.wy * k, k);
      return;
    }
    const g = gesture;
    if (!g.moving) {
      if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < TAP) return;
      g.moving = true;
      dragged = true;
      host.setPointerCapture(event.pointerId);
      host.style.cursor = 'grabbing';
    }
    const now = performance.now();
    const dt = Math.max(1, now - g.lastT);
    const dx = event.clientX - g.lastX;
    const dy = event.clientY - g.lastY;
    g.vx = g.vx * 0.5 + (dx / dt) * 0.5;
    g.vy = g.vy * 0.5 + (dy / dt) * 0.5;
    g.lastX = event.clientX;
    g.lastY = event.clientY;
    g.lastT = now;
    set(v.x + dx, v.y + dy);
  });

  function release(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 1 && gesture?.mode === 'pinch') {
      // One finger stays down after a pinch: carry on as a pan from where it is
      const [rest] = [...pointers.values()];
      panStart(rest);
      gesture.moving = true;
      return;
    }
    if (pointers.size > 0) return;
    const g = gesture;
    gesture = null;
    host.style.cursor = 'grab';
    if (g?.mode === 'pan' && g.moving && event.type === 'pointerup' && performance.now() - g.lastT < 80) glide(g.vx, g.vy);
  }
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);

  // Space held over the empty canvas turns a drag into a pan, even when it starts on a card
  host.addEventListener('keydown', (event) => {
    if (event.key === ' ' && event.target === host) {
      space = true;
      event.preventDefault();
    }
  });
  host.addEventListener('keyup', (event) => {
    if (event.key === ' ') space = false;
  });
  host.addEventListener('blur', () => {
    space = false;
  });

  return {
    v,
    size,
    set,
    animate,
    stop,
    viewAt,
    fitTarget,
    centreTarget,
    visibleTarget,
    wasDragged: () => dragged,
    spaceHeld: () => space,
  };
}

/**
 * A small overview of every card and the part of the canvas in view. Press or drag on it to move the view.
 * @param {ReturnType<typeof createViewport>} viewport
 */
export function createMinimap(viewport) {
  const W = 176;
  const H = 112;
  const PAD = 24;
  const root = el('div', 'absolute bottom-3 right-3 hidden touch-none overflow-hidden rounded-md border border-border bg-surface-elevated shadow-popover sm:block');
  root.style.width = `${W}px`;
  root.style.height = `${H}px`;
  root.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  const layer = document.createElementNS(NS, 'g');
  const frame = document.createElementNS(NS, 'rect');
  frame.setAttribute('rx', '2');
  frame.setAttribute('stroke-width', '1.5');
  frame.style.fill = 'color-mix(in srgb, var(--color-primary) 10%, transparent)';
  frame.style.stroke = 'var(--color-primary)';
  svg.append(layer, frame);
  root.append(svg);

  let boxes = [];
  let map = { s: 1, ox: 0, oy: 0 };
  let dragging = false;

  function update() {
    const { w, h } = viewport.size();
    const { x, y, k } = viewport.v;
    const view = { l: -x / k, t: -y / k, r: (w - x) / k, b: (h - y) / k };
    if (!dragging) {
      // While dragging the map holds still, so the frame does not chase its own movement
      let { l, t, r, b } = view;
      boxes.forEach((box) => {
        l = Math.min(l, box.l);
        t = Math.min(t, box.t);
        r = Math.max(r, box.r);
        b = Math.max(b, box.b);
      });
      l -= PAD;
      t -= PAD;
      r += PAD;
      b += PAD;
      const s = Math.min(W / (r - l), H / (b - t));
      map = { s, ox: (W - (r - l) * s) / 2 - l * s, oy: (H - (b - t) * s) / 2 - t * s };
      layer.setAttribute('transform', `translate(${map.ox} ${map.oy}) scale(${map.s})`);
    }
    frame.setAttribute('x', String(view.l * map.s + map.ox));
    frame.setAttribute('y', String(view.t * map.s + map.oy));
    frame.setAttribute('width', String((view.r - view.l) * map.s));
    frame.setAttribute('height', String((view.b - view.t) * map.s));
  }

  function setBoxes(next) {
    boxes = next;
    layer.innerHTML = next.map((box) => `<rect x="${box.l}" y="${box.t}" width="${box.r - box.l}" height="${box.b - box.t}" rx="6" style="fill: ${box.focus ? 'var(--color-primary)' : 'var(--color-foreground-tertiary)'}; opacity: ${box.focus ? 0.9 : 0.45}"/>`).join('');
    update();
  }

  const worldAt = (event) => {
    const rect = root.getBoundingClientRect();
    return { x: (event.clientX - rect.left - map.ox) / map.s, y: (event.clientY - rect.top - map.oy) / map.s };
  };
  root.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    root.setPointerCapture(event.pointerId);
    dragging = true;
    const at = worldAt(event);
    viewport.animate(viewport.centreTarget(at.x, at.y), 180);
  });
  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const at = worldAt(event);
    const target = viewport.centreTarget(at.x, at.y);
    viewport.set(target.x, target.y, target.k);
  });
  const end = () => {
    dragging = false;
    update();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  return { root, update, setBoxes };
}
