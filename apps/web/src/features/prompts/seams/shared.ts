import type { useTranslations } from 'next-intl';

/** The catalog's translator at its root: an entry of any package names its own keys in full ("prompts.fanout.tab"). */
export type Translate = ReturnType<typeof useTranslations<never>>;

/** Throws when two ids repeat: a menu, a tab row or a column chooser keys its items by id. */
export function assertUniqueIds(ids: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${what}: the id "${id}" is used twice`);
    seen.add(id);
  }
}

/**
 * `base` with the items of each insertion after the item `after` names (an item an earlier insertion placed
 * included), or at the end without `after`. Two insertions after the same id keep their order. Throws when `after`
 * names no item, or when the result repeats an id, so a bad entry fails its own package's test instead of hiding a
 * tab or a column.
 */
export function placeAfter<T>(
  base: readonly T[],
  insertions: readonly { after?: string | undefined; items: readonly T[] }[],
  idOf: (item: T) => string,
): T[] {
  const placed = [...base];
  // The last item each anchor's insertions placed: the next insertion after the same anchor follows it
  const lastAfter = new Map<string, T>();
  for (const { after, items } of insertions) {
    if (items.length === 0) continue;
    let at = placed.length;
    if (after !== undefined) {
      const anchor = lastAfter.get(after) ?? placed.find((item) => idOf(item) === after);
      const found = anchor === undefined ? -1 : placed.indexOf(anchor);
      if (found < 0) throw new Error(`placeAfter: no item has the id "${after}" to place after`);
      at = found + 1;
      const last = items.at(-1);
      if (last !== undefined) lastAfter.set(after, last);
    }
    placed.splice(at, 0, ...items);
  }
  assertUniqueIds(placed.map(idOf), 'placeAfter');
  return placed;
}

/** The tab the address asks for when it is one of `tabs`, else the first one (Latest, Overview). */
export function chosenTab(tabs: readonly { id: string }[], requested: string): string {
  return tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? requested;
}
