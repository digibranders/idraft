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

export const formatKeySet = (keys: ReadonlySet<string>): string | null =>
  keys.size === 0 ? null : [...keys].join(',');

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

export const formatMore = (more: ReadonlyMap<string, number>): string | null =>
  more.size === 0 ? null : [...more].map(([key, count]) => `${key}*${String(count)}`).join(',');
