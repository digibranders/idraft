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

/** The card a group or "+N more" key finally hangs under (a "more" of a group goes through the group), or the focus. */
const cardOwnerOf = (key: string): string | null => {
  const owner = ownerOf(key);
  return owner !== null && GROUP.test(owner) ? ownerOf(owner) : owner;
};

/**
 * The sets after pressing `key`:
 * - a group card only toggles that group (its "+N more" count goes with it when it closes);
 * - an open card closes with its descendants (keys that have it as a path prefix), not its siblings;
 * - a closed card opens, and every other opened card, group and "+N more" on its side that is not on its path closes.
 * Any other key (the focus, a "+N more" key) changes nothing: the same object comes back.
 */
export function openExclusive(current: OpenSets, key: string): OpenSets {
  const target = parseCardKey(key);
  const group = GROUP.exec(key);
  if (target === null && group === null) return current;

  if (target === null) {
    const wasOpen = current.groups.has(key);
    const groups = new Set(current.groups);
    if (wasOpen) groups.delete(key);
    else groups.add(key);
    const more = new Map([...current.more].filter(([moreKey]) => !wasOpen || ownerOf(moreKey) !== key));
    return { open: current.open, groups, more };
  }

  const side = target.side;
  const keep = (candidate: string, wasOpen: boolean): boolean => {
    if (sideOf(candidate) !== side) return true;
    if (wasOpen) {
      const card = parseCardKey(candidate);
      return !(card !== null && isPrefix(target.ids, card.ids));
    }
    return onPathOf(candidate, target);
  };

  if (current.open.has(key)) {
    const under = (owner: string | null): boolean => {
      const card = owner === null ? null : parseCardKey(owner);
      return card !== null && card.side === side && isPrefix(target.ids, card.ids);
    };
    return {
      open: new Set([...current.open].filter((candidate) => keep(candidate, true))),
      groups: new Set([...current.groups].filter((candidate) => !under(cardOwnerOf(candidate)))),
      more: new Map([...current.more].filter(([moreKey]) => !under(cardOwnerOf(moreKey)))),
    };
  }

  const open = new Set([...current.open].filter((candidate) => keep(candidate, false)));
  open.add(key);
  const groups = new Set(
    [...current.groups].filter((candidate) => {
      if (sideOf(candidate) !== side) return true;
      const parent = ownerOf(candidate);
      return parent !== null && (parent === FOCUS_KEY || onPathOf(parent, target));
    }),
  );
  const alive = (moreKey: string): boolean => {
    const parent = ownerOf(moreKey);
    return parent === null || parent === FOCUS_KEY || open.has(parent) || groups.has(parent);
  };
  return { open, groups, more: new Map([...current.more].filter(([moreKey]) => alive(moreKey))) };
}

/** The selection bar's "Show their links": several cards open together, nothing closes. */
export function openTogether(current: OpenSets, keys: readonly string[]): OpenSets {
  return { open: new Set([...current.open, ...keys]), groups: current.groups, more: current.more };
}
