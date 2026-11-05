import { gscCount, gscStateOf, type GscState } from '../gsc-counts';
import { gscTrendOf, sumBuckets } from '../gsc-trend';
import { idsOfPair, type PairedRow } from '../keyword-pairs';

export const NOT_GROUPED = '__none';
export const GROUP_PREVIEW = 8;

export interface GroupMeasures {
  /** Distinct keywords. */
  size: number;
  /** Distinct keywords ranked this high, each at the place (country) it ranks best in. */
  top3: number;
  top10: number;
  top20: number;
  /** Search volume summed over every place of every keyword (a keyword in two countries adds both). */
  volume: number;
  /** Mean CPC over the places that have one above zero, in USD; null when none has. */
  cpc: number | null;
  /** Distinct keywords the site is cited for in the AI Overview in any of their places. */
  cited: number;
  /** The newest check time among the keywords, ISO; null when none was checked. */
  updated: string | null;
  /** Search Console clicks and impressions of the last 28 days over every place; null while `gscState` is not `ok`. */
  clicks: number | null;
  impressions: number | null;
  /**
   * The 4-day buckets of the same rows summed bucket by bucket, so they add up to `clicks` and `impressions`; null
   * with them, and null when no counted row has buckets.
   */
  clicksTrend: number[] | null;
  impressionsTrend: number[] | null;
  /** `ok` when any keyword has counts; otherwise `pending` if one waits for the first pull, else `not_connected`. */
  gscState: GscState;
}

export interface GroupData {
  groupId: string;
  /** The group's path, or the "Not grouped" label. */
  label: string;
  rows: readonly PairedRow[];
  measures: GroupMeasures;
  /** Tracked keyword ids behind every keyword of the group, both devices of each. */
  memberIds: readonly string[];
}

/**
 * A row of the table. A keyword row is one place (country, language) of a keyword, so a keyword in two
 * countries has two; a group's `size` counts keywords, while the `hidden` of a `more` row counts the keyword
 * rows (places) not yet shown.
 */
export type GroupedRow =
  | { kind: 'group'; id: string; group: GroupData; expanded: boolean }
  | { kind: 'keyword'; id: string; groupId: string; row: PairedRow }
  | { kind: 'more'; id: string; groupId: string; hidden: number };

export type GroupSort = { by: 'size' | 'name' | 'volume' | 'rank'; desc: boolean };

export interface GroupedSelection {
  selectedIds: Set<string>;
  indeterminateIds: Set<string>;
}

const DEFAULT_SORT: GroupSort = { by: 'size', desc: true };

/** The rank a row shows, or null when it is not ranked. */
const rankOf = (row: PairedRow): number | null =>
  row.state.current.state === 'ranked' ? row.state.current.rank : null;

/** Best (lowest) rank first, rows without one last. */
const byRank = (a: number | null, b: number | null): number => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a - b;
};

/**
 * The figures of a group's rows. Keywords are counted once however many places (countries) they are tracked
 * in: `size` and the rank buckets by the place a keyword ranks best in (the first when none ranks). Volume,
 * CPC and the AI Overview citation are read over every place, and the newest check time over every row.
 */
export function groupMeasures(rows: readonly PairedRow[]): GroupMeasures {
  const best = new Map<string, PairedRow>();
  const citedKeywords = new Set<string>();
  let volume = 0;
  let cpcSum = 0;
  let cpcCount = 0;
  let updated: string | null = null;
  let clicks = 0;
  let impressions = 0;
  const clicksSeries: (readonly number[])[] = [];
  const impressionsSeries: (readonly number[])[] = [];
  let counted = false;
  let waiting = false;
  for (const row of rows) {
    const rowClicks = gscCount(row, 'clicks');
    const rowImpressions = gscCount(row, 'impressions');
    if (rowClicks !== null || rowImpressions !== null) {
      counted = true;
      clicks += rowClicks ?? 0;
      impressions += rowImpressions ?? 0;
      const clicksTrend = gscTrendOf(row, 'clicks');
      const impressionsTrend = gscTrendOf(row, 'impressions');
      if (clicksTrend !== null) clicksSeries.push(clicksTrend);
      if (impressionsTrend !== null) impressionsSeries.push(impressionsTrend);
    } else if (gscStateOf(row) === 'pending') {
      waiting = true;
    }
    const held = best.get(row.keyword.keyword_id);
    if (held === undefined || byRank(rankOf(row), rankOf(held)) < 0) best.set(row.keyword.keyword_id, row);
    volume += row.metrics?.search_volume.value ?? 0;
    const cpc = Number(row.metrics?.cpc_usd);
    // Number(null) is 0 and Number(undefined) is NaN: neither passes, nor does "", "0.00" or a word
    if (Number.isFinite(cpc) && cpc > 0) {
      cpcSum += cpc;
      cpcCount += 1;
    }
    if (row.state.aio.state === 'present_cited') citedKeywords.add(row.keyword.keyword_id);
    const seen = row.state.last_observed_at;
    if (seen !== null && (updated === null || Date.parse(seen) > Date.parse(updated))) updated = seen;
  }
  let top3 = 0;
  let top10 = 0;
  let top20 = 0;
  for (const row of best.values()) {
    const rank = rankOf(row);
    if (rank === null) continue;
    if (rank <= 3) top3 += 1;
    if (rank <= 10) top10 += 1;
    if (rank <= 20) top20 += 1;
  }
  return {
    size: best.size,
    top3,
    top10,
    top20,
    volume,
    cpc: cpcCount === 0 ? null : cpcSum / cpcCount,
    cited: citedKeywords.size,
    updated,
    clicks: counted ? clicks : null,
    impressions: counted ? impressions : null,
    clicksTrend: sumBuckets(clicksSeries),
    impressionsTrend: sumBuckets(impressionsSeries),
    gscState: counted ? 'ok' : waiting ? 'pending' : 'not_connected',
  };
}

/**
 * One group per direct group of the keywords, in the order each first appears, and "Not grouped" last for the
 * keywords that sit in none. A keyword in several groups is listed under each.
 */
export function buildGroups(rows: readonly PairedRow[], notGroupedLabel: string): GroupData[] {
  const found = new Map<string, { label: string; rows: PairedRow[] }>();
  const add = (groupId: string, label: string, row: PairedRow): void => {
    const group = found.get(groupId) ?? { label, rows: [] };
    group.rows.push(row);
    found.set(groupId, group);
  };
  for (const row of rows) {
    const refs = row.groups ?? [];
    if (refs.length === 0) add(NOT_GROUPED, notGroupedLabel, row);
    for (const ref of new Map(refs.map((group) => [group.group_id, group])).values()) {
      add(ref.group_id, ref.path, row);
    }
  }
  const built = [...found].map(([groupId, group]): GroupData => ({
    groupId,
    label: group.label,
    rows: group.rows,
    measures: groupMeasures(group.rows),
    memberIds: [...new Set(group.rows.flatMap(idsOfPair))],
  }));
  return [...built.filter((g) => g.groupId !== NOT_GROUPED), ...built.filter((g) => g.groupId === NOT_GROUPED)];
}

/** The group of this id among the rows, built as the By group view builds it; `null` when no row is in it. */
export function findGroup(rows: readonly PairedRow[], groupId: string, notGroupedLabel: string): GroupData | null {
  return buildGroups(rows, notGroupedLabel).find((group) => group.groupId === groupId) ?? null;
}

/** A group's keyword rows in the order they are listed: best rank first, then by keyword. */
export const keywordsInOrder = (group: GroupData): PairedRow[] =>
  [...group.rows].sort((a, b) => byRank(rankOf(a), rankOf(b)) || a.keyword.text.localeCompare(b.keyword.text));

/** The best (lowest) rank among a group's keywords. */
const bestRankOf = (group: GroupData): number | null =>
  group.rows.reduce<number | null>((best, row) => (byRank(rankOf(row), best) < 0 ? rankOf(row) : best), null);

/** Groups in the order asked, "Not grouped" always last; a group without a rank is last by rank, either way. */
function sortGroups(groups: readonly GroupData[], sort: GroupSort): GroupData[] {
  const direction = sort.desc ? -1 : 1;
  // Once per group, not inside the comparator
  const bestRanks = new Map<string, number | null>();
  if (sort.by === 'rank') for (const group of groups) bestRanks.set(group.groupId, bestRankOf(group));
  const compare = (a: GroupData, b: GroupData): number => {
    switch (sort.by) {
      case 'size':
        return direction * (a.measures.size - b.measures.size);
      case 'volume':
        return direction * (a.measures.volume - b.measures.volume);
      case 'name':
        return direction * a.label.localeCompare(b.label);
      case 'rank': {
        const x = bestRanks.get(a.groupId) ?? null;
        const y = bestRanks.get(b.groupId) ?? null;
        return x === null || y === null ? byRank(x, y) : direction * (x - y);
      }
    }
  };
  const named = groups.filter((group) => group.groupId !== NOT_GROUPED);
  const none = groups.filter((group) => group.groupId === NOT_GROUPED);
  // The sort is stable, so equal groups keep the order they first appeared in
  return [...named.sort(compare), ...none];
}

/**
 * The rows the table shows, in order: a row per group, and under a group that is open its keywords (best rank
 * first), the first GROUP_PREVIEW of them unless the group is in `showAll`, then a row to show the rest.
 */
export function groupedRows({
  rows,
  notGroupedLabel,
  expanded,
  showAll,
  sort = DEFAULT_SORT,
}: {
  rows: readonly PairedRow[];
  notGroupedLabel: string;
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  sort?: GroupSort;
}): GroupedRow[] {
  const list: GroupedRow[] = [];
  for (const group of sortGroups(buildGroups(rows, notGroupedLabel), sort)) {
    const open = expanded.has(group.groupId);
    list.push({ kind: 'group', id: `group:${group.groupId}`, group, expanded: open });
    if (!open) continue;
    const keywords = keywordsInOrder(group);
    const shown = showAll.has(group.groupId) ? keywords : keywords.slice(0, GROUP_PREVIEW);
    for (const row of shown) {
      list.push({ kind: 'keyword', id: `${group.groupId}:${row.tracked_keyword_id}`, groupId: group.groupId, row });
    }
    if (shown.length < keywords.length) {
      list.push({
        kind: 'more',
        id: `more:${group.groupId}`,
        groupId: group.groupId,
        hidden: keywords.length - shown.length,
      });
    }
  }
  return list;
}

/** A keyword is chosen when any tracked id behind it is, so a choice made on the other device still counts. */
const isChosen = (row: PairedRow, chosen: ReadonlySet<string>): boolean => idsOfPair(row).some((id) => chosen.has(id));

/**
 * The table's selected and partly selected row ids for the chosen tracked ids: a keyword row is selected when
 * its keyword is chosen (every copy of it, under every group); a group row when all its keywords are, partly
 * when some are.
 */
export function selectionOf(rows: readonly GroupedRow[], chosen: ReadonlySet<string>): GroupedSelection {
  const selectedIds = new Set<string>();
  const indeterminateIds = new Set<string>();
  for (const entry of rows) {
    if (entry.kind === 'keyword') {
      if (isChosen(entry.row, chosen)) selectedIds.add(entry.id);
    } else if (entry.kind === 'group') {
      const count = entry.group.rows.filter((row) => isChosen(row, chosen)).length;
      if (count === entry.group.rows.length) selectedIds.add(entry.id);
      else if (count > 0) indeterminateIds.add(entry.id);
    }
  }
  return { selectedIds, indeterminateIds };
}

/**
 * Every tracked id behind a group's keywords, both devices, not only the rows the table shows: what an action
 * on the group reaches, and what unticking it removes.
 */
export const trackedIdsOf = (group: GroupData): readonly string[] => group.memberIds;

/**
 * The tracked id each keyword row of the group shows, one per row: what ticking the group adds, so the chosen
 * ids stay a count of keyword rows as in the flat view (the other device's id is added when an action runs).
 */
export const shownIdsOf = (group: GroupData): readonly string[] => group.rows.map((row) => row.tracked_keyword_id);

/** The chosen ids with the whole group added (its shown ids), or removed (both devices) when all was chosen. */
export function toggleGroupIds(chosen: ReadonlySet<string>, group: GroupData): Set<string> {
  const next = new Set(chosen);
  if (group.rows.every((row) => isChosen(row, chosen))) {
    for (const id of trackedIdsOf(group)) next.delete(id);
  } else {
    for (const id of shownIdsOf(group)) next.add(id);
  }
  return next;
}

/**
 * The chosen tracked ids after the table changed its selected row ids from `previous` to `next`. An added
 * group row adds the shown id of each of its keyword rows, an added keyword row adds the id of the row it
 * shows; a removed group row or keyword row removes the keywords on both devices.
 * A keyword is one choice however many groups list it: unticking any copy unchooses it, and when one change
 * adds one copy and removes another, the removal wins.
 */
export function applySelectionChange(
  chosen: ReadonlySet<string>,
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
  rows: readonly GroupedRow[],
): Set<string> {
  const byId = new Map(rows.map((entry) => [entry.id, entry]));
  const result = new Set(chosen);
  for (const id of next) {
    if (previous.has(id)) continue;
    const entry = byId.get(id);
    if (entry?.kind === 'group') for (const shownId of shownIdsOf(entry.group)) result.add(shownId);
    else if (entry?.kind === 'keyword') result.add(entry.row.tracked_keyword_id);
  }
  for (const id of previous) {
    if (next.has(id)) continue;
    const entry = byId.get(id);
    if (entry?.kind === 'group') for (const memberId of trackedIdsOf(entry.group)) result.delete(memberId);
    else if (entry?.kind === 'keyword') for (const memberId of idsOfPair(entry.row)) result.delete(memberId);
  }
  return result;
}
