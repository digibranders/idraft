import type { Box } from './journey-geometry';

/** The keys of the cards whose box a selection box (world coordinates) touches. */
export function boxesIn(boxes: ReadonlyMap<string, Box>, area: Box): string[] {
  const found: string[] = [];
  for (const [key, box] of boxes) {
    const apart =
      box.left > area.left + area.width ||
      box.left + box.width < area.left ||
      box.top > area.top + area.height ||
      box.top + box.height < area.top;
    if (!apart) found.push(key);
  }
  return found;
}

/** Shift or Cmd and click: adds a card, or takes it away when it was selected. */
export function toggleSelected(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** The selected keys that are still on the canvas; the same set when none went (so state does not change). */
export function withoutKeys(selected: ReadonlySet<string>, present: ReadonlySet<string>): ReadonlySet<string> {
  const kept = [...selected].filter((key) => present.has(key));
  return kept.length === selected.size ? selected : new Set(kept);
}

export interface Offset {
  dx: number;
  dy: number;
}

/** The offsets of the cards that are still on the canvas; the same map when none went. */
export function keepOffsets(
  current: ReadonlyMap<string, Offset>,
  present: ReadonlySet<string>,
): ReadonlyMap<string, Offset> {
  const kept = [...current].filter(([key]) => present.has(key));
  return kept.length === current.size ? current : new Map(kept);
}

/**
 * A move of `dx`, `dy` held so that every moved card stays inside the content (a card dragged out of it would be clipped
 * and left out of the fit and the map). `limits` are the cards' boxes where the layout puts them; `base` the offsets
 * they already have. One shared distance, so the cards keep their places relative to each other. A content with no size
 * (not measured yet) holds nothing.
 */
export function clampMove(
  limits: ReadonlyMap<string, Box>,
  base: ReadonlyMap<string, Offset>,
  content: { width: number; height: number },
  dx: number,
  dy: number,
): Offset {
  let low = { dx: -Infinity, dy: -Infinity };
  let high = { dx: Infinity, dy: Infinity };
  for (const [key, box] of limits) {
    const before = base.get(key) ?? { dx: 0, dy: 0 };
    if (content.width > 0) {
      low = { ...low, dx: Math.max(low.dx, -box.left - before.dx) };
      high = { ...high, dx: Math.min(high.dx, content.width - (box.left + box.width) - before.dx) };
    }
    if (content.height > 0) {
      low = { ...low, dy: Math.max(low.dy, -box.top - before.dy) };
      high = { ...high, dy: Math.min(high.dy, content.height - (box.top + box.height) - before.dy) };
    }
  }
  return {
    dx: Math.min(high.dx, Math.max(low.dx, dx)),
    dy: Math.min(high.dy, Math.max(low.dy, dy)),
  };
}

/** The positions after dragging `keys` by (dx, dy), in world pixels from where the layout puts each card. */
export function withOffsets(
  current: ReadonlyMap<string, Offset>,
  keys: readonly string[],
  dx: number,
  dy: number,
): Map<string, Offset> {
  const next = new Map(current);
  for (const key of keys) {
    const before = next.get(key) ?? { dx: 0, dy: 0 };
    next.set(key, { dx: before.dx + dx, dy: before.dy + dy });
  }
  return next;
}
