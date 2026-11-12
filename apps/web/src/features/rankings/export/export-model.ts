import type { RankCell, TrackedKeywordRow } from '@/lib/api/types';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { gscCount } from '../gsc-counts';
import type { Device, PairedRow } from '../keyword-pairs';

/** A cell of the exported table: text, a number, or nothing. */
export type ExportCell = CsvCell;

export interface ExportKpi {
  label: string;
  value: number;
}

/** What a column holds, so the workbook can align, format and size it without reading its header. */
export type ExportColumnKind =
  | 'keyword'
  | 'rank'
  | 'url'
  | 'volume'
  | 'clicks'
  | 'impressions'
  | 'difficulty'
  | 'cpc'
  | 'intent'
  | 'priority'
  | 'groups'
  | 'checked';

/** The words of the file, from the catalog, so the model itself holds no text a person reads. */
export interface ExportLabels {
  keyword: string;
  rank: string;
  desktop: string;
  mobile: string;
  url: string;
  volume: string;
  clicks: string;
  impressions: string;
  difficulty: string;
  cpc: string;
  intent: string;
  priority: string;
  groups: string;
  checked: string;
  keywords: string;
  top3: string;
  top10: string;
  top20: string;
  /** The name of each intent as the table shows it; an intent without a name leaves its cell empty. */
  intents: Readonly<Record<string, string>>;
}

export interface KeywordExport {
  /** Counts of the tracked keywords of the device shown, as the strip above the table shows them. */
  kpis: ExportKpi[];
  header: string[];
  /** The kind of each column, in the order of the header. */
  kinds: ExportColumnKind[];
  rows: ExportCell[][];
}

const TOPS = [3, 10, 20] as const;

/** A rank as a number up to the depth read; beyond it `>` and that depth; nothing for a keyword not checked yet. */
export function rankCell(cell: RankCell | undefined): ExportCell {
  if (cell === undefined) return null;
  if (cell.state === 'ranked' && cell.rank !== null) return cell.rank;
  if (cell.state === 'beyond_depth' && cell.depth_requested !== null) return `>${String(cell.depth_requested)}`;
  return null;
}

/** The tracked keyword of a row on the device shown, or none when it is not tracked there. */
function trackedIn(row: PairedRow, device: Device): TrackedKeywordRow[] {
  const found = row.devices[device];
  return found === null ? [] : [found];
}

/** A figure the API sends as a number or as a decimal string, as a number. */
function number(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestCheck(tracked: readonly TrackedKeywordRow[]): string | null {
  const times = tracked.map((row) => row.state.current.observed_at).filter((at): at is string => at !== null);
  const latest = times.sort().at(-1);
  // Whole minutes in UTC, so the same check reads the same in every file
  return latest === undefined ? null : `${latest.slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The table as it is shown, one row for each keyword with its rank on the device shown, and the counts
 * of the strip above it: the keywords of the device shown, and those in the top 3, 10 and 20.
 */
export function buildExport(rows: readonly PairedRow[], device: Device, labels: ExportLabels): KeywordExport {
  const tracked = rows.flatMap((row) => trackedIn(row, device));
  const within = (limit: number): number =>
    tracked.filter((row) => row.state.current.state === 'ranked' && (row.state.current.rank ?? Infinity) <= limit)
      .length;
  const kpis: ExportKpi[] = [
    { label: labels.keywords, value: tracked.length },
    { label: labels.top3, value: within(TOPS[0]) },
    { label: labels.top10, value: within(TOPS[1]) },
    { label: labels.top20, value: within(TOPS[2]) },
  ];
  const columns: [ExportColumnKind, string][] = [
    ['keyword', labels.keyword],
    ['rank', `${labels.rank} (${labels[device]})`],
    ['url', labels.url],
    ['volume', labels.volume],
    ['clicks', labels.clicks],
    ['impressions', labels.impressions],
    ['difficulty', labels.difficulty],
    ['cpc', labels.cpc],
    ['intent', labels.intent],
    ['priority', labels.priority],
    ['groups', labels.groups],
    ['checked', labels.checked],
  ];
  const header = columns.map(([, label]) => label);
  const kinds = columns.map(([kind]) => kind);
  const body = rows.map((row): ExportCell[] => {
    const current = row.devices[device]?.state.current;
    return [
      safeText(row.keyword.text),
      rankCell(current),
      current?.state === 'ranked' ? (current.url?.canonical_url ?? null) : null,
      number(row.metrics?.search_volume.value),
      gscCount(row, 'clicks'),
      gscCount(row, 'impressions'),
      row.metrics?.keyword_difficulty ?? null,
      number(row.metrics?.cpc_usd),
      labels.intents[row.intent] ?? null,
      row.priority,
      (row.groups ?? []).map((group) => group.path).join('; ') || null,
      latestCheck(trackedIn(row, device)),
    ];
  });
  return { kpis, header, kinds, rows: body };
}
