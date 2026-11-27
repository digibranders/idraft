import { shownPages, type CannState, type CannView, type TargetStatus, type Verdict } from './cann-model';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import type { CannKeyword, CannPair, CannPage, CannSwitchRow } from '@/lib/api/types';

/**
 * The CSV of the table in view: the rows the page has read, after its filters and in its order, with the header words
 * handed in (they come from the message catalog). A cell with nothing to say is left empty.
 */

type Header<Key extends string> = Readonly<Record<Key, string>>;

export const KEYWORD_COLUMNS = [
  'keyword',
  'status',
  'pages',
  'rank',
  'gap',
  'switches',
  'together',
  'volume',
  'rankingPage',
] as const;
export const PAIR_COLUMNS = ['pageA', 'pageB', 'keywords', 'volume', 'likely', 'aLeads', 'bLeads', 'overlap'] as const;
export const CHANGE_COLUMNS = [
  'keyword',
  'when',
  'from',
  'to',
  'rankBefore',
  'rankAfter',
  'held',
  'type',
  'target',
] as const;
export const SWITCH_KEYWORD_COLUMNS = [
  'keyword',
  'now',
  'switches',
  'flipFlops',
  'pages',
  'heldNow',
  'longest',
] as const;

export const headerWords = <Key extends string>(columns: readonly Key[], label: (key: Key) => string): Header<Key> =>
  Object.fromEntries(columns.map((key) => [key, label(key)])) as Header<Key>;

const headerOf = <Key extends string>(columns: readonly Key[], words: Header<Key>): string[] =>
  columns.map((key) => words[key]);

const pageLine = (page: Pick<CannPage, 'letter' | 'path'>): string => `${page.letter} ${page.path}`;
const percent = (share: number): number => Math.round(share * 100);

export interface KeywordWords {
  header: Header<(typeof KEYWORD_COLUMNS)[number]>;
  status: (verdict: Verdict) => string;
}

/** By keyword (Cannibalization tab): one line per keyword, its pages as "A /path; B /path". */
export function keywordTable(rows: readonly CannKeyword[], words: KeywordWords): CsvTable {
  return {
    header: headerOf(KEYWORD_COLUMNS, words.header),
    rows: rows.map((row): CsvCell[] => {
      const current = row.pages.find((page) => page.url_id === row.current_url_id);
      return [
        safeText(row.keyword),
        words.status(row.verdict),
        safeText(shownPages(row).map(pageLine).join('; ')),
        row.current_rank,
        row.rank_gap > 0 ? Math.round(row.rank_gap) : 0,
        row.switches.length,
        percent(row.together_rate),
        row.volume,
        current === undefined ? null : safeText(current.path),
      ];
    }),
  };
}

export interface PairWords {
  header: Header<(typeof PAIR_COLUMNS)[number]>;
}

/** By page pair: the two pages by address and their counts. */
export function pairTable(rows: readonly CannPair[], words: PairWords): CsvTable {
  return {
    header: headerOf(PAIR_COLUMNS, words.header),
    rows: rows.map((pair): CsvCell[] => [
      safeText(pair.a.path),
      safeText(pair.b.path),
      pair.keywords,
      pair.volume,
      pair.likely,
      pair.a_leads,
      pair.b_leads,
      pair.title_overlap === null ? null : percent(pair.title_overlap),
    ]),
  };
}

export interface ChangeWords {
  header: Header<(typeof CHANGE_COLUMNS)[number]>;
  type: (flipFlop: boolean) => string;
  target: (status: TargetStatus) => string;
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** Changes (Switching tab): one line per confirmed switch, with the date as written in the data. */
export function changeTable(
  rows: readonly { row: CannSwitchRow; target: TargetStatus }[],
  words: ChangeWords,
): CsvTable {
  return {
    header: headerOf(CHANGE_COLUMNS, words.header),
    rows: rows.map(({ row, target }): CsvCell[] => [
      safeText(row.keyword),
      row.event.date,
      safeText(pathOf(row.from_url)),
      safeText(pathOf(row.to_url)),
      row.event.rank_before,
      row.event.rank_after,
      row.event.held_days,
      words.type(row.event.is_flip_flop),
      words.target(target),
    ]),
  };
}

export interface SwitchKeywordWords {
  header: Header<(typeof SWITCH_KEYWORD_COLUMNS)[number]>;
}

/** By keyword (Switching tab). */
export function switchKeywordTable(rows: readonly CannKeyword[], words: SwitchKeywordWords): CsvTable {
  return {
    header: headerOf(SWITCH_KEYWORD_COLUMNS, words.header),
    rows: rows.map((row): CsvCell[] => {
      const now = row.pages.find((page) => page.url_id === row.current_url_id);
      return [
        safeText(row.keyword),
        now === undefined ? null : safeText(now.path),
        row.switches.length,
        row.flip_flops,
        row.pages.filter((page) => page.best_count > 0).length,
        row.held_now_days,
        row.longest_hold_days,
      ];
    }),
  };
}

export type ExportTableId = 'keywords' | 'pairs' | 'changes' | 'switch-keywords';

export const exportTableId = (tab: 'cannibalization' | 'switching', view: CannView): ExportTableId => {
  if (view === 'pairs') return 'pairs';
  if (tab === 'switching') return view === 'changes' ? 'changes' : 'switch-keywords';
  return 'keywords';
};

/** `cannibalization-keywords-desktop-30d-2026-11-26.csv`: the table, the scope and the last day of the period. */
export function exportFileName(
  table: ExportTableId,
  scope: Pick<CannState, 'device' | 'days'>,
  dateTo: string | undefined,
): string {
  const parts = [
    'cannibalization',
    table,
    scope.device,
    `${String(scope.days)}d`,
    ...(dateTo === undefined ? [] : [dateTo]),
  ];
  return `${parts.join('-')}.csv`;
}

/** What the Export button needs about the table in view: how to build the file, and how many rows it holds. */
export interface ExportSpec {
  table: ExportTableId;
  fileName: string;
  /** Rows in the file. */
  rows: number;
  /** Rows the page read, and the rows that exist when the read stopped short. */
  truncated: { read: number; total: number } | null;
  build: () => CsvTable;
}
