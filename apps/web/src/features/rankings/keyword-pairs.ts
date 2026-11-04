import type { TrackedKeywordRow } from '@/lib/api/types';

/**
 * A keyword is tracked on each device as a row of its own, so the API lists one keyword twice. The table shows
 * it once, as the device the Device scope control chose: this pairs the rows, so an action on a keyword still
 * reaches both devices. A pair is the rows of one keyword in one place and language on one search engine.
 */

export type Device = TrackedKeywordRow['device'];

/** The row the table shows for a keyword, and the rows of each device behind it (null where not tracked). */
export interface PairedRow extends TrackedKeywordRow {
  devices: { desktop: TrackedKeywordRow | null; mobile: TrackedKeywordRow | null };
}

const keyOf = (row: TrackedKeywordRow): string =>
  [row.keyword.keyword_id, row.location_id, row.language_code, row.search_engine].join('|');

/**
 * The rows paired, in the order each keyword first appears, for the device the table shows. The row a pair
 * shows is that device's row, so everything the table reads from it (rank, features, AI Overview, trend, the
 * ranking URL, the check time) is that device's own; a keyword not tracked on the device is left out.
 */
export function pairRows(rows: readonly TrackedKeywordRow[], device: Device): PairedRow[] {
  type Devices = { desktop: TrackedKeywordRow | null; mobile: TrackedKeywordRow | null };
  const groups = new Map<string, Devices[]>();
  const order: Devices[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const found = groups.get(key) ?? [];
    // A row whose device is already taken in every group (an operating system variant) is a row of its own, so
    // nothing the API lists is left out of the table
    let group = found.find((candidate) => candidate[row.device] === null);
    if (group === undefined) {
      group = { desktop: null, mobile: null };
      found.push(group);
      order.push(group);
    }
    group[row.device] = row;
    groups.set(key, found);
  }
  const paired: PairedRow[] = [];
  for (const devices of order) {
    const primary = devices[device];
    if (primary === null) continue;
    paired.push({ ...primary, devices });
  }
  return paired;
}

/** The tracked keyword ids behind each shown row, by the shown row's id. */
export function memberIds(rows: readonly PairedRow[]): ReadonlyMap<string, readonly string[]> {
  return new Map(
    rows.map((row) => [
      row.tracked_keyword_id,
      [row.devices.desktop, row.devices.mobile]
        .filter((member): member is TrackedKeywordRow => member !== null)
        .map((member) => member.tracked_keyword_id),
    ]),
  );
}

/** The chosen ids with the other device's id of every chosen keyword added: an action reaches both. */
export function expandIds(ids: ReadonlySet<string>, members: ReadonlyMap<string, readonly string[]>): Set<string> {
  const all = new Set<string>();
  for (const id of ids) {
    all.add(id);
    for (const member of members.get(id) ?? []) all.add(member);
  }
  return all;
}

/** The rows behind the shown rows: both devices of each. */
export function memberRows(rows: readonly PairedRow[]): TrackedKeywordRow[] {
  return rows.flatMap((row) => [row.devices.desktop, row.devices.mobile]).filter((r) => r !== null);
}
