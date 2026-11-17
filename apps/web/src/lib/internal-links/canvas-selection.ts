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
