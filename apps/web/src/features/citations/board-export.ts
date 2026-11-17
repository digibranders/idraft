import type { BoardEngine, TrackedCompetitor } from './board-reads';
import type { CitationsTranslate } from './board-text';
import type { CitationGapRow, CitedPageRow } from '@/lib/citations/board-queries';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { formatIsoDate } from '@/lib/format';

/**
 * The CSV of the tab on screen (brief 3.2: the preview's Export only shows a note; the app writes a file with
 * `@/lib/csv/csv-write`). Text cells go through `safeText`, so a cell a spreadsheet would read as a formula is text.
 */

const text = (value: string | null): CsvCell => (value === null ? null : safeText(value));

export function pagesCsv(
  rows: readonly CitedPageRow[],
  engines: readonly BoardEngine[],
  timeZone: string,
  t: CitationsTranslate,
): CsvTable {
  const role = (row: CitedPageRow): string =>
    row.domain_role === 'own'
      ? t('pages.yourSite')
      : row.domain_role === 'competitor'
        ? t('pageDrawer.competitor')
        : t('pages.thirdParty');
  return {
    header: [
      t('download.url'),
      t('download.title'),
      t('download.domainType'),
      t('download.brand'),
      t('download.citations'),
      t('download.previous'),
      t('download.prompts'),
      t('download.topPrompt'),
      t('download.lastCited'),
      ...engines.map((engine) => t('download.engineCitations', { engine: engine.label })),
    ],
    rows: rows.map((row) => [
      text(row.url),
      text(row.title),
      role(row),
      text(row.entity_name),
      row.citations,
      row.previous_citations,
      row.prompts,
      text(row.top_prompts[0]?.text ?? null),
      formatIsoDate(row.last_cited_at, timeZone),
      ...engines.map((engine) => row.engines.find((cell) => cell.engine_code === engine.code)?.citation_units ?? 0),
    ]),
  };
}

/** `competitors` are the selected ones (the gap columns), in their order. */
export function gapsCsv(
  rows: readonly CitationGapRow[],
  competitors: readonly TrackedCompetitor[],
  ownName: string,
  engines: readonly BoardEngine[],
  t: CitationsTranslate,
): CsvTable {
  const state = (cited: number): string => (cited > 0 ? t('marks.cited') : t('marks.notCited'));
  const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const nameOf = (id: string): string => competitors.find((competitor) => competitor.id === id)?.name ?? id;
  return {
    // The brand names are the project's own and its competitors': they can start with a formula character
    header: [
      t('download.prompt'),
      t('download.group'),
      t('download.brandState', { brand: ownName }),
      t('download.brandCited', { brand: ownName }),
      ...competitors.flatMap((competitor) => [
        t('download.brandState', { brand: competitor.name }),
        t('download.brandCited', { brand: competitor.name }),
      ]),
      t('download.lostOn'),
      t('download.lostTo'),
    ].map(safeText),
    rows: rows.map((row) => [
      text(row.text),
      text(row.topic?.name ?? t('toolbar.noGroup')),
      state(row.you.total.cited),
      row.you.total.cited,
      ...competitors.flatMap((competitor) => {
        const cell = row.competitors.find((candidate) => candidate.entity_id === competitor.id)?.total;
        return [cell === undefined ? null : state(cell.cited), cell?.cited ?? null];
      }),
      row.lost_on.map(labelOf).join(', '),
      text(row.lost_to.map(nameOf).join(', ')),
    ]),
  };
}
