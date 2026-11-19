/**
 * The opened cards, groups and "+N more" counts of the journey as address values (spec 7.5: a link reproduces the
 * view). Keys are built by `journey-layout.ts` from url ids (digits), `.`, `:`, `|`, scope names and short letters;
 * anything else in the address is dropped, never thrown on.
 */

/** The canvas holds at most 300 cards, so no address needs more keys than that. */
export const MAX_ADDRESS_KEYS = 300;
const KEY = /^[a-z0-9_.:|]{1,400}$/;
const MAX_MORE = 40;

export function parseKeySet(text: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const part of (text ?? '').split(',')) {
    const key = part.trim();
    if (!KEY.test(key)) continue;
    keys.add(key);
    if (keys.size === MAX_ADDRESS_KEYS) break;
  }
  return keys;
}

/**
 * The most characters one address value (`open`, `grp`, `more` or `topen`) takes; each is cut on its own. A journey
 * the canvas can show (300 cards, `clampJourney`) writes far less than this in all four together, so the whole address
 * stays under the 8 KB many servers and proxies allow.
 */
export const MAX_ADDRESS_LENGTH = 4000;

/** The items that fit `MAX_ADDRESS_LENGTH` once joined; the longest (deepest) are the ones left out. */
function fitting(items: readonly string[]): string[] {
  const kept = new Set<string>();
  let length = 0;
  for (const item of [...items].sort((a, b) => a.length - b.length)) {
    if (length + item.length + 1 > MAX_ADDRESS_LENGTH) break;
    kept.add(item);
    length += item.length + 1;
  }
  return items.filter((item) => kept.has(item));
}

export const formatKeySet = (keys: ReadonlySet<string>): string | null => {
  const fit = fitting([...keys]);
  return fit.length === 0 ? null : fit.join(',');
};

export function parseMore(text: string | null | undefined): Map<string, number> {
  const more = new Map<string, number>();
  for (const part of (text ?? '').split(',')) {
    const at = part.lastIndexOf('*');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const count = Number(part.slice(at + 1));
    if (!KEY.test(key) || !Number.isInteger(count) || count < 1 || count > MAX_MORE) continue;
    more.set(key, count);
    if (more.size === MAX_ADDRESS_KEYS) break;
  }
  return more;
}

export const formatMore = (more: ReadonlyMap<string, number>): string | null => {
  const fit = fitting([...more].map(([key, count]) => `${key}*${String(count)}`));
  return fit.length === 0 ? null : fit.join(',');
};

export type LayoutMode = 'step' | 'tier';

/** `jl`: By tier only for the value `tier`; anything else, or nothing, is By step. */
export const parseLayoutMode = (value: string | null | undefined): LayoutMode => (value === 'tier' ? 'tier' : 'step');

/** A tier position (1 to 8) or 99 for Untiered. */
const LANE = /^(?:[1-8]|99)$/;

/** `jt`: the tier lanes turned off, as tier positions. Unknown parts are dropped, so at most nine values come back. */
export function parseLanes(text: string | null | undefined): Set<number> {
  const found = new Set<number>();
  for (const part of (text ?? '').split(',')) {
    const value = part.trim();
    if (LANE.test(value)) found.add(Number(value));
  }
  return new Set([...found].sort((a, b) => a - b));
}

export const formatLanes = (lanes: ReadonlySet<number>): string | null =>
  lanes.size === 0 ? null : [...lanes].sort((a, b) => a - b).join(',');
