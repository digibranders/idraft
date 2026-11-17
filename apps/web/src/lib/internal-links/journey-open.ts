import { FOCUS_KEY } from './journey-layout';

/**
 * One journey at a time (spec 7.5 "Growing", decision D3): opening a card closes every other opened card on its side,
 * except the cards on its own path from the focus page. Card keys are `<side>:<id>.<id>...` with the ids the path from
 * the focus (`cardKey` in `journey-layout.ts`), so the cards on a card's own path are the keys whose id list is a prefix
 * of its own. Pure.
 */
export interface OpenSets {
  open: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  more: ReadonlyMap<string, number>;
}

export interface ParsedCardKey {
  side: 'o' | 'i';
  ids: string[];
}

const CARD = /^([oi]):(\d+(?:\.\d+)*)$/;
const GROUP = /^g:([oi]):(.+):(editorial|auto_generated|template|both)$/;
const MORE = /^m:(.+)$/;
/** The layout's "+N more" owners are `<side>|<card key>`, with `|t<position>` added for a tier list. */
const MORE_SIDE = /^[oi]\|/;
const MORE_TIER = /\|t\d+$/;

export function parseCardKey(key: string): ParsedCardKey | null {
  const match = CARD.exec(key);
  if (match === null) return null;
  return { side: match[1] === 'i' ? 'i' : 'o', ids: (match[2] ?? '').split('.') };
}

const sideOf = (key: string): 'o' | 'i' | null => {
  const card = parseCardKey(key);
  if (card !== null) return card.side;
  const group = GROUP.exec(key);
  return group === null ? null : group[1] === 'i' ? 'i' : 'o';
};

const isPrefix = (shorter: readonly string[], longer: readonly string[]): boolean =>
  shorter.length <= longer.length && shorter.every((id, index) => longer[index] === id);

/** Whether `key` is the card `target` or one on the path from the focus to it. */
const onPathOf = (key: string, target: ParsedCardKey): boolean => {
  const card = parseCardKey(key);
  return card !== null && card.side === target.side && isPrefix(card.ids, target.ids);
};

/** The card, the focus or the group a group or "+N more" key hangs under. */
const ownerOf = (key: string): string | null => {
  const group = GROUP.exec(key);
  if (group !== null) return group[2] ?? null;
  const more = MORE.exec(key);
  if (more === null) return null;
  return (more[1] ?? '').replace(MORE_SIDE, '').replace(MORE_TIER, '');
};

/**
 * The sets after pressing the card `key`: it opens (or closes when open), and on its side every opened card, group and
 * "+N more" that is not on its path closes. A key that is not a card key (a group card) keeps its parent's path.
 */
export function openExclusive(current: OpenSets, key: string): OpenSets {
  const target = parseCardKey(key);
  const wasOpen = current.open.has(key) || current.groups.has(key);
  const side = sideOf(key);
  const group = GROUP.exec(key);
  const owner = group === null ? null : parseCardKey(group[2] ?? '');
  const path = target ?? owner;
  const open = new Set(
    [...current.open].filter((candidate) => {
      if (sideOf(candidate) !== side) return true;
      if (candidate === key) return !wasOpen;
      return path !== null && onPathOf(candidate, path);
    }),
  );
  const groups = new Set(
    [...current.groups].filter((candidate) => {
      if (sideOf(candidate) !== side) return true;
      if (candidate === key) return !wasOpen;
      const parent = ownerOf(candidate);
      return parent !== null && (parent === FOCUS_KEY || (path !== null && onPathOf(parent, path)));
    }),
  );
  if (!wasOpen) (target === null ? groups : open).add(key);
  const alive = (moreKey: string): boolean => {
    const parent = ownerOf(moreKey);
    return parent === null || parent === FOCUS_KEY || open.has(parent) || groups.has(parent);
  };
  const more = new Map([...current.more].filter(([moreKey]) => alive(moreKey)));
  return { open, groups, more };
}

/** The selection bar's "Show their links": several cards open together, nothing closes. */
export function openTogether(current: OpenSets, keys: readonly string[]): OpenSets {
  return { open: new Set([...current.open, ...keys]), groups: current.groups, more: current.more };
}
