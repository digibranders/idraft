import type { FeedItem } from './feed-row';

/** Most items the Key changes card shows (23-application-patterns.md section 9.2). */
export const CHANGE_FEED_MAX = 8;

export type ChangeFeedGroup = 'needs_attention' | 'changes' | 'notices';

export interface ChangeFeedItem extends FeedItem {
  group: ChangeFeedGroup;
}

export interface ChangeFeedSection {
  group: ChangeFeedGroup;
  items: readonly ChangeFeedItem[];
}

/** The order of the groups: by severity. */
const GROUP_ORDER: readonly ChangeFeedGroup[] = ['needs_attention', 'changes', 'notices'];

/** An instant that cannot be read sorts after every real one. */
function instant(at: string): number {
  const time = Date.parse(at);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function newestFirst(a: ChangeFeedItem, b: ChangeFeedItem): number {
  const byTime = instant(b.at) - instant(a.at);
  // -Infinity minus -Infinity is NaN: two unreadable instants fall through to the id
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Needs attention, Changes, Notices; newest first inside a group (ties by id); at most `max` items in all, taken
 * in that order; empty groups left out.
 */
export function groupChangeFeed(
  items: readonly ChangeFeedItem[],
  max: number = CHANGE_FEED_MAX,
): readonly ChangeFeedSection[] {
  let room = Math.max(0, max);
  const sections: ChangeFeedSection[] = [];
  for (const group of GROUP_ORDER) {
    if (room === 0) break;
    const shown = items
      .filter((item) => item.group === group)
      .sort(newestFirst)
      .slice(0, room);
    if (shown.length === 0) continue;
    room -= shown.length;
    sections.push({ group, items: shown });
  }
  return sections;
}

/** How many of `items` were not in `previousIds`. */
export function countNewItems(previousIds: ReadonlySet<string>, items: readonly { id: string }[]): number {
  return items.filter((item) => !previousIds.has(item.id)).length;
}
