import type { RankCell, TrackedKeywordRow } from '@/lib/api/types';
import type { DeviceScope, PairedRow } from '../keyword-pairs';

/** A cell of the exported table: text, a number, or nothing. */
export type ExportCell = string | number | null;

export interface ExportKpi {
  label: string;
  value: number;
}

/** What a column holds, so the workbook can align, format and size it without reading its header. */
export type ExportColumnKind =
  'keyword' | 'rank' | 'url' | 'volume' | 'difficulty' | 'cpc' | 'intent' | 'priority' | 'groups' | 'checked';

/** The words of the file, from the catalog, so the model itself holds no text a person reads. */
export interface ExportLabels {
  keyword: string;
  desktop: string;
  mobile: string;
  url: string;
  volume: string;
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
  /** Counts of tracked keywords, one per device, as the strip above the table shows them. */
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

/** The tracked keywords of a row on the devices the scope shows. */
function trackedIn(row: PairedRow, scope: DeviceScope): TrackedKeywordRow[] {
  const found = scope === 'both' ? [row.devices.desktop, row.devices.mobile] : [row.devices[scope]];
  return found.filter((tracked): tracked is TrackedKeywordRow => tracked !== null);
}

/** A cell that a spreadsheet would read as a formula is written as text (CSV injection). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
 * The table as it is shown, one row for each keyword with a rank for each device chosen, and the counts
 * of the strip above it: the keywords of each device chosen, and those in the top 3, 10 and 20.
 */
export function buildExport(rows: readonly PairedRow[], scope: DeviceScope, labels: ExportLabels): KeywordExport {
  const tracked = rows.flatMap((row) => trackedIn(row, scope));
  const within = (limit: number): number =>
    tracked.filter((row) => row.state.current.state === 'ranked' && (row.state.current.rank ?? Infinity) <= limit)
      .length;
  const kpis: ExportKpi[] = [
    { label: labels.keywords, value: tracked.length },
    { label: labels.top3, value: within(TOPS[0]) },
    { label: labels.top10, value: within(TOPS[1]) },
    { label: labels.top20, value: within(TOPS[2]) },
  ];
  const showDesktop = scope !== 'mobile';
  const showMobile = scope !== 'desktop';
  const columns: [ExportColumnKind, string][] = [
    ['keyword', labels.keyword],
    ...(showDesktop ? [['rank', labels.desktop] as [ExportColumnKind, string]] : []),
    ...(showMobile ? [['rank', labels.mobile] as [ExportColumnKind, string]] : []),
    ['url', labels.url],
    ['volume', labels.volume],
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
    const desktop = row.devices.desktop?.state.current;
    const mobile = row.devices.mobile?.state.current;
    const shown = trackedIn(row, scope);
    const ranking = (scope === 'mobile' ? [mobile, desktop] : [desktop, mobile]).find(
      (cell) => cell?.state === 'ranked' && cell.url !== null,
    );
    return [
      safeText(row.keyword.text),
      ...(showDesktop ? [rankCell(desktop)] : []),
      ...(showMobile ? [rankCell(mobile)] : []),
      ranking?.url?.canonical_url ?? null,
      number(row.metrics?.search_volume.value),
      row.metrics?.keyword_difficulty ?? null,
      number(row.metrics?.cpc_usd),
      labels.intents[row.intent] ?? null,
      row.priority,
      (row.groups ?? []).map((group) => group.path).join('; ') || null,
      latestCheck(shown),
    ];
  });
  return { kpis, header, kinds, rows: body };
}

/** The byte order mark that tells Excel a CSV is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** The text of one CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
function field(cell: ExportCell): string {
  if (cell === null) return '';
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The table alone, as CSV with a byte order mark so Excel reads it as UTF-8. KPIs are left to the workbook: lines above the header would break the table for most tools. */
export function toCsv(table: Pick<KeywordExport, 'header' | 'rows'>): string {
  const lines = [table.header, ...table.rows].map((line) => line.map(field).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
