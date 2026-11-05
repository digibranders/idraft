import { memberIds, type PairedRow } from '../keyword-pairs';

export const NOT_GROUPED = '__none';
export const GROUP_PREVIEW = 8;

export interface GroupMeasures {
  /** Distinct keywords. */
  size: number;
  top3: number;
  top10: number;
  top20: number;
  volume: number;
  /** Mean CPC of the keywords that have one, in USD; null when none has. */
  cpc: number | null;
  /** Keywords the site is cited for in the AI Overview. */
  cited: number;
  /** The newest check time among the keywords, ISO; null when none was checked. */
  updated: string | null;
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

/** Every tracked id behind a shown row: both devices. */
const idsOfRow = (row: PairedRow): readonly string[] => memberIds([row]).get(row.tracked_keyword_id) ?? [];

/**
 * The figures of a group's rows. A keyword tracked in several places counts once, by the place it ranks best
 * in (the first when none ranks); the newest check time is read over every row.
 */
export function groupMeasures(rows: readonly PairedRow[]): GroupMeasures {
  const best = new Map<string, PairedRow>();
  for (const row of rows) {
    const held = best.get(row.keyword.keyword_id);
    if (held === undefined || byRank(rankOf(row), rankOf(held)) < 0) best.set(row.keyword.keyword_id, row);
  }
  let top3 = 0;
  let top10 = 0;
  let top20 = 0;
  let volume = 0;
  let cited = 0;
  let cpcSum = 0;
  let cpcCount = 0;
  for (const row of best.values()) {
    const rank = rankOf(row);
    if (rank !== null) {
      if (rank <= 3) top3 += 1;
      if (rank <= 10) top10 += 1;
      if (rank <= 20) top20 += 1;
    }
    volume += row.metrics?.search_volume.value ?? 0;
    const cpc = row.metrics?.cpc_usd == null ? Number.NaN : Number(row.metrics.cpc_usd);
    if (Number.isFinite(cpc)) {
      cpcSum += cpc;
      cpcCount += 1;
    }
    if (row.state.aio.state === 'present_cited') cited += 1;
  }
  let updated: string | null = null;
  for (const row of rows) {
    const seen = row.state.last_observed_at;
    if (seen !== null && (updated === null || Date.parse(seen) > Date.parse(updated))) updated = seen;
  }
  return {
    size: best.size,
    top3,
    top10,
    top20,
    volume,
    cpc: cpcCount === 0 ? null : cpcSum / cpcCount,
    cited,
    updated,
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
    memberIds: [...new Set(group.rows.flatMap(idsOfRow))],
  }));
  return [...built.filter((g) => g.groupId !== NOT_GROUPED), ...built.filter((g) => g.groupId === NOT_GROUPED)];
}

/** The best (lowest) rank among a group's keywords. */
const bestRankOf = (group: GroupData): number | null =>
  group.rows.reduce<number | null>((best, row) => (byRank(rankOf(row), best) < 0 ? rankOf(row) : best), null);

/** Groups in the order asked, "Not grouped" always last; a group without a rank is last by rank, either way. */
function sortGroups(groups: readonly GroupData[], sort: GroupSort): GroupData[] {
  const direction = sort.desc ? -1 : 1;
  const compare = (a: GroupData, b: GroupData): number => {
    switch (sort.by) {
      case 'size':
        return direction * (a.measures.size - b.measures.size);
      case 'volume':
        return direction * (a.measures.volume - b.measures.volume);
      case 'name':
        return direction * a.label.localeCompare(b.label);
      case 'rank': {
        const [x, y] = [bestRankOf(a), bestRankOf(b)];
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
    const keywords = [...group.rows].sort(
      (a, b) => byRank(rankOf(a), rankOf(b)) || a.keyword.text.localeCompare(b.keyword.text),
    );
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
const isChosen = (row: PairedRow, chosen: ReadonlySet<string>): boolean => idsOfRow(row).some((id) => chosen.has(id));

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

/** Every tracked id behind a group's keywords, both devices, not only the rows the table shows. */
export const trackedIdsOf = (group: GroupData): readonly string[] => group.memberIds;

/** The chosen ids with the whole group added, or removed when all of it was chosen already. */
export function toggleGroupIds(chosen: ReadonlySet<string>, group: GroupData): Set<string> {
  const next = new Set(chosen);
  const all = group.rows.every((row) => isChosen(row, chosen));
  for (const id of trackedIdsOf(group)) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/**
 * The chosen tracked ids after the table changed its selected row ids from `previous` to `next`. An added
 * group row adds all its keywords, an added keyword row adds that keyword (the id of the row it shows); a
 * removed group row removes all its keywords, a removed keyword row removes that keyword on both devices.
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
    if (entry?.kind === 'group') for (const memberId of trackedIdsOf(entry.group)) result.add(memberId);
    else if (entry?.kind === 'keyword') result.add(entry.row.tracked_keyword_id);
  }
  for (const id of previous) {
    if (next.has(id)) continue;
    const entry = byId.get(id);
    if (entry?.kind === 'group') for (const memberId of trackedIdsOf(entry.group)) result.delete(memberId);
    else if (entry?.kind === 'keyword') for (const memberId of idsOfRow(entry.row)) result.delete(memberId);
  }
  return result;
}
