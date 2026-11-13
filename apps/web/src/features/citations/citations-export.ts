import type { CitationTab, DateWindow } from './citation-scope';
import type { EngineInScope } from './engine-share';
import { shareChange, unitShare } from '@/lib/citations/share-model';
import type { DomainRole, SourceDomainRow, SourcePageRow, SourcesMeta } from '@/lib/citations/types';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';

/**
 * The CSV of a Citations tab (plan D13, WB-CIT-16), written on this side from the rows the tab has loaded: a
 * file holds no row the table does not, and the toast says how many of how many it holds. Numbers are numbers,
 * a share is a percent with its units and the total it is of beside it, every text is written so a spreadsheet
 * does not read it as a formula (12-tables.md section 17), and no category is written while none is returned.
 */

/** The rows of the tab that is shown. One value, so the tab and its rows cannot disagree. */
export type ExportRows =
  { tab: 'domains'; rows: readonly SourceDomainRow[] } | { tab: 'pages'; rows: readonly SourcePageRow[] };

/** What a tab hands the page's Export button: the rows it lists, how many the scope has, and the totals they are of. */
export interface ExportSource {
  rows: ExportRows;
  /** Every row the scope has: more than `rows` when the tab lists the first 200 or a search narrows them. */
  total: number;
  meta: SourcesMeta;
}

/** The words of the file, from the catalog, so this model holds no text a person reads. */
export interface CitationsExportLabels {
  domain: string;
  url: string;
  title: string;
  role: string;
  roleName: (role: DomainRole) => string;
  units: string;
  share: string;
  total: string;
  answers: string;
  prompts: string;
  /** The header of an engine's units, given the engine's label. */
  engineUnits: (engine: string) => string;
  change: string;
  citedWith: string;
  noneNamed: string;
  firstSeen: string;
  lastSeen: string;
  /** The name of a tracked entity, or `undefined` while the entities are not known. */
  entityName: (entityId: string) => string | undefined;
}

/** A ratio as a percent to two decimals, as a number a spreadsheet can sum and sort. */
const percentOf = (ratio: number | null): number | null => (ratio === null ? null : Math.round(ratio * 10000) / 100);

const unitsOn = (row: { engines: SourceDomainRow['engines'] }, code: string): number =>
  row.engines.find((engine) => engine.engine_code === code)?.citation_units ?? 0;

/** The change of a share in points; empty when it cannot be told (no row before, no answers before). */
function changeOf(
  row: Pick<SourceDomainRow, 'source_share' | 'previous'>,
  meta: SourcesMeta,
  previousMeta: SourcesMeta,
): number | null {
  const moved = shareChange(row, meta, previousMeta);
  return moved === null ? null : percentOf(moved.delta);
}

/** The figures both files share, from Citation units to the change in share. */
function figuresOf(
  row: SourceDomainRow | SourcePageRow,
  meta: SourcesMeta,
  previousMeta: SourcesMeta | undefined,
  engines: readonly EngineInScope[],
): CsvCell[] {
  const share = unitShare(row.source_share);
  return [
    row.citation_units,
    percentOf(share.value),
    share.total,
    row.observations,
    row.prompts,
    ...engines.map((engine) => unitsOn(row, engine.code)),
    ...(previousMeta === undefined ? [] : [changeOf(row, meta, previousMeta)]),
  ];
}

/** The header of the same figures. */
const figureHeader = (
  labels: CitationsExportLabels,
  engines: readonly EngineInScope[],
  compared: boolean,
): string[] => [
  labels.units,
  labels.share,
  labels.total,
  labels.answers,
  labels.prompts,
  ...engines.map((engine) => labels.engineUnits(engine.label)),
  ...(compared ? [labels.change] : []),
];

function domainTable(
  rows: readonly SourceDomainRow[],
  meta: SourcesMeta,
  previousMeta: SourcesMeta | undefined,
  engines: readonly EngineInScope[],
  labels: CitationsExportLabels,
): CsvTable {
  const citedWith = (row: SourceDomainRow): CsvCell => {
    if (row.cited_with === undefined || row.cited_with === null) return labels.noneNamed;
    const name = labels.entityName(row.cited_with.entity_id);
    return name === undefined ? null : safeText(name);
  };
  return {
    header: [
      labels.domain,
      labels.role,
      ...figureHeader(labels, engines, previousMeta !== undefined),
      labels.citedWith,
    ],
    rows: rows.map((row) => [
      safeText(row.registrable_domain),
      safeText(labels.roleName(row.domain_role)),
      ...figuresOf(row, meta, previousMeta, engines),
      citedWith(row),
    ]),
  };
}

function pageTable(
  rows: readonly SourcePageRow[],
  meta: SourcesMeta,
  previousMeta: SourcesMeta | undefined,
  engines: readonly EngineInScope[],
  labels: CitationsExportLabels,
): CsvTable {
  return {
    header: [
      labels.url,
      labels.title,
      labels.domain,
      labels.role,
      ...figureHeader(labels, engines, previousMeta !== undefined),
      labels.firstSeen,
      labels.lastSeen,
    ],
    rows: rows.map((row) => [
      safeText(row.url),
      row.title === null ? null : safeText(row.title),
      safeText(row.registrable_domain),
      safeText(labels.roleName(row.domain_role)),
      ...figuresOf(row, meta, previousMeta, engines),
      safeText(row.first_seen_at),
      safeText(row.last_seen_at),
    ]),
  };
}

/**
 * The rows as a table to write. `previousMeta` is the period before (its units are what a share change needs):
 * it is `undefined` with the comparison off, and then the file has no Change in share column.
 */
export function buildCitationsExport(
  source: ExportRows,
  meta: SourcesMeta,
  previousMeta: SourcesMeta | undefined,
  engines: readonly EngineInScope[],
  labels: CitationsExportLabels,
): CsvTable {
  return source.tab === 'domains'
    ? domainTable(source.rows, meta, previousMeta, engines, labels)
    : pageTable(source.rows, meta, previousMeta, engines, labels);
}

/** The name of a file: the tab and the window its counts are of. */
export const citationsExportFileName = (tab: CitationTab, range: DateWindow): string =>
  `citations-${tab}-${range.from}-to-${range.to}.csv`;
